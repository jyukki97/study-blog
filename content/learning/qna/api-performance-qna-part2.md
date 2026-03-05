---
title: "API 성능 (Part 2: Slow Query 최적화, 심화)"
study_order: 701
date: 2025-12-01
topic: "Backend"
topic_icon: "💬"
topic_description: "Thread Dump, Slow Query, 캐싱, Connection Pool 관련 핵심 개념과 실전 예제 정리"
tags: ["Performance", "API", "Thread Dump", "Caching"]
categories: ["Backend"]
description: "Slow Query 최적화, Execution Plan 분석, 쿼리 튜닝 심화 전략 Q&A"
draft: false
module: "qna"
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

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: API 성능 (Part 1: 병목 분석과 기초)](/learning/qna/api-performance-qna/)**
