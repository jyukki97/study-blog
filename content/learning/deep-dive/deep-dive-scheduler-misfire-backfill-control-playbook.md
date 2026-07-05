---
title: "백엔드 커리큘럼 심화: Scheduler Misfire와 Backfill Control, 놓친 배치와 따라잡기 폭주를 다루는 법"
date: 2026-07-05T10:06:00+09:00
draft: false
topic: "Backend Operations"
tags: ["Scheduler", "Batch", "Backfill", "Misfire", "Idempotency", "Operations", "Reliability"]
categories: ["Backend Deep Dive"]
description: "크론·배치·주기 작업이 지연되거나 누락됐을 때 skip, coalesce, replay, manual backfill 중 무엇을 선택할지 실무 기준과 운영 가드를 정리합니다."
summary: "Scheduler misfire는 단순히 작업이 늦게 돈 문제가 아닙니다. 놓친 실행을 어떻게 따라잡을지 정하지 않으면 backfill이 온라인 트래픽과 충돌하고, 중복 효과와 비용 폭주를 만듭니다."
module: "backend-ops-observability-phase"
study_order: 1460
key_takeaways:
  - "주기 작업에는 scheduled_at, started_at, completed_at, business_window를 분리해 기록해야 misfire와 중복 실행을 구분할 수 있다."
  - "놓친 실행은 무조건 모두 replay하지 말고 skip, coalesce, replay, manual backfill 중 업무 의미에 맞게 선택해야 한다."
  - "Backfill은 운영 트래픽과 같은 자원을 쓰는 별도 workload이므로 concurrency, batch size, replica lag, p95 latency 기준으로 제어해야 한다."
operator_checklist:
  - "모든 중요 job에 misfire policy, max catch-up window, idempotency key, owner, manual override 절차를 둔다."
  - "Backfill 실행 중 온라인 API p95가 10% 이상 악화되거나 DB replica lag가 60초를 넘으면 자동 pause한다."
  - "Job execution ledger에 scheduled_at, business_window, trigger_reason, replay_group_id, processed_count, side_effect_count를 남긴다."
learning_refs:
  - title: "분산 스케줄러 Singleton 실행 보장"
    href: "/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/"
    description: "멀티 인스턴스 환경에서 중복 실행을 줄이는 lease, fencing, idempotency 기준입니다."
  - title: "Spring Batch와 스케줄링 기초"
    href: "/learning/deep-dive/deep-dive-spring-batch-scheduling/"
    description: "Job, Step, Chunk, JobRepository 등 배치 기본 구조를 먼저 잡는 글입니다."
  - title: "Batch Idempotency와 Reprocessing"
    href: "/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/"
    description: "실패 후 재처리와 중복 효과 방지를 설계하는 기준입니다."
  - title: "Workload-aware Queue Partitioning"
    href: "/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/"
    description: "Backfill과 실시간 작업을 같은 큐에서 다룰 때 필요한 공정성 기준입니다."
---

스케줄러 장애는 보통 두 가지 모습으로 나타납니다. 하나는 같은 작업이 두 번 도는 중복 실행이고, 다른 하나는 제때 돌지 못한 작업이 나중에 한꺼번에 몰리는 **따라잡기 폭주**입니다. 많은 팀이 첫 번째 문제는 비교적 빨리 인식합니다. 중복 정산, 중복 알림, 중복 외부 API 호출은 결과가 눈에 띄기 때문입니다. 반대로 두 번째 문제는 더 조용합니다. 야간 배치가 3시간 멈췄다가 복구 직후 밀린 작업을 모두 실행하고, 그때 운영 DB와 검색 인덱스, 외부 API가 같이 흔들립니다.

이 글은 [분산 스케줄러 Singleton 실행 보장](/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/)의 다음 단계입니다. "한 번만 실행"뿐 아니라 "놓친 실행을 어떻게 처리할 것인가"를 다룹니다. 함께 보면 좋은 글은 [Spring Batch와 스케줄링 기초](/learning/deep-dive/deep-dive-spring-batch-scheduling/), [Batch Idempotency와 Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/), [CDC Connector Lag와 Snapshot Recovery](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/), [Workload-aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)입니다.

## 이 글에서 얻는 것

- Scheduler misfire를 단순 지연이 아니라 scheduled time, business window, side effect 기준으로 해석할 수 있습니다.
- 놓친 작업을 skip, coalesce, replay, manual backfill 중 어디로 보낼지 판단하는 기준을 세울 수 있습니다.
- Backfill이 온라인 트래픽을 밀어내지 않도록 concurrency, batch size, throttle, pause 조건을 숫자로 잡을 수 있습니다.
- 배치 실행 이력과 재처리 증거를 남겨 장애 후 "무엇이 처리됐고 무엇이 남았는가"를 빠르게 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) Misfire는 "늦게 시작"만 뜻하지 않는다

스케줄러에서 misfire는 예정된 시각에 작업이 실행되지 못한 상태를 말합니다. 하지만 운영에서는 네 가지를 나눠야 합니다.

| 유형 | 설명 | 대표 원인 |
| --- | --- | --- |
| delayed start | 예정 시각보다 늦게 시작 | 배포, 인스턴스 재시작, 락 경합 |
| missed run | 해당 window가 아예 실행되지 않음 | scheduler down, cron 설정 오류 |
| duplicate run | 같은 business window가 두 번 이상 실행 | split brain, 수동 재실행, retry 버그 |
| late completion | 시작은 했지만 업무 마감 전에 끝나지 않음 | 데이터 증가, 외부 API 지연, DB 포화 |

이 네 가지를 같은 "배치 실패"로 기록하면 복구가 느려집니다. 예를 들어 매일 02:00에 전날 주문을 정산하는 job이 05:00에 시작했다면 단순 지연일 수 있습니다. 반대로 매시 5분마다 유저 상태를 expire하는 job이 6시간 멈췄다면 72개 window를 어떻게 처리할지 결정해야 합니다. 더 나쁜 경우는 job이 늦게 끝났는데 다음 주기가 시작되어 같은 데이터를 동시에 건드리는 상황입니다.

그래서 중요 job은 최소한 아래 시간을 분리해 기록해야 합니다.

```yaml
job_execution:
  job_name: "expire-reservations"
  scheduled_at: "2026-07-05T02:05:00+09:00"
  started_at: "2026-07-05T04:10:12+09:00"
  completed_at: "2026-07-05T04:11:30+09:00"
  business_window_start: "2026-07-05T02:00:00+09:00"
  business_window_end: "2026-07-05T02:05:00+09:00"
  trigger_reason: "catch_up"
  replay_group_id: "bf_20260705_0410"
  idempotency_key: "expire-reservations:2026-07-05T02:00"
```

`started_at`만 있으면 "언제 돌았는가"만 압니다. `scheduled_at`과 `business_window`가 있어야 "무엇을 처리했는가"를 압니다.

### 2) 놓친 실행은 모두 다시 돌리면 위험하다

스케줄러가 3시간 멈췄을 때 가장 쉬운 구현은 "밀린 실행을 전부 순서대로 실행"입니다. 하지만 모든 job이 replay를 요구하지 않습니다. 최신 상태만 맞추면 되는 작업을 36번 다시 돌리면 불필요한 DB 부하만 만듭니다. 반대로 모든 거래 window를 증거로 남겨야 하는 정산 job을 최신 한 번으로 합치면 데이터 누락이 생깁니다.

의사결정은 업무 의미로 나눕니다.

| 정책 | 의미 | 적합한 작업 | 기준 |
| --- | --- | --- | --- |
| skip | 오래된 window는 버림 | 캐시 warmup, 비핵심 통계 refresh | 최신 실행만 가치 있음 |
| coalesce | 여러 window를 하나로 합침 | 상태 동기화, 검색 색인 보정 | 최종 상태가 중요 |
| replay | 각 window를 순서대로 실행 | 정산, 청구, 감사 로그 집계 | window별 증거가 필요 |
| manual backfill | 자동 실행하지 않고 승인 대기 | 대량 마이그레이션, 외부 비용 큰 작업 | 비용과 위험이 큼 |

기본값은 replay가 아닙니다. 운영 기준으로는 **skip 또는 coalesce를 먼저 검토하고, 업무 증거가 필요한 경우에만 replay**하는 편이 안전합니다. 특히 외부 API 호출, 이메일/푸시 발송, 결제/정산 반영처럼 side effect가 있는 job은 자동 replay 전에 idempotency와 중복 발송 방지 기준을 확인해야 합니다.

### 3) Backfill은 숨은 production workload다

Backfill은 과거 누락분을 메우는 작업입니다. 이름은 보조 작업처럼 들리지만 실제로는 운영 DB, replica, 큐, 검색 인덱스, 외부 API를 쓰는 production workload입니다. 온라인 API와 같은 connection pool을 쓰거나 같은 worker pool을 쓰면, "복구 작업"이 현재 사용자 경험을 망칠 수 있습니다.

권장 초깃값:

| 항목 | 기준 |
| --- | --- |
| 온라인 API p95 악화 | 평소 대비 10% 초과 시 backfill pause |
| DB CPU 추가 사용률 | 20% 이하 |
| replica lag | 60초 초과 시 pause, 5분 초과 시 중단 후 재계획 |
| batch size | row 500~5,000부터 시작, lock wait 보고 조정 |
| concurrency | 기본 1~2, shard별 최대 4 이하 |
| 외부 API 호출 | provider rate limit의 30% 이하 |
| catch-up window | 일반 작업 24시간, 정산/감사 작업은 owner 승인 |

이 숫자는 절대값이 아니라 시작점입니다. 중요한 것은 backfill에 별도 예산이 있어야 한다는 점입니다. [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/)처럼 요청에 예산이 필요하듯, 배치와 backfill에도 "얼마나 빨리 끝낼 것인가"와 "어떤 자원을 얼마나 써도 되는가"가 같이 있어야 합니다.

### 4) Coalesce는 빠르지만 업무 의미를 잃을 수 있다

Coalesce는 여러 누락 window를 하나의 실행으로 합치는 방식입니다. 예를 들어 1분마다 캐시를 갱신하는 job이 30분 멈췄다면 30번 실행하는 대신 최신 기준으로 한 번 갱신하면 충분할 수 있습니다. 사용자 상태 만료 job도 `WHERE expires_at <= now()`처럼 최종 상태를 기준으로 처리하면 window별 실행이 필요하지 않을 수 있습니다.

하지만 coalesce가 항상 안전한 것은 아닙니다. 시간대별 집계, 요금 계산, SLA 측정, 감사 증거처럼 window 자체가 의미를 가지면 합치면 안 됩니다. "어차피 최종 합계는 같지 않나"라는 말도 조심해야 합니다. 중간 상태가 알림, 청구, 정산 파일, 외부 webhook을 만든다면 최종 상태만 맞아도 side effect는 달라질 수 있습니다.

간단한 판단 질문:

- 사용자가 특정 시간대 결과를 나중에 확인해야 하는가?
- window별 산출물이 외부로 나갔는가?
- 중간 상태가 청구, 보상, 알림, 권한 변경을 만들 수 있는가?
- 누락분을 한 번에 처리해도 idempotency key가 유지되는가?
- backfill 후 검증을 count/checksum/sample key로 할 수 있는가?

위 질문 중 2개 이상이 예라면 coalesce보다 replay 또는 manual backfill을 검토합니다.

### 5) "정확히 한 번"보다 "효과를 추적할 수 있음"이 중요하다

스케줄러, 큐, 네트워크, DB가 모두 얽힌 환경에서 실행을 정확히 한 번으로 만드는 것은 어렵습니다. 실무 목표는 보통 "같은 business key에 대해 같은 side effect가 한 번만 남고, 실패하면 어디서 멈췄는지 알 수 있음"입니다. 즉 [멱등성 API 설계](/learning/deep-dive/deep-dive-idempotency/)와 [UPSERT·UNIQUE 제약·멱등 키](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)의 사고방식을 배치에도 적용해야 합니다.

좋은 idempotency key는 실행 시각이 아니라 업무 창을 기준으로 합니다.

- 나쁨: `job_name + started_at`
- 좋음: `job_name + business_date + shard`
- 더 좋음: `job_name + business_window + tenant_id + shard + version`

실행이 늦어져도 같은 업무 창을 처리한다면 같은 key를 써야 합니다. 그래야 수동 재실행, 자동 replay, 장애 복구가 같은 dedupe 계층을 통과합니다.

## 실무 적용

### 1) Job Execution Ledger를 먼저 만든다

스케줄러 안정화의 시작은 라이브러리 교체가 아니라 실행 장부입니다. 최소 필드는 아래처럼 둡니다.

| 필드 | 목적 |
| --- | --- |
| `job_name` | 작업 식별 |
| `business_window_start/end` | 처리 대상 시간 범위 |
| `scheduled_at` | 원래 실행 예정 시각 |
| `trigger_reason` | scheduled, catch_up, manual, retry |
| `status` | running, succeeded, failed, skipped, paused |
| `attempt` | 같은 key의 시도 횟수 |
| `processed_count` | 처리 row/message 수 |
| `side_effect_count` | 실제 외부 효과 수 |
| `watermark_before/after` | 진행 위치 |
| `owner` | 승인·복구 담당 |

이 장부가 없으면 장애 후에 "다시 돌려도 되나?"를 감으로 판단합니다. 장부가 있으면 누락 window를 조회하고, 같은 window의 성공 여부를 확인하고, replay 후보를 자동 생성할 수 있습니다.

### 2) Job마다 misfire policy를 명시한다

중요 job은 코드에 cron만 두지 말고 운영 정책을 같이 둡니다.

```yaml
job_policy:
  name: "daily-settlement"
  schedule: "0 2 * * *"
  timezone: "Asia/Seoul"
  misfire_policy: "manual_backfill"
  max_auto_catch_up: "0"
  idempotency_key: "job_name + business_date + tenant_id"
  owner: "settlement-platform"
  stale_after: "6h"
  pause_conditions:
    db_replica_lag_seconds: 60
    api_p95_regression_percent: 10
    error_rate_percent: 2
```

정책은 job 성격별로 다릅니다.

| job | 권장 misfire policy | 이유 |
| --- | --- | --- |
| 캐시 warmup | skip | 오래된 캐시는 가치가 낮음 |
| 검색 인덱스 보정 | coalesce | 최종 색인 상태가 중요 |
| 예약 만료 worker | coalesce + idempotent update | 현재 만료 대상 처리면 충분 |
| 시간대별 지표 집계 | replay | window별 수치가 필요 |
| 정산/청구 | manual backfill | 비용과 감사 책임이 큼 |
| 이메일/푸시 발송 | manual 또는 replay with dedupe | 중복 발송 위험 |

정책이 없으면 라이브러리 기본값이 정책이 됩니다. Quartz, Kubernetes CronJob, Spring Scheduler, 외부 workflow 엔진의 기본 misfire 동작은 제품마다 다릅니다. 팀의 업무 기준을 명시하지 않으면 장애 때 예상과 다르게 따라잡기가 실행될 수 있습니다.

### 3) Backfill은 별도 lane에서 낮은 우선순위로 돌린다

Backfill을 온라인 worker와 같은 pool에서 돌리면 복구 작업이 현재 작업을 밀어냅니다. 가능하면 lane을 분리합니다.

- realtime lane: 현재 이벤트, 사용자-facing 작업
- correction lane: 최근 누락 보정, 소량 재처리
- bulk backfill lane: 과거 대량 보정, 낮은 우선순위
- manual lane: 승인된 고위험 작업

큐를 쓰는 경우 [Queue Visibility Timeout·Ack/Nack·DLQ 설계](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)와 연결해 visibility timeout, retry, DLQ 기준을 따로 둡니다. DB cursor batch를 쓰는 경우 [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)처럼 stable sort와 checkpoint를 같이 설계합니다.

Backfill 실행 중에는 아래 지표를 1~5분 단위로 봅니다.

- `backfill_rows_per_sec`
- `backfill_lag_remaining`
- `online_api_p95`
- `db_lock_wait_p95`
- `replica_lag_seconds`
- `queue_oldest_age_seconds`
- `dead_letter_count`
- `manual_pause_count`

목표는 가장 빨리 끝내는 것이 아니라, 현재 서비스 품질을 지키면서 끝내는 것입니다.

### 4) 자동 catch-up에는 상한을 둔다

자동 catch-up은 편하지만 상한이 없으면 위험합니다. 예를 들어 1분마다 도는 job이 주말 동안 멈춘 뒤 월요일 아침 2,880개 window를 replay하면, 장애 복구가 아니라 새 장애가 됩니다.

권장 기준:

- 5분 이하 누락: 자동 catch-up 허용
- 5분~1시간 누락: coalesce 우선, replay는 concurrency 1
- 1~24시간 누락: owner 알림, backfill plan 생성
- 24시간 초과 누락: manual approval 전 자동 실행 금지
- 외부 side effect가 있는 job: 누락 시간과 무관하게 dedupe 검증 후 실행

이 기준은 job마다 조정해야 합니다. 핵심은 "얼마나 늦었는가"와 "무엇을 건드리는가"를 같이 보는 것입니다. 정산 job은 10분 늦어도 수동 승인 대상일 수 있고, 캐시 warmup은 12시간 누락돼도 최신 한 번이면 충분할 수 있습니다.

### 5) 검증은 처리 수가 아니라 결과 차이로 한다

Backfill 완료 후 "100만 row 처리"는 충분한 증거가 아닙니다. 처리 수는 작업량이고, 검증은 결과입니다.

검증 예시:

| 작업 | 검증 |
| --- | --- |
| 검색 인덱스 재색인 | source count vs index count, sample key 1,000개 비교 |
| 정산 집계 | 원천 거래 합계 vs 정산 합계, tenant별 오차 0 |
| 상태 만료 | `expires_at <= now()`인데 active인 row 0건 |
| 알림 발송 | idempotency key별 발송 1회, suppress count 확인 |
| projection rebuild | v1/v2 checksum, 불일치율 0.01% 미만 |

검증 기준은 [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)의 관점과 같습니다. 복구 작업은 실행보다 대조가 중요합니다.

## 트레이드오프/주의점

첫째, replay는 정확해 보이지만 비쌉니다. window별 의미가 있는 job에는 필요하지만, 모든 job에 replay를 기본으로 두면 장애 복구 때 부하가 몰립니다. 최신 상태만 중요한 작업은 coalesce가 더 낫습니다.

둘째, skip은 빠르지만 조용한 데이터 품질 저하를 만들 수 있습니다. skip을 허용하는 job에도 "무엇을 버렸는지"는 장부에 남겨야 합니다. 그래야 나중에 데이터 공백을 설명할 수 있습니다.

셋째, backfill throttle은 복구 시간을 늘립니다. 하지만 온라인 트래픽이 무너지면 복구 시간보다 장애 영향이 더 커집니다. 고객-facing API와 정산/감사 작업이 충돌하면 우선순위는 보통 **현재 사용자 안정성 > 데이터 손실 방지 > 과거분 처리 속도 > 비용 최적화**입니다.

넷째, 수동 승인은 사람을 병목으로 만들 수 있습니다. 그래서 manual backfill 대상은 적어야 합니다. 외부 비용, 법적 증거, 결제/정산, 대량 권한 변경처럼 실패 비용이 큰 작업에만 둡니다.

다섯째, 스케줄러 제품을 바꿔도 정책 부채는 사라지지 않습니다. Kubernetes CronJob, Quartz, Airflow, Temporal, 자체 DB scheduler 모두 misfire와 catch-up 의미가 다릅니다. 제품 기본값이 아니라 업무별 정책을 먼저 정해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 중요 job마다 `business_window`와 `scheduled_at`을 기록한다.
- [ ] misfire policy가 skip, coalesce, replay, manual backfill 중 하나로 명시돼 있다.
- [ ] 자동 catch-up 가능한 최대 누락 시간과 최대 window 수가 정해져 있다.
- [ ] backfill concurrency, batch size, pause 조건이 운영 지표와 연결돼 있다.
- [ ] idempotency key가 실행 시각이 아니라 업무 key 기준이다.
- [ ] 외부 side effect가 있는 job은 중복 효과 검증을 통과해야 재실행할 수 있다.
- [ ] backfill 완료 후 count, checksum, sample key, residual query 중 최소 2개로 검증한다.

### 연습

1. 현재 운영 중인 주기 작업 5개를 골라 skip, coalesce, replay, manual backfill 중 하나로 분류해 보세요.
2. 그중 하나에 대해 `scheduled_at`, `business_window`, `trigger_reason`, `idempotency_key`, `processed_count`를 포함한 execution ledger 스키마를 작성해 보세요.
3. "스케줄러가 6시간 멈췄다"는 가정으로 자동 catch-up 가능한 window 수, owner 승인 기준, backfill pause 조건을 10줄 runbook으로 정리해 보세요.
4. Backfill 중 온라인 API p95가 10% 악화됐을 때 pause, throttle, lane 전환, 수동 중단 중 어떤 순서로 대응할지 정해 보세요.

Scheduler Misfire와 Backfill Control의 핵심은 놓친 일을 무작정 빨리 따라잡는 것이 아닙니다. 어떤 일은 버려도 되고, 어떤 일은 합쳐도 되며, 어떤 일은 하나씩 증거를 남기며 처리해야 합니다. 좋은 스케줄러 운영은 실행 시각보다 업무 window를 먼저 보고, 복구 속도보다 현재 서비스 안정성과 결과 검증을 우선합니다.

## 관련 글

- [분산 스케줄러 Singleton 실행 보장](/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/)
- [Spring Batch와 스케줄링 기초](/learning/deep-dive/deep-dive-spring-batch-scheduling/)
- [Batch Idempotency와 Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)
- [CDC Connector Lag와 Snapshot Recovery](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/)
- [Workload-aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)

