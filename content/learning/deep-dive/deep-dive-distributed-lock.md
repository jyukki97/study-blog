---
title: "분산 잠금: Redis와 Redisson으로 동시성 제어하기"
date: 2025-11-29
draft: false
topic: "Database"
tags: ["Distributed Lock", "Redis", "Redisson", "Concurrency", "Synchronization"]
categories: ["Backend Deep Dive"]
description: "분산 환경에서 Redis를 이용한 분산 잠금 구현과 동시성 제어 패턴"
module: "data-system"
study_order: 275
---

## 이 글에서 얻는 것

- **분산 잠금**이 왜 필요한지 이해합니다.
- **Redis**로 분산 잠금을 구현할 수 있습니다.
- **Redisson**으로 안전한 분산 잠금을 사용할 수 있습니다.
- **동시성 문제**를 해결할 수 있습니다.

## 0) 분산 환경에서 synchronized는 통하지 않는다

### 문제 상황

```java
// ❌ 단일 서버에서는 동작
@Service
public class CouponService {
    
    private int remainingCoupons = 100;
    
    public synchronized void issueCoupon(Long userId) {
        if (remainingCoupons > 0) {
            remainingCoupons--;
            // 쿠폰 발급...
        }
    }
}

// 문제: 서버가 2대 이상이면?
// 서버 A: remainingCoupons = 1
// 서버 B: remainingCoupons = 1
// 동시에 2명이 발급 → 중복 발급!
```

### 해결: 분산 잠금

```
서버 A → Redis Lock 획득 → 작업 → 해제
서버 B → Lock 대기 → 획득 → 작업 → 해제

공유 자원(Redis)을 이용한 동기화!
```

## 1) Redis SETNX를 이용한 기본 구현

### 1-1) SETNX (SET if Not eXists)

```bash
# Lock 획득 시도
SETNX lock:coupon 1
# 1: 성공 (Lock 획득)
# 0: 실패 (이미 Lock 존재)

# TTL 설정 (데드락 방지)
EXPIRE lock:coupon 10

# Lock 해제
DEL lock:coupon
```

### 1-2) Java 구현

```java
@Service
public class CouponService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    public void issueCoupon(Long userId) {
        String lockKey = "lock:coupon";
        String lockValue = UUID.randomUUID().toString();

        try {
            // 1. Lock 획득 시도 (10초 TTL)
            Boolean acquired = redisTemplate.opsForValue()
                .setIfAbsent(lockKey, lockValue, Duration.ofSeconds(10));

            if (Boolean.FALSE.equals(acquired)) {
                throw new LockAcquisitionException("다른 요청이 처리 중입니다.");
            }

            // 2. 작업 수행
            int remaining = getRemainingCoupons();
            if (remaining > 0) {
                decrementCoupons();
                saveCouponIssue(userId);
            }

        } finally {
            // 3. Lock 해제 (본인이 획득한 Lock만 해제)
            String currentValue = redisTemplate.opsForValue().get(lockKey);
            if (lockValue.equals(currentValue)) {
                redisTemplate.delete(lockKey);
            }
        }
    }
}
```

**문제점:**
- Lock 획득 실패 시 재시도 로직 필요
- TTL 내에 작업이 끝나지 않으면 Lock 자동 해제
- Lock 해제가 원자적이지 않음

## 2) Redisson으로 안전한 분산 잠금

### 2-1) 의존성

```gradle
dependencies {
    implementation 'org.redisson:redisson-spring-boot-starter:3.24.3'
}
```

### 2-2) 설정

```java
@Configuration
public class RedissonConfig {

    @Bean
    public RedissonClient redissonClient() {
        Config config = new Config();
        config.useSingleServer()
            .setAddress("redis://localhost:6379")
            .setConnectionPoolSize(10)
            .setConnectionMinimumIdleSize(5);

        return Redisson.create(config);
    }
}
```

### 2-3) 사용

```java
@Service
public class CouponService {

    @Autowired
    private RedissonClient redissonClient;

    public void issueCoupon(Long userId) {
        RLock lock = redissonClient.getLock("lock:coupon");

        try {
            // Lock 획득 (대기 시간: 10초, 자동 해제: 30초)
            boolean acquired = lock.tryLock(10, 30, TimeUnit.SECONDS);

            if (!acquired) {
                throw new LockAcquisitionException("Lock을 획득할 수 없습니다.");
            }

            // 작업 수행
            int remaining = getRemainingCoupons();
            if (remaining > 0) {
                decrementCoupons();
                saveCouponIssue(userId);
            }

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Lock 획득 중 인터럽트 발생", e);

        } finally {
            // Lock 해제 (본인이 획득한 Lock만 해제)
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

**Redisson의 장점:**
- Watch Dog: TTL 자동 연장
- 재시도 로직 내장
- 원자적인 Lock 해제
- 다양한 Lock 타입 지원

## 3) Lock 타입

### 3-1) ReentrantLock (재진입 가능)

```java
RLock lock = redissonClient.getLock("myLock");

lock.lock();
try {
    // 같은 스레드에서 다시 lock() 가능
    nestedMethod();  // 내부에서 lock() 호출해도 OK
} finally {
    lock.unlock();
}
```

### 3-2) FairLock (공정한 순서)

```java
// 먼저 요청한 순서대로 Lock 획득
RLock fairLock = redissonClient.getFairLock("fairLock");

fairLock.lock();
try {
    // 작업
} finally {
    fairLock.unlock();
}
```

### 3-3) MultiLock (여러 Lock 동시 획득)

```java
RLock lock1 = redissonClient.getLock("lock:user:123");
RLock lock2 = redissonClient.getLock("lock:order:456");

RLock multiLock = redissonClient.getMultiLock(lock1, lock2);

multiLock.lock();
try {
    // 두 Lock을 모두 획득한 상태에서 작업
} finally {
    multiLock.unlock();
}
```

### 3-4) ReadWriteLock (읽기/쓰기 분리)

```java
RReadWriteLock rwLock = redissonClient.getReadWriteLock("rwLock");

// 읽기 Lock (여러 스레드 동시 가능)
RLock readLock = rwLock.readLock();
readLock.lock();
try {
    String data = readData();
} finally {
    readLock.unlock();
}

// 쓰기 Lock (배타적)
RLock writeLock = rwLock.writeLock();
writeLock.lock();
try {
    writeData();
} finally {
    writeLock.unlock();
}
```

## 4) AOP로 Lock 추상화

### 4-1) 애노테이션 정의

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface DistributedLock {
    String key();                          // Lock 키
    long waitTime() default 5;             // 대기 시간 (초)
    long leaseTime() default 10;           // 자동 해제 시간 (초)
    TimeUnit timeUnit() default TimeUnit.SECONDS;
}
```

### 4-2) AOP 구현

```java
@Aspect
@Component
@Slf4j
public class DistributedLockAspect {

    @Autowired
    private RedissonClient redissonClient;

    @Around("@annotation(distributedLock)")
    public Object lock(ProceedingJoinPoint joinPoint, DistributedLock distributedLock) throws Throwable {
        String lockKey = distributedLock.key();
        RLock lock = redissonClient.getLock(lockKey);

        try {
            boolean acquired = lock.tryLock(
                distributedLock.waitTime(),
                distributedLock.leaseTime(),
                distributedLock.timeUnit()
            );

            if (!acquired) {
                log.warn("Failed to acquire lock: {}", lockKey);
                throw new LockAcquisitionException("Lock을 획득할 수 없습니다: " + lockKey);
            }

            log.info("Lock acquired: {}", lockKey);
            return joinPoint.proceed();

        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
                log.info("Lock released: {}", lockKey);
            }
        }
    }
}
```

### 4-3) 사용

```java
@Service
public class CouponService {

    @DistributedLock(key = "lock:coupon", waitTime = 10, leaseTime = 30)
    public void issueCoupon(Long userId) {
        // Lock 자동 획득/해제
        int remaining = getRemainingCoupons();
        if (remaining > 0) {
            decrementCoupons();
            saveCouponIssue(userId);
        }
    }
}
```

## 5) 실전 패턴

### 5-1) 재고 차감 (동시성 제어)

```java
@Service
public class InventoryService {

    @DistributedLock(key = "'lock:inventory:' + #productId")
    public void decreaseStock(Long productId, int quantity) {
        Product product = productRepository.findById(productId)
            .orElseThrow();

        if (product.getStock() < quantity) {
            throw new InsufficientStockException();
        }

        product.decreaseStock(quantity);
        productRepository.save(product);
    }
}
```

### 5-2) 중복 방지 (Idempotency)

```java
@Service
public class PaymentService {

    @DistributedLock(key = "'lock:payment:' + #orderId")
    public PaymentResult processPayment(Long orderId) {
        // 같은 주문에 대한 동시 결제 요청 방지
        Payment existing = paymentRepository.findByOrderId(orderId);
        if (existing != null) {
            return PaymentResult.alreadyProcessed(existing);
        }

        Payment payment = paymentGateway.process(orderId);
        paymentRepository.save(payment);

        return PaymentResult.success(payment);
    }
}
```

## 6) 주의사항

### ⚠️ 1. 데드락 방지

```java
// ❌ 데드락 위험
Thread A: lock1 획득 → lock2 대기
Thread B: lock2 획득 → lock1 대기

// ✅ 해결: TTL 설정
lock.tryLock(10, 30, TimeUnit.SECONDS);
```

### ⚠️ 2. Lock 해제 보장

```java
// ❌ 나쁜 예
lock.lock();
doSomething();
lock.unlock();  // 예외 발생 시 해제 안 됨!

// ✅ 좋은 예
lock.lock();
try {
    doSomething();
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
```

### ⚠️ 3. Lock 범위 최소화

```java
// ❌ Lock 범위가 너무 넓음
lock.lock();
try {
    // DB 조회 (느림)
    // 외부 API 호출 (느림)
    // 실제 작업
} finally {
    lock.unlock();
}

// ✅ 필요한 부분만 Lock
// DB 조회
// 외부 API 호출

lock.lock();
try {
    // 실제 작업만
} finally {
    lock.unlock();
}
```

## 요약

- 분산 환경에서는 synchronized 사용 불가
- Redis SETNX로 기본 분산 잠금 구현
- Redisson으로 안전하고 편리한 분산 잠금
- AOP로 Lock 추상화 가능
- TTL 설정으로 데드락 방지 필수

## 다음 단계

- Redis 고급: `/learning/deep-dive/deep-dive-redis-advanced/`
- 동시성 제어: `/learning/deep-dive/deep-dive-concurrency-control/`
- 분산 트랜잭션: `/learning/deep-dive/deep-dive-distributed-transactions/`
