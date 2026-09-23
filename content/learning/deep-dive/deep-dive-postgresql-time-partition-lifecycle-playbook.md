---
title: "백엔드 커리큘럼 심화: PostgreSQL 시간 파티션을 생성·보존·복구까지 운영하는 플레이북"
date: 2026-09-23
draft: false
topic: "Database Operations"
tags: ["PostgreSQL", "Table Partitioning", "Data Retention", "Database Operations", "Query Performance"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL 시간 파티션을 빠른 조회용 기능으로만 보지 않고, 미래 파티션 생성·인덱스·보존·detach·archive·복구 검증까지 포함한 운영 수명주기로 설계하는 기준을 정리합니다."
module: "backend-data-system"
study_order: 1512
keywords: ["PostgreSQL time partition lifecycle", "PostgreSQL partition retention", "detach partition archive", "partition maintenance"]
---

시간이 지날수록 커지는 주문 이력, 감사 이벤트, API 접근 로그, 사용량 원장은 처음에는 평범한 테이블로 시작해도 됩니다. 문제가 되는 시점은 보통 테이블 크기 자체가 아닙니다. 특정 기간을 지우는 배치가 오래 잠기고, 최근 7일 조회가 과거 수년치 인덱스와 경쟁하며, 장애 복구 때 어느 시점 데이터를 되살려야 하는지 불분명해지는 순간입니다. 이때 시간 파티션은 성능 튜닝 한 가지가 아니라 **데이터의 생성·활성·보존·분리·폐기·복구 경계를 DB 구조로 표현하는 방법**입니다.

하지만 파티션을 만들면 자동으로 빨라진다는 기대는 위험합니다. 쿼리가 파티션 키 조건을 쓰지 않거나, 미래 파티션을 미리 만들지 않거나, 보존 기한이 지난 파티션을 곧바로 `DROP`해 복구 근거를 잃으면 오히려 장애 대응이 어려워집니다. 이 글은 [Hot/Cold 데이터 계층화](/learning/deep-dive/deep-dive-hot-cold-data-tiering-archive-query-playbook/), [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [Online Schema Change Expand/Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/), [Restore Drill과 PITR](/learning/deep-dive/deep-dive-restore-drill-pitr-recovery-playbook/)을 연결해, 파티션을 운영 가능한 수명주기로 다룹니다.

## 이 글에서 얻는 것

- 시간 파티션이 맞는 테이블과 아직 단일 테이블·아카이브가 더 나은 테이블을 구분할 수 있습니다.
- 파티션 키, 월/일 단위, 인덱스, 고유성 제약을 쿼리·보존 정책 기준으로 결정할 수 있습니다.
- 미래 파티션 생성, `DETACH`, archive, `DROP`, 복구 확인을 하나의 런북으로 만들 수 있습니다.
- 누락 파티션·default partition 누적·보존 배치 실패를 사전에 발견하는 숫자 기준을 세울 수 있습니다.

## 핵심 개념/이슈

### 1) 시간 파티션의 첫 목적은 "삭제를 빠르게"가 아니라 데이터 경계를 명시하는 일이다

월별 `created_at` 파티션을 두면 최근 기간 조회에서 관련 파티션만 대상으로 삼는 partition pruning을 기대할 수 있습니다. 만료 데이터도 대량 `DELETE` 대신 오래된 파티션을 분리하거나 제거하는 방식으로 처리할 수 있습니다. 그러나 실무 가치의 핵심은 더 넓습니다. 어떤 데이터가 아직 온라인 업무에 필요한지, 어느 기간부터 archive로 옮길지, 복구 대상이 무엇인지가 테이블 구조와 운영 기록에 드러납니다.

다음 조건 중 **세 가지 이상**이면 시간 파티션 후보로 검토할 만합니다.

- 테이블이 5천만 row 또는 50GB를 넘고 계속 증가한다.
- 주요 조회의 80% 이상이 `created_at`, `occurred_at` 같은 시간 범위를 포함한다.
- 30일·90일·1년처럼 명시적인 보존 정책이 있고, 만료 데이터가 매달 전체의 5% 이상을 차지한다.
- 장기 데이터와 최근 데이터의 읽기 SLA가 다르다. 예를 들어 최근 주문 조회는 p95 200ms, 2년 전 감사 조회는 비동기 export가 허용된다.
- 백업·복구·정산 재현에서 특정 월 또는 특정 마감 기간을 별도로 증명해야 한다.

반대로 테이블이 커도 `id` 단건 조회가 대부분이고 시간 조건이 거의 없다면 파티션 수만 늘고 이득은 적습니다. 모든 파티션에 같은 인덱스를 유지해야 하므로 쓰기 증폭과 planning 비용도 생깁니다. 먼저 [쿼리 실행계획 회귀 방지](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/) 기준으로 실제 query fingerprint와 조건을 확인해야 합니다.

### 2) 파티션 키는 "가장 편한 timestamp"가 아니라 삭제·조회·정합성의 공통 경계여야 한다

`created_at`은 보편적인 선택이지만 항상 정답은 아닙니다. 감사 이벤트는 `occurred_at`, 사용량 과금은 계산 기준 시각, 정산은 업무 마감 시각이 더 중요할 수 있습니다. 키를 고를 때는 다음 질문에 모두 답해야 합니다.

1. 만료·archive·복구를 어느 시각 경계로 실행할 것인가?
2. 상위 조회가 이 키를 범위 조건으로 실제 포함하는가?
3. 늦게 도착한 이벤트가 과거 파티션으로 들어가도 되는가, 그리고 그 기간을 아직 online으로 유지하는가?
4. UTC와 사업일이 다를 때 어느 값을 파티션 경계로 사용할 것인가?

운영 테이블의 물리 경계는 보통 `timestamptz`를 UTC 기준으로 잡고, "한국 영업일" 같은 도메인 규칙은 별도의 `business_date`로 계산하는 편이 안전합니다. `2026-09-30 16:30 UTC`가 KST에서는 다음 날짜라는 사실을 파티션 경계와 마감 규칙에 섞으면, 월말에만 재현되는 오류가 생깁니다. 업무 마감의 의미는 [Business Calendar와 Cutoff Policy](/learning/deep-dive/deep-dive-business-calendar-cutoff-policy-playbook/)처럼 정책 버전과 함께 다뤄야 합니다.

단위는 처음부터 잘게 쪼개지 않습니다. 월 파티션은 대부분의 주문·감사·이벤트 테이블에 좋은 출발점입니다. 일 파티션은 하루 단위가 수십 GB 이상이거나 삭제·복구 경계가 일 단위로 꼭 필요한 경우에만 고려합니다. 운영 시작값으로는 **향후 2개 파티션을 미리 만들고, 온라인 파티션 수는 12~24개 이내**로 유지하는 편이 관리 비용과 효용의 균형이 좋습니다. 실제 단위는 하루 유입량, 인덱스 크기, retention, 대표 쿼리의 `EXPLAIN`으로 조정합니다.

### 3) 제약과 인덱스는 부모 테이블 정의만 보고 끝나지 않는다

시간 파티션에서 자주 놓치는 제약은 고유성입니다. PostgreSQL의 partitioned table에서 전역 `UNIQUE` 또는 `PRIMARY KEY`를 만들려면 일반적으로 파티션 키가 제약에 포함돼야 합니다. 즉 `event_id`만 전역으로 유일하다고 가정하고 `UNIQUE(event_id)`를 붙이는 설계는 그대로 성립하지 않을 수 있습니다. `UNIQUE(occurred_at, event_id)`가 비즈니스상 충분한지, 아니면 별도의 dedup registry가 필요한지 먼저 결정해야 합니다.

인덱스도 같은 원칙입니다. 최근 조회가 `tenant_id + occurred_at`이라면 각 파티션에 이 순서의 B-tree 인덱스가 필요합니다. 범위가 넓고 append-only인 로그성 데이터는 BRIN이 공간을 크게 줄일 수 있지만, 테넌트별 좁은 검색을 대신하지는 못합니다. 한 인덱스로 모든 검색을 해결하려 하지 말고 아래처럼 역할을 나눕니다.

| 경로 | 시작 인덱스 | 확인할 조건 |
| --- | --- | --- |
| 최근 테넌트 이벤트 | `(tenant_id, occurred_at DESC)` | tenant filter와 기간 조건이 함께 있는가 |
| 전체 기간 감사 조회 | `(occurred_at DESC)` 또는 BRIN | 기간 범위가 넓고 append-only인가 |
| 단일 event 재수신 확인 | `(occurred_at, event_id)` + 별도 dedup 정책 | 전역 유일성 요구가 실제로 있는가 |
| archive 조회 | 별도 archive 인덱스 | online 경로의 p95와 같은 SLA가 필요한가 |

새 부모 테이블을 만든 뒤 인덱스를 나중에 떠올리면 새 파티션만 느리거나, 과거 파티션마다 수동 DDL이 달라지기 쉽습니다. template DDL과 schema version을 Git으로 관리하고, 파티션 생성 job이 같은 인덱스·권한·통계 설정을 적용하도록 고정하세요.

## 실무 적용

### 1) 기본 구조는 "생성 전 준비 → 활성 사용 → 분리 → archive → 폐기"다

아래 예시는 `occurred_at`을 UTC 월 경계로 쓰는 append-only 이벤트 테이블의 출발점입니다.

```sql
CREATE TABLE audit_event (
  occurred_at  timestamptz NOT NULL,
  event_id     uuid        NOT NULL,
  tenant_id    bigint      NOT NULL,
  event_type   text        NOT NULL,
  payload      jsonb       NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (occurred_at, event_id)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_event_2026_10
  PARTITION OF audit_event
  FOR VALUES FROM ('2026-10-01 00:00:00+00')
               TO ('2026-11-01 00:00:00+00');

CREATE INDEX audit_event_2026_10_tenant_time_idx
  ON audit_event_2026_10 (tenant_id, occurred_at DESC);
```

중요한 것은 SQL 자체보다 lifecycle입니다.

1. **미리 생성**: 매일 job이 현재 월과 다음 2개월 파티션의 존재, 인덱스, owner를 검사한다.
2. **활성 구간**: 최근 90일처럼 온라인 조회가 많은 기간은 표준 인덱스와 backup 검증을 유지한다.
3. **분리 후보**: retention 이전이지만 감사·재처리 요청이 남은 기간은 `DETACH PARTITION` 후 read-only archive 대상으로 전환한다.
4. **archive 검증**: row count, 최소·최대 timestamp, checksum 또는 manifest, 복구 위치를 기록한다.
5. **폐기**: 보존 기한과 legal hold를 모두 통과한 뒤에만 `DROP`한다.

여기서 `DEFAULT` 파티션은 장애 방지용 임시 안전망일 뿐 정상 경로가 아닙니다. 미래 파티션 누락으로 모든 신규 row가 default에 쌓이면, 나중에 데이터를 옮기는 작업이 긴 lock과 대량 I/O를 만들 수 있습니다. default row 수는 **0이 정상**, 1건 이상이면 경고, 100건 이상이면 생성 job·timezone·late event 정책을 즉시 점검하는 기준으로 두는 편이 좋습니다.

### 2) 보존 작업은 `DROP` 명령 하나가 아니라 승인 가능한 change set이어야 한다

만료 파티션을 제거하기 전, 다음 네 항목을 하나의 manifest로 남깁니다.

- 대상 partition 이름, 시작·끝 시각, row count, 데이터 크기
- retention policy version, legal hold 확인 결과, 담당 owner
- archive object URI 또는 restore 가능한 backup reference와 checksum
- `DETACH`/`DROP` 실행자, 승인 ticket, 실행 시각, 사후 검증 결과

개인정보 삭제 요청이 있는 테이블은 더 조심해야 합니다. 파티션 전체 제거는 효율적이지만 한 사용자만 즉시 지워야 하는 요구에는 맞지 않을 수 있습니다. row-level deletion, tombstone, key destruction, archive 재작성 중 어떤 방식을 쓸지 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)의 데이터 분류 기준으로 정합니다. "월 파티션이니 이번 달 데이터는 못 지운다"는 제품·법무 요구를 바꾸는 근거가 될 수 없습니다.

### 3) 4주 도입 플랜과 승인 기준

**1주차 — 측정과 경계 확정**: Top 20 query fingerprint를 뽑아 시간 조건 포함률, p95, scan row, retention 정책을 기록합니다. 테이블 growth, 월별 row/size, 늦은 이벤트 p99도 같이 봅니다.

**2주차 — 빈 테이블에서 DDL 검증**: staging에 부모·2개 미래 파티션·대표 인덱스를 만들고, normal insert, late insert, 누락 파티션, unique conflict, 대표 범위 조회를 통합 테스트합니다. 기존 대형 테이블을 바로 쪼개지 않습니다.

**3주차 — 작은 기간 canary**: 신규 데이터만 새 partitioned table에 dual-write하거나, 위험이 낮은 이벤트 테이블 하나를 대상으로 합니다. 대표 query의 p95가 기존 대비 **10% 이내**, insert error가 **0.01% 미만**, default partition row가 **0**인 상태를 7일 확인합니다.

**4주차 — archive와 restore drill**: 오래된 파티션 하나를 detach해 archive하고, 격리 DB에서 row count·범위·표본 hash를 비교한 뒤 필요한 조회를 재현합니다. 데이터가 "옮겨졌다"가 아니라 **복구해 읽을 수 있다**가 완료 기준입니다.

중단·되돌림 기준도 사전에 고정합니다.

- 새 파티션 쓰기 오류가 5분 동안 0.1%를 넘으면 신규 write 전환을 멈춘다.
- 대표 API p95가 baseline 대비 20% 이상 악화되고 pruning 미적용이 확인되면 query·index를 먼저 고친다.
- default partition에 100건 이상 누적되거나 미래 파티션이 14일 이내에 없으면 보존 작업보다 생성 경로를 우선 복구한다.
- archive 검증에서 row count 또는 시간 범위가 불일치하면 `DROP`을 금지하고 detach 상태를 유지한다.

## 트레이드오프/주의점

1. **파티션이 많다고 pruning이 좋아지지 않는다.** 너무 작은 단위는 planner·autovacuum·인덱스·백업 관리 비용을 늘립니다. query 조건과 retention 경계가 설명하는 최소 단위부터 시작하세요.
2. **시간 조건 없는 쿼리는 여전히 비싸다.** `WHERE tenant_id = ?`만으로 수년치 파티션을 찾는 경로는 파티션화 뒤에도 비용이 큽니다. 제품 API에 기간·cursor·보존 범위를 드러내야 합니다.
3. **늦은 이벤트는 예외가 아니라 정책 문제다.** 과거 90일 이벤트를 받을 수 있다면 해당 파티션을 detach하지 않거나, 별도 correction path와 audit reason을 둬야 합니다.
4. **분리와 폐기를 혼동하면 복구 창을 잃는다.** `DETACH`는 online 부모에서 경계를 분리하는 일이고, `DROP`은 복구 근거까지 없애는 일입니다. 둘 사이에 archive 검증과 승인 단계를 둡니다.
5. **단일 테이블 마이그레이션은 별도 프로젝트다.** 부모 테이블 선언만 바꿀 수 없으며 data copy, write cutover, foreign key, index, rollback을 검증해야 합니다. [Online Schema Change Expand/Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)처럼 expand와 contract를 분리합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 파티션 키가 조회·retention·복구 경계를 함께 설명한다.
- [ ] 현재와 다음 2개 이상 파티션, 동일한 인덱스·권한·owner가 자동으로 준비된다.
- [ ] default partition은 0건을 정상값으로 모니터링한다.
- [ ] unique key가 partition key를 포함하는 제약과 비즈니스 dedup 요구를 모두 만족한다.
- [ ] detach 전 manifest에 row count, 시간 범위, archive reference, policy version, 승인자가 남는다.
- [ ] archive 파티션 1개를 격리 환경에 restore해 대표 조회와 count를 검증했다.
- [ ] late event와 개인정보 즉시 삭제 요구를 각각 어떤 경로로 처리할지 문서화했다.

### 연습 과제

현재 가장 빨리 커지는 테이블 하나를 골라 최근 30일 query log를 분석해 보세요. 시간 범위 조건이 있는 호출 비율, 월별 row/size, 늦은 이벤트 p99, 보존 기한을 한 표에 적습니다. 이어서 월 파티션과 일 파티션 두 안을 놓고, "파티션당 예상 크기", "유지할 온라인 파티션 수", "archive 전 detach 기간", "복구 검증 시간"을 숫자로 비교하면 파티션이 필요한지와 단위를 더 명확하게 결정할 수 있습니다.

## 관련 글

- [Hot/Cold 데이터 계층화와 Archive Query](/learning/deep-dive/deep-dive-hot-cold-data-tiering-archive-query-playbook/)
- [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
- [PostgreSQL 인덱스 Bloat와 Reindex/Fillfactor](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/)
- [실행계획 회귀 방지 가드레일](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)
- [Restore Drill과 PITR Recovery](/learning/deep-dive/deep-dive-restore-drill-pitr-recovery-playbook/)
