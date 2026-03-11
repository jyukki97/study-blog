---
title: "Go로 PostgreSQL 프록시 만들기 (11) - Circuit Breaker와 Rate Limiting"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Resilience", "Circuit Breaker", "Rate Limiting"]
categories: ["Database"]
description: "연쇄 장애를 차단하는 Circuit Breaker와 과부하를 방지하는 Token Bucket Rate Limiter를 구현한다."
---

## 들어가며

> "장애를 막을 수 없다면, 장애가 번지는 것을 막아야 한다."

DB가 느려지면 어떻게 될까? 커넥션 풀이 고갈되고, 대기 큐가 넘치고, 프록시를 거치는 모든 서비스가 동시에 멈춘다. 하나의 장애가 전체 시스템으로 **연쇄 전파(Cascading Failure)**된다.

이번 편에서 구현한 것:
1. Circuit Breaker — 장애 감지 시 요청을 빠르게 실패시켜 백엔드를 보호
2. Token Bucket Rate Limiter — 초당 요청 수를 제한하여 과부하 방지
3. Prometheus 메트릭 연동

## ⚡ Circuit Breaker

### 상태 머신

Circuit Breaker는 전기 차단기에서 영감을 받은 패턴이다. 세 가지 상태를 순환한다:

```
     성공률 정상        에러율 ≥ threshold
  ┌──── Closed ────────────► Open ◄──┐
  │      (정상)                (차단)  │ 실패
  │         ▲                   │     │
  │         │ N회 연속 성공      │     │
  │         │                   ▼     │
  │         └──────────── Half-Open ──┘
  │                       (시험 통과)
  └────────────────────────────────────┘
```

- **Closed**: 정상 운영. 모든 요청 허용. 에러율을 윈도우 단위로 측정.
- **Open**: 차단 상태. 모든 요청 즉시 실패. `openDuration` 후 Half-Open으로 전이.
- **Half-Open**: 제한된 수의 요청만 허용. 성공하면 Closed로, 실패하면 다시 Open으로.

### 구현

```go
type CircuitBreaker struct {
    cfg        BreakerConfig
    mu         sync.Mutex
    state      State
    successes  int
    failures   int
    total      int
    openedAt   time.Time
    halfOpenOK int
}

func (cb *CircuitBreaker) Allow() error {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    switch cb.state {
    case StateClosed:
        return nil
    case StateOpen:
        if time.Since(cb.openedAt) >= cb.cfg.OpenDuration {
            cb.state = StateHalfOpen
            cb.halfOpenOK = 0
            return nil  // 시험 요청 허용
        }
        return fmt.Errorf("circuit breaker is open")
    case StateHalfOpen:
        return nil
    }
    return nil
}
```

### Rolling Window 평가

에러율을 판단하는 핵심 로직:

```go
func (cb *CircuitBreaker) evaluateWindow() {
    if cb.total < cb.cfg.WindowSize {
        return  // 윈도우가 안 찼으면 판단하지 않음
    }
    errorRate := float64(cb.failures) / float64(cb.total)
    if errorRate >= cb.cfg.ErrorThreshold {
        cb.state = StateOpen
        cb.openedAt = time.Now()
    }
    cb.resetCounters()  // 윈도우 리셋 (트립 여부와 무관)
}
```

여기서 중요한 설계 결정: **evaluateWindow는 RecordSuccess와 RecordFailure 모두에서 호출**한다.

처음에는 RecordSuccess에서 `maybeResetWindow()`, RecordFailure에서 `maybeTrip()`을 분리했다가 버그가 발생했다:

```
Window: [성공, 성공, 성공, 실패, 실패, 실패, 실패, 실패, 실패, 성공(10번째)]
                                                                 ↑
                                                        마지막이 성공이면
                                                        maybeResetWindow() → 카운터 리셋
                                                        maybeTrip()은 호출되지 않음!
```

윈도우의 마지막 요청이 성공이면 카운터가 먼저 리셋되어 트립을 놓친다. 해결책은 **하나의 함수에서 "평가 → 트립 판단 → 리셋"을 원자적으로 수행**하는 것이다.

### Half-Open 복구

```go
func (cb *CircuitBreaker) RecordSuccess() {
    switch cb.state {
    case StateHalfOpen:
        cb.halfOpenOK++
        if cb.halfOpenOK >= cb.cfg.HalfOpenMax {
            cb.state = StateClosed    // 충분한 성공 → 정상 복구
            cb.resetCounters()
        }
    }
}

func (cb *CircuitBreaker) RecordFailure() {
    switch cb.state {
    case StateHalfOpen:
        cb.state = StateOpen          // 하나라도 실패 → 다시 차단
        cb.openedAt = time.Now()
    }
}
```

Half-Open에서는 보수적으로 판단한다. N회 연속 성공이면 복구, **1회라도 실패하면 즉시 다시 Open**. 불안정한 백엔드에 트래픽을 보내는 것보다 빠른 실패가 낫다.

### 프록시 통합

Writer와 각 Reader에 독립된 Circuit Breaker를 할당한다:

```go
// Writer CB 체크
func (s *Server) acquireWriterConn(ctx context.Context, bound *pool.Conn) (*pool.Conn, bool, error) {
    if s.writerCB != nil {
        if err := s.writerCB.Allow(); err != nil {
            return nil, false, fmt.Errorf("writer circuit breaker open: %w", err)
        }
    }
    conn, err := s.writerPool.Acquire(ctx)
    if err != nil {
        if s.writerCB != nil {
            s.writerCB.RecordFailure()
        }
        return nil, false, err
    }
    return conn, true, nil
}
```

쿼리 성공 시 `RecordSuccess()`, 실패 시 `RecordFailure()`를 호출한다. CB가 Open이면 풀 Acquire 자체를 시도하지 않으므로, 이미 문제가 있는 백엔드에 커넥션 시도가 쌓이는 것을 방지한다.

## 🪣 Token Bucket Rate Limiter

### 알고리즘

```
초당 rate개의 토큰이 버킷에 추가됨
버킷 최대 용량 = burst
요청 시 토큰 1개 소비
토큰 없으면 거부
```

```go
type RateLimiter struct {
    mu       sync.Mutex
    rate     float64   // 초당 토큰 추가량
    burst    int       // 버킷 최대 용량
    tokens   float64   // 현재 토큰 수
    lastTime time.Time // 마지막 리필 시각
}

func (rl *RateLimiter) Allow() bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()

    now := time.Now()
    elapsed := now.Sub(rl.lastTime).Seconds()
    rl.lastTime = now

    // 경과 시간만큼 토큰 리필
    rl.tokens += elapsed * rl.rate
    if rl.tokens > float64(rl.burst) {
        rl.tokens = float64(rl.burst)
    }

    if rl.tokens >= 1.0 {
        rl.tokens--
        return true
    }
    return false
}
```

Token Bucket의 장점:
- **burst 허용**: 순간적으로 burst만큼의 요청을 한꺼번에 처리 가능
- **평균 rate 제어**: 장기적으로는 초당 rate개의 요청만 통과
- **구현이 단순**: 타이머나 슬라이딩 윈도우 없이 `elapsed * rate`로 리필

### 프록시 통합

```go
// 쿼리 루프 내부
if s.rateLimiter != nil && !s.rateLimiter.Allow() {
    slog.Warn("rate limited", "remote", clientConn.RemoteAddr())
    if s.metrics != nil {
        s.metrics.RateLimited.Inc()
    }
    s.sendError(clientConn, "too many requests")
    protocol.WriteMessage(clientConn, protocol.MsgReadyForQuery, []byte{'I'})
    continue
}
```

Rate limit에 걸리면 **ErrorResponse + ReadyForQuery**를 보낸다. ReadyForQuery를 보내야 클라이언트가 다음 쿼리를 보낼 수 있다 — 안 보내면 클라이언트가 영원히 응답을 기다린다.

### 설정

```yaml
circuit_breaker:
  enabled: true
  error_threshold: 0.5    # 50% 에러율에서 트립
  open_duration: 10s      # Open 유지 시간
  half_open_max: 3        # Half-Open에서 필요한 성공 횟수
  window_size: 10         # 에러율 측정 윈도우

rate_limit:
  enabled: true
  rate: 1000              # 초당 1000 요청
  burst: 100              # 순간 최대 100 요청
```

## 📊 Prometheus 메트릭

```go
// metrics.go
RateLimited: prometheus.NewCounter(prometheus.CounterOpts{
    Name: "pgmux_rate_limited_total",
    Help: "Total number of rate-limited requests",
}),
```

`pgmux_rate_limited_total`이 급증하면 rate 설정을 올리거나, 클라이언트의 쿼리 패턴을 점검해야 한다는 신호다.

## 배운 점

1. **Circuit Breaker는 "빠른 실패"의 구현체** — 느린 실패보다 빠른 실패가 낫다. 30초 타임아웃을 기다리는 것보다 즉시 에러를 반환하는 것이 시스템 전체에 이롭다.
2. **상태 머신 설계에서 원자성이 핵심** — evaluateWindow의 "평가 → 트립 → 리셋"을 분리하면 race condition이 생긴다. 하나의 함수에서 원자적으로 처리해야 한다.
3. **Token Bucket은 burst를 자연스럽게 허용** — 고정 윈도우 카운터와 달리, 순간적인 트래픽 급증을 burst 범위 내에서 수용하면서도 장기 평균을 제어할 수 있다.
4. **Rate Limit 응답에는 반드시 ReadyForQuery가 필요** — PG 프로토콜에서 클라이언트는 ReadyForQuery를 받아야 다음 쿼리를 보낸다. 이걸 빠뜨리면 커넥션이 교착 상태에 빠진다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
