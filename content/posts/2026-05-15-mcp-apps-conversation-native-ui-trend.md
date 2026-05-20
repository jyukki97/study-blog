---
title: "2026 개발 트렌드: MCP Apps, 채팅 안에 들어오는 Conversation-Native UI가 개발 도구의 다음 표면이 된다"
date: 2026-05-15
draft: false
tags: ["MCP", "AI Agents", "Developer Tools", "Conversation UI", "Platform Engineering", "Security"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["MCP Apps", "conversation-native UI", "AI agent UI", "interactive tool UI", "developer tools trend"]
description: "MCP Apps는 에이전트가 텍스트만 반환하던 흐름을 넘어, 대화 맥락 안에서 폼·대시보드·리뷰 화면을 렌더링하는 방향을 보여줍니다. 언제 도입하고 어떤 보안·운영 기준을 둬야 하는지 정리합니다."
lastmod: 2026-05-15
summary: "MCP Apps는 AI 도구 호출 결과를 채팅 밖 링크가 아니라 대화 안의 상호작용 UI로 보여주는 흐름입니다. 생산성보다 먼저 권한, 상태, 검증, 감사 경계를 설계해야 합니다."
key_takeaways:
  - "텍스트 응답만으로 부족한 설정·리뷰·모니터링 작업은 conversation-native UI로 이동할 가능성이 높다."
  - "MCP Apps의 핵심 가치는 UI 자체보다 대화 맥락, 도구 호출, 사용자 승인 흐름을 한 표면에 묶는 데 있다."
  - "초기 도입은 읽기 전용 대시보드와 검증 폼부터 시작하고, 쓰기 작업은 capability·CSP·audit gate를 통과시켜야 한다."
operator_checklist:
  - "앱이 호출할 수 있는 MCP tool 목록, 권한 범위, 외부 origin, 보존 상태를 manifest로 관리한다."
  - "읽기 전용, 제안 생성, 승인 필요 쓰기, 자동 쓰기 네 단계로 action risk를 나눈다."
  - "iframe sandbox, CSP, postMessage origin 검증, tool call audit log를 릴리스 게이트에 넣는다."
decision_guide:
  title: "MCP Apps를 언제 검토할까"
  intro: "대화형 에이전트가 복잡한 결과를 계속 긴 텍스트로 설명하고 있다면 UI 표면을 붙일 때가 됐을 수 있습니다. 다만 쓰기 권한이 들어가는 순간 보안·감사 기준을 먼저 정해야 합니다."
  cases:
    - badge: "즉시 검토"
      title: "승인, 설정, 모니터링, 리뷰처럼 사용자가 여러 값을 비교하고 선택해야 하는 작업"
      fit: "폼·테이블·차트가 텍스트보다 명확하다."
      watchouts: "사용자 선택이 실제 tool call로 이어지면 승인과 감사 로그가 필요하다."
      next_step: "읽기 전용 UI 또는 dry-run UI부터 만든다."
    - badge: "부분 도입"
      title: "내부 운영 대시보드나 개발자 포털 기능을 에이전트와 연결하려는 팀"
      fit: "기존 API와 권한 모델을 MCP 서버 뒤에 둘 수 있다."
      watchouts: "기존 웹앱보다 단순해지는 영역과 오히려 복잡해지는 영역을 구분해야 한다."
      next_step: "tool manifest, CSP, owner, rollback 기준을 먼저 고정한다."
    - badge: "보류"
      title: "아직 MCP tool 권한, 로그, secret 경계가 정리되지 않은 팀"
      fit: "UI보다 기본 tool governance가 먼저다."
      watchouts: "그럴듯한 UI가 위험한 쓰기 작업을 쉽게 만들 수 있다."
      next_step: "MCP 보안 거버넌스와 tool contract test부터 정리한다."
learning_refs:
  - title: "MCP 도입과 툴 호출 보안"
    href: "/posts/2026-03-02-mcp-tooling-security-governance-trend/"
    description: "MCP Apps 이전에 필요한 권한, 감사 로그, 승인 흐름의 기본선입니다."
  - title: "Tool Permission Manifest와 Runtime Attestation"
    href: "/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/"
    description: "앱이 호출할 수 있는 도구와 권한을 명시적으로 관리하는 관점과 연결됩니다."
  - title: "Tool Contract Test와 Schema Canary"
    href: "/posts/2026-04-30-tool-contract-test-agent-runtime-trend/"
    description: "UI 뒤의 tool call 계약이 깨졌는지 배포 전에 검증하는 흐름입니다."
faqs:
  - question: "MCP Apps는 기존 웹앱을 대체하나요?"
    answer: "전부 대체하지는 않습니다. 대화 맥락과 도구 호출이 강하게 연결된 작업에는 유리하지만, 독립적인 장기 업무 화면은 기존 웹앱이 더 단순할 수 있습니다."
  - question: "처음부터 쓰기 기능을 넣어도 되나요?"
    answer: "권장하지 않습니다. 읽기 전용, dry-run, 승인 필요 쓰기 순서로 올리는 편이 안전합니다."
  - question: "가장 먼저 볼 리스크는 무엇인가요?"
    answer: "앱이 어떤 tool을 호출할 수 있는지, 어떤 origin의 리소스를 로드하는지, 사용자 선택이 실제 변경으로 이어지는지 세 가지입니다."
---

AI 에이전트 도구는 한동안 텍스트 중심이었습니다. 사용자가 질문하면 모델이 설명하고, 필요하면 tool을 호출한 뒤 결과를 문장으로 요약했습니다. 이 방식은 간단한 질의응답에는 충분하지만, 설정값이 많거나 비교해야 할 데이터가 많거나 사용자가 단계별로 승인해야 하는 업무에서는 금방 한계가 드러납니다. 긴 표를 채팅에 붙여 넣고, 사용자가 다시 번호를 고르고, 모델이 또 설명하는 흐름은 개발자 경험으로도 운영 경험으로도 답답합니다.

그래서 최근 눈에 띄는 흐름이 **MCP Apps**입니다. Model Context Protocol이 AI 애플리케이션과 외부 도구를 연결하는 표준 인터페이스라면, MCP Apps는 그 도구 결과를 대화 안에서 상호작용 가능한 UI로 보여주는 방향입니다. 공식 문서에서도 MCP Apps는 데이터 시각화, 폼, 대시보드 같은 HTML 인터페이스를 MCP host 안에 렌더링하는 방식으로 설명됩니다. 중요한 변화는 "채팅이 웹앱을 대체한다"가 아니라, **도구 호출·대화 맥락·사용자 선택이 같은 표면에서 만난다**는 점입니다.

이 흐름은 이미 다뤘던 [MCP 툴 호출 보안·거버넌스](/posts/2026-03-02-mcp-tooling-security-governance-trend/), [Tool Permission Manifest](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/), [Context Freshness Budget](/posts/2026-04-24-context-freshness-budget-agent-runtime-trend/), [Background Agent Session](/posts/2026-05-04-background-agent-session-result-inbox-trend/)과 이어집니다. 에이전트가 더 많은 일을 하게 될수록, 결과를 읽는 화면과 승인하는 화면도 단순 텍스트에서 벗어나야 합니다. 다만 UI가 붙는 순간 위험도도 올라갑니다. 버튼 하나가 실제 배포, 결제 취소, 권한 변경, 파일 삭제로 이어질 수 있기 때문입니다.

## 이 글에서 얻는 것

- MCP Apps가 기존 채팅 응답, 일반 웹앱, 개발자 포털과 어떻게 다른지 이해할 수 있습니다.
- conversation-native UI가 특히 효과적인 업무와 아직 도입하지 말아야 할 업무를 구분할 수 있습니다.
- MCP App을 만들 때 필요한 권한, CSP, sandbox, tool audit, 상태 관리 기준을 숫자와 단계로 잡을 수 있습니다.
- 읽기 전용 대시보드에서 승인 기반 쓰기 작업까지 안전하게 확장하는 도입 순서를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Conversation-Native UI는 링크가 아니라 맥락 안의 작업 표면이다

기존 방식은 에이전트가 "대시보드는 여기 링크를 보세요"라고 말하는 구조였습니다. 사용자는 새 탭을 열고, 다시 로그인하고, 방금 대화에서 어떤 조건을 골랐는지 기억해야 합니다. 반면 conversation-native UI는 대화가 만든 맥락 안에 화면을 렌더링합니다. 사용자는 채팅에서 "지난 24시간 에러율 보여줘"라고 요청하고, 바로 그 자리에서 차트를 보고, 특정 서비스를 클릭해 로그를 좁히고, 필요하면 후속 질문을 이어갈 수 있습니다.

이 차이는 작아 보이지만 실무에서는 큽니다. 특히 아래 작업은 텍스트만으로 처리하면 비용이 커집니다.

- 여러 설정값을 한 번에 비교하고 선택하는 배포 설정
- PR, 보안 경고, 장애 알림처럼 항목별 검토가 필요한 큐
- 로그·메트릭·트레이스처럼 시각화가 필요한 관측 데이터
- 결재, 승인, 예외 허용처럼 사용자의 명시적 선택이 필요한 업무
- 생성 이미지, PDF, 3D 모델, 테이블처럼 미리보기와 조작이 필요한 결과

이런 업무에서 UI는 예쁜 장식이 아닙니다. 오류를 줄이는 입력 장치입니다. 사용자가 자연어로 "적당히 설정해줘"라고 말하는 것보다, 기본값이 채워진 폼에서 timeout 2초, retry 2회, rollout 10%를 눈으로 확인하고 승인하는 편이 훨씬 안전합니다.

### 2) MCP Apps의 핵심은 UI보다 tool call 경계다

MCP Apps는 HTML을 렌더링할 수 있다는 점 때문에 프론트엔드 기술처럼 보일 수 있습니다. 하지만 운영 관점의 핵심은 UI가 어떤 도구를 호출할 수 있는지입니다. 앱 안의 버튼이 `deploy_service`, `create_issue`, `query_database`, `send_message` 같은 tool call로 이어진다면, 그 앱은 단순 화면이 아니라 권한을 가진 작업 표면입니다.

따라서 앱별로 최소 아래 정보를 명시해야 합니다.

```text
App: incident-triage-panel
Owner: platform-sre
Allowed tools: query_metrics, fetch_logs, create_incident_note, propose_rollback
Denied tools: execute_rollback, edit_secrets, send_external_message
Action risk: read-only + proposal
External origins: https://static.example.com
Data retention: no local persistence, conversation-scoped state only
Audit: every tool call with user_id, app_id, tool_name, input_hash, result_status
```

이 구조는 [Tool Permission Manifest와 Runtime Attestation](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)의 직접적인 확장입니다. UI가 생기면 사용자는 더 쉽게 클릭하고, 더 쉽게 승인합니다. 그래서 권한 경계는 더 엄격해야 합니다.

### 3) Sandboxed iframe은 출발점이지 완성된 보안 모델이 아니다

MCP Apps는 일반적으로 host가 통제하는 sandboxed iframe 안에서 렌더링되는 방향을 갖습니다. iframe sandbox는 parent DOM 접근, 쿠키 탈취, 임의 navigation 같은 위험을 줄여줍니다. 하지만 iframe만으로 충분하다고 보면 안 됩니다. 앱은 여전히 postMessage를 통해 host와 통신하고, host를 통해 tool을 호출할 수 있습니다.

실무 체크포인트는 아래입니다.

- `sandbox` attribute에서 필요한 capability만 허용한다.
- CSP로 script, connect, image, frame origin을 제한한다.
- postMessage는 origin, schema, nonce를 검증한다.
- 앱이 요청할 수 있는 tool과 action을 allowlist로 제한한다.
- tool input은 UI에서 한 번, 서버에서 한 번 검증한다.
- 사용자 승인 전에는 destructive action을 호출하지 못하게 한다.
- 모든 tool call에 app_id, session_id, user_id, trace_id를 남긴다.

특히 외부 script를 넓게 허용하는 순간 위험이 커집니다. 내부 운영 앱이라도 `script-src *` 같은 설정은 피해야 합니다. 처음에는 self-hosted bundle과 제한된 static origin만 허용하는 편이 안전합니다.

### 4) 상태 관리는 대화 맥락과 앱 내부 상태를 분리해야 한다

대화형 UI가 어려운 이유는 상태가 여러 곳에 생기기 때문입니다. 모델의 대화 맥락, MCP server의 tool result, 앱 iframe 내부 state, 실제 backend resource state가 동시에 존재합니다. 이 상태들이 어긋나면 사용자는 오래된 화면을 보고 최신 작업을 승인할 수 있습니다.

예를 들어 배포 승인 앱에서 10분 전에는 canary error rate가 0.2%였지만 지금은 3%라면, 버튼은 자동으로 비활성화되어야 합니다. "아까 괜찮았다"는 맥락만 믿고 배포를 진행하면 안 됩니다. 이 문제는 [Context Freshness Budget](/posts/2026-04-24-context-freshness-budget-agent-runtime-trend/)과 거의 같은 구조입니다.

권장 기준은 아래처럼 잡을 수 있습니다.

- 읽기 전용 데이터: freshness budget **1~5분**
- 배포·장애·보안 판단 데이터: freshness budget **30~60초**
- 결제·권한 변경 전 검증: 승인 직전 서버 재조회 필수
- 5분 이상 열린 앱: action 버튼 클릭 시 stale check 강제
- tool result 재사용: input hash와 resource version이 같을 때만 허용

대화 안에 UI가 있다고 해서 대화 내용이 항상 최신 사실은 아닙니다. UI는 마지막 순간에 서버 상태를 다시 확인해야 합니다.

### 5) 좋은 MCP App은 모델을 덜 똑똑하게 만들어도 안전해진다

흥미로운 점은 UI가 잘 설계되면 모델의 부담이 줄어든다는 것입니다. 모델이 모든 옵션을 기억하고 자연어로 묻고 답하는 대신, 앱이 유효한 선택지를 보여주고 잘못된 입력을 막습니다. 예를 들어 배포 폼에서 region, rollout percentage, rollback condition, owner를 명시적으로 선택하게 만들면 모델이 임의로 값을 만들어낼 여지가 줄어듭니다.

이것은 AI UX가 아니라 backend reliability 문제이기도 합니다. 사용자가 선택한 값은 구조화된 입력으로 tool에 전달되고, tool은 schema로 검증할 수 있습니다. [Schema-Constrained Output + Runtime Validator](/posts/2026-04-04-schema-constrained-output-runtime-validator-trend/) 흐름이 UI까지 확장되는 셈입니다.

단, UI가 사용자를 과신하게 만들 수도 있습니다. 버튼과 카드가 있으면 시스템이 더 안전해 보입니다. 그래서 위험 작업에는 항상 근거, 영향 범위, rollback 조건을 함께 보여줘야 합니다. "Approve" 버튼만 있는 UI는 좋은 에이전트 UI가 아닙니다.

## 실무 적용

### 1) 첫 후보는 읽기 전용 대시보드나 리뷰 패널이다

MCP Apps를 처음 도입한다면 쓰기 작업부터 넣지 않는 편이 좋습니다. 가장 좋은 시작점은 읽기 전용이면서 텍스트보다 UI가 명확한 업무입니다.

추천 후보는 아래입니다.

- 장애 타임라인: 알림, 배포, 에러율, 로그 샘플을 한 화면에 표시
- PR 리뷰 패널: 변경 파일, 테스트 증거, 위험도, owner를 정리
- 보안 취약점 triage: CVE, 영향 패키지, exploitability, fix PR 상태 표시
- 비용 대시보드: 서비스별 AI/API 사용량과 budget burn 표시
- 배치 실행 결과: 성공/실패 row, 재처리 후보, DLQ 요약 표시

초기 성공 기준은 단순합니다. 사용자가 같은 정보를 보기 위해 채팅에 추가 질문을 **3번 이상** 해야 하던 업무를, UI 한 화면에서 **1번 이하**로 줄이면 효과가 있습니다. 반대로 텍스트 한 문장으로 충분한 결과에 UI를 붙이면 유지보수 비용만 늘어납니다.

### 2) Action risk를 네 단계로 나눈다

모든 버튼이 같은 위험도를 갖지 않습니다. 앱 설계 때 action을 아래 네 단계로 나누면 운영 기준을 잡기 쉽습니다.

| 단계 | 예시 | 기본 정책 |
| --- | --- | --- |
| Read-only | 로그 조회, 차트 필터링 | 승인 불필요, audit는 샘플링 가능 |
| Proposal | rollback plan 생성, PR 초안 만들기 | 실행 전 사용자 확인 필요 |
| Approval-required write | issue 생성, 설정 변경, 배포 시작 | 명시 승인, full audit, rollback note 필요 |
| Autonomous write | 반복 알림 정리, low-risk label 적용 | 매우 제한적으로만 허용 |

처음 4주 동안은 read-only와 proposal까지만 허용하는 것을 추천합니다. 그다음 approval-required write를 일부 내부 업무에 열고, 최소 2주 동안 error rate, 취소율, support ticket을 봅니다. Autonomous write는 action 실패 비용이 낮고 되돌리기 쉬운 작업에만 제한해야 합니다.

### 3) MCP App 릴리스 게이트를 만든다

일반 웹앱 배포와 달리 MCP App은 LLM host, MCP server, tool permission, UI bundle이 함께 맞아야 합니다. 릴리스 체크는 아래를 포함해야 합니다.

```text
1. UI bundle integrity: build hash, signed artifact, allowed origin
2. CSP/sandbox: script/connect/frame origin allowlist 확인
3. Tool manifest: allowed/denied tools, action risk, owner 명시
4. Schema test: UI -> host -> MCP server tool input 계약 검증
5. Permission test: denied tool call이 실제로 차단되는지 확인
6. Freshness test: stale data에서 write action이 막히는지 확인
7. Audit test: tool call 로그에 app_id/user_id/session_id/trace_id 존재
8. Rollback: app disable flag 또는 이전 UI resource로 되돌리는 절차
```

이 게이트는 [Tool Contract Test와 Schema Canary](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/)와 같이 운영하면 좋습니다. UI가 예쁘게 떠도 tool schema가 바뀌면 실제 업무는 깨집니다. 반대로 tool은 정상인데 CSP가 막혀 UI가 빈 화면으로 뜰 수도 있습니다. 둘을 같이 테스트해야 합니다.

### 4) 승인 UX는 "무엇을 누르는가"보다 "무엇이 바뀌는가"를 보여줘야 한다

위험한 action의 승인 화면에는 최소 네 가지가 있어야 합니다.

1. 변경 대상: 서비스, 리소스, 고객, 파일, 권한
2. 변경 전/후: diff 또는 요약
3. 근거: 어떤 데이터와 시점 기준으로 추천했는가
4. 복구: 실패 시 rollback 또는 되돌리기 방법

예를 들어 배포 롤백 버튼이면 "rollback 실행"만 보여주면 부족합니다. 현재 버전, 되돌릴 버전, 영향 서비스, 예상 중단 시간, 최근 error rate, rollback 후 확인할 지표가 보여야 합니다. 사용자가 승인하는 것은 버튼이 아니라 변경입니다.

숫자 기준도 필요합니다.

- high-risk action은 승인 직전 데이터 freshness **60초 이하**
- 운영 변경은 rollback note **필수**
- 외부 전송/삭제/권한 변경은 2단계 확인 또는 별도 approval gate
- 같은 session에서 같은 destructive action 반복 시 rate limit 적용
- 실패한 action은 재시도 전 원인과 이전 requestId를 표시

### 5) 운영 지표는 UI 사용량보다 의사결정 품질을 본다

MCP App 도입 후 "몇 번 열렸는가"만 보면 안 됩니다. 중요한 것은 사용자가 더 안전하고 빠르게 결정했는지입니다.

초기 지표는 아래가 좋습니다.

- task completion time: 기존 채팅/웹앱 대비 얼마나 줄었는가
- clarification turns: 추가 질문 횟수가 줄었는가
- invalid input rate: schema validation 실패가 줄었는가
- stale action block count: 오래된 데이터 기반 action을 얼마나 막았는가
- approval cancel rate: 사용자가 UI에서 위험을 보고 취소한 비율
- post-action incident rate: 앱 action 이후 장애/티켓 발생률
- tool call denial rate: 권한 없는 호출 시도가 얼마나 차단됐는가

좋은 UI는 클릭 수를 늘리는 것이 아니라 잘못된 클릭을 줄입니다. 특히 approval cancel rate는 나쁜 지표가 아닐 수 있습니다. 사용자가 근거를 보고 위험한 작업을 취소했다면 UI가 제 역할을 한 것입니다.

## 트레이드오프/주의점

### 1) 모든 것을 채팅 안에 넣으면 더 복잡해진다

Conversation-native UI는 강력하지만 만능은 아닙니다. 장시간 머무는 복잡한 관리 화면, 대량 편집, 세밀한 권한 관리, 긴 데이터 탐색은 기존 웹앱이 더 낫습니다. MCP App은 대화 맥락과 tool call이 강하게 연결될 때 빛납니다.

도입 판단 기준은 단순하게 잡을 수 있습니다.

- 사용자가 대화에서 만든 조건을 그대로 UI에 반영해야 하면 MCP App 후보
- UI에서 선택한 값이 곧바로 에이전트 후속 작업으로 이어지면 MCP App 후보
- 독립적으로 몇 시간 동안 작업하는 화면이면 기존 웹앱 우선
- SEO, 공유 URL, 복잡한 사용자 권한 화면이 핵심이면 기존 웹앱 우선

즉, MCP Apps는 웹앱의 대체재라기보다 에이전트 작업 표면의 보강재입니다.

### 2) UI가 생기면 사용자는 더 쉽게 위험한 작업을 한다

텍스트 명령은 사용자가 한 번 더 생각하게 만들 때가 있습니다. 반면 버튼은 빠릅니다. 그래서 위험 작업을 버튼으로 만들 때는 의도적으로 마찰을 남겨야 합니다. 삭제, 외부 전송, 권한 확대, 배포, 비용 발생 작업은 한 번의 클릭으로 끝내지 않는 편이 안전합니다.

마찰은 나쁜 UX가 아닙니다. 위험한 작업에서는 좋은 UX입니다. 다만 모든 작업에 마찰을 넣으면 사용자는 우회합니다. read-only와 low-risk action은 빠르게, high-risk action은 느리게 만드는 구분이 필요합니다.

### 3) 앱 내부 상태가 감사 로그를 대체하면 안 된다

앱 화면에 "승인됨"이라고 표시되어도, 서버 측 audit log가 없으면 운영 증거가 아닙니다. MCP App은 iframe 안에서 실행되는 UI이고, 사용자의 브라우저 상태는 사라질 수 있습니다. 실제 감사 기준은 host와 server가 남긴 로그여야 합니다.

최소 감사 필드는 아래입니다.

```text
timestamp, user_id, app_id, app_version, session_id,
tool_name, action_risk, input_hash, resource_version,
approval_id, result_status, trace_id, rollback_ref
```

이 로그가 없으면 사고 후 "누가 어떤 근거로 무엇을 실행했는가"를 복원하기 어렵습니다. [Execution Receipt](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/) 관점으로 보면, MCP App action도 검증 가능한 작업 영수증을 남겨야 합니다.

### 4) 모델이 UI를 설명한다고 UI가 검증된 것은 아니다

에이전트가 "이 차트는 안전합니다"라고 말해도 실제 UI 데이터가 최신인지, tool input이 검증됐는지, 권한이 맞는지는 별개입니다. 모델 설명은 보조 정보입니다. 검증은 runtime이 해야 합니다.

그래서 중요한 action에는 model-generated summary보다 deterministic check를 우선해야 합니다. 예를 들어 "오류율이 낮으니 배포해도 됩니다"보다 `error_rate_5m < 1%`, `rollback_ready = true`, `owner_approval = present`, `freshness_age < 60s` 같은 체크가 필요합니다. 모델은 이 결과를 설명할 수 있지만, 결과를 대신해서는 안 됩니다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 이 UI가 텍스트 응답보다 명확한 이유가 있다. 예: 표, 차트, 폼, diff, 승인 큐.
- [ ] 앱 owner, app_id, app_version, rollback 방법이 정의되어 있다.
- [ ] allowed tools와 denied tools가 manifest에 명시되어 있다.
- [ ] action risk가 read-only/proposal/approval/autonomous로 분류되어 있다.
- [ ] CSP와 sandbox 정책이 기본 deny에 가깝게 설정되어 있다.
- [ ] postMessage origin과 message schema 검증이 있다.
- [ ] stale data에서 위험 action이 막히는 freshness check가 있다.
- [ ] tool call audit log가 host/server 양쪽에서 남는다.
- [ ] UI bundle과 MCP server schema 변경을 함께 테스트한다.
- [ ] 외부 전송, 삭제, 권한 변경, 비용 발생 action은 별도 승인 게이트를 통과한다.

### 연습: 장애 triage MCP App 설계하기

상황을 가정해 봅시다. 팀은 장애가 날 때마다 에이전트에게 "최근 배포와 에러 로그를 요약해줘"라고 묻습니다. 에이전트는 매번 긴 텍스트를 반환하지만, 운영자는 결국 대시보드를 다시 열어 확인합니다. 이 업무는 MCP App 후보입니다.

처음 버전은 아래 범위로 제한하는 것이 좋습니다.

```text
App: incident-triage-panel
Mode: read-only + proposal
Tools: query_metrics, fetch_logs, list_deployments, create_incident_note
Denied: rollback_service, edit_config, page_external_team
Freshness: metrics 60s, logs 120s, deployments 5m
Actions: create note only; rollback은 proposal text만 생성
Audit: all tool calls, all note creation
```

이렇게 시작하면 사용자는 채팅 안에서 최근 배포, 에러율, 대표 로그, 영향 서비스를 한눈에 볼 수 있습니다. 하지만 실제 rollback은 아직 하지 않습니다. 2주 동안 사용해 보고, 평균 triage 시간이 30% 이상 줄고, 잘못된 로그 링크나 stale 지표 문제가 거의 없으면 다음 단계로 갑니다. 다음 단계에서도 바로 rollback 버튼을 넣기보다 "rollback plan 생성"과 "사람 승인 요청"을 먼저 넣는 편이 안전합니다.

MCP Apps의 방향은 분명 흥미롭습니다. 하지만 이 트렌드의 핵심은 더 화려한 채팅 UI가 아닙니다. 에이전트가 실제 업무 표면으로 들어올수록, 팀은 UI·권한·상태·감사를 한 덩어리로 설계해야 합니다. 잘 만든 MCP App은 사용자를 더 빨리 클릭하게 만드는 도구가 아니라, 더 안전하게 판단하게 만드는 도구입니다.
