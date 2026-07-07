---
title: "백엔드 커리큘럼 심화: PostgreSQL 인덱스 쓰기 증폭 예산 플레이북"
date: 2026-07-07
draft: false
topic: "Database"
tags: ["PostgreSQL", "index", "Write Amplification", "WAL", "Autovacuum", "Performance"]
categories: ["Backend Deep Dive"]
description: "인덱스를 추가할 때 읽기 성능만 보지 않고 쓰기 지연, WAL, vacuum, bloat까지 예산으로 관리하는 실무 기준을 정리합니다."
module: "database"
study_order: 1182
summary: "PostgreSQL 인덱스 추가를 읽기 최적화가 아니라 쓰기 지연, WAL, autovacuum, replica lag까지 포함한 운영 예산으로 판단하는 플레이북입니다."
keywords: ["PostgreSQL index write amplification", "인덱스 쓰기 증폭", "WAL 예산", "unused index", "covering index 비용"]
key_takeaways:
  - "인덱스는 읽기 p95를 낮추는 대신 모든 쓰기 경로에 WAL, bloat, vacuum 비용을 추가한다."
  - "신규 인덱스 제안은 대상 쿼리, 기대 개선폭, 쓰기 영향, 크기 추정, 롤백 방법을 함께 남겨야 한다."
  - "unused index는 단순 낭비가 아니라 장애 복구, 백필, replication catch-up 비용을 키우는 증폭기다."
operator_checklist:
  - "핫 테이블별 인덱스 수, index/table size 비율, scan 0 후보를 30~60일 기준으로 확인한다."
  - "새 인덱스 추가 전후 대상 API p95, 쓰기 p95, WAL bytes/sec, replica lag를 같은 기간으로 비교한다."
  - "covering index에는 자주 갱신되는 컬럼을 넣지 않고, projection 축소나 partial index 대안을 먼저 검토한다."
learning_refs:
  - title: "DB 인덱싱 기본"
    href: "/learning/deep-dive/deep-dive-database-indexing/"
    description: "B-Tree와 복합 인덱스 선택도부터 먼저 잡아야 쓰기 증폭 예산을 올바르게 비교할 수 있습니다."
  - title: "Partial Index와 Covering Index"
    href: "/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/"
    description: "전체 인덱스 대신 조건부·커버링 인덱스로 읽기 성능과 유지 비용을 조절하는 기준입니다."
  - title: "PostgreSQL Index Bloat/Reindex 플레이북"
    href: "/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/"
    description: "쓰기 증폭이 누적된 뒤 bloat, REINDEX, fillfactor로 이어지는 운영 대응을 다룹니다."
  - title: "PostgreSQL WAL과 Replication Lag"
    href: "/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/"
    description: "인덱스 추가가 WAL 생성량과 replica 적용 지연에 미치는 영향을 함께 판단하는 배경 글입니다."
faqs:
  - question: "인덱스가 많으면 읽기는 무조건 좋아지나요?"
    answer: "아닙니다. 일부 조회는 빨라질 수 있지만, 쓰기 지연과 WAL, autovacuum, bloat 비용이 늘어 전체 시스템 기준으로 손해가 될 수 있습니다."
  - question: "idx_scan이 0이면 바로 삭제해도 되나요?"
    answer: "바로 삭제하면 위험합니다. 월말 배치, 장애 대응 쿼리, 수동 운영 쿼리처럼 드문 사용이 있을 수 있어 30~60일 관측과 업무 캘린더 대조가 필요합니다."
  - question: "covering index는 언제 줄여야 하나요?"
    answer: "included column에 자주 갱신되는 필드가 많거나 index size가 테이블의 30~50%를 넘기 시작하면 projection 축소, partial index, read model 분리를 검토하는 편이 안전합니다."
---

백엔드 성능 튜닝에서 인덱스는 가장 빨리 효과가 보이는 도구입니다. 느린 목록 API에 복합 인덱스를 추가하면 `EXPLAIN`이 좋아지고, p95가 내려가고, 사용자 화면도 즉시 빨라질 수 있습니다. 문제는 인덱스가 읽기 경로의 최적화인 동시에 **모든 쓰기 경로의 비용 증가 요인**이라는 점입니다. `INSERT`, `UPDATE`, `DELETE`는 본문 테이블만 바꾸는 것이 아니라 관련 인덱스도 같이 갱신합니다. 인덱스가 많아질수록 WAL 생성량, 버퍼 dirty page, autovacuum 작업량, checkpoint 압력이 함께 늘어납니다.

그래서 운영 단계의 인덱스 설계는 "이 쿼리가 빨라지는가"에서 끝나면 안 됩니다. "이 인덱스가 초당 쓰기량, 배치, 복제 지연, vacuum, 장애 복구 시간에 얼마의 비용을 추가하는가"까지 봐야 합니다. 이 글은 [DB 인덱싱 기본](/learning/deep-dive/deep-dive-database-indexing/), [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/), [PostgreSQL Index Bloat/Reindex 플레이북](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/), [PostgreSQL WAL과 Replication Lag](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/)와 이어지는 실무 기준입니다.

## 이 글에서 얻는 것

- 인덱스가 쓰기 경로에서 어떤 방식으로 write amplification을 만드는지 설명할 수 있습니다.
- 신규 인덱스를 추가할 때 읽기 개선폭과 쓰기 비용을 함께 비교하는 기준을 잡을 수 있습니다.
- `pg_stat_user_indexes`, WAL 생성량, autovacuum 지표, p95 쓰기 지연을 묶어 인덱스 유지/삭제/분리 판단을 할 수 있습니다.
- 운영 DB에서 "인덱스 하나 더"가 언제 안전하고 언제 위험한지 숫자로 의사결정할 수 있습니다.

## 핵심 개념/이슈

### 1) 인덱스는 읽기 최적화이지만 쓰기마다 세금을 걷는다

테이블에 인덱스가 1개 있으면 row 변경 시 그 인덱스도 관리해야 합니다. 인덱스가 8개면 같은 업무 쓰기 하나가 8개의 보조 구조를 건드립니다. 특히 UPDATE가 인덱스 컬럼을 바꾸면 기존 인덱스 엔트리를 무효화하고 새 엔트리를 추가해야 하며, HOT update가 깨질 가능성도 커집니다.

실무에서 위험 신호는 아래 조합으로 나타납니다.

- 쓰기 API p95가 30ms에서 80ms 이상으로 상승
- WAL bytes/sec가 평시 대비 2~3배 증가
- 같은 트래픽인데 replica lag가 반복적으로 5초 이상 튐
- autovacuum이 핫 테이블을 계속 따라가지 못함
- unused index가 쌓였는데 신규 인덱스 요청은 계속 들어옴

읽기 하나가 빨라졌더라도 쓰기와 복제 경로가 악화되면 전체 시스템 기준으로는 손해일 수 있습니다.

### 2) 인덱스 개수보다 "쓰기 대상 컬럼과 변경 빈도"가 더 중요하다

모든 인덱스가 같은 비용을 만들지는 않습니다. 거의 변하지 않는 `created_at`, `tenant_id`, `status` 조합 인덱스와, 매번 바뀌는 `updated_at`, `last_seen_at`, `retry_count` 인덱스는 위험도가 다릅니다. 자주 갱신되는 컬럼이 인덱스에 포함되면 UPDATE가 사실상 DELETE+INSERT에 가까워지고, bloat와 WAL이 빨리 늘어납니다.

인덱스 후보를 볼 때는 다음 질문을 먼저 던집니다.

- 이 인덱스의 선두 컬럼은 실제 필터 선택도를 높이는가?
- 포함 컬럼 중 UPDATE 빈도가 높은 필드가 있는가?
- 이 인덱스가 없을 때 느린 쿼리는 사용자 영향이 큰가, 운영 리포트성인가?
- 같은 목적을 partial index나 projection 축소로 해결할 수 있는가?
- 인덱스 추가 후 쓰기 p95와 WAL이 얼마나 늘어도 허용 가능한가?

특히 `updated_at DESC` 목록을 위해 무작정 인덱스를 추가하는 패턴은 조심해야 합니다. 최신순 조회는 편하지만, 모든 갱신이 인덱스 정렬 공간을 흔들 수 있습니다.

### 3) covering index는 빠르지만 공짜가 아니다

Covering index는 본문 테이블 재접근을 줄여 목록 API를 크게 빠르게 만들 수 있습니다. 하지만 결과 컬럼을 많이 넣을수록 인덱스 크기가 커지고, 캐시 효율과 쓰기 비용이 나빠집니다. 목록 API 하나를 위해 12개 컬럼을 인덱스에 포함하면 읽기 p95는 내려갈 수 있지만, 쓰기 경로와 vacuum 비용은 꾸준히 올라갑니다.

권장 기준은 보수적으로 잡는 편이 좋습니다.

- 목록 API projection은 먼저 5~8개 필드 이하로 줄인다.
- covering index의 included column은 자주 바뀌지 않는 필드만 넣는다.
- 결과 row가 20~100개인 화면은 covering 효과가 크지만, export/대량 조회는 별도 파이프라인을 검토한다.
- 인덱스 크기가 원본 테이블의 30~50%를 넘기 시작하면 유지 가치를 다시 본다.

이 판단은 [대용량 Export 파이프라인](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)과도 연결됩니다. 화면 조회 최적화와 대량 산출물 생성을 같은 인덱스로 해결하려 하면 양쪽 모두 어정쩡해질 수 있습니다.

### 4) unused index는 단순 낭비가 아니라 장애 증폭기다

사용되지 않는 인덱스는 읽기 이득은 거의 없고 쓰기 비용만 계속 만듭니다. 운영 DB에서 인덱스를 추가하는 일은 쉽지만 삭제하는 일은 어렵기 때문에 unused index가 방치되기 쉽습니다. 그런데 장애 때는 이 방치가 비용으로 돌아옵니다. 대량 업데이트, 백필, 장애 복구, reindex, replication catch-up 모두 인덱스 수에 영향을 받습니다.

다만 `idx_scan = 0`만 보고 바로 지우면 위험합니다. 월말 정산, 분기 리포트, 수동 운영 쿼리처럼 드물지만 중요한 사용이 있을 수 있기 때문입니다. 최소 30~60일 관측, slow query log, 업무 캘린더, 릴리스 이벤트를 함께 봐야 합니다.

## 실무 적용

### 1) 신규 인덱스 제안서에 쓰기 예산을 포함한다

인덱스 PR 또는 migration에는 최소 아래 항목을 붙입니다.

| 항목 | 기준 |
| --- | --- |
| 대상 쿼리 | 실제 SQL, 호출 API, RPS, p95 |
| 기대 효과 | p95 20% 이상 개선 또는 DB CPU/IO 유의미 감소 |
| 쓰기 영향 | INSERT/UPDATE/DELETE 대상 경로와 피크 RPS |
| 크기 추정 | 예상 index size, 테이블 대비 비율 |
| WAL 영향 | staging 또는 샘플 부하에서 WAL 증가율 |
| 롤백 | `DROP INDEX CONCURRENTLY` 가능 여부와 시간 |

작은 서비스에서는 이 표가 과해 보일 수 있습니다. 하지만 핫 테이블에는 인덱스 하나가 몇 달 뒤 장애 비용으로 돌아오기 때문에, 최소한 "왜 추가했고 언제 지울 수 있는가"는 남겨야 합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **핵심 읽기 SLA 개선 > 쓰기 안정성 유지 > 운영 복잡도 최소화** 순서가 안전합니다.

- 읽기 p95 개선이 15% 미만이고 호출량도 낮으면 인덱스보다 쿼리/화면 요구를 재검토합니다.
- 쓰기 p95가 20% 이상 악화되거나 WAL bytes/sec가 2배 이상 늘면 인덱스 폭을 줄입니다.
- 테이블당 인덱스가 8~10개를 넘으면 신규 추가보다 unused/overlap 정리를 먼저 합니다.
- 특정 인덱스가 30일 동안 scan 0이고 업무상 월간 배치도 없으면 삭제 후보로 올립니다.
- 대형 테이블 인덱스 추가는 `CREATE INDEX CONCURRENTLY`를 기본으로 보고, 실패 시 재시도 시간을 계획합니다.

읽기 장애가 P0이고 쓰기량이 낮은 테이블이라면 공격적으로 추가할 수 있습니다. 반대로 주문, 결제, 이벤트 원장처럼 쓰기량과 복제 안정성이 중요한 테이블은 partial index, materialized view, read model 분리를 먼저 검토합니다.

### 3) 운영 대시보드에서 같이 볼 지표

인덱스 효과는 `EXPLAIN` 하나로 끝나지 않습니다. 변경 전후 7일 단위로 아래를 같이 봅니다.

- 대상 API p50/p95/p99
- 쓰기 API p95와 timeout 비율
- `pg_stat_user_indexes.idx_scan`, `idx_tup_read`, `idx_tup_fetch`
- index/table size 증가율
- WAL bytes/sec, checkpoint write time
- autovacuum duration, dead tuple 증가율
- replica lag seconds/bytes

이 조합을 보면 "읽기는 빨라졌지만 쓰기와 복제가 악화된 인덱스"를 조기에 잡을 수 있습니다.

## 트레이드오프/주의점

첫째, 너무 엄격한 인덱스 예산은 개발 속도를 늦출 수 있습니다. 모든 작은 테이블에 같은 절차를 적용하면 문서 비용이 더 큽니다. 기준은 핫 테이블, 대형 테이블, 쓰기 많은 테이블부터 적용하는 편이 현실적입니다.

둘째, 인덱스 삭제는 추가보다 더 조심해야 합니다. 드문 운영 쿼리, 장애 대응 쿼리, 월말 배치가 의존할 수 있습니다. 삭제 전에는 후보 기간을 두고, 영향 쿼리와 롤백 절차를 확인합니다.

셋째, partial index는 강력하지만 쿼리 조건과 정확히 맞아야 합니다. 애플리케이션 조건이 조금만 달라져도 planner가 쓰지 못할 수 있으므로, 주요 ORM 쿼리와 실제 SQL을 확인해야 합니다.

넷째, 인덱스는 스키마 계약입니다. API 요구가 바뀌면 인덱스도 같이 낡습니다. 인덱스 소유자와 리뷰 주기가 없으면 최적화가 기술 부채로 바뀝니다.

## 체크리스트 또는 연습

- [ ] 핫 테이블별 인덱스 수, 총 index size, table 대비 비율을 확인했다.
- [ ] 신규 인덱스마다 대상 쿼리, 기대 p95 개선, 쓰기 영향, 롤백 방법을 적었다.
- [ ] 30~60일 기준 unused index 후보를 뽑고 업무 캘린더와 대조했다.
- [ ] covering index의 included column 중 자주 갱신되는 필드를 제거할 수 있는지 봤다.
- [ ] 인덱스 추가 전후 WAL, replica lag, autovacuum duration을 비교했다.

연습 과제:

1. `pg_stat_user_indexes`에서 scan이 낮고 size가 큰 인덱스 상위 10개를 뽑아 삭제 후보, 보류 후보, 유지 후보로 나눠 보세요.
2. 느린 목록 API 하나를 골라 covering index와 partial index 두 안을 비교하고, 읽기 p95와 쓰기 비용을 표로 정리해 보세요.
3. 쓰기 많은 테이블 하나에 대해 "인덱스 추가 가능 예산"을 정해 보세요. 예를 들어 쓰기 p95 20% 이상 악화 금지, WAL 2배 이상 증가 금지, index size/table size 50% 초과 금지처럼 숫자로 잡으면 됩니다.

좋은 인덱스 설계는 쿼리 하나를 빠르게 만드는 데서 끝나지 않습니다. 운영 데이터베이스 전체의 쓰기 예산 안에서 읽기 SLA를 맞추는 일입니다. 인덱스를 성능 보너스가 아니라 지속 비용이 있는 구조물로 보면, 추가와 삭제 모두 훨씬 책임 있게 결정할 수 있습니다.
