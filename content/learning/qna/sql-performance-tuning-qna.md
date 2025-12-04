---
title: "SQL 성능 튜닝 정리"
date: 2025-01-27
topic: "Database"
topic_icon: "💬"
topic_description: "SQL 성능 튜닝, Execution Plan, Join 전략 관련 핵심 개념과 실전 예제 정리"
tags: ["SQL", "Performance", "Join", "Optimization"]
categories: ["Database"]
draft: false
---

# SQL 성능 튜닝 정리

## Q1. Execution Plan (실행 계획)은 어떻게 읽나요?

### 답변

**Execution Plan (실행 계획)**은 **DB 옵티마이저가 쿼리를 어떻게 실행할지 계획한 내용**입니다.

**실행 계획 확인 명령어**:

```sql
-- MySQL
EXPLAIN SELECT * FROM users WHERE age = 25;
EXPLAIN ANALYZE SELECT * FROM users WHERE age = 25;  -- 실제 실행 + 통계

-- PostgreSQL
EXPLAIN SELECT * FROM users WHERE age = 25;
EXPLAIN ANALYZE SELECT * FROM users WHERE age = 25;

-- Oracle
EXPLAIN PLAN FOR SELECT * FROM users WHERE age = 25;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
```

**실행 계획 예시** (MySQL):

```sql
EXPLAIN SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age = 25;
```

**출력**:

```
+----+-------------+-------+------+---------------+---------+---------+-------+------+-------------+
| id | select_type | table | type | possible_keys | key     | key_len | ref   | rows | Extra       |
+----+-------------+-------+------+---------------+---------+---------+-------+------+-------------+
|  1 | SIMPLE      | u     | ref  | PRIMARY,idx   | idx_age | 4       | const | 5000 | Using where |
|  1 | SIMPLE      | o     | ref  | idx_user_id   | idx_uid | 4       | u.id  | 10   | NULL        |
+----+-------------+-------+------+---------------+---------+---------+-------+------+-------------+
```

### 주요 컬럼 설명

**1. type (접근 방법)**:

| type | 설명 | 성능 |
|------|------|------|
| system | 테이블에 Row 1개 | 최고 ⭐⭐⭐⭐⭐ |
| const | PK/Unique로 1개 조회 | 최고 ⭐⭐⭐⭐⭐ |
| eq_ref | Join 시 PK/Unique | 매우 좋음 ⭐⭐⭐⭐ |
| ref | Non-Unique 인덱스 | 좋음 ⭐⭐⭐ |
| range | 인덱스 범위 검색 | 보통 ⭐⭐ |
| index | 인덱스 풀 스캔 | 나쁨 ⭐ |
| ALL | 테이블 풀 스캔 | 매우 나쁨 ❌ |

```sql
-- ✅ const (최고)
SELECT * FROM users WHERE id = 123;
-- type: const (PK로 1개 조회)

-- ✅ ref (좋음)
SELECT * FROM users WHERE age = 25;
-- type: ref (Non-Unique 인덱스)

-- ⚠️ range (보통)
SELECT * FROM users WHERE age BETWEEN 20 AND 30;
-- type: range (인덱스 범위 검색)

-- ❌ ALL (나쁨)
SELECT * FROM users WHERE YEAR(created_at) = 2025;
-- type: ALL (함수로 인해 인덱스 무효화)
```

**2. possible_keys vs key**:

```
possible_keys: 사용 가능한 인덱스 목록
key: 실제로 사용된 인덱스

possible_keys: idx_age, idx_city
key: idx_age
→ 옵티마이저가 idx_age를 선택함
```

**3. rows (예상 스캔 Row 수)**:

```sql
-- ❌ rows가 많으면 느림
EXPLAIN SELECT * FROM orders WHERE status = 'PENDING';
-- rows: 500000 (50만 건 스캔 예상) ⚠️

-- ✅ rows가 적으면 빠름
EXPLAIN SELECT * FROM orders WHERE order_id = 12345;
-- rows: 1 (1건만 스캔) ✅
```

**4. Extra (추가 정보)**:

| Extra | 의미 | 성능 |
|-------|------|------|
| Using index | Covering Index | 매우 좋음 ✅ |
| Using where | WHERE 필터 사용 | 보통 |
| Using filesort | ORDER BY 정렬 | 나쁨 ⚠️ |
| Using temporary | 임시 테이블 생성 | 매우 나쁨 ❌ |

```sql
-- ✅ Using index (Covering Index)
EXPLAIN SELECT id, name FROM users WHERE age = 25;
-- Extra: Using index
-- → 인덱스만으로 처리 (빠름!)

-- ⚠️ Using filesort
EXPLAIN SELECT * FROM users ORDER BY created_at;
-- Extra: Using filesort
-- → 정렬을 위한 추가 작업 (느림)

-- ❌ Using temporary
EXPLAIN SELECT city, COUNT(*)
FROM users
GROUP BY city
ORDER BY COUNT(*) DESC;
-- Extra: Using temporary; Using filesort
-- → 임시 테이블 + 정렬 (매우 느림!)
```

### 꼬리 질문 1: EXPLAIN vs EXPLAIN ANALYZE 차이는?

**EXPLAIN**: 실행 계획만 보여줌 (실제 실행 X)
**EXPLAIN ANALYZE**: 실제 실행 + 실행 시간 통계

```sql
-- EXPLAIN (예측만)
EXPLAIN SELECT * FROM users WHERE age = 25;
-- rows: 5000 (예측)

-- EXPLAIN ANALYZE (실제 실행)
EXPLAIN ANALYZE SELECT * FROM users WHERE age = 25;
-- rows: 5000 (예측), actual rows: 4823 (실제)
-- Planning Time: 0.5ms
-- Execution Time: 12.3ms
```

**주의**: `EXPLAIN ANALYZE`는 실제로 쿼리를 실행하므로 UPDATE/DELETE 시 데이터가 변경됩니다!

```sql
-- ⚠️ 주의! 실제로 삭제됨
EXPLAIN ANALYZE DELETE FROM users WHERE age < 18;
-- → 실제로 데이터 삭제! (롤백 필요)

-- ✅ 트랜잭션으로 보호
BEGIN;
EXPLAIN ANALYZE DELETE FROM users WHERE age < 18;
ROLLBACK;  -- 변경사항 취소
```

### 꼬리 질문 2: 실행 계획이 바뀌는 경우는?

**1. 통계 정보 변경**:

```sql
-- 데이터 대량 삽입 후 통계 업데이트
INSERT INTO users SELECT ... (100만 건 삽입)

-- ❌ 오래된 통계로 잘못된 실행 계획
EXPLAIN SELECT * FROM users WHERE age = 25;
-- rows: 100 (예전 통계 기준)

-- ✅ 통계 업데이트
ANALYZE TABLE users;  -- MySQL
VACUUM ANALYZE users; -- PostgreSQL

EXPLAIN SELECT * FROM users WHERE age = 25;
-- rows: 50000 (최신 통계 기준)
-- → 실행 계획 변경됨! (Index Scan → Full Scan)
```

**2. 인덱스 추가/삭제**:

```sql
-- Before: Full Table Scan
EXPLAIN SELECT * FROM users WHERE city = 'Seoul';
-- type: ALL

-- 인덱스 생성
CREATE INDEX idx_city ON users(city);

-- After: Index Scan
EXPLAIN SELECT * FROM users WHERE city = 'Seoul';
-- type: ref
```

---

## Q2. Join 전략의 종류와 차이는?

### 답변

**3가지 주요 Join 알고리즘**:

### 1. Nested Loop Join (중첩 루프)

**동작 원리**: 외부 테이블의 각 Row마다 내부 테이블을 스캔

```
for each row in table1:
    for each row in table2:
        if join_condition:
            return row
```

**예시**:

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age = 25;

-- Nested Loop Join 실행:
-- 1. users에서 age = 25인 Row 5,000건 가져옴
-- 2. 각 user마다 orders 테이블에서 user_id로 조회 (5,000번)
-- 3. 총 조인 연산: 5,000번
```

**실행 계획**:

```
Nested Loop  (cost=0..1000 rows=5000)
  -> Index Scan on users using idx_age  (cost=0..100 rows=5000)
        Index Cond: (age = 25)
  -> Index Scan on orders using idx_user_id  (cost=0..0.2 rows=1)
        Index Cond: (user_id = users.id)
```

**특징**:

| 항목 | 설명 |
|------|------|
| 적합한 경우 | 외부 테이블이 작고, 내부 테이블에 인덱스 있음 |
| 부적합한 경우 | 외부 테이블이 크고, 내부 테이블에 인덱스 없음 |
| 시간 복잡도 | O(N × M) (인덱스 없으면) |
| 메모리 | 적음 |

**성능**:

```sql
-- ✅ Nested Loop가 좋은 경우
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.id = 123;  -- 외부 테이블 Row 1개
-- → Nested Loop Join: 매우 빠름! ✅
-- → 1번만 조인

-- ❌ Nested Loop가 나쁜 경우
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.city = o.city;  -- 인덱스 없음
-- → Nested Loop Join: 매우 느림! ❌
-- → 100만 × 100만 = 1조 번 비교
```

### 2. Hash Join (해시 조인)

**동작 원리**: 작은 테이블로 해시 테이블을 만들고, 큰 테이블을 해시로 조회

```
1. Build Phase: 작은 테이블로 해시 테이블 생성
2. Probe Phase: 큰 테이블의 각 Row를 해시로 조회
```

**예시**:

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id;

-- Hash Join 실행:
-- 1. Build: users 테이블로 해시 테이블 생성 (id → name)
--    Hash Table: {123: "John", 456: "Jane", ...}
-- 2. Probe: orders 테이블을 스캔하며 해시 조회
--    order(user_id=123) → Hash[123] → "John"
```

**실행 계획**:

```
Hash Join  (cost=1000..5000 rows=100000)
  Hash Cond: (o.user_id = u.id)
  -> Seq Scan on orders o  (cost=0..3000 rows=100000)
  -> Hash  (cost=1000..1000 rows=10000)
        -> Seq Scan on users u  (cost=0..1000 rows=10000)
```

**특징**:

| 항목 | 설명 |
|------|------|
| 적합한 경우 | 큰 테이블 조인, 등호 조인 (=) |
| 부적합한 경우 | 메모리 부족, 범위 조인 (>, <) |
| 시간 복잡도 | O(N + M) |
| 메모리 | 많음 (해시 테이블) |

**성능**:

```sql
-- ✅ Hash Join이 좋은 경우
SELECT u.name, o.total
FROM users u  -- 10만 건
JOIN orders o ON u.id = o.user_id  -- 100만 건
-- → Hash Join: 빠름! ✅
-- → 시간: O(100,000 + 1,000,000) = 110만

-- ❌ Hash Join이 나쁜 경우 (메모리 부족)
SELECT u.name, o.total
FROM users u  -- 1억 건 (해시 테이블이 메모리 초과!)
JOIN orders o ON u.id = o.user_id
-- → Hash Join 시도 → 디스크 사용 → 느림! ⚠️
```

### 3. Merge Join (병합 조인)

**동작 원리**: 양쪽 테이블을 정렬한 후, 순차적으로 병합

```
1. Sort: 양쪽 테이블을 Join Key로 정렬
2. Merge: 정렬된 두 테이블을 병합
```

**예시**:

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
ORDER BY u.id;

-- Merge Join 실행:
-- 1. users를 id로 정렬: [1, 2, 3, ...]
-- 2. orders를 user_id로 정렬: [1, 1, 2, 3, ...]
-- 3. 두 테이블을 순차적으로 병합
```

**실행 계획**:

```
Merge Join  (cost=2000..5000 rows=100000)
  Merge Cond: (u.id = o.user_id)
  -> Sort  (cost=1000..1100 rows=10000)
        Sort Key: u.id
        -> Seq Scan on users u
  -> Sort  (cost=1000..1100 rows=100000)
        Sort Key: o.user_id
        -> Seq Scan on orders o
```

**특징**:

| 항목 | 설명 |
|------|------|
| 적합한 경우 | 이미 정렬된 데이터, ORDER BY 있음 |
| 부적합한 경우 | 정렬 비용 높음 |
| 시간 복잡도 | O(N log N + M log M) |
| 메모리 | 중간 (정렬 버퍼) |

**성능**:

```sql
-- ✅ Merge Join이 좋은 경우 (이미 정렬된 인덱스)
CREATE INDEX idx_id ON users(id);
CREATE INDEX idx_user_id ON orders(user_id);

SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
ORDER BY u.id;
-- → 정렬 불필요 (인덱스 사용)
-- → Merge Join: 매우 빠름! ✅
```

### Join 전략 비교

| Join Type | 외부 테이블 | 내부 인덱스 | 메모리 | 시간 복잡도 | 적합 |
|-----------|-------------|-------------|--------|-------------|------|
| Nested Loop | 작음 (수백) | 있음 ✅ | 적음 | O(N × log M) | OLTP |
| Hash Join | 큼 (수십만+) | 없음 ❌ | 많음 | O(N + M) | OLAP |
| Merge Join | 정렬됨 | 정렬됨 | 중간 | O(N + M) | 정렬 필요 |

### 꼬리 질문: Join 전략을 강제할 수 있나요?

**Hint 사용**:

```sql
-- MySQL
SELECT /*+ NO_HASH_JOIN(users, orders) */ u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id;
-- → Hash Join 비활성화

-- PostgreSQL
SET enable_hashjoin = off;
SET enable_mergejoin = off;
-- → Nested Loop만 사용

-- Oracle
SELECT /*+ USE_NL(u o) */ u.name, o.total
FROM users u, orders o
WHERE u.id = o.user_id;
-- → Nested Loop 강제
```

---

## Q3. N+1 문제란 무엇이고, 어떻게 해결하나요?

### 답변

**N+1 문제**는 **1번의 쿼리 결과마다 추가 쿼리가 N번 실행**되는 성능 문제입니다.

**문제 상황** (JPA/Hibernate 예시):

```java
// ❌ N+1 문제 발생
List<User> users = userRepository.findAll();  // 1번 쿼리

for (User user : users) {
    List<Order> orders = user.getOrders();    // N번 쿼리 (각 user마다)
    System.out.println(orders.size());
}

// 실행된 쿼리:
// 1. SELECT * FROM users;  (100명)
// 2. SELECT * FROM orders WHERE user_id = 1;
// 3. SELECT * FROM orders WHERE user_id = 2;
// ...
// 101. SELECT * FROM orders WHERE user_id = 100;
// → 총 101번 쿼리! ⚠️
```

**SQL 로그**:

```sql
-- 1번째 쿼리
SELECT * FROM users;
-- 100 rows

-- 2번째 쿼리
SELECT * FROM orders WHERE user_id = 1;
-- 10 rows

-- 3번째 쿼리
SELECT * FROM orders WHERE user_id = 2;
-- 5 rows

-- ...

-- 101번째 쿼리
SELECT * FROM orders WHERE user_id = 100;
-- 8 rows

-- → 총 101번 쿼리 실행 (DB 부하!)
```

### 해결 방법 1: Fetch Join (즉시 로딩)

```java
// ✅ Fetch Join 사용
@Query("SELECT u FROM User u JOIN FETCH u.orders")
List<User> findAllWithOrders();

List<User> users = userRepository.findAllWithOrders();  // 1번 쿼리

for (User user : users) {
    List<Order> orders = user.getOrders();  // 추가 쿼리 없음!
    System.out.println(orders.size());
}

// 실행된 쿼리:
// SELECT u.*, o.*
// FROM users u
// JOIN orders o ON u.id = o.user_id;
// → 총 1번 쿼리! ✅
```

**주의: Cartesian Product**:

```sql
-- ⚠️ 여러 컬렉션 JOIN 시 데이터 중복
SELECT u.*, o.*, r.*
FROM users u
JOIN orders o ON u.id = o.user_id      -- 10개
JOIN reviews r ON u.id = r.user_id;    -- 5개

-- 결과:
-- user1의 Row 수: 10 × 5 = 50개 (중복!) ⚠️
```

### 해결 방법 2: Batch Fetch (배치 로딩)

```java
// ✅ Batch Size 설정
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @BatchSize(size = 100)  // 100개씩 배치 로딩
    private List<Order> orders;
}

List<User> users = userRepository.findAll();  // 1번 쿼리

for (User user : users) {
    List<Order> orders = user.getOrders();    // 100명마다 1번 쿼리
    System.out.println(orders.size());
}

// 실행된 쿼리:
// 1. SELECT * FROM users;  (100명)
// 2. SELECT * FROM orders WHERE user_id IN (1, 2, ..., 100);  (100명 분)
// → 총 2번 쿼리! ✅
```

**SQL**:

```sql
-- 1번째 쿼리
SELECT * FROM users;

-- 2번째 쿼리 (IN 절로 배치 조회)
SELECT * FROM orders
WHERE user_id IN (1, 2, 3, ..., 100);
-- → 100명의 주문을 한 번에 가져옴
```

### 해결 방법 3: Subquery (서브쿼리)

```sql
-- ✅ Subquery로 집계
SELECT
    u.id,
    u.name,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;

-- → 1번 쿼리로 완료 ✅
-- → orders 테이블은 서브쿼리로 인덱스 사용
```

### 해결 방법 비교

| 방법 | 쿼리 수 | 메모리 | 중복 | 적합 |
|------|---------|--------|------|------|
| Fetch Join | 1번 | 많음 | 가능 ⚠️ | 1:N (단일 컬렉션) |
| Batch Fetch | N/100번 | 적음 | 없음 ✅ | 1:N (여러 컬렉션) |
| Subquery | 1번 | 적음 | 없음 ✅ | 집계만 필요 |

### 꼬리 질문: Lazy Loading vs Eager Loading은?

**Lazy Loading (지연 로딩)**:
- 실제 사용 시점에 쿼리 실행
- N+1 문제 발생 가능

**Eager Loading (즉시 로딩)**:
- 최초 조회 시 함께 로딩
- 불필요한 데이터도 로딩 가능

```java
// Lazy Loading (기본값)
@Entity
public class User {
    @OneToMany(fetch = FetchType.LAZY)  // 기본값
    private List<Order> orders;
}

User user = userRepository.findById(1);  // orders는 로딩 안 됨
user.getOrders().size();  // 이 시점에 쿼리 실행

// Eager Loading
@Entity
public class User {
    @OneToMany(fetch = FetchType.EAGER)
    private List<Order> orders;
}

User user = userRepository.findById(1);  // orders도 함께 로딩
// → 사용하지 않아도 항상 로딩 (비효율) ⚠️
```

**권장**:
- 기본: Lazy Loading
- 필요 시: Fetch Join으로 명시적 로딩

---

## Q4. 서브쿼리 최적화 방법은?

### 답변

**서브쿼리 성능 문제**는 주로 **Correlated Subquery (상관 서브쿼리)**에서 발생합니다.

### 문제 1: Correlated Subquery

```sql
-- ❌ Correlated Subquery (느림)
SELECT u.name,
       (SELECT COUNT(*)
        FROM orders o
        WHERE o.user_id = u.id) AS order_count
FROM users u;

-- 실행:
-- users의 각 Row마다 서브쿼리 실행 (N번)
-- → users 100만 건 → 서브쿼리 100만 번 실행! ⚠️
```

**해결 1: JOIN으로 변환**:

```sql
-- ✅ JOIN 사용 (빠름)
SELECT u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name;

-- 실행:
-- 1번의 JOIN + GROUP BY
-- → 훨씬 빠름! ✅
```

**성능 비교**:

| 방법 | 쿼리 실행 | 실행 시간 (100만 건) |
|------|-----------|---------------------|
| Correlated Subquery | 100만 번 | 300초 |
| JOIN | 1번 | 3초 |

### 문제 2: IN Subquery

```sql
-- ⚠️ IN Subquery (성능 주의)
SELECT *
FROM users
WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);

-- 실행 계획:
-- Subquery가 먼저 실행 → 결과를 IN 절로 비교
-- → orders 테이블 전체 스캔 가능 ⚠️
```

**해결 1: EXISTS 사용** (더 빠를 수 있음):

```sql
-- ✅ EXISTS 사용
SELECT *
FROM users u
WHERE EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.user_id = u.id
      AND o.total > 1000
);

-- 장점:
-- 1. 첫 번째 매칭되는 Row만 찾으면 중단 (Short-circuit)
-- 2. 인덱스 활용 가능
```

**해결 2: JOIN 사용**:

```sql
-- ✅ JOIN 사용
SELECT DISTINCT u.*
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.total > 1000;

-- 또는 (중복 제거 필요 없으면)
SELECT u.*
FROM users u
WHERE u.id IN (
    SELECT DISTINCT user_id
    FROM orders
    WHERE total > 1000
);
```

**IN vs EXISTS 비교**:

| 특징 | IN | EXISTS |
|------|-----|---------|
| Short-circuit | ❌ 전체 스캔 | ✅ 첫 매칭 시 중단 |
| NULL 처리 | NULL 무시 | NULL 무관 |
| 적합 | 서브쿼리 결과 작음 | 서브쿼리 결과 큼 |

### 문제 3: Scalar Subquery in SELECT

```sql
-- ❌ SELECT 절의 Scalar Subquery (느림)
SELECT
    u.id,
    u.name,
    (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS order_count,
    (SELECT SUM(total) FROM orders WHERE user_id = u.id) AS total_amount,
    (SELECT MAX(created_at) FROM orders WHERE user_id = u.id) AS last_order_date
FROM users u;

-- 문제:
-- 각 컬럼마다 서브쿼리 실행
-- → users 100만 건 × 3개 서브쿼리 = 300만 번 실행! ⚠️
```

**해결: 단일 JOIN + GROUP BY**:

```sql
-- ✅ JOIN으로 한 번에 집계
SELECT
    u.id,
    u.name,
    COUNT(o.id) AS order_count,
    SUM(o.total) AS total_amount,
    MAX(o.created_at) AS last_order_date
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name;

-- 성능:
-- 서브쿼리: 300만 번 실행 (300초)
-- JOIN: 1번 실행 (3초)
-- → 100배 빠름! ✅
```

### 꼬리 질문: WITH 절 (CTE)은 언제 사용하나요?

**CTE (Common Table Expression)**는 **복잡한 쿼리를 읽기 쉽게 분리**합니다.

```sql
-- ✅ WITH 절 사용
WITH high_value_users AS (
    SELECT user_id, SUM(total) AS total_amount
    FROM orders
    GROUP BY user_id
    HAVING SUM(total) > 10000
),
recent_orders AS (
    SELECT user_id, COUNT(*) AS order_count
    FROM orders
    WHERE created_at >= '2025-01-01'
    GROUP BY user_id
)
SELECT
    u.name,
    h.total_amount,
    r.order_count
FROM users u
JOIN high_value_users h ON u.id = h.user_id
LEFT JOIN recent_orders r ON u.id = r.user_id;

-- 장점:
-- 1. 가독성 향상
-- 2. 재사용 가능
-- 3. 디버깅 쉬움
```

**주의: CTE Materialization**:

```sql
-- PostgreSQL 12+: CTE는 기본적으로 Materialized (물리적 저장)
WITH temp AS (
    SELECT * FROM large_table WHERE ...
)
SELECT * FROM temp WHERE ...;
-- → temp 결과가 메모리/디스크에 저장됨

-- ✅ Inline으로 최적화 (PostgreSQL)
WITH temp AS NOT MATERIALIZED (
    SELECT * FROM large_table WHERE ...
)
SELECT * FROM temp WHERE ...;
-- → 서브쿼리처럼 최적화됨
```

---

## Q5. Slow Query 분석 및 최적화 사례는?

### 답변

**장애 사례: 주문 목록 조회 쿼리 30초 → 0.3초**

**증상**:
- 주문 목록 API 응답 시간 30초
- DB CPU 100%
- Slow Query Log 발생

**1단계: Slow Query 확인**:

```sql
-- MySQL Slow Query Log
-- Time: 30.5s
-- Rows examined: 5,000,000
SELECT
    o.id,
    o.total,
    u.name,
    u.email,
    (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
    (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS total_quantity
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'PENDING'
  AND o.created_at >= '2025-01-01'
ORDER BY o.created_at DESC
LIMIT 100;
```

**2단계: 실행 계획 분석**:

```sql
EXPLAIN ANALYZE SELECT ...;
```

**출력**:

```
Limit  (cost=50000..50100 rows=100)
  -> Sort  (cost=50000..55000 rows=1000000)  ← 정렬 비용 높음 ⚠️
        Sort Key: o.created_at DESC
        -> Hash Join  (cost=10000..40000 rows=1000000)
              Hash Cond: (o.user_id = u.id)
              -> Seq Scan on orders o  (cost=0..20000 rows=1000000)  ← Full Scan ⚠️
                    Filter: (status = 'PENDING' AND created_at >= '2025-01-01')
              -> Hash  (cost=5000..5000 rows=100000)
                    -> Seq Scan on users u
  SubPlan 1  ← Correlated Subquery 실행 100번 ⚠️
    -> Aggregate
          -> Seq Scan on order_items
                Filter: (order_id = o.id)
  SubPlan 2  ← Correlated Subquery 실행 100번 ⚠️
    -> Aggregate
          -> Seq Scan on order_items
                Filter: (order_id = o.id)
```

**문제점**:
1. orders 테이블 Full Scan (인덱스 없음)
2. Using filesort (정렬 비용 높음)
3. Correlated Subquery 200번 실행

**3단계: 최적화**:

```sql
-- ✅ 1. 인덱스 생성
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
-- → Full Scan 제거
-- → ORDER BY 인덱스 활용 (filesort 제거)

-- ✅ 2. Subquery를 JOIN으로 변환
SELECT
    o.id,
    o.total,
    u.name,
    u.email,
    COUNT(oi.id) AS item_count,
    SUM(oi.quantity) AS total_quantity
FROM orders o
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.status = 'PENDING'
  AND o.created_at >= '2025-01-01'
GROUP BY o.id, o.total, u.name, u.email
ORDER BY o.created_at DESC
LIMIT 100;
```

**4단계: 개선 후 실행 계획**:

```sql
EXPLAIN ANALYZE SELECT ...;
```

**출력**:

```
Limit  (cost=0..500 rows=100)
  -> Index Scan using idx_orders_status_created on orders o  ← Index Scan ✅
        Index Cond: (status = 'PENDING' AND created_at >= '2025-01-01')
        -> Hash Join
              Hash Cond: (o.user_id = u.id)
              -> Hash Join
                    Hash Cond: (oi.order_id = o.id)
                    -> Seq Scan on order_items oi
```

**성능 결과**:

| 항목 | Before | After | 개선율 |
|------|--------|-------|--------|
| 실행 시간 | 30.5초 | 0.3초 | 100배 |
| Rows Examined | 500만 건 | 5,000건 | 1,000배 |
| CPU 사용률 | 100% | 10% | 90% 감소 |

---

## 요약 체크리스트

### Execution Plan 읽기
- [ ] **type**: const > eq_ref > ref > range > index > ALL
- [ ] **key**: 실제 사용된 인덱스 확인
- [ ] **rows**: 예상 스캔 Row 수 (적을수록 좋음)
- [ ] **Extra**: Using index (좋음), Using filesort/temporary (나쁨)

### Join 전략
- [ ] **Nested Loop**: 외부 테이블 작고, 내부에 인덱스 있을 때
- [ ] **Hash Join**: 큰 테이블 조인, 등호 조건
- [ ] **Merge Join**: 이미 정렬된 데이터

### N+1 문제 해결
- [ ] **Fetch Join**: 1:N 관계, 단일 컬렉션
- [ ] **Batch Fetch**: 1:N 관계, 여러 컬렉션
- [ ] **Subquery**: 집계만 필요

### 서브쿼리 최적화
- [ ] **Correlated Subquery → JOIN**: 성능 크게 향상
- [ ] **IN → EXISTS**: 큰 결과 집합일 때 유리
- [ ] **SELECT 절 서브쿼리 → JOIN**: 한 번에 집계

### Slow Query 최적화
- [ ] **인덱스 추가**: 자주 사용되는 WHERE, JOIN 컬럼
- [ ] **실행 계획 분석**: EXPLAIN ANALYZE로 병목 지점 찾기
- [ ] **쿼리 재작성**: Subquery → JOIN, 불필요한 컬럼 제거
