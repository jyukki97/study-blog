---
title: "백엔드 커리큘럼 심화: PostgreSQL Index-Only Scan과 Visibility Map, 빠른 조회를 유지하는 운영 플레이북"
date: 2026-10-16T10:06:00+09:00
lastmod: 2026-10-16T10:06:00+09:00
draft: false
topic: "Backend Data Operations"
tags: ["PostgreSQL", "Index-Only Scan", "Visibility Map", "Autovacuum", "Query Performance", "Database Operations"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL index-only scan이 heap 조회를 줄이는 조건과 visibility map, autovacuum, 쓰기 패턴을 함께 운영하는 기준을 정리합니다."
summary: "Index-only scan은 인덱스에 필요한 열을 넣었다고 자동으로 완성되지 않는다. MVCC 가시성을 heap에서 다시 확인하지 않아도 되는 page 비율, autovacuum 지연, 업데이트 빈도, 포함 열의 쓰기 비용을 함께 관리해야 읽기 이득이 지속된다."
module: "data-system"
study_order: 1560
keywords: ["PostgreSQL index-only scan", "visibility map", "Heap Fetches", "autovacuum performance", "covering index"]
key_takeaways:
  - "Index-only scan은 인덱스가 모든 반환 열을 갖고 있다는 사실과 heap page가 all-visible이라는 사실이 함께 충족될 때 heap 접근을 크게 줄인다."
  - "EXPLAIN의 Index Only Scan 노드만으로 성공을 판단하지 말고 Heap Fetches, shared buffer read, 실제 rows와 실행 시간의 변화를 같이 본다."
  - "읽기 최적화용 INCLUDE 열과 넓은 인덱스는 업데이트·VACUUM·스토리지 비용을 높일 수 있으므로 안정된 읽기 경로에만 제한적으로 적용한다."
operator_checklist:
  - "후보 쿼리는 반환 열, 필터 선택도, 업데이트 빈도, 예상 호출 수를 함께 기록하고 단순히 SELECT 열이 많다는 이유로 covering index를 만들지 않는다."
  - "autovacuum 지연, dead tuple, visibility map coverage, Heap Fetches/row 비율을 같은 기간의 쓰기량과 함께 관찰한다."
  - "인덱스 추가 전후에는 representative parameter로 EXPLAIN (ANALYZE, BUFFERS)을 비교하고, 롤백할 index drop 조건과 관찰 기간을 정한다."
---

목록 화면, 주문 이력, 운영 대시보드처럼 같은 조회가 매우 자주 실행되는 서비스에서는 인덱스를 추가하는 것만으로도 체감 성능이 좋아질 수 있습니다. 그러나 PostgreSQL에서 `Index Only Scan`이 보인다고 해서 데이터 page를 전혀 읽지 않는 것은 아닙니다. PostgreSQL은 MVCC 규칙 때문에 “이 row가 지금 트랜잭션에서 보이는가”를 확인해야 하고, 그 확인을 heap page에서 다시 해야 하는 경우가 있기 때문입니다.

이 차이를 이해하지 못하면 반환 열을 인덱스에 계속 넣은 뒤에도 `Heap Fetches`가 높게 남는 상황을 설명하지 못합니다. 반대로 가시성 상태와 쓰기 패턴을 함께 보면, 어느 조회에 covering index가 가치 있는지와 autovacuum 지연이 왜 읽기 지연으로 나타나는지를 연결할 수 있습니다. 이 글은 [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/), [Index Bloat·REINDEX·Fillfactor](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/), [실행계획 회귀 방지 가드레일](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/), [XID Wraparound과 Freeze](/learning/deep-dive/2026-10-10-postgresql-xid-wraparound-freeze-playbook/)의 원칙을 index-only scan 운영으로 묶습니다.

## 이 글에서 얻는 것

- `Index Scan`, `Index Only Scan`, heap fetch가 각각 무엇을 줄이고 무엇을 보장하지 않는지 구분할 수 있습니다.
- visibility map과 autovacuum이 읽기 성능에 영향을 주는 이유를 MVCC 관점에서 설명할 수 있습니다.
- `EXPLAIN (ANALYZE, BUFFERS)` 결과를 보고 covering index를 유지·수정·제거할 판단 기준을 세울 수 있습니다.
- 읽기 속도를 높이려다 쓰기 증폭과 인덱스 bloat를 키우지 않도록 적용 순서를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 인덱스가 열을 갖고 있어도 MVCC 확인은 남는다

일반 `Index Scan`은 인덱스에서 조건에 맞는 tuple 위치(TID)를 찾고, heap table에서 실제 row와 가시성을 확인합니다. `Index Only Scan`은 SELECT에 필요한 열이 인덱스 key 또는 `INCLUDE` 열에 모두 있을 때 heap의 **값**을 읽지 않고 결과를 만들 수 있습니다. 하지만 인덱스에는 각 row version이 모든 active transaction에 보이는지에 대한 완전한 정보가 없습니다.

PostgreSQL은 heap page 단위의 visibility map에 그 page가 모든 transaction에 보인다는 `all-visible` 상태를 기록합니다. 대상 TID가 all-visible page에 있으면 executor는 heap을 다시 볼 필요가 없습니다. 그렇지 않으면 이름은 Index Only Scan이어도 heap을 방문해 visibility를 확인합니다. 따라서 핵심 질문은 “인덱스에 컬럼을 넣었는가”가 아니라 **자주 읽는 row가 얼마나 오랫동안 all-visible 상태로 남는가**입니다.

| 상태 | 실행 중 일어나는 일 | 운영 해석 |
| --- | --- | --- |
| Index Scan | 인덱스로 TID를 찾고 heap에서 값·가시성을 확인 | 선택도는 좋지만 heap I/O가 병목일 수 있음 |
| Index Only Scan + 낮은 Heap Fetches | 인덱스 값과 visibility map으로 대부분 결과 반환 | 안정적인 읽기 경로의 좋은 후보 |
| Index Only Scan + 높은 Heap Fetches | 가시성 확인을 위해 heap page를 자주 방문 | 인덱스 구조보다 최근 쓰기·VACUUM 지연을 먼저 확인 |
| Seq Scan | planner가 넓은 범위 읽기가 더 싸다고 판단 | 인덱스를 강제하기 전에 통계·조건·페이지 수를 확인 |

### 2) autovacuum은 공간 정리만이 아니라 읽기 경로의 조력자다

UPDATE나 DELETE는 기존 tuple을 즉시 지우지 않고 dead tuple을 남깁니다. 새 row version이 만들어진 page는 all-visible 조건을 잃기 쉽고, VACUUM이 dead tuple을 처리하고 visibility map을 다시 설정하기 전까지 index-only scan은 heap 확인을 더 자주 합니다. 대량 상태 변경, 최근 1시간 데이터에 집중된 업데이트, 오래 밀린 autovacuum은 모두 같은 조회의 heap fetch를 올릴 수 있습니다.

여기서 “VACUUM을 더 자주 돌리면 된다”는 처방은 충분하지 않습니다. autovacuum worker가 부족하거나 cost limit이 너무 낮으면 처리량을 따라가지 못하고, 반대로 모든 table의 threshold를 공격적으로 낮추면 I/O 경쟁과 운영 복잡도가 커집니다. 우선 최근 쓰기량이 높고 index-only scan이 실제 사용자 지연에 영향을 주는 table을 좁히세요. 그 table에만 `n_dead_tup` 추세, 마지막 autovacuum 시각, vacuum 실행 시간, Heap Fetches를 묶어 관찰하는 편이 안전합니다.

### 3) Heap Fetches는 비율과 시간축으로 읽는다

다음처럼 같은 parameter와 통계 조건에서 실행계획을 비교합니다.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT order_id, created_at, status
FROM orders
WHERE customer_id = $1
  AND status = 'PAID'
ORDER BY created_at DESC
LIMIT 50;
```

`Index Only Scan` 아래의 `Heap Fetches: 0`은 매우 좋은 한 번의 표본이지만, 성공 선언의 근거로는 약합니다. 50행을 반환하는 안정된 목록 조회라면 관찰 기간의 중앙값에서 `Heap Fetches / actual rows`가 0.05 이하인지처럼 비율로 봅니다. 비율이 1에 가까워지거나 p95 실행 시간이 기준선보다 20% 이상 늘었으면, 새 인덱스를 더하는 대신 최근 UPDATE 집중·autovacuum 지연·통계 변화·cache miss를 차례로 확인합니다. 이 수치는 서비스별 출발점이며, 월말 처리처럼 원래 쓰기량이 급증하는 구간에는 별도 기준선을 둬야 합니다.

`BUFFERS`도 함께 봐야 합니다. Heap Fetches가 줄었는데 shared hit가 크게 늘거나 인덱스가 너무 커져 cache에서 밀려나면 전체 이득은 사라질 수 있습니다. 반대로 heap read가 줄고 p95가 개선되며 index write 비용이 예산 안에 있으면, index-only scan은 단순 plan 이름이 아니라 실제 성능 계약이 됩니다.

## 실무 적용

### 1) 후보를 ‘자주 읽고, 덜 바뀌며, 좁게 반환되는’ 경로로 제한한다

먼저 APM 또는 `pg_stat_statements`에서 호출 수 상위 쿼리를 고릅니다. 그중 다음 세 조건을 만족하는 경로가 첫 후보입니다.

1. 분당 호출이 높고 p95가 사용자 API 또는 운영 화면의 예산을 침범한다.
2. `WHERE`와 `ORDER BY`가 비교적 안정적이며 20~100행처럼 작은 결과를 반환한다.
3. 대상 row가 매 요청마다 UPDATE되지 않고, 최근 데이터만 계속 갱신하는 hot page에 과도하게 몰리지 않는다.

예를 들어 완료된 주문 이력은 `customer_id, status, created_at DESC` key와 `INCLUDE (order_id, total_amount)`를 검토할 수 있습니다. 단, 금액·상태를 계속 갱신하는 진행 중 주문을 같은 인덱스에 넓게 넣으면 인덱스 갱신과 page split 비용이 커질 수 있습니다. 완료 이력과 진행 중 주문을 같은 query로 처리하지 말고, 제품 요구가 허용하면 상태별 partial index 또는 read model 분리를 먼저 비교합니다.

### 2) 배포 전후의 판단 레코드를 남긴다

새 index는 `CREATE INDEX CONCURRENTLY`로 만들더라도 비용이 없는 변경이 아닙니다. migration마다 다음 레코드를 남기면 나중에 “인덱스가 있는데 왜 느린가”를 재구성하기 쉽습니다.

| 항목 | 예시 기준 | 결정에 쓰는 이유 |
| --- | --- | --- |
| query fingerprint·대표 parameter | 상위 3개 customer 규모를 포함 | 작은 테스트 데이터 편향 방지 |
| p50/p95와 rows | 배포 전 7일 기준선 | 체감 개선과 회귀 분리 |
| Heap Fetches/row | 중앙값 0.05 이하를 목표로 시작 | visibility 효과를 수치화 |
| index size와 table size | index가 table의 30%를 넘으면 재검토 | cache·백업·쓰기 비용 감시 |
| write amplification | insert/update p95가 10% 이상 악화되면 조사 | 읽기 최적화가 쓰기 SLA를 침범하지 않게 함 |
| rollback 조건 | 7일 관찰 뒤 이득 없으면 drop 검토 | 영구적인 중복 인덱스 방지 |

처음에는 트래픽의 5%를 받는 read replica 또는 내부 조회에서 plan과 버퍼를 관찰하고, 최소 24시간의 정상·쓰기 피크를 지나야 합니다. 중요한 것은 `enable_seqscan` 같은 planner 강제로 성공을 만들지 않는 일입니다. 실제 데이터 분포와 통계 아래에서 planner가 고른 plan이 이겨야 운영에서도 유지됩니다.

### 3) VACUUM 정책은 table의 변화 속도에 맞춘다

모든 table에 동일한 `autovacuum_vacuum_scale_factor`를 적용하면 큰 append-only table과 작은 hot table 중 한쪽이 손해를 봅니다. 읽기 집중 table은 dead tuple 절대 수와 last autovacuum 지연을 함께 보고, 쓰기 급증 시간 전에 worker 여유를 확인합니다. 그렇다고 visibility map 비율을 위해 장기 transaction을 무시하면 안 됩니다. 오래 열린 transaction은 dead tuple 정리와 freeze를 막아 VACUUM의 효과를 떨어뜨릴 수 있으므로, idle-in-transaction timeout과 배치 transaction 크기도 같은 runbook에 포함하세요.

## 트레이드오프/주의점

첫째, `INCLUDE` 열은 조회를 편하게 만들지만 인덱스 tuple을 넓힙니다. 큰 JSON, 긴 text, 자주 바뀌는 열을 무심코 포함하면 index cache 효율과 write path가 나빠집니다. 반환을 위해 필요한 작은 scalar 열만 넣고, 큰 상세 payload는 별도 조회 또는 object storage URL로 분리하는 편이 낫습니다.

둘째, index-only scan은 warm cache에서 특히 좋아 보일 수 있습니다. cold cache, replica lag, 대량 backfill, VACUUM 실행 중에도 p95와 disk read가 예산 안인지 확인해야 합니다. 세 번째로, all-visible은 page 단위입니다. 같은 page의 일부 row만 자주 갱신돼도 인접한 오래된 row가 heap fetch를 피하지 못할 수 있습니다. 시간순 hot data를 같은 table에 몰아넣는 모델이라면 partitioning이나 데이터 lifecycle 설계가 인덱스 미세 조정보다 먼저일 수 있습니다.

마지막으로 index-only scan을 강한 정합성의 증거로 오해하지 마세요. 이것은 읽기 경로를 최적화하는 방식이지, replica가 최신인지나 서비스가 올바른 데이터를 보여 주는지를 보장하지 않습니다. 읽기/쓰기 복제, cache, 데이터 변경 이벤트가 있으면 [bounded staleness와 read-your-writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/) 같은 별도 정합성 계약이 필요합니다.

## 체크리스트 또는 연습

- [ ] 상위 조회 하나에 대해 `EXPLAIN (ANALYZE, BUFFERS)`를 대표 parameter 3개 이상으로 저장했다.
- [ ] 반환 열이 index key/`INCLUDE`에 있는지와 그 열의 UPDATE 빈도를 각각 확인했다.
- [ ] `Heap Fetches / actual rows`, p95, shared read, index size, write p95의 배포 전 기준선을 만들었다.
- [ ] 대상 table의 최근 autovacuum, dead tuple 추세, long transaction, worker 포화를 같이 점검했다.
- [ ] 5% canary와 최소 24시간 관찰 후에도 읽기 이득이 없으면 index를 제거하거나 query shape를 다시 설계한다.

연습으로 `orders` 같은 이력 table 하나를 골라 최근 7일과 90일 전 데이터를 각각 조회해 보세요. 같은 index-only plan이라도 최근 구간의 Heap Fetches가 높고 오래된 구간은 낮을 수 있습니다. 그 차이를 autovacuum 시각, UPDATE 수, buffer read와 연결해 한 장의 판단 레코드로 적어 보면, 인덱스 설계를 “컬럼을 추가하는 작업”에서 “데이터 변화와 읽기 비용을 관리하는 작업”으로 바꿀 수 있습니다.

## 관련 글

- [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/)
- [PostgreSQL Index Bloat·REINDEX·Fillfactor](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/)
- [실행계획 회귀 방지 가드레일](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)
- [PostgreSQL XID Wraparound과 Freeze](/learning/deep-dive/2026-10-10-postgresql-xid-wraparound-freeze-playbook/)
