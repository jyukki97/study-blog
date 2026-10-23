---
title: "백엔드 커리큘럼 심화: Account Recovery Evidence, 지원자 우회를 포함한 계정 복구를 안전한 상태 전이로 설계하는 법"
date: 2026-10-23T10:06:00+09:00
lastmod: 2026-10-23T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["Account Recovery", "Authentication", "Identity Proofing", "Support Operations", "Session Revocation", "Backend Security"]
categories: ["Backend Deep Dive", "Security"]
series: "백엔드 딥다이브"
keywords: ["account recovery security", "support override", "identity proofing", "account takeover prevention", "recovery evidence"]
description: "계정 복구를 비밀번호 재설정 메일 하나가 아니라 증거 수집, 위험 분류, 지원자 우회, 권한 회수, 사후 통지로 이어지는 상태 전이로 설계하는 실무 기준을 정리합니다."
summary: "복구 경로는 평소 로그인보다 약한 인증 수단을 허용하기 때문에 계정 탈취자가 가장 먼저 노리는 경계가 된다. 이메일 링크·지원자 확인·MFA 재등록을 각각의 강한 인증으로 오인하지 말고, 회수할 권한과 남길 증거를 포함한 recovery case로 처리해야 한다."
module: "backend-security"
study_order: 1262
key_takeaways:
  - "계정 복구는 인증 실패의 예외 처리가 아니라 별도 위험 모델과 상태 전이를 가진 고위험 업무 흐름이다."
  - "지원자가 MFA를 해제하거나 연락처를 바꾸는 행위는 독립된 증거·대기 시간·알림·감사 로그가 필요한 권한 변경이다."
  - "복구 성공의 완료 조건은 새 비밀번호 설정이 아니라 이전 세션·refresh token·복구 토큰의 회수와 사용자 통지까지 끝난 상태다."
operator_checklist:
  - "복구 요청, 증거, 검토자, 정책 버전, 위험 점수, 세션 회수 결과를 하나의 recovery case ID에 연결한다."
  - "이메일 주소·MFA·관리자 권한·결제 수단을 동시에 바꾸는 요청에는 자동 복구를 허용하지 않고 독립 증거와 지연 승격을 요구한다."
  - "지원자 override는 승인자와 실행자를 분리하고, 원문 신분증·비밀번호·MFA 비밀을 티켓이나 애플리케이션 로그에 저장하지 않는다."
---

비밀번호 재설정 메일을 받을 수 있으면 계정을 되찾을 수 있다는 설계는 구현은 간단하지만, 실제 공격 모델에서는 가장 약한 고리가 되기 쉽습니다. 이메일 계정 자체가 탈취됐거나, 공격자가 고객지원 채널에서 급한 사정을 만들어 MFA 해제를 요청하거나, 오래된 전화번호·청구 정보 일부를 알고 있을 수 있습니다. 특히 평소 로그인에는 passkey나 MFA를 요구하면서 복구에서는 이메일 링크 하나로 모든 인증 수단을 교체하게 하면, 복구 기능이 전체 인증 체계를 우회하는 뒷문이 됩니다.

이 글은 [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/), [이메일 검증 토큰의 재사용·남용 방지](/learning/deep-dive/deep-dive-email-verification-token-replay-abuse-playbook/), [디바이스 세션 레지스트리와 폐기](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/), [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)을 계정 복구 경로로 연결합니다. 목표는 사용자를 불필요하게 막는 것이 아니라, **평소보다 약한 증거로 권한을 되돌려 줄 때 무엇을 더 확인하고 무엇을 회수해야 하는지**를 운영 가능한 계약으로 만드는 것입니다.

## 이 글에서 얻는 것

- 비밀번호 재설정, MFA 분실, 이메일 변경, 지원자 override를 하나의 "복구"로 뭉개지 않고 위험도별 상태 전이로 나누는 기준을 얻습니다.
- 공격자가 이미 아는 개인정보와 실제 계정 소유를 증명하는 독립 증거를 구분합니다.
- 복구 요청을 자동 처리해도 되는 경우와 사람 검토·대기 시간·추가 인증으로 올려야 하는 경우를 정합니다.
- 기존 세션과 복구 수단을 회수하고 사용자에게 알리는 완료 조건을 설계합니다.

## 핵심 개념/이슈

### 1) 계정 복구는 로그인 실패의 fallback이 아니라 별도 권한 승격이다

복구 요청은 "비밀번호를 잊었다"는 문제처럼 보이지만, 실제로는 인증 수단을 교체하고 새 세션을 발급하는 강한 권한입니다. 복구 링크를 사용해 비밀번호를 바꾼 뒤 기존 MFA를 제거하거나 새 이메일을 연결할 수 있다면, 그 링크는 평소 로그인보다 더 넓은 권한을 갖습니다. 따라서 `password_reset`, `mfa_reenrollment`, `primary_email_change`, `support_override`를 같은 endpoint나 같은 성공 기준으로 처리하면 안 됩니다.

최소 상태는 `requested → evidence_collected → risk_classified → approved → credentials_rotated → sessions_revoked → notified → closed`로 나눌 수 있습니다. 자동화된 이메일 검증은 `evidence_collected`의 한 조각일 뿐 `approved`의 동의어가 아닙니다. 증거가 부족하거나 상충하면 `needs_review`, 공격 징후가 있으면 `blocked`로 끝내고, 보안상 이유를 상세히 응답하지 않습니다. 응답은 계정 존재 여부도 드러내지 않도록 요청 전후의 메시지와 상태 코드를 가능한 한 일정하게 유지합니다.

| 복구 요청의 신호 | 출발 분류 | 기본 처리 | 이유 |
| --- | --- | --- | --- |
| 최근 사용한 기기에서 비밀번호만 재설정 | 중간 | 1회성 이메일 링크 + 세션 회수 | 기존 신호가 있고 변경 범위가 좁음 |
| 새 기기·새 네트워크에서 MFA 재등록 | 높음 | step-up 또는 사람 검토 | 인증 수단 자체가 바뀜 |
| 이메일 변경과 비밀번호 재설정을 함께 요청 | 높음 | 기존 채널 통지 + 지연 승격 | 공격자가 회복 채널을 빼앗을 수 있음 |
| 관리자·결제 권한 계정의 지원자 override | 매우 높음 | 독립 증거 2종 이상 + 승인자 분리 | 피해 범위와 금전적 영향이 큼 |

등급은 시작점입니다. 실제 정책은 계정 유형, 평균 로그인 패턴, 계약 의무, 고객지원 가능 시간에 맞춰 조정해야 합니다. 다만 "이메일을 받았으니 안전하다"는 단일 신호는 고위험 변경의 통과 근거가 될 수 없습니다.

### 2) 지원자 확인은 신원 질문 맞히기보다 증거의 독립성을 보는 일이다

고객지원이 생년월일, 최근 주문 번호, 주소 같은 정보를 묻는 방식은 공격자에게도 유출된 개인정보나 소셜 엔지니어링으로 얻기 쉬운 정적 지식일 수 있습니다. 반면 사용자가 티켓을 보냈다는 사실도 그 메일함 또는 지원 채널을 장악한 공격자의 증거일 수 있습니다. 중요한 것은 질문의 개수가 아니라 공격자가 한 번의 침해로 모두 얻기 어려운 증거가 서로 다른 경계에 있는지입니다.

지원자 override의 기본 정책은 다음처럼 좁게 둡니다.

1. **증거 분리**: 기존에 등록된 별도 채널의 확인, 최근 신뢰 기기에서의 승인, 기업 SSO 관리자의 확인처럼 최소 두 가지 독립 신호를 조합합니다. 비밀번호·MFA seed·신분증 원문을 티켓에 보내게 해서는 안 됩니다.
2. **행위 분리**: 상담원은 증거를 수집하고, 다른 권한 또는 자동 정책 엔진이 실제 복구를 승인합니다. 한 사람이 MFA 해제와 이메일 변경을 모두 끝내지 않게 합니다.
3. **시간 분리**: 고위험 요청에는 예를 들어 24시간의 hold를 두고 기존 이메일·기기·관리자 채널에 취소 가능한 알림을 보냅니다. 실시간 장애 대응 계정에는 별도 비상 절차와 더 강한 사후 검토가 필요합니다.

상담원은 공격 탐지 엔진을 흉내 낼 필요가 없습니다. `최근 이메일 변경`, `새 ASN`, `짧은 시간의 복수 복구 요청`, `기존 MFA 삭제 시도`, `권한 상승 직후의 복구`처럼 시스템이 계산한 위험 신호와 어떤 증거를 받았는지만 보고 정책을 적용하면 됩니다. 원문 고객 데이터는 최소화하고 민감한 첨부는 별도 보안 보관소·짧은 보존 기간·열람 감사를 써야 합니다.

### 3) 복구 receipt가 있어야 나중의 이의를 조사할 수 있다

"상담원이 확인했습니다"라는 메모만으로는 나중에 누가 어떤 기준으로 권한을 되돌렸는지 알 수 없습니다. recovery case에는 비밀번호나 문서 원문 대신 정책 판단에 필요한 메타데이터를 남깁니다.

```yaml
recovery_case:
  case_id: rec_01J...
  account_id: usr_...
  policy_version: recovery-v4
  requested_actions: [password_reset, mfa_reenrollment]
  risk_band: high
  evidence_types: [existing_email_link, managed_device_approval]
  approver_role: recovery-reviewer
  hold_until: "2026-10-24T01:06:00Z"
  revocation_result: { sessions: 8, refresh_tokens: 3, prior_recovery_tokens: 1 }
  notification_channels: [previous_email, active_device]
```

`evidence_types`에는 어떤 종류의 증거가 통과했는지만 남기고 답변 원문, 기기 fingerprint 전문, 주민번호나 문서 이미지는 넣지 않습니다. `policy_version`과 `risk_band`가 있어야 정책을 바꾼 뒤에도 과거 판정을 재현할 수 있습니다. 복구 성공률만 높이면 탈취 성공률도 함께 높아질 수 있으므로, 취소율·사후 신고율·복구 후 이상 행동을 같이 봐야 합니다.

## 실무 적용

### 1) 자동 경로와 지원자 경로를 같은 case model에 넣는다

자동 이메일 복구와 상담원 복구를 전혀 다른 시스템으로 두면, 공격자가 약한 채널을 골라 정책을 우회합니다. 요청 진입점은 달라도 `recovery_case`와 공통 policy engine을 거치게 하세요.

```text
recovery request
  -> privacy-preserving acknowledgement
  -> risk signals + permitted evidence collection
  -> policy decision (auto / hold / human review / block)
  -> credential and recovery-method rotation
  -> revoke old sessions, refresh tokens, unused recovery tokens
  -> notify old and new trusted channels
  -> post-recovery monitoring window
```

`approved`가 되기 전에는 새 이메일을 primary로 바꾸거나 MFA를 제거하지 않습니다. 지원자가 MFA를 분실한 경우에도 먼저 제한된 recovery session을 발급하고, 이메일 변경·API key 생성·결제 정보 변경·권한 승격에는 24시간 동안 재인증 또는 추가 검증을 요구할 수 있습니다. 이 방식은 정상 사용자의 불편을 없애지는 않지만, 공격자가 가장 원하는 후속 행위를 좁힙니다.

### 2) 완료 시점에 새 권한 발급보다 이전 권한 회수를 먼저 확인한다

복구가 승인되면 다음 순서가 안전합니다.

1. 현재 case보다 오래된 password reset·email verification·MFA enrollment token을 무효화합니다.
2. `credential_version` 또는 `session_version`을 올리고, server session·refresh token·신뢰 기기 등록을 정책에 맞게 회수합니다.
3. 새 복구 세션은 짧은 TTL과 낮은 권한으로 발급하고, 비밀번호·MFA 재등록이 끝난 뒤 일반 세션으로 교환합니다.
4. 기존 이메일, 활성 기기, 조직 관리자처럼 공격자가 아직 장악하지 않았을 가능성이 있는 채널에 복구 시작·완료와 취소·신고 경로를 보냅니다.

새 세션이 발급되었다고 성공으로 표시하면 session revocation worker의 지연이나 푸시 알림 실패를 놓치기 쉽습니다. `sessions_revoked`와 `notified`의 결과를 receipt에 기록하고, 회수 실패가 하나라도 남으면 case를 `closed`가 아니라 `recovery_partial`로 분류해 재시도·검토 queue에 넣으세요. 지원자 override나 이메일 변경을 동반한 경우에는 탈취된 세션을 유지하는 비용이 더 큽니다.

### 3) 정책은 관찰 모드로 시작하고 탈취 신호로 조정한다

초기에 너무 많은 복구 요청을 차단하면 고객지원이 폭증하고, 너무 느슨하면 공격자가 지원 채널을 시험합니다. 첫 2주에는 고위험 신호가 있는 요청을 차단하지 않고 `would_hold`, `would_require_second_evidence` 같은 shadow decision을 기록하는 방법이 유용합니다. 이후 정상 사용자의 완료 시간, 취소 링크 사용률, 검토 뒤 거부율, 복구 후 7일 내 이상 행동을 나눠 보세요.

운영 시작 기준으로는 고위험 복구의 자동 승인 비율을 0%로 두고, 사람 검토 SLA를 영업시간 기준 4시간 이내로 정할 수 있습니다. support override가 전체 복구의 2%를 넘거나, 복구 후 7일 내 보안 신고율이 평소 인증 변경의 2배 이상이면 질문을 늘리기보다 어떤 채널·증거 조합이 약한지 먼저 조사해야 합니다.

## 트레이드오프/주의점

강한 복구 정책은 여행·기기 분실·퇴사한 조직 관리자 같은 정상 사용자를 지연시킬 수 있습니다. 그렇다고 지원자에게 광범위한 예외 권한을 주면, 공격자는 제품의 암호화보다 고객지원 스크립트를 먼저 공략합니다. 따라서 위험이 낮은 비밀번호 재설정은 빠르게 처리하되, 회복 채널 자체를 바꾸는 요청은 늦고 설명 가능하게 처리하는 비대칭이 필요합니다.

신분증 제출을 더 많이 받는 것도 만능 해법이 아닙니다. 수집한 원본은 새로운 개인정보 침해 표면이 되고, 위조 검증·보관·삭제 의무를 추가합니다. 제품이 법적 본인 확인을 요구하지 않는다면, 이미 보유한 신뢰 채널과 조직 관리자·관리 기기 같은 관계 증거를 우선하고 원본 신분증 수집은 별도 법무·보안 검토 없이는 기본값으로 삼지 마세요.

고객지원 SLA를 지키려고 상담원이 policy를 우회하는 관행을 만들면 시스템의 실제 정책은 문서와 달라집니다. override 비율, 승인자별 거부율, hold 취소율, receipt 누락률을 운영 지표로 두고, 긴급 예외도 사후 1영업일 내 재검토하도록 만드세요. 우선순위는 **권한 경계와 회수 → 사용자에게 보이는 복구 경로 → 처리 속도**입니다.

## 체크리스트 또는 연습

- [ ] 비밀번호 재설정, MFA 재등록, 이메일 변경, support override가 서로 다른 risk band와 승인 조건을 쓴다.
- [ ] 복구 요청은 계정 존재 여부를 드러내지 않는 응답을 반환하고, rate limit·abuse signal과 연결된다.
- [ ] 이메일 링크는 증거 하나로만 취급하며, 고위험 변경에는 독립 증거·hold·사람 검토를 추가한다.
- [ ] 상담원의 증거 수집과 실제 credential/MFA/email 변경 승인을 분리한다.
- [ ] recovery case에 정책 버전, 증거 유형, 위험 등급, 승인 역할, 회수·통지 결과를 남기되 민감 원문은 저장하지 않는다.
- [ ] 복구 성공 시 기존 세션, refresh token, 미사용 복구 토큰, 필요 시 신뢰 기기를 회수한다.
- [ ] 기존 채널에 취소·신고 가능한 알림을 보내고, 복구 직후 고위험 행동에는 step-up을 요구한다.

연습으로 현재 제품의 "MFA를 잃어버렸어요" 지원 절차를 흐름도로 옮겨 보세요. 상담원이 확인하는 정보, 자동 시스템이 계산하는 신호, 실제로 바뀌는 credential, 통지받는 채널을 각각 다른 색으로 표시합니다. 한 번의 이메일 또는 한 명의 상담원이 모든 단계를 통과시키는 지점이 있다면, 그 지점이 우선적으로 증거 분리와 세션 회수를 도입할 경계입니다.

## 관련 글

- [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/)
- [이메일 검증 토큰 재사용·남용 방지](/learning/deep-dive/deep-dive-email-verification-token-replay-abuse-playbook/)
- [디바이스 세션 레지스트리와 폐기](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)
- [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
