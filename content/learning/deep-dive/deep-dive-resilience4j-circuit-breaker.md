---
title: "Circuit Breaker 패턴: Resilience4j로 장애 전파 차단하기"
date: 2025-11-08
draft: false
topic: "Spring"
tags: ["Circuit Breaker", "Resilience4j", "Fault Tolerance", "Microservices"]
categories: ["Backend Deep Dive"]
description: "Circuit Breaker 패턴으로 장애를 격리하고 Resilience4j로 구현하는 실전 가이드"
module: "spring-core"
study_order: 185
---

## 이 글에서 얻는 것

- **Circuit Breaker 패턴**의 동작 원리를 이해합니다.
- **Resilience4j**로 Circuit Breaker를 구현할 수 있습니다.
- **장애 전파**를 차단하고 시스템을 보호할 수 있습니다.
- **재시도, 타임아웃, 폴백** 전략을 조합할 수 있습니다.

## 0) Circuit Breaker는 "전기 차단기"다

### 문제 상황

```
마이크로서비스 A → B → C

C 서비스 장애 발생!
↓
B는 C에 계속 요청 (타임아웃 대기)
↓
A도 B를 기다림
↓
전체 시스템 다운!
```

**Circuit Breaker 적용:**
```
C 서비스 장애 감지
↓
Circuit Open (차단)
↓
C로의 요청 즉시 차단
↓
Fallback 응답 반환
↓
시스템 전체는 정상 동작
```

## 1) Circuit Breaker 상태

### 1-1) 3가지 상태

```
CLOSED (정상):
- 모든 요청이 정상적으로 전달됨
- 실패율 모니터링
- 실패율이 임계값 초과 → OPEN

OPEN (차단):
- 모든 요청이 즉시 실패 (빠른 실패)
- Fallback 응답 반환
- 일정 시간 후 → HALF_OPEN

HALF_OPEN (반개방):
- 일부 요청만 허용 (테스트)
- 성공하면 → CLOSED
- 실패하면 → OPEN
```

### 1-2) 상태 전이 다이어그램

```
     [실패율 < 임계값]
    ┌─────────────────┐
    │                 ↓
┌─────────┐       ┌─────────┐
│ CLOSED  │───────│  OPEN   │
└─────────┘       └─────────┘
    ↑                 │
    │   [대기 시간 경과]
    │                 ↓
    │          ┌──────────────┐
    └──────────│  HALF_OPEN   │
  [성공]       └──────────────┘
                      │
                [실패] ↓
              다시 OPEN으로
```

## 2) Resilience4j 기본

### 2-1) 의존성

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-aop'
    implementation 'io.github.resilience4j:resilience4j-spring-boot3:2.1.0'
    implementation 'io.github.resilience4j:resilience4j-reactor:2.1.0'
}
```

### 2-2) 설정

```yaml
resilience4j.circuitbreaker:
  configs:
    default:
      # 실패율 임계값 (50%)
      failureRateThreshold: 50
      
      # 느린 호출 임계값 (느린 호출 비율이 80% 넘으면 Open)
      slowCallRateThreshold: 80
      slowCallDurationThreshold: 2s
      
      # 최소 호출 수 (이 수만큼 호출되어야 통계 계산)
      minimumNumberOfCalls: 10
      
      # Sliding Window 크기
      slidingWindowType: COUNT_BASED
      slidingWindowSize: 100
      
      # Open 상태 유지 시간
      waitDurationInOpenState: 10s
      
      # Half-Open 상태에서 허용할 호출 수
      permittedNumberOfCallsInHalfOpenState: 5
      
      # 자동으로 CLOSED → OPEN 전환 허용
      automaticTransitionFromOpenToHalfOpenEnabled: true
      
  instances:
    paymentService:
      baseConfig: default
      failureRateThreshold: 60
      
    externalApi:
      baseConfig: default
      waitDurationInOpenState: 30s
```

## 3) @CircuitBreaker 사용

### 3-1) 기본 사용

```java
@Service
public class PaymentService {

    @Autowired
    private RestTemplate restTemplate;

    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    public PaymentResponse processPayment(PaymentRequest request) {
        // 외부 결제 API 호출
        return restTemplate.postForObject(
            "https://payment-api.com/process",
            request,
            PaymentResponse.class
        );
    }

    // Fallback 메서드 (Circuit Open 시 호출)
    private PaymentResponse paymentFallback(PaymentRequest request, Exception e) {
        log.error("Payment service is unavailable", e);
        
        return PaymentResponse.builder()
            .status("PENDING")
            .message("결제 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요.")
            .build();
    }
}
```

### 3-2) 다양한 Fallback

```java
@Service
public class UserService {

    @CircuitBreaker(name = "userService", fallbackMethod = "getUserFromCacheFallback")
    public User getUser(Long id) {
        return restTemplate.getForObject(
            "https://user-api.com/users/" + id,
            User.class
        );
    }

    // Fallback 1: 캐시에서 조회
    private User getUserFromCacheFallback(Long id, Exception e) {
        log.warn("User service unavailable, trying cache");
        return cacheManager.getUser(id)
            .orElseGet(() -> getUserDefaultFallback(id, e));
    }

    // Fallback 2: 기본값 반환
    private User getUserDefaultFallback(Long id, Exception e) {
        log.error("All fallbacks failed", e);
        return User.builder()
            .id(id)
            .name("Unknown User")
            .build();
    }
}
```

## 4) 프로그래밍 방식

### 4-1) CircuitBreakerRegistry 사용

```java
@Service
public class ExternalApiService {

    private final CircuitBreakerRegistry circuitBreakerRegistry;
    private final RestTemplate restTemplate;

    public ExternalApiService(CircuitBreakerRegistry circuitBreakerRegistry,
                              RestTemplate restTemplate) {
        this.circuitBreakerRegistry = circuitBreakerRegistry;
        this.restTemplate = restTemplate;
    }

    public ApiResponse callExternalApi(String endpoint) {
        CircuitBreaker circuitBreaker = circuitBreakerRegistry.circuitBreaker("externalApi");

        return circuitBreaker.executeSupplier(() -> {
            return restTemplate.getForObject(endpoint, ApiResponse.class);
        });
    }
}
```

### 4-2) 이벤트 리스너

```java
@Configuration
public class CircuitBreakerEventListener {

    @Bean
    public CircuitBreakerEventListener circuitBreakerEventListener(
            CircuitBreakerRegistry circuitBreakerRegistry) {

        circuitBreakerRegistry.circuitBreaker("paymentService")
            .getEventPublisher()
            .onStateTransition(event -> {
                log.warn("Circuit Breaker State Change: {} -> {}",
                    event.getStateTransition().getFromState(),
                    event.getStateTransition().getToState());
                
                // Slack 알림 등
                if (event.getStateTransition().getToState() == CircuitBreaker.State.OPEN) {
                    slackNotifier.send("Payment service circuit opened!");
                }
            })
            .onError(event -> {
                log.error("Circuit Breaker Error: {}", event.getThrowable().getMessage());
            });

        return new CircuitBreakerEventListener();
    }
}
```

## 5) 재시도 + Circuit Breaker 조합

### 5-1) 재시도 설정

```yaml
resilience4j.retry:
  configs:
    default:
      maxAttempts: 3
      waitDuration: 1s
      retryExceptions:
        - java.net.ConnectException
        - java.net.SocketTimeoutException
        
  instances:
    paymentService:
      baseConfig: default
```

### 5-2) 재시도 + Circuit Breaker

```java
@Service
public class PaymentService {

    @Retry(name = "paymentService", fallbackMethod = "paymentFallback")
    @CircuitBreaker(name = "paymentService")
    public PaymentResponse processPayment(PaymentRequest request) {
        // 1. 재시도 (3번)
        // 2. 재시도 모두 실패 시 Circuit Breaker에서 감지
        // 3. 실패율이 임계값 초과 시 Circuit Open
        return restTemplate.postForObject(...);
    }

    private PaymentResponse paymentFallback(PaymentRequest request, Exception e) {
        return PaymentResponse.pending("서비스 일시 중단");
    }
}
```

## 6) 타임아웃 + Circuit Breaker

### 6-1) 타임아웃 설정

```yaml
resilience4j.timelimiter:
  configs:
    default:
      timeoutDuration: 3s
      
  instances:
    paymentService:
      baseConfig: default
```

### 6-2) 조합 사용

```java
@Service
public class PaymentService {

    @TimeLimiter(name = "paymentService")
    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    public CompletableFuture<PaymentResponse> processPaymentAsync(PaymentRequest request) {
        return CompletableFuture.supplyAsync(() -> {
            // 1. 타임아웃 (3초)
            // 2. 타임아웃 초과 시 Circuit Breaker에서 감지
            return restTemplate.postForObject(...);
        });
    }
}
```

## 7) 모니터링

### 7-1) Actuator Endpoint

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,circuitbreakers,circuitbreakerevents
  health:
    circuitbreakers:
      enabled: true
  metrics:
    tags:
      application: ${spring.application.name}
```

**확인:**
```bash
# Circuit Breaker 상태 확인
curl http://localhost:8080/actuator/circuitbreakers

# 응답:
{
  "circuitBreakers": {
    "paymentService": {
      "state": "CLOSED",
      "failureRate": "12.5%",
      "slowCallRate": "0%",
      "bufferedCalls": 16,
      "failedCalls": 2
    }
  }
}

# 이벤트 확인
curl http://localhost:8080/actuator/circuitbreakerevents/paymentService
```

### 7-2) Prometheus 메트릭

```yaml
management:
  metrics:
    export:
      prometheus:
        enabled: true
```

**메트릭:**
```
resilience4j_circuitbreaker_state{name="paymentService",state="closed"} 1
resilience4j_circuitbreaker_failure_rate{name="paymentService"} 0.125
resilience4j_circuitbreaker_slow_call_rate{name="paymentService"} 0.0
resilience4j_circuitbreaker_buffered_calls{name="paymentService",kind="failed"} 2
```

## 8) 실전 패턴

### 8-1) 여러 Circuit Breaker 조합

```java
@Service
public class OrderService {

    // 결제 서비스
    @CircuitBreaker(name = "paymentService", fallbackMethod = "paymentFallback")
    public PaymentResponse processPayment(Order order) {
        return paymentClient.process(order.getPayment());
    }

    // 재고 서비스
    @CircuitBreaker(name = "inventoryService", fallbackMethod = "inventoryFallback")
    public void reserveInventory(Order order) {
        inventoryClient.reserve(order.getItems());
    }

    // 이메일 서비스 (중요도 낮음, Circuit Breaker 불필요)
    @Async
    public void sendConfirmationEmail(Order order) {
        try {
            emailClient.send(order.getEmail(), "주문 확인");
        } catch (Exception e) {
            log.error("Email sending failed", e);
            // 실패해도 무시
        }
    }

    private PaymentResponse paymentFallback(Order order, Exception e) {
        // 결제 실패 → 주문 취소
        throw new PaymentUnavailableException("결제 서비스 일시 중단");
    }

    private void inventoryFallback(Order order, Exception e) {
        // 재고 확인 실패 → 재고 없음으로 간주
        throw new InventoryUnavailableException("재고 서비스 일시 중단");
    }
}
```

### 8-2) 우아한 성능 저하 (Graceful Degradation)

```java
@Service
public class RecommendationService {

    @CircuitBreaker(name = "recommendationService", fallbackMethod = "getPopularItemsFallback")
    public List<Product> getRecommendations(Long userId) {
        // ML 기반 추천 (외부 서비스)
        return mlService.getRecommendations(userId);
    }

    // Fallback 1: 인기 상품 반환
    private List<Product> getPopularItemsFallback(Long userId, Exception e) {
        log.warn("Recommendation service unavailable, returning popular items");
        return productRepository.findPopularProducts(PageRequest.of(0, 10));
    }
}
```

## 9) 주의사항

### ⚠️ 1. 적절한 임계값 설정

```yaml
# ❌ 너무 민감
failureRateThreshold: 10  # 10%만 실패해도 Open

# ✅ 적절한 설정
failureRateThreshold: 50  # 50% 실패 시 Open
minimumNumberOfCalls: 10  # 최소 10번은 호출되어야 판단
```

### ⚠️ 2. Fallback 메서드 시그니처

```java
// ❌ 나쁜 예: 시그니처 불일치
@CircuitBreaker(name = "userService", fallbackMethod = "fallback")
public User getUser(Long id) { ... }

private User fallback() {  // Exception 파라미터 없음!
    return User.unknown();
}

// ✅ 좋은 예
private User fallback(Long id, Exception e) {  // 원본 파라미터 + Exception
    log.error("Fallback triggered", e);
    return User.unknown();
}
```

### ⚠️ 3. Circuit Breaker 남용

```java
// ❌ 나쁜 예: 내부 메서드에 Circuit Breaker
@CircuitBreaker(name = "local")
private void internalMethod() {
    // 내부 메서드는 불필요!
}

// ✅ 좋은 예: 외부 의존성에만 적용
@CircuitBreaker(name = "externalApi")
public ApiResponse callExternalApi() {
    // 외부 API 호출
}
```

## 연습 (추천)

1. **Circuit Breaker 구현**
   - Resilience4j 설정
   - @CircuitBreaker 적용
   - Fallback 메서드 작성

2. **상태 전이 테스트**
   - 장애 발생 시켜 OPEN 상태 확인
   - 복구 후 CLOSED 상태 전환 확인

3. **모니터링**
   - Actuator로 상태 확인
   - Prometheus 메트릭 수집

## 요약

- Circuit Breaker는 장애 전파를 차단
- CLOSED → OPEN → HALF_OPEN 상태 전이
- Resilience4j로 쉽게 구현 가능
- Fallback으로 우아한 성능 저하
- 재시도, 타임아웃과 함께 조합

## 다음 단계

- 분산 추적: `/learning/deep-dive/deep-dive-distributed-tracing/`
- API Gateway: `/learning/deep-dive/deep-dive-api-gateway/`
- 마이크로서비스 패턴: `/learning/deep-dive/deep-dive-microservices-patterns/`
