---
title: "백엔드 커리큘럼 심화: WebAuthn Passkey, 서버 검증과 Credential Lifecycle을 설계하는 법"
date: 2026-09-05T10:06:00+09:00
lastmod: 2026-09-05T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["WebAuthn", "Passkey", "FIDO2", "Authentication", "Credential Lifecycle", "Backend Security"]
categories: ["Backend Deep Dive"]
keywords: ["webauthn server verification", "passkey backend", "WebAuthn challenge", "rpId origin validation", "credential lifecycle"]
description: "Passkey를 화면 API 한 번으로 끝내지 않고, challenge·origin·rpId·서명·credential metadata·세션·복구를 서버의 상태 전이로 설계하는 실무 플레이북입니다."
summary: "Passkey의 개인키는 서버에 없지만, 서버의 책임이 사라지는 것은 아니다. 서버는 일회성 challenge와 정확한 origin/rpId를 검증하고, 공개키·credential 상태·사용자 검증 수준을 보존하며, 분실·복구·세션 회수를 별도 수명주기로 운영해야 한다."
module: "backend-security"
study_order: 1504
key_takeaways:
  - "WebAuthn 응답의 서명만 맞아도 로그인 성공은 아니다. 서버가 발급한 일회성 challenge, 예상 origin·rpId, ceremony type, user verification 요구를 함께 검증해야 한다."
  - "credential은 로그인 세션이 아니며, credential 삭제·새 기기 등록·복구·위험 행동의 추가 인증을 session registry와 분리해 상태 전이로 다뤄야 한다."
  - "signature counter 불일치는 탈취 확정이 아니라 위험 신호다. 무조건 계정을 잠그기보다 credential 제한, 세션 회수, step-up, 사용자 확인 순서를 위험도에 따라 정한다."
operator_checklist:
  - "challenge는 서버가 CSPRNG로 32바이트 이상 생성하고, 사용자·ceremony·origin·만료와 묶어 한 번만 소비한다."
  - "검증 서버는 clientDataJSON의 type, challenge, origin, crossOrigin과 authenticatorData의 rpIdHash, flags, signature를 모두 확인한다."
  - "credential마다 public key, user handle, transports, backup 상태, sign count, created_at, last_used_at, state를 보관한다."
  - "비밀번호 재설정·복구·새 passkey 등록은 현재 세션의 인증 수준과 별개의 고위험 작업으로 분류한다."
learning_refs:
  - title: "JWT 인증과 세션 설계"
    href: "/learning/deep-dive/deep-dive-jwt-auth/"
    description: "WebAuthn 성공 뒤 access/refresh token 또는 서버 세션을 어떻게 발급할지 연결합니다."
  - title: "Password Credential Lifecycle"
    href: "/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/"
    description: "Passkey와 비밀번호를 함께 제공할 때 복구·변경·회수 정책을 분리하는 기준입니다."
  - title: "Device Session Registry"
    href: "/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/"
    description: "credential 인증 결과를 기기별 세션 상태와 회수 전파에 연결합니다."
  - title: "고위험 행동 Step-up Authorization"
    href: "/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/"
    description: "이메일·복구 수단·결제수단 변경에 필요한 추가 인증 정책을 다룹니다."
---

Passkey는 비밀번호를 없애는 UI 기능처럼 보이기 쉽습니다. 브라우저에서 `navigator.credentials.create()` 또는 `get()`을 호출하고, 돌아온 값을 서버에 보내면 끝나는 것처럼 보입니다. 그러나 실제 사고는 이 사이의 서버 검증과 수명주기에서 납니다. 과거 challenge를 재사용하거나, `origin`을 부분 문자열로 비교하거나, credential을 지워 놓고 이미 발급한 세션을 살려 두거나, 복구 절차가 passkey보다 약하면 로그인 화면의 암호학은 제품 보안으로 이어지지 않습니다.

WebAuthn은 브라우저와 인증기가 공개키 기반 증명을 만들게 하는 표준입니다. 서버(Relying Party)는 개인키를 보관하지 않습니다. 대신 "이 증명이 **지금 이 서비스의 이 요청**에 대한 것인가"와 "이 credential이 아직 이 사용자에게 허용되는가"를 판정합니다. W3C의 WebAuthn Level 3은 challenge가 서버에서 생성되어야 하고 재사용 방지에 충분한 entropy가 있어야 한다고 설명합니다. 이 글은 [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/), [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/), [Device Session Registry](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/), [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/) 사이에 있는 서버 측 경계를 채웁니다.

참고한 공식 자료:

- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [MDN: Passkeys 보안](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys)
- [MDN: Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)

## 이 글에서 얻는 것

- registration과 authentication ceremony에서 서버가 저장하고 검증해야 할 값을 구분합니다.
- challenge, `origin`, `rpId`, user presence(UP), user verification(UV), 서명을 어떤 순서로 확인할지 알 수 있습니다.
- passkey credential, browser session, 계정 복구를 서로 다른 상태로 모델링할 수 있습니다.
- cloned credential 의심, 기기 분실, 새 기기 등록, 비밀번호 fallback을 숫자와 조건으로 운영하는 기준을 얻습니다.

## 핵심 개념/이슈

### 1) Passkey는 credential의 별칭이고, 로그인 세션은 별도 상태다

Passkey는 보통 discoverable credential과 동기화 가능한 인증기 경험을 포함해 부르는 제품 용어입니다. 서버가 받아야 하는 핵심은 `credential_id`와 공개키, 그리고 인증기가 만든 서명입니다. 개인키나 생체 정보가 서버로 전송되는 구조가 아닙니다. 그렇다고 서버가 무상태가 되는 것은 아닙니다.

서버는 적어도 다음 세 객체를 분리합니다.

| 객체 | 무엇을 나타내나 | 서버의 책임 | 지우거나 회수할 때 |
| --- | --- | --- | --- |
| WebAuthn credential | 특정 RP에 묶인 공개키 증명 수단 | 공개키·상태·마지막 사용·등록 정책 보존 | 해당 credential으로 새 인증을 막는다 |
| device/browser session | 인증 뒤 현재 접속을 허용하는 상태 | scope, auth level, 만료, revoke 상태 관리 | 이미 발급한 access/refresh 경로를 끊는다 |
| account recovery factor | credential을 잃었을 때 계정을 되찾는 경로 | 신원 확인 강도·대기 시간·감사 기록 관리 | 공격자가 약한 우회로를 쓰지 못하게 한다 |

따라서 "passkey 삭제"는 현재 로그인 세션을 자동으로 끊는다는 뜻이 아닙니다. 고위험 계정이라면 credential 삭제가 발생했을 때 해당 credential으로 최근 생성된 세션을 찾아 재인증을 요구할지, 모든 interactive session을 회수할지 정책을 정해야 합니다. 반대로 휴대폰 하나에서 passkey를 지운 사용자를 모든 기기에서 즉시 로그아웃시키면 정상 복구 비용이 커집니다. 피해 가능성, 복구 가능성, 불필요한 마찰의 순서로 판단합니다.

### 2) Challenge는 nonce가 아니라 서버가 보관하는 일회성 승인 요청이다

challenge를 프론트엔드가 만들거나, 로그인 페이지에서 같은 값을 오래 재사용하면 WebAuthn의 replay 방어가 무너집니다. 서버는 CSPRNG로 **최소 16바이트, 실무에서는 32바이트 이상**의 무작위 값을 만들고, 다음 맥락과 묶어 저장합니다.

```yaml
webauthn_ceremony:
  ceremony_id: "wac_01J..."
  purpose: "authentication" # registration | authentication | step_up
  challenge_hash: "sha256:..." # 원문 대신 서버 측 hash 보관 가능
  user_id_hint: null           # usernameless login은 비워 둘 수 있음
  expected_origin: "https://app.example.com"
  rp_id: "example.com"
  user_verification: "required"
  expires_at: "2026-09-05T01:11:00Z"
  consumed_at: null
```

권장 출발점은 TTL 5분, 한 번의 성공·실패 응답 뒤 소비 처리, 사용자 또는 브라우저 세션별 동시 ceremony 상한 3개입니다. 등록 버튼을 두 번 누르거나 모바일 브라우저가 재시도할 수 있으므로 "동시 하나만 허용"이 항상 맞지는 않습니다. 다만 같은 challenge로 두 응답을 허용하면 안 됩니다. 성공 검증과 `consumed_at` 기록은 트랜잭션 또는 compare-and-set으로 묶어 정확히 하나만 통과시켜야 합니다.

```text
server: challenge 발급 + 상태 저장
  -> browser/authenticator: challenge를 포함한 증명 생성
  -> server: challenge와 증명 검증
  -> server: ceremony를 consumed로 원자 전이
  -> server: session 발급 또는 고위험 행동 승인
```

여기서 `timeout` 옵션은 브라우저에 주는 힌트일 뿐입니다. 브라우저가 몇 초 뒤 응답해도 서버의 `expires_at`이 지나면 거절해야 합니다. 만료된 ceremony를 다시 발급하는 일과, 만료된 응답을 느슨하게 받아 주는 일은 다릅니다.

### 3) 서명 검증은 origin·rpIdHash·flags를 함께 보는 묶음이다

인증 응답의 signature만 공개키로 검증하는 구현은 불완전합니다. 최소한 다음 순서를 명시적으로 구현하고, 실패 reason을 보안 이벤트로 남기되 원문 credential이나 clientData를 로그에 넣지 않습니다.

1. **ceremony를 찾고 아직 미사용·미만료인지 확인합니다.** 서버가 발급한 challenge의 hash와 응답의 base64url challenge가 정확히 같은지 비교합니다.
2. **`clientDataJSON.type`을 확인합니다.** 등록은 `webauthn.create`, 인증은 `webauthn.get`이어야 합니다. 서로의 응답을 바꿔 끼우지 못하게 하는 경계입니다.
3. **`origin`을 정확히 비교합니다.** `https://app.example.com`을 기대했다면 scheme·host·port가 같아야 합니다. `endsWith("example.com")`, wildcard, 사용자가 보낸 Host header를 근거로 비교하지 않습니다. 개발·스테이징 origin은 운영 allowlist와 별도 구성으로 둡니다.
4. **authenticator data의 `rpIdHash`를 계산한 기대값과 비교합니다.** `rpId`는 URL이 아니라 RP domain입니다. `app.example.com`에서 `example.com`을 RP ID로 쓸 수 있는지는 브라우저의 origin 규칙과 제품 도메인 설계에 맞춰 검증해야 하며, 문자열 유사성으로 허용하지 않습니다.
5. **UP와 UV flag를 정책과 비교합니다.** UP는 사용자의 상호작용, UV는 PIN·생체 등 인증기 내부의 사용자 검증을 의미합니다. 일반 로그인에서 `preferred`를 썼더라도 이메일 변경·복구 수단 추가·결제수단 변경은 `required`를 요구할 수 있습니다.
6. **등록 때 저장한 공개키로 서명을 검증합니다.** `authenticatorData || SHA-256(clientDataJSON)` 같은 규정된 서명 입력과 알고리즘을 라이브러리의 검증 함수로 확인합니다. 직접 CBOR/COSE를 해석하기보다 유지되는 검증 라이브러리를 사용하고, 라이브러리의 검증 항목을 통합 테스트로 잠급니다.
7. **검증 성공과 ceremony 소비를 원자화합니다.** 그 뒤에만 session 또는 action receipt를 만듭니다.

`crossOrigin=true` 또는 `topOrigin`이 있는 응답은 iframe 사용을 제품이 명시적으로 지원할 때만 별도 정책으로 허용합니다. iframe 로그인을 지원하지 않는다면 이 경우를 정상 흐름으로 관대하게 받지 않는 편이 안전합니다. reverse proxy 뒤에서 들어오는 `Host`나 `X-Forwarded-Host`는 trusted proxy 범위를 고정하지 않았다면 origin 결정의 근거로 쓰지 않습니다.

### 4) Credential metadata는 목록 UI가 아니라 복구와 위험 판단의 근거다

등록 성공 뒤 공개키만 저장하면 첫 로그인은 되지만 운영 판단이 어렵습니다. 다음 정도의 구조면 시작할 수 있습니다.

```sql
CREATE TABLE webauthn_credential (
  credential_id        bytea PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES app_user(id),
  public_key_cose      bytea NOT NULL,
  sign_count           bigint NOT NULL DEFAULT 0,
  backup_eligible      boolean,
  backup_state         boolean,
  transports           jsonb NOT NULL DEFAULT '[]',
  created_at           timestamptz NOT NULL,
  last_used_at         timestamptz,
  state                text NOT NULL, -- active | suspended | revoked
  revoked_at           timestamptz,
  label                text
);
CREATE INDEX ON webauthn_credential (user_id, state);
```

`backup_eligible`과 `backup_state`는 동기화 가능한 credential의 성격을 이해하는 힌트입니다. 이 값만으로 특정 사용자가 안전하거나 위험하다고 판단하지 마세요. 특히 백업 상태 변화는 새 휴대폰으로의 정상 동기화일 수 있습니다. 사용자에게 보여 줄 기기 label도 보안 식별자가 아니라 설명용 값이며, user-agent나 IP만으로 물리 기기를 확정하면 안 됩니다.

signature counter도 같은 태도로 다룹니다. 새 `signCount`가 저장 값보다 작거나 같고 둘 중 하나가 0이 아니라면 clone 또는 인증기 이상, 병렬 요청 처리 순서 문제를 의심할 수 있습니다. 그러나 counter가 항상 0인 인증기도 있고, mismatch만으로 원본과 복제본 중 무엇이 공격자인지는 알 수 없습니다. 기본 정책은 `credential.counter_anomaly`를 남기고, 고위험 경로에서는 step-up을 요구하거나 해당 credential을 잠시 suspend한 뒤 사용자의 확인을 받는 것입니다. 즉시 전 계정 잠금은 명확한 추가 위험 신호가 있을 때만 검토합니다.

## 실무 적용

### 1) 등록과 인증 API를 두 단계로 분리한다

한 HTTP 요청에서 옵션을 만들고 credential을 검증하려 하면 challenge 저장과 재시도 제어가 흐려집니다. 시작과 완료를 분리하고 각각의 입력·출력을 계약으로 둡니다.

| 단계 | 서버가 반환하거나 받는 것 | 반드시 확인할 것 | 실패 시 처리 |
| --- | --- | --- | --- |
| `POST /passkeys/registration/options` | challenge, rp, user, credential options | 현재 세션의 auth level, 계정당 credential 상한 | audit 없이 상세 오류 노출 금지 |
| `POST /passkeys/registration/verify` | attestation response | challenge, origin, rpIdHash, attestation policy, unique credential ID | ceremony 소비, 실패 reason 분류 |
| `POST /session/webauthn/options` | authentication challenge | rate limit, usernameless/username flow 구분 | 계정 존재 여부를 응답 차이로 누설하지 않기 |
| `POST /session/webauthn/verify` | assertion response | challenge, credential state, signature, UP/UV, counter | session 생성·회수 정책 적용 |

등록은 계정 탈취자가 새 credential을 심는 경로가 될 수 있습니다. 로그인 세션이 있다고 바로 허용하지 말고, 이메일·비밀번호 변경과 같은 tier에서는 최근 10분 안의 UV passkey 또는 다른 강한 factor를 요구합니다. 예를 들어 일반 사용자의 새 passkey 등록은 최근 인증 15분 이내, 관리자·결제 권한 계정은 5분 이내의 UV와 사용자 알림을 기본값으로 둘 수 있습니다. 계정당 active credential 수는 처음에는 10개 이하로 제한하고, 90일 이상 미사용 credential은 삭제 전에 사용자 확인 후보로 표시하는 편이 관리 가능성이 좋습니다.

### 2) Passkey 성공 뒤에도 세션 정책을 새로 적용한다

WebAuthn assertion 검증은 "이 credential으로 이 challenge에 서명했다"는 증명입니다. 그 결과를 얼마나 오래 어떤 scope로 인정할지는 애플리케이션 정책입니다. 일반 읽기와 관리자 권한 변경을 같은 인증 직후 상태로 다루지 마세요.

| 경로 | 권장 user verification | session 처리 출발점 | 추가 조건 |
| --- | --- | --- | --- |
| 일반 로그인 | preferred 또는 서비스 정책 | 5~15분 access token, 일반 refresh/session | 새 국가·ASN은 위험 신호 기록 |
| 프로필·일반 쓰기 | preferred | 기존 session 유지 가능 | CSRF·멱등성은 별도 적용 |
| 이메일·비밀번호·복구 수단 변경 | required | 최근 인증 5~10분 이내 | 현재 session registry online 확인 |
| 결제·관리자 권한·API key 발급 | required | action 단위 step-up receipt | 재인증 후 5분 이내, 감사 로그 |

이 정책은 [Device Session Registry](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)와 연결됩니다. assertion을 통과했다는 사실, 만든 session ID, credential ID, UV 여부, risk decision을 같은 correlation ID로 남기면 나중에 "어떤 passkey로 어떤 권한 변경이 일어났는가"를 설명할 수 있습니다. credential ID 자체와 attestation object 전체를 애플리케이션 로그에 무심코 넣지 말고, 접근 통제된 audit store에는 최소 식별자와 이벤트 요약만 저장합니다.

### 3) 도입은 fallback 제거가 아니라 약한 복구 경로 강화부터 시작한다

passkey를 켜자마자 비밀번호를 끄는 것은 제품 요구에 따라 위험할 수 있습니다. 첫 2주에는 지원되는 브라우저 비율, registration 완료율, `NotAllowedError` 비율, ceremony 만료율을 관찰하고 기존 로그인과 병행할 수 있습니다. 이때 "passkey를 쓸 수 없는 사용자"가 정확히 무엇을 할 수 있는지 문서화해야 합니다.

특히 복구 이메일 하나가 passkey 추가보다 약하면 공격자는 당연히 복구로 갑니다. 복구에는 다음을 최소 경계로 둡니다.

- 복구 요청 성공 여부가 계정 존재를 드러내지 않는 응답과 IP·계정별 rate limit
- 이메일 변경 직후 바로 passkey 등록을 허용하지 않는 대기 또는 추가 확인
- 복구 완료 뒤 기존 interactive session과 고위험 credential의 회수 범위
- support 담당자의 본인 확인, temporary access, credential 추가를 분리한 감사 절차
- 새 passkey 등록과 credential 삭제의 사용자 알림 및 24시간 내 취소·신고 경로

목표는 passkey 비율을 빠르게 100%로 만드는 일이 아니라, **가장 약한 계정 탈취 경로를 passkey 수준 이하로 끌어올리는 일**입니다. 비밀번호 fallback이 필요한 조직은 [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/)처럼 breach 대응, 재설정, MFA, session revoke를 함께 유지해야 합니다.

## 트레이드오프/주의점

첫째, attestation을 많이 검증할수록 인증기 모델과 보안 속성에 관한 정보를 더 얻을 수 있지만, 지원 폭·운영 복잡도·개인정보 고려가 늘어납니다. 일반 소비자 서비스는 attestation을 `none` 또는 최소 정책으로 두고, 특정 관리 단말만 허용해야 하는 경우에만 enterprise attestation과 device inventory를 별도 검토하는 편이 현실적입니다. attestation이 있다고 해서 현재 사용자가 의도한 기기라는 보장은 아닙니다.

둘째, discoverable credential은 username-first 화면을 줄여 주지만 계정 존재를 노출하지 않는 오류 처리, account selector UX, 복수 계정 처리 테스트가 더 필요합니다. 반대로 `allowCredentials`에 여러 credential ID를 매번 싣는 방식은 사용자의 기기별 credential 분포를 서버가 더 세밀하게 관리해야 합니다. 어느 UX를 택해도 서버의 challenge·origin 검증 의무는 변하지 않습니다.

셋째, library를 도입했다고 보안 검증을 외주 준 것이 아닙니다. RP ID 설정, origin allowlist, reverse proxy 구성, session issuance, recovery policy는 라이브러리가 정해 주지 않습니다. upgrade 때는 정상 등록·로그인만 보지 말고 이전 challenge replay, 다른 origin 응답, 만료 challenge, revoked credential, UV 없는 assertion, counter anomaly를 포함한 contract test를 돌려야 합니다.

마지막으로 passkey는 phishing-resistant한 인증 수단이 될 수 있지만 모든 제품 위험을 제거하지 않습니다. 세션 탈취, 사용자의 승인 피로, support impersonation, 권한 과다 부여, 취약한 복구 절차는 별도 문제입니다. 인증 성공을 권한 승인과 동일시하지 않는 것이 가장 중요한 방어선입니다.

## 체크리스트 또는 연습

### 배포 전 체크리스트

- [ ] registration·authentication challenge는 서버가 32바이트 이상으로 생성하고 5분 이내·한 번만 소비한다.
- [ ] `type`, challenge, exact origin, `rpIdHash`, UP/UV flags, credential state, signature를 모두 검증한다.
- [ ] expected origin은 사용자 입력 Host가 아니라 환경별 allowlist에서 결정한다.
- [ ] credential ID와 public key의 unique 제약, state, last used, counter, backup metadata를 저장한다.
- [ ] counter mismatch와 backup state 변경을 탈취 확정이 아닌 위험 신호로 기록하고 후속 정책을 정했다.
- [ ] passkey 삭제·복구·새 등록이 어떤 device session을 회수하거나 step-up할지 사건별로 문서화했다.
- [ ] 등록/로그인/복구 API에 계정·IP별 rate limit과 계정 존재를 숨기는 응답이 있다.
- [ ] challenge replay, origin mismatch, expired ceremony, revoked credential, UV 부족을 통합 테스트한다.

### 연습: 관리자 콘솔용 정책표 만들기

관리자 계정의 passkey 도입을 가정하고 다음을 한 장으로 정리해 보세요.

1. 일반 로그인, 새 credential 등록, API key 발급, 결제 정보 변경마다 `preferred`와 `required` 중 어떤 UV 정책을 쓸지 고릅니다.
2. challenge TTL, 최근 인증 허용 시간, active credential 상한, counter anomaly 후 제한 시간을 숫자로 정합니다. 예: `TTL 5분`, `등록 재인증 5분`, `credential 최대 5개`, `anomaly 시 30분 고위험 행동 차단`.
3. 기기를 분실한 사용자가 credential 하나를 revoke했을 때 현재 기기·다른 기기·API key 중 어디까지 회수할지 결정합니다.
4. password reset 또는 support 복구가 같은 날 새 passkey를 추가할 수 있는 조건과 사용자 통지 방법을 적습니다.

## 관련 글

- [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/)
- [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/)
- [Device Session Registry](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)
- [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
