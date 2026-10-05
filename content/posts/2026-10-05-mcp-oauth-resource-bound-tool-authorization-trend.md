---
title: "2026 개발 트렌드: MCP OAuth는 연결 한 번이 아니라 리소스·도구별 권한 위임 계약이 된다"
date: 2026-10-05T10:06:00+09:00
lastmod: 2026-10-05T10:06:00+09:00
draft: false
tags: ["MCP", "OAuth", "AI Agents", "Authorization", "Tool Security", "Platform Engineering"]
categories: ["Development", "AI Engineering", "Security"]
series: "2026 개발 운영 트렌드"
keywords: ["MCP OAuth authorization", "resource-bound token", "AI agent tool permissions", "MCP server security", "delegated authorization"]
description: "원격 MCP 서버가 늘수록 인증을 한 번 연결하는 경험보다, 어떤 agent가 어떤 리소스의 어떤 tool action을 어느 시간까지 실행할 수 있는지 OAuth scope·audience·승인·감사로 증명하는 운영 계약이 중요해지는 이유를 정리합니다."
summary: "MCP 연결 성공은 권한 설계의 시작일 뿐이다. 원격 tool은 데이터와 외부 효과를 가진 API이므로, 토큰의 수신자·scope·수명·사용자 승인·도구 호출 증거를 분리하지 않으면 하나의 편한 연결이 광범위한 대리 권한으로 바뀐다."
key_takeaways:
  - "MCP access token은 agent가 로그인했다는 표시가 아니라 특정 resource server와 제한된 action을 향한 위임 증명이어야 한다."
  - "도구 목록 discovery, read-only 조회, 외부 전송·배포·삭제는 같은 승인과 같은 token TTL을 쓰면 안 된다."
  - "scope만 넓게 적는 것보다 audience/resource binding, tool allowlist, parameter policy, step-up approval을 조합해야 실제 권한 반경이 좁아진다."
  - "운영 지표는 연결 수보다 denied action, scope escalation, token audience mismatch, approval-to-effect trace coverage를 우선 봐야 한다."
operator_checklist:
  - "MCP server마다 canonical resource identifier, authorization server, 허용 audience, tool·action scope 표를 유지한다."
  - "새 연결은 read-only discovery에서 시작하고, write·external-send·delete는 별도 scope와 짧은 TTL·재승인을 요구한다."
  - "tool call audit event에 actor, agent/run ID, token scope 요약, tool name, policy decision, effect reference를 남긴다."
---

MCP 연결 화면은 대개 단순합니다. 서버를 고르고 로그인한 뒤 도구 목록이 보이면 끝난 것처럼 느껴집니다. 그러나 원격 MCP 서버는 파일, 이슈, 배포, 고객 데이터, 브라우저 세션처럼 실제 상태를 읽거나 바꾸는 API 표면입니다. 에이전트가 그 도구를 호출할 수 있다는 사실은 편의가 아니라 **누구의 권한으로 어떤 리소스에 어떤 효과를 낼 수 있는가**라는 위임 문제입니다.

그래서 MCP 운영의 초점은 “OAuth 연결을 지원하는가”에서 한 단계 이동하고 있습니다. 중요한 것은 한 번의 로그인으로 광범위한 token을 주는 것이 아니라, tool 호출마다 resource audience, scope, 사용자 승인, 정책, 감사 증거가 같은 방향을 가리키게 만드는 일입니다. 이 글은 [MCP Stateless Tool Contract](/posts/2026-06-23-mcp-stateless-tool-contract-trend/), [Agent Plugin·MCP Governance Contract](/posts/2026-08-22-agent-plugin-mcp-governance-contract-trend/), [Managed Agent Harness Ownership Boundary](/posts/2026-09-28-managed-agent-harness-ownership-boundary-trend/), [Agent Resource Provenance Gate](/posts/2026-07-13-agent-resource-provenance-gate-trend/)를 OAuth 권한 위임 관점에서 연결합니다.

## 이 글에서 얻는 것

- MCP의 인증과 인가를 “연결 성공”과 “실제 tool action 허용”으로 분리하는 기준을 얻습니다.
- resource/audience, scope, tool allowlist, parameter policy가 각각 막는 위험을 구분합니다.
- read-only discovery와 외부 효과가 있는 tool을 다른 수명·승인·감사 정책으로 운영하는 방법을 배웁니다.
- agent run부터 실제 effect까지 추적 가능한 권한·증거 모델을 설계합니다.

## 핵심 개념/이슈

### 1) Access token의 대상은 agent 일반이 아니라 resource server다

“이 agent에 Jira와 GitHub를 연결했다”는 표현은 운영상 너무 넓습니다. 토큰은 어느 resource server가 받아야 하는지, 무엇을 할 수 있는지, 누가 위임했는지까지 제한해야 합니다. 같은 조직 계정으로 발급된 token이라도 issue tracker용 token이 source repository, cloud console, 고객 DB까지 통과할 이유는 없습니다.

| 층 | 답해야 할 질문 | 실패하면 생기는 일 |
| --- | --- | --- |
| Resource/audience | 이 토큰을 받아야 하는 MCP server 또는 API는 어디인가 | 다른 server가 token을 넓게 해석 |
| Scope | 읽기·작성·배포·관리 중 정확히 무엇을 허용하는가 | `write` 하나가 고위험 action까지 포함 |
| Tool policy | 허용 scope 안에서 어떤 tool·parameter가 가능한가 | branch 보호 변경·secret 노출 |
| Approval/effect | 누가 언제 확인했고 어떤 외부 효과를 냈는가 | 사고 뒤 책임과 원인 추적 불가 |

scope는 필요하지만 충분하지 않습니다. `files:write`가 있어도 특정 workspace의 특정 경로에만 쓰게 해야 할 수 있고, `issues:write`가 있어도 public comment·assignee 변경·label 수정은 서로 다른 위험을 가집니다. scope는 API의 큰 문을 여는 장치, tool allowlist와 parameter policy는 방 안에서의 행동 범위를 줄이는 장치로 보는 편이 정확합니다.

### 2) Discovery 권한과 외부 효과 권한을 분리한다

에이전트는 작업하기 전에 tool schema, 리포지터리 목록, issue metadata, 검색 결과를 살펴봅니다. 이 discovery 경로와 PR merge, 고객 메일 발송, 배포, 삭제는 같은 token TTL과 승인 화면을 공유하면 안 됩니다. 권장 출발점은 세 단계입니다.

1. **Discovery**: server 정보, tool schema, 비민감 metadata만 조회합니다. 짧은 read token 또는 public metadata로 제한합니다.
2. **Read/plan**: 지정한 project·tenant 안의 조회와 제안 작성입니다. 데이터 등급에 따라 마스킹·페이지 제한·감사 로그를 붙입니다.
3. **Effect**: 외부 전송, merge, deployment, 삭제, 권한 변경처럼 되돌리기 어려운 action입니다. 별도 scope, 짧은 TTL, 명시적 대상 확인과 승인 reference가 필요합니다.

이 구분은 [MCP Stateless Tool Contract](/posts/2026-06-23-mcp-stateless-tool-contract-trend/)의 구조화된 tool result와도 연결됩니다. 결과와 parameter가 구조화되어야 policy engine이 tool name과 입력을 보고 위험도를 계산할 수 있습니다. 문자열 프롬프트 안에 “배포해도 된다”가 들어 있는 구조에서는 정확한 allow/deny가 어렵습니다.

### 3) Agent identity와 delegated user identity를 섞지 않는다

사람이 agent에게 “이 이슈를 조사해 줘”라고 요청했고, agent가 MCP tool을 호출했다고 가정해 보겠습니다. 감사 로그에는 사람이 누구인지, agent runtime이 무엇인지, 어떤 run이었는지, 최종 token의 scope가 무엇인지가 함께 남아야 합니다. 사람 신원만 남기면 agent의 model·tool·policy 버전을 추적할 수 없고, agent 신원만 남기면 권한을 위임한 책임 주체가 사라집니다.

```yaml
tool_authorization_event:
  actor_subject: user_123
  delegated_client: research-agent
  agent_run_id: run_20261005_018
  resource: mcp://issue.example.internal
  token_scope: [issues.read]
  tool: search_issues
  decision: allow
  policy_version: tool-policy-42
  approval_ref: null
  effect_ref: null
```

`deploy_release`나 `send_external_message`라면 `approval_ref`와 실제 배포 ID·message ID 같은 `effect_ref`가 비어 있으면 안 됩니다. [Managed Agent Harness Ownership Boundary](/posts/2026-09-28-managed-agent-harness-ownership-boundary-trend/)의 ownership 관점에서 보면, 모델이 호출을 생성해도 token 발급·policy evaluation·외부 효과 기록의 owner는 플랫폼이 명확히 가져야 합니다.

## 실무 적용

### 1) MCP server별 권한 표부터 만든다

새 server를 붙일 때 OAuth provider와 scope 이름만 문서화하면 부족합니다. 아래처럼 무엇을 열고 무엇을 보류하는가를 tool 단위로 남깁니다.

| 위험 등급 | 예시 tool | 최초 정책 | TTL/승인 | 관측 기준 |
| --- | --- | --- | --- | --- |
| L0 | `list_tools`, public schema | 자동 허용 | 30~60분, 무승인 | discovery error rate |
| L1 | project read/search | allowlist project만 | 15~30분, 무승인 | data-deny·redaction |
| L2 | issue draft·branch 생성 | parameter 검증 | 5~15분, 작업 시작 확인 | denial·rework |
| L3 | merge·deploy·외부 전송·삭제 | default deny | 5분 이하, action별 승인 | approval-to-effect coverage |

숫자는 고정 정답이 아닙니다. 핵심은 L3에 L0과 같은 무기한 connection token을 쓰지 않는 것입니다. 시작 시에는 L2 이상을 proposal-only 또는 dry-run으로 두고, 대표 작업에서 false deny와 누락된 parameter rule을 확인한 뒤 좁게 엽니다. [Agent Plugin·MCP Governance Contract](/posts/2026-08-22-agent-plugin-mcp-governance-contract-trend/)가 강조하듯, 표준 protocol이라는 사실은 publisher 신뢰나 permission safety를 보장하지 않습니다.

### 2) Audience와 canonical resource를 검증한다

원격 tool 환경에는 비슷한 이름의 server, 테스트와 production host, region별 endpoint가 섞입니다. 사용자가 `issues.company.example`을 승인했다고 생각했는데 agent가 staging 또는 lookalike endpoint로 token을 보낸다면 연결 경험이 아무리 매끄러워도 경계가 틀어진 것입니다.

authorization 요청부터 token 검증, tool dispatch까지 canonical resource identifier를 유지합니다. 허용 host를 정규화하고 redirect마다 다시 비교하며, token audience와 수신 MCP server가 다르면 즉시 거절합니다. [Agent Resource Provenance Gate](/posts/2026-07-13-agent-resource-provenance-gate-trend/)의 원칙처럼 “발견한 server”와 “조직이 허용한 server”를 같은 것으로 가정하지 않는 것이 중요합니다. resource mismatch를 일반 401로만 묻지 말고 별도 보안 지표로 집계해야 설정 drift와 악성 연결 시도를 구분할 수 있습니다.

### 3) Tool parameter는 token scope의 빈틈을 메운다

scope에 `repository.write`가 있어도 agent가 workflow, production config, secret reference를 수정할 수 있는지는 별도 정책입니다. 완벽한 자연어 risk classifier보다 정적인 고위험 parameter를 먼저 막는 편이 효과적입니다.

- 보호 branch와 release tag는 merge·force push tool에서 기본 거부합니다.
- `production`, `billing`, `customer-export` selector는 action approval reference 없이는 허용하지 않습니다.
- 외부 URL, webhook, recipient list는 normalized allowlist와 egress policy를 함께 통과시킵니다.
- tool output의 token, cookie, 개인정보는 원문 telemetry가 아니라 category·길이·차단 결과로만 남깁니다.

이는 agent를 불신해서 기능을 못 쓰게 하자는 뜻이 아닙니다. 자율적인 read와 reversible draft는 빠르게 허용하고, 비용·권한·외부 효과가 생기는 경계에만 확인점을 둡니다. 그래야 사람이 매번 모든 tool call을 읽는 병목 없이도 위험을 좁힐 수 있습니다.

## 트레이드오프/주의점

권한을 너무 잘게 쪼개면 agent 경험은 불편해집니다. 매 작업마다 OAuth 로그인과 승인을 요구하면 사용자는 결국 넓은 scope나 영구 token을 요구하게 됩니다. 낮은 위험 read 범위는 짧은 TTL의 reusable grant로 묶고, 외부 효과만 action-level approval으로 분리하는 균형이 필요합니다.

반대쪽 위험도 큽니다. “사내 MCP server이므로 신뢰한다”는 정책은 compromised server, 잘못된 tool schema, stale DNS·redirect 설정이 넓은 권한을 소비하도록 만들 수 있습니다. 내부라는 이유로 audience 검증, publisher provenance, server version, egress 제한을 빼면 안 됩니다. 특히 tool discovery가 반환하는 설명문과 schema는 비신뢰 입력으로 취급해야 합니다. 에이전트가 이를 읽는다고 해서 그 안의 명령이 policy가 되는 것은 아닙니다.

감사 로그도 무작정 많이 남기면 해결되지 않습니다. full prompt, full argument, full result를 모두 export하면 개인정보와 credential이 새 telemetry 경로로 이동합니다. 운영에 필요한 것은 actor, resource, tool, decision, latency, effect reference, redaction count 같은 구조화된 메타데이터입니다. 원문 증거가 꼭 필요한 incident 경로만 접근 통제·짧은 보존·별도 승인으로 분리해야 합니다.

## 체크리스트 또는 연습

- [ ] 각 MCP server에 canonical resource identifier, 허용 audience, authorization server, owner가 있다.
- [ ] discovery, read, reversible write, 외부 효과 action이 다른 scope·TTL·승인 정책을 쓴다.
- [ ] token audience가 현재 MCP server와 맞지 않으면 dispatch 전에 거절한다.
- [ ] high-risk tool은 allowlist, protected selector, parameter validation, action approval 중 둘 이상을 통과한다.
- [ ] audit event에 user subject, agent/runtime, run ID, resource, scope 요약, tool, decision, effect reference가 남는다.
- [ ] prompt·tool argument·result 원문이 기본 telemetry로 유출되지 않으며 redaction 테스트가 있다.
- [ ] 대표 작업 20개 이상으로 allow, deny, token expiry, audience mismatch, 승인 취소, schema 변경을 회귀 검증한다.

이번 주에는 연결된 MCP server 하나만 골라 tool을 L0~L3로 분류해 보세요. 이어서 가장 위험한 tool 하나에 대해 “어떤 resource의 어떤 parameter가 실제 외부 효과를 내는가”, “그 효과의 ID를 어디에 남길 것인가”, “승인이 취소되면 다음 호출을 어떻게 막을 것인가”를 적으면 됩니다. 이 세 질문에 답할 수 있다면 OAuth 연결은 편리한 로그인에서 벗어나, agent가 실제 업무 시스템 안에서 책임 있게 움직이게 하는 권한 계약이 됩니다.
