---
title: "WebFlux vs MVC 면접 Q&A (선택 기준/운영 포인트)"
study_order: 864
date: 2025-12-28
topic: "Backend"
tags: ["WebFlux", "Spring MVC", "비동기", "면접"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
description: "WebFlux와 Spring MVC 선택 기준, 운영 포인트 면접 Q&A"
series_order: 34
draft: false
module: "interview-readiness"
---

## Q1. WebFlux와 MVC를 어떻게 선택하나요?

### 답변

질문은 "누가 더 좋냐"가 아니라 "우리 상황에 무엇이 맞냐"입니다.

#### 선택 기준 비교

| 기준 | Spring MVC | Spring WebFlux |
|------|-----------|----------------|
| **I/O 모델** | 동기/블로킹 (thread-per-request) | 비동기/논블로킹 (이벤트 루프) |
| **적합 워크로드** | CRUD 위주, DB 의존 높은 서비스 | 외부 API 호출 다수, 스트리밍, 게이트웨이 |
| **스레드 사용** | 요청당 1스레드 점유 | 소수 이벤트 루프 스레드로 다수 요청 처리 |
| **학습 곡선** | 낮음 (Servlet 기반, 대부분의 팀이 익숙) | 높음 (Reactor/Mono/Flux, 디버깅 난이도 상승) |
| **DB 드라이버** | JDBC (블로킹) | R2DBC, 논블로킹 드라이버 필요 |
| **디버깅** | 스택 트레이스 직관적 | 비동기 체인으로 스택 트레이스 추적 어려움 |

#### 선택 의사결정 흐름

1. **트래픽 특성 확인**: 동시 연결 수가 수천 이상이고, 각 요청이 외부 I/O 대기 비중이 높은가?
2. **팀 역량 점검**: Reactive 프로그래밍 경험이 있는 인원이 50% 이상인가?
3. **기술 스택 호환성**: 사용 중인 DB 드라이버, 라이브러리가 논블로킹을 지원하는가?
4. **운영 준비도**: 비동기 추적(tracing), 모니터링 도구가 갖춰져 있는가?

위 4개 중 3개 이상 "예"라면 WebFlux 검토, 아니면 MVC가 안전한 선택입니다.

### 면접 포인트

면접관이 듣고 싶은 건 "WebFlux가 좋습니다"가 아니라 **트레이드오프를 인지하고 상황별 판단을 할 수 있는가**입니다. "기본은 MVC, 조건 충족 시 WebFlux 검토"라는 구조로 답하면 실무 경험을 어필할 수 있습니다.

---

## Q2. WebFlux 도입하면 무조건 빨라지나요?

### 답변

아닙니다. WebFlux는 **처리량(throughput) 최적화** 도구이지, **지연(latency) 최적화** 도구가 아닙니다.

#### 빨라지는 경우

- 외부 API 3~4곳을 동시에 호출하고 결과를 합치는 aggregation 서비스
- 동시 접속 10,000+ 환경에서 스레드 풀 고갈 없이 처리
- SSE(Server-Sent Events)나 WebSocket 기반 실시간 스트리밍

#### 빨라지지 않는 경우

- DB 쿼리가 이미 병목 → 프레임워크를 바꿔도 쿼리 시간은 동일
- CPU-bound 연산(이미지 처리, 암호화) → 이벤트 루프를 블로킹해서 오히려 악화
- 블로킹 라이브러리 혼용 → `block()` 호출 시 이벤트 루프 스레드 점유, 전체 성능 저하

#### 실제 벤치마크 사례 (참고)

```
[시나리오] 외부 API 3곳 순차 호출 (각 200ms)

MVC (thread-per-request):
  - 총 지연: ~600ms (순차)
  - 동시 1,000건: 스레드 풀 200 → 대기열 발생

WebFlux (비동기 병렬):
  - 총 지연: ~200ms (병렬 합성)
  - 동시 1,000건: 이벤트 루프 4스레드로 처리 가능
```

핵심: **I/O 대기를 병렬화할 수 있는 구조**에서만 WebFlux의 장점이 드러납니다.

---

## Q3. 운영에서 중요한 포인트는?

### 답변

WebFlux 운영은 "쓰는 것"보다 "관리하는 것"이 어렵습니다. 아래 체크리스트를 기준으로 운영 준비도를 평가하세요.

#### 운영 체크리스트

**1. 타임아웃/재시도 정책**
- `WebClient`에 반드시 `timeout()` 설정
- 재시도는 `retryWhen(Retry.backoff(3, Duration.ofMillis(100)))` 형태로 지수 백오프 적용
- Circuit Breaker(Resilience4j) 연동 권장

```java
webClient.get()
    .uri("/external-api")
    .retrieve()
    .bodyToMono(String.class)
    .timeout(Duration.ofSeconds(3))
    .retryWhen(Retry.backoff(3, Duration.ofMillis(200)))
    .onErrorReturn("fallback");
```

**2. Backpressure 처리**
- `Flux`에서 소비자가 느릴 때 데이터 유실/OOM 발생 가능
- `onBackpressureBuffer(maxSize)`, `onBackpressureDrop()` 등 전략 명시
- 모니터링: 큐 적체량, 드롭 카운트 추적

**3. 스레드 모델 이해**
- 이벤트 루프 스레드에서 절대 블로킹 금지 (`Thread.sleep()`, 동기 JDBC, `block()`)
- 불가피한 블로킹은 `Schedulers.boundedElastic()`으로 격리

```java
Mono.fromCallable(() -> legacyBlockingCall())
    .subscribeOn(Schedulers.boundedElastic());
```

**4. 분산 추적 & 모니터링**
- Reactor Context를 활용한 traceId 전파 (Micrometer Tracing / Sleuth)
- 지표: 이벤트 루프 지연(event loop latency), 보류 요청 수, 외부 의존성 실패율
- 비동기 환경에서는 MDC가 기본 동작하지 않으므로, `contextWrite()`로 별도 전파

**5. 테스트 전략**
- `StepVerifier`로 비동기 시퀀스 검증
- `WebTestClient`로 통합 테스트
- 부하 테스트 시 블로킹 코드 감지: `BlockHound` 라이브러리 도입

```java
// BlockHound 설치 (테스트 환경)
BlockHound.install();

// StepVerifier 예시
StepVerifier.create(service.getData())
    .expectNextCount(5)
    .verifyComplete();
```

---

## Q4. 면접용 1분 답변 예시?

### 답변

#### 기본 버전 (경력 1~3년)

> "저는 기본적으로 MVC를 선택하고, 대규모 I/O 대기나 스트리밍 시나리오에서 WebFlux를 검토합니다. WebFlux는 논블로킹으로 처리량이 좋지만, 팀 숙련도와 운영 난이도 비용이 있습니다. 그래서 트래픽 특성, 병목 위치, 팀 역량을 같이 보고 선택합니다."

#### 심화 버전 (경력 3년+, 실무 경험 어필)

> "이전 프로젝트에서 외부 API 4곳을 순차 호출하던 aggregation 서비스를 WebFlux로 전환한 경험이 있습니다. 지연이 800ms에서 250ms로 줄었고, 동시 처리량이 3배 증가했습니다. 다만 기존 JDBC 드라이버를 R2DBC로 전환하는 비용, 팀 학습 곡선, 디버깅 난이도 증가라는 트레이드오프가 있었습니다. 그래서 저는 '전체 서비스를 WebFlux로'가 아니라 '병목 구간만 선별 적용'하는 접근을 선호합니다."

#### 꼬리 질문 대비

- **"R2DBC 경험은?"** → 지원 DB 범위, 트랜잭션 관리(`@Transactional` 동작 차이), 커넥션 풀 설정
- **"block() 쓰면 안 되나요?"** → 이벤트 루프 스레드에서 금지, `boundedElastic()`으로 격리 필요
- **"MVC에서 비동기 처리는?"** → `@Async`, `DeferredResult`, `CompletableFuture` 활용 가능하지만 본질적으로 thread-per-request 모델

---

## Q5. MVC 프로젝트에서 부분적으로 WebFlux를 쓸 수 있나요?

### 답변

가능하지만 주의가 필요합니다.

#### 방법 1: WebClient만 사용 (MVC 프로젝트 내)

Spring MVC 프로젝트에서 `RestTemplate` 대신 `WebClient`를 사용해 외부 호출만 논블로킹으로 처리할 수 있습니다.

```java
// MVC 컨트롤러에서 WebClient 사용
@GetMapping("/aggregate")
public ResponseEntity<AggregateResult> aggregate() {
    Mono<A> a = webClient.get().uri("/api-a").retrieve().bodyToMono(A.class);
    Mono<B> b = webClient.get().uri("/api-b").retrieve().bodyToMono(B.class);
    
    // 병렬 호출 후 동기 반환
    return Mono.zip(a, b)
        .map(tuple -> new AggregateResult(tuple.getT1(), tuple.getT2()))
        .block(); // MVC이므로 최종 block() 허용
}
```

#### 방법 2: 별도 마이크로서비스로 분리

- I/O 집약 로직만 WebFlux 서비스로 분리
- 나머지는 MVC 유지
- 서비스 간 통신은 HTTP/gRPC

#### 주의사항

- `spring-boot-starter-web`과 `spring-boot-starter-webflux`를 동시에 의존하면 MVC가 우선
- 혼용 시 스레드 모델 혼재로 디버깅 복잡도 증가
- 팀 내 "어디까지가 비동기인지" 명확한 경계 문서화 필수

---

## 요약

- 기술 우열보다 **선택 기준**을 말하는 게 실무형 답변이다.
- WebFlux는 처리량(throughput) 도구이지, 만능 성능 개선 도구가 아니다.
- 운영 준비(타임아웃/Backpressure/추적/테스트)가 도입보다 중요하다.
- 부분 도입(WebClient만, 또는 서비스 분리)도 유효한 전략이다.

## 다음 글

- [Reactive Programming 개념 Q&A](/learning/qna/reactive-programming-qna/)
- [API 성능 Q&A](/learning/qna/api-performance-qna/)
