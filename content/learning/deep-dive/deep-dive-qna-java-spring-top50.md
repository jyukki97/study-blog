---
title: "Q&A 모음: Java/Spring 핵심 50제"
date: 2025-12-16
draft: false
topic: "Q&A"
tags: ["Java", "Spring", "Interview", "Q&A"]
categories: ["Q&A"]
description: "JVM/GC, 동시성, 스프링 빈/트랜잭션/보안 등 자주 묻는 50문항 Q&A"
module: "qna"
study_order: 800
---

기술 면접과 실무에서 자주 등장하는 Java/Spring 핵심 질문 50개를 **질문 → 핵심 답변 → 실무 팁** 형태로 정리했습니다. 깊이 있는 학습이 필요한 항목은 별도 딥다이브 링크를 참고하세요.

---

## Part 1 — JVM & 메모리 (Q1–Q10)

### Q1. JVM 메모리 구조를 설명하세요.

**핵심 답변:** JVM 메모리는 크게 **Heap**, **Stack**, **Method Area(Metaspace)**, **PC Register**, **Native Method Stack**으로 나뉩니다.

| 영역 | 용도 | 스레드 공유 |
|------|------|------------|
| Heap | 객체 인스턴스 저장 (Young → Old) | 공유 |
| Stack | 메서드 호출 프레임, 지역변수 | 스레드별 |
| Metaspace | 클래스 메타데이터 (Java 8+) | 공유 |

**실무 팁:** `-Xms`/`-Xmx`로 Heap 크기를 고정하면 GC 예측이 쉬워집니다. Metaspace는 기본 무제한이므로 클래스 로더 누수에 주의하세요.

### Q2. GC(Garbage Collection) 동작 원리는?

**핵심 답변:** GC는 **Mark → Sweep → Compact** 단계로 동작합니다. Young Gen에서는 Minor GC(Eden → Survivor), Old Gen에서는 Major/Full GC가 발생합니다.

- **G1GC** (Java 9+ 기본): Region 기반, 예측 가능한 pause time 목표
- **ZGC** (Java 15+): Sub-millisecond pause, 대용량 힙에 적합
- **Shenandoah**: Red Hat 주도, concurrent compaction

**실무 팁:** GC 로그는 `-Xlog:gc*:file=gc.log`로 활성화하고, GCViewer나 GCEasy로 분석하세요. P99 응답시간이 튀면 GC pause를 의심하세요.

### Q3. String, StringBuilder, StringBuffer 차이는?

**핵심 답변:**
- **String**: 불변(immutable), String Pool 활용, `+` 연산 시 새 객체 생성
- **StringBuilder**: 가변(mutable), 단일 스레드에서 사용, 동기화 없음
- **StringBuffer**: 가변, `synchronized` 메서드로 스레드 안전

**실무 팁:** 99%의 경우 `StringBuilder`로 충분합니다. 루프 안에서 String `+` 연산은 피하세요 — 컴파일러가 최적화하지만 루프에서는 한계가 있습니다.

### Q4. `equals()`와 `hashCode()`를 함께 오버라이드해야 하는 이유는?

**핵심 답변:** `HashMap`/`HashSet`은 먼저 `hashCode()`로 버킷을 찾고, 같은 버킷 내에서 `equals()`로 동등성을 판단합니다. `hashCode()`를 오버라이드하지 않으면 논리적으로 같은 객체가 다른 버킷에 들어가 `contains()`가 실패합니다.

```java
// 반드시 함께 오버라이드
@Override
public boolean equals(Object o) { ... }

@Override
public int hashCode() {
    return Objects.hash(field1, field2);
}
```

### Q5. Checked Exception vs Unchecked Exception 차이는?

**핵심 답변:**
- **Checked** (`Exception` 상속): 컴파일 타임에 처리 강제 — `IOException`, `SQLException`
- **Unchecked** (`RuntimeException` 상속): 처리 강제 없음 — `NullPointerException`, `IllegalArgumentException`

**실무 팁:** 비즈니스 예외는 Unchecked로 만들고, 글로벌 `@ExceptionHandler`에서 일괄 처리하는 패턴이 일반적입니다. Checked Exception을 남용하면 코드가 try-catch로 도배됩니다.

### Q6. `final`, `finally`, `finalize()` 차이는?

- **`final`**: 변수(상수), 메서드(오버라이드 금지), 클래스(상속 금지)
- **`finally`**: try-catch 후 반드시 실행되는 블록 (리소스 정리)
- **`finalize()`**: GC 직전 호출되는 메서드 — **Java 9부터 deprecated**, `Cleaner`나 try-with-resources를 사용하세요.

### Q7. Java 직렬화(Serialization)의 문제점과 대안은?

**핵심 답변:** `Serializable`은 보안 취약점(역직렬화 공격), 버전 호환성 문제(`serialVersionUID`), 성능 이슈가 있습니다.

**대안:**
- JSON: Jackson, Gson (범용 API)
- Protocol Buffers: 바이너리, 스키마 기반, 고성능
- Avro: Kafka 생태계에서 주로 사용

### Q8. `volatile` 키워드의 역할은?

**핵심 답변:** `volatile`은 변수를 메인 메모리에서 직접 읽고/쓰도록 보장합니다. CPU 캐시로 인한 **가시성(visibility)** 문제를 해결하지만, **원자성(atomicity)**은 보장하지 않습니다.

```java
// Double-check locking에서 volatile 필수
private static volatile Singleton instance;
```

**실무 팁:** 단순 플래그(boolean)에는 `volatile`, 카운터에는 `AtomicInteger`, 복합 연산에는 `synchronized`를 사용하세요.

### Q9. Java 8의 주요 변경 사항 3가지는?

1. **Lambda & Functional Interface**: `(x) -> x * 2`, `Predicate`, `Function`
2. **Stream API**: 컬렉션 데이터의 선언적 처리, lazy evaluation
3. **Optional**: null 처리를 명시적으로, `orElse()`, `map()`, `flatMap()`

추가: `default` 메서드(인터페이스), `java.time` API(LocalDate/ZonedDateTime), `CompletableFuture`

### Q10. `record` (Java 16+)와 `sealed class` (Java 17+)는?

- **record**: 불변 데이터 캐리어, 자동으로 `equals()`, `hashCode()`, `toString()` 생성
- **sealed class**: 상속 가능한 하위 클래스를 `permits`로 제한 → 패턴 매칭과 함께 사용

```java
public sealed interface Shape permits Circle, Rectangle {}
public record Circle(double radius) implements Shape {}
```

---

## Part 2 — 동시성 (Q11–Q18)

### Q11. `synchronized`의 동작 원리는?

**핵심 답변:** 모니터 락(intrinsic lock)을 획득하여 임계 영역에 하나의 스레드만 진입합니다. 메서드 레벨 또는 블록 레벨로 적용 가능합니다.

- **편향 잠금(Biased Locking)**: 경합 없으면 CAS 없이 빠르게 진입 (Java 15에서 deprecated)
- **경량 잠금 → 중량 잠금**: 경합 발생 시 OS mutex로 에스컬레이션

### Q12. `ReentrantLock` vs `synchronized` 차이는?

| 항목 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 타임아웃 | ✗ | `tryLock(timeout)` |
| 공정성(fairness) | ✗ | 설정 가능 |
| Condition | `wait/notify` | 다중 Condition 지원 |
| 사용 편의 | 자동 해제 | `finally`에서 `unlock()` 필수 |

### Q13. `ThreadPoolExecutor` 핵심 파라미터는?

- **corePoolSize**: 기본 유지 스레드 수
- **maximumPoolSize**: 최대 스레드 수
- **keepAliveTime**: 초과 스레드 유휴 시간
- **workQueue**: `LinkedBlockingQueue`(무한) vs `SynchronousQueue`(핸드오프) vs `ArrayBlockingQueue`(유한)
- **rejectedExecutionHandler**: `AbortPolicy`, `CallerRunsPolicy`, `DiscardPolicy`

**실무 팁:** `Executors.newFixedThreadPool()`보다 직접 `ThreadPoolExecutor`를 구성하세요. 무한 큐는 OOM의 원인입니다.

### Q14. `CompletableFuture`의 주요 사용 패턴은?

```java
CompletableFuture.supplyAsync(() -> fetchUser(id))
    .thenApply(user -> enrichProfile(user))
    .thenCompose(profile -> saveAsync(profile))  // flatMap
    .exceptionally(ex -> fallback(ex));

// 병렬 실행 후 합치기
CompletableFuture.allOf(future1, future2).thenRun(() -> ...);
```

### Q15. `ConcurrentHashMap`의 내부 구조는? (Java 8+)

**핵심 답변:** 버킷 단위 `synchronized` + CAS 연산. `Node` 배열에서 해시 충돌 시 **linked list → red-black tree**로 변환 (8개 이상). `size()`는 `LongAdder` 기반 분산 카운터로 정확도와 성능을 양립합니다.

### Q16. `ThreadLocal`은 언제 쓰고, 주의점은?

**사용 사례:** 요청별 컨텍스트(MDC 로그, 인증 정보), SimpleDateFormat 같은 비스레드-안전 객체 격리.

**주의점:** 스레드 풀에서 반드시 `remove()` 호출 — 안 하면 메모리 누수 + 이전 요청 데이터 오염.

### Q17. `virtual thread` (Java 21)란?

**핵심 답변:** 경량 스레드로 OS 스레드가 아닌 JVM이 스케줄링합니다. blocking I/O 시 carrier thread를 반환하므로 수만 개의 동시 작업이 가능합니다.

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> blockingCall());
}
```

**주의:** `synchronized` 블록 내 blocking은 carrier thread를 pin하므로 `ReentrantLock`으로 교체 권장.

### Q18. `Atomic` 클래스와 CAS(Compare-And-Swap)는?

`AtomicInteger`, `AtomicReference` 등은 CAS 명령어로 lock-free 업데이트를 수행합니다. 경합이 낮을 때 `synchronized`보다 빠르지만, 높은 경합에서는 spin-retry 오버헤드가 있습니다. `LongAdder`는 높은 경합 카운터에 최적입니다.

---

## Part 3 — Spring Core (Q19–Q30)

### Q19. IoC/DI란 무엇이고, Spring에서 어떻게 구현되나?

**핵심 답변:** **IoC(Inversion of Control)**은 객체 생성·생명주기 제어를 프레임워크에 위임하는 것이고, **DI(Dependency Injection)**은 IoC의 구현 방법입니다. Spring은 `ApplicationContext`가 빈을 관리하며, 생성자 주입을 권장합니다.

### Q20. Bean 스코프 종류와 주의점은?

| 스코프 | 설명 |
|--------|------|
| singleton (기본) | 컨테이너당 1개 |
| prototype | 요청마다 새 인스턴스 |
| request | HTTP 요청당 1개 |
| session | HTTP 세션당 1개 |

**주의:** singleton 빈에 prototype 빈을 주입하면 prototype이 사실상 singleton처럼 동작합니다. → `ObjectProvider` 또는 `@Lookup`으로 해결.

### Q21. `@Transactional`의 전파(Propagation) 수준 차이는?

- **REQUIRED** (기본): 기존 트랜잭션 참여, 없으면 새로 생성
- **REQUIRES_NEW**: 항상 새 트랜잭션 (기존은 suspend)
- **NESTED**: savepoint 기반 중첩
- **SUPPORTS**: 있으면 참여, 없으면 비트랜잭션

**실무 팁:** `REQUIRES_NEW`는 로깅/감사처럼 실패해도 원본 트랜잭션에 영향 주지 않아야 하는 곳에 사용.

### Q22. `@Transactional`이 동작하지 않는 경우는?

1. **같은 클래스 내부 호출** — 프록시를 거치지 않음 (self-invocation)
2. **private/protected 메서드** — CGLIB 프록시가 오버라이드 불가
3. **Checked Exception** — 기본적으로 롤백하지 않음 (`rollbackFor` 지정 필요)
4. **비 Spring 관리 객체** — `new`로 생성한 인스턴스

### Q23. Spring AOP 동작 원리는?

**핵심 답변:** 런타임 프록시 기반. JDK Dynamic Proxy(인터페이스) 또는 CGLIB(클래스)로 프록시 객체를 생성하여 Advice(Before, After, Around)를 Pointcut에 적용합니다.

### Q24. `@Component`, `@Service`, `@Repository`, `@Controller` 차이는?

기능적으로 모두 `@Component`의 특수화이며 빈 등록 동작은 동일합니다. 차이는 **의미론적 구분**입니다:
- `@Repository`: 데이터 접근 계층, DAO 예외를 `DataAccessException`으로 변환
- `@Service`: 비즈니스 로직 계층
- `@Controller`: 웹 계층, `@RequestMapping` 처리

### Q25. Spring Boot Auto-Configuration 원리는?

`@EnableAutoConfiguration` → `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 파일에서 후보 설정 클래스를 로드 → `@Conditional*` 조건에 따라 선택적으로 빈 등록.

**디버깅:** `--debug` 플래그나 `ConditionEvaluationReport`로 어떤 설정이 적용/제외되었는지 확인.

### Q26. Spring 프로파일(Profile) 활용법은?

```yaml
# application-dev.yml / application-prod.yml
spring:
  profiles:
    active: dev
```

`@Profile("prod")`로 빈 조건부 등록. 환경변수 `SPRING_PROFILES_ACTIVE`로 런타임 전환.

### Q27. `@Value` vs `@ConfigurationProperties` 차이는?

- `@Value("${key}")`: 단일 값, SpEL 지원, 타입 안전하지 않음
- `@ConfigurationProperties(prefix="app")`: 그룹 바인딩, IDE 자동완성, 유효성 검증(`@Validated`)

**실무 팁:** 설정이 3개 이상이면 `@ConfigurationProperties`를 사용하세요.

### Q28. Spring Event 시스템은?

`ApplicationEventPublisher.publishEvent()`로 발행, `@EventListener`로 수신. `@Async`와 결합하면 비동기 처리. `@TransactionalEventListener(phase = AFTER_COMMIT)`으로 트랜잭션 커밋 후 실행 보장.

### Q29. `RestTemplate` vs `WebClient` 차이는?

- **RestTemplate**: 동기/블로킹, Spring 5에서 maintenance mode
- **WebClient**: 비동기/논블로킹, Reactor 기반, streaming 지원

**실무 팁:** 새 프로젝트는 `WebClient` 사용. 동기가 필요하면 `.block()` 가능하지만, WebFlux 환경에서는 금지.

### Q30. Spring Security 필터 체인 동작 순서는?

`SecurityFilterChain` → `DelegatingFilterProxy` → `FilterChainProxy` → 여러 Security Filter 순서:
1. `SecurityContextPersistenceFilter`
2. `UsernamePasswordAuthenticationFilter`
3. `ExceptionTranslationFilter`
4. `FilterSecurityInterceptor` (인가)

---

## Part 4 — JPA & 데이터 (Q31–Q40)

### Q31. 영속성 컨텍스트(Persistence Context)란?

**핵심 답변:** 엔티티를 관리하는 1차 캐시. 같은 트랜잭션 내에서 동일 ID로 조회하면 캐시된 객체 반환(동일성 보장). **변경 감지(dirty checking)**으로 명시적 `save()` 없이 업데이트 SQL 생성.

### Q32. N+1 문제란 무엇이고, 해결법은?

**문제:** 부모 N건 조회 후, 각 자식을 개별 쿼리로 조회 → 총 N+1번 쿼리.

**해결법:**
1. **Fetch Join**: `JOIN FETCH` — 한 번의 쿼리로 로딩
2. **@EntityGraph**: 선언적 fetch 전략 지정
3. **@BatchSize**: IN 절로 묶어서 조회 (100개 단위 등)
4. **Projection/DTO**: 필요한 컬럼만 직접 조회

### Q33. `FetchType.LAZY` vs `EAGER` 선택 기준은?

**원칙:** 기본은 항상 **LAZY**. 필요할 때만 Fetch Join이나 EntityGraph로 즉시 로딩.

- `@ManyToOne`, `@OneToOne`: JPA 기본값이 `EAGER`이므로 **명시적으로 `LAZY` 지정** 필수
- `@OneToMany`, `@ManyToMany`: 기본 `LAZY`

### Q34. `@Embeddable`과 `@Embedded`의 용도는?

값 타입(Value Object)을 별도 테이블 없이 엔티티에 포함합니다. 예: `Address`(street, city, zipCode)를 `User` 테이블의 컬럼으로 매핑. DDD의 Value Object 패턴 구현에 적합합니다.

### Q35. JPA 상속 매핑 전략 3가지는?

| 전략 | 테이블 구조 | 장단점 |
|------|-------------|--------|
| SINGLE_TABLE | 하나의 테이블 | 조회 빠름, NULL 컬럼 많음 |
| TABLE_PER_CLASS | 클래스별 테이블 | UNION 쿼리 필요 |
| JOINED | 정규화된 테이블 | 정규화 좋음, JOIN 비용 |

**실무 팁:** 대부분 `SINGLE_TABLE` 또는 `JOINED`를 사용합니다.

### Q36. `@GeneratedValue` 전략별 차이는?

- **IDENTITY**: DB auto_increment, batch insert 불가 (INSERT 즉시 실행)
- **SEQUENCE**: DB 시퀀스, allocationSize로 최적화 가능
- **TABLE**: 별도 시퀀스 테이블, 성능 불리
- **UUID** (Hibernate 6+): 애플리케이션에서 생성, 분산 환경에 적합

### Q37. JPQL vs Criteria API vs QueryDSL 비교는?

- **JPQL**: 문자열 기반, 간단한 쿼리에 적합
- **Criteria API**: 타입 안전하지만 가독성 나쁨
- **QueryDSL**: 타입 안전 + 가독성, 동적 쿼리에 강력 → **실무 추천**

### Q38. `@Version`을 이용한 낙관적 잠금(Optimistic Lock)이란?

엔티티에 버전 필드를 두고, 수정 시 `WHERE version = ?`로 충돌 감지. 충돌 시 `OptimisticLockException` 발생 → 재시도 로직 필요. 읽기 많고 쓰기 적은 환경에 적합합니다.

### Q39. Spring Data JPA의 `@Query` 네이티브 쿼리 주의점은?

- `nativeQuery = true` 사용 시 DB 종속적
- 엔티티 매핑이 아닌 인터페이스 Projection 활용 권장
- 페이징 시 `countQuery`를 별도 지정해야 최적화 가능

### Q40. 트랜잭션 격리 수준(Isolation Level) 4가지는?

| 레벨 | Dirty Read | Non-Repeatable Read | Phantom Read |
|------|-----------|-------------------|-------------|
| READ_UNCOMMITTED | O | O | O |
| READ_COMMITTED | X | O | O |
| REPEATABLE_READ | X | X | O (InnoDB: X) |
| SERIALIZABLE | X | X | X |

**실무 팁:** MySQL InnoDB는 `REPEATABLE_READ`가 기본이며, Gap Lock으로 Phantom Read도 방지합니다.

---

## Part 5 — 웹 & API (Q41–Q50)

### Q41. Spring MVC 요청 처리 흐름은?

`DispatcherServlet` → `HandlerMapping` (URL → 핸들러) → `HandlerAdapter` → `Controller` → `ViewResolver` (또는 `@ResponseBody` → `HttpMessageConverter`)

### Q42. `@RequestBody` vs `@ModelAttribute` 차이는?

- **`@RequestBody`**: HTTP Body(JSON/XML)를 `HttpMessageConverter`로 역직렬화
- **`@ModelAttribute`**: 쿼리 파라미터 + form 데이터를 바인딩, `Validator` 자동 적용

### Q43. `@Valid` vs `@Validated` 차이는?

- **`@Valid`**: JSR-303, 중첩 객체 검증 가능
- **`@Validated`**: Spring 확장, **그룹(groups)** 지원

```java
public ResponseEntity<?> create(@Validated(OnCreate.class) @RequestBody Dto dto)
```

### Q44. 글로벌 예외 처리 패턴은?

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handle(BusinessException e) {
        return ResponseEntity.status(e.getStatus())
            .body(new ErrorResponse(e.getCode(), e.getMessage()));
    }
}
```

### Q45. CORS(Cross-Origin Resource Sharing) 설정 방법은?

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("https://example.com")
            .allowedMethods("GET", "POST", "PUT", "DELETE");
    }
}
```

또는 Spring Security에서 `http.cors(c -> c.configurationSource(...))`.

### Q46. `Filter` vs `Interceptor` vs `AOP` 차이는?

| 항목 | Filter | Interceptor | AOP |
|------|--------|-------------|-----|
| 위치 | Servlet 레벨 | Spring MVC 레벨 | 메서드 레벨 |
| Spring 빈 접근 | 제한적 | 가능 | 가능 |
| 대상 | 모든 요청 | 핸들러 매핑된 요청 | 빈의 메서드 |

### Q47. REST API 버전 관리 전략은?

1. **URI 경로**: `/api/v1/users` — 가장 직관적
2. **헤더**: `Accept: application/vnd.myapp.v2+json`
3. **쿼리 파라미터**: `/api/users?version=2`

**실무 팁:** URI 경로 방식이 캐싱, 문서화, 테스트 모두 편리합니다.

### Q48. Spring WebFlux를 선택해야 하는 상황은?

- 높은 동시 접속 + I/O-bound 작업 (채팅, 스트리밍, API Gateway)
- CPU-bound 작업이 많으면 MVC가 더 적합
- 팀의 Reactive 학습 곡선도 고려 — 디버깅이 어렵습니다

### Q49. Spring Actuator 필수 엔드포인트는?

- `/actuator/health`: 헬스체크 (DB, Redis, Kafka 등 포함)
- `/actuator/metrics`: Micrometer 지표
- `/actuator/info`: 빌드 정보
- `/actuator/prometheus`: Prometheus 스크레이핑 엔드포인트

**보안:** 프로덕션에서는 `management.endpoints.web.exposure.include`로 최소한만 노출하세요.

### Q50. Spring Boot 3.x 주요 변경 사항은?

1. **Java 17 필수** — Jakarta EE 9+ (`javax.*` → `jakarta.*`)
2. **GraalVM Native Image 공식 지원**: `spring-boot-starter-parent`에서 네이티브 빌드 가능
3. **Observability**: Micrometer Observation API 통합 (Tracing + Metrics)
4. **문제 상세(Problem Details)**: RFC 7807 기반 에러 응답 기본 지원
5. **HTTP Interface Client**: 인터페이스 선언만으로 HTTP 클라이언트 생성

---

## 마무리 — 효과적인 학습 팁

✅ **코드로 검증하세요:** 각 질문에 대해 간단한 테스트 코드를 작성해보면 기억에 오래 남습니다.

✅ **왜(Why)를 파고드세요:** "synchronized가 느리다"가 아니라 "모니터 락 경합 시 OS mutex로 에스컬레이션되기 때문"까지 설명할 수 있어야 합니다.

✅ **실무 경험과 연결하세요:** 면접관은 "N+1 문제를 어떻게 해결했나?"처럼 경험 기반 질문을 합니다. 프로젝트에서 실제로 적용해보세요.
