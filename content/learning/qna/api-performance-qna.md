---
title: "API 성능 문제 해결 정리"
date: 2025-01-10
topic: "Backend"
topic_icon: "💬"
topic_description: "Thread Dump, Slow Query, 캐싱, Connection Pool 관련 핵심 개념과 실전 예제 정리"
tags: ["Performance", "API", "Thread Dump", "Caching"]
categories: ["Backend"]
draft: false
module: "qna"
---

# API 성능 문제 해결 정리

## Q1. Thread Dump는 어떻게 분석하나요?

### 답변

**Thread Dump**는 **특정 시점의 모든 스레드 상태 스냅샷**으로, 성능 문제 진단에 핵심적입니다.

### Thread Dump 수집 방법

```bash
# 1. jstack 사용 (권장)
jstack <PID> > thread_dump.txt

# 2. kill 명령어 사용 (Unix/Linux)
kill -3 <PID>
# → catalina.out 또는 application.log에 출력됨

# 3. jcmd 사용 (JDK 7+)
jcmd <PID> Thread.print > thread_dump.txt

# 4. JVisualVM (GUI)
# Tools → Thread Dump
```

### Thread Dump 읽는 법

**Thread Dump 예시**:

```
"http-nio-8080-exec-10" #25 daemon prio=5 os_prio=0 tid=0x00007f8c4c001000 nid=0x1a2b waiting on condition [0x00007f8c2d5fe000]
   java.lang.Thread.State: WAITING (parking)
        at sun.misc.Unsafe.park(Native Method)
        - parking to wait for  <0x00000000e1234560> (a java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject)
        at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
        at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:2039)
        at org.apache.tomcat.util.threads.TaskQueue.take(TaskQueue.java:107)
        at org.apache.tomcat.util.threads.TaskQueue.take(TaskQueue.java:33)
```

**주요 정보**:
1. **스레드 이름**: `http-nio-8080-exec-10`
2. **스레드 ID**: `tid=0x00007f8c4c001000`
3. **스레드 상태**: `WAITING (parking)`
4. **Stack Trace**: 메서드 호출 순서

### Thread 상태 종류

| 상태 | 설명 | 원인 |
|------|------|------|
| RUNNABLE | 실행 중 또는 실행 가능 | 정상 |
| WAITING | 무한 대기 | wait(), park() |
| TIMED_WAITING | 시간 제한 대기 | sleep(), wait(timeout) |
| BLOCKED | 모니터 락 대기 | synchronized |
| TERMINATED | 종료됨 | 정상 |

### 문제 패턴 분석

**패턴 1: Deadlock (교착 상태)**:

```
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f8c4c002340 (object 0x00000000e1234560, a java.lang.Object),
  which is held by "Thread-2"
"Thread-2":
  waiting to lock monitor 0x00007f8c4c002450 (object 0x00000000e1234670, a java.lang.Object),
  which is held by "Thread-1"

Java stack information for the threads listed above:
===================================================
"Thread-1":
        at com.example.Service.methodA(Service.java:10)
        - waiting to lock <0x00000000e1234560> (a java.lang.Object)
        - locked <0x00000000e1234670> (a java.lang.Object)

"Thread-2":
        at com.example.Service.methodB(Service.java:20)
        - waiting to lock <0x00000000e1234670> (a java.lang.Object)
        - locked <0x00000000e1234560> (a java.lang.Object)
```

**원인 코드**:

```java
// ❌ Deadlock 발생 코드
public class DeadlockExample {
    private final Object lock1 = new Object();
    private final Object lock2 = new Object();

    public void methodA() {
        synchronized (lock1) {          // Thread-1: lock1 획득
            Thread.sleep(100);
            synchronized (lock2) {      // Thread-1: lock2 대기 (Thread-2가 보유)
                // 작업
            }
        }
    }

    public void methodB() {
        synchronized (lock2) {          // Thread-2: lock2 획득
            Thread.sleep(100);
            synchronized (lock1) {      // Thread-2: lock1 대기 (Thread-1이 보유)
                // 작업
            }
        }
    }
}

// ✅ 해결: 락 순서 통일
public void methodA() {
    synchronized (lock1) {
        synchronized (lock2) {
            // 작업
        }
    }
}

public void methodB() {
    synchronized (lock1) {      // lock1 먼저 획득
        synchronized (lock2) {  // lock2 나중에 획득
            // 작업
        }
    }
}
```

**패턴 2: Thread Pool Exhaustion (스레드 고갈)**:

```
"http-nio-8080-exec-1" WAITING
"http-nio-8080-exec-2" WAITING
"http-nio-8080-exec-3" WAITING
...
"http-nio-8080-exec-200" WAITING  (모든 스레드가 WAITING!)

at java.net.SocketInputStream.socketRead0(Native Method)
at java.net.SocketInputStream.socketRead(SocketInputStream.java:116)
at java.net.SocketInputStream.read(SocketInputStream.java:171)
```

**원인**: 모든 스레드가 외부 API 응답 대기 중 → 새 요청 처리 불가

**해결**:

```java
// ❌ 동기 호출 (스레드 블로킹)
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) {
    // 외부 API 호출 (5초 소요)
    // → 스레드가 5초간 블로킹됨
    return restTemplate.getForObject("https://api.example.com/users/" + id, User.class);
}

// ✅ 비동기 호출 (스레드 해제)
@GetMapping("/users/{id}")
public CompletableFuture<User> getUser(@PathVariable Long id) {
    return CompletableFuture.supplyAsync(() ->
        restTemplate.getForObject("https://api.example.com/users/" + id, User.class),
        asyncExecutor
    );
}

// ✅ Timeout 설정
@Bean
public RestTemplate restTemplate() {
    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(3000);  // 연결 타임아웃: 3초
    factory.setReadTimeout(5000);     // 읽기 타임아웃: 5초
    return new RestTemplate(factory);
}
```

**패턴 3: CPU 스파이크 (무한 루프)**:

```
"worker-thread-1" RUNNABLE
at com.example.Service.process(Service.java:50)  (반복)
at com.example.Service.process(Service.java:50)
at com.example.Service.process(Service.java:50)
```

**원인**: 특정 메서드가 무한 루프

```java
// ❌ 무한 루프
public void process(List<Item> items) {
    int i = 0;
    while (i < items.size()) {
        process(items.get(i));
        // i++; 누락! → 무한 루프
    }
}

// ✅ 수정
public void process(List<Item> items) {
    for (Item item : items) {
        process(item);
    }
}
```

### 꼬리 질문: Thread Dump를 여러 번 수집하는 이유는?

**1번만 수집**: 특정 시점의 스냅샷 → 패턴 파악 어려움

**3~5번 수집 (10초 간격)**: 시간에 따른 변화 추적 → 패턴 명확

```bash
# 10초 간격으로 3번 수집
jstack <PID> > thread_dump_1.txt
sleep 10
jstack <PID> > thread_dump_2.txt
sleep 10
jstack <PID> > thread_dump_3.txt

# 분석:
# Dump 1: Thread A는 methodA() 실행 중
# Dump 2: Thread A는 여전히 methodA() 실행 중 (동일한 줄)
# Dump 3: Thread A는 여전히 methodA() 실행 중 (동일한 줄)
# → Thread A가 methodA()에서 멈춰 있음! (무한 루프 또는 Deadlock)
```

---

## Q2. Slow Query는 어떻게 찾고 최적화하나요?

### 답변

**Slow Query**는 **실행 시간이 오래 걸리는 SQL**로, API 성능 저하의 주요 원인입니다.

### Slow Query 로그 활성화

**MySQL**:

```sql
-- Slow Query Log 활성화
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- 1초 이상 쿼리 기록
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow-query.log';

-- 확인
SHOW VARIABLES LIKE 'slow_query%';
```

**PostgreSQL**:

```sql
-- postgresql.conf 설정
log_min_duration_statement = 1000  -- 1000ms (1초)

-- 또는 세션별 설정
SET log_min_duration_statement = 1000;
```

### Slow Query 분석

**Slow Query Log 예시**:

```
# Time: 2025-01-26T10:30:45.123456Z
# User@Host: app_user[app_user] @ localhost []
# Query_time: 5.234567  Lock_time: 0.000123 Rows_sent: 1000  Rows_examined: 1000000
SET timestamp=1706265045;
SELECT u.*, o.total
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at >= '2024-01-01';
```

**주요 지표**:
- **Query_time**: 5.23초 (매우 느림!)
- **Rows_examined**: 100만 건 (전체 스캔)
- **Rows_sent**: 1,000건 (결과)

### 최적화 과정

**1단계: EXPLAIN으로 실행 계획 확인**:

```sql
EXPLAIN SELECT u.*, o.total
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at >= '2024-01-01';
```

**출력**:

```
+----+-------------+-------+------+---------------+------+---------+------+---------+-------------+
| id | select_type | table | type | possible_keys | key  | key_len | ref  | rows    | Extra       |
+----+-------------+-------+------+---------------+------+---------+------+---------+-------------+
|  1 | SIMPLE      | u     | ALL  | NULL          | NULL | NULL    | NULL | 1000000 | Using where |
|  1 | SIMPLE      | o     | ALL  | NULL          | NULL | NULL    | NULL | 5000000 | Using where |
+----+-------------+-------+------+---------------+------+---------+------+---------+-------------+
```

**문제점**:
- `type: ALL` → Full Table Scan (인덱스 미사용)
- `rows: 1000000` → 100만 건 스캔

**2단계: 인덱스 추가**:

```sql
-- ✅ created_at에 인덱스 추가
CREATE INDEX idx_users_created_at ON users(created_at);

-- ✅ JOIN에 사용되는 컬럼에 인덱스 추가
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

**3단계: 개선 후 EXPLAIN**:

```
+----+-------------+-------+-------+--------------------+----------------------+---------+-------+------+-------------+
| id | select_type | table | type  | possible_keys      | key                  | key_len | ref   | rows | Extra       |
+----+-------------+-------+-------+--------------------+----------------------+---------+-------+------+-------------+
|  1 | SIMPLE      | u     | range | idx_users_created  | idx_users_created    | 4       | NULL  | 5000 | Using index |
|  1 | SIMPLE      | o     | ref   | idx_orders_user_id | idx_orders_user_id   | 4       | u.id  | 5    | NULL        |
+----+-------------+-------+-------+--------------------+----------------------+---------+-------+------+-------------+
```

**개선 결과**:
- `type: range` → 인덱스 범위 스캔
- `rows: 5000` → 5,000건만 스캔 (200배 감소)
- **Query_time: 5.2초 → 0.05초 (100배 빠름)**

### N+1 쿼리 문제

**문제 상황**:

```java
// ❌ N+1 문제 발생
@GetMapping("/users")
public List<UserResponse> getUsers() {
    List<User> users = userRepository.findAll();  // 1번 쿼리

    return users.stream()
        .map(user -> {
            List<Order> orders = orderRepository.findByUserId(user.getId());  // N번 쿼리
            return new UserResponse(user, orders);
        })
        .collect(Collectors.toList());
}

// 실행되는 쿼리:
// SELECT * FROM users;  (100명)
// SELECT * FROM orders WHERE user_id = 1;
// SELECT * FROM orders WHERE user_id = 2;
// ...
// SELECT * FROM orders WHERE user_id = 100;
// → 총 101번 쿼리!
```

**해결 1: JOIN FETCH (JPA)**:

```java
// ✅ JOIN FETCH로 해결
@Query("SELECT u FROM User u LEFT JOIN FETCH u.orders")
List<User> findAllWithOrders();

@GetMapping("/users")
public List<UserResponse> getUsers() {
    List<User> users = userRepository.findAllWithOrders();  // 1번 쿼리

    return users.stream()
        .map(user -> new UserResponse(user, user.getOrders()))
        .collect(Collectors.toList());
}

// 실행되는 쿼리:
// SELECT u.*, o.*
// FROM users u
// LEFT JOIN orders o ON u.id = o.user_id;
// → 총 1번 쿼리!
```

**해결 2: Batch Fetch**:

```java
// ✅ Batch Size 설정
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @BatchSize(size = 100)
    private List<Order> orders;
}

// 실행되는 쿼리:
// SELECT * FROM users;  (100명)
// SELECT * FROM orders WHERE user_id IN (1, 2, 3, ..., 100);
// → 총 2번 쿼리!
```

### 꼬리 질문: Query 최적화 우선순위는?

**최적화 우선순위**:

```
1. 인덱스 추가 (가장 효과적)
   → Full Scan → Index Scan

2. N+1 쿼리 제거 (두 번째)
   → 101번 → 1~2번 쿼리

3. 쿼리 재작성 (세 번째)
   → Subquery → JOIN
   → SELECT * → SELECT 필요한 컬럼만

4. 파티셔닝 (네 번째)
   → 대용량 테이블 분할

5. 캐싱 (다섯 번째)
   → 자주 조회되는 데이터 캐싱
```

**효과 비교**:

| 최적화 | Before | After | 개선율 |
|--------|--------|-------|--------|
| 인덱스 추가 | 5초 | 0.05초 | 100배 |
| N+1 제거 | 10초 | 0.1초 | 100배 |
| SELECT * → 필요한 컬럼 | 1초 | 0.8초 | 1.25배 |
| 캐싱 | 0.1초 | 0.01초 | 10배 |

---

## Q3. 캐싱 전략은 어떻게 구성하나요?

### 답변

**캐싱**은 **자주 사용되는 데이터를 메모리에 저장**하여 DB 부하를 줄입니다.

### 캐싱 레벨

**1. Application Cache (로컬 캐시)**:

```java
// ✅ Spring Cache (Caffeine)
@Configuration
@EnableCaching
public class CacheConfig {
    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager("users", "products");
        cacheManager.setCaffeine(Caffeine.newBuilder()
            .expireAfterWrite(10, TimeUnit.MINUTES)
            .maximumSize(1000));
        return cacheManager;
    }
}

// 사용
@Service
public class UserService {
    @Cacheable(value = "users", key = "#id")
    public User findById(Long id) {
        // DB 조회 (캐시 미스 시에만 실행)
        return userRepository.findById(id).orElseThrow();
    }

    @CacheEvict(value = "users", key = "#user.id")
    public void update(User user) {
        userRepository.save(user);
        // 캐시 무효화
    }
}
```

**2. Distributed Cache (분산 캐시)**:

```java
// ✅ Redis Cache
@Configuration
public class RedisCacheConfig {
    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer()
                )
            );

        return RedisCacheManager.builder(connectionFactory)
            .cacheDefaults(config)
            .build();
    }
}

// 사용
@Cacheable(value = "users", key = "#id")
public User findById(Long id) {
    // Redis에서 먼저 조회
    // 없으면 DB 조회 후 Redis에 저장
    return userRepository.findById(id).orElseThrow();
}
```

### 캐시 무효화 전략

**1. Time-based Expiration (시간 기반)**:

```java
// ✅ TTL 설정
@Cacheable(value = "products", key = "#id")
public Product findById(Long id) {
    return productRepository.findById(id).orElseThrow();
}

// Redis에서:
// SET products:123 {...} EX 600  (10분 후 자동 삭제)
```

**2. Event-based Invalidation (이벤트 기반)**:

```java
// ✅ 업데이트 시 캐시 무효화
@Service
public class ProductService {
    @Cacheable(value = "products", key = "#id")
    public Product findById(Long id) {
        return productRepository.findById(id).orElseThrow();
    }

    @CachePut(value = "products", key = "#product.id")
    public Product update(Product product) {
        return productRepository.save(product);
        // 캐시 갱신
    }

    @CacheEvict(value = "products", key = "#id")
    public void delete(Long id) {
        productRepository.deleteById(id);
        // 캐시 삭제
    }
}
```

**3. Cache-Aside Pattern**:

```java
// ✅ Cache-Aside (수동 제어)
@Service
public class UserService {
    @Autowired
    private RedisTemplate<String, User> redisTemplate;

    public User findById(Long id) {
        String key = "user:" + id;

        // 1. 캐시 조회
        User user = redisTemplate.opsForValue().get(key);

        if (user == null) {
            // 2. 캐시 미스 → DB 조회
            user = userRepository.findById(id).orElseThrow();

            // 3. 캐시 저장
            redisTemplate.opsForValue().set(key, user, 10, TimeUnit.MINUTES);
        }

        return user;
    }

    public void update(User user) {
        // 1. DB 업데이트
        userRepository.save(user);

        // 2. 캐시 무효화
        String key = "user:" + user.getId();
        redisTemplate.delete(key);
    }
}
```

### Cache Stampede 문제

**문제**: 캐시 만료 시 동시 요청으로 DB 부하 증가

```
Time: 10:00:00, Cache Expired
↓
Request 1 → Cache Miss → DB Query (5초)
Request 2 → Cache Miss → DB Query (5초)
Request 3 → Cache Miss → DB Query (5초)
...
Request 100 → Cache Miss → DB Query (5초)
→ DB에 100개 동일 쿼리 (부하!)
```

**해결: Lock 사용**:

```java
// ✅ Redisson Lock
@Service
public class UserService {
    @Autowired
    private RedissonClient redissonClient;

    public User findById(Long id) {
        String key = "user:" + id;

        // 1. 캐시 조회
        User user = redisTemplate.opsForValue().get(key);

        if (user == null) {
            // 2. Lock 획득
            RLock lock = redissonClient.getLock("lock:user:" + id);

            try {
                lock.lock(3, TimeUnit.SECONDS);

                // 3. Double-check (다른 스레드가 이미 캐시 저장했을 수 있음)
                user = redisTemplate.opsForValue().get(key);

                if (user == null) {
                    // 4. DB 조회
                    user = userRepository.findById(id).orElseThrow();

                    // 5. 캐시 저장
                    redisTemplate.opsForValue().set(key, user, 10, TimeUnit.MINUTES);
                }
            } finally {
                lock.unlock();
            }
        }

        return user;
    }
}

// 동작:
// Request 1 → Lock 획득 → DB 조회 → 캐시 저장 → Lock 해제
// Request 2-100 → Lock 대기 → 캐시 조회 (Request 1이 저장한 데이터)
// → DB 쿼리 1번만 실행! ✅
```

### 꼬리 질문: 로컬 캐시 vs Redis 캐시?

**비교표**:

| 특징 | 로컬 캐시 (Caffeine) | Redis |
|------|----------------------|-------|
| 속도 | 매우 빠름 (ns) | 빠름 (ms) |
| 용량 | 제한적 (힙 메모리) | 큼 (RAM) |
| 공유 | 불가능 (단일 서버) | 가능 (여러 서버) |
| 장애 | 서버 재시작 시 손실 | 영속성 가능 |
| 적합 | 읽기 전용, 작은 데이터 | 대용량, 분산 환경 |

**사용 예시**:

```java
// ✅ 2-Level Cache (로컬 + Redis)
@Service
public class ProductService {
    private final LoadingCache<Long, Product> localCache = Caffeine.newBuilder()
        .maximumSize(100)
        .expireAfterWrite(1, TimeUnit.MINUTES)
        .build(id -> findFromRedisOrDb(id));

    private Product findFromRedisOrDb(Long id) {
        // 1. Redis 조회
        Product product = redisTemplate.opsForValue().get("product:" + id);

        if (product == null) {
            // 2. DB 조회
            product = productRepository.findById(id).orElseThrow();

            // 3. Redis 저장
            redisTemplate.opsForValue().set("product:" + id, product, 10, TimeUnit.MINUTES);
        }

        return product;
    }

    public Product findById(Long id) {
        return localCache.get(id);
    }
}

// 조회 순서:
// 1. 로컬 캐시 (가장 빠름)
// 2. Redis (빠름)
// 3. DB (느림)
```

---

## Q4. Connection Pool은 어떻게 설정하나요?

### 답변

**Connection Pool**은 **DB 연결을 재사용**하여 성능을 향상시킵니다.

### HikariCP 설정 (Spring Boot 기본)

```yaml
# application.yml
spring:
  datasource:
    hikari:
      # Connection Pool 크기
      maximum-pool-size: 10        # 최대 연결 수
      minimum-idle: 5              # 최소 유휴 연결 수

      # Timeout 설정
      connection-timeout: 30000    # 연결 대기 시간 (30초)
      idle-timeout: 600000         # 유휴 연결 유지 시간 (10분)
      max-lifetime: 1800000        # 연결 최대 수명 (30분)

      # Connection 테스트
      connection-test-query: SELECT 1

      # Pool 이름
      pool-name: HikariPool-1

      # 기타
      auto-commit: true
      read-only: false
```

### Pool Size 계산

**공식**:

```
Pool Size = (Core 수 × 2) + Effective Spindle Count

예시:
- CPU Core: 4개
- HDD: 1개 (Spindle Count)
- Pool Size = (4 × 2) + 1 = 9 → 약 10개
```

**실제 적용**:

```java
// ❌ 너무 큰 Pool Size (비효율)
maximum-pool-size: 100
// → DB 연결 100개 유지
// → DB 서버 부하 (연결당 메모리 소비)

// ✅ 적절한 Pool Size
maximum-pool-size: 10
// → DB 연결 10개 유지
// → 대부분의 경우 충분
```

### Connection Leak 탐지

**문제**: Connection을 반환하지 않아 Pool 고갈

```java
// ❌ Connection Leak
@Service
public class UserService {
    @Autowired
    private DataSource dataSource;

    public List<User> findAll() throws SQLException {
        Connection conn = dataSource.getConnection();
        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery("SELECT * FROM users");

        List<User> users = new ArrayList<>();
        while (rs.next()) {
            users.add(new User(rs.getLong("id"), rs.getString("name")));
        }

        // ⚠️ Connection을 반환하지 않음! (Leak)
        return users;
    }
}

// 10번 호출 → Pool의 10개 연결 모두 소진
// 11번째 호출 → connection-timeout (30초 대기 후 에러)
```

**해결 1: try-with-resources**:

```java
// ✅ 자동으로 Connection 반환
public List<User> findAll() throws SQLException {
    try (Connection conn = dataSource.getConnection();
         Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery("SELECT * FROM users")) {

        List<User> users = new ArrayList<>();
        while (rs.next()) {
            users.add(new User(rs.getLong("id"), rs.getString("name")));
        }
        return users;
    }
    // → 자동으로 conn.close() 호출 (Pool에 반환)
}
```

**해결 2: Leak Detection**:

```yaml
spring:
  datasource:
    hikari:
      leak-detection-threshold: 60000  # 60초 이상 사용 시 경고
```

```
// 로그 출력:
WARN HikariPool-1 - Connection leak detection triggered for connection com.mysql.cj.jdbc.ConnectionImpl@12345678
  at com.example.UserService.findAll(UserService.java:20)
```

### 꼬리 질문: Connection Pool vs Thread Pool?

**Connection Pool**:
- DB 연결 재사용
- 연결 생성 비용 절감
- Pool Size: 10~20개 (작음)

**Thread Pool**:
- 스레드 재사용
- 스레드 생성 비용 절감
- Pool Size: 200개 (큼)

**관계**:

```
200개 Thread → 10개 Connection Pool
→ Thread는 Connection을 순서대로 기다림

예시:
Thread 1: Connection 1 사용 중
Thread 2: Connection 2 사용 중
...
Thread 10: Connection 10 사용 중
Thread 11: 대기 (Connection 반환 대기)
```

---

## Q5. 실무에서 API 성능 문제 해결 경험은?

### 답변

**장애 사례: 주문 조회 API 응답 시간 30초 → 0.3초**

### 문제 발생

**증상**:
- 주문 목록 API 응답 시간: 30초
- DB CPU 사용률: 100%
- Thread Pool 고갈

**1단계: Thread Dump 분석**:

```bash
jstack 12345 > thread_dump.txt
```

**결과**:

```
"http-nio-8080-exec-150" WAITING
"http-nio-8080-exec-151" WAITING
...
"http-nio-8080-exec-200" WAITING  (모든 스레드 대기!)

at java.net.SocketInputStream.socketRead0(Native Method)
at com.mysql.cj.jdbc.ConnectionImpl.execSQL(ConnectionImpl.java:1234)
at com.example.OrderService.findByUserId(OrderService.java:45)
```

**원인**: 모든 스레드가 DB 쿼리 응답 대기

**2단계: Slow Query 분석**:

```sql
-- Slow Query Log
# Query_time: 30.123456
SELECT o.*, u.*, p.*
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id
WHERE u.email = 'john@example.com';
```

**EXPLAIN 분석**:

```
type: ALL  (Full Table Scan)
rows: 1,000,000  (전체 스캔)
```

**3단계: 최적화 적용**:

```sql
-- ✅ 1. 인덱스 추가
CREATE INDEX idx_users_email ON users(email);

-- ✅ 2. Covering Index
CREATE INDEX idx_orders_user_product ON orders(user_id, product_id, created_at);
```

**4단계: N+1 쿼리 제거**:

```java
// ❌ Before: N+1 문제
@GetMapping("/orders")
public List<OrderResponse> getOrders(@RequestParam String email) {
    User user = userRepository.findByEmail(email);  // 1번
    List<Order> orders = orderRepository.findByUserId(user.getId());  // 1번

    return orders.stream()
        .map(order -> {
            Product product = productRepository.findById(order.getProductId());  // N번!
            return new OrderResponse(order, product);
        })
        .collect(Collectors.toList());
}
// → 총 N+2번 쿼리

// ✅ After: JOIN FETCH
@Query("""
    SELECT o FROM Order o
    JOIN FETCH o.user u
    JOIN FETCH o.product p
    WHERE u.email = :email
    """)
List<Order> findByUserEmail(@Param("email") String email);

@GetMapping("/orders")
public List<OrderResponse> getOrders(@RequestParam String email) {
    List<Order> orders = orderRepository.findByUserEmail(email);  // 1번!

    return orders.stream()
        .map(order -> new OrderResponse(order, order.getProduct()))
        .collect(Collectors.toList());
}
// → 총 1번 쿼리
```

**5단계: 캐싱 적용**:

```java
// ✅ Redis Cache
@Cacheable(value = "orders", key = "#email")
public List<OrderResponse> getOrders(String email) {
    List<Order> orders = orderRepository.findByUserEmail(email);
    return orders.stream()
        .map(order -> new OrderResponse(order, order.getProduct()))
        .collect(Collectors.toList());
}
```

### 최적화 결과

| 항목 | Before | After | 개선율 |
|------|--------|-------|--------|
| 응답 시간 | 30초 | 0.3초 | 100배 |
| DB 쿼리 수 | 102번 | 1번 | 99% 감소 |
| DB CPU | 100% | 10% | 90% 감소 |
| Thread 사용 | 200개 (고갈) | 5개 | 97% 감소 |

---

## 요약 체크리스트

### Thread Dump
- [ ] **수집**: jstack으로 3~5번 수집 (10초 간격)
- [ ] **Deadlock**: "Found one Java-level deadlock" 확인
- [ ] **Thread Pool Exhaustion**: 모든 스레드가 WAITING

### Slow Query
- [ ] **Slow Query Log**: long_query_time 설정
- [ ] **EXPLAIN**: type, rows 확인
- [ ] **인덱스**: Full Scan → Index Scan

### 캐싱
- [ ] **로컬 캐시**: Caffeine (작은 데이터)
- [ ] **Redis**: 분산 환경, 대용량
- [ ] **Cache Stampede**: Lock으로 해결

### Connection Pool
- [ ] **Pool Size**: (Core × 2) + Spindle Count
- [ ] **Leak Detection**: leak-detection-threshold 설정
- [ ] **try-with-resources**: 자동 반환
