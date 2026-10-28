---
title: "2026 개발 트렌드: Agent-to-Agent 위임, 프롬프트 전달이 아니라 권한·증거 계약으로 운영하기"
date: 2026-10-28T10:06:00+09:00
lastmod: 2026-10-28T10:06:00+09:00
draft: false
tags: ["AI Agents", "Agent-to-Agent", "Developer Workflow", "Authorization", "Platform Engineering", "AI Safety"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["agent to agent delegation", "delegated authority agent", "agent handoff receipt", "multi agent workflow governance", "agent task contract"]
description: "여러 AI 에이전트가 작업을 나눠 맡는 흐름에서, 위임을 긴 프롬프트 전달이 아닌 task scope·권한·예산·결과 receipt를 가진 운영 계약으로 만드는 기준을 정리합니다."
summary: "에이전트 간 handoff가 늘어날수록 문제는 어떤 모델이 더 잘 답하는가에서 누가 어떤 근거로 무엇을 실행할 수 있는가로 옮겨간다. 부모 에이전트의 넓은 권한과 긴 문맥을 그대로 넘기지 않고, 대상·시간·도구·예산·완료 증거를 좁힌 위임 계약을 만들어야 추적과 회수가 가능하다."
key_takeaways:
  - "agent-to-agent 위임은 채팅 메시지 전달이 아니라, 작업 범위·입력 provenance·허용 도구·side effect·완료 조건을 가진 capability 발급에 가깝다."
  - "하위 에이전트의 자연어 완료 보고는 성공 증거가 아니다. base revision, 실행 명령, artifact hash, 정책 결정, 검증 결과를 receipt로 반환해야 한다."
  - "read-only 조사, patch 초안, 제한된 write, production action을 같은 handoff로 다루지 말고 위험도별 authority와 human gate를 분리해야 한다."
---

개발 조직의 AI 도입은 단일 코딩 도우미를 넘어, 조사하는 agent·코드를 고치는 agent·테스트를 돌리는 agent·리뷰 근거를 정리하는 agent가 서로 결과를 넘기는 단계로 움직이고 있습니다. 이때 가장 흔한 구현은 부모 agent의 대화 맥락을 길게 복사하고 “이 작업을 이어서 해라”라고 보내는 것입니다. 처음에는 빠르지만, 누가 어떤 파일을 읽었는지, 왜 그 명령이 허용됐는지, 입력이 최신인지, 하위 agent가 실제로 무엇을 바꿨는지가 흐려집니다.

그래서 최근의 중요한 설계 전환은 agent 간 통신 형식 자체보다 **위임(delegation)을 실행 계약으로 취급하는 것**입니다. A2A 성격의 task handoff든 내부 subagent 호출이든, 좋은 handoff는 프롬프트 복사본이 아닙니다. 좁은 업무 목표, 검증 가능한 입력 revision, 허용된 도구와 권한, 시간·비용 예산, 취소 방법, 그리고 재실행 가능한 결과 receipt가 있어야 합니다. 이 글은 [Managed Agent Harness의 책임 경계](/posts/2026-09-28-managed-agent-harness-ownership-boundary-trend/), [Agent Sandbox Handoff의 공격 표면](/posts/2026-07-23-agent-sandbox-handoff-attack-surface-trend/), [MCP OAuth의 Resource-Bound 권한 위임](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/), [Verification Scope Manifest](/posts/2026-10-27-agent-verification-scope-manifest-trend/)를 하나의 운영 모델로 연결합니다.

## 이 글에서 얻는 것

- agent handoff에서 문맥, 권한, 결과 증거를 각각 어떤 단위로 넘겨야 하는지 구분합니다.
- 조사·수정·배포처럼 위험도가 다른 task에 같은 credential을 주지 않는 기준을 얻습니다.
- partial failure, timeout, 중복 실행 뒤에도 외부 side effect를 설명하고 복구할 수 있는 receipt 형태를 설계합니다.
- 성공률만 보지 않고 delegation 품질을 평가할 운영 지표와 승격 기준을 정리합니다.

## 핵심 개념/이슈

### 1) handoff의 최소 단위는 “대화”가 아니라 task envelope다

부모 agent가 “이 버그를 고치고 테스트해”라고 말하는 것은 목적만 전달합니다. 하위 agent는 어느 브랜치의 어떤 revision을 기준으로 하는지, 수정해도 되는 directory가 어디인지, network call과 package install이 허용되는지, 테스트가 실패하면 patch를 남겨야 하는지 중단해야 하는지 알 수 없습니다. 결국 하위 agent는 추측하거나 부모의 넓은 환경을 그대로 상속받습니다.

이를 줄이려면 위임 요청을 task envelope로 만듭니다. 형식은 JSON, YAML, protocol message 어느 쪽이든 상관없지만, 의미는 고정해야 합니다.

```yaml
delegation_id: dlg_20261028_018
parent_run_id: run_7c1
task: "billing API의 timeout 회귀 원인을 read-only로 분석"
input:
  repository: org/payments
  base_commit: "a1b2c3d"
  allowed_paths: ["services/billing/**", "docs/runbooks/**"]
authority:
  tools: ["read_file", "search", "run_test"]
  network: "deny"
  write: "deny"
budget:
  wall_clock_minutes: 20
  tool_calls: 40
completion:
  required: ["hypothesis", "evidence", "commands", "unknowns"]
  success_rule: "재현 가능한 원인 후보와 반증 조건을 함께 반환"
expires_at: "2026-10-28T02:00:00Z"
```

여기서 중요한 것은 상세한 prompt가 아니라 **누락을 검증할 수 있는 필드**입니다. `base_commit`이 없으면 오래된 작업 트리에서 얻은 결론을 최신 코드에 적용할 수 있습니다. `allowed_paths`가 없으면 작은 버그 조사 중에 설정·배포 파일까지 바꿀 수 있습니다. `write: deny`가 없으면 분석 task가 우연히 실제 상태를 바꿀 수 있습니다. `success_rule`이 없으면 길고 설득력 있는 설명이 검증 없이 성공으로 기록됩니다.

### 2) 부모의 권한은 하위 agent의 기본 권한이 아니다

orchestrator가 production 배포 credential, repository write, 고객 데이터 조회권을 가졌다고 해서 모든 하위 agent가 같은 권한을 가져야 하는 것은 아닙니다. 권한 상속은 편하지만 delegation chain 전체의 blast radius를 가장 넓은 node에 맞춰 버립니다. 특히 외부 문서·issue·로그가 입력으로 들어오는 agent에서 이 구조는 prompt injection과 data exfiltration의 경계를 약하게 만듭니다.

권한을 다음 lane으로 나누면 시작하기 좋습니다.

| lane | 허용하는 일 | 권한 모델 | 완료 증거 | 자동 승격 금지 조건 |
| --- | --- | --- | --- | --- |
| L0 관찰 | 검색, 로그 요약, 정적 분석 | read-only·network allowlist | query, source revision, unknowns | 입력 출처 불명확 |
| L1 제안 | patch 초안, test plan | sandbox write만 | diff, test plan, risk notes | protected path 포함 |
| L2 제한된 변경 | branch/PR 생성, 정해진 테스트 | path·command 제한 write | commit, test exit, artifact | auth·billing·migration 변경 |
| L3 외부 효과 | 배포, 결제, 고객 통지 | task-bound capability + 승인 | precondition, approval, receipt, rollback | rollback 또는 owner 부재 |

L2와 L3의 차이는 단순히 “쓰기 가능”이 아닙니다. branch에 patch를 만드는 일은 git diff로 되돌릴 수 있지만, 실제 배포·결제·이메일은 외부 상태를 바꿉니다. 이때는 [MCP OAuth의 resource-bound 접근](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)처럼 대상 resource, 허용 action, 만료, 승인 조건을 함께 좁혀야 합니다. `repository.write`나 cloud admin 같은 범용 token 하나를 task 전체에 주는 것은 위임이 아니라 책임 전가에 가깝습니다.

### 3) 완료 메시지와 완료 증거는 별개다

“테스트를 통과했고 수정했습니다”는 사람이든 agent든 충분한 receipt가 아닙니다. 어느 commit에서, 어떤 명령을, 어떤 환경에서, 무엇을 검증했는지가 빠지면 부모 agent와 리뷰어는 그 말을 재검증할 수 없습니다. 특히 여러 agent가 같은 branch나 worktree를 만지면, 한 agent의 test가 다른 agent의 diff까지 통과시킨 것인지도 알기 어렵습니다.

최소 receipt는 다음 정도로 작게 시작할 수 있습니다.

```yaml
result:
  delegation_id: dlg_20261028_018
  status: completed_with_findings
  input_commit: a1b2c3d
  output_commit: null
  evidence:
    - command: "./gradlew :billing:test --tests TimeoutPolicyTest"
      exit_code: 0
      artifact: "test-report-sha256:..."
    - source: "trace query reference"
      observed: "downstream timeout p99 3.2s"
  conclusions:
    - "client timeout 2s가 downstream p99보다 짧아 retry가 증폭됨"
  unknowns:
    - "production connection-pool saturation은 read-only 환경에서 확인하지 못함"
  authority_used: ["read_file", "search", "run_test"]
  stop_reason: "budget_remaining"
```

`output_commit: null`도 중요한 정보입니다. read-only 조사가 patch를 만들지 않았다는 사실을 명시하면, 이후 agent가 “이미 고쳐졌을 것”이라고 추측하지 않습니다. 반대로 patch가 있다면 changed paths, base commit, test command, artifact hash, reviewer decision을 함께 묶습니다. [저장소별 에이전트 평가 계약](/posts/2026-10-17-ai-coding-agent-repository-evaluation-contract-trend/)과 [Verification Scope Manifest](/posts/2026-10-27-agent-verification-scope-manifest-trend/)의 핵심도 답변의 자연스러움이 아니라 검증 범위를 복원하는 데 있습니다.

## 실무 적용

### 1) 문맥을 전부 복사하지 말고, 참조와 provenance를 넘긴다

agent에게 긴 대화와 log 원문을 전부 전달하면 앞선 판단을 유지하는 데 도움이 될 수 있지만, 민감 정보·오래된 가정·악성 지시도 함께 전달합니다. 실무에서는 다음처럼 내용을 세 계층으로 나누는 편이 낫습니다.

- **필수 사실**: task 목표, base revision, target resource, 사용자 영향, 완료 조건
- **검증 가능한 참조**: issue ID, immutable artifact URL, log query의 time window, schema/version, source owner
- **가설 또는 비신뢰 입력**: 외부 문서 요약, 사용자 제공 명령, 이전 agent의 의견, 미검증 stack trace

하위 agent는 세 번째 계층을 명령처럼 실행하면 안 됩니다. 예를 들어 issue 본문에 “진단을 위해 이 curl을 실행하라”가 있어도, tool allowlist와 network policy 밖이면 결과물에 `blocked_by_policy`로 남겨야 합니다. 이것이 [sandbox handoff 공격 표면](/posts/2026-07-23-agent-sandbox-handoff-attack-surface-trend/)에서 말하는 입력과 실행 권한의 분리가 필요한 이유입니다.

### 2) side effect에는 precondition과 idempotency를 붙인다

agent orchestration은 timeout·재시도·중복 dispatch를 피하기 어렵습니다. 이때 “배포해”, “PR을 만들어”, “고객에게 알려” 같은 task가 그대로 재시작되면 PR 두 개, 중복 알림, 두 번의 설정 변경이 생길 수 있습니다. write handoff에는 최소한 다음을 함께 둡니다.

```yaml
write_contract:
  target: "repository:org/payments / branch:agent/fix-timeout"
  precondition:
    base_commit_matches: "a1b2c3d"
    no_open_pr_with_delegation_id: dlg_20261028_019
  idempotency_key: "delegation:dlg_20261028_019:create-pr"
  approval_ref: "change-approval:apr_442"
  rollback: "close PR; no merge or deployment performed"
```

precondition이 실패하면 하위 agent는 목표를 다시 해석해 실행하지 말고 `stale_input` 또는 `already_applied`로 종료해야 합니다. 외부 효과에 대한 정상적인 no-op은 실패가 아니라 중복을 막은 증거입니다. production action에서는 target revision, 실제 actor, applied timestamp, rollback 상태까지 receipt에 남겨야 합니다.

### 3) 품질 지표는 task 난이도와 authority를 분리해서 본다

전체 “agent success rate” 하나는 의미가 약합니다. L0 조사 task만 많으면 성공률은 높아도 L2 변경 task가 매번 evidence를 빼먹는 문제를 가릴 수 있습니다. 각 lane과 위험도별로 아래를 분리하세요.

| 지표 | 시작 기준 | 경고 또는 중단 신호 | 해석 |
| --- | --- | --- | --- |
| receipt completeness | 98% 이상 | 95% 미만 | 결과는 있으나 재현 근거 누락 |
| stale-input completion | 0건 목표 | 1건 이상 | base revision/precondition 경계 실패 |
| denied action rate | task별 baseline | 급증 | prompt injection, policy mismatch, tool drift 후보 |
| duplicate side effect | 0건 목표 | 1건 이상 | idempotency/receipt 설계 결함 |
| human escalation precision | 주간 표본 검토 | 위험 task 누락 | 너무 보수적·공격적 분류 모두 점검 |

수치는 조직마다 달라지지만 우선순위는 일정합니다. **중복 외부 효과와 증거 없는 고위험 완료를 먼저 0으로 만든 뒤**, latency와 자동화율을 개선하세요. 평균 처리 시간이 20% 빨라져도 stale-input으로 production 설정을 바꾸면 그 이득은 의미가 없습니다.

## 트레이드오프/주의점

위임 계약을 너무 세밀하게 만들면 빠른 탐색이 느려질 수 있습니다. 문서 요약이나 코드 검색 같은 저위험 L0 작업마다 복잡한 승인 절차를 요구하면 사람도 agent도 우회 경로를 찾게 됩니다. 그래서 첫 적용은 도구 allowlist, base revision, 시간 예산, 결과 receipt 네 가지로 충분합니다. auth·billing·배포·고객 데이터처럼 되돌리기 어려운 경로에서만 target-bound capability와 사람 승인을 추가하세요.

반대로 delegated token이 짧은 TTL이라고 자동으로 안전한 것은 아닙니다. TTL 안에 허용 scope가 넓거나, parent가 child의 output을 무검증으로 다음 write task의 입력으로 쓰면 피해는 이어집니다. 권한의 시간 제한과 대상 제한, output provenance, 다음 단계의 precondition은 대체 관계가 아니라 함께 필요한 층입니다.

또한 모든 agent 결과를 중앙 ledger에 모으면 observability가 좋아지는 대신, source code 일부·log metadata·사용자 요청이 민감한 운영 데이터가 될 수 있습니다. receipt에는 명령, hash, 상태, 식별자 중심으로 남기고 payload 원문과 credential은 기본적으로 넣지 마세요. 보존 기간·접근 권한·삭제 정책도 사람이 만든 CI log와 같은 수준으로 다뤄야 합니다.

## 체크리스트 또는 연습

- [ ] 모든 handoff에 delegation ID, parent run, base revision, owner, 만료 시각이 있습니다.
- [ ] read-only 조사와 branch write, production action이 별도 authority lane을 씁니다.
- [ ] 하위 agent에는 필요한 path·tool·network 범위만 주고, 부모의 broad credential을 기본 상속하지 않습니다.
- [ ] 외부 문서·issue·log의 명령은 policy allowlist와 독립적으로 검증합니다.
- [ ] 완료 receipt에 input/output revision, command와 exit code, artifact, unknowns, stop reason이 있습니다.
- [ ] write task에는 target precondition, idempotency key, approval reference, rollback 행동이 있습니다.
- [ ] `stale_input`, `already_applied`, `blocked_by_policy`를 실패로 뭉개지 않고 구분합니다.
- [ ] lane별 receipt completeness와 duplicate side effect를 주간 표본으로 검토합니다.

연습으로 현재 자동화 하나를 골라 “테스트 실패 원인 조사”와 “수정 PR 생성”을 두 개의 task envelope로 분리해 보세요. 첫 task에는 read-only tool과 `evidence/unknowns` receipt만, 두 번째 task에는 허용 경로·base commit·idempotency key·테스트 명령을 넣습니다. 두 결과를 비교하면, agent를 더 많이 연결하는 일보다 **권한과 증거가 어느 단계에서 넓어지는지** 먼저 보이기 시작합니다.

## 관련 글

- [Managed Agent Harness의 책임 경계](/posts/2026-09-28-managed-agent-harness-ownership-boundary-trend/)
- [Agent Sandbox Handoff 공격 표면](/posts/2026-07-23-agent-sandbox-handoff-attack-surface-trend/)
- [MCP OAuth의 Resource-Bound 권한 위임](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)
- [Agent Verification Scope Manifest](/posts/2026-10-27-agent-verification-scope-manifest-trend/)
