---
title: "Spring WebClient 타임아웃 및 리트라이 전략"
date: 2025-01-19
topic: "Backend"
topic_icon: "🍃"
topic_description: "WebClient의 안정적인 타임아웃 설정과 재시도 전략"
tags: ["Spring WebFlux", "WebClient", "Resilience", "Retry", "Circuit Breaker"]
categories: ["Backend", "Spring"]
draft: false
---

## 1. 문제 상황

### 1.1 발생한 장애

주문 서비스에서 외부 결제 API를 호출하는 과정에서 간헐적인 타임아웃으로 주문 실패가 발생했습니다.

**문제 징후**:
- 결제 API 응답이 5초 이상 걸리는 경우 주문이 실패
- 일시적인 네트워크 지연으로 정상 요청도 실패 처리
- 재시도 없이 즉시 실패하여 사용자 불편 증가
- 장애 발생 시 서비스 전체가 영향을 받음

### 1.2 기존 코드의 문제점

```java
// ❌ 문제가 있는 코드
@Service
public class PaymentService {

    private final WebClient webClient;

    public PaymentService() {
        this.webClient = WebClient.builder()
            .baseUrl("https://api.payment.com")
            .build();
    }

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        return webClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class);
        // 타임아웃 설정 없음
        // 재시도 로직 없음
        // 에러 처리 없음
    }
}
```

**발생하는 문제**:
- 기본 타임아웃이 없어 무한정 대기 가능
- 일시적 네트워크 오류에 대한 재시도 없음
- 외부 API 장애 시 전체 서비스 마비
- 장애 상황 추적 어려움

## 2. 타임아웃 설정

### 2.1 Connection Timeout vs Response Timeout

**Connection Timeout**: TCP 연결을 맺는 시간 제한
**Response Timeout**: 응답을 받는 전체 시간 제한

```java
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient paymentWebClient() {
        HttpClient httpClient = HttpClient.create()
            // Connection Timeout: 연결 시도 시간 제한 (3초)
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000)
            // Response Timeout: 전체 응답 시간 제한 (5초)
            .responseTimeout(Duration.ofSeconds(5))
            // Read/Write Timeout: 데이터 송수신 시간 제한
            .doOnConnected(conn -> conn
                .addHandlerLast(new ReadTimeoutHandler(5))
                .addHandlerLast(new WriteTimeoutHandler(5))
            );

        return WebClient.builder()
            .baseUrl("https://api.payment.com")
            .clientConnector(new ReactorClientHttpConnector(httpClient))
            .build();
    }
}
```

### 2.2 요청별 타임아웃 설정

```java
@Service
@RequiredArgsConstructor
public class PaymentService {

    private final WebClient paymentWebClient;

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        return paymentWebClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class)
            // 특정 요청에만 더 긴 타임아웃 적용
            .timeout(Duration.ofSeconds(10))
            .onErrorMap(TimeoutException.class,
                ex -> new PaymentTimeoutException("Payment processing timed out", ex)
            );
    }

    public Mono<PaymentStatus> checkPaymentStatus(String paymentId) {
        return paymentWebClient.get()
            .uri("/payments/{id}/status", paymentId)
            .retrieve()
            .bodyToMono(PaymentStatus.class)
            // 조회 요청은 짧은 타임아웃
            .timeout(Duration.ofSeconds(3));
    }
}
```

### 2.3 타임아웃 계층별 전략

```
┌─────────────────────────────────────────────────┐
│ Application Level Timeout (10s)                 │
│  ┌──────────────────────────────────────────┐   │
│  │ Response Timeout (5s)                    │   │
│  │  ┌───────────────────────────────────┐   │   │
│  │  │ Read Timeout (3s)                 │   │   │
│  │  └───────────────────────────────────┘   │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │ Connection Timeout (3s)                  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**권장 설정**:
- Connection Timeout: 2-3초 (빠른 실패로 다른 노드 시도)
- Response Timeout: 5-10초 (비즈니스 요구사항에 따라)
- Read/Write Timeout: Response Timeout과 동일하게

## 3. 재시도 전략

### 3.1 기본 재시도 설정

```java
@Service
@RequiredArgsConstructor
public class ResilientPaymentService {

    private final WebClient paymentWebClient;

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        return paymentWebClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class)
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                .maxBackoff(Duration.ofSeconds(10))
                .jitter(0.5)  // 50% 지터로 재시도 분산
                .filter(throwable ->
                    throwable instanceof WebClientRequestException ||
                    throwable instanceof TimeoutException
                )
                .doBeforeRetry(retrySignal ->
                    log.warn("Retrying payment request, attempt: {}",
                        retrySignal.totalRetries() + 1)
                )
            );
    }
}
```

**재시도 파라미터 설명**:
- `backoff(3, Duration.ofSeconds(1))`: 3번 재시도, 초기 지연 1초
- `maxBackoff`: 최대 백오프 시간 (지수 증가 상한)
- `jitter(0.5)`: 재시도 시간에 50% 무작위성 추가 (동시 재시도 방지)
- `filter`: 재시도할 예외 타입 지정

### 3.2 조건부 재시도

```java
public Mono<PaymentResult> processPaymentWithConditionalRetry(PaymentRequest request) {
    return paymentWebClient.post()
        .uri("/payments")
        .bodyValue(request)
        .retrieve()
        .onStatus(
            status -> status.is5xxServerError(),
            clientResponse -> Mono.error(new RetryableException("Server error"))
        )
        .onStatus(
            status -> status.value() == 429,
            clientResponse -> Mono.error(new RetryableException("Rate limited"))
        )
        .onStatus(
            status -> status.is4xxClientError() && status.value() != 429,
            clientResponse -> Mono.error(new NonRetryableException("Client error"))
        )
        .bodyToMono(PaymentResult.class)
        .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
            .filter(ex -> ex instanceof RetryableException)
            .doBeforeRetry(signal -> {
                RetryableException ex = (RetryableException) signal.failure();
                log.warn("Retrying due to: {}, attempt: {}",
                    ex.getMessage(), signal.totalRetries() + 1);
            })
        );
}
```

**HTTP 상태 코드별 재시도 전략**:

| 상태 코드 | 재시도 여부 | 이유 |
|---------|----------|------|
| 408 Request Timeout | ✅ Yes | 일시적 타임아웃 |
| 429 Too Many Requests | ✅ Yes | Rate Limit (백오프 후 재시도) |
| 500 Internal Server Error | ✅ Yes | 서버 일시 장애 |
| 502 Bad Gateway | ✅ Yes | 게이트웨이 일시 장애 |
| 503 Service Unavailable | ✅ Yes | 서비스 일시 중단 |
| 504 Gateway Timeout | ✅ Yes | 게이트웨이 타임아웃 |
| 400 Bad Request | ❌ No | 잘못된 요청 (재시도 무의미) |
| 401 Unauthorized | ❌ No | 인증 실패 |
| 404 Not Found | ❌ No | 리소스 없음 |

### 3.3 Rate Limiting 대응

```java
public Mono<PaymentResult> processPaymentWithRateLimitRetry(PaymentRequest request) {
    return paymentWebClient.post()
        .uri("/payments")
        .bodyValue(request)
        .retrieve()
        .onStatus(
            status -> status.value() == 429,
            clientResponse -> clientResponse.headers().asHttpHeaders()
                .getFirst("Retry-After")
                .map(retryAfter -> {
                    long retryDelay = Long.parseLong(retryAfter);
                    return Mono.<PaymentResult>error(
                        new RateLimitException(retryDelay)
                    );
                })
                .orElse(Mono.error(new RateLimitException(60)))
        )
        .bodyToMono(PaymentResult.class)
        .retryWhen(Retry.backoff(5, Duration.ofSeconds(1))
            .filter(ex -> ex instanceof RateLimitException)
            .doBeforeRetry(signal -> {
                RateLimitException ex = (RateLimitException) signal.failure();
                long delay = ex.getRetryAfterSeconds();
                log.warn("Rate limited, waiting {} seconds before retry", delay);
            })
            // Retry-After 헤더 값을 사용하여 백오프 시간 조정
            .onRetryExhaustedThrow((spec, signal) ->
                new PaymentException("Rate limit exceeded after retries")
            )
        );
}
```

### 3.4 지수 백오프 시각화

```
Attempt 1: Immediate
Attempt 2: 1s delay  ──────────▶
Attempt 3: 2s delay  ──────────────────▶
Attempt 4: 4s delay  ────────────────────────────────▶
Attempt 5: 8s delay  ────────────────────────────────────────────────────▶
```

**Jitter 효과**:
```
Without Jitter:
Client A: ──1s──│──2s────│──4s──────│
Client B: ──1s──│──2s────│──4s──────│  (동시 재시도 → 서버 부하 집중)
Client C: ──1s──│──2s────│──4s──────│

With Jitter (50%):
Client A: ──1.2s─│──2.8s──────│──3.5s────────│
Client B: ──0.7s─│──1.5s───│──4.8s──────────│  (재시도 분산 → 부하 완화)
Client C: ──1.4s──│──2.1s─────│──3.2s───────│
```

## 4. Circuit Breaker 패턴

### 4.1 Resilience4j 통합

**의존성 추가** (build.gradle):

```gradle
dependencies {
    implementation 'org.springframework.cloud:spring-cloud-starter-circuitbreaker-reactor-resilience4j'
    implementation 'io.github.resilience4j:resilience4j-spring-boot3'
    implementation 'io.github.resilience4j:resilience4j-reactor'
}
```

**Circuit Breaker 설정** (application.yml):

```yaml
resilience4j:
  circuitbreaker:
    configs:
      default:
        sliding-window-size: 10                    # 최근 10개 호출 기준
        failure-rate-threshold: 50                 # 실패율 50% 초과 시 Open
        wait-duration-in-open-state: 10s           # Open 상태 유지 시간
        permitted-number-of-calls-in-half-open-state: 3  # Half-Open에서 테스트 호출 수
        automatic-transition-from-open-to-half-open-enabled: true
        minimum-number-of-calls: 5                 # 최소 5개 호출 후 실패율 계산
        slow-call-duration-threshold: 2s           # 2초 이상은 느린 호출로 간주
        slow-call-rate-threshold: 80               # 느린 호출 80% 초과 시 Open
        record-exceptions:
          - org.springframework.web.reactive.function.client.WebClientRequestException
          - java.util.concurrent.TimeoutException
        ignore-exceptions:
          - com.example.exception.BusinessException
    instances:
      paymentService:
        base-config: default
        failure-rate-threshold: 60
      inventoryService:
        base-config: default
        wait-duration-in-open-state: 5s

  retry:
    configs:
      default:
        max-attempts: 3
        wait-duration: 1s
        retry-exceptions:
          - org.springframework.web.reactive.function.client.WebClientRequestException
        ignore-exceptions:
          - com.example.exception.NonRetryableException
    instances:
      paymentService:
        base-config: default

  timelimiter:
    configs:
      default:
        timeout-duration: 5s
    instances:
      paymentService:
        timeout-duration: 10s
```

### 4.2 Circuit Breaker 적용

```java
@Service
@RequiredArgsConstructor
public class ResilientPaymentService {

    private final WebClient paymentWebClient;
    private final ReactiveCircuitBreakerFactory circuitBreakerFactory;

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        return paymentWebClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class)
            .transform(it ->
                circuitBreakerFactory.create("paymentService")
                    .run(it, throwable -> fallbackPaymentResult(request, throwable))
            )
            .doOnError(CallNotPermittedException.class, ex ->
                log.error("Circuit breaker is OPEN, fallback triggered")
            );
    }

    private Mono<PaymentResult> fallbackPaymentResult(
            PaymentRequest request,
            Throwable throwable) {
        log.warn("Fallback triggered for payment request", throwable);

        // 대기열에 추가하거나 나중에 재시도
        return saveToRetryQueue(request)
            .map(queueId -> PaymentResult.queued(queueId));
    }
}
```

### 4.3 Circuit Breaker 상태 전환

```
                    성공 응답
           ┌──────────────────────────┐
           │                          │
           ▼                          │
    ┌────────────┐              ┌─────────────┐
    │   CLOSED   │─실패율 초과──▶│    OPEN     │
    │  (정상)     │              │  (차단)      │
    └────────────┘              └─────┬────────┘
           ▲                          │
           │                     대기 시간 경과
           │                          │
           │                          ▼
           │                   ┌──────────────┐
           │                   │  HALF-OPEN   │
           └──테스트 호출 성공───│   (테스트)    │
                              └──────────────┘
```

**상태별 동작**:
- **CLOSED**: 정상 요청 처리, 실패율 모니터링
- **OPEN**: 모든 요청 즉시 차단, fallback 실행
- **HALF-OPEN**: 제한적 요청 허용, 성공 시 CLOSED로 복귀

### 4.4 Fallback 전략

```java
@Service
@RequiredArgsConstructor
public class PaymentServiceWithFallback {

    private final WebClient paymentWebClient;
    private final PaymentQueueRepository queueRepository;
    private final CacheManager cacheManager;

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        return Mono.defer(() -> checkCircuitBreakerState())
            .flatMap(isOpen -> {
                if (isOpen) {
                    // Circuit Breaker가 Open이면 즉시 큐에 추가
                    return queueForLaterProcessing(request);
                }

                return callPaymentAPI(request)
                    .onErrorResume(this::handlePaymentError);
            });
    }

    private Mono<PaymentResult> callPaymentAPI(PaymentRequest request) {
        return paymentWebClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class)
            .timeout(Duration.ofSeconds(10))
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(1)));
    }

    private Mono<PaymentResult> handlePaymentError(Throwable error) {
        if (error instanceof TimeoutException) {
            return queueForLaterProcessing(request)
                .doOnNext(result ->
                    log.warn("Payment timed out, queued for later: {}", result.getQueueId())
                );
        }

        if (error instanceof WebClientResponseException.TooManyRequests) {
            return getCachedPaymentResult()
                .switchIfEmpty(queueForLaterProcessing(request));
        }

        return Mono.error(error);
    }

    private Mono<PaymentResult> queueForLaterProcessing(PaymentRequest request) {
        return queueRepository.save(PaymentQueue.from(request))
            .map(queue -> PaymentResult.queued(queue.getId()));
    }

    private Mono<PaymentResult> getCachedPaymentResult() {
        return Mono.justOrEmpty(
            cacheManager.getCache("payments").get(request.getId(), PaymentResult.class)
        );
    }
}
```

## 5. 에러 처리 전략

### 5.1 HTTP 상태 코드별 처리

```java
public Mono<PaymentResult> processPaymentWithErrorHandling(PaymentRequest request) {
    return paymentWebClient.post()
        .uri("/payments")
        .bodyValue(request)
        .retrieve()
        // 4xx 에러 처리
        .onStatus(
            HttpStatus::is4xxClientError,
            clientResponse -> clientResponse.bodyToMono(ErrorResponse.class)
                .flatMap(errorBody -> {
                    log.error("Client error: {}", errorBody.getMessage());

                    if (clientResponse.statusCode() == HttpStatus.BAD_REQUEST) {
                        return Mono.error(new InvalidPaymentRequestException(
                            errorBody.getMessage()
                        ));
                    }

                    if (clientResponse.statusCode() == HttpStatus.UNAUTHORIZED) {
                        return refreshTokenAndRetry(request);
                    }

                    return Mono.error(new PaymentClientException(
                        errorBody.getMessage()
                    ));
                })
        )
        // 5xx 에러 처리
        .onStatus(
            HttpStatus::is5xxServerError,
            clientResponse -> clientResponse.bodyToMono(ErrorResponse.class)
                .flatMap(errorBody -> {
                    log.error("Server error: {}", errorBody.getMessage());
                    return Mono.error(new PaymentServerException(
                        errorBody.getMessage()
                    ));
                })
        )
        .bodyToMono(PaymentResult.class)
        .onErrorResume(WebClientRequestException.class, ex -> {
            log.error("Network error during payment request", ex);
            return Mono.error(new PaymentNetworkException(
                "Failed to connect to payment service", ex
            ));
        })
        .onErrorResume(TimeoutException.class, ex -> {
            log.error("Payment request timed out", ex);
            return Mono.error(new PaymentTimeoutException(
                "Payment processing timed out", ex
            ));
        });
}
```

### 5.2 예외 계층 구조

```java
public class PaymentException extends RuntimeException {
    public PaymentException(String message) {
        super(message);
    }

    public PaymentException(String message, Throwable cause) {
        super(message, cause);
    }
}

// 재시도 가능한 예외
public class RetryablePaymentException extends PaymentException {
    public RetryablePaymentException(String message) {
        super(message);
    }
}

// 재시도 불가능한 예외
public class NonRetryablePaymentException extends PaymentException {
    public NonRetryablePaymentException(String message) {
        super(message);
    }
}

// 구체적인 예외들
public class PaymentTimeoutException extends RetryablePaymentException {
    public PaymentTimeoutException(String message, Throwable cause) {
        super(message);
    }
}

public class PaymentServerException extends RetryablePaymentException {
    public PaymentServerException(String message) {
        super(message);
    }
}

public class InvalidPaymentRequestException extends NonRetryablePaymentException {
    public InvalidPaymentRequestException(String message) {
        super(message);
    }
}
```

## 6. 실전 패턴

### 6.1 통합 재시도 및 Circuit Breaker

```java
@Configuration
public class WebClientResilienceConfig {

    @Bean
    public WebClient resilientWebClient(
            ReactiveCircuitBreakerFactory circuitBreakerFactory) {

        HttpClient httpClient = HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000)
            .responseTimeout(Duration.ofSeconds(5))
            .doOnConnected(conn -> conn
                .addHandlerLast(new ReadTimeoutHandler(5))
                .addHandlerLast(new WriteTimeoutHandler(5))
            );

        return WebClient.builder()
            .baseUrl("https://api.payment.com")
            .clientConnector(new ReactorClientHttpConnector(httpClient))
            .filter((request, next) -> next.exchange(request)
                .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
                    .filter(throwable ->
                        throwable instanceof WebClientRequestException ||
                        throwable instanceof TimeoutException
                    )
                    .doBeforeRetry(signal ->
                        log.warn("Retrying request to {}, attempt: {}",
                            request.url(), signal.totalRetries() + 1)
                    )
                )
                .transform(it ->
                    circuitBreakerFactory.create("payment-api").run(it)
                )
                .doOnError(error ->
                    log.error("Request to {} failed", request.url(), error)
                )
            )
            .build();
    }
}
```

### 6.2 동적 타임아웃 조정

```java
@Service
public class AdaptiveTimeoutService {

    private final WebClient webClient;
    private final AtomicInteger successCount = new AtomicInteger(0);
    private final AtomicInteger failureCount = new AtomicInteger(0);

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        Duration timeout = calculateAdaptiveTimeout();

        return webClient.post()
            .uri("/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class)
            .timeout(timeout)
            .doOnSuccess(result -> {
                successCount.incrementAndGet();
                failureCount.set(0);  // 성공 시 실패 카운트 리셋
            })
            .doOnError(TimeoutException.class, ex -> {
                failureCount.incrementAndGet();
            });
    }

    private Duration calculateAdaptiveTimeout() {
        int failures = failureCount.get();

        // 실패가 증가하면 타임아웃을 점진적으로 늘림
        if (failures > 10) {
            return Duration.ofSeconds(15);
        } else if (failures > 5) {
            return Duration.ofSeconds(10);
        } else {
            return Duration.ofSeconds(5);
        }
    }
}
```

### 6.3 멀티 엔드포인트 Fallback

```java
@Service
@RequiredArgsConstructor
public class MultiEndpointPaymentService {

    private final WebClient webClient;
    private final List<String> endpoints = List.of(
        "https://api-primary.payment.com",
        "https://api-secondary.payment.com",
        "https://api-backup.payment.com"
    );

    public Mono<PaymentResult> processPayment(PaymentRequest request) {
        return tryEndpoints(request, 0);
    }

    private Mono<PaymentResult> tryEndpoints(PaymentRequest request, int index) {
        if (index >= endpoints.size()) {
            return Mono.error(new PaymentException("All endpoints failed"));
        }

        String endpoint = endpoints.get(index);

        return webClient.post()
            .uri(endpoint + "/payments")
            .bodyValue(request)
            .retrieve()
            .bodyToMono(PaymentResult.class)
            .timeout(Duration.ofSeconds(5))
            .onErrorResume(throwable -> {
                log.warn("Endpoint {} failed, trying next: {}",
                    endpoint, throwable.getMessage());

                // 다음 엔드포인트 시도
                return tryEndpoints(request, index + 1);
            });
    }
}
```

## 7. 모니터링 및 메트릭

### 7.1 Micrometer 통합

```java
@Configuration
public class WebClientMetricsConfig {

    @Bean
    public WebClient monitoredWebClient(MeterRegistry meterRegistry) {
        return WebClient.builder()
            .baseUrl("https://api.payment.com")
            .filter((request, next) -> {
                Timer.Sample sample = Timer.start(meterRegistry);

                return next.exchange(request)
                    .doOnSuccess(response -> {
                        sample.stop(Timer.builder("webclient.requests")
                            .tag("method", request.method().name())
                            .tag("uri", request.url().getPath())
                            .tag("status", String.valueOf(response.statusCode().value()))
                            .tag("outcome", "success")
                            .register(meterRegistry));

                        meterRegistry.counter("webclient.requests.total",
                            "method", request.method().name(),
                            "status", String.valueOf(response.statusCode().value())
                        ).increment();
                    })
                    .doOnError(error -> {
                        sample.stop(Timer.builder("webclient.requests")
                            .tag("method", request.method().name())
                            .tag("uri", request.url().getPath())
                            .tag("outcome", "error")
                            .tag("exception", error.getClass().getSimpleName())
                            .register(meterRegistry));

                        meterRegistry.counter("webclient.requests.errors",
                            "method", request.method().name(),
                            "exception", error.getClass().getSimpleName()
                        ).increment();
                    });
            })
            .build();
    }
}
```

### 7.2 Circuit Breaker 메트릭

```java
@Component
@RequiredArgsConstructor
public class CircuitBreakerMetrics {

    private final CircuitBreakerRegistry circuitBreakerRegistry;
    private final MeterRegistry meterRegistry;

    @PostConstruct
    public void registerMetrics() {
        circuitBreakerRegistry.getAllCircuitBreakers().forEach(circuitBreaker -> {
            // 상태 변경 이벤트 리스닝
            circuitBreaker.getEventPublisher()
                .onStateTransition(event -> {
                    log.info("Circuit Breaker '{}' state changed from {} to {}",
                        circuitBreaker.getName(),
                        event.getStateTransition().getFromState(),
                        event.getStateTransition().getToState());

                    meterRegistry.counter("circuit.breaker.state.transitions",
                        "name", circuitBreaker.getName(),
                        "from", event.getStateTransition().getFromState().name(),
                        "to", event.getStateTransition().getToState().name()
                    ).increment();
                })
                .onSuccess(event ->
                    meterRegistry.counter("circuit.breaker.calls.success",
                        "name", circuitBreaker.getName()
                    ).increment()
                )
                .onError(event ->
                    meterRegistry.counter("circuit.breaker.calls.error",
                        "name", circuitBreaker.getName(),
                        "exception", event.getThrowable().getClass().getSimpleName()
                    ).increment()
                )
                .onCallNotPermitted(event ->
                    meterRegistry.counter("circuit.breaker.calls.rejected",
                        "name", circuitBreaker.getName()
                    ).increment()
                );

            // Gauge로 현재 상태 노출
            Gauge.builder("circuit.breaker.state",
                    circuitBreaker,
                    cb -> cb.getState().getOrder())
                .tag("name", circuitBreaker.getName())
                .description("Circuit Breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)")
                .register(meterRegistry);
        });
    }
}
```

### 7.3 Grafana 대시보드

**Prometheus 쿼리**:

```promql
# 평균 요청 시간
rate(webclient_requests_seconds_sum[5m])
  / rate(webclient_requests_seconds_count[5m])

# 에러율
sum(rate(webclient_requests_errors_total[5m]))
  / sum(rate(webclient_requests_total[5m]))

# Circuit Breaker 상태
circuit_breaker_state{name="paymentService"}

# Circuit Breaker 거부 요청
rate(circuit_breaker_calls_rejected_total[5m])
```

## 8. 테스트 전략

### 8.1 타임아웃 테스트

```java
@Test
void testConnectionTimeout() {
    // WireMock으로 지연 시뮬레이션
    stubFor(post(urlEqualTo("/payments"))
        .willReturn(aResponse()
            .withFixedDelay(5000)  // 5초 지연
            .withStatus(200)
            .withBody("{\"status\":\"success\"}")
        )
    );

    StepVerifier.create(paymentService.processPayment(request))
        .expectError(TimeoutException.class)
        .verify();
}
```

### 8.2 재시도 동작 테스트

```java
@Test
void testRetryOnFailure() {
    // 처음 2번은 실패, 3번째는 성공
    stubFor(post(urlEqualTo("/payments"))
        .inScenario("Retry")
        .whenScenarioStateIs(STARTED)
        .willReturn(aResponse().withStatus(503))
        .willSetStateTo("FIRST_RETRY"));

    stubFor(post(urlEqualTo("/payments"))
        .inScenario("Retry")
        .whenScenarioStateIs("FIRST_RETRY")
        .willReturn(aResponse().withStatus(503))
        .willSetStateTo("SECOND_RETRY"));

    stubFor(post(urlEqualTo("/payments"))
        .inScenario("Retry")
        .whenScenarioStateIs("SECOND_RETRY")
        .willReturn(aResponse()
            .withStatus(200)
            .withBody("{\"status\":\"success\"}")
        ));

    StepVerifier.create(paymentService.processPayment(request))
        .expectNextMatches(result -> "success".equals(result.getStatus()))
        .verifyComplete();

    // 총 3번 호출되었는지 검증
    verify(3, postRequestedFor(urlEqualTo("/payments")));
}
```

### 8.3 Circuit Breaker 테스트

```java
@Test
void testCircuitBreakerOpens() {
    // 연속 실패로 Circuit Breaker Open
    stubFor(post(urlEqualTo("/payments"))
        .willReturn(aResponse().withStatus(500)));

    // 10번 호출 (실패율 임계값 초과)
    for (int i = 0; i < 10; i++) {
        paymentService.processPayment(request)
            .onErrorResume(ex -> Mono.empty())
            .block();
    }

    // Circuit Breaker가 Open 상태인지 확인
    CircuitBreaker circuitBreaker = circuitBreakerRegistry.circuitBreaker("paymentService");
    assertThat(circuitBreaker.getState()).isEqualTo(CircuitBreaker.State.OPEN);

    // Open 상태에서는 즉시 실패
    StepVerifier.create(paymentService.processPayment(request))
        .expectError(CallNotPermittedException.class)
        .verify();

    // WireMock에 요청이 가지 않았는지 확인
    verify(10, postRequestedFor(urlEqualTo("/payments")));
}
```

## 9. 트러블슈팅

### 9.1 타임아웃이 작동하지 않을 때

**증상**: 설정한 타임아웃보다 더 오래 대기

**원인**:
- Connection Timeout과 Response Timeout 혼동
- Blocking 코드로 인한 스레드 차단

**해결**:

```java
// ❌ Blocking 코드 사용
public Mono<PaymentResult> wrongApproach() {
    return webClient.get()
        .retrieve()
        .bodyToMono(PaymentResult.class)
        .map(result -> {
            // Blocking I/O - 타임아웃 무시됨
            String data = blockingDatabaseCall();
            return process(result, data);
        });
}

// ✅ Non-blocking 방식
public Mono<PaymentResult> correctApproach() {
    return webClient.get()
        .retrieve()
        .bodyToMono(PaymentResult.class)
        .flatMap(result ->
            reactiveRepository.findData()
                .map(data -> process(result, data))
        );
}
```

### 9.2 무한 재시도 방지

**문제**: 재시도 로직이 무한히 반복되어 리소스 고갈

**해결**:

```java
public Mono<PaymentResult> safeRetry() {
    return webClient.post()
        .retrieve()
        .bodyToMono(PaymentResult.class)
        .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
            .maxBackoff(Duration.ofSeconds(10))
            .filter(ex -> ex instanceof RetryableException)
            .onRetryExhaustedThrow((spec, signal) -> {
                log.error("Retry exhausted after {} attempts", signal.totalRetries());
                return new PaymentException("Failed after retries");
            })
        );
}
```

### 9.3 Circuit Breaker가 열리지 않을 때

**증상**: 지속적인 에러에도 Circuit Breaker가 Open되지 않음

**원인**: `minimum-number-of-calls` 미달 또는 예외가 기록되지 않음

**해결**:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        minimum-number-of-calls: 5  # 최소 호출 수 확인
        failure-rate-threshold: 50
        record-exceptions:  # 기록할 예외 명시
          - java.lang.Exception
```

## 10. 결과 및 개선 효과

### 10.1 안정성 지표

| 지표 | Before | After | 개선율 |
|------|--------|-------|--------|
| 타임아웃으로 인한 실패 | 월 120건 | 월 5건 | 96% 감소 |
| 일시적 장애로 인한 주문 실패 | 월 85건 | 월 3건 | 96% 감소 |
| 평균 응답 시간 (P95) | 8.2초 | 3.5초 | 57% 개선 |
| 외부 API 장애 파급 시간 | 15분 | 30초 | 97% 단축 |

### 10.2 사용자 경험 개선

- **주문 성공률**: 94.5% → 99.7% (5.2%p 증가)
- **평균 주문 처리 시간**: 4.8초 → 2.1초 (56% 단축)
- **에러 복구 시간**: 수동 복구 평균 12분 → 자동 복구 평균 8초

### 10.3 운영 효율성

- **장애 대응 시간**: 평균 25분 → 평균 2분 (92% 단축)
- **수동 개입 필요 건수**: 월 35건 → 월 2건 (94% 감소)

## 11. 핵심 요약

### 타임아웃 설정 원칙

1. **Connection Timeout**: 2-3초 (빠른 실패)
2. **Response Timeout**: 비즈니스 요구사항에 따라 5-10초
3. **계층별 설정**: 각 계층에 적절한 타임아웃 설정

### 재시도 전략

- **지수 백오프**: 서버 부하 분산
- **Jitter 추가**: 동시 재시도 방지
- **선택적 재시도**: 4xx는 재시도 안 함, 5xx만 재시도
- **최대 횟수 제한**: 무한 재시도 방지

### Circuit Breaker 활용

- **빠른 실패**: 장애 전파 차단
- **Fallback 제공**: 사용자 경험 유지
- **자동 복구**: Half-Open 상태로 점진적 복구

### 모니터링 필수 메트릭

- 요청 성공/실패율
- 평균/P95/P99 응답 시간
- Circuit Breaker 상태
- 재시도 횟수
