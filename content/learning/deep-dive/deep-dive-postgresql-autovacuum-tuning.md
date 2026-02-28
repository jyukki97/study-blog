---
title: "PostgreSQL Autovacuum 튜닝: 느려진 쿼리와 Bloat를 동시에 잡는 법"
date: 2026-02-28
draft: false
topic: "Database"
tags: ["PostgreSQL", "Autovacuum", "VACUUM", "Bloat", "Performance"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL에서 autovacuum이 밀릴 때 생기는 실무 장애 패턴, 튜닝 기준, 트레이드오프와 체크리스트를 정리합니다."
module: "database"
study_order: 530
---

## 이 글에서 얻는 것

- PostgreSQL에서 **왜 테이블이 점점 느려지는지**(dead tuple, bloat) 설명할 수 있습니다.
- Autovacuum 기본값을 맹신하지 않고, **워크로드별 튜닝 기준**을 세울 수 있습니다.
- 운영 중 자주 하는 실수를 피하고, 바로 적용 가능한 점검 루틴을 만들 수 있습니다.

---

## 1) 배경: 삭제/업데이트가 많은 테이블이 갑자기 느려지는 이유

PostgreSQL은 MVCC 구조라서 UPDATE/DELETE 시 이전 버전이 바로 사라지지 않습니다.
그래서 dead tuple이 쌓이면:

- 인덱스/테이블가 비대해지고
- 디스크 I/O가 늘고
- 결국 쿼리 응답 시간이 늦어집니다.

여기서 autovacuum이 제때 청소하지 못하면, 흔히 말하는 **테이블 bloat**가 발생합니다.

---

## 2) 실무 기준: Autovacuum 튜닝 시작점

아래 숫자는 "정답"이 아니라 **시작점**입니다.

### 기본 원칙

1. 쓰기 많은 테이블일수록 `autovacuum_vacuum_scale_factor`를 낮춘다.
2. 작은 테이블은 threshold가 너무 커지지 않게 `autovacuum_vacuum_threshold`를 본다.
3. 전체 서버 자원이 남는다면 worker/cost limit을 올려 backlog를 줄인다.

### 테이블 단위 예시

```sql
ALTER TABLE orders
SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_threshold = 500
);
```

### 모니터링 쿼리 예시

```sql
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_ratio,
  last_autovacuum,
  vacuum_count,
  autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

---

## 3) 트레이드오프: "청소를 자주" vs "서비스 영향 최소화"

### Autovacuum을 공격적으로 돌리면

- 장점: bloat 누적을 빨리 막음, planner 통계 품질 유지
- 단점: I/O/CPU 사용이 늘어 피크 시간대에 지연 증가 가능

### Autovacuum을 소극적으로 돌리면

- 장점: 단기적으로는 앱 지연이 낮아 보임
- 단점: 장기적으로 bloat가 누적되어 더 큰 장애(쿼리 급격한 악화, 유지보수 시간 증가)

> 핵심은 "항상 빠르게"가 아니라, **피크 시간과 비피크 시간을 나눠 정책화**하는 것입니다.

---

## 4) 자주 하는 실수

1. **전역 파라미터만 만지고 끝내기**  
   → 테이블별 쓰기 패턴이 다르므로, 핫 테이블은 테이블 단위로 조정해야 합니다.

2. **VACUUM FULL을 운영 시간에 실행**  
   → 락/중단 위험이 큽니다. FULL은 마지막 카드로, 창구시간/이관 계획 포함해서 수행해야 합니다.

3. **ANALYZE 무시**  
   → 통계가 낡으면 실행계획이 틀어져 "왜 갑자기 느려졌지" 상황이 반복됩니다.

4. **인덱스 bloat를 테이블 bloat와 분리해서 보지 않음**  
   → 테이블만 정리해도 인덱스가 비대하면 성능이 안 돌아옵니다.

---

## 5) 운영 체크리스트 (실무형)

- `pg_stat_user_tables`에서 dead tuple 상위 테이블 주간 점검
- `last_autovacuum`이 장시간 비어 있는 테이블 식별
- 대형 파티션/핫 테이블의 scale factor 분리 설정
- 배포 직후 대량 UPDATE/DELETE 작업 시 수동 VACUUM 계획 포함
- 장애 리허설: "autovacuum backlog 폭증" 시 대응 runbook 준비

---

## 6) 연습 문제

1. 주문 이력 테이블(`orders_history`)이 하루 2천만 건 UPDATE 되는 환경을 가정하고,
   - 기본값 대비 어떤 파라미터를 얼마나 조정할지 제안해보세요.
2. dead tuple 비율이 25% 이상인 테이블 3개를 발견했을 때,
   - 즉시 조치 / 주간 조치 / 구조 개선(파티셔닝, 아카이빙)으로 나눠 액션을 정리해보세요.
3. "autovacuum을 더 세게 돌리니 API P95가 증가"하는 상황에서,
   - 시간대 기반 정책(업무시간/야간)으로 튜닝안을 설계해보세요.

---

## 요약

- PostgreSQL 성능 저하는 단순히 쿼리 문제만이 아니라, **MVCC 청소 지연** 문제일 때가 많습니다.
- Autovacuum 튜닝은 숫자 암기가 아니라, **테이블별 쓰기 패턴 + 운영 시간대**를 반영한 정책 문제입니다.
- 단기 응급처치(VACUUM)와 장기 구조 개선(파티셔닝/아카이빙)을 함께 가져가야 재발을 막을 수 있습니다.

---

## 🔗 관련 글 / 다음 글

- [SQL 성능 튜닝 Q&A](/learning/qna/sql-performance-tuning-qna/)
- [DB 인덱스 최적화 Q&A](/learning/qna/db-index-optimization-qna/)
- [다음 글: 트래픽 컷오버/마이그레이션 실전](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
