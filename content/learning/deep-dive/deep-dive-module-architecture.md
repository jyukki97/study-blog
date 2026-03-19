---
title: "모듈 아키텍처: 패키지/레이어/멀티모듈 설계"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Architecture", "Module", "Package Design", "Multi-Module", "Hexagonal", "ArchUnit"]
categories: ["Backend Deep Dive"]
description: "Layered vs Modular, 패키지 의존성 최소화, 멀티모듈 분리 전략과 의존성 검증까지"
module: "architecture"
study_order: 420
---

## 이 글에서 얻는 것

- "패키지/레이어 구조"를 취향이 아니라 **의존성 관리 도구**로 이해하고, 변경이 퍼지지 않게 구조를 잡을 수 있습니다.
- Domain을 인프라(ORM/HTTP/메시지)로부터 보호하는 의존성 방향(UI → App → Domain)을 적용할 수 있습니다.
- 멀티모듈 분리를 "처음부터 거창하게"가 아니라, 필요해질 때 단계적으로 도입하는 기준이 생깁니다.
- 실제 코드(패키지 구조, Gradle 멀티모듈, ArchUnit 의존성 검증)를 통해 즉시 적용할 수 있습니다.

---

## 0) 구조 설계의 목적은 '변경을 국소화'하는 것이다

좋은 구조는 한 문장으로 설명됩니다.

> 어떤 기능을 바꾸면, 바뀌는 파일의 반경이 작다.

반대로 나쁜 구조는 "어디를 고치면 어디가 깨질지" 예측이 어렵습니다.
그래서 패키지/모듈 설계는 결국 **의존성 그래프를 다루는 일**입니다.

### 구조 품질의 측정 기준

| 지표 | 좋은 상태 | 나쁜 상태 |
|------|----------|----------|
| 변경 반경 | 기능 수정 시 1~3개 패키지 터치 | 5개 이상 패키지 수정 |
| 순환 의존 | 0개 | 모듈 A↔B 순환 존재 |
| 빌드 영향 | 변경 모듈만 재빌드 | 전체 재빌드 |
| 팀 충돌 | PR이 겹치는 경우 드묾 | 같은 파일에서 잦은 충돌 |

---

## 1) 레이어드 vs 모듈러: 어디를 기준으로 나누는가

### 1-1) Layered (기술 기준)

```
com.example.myapp
├── controller/
│   ├── OrderController.java
│   ├── PaymentController.java
│   └── ShippingController.java
├── service/
│   ├── OrderService.java
│   ├── PaymentService.java
│   └── ShippingService.java
├── repository/
│   ├── OrderRepository.java
│   └── PaymentRepository.java
└── domain/
    ├── Order.java
    └── Payment.java
```

- **장점:** 단순, 초기에 빠름, 팀 규모가 작을 때 효율적
- **단점:** 기능이 커지면 "서비스 레이어가 비대해지고" 도메인 규칙이 흩어지기 쉬움. `OrderService`가 `PaymentRepository`를 직접 호출하기 시작하면 사실상 경계가 사라짐

### 1-2) Modular (도메인/기능 기준)

```
com.example.myapp
├── order/
│   ├── api/
│   │   └── OrderController.java
│   ├── application/
│   │   ├── OrderService.java
│   │   └── OrderFacade.java        ← 외부 모듈용 공개 API
│   ├── domain/
│   │   ├── Order.java
│   │   ├── OrderItem.java
│   │   └── OrderRepository.java    ← 인터페이스(Port)
│   └── infrastructure/
│       ├── JpaOrderRepository.java  ← 구현(Adapter)
│       └── OrderEventPublisher.java
├── payment/
│   ├── api/
│   ├── application/
│   ├── domain/
│   └── infrastructure/
└── shipping/
    ├── api/
    ├── application/
    ├── domain/
    └── infrastructure/
```

- **장점:** 변경 반경이 작아지고, 팀/기능 확장이 쉬움. 모듈 단위로 소유권 부여 가능
- **단점:** 경계 설계를 잘못하면 모듈 간 결합이 더 심해질 수도 있음

### 1-3) 실무 선택 기준

| 상황 | 추천 |
|------|------|
| 팀 1~3명, 도메인 단순 | Layered로 시작 |
| 팀 3~5명, 도메인 복잡도 중간 | 기능별 패키지 + Layered 내부 |
| 팀 5명+, 도메인 복잡 | Modular (Package-by-Feature) |
| 독립 배포 필요 | 멀티모듈 또는 MSA |

실무에서는 "레이어 + 모듈(기능별)"을 섞되, 핵심은 **의존성 규칙을 강제**하는 것입니다.

---

## 2) 의존성 방향을 고정하라: Domain을 보호한다

### 2-1) 의존성 규칙

```
                    허용 방향 →
┌─────────────────────────────────────────┐
│  API (Controller)                       │
│    └──→ Application (UseCase/Service)   │
│           └──→ Domain (Entity/규칙)     │
│                  ↑                      │
│         Infrastructure (구현)           │
│           (JPA, HTTP Client, MQ)        │
└─────────────────────────────────────────┘

금지: Domain → Infrastructure (역전)
금지: Application → API (역전)
금지: 모듈 A ↔ 모듈 B (순환)
```

- Domain에는 인터페이스(Port)를 두고,
- Infrastructure에서 그 인터페이스를 구현(Adapter)합니다.

이렇게 하면 DB/메시지/외부 API가 바뀌어도 도메인 규칙은 흔들리지 않습니다.

### 2-2) Port/Adapter 실제 구현

```java
// ── domain 패키지 ──
// Port (인터페이스): Domain이 정의
public interface OrderRepository {
    Order findById(OrderId id);
    void save(Order order);
    List<Order> findPendingOrders(LocalDate since);
}

public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);
    void refund(RefundRequest request);
}

// Domain Event (도메인이 발행)
public record OrderCompletedEvent(
    OrderId orderId, 
    UserId userId, 
    Money totalAmount,
    Instant completedAt
) {}
```

```java
// ── infrastructure 패키지 ──
// Adapter (구현): Infrastructure가 제공
@Repository
@RequiredArgsConstructor
public class JpaOrderRepository implements OrderRepository {

    private final JpaOrderEntityRepository jpaRepo;
    private final OrderMapper mapper;

    @Override
    public Order findById(OrderId id) {
        return jpaRepo.findById(id.value())
                .map(mapper::toDomain)
                .orElseThrow(() -> new OrderNotFoundException(id));
    }

    @Override
    public void save(Order order) {
        jpaRepo.save(mapper.toEntity(order));
    }

    @Override
    public List<Order> findPendingOrders(LocalDate since) {
        return jpaRepo.findByStatusAndCreatedAtAfter(
            OrderStatus.PENDING, since.atStartOfDay()
        ).stream().map(mapper::toDomain).toList();
    }
}
```

```java
// 외부 API Adapter
@Component
@RequiredArgsConstructor
public class TossPaymentGateway implements PaymentGateway {

    private final WebClient tossClient;
    private final MeterRegistry meterRegistry;

    @Override
    @CircuitBreaker(name = "tossPayment")
    @Retry(name = "tossPayment")
    public PaymentResult charge(PaymentRequest request) {
        return tossClient.post()
                .uri("/v1/payments/confirm")
                .bodyValue(toTossRequest(request))
                .retrieve()
                .bodyToMono(TossPaymentResponse.class)
                .map(this::toPaymentResult)
                .doOnSuccess(r -> meterRegistry.counter("payment.charge.success").increment())
                .doOnError(e -> meterRegistry.counter("payment.charge.failure").increment())
                .block(Duration.ofSeconds(5));
    }
}
```

**핵심:** Domain 패키지에는 JPA 어노테이션, Spring 어노테이션, 외부 SDK 타입이 하나도 없어야 합니다.

---

## 3) 패키지 설계 실무 팁

### 3-1) 기능(도메인) 기준으로 패키지를 먼저 나눈다

```
✅ 좋은 예: 기능 기준
com.example.shop.order.*
com.example.shop.payment.*
com.example.shop.shipping.*

❌ 나쁜 예: 기술 기준
com.example.shop.controller.*
com.example.shop.service.*
com.example.shop.entity.*
```

### 3-2) "공통(common)"은 마지막 수단이다

공통 모듈은 시간이 지나면 "모든 게 들어가는 쓰레기통"이 됩니다.

```
❌ 피해야 할 패턴
common/
├── utils/StringUtils.java
├── dto/ApiResponse.java
├── config/RedisConfig.java
├── domain/Money.java         ← 이건 진짜 공통?
└── exception/BusinessException.java

✅ 분리 기준
shared-kernel/                 ← 진짜 공통 (Money, ErrorCode)
├── Money.java
├── ErrorCode.java
└── ApiResponse.java

order/domain/                  ← 도메인별 로직은 각자
payment/domain/
```

**판별 기준:** "이 클래스를 모든 모듈이 같은 의미로 쓰는가?" → Yes면 공통, No면 각 모듈로.

### 3-3) 모듈의 '공개 API'를 최소화한다

```java
// ── order 모듈의 공개 API (Facade) ──
// 외부 모듈은 이것만 호출
@Service
@RequiredArgsConstructor
public class OrderFacade {

    private final OrderService orderService;

    /**
     * 외부 모듈에서 주문 정보가 필요할 때 사용.
     * 도메인 엔티티가 아닌 DTO를 반환하여 결합도를 줄임.
     */
    public OrderSummaryDto getOrderSummary(Long orderId) {
        return orderService.getSummary(orderId);
    }

    /**
     * 결제 완료 이벤트 수신 시 주문 상태 변경.
     */
    @EventListener
    public void onPaymentCompleted(PaymentCompletedEvent event) {
        orderService.markPaid(event.orderId());
    }
}
```

**규칙:** 외부 모듈에서 바로 엔티티/리포지토리를 호출하지 말 것. UseCase/Facade/DTO 같은 "경계"를 둡니다.

### 3-4) 모듈 간 통신 패턴

| 패턴 | 결합도 | 사용 시점 |
|------|--------|----------|
| Facade 직접 호출 | 중간 | 동기적, 트랜잭션 내 |
| 도메인 이벤트 (ApplicationEventPublisher) | 낮음 | 비동기적, 최종 일관성 가능 |
| 공유 인터페이스 (shared-kernel) | 낮음 | 계약 기반, API DTO 수준 |
| 메시지 큐 (Kafka/SQS) | 최저 | MSA, 물리적 분리 |

```java
// 이벤트 기반 느슨한 결합 예시
// order 모듈에서 발행
@Service
public class OrderService {
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public void completeOrder(OrderId orderId) {
        Order order = orderRepository.findById(orderId);
        order.complete();
        orderRepository.save(order);

        // 이벤트 발행 → payment, shipping 등 관심 모듈이 수신
        eventPublisher.publishEvent(new OrderCompletedEvent(
            order.getId(), order.getUserId(), order.getTotalAmount(), Instant.now()
        ));
    }
}

// shipping 모듈에서 수신
@Component
public class ShippingOrderEventListener {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderCompleted(OrderCompletedEvent event) {
        shippingService.prepareShipment(event.orderId());
    }
}
```

---

## 4) Gradle 멀티모듈 실전 구성

### 4-1) 프로젝트 구조

```
my-shop/
├── build.gradle.kts
├── settings.gradle.kts
├── core/
│   ├── core-domain/         ← 순수 도메인 (의존성 최소)
│   │   └── build.gradle.kts
│   └── core-shared/         ← 공통 DTO, 에러코드
│       └── build.gradle.kts
├── module/
│   ├── module-order/
│   │   └── build.gradle.kts
│   ├── module-payment/
│   │   └── build.gradle.kts
│   └── module-shipping/
│       └── build.gradle.kts
├── infra/
│   ├── infra-jpa/           ← JPA 구현
│   │   └── build.gradle.kts
│   ├── infra-redis/         ← Redis 구현
│   │   └── build.gradle.kts
│   └── infra-external-api/  ← 외부 API 클라이언트
│       └── build.gradle.kts
└── app/
    └── app-api/             ← 부트 실행 + Controller
        └── build.gradle.kts
```

### 4-2) settings.gradle.kts

```kotlin
rootProject.name = "my-shop"

include(
    ":core:core-domain",
    ":core:core-shared",
    ":module:module-order",
    ":module:module-payment",
    ":module:module-shipping",
    ":infra:infra-jpa",
    ":infra:infra-redis",
    ":infra:infra-external-api",
    ":app:app-api"
)
```

### 4-3) 각 모듈 의존성

```kotlin
// core-domain/build.gradle.kts
// 외부 프레임워크 의존성 최소화
dependencies {
    // JDK만 사용, Spring/JPA 없음
}

// module-order/build.gradle.kts
dependencies {
    implementation(project(":core:core-domain"))
    implementation(project(":core:core-shared"))
    // Spring은 application 레이어에서만
    implementation("org.springframework:spring-context")
    implementation("org.springframework:spring-tx")
}

// infra-jpa/build.gradle.kts
dependencies {
    implementation(project(":core:core-domain"))
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    runtimeOnly("org.postgresql:postgresql")
}

// app-api/build.gradle.kts
dependencies {
    implementation(project(":core:core-domain"))
    implementation(project(":core:core-shared"))
    implementation(project(":module:module-order"))
    implementation(project(":module:module-payment"))
    implementation(project(":module:module-shipping"))
    implementation(project(":infra:infra-jpa"))
    implementation(project(":infra:infra-redis"))
    implementation(project(":infra:infra-external-api"))
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

### 4-4) 의존성 방향 강제 (Gradle 빌드 실패)

```kotlin
// root build.gradle.kts
subprojects {
    afterEvaluate {
        // core-domain은 다른 모듈에 의존할 수 없음
        if (project.path == ":core:core-domain") {
            configurations.all {
                dependencies.forEach { dep ->
                    if (dep is ProjectDependency && dep.dependencyProject.path.startsWith(":module")) {
                        throw GradleException(
                            "core-domain은 module에 의존할 수 없습니다: ${dep.dependencyProject.path}"
                        )
                    }
                }
            }
        }
    }
}
```

---

## 5) ArchUnit으로 의존성 규칙 자동 검증

### 5-1) 의존성

```xml
<dependency>
    <groupId>com.tngtech.archunit</groupId>
    <artifactId>archunit-junit5</artifactId>
    <version>1.3.0</version>
    <scope>test</scope>
</dependency>
```

### 5-2) 핵심 아키텍처 테스트

```java
@AnalyzeClasses(packages = "com.example.shop")
public class ArchitectureTest {

    // 1. 도메인은 인프라를 몰라야 한다
    @ArchTest
    static final ArchRule domain_should_not_depend_on_infrastructure =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage("..infrastructure..", "..api..");

    // 2. 도메인은 Spring/JPA 프레임워크에 의존하지 않는다
    @ArchTest
    static final ArchRule domain_should_not_use_spring =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage(
                "org.springframework..",
                "jakarta.persistence..",
                "javax.persistence.."
            );

    // 3. 순환 의존 금지
    @ArchTest
    static final ArchRule no_cycles =
        slices().matching("com.example.shop.(*)..")
            .should().beFreeOfCycles();

    // 4. Controller는 Service/UseCase만 호출
    @ArchTest
    static final ArchRule controllers_should_only_call_services =
        classes()
            .that().resideInAPackage("..api..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage(
                "..api..", "..application..", "..domain..",
                "org.springframework..", "java..", "jakarta.."
            );

    // 5. Repository 구현은 infrastructure에만 존재
    @ArchTest
    static final ArchRule repository_impl_in_infrastructure =
        classes()
            .that().haveNameMatching(".*RepositoryImpl")
            .or().haveNameMatching("Jpa.*Repository")
            .should().resideInAPackage("..infrastructure..");

    // 6. 레이어드 아키텍처 전체 검증
    @ArchTest
    static final ArchRule layered_architecture =
        layeredArchitecture()
            .consideringAllDependencies()
            .layer("API").definedBy("..api..")
            .layer("Application").definedBy("..application..")
            .layer("Domain").definedBy("..domain..")
            .layer("Infrastructure").definedBy("..infrastructure..")
            .whereLayer("API").mayNotBeAccessedByAnyLayer()
            .whereLayer("Application").mayOnlyBeAccessedByLayers("API")
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Infrastructure")
            .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer();
}
```

### 5-3) 모듈 경계 검증

```java
@AnalyzeClasses(packages = "com.example.shop")
public class ModuleBoundaryTest {

    // 모듈 간 직접 접근 금지 (Facade를 통해서만)
    @ArchTest
    static final ArchRule order_module_encapsulation =
        classes()
            .that().resideInAPackage("com.example.shop.order.domain..")
            .or().resideInAPackage("com.example.shop.order.infrastructure..")
            .should().onlyBeAccessed()
            .byClassesThat().resideInAPackage("com.example.shop.order..");

    // payment 모듈이 order 내부에 직접 접근하면 안 됨
    @ArchTest
    static final ArchRule payment_should_not_access_order_internals =
        noClasses()
            .that().resideInAPackage("com.example.shop.payment..")
            .should().dependOnClassesThat()
            .resideInAnyPackage(
                "com.example.shop.order.domain..",
                "com.example.shop.order.infrastructure.."
            );
}
```

---

## 6) 멀티모듈 도입 기준과 단계적 분리

### 6-1) 언제 도입하는가

멀티모듈은 장점이 있지만 "복잡도"를 추가합니다. 다음이 명확할 때 도입하는 편이 좋습니다.

| 신호 | 설명 | 임계점 |
|------|------|--------|
| 빌드 시간 | 전체 빌드가 너무 느림 | 5분+ |
| 코드 충돌 | 같은 패키지에서 PR 충돌 빈번 | 주 3회+ |
| 의존성 침투 | Domain에 JPA 어노테이션 침투 | 1건이라도 |
| 팀 확장 | 기능별 팀 분리 필요 | 3팀+ |

### 6-2) 단계적 분리 전략

```
Phase 1: 패키지 분리 (0원, 0리스크)
├── 기능별 패키지로 재배치
├── 순환 의존 제거
└── ArchUnit 테스트 추가

Phase 2: Domain 모듈 추출 (낮은 리스크)
├── :core-domain 분리 (순수 Java)
├── 빌드에서 Spring/JPA 의존성 차단
└── Port 인터페이스 정의

Phase 3: Infrastructure 분리 (중간 리스크)
├── :infra-jpa, :infra-redis 분리
├── Adapter 구현 이동
└── 테스트에서 in-memory 구현 활용

Phase 4: 기능 모듈 분리 (주의 필요)
├── :module-order, :module-payment 분리
├── 모듈 간 통신을 이벤트/Facade로 전환
└── 독립 빌드/배포 가능 상태
```

---

## 7) 흔한 실패 패턴과 해결

| 안티패턴 | 증상 | 해결 |
|---------|------|------|
| God Module | 하나의 모듈이 모든 의존성 보유 | 기능별 분리 + 의존성 역전 |
| 순환 의존 | A→B→C→A | 인터페이스 추출, 이벤트 전환 |
| 공통 쓰레기통 | `common/`에 아무거나 추가 | shared-kernel 최소화 |
| 인프라 역침투 | Domain에 `@Entity`, `@Transactional` | ArchUnit으로 빌드 시 차단 |
| 과도한 분리 | 모듈 20개, 클래스 3개씩 | 합칠 것은 합치기 |
| DTO 복사 지옥 | 모듈마다 같은 DTO 중복 | shared 모듈에 DTO 정의 |

### 순환 의존 끊기 실전

```java
// ❌ 순환: Order → Payment, Payment → Order
class OrderService {
    @Autowired PaymentService paymentService;  // Order → Payment
}
class PaymentService {
    @Autowired OrderService orderService;      // Payment → Order ← 순환!
}

// ✅ 이벤트로 끊기
class OrderService {
    @Autowired ApplicationEventPublisher publisher;

    public void completeOrder(OrderId id) {
        // ... 주문 완료 처리
        publisher.publishEvent(new OrderCompletedEvent(id));
    }
}

class PaymentEventListener {
    @EventListener
    public void onOrderCompleted(OrderCompletedEvent event) {
        paymentService.processPayment(event.orderId());
    }
}
```

---

## 8) 운영 체크리스트

### 초기 도입 시
- [ ] 현재 순환 의존 파악 (`jdepend`, `degraph`, 또는 IntelliJ 분석)
- [ ] ArchUnit 기본 테스트 3개 추가 (레이어/순환/프레임워크 격리)
- [ ] 기능별 패키지 재배치 (Layered → Package-by-Feature)
- [ ] 공개 API(Facade) 정의 + 외부 모듈 직접 접근 차단

### 멀티모듈 전환 시
- [ ] Gradle/Maven 모듈 분리 + 의존성 방향 검증
- [ ] core-domain에서 Spring/JPA 의존성 완전 제거
- [ ] 각 모듈 단위 테스트 독립 실행 확인
- [ ] CI에서 ArchUnit + 의존성 규칙 자동 검증

### 성숙 단계
- [ ] 모듈별 코드 소유권(CODEOWNERS) 설정
- [ ] 변경 반경 지표 정기 측정 (PR당 변경 파일 수)
- [ ] 불필요한 모듈 간 의존성 정기 정리 (분기 1회)

---

## 연습(추천)

- 현재 프로젝트에서 "가장 자주 바뀌는 기능" 1개를 골라, 기능 기준 패키지로 재배치해보기(변경 반경이 줄어드는지 관찰)
- 도메인 레이어에 Port 인터페이스를 두고, 인프라 구현을 어댑터로 분리해보기(DB/외부 API 중 하나)
- ArchUnit 테스트를 3개 추가하고, CI에서 자동으로 의존성 규칙 위반을 잡아보기
- 순환 의존을 찾아(IDE/빌드 도구), 끊는 방법(인터페이스 분리/이벤트/DTO) 2가지를 시도해보기

---

## 관련 심화 학습

- [헥사고날 아키텍처](/learning/deep-dive/deep-dive-hexagonal-architecture/) — 포트/어댑터 기반 모듈 경계
- [모놀리스에서 모듈러로](/learning/deep-dive/deep-dive-monolith-to-modular/) — 실전 모듈 분리 전략
- [DDD Tactical 패턴](/learning/deep-dive/deep-dive-ddd-tactical/) — 도메인 기반 모듈 설계
- [빌드 도구 (Gradle/Maven)](/learning/deep-dive/deep-dive-build-tooling-gradle-maven/) — 멀티모듈 빌드 구성
- [Clean Code](/learning/deep-dive/deep-dive-clean-code/) — 코드 수준 구조 설계
- [Spring IoC/DI](/learning/deep-dive/deep-dive-spring-ioc-di/) — 의존성 주입과 모듈 경계
