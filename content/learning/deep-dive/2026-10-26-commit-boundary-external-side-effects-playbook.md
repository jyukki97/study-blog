---
title: "백엔드 커리큘럼 심화: Commit Boundary와 External Side Effect, DB 저장과 외부 효과를 같은 성공으로 보지 않는 법"
date: 2026-10-26
draft: false
topic: "Backend Reliability"
tags: ["Transaction", "Outbox", "Idempotency", "Retry", "Distributed Systems", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "DB 트랜잭션 안에서 이메일·결제·웹훅·외부 HTTP 호출을 섞을 때 생기는 유령 성공과 중복 효과를 줄이기 위해, commit 경계·outbox·재시도·보상·관측 기준을 정리합니다."
module: "backend-reliability"
study_order: 1565
key_takeaways:
  - "DB commit 성공과 외부 시스템의 효과 발생은 다른 사실이다. 한 응답 코드로 둘을 증명하려 하면 유령 성공과 중복 실행이 생긴다."
  - "트랜잭션 안의 외부 호출은 원자성을 늘리지 않는다. lock 보유 시간과 timeout 결합을 늘리고, rollback 뒤에도 되돌릴 수 없는 효과를 남긴다."
  - "기본 해법은 업무 상태와 side-effect intent를 한 트랜잭션으로 기록하고, commit 뒤 별도 worker가 멱등 키와 관측 가능한 상태 전이로 효과를 실행하는 것이다."
operator_checklist:
  - "각 외부 효과에 intent ID, 업무 버전, idempotency key, 만료 시각, 소유자, 재시도·보상 규칙을 기록한다."
  - "사용자 동기 응답에는 확정된 사실과 비동기 진행 사실을 분리해 표시하며, 외부 효과의 완료를 추측해 성공이라고 말하지 않는다."
  - "commit latency, outbox oldest age, intent별 retry count, provider accept/confirm, duplicate suppression을 함께 관측한다."
learning_refs:
  - title: "Transactional Outbox와 CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "업무 변경과 이벤트 발행 의도를 함께 남기는 기본 패턴입니다."
  - title: "API Error Semantics와 Retryability"
    href: "/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/"
    description: "호출자에게 재시도 가능 여부를 모호하지 않게 전달하는 계약을 다룹니다."
  - title: "Webhook Delivery Reliability"
    href: "/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/"
    description: "외부 delivery가 timeout됐을 때 중복과 미전송을 구분하는 방법을 다룹니다."
---

주문을 저장한 뒤 결제사 승인 API를 호출하고, 이메일을 보내고, 파트너 웹훅까지 전송하는 코드는 한 메서드에 자연스럽게 모이기 쉽습니다. `@Transactional`을 붙이면 모든 일이 함께 성공하거나 실패할 것처럼 보이기도 합니다. 그러나 DB commit과 외부 HTTP 호출은 같은 원자적 저장소에 속하지 않습니다. 결제사가 승인한 직후 DB commit이 실패할 수 있고, 이메일 provider가 timeout을 반환했지만 실제 메일은 이미 수락했을 수 있습니다. 이 상태에서 요청을 통째로 재시도하면 돈·알림·웹훅이 중복될 수 있습니다.

핵심은 트랜잭션을 피하는 것이 아닙니다. **트랜잭션이 보장하는 사실과, 외부 효과가 만들어 내는 사실을 분리해 모델링하는 것**입니다. 이 글은 [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [API Error Semantics와 Retryability](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/), [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/), [End-to-End Deadline과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)을 연결합니다. 목표는 “재시도를 많이 한다”가 아니라, 어떤 성공이 확정됐고 무엇이 아직 진행 중인지 사용자와 운영자가 추적할 수 있게 하는 것입니다.

## 이 글에서 얻는 것

- DB commit, 외부 provider 수락, 사용자에게 보이는 완료가 서로 다른 상태임을 구분합니다.
- DB 트랜잭션 안에서 HTTP·메일·메시지 발행을 바로 실행할 때의 실패 순서를 설명할 수 있습니다.
- intent 레코드, outbox, 멱등 키, 비동기 worker를 사용해 외부 효과를 재시도 가능한 상태 기계로 바꿀 수 있습니다.
- 동기 응답, SLA, timeout, retry, 보상 작업을 어떤 업무에 어떤 순서로 적용할지 숫자와 조건으로 정할 수 있습니다.

## 핵심 개념/이슈

### 1) 하나의 “성공”은 보통 세 개의 서로 다른 사실이다

사용자가 구독을 시작하면 애플리케이션은 (1) 구독 상태를 DB에 저장하고, (2) 결제 provider에 청구를 요청하며, (3) 영수증 이메일을 발송할 수 있습니다. 세 단계의 성공 기준은 다릅니다.

| 사실 | 누가 확정하는가 | 실패했을 때 남는 질문 |
| --- | --- | --- |
| 업무 상태가 저장됨 | 우리 DB commit | 구독 상태·버전·금액이 일관되게 기록됐는가? |
| 외부 효과가 수락됨 | 결제·메일·파트너 provider | 요청이 전달됐는가, timeout 뒤에도 실행됐는가? |
| 사용자가 완료를 확인함 | API 응답·화면·알림 | 지금 확정된 사실과 진행 중인 일을 구분해 보여 줬는가? |

`200 OK` 하나가 세 사실을 모두 뜻하게 만들면 모순이 생깁니다. 결제가 아직 `pending`인데 “결제 완료”를 보여 주거나, 메일 전송 실패 때문에 이미 저장된 구독까지 rollback하려고 하면 운영이 복잡해집니다. 반대로 사용자가 기다려야 하는 결제 승인은 동기 결과가 필요할 수 있습니다. 이때도 DB 저장과 provider 승인을 하나의 DB 트랜잭션으로 묶는 대신, **업무 상태를 `pending → approved/declined`로 명시**하고 provider 결과를 별도 사실로 기록하는 편이 안전합니다.

### 2) 트랜잭션 안의 외부 호출은 원자성을 늘리지 않는다

다음 순서를 생각해 보겠습니다.

```text
BEGIN
  주문 row INSERT
  결제사 POST /authorize     -- provider는 승인 완료
  COMMIT                     -- deadlock 또는 네트워크 오류로 실패
```

DB rollback은 결제사에 이미 도착한 승인을 취소하지 못합니다. 반대 순서도 안전하지 않습니다.

```text
BEGIN
  주문 row INSERT
  COMMIT                     -- 주문은 확정
POST /receipt-email          -- timeout; 수락 여부를 모름
```

두 번째 경우 주문은 정상인데 메일 상태가 불명확합니다. 이를 “실패”로 묶어 주문을 취소하면 사용자는 결제·주문·메일이 서로 다른 상태를 보게 됩니다. DB lock을 든 채 HTTP 응답을 기다리는 것도 위험합니다. provider p99가 2초이고 DB transaction timeout이 5초라면, 느린 호출 몇 개가 connection·row lock을 잡아 두면서 정상 쓰기까지 밀어낼 수 있습니다.

따라서 transaction 안에서는 **우리 DB가 반드시 알아야 할 의도**만 기록합니다. 외부 호출은 commit 뒤에 실행하되, 호출 전에 “무엇을 누구에게 어떤 키로 실행할지”가 durable하게 남아 있어야 합니다. 이 경계가 [Transactional Outbox](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)의 출발점입니다.

### 3) intent는 로그 한 줄이 아니라 재실행 가능한 업무 상태다

외부 호출을 나중에 하기 위해 단순 로그를 남기는 것으로는 부족합니다. worker가 죽고, 배포가 바뀌고, provider가 429를 반환해도 다음 행동을 결정할 수 있어야 합니다. 아래처럼 intent를 업무 데이터로 둡니다.

```yaml
intent_id: notify_01J...
kind: receipt_email
aggregate: subscription:sub_842
aggregate_version: 7
idempotency_key: receipt:sub_842:v7
status: pending                 # pending | leased | accepted | confirmed | failed | expired
attempts: 0
not_before: 2026-10-26T10:10:00+09:00
expires_at: 2026-10-27T10:10:00+09:00
provider_request_ref: null
```

`aggregate_version`은 같은 구독 상태에서 같은 영수증을 여러 번 만들지 않게 하고, `idempotency_key`는 provider 또는 우리 delivery ledger가 중복 실행을 억제할 기준입니다. `expires_at`은 오래된 효과를 끝없이 재시도하지 않게 합니다. 예를 들어 24시간 뒤의 마케팅 메일은 보내지 않는 편이 나을 수 있지만, 결제 영수증은 만료 후에도 수동 처리 queue로 보내야 할 수 있습니다. 업무별로 다르게 정해야 합니다.

## 실무 적용

### 1) 외부 효과를 네 가지 lane으로 분류한다

모든 외부 호출에 같은 outbox와 retry를 적용하면 오히려 사용자 경험을 나쁘게 만들 수 있습니다. 먼저 손실 비용과 즉시성으로 lane을 나눕니다.

| lane | 예시 | 기본 응답 | 실행·복구 기준 |
| --- | --- | --- | --- |
| 동기 승인 | 결제 승인, 좌석 선점 | `pending` 또는 provider 결과를 즉시 반환 | 3~8초 budget 안에 결과가 없으면 상태 조회로 전환 |
| 확정 후 알림 | 영수증, 비밀번호 변경 안내 | 업무 성공을 먼저 반환 | outbox worker가 1분 내 첫 시도, 24시간 뒤 미완료는 운영 queue |
| 최종 일관성 통합 | 검색 색인, 분석 적재 | “반영 중”을 내부 상태로 둠 | 5~15분 lag budget, 재처리 가능해야 함 |
| 되돌릴 수 없는 외부 효과 | 은행 이체, 물류 출고 | 명시적인 업무 상태 전이 | 자동 retry 횟수보다 reconcile·보상 owner가 우선 |

이 표의 시간은 예시입니다. 중요한 것은 동기 path를 짧게 유지하고, timeout이 난 호출을 무조건 실패 또는 무조건 재시도로 단정하지 않는 것입니다. 특히 첫 lane은 provider가 결과를 조회할 수 있는 `merchant_reference`를 요구합니다. timeout 뒤에는 같은 authorize 요청을 새 키로 재발행하기보다, 먼저 원래 reference의 결과를 조회해야 합니다.

### 2) commit 뒤 worker가 실행하되, lease와 dedup을 함께 둔다

worker 여러 대가 같은 intent를 집어갈 수 있으므로 `pending → leased` 전이는 원자적으로 처리합니다. lease에는 owner와 만료를 둡니다. 예를 들어 30초 lease를 잡고 provider p99가 2초라면, worker crash 때 다른 worker가 회수할 여지가 있습니다. 반대로 2초 lease는 정상적으로 느린 호출도 중복 실행하게 만들 수 있습니다. lease 시간은 endpoint timeout의 2~3배와 queue 지연을 고려해 정합니다.

```text
business transaction
  -> aggregate 변경 + intent/outbox INSERT
  -> COMMIT
  -> worker가 lease 획득
  -> provider 호출(idempotency key 포함)
  -> 결과·provider reference·다음 시도 시각을 intent에 기록
```

provider가 idempotency를 지원하지 않아도 우리 쪽 delivery ledger로 최소한 중복 후보를 감지할 수 있습니다. 다만 “우리 DB에서 한 번만 보냈다”가 외부에서 한 번만 실행됐다는 증거는 아닙니다. 그러므로 금전·권한·출고처럼 중복 비용이 큰 효과에는 provider의 조회 API, 고유 reference, 역방향 reconciliation을 우선 요구해야 합니다. [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)은 이 마지막 확인에 필요합니다.

### 3) API 응답은 완료·접수·실패를 섞지 않는다

비동기 설계를 했다고 모든 요청에 `202 Accepted`만 반환할 필요는 없습니다. DB에 구독 상태가 확정됐으면 그 사실에는 `201` 또는 `200`을 줄 수 있습니다. 다만 메일이 아직 전송 중이면 `receipt_delivery: pending`처럼 별도 필드를 두거나, 사용자에게 “영수증 발송을 요청했습니다”라고 표현해야 합니다.

반대로 결제 승인처럼 사용자의 다음 행동이 provider 결과에 달렸다면, 제한된 동기 budget 안에서 결과를 기다리는 편이 맞습니다. 5초가 지나도 알 수 없으면 `payment_status: pending`과 상태 조회 URL을 반환합니다. 클라이언트는 새 결제를 만들지 않고 같은 `operation_id`를 조회합니다. [Async Request-Reply와 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)의 핵심은 기다림을 숨기는 것이 아니라, 기다리는 대상의 식별자와 상태를 계약으로 만드는 것입니다.

### 4) 관측은 성공률 하나가 아니라 상태 간 지연을 본다

아래 지표를 intent 종류별로 분리하면 “메일 provider가 느리다”보다 구체적인 판단을 할 수 있습니다.

- `commit_to_first_attempt`: commit 뒤 첫 provider 시도까지의 p95. 알림 lane이면 1분 안쪽에서 시작합니다.
- `intent_oldest_age`: pending/leased 상태 중 가장 오래된 항목. 절대 개수보다 업무별 TTL과 비교합니다.
- `attempts_per_intent`: 평균이 1.05에서 1.4로 오르면 timeout·duplicate·provider 오류를 조사합니다.
- `accepted_to_confirmed`: provider 수락 후 확정 통지까지의 지연. webhook 또는 polling 품질을 봅니다.
- `duplicate_suppressed`, `reconciliation_mismatch`: 정상 retry와 실제 중복 위험을 분리합니다.

초기 차단 기준도 정해 둡니다. 예를 들어 결제 intent의 15분 이상 age가 0.5%를 넘거나 reconciliation mismatch가 하나라도 발견되면 자동 retry 확대를 멈추고 on-call 조사로 전환합니다. 반면 마케팅 알림은 pending age가 2시간을 넘어도 digest 또는 만료 처리로 바꿀 수 있습니다. 큐의 총량만 보고 두 업무를 같은 severity로 처리하지 마세요.

## 트레이드오프/주의점

outbox는 복잡성을 없애지 않고 위치를 바꿉니다. 이제는 intent 테이블 정리, worker lease, 재처리 UI, provider reference 보존, DLQ와 reconcile 비용을 운영해야 합니다. 그러나 이 복잡성은 이미 존재하던 실패 상태를 드러내고 다룰 수 있게 만드는 비용입니다. “메서드 한 번에 처리”는 단순해 보여도 timeout과 부분 실패를 숨길 뿐입니다.

commit 뒤 실행은 사용자에게 즉시 결과가 보이지 않는다는 단점도 있습니다. 그래서 즉시성이 제품 요구인 효과와, 수 초~수 분 늦어도 되는 효과를 먼저 합의해야 합니다. 외부 호출을 모두 worker로 보내고 화면에는 성공이라고 쓰는 방식은 위험합니다. 사용자가 다음 결정을 하려면 필요한 상태는 동기적으로 확인하거나 `pending`으로 정직하게 표시해야 합니다.

마지막으로 보상은 rollback의 동의어가 아닙니다. 이메일은 “취소 메일”을 보내도 원본을 회수할 수 없고, 은행 이체의 보상은 별도 환불 거래입니다. 보상 action도 새 intent·승인·감사 로그가 필요한 업무로 모델링해야 합니다. 되돌릴 수 없는 효과일수록 자동 재시도 횟수보다 reference 조회와 사람 승인 경로를 먼저 설계하세요.

## 체크리스트 또는 연습

- [ ] DB commit, provider 수락, 사용자 표시 완료가 각각 어떤 상태·증거로 확인되는지 정의했다.
- [ ] DB transaction 안에서 기다리는 외부 HTTP 호출이 있다면 lock·timeout·rollback 뒤 효과를 검토했다.
- [ ] 업무 변경과 side-effect intent가 한 DB transaction에서 함께 기록된다.
- [ ] intent에 aggregate version, idempotency key, 상태, lease, TTL, provider reference, 재시도·보상 규칙이 있다.
- [ ] timeout 후 같은 명령을 새 요청으로 보내기 전에 원래 reference 결과를 조회한다.
- [ ] API 응답이 확정·접수·진행 중·실패를 구분하며, 클라이언트가 상태를 조회할 식별자를 받는다.
- [ ] commit-to-attempt, oldest age, retry 증폭, duplicate suppression, reconcile mismatch에 업무별 기준이 있다.

연습으로 현재 서비스의 “DB 저장 뒤 외부 API를 하나 호출하는” 메서드를 고르세요. 호출이 성공한 뒤 commit이 실패했을 때, commit 뒤 timeout이 났을 때, worker가 provider 응답을 받기 직전에 죽었을 때 각각 무엇이 남는지 표로 적습니다. 세 상황 중 하나라도 사용자·운영자·provider 관점에서 답할 수 없다면, 먼저 로그를 더 넣기보다 intent ID와 idempotency key, 상태 조회 경로를 추가하는 것이 좋습니다.

## 관련 글

- [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [API Error Semantics와 Retryability](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)
- [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)
- [Async Request-Reply와 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)
- [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
