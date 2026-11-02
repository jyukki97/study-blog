---
title: "백엔드 커리큘럼 심화: 장시간 작업의 취소·부분효과·결과 정합성을 설계하는 법"
date: 2026-11-02
draft: false
topic: "Backend Asynchronous Operations"
tags: ["Asynchronous Processing", "Cancellation", "Distributed Systems", "Idempotency", "Operations", "Backend"]
categories: ["Backend Deep Dive"]
description: "내보내기·정산·대량 변경처럼 오래 걸리는 작업에서 취소 요청, 이미 발생한 외부 효과, 최종 결과를 분리해 안전하게 설계하는 기준을 정리합니다."
module: "distributed-system"
study_order: 1265
---

CSV 내보내기, 수천 건의 가격 변경, 외부 결제사 동기화처럼 수 초에서 수십 분이 걸리는 작업은 HTTP 요청 하나의 성공·실패로 표현하기 어렵습니다. 사용자가 취소를 눌렀을 때 worker는 이미 세 번째 페이지를 처리했을 수 있고, 외부 API는 요청을 받은 뒤일 수 있습니다. 이때 `cancelled`라는 한 상태만 저장하면 “아무 일도 일어나지 않았다”는 잘못된 인상을 줍니다. 반대로 끝날 때까지 취소를 허용하지 않으면 실수로 실행한 대량 작업을 멈출 방법이 없습니다.

핵심은 취소를 rollback의 동의어로 취급하지 않는 것입니다. 취소는 **더 이상의 새 효과를 만들지 않겠다는 의도**이고, 결과 정합성은 **이미 만든 효과를 어떤 근거로 확인·보정할지**의 문제입니다. [비동기 작업을 operation resource로 표현하는 방법](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/), [end-to-end deadline과 cancellation 전파](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/), [재시작 가능한 worker의 결과 ledger](/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/), [transactional outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)를 연결해, 취소 가능한 장시간 작업의 계약을 설계해 보겠습니다.

## 이 글에서 얻는 것

- `cancel_requested`, `stopped`, `completed_after_cancel`, `uncertain`을 구별해 API와 운영 화면에 표현하는 방법을 배웁니다.
- 단일 SQL 갱신, 배치 worker, 외부 API 호출 각각에서 취소 확인 지점을 어디에 둘지 정할 수 있습니다.
- 부분 성공을 숨기지 않고 대상별 결과 ledger와 reconciliation으로 수거하는 기준을 얻습니다.
- 처리량, 취소 지연, 불확실 결과 비율을 이용해 언제 즉시 중단하고 언제 보정 작업으로 넘어갈지 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 취소 요청과 실제 중단은 서로 다른 사건이다

사용자가 `POST /operations/{id}/cancel`을 호출한 순간 서버가 확실히 아는 사실은 하나입니다. 해당 사용자가 취소 의사를 냈다는 사실입니다. worker가 메시지를 이미 가져갔는지, DB transaction이 commit됐는지, 외부 provider가 callback을 보냈는지는 아직 모를 수 있습니다. 따라서 취소 API가 즉시 `cancelled`를 반환하면 거짓말이 되기 쉽습니다.

작업 상태는 최소한 다음처럼 나누는 편이 안전합니다.

| 상태 | 의미 | 새 side effect 허용 | 사용자에게 보여 줄 행동 |
| --- | --- | --- | --- |
| `pending` | 아직 worker가 시작하지 않음 | 아니오 | 즉시 취소 가능 |
| `running` | 단계 실행 중 | 현재 단계 규칙에 따름 | 진행률·취소 가능 여부 표시 |
| `cancel_requested` | 취소 의도는 저장됐지만 확인 전 | 새로운 단위는 금지 | “중단 중, 결과 확인 중” 표시 |
| `cancelled` | 안전한 경계에서 중단됨 | 아니오 | 처리된 범위와 미처리 범위 표시 |
| `completed_after_cancel` | 취소 전 이미 되돌릴 수 없는 단계 완료 | 아니오 | 완료 사실과 후속 조치 표시 |
| `reconciliation_required` | 외부 효과 또는 결과가 불확실함 | 보정 작업만 허용 | 자동/수동 확인으로 연결 |

이 상태는 UI를 복잡하게 하려는 장치가 아닙니다. 운영자가 같은 작업을 재실행할지, 고객에게 결과를 안내할지, 외부 시스템을 조회할지를 정하는 근거입니다. 특히 `cancel_requested`가 5분 이상 유지되면 단순한 “느린 취소”가 아니라 worker heartbeat, queue lease, downstream timeout을 확인할 신호입니다.

### 2) 취소는 작업의 안전한 경계에서만 확인한다

모든 명령 사이에 취소 flag를 읽으면 빨라 보이지만, transaction 중간이나 단일 대상의 검증·write 사이에 멈추면 더 나쁜 상태를 만들 수 있습니다. 반대로 10만 행을 하나의 transaction으로 처리하면 취소가 너무 늦고 lock이 길어집니다. 해법은 업무 단위를 **관찰 가능한 commit 경계**로 쪼개는 것입니다.

예를 들어 5만 명에게 권한을 부여하는 작업은 1명 단위로 결과를 남기고 100명 또는 1초마다 commit할 수 있습니다. 다음 batch를 시작하기 직전에 `cancel_requested_at`을 확인하면, 이미 commit된 2,300명은 ledger로 설명하고 나머지는 건드리지 않을 수 있습니다. 파일 export라면 chunk 하나를 object storage에 올리기 전과 manifest를 공개하기 전에 확인합니다. 외부 메일 발송은 provider 호출 직전, callback 반영 직전에 확인하되, 호출 뒤 timeout은 실패가 아니라 `uncertain`으로 남깁니다.

좋은 취소 지점은 세 조건을 만족합니다.

1. 직전까지의 효과를 대상 ID와 결과 코드로 설명할 수 있다.
2. 다음 효과를 만들기 전에 취소 의도를 원자적으로 읽을 수 있다.
3. 중단 뒤 재시작해도 이미 완료한 단위를 중복 실행하지 않는다.

`Thread.interrupt()`나 process kill 같은 기술적 중단은 마지막 수단입니다. DB migration, 파일 flush, external request 중에 프로세스를 강제로 죽이면 정확히 어느 단계까지 갔는지 알기 어려워집니다. 먼저 작업 계약에 취소 경계를 넣고, grace period를 넘긴 stuck worker만 격리·재시작하는 순서를 지키는 편이 낫습니다.

### 3) 부분 성공은 오류가 아니라 기록해야 할 결과다

대량 작업에서 “100개 중 93개 성공”은 실패도 완전 성공도 아닙니다. 이를 job 하나의 `failed` 상태로 압축하면 재시도 시 93개를 다시 처리하거나, 어떤 7개가 왜 실패했는지 찾지 못합니다. 반대로 모든 대상의 원문 payload를 남기면 개인정보와 저장 비용이 불어난다. 결과 ledger에는 재실행과 지원 판단에 필요한 최소 사실만 기록해야 합니다.

```text
operation_id: op_01...
item_key: user:1842
attempt: 1
state: applied | skipped | failed | uncertain
effect_key: grant-role:editor:v3:user:1842
reason_code: ALREADY_AT_TARGET
observed_at: 2026-11-02T01:06:12Z
```

`effect_key`는 같은 대상·같은 의도의 효과를 식별합니다. 재시도 worker는 이 key가 `applied`인지 먼저 보고 건너뛰거나, 외부 provider의 idempotency key로 전달합니다. `failed`는 입력 검증처럼 확정적인 실패와 일시적인 dependency 실패를 구별해야 합니다. `uncertain`은 요청을 전송한 뒤 응답을 받지 못했거나 callback 순서가 뒤집힌 경우입니다. 이 상태에 자동 재시도를 바로 붙이면 중복 청구·중복 메일처럼 돌이키기 어려운 결과가 생길 수 있습니다.

### 4) 취소 가능성은 작업 유형마다 약속의 수준이 다르다

읽기 전용 report 생성은 결과 파일을 publish하기 전까지 비교적 강하게 취소할 수 있습니다. 내부 DB에서 동일 transaction 안에 끝나는 bulk update는 rollback이 가능하지만 lock 시간과 undo 비용을 함께 봐야 합니다. 외부 결제, 이메일, 파트너 API처럼 commit 경계가 다른 시스템에 걸친 작업은 “즉시 취소”가 아니라 **추가 전송 중단과 사후 수거**를 약속하는 것이 정직합니다.

그래서 API 문서에도 operation type별 취소 보장을 적습니다.

| 작업 유형 | 권장 취소 보장 | 취소 뒤 확인할 것 |
| --- | --- | --- |
| report/export | publish 전 결과물 폐기 | 임시 object와 download token |
| 내부 bulk update | batch 경계 중단, commit 단위 유지 | 적용 item 수·lock·재시도 범위 |
| 외부 notification | 새 send 중단, in-flight는 수거 | provider message ID·bounce/callback |
| payment/fulfillment | 새 command 중단, 이미 보낸 command 조회 | merchant reference·상태 API·보상 흐름 |

사용자에게 “취소됨”만 보이는 것보다 “2,300건 적용, 47,700건 미처리, 외부 3건 확인 중”을 보여 주는 편이 불편하지만 안전합니다. 민감한 대상 수를 노출할 수 없다면 권한에 따라 범위만 보여 주고, 상세 ledger는 운영 도구에서 제한적으로 조회하게 만드세요.

## 실무 적용

### 1) operation, item ledger, cancellation token을 함께 둔다

가장 작은 도입은 기존 비동기 job 테이블에 `cancel_requested_at`, `cancel_requested_by`, `cancellation_reason`, `result_summary_version`을 추가하고, 대상별 결과를 별도 append-only ledger에 기록하는 것입니다. worker가 batch를 가져갈 때는 operation의 `version` 또는 lease를 함께 읽습니다. 취소 요청은 version을 올리고 timestamp를 기록하며, worker는 다음 안전 경계에서 version 변화를 확인합니다.

```sql
-- 다음 100개를 시작하기 전에 읽는 최소 상태
select status, cancel_requested_at, version
from operations
where id = :operation_id;
```

중요한 것은 cancel API가 worker thread를 직접 제어하지 않는다는 점입니다. HTTP 서버와 worker가 다른 process·region에 있을 수 있으므로, 취소 의도는 durable state로 저장하고 queue message는 단지 깨우는 신호로 사용합니다. 작업이 30초 이상 걸리면 5~10초마다 heartbeat와 현재 checkpoint를 갱신하세요. heartbeat가 lease의 절반 이상 갱신되지 않으면 다른 worker가 즉시 중복 실행하지 말고, 기존 worker의 실제 생존과 effect ledger를 먼저 확인해야 합니다.

### 2) 결과 공개와 외부 효과를 분리한다

파일 export라면 bytes를 만드는 단계와 사용자에게 다운로드를 열어 주는 단계를 분리합니다. 취소가 들어오면 multipart upload를 abort하고 임시 object는 TTL로 정리할 수 있지만, 이미 publish한 object는 접근을 차단하거나 supersede marker를 남겨야 합니다. 내부 대량 변경도 “모든 item 처리”와 “완료 알림 발송”을 분리하면, 취소 뒤 완료 메일을 보내는 모순을 줄일 수 있습니다.

외부 effect가 있는 작업에는 보통 세 단계가 필요합니다.

1. intent와 effect key를 transaction 안에서 기록한다.
2. 전달 worker가 effect key를 포함해 외부 요청을 보낸다.
3. 응답·callback·상태 조회로 ledger를 `applied`, `rejected`, `uncertain` 중 하나로 수렴시킨다.

이 흐름은 [멱등 inbox와 consumer 재처리](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)와 같은 이유로 중요합니다. “취소 후에는 아무것도 보내지 말자”는 조건만으로는 이미 provider에 도착한 command를 되돌릴 수 없습니다. 각 외부 명령이 어떤 operation과 item에서 왔는지 연결해야 취소·재시도·보상 범위를 좁힐 수 있습니다.

### 3) 숫자로 중단 기준과 운영 우선순위를 정한다

초기 기준은 작업의 위험도에 맞춰 작게 시작하세요. 예를 들어 대량 권한 변경은 cancel request의 p95 반영 시간이 **30초 이하**, item ledger 누락률 **0%**, `uncertain` 비율 **0.1% 이하**를 목표로 둘 수 있습니다. 외부 provider 의존 작업은 cancellation request가 **2분** 안에 종료 상태 또는 reconciliation queue로 이동하지 않으면 on-call 알림을 발생시킵니다. 이 수치는 보편적 정답이 아니라, “작업이 멈췄는지 모르는 상태”를 허용하지 않기 위한 운영 계약입니다.

| 지표 | 출발 기준 | 초과했을 때 우선 행동 |
| --- | ---: | --- |
| 취소 요청→최종 상태 p95 | 30초 | batch 크기·checkpoint·queue 지연 확인 |
| 취소 뒤 새 effect 생성 수 | 0 | version 확인 경계와 in-flight race 조사 |
| item 결과 ledger 누락률 | 0% | 배포 중단, write 순서와 transaction 점검 |
| `uncertain` item 비율 | 0.1% 이하 | provider 상태 조회·idempotency key 확인 |
| 24시간 내 reconciliation 미종료 | 0건 | owner escalation, 재처리보다 수동 확인 우선 |

우선순위는 대개 데이터·금전 효과가 큰 작업부터입니다. 취소 버튼을 먼저 전 화면에 넣기보다, 외부 write가 있고 월 1회 이상 수동 복구가 발생하거나, 한 번의 실행 대상이 1,000건 이상인 작업 1~2개에 ledger와 checkpoint를 먼저 적용하세요.

## 트레이드오프/주의점

세밀한 item ledger는 디버깅과 재시도를 쉽게 하지만 저장량과 조회 비용을 늘립니다. 그래서 원본 payload를 그대로 저장하지 말고 item key의 최소 식별자, outcome, attempt, 외부 reference, policy version만 보존하고, 보존 기간을 정합니다. 예를 들어 일반 export의 item ledger는 7일, 금전·권한 변경의 증거는 감사 정책에 맞는 별도 기간으로 나눌 수 있습니다. 기간이 지났다고 operation summary까지 지우면 나중에 지원이 같은 작업을 설명할 근거를 잃을 수 있습니다.

취소 확인을 너무 자주 하면 hot path의 DB read가 늘고 처리량이 떨어질 수 있습니다. 반대로 batch가 너무 크면 사용자 경험이 나빠지고, 한 번에 잡는 lock 범위도 커집니다. 시간 기준(예: 1초)과 개수 기준(예: 100개) 중 먼저 도달한 곳에서 확인하는 방식이 출발점으로 좋습니다. 실제 값은 item 처리 시간, DB write 비용, 최대 허용 취소 지연으로 조정하세요.

마지막으로 `completed_after_cancel`을 버그로 취급해 숨기지 마세요. 취소 클릭보다 commit이 먼저였다는 사실 자체는 정상적인 race일 수 있습니다. 버그는 그 결과를 거짓으로 `cancelled`라 표시하거나, 같은 effect를 다시 실행하거나, 확인 근거 없이 자동 보상을 하는 데서 생깁니다. 계약이 명확하면 운영자는 작업을 재시작하기 전에 어떤 대상이 실제로 바뀌었는지 확인할 수 있습니다.

## 체크리스트 또는 연습

- [ ] 취소 API는 의도 기록과 실제 중단을 분리하며, 즉시 `cancelled`라고 단정하지 않는다.
- [ ] 각 작업 유형에 안전한 checkpoint와 최대 허용 취소 지연이 있다.
- [ ] 대상별 ledger는 `applied`, `skipped`, `failed`, `uncertain`을 구분하고 effect key를 가진다.
- [ ] 외부 호출 timeout 뒤에는 무조건 재전송하지 않고 상태 조회 또는 reconciliation으로 수렴한다.
- [ ] 완료 알림·download publish는 실제 effect 처리와 별도 단계로 제어한다.
- [ ] 취소 뒤 새 side effect 수, ledger 누락률, uncertain 비율, reconciliation 지연을 측정한다.
- [ ] 강제 worker 종료는 grace period와 evidence 확인 뒤의 최후 수단이다.

연습으로 현재의 CSV export, 대량 권한 변경, 파트너 동기화 중 하나를 고르세요. 대상 1개를 처리하는 정확한 commit 경계와 취소 확인 지점, timeout 뒤에 남는 상태를 세 줄로 적어 봅니다. 이어서 “취소를 누른 뒤 이미 처리된 대상은 무엇으로 증명하는가?”에 답할 수 없다면, UI의 취소 버튼보다 operation·ledger·reconciliation 설계가 먼저입니다.

## 관련 글

- [비동기 작업을 Operation Resource로 설계하기](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)
- [End-to-End Deadline과 Cancellation 전파](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)
- [재시작 가능한 Worker의 Job Result Ledger](/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/)
- [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [멱등 Inbox와 Consumer 재처리](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)
