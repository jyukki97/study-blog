---
title: "2026 개발 트렌드: AI가 만든 큰 변경을 Reviewable Stack으로 쪼개는 팀이 리뷰 병목을 줄인다"
date: 2026-10-08T10:06:00+09:00
lastmod: 2026-10-08T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "Stacked Pull Requests", "Code Review", "Git Workflow", "Developer Productivity", "Engineering Governance"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["stacked pull requests", "AI generated pull request", "reviewable stack", "agentic code review", "change decomposition"]
description: "AI 코딩 에이전트가 만드는 대형 diff를 의존성이 보이는 작은 PR stack으로 나누고, 검증·리뷰·merge·rollback 기준을 운영 계약으로 만드는 방법을 정리합니다."
summary: "에이전트 시대의 병목은 코드 생성이 아니라 의도와 영향 범위를 검증하는 리뷰다. Stacked PR은 큰 작업을 여러 branch로 숨기는 방식이 아니라, 각 변경의 선행 조건·증거·되돌림 단위를 리뷰 가능한 순서로 만드는 변경관리 계약이다."
key_takeaways:
  - "Stacked PR의 목적은 PR 수를 늘리는 것이 아니라, 리뷰어가 한 번에 판단해야 할 가설과 위험 범위를 줄이는 데 있다."
  - "각 stack에는 순서, 의존성, non-goal, 테스트 증거, merge·rollback 조건이 있어야 한다."
  - "처음에는 낮거나 중간 위험의 변경만 3~5개 이하 stack으로 운영하고, review time·rework·revert 지표로 효과를 판단해야 한다."
operator_checklist:
  - "stack ID, 순서, base branch, 의존 PR, owner, risk label, 변경 의도를 PR 본문에 적는다."
  - "각 PR은 독립적으로 빌드·정적 검사를 통과하고, stack head에서 통합·회귀 시험을 다시 실행한다."
  - "migration·권한·결제·공개 API 변경은 expand/contract 및 별도 owner approval 없이는 stack으로 자동 분할하지 않는다."
  - "merge 뒤 dependency rebase, CI 재실행, rollback 책임을 automation과 runbook에 포함한다."
---

AI 코딩 에이전트가 한 번에 많은 파일을 읽고 수정할 수 있게 되면서, “코드를 생성할 수 있는가”보다 “누가 그 변경을 이해하고 승인할 수 있는가”가 더 큰 제약이 됐습니다. 최근 GitHub Engineering도 [거대한 AI 생성 PR을 reviewable stack으로 바꾸는 방법](https://github.blog/engineering/turn-one-giant-ai-generated-pull-request-to-a-reviewable-stack/)을 다루며, 하나의 읽기 어려운 diff 대신 의존성이 드러난 순서형 PR 묶음을 제안했습니다. 이 흐름은 새 Git UI의 문제가 아니라 코드 생성 속도와 사람의 검증 대역폭이 달라진 결과입니다.

Stacked PR은 큰 기능을 임의로 잘라 PR 수만 늘리는 방식이 아닙니다. 각 PR이 “이 단계에서만 판단할 가설”, “이전 단계에 의존하는 이유”, “실패하면 어디까지 되돌릴지”를 가지도록 만드는 변경 계약입니다. [Agentic PR Governance](/posts/2026-05-25-agentic-pr-governance-trend/), [AI PR Review Backlog OS](/posts/2026-05-14-ai-pr-review-backlog-os-trend/), [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/), [Rust Compiler Performance CI Change Budget](/posts/2026-10-01-rust-compiler-performance-ci-change-budget-trend/)의 문제의식도 결국 같은 방향을 가리킵니다. 생성량을 통제하지 않으면 review queue와 CI 비용이 숨은 병목이 됩니다.

## 이 글에서 얻는 것

- 대형 AI 생성 PR을 실제 리뷰 가능한 stack으로 분해하는 기준을 배웁니다.
- 각 PR에 필요한 의존성·non-goal·검증·rollback 계약을 정의할 수 있습니다.
- 단일 PR 검사와 stack head 통합 검사를 어떻게 나눌지 이해합니다.
- stack이 오히려 복잡도를 늘리는 상황과 도입을 멈춰야 할 지표를 구분합니다.

## 핵심 개념/이슈

### 1) stack의 단위는 파일 수가 아니라 “리뷰 판단 하나”다

한 PR이 20개 파일을 바꿔도 하나의 명확한 질문만 답한다면 읽을 수 있습니다. 반대로 파일 세 개라도 schema 변경, 권한 정책, UI 동작, 배포 설정이 섞이면 리뷰어는 여러 위험 모델을 동시에 복원해야 합니다. AI agent가 만든 대형 diff가 특히 어려운 이유는 변경량보다 **의도 추론 비용**이 큽니다. 최종 코드는 보이지만, agent가 어떤 대안을 버렸는지와 어느 경계를 임의로 해석했는지는 보이지 않을 수 있습니다.

좋은 stack은 기능을 다음처럼 의존 순서로 나눕니다.

| 순서 | 변경 예시 | 리뷰 질문 | merge 뒤 상태 |
| --- | --- | --- | --- |
| 1 | contract·fixture·관측 필드 추가 | 기존 동작을 깨지 않고 측정 가능한가 | 새 경로는 아직 비활성 |
| 2 | domain model·adapter 추가 | 책임 경계와 오류 처리가 맞는가 | compatibility 유지 |
| 3 | 새 read/write 경로를 flag 뒤에 연결 | 입력·권한·idempotency가 맞는가 | canary 가능 |
| 4 | migration/backfill 또는 traffic 전환 | 데이터·SLO·rollback이 안전한가 | 제한 rollout |
| 5 | 오래된 경로 제거 | 실제 사용자가 없는가 | cleanup 완료 |

이 순서는 [온라인 schema 변경의 expand/contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)과 닮았습니다. 새 구조를 먼저 추가하고, 읽기·쓰기 경로를 점진적으로 옮긴 뒤, 관측 기간이 끝난 후 제거합니다. 단, 모든 작업을 5개 PR로 강제하면 안 됩니다. 문서 오탈자나 한 함수의 null check는 stack이 아니라 단일 PR이 더 낫습니다.

### 2) 의존성은 branch 이름이 아니라 PR 본문에서 설명돼야 한다

`feature/payment-2`라는 branch 이름만으로는 1번 PR이 merge되지 않았을 때 2번이 왜 성립하지 않는지 알 수 없습니다. agent가 만든 stack은 reviewer, CI, release manager가 모두 읽을 수 있는 작은 manifest를 각 PR에 붙이는 편이 안전합니다.

```yaml
change_stack:
  id: orders-export-v2
  position: 2_of_4
  depends_on: ["#1841"]
  intent: "새 export format의 domain contract와 parser를 추가한다"
  non_goals:
    - "기존 export endpoint 전환"
    - "DB schema 삭제"
  risk: medium
  rollback: "feature flag off; PR #1841의 additive schema는 유지"
  validation:
    focused: "./gradlew test --tests ExportParserTest"
    required_at_stack_head: "./gradlew integrationTest"
```

이 정보가 있으면 reviewer는 “이 PR이 완결된 제품 기능인가”가 아니라 “이 순서의 2단계가 약속한 범위에 머무는가”를 판단할 수 있습니다. `non_goals`는 특히 중요합니다. 에이전트가 요구사항의 빈칸을 채우며 unrelated refactor, configuration 정리, dependency upgrade를 끼워 넣는 일을 줄입니다. manifest는 긴 작업 일지가 아니라 의도와 경계를 복원할 최소 증거입니다.

### 3) 작은 PR도 전체 검증을 면제받지는 않는다

stack을 쓰면 각 PR의 CI가 짧아질 거라고 기대하기 쉽습니다. 하지만 leaf PR만 unit test를 통과하고, 마지막 PR에서만 integration failure가 드러나면 실패를 뒤로 미룬 것뿐입니다. 검증은 **국소 증거**와 **누적 증거**로 나눠야 합니다.

| 검증 층 | 실행 시점 | 최소 내용 |
| --- | --- | --- |
| PR-local | 모든 PR | build, formatter, lint, 변경 영역 unit/contract test, secret scan |
| dependency-aware | base가 바뀌거나 rebase 뒤 | 대상 PR과 선행 PR을 합친 test shard |
| stack head | 새 PR 추가·merge 직전 | integration/e2e, migration compatibility, performance smoke |
| release | canary 전 | deploy artifact, feature flag, rollback, SLO 확인 |

예를 들어 API field를 추가하는 첫 PR은 consumer contract fixture와 backward compatibility test를 통과해야 합니다. 두 번째 PR에서 새 field를 사용하는 client code를 붙였다면, 두 PR을 합친 상태의 contract test가 필요합니다. 마지막 cleanup PR은 production telemetry에서 이전 field 소비가 0인지 확인하기 전에는 merge해도 삭제를 실행해서는 안 됩니다. 이렇게 보면 stacked PR은 test를 줄이는 기법이 아니라, **어떤 증거가 어느 단계에서 필요한지 드러내는 기법**입니다.

## 실무 적용

### 1) 첫 적용 범위는 작고 되돌릴 수 있는 작업으로 제한한다

처음부터 모든 agent task를 stack으로 만들면 branch 관리와 rebase가 새 혼잡이 됩니다. 첫 2주에는 low 또는 medium risk 작업 중 다음 조건을 만족하는 것만 선택하는 편이 좋습니다.

- 예상 변경이 3~5개의 논리 단계로 나뉘고, 각 단계의 의존성이 설명된다.
- 전체 diff가 1,000줄을 넘을 것으로 예상되지만, 각 PR은 보통 **150~350 의미 있는 변경 줄** 안에 들어간다.
- 한 PR을 읽고 primary reviewer가 **20~30분 안에** 핵심 질문을 적을 수 있다.
- stack 깊이가 **5개 이하**이며, 각 단계가 독립된 rollback 또는 flag boundary를 가진다.
- DB 삭제, 인증·인가 정책 변경, 결제 확정, 비밀값, 공개 API breaking change는 owner의 설계 승인 전에는 자동 분할하지 않는다.

숫자는 조직의 절대 규칙이 아니라 review budget의 시작점입니다. 350줄이 넘어도 자동으로 나쁜 PR은 아니지만, 800줄을 넘거나 reviewer가 “무엇부터 봐야 할지 모르겠다”고 말하면 stack을 다시 자를 신호입니다. 한 단계가 10줄밖에 안 되는데 별도 PR이라면 반대로 인위적 분할일 수 있습니다.

### 2) agent의 작업 지시에는 “구현”뿐 아니라 stack plan을 요구한다

AI agent에게 “이 issue를 고쳐라”만 주면 생성 속도에 따라 하나의 거대 diff가 나올 가능성이 큽니다. 구현 전에 변경 그래프를 제안하게 하고, 사람이 순서와 위험을 확인한 뒤 branch 작업을 시작하게 합니다. 이때 agent가 설계 결정을 확정하는 것이 아니라, review할 수 있는 분할안을 만드는 역할을 합니다.

```text
1. issue의 acceptance criteria와 변경 금지 범위를 요약한다.
2. 최대 5개 PR로 stack plan을 제안한다.
3. 각 PR에 intent, dependency, non-goal, risk, focused test, rollback을 적는다.
4. high-risk boundary가 있으면 구현 대신 설계 질문으로 멈춘다.
5. 각 PR을 draft로 열고 stack head의 통합 검증 결과를 갱신한다.
```

PR template만으로 충분하지 않을 수 있습니다. CODEOWNERS, path label, migration detector, secret scan, required check가 manifest와 모순될 때 merge를 막아야 합니다. 예를 들어 `risk: low`인데 `db/migration/**`를 수정했다면 label을 자동으로 `high`로 올리고 owner review를 요구합니다. 에이전트의 self-report는 출발점이지 policy enforcement를 대체하지 않습니다.

### 3) merge 순서와 rebase 비용을 운영한다

stack의 아래 PR이 merge되면 위 PR은 base branch를 바꾸거나 retarget해야 합니다. 이 과정을 사람이 매번 수동으로 하면 PR 개수만큼 merge conflict가 생기고, review 당시의 test result가 낡습니다. stack 도구나 CI automation을 쓰지 않더라도 다음 상태는 추적해야 합니다.

| 이벤트 | 자동화 또는 담당자 행동 | 완료 기준 |
| --- | --- | --- |
| base PR merge | 다음 PR을 새 base로 rebase/retarget | diff가 의도 밖으로 변하지 않음 |
| rebase 완료 | PR-local check와 dependency-aware test 재실행 | 새 commit SHA에 evidence 연결 |
| stack head fail | 원인 PR 식별, 아래 단계부터 수정 | 실패를 마지막 PR에 숨기지 않음 |
| 중간 PR revert | 의존 PR draft 전환 또는 닫기 | dangling branch·잘못된 base 없음 |
| final merge | feature flag·cleanup due date 등록 | rollout owner와 rollback 책임 명확 |

특히 rebase 뒤에는 “앞서 리뷰했다”는 사실만으로 merge하면 안 됩니다. conflict resolution이 새 행동을 추가할 수 있기 때문입니다. 최소한 diff summary와 변경된 test 결과를 reviewer에게 다시 제시해야 합니다. [행동 계약 기반 runtime rewrite](/posts/2026-09-27-agent-assisted-runtime-rewrite-behavioral-contract-trend/)에서 강조한 것처럼, 생성 주체가 무엇이든 최종 검증 대상은 agent의 설명이 아니라 실제 artifact입니다.

### 4) 효과는 생성 PR 수가 아니라 review health로 측정한다

stack 도입 후 PR 수가 늘면 대시보드상 throughput이 좋아 보일 수 있습니다. 그러나 reviewer가 더 자주 context switch하고 CI가 더 많이 돌아서 lead time이 늘었다면 실패입니다. 다음 지표를 기존 대형 PR 방식과 2~4주 비교합니다.

| 지표 | 좋아지는 방향 | 악화 시 해석 |
| --- | --- | --- |
| first-review latency | 감소 | stack 알림·owner assignment·PR 수 과다 확인 |
| reviewer active time | 감소 또는 유지 | 너무 작은 PR의 context switching 점검 |
| review comment rework rate | 감소 | 분할이 의도를 명확히 하지 못했는지 조사 |
| stack-head failure rate | 초기에는 관측 후 감소 | 국소 test가 통합 실패를 놓치는지 확인 |
| merge 후 revert/reopen rate | 증가하지 않음 | 작은 diff가 실제 위험을 감추는지 검토 |
| median stack age | 제한 안에 유지 | base drift와 merge queue 병목 확인 |

초기에는 stack-head failure가 발견되는 것이 실패만은 아닙니다. 마지막에야 발견되던 통합 문제를 어느 단계에서 볼지 드러냈다는 뜻일 수 있습니다. 다만 4주 뒤에도 failure가 계속 마지막 PR에 몰리면, plan이나 contract test가 잘못된 것입니다. 지표는 agent PR만 따로 보되 사람 PR과 비교해 불필요한 차별 대신 process 개선으로 이어져야 합니다.

## 트레이드오프/주의점

Stacked PR은 branch·CI·review notification을 늘립니다. 작은 변경에까지 적용하면 reviewer는 같은 문제를 여러 번 읽고, CI는 거의 같은 테스트를 반복하며, base drift가 늘어납니다. 따라서 “PR은 작을수록 좋다”가 아니라 **한 번의 review에서 검증 가능한 위험 모델 하나가 좋다**가 원칙입니다.

원자성이 필요한 변경도 있습니다. feature flag가 없는 보안 hotfix, 컴파일을 깨는 protocol rename, 반드시 동시에 바뀌어야 하는 generated code와 schema처럼 중간 상태를 merge할 수 없는 작업은 stack보다 하나의 잘 검증된 PR이나 release branch가 안전합니다. 무중단 migration은 여러 단계가 필요하지만, 그 단계들이 production에 독립적으로 안전한지부터 증명해야 합니다.

stack은 approval laundering 수단이 되어서는 안 됩니다. “각 PR은 작았으니 전체 영향도 안전하다”는 결론은 틀릴 수 있습니다. 같은 stack의 여러 PR이 합쳐져 권한 범위를 넓히거나 비용을 키우거나 data migration을 영구화할 수 있습니다. stack head와 release 단계에서 **전체 변경의 위험**을 다시 판단해야 합니다.

## 체크리스트 또는 연습

- [ ] stack의 각 PR에 ID, 순서, dependency, intent, non-goal, risk, rollback, focused test가 있다.
- [ ] 각 PR은 독립적으로 build·정적 검사·변경 영역 test를 통과한다.
- [ ] stack head에서는 integration/e2e와 migration·contract compatibility를 다시 검증한다.
- [ ] 5개를 넘는 stack 또는 800줄 이상의 단일 단계는 분할 이유를 재검토한다.
- [ ] migration, authz, 결제, secret, 공개 API breaking change는 owner 승인과 별도 release 계획이 있다.
- [ ] base merge/rebase 뒤 새 commit SHA에 테스트 증거가 다시 연결된다.
- [ ] PR 수가 아니라 first-review latency, rework, stack-head failure, revert, stack age로 성공을 판단한다.

연습으로 최근 “리뷰하기 어렵다”는 평가를 받은 PR 하나를 골라 보세요. 변경을 contract/fixture, domain·adapter, flag 연결, rollout, cleanup 순서로 나눌 수 있는지 적습니다. 각 단계에 non-goal 하나와 rollback 하나를 붙인 뒤, 어느 단계가 독립적으로 main에 들어가도 안전하지 않은지 표시합니다. 독립 배포가 불가능한 단계가 많다면 억지로 stack을 만들지 말고, 하나의 변경으로 유지하되 test evidence와 owner review를 더 강하게 하는 편이 낫습니다.

## 관련 글

- [Agentic PR Governance](/posts/2026-05-25-agentic-pr-governance-trend/)
- [AI PR Review Backlog OS](/posts/2026-05-14-ai-pr-review-backlog-os-trend/)
- [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)
- [온라인 Schema 변경 Expand/Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)
