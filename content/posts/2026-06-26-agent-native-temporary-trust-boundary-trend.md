---
title: "2026-06-26 개발 트렌드: Agent-Native Temporary Trust Boundary, 에이전트 시대의 계정·배포·접속은 임시 신뢰로 이동한다"
date: 2026-06-26T10:06:00+09:00
draft: false
tags: ["dev-trends", "AI Agents", "Cloudflare Workers", "Temporary Accounts", "Web Security", "Platform Engineering"]
categories: ["Development", "Tech Trend"]
description: "Cloudflare Temporary Accounts와 PACT 발표를 바탕으로, AI 에이전트가 배포와 웹 접속을 수행할 때 영구 토큰 대신 임시 계정, claim URL, 인간 개입 증명, 감사 가능한 TTL 경계를 요구하게 되는 흐름을 정리합니다."
keywords: ["temporary accounts for AI agents", "agent-native trust boundary", "wrangler deploy temporary", "PACT", "AI agent deployment security"]
summary: "AI 에이전트가 코드를 쓰고 배포하고 웹을 탐색하는 단계로 들어오면서, 사람 중심 OAuth와 영구 API 토큰은 병목이 되고 있다. 다음 기본값은 임시 계정, 짧은 TTL, claim flow, proof-of-human-in-loop, audit receipt가 결합된 신뢰 경계다."
key_takeaways:
  - "AI agent deploy 경험은 영구 API token 발급보다 short-lived temporary account와 claim flow로 이동하고 있다."
  - "PACT 같은 흐름은 bot 차단보다 human-in-the-loop와 authorized agent traffic을 구분하려는 웹 신뢰 인프라 신호다."
  - "도입 기준은 편리함이 아니라 TTL, 비용 한도, secret 차단, egress 제한, audit receipt를 함께 갖췄는지다."
operator_checklist:
  - "agent가 만들 수 있는 preview deployment에는 TTL, resource quota, network egress policy를 붙인다."
  - "임시 계정에서 영구 계정으로 claim될 때 owner, repo, artifact hash, 변경 범위를 기록한다."
  - "human-in-the-loop 증명은 승인 대체물이 아니라 risk score와 abuse control 신호로만 사용한다."
learning_refs:
  - title: "Agentic Provisioning Contract"
    href: "/posts/2026-05-08-agentic-provisioning-contract-trend/"
    description: "에이전트가 인프라를 만들 때 필요한 요청 계약과 승인 경계입니다."
  - title: "Agent Sandbox Egress Policy"
    href: "/posts/2026-05-16-agent-sandbox-egress-policy-trend/"
    description: "임시 실행 환경에서 외부 네트워크를 어디까지 열지 판단하는 기준입니다."
  - title: "Remote Agent Control Plane"
    href: "/posts/2026-05-22-remote-agent-control-plane-trend/"
    description: "장기 실행 에이전트 세션의 권한, 로그, 결과 회수 구조입니다."
  - title: "AI Agent Observability Evidence Contract"
    href: "/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/"
    description: "에이전트 작업 뒤 남겨야 하는 실행 증거와 검증 단위입니다."
---

2026년 6월 말 개발 플랫폼 흐름에서 눈에 띄는 신호는 "에이전트가 코드를 잘 쓴다"보다 **에이전트가 어디까지 직접 배포하고, 어떤 신뢰 증명으로 웹을 통과할 것인가**입니다. Cloudflare는 2026년 6월 19일 [Temporary Cloudflare Accounts for AI agents](https://blog.cloudflare.com/temporary-accounts/)를 공개했고, Wrangler 문서에는 [Wrangler 4.102.0 이상에서 `wrangler deploy --temporary`](https://developers.cloudflare.com/workers/wrangler/commands/workers/)로 인증 전 임시 preview account에 배포할 수 있다고 정리되어 있습니다. 같은 주 Cloudflare는 Chrome, Edge, Firefox, Shopify와 함께 [Private Access Control Tokens(PACT)](https://www.cloudflare.com/press/press-releases/2026/cloudflare-collaborates-with-leading-browsers-to-develop-a-privacy-first-protocol-for-the-global-internet/)를 개발하겠다고 발표했습니다.

둘은 겉으로는 다른 이야기입니다. 하나는 에이전트가 Cloudflare Workers를 배포하는 개발자 경험이고, 다른 하나는 브라우저가 사람 개입을 익명 토큰으로 증명하는 웹 보안 제안입니다. 하지만 실무 관점에서는 같은 방향을 가리킵니다. 사람 중심 로그인, 대시보드 클릭, 장기 API token, CAPTCHA만으로는 에이전트 시대의 작업 흐름을 처리하기 어렵습니다. 대신 임시 계정, 짧은 TTL, claim URL, proof-of-human-in-loop, audit receipt처럼 **짧게 열고, 검증하고, 사람이 소유권을 회수하는 신뢰 경계**가 중요해지고 있습니다.

이 글은 [Agentic Provisioning Contract](/posts/2026-05-08-agentic-provisioning-contract-trend/), [Agent Sandbox Egress Policy](/posts/2026-05-16-agent-sandbox-egress-policy-trend/), [Remote Agent Control Plane](/posts/2026-05-22-remote-agent-control-plane-trend/), [AI 에이전트 관측성 증거 계약](/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/)과 이어집니다. 핵심은 "에이전트에게 배포 권한을 주자"가 아니라, **배포 가능한 임시 공간과 영구 운영 계정을 분리하자**입니다.

## 이 글에서 얻는 것

- AI agent가 배포 단계에서 사람용 OAuth와 dashboard flow에 막히는 이유를 이해할 수 있습니다.
- 임시 계정, claim URL, TTL, resource quota를 이용한 preview deployment 경계를 설계할 수 있습니다.
- PACT 같은 human-in-the-loop 증명 흐름을 CAPTCHA 대체품이 아니라 agentic web의 신뢰 신호로 해석할 수 있습니다.
- agent-native trust boundary를 도입할 때 필요한 감사 로그, 비용 제한, secret 차단, egress 정책 기준을 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) 사람용 인증 흐름은 background agent에게 hard stop이 된다

사람 개발자는 배포 중 브라우저가 열리고 OAuth 동의 화면이 뜨면 클릭하면 됩니다. MFA 앱을 열고 코드를 입력하거나 대시보드에서 API token을 복사하는 것도 귀찮지만 가능합니다. 그러나 background agent는 그 순간 멈춥니다. 사람에게 물어보거나, 영구 token을 미리 주입받거나, 배포 자체를 포기해야 합니다.

Cloudflare의 temporary account 흐름은 이 병목을 정면으로 다룹니다. 인증이 없는 상태에서 agent가 배포하려 하면 Wrangler가 `--temporary`를 안내하고, 임시 preview account에 Worker를 배포한 뒤 live Worker URL과 claim URL을 돌려주는 방식입니다. 공개된 설명 기준으로 배포는 60분 동안 살아 있고, 그 안에 사람이 claim하면 영구 소유로 전환할 수 있습니다. claim하지 않으면 만료됩니다.

이 모델의 핵심은 "인증을 없앴다"가 아닙니다. 인증 전 단계와 영구 계정 단계를 분리한 것입니다.

| 단계 | 목적 | 권장 경계 |
| --- | --- | --- |
| Temporary preview | agent가 build/deploy/verify 루프를 수행 | 60분 TTL, 낮은 quota, secret 없음 |
| Claim | 사람이 결과물을 보고 소유권 결정 | user login, ownership record, artifact hash |
| Permanent adoption | 운영 계정으로 이전 | billing, domain, secret, production policy 적용 |

이 구조는 에이전트에게 필요한 빠른 실험 루프를 열어주면서도, 운영 자산으로 편입되는 순간에는 사람과 조직 계정을 다시 요구합니다. 작은 차이처럼 보이지만, 플랫폼 운영에서는 매우 큰 경계입니다.

### 2) 임시 배포는 preview 환경이지 production 우회로가 아니다

`deploy --temporary` 같은 기능은 개발자 경험으로 보면 매력적입니다. agent가 코드를 만들고, 실제 URL에 올리고, `curl`로 검증하고, 실패하면 다시 배포할 수 있습니다. 하지만 이 경로가 production 우회로가 되면 위험합니다. "임시니까 괜찮다"는 말은 보안 설계가 아니라 희망입니다.

임시 배포 환경에는 최소한 아래 제한이 필요합니다.

- TTL: 30~60분 기본, 예외 연장 시 사람 승인
- CPU/memory/request quota: 무료 실험을 넘어서는 비용 폭주 방지
- outbound egress: 기본 deny 또는 allowlist
- secrets: production secret 주입 금지
- data: 고객 데이터 연결 금지, mock 또는 synthetic data 우선
- domain: production custom domain 연결 금지
- artifact: 배포 commit, bundle hash, build command 기록

특히 중요한 것은 secret 차단입니다. 임시 계정이 production DB나 결제 provider secret을 가질 수 있으면, 사실상 production 환경입니다. agent preview는 "실제 URL"을 제공할 수 있지만, "실제 권한"을 기본 제공해서는 안 됩니다.

이 기준은 [Outside-the-Sandbox Harness](/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/)와도 같습니다. 샌드박스 밖에 무언가를 만들 수 있게 하는 순간, 실행 결과를 누가 회수하고 어떻게 폐기하는지가 설계의 중심이 됩니다.

### 3) PACT는 human vs bot 이분법보다 human-in-the-loop 신호에 가깝다

PACT 발표도 같은 맥락에서 봐야 합니다. 공식 발표에 따르면 PACT는 "personhood"를 잘 아는 사이트가 익명 토큰을 발급하고, 브라우저가 다른 사이트에 그 토큰을 제시해 사람 개입이 있음을 증명하는 방향입니다. Cloudflare와 브라우저 벤더들은 CAPTCHA나 강제 로그인 없이 abuse를 줄이고, 사용자를 추적하지 않는 방식을 목표로 설명합니다.

여기서 중요한 점은 아직 표준화된 완성품이 아니라는 것입니다. 2026년 6월 기준으로는 협력과 개발 발표에 가깝고, 실무 시스템에 바로 붙일 API로 보면 안 됩니다. 그래도 방향은 중요합니다. 웹은 이제 "이 요청이 사람인가 봇인가"만 묻기 어렵습니다. 에이전트가 사람의 위임을 받아 합법적으로 웹을 탐색하고 구매하고 예약하고 배포하는 경우가 늘기 때문입니다.

앞으로 더 실무적인 질문은 이렇게 바뀝니다.

- 이 요청 뒤에 실제 사용자의 의도가 있는가?
- 이 agent는 사용자가 허용한 범위 안에서 행동하는가?
- 같은 token이 abuse에 재사용되고 있지 않은가?
- 사이트는 token을 사용자 추적에 악용하지 않는가?
- token이 있다고 고위험 action을 자동 승인해도 되는가?

마지막 질문의 답은 "아니오"에 가깝습니다. PACT류 신호는 risk score와 friction 조정에는 쓸 수 있지만, 결제 승인, 계정 삭제, 권한 변경 같은 고위험 작업의 사용자 동의를 대체하면 안 됩니다.

### 4) agent-native trust boundary는 TTL과 receipt가 핵심이다

에이전트용 권한은 사람이 쓰는 API token보다 더 짧고 더 많은 증거를 남겨야 합니다. 이유는 단순합니다. agent는 빠르게 반복하고, 실패를 자동으로 복구하려 하며, 사람이 한 번에 다 보지 못하는 속도로 외부 시스템을 호출합니다. 그래서 권한을 길게 열어두면 실수도 빠르게 누적됩니다.

권장 기준:

| 리소스 | 기본 TTL | 필수 증거 |
| --- | --- | --- |
| preview deployment | 30~60분 | URL, artifact hash, deploy command, owner candidate |
| temporary API token | 15~60분 | scope, issued_for, tool/session id |
| claim URL | 30~60분 | claimant user, source session, claimed resources |
| agent web access token | 5~30분 | issuer, purpose, replay counter 또는 rate limit |
| production mutation approval | 5~15분 | approval id, changed resource id, rollback hint |

TTL만으로는 부족합니다. 권한이 발급되고, 사용되고, 폐기된 흐름이 receipt로 남아야 합니다. "에이전트가 배포했다"가 아니라 어떤 세션이 어떤 bundle을 어떤 임시 계정에 올렸고, 사람이 어떤 계정으로 claim했으며, 영구 환경으로 편입될 때 어떤 정책이 적용됐는지 남아야 합니다.

이 관점은 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)와 [AI Agent Observability Evidence Contract](/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/)의 자연스러운 확장입니다.

### 5) 편리한 임시 계정은 abuse 표면도 만든다

임시 배포 계정은 좋은 UX이지만 abuse 가능성도 있습니다. 누구나 agent를 통해 임시 URL을 만들 수 있다면 phishing, malware hosting, spam landing page, crypto scam, resource exhaustion 같은 문제가 생길 수 있습니다. 따라서 플랫폼은 "가입 없는 배포"를 제공하더라도 abuse control을 같이 설계해야 합니다.

실무 제어 지점:

- proof-of-work 또는 rate limit으로 대량 생성 제한
- 동일 device/IP/session의 임시 계정 생성 횟수 제한
- outbound network와 platform binding 제한
- 신고/탐지 시 임시 계정 즉시 폐기
- claim 전에는 custom domain, billing, secret, paid resource 제한
- content scanning과 abuse classifier를 preview 배포에도 적용

이 지점에서 PACT 같은 human-in-the-loop 신호와 temporary account가 만납니다. 플랫폼은 사람 확인을 friction 없이 받고 싶지만, 그 신호가 영구 신원 추적이나 폐쇄적인 접근 장벽이 되면 또 다른 문제가 됩니다. 그래서 초기 설계는 "allow/deny 단일 결정"보다 risk score, quota, friction 조정, 추가 검증으로 쓰는 편이 안전합니다.

## 실무 적용

### 1) 사내 agent preview 계정을 만든다면

사내 플랫폼에도 같은 패턴을 적용할 수 있습니다. 에이전트가 feature branch를 기반으로 preview app을 만들고, 사람이 claim하거나 폐기하는 모델입니다.

첫 버전 요구사항:

1. agent session id와 repo/branch를 preview account에 묶는다.
2. preview TTL은 기본 60분, 최대 24시간으로 제한한다.
3. production secret은 주입하지 않는다.
4. DB는 synthetic fixture 또는 ephemeral DB만 허용한다.
5. 외부 egress는 package registry, observability endpoint 등 allowlist로 시작한다.
6. claim 시 owner, cost center, retained resources를 기록한다.
7. TTL 만료 시 DNS, storage, queue, token을 같이 정리한다.

이 모델은 preview environment 자동화와 비슷하지만, 차이는 "생성 주체가 agent"라는 점입니다. 사람이 만든 preview는 의도를 기억하지만, agent preview는 세션 로그와 receipt가 없으면 왜 만들어졌는지 금방 잊힙니다.

### 2) 도입 여부 판단 기준

임시 배포 계정은 모든 팀에 필요한 기능은 아닙니다. 아래 조건 중 2개 이상이면 검토할 만합니다.

- background agent가 하루 10개 이상 preview build를 만든다.
- OAuth/login 때문에 agent task 실패가 전체 실패의 10% 이상이다.
- preview 환경 생성 시간이 5분 이상이라 agent 검증 루프가 느리다.
- agent가 production-like URL에서 end-to-end 검증해야 한다.
- 영구 token을 agent sandbox에 넣는 일이 반복된다.

반대로 아래라면 기다리는 편이 낫습니다.

- agent 작업이 대부분 문서/테스트/로컬 코드 수정이다.
- preview 배포가 월 몇 건 수준이다.
- secret 분리와 egress 제한이 아직 없다.
- TTL 만료 리소스 cleanup 자동화가 없다.
- abuse/비용 모니터링 없이 외부 URL을 열어야 한다.

이런 상태에서 임시 계정을 열면 생산성보다 운영 부채가 빨리 쌓입니다.

### 3) 운영 지표

측정할 지표는 생성 수가 아니라 안전한 회수율입니다.

- temporary deployments created/day
- claimed ratio
- expired cleanup success rate
- average preview lifetime
- cost per preview
- deploy-to-verify latency
- policy violation count
- secret injection blocked count
- egress denied count
- abuse report count

권장 임계치:

- cleanup success rate: 99% 이상
- expired resource 잔존: 1시간 초과 0건 목표
- preview cost: production 월 비용의 1~3% 이내
- egress denied 급증: 정책 drift 또는 agent prompt 문제로 triage
- claim ratio 10% 미만: 대부분 throwaway라면 quota를 더 낮게

임시 계정이 많아졌는데 claim ratio가 낮고 비용이 오른다면, agent가 검증 없이 배포부터 하는 패턴일 수 있습니다. 이 경우 배포 전에 unit/integration test gate를 먼저 두는 편이 낫습니다.

### 4) claim flow를 제품화한다

claim URL은 단순 링크가 아닙니다. 임시 자산을 영구 자산으로 바꾸는 승인 표면입니다. 따라서 claim 화면에는 아래 정보가 보여야 합니다.

- 어떤 agent/session이 만들었는가
- 어떤 repo/branch/commit 또는 artifact hash인가
- 어떤 리소스가 생성됐는가
- 지난 60분 사용량과 비용은 얼마인가
- 어떤 secret과 external egress가 차단됐는가
- 영구 전환 시 추가로 필요한 정책은 무엇인가
- claim하지 않으면 언제 삭제되는가

이 정보가 없으면 사람은 live URL만 보고 판단하게 됩니다. agent가 만든 산출물은 겉으로 잘 보여도 내부 권한이나 비용 구조가 위험할 수 있습니다. claim은 "멋지다, 저장" 버튼이 아니라 운영 계정으로 승격하는 절차입니다.

## 트레이드오프/주의점

첫째, friction을 줄이면 생성량이 늘어납니다. 생성량 증가는 곧 비용, abuse, cleanup 문제입니다. 임시 계정은 쉽게 만들 수 있어야 하지만 쉽게 방치되면 안 됩니다.

둘째, TTL은 강력하지만 사용자 경험을 깨기도 합니다. 60분 안에 사람이 claim하지 못하면 유용한 결과물이 사라질 수 있습니다. 그래서 claim URL 만료 전 알림, 1회 연장, artifact export 같은 보조 흐름을 둘 수 있습니다. 다만 무제한 연장은 임시 계정의 의미를 없앱니다.

셋째, human-in-the-loop proof는 authorization이 아닙니다. PACT류 신호가 있다고 "사용자가 이 결제를 승인했다"로 해석하면 안 됩니다. 사람 존재, 사용자 의도, 특정 action 동의는 서로 다른 증거입니다.

넷째, 임시 계정이 provider lock-in을 키울 수 있습니다. agent가 가장 쉽게 배포되는 플랫폼으로 자연스럽게 흐르면 초기 실험은 빠르지만, 장기 운영 계정, DNS, 데이터, observability가 한 provider에 묶일 수 있습니다. 팀은 preview convenience와 production portability를 분리해서 봐야 합니다.

다섯째, standard가 아닌 흐름을 표준처럼 말하면 위험합니다. PACT는 2026년 6월 기준 개발·표준화 방향의 신호에 가깝습니다. 지금 필요한 것은 바로 구현보다, agent traffic을 어떤 신뢰 신호와 정책으로 구분할지 내부 threat model을 업데이트하는 것입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] agent preview deployment에 기본 TTL과 hard cleanup이 있다.
- [ ] production secret이 임시 계정에 주입되지 않는다.
- [ ] preview outbound egress는 allowlist 또는 risk class 기반으로 제한된다.
- [ ] claim 화면에 owner, artifact hash, 생성 리소스, 비용, policy violation이 표시된다.
- [ ] claim 전에는 custom domain, billing, production DB 연결이 막힌다.
- [ ] 임시 계정 생성과 폐기 이벤트가 audit log에 남는다.
- [ ] human-in-the-loop proof를 고위험 action 승인과 혼동하지 않는다.
- [ ] abuse report와 resource exhaustion 대응 runbook이 있다.

### 연습

1. 현재 팀의 preview environment 생성 플로우를 agent가 수행한다고 가정하고, 사람이 클릭해야 하는 단계가 몇 개인지 세어 보세요. 3개 이상이면 agent-native preview 계약을 검토할 수 있습니다.
2. 임시 배포 계정의 정책을 표로 써보세요. TTL, CPU/memory quota, egress, secret, storage, custom domain, claim 조건을 숫자로 채우면 됩니다.
3. "agent가 만든 preview URL이 phishing으로 신고됐다"는 사고를 가정하고 30분 대응 런북을 작성해 보세요. 임시 계정 폐기, artifact 보존, 생성 세션 확인, provider abuse team 연락, 재발 방지 정책이 포함되어야 합니다.

## 참고 자료

- [Cloudflare Blog: Temporary Cloudflare Accounts for AI agents](https://blog.cloudflare.com/temporary-accounts/)
- [Cloudflare Changelog: Temporary accounts for AI agent deployments](https://developers.cloudflare.com/changelog/post/2026-06-19-temporary-accounts-for-agents/)
- [Cloudflare Workers Docs: `wrangler deploy --temporary`](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Cloudflare Press Release: Private Access Control Tokens(PACT)](https://www.cloudflare.com/press/press-releases/2026/cloudflare-collaborates-with-leading-browsers-to-develop-a-privacy-first-protocol-for-the-global-internet/)
