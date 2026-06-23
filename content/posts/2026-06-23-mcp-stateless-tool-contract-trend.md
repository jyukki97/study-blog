---
title: "2026-06-23 개발 트렌드: MCP는 세션 기반 연결에서 검증 가능한 Tool Contract 인프라로 이동한다"
date: 2026-06-23T10:06:00+09:00
draft: false
tags: ["dev-trends", "MCP", "AI Agents", "Tool Contract", "Protocol", "Platform Engineering", "Security"]
categories: ["Development", "Tech Trend"]
description: "2026-07-28 MCP 릴리스 후보와 최신 tool shape 사례를 바탕으로, MCP가 단순 연결 표준에서 stateless·routable·schema-validated agent infrastructure로 이동하는 흐름을 정리합니다."
keywords: ["MCP stateless", "MCP tool contract", "AI agent governance", "tool output schema", "agent infrastructure"]
summary: "MCP는 도구 연결 표준에서 운영 가능한 agent API layer로 이동하고 있습니다. 핵심은 stateless routing, 구조화된 tool output, 권한 경계, 실행 receipt를 함께 설계하는 것입니다."
key_takeaways:
  - "MCP의 다음 변화는 더 많은 서버 연결보다 stateless routing, cacheable discovery, trace propagation 같은 운영 인프라 성격이 강하다."
  - "자동 실행되는 tool은 자연어 결과가 아니라 outputSchema, receipt id, rollback hint처럼 검증 가능한 출력 계약을 가져야 한다."
  - "tool shape는 개발 편의 기능이 아니라 read/write/admin/external-send 위험도를 나누는 거버넌스 경계다."
operator_checklist:
  - "production MCP server를 server 단위가 아니라 tool 단위로 inventory하고 risk class를 붙인다."
  - "write-capable tool에는 approval id, changed resource id, receipt id, rollback hint를 요구한다."
  - "대용량 결과와 파일은 raw context 주입 대신 resource_link, checksum, summary+fetch 구조로 전달한다."
  - "MCP gateway가 method/name/risk class 기준으로 rate limit, audit, trace propagation을 걸 수 있는지 확인한다."
learning_refs:
  - title: "MCP Apps와 Conversation-Native UI"
    href: "/posts/2026-05-15-mcp-apps-conversation-native-ui-trend/"
    description: "MCP tool이 UI 표면과 결합될 때 권한, 상태, 감사 경계를 어떻게 설계할지 이어서 봅니다."
  - title: "Tool Contract Test와 Schema Canary"
    href: "/posts/2026-04-30-tool-contract-test-agent-runtime-trend/"
    description: "tool input/output schema를 CI와 회귀 테스트로 검증하는 기준을 연결합니다."
  - title: "Execution Receipt"
    href: "/posts/2026-04-14-execution-receipt-agent-operations-trend/"
    description: "state-changing tool 호출 뒤 남겨야 할 실행 증거와 감사 단위를 구체화합니다."
faqs:
  - question: "MCP가 stateless해지면 상태 관리가 사라지나요?"
    answer: "아닙니다. protocol session 의존이 줄어드는 것이지 업무 상태가 사라지는 것은 아닙니다. 장기 작업, 파일 업로드, 승인 흐름은 명시적인 handle이나 resource id로 전달해야 합니다."
  - question: "모든 MCP tool에 outputSchema가 꼭 필요한가요?"
    answer: "사람이 읽고 끝나는 낮은 위험도의 조회 tool은 예외가 있을 수 있습니다. 하지만 자동 후속 실행, 상태 변경, 외부 전송, 관리자 작업에 연결되는 tool은 schema와 receipt가 사실상 필수입니다."
---

2026년 6월 현재 MCP(Model Context Protocol) 흐름에서 중요한 변화는 "AI 도구를 연결한다"는 초기 설명을 넘어섰다는 점입니다. 이제 핵심 질문은 어떤 서버를 붙일 수 있느냐가 아니라 **그 도구 호출을 어떻게 라우팅하고, 검증하고, 감사하고, 비용을 통제할 것인가**로 옮겨가고 있습니다.

공식 MCP 블로그는 2026-07-28 릴리스 후보를 공개하면서 stateless protocol core, extensions framework, Tasks, MCP Apps, authorization hardening, deprecation policy를 예고했습니다. 2026-06-23 기준 최종 스펙은 아직 2026-07-28 예정이므로 "이미 최종 반영됐다"가 아니라 "마이그레이션 검증 기간에 들어갔다"로 보는 게 정확합니다. 동시에 현재 MCP tool spec은 `outputSchema`, `structuredContent`, `resource_link` 같은 구조화된 결과 계약을 강조하고 있고, Microsoft Dataverse MCP Server 사례는 tool shape를 권한·감사·업무 경계의 단위로 설명합니다.

이 흐름은 이전에 정리한 [MCP Apps와 Conversation-Native UI](/posts/2026-05-15-mcp-apps-conversation-native-ui-trend/), [Tool Contract Test와 Schema Canary](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/), [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/), [AI 에이전트 관측성 증거 계약](/posts/2026-06-22-ai-agent-observability-evidence-contract-trend/)과 이어집니다. MCP는 더 이상 "에이전트용 플러그인 모음"이 아니라, 에이전트가 실제 시스템을 만지는 접점의 운영 표준으로 커지고 있습니다.

## 이 글에서 얻는 것

- MCP 2026-07-28 릴리스 후보가 왜 운영팀과 플랫폼팀에 중요한지 이해합니다.
- stateless core, `Mcp-Method`/`Mcp-Name` 라우팅, tool output schema가 어떤 실무 문제를 줄이는지 설명할 수 있습니다.
- tool shape를 권한, 감사, 비용, schema validation 단위로 설계하는 기준을 잡을 수 있습니다.
- MCP 서버를 운영 환경에 붙일 때 read-only 도구와 write-capable 도구를 다르게 다루는 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) MCP는 세션 기반 연결에서 HTTP 친화적 stateless core로 이동 중이다

초기 원격 MCP 서버 운영에서 부담이 컸던 부분은 session이었습니다. 클라이언트가 초기화 handshake를 거치고, 이후 요청에 session id를 들고 다니면 서버 배포는 자연스럽게 sticky session, shared session store, gateway body inspection 같은 구조로 기울어집니다. 작은 PoC에서는 문제가 작지만, 여러 팀이 붙는 production gateway에서는 운영 비용이 커집니다.

2026-07-28 릴리스 후보는 이 방향을 바꿉니다. protocol-level session과 `initialize` handshake를 제거하고, 요청마다 protocol version, client info, capability 정보를 `_meta`로 전달하는 모델을 제안합니다. HTTP transport에서는 `Mcp-Method`, `Mcp-Name` 같은 헤더로 gateway가 operation을 body inspection 없이 라우팅할 수 있게 됩니다.

이 변화의 의미는 단순한 성능 개선이 아닙니다.

- load balancer가 특정 server instance에 붙어 있을 필요가 줄어듭니다.
- gateway가 JSON body를 열어보지 않아도 method/name 기준 rate limit을 걸 수 있습니다.
- `tools/list` 같은 결과에 cache freshness를 명시할 수 있어 tool discovery 비용을 줄일 수 있습니다.
- trace context를 `_meta`에 실어 host, client SDK, MCP server, downstream API를 한 span tree로 연결할 수 있습니다.

즉 MCP가 "채팅 앱과 도구 서버의 연결"에서 "평범한 HTTP 인프라 위에서 운영 가능한 agent API layer"로 이동하는 흐름입니다.

### 2) Tool result는 자연어 응답이 아니라 검증 가능한 출력 계약이 된다

에이전트가 tool을 호출한 뒤 받는 결과가 자연어 문자열뿐이면, 다음 단계는 다시 모델의 추론에 의존합니다. "성공했습니다"라는 문장을 보고 실제로 생성된 id, 실패한 row, 권한 상태, 재시도 가능 여부를 안정적으로 파싱하기 어렵습니다. 그래서 MCP tool spec의 `structuredContent`와 `outputSchema`가 중요합니다.

현재 MCP tool spec은 tool definition에 `inputSchema`뿐 아니라 optional `outputSchema`를 둘 수 있게 합니다. tool이 구조화된 결과를 반환하면 서버는 schema를 만족해야 하고, 클라이언트는 검증해야 합니다. 또한 tool result는 text, image, audio뿐 아니라 resource link와 embedded resource를 포함할 수 있습니다.

실무적으로는 아래 기준을 세울 수 있습니다.

| 도구 유형 | 최소 출력 계약 | 자동 실행 기준 |
| --- | --- | --- |
| 조회 도구 | `items`, `next_cursor`, `source`, `staleness_ms` | schema validation 통과 시 요약 가능 |
| 변경 도구 | `changed_resource_ids`, `receipt_id`, `rollback_hint` | approval과 audit log 없으면 자동 실행 금지 |
| 파일/대용량 결과 | `resource_link`, `mimeType`, `size`, `checksum` | 원문을 context에 통째로 넣지 않음 |
| 외부 전송 도구 | `recipient`, `message_id`, `delivery_status` | 사용자 확인과 중복 방지 key 필수 |
| 배치 도구 | `accepted_count`, `failed_count`, `dlq_ref` | 실패율 threshold와 재처리 경로 필수 |

이 기준은 [Tool Contract Test](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/)와 바로 연결됩니다. MCP 서버를 만들 때 "모델이 알아서 읽겠지"가 아니라, 도구 결과를 다음 도구와 검증기가 안정적으로 소비할 수 있게 schema를 먼저 잡아야 합니다.

### 3) Tool shape는 거버넌스 경계다

Microsoft Dataverse MCP Server의 최근 설명에서 눈에 띄는 포인트는 "MCP를 지원한다"보다 "어떤 tools가 노출되는지"를 강조한다는 점입니다. `search_data`, `create_record`, `update_record`, `delete_record`, `read_query`, `describe`, 파일 업로드/다운로드 같은 tool 목록 자체가 에이전트가 할 수 있는 일의 경계입니다.

이건 개발자 경험만의 문제가 아닙니다. tool shape는 아래 운영 질문에 답하는 단위가 됩니다.

- 어떤 tool은 read-only인가, 어떤 tool은 write-capable인가
- 어떤 tool은 explicit user approval이 필요한가
- 어떤 tool은 role-based access control을 통과해야 하는가
- 어떤 tool result가 감사 로그와 receipt를 남겨야 하는가
- 어떤 client surface에서 어떤 tool을 허용할 것인가

따라서 MCP 서버 설계는 endpoint를 많이 여는 경쟁이 아닙니다. 좋은 tool shape는 권한 경계가 명확하고, 이름과 schema만 봐도 위험도를 분류할 수 있으며, 실패 결과가 기계적으로 처리됩니다. 반대로 `execute_sql`, `run_command`, `do_action` 같은 만능 도구는 초기 개발은 빠르지만 운영 거버넌스가 급격히 어려워집니다.

### 4) Tool이 많아질수록 progressive disclosure와 code execution이 필요해진다

MCP 서버가 몇 개일 때는 모델 context에 tool definition을 전부 넣어도 버틸 수 있습니다. 하지만 서버가 수십 개, tool이 수백 개로 늘면 tool description 자체가 비용과 latency가 됩니다. Anthropic은 MCP와 code execution을 결합해 필요한 tool definition만 읽고, 대용량 중간 결과는 실행 환경에서 처리하는 접근을 설명했습니다.

이 흐름의 핵심은 "모델에게 모든 것을 보여주지 말고, 필요한 interface만 단계적으로 보여주자"입니다. 예를 들어 10,000 row spreadsheet를 그대로 모델 context에 넣는 대신, code execution 환경에서 필터링하고 상위 5건과 summary만 모델에 넘길 수 있습니다. 대용량 파일은 `resource_link`로 전달하고, tool output은 schema와 checksum으로 검증할 수 있습니다.

도입 기준은 아래처럼 잡을 수 있습니다.

- 노출 tool이 **30개 이상**이면 tool search 또는 namespace 기반 progressive disclosure를 둔다.
- 단일 tool result가 **10KB 이상**이면 resource link 또는 summary+fetch 구조를 검토한다.
- tool chain이 **3단계 이상**이고 중간 결과가 큰 경우 code execution 또는 workflow runner를 검토한다.
- 개인정보/고객 데이터가 중간 결과에 포함되면 원문 context 주입을 기본 금지한다.
- agent-generated code 실행은 sandbox, network allowlist, CPU/memory/time limit 없이는 production에 붙이지 않는다.

즉 code execution은 만능 해법이 아닙니다. token 비용과 context 누수를 줄여 주지만, sandbox 운영과 보안 감시라는 새 비용이 생깁니다.

### 5) Authorization hardening은 MCP의 다음 병목이다

MCP가 local desktop demo에서 enterprise workflow로 이동하면 인증/인가가 병목이 됩니다. 하나의 AI client가 여러 MCP server와 authorization server를 오가면 issuer mix-up, 잘못된 redirect URI, scope accumulation, refresh token 처리 같은 문제가 곧 운영 리스크가 됩니다.

2026-07-28 릴리스 후보는 OAuth/OIDC 배포 현실에 맞춘 authorization hardening을 예고합니다. 이건 보안팀만의 이슈가 아닙니다. 개발팀도 MCP server를 만들 때 아래를 기본값으로 봐야 합니다.

- server별 issuer와 audience를 명확히 검증한다.
- client registration과 redirect URI 정책을 surface별로 분리한다.
- write-capable tool은 read scope와 별도 scope를 쓴다.
- scope escalation은 step-up approval과 receipt를 남긴다.
- token, tool args, tool result가 logs와 traces에 그대로 남지 않게 마스킹한다.

이 기준은 [MCP Native Secret Scanning](/posts/2026-05-24-mcp-native-secret-scanning-shift-left-trend/)과도 연결됩니다. MCP tool 호출은 곧 권한 있는 API 호출이므로, 인증 경계와 secret scanning이 tool contract의 일부가 되어야 합니다.

## 실무 적용

### 1) MCP 서버 인벤토리를 tool 단위로 다시 만든다

서버 단위 목록만 있으면 부족합니다. 운영에 필요한 것은 tool 단위 목록입니다.

```text
server: dataverse-prod
tool: create_record
risk: write
scope: dataverse.record.write
approval: required for production
output_schema: required
receipt: required
rate_limit: 30/min per user
audit_retention: 180 days
owner: platform-data
```

처음부터 완벽한 catalog를 만들 필요는 없습니다. 다만 production에 붙은 MCP server는 최소한 read-only, write, external-send, admin, file, code-exec 그룹으로 분류해야 합니다. 이 분류가 없으면 "어떤 tool을 에이전트에게 열어도 되는가"를 매번 감으로 결정하게 됩니다.

### 2) outputSchema 없는 도구는 자동 실행에서 제외한다

사람이 직접 확인하는 low-risk 조회라면 text result도 허용할 수 있습니다. 하지만 agent workflow가 다음 단계를 자동으로 이어가는 도구라면 `outputSchema`가 사실상 필수입니다.

실무 gate는 이렇게 둘 수 있습니다.

- read-only summary tool: text 허용, source와 timestamp는 필수
- structured query tool: `outputSchema` 또는 JSON schema fixture 필수
- state-changing tool: `outputSchema`, receipt id, changed resource id, rollback hint 필수
- external-send tool: recipient, message id, delivery status, idempotency key 필수
- admin/delete tool: approval id와 audit log reference 없으면 실행 금지

이 기준을 CI로 옮기면 좋습니다. MCP server PR에서 tool definition이 바뀌면 schema snapshot diff, backward compatibility check, example response validation을 실행합니다. 사람이 tool description 문장을 읽고 리뷰하는 것보다 훨씬 안정적입니다.

### 3) 2026-07-28 후보 변화는 인프라팀 이슈로 본다

MCP 2026-07-28 final이 예정대로 나온다면, remote MCP server 운영팀은 미리 확인할 것이 있습니다.

- session id나 initialize handshake에 의존하는 client/server 코드가 있는가
- gateway가 request body를 파싱해 routing/rate limit을 걸고 있는가
- `tools/list` 결과 cache와 invalidation 정책이 있는가
- traceparent/tracestate를 host부터 downstream까지 연결할 수 있는가
- roots, sampling, logging 같은 deprecation 대상 기능에 의존하고 있는가
- JSON Schema 2020-12 기능을 쓸 때 validation time과 schema depth 제한이 있는가

권장 일정은 보수적으로 잡습니다. 2026년 6월 말까지 inventory를 만들고, 7월 중순까지 staging에서 candidate compatibility test를 돌리고, final spec이 나온 뒤 production canary를 5~10%부터 시작합니다. "스펙이 나왔으니 바로 교체"가 아니라, client SDK와 server SDK의 지원 수준을 같이 확인해야 합니다.

### 4) Tool 호출 receipt를 표준화한다

에이전트가 tool을 호출했다면 실행 증거가 남아야 합니다. 최소 receipt는 아래 필드를 포함합니다.

```json
{
  "tool_call_id": "tc_20260623_001",
  "server": "crm-mcp",
  "tool": "update_record",
  "schema_version": "2026-06-01",
  "risk": "write",
  "approval_id": "appr_123",
  "args_hash": "sha256:...",
  "result_status": "success",
  "changed_resource_ids": ["account:42"],
  "rollback_hint": "restore account owner from previous_owner_id",
  "trace_id": "00-..."
}
```

원문 args를 모두 저장할 필요는 없습니다. 민감정보가 많다면 hash, schema version, validation result, changed resource id를 남기는 편이 안전합니다. 중요한 것은 나중에 "누가 어떤 권한으로 무엇을 바꿨는가"를 재구성할 수 있어야 한다는 점입니다.

## 트레이드오프/주의점

첫째, stateless protocol core는 서버 운영을 단순하게 만들지만 application state를 없애지는 않습니다. 장바구니, 브라우저 세션, 장기 작업, 파일 업로드처럼 상태가 필요한 업무는 explicit handle을 tool result로 반환하고 다음 호출에서 인자로 전달해야 합니다. 숨겨진 session이 사라졌을 뿐, 상태 설계 책임은 여전히 남습니다.

둘째, schema가 많아지면 개발 속도가 느려질 수 있습니다. 작은 내부 도구까지 모든 output을 엄격한 schema로 묶으면 실험 속도가 떨어집니다. 그래서 production 자동 실행, write-capable tool, external-send tool부터 엄격하게 시작하는 편이 좋습니다.

셋째, code execution은 context 비용을 줄이지만 공격 표면을 키웁니다. agent-generated code가 파일, 네트워크, secret, 내부 API에 접근한다면 사실상 작은 runtime platform을 운영하는 것입니다. sandbox, egress policy, resource limit, audit log가 없으면 direct tool call보다 위험해질 수 있습니다.

넷째, MCP server가 늘어날수록 discoverability와 governance가 충돌합니다. 개발자는 많은 tool을 빨리 붙이고 싶고, 보안팀은 적은 tool을 명확히 통제하고 싶어합니다. 해법은 tool 수를 무조건 줄이는 것이 아니라 tool shape, risk class, approval, schema, receipt를 표준화하는 것입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] production MCP server를 server 단위가 아니라 tool 단위로 inventory했다.
- [ ] read-only, write, external-send, admin, file, code-exec tool을 분류했다.
- [ ] 자동 실행되는 tool은 `outputSchema` 또는 동등한 response fixture로 검증한다.
- [ ] write-capable tool은 approval id, receipt id, changed resource id를 남긴다.
- [ ] 큰 결과와 파일은 raw context 대신 `resource_link` 또는 fetch 가능한 resource로 전달한다.
- [ ] tool result와 trace에 token, secret, 개인정보가 원문으로 남지 않게 마스킹한다.
- [ ] MCP 2026-07-28 후보 변화 중 session, routing header, trace propagation, deprecation 의존성을 점검했다.
- [ ] 30개 이상 tool이 노출된 client는 search/progressive disclosure 또는 namespace lazy loading을 둔다.

### 연습

1. 현재 팀의 MCP 또는 agent tool 10개를 골라 read-only/write/admin/external-send로 분류해 보세요.
2. 가장 위험한 write tool 하나에 대해 `inputSchema`, `outputSchema`, receipt field, approval field를 설계해 보세요.
3. tool result가 100KB 이상인 흐름을 찾아 raw context 주입 대신 resource link와 summary 구조로 바꿔 보세요.
4. gateway가 `Mcp-Method`, `Mcp-Name`, tool risk class 기준으로 rate limit을 걸 수 있다고 가정하고 정책 표를 작성해 보세요.

## 참고한 흐름

- Model Context Protocol Blog: The 2026-07-28 MCP Specification Release Candidate  
  https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- Model Context Protocol Specification 2025-06-18: Tools  
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Microsoft Power Platform Blog: Dataverse MCP Server, Understanding the New Tool Shape  
  https://www.microsoft.com/en-us/power-platform/blog/2026/06/08/dataverse-mcp-server-understanding-the-new-tool-shape/
- Anthropic Engineering: Code execution with MCP  
  https://www.anthropic.com/engineering/code-execution-with-mcp

오늘의 결론은 이렇습니다. MCP의 다음 단계는 더 많은 도구를 붙이는 경쟁이 아니라, 붙인 도구를 운영 가능한 계약으로 만드는 일입니다. stateless routing, structured output, tool shape, authorization, receipt가 함께 갖춰질 때 에이전트는 "쓸 수 있는 장난감"이 아니라 "감사 가능한 작업자"가 됩니다.
