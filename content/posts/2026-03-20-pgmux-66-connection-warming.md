---
title: "Go로 PostgreSQL 프록시 만들기 (66) - Connection Warming"
date: 2026-03-20
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Connection Pool", "Performance"]
categories: ["Database"]
project: "pgmux"
description: "프록시 시작과 config reload 시 min_connections까지 백그라운드 사전 연결하여 cold start tail latency를 완화한다. Pool.New와 Pool.Warm을 분리하고, health check과의 역할을 명확히 나눈다."
---

## 들어가며

[이전 글](/posts/2026-03-20-pgmux-65-per-user-rate-limiting/)에서 Per-User/Per-IP Rate Limiting을 구현했다. 이번에는 프록시의 **cold start 문제**를 해결한다.

pgmux의 커넥션 풀은 기존에 모든 연결을 **lazy creation**으로 처리했다. 설정에 `min_connections: 5`가 있어도 풀 생성 시점에는 연결을 하나도 만들지 않고, 첫 클라이언트 요청이 올 때 비로소 연결했다. 문제는 프록시 재시작이나 config reload 직후, 첫 N개 요청이 연결 수립 비용을 고스란히 부담한다는 것이다.

이번 구현의 목표:

- 프록시 시작 시 `min_connections`까지 백그라운드 사전 연결
- Config reload로 새 Reader 추가 시에도 즉시 warming
- 실패해도 프록시 기동을 막지 않는 fault-tolerant 설계

---

## 기존 구조의 문제

### Pool.New()의 동기 생성

원래 `Pool.New()`에는 `MinConnections`만큼 동기적으로 연결을 생성하는 코드가 있었다:

```go
// 이전 코드
for i := 0; i < cfg.MinConnections; i++ {
    conn, err := p.newConn()
    if err != nil {
        p.Close()
        return nil, fmt.Errorf("pre-create connection %d: %w", i, err)
    }
    p.idle = append(p.idle, conn)
    p.numOpen++
}
```

하지만 `newDatabaseGroup()`에서는 이 값을 항상 `0`으로 설정했다:

```go
wp, err := pool.New(pool.Config{
    MinConnections: 0, // lazy creation; backend may not be ready at startup
    // ...
})
```

이유는 **프록시 시작 시점에 백엔드가 준비되지 않았을 수 있기 때문**이다. Writer가 아직 부팅 중일 때 동기 연결을 시도하면 프록시 전체가 기동에 실패한다.

결과적으로 `MinConnections` 설정값은 **health check 주기까지 효과가 없었다.** health check 간격이 `idle_timeout / 2` (기본 5분)이므로, 프록시 시작 후 최대 5분간 모든 연결이 on-demand로 생성됐다.

---

## 설계: New와 Warm의 분리

핵심 아이디어는 **풀 생성과 사전 연결을 분리**하는 것이다:

| 단계 | 역할 | 블로킹 | 실패 시 |
|------|------|--------|---------|
| `Pool.New()` | 풀 구조체 초기화만 | 즉시 반환 | 에러 반환 |
| `Pool.Warm(ctx)` | `MinConnections`까지 백그라운드 연결 | 비차단 (goroutine) | 로그만 남김 |
| `healthCheck()` | 주기적으로 `MinConnections` 유지 | 비차단 | 로그만 남김 |

```
시작                   Warm goroutine           Health Check
 │                         │                       │
 ├─ Pool.New() ────────────┤                       │
 │  (구조체만 생성)         │                       │
 │                         │                       │
 ├─ Pool.Warm(ctx) ────►   ├─ conn 1 생성          │
 │  (즉시 반환)            ├─ conn 2 생성          │
 │                         ├─ conn N 생성          │
 │                         └─ "pool warmed" 로그   │
 │                                                  │
 │  ... 5분 후 ...                                  │
 │                                                  ├─ 만료 연결 정리
 │                                                  ├─ MinConnections 미만이면 보충
 │                                                  └─ 반복
```

---

## 구현

### Pool.Warm()

```go
func (p *Pool) Warm(ctx context.Context) {
    target := p.cfg.MinConnections
    if target <= 0 {
        return
    }

    go func() {
        var created int
        for i := 0; i < target; i++ {
            select {
            case <-ctx.Done():
                return
            case <-p.done:
                return
            default:
            }

            p.mu.Lock()
            if p.closed || p.numOpen >= target {
                p.mu.Unlock()
                break
            }
            p.numOpen++ // 슬롯 예약
            p.mu.Unlock()

            conn, err := p.newConn()

            p.mu.Lock()
            if err != nil {
                p.numOpen--
                p.mu.Unlock()
                slog.Warn("warm: pre-create connection failed",
                    "addr", p.cfg.Addr, "error", err)
                continue // 실패해도 다음 연결 시도
            }
            if p.closed {
                p.numOpen--
                p.mu.Unlock()
                conn.Close()
                return
            }
            p.idle = append(p.idle, conn)
            created++
            p.mu.Unlock()
        }
        if created > 0 {
            slog.Info("pool warmed", "addr", p.cfg.Addr,
                "connections", created, "target", target)
        }
    }()
}
```

주요 설계 결정:

1. **비차단**: `go func()`로 즉시 반환. 프록시 기동을 막지 않는다.
2. **Fault-tolerant**: 개별 연결 실패는 `continue`로 건너뛴다. 백엔드 부팅 지연이나 일시적 네트워크 문제에 대응.
3. **세 가지 종료 조건**: `ctx.Done()` (전역 셧다운), `p.done` (풀 Close), `p.closed` (double check).
4. **슬롯 예약 패턴**: `numOpen++` → unlock → dial → lock → idle에 추가. health check의 replenish 패턴과 동일.

### DatabaseGroup.WarmPools()

```go
func (g *DatabaseGroup) WarmPools(ctx context.Context) {
    if g.writerPool != nil {
        g.writerPool.Warm(ctx)
    }
    g.mu.RLock()
    pools := g.readerPools
    g.mu.RUnlock()
    for _, p := range pools {
        p.Warm(ctx)
    }
}
```

Writer 1개 + Reader N개의 모든 풀을 한 번에 warming한다. 각 `Warm()`이 goroutine을 띄우므로 모든 백엔드에 대해 병렬로 사전 연결된다.

### Server에서의 호출

**시작 시** — health check 시작 직후:

```go
for name, dbg := range s.dbGroups {
    // ... health check 시작 ...
    dbg.WarmPools(ctx)
}
```

**Reload 시** — 기존/새 그룹 모두:

```go
for name, dbCfg := range newDBs {
    if existing, ok := s.dbGroups[name]; ok {
        existing.Reload(dbCfg, newCfg.CircuitBreaker)
        existing.WarmPools(context.Background())
    } else {
        dbg := newDatabaseGroup(name, dbCfg, newCfg.CircuitBreaker)
        dbg.WarmPools(context.Background())
        s.dbGroups[name] = dbg
    }
}
```

Reload에서는 `context.Background()`를 사용한다. 풀의 `done` 채널이 Close 시 goroutine을 정리하므로 lifecycle 관리는 풀 자체가 담당한다.

---

## 역할 정리: Warm vs Health Check

| | Warm | Health Check |
|---|---|---|
| **실행 시점** | 시작/reload 시 1회 | `idle_timeout / 2` 주기 반복 |
| **목적** | 초기 사전 연결 | 만료 정리 + 최소 유지 |
| **실패 처리** | 건너뛰고 계속 | 건너뛰고 다음 주기 |
| **완료 후** | goroutine 종료 | 풀 종료까지 반복 |

Warm은 "빠른 초기화", Health Check은 "지속적 유지"를 담당한다. `MinConnections` 설정값 하나로 두 메커니즘이 동작하므로 추가 설정이 필요 없다.

---

## 메트릭

기존 풀 게이지로도 warming 효과를 관찰할 수 있다:

- `pgmux_pool_connections_open` — warming 직후 `min_connections`까지 증가
- `pgmux_pool_connections_idle` — 동일하게 증가

추가로 warming 전용 카운터를 도입했다:

- `pgmux_pool_warm_connections_total` — 사전 생성된 커넥션 수 (role/addr별)
- `pgmux_pool_warm_errors_total` — warming 실패 횟수 (role/addr별)

---

## 테스트

### Pool.Warm 기본 동작

```go
func TestPool_Warm(t *testing.T) {
    p, _ := New(Config{MinConnections: 3, MaxConnections: 10, ...})
    defer p.Close()

    p.Warm(context.Background())
    time.Sleep(200 * time.Millisecond) // 백그라운드 완료 대기

    numOpen, numIdle := p.Stats()
    // numOpen == 3, numIdle == 3
}
```

### Context 취소 시 조기 종료

```go
func TestPool_WarmRespectsCancel(t *testing.T) {
    p, _ := New(Config{MinConnections: 5, MaxConnections: 10, ...})
    ctx, cancel := context.WithCancel(context.Background())
    cancel() // 즉시 취소
    p.Warm(ctx)

    time.Sleep(100 * time.Millisecond)
    numOpen, _ := p.Stats()
    // numOpen < 5 (대부분 0)
}
```

### New()는 더 이상 사전 생성하지 않음

```go
func TestPool_NewDoesNotPreCreate(t *testing.T) {
    p, _ := New(Config{MinConnections: 3, MaxConnections: 10, ...})
    numOpen, numIdle := p.Stats()
    // numOpen == 0, numIdle == 0
}
```

Race detector 포함 전체 테스트 통과:

```
go test -race ./internal/pool/ → PASS
go test ./internal/... → 15 packages PASS
```

---

## 마무리

Connection Warming은 작은 변경이지만 운영 관점에서 중요하다:

1. **Cold start tail latency 완화** — 프록시 재시작 후 첫 요청의 레이턴시 스파이크 제거
2. **Config reload 안정성** — 새 Reader 추가 시 즉시 연결 준비
3. **기존 동작 호환** — `min_connections: 0`이면 이전과 동일하게 lazy creation

`Pool.New()` → `Pool.Warm()` 분리 패턴은 "구조체 초기화는 실패할 수 없게, I/O는 별도로" 라는 Go 관용 패턴과 맞닿아 있다. Database driver의 `sql.Open()` (초기화만) + `db.Ping()` (실제 연결) 분리와 같은 맥락이다.

다음 글에서는 **Replica Freshness Policy** — LSN 기반 causal consistency를 넘어 `max_replica_lag_bytes`로 뒤처진 Reader를 자동 제외하는 기능을 구현한다.
