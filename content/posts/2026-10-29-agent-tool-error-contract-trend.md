---
title: "2026 개발 트렌드: AI 에이전트의 툴 실패를 자연어가 아닌 오류 계약으로 운영하기"
date: 2026-10-29T10:06:00+09:00
lastmod: 2026-10-29T10:06:00+09:00
draft: false
tags: ["AI Agents", "Developer Tools", "Tool Contract", "Reliability", "Observability", "Platform Engineering"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["AI agent tool error contract", "agent retry safety", "tool failure taxonomy", "agent workflow observability", "MCP tool error handling"]
description: "AI 에이전트가 도구를 호출하는 환경에서 실패를 긴 자연어 설명으로 넘기지 않고, 재시도 가능성·side effect·근거·다음 행동을 가진 오류 계약으로 운영하는 기준을 정리합니다."
summary: "에이전트의 도구 호출이 많아질수록 장애는 모델의 답변 품질보다 timeout·권한 거부·부분 성공·중복 실행을 어떻게 해석하는가에서 발생한다. 안전한 시스템은 실패를 한 문장의 오류로 뭉개지 않고, 재시도 가능성·실행 여부·불확실성·복구 경로를 구조화해 오케스트레이터와 사람이 같은 결정을 내리게 한다."
key_takeaways:
  - "에이전트 툴 오류에는 HTTP 상태나 예외 문자열만으로 부족하다. 작업이 실제로 실행됐는지, side effect가 일어났는지, 같은 idempotency key로 재시도해도 되는지를 함께 반환해야 한다."
  - "timeout은 실패가 아니라 불확실한 결과 상태일 수 있다. 재시도 전에는 실행 receipt·대상 조회·idempotency ledger로 이미 적용됐는지 확인해야 한다."
  - "오류 taxonomy는 모델이 더 그럴듯한 설명을 하게 만드는 장치가 아니라, 자동 재시도·사람 승인·중단을 일관되게 분기하는 운영 인터페이스다."
---

AI 에이전트가 repository 검색, CI 실행, issue 생성, cloud 조회, 브라우저 조작처럼 여러 도구를 연속 호출하면 성공 경로보다 실패 경로가 더 중요해집니다. 현재 많은 도구는 `500 error`, `permission denied`, `tool timed out` 같은 문자열을 돌려줍니다. 사람에게는 단서가 될 수 있지만 orchestrator에는 충분하지 않습니다. timeout 뒤에 실제 배포가 시작됐는지, 권한 거부가 영구적인지 잠시 후 갱신될 token 문제인지, 파일 쓰기가 일부만 끝났는지 알 수 없기 때문입니다.

그래서 최근 agent runtime에서 필요한 변화는 더 친절한 오류 메시지가 아니라 **오류를 다음 행동의 계약으로 만드는 일**입니다. 이 글은 [MCP의 Stateless Tool Contract](/posts/2026-06-23-mcp-stateless-tool-contract-trend/), [AI Agent Observability Evidence Contract](/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/), [Agent-to-Agent 위임의 권한·Receipt 계약](/posts/2026-10-28-agent-to-agent-delegation-authority-receipt-trend/), [Execution Receipt로 Agent 작업을 검증하는 법](/posts/2026-04-14-execution-receipt-agent-operations-trend/)을 실패 처리 관점에서 연결합니다.

## 이 글에서 얻는 것

- tool failure를 재시도, 상태 조회, 사람 승인, 즉시 중단으로 분기하는 최소 taxonomy를 설계할 수 있습니다.
- timeout·네트워크 단절처럼 “실패했는지 알 수 없는” 결과를 안전하게 처리하는 방법을 배웁니다.
- 모델의 자연어 요약과 기계가 읽는 오류 envelope를 분리해, 중복 side effect와 무한 retry를 줄일 수 있습니다.
- 작은 팀이 핵심 tool부터 오류 계약을 도입할 때의 숫자 기준과 rollout 순서를 얻습니다.

## 핵심 개념/이슈

### 1) 실패 원인과 실행 결과는 별개의 축이다

`timeout`이라는 오류는 “아무 일도 일어나지 않았다”를 뜻하지 않습니다. 원격 API가 요청을 받고 DB를 갱신한 뒤 응답 경로만 끊겼을 수 있습니다. `permission denied`도 현재 credential이 잘못됐다는 뜻일 수 있고, policy가 의도적으로 막았다는 뜻일 수 있습니다. 두 경우의 다음 행동은 완전히 다릅니다.

따라서 tool 결과는 최소한 아래 두 질문에 답해야 합니다. 요청이 실행됐는가? `not_started`, `started_unknown`, `partially_completed`, `completed` 중 어디인가? 같은 작업을 다시 해도 되는가? 재시도 가능 여부, idempotency key, 상태 조회 방법은 무엇인가? 예를 들어 다음 오류 envelope는 예외 문자열보다 적은 추측으로 다음 단계를 정하게 합니다.

```yaml
status: uncertain
code: REMOTE_TIMEOUT_AFTER_ACCEPT
retry:
  allowed: false
  reason: "write may have been accepted"
  next_action: "query_by_idempotency_key"
execution:
  state: started_unknown
  idempotency_key: "notify:invoice-819:2026-10-29"
evidence:
  request_id: "req_7df1"
  remote_operation: "mail-88412"
user_safe_message: "발송 결과를 확인 중입니다. 재전송하지 않았습니다."
```

핵심은 `status: uncertain`입니다. 성공과 실패 사이의 불확실성을 표현하지 못하면 orchestrator는 성공으로 덮거나 실패로 보고 재시도합니다. 외부 메일, 결제, 권한 변경, PR 생성처럼 중복 비용이 큰 작업에서는 둘 다 위험합니다.

### 2) HTTP 상태 코드를 agent 정책으로 그대로 복사하면 안 된다

HTTP의 `429`, `401`, `403`, `409`, `5xx`는 유용한 신호이지만 tool의 업무 의미를 모두 담지 않습니다. 같은 `409`도 “이미 같은 PR이 존재함”이면 정상 no-op으로 닫을 수 있지만, “기대한 revision이 달라졌음”이면 새 입력을 읽고 사람이 재판단해야 합니다. `503`도 읽기 조회는 지수 backoff로 재시도할 수 있지만, 결제 승인 요청은 먼저 원격 operation 조회가 필요합니다.

초기 taxonomy는 복잡한 수십 개 코드보다 다음 다섯 lane이면 충분합니다.

| lane | 예시 | 기본 자동 행동 | 사람이 볼 정보 |
| --- | --- | --- | --- |
| `retry_safe` | rate limit, 일시적 read timeout | 제한된 backoff 재시도 | 시도 횟수·다음 retry 시각 |
| `reconcile_first` | write timeout, callback 유실 | 상태 조회 후에만 재시도 | idempotency key·원격 operation ID |
| `input_stale` | base revision mismatch, expired plan | 입력 갱신 뒤 재계획 | 기준 revision·변경 시각 |
| `policy_blocked` | 권한·scope·승인 거부 | 자동 우회 금지 | 정책 ID·필요 승인·만료 |
| `manual_investigation` | 부분 삭제, 데이터 불일치 | 자동 재시도·보상 중단 | 영향 대상·마지막 확정 evidence |

여기서 `policy_blocked`를 단순 실패로 취급하지 않는 것이 중요합니다. agent가 권한 부족을 발견한 뒤 다른 credential, 다른 도구, 우회 경로를 찾아보게 두면 정책은 권고가 됩니다. 정책 차단은 `blocked` receipt를 남기고 종료하는 것이 정상 동작입니다.

### 3) 재시도 정책은 오류 코드가 아니라 side effect 등급에서 시작한다

“3회 재시도”는 대부분의 도구에 적용할 수 있는 기본값이 아닙니다. 읽기 전용 검색과 `POST /payments`는 같은 timeout을 내도 위험도가 다릅니다. 실행 전 tool metadata에 side effect와 idempotency 특성을 선언해야 orchestrator가 일관되게 움직일 수 있습니다.

```yaml
tool: create_release_note
side_effect: external_write
idempotency:
  required: true
  lookup: "GET /release-notes/by-key/{key}"
timeout_policy:
  on_before_send: retry_safe
  on_after_send: reconcile_first
authority:
  approval_required: false
```

이 선언은 툴을 호출하는 프롬프트에 “실패하면 조심해서 재시도해”라고 쓰는 것보다 강합니다. runtime이 send 전·후의 관측 지점을 알고 `after_send` timeout에는 lookup을 강제할 수 있기 때문입니다. [MCP OAuth의 Resource-Bound 권한 위임](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)에서 다룬 것처럼 tool 권한도 대상·action·만료로 좁혀야 하지만, 권한이 맞다는 사실만으로 중복 실행이 안전해지지는 않습니다.

### 4) 자연어 설명은 사람을 위한 요약이고, 제어 신호가 아니다

에이전트는 “권한 오류가 발생했으니 잠시 후 다시 시도했습니다”처럼 그럴듯한 문장을 만들 수 있습니다. 하지만 그 문장은 실제 retry 횟수, 대상, 요청 ID, policy verdict를 증명하지 않습니다. tool runtime은 구조화된 envelope를 먼저 반환하고, 모델은 그 안의 허용된 필드만 사람이 읽기 쉬운 문장으로 요약해야 합니다.

이 분리를 하지 않으면 모델이 `manual_investigation`을 “일시적 오류”로 해석하거나, `policy_blocked`를 문제 해결 대상으로 바꾸기 쉽습니다. 반대로 structured result가 있으면 watchdog은 retry budget을 집계하고, UI는 승인 버튼을 보여 주며, 감사자는 왜 실행이 멈췄는지 재현할 수 있습니다. [Agent-to-Agent 위임의 receipt](/posts/2026-10-28-agent-to-agent-delegation-authority-receipt-trend/)가 자연어 완료 보고만으로 충분하지 않은 이유도 같습니다.

## 실무 적용

### 1) 실패가 잦거나 side effect가 큰 tool 다섯 개만 먼저 고른다

모든 integration의 오류를 한 번에 표준화하면 코드만 늘고 실사용 신호가 없습니다. 먼저 최근 30일 실패율이 1% 이상이거나 retry가 월 10회 이상 발생한 tool, 외부 write·credential 사용·비용 발생·production 변경이 있는 tool, timeout 뒤 상태를 사람이 수동 확인하는 tool, 중복 실행이 실제 문제였던 tool 중 4~5개를 고릅니다.

각 tool에 `side_effect`, `idempotency`, `execution_state`, `next_action`, `evidence_ref` 다섯 필드를 먼저 붙입니다. `error_message`를 없애라는 뜻은 아닙니다. 진단 메시지는 유지하되 automation이 메시지를 parse해서 정책을 정하게 만들지 않는 것이 목표입니다.

### 2) retry budget과 escalation 기준을 수치로 고정한다

초기 정책은 보수적으로 시작하세요. read-only `retry_safe` 호출은 최대 2회, 1초·4초 지수 backoff와 jitter를 적용하고, 같은 operation에서 5분 안에 3회 실패하면 자동 재시도를 멈춥니다. `reconcile_first`는 재시도 0회로 두고 status lookup을 1회만 수행합니다. lookup도 timeout이면 `manual_investigation`으로 승격합니다.

| 조건 | 자동 처리 | 승격 기준 |
| --- | --- | --- |
| read 호출의 429/503 | 2회 이내 backoff | 5분에 3회 실패 또는 retry-after 부재 |
| write 호출 전 네트워크 실패 | 같은 key로 1회 재시도 가능 | 호출이 원격에 도달했는지 불명확 |
| write 호출 후 timeout | 상태 조회만 수행 | 조회 실패·부분 완료·다른 결과 관측 |
| 권한/approval 거부 | 즉시 중단 | 정책 변경 또는 명시 승인 전에는 재시도 금지 |
| idempotency key 충돌 | 기존 결과 조회 | 대상·payload hash가 다르면 수동 조사 |

서비스별 SLO와 vendor 특성에 따라 값은 달라집니다. 중요한 것은 retry 수를 늘리는 것이 아니라, **동일한 불확실성에 항상 같은 다음 행동을 선택하는 것**입니다. 자동화가 조용히 20번 실패하는 것보다 2번의 증거 있는 실패가 낫습니다.

### 3) receipt를 실패에서도 남긴다

성공한 tool call만 audit log에 남기면 사고가 났을 때 가장 중요한 구간이 사라집니다. 실패 receipt에는 tool version, authority scope, target fingerprint, start/end time, retry count, execution state, idempotency key, evidence reference, stop reason을 남기세요. secret·사용자 원문·전체 payload는 넣지 않고 hash 또는 안전한 참조로 대체합니다.

```yaml
tool_run_id: tr_20261029_021
tool: publish_changelog
authority_scope: repo:docs / write:release-note
target_fingerprint: sha256:...
attempt: 1
result: blocked
code: POLICY_APPROVAL_REQUIRED
execution_state: not_started
next_action: request_approval
evidence_ref: policy://release-note/approval-required/v3
```

이 receipt가 있으면 다음 agent나 on-call 담당자는 “왜 안 됐나”뿐 아니라 “실제로 아무 것도 시작하지 않았나”를 구분할 수 있습니다. [Agent Observability Evidence Contract](/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/)의 trace·artifact·decision 연결은 실패 경로에서 더 큰 가치를 냅니다.

## 트레이드오프/주의점

첫째, taxonomy를 너무 세밀하게 만들면 tool 작성자가 코드를 고르는 데만 시간을 쓰고 서로 다른 팀이 같은 상태를 다르게 표현합니다. 처음에는 다섯 lane과 공통 필드만 강제하고, 2주간의 실제 error sample을 본 뒤 정말 다른 다음 행동을 요구하는 경우에만 코드를 나누세요.

둘째, `reconcile_first`는 안전하지만 조회 API·ledger·idempotency key가 없는 legacy system에서는 구현 비용이 있습니다. 이 경우 “자동 재시도 금지 + 사용자에게 불확실성 명시 + 운영자가 확인할 query/runbook 연결”이 성공을 추측하는 retry보다 낫습니다. reconciliation이 불가능한 write는 자동화 후보를 낮춰야 합니다.

셋째, 오류 envelope에 원본 request body, 인증 header, 고객 식별자를 넣으면 observability 자체가 유출 경로가 됩니다. `target_fingerprint`, 최소한의 resource ID, redacted error category를 기본으로 하고 민감 detail은 접근 통제된 로그에 분리하세요. 오류 데이터도 제품 데이터와 같은 retention·access 정책을 가져야 합니다.

마지막으로 실패를 구조화한다고 tool이 신뢰할 수 있게 되는 것은 아닙니다. runtime은 envelope schema를 검증하고, `execution_state: not_started`라고 주장하는 plugin의 실제 outbound audit event와 모순이 없는지 샘플링해야 합니다. third-party tool은 자기 보고를 증거가 아닌 주장으로 취급해야 합니다.

## 체크리스트 또는 연습

- [ ] 각 tool이 read, internal write, external write, privileged action 중 어느 side effect 등급인지 선언한다.
- [ ] timeout·disconnect 뒤 `not_started`와 `started_unknown`을 같은 실패로 뭉개지 않는다.
- [ ] 외부 write에는 idempotency key, 상태 조회 방법, retry 금지 조건이 있다.
- [ ] 오류는 `retry_safe`, `reconcile_first`, `input_stale`, `policy_blocked`, `manual_investigation` 중 하나로 분류된다.
- [ ] retry budget은 tool별로 수치화되어 있으며 상한을 넘으면 사람 또는 queue로 승격한다.
- [ ] 실패 receipt에도 authority scope, 대상 fingerprint, evidence reference, stop reason이 남는다.
- [ ] 오류 envelope와 log에 secret·원문 payload·불필요한 개인정보를 저장하지 않는다.

연습으로 현재 agent workflow에서 가장 위험한 write tool 하나를 고르세요. “응답 timeout”을 **전송 전, 원격 수신 직후, 원격 처리 뒤 응답 유실**로 나눠 각각 어떤 `execution_state`와 `next_action`을 반환할지 표로 만듭니다. 이 표가 없다면 재시도 규칙은 아직 정책이 아니라 희망에 가깝습니다.

## 관련 글

- [MCP의 Stateless Tool Contract](/posts/2026-06-23-mcp-stateless-tool-contract-trend/)
- [AI Agent Observability Evidence Contract](/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/)
- [Agent-to-Agent 위임의 권한·Receipt 계약](/posts/2026-10-28-agent-to-agent-delegation-authority-receipt-trend/)
- [Execution Receipt로 Agent 작업을 검증하는 법](/posts/2026-04-14-execution-receipt-agent-operations-trend/)
- [MCP OAuth의 Resource-Bound 권한 위임](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)
