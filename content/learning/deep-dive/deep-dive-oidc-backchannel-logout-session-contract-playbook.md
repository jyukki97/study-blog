---
title: "백엔드 커리큘럼 심화: OIDC Back-Channel Logout, SSO 종료 이벤트를 세션 무효화 계약으로 운영하는 법"
date: 2026-09-03T10:06:00+09:00
lastmod: 2026-09-03T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["OpenID Connect", "SSO", "Back-Channel Logout", "Session Revocation", "JWT Validation", "Backend Security"]
categories: ["Backend Deep Dive"]
keywords: ["OIDC back-channel logout", "SSO session revocation", "logout token validation", "sid session mapping", "single logout"]
description: "OIDC Back-Channel Logout을 브라우저 쿠키 삭제가 아닌, issuer·subject·sid·세션 상태·재시도·감사 증거를 갖춘 SSO 세션 무효화 계약으로 설계하는 기준을 정리합니다."
summary: "SSO 로그아웃은 화면을 다른 주소로 돌려보내는 일이 아니라, IdP가 보낸 Logout Token을 검증해 각 애플리케이션의 서버 세션과 권한 캐시를 일관되게 닫는 작업이다. Back-Channel Logout은 브라우저 의존성을 줄이지만, 세션 상관관계·JWT 혼동 방지·재시도·전파 지연을 명시하지 않으면 부분 로그아웃을 만들 수 있다."
module: "backend-security"
study_order: 1485
key_takeaways:
  - "Back-Channel Logout의 입력은 일반 ID Token이나 access token이 아니라, issuer·audience·events·sid 또는 sub 조건을 만족하는 별도 Logout Token이다."
  - "RP는 로그인 때부터 issuer, subject, sid, local session_id의 대응을 보존해야 특정 브라우저 세션만 닫을지 사용자 전체 세션을 닫을지 예측 가능하게 결정할 수 있다."
  - "유효한 logout 요청의 중복은 정상 시나리오다. jti 재사용 방지와 이미 회수된 세션의 성공 응답을 함께 설계해야 IdP 재시도가 logout storm이 되는 일을 막는다."
  - "세션 DB를 revoke한 사실과 gateway·cache·다른 서비스가 실제로 접근을 막은 사실은 다르므로 전파 지연, access token TTL, 고위험 경로 online check를 함께 측정해야 한다."
operator_checklist:
  - "OIDC Discovery에서 backchannel_logout_supported와 sid 제공 여부를 확인하고, IdP 등록값과 RP endpoint를 환경별로 고정한다."
  - "로그인 성공 시 issuer, sub, sid, client_id, local session_id, credential_version을 서버 레지스트리에 저장한다."
  - "Logout Token은 서명·alg·iss·aud·iat·exp·events·sid/sub·nonce 부재를 검증한 뒤에만 상태 변경한다."
  - "issuer+jti를 exp 이후의 짧은 여유 기간까지 dedup하고, unknown 또는 이미 revoked 세션은 성공으로 끝내 재시도를 안전하게 만든다."
  - "admin·결제·개인정보 변경은 session registry를 online 검증하고, 일반 API는 짧은 access token과 revoke cache로 회수 지연 상한을 둔다."
learning_refs:
  - title: "OAuth2/OIDC 실무"
    href: "/learning/deep-dive/deep-dive-oauth2-oidc/"
    description: "OIDC Discovery, ID Token, issuer·audience 검증의 기본 계약입니다."
  - title: "Device Session Registry와 회수"
    href: "/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/"
    description: "기기별 세션 상태와 refresh token family를 서버 측 사실로 관리하는 방법입니다."
  - title: "Token Exchange와 Downscoped Token"
    href: "/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/"
    description: "로그아웃 뒤에도 남을 수 있는 서비스 간 권한을 짧고 좁게 만드는 기준입니다."
  - title: "Transactional Outbox + CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "세션 회수 상태 변경과 cache 무효화 이벤트를 이중 쓰기 없이 전파하는 방법입니다."
decision_guide:
  title: "Back-Channel Logout을 우선 적용할 곳"
  intro: "판단 기준은 SSO 버튼의 유무가 아니라, IdP에서 로그아웃·계정 비활성화·위험 신호가 발생했을 때 각 RP의 서버 세션을 브라우저 활성 상태와 무관하게 닫아야 하는가입니다."
  cases:
    - badge: "우선 적용"
      title: "관리자·결제·고객 데이터 서비스가 외부 또는 중앙 IdP의 SSO를 공유한다"
      fit: "IdP 세션 종료 뒤에도 여러 RP의 세션이 오래 남으면 피해가 큰 구조입니다."
      watchouts: "IdP가 RP endpoint에 도달할 수 있는 네트워크 경로와 per-client sid 매핑을 먼저 검증해야 합니다."
      next_step: "가장 위험한 RP 한 곳에서 sid 기반 single-session logout fixture와 재시도 테스트를 만듭니다."
    - badge: "부분 적용"
      title: "직원 포털은 SSO지만 일반 사용자 앱은 자체 로그인이다"
      fit: "IdP 연동 세션만 back-channel 대상이고, 자체 credential의 회수 경로는 기존 registry가 더 적합한 경우입니다."
      watchouts: "IdP subject를 내부 user_id와 느슨한 이메일 문자열로 조인하면 계정 병합 사고가 날 수 있습니다."
      next_step: "identity-link 테이블에 issuer+sub의 불변 키와 연결 승인 이력을 추가합니다."
    - badge: "보류"
      title: "RP가 인터넷에서 IdP callback을 안전하게 받을 수 없고, 고위험 세션도 없다"
      fit: "사설망과 짧은 세션만 사용하는 초기 내부 도구처럼 callback surface의 이익이 작은 환경입니다."
      watchouts: "front-channel iframe만으로 서버 세션이 반드시 닫힌다고 가정하면 안 됩니다."
      next_step: "우선 access token TTL, local logout, session registry, IdP 연동 인벤토리를 정리합니다."
---

SSO에서 사용자가 IdP 화면의 로그아웃을 눌렀다고 해서 모든 애플리케이션의 로그인이 끝난 것은 아닙니다. 브라우저 탭이 닫혔거나, 어떤 RP(Relying Party)는 다른 도메인에 있거나, 서버가 가진 세션·refresh token·권한 cache는 여전히 남아 있을 수 있습니다. 특히 관리자 콘솔, 고객 데이터 조회, 결제 운영 도구처럼 동일한 IdP를 공유하는 서비스가 많으면 “IdP에서는 끝났지만 이 서비스에서는 계속 된다”는 상태가 보안과 지원 비용을 동시에 키웁니다.

OIDC Back-Channel Logout은 이 문제를 브라우저 redirect나 iframe이 아니라 IdP(OP)가 RP 서버 endpoint로 직접 보내는 Logout Token으로 다룹니다. 하지만 HTTP endpoint 하나를 추가하는 것으로 끝나지 않습니다. 좋은 구현은 로그인 시점의 session mapping, 별도 JWT 검증, 멱등 회수, cache 전파, 실패 증거를 하나의 **세션 무효화 계약**으로 묶습니다.

이 글은 [OAuth2/OIDC 실무](/learning/deep-dive/deep-dive-oauth2-oidc/), [Device Session Registry와 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/), [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/), [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)의 다음 단계입니다. 앞선 글이 토큰과 로컬 세션의 수명을 다뤘다면, 여기서는 다른 보안 주체가 보낸 종료 사실을 각 서비스가 어떻게 검증·반영·증명할지 다룹니다.

참고한 표준 자료:

- [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html)
- [OpenID Connect RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)

## 이 글에서 얻는 것

- RP-initiated, front-channel, back-channel logout이 각각 어느 상태를 닫는지 구분합니다.
- Logout Token을 일반 JWT처럼 넓게 받아들이지 않고, 어떤 claim과 header를 검증해야 하는지 정리합니다.
- issuer·sub·sid와 로컬 session_id를 연결해 단일 기기 회수와 사용자 전체 회수를 예측 가능하게 만듭니다.
- callback 지연·중복·부분 실패가 있을 때 어떤 경로를 자동화하고 어떤 경로를 경보로 남길지 결정할 수 있습니다.

## 핵심 개념/이슈

### 1) 로그아웃 요청, 브라우저 정리, 서버 세션 회수는 다른 일이다

RP-initiated logout은 애플리케이션이 IdP에 “이 사용자의 OP 세션을 끝내 달라”고 요청하는 흐름입니다. front-channel logout은 IdP가 사용자의 browser를 매개로 각 RP에 종료 신호를 전달합니다. 반면 Back-Channel Logout은 OP가 등록된 RP endpoint에 직접 POST를 보내므로, 사용자가 탭을 닫았거나 해당 RP를 다시 방문하지 않아도 서버 세션을 닫을 기회를 줍니다.

이 차이 때문에 Back-Channel Logout을 cookie 삭제 API로 구현하면 틀립니다. callback에는 브라우저 cookie, local storage, 현재 CSRF token이 없습니다. RP가 종료할 대상을 찾으려면 로그인 당시 IdP가 발급한 정체성과 로컬 세션의 대응을 서버에 남겨야 합니다.

| 종료 경로 | 주된 대상 | 잘 되는 일 | 단독으로 부족한 일 |
| --- | --- | --- | --- |
| local logout | 현재 RP cookie·세션 | 사용자가 현재 앱에서 나가기 | 다른 RP와 IdP 세션 종료 |
| RP-initiated logout | OP 세션 종료 요청 | 중앙 SSO 세션 종료 시작 | 모든 RP의 서버 세션 반영 |
| front-channel | browser가 열어 둔 RP | 사용자 경험상 빠른 화면 정리 | 비활성 탭·서버 세션의 확실한 회수 |
| back-channel | RP 서버 세션·회수 cache | browser와 무관한 종료 사실 전달 | endpoint 도달 불가, local access token의 즉시 소멸 |

따라서 목표는 “모든 경로 중 하나만 쓰기”가 아니라 역할을 분리하는 것입니다. 사용자가 직접 로그아웃할 때는 local cookie를 즉시 지우고 IdP logout을 시작합니다. IdP의 종료·비활성화·위험 이벤트가 발생했을 때는 back-channel로 모든 연동 RP의 서버 상태를 닫습니다. 고위험 API는 뒤에서 설명할 online session check로 access token의 잔여 수명도 막습니다.

### 2) Logout Token은 ID Token도 access token도 아니다

OP는 등록된 backchannel_logout_uri에 form POST를 보내고 logout_token이라는 JWT를 전달합니다. 이 JWT는 형식이 ID Token과 비슷하지만 목적이 다릅니다. 정상 로그인 응답의 ID Token이나 access token을 endpoint에 재사용하게 두면 Cross-JWT confusion이 생길 수 있습니다.

표준이 요구하는 핵심 검증은 아래와 같습니다.

| 검증 항목 | 통과 조건 | 실패하면 생기는 문제 |
| --- | --- | --- |
| signature·alg·키 | 등록한 issuer의 JWKS, 허용 algorithm만 사용, none 거절 | 임의 요청으로 대량 로그아웃 |
| iss·aud | issuer가 고정값이고 audience가 이 RP client_id를 포함 | 다른 IdP·다른 client용 token 혼동 |
| iat·exp | 허용 clock skew 안이며 만료되지 않음 | 오래된 종료 이벤트의 재생 |
| events | backchannel-logout event member가 존재 | 일반 JWT를 logout 명령으로 오인 |
| sid 또는 sub | 둘 중 하나 이상 존재 | 회수 대상을 식별할 수 없음 |
| nonce 부재 | nonce claim이 없어야 함 | 인증 응답 token의 잘못된 재사용 |
| jti | issuer 단위로 최근 중복을 식별 | retry와 공격성 replay를 구분하지 못함 |

예를 들어 payload에 sub가 있어도 sid가 없을 수 있습니다. sid가 있으면 특정 OP 브라우저/기기 세션을 RP의 local session 하나 또는 작은 집합에 매핑할 수 있습니다. sid 없이 issuer+sub만 오면 해당 IdP 사용자와 연결된 RP 세션 전체를 닫으라는 의미가 될 수 있습니다. 이 차이는 구현 세부 사항이 아니라 사용자 영향 범위입니다.

~~~json
{
  "iss": "https://id.example.com",
  "aud": "admin-console",
  "sub": "oidc-user-9a1",
  "sid": "op-session-7d2",
  "iat": 1788397200,
  "exp": 1788397500,
  "jti": "logout-01K...",
  "events": {
    "http://schemas.openid.net/event/backchannel-logout": {}
  }
}
~~~

이 token에서 이메일, display name, 조직명은 회수 키가 아닙니다. RP가 보관할 안정 키는 issuer와 sub의 쌍, 그리고 OP가 제공한 sid입니다. 이메일 변경이나 IdP 계정 연결 변경이 일어날 수 있으므로, 문자열 이메일을 조인 키로 써서 “비슷해 보이는 사용자”의 세션을 닫지 않게 해야 합니다.

### 3) 로그인 때 만든 mapping이 logout의 blast radius를 결정한다

Back-Channel Logout의 실질적 준비는 callback endpoint가 아니라 로그인 완료 처리에 있습니다. local session registry에는 적어도 아래 대응을 저장합니다.

~~~yaml
federated_session:
  local_session_id: "ses_01K..."
  user_id: "usr_184"
  issuer: "https://id.example.com"
  subject: "oidc-user-9a1"
  sid: "op-session-7d2"
  client_id: "admin-console"
  state: "active"
  credential_version: 14
  created_at: "2026-09-03T00:50:00Z"
  last_seen_at: "2026-09-03T01:04:00Z"
~~~

조회 우선순위는 구체적인 sid부터입니다. issuer+sid가 일치하면 그에 연결된 local session만 revoke합니다. sid가 없고 issuer+sub만 유효하면 같은 RP에서 그 subject에 연결된 active session을 모두 revoke합니다. 다른 issuer의 같은 sub 값은 절대 합치지 않습니다. client_id도 같이 보관해야 하나의 RP용 Logout Token이 다른 local client 세션을 닫지 않습니다.

시작 단계에서 sid 지원 여부는 IdP Discovery의 backchannel_logout_session_supported와 실제 ID Token claim을 모두 확인해야 합니다. metadata가 true여도 특정 grant, legacy client, 계정 연결 방식에 따라 sid가 없는 세션이 있을 수 있습니다. sid 없음 비율을 0으로 추정하지 말고, 1주간 로그인 이벤트에서 issuer별 sid 누락률을 측정한 뒤 subject-wide logout이 낳는 영향을 승인합니다.

### 4) 중복 logout은 오류가 아니라 정상 전달 조건이다

IdP는 일시적 네트워크 장애나 RP의 5xx를 만났을 때 요청을 다시 보낼 수 있습니다. 반대로 동일 사용자가 브라우저 여러 곳에서 종료를 시작할 수도 있습니다. 그러므로 유효한 logout 요청은 state transition을 한 번만 수행하지만, 같은 요청은 여러 번 받아도 성공해야 합니다.

권장 처리 순서는 다음과 같습니다.

1. Content-Type과 body 크기를 제한하고 logout_token 하나만 파싱합니다.
2. key cache에서 issuer의 JWKS를 선택해 서명과 claim을 모두 검증합니다.
3. issuer+jti의 recent receipt를 확인합니다. 이미 처리했다면 200으로 끝냅니다.
4. sid 또는 issuer+sub로 대상 local session을 잠그고 active에서 revoked로 전이합니다.
5. 같은 DB transaction에서 logout receipt와 session.revoked outbox event를 기록합니다.
6. transaction이 끝난 뒤에만 200을 반환하고, cache·gateway·다른 서비스는 outbox consumer로 갱신합니다.

이미 로그인하지 않은 사용자나 이미 revoked session은 보안 실패가 아닙니다. 표준도 RP에 대상 세션이 이미 없으면 logout이 성공한 것으로 다룹니다. 이런 경우 404를 주면 IdP가 불필요하게 재시도하고, 공격자는 응답 차이로 세션 존재 여부를 추측할 수 있습니다. 다만 signature와 issuer 검증에 실패한 token은 400으로 끝내고 receipt를 만들지 않습니다.

### 5) 회수된 DB 행과 실제 접근 차단 사이에는 전파 시간이 있다

세션 테이블의 state를 revoked로 바꿔도 이미 발급한 access token은 exp 전까지 서명 검증을 통과할 수 있습니다. 모든 API가 session DB를 직접 조회하면 즉시성은 좋아지지만 login 트래픽과 DB 의존성이 커집니다. 반대로 모든 API가 token만 보면 회수 약속이 약해집니다.

경로별로 다른 회수 모델을 명시하세요.

| 경로 등급 | 확인 방식 | 시작 기준 | 허용할 최대 회수 지연 |
| --- | --- | ---: | ---: |
| 일반 읽기 | 5~15분 access token + revoke cache | cache TTL 60초 | token TTL 또는 cache 정책으로 명시 |
| 일반 쓰기 | session version 또는 central cache 확인 | access token 5분 | 60초 이하 목표 |
| 관리자·결제·개인정보 변경 | session registry online check + step-up | 요청마다 또는 30초 cache | 10초 이하 목표 |
| 서비스 간 delegated token | 짧은 audience-specific token + policy version | TTL 1~5분 | 대상 API 정책으로 명시 |

숫자는 출발점입니다. 더 중요한 것은 “즉시 로그아웃”이라는 말에 실제 상한을 붙이는 일입니다. 15분짜리 bearer token을 쓰면서 10초 회수를 약속할 수는 없습니다. [Device Session Registry와 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)의 local session 상태와 [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/)의 짧은 delegated token을 함께 설계해야 blast radius가 작아집니다.

## 실무 적용

### 1) endpoint보다 먼저 IdP·RP 계약표를 만든다

여러 IdP와 여러 client를 쓰는 조직은 callback URL만 모으면 안 됩니다. 다음 표를 운영 문서와 배포 설정의 source of truth로 둡니다.

| 항목 | 예시 질문 | 승인 기준 |
| --- | --- | ---|
| issuer | 어떤 canonical iss를 허용하는가 | exact match, redirect·별칭 금지 |
| client | 어떤 client_id와 audience를 받는가 | RP별 allowlist |
| key 검증 | JWKS 갱신과 kid miss는 어떻게 처리하는가 | 새 키 fetch 1회, 실패 시 fail closed |
| callback reachability | IdP가 private RP까지 도달하는가 | staging에서 실제 POST 확인 |
| sid policy | sid 없는 token을 허용하는가 | subject-wide 영향과 owner 승인 |
| retention | receipt·audit event를 얼마나 보관하는가 | 보안 감사 정책에 맞춰 고정 |

endpoint는 공개 입력 표면이므로 application firewall 앞에 두더라도 issuer IP allowlist만을 신뢰 경계로 삼지 않습니다. cloud IdP의 egress 대역은 바뀔 수 있고 proxy를 거칠 수 있습니다. 서명·issuer·audience 검증을 본체로 두고, IP 제한은 보조 방어로만 사용하세요. endpoint에 일반 사용자 세션 인증이나 CSRF 검사를 요구하는 것도 맞지 않습니다. 대신 POST method, form encoding, body 최대 크기, request timeout, rate limit은 명시적으로 둡니다.

### 2) 두 종류의 fixture로 회수 범위를 검증한다

staging에서 최소한 아래 경우를 자동 테스트해야 합니다.

1. 동일 사용자가 서로 다른 sid로 두 기기에 로그인한 뒤 sid 기반 token 하나를 보냅니다. 대상 session 하나만 revoked여야 합니다.
2. sid가 없는 issuer+sub token을 보냅니다. 해당 issuer·client의 세션만 모두 revoked여야 합니다.
3. 같은 jti를 두 번 보냅니다. 두 번째 요청은 상태를 다시 바꾸지 않지만 200이어야 합니다.
4. 잘못된 audience, 만료 token, events 없는 ID Token, nonce가 든 token, none algorithm token은 400이고 세션 상태는 바뀌지 않아야 합니다.
5. cache consumer를 중지한 상태에서 revoke한 뒤, high-risk API가 online registry 확인으로 차단되는지 검증합니다.

특히 4번은 “유효한 JWT면 됐다”는 구현을 잡는 음성 테스트입니다. 테스트 token은 production signing key가 아닌 integration IdP 또는 test JWKS로 만들고, token 본문을 CI log에 그대로 남기지 않습니다.

### 3) 관측은 callback 성공률이 아니라 회수 완료율을 본다

HTTP 200 비율만 보면 callback handler가 빨리 응답했는지만 알 수 있습니다. 다음 단계를 분리해 기록하세요.

~~~text
OP logout request
  -> JWT validation result
  -> local session selection count
  -> registry revoke commit
  -> outbox publish
  -> cache/gateway invalidation
  -> protected API denial
~~~

초기 SLO는 다음처럼 보수적으로 둘 수 있습니다.

- valid callback의 p95 처리 시간: 2초 이하
- valid callback 중 registry revoke commit 성공률: 99.9% 이상
- outbox publish 후 revoke cache 반영 p99: 60초 이하
- high-risk API의 revoked-session 허용: 0건
- invalid token에 의한 session state 변경: 0건
- sid 없는 subject-wide revoke 비율: issuer별 추세와 함께 별도 경보

로그에는 raw Logout Token, subject의 이메일, full session cookie를 넣지 않습니다. issuer, client_id, token jti의 안전한 digest, sid digest, 대상 수, 결과 code, correlation ID만 남기면 재현과 개인정보 최소화를 함께 만족할 수 있습니다. 상태 변경과 전파는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)처럼 분리해 관찰합니다.

## 트레이드오프/주의점

첫째, Back-Channel Logout은 browser 의존을 줄이지만 network 의존을 늘립니다. public IdP가 private network 안의 RP에 도달할 수 없다면 endpoint를 무리하게 공개하지 말고, gateway relay나 IdP vendor의 지원 경로를 설계해야 합니다. endpoint를 열었다는 사실만으로 callback 전달 보장이 생기지 않으므로 staging canary와 delivery failure dashboard가 필요합니다.

둘째, sid가 없는 sub-wide logout은 안전 쪽으로 넓게 닫지만 사용자 경험 비용이 큽니다. shared terminal, 여러 회사 기기, 서비스 계정 연결처럼 session 수가 많은 계정에서는 한 IdP session 종료가 모든 RP 로그인 해제로 번질 수 있습니다. “정확히 한 기기만 끝내야 한다”는 제품 요구가 있으면 sid support가 가능한 IdP·client 조합을 우선하고, sid 누락은 fallback이 아니라 운영 사건으로 분류하세요.

셋째, jti dedup은 replay 방어이지만 저장소를 무한히 키우면 안 됩니다. issuer+jti receipt TTL은 최소 token exp와 허용 clock skew를 덮되, 보통 exp 이후 몇 분의 여유를 더한 기간으로 제한합니다. 반대로 너무 짧게 지우면 IdP의 지연 재시도를 새 요청으로 처리해 불필요한 audit event가 쌓일 수 있습니다.

넷째, local session 회수는 downstream 권한의 자동 회수가 아닙니다. 이미 exchange된 token, long-lived API key, 별도 worker credential은 다른 lifecycle을 가집니다. 하나의 logout event로 모든 credential을 파괴하려 하지 말고, issuer session과 사용자 위임 token, service credential, API key를 분리해 회수 범위와 owner를 문서화해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] IdP Discovery와 client registration에서 backchannel logout 지원, endpoint, sid 정책을 환경별로 확인했다.
- [ ] 로그인 레지스트리에 issuer+sub, sid, client_id, local_session_id를 불변 키로 저장한다.
- [ ] Logout Token의 signature, algorithm, issuer, audience, 시간 claim, events, sid/sub, nonce 부재를 모두 검증한다.
- [ ] valid duplicate와 unknown session은 200으로 끝내고, invalid token만 400으로 구분한다.
- [ ] revoke transaction, receipt, outbox event를 원자적으로 기록하며 raw token은 로그에 남기지 않는다.
- [ ] 일반·고위험 API의 access token TTL, cache TTL, online check로 회수 지연 상한을 수치로 정했다.
- [ ] sid 단일 회수, sub-wide 회수, duplicate, forged token, cache 지연 fixture를 staging에서 통과했다.

### 연습

1. 현재 SSO 연동 하나를 골라 로그인 성공 시 issuer, sub, sid, local session을 어디에 저장하는지 추적해 보세요. sid가 없다면 그 비율과 fallback 영향을 기록합니다.
2. test JWKS로 valid Logout Token 하나와 events·audience·nonce가 각각 잘못된 token 세 개를 만들고, 네 종류 모두의 session state와 HTTP 응답을 검증하세요.
3. 회수 후 0초, 30초, 60초, access token 만료 시점에 일반 API와 관리자 API를 호출해 실제 차단 시각을 기록하고, 제품의 로그아웃 문구와 비교하세요.
