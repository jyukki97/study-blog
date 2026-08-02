---
title: "백엔드 커리큘럼 심화: Step-Up Authorization, 고위험 액션 전에 다시 확인하는 서버 권한 계약"
date: 2026-08-02
draft: false
topic: "Backend Security"
tags: ["Step-Up Authorization", "Reauthentication", "Authorization", "Session Security", "Audit Log", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "이미 로그인한 사용자가 결제, 권한 변경, 데이터 export, 삭제 같은 고위험 액션을 실행하기 전에 재인증과 승인 토큰을 어떤 서버 계약으로 설계할지 정리합니다."
module: "backend-security"
study_order: 1274
keywords: ["step-up authorization", "reauthentication", "high risk action", "auth_time", "transaction binding", "재인증", "고위험 액션"]
key_takeaways:
  - "Step-up authorization은 로그인 여부를 다시 묻는 기능이 아니라 특정 고위험 액션에 대해 최근 강인증, 대상, 금액, 범위, 감사 증거를 묶는 서버 계약이다."
  - "재인증 성공 사실은 짧은 TTL의 action-bound token으로 표현하고, 결제·권한·export·삭제 API는 이 토큰 없이는 fail-closed로 막아야 한다."
  - "좋은 기준은 사용자 마찰 최소화가 아니라 피해 비용이 큰 액션부터 최신성, 의도, 대상 바인딩, 감사 로그를 강제하는 것이다."
operator_checklist:
  - "고위험 액션 목록을 결제/권한/export/삭제/외부전송/보안설정 변경으로 분류하고 action risk tier를 붙인다."
  - "step-up token은 actor, action, target, amount 또는 scope, issued_at, expires_at, challenge_method, request_id에 바인딩한다."
  - "재인증 실패, 우회 시도, 만료 토큰 사용, 대상 불일치를 별도 metric과 감사 이벤트로 남긴다."
  - "관리자·support access·break-glass 경로도 일반 사용자 step-up보다 약한 예외가 되지 않게 별도 정책을 둔다."
learning_refs:
  - title: "Passkey + Device-Bound Session"
    href: "/posts/2026-04-06-passkey-device-bound-session-architecture-trend/"
    description: "로그인 이후 세션 무결성과 고위험 액션 전 강인증 기준을 보는 글입니다."
  - title: "Admin Impersonation과 Support Access"
    href: "/learning/deep-dive/deep-dive-admin-impersonation-support-access-guardrails/"
    description: "운영자 고객 대신 보기와 break-glass 접근의 별도 통제를 다룹니다."
  - title: "Object-Level Authorization"
    href: "/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/"
    description: "대상 리소스 단위 권한 검사를 고위험 액션에도 적용하는 기본기입니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "재인증과 승인 결과를 나중에 검증 가능한 운영 증거로 남기는 방법입니다."
  - title: "Token Exchange와 Downscoped Token"
    href: "/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/"
    description: "넓은 세션 권한을 짧고 좁은 실행 권한으로 바꾸는 패턴입니다."
decision_guide:
  intro: "재인증은 모든 버튼에 붙이면 피로해지고, 너무 늦게 붙이면 세션 탈취와 내부 오용을 막지 못합니다. 액션의 되돌리기 비용과 노출 데이터의 민감도로 우선순위를 잡습니다."
  cases:
    - badge: "Low risk"
      title: "읽기 전용 설정 조회와 일반 프로필 수정"
      fit: "실패해도 금전·권한·개인정보 대량 노출로 이어지지 않는 일상 액션"
      watchouts: "최근 로그인만 보고 모든 설정 변경을 허용하면 이메일·MFA 변경 같은 경로가 섞일 수 있다."
      next_step: "일반 세션으로 허용하되 보안 설정 변경은 별도 tier로 분리한다."
    - badge: "Step-up required"
      title: "결제, 권한, 보안 설정, 민감 데이터 export"
      fit: "세션 탈취나 실수 한 번으로 되돌리기 어려운 손실이 나는 액션"
      watchouts: "재인증 token이 액션과 대상에 바인딩되지 않으면 한 번 통과한 token이 다른 작업에 재사용될 수 있다."
      next_step: "15분 이내 강인증, 3~5분 action token, 대상 바인딩, 감사 로그를 강제한다."
    - badge: "Approval plus step-up"
      title: "관리자 대량 변경, 법무 export, break-glass"
      fit: "사용자 한 명이 아니라 테넌트·조직·대량 데이터에 영향을 주는 액션"
      watchouts: "승인 화면과 실제 실행 대상이 달라지는 TOCTOU 문제가 생기기 쉽다."
      next_step: "승인 직전 서버 재조회, 2인 승인, 실행 영수증, 사후 리뷰 SLA를 붙인다."
faqs:
  - question: "이미 MFA로 로그인했는데 왜 다시 인증해야 하나요?"
    answer: "로그인 시점의 MFA는 세션 시작을 보호합니다. Step-up은 특정 액션 직전에 사용자의 현재 의도와 실행 대상을 다시 확인합니다. 세션 탈취, 자리를 비운 브라우저, 오래 열린 관리자 탭을 줄이려면 두 기준이 모두 필요합니다."
  - question: "비밀번호 재입력만 요구하면 충분한가요?"
    answer: "대부분 충분하지 않습니다. 피싱에 약한 비밀번호보다 passkey, platform authenticator, OTP, device-bound challenge처럼 위험도에 맞는 강도를 선택하고, 결과를 액션 바인딩 토큰으로 제한해야 합니다."
---

사용자가 로그인했다는 사실은 중요하지만, 그 사실만으로 모든 행동을 허용하면 위험합니다. 같은 로그인 세션 안에서도 프로필 닉네임 변경과 정산 파일 export는 전혀 다른 액션입니다. 전자는 잘못돼도 되돌리기 쉽지만, 후자는 고객 데이터 노출이나 금전 사고로 이어질 수 있습니다. 문제는 많은 백엔드가 이 차이를 `isAuthenticated()` 하나로 뭉갠다는 점입니다.

Step-up authorization은 이 간격을 메우는 설계입니다. 이미 로그인한 사용자에게 고위험 액션 직전에 더 강한 인증 또는 승인을 요구하고, 그 결과를 짧은 수명의 실행 권한으로 바꿉니다. 핵심은 "한 번 더 비밀번호를 물어보자"가 아닙니다. **누가, 어떤 액션을, 어떤 대상에, 얼마만큼, 언제 실행하려는지**를 서버가 확인 가능한 계약으로 묶는 것입니다.

이 글은 [Passkey + Device-Bound Session](/posts/2026-04-06-passkey-device-bound-session-architecture-trend/), [Admin Impersonation과 Support Access](/learning/deep-dive/deep-dive-admin-impersonation-support-access-guardrails/), [Object-Level Authorization](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와 이어집니다. 인증은 입구를 지키고, 인가는 리소스를 지키며, step-up은 되돌리기 어려운 행동 직전의 의도와 최신성을 지킵니다.

## 이 글에서 얻는 것

- 로그인 세션, 재인증, step-up authorization, approval gate의 역할을 구분합니다.
- 고위험 액션을 어떤 숫자와 조건으로 분류할지 기준을 잡습니다.
- `auth_time`, `action_bound_token`, `target`, `scope`, `expires_at`을 이용해 서버에서 검증 가능한 재인증 계약을 설계합니다.
- 세션 탈취, 열린 관리자 탭, support access, break-glass 상황에서 어떤 액션을 fail-closed로 막을지 판단할 수 있습니다.
- 팀에서 바로 쓸 수 있는 체크리스트와 연습 과제를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 인증 세션은 넓고, 고위험 액션은 좁아야 한다

일반 세션은 사용자의 대부분 활동을 처리합니다. 페이지 조회, 검색, 장바구니 수정, 알림 설정 같은 액션에 매번 강인증을 요구하면 서비스는 쓰기 어려워집니다. 하지만 같은 세션으로 아래 액션까지 모두 허용하면 공격자에게 너무 넓은 권한을 줍니다.

| 액션 | 사고 비용 | Step-up 기준 |
| --- | --- | --- |
| 비밀번호·MFA 변경 | 계정 장악 | 최근 15분 내 강인증 필수 |
| 결제 수단 추가·환불 | 금전 손실 | 금액·결제수단 바인딩 token |
| 조직 관리자 권한 부여 | 권한 확대 | 2인 승인 또는 owner step-up |
| 고객 데이터 export | 개인정보 유출 | 목적·ticket·대상 범위 바인딩 |
| API key 발급 | 장기 권한 노출 | scope 축소와 즉시 감사 로그 |
| 계정 삭제·테넌트 삭제 | 복구 어려움 | 재인증, 대기 시간, 취소 경로 |

실무에서는 액션을 최소 3단계로 나눕니다.

- `R0`: 일반 세션으로 충분한 낮은 위험 액션
- `R1`: 최근 로그인 또는 최근 강인증이 필요한 보안 관련 액션
- `R2`: action-bound step-up token이 필요한 되돌리기 어려운 액션
- `R3`: step-up에 더해 별도 승인, 지연 실행, 사후 리뷰가 필요한 대량·관리자 액션

처음부터 완벽한 risk engine을 만들 필요는 없습니다. 먼저 결제, 권한, export, 삭제, API key, 보안 설정 변경을 `R2` 이상으로 분리하면 됩니다. 나머지는 사고 사례와 지표를 보며 조정합니다.

### 2) `auth_time`만으로는 부족하다

OIDC나 세션 시스템에는 사용자가 언제 인증했는지 나타내는 `auth_time` 성격의 값이 있을 수 있습니다. 이 값은 유용합니다. 예를 들어 "15분 안에 passkey로 인증한 사용자만 보안 설정 변경 가능" 같은 정책을 만들 수 있습니다. 하지만 `auth_time`만 보면 어떤 액션을 위해 인증했는지 알 수 없습니다.

예를 들어 사용자가 이메일 변경을 위해 재인증했는데, 같은 브라우저 탭에서 곧바로 대량 export API를 호출한다면 이 인증을 재사용해도 될까요? 일반적으로 안 됩니다. 인증 최신성은 맞지만, 의도와 대상이 다릅니다. 그래서 고위험 액션에는 `auth_time` 위에 **action-bound token**을 둡니다.

```json
{
  "step_up_token_id": "sut_01K...",
  "actor_id": "user_123",
  "action": "billing.refund.create",
  "target_type": "payment",
  "target_id": "pay_789",
  "amount_limit": 50000,
  "challenge_method": "passkey",
  "issued_at": "2026-08-02T10:11:00+09:00",
  "expires_at": "2026-08-02T10:16:00+09:00",
  "request_id": "req_abc",
  "policy_version": "stepup-v4"
}
```

이 token은 넓은 권한이 아니라 좁은 실행 허가입니다. `billing.refund.create`에만 쓰이고, `pay_789`에만 적용되며, 5분 뒤 만료됩니다. 같은 사용자가 같은 세션에서 다른 결제 건을 환불하려면 다시 확인해야 합니다. 이 방식은 [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/)의 사고방식과 닮았습니다. 넓은 세션을 짧고 좁은 실행 권한으로 바꾸는 것입니다.

### 3) 재인증은 UI가 아니라 서버 검증이어야 한다

프론트엔드에서 "비밀번호를 다시 입력하세요" 모달을 띄우는 것만으로는 충분하지 않습니다. 공격자는 API를 직접 호출할 수 있고, 오래된 클라이언트는 모달 로직을 갖고 있지 않을 수 있습니다. 서버는 고위험 endpoint에서 step-up token을 직접 검증해야 합니다.

검증 순서는 보통 아래와 같습니다.

1. 일반 세션이 유효한지 확인한다.
2. actor가 기본 권한을 갖는지 확인한다.
3. 대상 리소스에 대한 [객체 단위 권한](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)을 확인한다.
4. 액션 risk tier가 `R2` 이상인지 확인한다.
5. step-up token의 actor, action, target, scope, TTL, challenge method를 검증한다.
6. 실행 직전 대상 상태를 다시 조회한다.
7. 비즈니스 액션과 감사 로그를 같은 흐름으로 남긴다.

여기서 6번이 중요합니다. 사용자가 승인 화면을 본 뒤 실행 버튼을 누르기 전까지 대상이 바뀔 수 있습니다. 가격, 권한, 수량, 데이터 범위가 승인 시점과 실행 시점에 다르면 token을 거부하거나 재확인을 요구해야 합니다. 이 문제는 배포 승인 UI나 관리자 액션에서도 흔한 TOCTOU 문제입니다.

### 4) Challenge method는 액션 위험도에 맞춰야 한다

모든 step-up이 같은 강도일 필요는 없습니다. 낮은 위험의 보안 설정 조회에는 비밀번호 재입력이 충분할 수 있지만, 관리자 권한 부여나 대량 export에는 passkey, hardware key, 관리자 승인, device-bound 조건이 더 적합합니다.

| 위험도 | 예시 | 권장 challenge |
| --- | --- | --- |
| R1 | 이메일 변경, 비밀번호 변경 | 최근 15분 내 MFA 또는 passkey |
| R2 | 환불, API key 발급, 민감 export | passkey 또는 OTP + action-bound token |
| R3 | 관리자 권한 부여, 테넌트 삭제 | passkey + 2인 승인 + 지연 실행 |
| Break-glass | 장애·보안 사고 긴급 접근 | incident id + 짧은 TTL + 사후 24시간 리뷰 |

비밀번호는 여전히 fallback으로 쓸 수 있지만, 고위험 액션의 기본값으로는 약합니다. 세션 탈취와 피싱을 함께 고려하면 [Passkey + Device-Bound Session](/posts/2026-04-06-passkey-device-bound-session-architecture-trend/)처럼 피싱 저항성이 있는 인증을 우선해야 합니다. 단, UX 실패율도 봐야 합니다. step-up 정상 완료율이 85% 아래로 떨어지면 보안 강화가 아니라 장애에 가까워질 수 있습니다.

### 5) 실패와 우회 시도는 product event가 아니라 security event다

재인증 실패를 단순 validation error로만 보면 공격 신호를 놓칩니다. 특히 아래 이벤트는 별도 metric과 감사 로그로 남겨야 합니다.

- 만료된 step-up token으로 고위험 API 호출
- token의 action 또는 target 불일치
- 같은 세션에서 step-up 실패 3회 이상
- support access 중 금지된 write action 호출
- 새 device 또는 새 region에서 API key 발급 시도
- 승인 화면의 대상과 실행 직전 대상 불일치

초기 경보 기준은 보수적으로 잡습니다.

| 지표 | 출발 기준 |
| --- | --- |
| `step_up_required_total` | 액션·엔드포인트별 추적 |
| `step_up_failure_rate` | 10분 동안 20% 초과 시 UX·공격 신호 분리 |
| `step_up_token_mismatch_total` | 1건 이상이면 보안 이벤트 |
| `high_risk_action_without_step_up_total` | 0건 목표 |
| `support_write_denied_total` | 주간 증가율 2배 이상이면 권한 정책 리뷰 |

고위험 액션은 성공뿐 아니라 거부도 중요합니다. 거부 로그가 없으면 "막았다"는 사실을 나중에 증명할 수 없습니다.

## 실무 적용

### 1) 고위험 액션 카탈로그를 만든다

처음 할 일은 코드가 아니라 목록화입니다. 모든 API를 다 정리하려 하지 말고 사고 비용이 큰 액션부터 20개만 뽑습니다.

```yaml
high_risk_actions:
  - action: "user.mfa.disable"
    tier: "R2"
    challenge: "passkey_or_totp"
    max_token_ttl_seconds: 300
    target_binding: ["user_id"]
    audit: "fail_closed"
  - action: "billing.refund.create"
    tier: "R2"
    challenge: "passkey"
    max_token_ttl_seconds: 300
    target_binding: ["payment_id", "amount"]
    audit: "fail_closed"
  - action: "tenant.data.export"
    tier: "R3"
    challenge: "passkey_plus_approval"
    max_token_ttl_seconds: 180
    target_binding: ["tenant_id", "dataset", "date_range"]
    audit: "fail_closed"
```

카탈로그에는 owner도 붙입니다. 보안팀이 정책을 소유하더라도 결제 환불의 실제 위험과 예외는 결제 도메인 팀이 가장 잘 압니다. owner 없는 고위험 액션은 나중에 예외가 쌓입니다.

### 2) Step-up token을 일회성 또는 짧은 재사용으로 제한한다

가장 안전한 방식은 token을 한 번만 쓰게 만드는 것입니다. 다만 사용자가 같은 화면에서 같은 액션을 retry해야 할 수 있으므로, 실무에서는 좁은 재사용을 허용하기도 합니다.

- 단일 결제 환불: 일회성 권장
- 같은 보안 설정 저장 retry: 3분 이내 같은 payload면 재사용 가능
- 대량 export 승인: 실행 job 하나에만 바인딩
- 관리자 권한 변경: 대상 user와 role이 같을 때만 재사용

payload hash를 token에 넣으면 승인한 내용과 실행 내용이 달라지는 문제를 줄일 수 있습니다.

```text
payload_hash = sha256(canonical_json({
  action,
  target_id,
  amount,
  scope,
  reason_code
}))
```

실행 API는 현재 요청의 canonical payload hash를 다시 계산해서 token의 hash와 비교합니다. 다르면 409 또는 재승인 요구로 닫습니다.

### 3) Support access와 break-glass를 일반 사용자보다 약하게 만들지 않는다

운영자 기능은 종종 "내부니까 괜찮다"는 이유로 사용자보다 약한 인증을 갖습니다. 반대로 가야 합니다. 운영자·CS·관리자는 더 많은 고객 데이터와 더 강한 액션을 만지므로 step-up 기준도 더 엄격해야 합니다.

기준 예시:

- read-only support access: ticket id, 15분 TTL, 민감 필드 마스킹
- support 중 write action: 별도 approval id와 step-up token 필요
- break-glass: incident id, 30분 TTL, 사후 24시간 내 owner review
- 관리자 권한 부여: actor와 approver 분리, 같은 사람이 요청·승인 금지

이 부분은 [Admin Impersonation과 Support Access](/learning/deep-dive/deep-dive-admin-impersonation-support-access-guardrails/)와 직접 이어집니다. 고객 대신 보기 기능은 편의 UI가 아니라 임시 접근 계약입니다.

### 4) 배포는 shadow와 enforce를 나눠 간다

Step-up을 한 번에 강제하면 고객 지원 문의가 늘고 내부 운영이 막힐 수 있습니다. 먼저 shadow mode로 "지금 정책이었다면 어떤 API가 막혔을지"를 봅니다.

권장 도입 순서:

1. 1주차: 고위험 액션 카탈로그와 shadow metric 추가
2. 2주차: 보안 설정 변경, API key 발급, 환불부터 step-up UI 추가
3. 3주차: 서버 enforce를 `R2` 액션에 적용
4. 4주차: support access와 관리자 액션에 approval plus step-up 적용
5. 5주차 이후: 실패율, 문의량, 우회 시도, 사고 지표를 보며 tier 조정

롤백 기준도 필요합니다. 정상 사용자의 step-up 완료율이 80% 미만으로 떨어지거나 특정 클라이언트 버전에서 실패율이 30%를 넘으면 해당 클라이언트는 임시 완화할 수 있습니다. 단, 완화도 policy exception으로 남기고 만료일을 둬야 합니다.

## 트레이드오프/주의점

첫째, 재인증은 보안을 올리지만 사용자 마찰도 만듭니다. 그래서 "중요해 보이는 모든 액션"이 아니라 실제 피해 비용이 큰 액션부터 적용해야 합니다. 매번 challenge가 뜨면 사용자는 기계적으로 통과하고, 보안 신호는 무뎌집니다.

둘째, action-bound token은 구현 복잡도를 늘립니다. action 이름, target id, payload hash, TTL, 재사용 정책을 관리해야 합니다. 하지만 이 비용을 피하면 한 번 통과한 재인증이 다른 액션에 재사용되는 더 큰 위험이 생깁니다.

셋째, risk engine을 과신하면 안 됩니다. IP, device, geolocation은 탐지 보조 신호입니다. 고위험 액션의 기본 통제는 명시적 step-up과 서버 권한 검사여야 합니다. 위험 신호가 없다고 해서 export나 권한 변경을 일반 세션만으로 허용하면 안 됩니다.

넷째, 관리자 예외가 가장 약한 고리가 되기 쉽습니다. 일반 사용자는 passkey를 요구하면서 내부 운영자는 shared admin 계정으로 모든 일을 처리하면 설계가 뒤집힙니다. 내부 액션일수록 actor, reason, approval, audit evidence가 더 중요합니다.

의사결정 우선순위는 **되돌리기 비용 > 데이터 민감도 > 권한 확대 가능성 > 사용자 빈도 > 구현 편의성** 순서가 안전합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 고위험 액션 20개가 `R1/R2/R3`로 분류되어 있다.
- [ ] `R2` 이상 액션은 서버에서 step-up token을 검증한다.
- [ ] token은 actor, action, target, payload hash, TTL, challenge method에 바인딩된다.
- [ ] 승인 화면과 실행 API가 같은 canonical payload를 검증한다.
- [ ] support access와 break-glass에도 step-up 또는 approval 기준이 있다.
- [ ] 재인증 실패, token mismatch, 만료 token 사용, 금지 action 호출이 감사 로그로 남는다.
- [ ] shadow mode와 enforce mode의 전환 기준, 롤백 기준이 문서화되어 있다.

### 연습

1. 현재 서비스의 API 중 결제, 권한, export, 삭제, API key, 보안 설정 변경에 해당하는 endpoint를 모두 적고 `R1/R2/R3`를 붙여 보세요.
2. `tenant.data.export` 액션 하나를 골라 step-up token payload를 설계해 보세요. `tenant_id`, `dataset`, `date_range`, `reason_code`, `payload_hash`, `expires_at`이 들어가야 합니다.
3. 공격자가 열린 관리자 브라우저 탭에서 API key를 발급하려는 상황을 가정하고, 일반 세션 검증, object authorization, step-up token, audit log 중 어느 단계에서 막히는지 순서도를 그려 보세요.

## 관련 글

- [Passkey + Device-Bound Session](/posts/2026-04-06-passkey-device-bound-session-architecture-trend/)
- [Admin Impersonation과 Support Access](/learning/deep-dive/deep-dive-admin-impersonation-support-access-guardrails/)
- [Object-Level Authorization](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)
- [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/)
