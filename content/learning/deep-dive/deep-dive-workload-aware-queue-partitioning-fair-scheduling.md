---
title: "백엔드 커리큘럼 심화: Workload-Aware Queue Partitioning과 Fair Scheduling으로 느린 작업이 전체 워커를 막지 않게 하는 법"
date: 2026-05-14
draft: false
topic: "Backend Messaging"
tags: ["Message Queue", "Fair Scheduling", "Queue Partitioning", "Worker Pool", "Noisy Neighbor", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "비동기 작업 큐에서 대형 테넌트, 느린 작업, poison job이 전체 워커를 점유하지 않도록 workload-aware partitioning, fair scheduling, worker pool 격리 기준을 숫자 중심으로 정리합니다."
module: "backend-messaging"
study_order: 1231
---

비동기 큐를 붙이면 시스템이 자동으로 안정해질 것처럼 보입니다. 동기 API에서 오래 걸리던 파일 변환, 리포트 생성, 알림 발송, 외부 연동을 큐 뒤로 넘기면 사용자 응답은 빨라지고, 워커가 천천히 처리하면 된다고 생각하기 쉽습니다. 그런데 트래픽이 커지면 큐는 또 다른 병목이 됩니다. 특정 테넌트의 대량 작업이 워커를 독점하고, 처리 시간이 긴 job이 짧은 job을 뒤로 밀고, 실패 job이 계속 재시도되면서 정상 job까지 늦어지는 식입니다.

이 문제는 단순히 워커 수를 늘린다고 해결되지 않습니다. 워커 수를 늘리면 한동안 backlog는 줄 수 있지만, DB 커넥션·외부 API quota·파일 스토리지 I/O 같은 하류 자원도 같이 때리기 때문에 오히려 전체 지연이 커질 수 있습니다. 그래서 큐 운영의 핵심은 "얼마나 많이 처리하나"보다 **어떤 작업을 어떤 격리 단위와 순서로 처리하나**입니다. 이 글은 [Queue Visibility Timeout·Ack/Nack·DLQ](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/), [Priority Load Shedding과 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/), [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/), [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)을 큐 스케줄링 관점으로 묶어 정리합니다.

## 이 글에서 얻는 것

- 단일 FIFO 큐가 언제 느린 작업과 대형 테넌트에 취약해지는지 설명할 수 있습니다.
- workload class, tenant, priority, cost estimate 기준으로 큐를 나누는 실무 기준을 잡을 수 있습니다.
- 워커 풀, 동시성 상한, retry lane, DLQ를 분리해 정상 작업의 tail latency를 보호하는 방법을 가져갈 수 있습니다.
- 큐 처리량을 늘리기 전에 봐야 할 숫자 기준과 의사결정 우선순위를 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) 단일 FIFO 큐는 단순하지만 공정하지 않다

FIFO 큐는 이해하기 쉽습니다. 먼저 들어온 작업을 먼저 처리합니다. 작은 규모에서는 이 기본값이 충분합니다. 문제는 작업 비용이 균일하지 않을 때입니다. 100ms짜리 이메일 발송 job과 3분짜리 CSV 리포트 job이 같은 큐에 있으면, 앞쪽에 대형 job이 몰리는 순간 뒤의 짧은 job까지 같이 늦어집니다. 큐 이론으로 보면 평균 처리시간이 조금만 늘어도 대기시간은 비선형으로 커집니다.

실무에서 단일 큐가 위험해지는 신호는 보통 아래입니다.

- job 처리시간 p95와 p50 차이가 **10배 이상** 난다.
- 상위 1~5% 대형 job이 전체 워커 시간의 **40% 이상**을 쓴다.
- 특정 테넌트가 큐 유입량 또는 처리시간의 **25% 이상**을 차지한다.
- retry job이 전체 실행 슬롯의 **10% 이상**을 점유한다.
- 전체 backlog는 괜찮은데 짧은 job의 end-to-end latency p95가 계속 악화된다.

이 조건이 보이면 큐를 "하나의 대기열"로 볼 게 아니라, **작업 비용이 다른 여러 흐름을 한 파이프에 섞어 둔 상태**로 봐야 합니다. 이때 워커 수만 늘리는 것은 [용량 계획과 포화도 해석](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/) 없이 풀 크기를 올리는 것과 비슷합니다.

### 2) 큐 분할 기준은 기능명이 아니라 비용과 격리 필요성이다

큐를 나눌 때 흔한 실수는 기능별로만 나누는 것입니다. `email_queue`, `report_queue`, `webhook_queue`처럼 이름을 붙이면 보기에는 깔끔하지만, 실제 위험은 기능명보다 비용과 실패 모드에서 갈립니다.

더 실용적인 분류 축은 네 가지입니다.

1. **작업 비용**: short, normal, heavy
2. **우선순위**: user-visible, business-critical, best-effort
3. **테넌트/고객 경계**: enterprise, noisy tenant, shared pool
4. **실패 모드**: retryable, poison candidate, manual review

예를 들어 리포트 생성 하나도 작게 보면 여러 lane이 필요할 수 있습니다.

| Lane | 예시 | 목표 |
| --- | --- | --- |
| `reports-short` | 최근 7일 소형 CSV | 사용자 대기시간 p95 30초 이하 |
| `reports-heavy` | 1년치 대형 export | 처리량보다 하류 DB 보호 우선 |
| `reports-enterprise` | 계약 SLA가 있는 고객 작업 | 테넌트별 quota와 우선순위 보장 |
| `reports-retry` | 외부 API 실패 후 재시도 | 정상 신규 작업과 슬롯 분리 |

핵심은 "큐가 많으면 복잡하다"가 아니라 **복잡한 workload를 단일 큐에 숨기면 장애 때 더 복잡해진다**는 점입니다. 처음부터 수십 개 큐를 만들 필요는 없지만, 최소한 short/heavy/retry는 분리 후보로 두는 편이 안전합니다.

### 3) Fair Scheduling은 모든 작업을 똑같이 대우하는 것이 아니다

공정성은 "모든 job을 같은 순서로 처리"가 아닙니다. 실무의 공정성은 한 고객이나 한 종류의 작업이 전체 시스템을 독점하지 못하게 하는 것입니다. 특히 SaaS에서는 단일 테넌트가 대량 import를 돌린다고 해서 다른 테넌트의 알림, 결제 후처리, 권한 동기화가 밀리면 안 됩니다.

가장 단순한 출발점은 **tenant-level concurrency cap**입니다.

```text
global_worker_concurrency = 100
default_tenant_cap = 10
enterprise_tenant_cap = 25
heavy_job_global_cap = 15
retry_lane_cap = 10
```

이렇게 두면 전체 워커가 100개여도 한 테넌트가 기본적으로 10개 이상을 잡지 못합니다. 엔터프라이즈 고객은 계약 SLA에 맞춰 25까지 허용하되, heavy job 전체는 15개로 제한해 DB를 보호합니다. 이 구조는 [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)의 rate limit과 같은 철학입니다. 차이는 API 입구가 아니라 비동기 처리면에서 적용한다는 점입니다.

조금 더 발전하면 weighted fair scheduling을 씁니다. 예를 들어 기본 고객 weight 1, 엔터프라이즈 weight 3, 내부 배치 weight 0.5처럼 두고, backlog가 있을 때 weight에 비례해 슬롯을 배분합니다. 단, weight가 높다고 무제한은 아닙니다. 항상 `max_concurrency`, `daily_quota`, `downstream_budget` 세 값으로 상한을 둬야 합니다.

### 4) Retry lane을 분리하지 않으면 장애가 정상 처리량을 먹는다

큐 장애에서 자주 보이는 패턴은 신규 작업보다 retry가 워커를 점유하는 상황입니다. 외부 API가 30분 동안 느려졌는데 모든 실패 job이 즉시 재시도되면, 정상 신규 job은 retry 폭풍 뒤에 묻힙니다. 이때 retry 횟수를 늘리는 것은 복구가 아니라 부하 증폭입니다.

기본 원칙은 간단합니다.

- 신규 작업 lane과 retry lane을 분리한다.
- retry lane은 전체 worker의 **10~20%**부터 시작한다.
- 같은 error signature가 반복되면 exponential backoff와 jitter를 강제한다.
- `max_attempts` 초과 또는 non-retryable 오류는 DLQ로 보낸다.
- DLQ 재처리는 별도 manual 또는 controlled replay lane으로만 수행한다.

예를 들어 전체 worker가 80개면 retry worker는 처음에 8~12개 정도로 둡니다. 외부 API가 복구되면 천천히 늘릴 수 있지만, 장애 중에는 신규 작업과 핵심 작업 슬롯을 보호해야 합니다. 실패 분류 기준은 [Queue Visibility Timeout·Ack/Nack·DLQ](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)와 [Timeout·Retry·Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)를 같이 맞춰야 합니다.

### 5) Cost estimate가 없으면 스케줄러는 항상 늦게 배운다

좋은 스케줄링은 작업을 실행하기 전에 대략적인 비용을 알아야 합니다. 완벽할 필요는 없습니다. 소형/중형/대형 정도만 나눠도 효과가 큽니다. 파일 크기, 대상 row 수, 요청 기간, 외부 API 호출 예상 수, tenant tier 같은 값으로 cost class를 계산할 수 있습니다.

예시 기준은 아래처럼 시작할 수 있습니다.

| Cost class | 조건 | 기본 lane | 동시성 |
| --- | --- | --- | --- |
| Small | 예상 처리 < 2초, row < 1만 | fast lane | 높게 |
| Medium | 2초~1분, row 1만~100만 | normal lane | 보통 |
| Heavy | 1분 초과 또는 row 100만 이상 | heavy lane | 낮게 |
| Unknown | 비용 추정 불가 | normal 또는 review | 보수적 |

비용 추정이 틀릴 수 있으므로 실행 후 실제 처리시간을 기록해 다음 스케줄링에 반영합니다. 예를 들어 특정 report type의 p95가 30초를 넘기 시작하면 자동으로 heavy lane으로 강등합니다. 반대로 계속 1초 이내로 끝나면 fast lane으로 승격할 수 있습니다.

## 실무 적용

### 1) 기본 아키텍처: classify → enqueue → schedule → execute → feedback

운영 가능한 큐 시스템은 보통 아래 흐름을 갖습니다.

1. API 또는 producer가 작업을 받을 때 `tenant_id`, `job_type`, `priority`, `cost_class`, `idempotency_key`를 기록한다.
2. classifier가 lane을 결정한다. 예: `fast`, `normal`, `heavy`, `retry`, `dlq`.
3. scheduler가 tenant cap, lane cap, downstream budget을 보고 다음 작업을 선택한다.
4. worker는 실행 중 heartbeat, timeout extension, progress metric을 남긴다.
5. 실행 결과로 실제 duration, downstream call count, failure signature를 기록한다.
6. 피드백 잡이 cost class와 lane 정책을 주기적으로 보정한다.

이 구조의 장점은 작업 분류와 실행을 분리한다는 점입니다. producer가 단순히 큐에 넣는 것으로 끝나지 않고, 운영 정책이 작업의 이동 경로를 결정합니다.

### 2) 숫자 기준으로 잡는 초기값

처음부터 복잡한 scheduler를 만들 필요는 없습니다. 작은 팀 기준으로는 아래 숫자부터 시작해도 충분합니다.

- fast lane 목표: end-to-end latency p95 **30초 이하**
- normal lane 목표: p95 **5분 이하**
- heavy lane 목표: 처리 완료율 중심, p95보다 **backlog age p95 1시간 이하**
- retry lane cap: 전체 worker의 **10~20%**
- tenant cap: 기본 고객 전체 worker의 **5~10%**, enterprise **15~25%**
- poison 감지: 같은 job이 **3~5회** 같은 오류로 실패하면 DLQ
- 하류 보호: DB CPU 70% 또는 외부 API 429 비율 1% 초과 시 heavy/retry lane 자동 감속

의사결정 우선순위는 **하류 시스템 생존 > 핵심 작업 지연 보호 > 전체 처리량 > 비용 최적화** 순서가 안전합니다. heavy lane을 빨리 비우겠다고 DB를 포화시키면 결국 fast lane까지 느려집니다.

### 3) 운영 대시보드에 반드시 있어야 할 지표

큐 대시보드는 단순 backlog count만 보면 부족합니다. 최소한 아래를 lane·tenant·job_type별로 볼 수 있어야 합니다.

- `enqueue_to_start_latency_p50/p95/p99`
- `run_duration_p50/p95/p99`
- `backlog_age_p95`
- `active_workers_by_lane`
- `retry_attempts_by_error_signature`
- `tenant_slot_usage`
- `dlq_inflow_rate`
- `downstream_budget_usage` (DB connection, API quota, storage I/O)

특히 `backlog count`보다 `backlog age`가 더 중요할 때가 많습니다. 작은 job 10만 건과 heavy job 100건은 count로는 비교가 안 됩니다. 사용자 체감은 "내 작업이 몇 번째인가"보다 "언제 시작되는가"에 가깝습니다.

### 4) 단계적 도입 순서

이미 운영 중인 단일 큐를 한 번에 갈아엎을 필요는 없습니다. 추천 순서는 다음입니다.

1. **관측 추가**: job_type, tenant, duration, retry reason을 기록한다.
2. **retry 분리**: 신규 작업과 retry 작업의 worker cap을 분리한다.
3. **heavy 분리**: 처리시간 p95 상위 job을 별도 lane으로 보낸다.
4. **tenant cap 도입**: 단일 테넌트 독점을 막는다.
5. **weighted scheduling**: SLA와 tier에 따라 슬롯을 배분한다.
6. **자동 보정**: 실제 duration을 보고 cost class를 업데이트한다.

가장 효과가 큰 첫 조치는 대개 retry lane 분리입니다. 장애 중 정상 작업을 보호하는 효과가 빠르게 보입니다. 그다음은 heavy job 분리, 마지막이 공정 스케줄링 고도화입니다.

## 트레이드오프/주의점

### 1) 큐를 너무 많이 나누면 운영자가 전체 상태를 잃는다

분리는 필요하지만 과하면 문제입니다. lane이 30개가 넘어가고 각 lane의 소유자와 SLO가 없으면, 장애 때 어디를 먼저 볼지 모르게 됩니다. 큐를 추가할 때는 반드시 아래를 같이 정해야 합니다.

- lane owner
- latency 또는 backlog age SLO
- worker cap
- retry/DLQ 정책
- 감속·중단 조건

이 다섯 가지가 없으면 새 큐는 격리가 아니라 숨겨진 부채가 됩니다.

### 2) 우선순위는 비즈니스 합의가 없으면 금방 무너진다

모든 팀이 자기 작업을 P0라고 주장하면 scheduler는 아무것도 보호하지 못합니다. P0는 "느리면 불편한 작업"이 아니라 "늦으면 돈·보안·핵심 신뢰가 깨지는 작업"이어야 합니다. 예를 들어 결제 후처리, 권한 회수, 보안 알림은 P0 후보지만, 내부 통계 리포트는 보통 P2입니다. 이 기준은 [Priority Load Shedding과 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)의 요청 우선순위와 맞춰야 합니다.

### 3) 공정성이 처리량을 일부 희생할 수 있다

fair scheduling은 전체 throughput만 보면 손해처럼 보일 때가 있습니다. 큰 job을 몰아서 처리하면 worker utilization은 높아질 수 있습니다. 하지만 사용자 체감과 SLA는 나빠질 수 있습니다. 실무에서는 평균 처리량보다 p95 대기시간, tenant별 지연 편차, 하류 포화 위험을 같이 봐야 합니다. 공정성의 목표는 가장 빠른 배치가 아니라 **예측 가능한 운영**입니다.

### 4) 하류 예산을 보지 않는 scheduler는 위험하다

큐 안에서는 worker가 남아 보여도 DB, Redis, 외부 API가 이미 포화일 수 있습니다. scheduler는 최소한 하류 상태를 입력으로 받아야 합니다. 예를 들어 DB CPU가 75%를 넘거나 외부 API 429가 늘면 heavy/retry lane을 자동 감속하고 fast lane만 유지하는 정책이 필요합니다. 이 관점은 [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)의 비동기 버전입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] job payload에 `tenant_id`, `job_type`, `priority`, `cost_class`, `idempotency_key`가 포함된다.
- [ ] 신규 작업과 retry 작업이 같은 worker 슬롯을 무제한 공유하지 않는다.
- [ ] 처리시간 p95 상위 job이 fast lane을 막지 않도록 heavy lane 또는 cap이 있다.
- [ ] tenant별 동시성 상한과 계약 tier별 예외 기준이 문서화돼 있다.
- [ ] lane별 SLO가 backlog count가 아니라 latency/backlog age 기준으로 정의돼 있다.
- [ ] DLQ 재처리는 별도 controlled replay 절차를 거친다.
- [ ] DB/API quota 같은 하류 예산이 scheduler 감속 조건에 반영돼 있다.

### 연습

1. 현재 운영 중인 비동기 작업을 20개 골라 `job_type`, 평균 처리시간, p95 처리시간, 실패율, 테넌트 편중도를 표로 정리해 보세요.
2. p95 처리시간이 p50의 10배 이상인 작업을 찾아 `fast/normal/heavy` 중 어디로 보내야 할지 결정해 보세요.
3. 전체 worker가 60개라고 가정하고, 기본 tenant cap, enterprise cap, retry lane cap, heavy lane cap을 숫자로 정해 보세요.
4. 외부 API 장애로 retry가 30분 동안 늘어나는 상황을 가정하고, 신규 작업 p95를 지키기 위한 감속 규칙을 작성해 보세요.

큐는 비동기 처리의 마법 상자가 아닙니다. 큐 안에서도 공정성, 격리, 하류 예산, 재처리 정책이 필요합니다. 단일 FIFO로 시작해도 괜찮지만, workload가 달라지는 순간부터는 큐를 운영 체계로 다뤄야 합니다.
