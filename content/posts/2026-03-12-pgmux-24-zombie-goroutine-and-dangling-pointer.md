---
title: "Go로 PostgreSQL 프록시 만들기 (24) - 좀비 고루틴과 Dangling Pointer"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Context Cancellation", "Goroutine Leak", "Dangling Pointer", "Hot Reload", "Bug Fix"]
categories: ["Database"]
description: "pgmux에서 발견된 두 가지 CRITICAL 버그 — HTTP 클라이언트 끊김을 무시해 고루틴과 DB 커넥션이 영원히 블로킹되는 좀비 누수와, 핫-리로드 후 Admin/Data API가 닫힌 풀을 바라보는 Dangling Pointer — 를 분석하고 수정한다."
---

## 들어가며

P23에서 커넥션 풀 오염과 Panic 격리를 수정한 직후, QA 검토를 통해 두 가지 CRITICAL 버그를 추가로 발견했다.

1. **좀비 고루틴 (Zombie Goroutine Leak)**: Data API에서 HTTP 클라이언트가 연결을 끊어도, 백엔드 쿼리를 실행하는 고루틴이 끝날 때까지 영원히 블로킹된다
2. **Dangling Pointer**: 핫-리로드 후 Admin/Data API 서버가 닫힌(Closed) 풀 객체를 계속 참조하여 유령 통계를 반환한다

이번 글에서는 각 버그의 원인과 수정 과정을 다룬다.

---

## Bug 1: Data API 좀비 고루틴 (Context 취소 무시)

### 문제 상황

사용자가 `/v1/query` 엔드포인트로 수초가 걸리는 무거운 쿼리를 요청했는데, 갑자기 브라우저 탭을 닫거나 HTTP 타임아웃이 발생하면 어떻게 될까? `http.Server`는 즉시 Request의 `ctx`를 Cancel한다.

하지만 pgmux의 Data API 코드는 이 취소 신호를 전혀 신경 쓰지 않았다!

```
시나리오:

1) Client: POST /v1/query { "sql": "SELECT * FROM huge_table" }
2) pgmux: Pool에서 커넥션 획득 → executeQuery() 시작 (블로킹 read)
3) Client: 1초 후 브라우저 탭 닫음 → ctx.Cancel() 발생
4) pgmux: ctx가 취소되었지만, executeQuery()는 DB 응답을 기다리며 영원히 블로킹!
5) 결과: 고루틴 1개 + DB 커넥션 1개 = 좀비 💀
```

타임아웃 공격을 당하면 고루틴과 DB 커넥션이 남아나지 않는 치명적인 좀비 누수가 발생한다.

### 코드 분석

문제의 핵심은 `executeOnPool()`의 쿼리 실행 경로였다:

```go
// AS-IS: ctx 취소를 전혀 감시하지 않음
func (s *Server) executeOnPool(ctx context.Context, sql string, p *pool.Pool) (*QueryResponse, error) {
    conn, err := p.Acquire(ctx) // ctx를 존중 ✓
    if err != nil { return nil, err }

    resp, execErr := executeQuery(conn, sql) // ← ctx가 취소되어도 DB 응답까지 무한 블로킹!
    // ...
    drainUntilReady(conn)                     // ← 여기서도 블로킹!
    p.Release(conn)
    return resp, nil
}
```

`Acquire(ctx)`는 context를 올바르게 존중한다. 하지만 그 다음의 `executeQuery()`와 `drainUntilReady()`는 raw `net.Conn`에서 `protocol.ReadMessage()`를 직접 호출하는데, 이 함수는 **ctx를 전혀 받지 않는다**. 순수한 TCP read이므로 데이터가 올 때까지 무한정 블로킹한다.

`executeQuery()`의 시그니처를 바꿀 수는 있지만, 이 함수는 저수준 wire protocol 파서이므로 context 의존성을 넣으면 설계가 복잡해진다. 더 좋은 방법이 있다.

### 수정: Context Cancellation Watchdog

`executeOnPool()` 내부에 **워치독 고루틴**을 추가하여, `ctx.Done()`이 감지되면 `conn.SetDeadline(time.Now())`을 호출해 블로킹 중인 read를 강제로 실패시킨다:

```go
// TO-BE: 워치독으로 context 취소 감시
func (s *Server) executeOnPool(ctx context.Context, sql string, p *pool.Pool) (*QueryResponse, error) {
    conn, err := p.Acquire(ctx)
    if err != nil { return nil, err }

    // 워치독 고루틴: ctx 취소 시 커넥션 deadline 강제 설정
    var cancelled atomic.Bool
    stopCh := make(chan struct{})
    watchdogDone := make(chan struct{})
    go func() {
        defer close(watchdogDone)
        select {
        case <-ctx.Done():
            cancelled.Store(true)
            conn.SetDeadline(time.Now()) // 블로킹 read를 즉시 실패시킴
        case <-stopCh:
            // 정상 완료 — 워치독 종료
        }
    }()

    stopWatchdog := func() {
        close(stopCh)
        <-watchdogDone
    }

    resp, execErr := executeQuery(conn, sql)

    // ctx가 취소된 경우: 커넥션을 Discard하고 에러 반환
    if cancelled.Load() {
        <-watchdogDone
        p.Discard(conn)
        return nil, fmt.Errorf("execute query: %w", ctx.Err())
    }

    if execErr != nil {
        stopWatchdog()
        p.Discard(conn)
        return nil, execErr
    }

    // reset query도 동일하게 워치독이 커버
    drainErr := drainUntilReady(conn)
    if cancelled.Load() {
        <-watchdogDone
        p.Discard(conn)
        return nil, fmt.Errorf("drain reset: %w", ctx.Err())
    }

    stopWatchdog()
    p.Release(conn)
    return resp, nil
}
```

### 워치독 패턴의 핵심

이 패턴에서 주의할 점이 세 가지 있다:

**1) 워치독 고루틴 자체가 누수되면 안 된다**

`stopCh`와 `watchdogDone` 두 채널을 사용한다. 정상 완료 시 `close(stopCh)`로 워치독을 종료하고, `<-watchdogDone`으로 완전히 끝날 때까지 기다린다.

**2) 취소된 커넥션은 반드시 Discard**

`SetDeadline(time.Now())`으로 강제 실패시킨 커넥션은 프로토콜 상태가 불확실하다. P23에서 배운 원칙을 그대로 적용한다 — "의심스러우면 버려라."

**3) `atomic.Bool`로 경쟁 조건 방지**

워치독 고루틴과 메인 고루틴이 동시에 `cancelled` 플래그에 접근한다. `sync/atomic`으로 안전하게 조율한다.

### 왜 `conn.SetDeadline()`인가?

Go의 `net.Conn`은 context를 직접 지원하지 않지만, deadline 기반 타임아웃을 지원한다. `SetDeadline(time.Now())`을 호출하면 진행 중인 모든 `Read()`/`Write()`가 즉시 `i/o timeout` 에러를 반환한다. 이는 Go 네트워크 프로그래밍에서 context 취소를 블로킹 I/O에 전파하는 표준 관용구다.

---

## Bug 2: 핫-리로드 후 Admin 대시보드 통계 마비 (Dangling Pointer)

### 문제 상황

Admin API는 초기화될 때 전달받은 `writerPool`, `readerPools`, `cache` 등의 포인터를 내부에 저장한다. 사용자가 `/admin/reload`를 호출하면 프록시 서버는 기존 reader pool들을 `Close()`하고 새 풀 객체를 할당받아 교체한다.

하지만 Admin 서버가 가지고 있는 포인터는 업데이트되지 않는다!

```
시나리오:

1) main.go: adminSrv := admin.New(cfg, srv.WriterPool(), srv.ReaderPools(), ...)
   → 초기화 시점의 포인터 값을 Admin 서버에 복사

2) POST /admin/reload → srv.Reload(newCfg)
   → s.readerPools = newReaderPools (새 맵으로 교체)
   → 기존 removed pool.Close() (커넥션 전부 해제)

3) GET /admin/stats
   → Admin 서버: s.readerPools 접근 (예전 맵!)
   → 닫힌 풀의 Stats() → open: 0, idle: 0 💀 유령 데이터
```

Data API도 동일한 구조로, 리로드 후 이전 풀/밸런서/캐시를 사용하는 같은 문제가 있었다.

### 코드 분석

`cmd/pgmux/main.go`에서 초기화 시점에 **값을 평가(evaluate)**하여 넘기고 있었다:

```go
// AS-IS: 초기화 시점의 포인터 값 전달
adminSrv := admin.New(
    cfg,
    srv.Cache(),       // ← 호출 결과인 *cache.Cache 값을 복사
    srv.Invalidator(),
    srv.WriterPool(),  // ← 호출 결과인 *pool.Pool 값을 복사
    srv.ReaderPools(), // ← 호출 결과인 map[string]*pool.Pool 값을 복사
    srv.AuditLogger(),
)
```

Admin 서버 구조체도 이 값들을 직접 필드로 저장했다:

```go
// AS-IS: 포인터를 직접 저장
type Server struct {
    cfg         *config.Config
    cache       *cache.Cache
    writerPool  *pool.Pool
    readerPools map[string]*pool.Pool
    // ...
}
```

`Reload()` 후 `srv.readerPools`는 새 맵을 가리키지만, `adminSrv.readerPools`는 여전히 이전 맵을 가리킨다.

### 수정: Getter 함수 패턴

직접 포인터 대신 **getter 함수**를 저장하여, 매 요청마다 최신 객체를 런타임에 가져오도록 변경한다:

```go
// TO-BE: getter 함수로 최신 객체 접근
type Server struct {
    cfgFn         func() *config.Config
    cacheFn       func() *cache.Cache
    writerPoolFn  func() *pool.Pool
    readerPoolsFn func() map[string]*pool.Pool
    auditLoggerFn func() *audit.Logger
    // ...
}

func New(
    cfgFn func() *config.Config,
    cacheFn func() *cache.Cache,
    // ...
) *Server {
    return &Server{
        cfgFn:   cfgFn,
        cacheFn: cacheFn,
        // ...
    }
}
```

`handleStats()`도 getter를 호출하도록 수정:

```go
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
    writerPool := s.writerPoolFn()   // 매 요청마다 최신 풀 획득
    readerPools := s.readerPoolsFn() // 매 요청마다 최신 맵 획득

    if writerPool != nil {
        wOpen, wIdle := writerPool.Stats()
        // ...
    }
}
```

`main.go`에서는 메서드 호출 대신 **메서드 참조**를 전달한다:

```go
// TO-BE: 메서드 참조 전달 (호출하지 않음!)
adminSrv := admin.New(
    srv.Cfg,          // func() *config.Config — 호출할 때마다 최신 config
    srv.Cache,        // func() *cache.Cache
    srv.Invalidator,  // func() *cache.Invalidator
    srv.WriterPool,   // func() *pool.Pool
    srv.ReaderPools,  // func() map[string]*pool.Pool — mutex 보호된 getter
    srv.AuditLogger,  // func() *audit.Logger
)
```

핵심은 `srv.WriterPool()`(호출)과 `srv.WriterPool`(참조)의 차이다. 전자는 현재 시점의 값을 즉시 평가하고, 후자는 나중에 호출할 수 있는 함수를 전달한다.

Data API도 동일한 패턴으로 수정했다.

### 왜 이 패턴이 안전한가?

`proxy.Server`의 getter 메서드들은 이미 `sync.RWMutex`로 보호되어 있다:

```go
func (s *Server) ReaderPools() map[string]*pool.Pool {
    return s.getReaderPools() // 내부에서 s.mu.RLock/RUnlock
}
```

따라서 `Reload()`가 `s.mu.Lock()`을 잡고 풀을 교체하는 동안, getter 호출은 안전하게 대기한 후 항상 최신 객체를 반환한다.

---

## 마무리

두 버그 모두 **초기화 시점의 스냅샷에 의존**하는 설계 결함이다:

| 버그 | 패턴 | 교훈 |
|------|------|------|
| 좀비 고루틴 | **블로킹 I/O에서 context 취소 무시** | raw TCP 통신에서는 워치독 + `SetDeadline()`으로 context 취소를 전파해야 한다 |
| Dangling Pointer | **초기화 시 포인터 값 복사 후 교체** | 핫-리로드 가능한 시스템에서는 getter 함수를 전달하여 항상 최신 상태를 참조해야 한다 |

특히 두 번째 버그는 Go에서 흔히 빠지는 함정이다. 포인터를 넘기면 "참조니까 자동으로 최신을 가리키겠지"라고 착각하지만, **포인터 변수 자체가 교체되면** 이전 포인터를 가진 쪽은 오래된 객체를 영원히 바라보게 된다. 포인터가 가리키는 대상이 바뀌는 게 아니라, 포인터 변수가 다른 대상을 가리키도록 재할당되기 때문이다.
