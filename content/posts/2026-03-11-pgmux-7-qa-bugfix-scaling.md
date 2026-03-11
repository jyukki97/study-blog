---
title: "Go로 PostgreSQL 프록시 만들기 (7) - QA 버그 수정과 멀티 인스턴스 스케일링"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Redis", "Scaling", "QA"]
categories: ["Database"]
description: "QA 리뷰에서 발견된 Critical/Major 버그 4건을 수정하고, 프록시 수평 확장을 위한 Redis Pub/Sub 캐시 무효화를 구현한다."
---

## 들어가며

> "테스트가 통과한다"와 "프로덕션에서 안전하다"는 완전히 다른 이야기다.

6편까지 기능적으로 완성했다고 생각했지만, QA 리뷰에서 운영 시 장애로 직결되는 버그 4건이 발견됐다. 거기에 "프록시를 여러 대 띄우면 동작하나?"라는 질문도 받았다. 대답은 **"캐시 정합성이 깨진다"**였다.

이번 편에서 수정한 것:
1. [CRITICAL] OOM — 거대 쿼리 결과의 무한 버퍼링
2. [CRITICAL] 좀비 헬스체크 — Pool.Close() 후에도 살아있는 고루틴
3. [MAJOR] 트랜잭션 릭 — 세미콜론 복합 쿼리에서 COMMIT 미감지
4. [MAJOR] 캐시 무효화 누락 — CTE/다중 테이블 미지원
5. [SCALING] Redis Pub/Sub 기반 멀티 인스턴스 캐시 무효화

## 🔥 CRITICAL #1: OOM 위험

### 문제

`relayAndCollect()`는 백엔드 응답을 클라이언트에 릴레이하면서 동시에 캐시용 버퍼에 수집한다:

```go
// Before: 응답 크기에 관계없이 무한정 수집
buf = append(buf, msgBytes...)
```

`SELECT * FROM ten_gigabyte_table` → 10GB가 `buf`에 쌓임 → OOM 패닉.

캐시의 `MaxSize` 검사는 `Set()` 내부에서만 이뤄지므로, 그 전에 이미 메모리를 다 잡아먹는다.

### 수정

수집 중에 `max_result_size`를 실시간으로 체크하고, 초과하면 버퍼를 즉시 해제한다. 클라이언트로의 릴레이는 계속한다:

```go
if !oversize {
    buf = append(buf, msgBytes...)
    if maxSize > 0 && len(buf) > maxSize {
        buf = nil     // 메모리 즉시 해제
        oversize = true
    }
}
```

`relayAndCollect`가 `nil`을 반환하면 호출부에서 캐시 저장을 건너뛴다.

## 🔥 CRITICAL #2: 좀비 헬스체크

### 문제

`Pool.Close()` 후에도 `StartHealthCheck`로 시작된 고루틴이 살아있다. 이 고루틴이 `healthCheck()`를 실행하면:

```go
// healthCheck 내부: Close()로 numOpen=0이 된 상태에서
for p.numOpen < p.cfg.MinConnections {
    conn, _ := p.newConn()  // 새 DB 커넥션 생성!
    p.numOpen++
}
```

닫힌 풀에서 좀비 커넥션이 계속 생성된다.

### 수정

```go
type Pool struct {
    // ...
    done chan struct{} // Close 시 닫힘
}

func (p *Pool) Close() {
    if p.closed { return }
    p.closed = true
    close(p.done) // 헬스체크 고루틴 종료 신호
    // ...
}

func (p *Pool) StartHealthCheck(ctx context.Context, interval time.Duration) {
    go func() {
        for {
            select {
            case <-ctx.Done(): return
            case <-p.done: return     // Close 시 즉시 종료
            case <-ticker.C: p.healthCheck()
            }
        }
    }()
}

func (p *Pool) healthCheck() {
    if p.closed { return }  // 이중 방어
    // ...
}
```

## 🚨 MAJOR #3: 트랜잭션 릭

### 문제

```sql
SELECT 1; COMMIT;
```

PG의 Simple Query Protocol은 세미콜론으로 구분된 여러 문장을 한 번에 보낼 수 있다. 기존 파서는 첫 번째 키워드만 확인하므로 `SELECT`로 분류하고, `COMMIT`을 놓친다. `inTransaction`이 영원히 `true`로 남아 모든 후속 쿼리가 writer로 쏠린다.

### 수정

세미콜론으로 분리해서 모든 문장을 스캔:

```go
func splitStatements(query string) []string {
    // 세미콜론으로 분리, 단 따옴표 내부의 세미콜론은 무시
    // "INSERT INTO t VALUES ('a;b')" → 1개의 문장
}

func (s *Session) updateTransactionState(query string) {
    for _, stmt := range splitStatements(query) {
        upper := strings.ToUpper(strings.TrimSpace(stmt))
        if strings.HasPrefix(upper, "BEGIN") { s.inTransaction = true }
        if strings.HasPrefix(upper, "COMMIT") { s.inTransaction = false }
    }
}
```

## 🚨 MAJOR #4: 다중 테이블 캐시 무효화

### 문제

```sql
WITH x AS (UPDATE users SET score=0)
UPDATE ranking SET total=0;
```

`ExtractTables`가 첫 번째 테이블(`ranking`)만 추출하고 CTE 내부의 `users`를 놓친다. `users` 캐시가 무효화되지 않아 stale 데이터를 반환한다.

### 수정

1. 멀티 스테이트먼트: 세미콜론 분리 후 각 문장에서 테이블 추출
2. CTE: `WITH` 절 내부를 스캔하여 `INSERT INTO`, `UPDATE`, `DELETE FROM` 뒤의 테이블명 추출
3. `Classify`도 CTE 내 write 키워드를 감지하도록 확장

```go
// "WITH x AS (UPDATE users ...) UPDATE ranking ..." → ["users", "ranking"]
func extractCTETables(query string) []string {
    // INSERT INTO, UPDATE, DELETE FROM 키워드를 모두 찾아서 테이블명 추출
}
```

## 🌐 멀티 인스턴스 스케일링

### 문제

프록시를 LB 뒤에 여러 대 띄우면:

```
Proxy A: SELECT * FROM users → 캐시 저장
Proxy B: UPDATE users SET ... → Proxy B 캐시만 무효화
Proxy A: SELECT * FROM users → stale 캐시 반환 ❌
```

### 해결: Redis Pub/Sub 캐시 무효화 브로드캐스트

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Proxy A │     │ Proxy B │     │ Proxy C │
│         │     │  WRITE  │     │         │
│ Cache ✓ │     │ Cache ✓ │     │ Cache ✓ │
└────┬────┘     └────┬────┘     └────┬────┘
     │ subscribe     │ publish       │ subscribe
     └───────┐  ┌────┘  ┌───────────┘
             ▼  ▼       ▼
         ┌──────────────────┐
         │  Redis Pub/Sub   │
         │  channel:        │
         │  pgmux:invalidate
         └──────────────────┘
```

1. **Proxy B**에서 쓰기 발생 → 로컬 캐시 무효화 + Redis에 `"users"` publish
2. **Proxy A, C**가 subscribe 중 → `"users"` 수신 → 로컬 캐시 무효화
3. Full flush는 `"*"` 메시지로 브로드캐스트

```yaml
cache:
  enabled: true
  invalidation:
    mode: "pubsub"           # "local" or "pubsub"
    redis_addr: "redis:6379"
    channel: "pgmux:invalidate"
```

`mode: "local"`이면 기존처럼 로컬-only로 동작한다 (하위 호환).

## 배운 점

1. **테스트 통과 ≠ 프로덕션 안전** — 정상 경로만 테스트하면 엣지 케이스(거대 쿼리, 복합 문장, 좀비 고루틴)를 놓친다
2. **고루틴은 반드시 종료 경로가 있어야 한다** — `go func()` 하나 띄우면 반드시 대응하는 종료 채널이 필요하다
3. **파서의 한계를 인정하라** — 완벽한 SQL 파서 없이는 CTE, 서브쿼리를 100% 커버할 수 없다. 최선의 노력을 하되, TTL이라는 안전망이 있다
4. **수평 확장은 공유 상태를 제거해야 가능하다** — 인메모리 캐시는 본질적으로 로컬 상태. 멀티 인스턴스를 지원하려면 브로드캐스트 메커니즘이 필수

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
