---
title: "2026 개발 트렌드: Agent Instruction Context Hygiene, 에이전트 지시문도 예산과 적용 범위가 필요하다"
date: 2026-07-06T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "Instruction Files", "Context Engineering", "GitHub Copilot", "Codex", "Developer Tools", "Agent Governance"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["agent instruction context hygiene", "custom instruction deduplication", "Copilot CLI instructions", "Codex skills plugins", "repo-local agent policy"]
description: "Copilot CLI의 instruction deduplication, pattern-specific instruction 최적화와 Codex의 skills/plugins inline 흐름을 바탕으로, 에이전트 지시문을 컨텍스트 예산과 적용 범위로 관리해야 하는 이유를 정리합니다."
lastmod: 2026-07-06
summary: "AI 코딩 에이전트가 여러 지시 파일, 스킬, 플러그인, 원격 세션을 읽기 시작하면서, 좋은 팀은 지시문을 많이 넣는 팀이 아니라 중복을 줄이고 적용 범위를 좁히는 팀이 되고 있습니다."
key_takeaways:
  - "AGENTS.md, copilot-instructions.md, CLAUDE.md, skills, plugins가 늘수록 instruction 중복은 비용과 오작동을 동시에 만든다."
  - "pattern-specific instruction은 모든 세션에 전문을 넣기보다 적용 조건과 요약 테이블로 관리하는 방향이 실무적이다."
  - "instruction hygiene의 목표는 짧은 프롬프트가 아니라 owner, scope, freshness, conflict, token budget이 있는 지시문 운영이다."
operator_checklist:
  - "repo-local policy, 도구별 instruction, skill을 inventory로 만들고 canonical source와 adapter를 분리한다."
  - "세션 시작 시 항상 로드되는 instruction은 10~20개 이하, 4,000~8,000 token 이하로 제한한다."
  - "중복 지시문, 적용 조건 없는 긴 파일, 오래된 테스트 명령, 충돌하는 금지 규칙을 주간으로 점검한다."
decision_guide:
  title: "Instruction Context Hygiene을 언제 시작할까"
  intro: "지시문 정리는 모델 성능 튜닝보다 먼저 할 필요가 있습니다. 특히 여러 도구가 같은 저장소를 읽기 시작하면, 정책 파일 자체가 운영 부채가 됩니다."
  cases:
    - badge: "즉시 정리"
      title: "AGENTS.md, CLAUDE.md, copilot-instructions.md, skills가 동시에 존재한다"
      fit: "도구별 adapter가 늘어난 팀은 같은 규칙이 서로 다른 문장으로 반복되기 쉽고, 에이전트가 충돌을 추측하게 된다."
      watchouts: "한 번에 모든 파일을 없애면 도구별 특화 규칙까지 사라질 수 있다."
      next_step: "항상 로드되는 파일만 먼저 inventory로 만들고 canonical source와 adapter를 분리한다."
    - badge: "운영 강화"
      title: "원격 또는 백그라운드 에이전트 작업이 늘고 있다"
      fit: "사람이 바로 멈추지 못하는 세션에서는 오래된 테스트 명령, 과도한 전체 테스트, 모호한 승인 규칙의 비용이 커진다."
      watchouts: "token 절약만 목표로 잡으면 삭제·외부 전송·비밀값 같은 안전 경계가 빠질 수 있다."
      next_step: "Core, Scoped, On-demand 등급을 나누고 remote 세션에는 freshness review와 canary task를 붙인다."
    - badge: "부분 도입"
      title: "개인 프로젝트지만 반복적으로 AI 코딩 도구를 쓴다"
      fit: "복잡한 registry는 과하지만 build/test 명령 drift와 금지 작업 기준을 줄이는 효과가 있다."
      watchouts: "숫자 기준 없이 메모만 늘리면 다음 달에는 또 다른 중복 instruction이 된다."
      next_step: "Core instruction 1개와 작업별 checklist 2~3개부터 시작한다."
learning_refs:
  - title: "Repo-local Agent Policy"
    href: "/posts/2026-05-17-repo-local-agent-policy-trend/"
    description: "저장소별 에이전트 작업 규칙을 실행 계약으로 관리하는 흐름입니다."
  - title: "Agent Skill Supply Chain"
    href: "/posts/2026-05-26-agent-skill-supply-chain-governance-trend/"
    description: "스킬을 검증 가능한 의존성으로 다루는 관점입니다."
  - title: "Context Freshness Budget"
    href: "/posts/2026-04-24-context-freshness-budget-agent-runtime-trend/"
    description: "오래된 입력을 언제 재검증하거나 폐기할지 숫자로 관리하는 기준입니다."
  - title: "Context Contract Registry"
    href: "/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/"
    description: "에이전트 입력 계약을 출처, 버전, 적용 조건으로 관리하는 방식입니다."
faqs:
  - question: "Instruction hygiene은 prompt를 짧게 만드는 작업인가요?"
    answer: "짧게 만드는 것이 목표가 아닙니다. 항상 필요한 안전 규칙은 남기고, 작업별 규칙은 적용 조건을 붙이며, 중복과 오래된 명령을 줄여 에이전트가 같은 상황에서 같은 판단을 하게 만드는 작업입니다."
  - question: "도구별 instruction 파일이 이미 많은데 하나로 합쳐야 하나요?"
    answer: "무조건 합치기보다 canonical source와 adapter를 분리하는 편이 안전합니다. 공통 정책은 한 곳에서 관리하고, Codex, Copilot, Claude 같은 도구별 파일에는 실행 차이와 호출 조건만 얇게 남깁니다."
  - question: "token budget 기준은 얼마나 엄격하게 봐야 하나요?"
    answer: "처음부터 정확한 token 수를 맞추기보다 항상 로드되는 파일 수와 증가율을 봅니다. core instruction이 4,000~8,000 token을 넘거나 매달 빠르게 늘면 scoped instruction으로 분리할 신호입니다."
---

2026년 7월 초 코딩 에이전트 릴리스 노트를 보면 눈에 띄는 변화가 있습니다. 모델이 더 똑똑해졌다는 이야기보다, 에이전트가 읽는 **지시문과 작업 컨텍스트를 어떻게 줄이고 정리할 것인가**가 제품 기능으로 들어오고 있습니다. GitHub Copilot CLI changelog에는 `copilot-instructions.md`와 `CLAUDE.md`처럼 내용이 같은 custom instruction 파일을 중복 전송하지 않아 token 낭비를 줄인다는 항목이 들어갔습니다. 또 `.github/instructions/*.instructions.md` 같은 pattern-specific instruction은 매 세션마다 전문을 system prompt에 넣지 않고, 적용 조건 중심으로 더 작게 다루는 방향도 보입니다.

OpenAI Codex changelog에서도 비슷한 신호가 있습니다. Codex Mobile 쪽에는 skills와 plugins가 composer에 직접 보이도록 개선됐고, side chat과 queued prompt visibility가 좋아졌습니다. Codex Remote는 6월 25일 일반 제공에 들어가면서 모바일에서 원격 host 작업을 시작·계속·승인하는 흐름을 공식화했습니다. Claude Code changelog도 background agents, subagents, Chrome, plan mode, browser tool permission 같은 긴 실행 표면을 계속 다듬고 있습니다.

이 변화는 단순 UX 개선이 아닙니다. 코딩 에이전트가 repo-local policy, tool config, MCP server, skill, plugin, pattern instruction, session memory를 동시에 읽기 시작하면서, "좋은 지시문을 많이 넣자"는 접근이 한계에 닿고 있습니다. 이제 필요한 것은 **Agent Instruction Context Hygiene**입니다. 지시문을 많이 모으는 것이 아니라, 중복을 제거하고, 적용 범위를 좁히고, 오래된 지시를 재검증하고, 작업에 필요한 것만 로드하는 운영 방식입니다. 이 글은 [Repo-local Agent Policy](/posts/2026-05-17-repo-local-agent-policy-trend/), [Agent Skill Supply Chain](/posts/2026-05-26-agent-skill-supply-chain-governance-trend/), [Context Freshness Budget](/posts/2026-04-24-context-freshness-budget-agent-runtime-trend/), [Context Contract Registry](/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/)와 이어집니다.

## 이 글에서 얻는 것

- custom instruction, repo policy, skill, plugin이 늘어날수록 왜 context hygiene이 필요해지는지 이해할 수 있습니다.
- 중복 지시문, 적용 범위 없는 긴 정책, 도구별 drift가 에이전트 품질과 비용에 미치는 영향을 판단할 수 있습니다.
- instruction inventory, canonical source, adapter file, token budget, freshness review를 팀 운영 기준으로 만들 수 있습니다.
- 팀에서 바로 적용할 수 있는 instruction hygiene 체크리스트와 숫자 기준을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 지시문 중복은 비용 문제가 아니라 행동 문제다

에이전트 instruction 중복은 처음에는 token 비용처럼 보입니다. 같은 정책을 두 번 보내면 컨텍스트를 낭비하고, 긴 세션에서는 compaction이 빨리 옵니다. 하지만 더 중요한 문제는 행동입니다. 같은 내용이 조금 다른 표현으로 여러 파일에 있으면 모델은 어떤 규칙이 우선인지 추측합니다.

예를 들어 아래 지시가 동시에 들어간다고 가정해 봅니다.

- `AGENTS.md`: "테스트 실패가 있어도 관련 변경이면 수정 후 계속 진행"
- `.github/copilot-instructions.md`: "테스트가 실패하면 즉시 중단하고 사용자에게 확인"
- `CLAUDE.md`: "lint failure는 자동 수정, unit failure는 보고"
- `skill/test-runner.md`: "모든 변경 후 전체 테스트 실행"

사람은 팀 맥락으로 해석할 수 있지만 에이전트는 세션마다 다르게 판단할 수 있습니다. 지시문 중복은 "같은 말을 많이 넣었다"가 아니라 **충돌 가능성이 늘어난 상태**입니다. 그래서 GitHub Copilot CLI가 동일한 custom instruction 파일 전송을 피하는 기능은 작은 최적화처럼 보여도 방향은 중요합니다. 지시문도 dependency dedupe처럼 관리해야 합니다.

### 2) pattern-specific instruction은 lazy load가 기본값이어야 한다

모든 지시문을 모든 세션에 넣으면 가장 간단합니다. 하지만 코드베이스가 커질수록 이 방식은 비싸고 부정확합니다. 프론트엔드 CSS 규칙, Terraform 정책, DB migration 규칙, 모바일 릴리스 절차, 보안 스캔 예외 기준은 모두 중요하지만, 모든 작업에 항상 필요한 것은 아닙니다.

실무에서는 instruction을 세 등급으로 나누는 편이 좋습니다.

| 등급 | 예시 | 로드 방식 | 예산 |
| --- | --- | --- | --- |
| Core | 외부 전송 금지, destructive action 승인, 보고 형식 | 항상 로드 | 1,000~2,000 tokens |
| Scoped | DB migration, frontend visual test, infra plan-only | 파일 경로/작업 유형 기준 lazy load | 500~2,000 tokens |
| On-demand | 특정 provider runbook, 긴 장애 대응 절차 | 명시 호출 또는 skill picker | 필요 시 |

GitHub Copilot CLI의 pattern-specific instruction 최적화는 이 흐름과 맞습니다. 적용 조건이 있는 instruction은 "전문을 매번 system prompt에 넣는 것"보다, 어떤 파일 패턴에 어떤 규칙이 있는지 작게 알려주고 필요할 때 펼치는 방식이 더 낫습니다. 이 관점은 [Context Contract Registry](/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/)의 입력 계약과도 같습니다.

### 3) skills/plugins inline은 발견성을 높이지만 로드 예산을 더 중요하게 만든다

Codex changelog의 "skills and plugins now appear directly inline in the composer" 같은 개선은 사용자에게 좋습니다. 어떤 스킬과 플러그인을 쓸 수 있는지 더 쉽게 보고, 필요한 작업에 맞게 고를 수 있기 때문입니다. 하지만 발견성이 좋아질수록 기본 로드 범위는 더 조심해야 합니다.

스킬과 플러그인은 단순 도움말이 아닙니다. 어떤 도구를 써야 하는지, 어떤 순서로 작업해야 하는지, 어떤 권한이 필요하다고 전제하는지까지 에이전트 행동을 바꿉니다. [Agent Skill Supply Chain](/posts/2026-05-26-agent-skill-supply-chain-governance-trend/)에서 말한 것처럼 스킬은 의존성에 가깝습니다. 따라서 composer에 잘 보인다고 해서 모든 스킬을 항상 활성 지시문으로 넣으면 안 됩니다.

권장 기준:

- 항상 활성화되는 skill은 repo당 10~20개 이하
- 기본 instruction bundle은 4,000~8,000 tokens 이하
- cloud, payment, deploy, security skill은 allowlist + explicit invocation
- 설치된 skill 수보다 실제 호출된 skill 성공률을 본다
- 30~60일 동안 호출되지 않은 skill은 stale review 대상으로 둔다

핵심은 "숨기자"가 아닙니다. 사용자가 발견하기 쉽게 하되, 에이전트가 매번 들고 가는 지시문은 작고 명확하게 유지해야 합니다.

### 4) 원격·백그라운드 에이전트에서는 instruction drift가 더 비싸다

로컬 채팅 세션에서는 에이전트가 이상하게 행동하면 사용자가 바로 멈출 수 있습니다. 하지만 Codex Remote나 background agent, Copilot remote control, Claude background agents처럼 세션이 오래 돌고 사람이 나중에 확인하는 구조에서는 잘못된 instruction이 더 큰 비용을 만듭니다.

예를 들어 오래된 지시문이 "전체 테스트를 항상 실행"이라고 되어 있는데, 현재 repo에서는 전체 테스트가 90분 걸린다고 합시다. 로컬이면 사용자가 중단할 수 있지만 background session에서는 credit, runner, queue를 오래 소비합니다. 반대로 instruction이 오래되어 "yarn test"를 쓰라고 하는데 repo가 pnpm으로 바뀌었다면 에이전트는 실패를 분석하느라 시간을 씁니다.

그래서 remote/background agent에는 instruction freshness 기준이 필요합니다.

- 테스트/빌드 명령은 30일마다 CI 기준과 대조
- migration/deploy/security 정책은 변경 PR에서 policy reviewer 필수
- instruction 파일이 변경되면 작은 canary task 1개 실행
- session 실패 원인 중 "invalid instruction" 비율을 기록
- 오래된 instruction이 2회 이상 작업 실패를 만들면 owner 지정

이 기준은 [Context Freshness Budget](/posts/2026-04-24-context-freshness-budget-agent-runtime-trend/)의 실무 적용입니다. 컨텍스트는 오래될수록 가치가 줄어드는 항목과 그렇지 않은 항목을 나눠야 합니다.

### 5) 좋은 instruction은 짧은 문장이 아니라 선택 가능한 계약이다

짧기만 한 instruction은 충분하지 않습니다. "테스트를 실행하세요" 같은 문장은 짧지만 모호합니다. 좋은 instruction은 조건, 적용 범위, 예외, 증거를 가집니다.

예시:

```yaml
instruction_contract:
  id: backend-test-policy
  owner: backend-platform
  applies_to:
    paths:
      - "src/main/java/**"
      - "src/test/java/**"
  rule: "변경 모듈 unit test를 먼저 실행하고, shared module 변경이면 integration smoke를 추가한다."
  commands:
    unit: "./gradlew test --tests '*ChangedModule*'"
    smoke: "./gradlew integrationSmoke"
  stop_condition:
    - "DB migration file changed"
    - "test runtime estimate > 20m"
  evidence:
    - "command"
    - "exit_code"
    - "failed_test_summary"
  review_interval_days: 30
```

이렇게 쓰면 에이전트가 추측할 영역이 줄어듭니다. 또한 CI나 리뷰 봇이 instruction 자체를 검증할 수 있습니다. instruction hygiene의 목적은 "프롬프트 다이어트"가 아니라 **실행 가능한 지시 계약**입니다.

## 실무 적용

### 1) instruction inventory부터 만든다

먼저 repo에서 에이전트가 읽는 모든 입력을 나열합니다.

- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- tool config, MCP config, plugin manifest
- skill 폴더와 slash command
- README의 build/test 섹션
- CI workflow의 실제 명령
- PR template과 review checklist

각 항목에 아래 필드를 붙입니다.

```yaml
instruction_inventory:
  path: ".github/copilot-instructions.md"
  type: "tool-adapter"
  canonical_source: "docs/agent-policy.md"
  owner: "platform-devex"
  load_mode: "always"
  token_estimate: 900
  last_verified_at: "2026-07-06"
  applies_to: "all"
  conflicts_with: []
```

처음부터 자동화할 필요는 없습니다. 20~30개 항목만 표로 만들어도 중복과 drift가 보입니다.

### 2) canonical source와 adapter를 분리한다

도구마다 요구하는 파일명이 다르기 때문에 모든 파일을 없앨 수는 없습니다. 대신 원본 정책과 adapter를 분리합니다.

- `docs/agent-policy.md`: 조직/저장소 공통 원칙의 원본
- `AGENTS.md`: Codex용 adapter, 원본 정책 중 필요한 핵심만 요약
- `CLAUDE.md`: Claude용 adapter, 도구 특화 주의점만 추가
- `.github/copilot-instructions.md`: Copilot용 adapter, GitHub workflow와 PR 증거 중심
- `.github/instructions/db.instructions.md`: DB 파일 패턴에만 적용

중요한 것은 같은 문장을 여러 파일에 복붙하지 않는 것입니다. 복붙은 처음엔 편하지만 2개월 뒤에는 서로 다른 정책이 됩니다. tool adapter에는 "canonical source를 먼저 따른다"는 우선순위를 명시하고, 도구별 차이는 왜 필요한지 적습니다.

### 3) token budget과 conflict gate를 둔다

초기 gate는 단순하게 시작합니다.

| 항목 | 권장 기준 |
| --- | ---: |
| 항상 로드 instruction 총량 | 4,000~8,000 tokens 이하 |
| 항상 로드 파일 수 | 10개 이하 |
| scoped instruction | 파일 패턴 또는 작업 유형 필수 |
| 중복 문단 | 같은 의미 2회 이상이면 정리 |
| stale 명령 | CI와 불일치 시 PR 차단 또는 warning |
| owner 없는 instruction | 0개 목표 |

token 수를 정확히 맞추는 것보다 추세를 보는 게 중요합니다. 항상 로드되는 instruction이 한 달에 30%씩 늘면 어느 순간 에이전트가 정작 작업 파일보다 정책을 더 많이 읽게 됩니다.

### 4) 실패 원인에 instruction을 포함한다

에이전트 실패를 모델 문제로만 기록하면 개선이 어렵습니다. 실패 분류에 instruction을 넣습니다.

- missing instruction: 규칙이 없어 추측함
- stale instruction: 오래된 명령이나 절차를 따름
- conflicting instruction: 서로 다른 파일이 충돌함
- over-broad instruction: 적용 범위가 넓어 불필요한 행동을 함
- hidden instruction: 사람이 아는 규칙이 파일에 없음

주간 리뷰에서 이 분류가 3건 이상 나오면 policy 정리 작업을 잡는 편이 좋습니다. 잘 정리된 instruction은 에이전트 성공률뿐 아니라 사람 온보딩에도 도움이 됩니다.

### 5) 30분짜리 주간 hygiene 루틴을 만든다

instruction hygiene은 분기마다 대청소하는 방식보다 짧은 주간 루틴이 낫습니다. 정책 파일은 코드처럼 자주 바뀌고, 도구 업데이트나 팀 운영 방식에 따라 금방 낡습니다. 추천 루틴은 30분 안에 끝나는 범위로 제한합니다.

| 단계 | 질문 | 산출물 |
| --- | --- | --- |
| 1. Always-loaded 확인 | 이번 주 세션 시작 때 항상 들어가는 파일이 늘었나? | 파일 수와 대략 token 증감 |
| 2. 명령 drift 확인 | build/test/lint 명령이 CI와 같은가? | stale command 목록 |
| 3. 충돌 문장 확인 | 같은 행동에 대해 다른 stop condition이 있는가? | conflict 후보와 owner |
| 4. 실패 3건 샘플링 | 실패 원인이 missing/stale/conflicting instruction인가? | 다음 주 수정 후보 |
| 5. canary 1개 실행 | 정책 변경 후 작은 작업에서 실제로 읽히는가? | 성공/실패와 증거 링크 |

여기서 중요한 것은 모든 instruction을 완벽히 정리하는 것이 아닙니다. 매주 "항상 로드되는 지시문이 늘었는가", "실제 CI와 다른 명령이 남았는가", "에이전트가 충돌을 추측하게 만드는 문장이 있는가"만 봐도 충분히 효과가 납니다.

예를 들어 한 팀이 `AGENTS.md`에는 `pnpm test`를, README에는 `npm test`를, CI에는 `pnpm --filter api test`를 쓰고 있었다면 모델을 바꾸기 전에 policy를 고쳐야 합니다. 이 상태에서 에이전트가 테스트를 틀리게 실행하는 것은 추론 실패가 아니라 입력 계약 실패입니다.

작은 팀이라면 아래 3개만 기록해도 됩니다.

```yaml
instruction_weekly_review:
  date: "2026-07-06"
  always_loaded_files: 6
  stale_commands:
    - path: "README.md"
      command: "npm test"
      replacement: "pnpm --filter api test"
  conflict_candidates:
    - "AGENTS.md says continue after lint fix, copilot-instructions.md says stop on any failure"
  canary_task: "문서 오타 수정 후 lint/test evidence 보고"
  next_owner: "platform-devex"
```

이 정도만 있어도 다음 에이전트 세션은 덜 헤맵니다. 정책 정리는 거창한 governance 프로젝트가 아니라, 에이전트가 반복적으로 잘못 읽는 입력을 줄이는 운영 습관에 가깝습니다.

## 트레이드오프/주의점

첫째, instruction을 너무 줄이면 안전 규칙이 빠질 수 있습니다. 핵심은 짧게 만드는 것이 아니라 항상 필요한 규칙과 상황별 규칙을 나누는 것입니다. 외부 전송, 삭제, secret, 배포, 결제 같은 경계는 core에 남겨야 합니다.

둘째, canonical source를 만들면 관리 책임이 생깁니다. 원본 정책 owner가 없으면 adapter만큼이나 빨리 낡습니다. 정책 변경도 코드 변경처럼 리뷰하고, 변경 후 작은 canary task를 돌리는 습관이 필요합니다.

셋째, 도구별 adapter를 지나치게 얇게 만들면 실제 도구 차이를 놓칠 수 있습니다. Codex, Copilot CLI, Claude Code는 세션 모델, 권한 프롬프트, remote/background 처리, skill 로딩 방식이 다릅니다. 공통 원칙은 공유하되 도구별 실행 차이는 명시해야 합니다.

넷째, instruction hygiene은 모델 품질 문제를 모두 해결하지 않습니다. 검색 품질, 코드베이스 구조, 테스트 신뢰도, 권한 모델이 약하면 지시문만 깔끔해도 결과는 흔들립니다. 다만 지시문이 정리되어 있으면 실패 원인을 훨씬 빨리 좁힐 수 있습니다.

다섯째, pattern-specific instruction은 적용 조건이 틀리면 아예 로드되지 않을 수 있습니다. 파일 glob, 언어 서버, monorepo package 경계가 실제 repo 구조와 맞는지 검증해야 합니다.

의사결정 우선순위는 **안전 경계 유지 > 충돌 제거 > 적용 범위 축소 > token 절약 > 편의성**입니다. 비용 절약보다 중요한 것은 에이전트가 같은 작업에서 같은 규칙을 안정적으로 따르는 것입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 에이전트가 읽는 instruction, skill, plugin, config 목록이 있다.
- [ ] canonical source와 도구별 adapter가 분리되어 있다.
- [ ] 항상 로드되는 instruction의 token budget을 추적한다.
- [ ] pattern-specific instruction은 적용 path와 owner가 있다.
- [ ] 같은 의미의 custom instruction이 중복 전송되지 않도록 정리했다.
- [ ] CI의 실제 build/test 명령과 instruction의 명령이 일치한다.
- [ ] instruction 변경 PR에는 canary task 또는 검증 체크가 있다.
- [ ] 에이전트 실패 원인에 stale/conflicting/missing instruction 분류가 포함된다.

### 연습

1. 현재 repo에서 `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, README, CI workflow의 테스트 명령을 비교해 보세요. 서로 다른 명령이 2개 이상이면 canonical source를 먼저 정합니다.
2. 항상 로드되는 instruction을 Core/Scoped/On-demand로 나눠 보세요. Core가 8,000 tokens를 넘으면 어떤 규칙을 scoped로 내릴지 결정합니다.
3. 최근 에이전트 실패 10건을 골라 missing, stale, conflicting, over-broad, hidden instruction 중 하나로 분류해 보세요. 3건 이상 같은 원인이면 정책 정리 효과가 큽니다.

## 출처 링크

- OpenAI Codex changelog: https://developers.openai.com/codex/changelog
- GitHub Copilot CLI changelog: https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md
- Anthropic Claude Code changelog: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- GitHub Changelog, VS Code Copilot browser tools GA: https://github.blog/changelog/2026-07-01-browser-tools-for-github-copilot-in-vs-code-are-generally-available/
