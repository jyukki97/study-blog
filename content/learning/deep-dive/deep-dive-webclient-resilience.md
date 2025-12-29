---
title: "WebClient 회복탄력성: 타임아웃·재시도·백프레셔"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["WebClient", "Timeout", "Retry", "Resilience", "Reactive"]
categories: ["Backend Deep Dive"]
description: "WebClient로 외부 API 호출 시 타임아웃/재시도/서킷 브레이커/백프레셔 설정 가이드"
module: "spring-core"
quizzes:
  - question: "외부 API 호출 시 타임아웃을 설정하지 않았을 때 발생할 수 있는 가장 치명적인 문제는?"
    options:
      - "CPU 사용률이 급격히 증가한다."
      - "데이터베이스 락(Lock)이 걸린다."
      - "응답이 오지 않는 연결이 스레드나 커넥션 풀을 점유하여, 결국 서비스 전체의 자원이 고갈된다."
      - "네트워크 대역폭이 소진된다."
    answer: 2
    explanation: "타임아웃이 없으면 상대 서버가 응답하지 않을 때 연결이 무한히 대기하게 되고, 이들이 쌓이면 스레드/DB 커넥션 풀을 모두 점유하여 서비스 전체가 응답 불능 상태에 빠집니다."

  - question: "WebClient에서 재시도(Retry) 패턴을 적용할 때, 일시적인 네트워크 오류나 서버 과부하를 악화시키지 않기 위해 필수적으로 함께 적용해야 하는 전략은?"
    options:
      - "무제한 재시도 (Endless Retry)"
      - "즉시 재시도 (Immediate Retry)"
      - "지수 백오프 (Exponential Backoff) 및 Jitter"
      - "동기식(Blocking) 재시도"
    answer: 2
    explanation: "즉시 재시도하거나 타이밍이 겹치면 'Retry Storm'이 발생하여 서버 부하를 가중시킵니다. 점진적으로 대기 시간을 늘리는 백오프와 랜덤성을 부여하는 Jitter가 필요합니다."

  - question: "서킷 브레이커(Circuit Breaker)의 상태 중, 시스템이 정상적으로 동작하여 요청을 통과시키는 상태는?"
    options:
      - "Open"
      - "Closed"
      - "Half-Open"
      - "Disabled"
    answer: 1
    explanation: "서킷 브레이커에서 `Closed` 상태는 전류가 흐르듯 요청이 정상적으로 처리되는 상태를 의미합니다. (장애 감지 시 `Open`되어 차단됨)"

  - question: "HTTP POST 요청과 같이 서버의 상태를 변경하는 API에 대해 재시도(Retry)를 적용할 때 주의해야 할 점은?"
    options:
      - "POST 요청은 절대 재시도하면 안 된다."
      - "반드시 모든 4xx, 5xx 에러에 대해 재시도해야 한다."
      - "API가 멱등성(Idempotency)을 보장하는지 확인하고, 그렇지 않다면 재시도를 신중히 하거나 피해야 한다."
      - "타임아웃을 매우 짧게 설정해야 한다."
    answer: 2
    explanation: "POST 요청은 멱등하지 않은 경우(예: 결제, 주문 생성)가 많으므로, 중복 실행 시 데이터 정합성이 깨질 수 있어 재시도 적용 시 매우 주의해야 합니다."

  - question: "외부 시스템의 장애가 나의 시스템 전체로 전파되는 것을 막기 위해, 외부 호출마다 별도의 스레드 풀이나 세마포어로 자원을 격리하는 패턴은?"
    options:
      - "Circuit Breaker"
      - "Rate Limiter"
      - "Bulkhead (격벽)"
      - "Time Limiter"
    answer: 2
    explanation: "`Bulkhead` 패턴은 선박의 격벽처럼 시스템을 여러 구획으로 나누어, 한 곳(외부 호출)에서 자원이 고갈되더라도 다른 기능은 정상 동작하도록 격리합니다."
study_order: 180
---

## 이 글에서 얻는 것

- 외부 API 호출에서 “느림/타임아웃/장애 전파”가 왜 터지는지, 그리고 무엇을 먼저 설정해야 하는지 기준이 생깁니다.
- WebClient에서 타임아웃(연결/응답), 재시도(백오프/멱등), 서킷 브레이커, 백프레셔를 실무 관점으로 구성할 수 있습니다.
- `block()` 남발, 무제한 재시도, 타임아웃 누락 같은 사고 패턴을 예방할 수 있습니다.

## 0) 외부 API 호출에서 가장 흔한 사고 3가지

1) **타임아웃이 없다** → 장애가 “끝없이 대기”로 번짐(스레드/커넥션 풀 고갈)  
2) **재시도가 무작정** → 더 큰 부하(폭풍 재시도)로 상대/내 서비스가 함께 죽음  
3) **격리/차단이 없다** → 의존 서비스 장애가 내 서비스 전체를 끌고 내려감  

그래서 기본 순서는 보통:

타임아웃 → 재시도(필요한 경우만) → 서킷 브레이커/벌크헤드 → 관측(메트릭/로그)

## 1) 타임아웃은 “종류”가 있다

타임아웃을 하나만 걸면 부족할 때가 많습니다.

- 연결(connect) 타임아웃: 연결 자체가 안 되는 상황을 빨리 실패
- 응답(response) 타임아웃: 응답이 늦는 상황을 제한
- 읽기/쓰기(read/write) 타임아웃: 바이트 스트림이 멈춘 상황을 제한(필요 시)

## 2) 기본 타임아웃 설정(예시)

```java
HttpClient httpClient = HttpClient.create()
    .responseTimeout(Duration.ofSeconds(3));

WebClient client = WebClient.builder()
    .clientConnector(new ReactorClientHttpConnector(httpClient))
    .build();
```

실무에서는 connect timeout도 함께 잡는 경우가 많습니다(예: 수백 ms~수 초).

## 3) 재시도/백오프: “멱등한 요청만, 제한적으로”

재시도는 강력하지만, 잘못 쓰면 장애를 키웁니다.

권장 기준:

- GET/HEAD 같이 멱등한 요청에 우선 적용
- POST라도 “멱등 키(idempotency key)”가 있거나, 서버가 중복 처리를 막는 경우에만 고려
- 짧은 backoff + jitter로 동시 재시도 폭풍을 완화

예시:

```java
Mono<Response> call() {
  return client.get().uri("/api")
      .retrieve()
      .bodyToMono(Response.class)
      .timeout(Duration.ofSeconds(2))
      .retryWhen(Retry.backoff(3, Duration.ofMillis(200))
          .filter(this::isRetryable));
}
```

`isRetryable`에는 보통 다음을 넣습니다.

- 5xx/네트워크 오류/타임아웃 같은 “일시적 실패”
- 4xx(특히 400/401/403)는 재시도해도 해결되지 않으므로 보통 제외

## 4) 서킷 브레이커: “상대가 죽었을 때 같이 죽지 않기”

서킷 브레이커는 실패율/슬로우 콜이 일정 임계치를 넘으면 호출을 빠르게 차단해서,
자원 고갈을 막고 회복 시간을 벌어줍니다.

WebClient(reactor)에서는 “block으로 감싸기”보다 **리액티브 연산자**로 적용하는 편이 자연스럽습니다.

예시(개념):

```java
Mono<Response> mono = client.get().uri("/api")
    .retrieve()
    .bodyToMono(Response.class);

return mono.transformDeferred(CircuitBreakerOperator.of(circuitBreaker));
```

## 5) 벌크헤드/격리: 외부 API가 내 서비스 전체를 잡아먹지 않게

외부 API 호출을 “전용 커넥션 풀/전용 타임아웃/전용 정책”으로 분리하면,
한 의존성이 흔들릴 때 다른 기능까지 같이 무너지는 것을 줄일 수 있습니다.

특히 팬아웃(동시에 여러 외부 API 호출)에서는 제한이 없으면 쉽게 자원이 고갈됩니다.

## 6) 백프레셔: 많이 받는다고 무조건 빨리 처리되는 게 아니다

리액티브에서는 다운스트림이 감당 가능한 만큼만 처리하도록(backpressure) 설계할 수 있습니다.
하지만 결국 “제한”이 없으면 메모리/큐가 커지고, 지연이 폭발합니다.

그래서 다음을 함께 설계합니다.

- 동시 호출 수 제한(concurrency)
- 타임아웃/재시도 상한
- 실패 시 fallback(가능한 경우)

## 7) 자주 하는 실수

- 타임아웃을 `timeout()` 하나로만 걸고, 연결 지연/커넥션 풀 고갈을 놓치는 경우
- 모든 요청에 재시도를 걸어서 상대 서비스에 폭풍을 만드는 경우
- 리액티브 체인 중간에 `block()`을 넣어 이벤트 루프를 막는 경우
- 에러 응답(4xx/5xx)을 “성공처럼” 처리해 장애를 늦게 발견하는 경우

## 연습(추천)

- 타임아웃을 없애고 부하를 걸어 “커넥션/스레드 고갈”이 어떻게 생기는지 관찰한 뒤, 타임아웃을 넣어 개선해보기
- 5xx에서만 재시도하도록 필터를 넣고, backoff/jitter를 적용해보기
- 서킷 브레이커를 붙이고, 의존 서비스가 죽었을 때 응답 지연이 어떻게 변하는지 비교해보기
