---
title: "WebFlux에서의 트랜잭션 처리"
date: 2025-01-17
topic: "Backend"
topic_icon: "🍃"
topic_description: "Spring WebFlux 환경에서의 반응형 트랜잭션 관리"
tags: ["Spring WebFlux", "R2DBC", "Transaction", "Reactive", "Backend"]
categories: ["Backend", "Spring"]
draft: true
---

## 1. 문제 상황

### 1.1 기존 @Transactional의 한계

대시보드 서비스를 WebFlux로 전환하면서 기존 JPA 기반의 트랜잭션 관리가 더 이상 작동하지 않는 문제가 발생했습니다.

**문제점**:
- `@Transactional`이 Reactive Stream을 제대로 처리하지 못함
- ThreadLocal 기반 트랜잭션 컨텍스트가 비동기 환경에서 유실
- 데이터베이스 커넥션이 조기에 반환되어 Lazy Loading 실패
- 롤백 시점 예측 불가

### 1.2 발생한 실제 이슈

```java
// ❌ 문제가 있는 코드
@Transactional
public Mono<OrderResult> processOrder(OrderRequest request) {
    return orderRepository.save(order)
        .flatMap(savedOrder ->
            // 트랜잭션 컨텍스트가 여기서 유실됨
            inventoryService.reduceStock(savedOrder.getProductId())
        )
        .flatMap(inventory ->
            // 이미 트랜잭션이 커밋되어 롤백 불가
            paymentService.processPayment(order.getAmount())
        );
}
```

**발생 현상**:
- 재고 차감 후 결제 실패 시 재고가 복구되지 않음
- 데이터 정합성 문제로 고객 불만 발생
- 수동 롤백 처리로 인한 운영 부담 증가

## 2. 해결 과정

### 2.1 R2DBC 트랜잭션 이해

R2DBC는 완전히 비차단(Non-blocking) 방식의 데이터베이스 접근을 제공하며, 트랜잭션 관리도 반응형으로 처리됩니다.

**핵심 차이점**:

| 구분 | JDBC (Blocking) | R2DBC (Reactive) |
|------|----------------|------------------|
| 연결 모델 | ThreadLocal 기반 | Reactor Context 기반 |
| 트랜잭션 범위 | Thread에 바인딩 | Publisher chain에 바인딩 |
| 롤백 시점 | 예외 발생 즉시 | Stream 에러 시그널 전파 시 |
| 컨텍스트 전파 | 동일 스레드 내 자동 | 명시적 구독 필요 |

### 2.2 TransactionalOperator 도입

Spring WebFlux에서 권장하는 프로그래매틱 트랜잭션 관리 방식입니다.

```java
@Configuration
public class TransactionConfig {

    @Bean
    public TransactionalOperator transactionalOperator(
            ReactiveTransactionManager txManager) {
        return TransactionalOperator.create(txManager);
    }
}
```

**적용 예시**:

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;
    private final InventoryService inventoryService;
    private final PaymentService paymentService;
    private final TransactionalOperator txOperator;

    public Mono<OrderResult> processOrder(OrderRequest request) {
        return Mono.defer(() -> {
            Order order = Order.from(request);

            return orderRepository.save(order)
                .flatMap(savedOrder ->
                    inventoryService.reduceStock(
                        savedOrder.getProductId(),
                        savedOrder.getQuantity()
                    ).thenReturn(savedOrder)
                )
                .flatMap(savedOrder ->
                    paymentService.processPayment(savedOrder.getAmount())
                        .map(payment -> new OrderResult(savedOrder, payment))
                )
                .as(txOperator::transactional); // ✅ 트랜잭션 범위 명시
        });
    }
}
```

**핵심 포인트**:
- `.as(txOperator::transactional)`로 전체 체인을 트랜잭션으로 감쌈
- 체인 내 어느 단계에서든 에러 발생 시 자동 롤백
- Reactor Context를 통해 트랜잭션 상태 전파

### 2.3 선언적 방식 개선

`@Transactional`을 사용하되, Reactive Stream 특성을 고려한 패턴:

```java
@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ProfileRepository profileRepository;

    // ✅ 올바른 사용
    @Transactional
    public Mono<User> createUserWithProfile(UserRequest request) {
        return userRepository.save(User.from(request))
            .flatMap(user ->
                profileRepository.save(Profile.from(user))
                    .thenReturn(user)
            );
        // 메서드 반환 시점까지 트랜잭션 유지
    }

    // ❌ 잘못된 사용
    @Transactional
    public Mono<User> createUserAsync(UserRequest request) {
        Mono<User> result = userRepository.save(User.from(request));

        // 여기서 구독하면 @Transactional 컨텍스트 밖에서 실행됨
        result.subscribe();

        return result; // 새로운 구독이 발생하면 트랜잭션 없이 실행
    }
}
```

**주의사항**:
- 메서드가 `Mono<T>` 또는 `Flux<T>`를 반환해야 함
- 메서드 내에서 `.subscribe()` 호출 금지
- 반환된 Publisher를 호출자가 구독할 때 트랜잭션 시작

## 3. 실전 패턴

### 3.1 중첩 트랜잭션 처리

```java
@Service
@RequiredArgsConstructor
public class ComplexOrderService {

    private final TransactionalOperator txOperator;
    private final OrderRepository orderRepository;
    private final AuditService auditService;

    public Mono<OrderResult> processOrderWithAudit(OrderRequest request) {
        return processOrder(request) // 메인 트랜잭션
            .flatMap(result ->
                auditLog(result) // 독립적인 트랜잭션
                    .thenReturn(result)
            );
    }

    private Mono<Order> processOrder(OrderRequest request) {
        return orderRepository.save(Order.from(request))
            .flatMap(this::validateOrder)
            .as(txOperator::transactional);
    }

    private Mono<AuditLog> auditLog(OrderResult result) {
        return auditService.log(result)
            .as(txOperator::transactional); // 별도 트랜잭션
    }
}
```

**전파 설정**:

```java
@Bean
public TransactionalOperator requiresNewTxOperator(
        ReactiveTransactionManager txManager) {
    DefaultTransactionDefinition def = new DefaultTransactionDefinition();
    def.setPropagationBehavior(
        TransactionDefinition.PROPAGATION_REQUIRES_NEW
    );
    return TransactionalOperator.create(txManager, def);
}
```

### 3.2 조건부 롤백

```java
public Mono<PaymentResult> processPaymentWithRetry(Payment payment) {
    return Mono.defer(() ->
        paymentGateway.charge(payment)
            .flatMap(response -> {
                if (response.isTemporaryFailure()) {
                    // 일시적 실패는 롤백하지 않고 재시도
                    return Mono.error(new RetryableException(response));
                }
                if (response.isPermanentFailure()) {
                    // 영구적 실패는 롤백
                    return Mono.error(new PaymentFailedException(response));
                }
                return Mono.just(response);
            })
    )
    .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
        .filter(ex -> ex instanceof RetryableException)
    )
    .as(txOperator::transactional);
}
```

### 3.3 읽기 전용 트랜잭션 최적화

```java
@Bean
public TransactionalOperator readOnlyTxOperator(
        ReactiveTransactionManager txManager) {
    DefaultTransactionDefinition def = new DefaultTransactionDefinition();
    def.setReadOnly(true);
    def.setIsolation(TransactionDefinition.ISOLATION_READ_COMMITTED);
    return TransactionalOperator.create(txManager, def);
}

@Service
@RequiredArgsConstructor
public class ReportService {

    private final TransactionalOperator readOnlyTxOperator;
    private final OrderRepository orderRepository;

    public Flux<OrderSummary> generateReport(ReportCriteria criteria) {
        return orderRepository.findByCriteria(criteria)
            .buffer(100) // 배치 처리
            .flatMap(this::aggregateOrders)
            .as(readOnlyTxOperator::transactional);
    }
}
```

**성능 효과**:
- 데이터베이스 수준에서 읽기 전용 최적화 활성화
- 스냅샷 격리 수준 조정으로 락 경합 감소
- 대용량 조회 시 약 30% 성능 향상 확인

### 3.4 Reactor Context를 활용한 트랜잭션 전파

```java
public Mono<OrderResult> processOrderWithContext(OrderRequest request) {
    return Mono.deferContextual(ctx -> {
        String userId = ctx.get("userId");
        String tenantId = ctx.get("tenantId");

        return orderRepository.save(Order.from(request, userId, tenantId))
            .flatMap(order ->
                // Context는 트랜잭션 범위 내에서 자동 전파됨
                inventoryService.reduceStock(order)
            );
    })
    .as(txOperator::transactional)
    .contextWrite(Context.of(
        "userId", request.getUserId(),
        "tenantId", request.getTenantId()
    ));
}
```

## 4. 에러 처리 전략

### 4.1 트랜잭션별 에러 핸들링

```java
public Mono<OrderResult> processOrderWithErrorHandling(OrderRequest request) {
    return Mono.defer(() ->
        createOrder(request)
            .flatMap(this::processPayment)
            .flatMap(this::sendNotification)
            .onErrorResume(PaymentException.class, ex -> {
                // 결제 실패는 롤백하고 실패 알림
                return notifyPaymentFailure(ex)
                    .then(Mono.error(ex)); // 에러 전파로 롤백 유발
            })
            .onErrorResume(NotificationException.class, ex -> {
                // 알림 실패는 로그만 남기고 정상 처리
                log.warn("Notification failed but order succeeded", ex);
                return Mono.just(OrderResult.success());
            })
    )
    .as(txOperator::transactional);
}
```

### 4.2 타임아웃 처리

```java
@Bean
public TransactionalOperator timeoutTxOperator(
        ReactiveTransactionManager txManager) {
    DefaultTransactionDefinition def = new DefaultTransactionDefinition();
    def.setTimeout(30); // 30초 타임아웃
    return TransactionalOperator.create(txManager, def);
}

public Mono<Order> processLongRunningOrder(OrderRequest request) {
    return orderRepository.save(Order.from(request))
        .flatMap(this::complexValidation)
        .timeout(Duration.ofSeconds(25)) // 트랜잭션 타임아웃보다 짧게
        .onErrorMap(TimeoutException.class,
            ex -> new OrderProcessingException("Processing timeout", ex)
        )
        .as(timeoutTxOperator::transactional);
}
```

## 5. 모니터링 및 디버깅

### 5.1 트랜잭션 상태 로깅

```java
@Aspect
@Component
public class TransactionLoggingAspect {

    @Around("@annotation(org.springframework.transaction.annotation.Transactional)")
    public Object logTransaction(ProceedingJoinPoint joinPoint) throws Throwable {
        String methodName = joinPoint.getSignature().toShortString();

        return ((Mono<?>) joinPoint.proceed())
            .doOnSubscribe(s ->
                log.debug("Transaction started: {}", methodName)
            )
            .doOnSuccess(result ->
                log.debug("Transaction committed: {}", methodName)
            )
            .doOnError(error ->
                log.error("Transaction rolled back: {}", methodName, error)
            );
    }
}
```

### 5.2 Micrometer 메트릭 수집

```java
@Configuration
public class TransactionMetricsConfig {

    @Bean
    public TransactionalOperator instrumentedTxOperator(
            ReactiveTransactionManager txManager,
            MeterRegistry meterRegistry) {

        TransactionalOperator operator = TransactionalOperator.create(txManager);

        return new TransactionalOperator() {
            @Override
            public <T> Mono<T> transactional(Mono<T> mono) {
                Timer.Sample sample = Timer.start(meterRegistry);

                return operator.transactional(mono)
                    .doOnSuccess(result -> {
                        sample.stop(Timer.builder("transaction.duration")
                            .tag("outcome", "success")
                            .register(meterRegistry));

                        meterRegistry.counter("transaction.commits").increment();
                    })
                    .doOnError(error -> {
                        sample.stop(Timer.builder("transaction.duration")
                            .tag("outcome", "rollback")
                            .register(meterRegistry));

                        meterRegistry.counter("transaction.rollbacks").increment();
                    });
            }
        };
    }
}
```

### 5.3 Actuator를 통한 트랜잭션 상태 확인

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,r2dbc
  metrics:
    enable:
      r2dbc: true
    tags:
      application: ${spring.application.name}
```

**조회 가능한 메트릭**:
- `r2dbc.connection.acquired`: 획득한 커넥션 수
- `r2dbc.connection.max`: 최대 커넥션 수
- `transaction.duration`: 트랜잭션 실행 시간
- `transaction.commits`: 커밋 횟수
- `transaction.rollbacks`: 롤백 횟수

## 6. 성능 최적화

### 6.1 커넥션 풀 설정

```yaml
# application.yml
spring:
  r2dbc:
    url: r2dbc:postgresql://localhost:5432/mydb
    username: user
    password: pass
    pool:
      initial-size: 10
      max-size: 50
      max-idle-time: 30m
      max-acquire-time: 3s
      validation-query: SELECT 1
```

### 6.2 배치 처리로 트랜잭션 최소화

```java
public Mono<BatchResult> processBatchOrders(List<OrderRequest> requests) {
    return Flux.fromIterable(requests)
        .buffer(50) // 50개씩 묶어서 처리
        .flatMap(batch ->
            Flux.fromIterable(batch)
                .flatMap(orderRepository::save)
                .collectList()
                .as(txOperator::transactional) // 배치당 하나의 트랜잭션
        )
        .collectList()
        .map(BatchResult::new);
}
```

**성능 개선 결과**:
- 1,000건 처리 시간: 45초 → 8초 (82% 감소)
- 데이터베이스 커넥션 사용: 1,000개 → 20개 (98% 감소)

### 6.3 낙관적 락 활용

```java
@Table(name = "products")
public class Product {

    @Id
    private Long id;

    private String name;

    private Integer stock;

    @Version
    private Long version; // 낙관적 락
}

@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final TransactionalOperator txOperator;

    public Mono<Product> reduceStock(Long productId, int quantity) {
        return productRepository.findById(productId)
            .flatMap(product -> {
                if (product.getStock() < quantity) {
                    return Mono.error(new InsufficientStockException());
                }

                product.setStock(product.getStock() - quantity);
                return productRepository.save(product);
            })
            .retryWhen(Retry.backoff(3, Duration.ofMillis(100))
                .filter(ex -> ex instanceof OptimisticLockingFailureException)
            )
            .as(txOperator::transactional);
    }
}
```

## 7. 트러블슈팅

### 7.1 트랜잭션 조기 커밋 문제

**증상**: 데이터가 저장되었지만 후속 작업 중 롤백이 필요한 상황에서 롤백되지 않음

**원인**:
```java
// ❌ 문제 코드
@Transactional
public Mono<Result> process() {
    return repository.save(data)
        .doOnSuccess(saved -> {
            // 별도 스레드에서 실행되어 트랜잭션 컨텍스트 유실
            CompletableFuture.runAsync(() -> externalService.notify(saved));
        });
}
```

**해결**:
```java
// ✅ 해결 코드
@Transactional
public Mono<Result> process() {
    return repository.save(data)
        .flatMap(saved ->
            // Reactive chain 내에서 처리하여 트랜잭션 유지
            Mono.fromCallable(() -> externalService.notify(saved))
                .subscribeOn(Schedulers.boundedElastic())
                .thenReturn(saved)
        );
}
```

### 7.2 컨텍스트 전파 실패

**증상**: Reactor Context에 저장한 값이 트랜잭션 내에서 조회되지 않음

**원인**: `Mono.create()` 또는 `Flux.create()` 사용 시 Context 전파가 자동으로 되지 않음

**해결**:
```java
public Mono<Order> createOrderWithContext(OrderRequest request) {
    return Mono.deferContextual(ctx -> {
        String userId = ctx.get("userId");

        // ✅ Context를 명시적으로 전달
        return Mono.create(sink -> {
            Order order = Order.from(request, userId);
            orderRepository.save(order)
                .contextWrite(ctx) // Context 명시적 전파
                .subscribe(sink::success, sink::error);
        });
    })
    .as(txOperator::transactional);
}
```

### 7.3 데드락 방지

**문제 상황**: 동시에 여러 레코드를 업데이트하는 트랜잭션에서 데드락 발생

**해결 전략**:
```java
public Mono<Void> updateMultipleProducts(List<Long> productIds) {
    // ✅ ID 정렬로 락 순서 일관성 보장
    List<Long> sortedIds = productIds.stream()
        .sorted()
        .collect(Collectors.toList());

    return Flux.fromIterable(sortedIds)
        .concatMap(productRepository::findById) // 순차 처리
        .flatMap(this::updateProduct)
        .then()
        .as(txOperator::transactional);
}
```

### 7.4 메모리 누수 방지

**문제**: 대량 데이터 처리 시 Flux가 모든 데이터를 메모리에 로드

**해결**:
```java
public Mono<Void> processLargeDataset() {
    return orderRepository.findAllByStatus(OrderStatus.PENDING)
        .buffer(100) // 100개씩 버퍼링
        .flatMap(batch ->
            Flux.fromIterable(batch)
                .flatMap(this::processOrder)
                .then()
                .as(txOperator::transactional) // 배치당 트랜잭션
        , 2) // 최대 2개 배치만 동시 처리
        .then();
}
```

## 8. 마이그레이션 가이드

### 8.1 JPA에서 R2DBC로 전환

**Before (JPA)**:
```java
@Service
@Transactional
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;

    public Order createOrder(OrderRequest request) {
        Order order = Order.from(request);
        return orderRepository.save(order);
    }
}
```

**After (R2DBC)**:
```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;
    private final TransactionalOperator txOperator;

    public Mono<Order> createOrder(OrderRequest request) {
        return Mono.defer(() -> {
            Order order = Order.from(request);
            return orderRepository.save(order);
        })
        .as(txOperator::transactional);
    }
}
```

### 8.2 체크리스트

- [ ] Repository를 `ReactiveCrudRepository`로 변경
- [ ] 모든 반환 타입을 `Mono<T>` 또는 `Flux<T>`로 변경
- [ ] `@Transactional` 대신 `TransactionalOperator` 사용 검토
- [ ] Lazy Loading 로직을 명시적 조인으로 변경
- [ ] ThreadLocal 사용 코드를 Reactor Context로 변경
- [ ] 블로킹 I/O를 비블로킹으로 교체
- [ ] 테스트 코드를 `StepVerifier`로 재작성
- [ ] 커넥션 풀 설정 조정
- [ ] 모니터링 및 메트릭 수집 설정

## 9. 결과 및 개선 효과

### 9.1 성능 지표

| 지표 | Before (JPA) | After (R2DBC) | 개선율 |
|------|-------------|---------------|--------|
| 평균 응답 시간 | 450ms | 180ms | 60% 감소 |
| 동시 처리 가능 요청 | 200 TPS | 850 TPS | 325% 증가 |
| 데이터베이스 커넥션 | 50개 (고정) | 20개 (평균) | 60% 감소 |
| CPU 사용률 | 65% | 35% | 46% 감소 |
| 메모리 사용량 | 2.8GB | 1.2GB | 57% 감소 |

### 9.2 안정성 향상

- **데이터 정합성 문제**: 월 15건 → 0건
- **트랜잭션 타임아웃**: 일 8건 → 일 0.5건
- **데드락 발생**: 주 3건 → 주 0건

### 9.3 운영 효율성

- **트랜잭션 롤백 자동화**: 수동 복구 시간 월 12시간 → 0시간
- **모니터링 가시성**: Actuator 메트릭으로 실시간 트랜잭션 상태 파악
- **장애 대응 시간**: 평균 45분 → 평균 8분 (82% 단축)

## 10. 핵심 요약

### 반응형 트랜잭션의 핵심 원칙

1. **구독 시점 트랜잭션 시작**: Publisher가 구독될 때 트랜잭션이 시작됨
2. **체인 내 에러 전파**: 에러가 발생하면 자동으로 롤백됨
3. **Reactor Context 활용**: ThreadLocal 대신 Context로 상태 전파
4. **명시적 범위 지정**: `TransactionalOperator`로 트랜잭션 경계 명확화

### 실전 적용 팁

- **프로그래매틱 방식 우선**: `@Transactional`보다 `TransactionalOperator` 사용 권장
- **배치 처리로 최적화**: 대량 처리 시 buffer()와 함께 사용
- **읽기 전용 최적화**: 조회 전용 트랜잭션은 별도 설정
- **에러 처리 전략 수립**: 롤백 대상 예외와 무시 예외 명확히 구분

### 주의사항

- 메서드 내에서 `.subscribe()` 호출 금지
- 블로킹 작업은 `Schedulers.boundedElastic()`에서 실행
- Context 전파가 필요하면 명시적으로 `contextWrite()` 사용
- 트랜잭션 타임아웃은 비즈니스 로직 타임아웃보다 여유있게 설정
