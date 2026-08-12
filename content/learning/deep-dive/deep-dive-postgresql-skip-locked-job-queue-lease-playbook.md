---
title: "백엔드 커리큘럼 심화: PostgreSQL SKIP LOCKED 작업 큐, Claim·Lease·재처리를 안전하게 설계하는 법"
date: 2026-08-12T10:06:00+09:00
lastmod: 2026-08-12T10:06:00+09:00
draft: false
topic: "Database"
tags: ["PostgreSQL", "SKIP LOCKED", "Job Queue", "Lease", "Idempotency", "Concurrency", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL SELECT FOR UPDATE SKIP LOCKED로 작업 큐를 만들 때 claim 트랜잭션, lease 만료, fencing token, 재시도, starvation과 관측 기준을 함께 설계하는 실무 플레이북입니다."
module: "database"
study_order: 1483
summary: "SKIP LOCKED는 여러 워커의 대기를 줄여 주지만 exactly-once 처리나 장애 복구를 자동으로 보장하지 않습니다. 짧은 claim 트랜잭션, 만료 가능한 lease, claim token 조건부 완료, 멱등성, 공정성 지표를 하나의 작업 큐 계약으로 묶는 방법을 정리합니다."
keywords: ["PostgreSQL SKIP LOCKED", "database job queue", "lease pattern", "job claim", "worker crash recovery", "queue starvation"]
key_takeaways:
  - "SKIP LOCKED가 보장하는 것은 잠긴 후보를 기다리지 않고 건너뛰는 것이며, 작업의 exactly-once 실행이나 외부 부수 효과의 중복 방지는 별도 문제다."
  - "row lock을 실제 작업 시간 동안 잡지 말고, 짧은 트랜잭션에서 claim token과 locked_until을 기록한 뒤 커밋해야 한다."
  - "완료와 실패 갱신은 job id뿐 아니라 claim token까지 조건에 넣어 lease가 만료된 이전 워커의 늦은 결과를 차단해야 한다."
  - "처리량뿐 아니라 ready 대기시간 p95, claim 지연, lease 만료율, 재처리율, 우선순위별 starvation을 운영 지표로 관리해야 한다."
operator_checklist:
  - "claim 쿼리는 FOR UPDATE SKIP LOCKED와 UPDATE RETURNING을 한 트랜잭션에 묶고 100ms 이내 종료를 목표로 한다."
  - "lease는 작업 p99의 2~3배로 시작하고 heartbeat 또는 단계별 checkpoint 없이 무작정 길게 두지 않는다."
  - "완료 UPDATE에 id, status=running, claim_token 조건을 모두 넣고 영향 row가 0이면 stale worker 결과로 폐기한다."
  - "oldest_ready_age, expired_lease_rate, attempt 분포와 dead-letter 유입량에 숫자 임계값을 둔다."
learning_refs:
  - title: "Database Locking과 경합 진단"
    href: "/learning/deep-dive/deep-dive-database-locking-contention-playbook/"
    description: "row lock 대기와 긴 트랜잭션이 처리량을 무너뜨리는 경로를 진단합니다."
  - title: "Queue Visibility Timeout과 ACK/NACK"
    href: "/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/"
    description: "브로커의 visibility timeout을 DB lease 모델과 비교해 볼 수 있습니다."
  - title: "재시작 가능한 Worker와 결과 Ledger"
    href: "/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/"
    description: "장기 작업의 checkpoint와 결과 증거를 남기는 방법입니다."
  - title: "Outbox와 Saga 패턴"
    href: "/learning/deep-dive/deep-dive-outbox-saga-patterns/"
    description: "DB 상태 변경과 외부 이벤트 발행의 경계를 설계합니다."
decision_guide:
  title: "DB 작업 큐를 어디까지 사용할까"
  intro: "처리량 숫자 하나보다 트랜잭션 경계, 재처리 요구, 운영 인력과 데이터 일관성을 함께 봅니다."
  cases:
    - badge: "PostgreSQL Queue"
      title: "업무 데이터와 작업 생성이 같은 트랜잭션에 있어야 한다"
      fit: "초당 수십~수백 건, 단일 리전, 수초~수분 작업이며 이미 PostgreSQL을 안정적으로 운영하는 경우"
      watchouts: "polling과 상태 갱신이 primary DB의 I/O·vacuum 예산을 사용한다."
      next_step: "20개 이하 batch, 100ms 이하 claim, DB CPU 60% 이하를 초기 gate로 두고 peak 부하를 측정한다."
    - badge: "Hybrid"
      title: "DB가 원장이지만 실행 fan-out은 더 커져야 한다"
      fit: "outbox에 작업 의도를 기록하고 broker가 대규모 worker로 전달하는 구조"
      watchouts: "DB job 상태와 broker ack 사이에 중복 전달이 생길 수 있다."
      next_step: "event id 멱등성, relay lag, 재발행 도구를 먼저 만든다."
    - badge: "Message Broker"
      title: "초당 수천 건 이상, 다중 리전 또는 복잡한 라우팅이 필요하다"
      fit: "consumer group, partition, delay queue, 장기 replay가 핵심 기능인 경우"
      watchouts: "브로커를 도입해도 business effect의 멱등성과 결과 ledger는 사라지지 않는다."
      next_step: "현재 backlog·ordering·replay 요구를 문서화하고 작은 트래픽부터 이관한다."
faqs:
  - question: "SKIP LOCKED를 쓰면 같은 작업을 두 워커가 실행하지 않나요?"
    answer: "동일한 claim 트랜잭션 안에서는 잠긴 row를 다른 워커가 건너뛰므로 동시 선택을 줄일 수 있습니다. 그러나 claim 후 워커가 오래 멈추거나 lease가 만료되면 재할당된 작업과 이전 워커가 겹칠 수 있으므로 claim token과 멱등성이 필요합니다."
  - question: "작업이 끝날 때까지 row lock을 잡으면 더 단순하지 않나요?"
    answer: "짧은 작업과 낮은 동시성에서는 가능하지만 외부 API나 수분짜리 작업이 트랜잭션에 들어가면 connection, lock, vacuum을 오래 점유하고 장애 시 복구 범위도 커집니다. claim만 짧게 커밋하는 편이 안전합니다."
  - question: "lease가 길수록 중복 실행이 줄지 않나요?"
    answer: "중복 재할당 가능성은 줄지만 죽은 워커의 복구가 그만큼 늦습니다. 작업 p99의 2~3배로 시작하고, 장기 작업은 heartbeat와 checkpoint로 lease를 갱신하는 것이 낫습니다."
---

작은 서비스가 비동기 작업을 시작할 때 Kafka나 RabbitMQ부터 도입할 필요는 없습니다. 이메일 예약, 리포트 생성, 파일 변환, 정산 후속 처리처럼 **업무 데이터와 작업 생성이 같은 데이터베이스 트랜잭션에 있어야 하는 경우**에는 PostgreSQL 테이블이 실용적인 큐가 됩니다. 특히 `SELECT ... FOR UPDATE SKIP LOCKED`는 여러 워커가 같은 후보를 보더라도 잠긴 row를 기다리지 않고 다음 작업으로 넘어가게 해 처리량을 높일 수 있습니다.

문제는 `SKIP LOCKED` 한 줄을 넣었다고 작업 큐가 완성됐다고 생각할 때 시작됩니다. 워커가 claim 직후 죽으면 누가 작업을 되살릴까요? lease가 만료된 순간 이전 워커가 늦게 완료되면 어느 결과를 믿어야 할까요? 높은 우선순위 작업이 계속 들어오면 오래된 일반 작업은 언제 실행될까요? 이 글은 [Database Locking과 경합 진단](/learning/deep-dive/deep-dive-database-locking-contention-playbook/), [Queue Visibility Timeout과 ACK/NACK](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/), [재시작 가능한 Worker와 결과 Ledger](/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/), [Outbox와 Saga 패턴](/learning/deep-dive/deep-dive-outbox-saga-patterns/)을 PostgreSQL 작업 큐라는 구체적인 구조로 연결합니다.

## 이 글에서 얻는 것

- `FOR UPDATE SKIP LOCKED`가 보장하는 범위와 보장하지 않는 범위를 구분합니다.
- claim, lease, heartbeat, reclaim, ACK를 하나의 상태 전이 계약으로 설계합니다.
- 오래된 워커의 늦은 완료를 claim token으로 차단하는 방법을 익힙니다.
- 처리량과 DB 부하뿐 아니라 starvation과 복구 품질을 숫자로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) SKIP LOCKED는 대기 회피이지 exactly-once 보장이 아니다

일반적인 `FOR UPDATE`는 다른 트랜잭션이 같은 row lock을 풀 때까지 기다립니다. 여러 워커가 `ready` 작업의 선두 row를 동시에 보면 convoy가 생길 수 있습니다. `SKIP LOCKED`는 이미 잠긴 row를 건너뛰고 다음 후보를 선택하므로 독립적인 작업 분배에 유리합니다.

하지만 보장 범위는 여기까지입니다.

| 질문 | SKIP LOCKED가 해결하는가 | 추가로 필요한 것 |
| --- | --- | --- |
| 두 claim 트랜잭션이 같은 row를 동시에 선택하는가 | 대부분 방지 | 원자적 상태 갱신 |
| claim 후 워커가 죽은 작업이 복구되는가 | 아니요 | lease와 reclaim |
| lease가 만료된 이전 워커의 늦은 완료를 막는가 | 아니요 | claim token 또는 fencing version |
| 외부 결제·이메일이 두 번 실행되지 않는가 | 아니요 | idempotency key와 결과 ledger |
| 낮은 우선순위 작업이 굶지 않는가 | 아니요 | aging, quota, 대기시간 SLO |

실무 목표도 “정확히 한 번 실행”보다 **at-least-once 실행을 전제로 효과가 한 번만 반영되게 하는 것**에 가깝습니다. 프로세스와 네트워크가 끊길 수 있는 환경에서는 실행 여부와 완료 기록 사이의 원자성을 외부 시스템까지 확장하기 어렵기 때문입니다.

### 2) 상태 모델에 소유권과 만료 시각을 넣는다

최소 스키마는 `ready`, `running`, `succeeded`, `failed`, `dead` 상태만으로 부족합니다. 누가 언제까지 소유하는지와 몇 번째 시도인지도 필요합니다.

```sql
CREATE TABLE jobs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_type        text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'ready',
  priority        smallint NOT NULL DEFAULT 0,
  run_at          timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  locked_by       text,
  locked_until    timestamptz,
  claim_token     uuid,
  last_error_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE INDEX jobs_ready_pick_idx
  ON jobs (priority DESC, run_at, id)
  WHERE status = 'ready';

CREATE INDEX jobs_expired_lease_idx
  ON jobs (locked_until, id)
  WHERE status = 'running';
```

`locked_until`은 영구 소유권이 아니라 lease입니다. `claim_token`은 같은 job의 세 번째 시도와 네 번째 시도를 구분하는 fencing 값입니다. `attempts`는 retry budget이고 `run_at`은 exponential backoff와 예약 실행을 함께 표현합니다.

### 3) Claim은 짧고 원자적인 트랜잭션이어야 한다

후보 조회와 상태 변경을 분리하면 두 워커가 같은 id를 읽는 경쟁 조건이 생깁니다. CTE와 `UPDATE ... RETURNING`을 한 트랜잭션에 묶습니다.

```sql
BEGIN;

WITH picked AS (
  SELECT id
  FROM jobs
  WHERE status = 'ready'
    AND run_at <= now()
  ORDER BY priority DESC, run_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 20
)
UPDATE jobs AS j
SET status       = 'running',
    locked_by    = :worker_id,
    locked_until = now() + interval '90 seconds',
    claim_token  = gen_random_uuid(),
    attempts     = attempts + 1,
    updated_at   = now()
FROM picked
WHERE j.id = picked.id
RETURNING j.id, j.job_type, j.payload, j.attempts,
          j.locked_until, j.claim_token;

COMMIT;
```

중요한 규칙은 **실제 작업을 이 트랜잭션 안에서 실행하지 않는 것**입니다. 외부 API가 20초 걸리거나 파일 변환이 5분 걸리는데 row lock과 DB connection을 계속 잡으면 worker 수가 늘수록 primary가 먼저 포화됩니다. claim 트랜잭션은 초기 기준으로 p99 100ms 이하, batch 10~20개부터 시작합니다. 실제 작업은 커밋 후 수행합니다.

batch를 무작정 500개로 늘리면 한 워커가 좋은 작업을 독점하고, 처리 도중 죽을 때 500개가 한꺼번에 lease 만료를 기다립니다. 작업 시간이 긴 큐일수록 작은 batch가 복구와 공정성에 유리합니다.

### 4) Lease 만료와 늦은 완료 사이에는 fencing이 필요하다

작업 A를 워커 W1이 claim했지만 긴 GC pause로 90초 동안 멈췄다고 합시다. lease가 만료되어 W2가 A를 다시 claim하고 처리합니다. 그 순간 W1이 깨어나 `UPDATE jobs SET status='succeeded' WHERE id=A`를 실행하면 W2의 새 소유권을 덮어씁니다.

완료 조건에 claim token을 넣어야 합니다.

```sql
UPDATE jobs
SET status = 'succeeded',
    finished_at = now(),
    locked_by = NULL,
    locked_until = NULL,
    updated_at = now()
WHERE id = :job_id
  AND status = 'running'
  AND claim_token = :claim_token;
```

영향 row가 0이면 성공으로 간주하지 않습니다. 이미 다른 시도가 소유권을 가져간 **stale worker 결과**입니다. 외부 시스템에도 fencing version을 전달할 수 있다면 더 강해집니다. 그렇지 못한 이메일·결제 API에는 `job:{id}:effect:{effect_name}` 같은 안정적인 idempotency key와 결과 ledger가 필요합니다.

긴 작업은 heartbeat로 lease를 연장할 수 있습니다.

```sql
UPDATE jobs
SET locked_until = now() + interval '90 seconds',
    updated_at = now()
WHERE id = :job_id
  AND status = 'running'
  AND claim_token = :claim_token
  AND locked_until > now();
```

heartbeat가 실패했는데 계속 외부 효과를 실행하면 소유권이 겹칩니다. 영향 row 0 또는 연속 2회 heartbeat 실패 시 다음 부수 효과를 중단하고 checkpoint에서 재개하도록 설계합니다.

### 5) Reclaim은 실패를 숨기지 않고 재시도 예산을 소비해야 한다

만료된 `running` 작업을 단순히 `ready`로 돌리기만 하면 영원히 반복되는 poison job이 생깁니다. reclaim 시도도 retry budget에 포함하고 마지막 오류 원인을 구분합니다.

```sql
UPDATE jobs
SET status = CASE
      WHEN attempts >= max_attempts THEN 'dead'
      ELSE 'ready'
    END,
    run_at = CASE
      WHEN attempts >= max_attempts THEN run_at
      ELSE now() + make_interval(secs => LEAST(900, 5 * power(2, attempts)::int))
    END,
    locked_by = NULL,
    locked_until = NULL,
    claim_token = NULL,
    last_error_code = 'LEASE_EXPIRED',
    updated_at = now()
WHERE status = 'running'
  AND locked_until < now();
```

재시도에는 full jitter를 섞는 편이 좋습니다. DB 함수 안에서 복잡한 난수를 만들기보다 애플리케이션이 다음 `run_at`을 계산해 기록해도 됩니다. 중요한 것은 무제한 즉시 재시도를 막고 `dead` 상태를 운영자가 검색·검토·재주입할 수 있게 하는 것입니다.

### 6) 우선순위 정렬은 starvation 계약과 함께 둔다

`ORDER BY priority DESC`만 쓰면 높은 우선순위가 계속 유입될 때 일반 작업이 영원히 뒤로 밀릴 수 있습니다. 해결 방법은 하나가 아닙니다.

- aging: 대기 5분마다 effective priority를 1 올리되 상한을 둔다.
- quota: 한 batch 20개 중 high 12, normal 6, low 2를 예약한다.
- pool 분리: 결제 후속 처리와 대용량 export를 다른 worker pool로 분리한다.
- deadline: `created_at`이 30분을 넘은 작업을 우선 선발한다.

큐 전체 평균 대기시간만 보면 low priority starvation이 숨습니다. priority별 `oldest_ready_age_seconds`와 p95를 따로 봐야 합니다.

## 실무 적용

### 1) 먼저 작업 시간 분포와 lease를 맞춘다

lease 기본값을 감으로 30분으로 잡으면 죽은 작업의 복구도 30분 늦어집니다. 반대로 10초로 잡으면 정상적인 20초 작업이 중복 실행됩니다.

초기 규칙:

1. 최근 7일 작업 시간 p50/p95/p99를 job type별로 측정합니다.
2. lease는 p99의 2~3배로 시작하되 최소 30초, 기본 상한 5분을 둡니다.
3. 5분을 넘는 작업은 heartbeat와 checkpoint를 의무화합니다.
4. 작업 시간 분포가 10배 이상 다른 유형은 큐나 worker pool을 분리합니다.
5. `expired_lease_rate > 0.5%`가 15분 지속되면 단순 lease 연장 전에 worker pause, 외부 지연, GC, DB 지연을 조사합니다.

### 2) Claim 경로를 부하 테스트한다

처리 함수가 빨라도 claim 쿼리가 index를 타지 않거나 vacuum이 밀리면 큐가 멈춥니다. peak의 2배 worker로 30분 테스트하고 다음 gate를 기록합니다.

| 지표 | 초기 목표 | 초과 시 우선 확인 |
| --- | --- | --- |
| claim query p99 | 100ms 이하 | partial index, batch, lock wait |
| claim transaction p99 | 150ms 이하 | connection acquire, 불필요한 로직 |
| DB CPU | 60% 이하 | polling 간격, worker 수, query plan |
| ready backlog p95 age | 업무 SLO의 50% 이하 | 처리 용량, hot job type |
| expired lease rate | 0.5% 미만 | 작업 p99, heartbeat, worker pause |
| dead-letter 유입 | 전체의 0.1% 미만 | poison payload, 외부 API 오류 |

빈 큐를 모든 worker가 10ms마다 polling하면 유휴 상태에서도 DB를 두드립니다. 빈 결과가 연속되면 100ms, 250ms, 500ms, 최대 2초까지 jitter를 넣어 늦추고 새 작업 신호가 있으면 다시 빠르게 poll합니다.

### 3) 완료, 실패, 취소를 조건부 상태 전이로 만든다

모든 갱신은 현재 상태와 claim token을 확인합니다.

- `running -> succeeded`: claim token 일치 + 결과 ledger 저장 완료
- `running -> ready`: retryable 오류 + attempt budget 남음
- `running -> dead`: permanent 오류 또는 max attempts 도달
- `ready -> cancelled`: 아직 claim되지 않은 사용자 취소
- `running -> cancel_requested`: worker가 안전한 checkpoint에서 중단

오류 문자열 전체를 metric label로 넣지 않습니다. `TIMEOUT`, `RATE_LIMIT`, `INVALID_PAYLOAD`, `LEASE_EXPIRED`, `PERMANENT_REMOTE_ERROR`처럼 제한된 code로 집계하고 상세 stack trace는 log와 trace에 둡니다.

### 4) 운영 대시보드는 처리량보다 복구 가능성을 보여준다

필수 패널:

- job type·priority별 ready/running/dead count
- `oldest_ready_age_seconds`와 queue wait p50/p95/p99
- claim query latency와 0-row claim 비율
- attempt 번호별 성공률
- lease 연장 횟수와 만료율
- stale completion 거절 건수
- dead job의 error code 상위 10개
- worker별 처리량, heartbeat age, 최근 성공 시각

stale completion이 0이 아니라고 무조건 장애는 아닙니다. fencing이 실제 경쟁을 막았다는 신호일 수 있습니다. 다만 전체 완료의 0.1%를 넘거나 같은 job type에 집중되면 lease와 작업 분할을 재검토합니다.

### 5) Broker 이관 기준을 미리 정한다

PostgreSQL 큐는 좋은 출발점이지만 모든 문제의 종착지는 아닙니다. 아래 중 2개 이상이면 broker 또는 outbox+broker 구조를 검토합니다.

- 지속 처리량이 초당 1,000건을 넘고 queue write가 primary I/O의 20% 이상을 사용한다.
- 다중 리전 consumer와 지역별 재처리가 필요하다.
- routing key, consumer group, 긴 보존과 임의 replay가 핵심 요구다.
- queue table churn 때문에 autovacuum lag와 bloat가 반복된다.
- DB 장애와 비동기 실행 경로의 장애 도메인을 분리해야 한다.

이 숫자는 절대 법칙이 아니라 재검토 trigger입니다. 초당 2,000건도 작은 payload와 충분한 DB에서는 가능하고, 초당 100건도 무거운 JSONB·긴 트랜잭션이면 문제가 됩니다. 실제 DB CPU, WAL, vacuum, query p99를 근거로 결정합니다.

## 트레이드오프/주의점

1. **원자성은 쉽지만 DB 부하가 결합됩니다.** 업무 row와 job row를 같은 트랜잭션에 넣을 수 있는 대신, backlog와 polling이 primary의 I/O·WAL·vacuum 예산을 사용합니다.
2. **SKIP LOCKED는 공정한 순서를 보장하지 않습니다.** 잠금 상태와 실행 계획에 따라 관측 순서가 달라질 수 있으므로 절대적인 FIFO가 필요한 문제에는 맞지 않습니다.
3. **긴 lease는 중복을 줄이는 대신 복구를 늦춥니다.** 짧은 lease는 반대입니다. 작업 분할과 heartbeat 없이 값만 조정하면 한쪽 문제가 반복됩니다.
4. **JSONB payload는 편하지만 스키마 drift를 숨깁니다.** `job_type`, `payload_version`, 최대 크기와 validator를 두고 64KB를 넘는 본문은 object storage 참조로 분리합니다.
5. **완료 row를 영구 보존하면 테이블이 비대해집니다.** 활성 큐와 결과 이력을 분리하고, succeeded row는 7~30일 뒤 archive 또는 삭제하는 정책을 둡니다.
6. **외부 효과의 중복은 DB만으로 막기 어렵습니다.** 결제, 이메일, webhook 대상 시스템에 idempotency key가 없으면 결과 ledger와 사전 조회·보상 정책이 필요합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 후보 선택과 `running` 전환이 한 트랜잭션의 `UPDATE ... RETURNING`으로 묶여 있다.
- [ ] 실제 외부 작업은 claim 트랜잭션 커밋 후 실행한다.
- [ ] 모든 claim에 `locked_until`과 새 `claim_token`이 발급된다.
- [ ] 완료·실패·heartbeat 갱신은 claim token이 일치할 때만 성공한다.
- [ ] lease 만료 작업의 reclaim과 max attempts 이후 `dead` 전이가 자동화되어 있다.
- [ ] 외부 부수 효과에 안정적인 idempotency key 또는 결과 ledger가 있다.
- [ ] job type과 priority별 queue wait p95·oldest age를 관측한다.
- [ ] 빈 큐 polling에 backoff와 jitter가 있다.
- [ ] ready/running partial index와 autovacuum·bloat 상태를 점검한다.
- [ ] broker 이관 trigger와 dead job 재처리 권한·감사 로그가 문서화되어 있다.

### 연습

1. 처리 시간 p50 8초, p95 35초, p99 70초인 이미지 변환 작업의 초기 lease, heartbeat 주기, max attempts를 정하고 이유를 적어 보세요.
2. W1의 lease가 만료된 뒤 W2가 같은 job을 claim한 시나리오를 만들고, claim token이 없는 완료 쿼리와 있는 쿼리의 결과를 비교해 보세요.
3. high priority가 초당 50건, normal이 초당 20건 유입되는 큐에서 worker 처리량이 초당 60건이라면 normal starvation을 막을 quota 또는 aging 규칙을 설계해 보세요.
4. `EXPLAIN (ANALYZE, BUFFERS)`로 claim 쿼리의 partial index 사용 여부를 확인하고 batch 10·20·100의 lock 시간과 처리량을 비교해 보세요.

PostgreSQL 작업 큐의 핵심은 SQL 문법이 아니라 **소유권이 만료되고 다시 넘어갈 수 있다는 사실을 상태 전이로 표현하는 것**입니다. claim을 짧게 끝내고, lease와 fencing으로 오래된 워커를 막고, 멱등성으로 외부 효과를 보호하고, starvation과 복구 시간을 숫자로 관측해야 비로소 운영 가능한 큐가 됩니다.
