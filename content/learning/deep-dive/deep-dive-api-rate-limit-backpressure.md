---
title: "API 레이트 리밋과 백프레셔 심화"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Rate Limit", "Backpressure", "API Gateway", "Resilience", "Load Shedding"]
categories: ["Backend Deep Dive"]
description: "API Gateway 레이트 리밋, 애플리케이션 레벨 백프레셔, 큐/서킷 브레이커 연계 — 알고리즘 선택부터 Redis 분산 구현, Spring Cloud Gateway 설정까지"
module: "architecture"
study_order: 470
---

## 이 글에서 얻는 것

- Rate limit(할당량 제한)과 Backpressure(압력 전달/부하 제어)를 구분하고, "어디에 무엇을 걸어야 하는지" 설계할 수 있습니다.
- 토큰 버킷/슬라이딩 윈도우 같은 알고리즘을 "정답"이 아니라 **트래픽 특성(버스트/공정성/정밀도)**에 따라 선택할 수 있습니다.
- **Redis + Lua 기반 분산 Rate Limiter**를 직접 구현할 수 있습니다.
- **Spring Cloud Gateway / Resilience4j** 설정으로 실무에 즉시 적용할 수 있습니다.
- 리트라이/서킷 브레이커/큐/스레드풀과 결합될 때 생기는 함정(증폭, 대기열 폭발)을 피하는 기준이 생깁니다.

---

## 0) Rate limit과 Backpressure는 목적이 다르다

| 구분 | Rate Limit | Backpressure |
|------|-----------|-------------|
| **목적** | 공정성/남용 방지/비용 통제 | 시스템 붕괴 방지 |
| **관점** | "누가 얼마나 요청할 수 있는지" | "시스템이 처리할 수 있는 만큼만" |
| **적용 위치** | 엣지/게이트웨이 | 애플리케이션/내부 서비스 |
| **초과 시 응답** | 429 + Retry-After | 503 / Load Shedding |
| **상태** | 사용자/키별 카운터 | 큐 길이, 동시 처리 수 |

둘을 섞어 쓰면 정책이 꼬이기 쉽습니다.
예를 들어, 대기열이 길어졌을 때는 rate limit이 아니라 **load shedding(부하 차단)**이 더 적절할 수 있습니다.

## 1) 어디에 걸까: Edge(Gateway) vs App vs Downstream

### 1-1) Gateway(엣지) 레벨

```
Client → [Rate Limit] → API Gateway → Application → DB
```

좋은 점:
- 공격/남용 트래픽을 "애플리케이션에 도달하기 전에" 자를 수 있음
- 전 서비스 공통 정책(사용자별/키별/테넌트별)을 일관되게 적용하기 쉬움

주의:
- "서비스마다 다른 처리 비용"을 반영하기 어렵습니다(요청 1건이 다 같은 비용이 아님).

### 1-2) 애플리케이션 레벨

```
API Gateway → Application → [Backpressure/Bulkhead] → DB/External API
```

좋은 점:
- 엔드포인트/기능별로 "비용 기반 제한"이 가능(예: 파일 업로드/검색/정산)
- 내부 리소스(DB 커넥션/스레드/큐) 상태를 근거로 load shedding 가능

주의:
- 분산 환경에서 공유 상태(카운터/버킷)를 어떻게 유지할지 고민이 필요합니다.

### 1-3) 다운스트림(의존성) 보호

DB/외부 API 같은 의존성을 보호하려면:

- **서킷 브레이커** — 장애 전파 차단
- **Bulkhead** — 풀/세마포어로 격리
- **제한된 리트라이** — 백오프, jitter

같은 패턴이 함께 필요합니다.

### 실무 설계 매트릭스

| 보호 대상 | 패턴 | 도구 예시 |
|----------|------|----------|
| 외부 사용자 남용 | Rate Limit (Gateway) | Spring Cloud Gateway, Kong, Envoy |
| 내부 서비스 과부하 | Backpressure + Load Shedding | Resilience4j Bulkhead, Tomcat 큐 제한 |
| DB/외부 API | Circuit Breaker + Bulkhead | Resilience4j, Sentinel |
| 메시지 처리 | Consumer 동시성 제한 + DLQ | Kafka max.poll.records, Redis Streams |

## 2) 알고리즘 선택: 트래픽 특성으로 결정한다

### 2-1) 알고리즘 비교표

| 알고리즘 | 버스트 허용 | 공정성 | 메모리 | 구현 복잡도 | 추천 시나리오 |
|---------|-----------|--------|-------|-----------|-------------|
| **Fixed Window** | 경계 버스트 | 낮음 | 최소 | 매우 쉬움 | 내부 API, PoC |
| **Sliding Window Log** | 정밀 제어 | 높음 | 높음 | 보통 | 정밀 과금 API |
| **Sliding Window Counter** | 적당 | 높음 | 낮음 | 보통 | 범용(추천) |
| **Token Bucket** | 허용 | 보통 | 최소 | 쉬움 | 범용(가장 흔함) |
| **Leaky Bucket** | 불허(평탄화) | 높음 | 최소 | 쉬움 | 다운스트림 보호 |

### 2-2) 선택 의사결정 트리

```
버스트를 허용해야 하는가?
├── Yes → Token Bucket
│     └── 다운스트림을 일정 속도로 보호해야 하는가?
│           └── Yes → Leaky Bucket (출력 평탄화)
└── No (공정성 우선)
      └── 과금/정밀 추적이 필요한가?
            ├── Yes → Sliding Window Log
            └── No → Sliding Window Counter
```

### 2-3) Fixed Window 경계 버스트 문제

```
윈도우 1 (0:00~1:00): 마지막 1초에 100건 → 허용
윈도우 2 (1:00~2:00): 첫 1초에 100건 → 허용
→ 실제로는 2초 동안 200건이 통과 (제한 100건/분인데)
```

이 문제 때문에 외부 API에서는 Sliding Window 또는 Token Bucket이 더 적합합니다.

## 3) Redis + Lua 분산 Rate Limiter 구현

단일 인스턴스 Rate Limiter는 분산 환경에서 무력합니다. Redis를 공유 저장소로 사용하면 인스턴스 간 일관성을 확보할 수 있습니다.

### 3-1) Sliding Window Counter (Redis + Lua)

```lua
-- rate_limit_sliding_window.lua
-- KEYS[1] = rate limit key (e.g., "rl:user:123")
-- ARGV[1] = window size (ms)
-- ARGV[2] = max requests
-- ARGV[3] = current timestamp (ms)

local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 만료된 엔트리 제거
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 현재 윈도우 내 요청 수
local count = redis.call('ZCARD', key)

if count < limit then
    -- 허용: 현재 타임스탬프를 score와 member로 추가
    redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
    redis.call('PEXPIRE', key, window)
    return {1, limit - count - 1}  -- {허용, 남은 횟수}
else
    -- 거부
    return {0, 0}
end
```

### 3-2) Token Bucket (Redis + Lua)

```lua
-- rate_limit_token_bucket.lua
-- KEYS[1] = bucket key
-- ARGV[1] = max tokens (burst capacity)
-- ARGV[2] = refill rate (tokens per second)
-- ARGV[3] = current timestamp (seconds, float)
-- ARGV[4] = tokens to consume

local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or max_tokens
local last_refill = tonumber(bucket[2]) or now

-- 경과 시간에 따른 토큰 충전
local elapsed = math.max(0, now - last_refill)
tokens = math.min(max_tokens, tokens + elapsed * refill_rate)

if tokens >= requested then
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) * 2)
    return {1, math.floor(tokens)}  -- {허용, 남은 토큰}
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) * 2)
    return {0, math.floor(tokens)}  -- {거부, 남은 토큰}
end
```

### 3-3) Spring Boot에서 Redis Rate Limiter 호출

```java
@Component
@RequiredArgsConstructor
public class RedisRateLimiter {

    private final StringRedisTemplate redisTemplate;
    private final RedisScript<List<Long>> slidingWindowScript;

    /**
     * @return true if allowed, false if rate limited
     */
    public RateLimitResult tryAcquire(String clientId, int windowMs, int maxRequests) {
        String key = "rl:" + clientId;
        long now = System.currentTimeMillis();

        List<Long> result = redisTemplate.execute(
            slidingWindowScript,
            List.of(key),
            String.valueOf(windowMs),
            String.valueOf(maxRequests),
            String.valueOf(now)
        );

        boolean allowed = result.get(0) == 1L;
        long remaining = result.get(1);

        return new RateLimitResult(allowed, remaining, windowMs);
    }
}

public record RateLimitResult(boolean allowed, long remaining, int windowMs) {
    public Map<String, String> toHeaders() {
        return Map.of(
            "X-RateLimit-Remaining", String.valueOf(remaining),
            "X-RateLimit-Reset", String.valueOf(
                System.currentTimeMillis() + windowMs
            )
        );
    }
}
```

## 4) Spring Cloud Gateway Rate Limiter 설정

### 4-1) 기본 설정 (Redis 기반)

```yaml
# application.yml
spring:
  cloud:
    gateway:
      routes:
        - id: api-route
          uri: lb://api-service
          predicates:
            - Path=/api/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10      # 초당 10개
                redis-rate-limiter.burstCapacity: 20       # 최대 버스트 20개
                redis-rate-limiter.requestedTokens: 1      # 요청당 1토큰
                key-resolver: "#{@userKeyResolver}"
```

### 4-2) Key Resolver (사용자/IP/API 키별)

```java
@Configuration
public class RateLimiterConfig {

    // 인증된 사용자 기준
    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> Mono.justOrEmpty(
            exchange.getRequest().getHeaders().getFirst("X-User-Id")
        ).defaultIfEmpty("anonymous");
    }

    // IP 기준 (비인증 API)
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> Mono.just(
            Objects.requireNonNull(
                exchange.getRequest().getRemoteAddress()
            ).getAddress().getHostAddress()
        );
    }

    // API 키 기준 (테넌트별)
    @Bean
    public KeyResolver apiKeyResolver() {
        return exchange -> Mono.justOrEmpty(
            exchange.getRequest().getHeaders().getFirst("X-API-Key")
        ).defaultIfEmpty("no-key");
    }
}
```

### 4-3) 엔드포인트별 차등 제한

처리 비용이 다른 엔드포인트는 토큰 소비량을 다르게 설정합니다:

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 일반 조회: 1토큰
        - id: read-api
          uri: lb://api-service
          predicates:
            - Path=/api/products/**
            - Method=GET
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
                redis-rate-limiter.requestedTokens: 1

        # 파일 업로드: 10토큰 (비용 높음)
        - id: upload-api
          uri: lb://api-service
          predicates:
            - Path=/api/upload/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
                redis-rate-limiter.requestedTokens: 10

        # 검색: 5토큰
        - id: search-api
          uri: lb://api-service
          predicates:
            - Path=/api/search/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
                redis-rate-limiter.requestedTokens: 5
```

## 5) Backpressure 구현: 실무 패턴과 코드

### 5-1) 큐/대기열 길이 제한 + Load Shedding

대기열이 무한이면 결국 타임아웃과 메모리로 터집니다.

```java
// Tomcat 스레드 풀 대기열 제한
@Configuration
public class TomcatConfig {

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> customizer() {
        return factory -> factory.addConnectorCustomizers(connector -> {
            var executor = new org.apache.tomcat.util.threads.ThreadPoolExecutor(
                10,    // core
                200,   // max
                60, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(100)  // 대기열 100으로 제한
            );
            var protocolHandler = (AbstractProtocol<?>) connector.getProtocolHandler();
            protocolHandler.setExecutor(executor);
        });
    }
}
```

### 5-2) Resilience4j Bulkhead (세마포어 방식)

```java
@Configuration
public class BulkheadConfig {

    @Bean
    public BulkheadRegistry bulkheadRegistry() {
        BulkheadConfig config = BulkheadConfig.custom()
            .maxConcurrentCalls(20)          // 동시 처리 최대 20개
            .maxWaitDuration(Duration.ZERO)  // 대기 없이 즉시 실패
            .build();

        return BulkheadRegistry.of(config);
    }
}

@Service
@RequiredArgsConstructor
public class SearchService {

    private final BulkheadRegistry bulkheadRegistry;

    public SearchResult search(String query) {
        Bulkhead bulkhead = bulkheadRegistry.bulkhead("search");

        return Bulkhead.decorateSupplier(bulkhead, () -> {
            // 실제 검색 로직 (DB/Elasticsearch)
            return doSearch(query);
        }).get();
        // 동시 호출 20개 초과 시 BulkheadFullException → 503
    }
}
```

### 5-3) 우선순위 기반 Load Shedding

모든 요청을 동일하게 거부하는 대신, 우선순위가 낮은 요청부터 드롭합니다:

```java
@Component
public class PriorityLoadShedder implements HandlerInterceptor {

    private final AtomicInteger activeRequests = new AtomicInteger(0);
    private static final int MAX_CONCURRENT = 500;

    // 우선순위: 결제 > 주문 > 조회 > 추천
    private static final Map<String, Integer> PRIORITY = Map.of(
        "/api/payment", 100,
        "/api/orders",  80,
        "/api/products", 50,
        "/api/recommendations", 20
    );

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res,
                             Object handler) throws Exception {
        int current = activeRequests.incrementAndGet();
        int priority = getPriority(req.getRequestURI());

        // 부하 높을 때 낮은 우선순위부터 드롭
        double loadRatio = (double) current / MAX_CONCURRENT;
        int threshold = (int) (100 * (1 - loadRatio));  // 부하 높을수록 임계 상승

        if (priority < threshold) {
            activeRequests.decrementAndGet();
            res.setStatus(503);
            res.setHeader("Retry-After", "5");
            res.getWriter().write("{\"error\":\"Service overloaded\"}");
            return false;
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest req, HttpServletResponse res,
                                Object handler, Exception ex) {
        activeRequests.decrementAndGet();
    }

    private int getPriority(String uri) {
        return PRIORITY.entrySet().stream()
            .filter(e -> uri.startsWith(e.getKey()))
            .map(Map.Entry::getValue)
            .findFirst()
            .orElse(50);
    }
}
```

## 6) 응답 설계: 429 vs 503, 헤더 표준

### 6-1) 429 vs 503 선택 기준

| 상황 | 응답 코드 | 의미 |
|------|----------|------|
| 사용자/키 할당량 초과 | **429** Too Many Requests | "당신이 너무 많이 보냈다" |
| 시스템 전체 과부하 | **503** Service Unavailable | "우리가 지금 처리 못 한다" |
| 의존성 장애로 처리 불가 | **503** 또는 **502** | "백엔드가 아프다" |

### 6-2) Rate Limit 응답 헤더

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1679616000

{
  "error": "rate_limit_exceeded",
  "message": "API rate limit exceeded. Try again in 30 seconds.",
  "retry_after": 30
}
```

**중요:** `Retry-After`를 반드시 포함합니다. 없으면 클라이언트가 즉시 재시도해서 상황을 악화시킵니다.

## 7) 가장 위험한 조합: 무제한 리트라이 + 느슨한 제한

실무에서 터지는 패턴:

```
서버 느려짐 → 타임아웃 증가
  → 클라이언트 재시도 → 트래픽 증가
    → 서버 더 느려짐 → 더 많은 재시도
      → 연쇄 붕괴 (Retry Storm)
```

### 방지 전략 체크리스트

| 방어 | 설명 | 구현 |
|------|------|------|
| **Retry Budget** | 총 트래픽의 N%만 재시도 허용 | Envoy: `retry_budget.budget_percent: 20` |
| **Exponential Backoff + Jitter** | 재시도 간격을 지수적으로 늘림 | `delay = min(base * 2^attempt, maxDelay) + random(0, delay)` |
| **Circuit Breaker** | 실패율 높으면 재시도 자체를 차단 | Resilience4j CircuitBreaker |
| **멱등 요청만 재시도** | POST(생성)는 재시도 금지 | 멱등키(Idempotency-Key) 필수 |
| **Client-side Rate Limit** | SDK에서 요청 속도 제한 | `RateLimiter.create(10)` (Guava) |

### Backoff + Jitter 구현

```java
public class RetryWithBackoff {

    public <T> T execute(Supplier<T> action, int maxRetries) {
        int attempt = 0;
        while (true) {
            try {
                return action.get();
            } catch (RetryableException e) {
                if (++attempt > maxRetries) throw e;

                long baseDelay = 100;  // ms
                long maxDelay = 30_000; // ms
                long delay = Math.min(baseDelay * (1L << attempt), maxDelay);
                long jitter = ThreadLocalRandom.current().nextLong(0, delay);

                try {
                    Thread.sleep(delay + jitter);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException(ie);
                }
            }
        }
    }
}
```

## 8) 모니터링 지표: 제한의 건강 상태를 본다

### 필수 메트릭

```yaml
# Prometheus 메트릭 예시
# Rate limit 차단율
- name: rate_limit_rejected_total
  type: counter
  labels: [client_id, endpoint, reason]

# 동시 처리 수 (Bulkhead)
- name: bulkhead_active_calls
  type: gauge
  labels: [service, method]

# 대기열 상태
- name: request_queue_size
  type: gauge
  labels: [service]
```

### 필수 대시보드 패널

| 패널 | 쿼리 (PromQL) | 의미 |
|------|--------------|------|
| Rate limit 차단율 | `rate(rate_limit_rejected_total[5m]) / rate(http_requests_total[5m])` | 전체 대비 차단 비율 |
| 테넌트별 소비율 | `rate(rate_limit_consumed_total[5m]) by (tenant)` | 어떤 테넌트가 많이 쓰나 |
| Bulkhead 포화도 | `bulkhead_active_calls / bulkhead_max_concurrent` | 격리 풀 사용률 |
| 재시도 비율 | `rate(retry_total[5m]) / rate(http_requests_total[5m])` | 재시도가 얼마나 발생하나 |
| p99 + 타임아웃 | `histogram_quantile(0.99, ...)` | 대기/처리 지연 |

### 알람 기준

- Rate limit 차단율 > 20% (5분) → 정상 사용자가 영향받을 수 있음
- Bulkhead 포화 > 90% (5분) → Load shedding 임박
- 재시도 비율 > 10% → Retry storm 가능성

## 9) 실무 설계 체크리스트

### 설계 시

- [ ] Rate limit과 Backpressure를 **별도 계층**으로 분리했는가?
- [ ] 엔드포인트별 **처리 비용 차이**를 반영했는가?
- [ ] **분산 환경**에서 카운터/버킷 일관성을 확보했는가? (Redis/공유 저장소)
- [ ] 429 응답에 `Retry-After` 헤더를 포함했는가?
- [ ] 클라이언트 재시도 정책(Backoff + Jitter + Budget)을 정의했는가?

### 운영 시

- [ ] Rate limit 차단율 모니터링이 있는가?
- [ ] Bulkhead 포화도 알람이 설정돼 있는가?
- [ ] 재시도 비율 모니터링으로 Retry storm을 감지하는가?
- [ ] 제한 값 변경 이력이 기록되는가? (Config 변경 추적)
- [ ] 테넌트별 사용량 대시보드가 있는가?

---

## 연습(추천)

1. "동일 트래픽인데 어떤 엔드포인트는 훨씬 비싸다"는 가정을 두고, 엔드포인트별 토큰 비용 정책을 설계해보기
2. Redis + Lua로 Token Bucket Rate Limiter를 구현하고, JMeter로 동시 100 클라이언트 테스트해보기
3. 429/503을 각각 언제 반환할지 기준을 정하고, 클라이언트 재시도 규칙까지 문서로 써보기
4. 대기열 길이를 제한했을 때(즉시 드롭) vs 제한하지 않았을 때(타임아웃 증가) 사용자 경험 차이를 k6/JMeter로 측정해보기
5. Resilience4j Bulkhead + CircuitBreaker를 함께 적용한 서비스에 부하를 주고, 각 패턴이 어떤 순서로 작동하는지 로그로 확인하기

---

## 관련 글

- [Admission Control과 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/) — Backpressure의 상위 개념, Adaptive Concurrency
- [Timeout/Retry/Backoff 전략](/learning/deep-dive/deep-dive-timeout-retry-backoff/) — 재시도 설계의 기초
- [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/) — 서킷 브레이커와의 연계
- [Observability 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/) — Rate limit/Backpressure 지표를 알람으로 연결
- [Rate Limiter 설계](/learning/deep-dive/deep-dive-rate-limiter-design/) — 시스템 설계 관점의 Rate Limiter
- [Thread Pool 튜닝](/learning/deep-dive/deep-dive-thread-pool/) — Bulkhead의 기반이 되는 스레드 풀 이해
- [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/) — 부하 제한의 이론적 근거
