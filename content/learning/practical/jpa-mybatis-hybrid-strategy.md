---
title: "JPA와 MyBatis 병행 전략"
date: 2025-01-16
topic: "Backend"
topic_icon: "🗄️"
topic_description: "ORM과 Native SQL 혼용 전략 및 성능 최적화"
tags: ["JPA", "MyBatis", "Database", "Performance", "ORM"]
categories: ["Backend", "Database"]
draft: true
---

## 개요

실무 프로젝트에서 JPA와 MyBatis를 함께 사용하면서 얻은 경험을 정리합니다. 각 기술의 장단점을 이해하고, 상황에 맞는 최적의 선택을 하는 것이 중요합니다.

## JPA vs MyBatis 비교

### JPA (Hibernate) 장점
```java
// 1. 객체 지향적 코드
@Entity
public class User {
    @Id @GeneratedValue
    private Long id;
    private String name;

    @OneToMany(mappedBy = "user")
    private List<Order> orders;
}

// 2. 간단한 CRUD
userRepository.save(user);
userRepository.findById(1L);
userRepository.delete(user);

// 3. 자동 변경 감지 (Dirty Checking)
@Transactional
public void updateUser(Long id, String newName) {
    User user = userRepository.findById(id).orElseThrow();
    user.setName(newName); // 자동으로 UPDATE 쿼리 실행
}
```

**JPA 사용이 적합한 경우:**
- 단순 CRUD 위주의 API
- 도메인 모델 중심 설계
- 엔티티 간 연관관계가 명확한 경우
- 빠른 개발 속도가 필요한 경우

### MyBatis 장점
```xml
<!-- 1. 복잡한 JOIN 쿼리 최적화 -->
<select id="getUserOrderStats" resultType="OrderStatsDto">
    SELECT
        u.id,
        u.name,
        COUNT(o.id) as order_count,
        SUM(o.amount) as total_amount,
        AVG(o.amount) as avg_amount,
        MAX(o.created_at) as last_order_date
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.status = 'ACTIVE'
      AND o.created_at >= #{startDate}
    GROUP BY u.id, u.name
    HAVING COUNT(o.id) > 0
    ORDER BY total_amount DESC
    LIMIT #{limit}
</select>

<!-- 2. 동적 쿼리 -->
<select id="searchUsers" resultType="User">
    SELECT * FROM users
    WHERE 1=1
    <if test="name != null">
        AND name LIKE CONCAT('%', #{name}, '%')
    </if>
    <if test="status != null">
        AND status = #{status}
    </if>
    <if test="minAge != null">
        AND age >= #{minAge}
    </if>
</select>

<!-- 3. Bulk 연산 최적화 -->
<update id="bulkUpdateStatus">
    UPDATE orders
    SET status = #{newStatus}
    WHERE id IN
    <foreach collection="orderIds" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</update>
```

**MyBatis 사용이 적합한 경우:**
- 복잡한 통계/집계 쿼리
- 레거시 DB 스키마와의 통합
- SQL 튜닝이 중요한 성능 critical 구간
- Bulk 연산이 많은 배치 처리

## 실무 병행 전략

### 1. 프로젝트 구성

```java
// JPA Repository
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    List<User> findByStatus(UserStatus status);
}

// MyBatis Mapper
@Mapper
public interface UserStatsMapper {
    List<UserStatsDto> getUserOrderStats(StatsRequest request);
    List<MonthlyRevenueDto> getMonthlyRevenue(int year);
    void bulkUpdateUserTier(List<Long> userIds, String newTier);
}

// Service Layer에서 혼용
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository; // JPA
    private final UserStatsMapper userStatsMapper; // MyBatis

    // 간단한 CRUD는 JPA
    public User getUserById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }

    // 복잡한 통계는 MyBatis
    public List<UserStatsDto> getUserStats(StatsRequest request) {
        return userStatsMapper.getUserOrderStats(request);
    }

    // 트랜잭션 내에서 함께 사용
    @Transactional
    public void processMonthlyBilling() {
        // 1. MyBatis로 통계 조회
        List<UserStatsDto> stats = userStatsMapper.getUserOrderStats(
            StatsRequest.builder().month(LocalDate.now()).build()
        );

        // 2. JPA로 엔티티 수정
        stats.forEach(stat -> {
            User user = userRepository.findById(stat.getUserId())
                .orElseThrow();
            user.updateTier(calculateTier(stat.getTotalAmount()));
        });
    }
}
```

### 2. 의사결정 플로우차트

```
쿼리 작성 필요?
    ↓
    ├─ 단순 CRUD? → JPA Repository 메서드
    │   예: findById(), save(), delete()
    │
    ├─ 단순 조건 검색? → JPA Query Methods
    │   예: findByEmailAndStatus(email, status)
    │
    ├─ 복잡한 조건 검색? → 성능 요구사항 확인
    │   ↓
    │   ├─ 성능 Critical 아님 → JPA Specification 또는 QueryDSL
    │   │   예: 관리자 화면 검색
    │   │
    │   └─ 성능 Critical → MyBatis Custom Query
    │       예: 대시보드 통계, 대용량 리포트
    │
    ├─ 집계/통계 쿼리? → MyBatis
    │   예: SUM, AVG, GROUP BY, 복잡한 JOIN
    │
    ├─ Bulk 연산? → 데이터 크기 확인
    │   ↓
    │   ├─ 소량 (<100건) → JPA saveAll() 또는 deleteAll()
    │   │
    │   └─ 대량 (≥100건) → MyBatis Bulk Insert/Update
    │
    └─ Native Query 필요? → MyBatis
        예: 특정 DB 함수 사용, 복잡한 서브쿼리
```

## 실제 성능 비교

### Case 1: 사용자별 주문 통계 조회

**JPA 방식 (N+1 문제 발생 가능):**
```java
// ❌ 비효율적 - N+1 쿼리 발생
public List<UserStatsDto> getUserStatsWithJpa() {
    List<User> users = userRepository.findAll(); // 1번 쿼리

    return users.stream()
        .map(user -> {
            // 각 유저마다 추가 쿼리 발생 (N번)
            List<Order> orders = orderRepository.findByUserId(user.getId());

            return UserStatsDto.builder()
                .userId(user.getId())
                .orderCount(orders.size())
                .totalAmount(orders.stream()
                    .map(Order::getAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add))
                .build();
        })
        .collect(Collectors.toList());
}

// ✅ 개선 - Fetch Join 사용
@Query("SELECT u FROM User u LEFT JOIN FETCH u.orders WHERE u.status = 'ACTIVE'")
List<User> findAllWithOrders();

// 하지만 여전히 집계 로직은 애플리케이션 레벨에서 처리
```

**성능:**
- 사용자 1,000명 기준: ~2,500ms (N+1 쿼리)
- Fetch Join 사용 시: ~800ms (메모리 부하 높음)

**MyBatis 방식 (최적화된 단일 쿼리):**
```xml
<select id="getUserOrderStats" resultType="UserStatsDto">
    SELECT
        u.id as user_id,
        u.name,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.amount), 0) as total_amount,
        COALESCE(AVG(o.amount), 0) as avg_amount
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.status = 'ACTIVE'
    GROUP BY u.id, u.name
</select>
```

**성능:**
- 사용자 1,000명 기준: ~120ms (단일 쿼리, DB 레벨 집계)
- **약 6~20배 성능 향상**

### Case 2: Bulk Insert

**JPA 방식:**
```java
// ❌ 비효율적 - 각 엔티티마다 INSERT
@Transactional
public void saveOrdersWithJpa(List<Order> orders) {
    orderRepository.saveAll(orders);
    // 1,000건 → 1,000번의 INSERT 쿼리
}

// ✅ 개선 - Batch Insert 설정
// application.yml
spring:
  jpa:
    properties:
      hibernate:
        jdbc:
          batch_size: 100
        order_inserts: true
        order_updates: true
```

**성능 (1,000건 기준):**
- Batch 미적용: ~5,000ms
- Batch 적용: ~800ms

**MyBatis 방식:**
```xml
<insert id="bulkInsertOrders">
    INSERT INTO orders (user_id, product_id, amount, created_at)
    VALUES
    <foreach collection="orders" item="order" separator=",">
        (#{order.userId}, #{order.productId}, #{order.amount}, #{order.createdAt})
    </foreach>
</insert>
```

**성능 (1,000건 기준):**
- ~250ms (단일 쿼리로 Bulk Insert)
- **약 3배 성능 향상**

### Case 3: 동적 검색 쿼리

**JPA Specification 방식:**
```java
public class UserSpecification {
    public static Specification<User> withDynamicQuery(UserSearchDto search) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (search.getName() != null) {
                predicates.add(cb.like(root.get("name"), "%" + search.getName() + "%"));
            }
            if (search.getStatus() != null) {
                predicates.add(cb.equal(root.get("status"), search.getStatus()));
            }
            if (search.getMinAge() != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("age"), search.getMinAge()));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}

// 사용
userRepository.findAll(UserSpecification.withDynamicQuery(searchDto));
```

**장점:** 타입 안정성, 컴파일 타임 검증
**단점:** 복잡한 쿼리는 코드가 길어지고 가독성 떨어짐

**MyBatis 동적 SQL:**
```xml
<select id="searchUsers" resultType="User">
    SELECT * FROM users
    WHERE 1=1
    <if test="name != null and name != ''">
        AND name LIKE CONCAT('%', #{name}, '%')
    </if>
    <if test="status != null">
        AND status = #{status}
    </if>
    <if test="minAge != null">
        AND age >= #{minAge}
    </if>
    <if test="orderBy != null">
        ORDER BY ${orderBy}
    </if>
</select>
```

**장점:** 가독성 좋고 SQL 직관적
**단점:** 런타임 오류 가능성, 타입 안정성 낮음

**성능:** 비슷함 (동적 쿼리 특성상 실행 계획 차이는 미미)

## 트랜잭션 관리 주의사항

### 1. JPA와 MyBatis 혼용 시 주의점

```java
@Service
@RequiredArgsConstructor
public class OrderService {
    private final OrderRepository orderRepository; // JPA
    private final OrderMapper orderMapper; // MyBatis

    // ❌ 잘못된 예: JPA 변경 감지가 동작 안 할 수 있음
    @Transactional
    public void wrongExample(Long orderId) {
        // 1. JPA로 조회
        Order order = orderRepository.findById(orderId).orElseThrow();

        // 2. MyBatis로 직접 UPDATE
        orderMapper.updateOrderStatus(orderId, "COMPLETED");

        // 3. JPA 엔티티 수정
        order.setCompletedAt(LocalDateTime.now());
        // → MyBatis가 먼저 DB를 수정했으므로 충돌 가능!
    }

    // ✅ 올바른 예 1: 명확히 분리
    @Transactional
    public void correctExample1(Long orderId) {
        Order order = orderRepository.findById(orderId).orElseThrow();
        order.setStatus(OrderStatus.COMPLETED);
        order.setCompletedAt(LocalDateTime.now());
        orderRepository.save(order); // 명시적 save
    }

    // ✅ 올바른 예 2: MyBatis만 사용
    @Transactional
    public void correctExample2(Long orderId) {
        orderMapper.updateOrderStatus(orderId, "COMPLETED");
        orderMapper.updateCompletedAt(orderId, LocalDateTime.now());
    }

    // ✅ 올바른 예 3: 읽기는 혼용 가능
    @Transactional(readOnly = true)
    public OrderDetailDto getOrderDetail(Long orderId) {
        // JPA로 기본 정보
        Order order = orderRepository.findById(orderId).orElseThrow();

        // MyBatis로 통계 정보
        OrderStatsDto stats = orderMapper.getOrderStats(orderId);

        return OrderDetailDto.builder()
            .order(order)
            .stats(stats)
            .build();
    }
}
```

### 2. 영속성 컨텍스트와 캐시 불일치

```java
@Transactional
public void cacheInconsistency() {
    // 1. JPA로 조회 (1차 캐시에 저장됨)
    User user = userRepository.findById(1L).orElseThrow();
    System.out.println("JPA: " + user.getName()); // "John"

    // 2. MyBatis로 직접 UPDATE
    userMapper.updateUserName(1L, "Jane");

    // 3. JPA로 다시 조회
    User user2 = userRepository.findById(1L).orElseThrow();
    System.out.println("JPA: " + user2.getName()); // 여전히 "John"! (1차 캐시 때문)

    // 해결 방법 1: EntityManager flush & clear
    entityManager.flush();
    entityManager.clear();
    User user3 = userRepository.findById(1L).orElseThrow();
    System.out.println("JPA: " + user3.getName()); // "Jane"

    // 해결 방법 2: 트랜잭션 분리
}
```

## 실무 적용 가이드라인

### 1. 계층별 역할 분리

```java
// ✅ 권장: Repository 계층에서 명확히 분리
@Repository
public interface UserJpaRepository extends JpaRepository<User, Long> {
    // 간단한 CRUD와 조회
}

@Mapper
public interface UserMyBatisMapper {
    // 복잡한 쿼리와 통계
    List<UserStatsDto> getComplexStats(StatsRequest request);
    void bulkUpdateTier(List<Long> userIds, String tier);
}

// Service는 비즈니스 로직에 집중
@Service
public class UserService {
    // 두 기술을 적재적소에 활용
}
```

### 2. 패키지 구조 제안

```
src/main/java/com/example/
├─ domain/
│  ├─ user/
│  │  ├─ entity/
│  │  │  └─ User.java (JPA Entity)
│  │  ├─ repository/
│  │  │  ├─ UserRepository.java (JPA)
│  │  │  └─ UserStatsMapper.java (MyBatis)
│  │  ├─ service/
│  │  │  └─ UserService.java
│  │  └─ dto/
│  │     ├─ UserDto.java
│  │     └─ UserStatsDto.java
│  └─ order/
│     └─ ... (동일 구조)
├─ config/
│  ├─ JpaConfig.java
│  └─ MyBatisConfig.java
└─ ...

src/main/resources/
├─ mybatis/
│  └─ mapper/
│     ├─ UserStatsMapper.xml
│     └─ OrderStatsMapper.xml
└─ application.yml
```

### 3. 설정 파일

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb
    driver-class-name: com.mysql.cj.jdbc.Driver

  jpa:
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        format_sql: true
        default_batch_fetch_size: 100
        jdbc:
          batch_size: 100
        order_inserts: true
    show-sql: false

mybatis:
  configuration:
    map-underscore-to-camel-case: true
    default-fetch-size: 100
    default-statement-timeout: 30
  mapper-locations: classpath:mybatis/mapper/**/*.xml
  type-aliases-package: com.example.domain.*.dto

logging:
  level:
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE
    com.example.domain: DEBUG
```

## 마이그레이션 전략

### MyBatis → JPA 점진적 전환

```java
// Phase 1: 기존 MyBatis 유지, 새 기능만 JPA
@Service
public class ProductService {
    private final ProductMapper productMapper; // 기존 코드
    private final CategoryRepository categoryRepository; // 신규 기능

    // 기존 기능은 MyBatis 유지
    public List<ProductDto> getProducts() {
        return productMapper.selectProducts();
    }

    // 신규 기능은 JPA 사용
    public Category createCategory(CategoryDto dto) {
        Category category = Category.from(dto);
        return categoryRepository.save(category);
    }
}

// Phase 2: CRUD부터 JPA로 전환
@Entity
public class Product {
    @Id @GeneratedValue
    private Long id;
    private String name;
    // ... 기본 필드
}

@Repository
public interface ProductRepository extends JpaRepository<Product, Long> {
    List<Product> findByNameContaining(String name);
}

// Phase 3: 복잡한 쿼리는 MyBatis 유지
@Service
public class ProductService {
    private final ProductRepository productRepository; // JPA로 전환
    private final ProductStatsMapper productStatsMapper; // 통계는 MyBatis

    public Product getProduct(Long id) {
        return productRepository.findById(id).orElseThrow();
    }

    public List<ProductStatsDto> getProductStats() {
        return productStatsMapper.getMonthlyStats(); // 복잡한 집계
    }
}
```

## 성능 모니터링

### 1. 쿼리 로깅

```java
// JPA 쿼리 로깅
@Component
public class HibernateStatisticsLogger {
    @EventListener(ApplicationReadyEvent.class)
    public void logStatistics() {
        SessionFactory sessionFactory = entityManager.getEntityManagerFactory()
            .unwrap(SessionFactory.class);
        Statistics stats = sessionFactory.getStatistics();
        stats.setStatisticsEnabled(true);

        // 주기적으로 통계 출력
        log.info("Query Count: {}", stats.getQueryExecutionCount());
        log.info("Cache Hit Ratio: {}", stats.getSecondLevelCacheHitCount());
    }
}

// MyBatis 쿼리 로깅
@Slf4j
@Component
public class MyBatisInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long start = System.currentTimeMillis();
        Object result = invocation.proceed();
        long end = System.currentTimeMillis();

        log.debug("MyBatis Query executed in {}ms", end - start);
        return result;
    }
}
```

### 2. 성능 메트릭

| 지표 | JPA | MyBatis | 비고 |
|-----|-----|---------|------|
| 단순 CRUD (100건) | 50ms | 80ms | JPA 우세 |
| 복잡한 JOIN 통계 | 800ms | 120ms | MyBatis 우세 |
| Bulk Insert (1000건) | 800ms | 250ms | MyBatis 우세 |
| N+1 쿼리 위험도 | 높음 | 낮음 | 주의 필요 |
| 개발 생산성 | 높음 | 중간 | - |
| 러닝 커브 | 높음 | 낮음 | - |

## 실전 팁

### 1. JPA N+1 문제 해결

```java
// ❌ N+1 문제 발생
@OneToMany(mappedBy = "user")
private List<Order> orders;

List<User> users = userRepository.findAll(); // 1번
users.forEach(user -> {
    user.getOrders().size(); // 각 유저마다 쿼리 (N번)
});

// ✅ 해결 방법 1: Fetch Join
@Query("SELECT DISTINCT u FROM User u LEFT JOIN FETCH u.orders")
List<User> findAllWithOrders();

// ✅ 해결 방법 2: EntityGraph
@EntityGraph(attributePaths = {"orders"})
List<User> findAll();

// ✅ 해결 방법 3: Batch Fetch Size
@OneToMany(mappedBy = "user")
@BatchSize(size = 100)
private List<Order> orders;

// ✅ 해결 방법 4: 통계 쿼리는 MyBatis로
List<UserStatsDto> stats = userStatsMapper.getUserOrderStats();
```

### 2. MyBatis ResultMap 활용

```xml
<!-- 복잡한 객체 매핑 -->
<resultMap id="userWithOrdersMap" type="UserWithOrdersDto">
    <id property="userId" column="user_id"/>
    <result property="userName" column="user_name"/>
    <collection property="orders" ofType="OrderDto">
        <id property="orderId" column="order_id"/>
        <result property="amount" column="amount"/>
        <result property="status" column="status"/>
    </collection>
</resultMap>

<select id="getUserWithOrders" resultMap="userWithOrdersMap">
    SELECT
        u.id as user_id,
        u.name as user_name,
        o.id as order_id,
        o.amount,
        o.status
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{userId}
</select>
```

### 3. 트랜잭션 격리 레벨

```java
// 읽기 전용 트랜잭션 최적화
@Transactional(readOnly = true)
public List<UserDto> getUsers() {
    return userRepository.findAll().stream()
        .map(UserDto::from)
        .collect(Collectors.toList());
}

// 높은 격리 레벨이 필요한 경우
@Transactional(isolation = Isolation.SERIALIZABLE)
public void criticalOperation() {
    // 동시성 문제가 critical한 작업
}
```

## 결론

### 선택 기준 요약

**JPA를 사용하세요:**
- ✅ 단순 CRUD 작업
- ✅ 도메인 모델 중심 설계
- ✅ 빠른 개발이 필요할 때
- ✅ 엔티티 간 관계가 명확할 때

**MyBatis를 사용하세요:**
- ✅ 복잡한 통계/집계 쿼리
- ✅ 성능이 critical한 부분
- ✅ Bulk 연산이 많을 때
- ✅ 레거시 DB와 통합할 때

**병행 사용의 핵심:**
1. 각 기술의 강점을 이해하고 적재적소에 활용
2. 트랜잭션 내에서 혼용 시 영속성 컨텍스트 주의
3. 성능 측정을 통한 의사결정
4. 명확한 사용 기준과 가이드라인 수립

실무에서는 "정답"보다 "상황에 맞는 최선의 선택"이 중요합니다. 프로젝트 특성, 팀 역량, 유지보수성을 종합적으로 고려하여 결정하세요.
