---
title: "2026 개발 트렌드: Zero Data Retention과 Private Safety Processing, AI 데이터 경계는 보존 여부보다 처리 계약이 된다"
date: 2026-08-24T10:06:00+09:00
lastmod: 2026-08-24T10:06:00+09:00
draft: false
tags: ["AI Platform", "Data Governance", "Zero Data Retention", "Privacy Engineering", "AI Safety", "Platform Engineering"]
categories: ["Development", "AI", "Security", "Platform Engineering"]
series: ["dev-trends"]
keywords: ["Zero Data Retention", "Private Safety Processing", "AI data controls", "application state retention", "AI privacy governance"]
description: "OpenAI의 Zero Data Retention 및 Private Safety Processing preview를 계기로, AI 도입에서 프롬프트 저장·애플리케이션 상태·안전 신호·고객 키 제어를 하나의 처리 계약으로 설계하는 방법을 정리합니다."
summary: "ZDR은 단순히 '데이터를 저장하지 않는다'는 스위치가 아니다. endpoint별 application state, 로그 보존, 안전 신호, 고객의 조사 가능성, 키 소유권을 분리해 보여 주는 데이터 처리 계약이다. 제품팀은 모델 선택보다 먼저 어떤 요청이 어디에 얼마나 남고, 무엇이 안전 signal로 나가며, 어떤 기능이 ZDR과 양립하지 않는지 inventory해야 한다."
key_takeaways:
  - "OpenAI의 2026년 8월 Private Safety Processing preview는 ZDR 환경에서도 장기 상호작용의 안전 신호를 만들려는 시도로, 원문 접근과 제한된 signal을 분리한다."
  - "API data control에서 ZDR은 abuse monitoring log와 일부 endpoint 동작을 바꾸지만, conversation·file·vector store처럼 application state를 저장하는 기능의 보존 여부는 endpoint별로 따로 봐야 한다."
  - "'모델 학습에 쓰지 않는다'와 '아무것도 보존하지 않는다'와 '사람이 내용을 볼 수 없다'는 서로 다른 주장이다. procurement와 설계 문서에서 세 문장을 분리해야 한다."
  - "실무 우선순위는 민감 content 최소화, stateful feature inventory, ZDR project 분리, 고객 소유 관측성, 안전 alert 대응 runbook 순서다."
operator_checklist:
  - "모든 AI endpoint를 prompt/response, abuse monitoring log, application state, file/vector data, safety signal로 나눠 보존 기간·owner·삭제 경로를 기록한다."
  - "ZDR 적용 project와 일반 project를 분리하고, `store=true` 또는 stateful API 의존성이 배포에서 조용히 무효화되지 않는지 integration test로 확인한다."
  - "프롬프트 원문을 중앙 로그·trace·error tracker에 그대로 복제하지 않고, request ID·정책 결과·길이·hash 등 필요한 최소 운영 증거만 남긴다."
  - "안전 signal이 발생했을 때 누가 고객 쪽 원문·권한·감사 로그로 조사하고, false positive를 어떻게 재판정할지 runbook을 둔다."
learning_refs:
  - title: "Agent Session Ledger와 AI Credit Control"
    href: "/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/"
    description: "AI 작업의 비용·승인·실행 증거를 content 원문과 분리해 남기는 운영 기준입니다."
  - title: "AI Usage Metrics Contract"
    href: "/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/"
    description: "AI 활동을 비용·저장소·PR 결과로 연결할 때 필요한 최소 이벤트 스키마를 다룹니다."
  - title: "Agent Artifact Quarantine Gate"
    href: "/posts/2026-07-26-agent-artifact-quarantine-gate-trend/"
    description: "AI가 다루는 산출물을 신뢰·격리·승인 상태로 분리하는 방법입니다."
  - title: "데이터 보존·삭제 아키텍처"
    href: "/learning/deep-dive/deep-dive-data-retention-deletion-architecture/"
    description: "서비스의 primary store, backup, search index, audit log에서 삭제가 닫히는 조건을 정리합니다."
decision_guide:
  title: "AI workload를 어느 data-control 경로로 설계할까"
  intro: "ZDR은 민감도가 높은 요청에 강한 제어지만, stateful API 기능과 운영 조사 방식이 달라집니다. 모든 workload에 같은 설정을 강제하기보다 데이터 등급과 필요한 state를 기준으로 분리합니다."
  cases:
    - badge: "ZDR 우선"
      title: "민감한 원문을 처리하지만 server-side conversation state가 필요하지 않다"
      fit: "규제 데이터 요약, 보안 incident triage, 내부 계약·소스코드 분석처럼 요청 단위 처리가 가능한 workload"
      watchouts: "애플리케이션 자체 로그와 tracing이 원문을 복사하면 provider ZDR만으로 데이터 경계가 끝나지 않는다."
      next_step: "승인된 project, stateless endpoint, 고객 소유 trace/audit, 원문 redaction을 한 묶음으로 canary한다."
    - badge: "Stateful 분리"
      title: "conversation, file, vector store 같은 지속 state가 제품 기능의 핵심이다"
      fit: "장기 대화, document retrieval, 사용자 workspace처럼 애플리케이션 state가 명시적으로 필요한 workload"
      watchouts: "ZDR이 켜져 있다는 라벨만 보고 stateful resource의 삭제·접근 통제를 놓치기 쉽다."
      next_step: "state owner, retention, deletion receipt, export·backup 경로를 product data와 같은 수준으로 설계한다."
    - badge: "보류"
      title: "민감도·보존 위치·안전 alert 책임자가 정해지지 않았다"
      fit: "POC가 production credentials와 고객 데이터를 함께 쓰거나, 누가 alert를 조사할지 모르는 상태"
      watchouts: "privacy promise와 incident response가 충돌하면 배포 뒤에 선택권이 사라진다."
      next_step: "data inventory와 incident runbook을 승인 산출물로 만든 뒤 synthetic data로만 평가한다."
---

AI 제품에서 "우리는 데이터를 저장하지 않는다"는 말은 이제 충분히 정확하지 않습니다. 요청 원문이 abuse monitoring log에 남는지, 대화·파일·vector store 같은 application state가 남는지, 모델 개선에 사용되는지, 사람이 원문을 볼 수 있는지, 안전 시스템이 어떤 축약 signal을 받는지는 서로 다른 질문입니다. 하나라도 섞으면 보안 검토에는 과한 약속을 하고, 제품 설계에서는 필요한 기능을 뒤늦게 잃게 됩니다.

OpenAI는 2026년 8월 19일 eligible API 고객을 위한 Zero Data Retention(ZDR)과 함께 **Private Safety Processing** preview를 공개했습니다. 공개 설명의 요지는 ZDR 환경에서 고객 content를 사람이 검토하지 않으면서도, 여러 상호작용에 걸쳐 나타나는 위험 패턴을 자동 처리로 식별하려는 것입니다. customer-controlled infrastructure 또는 고객이 제어하는 키로 암호화된 저장소를 전제로, 제공자는 원문 대신 제한된 유형의 safety signal을 받는 구조를 제시합니다. 이는 일반 제공 기능이 아니라 early customer 대상 preview이므로, 제품 계약에 쓸 때는 실제 계정·endpoint·지역의 지원 범위를 따로 확인해야 합니다.

이 글은 [Agent Session Ledger와 AI Credit Control](/posts/2026-07-03-agent-session-ledger-ai-credit-controls-trend/), [AI Usage Metrics Contract](/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/), [Agent Artifact Quarantine Gate](/posts/2026-07-26-agent-artifact-quarantine-gate-trend/), [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)의 데이터 거버넌스 편입니다. 핵심은 특정 공급자의 기능을 홍보하는 데 있지 않습니다. AI가 더 긴 작업을 수행할수록 privacy와 safety를 하나의 "저장 on/off"로 해결할 수 없으며, **content plane, state plane, safety signal plane, 운영 증거 plane을 분리해야 한다**는 점입니다.

참고한 공식 자료:

- [OpenAI: Offering Zero Data Retention for frontier models](https://openai.com/index/offering-zero-data-retention-for-frontier-models/) — 2026-08-19, Private Safety Processing preview
- [OpenAI API: Data controls](https://developers.openai.com/api/docs/guides/your-data) — abuse monitoring·application state·endpoint별 ZDR 지원 범위
- [OpenAI API: Data controls FAQ](https://help.openai.com/en/articles/8555545-api-data-usage-policies) — API data usage의 기본 원칙

## 이 글에서 얻는 것

- 모델 학습, abuse monitoring 보존, application state 보존, human review, safety signal을 다른 통제로 설명할 수 있습니다.
- ZDR을 적용해도 stateful endpoint와 애플리케이션 로그에서 content가 남을 수 있는 이유를 구분합니다.
- 민감 workload와 일반 workload를 project·endpoint·관측성 단위로 분리하는 기준을 얻습니다.
- 안전 alert가 원문을 제공하지 않는 환경에서 조사·재판정·고객 책임을 어떻게 설계할지 정리합니다.

## 핵심 개념/이슈

### 1) "학습하지 않음", "보존하지 않음", "사람이 보지 않음"은 같은 말이 아니다

API data control을 검토할 때 가장 먼저 고쳐야 할 표현은 "데이터를 안 쓴다"입니다. 실제 설계 문서에는 적어도 아래 네 행을 분리해야 합니다.

| 질문 | 확인할 대상 | 잘못된 단정 |
| --- | --- | --- |
| 모델 학습에 쓰는가 | opt-in/contract와 provider policy | 학습 미사용 = 저장 없음 |
| abuse monitoring에 남는가 | 기본 보존·ZDR/MAM 적용 여부 | ZDR = 모든 log 없음 |
| application state가 남는가 | conversation, file, vector store, batch 등 endpoint | API 호출 = stateless |
| 사람이 원문을 볼 수 있는가 | human review·Eyes Off·Safety Retention 조건 | 암호화 = 누구도 볼 수 없음 |

OpenAI API 문서는 기본 abuse monitoring log가 일부 customer content와 classifier output을 포함할 수 있고, 통상 최대 30일 보존된다고 설명합니다. 승인된 ZDR은 이런 log에서 customer content를 제외하도록 설계됐지만, 그 자체로 모든 API capability의 application state를 없애지는 않습니다. 예를 들어 documentation상 `/v1/conversations`, files, vector stores 같은 stateful 기능은 ZDR과 별도의 보존 성격을 갖습니다. 반대로 stateless request를 쓰면서 application log에 prompt와 completion 전체를 복사한다면 provider의 ZDR은 조직 내부 복제본을 지우지 못합니다.

따라서 privacy review의 질문은 "ZDR을 켰는가"가 아니라 **"이 workload의 원문, 파생 데이터, persistent state, 운영 로그가 어디에 어떤 lifecycle로 남는가"**여야 합니다. 이 구분은 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)에서 primary DB·cache·search·backup을 각각 닫는 이유와 같습니다.

### 2) Private Safety Processing은 content plane과 signal plane을 의도적으로 분리한다

긴 agent 작업에서 위험은 한 request만 보면 보이지 않을 수 있습니다. 여러 계정에서 반복적으로 safeguard를 탐색하거나, 길게 이어진 작업이 승인된 목표에서 벗어나거나, 개별 메시지는 정상처럼 보여도 sequence가 위험할 수 있습니다. 전통적인 request-by-request filtering만으로 이 패턴을 찾기 어려운 이유입니다.

이번 preview가 흥미로운 점은 그 해법을 "원문을 더 오래 보관한다"로만 제시하지 않았다는 데 있습니다. 공개 설명상 automated system은 관련 상호작용을 가로질러 패턴을 식별하고, provider에는 activity 유형을 알리는 좁은 safety signal이 전달됩니다. 고객은 자신의 infrastructure나 자신이 제어하는 키 아래의 content로 alert와 enforcement를 조사할 수 있습니다. 즉 다음 두 plane을 분리합니다.

```text
customer content plane: prompt, response, file, tool result
  -> customer-controlled storage or customer-controlled encryption key

safety signal plane: policy category, alert identifier, enforcement state
  -> minimum signal for provider safety response
```

이것은 "safety signal은 개인 정보가 아니다"라는 뜻이 아닙니다. signal도 user, session, time, policy category와 결합되면 민감한 운영 데이터가 될 수 있습니다. 다만 원문 full-text와 동등하게 취급하지 않고, access control·retention·purpose를 별도 설계할 수 있게 해 줍니다. signal이 생겼다는 사실만으로 사용자를 차단하거나 위험하다고 낙인찍지 않도록 human escalation, appeal, evidence 범위도 필요합니다.

### 3) endpoint의 편의 기능은 data retention contract를 바꾼다

개발자는 API를 모델 호출 하나로 생각하기 쉽지만, 제품 관점에서는 state가 흐르는 방향이 다릅니다. ZDR은 `/v1/responses`와 chat completion의 `store` 동작을 바꾸지만, 모든 기능이 ZDR eligible이라는 뜻은 아닙니다. 대화 continuity, file upload, retrieval index, async batch, eval record, agent trace는 각각 생성·삭제·export·access 권한을 가진 product data가 될 수 있습니다.

| 기능 선택 | 얻는 것 | data governance에서 추가할 것 |
| --- | --- | --- |
| stateless request + ZDR | 짧은 민감 요청의 보존 축소 | prompt redaction, local audit, request ID correlation |
| server-side conversation | 편한 multi-turn state | thread owner, delete API, retention·export 정책 |
| file/vector retrieval | 문서 기반 정확도와 재사용 | file source 분류, chunk 삭제 전파, ACL, index purge 증거 |
| tool-using agent | 실제 업무 실행 | tool input/output redaction, approval receipt, result quarantine |
| safety alert | sequence-level risk 대응 | alert triage owner, evidence access, appeal·rollback 절차 |

특히 `store: true`를 의도적으로 사용하던 코드가 ZDR project에서 기대와 다르게 동작하면, 품질·디버깅·재현성 기능이 조용히 바뀔 수 있습니다. 이것은 privacy 기능의 실패가 아니라 **설계한 state dependency가 드러난 것**입니다. integration test는 HTTP 200만 확인하지 말고, 요청 뒤 provider state가 생성되지 않았는지 또는 설계대로 생성·삭제되는지 확인해야 합니다.

### 4) 관측성은 원문 수집이 아니라 최소 증거 수집으로 다시 설계한다

ZDR을 켠 다음 prompt와 response를 APM, exception tracker, analytics warehouse에 전부 남기면 데이터 노출 면적은 줄지 않습니다. 반대로 아무 로그도 남기지 않으면 비용 급증, quality regression, safety alert의 원인 조사가 불가능해집니다. 답은 둘 중 하나가 아니라 원문과 운영 증거를 나누는 것입니다.

권장 event는 다음처럼 content를 기본 필드로 넣지 않습니다.

```yaml
ai_request_receipt:
  request_id: "req_01J..."
  project_data_mode: "zdr"
  workload_class: "contract-summary"
  model: "approved-model"
  input_chars_bucket: "4k-8k"
  output_chars_bucket: "1k-2k"
  latency_ms: 1840
  tool_calls: 0
  safety_signal: "none"
  retention_policy_version: "2026-08-v3"
  content_hash: "optional-customer-keyed-hmac"
```

이 receipt로 비용, latency, error, model version, policy result, retention configuration은 추적할 수 있습니다. 원문이 꼭 필요한 incident가 생기면 고객이 통제하는 secure case store에서 최소 범위·시간 제한·승인 기반으로 연결합니다. [AI Usage Metrics Contract](/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/)가 말한 비용·결과 join도 raw prompt dump가 아니라 stable request ID와 workload class로 시작할 수 있습니다.

## 실무 적용

### 1) 5개 필드로 AI data inventory를 만든다

새 모델을 붙이기 전, endpoint 단위로 아래 다섯 필드를 문서화합니다. vendor의 marketing label을 복사하는 대신 실제 product path를 적는 것이 핵심입니다.

| 필드 | 예시 질문 | 승인 기준 |
| --- | --- | --- |
| content class | 계약, source code, PHI, 공개 문서 중 무엇인가 | 민감도 owner가 지정됨 |
| API/state path | stateless response, conversation, file, vector store인가 | 생성·삭제·export 경로가 있음 |
| retention mode | default, MAM, ZDR, customer-managed storage인가 | project와 runtime config가 일치 |
| observability | 무엇을 원문 없이 측정하는가 | receipt·metric·error policy가 있음 |
| safety response | alert를 누가 어떤 원문으로 조사하는가 | 24시간 내 triage owner와 escalation 있음 |

이 표를 만들면 "우리는 ZDR 고객이다" 같은 조직 전체 라벨보다 정확한 결정을 할 수 있습니다. 공개 FAQ 챗봇은 ZDR stateless project로, 장기 문서 assistant는 별도 stateful project로, production agent sandbox는 또 다른 project와 credential scope로 나누는 식입니다. project 분리는 권한과 billing을 더 복잡하게 하지만, retention exception이 전체 조직으로 번지는 것을 막습니다.

### 2) rollout은 data mode와 안전 대응을 함께 검증한다

**1주차 — synthetic content.** ZDR 후보 project에서 stateless endpoint와 application log redaction을 붙입니다. `store=true` 요청, timeout, retry, error object가 예상치 않은 state나 원문 로그를 만들지 않는지 확인합니다.

**2주차 — 낮은 민감도 canary.** 1~5% traffic에서 receipt completeness, content-log leak, latency, tool failure를 24시간 봅니다. 중앙 log query로 prompt-like field가 1건이라도 발견되면 확대하지 말고 logging middleware부터 고칩니다.

**3주차 — alert drill.** 원문 없이 도착한 simulated safety signal을 보고 on-call이 request ID, actor authorization, customer-owned case evidence로 30분 안에 조사할 수 있는지 연습합니다. false positive는 무조건 해제하지 말고 reviewer, reason, expiry를 기록합니다.

**4주차 — 민감 workload 확대.** data owner가 sign-off한 workload만 25%, 50%, 100%로 넓힙니다. stateful 기능이 필요한 팀은 ZDR 예외가 아니라 별도 data product로 운영합니다. retention·deletion·ACL 문서가 없으면 확대하지 않습니다.

### 3) 승인과 중단 기준을 명확히 한다

우선순위는 **민감 원문 최소화 > 필요한 제품 state의 설명 가능성 > safety investigation 가능성 > 비용·개발 편의성**입니다. privacy를 지킨다며 안전 조사 불가능하게 만들거나, 품질을 위해 모든 content를 무기한 보관하는 양극단을 피해야 합니다.

| 항목 | 확대 조건 | 중단·수정 조건 |
| --- | --- | --- |
| ZDR config | approved project와 endpoint matrix가 100% 일치 | stateful ineligible API를 의도 없이 호출 |
| app logging | sample 1,000건에서 raw prompt/response 0건 | 원문 또는 민감 file path 1건 발견 |
| receipt | request ID·mode·latency·outcome 99.9% 이상 | troubleshooting이 원문 dump를 요구 |
| safety drill | alert 30분 내 owner·case·판정 연결 | owner 부재 또는 evidence access 실패 |
| deletion | stateful resource delete와 downstream purge 검증 | 삭제 receipt 또는 backup policy 부재 |

숫자는 서비스 규모에 맞게 조정할 수 있지만, "원문 log 발견 0건"과 "alert owner 명확"은 낮추기 어려운 기본선입니다. [Agent Artifact Quarantine Gate](/posts/2026-07-26-agent-artifact-quarantine-gate-trend/)처럼 AI 산출물을 바로 신뢰하지 않는 것과, source content를 필요 이상 복사하지 않는 것은 같은 원칙의 양면입니다.

## 트레이드오프/주의점

첫째, ZDR은 모든 기능을 자동으로 privacy-safe하게 만들지 않습니다. application state를 만들거나, 고객 애플리케이션이 content를 저장하거나, tool이 외부 SaaS에 데이터를 전송하면 별도의 retention·access·deletion 계약이 필요합니다. 특히 vector retrieval은 원문 삭제와 embedding·chunk·cache·backup 삭제가 모두 닫혀야 합니다.

둘째, safety signal은 문맥을 줄인 정보이므로 false positive와 부족한 설명이라는 trade-off가 있습니다. 운영자는 signal 하나만 보고 제재하지 말고, 고객의 자체 evidence와 승인된 조사 절차로 교차 확인해야 합니다. 반대로 provider가 원문을 볼 수 없다는 점을 위험 대응 책임이 사라진 것으로 해석해서도 안 됩니다. 각 조직이 acceptable use, user notice, alert review, appeal의 책임을 가져야 합니다.

셋째, customer-managed key나 customer-controlled storage는 control을 높이지만 key rotation, incident access, disaster recovery, jurisdiction, 로그 correlation을 더 어렵게 만들 수 있습니다. key를 잃으면 provider가 복구할 수 없는지, break-glass access가 어떤 approval 아래 가능한지, encrypted backup은 얼마나 남는지까지 문서화해야 합니다.

넷째, preview 기능은 architecture direction의 신호일 뿐 production 보장의 근거가 아닙니다. 지원 endpoint, region, contract, enforcement signal의 의미, rollout schedule은 변경될 수 있습니다. 설계는 provider-specific API를 감싸는 data-control adapter와 project policy로 만들고, 공식 문서의 변화는 release gate에서 재검증합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] workload별로 model training, abuse monitoring, application state, human review, safety signal을 별도 열로 inventory했다.
- [ ] ZDR project와 일반/stateful project의 credential·endpoint·billing·owner를 분리했다.
- [ ] prompt, response, file content가 APM·error tracker·analytics에 기본 복제되지 않으며 sample 1,000건에서 0건을 확인했다.
- [ ] `store`와 stateful endpoint 의존성이 ZDR 설정에서 어떻게 바뀌는지 integration test로 검증했다.
- [ ] request receipt는 원문 없이 request ID, data mode, latency, model, outcome, policy version을 남긴다.
- [ ] safety alert의 triage owner, 30분 내 조사 경로, false-positive review, appeal evidence의 위치가 문서화됐다.
- [ ] file·vector·conversation을 쓰는 workload에는 retention·delete·ACL·backup purge owner와 증거가 있다.

### 연습

하나의 내부 AI 요약 기능을 골라 `stateless ZDR project`와 `stateful document assistant project`로 나눠 보세요. 각 project에 대해 (1) 무엇이 persistent state인지, (2) 어떤 log가 원문을 복사하는지, (3) safety alert가 오면 누가 어떤 권한으로 조사하는지, (4) 사용자가 삭제를 요청하면 어떤 ID로 delete receipt를 만들지 표로 작성합니다. 마지막으로 실제 prompt 대신 synthetic marker를 넣어 log·trace·error tracker·file store에 marker가 남는지 검색하면, provider 설정 밖의 데이터 복제 경로를 빠르게 찾을 수 있습니다.
