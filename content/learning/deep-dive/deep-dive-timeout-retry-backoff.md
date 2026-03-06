---
title: "Timeout/Retry/Backoff 설계: 장애 전파를 막는 3종 세트"
date: 2026-02-12
draft: false
topic: "Resilience"
tags: ["Timeout", "Retry", "Backoff", "Resilience4j", "HTTP", "Circuit Breaker"]
categories: ["Backend Deep Dive"]
description: "타임아웃/재시도/백오프를 잘못 설정했을 때 발생하는 장애 전파를 막는 실무 기준과 Spring 예제"
module: "resilience"
study_order: 520
---

## 이 글에서 얻는 것

- 타임아웃/재시도가 **장애를 키우는 이유**를 설명할 수 있습니다.
- "몇 번 재시도, 얼마나 기다릴지"를 **근거 기반**으로 정할 수 있습니다.
- Spring 환경에서 **실제 설정/코드**로 적용하는 방법을 익힙니다.
- Circuit Breaker와 연계한 **종합 방어 전략**을 설계할 수 있습니다.
- 운영 환경에서 **모니터링하고 튜닝**하는 방법을 알게 됩니다.

---

## 1) 문제의 시작: 재시도 폭탄

외부 API가 500ms → 5s로 느려지는 상황을 가정합니다.

- 우리 서비스가 3회 재시도
- 1초에 1,000 요청이면 **실제 호출은 3,000**
- 5초 타임아웃 × 3회 = 요청 하나에 **최대 15초** 대기
- 이 사이 스레드 풀이 가득 차고, 우리 서비스도 응답 불가

> 장애는 '느림'으로 시작해 '재시도'로 폭발합니다.

### 실제 장애 시나리오

```
[정상 상태]
결제 서비스 → 외부 PG API (P95: 300ms, 성공률 99.9%)

[장애 시작]
PG 서버 GC → P95: 3초로 증가 → 성공률 95%로 하락

[재시도 폭탄]
1,000 req/s × 3회 재시도 = 3,000 req/s → PG 과부하 심화
→ 결제 서비스 스레드 풀 200개 전부 대기 상태
→ 결제 외 기능(주문조회, 장바구니)도 응답 불가
→ 전체 서비스 장애 (Cascading Failure)
```

이 사례의 핵심 교훈: **재시도는 "복구"가 아니라 "부하 증폭"**입니다. 상대방이 이미 과부하일 때 더 많은 요청을 보내면 회복을 방해합니다.

---

## 2) 실무 기준 (Rule of Thumb)

### ✅ Timeout — "얼마나 기다릴 것인가"

| 호출 대상 | 권장 타임아웃 | 근거 |
|---|---|---|
| 내부 DB 쿼리 | 100~300ms | P95 기준 + 여유 30% |
| 내부 마이크로서비스 | 300~800ms | 네트워크 지연 포함 |
| 외부 API (PG, 배송 등) | 500~2,000ms | SLA 기준으로 설정 |
| 배치/비동기 작업 | 별도 관리 | 동기 타임아웃과 분리 |

**설정 원칙:**
- P95 응답 시간을 기준으로 **20~30% 여유**를 둡니다.
- 타임아웃은 **항상 설정**합니다. 기본값(무제한)에 의존하면 스레드 풀이 고갈됩니다.
- Connection Timeout과 Read Timeout을 **분리** 설정합니다.

```java
// ❌ 나쁜 예: 타임아웃 없음
RestTemplate restTemplate = new RestTemplate();

// ✅ 좋은 예: Connection + Read 타임아웃 분리
SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(300);  // 연결 타임아웃 300ms
factory.setReadTimeout(800);      // 읽기 타임아웃 800ms
RestTemplate restTemplate = new RestTemplate(factory);
```

### ✅ Retry — "몇 번 다시 할 것인가"

**재시도 대상 판별 체크리스트:**

1. ✅ **멱등(Idempotent)한 요청인가?** — GET, 상태 조회, 이미 idempotency key가 있는 POST
2. ✅ **일시적(Transient) 오류인가?** — 503, 429, 타임아웃, 네트워크 순단
3. ❌ **비즈니스 오류인가?** — 400, 401, 404, 422는 재시도해도 결과가 같음
4. ❌ **비멱등 쓰기인가?** — 중복 결제, 중복 주문 위험

**최대 재시도 횟수: 2~3회.** 그 이상은 효과 없이 부하만 증가시킵니다.

### ✅ Backoff — "재시도 간격을 어떻게 늘릴 것인가"

```
고정 지연(Fixed):    200ms → 200ms → 200ms    (동시 폭발 위험)
지수 백오프:         200ms → 400ms → 800ms    (간격 증가, 동시성 여전)
지수 + Jitter:      237ms → 412ms → 891ms    (간격 + 분산 = 최선)
```

**Jitter가 필요한 이유:** 100개의 클라이언트가 동시에 실패하면, 고정 간격으로는 재시도도 동시에 발생합니다. 랜덤 지연을 추가해야 "재시도 폭발(Thundering Herd)"을 방지합니다.

---

## 3) Resilience4j 설정 예시

```yaml
resilience4j:
  retry:
    instances:
      paymentApi:
        maxAttempts: 3
        waitDuration: 200ms
        exponentialBackoffMultiplier: 2.0
        jitter: 0.2
        retryExceptions:
          - java.util.concurrent.TimeoutException
          - java.net.ConnectException
          - org.springframework.web.client.HttpServerErrorException
        ignoreExceptions:
          - org.springframework.web.client.HttpClientErrorException
  timelimiter:
    instances:
      paymentApi:
        timeoutDuration: 800ms
        cancelRunningFuture: true
```

### Retry + Circuit Breaker 연계

Retry만으로는 부족합니다. 상대 서비스가 완전히 죽은 상태에서 계속 재시도하면 의미 없는 부하만 발생합니다. **Circuit Breaker가 "이제 그만 보내"를 결정**합니다.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentApi:
        slidingWindowType: COUNT_BASED
        slidingWindowSize: 20
        failureRateThreshold: 50      # 실패율 50% 넘으면 OPEN
        waitDurationInOpenState: 10s   # 10초 대기 후 HALF_OPEN
        permittedNumberOfCallsInHalfOpenState: 5
        slowCallDurationThreshold: 1000ms
        slowCallRateThreshold: 80      # 느린 호출 80% 넘으면 OPEN
```

**적용 순서가 중요합니다:**
```
요청 → [TimeLimiter] → [CircuitBreaker] → [Retry] → 외부 호출
```

Retry가 안쪽에 있어야 CircuitBreaker가 **재시도까지 포함한 실패율**을 정확하게 집계합니다. 반대로 하면 CircuitBreaker가 무의미해집니다.

```java
@CircuitBreaker(name = "paymentApi", fallbackMethod = "fallbackCharge")
@TimeLimiter(name = "paymentApi")
@Retry(name = "paymentApi")
public CompletableFuture<PaymentResult> charge(PaymentRequest request) {
    return CompletableFuture.supplyAsync(() -> paymentClient.charge(request));
}

private CompletableFuture<PaymentResult> fallbackCharge(PaymentRequest request, Throwable t) {
    log.warn("결제 API 장애, fallback 처리: {}", t.getMessage());
    return CompletableFuture.completedFuture(PaymentResult.pendingManualReview(request));
}
```

---

## 4) Spring WebClient 예시

```java
WebClient client = WebClient.builder()
    .baseUrl("https://payment.api")
    .build();

Mono<PaymentResult> call = client.post()
    .uri("/charge")
    .bodyValue(request)
    .retrieve()
    .bodyToMono(PaymentResult.class)
    .timeout(Duration.ofMillis(800))
    .retryWhen(Retry.backoff(2, Duration.ofMillis(200))
        .jitter(0.2)
        .filter(this::isRetryable)
        .onRetryExhaustedThrow((spec, signal) ->
            new PaymentTimeoutException("결제 API 재시도 초과", signal.failure())));
```

### Retry 조건 필터

```java
private boolean isRetryable(Throwable ex) {
    if (ex instanceof TimeoutException) return true;
    if (ex instanceof ConnectException) return true;
    if (ex instanceof WebClientResponseException wcre) {
        int status = wcre.getStatusCode().value();
        // 503 Service Unavailable, 429 Too Many Requests만 재시도
        return status == 503 || status == 429;
    }
    return false;
}
```

---

## 5) Retry Budget: 전체 재시도량 제한

개별 요청의 재시도 횟수를 제한해도, 전체 트래픽이 높으면 **재시도 총량**이 여전히 위험할 수 있습니다.

**Retry Budget** 개념: 전체 요청 중 재시도가 차지하는 비율을 **20% 이하**로 제한합니다.

```
정상: 1,000 req/s, 재시도 0 → 총 1,000 req/s (재시도 비율 0%)
장애: 1,000 req/s, 재시도 200 → 총 1,200 req/s (재시도 비율 16.7% ✅)
폭발: 1,000 req/s, 재시도 2,000 → 총 3,000 req/s (재시도 비율 66.7% ❌ 차단!)
```

구현 방식:
- **gRPC**: 빌트인 retry throttling 지원 (`maxTokens`, `tokenRatio`)
- **HTTP**: 슬라이딩 윈도우 카운터로 직접 구현하거나, Resilience4j의 `BulkHead`로 동시 호출 수 자체를 제한

```java
// Bulkhead로 동시 호출 수 제한 (간접적 Retry Budget)
@Bulkhead(name = "paymentApi", type = Bulkhead.Type.SEMAPHORE)
@CircuitBreaker(name = "paymentApi")
@Retry(name = "paymentApi")
public PaymentResult charge(PaymentRequest request) {
    return paymentClient.charge(request);
}
```

```yaml
resilience4j:
  bulkhead:
    instances:
      paymentApi:
        maxConcurrentCalls: 50        # 동시 최대 50개
        maxWaitDuration: 100ms        # 50개 초과 시 100ms만 대기
```

---

## 6) 모니터링: 재시도가 건강한지 확인하기

재시도 설정을 배포한 뒤 **반드시 모니터링**해야 합니다. 재시도가 늘어나는 건 곧 외부 의존성에 문제가 생겼다는 신호입니다.

### 핵심 메트릭

| 메트릭 | 의미 | 알림 기준 |
|---|---|---|
| `resilience4j_retry_calls_total{kind="successful_without_retry"}` | 재시도 없이 성공 | — |
| `resilience4j_retry_calls_total{kind="successful_with_retry"}` | 재시도 후 성공 | 비율 5% 초과 시 경고 |
| `resilience4j_retry_calls_total{kind="failed_with_retry"}` | 재시도 후에도 실패 | 즉시 알림 |
| `resilience4j_circuitbreaker_state` | 서킷 상태 (0=CLOSED, 1=OPEN) | OPEN 전환 시 알림 |
| `resilience4j_timelimiter_calls_total{kind="timeout"}` | 타임아웃 발생 횟수 | 급증 시 알림 |

### Grafana 알림 예시 (PromQL)

```promql
# 재시도 비율이 10%를 넘으면 경고
sum(rate(resilience4j_retry_calls_total{kind=~".*_with_retry"}[5m]))
/
sum(rate(resilience4j_retry_calls_total[5m])) > 0.1
```

---

## 7) 의사결정 플로우차트

외부 호출에 Timeout/Retry/Backoff를 설정할 때 아래 순서로 결정합니다:

```
1. 이 호출에 타임아웃이 설정되어 있는가?
   └─ No → 즉시 설정 (P95 × 1.3)

2. 이 요청은 멱등한가?
   └─ No → 재시도 금지, 타임아웃만 적용
   └─ Yes ↓

3. 실패 원인이 일시적(Transient)인가?
   └─ No (400, 401 등) → 재시도 금지
   └─ Yes ↓

4. 지수 백오프 + Jitter로 최대 2~3회 재시도 설정

5. Circuit Breaker 연계 (실패율 50% 이상 → 호출 차단)

6. Bulkhead로 동시 호출 수 제한 (Retry Budget 간접 구현)

7. 모니터링 메트릭 + 알림 설정
```

---

## 자주 하는 실수 (체크리스트)

- ❌ 모든 요청에 무조건 재시도 적용 → **중복 결제/중복 주문**
- ❌ 타임아웃 없이 무제한 대기 → **스레드 풀 고갈**
- ❌ 백오프 없이 즉시 재시도 → **장애 전파 증폭 (Thundering Herd)**
- ❌ 4xx 에러에 재시도 → **의미 없는 부하 + 로그 오염**
- ❌ Circuit Breaker 없이 Retry만 → 죽은 서비스에 끝없이 재시도
- ❌ 재시도 메트릭 미수집 → 장애 징후를 놓침
- ❌ Connection Timeout / Read Timeout 미분리 → 원인 파악 불가

---

## 연습

1. "외부 결제 API가 느려졌을 때"의 타임아웃/재시도 정책을 문서화해보세요.
2. 재시도 대상과 비대상(멱등 여부)을 분류해보세요.
3. 실제 장애 시나리오에서 **재시도 횟수 × 요청 수**가 어떻게 폭증하는지 계산해보세요.
4. Resilience4j의 Retry + CircuitBreaker + TimeLimiter를 조합한 설정을 작성하고, 적용 순서가 맞는지 확인해보세요.
5. 재시도 비율을 모니터링하는 PromQL 쿼리를 작성해보세요.

---

## 관련 글

- [Circuit Breaker & Fallback 패턴](/learning/deep-dive/deep-dive-webclient-resilience/)
- [멱등성(Idempotency) 설계](/learning/deep-dive/deep-dive-idempotency/)
- [Prometheus + Grafana 모니터링](/learning/deep-dive/deep-dive-prometheus-grafana/)
- [Connection Pool 관리](/learning/deep-dive/deep-dive-connection-pool/)
