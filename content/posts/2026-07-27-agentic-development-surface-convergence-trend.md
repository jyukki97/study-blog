---
title: "2026 개발 트렌드: Agentic Development Surface Convergence, 코딩 에이전트는 IDE·데스크톱·모바일·PR 화면을 오가는 작업 표면이 된다"
date: 2026-07-27T10:06:00+09:00
lastmod: 2026-07-27T11:30:00+09:00
draft: false
tags: ["AI Coding Agents", "Codex", "GitHub Copilot", "VS Code", "Developer Workflow", "Platform Engineering"]
categories: ["Development", "AI", "Platform Engineering"]
series: ["dev-trends"]
keywords: ["Codex app ChatGPT desktop", "GitHub Copilot VS Code parallel sessions", "remote Copilot CLI mobile notifications", "agentic development surface", "AI coding workflow governance"]
description: "OpenAI의 Codex/ChatGPT 데스크톱 통합, GitHub Copilot의 VS Code 병렬 세션과 비용 가시성, 모바일 CLI 알림 흐름을 바탕으로 코딩 에이전트 작업 표면이 어떻게 수렴하는지 정리합니다."
summary: "코딩 에이전트는 더 이상 하나의 채팅창이나 IDE 플러그인에 머물지 않습니다. 같은 작업이 데스크톱 앱, IDE, 원격 CLI, 모바일 알림, PR 리뷰 패널을 오가게 되면서 팀은 세션 소유권, 비용, 승인, 증거, 컨텍스트 이동 기준을 작업 단위로 설계해야 합니다."
key_takeaways:
  - "에이전트 개발 경험은 IDE 안 기능 경쟁에서 데스크톱, PR, 모바일, 원격 CLI를 잇는 작업 표면 경쟁으로 이동하고 있다."
  - "병렬 세션과 멀티 repo 지원은 생산성을 높이지만 session owner, file boundary, review queue, cost visibility가 없으면 충돌과 낭비를 키운다."
  - "모델 선택권이 넓어질수록 팀의 기본값은 최고 모델이 아니라 작업 등급별 routing, 예산, 승인, evidence contract가 되어야 한다."
operator_checklist:
  - "agent 작업마다 surface, repository, owner, model policy, cost cap, evidence ref를 기록한다."
  - "동시 agent 세션은 개인당 3개, repo당 2개 이하로 시작하고 reviewer queue p95를 같이 본다."
  - "모바일/원격 steering은 read-only 상태 확인과 승인 요청부터 열고, write나 merge는 별도 gate로 둔다."
  - "PR 리뷰 패널에서 agent 수정이 이어질 때는 기존 review comment, 테스트 결과, unresolved thread를 completion gate에 포함한다."
learning_refs:
  - title: "Agent Workbench"
    href: "/posts/2026-05-28-agent-workbench-operating-console-trend/"
    description: "여러 에이전트 세션을 운영 콘솔로 다루는 기본 관점입니다."
  - title: "Remote Agent Control Plane"
    href: "/posts/2026-05-22-remote-agent-control-plane-trend/"
    description: "모바일과 원격 표면에서 에이전트를 관제하는 기준입니다."
  - title: "Agent Session Ledger"
    href: "/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/"
    description: "에이전트 실행 로그와 비용을 운영 지표로 묶는 흐름입니다."
  - title: "IDE-native Agent Picker"
    href: "/posts/2026-07-02-ide-native-agent-picker-governance-trend/"
    description: "IDE 안 모델 선택과 조직 정책 기본값을 다루는 글입니다."
decision_guide:
  title: "agent 작업 표면을 어디까지 열어둘까"
  intro: "모든 표면을 한 번에 열면 편의성은 올라가지만 책임 경계가 흐려집니다. 처음에는 작업 위험도와 필요한 문맥 크기를 기준으로 표면을 나누는 편이 안전합니다."
  cases:
    - badge: "즉시 도입"
      title: "IDE와 PR 패널 중심의 single-repo patch"
      fit: "작은 버그 수정, 테스트 추가, 문서 보강처럼 변경 범위가 한 저장소와 명확한 파일 경계 안에 있을 때 적합합니다."
      watchouts: "동시 세션이 같은 모듈을 건드리면 작은 작업도 review queue와 CI queue를 막을 수 있습니다."
      next_step: "task id, owner, allowed paths, test command, unresolved review thread 기준을 PR 템플릿에 먼저 넣습니다."
    - badge: "점진 확대"
      title: "데스크톱 앱과 원격 CLI를 포함한 multi-surface 작업"
      fit: "작업 시간이 길고 IDE 밖에서 상태를 봐야 하며, 중간 checkpoint와 diff review가 필요한 경우에 유용합니다."
      watchouts: "surface가 늘수록 같은 세션의 최신 상태와 최종 승인 주체가 헷갈리기 쉽습니다."
      next_step: "session ledger와 checkpoint evidence를 만들고, 모바일은 status와 unblock만 허용합니다."
    - badge: "보수 관리"
      title: "multi-repo, 배포, 보안·권한 경로 변경"
      fit: "shared library와 consumer repo를 함께 고치거나 인증, 결제, production infra 파일을 다루는 고위험 작업입니다."
      watchouts: "작은 패치처럼 보여도 release coordination, owner approval, rollback 순서가 없으면 장애 반경이 커집니다."
      next_step: "repo별 owner, contract test, cost cap, approval id, rollback order를 manifest 필수 필드로 둡니다."
faqs:
  - question: "agentic development surface convergence는 단순히 IDE 플러그인이 많아진다는 뜻인가요?"
    answer: "아닙니다. 핵심은 같은 작업 세션이 IDE, 데스크톱 앱, PR 패널, 원격 CLI, 모바일 알림을 오가면서 이어진다는 점입니다. 그래서 UI 기능보다 task id, owner, 권한 경계, evidence가 더 중요해집니다."
  - question: "모바일에서 agent 작업을 승인해도 괜찮을까요?"
    answer: "처음에는 완료/실패 알림, 상태 확인, 중단, 낮은 위험의 계속 진행 정도로 제한하는 편이 좋습니다. diff 전체, 테스트 결과, 위험 경로, unresolved review thread를 충분히 볼 수 없는 표면에서는 merge, 배포, 권한 변경 승인을 열지 않는 것이 안전합니다."
  - question: "병렬 agent 세션은 몇 개부터 시작하는 게 현실적인가요?"
    answer: "초기값은 개인당 3개 이하, repo당 write session 2개 이하, 같은 모듈 write session 1개가 무난합니다. 이후에는 완료 건수보다 conflict rate, review wait p95, abandoned session, CI retry count를 보고 늘리는 편이 좋습니다."
---

2026년 7월 하순 개발 도구 릴리스의 공통점은 "더 똑똑한 모델"보다 "작업 표면의 이동"입니다. OpenAI는 ChatGPT 데스크톱 앱과 Codex 앱의 통합 흐름을 공개하며 diff 안 inline edit, PR review side panel, 여러 repository를 하나의 project에서 다루는 기능을 강조했습니다. GitHub는 VS Code의 Copilot 업데이트에서 integrated browser, parallel sessions, cost visibility, Marketplace model discovery, Autopilot 개선을 묶어 발표했습니다. GitHub Mobile은 remote Copilot CLI session의 live notification을 지원하고, 7월 24일에는 장기·복합 코딩 작업용 모델 옵션도 Copilot에 추가됐습니다.

따로 보면 제품별 기능 출시입니다. 같이 놓고 보면 코딩 에이전트가 더 이상 하나의 채팅창이나 IDE 플러그인에 갇혀 있지 않다는 신호입니다. 같은 작업이 데스크톱 앱에서 시작되고, IDE에서 diff를 고치고, PR 패널에서 리뷰 의견을 반영하고, CLI 세션은 모바일 알림으로 상태를 보내며, 모델은 작업 성격에 따라 바뀝니다. 저는 이 흐름을 **Agentic Development Surface Convergence**라고 부르겠습니다.

이 글은 [Agent Workbench](/posts/2026-05-28-agent-workbench-operating-console-trend/), [Remote Agent Control Plane](/posts/2026-05-22-remote-agent-control-plane-trend/), [Agent Session Ledger](/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/), [IDE-native Agent Picker](/posts/2026-07-02-ide-native-agent-picker-governance-trend/)와 이어집니다. 오늘의 질문은 "어떤 에이전트가 제일 좋은가"가 아니라, **한 작업이 여러 표면을 오갈 때 소유권, 비용, 승인, 증거를 어떻게 잃지 않을 것인가**입니다.

참고한 공식 신호:

- OpenAI, ChatGPT desktop and Codex workflow update: https://openai.com/index/chatgpt-for-your-most-ambitious-work/
- OpenAI, Introducing the Codex app: https://openai.com/index/introducing-the-codex-app/
- GitHub Changelog, Copilot in VS Code June 2026 releases: https://github.blog/changelog/2026-07-08-github-copilot-in-visual-studio-code-june-2026-releases/
- GitHub Changelog, Mobile live notifications for Copilot CLI sessions: https://github.blog/changelog/2026-07-08-github-mobile-live-notifications-for-copilot-cli-sessions/
- GitHub Changelog, Claude Opus 5 in Copilot: https://github.blog/changelog/2026-07-24-claude-opus-5-is-now-available-in-github-copilot/

## 이 글에서 얻는 것

- 코딩 에이전트 경험이 IDE 기능에서 데스크톱, PR, 모바일, 원격 CLI를 잇는 작업 표면으로 이동하는 이유를 이해합니다.
- 병렬 세션, 멀티 repo, PR review side panel, 모바일 알림이 팀 운영에 만드는 새 기준을 정리합니다.
- agent 작업을 surface, owner, model policy, cost cap, evidence ref로 관리하는 체크리스트를 가져갑니다.
- 모델 선택권 확대를 생산성 기능이 아니라 routing과 governance 문제로 보는 기준을 잡습니다.

## 핵심 개념/이슈

### 1) 에이전트의 기본 단위는 대화가 아니라 작업 세션이다

채팅창 중심 도구에서는 사용자가 한 대화 안에서 질문하고 답을 받았습니다. 하지만 지금의 코딩 에이전트는 작업이 길고, 여러 파일을 바꾸고, 테스트를 돌리고, PR 코멘트를 읽고, 다시 수정합니다. 이 경우 대화 메시지 순서보다 중요한 것은 작업 세션의 상태입니다.

세션에는 최소 아래 정보가 붙어야 합니다.

```yaml
agent_task_session:
  task_id: "AUTH-842"
  owner: "backend-platform"
  surfaces: ["desktop", "vscode", "github-pr", "mobile-notification"]
  repositories: ["auth-api", "shared-security-lib"]
  model_policy: "auto-with-high-risk-approval"
  cost_cap: "team-default-small-fix"
  write_boundary:
    allowed_paths: ["auth-api/src/**", "auth-api/tests/**"]
    blocked_paths: ["infra/prod/**", "billing/**"]
  evidence_required:
    - "diff_summary"
    - "test_result"
    - "review_comment_resolution"
```

이런 구조가 없으면 사용자는 어디서 작업을 시작했는지 기억하지만, 팀은 무엇이 실제로 진행 중인지 모릅니다. 데스크톱 앱, IDE, PR 화면, 모바일 알림이 모두 같은 task id를 공유해야 합니다.

### 2) 병렬 세션은 생산성보다 queue 관리 문제를 먼저 만든다

VS Code와 Codex 계열 흐름은 여러 agent 작업을 병렬로 다루는 쪽으로 가고 있습니다. 병렬은 매력적입니다. 문서 정리, 테스트 추가, 작은 버그 수정, 리팩터링 후보를 동시에 던질 수 있습니다. 하지만 병렬 세션은 곧 충돌과 review queue를 만듭니다.

실무 시작값은 보수적으로 잡는 편이 좋습니다.

| 범위 | 시작 기준 | 이유 |
| --- | ---: | --- |
| 개인당 동시 active agent session | 3개 이하 | 컨텍스트 전환과 승인 누락 방지 |
| repo당 동시 write session | 2개 이하 | 같은 파일 충돌과 CI queue 보호 |
| 같은 모듈 동시 write session | 1개 | merge conflict와 테스트 원인 혼동 방지 |
| agent PR review 대기 p95 | 1영업일 이하 | 자동화가 backlog로 변하는 것 방지 |
| session idle timeout | 30~60분 | 잊힌 세션 비용과 stale diff 감소 |

병렬 수를 늘리기 전에 봐야 할 것은 완료 PR 수가 아니라 `conflict rate`, `review wait p95`, `abandoned session`, `CI retry count`, `human correction time`입니다. [Agentic Capacity SLO](/posts/2026-06-29-agentic-capacity-slo-trend/)에서 말한 것처럼 에이전트 작업은 runner, reviewer, credit, queue를 함께 소비합니다.

### 3) PR review side panel은 에이전트 작업을 코드 생성에서 리뷰 루프로 옮긴다

PR 패널 안에서 리뷰 의견을 보고, diff를 고치고, unresolved thread를 확인하는 흐름은 중요합니다. 에이전트의 일이 "코드 초안 생성"에서 끝나지 않고, 사람 리뷰를 이해하고 반영하는 단계로 들어오기 때문입니다. 이때 완료 조건도 바뀌어야 합니다.

단순 completion 기준:

- 파일 수정 완료
- 테스트 일부 통과
- PR 생성

운영 가능한 completion 기준:

- unresolved review thread 0개 또는 명시적 보류 사유
- 변경 파일과 요구사항 매핑
- 실패한 테스트와 미실행 테스트 목록
- 리뷰 코멘트별 처리 결과
- 보안/권한/결제 경로 변경 시 owner 승인
- 기존 PR discussion을 깨지 않았다는 근거

에이전트가 PR 코멘트를 읽고 수정할 수 있게 되면 속도는 올라갑니다. 동시에 "리뷰어가 지적한 의도"를 잘못 이해하고 표면적으로만 수정하는 위험도 생깁니다. 따라서 리뷰 반영은 diff 자체보다 comment resolution evidence가 중요합니다.

### 4) 모바일 알림과 원격 steering은 write 권한이 아니라 attention routing이다

GitHub Mobile의 remote Copilot CLI session notification 흐름은 개발자가 터미널 앞에 없어도 에이전트 상태를 확인하고, 막힌 지점에서 다시 개입할 수 있게 합니다. 이 기능의 핵심은 "휴대폰에서 코딩한다"가 아닙니다. 더 정확히는 사람의 attention을 필요한 순간에 routing하는 기능입니다.

처음 열어도 되는 범위:

- 세션 시작/완료/실패/입력 필요 알림
- diff summary 확인
- 테스트 실패 요약 확인
- read-only follow-up prompt
- 계속 진행 또는 중단 같은 낮은 위험 steering

처음부터 조심해야 할 범위:

- PR merge
- 배포 승인
- 권한 변경
- 외부 전송
- billing, auth, production infra 파일 수정 승인

모바일 표면은 편하지만 실수 비용도 큽니다. 작은 화면에서는 diff 문맥이 줄어들고, 이동 중 승인 판단이 느슨해질 수 있습니다. 그래서 모바일은 high-risk write approval보다 read-only 상태 확인과 unblock에 먼저 쓰는 편이 안전합니다.

### 5) 모델 선택권 확대는 routing policy를 요구한다

GitHub Copilot에 새 모델 옵션이 들어오고, VS Code가 Marketplace model discovery와 비용 가시성을 강조하는 흐름은 개발자에게 선택권을 줍니다. 하지만 팀 운영에서는 "아무나 좋은 모델을 고른다"가 아니라 작업 등급별 routing policy가 필요합니다.

예시 기준:

| 작업 등급 | 기본 모델 정책 | 추가 gate |
| --- | --- | --- |
| 문서 요약, 영향 분석 | 저비용 또는 auto | read-only |
| 테스트 추가, 작은 버그 수정 | 균형형 모델 | 파일 boundary |
| 복잡한 리팩터링 | 고성능 모델 허용 | plan approval, cost cap |
| 보안/권한/결제 경로 | 자동 적용 금지 | owner review |
| 장기 multi-repo 작업 | 세션별 모델 고정 | checkpoint와 evidence 필수 |

최고 모델을 항상 쓰는 팀보다, 작업 위험도와 비용을 기준으로 모델을 배치하는 팀이 오래 갑니다. 모델 선택은 개인 취향이 아니라 capacity와 risk의 배분입니다.

## 실무 적용

### 1) agent task manifest를 도입한다

여러 표면을 오가는 작업에는 manifest가 필요합니다. 거창한 시스템이 아니어도 됩니다. PR 템플릿, issue field, YAML, 내부 dashboard 어느 쪽이든 아래 필드는 있어야 합니다.

```yaml
agent_task_manifest:
  task_id: "WEB-1291"
  source_issue: "https://github.com/org/repo/issues/1291"
  primary_surface: "vscode"
  allowed_secondary_surfaces: ["desktop", "github-pr", "mobile-readonly"]
  repositories:
    - name: "web-app"
      write_limit: "src/components/**, tests/**"
  session_limits:
    max_parallel_subtasks: 2
    idle_timeout_minutes: 45
    max_cost_class: "medium"
  completion_gate:
    tests: ["npm test -- changed"]
    review_threads: "all_resolved_or_deferred"
    evidence_refs: ["diff_summary", "test_output"]
```

manifest의 목적은 bureaucracy가 아닙니다. 작업이 어디서 이어져도 같은 경계를 유지하게 만드는 것입니다.

### 2) surface별 권한을 다르게 둔다

모든 표면에 같은 권한을 주면 가장 약한 표면이 전체 경계가 됩니다. 데스크톱, IDE, CLI, 모바일, PR 패널은 역할이 다릅니다.

| Surface | 권장 시작 권한 |
| --- | --- |
| IDE | 제한된 write, 테스트 실행, local diff |
| Desktop agent app | multi-session 관리, diff review, plan |
| PR panel | review comment 해석, patch 제안 |
| Remote CLI | 명시적 repo/session 안 실행 |
| Mobile | read-only status, unblock, low-risk stop/continue |

권한 우선순위는 **IDE/로컬 검증 > PR evidence > 데스크톱 orchestration > 모바일 steering**입니다. 모바일은 빠른 결정에 좋지만, 고위험 최종 승인은 더 넓은 문맥을 볼 수 있는 표면으로 돌리는 편이 낫습니다.

### 3) 충돌과 방치 세션을 운영 지표로 본다

agent surface convergence의 성숙도는 기능 수가 아니라 운영 지표로 봐야 합니다.

- `active_agent_sessions_by_repo`
- `same_file_conflict_rate`
- `abandoned_session_count`
- `mobile_unblock_latency_p95`
- `review_thread_resolution_rate`
- `agent_pr_rework_hours`
- `cost_per_merged_agent_pr`
- `session_without_evidence_count`

초기 경보 기준은 간단하게 시작합니다. repo당 active write session이 2개를 넘으면 owner 확인, abandoned session이 하루 5건 이상이면 idle timeout 조정, session without evidence는 0건 목표로 둡니다. 비용 지표는 [Agent Session Ledger](/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/) 기준과 연결하면 됩니다.

### 4) multi-repo 작업은 dependency boundary부터 고정한다

여러 repository를 한 project에서 다루는 기능은 강력합니다. API 서버, shared library, frontend client를 함께 고칠 수 있기 때문입니다. 하지만 multi-repo는 잘못 쓰면 변경 범위가 빠르게 커집니다.

multi-repo agent 작업을 열 조건:

- 변경 이유가 같은 issue 또는 ADR로 묶여 있다.
- repo별 owner가 확인됐다.
- contract test 또는 integration test가 있다.
- shared library 변경이 consumer repo에서 검증된다.
- rollback 순서가 repo별로 적혀 있다.

반대로 "관련 있어 보인다" 수준이면 single repo부터 시작하는 것이 낫습니다. multi-repo 작업은 생산성 기능이 아니라 release coordination 기능입니다.

### 5) surface handoff는 작은 인수인계 문서로 다룬다

표면이 수렴한다는 말은 한 사람이 여러 앱을 쓴다는 뜻만이 아닙니다. 실제로는 한 작업의 판단 근거가 표면 사이를 이동합니다. 데스크톱 앱에서 만든 plan이 IDE diff로 바뀌고, IDE에서 실패한 테스트가 PR 코멘트의 맥락이 되며, 원격 CLI의 blocked 상태가 모바일 알림으로 올라옵니다. 이때 handoff 정보가 부족하면 다음 표면은 최신 상태를 보는 듯하지만, 실제로는 이전 표면에서 생긴 제약을 잃어버립니다.

실무에서는 표면 전환마다 아래 6가지만 남겨도 효과가 큽니다.

| Handoff 필드 | 왜 필요한가 | 예시 |
| --- | --- | --- |
| `current_state` | 다음 표면이 지금 무엇을 이어받는지 알기 위해 | `tests failing: AuthTokenRotationTest` |
| `last_human_decision` | 사람이 이미 정한 경계를 반복 협상하지 않기 위해 | `billing path 변경 금지` |
| `open_questions` | agent가 추측으로 메우는 구간을 줄이기 위해 | `legacy token 만료 정책 확인 필요` |
| `risk_paths` | 작은 화면이나 PR 패널에서 놓치기 쉬운 파일을 표시하기 위해 | `.github/workflows/**`, `infra/prod/**` |
| `evidence_refs` | 테스트, diff, 리뷰 처리 결과를 다시 찾기 위해 | `ci-run-1842`, `review-thread-7` |
| `next_allowed_actions` | 표면별 허용 동작을 명확히 하기 위해 | `mobile: stop/continue only` |

이 정보는 별도 플랫폼이 없어도 PR 본문, issue comment, 세션 로그, 작업 manifest 중 하나에 넣을 수 있습니다. 중요한 것은 형식보다 지속성입니다. "방금 IDE에서 봤으니 괜찮다"는 기억은 모바일 알림이나 PR side panel로 넘어가면 쉽게 사라집니다.

특히 고위험 작업에서는 handoff가 승인 장치의 일부가 됩니다. 모바일에서 `continue`를 누를 수 있더라도 `next_allowed_actions`에 `merge`가 없으면 병합할 수 없어야 합니다. PR 패널에서 리뷰 코멘트를 해결할 수 있더라도 `risk_paths`에 포함된 파일을 고치려면 owner approval을 다시 요구해야 합니다. 이렇게 해야 surface convergence가 "어디서든 할 수 있음"이 아니라 "어디서 이어가도 같은 경계를 지킴"으로 작동합니다.

## 트레이드오프/주의점

첫째, 표면이 늘면 책임이 흐려집니다. IDE에서 시작한 작업을 데스크톱 앱에서 이어가고, 모바일에서 승인하고, PR에서 수정하면 "누가 최종 상태를 봤는가"가 애매해질 수 있습니다. 그래서 session owner와 completion gate가 필요합니다.

둘째, 병렬 작업은 평균 속도를 높이지만 tail risk를 키웁니다. 세션 5개가 동시에 돌아가도 리뷰어가 1명이라면 병목은 사람에게 이동합니다. 자동화가 많아질수록 reviewer queue와 CI queue를 먼저 봐야 합니다.

셋째, 모델 선택권은 비용과 품질 편차를 만듭니다. 복잡한 작업에 고성능 모델을 쓰는 것은 합리적이지만, 모든 문서 수정에 고비용 모델을 쓰면 team budget이 빠르게 소진됩니다. 반대로 고위험 보안 변경을 저비용 모델에 맡기는 것도 좋지 않습니다.

넷째, 모바일 steering은 편하지만 의사결정 문맥이 작습니다. 승인 버튼을 누르기 전에 diff, 테스트, 위험 경로, unresolved comment를 볼 수 없으면 그 표면에서는 승인하지 않는 것이 맞습니다.

다섯째, 여러 표면이 같은 작업을 다루면 로그와 보존 정책도 복잡해집니다. prompt, diff, terminal output, PR comment, mobile notification이 서로 다른 시스템에 저장될 수 있습니다. 개인정보와 내부 코드 보존 기간을 표면별로 분리해야 합니다.

의사결정 우선순위는 **작업 소유권 > 권한 경계 > evidence > reviewer capacity > 비용 > 표면 편의성**입니다. 편한 UI보다 작업이 어디서 어떻게 끝났는지 설명할 수 있는 능력이 먼저입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] agent 작업마다 task id, owner, repository, surface 목록이 있다.
- [ ] 개인당 동시 active session과 repo당 write session 상한이 있다.
- [ ] 모바일 표면은 read-only status와 unblock부터 시작한다.
- [ ] PR 리뷰 코멘트 반영은 unresolved thread와 evidence 기준으로 완료 판정한다.
- [ ] multi-repo 작업은 repo별 owner와 contract test가 있을 때만 허용한다.
- [ ] model policy가 작업 등급, 위험도, cost cap과 연결되어 있다.
- [ ] abandoned session과 session without evidence를 운영 지표로 본다.
- [ ] surface별 prompt/diff/log 보존 기간과 접근 권한이 분리돼 있다.

### 연습

팀에서 agent에게 맡기고 싶은 작업 5개를 고릅니다. 각 작업을 `read-only analysis`, `single-repo patch`, `PR review fix`, `multi-repo change`, `high-risk change`로 분류하세요. 그다음 작업마다 허용 surface, 최대 병렬 수, 모델 정책, cost cap, completion evidence를 한 줄씩 적습니다. 마지막으로 모바일에서 허용할 action을 `status`, `continue`, `stop`, `approve write`, `merge`로 나눠 표시합니다. 대부분의 팀은 이 표를 만든 뒤에야 "우리가 에이전트를 어디까지 믿는가"가 아니라 "어떤 표면에서 어떤 결정을 허용할 것인가"를 토론하게 됩니다.

## 관련 글

- [Agent Workbench, 코딩 에이전트 운영 콘솔](/posts/2026-05-28-agent-workbench-operating-console-trend/)
- [Remote Agent Control Plane](/posts/2026-05-22-remote-agent-control-plane-trend/)
- [Agent Session Ledger](/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/)
- [IDE-native Agent Picker](/posts/2026-07-02-ide-native-agent-picker-governance-trend/)
- [Agentic Capacity SLO](/posts/2026-06-29-agentic-capacity-slo-trend/)
