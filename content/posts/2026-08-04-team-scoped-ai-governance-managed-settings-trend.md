---
title: "2026 개발 트렌드: Team-Scoped AI Governance, Copilot 정책이 조직 단위에서 역할 단위로 내려온다"
date: 2026-08-04T10:06:00+09:00
lastmod: 2026-08-04T10:06:00+09:00
draft: false
tags: ["GitHub Copilot", "AI Governance", "Managed Settings", "Platform Engineering", "Developer Tools", "Enterprise"]
categories: ["Development", "AI", "Platform Engineering"]
series: ["dev-trends"]
keywords: ["team scoped AI governance", "Copilot managed settings", "enterprise teams model policy", "developer tool governance", "GitHub Enterprise Importer"]
description: "GitHub의 enterprise team managed settings, team model policy targeting, Copilot app/cloud agent managed settings, GitLab migration GA 흐름을 바탕으로 AI 개발 도구 정책이 조직 전체 기본값에서 팀·역할 단위 운영 계약으로 이동하는 이유를 정리합니다."
summary: "AI 개발 도구 정책은 더 이상 enterprise 전체에 하나의 기본값을 거는 수준에 머물지 않습니다. 모델, 플러그인, marketplace, bypass 권한, telemetry, migration 대상 repo를 팀·역할·훈련 상태에 맞춰 다르게 적용하되, enterprise baseline은 유지하는 구조가 필요해지고 있습니다."
key_takeaways:
  - "GitHub의 2026년 8월 3일 enterprise team specialization은 managed-settings.json 위에 팀별 override 파일과 team-mappings.json을 얹는 방향을 보여준다."
  - "모델 정책도 org/resource 단위에서 user/team 단위로 이동하며, 역할·훈련 상태·frontier 실험 팀에 맞춘 접근 제어가 중요해진다."
  - "Copilot app과 cloud agent까지 managed settings 적용 범위가 넓어지면서 정책의 약한 표면을 줄이는 일이 플랫폼 운영 과제가 된다."
  - "GitLab에서 GitHub로의 self-serve migration GA는 repo 이동 이후 AI 정책, telemetry, ruleset, team mapping까지 migration checklist에 넣으라는 신호다."
operator_checklist:
  - "AI 정책 baseline과 팀별 override 가능 key를 분리하고, compliance-critical key는 enterprise에서 잠근다."
  - "팀별 모델·플러그인·marketplace 예외는 training state, role, repo risk tier, review SLA와 연결한다."
  - "managed settings 적용률, policy version lag, least-restrictive 병합 결과, unapproved plugin 사용 시도를 주간 점검한다."
learning_refs:
  - title: "Managed Dev-Tool Telemetry Plane"
    href: "/posts/2026-07-09-managed-dev-tool-telemetry-plane-trend/"
    description: "개발 도구 설정과 telemetry가 endpoint 정책으로 내려오는 흐름입니다."
  - title: "Agentic Development Surface Convergence"
    href: "/posts/2026-07-27-agentic-development-surface-convergence-trend/"
    description: "IDE, 앱, CLI, PR, 모바일을 오가는 agent 작업 표면을 다룹니다."
  - title: "AI Usage Metrics Contract"
    href: "/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/"
    description: "AI 사용량과 비용 지표를 운영 계약으로 보는 전날 글입니다."
  - title: "Workflow Trust Boundary"
    href: "/posts/2026-07-31-workflow-trust-boundary-self-actions-managed-devices-trend/"
    description: "원격 제어와 managed device 신뢰 경계를 다룬 글입니다."
decision_guide:
  title: "Team-Scoped AI Governance를 어떻게 시작할까"
  intro: "팀별 예외는 생산성을 높일 수 있지만, baseline 없이 열면 policy drift가 됩니다. 먼저 잠글 것과 위임할 것을 나눕니다."
  cases:
    - badge: "Baseline first"
      title: "모든 개발자가 Copilot app, CLI, cloud agent를 쓰기 시작했다"
      fit: "client 표면이 늘어 enterprise 공통 guardrail이 필요한 조직"
      watchouts: "한 클라이언트라도 관리 밖에 있으면 승인 우회, 미검증 plugin, telemetry 누락 경로가 된다."
      next_step: "managed-settings.json으로 플러그인, marketplace, bypass, telemetry 기본값을 잠근다."
    - badge: "Team override"
      title: "역할별로 필요한 모델과 플러그인이 다르다"
      fit: "보안팀, 데이터팀, 플랫폼팀, AI pioneer 팀이 서로 다른 도구와 모델을 요구하는 조직"
      watchouts: "팀 중복 소속에서 least-restrictive 병합이 의도보다 넓은 권한을 줄 수 있다."
      next_step: "override 가능 key만 열고, team-mappings.json 리뷰를 CODEOWNERS로 묶는다."
    - badge: "Migration gate"
      title: "GitLab에서 GitHub로 대량 이전한다"
      fit: "repo migration과 동시에 Copilot, Actions, ruleset, issue/PR 운영도 정비하려는 팀"
      watchouts: "코드만 옮기면 AI 정책, telemetry, secret scanning, CODEOWNERS가 비어 새 플랫폼의 기본값에 기대게 된다."
      next_step: "migration runbook에 team mapping, repo risk tier, managed settings 적용 검증을 넣는다."
---

2026년 8월 3일 GitHub Changelog에는 기업 개발 플랫폼 운영자가 눈여겨볼 만한 업데이트가 두 개 올라왔습니다. 하나는 Copilot managed settings를 enterprise team별로 세분화하는 기능이고, 다른 하나는 GitLab.com과 GitLab Self-Managed에서 GitHub Enterprise Cloud로의 migration을 GitHub Enterprise Importer와 `gh gl2gh` CLI로 self-serve 할 수 있게 된 소식입니다. 며칠 전에는 enterprise teams model policy targeting public preview, Copilot app과 cloud agent의 managed settings 적용, MDM/file-based managed settings, enterprise-managed OpenTelemetry export도 이어졌습니다.

겉으로 보면 관리 기능 묶음입니다. 하지만 흐름은 분명합니다. AI 개발 도구 정책은 "우리 회사는 Copilot을 켠다/끈다" 수준에서 벗어나 **팀, 역할, 훈련 상태, repo risk tier, client surface**에 따라 다르게 적용되는 운영 계약으로 내려가고 있습니다. 저는 이 흐름을 Team-Scoped AI Governance라고 보겠습니다.

이 글은 [Managed Dev-Tool Telemetry Plane](/posts/2026-07-09-managed-dev-tool-telemetry-plane-trend/), [Agentic Development Surface Convergence](/posts/2026-07-27-agentic-development-surface-convergence-trend/), [Workflow Trust Boundary](/posts/2026-07-31-workflow-trust-boundary-self-actions-managed-devices-trend/), [AI Usage Metrics Contract](/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/)와 이어집니다. 어제 글이 사용량과 비용을 다뤘다면, 오늘의 질문은 더 조직적입니다. **누가 어떤 모델과 플러그인, 어떤 승인 우회, 어떤 telemetry 정책을 가져도 되는가**입니다.

참고한 공식 신호:

- GitHub Changelog, Enterprise team specialization for managed settings: https://github.blog/changelog/2026-08-03-enterprise-team-specialization-for-managed-settings/
- GitHub Changelog, Enterprise teams model policy targeting in public preview: https://github.blog/changelog/2026-07-31-enterprise-teams-model-policy-targeting-in-public-preview/
- GitHub Changelog, Enterprise managed settings in the GitHub Copilot app and Copilot cloud agent: https://github.blog/changelog/2026-07-27-enterprise-managed-settings-now-apply-to-the-github-copilot-app/
- GitHub Changelog, Deploy managed Copilot settings via MDM in VS Code and CLI: https://github.blog/changelog/2026-07-08-deploy-managed-copilot-settings-via-mdm-in-vs-code-and-cli/
- GitHub Changelog, Migrate from GitLab to GitHub with GitHub Enterprise Importer: https://github.blog/changelog/2026-08-03-migrate-from-gitlab-to-github-with-github-enterprise-importer/

## 이 글에서 얻는 것

- Copilot managed settings가 enterprise 공통 정책에서 팀별 override 구조로 확장되는 이유를 이해합니다.
- 모델 접근, 플러그인, marketplace, bypass permission, telemetry 같은 설정을 팀·역할 기준으로 나누는 실무 기준을 잡을 수 있습니다.
- least-restrictive 병합, 팀 중복 소속, `.github-private` 설정 저장소 운영이 만드는 위험을 미리 볼 수 있습니다.
- GitLab에서 GitHub로 migration할 때 코드 이동뿐 아니라 AI 정책과 개발 도구 governance를 함께 옮겨야 하는 이유를 정리합니다.

## 핵심 개념/이슈

### 1) Enterprise baseline과 team specialization은 역할이 다르다

GitHub의 8월 3일 발표는 `managed-settings.json`의 개별 key를 팀별로 override 가능하게 만들고, `copilot/teams/` 아래 팀 설정 파일과 `team-mappings.json`으로 어떤 enterprise team에 어떤 설정을 적용할지 매핑하는 구조를 설명합니다. 중요한 점은 모든 설정을 팀에게 넘기는 것이 아니라, enterprise가 override 가능한 key를 명시한다는 점입니다. 잠긴 key는 enterprise 결정으로 남고, 열린 key만 팀별 특화가 됩니다.

이 구조는 현실적입니다. 보안팀, 데이터팀, 프론티어 모델을 실험하는 AI pioneer 팀, 일반 제품팀은 필요한 도구가 다릅니다. 한쪽은 특정 plugin과 marketplace가 필요하고, 다른 쪽은 승인 prompt를 절대 우회하면 안 됩니다. 모든 팀에 가장 보수적인 정책을 적용하면 생산성이 막히고, 모든 팀에 가장 자유로운 정책을 적용하면 governance가 무너집니다.

정책을 나눌 때는 아래처럼 시작할 수 있습니다.

| 정책 종류 | enterprise baseline | team override 후보 |
| --- | --- | --- |
| marketplace | 승인된 marketplace만 허용 | 특정 팀의 추가 marketplace |
| plugin | 보안 검토된 기본 plugin | 역할별 plugin 추가 |
| model | 최소 허용 모델과 차단 모델 | frontier 팀의 추가 모델 |
| bypass permission | 고위험 우회 차단 | 낮은 위험 팀의 제한적 완화 |
| telemetry | 승인 collector와 raw content 비수집 | sampling 비율 또는 service name |

핵심은 baseline과 override를 같은 문서에 섞지 않는 것입니다. compliance-critical 설정은 baseline에 남기고, 생산성 차이는 override로 둬야 합니다.

### 2) 모델 정책은 org가 아니라 사람과 역할에 가까워진다

7월 31일 공개된 enterprise teams model policy targeting은 모델 접근 제어를 enterprise team 단위로 다루는 흐름을 보여줍니다. 기존 org/resource 중심 설정은 저장소와 조직 경계에는 잘 맞지만, 사람이 실제로 일하는 방식과는 어긋날 수 있습니다. 같은 org 안에서도 보안 리뷰어, 데이터 엔지니어, 프론트엔드 개발자, 플랫폼 운영자는 필요한 모델과 위험도가 다릅니다.

팀 단위 모델 정책은 아래 질문을 가능하게 합니다.

- frontier 모델은 훈련을 마친 AI pioneer 팀에만 열 것인가?
- 비용이 높은 모델은 L3 작업, 보안 리뷰, 복잡한 리팩터링에만 허용할 것인가?
- 법무·보안·고객 데이터 경로는 자동 모델 선택보다 승인된 모델 목록으로 제한할 것인가?
- 새 모델을 10% 팀에만 열고 2주 뒤 quality/cost 지표를 볼 수 있는가?

의사결정 기준은 **작업 위험도 > 데이터 민감도 > 팀 훈련 상태 > 비용 예산 > 개인 선호** 순서가 좋습니다. 개인이 좋은 모델을 쓰고 싶다는 이유만으로 high-cost/high-risk 모델을 넓게 열면, 비용과 품질 사고가 뒤섞입니다. 반대로 모든 팀을 낮은 모델에 묶으면 고위험 작업에서 검토 비용이 늘어납니다.

### 3) Least-restrictive 병합은 편하지만 권한 팽창을 만든다

GitHub 발표는 사용자가 여러 팀에 속할 때 팀별 설정이 least-restrictive 방식으로 결합될 수 있다고 설명합니다. 이 방식은 사용자 경험에는 좋습니다. 한 사람이 데이터팀과 AI pioneer 팀에 속해 있으면 둘 중 더 넓은 설정이 적용되어 막힘이 줄어듭니다. 하지만 보안 관점에서는 권한 팽창을 조심해야 합니다.

팀 중복 소속은 조직에서 흔합니다. 플랫폼 담당자가 여러 product team에 들어가고, incident commander가 임시 팀에 들어가고, 보안팀원이 감사 목적으로 많은 팀에 속합니다. 이때 설정 병합 결과가 의도보다 넓어질 수 있습니다.

운영 기준:

- 팀 설정 변경은 CODEOWNERS 리뷰를 통과한다.
- team-mappings 변경은 주 1회 diff report로 검토한다.
- 사람이 3개 이상 AI policy team에 속하면 자동 review 후보로 올린다.
- high-risk model 또는 bypass 완화가 붙은 팀은 membership TTL을 둔다.
- 병합 결과 권한을 사용자별 effective policy로 export해 감사한다.

목표는 팀별 유연성을 없애는 것이 아닙니다. 실제 적용 결과를 보자는 것입니다. policy 파일이 안전해 보여도 effective policy가 넓으면 운영 리스크는 넓은 쪽을 따릅니다.

### 4) Client surface가 늘수록 정책의 약한 표면이 전체 경계를 정한다

7월 27일 GitHub는 Copilot app과 cloud agent도 enterprise managed settings를 읽도록 확장했다고 설명했습니다. 이전에는 VS Code와 CLI에 정책을 잘 걸어도 app이나 cloud agent가 별도 표면으로 남을 수 있었습니다. 이제 managed settings가 더 넓은 client에 적용되는 방향입니다.

이 변화는 [Agentic Development Surface Convergence](/posts/2026-07-27-agentic-development-surface-convergence-trend/)와 직결됩니다. 개발자는 IDE, CLI, 데스크톱 앱, cloud agent, PR 화면을 오가며 작업합니다. 한 표면에서 `enabledPlugins`가 통제되고 다른 표면에서 풀리면, 실제 정책은 풀린 표면을 따라갑니다. 한 표면에서 telemetry가 빠지면, state-changing action의 증거가 끊깁니다.

점검해야 할 surface:

| surface | 확인할 정책 |
| --- | --- |
| VS Code | model, plugin, marketplace, telemetry, bypass |
| Copilot CLI | command approval, tool access, telemetry, model |
| Copilot app | plugin, marketplace, model, app access |
| cloud agent | approved plugin, marketplace, repo access, task evidence |
| managed device | MDM/file-based config, remote control 제한 |

실무 목표는 "모든 표면을 즉시 완벽히 통제"가 아닙니다. 최소한 고위험 repo와 production credential이 있는 개발자부터 policy coverage 95% 이상을 만들고, unknown surface를 0건에 가깝게 줄이는 것입니다.

### 5) Migration은 repo copy가 아니라 governance migration이다

같은 날 올라온 GitHub Enterprise Importer의 GitLab migration GA도 이 흐름과 연결됩니다. GitLab.com과 현재 유지보수되는 GitLab Self-Managed에서 GitHub Enterprise Cloud로 repository migration을 self-serve 할 수 있고, 단일 repo와 scripted bulk migration, GitHub-owned blob storage 또는 AWS S3/Azure Blob storage staging을 지원한다는 내용입니다.

이 기능은 repository 이동을 쉽게 만듭니다. 하지만 플랫폼 관점에서는 코드가 옮겨진 뒤가 더 중요합니다. GitLab의 group, project, protected branch, CI 변수, runner, merge approval, issue label, 보안 스캔 정책이 GitHub의 org, team, ruleset, Actions, secret scanning, CODEOWNERS, Copilot managed settings와 1:1로 맞지 않습니다. migration 후 AI 도구를 켠다면 team mapping과 managed settings가 빠진 repo는 새 플랫폼의 default에 기대게 됩니다.

Migration checklist에는 아래 항목을 넣어야 합니다.

- GitLab group/member를 GitHub enterprise team으로 매핑
- repo risk tier와 CODEOWNERS 설정
- protected branch와 ruleset 전환 검증
- CI secret과 environment protection 재정의
- Copilot model/plugin/marketplace baseline 적용
- OTel collector와 usage metrics 연결
- migration 후 7일간 policy drift와 secret scanning 결과 점검

코드만 옮기는 migration은 빠르지만, governance가 비면 위험한 빈칸을 만든 채로 출발합니다.

## 실무 적용

### 1) AI policy repository를 제품처럼 운영한다

`.github-private` 같은 enterprise policy 저장소는 더 이상 설정 파일 창고가 아닙니다. AI 개발 도구 control plane의 소스입니다. 따라서 일반 애플리케이션처럼 owner, review, test, rollout, rollback이 필요합니다.

권장 구조:

```text
copilot/
  managed-settings.json
  teams/
    ai-pioneers.json
    platform-devs.json
    security-reviewers.json
  team-mappings.json
  tests/
    expected-effective-policy.yaml
```

운영 규칙:

- baseline 변경은 platform owner 2명 승인
- 팀 override 변경은 해당 팀 owner + platform owner 승인
- high-risk key 변경은 security owner 승인
- `team-mappings.json` 변경은 effective policy diff를 PR에 첨부
- 배포 후 1시간 이내 적용률과 policy version을 확인

GitHub는 supported clients가 설정을 약 1시간 안에 적용하거나 재시작/재로그인 때 반영된다고 안내합니다. 그러면 운영팀도 적용 지연을 지표로 봐야 합니다. 정책은 merge됐는데 20% client가 하루 뒤에도 옛 버전을 쓰면 그 자체가 incident 후보입니다.

### 2) Override 가능 key를 최소로 시작한다

처음부터 모든 key를 팀별로 열면 설계가 빠르게 복잡해집니다. 시작은 세 그룹으로 나눕니다.

```yaml
locked_enterprise_keys:
  - telemetry.exporter.endpoint
  - telemetry.captureContent
  - strictKnownMarketplaces
  - permissions.disableBypassPermissionsMode

overridable_with_review:
  - model.default
  - enabledPlugins
  - extraKnownMarketplaces

experimental_team_only:
  - frontierModelAccess
  - betaPluginAccess
```

규칙은 보수적일수록 좋습니다. 외부 marketplace, bypass permission, raw prompt/content telemetry는 기본 잠금입니다. 팀 override는 모델 선택과 역할별 plugin 추가처럼 생산성 차이가 큰 영역부터 엽니다.

### 3) Effective policy를 대시보드로 본다

파일이 맞다고 실제 권한이 맞는 것은 아닙니다. 사용자별 팀 중복, license source, client support, MDM precedence, server-managed 설정이 합쳐진 결과를 봐야 합니다.

초기 지표:

- managed settings applied rate: 95% 이상
- policy version lag: 24시간 초과 사용자 5% 미만
- unknown client surface: 0건 목표
- unapproved plugin attempt: 0건 목표
- high-cost model access user 비율: 승인된 팀과 100% 일치
- bypass permission attempt: 주간 추세 확인
- telemetry missing for state-changing agent task: 0건
- team membership TTL expired: 0건

이 지표는 개발자를 통제하기 위한 숫자가 아니라 blind spot을 줄이는 숫자입니다. 특히 high-cost model access와 unapproved plugin attempt는 비용과 공급망 리스크가 동시에 걸립니다.

### 4) Evidence table을 먼저 작게 만든다

Team-scoped 정책은 파일 구조보다 증거 구조가 먼저입니다. `managed-settings.json`과 팀별 override를 잘 나눠도 운영팀이 "지금 이 사용자는 어떤 정책을 받고 있는가"를 바로 말하지 못하면 장애 대응과 감사에서 다시 수작업이 됩니다. 처음부터 큰 대시보드를 만들 필요는 없고, 아래처럼 effective policy evidence table 하나로 시작할 수 있습니다.

| 필드 | 예시 | 왜 필요한가 |
| --- | --- | --- |
| user_or_team | `platform-devs` | 정책 적용 단위를 명확히 한다 |
| policy_version | `copilot-policy-2026-08-04.1` | 설정 변경과 사고 시점을 연결한다 |
| source_files | `managed-settings.json`, `teams/platform-devs.json` | baseline과 override 출처를 구분한다 |
| allowed_models | `gpt-5-codex`, `frontier-preview-denied` | 비용·위험이 큰 모델 접근을 검증한다 |
| allowed_plugins | `github`, `sentry`, `internal-runbook` | 공급망 예외와 승인 범위를 확인한다 |
| client_surfaces | `vscode`, `cli`, `app`, `cloud-agent` | 관리 밖 표면을 찾는다 |
| training_state | `trained` | 정책 예외가 숙련도와 연결되는지 본다 |
| expires_at | `2026-10-31` | 임시 예외가 영구 권한이 되는 것을 막는다 |

이 표는 보안팀만 보는 문서가 아니라 platform owner, engineering manager, developer experience 팀이 같이 보는 운영 기록이어야 합니다. 특히 `source_files`와 `policy_version`을 남기면 "설정은 바뀌었는데 왜 아직 이 사용자는 old policy인가"를 client 적용 지연, 팀 매핑 누락, MDM precedence 문제로 나눠 추적할 수 있습니다.

초기에는 주 1회 CSV export로도 충분합니다. 중요한 것은 fancy dashboard가 아니라 diff입니다. 지난주 대비 high-cost model 접근자가 12명 늘었는지, unknown client surface가 다시 생겼는지, 만료된 pioneer 권한이 남아 있는지를 보는 쪽이 실무 효과가 큽니다.

### 5) 팀별 정책은 training state와 연결한다

팀별 예외를 요청서만으로 열면 시간이 지나며 예외가 기본값이 됩니다. 더 나은 기준은 training state입니다.

예시:

| 상태 | 허용 |
| --- | --- |
| untrained | 기본 모델, 승인된 기본 plugin, bypass 금지 |
| trained | 팀별 plugin 추가, 일부 모델 optional |
| pioneer | frontier 모델 canary, 추가 marketplace, 높은 telemetry 샘플링 |
| suspended | 모델·plugin 추가 권한 회수, baseline만 유지 |

훈련 상태는 영구 자격이 아닙니다. 90일마다 재확인하고, 보안 사고나 policy violation이 있으면 suspended로 내려야 합니다. 이렇게 해야 "팀별 유연성"이 "영구 예외"가 되지 않습니다.

### 6) Migration runbook에 AI governance gate를 넣는다

GitLab에서 GitHub로 bulk migration을 할 때는 repository 목록만 보지 말고 정책 이동 단위를 정합니다.

```yaml
migration_governance_gate:
  before_migration:
    - group_to_enterprise_team_mapping
    - repo_risk_tier
    - protected_branch_to_ruleset_map
    - ci_secret_inventory
  after_migration:
    - codeowners_present
    - managed_settings_policy_applied
    - secret_scanning_enabled
    - actions_runner_policy_checked
    - copilot_plugin_marketplace_policy_checked
  hold_if:
    - "high-risk repo has no CODEOWNERS"
    - "repo owner team missing"
    - "production secret copied without environment protection"
    - "Copilot policy unknown for repo owner team"
```

이 gate가 있으면 migration은 단순 복사가 아니라 새 플랫폼의 운영 기준으로 승격됩니다. 코드 이전 속도가 조금 느려져도, 이후 6개월의 권한·CI·AI 도구 drift 비용을 줄이는 쪽이 더 낫습니다.

## 트레이드오프/주의점

첫째, 팀별 정책은 자유도를 높이지만 디버깅을 어렵게 만듭니다. 같은 repo에서 두 개발자가 다른 모델과 plugin set을 쓰면 결과 차이가 생길 수 있습니다. 그래서 PR evidence에는 effective policy version, model class, plugin list를 최소한 요약해 남기는 편이 좋습니다.

둘째, least-restrictive 병합은 사용자 막힘을 줄이지만 권한 팽창을 만들 수 있습니다. 임시 TF, 보안 감사, 플랫폼 지원처럼 다중 팀 소속이 잦은 역할은 membership TTL과 주간 검토가 필요합니다.

셋째, enterprise baseline을 너무 강하게 잡으면 실험 팀이 우회 경로를 찾습니다. 실험을 막기보다 sandbox team, 별도 repo risk tier, 짧은 TTL, 높은 telemetry 샘플링으로 관리하는 편이 현실적입니다.

넷째, migration 자동화는 권한과 정책 의미를 완전히 이해하지 못합니다. GitLab의 group 구조와 GitHub enterprise team 구조가 다르면 owner가 사라지거나 너무 넓어질 수 있습니다. migration 후 7일 동안 drift report를 보는 이유가 여기에 있습니다.

다섯째, telemetry와 governance는 개발자 신뢰를 건드립니다. 원문 prompt나 파일 내용을 무기한 저장하면 도구 신뢰가 무너집니다. 목적 제한, raw content 기본 비수집, 접근 감사, retention을 policy 파일 옆에 같이 문서화해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] `managed-settings.json`에서 enterprise baseline과 override 가능 key가 분리되어 있다.
- [ ] 팀별 설정 파일은 `copilot/teams/` 아래 versioned artifact로 관리된다.
- [ ] `team-mappings.json` 변경에는 effective policy diff와 CODEOWNERS 리뷰가 붙는다.
- [ ] 모델 접근 정책은 org가 아니라 role, training state, repo risk tier와 연결되어 있다.
- [ ] Copilot app, CLI, VS Code, cloud agent 중 policy coverage가 빠진 surface가 없다.
- [ ] unapproved plugin, unknown marketplace, telemetry missing, bypass attempt를 주간 지표로 본다.
- [ ] GitLab migration runbook에 team mapping, ruleset, CODEOWNERS, AI managed settings 적용 검증이 포함되어 있다.

### 연습

1. 현재 조직의 AI 도구 사용자를 `untrained`, `trained`, `pioneer`, `suspended` 네 상태로 나누고, 각 상태별 모델·plugin·marketplace 허용 범위를 표로 정리해 보세요.
2. `managed-settings.json`에서 절대 override하면 안 되는 key 5개와 팀별 override를 허용할 key 5개를 골라 이유를 적어 보세요.
3. 사용자가 세 팀에 동시에 속할 때 effective policy가 어떻게 합쳐지는지 샘플 5명을 뽑아 검토해 보세요.
4. GitLab repo 10개를 GitHub로 옮긴다고 가정하고, 코드 migration 외에 CODEOWNERS, ruleset, secret, Copilot policy, telemetry를 검증하는 1페이지 runbook을 작성해 보세요.

Team-Scoped AI Governance의 핵심은 중앙 통제를 강화하자는 말이 아닙니다. 실제 팀이 서로 다른 일을 한다는 사실을 인정하되, 그 차이를 파일, 리뷰, 지표, 만료 시간으로 관리하자는 뜻입니다. 앞으로 좋은 플랫폼팀은 "AI 도구를 허용했나"가 아니라 **어떤 팀이 어떤 조건으로 무엇을 할 수 있는지 설명할 수 있나**로 평가받게 될 가능성이 큽니다.

## 관련 글

- [Managed Dev-Tool Telemetry Plane](/posts/2026-07-09-managed-dev-tool-telemetry-plane-trend/)
- [Agentic Development Surface Convergence](/posts/2026-07-27-agentic-development-surface-convergence-trend/)
- [Workflow Trust Boundary](/posts/2026-07-31-workflow-trust-boundary-self-actions-managed-devices-trend/)
- [AI Usage Metrics Contract](/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/)
- [Inference Router + Quality-Cost Gateway](/posts/2026-04-03-inference-router-quality-cost-gateway-trend/)
