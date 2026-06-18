---
title: "백엔드 커리큘럼 심화: 운영용 상태 머신 설계, status 컬럼을 사고 방지 장치로 바꾸기"
date: 2026-05-28
draft: false
topic: "Backend Architecture"
tags: ["State Machine", "Domain Modeling", "Idempotency", "Concurrency", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "주문, 결제, 업로드, 배치, 이벤트 소비처럼 상태가 있는 백엔드 흐름을 단순 status 컬럼이 아니라 전이표·불변식·감사 로그·재처리 기준으로 설계하는 방법을 정리합니다."
summary: "운영용 상태 머신은 status 값을 예쁘게 나누는 일이 아니라 허용 전이, 금지 전이, 멱등 키, 감사 이력, 재처리 기준을 한 계약으로 묶는 설계입니다. 결제·업로드·배치처럼 실패와 중복이 자연스러운 흐름에서는 조건부 업데이트와 전이 이력이 사고 방지 장치가 됩니다."
module: "backend-architecture"
study_order: 1435
keywords: ["state machine", "status column", "상태 머신", "상태 전이", "멱등성", "운영 설계"]
key_takeaways:
  - "status 컬럼은 현재값이고, 운영용 상태 머신은 어떤 명령이 어떤 조건에서 다음 상태로 갈 수 있는지 정의한 계약이다."
  - "상태 전이는 애플리케이션 if문만 믿지 말고 current_state 조건을 포함한 원자적 update로 닫아야 한다."
  - "금전·권한·삭제·공개처럼 위험한 상태는 전이 이력, 멱등 키, forbidden transition metric을 함께 남겨야 재처리 사고를 줄일 수 있다."
operator_checklist:
  - "상태값이 4개 이상이면 허용 전이표와 금지 전이를 PR 또는 설계 문서에 붙인다."
  - "중복 명령, 오래된 이벤트, 금지 전이를 서로 다른 처리 결과와 metric으로 분리한다."
  - "terminal state 재오픈은 DB 직접 수정이 아니라 별도 명령과 감사 이력으로만 허용한다."
  - "재처리 스크립트, 관리자 도구, batch worker가 같은 전이 함수를 우회하지 않는지 확인한다."
  - "상태 이력 metadata에는 원문 개인정보나 토큰을 넣지 않고 식별자와 판단 근거만 남긴다."
learning_refs:
  - title: "멱등성 API 설계"
    href: "/learning/deep-dive/deep-dive-idempotency/"
    description: "같은 요청이 반복돼도 같은 업무 효과만 발생하게 만드는 API 계약입니다."
  - title: "UPSERT·UNIQUE·멱등 키 쓰기 경로"
    href: "/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/"
    description: "DB unique constraint와 멱등 ledger를 함께 쓰는 쓰기 경로 설계입니다."
  - title: "Transactional Inbox와 멱등 Consumer"
    href: "/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/"
    description: "중복·역전 이벤트를 상태 전이와 함께 다루는 소비자 패턴입니다."
  - title: "비동기 요청-응답 Operation Resource"
    href: "/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/"
    description: "긴 작업의 진행 상태, 재시도, 조회 API를 상태 머신 관점으로 모델링할 때 연결되는 글입니다."
decision_guide:
  intro: "상태 머신은 모든 enum에 붙이는 장식이 아니라 운영 위험이 있는 흐름부터 적용하는 안전장치입니다."
  cases:
    - badge: "간단한 enum"
      title: "상태가 3개 이하이고 한 요청 안에서 끝난다"
      fit: "화면 표시나 내부 처리 단계처럼 실패 후 재처리와 외부 이벤트가 없는 흐름에 적합합니다."
      watchouts: "나중에 webhook, worker, 승인 단계가 붙으면 전이표로 승격할 준비가 필요합니다."
      next_step: "상태값 이름과 terminal state만 명확히 두고 과한 이력 테이블은 미룹니다."
    - badge: "전이표 필수"
      title: "worker, webhook, 재시도, 사용자 취소가 섞인다"
      fit: "주문, 결제, 파일 스캔, import job처럼 중복·역전 이벤트가 정상적으로 발생하는 흐름입니다."
      watchouts: "읽고 판단한 뒤 update하는 코드만 있으면 동시 요청에서 최신 상태를 되돌릴 수 있습니다."
      next_step: "허용 전이표, 조건부 update, 멱등 키, transition metric을 함께 추가합니다."
    - badge: "감사/승인 강화"
      title: "금전, 권한, 삭제, 공개 상태를 바꾼다"
      fit: "상태 하나가 보안 사고나 금전 불일치로 이어질 수 있는 고위험 도메인입니다."
      watchouts: "관리자 수동 수정이나 DB 패치가 전이 이력을 우회하면 원인 분석과 보정이 어려워집니다."
      next_step: "전이 history, manual review queue, compensation 경로를 설계에 포함합니다."
faqs:
  - question: "상태 머신을 쓰면 workflow engine도 꼭 필요할까요?"
    answer: "아닙니다. workflow engine은 장기 실행과 재시도 실행을 도와주지만, 어떤 전이가 허용되는지는 도메인 규칙입니다. 작은 기능은 전이표와 조건부 update만으로도 충분합니다."
  - question: "상태 이력을 모두 영구 보관해야 하나요?"
    answer: "위험도에 따라 다릅니다. 금전·권한·삭제·정산은 장기 보관이 필요할 수 있지만, 임시 화면 상태나 짧은 배치 단계는 7~90일 보관 또는 metric 요약으로 충분할 수 있습니다."
  - question: "terminal state를 되돌려야 하는 예외는 어떻게 처리하나요?"
    answer: "DB에서 status만 바꾸지 말고 별도 명령, 승인자, reason, compensation 계획을 가진 새 전이로 모델링해야 합니다. 그래야 재처리와 감사에서 같은 규칙을 적용할 수 있습니다."
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

### 4) 주문 상태 예시로 전이 계약을 검증한다

상태 머신은 추상적인 표로만 두면 리뷰 때는 좋아 보이지만 운영에서는 잘 쓰이지 않습니다. 실제 명령, 이벤트, 데이터 필드를 붙여 봐야 빈틈이 보입니다. 예를 들어 주문 흐름을 아래처럼 잡았다고 해보겠습니다.

```text
REQUESTED
  -> PAYMENT_PENDING        command: start_payment
PAYMENT_PENDING
  -> PAID                   event: payment_approved
  -> PAYMENT_FAILED         event: payment_failed
  -> CANCELED               command: cancel_before_payment
PAID
  -> CANCEL_REQUESTED       command: cancel_after_payment
CANCEL_REQUESTED
  -> REFUND_PENDING         command: start_refund
REFUND_PENDING
  -> CANCELED               event: refund_approved
```

이 표에서 바로 드러나는 운영 질문이 있습니다. 결제 승인 webhook이 늦게 도착했는데 주문이 이미 `CANCELED`이면 어떻게 할까요? 같은 `payment_approved` 이벤트가 두 번 오면 두 번째는 성공 응답을 줘야 할까요, 무시해야 할까요? `PAID` 상태에서 결제 실패 이벤트가 오면 단순 stale event인지, 결제사 정정 이벤트인지, 데이터 불일치인지 어떻게 구분할까요?

이 질문을 코드로 닫으려면 상태와 외부 식별자를 같이 봐야 합니다.

```sql
UPDATE orders
SET status = 'PAID',
    payment_id = :payment_id,
    paid_at = :approved_at,
    version = version + 1
WHERE order_id = :order_id
  AND status = 'PAYMENT_PENDING'
  AND payment_id IS NULL;
```

이 update가 0건이면 즉시 실패로 던지지 않습니다. 먼저 같은 `payment_id`로 이미 `PAID`가 됐는지 확인합니다. 맞다면 멱등 중복이므로 기존 결과를 반환합니다. 주문이 `CANCELED`라면 stale approval인지, 취소와 승인 사이의 경합인지 분류하고 manual review queue로 보낼 수 있습니다. 주문이 `PAID`인데 다른 `payment_id`가 들어왔다면 중복 결제 후보이므로 자동 보정하지 않고 결제 reconciliation 흐름으로 넘기는 편이 안전합니다.

관리자 도구도 같은 전이 계약을 써야 합니다. 장애 중 운영자가 "주문 상태만 PAID로 바꿔 주세요"라고 요청할 수 있지만, 이때 DB를 직접 수정하면 `payment_id`, outbox event, transition history, reconciliation target이 빠질 수 있습니다. 대신 `force_mark_paid` 같은 별도 명령을 만들고, 허용 조건을 좁힙니다.

```text
command: force_mark_paid
allowed_from: PAYMENT_PENDING, PAYMENT_FAILED
required: payment_id, approver_id, reason, evidence_url
side_effect: transition_history 저장, reconciliation 대상 등록
forbidden: CANCELED, REFUNDED, DELETED
```

이렇게 하면 예외 처리도 규칙 안으로 들어옵니다. 운영용 상태 머신의 목표는 예외를 없애는 것이 아니라, 예외가 생겨도 누가 어떤 근거로 어떤 상태를 만들었는지 추적 가능하게 하는 것입니다.

### 5) 상태 전이 테스트는 happy path보다 역전 이벤트를 먼저 넣는다

상태 머신 테스트는 정상 흐름만 확인하면 부족합니다. 실제 장애는 대부분 중복, 순서 역전, 재시도, 수동 보정에서 나옵니다. 최소 테스트 세트는 아래처럼 구성합니다.

- 정상 전이: `REQUESTED -> PAYMENT_PENDING -> PAID`
- 중복 이벤트: 같은 `payment_approved`를 두 번 처리해도 결제 효과는 한 번만 발생
- 오래된 이벤트: `CANCELED` 이후 도착한 예전 `payment_failed`는 최신 상태를 덮지 않음
- 금지 전이: `PAID -> PAYMENT_FAILED`는 forbidden metric을 남기고 거부
- terminal state: `REFUNDED` 이후 재오픈 명령은 별도 승인 없이는 거부
- 관리자 예외: `force_mark_paid`는 reason/evidence가 없으면 실패
- 재처리 경로: inbox replay나 batch replay가 일반 API와 같은 전이 함수를 사용

테스트 이름에도 전이 조건을 드러내면 좋습니다. `should_update_status`보다 `paid_order_rejects_late_payment_failed_event`가 리뷰와 회귀 분석에 훨씬 유용합니다. 상태 머신이 복잡해질수록 테스트는 구현 세부보다 전이표의 행을 검증하는 형태가 되어야 합니다.

### 6) 실패 모드는 처리 결과가 아니라 운영 큐로 분류한다

상태 머신을 도입했는데도 운영자가 힘들어지는 경우가 있습니다. 코드가 `success`, `duplicate`, `error` 정도로만 결과를 반환하고, 실제로 어떤 후속 조치가 필요한지 알려주지 않기 때문입니다. 운영용 상태 머신은 전이를 실행하는 코드만이 아니라 **전이가 실패했을 때 어느 큐로 보내야 하는지**까지 포함해야 합니다.

아래처럼 실패 모드를 먼저 나누면 로그와 알림이 훨씬 선명해집니다.

| 실패 모드 | 예시 | 자동 처리 | 운영 조치 |
|---|---|---|---|
| 멱등 중복 | 같은 `payment_id` 승인 이벤트가 재전송됨 | 기존 결과 반환, duplicate metric 증가 | 조치 없음 |
| 순서 역전 | 취소 완료 뒤 늦게 도착한 결제 실패 이벤트 | stale event로 skip | 이벤트 지연률이 임계치 초과 시 consumer lag 점검 |
| 금지 전이 | `PAID -> PAYMENT_FAILED` 시도 | 상태 변경 거부, forbidden metric 증가 | 1건부터 원인 확인 |
| 판단 불가 | 다른 `payment_id`로 승인 성공 이벤트가 도착 | 자동 보정 금지 | reconciliation/manual review queue 적재 |
| 터미널 재오픈 | `REFUNDED` 주문을 다시 `PAID`로 변경 요청 | 기본 거부 | 승인자, 사유, 보상 계획이 있는 별도 명령만 허용 |
| 이력 누락 | 상태는 바뀌었지만 transition history가 없음 | 배치 탐지 | DB 직접 수정/우회 도구 조사 |

핵심은 모든 0-row update를 같은 오류로 보지 않는 것입니다. 중복 이벤트는 정상적인 분산 시스템의 일부이고, 금지 전이는 설계 위반이며, 판단 불가는 사람이 봐야 하는 업무 사건입니다. 세 가지를 같은 예외 로그로 남기면 운영자는 무엇을 먼저 봐야 할지 모릅니다.

실무에서는 상태 전이 결과를 아래처럼 enum으로 고정해 두면 좋습니다.

```text
transition_result:
  APPLIED              # 전이 성공
  DUPLICATE_NOOP       # 같은 멱등 키의 반복 요청
  STALE_EVENT_SKIPPED  # 오래된 이벤트가 최신 상태를 덮지 않도록 skip
  FORBIDDEN_REJECTED   # 전이표에 없는 전이
  MANUAL_REVIEW        # 자동 판단 금지, 운영 큐로 이동
  INVARIANT_VIOLATION  # 데이터 불변식 깨짐, 즉시 알림
```

이 결과값은 API 응답, consumer ack/nack, metric, audit event에 같은 의미로 쓰여야 합니다. 예를 들어 consumer가 `DUPLICATE_NOOP`를 받으면 ack하고 끝내지만, `MANUAL_REVIEW`는 ack와 동시에 별도 큐에 ticket을 만들어야 합니다. `INVARIANT_VIOLATION`은 재시도한다고 해결되지 않는 경우가 많으므로 무한 재처리보다 격리와 알림이 우선입니다.

상태 머신 리뷰에서는 "이 이벤트가 오면 다음 상태가 무엇인가?"만 묻지 말고, "전이하지 못했을 때 어떤 결과값으로 끝나는가?"를 같이 물어야 합니다. 이 질문이 있어야 재처리 배치, 관리자 도구, 고객센터 대응이 같은 언어를 씁니다.

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
