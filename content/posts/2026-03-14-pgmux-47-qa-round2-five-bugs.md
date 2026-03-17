---
title: "Go로 PostgreSQL 프록시 만들기 (47) - QA 2차: Cross-Pool 오염과 캐시 정확성"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Bug Fix", "Connection Pool", "Hot Reload", "Cache", "Circuit Breaker"]
categories: ["Database"]
project: "pgmux"
description: "QA 2차 소견 5건 — boundWriter cross-pool 오염, extended cache 파라미터 무시, Pool.Close outstanding borrow, writer CB reload 누락, watcher startup race — 을 분석하고 수정한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-46-qa-findings-six-bugs/)에서 QA 1차 소견 6건을 수정했다. 곧바로 2차 리뷰가 올라왔는데, 이번에는 **1차 수정이 만든 새로운 문제**와 **1차에서 덜 파고든 영역**이 섞여 있다. 특히 #1과 #2는 데이터 정확성에 직결되는 심각한 버그다.

---

## 소견 1: boundWriter cross-pool 반환 (High)

### 문제

`relayQueries()`에서 `boundWriter`는 트랜잭션 동안 writer 연결을 잡고 있다. 반환 시 `dbg.writerPool`을 참조하는데, Reload가 `dbg.writerPool`을 교체하면 **old pool에서 빌린 conn이 new pool로 반환**된다.

```go
// query.go — COMMIT 시 반환
boundWriter = nil
dbg.writerPool.Release(wConn)  // ← reload 후 dbg.writerPool은 새 pool
```

이로 인해:
1. **new pool에 old backend 소켓이 섞임** — writer 주소가 바뀌었으면 잘못된 서버로 쿼리 전송
2. **numOpen 불일치** — new pool은 이 conn을 Acquire한 적이 없으므로 카운터 맞지 않음
3. **MaxConnections 초과** — new pool의 numOpen에 반영 안 된 유령 conn이 idle에 추가

### 수정

conn을 Acquire한 시점의 pool 참조를 함께 캡처하는 방식으로 수정했다:

```go
var boundWriter *pool.Conn
var boundWriterPool *pool.Pool  // ← Acquire 시점의 pool 참조

// Acquire 시점
acquiredPool := dbg.writerPool  // 현재 pool 캡처
wConn, acquired, err := s.acquireWriterConn(ctx, boundWriter, dbg)

// BEGIN — bind
boundWriter = wConn
boundWriterPool = acquiredPool

// COMMIT — release (항상 원본 pool로)
resetAndReleaseToPool(wConn, boundWriterPool)
```

`backend.go`에 pool-explicit 헬퍼를 추가했다:

```go
func (s *Server) resetAndReleaseToPool(conn *pool.Conn, p *pool.Pool) {
    if err := s.resetConn(conn); err != nil {
        p.Discard(conn)
        return
    }
    p.Release(conn)
}
```

핵심 원칙: **모든 Release/Discard는 Acquire한 pool로 돌아가야 한다**.

---

## 소견 2: Extended cache 키가 Bind 파라미터 무시 (High)

### 문제

이전 수정(P46 소견 5)에서 extended query에 캐시 조회를 추가했는데, 캐시 키가 **Parse 메시지의 SQL 텍스트만** 사용했다:

```go
_, query := protocol.ParseParseMessage(buf[0].Payload)
key := cache.WithNamespace(s.cacheKey(query, dbg.name), cache.NSExtended)
```

`SELECT * FROM users WHERE id = $1` 같은 prepared statement에서:
- `$1 = 1`로 실행 → 캐시 저장
- `$1 = 2`로 실행 → 캐시 hit → **$1 = 1의 결과 반환**

이건 **데이터 정확성 버그**다. 캐시 최적화가 오히려 잘못된 데이터를 돌려주게 된 것.

### 수정

파라미터가 있는 prepared statement는 **캐시하지 않는** 것이 가장 안전하다:

```go
func hasParameterPlaceholders(buf []*protocol.Message) bool {
    for _, m := range buf {
        if m.Type == protocol.MsgParse {
            _, query := protocol.ParseParseMessage(m.Payload)
            for i := 0; i < len(query)-1; i++ {
                if query[i] == '$' && query[i+1] >= '1' && query[i+1] <= '9' {
                    return true
                }
            }
        }
    }
    return false
}
```

캐시 read/write 양쪽에 가드를 추가했다:

```go
// Cache lookup
canCache := !hasParameterPlaceholders(buf)
if s.queryCache != nil && canCache && len(buf) > 0 && buf[0].Type == protocol.MsgParse {
    // ... cache Get ...
}

// Cache store
if canCache && collected != nil && ... {
    // ... cache Set ...
}
```

파라미터 없는 리터럴 쿼리(`SELECT 1`, `SELECT now()` 등)만 캐시되고, 파라미터화된 쿼리는 항상 backend로 전달된다. 캐시 키에 Bind 파라미터 해시를 포함하는 방안도 있지만, 복잡도 대비 이득이 적어 단순한 접근을 택했다.

---

## 소견 3: Pool.Close() outstanding borrow 무시 (Medium)

### 문제

P46 소견 1에서 `Acquire()`에 `p.closed` 체크를 추가했지만, `numOpen++` 후 unlock → `newConn()` 사이에 `Close()`가 끼어드는 창은 여전히 열려 있었다.

핵심은 `Close()`의 `p.numOpen = 0`:

```go
func (p *Pool) Close() {
    // ...
    p.numOpen = 0  // ← outstanding borrow(5개 중 3개 idle, 2개 borrowed)를 무시
}
```

이후 borrowed conn이 Release되면 `numOpen--` → **음수**.

### 수정

idle conn 수만 차감하도록 변경:

```go
func (p *Pool) Close() {
    // ...
    idleCount := len(p.idle)
    for _, conn := range p.idle {
        conn.Close()
    }
    p.idle = nil
    p.numOpen -= idleCount  // outstanding borrow는 보존
}
```

추가로 `Release()`와 `Discard()`에 음수 방어 가드:

```go
func (p *Pool) Discard(conn *Conn) {
    conn.Close()
    p.mu.Lock()
    if p.numOpen > 0 {
        p.numOpen--
    }
    p.mu.Unlock()
    // ...
}
```

---

## 소견 4: Writer Circuit Breaker reload 누락 (Medium)

### 문제

`Reload()`에서 readerCBs만 갱신하고 writerCB는 건드리지 않았다:

```go
if cbCfg.Enabled {
    // reader CBs만 갱신
    newCBs := make(map[string]*resilience.CircuitBreaker)
    for _, addr := range newReaderAddrs { ... }
    g.readerCBs = newCBs
    // writerCB → 미갱신!
}
// CB disabled 시 clear하는 else 분기도 없음
```

### 수정

```go
if cbCfg.Enabled {
    brCfg := resilience.BreakerConfig{...}

    // Writer CB — 없으면 생성, 있으면 상태 보존을 위해 유지
    if g.writerCB == nil {
        g.writerCB = resilience.NewCircuitBreaker(brCfg)
        slog.Info("reload: writer circuit breaker enabled", "db", g.name)
    }

    // Reader CBs (기존 코드)
    // ...
} else {
    // CB 비활성 — 양쪽 모두 정리
    if g.writerCB != nil {
        g.writerCB = nil
        slog.Info("reload: writer circuit breaker disabled", "db", g.name)
    }
    g.readerCBs = nil
}
```

---

## 소견 5: Config Watcher startup race (Medium-Low)

### 문제

```go
// main.go
go func() {
    fw.Start(ctx)  // ← watcher.Add(dir)이 여기서 실행
}()
// ← 여기로 바로 진행. watcher가 arm됐는지 보장 없음
```

`Start()` 안의 `watcher.Add(dir)`이 완료되기 전에 ConfigMap swap이 발생하면 이벤트를 놓친다.

### 수정

`FileWatcher`에 ready 채널을 추가:

```go
type FileWatcher struct {
    // ...
    readyCh chan struct{}
}

func (fw *FileWatcher) Start(ctx context.Context) error {
    dir := filepath.Dir(fw.path)
    if err := fw.watcher.Add(dir); err != nil {
        return err
    }
    close(fw.readyCh)  // ← watch가 arm된 후 시그널
    // event loop...
}

func (fw *FileWatcher) Ready() <-chan struct{} {
    return fw.readyCh
}
```

```go
// main.go
go func() {
    fw.Start(ctx)
}()
<-fw.Ready()  // ← watch가 arm될 때까지 대기
```

race window를 **제로**로 만든다. 단 `Start()`가 에러를 반환하면 `readyCh`가 닫히지 않아 deadlock이 될 수 있으므로, 에러 시에도 close하거나 타임아웃을 두는 것이 안전하다.

---

## 교훈

이번 라운드에서 드러난 패턴:

1. **수정이 만든 새 버그** — P46 소견 5에서 extended cache read path를 추가했는데, 파라미터를 고려하지 않아 정확성 버그를 만들었다. 기능 추가 시 **입력 공간의 전체 범위**를 검토해야 한다.
2. **참조 갱신의 함정** — `dbg.writerPool`처럼 중간에 바뀔 수 있는 포인터를 통한 접근은 hot-reload 환경에서 위험하다. **Acquire 시점에 스냅샷**을 뜨는 것이 안전하다.
3. **카운터 불변량** — `numOpen = 0`처럼 절대값으로 리셋하면 outstanding 작업과의 불변량이 깨진다. **delta로 조정**하는 것이 원칙.
4. **대칭성 누락** — reader CB는 reload 대상인데 writer CB는 아닌 것은 단순한 누락. **한 쪽을 구현하면 반대쪽도 확인**하는 습관이 필요하다.

---

## 마무리

이번 글에서 수정한 것:

- boundWriter origin pool 추적으로 cross-pool 오염 방지
- 파라미터화된 prepared statement의 extended cache 비활성화
- Pool.Close()에서 outstanding borrow 카운터 보존
- Writer circuit breaker reload 대상에 추가
- FileWatcher에 ready 시그널로 startup race 제거

2차 QA에서 특히 주목할 점은, **1차 수정(P46 소견 5)이 새로운 정확성 버그를 만들었다**는 것이다. 캐시처럼 투명해야 하는 레이어는 "있으면 좋고 없어도 동작"해야 하는데, 잘못 구현하면 **없는 것보다 나쁜** 상태가 된다.
