---
title: "WebFlux vs MVC 선택 가이드"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["WebFlux", "Spring MVC", "Reactive", "비동기"]
categories: ["Backend Deep Dive"]
description: "Reactive 필요성 판단 기준, 스레드 모델 차이, 적용/비적용 시나리오 정리"
module: "spring-core"
study_order: 170
---

## 이 글에서 얻는 것

- Spring MVC와 WebFlux의 차이를 “비동기/논블로킹”이라는 단어가 아니라 **실행 모델(스레드/이벤트 루프)** 로 설명할 수 있습니다.
- 내 서비스가 WebFlux가 필요한지(또는 오히려 해로운지) 판단하는 기준을 가질 수 있습니다.
- WebFlux를 쓸 때 가장 많이 터지는 문제(블로킹 혼입, 스케줄러/풀 고갈, 디버깅 난이도)를 예방할 수 있습니다.

## 0) 결론부터: WebFlux는 “더 빠른 MVC”가 아니다

WebFlux는 “동시 I/O” 상황에서 스레드를 효율적으로 쓰기 위한 모델입니다.
CRUD 위주의 일반적인 서비스에서 JDBC/JPA(블로킹)를 쓰는 경우라면, MVC가 더 단순하고 실수도 적습니다.

## 1) 실행 모델 차이: Thread-per-request vs Event-loop

### Spring MVC(서블릿)

- 요청이 들어오면 톰캣/서블릿 스레드가 할당됩니다.
- DB/외부 API 호출이 블로킹이면 스레드는 그동안 “대기”합니다.
- 스레드 풀 크기가 곧 동시 처리량의 상한이 되기 쉽습니다.

### Spring WebFlux(리액터/네티)

- 이벤트 루프(적은 수의 스레드)가 I/O 이벤트를 처리합니다.
- 논블로킹 I/O를 전제로 “대기 중인 요청”이 스레드를 붙잡지 않습니다.
- 대신 코드가 `Mono/Flux` 체인으로 바뀌고, 디버깅/문맥 전파가 어려워질 수 있습니다.

## 2) 언제 WebFlux가 적합한가

대체로 아래 조건이 강할수록 WebFlux가 의미가 있습니다.

- 요청이 **I/O 바운드**(외부 API 팬아웃, 스트리밍, SSE/WebSocket)
- 동시 접속이 매우 크고, 스레드가 “대기”에 많이 묶이는 구조
- 의존 라이브러리/드라이버가 **논블로킹**(예: WebClient, R2DBC 등)

## 3) 언제 WebFlux가 비적합한가

- 무거운 CPU 작업이 많은 경우(논블로킹이 이득을 못 줌)
- DB 접근이 JDBC/JPA처럼 블로킹인데, 이를 그대로 억지로 WebFlux에 섞는 경우
- 팀이 리액티브 모델에 익숙하지 않아 운영/디버깅 리스크가 큰 경우

## 4) “블로킹 혼입”이 왜 치명적인가

WebFlux의 이벤트 루프는 “짧은 작업”을 빠르게 처리하는 전제 위에서 돌아갑니다.
그런데 이벤트 루프에서 블로킹이 발생하면, 다른 요청까지 함께 밀리기 시작합니다.

그래서 블로킹 작업이 불가피하면 **격리**가 필요합니다.

```java
Mono<Profile> profile = webClient.get()
    .uri("/profiles/{id}", id)
    .retrieve()
    .bodyToMono(Profile.class);
```

만약 블로킹 호출(파일 IO/레거시 SDK 등)을 써야 한다면:

```java
Mono<Result> result = Mono.fromCallable(() -> legacyBlockingCall())
    .subscribeOn(Schedulers.boundedElastic());
```

주의: “우회”는 해결이 아니라 비용 지불입니다. `boundedElastic`의 풀 크기/큐가 커지면 결국 병목이 생깁니다.

## 5) 선택 기준을 단순화한 체크 포인트(실전)

- 우리 서비스 병목이 “스레드 대기”인가? (외부 I/O 팬아웃, 스트리밍)
- 논블로킹 스택으로 끝까지 갈 수 있나? (DB: R2DBC, 외부: WebClient)
- 운영 관측(메트릭/트레이싱)과 디버깅을 감당할 준비가 됐나?

## 6) 테스트/디버깅 팁

- 리액티브 시퀀스는 `StepVerifier`로 검증(완료/에러/시간 제어)
- 체인이 길어지면 메서드 추출로 “의도”를 드러내고, 중간 연산에 로깅/계측을 넣어 가시성을 확보
- MDC/ThreadLocal 기반 로깅은 리액터에서 깨질 수 있어 “컨텍스트 전파”를 따로 고려해야 합니다

## 연습(추천)

- 외부 API 10개를 동시에 호출하는 팬아웃 예제를 MVC(동기) vs WebFlux(논블로킹)로 만들어 처리량/지연을 비교해보기
- 일부러 이벤트 루프에서 블로킹을 발생시키고(예: `Thread.sleep`), 전체 지연이 어떻게 무너지는지 관찰해보기
- `StepVerifier`로 timeout/retry가 섞인 흐름을 테스트로 고정해보기
