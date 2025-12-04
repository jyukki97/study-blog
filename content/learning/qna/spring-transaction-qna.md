---
title: "Spring Transaction 관리 정리"
date: 2025-01-26
topic: "Spring"
topic_icon: "💬"
topic_description: "@Transactional, Propagation, Isolation Level 관련 핵심 개념과 실전 예제 정리"
tags: ["Spring", "Transaction", "ACID", "Database"]
categories: ["Backend"]
draft: true
---

# Spring Transaction 관리 정리

## Q1. @Transactional은 어떻게 동작하나요?

### 답변

**@Transactional**은 **Spring AOP를 이용한 선언적 트랜잭션 관리**로, 프록시 패턴으로 구현됩니다.

### 동작 원리

**프록시 생성**:

```java
// 원본 클래스
@Service
public class UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}

// Spring이 생성하는 Proxy (실제로는 바이트코드 조작)
public class UserServiceProxy extends UserService {
    private TransactionManager transactionManager;

    @Override
    public void createUser(User user) {
        TransactionStatus status = transactionManager.getTransaction(...);

        try {
            super.createUser(user);  // 실제 메서드 호출
            transactionManager.commit(status);  // 커밋
        } catch (Exception e) {
            transactionManager.rollback(status);  // 롤백
            throw e;
        }
    }
}
```

**실행 흐름**:

```
1. Client가 UserService.createUser() 호출
   ↓
2. Proxy가 호출 가로챔
   ↓
3. TransactionManager.getTransaction() (트랜잭션 시작)
   ↓
4. 실제 createUser() 실행
   ↓
5. 예외 발생?
   Yes → rollback()
   No → commit()
```

### 프록시 방식

**1. JDK Dynamic Proxy (인터페이스 기반)**:

```java
// ✅ 인터페이스 있음
public interface UserService {
    void createUser(User user);
}

@Service
public class UserServiceImpl implements UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}

// → JDK Dynamic Proxy 사용
```

**2. CGLIB Proxy (클래스 기반)**:

```java
// ✅ 인터페이스 없음
@Service
public class UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}

// → CGLIB Proxy 사용 (서브클래스 생성)
```

### Self-Invocation 문제

**문제 상황**:

```java
@Service
public class UserService {
    // ❌ Self-Invocation: 프록시를 거치지 않음!
    public void registerUser(User user) {
        validateUser(user);
        createUser(user);  // 같은 클래스 내부 호출 → 프록시 X
    }

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
        // @Transactional이 동작하지 않음! ⚠️
    }
}

// 실행 흐름:
// Client → Proxy → registerUser() (프록시 통과)
//   → createUser() (내부 호출, 프록시 X)
//   → @Transactional 동작 안 함! ⚠️
```

**해결 1: 메서드 분리**:

```java
// ✅ 다른 클래스로 분리
@Service
public class UserService {
    @Autowired
    private UserTransactionService transactionService;

    public void registerUser(User user) {
        validateUser(user);
        transactionService.createUser(user);  // 다른 클래스 호출 → 프록시 O
    }
}

@Service
public class UserTransactionService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
        // @Transactional 정상 동작! ✅
    }
}
```

**해결 2: Self-Injection**:

```java
// ✅ 자기 자신을 주입받아 프록시 호출
@Service
public class UserService {
    @Autowired
    private UserService self;  // 프록시 주입

    public void registerUser(User user) {
        validateUser(user);
        self.createUser(user);  // 프록시를 통한 호출 → @Transactional 동작!
    }

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}
```

### 꼬리 질문 1: @Transactional의 기본 설정은?

**기본값**:

```java
@Transactional(
    propagation = Propagation.REQUIRED,      // 전파 레벨
    isolation = Isolation.DEFAULT,           // 격리 레벨
    timeout = -1,                            // 타임아웃 (무제한)
    readOnly = false,                        // 읽기 전용
    rollbackFor = {},                        // 롤백 예외
    noRollbackFor = {}                       // 롤백 안 할 예외
)
```

**rollbackFor 주의**:

```java
// ❌ Checked Exception은 기본적으로 롤백 안 됨!
@Transactional
public void createUser(User user) throws Exception {
    userRepository.save(user);
    throw new Exception("Error");  // 롤백 안 됨! ⚠️
}

// ✅ rollbackFor 명시
@Transactional(rollbackFor = Exception.class)
public void createUser(User user) throws Exception {
    userRepository.save(user);
    throw new Exception("Error");  // 롤백됨! ✅
}

// 기본 동작:
// RuntimeException, Error → 롤백 O
// Checked Exception (Exception 등) → 롤백 X
```

### 꼬리 질문 2: readOnly = true의 효과는?

**readOnly = true**: 읽기 전용 트랜잭션 (최적화)

```java
// ✅ readOnly = true
@Transactional(readOnly = true)
public List<User> findAll() {
    return userRepository.findAll();
}

// 효과:
// 1. Hibernate: flush 모드를 MANUAL로 설정 (변경 감지 X)
// 2. DB: 읽기 전용 힌트 전달 (DB 최적화)
// 3. MySQL: 읽기 전용 Slave로 라우팅 가능
```

**주의**:

```java
// ❌ readOnly = true인데 쓰기 작업
@Transactional(readOnly = true)
public void updateUser(User user) {
    userRepository.save(user);
    // → 예외 발생하거나 무시됨 (DB에 따라 다름)
}
```

---

## Q2. Transaction Propagation은 무엇인가요?

### 답변

**Propagation (전파)**은 **트랜잭션 메서드가 다른 트랜잭션 메서드를 호출할 때의 동작 방식**을 정의합니다.

### 7가지 Propagation

**1. REQUIRED (기본값)**:

```java
// ✅ REQUIRED: 기존 트랜잭션 사용, 없으면 새로 생성
@Transactional(propagation = Propagation.REQUIRED)
public void methodA() {
    methodB();  // methodB도 같은 트랜잭션 사용
}

@Transactional(propagation = Propagation.REQUIRED)
public void methodB() {
    // methodA와 같은 트랜잭션
}

// 실행 흐름:
// methodA() 시작 → 트랜잭션 T1 생성
//   → methodB() 호출 → T1 재사용 (새로 생성 X)
//   → methodB() 완료 → T1 유지
// → methodA() 완료 → T1 커밋
```

**문제**: methodB()에서 예외 발생 시 methodA()도 롤백

```java
@Transactional
public void methodA() {
    userRepository.save(user1);  // 저장됨
    try {
        methodB();  // 예외 발생
    } catch (Exception e) {
        // 예외 처리
    }
    userRepository.save(user2);  // 저장 시도
}

@Transactional
public void methodB() {
    throw new RuntimeException("Error");
}

// 결과:
// methodB()에서 예외 → 트랜잭션 rollback-only 마킹
// → methodA()의 user1, user2 모두 롤백! ⚠️
```

**2. REQUIRES_NEW**:

```java
// ✅ REQUIRES_NEW: 항상 새 트랜잭션 생성
@Transactional
public void methodA() {
    userRepository.save(user1);
    try {
        methodB();  // 새 트랜잭션에서 실행
    } catch (Exception e) {
        // methodB 롤백되어도 methodA는 영향 없음
    }
    userRepository.save(user2);
}

@Transactional(propagation = Propagation.REQUIRES_NEW)
public void methodB() {
    orderRepository.save(order);
    throw new RuntimeException("Error");
}

// 실행 흐름:
// methodA() 시작 → 트랜잭션 T1 생성
//   → user1 저장 (T1)
//   → methodB() 호출 → 트랜잭션 T2 생성 (T1 일시 중단)
//     → order 저장 (T2)
//     → 예외 발생 → T2 롤백 (order 롤백)
//   → T1 재개
//   → user2 저장 (T1)
// → methodA() 완료 → T1 커밋 (user1, user2 커밋)

// 결과:
// user1: 저장 ✅
// user2: 저장 ✅
// order: 롤백 ❌
```

**사용 사례**: 감사 로그 저장

```java
@Transactional
public void processOrder(Order order) {
    orderRepository.save(order);

    try {
        auditService.saveLog(order);  // 별도 트랜잭션
    } catch (Exception e) {
        // 로그 저장 실패해도 주문은 저장
    }
}

@Service
public class AuditService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveLog(Order order) {
        auditLogRepository.save(new AuditLog(order));
        // 별도 트랜잭션이므로 주문과 독립적
    }
}
```

**3. NESTED**:

```java
// ✅ NESTED: 중첩 트랜잭션 (Savepoint 사용)
@Transactional
public void methodA() {
    userRepository.save(user1);  // 커밋됨

    try {
        methodB();  // Savepoint 생성
    } catch (Exception e) {
        // methodB만 롤백, methodA는 계속 진행
    }

    userRepository.save(user2);  // 커밋됨
}

@Transactional(propagation = Propagation.NESTED)
public void methodB() {
    orderRepository.save(order);
    throw new RuntimeException("Error");
}

// 실행 흐름:
// methodA() 시작 → 트랜잭션 T1 생성
//   → user1 저장 (T1)
//   → methodB() 호출 → Savepoint S1 생성
//     → order 저장 (T1)
//     → 예외 발생 → S1으로 롤백 (order만 롤백)
//   → user2 저장 (T1)
// → methodA() 완료 → T1 커밋 (user1, user2)

// 결과:
// user1: 저장 ✅
// user2: 저장 ✅
// order: 롤백 ❌
```

**REQUIRES_NEW vs NESTED**:

| 특징 | REQUIRES_NEW | NESTED |
|------|--------------|--------|
| 트랜잭션 | 완전히 새로운 트랜잭션 | 외부 트랜잭션의 일부 |
| 커밋 | 독립적으로 커밋 | 외부 트랜잭션과 함께 커밋 |
| 롤백 | 서로 영향 없음 | 내부만 롤백 가능 |
| DB 지원 | 모든 DB | Savepoint 지원 DB만 |

**4. SUPPORTS**:

```java
// ✅ SUPPORTS: 트랜잭션 있으면 사용, 없어도 OK
@Transactional(propagation = Propagation.SUPPORTS)
public void methodB() {
    // 트랜잭션 있으면 사용, 없으면 트랜잭션 없이 실행
}

// Case 1: 트랜잭션 O
@Transactional
public void methodA() {
    methodB();  // methodA의 트랜잭션 사용
}

// Case 2: 트랜잭션 X
public void methodA() {
    methodB();  // 트랜잭션 없이 실행
}
```

**5. NOT_SUPPORTED**:

```java
// ✅ NOT_SUPPORTED: 트랜잭션 없이 실행
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public void methodB() {
    // 항상 트랜잭션 없이 실행
}

@Transactional
public void methodA() {
    methodB();  // methodA의 트랜잭션 일시 중단
}
```

**6. MANDATORY**:

```java
// ✅ MANDATORY: 트랜잭션 필수 (없으면 예외)
@Transactional(propagation = Propagation.MANDATORY)
public void methodB() {
    // 트랜잭션 없으면 IllegalTransactionStateException
}

// ❌ 예외 발생
public void methodA() {
    methodB();  // 트랜잭션 없음 → 예외!
}

// ✅ 정상
@Transactional
public void methodA() {
    methodB();  // 트랜잭션 있음 → 정상
}
```

**7. NEVER**:

```java
// ✅ NEVER: 트랜잭션이 있으면 예외
@Transactional(propagation = Propagation.NEVER)
public void methodB() {
    // 트랜잭션 있으면 IllegalTransactionStateException
}

// ❌ 예외 발생
@Transactional
public void methodA() {
    methodB();  // 트랜잭션 있음 → 예외!
}

// ✅ 정상
public void methodA() {
    methodB();  // 트랜잭션 없음 → 정상
}
```

### Propagation 요약

| Propagation | 기존 트랜잭션 있음 | 기존 트랜잭션 없음 | 사용 사례 |
|-------------|-------------------|-------------------|-----------|
| REQUIRED | 재사용 | 새로 생성 | 기본 (99%) |
| REQUIRES_NEW | 새로 생성 | 새로 생성 | 독립 트랜잭션 |
| NESTED | Savepoint | 새로 생성 | 부분 롤백 |
| SUPPORTS | 재사용 | 트랜잭션 X | 읽기 작업 |
| NOT_SUPPORTED | 일시 중단 | 트랜잭션 X | 성능 최적화 |
| MANDATORY | 재사용 | 예외 | 트랜잭션 강제 |
| NEVER | 예외 | 트랜잭션 X | 트랜잭션 금지 |

---

## Q3. Transaction Isolation Level은 무엇인가요?

### 답변

**Isolation Level (격리 수준)**은 **동시에 실행되는 트랜잭션 간의 격리 정도**를 정의합니다.

### 격리 수준에 따른 문제

**1. Dirty Read (더티 리드)**:

```sql
-- 커밋되지 않은 데이터 읽기

-- Transaction A
BEGIN;
UPDATE users SET balance = 1000 WHERE id = 1;
-- (아직 커밋 안 함)

-- Transaction B
SELECT balance FROM users WHERE id = 1;
-- → 1000 읽음 (커밋 안 된 데이터!) ⚠️

-- Transaction A
ROLLBACK;
-- → balance는 실제로 1000이 아님!
```

**2. Non-Repeatable Read (반복 불가능 읽기)**:

```sql
-- 같은 데이터를 두 번 읽었는데 값이 다름

-- Transaction A
SELECT balance FROM users WHERE id = 1;
-- → 500

-- Transaction B
UPDATE users SET balance = 1000 WHERE id = 1;
COMMIT;

-- Transaction A
SELECT balance FROM users WHERE id = 1;
-- → 1000 (이전에는 500이었는데!) ⚠️
```

**3. Phantom Read (팬텀 리드)**:

```sql
-- 같은 조건으로 조회했는데 row 수가 다름

-- Transaction A
SELECT COUNT(*) FROM users WHERE age >= 20;
-- → 100명

-- Transaction B
INSERT INTO users (name, age) VALUES ('John', 25);
COMMIT;

-- Transaction A
SELECT COUNT(*) FROM users WHERE age >= 20;
-- → 101명 (이전에는 100명이었는데!) ⚠️
```

### 4가지 Isolation Level

**1. READ_UNCOMMITTED**:

```java
// ❌ READ_UNCOMMITTED: 모든 문제 발생 가능
@Transactional(isolation = Isolation.READ_UNCOMMITTED)
public void methodA() {
    // Dirty Read, Non-Repeatable Read, Phantom Read 모두 발생 가능
}
```

**문제**:

| 문제 | 발생 여부 |
|------|-----------|
| Dirty Read | ✅ 발생 |
| Non-Repeatable Read | ✅ 발생 |
| Phantom Read | ✅ 발생 |

**2. READ_COMMITTED (대부분 DB의 기본값)**:

```java
// ✅ READ_COMMITTED: Dirty Read 방지
@Transactional(isolation = Isolation.READ_COMMITTED)
public void methodA() {
    // 커밋된 데이터만 읽음
}
```

**문제**:

| 문제 | 발생 여부 |
|------|-----------|
| Dirty Read | ❌ 방지 |
| Non-Repeatable Read | ✅ 발생 |
| Phantom Read | ✅ 발생 |

**동작**:

```sql
-- Transaction A
BEGIN;
UPDATE users SET balance = 1000 WHERE id = 1;
-- (아직 커밋 안 함)

-- Transaction B (READ_COMMITTED)
SELECT balance FROM users WHERE id = 1;
-- → 500 (커밋 전 값 읽음, Dirty Read 방지!) ✅

-- Transaction A
COMMIT;

-- Transaction B
SELECT balance FROM users WHERE id = 1;
-- → 1000 (커밋된 값 읽음)
```

**3. REPEATABLE_READ (MySQL InnoDB 기본값)**:

```java
// ✅ REPEATABLE_READ: Non-Repeatable Read 방지
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void methodA() {
    // 동일한 row는 항상 같은 값
}
```

**문제**:

| 문제 | 발생 여부 |
|------|-----------|
| Dirty Read | ❌ 방지 |
| Non-Repeatable Read | ❌ 방지 |
| Phantom Read | ⚠️ DB 의존 |

**동작 (MVCC)**:

```sql
-- Transaction A (REPEATABLE_READ)
BEGIN;
SELECT balance FROM users WHERE id = 1;
-- → 500 (스냅샷 생성)

-- Transaction B
UPDATE users SET balance = 1000 WHERE id = 1;
COMMIT;

-- Transaction A
SELECT balance FROM users WHERE id = 1;
-- → 500 (스냅샷 값 유지, 변경 무시!) ✅
```

**4. SERIALIZABLE**:

```java
// ✅ SERIALIZABLE: 모든 문제 방지 (가장 엄격)
@Transactional(isolation = Isolation.SERIALIZABLE)
public void methodA() {
    // 완전 격리 (직렬화)
}
```

**문제**:

| 문제 | 발생 여부 |
|------|-----------|
| Dirty Read | ❌ 방지 |
| Non-Repeatable Read | ❌ 방지 |
| Phantom Read | ❌ 방지 |

**동작**:

```sql
-- Transaction A (SERIALIZABLE)
BEGIN;
SELECT * FROM users WHERE age >= 20;

-- Transaction B
INSERT INTO users (name, age) VALUES ('John', 25);
-- → 대기! (Transaction A가 끝날 때까지) ⚠️

-- Transaction A
COMMIT;

-- Transaction B
-- → 이제 실행됨
COMMIT;
```

### Isolation Level 비교

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | 성능 | 사용 |
|-------|------------|---------------------|--------------|------|------|
| READ_UNCOMMITTED | O | O | O | 최고 | 거의 없음 |
| READ_COMMITTED | X | O | O | 높음 | 일반적 |
| REPEATABLE_READ | X | X | △ | 중간 | MySQL 기본 |
| SERIALIZABLE | X | X | X | 낮음 | 금융 거래 |

### 꼬리 질문: 실무에서 어떤 격리 수준을 사용하나요?

**일반적인 선택**:

```java
// ✅ 대부분의 경우: READ_COMMITTED (기본값)
@Transactional
public void processOrder(Order order) {
    // DB 기본값 사용 (PostgreSQL: READ_COMMITTED)
}

// ✅ 일관된 읽기 필요: REPEATABLE_READ
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void calculateBalance(Long userId) {
    // 여러 번 읽어도 같은 값 보장
    BigDecimal balance1 = userRepository.findById(userId).getBalance();
    // ... 다른 작업 ...
    BigDecimal balance2 = userRepository.findById(userId).getBalance();
    // balance1 == balance2 보장!
}

// ✅ 완전 격리 필요: SERIALIZABLE
@Transactional(isolation = Isolation.SERIALIZABLE)
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    // 계좌 이체 등 중요한 작업
    // 동시 실행 방지
}
```

---

## Q4. 분산 트랜잭션은 어떻게 처리하나요?

### 답변

**분산 트랜잭션**은 **여러 DB 또는 서비스에 걸친 트랜잭션**을 의미합니다.

### 문제 상황

```java
// ❌ 여러 DB에 걸친 트랜잭션
@Transactional
public void processOrder(Order order) {
    // DB1: 주문 저장
    orderRepository.save(order);

    // DB2: 재고 차감
    inventoryRepository.decreaseStock(order.getProductId(), order.getQuantity());

    // DB3: 결제
    paymentRepository.save(new Payment(order));

    // 문제: DB2나 DB3에서 실패하면 DB1 롤백 안 됨! ⚠️
}
```

### 해결 방법

**1. 2PC (Two-Phase Commit)**:

```
Phase 1: Prepare (준비)
  Coordinator → DB1: Can you commit?
  Coordinator → DB2: Can you commit?
  Coordinator → DB3: Can you commit?

  DB1 → Coordinator: Yes, ready
  DB2 → Coordinator: Yes, ready
  DB3 → Coordinator: No, error! ❌

Phase 2: Commit/Rollback
  Coordinator → DB1: Rollback
  Coordinator → DB2: Rollback
  Coordinator → DB3: Rollback
```

**문제점**:
- 성능 저하 (네트워크 왕복 2배)
- Coordinator 장애 시 모든 트랜잭션 대기
- 실무에서 거의 사용 안 함

**2. Saga Pattern (권장)**:

**Choreography (이벤트 기반)**:

```java
// ✅ 각 서비스가 로컬 트랜잭션 + 이벤트 발행
@Service
public class OrderService {
    @Transactional
    public void createOrder(Order order) {
        // 1. 주문 생성 (로컬 트랜잭션)
        orderRepository.save(order);

        // 2. 이벤트 발행
        eventPublisher.publish(new OrderCreatedEvent(order));
    }

    @EventListener
    public void handleInventoryFailed(InventoryFailedEvent event) {
        // 보상 트랜잭션 (Compensating Transaction)
        orderRepository.updateStatus(event.getOrderId(), "CANCELLED");
    }
}

@Service
public class InventoryService {
    @EventListener
    @Transactional
    public void handleOrderCreated(OrderCreatedEvent event) {
        try {
            // 재고 차감 (로컬 트랜잭션)
            inventoryRepository.decreaseStock(
                event.getProductId(),
                event.getQuantity()
            );

            // 성공 이벤트 발행
            eventPublisher.publish(new InventoryDecreasedEvent(event.getOrderId()));

        } catch (Exception e) {
            // 실패 이벤트 발행
            eventPublisher.publish(new InventoryFailedEvent(event.getOrderId()));
        }
    }
}

@Service
public class PaymentService {
    @EventListener
    @Transactional
    public void handleInventoryDecreased(InventoryDecreasedEvent event) {
        try {
            // 결제 (로컬 트랜잭션)
            paymentRepository.save(new Payment(event.getOrderId()));

            // 성공 이벤트 발행
            eventPublisher.publish(new PaymentCompletedEvent(event.getOrderId()));

        } catch (Exception e) {
            // 실패 이벤트 발행 (보상 트랜잭션 트리거)
            eventPublisher.publish(new PaymentFailedEvent(event.getOrderId()));
        }
    }

    @EventListener
    @Transactional
    public void handleInventoryFailed(InventoryFailedEvent event) {
        // 이미 결제했다면 환불 (보상 트랜잭션)
        Payment payment = paymentRepository.findByOrderId(event.getOrderId());
        if (payment != null) {
            paymentRepository.refund(payment);
        }
    }
}
```

**Orchestration (중앙 조정)**:

```java
// ✅ Orchestrator가 트랜잭션 흐름 관리
@Service
public class OrderSaga {
    public void processOrder(Order order) {
        try {
            // Step 1: 주문 생성
            orderService.createOrder(order);

            // Step 2: 재고 차감
            inventoryService.decreaseStock(order.getProductId(), order.getQuantity());

            // Step 3: 결제
            paymentService.pay(order);

            // 모두 성공
            orderService.updateStatus(order.getId(), "COMPLETED");

        } catch (InventoryException e) {
            // Step 1 보상 트랜잭션
            orderService.cancelOrder(order.getId());

        } catch (PaymentException e) {
            // Step 2 보상 트랜잭션
            inventoryService.increaseStock(order.getProductId(), order.getQuantity());
            // Step 1 보상 트랜잭션
            orderService.cancelOrder(order.getId());
        }
    }
}
```

**Saga 패턴 비교**:

| 특징 | Choreography | Orchestration |
|------|--------------|---------------|
| 조정 | 분산 (이벤트) | 중앙 (Orchestrator) |
| 복잡도 | 높음 | 중간 |
| 유연성 | 높음 | 낮음 |
| 디버깅 | 어려움 | 쉬움 |
| 적합 | 단순한 흐름 | 복잡한 흐름 |

### Outbox Pattern

**문제**: 이벤트 발행 실패 시 데이터 불일치

```java
// ❌ 문제 상황
@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);  // DB 저장 성공
    eventPublisher.publish(new OrderCreatedEvent(order));  // 이벤트 발행 실패! ⚠️
    // → 주문은 저장되었지만 이벤트는 발행 안 됨 (불일치!)
}
```

**해결: Outbox Table**:

```java
// ✅ Outbox 테이블에 이벤트 저장
@Transactional
public void createOrder(Order order) {
    // 1. 주문 저장
    orderRepository.save(order);

    // 2. Outbox 테이블에 이벤트 저장 (같은 트랜잭션)
    outboxRepository.save(new OutboxEvent(
        "OrderCreatedEvent",
        objectMapper.writeValueAsString(order)
    ));
    // → 원자적으로 저장됨 (둘 다 성공 또는 둘 다 실패)
}

// 별도 스케줄러가 Outbox 테이블을 주기적으로 폴링
@Scheduled(fixedDelay = 1000)
public void publishEvents() {
    List<OutboxEvent> events = outboxRepository.findUnpublished();

    for (OutboxEvent event : events) {
        try {
            eventPublisher.publish(event);  // 이벤트 발행
            outboxRepository.markAsPublished(event);  // 발행 완료 마킹
        } catch (Exception e) {
            // 다음에 재시도
        }
    }
}
```

---

## Q5. 실무에서 트랜잭션 관련 장애 대응 경험은?

### 답변

**장애 사례: Self-Invocation으로 트랜잭션 미동작**

### 문제 발생

**증상**:
- 주문 생성 실패했는데 재고는 차감됨
- 데이터 불일치 발생

**원인 코드**:

```java
// ❌ Self-Invocation
@Service
public class OrderService {
    public void createOrder(Order order) {
        validateOrder(order);
        saveOrder(order);  // Self-Invocation!
    }

    @Transactional
    public void saveOrder(Order order) {
        orderRepository.save(order);
        inventoryService.decreaseStock(order.getProductId(), order.getQuantity());

        if (order.getTotal() > 10000) {
            throw new RuntimeException("Amount too large");
            // 예외 발생했지만 @Transactional이 동작 안 함!
            // → 재고는 차감됨, 주문은 저장 안 됨 ⚠️
        }
    }
}
```

**해결**:

```java
// ✅ 메서드 분리
@Service
public class OrderService {
    @Autowired
    private OrderTransactionService transactionService;

    public void createOrder(Order order) {
        validateOrder(order);
        transactionService.saveOrder(order);  // 다른 클래스 호출
    }
}

@Service
public class OrderTransactionService {
    @Transactional
    public void saveOrder(Order order) {
        orderRepository.save(order);
        inventoryService.decreaseStock(order.getProductId(), order.getQuantity());

        if (order.getTotal() > 10000) {
            throw new RuntimeException("Amount too large");
            // @Transactional 정상 동작 → 전체 롤백 ✅
        }
    }
}
```

---

## 요약 체크리스트

### @Transactional 동작
- [ ] **프록시 패턴**: AOP로 트랜잭션 관리
- [ ] **Self-Invocation**: 내부 호출 시 프록시 우회 (동작 X)
- [ ] **rollbackFor**: Checked Exception은 명시 필요

### Propagation
- [ ] **REQUIRED**: 기존 재사용, 없으면 생성 (기본값)
- [ ] **REQUIRES_NEW**: 항상 새 트랜잭션 생성
- [ ] **NESTED**: Savepoint로 부분 롤백

### Isolation Level
- [ ] **READ_COMMITTED**: 커밋된 데이터만 읽기 (일반적)
- [ ] **REPEATABLE_READ**: 동일 row 반복 읽기 보장
- [ ] **SERIALIZABLE**: 완전 격리 (성능 저하)

### 분산 트랜잭션
- [ ] **Saga Pattern**: 로컬 트랜잭션 + 보상 트랜잭션
- [ ] **Outbox Pattern**: 이벤트 발행 보장
- [ ] **2PC**: 실무에서 거의 사용 안 함
