---
title: "MySQL 인덱스 설계와 실행 계획 읽기"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["MySQL", "Index", "EXPLAIN", "Performance"]
categories: ["Backend Deep Dive"]
description: "B-Tree/컴포지트 인덱스 설계, EXPLAIN으로 실행 계획을 해석하고 튜닝하는 방법"
module: "data-system"
quizzes:
  - question: "복합 인덱스(Composite Index) `(user_id, created_at)`를 사용할 때, 인덱스를 효율적으로 타는 쿼리 조건은?"
    options:
      - "WHERE created_at > '2025-01-01'"
      - "WHERE user_id = 10 AND created_at > '2025-01-01'"
      - "WHERE created_at > '2025-01-01' AND user_id = 10 ORDER BY user_id"
      - "ORDER BY created_at"
    answer: 1
    explanation: "복합 인덱스는 '선두 컬럼(Leftmost Prefix)'부터 순서대로 매칭되어야 효과적입니다. `user_id`가 동등 조건으로 먼저 오고, `created_at`이 범위 조건으로 오면 인덱스를 잘 탑니다."

  - question: "EXPLAIN 결과에서 `type` 컬럼이 'ALL'인 경우 의미하는 것은?"
    options:
      - "인덱스를 사용하여 특정 키 값으로 조회했다."
      - "테이블 풀 스캔(Full Table Scan)이 발생하여 튜닝이 필요할 가능성이 높다."
      - "범위 스캔(Range Scan)을 수행했다."
      - "커버링 인덱스를 사용했다."
    answer: 1
    explanation: "`type: ALL`은 테이블의 모든 행을 스캔하므로, 대량 데이터에서 심각한 성능 저하를 유발합니다. `const`, `ref`, `range`와 같이 인덱스를 활용하는 타입이 나오도록 튜닝해야 합니다."

  - question: "'커버링 인덱스(Covering Index)'의 의미는?"
    options:
      - "인덱스에 쿼리에 필요한 모든 컬럼이 포함되어 있어, 테이블 데이터를 추가로 읽지 않아도 되는 경우"
      - "인덱스가 테이블의 모든 컬럼을 덮는 경우"
      - "인덱스가 다른 테이블의 외래 키를 참조하는 경우"
      - "인덱스를 사용하지 않고 풀 스캔하는 경우"
    answer: 0
    explanation: "커버링 인덱스는 SELECT하는 컬럼이 모두 인덱스에 포함되어 있어, 테이블(클러스터 인덱스)을 다시 읽을 필요 없이 인덱스만으로 결과를 반환할 수 있어 성능상 큰 이점이 있습니다."

  - question: "EXPLAIN의 `Extra` 컬럼에 'Using filesort'가 나타나는 것은 무엇을 의미하는가?"
    options:
      - "인덱스 순서를 그대로 이용하여 정렬했다."
      - "정렬이 필요하지만 인덱스로 처리되지 않아 별도의 정렬 작업(메모리/디스크)이 수행되었다."
      - "파일 시스템에서 데이터를 읽었다."
      - "쿼리가 성공적으로 실행되었다."
    answer: 1
    explanation: "`Using filesort`는 ORDER BY가 인덱스로 해결되지 않아 MySQL이 별도로 정렬해야 함을 의미합니다. 데이터가 많으면 비용이 크므로, 인덱스 순서를 맞추거나 LIMIT을 줄이는 등의 튜닝이 필요합니다."

  - question: "인덱스를 무분별하게 많이 추가하면 발생하는 대표적인 부작용은?"
    options:
      - "SELECT 쿼리 성능이 모두 향상된다."
      - "INSERT/UPDATE/DELETE 시 인덱스 유지 비용 증가 및 저장 공간 증가"
      - "NULL 값을 조회할 수 없게 된다."
      - "테이블 스키마가 변경된다."
    answer: 1
    explanation: "인덱스가 많아지면 데이터 변경(INSERT, UPDATE, DELETE) 시 모든 인덱스를 업데이트해야 하므로 쓰기 성능이 저하됩니다. 또한 저장 공간과 버퍼 풀 사용량도 증가합니다."
study_order: 205
---

## 이 글에서 얻는 것

- 인덱스를 “붙이면 빨라진다”가 아니라, **어떤 쿼리가 왜 빨라지는지** 설명할 수 있습니다.
- 복합 인덱스(Composite Index)의 순서를 조건/정렬 패턴에 맞춰 설계할 수 있습니다.
- `EXPLAIN`에서 위험 신호(`ALL`, `Using temporary`, `Using filesort`)를 읽고 개선 방향을 잡을 수 있습니다.

## 0) 인덱스는 ‘정렬된 길’이고, 비용도 함께 온다

인덱스는 보통 B-Tree 기반의 “정렬된 자료구조”입니다.
조회는 빨라지지만, 그만큼 쓰기(insert/update/delete)와 저장 공간 비용이 늘어납니다.

실무 감각:

- 읽기(조회)가 압도적으로 많을수록 인덱스의 가치가 커집니다.
- 쓰기가 많은 테이블에 인덱스를 무작정 늘리면 오히려 전체 성능이 나빠질 수 있습니다.

## 1) 인덱스 설계의 핵심: 쿼리 패턴이 먼저다

인덱스를 설계할 때는 “컬럼 목록”이 아니라 “자주 호출되는 쿼리”가 출발점입니다.

대표 패턴:

- `WHERE` 조건(=, IN, range)
- `ORDER BY`
- `GROUP BY`
- `JOIN` 키

## 2) 복합 인덱스(Composite)에서 제일 중요한 규칙

### 2-1) 선두 컬럼(Leftmost prefix)

복합 인덱스는 “선두부터” 의미가 있습니다.  
예: `(user_id, created_at)` 인덱스는 `user_id` 조건이 있을 때 가장 효과가 큽니다.

### 2-2) = 조건 → range 조건 → 정렬의 순서가 중요해진다

일반적으로:

- 동등 조건(=)이 먼저,
- 그 다음 범위(range),
- 정렬(order by)이 자연스럽게 이어지면 좋습니다.

예:

- `WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20`
- 인덱스 후보: `(user_id, created_at)`

## 3) 커버링 인덱스: “테이블을 안 읽는” 효과

쿼리가 필요한 컬럼을 인덱스에서만 가져올 수 있으면(covering),
테이블(클러스터 인덱스) 접근을 줄여서 큰 효과가 날 수 있습니다.

하지만 커버링을 위해 인덱스에 컬럼을 과도하게 넣으면 인덱스가 비대해져 역효과가 날 수 있으니,
정말 효과가 큰 쿼리부터 적용하는 편이 좋습니다.

## 4) EXPLAIN 읽기: 이것만 보면 된다(처음엔)

중요도가 높은 순서:

1) `type`: 접근 방식(대체로 `ALL`이 가장 위험)  
2) `key`: 실제로 어떤 인덱스를 썼는지  
3) `rows`: 얼마나 읽을 걸로 추정하는지(큰 값이면 의심)  
4) `Extra`: `Using temporary`, `Using filesort` 같은 경고  

`type`은 대략 이런 감각입니다.

- `const`/`ref`: 좋은 편(정확한 키/참조)
- `range`: 범위 스캔(조건/범위에 따라 비용 달라짐)
- `index`: 인덱스 전체 스캔(테이블 전체 스캔보단 낫지만 주의)
- `ALL`: 테이블 풀 스캔(대부분 튜닝 후보)

## 5) 예시로 감 잡기

```sql
EXPLAIN
SELECT id, created_at
FROM orders
WHERE user_id = 10 AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 20;
```

개선 루틴:

1) EXPLAIN을 보고 `key/type/rows/Extra` 확인  
2) 인덱스 후보를 세우고(`(user_id, created_at)` 등)  
3) 인덱스 추가 전/후로 “실제 쿼리 시간/rows”가 어떻게 변하는지 검증  

## 6) 자주 하는 실수

- 인덱스가 “걸려 있다”는 이유로 모든 쿼리가 빠를 거라 믿는 경우(실제로는 `ALL/filesort`가 나옴)
- `%keyword%` 검색에 인덱스를 기대하는 경우(일반 B-Tree 인덱스로는 어렵고, 필요하면 fulltext/검색 엔진 고려)
- JOIN 키에 인덱스가 없어서 조인이 폭발하는 경우
- 인덱스를 너무 많이 만들어 쓰기/스토리지/버퍼 효율이 무너지는 경우

## 연습(추천)

- 한 테이블에서 자주 호출되는 조회 쿼리 2~3개를 고르고, EXPLAIN 결과를 저장해두기
- 복합 인덱스 순서를 바꿔가며(`(A,B)` vs `(B,A)`) 어떤 쿼리에서 효과가 달라지는지 비교해보기
- `Using filesort/temporary`가 나오는 쿼리를 일부러 만들고, 인덱스로 개선 가능한지 확인해보기
