---
title: "2026 개발 트렌드: CI-native Agent Runner, 코딩 에이전트가 GitHub Actions 권한으로 실행된다"
date: 2026-07-04T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "GitHub Actions", "GitHub Copilot", "Copilot CLI", "CI/CD", "Agent Governance"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["Copilot CLI GitHub Actions GITHUB_TOKEN", "CI-native agent runner", "agentic workflow PAT-less", "AI credit budget", "auto model selection"]
description: "Copilot CLI의 GitHub Actions GITHUB_TOKEN 지원, agentic workflow의 PAT 제거, auto model selection, usage metrics 개선을 묶어 코딩 에이전트가 CI 런타임으로 들어오는 흐름을 정리합니다."
lastmod: 2026-07-05
summary: "코딩 에이전트는 IDE 밖으로 나와 GitHub Actions의 내장 토큰, 조직 과금, 세션 한도, 사용량 지표를 가진 CI-native runner로 이동하고 있다."
key_takeaways:
  - "GITHUB_TOKEN 기반 Copilot CLI 실행은 장기 PAT를 줄이지만, workflow permission과 조직 과금 기준을 새로 요구한다."
  - "CI 안의 에이전트는 개발자 개인 도구가 아니라 runner, credit, evidence, approval을 소비하는 자동화 주체다."
  - "auto model selection과 모델 deprecation 흐름은 model pinning보다 task class, budget, fallback 정책을 먼저 정하게 만든다."
operator_checklist:
  - "Copilot CLI 또는 agentic workflow 실행에는 copilot-requests: write, session credit cap, timeout, evidence artifact를 기본값으로 둔다."
  - "조직 과금 경로에서는 user-level budget이 적용되지 않는지 확인하고 cost center와 workflow별 cap으로 보완한다."
  - "model auto, open-weight model, deprecation 대응을 release note가 아니라 운영 정책 matrix로 관리한다."
learning_refs:
  - title: "Agent Session Ledger"
    href: "/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/"
    description: "에이전트 세션 로그, tool call, credit 사용량을 운영 장부로 남기는 흐름입니다."
  - title: "AI Coding Spend Preflight"
    href: "/posts/2026-06-28-ai-coding-spend-preflight-trend/"
    description: "에이전트 작업 시작 전에 비용과 범위를 견적하는 기준입니다."
  - title: "Agentic Capacity SLO"
    href: "/posts/2026-06-29-agentic-capacity-slo-trend/"
    description: "에이전트 실행량을 queue, runtime, credit, reviewer 예산으로 관리하는 관점입니다."
  - title: "Tool Permission Manifest"
    href: "/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/"
    description: "에이전트 도구 권한과 런타임 실행 증적을 계약으로 관리하는 방식입니다."
  - title: "CI/CD 보안과 공급망"
    href: "/learning/deep-dive/deep-dive-cicd-security-supply-chain/"
    description: "GitHub Actions, 토큰, 아티팩트, 릴리스 경로를 공급망 관점에서 점검하는 기초입니다."
decision_guide:
  title: "CI-native Agent Runner 도입 판단"
  cases:
    - badge: "시작"
      title: "읽기 전용 장애 분석부터 붙인다"
      fit: "테스트 실패 로그가 반복되고, 사람은 원인 분류에 시간을 쓰지만 자동 수정 권한을 주기에는 아직 이르다."
      watchouts: "로그 접근 권한과 artifact 보존 기간을 먼저 정하지 않으면 분석 결과가 재현되지 않는다."
      next_step: "contents read, actions read, copilot-requests write만 허용하고 evidence artifact 생성률을 2주 동안 본다."
    - badge: "확대"
      title: "저위험 문서·테스트 수정만 허용한다"
      fit: "read-only triage의 정확도가 안정적이고 변경 파일 수, credit, 테스트 증거를 자동으로 남길 수 있다."
      watchouts: "작은 수정도 반복 실행되면 조직 credit을 빠르게 소비하므로 PR당 run 상한이 필요하다."
      next_step: "high-risk path denylist와 PR당 credit cap을 둔 별도 workflow_dispatch 수정 플로우로 분리한다."
    - badge: "보류"
      title: "보안·결제·배포 경로는 plan-only로 둔다"
      fit: "권한 변경, 결제, 배포, migration처럼 실패 비용이 크고 리뷰 책임자가 명확해야 하는 작업이다."
      watchouts: "GITHUB_TOKEN 기반 실행이라고 해도 권한·비용·감사 책임이 사라지지 않는다."
      next_step: "자동 수정 대신 diff 없는 계획, 영향 범위, 롤백 절차, 테스트 명령만 생성하게 한다."
---

2026년 7월 초 GitHub Changelog의 흐름을 보면 코딩 에이전트가 IDE 채팅 기능을 넘어 **CI 안에서 실행되는 자동화 주체**로 빠르게 들어오고 있습니다. 7월 2일 GitHub는 Copilot CLI를 GitHub Actions에서 실행할 때 더 이상 별도의 personal access token(PAT)을 만들지 않아도 되고, 내장 `GITHUB_TOKEN`으로 인증할 수 있다고 공지했습니다. 6월 11일에는 GitHub Agentic Workflows도 Actions의 내장 토큰을 사용할 수 있게 됐다는 흐름이 먼저 나왔습니다.

이 변화는 작은 인증 개선처럼 보이지만, 실제 의미는 더 큽니다. 코딩 에이전트가 로컬 IDE에서 "도와주는 기능"일 때는 개인 계정, 개인 설정, 개인 비용의 문제로 보이기 쉽습니다. 그런데 GitHub Actions 안에서 `GITHUB_TOKEN`으로 실행되면 에이전트는 CI/CD 파이프라인의 일부가 됩니다. 권한은 workflow permission으로 표현되고, 비용은 조직 또는 cost center로 흘러가며, 실행 결과는 PR·artifact·usage metrics·session stream으로 검증되어야 합니다.

저는 이 흐름을 **CI-native Agent Runner**라고 부르는 편이 좋다고 봅니다. 에이전트가 브라우저나 IDE 안에서만 일하는 것이 아니라, 실패한 workflow를 고치고, migration check를 돌리고, 보안 리뷰를 보조하고, 릴리스 노트를 만들며, 조직 과금과 runner 예산 안에서 멈추는 구조입니다. 이 글은 [Agent Session Ledger](/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/), [AI Coding Spend Preflight](/posts/2026-06-28-ai-coding-spend-preflight-trend/), [Agentic Capacity SLO](/posts/2026-06-29-agentic-capacity-slo-trend/), [IDE-native Agent Picker](/posts/2026-07-02-ide-native-agent-picker-governance-trend/)와 이어집니다.

## 이 글에서 얻는 것

- Copilot CLI의 `GITHUB_TOKEN` 지원이 왜 단순 인증 편의가 아니라 agent runtime 변화인지 이해할 수 있습니다.
- CI 안에서 코딩 에이전트를 실행할 때 필요한 workflow permission, credit cap, evidence 기준을 잡을 수 있습니다.
- auto model selection, open-weight model, 모델 deprecation이 CI 자동화 운영에 어떤 영향을 주는지 정리할 수 있습니다.
- 팀에서 바로 적용할 수 있는 agent workflow guardrail과 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) PAT 제거는 보안 개선이지만, 권한 설계가 사라지는 것은 아니다

장기 PAT는 자동화에서 늘 부담입니다. 만료, 회전, 소유자 퇴사, scope 과다 부여, secret 유출 리스크가 따라옵니다. GitHub가 Copilot CLI를 Actions의 내장 `GITHUB_TOKEN`으로 실행할 수 있게 한 것은 이 부담을 줄이는 방향입니다. 공지에 따르면 organization-owned repository에서 Actions token으로 Copilot CLI를 실행하면 AI credits는 조직에 직접 청구됩니다. workflow는 `copilot-requests: write` permission을 요구합니다.

중요한 점은 "secret이 하나 줄었다"에서 멈추면 안 된다는 것입니다. PAT가 없어져도 에이전트가 CI 안에서 요청을 만들고, 파일을 고치고, 테스트를 돌리고, 외부 모델을 호출한다는 사실은 그대로입니다. 권한은 이제 secret scope가 아니라 workflow permission, branch protection, environment protection, runner isolation, repository policy로 표현됩니다.

기본 정책은 아래처럼 잡을 수 있습니다.

| 작업 유형 | 실행 위치 | 권한 | 승인 |
| --- | --- | --- | --- |
| 문서/릴리스 노트 초안 | pull_request workflow | read + artifact write | PR 리뷰 |
| 실패 테스트 원인 분석 | workflow_run | read + logs | 자동 허용 |
| 작은 fix PR 생성 | workflow_dispatch | contents write 제한 | owner 승인 |
| 보안/권한/결제 경로 수정 | 별도 protected workflow | plan-only 기본 | 사람 승인 2단계 |
| 배포/infra 변경 | production environment | agent 자동 실행 금지 | 수동 승인 |

이 기준은 [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)의 연장입니다. CI 권한이 넓으면 에이전트도 넓어집니다.

### 2) 조직 과금은 agent workflow를 "공유 자원"으로 만든다

GitHub의 PAT-less Actions 공지는 조직 repo에서 Copilot CLI가 소비한 AI credits가 조직에 직접 청구된다고 설명합니다. 또 이 경로에서는 비용이 특정 사용자에게 귀속되지 않기 때문에 user-level budgets가 고려되지 않는다고 안내합니다. 대신 cost centers, billing/usage dashboards, session limit 같은 관리 방법을 제시합니다.

이 지점이 운영적으로 중요합니다. 개인 IDE에서 agent를 많이 쓰면 개인 사용량 문제로 보입니다. 하지만 CI 안의 agent는 팀 전체가 공유하는 예산을 씁니다. 실패한 workflow가 여러 번 재실행되고, agent가 매번 큰 모델을 고르고, 같은 PR에서 세션이 반복되면 비용은 조용히 누적됩니다. 게다가 사용자 예산이 적용되지 않는 경로라면 "개인 한도 걸어뒀으니 괜찮다"가 통하지 않습니다.

권장 기준:

- workflow별 `max_ai_credits` 또는 session limit을 둔다.
- PR당 agent run 최대 횟수를 정한다. 예: 자동 1회, 재시도는 사람 승인.
- cost center는 조직 단위가 아니라 product/team 단위로 본다.
- completed PR당 credit, 실패 run당 credit, no-diff run 비율을 주간으로 본다.
- 한 workflow가 팀 주간 credit의 5%를 넘으면 사전 승인 대상으로 둔다.

비용 통제는 개발자 억제가 아니라 runaway automation을 막는 stop condition입니다.

### 3) CI 안의 에이전트는 evidence artifact를 남겨야 한다

사람이 로컬에서 명령을 돌리면 PR 본문에 "테스트 돌림" 정도를 적고 넘어가는 경우가 많습니다. 하지만 CI-native agent는 그렇게 운영하면 곤란합니다. 자동화가 실행된 위치, 사용한 모델, tool call, 변경 파일, 테스트 결과, 중단 사유가 남아야 합니다.

최소 evidence artifact:

```yaml
agent_run:
  workflow: "agent-fix-failing-test.yml"
  trigger: "workflow_dispatch"
  actor: "github-actions[bot]"
  task_id: "ci-failure-18291"
  permissions:
    contents: "write"
    copilot-requests: "write"
  credit_limit: 200
  credit_used: 143
  model_policy: "auto"
  files_changed: 3
  test_evidence:
    - "gradle test"
    - "integration smoke"
  stop_reason: "completed_with_pr"
```

이 정보는 [Agent Session Ledger](/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/)의 CI 버전입니다. 원문 prompt와 전체 응답을 영구 보관할 필요는 없지만, 운영 판단에 필요한 요약 증거는 남겨야 합니다.

### 4) auto model selection은 편하지만, CI에서는 정책이어야 한다

7월 1일 GitHub는 Copilot CLI의 auto model selection이 task에 따라 모델을 라우팅하고, model health와 utilization 신호를 고려한다고 설명했습니다. 같은 날 enterprise managed settings에서 `model`을 `auto`로 기본 설정할 수 있다는 공지도 나왔습니다. 이는 CLI 자동화에서 모델 선택이 점점 런타임 라우팅 문제로 이동한다는 뜻입니다.

좋은 점은 분명합니다. 모든 작업에 큰 모델을 고를 필요가 없고, 모델 상태와 작업 난이도에 따라 더 효율적인 선택을 할 수 있습니다. 하지만 CI에서는 재현성과 비용 예측도 중요합니다. 같은 workflow가 오늘은 작은 모델로 통과하고 내일은 다른 모델로 다르게 행동하면, 원인 분석이 어려워질 수 있습니다.

그래서 CI 정책은 아래처럼 나누는 편이 안전합니다.

- low-risk docs/checklist: `model: auto`, 낮은 credit cap
- test failure triage: `model: auto`, read-only 기본
- code modification: `model: auto` 허용, diff/evidence 필수
- security/payment/infra: model auto만으로 자동 수정 금지, plan-first
- reproducibility required job: 모델과 버전 고정 또는 결과 검증 강화

모델 자동 선택은 좋은 기본값이 될 수 있지만, 고위험 작업의 승인과 검증을 대신하지 않습니다.

### 5) open-weight 모델과 모델 deprecation은 policy matrix를 요구한다

7월 1일 GitHub는 Kimi K2.7 Code를 Copilot model picker의 첫 open-weight selectable option으로 제공한다고 공지했습니다. Copilot Business/Enterprise에서는 기본 off이고, 관리자가 보안·컴플라이언스·데이터 거버넌스 요구사항을 검토한 뒤 정책으로 켜야 한다고 설명합니다. 7월 2일에는 Gemini 2.5 Pro와 Gemini 3 Flash가 2026년 7월 31일 Copilot 전반에서 deprecate될 예정이라는 공지도 나왔습니다.

이 두 흐름은 같이 봐야 합니다. 모델 선택지는 늘고, 일부 모델은 빠르게 빠집니다. 그러면 workflow에 특정 모델 이름을 박아두는 방식은 운영 부채가 됩니다. 반대로 아무 모델이나 auto로 두면 품질과 비용 기준이 흐려질 수 있습니다.

필요한 것은 모델 취향표가 아니라 policy matrix입니다.

```yaml
agent_model_policy:
  docs:
    default: auto
    allow_open_weight: true
    max_credit: 80
  bugfix:
    default: auto
    allow_open_weight: pilot_only
    max_credit: 250
  security:
    default: approved_high_reasoning
    allow_open_weight: false_until_reviewed
    requires_owner_approval: true
  deprecated_model_handling:
    check_interval: weekly
    fallback_required: true
    workflow_fail_before_deprecation: 14d
```

이렇게 해두면 모델 출시와 종료가 나와도 workflow가 조용히 깨지지 않습니다.

## 실무 적용

### 1) agent workflow 기본 골격

CI 안에서 에이전트를 돌릴 때는 권한을 작게 시작합니다.

```yaml
name: agent-triage-failing-test

on:
  workflow_dispatch:

permissions:
  contents: read
  actions: read
  checks: read
  pull-requests: write
  copilot-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - name: Run Copilot CLI triage
        run: |
          copilot --max-ai-credits 150 \
            "Summarize the failing tests, propose a minimal fix plan, and write an evidence report. Do not modify files."
      - name: Upload evidence
        uses: actions/upload-artifact@v4
        with:
          name: agent-evidence
          path: agent-report.md
```

처음부터 `contents: write`를 주지 않습니다. 먼저 read-only triage와 evidence 생성부터 시작하고, 성공률과 false positive를 본 뒤 제한된 수정 workflow를 따로 만듭니다.

### 2) 수정 workflow는 별도로 둔다

파일을 고치는 agent workflow는 더 강한 기준이 필요합니다.

- `pull_request`에서 자동 write 금지, `workflow_dispatch` 또는 label 승인 후 실행
- 변경 파일 수 상한: 예를 들어 5개 이하
- 테스트 명령 상한: 예를 들어 3회 이하
- session credit cap: 작은 bugfix 150~300
- PR 본문에 agent run id, credit used, test evidence 자동 첨부
- high-risk path는 denylist 또는 owner approval 필요

high-risk path 예시:

```yaml
high_risk_paths:
  - "infra/prod/**"
  - "migrations/**"
  - "src/main/**/security/**"
  - "src/main/**/payment/**"
  - ".github/workflows/deploy*.yml"
```

이 기준은 [Tool Permission Manifest](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)의 CI 버전입니다. 에이전트에게 어떤 도구와 파일을 허용했는지 실행 전부터 명시해야 합니다.

### 3) 운영 대시보드는 사용량보다 실패 비용을 먼저 본다

GitHub는 7월 2일 Copilot usage metrics API의 보고 정확도와 커버리지를 개선했다고 공지했습니다. Copilot CLI의 suggested lines, server-side telemetry 사용자 식별, AI credit attribution 개선이 핵심입니다. 이런 지표는 adoption 홍보용으로만 쓰면 아깝습니다. CI-native agent에서는 실패 비용을 봐야 합니다.

초기 대시보드 질문:

- agent run 수가 PR 수 대비 얼마나 늘고 있는가
- no-diff completed run 비율은 얼마인가
- 실패 workflow당 평균 credit은 얼마인가
- 한 PR에서 같은 agent workflow가 3회 이상 반복되는가
- agent가 만든 PR의 72시간 내 rollback/hotfix 비율은 얼마인가
- high-risk path를 만진 run 중 evidence 없는 건이 있는가

도입 성공 기준은 "에이전트가 많이 돌았다"가 아니라 "실패한 CI를 더 빨리, 더 적은 재작업으로 해결했다"입니다.

### 4) 2주 파일럿 기준

2주 파일럿은 작게 잡습니다.

| 단계 | 범위 | 성공 기준 |
| --- | --- | --- |
| 1주차 | read-only CI failure triage | evidence 생성률 90% 이상, hallucinated command 0건 |
| 2주차 | low-risk test/doc fix PR | PR당 변경 파일 5개 이하, 테스트 증거 100% |
| 보류 | security/payment/infra | plan-only로만 운영 |

중단 기준도 필요합니다.

- credit cap 초과 종료가 하루 5건 이상
- 같은 PR에서 agent run 3회 이상 반복
- high-risk path touch + approval 없음
- evidence artifact 누락
- 사람이 읽기 어려운 대량 diff 생성

이 중 하나라도 반복되면 자동 수정을 멈추고 triage 전용으로 낮춥니다.

### 5) 도입 판단 매트릭스

CI-native agent runner는 "쓸 수 있느냐"보다 "어디까지 자동화해도 운영 책임이 흐려지지 않느냐"로 판단해야 합니다. 같은 Copilot CLI 실행이라도 로그 요약, 테스트 실패 분류, 문서 수정, 보안 패치, 배포 변경은 위험도가 완전히 다릅니다. 그래서 팀 단위로 처음 정해야 할 것은 모델 이름이 아니라 **작업 등급표**입니다.

| 등급 | 예시 | 기본 권한 | 자동 수정 | 필수 증거 |
| --- | --- | --- | --- | --- |
| L0 | 실패 로그 요약, 릴리스 노트 초안 | read-only | 금지 | 입력 로그, 요약, 중단 사유 |
| L1 | 문서 링크 수정, 테스트명 오타 수정 | 제한 write | 허용 가능 | 변경 파일, diff 요약, lint 결과 |
| L2 | 단위 테스트 실패의 작은 코드 수정 | 제한 write + PR 생성 | 조건부 | 재현 명령, 수정 근거, 테스트 결과 |
| L3 | dependency bump, workflow 수정 | owner 승인 후 실행 | 제한 | SBOM/lockfile diff, rollback path |
| L4 | 보안, 결제, 배포, migration | protected workflow | 기본 금지 | plan, risk, approval, dry-run |

처음부터 L2 이상을 목표로 잡으면 실패 원인 분석이 어렵습니다. 좋은 출발점은 L0와 L1입니다. 실패한 workflow를 읽고, 사람이 봐야 할 핵심 로그를 줄이고, 이미 정해진 문서·테스트 경로만 고치게 합니다. 이때도 "성공했다"의 기준은 에이전트가 답을 냈다는 것이 아니라, 리뷰어가 3분 안에 실행 조건과 결과를 검증할 수 있다는 것입니다.

L2로 올릴 때는 변경 폭을 숫자로 막아야 합니다. 예를 들어 변경 파일 5개 이하, 생성 라인 200줄 이하, 테스트 명령 3개 이하, credit cap 300 이하처럼 둡니다. 제한이 임의로 보일 수 있지만, CI 안의 에이전트는 빠를수록 실패도 빠르게 반복합니다. 숫자 상한은 품질을 낮추는 장치가 아니라 runaway run을 멈추는 브레이크입니다.

L3부터는 보안팀이나 플랫폼팀의 기준과 만나야 합니다. dependency bump는 단순 버전 변경처럼 보여도 lockfile, transitive dependency, cache, registry provenance가 얽힙니다. workflow 수정은 더 조심해야 합니다. 에이전트가 자기 자신이 실행될 권한을 넓히는 변경을 만들 수 있기 때문입니다. 이 영역은 [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)의 체크리스트와 같이 봐야 합니다.

L4는 자동 수정을 목표로 두지 않는 편이 낫습니다. 에이전트가 할 일은 계획, 영향 범위, 확인 명령, 롤백 절차를 구조화하는 것입니다. 사람은 그 계획을 보고 실행 여부를 결정합니다. "AI가 고칠 수 있다"와 "AI가 바로 반영해도 된다"는 전혀 다른 말입니다.

### 6) 실패했을 때의 롤백 절차

CI-native agent runner는 도입보다 중단 절차가 먼저 있어야 합니다. 중단 절차가 없으면 작은 실험이 조직 기본값이 되고, 조직 기본값은 곧 비용과 권한의 기준이 됩니다. 최소 롤백은 아래 순서로 잡습니다.

1. agent 수정 workflow를 disable하고 read-only triage workflow만 남깁니다.
2. 최근 24시간 agent run의 PR, artifact, credit used, touched path를 모읍니다.
3. high-risk path touch 여부를 먼저 확인하고, 있으면 owner review를 강제합니다.
4. agent가 만든 PR 중 merge 전 상태는 label을 붙여 수동 리뷰 대기열로 보냅니다.
5. 이미 merge된 변경은 일반 revert보다 테스트 증거와 runtime 영향부터 확인합니다.
6. credit cap, permission, model policy, prompt를 낮춘 뒤 canary repo에서 재개합니다.

롤백의 핵심은 "전부 되돌리기"가 아닙니다. 어떤 run이 어떤 권한으로 무엇을 바꿨는지 빠르게 좁히는 것입니다. 그래서 앞에서 말한 evidence artifact와 session ledger가 필요합니다. 실행 장부가 없으면 롤백은 git diff 뒤지기가 되고, 실행 장부가 있으면 workflow run 단위로 의심 범위를 줄일 수 있습니다.

운영팀 관점에서는 아래 세 가지가 반복되면 기능을 끄는 편이 맞습니다.

- evidence artifact 없이 완료된 run이 생긴다.
- 같은 PR에서 agent run이 3회 이상 반복된다.
- 사람이 만든 수정과 agent 수정이 같은 파일에서 충돌한다.

이 조건은 엄격해 보이지만, 초기에는 보수적으로 가야 합니다. 자동화는 한 번 신뢰를 잃으면 다시 켜기 어렵습니다. 작게 성공하고, 증거를 남기고, 실패하면 즉시 읽기 전용으로 낮추는 흐름이 장기적으로 더 빠릅니다.

## 트레이드오프/주의점

첫째, `GITHUB_TOKEN`은 PAT보다 운영하기 쉽지만 만능 안전장치는 아닙니다. workflow permission이 넓으면 에이전트도 넓은 권한을 갖습니다. 특히 `contents: write`, `pull-requests: write`, `actions: write` 조합은 신중해야 합니다.

둘째, 조직 과금은 책임 소재를 흐릴 수 있습니다. 사용자별 budget이 적용되지 않는 경로에서는 workflow owner와 cost center를 반드시 붙여야 합니다.

셋째, auto model selection은 비용과 품질을 동시에 개선할 수 있지만, 재현성을 낮출 수 있습니다. 특히 규제·보안·배포 경로에서는 model policy와 evidence가 함께 있어야 합니다.

넷째, open-weight 모델은 낮은 비용과 선택권을 줄 수 있지만, 조직의 데이터·컴플라이언스 요구사항을 자동으로 만족하지 않습니다. Business/Enterprise에서 기본 off인 이유를 운영 정책으로 받아들여야 합니다.

다섯째, agent workflow가 성공해도 리뷰 책임이 사라지지 않습니다. 에이전트는 실행자일 수 있지만 release risk owner는 여전히 사람입니다.

의사결정 우선순위는 **권한 최소화 > 실행 증거 > 비용 한도 > 모델 효율 > 자동 수정 범위 확대**입니다. CI 안의 에이전트는 빠른 조수가 아니라 제한된 권한을 가진 자동화 주체로 다뤄야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] Copilot CLI 또는 agentic workflow 실행에 `copilot-requests: write`가 명시되어 있다.
- [ ] workflow별 session credit cap과 timeout이 있다.
- [ ] 조직 과금 경로에서 user-level budget이 적용되는지 확인했다.
- [ ] agent run마다 workflow id, task id, model policy, credit used, stop reason을 남긴다.
- [ ] high-risk path는 agent 자동 수정에서 제외하거나 owner approval을 요구한다.
- [ ] auto model selection과 open-weight model 허용 기준이 task class별로 나뉘어 있다.
- [ ] deprecate 예정 모델을 workflow에서 쓰는지 주간 점검한다.
- [ ] evidence artifact 없이 완료된 agent run은 실패로 본다.

### 연습

1. 현재 GitHub Actions workflow 중 에이전트 triage를 붙일 수 있는 low-risk job 1개를 고르고, read-only 권한표를 작성해보세요.
2. PR 30건을 샘플링해 "agent가 고쳐도 되는 실패"와 "사람이 봐야 하는 실패"를 라벨링해보세요.
3. 팀 주간 AI credit 예산을 기준으로 workflow별 cap을 정하고, cap 초과 시 멈출 조건을 문서화해보세요.

## 참고한 흐름

- GitHub Changelog: [Copilot CLI no longer needs a personal access token in GitHub Actions](https://github.blog/changelog/2026-07-02-copilot-cli-no-longer-needs-a-personal-access-token-in-github-actions/)
- GitHub Changelog: [Agentic workflows no longer need a personal access token](https://github.blog/changelog/2026-06-11-agentic-workflows-no-longer-need-a-personal-access-token/)
- GitHub Changelog: [Copilot CLI auto model selection routes based on task](https://github.blog/changelog/2026-07-01-copilot-cli-auto-model-selection-routes-based-on-task/)
- GitHub Changelog: [Kimi K2.7 Code is generally available in GitHub Copilot](https://github.blog/changelog/2026-07-01-kimi-k2-7-is-now-available-in-github-copilot/)
- GitHub Changelog: [Improved accuracy and coverage in Copilot usage metrics reports](https://github.blog/changelog/2026-07-02-improved-accuracy-and-coverage-in-copilot-usage-metrics-reports/)
