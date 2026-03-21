---
title: "Redis Cache Stampede 방지 실전: 락, 조기만료, 이중 캐시"
date: 2026-02-12
draft: false
topic: "Caching"
tags: ["Redis", "Cache Stampede", "Thundering Herd", "Distributed Lock", "Lua", "Spring Boot", "Caffeine"]
categories: ["Backend Deep Dive"]
description: "TTL 만료 폭발을 막는 락/조기만료/이중 캐시 전략과 Spring Boot 통합, 모니터링, 실전 트러블슈팅까지"
module: "data-system"
quizzes:
  - question: "Cache Stampede(Thundering Herd)의 핵심 원인은?"
    options:
      - "캐시 히트율이 너무 높은 것"
      - "핫 키가 만료되는 순간 다수의 요청이 동시에 DB를 조회하는 것"
      - "Redis 메모리가 부족한 것"
      - "네트워크 지연이 큰 것"
    answer: 1
    explanation: "핫 키의 TTL 만료 시점에 동시 요청이 DB로 쏠리면서 백엔드를 마비시키는 현상이 Cache Stampede입니다."

  - question: "분산 락을 사용할 때 가장 중요한 구현 포인트는?"
    options:
      - "락을 영원히 유지한다"
      - "락 획득 실패 시 무한 대기"
      - "만료 시간을 반드시 설정하고, 해제는 소유자만 가능하게 한다"
      - "락 키를 여러 개 만든다"
    answer: 2
    explanation: "락이 해제되지 않으면 장애가 되므로 만료 시간을 두고, 소유자 토큰을 검증해 안전하게 해제해야 합니다."

  - question: "조기 만료(Early Expiration) 전략의 장점은?"
    options:
      - "캐시 데이터를 항상 최신으로 유지한다"
      - "만료 직전부터 확률적으로 갱신하여 동시 재생성 폭발을 줄인다"
      - "TTL을 없앤다"
      - "락 없이도 완벽한 정합성을 보장한다"
    answer: 1
    explanation: "조기 만료는 만료 직전 확률적으로 갱신을 시도해 재생성 요청을 분산시키는 전략입니다."

  - question: "이중 캐시(L1/L2) 전략이 유리한 상황은?"
    options:
      - "요청이 아주 적은 서비스"
      - "핫 키가 매우 자주 조회되는 서비스"
      - "데이터 정합성이 절대적인 금융 시스템"
      - "캐시를 사용하지 않는 서비스"
    answer: 1
    explanation: "핫 키가 많고 조회가 매우 잦은 경우, 애플리케이션 로컬 캐시(L1)가 Redis(L2)까지의 부하를 줄여줍니다."
study_order: 309
---

## 이 글에서 얻는 것

- Cache Stampede의 구조적 원인과 **3가지 변종**(Hot Key Expiry, Cold Start, Mass Invalidation)을 구분합니다.
- **분산 락 + 조기 만료 + 이중 캐시**를 조합하는 실전 패턴을 이해합니다.
- **Spring Boot + Redis + Caffeine**으로 실무에 바로 적용하는 코드를 작성합니다.
- **TTL Jitter**, **Singleflight**, **Stale-While-Revalidate** 등 고급 패턴을 익힙니다.
- Prometheus/Grafana로 캐시 상태를 **모니터링**하고 **알람** 기준을 설정합니다.
- 실전 트러블슈팅 사례와 안티패턴을 체크합니다.

---

## 1) 문제 상황: TTL 만료 순간 폭발

핫 키가 만료되는 순간, 동시에 수천 개 요청이 DB로 쏠리면 **DB가 먼저 죽습니다**.

### 1-1. Stampede 3가지 변종

| 변종 | 원인 | 특징 | 예시 |
|:---|:---|:---|:---|
| **Hot Key Expiry** | 인기 키 1개의 TTL 만료 | 순간 동시 DB 조회 폭발 | 인기 상품 상세, 메인 배너 |
| **Cold Start** | 서비스 재시작/캐시 초기화 | 전체 키가 비어있어 대량 miss | 새벽 배포 후 첫 트래픽 |
| **Mass Invalidation** | 동시에 다수 키 삭제 | 대규모 DB 부하 | Cache-Aside 갱신 시 bulk delete |

### 1-2. 영향 시뮬레이션

```
평시:  1,000 RPS → 99% Cache Hit → DB 10 QPS ✅
만료 시: 1,000 RPS → 0% Cache Hit → DB 1,000 QPS 💥

DB 커넥션 풀: 100개 → 900개 요청 대기
응답 시간: 5ms → 3,000ms+ (타임아웃 연쇄)
```

---

## 2) 전략 1: 분산 락으로 단일 재생성 보장

한 번에 한 요청만 DB를 조회해 캐시를 다시 채우게 합니다.

### 2-1. 기본 구현

```java
@Service
@RequiredArgsConstructor
public class CacheWithLockService {
    
    private final StringRedisTemplate redis;
    private final UserRepository userRepository;
    
    private static final long CACHE_TTL = 60;      // 초
    private static final long LOCK_TTL  = 5;        // 초
    private static final int  MAX_RETRY = 3;
    private static final long RETRY_DELAY_MS = 100;
    
    public String getUserProfile(String userId) {
        String key = "user:profile:" + userId;
        
        // 1. 캐시 조회
        String cached = redis.opsForValue().get(key);
        if (cached != null) return cached;
        
        // 2. 분산 락 시도
        String lockKey = "lock:" + key;
        String token = UUID.randomUUID().toString();
        Boolean locked = redis.opsForValue()
            .setIfAbsent(lockKey, token, LOCK_TTL, TimeUnit.SECONDS);
        
        if (Boolean.TRUE.equals(locked)) {
            try {
                // 3. Double-check: 락 획득 사이에 다른 스레드가 채웠을 수 있음
                cached = redis.opsForValue().get(key);
                if (cached != null) return cached;
                
                // 4. DB 조회 + 캐시 저장
                String fresh = loadFromDb(userId);
                redis.opsForValue().set(key, fresh, CACHE_TTL, TimeUnit.SECONDS);
                return fresh;
            } finally {
                // 5. 안전한 락 해제 (소유자 검증)
                releaseLock(lockKey, token);
            }
        }
        
        // 6. 락 획득 실패 → 짧은 대기 후 재시도
        return retryGetFromCache(key, userId);
    }
    
    private String retryGetFromCache(String key, String userId) {
        for (int i = 0; i < MAX_RETRY; i++) {
            try { Thread.sleep(RETRY_DELAY_MS); } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
            String cached = redis.opsForValue().get(key);
            if (cached != null) return cached;
        }
        // 최종 fallback: 직접 DB 조회 (stampede 방지보다 가용성 우선)
        return loadFromDb(userId);
    }
    
    private String loadFromDb(String userId) {
        return userRepository.findById(userId)
            .map(User::toJson)
            .orElse("{}");
    }
    
    /**
     * Lua 스크립트로 원자적 락 해제 (소유자 토큰 검증)
     */
    private void releaseLock(String lockKey, String token) {
        String script = """
            if redis.call("GET", KEYS[1]) == ARGV[1] then
                return redis.call("DEL", KEYS[1])
            else
                return 0
            end
            """;
        redis.execute(new DefaultRedisScript<>(script, Long.class),
            List.of(lockKey), token);
    }
}
```

### 2-2. Redisson으로 더 안전하게

```java
@Service
@RequiredArgsConstructor
public class CacheWithRedissonLock {
    
    private final RedissonClient redisson;
    private final StringRedisTemplate redis;
    
    public String getUserProfile(String userId) {
        String key = "user:profile:" + userId;
        
        String cached = redis.opsForValue().get(key);
        if (cached != null) return cached;
        
        RLock lock = redisson.getLock("lock:" + key);
        
        try {
            // waitTime=3초, leaseTime=5초 (자동 만료)
            boolean locked = lock.tryLock(3, 5, TimeUnit.SECONDS);
            
            if (locked) {
                try {
                    // Double-check
                    cached = redis.opsForValue().get(key);
                    if (cached != null) return cached;
                    
                    String fresh = loadFromDb(userId);
                    redis.opsForValue().set(key, fresh, 60, TimeUnit.SECONDS);
                    return fresh;
                } finally {
                    if (lock.isHeldByCurrentThread()) {
                        lock.unlock();
                    }
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        
        // 락 타임아웃 → fallback
        return loadFromDb(userId);
    }
}
```

---

## 3) 전략 2: 조기 만료 (Probabilistic Early Expiration)

TTL이 끝나기 전에 **확률적으로 갱신**하여 요청을 분산시킵니다.

### 3-1. XFetch 알고리즘 (논문 기반)

```java
/**
 * "Optimal Probabilistic Cache Stampede Prevention" (Vattani et al.) 구현
 * 
 * 만료까지 남은 시간이 적을수록 갱신 확률이 높아짐
 * P(갱신) = 1 - exp(-delta * beta / ttlRemaining)
 *   delta = 마지막 갱신에 걸린 시간 (ms)
 *   beta  = 튜닝 파라미터 (기본 1.0)
 */
@Component
@RequiredArgsConstructor
public class XFetchCacheService {
    
    private final StringRedisTemplate redis;
    private static final double BETA = 1.0;
    
    /**
     * 캐시 값과 메타데이터를 함께 저장
     * value 형식: {data}|{computeTimeMs}|{createdAtMs}
     */
    public String getWithXFetch(String key, long ttlSeconds,
                                 Supplier<String> loader) {
        String raw = redis.opsForValue().get(key);
        
        if (raw != null) {
            String[] parts = raw.split("\\|", 3);
            String data = parts[0];
            double computeTime = Double.parseDouble(parts[1]);
            long createdAt = Long.parseLong(parts[2]);
            
            long ttlRemaining = ttlSeconds * 1000 
                - (System.currentTimeMillis() - createdAt);
            
            // 조기 갱신 확률 계산
            if (ttlRemaining > 0 && !shouldRefresh(computeTime, ttlRemaining)) {
                return data;  // 아직 갱신 불필요
            }
        }
        
        // 갱신 실행 (락과 조합 가능)
        long start = System.currentTimeMillis();
        String fresh = loader.get();
        long computeMs = System.currentTimeMillis() - start;
        
        String packed = fresh + "|" + computeMs + "|" + System.currentTimeMillis();
        redis.opsForValue().set(key, packed, ttlSeconds, TimeUnit.SECONDS);
        
        return fresh;
    }
    
    private boolean shouldRefresh(double computeTimeMs, long ttlRemainingMs) {
        // delta * beta * (-log(rand)) > ttlRemaining → 갱신
        double random = Math.random();
        if (random == 0) random = 0.0001;
        double threshold = computeTimeMs * BETA * (-Math.log(random));
        return threshold > ttlRemainingMs;
    }
}
```

### 3-2. 확률 분포 예시 (computeTime=100ms, TTL=60s)

| 남은 TTL | 갱신 확률 | 의미 |
|:---|:---|:---|
| 30초 | ~0.3% | 거의 갱신 안 함 |
| 10초 | ~1% | 가끔 갱신 |
| 3초 | ~3.3% | 더 자주 갱신 |
| 1초 | ~10% | 적극 갱신 |
| 100ms | ~63% | 거의 확실히 갱신 |

> **장점**: 만료 시점에 하나의 요청만 갱신하고 나머지는 기존 캐시 사용
> **단점**: 캐시에 메타데이터를 함께 저장해야 함

---

## 4) 전략 3: TTL Jitter — Mass Invalidation 방지

모든 키의 TTL이 동시에 만료되는 것을 방지합니다.

```java
@Component
public class JitteredCacheWriter {
    
    private static final ThreadLocalRandom random = ThreadLocalRandom.current();
    
    /**
     * TTL에 ±20% 랜덤 지터를 추가
     * baseTtl=60초 → 실제 TTL은 48~72초 사이
     */
    public void setWithJitter(StringRedisTemplate redis,
                               String key, String value, long baseTtlSeconds) {
        long jitter = (long) (baseTtlSeconds * 0.2 * (random.nextDouble() * 2 - 1));
        long actualTtl = Math.max(baseTtlSeconds + jitter, 1);
        redis.opsForValue().set(key, value, actualTtl, TimeUnit.SECONDS);
    }
}
```

### 적용 가이드

| 상황 | 기본 TTL | Jitter 범위 | 이유 |
|:---|:---|:---|:---|
| 상품 카탈로그 (수천 키) | 1시간 | ±20% (48~72분) | 동시 만료 방지 |
| 사용자 세션 | 30분 | 없음 | 정확한 만료 필요 |
| 랭킹/집계 | 5분 | ±10% (4.5~5.5분) | 적당히 분산 |
| 설정값 | 24시간 | ±30% (17~31시간) | 넉넉한 분산 |

---

## 5) 전략 4: 이중 캐시 (L1 Caffeine + L2 Redis)

### 5-1. Spring Boot 통합 구현

```java
@Configuration
public class TwoLevelCacheConfig {
    
    /**
     * L1: Caffeine (로컬, 초고속, 짧은 TTL)
     * L2: Redis (공유, 긴 TTL)
     */
    @Bean
    public Cache<String, String> localCache() {
        return Caffeine.newBuilder()
            .maximumSize(10_000)             // 최대 10,000 엔트리
            .expireAfterWrite(10, TimeUnit.SECONDS)  // 10초 TTL
            .recordStats()                   // 모니터링용 통계
            .build();
    }
}

@Service
@RequiredArgsConstructor
@Slf4j
public class TwoLevelCacheService {
    
    private final Cache<String, String> localCache;   // L1
    private final StringRedisTemplate redis;           // L2
    private final MeterRegistry meterRegistry;
    
    private static final long L2_TTL_SECONDS = 300;   // 5분
    
    public String get(String key, Supplier<String> loader) {
        // L1 조회
        String v = localCache.getIfPresent(key);
        if (v != null) {
            meterRegistry.counter("cache.l1.hit").increment();
            return v;
        }
        meterRegistry.counter("cache.l1.miss").increment();
        
        // L2 조회
        v = redis.opsForValue().get(key);
        if (v != null) {
            meterRegistry.counter("cache.l2.hit").increment();
            localCache.put(key, v);  // L1에 승격
            return v;
        }
        meterRegistry.counter("cache.l2.miss").increment();
        
        // DB 조회 (락 조합 가능)
        v = loader.get();
        if (v != null) {
            // L2 → L1 순서로 저장
            redis.opsForValue().set(key, v, 
                L2_TTL_SECONDS + jitter(), TimeUnit.SECONDS);
            localCache.put(key, v);
        }
        
        return v;
    }
    
    /**
     * 무효화: L1 + L2 모두 삭제 + Pub/Sub으로 다른 인스턴스 L1도 무효화
     */
    public void invalidate(String key) {
        redis.delete(key);
        localCache.invalidate(key);
        // 다른 인스턴스의 L1도 무효화
        redis.convertAndSend("cache:invalidate", key);
    }
    
    private long jitter() {
        return ThreadLocalRandom.current().nextLong(-60, 61);
    }
}
```

### 5-2. Pub/Sub으로 멀티 인스턴스 L1 동기화

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class CacheInvalidationListener {
    
    private final Cache<String, String> localCache;
    
    @Bean
    public RedisMessageListenerContainer listenerContainer(
            RedisConnectionFactory factory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.addMessageListener(
            (message, pattern) -> {
                String key = new String(message.getBody());
                localCache.invalidate(key);
                log.debug("L1 invalidated via pub/sub: {}", key);
            },
            new ChannelTopic("cache:invalidate")
        );
        return container;
    }
}
```

### 5-3. L1/L2 특성 비교

| 특성 | L1 (Caffeine) | L2 (Redis) |
|:---|:---|:---|
| 위치 | JVM 힙 내 | 별도 서버 |
| 지연 | ~100ns | ~1ms |
| 용량 | 수만 개 (힙 제약) | 수억 개 (메모리 제약) |
| TTL | 5~30초 (짧게) | 1분~1시간 |
| 공유 | 인스턴스 내부 | 전체 인스턴스 |
| 일관성 | 최종적 일관성 (pub/sub) | 강한 일관성 |

---

## 6) 전략 5: Stale-While-Revalidate

만료된 데이터를 **즉시 반환**하면서, 백그라운드에서 비동기 갱신합니다.

```java
@Service
@RequiredArgsConstructor
public class StaleWhileRevalidateCache {
    
    private final StringRedisTemplate redis;
    private final TaskExecutor asyncExecutor;
    
    /**
     * 두 개의 TTL을 사용:
     * - stale TTL (데이터 키): 실제 데이터 보관 기간 (긴 TTL)
     * - fresh TTL (메타 키):  "신선" 판정 기간 (짧은 TTL)
     * 
     * fresh 만료 → stale 데이터 반환 + 비동기 갱신
     */
    public String get(String key, long freshSeconds, long staleSeconds,
                       Supplier<String> loader) {
        
        String data = redis.opsForValue().get("data:" + key);
        Boolean isFresh = redis.hasKey("fresh:" + key);
        
        if (data != null && Boolean.TRUE.equals(isFresh)) {
            return data;  // 신선한 데이터
        }
        
        if (data != null) {
            // Stale 데이터 즉시 반환 + 백그라운드 갱신
            asyncExecutor.execute(() -> refresh(key, freshSeconds, staleSeconds, loader));
            return data;
        }
        
        // 둘 다 없으면 동기 로드
        return refresh(key, freshSeconds, staleSeconds, loader);
    }
    
    private String refresh(String key, long freshSec, long staleSec,
                            Supplier<String> loader) {
        String fresh = loader.get();
        if (fresh != null) {
            redis.opsForValue().set("data:" + key, fresh, staleSec, TimeUnit.SECONDS);
            redis.opsForValue().set("fresh:" + key, "1", freshSec, TimeUnit.SECONDS);
        }
        return fresh;
    }
}
```

---

## 7) Singleflight 패턴 — 중복 요청 합치기

동일 키에 대한 동시 요청을 **하나로 합쳐서** DB 조회를 1번만 실행합니다.

```java
@Component
public class SingleflightCache {
    
    /**
     * ConcurrentHashMap + CompletableFuture로 구현
     * 같은 키에 대해 동시에 여러 요청이 와도 DB 조회는 1번만
     */
    private final ConcurrentHashMap<String, CompletableFuture<String>> inflight
        = new ConcurrentHashMap<>();
    
    public String getOrLoad(String key, Supplier<String> loader) {
        CompletableFuture<String> future = inflight.computeIfAbsent(key, k -> {
            CompletableFuture<String> f = CompletableFuture.supplyAsync(loader::get);
            f.whenComplete((result, ex) -> inflight.remove(k));
            return f;
        });
        
        try {
            return future.get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            inflight.remove(key);
            throw new RuntimeException("Cache load failed for: " + key, e);
        }
    }
}
```

---

## 8) Spring Boot Cache Abstraction 통합

### 8-1. CacheManager 설정

```java
@Configuration
@EnableCaching
public class CacheConfig {
    
    @Bean
    @Primary
    public CacheManager redisCacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration config = RedisCacheConfiguration
            .defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair
                    .fromSerializer(new GenericJackson2JsonRedisSerializer()))
            .disableCachingNullValues();
        
        // 캐시별 TTL 차등 설정
        Map<String, RedisCacheConfiguration> perCacheConfig = Map.of(
            "products",  config.entryTtl(Duration.ofHours(1)),
            "users",     config.entryTtl(Duration.ofMinutes(30)),
            "rankings",  config.entryTtl(Duration.ofMinutes(5)),
            "configs",   config.entryTtl(Duration.ofHours(24))
        );
        
        return RedisCacheManager.builder(factory)
            .cacheDefaults(config)
            .withInitialCacheConfigurations(perCacheConfig)
            .transactionAware()
            .build();
    }
    
    @Bean
    public CacheManager caffeineCacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        manager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(5_000)
            .expireAfterWrite(10, TimeUnit.SECONDS)
            .recordStats());
        return manager;
    }
}
```

### 8-2. 서비스 적용 예시

```java
@Service
@RequiredArgsConstructor
public class ProductService {
    
    private final ProductRepository productRepo;
    
    @Cacheable(value = "products", key = "#productId",
               unless = "#result == null")
    public ProductDto getProduct(Long productId) {
        return productRepo.findById(productId)
            .map(ProductDto::from)
            .orElse(null);
    }
    
    @CachePut(value = "products", key = "#product.id")
    public ProductDto updateProduct(ProductUpdateRequest product) {
        Product saved = productRepo.save(product.toEntity());
        return ProductDto.from(saved);
    }
    
    @CacheEvict(value = "products", key = "#productId")
    public void deleteProduct(Long productId) {
        productRepo.deleteById(productId);
    }
    
    /**
     * 전체 무효화 (주의해서 사용)
     */
    @CacheEvict(value = "products", allEntries = true)
    @Scheduled(cron = "0 0 3 * * *")  // 매일 새벽 3시
    public void evictAllProductCache() {
        // 로그만 남김
    }
}
```

---

## 9) 모니터링 & 알람

### 9-1. Micrometer 메트릭 수집

```java
@Component
@RequiredArgsConstructor
public class CacheMetrics {
    
    private final MeterRegistry registry;
    
    /**
     * 캐시 히트율, miss율, 지연 시간 기록
     */
    public <T> T recordCacheAccess(String cacheName, String key,
                                    Supplier<T> cacheGet, Supplier<T> loader) {
        Timer.Sample sample = Timer.start(registry);
        
        T cached = cacheGet.get();
        if (cached != null) {
            registry.counter("cache_access",
                "cache", cacheName, "result", "hit").increment();
            sample.stop(registry.timer("cache_latency",
                "cache", cacheName, "result", "hit"));
            return cached;
        }
        
        registry.counter("cache_access",
            "cache", cacheName, "result", "miss").increment();
        
        T fresh = loader.get();
        sample.stop(registry.timer("cache_latency",
            "cache", cacheName, "result", "miss"));
        
        return fresh;
    }
}
```

### 9-2. Prometheus 알람 규칙

```yaml
# prometheus-rules.yaml
groups:
  - name: cache-stampede-alerts
    rules:
      # 캐시 히트율 급락 감지
      - alert: CacheHitRateDrop
        expr: |
          (
            sum(rate(cache_access_total{result="hit"}[5m])) by (cache)
            /
            sum(rate(cache_access_total[5m])) by (cache)
          ) < 0.8
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "캐시 히트율 80% 미만 ({{ $labels.cache }})"
          description: "현재 히트율: {{ $value | humanizePercentage }}"
      
      # Cache miss 후 DB 지연 급증
      - alert: CacheMissLatencySpike
        expr: |
          histogram_quantile(0.99,
            rate(cache_latency_seconds_bucket{result="miss"}[5m])
          ) > 1.0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "캐시 miss 시 DB 조회 p99 > 1초"
          
      # Redis 메모리 사용률
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis 메모리 85% 초과 — eviction 임박"
      
      # Hot Key 감지 (초당 1000회 이상 접근)
      - alert: HotKeyDetected
        expr: |
          topk(5,
            sum(rate(cache_access_total[1m])) by (key)
          ) > 1000
        for: 3m
        labels:
          severity: info
        annotations:
          summary: "Hot Key 감지: {{ $labels.key }}"
```

### 9-3. Grafana 대시보드 필수 패널

| 패널 | PromQL | 임계값 |
|:---|:---|:---|
| 전체 히트율 | `sum(rate(cache_access_total{result="hit"}[5m])) / sum(rate(cache_access_total[5m]))` | > 95% 정상 |
| L1 vs L2 히트율 | 같은 쿼리에 `cache="l1"`, `cache="l2"` 구분 | L1 > 80%, L2 > 90% |
| Miss 시 DB 지연 | `histogram_quantile(0.99, rate(cache_latency_seconds_bucket{result="miss"}[5m]))` | < 500ms |
| 초당 요청 수 | `sum(rate(cache_access_total[1m])) by (result)` | 추세 관찰 |
| Redis 메모리 | `redis_memory_used_bytes / redis_memory_max_bytes` | < 85% |

---

## 10) 전략 조합 의사결정 매트릭스

| 상황 | 추천 조합 | 이유 |
|:---|:---|:---|
| 핫 키 1~2개, 트래픽 높음 | **분산 락 + 조기 만료** | 락으로 단일 갱신 보장 + 조기 만료로 만료 시점 분산 |
| 키 수천 개, 동시 만료 위험 | **TTL Jitter + 이중 캐시** | Jitter로 만료 분산 + L1이 Redis 부하 흡수 |
| 갱신 비용 높음 (heavy query) | **Stale-While-Revalidate + Singleflight** | 즉시 응답 + 중복 쿼리 제거 |
| Cold Start (배포 직후) | **Cache Warming + 이중 캐시** | 미리 채우기 + L1 버퍼 |
| 정합성 중요 (재고/잔액) | **분산 락 (strict)** | 단 하나의 갱신만 보장 |

---

## 11) Cache Warming — Cold Start 방지

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class CacheWarmer {
    
    private final StringRedisTemplate redis;
    private final ProductRepository productRepo;
    
    /**
     * 애플리케이션 시작 시 핫 키 사전 로드
     */
    @EventListener(ApplicationReadyEvent.class)
    public void warmUpCache() {
        log.info("Cache warming 시작...");
        
        // Top 100 인기 상품 사전 로드
        List<Product> hotProducts = productRepo.findTop100ByOrderByViewCountDesc();
        
        // Pipeline으로 일괄 저장 (RTT 최소화)
        redis.executePipelined((RedisCallback<Object>) connection -> {
            for (Product p : hotProducts) {
                byte[] key = ("product:" + p.getId()).getBytes();
                byte[] value = p.toJson().getBytes();
                connection.stringCommands().setEx(key, 3600, value);
            }
            return null;
        });
        
        log.info("Cache warming 완료: {} 키 로드", hotProducts.size());
    }
}
```

---

## 12) 실전 트러블슈팅 & 안티패턴

### 12-1. 흔한 실수 체크리스트

```text
□ TTL을 모든 키에 동일하게 설정하지 않았는가? → Jitter 추가
□ 락 TTL이 DB 쿼리 시간보다 짧지 않은가? → 락 TTL > max query time
□ 락 해제 시 소유자 토큰을 검증하는가? → Lua 스크립트 필수
□ 캐시 miss fallback에 타임아웃을 설정했는가? → DB 타임아웃 + 서킷브레이커
□ L1 캐시가 너무 크지 않은가? → GC 압박 모니터링
□ Null 값도 캐시하는가? → Cache Penetration 방지 (짧은 TTL로)
□ 캐시 무효화 시 L1 + L2 모두 처리하는가? → Pub/Sub 동기화
□ 배포 시 캐시 warming을 하는가? → Cold Start 방지
```

### 12-2. 안티패턴과 올바른 접근

| 안티패턴 | 왜 위험한가 | 올바른 접근 |
|:---|:---|:---|
| 락 없이 캐시 갱신 | 동시 N개 DB 쿼리 실행 | 분산 락 + double-check |
| 무한 대기 락 | 락 미해제 시 전체 hang | `tryLock(waitTime, leaseTime)` |
| DEL로 락 해제 | 다른 스레드의 락을 삭제 | Lua 소유자 검증 |
| TTL 없는 캐시 | 메모리 누수 + 영원히 stale | 반드시 TTL 설정 |
| Cache-Aside만 사용 | Stampede에 무방비 | 조기 만료 또는 락 조합 |
| 모든 키 동일 TTL | Mass Invalidation | TTL Jitter |
| Redis 장애 시 전체 장애 | 단일 장애점 | 서킷브레이커 + DB fallback |

---

## 요약

- Cache Stampede는 TTL 만료 시점의 **동시 재생성 폭발**이다.
- **분산 락**, **조기 만료**, **이중 캐시**는 서로 보완 관계다.
- **TTL Jitter**로 Mass Invalidation을 방지하고, **Singleflight**로 중복 쿼리를 합친다.
- **Stale-While-Revalidate**로 응답 지연 없이 백그라운드 갱신이 가능하다.
- Spring Boot Cache Abstraction으로 **선언적 캐시**를 적용하고, Micrometer로 **히트율/지연**을 모니터링한다.
- 락 해제는 반드시 **소유자 토큰 검증**으로 안전하게 처리해야 한다.

---

## 연습(추천)

- 인기 키의 TTL을 5초로 줄여 스탬피드 상황을 재현해보기
- 조기 만료 확률을 바꿔가며 DB QPS 변화를 측정해보기
- 로컬 캐시(L1) 유무에 따라 Redis 부하 차이를 비교해보기
- Singleflight를 JMeter로 동시 100요청 보내 DB 호출 1회인지 검증해보기
- Prometheus 알람이 히트율 80% 미만에서 실제 발동하는지 테스트해보기

---

## 관련 심화 학습

- [Redis Caching 기초](/learning/deep-dive/deep-dive-redis-caching/) — 캐시 전략과 패턴
- [Redis Advanced](/learning/deep-dive/deep-dive-redis-advanced/) — Redis 내부 구조와 운영
- [Redis Streams](/learning/deep-dive/deep-dive-redis-streams/) — 이벤트 기반 캐시 무효화
- [분산 락](/learning/deep-dive/deep-dive-distributed-lock/) — Redlock 알고리즘과 분산 환경
- [Connection Pool](/learning/deep-dive/deep-dive-connection-pool/) — DB 커넥션 풀 관리
- [Request Coalescing & Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/) — 중복 요청 합치기
- [Connection Storm & Thundering Herd](/learning/deep-dive/deep-dive-connection-storm-thundering-herd-playbook/) — 연쇄 장애 대응
- [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/) — Redis 장애 시 fallback
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — 캐시 모니터링 기반
