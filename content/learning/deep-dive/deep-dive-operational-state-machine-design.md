---
title: "백엔드 커리큘럼 심화: 운영용 상태 머신 설계, status 컬럼을 사고 방지 장치로 바꾸기"
date: 2026-05-28
draft: false
topic: "Backend Architecture"
tags: ["State Machine", "Domain Modeling", "Idempotency", "Concurrency", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "주문, 결제, 업로드, 배치, 이벤트 소비처럼 상태가 있는 백엔드 흐름을 단순 status 컬럼이 아니라 전이표·불변식·감사 로그·재처리 기준으로 설계하는 방법을 정리합니다."
module: "backend-architecture"
study_order: 1435
---

백엔드에서 `status` 컬럼은 처음에는 단순합니다. `PENDING`, `DONE`, `FAILED` 정도만 있으면 화면도 만들 수 있고 배치도 돌릴 수 있습니다. 하지만 서비스가 커지면 이 컬럼은 곧 운영 사고의 출발점이 됩니다. 결제는 이미 승인됐는데 주문은 취소 상태가 되고, 파일은 스캔 전인데 공개 URL이 열리고, 재처리 배치가 예전 이벤트를 다시 반영해서 최신 상태를 되돌립니다.

문제는 상태가 있다는 사실이 아니라, **상태 전이 규칙이 코드와 데이터 어디에도 선명하게 존재하지 않는 것**입니다. 상태 컬럼만 있고 전이표, 전이 조건, 멱등 키, 감사 로그, 재처리 기준이 없으면 시스템은 "현재값 저장소"일 뿐입니다. 운영 가능한 상태 머신은 현재값보다 **어떤 조건에서 다음 상태로 갈 수 있는가**를 먼저 설계합니다.

이 글은 [멱등성 API 설계](/learning/deep-dive/deep-dive-idempotency/), [UPSERT·UNIQUE·멱등 키 쓰기 경로](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/), [비동기 요청-응답 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/), [Temporal 워크플로 오케스트레이션](/learning/deep-dive/deep-dive-temporal-workflow-orchestration/)과 이어지는 공통 기반입니다. 특정 도구보다 중요한 것은 상태 전이를 사고 방지 장치로 만드는 습관입니다.

## 이 글에서 얻는 것

- 단순 `status` 컬럼과 운영용 상태 머신의 차이를 설명할 수 있습니다.
- 상태 전이표, 불변식, 조건부 업데이트, 감사 로그를 어떤 순서로 설계할지 기준을 얻습니다.
- 주문·결제·업로드·배치·이벤트 소비처럼 상태가 있는 흐름에서 중복 처리와 역전 전이를 막는 방법을 정리할 수 있습니다.
- 상태 머신을 과설계하지 않기 위한 숫자 기준과 도입 우선순위를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) status 컬럼은 결과이고, 상태 머신은 규칙이다

`orders.status = 'PAID'`라는 값만 보면 현재 상태는 알 수 있습니다. 하지만 왜 그 상태가 됐는지, 어떤 상태에서 왔는지, 다음에 어디로 갈 수 있는지는 알 수 없습니다. 운영에서 필요한 질문은 보통 현재값보다 더 구체적입니다.

- `CANCELED` 주문이 결제 성공 webhook을 늦게 받으면 어떻게 할 것인가?
- `FAILED` 배치를 사람이 재시도하면 기존 산출물을 지울 것인가, 이어서 처리할 것인가?
- `SCANNING` 파일이 30분 넘게 머물면 실패로 볼 것인가, 다시 enqueue할 것인가?
- `DONE` 이벤트를 같은 consumer가 두 번 받으면 skip인지, 검증 후 no-op인지, 오류인지 어떻게 구분할 것인가?

이 질문에 답하려면 상태값 목록보다 전이 규칙이 먼저 필요합니다. 최소 전이표는 아래처럼 시작할 수 있습니다.

| 현재 상태 | 이벤트/명령 | 다음 상태 | 허용 조건 | 실패 시 처리 |
|---|---|---|---|---|
| `REQUESTED` | 결제 승인 시작 | `PAYMENT_PENDING` | 주문 금액 확정, 재고 hold 존재 | 요청 거부 |
| `PAYMENT_PENDING` | 결제 성공 | `PAID` | payment id 멱등 키 일치 | 중복이면 no-op |
| `PAYMENT_PENDING` | 결제 실패 | `PAYMENT_FAILED` | 실패 코드 저장 | 재시도 가능 |
| `PAID` | 사용자 취소 | `CANCEL_REQUESTED` | 배송 시작 전 | 보상 플로우 시작 |
| `CANCEL_REQUESTED` | 환불 성공 | `CANCELED` | refund id 저장 | 수동 확인 |

전이표를 쓰면 설계의 빈칸이 보입니다. 예를 들어 `PAID -> PAYMENT_FAILED`는 허용하면 안 되고, `PAYMENT_FAILED -> PAYMENT_PENDING`은 재시도 명령이 있을 때만 허용해야 합니다. 이 정도만 명확해도 "늦게 도착한 이벤트가 상태를 되돌리는 사고"를 상당히 줄일 수 있습니다.

### 2) 상태 전이는 조건부 업데이트로 닫아야 한다

애플리케이션에서 현재 상태를 읽고 `if`로 판단한 뒤 update하는 방식은 동시성에 약합니다. 두 요청이 동시에 들어오면 둘 다 같은 현재 상태를 보고 서로 다른 다음 상태를 쓸 수 있습니다. 상태 전이의 기본은 **현재 상태 조건을 update 문 안에 넣는 것**입니다.

```sql
UPDATE orders
SET status = 'PAID',
    paid_at = now(),
    payment_id = :payment_id,
    version = version + 1
WHERE order_id = :order_id
  AND status = 'PAYMENT_PENDING'
  AND payment_id IS NULL;
```

영향 받은 row 수가 1이면 전이 성공입니다. 0이면 이미 다른 경로가 처리했거나 허용되지 않는 상태입니다. 이때 0건을 무조건 실패로만 보지 말고, **멱등 중복인지, 순서 역전인지, 진짜 오류인지**를 분류해야 합니다.

권장 기준은 단순합니다.

- 같은 명령이 같은 멱등 키로 다시 온 경우: `200 OK` 또는 기존 결과 반환
- 더 오래된 이벤트가 최신 상태를 덮으려는 경우: skip + metric 증가
- 허용 전이표에 없는 명령인 경우: 409 또는 운영 알림
- 금전/권한/삭제 관련 상태에서 판단 불가인 경우: 자동 보정 금지, 수동 확인 큐로 이동

이 기준은 [Transactional Inbox와 멱등 Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)에서 다룬 이벤트 소비 경로에도 그대로 적용됩니다. 메시지는 중복될 수 있고, 오래된 이벤트가 나중에 올 수 있습니다. 상태 전이가 update 조건 안에 없으면 consumer 재처리에서 사고가 납니다.

### 3) 불변식은 상태보다 강하다

상태 목록을 잘 만들어도 불변식이 없으면 빈틈이 생깁니다. 불변식은 어떤 상태 조합에서도 깨지면 안 되는 규칙입니다.

예시:

- `PAID` 주문은 `payment_id`가 반드시 있어야 한다.
- `PUBLISHED` 파일은 `scan_result = CLEAN`이어야 한다.
- `CANCELED` 주문은 새 배송 생성 명령을 받을 수 없다.
- `DONE` 배치는 같은 `job_key`와 `input_version` 조합에서 하나만 존재해야 한다.
- `REFUNDED` 결제의 환불 합계는 승인 금액을 초과할 수 없다.

불변식은 세 계층에 나눠 넣는 편이 안전합니다. 첫째, DB 제약과 unique index로 닫을 수 있는 것은 DB에 둡니다. 둘째, 도메인 서비스에서 상태 전이 함수를 통해 한 번 더 검증합니다. 셋째, 운영 배치나 알람에서 "이미 망가진 데이터"를 탐지합니다. DB 제약만으로 모든 도메인 규칙을 표현하려 하면 복잡하고, 애플리케이션 검증만 믿으면 우회 경로에서 깨집니다.

실무 우선순위는 **금전 > 권한 > 데이터 공개 > 재처리 비용 > 화면 표시** 순서로 잡는 것이 좋습니다. 모든 status 컬럼을 완벽한 statechart로 바꾸려 하면 일정이 무너집니다. 반대로 결제, 포인트, 개인정보 삭제, 파일 공개 같은 고위험 경로는 단순 `enum`으로 두면 나중에 더 큰 비용을 냅니다.

### 4) 상태 이력은 디버깅 로그가 아니라 감사 데이터다

운영 가능한 상태 머신은 전이 이력을 남깁니다. 단순히 애플리케이션 로그에 "status changed"를 찍는 수준으로는 부족합니다. 로그는 보관 기간, 검색성, 누락 가능성의 영향을 받습니다. 중요한 상태 전이는 별도 history 테이블이나 audit event로 남기는 편이 안전합니다.

```text
state_transition_history
- id
- aggregate_type
- aggregate_id
- from_state
- to_state
- command_type
- idempotency_key
- actor_type
- actor_id
- reason
- request_id
- occurred_at
- metadata
```

이 데이터가 있으면 장애 때 질문이 바뀝니다. "왜 주문이 취소됐지?"가 아니라 "누가, 어떤 요청으로, 어떤 상태에서 취소 전이를 실행했지?"를 볼 수 있습니다. 특히 agent, batch, webhook, admin tool처럼 사람이 직접 누른 것과 자동 실행이 섞이는 시스템에서는 actor와 request id가 반드시 필요합니다.

전이 이력은 무조건 영구 보관할 필요는 없습니다. 기준을 나눕니다.

- 금전·권한·삭제·정산: 법/감사 기준에 맞춰 장기 보관
- 파일 스캔·배치 실행: 90~180일 보관 후 요약
- 화면 표시용 임시 상태: 7~30일 보관 또는 metric만 유지

보관 기간보다 더 중요한 것은 **재처리와 원인 분석에 필요한 기간**입니다. 월말 정산에서 지난달 결제 상태를 검증해야 한다면 30일 보관은 부족합니다.

## 실무 적용

### 1) 새 기능에는 상태 전이표를 PR에 붙인다

처음부터 거대한 모델링 문서를 만들 필요는 없습니다. 상태가 4개 이상이거나, 외부 시스템이 2개 이상 엮이거나, 실패 후 재처리가 필요한 기능이면 PR 설명에 전이표를 붙이세요.

도입 기준:

- 상태값 3개 이하, 단일 요청 안에서 완료, 외부 호출 없음: 간단한 enum으로 충분
- 상태값 4~7개, webhook/worker/재시도 존재: 전이표와 조건부 update 필수
- 상태값 8개 이상, 사람 승인/장기 대기/보상 트랜잭션 존재: workflow engine 또는 명시적 operation resource 검토
- 금전/권한/삭제/공개 상태: 상태 개수와 무관하게 이력 저장 필수

PR에는 최소 다섯 줄만 있으면 됩니다.

```text
states: REQUESTED -> PAYMENT_PENDING -> PAID -> CANCEL_REQUESTED -> CANCELED
forbidden: PAID -> PAYMENT_FAILED, CANCELED -> PAID
idempotency: payment_id, refund_id
manual queue: payment success after cancellation
metrics: transition_conflict_total, stale_event_skipped_total
```

이 짧은 표가 있으면 리뷰어가 "이 상태에서 이 이벤트가 오면?"이라는 질문을 할 수 있습니다. 상태 머신 설계의 가치는 UML이 아니라 리뷰 가능한 조건입니다.

### 2) 전이 함수를 도메인 코드의 단일 입구로 둔다

여러 서비스가 직접 `status`를 update하면 규칙이 흩어집니다. 상태 전이는 가능하면 한 함수 또는 한 모듈로 모읍니다.

```java
Order transition(Order order, OrderCommand command) {
    return switch (order.status()) {
        case REQUESTED -> handleRequested(order, command);
        case PAYMENT_PENDING -> handlePaymentPending(order, command);
        case PAID -> handlePaid(order, command);
        case CANCEL_REQUESTED -> handleCancelRequested(order, command);
        case CANCELED -> rejectTerminal(order, command);
    };
}
```

이 함수는 "상태를 바꾸는 곳"이지 모든 일을 하는 곳이 아닙니다. 외부 결제 API 호출, 메시지 발행, 파일 이동은 별도 activity나 service로 분리합니다. 상태 전이 함수는 허용 여부, 다음 상태, 필요한 side effect 요청을 결정하고, 실제 side effect는 outbox나 worker가 실행하는 구조가 안전합니다. 이 분리는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)와도 잘 맞습니다.

### 3) 경합과 재처리는 metric으로 본다

상태 전이 실패를 모두 예외 로그로만 남기면 운영자는 노이즈에 묻힙니다. 전이 경합은 metric으로 관리해야 합니다.

권장 지표:

- `state_transition_total{from,to,command}`
- `state_transition_conflict_total{state,command}`
- `state_transition_forbidden_total{state,command}`
- `stale_event_skipped_total{event_type}`
- `manual_review_enqueued_total{reason}`
- `terminal_state_reopen_attempt_total{state,command}`

초기 임계치는 보수적으로 잡습니다.

- forbidden 전이: 1건이라도 알림 후보
- stale event skip: 전체 이벤트의 0.5% 초과 시 consumer lag/순서 문제 점검
- transition conflict: 5분 p95가 평소 대비 3배면 동시성 또는 중복 webhook 점검
- manual review queue: 1시간 이상 처리 지연이면 운영 알림

숫자는 서비스마다 조정해야 하지만, 기준이 없으면 상태 머신은 코드 품질 장식으로 끝납니다.

## 트레이드오프/주의점

첫째, 모든 상태를 세밀하게 쪼개면 오히려 운영이 어려워집니다. `VALIDATING`, `VALIDATED`, `READY_TO_PUBLISH`, `PUBLISHING`, `PUBLISHED`가 정말 필요한지, 아니면 `PENDING_SCAN`, `CLEAN`, `PUBLISHED`로 충분한지 봐야 합니다. 상태는 화면 라벨이 아니라 운영 의사결정 단위입니다.

둘째, terminal state를 너무 쉽게 다시 열면 사고가 납니다. `CANCELED`, `REFUNDED`, `DELETED`, `REJECTED` 같은 상태는 기본적으로 되돌리지 않습니다. 예외가 필요하면 새 전이를 만들고 이력을 남깁니다. "관리자라서 DB에서 status만 바꿈"은 가장 빨리 부채가 쌓이는 방식입니다.

셋째, workflow engine을 도입해도 도메인 상태 머신이 사라지지는 않습니다. Temporal이나 배치 프레임워크는 실행 복구를 도와주지만, `PAID`에서 `PAYMENT_FAILED`로 가면 안 된다는 도메인 규칙은 여전히 팀이 정의해야 합니다.

넷째, 상태 이력은 개인정보와 비용 이슈를 만듭니다. metadata에 원문 요청, 토큰, 고객 데이터를 그대로 넣으면 나중에 보안 문제가 됩니다. history에는 식별자와 판단 근거를 남기되, 민감 본문은 최소화하고 보관 기간을 정해야 합니다.

## 체크리스트 또는 연습

- [ ] 상태값 목록뿐 아니라 허용 전이표가 있다.
- [ ] 상태 전이는 `WHERE current_state = ...` 조건부 update 또는 동등한 원자적 방식으로 실행된다.
- [ ] 멱등 키가 명령/이벤트 단위로 정의돼 있다.
- [ ] terminal state에서 재오픈되는 경로는 별도 승인과 이력을 남긴다.
- [ ] 금전·권한·삭제·공개 상태는 전이 history를 저장한다.
- [ ] 오래된 이벤트, 중복 이벤트, 금지 전이를 서로 다른 metric으로 분리한다.
- [ ] 재처리 스크립트가 전이 함수를 우회하지 않는다.

연습으로 현재 서비스의 status 컬럼 1개를 고르세요. 주문, 파일 업로드, 배치 실행, 알림 발송, 포인트 적립 중 무엇이든 됩니다. 그 상태값을 전부 나열한 뒤 `허용 전이`, `금지 전이`, `멱등 키`, `수동 확인으로 보내야 하는 전이`, `반드시 남겨야 하는 history 필드`를 한 표에 적어 보세요. 표를 쓰는 데 30분 이상 걸리면 코드가 복잡한 것이 아니라, 운영 규칙이 아직 팀 안에서 합의되지 않은 것입니다.

## 관련 글

- [멱등성 API 설계](/learning/deep-dive/deep-dive-idempotency/)
- [UPSERT·UNIQUE·멱등 키 쓰기 경로](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)
- [비동기 요청-응답 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)
- [Transactional Inbox와 멱등 Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)
- [Temporal 워크플로 오케스트레이션](/learning/deep-dive/deep-dive-temporal-workflow-orchestration/)
