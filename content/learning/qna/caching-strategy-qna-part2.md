---
title: "캐싱 전략 (Part 2: 2-Level Cache, 실무 운영)"
study_order: 702
date: 2025-12-01
topic: "Backend"
tags: ["캐싱", "Redis", "Caffeine", "Cache", "성능최적화"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
description: "2-Level Cache, 캐시 무효화, 실무 운영 전략 심화 Q&A"
series_order: 20
draft: false
module: "qna"
---

## Q2. Local Cache (Caffeine)와 Global Cache (Redis)를 함께 사용하는 2-Level Cache를 설명해주세요.

### 답변

**2-Level Cache**: L1 (로컬 캐시) + L2 (글로벌 캐시)로 성능과 일관성 균형

```
┌─────────────────────────────────────┐
│          Application                │
│  ┌────────────────────────────┐     │
│  │  L1: Caffeine (Local)      │ 1ms │
│  │  - 각 서버마다 독립적       │     │
│  │  - 메모리 내 초고속         │     │
│  └────────────┬───────────────┘     │
└───────────────┼─────────────────────┘
                │ Cache Miss
                ▼
┌─────────────────────────────────────┐
│  L2: Redis (Global)                 │ 10ms
│  - 모든 서버가 공유                  │
│  - 네트워크 지연 있지만 빠름          │
└────────────┬────────────────────────┘
             │ Cache Miss
             ▼
┌─────────────────────────────────────┐
│  Database                           │ 100ms
└─────────────────────────────────────┘
```

#### 구현

```java
@Configuration
public class CacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        // L1: Caffeine 설정
        CaffeineCache caffeineCache = new CaffeineCache(
            "users",
            Caffeine.newBuilder()
                .expireAfterWrite(5, TimeUnit.MINUTES)  // 5분
                .maximumSize(1000)
                .recordStats()  // 통계 수집
                .build()
        );

        // L2: Redis 설정
        RedisCacheConfiguration redisConfig = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofHours(1))  // 1시간
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer()
                )
            );

        RedisCacheManager redisCacheManager = RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(redisConfig)
            .build();

        // 2-Level Cache Manager
        return new CompositeCacheManager(
            new CaffeineCacheManager("users"),  // L1
            redisCacheManager  // L2
        );
    }
}

// Custom 2-Level Cache
@Component
@RequiredArgsConstructor
@Slf4j
public class TwoLevelCache {

    private final Cache<String, Object> localCache;  // Caffeine
    private final RedisTemplate<String, Object> redisTemplate;  // Redis

    @PostConstruct
    public void init() {
        this.localCache = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(5))
            .maximumSize(1000)
            .build();
    }

    public <T> T get(String key, Class<T> type, Supplier<T> loader) {
        // 1. L1 캐시 조회 (Caffeine)
        Object cached = localCache.getIfPresent(key);
        if (cached != null) {
            log.debug("L1 cache hit: {}", key);
            return type.cast(cached);
        }

        // 2. L2 캐시 조회 (Redis)
        cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            log.debug("L2 cache hit: {}", key);

            // L1 캐시에 저장 (write-back)
            localCache.put(key, cached);

            return type.cast(cached);
        }

        // 3. DB 조회 (Cache miss)
        log.debug("Cache miss, loading from DB: {}", key);
        T value = loader.get();

        // 4. L2 캐시에 저장 (Redis)
        redisTemplate.opsForValue().set(key, value, Duration.ofHours(1));

        // 5. L1 캐시에 저장 (Caffeine)
        localCache.put(key, value);

        return value;
    }

    public void evict(String key) {
        // L1, L2 모두 삭제
        localCache.invalidate(key);
        redisTemplate.delete(key);

        // 다른 서버의 L1 캐시 무효화 (Pub/Sub)
        redisTemplate.convertAndSend("cache:invalidate", key);
    }
}

// 사용
@Service
@RequiredArgsConstructor
public class UserService {

    private final TwoLevelCache twoLevelCache;
    private final UserRepository userRepository;

    public User getUser(Long userId) {
        String cacheKey = "user:" + userId;

        return twoLevelCache.get(
            cacheKey,
            User.class,
            () -> userRepository.findById(userId).orElseThrow()
        );
    }

    public void updateUser(Long userId, UserUpdateRequest request) {
        User user = userRepository.findById(userId).orElseThrow();
        user.update(request);
        userRepository.save(user);

        // 캐시 무효화
        twoLevelCache.evict("user:" + userId);
    }
}
```

#### Redis Pub/Sub으로 L1 캐시 동기화

```java
@Configuration
public class RedisPubSubConfig {

    @Bean
    public RedisMessageListenerContainer redisMessageListenerContainer(
            RedisConnectionFactory connectionFactory,
            CacheInvalidationListener listener) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);

        container.addMessageListener(
            listener,
            new PatternTopic("cache:invalidate")
        );

        return container;
    }
}

@Component
@RequiredArgsConstructor
@Slf4j
public class CacheInvalidationListener implements MessageListener {

    private final Cache<String, Object> localCache;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        String key = new String(message.getBody());

        log.info("Received cache invalidation message: {}", key);

        // 로컬 캐시 무효화
        localCache.invalidate(key);
    }
}
```

#### 2-Level Cache 장점

| 계층 | 속도 | 용량 | 일관성 | 적합한 데이터 |
|------|------|------|--------|-------------|
| **L1 (Caffeine)** | 1ms | 작음 (메모리) | 낮음 | 초고빈도 조회 (현재 사용자 세션) |
| **L2 (Redis)** | 10ms | 중간 | 높음 | 빈번한 조회 (상품 정보) |
| **DB** | 100ms | 큼 | 최고 | 영구 저장 |

### 꼬리 질문 1: Caffeine이 다른 로컬 캐시보다 좋은 이유는?

**Caffeine vs Guava Cache vs EhCache**

| 항목 | Caffeine | Guava Cache | EhCache |
|------|----------|-------------|---------|
| **성능** | 가장 빠름 (Window TinyLFU) | 빠름 | 중간 |
| **메모리 효율** | 우수 | 보통 | 보통 |
| **만료 정책** | 다양 (Write/Access 기반) | 기본적 | 다양 |
| **비동기 로딩** | ✅ | ❌ | ✅ |
| **통계** | 상세 | 기본 | 상세 |
| **Spring 지원** | ✅ | ✅ | ✅ |

**Caffeine의 Window TinyLFU 알고리즘:**
```java
@Configuration
public class CaffeineConfig {

    @Bean
    public Cache<String, Object> caffeineCache() {
        return Caffeine.newBuilder()
            // 크기 기반 제거 (LRU + LFU 결합)
            .maximumSize(10000)

            // 시간 기반 만료
            .expireAfterWrite(Duration.ofMinutes(5))  // 쓰기 후 5분
            .expireAfterAccess(Duration.ofMinutes(3))  // 마지막 접근 후 3분

            // 비동기 로딩
            .buildAsync((key, executor) -> {
                return CompletableFuture.supplyAsync(
                    () -> loadFromDatabase(key),
                    executor
                );
            });
    }
}
```

### 꼬리 질문 2: 캐시 크기를 어떻게 결정하나요?

**메모리 계산:**
```
캐시 크기 = (사용 가능한 메모리 * 0.7) / 평균 객체 크기

예시:
- 사용 가능한 메모리: 4GB
- 평균 User 객체 크기: 2KB
- 캐시 크기 = (4GB * 0.7) / 2KB = 1,400,000개
```

**모니터링으로 최적화:**
```java
@Component
@Slf4j
public class CacheMonitor {

    @Autowired
    private Cache<String, Object> cache;

    @Scheduled(fixedDelay = 60000)  // 1분마다
    public void logCacheStats() {
        CacheStats stats = cache.stats();

        double hitRate = stats.hitRate();
        long evictionCount = stats.evictionCount();
        long loadSuccessCount = stats.loadSuccessCount();
        long loadFailureCount = stats.loadFailureCount();

        log.info("Cache Stats - Hit Rate: {:.2f}%, Evictions: {}, Loads: {} (Success: {}, Failure: {})",
            hitRate * 100,
            evictionCount,
            loadSuccessCount + loadFailureCount,
            loadSuccessCount,
            loadFailureCount
        );

        // Hit Rate < 70% → 캐시 크기 증가 고려
        if (hitRate < 0.7) {
            log.warn("Cache hit rate is low: {:.2f}%", hitRate * 100);
        }
    }
}
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: 캐싱 전략 (Part 1: 캐시 패턴과 기초)](/learning/qna/caching-strategy-qna/)**
