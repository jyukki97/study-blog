---
title: "백엔드 커리큘럼 심화: DPoP Sender-Constrained Access Token, 탈취된 Bearer Token의 재사용 경로를 줄이는 운영 설계"
date: 2026-10-08T10:06:00+09:00
lastmod: 2026-10-08T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["OAuth 2.0", "DPoP", "Sender-Constrained Token", "Token Replay", "API Security", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "DPoP로 access token을 클라이언트 공개키에 묶고, proof 검증·nonce·replay 저장소·프록시 경계·키 회전을 운영 규칙으로 만드는 방법을 정리합니다."
module: "backend-security"
study_order: 1259
keywords: ["DPoP", "sender-constrained access token", "OAuth token replay", "proof of possession", "resource server validation"]
---

OAuth access token이 Bearer token이면, 유효기간 안에 token 문자열을 가진 주체는 누구나 API를 호출할 수 있습니다. TLS는 전송 중 탈취를 줄이지만, 브라우저 확장, 잘못 남은 debug log, proxy trace, endpoint 악성코드, 잘못된 client storage처럼 token이 전송 이후 노출되는 경로까지 없애지는 못합니다. DPoP(Demonstrating Proof of Possession)는 token을 **특정 공개키의 소유 증명**과 묶어, 문자열만 복사한 공격자가 같은 요청을 재현하기 어렵게 만드는 OAuth 확장입니다.

DPoP는 JWT를 하나 더 붙이는 편의 기능이 아닙니다. authorization server, client, resource server가 token의 결속 키, 요청의 method·URI, 재사용 탐지, clock skew, nonce를 같은 규칙으로 해석해야 합니다. 이 글은 [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/), [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/), [Trusted Proxy와 Client IP 경계](/learning/deep-dive/deep-dive-trusted-proxy-client-ip-boundary-playbook/), [OIDC Back-Channel Logout](/learning/deep-dive/deep-dive-oidc-backchannel-logout-session-contract-playbook/)를 연결해, DPoP를 실제 API 보호 계층으로 운영하는 기준을 정리합니다.

## 이 글에서 얻는 것

- Bearer token과 sender-constrained token의 방어 범위 차이를 구분합니다.
- DPoP proof의 `htm`, `htu`, `iat`, `jti`, `ath`, `nonce`, `cnf.jkt`를 어떤 순서로 검증해야 하는지 이해합니다.
- reverse proxy 뒤에서 URL 정규화와 replay 저장소를 안전하게 설계하는 출발 기준을 얻습니다.
- DPoP가 맞는 client·API와 mTLS, workload identity, 짧은 만료가 더 나은 경우를 판단합니다.

## 핵심 개념/이슈

### 1) Bearer token은 “가진 사람”을, DPoP는 “키를 가진 사람”을 확인한다

일반 OAuth access token은 `Authorization: Bearer <token>`만으로 사용합니다. token이 노출되면 공격자는 만료 전까지 다른 네트워크와 다른 장비에서 같은 값을 제출할 수 있습니다. DPoP client는 token 요청과 API 요청에 개인키로 서명한 짧은 proof JWT를 함께 보냅니다. authorization server는 token을 발급할 때 proof에 들어 있던 공개키의 thumbprint를 token의 `cnf.jkt` claim과 연결합니다. resource server는 이후 요청에서 “이 token과 이 proof의 공개키가 같은가”를 확인합니다.

1. client가 개인키를 만들고 token endpoint 요청에 `DPoP` header를 보냅니다.
2. authorization server가 proof를 검증한 뒤 `token_type=DPoP` access token을 발급하고, 결속 공개키의 thumbprint를 `cnf.jkt`에 기록합니다.
3. client는 protected API 호출마다 `Authorization: DPoP <access_token>`과 새 `DPoP` proof를 보냅니다.
4. resource server는 token 자체와 proof의 서명·요청 결속·재사용 여부를 모두 확인합니다.

따라서 token 문자열만 유출된 경우에는 공격자가 같은 private key로 새 proof를 만들 수 없습니다. 다만 private key와 token이 함께 탈취되거나, client 안에서 악성 스크립트가 서명 API를 호출할 수 있으면 DPoP만으로 막을 수 없습니다. **token을 키에 묶는 것**이지, 감염된 endpoint를 신뢰할 수 있게 만드는 기능은 아닙니다.

| 위협 | DPoP 효과 | 별도 대책 |
| --- | --- | --- |
| 로그·trace에 access token만 노출 | 재사용 난이도 상승 | token redaction, 짧은 TTL, 로그 접근 통제 |
| 다른 장비에서 token 복사 후 호출 | proof private key가 없으면 차단 | `cnf.jkt`와 proof binding 검증 |
| 동일 proof를 캡처해 재전송 | `jti`·`iat`·nonce로 제한 | replay store와 짧은 허용 창 |
| 브라우저 XSS가 client에서 요청 서명 | 근본 해결 불가 | CSP, XSS 제거, BFF·HttpOnly session 검토 |
| 서버 간 workload credential 탈취 | 사용 사례에 따라 부적합 | workload identity, mTLS, secretless runtime |

### 2) proof는 서명만 맞으면 충분하지 않다

DPoP proof JWT에는 공개키 JWK와 요청 문맥이 들어갑니다. resource server는 값만 파싱해 신뢰하면 안 되며, 허용한 비대칭 알고리즘과 `typ: dpop+jwt`를 확인한 뒤 proof 내부 JWK로 signature를 검증해야 합니다. 그 다음에도 아래 항목을 모두 확인해야 합니다.

| 항목 | 확인할 내용 | 시작 기준 |
| --- | --- | --- |
| `htm` | 실제 HTTP method와 동일한가 | 대소문자 정규화 후 정확히 일치 |
| `htu` | 요청 target URI와 동일한가 | scheme·host·path 기준, fragment 제외 규칙 고정 |
| `iat` | proof 생성 시각이 현재와 충분히 가까운가 | 기본 ±300초, 실제 clock drift로 조정 |
| `jti` | 같은 proof ID가 허용 창 안에 재사용됐는가 | key thumbprint+`jti`를 최소 5분 저장 |
| `ath` | proof가 이 access token을 가리키는가 | protected resource 호출에서 hash 비교 |
| `cnf.jkt` | token이 proof 공개키에 묶였는가 | token claim과 JWK thumbprint 정확히 일치 |
| `nonce` | server가 nonce를 요구했다면 최신 값인가 | 일회성 또는 짧은 TTL, 재발급 경로 제공 |

`htu` 검증은 특히 사고가 나기 쉽습니다. 외부에서는 `https://api.example.com/v1/payments`로 보이지만, 애플리케이션이 proxy 뒤에서 `http://internal:8080/v1/payments`만 보면 proof와 실제 요청을 비교할 기준이 달라집니다. `X-Forwarded-*` header를 무조건 믿어서는 안 되고, [Trusted Proxy 경계](/learning/deep-dive/deep-dive-trusted-proxy-client-ip-boundary-playbook/)처럼 L7 proxy가 덮어쓴 값만 신뢰하도록 network boundary를 고정해야 합니다. URI query를 포함할지, default port를 어떻게 정규화할지도 client·resource server가 한 문서로 합의해야 합니다.

### 3) replay 방지는 JWT 검증 라이브러리 밖의 상태 문제다

signature가 유효한 DPoP proof를 수십 초 안에 여러 번 재전송하는 공격은 signature 검증만으로 막히지 않습니다. 그래서 `jti`는 충분히 긴 난수여야 하고, resource server는 `(jkt, jti)` 조합을 TTL 저장소에 원자적으로 기록해야 합니다. 이미 있으면 401 또는 provider가 정한 DPoP 오류로 거절합니다.

모든 API에 무한 보관을 할 필요는 없습니다. `iat` 허용 창이 5분이면 replay key의 TTL도 최소 5분에 여유를 더한 6~10분으로 시작할 수 있습니다. 다만 multi-region에서 동일 token이 두 리전에 도착할 수 있다면 region-local cache만으로는 재전송을 놓칠 수 있습니다. 금융 이체나 권한 변경처럼 높은 위험의 write API는 shared store, route affinity, 업무 단위 idempotency key를 함께 검토해야 합니다. DPoP replay 방지와 [멱등 write path](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)는 대체 관계가 아닙니다. 전자는 credential 재사용, 후자는 같은 업무 효과의 중복을 줄입니다.

## 실무 적용

### 1) API 분류와 키 lifecycle을 먼저 결정한다

첫 도입 대상으로는 native mobile, desktop CLI, partner agent처럼 private key를 OS secure enclave·keystore·HSM에 보관할 수 있고 token 탈취의 영향이 큰 public API가 적합합니다. browser SPA는 키를 JavaScript 실행 환경에 두는 한 XSS 영향을 받으므로, DPoP 도입 전에 BFF, CSP, dependency 관리, session 설계를 우선 검토해야 합니다. internal service-to-service 통신은 DPoP를 억지로 통일하기보다 mTLS나 workload identity로 workload 자체를 인증하는 편이 단순한 경우가 많습니다.

```yaml
dpop_client_policy:
  key_storage: hardware_or_os_keystore
  allowed_algorithms: [ES256, EdDSA]
  access_token_ttl_minutes: 10
  proof_iat_skew_seconds: 300
  replay_key_ttl_minutes: 10
  key_rotation: "new_key_requires_new_token"
  nonce_on: [high_risk_write, suspicious_replay_pattern]
  bearer_fallback: false
```

여기서 핵심은 **키를 바꾸면 token도 새로 받아야 한다**는 점입니다. 기존 token의 `cnf.jkt`는 이전 키를 가리키므로, 앱이 키만 교체하고 token을 계속 쓰면 정상 요청까지 거절됩니다. client는 private key 손실·기기 복원·keystore 초기화 시 refresh token 또는 재인증으로 새 key-bound token을 받는 recovery path를 가져야 합니다. `Bearer` fallback을 조용히 열어 두면 DPoP 지원 실패가 곧 보안 downgrade가 되므로, 전환 중에도 endpoint·client ID·허용 기간을 제한해 별도로 관측합니다.

### 2) resource server에는 고정된 검증 순서와 오류 계약을 둔다

모든 handler가 DPoP 규칙을 각자 구현하면 URI 정규화와 replay 처리 차이로 우회가 생깁니다. API gateway 또는 공통 authentication middleware에 검증을 모읍니다. 비용이 큰 replay store 조회 전에 값싼 검증을 먼저 하되, 어떤 단계가 실패했는지는 외부 응답에 과도하게 노출하지 않습니다.

```text
1. Authorization scheme이 DPoP인지 확인하고 access token의 서명·iss·aud·exp를 검증한다.
2. proof typ, 허용 alg, JWK 형식을 검증하고 proof 서명을 검증한다.
3. token cnf.jkt와 proof JWK thumbprint를 비교한다.
4. htm·htu·iat·ath를 canonical request와 비교한다.
5. nonce가 요구된 route면 nonce의 audience·TTL·사용 여부를 확인한다.
6. replay_store.put_if_absent(jkt + ":" + jti, ttl=10m)가 성공한 경우에만 요청을 통과시킨다.
7. 업무 write라면 별도의 idempotency key와 authorization policy를 적용한다.
```

`put_if_absent`가 timeout일 때 fail-open하면 replay 보호가 사라집니다. 결제, 계정 복구, role 변경처럼 위험이 큰 route는 fail-closed가 기본입니다. 반대로 read-only 탐색 API에서 replay store 장애가 전체 서비스 장애로 번지는 것이 더 큰 위험이라면, token TTL 축소·rate limit·risk route 분리 같은 보완책을 문서화한 뒤 제한적으로 fail-open을 검토할 수 있습니다. 하나의 전역 규칙으로 모든 route를 처리하지 말고, 위험도별 정책을 명시합니다.

### 3) shadow 관측 뒤에 client별로 강제한다

DPoP proof가 없다고 해서 처음부터 모든 사용자를 막으면 오래된 SDK와 proxy 설정 오류를 장애로 만들 수 있습니다. 첫 1~2주는 지원 client의 proof 검증 결과만 기록하고, canonical URL mismatch·clock skew·nonce challenge·replay reject를 집계합니다. 이 단계에서는 성공 요청을 막지 않더라도, 실제로 proof가 검증됐는지와 실패 이유는 분리해 남겨야 합니다.

| 지표 | 확대 중단 또는 조사 기준 예시 | 확인할 것 |
| --- | --- | --- |
| valid DPoP proof rate | 지원 client에서 99.9% 미만 | SDK 버전·proxy URL·key persistence |
| `htu` mismatch | 전체 요청의 0.1% 초과 | host rewrite, trailing slash, query 정책 |
| `iat` skew reject | 기준선 대비 급증 | device clock·server NTP·허용 창 |
| replay reject | 0이 아닌 건은 표본 조사 | 재전송 버그, retry proxy, 실제 공격 |
| nonce retry success | 99% 미만 | nonce cache, client retry 순서 |

telemetry에는 access token이나 proof 원문을 남기지 않습니다. token hash의 짧은 식별자, client ID, key thumbprint의 안전한 식별자, failure category, route template, trace ID면 운영 판단에 충분합니다. raw JWK나 JWT를 log에 복사하면 탈취를 줄이려던 기능이 새로운 유출 경로를 만듭니다.

## 트레이드오프/주의점

DPoP는 access token 탈취에 대한 방어층이지 OAuth 전체의 대체재가 아닙니다. authorization code intercept를 막는 PKCE, refresh token rotation, 좁은 scope와 audience, 서버측 revoke, 사용자 세션 회수는 그대로 필요합니다. [Device Authorization Grant](/learning/deep-dive/2026-10-05-device-authorization-grant-cli-security-playbook/)처럼 사용자 승인과 token 회수를 별도로 다루는 flow에서는 DPoP가 한 요소일 뿐입니다.

proof마다 서명과 replay store I/O가 추가되므로 hot path 비용이 늘어납니다. 무조건 Redis를 붙이기보다 route별 QPS, token TTL, peak replay-key cardinality를 계산해야 합니다. 초당 5,000개 proof를 10분 보관하면 이상적으로도 약 300만 key가 됩니다. key 크기, 복제, eviction, 장애 시 정책까지 측정하지 않으면 보안 기능이 availability 병목이 됩니다.

DPoP를 “기기 인증”으로 과장해서도 안 됩니다. proof key가 hardware-backed인지, export 가능한 software key인지, 같은 사용자의 여러 기기에서 어떻게 복구되는지는 DPoP 표준 밖의 client 구현 문제입니다. 기기 신뢰가 요구되는 관리자 행동에는 [Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)과 device/session risk 신호를 별도로 결합해야 합니다.

## 체크리스트 또는 연습

- [ ] access token의 `cnf.jkt`와 proof JWK thumbprint를 resource server에서 비교한다.
- [ ] `htm`, canonical `htu`, `iat`, `jti`, `ath`, nonce의 검증 규칙과 허용 창이 문서화돼 있다.
- [ ] proxy가 덮어쓴 scheme·host만 신뢰하며, external URL과 internal URL을 혼동하지 않는다.
- [ ] `(jkt, jti)`를 원자적으로 기록하는 replay store와 TTL·장애 정책이 있다.
- [ ] 고위험 write API는 DPoP 외에 업무 idempotency key와 step-up authorization을 적용한다.
- [ ] token·proof 원문·private key·raw JWK가 로그, tracing, error response에 남지 않는다.
- [ ] key 교체·기기 복원·clock skew·nonce 재시도·replay store 장애를 canary에서 시험했다.

연습으로 외부 partner API 하나를 골라 다음 두 요청을 설계해 보세요. 첫째, 동일한 access token으로 서로 다른 DPoP key를 사용하면 `cnf.jkt` 비교에서 거절되어야 합니다. 둘째, 같은 proof를 30초 안에 재전송하면 첫 요청만 통과하고 두 번째는 replay로 거절되어야 합니다. 두 테스트가 통과한 뒤에도 proxy를 한 홉 더 넣어 `htu`가 외부 URL 기준으로 검증되는지 확인해야 합니다. 이 세 경우를 설명할 수 있다면 DPoP는 JWT 예제가 아니라 운영 가능한 token binding 계층이 됩니다.

## 관련 글

- [Token Exchange와 Downscoped Token](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/)
- [API Key Lifecycle 발급·회전·폐기](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)
- [Trusted Proxy와 Client IP 경계](/learning/deep-dive/deep-dive-trusted-proxy-client-ip-boundary-playbook/)
- [OIDC Back-Channel Logout와 세션 계약](/learning/deep-dive/deep-dive-oidc-backchannel-logout-session-contract-playbook/)
