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
summary: "인덱스를 추가하기 전에 쿼리의 필터·정렬·조인 조건과 실제 실행 계획을 함께 확인하는 짧은 실습입니다."
key_takeaways:
  - "인덱스 사용 여부는 EXPLAIN의 key 한 칸이 아니라 rows, filtered, Extra를 함께 보고 판단합니다."
  - "복합 인덱스는 WHERE·ORDER BY의 실제 순서와 선택도에 맞춰 설계하고, 쓰기 비용까지 측정합니다."
  - "운영 DB에서는 EXPLAIN ANALYZE와 DDL을 트래픽·락 영향까지 포함해 안전하게 실행합니다."
operator_checklist:
  - "슬로우 쿼리의 실제 파라미터·호출 빈도·p95를 확보했는가?"
  - "개선 전후 EXPLAIN 결과와 읽기/쓰기 지표를 같은 조건에서 비교했는가?"
  - "인덱스 생성·롤백 절차와 온라인 DDL 지원 조건을 확인했는가?"
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
- `rows`는 옵티마이저가 읽을 것으로 예상하는 행 수입니다. `key`가 보인다고 바로
  성공으로 판단하지 말고, 조회량이 요청 규모와 맞는지 같이 확인합니다.

## EXPLAIN을 읽는 최소 순서

`EXPLAIN`은 "인덱스를 탔는가"보다 "얼마나 많은 행을 어떤 방식으로 읽는가"를
확인하는 도구입니다. 다음 순서로 보면 초보적인 오판을 줄일 수 있습니다.

1. `type`에서 `ALL`(전체 스캔), `range`, `ref`, `const` 중 무엇인지 봅니다.
   단, 작은 테이블에서 `ALL`은 더 싸게 끝날 수도 있으므로 값 하나만으로 장애로
   단정하지 않습니다.
2. `possible_keys`와 `key`를 비교합니다. 사용할 수 있는 인덱스가 있는데 선택하지
   않았다면 조건 선택도, 통계, 반환 행 수를 의심합니다.
3. `rows`와 `filtered`로 읽기·필터링 규모를 추정합니다. 기대보다 큰 경우에는
   조인 순서와 복합 인덱스의 선두 컬럼을 다시 봅니다.
4. `Extra`의 `Using temporary`, `Using filesort`는 정렬·그룹화 비용의 신호입니다.
   무조건 제거 대상은 아니지만, 대량 결과와 결합되면 우선 조사합니다.

MySQL 8.0 이상에서는 읽기 전용 SELECT에 한해 `EXPLAIN ANALYZE`로 예상값과 실제
행 수·시간을 대조할 수 있습니다. 다만 이 명령은 쿼리를 실제로 실행합니다. 운영
트래픽이 큰 조회나 데이터 변경 문에는 먼저 복제본·스테이징에서 재현하고, 실행
시간 제한과 대상 범위를 정한 뒤 사용합니다.

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

범위 조회는 보통 인덱스의 강점이지만, 기간이 너무 넓어 테이블 대부분을 읽는다면
옵티마이저가 전체 스캔을 고르는 것이 합리적일 수 있습니다. "인덱스를 만들었는데
왜 안 쓰지?"보다 해당 기간의 반환 행 수와 필요한 컬럼 수를 먼저 확인하세요.
목록 화면처럼 최근 데이터만 자주 읽는 경우에는 기간을 명시하고 페이지 크기를
제한하는 편이 인덱스 추가보다 먼저 필요한 개선일 때도 많습니다.

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

날짜 컬럼에 함수를 적용하면 인덱스의 정렬 순서를 직접 활용하기 어렵습니다. 반대로
상수 쪽을 범위로 바꾸면 같은 의미를 유지하면서 `created_at` 인덱스를 활용할 수
있습니다. 시간대가 섞인 서비스라면 애플리케이션과 DB의 저장 기준(권장: UTC)을
먼저 통일해야 날짜 경계 조건도 안전해집니다.

## 4. 복합 인덱스: 필터와 정렬을 같이 읽기

관리자 화면에서 특정 사용자의 최근 주문을 50건씩 보는 상황을 생각해 봅시다.

```sql
CREATE INDEX idx_orders_user_created_at ON orders (user_id, created_at DESC);

EXPLAIN
SELECT id, amount, created_at
FROM orders
WHERE user_id = 42
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 50;
```

이 쿼리에서는 `user_id`가 동등 조건으로 먼저 좁혀지고 `created_at`이 범위·정렬에
쓰입니다. 그래서 `(user_id, created_at)` 순서가 `(created_at, user_id)`보다 잘 맞을
가능성이 큽니다. 다만 선두 컬럼의 선택도가 매우 낮거나, 실제 쿼리가 다른 정렬을
쓴다면 결과는 달라집니다. 인덱스 이름이나 관례로 결정하지 말고 대표 파라미터를
넣은 실행 계획으로 확인하세요.

`SELECT *`도 주의할 지점입니다. 인덱스에서 조건을 찾은 뒤 많은 행의 본문을 다시
읽어야 하면, 인덱스만으로 처리되는 조회보다 비용이 커집니다. 정말 필요한 컬럼만
선택하고, 읽기 빈도가 높으며 쓰기 부담을 감수할 근거가 있을 때만 covering index를
검토합니다. 인덱스를 늘리면 INSERT·UPDATE·DELETE와 저장 공간 비용도 함께 늘어납니다.

## 5. JOIN 에서 인덱스 사용

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

조인에서는 "어느 테이블이 먼저 줄어드는가"가 중요합니다. 위 예제는 이메일로
사용자를 한 명 찾고 주문을 붙이는 흐름이라 `users.email`과 `orders.user_id`가 모두
필요합니다. 반대로 상태별 주문을 먼저 넓게 읽은 뒤 사용자 정보를 붙이면 같은
인덱스라도 읽는 행 수가 크게 달라질 수 있습니다. 조인 결과가 중복되어 페이지가
느려지는 문제는 인덱스만으로 해결되지 않으므로, 조인 조건·카디널리티·페이지네이션을
함께 검토합니다.

## 운영 적용 전 체크리스트

- 슬로우 쿼리 로그나 APM에서 **실제 쿼리 형태와 호출 빈도**를 확보합니다. 개발용
  파라미터 하나로 통과해도 인기 사용자·월말 데이터에서 계획이 달라질 수 있습니다.
- 개선 전후에 `EXPLAIN` 또는 안전한 환경의 `EXPLAIN ANALYZE` 결과를 저장하고,
  API p95/p99, DB CPU, 읽기 I/O, 쓰기 지연을 함께 비교합니다.
- 새 인덱스는 대상 MySQL 버전과 테이블 엔진의 온라인 DDL 조건을 확인합니다.
  대형 테이블에서는 락·복제 지연·디스크 여유 공간 때문에 배포 창과 관찰 지표가
  필요합니다.
- 롤백은 단순히 `DROP INDEX`를 실행하는 일이 아닙니다. 배포 전 인덱스 이름,
  적용 시각, 되돌릴 기준(예: 쓰기 p95 악화 또는 복제 지연)을 기록하고, 트래픽이
  안정된 시간에 제거합니다.

## 다음 학습 연결

- [데이터베이스 & 데이터 시스템 학습 경로](/learning/modules/backend-data-system-phase/)에서
  인덱스 다음에 트랜잭션·락·캐시를 어떤 순서로 볼지 정리합니다.
- [SQL 성능 튜닝 Q&A](/learning/qna/sql-performance-tuning-qna/)에서 `EXPLAIN`의
  `type`, 조인 방식, `filesort`를 더 자세히 확인합니다.
- [DB 병목 트러블슈팅 프레임워크](/learning/qna/db-bottleneck-troubleshooting-framework-qna/)로
  인덱스 외에 락·풀·복제 지연을 분리해 진단하는 흐름을 이어 갑니다.
