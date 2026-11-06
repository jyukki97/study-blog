---
title: "Go로 PostgreSQL 프록시 만들기 (65) - Per-User / Per-IP Rate Limiting"
date: 2026-03-20
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Rate Limiting", "Multi-Tenancy"]
categories: ["Database"]
project: "pgmux"
description: "전역 Rate Limit만으로는 멀티테넌트 환경의 noisy neighbor를 막을 수 없다. 사용자별·IP별 독립 Token Bucket을 lazy 생성하고, TTL 기반으로 미사용 엔트리를 자동 정리하는 RateLimiterRegistry를 구현한다."
---

## 들어가며

[이전 글](/posts/2026-03-18-pgmux-64-active-session-dashboard/)에서 Active Session Dashboard를 구현하여 "누가 뭘 하는지" 볼 수 있게 되었다. 이번에는 "누가 너무 많이 하는지"를 제어한다.

pgmux에는 이미 Token Bucket 기반 전역 Rate Limiter가 있다. 문제는 **전역** 제한이라는 점이다. 초당 1,000 쿼리 제한을 걸면 사용자 A가 900개를 쓰고 사용자 B는 100개도 못 쓸 수 있다. 멀티테넌트 환경에서 전형적인 **noisy neighbor** 문제다.

이번 구현의 목표:

- 사용자별 독립 Rate Limit (`rate_limit.per_user`)
- 클라이언트 IP별 독립 Rate Limit (`rate_limit.per_ip`)
- 특정 사용자/IP에 차등 제한 (`overrides`)
- 미사용 엔트리 자동 정리 (메모리 누수 방지)

---

## 설계

### 3단계 Rate Limit 체크

요청이 허용되려면 세 가지 게이트를 모두 통과해야 한다:

```
쿼리 수신
  │
  ▼
[1. Global Rate Limit]  ← 전역 Token Bucket (기존)
  │ pass
  ▼
[2. Per-User Rate Limit] ← 사용자별 Token Bucket
  │ pass
  ▼
[3. Per-IP Rate Limit]   ← IP별 Token Bucket
  │ pass
  ▼
쿼리 처리 계속
```

어느 단계에서든 거부되면 `ERROR` + `ReadyForQuery('I')`를 보내고 다음 메시지를 기다린다. 커넥션을 끊지 않으므로 클라이언트는 재시도할 수 있다.

### RateLimiterRegistry: key별 독립 버킷

핵심 자료구조는 `RateLimiterRegistry`다. key(사용자명 또는 IP)를 받아 해당 key의 독립 Token Bucket을 반환하되, 없으면 lazy 생성한다.

```
Registry
  ├── "app_user"  → RateLimiter(rate=100, burst=50)
  ├── "admin_user" → RateLimiter(rate=200, burst=100)  ← override
  ├── "10.0.0.5"  → RateLimiter(rate=100, burst=50)
  └── (TTL 만료 시 자동 제거)
```

사용자는 auth 설정에서 정의되므로 수가 제한적이지만, IP는 NAT 환경에서 무한히 늘어날 수 있다. 따라서 **TTL 기반 eviction**이 필수다.

### 왜 sync.Map이 아닌 RWMutex + map인가

`sync.Map`은 읽기 위주에 최적화되어 있지만, Rate Limiter는 매 요청마다 **읽기 + 쓰기**(토큰 차감)가 함께 일어난다. 또한 eviction 시 순회하며 삭제해야 하므로, `RWMutex + map`이 더 단순하고 예측 가능하다.

---

## 핵심 구현

### RateLimiterRegistry

```go
type entry struct {
    limiter    *RateLimiter
    lastAccess atomic.Int64 // unix nano
}

type RateLimiterRegistry struct {
    mu           sync.RWMutex
    limiters     map[string]*entry
    defaultRate  float64
    defaultBurst int
    overrides    map[string]Override
    cleanupTTL   time.Duration
    stopCleanup  chan struct{}
}
```

`entry`는 Rate Limiter와 마지막 접근 시각을 함께 들고 있다. `lastAccess`는 `atomic.Int64`로 선언하여 읽기 경로에서 `entry` 수준의 락 없이 갱신한다.

### Allow: Double-Check Locking

```go
func (r *RateLimiterRegistry) Allow(key string) bool {
    // Fast path: read-lock lookup
    r.mu.RLock()
    e, ok := r.limiters[key]
    r.mu.RUnlock()

    if ok {
        e.touch()
        return e.limiter.Allow()
    }

    // Slow path: create new entry
    r.mu.Lock()
    // Double-check after acquiring write lock
    if e, ok = r.limiters[key]; ok {
        r.mu.Unlock()
        e.touch()
        return e.limiter.Allow()
    }

    rate, burst := r.defaultRate, r.defaultBurst
    if o, found := r.overrides[key]; found {
        rate, burst = o.Rate, o.Burst
    }

    e = &entry{limiter: NewRateLimiter(rate, burst)}
    e.touch()
    r.limiters[key] = e
    r.mu.Unlock()

    return e.limiter.Allow()
}
```

대부분의 요청은 **Fast path**(RLock → 조회 → touch → Allow)를 탄다. 새 사용자가 처음 접속할 때만 Slow path에서 Write Lock을 잡고 생성한다. Double-check로 동시 생성을 방지한다.

`overrides` 맵에 해당 key가 있으면 기본값 대신 커스텀 rate/burst를 적용한다. 이를 통해 VIP 사용자에게 더 높은 한도를 줄 수 있다.

### TTL 기반 Eviction

```go
func (r *RateLimiterRegistry) cleanupLoop() {
    ticker := time.NewTicker(r.cleanupTTL / 2)
    defer ticker.Stop()

    for {
        select {
        case <-r.stopCleanup:
            return
        case <-ticker.C:
            r.evict()
        }
    }
}

func (r *RateLimiterRegistry) evict() {
    cutoff := time.Now().Add(-r.cleanupTTL).UnixNano()
    r.mu.Lock()
    for key, e := range r.limiters {
        if e.lastAccess.Load() < cutoff {
            delete(r.limiters, key)
        }
    }
    r.mu.Unlock()
}
```

기본 TTL은 10분이다. 클린업 주기는 TTL의 절반(5분)으로, 최악의 경우 15분간 미사용 엔트리가 남을 수 있지만 메모리 영향은 무시할 수 있다. IP 기반 Rate Limiter에서 NAT 뒤의 수천 IP가 한 번 접속하고 사라지는 시나리오에서 이 eviction이 메모리 누수를 방지한다.

`Close()`는 `stopCleanup` 채널을 닫아 고루틴을 종료한다. config reload 시 old registry의 Close를 호출하여 고루틴 누수를 방지한다.

---

## 프록시 통합

### Server 필드

```go
type Server struct {
    rateLimitPtr    atomic.Pointer[resilience.RateLimiter]       // 전역
    perUserRLPtr    atomic.Pointer[resilience.RateLimiterRegistry] // 사용자별
    perIPRLPtr      atomic.Pointer[resilience.RateLimiterRegistry] // IP별
    // ...
}
```

기존 전역 Rate Limiter와 동일하게 `atomic.Pointer`를 사용한다. 읽기 경로에서 락 없이 접근하고, config reload 시 atomic swap으로 교체한다.

### 쿼리 루프 통합

`relayQueries`에서 기존 전역 체크 바로 뒤에 per-user, per-ip 체크를 추가한다:

```go
// Rate limit check — global
if rl := s.getRateLimiter(); rl != nil && !rl.Allow() {
    slog.Warn("rate limited", "scope", "global", "remote", clientConn.RemoteAddr())
    if s.metrics != nil {
        s.metrics.RateLimited.WithLabelValues("global").Inc()
    }
    s.sendError(clientConn, "too many requests")
    _ = protocol.WriteMessage(clientConn, protocol.MsgReadyForQuery, []byte{'I'})
    continue
}

// Rate limit check — per-user
if reg := s.perUserRLPtr.Load(); reg != nil && !reg.Allow(si.User) {
    slog.Warn("rate limited", "scope", "user", "user", si.User, ...)
    // ...
    continue
}

// Rate limit check — per-IP
if reg := s.perIPRLPtr.Load(); reg != nil {
    clientIP := extractIP(clientConn.RemoteAddr().String())
    if !reg.Allow(clientIP) {
        slog.Warn("rate limited", "scope", "ip", "ip", clientIP, ...)
        // ...
        continue
    }
}
```

`si.User`는 `SessionInfo`에서, 클라이언트 IP는 `clientConn.RemoteAddr()`에서 추출한다. `extractIP`는 `net.SplitHostPort`로 포트를 제거한다.

### Config Reload

```go
// Reload에서 per-user registry 교체
if newCfg.RateLimit.PerUser.Enabled {
    if old := s.perUserRLPtr.Swap(
        resilience.NewRateLimiterRegistry(buildRegistryConfig(...)),
    ); old != nil {
        old.Close() // cleanup 고루틴 종료
    }
} else {
    if old := s.perUserRLPtr.Swap(nil); old != nil {
        old.Close()
    }
}
```

새 registry를 생성하고 atomic swap 후 old registry의 `Close()`를 호출한다. old registry의 cleanup 고루틴이 종료되고, 기존 limiter 상태는 GC된다. 리로드 직후 모든 사용자의 토큰 버킷이 full burst로 시작하므로, 일시적인 burst가 발생할 수 있다.

---

## 설정 예시

```yaml
rate_limit:
  enabled: true
  rate: 1000                        # 전역 초당 허용 쿼리 수
  burst: 100                        # 전역 최대 버스트

  per_user:
    enabled: true
    default_rate: 100               # 사용자별 기본 초당 허용
    default_burst: 50               # 사용자별 기본 버스트
    overrides:
      - key: "batch_worker"         # 배치 워커에 높은 한도
        rate: 500
        burst: 200
      - key: "readonly_dashboard"   # 대시보드에 낮은 한도
        rate: 20
        burst: 10

  per_ip:
    enabled: true
    default_rate: 100
    default_burst: 50
    overrides:
      - key: "10.0.0.100"          # 내부 서비스 IP에 높은 한도
        rate: 500
        burst: 200
```

전역, per-user, per-ip 세 가지 Rate Limit은 **독립적으로** 활성화/비활성화할 수 있다. 전역만 켜도 되고, per-user만 켜도 된다.

---

## 메트릭

기존 `pgmux_rate_limited_total` Counter를 `scope` 라벨이 있는 CounterVec으로 변경했다:

| 메트릭 | 라벨 | 의미 |
|--------|------|------|
| `pgmux_rate_limited_total{scope="global"}` | - | 전역 Rate Limit 거부 |
| `pgmux_rate_limited_total{scope="user"}` | - | 사용자별 Rate Limit 거부 |
| `pgmux_rate_limited_total{scope="ip"}` | - | IP별 Rate Limit 거부 |

`scope` 라벨만 사용하고 `user`나 `ip` 값은 라벨에 넣지 않았다. 사용자명은 auth 설정에서 한정되어 카디널리티가 낮지만, IP는 무한히 늘어날 수 있다. Prometheus의 고카디널리티 라벨은 메모리 폭발의 원인이 되므로, 상세 정보는 `slog.Warn`에 기록하고 메트릭은 scope 수준으로 제한했다.

---

## 코드 리뷰에서 발견한 이슈 3건

| 심각도 | 이슈 | 수정 |
|--------|------|------|
| **Major** | gofmt 미준수 — struct tag 정렬에 수동 공백 추가 | `gofmt -w` 적용. Go Report Card 점수 하락 원인 |
| **Minor** | `RateLimited` Counter → CounterVec 변경 시 Data API 호출 미반영 | `dataapi/handler.go`의 `.Inc()` → `.WithLabelValues("global").Inc()` |
| **Minor** | IP 추출 시 `RemoteAddr()` 포트 포함 | `net.SplitHostPort`로 포트 분리하는 `extractIP` 헬퍼 추가 |

gofmt 이슈는 Go Report Card 점수를 74%까지 떨어뜨렸다. `gofmt`는 struct 필드의 타입과 태그 사이 공백을 **가장 긴 필드 기준**으로 자동 정렬하는데, 수동으로 맞추면 canonical format과 달라진다.

---

## 테스트

5개 유닛 테스트로 커버:

- **DefaultRateLimit** — 기본 rate/burst로 새 key 생성, burst 소진 후 거부
- **Override** — 특정 key에 커스텀 rate/burst 적용, default와 차이 확인
- **Eviction** — TTL 만료 후 엔트리 자동 제거
- **ConcurrentAccess** — 5개 key × 100회 동시 접근, race detector 통과
- **Len** — 동일 key 중복 접근 시 엔트리 수 증가하지 않음

기존 전역 Rate Limiter 테스트 3건, Circuit Breaker 테스트 6건과 함께 resilience 패키지 전체 14건 통과.

---

## 마치며

전역 Rate Limiter와 Per-Key Rate Limiter의 차이는 자료구조 하나다. 전역은 `*RateLimiter` 하나, Per-Key는 `map[string]*RateLimiter`에 lazy 생성과 TTL eviction을 얹은 것이다. 핵심 Token Bucket 알고리즘은 동일하게 재사용한다.

설계에서 가장 고민한 부분은 **메트릭 카디널리티**다. 사용자별 rate limit 거부를 `{user="app_user"}` 라벨로 추적하면 편리하지만, IP별까지 같은 방식을 적용하면 Prometheus 메모리가 터진다. 결국 메트릭은 `scope` 수준으로 제한하고 상세 정보는 로그로 남기는 방식을 택했다. 관측성 도구의 특성에 맞게 역할을 분리하는 것이 중요하다.

다음은 **Connection Warming**으로 프록시 시작 시 cold start 레이턴시를 완화할 예정이다.
