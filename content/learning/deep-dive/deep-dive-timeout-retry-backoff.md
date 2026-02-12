---
title: "Timeout/Retry/Backoff 설계: 장애 전파를 막는 3종 세트"
date: 2026-02-12
draft: false
topic: "Resilience"
tags: ["Timeout", "Retry", "Backoff", "Resilience4j", "HTTP"]
categories: ["Backend Deep Dive"]
description: "타임아웃/재시도/백오프를 잘못 설정했을 때 발생하는 장애 전파를 막는 실무 기준과 Spring 예제"
module: "resilience"
study_order: 520
---

## 이 글에서 얻는 것

- 타임아웃/재시도가 **장애를 키우는 이유**를 설명할 수 있습니다.
- “몇 번 재시도, 얼마나 기다릴지”를 **근거 기반**으로 정할 수 있습니다.
- Spring 환경에서 **실제 설정/코드**로 적용하는 방법을 익힙니다.

---

## 1) 문제의 시작: 재시도 폭탄

- 외부 API가 500ms → 5s로 느려짐
- 우리 서비스가 3회 재시도
- 1초에 1,000 요청이면 **실제 호출은 3,000**

> 장애는 ‘느림’으로 시작해 ‘재시도’로 폭발합니다.

---

## 2) 실무 기준 (Rule of Thumb)

### ✅ Timeout
- **P95 + 여유 20~30%**
- DB 호출: 100~300ms, 외부 API: 500~1500ms (서비스 특성에 맞춰 조정)

### ✅ Retry
- **읽기 요청**에 제한적으로 사용
- **idempotent**(멱등)한 요청만
- 최대 2~3회, **jitter** 포함

### ✅ Backoff
- 고정 지연보다 **지수 백오프 + 랜덤 지터**
- 동시 재시도 폭발 방지

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
  timelimiter:
    instances:
      paymentApi:
        timeoutDuration: 800ms
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
        .filter(this::isRetryable));
```

### Retry 조건 필터
```java
private boolean isRetryable(Throwable ex) {
    return ex instanceof TimeoutException
        || ex instanceof ConnectException
        || ex instanceof WebClientResponseException.TooManyRequests;
}
```

---

## 자주 하는 실수

- 모든 요청에 무조건 재시도 적용 → **중복 결제/중복 주문**
- 타임아웃 없이 무제한 대기 → **스레드 풀 고갈**
- 백오프 없이 즉시 재시도 → **장애 전파 증폭**

---

## 연습

1. “외부 결제 API가 느려졌을 때”의 타임아웃/재시도 정책을 문서화해보세요.
2. 재시도 대상과 비대상(멱등 여부)을 분류해보세요.
3. 실제 장애 시나리오에서 **재시도 횟수 × 요청 수**가 어떻게 폭증하는지 계산해보세요.
