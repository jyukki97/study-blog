---
title: "2026-06-29 개발 트렌드: Agentic Capacity SLO, AI 에이전트도 무한한 도구가 아니라 용량 예산이 필요한 플랫폼 자원이다"
date: 2026-06-29T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "Platform Engineering", "Capacity Planning", "SLO", "GitHub Copilot", "Codex"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["Agentic Capacity SLO", "AI coding agent capacity", "agent runtime queue", "Copilot AI Credits", "Codex long horizon tasks"]
description: "Codex의 장기 작업 사용 증가와 GitHub Copilot의 usage-based billing, Actions/Copilot 용량 이슈를 바탕으로 AI 에이전트 실행량을 SLO와 큐 예산으로 운영하는 기준을 정리합니다."
lastmod: 2026-06-29
summary: "AI 에이전트가 30분 이상 걸리는 업무와 병렬 작업을 맡기 시작하면서, 좋은 팀은 모델 선택보다 먼저 agent runtime capacity, queue wait, credit burn, fallback path를 SLO로 관리해야 합니다."
key_takeaways:
  - "에이전트 작업은 채팅 한 번이 아니라 큐, 런타임, 도구 호출, CI, 리뷰 대기까지 소비하는 장기 작업 단위가 되고 있다."
  - "GitHub의 Copilot usage-based billing과 per-turn credit 표시 흐름은 비용뿐 아니라 용량 가시성이 제품 기본값이 된다는 신호다."
  - "Agentic Capacity SLO는 agent task를 priority, credit cap, queue wait, runtime budget, fallback path로 제어하는 운영 모델이다."
operator_checklist:
  - "agent task를 P0/P1/P2로 나누고 등급별 queue wait, runtime, credit cap, 동시 실행 수를 제한한다."
  - "agent runtime이 CI와 review queue를 같이 태운다면 Actions minutes, runner pool, reviewer availability까지 capacity budget에 넣는다."
  - "agent queue saturation, cap hit rate, retry inflation, fallback-to-human rate를 주간으로 본다."
---

2026년 6월 말의 AI 코딩 도구 흐름은 꽤 분명합니다. 에이전트는 더 이상 "질문에 답하는 창"에 머물지 않습니다. OpenAI가 6월 25일 공개한 Codex 연구 요약은 agentic AI가 단일 상호작용이 아니라 위임된 장기 작업으로 지식 업무 단위를 바꾼다고 설명합니다. 같은 글에서 2026년 5월 기준 표본 개인 사용자 중 80.6%가 사람 기준 30분을 넘는 작업으로 추정되는 Codex 요청을 한 번 이상 했고, 70.2%는 1시간 초과, 25.6%는 8시간 초과 작업을 한 번 이상 위임했다고 밝혔습니다. 내부 heavy user의 경우 하루에 60시간 이상의 agent turn을 여러 병렬 에이전트에 나눠 생성하는 흐름도 언급됩니다.

이 변화는 개발팀 입장에서는 생산성 뉴스이면서 동시에 용량 뉴스입니다. 에이전트가 오래 일한다는 말은 모델 토큰만 더 쓴다는 뜻이 아닙니다. 저장소를 읽고, 브랜치를 만들고, 테스트를 돌리고, Actions runner를 쓰고, PR을 열고, 리뷰어 시간을 점유합니다. GitHub도 6월 1일부터 Copilot usage-based billing을 모든 플랜에 적용했고, Copilot code review가 GitHub AI Credits뿐 아니라 Actions minutes도 소비한다고 공지했습니다. 6월 22일에는 JetBrains Copilot 업데이트에서 per-turn AI credits indicator를 넣어 세션 중 credit 소비를 더 잘 보이게 했습니다.

저는 이 흐름을 **Agentic Capacity SLO**라고 부르는 편이 좋다고 봅니다. 이미 [AI Coding Spend Preflight](/posts/2026-06-28-ai-coding-spend-preflight-trend/), [Agent Capability Discovery](/posts/2026-06-27-agent-capability-discovery-trend/), [Agent Invocation API](/posts/2026-05-27-agent-invocation-api-task-queue-trend/), [Agent Workbench Operating Console](/posts/2026-05-28-agent-workbench-operating-console-trend/)에서 비용, 도구, 호출 API, 운영 콘솔을 다뤘습니다. 오늘의 초점은 그 아래의 물리적 제약입니다. 에이전트 작업은 무한히 병렬로 던질 수 있는 마법이 아니라 **queue wait, runtime, credit, runner, reviewer를 소비하는 플랫폼 자원**입니다.

## 이 글에서 얻는 것

- AI 에이전트 작업을 단순 프롬프트가 아니라 플랫폼 capacity를 쓰는 long-running task로 보는 관점을 얻습니다.
- agent task 등급별 queue wait, runtime, credit cap, 동시 실행 수를 어떻게 정할지 기준을 잡을 수 있습니다.
- Copilot AI Credits, Actions minutes, agent runtime, CI runner, 리뷰 대기 시간이 서로 연결되는 방식을 이해합니다.
- 장애나 외부 플랫폼 포화 시 어떤 agent 작업을 중단하고 어떤 작업을 사람에게 fallback할지 판단할 수 있습니다.
- 팀 내부 Agentic Capacity SLO를 2주 파일럿으로 시작하는 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) agent task는 채팅 요청이 아니라 작은 배치 작업이다

짧은 코드 질문은 대부분 즉시성 작업입니다. 사용자가 물어보고 답을 받습니다. 하지만 agent mode, cloud agent, Codex, Copilot code review, 원격 세션은 구조가 다릅니다. 하나의 요청이 내부적으로 여러 단계로 쪼개집니다.

```text
intake
  -> context search
  -> file read/write
  -> test run
  -> error interpretation
  -> retry
  -> diff generation
  -> PR/comment/review
  -> human gate
```

이 흐름은 사실상 작은 배치 작업입니다. 그래서 [Background Agent Session + Result Inbox](/posts/2026-05-04-background-agent-session-result-inbox-trend/)에서 다룬 것처럼 시작, 진행, 완료, 실패, 취소, 재시도, 결과 수거가 필요합니다. 차이는 이제 이 작업 수가 팀 전체에서 빠르게 늘고 있다는 점입니다.

실무에서 가장 먼저 바뀌는 지표는 latency입니다. 예전에는 "모델 응답이 10초 걸린다"를 봤다면, 이제는 "에이전트 작업이 큐에서 12분 대기하고, 18분 실행되고, CI에서 14분 더 기다리고, 리뷰어가 2시간 뒤 본다"를 봐야 합니다. 사용자 체감 시간은 모델 inference만으로 결정되지 않습니다.

### 2) 비용과 용량은 같은 방향으로 흔들린다

GitHub Copilot의 usage-based billing 전환은 비용 이벤트처럼 보이지만, 실제로는 용량 가시성 이벤트이기도 합니다. 6월 1일 공지 기준으로 Copilot 사용량은 AI Credits로 계산되고, code review는 Actions minutes도 소비합니다. 즉 에이전트 리뷰 하나는 모델 비용과 CI/runner 비용을 함께 씁니다.

6월 11일 GitHub availability report도 같은 맥락에서 읽을 수 있습니다. GitHub는 AI-assisted와 agentic development workflow가 트래픽 성장을 크게 이끌고 있으며, 이를 따라가기 위해 Azure로 이동, monolith 분리, 공유 실패 지점 제거를 진행 중이라고 설명했습니다. May 5 incident에서는 GitHub Actions hosted runner degradation으로 표준 runner 요청의 13.5%가 실패했고, private networking larger runner 요청의 약 16%가 실패하거나 5분 이상 지연됐으며, Copilot code review 요청 약 8,500건이 timeout됐다고 공개했습니다.

여기서 중요한 결론은 "GitHub가 느리다"가 아닙니다. 개발 조직도 같은 문제를 내부에서 겪게 된다는 것입니다. 에이전트가 늘면 agent runtime만 늘지 않습니다. test runner, package registry, code search, artifact store, review queue, deployment preview까지 같이 눌립니다. 비용 dashboard만 보고 있으면 runner saturation과 human review saturation을 놓칩니다.

### 3) Agentic Capacity SLO는 task class별로 잡아야 한다

모든 agent task에 같은 SLO를 줄 수는 없습니다. 프로덕션 장애 분석과 README 정리는 같은 큐에 있으면 안 됩니다.

출발점은 아래처럼 둘 수 있습니다.

| 등급 | 예시 | queue wait SLO | runtime cap | credit cap | 동시 실행 |
| --- | --- | --- | --- | --- | --- |
| P0 | 장애 분석, 보안 패치, 결제 오류 | 2분 이하 | 30~60분 | 높음, 승인 필수 | 팀당 1~2 |
| P1 | 기능 구현, 버그 수정, 테스트 보강 | 15분 이하 | 30분 | 중간 | 서비스당 2~4 |
| P2 | 문서, rename, 작은 lint, 조사 | 4시간 이하 | 10~20분 | 낮음 | 남는 용량 사용 |
| Batch | 대량 마이그레이션, 의존성 일괄 수정 | 야간/예약 | 1~4시간 | 별도 예산 | window 기반 |

SLO는 빠른 작업을 보장하기보다 **중요하지 않은 작업이 중요한 작업을 밀어내지 않게 하는 장치**입니다. P2 문서 에이전트 30개가 runner를 잡아먹어서 P0 보안 패치 테스트가 지연되면 자동화는 생산성이 아니라 장애 전파가 됩니다.

### 4) 동시 실행 제한은 모델보다 아래층에서 걸어야 한다

많은 팀이 처음에는 모델 선택으로만 비용과 속도를 제어하려 합니다. 하지만 실제 병목은 아래층에서 생깁니다.

- repo clone과 code search I/O
- package install과 dependency cache
- unit/integration test runner
- preview environment
- GitHub Actions minutes 또는 self-hosted runner
- secret scanning, CodeQL, dependency review
- 사람 리뷰어와 merge queue

그래서 agent capacity limit은 모델 gateway에만 있으면 부족합니다. agent runtime이 작업을 시작하기 전에 필요한 실행 자원을 예약하거나, 최소한 예상 자원을 선언해야 합니다.

```yaml
agent_capacity_request:
  task_class: P1
  repo: payments-api
  expected_runtime_minutes: 25
  expected_ai_credits: 900
  runner_minutes_budget: 20
  max_parallel_agents_for_repo: 2
  requires:
    - code_search
    - unit_test_runner
    - dependency_cache
  stop_conditions:
    - "runner queue wait > 20m"
    - "credit cap 80% reached without failing test identified"
    - "touches schema migration"
```

이 값은 정확한 예측기가 아닙니다. 중요한 것은 시작 전에 작업이 어떤 자원을 태울지 명시하고, 실행 중 cap을 넘으면 축소하거나 멈출 수 있게 하는 것입니다.

### 5) queue saturation은 품질 문제로 이어진다

에이전트 큐가 밀리면 단순히 늦어지는 데서 끝나지 않습니다. context가 stale해지고, base branch가 바뀌고, 테스트 결과가 오래되고, 같은 이슈를 여러 에이전트가 중복으로 잡을 수 있습니다. 이 문제는 [Context Freshness Budget](/posts/2026-04-24-context-freshness-budget-agent-runtime-trend/)과 연결됩니다.

예를 들어 agent task가 intake 후 3시간 뒤에 실행되면 이슈 상태가 바뀌었을 수 있습니다. 이미 사람이 고쳤거나, 새 배포로 재현 조건이 달라졌거나, 의존성 lock 파일이 바뀌었을 수 있습니다. 이때 오래된 context로 PR을 만들면 리뷰어 시간만 태웁니다.

그래서 queue wait가 SLO를 넘은 작업은 실행 전에 freshness check를 다시 해야 합니다.

- issue/PR 상태가 여전히 open인가?
- base branch가 intake 이후 얼마나 바뀌었는가?
- 실패 테스트가 여전히 실패하는가?
- owner와 priority가 바뀌었는가?
- budget cap과 모델 경로가 아직 유효한가?

queue wait p95가 길어지면 agent를 더 붙이는 것보다 intake quality와 priority를 먼저 봐야 합니다.

## 실무 적용

### 1) agent task admission control을 둔다

처음부터 복잡한 scheduler를 만들 필요는 없습니다. GitHub label, Jira field, 내부 developer portal form 정도로도 시작할 수 있습니다.

필수 입력:

- task class: P0/P1/P2/Batch
- expected outcome: PR, patch, report, comment, test evidence
- repo/service owner
- allowed scope와 forbidden scope
- expected runtime band: 10분, 30분, 1시간, batch
- credit cap과 runner cap
- fallback owner
- stale 기준

admission rule 예시는 아래처럼 둡니다.

- P0는 자동 시작 가능하지만 apply/merge는 human gate 필수
- P1은 repo당 동시 2~4개 이하
- P2는 업무 시간에는 남는 용량만 사용
- Batch는 야간 window 또는 별도 runner pool 사용
- same issue에 active agent 1개만 허용
- queue wait가 SLO 2배를 넘으면 자동 실행 전 재확인

### 2) runner와 review queue를 capacity budget에 포함한다

AI agent dashboard에 credits만 있으면 반쪽입니다. 최소 아래를 같이 봅니다.

| 지표 | 해석 |
| --- | --- |
| `agent_queue_wait_p95` | agent runtime 자체가 밀리는지 |
| `agent_runtime_p95` | 작업이 너무 넓거나 재시도가 많은지 |
| `credit_burn_per_accepted_pr` | 비용이 채택 산출물로 이어지는지 |
| `runner_queue_wait_p95` | CI가 병목인지 |
| `test_retry_inflation` | flaky test와 agent 재시도가 비용을 키우는지 |
| `review_wait_p95` | 사람 gate가 병목인지 |
| `stale_context_abort_rate` | 큐 대기로 무효화된 작업 비율 |
| `fallback_to_human_rate` | agent가 어디서 막히는지 |

초기 목표는 엄격할 필요 없습니다. 2주 동안 baseline을 잡고, 가장 자주 포화되는 지점 하나만 줄이면 됩니다. 보통은 P2 작업의 동시 실행을 줄이거나, 큰 테스트 스위트를 무조건 돌리는 기본값을 바꾸는 것만으로도 큐가 풀립니다.

### 3) capacity incident mode를 정한다

외부 플랫폼이나 내부 runner가 흔들릴 때 어떤 agent 작업을 계속할지 미리 정해야 합니다.

예시:

```yaml
agent_capacity_incident_mode:
  trigger:
    - "runner_queue_wait_p95 > 30m for 15m"
    - "agent_error_rate > 5%"
    - "credit_budget_daily_burn > 120%"
    - "github_actions_degraded = true"
  actions:
    - "pause P2 and Batch new starts"
    - "allow P0 investigation read-only agents"
    - "require human approval for P1 write tasks"
    - "reroute tests to minimal targeted suite"
    - "post queue delay notice to dev portal"
```

이 기준은 [Rollback Budget](/posts/2026-04-21-rollback-budget-ai-runtime-changes-trend/)과 닮았습니다. 에이전트 운영에서도 장애 모드의 핵심은 "무엇을 끌 것인가"입니다. 모든 agent를 계속 돌리면 원인 분석과 복구가 더 느려질 수 있습니다.

### 4) 작은 모델과 큰 모델을 capacity 관점에서 섞는다

GitHub의 6월 릴리스 흐름에는 작은 tier coding model, model picker, larger context window, per-turn credits 같은 신호가 같이 보입니다. 이는 모델 선택이 품질만이 아니라 capacity control의 일부가 된다는 뜻입니다.

권장 순서:

1. P2는 작은 모델 + 작은 context + targeted test만 허용
2. P1은 중간 모델 + 실패 테스트 중심 컨텍스트
3. P0는 큰 모델을 허용하되 read-only 조사와 apply를 분리
4. 큰 context window는 "복잡하니까"가 아니라 "관련 파일이 30개 이상이고 줄이면 실패한다"는 증거가 있을 때만 사용
5. 모델 승격은 재시도 1회 이후, 실패 원인과 기대 이득이 명확할 때만 허용

모델을 낮추는 것보다 작업을 작게 자르는 편이 더 효과적일 때가 많습니다. 용량 문제를 모델 문제로만 보면 agent task가 계속 비대해집니다.

### 5) 2주 파일럿 절차

첫 주에는 강제하지 말고 측정합니다.

- 최근 agent task 50건을 P0/P1/P2/Batch로 분류합니다.
- 각 task의 queue wait, runtime, credits, runner minutes, modified files, review wait을 기록합니다.
- cap을 넘은 작업 5건과 버려진 PR 5건을 봅니다.
- 같은 이슈에 중복 agent가 붙은 사례가 있는지 찾습니다.

둘째 주에는 가장 안전한 gate만 적용합니다.

- P2 동시 실행을 repo당 1개로 제한합니다.
- P1은 failing test 또는 acceptance criteria 없으면 시작하지 않습니다.
- queue wait가 1시간을 넘긴 작업은 freshness check 후 실행합니다.
- runner queue wait가 30분을 넘으면 P2/Bulk agent 시작을 멈춥니다.
- accepted PR 기준 `credit_burn`과 `review_wait`를 주간 보고에 넣습니다.

## 트레이드오프/주의점

첫째, capacity SLO가 너무 엄격하면 에이전트 도입 효과가 줄어듭니다. 모든 작업에 승인과 cap을 걸면 사람이 직접 하는 것보다 느려질 수 있습니다. 그래서 P2부터 가볍게 제한하고, P0/P1은 증거와 승인 중심으로 다르게 봐야 합니다.

둘째, queue wait을 줄이겠다고 무작정 동시 실행을 늘리면 CI와 리뷰가 터집니다. agent runtime만 수평 확장해도 downstream이 받지 못하면 전체 lead time은 줄지 않습니다.

셋째, credit cap은 품질 cap이 될 수 있습니다. 어려운 작업이 cap 때문에 중간에 끊기면 reviewer가 더 많은 시간을 씁니다. cap은 무조건 낮게 잡는 것이 아니라 작업 등급과 실패 비용에 맞춰야 합니다.

넷째, provider status를 내부 SLO로 착각하면 안 됩니다. GitHub, OpenAI, Anthropic, runner provider가 모두 정상이어도 우리 조직의 repo lock, flaky test, 부족한 reviewer 때문에 agent throughput은 낮을 수 있습니다. 반대로 외부 장애가 있을 때는 내부 incident mode가 필요합니다.

다섯째, non-developer adoption이 늘수록 intake 품질 편차도 커질 수 있습니다. OpenAI 자료가 말하듯 비개발자 사용이 빠르게 늘고 있지만, 이것은 더 많은 사람이 기술 작업을 위임할 수 있다는 뜻이면서 동시에 더 강한 scope, permission, evidence gate가 필요하다는 뜻입니다.

## 체크리스트 또는 연습

- [ ] agent task를 P0/P1/P2/Batch로 분류하는 기준이 있다.
- [ ] 등급별 queue wait, runtime cap, credit cap, 동시 실행 제한이 있다.
- [ ] agent dashboard가 AI Credits뿐 아니라 runner wait, review wait, stale abort를 같이 보여 준다.
- [ ] 같은 issue에 active agent가 여러 개 붙지 않도록 lock 또는 lease가 있다.
- [ ] queue wait SLO를 넘긴 작업은 freshness check를 다시 한다.
- [ ] external platform degradation 시 P2/Batch를 멈추는 incident mode가 있다.
- [ ] P0 작업은 큰 모델을 허용하더라도 apply/merge 전에 human gate와 evidence가 필요하다.
- [ ] accepted output 기준으로 비용과 시간을 본다.

연습으로는 지난 2주간의 AI agent 작업 20개를 뽑아 `queue wait`, `runtime`, `credits`, `runner minutes`, `review wait`, `accepted 여부`를 표로 적어 보세요. 평균보다 p95를 보는 것이 중요합니다. 그리고 가장 오래 걸린 3건이 실제로 P0/P1 가치가 있었는지 확인하세요. 오래 걸린 작업이 대부분 P2라면 모델을 바꾸기 전에 admission control이 먼저입니다.

### 참고한 최신 신호

- OpenAI, [How agents are transforming work](https://openai.com/index/how-agents-are-transforming-work/): Codex 사용이 장기 위임 작업과 비개발자 사용으로 확장되는 흐름을 공개했습니다.
- GitHub, [Updates to GitHub Copilot billing and plans](https://github.blog/changelog/2026-06-01-updates-to-github-copilot-billing-and-plans/): Copilot usage-based billing, AI Credits, code review의 Actions minutes 소비, user-level budget을 공지했습니다.
- GitHub, [GitHub availability report: May 2026](https://github.blog/news-insights/company-news/github-availability-report-may-2026/): AI-assisted/agentic workflow가 트래픽 성장을 이끌고, Actions/Copilot code review 용량 이슈가 실제 incident로 이어진 사례를 공개했습니다.
- GitHub, [New features and Claude as agent provider preview in JetBrains IDEs](https://github.blog/changelog/2026-06-22-new-features-and-claude-as-agent-provider-preview-in-jetbrains-ides/): per-turn AI credits indicator와 cloud agent GA 등 agent 사용량 가시성 강화를 발표했습니다.
