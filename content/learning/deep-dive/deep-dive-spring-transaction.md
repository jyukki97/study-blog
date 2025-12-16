---
title: "Spring Transaction: @Transactional 동작 원리와 실전 함정"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Transaction", "@Transactional", "Propagation", "Isolation"]
categories: ["Backend Deep Dive"]
description: "전파/격리/롤백 규칙과 프록시 동작, self-invocation/checked exception 같은 실무 함정을 한 번에 정리"
module: "spring-core"
study_order: 144
---

## 이 글에서 얻는 것

- `@Transactional`이 **프록시(AOP)** 로 동작한다는 걸 이해하고, 왜 특정 호출에서 적용되지 않는지 설명할 수 있습니다.
- 전파(Propagation)와 격리(Isolation)를 “암기”가 아니라, 실무 시나리오(재시도/보상/락)로 선택할 수 있습니다.
- 자주 터지는 함정(checked exception 롤백, private/self-invocation, OSIV, LazyInitializationException)을 예방/디버깅할 수 있습니다.

## 들어가며

Spring의 트랜잭션 관리는 데이터 일관성을 보장하는 핵심 메커니즘입니다. 이 글에서는 `@Transactional` 애노테이션의 동작 원리부터 실전 사용법, 흔한 함정과 해결책까지 다룹니다.

**난이도**: ⭐⭐ 중급
**예상 학습 시간**: 40분

---

## 1. Spring Transaction 기초 개념

### 1.1 트랜잭션의 ACID 속성

```
ACID 속성:
┌─────────────────────────────────────────────────┐
│ Atomicity (원자성)                               │
│  - All or Nothing                               │
│  - 전체 성공 or 전체 실패                          │
│                                                 │
│ Consistency (일관성)                             │
│  - 데이터 무결성 유지                             │
│  - 비즈니스 규칙 준수                             │
│                                                 │
│ Isolation (격리성)                               │
│  - 동시 실행 트랜잭션 간 격리                      │
│  - READ_UNCOMMITTED ~ SERIALIZABLE             │
│                                                 │
│ Durability (영속성)                              │
│  - 커밋 후 영구 보존                              │
│  - 시스템 장애에도 데이터 보존                     │
└─────────────────────────────────────────────────┘
```

### 1.2 Spring Transaction 아키텍처

```java
// Spring Transaction의 3가지 핵심 컴포넌트
PlatformTransactionManager
    ↓ 구현체
DataSourceTransactionManager (JDBC)
JpaTransactionManager (JPA)
HibernateTransactionManager (Hibernate)

TransactionDefinition
    - propagation (전파 속성)
    - isolation (격리 수준)
    - timeout (타임아웃)
    - readOnly (읽기 전용)

TransactionStatus
    - isNewTransaction()
    - isRollbackOnly()
    - setRollbackOnly()
```

---

## 2. @Transactional 동작 원리

### 2.1 AOP 기반 Proxy 패턴

```java
// @Transactional 동작 원리
public class OrderService {

    @Transactional
    public void createOrder(Order order) {
        orderRepository.save(order);
        // 비즈니스 로직...
    }
}

// Spring이 생성하는 Proxy 객체 (개념적 표현)
public class OrderService$$SpringProxy extends OrderService {

    private OrderService target;
    private PlatformTransactionManager txManager;

    @Override
    public void createOrder(Order order) {
        TransactionStatus status = txManager.getTransaction(definition);
        try {
            target.createOrder(order);  // 실제 메서드 호출
            txManager.commit(status);
        } catch (Exception e) {
            txManager.rollback(status);
            throw e;
        }
    }
}
```

**핵심 동작 흐름:**

```
클라이언트
    ↓
Proxy 객체 (AOP)
    ↓
1. TransactionManager.getTransaction() - 트랜잭션 시작
    ↓
2. 실제 비즈니스 메서드 실행
    ↓
3. 성공: commit() / 실패: rollback()
    ↓
클라이언트로 반환
```

### 2.2 트랜잭션 동기화 (Transaction Synchronization)

```java
// Spring의 트랜잭션 동기화 메커니즘
@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final PaymentRepository paymentRepository;

    @Transactional
    public void processOrder(Order order, Payment payment) {
        // 1. 트랜잭션 시작 (커넥션 획득)
        // ThreadLocal에 Connection 저장

        orderRepository.save(order);
        // 동일한 Connection 재사용

        paymentRepository.save(payment);
        // 동일한 Connection 재사용

        // 2. 트랜잭션 커밋
        // Connection 반환
    }
}

// 내부적으로 ThreadLocal 사용
public class TransactionSynchronizationManager {

    private static final ThreadLocal<Map<Object, Object>> resources =
        new NamedThreadLocal<>("Transactional resources");

    public static void bindResource(Object key, Object value) {
        // 현재 스레드에 Connection 바인딩
        resources.get().put(key, value);
    }
}
```

---

## 3. Propagation (전파 속성)

### 3.1 7가지 전파 속성

| Propagation | 설명 | 기존 트랜잭션 | 신규 트랜잭션 |
|-------------|------|--------------|--------------|
| **REQUIRED** (기본값) | 기존 트랜잭션 참여, 없으면 생성 | 참여 | 생성 |
| **REQUIRES_NEW** | 항상 새 트랜잭션 생성 | 일시 중단 | 생성 |
| **SUPPORTS** | 기존 트랜잭션 참여, 없으면 트랜잭션 없이 실행 | 참여 | - |
| **NOT_SUPPORTED** | 트랜잭션 없이 실행 (기존 트랜잭션 일시 중단) | 일시 중단 | - |
| **MANDATORY** | 기존 트랜잭션 필수 (없으면 예외) | 참여 | Exception |
| **NEVER** | 트랜잭션 없이 실행 (기존 트랜잭션 있으면 예외) | Exception | - |
| **NESTED** | 중첩 트랜잭션 (Savepoint 사용) | Savepoint | - |

### 3.2 REQUIRED vs REQUIRES_NEW 실전 비교

```java
// REQUIRED (기본값) - 트랜잭션 공유
@Service
public class OrderService {

    private final PaymentService paymentService;

    @Transactional  // TX1 시작
    public void createOrder(Order order) {
        orderRepository.save(order);

        paymentService.processPayment(order.getId());  // TX1 참여

        // paymentService에서 예외 발생 시 전체 롤백!
    }
}

@Service
public class PaymentService {

    @Transactional(propagation = Propagation.REQUIRED)  // TX1 참여
    public void processPayment(Long orderId) {
        // 동일한 트랜잭션 (TX1)
        paymentRepository.save(payment);

        if (/* 결제 실패 */) {
            throw new PaymentException();  // 전체 롤백
        }
    }
}
```

```java
// REQUIRES_NEW - 독립적인 트랜잭션
@Service
public class OrderService {

    private final PaymentService paymentService;

    @Transactional  // TX1 시작
    public void createOrder(Order order) {
        orderRepository.save(order);  // TX1

        try {
            paymentService.processPayment(order.getId());  // TX2 (새 트랜잭션)
        } catch (PaymentException e) {
            // paymentService는 롤백되지만, order는 커밋됨
            log.error("결제 실패: {}", e.getMessage());
        }

        // order는 커밋됨!
    }
}

@Service
public class PaymentService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)  // TX2 시작
    public void processPayment(Long orderId) {
        // 독립적인 트랜잭션 (TX2)
        paymentRepository.save(payment);

        if (/* 결제 실패 */) {
            throw new PaymentException();  // TX2만 롤백
        }
    }
}
```

### 3.3 NESTED - 중첩 트랜잭션 (Savepoint)

```java
// NESTED - Savepoint 활용
@Service
public class OrderService {

    @Transactional  // 외부 트랜잭션
    public void createOrderWithCoupon(Order order, Coupon coupon) {
        orderRepository.save(order);  // 1. 주문 저장

        try {
            couponService.useCoupon(coupon);  // 2. 쿠폰 사용 (Savepoint)
        } catch (CouponException e) {
            // 쿠폰 사용만 롤백, 주문은 유지
            log.warn("쿠폰 사용 실패: {}", e.getMessage());
        }

        // 주문은 커밋됨 (쿠폰 없이)
    }
}

@Service
public class CouponService {

    @Transactional(propagation = Propagation.NESTED)  // Savepoint 생성
    public void useCoupon(Coupon coupon) {
        // Savepoint 설정됨
        couponRepository.use(coupon);

        if (!coupon.isValid()) {
            throw new CouponException();  // Savepoint로 롤백
        }
    }
}
```

**동작 흐름 (NESTED):**

```
TX 시작
    ↓
1. orderRepository.save(order)  ✅
    ↓
Savepoint 생성
    ↓
2. couponRepository.use(coupon)  ❌ 예외 발생
    ↓
Savepoint로 롤백 (2번만 취소)
    ↓
TX 커밋 (1번은 유지)
```

---

## 4. Isolation Level (격리 수준)

### 4.1 4가지 격리 수준과 문제점

| Isolation Level | Dirty Read | Non-Repeatable Read | Phantom Read | 성능 |
|----------------|------------|---------------------|--------------|------|
| **READ_UNCOMMITTED** | O | O | O | 최고 |
| **READ_COMMITTED** | X | O | O | 높음 |
| **REPEATABLE_READ** | X | X | O | 보통 |
| **SERIALIZABLE** | X | X | X | 최저 |

**동시성 문제 설명:**

```java
// Dirty Read: 커밋되지 않은 데이터 읽기
// TX1
UPDATE product SET stock = 90 WHERE id = 1;
// (아직 커밋 안 함)

// TX2 (READ_UNCOMMITTED)
SELECT stock FROM product WHERE id = 1;  // 90 읽음 (Dirty Read)

// TX1
ROLLBACK;  // stock은 실제로 100으로 유지됨

// TX2는 잘못된 데이터(90)를 읽음!
```

```java
// Non-Repeatable Read: 같은 쿼리, 다른 결과
// TX1 (READ_COMMITTED)
SELECT stock FROM product WHERE id = 1;  // 100

// TX2
UPDATE product SET stock = 90 WHERE id = 1;
COMMIT;

// TX1
SELECT stock FROM product WHERE id = 1;  // 90 (값이 바뀜!)
```

```java
// Phantom Read: 같은 조건, 다른 레코드 수
// TX1 (REPEATABLE_READ)
SELECT COUNT(*) FROM orders WHERE status = 'PENDING';  // 10

// TX2
INSERT INTO orders (status) VALUES ('PENDING');
COMMIT;

// TX1
SELECT COUNT(*) FROM orders WHERE status = 'PENDING';  // 11 (새 레코드!)
```

### 4.2 MySQL InnoDB의 격리 수준 (REPEATABLE_READ)

```java
// MySQL InnoDB는 기본적으로 REPEATABLE_READ
@Service
public class ProductService {

    @Transactional(isolation = Isolation.REPEATABLE_READ)  // 기본값
    public void decreaseStock(Long productId, int quantity) {
        // 1. 조회 시점의 스냅샷 생성 (MVCC)
        Product product = productRepository.findById(productId).orElseThrow();

        // 2. 다른 트랜잭션이 stock을 변경해도 영향 없음
        // MVCC(Multi-Version Concurrency Control)로 일관된 읽기 보장

        // 3. 재고 감소
        product.decreaseStock(quantity);

        // 4. 커밋 시점에 실제 변경 반영
    }
}

// MVCC 동작 원리
┌─────────────────────────────────────────┐
│ Undo Log (버전 관리)                      │
├─────────────────────────────────────────┤
│ stock = 100 (TX 시작 시점 스냅샷)         │
│ stock = 95  (다른 TX가 변경)              │
│ stock = 90  (또 다른 TX가 변경)           │
└─────────────────────────────────────────┘
     ↓
현재 TX는 항상 시작 시점의 스냅샷(100) 읽음
```

### 4.3 실전 격리 수준 선택

```java
// 1. 금융 거래: SERIALIZABLE (최고 격리 수준)
@Transactional(isolation = Isolation.SERIALIZABLE)
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    Account from = accountRepository.findById(fromId).orElseThrow();
    Account to = accountRepository.findById(toId).orElseThrow();

    from.withdraw(amount);
    to.deposit(amount);

    // 다른 트랜잭션의 간섭 완전 차단
}

// 2. 재고 차감: REPEATABLE_READ + 비관적 락
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void purchaseProduct(Long productId, int quantity) {
    Product product = productRepository.findByIdWithLock(productId);
    // SELECT ... FOR UPDATE (비관적 락)

    product.decreaseStock(quantity);
}

// 3. 조회 전용: READ_COMMITTED
@Transactional(isolation = Isolation.READ_COMMITTED, readOnly = true)
public List<Product> getProducts() {
    return productRepository.findAll();
    // 읽기 전용, 성능 최적화
}
```

---

## 5. 흔한 함정과 해결책

### 5.1 함정 #1: Private 메서드에 @Transactional

```java
// ❌ 동작하지 않음
@Service
public class OrderService {

    public void processOrder(Order order) {
        // Proxy를 거치지 않음
        createOrder(order);  // 트랜잭션 적용 안 됨!
    }

    @Transactional  // 무시됨!
    private void createOrder(Order order) {
        orderRepository.save(order);
    }
}

// ✅ 해결책 1: Public 메서드로 변경
@Service
public class OrderService {

    @Transactional  // 정상 동작
    public void createOrder(Order order) {
        orderRepository.save(order);
    }
}

// ✅ 해결책 2: Self-Injection (Spring 4.3+)
@Service
public class OrderService {

    @Autowired
    private OrderService self;  // 자기 자신 주입

    public void processOrder(Order order) {
        self.createOrder(order);  // Proxy를 통한 호출
    }

    @Transactional
    public void createOrder(Order order) {
        orderRepository.save(order);
    }
}
```

### 5.2 함정 #2: Checked Exception과 롤백

```java
// ❌ Checked Exception은 기본적으로 롤백 안 됨
@Transactional
public void createOrder(Order order) throws Exception {
    orderRepository.save(order);

    if (order.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
        throw new Exception("잘못된 금액");  // 롤백 안 됨!
    }
}

// ✅ 해결책 1: RuntimeException 사용
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);

    if (order.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
        throw new IllegalArgumentException("잘못된 금액");  // 롤백됨
    }
}

// ✅ 해결책 2: rollbackFor 명시
@Transactional(rollbackFor = Exception.class)
public void createOrder(Order order) throws Exception {
    orderRepository.save(order);

    if (order.getAmount().compareTo(BigDecimal.ZERO) <= 0) {
        throw new Exception("잘못된 금액");  // 롤백됨
    }
}

// ✅ 해결책 3: noRollbackFor로 특정 예외 제외
@Transactional(noRollbackFor = ValidationException.class)
public void createOrder(Order order) {
    orderRepository.save(order);

    if (!order.isValid()) {
        throw new ValidationException();  // 롤백 안 됨 (커밋됨)
    }
}
```

### 5.3 함정 #3: @Transactional과 @Async 함께 사용

```java
// ❌ 비동기 메서드에서 트랜잭션 적용 안 됨
@Service
public class NotificationService {

    @Async
    @Transactional  // 새 스레드에서 실행되므로 트랜잭션 전파 안 됨!
    public void sendNotification(Long userId) {
        // 별도 스레드에서 실행
        notificationRepository.save(notification);
    }
}

// ✅ 해결책: 별도의 서비스로 분리
@Service
public class NotificationService {

    private final NotificationAsyncService asyncService;

    public void sendNotification(Long userId) {
        asyncService.sendAsync(userId);
    }
}

@Service
public class NotificationAsyncService {

    @Async
    public void sendAsync(Long userId) {
        // 비동기 실행만 담당
        processNotification(userId);
    }

    @Transactional  // 동기 메서드에 트랜잭션 적용
    public void processNotification(Long userId) {
        notificationRepository.save(notification);
    }
}
```

### 5.4 함정 #4: readOnly 트랜잭션에서 쓰기 시도

```java
// ❌ readOnly 트랜잭션에서 쓰기 시도
@Transactional(readOnly = true)
public void updateProduct(Product product) {
    productRepository.save(product);  // 예외 발생!
    // TransactionReadOnlyException 또는 무시됨
}

// ✅ 해결책: readOnly 제거
@Transactional  // readOnly = false (기본값)
public void updateProduct(Product product) {
    productRepository.save(product);
}

// readOnly 최적화 효과
@Transactional(readOnly = true)
public List<Product> getProducts() {
    return productRepository.findAll();

    // 최적화:
    // 1. Flush 모드를 MANUAL로 설정 (Dirty Checking 스킵)
    // 2. 하이버네이트 읽기 전용 힌트 설정
    // 3. MySQL: 읽기 전용 세션 최적화
}
```

---

## 6. 실전 트랜잭션 패턴

### 6.1 패턴 #1: 주문-결제-재고 통합 트랜잭션

```java
@Service
@RequiredArgsConstructor
public class OrderFacade {

    private final OrderService orderService;
    private final PaymentService paymentService;
    private final StockService stockService;

    @Transactional
    public OrderResult processOrder(OrderRequest request) {
        // 1. 재고 확인 및 차감
        stockService.decreaseStock(request.getProductId(), request.getQuantity());

        // 2. 주문 생성
        Order order = orderService.createOrder(request);

        // 3. 결제 처리
        Payment payment = paymentService.processPayment(order.getId(), request.getPaymentInfo());

        // 하나라도 실패하면 전체 롤백
        return OrderResult.of(order, payment);
    }
}

@Service
public class StockService {

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public void decreaseStock(Long productId, int quantity) {
        Product product = productRepository.findByIdWithLock(productId);
        // SELECT ... FOR UPDATE

        if (product.getStock() < quantity) {
            throw new InsufficientStockException("재고 부족");
        }

        product.decreaseStock(quantity);
    }
}
```

### 6.2 패턴 #2: 이벤트 로깅 (REQUIRES_NEW)

```java
@Service
public class OrderService {

    private final AuditLogService auditLogService;

    @Transactional
    public void createOrder(Order order) {
        orderRepository.save(order);

        // 감사 로그는 항상 기록 (주문 실패해도)
        auditLogService.logOrderAttempt(order);

        if (!order.isValid()) {
            throw new InvalidOrderException();  // 주문은 롤백
        }
    }
}

@Service
public class AuditLogService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logOrderAttempt(Order order) {
        // 독립적인 트랜잭션 → 항상 커밋됨
        AuditLog log = AuditLog.of(order);
        auditLogRepository.save(log);
    }
}
```

### 6.3 패턴 #3: Batch 처리 최적화

```java
@Service
public class ProductService {

    @Transactional
    public void bulkUpdatePrices(List<ProductPriceUpdate> updates) {
        int batchSize = 100;

        for (int i = 0; i < updates.size(); i++) {
            ProductPriceUpdate update = updates.get(i);
            Product product = productRepository.findById(update.getProductId()).orElseThrow();
            product.updatePrice(update.getNewPrice());

            // 배치마다 flush & clear로 메모리 최적화
            if ((i + 1) % batchSize == 0) {
                entityManager.flush();
                entityManager.clear();
            }
        }
    }
}

// application.yml 설정
spring:
  jpa:
    properties:
      hibernate:
        jdbc:
          batch_size: 100  # JDBC 배치 사이즈
        order_inserts: true
        order_updates: true
```

### 6.4 패턴 #4: 트랜잭션 이벤트 (TransactionalEventListener)

```java
@Service
public class OrderService {

    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public void createOrder(Order order) {
        orderRepository.save(order);

        // 이벤트 발행 (트랜잭션 커밋 후 실행)
        eventPublisher.publishEvent(new OrderCreatedEvent(order.getId()));

        // 트랜잭션 커밋 전까지 이벤트 핸들러 실행 안 됨
    }
}

@Component
public class OrderEventListener {

    // 트랜잭션 커밋 후 실행 (기본값)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleOrderCreated(OrderCreatedEvent event) {
        // 주문 성공 알림 발송
        notificationService.sendOrderConfirmation(event.getOrderId());
    }

    // 트랜잭션 롤백 시 실행
    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    public void handleOrderFailed(OrderCreatedEvent event) {
        // 주문 실패 로그
        log.error("주문 실패: {}", event.getOrderId());
    }
}

// TransactionPhase 종류:
// - BEFORE_COMMIT: 커밋 전
// - AFTER_COMMIT: 커밋 후 (기본값)
// - AFTER_ROLLBACK: 롤백 후
// - AFTER_COMPLETION: 완료 후 (커밋/롤백 무관)
```

---

## 7. 트랜잭션 성능 최적화

### 7.1 트랜잭션 범위 최소화

```java
// ❌ 트랜잭션 범위가 너무 큼
@Transactional
public void processOrder(OrderRequest request) {
    // 1. 외부 API 호출 (3초)
    PaymentInfo paymentInfo = paymentGateway.getPaymentInfo(request.getPaymentId());

    // 2. 복잡한 계산 (2초)
    BigDecimal totalPrice = calculateTotalPrice(request);

    // 3. DB 저장 (0.1초)
    orderRepository.save(order);

    // 총 5.1초 동안 DB 커넥션 점유!
}

// ✅ 트랜잭션 범위 최소화
public void processOrder(OrderRequest request) {
    // 1. 외부 API 호출 (트랜잭션 밖에서)
    PaymentInfo paymentInfo = paymentGateway.getPaymentInfo(request.getPaymentId());

    // 2. 복잡한 계산 (트랜잭션 밖에서)
    BigDecimal totalPrice = calculateTotalPrice(request);

    // 3. DB 저장만 트랜잭션 (0.1초)
    saveOrder(order, paymentInfo, totalPrice);
}

@Transactional
private void saveOrder(Order order, PaymentInfo paymentInfo, BigDecimal totalPrice) {
    orderRepository.save(order);
    // 0.1초만 커넥션 점유
}
```

### 7.2 Connection Pool 최적화

```yaml
# application.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 10  # CPU 코어 수 * 2 + 1
      minimum-idle: 5
      connection-timeout: 30000  # 30초
      idle-timeout: 600000  # 10분
      max-lifetime: 1800000  # 30분

      # 성능 최적화
      auto-commit: false  # 트랜잭션 관리는 Spring에게 위임
      connection-test-query: SELECT 1  # Health Check
```

### 7.3 트랜잭션 타임아웃 설정

```java
// 타임아웃 설정 (초 단위)
@Transactional(timeout = 5)  // 5초 이내 완료 필요
public void createOrder(Order order) {
    orderRepository.save(order);

    // 5초 초과 시 TransactionTimedOutException
}

// application.yml 글로벌 설정
spring:
  transaction:
    default-timeout: 60  # 60초 (기본값)
```

---

## 8. 트랜잭션 모니터링 & 디버깅

### 8.1 트랜잭션 로그 활성화

```yaml
# application.yml
logging:
  level:
    org.springframework.transaction: DEBUG  # 트랜잭션 시작/커밋/롤백 로그
    org.springframework.orm.jpa: DEBUG  # JPA 트랜잭션 로그
    org.hibernate.SQL: DEBUG  # SQL 쿼리
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE  # 바인딩 파라미터
```

**로그 출력 예시:**

```
DEBUG o.s.t.a.AnnotationTransactionAttributeSource : Adding transactional method 'createOrder' with attribute: PROPAGATION_REQUIRED,ISOLATION_DEFAULT
DEBUG o.s.orm.jpa.JpaTransactionManager : Creating new transaction with name [OrderService.createOrder]
DEBUG o.s.orm.jpa.JpaTransactionManager : Opened new EntityManager for JPA transaction
DEBUG o.hibernate.SQL : insert into orders (id, amount, status) values (?, ?, ?)
DEBUG o.s.orm.jpa.JpaTransactionManager : Committing JPA transaction on EntityManager
```

### 8.2 TransactionSynchronizationManager 활용

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(Order order) {
        // 현재 트랜잭션 정보 확인
        boolean isActive = TransactionSynchronizationManager.isActualTransactionActive();
        boolean isReadOnly = TransactionSynchronizationManager.isCurrentTransactionReadOnly();
        String txName = TransactionSynchronizationManager.getCurrentTransactionName();

        log.info("Transaction Active: {}, ReadOnly: {}, Name: {}",
            isActive, isReadOnly, txName);

        orderRepository.save(order);
    }
}
```

### 8.3 실시간 트랜잭션 모니터링 (Actuator)

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: metrics,health
  metrics:
    enable:
      jvm: true
      jdbc: true
```

```bash
# 활성 트랜잭션 수 모니터링
curl http://localhost:8080/actuator/metrics/jdbc.connections.active

# 응답:
{
  "name": "jdbc.connections.active",
  "measurements": [
    { "statistic": "VALUE", "value": 5 }
  ]
}
```

---

## 9. 실전 트러블슈팅 사례

### 사례 #1: 트랜잭션 데드락

**문제 상황:**

```java
// Thread 1
@Transactional
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    Account from = accountRepository.findById(fromId).orElseThrow();
    Account to = accountRepository.findById(toId).orElseThrow();
    from.withdraw(amount);
    to.deposit(amount);
}

// Thread 2 (동시에 반대 방향 이체)
transferMoney(toId, fromId, amount);

// Deadlock 발생!
```

**해결책:**

```java
// ID 순서로 락 획득 (Deadlock 방지)
@Transactional
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    Long firstId = Math.min(fromId, toId);
    Long secondId = Math.max(fromId, toId);

    Account first = accountRepository.findByIdWithLock(firstId);
    Account second = accountRepository.findByIdWithLock(secondId);

    if (firstId.equals(fromId)) {
        first.withdraw(amount);
        second.deposit(amount);
    } else {
        second.withdraw(amount);
        first.deposit(amount);
    }
}
```

### 사례 #2: LazyInitializationException

**문제 상황:**

```java
@Transactional
public Order getOrder(Long orderId) {
    return orderRepository.findById(orderId).orElseThrow();
}

// Controller
public OrderResponse getOrderDetails(Long orderId) {
    Order order = orderService.getOrder(orderId);
    // 트랜잭션 종료됨

    List<OrderItem> items = order.getItems();  // LazyInitializationException!
}
```

**해결책:**

```java
// 해결책 1: Fetch Join
@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.id = :orderId")
Order findByIdWithItems(@Param("orderId") Long orderId);

// 해결책 2: @EntityGraph
@EntityGraph(attributePaths = {"items"})
Optional<Order> findById(Long id);

// 해결책 3: Open Session In View (비추천)
spring.jpa.open-in-view: true  # 기본값: true (성능 이슈)
```

---

## 요약

### 핵심 개념

- ACID와 트랜잭션 경계(“어디부터 어디까지 원자적으로 묶을지”)
- Spring 트랜잭션은 AOP 프록시 기반으로 동작
- 트랜잭션 동기화(커밋/롤백 타이밍에 맞춘 후처리)가 중요해지는 순간이 있다

### Propagation(전파) 감각

- `REQUIRED`: 기본값(가능하면 기존 트랜잭션에 참여)
- `REQUIRES_NEW`: 완전히 분리된 트랜잭션(실패 격리/감사 로그 등)
- `NESTED`: savepoint 기반(지원/운영 제약이 있어 신중)

### Isolation(격리) 감각

- 격리는 “안전성 vs 성능” 트레이드오프
- InnoDB에서는 MVCC/락과 함께 이해해야 한다(읽기/쓰기 경쟁, 데드락)

### 자주 터지는 함정

- private/self-invocation으로 `@Transactional`이 적용되지 않음
- checked exception 롤백 규칙(기본값) 오해
- `readOnly`의 의미/최적화 범위 오해
- OSIV/지연 로딩으로 `LazyInitializationException` 발생

---

## 마무리

Spring Transaction은 데이터 일관성을 보장하는 핵심 메커니즘입니다. `@Transactional`의 동작 원리와 Propagation, Isolation Level을 정확히 이해하면 복잡한 비즈니스 로직도 안전하게 구현할 수 있습니다.

**핵심 요약:**
1. **AOP Proxy 기반** - Spring은 Proxy를 통해 트랜잭션 관리
2. **Propagation** - REQUIRED (공유), REQUIRES_NEW (독립), NESTED (Savepoint)
3. **Isolation Level** - READ_COMMITTED (성능), SERIALIZABLE (안전)
4. **성능 최적화** - 트랜잭션 범위 최소화, Connection Pool 튜닝
5. **모니터링** - 트랜잭션 로그, Actuator 메트릭 활용

**다음 단계:**
- Spring Security 인증/인가 구조 학습
- 분산 트랜잭션 (Saga Pattern) 학습
- 실전 프로젝트에 트랜잭션 전략 적용

*이 글이 도움이 되었다면, 다음 글 "Spring Security 완벽 가이드"도 기대해주세요!* 🚀
