---
title: "DB 인덱스 최적화 정리"
study_order: 705
date: 2025-12-01
topic: "Database"
topic_icon: "💬"
topic_description: "DB 인덱스, B-Tree, 복합 인덱스, Index Scan 관련 핵심 개념과 실전 예제 정리"
tags: ["Database", "Index", "B-Tree", "Optimization"]
categories: ["Database"]
draft: false
module: "qna"
---

# DB 인덱스 최적화 정리

## Q1. B-Tree 인덱스는 어떻게 동작하나요?

### 답변

**B-Tree (Balanced Tree)**는 대부분의 RDBMS에서 사용하는 **균형 잡힌 트리 구조의 인덱스**입니다.

**구조적 특징**:
1. **Root Node**: 최상위 노드
2. **Branch Node**: 중간 노드 (범위 정보)
3. **Leaf Node**: 실제 데이터 포인터 (Linked List로 연결)

**B-Tree 구조 예시**:

```
인덱스: users(age)

                    [50]                     ← Root
                   /    \
                 /        \
            [20, 35]      [65, 80]           ← Branch
            /  |  \        /  |  \
          /    |    \    /    |    \
      [10]  [25]  [40] [55] [70]  [90]      ← Leaf (실제 데이터 포인터)
       ↓     ↓     ↓    ↓    ↓     ↓
     Row1  Row2  Row3 Row4 Row5  Row6
```

**검색 과정** (age = 25 찾기):

```sql
-- 1. Root Node: 25 < 50 → 왼쪽 Branch
-- 2. Branch Node: 20 ≤ 25 < 35 → 중간 Leaf
-- 3. Leaf Node: 25 발견 → Row 포인터 반환

SELECT * FROM users WHERE age = 25;
-- → 3번의 블록 I/O (Root → Branch → Leaf)
```

**시간 복잡도**:

| 연산 | 시간 복잡도 | 설명 |
|------|-------------|------|
| 검색 | O(log N) | 트리 높이만큼 탐색 |
| 삽입 | O(log N) | 검색 + 삽입 |
| 삭제 | O(log N) | 검색 + 삭제 |
| 범위 검색 | O(log N + K) | Leaf 노드 순회 |

**Full Table Scan vs Index Scan 비교**:

```sql
-- 테이블: users (100만 건)
-- 블록 크기: 8KB, Row 크기: 200 bytes
-- 한 블록당 40개 Row

-- ❌ Full Table Scan
SELECT * FROM users WHERE age = 25;
-- → 25,000 블록 읽기 (100만 / 40)
-- → 약 200MB I/O

-- ✅ Index Scan (B-Tree depth = 3)
CREATE INDEX idx_age ON users(age);
SELECT * FROM users WHERE age = 25;
-- → 3 블록 읽기 (Root + Branch + Leaf)
-- → 해당 Row 블록 1개 추가
-- → 총 4 블록 (약 32KB I/O)
-- → 6,250배 빠름!
```

### 꼬리 질문 1: B-Tree vs Hash Index 차이는?

**비교표**:

| 특징 | B-Tree | Hash |
|------|--------|------|
| 등호 검색 (=) | O(log N) | O(1) |
| 범위 검색 (>, <) | O(log N + K) | 불가능 ❌ |
| 정렬 (ORDER BY) | 가능 ✅ | 불가능 ❌ |
| LIKE 검색 | 가능 (prefix) | 불가능 ❌ |
| 사용 DB | 대부분 | MySQL (MEMORY), PostgreSQL |

**예시**:

```sql
-- ✅ B-Tree 인덱스가 유리
SELECT * FROM users WHERE age BETWEEN 20 AND 30;  -- 범위 검색
SELECT * FROM users WHERE name LIKE 'John%';       -- Prefix 검색
SELECT * FROM users ORDER BY created_at DESC;     -- 정렬

-- ✅ Hash 인덱스가 유리
SELECT * FROM users WHERE user_id = 12345;        -- 등호 검색 (PK)
SELECT * FROM cache WHERE cache_key = 'key123';   -- 정확한 매칭
```

### 꼬리 질문 2: Clustered Index vs Non-Clustered Index는?

**Clustered Index** (클러스터형):
- **실제 데이터가 인덱스 순서로 정렬**됨
- 테이블당 1개만 가능 (보통 PK)
- Leaf Node = 실제 데이터

**Non-Clustered Index** (비클러스터형):
- **인덱스와 데이터가 분리**
- 테이블당 여러 개 가능
- Leaf Node = 데이터 포인터

```sql
-- MySQL InnoDB 예시

-- Clustered Index (PK)
CREATE TABLE users (
    id INT PRIMARY KEY,      -- Clustered Index
    name VARCHAR(100),
    age INT
);
-- → 실제 데이터가 id 순서로 디스크에 저장됨

-- Non-Clustered Index (Secondary Index)
CREATE INDEX idx_age ON users(age);
-- → age 인덱스 별도 저장
-- → Leaf Node는 PK(id) 값을 가짐
-- → age 인덱스 조회 → PK로 다시 Clustered Index 조회 (2단계)
```

**성능 차이**:

```sql
-- ✅ Clustered Index (빠름)
SELECT * FROM users WHERE id = 100;
-- → 1번 조회 (Clustered Index)

-- ⚠️ Non-Clustered Index (느림)
SELECT * FROM users WHERE age = 25;
-- → 1번: age 인덱스 조회 (id = 100 발견)
-- → 2번: Clustered Index에서 id = 100 조회
-- → 총 2번 조회
```

---

## Q2. 복합 인덱스는 어떻게 설계하나요?

### 답변

**복합 인덱스 (Composite Index)**는 **여러 컬럼을 조합한 인덱스**입니다.

**핵심 원칙**: 선택도가 높은 컬럼을 앞에 배치 + 범위 검색 컬럼은 뒤에

### 컬럼 순서의 중요성

```sql
-- 테이블: orders
-- 데이터: 100만 건
-- country: 10개 (선택도 낮음)
-- status: 5개 (선택도 낮음)
-- created_at: 백만 개 (선택도 높음)

-- ❌ 잘못된 순서
CREATE INDEX idx_bad ON orders(country, status, created_at);

SELECT * FROM orders
WHERE status = 'COMPLETED'
  AND created_at >= '2025-01-01';
-- → country 조건이 없어서 인덱스 사용 불가! ❌

-- ✅ 올바른 순서 (선택도 높은 컬럼 우선)
CREATE INDEX idx_good ON orders(status, country, created_at);

SELECT * FROM orders
WHERE status = 'COMPLETED'
  AND created_at >= '2025-01-01';
-- → status로 인덱스 시작 가능 ✅
-- → created_at으로 범위 검색 ✅
```

### 복합 인덱스 활용 규칙

**Leftmost Prefix Rule** (최좌측 접두어 규칙):

```sql
CREATE INDEX idx_abc ON users(a, b, c);

-- ✅ 인덱스 사용 가능
WHERE a = 1
WHERE a = 1 AND b = 2
WHERE a = 1 AND b = 2 AND c = 3
WHERE a = 1 AND c = 3  -- a만 사용

-- ❌ 인덱스 사용 불가
WHERE b = 2
WHERE c = 3
WHERE b = 2 AND c = 3
```

**실무 예시**:

```sql
-- 사용자 검색 쿼리 패턴 분석
-- 패턴 1: WHERE city = 'Seoul' AND age = 25 (70%)
-- 패턴 2: WHERE city = 'Seoul' AND gender = 'M' (20%)
-- 패턴 3: WHERE city = 'Seoul' (10%)

-- ✅ 최적 인덱스 설계
CREATE INDEX idx_city_age_gender ON users(city, age, gender);

-- 패턴 1 (70%)
SELECT * FROM users WHERE city = 'Seoul' AND age = 25;
-- → idx_city_age_gender 사용 (city, age) ✅

-- 패턴 2 (20%)
SELECT * FROM users WHERE city = 'Seoul' AND gender = 'M';
-- → idx_city_age_gender 사용 (city만) ⚠️
-- → gender는 Skip Scan

-- 패턴 3 (10%)
SELECT * FROM users WHERE city = 'Seoul';
-- → idx_city_age_gender 사용 (city) ✅
```

### 범위 검색과 등호 검색 혼합

```sql
-- ❌ 범위 검색을 앞에 배치
CREATE INDEX idx_bad ON orders(created_at, status);

SELECT * FROM orders
WHERE created_at >= '2025-01-01'
  AND status = 'COMPLETED';
-- → created_at 범위 검색 후 status 조건은 인덱스 미사용 ⚠️

-- ✅ 등호 검색을 앞에 배치
CREATE INDEX idx_good ON orders(status, created_at);

SELECT * FROM orders
WHERE status = 'COMPLETED'
  AND created_at >= '2025-01-01';
-- → status 등호 검색 → created_at 범위 검색 ✅
-- → 인덱스 완전 활용
```

### 꼬리 질문 1: 인덱스가 너무 많으면 안 좋은 이유는?

**Write Penalty (쓰기 부담)**:

```sql
-- 테이블: users (10개 인덱스)
INSERT INTO users VALUES (...);

-- 실행 내용:
-- 1. 실제 데이터 삽입
-- 2. 인덱스 1 업데이트
-- 3. 인덱스 2 업데이트
-- ...
-- 11. 인덱스 10 업데이트
-- → 총 11번 쓰기 작업! ⚠️

-- 성능 영향:
-- 인덱스 0개: 100,000 INSERTs/sec
-- 인덱스 5개: 50,000 INSERTs/sec (50% 감소)
-- 인덱스 10개: 20,000 INSERTs/sec (80% 감소)
```

**권장 사항**:

| 테이블 유형 | 권장 인덱스 개수 | 이유 |
|-------------|------------------|------|
| 읽기 위주 (조회) | 5-10개 | 조회 성능 우선 |
| 쓰기 위주 (로그) | 1-3개 | 삽입 성능 우선 |
| 균형 (OLTP) | 3-7개 | 읽기/쓰기 균형 |

### 꼬리 질문 2: Skip Scan이란?

**Index Skip Scan**은 **복합 인덱스의 첫 컬럼 조건이 없어도** 인덱스를 사용하는 최적화 기법입니다.

```sql
CREATE INDEX idx_gender_age ON users(gender, age);

-- ❌ 일반적으로는 인덱스 사용 불가
SELECT * FROM users WHERE age = 25;
-- (gender 조건 없음)

-- ✅ Skip Scan 사용 (Oracle, PostgreSQL 11+)
-- 내부적으로:
SELECT * FROM users WHERE gender = 'M' AND age = 25
UNION ALL
SELECT * FROM users WHERE gender = 'F' AND age = 25;
-- → gender 값(M, F)을 자동으로 반복하며 검색
```

**조건**:
- 첫 컬럼의 Cardinality가 낮아야 함 (값의 종류가 적음)
- 예: gender (M/F), status (3-5개 값)

---

## Q3. Covering Index란 무엇인가요?

### 답변

**Covering Index**는 **쿼리에 필요한 모든 컬럼을 인덱스가 포함**하여, 테이블 접근 없이 인덱스만으로 결과를 반환하는 최적화 기법입니다.

**동작 원리**:

```sql
-- 테이블: users (100만 건)
CREATE TABLE users (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100),
    age INT,
    city VARCHAR(50)
);

-- ❌ Non-Covering Index
CREATE INDEX idx_age ON users(age);

SELECT id, name, email FROM users WHERE age = 25;

-- 실행 과정:
-- 1. idx_age에서 age = 25인 Row 검색
-- 2. Leaf Node에서 PK(id) 값 획득
-- 3. Clustered Index에서 id로 실제 Row 조회 (name, email 가져옴)
-- → 2번 조회 (Index + Table) ⚠️

-- ✅ Covering Index
CREATE INDEX idx_age_id_name_email ON users(age, id, name, email);

SELECT id, name, email FROM users WHERE age = 25;

-- 실행 과정:
-- 1. idx_age_id_name_email에서 age = 25인 Row 검색
-- 2. 인덱스 Leaf Node에 id, name, email이 모두 있음!
-- → 1번 조회 (Index만) ✅
-- → 테이블 접근 불필요 (빠름!)
```

**성능 비교**:

```sql
-- 실험: 100만 건 테이블, age = 25 (5만 건)

-- ❌ Non-Covering Index
CREATE INDEX idx_age ON users(age);
SELECT id, name, email FROM users WHERE age = 25;
-- → 실행 시간: 500ms
-- → 블록 I/O: 50,000 (인덱스 + 테이블)

-- ✅ Covering Index
CREATE INDEX idx_age_covering ON users(age, id, name, email);
SELECT id, name, email FROM users WHERE age = 25;
-- → 실행 시간: 50ms (10배 빠름!)
-- → 블록 I/O: 5,000 (인덱스만)
```

### Covering Index 설계 전략

```sql
-- 빈번한 쿼리 패턴
SELECT user_id, name, email
FROM users
WHERE status = 'ACTIVE'
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 10;

-- ✅ Covering Index 설계
CREATE INDEX idx_covering ON users(
    status,          -- WHERE 조건
    created_at,      -- WHERE 조건 + ORDER BY
    user_id,         -- SELECT 컬럼
    name,            -- SELECT 컬럼
    email            -- SELECT 컬럼
);

-- → 인덱스만으로 모든 데이터 반환 ✅
```

### 꼬리 질문 1: Covering Index의 단점은?

**1. 인덱스 크기 증가**:

```sql
-- ❌ 과도한 Covering Index
CREATE INDEX idx_too_large ON users(
    age,
    name,       -- VARCHAR(100)
    email,      -- VARCHAR(100)
    address,    -- VARCHAR(200)
    description -- TEXT
);
-- → 인덱스 크기가 테이블보다 클 수 있음! ⚠️
-- → 인덱스 캐시 효율 저하
```

**2. Write Penalty**:

```sql
UPDATE users SET email = 'new@example.com' WHERE id = 123;

-- Non-Covering Index:
-- → users 테이블 업데이트
-- → idx_age 인덱스는 email 없으므로 업데이트 불필요

-- Covering Index:
-- → users 테이블 업데이트
-- → idx_covering 인덱스도 email 컬럼 업데이트 필요 ⚠️
```

**권장 사항**:

| 조건 | 권장 |
|------|------|
| 조회 빈도 높음 (90% 이상) | Covering Index 사용 ✅ |
| 컬럼 크기 작음 (INT, DATE) | Covering Index 사용 ✅ |
| 업데이트 빈번 | 최소 컬럼만 포함 ⚠️ |
| 컬럼 크기 큼 (TEXT, BLOB) | 포함하지 않음 ❌ |

### 꼬리 질문 2: INCLUDE 컬럼이란? (PostgreSQL, SQL Server)

**INCLUDE**는 **인덱스 정렬에는 참여하지 않고, Leaf Node에만 저장**되는 컬럼입니다.

```sql
-- ✅ INCLUDE 사용 (PostgreSQL)
CREATE INDEX idx_users_include ON users(age, status)
INCLUDE (name, email);

-- 동작:
-- Branch Node: age, status만 저장 (정렬 키)
-- Leaf Node: age, status, name, email 모두 저장

-- 장점:
-- 1. Branch Node 크기 감소 → 메모리 효율 향상
-- 2. Covering Index 효과 유지
-- 3. 인덱스 크기 20-40% 감소
```

**비교**:

```sql
-- 일반 복합 인덱스
CREATE INDEX idx_normal ON users(age, status, name, email);
-- → Branch/Leaf 모두 4개 컬럼 저장
-- → 인덱스 크기: 500MB

-- INCLUDE 사용
CREATE INDEX idx_include ON users(age, status) INCLUDE (name, email);
-- → Branch: 2개 컬럼
-- → Leaf: 4개 컬럼
-- → 인덱스 크기: 350MB (30% 감소)
```

---

## Q4. Index Selectivity (선택도)란 무엇인가요?

### 답변

**Index Selectivity (선택도)**는 **인덱스가 얼마나 많은 데이터를 걸러낼 수 있는지**를 나타내는 지표입니다.

**계산 공식**:

```
Selectivity = Distinct 값 개수 / 전체 Row 개수

높은 선택도: 1에 가까움 (좋음)
낮은 선택도: 0에 가까움 (나쁨)
```

**예시**:

```sql
-- 테이블: users (100만 건)

-- ✅ 높은 선택도 (인덱스 효과적)
-- user_id (Primary Key)
SELECT COUNT(DISTINCT user_id) FROM users;  -- 100만 개
-- Selectivity = 1,000,000 / 1,000,000 = 1.0 (완벽!)

-- email (Unique)
SELECT COUNT(DISTINCT email) FROM users;  -- 100만 개
-- Selectivity = 1,000,000 / 1,000,000 = 1.0 (완벽!)

-- ⚠️ 중간 선택도 (상황에 따라)
-- city (도시)
SELECT COUNT(DISTINCT city) FROM users;  -- 100개
-- Selectivity = 100 / 1,000,000 = 0.0001 (낮음)

-- ❌ 낮은 선택도 (인덱스 비효율적)
-- gender (성별)
SELECT COUNT(DISTINCT gender) FROM users;  -- 2개 (M, F)
-- Selectivity = 2 / 1,000,000 = 0.000002 (매우 낮음)

-- is_active (활성 여부)
SELECT COUNT(DISTINCT is_active) FROM users;  -- 2개 (true, false)
-- Selectivity = 2 / 1,000,000 = 0.000002 (매우 낮음)
```

### 선택도에 따른 인덱스 효과

```sql
-- ❌ 낮은 선택도 (인덱스 비효율)
CREATE INDEX idx_gender ON users(gender);

SELECT * FROM users WHERE gender = 'M';
-- → 50만 건 반환 (전체의 50%)
-- → Full Table Scan이 더 빠를 수 있음! ⚠️

-- 이유:
-- 1. 인덱스 조회: 50만 번
-- 2. 테이블 조회: 50만 번
-- 3. Random I/O: 50만 번
-- → Full Table Scan: 순차 I/O 25,000번이 더 빠름!

-- ✅ 높은 선택도 (인덱스 효과적)
CREATE INDEX idx_email ON users(email);

SELECT * FROM users WHERE email = 'john@example.com';
-- → 1건 반환 (0.0001%)
-- → Index Scan이 훨씬 빠름! ✅
```

### 선택도 개선 전략

**1. 복합 인덱스로 선택도 향상**:

```sql
-- ❌ 단일 컬럼 (낮은 선택도)
CREATE INDEX idx_status ON orders(status);
-- status: 'PENDING', 'COMPLETED', 'CANCELLED' (3개 값)
-- Selectivity = 3 / 1,000,000 = 0.000003

-- ✅ 복합 인덱스 (높은 선택도)
CREATE INDEX idx_status_date ON orders(status, created_at);
-- (status, created_at) 조합: 거의 유니크
-- Selectivity ≈ 0.9 (높음!)

SELECT * FROM orders
WHERE status = 'PENDING'
  AND created_at >= '2025-01-01';
-- → 복합 인덱스로 선택도 크게 향상 ✅
```

**2. Partial Index (부분 인덱스)**:

```sql
-- ❌ 전체 인덱스 (비효율)
CREATE INDEX idx_is_active ON users(is_active);
-- is_active: true (95%), false (5%)

SELECT * FROM users WHERE is_active = false;
-- → 5만 건 (5%)

-- ✅ Partial Index (PostgreSQL, SQLite)
CREATE INDEX idx_inactive_users ON users(user_id)
WHERE is_active = false;
-- → is_active = false인 Row만 인덱싱
-- → 인덱스 크기: 95% 감소
-- → 조회 속도: 동일하거나 더 빠름

SELECT * FROM users WHERE is_active = false;
-- → idx_inactive_users 사용 ✅
```

### 꼬리 질문: 옵티마이저는 언제 인덱스를 사용하지 않나요?

**인덱스를 사용하지 않는 경우**:

```sql
-- 1. 낮은 선택도 (결과가 전체의 20% 이상)
SELECT * FROM users WHERE gender = 'M';
-- → Full Table Scan 선택

-- 2. 함수 사용
CREATE INDEX idx_name ON users(name);
SELECT * FROM users WHERE UPPER(name) = 'JOHN';
-- → 인덱스 무효화 ❌

-- ✅ 함수 기반 인덱스 (Function-based Index)
CREATE INDEX idx_upper_name ON users(UPPER(name));
SELECT * FROM users WHERE UPPER(name) = 'JOHN';
-- → idx_upper_name 사용 ✅

-- 3. LIKE '%keyword' (prefix 아님)
CREATE INDEX idx_email ON users(email);
SELECT * FROM users WHERE email LIKE '%@gmail.com';
-- → 인덱스 무효화 ❌ (prefix가 아님)

SELECT * FROM users WHERE email LIKE 'john%';
-- → idx_email 사용 ✅ (prefix)

-- 4. OR 조건 (인덱스가 없는 컬럼)
SELECT * FROM users
WHERE user_id = 123  -- 인덱스 있음
   OR name = 'John'; -- 인덱스 없음
-- → Full Table Scan

-- 5. 데이터 타입 불일치
CREATE INDEX idx_user_id ON users(user_id);  -- INT
SELECT * FROM users WHERE user_id = '123';   -- STRING
-- → 암묵적 형변환으로 인덱스 무효화 ⚠️
```

---

## Q5. 실무에서 인덱스 최적화 경험은?

### 답변

**장애 사례 1: 쿼리 실행 시간 30초 → 0.1초**

**증상**:
- 사용자 검색 API 응답 시간 30초
- DB CPU 사용률 90%

**원인 분석**:

```sql
-- 문제 쿼리
SELECT *
FROM users
WHERE city = 'Seoul'
  AND age BETWEEN 20 AND 30
  AND created_at >= '2024-01-01'
ORDER BY created_at DESC
LIMIT 10;

-- 실행 계획 확인
EXPLAIN ANALYZE
SELECT ...;

-- 출력:
-- Seq Scan on users  (cost=0..50000 rows=100000)
--   Filter: city = 'Seoul' AND age >= 20 AND age <= 30
-- → Full Table Scan! ⚠️
-- → 100만 건 스캔
```

**해결**:

```sql
-- ✅ Covering Index 생성
CREATE INDEX idx_city_age_created_covering ON users(
    city,          -- WHERE 조건 (선택도 중간)
    age,           -- WHERE 조건 (선택도 중간)
    created_at     -- WHERE + ORDER BY
) INCLUDE (
    user_id, name, email  -- SELECT 컬럼
);

-- 실행 계획 (개선 후)
EXPLAIN ANALYZE
SELECT ...;

-- 출력:
-- Index Only Scan using idx_city_age_created_covering
--   (cost=0..100 rows=10)
-- → 인덱스만 사용! ✅
-- → 1,000건만 스캔 (1,000배 감소)

-- 성능 결과:
-- 실행 시간: 30초 → 0.1초 (300배 개선)
-- CPU 사용률: 90% → 10%
```

---

**장애 사례 2: 복합 인덱스 순서 변경으로 성능 10배 향상**

**증상**:
- 주문 조회 쿼리 느림 (평균 2초)

**원인**:

```sql
-- 기존 인덱스
CREATE INDEX idx_old ON orders(created_at, status, user_id);

-- 쿼리 패턴 (80%)
SELECT * FROM orders
WHERE user_id = 12345
  AND status = 'PENDING';

-- 실행 계획:
-- Index Scan using idx_old  (cost=0..5000)
--   Filter: user_id = 12345 AND status = 'PENDING'
-- → created_at 조건이 없어 인덱스 효율 낮음 ⚠️
```

**분석**:

```sql
-- 컬럼별 선택도 분석
SELECT
    COUNT(DISTINCT created_at) / COUNT(*) AS created_selectivity,
    COUNT(DISTINCT status) / COUNT(*) AS status_selectivity,
    COUNT(DISTINCT user_id) / COUNT(*) AS user_selectivity
FROM orders;

-- 결과:
-- created_selectivity: 0.8 (높음)
-- status_selectivity: 0.000005 (매우 낮음, 5개 값)
-- user_selectivity: 0.1 (중간)

-- 쿼리 패턴 분석:
-- user_id 조건: 80%
-- status 조건: 90%
-- created_at 조건: 30%
```

**해결**:

```sql
-- ✅ 인덱스 순서 변경
DROP INDEX idx_old;
CREATE INDEX idx_new ON orders(user_id, status, created_at);

-- 이유:
-- 1. user_id: 쿼리에 80% 사용 → 첫 번째
-- 2. status: 쿼리에 90% 사용 → 두 번째
-- 3. created_at: 쿼리에 30% 사용 → 세 번째 (범위 검색)

-- 실행 계획 (개선 후):
-- Index Scan using idx_new  (cost=0..50)
--   Index Cond: user_id = 12345 AND status = 'PENDING'
-- → 효율적인 인덱스 사용! ✅

-- 성능 결과:
-- 실행 시간: 2초 → 0.2초 (10배 개선)
-- 스캔 Row: 10만 건 → 100건 (1,000배 감소)
```

---

**장애 사례 3: 과도한 인덱스로 INSERT 성능 저하**

**증상**:
- 주문 생성 API 응답 시간 5초
- DB Write 대기 시간 증가

**원인**:

```sql
-- 테이블에 인덱스 15개 존재!
SHOW INDEX FROM orders;

-- 출력:
-- idx_user_id
-- idx_status
-- idx_created_at
-- idx_user_status
-- idx_status_created
-- ... (총 15개)

INSERT INTO orders VALUES (...);
-- → 15개 인덱스 모두 업데이트 필요! ⚠️
-- → 실행 시간: 5초
```

**분석**:

```sql
-- 인덱스 사용 통계 확인 (PostgreSQL)
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,  -- 인덱스 스캔 횟수
    idx_tup_read
FROM pg_stat_user_indexes
WHERE tablename = 'orders'
ORDER BY idx_scan ASC;

-- 결과:
-- idx_user_id: 1,000,000 (활발히 사용)
-- idx_status_created: 500,000 (활발히 사용)
-- idx_unused_1: 0 (미사용!) ⚠️
-- idx_unused_2: 10 (거의 미사용) ⚠️
-- ...
```

**해결**:

```sql
-- ✅ 미사용 인덱스 제거
DROP INDEX idx_unused_1;
DROP INDEX idx_unused_2;
DROP INDEX idx_unused_3;
-- ... (7개 제거)

-- ✅ 중복 인덱스 통합
-- 기존:
-- idx_user_id (user_id)
-- idx_user_status (user_id, status)
-- → idx_user_id는 불필요! (idx_user_status로 커버 가능)

DROP INDEX idx_user_id;

-- 최종: 15개 → 5개 인덱스만 유지

-- 성능 결과:
-- INSERT 시간: 5초 → 0.5초 (10배 개선)
-- DB Write 대기: 80% 감소
```

---

## 요약

### B-Tree 인덱스
- **구조**: Root → Branch → Leaf (Balanced Tree)
- **시간 복잡도**: 검색/삽입/삭제 O(log N)
- **Clustered vs Non-Clustered**: PK는 Clustered, 나머지는 Non-Clustered

### 복합 인덱스 설계
- **컬럼 순서**: 선택도 높은 컬럼 우선, 범위 검색은 마지막
- **Leftmost Prefix**: 첫 컬럼부터 순서대로 사용해야 인덱스 활용
- **쿼리 패턴**: 자주 사용되는 조건 조합을 복합 인덱스로

### Covering Index
- **정의**: 쿼리에 필요한 모든 컬럼을 인덱스에 포함
- **효과**: 테이블 접근 없이 인덱스만으로 결과 반환
- **주의**: 인덱스 크기 증가, Write Penalty

### Index Selectivity
- **계산**: Distinct 값 / 전체 Row (1에 가까울수록 좋음)
- **높은 선택도**: PK, Unique (인덱스 효과적)
- **낮은 선택도**: Gender, Boolean (인덱스 비효율적)

### 실무 최적화
- **실행 계획**: EXPLAIN ANALYZE로 인덱스 사용 확인
- **통계 분석**: 컬럼별 선택도, 쿼리 패턴 분석
- **인덱스 정리**: 미사용 인덱스 제거, 중복 인덱스 통합

---

## 🔗 Related Deep Dive

더 깊이 있는 학습을 원한다면 심화 과정을 참고하세요:

- **[인덱스 기본](/learning/deep-dive/deep-dive-database-indexing/)**: B-Tree 구조와 쿼리 성능 시각화.
- **[스토리지 엔진 내부](/learning/deep-dive/deep-dive-database-engines-lsm/)**: B-Tree vs LSM-Tree 비교.
- **[MySQL 격리 수준과 락](/learning/deep-dive/deep-dive-mysql-isolation-locks/)**: 인덱스 락과 데드락 문제.
