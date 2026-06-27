---
title: "2026 개발 트렌드: Agent Capability Discovery, 에이전트는 모든 도구를 품는 대신 필요한 능력을 찾아 쓰는 쪽으로 간다"
date: 2026-06-27T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "MCP", "Agentic Resource Discovery", "Developer Tools", "GitHub Copilot", "Governance"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["Agent Capability Discovery", "Agentic Resource Discovery", "ARD", "MCP registry", "AI resource catalog", "coding agent governance"]
description: "GitHub Agent Finder, Copilot SDK GA, third-party coding agent security validation 흐름을 묶어 에이전트가 필요한 도구와 스킬을 작업별로 검색해 쓰는 방향을 실무 기준으로 정리합니다."
lastmod: 2026-06-27
summary: "Agent Capability Discovery는 에이전트가 모든 MCP 서버와 스킬을 기본 장착하는 방식에서 벗어나, 승인된 catalog에서 작업에 필요한 능력을 검색·선택·검증하는 운영 모델입니다."
key_takeaways:
  - "에이전트 도구 확장은 더 큰 system prompt가 아니라 검색 가능한 capability catalog와 권한 gate 문제로 이동하고 있다."
  - "Discovery는 자동 설치가 아니다. registry scope, managed settings, owner review, no silent connect 원칙이 핵심이다."
  - "보안 검증, OTel trace, PR evidence, Jira progress 같은 증거 표면이 capability discovery와 함께 표준 운영층이 된다."
operator_checklist:
  - "기본 로드 도구는 10개 이하로 줄이고, 나머지는 승인된 catalog에서 task별로 검색하게 한다."
  - "capability manifest에 owner, version, permission, data boundary, canary status, deprecation date를 넣는다."
  - "agent가 선택한 capability와 검증 결과를 PR·ticket·execution receipt에 남긴다."
---

2026년 6월 개발 도구 흐름에서 눈에 띄는 변화는 에이전트가 더 많은 도구를 "항상 들고 다니는" 방식에서 벗어나고 있다는 점입니다. GitHub는 6월 17일 Agent Finder를 공개하며 Copilot이 MCP 서버, 스킬, canvas, agent, tool 같은 AI resource를 작업 설명에 맞춰 catalog에서 찾아 ranked match로 제안하는 방식을 설명했습니다. 같은 달 Copilot SDK는 GA가 되었고, custom tool, MCP, hook, OpenTelemetry tracing, remote session을 안정 API로 제공한다고 발표했습니다. 여기에 third-party coding agent가 만든 코드에도 CodeQL, dependency advisory, secret scanning 같은 보안 검증을 적용하는 흐름이 붙었습니다.

이 흐름을 저는 **Agent Capability Discovery**라고 부르는 편이 좋다고 봅니다. 핵심은 "에이전트에게 더 많은 도구를 붙이자"가 아닙니다. 오히려 반대입니다. 기본 context에는 최소한만 싣고, 작업마다 필요한 능력을 승인된 registry에서 찾고, 사람이나 정책이 실제 연결을 결정하게 만드는 방향입니다.

이 글은 [Agent Skill Supply Chain Governance](/posts/2026-05-26-agent-skill-supply-chain-governance-trend/), [LLM-readable Docs Surface](/posts/2026-05-10-llm-readable-docs-surface-trend/), [Tool Contract Test](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/), [Agent Invocation API](/posts/2026-05-27-agent-invocation-api-task-queue-trend/), [MCP Stateless Tool Contract](/posts/2026-06-23-mcp-stateless-tool-contract-trend/)와 이어지는 주제입니다. 스킬과 MCP가 많아질수록 좋은 팀은 "다 열어두기"보다 "찾을 수 있지만 통제되는 catalog"를 먼저 만듭니다.

## 이 글에서 얻는 것

- Agent Capability Discovery가 단순 plugin 검색이 아니라 에이전트 운영 모델 변화라는 점을 이해할 수 있습니다.
- MCP 서버, 스킬, agent, tool을 registry와 manifest 기준으로 관리하는 실무 구조를 잡을 수 있습니다.
- 자동 설치와 discovery를 구분하고, 권한·보안·검증 gate를 어디에 둘지 판단할 수 있습니다.
- 팀 내부 capability catalog를 만들 때 필요한 metadata와 숫자 기준을 가져갈 수 있습니다.
- 에이전트가 선택한 도구의 evidence를 PR, ticket, trace, execution receipt에 남기는 기준을 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) 에이전트의 다음 병목은 "도구 부족"이 아니라 "도구 과적재"다

초기 에이전트 운영은 필요한 MCP 서버와 스킬을 전부 설정에 붙이는 방식으로 시작하기 쉽습니다. GitHub, Jira, Slack, Notion, AWS, database, internal admin API, build tool, test runner, 문서 검색까지 전부 넣으면 "무엇이든 할 수 있는 에이전트"처럼 보입니다. 하지만 실제로는 세 가지 문제가 생깁니다.

첫째, context가 복잡해집니다. 에이전트가 작업과 무관한 tool description까지 읽으면 추론 비용과 혼동 가능성이 올라갑니다. 둘째, 권한 경계가 흐려집니다. 문서 요약 작업에 배포 권한이 붙어 있을 이유는 없습니다. 셋째, 운영자가 어떤 capability가 어떤 결과에 영향을 줬는지 추적하기 어려워집니다.

Capability Discovery는 이 문제를 "더 큰 prompt"로 풀지 않습니다. 대신 작업 설명을 입력으로 받아, 승인된 catalog에서 관련성이 높은 capability 후보를 찾고, 실제 연결은 정책과 사용자가 통제합니다. 즉 에이전트가 모든 것을 들고 다니는 모델에서 **필요할 때 찾아 쓰는 모델**로 이동합니다.

### 2) Discovery는 자동 설치가 아니다

가장 중요한 구분은 discovery와 installation입니다. GitHub Agent Finder 발표에서도 registry 선택, managed settings, no auto installation을 강조합니다. 이 구분이 없으면 capability discovery는 곧 supply chain 위험이 됩니다.

실무 원칙은 아래처럼 잡는 편이 안전합니다.

| 단계 | 허용할 수 있는 자동화 | 사람/정책 gate |
| --- | --- | --- |
| 검색 | 작업 설명 기반 후보 ranking | 검색 대상 registry allowlist |
| 제안 | capability 요약, owner, permission 표시 | 고위험 capability 강조 |
| 연결 | low-risk read-only tool은 제한적 허용 | write, deploy, billing, secret 접근은 승인 |
| 실행 | tool contract와 scope 내 호출 | mutation, external send, deletion은 human gate |
| 기록 | capability id/version/log 자동 기록 | evidence 누락 시 PR/ticket block |

즉 "찾을 수 있다"와 "바로 연결된다"는 별개입니다. 특히 내부 운영 도구, 클라우드 제어, 결제, 사용자 데이터 조회 도구는 discovery 결과에 보여도 자동 wire-in을 금지하는 편이 맞습니다.

### 3) capability catalog는 README 목록이 아니라 운영 metadata다

catalog가 단순 링크 모음이면 에이전트와 사람 모두 판단하기 어렵습니다. 필요한 것은 capability manifest입니다.

```yaml
capability_id: internal/jira-release-triage
type: mcp_server
owner: platform-devex
version: 2026.06.27
source: git@github.com:company/devex-tools.git
allowed_tasks:
  - release_note_summary
  - bug_triage
permissions:
  read:
    - jira.issue
    - github.pr
  write:
    - jira.comment
data_boundary:
  pii: masked
  customer_data: forbidden
runtime:
  default_timeout_seconds: 30
  max_calls_per_session: 20
validation:
  contract_test: passed
  secret_scan: passed
  canary_task: passed
review:
  last_reviewed_at: 2026-06-20
  deprecation_date: 2026-12-31
```

이 정도 정보가 있어야 에이전트가 후보를 고를 때도, 운영자가 승인할 때도, 나중에 사고를 분석할 때도 근거가 남습니다. `description`이 아무리 좋아도 owner, 권한, 데이터 경계, 검증 상태가 없으면 production capability로 보기 어렵습니다.

### 4) Copilot SDK GA는 discovery를 제품 안으로 넣는 길을 연다

Copilot SDK가 GA되면서 agent runtime을 사내 앱, 개발자 포털, CI/CD assistant, 고객-facing 개발 도구 안에 넣는 일이 쉬워졌습니다. SDK는 custom tools, MCP, hooks, tracing, remote session 같은 실행 표면을 제공합니다. 이 말은 곧 capability discovery가 IDE 기능에만 머물지 않는다는 뜻입니다.

예를 들어 내부 developer portal에서 "결제 서비스 장애 회고 초안 작성" 버튼을 누르면, agent는 기본 도구만 들고 시작합니다. 이후 catalog에서 `incident-log-reader`, `pager-duty-summary`, `github-pr-timeline`, `service-dashboard-query`를 찾아 제안하고, 권한과 데이터 경계를 확인한 뒤 필요한 것만 연결합니다. 실행 결과는 trace와 ticket에 남습니다.

이 구조에서는 capability discovery가 단순 검색 UI가 아니라 **agent runtime의 admission control** 역할을 합니다. 어떤 능력을 언제, 누구 권한으로, 어떤 작업에 연결했는지가 운영 기록이 됩니다.

### 5) 보안 검증은 discovery 이후의 필수 후속 단계다

에이전트가 올바른 capability를 찾았다고 해서 결과가 안전한 것은 아닙니다. GitHub는 6월 9일 third-party coding agent가 만든 코드에도 자동 보안 검증을 적용한다고 발표했습니다. CodeQL, dependency advisory, secret scanning 같은 검사를 agent-generated code에도 적용하는 방향입니다.

이 흐름이 중요한 이유는 명확합니다. capability discovery가 잘 되면 에이전트는 더 다양한 작업을 할 수 있습니다. 다양한 작업은 더 넓은 변경면을 뜻합니다. 따라서 discovery 다음에는 반드시 validation이 있어야 합니다.

권장 조합은 아래입니다.

- capability 선택: registry allowlist + managed settings
- tool 실행: permission scope + timeout + call budget
- 산출물 생성: PR/ticket/execution receipt에 capability id/version 기록
- 보안 검증: secret scan, dependency advisory, CodeQL 또는 정적 분석
- 계약 검증: tool contract test, response schema validation, replay canary
- 사람 승인: high-risk path, external send, 권한 변경, billing mutation

이 중 하나라도 빠지면 "에이전트가 알아서 잘 골랐다"는 말이 운영 신뢰로 이어지지 않습니다.

## 실무 적용

### 1) 내부 capability registry를 작게 시작한다

처음부터 거대한 marketplace를 만들 필요는 없습니다. YAML 파일, Git repo, Notion database, Backstage catalog 중 하나로 시작해도 충분합니다. 중요한 것은 검색 가능한 이름보다 **운영 가능한 metadata**입니다.

최소 필드:

- `capability_id`: stable id, owner namespace 포함
- `type`: MCP server, skill, tool, agent, canvas, docs pack
- `owner`: 팀 또는 개인이 아니라 운영 책임 팀
- `source`: repo, package, vendor URL, version
- `allowed_tasks`: 자연어가 아니라 분류 가능한 작업 유형
- `permissions`: read/write/admin, external send, secret access 여부
- `data_boundary`: 고객 데이터, PII, source code, secret 처리 기준
- `validation`: contract test, canary, security scan 상태
- `observability`: trace field, log retention, execution receipt 위치
- `review_cycle`: 30일, 90일, 180일 중 하나

처음 30일은 10~20개 capability만 등록하는 편이 좋습니다. 많이 넣는 것보다, 실제로 agent가 고른 capability가 맞았는지 관찰하는 것이 먼저입니다.

### 2) 기본 로드와 discovery pool을 분리한다

모든 도구를 기본 로드하면 context가 무거워지고 권한이 과해집니다. 추천 출발점은 아래입니다.

- 기본 로드 capability: 5~10개 이하
- discovery 후보 pool: 팀별 20~50개부터 시작
- high-risk capability: 검색 가능하더라도 자동 연결 금지
- write capability: session당 call budget과 승인 gate 필수
- external send capability: dry-run과 preview 없이는 실행 금지

숫자는 조직마다 다르지만 원칙은 같습니다. 자주 쓰고 위험이 낮은 것은 기본 로드, 가끔 쓰거나 위험한 것은 discovery, 위험도가 높은 것은 approval-gated discovery로 둡니다.

### 3) ranking 기준은 인기보다 작업 적합성으로 둔다

capability catalog가 커지면 ranking이 중요해집니다. 다운로드 수, 최근 사용량, vendor 인지도만으로 ranking하면 내부 맥락에 맞지 않을 수 있습니다. 실무 ranking은 아래 점수를 합산하는 편이 낫습니다.

- task match score: 작업 유형과 allowed_tasks 일치
- permission fit score: 필요한 권한보다 과한 권한이 적을수록 높음
- freshness score: 최근 review와 canary 성공 여부
- owner reliability score: 운영 책임 팀, 대응 SLO, incident 이력
- evidence score: contract test, schema validation, security scan 존재
- cost score: 평균 call 수, latency, 외부 API 비용

예를 들어 "릴리즈 노트 초안 작성" 작업에는 production deploy 권한이 있는 만능 MCP 서버보다 read-only GitHub/issue summarizer가 더 높은 점수를 받아야 합니다. 좋은 ranking은 강력한 도구를 고르는 것이 아니라 **필요 이상의 권한을 피하는 것**입니다.

### 4) PR과 ticket에 capability evidence를 남긴다

에이전트가 어떤 capability를 골랐는지 기록하지 않으면, reviewer는 결과를 신뢰하기 어렵습니다. PR이나 Jira ticket에 아래 정도는 자동으로 남기는 편이 좋습니다.

```yaml
agent_capability_evidence:
  task: "AUTH-421 token refresh bug fix"
  selected_capabilities:
    - id: internal/github-code-search
      version: 2026.06.20
      mode: read
    - id: internal/auth-runbook-skill
      version: 2026.06.10
      mode: guidance
  rejected_capabilities:
    - id: internal/prod-admin-mcp
      reason: "write/admin permission not needed"
  validations:
    secret_scan: passed
    dependency_check: passed
    tests_run:
      - "./gradlew test --tests TokenRefreshTest"
```

이 evidence는 길 필요가 없습니다. 중요한 것은 나중에 "왜 이 도구를 썼는가", "왜 더 강한 도구를 쓰지 않았는가", "검증은 무엇을 통과했는가"를 볼 수 있는 것입니다.

### 5) rollout은 기능보다 운영 지표로 판단한다

Agent Capability Discovery를 도입할 때는 "검색이 잘 된다"만 보면 안 됩니다. 운영 지표가 좋아져야 합니다.

권장 지표:

| 지표 | 초기 기준 |
| --- | --- |
| irrelevant capability selection rate | 10% 이하 |
| over-privileged capability suggestion rate | 5% 이하 |
| no-evidence execution rate | 0건 목표 |
| high-risk auto-connect count | 0건 |
| capability stale review rate | 5% 이하 |
| average default loaded capability count | 10개 이하 |
| rejected suggestion reason coverage | 80% 이상 |
| post-run security finding rate | baseline 대비 증가 없음 |

특히 `over-privileged capability suggestion rate`를 강하게 봐야 합니다. 문서 요약 작업에 prod write tool이 계속 추천된다면 ranking이나 metadata가 잘못된 것입니다. discovery 품질은 편의성이 아니라 권한 최소화로 평가해야 합니다.

## 트레이드오프/주의점

첫째, discovery가 너무 느리면 개발자가 다시 모든 도구를 기본 로드하려고 합니다. 검색과 ranking은 빠르게 동작해야 합니다. 내부 registry 기준으로는 p95 1초 이하, 외부 catalog 포함 시 p95 3초 이하를 목표로 잡는 편이 좋습니다.

둘째, registry 운영은 새 유지보수 비용을 만듭니다. owner, version, deprecation, canary 상태가 오래되면 catalog는 신뢰를 잃습니다. 그래서 90일 이상 review가 없는 capability는 warning, 180일 이상이면 기본 추천에서 제외하는 정책이 필요합니다.

셋째, vendor catalog와 private registry를 섞을 때는 source trust를 분리해야 합니다. 공식 vendor capability도 과권한이면 위험하고, 내부 capability도 owner가 없으면 위험합니다. "공식"은 신뢰 신호 하나일 뿐, permission과 data boundary를 대체하지 않습니다.

넷째, ranking이 자동화될수록 설명 가능성이 중요해집니다. agent가 왜 특정 MCP 서버를 골랐는지 사람이 이해하지 못하면, 문제가 생겼을 때 "AI가 골랐다"로 끝납니다. ranking reason은 최소 1~2줄로 남겨야 합니다.

다섯째, capability discovery는 보안 도구가 아니라 운영 패턴입니다. discovery만 도입하고 secret scan, contract test, execution receipt, PR evidence가 없으면 위험이 줄지 않습니다. 오히려 더 많은 도구를 더 쉽게 연결하게 되어 blast radius가 커질 수 있습니다.

의사결정 우선순위는 **권한 최소화 > 작업 적합성 > 검증 증거 > freshness > 사용 편의성 > 도구 수**입니다. 도구 수는 마지막입니다. capability가 많다는 사실은 성숙도가 아니라 관리 부담일 수 있습니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 기본 로드되는 MCP 서버, 스킬, 도구가 10개 이하인지 확인했다.
- [ ] capability catalog에 owner, version, permission, data boundary, validation 상태가 있다.
- [ ] discovery 대상 registry가 public catalog와 private registry로 분리되어 있다.
- [ ] high-risk capability는 검색 가능해도 자동 연결되지 않는다.
- [ ] write/external send/delete/billing capability는 preview 또는 approval gate를 거친다.
- [ ] 에이전트가 선택한 capability id/version이 PR 또는 ticket에 남는다.
- [ ] secret scan, dependency check, contract test가 agent-generated output에도 적용된다.
- [ ] 90일 이상 review가 없는 capability는 warning 또는 ranking penalty를 받는다.
- [ ] rejected suggestion reason을 수집해 ranking과 metadata를 개선한다.

### 연습

1. 현재 팀이 쓰는 MCP 서버와 agent skill을 모두 적고, `기본 로드`, `discovery 후보`, `승인 필요`, `폐기 후보` 네 그룹으로 나눠 보세요. 30분 안에 분류가 안 되면 metadata가 부족한 것입니다.
2. 가장 위험한 capability 3개를 골라 permission, data boundary, owner, canary task, rollback 방법을 manifest로 작성해 보세요.
3. 최근 agent PR 5개를 보고 "이 작업에 실제로 필요했던 capability"와 "있었지만 필요 없던 capability"를 분리해 보세요. 필요 없는 write tool이 있었다면 기본 로드에서 빼는 것이 맞습니다.
4. 내부 catalog ranking 규칙을 100점 만점으로 설계해 보세요. permission fit 30점, validation 25점, task match 25점, freshness 10점, owner reliability 10점처럼 시작하면 충분합니다.

Agent Capability Discovery의 목표는 에이전트를 더 화려하게 만드는 것이 아닙니다. 필요한 능력을 더 정확히 찾고, 불필요한 권한을 덜 싣고, 결과에 더 많은 증거를 남기는 것입니다. 2026년의 개발 조직에서 중요한 질문은 "에이전트가 어떤 도구를 쓸 수 있나"가 아니라, **그 도구를 왜 선택했고 어떤 경계 안에서 썼는가**가 될 가능성이 큽니다.

## 출처 링크

- GitHub Changelog: Agent finder for GitHub Copilot now available - https://github.blog/changelog/2026-06-17-agent-finder-for-github-copilot-now-available/
- GitHub Changelog: Copilot SDK is now generally available - https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/
- GitHub Changelog: Security validation for third-party coding agents - https://github.blog/changelog/2026-06-09-security-validation-for-third-party-coding-agents/
- GitHub Changelog: GitHub Copilot for Jira is now generally available - https://github.blog/changelog/2026-06-25-github-copilot-for-jira-is-now-generally-available/
- GitHub Changelog: Shape Copilot code review around your team - https://github.blog/changelog/2026-06-02-shape-copilot-code-review-around-your-team/
