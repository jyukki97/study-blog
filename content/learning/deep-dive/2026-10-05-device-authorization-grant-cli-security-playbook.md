---
title: "백엔드 커리큘럼 심화: OAuth Device Authorization Grant, CLI·TV 로그인에서 사용자 승인과 토큰 회수를 안전하게 설계하는 법"
date: 2026-10-05T10:06:00+09:00
lastmod: 2026-10-05T10:06:00+09:00
draft: false
topic: "Authentication"
tags: ["OAuth 2.0", "Device Authorization Grant", "CLI Security", "Token Lifecycle", "Phishing Resistance", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "브라우저를 직접 띄우기 어렵거나 입력이 제한된 CLI·TV·IoT에서 OAuth Device Authorization Grant를 안전하게 운영하기 위해 user code, 승인 URL, polling, scope, 토큰 회수, 감사 로그를 하나의 상태 전이로 설계하는 실무 플레이북입니다."
module: "security"
study_order: 1503
summary: "Device Authorization Grant는 화면 없는 장치의 편의 기능이 아니라, 사람이 승인한 계정·기기·scope·세션을 정확히 묶고 피싱성 user code 입력·polling 폭주·토큰 재사용·분실 기기를 관리하는 인증 상태 머신이다."
keywords: ["OAuth device authorization grant", "OAuth device flow security", "CLI login", "user code phishing", "device code polling", "OAuth token revocation"]
key_takeaways:
  - "device_code는 토큰이 아니며 서버의 승인 대기 상태와 정확히 한 번의 token exchange로만 연결해야 한다."
  - "승인 화면에는 account, client, requested scope, device label, 만료 시각을 함께 표시해야 한다."
  - "polling interval은 authorization server가 정하고, CLI는 slow_down·expired_token·access_denied를 재시도로 덮지 않아야 한다."
  - "토큰 발급 뒤에는 device session registry, refresh token family, revoke 경로까지 연결해야 분실 기기를 회수할 수 있다."
operator_checklist:
  - "authorization record에 hashed device_code, user_code, device label, scope, 승인 account, 만료, 상태를 남긴다."
  - "고권한 scope, 새 기기, 비정상 로그인은 step-up 인증 또는 추가 승인을 거치게 한다."
  - "polling request, slow_down, expired, denied, issued 비율과 p95 승인 시간을 일 단위로 본다."
---

CI 도구, 개발자 CLI, 스마트 TV처럼 입력이 제한된 장치는 일반적인 브라우저 redirect 로그인을 그대로 쓰기 어렵습니다. 이때 OAuth Device Authorization Grant는 기기가 `device_code`와 사람이 읽을 수 있는 `user_code`를 받고, 사용자가 별도 브라우저에서 승인한 뒤 기기가 토큰을 받게 하는 흐름입니다. 화면 없는 기기에 로그인 경험을 제공한다는 점에서 유용하지만, 코드를 화면에 띄웠다는 이유만으로 안전해지지는 않습니다.

실무에서 중요한 질문은 “device flow를 지원하는가”가 아닙니다. **어떤 사람이 어느 기기에서 어떤 scope를 승인했고, 기기를 잃어버렸을 때 몇 분 안에 권한을 회수할 수 있는가**가 핵심입니다. 이 글은 [OAuth 2.0와 OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/), [Device Session Registry와 Refresh Token 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/), [Step-Up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/), [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)을 CLI 인증 경계로 연결합니다.

## 이 글에서 얻는 것

- Device Authorization Grant가 Authorization Code + PKCE와 다른 위협 모델을 이해합니다.
- `device_code`, `user_code`, device label, 승인 계정, requested scope를 하나의 승인 기록으로 묶는 방법을 배웁니다.
- polling 간격·만료·거부·사용자 취소를 재시도 폭주 없이 처리하는 기준을 세웁니다.
- 토큰 발급 뒤 기기 등록, refresh token 회전, 분실 기기 revoke까지 운영 흐름을 설계합니다.

## 핵심 개념/이슈

### 1) 두 개의 코드는 같은 비밀이 아니다

`device_code`는 token endpoint에서 polling할 때 쓰는 고엔트로피 비밀값입니다. 로그·터미널 히스토리·스크린샷에 남아서는 안 됩니다. 반면 `user_code`는 사람이 승인 화면에서 입력하거나 대조할 짧은 값입니다. 사람이 읽기 쉬운 만큼 추측·오입력·피싱 가능성을 전제로 설계해야 합니다.

안전한 순서는 네 단계입니다. CLI는 `device_code`를 메모리에만 보관하고 화면에는 공식 승인 URL과 `user_code`만 보입니다. 사용자는 로그인한 뒤 **CLI 이름, 기기 라벨, 요청 scope, 만료 시각**이 맞는지 확인합니다. 서버는 승인 account와 인증 강도를 해당 authorization record에 고정합니다. 마지막으로 CLI가 정해진 간격으로 polling하고, 서버는 같은 record에 토큰을 정확히 한 번만 발급합니다.

특히 `user_code`만 보고 승인을 받으면 공격자가 메신저로 “이 코드를 입력해 달라”고 보내 피해자의 계정으로 자기 CLI를 승인받을 수 있습니다. 승인 화면에는 `Release CLI on MacBook`, `production:read`, `7분 후 만료`처럼 사용자가 맥락을 비교할 정보를 보여 줍니다. production deploy나 조직 설정처럼 부작용이 큰 scope는 code 승인만으로 주지 말고 [Step-Up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)의 재인증을 붙이는 편이 안전합니다.

### 2) Device Flow는 승인 대기 상태 머신이다

토큰 발급 여부를 boolean 하나로 기록하면 만료·취소·중복 polling을 설명할 수 없습니다. 시작점으로는 다음 상태가 실용적입니다.

| 상태 | 의미 | 다음 상태 | 서버 책임 |
| --- | --- | --- | --- |
| `PENDING` | 기기가 code를 받았고 아직 승인 전 | `APPROVED`, `DENIED`, `EXPIRED` | 횟수·만료·client 추적 |
| `APPROVED` | 로그인과 scope 동의 완료 | `ISSUED`, `DENIED`, `EXPIRED` | subject·MFA·정책 버전 고정 |
| `ISSUED` | token exchange 한 번 성공 | 종료 | 재요청은 재사용 오류 처리 |
| `DENIED` | 사용자 또는 정책이 거부 | 종료 | 사유를 과도하게 노출하지 않고 감사 |
| `EXPIRED` | 승인 전 유효 시간이 끝남 | 종료 | token 교환을 절대 허용하지 않음 |

`device_code` 원문을 DB에 보관할 이유는 없습니다. nonce처럼 충분한 엔트로피를 주고 서버에는 HMAC 또는 password hash, 만료 시각만 저장합니다. polling이 들어오면 짧은 트랜잭션에서 `APPROVED → ISSUED`를 compare-and-set으로 전이합니다. 이 조건이 없으면 네트워크 재전송이나 두 프로세스의 polling이 같은 code로 두 개의 refresh token family를 만들 수 있습니다.

### 3) polling은 대기 UX가 아니라 서버 보호 정책이다

승인까지 5분 걸리고 CLI가 1초마다 polling하면 사용자 한 명이 300회의 토큰 요청을 만듭니다. 1,000명이 동시에 로그인하면 인증 서버가 실제 로그인보다 대기 요청에 먼저 밀립니다. authorization server가 준 `interval`을 클라이언트 계약으로 두고, 보통 **5초 이상**에서 시작합니다. 서버가 `slow_down`을 응답하면 CLI는 다음 요청부터 최소 5초를 더 기다려야 합니다.

| 응답 | CLI 행동 | 재시도하면 안 되는 이유 |
| --- | --- | --- |
| `authorization_pending` | interval 후 다시 조회 | 정상 대기 상태 |
| `slow_down` | interval을 늘려 조회 | polling 자체가 과부하 원인이 됨 |
| `access_denied` | 즉시 종료 | 사용자의 거부를 자동으로 뒤집으면 안 됨 |
| `expired_token` | 새 authorization 시작 | 만료 code 재사용은 권한 혼란을 만듦 |
| network timeout | 1~2회 jitter 재시도 | CLI와 SDK 재시도가 겹치면 폭주 |

내부 개발 CLI는 device code TTL **5~10분**, TV처럼 입력 전환이 느린 장치는 **10~15분**을 출발점으로 둘 수 있습니다. p95 승인 시간이 TTL의 70%를 넘으면 무작정 TTL을 늘리기보다 승인 화면·SSO·네트워크를 먼저 점검합니다. 만료 직전 승인과 token exchange의 기준 시계는 언제나 서버입니다.

## 실무 적용

### 1) 승인 기록을 authorization artifact로 만든다

최소 schema에는 “누가 승인했는가”뿐 아니라 “무엇을 승인했는가”가 남아야 합니다.

```text
device_authorization
- authorization_id, client_id, client_version, device_label
- device_code_hash, user_code_hash, requested_scopes, resource_audience
- status, expires_at, poll_interval_seconds
- approved_subject_id, approved_at, auth_strength, policy_version
- issued_at, token_family_id, revoked_at
```

공개 CLI는 client secret을 안전하게 숨길 수 없습니다. 따라서 `client_id`만으로 신뢰하지 말고 scope allowlist, resource audience, 조직 membership, device posture처럼 서버가 판정 가능한 조건을 결합해야 합니다. 요청 scope가 `repo:read`에서 `repo:write`로 넓어지거나 평소와 다른 resource라면 기존 브라우저 세션만으로 승인하지 않는 편이 낫습니다.

### 2) 토큰보다 기기 세션을 운영 단위로 본다

CLI가 refresh token을 보관한다면 로그아웃은 로컬 파일 삭제가 아닙니다. 서버는 `device_session_id` 또는 `token_family_id`를 만들고 보안 화면에서 기기명·최근 사용 시각·scope를 보여 줄 수 있어야 합니다. reuse가 탐지되면 해당 token 하나만 지우는 대신 family를 회수하고, 위험도에 따라 같은 계정의 다른 세션까지 조사합니다. 이 경로는 [Device Session Registry와 Refresh Token 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)와 연결합니다.

| 항목 | 시작 기준 | 조정 신호 |
| --- | --- | --- |
| access token TTL | 5~15분 | 고위험 resource는 더 짧게 |
| refresh token | rotation + family 단일 사용 | reuse 즉시 family revoke |
| 승인 감사 로그 | 최소 90일 | incident·compliance 요구에 따라 분리 |
| `slow_down` 비율 | 1% 이하 | 초과 시 client bug·과부하 점검 |

통합 테스트에는 성공 로그인 하나만 넣지 않습니다. `PENDING → EXPIRED`, 승인 직후 두 번의 polling, `DENIED` 뒤 재시도, `slow_down`, refresh token reuse, 권한 회수 뒤 API 호출을 모두 넣습니다. `device_code`나 refresh token이 access log, trace attribute, 오류 본문에 남지 않는지까지 확인해야 합니다.

## 트레이드오프/주의점

Device Flow는 브라우저 redirect를 못 쓰는 환경에서 좋은 선택이지 모든 앱의 더 편한 로그인 방식은 아닙니다. 모바일·웹처럼 system browser와 PKCE redirect를 쓸 수 있다면 Authorization Code Flow가 더 직관적입니다. 반대로 SSH로 접속한 개발자나 TV 앱에서 비밀번호를 직접 받는 방법보다 Device Flow가 안전할 수 있습니다.

device label을 너무 상세히 기록하면 자산명·사용자 이름이 support 화면과 감사 로그에 불필요하게 남습니다. 표시용 이름, 내부 device ID, IP·위치의 보존 기간을 분리합니다. “CLI이므로 낮은 위험”이라는 가정도 위험합니다. CI deploy, 데이터 export, production 관측 CLI는 사람용 dashboard보다 더 넓은 automation 권한을 가질 수 있으므로 `read`, `write`, `admin` 대신 resource·action·environment로 scope를 쪼갭니다.

마지막으로 사람의 승인·기기 회수·행위 감사가 필요한 경로에만 Device Flow를 씁니다. 무인 workload에는 사람 token이 아니라 workload identity나 제한된 service credential이 더 맞습니다.

## 체크리스트 또는 연습

- [ ] `device_code` 원문은 로그·URL·지원 티켓에 남지 않고 서버에는 hash와 만료 시각만 저장된다.
- [ ] 승인 화면에서 CLI/기기 라벨, account, scope, resource, 만료 시각을 대조할 수 있다.
- [ ] `PENDING`, `APPROVED`, `ISSUED`, `DENIED`, `EXPIRED` 전이가 원자적이며 `ISSUED`는 한 번만 가능하다.
- [ ] polling interval과 `slow_down`이 문서화되어 있고 SDK와 CLI가 중복 재시도하지 않는다.
- [ ] 고권한 scope와 새 기기에 step-up 또는 추가 승인이 있다.
- [ ] 사용자가 device session과 token family를 찾아 개별 revoke·logout-all을 실행할 수 있다.
- [ ] refresh reuse, 만료 code, 중복 polling, 권한 회수를 자동 테스트한다.

연습으로 내부 CLI 하나를 골라 device label, requested scope, token family, revoke owner를 표로 적어 보세요. 이어서 “노트북을 분실한 지 10분 뒤에도 이 CLI가 production write를 할 수 있는가?”를 기준으로 access token TTL과 세션 회수 경로를 다시 결정해 보세요. 숫자로 답할 수 있을 때 Device Flow는 편의 기능이 아니라 운영 가능한 인증 경계가 됩니다.
