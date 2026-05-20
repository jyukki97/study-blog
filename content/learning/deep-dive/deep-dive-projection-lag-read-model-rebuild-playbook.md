---
title: "백엔드 커리큘럼 심화: Projection Lag와 Read Model Rebuild 운영 플레이북"
date: 2026-05-09
draft: false
topic: "Event Driven Architecture"
tags: ["Projection Lag", "Read Model", "CQRS", "Event Driven", "Rebuild", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "이벤트 기반 시스템에서 read model projection lag, 재빌드, 백필, 체크포인트를 운영 기준으로 관리하는 방법을 숫자와 의사결정 기준 중심으로 정리합니다."
module: "backend-event-driven-architecture"
study_order: 1195
---

이벤트 기반 아키텍처를 도입하면 쓰기 모델과 읽기 모델을 분리할 수 있습니다. 주문 도메인은 이벤트를 발행하고, 검색 화면·정산 화면·관리자 대시보드는 각자 필요한 read model을 만들어 빠르게 조회합니다. 여기까지는 교과서적으로 좋아 보입니다. 문제는 운영에 들어간 뒤입니다. 이벤트는 쌓이는데 projector가 밀리고, 신규 컬럼 추가 때문에 전체 read model을 다시 만들고, 백필 작업이 운영 트래픽과 충돌하면서 "조회 화면이 맞는지" 아무도 확신하지 못하는 순간이 옵니다.

그래서 read model은 단순 캐시가 아니라 **재생 가능한 파생 데이터 제품**으로 다뤄야 합니다. 핵심 질문은 "eventual consistency니까 언젠가 맞겠지"가 아니라, **얼마나 늦어져도 되는가, 어디서부터 다시 만들 수 있는가, 재빌드 중 사용자에게 무엇을 보여줄 것인가**입니다. 이 글은 [Event Sourcing/CQRS](/learning/deep-dive/deep-dive-event-sourcing-cqrs/), [Kafka Consumer Lag](/learning/deep-dive/deep-dive-kafka-consumer-lag/), [Materialized View + Incremental Refresh](/learning/deep-dive/deep-dive-materialized-view-incremental-refresh-playbook/)를 운영 기준으로 묶어 정리합니다.

## 이 글에서 얻는 것

- projection lag를 단순 consumer lag가 아니라 사용자 신뢰도 지표로 해석할 수 있습니다.
- read model rebuild, backfill, dual read, cutover를 어떤 순서로 설계해야 하는지 기준을 잡을 수 있습니다.
- 이벤트 재처리 중 중복·순서 역전·스키마 변경·운영 부하를 숫자로 관리하는 방법을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Projection lag는 메시지 개수가 아니라 "업무 시간 차이"로 봐야 한다

Kafka나 Redis Streams 대시보드에서 consumer lag가 10,000이라고 찍히면 불안하지만, 숫자 자체만으로는 의미가 부족합니다. 이벤트가 초당 5만 개 들어오는 시스템의 10,000 lag는 0.2초 지연일 수 있고, 하루 1,000건 처리하는 정산 배치의 10,000 lag는 며칠치 누락일 수 있습니다. 그래서 read model의 lag는 최소 세 가지로 나눠 봐야 합니다.

- **offset lag**: 아직 처리하지 못한 이벤트 수
- **time lag**: read model이 반영한 마지막 이벤트 시각과 현재 시각의 차이
- **business lag**: 사용자가 보는 업무 상태가 실제 도메인 상태보다 얼마나 뒤처졌는지

운영 기준은 보통 time lag와 business lag에서 나옵니다. 예를 들어 주문 상세 화면은 결제 완료 후 **3초 이내** 반영되어야 신뢰가 깨지지 않지만, 월별 매출 리포트는 **5~15분** 지연을 허용할 수 있습니다. 반대로 포인트 잔액, 쿠폰 사용 가능 여부, 출금 상태처럼 사용자가 즉시 행동을 바꾸는 데이터는 read model만 믿으면 위험합니다. 이 경우 [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/) 기준을 같이 둬야 합니다.

### 2) Read model은 캐시가 아니라 소유자와 SLA가 있는 파생 저장소다

read model을 "어차피 다시 만들 수 있는 캐시"로만 보면 운영 규율이 흐려집니다. 캐시처럼 폐기 가능하더라도, 화면·알림·정산·추천이 그 값을 의존하면 이미 제품 기능의 일부입니다. 따라서 각 read model에는 owner, freshness SLO, rebuild 방법, 데이터 수명, 실패 시 사용자 경험이 붙어야 합니다.

최소 메타데이터는 아래 정도가 필요합니다.

| 항목 | 예시 | 없을 때 문제 |
| --- | --- | --- |
| source stream | `order-events.v3` | 어떤 이벤트로 만들었는지 모름 |
| checkpoint | topic/partition/offset 또는 event_id | 재시작·재처리 위치 불명확 |
| freshness SLO | p95 lag 5초 이하 | 느린지 정상인지 판단 불가 |
| rebuild source | event log, snapshot, primary DB | 전체 재빌드 경로 없음 |
| owner | order-platform team | 장애 때 책임 경계 모호 |
| degraded UX | stale badge, primary fallback | 사용자에게 틀린 확신 제공 |

이 구조가 있어야 장애 때 "그냥 projector 재시작"이 아니라, 어디까지 반영됐고 어떤 사용자가 stale 데이터를 봤는지 추적할 수 있습니다. [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)처럼 원본과 파생값을 정기 대조하는 루틴도 여기서 힘을 얻습니다.

### 3) Rebuild는 전체 삭제 후 재생보다 "새 read model을 만들어 전환"하는 편이 안전하다

가장 위험한 재빌드 방식은 운영 read model을 비우고 처음부터 다시 채우는 것입니다. 데이터가 작을 때는 단순하지만, 운영에서는 재빌드 중 조회가 깨지고, 중간 실패 시 반쯤 채워진 테이블이 남고, 롤백 기준도 흐려집니다. 더 안전한 방식은 **새 버전의 read model을 옆에 만들고, 검증 후 cutover**하는 것입니다.

추천 흐름은 아래와 같습니다.

1. `order_summary_v2` 같은 새 테이블 또는 새 인덱스 생성
2. source event log 또는 snapshot에서 backfill
3. backfill 중 신규 이벤트는 v1/v2에 dual projection 또는 catch-up queue로 반영
4. v1/v2 row count, checksum, 핵심 쿼리 결과를 비교
5. read traffic 일부를 v2로 canary
6. cutover 후 v1은 일정 기간 read-only 보관

숫자 기준은 서비스마다 다르지만, 초기값은 이렇게 잡을 수 있습니다.

- backfill 중 운영 DB CPU 추가 사용률: **20% 이하**
- read model v1/v2 핵심 필드 불일치율: **0.1% 이하**
- cutover 전 catch-up lag: **30초 이하**, 민감 화면은 **3~5초 이하**
- cutover 후 rollback 가능 기간: 최소 **24~72시간**

이 방식은 [Traffic Cutover & Migration](/learning/deep-dive/deep-dive-traffic-cutover-migration/)과 거의 같은 사고방식입니다. read model도 결국 데이터 경로 전환이기 때문에, shadow 비교와 canary 기준이 필요합니다.

### 4) 이벤트 재처리는 멱등성과 순서 조건 없이는 위험하다

projector는 같은 이벤트를 두 번 받을 수 있다고 가정해야 합니다. 네트워크 타임아웃, consumer rebalance, 수동 replay, DLQ 재처리, 배포 중단이 모두 중복을 만듭니다. 그래서 `event_id` 기반 처리 이력, aggregate별 version, 상태 전이 조건이 필요합니다.

예를 들어 주문 read model에서 `PAID` 이벤트 뒤에 예전 `PENDING` 이벤트가 재처리되어 상태를 되돌리면 안 됩니다. 단순 upsert는 빠르지만, 상태 전이 규칙을 모르면 오래된 이벤트가 최신 결과를 덮어쓸 수 있습니다. 이런 경로는 [Upsert + Unique + Idempotency](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)와 [Snapshot Isolation/Serializable 판단](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)을 같이 봐야 합니다.

현실적인 기준은 다음과 같습니다.

- 모든 이벤트에 `event_id`, `aggregate_id`, `aggregate_version`, `occurred_at`, `schema_version`을 둔다.
- projector는 마지막 처리 version보다 낮은 이벤트를 기본적으로 무시하거나 별도 quarantine한다.
- 재처리 window는 최소 **7~30일** 확보한다. 정산·법적 기록은 더 길게 둔다.
- DLQ 재처리는 reason code와 operator id 없이 수행하지 않는다.

## 실무 적용

### 1) Projection SLO를 화면·업무별로 나눈다

모든 read model에 같은 freshness를 요구하면 비용이 과해집니다. 반대로 전부 eventual consistency로 뭉개면 중요한 화면에서 신뢰가 깨집니다. 먼저 read model을 세 등급으로 나눕니다.

- **P0 신뢰 경로**: 잔액, 결제 상태, 권한, 재고 차감처럼 사용자 행동을 즉시 제한하는 데이터. lag 목표 **0~3초**, 필요 시 primary read fallback.
- **P1 운영 경로**: 주문 목록, 배송 상태, 상담 화면. lag 목표 **5~30초**, stale badge와 수동 refresh 제공.
- **P2 분석 경로**: 통계, 리포트, 추천 후보. lag 목표 **5분~1시간**, batch rebuild 허용.

이렇게 나누면 비용과 정확도를 동시에 제어할 수 있습니다. P0에 대해서는 read model만 믿지 말고 원본 조회, version token, read-your-writes 보장을 섞는 편이 안전합니다. P2는 오히려 지연을 허용하고 재빌드 가능성을 높이는 것이 더 낫습니다.

### 2) Projector 대시보드는 lag와 품질을 같이 보여줘야 한다

대시보드에는 최소 아래 지표가 있어야 합니다.

- `projection_time_lag_p95`, `projection_time_lag_p99`
- `oldest_unprocessed_event_age_seconds`
- `projection_error_rate`, `quarantine_event_count`
- `rebuild_progress_percent`, `catchup_eta_minutes`
- `source_to_read_model_mismatch_rate`
- `manual_replay_count`, `dlq_reprocess_success_rate`

특히 `oldest_unprocessed_event_age`는 평균 lag보다 중요합니다. 평균은 낮아도 특정 파티션 하나가 2시간 밀리면 일부 사용자는 계속 오래된 데이터를 봅니다. 알람은 [Observability Alarms](/learning/deep-dive/deep-dive-observability-alarms/)처럼 action과 연결되어야 합니다. 예를 들어 P1 read model의 p95 lag가 5분 이상이면 "worker 증설"보다 먼저 "stale badge 노출"과 "cutover 중단"이 자동으로 걸려야 합니다.

### 3) Rebuild Runbook을 미리 만든다

read model 재빌드는 장애 때 즉흥적으로 설계하면 거의 실패합니다. runbook에는 아래 순서가 있어야 합니다.

1. 재빌드 대상과 source event 범위 고정
2. 쓰기 중단이 필요한지, dual projection으로 충분한지 결정
3. backfill batch size와 throttle 설정
4. 비교 기준: row count, checksum, 샘플 쿼리, 비즈니스 invariant
5. cutover 기준과 rollback 기준
6. v1 보관 기간과 삭제 조건

추천 기본값은 batch size를 작게 시작하는 것입니다. 예를 들어 1,000~5,000 row 단위로 시작하고, DB CPU가 60%를 넘거나 replication lag가 30초를 넘으면 throttle을 거는 식입니다. 빨리 끝내려다 운영 경로를 밀어내면 재빌드가 장애 복구가 아니라 새 장애가 됩니다.

## 트레이드오프/주의점

첫째, read model을 늘리면 조회는 빨라지지만 데이터 제품이 늘어납니다. 각 projection마다 owner, lag SLO, schema migration, rebuild cost가 생깁니다. 단순 화면 최적화를 위해 read model을 남발하면 나중에 정합성 비용이 조회 최적화 이득을 잡아먹습니다.

둘째, 이벤트 로그가 있다고 항상 재빌드 가능한 것은 아닙니다. 과거 이벤트 schema가 깨졌거나, 외부 API 결과가 이벤트에 포함되지 않았거나, 삭제 정책 때문에 원본 payload가 사라졌다면 replay가 완전하지 않을 수 있습니다. 그래서 snapshot과 event log 보존 정책을 같이 설계해야 합니다.

셋째, projector를 빠르게 만드는 것보다 안전하게 멈추는 것이 더 중요할 때가 있습니다. schema mismatch 이벤트가 들어왔는데 계속 진행하면 조용히 틀린 read model을 만들 수 있습니다. unknown schema, version gap, invariant violation은 fail-open보다 quarantine이 낫습니다.

의사결정 우선순위는 **사용자 신뢰 경로 보호 > 원본 데이터 보호 > 재빌드 속도 > 인프라 비용**입니다. 비용 때문에 lag를 숨기거나, 속도 때문에 검증 없는 cutover를 하면 결국 더 비싼 장애로 돌아옵니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] read model별 source stream, checkpoint, owner, freshness SLO가 문서화되어 있다.
- [ ] offset lag뿐 아니라 time lag와 oldest unprocessed event age를 본다.
- [ ] P0/P1/P2 데이터 등급별 stale 허용 시간이 다르다.
- [ ] rebuild는 운영 테이블 삭제가 아니라 새 버전 생성 후 cutover로 설계한다.
- [ ] projector는 event_id와 aggregate_version으로 멱등성과 순서 역전을 처리한다.
- [ ] DLQ 재처리에는 reason code, operator, 영향 범위가 남는다.
- [ ] v1/v2 read model 비교 기준과 rollback 기간이 있다.

### 연습

1. 운영 중인 조회 화면 하나를 골라, 그 화면의 read model freshness SLO를 초 단위로 적어 보세요. "언젠가 맞음" 대신 사용자가 참을 수 있는 지연을 숫자로 써야 합니다.  
2. 현재 projector가 멈췄을 때 마지막 checkpoint를 어디서 확인할 수 있는지 찾아보세요. 5분 안에 답이 안 나오면 운영성이 부족한 상태입니다.  
3. read model schema를 하나 바꾼다고 가정하고 v2 생성, backfill, shadow compare, cutover, rollback까지의 runbook을 10줄로 작성해 보세요.

## 관련 글

- [Event Sourcing과 CQRS](/learning/deep-dive/deep-dive-event-sourcing-cqrs/)
- [Kafka Consumer Lag 운영](/learning/deep-dive/deep-dive-kafka-consumer-lag/)
- [Materialized View + Incremental Refresh 운영 플레이북](/learning/deep-dive/deep-dive-materialized-view-incremental-refresh-playbook/)
- [Traffic Cutover & Migration](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
- [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
