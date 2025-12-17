---
title: "SQL 기초: SELECT/INSERT/UPDATE/DELETE 완벽 정리"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["SQL", "Database", "MySQL", "CRUD", "Query"]
categories: ["Backend Deep Dive"]
description: "SQL의 기본 CRUD 작업과 WHERE/ORDER BY/LIMIT 조건을 실전 예제로 마스터"
module: "data-system"
study_order: 200
---

## 이 글에서 얻는 것

- **SELECT/INSERT/UPDATE/DELETE** 기본 문법을 이해하고 실무에서 바로 사용할 수 있습니다.
- **WHERE 조건문**으로 데이터를 필터링하고, **ORDER BY/LIMIT**로 정렬과 제한을 적용합니다.
- **NULL 처리, 문자열 검색(LIKE), 범위 조건(BETWEEN, IN)**을 활용합니다.
- **트랜잭션(BEGIN/COMMIT/ROLLBACK)** 기초를 이해하고 데이터 정합성을 유지합니다.

## 0) SQL은 "데이터베이스와 대화하는 언어"

SQL (Structured Query Language)은 관계형 데이터베이스에서 데이터를 조작하고 조회하는 표준 언어입니다.

**SQL의 주요 카테고리:**
- **DML (Data Manipulation Language)**: 데이터 조작
  - SELECT, INSERT, UPDATE, DELETE
- **DDL (Data Definition Language)**: 테이블/스키마 정의
  - CREATE, ALTER, DROP
- **DCL (Data Control Language)**: 권한 제어
  - GRANT, REVOKE
- **TCL (Transaction Control Language)**: 트랜잭션 제어
  - COMMIT, ROLLBACK

이 글에서는 **DML (CRUD)**에 집중합니다.

## 1) SELECT: 데이터 조회

### 1-1) 기본 조회

```sql
-- 모든 컬럼 조회
SELECT * FROM users;

-- 특정 컬럼만 조회
SELECT id, name, email FROM users;

-- 별칭(alias) 사용
SELECT
    id AS user_id,
    name AS user_name,
    email
FROM users;

-- 중복 제거
SELECT DISTINCT city FROM users;
```

### 1-2) WHERE: 조건 필터링

```sql
-- 단일 조건
SELECT * FROM users WHERE id = 1;
SELECT * FROM users WHERE age >= 20;
SELECT * FROM users WHERE city = 'Seoul';

-- 다중 조건 (AND, OR)
SELECT * FROM users
WHERE age >= 20 AND city = 'Seoul';

SELECT * FROM users
WHERE city = 'Seoul' OR city = 'Busan';

-- NOT
SELECT * FROM users WHERE NOT city = 'Seoul';
-- = SELECT * FROM users WHERE city != 'Seoul';

-- BETWEEN (범위)
SELECT * FROM products
WHERE price BETWEEN 1000 AND 5000;
-- = price >= 1000 AND price <= 5000

-- IN (여러 값 중 하나)
SELECT * FROM users
WHERE city IN ('Seoul', 'Busan', 'Incheon');

-- LIKE (패턴 검색)
SELECT * FROM users WHERE name LIKE '김%';      -- '김'으로 시작
SELECT * FROM users WHERE email LIKE '%@gmail.com';  -- '@gmail.com'으로 끝
SELECT * FROM users WHERE phone LIKE '010-____-1234';  -- _ 는 한 글자

-- IS NULL / IS NOT NULL
SELECT * FROM users WHERE deleted_at IS NULL;     -- 삭제되지 않은 유저
SELECT * FROM users WHERE deleted_at IS NOT NULL; -- 삭제된 유저
```

### 1-3) ORDER BY: 정렬

```sql
-- 오름차순 (기본)
SELECT * FROM users ORDER BY age;
SELECT * FROM users ORDER BY age ASC;

-- 내림차순
SELECT * FROM users ORDER BY age DESC;

-- 다중 정렬
SELECT * FROM users
ORDER BY city ASC, age DESC;
-- city로 먼저 정렬, 같으면 age로 정렬

-- NULL 정렬 순서 지정 (MySQL 8.0+)
SELECT * FROM users
ORDER BY deleted_at ASC NULLS FIRST;
```

### 1-4) LIMIT: 결과 개수 제한

```sql
-- 상위 10개
SELECT * FROM users LIMIT 10;

-- 페이징: OFFSET
SELECT * FROM users LIMIT 10 OFFSET 20;
-- 21번째부터 10개 (20개 건너뛰고)

-- 더 직관적인 표현 (MySQL)
SELECT * FROM users LIMIT 20, 10;
-- OFFSET 20, LIMIT 10

-- 가장 나이 많은 5명
SELECT * FROM users
ORDER BY age DESC
LIMIT 5;
```

### 1-5) 집계 함수

```sql
-- COUNT: 개수
SELECT COUNT(*) FROM users;                -- 전체 행 수
SELECT COUNT(DISTINCT city) FROM users;    -- 도시 종류 수

-- SUM: 합계
SELECT SUM(price) FROM orders;

-- AVG: 평균
SELECT AVG(age) FROM users;

-- MIN/MAX: 최솟값/최댓값
SELECT MIN(price), MAX(price) FROM products;

-- 조건과 함께
SELECT COUNT(*) FROM users WHERE age >= 20;
SELECT AVG(price) FROM orders WHERE status = 'COMPLETED';
```

## 2) INSERT: 데이터 삽입

### 2-1) 단일 행 삽입

```sql
-- 모든 컬럼 값 지정
INSERT INTO users (id, name, email, age, city)
VALUES (1, 'Alice', 'alice@example.com', 25, 'Seoul');

-- 일부 컬럼만 지정 (나머지는 NULL 또는 기본값)
INSERT INTO users (name, email)
VALUES ('Bob', 'bob@example.com');

-- AUTO_INCREMENT 컬럼은 생략
INSERT INTO users (name, email, age)
VALUES ('Charlie', 'charlie@example.com', 30);
```

### 2-2) 다중 행 삽입

```sql
INSERT INTO users (name, email, age) VALUES
    ('Alice', 'alice@example.com', 25),
    ('Bob', 'bob@example.com', 30),
    ('Charlie', 'charlie@example.com', 28);

-- 한 번에 여러 행 삽입이 더 빠름 (트랜잭션 비용 감소)
```

### 2-3) INSERT ... ON DUPLICATE KEY UPDATE

```sql
-- MySQL: 중복 시 업데이트
INSERT INTO users (id, name, email, age)
VALUES (1, 'Alice', 'alice@example.com', 25)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    age = VALUES(age);

-- id가 1인 행이 있으면 UPDATE, 없으면 INSERT
```

### 2-4) INSERT ... SELECT

```sql
-- 다른 테이블에서 데이터 복사
INSERT INTO users_backup (id, name, email)
SELECT id, name, email FROM users WHERE created_at < '2024-01-01';
```

## 3) UPDATE: 데이터 수정

### 3-1) 기본 UPDATE

```sql
-- 특정 행 수정
UPDATE users
SET age = 26
WHERE id = 1;

-- 다중 컬럼 수정
UPDATE users
SET
    age = 26,
    city = 'Busan',
    updated_at = NOW()
WHERE id = 1;

-- 조건 없이 UPDATE (전체 행 수정 - 위험!)
UPDATE users SET status = 'ACTIVE';
-- 모든 유저의 status가 'ACTIVE'로 변경됨
```

### 3-2) 조건부 UPDATE

```sql
-- 여러 행 수정
UPDATE users
SET status = 'INACTIVE'
WHERE last_login < '2024-01-01';

-- 계산식 사용
UPDATE products
SET price = price * 1.1
WHERE category = 'Electronics';

-- CASE WHEN (조건부 값 설정)
UPDATE users
SET grade = CASE
    WHEN age < 20 THEN 'Junior'
    WHEN age < 30 THEN 'Senior'
    ELSE 'Master'
END
WHERE status = 'ACTIVE';
```

### 3-3) UPDATE 주의사항

```sql
-- ❌ WHERE 절 없이 UPDATE (위험!)
UPDATE users SET password = 'reset123';
-- 모든 유저의 비밀번호가 같아짐!

-- ✅ 항상 WHERE 절 확인
UPDATE users
SET password = 'reset123'
WHERE id = 1;

-- ✅ UPDATE 전 SELECT로 확인
SELECT * FROM users WHERE id = 1;
-- 결과 확인 후
UPDATE users SET password = 'reset123' WHERE id = 1;
```

## 4) DELETE: 데이터 삭제

### 4-1) 기본 DELETE

```sql
-- 특정 행 삭제
DELETE FROM users WHERE id = 1;

-- 조건에 맞는 여러 행 삭제
DELETE FROM users
WHERE status = 'INACTIVE' AND last_login < '2024-01-01';

-- 전체 삭제 (위험!)
DELETE FROM users;
-- 모든 데이터 삭제됨!
```

### 4-2) DELETE vs TRUNCATE

```sql
-- DELETE: 행 단위 삭제, 트랜잭션 로그 기록, 느림
DELETE FROM users;

-- TRUNCATE: 테이블 전체 초기화, 빠름, 롤백 불가
TRUNCATE TABLE users;
-- AUTO_INCREMENT도 초기화됨
```

### 4-3) 소프트 삭제 (Soft Delete)

실제로 삭제하지 않고, 삭제 표시만 함

```sql
-- 삭제 표시
UPDATE users
SET deleted_at = NOW()
WHERE id = 1;

-- 삭제되지 않은 데이터만 조회
SELECT * FROM users WHERE deleted_at IS NULL;

-- 실제 삭제는 배치 작업으로 (예: 1년 후)
DELETE FROM users
WHERE deleted_at < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

## 5) 트랜잭션 (Transaction)

### 5-1) 트랜잭션 기본

```sql
-- 트랜잭션 시작
START TRANSACTION;
-- 또는 BEGIN;

-- 여러 작업 수행
UPDATE accounts SET balance = balance - 1000 WHERE id = 1;
UPDATE accounts SET balance = balance + 1000 WHERE id = 2;

-- 성공 시 커밋
COMMIT;

-- 실패 시 롤백
ROLLBACK;
```

### 5-2) 실전 예제

```sql
-- 계좌 이체
START TRANSACTION;

-- A 계좌에서 출금
UPDATE accounts
SET balance = balance - 100000
WHERE id = 1 AND balance >= 100000;

-- 잔액 부족 체크
SELECT ROW_COUNT() INTO @rows_affected;

IF @rows_affected = 0 THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '잔액 부족';
END IF;

-- B 계좌로 입금
UPDATE accounts
SET balance = balance + 100000
WHERE id = 2;

COMMIT;
```

### 5-3) 자동 커밋 설정

```sql
-- 자동 커밋 상태 확인
SELECT @@autocommit;

-- 자동 커밋 비활성화
SET autocommit = 0;

-- 작업 수행
UPDATE users SET age = 26 WHERE id = 1;

-- 수동 커밋 필요
COMMIT;

-- 자동 커밋 재활성화
SET autocommit = 1;
```

## 6) 실전 쿼리 패턴

### 6-1) 페이징

```sql
-- 1페이지 (1~10)
SELECT * FROM posts
ORDER BY created_at DESC
LIMIT 10 OFFSET 0;

-- 2페이지 (11~20)
SELECT * FROM posts
ORDER BY created_at DESC
LIMIT 10 OFFSET 10;

-- 페이지 번호로 계산
-- page = 3, pageSize = 10
-- OFFSET = (page - 1) * pageSize = 20
SELECT * FROM posts
ORDER BY created_at DESC
LIMIT 10 OFFSET 20;
```

### 6-2) 검색

```sql
-- 제목 또는 내용에 키워드 포함
SELECT * FROM posts
WHERE title LIKE '%spring%' OR content LIKE '%spring%';

-- 여러 키워드 검색 (AND)
SELECT * FROM posts
WHERE title LIKE '%spring%' AND title LIKE '%boot%';

-- 대소문자 구분 없이 검색 (MySQL)
SELECT * FROM posts
WHERE LOWER(title) LIKE LOWER('%Spring%');
```

### 6-3) 최신순 N개

```sql
-- 최신 게시글 10개
SELECT * FROM posts
ORDER BY created_at DESC
LIMIT 10;

-- 가장 비싼 상품 5개
SELECT * FROM products
ORDER BY price DESC
LIMIT 5;
```

### 6-4) 특정 기간 데이터

```sql
-- 오늘 생성된 주문
SELECT * FROM orders
WHERE DATE(created_at) = CURDATE();

-- 최근 7일 데이터
SELECT * FROM orders
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY);

-- 특정 월 데이터
SELECT * FROM orders
WHERE YEAR(created_at) = 2025 AND MONTH(created_at) = 1;
```

### 6-5) 중복 제거 후 카운트

```sql
-- 유니크한 도시 개수
SELECT COUNT(DISTINCT city) FROM users;

-- 각 도시별 유저 수
SELECT city, COUNT(*) as user_count
FROM users
GROUP BY city;
```

## 7) 자주 하는 실수

### 7-1) WHERE 절 누락

```sql
-- ❌ 의도: id=1인 유저만 삭제
DELETE FROM users;  -- WHERE 절 누락 → 전체 삭제!

-- ✅ WHERE 절 필수
DELETE FROM users WHERE id = 1;
```

### 7-2) NULL 비교

```sql
-- ❌ NULL은 = 로 비교 불가
SELECT * FROM users WHERE deleted_at = NULL;  -- 결과 없음!

-- ✅ IS NULL 사용
SELECT * FROM users WHERE deleted_at IS NULL;
```

### 7-3) LIKE 성능 문제

```sql
-- ❌ 앞에 %가 있으면 인덱스 사용 불가
SELECT * FROM users WHERE email LIKE '%@gmail.com';

-- ✅ 앞에 %가 없으면 인덱스 사용 가능
SELECT * FROM users WHERE email LIKE 'alice%';
```

### 7-4) ORDER BY 없이 LIMIT

```sql
-- ❌ 순서 보장 안 됨
SELECT * FROM users LIMIT 10;
-- 어떤 10개가 나올지 불확실!

-- ✅ ORDER BY로 순서 명시
SELECT * FROM users
ORDER BY created_at DESC
LIMIT 10;
```

## 8) SQL 스타일 가이드

```sql
-- ✅ 읽기 쉬운 SQL
SELECT
    id,
    name,
    email,
    created_at
FROM users
WHERE
    status = 'ACTIVE'
    AND age >= 20
ORDER BY created_at DESC
LIMIT 10;

-- ❌ 읽기 어려운 SQL
SELECT id,name,email,created_at FROM users WHERE status='ACTIVE' AND age>=20 ORDER BY created_at DESC LIMIT 10;

-- 예약어는 대문자 (또는 소문자로 일관성 유지)
-- 테이블/컬럼명은 소문자
-- 들여쓰기로 가독성 확보
```

## 연습 (추천)

1. **간단한 테이블 생성 후 CRUD 연습**
   ```sql
   CREATE TABLE practice (
       id INT AUTO_INCREMENT PRIMARY KEY,
       name VARCHAR(50),
       age INT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```

2. **다양한 조건 조합**
   - WHERE + ORDER BY + LIMIT
   - LIKE + AND
   - BETWEEN + IN

3. **트랜잭션 연습**
   - START TRANSACTION → UPDATE → ROLLBACK
   - COMMIT 전후 데이터 확인

## 요약: 스스로 점검할 것

- SELECT/INSERT/UPDATE/DELETE 기본 문법을 사용할 수 있다
- WHERE 조건문으로 데이터를 필터링할 수 있다
- ORDER BY로 정렬하고, LIMIT으로 개수를 제한할 수 있다
- NULL 비교는 IS NULL / IS NOT NULL을 사용한다
- UPDATE/DELETE 전에 WHERE 절을 항상 확인한다
- 트랜잭션으로 여러 작업을 하나로 묶을 수 있다

## 다음 단계

- SQL 서브쿼리와 집계: `/learning/deep-dive/deep-dive-sql-subquery-aggregation/`
- SQL JOIN: `/learning/deep-dive/deep-dive-sql-basics-joins-explain/`
- 데이터베이스 인덱스: `/learning/deep-dive/deep-dive-database-indexing/`
