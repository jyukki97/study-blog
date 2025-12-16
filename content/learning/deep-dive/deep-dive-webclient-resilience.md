---
title: "WebClient 회복탄력성: 타임아웃·재시도·백프레셔"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["WebClient", "Timeout", "Retry", "Resilience", "Reactive"]
categories: ["Backend Deep Dive"]
description: "WebClient로 외부 API 호출 시 타임아웃/재시도/서킷 브레이커/백프레셔 설정 가이드"
module: "spring-core"
study_order: 25
---

## 기본 타임아웃 설정

```java
HttpClient httpClient = HttpClient.create()
    .responseTimeout(Duration.ofSeconds(3));

WebClient client = WebClient.builder()
    .clientConnector(new ReactorClientHttpConnector(httpClient))
    .build();
```

## 재시도/백오프

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

## 서킷 브레이커(Resilience4j 예)

```java
return decorator.executeSupplier(
    () -> client.get().uri("/api").retrieve().bodyToMono(Response.class).block()
);
```

## 체크리스트

- [ ] 커넥션/응답 타임아웃 별도 설정, 무제한 금지
- [ ] 재시도는 idempotent 요청만, 백오프/최대 시도 제한
- [ ] 서킷 브레이커/버퍼 크기 설정으로 백프레셔 적용
- [ ] 로그/메트릭으로 외부 API 실패율 모니터링
