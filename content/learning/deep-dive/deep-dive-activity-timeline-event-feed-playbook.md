---
title: "백엔드 커리큘럼 심화: Activity Timeline과 Event Feed, 운영자가 믿을 수 있는 이력 화면 설계하기"
date: 2026-07-30
draft: false
topic: "Backend Operational Timeline"
tags: ["Activity Timeline", "Event Feed", "Audit Log", "Operational UX", "Backend Architecture", "Observability"]
categories: ["Backend Deep Dive"]
keywords: ["activity timeline", "event feed", "운영 이력", "감사 로그", "상태 타임라인", "백엔드 운영"]
description: "주문·결제·권한·배치 작업의 이력을 단순 로그 검색이 아니라 운영자가 판단할 수 있는 Activity Timeline과 Event Feed로 설계하는 실무 플레이북입니다."
summary: "Activity Timeline은 로그를 예쁘게 보여주는 화면이 아니라 상태 전이, 감사 이벤트, 작업 영수증, 사용자 노출 범위를 묶어 운영자가 믿고 판단할 수 있게 만드는 읽기 모델입니다."
key_takeaways:
  - "운영 이력 화면은 애플리케이션 로그와 다르다. 사용자·운영자가 판단할 수 있는 도메인 이벤트만 선별해 안정적인 계약으로 저장해야 한다."
  - "이벤트에는 actor, action, target, result, reason, correlation_id, visibility, occurred_at/recorded_at이 있어야 재현과 감사가 가능하다."
  - "Timeline은 무한 scroll UI보다 정렬 기준, 중복 제거, 민감정보 마스킹, 보존 기간, 누락 표시 정책이 먼저다."
operator_checklist:
  - "고객/운영자에게 보여줄 이벤트와 보안팀만 볼 이벤트를 visibility 등급으로 분리한다."
  - "Timeline p95 반영 지연은 일반 운영 이벤트 5초 이하, 결제·권한 이벤트 1초 이하를 초기 목표로 둔다."
  - "고위험 이벤트는 audit log와 동일한 correlation_id를 공유하고, 1년 이상 보존 기준을 별도 정책으로 둔다."
learning_refs:
  - title: "운영용 상태 머신 설계"
    href: "/learning/deep-dive/deep-dive-operational-state-machine-design/"
    description: "상태 전이를 이벤트로 남길 때 기준이 되는 도메인 상태 설계입니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "조작 방지 감사 로그와 사용자용 timeline의 경계를 나누는 기준입니다."
  - title: "Execution Receipt"
    href: "/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/"
    description: "운영 action의 입력, 결과, 증거를 이력에 연결하는 방식입니다."
  - title: "구조화 로깅"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "검색 가능한 로그 필드와 correlation id 설계의 기본입니다."
decision_guide:
  intro: "모든 이벤트를 timeline에 넣으면 화면은 풍부해지지만 판단은 어려워집니다. 이벤트는 사용자 판단, 운영 판단, 감사 판단 중 어떤 목적을 갖는지 먼저 나눠야 합니다."
  cases:
    - badge: "고객 노출"
      title: "사용자가 자신의 주문·신청·파일 처리 상태를 이해해야 한다"
      fit: "주문 접수, 결제 완료, 배송 준비, 파일 스캔 완료, 환불 처리 같은 이벤트입니다."
      watchouts: "내부 실패 원인이나 운영자 메모를 그대로 노출하면 보안·CS 문제가 됩니다."
      next_step: "public label과 internal reason_code를 분리하고, 지연 가능성을 명시합니다."
    - badge: "운영 판단"
      title: "CS·온콜·백오피스가 다음 조치를 결정해야 한다"
      fit: "재처리, 수동 승인, 외부 API 실패, correction job 실행, 권한 회수 같은 이벤트입니다."
      watchouts: "로그 링크만 있으면 운영자가 다시 원인을 추리해야 합니다."
      next_step: "action result, owner, retry 가능 여부, 관련 receipt를 같이 보여줍니다."
    - badge: "감사 증거"
      title: "나중에 누가 무엇을 왜 했는지 검증해야 한다"
      fit: "관리자 권한 변경, 개인정보 export, 환불 승인, 보안 정책 예외 같은 이벤트입니다."
      watchouts: "사용자용 timeline 저장소를 감사 원장으로 착각하면 조작 방지와 보존 요건을 놓칩니다."
      next_step: "audit log를 source of truth로 두고 timeline은 마스킹된 projection으로 만듭니다."
module: "backend-ops-observability"
study_order: 1452
---

운영자가 장애나 고객 문의를 받을 때 가장 자주 묻는 질문은 "지금 상태가 뭐지?"가 아니라 "여기까지 어떻게 왔지?"입니다. 주문이 왜 취소됐는지, 파일 업로드가 왜 아직 공개되지 않았는지, 권한 회수가 언제 적용됐는지, 배치 작업이 재시도됐는지 한눈에 볼 수 있어야 다음 조치를 결정할 수 있습니다. 그런데 많은 서비스는 이 질문을 애플리케이션 로그 검색으로 넘깁니다. 로그는 개발자 디버깅에는 좋지만, 고객·CS·운영자가 믿고 판단할 이력 화면으로는 부족합니다.

Activity Timeline과 Event Feed는 이런 간극을 메우는 읽기 모델입니다. 중요한 도메인 이벤트를 선별하고, 상태 전이와 감사 로그, 작업 영수증, 외부 연동 결과를 같은 시간축으로 보여 줍니다. 이 글은 [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [Execution Receipt](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/), [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)을 이어서, 운영자가 실제로 쓸 수 있는 이력 화면을 어떻게 설계할지 정리합니다.

## 이 글에서 얻는 것

- 애플리케이션 로그, 감사 로그, 도메인 이벤트, 사용자용 timeline의 역할 차이를 구분할 수 있습니다.
- Activity Timeline 이벤트 스키마에 들어가야 할 필드와 민감정보 마스킹 기준을 잡을 수 있습니다.
- 이벤트 반영 지연, 중복 제거, 정렬, 누락 표시, 보존 기간을 숫자로 설계할 수 있습니다.
- 고객 화면과 백오피스 화면, 보안 감사 화면을 같은 원본 이벤트에서 다르게 projection하는 방법을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Timeline은 로그 뷰어가 아니라 도메인 읽기 모델이다

로그는 보통 "시스템이 무엇을 했다"를 남깁니다. `payment request failed`, `retry scheduled`, `status update rows=1` 같은 메시지는 개발자에게는 의미가 있지만 고객이나 CS에게는 충분하지 않습니다. Timeline은 "업무적으로 어떤 일이 일어났는가"를 보여 줘야 합니다.

예를 들어 결제 실패 로그는 아래처럼 timeline 이벤트로 바뀌어야 합니다.

| 원본 신호 | Timeline 이벤트 | 운영자가 얻는 판단 |
| --- | --- | --- |
| PG timeout log | 결제 승인 응답 지연으로 확인 대기 전환 | 고객에게 중복 결제 안내가 필요한가 |
| retry job created | 결제 상태 재확인 예약 | 언제 자동 확인되는가 |
| reconciliation matched | 승인 완료로 보정 | 수동 환불이 필요한가 |
| correction job approved | 운영자 승인 보정 완료 | 누가 어떤 근거로 처리했는가 |

핵심은 원본 로그를 모두 보여 주는 것이 아닙니다. 운영 판단에 필요한 이벤트를 안정적인 이름과 스키마로 저장하는 것입니다. 로그 메시지는 바뀔 수 있지만 `PAYMENT_CONFIRMATION_DELAYED` 같은 이벤트 타입은 API 계약처럼 관리해야 합니다.

### 2) Audit Log와 Timeline은 겹치지만 목적이 다르다

감사 로그는 나중에 검증하기 위한 증거입니다. 누가, 어떤 권한으로, 어떤 대상에, 어떤 결과를 만들었는지 조작 가능성을 낮춰 보존합니다. Timeline은 운영자가 지금 판단하기 위한 화면입니다. 같은 사건에서 출발하더라도 보여 주는 필드와 보존 정책이 달라야 합니다.

관리자 권한 변경을 예로 들면 감사 로그에는 actor id, policy version, before/after digest, ticket id, request id가 들어갑니다. 반면 운영 timeline에는 "철수님에게 Billing Admin 권한이 부여됨", "승인 티켓: SEC-1234", "권한 정책 v18 기준" 정도면 충분할 수 있습니다. 고객 화면에는 아예 보이지 않아야 할 수도 있습니다.

이 차이를 무시하면 두 가지 문제가 생깁니다. 모든 것을 timeline에 넣으면 민감정보가 새어 나갑니다. 반대로 timeline만 믿고 감사 로그를 생략하면 사고 후 검증이 어렵습니다. 실무에서는 audit log를 source of truth로 두고, timeline은 목적별 projection으로 만드는 편이 안전합니다.

### 3) 이벤트 스키마는 사람 문장보다 안정적인 필드가 먼저다

Timeline 이벤트에는 사람이 읽는 문장도 필요하지만, 운영 기준은 구조화 필드에서 나옵니다.

```yaml
activity_event:
  event_id: evt_01H...
  type: ORDER_PAYMENT_CONFIRMATION_DELAYED
  tenant_id: t_123
  target:
    type: order
    id: ord_456
  actor:
    type: system
    id: payment-reconciler
  result: pending
  severity: warning
  visibility: operator
  reason_code: PG_TIMEOUT
  occurred_at: "2026-07-30T09:21:13+09:00"
  recorded_at: "2026-07-30T09:21:14+09:00"
  correlation_id: req_789
  source_event_id: outbox_555
  dedupe_key: "order:ord_456:payment-confirmation:2026-07-30"
```

여기서 `occurred_at`과 `recorded_at`을 나누는 것이 중요합니다. 외부 시스템이나 비동기 worker에서 늦게 들어온 이벤트는 실제 발생 시각과 저장 시각이 다를 수 있습니다. Timeline 정렬은 보통 `occurred_at` 기준이지만, 운영 디버깅에는 `recorded_at` 지연도 필요합니다. 두 값 차이가 30초를 넘으면 ingestion lag로 표시하는 식의 기준을 둘 수 있습니다.

### 4) 모든 이벤트는 visibility 등급을 가져야 한다

Timeline이 커질수록 가장 위험한 실수는 "일단 다 보여 주자"입니다. 이벤트에는 반드시 노출 등급이 있어야 합니다.

| 등급 | 대상 | 예시 |
| --- | --- | --- |
| public | 최종 사용자 | 주문 접수, 결제 완료, 배송 시작 |
| support | CS/백오피스 | PG 응답 지연, 재처리 예약, 고객 문의 메모 |
| operator | 개발/운영팀 | retry exhausted, provider error code, worker shard |
| security | 보안/감사 권한자 | 권한 변경, 개인정보 export, 정책 예외 |
| hidden | 내부 계산용 | dedupe, projection rebuild, migration marker |

초기 기준은 public/support/operator/security 네 단계면 충분합니다. public 이벤트에는 내부 오류 코드, 계정 식별자, provider raw response를 넣지 않습니다. security 이벤트는 별도 권한과 감사 조회 로그를 둡니다. support 등급은 고객 응대에는 필요하지만 고객 화면에는 보이면 안 되는 정보가 들어갈 수 있습니다.

### 5) Timeline의 신뢰도는 누락과 지연을 어떻게 표시하느냐에서 갈린다

이력 화면은 항상 완벽하지 않습니다. 이벤트 수집이 늦어질 수 있고, projection rebuild 중일 수 있고, 외부 시스템이 나중에 결과를 보낼 수 있습니다. 좋은 timeline은 조용히 거짓말하지 않습니다.

운영 기준은 아래처럼 잡을 수 있습니다.

- 일반 도메인 이벤트 반영 지연 p95: 5초 이하
- 결제·권한·보안 이벤트 반영 지연 p95: 1초 이하 또는 "검증 중" 표시
- 이벤트 ingestion lag가 30초 초과: timeline 상단에 지연 배너
- source event와 projection count 차이: 0을 목표, 10건 이상이면 rebuild 알림
- 동일 target의 중복 이벤트 dedupe window: 1~5분
- page size 기본값: 30~50개, 최대 100개
- 고객 화면 보존: 90~180일, 감사 이벤트 원장 보존: 규정에 맞춰 1년 이상

특히 "마지막 이벤트가 없으니 아무 일도 없었다"는 해석을 막아야 합니다. 결제 확인 중, 외부 배송사 응답 대기, 보안 검토 대기처럼 진행 중 상태는 명시적으로 보여 줘야 합니다.

## 실무 적용

### 1) 이벤트 카탈로그를 먼저 만든다

처음부터 모든 로그를 timeline으로 만들지 않습니다. 도메인별로 운영 판단에 필요한 이벤트 타입을 10~20개만 고릅니다.

주문 도메인 예시는 아래와 같습니다.

| 이벤트 타입 | visibility | source | 보존 |
| --- | --- | --- | --- |
| ORDER_CREATED | public | order service | 180일 |
| PAYMENT_AUTHORIZED | public | payment ledger | 180일 |
| PAYMENT_CONFIRMATION_DELAYED | support | reconciler | 180일 |
| ORDER_CANCEL_REQUESTED | public | order service | 180일 |
| REFUND_APPROVED_BY_OPERATOR | security | audit log | 1년 이상 |
| DELIVERY_PROVIDER_TIMEOUT | operator | adapter | 90일 |
| CORRECTION_JOB_APPLIED | operator | correction job | 1년 |

이 표가 없으면 개발자는 각자 다른 이름으로 이벤트를 남깁니다. `payment_failed`, `payFail`, `PG_TIMEOUT`이 섞이면 검색과 집계가 깨집니다. 이벤트 타입은 enum처럼 관리하고, 삭제보다 deprecated 상태를 둡니다.

### 2) 쓰기 경로와 projection 경로를 분리한다

Timeline 이벤트를 업무 트랜잭션 안에서 직접 화면 테이블에 쓰면 간단합니다. 하지만 화면 요구가 바뀔 때 핵심 쓰기 경로가 같이 흔들립니다. 실무에서는 원본 이벤트와 읽기 projection을 분리하는 편이 낫습니다.

권장 흐름:

1. 도메인 트랜잭션에서 outbox 또는 audit log에 원본 이벤트를 남긴다.
2. projector가 visibility, 문구, masking, sort key를 계산해 timeline 테이블에 반영한다.
3. 화면 API는 timeline projection만 읽고, 고위험 상세는 별도 권한으로 audit log를 조회한다.
4. projection rebuild가 가능하도록 source_event_id와 projector_version을 저장한다.

이 구조는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)와도 맞습니다. 원본 이벤트가 남아 있으면 화면 projection이 깨져도 다시 만들 수 있습니다. 반대로 화면 테이블만 source of truth가 되면 문구 변경, 마스킹 정책 변경, 중복 제거 버그를 복구하기 어렵습니다.

### 3) 문구는 template version으로 관리한다

Timeline은 사람이 읽어야 하므로 문구 품질이 중요합니다. 하지만 문구를 이벤트 payload에 완성된 문자열로 저장하면 나중에 수정하기 어렵습니다. 이벤트에는 `type`, `reason_code`, `actor`, `target`, `metadata`를 저장하고, 화면에서는 template version으로 렌더링합니다.

예시:

```yaml
template:
  type: PAYMENT_CONFIRMATION_DELAYED
  version: 3
  public: "결제 확인이 지연되고 있습니다. 보통 몇 분 안에 자동 확인됩니다."
  support: "PG 응답 지연으로 결제 확인 대기 상태입니다. 자동 재확인 예정: {next_check_at}"
  operator: "PG timeout. provider={provider}, retry={retry_count}, correlation_id={correlation_id}"
```

이렇게 하면 같은 이벤트도 대상별로 다르게 보여 줄 수 있습니다. public 문구는 불안을 줄이고, support 문구는 응대에 필요한 다음 시각을 주고, operator 문구는 원인 추적 키를 줍니다.

### 4) 정렬과 중복 제거를 명시한다

Timeline에서 정렬은 생각보다 어렵습니다. 외부 결제 승인 이벤트가 주문 생성보다 늦게 들어왔지만 실제 발생 시각은 더 빠를 수 있습니다. 재처리 중 같은 이벤트가 두 번 들어올 수도 있습니다. 단순 `created_at desc`만 쓰면 운영자가 순서를 오해합니다.

기본 정책:

- primary sort: `occurred_at desc`
- tie breaker: `recorded_at desc`, `event_id desc`
- 같은 `dedupe_key` 중복은 최신 projection만 표시
- 중복으로 합쳐진 이벤트는 support/operator 화면에서 "3회 반복"처럼 표시
- `occurred_at` 신뢰도가 낮은 외부 이벤트는 source label을 붙임

중복 제거는 무조건 숨기는 것이 아닙니다. 고객 화면에서는 "결제 확인 재시도 중" 하나로 합쳐도 되지만, 운영 화면에서는 5분 동안 4회 실패했다는 사실이 중요할 수 있습니다. 따라서 dedupe 결과와 원본 count를 같이 저장합니다.

### 5) Timeline API에도 성능 예산을 둔다

이력 화면은 장애 때 많이 열립니다. 평소에는 조용하다가 사고가 나면 CS와 운영자가 동시에 조회합니다. 그래서 timeline API에도 별도 예산이 필요합니다.

초기 기준:

- target 단건 timeline p95: 200ms 이하
- page size: 기본 50개, 최대 100개
- 필터 없는 전역 feed: 최근 24시간 또는 1,000건 상한
- operator 검색 기간: 기본 7일, 최대 90일은 async export
- index: `(tenant_id, target_type, target_id, occurred_at desc)`, 보안 feed는 `(tenant_id, visibility, occurred_at desc)`
- payload: 이벤트 1개당 2KB 이하, raw metadata는 별도 상세 조회

이 기준은 [Response Payload Budget](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)과 연결됩니다. Timeline은 보기 편해야 하지만, 모든 metadata를 목록 응답에 넣으면 장애 때 화면 자체가 느려집니다.

## 트레이드오프/주의점

첫째, timeline을 너무 풍부하게 만들면 개인정보 저장소가 하나 더 생깁니다. 고객 이름, 이메일, 주소, 결제 수단, 외부 provider raw response를 이벤트 metadata에 넣으면 검색과 export 경로가 모두 민감해집니다. 기본은 식별자와 reason_code, 필요한 경우 hash 또는 redacted value입니다.

둘째, 감사 로그와 사용자 이력을 같은 테이블로 합치면 처음에는 편하지만 장기적으로 위험합니다. 감사 로그는 조작 방지, 보존, 접근 통제가 핵심이고, 사용자 이력은 읽기 UX와 문구 변경이 핵심입니다. 원본은 강하게, projection은 유연하게 가져가는 편이 좋습니다.

셋째, 모든 상태 변화를 이벤트로 만들 필요는 없습니다. 내부 캐시 갱신, projector heartbeat, batch cursor 이동처럼 운영 판단과 무관한 신호까지 넣으면 중요한 사건이 묻힙니다. 숨겨진 technical event는 metric과 로그로 충분한 경우가 많습니다.

넷째, timeline이 있다는 이유로 source of truth가 바뀌면 안 됩니다. 결제 상태는 결제 원장, 권한 상태는 권한 정책 저장소, 파일 공개 상태는 파일 상태 머신이 기준입니다. Timeline은 판단을 돕는 화면이지 업무 원장을 대신하지 않습니다.

다섯째, 이벤트 문구는 제품 언어입니다. "PG_TIMEOUT"을 그대로 고객에게 보여 주면 불안만 키웁니다. 반대로 운영자에게 "문제가 발생했습니다"만 보여 주면 조치할 수 없습니다. visibility별 문구를 분리해야 합니다.

## 체크리스트 또는 연습

- [ ] 도메인별 timeline 이벤트 타입 10~20개를 카탈로그로 정의했다.
- [ ] 이벤트에는 actor, action/type, target, result, reason_code, visibility, occurred_at, recorded_at, correlation_id가 있다.
- [ ] public/support/operator/security visibility 등급과 마스킹 정책이 분리되어 있다.
- [ ] 원본 이벤트와 timeline projection이 분리되어 있고, projection rebuild가 가능하다.
- [ ] timeline p95 반영 지연, API p95, page size, 보존 기간 기준이 숫자로 정해져 있다.
- [ ] 결제·권한·개인정보·환불 같은 고위험 이벤트는 audit log와 correlation_id로 연결된다.
- [ ] 이벤트 누락 또는 ingestion lag가 있을 때 화면에 지연/불완전 상태를 표시한다.

연습으로 주문 하나를 골라 `ORDER_CREATED`, `PAYMENT_AUTHORIZED`, `DELIVERY_PROVIDER_TIMEOUT`, `REFUND_APPROVED_BY_OPERATOR` 네 이벤트를 설계해 보세요. 각 이벤트에 public/support/operator/security 중 어떤 visibility를 줄지, 고객 화면에는 어떤 문구를 보여 줄지, 감사 로그와 연결해야 하는 필드는 무엇인지 적어 보면 timeline 설계의 감이 빨리 잡힙니다.

## 함께 보면 좋은 글

- [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/)
- [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [Execution Receipt](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)
- [Response Payload Budget](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)
