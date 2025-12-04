---
title: "Redis 캐싱 전략 완벽 가이드 - 실전 패턴부터 성능 최적화까지"
date: 2025-01-26
topic: "Backend"
tags: ["Redis", "Caching", "Performance", "Cache Strategy", "Distributed System"]
categories: ["Backend Deep Dive"]
series: "백엔드 심화 학습"
series_order: 8
draft: true
---

## 들어가며

Redis는 인메모리 데이터 저장소로, 캐싱을 통해 애플리케이션 성능을 수십 배 향상시킬 수 있습니다. 이 글에서는 Redis 자료구조부터 실전 캐싱 패턴, 분산 환경 전략까지 다룹니다.

**난이도**: ⭐⭐ 중급
**예상 학습 시간**: 45분

---

## 1. Redis 기초

### 1.1 Redis란?

```
Redis (REmote DIctionary Server):
- In-Memory Key-Value 저장소
- 영속성 지원 (RDB, AOF)
- 다양한 자료구조 제공
- Single-Threaded (I/O Multiplexing)

성능:
- 읽기/쓰기: 100,000+ ops/sec
- 평균 응답 시간: <1ms
- vs RDBMS: 10~100배 빠름

┌─────────────────────────────────────┐
│ Application                          │
└────────────┬────────────────────────┘
             ↓
     ┌───────────────┐
     │ Redis (Cache) │ ← 빠름 (메모리)
     └───────┬───────┘
             ↓ (Cache Miss)
     ┌───────────────┐
     │ Database (DB) │ ← 느림 (디스크)
     └───────────────┘
```

### 1.2 Redis 자료구조

```java
// 1. String - 단순 값 저장
jedis.set("user:123:name", "Alice");
String name = jedis.get("user:123:name");  // "Alice"

// TTL 설정 (초 단위)
jedis.setex("session:abc", 3600, "user_data");  // 1시간

// 숫자 증감
jedis.incr("page:views");       // 1
jedis.incrBy("page:views", 10); // 11

// 2. Hash - 객체 저장
jedis.hset("user:123", "name", "Alice");
jedis.hset("user:123", "email", "alice@example.com");
jedis.hset("user:123", "age", "25");

Map<String, String> user = jedis.hgetAll("user:123");
// {"name": "Alice", "email": "alice@example.com", "age": "25"}

// 3. List - 순서 있는 컬렉션
jedis.lpush("queue:tasks", "task1", "task2", "task3");
String task = jedis.rpop("queue:tasks");  // "task1" (FIFO)

jedis.lpush("recent:posts", "post1", "post2", "post3");
List<String> posts = jedis.lrange("recent:posts", 0, 9);  // 최근 10개

// 4. Set - 중복 없는 집합
jedis.sadd("tags:123", "java", "spring", "redis");
Set<String> tags = jedis.smembers("tags:123");

// 집합 연산
jedis.sadd("user:123:following", "456", "789");
jedis.sadd("user:456:followers", "123", "789");
Set<String> mutualFriends = jedis.sinter("user:123:following", "user:456:followers");

// 5. Sorted Set - 정렬된 집합
jedis.zadd("leaderboard", 100, "Alice");
jedis.zadd("leaderboard", 200, "Bob");
jedis.zadd("leaderboard", 150, "Charlie");

// 순위 조회 (점수 높은 순)
List<String> top3 = jedis.zrevrange("leaderboard", 0, 2);
// ["Bob", "Charlie", "Alice"]

// 점수로 필터링
Set<String> highScorers = jedis.zrangeByScore("leaderboard", 150, Double.MAX_VALUE);
```

---

## 2. 캐싱 전략 패턴

### 2.1 Cache-Aside (Lazy Loading)

```
가장 일반적인 패턴:
1. 캐시 조회
2. 캐시 미스 → DB 조회
3. DB 결과를 캐시에 저장
4. 결과 반환

┌──────────────────────────────────────┐
│ 1. Read Request                       │
│    ↓                                  │
│ 2. Redis GET (Cache Check)            │
│    ├─ Hit → Return Cache              │
│    └─ Miss                            │
│       ↓                               │
│ 3. DB SELECT                          │
│    ↓                                  │
│ 4. Redis SET (Cache Update)           │
│    ↓                                  │
│ 5. Return DB Result                   │
└──────────────────────────────────────┘
```

**구현:**

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final RedisTemplate<String, Product> redisTemplate;
    private static final String CACHE_KEY_PREFIX = "product:";
    private static final Duration CACHE_TTL = Duration.ofHours(1);

    public Product getProduct(Long productId) {
        String cacheKey = CACHE_KEY_PREFIX + productId;

        // 1. 캐시 조회
        Product cachedProduct = redisTemplate.opsForValue().get(cacheKey);

        if (cachedProduct != null) {
            log.info("Cache Hit: {}", cacheKey);
            return cachedProduct;  // Cache Hit
        }

        // 2. 캐시 미스 → DB 조회
        log.info("Cache Miss: {}", cacheKey);
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));

        // 3. 캐시에 저장
        redisTemplate.opsForValue().set(cacheKey, product, CACHE_TTL);

        return product;
    }

    // 쓰기 시 캐시 무효화
    public Product updateProduct(Long productId, ProductUpdateRequest request) {
        Product product = productRepository.findById(productId).orElseThrow();
        product.update(request);
        productRepository.save(product);

        // 캐시 삭제 (다음 읽기 시 재생성)
        String cacheKey = CACHE_KEY_PREFIX + productId;
        redisTemplate.delete(cacheKey);

        return product;
    }
}
```

**장점:**
- 필요한 데이터만 캐싱 (메모리 효율적)
- 구현 간단
- 캐시 장애 시에도 DB 조회 가능

**단점:**
- Cache Miss 시 DB 부하 발생
- 데이터 불일치 가능 (TTL 내)

---

### 2.2 Write-Through

```
쓰기 시 캐시와 DB에 동시 저장:
1. 데이터 쓰기 요청
2. 캐시 업데이트
3. DB 업데이트
4. 완료

┌──────────────────────────────────────┐
│ 1. Write Request                      │
│    ↓                                  │
│ 2. Redis SET (Cache Update)           │
│    ↓                                  │
│ 3. DB INSERT/UPDATE                   │
│    ↓                                  │
│ 4. Return Success                     │
└──────────────────────────────────────┘
```

**구현:**

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final RedisTemplate<String, Product> redisTemplate;

    @Transactional
    public Product createProduct(ProductCreateRequest request) {
        // 1. DB 저장
        Product product = Product.from(request);
        Product savedProduct = productRepository.save(product);

        // 2. 캐시 저장 (동시)
        String cacheKey = CACHE_KEY_PREFIX + savedProduct.getId();
        redisTemplate.opsForValue().set(cacheKey, savedProduct, CACHE_TTL);

        return savedProduct;
    }

    @Transactional
    public Product updateProduct(Long productId, ProductUpdateRequest request) {
        // 1. DB 업데이트
        Product product = productRepository.findById(productId).orElseThrow();
        product.update(request);
        Product updatedProduct = productRepository.save(product);

        // 2. 캐시 업데이트 (동시)
        String cacheKey = CACHE_KEY_PREFIX + productId;
        redisTemplate.opsForValue().set(cacheKey, updatedProduct, CACHE_TTL);

        return updatedProduct;
    }
}
```

**장점:**
- 항상 최신 데이터 유지
- 읽기 성능 일정 (항상 캐시에 있음)

**단점:**
- 쓰기 성능 저하 (캐시 + DB 두 번)
- 쓰지 않는 데이터도 캐싱 (메모리 낭비)

---

### 2.3 Write-Behind (Write-Back)

```
캐시에 먼저 쓰고, 비동기로 DB 반영:
1. 캐시 업데이트
2. 즉시 응답
3. 백그라운드에서 DB 업데이트

┌──────────────────────────────────────┐
│ 1. Write Request                      │
│    ↓                                  │
│ 2. Redis SET (Cache Update)           │
│    ↓                                  │
│ 3. Return Success (즉시)              │
│                                       │
│ (비동기)                               │
│ 4. DB INSERT/UPDATE (백그라운드)       │
└──────────────────────────────────────┘
```

**구현:**

```java
@Service
@RequiredArgsConstructor
public class ViewCountService {

    private final RedisTemplate<String, String> redisTemplate;
    private final PostRepository postRepository;

    private static final String VIEW_COUNT_KEY = "post:view:";

    // 조회수 증가 (캐시만)
    public void incrementViewCount(Long postId) {
        String key = VIEW_COUNT_KEY + postId;
        redisTemplate.opsForValue().increment(key);
        // 즉시 반환 (빠름!)
    }

    // 스케줄러로 주기적 DB 동기화
    @Scheduled(fixedDelay = 60000)  // 1분마다
    public void syncViewCountsToDB() {
        Set<String> keys = redisTemplate.keys(VIEW_COUNT_KEY + "*");

        if (keys == null || keys.isEmpty()) {
            return;
        }

        for (String key : keys) {
            Long postId = extractPostId(key);
            String viewCountStr = redisTemplate.opsForValue().get(key);

            if (viewCountStr != null) {
                int viewCount = Integer.parseInt(viewCountStr);

                // DB 업데이트
                postRepository.updateViewCount(postId, viewCount);

                // 캐시 삭제 (동기화 완료)
                redisTemplate.delete(key);
            }
        }

        log.info("View counts synchronized to DB");
    }

    private Long extractPostId(String key) {
        return Long.parseLong(key.replace(VIEW_COUNT_KEY, ""));
    }
}
```

**장점:**
- 쓰기 성능 매우 빠름 (캐시만)
- DB 부하 감소 (배치 처리)

**단점:**
- 데이터 유실 위험 (캐시 장애 시)
- 구현 복잡 (동기화 로직)

---

### 2.4 Refresh-Ahead

```
만료 전에 미리 갱신:
1. 캐시 조회
2. TTL 확인
3. TTL 임박 시 백그라운드 갱신

┌──────────────────────────────────────┐
│ 1. Read Request                       │
│    ↓                                  │
│ 2. Redis GET                          │
│    ├─ TTL > 50% → Return Cache        │
│    └─ TTL < 50%                       │
│       ↓                               │
│ 3. Return Cache (즉시)                │
│    (비동기)                            │
│ 4. DB SELECT & Cache Refresh          │
└──────────────────────────────────────┘
```

**구현:**

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final RedisTemplate<String, Product> redisTemplate;
    private final ExecutorService executorService = Executors.newFixedThreadPool(10);

    private static final Duration CACHE_TTL = Duration.ofMinutes(10);
    private static final double REFRESH_THRESHOLD = 0.5;  // 50%

    public Product getProduct(Long productId) {
        String cacheKey = CACHE_KEY_PREFIX + productId;

        // 1. 캐시 조회
        Product cachedProduct = redisTemplate.opsForValue().get(cacheKey);

        if (cachedProduct != null) {
            // 2. TTL 확인
            Long ttl = redisTemplate.getExpire(cacheKey, TimeUnit.SECONDS);

            if (ttl != null && ttl < CACHE_TTL.getSeconds() * REFRESH_THRESHOLD) {
                // 3. TTL 임박 → 비동기 갱신
                executorService.submit(() -> refreshCache(productId));
            }

            return cachedProduct;
        }

        // Cache Miss → 동기 조회
        return loadFromDB(productId);
    }

    private void refreshCache(Long productId) {
        log.info("Refreshing cache for product: {}", productId);
        Product product = loadFromDB(productId);

        String cacheKey = CACHE_KEY_PREFIX + productId;
        redisTemplate.opsForValue().set(cacheKey, product, CACHE_TTL);
    }

    private Product loadFromDB(Long productId) {
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));

        String cacheKey = CACHE_KEY_PREFIX + productId;
        redisTemplate.opsForValue().set(cacheKey, product, CACHE_TTL);

        return product;
    }
}
```

**장점:**
- Cache Miss 최소화
- 항상 빠른 응답 시간

**단점:**
- 예측 가능한 접근 패턴에만 유효
- 불필요한 갱신 가능

---

## 3. 캐시 무효화 전략

### 3.1 TTL 기반 만료

```java
// 고정 TTL
redisTemplate.opsForValue().set(key, value, Duration.ofHours(1));

// 비즈니스 로직 기반 TTL
public Duration calculateTTL(Product product) {
    if (product.isHotItem()) {
        return Duration.ofHours(24);  // 인기 상품: 24시간
    } else if (product.isNewArrival()) {
        return Duration.ofHours(6);   // 신상품: 6시간
    } else {
        return Duration.ofHours(1);   // 일반 상품: 1시간
    }
}

// 랜덤 TTL (Cache Stampede 방지)
public Duration randomizedTTL(Duration baseTTL) {
    long baseSeconds = baseTTL.getSeconds();
    long jitter = (long) (baseSeconds * 0.1 * Math.random());  // ±10%
    return Duration.ofSeconds(baseSeconds + jitter);
}
```

### 3.2 이벤트 기반 무효화

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final RedisTemplate<String, Product> redisTemplate;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    public Product updateProduct(Long productId, ProductUpdateRequest request) {
        Product product = productRepository.findById(productId).orElseThrow();
        product.update(request);
        Product updatedProduct = productRepository.save(product);

        // 이벤트 발행
        eventPublisher.publishEvent(new ProductUpdatedEvent(productId));

        return updatedProduct;
    }
}

@Component
@RequiredArgsConstructor
public class CacheInvalidationListener {

    private final RedisTemplate<String, Product> redisTemplate;

    @EventListener
    public void handleProductUpdated(ProductUpdatedEvent event) {
        Long productId = event.getProductId();

        // 1. 상품 캐시 삭제
        redisTemplate.delete("product:" + productId);

        // 2. 관련 캐시 삭제
        redisTemplate.delete("product:" + productId + ":reviews");
        redisTemplate.delete("product:" + productId + ":related");

        log.info("Cache invalidated for product: {}", productId);
    }
}
```

### 3.3 패턴 기반 일괄 삭제

```java
// 패턴 매칭으로 여러 키 삭제
public void invalidateCacheByPattern(String pattern) {
    Set<String> keys = redisTemplate.keys(pattern);

    if (keys != null && !keys.isEmpty()) {
        redisTemplate.delete(keys);
        log.info("Deleted {} cache keys matching pattern: {}", keys.size(), pattern);
    }
}

// 사용 예시:
// 특정 사용자의 모든 캐시 삭제
invalidateCacheByPattern("user:123:*");

// 특정 카테고리의 모든 상품 캐시 삭제
invalidateCacheByPattern("product:category:electronics:*");
```

**주의사항:**
- `KEYS` 명령은 블로킹 (프로덕션에서 사용 금지)
- 대신 `SCAN` 사용 (논블로킹)

```java
public void invalidateCacheByScan(String pattern) {
    ScanOptions options = ScanOptions.scanOptions()
        .match(pattern)
        .count(100)
        .build();

    try (Cursor<byte[]> cursor = redisTemplate.getConnectionFactory()
        .getConnection()
        .scan(options)) {

        List<String> keysToDelete = new ArrayList<>();

        while (cursor.hasNext()) {
            keysToDelete.add(new String(cursor.next()));

            if (keysToDelete.size() >= 100) {
                redisTemplate.delete(keysToDelete);
                keysToDelete.clear();
            }
        }

        if (!keysToDelete.isEmpty()) {
            redisTemplate.delete(keysToDelete);
        }
    }
}
```

---

## 4. 실전 문제 해결

### 4.1 Cache Stampede (캐시 스탬피드)

```
문제:
- 인기 데이터의 캐시가 만료
- 동시에 수천 개 요청 발생
- 모두 DB 조회 → DB 과부하

시나리오:
T=0: 캐시 만료
T=1: 1000개 요청 동시 도착
     → 모두 Cache Miss
     → 1000개 DB 쿼리 동시 실행
     → DB 다운!

해결책 1: Lock 기반
```

```java
@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final RedisTemplate<String, Product> redisTemplate;
    private final RedissonClient redissonClient;

    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        String lockKey = "lock:product:" + productId;

        // 1. 캐시 조회
        Product cachedProduct = redisTemplate.opsForValue().get(cacheKey);
        if (cachedProduct != null) {
            return cachedProduct;
        }

        // 2. Lock 획득 시도
        RLock lock = redissonClient.getLock(lockKey);

        try {
            // 3. Lock 획득 (최대 3초 대기, 10초 후 자동 해제)
            boolean acquired = lock.tryLock(3, 10, TimeUnit.SECONDS);

            if (acquired) {
                try {
                    // Double Check (Lock 대기 중 다른 스레드가 캐시 생성했을 수 있음)
                    cachedProduct = redisTemplate.opsForValue().get(cacheKey);
                    if (cachedProduct != null) {
                        return cachedProduct;
                    }

                    // DB 조회 (1개 스레드만)
                    Product product = productRepository.findById(productId)
                        .orElseThrow(() -> new ProductNotFoundException(productId));

                    // 캐시 저장
                    redisTemplate.opsForValue().set(cacheKey, product, Duration.ofHours(1));

                    return product;
                } finally {
                    lock.unlock();
                }
            } else {
                // Lock 획득 실패 → 잠시 대기 후 재시도
                Thread.sleep(100);
                return getProduct(productId);  // 재귀 호출
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Lock 획득 중 인터럽트", e);
        }
    }
}
```

**해결책 2: 확률적 조기 갱신 (Probabilistic Early Expiration)**

```java
public Product getProduct(Long productId) {
    String cacheKey = "product:" + productId;

    Product cachedProduct = redisTemplate.opsForValue().get(cacheKey);

    if (cachedProduct != null) {
        Long ttl = redisTemplate.getExpire(cacheKey, TimeUnit.SECONDS);

        if (ttl != null && shouldRefresh(ttl)) {
            // 확률적으로 갱신
            CompletableFuture.runAsync(() -> refreshCache(productId));
        }

        return cachedProduct;
    }

    // Cache Miss
    return loadFromDB(productId);
}

private boolean shouldRefresh(long ttl) {
    // TTL이 짧을수록 갱신 확률 높음
    double probability = 1.0 - (double) ttl / CACHE_TTL.getSeconds();
    return Math.random() < probability;
}
```

### 4.2 Cache Penetration (캐시 관통)

```
문제:
- 존재하지 않는 데이터 조회
- 캐시에 없음 → DB 조회
- DB에도 없음 → 계속 반복
- 악의적 공격 가능

해결책 1: Null 캐싱
```

```java
public Product getProduct(Long productId) {
    String cacheKey = "product:" + productId;

    // 1. 캐시 조회
    String cached = (String) redisTemplate.opsForValue().get(cacheKey);

    if (cached != null) {
        if ("NULL".equals(cached)) {
            throw new ProductNotFoundException(productId);  // Null 캐시
        }
        return deserialize(cached);
    }

    // 2. DB 조회
    Optional<Product> productOpt = productRepository.findById(productId);

    if (productOpt.isPresent()) {
        Product product = productOpt.get();
        redisTemplate.opsForValue().set(cacheKey, serialize(product), Duration.ofHours(1));
        return product;
    } else {
        // 3. Null 캐싱 (짧은 TTL)
        redisTemplate.opsForValue().set(cacheKey, "NULL", Duration.ofMinutes(5));
        throw new ProductNotFoundException(productId);
    }
}
```

**해결책 2: Bloom Filter**

```java
@Component
public class ProductBloomFilter {

    private final BloomFilter<Long> bloomFilter;

    public ProductBloomFilter() {
        // 예상 항목 수: 1,000,000, 오류율: 0.01%
        this.bloomFilter = BloomFilter.create(
            Funnels.longFunnel(),
            1_000_000,
            0.0001
        );
    }

    // 초기화 시 모든 상품 ID 추가
    @PostConstruct
    public void init() {
        List<Long> productIds = productRepository.findAllIds();
        productIds.forEach(bloomFilter::put);
    }

    public boolean mightExist(Long productId) {
        return bloomFilter.mightContain(productId);
    }

    public void add(Long productId) {
        bloomFilter.put(productId);
    }
}

@Service
public class ProductService {

    public Product getProduct(Long productId) {
        // 1. Bloom Filter 체크
        if (!bloomFilter.mightExist(productId)) {
            throw new ProductNotFoundException(productId);  // 확실히 없음
        }

        // 2. 캐시 조회
        // 3. DB 조회
        // ...
    }
}
```

### 4.3 Hot Key 문제

```
문제:
- 특정 키에 트래픽 집중
- 단일 Redis 인스턴스 과부하

해결책: Local Cache + Redis (2-Level Cache)
```

```java
@Configuration
public class CacheConfig {

    @Bean
    public Cache<String, Product> localCache() {
        return Caffeine.newBuilder()
            .maximumSize(10_000)  // 최대 10,000개
            .expireAfterWrite(Duration.ofMinutes(5))  // L1: 5분
            .recordStats()
            .build();
    }
}

@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final RedisTemplate<String, Product> redisTemplate;
    private final Cache<String, Product> localCache;

    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;

        // 1. L1 캐시 (Local - Caffeine)
        Product cachedProduct = localCache.getIfPresent(cacheKey);
        if (cachedProduct != null) {
            log.debug("L1 Cache Hit: {}", cacheKey);
            return cachedProduct;
        }

        // 2. L2 캐시 (Redis)
        cachedProduct = redisTemplate.opsForValue().get(cacheKey);
        if (cachedProduct != null) {
            log.debug("L2 Cache Hit: {}", cacheKey);
            localCache.put(cacheKey, cachedProduct);  // L1에도 저장
            return cachedProduct;
        }

        // 3. DB 조회
        log.debug("Cache Miss: {}", cacheKey);
        Product product = productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));

        // L1 & L2에 저장
        localCache.put(cacheKey, product);
        redisTemplate.opsForValue().set(cacheKey, product, Duration.ofHours(1));

        return product;
    }

    // 캐시 무효화 시 L1, L2 모두 삭제
    public void invalidateCache(Long productId) {
        String cacheKey = "product:" + productId;
        localCache.invalidate(cacheKey);
        redisTemplate.delete(cacheKey);
    }
}
```

**성능 비교:**

| 계층 | 응답 시간 | 처리량 |
|------|----------|--------|
| L1 (Local) | <0.1ms | 1,000,000+ ops/sec |
| L2 (Redis) | <1ms | 100,000+ ops/sec |
| DB (MySQL) | 10~100ms | 1,000~10,000 ops/sec |

---

## 5. Spring Cache Abstraction

### 5.1 @Cacheable 사용

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofHours(1))  // 기본 TTL
            .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(
                new StringRedisSerializer()
            ))
            .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(
                new GenericJackson2JsonRedisSerializer()
            ));

        // 캐시별 TTL 설정
        Map<String, RedisCacheConfiguration> cacheConfigurations = new HashMap<>();
        cacheConfigurations.put("products",
            config.entryTtl(Duration.ofHours(24)));
        cacheConfigurations.put("users",
            config.entryTtl(Duration.ofMinutes(30)));

        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(config)
            .withInitialCacheConfigurations(cacheConfigurations)
            .build();
    }
}
```

```java
@Service
public class ProductService {

    // 캐시 조회 (Cache-Aside)
    @Cacheable(value = "products", key = "#productId")
    public Product getProduct(Long productId) {
        // Cache Miss 시에만 실행됨
        return productRepository.findById(productId)
            .orElseThrow(() -> new ProductNotFoundException(productId));
    }

    // 캐시 업데이트 (Write-Through)
    @CachePut(value = "products", key = "#result.id")
    public Product updateProduct(Long productId, ProductUpdateRequest request) {
        Product product = productRepository.findById(productId).orElseThrow();
        product.update(request);
        return productRepository.save(product);
        // 반환값이 캐시에 저장됨
    }

    // 캐시 삭제
    @CacheEvict(value = "products", key = "#productId")
    public void deleteProduct(Long productId) {
        productRepository.deleteById(productId);
    }

    // 여러 캐시 삭제
    @CacheEvict(value = "products", allEntries = true)
    public void deleteAllProducts() {
        productRepository.deleteAll();
    }

    // 조건부 캐싱
    @Cacheable(value = "products", key = "#productId", condition = "#productId > 100")
    public Product getProductConditional(Long productId) {
        // productId > 100일 때만 캐싱
        return productRepository.findById(productId).orElseThrow();
    }

    // SpEL 활용
    @Cacheable(value = "products",
               key = "#productId",
               unless = "#result == null || #result.price < 1000")
    public Product getExpensiveProduct(Long productId) {
        // 가격이 1000 이상인 상품만 캐싱
        return productRepository.findById(productId).orElseThrow();
    }
}
```

### 5.2 커스텀 키 생성

```java
@Component
public class CustomKeyGenerator implements KeyGenerator {

    @Override
    public Object generate(Object target, Method method, Object... params) {
        // 클래스명:메서드명:파라미터
        StringBuilder sb = new StringBuilder();
        sb.append(target.getClass().getSimpleName());
        sb.append(":");
        sb.append(method.getName());
        sb.append(":");

        for (Object param : params) {
            if (param != null) {
                sb.append(param.toString());
                sb.append(":");
            }
        }

        return sb.toString();
    }
}

// 사용
@Cacheable(value = "products", keyGenerator = "customKeyGenerator")
public Product getProduct(Long productId) {
    // 키: ProductService:getProduct:123:
    return productRepository.findById(productId).orElseThrow();
}
```

---

## 6. 성능 모니터링

### 6.1 Cache Hit Rate 측정

```java
@Component
@RequiredArgsConstructor
public class CacheMetricsService {

    private final MeterRegistry meterRegistry;

    public void recordCacheHit(String cacheName) {
        meterRegistry.counter("cache.hit", "cache", cacheName).increment();
    }

    public void recordCacheMiss(String cacheName) {
        meterRegistry.counter("cache.miss", "cache", cacheName).increment();
    }

    public double getHitRate(String cacheName) {
        double hits = getCount("cache.hit", cacheName);
        double misses = getCount("cache.miss", cacheName);

        if (hits + misses == 0) {
            return 0.0;
        }

        return hits / (hits + misses);
    }

    private double getCount(String metricName, String cacheName) {
        Counter counter = meterRegistry.find(metricName)
            .tag("cache", cacheName)
            .counter();

        return counter != null ? counter.count() : 0.0;
    }
}

@Service
public class ProductService {

    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;

        Product cachedProduct = redisTemplate.opsForValue().get(cacheKey);

        if (cachedProduct != null) {
            cacheMetricsService.recordCacheHit("products");
            return cachedProduct;
        }

        cacheMetricsService.recordCacheMiss("products");

        Product product = productRepository.findById(productId).orElseThrow();
        redisTemplate.opsForValue().set(cacheKey, product, Duration.ofHours(1));

        return product;
    }
}
```

### 6.2 Redis 모니터링

```bash
# Redis CLI
redis-cli

# 통계 조회
INFO stats

# 출력:
total_commands_processed:1234567
instantaneous_ops_per_sec:567
keyspace_hits:890123
keyspace_misses:123456
evicted_keys:0
expired_keys:45678

# Hit Rate 계산:
# keyspace_hits / (keyspace_hits + keyspace_misses) * 100
# = 890123 / (890123 + 123456) * 100 = 87.8%

# 메모리 사용량
INFO memory

# 느린 쿼리 로그
SLOWLOG GET 10
```

```yaml
# Prometheus + Grafana 연동
management:
  endpoints:
    web:
      exposure:
        include: prometheus,health,metrics
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: my-app
```

---

## 체크리스트

Redis 캐싱을 제대로 이해했는지 확인해보세요:

**기초:**
- [ ] Redis 자료구조 5가지를 설명할 수 있다
- [ ] 인메모리 DB의 장단점을 안다
- [ ] TTL과 영속성(RDB/AOF)의 차이를 이해한다

**캐싱 전략:**
- [ ] Cache-Aside 패턴을 구현할 수 있다
- [ ] Write-Through와 Write-Behind의 차이를 안다
- [ ] 비즈니스 요구사항에 맞는 전략을 선택할 수 있다

**문제 해결:**
- [ ] Cache Stampede를 Lock으로 해결할 수 있다
- [ ] Cache Penetration을 Null 캐싱/Bloom Filter로 방지할 수 있다
- [ ] Hot Key 문제를 2-Level Cache로 해결할 수 있다

**Spring 통합:**
- [ ] @Cacheable, @CachePut, @CacheEvict을 사용할 수 있다
- [ ] 커스텀 키 생성 전략을 구현할 수 있다
- [ ] RedisCacheManager 설정을 할 수 있다

**모니터링:**
- [ ] Cache Hit Rate을 측정하고 분석할 수 있다
- [ ] Redis INFO 명령으로 통계를 확인할 수 있다
- [ ] Prometheus/Grafana로 메트릭을 시각화할 수 있다

---

## 마무리

Redis 캐싱은 애플리케이션 성능을 극적으로 향상시킬 수 있는 핵심 기술입니다. Cache-Aside, Write-Through, Write-Behind 등 다양한 전략을 이해하고, Cache Stampede, Cache Penetration 같은 실전 문제를 해결할 수 있어야 합니다.

**핵심 요약:**
1. **자료구조** - String, Hash, List, Set, Sorted Set 활용
2. **캐싱 전략** - Cache-Aside (일반), Write-Through (일관성), Write-Behind (성능)
3. **문제 해결** - Stampede (Lock), Penetration (Bloom Filter), Hot Key (2-Level)
4. **Spring 통합** - @Cacheable, RedisCacheManager
5. **모니터링** - Hit Rate 측정, INFO stats 분석

**다음 단계:**
- 실전 프로젝트에 Redis 캐싱 적용
- 분산 캐시 전략 (Redis Cluster, Sentinel) 학습
- 대용량 트래픽 처리 경험 쌓기

*시리즈 3 "백엔드 심화 학습" 8개 포스트 완료! 다음 시리즈도 기대해주세요!* 🚀
