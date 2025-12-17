---
title: "인덱스 기본: B-Tree/복합 인덱스/쿼리 최적화 감각"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["Database", "Index", "B-Tree", "Query Optimization", "Performance"]
categories: ["Backend Deep Dive"]
description: "인덱스가 왜 빨라지는지(B-Tree/선택도/커버링), 복합 인덱스 설계와 쿼리 튜닝의 기본 감각"
module: "data-system"
study_order: 203
---

## 이 글에서 얻는 것

- 인덱스를 “붙이면 빨라진다”가 아니라, **왜 빨라지는지(탐색 범위/정렬/랜덤 I/O)** 설명할 수 있습니다.
- B-Tree 기반 인덱스의 동작(= / range / 정렬)과, 복합 인덱스에서 순서가 왜 중요한지 감각이 생깁니다.
- 커버링 인덱스, 선택도(selectivity), 인덱스 과다로 인한 쓰기 비용 같은 트레이드오프를 이해합니다.

## 0) 인덱스는 ‘정렬된 길’이고, 비용도 함께 온다

인덱스는 조회를 빠르게 하지만, 그만큼 **쓰기(insert/update/delete)** 와 저장 공간 비용이 늘어납니다.
그래서 “쿼리 패턴이 먼저”이고, 인덱스는 그 결과물입니다.

## 1. 인덱스 기초 개념

### 1.1 인덱스란?

```
인덱스 없이 조회:
┌──────────────────────────────────┐
│ Table Scan (Full Scan)            │
├──────────────────────────────────┤
│ id │ name    │ age │ city        │
├──────────────────────────────────┤
│ 1  │ Alice   │ 25  │ Seoul   ✓  │
│ 2  │ Bob     │ 30  │ Busan   ✓  │
│ 3  │ Charlie │ 28  │ Seoul   ✓  │
│ 4  │ David   │ 35  │ Seoul   ✓  │
│ ...                               │
│ 1M │ Zoe     │ 22  │ Seoul   ✓  │
└──────────────────────────────────┘
조회: SELECT * FROM users WHERE city = 'Seoul';
스캔: 1,000,000 rows (전체)

인덱스 사용:
┌──────────────────────┐
│ Index on city        │
├──────────────────────┤
│ Busan → [2, 100, ...]│
│ Seoul → [1, 3, 4, ...]│ ✓
│ ...                  │
└──────────────────────┘
        ↓
┌──────────────────────┐
│ Data Rows            │
├──────────────────────┤
│ 1  │ Alice   │ 25  │
│ 3  │ Charlie │ 28  │
│ 4  │ David   │ 35  │
└──────────────────────┘
조회: SELECT * FROM users WHERE city = 'Seoul';
스캔: 300,000 rows (30%)
성능 향상: 약 3배
```

### 1.2 인덱스의 장단점

**장점:**
- 조회 성능 대폭 향상 (O(n) → O(log n))
- 정렬(ORDER BY), 그룹핑(GROUP BY) 최적화
- 조인(JOIN) 성능 개선

**단점:**
- 추가 저장 공간 필요 (인덱스 크기 = 데이터의 10~20%)
- INSERT, UPDATE, DELETE 성능 저하 (인덱스도 함께 갱신)
- 잘못된 인덱스는 오히려 성능 악화

**사용 기준:**
```sql
-- ✅ 인덱스 적합:
-- - 대량의 데이터 (수만 행 이상)
-- - 높은 선택도 (Selectivity) - 고유한 값이 많음
-- - WHERE, JOIN, ORDER BY에 자주 사용되는 컬럼
SELECT * FROM orders WHERE customer_id = 12345;

-- ❌ 인덱스 부적합:
-- - 소량의 데이터 (수천 행 이하)
-- - 낮은 선택도 - 고유 값이 적음 (예: 성별, 불린)
-- - 자주 변경되는 컬럼
SELECT * FROM users WHERE is_active = true;  -- 50% 이상이 true면 비효율
```

---

## 2. B-Tree 인덱스 구조

### 2.1 B-Tree 동작 원리

```
B-Tree 구조 (3단계):

                  Root Node
                 ┌──────────┐
                 │ 50 │ 100 │
                 └──┬───┬───┘
                    │   │
         ┌──────────┘   └──────────┐
         ↓                          ↓
    Branch Node              Branch Node
   ┌──────────┐              ┌──────────┐
   │ 20 │ 35 │              │ 75 │ 90 │
   └──┬───┬───┘              └──┬───┬───┘
      │   │                     │   │
  ┌───┘   └───┐             ┌───┘   └───┐
  ↓           ↓             ↓           ↓
Leaf         Leaf         Leaf         Leaf
┌──────┐   ┌──────┐     ┌──────┐     ┌──────┐
│ 5,10 │   │25,30 │     │60,70 │     │85,95 │
│ 12,15│   │38,42 │     │72,74 │     │92,98 │
└──────┘   └──────┘     └──────┘     └──────┘
   ↓          ↓            ↓            ↓
(실제 데이터 행 참조)

조회 예시: SELECT * FROM users WHERE id = 72;
1. Root Node: 72 > 50 → 오른쪽
2. Branch Node: 72 < 75 → 왼쪽
3. Leaf Node: 72 찾음
4. 실제 데이터 행 읽기

시간 복잡도: O(log n)
높이 3인 B-Tree: 최대 100만 개 키 저장 가능
```

### 2.2 B-Tree 특징

**1. Balanced Tree (균형 트리)**
- 모든 Leaf Node의 깊이가 동일
- 삽입/삭제 시 자동으로 재균형화
- 항상 O(log n) 성능 보장

**2. 범위 검색 최적화**
```sql
-- Leaf Node가 연결 리스트 구조
SELECT * FROM orders WHERE order_date BETWEEN '2025-01-01' AND '2025-01-31';

-- B-Tree 탐색:
1. '2025-01-01' 시작 위치 찾기 (O(log n))
2. Leaf Node를 순차 탐색 (O(k), k = 결과 수)
```

**3. 정렬 상태 유지**
```sql
-- ORDER BY 절에 인덱스 활용
SELECT * FROM users ORDER BY created_at DESC LIMIT 10;

-- 인덱스가 이미 정렬되어 있어서 추가 정렬 불필요
```

---

## 3. 인덱스 종류

### 3.1 Clustered Index (클러스터드 인덱스)

```
Clustered Index:
- 테이블 데이터가 인덱스 순서로 물리적으로 정렬됨
- 테이블당 1개만 존재 (PK)
- Leaf Node에 실제 데이터 저장

┌────────────────────────────────┐
│ Clustered Index (PK: id)       │
├────────────────────────────────┤
│ id │ name    │ email         │
├────────────────────────────────┤
│ 1  │ Alice   │ a@example.com │
│ 2  │ Bob     │ b@example.com │
│ 3  │ Charlie │ c@example.com │
│ ...                            │
└────────────────────────────────┘

장점:
- PK 조회 매우 빠름 (데이터가 바로 있음)
- 범위 검색 효율적 (순차 접근)

단점:
- 삽입 시 물리적 재정렬 필요 (느림)
- PK 변경 시 전체 재구성
```

**MySQL InnoDB:**
```sql
-- InnoDB는 항상 Clustered Index 사용
CREATE TABLE users (
    id BIGINT PRIMARY KEY,      -- Clustered Index (자동)
    email VARCHAR(255) UNIQUE,  -- Non-Clustered Index
    name VARCHAR(100)
);

-- PK가 없으면 첫 번째 UNIQUE NOT NULL 컬럼 사용
-- 그것도 없으면 숨겨진 ROW_ID 사용
```

### 3.2 Non-Clustered Index (보조 인덱스)

```
Non-Clustered Index:
- 인덱스와 데이터가 물리적으로 분리
- 테이블당 여러 개 가능
- Leaf Node에 PK 저장 (InnoDB)

Index on email:
┌──────────────────────┐
│ email        │ PK(id)│
├──────────────────────┤
│ a@example.com│   1   │
│ b@example.com│   2   │
│ c@example.com│   3   │
└──────────────────────┘
         ↓ (PK로 Clustered Index 조회)
┌────────────────────────────────┐
│ id │ name    │ email         │
├────────────────────────────────┤
│ 1  │ Alice   │ a@example.com │
└────────────────────────────────┘

조회 과정:
1. Non-Clustered Index에서 PK 찾기
2. PK로 Clustered Index에서 실제 데이터 찾기 (Bookmark Lookup)
```

```sql
-- Non-Clustered Index 생성
CREATE INDEX idx_email ON users(email);
CREATE INDEX idx_name_age ON users(name, age);  -- 복합 인덱스
```

### 3.3 Unique Index

```sql
-- UNIQUE 제약 조건은 자동으로 인덱스 생성
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(255) UNIQUE,  -- Unique Index 자동 생성
    phone VARCHAR(20)
);

-- 명시적 Unique Index 생성
CREATE UNIQUE INDEX idx_phone ON users(phone);

-- 중복 값 삽입 시 에러
INSERT INTO users (id, email) VALUES (1, 'a@example.com');
INSERT INTO users (id, email) VALUES (2, 'a@example.com');  -- ERROR: Duplicate entry
```

### 3.4 Composite Index (복합 인덱스)

```sql
-- 여러 컬럼을 하나의 인덱스로 구성
CREATE INDEX idx_name_age_city ON users(name, age, city);

-- 인덱스 구조 (Leftmost Prefix Rule)
┌─────────────────────────────────┐
│ name    │ age │ city   │ PK(id)│
├─────────────────────────────────┤
│ Alice   │ 25  │ Seoul  │   1   │
│ Alice   │ 28  │ Busan  │   5   │
│ Bob     │ 30  │ Seoul  │   2   │
│ Charlie │ 28  │ Seoul  │   3   │
└─────────────────────────────────┘

✅ 인덱스 사용 가능:
SELECT * FROM users WHERE name = 'Alice';
SELECT * FROM users WHERE name = 'Alice' AND age = 25;
SELECT * FROM users WHERE name = 'Alice' AND age = 25 AND city = 'Seoul';

❌ 인덱스 사용 불가:
SELECT * FROM users WHERE age = 25;  -- name이 없음
SELECT * FROM users WHERE city = 'Seoul';  -- name, age가 없음

⚠️ 일부 사용:
SELECT * FROM users WHERE name = 'Alice' AND city = 'Seoul';
-- name만 인덱스 사용, city는 필터링
```

**복합 인덱스 순서 선택 기준:**
1. **선택도가 높은 컬럼** (고유 값이 많은 컬럼)
2. **자주 사용되는 컬럼**
3. **WHERE 절에 등장하는 순서**

```sql
-- 예시: 주문 테이블
CREATE INDEX idx_customer_date ON orders(customer_id, order_date);

-- customer_id: 10,000 고유 값
-- order_date: 365 고유 값
-- → customer_id를 앞에 배치 (선택도 높음)

-- 자주 사용되는 쿼리:
SELECT * FROM orders WHERE customer_id = 123 AND order_date >= '2025-01-01';
-- ✅ 인덱스 활용
```

### 3.5 Covering Index (커버링 인덱스)

```sql
-- 쿼리에 필요한 모든 컬럼을 인덱스에 포함
CREATE INDEX idx_name_email ON users(name, email);

-- ✅ Covering Index (인덱스만으로 쿼리 완료)
SELECT name, email FROM users WHERE name = 'Alice';
-- Leaf Node에 name, email이 모두 있어서 실제 데이터 접근 불필요

-- ❌ Non-Covering (실제 데이터 접근 필요)
SELECT name, email, age FROM users WHERE name = 'Alice';
-- age는 인덱스에 없어서 Bookmark Lookup 발생
```

**성능 비교:**

```sql
-- Covering Index
EXPLAIN SELECT name, email FROM users WHERE name = 'Alice';

-- Extra: Using index
-- 인덱스만 읽음 (빠름)

-- Non-Covering
EXPLAIN SELECT name, email, age FROM users WHERE name = 'Alice';

-- Extra: Using where
-- 인덱스 + 테이블 읽음 (느림)
```

---

## 4. 인덱스 설계 전략

### 4.1 WHERE 절 최적화

```sql
-- ✅ 인덱스 사용
SELECT * FROM orders WHERE customer_id = 12345;
CREATE INDEX idx_customer_id ON orders(customer_id);

-- ✅ 범위 검색
SELECT * FROM orders WHERE order_date BETWEEN '2025-01-01' AND '2025-01-31';
CREATE INDEX idx_order_date ON orders(order_date);

-- ❌ 함수 사용 시 인덱스 무효화
SELECT * FROM orders WHERE DATE(order_date) = '2025-01-01';
-- → 인덱스 사용 안 됨 (order_date에 함수 적용)

-- ✅ 수정: 범위 조건으로 변경
SELECT * FROM orders
WHERE order_date >= '2025-01-01 00:00:00'
  AND order_date < '2025-01-02 00:00:00';
```

```sql
-- ❌ LIKE '%keyword%' (인덱스 무효화)
SELECT * FROM products WHERE name LIKE '%phone%';

-- ✅ LIKE 'keyword%' (인덱스 사용)
SELECT * FROM products WHERE name LIKE 'phone%';

-- Full-Text Search가 필요한 경우:
CREATE FULLTEXT INDEX idx_name ON products(name);
SELECT * FROM products WHERE MATCH(name) AGAINST('phone');
```

### 4.2 JOIN 최적화

```sql
-- ✅ JOIN 컬럼에 인덱스
CREATE INDEX idx_customer_id ON orders(customer_id);
CREATE INDEX idx_product_id ON order_items(product_id);

SELECT o.id, c.name, p.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON oi.product_id = p.id
WHERE o.order_date >= '2025-01-01';

-- 인덱스 전략:
1. orders.order_date (WHERE 절)
2. orders.customer_id (JOIN)
3. order_items.order_id (JOIN)
4. order_items.product_id (JOIN)
```

### 4.3 ORDER BY 최적화

```sql
-- ✅ 인덱스 활용 정렬
CREATE INDEX idx_created_at ON posts(created_at DESC);

SELECT * FROM posts ORDER BY created_at DESC LIMIT 10;
-- Extra: Using index (정렬 불필요)

-- ❌ 인덱스와 정렬 방향 불일치
SELECT * FROM posts ORDER BY created_at ASC;
-- Extra: Using filesort (정렬 발생)

-- ✅ 복합 인덱스 정렬
CREATE INDEX idx_user_date ON posts(user_id, created_at DESC);

SELECT * FROM posts WHERE user_id = 123 ORDER BY created_at DESC LIMIT 10;
-- ✅ 인덱스 활용
```

### 4.4 카디널리티와 선택도

```
카디널리티 (Cardinality):
- 컬럼의 고유한 값의 개수

선택도 (Selectivity):
- 고유 값 / 전체 행 수
- 0.0 ~ 1.0 (1.0에 가까울수록 좋음)

예시:
users 테이블 (1,000,000 rows)

┌─────────────┬──────────────┬─────────────┐
│ 컬럼         │ 카디널리티    │ 선택도       │
├─────────────┼──────────────┼─────────────┤
│ id (PK)     │ 1,000,000    │ 1.0 (최고)  │
│ email       │ 1,000,000    │ 1.0 (최고)  │
│ phone       │ 950,000      │ 0.95        │
│ name        │ 50,000       │ 0.05        │
│ age         │ 100          │ 0.0001      │
│ gender      │ 2            │ 0.000002    │
│ is_active   │ 2            │ 0.000002    │
└─────────────┴──────────────┴─────────────┘

인덱스 생성 권장:
✅ id, email, phone (선택도 높음)
⚠️ name (중간)
❌ age, gender, is_active (선택도 낮음)
```

```sql
-- 카디널리티 확인
SELECT COUNT(DISTINCT column_name) AS cardinality,
       COUNT(*) AS total_rows,
       COUNT(DISTINCT column_name) / COUNT(*) AS selectivity
FROM table_name;

-- 예시:
SELECT COUNT(DISTINCT email) AS cardinality,
       COUNT(*) AS total_rows,
       COUNT(DISTINCT email) / COUNT(*) AS selectivity
FROM users;

-- 결과:
-- cardinality: 1,000,000
-- total_rows: 1,000,000
-- selectivity: 1.0000
```

---

## 5. EXPLAIN으로 실행 계획 분석

### 5.1 EXPLAIN 기본 사용법

```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 12345;

-- 출력 결과:
+----+-------------+--------+------+------------------+---------+---------+-------+------+-------+
| id | select_type | table  | type | possible_keys    | key     | key_len | ref   | rows | Extra |
+----+-------------+--------+------+------------------+---------+---------+-------+------+-------+
|  1 | SIMPLE      | orders | ref  | idx_customer_id  | idx_... | 8       | const |   10 | NULL  |
+----+-------------+--------+------+------------------+---------+---------+-------+------+-------+

주요 컬럼:
- type: 조인 타입 (성능 지표)
- key: 실제 사용된 인덱스
- rows: 예상 스캔 행 수
- Extra: 추가 정보
```

### 5.2 type 컬럼 (조인 타입)

```
성능 순서 (빠름 → 느림):

system > const > eq_ref > ref > range > index > ALL

┌──────────┬──────────────────────────────────────┐
│ Type     │ 설명                                  │
├──────────┼──────────────────────────────────────┤
│ system   │ 테이블에 행이 1개 (시스템 테이블)       │
│ const    │ PK나 UNIQUE 인덱스로 1개 행 조회      │
│ eq_ref   │ JOIN에서 PK나 UNIQUE로 1개 행 매칭    │
│ ref      │ Non-Unique 인덱스로 여러 행 조회       │
│ range    │ 인덱스 범위 스캔 (BETWEEN, >, <)      │
│ index    │ 인덱스 전체 스캔                       │
│ ALL      │ 테이블 전체 스캔 (최악)                │
└──────────┴──────────────────────────────────────┘
```

**예시:**

```sql
-- const (최고 성능)
EXPLAIN SELECT * FROM users WHERE id = 1;
-- type: const (PK로 정확히 1개 행)

-- ref (좋음)
EXPLAIN SELECT * FROM orders WHERE customer_id = 12345;
-- type: ref (Non-Unique 인덱스로 여러 행)

-- range (보통)
EXPLAIN SELECT * FROM orders WHERE order_date BETWEEN '2025-01-01' AND '2025-01-31';
-- type: range (범위 스캔)

-- ALL (최악)
EXPLAIN SELECT * FROM users WHERE age > 25;
-- type: ALL (인덱스 없으면 전체 스캔)
```

### 5.3 Extra 컬럼

```sql
-- ✅ Using index (최고)
EXPLAIN SELECT name FROM users WHERE name = 'Alice';
-- Covering Index: 인덱스만 읽음

-- ✅ Using where (좋음)
EXPLAIN SELECT * FROM users WHERE name = 'Alice';
-- 인덱스 사용 후 WHERE 필터링

-- ⚠️ Using filesort (주의)
EXPLAIN SELECT * FROM users ORDER BY age;
-- 정렬 발생 (인덱스 없음)

-- ⚠️ Using temporary (주의)
EXPLAIN SELECT name, COUNT(*) FROM users GROUP BY name;
-- 임시 테이블 생성

-- ❌ Using where; Using filesort (나쁨)
EXPLAIN SELECT * FROM orders WHERE customer_id = 123 ORDER BY amount;
-- 필터링 후 정렬 (인덱스 필요)
```

### 5.4 실전 분석 예시

```sql
-- ❌ 성능 문제 쿼리
EXPLAIN SELECT o.id, o.total_amount, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'PENDING'
  AND o.order_date >= '2025-01-01'
ORDER BY o.total_amount DESC
LIMIT 10;

-- 실행 계획 (Before):
+----+-------------+-------+------+---------+------+---------+------+--------+-----------------------------+
| id | select_type | table | type | key     | ref  | key_len | ref  | rows   | Extra                       |
+----+-------------+-------+------+---------+------+---------+------+--------+-----------------------------+
|  1 | SIMPLE      | o     | ALL  | NULL    | NULL | NULL    | NULL | 500000 | Using where; Using filesort |
|  1 | SIMPLE      | c     | ref  | PRIMARY | o... | 8       | ...  |      1 | NULL                        |
+----+-------------+-------+------+---------+------+---------+------+--------+-----------------------------+

문제:
1. orders 테이블: type = ALL (전체 스캔)
2. Extra: Using filesort (정렬 발생)
3. rows: 500,000 (너무 많음)

-- ✅ 인덱스 추가
CREATE INDEX idx_status_date_amount ON orders(status, order_date, total_amount DESC);

-- 실행 계획 (After):
+----+-------------+-------+-------+-------------------------+--------+---------+------+------+--------------+
| id | select_type | table | type  | key                     | ref    | key_len | ref  | rows | Extra        |
+----+-------------+-------+-------+-------------------------+--------+---------+------+------+--------------+
|  1 | SIMPLE      | o     | range | idx_status_date_amount  | NULL   | 13      | NULL |  100 | Using where  |
|  1 | SIMPLE      | c     | ref   | PRIMARY                 | o...   | 8       | ...  |    1 | NULL         |
+----+-------------+-------+-------+-------------------------+--------+---------+------+------+--------------+

개선:
1. type: ALL → range (인덱스 범위 스캔)
2. Extra: Using filesort 제거 (인덱스 정렬)
3. rows: 500,000 → 100 (5,000배 감소)

성능: 3.5초 → 0.02초 (175배 향상)
```

---

## 6. 실전 쿼리 최적화 사례

### 사례 #1: 페이징 쿼리 최적화

```sql
-- ❌ OFFSET이 큰 경우 느림
SELECT * FROM posts ORDER BY created_at DESC LIMIT 100 OFFSET 100000;

-- OFFSET 100000:
-- 1. 100,000개 행 스캔
-- 2. 100,000개 행 버림
-- 3. 100개 행 반환
-- 비효율적!

-- ✅ 커서 기반 페이징 (Seek Method)
SELECT * FROM posts
WHERE created_at < '2025-01-15 10:00:00'  -- 이전 페이지의 마지막 created_at
ORDER BY created_at DESC
LIMIT 100;

-- 인덱스:
CREATE INDEX idx_created_at ON posts(created_at DESC);

-- 성능 비교:
-- OFFSET 100000: 2.5초
-- 커서 기반: 0.01초 (250배 빠름)
```

### 사례 #2: COUNT(*) 최적화

```sql
-- ❌ 전체 COUNT (느림)
SELECT COUNT(*) FROM orders WHERE customer_id = 12345;

-- 대량 데이터에서 COUNT(*)는 전체 스캔 필요

-- ✅ 해결책 1: 근사치 사용
SELECT table_rows
FROM information_schema.tables
WHERE table_name = 'orders';

-- ✅ 해결책 2: 캐싱
-- Redis에 count 저장, 주기적 갱신

-- ✅ 해결책 3: 분리된 카운터 테이블
CREATE TABLE customer_order_counts (
    customer_id BIGINT PRIMARY KEY,
    order_count INT DEFAULT 0
);

-- 주문 생성 시 카운터 증가 (트랜잭션)
BEGIN;
INSERT INTO orders (...) VALUES (...);
INSERT INTO customer_order_counts (customer_id, order_count) VALUES (12345, 1)
    ON DUPLICATE KEY UPDATE order_count = order_count + 1;
COMMIT;
```

### 사례 #3: Subquery vs JOIN

```sql
-- ❌ Subquery (느림)
SELECT *
FROM products
WHERE category_id IN (
    SELECT id FROM categories WHERE is_active = true
);

-- Subquery는 외부 쿼리마다 실행될 수 있음 (Dependent Subquery)

-- ✅ JOIN으로 변환
SELECT p.*
FROM products p
JOIN categories c ON p.category_id = c.id
WHERE c.is_active = true;

-- 또는 EXISTS 사용
SELECT *
FROM products p
WHERE EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = p.category_id AND c.is_active = true
);

-- 성능 비교:
-- Subquery: 1.2초
-- JOIN: 0.05초 (24배 빠름)
```

### 사례 #4: OR 조건 최적화

```sql
-- ❌ OR 조건 (인덱스 비효율)
SELECT * FROM users WHERE name = 'Alice' OR email = 'alice@example.com';

-- 인덱스: idx_name, idx_email
-- → 두 인덱스 모두 스캔 후 UNION (비효율)

-- ✅ UNION ALL로 분리
SELECT * FROM users WHERE name = 'Alice'
UNION ALL
SELECT * FROM users WHERE email = 'alice@example.com' AND name != 'Alice';

-- 각 쿼리가 독립적인 인덱스 사용

-- ✅ 또는 복합 인덱스
CREATE INDEX idx_name_email ON users(name, email);
```

---

## 7. 인덱스 모니터링 & 관리

### 7.1 사용되지 않는 인덱스 찾기

```sql
-- MySQL 8.0+
SELECT
    object_schema AS database_name,
    object_name AS table_name,
    index_name,
    COUNT_READ,
    COUNT_FETCH
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE index_name IS NOT NULL
  AND COUNT_READ = 0
  AND COUNT_FETCH = 0
ORDER BY object_schema, object_name;

-- 사용되지 않는 인덱스 삭제
DROP INDEX unused_index ON table_name;
```

### 7.2 중복 인덱스 찾기

```sql
-- 중복 인덱스 예시:
CREATE INDEX idx_name ON users(name);
CREATE INDEX idx_name_age ON users(name, age);

-- idx_name은 idx_name_age와 중복
-- (name만 검색할 때 idx_name_age도 사용 가능)

-- 중복 인덱스 조회:
SELECT
    table_name,
    GROUP_CONCAT(index_name) AS duplicate_indexes
FROM information_schema.statistics
WHERE table_schema = 'your_database'
GROUP BY table_name, column_name
HAVING COUNT(*) > 1;
```

### 7.3 인덱스 재구성 (Rebuild)

```sql
-- 인덱스 조각화 확인
SHOW TABLE STATUS LIKE 'orders';

-- Data_free가 크면 조각화됨

-- 테이블 최적화 (인덱스 재구성)
OPTIMIZE TABLE orders;

-- 또는 테이블 재생성
ALTER TABLE orders ENGINE=InnoDB;
```

### 7.4 슬로우 쿼리 로그 분석

```sql
-- my.cnf 설정
[mysqld]
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1  # 1초 이상 쿼리 기록

-- 슬로우 쿼리 분석 도구
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log

-- 출력:
Count: 1250  Time=3.50s (4375s)  Lock=0.00s (0s)  Rows=100.0 (125000)
  SELECT * FROM orders WHERE status = 'S' ORDER BY created_at DESC LIMIT N;

-- 해결책: status, created_at에 복합 인덱스 생성
```

---

## 8. 인덱스 설계 루틴(실무용)

### 설계 전 확인사항

**1) 데이터/쿼리부터 본다**

- 테이블 크기(대략 규모) 파악
- 컬럼 카디널리티/분포 파악(고유 값 비율)
- 자주 쓰는 쿼리 패턴 수집(WHERE/JOIN/ORDER BY)

**2) 인덱스 후보 선정**

- WHERE 절에 자주 등장하는 컬럼
- JOIN 키 컬럼
- ORDER BY/GROUP BY 컬럼
- 외래 키(특히 조인 빈도가 높다면)

**3) 복합 인덱스 순서**

- 선택도 높은 컬럼을 앞쪽에 두되, 실제 쿼리 패턴(= / range / ORDER BY)에 맞춘다
- 등호(=) 조건 → 범위 조건 순서(일반적인 출발점)
- 커버링 인덱스로 테이블 접근을 줄일 수 있는지 고려

**4) 성능 검증**

- EXPLAIN으로 실행 계획 확인(type/key/rows/extra)
- `Using filesort`, `Using temporary` 같은 위험 신호를 해석
- 실제 실행 시간(동일 데이터/부하 조건)으로 비교

**5) 유지보수**

- 사용되지 않는/중복 인덱스를 정기적으로 정리
- 슬로우 쿼리 로그/지표로 “새 쿼리 패턴”을 반영

---

## 요약: 스스로 점검할 것

- B-Tree 인덱스가 왜 빠른지(탐색 범위/정렬) 설명할 수 있다
- Clustered vs Secondary 인덱스 차이를 알고, “테이블 접근 비용”을 감각적으로 이해한다
- 복합 인덱스에서 leftmost prefix 규칙과 컬럼 순서 선택 기준이 있다
- EXPLAIN으로 계획을 읽고, 위험 신호(정렬/임시 테이블)를 해석할 수 있다
- 커서 기반 페이징 같은 “인덱스 친화적 조회”를 설계할 수 있다

---

## 마무리

인덱스는 데이터베이스 성능을 좌우하는 핵심 요소입니다. B-Tree 구조를 이해하고, EXPLAIN으로 실행 계획을 분석하며, 실전 쿼리 최적화 경험을 쌓아보세요!

**핵심 요약:**
1. **B-Tree** - 균형 트리 구조로 O(log n) 성능 보장
2. **복합 인덱스** - Leftmost Prefix Rule, 선택도 높은 컬럼 우선
3. **Covering Index** - 쿼리에 필요한 모든 컬럼 포함
4. **EXPLAIN** - type(const>ref>range), Extra 분석
5. **최적화** - 페이징(커서), COUNT(캐싱), OR→UNION

**다음 단계:**
- Redis 캐싱 전략 실전 학습
- 실전 프로젝트에 인덱스 최적화 적용
- 대용량 데이터 처리 경험 쌓기

다음으로는 `EXPLAIN` 중심의 실전 튜닝 글(예: MySQL 실행 계획/슬로우 쿼리)로 넘어가면 이해가 더 빠릅니다.
