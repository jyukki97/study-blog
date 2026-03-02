---
title: "페이지네이션과 정렬: 대용량 데이터 처리"
study_order: 317
date: 2025-12-28
topic: "Database"
topic_icon: "📄"
topic_description: "Offset vs Cursor, No-Offset 페이징, 성능 최적화"
tags: ["Pagination", "Database", "Performance", "JPA", "Spring Data"]
categories: ["Data"]
draft: false
description: "Offset vs Cursor 페이지네이션 비교, 대용량 데이터 정렬과 Spring Data 적용"
module: "data-system"
quizzes:
  - question: "Offset 페이징의 가장 큰 문제점은?"
    options:
      - "구현이 복잡하다."
      - "페이지가 깊어질수록 OFFSET만큼 데이터를 스캔 후 버리므로 성능이 급격히 저하된다."
      - "정렬을 사용할 수 없다."
      - "총 개수를 알 수 없다."
    answer: 1
    explanation: "`OFFSET 10000 LIMIT 20`은 DB가 10000건을 읽고 버린 후 20건을 반환합니다. 깊은 페이지일수록 불필요한 스캔이 늘어나 성능이 저하됩니다."

  - question: "No-Offset(Cursor 기반) 페이징의 핵심 원리는?"
    options:
      - "모든 데이터를 메모리에 로드한 후 페이징"
      - "마지막 조회 항목의 키 값(예: id, createdAt)을 기준으로 WHERE 조건을 걸어 다음 데이터를 조회"
      - "캐시된 데이터를 사용"
      - "DB 파티셔닝을 활용"
    answer: 1
    explanation: "`WHERE id < 마지막_조회_id ORDER BY id DESC LIMIT 20`처럼 이전 페이지의 마지막 키를 조건으로 사용합니다. OFFSET 없이 항상 일정한 성능을 유지합니다."

  - question: "Cursor 기반 페이징에서 여러 컬럼으로 정렬할 때 주의할 점은?"
    options:
      - "인덱스를 사용할 수 없다."
      - "동일한 값(예: 같은 createdAt)이 있을 때 중복/누락을 방지하기 위해 유니크한 컬럼(예: id)을 추가 조건으로 사용해야 한다."
      - "페이지 크기를 1로 고정해야 한다."
      - "DB 종류에 따라 동작하지 않을 수 있다."
    answer: 1
    explanation: "`createdAt`이 같은 행이 여러 개면 `WHERE createdAt < ?`만으로는 일부가 누락될 수 있습니다. `(createdAt, id)` 조합으로 정렬하고 복합 조건을 사용해야 합니다."

  - question: "대용량 테이블에서 `SELECT COUNT(*)`가 느린 이유와 대안은?"
    options:
      - "DB가 COUNT를 지원하지 않아서 / 별도 쿼리 사용"
      - "조건에 맞는 모든 행을 스캔해야 하기 때문 / 캐시된 카운트 또는 `hasNext`만 제공"
      - "네트워크 지연 때문 / 비동기 처리"
      - "인덱스가 없어서 / 인덱스 추가"
    answer: 1
    explanation: "COUNT는 조건에 맞는 모든 행을 카운팅해야 합니다. 대용량에서는 Redis에 캐싱된 근사값을 주기적으로 갱신하거나, 총 개수 없이 `hasNext` 여부만 제공하는 것이 일반적입니다."

  - question: "Offset 페이징과 Cursor 페이징 중 '무한 스크롤' UI에 더 적합한 방식은?"
    options:
      - "Offset 페이징 (페이지 번호로 이동 가능)"
      - "Cursor 페이징 (일정한 성능, 데이터 변경에 강함)"
      - "둘 다 동일"
      - "어느 쪽도 적합하지 않음"
    answer: 1
    explanation: "무한 스크롤은 페이지 번호가 필요 없고 '다음 항목'만 로드합니다. Cursor 페이징은 깊은 페이지에서도 성능이 일정하고, 데이터가 추가/삭제되어도 중복/누락이 적어 무한 스크롤에 이상적입니다."
---

## 이 글에서 얻는 것

- **Offset 페이징의 한계**와 대안을 이해합니다
- **Cursor 기반 페이징**으로 대용량 데이터를 효율적으로 처리합니다
- **No-Offset 페이징** 패턴을 구현합니다

---

## Offset 페이징의 문제

### 기본 Offset 페이징

```sql
-- Page 1
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 0;

-- Page 1000
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 19980;
```

### 문제점

```mermaid
flowchart TB
    subgraph "OFFSET 19980"
        Scan["19,980개 행 스캔"]
        Skip["19,980개 건너뛰기"]
        Return["20개만 반환"]
    end
    
    Scan --> Skip --> Return
    
    Note["💀 페이지가 깊어질수록\n성능 급격히 저하"]
    
    style Note fill:#ffebee,stroke:#c62828
```

**실행 계획**:
```
type: index  -- 인덱스 사용
rows: 20000  -- 2만 행 스캔!
```

---

## 해결 1: No-Offset 페이징

### 개념

```sql
-- ❌ Offset 방식
SELECT * FROM orders ORDER BY id DESC LIMIT 20 OFFSET 19980;

-- ✅ No-Offset (키 기반)
SELECT * FROM orders WHERE id < 마지막_조회_id ORDER BY id DESC LIMIT 20;
```

### 구현

```java
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {
    
    // 첫 페이지
    @Query("SELECT o FROM Order o ORDER BY o.id DESC")
    List<Order> findFirstPage(Pageable pageable);
    
    // 다음 페이지 (No-Offset)
    @Query("SELECT o FROM Order o WHERE o.id < :lastId ORDER BY o.id DESC")
    List<Order> findNextPage(@Param("lastId") Long lastId, Pageable pageable);
}

@Service
public class OrderService {
    
    public OrderPageResponse getOrders(Long lastId, int size) {
        Pageable pageable = PageRequest.of(0, size);  // offset 무시
        
        List<Order> orders;
        if (lastId == null) {
            orders = orderRepository.findFirstPage(pageable);
        } else {
            orders = orderRepository.findNextPage(lastId, pageable);
        }
        
        Long nextLastId = orders.isEmpty() ? null : 
            orders.get(orders.size() - 1).getId();
        
        return new OrderPageResponse(orders, nextLastId, orders.size() == size);
    }
}

@Getter @AllArgsConstructor
public class OrderPageResponse {
    private List<Order> orders;
    private Long nextCursor;  // 다음 페이지 요청 시 사용
    private boolean hasNext;
}
```

### API

```text
# 첫 페이지
GET /api/orders?size=20

# 응답
{
    "orders": [...],
    "nextCursor": 12345,
    "hasNext": true
}

# 다음 페이지
GET /api/orders?cursor=12345&size=20
```

---

## 해결 2: Cursor 기반 페이징

### 여러 컬럼 정렬

```java
// 생성일 + ID로 정렬 (동일 시간 처리)
@Query("""
    SELECT o FROM Order o 
    WHERE (o.createdAt < :createdAt) 
       OR (o.createdAt = :createdAt AND o.id < :id)
    ORDER BY o.createdAt DESC, o.id DESC
    """)
List<Order> findNextPage(
    @Param("createdAt") LocalDateTime createdAt,
    @Param("id") Long id,
    Pageable pageable
);
```

### Cursor 인코딩

```java
@Service
public class CursorService {
    
    private final ObjectMapper objectMapper;
    
    public String encode(Order order) {
        CursorData data = new CursorData(order.getCreatedAt(), order.getId());
        return Base64.getEncoder().encodeToString(
            objectMapper.writeValueAsBytes(data)
        );
    }
    
    public CursorData decode(String cursor) {
        byte[] decoded = Base64.getDecoder().decode(cursor);
        return objectMapper.readValue(decoded, CursorData.class);
    }
    
    @Getter @AllArgsConstructor
    public static class CursorData {
        private LocalDateTime createdAt;
        private Long id;
    }
}
```

---

## QueryDSL 활용

### 동적 Cursor 조건

```java
@Repository
public class OrderQueryRepository {
    
    private final JPAQueryFactory queryFactory;
    
    public List<Order> findWithCursor(OrderSearchCondition condition) {
        return queryFactory
            .selectFrom(order)
            .where(
                cursorCondition(condition.getLastOrder()),
                statusEq(condition.getStatus())
            )
            .orderBy(order.createdAt.desc(), order.id.desc())
            .limit(condition.getSize())
            .fetch();
    }
    
    private BooleanExpression cursorCondition(Order lastOrder) {
        if (lastOrder == null) {
            return null;
        }
        
        return order.createdAt.lt(lastOrder.getCreatedAt())
            .or(
                order.createdAt.eq(lastOrder.getCreatedAt())
                    .and(order.id.lt(lastOrder.getId()))
            );
    }
}
```

---

## 총 개수 최적화

### 문제: COUNT(*) 느림

```sql
-- 대용량 테이블에서 매우 느림
SELECT COUNT(*) FROM orders WHERE status = 'COMPLETED';
```

### 해결 1: 총 개수 생략

```java
// hasNext만 제공, 총 개수 없음
public class CursorPageResponse<T> {
    private List<T> items;
    private String nextCursor;
    private boolean hasNext;
    // totalCount 없음!
}
```

### 해결 2: 예상 개수

```sql
-- 통계 기반 예상값 (빠름)
EXPLAIN SELECT * FROM orders WHERE status = 'COMPLETED';
-- rows: 12345 (예상값)
```

### 해결 3: 캐시된 COUNT

```java
@Service
public class OrderCountService {
    
    @Autowired
    private RedisTemplate<String, Long> redisTemplate;
    
    // 주기적으로 갱신되는 캐시된 카운트
    @Cacheable(value = "orderCount", key = "#status")
    public long getApproximateCount(OrderStatus status) {
        return orderRepository.countByStatus(status);
    }
    
    @Scheduled(fixedRate = 60000)  // 1분마다 갱신
    @CacheEvict(value = "orderCount", allEntries = true)
    public void refreshCount() {
        // 캐시 만료
    }
}
```

---

## 정렬 처리

### Spring Data Pageable

```java
@GetMapping("/orders")
public Page<OrderDto> getOrders(
        @PageableDefault(size = 20, sort = "createdAt", direction = DESC) Pageable pageable) {
    return orderService.findAll(pageable);
}

// 요청 예시
GET /api/orders?page=0&size=20&sort=createdAt,desc&sort=id,desc
```

### 인덱스와 정렬

```sql
-- 정렬 컬럼에 인덱스 필수
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- 복합 정렬
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
```

---

## Offset vs Cursor 비교

| 특성 | Offset | Cursor |
|------|--------|--------|
| 구현 복잡도 | 낮음 | 높음 |
| 깊은 페이지 성능 | ❌ 매우 느림 | ✅ 일정 |
| 임의 페이지 접근 | ✅ 가능 | ❌ 불가 |
| 데이터 변경 시 | 중복/누락 가능 | 안정적 |
| 총 개수 제공 | ✅ 쉬움 | 추가 작업 필요 |

### 선택 가이드

```mermaid
flowchart TD
    Start[페이지 수 제한?] --> |"<10페이지"| Offset
    Start --> |"무제한"| Q2{임의 페이지 필요?}
    Q2 --> |Yes| Hybrid[하이브리드]
    Q2 --> |No| Cursor
    
    style Cursor fill:#e8f5e9,stroke:#2e7d32
```

---

## 요약

### 페이지네이션 체크리스트

| 상황 | 권장 |
|------|------|
| 페이지 < 10 | Offset OK |
| 무한 스크롤 | Cursor |
| 대용량 테이블 | No-Offset |
| 실시간 데이터 | Cursor |

### 핵심 원칙

1. **깊은 페이지 피하기**: No-Offset 또는 Cursor
2. **정렬 인덱스**: ORDER BY 컬럼에 인덱스
3. **총 개수 캐시**: COUNT(*) 최적화
4. **hasNext 제공**: 다음 페이지 존재 여부

---

## 🔗 Related Deep Dive

- **[인덱스 기본](/learning/deep-dive/deep-dive-database-indexing/)**: 정렬 컬럼 인덱싱.
- **[JPA 성능](/learning/deep-dive/deep-dive-jpa-performance/)**: Fetch 전략과 페이징.
