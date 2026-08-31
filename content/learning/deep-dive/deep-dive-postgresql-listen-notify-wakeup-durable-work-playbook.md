---
title: "백엔드 커리큘럼 심화: PostgreSQL LISTEN/NOTIFY, 내구성 큐가 아닌 깨우기 신호로 안전하게 쓰는 법"
date: 2026-08-25T10:06:00+09:00
lastmod: 2026-08-25T10:06:00+09:00
draft: false
topic: "Database"
tags: ["PostgreSQL", "LISTEN", "NOTIFY", "Async Processing", "Job Queue", "Connection Pool", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL LISTEN/NOTIFY를 메시지 브로커나 작업 큐로 오해하지 않고, 커밋과 함께 전달되는 저지연 wake-up 신호로 사용하는 설계·복구·커넥션 풀·관측 기준을 정리합니다."
module: "database"
study_order: 1484
summary: "LISTEN/NOTIFY는 작업을 전달했다는 영수증이 아니라 ‘DB를 다시 확인하라’는 힌트다. 작업 사실은 테이블 또는 outbox에 내구적으로 기록하고, NOTIFY는 커밋 뒤 worker를 깨우며, 주기 스캔과 원자적 claim이 유실·재접속·중복 wake-up을 흡수하도록 설계해야 한다."
keywords: ["PostgreSQL LISTEN NOTIFY", "postgres notification queue", "durable job queue", "wake up signal", "PgBouncer LISTEN", "async worker design"]
key_takeaways:
  - "NOTIFY는 트랜잭션이 커밋된 뒤에만 전달되며, 같은 트랜잭션 안의 동일 channel·payload는 접힐 수 있으므로 수신 건수로 작업 건수를 세면 안 된다."
  - "작업의 원장과 재처리 상태는 jobs/outbox 테이블에 남기고, notification payload에는 업무 데이터 대신 짧은 힌트만 둔다."
  - "LISTEN은 세션 상태이므로 worker마다 전용 장기 연결 또는 session pooling이 필요하며, transaction pooling 연결에 listener 상태를 기대하면 안 된다."
  - "재접속·알림 누락을 전제로 startup scan, 15~60초 fallback scan, 원자적 claim, queue usage 관측을 하나의 운영 계약으로 묶는다."
operator_checklist:
  - "LISTEN을 commit한 직후 새 트랜잭션에서 backlog를 먼저 scan하고, 그 뒤 notification을 힌트로만 사용한다."
  - "worker claim은 UPDATE ... RETURNING 또는 FOR UPDATE SKIP LOCKED로 원자화하고, 실제 업무 처리는 DB 트랜잭션 밖에서 수행한다."
  - "listener connection의 idle/transaction 시간, reconnect 횟수, fallback scan age, pg_notification_queue_usage()를 대시보드에 둔다."
  - "NOTIFY payload에는 PII·토큰·원문 요청을 넣지 않고, channel과 payload의 소유자·스키마·최대 길이를 문서화한다."
learning_refs:
  - title: "PostgreSQL SKIP LOCKED 작업 큐"
    href: "/learning/deep-dive/deep-dive-postgresql-skip-locked-job-queue-lease-playbook/"
    description: "여러 worker가 내구성 있는 작업 row를 claim·lease·재처리하는 방법을 다룹니다."
  - title: "Transactional Outbox + CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "업무 변경과 후속 발행 의도를 같은 커밋에 기록하는 기준입니다."
  - title: "커넥션 풀 크기와 포화"
    href: "/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/"
    description: "listener 전용 연결을 일반 요청 풀과 분리해야 하는 이유를 연결합니다."
  - title: "Event Schema Registry 호환성"
    href: "/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/"
    description: "channel 이름과 payload도 진화 가능한 계약으로 관리하는 관점입니다."
decision_guide:
  title: "LISTEN/NOTIFY를 쓸 곳과 쓰지 말아야 할 곳"
  intro: "판단 기준은 지연 시간이 아니라, 작업 사실을 잃어도 되는지와 누가 재처리를 책임지는지입니다."
  cases:
    - badge: "적합"
      title: "같은 PostgreSQL에 이미 내구성 있는 작업·outbox row가 있다"
      fit: "단일 리전 또는 작은 범위에서 worker polling 지연을 줄이고 싶고, 정기 스캔으로도 정확성을 유지할 수 있는 경우입니다."
      watchouts: "각 listener는 같은 신호를 모두 받습니다. notification을 work item 분배로 해석하면 불필요한 wake-up과 경쟁이 생깁니다."
      next_step: "작업 row를 먼저 만들고, commit 후 pg_notify()로 worker를 깨우는 2주 canary를 운영합니다."
    - badge: "보류"
      title: "수신 횟수·순서·장기 replay 자체가 업무 계약이다"
      fit: "수천 건/s 이상, 다중 리전, consumer group, partition ordering, 장기 보존·replay가 제품 요구인 경우입니다."
      watchouts: "LISTEN/NOTIFY는 durable subscription이나 소비 ACK를 제공하지 않습니다."
      next_step: "Kafka·SQS·RabbitMQ 같은 브로커와 outbox relay를 우선 검토합니다."
    - badge: "주의"
      title: "PgBouncer transaction pooling만 사용한다"
      fit: "일반 HTTP 요청 DB 연결을 짧게 재사용하는 서비스에 흔한 상태입니다."
      watchouts: "LISTEN 등록은 서버 세션에 붙습니다. 요청마다 바뀌는 backend connection은 listener가 아닙니다."
      next_step: "worker 전용 direct connection 또는 PgBouncer session pool을 별도 구성하고 reconnect 시험을 합니다."
faqs:
  - question: "NOTIFY가 커밋 뒤에 오면 작업 큐로 써도 안전하지 않나요?"
    answer: "커밋과 함께 신호가 나온다는 점은 강점이지만, notification 자체는 소비 ACK·재처리 이력·개별 분배를 저장하지 않습니다. 작업 row를 원장으로 두고 NOTIFY는 그 row를 확인하라는 wake-up으로 한정해야 합니다."
  - question: "payload에 job id를 넣으면 테이블 조회를 생략할 수 있나요?"
    answer: "그렇게 하면 재접속 중 놓친 작업, 동일 payload 접힘, 수신 전 프로세스 장애를 복구할 수 없습니다. job id는 최적화 힌트로 쓸 수 있어도, worker는 항상 ready backlog를 조회하는 경로를 유지해야 합니다."
  - question: "모든 worker가 같은 notification을 받으면 낭비 아닌가요?"
    answer: "맞습니다. 그래서 wake-up을 debounce하고, 각 worker는 작은 batch만 원자적으로 claim합니다. fan-out이 큰 고처리량 시스템은 이 구조보다 broker consumer group이 더 적합합니다."
---

`LISTEN`과 `NOTIFY`는 PostgreSQL만으로 비동기 처리를 시작할 때 매우 매력적으로 보입니다. 업무 트랜잭션이 커밋되면 worker가 거의 즉시 깨어나고, 별도 broker를 운영하지 않아도 됩니다. 하지만 이 기능을 ‘메시지가 정확히 한 번 전달되는 큐’라고 해석하면 금방 위험해집니다. PostgreSQL 공식 문서가 권하는 기본 모양도 payload에 모든 내용을 싣는 방식이 아니라 **테이블에서 바뀐 사실을 알리고 수신자가 다시 조회하는 방식**입니다.

이 글의 결론은 단순합니다. **작업의 사실과 상태는 내구성 있는 테이블에, NOTIFY는 그 테이블을 지금 확인하라는 저지연 wake-up에 둡니다.** 이 구조는 [PostgreSQL SKIP LOCKED 작업 큐](/learning/deep-dive/deep-dive-postgresql-skip-locked-job-queue-lease-playbook/), [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [커넥션 풀 크기와 포화](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/), [Event Schema Registry 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)을 연결하는 작은 비동기 패턴입니다. 여기서 `NOTIFY`는 정확성 계층이 아니라 지연을 줄이는 계층입니다.

참고한 공식 문서:

- [PostgreSQL NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html)

## 이 글에서 얻는 것

- `NOTIFY`가 커밋, 중복 접힘, broadcast, 수신 시점에서 실제로 보장하는 범위를 구분합니다.
- notification을 전달 원장이 아닌 **깨우기 힌트**로 두는 DB 작업 구조를 설계합니다.
- `LISTEN` 등록 시의 race, 재접속, PgBouncer transaction pooling, 긴 트랜잭션 문제를 피하는 방법을 익힙니다.
- fallback scan·claim·queue usage·reconnect를 숫자로 운영하는 기준을 만듭니다.

## 핵심 개념/이슈

### 1) NOTIFY는 커밋과 함께 보이는 신호이지, 소비 이력이 아니다

`NOTIFY channel, payload`는 같은 데이터베이스에서 해당 channel을 `LISTEN` 중인 **모든 세션**에 비동기 신호를 보냅니다. 중요한 트랜잭션 규칙은 두 가지입니다.

1. 발신 트랜잭션이 commit되어야 신호가 전달됩니다. rollback된 업무 변경이 worker를 깨우는 일은 없습니다.
2. listener가 트랜잭션 안에 있으면, 클라이언트는 그 트랜잭션이 끝난 뒤에 신호를 받습니다. 실시간성이 필요한 listener는 긴 조회 트랜잭션을 열어 두면 안 됩니다.

여기에 세 가지 제한을 더해야 합니다.

| 성질 | 설계에 미치는 영향 |
| --- | --- |
| 같은 트랜잭션의 동일 channel·동일 payload는 접힐 수 있음 | 받은 notification 수로 생성된 작업 수를 세면 안 됩니다. |
| 모든 listener가 같은 신호를 받음 | 경쟁 worker 분배가 아니라 backlog scan을 깨우는 fan-out입니다. |
| 기본 payload는 8,000 bytes보다 짧아야 함 | 큰 JSON·파일·개인정보를 넣지 말고, 원장은 테이블에 둡니다. |

따라서 `NOTIFY billing_work, 'job-392'`는 “392번 작업을 반드시 한 번만 처리하라”가 아닙니다. 안전한 해석은 **“billing 작업 상태가 바뀌었을 수 있으니, ready row를 다시 claim해 보라”**입니다. 같은 신호를 두 번 받거나 한 번 못 받아도, 다음 scan이 작업을 찾아야 합니다.

### 2) 내구성은 jobs/outbox 테이블이, 저지연은 NOTIFY가 담당한다

안전한 구조에서는 업무 쓰기와 작업 생성이 한 트랜잭션에 들어갑니다. 예를 들어 결제가 승인됐다는 사실과 영수증 발송 작업은 함께 commit하고, 같은 트랜잭션 끝에서 worker를 깨웁니다.

```sql
BEGIN;

UPDATE payments
SET status = 'approved', approved_at = now()
WHERE id = :payment_id
  AND status = 'pending';

INSERT INTO jobs (job_type, payload, status, run_at, created_at)
VALUES ('send_receipt', jsonb_build_object('payment_id', :payment_id), 'ready', now(), now());

-- payload는 업무 원문이 아니라 짧은 힌트다.
SELECT pg_notify('billing_work_available', 'ready');

COMMIT;
```

이때 job row가 진짜 원장입니다. worker가 죽거나 네트워크가 잠깐 끊겨도 `jobs.status = 'ready'`가 남고, 재시작 worker가 다시 집을 수 있습니다. 알림을 받지 못한 것은 지연 문제일 뿐 유실 문제가 아닙니다. 업무 변경과 작업 의도를 함께 기록해야 한다는 이유는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)의 이중 쓰기 문제와 같습니다.

반대로 아래는 피합니다.

```text
나쁜 구조: API → COMMIT 업무 변경 → NOTIFY에 전체 명령 JSON → listener가 수신 건수만큼 처리
결과: listener 재시작·중복 접힘·payload 제한·중복 실행에서 복구 근거가 사라짐

좋은 구조: API → COMMIT 업무 변경 + jobs/outbox row + NOTIFY 힌트
          worker → notification 또는 주기 scan → 원자적 claim → 실제 작업 → 결과 기록
```

### 3) 시작 순서가 중요하다: LISTEN commit → 초기 scan → 이후 notification

처음 listener를 붙일 때는 미세한 race가 있습니다. `LISTEN`이 아직 commit되지 않은 동안 다른 트랜잭션이 job을 commit하면 그 신호를 보지 못할 수 있습니다. PostgreSQL 문서의 권장 순서를 그대로 적용합니다.

1. 전용 연결에서 `LISTEN billing_work_available`을 실행하고 **commit**한다.
2. 새 짧은 트랜잭션에서 `ready` backlog를 모두 또는 제한 batch로 scan·claim한다.
3. 그 다음부터 notification을 받아 debounce된 scan을 실행한다.

초기 scan은 중복처럼 보여도 안전합니다. 이미 본 작업을 다시 보더라도 atomic claim이 한 worker만 소유하게 하기 때문입니다. 반대로 notification만 기다리면 배포 직전·재접속 직전의 작업이 영원히 `ready`에 남을 수 있습니다.

worker의 claim은 [PostgreSQL SKIP LOCKED 작업 큐](/learning/deep-dive/deep-dive-postgresql-skip-locked-job-queue-lease-playbook/)처럼 짧은 트랜잭션으로 끝냅니다.

```sql
WITH picked AS (
  SELECT id
  FROM jobs
  WHERE status = 'ready'
    AND run_at <= now()
  ORDER BY run_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 10
)
UPDATE jobs j
SET status = 'running',
    locked_by = :worker_id,
    locked_until = now() + interval '2 minutes',
    attempts = attempts + 1
FROM picked
WHERE j.id = picked.id
RETURNING j.id, j.job_type, j.payload;
```

실제 이메일 발송·HTTP 호출·파일 변환은 commit 후에 실행합니다. 5분짜리 외부 API 호출을 listener 연결의 트랜잭션에 넣으면 신호 수신이 지연되고 DB connection과 lock까지 오래 점유합니다.

### 4) LISTEN은 세션 상태다: 일반 요청 풀과 섞지 않는다

`LISTEN` 등록은 애플리케이션 객체가 아니라 PostgreSQL **server session**에 붙습니다. 그래서 HTTP 요청처럼 연결을 빌렸다 반납하는 일반 커넥션 풀에 listener를 넣으면 안 됩니다. 특히 PgBouncer의 transaction pooling은 각 트랜잭션마다 다른 backend session을 쓸 수 있어, 한 요청에서 만든 LISTEN 상태를 다음 요청이 이어받는다고 보장하지 않습니다.

운영 선택지는 명확합니다.

| 선택 | 적합한 경우 | 주의점 |
| --- | --- | --- |
| worker 전용 direct connection | worker 수가 작고 운영 단순성이 우선 | reconnect, TLS, DB failover를 앱에서 처리 |
| PgBouncer session pooling | pooler 표준화를 유지해야 함 | listener 수만큼 장기 backend connection을 예산에 반영 |
| 일반 transaction pooling | HTTP API·짧은 SQL | LISTEN 용도로는 부적합 |

listener 수는 작게 시작합니다. 예를 들어 worker Pod가 20개라면 listener도 보통 Pod당 1개면 충분합니다. notify를 받을 때마다 즉시 SQL을 20번 날리기보다 100~300ms debounce 후 batch 10개를 claim합니다. DB의 현재 사용량, worker 처리 시간, 일반 API pool 여유를 함께 보고 전용 listener connection을 산정해야 하며, 이 판단은 [커넥션 풀 크기와 포화](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/)의 saturation 기준을 따릅니다.

### 5) 알림 큐도 관측 대상이다

PostgreSQL에는 아직 모든 listener가 처리하지 않은 notification을 위한 공유 queue가 있습니다. 장시간 트랜잭션에 갇힌 listener 하나가 cleanup을 막을 수 있고, queue가 가득 차면 `NOTIFY`를 호출한 트랜잭션은 commit에서 실패합니다. 즉 notification을 ‘부가 기능’으로 다루더라도, 쓰기 경로의 실패 원인이 될 수 있습니다.

최소 지표는 다음 네 가지입니다.

```sql
-- 0.0~1.0 사이의 notification queue 사용률
SELECT pg_notification_queue_usage();

-- LISTEN 세션이 긴 transaction을 열고 있는지 확인
SELECT pid, usename, state, xact_start, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '30 seconds';
```

처음 운영할 때의 보수적 기준은 다음처럼 둘 수 있습니다.

- `pg_notification_queue_usage() >= 0.10`가 10분 지속되면 경고, `>= 0.30`이면 listener 긴 트랜잭션과 누적 원인을 즉시 조사
- listener reconnect 이후 initial scan 완료까지 p95 **60초 이하**
- notification 없이도 oldest ready job age가 **60초 이하**가 되도록 fallback scan을 **15~60초** 간격으로 설정
- listener transaction은 p99 **5초 이하**, claim transaction은 p99 **100ms 이하**를 출발점으로 설정
- notification wake-up 뒤 claim 결과가 빈 경우는 오류가 아니라 정상(다른 worker가 먼저 claim했거나 신호가 합쳐졌을 수 있음)

절대 수치는 서비스의 SLO와 작업 비용에 맞춰 조정해야 합니다. 중요한 것은 notification 수신률이 아니라 `oldest_ready_job_age`, `reconnect_recovery_seconds`, `queue_usage`, `claim_success_rate`를 같이 보는 것입니다.

## 실무 적용

### 1) worker loop를 ‘알림 + 복구 scan’으로 만든다

다음 의사코드는 어떤 언어에서도 유지할 수 있는 핵심 계약입니다.

```text
connect_listener_with_backoff()
LISTEN billing_work_available; COMMIT
drain_ready_jobs(reason = "startup")

loop:
  wait up to 30 seconds for notification
  if notification arrived:
    debounce 200 milliseconds
    drain_ready_jobs(reason = "notify")
  else:
    drain_ready_jobs(reason = "fallback_scan")

  if connection closed or protocol error:
    record reconnect metric
    reconnect_listener_with_backoff()
    LISTEN; COMMIT
    drain_ready_jobs(reason = "reconnect")
```

여기서 `drain_ready_jobs`는 queue가 완전히 비거나, 한 loop에 허용한 DB/worker budget에 도달할 때까지만 반복합니다. job이 10만 건 쌓였다고 listener 한 개가 무한 loop를 돌면 일반 DB 요청까지 밀어낼 수 있습니다. 예를 들어 한 worker는 한 번에 10개 claim, 30초 동안 최대 200개만 claim하고 다시 부하를 확인하는 식의 상한을 둡니다.

### 2) channel과 payload도 작은 API 계약으로 관리한다

channel 이름은 우연한 문자열이 아니라 producer와 consumer가 공유하는 계약입니다. `all_events` 하나에 모든 도메인을 몰아넣거나 `customer_12345`처럼 테넌트마다 channel을 만들면 권한·운영·cardinality를 관리하기 어렵습니다.

권장 시작점은 아래 정도입니다.

| 항목 | 출발 기준 |
| --- | --- |
| channel | `billing_work_available`, `search_index_available`처럼 bounded domain 단위 |
| payload | `ready`, `orders`, 작은 numeric watermark 등 128 bytes 이하의 힌트 |
| 금지 데이터 | access token, 이메일, 전화번호, 원문 request/response, 대형 JSON |
| 소유자 | channel별 producer·consumer·fallback scan owner 명시 |
| 변경 | payload 뜻을 바꿀 때 schema version 또는 새 channel로 병행 전환 |

payload가 작아야 한다는 이유는 8KB 제한만이 아닙니다. `NOTIFY`는 같은 DB의 listener에게 보이고 로그나 드라이버 진단에도 남을 수 있습니다. 민감 정보와 업무 원문은 jobs/outbox row에 접근 제어를 둔 채 보관하고, notification은 그 row를 찾을 수 있는 최소한의 변화 신호로 제한합니다.

### 3) 장애 drill은 신호가 아닌 원장을 검증한다

테스트에서 notification을 받았다는 사실만 확인하면 약합니다. 아래 순서로 작업이 결국 처리되는지를 봅니다.

1. listener를 종료한 상태에서 job을 100개 commit한다.
2. listener를 재시작하고 `LISTEN commit → initial scan`으로 100개가 claim되는지 확인한다.
3. claim 후 worker를 강제 종료해 lease 만료와 재처리가 일어나는지 확인한다.
4. listener 연결을 끊었다 붙이고, reconnect scan이 중복 없이 backlog를 회복하는지 확인한다.
5. 긴 read transaction을 의도적으로 만들어 queue usage·alert·runbook이 작동하는지 확인한 뒤 종료한다.

성공 기준은 ‘100개의 알림을 받음’이 아니라 **100개 작업의 최종 상태와 외부 효과가 정의한 멱등성 계약에 맞음**입니다. 외부 이메일·결제·webhook이라면 `job id`와 별도의 idempotency key 또는 결과 ledger도 필요합니다.

## 트레이드오프/주의점

1. **broker를 없애는 것이 아니라 요구사항을 줄이는 선택입니다.** PostgreSQL 기반 wake-up은 작은 범위에서 운영 부품을 줄여 주지만, partition ordering·consumer group·장기 replay가 필요하면 전문 broker가 더 단순해집니다.
2. **broadcast는 의도된 동작입니다.** 50개 worker가 모두 깨어나는 비용이 문제라면 debounce·작은 claim batch로 완화할 수는 있지만, notification을 work sharding으로 바꾸면 안 됩니다.
3. **NOTIFY는 2PC와 함께 쓸 수 없습니다.** `NOTIFY` 또는 `LISTEN`을 실행한 트랜잭션은 prepared transaction이 될 수 없으므로, 이미 2PC를 요구하는 경로라면 다른 설계를 택해야 합니다.
4. **payload에 job id가 있어도 scan은 남겨야 합니다.** job id 직행 조회는 빠른 경로일 수 있으나, 정확성 경로는 언제나 ready backlog scan이어야 합니다.
5. **장기 transaction은 실시간성을 무너뜨립니다.** listener가 수 분짜리 분석 query를 겸하면 notification 처리와 queue cleanup이 모두 늦어집니다. 연결 역할을 분리합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 업무 변경, jobs/outbox insert, `pg_notify()`가 같은 commit에 묶여 있다.
- [ ] worker는 `LISTEN` commit 뒤에 initial scan을 수행하고 15~60초 fallback scan을 유지한다.
- [ ] notification 수를 작업 수나 소비 성공 수로 사용하지 않는다.
- [ ] `LISTEN` 연결은 일반 HTTP request pool과 분리되어 있고 transaction pooling에 의존하지 않는다.
- [ ] claim은 원자적이며 실제 외부 작업은 DB transaction 밖에서 실행한다.
- [ ] `pg_notification_queue_usage`, longest transaction, listener reconnect, oldest ready job age를 관측한다.
- [ ] channel/payload에 민감정보가 없고 owner·스키마·변경 절차가 문서화되어 있다.

### 연습 과제

현재 서비스의 비동기 후속 작업 하나를 골라 보세요. 먼저 `jobs` 또는 `outbox`에 어떤 필드가 남아야 재처리가 가능한지 적고, 그 뒤 `NOTIFY` payload를 128 bytes 이내의 힌트로 축소해 보세요. listener를 1분 중단한 뒤 재시작했을 때도 oldest ready job age가 목표 SLO 안으로 회복되는지 측정하면, 신호와 원장의 경계가 실제로 지켜지는지 확인할 수 있습니다.
