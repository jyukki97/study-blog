---
title: "2026 개발 트렌드: AI 개발 에이전트의 권한은 계정이 아니라 비인간 신원 수명주기로 관리해야 한다"
date: 2026-11-02T10:06:00+09:00
lastmod: 2026-11-02T10:06:00+09:00
draft: false
tags: ["AI Coding Agent", "Non-Human Identity", "Developer Security", "CI/CD", "Platform Engineering", "Least Privilege"]
categories: ["Development", "AI", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["AI agent non-human identity", "ephemeral agent credential", "agent workload identity", "coding agent access governance", "just-in-time permissions"]
description: "AI 개발 에이전트가 repository·CI·cloud API를 넘나드는 환경에서, 개인 PAT 공유 대신 목적·수명·범위·증거를 갖춘 비인간 신원으로 권한을 운영하는 기준을 정리합니다."
summary: "에이전트의 권한을 사람 계정이나 장기 토큰에 얹으면 편하지만, 누가 어떤 작업을 위해 무엇을 실행했는지가 흐려진다. AI 개발 도구의 실용적인 보안 단위는 ‘강한 모델’이 아니라 짧은 수명의 workload identity, 제한된 capability, 만료·회수 가능한 실행 증거다."
key_takeaways:
  - "에이전트 권한은 실행 주체, 작업 목적, repository·environment 범위, 만료 시각으로 나뉜 비인간 신원으로 발급해야 한다."
  - "읽기·계획·코드 변경·외부 배포를 같은 토큰으로 처리하지 말고, 효과가 커질수록 별도 capability와 승인 조건을 둔다."
  - "감사는 prompt 전문을 쌓는 일이 아니라 identity, 입력 revision, 허용 action, 실제 effect, 만료·회수 결과를 연결하는 일이다."
operator_checklist:
  - "에이전트 실행마다 사람 소유자와 작업 ID, repository/ref, environment, 만료 시각이 연결된 short-lived credential을 발급한다."
  - "write·merge·deploy·secret read를 독립 capability로 나누고, fallback 토큰·공유 PAT를 기본 경로에서 제거한다."
  - "실행 receipt에는 허용된 scope와 실제 외부 effect를 남기며, 중단·실패 시 credential과 session artifact를 회수한다."
---

AI 코딩 에이전트는 이제 코드 제안만 하는 도구가 아닙니다. repository를 읽어 이슈를 고르고, branch를 만들고, 테스트를 실행하며, CI와 cloud API의 상태를 확인하고, 때로는 PR·배포 후보를 만듭니다. 여기서 “개발자 계정으로 로그인했으니 에이전트도 같은 권한을 써도 된다”는 편의는 빠르게 위험이 됩니다. 브라우저 세션, 장기 PAT, CI secret 하나가 여러 실행·여러 repository·여러 환경을 가로지르면, 잘못된 tool call이나 탈취된 session의 영향 범위를 줄이기 어렵습니다.

최근 개발 도구의 흐름은 에이전트에 더 많은 통합 권한을 주는 방향이지만, 운영의 핵심 문제는 모델 능력보다 **누구의 어떤 목적을 위해, 어느 범위에서, 얼마나 오래 실행되었는가**를 증명하는 일입니다. [Agent-to-Agent 위임의 권한·증거 계약](/posts/2026-10-28-agent-to-agent-delegation-authority-receipt-trend/), [검증 범위 manifest](/posts/2026-10-27-agent-verification-scope-manifest-trend/), [AI가 다루는 IaC plan의 증거 정책](/posts/2026-10-24-iac-agent-plan-evidence-policy-trend/), [CI-native agent runner의 token 경계](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)를 연결해, 에이전트를 사람의 대리 계정이 아니라 **수명과 capability가 있는 비인간 신원(non-human identity)** 으로 다루는 기준을 정리합니다.

## 이 글에서 얻는 것

- 개인 계정·공유 PAT·고정 service account가 에이전트 실행에 맞지 않는 이유를 구분합니다.
- agent session마다 owner, 목적, repository/ref, environment, 만료 시각을 묶어 신원을 발급하는 방법을 배웁니다.
- 읽기, 코드 write, merge, deploy, secret read를 같은 권한으로 묶지 않는 의사결정 기준을 얻습니다.
- 실행 receipt와 회수 절차를 이용해 자동화 속도와 사고 조사 가능성을 함께 유지하는 방법을 정리합니다.

## 핵심 개념/이슈

### 1) 로그인 주체와 실행 주체는 같지 않다

개발자가 에이전트 UI에 로그인한 것은 작업을 요청한 사람을 식별하는 데 도움이 됩니다. 하지만 실제로 `git push`, package publish, cloud resource read, issue comment를 실행하는 주체는 사람 손이 아니라 agent runtime입니다. 둘을 같은 identity로 취급하면 다음 질문에 답하기 어렵습니다. 개발자가 허용한 것은 repository read였는가, production deploy였는가? 같은 사람이 다음 날 다른 task를 실행해도 같은 권한이 필요한가? runtime이 탈취되면 언제까지 권한이 남는가?

그래서 최소 신원 단위는 사람의 계정 하나가 아니라 다음 네 축이어야 합니다.

| 축 | 예시 | 왜 필요한가 |
| --- | --- | --- |
| 요청자·owner | `user:kim`, on-call group | 승인·책임·중단 요청의 주체 |
| 작업 목적 | `fix-test`, `review-plan`, `deploy-canary` | 필요한 action을 좁히는 기준 |
| 대상 범위 | repo/ref, issue, environment, tenant | 다른 프로젝트·production으로의 확산 방지 |
| 수명 | 15분 session, 1시간 CI run | 토큰 유출·유휴 session의 창 축소 |

이 네 항목을 가진 workload identity는 사람을 배제하는 장치가 아닙니다. 오히려 에이전트가 사람을 대신해 실행한 범위를 명확히 합니다. 개인 PAT를 agent config에 넣으면 처음에는 통합이 쉽지만, 토큰이 언제·어디서·어떤 task에 사용됐는지 설명할 수 없는 공용 열쇠가 됩니다.

### 2) capability는 역할보다 작고, effect보다 앞서야 한다

`developer`, `admin`, `bot` 같은 넓은 role만으로는 에이전트의 권한을 설명하기 어렵습니다. 같은 repository에서도 코드를 읽는 일, branch에 쓰는 일, PR을 merge하는 일, release를 publish하는 일은 효과와 복구 난이도가 다릅니다. 특히 agent가 도구를 여러 번 호출하는 흐름에서는 처음에 read-only로 시작했더라도 후속 tool이 write나 network egress를 요구할 수 있습니다.

실무에서는 역할을 없애기보다, 역할 위에 짧은 capability를 얹는 편이 현실적입니다.

| capability | 권장 기본값 | 승격 조건 |
| --- | --- | --- |
| `repo.read` | task 범위의 ref만 허용 | 없음 또는 기본 승인 |
| `workspace.write` | isolated worktree만 허용 | 변경 경로 allowlist |
| `pull_request.create` | draft PR만 허용 | 테스트 receipt·owner 연결 |
| `merge` | 기본 거부 | 별도 reviewer·branch protection |
| `deploy.canary` | production 기본 거부 | plan·대상·rollback·승인 |
| `secret.read` | 기본 거부 | secret별 용도·runtime attest |

여기서 중요한 순서는 **권한이 아니라 효과**입니다. agent가 “테스트를 위해” secret을 읽고 싶다고 해도, 테스트가 실제로 그 secret이 필요한지, mock·sandbox credential로 대체할 수 없는지 먼저 따져야 합니다. [MCP native secret scanning을 shift-left하는 방법](/posts/2026-05-24-mcp-native-secret-scanning-shift-left-trend/)처럼 secret 노출은 탐지 기능만으로 해결되지 않습니다. 애초에 필요한 session과 tool에만 주입하는 경계가 우선입니다.

### 3) 장기 토큰은 자동화의 장애 복구 경로가 되기 쉽다

에이전트 통합이 막히면 팀은 흔히 “임시로 PAT 하나를 넣자”라고 결정합니다. 하지만 이 임시는 provider scope가 넓고, 만료되지 않고, 여러 agent와 CI가 공유하며, 로컬 로그·shell history·환경 변수로 흘러갈 가능성이 큽니다. 더 나쁜 점은 short-lived credential 발급이 실패했을 때 이 토큰을 fallback으로 두는 것입니다. 보안이 약한 경로가 장애 때 자동으로 선택되면, 평소 정책은 사실상 장식이 됩니다.

대신 identity provider 또는 CI OIDC로 session-bound credential을 발급하고, issuer·audience·repo/ref·environment·task ID 조건을 검증하세요. 예를 들어 review agent는 `repo:org/service:pull_request` claim에만 15분짜리 read token을 받고, canary deploy는 승인된 workflow run에서만 30분짜리 deploy capability를 받는 식입니다. 이 값은 예시일 뿐이지만, **사용자 대화가 길어진다는 이유로 credential 수명도 길어질 필요는 없다**는 원칙은 중요합니다. session은 갱신할 수 있고, 권한은 매 단계 다시 평가할 수 있습니다.

### 4) prompt 로그가 아니라 실행 receipt가 감사의 중심이다

agent의 reasoning이나 prompt 전문을 전부 저장하면 조사에 도움이 될 것처럼 보입니다. 그러나 여기에 source code, 고객 데이터, secret 조각이 섞일 수 있고, 긴 자연어 로그만으로는 실제 권한 효과를 재구성하기도 어렵습니다. 감사의 1차 단위는 “무슨 생각을 했나”보다 “무엇을 할 권한이 있었고 실제로 무엇을 했나”여야 합니다.

안전한 receipt에는 다음처럼 최소한의 연결 정보를 남깁니다.

```yaml
run_id: run_01...
owner: team:payments
task_kind: deploy_canary
source_revision: 4c91...
identity_id: wi_01...
granted_capabilities: [repo.read, deploy.canary]
target: prod-canary/payments-api
policy_version: agent-access-v6
effects: [rendered_plan_digest, rollout:10-percent]
expires_at: 2026-11-02T01:36:00Z
revoked_at: null
```

이 receipt는 approval을 대체하지 않습니다. 고위험 효과에는 별도 승인과 branch protection, cloud policy가 여전히 필요합니다. receipt의 역할은 승인된 범위와 실제 실행 결과의 차이를 찾고, 문제가 생겼을 때 해당 identity를 즉시 회수할 수 있게 하는 것입니다.

## 실무 적용

### 1) 먼저 agent access inventory를 만든다

새 플랫폼부터 도입하지 말고, 현재 agent가 접근하는 surface를 네 줄로 inventory하세요: repository write, CI token, cloud deploy, secret store, issue/comment, browser session, package registry. 각 항목에 “어떤 agent가, 누구의 요청으로, 어떤 credential로, 최대 얼마 동안” 접근하는지만 적어도 공유 PAT와 broad service account가 드러납니다.

우선순위는 다음이 좋습니다.

1. production write 또는 secret read가 가능한 장기 credential
2. 하나의 token으로 여러 repository·environment를 가로지르는 runtime
3. owner·task ID 없이 실행되는 scheduled agent
4. 실패 시 더 넓은 fallback token을 사용하는 integration

첫 주에는 가장 위험한 token 하나를 없애기보다, 해당 실행을 observe-only 또는 plan-only로 내리고 receipt를 남기는 것부터 시작할 수 있습니다. 누가 어떤 권한을 실제로 쓰는지 모르면 좁히는 과정에서 팀의 delivery를 멈출 수 있기 때문입니다.

### 2) 권한 발급을 task 단계와 연결한다

권한을 한 번 발급하고 agent 전체 대화에 붙이지 마세요. task를 `inspect → plan → change → verify → propose → deploy`로 나누고, 각 단계가 필요한 capability를 요청하도록 만듭니다. 기본 agent는 `inspect`의 read-only scope만 갖고, `change`는 isolated workspace에만 write하며, `deploy`는 plan digest와 승인 ID가 맞을 때만 별도 credential을 받게 합니다.

이 구조에서 중요한 운영 기준은 **권한 수명은 작업 SLA보다 짧고, 재발급은 명시적인 다음 단계에서만** 이라는 점입니다. 예를 들어 일반 code-review session의 credential은 15분, canary deployment는 30분으로 시작할 수 있습니다. credential 만료가 production 변경 중 발생하지 않도록 장기 토큰으로 늘리기보다, 배포 단계의 retry·checkpoint·renew policy를 별도로 설계하세요. 만료가 잦다면 TTL 자체보다 task 분해와 session heartbeat가 맞는지 먼저 검토할 일입니다.

### 3) 효과가 큰 동작은 human-in-the-loop가 아니라 evidence-in-the-loop로 만든다

모든 write에 사람이 버튼을 누르게 하면 에이전트 도입 효과가 사라질 수 있습니다. 반대로 사람 승인이 있다는 이유로 plan 없이 deploy하면 승인자는 무엇을 승인했는지 알 수 없습니다. 따라서 사람·정책·증거의 역할을 나누는 편이 좋습니다.

| 단계 | 필요한 증거 | 기본 결정 |
| --- | --- | --- |
| 코드 변경 | diff, 테스트 범위, workspace identity | draft PR 생성 허용 |
| merge | reviewer, protected branch check | 별도 사람/정책 gate |
| infra plan | rendered plan, 대상 수, 권한 diff | canary 전 검토 |
| canary deploy | plan digest, rollback, error budget | 짧은 deploy capability |
| 확대 | canary metric·receipt 일치 | 자동 또는 명시 승인 |

예를 들어 canary에서 error rate가 기준선보다 0.5%p 이상 오르거나, plan의 대상 수와 실제 대상 수가 하나라도 다르면 확대 capability를 발급하지 않습니다. 이 규칙은 AI에만 적용되는 특별 대우가 아니라, 실행 주체가 사람이든 agent든 동일한 effect gate입니다.

### 4) 회수와 incident drill을 발급만큼 자주 검증한다

권한 시스템은 token 발급 성공 화면보다 회수에 실패할 때 드러납니다. session 종료, task cancellation, policy 변경, owner 퇴사, 이상 행위 탐지 때 identity·session artifact·외부 tool session을 무엇부터 끊을지 runbook으로 만드세요. revoke가 provider마다 몇 분 지연될 수 있다면, capability TTL과 egress policy, target-side authorization을 겹쳐 영향 창을 줄여야 합니다.

월 1회 정도는 test repository에서 다음을 확인할 수 있습니다: 만료된 agent credential으로 write가 거절되는가, cancel 뒤 새 tool call이 막히는가, receipt 없이 deploy capability가 발급되지 않는가, 공유 fallback token이 선택되지 않는가. “새 policy가 배포됐다”보다 이 네 결과가 pass인지가 더 강한 운영 증거입니다.

## 트레이드오프/주의점

짧은 credential과 세분화된 capability는 초기 통합 비용을 올립니다. tool마다 OIDC 또는 token exchange를 지원하지 않을 수 있고, agent가 여러 시스템을 오갈수록 identity mapping도 복잡해집니다. 그렇다고 모든 도구가 완벽하게 지원할 때까지 개인 PAT를 표준으로 두면, 나중에 회수하기 가장 어려운 의존성이 됩니다. 지원하지 않는 tool은 우선 network egress를 좁힌 sandbox에서 read-only로 사용하고, write가 필요한 path는 adapter나 broker를 통해 제한하는 방식으로 낮출 수 있습니다.

또한 agent identity를 사용자 identity처럼 과도하게 개인화하면 운영이 경직될 수 있습니다. 중요한 것은 “모델 인스턴스마다 영구 계정을 만들자”가 아니라, 실행마다 owner·목적·범위·수명이 붙는다는 것입니다. employee ID, 대화 전문, prompt 원문을 무기한 identity ledger에 쌓아서는 안 됩니다. 개인정보·소스코드·secret을 줄인 receipt와 정책 버전으로 재현 가능한 증거를 남기세요.

마지막으로 비인간 신원이 있다고 해서 domain authorization이 대체되지는 않습니다. agent가 deploy capability를 받아도 service의 tenant 권한, 결제 한도, 데이터 export 승인 같은 제품 규칙은 해당 시스템이 최종 검증해야 합니다. identity plane은 공통 경계이고, domain rule은 업무 경계입니다. 둘 중 하나를 다른 하나의 대체재로 쓰면 안 됩니다.

## 체크리스트 또는 연습

- [ ] agent 실행마다 owner, task kind, repo/ref 또는 environment, 만료 시각이 있는 비인간 신원을 발급한다.
- [ ] `repo.read`, workspace write, PR 생성, merge, deploy, secret read를 독립 capability로 관리한다.
- [ ] 장기 PAT·공유 service account·넓은 fallback token이 기본 실행 경로에 없다.
- [ ] write와 deploy 권한은 plan·검증 receipt·target 범위를 확인한 다음 단계에서만 발급된다.
- [ ] receipt는 identity, 입력 revision, policy version, 허용 capability, 실제 effect, 만료·회수 결과를 연결한다.
- [ ] task cancel·session expiry·policy 변경 때 credential과 외부 tool session을 회수하는 runbook이 있다.
- [ ] 만료 token 거절, cancellation 뒤 새 write 차단, receipt 없는 deploy 거절을 정기적으로 시험한다.

연습으로 지금 사용하는 AI 개발 도구 하나를 고르고, 그 도구가 읽을 수 있는 것·쓸 수 있는 것·배포할 수 있는 것·secret을 볼 수 있는 것을 각각 적어 보세요. 네 권한이 하나의 장기 토큰에 묶여 있다면, 가장 먼저 분리할 것은 화면의 로그인 방식이 아니라 deploy 또는 secret read 같은 큰 effect입니다. 해당 effect에 owner·task ID·30분 이하의 만료·receipt를 붙이는 작은 경계부터 시작하면 됩니다.

## 관련 글

- [Agent-to-Agent 위임을 권한·증거 계약으로 운영하기](/posts/2026-10-28-agent-to-agent-delegation-authority-receipt-trend/)
- [AI 에이전트 검증 범위 Manifest](/posts/2026-10-27-agent-verification-scope-manifest-trend/)
- [AI가 IaC를 다룰수록 Plan은 변경 증거가 된다](/posts/2026-10-24-iac-agent-plan-evidence-policy-trend/)
- [CI-Native Agent Runner의 Actions Token 경계](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)
- [MCP Native Secret Scanning을 Shift-Left하는 법](/posts/2026-05-24-mcp-native-secret-scanning-shift-left-trend/)
