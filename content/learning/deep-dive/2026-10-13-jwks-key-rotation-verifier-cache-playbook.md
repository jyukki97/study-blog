---
title: "백엔드 커리큘럼 심화: JWKS 키 회전과 검증 캐시를 인증 중단 없이 운영하는 플레이북"
date: 2026-10-13T10:06:00+09:00
lastmod: 2026-10-13T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["JWT", "JWKS", "Key Rotation", "OIDC", "Authentication", "Cache"]
categories: ["Backend Deep Dive"]
keywords: ["JWKS key rotation", "JWT verification cache", "signing key rollover", "OIDC JWKS", "kid cache"]
description: "JWT 서명 키 회전을 새 키 배포만의 문제가 아니라 JWKS 캐시·unknown kid·revocation·장애 정책을 포함한 검증 계약으로 운영하는 기준을 정리합니다."
summary: "서명 키 회전에서 새 키를 만든 사실과 모든 verifier가 그 키를 신뢰하는 사실은 다르다. 안전한 회전은 key set의 중첩 기간, kid miss의 제한된 refresh, 이전 키 제거 기준, 장애 시 fail-closed 범위를 숫자로 합의하는 일이다."
module: "backend-security"
study_order: 1530
key_takeaways:
  - "JWT verifier는 매 요청에 JWKS를 받아 오면 안 되지만, cache TTL만 길게 두어도 새 키와 폐기 키를 제때 반영하지 못한다."
  - "unknown kid는 무조건 refresh할 이유가 아니라, cache stampede와 공격성 키 탐색을 막으며 제한적으로 재조회할 신호다."
  - "새 키 publish, verifier 관측, signer 전환, 이전 키 retire는 각각 성공 조건과 되돌림 경로가 다른 단계다."
operator_checklist:
  - "issuer·audience·허용 alg를 고정하고, JWT header의 jku·x5u 같은 원격 키 URL은 입력으로 신뢰하지 않는다."
  - "JWKS cache에는 최대 TTL, kid miss refresh cooldown, stale 허용 한계, issuer별 크기 상한을 둔다."
  - "새 key는 signer 전환 전 모든 verifier가 조회할 수 있는 JWKS에 먼저 publish하고, old/new key overlap을 access token 최대 수명보다 길게 둔다."
---

JWT를 쓰는 서비스는 서명 키를 한 번 만들고 끝내기 쉽습니다. 하지만 키가 노출됐거나, 인증 제공자를 교체하거나, 정기 회전 규정을 지켜야 하면 질문이 달라집니다. 새 공개키를 JWKS endpoint에 올린 뒤 바로 새 `kid`로 토큰을 발급해도 될까요? 일부 verifier가 아직 이전 JWKS를 cache하고 있다면 정상 로그인도 401이 됩니다. 반대로 이전 키를 너무 오래 남기면 폐기한 키가 여전히 신뢰 경계 안에 남습니다.

이 문제는 [OAuth2/OIDC 실무](/learning/deep-dive/deep-dive-oauth2-oidc/), [DPoP sender-constrained access token](/learning/deep-dive/2026-10-08-dpop-sender-constrained-access-token-playbook/), [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/), [Secret Management](/learning/deep-dive/deep-dive-secret-management/)의 운영 연결점입니다. 토큰 검증을 라이브러리 호출 하나로 취급하지 않고, **key set이 시간에 따라 바뀌는 분산 계약**으로 다뤄야 합니다.

## 이 글에서 얻는 것

- signer, JWKS endpoint, gateway, 애플리케이션 verifier가 각각 어떤 상태를 가져야 하는지 구분합니다.
- 새 `kid`를 만났을 때의 refresh와 악의적인 `kid` 탐색을 구분하는 cache 정책을 설계합니다.
- planned rotation과 긴급 compromise rotation에 다른 시간 예산과 중단 기준을 적용합니다.
- access token 수명, clock skew, JWKS cache TTL을 함께 계산해 안전한 overlap 기간을 정할 수 있습니다.

## 핵심 개념/이슈

### 1) 공개키 배포와 신뢰 전환은 같은 일이 아니다

비대칭 JWT에서는 issuer가 private key로 서명하고, verifier는 JWKS의 public key로 검증합니다. `kid`는 JWT header의 key identifier로, verifier가 key set 안에서 후보를 고르는 데 쓰입니다. 여기서 흔한 오해는 “JWKS에 새 key가 보이면 회전이 끝났다”는 생각입니다.

실제로는 아래 네 시점이 따로 존재합니다.

| 시점 | 일어나는 일 | 아직 남는 위험 |
| --- | --- | --- |
| publish | JWKS에 새 public key를 추가 | verifier cache는 아직 이전 set일 수 있음 |
| observe | verifier가 새 key를 조회·parse할 수 있는지 측정 | signer는 아직 old key를 쓸 수 있음 |
| activate | issuer가 새 `kid`로 토큰 발급 시작 | 오래된 verifier는 정상 토큰을 거절할 수 있음 |
| retire | old key를 JWKS에서 제거 | old token·stale cache·clock skew가 남을 수 있음 |

따라서 회전은 key pair 생성 이벤트가 아니라 **신뢰 가능한 verifier 집합의 전환**입니다. 공개키를 미리 publish한 상태에서 verifier의 key-set refresh가 충분히 일어난 것을 확인한 뒤 signer를 전환해야 합니다. `kid` 문자열을 timestamp나 고객명으로 만들 필요는 없습니다. 무작위 또는 관리형 식별자와 key 상태(active, grace, revoked)를 issuer 내부 registry에서 관리하는 편이 노출과 충돌을 줄입니다.

### 2) JWKS cache는 성능 cache이면서 보안 정책이다

매 요청마다 issuer의 `jwks_uri`를 조회하면 인증 경로가 외부 네트워크에 묶이고, key endpoint 장애가 곧 API 장애가 됩니다. 반대로 24시간 cache를 고정하면 새 키 배포와 revoke가 하루 늦습니다. 정답은 하나의 TTL이 아니라 **정상 refresh와 예외 refresh를 분리**하는 것입니다.

권장 시작점은 다음과 같습니다.

- 정상 background refresh: **5~15분** 주기. issuer가 준 `Cache-Control` 상한과 더 짧은 내부 최대 TTL 중 작은 값을 적용합니다.
- `kid` miss refresh: issuer별로 **60초 cooldown**을 둔 단 한 번의 동기 refresh 후 다시 검증합니다.
- stale 사용 한계: key endpoint 오류 시 일반 API는 마지막 성공 key set을 **최대 30분**까지만 사용합니다.
- cache 크기: issuer 하나당 active/grace key 수를 **10개 이하**로 제한하고, 과도한 key set은 설정 오류로 경보합니다.

`kid` miss 때 즉시 원격 요청을 하면 공격자가 매번 다른 `kid`를 넣어 JWKS endpoint와 verifier를 증폭시킬 수 있습니다. 그래서 `(issuer, kid)` miss를 짧게 negative-cache하고, 동시에 issuer 단위 refresh를 singleflight로 묶어야 합니다. refresh 뒤에도 key가 없으면 “서명 실패”가 아니라 `unknown_kid`라는 분류된 인증 실패로 기록합니다. raw token이나 전체 `kid`를 고카디널리티 metric label에 넣지 않는 것도 중요합니다.

### 3) overlap 기간은 토큰 TTL만으로 계산하면 부족하다

old key를 언제 제거할지는 “토큰이 15분짜리이므로 15분 뒤”보다 복잡합니다. 마지막 old-key token이 발급된 시각, access token의 최대 TTL, 허용 clock skew, gateway와 verifier의 cache 갱신 지연, queue에 잠시 머무는 내부 요청을 합쳐야 합니다.

```text
old-key overlap >= max_access_token_ttl + max_clock_skew
                   + maximum_verifier_refresh_delay + safety_margin

예: 15분 + 60초 + 15분 + 5분 = 최소 36분
```

여기서 `maximum_verifier_refresh_delay`는 희망 TTL이 아니라 실제 fleet에서 가장 오래된 JWKS 관측 시각입니다. 10분 TTL을 설정했어도 중지된 worker, 드문 cron, long-lived process가 3시간마다만 refresh한다면 정책은 거짓말이 됩니다. `jwks_cache_age_seconds`, `last_successful_jwks_refresh_at`, `verification_key_kid`를 서비스별로 수집해 p99 cache age가 20분을 넘는지 보세요.

긴급 폐기는 다릅니다. private key 유출이 의심되면 정상 토큰의 일부 401보다 위조 토큰 허용이 더 큰 위험일 수 있습니다. 이때는 old key를 즉시 revoke하되, 어떤 API와 테넌트가 차단되는지, re-auth 경로가 있는지, refresh token도 회수할지 미리 runbook에 적어 두어야 합니다. key remove만으로 이미 발급된 bearer token을 개별 철회하지 못한다는 한계는 [Device Session Registry와 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/) 같은 서버 측 상태와 짧은 토큰 수명으로 보완합니다.

## 실무 적용

### 1) verifier의 검증 순서를 고정한다

JWKS를 가져왔다고 JWT가 안전해지는 것은 아닙니다. 다음 순서로 cheap failure를 먼저 거르는 편이 비용과 혼동을 줄입니다.

1. 신뢰한 issuer 목록에서 `iss` 후보를 선택하고, 그 issuer에 등록된 `jwks_uri`만 사용합니다. JWT가 제시한 `jku`, `x5u` URL은 따라가지 않습니다.
2. header의 `alg`가 issuer별 allowlist(예: `RS256`, `ES256`)에 있는지, `none`이나 대칭 알고리즘 혼동이 없는지 확인합니다.
3. local JWKS cache에서 `kid`를 찾습니다. 없을 때에만 cooldown을 통과한 singleflight refresh를 한 번 시도합니다.
4. 공개키로 signature를 검증한 다음에야 `iss`, `aud`, `exp`, `nbf`, `iat`, tenant·scope 같은 claim을 평가합니다.
5. 결과를 `valid`, `expired`, `unknown_kid`, `signature_invalid`, `issuer_mismatch`, `jwks_unavailable`로 나누고, 외부 응답에는 과도한 원인을 노출하지 않습니다.

특히 `aud` 검증을 “우리 issuer가 서명했으니 됐다”로 생략하면 다른 client용 token을 받아들이는 문제가 생깁니다. issuer, audience, algorithm, key source는 묶여 있는 계약입니다. [OIDC Back-Channel Logout](/learning/deep-dive/deep-dive-oidc-backchannel-logout-session-contract-playbook/)에서 Logout Token을 일반 JWT와 혼동하지 않는 것처럼, token type과 사용처도 명확히 분리해야 합니다.

### 2) 두 종류의 회전을 다른 runbook으로 운영한다

| 구분 | planned rotation | emergency rotation |
| --- | --- | --- |
| 시작 신호 | 정기 정책, provider 교체, crypto hygiene | private key 노출 의심, 서명 인프라 침해 |
| 새 key publish | signer 전환 최소 24시간 전 | 즉시 publish 또는 새 issuer 경로 준비 |
| old key 처리 | 계산한 overlap 후 remove | risk 판단 뒤 즉시 revoke 가능 |
| 허용되는 사용자 영향 | 새 key 검증 오류 0.01% 미만 | 일부 재로그인·세션 종료를 감수 가능 |
| 필수 증거 | fleet refresh율, canary verify, old-key token 감소 | 영향 tenant, re-auth 성공률, compromise 타임라인 |

planned rotation에서는 새 key를 publish한 뒤 canary verifier가 새 `kid`의 test token을 검증하도록 합니다. 전체 fleet의 `jwks_cache_age_seconds` p99가 **20분 미만**이고 unknown-kid 비율이 **0.01% 미만**인 상태를 signer 전환 조건으로 둘 수 있습니다. signer 전환 뒤에는 old/new key 발급 비율과 signature failure를 5분 단위로 보며, 신규 key failure가 **0.1%를 넘으면** signer를 old key로 되돌리고 cache·proxy 경로를 조사합니다.

긴급 회전의 우선순위는 다릅니다. `compromised_key`를 verifier가 신뢰하지 않는 것, 영향을 받은 session을 재인증시키는 것, 서비스가 조용히 500을 내지 않게 하는 것이 순서입니다. credential 전체를 로그에 남기지 말고 key alias, 시각, issuer, 영향 endpoint, cache version만 감사 기록으로 보존합니다.

### 3) 작은 failure drill로 계약을 시험한다

회전은 운영자가 처음 해 보는 날이 가장 위험합니다. staging이나 별도 issuer에서 다음 fixture를 자동화하세요.

- new `kid`가 JWKS publish 전에 발급됐을 때 verifier가 예상한 `unknown_kid`로 거절하는지
- key publish 뒤 refresh cooldown 내의 동시 1,000건 miss가 upstream 1회 refresh로 합쳐지는지
- old key를 제거한 뒤 만료된 token, forged signature, 잘못된 audience를 서로 다른 reason으로 집계하는지
- JWKS endpoint가 10분간 5xx일 때 저위험 API와 고위험 API의 stale 정책이 문서대로 다른지
- 이전 key grace 종료 직전에 발급된 정상 token의 결과와, overlap 종료 후 re-auth UX가 예상대로인지

성공률 하나만 보지 말고 `jwks_refresh_latency`, `jwks_refresh_failure`, `unknown_kid_after_refresh`, `stale_keyset_age`, `auth_denial_by_reason`을 함께 봐야 합니다. 캐시를 비우는 것으로만 해결되는 배포는 설계 결함을 가린 것입니다.

## 트레이드오프/주의점

첫째, JWKS cache를 짧게 하면 revoke 반영은 빨라지지만 issuer endpoint와 네트워크 의존도가 커집니다. 내부 인증 서버가 여러 리전에 있고 안정적인 push invalidation을 제공한다면 더 짧은 TTL이 가능하지만, 단일 외부 IdP에 모든 API가 매분 기대면 인증이 새로운 단일 장애점이 됩니다. high-risk endpoint와 일반 read API의 stale 허용을 같게 두지 마세요.

둘째, 긴 overlap은 가용성을 높이지만 key compromise의 피해 창도 넓힙니다. 정기 회전의 24시간 overlap을 emergency에도 적용하면 안 됩니다. 반대로 emergency 때 제거만 하고 token/session 회수나 사용자 통지가 없으면 지원 부하와 보안 공백이 남습니다. key lifecycle은 secret lifecycle, session lifecycle, incident response의 교집합입니다.

셋째, `kid`는 key lookup 힌트이지 인증 정보가 아닙니다. path traversal처럼 `kid`를 파일명으로 쓰거나, header의 `jku`가 가리키는 임의 URL에서 JWKS를 내려받으면 signature 검증 전에 SSRF와 키 주입 경계를 열 수 있습니다. issuer metadata를 discovery 시점에 고정하고 allowlist로 관리하세요.

넷째, 대칭키(HS256)와 공개키 알고리즘을 같은 verifier 설정에서 느슨하게 허용하면 algorithm confusion 위험이 생깁니다. 한 issuer와 한 token class에 하나의 명시적 algorithm family를 매핑하고, 동일 `kid`라도 key type이 다르면 거절해야 합니다. 라이브러리의 “알아서 선택” 기본값은 운영 정책이 아닙니다.

## 체크리스트 또는 연습

### 배포 전 체크리스트

- [ ] issuer별 `iss`, `aud`, JWKS URL, 허용 `alg`, max key 수를 검토 가능한 registry에 기록했다.
- [ ] planned rotation의 overlap을 max token TTL, clock skew, 실제 cache-age p99로 계산했다.
- [ ] `kid` miss refresh는 issuer 단위 singleflight와 cooldown, negative cache를 가진다.
- [ ] key endpoint 장애 시 stale 허용 시간과 endpoint 위험도별 fail-closed 범위를 합의했다.
- [ ] new key canary, signer rollback, old key retire, emergency revoke의 담당자와 관측 dashboard를 정했다.
- [ ] raw JWT, authorization header, private key, 고객 식별자를 auth failure log에 남기지 않는다.

### 연습: 40분 회전 타임라인 만들기

access token 최대 수명이 10분, clock skew가 60초, verifier refresh p99가 12분인 시스템을 가정해 보세요. safety margin을 5분으로 두고 old key 최소 overlap을 계산합니다. 이어서 새 key publish 시점, canary 검증 시점, signer 전환 시점, old key 삭제 가능 시점을 시간축에 배치해 보세요. 마지막으로 private key 노출이 signer 전환 직후 발견된 경우에는 어떤 토큰·세션을 즉시 막고 어떤 사용자를 재인증시킬지 5줄짜리 emergency runbook으로 써 보세요.

회전의 완료 조건은 “새 키가 만들어졌다”가 아닙니다. **모든 verifier가 어떤 key set을 왜 신뢰하는지 설명할 수 있고, 이전 신뢰를 언제 어떤 근거로 끊을지 재현할 수 있는 상태**가 완료입니다.
