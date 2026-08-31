---
title: "백엔드 커리큘럼 심화: Password Credential Lifecycle, 해시·복구·침해 대응을 하나의 인증 계약으로 설계하기"
date: 2026-08-23
draft: false
topic: "Backend Security"
tags: ["Password Security", "Argon2id", "Authentication", "Credential Stuffing", "Session Security", "Backend Reliability"]
categories: ["Backend Deep Dive"]
keywords: ["password credential lifecycle", "Argon2id", "password reset", "credential stuffing", "session invalidation", "authentication security"]
description: "비밀번호를 해시 하나로 끝내지 않고, 등록·검증·파라미터 상향·재설정·세션 폐기·침해 대응까지 연결해 운영 가능한 인증 수명주기로 설계하는 실무 플레이북입니다."
summary: "비밀번호 보안은 알고리즘 선택만의 문제가 아닙니다. 해시 비용, 로그인 제한, 재설정 토큰, 세션 회수, MFA 승격, 침해 대응이 같은 상태 전이와 관측 지표로 이어져야 실제 공격과 운영 장애를 함께 줄일 수 있습니다."
module: "backend-security"
study_order: 1450
key_takeaways:
  - "비밀번호 해시는 Argon2id 같은 느리고 memory-hard한 KDF, 사용자별 salt, 버전 가능한 파라미터로 저장하며 평문·복호화 가능 암호화·빠른 SHA 계열을 쓰지 않는다."
  - "로그인 실패 제한은 IP 하나만 막는 규칙이 아니라 계정·IP·디바이스·성공률을 함께 보는 위험 점수와 단계적 지연의 문제다."
  - "비밀번호 변경·재설정·침해 의심은 credential 버전과 세션 회수를 연결해야 기존 세션이 조용히 살아남지 않는다."
operator_checklist:
  - "비밀번호 레코드에 algorithm, parameter version, unique salt, created_at, credential_version을 저장한다."
  - "Argon2id 기준값은 실제 인증 서버에서 p95 해시 지연과 동시 로그인 수를 측정해 정하고, 파라미터 상향은 로그인 성공 시 rehash로 점진 전환한다."
  - "재설정 토큰은 원문이 아닌 해시만 저장하고, 1회 사용·짧은 만료·용도·사용자·세션 회수 정책을 함께 기록한다."
  - "관리자·결제·이메일 변경 같은 고위험 행동은 비밀번호 재입력만으로 닫지 않고 MFA 또는 step-up 인증을 요구한다."
learning_refs:
  - title: "JWT 인증과 세션 설계"
    href: "/learning/deep-dive/deep-dive-jwt-auth/"
    description: "access token, refresh token, 만료와 폐기 경계를 이해하는 기반 글입니다."
  - title: "API Rate Limit과 Backpressure"
    href: "/learning/deep-dive/deep-dive-api-rate-limit-backpressure/"
    description: "로그인 엔드포인트의 제한 정책을 일반 API 제한과 분리하는 기준입니다."
  - title: "Secret Management"
    href: "/learning/deep-dive/deep-dive-secret-management/"
    description: "pepper와 재설정 서명 키를 애플리케이션 설정이 아닌 비밀 관리 시스템으로 다루는 방법입니다."
  - title: "고위험 행동 Step-up Authorization"
    href: "/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/"
    description: "인증이 끝난 뒤에도 필요한 추가 검증과 승인 경계를 다룹니다."
---

비밀번호 인증은 `password_hash` 컬럼 하나로 끝나지 않습니다. 사용자가 가입할 때 어떤 비밀번호를 허용하는지, 서버가 어떤 비용으로 검증하는지, 로그인 실패가 늘 때 누구를 제한하는지, 재설정 메일이 탈취됐을 때 어떤 세션을 끊는지, 해시 알고리즘을 상향할 때 기존 사용자를 어떻게 옮기는지가 한 시스템입니다. 이 연결이 없으면 강한 Argon2id를 써도 재설정 토큰 재사용으로 계정이 탈취되거나, rate limit을 강하게 걸어 정상 사용자가 먼저 막히거나, 비밀번호를 바꾼 뒤 탈취된 refresh token이 계속 살아남는 일이 생깁니다.

이 글은 [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/), [Secret Management](/learning/deep-dive/deep-dive-secret-management/), [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)을 하나의 credential lifecycle로 묶습니다. 목표는 "비밀번호를 안전하게 저장한다"가 아니라, **비밀번호 관련 상태 변경이 일어날 때 이전 권한을 회수하고 다음 인증을 더 안전하게 만드는 것**입니다.

참고 기준은 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP Credential Stuffing Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html), [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)입니다. 수치는 제품 위험도와 실제 부하 시험 결과에 맞춰 조정해야 합니다.

## 이 글에서 얻는 것

- 등록, 로그인, 비밀번호 변경, 재설정, 침해 의심을 하나의 상태 전이로 모델링할 수 있습니다.
- Argon2id 비용을 보안 문구가 아니라 인증 서버의 지연·동시성 예산으로 조정하는 방법을 이해합니다.
- credential stuffing에 대해 계정 잠금 하나가 아닌 다층 제한과 step-up을 설계할 수 있습니다.
- 비밀번호 교체 뒤 refresh token, browser session, API key 같은 기존 권한을 무엇까지 회수할지 결정할 수 있습니다.

## 핵심 개념/이슈

### 1) 해시 레코드는 값이 아니라 "검증 가능한 버전"이다

비밀번호는 평문으로 저장하면 안 되고, 복호화 가능한 암호화로 저장하는 것도 기본 해법이 아닙니다. DB가 유출됐을 때 공격자가 오프라인 추측을 하기 어렵도록, 사용자별 salt를 넣은 느린 key derivation function(KDF) 결과만 저장해야 합니다. 빠른 SHA-256이나 MD5는 무결성에는 쓸 수 있어도 비밀번호 추측 비용을 충분히 높이지 못하므로 적합하지 않습니다.

현재 출발점으로는 Argon2id가 실무적으로 무난합니다. OWASP는 최소 구성 중 하나로 `m=19 MiB, t=2, p=1`을 제시하지만, 이는 "어느 서비스나 고정"이라는 뜻이 아닙니다. 인증 서버의 CPU, 메모리, peak login, 봇 공격 가능성을 측정해 비용을 올려야 합니다. 예를 들어 정상 로그인 해시 검증 p95를 **250ms 이하**, 인증 워커 메모리 사용률을 **70% 이하**, 로그인 의존성 timeout을 **2초 이하**로 두고 부하 시험에서 파라미터를 선택할 수 있습니다.

레코드는 알고리즘과 비용을 함께 보존해야 합니다.

```json
{
  "user_id": "usr_123",
  "password_hash": "$argon2id$v=19$m=19456,t=2,p=1$...",
  "kdf_version": 3,
  "credential_version": 12,
  "password_changed_at": "2026-08-23T01:00:00Z"
}
```

`kdf_version`이 있어야 다음 분기에 메모리 비용을 올리거나 bcrypt에서 Argon2id로 옮길 때 모든 사용자의 비밀번호를 강제로 초기화하지 않아도 됩니다. 로그인에 성공한 시점에 기존 hash를 검증하고, 현재 정책보다 낮으면 새 파라미터로 재해시해 교체합니다. 이 방식은 전환을 분산시키지만, 장기간 미접속 계정은 낡은 hash를 유지한다는 점도 드러냅니다. 휴면 계정의 강제 재설정 여부는 위험도와 약관을 따로 판단해야 합니다.

### 2) salt, pepper, 파라미터는 서로 다른 역할을 한다

세 가지를 한 덩어리로 부르면 운영에서 빠집니다.

| 요소 | 보관 위치 | 목적 | 유출 시 의미 |
| --- | --- | --- | --- |
| Salt | 각 사용자 hash와 함께 | 같은 비밀번호라도 다른 결과 생성, rainbow table 방지 | 비밀일 필요는 없지만 사용자마다 달라야 함 |
| KDF parameter | hash 문자열 또는 버전 정책 | 추측 한 번의 비용 결정 | 낮으면 점진 상향 대상 |
| Pepper | KMS/HSM 또는 별도 secret store | DB 유출만으로 검증하기 어렵게 하는 방어 심화 | 유출 시 회전·재해시 계획 필요 |

pepper는 salt 대체물이 아닙니다. 애플리케이션 환경변수에 DB 비밀번호와 함께 두면 DB와 서버가 동시에 침해됐을 때 방어 가치가 작습니다. [Secret Management](/learning/deep-dive/deep-dive-secret-management/)처럼 별도 비밀 관리 경계와 접근 감사가 있는 위치에 두고, **pepper ID**를 hash 정책에 포함해야 교체 과정을 설명할 수 있습니다. pepper를 바꿀 때 모든 비밀번호의 원문을 알 수 없으므로, 기존 pepper로 검증 후 새 pepper로 재해시하는 login-time migration 또는 보수적인 강제 재설정 계획이 필요합니다.

### 3) 로그인 보호는 계정 잠금보다 공격 비용을 올리는 일이다

한 IP에서 같은 계정을 수천 번 시도하는 brute force만 보면 IP 제한으로 충분해 보입니다. 그러나 credential stuffing은 유출된 이메일·비밀번호 쌍을 많은 IP와 많은 계정에 나눠 보냅니다. 반대로 계정 하나만 강하게 잠그면 공격자는 사용자를 잠가 서비스 거부를 만들 수 있습니다. 그러므로 신호를 합쳐야 합니다.

초기 정책 예시는 다음과 같습니다.

| 신호 | 예시 기준 | 기본 행동 |
| --- | --- | --- |
| 계정 실패 | 동일 계정 15분 내 5회 | 30초 지연, CAPTCHA 또는 추가 검증 |
| IP 실패 | 동일 IP 1분 내 30회 | 지수 backoff와 rate limit |
| 분산 실패 | 10분 내 계정 100개 이상, 성공률 급락 | WAF/bot rule 강화, 보안 알림 |
| 고위험 성공 | 새 국가·새 디바이스·비정상 ASN | MFA/step-up 후 세션 발급 |
| 유출 비밀번호 일치 | 가입/변경 시 breach 목록 hit | 다른 비밀번호 요구, 비밀값 자체는 로그 금지 |

숫자는 출발값일 뿐입니다. 먼저 **정상 로그인 실패율**, **p95 로그인 지연**, **계정별 성공률**, **차단 후 고객지원 문의**를 baseline으로 기록해야 합니다. 실패율이 평소의 3배이고 수백 계정에 분산되면 IP별 임계치가 낮아도 공격일 수 있습니다. 반면 회사 VPN이나 학교 NAT는 IP 하나에 정상 사용자가 많으므로 IP 차단을 강화하면 피해가 커집니다. `429`만 반환하고 끝내지 말고, retry-after, 사용자용 복구 안내, 보안 이벤트의 correlation ID를 같이 제공하는 방식은 [API Error Semantics](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)과 연결됩니다.

### 4) 재설정 토큰은 임시 비밀번호가 아니라 일회성 권한이다

재설정 URL은 이메일을 가진 사람이 비밀번호를 바꿀 수 있는 강한 권한입니다. 따라서 token을 DB에 평문으로 저장하거나, 긴 만료와 무제한 재사용을 허용하면 password hash를 잘 설계해도 우회됩니다. 최소 레코드는 다음 의미를 가져야 합니다.

```text
reset_token_hash, user_id, purpose, issued_at, expires_at,
used_at, requested_ip_hash, credential_version_at_issue
```

권장 흐름은 `랜덤 256비트 이상 토큰 생성 → 원문은 URL로 단 한 번 전달 → 서버에는 token hash 저장 → 15~30분 내 1회 사용 → 비밀번호 변경 트랜잭션과 token used 처리를 함께 완료`입니다. 응답은 이메일이 존재하는지 드러내지 않도록 가입 여부와 무관하게 같은 문구·상태 코드·대략의 응답 시간을 유지합니다. 사용자 enumeration 방지는 [Identifier Normalization Security](/learning/deep-dive/deep-dive-identifier-normalization-security-playbook/)의 email canonicalization 정책과도 묶어야 합니다.

특히 재설정 요청 당시의 `credential_version`을 보존하면, 사용자가 먼저 비밀번호를 바꾼 뒤 늦게 도착한 예전 링크가 다시 권한을 얻는 일을 막을 수 있습니다. 토큰 사용 시 현재 버전과 다르면 거절합니다.

### 5) 인증 성공과 세션 유효는 같은 말이 아니다

비밀번호가 변경되었는데 탈취된 refresh token, 장기 browser session, remember-me cookie가 그대로 유효하면 공격자는 새 비밀번호를 몰라도 계속 접근할 수 있습니다. 반대로 모든 세션을 항상 끊으면 사용성 비용이 큽니다. 따라서 이벤트별 회수 범위를 명시해야 합니다.

| 이벤트 | credential_version | 현재 세션 | 다른 세션 | 고위험 행동 |
| --- | --- | --- | --- | --- |
| 사용자가 비밀번호 변경 | +1 | 재인증 후 재발급 | 원칙적으로 회수 | 새 MFA 확인 요구 가능 |
| 재설정 링크 사용 | +1 | 새 세션만 발급 | 전부 회수 | 24시간 step-up 권장 |
| breach 의심/계정 탈취 | +1 이상 | 즉시 회수 | 즉시 회수 | support recovery와 MFA 재등록 |
| KDF 파라미터 상향 | 유지 | 유지 | 유지 | 영향 없음 |

JWT를 무상태라고 해서 회수가 불가능한 것은 아닙니다. access token은 짧은 TTL(예: 5~15분)로 제한하고, refresh token 또는 server session에 `credential_version`을 넣어 검증 시 현재 값과 비교합니다. 즉시 차단이 필요한 범위에는 token blacklist 또는 server-side session registry가 필요할 수 있습니다. 어떤 조합이 필요한지는 [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/)에서 다룬 상태성·폐기 trade-off와 같이 판단합니다.

## 실무 적용

### 1) 상태 전이를 먼저 문서화한다

인증 서비스에서 가장 위험한 변경은 endpoint 하나를 추가하는 일이 아니라 이전 권한을 잊는 일입니다. 다음과 같은 event contract를 작성하면 구현과 보안 운영이 같은 언어를 씁니다.

```yaml
credential_event:
  type: password_reset_completed
  user_id: usr_123
  credential_version_before: 12
  credential_version_after: 13
  revoke_sessions: all
  revoke_refresh_tokens: all
  require_step_up_until: "2026-08-24T01:00:00Z"
  audit_fields: [request_id, reset_token_id, actor_ip_hash]
```

이벤트에는 비밀번호 원문, hash 전체, 재설정 URL을 넣지 않습니다. 감사 로그에는 누가 어떤 경로로 credential을 바꿨는지와 회수가 성공했는지만 남깁니다. 외부 알림에는 "비밀번호가 변경되었습니다"와 회복 경로만 제공하고, 실패 사유나 토큰 상태를 상세히 노출하지 않습니다.

### 2) 파라미터 상향은 load test와 canary로 진행한다

Argon2id의 메모리나 반복 횟수를 올리면 공격자 비용뿐 아니라 정상 로그인 서버 비용도 같이 오릅니다. 다음 순서가 안전합니다.

1. 현재 p50/p95/p99 hash 시간, auth worker의 메모리, login error rate를 7일 baseline으로 수집합니다.
2. production과 같은 CPU·메모리에서 후보 파라미터를 부하 시험합니다. peak 동시 로그인보다 1.5배 높은 부하를 넣습니다.
3. 정상 p95가 서비스 deadline의 20~30%를 넘거나 worker memory가 80%를 넘으면 파라미터 상향보다 worker 분리·용량 계획을 먼저 검토합니다.
4. 신규 가입은 새 버전으로, 기존 계정은 성공 로그인 때 rehash합니다.
5. 24~72시간 동안 login p95가 baseline 대비 30% 이상 악화하거나 인증 5xx가 0.2%p 이상 늘면 canary 확장을 멈춥니다.

보안 파라미터는 정답 하나가 아니라 서비스 용량과 공격 모델에 대한 운영 결정입니다. 알고리즘 이름만 바꾸고 테스트하지 않으면 인증 장애가 곧 계정 복구 문의 폭증으로 이어집니다.

### 3) 우선순위를 "비밀번호 규칙"보다 복구 경로에 둔다

개발 순서를 잡아야 한다면 다음이 현실적입니다.

1. 평문·빠른 해시 제거, unique salt, adaptive KDF 도입
2. reset token 1회 사용·짧은 만료·세션 회수
3. 계정/IP/분산 신호 기반 제한과 관측
4. breach password 차단과 MFA enrollment 유도
5. 관리자·결제·이메일 변경의 step-up 인증

대문자·특수문자 조합 규칙을 복잡하게 하는 일은 위보다 우선순위가 낮습니다. NIST는 긴 비밀번호·공백·password manager 입력을 허용하고, 예측 가능한 조합 규칙보다 유출·상용 비밀번호 차단을 권합니다. MFA가 가능한 고위험 계정에서는 비밀번호 정책을 더 복잡하게 만드는 것보다 MFA 강제와 복구 절차 검증이 더 큰 효과를 냅니다.

## 트레이드오프/주의점

첫째, KDF 비용을 무조건 높이면 봇뿐 아니라 정상 사용자의 로그인도 느려집니다. 특히 모바일, 대규모 캠페인, B2B SSO fallback에서는 login burst가 발생할 수 있으므로 인증 워커를 일반 API와 분리하고 용량 예산을 둬야 합니다.

둘째, 계정 잠금은 공격 억제와 서비스 거부 사이의 균형입니다. 단순한 영구 잠금보다 단계적 지연, 위험 기반 CAPTCHA, 이메일 알림, step-up으로 진행하고, support가 해제할 수 있는 감사 경로를 둡니다.

셋째, pepper는 방어 심화이지 DB 침해를 마법처럼 해결하는 장치가 아닙니다. KMS 장애가 로그인 장애로 전파되지 않도록 cache·timeout·fail mode를 설계하되, pepper를 local config에 복제해 가용성만 해결하면 보안 이점이 사라질 수 있습니다.

넷째, 모든 비밀번호 변경에 무조건 전체 로그아웃을 적용하면 사용자 경험이 나빠질 수 있습니다. 그러나 재설정, 유출 의심, 관리자 계정처럼 위험도가 높은 이벤트는 편의보다 세션 회수가 우선입니다. 제품별로 "현재 기기 유지" 예외가 필요하면 재인증·디바이스 신뢰·감사 이벤트를 함께 요구해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] hash 레코드에 algorithm, parameter/KDF version, unique salt, credential version이 있다.
- [ ] 신규 비밀번호는 compromised/common password 목록과 비교하고, 복잡도 조합 규칙만 강제하지 않는다.
- [ ] 로그인 제한이 계정·IP·분산 실패·성공률을 함께 관측하며 정상 NAT 사용자를 과도하게 막지 않는다.
- [ ] reset token은 원문 미저장, 1회 사용, 15~30분 만료, 목적·발급 시 credential version 검증을 만족한다.
- [ ] 비밀번호 재설정과 침해 의심 시 refresh token과 다른 세션 회수 결과가 감사 로그에 남는다.
- [ ] 관리자·결제·이메일 변경은 비밀번호만으로 승인하지 않고 MFA 또는 step-up을 요구한다.

### 연습 과제

1. 현재 서비스의 `password_hash` 스키마를 적고, algorithm/parameter version/salt/credential version 중 빠진 필드를 표시해 보세요.
2. 로그인 실패 로그 1주를 계정·IP·ASN·성공률 기준으로 집계해, "5회 실패" 단일 규칙이 놓치는 분산 공격 신호를 찾아보세요.
3. 비밀번호 재설정 뒤 기존 refresh token 하나로 API를 호출하는 통합 테스트를 작성하세요. 401 또는 재인증 요구가 발생하는지 확인합니다.
4. Argon2id 후보 두 개를 골라 peak의 1.5배 로그인 부하에서 p95 hash 지연과 worker 메모리 사용률을 비교하고, 선택 근거를 한 문단으로 남기세요.

## 관련 글

- [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Secret Management](/learning/deep-dive/deep-dive-secret-management/)
- [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
- [Identifier Normalization Security](/learning/deep-dive/deep-dive-identifier-normalization-security-playbook/)
