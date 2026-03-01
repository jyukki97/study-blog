---
title: "동시성 제어 (Part 2: 재고 차감, Java 멀티스레드, 실무)"
study_order: 704
date: 2025-12-01
topic: "Backend"
tags: ["동시성", "Lock", "JPA", "낙관적락", "비관적락", "분산락"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
description: "재고 차감, Java 멀티스레드, 실무 동시성 제어 심화 Q&A"
series_order: 19
draft: false
module: "qna"
---

## Q3. 재고 차감 시나리오에서 동시성 문제 해결 방법을 비교해주세요.

### 답변

**시나리오**: 100개 재고, 동시에 100명이 1개씩 주문 → 정확히 100개만 판매되어야 함

#### 방법 1: 낙관적 락 (@Version)

```java
@Entity
public class Product {
    @Id
    private Long id;
    private int stock;

    @Version
    private Long version;

    public void decreaseStock(int quantity) {
        if (this.stock < quantity) {
            throw new InsufficientStockException();
        }
        this.stock -= quantity;
    }
}

@Service
public class OrderService {

    @Retryable(value = OptimisticLockException.class, maxAttempts = 100)
    @Transactional
    public Order createOrder(Long productId, int quantity) {
        Product product = productRepository.findById(productId)
            .orElseThrow();

        product.decreaseStock(quantity);

        return orderRepository.save(new Order(product, quantity));
    }
}
```

**장점:**
- 구현 간단 (@Version만 추가)
- 데드락 없음
- 충돌 적을 때 성능 좋음

**단점:**
- 충돌 많을 때 재시도 폭증 → 성능 저하
- 사용자에게 "재시도" 경험 제공 (UX 나쁨)

**적합한 상황:**
- 재고가 충분하고 충돌이 적을 때
- 조회가 많고 수정이 적을 때

#### 방법 2: 비관적 락 (SELECT FOR UPDATE)

```java
public interface ProductRepository extends JpaRepository<Product, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Product p WHERE p.id = :id")
    Optional<Product> findByIdWithLock(@Param("id") Long id);
}

@Service
public class OrderService {

    @Transactional
    public Order createOrder(Long productId, int quantity) {
        Product product = productRepository.findByIdWithLock(productId)
            .orElseThrow();

        product.decreaseStock(quantity);

        return orderRepository.save(new Order(product, quantity));
    }
}
```

**장점:**
- 확실한 동시성 제어
- 재시도 불필요
- 충돌 많을 때 유리

**단점:**
- DB 락 대기 → 응답 시간 증가
- 데드락 가능성
- 단일 DB만 가능 (분산 환경 X)

**적합한 상황:**
- 충돌이 빈번할 때 (인기 상품)
- 단일 DB 환경
- 응답 시간보다 정확성이 중요할 때

#### 방법 3: Redis 분산 락

```java
@Service
public class OrderService {

    @DistributedLock(key = "'product:' + #productId")
    public Order createOrder(Long productId, int quantity) {
        Product product = productRepository.findById(productId)
            .orElseThrow();

        product.decreaseStock(quantity);

        return orderRepository.save(new Order(product, quantity));
    }
}
```

**장점:**
- 분산 환경에서 동작
- DB 부하 없음
- 확실한 동시성 제어

**단점:**
- Redis 의존성
- 구현 복잡도 증가
- Redis 장애 시 대응 필요

**적합한 상황:**
- MSA 분산 환경
- DB 락 부하를 줄이고 싶을 때
- Redis 인프라가 안정적일 때

#### 방법 4: Named Lock (MySQL)

```java
@Repository
public class LockRepository {

    @PersistenceContext
    private EntityManager em;

    public void getLock(String lockName, int timeoutSeconds) {
        em.createNativeQuery("SELECT GET_LOCK(:lockName, :timeout)")
            .setParameter("lockName", lockName)
            .setParameter("timeout", timeoutSeconds)
            .getSingleResult();
    }

    public void releaseLock(String lockName) {
        em.createNativeQuery("SELECT RELEASE_LOCK(:lockName)")
            .setParameter("lockName", lockName)
            .getSingleResult();
    }
}

@Service
public class OrderService {

    @Autowired
    private LockRepository lockRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    public Order createOrder(Long productId, int quantity) {
        String lockName = "product_lock_" + productId;

        try {
            // 1. Named Lock 획득
            lockRepository.getLock(lockName, 3);

            // 2. 별도 트랜잭션에서 비즈니스 로직 실행
            return transactionTemplate.execute(status -> {
                Product product = productRepository.findById(productId)
                    .orElseThrow();

                product.decreaseStock(quantity);

                return orderRepository.save(new Order(product, quantity));
            });

        } finally {
            // 3. Named Lock 해제
            lockRepository.releaseLock(lockName);
        }
    }
}
```

**장점:**
- 비관적 락보다 유연 (락 범위 조정 가능)
- 데드락 없음 (타임아웃 설정)
- Redis 없이 사용 가능

**단점:**
- MySQL 전용 (DB 종속)
- 트랜잭션 분리 필요
- Connection Pool 고갈 가능성

**적합한 상황:**
- MySQL 사용 중
- Redis 도입 어려울 때
- 비관적 락의 데드락이 문제일 때

#### 방법 5: Redis Atomic 연산

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final RedisTemplate<String, String> redisTemplate;
    private final ProductRepository productRepository;

    public Order createOrder(Long productId, int quantity) {
        String stockKey = "product:stock:" + productId;

        // 1. Redis에서 재고 차감 (Atomic)
        Long remainingStock = redisTemplate.opsForValue().decrement(stockKey, quantity);

        if (remainingStock < 0) {
            // 재고 부족 → 롤백
            redisTemplate.opsForValue().increment(stockKey, quantity);
            throw new InsufficientStockException();
        }

        try {
            // 2. DB에 주문 저장
            Product product = productRepository.findById(productId)
                .orElseThrow();

            Order order = new Order(product, quantity);
            return orderRepository.save(order);

        } catch (Exception e) {
            // 3. 실패 시 Redis 재고 복구
            redisTemplate.opsForValue().increment(stockKey, quantity);
            throw e;
        }
    }

    // 정기적으로 Redis → DB 동기화
    @Scheduled(fixedDelay = 60000)  // 1분마다
    public void syncStockToDatabase() {
        // Redis 재고를 DB에 반영
    }
}
```

**장점:**
- 초고속 처리 (Redis Atomic 연산)
- 동시성 문제 완벽 해결
- DB 부하 최소화

**단점:**
- Redis-DB 불일치 가능성
- 정기 동기화 필요
- Redis 장애 시 복구 복잡

**적합한 상황:**
- 초당 수천 건 이상의 트래픽
- 실시간성이 중요할 때
- Redis 인프라가 매우 안정적일 때

#### 방법별 비교표

| 방법 | 구현 난이도 | 성능 | 정확성 | 분산 지원 | 적합한 TPS |
|------|----------|------|--------|----------|-----------|
| **낙관적 락** | ⭐ | ⭐⭐⭐ | ⭐⭐ | ✅ | ~100 |
| **비관적 락** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ❌ | ~500 |
| **Redis 분산 락** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ✅ | ~1000 |
| **Named Lock** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ❌ | ~300 |
| **Redis Atomic** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ✅ | ~10000+ |

### 꼬리 질문 1: 티켓팅 서비스처럼 극한의 동시성 상황에서는?

**1단계: 대기열 시스템 (Redis Sorted Set)**

```java
@Service
@RequiredArgsConstructor
public class QueueService {

    private final RedisTemplate<String, String> redisTemplate;

    public Long enterQueue(String eventId, String userId) {
        String queueKey = "queue:" + eventId;
        double timestamp = System.currentTimeMillis();

        // Sorted Set에 추가 (타임스탬프 기준 정렬)
        redisTemplate.opsForZSet().add(queueKey, userId, timestamp);

        // 현재 대기 순번 반환
        return redisTemplate.opsForZSet().rank(queueKey, userId);
    }

    public List<String> getNextBatch(String eventId, int batchSize) {
        String queueKey = "queue:" + eventId;

        // 앞에서부터 batchSize만큼 가져오기
        Set<String> users = redisTemplate.opsForZSet().range(queueKey, 0, batchSize - 1);

        // 처리된 사용자 제거
        redisTemplate.opsForZSet().removeRange(queueKey, 0, batchSize - 1);

        return new ArrayList<>(users);
    }
}
```

**2단계: 재고 예약 (Redis Atomic)**

```java
@Service
public class TicketService {

    public boolean reserveTicket(String eventId, String userId) {
        String stockKey = "event:stock:" + eventId;

        // Atomic 감소
        Long remaining = redisTemplate.opsForValue().decrement(stockKey);

        if (remaining < 0) {
            redisTemplate.opsForValue().increment(stockKey);
            return false;  // 매진
        }

        // 예약 정보 저장 (5분 TTL)
        String reservationKey = "reservation:" + eventId + ":" + userId;
        redisTemplate.opsForValue().set(reservationKey, "reserved", Duration.ofMinutes(5));

        return true;
    }
}
```

**3단계: 비동기 결제 처리**

```java
@Service
public class PaymentService {

    @Async
    public void processPayment(String eventId, String userId) {
        try {
            // 결제 처리
            paymentClient.charge(userId);

            // DB에 주문 저장
            ticketRepository.save(new Ticket(eventId, userId));

        } catch (Exception e) {
            // 결제 실패 → 재고 복구
            redisTemplate.opsForValue().increment("event:stock:" + eventId);
            redisTemplate.delete("reservation:" + eventId + ":" + userId);
        }
    }
}
```

### 꼬리 질문 2: 재고 음수 방지는 어떻게 하나요?

```java
// ❌ 잘못된 코드 (Race Condition)
@Transactional
public void decreaseStock(Long productId, int quantity) {
    Product product = productRepository.findById(productId).orElseThrow();

    // Thread 1: stock = 1, quantity = 1 → 조건 통과
    // Thread 2: stock = 1, quantity = 1 → 조건 통과 (동시에 읽음)
    if (product.getStock() < quantity) {
        throw new InsufficientStockException();
    }

    // Thread 1: stock = 0
    // Thread 2: stock = -1  ❌
    product.setStock(product.getStock() - quantity);
}

// ✅ 해결 방법 1: DB Constraint
@Entity
public class Product {
    @Column(nullable = false)
    @Check(constraints = "stock >= 0")  // DB 레벨 체크
    private int stock;
}

// ✅ 해결 방법 2: UPDATE 쿼리에 조건 추가
@Modifying
@Query("UPDATE Product p SET p.stock = p.stock - :quantity " +
       "WHERE p.id = :id AND p.stock >= :quantity")
int decreaseStock(@Param("id") Long id, @Param("quantity") int quantity);

// 사용
int updated = productRepository.decreaseStock(productId, quantity);
if (updated == 0) {
    throw new InsufficientStockException();  // 재고 부족 또는 상품 없음
}

// ✅ 해결 방법 3: 엔티티 메서드에서 검증
@Entity
public class Product {
    public void decreaseStock(int quantity) {
        int newStock = this.stock - quantity;

        if (newStock < 0) {
            throw new InsufficientStockException(
                this.id, quantity, this.stock
            );
        }

        this.stock = newStock;
    }
}
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: 동시성 제어 (Part 1: 낙관적/비관적 락, 분산 락)](/learning/qna/concurrency-control-qna/)**
