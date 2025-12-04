---
title: "MySQL 인덱스 기초 예제"
date: 2025-02-01
draft: false
topic: "Database"
topic_icon: "🗄️"
topic_description: "MySQL 인덱스 동작 방식과 EXPLAIN 사용법"
tags: ["MySQL", "Index", "Explain", "쿼리최적화"]
categories: ["Development", "Learning"]
description: "WHERE, ORDER BY, JOIN에서 인덱스가 어떻게 사용되는지 간단한 예제로 정리"
---

## 테이블 & 인덱스 준비

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_users_email (email),
    INDEX idx_users_created_at (created_at)
);
```

## 1. WHERE 절에서 인덱스 사용

```sql
-- 인덱스 사용 (email = ?)
EXPLAIN SELECT * FROM users WHERE email = 'user@example.com';
```

**체크 포인트**
- `type: ref` 또는 `const` 인지 확인
- `possible_keys`, `key` 에 `idx_users_email` 이 나오는지 확인

## 2. 범위 조회 (BETWEEN / >=)

```sql
-- created_at 범위 조회
EXPLAIN
SELECT *
FROM users
WHERE created_at >= '2025-01-01'
  AND created_at <  '2025-02-01';
```

**실습 아이디어**
- 인덱스 없는 상태에서 성능 비교
- `EXPLAIN ANALYZE` 로 실제 실행 시간 확인 (8.0+)

## 3. 인덱스를 못 타는 패턴

```sql
-- ❌ 함수 사용 시 인덱스 사용 불가
SELECT * FROM users
WHERE DATE(created_at) = '2025-01-01';

-- ✅ 범위 조건으로 변경
SELECT * FROM users
WHERE created_at >= '2025-01-01 00:00:00'
  AND created_at <  '2025-01-02 00:00:00';
```

## 4. JOIN 에서 인덱스 사용

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_orders_user_id (user_id)
);

EXPLAIN
SELECT u.id, u.email, o.amount
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.email = 'user@example.com';
```

**정리**
- JOIN 컬럼(`orders.user_id`) 에 인덱스가 있어야 `type: ref` 로 조회
- `rows` 값이 작을수록 효율적인 실행 계획

