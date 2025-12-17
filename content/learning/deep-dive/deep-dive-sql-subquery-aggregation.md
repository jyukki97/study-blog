---
title: "SQL 서브쿼리와 집계함수: GROUP BY, HAVING, 윈도우 함수 마스터"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["SQL", "Subquery", "GROUP BY", "HAVING", "Window Function", "Aggregation"]
categories: ["Backend Deep Dive"]
description: "서브쿼리, GROUP BY/HAVING 집계, 윈도우 함수로 복잡한 데이터 분석 쿼리 작성"
module: "data-system"
study_order: 201
---

## 이 글에서 얻는 것

- **서브쿼리**(스칼라/인라인뷰/중첩)로 복잡한 조회를 단순화합니다.
- **GROUP BY와 집계함수**(COUNT/SUM/AVG)로 데이터를 요약합니다.
- **HAVING**으로 그룹 조건을 필터링합니다.
- **윈도우 함수**로 랭킹, 누적 합계 같은 고급 분석을 수행합니다.

## 1) 서브쿼리 (Subquery)

### 1-1) 스칼라 서브쿼리 (단일 값 반환)

```sql
-- SELECT 절에 사용
SELECT
    u.name,
    u.email,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;

-- 결과:
-- name     | email            | order_count
-- Alice    | alice@...        | 5
-- Bob      | bob@...          | 3

-- WHERE 절에 사용
SELECT * FROM products
WHERE price > (SELECT AVG(price) FROM products);
-- 평균 가격보다 비싼 상품

-- SET 절에 사용 (UPDATE)
UPDATE users
SET last_order_date = (
    SELECT MAX(created_at) FROM orders WHERE user_id = users.id
)
WHERE EXISTS (SELECT 1 FROM orders WHERE user_id = users.id);
```

### 1-2) 다중 행 서브쿼리 (IN, ANY, ALL)

```sql
-- IN: 서브쿼리 결과 중 하나와 일치
SELECT * FROM users
WHERE id IN (
    SELECT user_id FROM orders WHERE amount > 10000
);
-- 고액 주문을 한 사용자

-- NOT IN
SELECT * FROM products
WHERE id NOT IN (
    SELECT product_id FROM order_items
);
-- 한 번도 주문되지 않은 상품

-- ANY/SOME: 하나라도 만족
SELECT * FROM products
WHERE price > ANY (
    SELECT price FROM products WHERE category = 'Electronics'
);
-- Electronics 카테고리의 어떤 상품보다 비싼 상품

-- ALL: 모두 만족
SELECT * FROM products
WHERE price > ALL (
    SELECT price FROM products WHERE category = 'Books'
);
-- Books 카테고리의 모든 상품보다 비싼 상품
```

### 1-3) 인라인 뷰 (FROM 절 서브쿼리)

```sql
-- FROM 절에 서브쿼리 (임시 테이블처럼 사용)
SELECT
    category,
    AVG(price) AS avg_price
FROM (
    SELECT
        category,
        price
    FROM products
    WHERE status = 'ACTIVE'
) AS active_products
GROUP BY category;

-- 복잡한 집계 후 추가 필터
SELECT * FROM (
    SELECT
        user_id,
        COUNT(*) AS order_count,
        SUM(amount) AS total_amount
    FROM orders
    GROUP BY user_id
) AS user_orders
WHERE total_amount > 100000;
-- 총 주문 금액이 10만원 이상인 사용자
```

### 1-4) 상관 서브쿼리 (Correlated Subquery)

```sql
-- 외부 쿼리의 각 행마다 서브쿼리 실행
SELECT
    u.name,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;

-- EXISTS: 존재 여부 확인 (성능 좋음)
SELECT * FROM users u
WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'PENDING'
);
-- 대기 중인 주문이 있는 사용자

-- NOT EXISTS
SELECT * FROM products p
WHERE NOT EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.product_id = p.id
);
-- 주문되지 않은 상품
```

## 2) 집계 함수 (Aggregate Functions)

### 2-1) 기본 집계 함수

```sql
-- COUNT: 개수
SELECT COUNT(*) FROM orders;                  -- 전체 행 수
SELECT COUNT(DISTINCT user_id) FROM orders;   -- 고유 사용자 수
SELECT COUNT(status) FROM orders;             -- status가 NULL이 아닌 행 수

-- SUM: 합계
SELECT SUM(amount) FROM orders;
SELECT SUM(amount) FROM orders WHERE status = 'COMPLETED';

-- AVG: 평균
SELECT AVG(amount) FROM orders;
SELECT AVG(price) FROM products WHERE category = 'Electronics';

-- MIN/MAX: 최솟값/최댓값
SELECT MIN(price), MAX(price) FROM products;
SELECT MIN(created_at), MAX(created_at) FROM orders;

-- 여러 집계 함수 동시 사용
SELECT
    COUNT(*) AS total_orders,
    SUM(amount) AS total_revenue,
    AVG(amount) AS avg_order_value,
    MIN(amount) AS min_order,
    MAX(amount) AS max_order
FROM orders
WHERE status = 'COMPLETED';
```

### 2-2) GROUP BY: 그룹별 집계

```sql
-- 카테고리별 상품 수
SELECT
    category,
    COUNT(*) AS product_count
FROM products
GROUP BY category;

-- 결과:
-- category     | product_count
-- Electronics  | 150
-- Books        | 300
-- Clothing     | 200

-- 사용자별 주문 통계
SELECT
    user_id,
    COUNT(*) AS order_count,
    SUM(amount) AS total_spent,
    AVG(amount) AS avg_order
FROM orders
GROUP BY user_id;

-- 날짜별 주문 통계
SELECT
    DATE(created_at) AS order_date,
    COUNT(*) AS order_count,
    SUM(amount) AS daily_revenue
FROM orders
GROUP BY DATE(created_at)
ORDER BY order_date DESC;

-- 다중 컬럼 GROUP BY
SELECT
    category,
    status,
    COUNT(*) AS count
FROM products
GROUP BY category, status;

-- 결과:
-- category     | status   | count
-- Electronics  | ACTIVE   | 120
-- Electronics  | INACTIVE | 30
-- Books        | ACTIVE   | 280
-- Books        | INACTIVE | 20
```

### 2-3) HAVING: 그룹 조건 필터링

```sql
-- WHERE vs HAVING
-- WHERE: 행 필터링 (GROUP BY 전)
-- HAVING: 그룹 필터링 (GROUP BY 후)

-- 주문이 10개 이상인 사용자
SELECT
    user_id,
    COUNT(*) AS order_count
FROM orders
GROUP BY user_id
HAVING COUNT(*) >= 10;

-- 총 매출이 100만원 이상인 카테고리
SELECT
    category,
    SUM(price * stock) AS total_value
FROM products
GROUP BY category
HAVING SUM(price * stock) >= 1000000;

-- WHERE + HAVING 조합
SELECT
    category,
    AVG(price) AS avg_price,
    COUNT(*) AS product_count
FROM products
WHERE status = 'ACTIVE'  -- WHERE: GROUP BY 전 필터
GROUP BY category
HAVING COUNT(*) >= 10;   -- HAVING: GROUP BY 후 필터

-- 복잡한 조건
SELECT
    user_id,
    COUNT(*) AS order_count,
    SUM(amount) AS total_amount
FROM orders
WHERE created_at >= '2025-01-01'
GROUP BY user_id
HAVING SUM(amount) > 100000 AND COUNT(*) >= 5;
```

## 3) 윈도우 함수 (Window Functions)

### 3-1) ROW_NUMBER: 행 번호

```sql
-- 기본 사용
SELECT
    name,
    price,
    ROW_NUMBER() OVER (ORDER BY price DESC) AS rank
FROM products;

-- 결과:
-- name          | price | rank
-- Product A     | 10000 | 1
-- Product B     | 8000  | 2
-- Product C     | 5000  | 3

-- 카테고리별 순위
SELECT
    category,
    name,
    price,
    ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS category_rank
FROM products;

-- 결과:
-- category     | name        | price | category_rank
-- Electronics  | Product A   | 10000 | 1
-- Electronics  | Product B   | 8000  | 2
-- Books        | Product C   | 5000  | 1
-- Books        | Product D   | 3000  | 2
```

### 3-2) RANK, DENSE_RANK: 순위 (동점 처리)

```sql
-- RANK: 동점이 있으면 다음 순위 건너뜀
SELECT
    name,
    score,
    RANK() OVER (ORDER BY score DESC) AS rank
FROM students;

-- 결과:
-- name   | score | rank
-- Alice  | 95    | 1
-- Bob    | 90    | 2
-- Charlie| 90    | 2
-- David  | 85    | 4  (3은 건너뜀)

-- DENSE_RANK: 동점이 있어도 다음 순위 연속
SELECT
    name,
    score,
    DENSE_RANK() OVER (ORDER BY score DESC) AS dense_rank
FROM students;

-- 결과:
-- name   | score | dense_rank
-- Alice  | 95    | 1
-- Bob    | 90    | 2
-- Charlie| 90    | 2
-- David  | 85    | 3  (연속)
```

### 3-3) SUM/AVG/COUNT (윈도우 집계)

```sql
-- 누적 합계
SELECT
    order_date,
    amount,
    SUM(amount) OVER (ORDER BY order_date) AS cumulative_total
FROM orders;

-- 결과:
-- order_date  | amount | cumulative_total
-- 2025-01-01  | 1000   | 1000
-- 2025-01-02  | 1500   | 2500
-- 2025-01-03  | 2000   | 4500

-- 이동 평균 (최근 3일)
SELECT
    order_date,
    amount,
    AVG(amount) OVER (
        ORDER BY order_date
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS moving_avg_3days
FROM orders;

-- 카테고리별 비율
SELECT
    category,
    amount,
    amount * 100.0 / SUM(amount) OVER (PARTITION BY category) AS percentage
FROM sales;
```

### 3-4) LAG, LEAD: 이전/다음 행 참조

```sql
-- LAG: 이전 행 값
SELECT
    order_date,
    amount,
    LAG(amount, 1) OVER (ORDER BY order_date) AS prev_amount,
    amount - LAG(amount, 1) OVER (ORDER BY order_date) AS diff
FROM orders;

-- 결과:
-- order_date  | amount | prev_amount | diff
-- 2025-01-01  | 1000   | NULL        | NULL
-- 2025-01-02  | 1500   | 1000        | 500
-- 2025-01-03  | 1200   | 1500        | -300

-- LEAD: 다음 행 값
SELECT
    order_date,
    amount,
    LEAD(amount, 1) OVER (ORDER BY order_date) AS next_amount
FROM orders;
```

## 4) 실전 예제

### 4-1) 상위 N개 조회

```sql
-- 각 카테고리별 가장 비싼 상품 3개
SELECT * FROM (
    SELECT
        category,
        name,
        price,
        ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS rn
    FROM products
) AS ranked
WHERE rn <= 3;

-- 또는 WITH 절 사용
WITH ranked_products AS (
    SELECT
        category,
        name,
        price,
        ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS rn
    FROM products
)
SELECT * FROM ranked_products
WHERE rn <= 3;
```

### 4-2) 사용자별 최근 주문

```sql
SELECT * FROM (
    SELECT
        user_id,
        id AS order_id,
        amount,
        created_at,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
    FROM orders
) AS recent_orders
WHERE rn = 1;
-- 각 사용자의 가장 최근 주문 1건
```

### 4-3) 월별 매출 통계

```sql
SELECT
    DATE_FORMAT(created_at, '%Y-%m') AS month,
    COUNT(*) AS order_count,
    SUM(amount) AS monthly_revenue,
    AVG(amount) AS avg_order_value
FROM orders
WHERE status = 'COMPLETED'
GROUP BY DATE_FORMAT(created_at, '%Y-%m')
ORDER BY month DESC;
```

### 4-4) 카테고리별 매출 비율

```sql
SELECT
    category,
    total_sales,
    total_sales * 100.0 / SUM(total_sales) OVER () AS percentage
FROM (
    SELECT
        category,
        SUM(amount) AS total_sales
    FROM sales
    GROUP BY category
) AS category_sales
ORDER BY total_sales DESC;
```

## 5) 성능 고려사항

### 5-1) 서브쿼리 vs JOIN

```sql
-- ❌ 상관 서브쿼리 (느릴 수 있음)
SELECT
    u.name,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;

-- ✅ JOIN + GROUP BY (더 빠름)
SELECT
    u.name,
    COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name;
```

### 5-2) EXISTS vs IN

```sql
-- ✅ EXISTS (큰 데이터셋에서 빠름)
SELECT * FROM users u
WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id
);

-- ⚠️ IN (작은 데이터셋에서는 괜찮음)
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders);
```

## 연습 (추천)

1. **서브쿼리 연습**
   - 평균보다 높은 값 조회
   - 특정 조건을 만족하는 행과 관련된 데이터 조회

2. **GROUP BY 연습**
   - 일별/월별/카테고리별 집계
   - HAVING으로 조건 필터링

3. **윈도우 함수 연습**
   - 랭킹 조회 (상위 10개)
   - 누적 합계, 이동 평균

## 요약: 스스로 점검할 것

- 서브쿼리의 종류(스칼라/인라인뷰/상관)를 구분할 수 있다
- GROUP BY + 집계 함수로 데이터를 요약할 수 있다
- HAVING으로 그룹 조건을 필터링할 수 있다
- 윈도우 함수로 랭킹/누적 합계를 계산할 수 있다
- 서브쿼리 vs JOIN의 성능 차이를 이해한다

## 다음 단계

- SQL JOIN: `/learning/deep-dive/deep-dive-sql-basics-joins-explain/`
- 데이터베이스 인덱스: `/learning/deep-dive/deep-dive-database-indexing/`
- MySQL 성능 튜닝: `/learning/deep-dive/deep-dive-mysql-performance-tuning/`
