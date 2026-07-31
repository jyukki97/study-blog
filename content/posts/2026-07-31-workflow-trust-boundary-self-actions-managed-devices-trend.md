---
title: "2026 개발 트렌드: Self-Repository Actions와 Managed Remote Control, 개발자 워크플로의 신뢰 경계가 더 좁아진다"
date: 2026-07-31T10:06:00+09:00
lastmod: 2026-07-31T10:06:00+09:00
draft: false
tags: ["GitHub Actions", "GitHub Copilot", "Remote Control", "Device Trust", "Developer Workflow", "Platform Governance"]
categories: ["Development", "Security", "Platform Engineering", "AI"]
series: ["dev-trends"]
keywords: ["GitHub Actions self-repository syntax", "Copilot remote control managed devices", "agent worktrees", "developer workflow trust boundary", "same repository actions"]
description: "GitHub Actions의 self-repository syntax, Copilot remote control managed devices, VS Code Agents window 업데이트를 바탕으로 개발자 워크플로가 코드 ref와 디바이스 신뢰 경계까지 명시하는 방향으로 이동하는 흐름을 정리합니다."
summary: "요즘 개발 도구의 변화는 에이전트가 더 많은 일을 하는 쪽으로만 가지 않습니다. 같은 저장소 안의 Actions 참조, 원격 제어 가능한 관리형 디바이스, worktree 기반 agent session처럼 실행 주체와 실행 위치를 더 좁게 고정하는 방향이 같이 커지고 있습니다."
key_takeaways:
  - "Actions 내부 참조는 checkout 관습이나 hardcoded version이 아니라 실행 중인 exact commit에 묶이는 self-repository syntax로 이동한다."
  - "원격 제어형 코딩 에이전트는 기능 허용 여부만이 아니라 어떤 관리형 디바이스가 host가 될 수 있는지까지 정책 대상이 된다."
  - "실무 기준은 자동화 편의보다 ref pinning, device trust, session isolation, evidence, revoke SLA를 한 번에 보는 것이다."
operator_checklist:
  - "내부 action/reusable workflow는 `./`와 hardcoded ref 의존을 점검하고 runner 2.336.0 이상에서 `$/` 전환 후보를 분리한다."
  - "Copilot remote control은 enterprise policy와 managed device 설정을 함께 보고, production 권한 장비는 SSO 또는 disabled로 시작한다."
  - "agent worktree, multi-session, subagent 관측은 session ledger와 PR evidence 기준이 없으면 파일 충돌과 승인 누락을 만들 수 있다."
learning_refs:
  - title: "CI Runner Version Floor"
    href: "/posts/2026-07-24-ci-runner-version-floor-trend/"
    description: "CI 기능과 보안 정책이 runner 버전 하한선에 묶이는 흐름입니다."
  - title: "Remote Agent Control Plane"
    href: "/posts/2026-05-22-remote-agent-control-plane-trend/"
    description: "원격 에이전트와 relay, 권한 수명, 회수 기준을 다룬 글입니다."
  - title: "Agent Workspace Lease Broker"
    href: "/posts/2026-05-11-agent-workspace-lease-broker-trend/"
    description: "worktree, sandbox, session isolation을 작업 소유권과 연결하는 관점입니다."
  - title: "Publish-Time Supply Chain Gate"
    href: "/posts/2026-07-30-publish-time-supply-chain-review-context-trend/"
    description: "실행 전에 멈추는 공급망 게이트와 오늘의 trust boundary 흐름이 이어집니다."
decision_guide:
  title: "어디까지 신뢰 경계를 좁힐 것인가"
  intro: "개발 도구는 점점 더 강한 자동 실행 권한을 갖습니다. 그래서 정책은 '허용/차단'에서 끝나지 않고, 어떤 commit, 어떤 장비, 어떤 session, 어떤 evidence에 묶을지까지 내려와야 합니다."
  cases:
    - badge: "Ref boundary"
      title: "같은 저장소 action을 많이 조합한다"
      fit: "monorepo, composite action, reusable workflow, release pipeline이 같은 repo 안에 섞여 있는 팀"
      watchouts: "내부 action을 hardcoded ref로 부르면 caller가 pin한 commit과 다른 코드가 실행될 수 있다."
      next_step: "`uses: $/path/to/action` 전환 후보와 runner version floor를 같이 점검한다."
    - badge: "Device boundary"
      title: "원격 제어 또는 background agent를 쓴다"
      fit: "개발자 머신, VDI, managed laptop에서 Copilot remote control이나 비슷한 agent host 기능을 쓰는 조직"
      watchouts: "사용자 계정만 허용하면 unmanaged 개인 장비가 production credential을 가진 host가 될 수 있다."
      next_step: "managed device, SSO, MDM 설정, revoke SLA를 enterprise policy에 넣는다."
    - badge: "Session boundary"
      title: "agent worktree와 multi-session이 늘어난다"
      fit: "병렬 agent 작업, stacked session, subagent, PR 리뷰 대응 자동화가 늘어나는 팀"
      watchouts: "worktree는 파일 격리에는 좋지만 shared DB, feature flag, approval 상태까지 자동 격리하지 않는다."
      next_step: "session ledger와 workspace lease를 작업 시작 조건으로 둔다."
faqs:
  - question: "같은 저장소 action이면 `./`로 충분하지 않나요?"
    answer: "작은 workflow에서는 충분할 수 있습니다. 하지만 checkout 의존, nested composition, SHA pinning 정책을 같이 쓰기 시작하면 실행 중인 exact commit에 묶이는 self-repository reference가 더 명확합니다."
  - question: "원격 제어를 managed device로 제한하면 개발자 경험이 나빠지지 않나요?"
    answer: "일부 마찰은 생깁니다. 다만 production credential, browser session, 사내 VPN이 붙은 장비를 에이전트 host로 쓰는 순간 device trust는 개발자 경험 문제가 아니라 보안 경계가 됩니다."
---

2026년 7월 30일 GitHub Changelog에는 겉으로는 서로 다른 업데이트가 나란히 올라왔습니다. GitHub Actions는 같은 저장소 안의 action과 reusable workflow를 `$/`로 참조하는 self-repository syntax를 공개했습니다. GitHub Copilot은 remote control session을 어떤 managed device에서 host할 수 있는지 제한하는 설정을 추가했습니다. VS Code 쪽 Copilot 업데이트는 Agents window, worktree 기반 session, subagent 관측, multi-chat session, BYOK model 사용을 한꺼번에 밀어 올렸습니다.

이 변화들을 따로 보면 Actions 편의 기능, 기업 관리 설정, IDE 업데이트입니다. 같이 보면 더 중요한 방향이 보입니다. 에이전트와 자동화가 강해질수록 개발 도구는 "더 많은 일을 해준다"에서 멈추지 않고 **어떤 commit의 코드를 실행하는가, 어떤 장비에서 세션을 열 수 있는가, 어떤 작업 공간에서 agent가 움직이는가**를 더 명시적으로 묶고 있습니다. 저는 이 흐름을 개발자 워크플로의 trust boundary가 더 좁아지는 신호로 봅니다.

이 글은 [CI Runner Version Floor](/posts/2026-07-24-ci-runner-version-floor-trend/), [Remote Agent Control Plane](/posts/2026-05-22-remote-agent-control-plane-trend/), [Agent Workspace Lease Broker](/posts/2026-05-11-agent-workspace-lease-broker-trend/), [Publish-Time Supply Chain Gate](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/)와 이어집니다. 어제 글이 패키지와 workflow를 실행 전에 멈추는 흐름을 봤다면, 오늘은 실행을 허용할 때 **그 실행이 정확히 어느 경계 안에 묶이는지**를 봅니다.

참고한 공식 신호:

- GitHub Changelog, Reference same-repository actions with self-repository syntax: https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/
- GitHub Changelog, Limit remote control to managed devices: https://github.blog/changelog/2026-07-30-limit-remote-control-to-managed-devices/
- GitHub Changelog, GitHub Copilot in Visual Studio Code, July 2026 releases: https://github.blog/changelog/2026-07-30-github-copilot-in-visual-studio-code-july-2026-releases/
- GitHub Changelog, GitHub Copilot in Visual Studio, July update: https://github.blog/changelog/2026-07-30-github-copilot-in-visual-studio-july-update/
- GitHub Blog, Stacked sessions and pull requests in the GitHub Copilot app: https://github.blog/ai-and-ml/github-copilot/stacked-sessions-and-pull-requests-in-the-github-copilot-app/

## 이 글에서 얻는 것

- GitHub Actions self-repository syntax가 단순 축약 문법이 아니라 ref consistency와 SHA pinning 정책에 왜 중요한지 이해합니다.
- Copilot remote control managed device 제한이 사용자 권한 정책과 어떻게 다른지 구분할 수 있습니다.
- agent worktree, multi-chat, subagent 관측이 왜 session ledger와 workspace lease를 요구하는지 정리합니다.
- 자동화 도입 시 commit, device, session, evidence를 함께 보는 실무 기준을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 내부 action 참조도 공급망 경계다

GitHub Actions에서 외부 action을 full-length commit SHA로 pinning하는 기준은 이제 익숙합니다. 문제는 같은 저장소 안의 action입니다. 팀은 보통 내부 composite action이나 reusable workflow를 `./.github/actions/build`처럼 부릅니다. 이 방식은 간단하지만 checkout에 기대는 경우가 많고, nested composition이나 reusable workflow 호출이 복잡해질수록 "지금 실행 중인 workflow와 같은 commit의 action을 쓰고 있는가"가 흐려집니다.

GitHub가 공개한 self-repository syntax는 `uses:` 값이 `$/`로 시작하면 현재 workflow가 실행 중인 자기 저장소의 exact commit으로 해석되도록 합니다. 같은 저장소의 action과 reusable workflow를 호출하되, 별도 checkout 없이 현재 실행 ref와 맞춥니다. 공식 설명에 따르면 runner 2.336.0 이상이 필요하고, 같은 저장소 안에서 action과 workflow를 조합할 때 권장 방식으로 안내됩니다.

이게 중요한 이유는 내부 action도 실행 코드이기 때문입니다. 예를 들어 release workflow가 `./.github/actions/sign-artifact`를 부른다고 합시다. caller는 commit SHA로 pinning되어 있는데 내부 action 참조가 checkout 상태나 branch 관습에 기대면, 실제 실행 코드와 리뷰한 코드가 어긋날 수 있습니다. 작은 차이처럼 보여도 signing, deploy, publish, secret handling action에서는 큰 문제입니다.

실무 기준은 다음처럼 잡을 수 있습니다.

| 상황 | 기존 방식 | 권장 기준 |
| --- | --- | --- |
| 단순 step에서 local action 사용 | `uses: ./.github/actions/foo` | runner floor 확인 후 `uses: $/.github/actions/foo` 후보 |
| reusable workflow가 같은 repo action 호출 | checkout과 상대경로 혼합 | `$/`로 caller commit과 일치 |
| enterprise SHA pinning 정책 적용 | 내부 action 예외 처리 | self-repository reference로 예외 축소 |
| release/sign/deploy action | branch ref 또는 tag 의존 | exact commit 일치와 CODEOWNERS 리뷰 |

핵심은 문법 자체가 아니라 "내부 코드는 안전하다"는 암묵적 전제를 줄이는 것입니다. 같은 repo에 있어도 workflow가 실행하는 코드는 공급망의 일부입니다.

### 2) Runner version floor가 기능과 보안 정책을 동시에 결정한다

self-repository syntax가 runner 2.336.0 이상을 요구한다는 점도 중요합니다. CI 기능은 이제 YAML만 바꾸면 끝나는 일이 아닙니다. runner 버전, hosted/self-hosted runner 이미지, enterprise policy, action cache, checkout 동작이 함께 맞아야 합니다. 그래서 [CI Runner Version Floor](/posts/2026-07-24-ci-runner-version-floor-trend/)에서 말한 것처럼 runner 하한선은 단순 인프라 세부사항이 아니라 보안 정책의 전제입니다.

운영팀이 해야 할 일은 새 문법을 바로 전환하는 것이 아니라 inventory를 만드는 것입니다.

```yaml
actions_trust_inventory:
  runner_min_version_required: "2.336.0"
  local_action_refs:
    - workflow: ".github/workflows/release.yml"
      current_ref: "./.github/actions/sign-artifact"
      risk: "high"
      candidate: "$/.github/actions/sign-artifact"
  reusable_workflows:
    - path: ".github/workflows/deploy.yml"
      callers: 12
      requires_sha_pinning_policy: true
  blockers:
    - "self-hosted runners under 2.336.0"
    - "workflow uses checkout side effects"
```

초기 전환 우선순위는 release, signing, publish, deploy, secret handling, permission mutation workflow부터 잡습니다. lint, formatting, docs preview 같은 저위험 workflow는 나중에 해도 됩니다. 반대로 고위험 workflow가 hardcoded branch ref를 들고 있다면 문법 전환보다 먼저 CODEOWNERS와 pinning 정책을 봐야 합니다.

### 3) 원격 제어는 사용자 권한이 아니라 device trust 문제다

Copilot remote control managed device 제한은 더 넓은 메시지를 줍니다. 원격 제어형 agent는 사용자의 IDE나 개발 환경을 host로 삼을 수 있습니다. 이때 "이 사용자가 Copilot을 쓸 수 있는가"만으로는 부족합니다. 같은 사용자라도 회사가 관리하는 노트북, 개인 장비, 임시 VM, 오래된 VDI의 위험은 다릅니다.

GitHub의 새 `remoteControl` managed setting은 remote control 동작을 managed device 단위로 제한할 수 있게 합니다. mode는 SSO 요구, disabled, enabled 같은 방식으로 잡을 수 있고, server-managed, MDM-managed, file-based 배포가 가능합니다. 기존 enterprise policy가 remote control 기능 자체의 사용 가능 여부를 다룬다면, 이 설정은 어떤 디바이스에서 그 기능이 허용되는지 더 좁힙니다.

이 차이는 큽니다.

| 정책 층 | 질문 | 예시 |
| --- | --- | --- |
| 사용자 정책 | 누가 기능을 쓸 수 있나 | Copilot Business 사용자 |
| 조직 정책 | 어느 org/repo에 허용하나 | production repo 금지 |
| 디바이스 정책 | 어떤 장비가 host가 될 수 있나 | MDM managed laptop만 허용 |
| 세션 정책 | 어떤 작업이 허용되나 | read-only, PR draft, merge 금지 |

개발자 입장에서는 귀찮아 보일 수 있습니다. 하지만 production credential, browser session, SSH key, internal package registry token이 붙은 장비를 agent host로 쓰는 순간 device trust는 선택사항이 아닙니다. unmanaged 개인 장비에서 remote control이 열리면, 계정 권한은 정상이어도 endpoint 신뢰가 깨질 수 있습니다.

### 4) Agent worktree는 파일 충돌을 줄이지만 운영 충돌까지 없애지는 않는다

VS Code July Copilot 업데이트는 Agents window 개선에서 worktree 기반 session, subagent 상태 표시, PR 업데이트 처리, multi-chat session을 강조했습니다. agent가 여러 작업을 병렬로 수행하고, 각 session이 repository의 격리된 복사본에서 움직이고, failed CI나 review comment를 chat에서 이어 처리하는 흐름입니다. 이것은 생산성 측면에서 자연스러운 진화입니다.

다만 worktree는 모든 충돌을 해결하지 않습니다. 파일은 분리되지만 shared test database, external API quota, feature flag, generated artifact, package registry, deployment environment는 여전히 공유될 수 있습니다. subagent가 여러 개 뜨면 더 빠르게 진행되지만, 어떤 subagent가 어떤 tool을 호출했고 어느 PR evidence로 연결됐는지 모르면 나중에 책임 경계가 흐려집니다.

따라서 agent worktree를 쓰는 팀은 아래 값을 session ledger에 넣어야 합니다.

```yaml
agent_session:
  session_id: "ags_01K..."
  repo: "payments-api"
  base_ref: "main@sha256..."
  worktree_path_hash: "..."
  task_class: "test-fix"
  allowed_tools: ["read", "edit", "test"]
  denied_tools: ["deploy", "external-send", "secret-read"]
  shared_resources:
    - "test-db:payments-ci"
    - "package-cache:npm"
  evidence_refs:
    - "pr:1842"
    - "ci:run-99221"
  subagents:
    - id: "sub_1"
      active_tool: "pytest"
```

이런 기록이 없으면 "agent가 worktree에서만 작업했다"는 말이 과한 안전 신호가 됩니다. worktree는 파일 시스템 격리이고, 운영 신뢰 경계는 그보다 넓습니다.

### 5) Built-in skills와 organization instructions는 표준화와 drift를 동시에 만든다

Visual Studio July update에는 Copilot SDK 기반 새 agent, .NET/Azure 팀이 만든 built-in skills, 선택 코드 리뷰, organization-level custom instructions가 함께 나왔습니다. VS Code 쪽에는 prompt file을 reusable skill로 migrate하는 기능도 보입니다. 개발팀에게는 좋은 흐름입니다. 반복되는 팀 규칙, 프레임워크 관습, 클라우드 배포 기준을 개인 prompt가 아니라 도구의 표준 경로로 올릴 수 있기 때문입니다.

하지만 표준화는 drift도 만듭니다. 어떤 skill이 켜져 있는지, 조직 instruction이 어느 repo에 적용되는지, built-in skill과 repo-local rule이 충돌할 때 무엇이 우선인지 모르면 리뷰와 생성 결과가 흔들립니다. "우리 팀 기준에 맞춰 Copilot이 답한다"는 말은 좋지만, 그 기준이 versioned artifact인지 관리 콘솔 설정인지 개인 IDE 설정인지 알아야 운영할 수 있습니다.

실무 기준:

- 조직 instruction은 owner와 version을 둔다.
- repo-local rule, org instruction, built-in skill의 precedence를 문서화한다.
- 고위험 도메인인 auth, billing, infra, data export에는 별도 instruction과 review checklist를 둔다.
- skill 변경 후 1주일은 review comment false positive와 accepted rate를 본다.
- 모델 선택이나 BYOK 설정과 skill 적용 여부를 session evidence에 남긴다.

이 흐름은 [Agent Instruction Context Hygiene](/posts/2026-07-06-agent-instruction-context-hygiene-trend/)와 연결됩니다. instruction이 많아질수록 품질은 올라갈 수 있지만, stale instruction과 권한 경계 누락도 같이 늘어납니다.

## 실무 적용

### 1) Actions 내부 참조를 risk 기반으로 전수 점검한다

먼저 저장소에서 `uses: ./`, 같은 repo reusable workflow, hardcoded branch ref를 찾습니다. 모두 바꾸려 하지 말고 risk를 붙입니다.

```text
R3: publish, signing, deploy, secret, permission change
R2: build artifact, image build, release note, dependency update
R1: test, lint, docs, formatting
```

R3부터 `$/` 전환 가능 여부, runner 2.336.0 이상, CODEOWNERS, full-length SHA pinning 정책과 충돌 여부를 봅니다. `./`에서 `$/`로 바꾸면 checkout 전제에 기대던 action이 깨질 수 있으므로 canary workflow를 먼저 둡니다. 전환 성공 기준은 "workflow가 성공했다"가 아니라 "실행된 action path와 caller commit이 audit log에서 일치한다"입니다.

### 2) Remote control policy를 device-first로 작성한다

remote control을 도입한다면 정책은 아래 순서로 잡는 편이 좋습니다.

1. production credential이 있는 장비는 managed device만 허용
2. unmanaged 장비는 remote control disabled
3. 민감 org는 SSO required
4. 세션 시작 시 repo, org, device id, policy version 기록
5. 퇴사, 분실, MDM unenroll 시 remote control revoke SLA 15분 이하

기능을 조직 전체에 켜기 전에 작은 pilot을 둡니다. 첫 2주는 read-only 또는 PR draft 중심으로 쓰고, merge, deploy, secret 접근은 차단합니다. remote control 자체보다 "어떤 장비에서 어떤 repo를 열었는지"가 보이는지 확인하는 것이 먼저입니다.

### 3) Agent session에는 workspace lease를 붙인다

worktree 기반 agent session이 늘어나면 같은 repo에서 여러 agent가 동시에 움직입니다. 이때 lease 없이 돌리면 같은 migration, 같은 generated file, 같은 feature flag를 서로 다르게 바꿀 수 있습니다.

간단한 lease 규칙:

| 리소스 | lease 기준 | 충돌 시 |
| --- | --- | --- |
| `migrations/**` | repo당 write session 1개 | 새 session 대기 |
| `infra/prod/**` | owner approval 필요 | 자동 수정 금지 |
| `package-lock.json` | dependency update session 1개 | stacked PR 분리 |
| shared test DB | namespace별 lease | 임시 DB 생성 또는 대기 |
| release branch | release manager lease | draft만 허용 |

lease는 복잡한 시스템일 필요가 없습니다. 처음에는 issue label, PR template, session ledger, CI check 조합으로도 충분합니다. 중요한 것은 agent가 "나는 어떤 공유 리소스를 잡고 있다"를 말하게 만드는 것입니다.

### 4) Evidence를 PR 단위가 아니라 workflow 단위로 남긴다

자동화가 강해질수록 evidence도 바뀌어야 합니다. PR diff만 보면 부족합니다. workflow가 어떤 action을 어느 commit에서 실행했는지, remote control이 어떤 device에서 열렸는지, agent가 어떤 worktree와 subagent를 사용했는지를 같이 봐야 합니다.

최소 evidence bundle:

- `workflow_run_id`
- `caller_ref`와 internal action resolved ref
- runner version
- device trust mode
- agent session id
- worktree id 또는 hash
- allowed/denied tool list
- approval id
- CI/test result
- rollback 또는 revert path

이 중 일부는 자동 수집하기 어렵습니다. 그래도 high-risk workflow와 agent write session부터 넣으면 됩니다. 증거가 없으면 리뷰어는 자동화를 믿거나 불신하는 것밖에 할 수 없습니다. 증거가 있으면 어떤 부분을 재검증해야 하는지 판단할 수 있습니다.

### 5) 정책 변경은 개발자 경험 지표와 같이 본다

trust boundary를 좁히면 마찰이 생깁니다. self-repository syntax 전환은 runner 업그레이드와 workflow 수정이 필요하고, managed device 제한은 개인 장비나 임시 환경 사용을 막을 수 있습니다. agent worktree lease는 병렬 작업을 잠깐 기다리게 만들 수 있습니다. 그래서 보안 지표만 보면 정책이 과해지기 쉽습니다.

같이 볼 지표:

- internal action ref mismatch 0건
- runner under version floor 0건
- remote control unmanaged device attempt 0건
- remote control session revoke p95 15분 이하
- agent session without evidence 0건
- lease conflict wait p95 30분 이하
- high-risk PR rework rate 10% 이하
- developer override request 주간 추세

정책의 목표는 개발자를 묶는 것이 아니라, 자동화가 실수했을 때 설명 가능한 경계를 남기는 것입니다. wait time이 너무 길면 gate를 줄이거나 owner를 늘리고, override가 많으면 정책이 현실과 안 맞는 것입니다.

## 트레이드오프/주의점

첫째, `$/` 전환은 단순 치환이 아닙니다. 기존 local action이 checkout된 workspace에 의존하거나 상대 경로로 파일을 읽는다면 동작이 달라질 수 있습니다. release workflow는 canary branch에서 먼저 실행하고, runner version과 resolved ref를 로그로 확인해야 합니다.

둘째, managed device 제한은 개인 장비 중심 문화와 부딪힐 수 있습니다. 하지만 원격 제어형 agent가 browser session, SSH key, cloud credential을 가진 host에서 움직이면 개인 생산성 도구가 아니라 endpoint 보안 표면입니다. production repo와 고객 데이터 repo부터 제한하고, 낮은 위험 repo는 pilot으로 열어두는 단계적 정책이 낫습니다.

셋째, worktree와 multi-session은 scope creep을 줄일 수도 있지만 늘릴 수도 있습니다. agent가 PR을 잘게 쪼개 주면 리뷰가 쉬워집니다. 반대로 사람이 승인하지 않은 다음 session이 계속 쌓이면 작은 PR 여러 개가 하나의 큰 위험 묶음이 됩니다. stacked session에는 merge order, rollback order, owner, risk path가 필요합니다.

넷째, built-in skill과 org instruction은 팀 표준을 확산시키지만 책임 소재를 흐릴 수 있습니다. 특정 리뷰 코멘트가 repo rule, org instruction, built-in skill, MCP context 중 무엇에서 왔는지 attribution이 없으면 고치기 어렵습니다. 자동화 품질을 올리려면 instruction도 코드처럼 version과 owner를 가져야 합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] high-risk workflow의 internal action/reusable workflow 참조를 목록화했다.
- [ ] runner 2.336.0 이상이 필요한 workflow와 self-hosted runner를 대조했다.
- [ ] `./` 또는 hardcoded ref를 쓰는 release/sign/deploy action에 전환 계획이 있다.
- [ ] Copilot remote control은 사용자 정책, org 정책, managed device 정책을 분리해 문서화했다.
- [ ] unmanaged device에서 production repo remote control은 기본 차단 또는 SSO required다.
- [ ] agent worktree session에는 session id, base ref, allowed tools, shared resource lease가 있다.
- [ ] subagent, multi-chat, stacked session 결과는 PR evidence와 연결된다.
- [ ] policy override에는 owner, reason, expiry, evidence가 남는다.

### 연습

현재 팀의 저장소 하나를 골라 아래 세 가지를 30분 안에 점검해 보세요.

1. `.github/workflows`에서 `uses: ./`, 같은 저장소 reusable workflow, branch ref를 찾고 R1/R2/R3 위험 등급을 붙입니다.
2. remote control 또는 background agent가 host할 수 있는 장비를 `managed`, `unmanaged`, `unknown`으로 나눕니다.
3. agent session이 동시에 2개 이상 돌 때 충돌할 수 있는 공유 리소스 5개를 적습니다.

결과 표에는 숫자를 넣습니다. 예를 들어 `R3 workflow 4개 중 3개가 local action`, `self-hosted runner 12개 중 5개가 version floor 미달`, `unmanaged remote control attempt 허용 0건 목표`, `lease conflict wait p95 30분 이하`처럼 적으면 실행 계획으로 바뀝니다. 오늘의 핵심은 새 기능을 바로 켜는 것이 아니라, 자동화가 강해진 만큼 실행 경계를 더 작고 명확하게 만드는 것입니다.
