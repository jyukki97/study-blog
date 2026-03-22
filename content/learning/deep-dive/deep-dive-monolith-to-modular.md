---
title: "모놀리스를 모듈러/서비스로 나누기"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Monolith", "Modularization", "Service Split", "Strangler", "DDD", "Module"]
categories: ["Backend Deep Dive"]
description: "모놀리스 코드베이스를 단계적으로 모듈러/서비스로 분리하는 전략 — 판별 기준, 실무 코드, 데이터 분리, Strangler 구현, 운영 체크리스트까지"
module: "architecture"
study_order: 430
---

## 이 글에서 얻는 것

- "모놀리스 vs 마이크로서비스"를 이분법으로 보지 않고, **모듈러 모놀리스(모듈화) → 점진 분리**의 현실적인 경로를 설계할 수 있습니다.
- 경계(도메인/데이터/트랜잭션)를 먼저 잡아 "분리했더니 더 어려워지는" 함정을 피할 수 있습니다.
- Strangler(점진 대체)로 트래픽을 안전하게 옮기고, 롤백 가능한 전환을 만드는 방법을 이해합니다.
- 실무 코드와 의사결정 프레임워크, 운영 체크리스트를 갖추게 됩니다.

---

## 0) "나누기"의 목표를 먼저 정하라

서비스를 나누는 이유가 불명확하면, 분리 후 운영 복잡도만 늘어납니다.

### 분리 목적 매트릭스

| 목적 | 모듈러 모놀리스로 해결? | 서비스 분리 필요? | 판단 기준 |
|------|:---:|:---:|------|
| 배포 독립성 | △ (모듈별 feature flag) | ✅ | 모듈별 배포 주기가 주 3회 이상 다를 때 |
| 수평 확장 | △ (특정 모듈만 스케일 불가) | ✅ | 특정 도메인 RPS가 전체의 80%+ |
| 변경 충돌 감소 | ✅ 패키지/의존성 규칙 | △ | 팀 4개 이상이 같은 코드베이스 |
| 장애 격리 | △ (프로세스 공유) | ✅ | 결제/핵심 도메인 blast radius 축소 |
| 기술 다양성 | ✗ | ✅ | ML(Python)과 API(Java) 공존 |

**의사결정 플로우차트:**

```
목표가 명확한가?
  ├─ NO → 모놀리스 유지. 목표부터 정해라.
  └─ YES
      └─ 모듈러 모놀리스로 충분한가?
          ├─ YES → 1단계: 모듈화
          └─ NO  → 2단계: 데이터 분리 → 3단계: Strangler 분리
```

---

## 1) 3가지 선택지 비교표

| 관점 | 모놀리스 | 모듈러 모놀리스 | 마이크로서비스 |
|------|---------|---------------|-------------|
| 배포 단위 | 하나 | 하나(내부 경계 분리) | 도메인별 독립 |
| 개발 속도(초기) | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| 개발 속도(팀 10+명) | ⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 운영 복잡도 | 낮음 | 낮음 | **높음** |
| 장애 격리 | ✗ | △ | ✅ |
| 독립 확장 | ✗ | ✗ | ✅ |
| 데이터 일관성 | 단일 TX | 단일 TX | 최종 일관성 |
| 적합 시점 | 초기~중기 | 중기~성장 | 대규모·멀티팀 |

대부분의 팀은 **모듈러 모놀리스에서 큰 가치**를 얻고, 필요할 때만 서비스 분리로 넘어갑니다.

---

## 2) 0단계: 경계를 잡는다 — 도메인/데이터/트랜잭션

분리는 "코드"보다 "경계"가 먼저입니다. 경계를 잘못 잡으면 분리 후에도 서로의 DB를 찌르고 호출이 난무합니다.

### 2-1) 도메인 경계 식별 — 이벤트 스토밍 기반

```
[이벤트 스토밍 워크숍 결과]

주문 Bounded Context:        결제 Bounded Context:
┌──────────────────┐         ┌──────────────────┐
│ OrderCreated     │────────→│ PaymentRequested  │
│ OrderCancelled   │         │ PaymentCompleted  │
│ OrderShipped     │         │ PaymentFailed     │
└──────────────────┘         └──────────────────┘
         │
         ↓
배송 Bounded Context:
┌──────────────────┐
│ ShipmentCreated  │
│ ShipmentDelivered│
└──────────────────┘
```

### 2-2) 데이터 소유권 매핑(필수)

분리 전에 **테이블 소유권 표**를 반드시 만드세요:

| 테이블 | 현재 접근 모듈 | 소유권 후보 | 조인 의존 |
|--------|-------------|-----------|----------|
| `orders` | 주문, 결제, 배송 | 주문 | `users`, `products` |
| `payments` | 결제, 주문 | 결제 | `orders` |
| `shipments` | 배송, 주문 | 배송 | `orders` |
| `users` | 전체 | 계정 | 없음 |
| `products` | 주문, 검색 | 상품 | `categories` |

**핵심:** 3개 이상의 모듈이 직접 접근하는 테이블은 분리 난이도가 높으므로 후순위로 미룹니다.

### 2-3) 트랜잭션 경계 분석

```java
// ❌ 분리 불가한 강결합 트랜잭션 (한 TX에 3개 도메인)
@Transactional
public void placeOrder(OrderRequest req) {
    Order order = orderRepository.save(toOrder(req));
    Payment payment = paymentRepository.save(toPayment(order));
    Inventory inventory = inventoryRepository.decrementStock(req.getProductId(), req.getQty());
    // → 세 도메인이 한 트랜잭션에 묶여 있음
}
```

```java
// ✅ 분리 가능한 설계: 이벤트 기반 느슨한 결합
@Transactional
public void placeOrder(OrderRequest req) {
    Order order = orderRepository.save(toOrder(req));
    // 주문 컨텍스트 내에서만 트랜잭션
    eventPublisher.publish(new OrderCreatedEvent(order.getId(), req.getProductId(), req.getQty()));
}

// 결제 모듈 — 별도 트랜잭션
@EventListener
@Transactional
public void onOrderCreated(OrderCreatedEvent event) {
    paymentService.requestPayment(event.getOrderId());
}

// 재고 모듈 — 별도 트랜잭션
@EventListener
@Transactional
public void onOrderCreated(OrderCreatedEvent event) {
    inventoryService.reserve(event.getProductId(), event.getQty());
}
```

---

## 3) 1단계: 모듈러 모놀리스로 '먼저' 정리

### 3-1) 패키지 구조 — 기능 기준 분리

```
com.example.shop/
├── order/                    # 주문 모듈
│   ├── api/                  # 외부 노출 (Controller)
│   ├── application/          # UseCase/Service
│   ├── domain/               # Entity, VO, Repository(interface)
│   ├── infrastructure/       # JPA impl, 외부 API client
│   └── OrderModuleApi.java   # 다른 모듈이 호출하는 공개 인터페이스
├── payment/                  # 결제 모듈
│   ├── api/
│   ├── application/
│   ├── domain/
│   ├── infrastructure/
│   └── PaymentModuleApi.java
├── shipping/                 # 배송 모듈
└── shared/                   # 공통 (최소화!)
    ├── event/                # 도메인 이벤트 정의
    └── vo/                   # Money, Address 등 공용 VO
```

### 3-2) 모듈 간 의존성 규칙 (ArchUnit 강제)

```java
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

public class ModuleBoundaryTest {

    @Test
    void 주문모듈은_결제_infrastructure에_직접_접근하지_않는다() {
        ArchRule rule = noClasses()
            .that().resideInAPackage("..order..")
            .should().accessClassesThat()
            .resideInAPackage("..payment.infrastructure..");

        rule.check(new ClassFileImporter()
            .importPackages("com.example.shop"));
    }

    @Test
    void 모듈간_통신은_ModuleApi를_통해서만_한다() {
        ArchRule rule = noClasses()
            .that().resideInAPackage("..order.application..")
            .should().accessClassesThat()
            .resideInAPackage("..payment.application..");

        rule.check(new ClassFileImporter()
            .importPackages("com.example.shop"));
    }
}
```

### 3-3) 모듈 공개 API (Facade) 패턴

```java
// payment/PaymentModuleApi.java — 결제 모듈의 유일한 공개 인터페이스
public interface PaymentModuleApi {
    PaymentResult requestPayment(PaymentCommand cmd);
    PaymentStatus getStatus(Long paymentId);
    void cancelPayment(Long paymentId);
}

// payment/application/PaymentModuleApiImpl.java
@Service
class PaymentModuleApiImpl implements PaymentModuleApi {
    private final PaymentService paymentService;

    @Override
    public PaymentResult requestPayment(PaymentCommand cmd) {
        return paymentService.process(cmd);
    }

    @Override
    public PaymentStatus getStatus(Long paymentId) {
        return paymentService.findStatus(paymentId);
    }

    @Override
    public void cancelPayment(Long paymentId) {
        paymentService.cancel(paymentId);
    }
}
```

**규칙:** 다른 모듈이 결제 기능을 쓸 때는 반드시 `PaymentModuleApi`만 호출. 내부 Service, Repository에 직접 접근 금지.

---

## 4) 2단계: 데이터 분리 전략

### 4-1) 분리 전략 비교표

| 전략 | 복잡도 | 결합도 | 적합 시점 |
|------|:---:|:---:|------|
| 공유 DB + 스키마 분리 | 낮음 | 높음(JOIN 가능) | 초기 전환기 |
| 논리적 분리(뷰/동의어) | 중간 | 중간 | 읽기 모델만 공유 |
| DB 물리 분리 | 높음 | 낮음 | 목표 상태 |
| CDC/이벤트 동기화 | 높음 | 낮음 | 파생 데이터(검색/통계) |

### 4-2) 점진적 데이터 분리 로드맵

```
Phase 1: 스키마 분리 (1~2주)
─────────────────────────────
같은 DB 인스턴스, 스키마를 모듈별로 분리
  - order_schema.orders
  - payment_schema.payments
Cross-schema JOIN은 허용하되 목록으로 관리

    ↓

Phase 2: 읽기 경로 분리 (2~4주)
─────────────────────────────
다른 모듈 데이터가 필요하면 API 호출 or 이벤트 구독
  - 주문 → 결제 상태: PaymentModuleApi.getStatus()
  - 검색 → 상품 데이터: CDC로 Elasticsearch 동기화

    ↓

Phase 3: DB 물리 분리 (4~8주)
─────────────────────────────
모듈별 독립 DB 인스턴스
  - order-db, payment-db, shipping-db
  - Cross-schema JOIN 0건 달성 후 분리
```

### 4-3) 분산 트랜잭션 대안: Saga 패턴

```java
// Choreography Saga — 이벤트 기반 (소규모·단순 흐름)
@Component
public class OrderSaga {

    @EventListener
    public void onOrderCreated(OrderCreatedEvent e) {
        // 결제 요청 이벤트 발행
        eventPublisher.publish(new PaymentRequestedEvent(e.getOrderId(), e.getAmount()));
    }

    @EventListener
    public void onPaymentCompleted(PaymentCompletedEvent e) {
        // 재고 차감 이벤트 발행
        eventPublisher.publish(new InventoryReserveEvent(e.getOrderId()));
    }

    @EventListener
    public void onPaymentFailed(PaymentFailedEvent e) {
        // 보상 트랜잭션: 주문 취소
        orderService.cancelOrder(e.getOrderId());
    }

    @EventListener
    public void onInventoryFailed(InventoryReserveFailedEvent e) {
        // 보상 트랜잭션: 결제 취소 → 주문 취소
        paymentService.refund(e.getOrderId());
        orderService.cancelOrder(e.getOrderId());
    }
}
```

```java
// Orchestration Saga — 중앙 조정자 (복잡한 흐름)
@Service
public class OrderOrchestrator {

    public OrderResult placeOrder(OrderCommand cmd) {
        // 1. 주문 생성
        Order order = orderService.create(cmd);

        // 2. 결제 시도
        PaymentResult payment = paymentClient.requestPayment(order);
        if (payment.isFailed()) {
            orderService.cancel(order.getId());
            return OrderResult.failed("결제 실패");
        }

        // 3. 재고 차감 시도
        InventoryResult inventory = inventoryClient.reserve(order);
        if (inventory.isFailed()) {
            paymentClient.refund(order.getId());   // 보상
            orderService.cancel(order.getId());     // 보상
            return OrderResult.failed("재고 부족");
        }

        // 4. 성공
        orderService.confirm(order.getId());
        return OrderResult.success(order);
    }
}
```

| 비교 | Choreography | Orchestration |
|------|:---:|:---:|
| 구현 복잡도 | 낮음 | 높음 |
| 흐름 가시성 | 낮음(이벤트 추적 어려움) | 높음(조정자에 로직 집중) |
| 결합도 | 낮음 | 중간(조정자가 모든 서비스 알아야 함) |
| 적합 | 단계 3개 이하 단순 흐름 | 단계 4개+ 복잡한 보상 로직 |

---

## 5) 3단계: Strangler로 점진 분리

### 5-1) Strangler 전환 3단계 구현

```
┌─────────────────────────────────────────┐
│              API Gateway                │
│  (Spring Cloud Gateway / Nginx)         │
│                                         │
│  /api/orders/** ───┐                    │
│  /api/payments/** ─┼──→ 라우팅 결정     │
│  /api/shipping/** ─┘                    │
└───────────┬──────────────┬──────────────┘
            │              │
            ▼              ▼
     ┌──────────┐   ┌──────────┐
     │ 모놀리스  │   │ 새 서비스 │
     │ (Legacy) │   │ (결제)   │
     └──────────┘   └──────────┘
```

**Spring Cloud Gateway 설정 예시:**

```yaml
spring:
  cloud:
    gateway:
      routes:
        # Phase 1: Shadow (미러링) — 결과 비교만, 응답은 모놀리스
        - id: payment-shadow
          uri: http://payment-service:8080
          predicates:
            - Path=/api/payments/**
            - Header=X-Shadow, true
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20

        # Phase 2: Canary — 10% 트래픽만 새 서비스
        - id: payment-canary
          uri: http://payment-service:8080
          predicates:
            - Path=/api/payments/**
            - Weight=payment-group, 10
          metadata:
            response-timeout: 3000

        # Phase 3: Cutover — 100% 새 서비스
        - id: payment-new
          uri: http://payment-service:8080
          predicates:
            - Path=/api/payments/**
```

### 5-2) Shadow(미러링) 검증 코드

```java
@Component
public class ShadowVerifier {

    private final MeterRegistry meterRegistry;
    private final Counter matchCounter;
    private final Counter mismatchCounter;

    public ShadowVerifier(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        this.matchCounter = Counter.builder("shadow.result")
            .tag("outcome", "match").register(meterRegistry);
        this.mismatchCounter = Counter.builder("shadow.result")
            .tag("outcome", "mismatch").register(meterRegistry);
    }

    public void verify(String endpoint, Object legacyResponse, Object newResponse) {
        if (Objects.equals(legacyResponse, newResponse)) {
            matchCounter.increment();
        } else {
            mismatchCounter.increment();
            log.warn("[Shadow Mismatch] endpoint={}, legacy={}, new={}",
                endpoint,
                truncate(legacyResponse),
                truncate(newResponse));
        }
    }
}
```

### 5-3) Canary 전환 기준 & 롤백 조건

| 단계 | 트래픽 비율 | 기간 | 진행 조건 | 즉시 롤백 조건 |
|------|:---:|:---:|------|------|
| Shadow | 0% (미러링) | 1주 | 불일치율 < 0.1% | 불일치율 > 5% |
| Canary 10% | 10% | 3일 | 에러율 < 0.5%, P99 < 기존 1.2x | 에러율 > 2% or P99 > 기존 2x |
| Canary 50% | 50% | 3일 | 동일 기준 | 동일 기준 |
| Cutover | 100% | - | 7일 안정 | 동일 기준 |
| Legacy 제거 | - | 2주 유예 | Cutover 후 2주 무사고 | - |

**롤백 자동화 (Prometheus Alert → Gateway 설정 변경):**

```yaml
# Prometheus alerting rule
groups:
  - name: strangler-canary
    rules:
      - alert: CanaryErrorRateHigh
        expr: |
          rate(http_server_requests_seconds_count{service="payment-new", status=~"5.."}[5m])
          / rate(http_server_requests_seconds_count{service="payment-new"}[5m])
          > 0.02
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Canary 에러율 2% 초과 — 자동 롤백 트리거"
```

---

## 6) Anti-Corruption Layer (ACL)

새 서비스와 레거시 사이에 변환 계층을 두어 모델이 오염되지 않게 합니다:

```java
// 새 결제 서비스에서 레거시 주문 데이터를 받을 때
@Component
public class LegacyOrderAntiCorruptionLayer {

    private final LegacyOrderClient legacyClient;

    /**
     * 레거시 주문 모델 → 새 결제 컨텍스트의 PaymentOrder로 변환
     * 레거시의 nullable 필드, 다른 이름, 다른 단위를 여기서 정리
     */
    public PaymentOrder toPaymentOrder(Long orderId) {
        LegacyOrderDto legacy = legacyClient.getOrder(orderId);

        return PaymentOrder.builder()
            .orderId(legacy.getId())
            .amount(Money.won(legacy.getTotalPrice()))  // 레거시: int → Money VO
            .customerEmail(Objects.requireNonNullElse(
                legacy.getEmail(), "unknown@example.com"))
            .currency("KRW")  // 레거시에는 통화 필드 없음 — 기본값
            .build();
    }
}
```

---

## 7) 흔한 함정과 대응

| 함정 | 증상 | 대응 |
|------|------|------|
| 분산 모놀리스 | 서비스 분리했는데 동기 호출이 20+개 | 이벤트 기반으로 전환, 비동기 우선 |
| 공유 라이브러리 지옥 | 공통 모듈 버전 업데이트 시 전체 배포 | 공통은 VO/이벤트 정의만, 로직 금지 |
| 데이터 조인 필요 | 분리 후 JOIN 없어 성능 저하 | CQRS 읽기 모델 or 데이터 복제 |
| 장애 전파 | 서비스 A → B → C 동기 호출 연쇄 | Circuit Breaker + Fallback + Timeout |
| 테스트 어려움 | 통합 테스트가 전체 서비스 필요 | Contract Testing (Pact/Spring Cloud Contract) |

### Contract Testing 예시 (Consumer-Driven)

```java
// 소비자(주문 서비스)가 결제 API에 기대하는 계약
@Pact(consumer = "order-service", provider = "payment-service")
public RequestResponsePact createPaymentPact(PactDslWithProvider builder) {
    return builder
        .given("결제 가능한 주문이 존재")
        .uponReceiving("결제 요청")
            .method("POST")
            .path("/api/payments")
            .body(new PactDslJsonBody()
                .integerType("orderId", 1001)
                .decimalType("amount", 50000.0))
        .willRespondWith()
            .status(200)
            .body(new PactDslJsonBody()
                .stringType("paymentId")
                .stringValue("status", "COMPLETED"))
        .toPact();
}
```

---

## 8) 분리 준비도 체크리스트

### Phase 0: 분리 판별 (1~2일)

- [ ] 분리 목적(배포 독립/확장/장애 격리)이 문서화되었는가?
- [ ] 모듈러 모놀리스로 충분하지 않은 근거가 있는가?
- [ ] 현재 팀/조직 구조가 서비스 운영을 감당할 수 있는가?

### Phase 1: 모듈러 모놀리스 정리 (2~4주)

- [ ] 도메인별 패키지 분리 완료
- [ ] ArchUnit 의존성 규칙 테스트 추가
- [ ] 모듈 간 통신은 ModuleApi/Facade를 통해서만
- [ ] 이벤트 스토밍 결과 → Bounded Context 매핑 문서화

### Phase 2: 데이터 분리 (4~8주)

- [ ] 테이블 소유권 표 작성
- [ ] Cross-schema JOIN 목록 및 제거 계획
- [ ] Saga/보상 트랜잭션 설계
- [ ] CDC/이벤트 동기화 파이프라인 구축 (필요 시)

### Phase 3: Strangler 전환 (4~8주)

- [ ] API Gateway 라우팅 규칙 설정
- [ ] Shadow 검증 1주 → 불일치율 < 0.1%
- [ ] Canary 10% → 50% → 100% 단계별 전환
- [ ] 롤백 자동화 알림/스크립트 준비
- [ ] Legacy 코드 제거 일정 합의 (Cutover 후 2주)

### 운영 준비

- [ ] 분산 트레이싱 (Zipkin/Jaeger) 구축
- [ ] Circuit Breaker (Resilience4j) 설정
- [ ] 서비스별 독립 모니터링 대시보드
- [ ] Contract Test CI 파이프라인
- [ ] Runbook: 장애 시 롤백 절차 문서화

---

## 연습(추천)

1. **소유권 표 만들기**: 현재 프로젝트의 테이블/컬렉션을 나열하고, 어떤 모듈이 접근하는지 표로 정리. 소유권이 불명확한 테이블이 몇 개인지 세보기.
2. **ArchUnit 적용**: 기존 프로젝트에 모듈 경계 규칙을 추가하고, 위반 건수를 트래킹. 매주 줄여나가기.
3. **Strangler 시나리오 작성**: 가장 독립적인 도메인 1개를 골라 Shadow → Canary → Cutover 전환 계획서를 작성. 롤백 조건과 모니터링 지표 포함.
4. **Saga 보상 설계**: 주문→결제→재고 흐름에서 각 단계 실패 시 보상 트랜잭션을 그려보기. Choreography/Orchestration 중 어느 것이 적합한지 판단.

---

## 관련 심화 학습

- [레거시 리팩터링 전략](/learning/deep-dive/deep-dive-legacy-refactoring-strategy/) — Strangler, Branch by Abstraction
- [모듈 아키텍처](/learning/deep-dive/deep-dive-module-architecture/) — 패키지 설계와 의존성 규칙
- [헥사고날 아키텍처](/learning/deep-dive/deep-dive-hexagonal-architecture/) — 분리 목표 아키텍처
- [MSA 패턴](/learning/deep-dive/deep-dive-msa-patterns/) — 모듈러 → MSA 전환 시 참고
- [도메인 모델링과 Aggregate](/learning/deep-dive/deep-dive-domain-modeling-aggregates/) — 모듈 경계의 도메인 기준
- [이벤트 소싱과 CQRS](/learning/deep-dive/deep-dive-event-sourcing-cqrs/) — 데이터 분리 후 읽기 모델
- [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/) — 이벤트 기반 데이터 동기화
- [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/) — 서비스 간 계약 검증
- [트래픽 전환과 마이그레이션](/learning/deep-dive/deep-dive-traffic-cutover-migration/) — Strangler Cutover 상세
