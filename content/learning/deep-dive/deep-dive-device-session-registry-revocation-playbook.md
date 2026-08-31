---
title: "백엔드 커리큘럼 심화: Device Session Registry, 기기별 로그인·토큰 회수·침해 대응을 하나의 상태 모델로 설계하기"
date: 2026-08-28T10:06:00+09:00
lastmod: 2026-08-28T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["Session Security", "Refresh Token Rotation", "Device Session", "Token Revocation", "Authentication", "Backend Reliability"]
categories: ["Backend Deep Dive"]
keywords: ["device session registry", "refresh token family", "session revocation", "logout all devices", "token reuse detection"]
description: "여러 기기에서 로그인하는 서비스를 대상으로, 세션 레지스트리·refresh token family·회수 전파·침해 대응을 하나의 상태 모델과 운영 기준으로 정리합니다."
summary: "JWT를 발급했다는 사실만으로 로그인 운영이 끝나지 않습니다. 기기별 세션 상태, 토큰 교체 계보, 즉시 회수 범위, 짧은 access token, 감사 증거를 연결해야 로그아웃과 침해 대응이 실제로 작동합니다."
module: "backend-security"
study_order: 1475
key_takeaways:
  - "access token은 짧은 권한 증명이고, device session registry는 현재 허용 여부를 결정하는 서버 측 사실이다. 둘을 같은 것으로 취급하지 않는다."
  - "refresh token rotation은 새 토큰 발급 기능이 아니라 token family의 단일 사용 규칙과 재사용 탐지·전 세션 회수를 포함한 상태 전이다."
  - "회수는 DB 레코드 변경만으로 끝나지 않는다. access token 수명, cache 무효화, 이벤트 전파 지연, 고위험 경로의 online check를 함께 설계해야 한다."
operator_checklist:
  - "세션 레코드에 session_id, user_id, device label, auth method, issued_at, last_seen_at, absolute_expires_at, state, credential_version을 남긴다."
  - "refresh token 원문은 저장하지 않고 해시·family_id·parent token 식별자·used_at·replaced_by를 보존한다."
  - "token reuse, 비정상 국가/ASN, credential reset, 지원팀 강제 로그아웃의 회수 범위와 사용자 알림 기준을 문서화한다."
  - "즉시 차단이 필요한 admin·결제·개인정보 변경 경로는 회수 목록 또는 session registry를 online으로 확인한다."
learning_refs:
  - title: "JWT 인증과 세션 설계"
    href: "/learning/deep-dive/deep-dive-jwt-auth/"
    description: "세션과 JWT의 기본 구조, access/refresh token 역할을 먼저 잡는 글입니다."
  - title: "Password Credential Lifecycle"
    href: "/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/"
    description: "비밀번호 변경·재설정·침해 의심을 credential version과 세션 회수에 연결하는 기준입니다."
  - title: "고위험 행동 Step-up Authorization"
    href: "/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/"
    description: "로그인된 세션만으로 충분하지 않은 행동에 추가 인증을 붙이는 방법입니다."
  - title: "API Key Lifecycle과 회수"
    href: "/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/"
    description: "사람 세션과 자동화 자격증명의 회수 정책을 섞지 않는 기준입니다."
---

"모든 기기에서 로그아웃" 버튼은 단순히 쿠키를 지우는 기능이 아닙니다. 사용자는 자신의 노트북, 휴대폰, 태블릿과 잊어버린 브라우저에서 실제로 접근이 끊기기를 기대합니다. 보안팀은 refresh token이 재사용됐을 때 어느 세션을 침해로 볼지 알아야 하고, 고객지원팀은 특정 기기만 끊을지 전체 계정을 잠글지 설명할 수 있어야 합니다. 이 요구는 access token 하나만으로 해결되지 않습니다.

이 글에서는 기기별 로그인을 **Device Session Registry**라는 서버 측 상태로 모델링합니다. 이미 [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/), [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/), [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)에서 토큰, 자격증명, 추가 인증을 다뤘습니다. 여기서는 그 사이의 빈칸인 "현재 어느 기기의 어떤 권한이 유효한가"와 "그 권한을 어떻게 회수했음을 증명하는가"에 집중합니다.

## 이 글에서 얻는 것

- access token, refresh token, device session을 서로 다른 수명과 책임을 가진 상태로 분리할 수 있습니다.
- refresh token rotation을 token family의 단일 사용 규칙으로 만들고, 재사용이 탐지됐을 때의 대응 범위를 정할 수 있습니다.
- 단일 기기 로그아웃, 전체 로그아웃, 비밀번호 재설정, 계정 탈취 의심을 같은 회수 모델로 운영할 수 있습니다.
- 회수 전파 지연과 사용자 경험 비용을 숫자로 다루는 최소 운영 기준을 얻습니다.

## 핵심 개념/이슈

### 1) 토큰은 증명서이고, 세션 레지스트리는 현재 상태다

서명 검증에 성공한 JWT는 "발급 시점에 이 사용자가 이 권한을 가졌고, 아직 만료 시각 전이다"를 보여 줍니다. 그러나 노트북을 분실했는지, 사용자가 로그아웃했는지, 비밀번호가 재설정됐는지까지는 혼자 알지 못합니다. 그래서 장기 로그인이나 여러 기기를 지원한다면 서버는 **세션의 현재 상태**를 따로 가져야 합니다.

최소 레코드는 다음 정도면 출발할 수 있습니다.

```yaml
device_session:
  session_id: "ses_01J..."
  user_id: "usr_123"
  device_label: "Chrome on macOS"
  auth_level: "password+mfa"
  created_at: "2026-08-28T01:00:00Z"
  last_seen_at: "2026-08-28T01:05:00Z"
  idle_expires_at: "2026-09-11T01:05:00Z"
  absolute_expires_at: "2026-09-27T01:00:00Z"
  credential_version: 12
  state: "active" # active | revoked | expired | suspicious
```

여기서 `device_label`은 보안 식별자가 아닙니다. 사용자와 지원 담당자가 "어느 로그인인지" 알아보기 위한 설명 값입니다. 브라우저 user-agent나 IP만으로 기기를 유일하게 식별하려 하면 업데이트·NAT·프라이버시 설정 때문에 오판합니다. 권한 판단의 기준은 예측하기 어려운 `session_id`와 서버의 `state`여야 합니다.

이 분리는 선택지를 선명하게 만듭니다. 읽기 전용 API는 짧은 access token만 검사해도 비용이 낮습니다. 반면 결제수단 변경, MFA 해제, 이메일 변경, API key 발급처럼 피해가 큰 행동은 `session_id`가 active인지와 `auth_level`이 충분한지를 online으로 재확인할 수 있습니다. [Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)의 추가 인증도 이 세션 레코드에 기록해야 다음 요청에서 증명할 수 있습니다.

### 2) Refresh rotation은 교체 기능이 아니라 계보를 닫는 규칙이다

refresh token을 오래 살려 두고 매번 같은 값을 보내게 하면, 탈취된 복사본을 구분할 방법이 거의 없습니다. rotation은 refresh 요청이 성공할 때마다 기존 token을 소비 처리하고 새 token을 발급하는 방식입니다. 이때 중요한 것은 새 문자열이 아니라 **어떤 token이 어떤 후속 token으로 교체됐는지**입니다.

```text
family F-91
R0(active) -- refresh 성공 --> R0(used) + R1(active)
R0가 다시 제출됨             --> reuse detected -> F-91 revoked
```

DB에는 refresh token 원문 대신 충분히 느린 해시 또는 keyed hash를 저장합니다. 레코드에는 `family_id`, `session_id`, `token_hash`, `issued_at`, `used_at`, `expires_at`, `replaced_by`, `revoked_at`가 필요합니다. refresh 요청은 반드시 트랜잭션 또는 compare-and-set으로 `active -> used` 전이를 한 번만 허용해야 합니다. 두 요청이 거의 동시에 들어왔을 때 둘 다 새 token을 받으면 rotation이 무력해집니다.

재사용이 탐지됐다고 무조건 계정 전체를 잠글 필요는 없습니다. 기본 대응은 해당 family와 연결된 device session을 revoke하고 사용자에게 알리는 것입니다. 다만 새 국가·새 ASN·불가능한 이동 시간·고위험 계정 변경이 함께 보이면 같은 사용자의 모든 browser session을 회수하고 step-up을 요구할 수 있습니다. 판단 우선순위는 **실제 탈취 가능성 > 정상 사용자의 복구 가능성 > 불필요한 전체 로그아웃 방지**가 적절합니다.

### 3) 로그아웃은 세 층에서 닫혀야 한다

`DELETE FROM sessions`만 수행하면 이미 발급된 access token은 만료 전까지 살아 있을 수 있습니다. 반대로 모든 API에서 DB를 조회하면 무상태 token의 성능 이점을 잃습니다. 따라서 회수는 다음 세 층을 함께 설계합니다.

| 층 | 역할 | 권장 출발점 |
| --- | --- | --- |
| access token | 짧은 시간의 일반 요청 인증 | 5~15분 TTL, 민감 정보 최소화 |
| session registry | 기기별 현재 허용 상태와 credential version | logout·reset·침해 때 즉시 변경 |
| revoke propagation | 서비스·gateway·cache가 변경을 빠르게 알도록 함 | 이벤트 발행 + 캐시 TTL 상한 |

일반 API는 access token의 짧은 TTL로 회수 지연을 제한합니다. 더 짧은 차단이 필요하면 `session_id` 또는 `jti`의 revoke 사실을 cache에 배포합니다. 예를 들어 cache TTL을 60초로 둔 서비스는 최악의 회수 전파 시간을 60초 이상으로 약속하면 안 됩니다. admin API처럼 1분도 긴 경로는 registry나 중앙 introspection을 직접 조회해야 합니다.

회수 이벤트에는 단순한 사용자 ID보다 더 많은 맥락이 필요합니다.

```json
{
  "type": "session.revoked",
  "session_id": "ses_01J...",
  "user_id": "usr_123",
  "reason": "refresh_token_reuse",
  "revoked_at": "2026-08-28T01:20:00Z",
  "credential_version": 13,
  "correlation_id": "sec_8f3..."
}
```

이 이벤트는 [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)처럼 상태 변경과 같은 트랜잭션에서 안전하게 기록하는 편이 좋습니다. 인증 DB는 revoke됐는데 다른 서비스의 cache 무효화 이벤트가 유실되면 사용자가 기대한 "즉시 로그아웃"이 깨질 수 있기 때문입니다.

### 4) 회수 범위는 이벤트별로 다르다

모든 보안 이벤트에 전체 로그아웃을 적용하면 사용자가 MFA, 장기 실행 작업, 신뢰 기기를 잃습니다. 반대로 범위를 너무 좁게 잡으면 탈취된 세션이 남습니다. 아래처럼 사건과 범위를 미리 매핑해 두면 on-call 판단이 빨라집니다.

| 이벤트 | 기본 회수 범위 | 추가 행동 |
| --- | --- | --- |
| 사용자의 현재 기기 로그아웃 | 현재 session 하나 | refresh family와 cookie 삭제 |
| 사용자의 전체 로그아웃 | 모든 browser/device session | API key·service account는 별도 정책 |
| 비밀번호 변경 | 다른 device session 원칙적 회수 | 현재 기기는 재인증 후 새 세션 발급 |
| 재설정 링크 사용 | 모든 interactive session 회수 | 24시간 고위험 행동 step-up |
| refresh token 재사용 | 해당 family·device session 즉시 회수 | 사용자 알림, 위험 신호 평가 |
| 계정 탈취 확신 | 모든 interactive session 회수 | credential version 증가, MFA 복구 절차 |

자동화 API key와 사람의 browser session을 같은 "로그인"으로 취급하면 운영이 위험합니다. API key 회수는 호출 중인 배치와 외부 고객에게 영향을 줄 수 있어, [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)처럼 별도 owner, 만료, 교체 창을 둬야 합니다.

### 5) 좋은 세션 운영은 목록 화면보다 증거가 중요하다

"최근 로그인 기기" UI가 있어도 실제 상태와 어긋나면 사용자는 잘못된 안심을 합니다. 최소한 다음 지표를 분리해서 봅니다.

- `active_device_sessions_per_user_p95`: 비정상적으로 많은 동시 세션 탐지
- `refresh_rotation_reuse_total`: family 재사용 탐지와 오탐 비율
- `revocation_propagation_lag_p95`: revoke commit부터 각 검증 계층 반영까지의 시간
- `revoked_session_request_total`: 회수 후에도 들어오는 요청의 양과 경로
- `session_registry_online_check_error_rate`: 민감 경로의 fail-closed 부담
- `idle_expired_sessions_cleanup_lag`: 만료 레코드 정리 지연

특히 `revoked_session_request_total`은 침해 확정 지표가 아닙니다. 브라우저 탭이 늦게 재시도하거나 모바일 앱이 오래된 refresh token을 갖고 있을 수도 있습니다. 하지만 회수 직후 이 값이 급증하고 같은 session이 여러 IP에서 보이면 조사 우선순위를 올릴 충분한 근거가 됩니다.

## 실무 적용

### 1) 위험도에 따라 수명과 확인 방식을 나눈다

처음부터 모든 요청에 session registry 조회를 넣지 말고, 피해 규모를 기준으로 나눕니다.

| 경로 | access token | registry 확인 | 권장 조건 |
| --- | --- | --- | --- |
| 일반 읽기 | 5~15분 | 보통 생략 | revoke cache TTL로 지연 한정 |
| 일반 쓰기 | 5~15분 | 위험 신호 시 | idempotency와 감사 로그 유지 |
| 이메일·비밀번호 변경 | 5분 이하 | 매 요청 확인 | 최근 MFA/재인증 필요 |
| 결제·권한·API key 발급 | 5분 이하 | 매 요청 확인 | step-up, correlation ID, audit 필수 |
| 관리자 지원 도구 | 짧거나 one-time | 매 요청 확인 | impersonation session 별도 scope |

browser refresh token의 absolute lifetime은 14~30일, idle timeout은 7~14일 정도부터 실험할 수 있습니다. 다만 개인 금융, 의료, B2B 관리자 콘솔은 더 짧아야 할 수 있습니다. 숫자를 정하기 전에 "분실 기기가 몇 분 동안 살아도 되는가", "강제 로그아웃이 하루에 몇 번 발생해도 지원 비용을 감당하는가"를 합의해야 합니다.

### 2) 데이터 모델과 동시성부터 테스트한다

세션 테이블에는 최소한 `(user_id, state)`, `(absolute_expires_at)`, `session_id` 인덱스가 필요합니다. refresh token family는 `token_hash` unique index와 `family_id` 조회 경로를 둡니다. rotation 테스트에는 반드시 다음 경합을 넣으세요.

1. 같은 refresh token으로 요청 두 개를 동시에 보낸다.
2. 한 요청만 새 token을 받고 다른 요청은 reuse로 판정되는지 확인한다.
3. reuse 판정 뒤 새 token으로도 refresh가 거절되는지 확인한다.
4. revoke event 소비자가 잠시 멈춰도 access token TTL과 online check가 약속한 범위 안에서 막는지 확인한다.

이 테스트는 happy path보다 중요합니다. 탈취나 네트워크 retry는 대부분 두 refresh 요청이 겹치는 모습으로 나타나기 때문입니다.

### 3) 도입은 관측 모드에서 시작한다

기존 refresh token을 바로 one-time rotation으로 바꾸면 오래된 모바일 앱의 병렬 retry가 대량 로그아웃을 만들 수 있습니다. 첫 주에는 reuse 신호를 차단하지 않고 기록만 하는 observe mode를 둘 수 있습니다. 이때 앱 버전, 네트워크 오류, 요청 간격, 동일 device 여부를 수집해 정상 동시 요청 비율을 파악합니다.

그다음 저위험 사용자 집단에서 family 회수와 알림을 켜고, `revocation_propagation_lag_p95`가 목표(예: 60초 이하)를 만족하는지 봅니다. 마지막으로 admin·결제 같은 민감 경로에 online registry check를 추가합니다. 순서는 **증거 수집 → 좁은 강제 → 고위험 경로 강화**가 안전합니다.

## 트레이드오프/주의점

세션 레지스트리는 편의와 비용을 늘립니다. DB 또는 Redis 장애가 로그인과 고위험 행동을 막을 수 있고, device label은 사용자를 정확히 식별하는 증거가 아닙니다. 그러므로 registry 조회가 실패했을 때 일반 읽기는 짧은 access token으로 제한 허용할지, 결제·권한 변경은 fail-closed로 막을지 경로별로 정해야 합니다.

rotation도 무조건 공격을 뜻하지는 않습니다. 모바일 네트워크의 retry, 여러 탭, 오래된 SDK가 같은 refresh token을 거의 동시에 보낼 수 있습니다. 그렇다고 reuse를 무시하면 탈취 탐지가 사라집니다. observe mode와 앱 버전별 rollout으로 정상 경합을 줄인 뒤, 재사용 시에는 family를 닫는 단순한 규칙을 유지하는 편이 좋습니다.

마지막으로 로그에는 refresh token, 쿠키, 원문 IP, user-agent 전체를 무심코 넣지 마세요. 필요하면 해시·요약·보존 기간을 정하고, incident 조사에 필요한 최소 증거만 접근 제어된 audit store에 남깁니다. 세션 보안의 목표는 더 많은 추적이 아니라 **회수 판단에 필요한 사실을 안전하게 남기는 것**입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] device session과 refresh token family를 별도 상태로 저장하고, 원문 refresh token은 보관하지 않는다.
- [ ] access token TTL, idle timeout, absolute timeout, revoke propagation 목표를 서비스 위험도별로 문서화했다.
- [ ] refresh token의 `active -> used` 전이가 동시 요청에서 한 번만 성공한다.
- [ ] token reuse 시 family·session·전체 계정 중 어느 범위를 회수할지 위험 신호와 함께 정했다.
- [ ] 비밀번호 재설정, MFA 변경, 계정 탈취 대응에서 interactive session 회수와 credential version 증가가 연결된다.
- [ ] admin·결제·개인정보 변경은 session registry 또는 revoke state를 online으로 확인한다.
- [ ] revoke event의 p95 전파 지연과 회수 뒤 요청량을 관측한다.
- [ ] API key와 사람의 browser session은 같은 전체 로그아웃 정책으로 묶지 않는다.

### 연습: 기기 분실 사건을 런북으로 바꾸기

사용자가 "카페 PC에서 로그아웃을 못 했다"고 신고했다고 가정해 보세요.

1. 해당 session 하나를 찾기 위해 어떤 안전한 표시값과 audit field가 필요한지 적습니다.
2. session revoke commit, refresh family 폐기, cookie 제거, cache 무효화 사이의 최대 허용 시간을 숫자로 정합니다.
3. 60초 안에 회수를 약속할 수 없는 경로를 골라 access token TTL 축소 또는 online registry check 중 무엇을 적용할지 결정합니다.
4. 사용자 알림에 포함할 시각·대략 위치·기기 표시와, 포함하면 안 되는 민감 정보를 구분합니다.

## 관련 글

- [JWT 인증과 세션 설계](/learning/deep-dive/deep-dive-jwt-auth/)
- [Password Credential Lifecycle](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/)
- [고위험 행동 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
- [API Key Lifecycle과 회수](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)
