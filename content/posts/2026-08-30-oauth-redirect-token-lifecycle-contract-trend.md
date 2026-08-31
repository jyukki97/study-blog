---
title: "2026 개발 트렌드: OAuth Redirect URI와 Refresh Token, 연동 설정이 아니라 회전 가능한 접근 경계가 된다"
date: 2026-08-30T10:06:00+09:00
lastmod: 2026-08-30T10:06:00+09:00
draft: false
tags: ["OAuth", "OAuth Apps", "Token Rotation", "Application Security", "Platform Engineering", "Identity"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["OAuth redirect URI governance", "refresh token rotation", "GitHub OAuth apps", "wildcard redirect URI", "token lifecycle"]
description: "GitHub OAuth App의 복수 redirect URI, wildcard 제어, 만료 access token·refresh token 지원을 계기로 OAuth 연동을 정적 설정이 아니라 배포·회전·감사 가능한 접근 경계로 운영하는 기준을 정리합니다."
summary: "redirect URI를 여러 개 등록할 수 있다고 해서 허용 범위를 넓히면 안 됩니다. 복수 환경과 tenant를 지원하더라도 callback inventory, 정확한 매칭, refresh token 교체의 원자성, revoke·재인증 경로를 하나의 lifecycle contract로 다뤄야 합니다."
key_takeaways:
  - "2026년 8월 GitHub는 OAuth App에 최대 10개의 callback URI, 만료 access token·refresh token, URI별 wildcard 제어를 추가했다."
  - "복수 redirect URI의 목적은 모든 preview URL을 받아들이는 것이 아니라, 승인된 배포 경계를 명시적으로 inventory하는 데 있다."
  - "RFC 9700은 redirect URI의 exact matching을 기본 원칙으로 두고, public client refresh token에는 sender constraint 또는 rotation 기반 replay 탐지를 요구한다."
  - "token refresh는 단순 cron이 아니라 새 token pair 저장, 이전 pair 폐기, 동시 refresh 경합, revoke와 재인증을 포함한 상태 전이다."
operator_checklist:
  - "OAuth client마다 production·staging·localhost·tenant callback URI, owner, 배포 경로, wildcard 필요 근거를 한 inventory로 관리한다."
  - "wildcard는 사용자 콘텐츠·open redirect·공유 preview 도메인이 없는 통제된 subdomain에만 제한하고, 필요 없으면 명시적으로 끈다."
  - "refresh token은 암호화된 secret store에 보관하고, refresh 시 새 access/refresh pair를 원자적으로 교체하며 이전 pair를 재사용하지 않는다."
  - "access token 만료, refresh 실패, revoke, callback mismatch를 서로 다른 metric과 alert reason으로 분리한다."
learning_refs:
  - title: "OAuth2/OIDC 심화"
    href: "/learning/deep-dive/deep-dive-oauth2-oidc/"
    description: "authorization code, PKCE, state, token 교환의 기본 흐름을 복습합니다."
  - title: "서드파티 OAuth 공급망 경계"
    href: "/posts/2026-04-22-third-party-oauth-supply-chain-trend/"
    description: "외부 앱 위임 권한을 조직 공급망 자산으로 다루는 관점입니다."
  - title: "API Key Lifecycle과 회전·회수"
    href: "/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/"
    description: "장기 자격증명의 owner, 만료, 회수, 증거를 운영 계약으로 만드는 방법입니다."
  - title: "고위험 액션 Step-up Authorization"
    href: "/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/"
    description: "토큰 이상을 발견했을 때 사용자 흐름을 모두 끊지 않는 추가 인증 설계입니다."
decision_guide:
  title: "redirect URI와 token lifecycle을 언제 분리·강화할까"
  intro: "선택 기준은 callback 개수가 아니라, 각 경로를 누가 배포하고 어떤 데이터·권한을 가진 사용자에게 연결하는가입니다."
  cases:
    - badge: "단일 앱 유지"
      title: "production과 통제된 staging만 있고 callback owner가 같다"
      fit: "도메인·배포 pipeline·로그 정책이 한 팀의 통제 아래 있고 각 URI를 정확히 등록할 수 있는 경우"
      watchouts: "편의상 preview wildcard를 추가하면 review 앱이나 사용자 콘텐츠 경로까지 코드가 전달될 수 있다."
      next_step: "URI별 owner와 환경을 inventory하고 exact match·PKCE·state 검증을 CI smoke test에 둔다."
    - badge: "앱 분리"
      title: "prod와 preview의 데이터 등급·secret·운영 주체가 다르다"
      fit: "fork PR, 고객별 custom domain, 외부 개발자 sandbox가 production 권한과 섞일 위험이 있는 경우"
      watchouts: "한 client에 broad wildcard를 두면 설정은 줄지만 blast radius와 audit 해석이 커진다."
      next_step: "environment별 OAuth client, consent screen, scope, secret, callback allowlist를 분리한다."
    - badge: "회전 보류"
      title: "새 refresh token을 안전하게 저장·교체·복구할 경로가 없다"
      fit: "기존 애플리케이션이 long-lived token만 가정하고, 여러 worker가 동시에 refresh할 수 있는 경우"
      watchouts: "만료 token을 강제하면 정상 사용자의 연동이 한꺼번에 끊길 수 있다."
      next_step: "한 사용자·한 client의 refresh lease, encrypted storage, 재인증 UX, rollback 관측성을 먼저 만든다."
---

OAuth callback URL은 보통 애플리케이션 등록 화면에서 한 번 입력하고 잊어버리는 값처럼 취급됩니다. refresh token도 마찬가지입니다. 발급되면 비밀 저장소에 넣고 만료 시점에 재발급하면 된다고 생각하기 쉽습니다. 그러나 preview 배포, custom domain, 여러 tenant, 모바일·CLI, 장기 SaaS 연동이 늘면 callback과 token은 설정값이 아니라 **사용자 권한이 어느 배포 경계로 되돌아가고, 누가 그 권한을 계속 갱신할 수 있는지**를 결정하는 접근 경계가 됩니다.

이 변화는 최근 GitHub OAuth App 업데이트에서 분명하게 보입니다. 2026년 8월 14일 GitHub는 OAuth App에 최대 10개의 callback URI를 등록할 수 있게 하고, 만료 access token·refresh token과 URI별 wildcard 제어를 제공했습니다. 여러 도메인과 환경을 지원하기 위한 편의 기능이지만, 동시에 과거 단일 callback URI에 남아 있던 wildcard 동작을 다시 점검하라고 안내합니다. 기능의 핵심은 URL을 더 많이 받는 것이 아니라, **redirect 허용 범위와 token 수명주기를 명시적으로 운영하라는 신호**입니다.

이 글은 [OAuth2/OIDC 심화](/learning/deep-dive/deep-dive-oauth2-oidc/), [서드파티 OAuth 공급망 경계](/posts/2026-04-22-third-party-oauth-supply-chain-trend/), [API Key Lifecycle과 회전·회수](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/), [고위험 액션 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)의 다음 단계입니다. 앞선 글이 위임 권한과 장기 자격증명 위험을 다뤘다면, 여기서는 OAuth client를 배포·회전·감사 가능한 제품 경계로 만들 방법을 다룹니다.

참고한 공식 자료:

- [GitHub Changelog: Multiple redirect URIs and token refresh for OAuth apps](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/)
- [GitHub Docs: Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub Docs: Best practices for creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)

## 이 글에서 얻는 것

- 복수 redirect URI와 wildcard가 왜 배포 편의 기능이면서도 권한 유출 경계가 되는지 이해합니다.
- production, staging, preview, tenant callback을 한 OAuth client에 둘지 분리할지 판단하는 기준을 얻습니다.
- refresh token rotation을 동시성·저장·재인증·revoke까지 포함한 상태 전이로 설계할 수 있습니다.
- callback mismatch, refresh replay, 만료, provider 기능 차이를 지표와 rollout gate로 운영하는 방법을 배웁니다.

## 핵심 개념/이슈

### 1) redirect URI는 로그인 후의 화면 이동이 아니라 authorization code의 수신 경계다

authorization code flow에서 identity provider는 사용자가 승인한 뒤 code를 redirect URI로 돌려보냅니다. 이 주소가 넓게 매칭되거나, 도착한 callback이 임의 URL로 다시 이동할 수 있으면 code가 공격자 경로로 흘러갈 수 있습니다. 그래서 RFC 9700은 native app의 localhost port 같은 제한된 예외를 빼고, 등록된 URI와 요청 URI의 **exact string match**를 기본 원칙으로 둡니다. `https://app.example.com/callback`과 `https://app.example.com/callback/`도 운영 관점에서는 다른 계약으로 보는 편이 안전합니다.

복수 URI 지원은 이 원칙을 약화시키지 않습니다. 오히려 `prod`, `staging`, controlled local development처럼 필요한 경계를 목록으로 만들 기회입니다. GitHub의 경우 최대 10개 callback URI를 등록할 수 있지만, 한도 10개가 모든 preview·임시 도메인을 넣으라는 뜻은 아닙니다. 각 URI는 코드가 도착해도 되는 trust boundary여야 합니다.

| callback 유형 | 권장 방식 | 기본 금지 또는 주의 |
| --- | --- | --- |
| production 고정 도메인 | 정확한 HTTPS URI 1개 | path prefix·subdomain wildcard |
| 통제된 staging | 별도 정확 URI 또는 별도 client | production client secret 공유 |
| localhost 개발 | provider가 허용하는 loopback 규칙으로 제한 | shared tunnel·공개 임시 URL |
| 고객별 subdomain | 각 tenant URI inventory 또는 제한된 wildcard | 사용자 콘텐츠를 올릴 수 있는 subdomain |
| fork/PR preview | 별도 OAuth client 또는 mock identity | production OAuth client wildcard |

URI 자체만 검증한다고 끝나지 않습니다. callback handler에서 `state`를 세션·요청과 검증하고, public client라면 PKCE를 사용하며, `next`나 `returnUrl` 같은 후속 이동값은 origin allowlist로 검증해야 합니다. 정확한 OAuth callback 뒤에 open redirect가 있으면 넓은 redirect URI와 비슷한 결과가 납니다.

### 2) wildcard는 tenant 지원 기능이지 도메인 전체 신뢰 선언이 아니다

GitHub는 URI별 wildcard matching을 켤 수 있게 했고, 단일 URI를 가진 기존 앱에는 이전 동작을 검토해 필요 없으면 끄라고 안내합니다. wildcard가 필요한 실제 사례는 있습니다. 예를 들어 각 tenant에 `tenant-a.login.example.com`, `tenant-b.login.example.com` 같은 전용 subdomain을 주고, 해당 zone의 DNS·배포·라우팅을 플랫폼 팀이 엄격히 통제하는 경우입니다.

하지만 아래 조건 중 하나라도 맞으면 wildcard를 편의 설정으로 쓰지 않는 편이 좋습니다.

- 사용자가 자신의 site·file·HTML을 올릴 수 있는 subdomain이 있다.
- `preview-*`, branch name, 외부 fork처럼 누구나 경로를 만들 수 있다.
- callback 뒤의 application route가 `next`, `continue`, `return_to`를 임의 origin으로 넘긴다.
- CDN, legacy proxy, DNS delegation의 owner가 한 팀으로 명확하지 않다.

이 경우는 customer success를 위한 URL 확장이 아니라 authorization code의 수신자가 늘어나는 일입니다. GitHub의 공지도 wildcard가 관련 subdomain이나 path에 code와 사용자를 보낼 수 있으며, route 통제가 약한 site에서 악용될 수 있다고 지적합니다. 기본값은 **exact URI**, wildcard는 owner·DNS·routing·콘텐츠 정책을 증명한 예외여야 합니다.

### 3) refresh token rotation은 저장 성공과 재사용 탐지를 함께 보장해야 한다

GitHub Docs에 따르면 만료 access token을 쓰는 OAuth App은 refresh token을 받으며, access token은 8시간, refresh token은 사용 없이 6개월 뒤 만료합니다. refresh 요청이 성공하면 새 access token과 새 refresh token이 오고, 이전 refresh token과 이전 access token은 더 이상 사용할 수 없습니다. 즉 refresh는 값을 덮어쓰는 유지보수 작업이 아니라 **이전 pair를 소비하고 새 pair로 전이하는 상태 변경**입니다.

가장 흔한 장애는 여러 request 또는 여러 worker가 동시에 refresh를 시도하는 경우입니다. worker A가 새 pair를 저장하기 전에 worker B가 이전 refresh token으로 요청하면, 한쪽은 invalid token을 받고 사용자를 잘못 로그아웃시킬 수 있습니다. 다음 순서가 필요합니다.

1. `subject + client` 단위로 짧은 refresh lease를 획득합니다.
2. 저장된 token version과 만료 시각을 다시 읽어, 이미 갱신됐으면 새 값을 사용합니다.
3. provider에서 새 pair를 받으면 암호화된 저장소에 **한 transaction으로** access token, refresh token, expiry, version을 교체합니다.
4. 성공 commit 뒤에만 이전 pair를 폐기된 것으로 기록하고 lease를 풉니다.
5. `invalid_grant`, revoke, refresh expiry는 transient network error와 다르게 처리해 재인증으로 보냅니다.

```text
active(v17, expires_soon)
  -- refresh success --> active(v18, new_pair)
  -- timeout ----------> active(v17), bounded retry
  -- invalid_grant ----> reauth_required
  -- revoke -----------> revoked
```

RFC 9700은 public client refresh token에 sender constraint 또는 rotation 기반 replay 탐지를 요구합니다. provider의 rotation을 사용해도 애플리케이션 쪽이 예전 token을 로그·cache·job payload에 남기면 방어 효과가 약해집니다. refresh token은 access token보다 오래 살아남는 경우가 많으므로, log redaction, encryption at rest, 최소 접근, export 금지, revoke 경로를 더 엄격히 적용해야 합니다.

### 4) OAuth client의 환경 분리는 보안만이 아니라 incident 범위 분리다

production과 staging URI를 같은 client에 넣으면 registration 수는 줄어듭니다. 반면 client secret, consent, token store, audit event, callback 실수의 범위도 연결됩니다. 무엇이 맞는지는 "URI가 몇 개인가"가 아니라 data class와 owner가 같은지에 달렸습니다.

| 조건 | 한 client의 복수 URI | environment별 client 분리 |
| --- | --- | --- |
| 같은 team·secret·데이터 등급 | 관리 부담이 작음 | 필요성 낮음 |
| staging이 실데이터 또는 prod scope에 접근 | blast radius가 큼 | 권장 |
| preview가 외부 contributor에게 열림 | wildcard 유혹이 큼 | 필수에 가까움 |
| tenant별 고정 전용 domain | inventory 가능하면 선택 가능 | 고위험 tenant는 고려 |
| provider 지원 기능이 환경마다 다름 | feature 분기 증가 | 권장 |

GitHub Enterprise Server와 GitHub.com을 동시에 지원하는 앱은 특히 조심해야 합니다. Docs는 `offline_access`가 Enterprise Server에서는 아직 효과가 없을 수 있어, 항상 refresh token이 돌아온다고 가정하지 말라고 설명합니다. 따라서 token response는 optional field로 파싱하고, provider·deployment별 capability matrix를 CI fixture와 운영 문서에 남겨야 합니다.

## 실무 적용

### 1) callback inventory를 배포 자산처럼 관리한다

OAuth registration은 보안팀만 아는 console 설정으로 남기지 마세요. application repository나 platform configuration에 아래 필드를 둬서 code review 대상에 만듭니다. secret 값은 넣지 않되, URI와 owner·정책은 추적 가능해야 합니다.

```yaml
oauth_client: github-web-prod
callbacks:
  - uri: "https://app.example.com/auth/github/callback"
    environment: production
    owner: identity-platform
    wildcard: false
    data_class: regulated
  - uri: "https://staging.example.net/auth/github/callback"
    environment: staging
    owner: identity-platform
    wildcard: false
    expires_after: "2026-12-31"
token_policy:
  access_token_ttl_hours: 8
  refresh_rotation: required
  refresh_store: encrypted-secret-store
```

CI에서는 적어도 다음을 확인할 수 있습니다.

- callback URI가 HTTPS이고 approved domain inventory에 속하는가
- wildcard가 `false`이거나, 예외 ticket·owner·만료일이 있는가
- callback handler가 `state`와 PKCE verifier를 검증하는가
- callback 이후 이동 URL이 상대 경로 또는 allowlist origin인가
- production client와 preview client가 같은 secret reference를 쓰지 않는가

### 2) 만료 token은 5% 파일럿으로 도입한다

GitHub는 `offline_access` scope로 개별 sign-in에서 만료 token을 받아 점진적으로 시험할 수 있게 합니다. 기존 long-lived token이 있는 서비스에서 앱 전체 설정을 곧바로 바꾸면 background integration이 한꺼번에 끊길 수 있습니다. 다음처럼 rollout을 작게 시작하세요.

1. **준비**: refresh lease, encrypted storage, redacted logs, reauth 화면, revoke runbook을 먼저 배포합니다.
2. **내부 계정 5%**: 새 sign-in에만 expiring token을 요청하고 refresh success, concurrent refresh, reauth completion을 7일 관찰합니다.
3. **25% 확대**: refresh success가 99.9% 이상이고, `invalid_grant`가 baseline보다 +0.05%p 미만일 때 확대합니다.
4. **기본값 전환**: 새 token에 만료를 강제하되, 기존 long-lived token이 자동으로 만료되는지 provider 정책을 별도 확인합니다.

정확한 숫자는 호출 빈도와 user base에 맞춰 조정해야 합니다. 다만 만료율, refresh failure, 강제 재인증, callback mismatch를 하나의 "OAuth 오류율"로 합치지 마세요. 원인과 복구 책임자가 서로 다릅니다.

### 3) failure를 다섯 상태로 분류해 incident를 줄인다

| 상태 | 사용자 경험 | 운영자 첫 행동 | 자동 조치 |
| --- | --- | --- | --- |
| callback mismatch | 안전한 오류·재시작 | registration/배포 URI diff 확인 | code 교환 금지 |
| state/PKCE mismatch | 재인증 안내 | session·CSRF 이상 조사 | session 폐기 |
| refresh network timeout | 짧은 재시도 | provider 상태와 retry budget 확인 | lease 유지 후 bounded retry |
| refresh `invalid_grant` | 재인증 요청 | replay·revoke·저장 경합 분류 | 기존 pair 사용 중단 |
| access denied/revoked | 권한 재승인 안내 | scope·앱 철회·security event 확인 | 연결 기능 최소화 |

특히 `invalid_grant`를 단순한 500처럼 재시도하면 token replay 또는 동시 refresh의 증거를 덮을 수 있습니다. 반대로 일시 network timeout마다 즉시 사용자를 로그아웃시키면 provider 짧은 장애가 제품 이탈이 됩니다. error contract를 분리하면 이 두 극단을 피할 수 있습니다.

## 트레이드오프/주의점

복수 redirect URI는 client 수와 등록 화면의 마찰을 줄입니다. 그러나 URI 수가 늘수록 누가 어느 URI를 소유하는지, 어떤 배포가 그 경로를 바꾸는지, 언제 제거할지를 추적해야 합니다. dev tunnel이나 preview URL을 빨리 연결해야 한다는 이유로 wildcard를 열면, temporary deployment가 production authorization code를 받는 길이 생길 수 있습니다. 빠른 개발은 mock identity 또는 낮은 권한의 별도 client로 해결하는 편이 안전합니다.

짧은 access token은 탈취 피해 시간을 줄이지만 refresh token 저장과 동시성 설계를 요구합니다. persistent worker, mobile, CLI, background job이 같은 연결을 공유한다면 refresh lease와 versioned write가 없을 때 실패가 사용자의 무작위 로그아웃으로 보일 수 있습니다. provider가 refresh token을 지원하지 않는 환경도 있으므로, "반드시 refresh한다"보다 capability를 탐지하고 안전하게 재인증시키는 흐름이 중요합니다.

마지막으로 token을 회전한다고 scope가 좁아지는 것은 아닙니다. read-only가 필요한 integration에 repo admin이나 org write 권한을 그대로 준 채 TTL만 줄이면 blast radius는 시간만 짧아집니다. scope 최소화, resource 제한, 앱 owner, audit log, revoke-to-containment 목표를 함께 둬야 lifecycle contract가 완성됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] OAuth client별 callback URI, 환경, owner, 데이터 등급, wildcard 근거가 inventory에 있다.
- [ ] 기본 정책은 exact redirect URI match이며, wildcard는 통제된 domain·route에서만 만료일 있는 예외로 쓴다.
- [ ] callback handler가 `state`, PKCE, post-login return URL allowlist를 검증한다.
- [ ] access token·refresh token·expiry·version을 암호화된 저장소에서 원자적으로 교체한다.
- [ ] 동일 subject/client의 동시 refresh를 lease 또는 optimistic version으로 직렬화한다.
- [ ] `invalid_grant`, revoke, 만료, timeout, callback mismatch를 별도 metric·alert·복구 흐름으로 둔다.
- [ ] 새 만료 token 정책은 내부 5%부터 canary하고 기존 token의 전환 조건을 문서화했다.
- [ ] refresh token은 로그·queue·analytics export에서 마스킹하고 revoke·재인증 runbook을 검증했다.

### 연습: preview 환경 OAuth 분리 결정하기

PR마다 `pr-123.preview.example.com`을 만드는 서비스를 가정해 봅시다. 먼저 preview가 외부 fork에서 만들어질 수 있는지, 누가 DNS와 routing을 통제하는지, production secret·scope·사용자 데이터에 접근하는지 적습니다. 하나라도 production과 다르면 production OAuth App에 wildcard를 켜는 대신 preview 전용 client와 mock 또는 read-only scope를 만드는 쪽이 낫습니다. 다음으로 callback URI가 정확히 일치하지 않을 때 code exchange가 발생하지 않는 test, callback handler의 `next`가 외부 origin으로 가지 않는 test, refresh를 두 worker가 동시에 호출해도 token version이 하나만 증가하는 test를 작성하세요. 이 세 테스트는 "로그인이 된다"보다 훨씬 강한 운영 증거가 됩니다.

## 관련 글

- [OAuth2/OIDC 심화](/learning/deep-dive/deep-dive-oauth2-oidc/)
- [서드파티 OAuth 공급망 경계](/posts/2026-04-22-third-party-oauth-supply-chain-trend/)
- [API Key Lifecycle과 회전·회수](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)
- [고위험 액션 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
