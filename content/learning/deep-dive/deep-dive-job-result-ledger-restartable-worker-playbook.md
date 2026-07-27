---
title: "백엔드 커리큘럼 심화: Job Result Ledger, 재시작 가능한 워커를 운영 가능한 작업으로 만드는 법"
date: 2026-07-27T10:06:00+09:00
draft: false
topic: "Backend Reliability"
tags: ["Job Processing", "Worker", "Idempotency", "Ledger", "Retry", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "비동기 job과 worker를 단순 retry 코드가 아니라 결과 원장, checkpoint, lease, evidence, 재처리 기준을 가진 운영 단위로 설계하는 방법을 정리합니다."
module: "backend-reliability"
study_order: 1280
key_takeaways:
  - "긴 작업은 성공/실패 플래그보다 job result ledger, checkpoint, side effect evidence가 있어야 재시작과 재처리를 안전하게 할 수 있다."
  - "worker 재시작 가능성은 코드 재실행이 아니라 이미 확정된 효과를 건너뛰고 불명확한 효과를 격리하는 능력이다."
  - "고위험 job은 retry 횟수보다 영향 범위, 중단 조건, 보상 경로, 운영자 승인 기준을 먼저 설계해야 한다."
operator_checklist:
  - "5초 이상 걸리거나 1,000건 이상 처리하는 작업은 job result ledger와 checkpoint를 둔다."
  - "외부 side effect가 있는 step은 idempotency key, result hash, evidence ref를 함께 저장한다."
  - "stuck job은 heartbeat 지연, progress 정체, lease 만료, downstream 오류율을 조합해 판정한다."
  - "재처리 전에는 affected_count, last_success_checkpoint, ambiguous_effect_count, compensation_plan을 확인한다."
learning_refs:
  - title: "Batch Idempotency/Reprocessing"
    href: "/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/"
    description: "배치 작업을 멱등하게 재처리하는 기본 원칙입니다."
  - title: "Queue Visibility Timeout/Ack/Nack/DLQ"
    href: "/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/"
    description: "큐 메시지 처리에서 timeout, ack, nack, dead letter를 운영 기준으로 다룹니다."
  - title: "Bulk Import Job"
    href: "/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/"
    description: "대량 업로드 job의 row 단위 오류와 적용 단계를 분리하는 방법입니다."
  - title: "Operational State Machine"
    href: "/learning/deep-dive/deep-dive-operational-state-machine-design/"
    description: "상태 전이와 이력을 운영 가능한 도메인 계약으로 설계하는 글입니다."
---

비동기 job은 처음에는 간단해 보입니다. 요청을 받으면 `PENDING` row를 만들고, worker가 집어 가서 처리한 뒤 `SUCCESS`나 `FAILED`로 바꾸면 됩니다. 하지만 운영에 들어가면 질문이 달라집니다. worker가 중간에 죽었을 때 어디서 다시 시작할 수 있는지, 외부 API 호출이 timeout 났지만 실제로는 성공했을 가능성이 있는지, 10만 건 중 7만 건까지 반영된 뒤 검증 로직이 바뀌면 남은 3만 건만 처리해도 되는지, 같은 job을 사람이 다시 눌렀을 때 중복 효과가 생기지 않는지를 답해야 합니다.

이 글은 [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/), [Queue Visibility Timeout/Ack/Nack/DLQ](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/), [Bulk Import Job](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/), [Operational State Machine](/learning/deep-dive/deep-dive-operational-state-machine-design/)과 이어집니다. 핵심은 worker를 더 많이 띄우는 것이 아니라, job의 결과와 부작용을 **재시작 가능한 원장**으로 남기는 것입니다.

## 이 글에서 얻는 것

- 장기 실행 job을 `status` 컬럼 하나로 관리할 때 생기는 운영 공백을 이해합니다.
- Job Result Ledger에 어떤 필드를 저장해야 재시작, 재처리, 감사, 보상이 가능해지는지 정리합니다.
- checkpoint, lease, heartbeat, side effect evidence를 분리해 worker stuck과 partial success를 판단할 수 있습니다.
- 실무에서 적용할 숫자 기준, 경보 기준, 재처리 승인 체크리스트를 가져갑니다.

## 핵심 개념/이슈

### 1) job status는 현재 상태이고, result ledger는 확정된 효과다

`jobs.status = SUCCESS`는 결과를 요약합니다. 하지만 운영자가 실제로 필요한 것은 요약보다 근거입니다. 어떤 row가 처리되었고, 어떤 row가 reject 되었고, 어떤 외부 호출은 성공 증거가 있으며, 어떤 호출은 timeout으로 결과가 불명확한지 알아야 합니다. 이 정보가 없으면 실패한 job을 다시 실행할 때 전체를 되돌리거나, 반대로 같은 효과를 두 번 만들 위험을 감수해야 합니다.

Job Result Ledger는 job의 각 step 또는 대상 단위 결과를 누적하는 테이블입니다.

| 필드 | 의미 | 예시 |
| --- | --- | --- |
| `job_id` | 전체 작업 식별자 | `price-import-20260727-01` |
| `target_key` | 처리 대상 | `sku:KR-8812` |
| `step` | 검증, 적용, 외부 전송, 확인 | `apply_price` |
| `attempt` | 시도 번호 | `3` |
| `idempotency_key` | 중복 효과 방지 키 | `price:sku:KR-8812:v7` |
| `input_hash` | 같은 키에 다른 요청이 들어왔는지 확인 | `sha256:...` |
| `result_state` | 성공, 거부, 보류, 불명확 | `CONFIRMED` |
| `effect_ref` | DB row version, provider id, event id | `price_history:91321` |
| `evidence_ref` | 로그, 응답, 영수증, trace | `trace:abc123` |

중요한 점은 ledger가 로그 덤프가 아니라는 것입니다. 로그는 검색용이고, ledger는 재실행 판단용입니다. 같은 job을 다시 시작할 때 worker는 ledger를 먼저 보고 이미 확정된 target은 건너뛰고, 불명확한 target은 확인 또는 격리로 보냅니다.

### 2) 재시작 가능하다는 말은 같은 코드를 다시 돌린다는 뜻이 아니다

실무에서 "재시작 가능"을 단순히 while loop와 retry로 이해하면 위험합니다. 진짜 재시작 가능성은 아래 네 가지를 만족해야 합니다.

1. 이미 확정된 효과를 다시 만들지 않는다.
2. 실패한 대상만 다시 시도할 수 있다.
3. 결과가 불명확한 대상은 자동 재시도 전에 확인 경로로 보낸다.
4. 작업 코드가 바뀌어도 이전 checkpoint와 ledger를 해석할 수 있다.

예를 들어 결제 정산 보정 job이 외부 정산 API를 호출하다가 timeout 됐다고 합시다. 이때 HTTP client는 실패를 받았지만 정산 시스템은 요청을 처리했을 수 있습니다. 무조건 retry하면 중복 정산이 생깁니다. 반대로 실패로 확정하면 실제 처리된 금액과 내부 상태가 갈라질 수 있습니다. 이 구간은 `FAILED`가 아니라 `AMBIGUOUS_EFFECT` 같은 상태로 분리하고, provider 조회나 수동 확인으로 닫아야 합니다.

의사결정 우선순위는 **금전/권한/고객 데이터 정합성 > 중복 외부 전송 방지 > 빠른 완료 > worker 처리량**입니다. 처리량을 이유로 불명확한 효과를 자동 retry하는 것은 대부분 좋지 않습니다.

### 3) checkpoint는 progress bar가 아니라 재처리 경계다

checkpoint를 "몇 퍼센트 진행" 표시로만 쓰면 재처리에는 약합니다. 운영 가능한 checkpoint는 다시 시작할 수 있는 경계여야 합니다. cursor 기반 처리라면 정렬 기준과 마지막 처리 키가 안정적이어야 하고, 파일 처리라면 row number와 파일 checksum이 같이 있어야 하며, 이벤트 처리라면 topic, partition, offset, schema version이 같이 있어야 합니다.

초기 기준:

| 작업 유형 | checkpoint 단위 | 권장 저장 주기 |
| --- | --- | --- |
| CSV/Excel import | file checksum + row number | 100~1,000 row마다 |
| DB backfill | stable cursor + batch id | batch commit마다 |
| 외부 API sync | provider cursor + local target key | page 또는 target마다 |
| 이벤트 replay | topic/partition/offset + event id | 메시지 또는 작은 batch마다 |
| 대량 알림 | campaign id + recipient id | recipient 또는 shard마다 |

checkpoint는 너무 자주 저장하면 DB write가 늘고, 너무 드물면 재처리 범위가 커집니다. 시작값은 "worker가 죽었을 때 다시 처리해도 되는 최대 손실 시간"으로 잡습니다. 예를 들어 10분짜리 job에서 30초 이상 되돌아가면 외부 API quota가 아깝다면 30초 이내 checkpoint를 둡니다. 반대로 내부 읽기 전용 backfill이면 5분 단위도 충분할 수 있습니다.

### 4) lease와 heartbeat는 worker 생존 증거이지 결과 증거가 아니다

분산 worker 환경에서는 같은 job을 두 worker가 동시에 처리하지 않도록 lease를 둡니다. 하지만 lease를 잡았다고 결과가 안전해지는 것은 아닙니다. lease는 "지금 누가 작업 권한을 갖는가"를 말하고, result ledger는 "무엇이 실제로 확정됐는가"를 말합니다. 둘은 역할이 다릅니다.

stuck job 판정도 단순히 heartbeat 하나로 끝내면 안 됩니다.

- heartbeat가 2회 이상 누락됨
- progress checkpoint가 10분 이상 변하지 않음
- 같은 target에서 attempt가 3회 이상 반복됨
- downstream 5xx나 429가 5분 동안 10% 초과
- worker process는 살아 있지만 ledger write가 없음

이 신호가 같이 나타나면 worker를 죽이고 lease를 훔치는 것보다 먼저 target 상태를 봐야 합니다. 외부 side effect 직후에 worker가 멈췄다면 자동 steal이 중복 효과를 만들 수 있습니다. 이 구간에서는 `needs_reconciliation` queue로 보내는 편이 안전합니다.

### 5) 실패를 하나로 묶으면 운영자가 잘못 재시도한다

`FAILED` 하나로 모든 실패를 표현하면 재처리 버튼이 위험해집니다. 실패 유형별로 다음 행동이 달라야 합니다.

| 실패 유형 | 예시 | 기본 행동 |
| --- | --- | --- |
| `TRANSIENT` | 네트워크, 5xx, 일시 429 | 제한된 retry |
| `VALIDATION_REJECTED` | 입력 형식 오류, 비즈니스 규칙 위반 | 자동 retry 금지 |
| `CONFLICT` | 같은 키 다른 payload, 버전 불일치 | 최신 상태 확인 후 결정 |
| `AMBIGUOUS_EFFECT` | 외부 timeout 후 결과 불명확 | provider 조회 또는 수동 확인 |
| `POLICY_BLOCKED` | 승인 없음, scope 부족 | 승인 또는 작업 취소 |
| `BUG_SUSPECTED` | 같은 지점 반복 실패 | 배포/코드 수정 전 replay 금지 |

retry 횟수보다 실패 분류가 먼저입니다. 잘못 분류된 실패는 retry budget을 낭비하는 정도가 아니라 데이터 오염을 만들 수 있습니다.

## 실무 적용

### 1) 최소 스키마부터 만든다

처음부터 workflow engine을 도입할 필요는 없습니다. 하지만 long-running job을 운영한다면 최소한 아래 세 테이블 또는 동등한 구조는 필요합니다.

```sql
-- job header: 운영자가 보는 작업 단위
job_operation (
  job_id text primary key,
  job_type text not null,
  status text not null,
  requested_by text not null,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  risk_level text not null,
  stop_condition text,
  approval_ref text
);

-- progress: 재시작 경계
job_checkpoint (
  job_id text not null,
  shard_key text not null,
  checkpoint_token text not null,
  processed_count bigint not null,
  updated_at timestamptz not null,
  primary key (job_id, shard_key)
);

-- result ledger: 대상별 확정 효과
job_result_ledger (
  job_id text not null,
  target_key text not null,
  step text not null,
  attempt int not null,
  idempotency_key text not null,
  input_hash text not null,
  result_state text not null,
  effect_ref text,
  evidence_ref text,
  updated_at timestamptz not null,
  primary key (job_id, target_key, step)
);
```

이 구조는 단순합니다. 하지만 운영자가 "어디까지 됐고, 무엇을 다시 해도 되는가"를 묻는 순간 효과가 큽니다.

### 2) job 생성 기준을 숫자로 정한다

모든 작업을 job으로 만들 필요는 없습니다. 동기 API가 더 단순한 경우도 많습니다. 대신 아래 조건 중 하나라도 맞으면 job 모델을 검토합니다.

- p95 처리 시간이 5초를 넘을 가능성이 있다.
- 처리 대상이 1,000건 이상이거나 파일 크기가 10MB 이상이다.
- 외부 API, 이메일, 알림, 결제, 권한 변경 같은 side effect가 있다.
- 사용자가 진행 상태를 확인해야 한다.
- 중간 실패 후 일부만 재처리해야 한다.
- 운영자가 pause, resume, cancel, replay를 해야 한다.

이 조건은 [Async Request-Reply Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)와도 이어집니다. 사용자 요청이 길어질수록 API 응답은 처리 결과가 아니라 operation resource를 반환하는 편이 낫습니다.

### 3) 재처리 버튼에는 preflight를 붙인다

운영 UI에 "Retry" 버튼만 있으면 언젠가 사고가 납니다. 재처리 전에는 최소한 아래 preflight를 보여줘야 합니다.

```yaml
replay_preflight:
  job_id: "price-import-20260727-01"
  failed_targets: 381
  confirmed_targets: 98214
  ambiguous_effect_targets: 7
  validation_rejected_targets: 128
  last_checkpoint_age: "3m"
  downstream_error_rate_5m: "0.4%"
  code_version_changed: true
  requires_approval: true
  stop_if:
    - "ambiguous_effect_targets > 0"
    - "downstream_error_rate_5m > 5%"
    - "replay_reject_rate > 10%"
```

권장 기준은 명확합니다. `AMBIGUOUS_EFFECT`가 1건이라도 있으면 자동 전체 replay를 막습니다. 금전, 권한, 고객 알림, 외부 전송이 포함되면 승인자와 보상 경로를 요구합니다. 같은 실패가 3회 반복되면 retry가 아니라 code/config fix 대기열로 보냅니다.

### 4) 알람은 실패 건수보다 stuck과 불명확 효과를 본다

좋은 알람은 운영자가 행동할 수 있게 해야 합니다.

| 신호 | 초기 임계치 | 행동 |
| --- | ---: | --- |
| `oldest_running_job_age` | 예상 p95의 3배 | stuck 조사 |
| `checkpoint_stale_age` | 10분 | worker/DB/downstream 확인 |
| `ambiguous_effect_count` | 1건 이상 | 자동 replay 중지 |
| `retry_exhausted_count` | 10건 또는 1% | 실패 유형 재분류 |
| `ledger_write_error_rate` | 0.1% | worker 처리 중단 검토 |
| `manual_intervention_rate` | 1주 5% 초과 | workflow 설계 재검토 |

실패 건수만 보면 입력 품질이 나쁜 정상 reject와 시스템 장애를 구분하지 못합니다. 특히 `ambiguous_effect_count`는 낮은 숫자여도 중요합니다. 한 건의 불명확 결제, 한 건의 잘못된 권한 변경은 1,000건의 형식 오류보다 위험할 수 있습니다.

## 트레이드오프/주의점

첫째, ledger는 저장 비용과 설계 비용을 늘립니다. 대상 단위로 결과를 남기면 테이블이 커지고, 인덱스와 보존 정책이 필요합니다. 하지만 side effect가 있는 job에서 ledger가 없으면 장애 후 사람 시간이 더 비쌉니다. 보존 기간은 job 유형별로 나눕니다. 단순 import reject는 30~90일, 정산/권한/감사 job은 1년 이상 또는 규정 기준을 따릅니다.

둘째, 너무 세밀한 checkpoint는 오히려 병목이 됩니다. row마다 checkpoint를 저장하면 DB write가 job 자체보다 비싸질 수 있습니다. 내부 DB 변경만 있는 낮은 위험 batch는 batch 단위 checkpoint가 충분합니다. 외부 side effect가 있는 step만 대상 단위 ledger를 강하게 두는 식으로 차등 적용합니다.

셋째, 재시작 가능성을 과신하면 설계가 느슨해집니다. "다시 돌리면 된다"는 말은 입력과 코드가 같고, idempotency key가 안정적이고, 외부 효과가 확인 가능할 때만 맞습니다. job code version이 바뀌면 예전 ledger 해석이 깨질 수 있으므로 job마다 worker version과 schema version을 남깁니다.

넷째, compensation은 rollback보다 어렵습니다. 이미 고객에게 알림이 갔거나 외부 시스템에 전파된 결과는 DB row를 되돌린다고 끝나지 않습니다. 고위험 job은 실행 전에 보상 경로를 적어야 하고, 보상 자체도 별도 job result ledger를 가져야 합니다.

마지막으로, 모든 job을 완전 자동화하려고 하지 않는 편이 좋습니다. 자동 retry는 transient 오류에만 좁게 열고, business conflict와 ambiguous effect는 사람 판단을 거치는 것이 안전합니다. 우선순위는 **불명확 효과 격리 > 중복 방지 > 부분 재처리 > 처리량 개선**입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 5초 이상 또는 1,000건 이상 처리하는 작업은 job operation으로 모델링한다.
- [ ] job status와 target별 result ledger를 분리한다.
- [ ] 외부 side effect에는 idempotency key, input hash, effect ref가 있다.
- [ ] checkpoint는 progress 표시가 아니라 재시작 가능한 경계로 설계했다.
- [ ] `FAILED`를 transient, validation, conflict, ambiguous, policy, bug suspected로 분류한다.
- [ ] `AMBIGUOUS_EFFECT`가 있으면 자동 replay를 막는다.
- [ ] 재처리 버튼에는 affected count, last checkpoint, code version, stop condition이 보인다.
- [ ] ledger 보존 기간과 개인정보 마스킹 기준이 job 유형별로 정해져 있다.

### 연습

현재 서비스의 long-running 작업 하나를 고르세요. 대량 업로드, 월간 정산, 알림 발송, 검색 인덱스 재생성, 데이터 보정 중 무엇이든 됩니다. 그 작업을 `job_operation`, `job_checkpoint`, `job_result_ledger` 세 구조로 나눠 적어 봅니다. 이어서 실패 5가지를 `TRANSIENT`, `VALIDATION_REJECTED`, `CONFLICT`, `AMBIGUOUS_EFFECT`, `BUG_SUSPECTED`로 분류하고, 각 실패에 대해 자동 retry, 수동 확인, replay 금지 중 하나를 선택합니다. 표를 만든 뒤 "worker가 정확히 어느 줄에서 죽어도 중복 효과 없이 다시 시작할 수 있는가"를 마지막 질문으로 검증하면 됩니다.

## 관련 글

- [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)
- [Queue Visibility Timeout/Ack/Nack/DLQ](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)
- [Bulk Import Job](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/)
- [Operational State Machine](/learning/deep-dive/deep-dive-operational-state-machine-design/)

