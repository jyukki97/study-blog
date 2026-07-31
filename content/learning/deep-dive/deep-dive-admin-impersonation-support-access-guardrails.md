---
title: "백엔드 커리큘럼 심화: Admin Impersonation과 Support Access Guardrails, 고객 대신 보기 기능을 안전하게 여는 법"
date: 2026-07-31
draft: false
topic: "Backend Security"
tags: ["Admin Impersonation", "Support Access", "Authorization", "Audit Log", "Privacy", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "CS나 운영자가 고객 화면을 대신 확인해야 할 때 impersonation, just-in-time 권한, 세션 격리, 마스킹, 감사 로그를 어떻게 설계할지 실무 기준으로 정리합니다."
module: "backend-security"
study_order: 1272
key_takeaways:
  - "고객 대신 보기 기능은 편의 기능이 아니라 고객 데이터 접근 권한을 임시로 빌려 쓰는 고위험 운영 경로다."
  - "support access는 actor, subject, reason, scope, expiry, approval, audit evidence를 분리해야 나중에 설명 가능하다."
  - "초기 기준은 read-only, 짧은 TTL, 민감 필드 마스킹, fail-closed audit, break-glass 별도 경로로 잡는 편이 안전하다."
operator_checklist:
  - "impersonation 세션에는 admin actor와 customer subject를 모두 저장하고 일반 로그인 세션과 cookie, token, 권한 캐시를 분리한다."
  - "권한 변경, 결제, export, 메시지 발송, 삭제는 impersonation 중 기본 금지하고 필요하면 별도 approval id를 요구한다."
  - "고객 데이터 열람은 reason code, ticket id, TTL, field mask, audit event, activity projection을 남긴다."
learning_refs:
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "관리자 액션을 나중에 검증 가능한 증거로 남기는 감사 로그 설계입니다."
  - title: "Authorization Models"
    href: "/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/"
    description: "RBAC, ABAC, ReBAC를 어떤 기준으로 선택할지 보는 기본기입니다."
  - title: "Permission Drift Access Review"
    href: "/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/"
    description: "운영 중 권한이 넓어지는 문제를 정기 검토로 잡는 방법입니다."
  - title: "Object-Level Authorization"
    href: "/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/"
    description: "특정 고객 리소스에 대한 객체 단위 접근 검사를 다룹니다."
decision_guide:
  cases:
    - badge: "Read-only impersonation"
      title: "CS가 고객 화면을 재현해야 한다"
      fit: "결제 실패, 설정 오류, 권한 문의처럼 고객 화면 상태를 봐야 하지만 데이터 변경은 필요 없는 경우"
      watchouts: "고객처럼 보이는 세션이 실제 변경 권한까지 가지면 사고 반경이 커진다."
      next_step: "read-only claim, 15분 TTL, 민감 필드 마스킹, ticket id 필수를 적용한다."
    - badge: "Scoped support action"
      title: "운영자가 제한된 수정까지 해야 한다"
      fit: "중복 주문 취소, 잘못된 플랜 복구, 배송 주소 보정처럼 승인된 업무 액션이 필요한 경우"
      watchouts: "일반 admin 권한으로 처리하면 누가 고객 대신 무엇을 바꿨는지 나중에 분리하기 어렵다."
      next_step: "action별 scope와 approval id를 요구하고 execution receipt를 남긴다."
    - badge: "Break-glass"
      title: "장애 대응 중 즉시 접근이 필요하다"
      fit: "대형 장애, 보안 사고, 법적 보존 요청처럼 평상시 approval 흐름을 기다릴 수 없는 경우"
      watchouts: "break-glass를 일상적인 우회 경로로 쓰면 모든 통제가 무력화된다."
      next_step: "짧은 TTL, 사후 24시간 내 리뷰, 별도 알림, 자동 만료를 강제한다."
faqs:
  - question: "관리자 계정에 고객 ID를 넣고 화면을 열면 안 되나요?"
    answer: "초기 구현은 쉬워도 위험합니다. admin actor와 customer subject가 섞이면 권한 캐시, 감사 로그, CS 화면, 고객 활동 이력이 모두 흐려집니다. 별도 support session 모델을 두는 편이 안전합니다."
  - question: "모든 support access에 2인 승인이 필요한가요?"
    answer: "아닙니다. read-only와 마스킹된 저위험 조회는 ticket id와 TTL만으로 충분할 수 있습니다. 결제, 권한, export, 삭제, 외부 전송처럼 되돌리기 어려운 액션에 2인 승인이나 break-glass 사후 리뷰를 걸면 됩니다."
---

고객 지원을 하다 보면 "고객 화면을 제가 한번 볼 수 있을까요?"라는 요구가 거의 반드시 나옵니다. 결제 실패, 구독 플랜 오류, 권한 문의, 알림 미수신, 설정 저장 실패는 로그만으로 설명하기 어렵습니다. 고객이 보는 화면과 운영자가 보는 관리자 화면이 다르면 CS는 스크린샷을 요청하고, 개발자는 DB를 직접 조회하며, 고객은 같은 설명을 여러 번 반복하게 됩니다. 그래서 많은 서비스가 support impersonation, login as user, customer view 같은 기능을 붙입니다.

문제는 이 기능이 생각보다 위험하다는 점입니다. 고객 대신 보기 기능은 단순히 UI를 편하게 여는 기능이 아닙니다. 운영자가 고객 데이터 접근 권한을 임시로 빌려 쓰는 경로입니다. 잘못 만들면 운영자가 고객처럼 결제 취소를 누를 수 있고, 고객 활동 로그에 운영자 행동이 고객 행동처럼 남으며, 감사 요청이 들어왔을 때 "누가 실제로 봤는지"를 설명하지 못합니다. 더 나쁜 경우에는 내부자가 과도한 고객 데이터를 열람해도 탐지하기 어렵습니다.

이 글은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [Authorization Models](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/), [Permission Drift Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/), [Object-Level Authorization](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)와 이어집니다. 핵심은 고객 대신 보기를 "관리자에게 더 강한 권한을 주는 기능"이 아니라 **actor와 subject가 분리된 임시 접근 계약**으로 설계하는 것입니다.

## 이 글에서 얻는 것

- admin actor, customer subject, support session을 분리하는 이유를 이해합니다.
- read-only impersonation, scoped support action, break-glass access를 구분하는 기준을 잡을 수 있습니다.
- reason code, ticket id, TTL, field mask, approval id, audit event를 어떤 순서로 요구할지 정리합니다.
- 고객 화면 재현과 개인정보 보호, 운영 속도 사이의 트레이드오프를 숫자와 조건으로 판단할 수 있습니다.
- 팀에서 바로 쓸 수 있는 support access 체크리스트와 연습 과제를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Impersonation은 로그인 대체가 아니라 이중 주체 세션이다

일반 로그인 세션에는 보통 `user_id`, `role`, `tenant_id`, `session_id`가 들어갑니다. 하지만 support impersonation에는 주체가 두 명입니다. 실제 행동을 시작한 사람은 운영자이고, 화면의 대상은 고객입니다. 이 둘을 한 필드로 합치면 이후 모든 판단이 흐려집니다.

```yaml
support_session:
  support_session_id: "ssn_01K..."
  actor_type: "admin_user"
  actor_id: "admin_123"
  subject_type: "customer_user"
  subject_id: "user_456"
  tenant_id: "tenant_789"
  mode: "READ_ONLY"
  reason_code: "SUPPORT_TICKET"
  ticket_id: "CS-18422"
  scope:
    - "view_account"
    - "view_billing_summary"
    - "view_notification_settings"
  expires_at: "2026-07-31T10:30:00+09:00"
  approval_id: null
```

이 구조에서 `actor_id`는 책임 소재를 나타내고, `subject_id`는 조회 대상과 객체 권한 검사의 기준이 됩니다. `mode`와 `scope`는 할 수 있는 행동을 제한합니다. `reason_code`와 `ticket_id`는 왜 접근했는지 설명합니다. `expires_at`은 권한이 오래 남지 않도록 만듭니다.

초기 기준은 보수적으로 잡습니다.

| 항목 | 권장 시작값 | 이유 |
| --- | --- | --- |
| 기본 모드 | `READ_ONLY` | 고객 대신 보기의 80% 이상은 재현과 확인이 목적 |
| TTL | 15분, 최대 60분 | 열어둔 브라우저 탭과 세션 탈취 위험 축소 |
| ticket id | 필수 | 고객 문의 또는 내부 사건과 연결 |
| 민감 필드 | 기본 마스킹 | 주민번호, 카드, 토큰, 원문 메시지 노출 방지 |
| write action | 기본 금지 | 고객 행위와 운영자 행위 분리 |
| audit | fail-closed | 기록 없이 접근하는 경로 차단 |

여기서 중요한 것은 "운영자가 고객 권한을 가진다"가 아니라 "운영자가 특정 고객 리소스를 제한된 방식으로 본다"입니다. 이 차이가 있어야 [Object-Level Authorization](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)의 객체 단위 검사를 support access에도 적용할 수 있습니다.

### 2) 고객 활동 로그와 관리자 감사 로그는 분리해야 한다

impersonation 중 화면을 열면 고객 활동 로그에 흔적이 남아야 할까요? 답은 "고객 활동처럼 남기면 안 되지만, 고객 지원 이력으로는 보여야 한다"에 가깝습니다. 예를 들어 운영자가 고객의 구독 화면을 조회했다고 해서 고객이 직접 로그인한 것처럼 `user_login` 이벤트를 남기면 보안 알림, 추천 모델, 세션 통계가 오염됩니다. 반대로 아무 흔적도 남기지 않으면 고객은 누가 자신의 데이터를 봤는지 알 수 없습니다.

그래서 로그는 최소 세 층으로 나눕니다.

| 층 | 목적 | 예시 |
| --- | --- | --- |
| audit ledger | 법적·보안 증거 | `support.access.started`, `support.field.viewed` |
| activity projection | 고객·CS가 이해하는 타임라인 | "CS 담당자가 문의 CS-18422 처리 중 계정 설정을 확인함" |
| product telemetry | 제품 분석 | 일반 고객 행동과 분리 또는 제외 |

감사 원장은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)처럼 append-only와 digest를 우선합니다. 활동 타임라인은 [Activity Timeline과 Event Feed](/learning/deep-dive/deep-dive-activity-timeline-event-feed-playbook/)처럼 projection으로 읽기 좋게 만듭니다. 제품 telemetry에는 섞지 않거나 `actor_type=support`로 분리합니다.

감사 이벤트에는 적어도 아래 필드가 필요합니다.

```json
{
  "event_type": "support.access.started",
  "actor_id": "admin_123",
  "subject_id": "user_456",
  "tenant_id": "tenant_789",
  "support_session_id": "ssn_01K...",
  "reason_code": "SUPPORT_TICKET",
  "ticket_id": "CS-18422",
  "scope": ["view_account", "view_billing_summary"],
  "policy_version": "support-access-v7",
  "ip_hash": "sha256:...",
  "device_id": "dev_abc",
  "created_at": "2026-07-31T10:12:00+09:00"
}
```

원문 IP, user agent, before/after 값은 보존 정책과 개인정보 기준에 맞춰 마스킹하거나 digest로 남깁니다. "나중에 증명"과 "필요 이상 수집 금지"를 같이 만족해야 합니다.

### 3) Read-only는 UI 버튼 숨김이 아니라 서버 권한이어야 한다

가장 흔한 실수는 impersonation 모드에서 프론트엔드 버튼만 숨기는 것입니다. 버튼이 숨겨져도 API는 직접 호출될 수 있습니다. 브라우저 console, 오래된 클라이언트, 내부 도구, 자동화 스크립트가 write endpoint를 부르면 서버가 막아야 합니다.

서버에서는 support session claim을 일반 사용자 claim과 분리합니다.

```yaml
auth_context:
  authenticated_actor: "admin_123"
  effective_subject: "user_456"
  support_session_id: "ssn_01K..."
  support_mode: "READ_ONLY"
  allowed_actions:
    - "account.read"
    - "billing.summary.read"
    - "notification.preference.read"
  denied_actions:
    - "payment.refund"
    - "subscription.cancel"
    - "user.email.change"
    - "data.export"
```

권한 검사는 endpoint, domain service, background job 진입점에서 모두 같은 `auth_context`를 읽어야 합니다. 특히 "고객 화면에서 버튼을 눌렀더니 API는 고객 권한으로 실행"되는 구조를 피해야 합니다. support session은 고객 세션이 아니라 관리자 세션의 확장입니다.

실무 기준:

- `GET` 조회도 민감 데이터는 scope 없으면 403
- `POST`, `PATCH`, `DELETE`는 read-only session에서 기본 403
- export, message send, payment/refund, role change는 별도 approval 없으면 403
- background job enqueue는 고객 세션으로 위장하지 않고 actor/subject를 함께 전달
- cache key는 `subject_id`만 쓰지 말고 support mode에 따른 field mask를 반영

이 기준을 코드로 강제하지 않으면 [Permission Drift Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/)에서 다룬 권한 팽창이 support tool에서도 반복됩니다.

### 4) 민감 필드는 field mask와 purpose로 제어한다

고객 대신 보기에서 모든 필드를 그대로 보여줄 필요는 거의 없습니다. CS가 결제 문의를 처리할 때 필요한 것은 카드 전체 번호가 아니라 결제 수단 종류, 마지막 4자리, 실패 코드, 거래 시각입니다. 알림 문의에는 원문 메시지 일부가 필요할 수 있지만, 전체 대화 내역이나 secret token은 필요하지 않습니다.

field mask는 role보다 purpose에 가깝게 설계하는 편이 좋습니다.

| purpose | 허용 필드 | 마스킹 필드 | 기본 TTL |
| --- | --- | --- | --- |
| `BILLING_SUPPORT` | plan, invoice status, last4, failure code | full card, raw provider token | 15분 |
| `LOGIN_SUPPORT` | login time, provider, device summary | access token, refresh token, password hash | 15분 |
| `DELIVERY_SUPPORT` | address city, carrier, tracking status | 상세 주소 일부, 전화번호 일부 | 30분 |
| `SECURITY_INVESTIGATION` | risk event summary, device fingerprint digest | 원문 payload, secret, private note | 60분, 승인 필요 |

필드 마스킹은 프론트엔드 포맷팅으로만 처리하면 안 됩니다. API 응답 자체가 support scope에 맞게 projection되어야 합니다. 같은 endpoint를 공유하더라도 서버 serializer가 `support_context`를 보고 민감 값을 제거해야 합니다. 특히 logs, metadata, custom fields, JSONB extension 필드는 예상 못 한 개인정보가 섞이기 쉽습니다. 이런 확장 필드는 [JSONB Extension Field Schema Governance](/learning/deep-dive/deep-dive-jsonb-extension-field-schema-governance/)와 같은 registry로 관리하는 편이 안전합니다.

### 5) Break-glass는 별도 제품 경로다

장애나 보안 사고에서는 평소 승인 절차를 기다릴 수 없을 때가 있습니다. 그렇다고 일반 impersonation에 "관리자니까 무제한"을 넣으면 안 됩니다. break-glass는 별도 경로여야 합니다.

break-glass 기준 예시는 다음과 같습니다.

| 조건 | 허용 | 필수 통제 |
| --- | --- | --- |
| SEV1 장애 대응 | 제한적 고객 상태 조회 | incident id, 30분 TTL, oncall owner |
| 보안 사고 조사 | 보안 이벤트와 관련 리소스 조회 | security case id, 2인 사후 리뷰 |
| 법적 보존 요청 | 지정 리소스 export | legal ticket, 승인자, 보존 정책 |
| 대량 고객 영향 확인 | 집계 조회 | raw PII 금지, 샘플링, 쿼리 저장 |

break-glass의 핵심은 접근 자체보다 사후 처리입니다. 접근 후 24시간 안에 owner review를 요구하고, reason이 부적절하면 권한 회수와 교육 또는 징계 절차로 이어져야 합니다. break-glass가 월 1건 이하인 팀과 주 10건인 팀은 운영 성숙도가 다릅니다. 주 10건이라면 제품 기능이나 관리자 도구가 부족해서 emergency path가 일상 업무가 된 것입니다.

## 실무 적용

### 1) support access state machine을 만든다

기능을 바로 붙이기 전에 상태를 먼저 정합니다.

```text
REQUESTED
  -> APPROVED
  -> ACTIVE
  -> EXPIRED
  -> REVIEWED

REQUESTED
  -> DENIED

ACTIVE
  -> REVOKED
  -> BREAK_GLASS_REVIEW_REQUIRED
```

read-only access는 `REQUESTED -> ACTIVE`를 자동으로 열 수 있습니다. 단, ticket id와 reason code가 유효하고 actor가 support role이어야 합니다. write action은 `APPROVED` 없이는 `ACTIVE`로 가지 못하게 합니다. break-glass는 `ACTIVE`가 될 수 있지만 종료 후 `BREAK_GLASS_REVIEW_REQUIRED`를 반드시 거칩니다.

이 상태 모델은 [Operational State Machine Design](/learning/deep-dive/deep-dive-operational-state-machine-design/)처럼 운영 화면과 audit event의 기준이 됩니다. 상태 없이 boolean `is_impersonating=true`만 두면 만료, 회수, 사후 검토, 부분 승인 같은 요구를 나중에 붙이기 어렵습니다.

### 2) 세션과 토큰을 분리한다

support session은 고객 로그인 token을 재사용하지 않습니다. 고객의 refresh token을 발급하거나 고객 세션 cookie를 만들면 안 됩니다. 대신 admin session 위에 support session id를 얹고, 서버가 매 요청에서 actor와 subject를 함께 해석합니다.

권장 구조:

- admin browser cookie: 운영자 본인 인증
- support session id: 특정 고객과 scope를 가리키는 짧은 수명 id
- effective auth context: 서버에서 매 요청마다 계산
- customer session store: 절대 수정하지 않음
- 권한 캐시: support mode와 field mask를 포함해 별도 key 사용

TTL은 짧게 시작합니다. 일반 조회는 15분, 긴 조사도 60분을 넘기지 않는 편이 좋습니다. 장시간 작업이 필요하면 세션을 연장하지 말고 새 ticket reason으로 다시 요청하게 만듭니다. 자동 연장은 편하지만 "열어둔 탭"이 오래 살아남습니다.

### 3) write action은 support action API로 분리한다

고객 화면의 기존 API를 그대로 write 가능하게 열지 않습니다. 운영자가 구독을 취소해야 한다면 `POST /customer/subscription/cancel`을 고객 대신 호출하는 것이 아니라 `POST /admin/support-actions/cancel-subscription`처럼 support action API를 둡니다. 이 API는 approval id, reason, subject, expected current state를 요구합니다.

```json
{
  "subject_user_id": "user_456",
  "action": "subscription.cancel",
  "reason_code": "CUSTOMER_REQUEST_CONFIRMED",
  "ticket_id": "CS-18422",
  "approval_id": "APR-9912",
  "expected_subscription_status": "ACTIVE",
  "idempotency_key": "CS-18422:subscription.cancel:user_456"
}
```

응답에는 execution receipt를 남깁니다.

```json
{
  "support_action_id": "act_01K...",
  "status": "APPLIED",
  "changed_resource_ids": ["sub_123"],
  "audit_event_id": "aud_01K...",
  "rollback_hint": "restore_subscription_until:2026-08-07",
  "applied_at": "2026-07-31T10:18:00+09:00"
}
```

이 구조는 [Execution Receipt Operations](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)와 연결됩니다. 운영자가 버튼을 눌렀다는 사실보다, 어떤 리소스가 어떤 근거로 바뀌었고 되돌릴 수 있는지가 중요합니다.

### 4) 대시보드는 access volume보다 이상 패턴을 본다

support access가 늘어나는 것 자체는 나쁜 신호가 아닐 수 있습니다. 고객 수가 늘면 문의도 늘기 때문입니다. 대신 이상 패턴을 봐야 합니다.

초기 지표:

- `support_session_started_total{actor,reason_code,scope}`
- `support_session_duration_seconds`
- `support_denied_action_total{action,reason}`
- `support_sensitive_field_view_total{field_group,reason_code}`
- `support_break_glass_total{actor,incident_id}`
- `support_access_without_ticket_total`
- `support_access_after_hours_total`
- `support_action_receipt_missing_total`

경보 기준 예시는 보수적으로 잡습니다.

| 조건 | 조치 |
| --- | --- |
| ticket id 없는 접근 1건 이상 | 즉시 조사, 세션 차단 |
| 동일 actor가 하루 30명 초과 고객 조회 | manager review |
| break-glass 주 3건 초과 | 제품/운영 도구 부족 여부 점검 |
| denied write action 반복 5건 이상 | 권한 우회 시도 또는 UX 오류 조사 |
| sensitive field view가 전주 대비 2배 | 목적별 마스킹 정책 재검토 |
| expired session 사용 시도 1건 이상 | 클라이언트/세션 만료 처리 점검 |

숫자는 조직 규모에 맞게 조정해야 합니다. 하지만 "0건이어야 하는 지표"는 분명합니다. ticket 없는 접근, audit 없는 접근, approval 없는 고위험 write는 0이어야 합니다.

## 트레이드오프/주의점

첫째, 보안을 강하게 걸수록 CS 속도는 느려집니다. 모든 조회에 2인 승인을 요구하면 고객 응대가 막힙니다. 그래서 위험 등급을 나눠야 합니다. read-only, 마스킹, 짧은 TTL, ticket id가 있는 조회는 자동 허용하고, 결제/권한/export/delete만 강한 승인으로 올리는 편이 현실적입니다.

둘째, 고객에게 support access를 모두 노출하면 불안감을 줄 수 있습니다. 반대로 전혀 노출하지 않으면 신뢰 문제가 생깁니다. 고객용 activity timeline에는 "지원 담당자가 문의 처리를 위해 계정 설정을 확인함"처럼 목적과 시간을 보여주고, 내부 audit에는 훨씬 자세한 증거를 남기는 식으로 projection을 나눕니다.

셋째, 권한 캐시가 사고를 만들 수 있습니다. 일반 사용자 권한 결과를 캐시한 뒤 support mode에서 재사용하면 마스킹이 빠질 수 있습니다. 캐시 키에는 actor type, support mode, scope, policy version을 포함하거나 support 응답은 별도 projection cache를 씁니다.

넷째, break-glass는 반드시 측정해야 합니다. 긴급 경로가 자주 쓰이면 긴급이 아닙니다. 제품 기능이 부족하거나 승인 정책이 너무 느리거나 운영팀이 일반 절차를 신뢰하지 않는다는 뜻입니다. break-glass는 편의 버튼이 아니라 조직 부채를 드러내는 센서입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] support session에 `actor_id`, `subject_id`, `tenant_id`, `reason_code`, `ticket_id`, `scope`, `expires_at`이 있다.
- [ ] 고객 로그인 token이나 cookie를 재사용하지 않는다.
- [ ] read-only mode는 서버 권한 검사에서 강제된다.
- [ ] 결제, 권한, export, 삭제, 외부 전송은 별도 support action API와 approval id를 요구한다.
- [ ] 민감 필드는 purpose별 field mask로 서버에서 제거한다.
- [ ] audit event는 fail-closed이고 activity projection과 product telemetry를 분리한다.
- [ ] break-glass는 짧은 TTL, incident id, 사후 리뷰, 별도 경보를 가진다.
- [ ] ticket 없는 접근, audit 없는 접근, approval 없는 고위험 write는 0건 목표로 감시한다.

### 연습

현재 서비스의 관리자 기능 하나를 고르세요. 예를 들어 "고객 구독 상태 확인"이나 "배송지 수정"이면 충분합니다. 그 기능을 아래 표로 다시 설계해 봅니다.

| 항목 | 작성할 내용 |
| --- | --- |
| actor | 누가 접근하는가 |
| subject | 어느 고객 또는 테넌트인가 |
| reason | 어떤 ticket, incident, legal case인가 |
| scope | 조회와 수정 중 무엇을 허용하는가 |
| TTL | 몇 분 동안 허용하는가 |
| mask | 어떤 필드를 숨기는가 |
| approval | 어떤 action부터 승인 필요한가 |
| receipt | 실행 후 어떤 증거를 남기는가 |

숫자를 꼭 넣습니다. 예를 들어 `read-only 15분`, `payment refund는 approval 1명`, `customer export는 approval 2명`, `break-glass는 30분 TTL과 24시간 내 사후 리뷰`처럼 시작하면 됩니다. 이 표를 만들었는데 "그냥 admin이면 다 가능"이라는 줄이 남아 있다면, 그 부분이 오늘 고쳐야 할 위험입니다.
