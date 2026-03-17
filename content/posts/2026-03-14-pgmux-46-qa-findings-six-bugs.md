---
title: "Go로 PostgreSQL 프록시 만들기 (46) - QA 소견 6건과 운영 안전성 수정"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Bug Fix", "Security", "Connection Pool", "Hot Reload"]
categories: ["Database"]
project: "pgmux"
description: "QA에서 올라온 6건의 소견 — Pool race, credential 미갱신, XFF spoofing, reader 격리 실패, 캐시 write-only, 설정 오류 — 을 분석하고 수정한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-45-healthz-readyz-probes/)에서 Health Check Endpoint를 구현했다. 이번에는 QA 리뷰에서 올라온 **6건의 소견**을 분석하고 수정한다.

이전에도 [보안 QA (15편)](/posts/2026-03-14-pgmux-15-security-qa/)에서 비슷한 작업을 했지만, 이번 소견은 보안보다는 **운영 안전성**에 초점이 맞춰져 있다. 커넥션 풀 수명주기, 설정 리로드, 장애 격리 같은 프로덕션에서 시간이 지나야 드러나는 종류의 버그들이다.

---

## 소견 1: Pool.Close() 이후 Acquire() race (High)

### 문제

`Pool.Close()`가 `numOpen = 0`으로 리셋한 직후, 아직 for 루프를 돌고 있던 goroutine이 `Acquire()`를 통해 **새 연결을 생성**할 수 있었다.

```go
// pool.go — Close()
p.closed = true
p.numOpen = 0  // ← 리셋

// pool.go — Acquire() (다른 goroutine)
for {
    p.mu.Lock()
    // ← p.closed 체크 없음!
    if p.numOpen < p.cfg.MaxConnections {  // 0 < 10 → true
        p.numOpen++
        p.mu.Unlock()
        conn, _ := p.newConn()  // 닫힌 풀에 새 연결 생성
        return conn, nil
    }
}
```

이후 `Release()`에서 `p.closed`를 보고 `numOpen--`를 수행하면 **카운터가 음수**가 된다.

### 수정

`Acquire()` for 루프의 Lock 직후에 `p.closed` 체크를 추가했다:

```go
var ErrPoolClosed = fmt.Errorf("connection pool: closed")

func (p *Pool) Acquire(ctx context.Context) (*Conn, error) {
    // ...
    for {
        p.mu.Lock()

        if p.closed {
            p.mu.Unlock()
            return nil, ErrPoolClosed
        }

        // 기존 idle/newConn 로직...
    }
}
```

단 3줄이지만, shutdown/reload 중 in-flight 요청이 stale 풀에서 연결을 생성하는 것을 완전히 차단한다.

---

## 소견 2: Hot Reload 시 credential 미갱신 (High)

### 문제

`DatabaseGroup.Reload()`에서:

1. **Writer pool은 아예 재생성하지 않았다** — 메서드에 writer 관련 코드가 없음
2. **동일 주소 reader pool은 그대로 재사용** — `newPools[addr] = p`

두 경우 모두 `DialFunc` 클로저가 생성 시점의 credential을 캡처하고 있어, 비밀번호 rotation 후에도 **구 자격증명으로 계속 연결**했다:

```go
// 생성 시점 — dbCfg.Backend.Password = "old-password"
wp, _ := pool.New(pool.Config{
    DialFunc: func() (net.Conn, error) {
        return pgConnect(addr, dbCfg.Backend.User, dbCfg.Backend.Password, ...)
        // ↑ 클로저가 "old-password"를 영구적으로 잡고 있음
    },
})

// Reload 후 — 새 config에 "new-password"가 들어와도
// 기존 pool의 DialFunc는 여전히 "old-password"로 연결
```

재시작 전까지 영구적으로 stale 상태가 되는 심각한 버그다.

### 수정

`Reload()`에서 credential 변경을 감지하고, 변경 시 pool을 재생성하도록 수정했다:

```go
func (g *DatabaseGroup) Reload(dbCfg config.DatabaseConfig, cbCfg config.CircuitBreakerConfig) {
    g.mu.Lock()
    defer g.mu.Unlock()

    oldCfg := g.backendCfg
    credChanged := oldCfg.User != dbCfg.Backend.User ||
        oldCfg.Password != dbCfg.Backend.Password ||
        oldCfg.Database != dbCfg.Backend.Database

    // Writer pool 재생성 (credential 변경 또는 주소 변경 시)
    newWriterAddr := fmt.Sprintf("%s:%d", dbCfg.Writer.Host, dbCfg.Writer.Port)
    if credChanged || newWriterAddr != g.writerAddr {
        if g.writerPool != nil {
            g.writerPool.Close()
        }
        g.writerPool = createWriterPool(newWriterAddr, dbCfg)
        g.writerAddr = newWriterAddr
    }

    // Reader pools — credential 변경 시 전부 재생성
    if credChanged {
        for _, p := range g.readerPools {
            p.Close()
        }
        // 모든 reader pool을 새 credential로 생성
    }
    // ...
}
```

핵심은 **credential 변경 감지**와 **구 pool의 graceful close**다.

---

## 소견 3: Admin IP Allowlist XFF Spoofing (Medium-High)

### 문제

`extractClientIP()`가 `X-Forwarded-For` 헤더를 **무조건 신뢰**했다:

```go
func extractClientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        parts := strings.SplitN(xff, ",", 2)
        return strings.TrimSpace(parts[0])  // 클라이언트가 임의 설정 가능
    }
    host, _, _ := net.SplitHostPort(r.RemoteAddr)
    return host
}
```

Admin API가 직접 노출된 환경에서 공격자가 `X-Forwarded-For: 10.0.0.1`만 넣으면 allowlist를 우회할 수 있었다.

### 수정

`trusted_proxies` 설정을 도입하고, **신뢰할 수 있는 프록시에서 온 요청만** XFF를 신뢰하도록 변경했다:

```go
func extractClientIP(r *http.Request, trustedProxies []string) string {
    host, _, _ := net.SplitHostPort(r.RemoteAddr)

    // trusted proxy에서 온 요청만 XFF 신뢰
    if len(trustedProxies) > 0 && isTrustedProxy(host, trustedProxies) {
        if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
            parts := strings.SplitN(xff, ",", 2)
            return strings.TrimSpace(parts[0])
        }
    }

    return host
}
```

**Secure default**: `trusted_proxies`가 비어있으면 XFF를 절대 신뢰하지 않는다. 기존 배포 환경에서 리버스 프록시를 사용하는 경우에만 명시적으로 설정해야 한다:

```yaml
admin:
  auth:
    enabled: true
    trusted_proxies: ["10.0.0.0/8"]  # 내부 LB 대역만 신뢰
    ip_allowlist: ["192.168.1.0/24"]
```

---

## 소견 4: Reader 장애 격리 미작동 (Medium)

### 문제

`balancer.MarkUnhealthy()`가 정의되어 있지만, **운영 코드에서 호출하는 곳이 없었다**.

```go
// balancer.go — 정의만 존재
func (r *RoundRobin) MarkUnhealthy(addr string) { ... }

// query_read.go — 에러 시 CB만 기록, MarkUnhealthy 미호출
if err != nil {
    if cb, ok := dbg.ReaderCB(readerAddr); ok {
        cb.RecordFailure()  // CB가 disabled면 아무 효과 없음
    }
    return s.fallbackToWriter(...)
}
```

`circuit_breaker.enabled` 기본값이 `false`이므로, 죽은 reader가 rotation에 **영구적으로 남아** 매 요청마다 fallback penalty를 냈다.

### 수정

reader 에러 경로 3개 파일에 `MarkUnhealthy()` 호출을 추가했다:

- **`query_read.go`**: Acquire 실패, Forward 실패, relay 실패 (4곳)
- **`query_extended.go`**: 동일 패턴 (7곳)
- **`dataapi/handler.go`**: executeOnPool 실패 (1곳)

```go
// query_read.go — 수정 후
rConn, err := rPool.Acquire(poolCtx)
if err != nil {
    dbg.balancer.MarkUnhealthy(readerAddr)  // ← 추가
    if cb, ok := dbg.ReaderCB(readerAddr); ok {
        cb.RecordFailure()
    }
    return s.fallbackToWriter(...)
}
```

`MarkUnhealthy`는 CB와 독립적으로 동작한다. CB가 비활성이어도 balancer의 health check 루프가 주기적으로 TCP probe를 보내 복구하므로, reader가 살아나면 자동으로 rotation에 복귀한다.

---

## 소견 5: Extended Protocol 캐시 write-only (Medium)

### 문제

Extended Query Protocol 경로에서 캐시를 **저장은 하지만 조회는 하지 않았다**:

```go
// query_extended.go — Set은 있지만
key := cache.WithNamespace(s.cacheKey(query, dbg.name), cache.NSExtended)
s.queryCache.Set(key, collected, tables)

// Get은 없다! handleExtendedRead() 시작부에 캐시 조회 로직이 누락
```

반면 Simple Query 경로(`query_read.go`)에는 제대로 된 Get → hit → early return이 있었다. Extended 캐시 엔트리는 **LRU 공간만 차지하고 hit는 절대 안 나는** 상태였다.

### 수정

`handleExtendedRead()` 시작부에 캐시 조회 로직을 추가했다:

```go
func (s *Server) handleExtendedRead(ctx context.Context, clientConn net.Conn,
    buf []*protocol.Message, syncMsg *protocol.Message, ...) error {

    // 캐시 조회 (추가)
    if s.queryCache != nil && len(buf) > 0 && buf[0].Type == protocol.MsgParse {
        _, query := protocol.ParseParseMessage(buf[0].Payload)
        key := cache.WithNamespace(s.cacheKey(query, dbg.name), cache.NSExtended)
        if cached := s.queryCache.Get(key); cached != nil {
            if s.metrics != nil {
                s.metrics.CacheHits.Inc()
            }
            _, err := clientConn.Write(cached)
            return err
        }
        if s.metrics != nil {
            s.metrics.CacheMisses.Inc()
        }
    }

    // 기존 backend 실행 로직...
}
```

`relayAndCollect`로 저장한 바이트에는 ReadyForQuery까지 포함되어 있으므로, 그대로 클라이언트에 Write하면 된다.

---

## 소견 6: sample_ratio: 0 설정 불가 (Medium-Low)

### 문제

```go
// config.go — applyDefaults()
if c.Telemetry.SampleRatio == 0 {
    c.Telemetry.SampleRatio = 1.0  // "미설정"으로 취급해 덮어씀
}

// telemetry.go — 이 분기에 도달 불가
} else if cfg.SampleRatio <= 0 {
    sampler = sdktrace.NeverSample()
}
```

YAML에서 `sample_ratio: 0`을 설정해도 `float64(0)`이 Go 제로값과 동일해 "미설정"으로 처리됐다. 프로덕션에서 트레이싱을 끄려면 `enabled: false` 대신 **sample_ratio: 0으로 수집만 안 하는** 전략을 쓸 수 있어야 한다.

### 수정

`SampleRatio`를 `*float64` 포인터로 변경해 nil(미설정)과 0(명시적)을 구분했다:

```go
type TelemetryConfig struct {
    Enabled     bool     `yaml:"enabled"`
    SampleRatio *float64 `yaml:"sample_ratio"`  // nil = 미설정, 0 = NeverSample
    // ...
}

// applyDefaults()
if c.Telemetry.SampleRatio == nil {
    defaultRatio := 1.0
    c.Telemetry.SampleRatio = &defaultRatio
}
```

Go의 `== 0` 제로값 패턴은 편리하지만, **"미설정"과 "명시적 0"을 구분해야 하는 경우**에는 포인터나 별도 `isSet` 플래그가 필요하다. YAML/JSON 설정에서 흔히 만나는 함정이다.

---

## 교훈

이번 QA 소견에서 공통적으로 드러난 패턴:

1. **클로저 캡처의 함정** — `DialFunc`가 생성 시점의 값을 영구적으로 잡고 있어 hot reload가 무력화
2. **상태 전이 누락** — `Close()` 후 `Acquire()`, healthy → unhealthy 전이 경로가 빠져있음
3. **Secure default 부재** — XFF를 무조건 신뢰하는 것은 "편의 기본값"이지 "안전 기본값"이 아님
4. **대칭성 검증** — 캐시 Set이 있으면 반드시 Get이 있어야 한다. write path만 있는 캐시는 메모리 낭비
5. **Go 제로값 함정** — `float64(0)`과 "미설정"은 다른 의미. 포인터 타입으로 구분 필요

이런 류의 버그는 단위 테스트로 잡기 어렵다. **코드 리뷰에서 "이 경로의 반대편은?"이라고 묻는 습관**이 가장 효과적인 방어선이다.

---

## 마무리

이번 글에서 수정한 것:

- Pool.Close() 이후 Acquire() race 방어 (`ErrPoolClosed`)
- Hot reload 시 credential 변경 감지 및 pool 재생성
- Admin IP allowlist의 XFF spoofing 방어 (`trusted_proxies`)
- Reader 장애 시 `MarkUnhealthy()` 호출로 즉시 격리
- Extended protocol 캐시에 read path 추가
- `sample_ratio: 0` 설정이 NeverSample로 정상 동작

6건 모두 **"동작은 하지만 edge case에서 깨지는"** 유형이다. 프로덕션에서 시간이 지나야 드러나는 종류라 QA 단계에서 잡은 것은 다행이다.
