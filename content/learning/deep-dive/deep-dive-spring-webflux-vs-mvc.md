---
title: "WebFlux vs MVC 선택 가이드"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["WebFlux", "Spring MVC", "Reactive", "비동기"]
categories: ["Backend Deep Dive"]
description: "Spring MVC와 WebFlux를 실행 모델·병목 유형·운영 난이도로 비교하고, 안전한 전환 전략과 실전 체크리스트를 정리합니다."
module: "spring-core"
study_order: 170
---

## 이 글에서 얻는 것

- Spring MVC와 WebFlux 차이를 "비동기" 같은 추상어가 아니라 **스레드 점유 방식과 병목 구조**로 설명할 수 있습니다.
- 내 서비스에 WebFlux가 필요한지, 아니면 MVC가 더 안전한지 **정량 기준(트래픽·대기시간·운영 복잡도)** 으로 판단할 수 있습니다.
- WebFlux 도입 시 자주 터지는 실패 패턴(블로킹 혼입, 컨텍스트 유실, 재시도 폭풍, 디버깅 난이도)을 예방할 수 있습니다.
- 신규 전환이 아니라도, 기존 서비스에서 "어디까지는 MVC, 어디부터는 WebFlux"로 **혼합 전략**을 설계할 수 있습니다.

## 0) 결론부터: WebFlux는 "더 빠른 MVC"가 아니다

이 문장을 먼저 고정하세요.

> WebFlux는 평균 응답속도를 마법처럼 줄이는 도구가 아니라, **대기 시간이 긴 I/O를 많은 동시 요청에서 더 효율적으로 처리**하는 실행 모델이다.

즉,

- JDBC/JPA 중심 CRUD 서비스 + 중간 수준 트래픽: **MVC가 기본값**
- 외부 API 팬아웃, SSE/WebSocket, 높은 동시 접속, 논블로킹 스택 준비됨: **WebFlux 후보**

성능은 프레임워크 이름보다 **병목(대기/CPU/락) 분해**가 먼저입니다.

## 1) 실행 모델 차이: Thread-per-request vs Event-loop

| 관점 | Spring MVC | Spring WebFlux |
|---|---|---|
| 기본 런타임 | Servlet(Tomcat/Jetty/Undertow) | Reactor Netty(또는 Servlet 어댑터) |
| 요청 처리 모델 | 요청당 스레드 점유 | 이벤트 루프 + 논블로킹 콜백 |
| I/O 대기 시 | 스레드가 대기 상태로 묶임 | 스레드를 반환하고 이벤트 재개 |
| 코드 모델 | 동기 + 익숙한 스택 트레이스 | `Mono/Flux` 체인 + 연산자 기반 |
| 강점 | 단순성, 디버깅 용이, 생태계 성숙 | 동시 I/O 효율, 스트리밍, 고밀도 연결 |
| 취약점 | 대기 증가 시 스레드 풀 압박 | 블로킹 혼입 시 이벤트 루프 정체 |

실행 모델의 배경은 [I/O 실행 모델](/learning/deep-dive/deep-dive-io-execution-model/) 글을 함께 보면 더 선명해집니다.

## 2) 선택 기준: "어떤 병목이 주 병목인가?"

프레임워크 선택보다 먼저, 최근 2~4주 운영 데이터로 병목 유형을 분류합니다.

### WebFlux 우선 검토 신호

- 외부 API 호출 비중이 높고(팬아웃), 호출 대기가 길다.
- p95 상승 시 CPU보다 **대기 시간**이 먼저 증가한다.
- SSE/WebSocket/스트리밍 요구가 제품 요구사항에 포함된다.
- 동시 연결 수가 많고 스레드/커넥션 풀 포화가 잦다.

### MVC 유지가 더 나은 신호

- DB 접근이 JDBC/JPA 중심이며 R2DBC 전환 계획이 없다.
- 비즈니스 로직이 CPU 바운드(암호화, 대용량 변환, 이미지 처리)다.
- 팀의 리액티브 운영 경험이 부족하고, 디버깅 난이도 상승을 감당하기 어렵다.
- 현재 장애 원인이 프레임워크가 아니라 쿼리/인덱스/캐시 설계다.

DB 계층이 블로킹이면 WebFlux 이점이 크게 줄어듭니다. 트랜잭션 경계와 DB 병목은 [JPA 트랜잭션 경계](/learning/deep-dive/deep-dive-jpa-transaction-boundaries/)와 같이 점검하세요.

## 3) 정량 판단: 간단 용량 계산으로 착시 줄이기

실무에서 자주 쓰는 아주 단순한 감각식:

- 동시 처리량(rough) ≈ 동시 요청 수 / 평균 응답시간
- 평균 응답시간 = CPU 시간 + I/O 대기시간

예시(극단 단순화):

- 요청 1건 CPU 20ms, 외부 I/O 대기 180ms
- 총 200ms 중 실제 CPU는 10%

이런 구조에서 MVC는 대기 중에도 스레드를 점유하기 쉽고,
WebFlux는 대기 시간 동안 스레드를 반환해 **동시 I/O 밀도**를 높일 수 있습니다.

반대로 CPU 150ms + I/O 20ms 같은 CPU 바운드 작업은 WebFlux로 바꿔도 체감 이득이 작습니다.

## 4) 도입 전 필수 전제: "끝까지 논블로킹" 가능한지

WebFlux는 일부 구간만 논블로킹이어도 동작은 합니다. 문제는 운영 안정성입니다.

최소 점검 항목:

1. HTTP 클라이언트가 WebClient 기반인가?
2. DB 접근을 R2DBC로 가져갈 계획이 있는가?
3. 파일/암호화/레거시 SDK 같은 블로킹 구간을 격리할 수 있는가?
4. 타임아웃/재시도/서킷 브레이커를 리액티브 체인으로 구성할 수 있는가?
5. 트레이싱/로그 컨텍스트 전파 전략이 준비되어 있는가?

외부 호출 안정화는 [WebClient 회복탄력성](/learning/deep-dive/deep-dive-webclient-resilience/)을 같이 보세요.

## 5) 흔한 안티패턴 6가지

### 5-1) WebFlux + JPA 혼용 후 "왜 안 빨라졌지?"

WebFlux 컨트롤러에서 결국 JDBC 블로킹 호출을 하면 이벤트 루프 이점이 줄어듭니다.

### 5-2) 체인 중간 `block()` 호출

`block()`은 리액티브 파이프라인을 동기 경계로 끊습니다. 특히 이벤트 루프에서 `block()`하면 지연이 빠르게 전파됩니다.

### 5-3) 무제한 `flatMap` 팬아웃

동시성 제한 없는 팬아웃은 외부 의존성/내부 큐를 동시에 압박합니다.
`flatMap(..., concurrency)`로 상한을 둬야 합니다.

### 5-4) 재시도 남발

일시적 장애만 재시도해야 하는데, 4xx까지 재시도하거나 백오프 없이 재시도하면 장애를 확대합니다.

### 5-5) `boundedElastic`를 만능 해결책으로 사용

블로킹 격리에 유용하지만, 과용하면 결국 "숨겨진 스레드 풀 문제"로 돌아옵니다.

### 5-6) 관측 없이 전환

리액티브 전환에서 가장 위험한 건 코드 자체보다 "보이지 않는 병목"입니다.
메트릭/트레이싱 없이 전환하면 장애 시 원인 분석 시간이 급증합니다.

## 6) 안전한 전환 전략: 빅뱅보다 경계 분리

### 전략 A) 클라이언트 레이어부터 전환

서버 프레임워크는 MVC를 유지하고, 외부 호출만 WebClient로 전환해 병목을 먼저 줄입니다.

### 전략 B) 신규 고동시성 엔드포인트만 WebFlux

SSE/스트리밍/대량 팬아웃 경로를 별도 모듈로 분리해 WebFlux로 운영합니다.

### 전략 C) 관측 체계 선행 후 런타임 전환

아래를 먼저 준비하고 전환합니다.

- p95/p99, 에러율, 큐 대기, 스레드풀/이벤트루프 지표
- 배포 태그 기반 전후 비교
- 롤백 조건(숫자) 사전 정의

관측 기준은 [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/)과 [APM 기초](/learning/deep-dive/deep-dive-apm-basics/)를 함께 적용하면 안정적입니다.

## 7) 코드 패턴: 실수 줄이는 기본 템플릿

### 7-1) 블로킹 작업 격리

```java
Mono<Result> isolated = Mono.fromCallable(() -> legacyBlockingCall())
    .subscribeOn(Schedulers.boundedElastic());
```

원칙:

- 격리는 임시 우회책이다.
- 장기적으로는 논블로킹 대체 경로를 마련한다.
- 격리 구간 비율(요청 대비 %)을 메트릭으로 추적한다.

### 7-2) 팬아웃 + 타임아웃 + 동시성 제한

```java
Flux<Item> result = Flux.fromIterable(ids)
    .flatMap(id -> webClient.get()
        .uri("/api/items/{id}", id)
        .retrieve()
        .bodyToMono(Item.class)
        .timeout(Duration.ofSeconds(2)), 32); // 동시성 상한
```

여기에 필요 시 재시도/서킷 브레이커를 제한적으로 추가합니다.

```java
Mono<Response> guarded = webClient.get()
    .uri("/partner")
    .retrieve()
    .bodyToMono(Response.class)
    .timeout(Duration.ofSeconds(1))
    .retryWhen(Retry.backoff(2, Duration.ofMillis(100)));
```

회복탄력성 설계는 [서킷 브레이커 실전](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/)도 같이 보세요.

## 8) 운영/디버깅 체크포인트

리액티브는 "문제가 없을 때"는 깔끔하지만, 장애 시 관측 설계가 약하면 난이도가 급상승합니다.

### 최소 운영 체크리스트

- [ ] 이벤트 루프 스레드 점유 시간이 비정상적으로 길어지는지 모니터링한다.
- [ ] `block()/toIterable()/toStream()` 사용 위치를 코드 검색으로 주기 점검한다.
- [ ] 외부 호출 타임아웃/재시도 정책이 엔드포인트별로 다르게 설정되어 있다.
- [ ] 배포 직후 p95/p99와 에러율을 이전 릴리스와 비교한다.
- [ ] 장애 시 "최근 배포 → 지연 증가 경로 → 핫스택" 순서의 RCA 절차가 문서화되어 있다.

### 디버깅 팁

- 복잡한 체인은 작은 메서드로 분해하고 operator 이름을 의도 중심으로 분리합니다.
- 컨텍스트(MDC/TraceId) 유실 여부를 테스트 케이스로 고정합니다.
- 트레이스는 [분산 추적 심화](/learning/deep-dive/deep-dive-distributed-tracing-advanced/) 기준으로 span 경계를 설계합니다.

## 9) 팀 의사결정 매트릭스(실전용)

| 질문 | Yes면 | No면 |
|---|---|---|
| I/O 대기 비중이 높고 팬아웃이 많은가? | WebFlux 후보 | MVC 유지 우세 |
| DB/외부 호출을 논블로킹으로 맞출 수 있는가? | WebFlux 이점 유지 | 이점 급감 |
| 운영팀이 리액티브 디버깅 역량이 있는가? | 단계적 도입 가능 | 교육/가드레일 먼저 |
| 장애 대응 런북/관측 지표가 준비됐는가? | 전환 리스크 낮음 | 관측 선행 필요 |

결정 규칙 예시:

- 4개 중 3개 이상 Yes: WebFlux 파일럿 진행
- 2개 Yes: 부분 도입(클라이언트/특정 경로)
- 1개 이하 Yes: MVC 유지 + 병목 제거 우선

## 연습(추천)

1. 동일 기능(외부 API 20개 팬아웃)을 MVC(WebClient 동기화)와 WebFlux(논블로킹)로 각각 구현하고, p95/CPU/스레드 수를 비교해보세요.
2. 의도적으로 이벤트 루프에서 블로킹 호출을 섞은 뒤, 지연과 에러율이 어떻게 변하는지 관찰해보세요.
3. 부하 시나리오를 [부하 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)에 맞춰 작성하고, 전환 전후 데이터로 의사결정을 내려보세요.

---

## 관련 심화 학습

- [Spring WebFlux 심화](/learning/deep-dive/deep-dive-spring-webflux/) — Mono/Flux, 스케줄러, 배압 기본기
- [Spring MVC 요청 생명주기](/learning/deep-dive/deep-dive-spring-mvc-request-lifecycle/) — MVC 내부 처리 흐름
- [I/O 실행 모델](/learning/deep-dive/deep-dive-io-execution-model/) — 블로킹/논블로킹의 OS 관점
- [스레드 풀 설계](/learning/deep-dive/deep-dive-thread-pool/) — MVC 계열 튜닝 핵심
- [WebClient 회복탄력성](/learning/deep-dive/deep-dive-webclient-resilience/) — 타임아웃/재시도/격리 설계
- [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/) — 전환 후 운영 지표 설계

핵심은 기술 선호가 아니라 **병목과 운영 난이도에 맞춘 실행 모델 선택**입니다.  
WebFlux는 강력하지만, 준비 없는 도입은 평균 개발 속도를 오히려 떨어뜨릴 수 있습니다.