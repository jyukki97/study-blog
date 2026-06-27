---
title: "백엔드 커리큘럼 심화: Java Virtual Threads, Spring MVC와 WebFlux 사이에서 고르는 실무 기준"
date: 2026-06-27
draft: false
topic: "Backend Concurrency"
tags: ["Java", "Virtual Threads", "Spring Boot", "Spring MVC", "WebFlux", "Concurrency", "Backend"]
categories: ["Backend Deep Dive"]
description: "Java Virtual Threads를 단순 성능 옵션이 아니라 요청 처리 모델, DB/HTTP 풀, WebFlux 선택 기준까지 함께 보는 실무 플레이북으로 정리합니다."
module: "backend-modern-frontiers"
study_order: 1240
---

Java 21 이후 백엔드 팀에서 Virtual Threads는 더 이상 실험 기능이 아닙니다. Spring Boot에서도 설정 한 줄로 요청 처리나 비동기 실행에 가상 스레드를 붙일 수 있습니다. 그래서 종종 "이제 WebFlux를 안 써도 되나요?", "스레드 풀 튜닝은 끝난 건가요?", "블로킹 JDBC도 그냥 많이 띄우면 되는 건가요?" 같은 질문이 나옵니다.

결론부터 말하면 Virtual Threads는 **블로킹 I/O 중심 애플리케이션의 동시성 비용을 크게 낮추는 도구**입니다. 하지만 DB 커넥션 풀, HTTP 클라이언트 풀, 외부 API quota, CPU 코어 수, timeout budget까지 같이 사라지는 것은 아닙니다. 스레드를 싸게 만들었더니 병목이 더 아래 계층으로 이동하는 경우가 많습니다.

이 글은 Virtual Threads를 "켜면 빨라진다" 수준으로 다루지 않습니다. [Thread Pool 튜닝](/learning/deep-dive/deep-dive-thread-pool/), [WebFlux vs MVC 선택 가이드](/learning/deep-dive/deep-dive-spring-webflux-vs-mvc/), [커넥션 풀 사이징](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/), [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 연결해서, 어떤 서비스에 먼저 켜고 어떤 서비스에서는 보류해야 하는지 실무 기준으로 정리합니다.

## 이 글에서 얻는 것

- Virtual Threads가 해결하는 문제와 해결하지 못하는 문제를 구분할 수 있습니다.
- Spring MVC, WebFlux, `@Async`, scheduler에서 Virtual Threads를 어떤 기준으로 적용할지 판단할 수 있습니다.
- DB/HTTP connection pool, admission control, timeout을 Virtual Threads와 함께 조정하는 기준을 잡을 수 있습니다.
- 도입 전후에 반드시 봐야 하는 지표와 canary 조건을 숫자로 정리할 수 있습니다.
- 면접이나 설계 리뷰에서 "Virtual Threads를 쓰면 WebFlux가 필요 없나"라는 질문에 현실적인 답변을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Virtual Threads는 OS 스레드가 아니라 JVM이 관리하는 가벼운 작업 단위다

기존 Java 서버는 요청 하나를 platform thread 하나에 매핑하는 구조가 흔했습니다. platform thread는 OS 스레드와 연결되므로 생성 비용과 메모리 비용이 큽니다. 그래서 Tomcat worker thread, `@Async` executor, scheduler thread pool을 제한적으로 운영했고, 큐가 길어지면 thread pool saturation이 곧 지연 증가로 이어졌습니다.

Virtual Threads는 이 비용 구조를 바꿉니다. 요청이 네트워크 I/O, DB I/O, 파일 I/O처럼 기다리는 동안 JVM은 underlying carrier thread를 다른 virtual thread 실행에 쓸 수 있습니다. 즉 "기다리는 작업"을 많이 다루는 서비스에서 thread per request 모델의 단순함을 유지하면서 더 많은 동시성을 감당할 수 있습니다.

하지만 중요한 전제는 **기다리는 시간이 많은 workload**입니다. CPU를 오래 태우는 암호화, 이미지 변환, 대형 JSON 직렬화, 압축, 복잡한 계산은 Virtual Threads로 빨라지지 않습니다. CPU-bound 작업은 결국 코어 수가 상한입니다. 이 경우는 [OS 동시성 기초](/learning/deep-dive/deep-dive-os-concurrency-basics/)와 [Thread Pool 튜닝](/learning/deep-dive/deep-dive-thread-pool/) 기준으로 별도 executor를 두는 편이 맞습니다.

### 2) 스레드 병목이 줄면 DB와 외부 API 병목이 더 빨리 드러난다

Virtual Threads를 켠 뒤 가장 흔한 착각은 "이제 동시 요청을 훨씬 많이 받을 수 있다"입니다. 애플리케이션 스레드만 보면 맞습니다. 하지만 요청 하나가 DB 커넥션 1개와 외부 API connection 1개를 잡는다면 전체 처리량은 여전히 하류 자원에 묶입니다.

예를 들어 기존에는 Tomcat worker 200개가 상한이어서 DB 풀 30개가 크게 문제 되지 않았다고 해 봅시다. Virtual Threads를 켜면 요청 진입 자체는 훨씬 넓어질 수 있습니다. 그런데 DB 풀은 그대로 30개이고, 외부 결제 API가 초당 100건만 허용한다면, 시스템은 더 많은 요청을 안쪽으로 받아들인 뒤 더 많이 기다리게 만들 수 있습니다. 이때 p99는 좋아지기는커녕 나빠질 수 있습니다.

그래서 Virtual Threads 도입은 thread pool 확대가 아니라 **동시성 병목 위치를 다시 그리는 작업**입니다. 봐야 할 질문은 아래입니다.

- DB 커넥션 풀 wait p95가 20ms 이하로 유지되는가?
- 외부 API connection pool pending이 피크 5분 동안 계속 쌓이지 않는가?
- retry rate가 기존 대비 1%p 이상 늘지 않는가?
- API timeout 안에서 DB wait, HTTP wait, business logic 시간이 모두 닫히는가?
- admission control 없이 모든 요청을 계속 받아도 되는 경로인가?

이 질문에 답하지 못하면 Virtual Threads는 "빠른 서버"가 아니라 "더 많은 대기열"을 만들 수 있습니다.

### 3) Spring Boot에서는 켜기 쉽지만, 적용 범위 확인이 더 중요하다

Spring Boot는 Java 21 이상에서 `spring.threads.virtual.enabled=true`를 설정하면 기본 task executor와 scheduler에 virtual thread 기반 실행을 적용할 수 있습니다. Servlet stack에서도 virtual thread 기반 request handling을 적용할 수 있습니다. 설정 자체는 쉽습니다.

```properties
spring.threads.virtual.enabled=true
```

문제는 설정이 쉬운 만큼 "어디에 적용됐는지"를 놓치기 쉽다는 점입니다. MVC controller는 virtual thread로 실행되지만, 내부에서 호출하는 별도 executor, Kafka listener, batch worker, scheduled job, custom `CompletableFuture` executor는 기존 platform thread pool을 계속 쓸 수 있습니다. 반대로 모든 비동기 작업이 virtual thread로 바뀌면, 기존에 thread pool size로 보호하던 하류 자원 제한이 사라질 수 있습니다.

실무에서는 아래 범위를 분리해야 합니다.

- HTTP request handling: MVC controller와 filter/interceptor 경로
- 비동기 작업: `@Async`, `CompletableFuture`, application event listener
- scheduler: `@Scheduled`, 배치 트리거, 주기적 sync
- 메시지 소비: Kafka/RabbitMQ listener concurrency
- 외부 호출: WebClient, RestClient, JDBC, Redis, object storage SDK

Virtual Threads는 "모든 executor를 없애자"가 아니라, **요청 실행 모델을 단순화하되 자원 보호용 limit은 별도로 유지하자**에 가깝습니다.

### 4) pinning, ThreadLocal, synchronized는 도입 전 반드시 점검해야 한다

Virtual Threads는 대부분의 일반적인 blocking I/O에서 잘 작동하지만, 특정 상황에서는 carrier thread를 붙잡을 수 있습니다. 대표적으로 오래 걸리는 `synchronized` 블록, native call, 일부 오래된 라이브러리의 blocking 구간, 과도한 `ThreadLocal` 사용이 문제가 됩니다.

특히 Spring/JPA 기반 애플리케이션은 `ThreadLocal`을 자주 씁니다. transaction context, security context, MDC logging context, request context가 thread 단위로 붙습니다. Virtual Threads는 많아질 수 있으므로, thread-local에 큰 객체를 넣거나 요청 종료 후 정리하지 않으면 메모리 사용량과 진단 난이도가 올라갑니다.

점검 기준은 단순합니다.

- request당 ThreadLocal payload가 큰 객체를 들고 있지 않은가?
- synchronized 구간이 외부 I/O나 DB 호출을 감싸고 있지 않은가?
- legacy JDBC/HTTP client에서 pinning 경고가 발생하지 않는가?
- 로그 MDC가 요청 종료 후 확실히 정리되는가?
- virtual thread dump를 봤을 때 특정 lock에서 오래 멈춘 작업이 없는가?

pinning이 조금 있다고 바로 실패는 아닙니다. 하지만 hot path에서 반복되면 Virtual Threads의 장점이 급격히 줄어듭니다.

### 5) WebFlux가 사라지는 것이 아니라 선택 기준이 바뀐다

Virtual Threads가 나오면서 "WebFlux는 이제 필요 없나"라는 질문이 자주 나옵니다. 제 답은 "많은 CRUD/API 서버에서는 MVC + Virtual Threads가 더 단순한 선택이 될 수 있지만, WebFlux의 영역은 여전히 남는다"입니다.

MVC + Virtual Threads가 유리한 경우:

- 기존 코드가 blocking MVC/JDBC 중심이다.
- 팀이 reactive operator와 backpressure 디버깅에 익숙하지 않다.
- 요청 대부분이 DB/HTTP I/O 대기이며, CPU-bound 작업이 적다.
- streaming보다 일반 request/response가 핵심이다.
- 트랜잭션, security context, 예외 처리 모델을 단순하게 유지하고 싶다.

WebFlux가 여전히 유리한 경우:

- 긴 streaming, SSE, websocket, 고밀도 connection 관리가 핵심이다.
- reactive driver와 backpressure를 end-to-end로 설계했다.
- 요청 하나가 fan-out/fan-in, streaming transform, cancellation propagation을 많이 쓴다.
- low-level event loop 튜닝과 operator 관측성을 팀이 운영할 수 있다.
- thread-per-request 모델보다 non-blocking pipeline 자체가 제품 요구에 맞다.

즉 Virtual Threads는 WebFlux를 대체한다기보다, "단순한 blocking API 서버가 reactive로 넘어가야만 확장된다"는 압박을 줄입니다. 선택 기준은 기술 유행이 아니라 workload와 팀 운영 능력입니다.

## 실무 적용

### 1) 도입 후보를 먼저 고른다

Virtual Threads는 전사 default보다 후보 서비스 1~2개에 canary로 넣는 편이 안전합니다. 첫 후보는 아래 조건을 만족하는 서비스가 좋습니다.

- Java 21 이상, Spring Boot 3.2 이상으로 이미 운영 중이다.
- request latency 중 DB/HTTP 대기가 50% 이상이다.
- platform thread pool queue wait가 피크 시간에 반복적으로 관측된다.
- CPU 사용률은 피크에도 60~70% 이하로 여유가 있다.
- 주요 외부 의존성의 timeout, connection pool, retry 정책이 이미 숫자로 정의돼 있다.
- 롤백이 설정 변경 또는 단일 배포로 가능하다.

반대로 아래 조건이면 보류가 낫습니다.

- CPU-bound 작업이 요청 시간의 대부분이다.
- DB pool wait나 lock wait가 이미 높다.
- 외부 API 429/timeout이 자주 발생한다.
- synchronized 기반 legacy 라이브러리가 hot path에 많다.
- 관측 지표가 thread, pool, DB wait를 분리하지 못한다.

핵심은 "Virtual Threads가 도움이 될 workload"와 "Virtual Threads가 병목을 가릴 workload"를 나누는 것입니다.

### 2) canary 기준은 평균 latency가 아니라 p95/p99와 하류 포화로 본다

도입 검증은 최소 1주일 baseline을 잡고 시작하는 편이 좋습니다. 평일 피크, 배치 시간, 배포 직후를 포함해야 합니다. canary는 5~10% 트래픽부터 시작하고, 이상 없을 때 25%, 50%, 100%로 올립니다.

권장 gate는 아래처럼 잡을 수 있습니다.

| 지표 | 통과 기준 |
| --- | --- |
| API latency p95 | baseline 대비 +10% 이내 |
| API latency p99 | baseline 대비 +15% 이내 |
| error/timeout rate | baseline 대비 +0.5%p 이내 |
| DB pool acquire p95 | 20ms 이하 또는 baseline 대비 악화 없음 |
| HTTP client pending | 5분 이상 지속 pending 없음 |
| retry rate | baseline 대비 +1%p 이내 |
| CPU 사용률 | 피크 75% 이상 지속 시 보류 |
| heap/GC | request당 ThreadLocal 증가, GC pause 악화 없음 |

Virtual Threads가 성공하면 평균 latency보다 queue wait와 thread starvation이 먼저 좋아질 가능성이 큽니다. 반대로 p99가 나빠졌다면 하류 pool, retry, lock wait, pinning을 봐야 합니다.

### 3) 하류 자원 limit은 더 엄격하게 둔다

Virtual Threads를 켠 뒤에도 DB pool을 무작정 키우면 안 됩니다. 오히려 처음에는 기존 pool을 유지하고, pool wait와 DB active session을 보면서 조정합니다.

추천 우선순위는 아래입니다.

1. 기존 DB/HTTP pool 크기는 유지한다.
2. API deadline, DB query timeout, HTTP client timeout을 먼저 정렬한다.
3. route별 또는 기능별 concurrency limit을 붙인다.
4. Virtual Threads canary 후 pool wait가 높고 하류 여유가 확인될 때만 10~20% 단위로 조정한다.
5. retry는 최대 2회 이하, 전체 request deadline의 20~25% 이내로 제한한다.

예를 들어 주문 API deadline이 1초라면, DB pool wait 150ms, DB query 400ms, 외부 API 300ms, 나머지 application overhead 150ms처럼 예산을 나눠야 합니다. Virtual Threads가 있어도 deadline budget을 넘긴 작업은 취소되어야 합니다. 이 부분은 [종단간 Deadline Budget과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/) 기준과 같이 적용합니다.

### 4) 운영 지표를 request 관점으로 다시 묶는다

Virtual Threads 도입 후 대시보드는 thread count보다 request lifecycle을 보여줘야 합니다.

필수 지표:

- `http.server.requests` p50/p95/p99
- `db.pool.acquire` p95/p99, timeout count
- DB active session, lock wait, slow query count
- HTTP client pool pending, connect timeout, read timeout
- virtual thread count, pinned event, thread dump 샘플
- `ThreadLocal` 관련 메모리 증가 의심 지표
- route별 inflight requests와 admission reject

특히 "스레드는 여유가 있는데 DB가 터진다"는 상황이 늘 수 있으므로, dashboard는 application thread만 보면 안 됩니다. request가 하류 자원을 얼마나 오래 잡는지 보여줘야 합니다.

## 트레이드오프/주의점

첫째, Virtual Threads는 blocking code를 더 싸게 운영하게 해 주지만, blocking dependency를 무한히 안전하게 만들어 주지는 않습니다. DB, Redis, 외부 API는 여전히 동시성 상한이 필요합니다.

둘째, MVC 코드의 단순함은 큰 장점입니다. reactive operator 체인을 줄이고 stack trace와 debugging을 단순하게 만들 수 있습니다. 하지만 streaming, backpressure, event pipeline을 이미 잘 설계한 팀이라면 WebFlux를 버릴 이유도 없습니다.

셋째, 기존 thread pool size가 하류 보호 장치 역할을 하고 있었다면 Virtual Threads 전환 후 보호막이 사라질 수 있습니다. 이 경우 admission control, bulkhead, route별 limit을 별도로 둬야 합니다.

넷째, pinning과 ThreadLocal은 "나중에 보면 되겠지"로 넘기면 안 됩니다. 성능 문제가 아니라 진단 가능성 문제입니다. 특정 lock, logging context, transaction context가 hot path에서 carrier thread를 붙잡으면 운영자가 원인을 찾기 어렵습니다.

다섯째, Virtual Threads는 성능 튜닝이 아니라 아키텍처 선택입니다. "켜기 전"보다 "켜고 나서 어떤 병목을 관측하고 제한할 것인가"가 더 중요합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] Java 21 이상과 Spring Boot virtual thread 지원 범위를 확인했다.
- [ ] 후보 서비스의 latency 중 I/O wait 비중이 50% 이상인지 확인했다.
- [ ] DB pool acquire p95/p99, HTTP client pending, retry rate가 baseline으로 잡혀 있다.
- [ ] CPU-bound 작업은 별도 executor 또는 worker로 분리했다.
- [ ] `ThreadLocal`, MDC, security context, transaction context 정리 여부를 점검했다.
- [ ] synchronized hot path와 오래된 JDBC/HTTP client의 pinning 가능성을 점검했다.
- [ ] Virtual Threads canary를 5~10%부터 시작하고 p95/p99 gate를 정의했다.
- [ ] DB/HTTP pool은 기존 값을 유지한 뒤 하류 여유가 확인될 때만 10~20% 단위로 조정한다.
- [ ] WebFlux 유지/전환 판단을 팀 숙련도, streaming 요구, backpressure 요구 기준으로 문서화했다.

### 연습

1. 현재 운영 중인 Spring MVC API 하나를 골라 request time을 `DB wait`, `DB execution`, `외부 HTTP wait`, `CPU work`, `serialization`으로 나눠 보세요. I/O wait가 절반을 넘으면 Virtual Threads 후보가 될 수 있습니다.
2. `spring.threads.virtual.enabled=true`를 staging에 적용하고, 같은 부하에서 platform thread 방식과 `db.pool.acquire_p95`, `http.client.pending`, `api_p99`를 비교해 보세요. API 평균만 비교하면 중요한 병목을 놓칩니다.
3. WebFlux로 작성된 endpoint 하나를 골라 "이 코드가 reactive여야 하는 이유"를 세 가지로 적어 보세요. streaming, backpressure, event loop, cancellation 중 명확한 이유가 없다면 MVC + Virtual Threads가 더 단순할 수 있습니다.
4. 팀의 공통 라이브러리 중 `synchronized`와 `ThreadLocal`을 많이 쓰는 부분을 찾아 hot path 여부를 표시해 보세요. Virtual Threads 도입 전 가장 먼저 봐야 할 위험 지도입니다.

## 관련 글

- [Thread Pool 튜닝](/learning/deep-dive/deep-dive-thread-pool/)
- [WebFlux vs MVC 선택 가이드](/learning/deep-dive/deep-dive-spring-webflux-vs-mvc/)
- [커넥션 풀 사이징과 포화 해석](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/)
- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [OS 동시성 기초](/learning/deep-dive/deep-dive-os-concurrency-basics/)

## 참고 링크

- OpenJDK JEP 444: Virtual Threads - https://openjdk.org/jeps/444
- Oracle Java 21 Docs: Virtual Threads - https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html
- Spring Boot Reference: Task Execution and Scheduling - https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html
