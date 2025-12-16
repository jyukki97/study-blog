---
title: "MySQL 인덱스 설계와 실행 계획 읽기"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["MySQL", "Index", "EXPLAIN", "Performance"]
categories: ["Backend Deep Dive"]
description: "B-Tree/컴포지트 인덱스 설계, EXPLAIN으로 실행 계획을 해석하고 튜닝하는 방법"
module: "data-system"
study_order: 205
---

## 인덱스 설계 포인트

- 단일 vs 컴포지트: 선두 컬럼 선택도, 정렬/필터 순서 고려
- 커버링 인덱스: 필요 컬럼만 포함해 테이블 접근 최소화
- 과도한 인덱스는 쓰기/스토리지 비용 증가 → 사용 빈도 기반 관리

## EXPLAIN 핵심 컬럼

- type: `const` > `ref` > `range` > `index` > `ALL`
- key / key_len: 사용 인덱스와 길이
- rows / filtered: 추정 스캔량
- extra: Using index, Using where, Using temporary, Using filesort

```sql
EXPLAIN SELECT * FROM orders
WHERE user_id = 10 AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 20;
```

## 체크리스트

- [ ] 선두 컬럼은 선택도가 높은 것부터, 정렬/조건 컬럼 순서 반영
- [ ] LIKE 접두어 검색(`prefix%`)만 인덱스 활용, `%keyword%`는 못함
- [ ] JOIN 시 양쪽 조인 키 인덱스 확인
- [ ] 인덱스 추가 전/후 EXPLAIN, 슬로우 쿼리 로그로 효과 검증
