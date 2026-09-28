---
title: "2026 개발 트렌드: Managed Agent Harness가 늘릴수록, 팀의 운영 책임 경계를 더 선명하게 해야 한다"
date: 2026-09-28T10:07:00+09:00
lastmod: 2026-09-28T10:07:00+09:00
draft: false
tags: ["AI Agents", "Agent Harness", "Codex", "Platform Engineering", "Governance", "Agent Operations"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["managed agent harness", "Agents API", "long-running agents", "agent operations ownership", "agent execution contract"]
description: "2026년 9월 공개된 managed Agents API를 계기로, context·tool orchestration·sandbox를 제공하는 agent harness를 도입할 때 플랫폼이 맡는 일과 제품 팀이 계속 소유해야 할 실행 계약·권한·검증·비용 책임을 정리합니다."
summary: "관리형 harness는 긴 세션, 도구 탐색, 병렬 subagent, sandbox 운영 부담을 줄일 수 있다. 그러나 그것이 업무 결과의 정확성, 외부 변경의 승인, 데이터 보존, 도구 권한, 비용 한도를 대신 결정해 주지는 않는다. 도입의 최소 단위는 API 호출이 아니라 실행 계약과 evidence bundle이다."
key_takeaways:
  - "2026년 9월 공개된 Agents API는 Codex harness와 장기 세션 context 관리, tool search, 병렬 subagent orchestration을 관리형 기반으로 제공하는 public beta다."
  - "관리형 harness가 줄이는 것은 orchestration 구현 부담이며, 업무 목표·권한·idempotency·외부 side effect·결과 검증·retention의 제품 책임은 남는다."
  - "agent run마다 입력 범위, 허용 도구, 환경, 최대 시간·비용, 승인 경계, 산출물, 성공 판정을 기록하면 긴 작업을 운영 가능한 변경 단위로 만들 수 있다."
operator_checklist:
  - "low-risk read-only 작업부터 canary하고, write·배포·고객 데이터 변경은 별도 approval과 idempotency·rollback 계약 없이는 자동화하지 않는다."
  - "harness·sandbox·tool provider·application의 책임을 표로 고정하고, credential과 data retention을 'managed'라는 단어로 묶지 않는다."
  - "run success를 agent의 서술이 아니라 테스트·query·artifact·approval receipt로 판정하며, timeout·cancel·partial completion을 별도 종료 상태로 남긴다."
---

2026년 9월 10일 OpenAI는 Codex의 실행 기반을 관리형으로 제공하는 Agents API public beta를 발표했다. 공개 설명에서 이 API는 긴 세션의 context 관리, 필요한 도구 정의를 늦게 불러오는 tool search, programmatic tool calling, 병렬 subagent 조율, 선택 가능한 sandbox 환경을 하나의 agent harness로 제공한다. 개발자가 task·model·tool·environment를 지정하면, context window와 orchestration을 처음부터 직접 조립하지 않아도 장시간 작업을 시작할 수 있다는 방향이다.

이 변화는 단순히 "에이전트를 더 쉽게 만든다"보다 중요하다. 그동안 팀이 agent를 production에 넣기 어려웠던 이유 중 하나는 모델 호출 자체가 아니라, 세션이 길어질 때 context를 어떻게 줄일지, tool 결과를 어떻게 모을지, 작업이 중간에 멈추면 무엇을 재개할지, sandbox를 어떻게 준비할지 같은 **harness 운영 코드**였다. 관리형 기반은 그 반복 비용을 낮출 수 있다. 하지만 이것을 "운영 책임이 없어졌다"로 읽으면 위험하다. harness가 잘 관리하는 실행과, 제품 팀만 결정할 수 있는 업무 결과는 다른 문제다.

이 글은 [Harness 밖 Sandbox와 Agent Control Plane](/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/), [Agentic Capacity SLO](/posts/2026-06-29-agentic-capacity-slo-trend/), [Agent Quality Flywheel과 Eval Runtime](/posts/2026-07-07-agent-quality-flywheel-eval-runtime-trend/), [Execution Receipt 운영 플레이북](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)의 다음 단계다. 앞선 글이 agent의 격리·용량·평가·증거를 다뤘다면, 여기서는 그 기능 일부를 플랫폼이 제공할 때 **책임이 어디까지 이동하고 어디에 남는지**를 정리한다.

공식 근거는 [OpenAI의 Agents API 발표](https://openai.com/index/introducing-the-agents-api/)와 [Codex 안전 운영 방식](https://openai.com/index/running-codex-safely/)을 기준으로 확인했다. 발표 시점의 Agents API는 public beta다. 기능이 제공된다는 사실과, 특정 조직의 데이터 경계·감사·복구 요구에 맞는 production 기본값이라는 판단은 분리해야 한다.

## 이 글에서 얻는 것

- managed agent harness가 context·도구 조율·실행 환경에서 실제로 덜어 주는 일을 구분할 수 있습니다.
- harness provider, sandbox provider, tool owner, 제품 팀 사이의 권한·데이터·장애 책임을 표로 나눌 수 있습니다.
- 긴 agent run을 prompt 한 줄이 아니라 time·cost·approval·artifact·성공 기준을 가진 실행 계약으로 설계하는 방법을 배웁니다.
- read-only canary에서 고위험 write workflow까지 확대할 때 필요한 품질·보안·비용 gate를 수치로 정할 수 있습니다.

## 핵심 개념/이슈

### 1) harness는 모델 wrapper가 아니라 실행 수명주기다

긴 작업을 수행하는 agent에는 모델과 prompt 외에도 많은 동작이 필요하다. 이전 대화와 파일·명령 결과에서 다음 판단에 필요한 정보만 남기고 context를 압축해야 하며, 수백 개 tool의 schema를 매 호출마다 넣지 않고 관련 정의만 가져와야 한다. 독립적인 조사·테스트·문서화 작업은 분리된 context의 subagent로 병렬화할 수 있고, 결과는 주 작업으로 돌아와야 한다. 중간 artifact를 보존하고, timeout이나 환경 오류 후에는 어디까지 진행됐는지 알아야 한다.

이번 발표에서 말하는 managed harness는 바로 이 실행 수명주기의 일부를 제공한다. OpenAI는 장기 세션의 자동 context compaction, tool search, code로 병렬 호출을 조합하는 programmatic tool calling, subagent orchestration을 설명한다. sandbox도 OpenAI hosted 환경, 자체 인프라, 파트너 환경 가운데 고를 수 있다. 즉 팀은 모든 task를 독립적인 request/response prompt chain으로 쪼개는 대신, 하나의 지속 session을 중심으로 workflow를 설계할 선택지를 얻는다.

그러나 compaction이 문맥을 관리한다고 해서 제품의 사실 원본을 보존하는 것은 아니다. tool search가 schema 토큰을 줄인다고 해서 사용 권한을 검증하는 것도 아니다. subagent가 병렬 실행된다고 해서 같은 리소스를 동시에 수정해도 안전한 것도 아니다. 이를 구분하지 않으면 편리한 기반 기능이 business workflow의 무결성 보장처럼 오해된다.

### 2) 관리형이어도 책임은 네 경계에 남는다

agent가 파일을 읽고, 테스트를 실행하고, external API를 부르고, 티켓을 수정하는 흐름에는 적어도 네 주체가 있다. 아래 표를 architecture review의 출발점으로 삼을 수 있다.

| 경계 | 관리형 harness가 도울 수 있는 일 | 제품·플랫폼 팀이 계속 결정할 일 |
| --- | --- | --- |
| Session·orchestration | context compaction, tool selection, subagent lifecycle | 업무 단계, 성공 정의, 재개 가능 state, cancel semantics |
| Compute·sandbox | 파일·명령 실행 환경, resource profile, 격리 기본값 | 어떤 repo·network·secret을 넣는지, egress allowlist, data residency |
| Tool·identity | MCP/function 연결 방식, 호출 기록 | tool별 최소 권한, actor identity, token scope·rotation, rate limit |
| Business outcome | artifact를 만들고 결과를 제시 | 변경 승인, idempotency, 원장 기록, 고객 영향, rollback·법적 보존 |

특히 sandbox와 identity를 같은 "환경 설정"으로 합치면 안 된다. sandbox가 process를 격리해도 그 안에 넓은 production credential을 넣으면 도구는 여전히 넓은 권한으로 동작한다. 반대로 좁은 token을 써도 unrestricted network와 write 가능한 shared volume을 주면 의도치 않은 유출·변경 경로가 생긴다. OpenAI의 Codex 운영 사례가 sandbox, approval, network policy, identity/credentials, agent-native telemetry를 각각 별도 control surface로 다루는 이유도 여기에 있다.

### 3) 긴 run은 요청이 아니라 실행 계약으로 기록해야 한다

"지난 30분의 5xx를 조사해 줘"는 사람에게는 충분한 업무 지시처럼 보일 수 있다. 운영 시스템에는 부족하다. 어느 서비스·환경을 읽는지, 로그 원문에 고객 데이터가 있는지, agent가 restart를 제안만 하는지 실행도 하는지, 얼마나 오래·얼마나 많은 tool call을 허용하는지, 최종 산출물을 누가 승인하는지가 빠져 있기 때문이다.

한 run에 아래처럼 짧은 execution contract를 붙이면 agent의 추론 내용과 운영 책임을 분리할 수 있다.

```yaml
run_id: incident-investigation-20260928-042
intent: "checkout-api 5xx 급증 원인 조사; 변경은 수행하지 않음"
scope:
  environment: staging
  services: [checkout-api, payment-adapter]
  time_window: "last 30m"
tools:
  allow: [metrics.read, logs.read, traces.read, repo.read]
  deny: [deploy.write, secret.read, ticket.publish]
budget:
  wall_clock_minutes: 20
  tool_calls: 80
  spend_usd: 3
completion:
  required_artifacts: [query-links, timestamped-findings, reproduction-steps]
  human_approval_required: true
  success_rule: "evidence links exist; no external state changed"
```

이 문서는 agent에게 더 자세한 prompt를 주기 위한 장식이 아니다. timeout, 비용 초과, tool denied, partial result, user cancel을 구분하고 재시도·재개·감사의 기준으로 쓰는 runtime state다. 실제 side effect가 있다면 `idempotency_key`, target revision, precondition, rollback action, approver를 더해야 한다. 예를 들어 "의존성 업데이트 PR 생성"은 repository branch와 pull request라는 외부 상태를 바꾼다. run이 timeout 후 다시 시작돼도 PR 두 개가 생기지 않도록 target과 receipt를 기준으로 deduplicate해야 한다.

### 4) 성공은 agent의 완료 문장이 아니라 evidence bundle이다

agent가 "문제를 해결했다"고 말해도, query가 잘못된 time range를 썼거나 test가 fixture만 통과했거나, 수정이 deployment에 반영되지 않았을 수 있다. 따라서 run 완료 상태는 model output과 분리해야 한다. 읽기 작업이라면 query link, input time window, 조회 시각, data source revision, hypothesis와 반증을 남긴다. 코드 작업이라면 diff, test command와 exit status, 변경 전후 테스트, reviewer decision, artifact hash를 남긴다. 쓰기 작업이라면 target ID, precondition 결과, actor, 승인 기록, idempotency key, rollback 상태가 추가된다.

이 구조는 [Execution Receipt 운영 플레이북](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)의 핵심과 같다. receipt가 없으면 run을 재시도했을 때 "아직 안 했는지", "성공했지만 응답을 잃었는지", "일부만 적용됐는지"를 구분할 수 없다. 관리형 harness가 session을 내구성 있게 유지해도 업무의 성공 판정과 audit evidence를 자동으로 선택해 주지는 않는다.

## 실무 적용

### 1) autonomy 수준이 아니라 위험 표면으로 첫 workload를 고른다

도입 첫 대상은 "에이전트가 잘하는 일"보다 읽기 범위·외부 변경·민감 데이터·rollback 난이도를 설명하기 쉬운 일을 고른다. 다음 네 단계가 실무적인 출발점이다.

1. **read-only 조사**: 제한된 staging metric·로그·repo에서 원인 후보와 evidence를 수집한다. 외부 상태를 바꾸지 않으므로 execution contract와 artifact 형식을 검증하기 좋다.
2. **격리된 artifact 생성**: branch나 임시 workspace에 문서·test·patch 초안을 만든다. merge·publish는 사람이 결정한다.
3. **가역적인 내부 write**: sandbox 내 fixture 생성, 임시 티켓 draft처럼 TTL·owner·undo가 있는 상태만 바꾼다.
4. **승인된 production action**: feature flag 변경, 배포, 고객 통지는 별도 approval·precondition·idempotency·rollback receipt가 있을 때만 다룬다.

여기서 4단계는 1~3단계의 자연스러운 보상이 아니다. 결제·보안·개인정보·삭제 같은 작업은 low-risk 작업의 성공률이 높아도 별도 심사를 받아야 한다. 특히 "agent가 이전에도 잘했다"는 평가는 권한 확대 근거가 아니다. 위험은 행동의 종류와 blast radius에서 오기 때문이다.

### 2) rollout gate에 품질·보안·비용·복구를 함께 둔다

첫 2주 canary에서는 run 수보다 관측 가능한 결과를 본다. 아래 수치는 팀이 시작점으로 조정할 수 있는 예시다.

| 지표 | canary 통과 기준 예시 | 중단 또는 축소 조건 |
| --- | --- | --- |
| evidence-complete rate | 완료 run의 98% 이상 | artifact·query·test 증거 누락 2회 연속 |
| unauthorized tool attempt | 0건 | 1건이라도 scope·policy를 재검토 |
| task acceptance rate | 사람 검토에서 85% 이상 | 같은 failure mode가 3회 반복 |
| run p95 duration | 계약 budget 안 | timeout 비율 5% 초과 |
| cost per accepted run | baseline 대비 +15% 이내 | 비용 증가 원인이 설명되지 않음 |
| duplicate side effect | 0건 | idempotency/receipt 수정 전 write 확대 금지 |
| rollback drill | 가역 write의 100% 성공 | rollback target·owner가 불명확 |

acceptance rate만 높아도 부족하다. agent가 항상 보수적으로 "확인 불가"라고 답하면 안전해 보이지만 운영 가치가 낮을 수 있다. 반대로 속도가 빨라도 evidence 누락과 permission denial이 많으면 큰 workflow로 확대하면 안 된다. [Agentic Capacity SLO](/posts/2026-06-29-agentic-capacity-slo-trend/)처럼 queue wait, active run, cancellation, error class도 workload별로 나누어 추적해야 원인을 capacity와 품질 문제로 구분할 수 있다.

### 3) 환경 선택은 compute 위치보다 데이터 흐름으로 판단한다

관리형 API가 hosted sandbox, 자체 인프라, 파트너 sandbox 같은 선택지를 제공하더라도 "어디서 code가 실행되는가"만 보면 부족하다. run이 읽는 repo·artifact·vault·MCP server, tool이 보내는 request, log와 trace가 저장되는 backend, 사람이 받는 결과물까지 그려야 한다. 

간단한 시작 기준은 다음과 같다. 공개 오픈소스나 합성 fixture만 다루고 egress가 제한된 조사라면 hosted sandbox가 빠른 canary가 될 수 있다. private source와 지역·network 경계가 중요한 경우에는 VPC 또는 self-hosted 환경을 우선 검토한다. 하지만 self-hosted라고 해서 안전한 것은 아니다. broad kubeconfig, shared production volume, unrestricted egress를 준다면 위치만 바뀌고 위험은 남는다. 환경을 고른 뒤에는 allowlist, secret injection 방식, artifact retention, log redaction, emergency revoke를 실제 run으로 검증한다.

### 4) harness upgrade를 모델 upgrade와 별개로 시험한다

관리형 harness는 모델 출시와 함께 개선될 수 있다. 이는 성능 향상 기회이지만 workflow output의 모양이 바뀔 수 있다는 뜻이기도 하다. context compaction 요약 방식, tool search 선택, subagent 분할, retry 순서가 달라지면 같은 prompt가 다른 도구·비용·artifact를 만들 수 있다.

그래서 version 변화는 단순 SDK patch가 아니라 workflow regression 후보로 취급한다. 대표 task 20~50개에 대해 tool trace, success rubric, evidence completeness, latency, token/tool cost, denied action을 비교한다. 고위험 run은 새로운 harness version에서 shadow 또는 read-only mode를 먼저 통과한 뒤 승격한다. [Agent Quality Flywheel과 Eval Runtime](/posts/2026-07-07-agent-quality-flywheel-eval-runtime-trend/)에서 말하는 eval은 모델 답변의 점수만이 아니라, 실제 tool path와 evidence 품질까지 포함해야 한다.

## 트레이드오프/주의점

1. **구현 부담이 줄면 platform 종속성은 더 중요해질 수 있다.** session format, artifact API, sandbox image, audit export, pricing·quota, region을 exit plan과 함께 inventory한다.
2. **자동 compaction은 장기 기억과 다르다.** 중요한 업무 상태·승인·원장은 application의 durable store와 명시적 receipt에 남겨야 한다. 요약된 context만으로 재개 판단을 하지 않는다.
3. **subagent 병렬화는 속도와 경쟁 조건을 함께 키운다.** 같은 branch, rate-limited API, ticket, deployment target을 여러 worker가 만지지 않도록 lease·scope·merge owner를 둔다.
4. **sandbox는 side effect를 없애지 않는다.** network 호출, OAuth token, connected MCP tool, 외부 issue tracker는 sandbox 밖의 상태를 바꿀 수 있다. action별 approval과 precondition이 필요하다.
5. **beta 기능의 운영 계약은 더 보수적이어야 한다.** API·quota·호환성 변화에 대비해 timeout·fallback·export·runbook을 준비하고, provider의 지속 session을 유일한 업무 기록으로 삼지 않는다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 첫 workflow의 scope, 환경, 허용·금지 도구, time/tool/cost budget, 완료 artifact, 성공·실패 상태를 execution contract로 기록했다.
- [ ] harness, sandbox, tool, identity, business outcome의 owner와 incident 연락 지점을 분리했다.
- [ ] secret·PII·production write가 들어가는 경로를 inventory하고, egress·retention·redaction·revoke 정책을 실제 run으로 검증했다.
- [ ] write action에는 precondition, approval, idempotency key, target receipt, rollback action을 둔다.
- [ ] 완료 판정이 agent narrative가 아니라 query/test/artifact/approval evidence로 이뤄진다.
- [ ] read-only canary에서 evidence completeness, unauthorized attempt, acceptance, duration, cost, duplicate side effect를 baseline과 비교했다.
- [ ] model 또는 harness version 변경을 대표 task regression suite와 shadow run으로 검증한다.

### 연습: incident 조사 agent의 경계 정하기

"API 오류율 상승을 조사하는 agent"를 설계해 보자. 먼저 metrics·logs·traces에 대해 필요한 read scope만 적고, deploy·feature flag·ticket publish는 왜 금지 또는 approval 대상인지 설명한다. 다음으로 20분의 시간 예산과 80회의 tool budget을 넘었을 때 partial result에 무엇을 남길지 정한다. 마지막으로 원인 후보를 세 개 제시했지만 확정하지 못한 run을 성공·부분 완료·실패 중 어디로 분류할지, 그리고 사람이 다음에 받을 evidence bundle을 작성해 보자.

## 마무리

managed agent harness의 가치는 orchestration을 덜 만드는 데 있다. 반면 운영 가능한 agent의 가치는 누가 무엇을 했고, 어떤 권한으로, 어떤 증거와 비용으로, 실패하면 어떻게 되돌릴 수 있는지를 설명하는 데서 나온다. 플랫폼이 context와 실행을 맡을수록 팀은 업무 계약과 책임 경계를 더 작고 명확하게 만들어야 한다. 그 균형이 긴 session을 실제 제품 workflow로 바꾸는 출발점이다.
