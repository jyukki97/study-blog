---
title: "JPA 성능 최적화: Fetch 전략과 배치 처리"
study_order: 316
date: 2025-12-28
topic: "JPA"
topic_icon: "⚡"
topic_description: "Lazy/Eager 로딩, Batch Size, QueryDSL, Hibernate 통계"
tags: ["JPA", "Hibernate", "Performance", "Batch", "Optimization"]
categories: ["Data"]
draft: false
description: "JPA N+1 해결, Fetch 전략, 배치 처리 등 성능 최적화 실전 기법"
module: "data-system"
quizzes:
  - question: "JPA `@ManyToOne` 연관관계의 기본 FetchType은 무엇이며, 왜 문제가 될 수 있는가?"
    options:
      - "LAZY / 성능이 너무 느려서 문제"
      - "EAGER / 연관 엔티티를 항상 조회하여 N+1 문제를 유발할 수 있음"
      - "NONE / 연관 엔티티를 조회할 수 없어서 문제"
      - "LAZY / 트랜잭션 외부에서 접근 시 예외 발생"
    answer: 1
    explanation: "@ManyToOne은 기본값이 EAGER입니다. 목록 조회 시 각 엔티티의 연관 엔티티를 추가 쿼리로 조회하여 N+1 문제가 발생합니다. 모든 연관관계를 LAZY로 명시적으로 설정하는 것이 권장됩니다."

  - question: "컬렉션 Fetch Join과 페이징을 함께 사용하면 경고가 발생하는 이유는?"
    options:
      - "페이징이 비활성화되기 때문"
      - "JPA가 전체 데이터를 메모리로 로드한 후 애플리케이션에서 페이징(메모리 페이징)을 수행하기 때문"
      - "페이징 쿼리가 잘못 생성되기 때문"
      - "트랜잭션이 롤백되기 때문"
    answer: 1
    explanation: "컬렉션 Fetch Join 시 DB 레벨에서 페이징을 적용하면 데이터가 잘릴 수 있어, Hibernate가 전체 데이터를 메모리로 가져와 페이징합니다. 대용량 데이터에서 OOM 위험이 있으므로 Batch Size를 사용해야 합니다."

  - question: "`default_batch_fetch_size=100` 설정의 효과는?"
    options:
      - "한 번에 최대 100건만 조회할 수 있다."
      - "Lazy Loading 시 100건씩 IN 쿼리로 묶어 조회하여 N+1 문제를 N/100+1로 줄인다."
      - "배치 처리 시 트랜잭션을 100건마다 커밋한다."
      - "페이지 크기를 100으로 고정한다."
    answer: 1
    explanation: "Batch Size는 `WHERE id IN (1,2,3,...100)`처럼 여러 건을 한 번에 조회합니다. 기존 N+1이 1+N에서 1+(N/100) 쿼리로 줄어들어 성능이 크게 개선됩니다."

  - question: "대용량 데이터 배치 처리 시 `entityManager.clear()`를 주기적으로 호출하는 이유는?"
    options:
      - "트랜잭션을 커밋하기 위해"
      - "영속성 컨텍스트에 쌓인 엔티티를 비워 메모리(OutOfMemory)를 방지하기 위해"
      - "캐시를 활성화하기 위해"
      - "Lazy Loading을 끄기 위해"
    answer: 1
    explanation: "영속성 컨텍스트는 조회/저장된 엔티티를 캐시합니다. 대용량 처리 시 계속 쌓이면 메모리가 부족해집니다. 주기적으로 flush() 후 clear()하여 메모리를 해제해야 합니다."

  - question: "JPQL Bulk Update(`@Modifying @Query`)의 주의점은?"
    options:
      - "트랜잭션이 자동으로 시작된다."
      - "영속성 컨텍스트를 거치지 않고 DB를 직접 수정하므로, 실행 후 영속성 컨텍스트와 불일치가 발생할 수 있다."
      - "페이징을 사용할 수 없다."
      - "Index가 사용되지 않는다."
    answer: 1
    explanation: "Bulk Update는 영속성 컨텍스트 캐시를 거치지 않습니다. 이미 조회된 엔티티가 있으면 stale한 상태가 됩니다. 실행 후 `entityManager.clear()`로 동기화하거나, 조회 전에 실행해야 합니다."
---

## 이 글에서 얻는 것

- **Fetch 전략** (Lazy vs Eager)의 동작과 함정을 이해합니다
- **Batch Size**와 **Fetch Join**으로 N+1을 최적화합니다
- **대용량 배치 처리** 패턴을 익힙니다

---

## Fetch 전략

### Lazy vs Eager

```mermaid
flowchart LR
    subgraph "FetchType.LAZY"
        L1[Order 조회] --> L2[Order 엔티티]
        L2 -->|"접근 시"| L3[Items 조회]
    end
    
    subgraph "FetchType.EAGER"
        E1[Order 조회] --> E2["Order + Items\n즉시 조회"]
    end
```

```java
@Entity
public class Order {
    @Id
    private Long id;
    
    // ✅ 기본값: LAZY (권장)
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    private List<OrderItem> items;
    
    // ❌ EAGER: 항상 조회 → 불필요한 쿼리
    @ManyToOne(fetch = FetchType.EAGER)  // 기본값이 EAGER
    private User user;
}
```

### EAGER의 함정

```java
// ❌ EAGER 설정 시 문제
List<Order> orders = orderRepository.findAll();  // 1개 쿼리

// 실제 실행 쿼리:
// 1. SELECT * FROM orders
// 2. SELECT * FROM users WHERE id = 1
// 3. SELECT * FROM users WHERE id = 2
// ...N개 추가 쿼리 (N+1)

// ✅ 해결: 모든 @ManyToOne도 LAZY로
@ManyToOne(fetch = FetchType.LAZY)
private User user;
```

---

## N+1 해결 전략

### 1. Fetch Join

```java
// ✅ JPQL Fetch Join
@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.id = :id")
Order findByIdWithItems(@Param("id") Long id);

// ✅ EntityGraph
@EntityGraph(attributePaths = {"items", "user"})
@Query("SELECT o FROM Order o WHERE o.id = :id")
Order findByIdWithGraph(@Param("id") Long id);
```

**주의**: 컬렉션 Fetch Join 시 페이징 불가

```java
// ❌ 컬렉션 Fetch Join + 페이징 = 메모리 페이징 경고
@Query("SELECT o FROM Order o JOIN FETCH o.items")
Page<Order> findAllWithItems(Pageable pageable);
// WARN: firstResult/maxResults specified with collection fetch; applying in memory!
```

### 2. Batch Size (권장)

```java
// application.yml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
```

```java
// 또는 엔티티에 직접 설정
@BatchSize(size = 100)
@OneToMany(mappedBy = "order")
private List<OrderItem> items;
```

**동작 원리**:

```sql
-- 배치 사이즈 없이
SELECT * FROM order_items WHERE order_id = 1;
SELECT * FROM order_items WHERE order_id = 2;
SELECT * FROM order_items WHERE order_id = 3;
-- ... N개 쿼리

-- 배치 사이즈 100 적용
SELECT * FROM order_items WHERE order_id IN (1, 2, 3, ..., 100);
-- 1개 쿼리로 100개 Order의 Items 조회
```

### 전략 비교

| 전략 | 장점 | 단점 | 사용 시점 |
|------|------|------|----------|
| Fetch Join | 1개 쿼리 | 페이징 불가, 카테시안 곱 | 단건 조회 |
| Batch Size | 페이징 가능 | N/batch 쿼리 | 목록 조회 |
| EntityGraph | 선언적 | 동적 변경 어려움 | 다양한 조합 |

---

## 대용량 배치 처리

### 문제: 메모리 부족

```java
// ❌ 10만 건 한 번에 조회 → OutOfMemoryError
List<Order> orders = orderRepository.findAll();
for (Order order : orders) {
    order.updateStatus(OrderStatus.COMPLETED);
}
```

### 해결 1: 페이징 처리

```java
public void processAllOrders() {
    int pageSize = 1000;
    int page = 0;
    Page<Order> orderPage;
    
    do {
        orderPage = orderRepository.findByStatus(
            OrderStatus.PENDING,
            PageRequest.of(page, pageSize)
        );
        
        for (Order order : orderPage.getContent()) {
            order.updateStatus(OrderStatus.PROCESSING);
        }
        
        entityManager.flush();
        entityManager.clear();  // 영속성 컨텍스트 초기화
        
        page++;
    } while (orderPage.hasNext());
}
```

### 해결 2: Stateless Session

```java
// Hibernate Stateless Session (영속성 컨텍스트 없음)
@Transactional
public void bulkUpdate() {
    StatelessSession session = sessionFactory.openStatelessSession();
    Transaction tx = session.beginTransaction();
    
    try {
        ScrollableResults scroll = session
            .createQuery("FROM Order WHERE status = :status")
            .setParameter("status", OrderStatus.PENDING)
            .scroll(ScrollMode.FORWARD_ONLY);
        
        int count = 0;
        while (scroll.next()) {
            Order order = (Order) scroll.get(0);
            order.setStatus(OrderStatus.COMPLETED);
            session.update(order);
            
            if (++count % 100 == 0) {
                session.getTransaction().commit();
                session.beginTransaction();
            }
        }
        
        tx.commit();
    } finally {
        session.close();
    }
}
```

### 해결 3: Bulk Update (권장)

```java
// ✅ JPQL Bulk Update - 가장 효율적
@Modifying
@Query("UPDATE Order o SET o.status = :status WHERE o.createdAt < :date")
int bulkUpdateStatus(@Param("status") OrderStatus status, 
                     @Param("date") LocalDateTime date);

// 사용
@Transactional
public void archiveOldOrders() {
    int updated = orderRepository.bulkUpdateStatus(
        OrderStatus.ARCHIVED,
        LocalDateTime.now().minusYears(1)
    );
    log.info("Archived {} orders", updated);
    
    // ⚠️ 영속성 컨텍스트 동기화 필요
    entityManager.clear();
}
```

---

## Hibernate 통계 & 디버깅

### 통계 활성화

```yaml
spring:
  jpa:
    properties:
      hibernate:
        generate_statistics: true
        session.events.log.LOG_QUERIES_SLOWER_THAN_MS: 100
```

```java
@Aspect
@Component
public class JpaStatisticsAspect {
    
    @Autowired
    private EntityManagerFactory emf;
    
    @Around("@annotation(org.springframework.transaction.annotation.Transactional)")
    public Object logStatistics(ProceedingJoinPoint pjp) throws Throwable {
        Statistics stats = emf.unwrap(SessionFactory.class).getStatistics();
        stats.clear();
        
        long start = System.currentTimeMillis();
        Object result = pjp.proceed();
        long duration = System.currentTimeMillis() - start;
        
        log.info("=== JPA Statistics for {} ===", pjp.getSignature().getName());
        log.info("Queries: {}", stats.getQueryExecutionCount());
        log.info("Entity loads: {}", stats.getEntityLoadCount());
        log.info("Collection loads: {}", stats.getCollectionLoadCount());
        log.info("Duration: {}ms", duration);
        
        if (stats.getQueryExecutionCount() > 10) {
            log.warn("⚠️ Too many queries! Possible N+1 issue");
        }
        
        return result;
    }
}
```

### p6spy로 쿼리 로깅

```xml
<dependency>
    <groupId>com.github.gavlyukovskiy</groupId>
    <artifactId>p6spy-spring-boot-starter</artifactId>
    <version>1.9.0</version>
</dependency>
```

```properties
# spy.properties
logMessageFormat=com.p6spy.engine.spy.appender.CustomLineFormat
customLogMessageFormat=%(executionTime)ms | %(sql)
```

---

## QueryDSL 활용

### 동적 쿼리 최적화

```java
@Repository
public class OrderQueryRepository {
    
    private final JPAQueryFactory queryFactory;
    
    public List<OrderDto> searchOrders(OrderSearchCondition condition) {
        return queryFactory
            .select(new QOrderDto(
                order.id,
                order.status,
                order.totalAmount,
                order.createdAt
            ))
            .from(order)
            .leftJoin(order.user, user)
            .where(
                statusEq(condition.getStatus()),
                userIdEq(condition.getUserId()),
                createdAfter(condition.getFromDate())
            )
            .orderBy(order.createdAt.desc())
            .offset(condition.getOffset())
            .limit(condition.getLimit())
            .fetch();
    }
    
    private BooleanExpression statusEq(OrderStatus status) {
        return status != null ? order.status.eq(status) : null;
    }
}
```

---

## 요약

### 최적화 체크리스트

| 항목 | 권장 설정 |
|------|----------|
| @ManyToOne | FetchType.LAZY |
| @OneToMany | FetchType.LAZY + BatchSize |
| 목록 조회 | Batch Size 100 |
| 단건 조회 | Fetch Join / EntityGraph |
| 대용량 수정 | Bulk Update JPQL |
| 모니터링 | Hibernate Statistics |

### N+1 해결 순서

1. **확인**: Hibernate Statistics로 쿼리 수 체크
2. **Batch Size**: 목록 조회에 기본 적용
3. **Fetch Join**: 특정 조회에 필요 시 추가
4. **DTO 프로젝션**: 불필요한 필드 제외

---

## 🔗 Related Deep Dive

- **[JPA N+1 문제](/learning/deep-dive/deep-dive-jpa-n-plus-1/)**: N+1의 원인과 해결.
- **[인덱스 기본](/learning/deep-dive/deep-dive-database-indexing/)**: 쿼리 성능의 핵심.
