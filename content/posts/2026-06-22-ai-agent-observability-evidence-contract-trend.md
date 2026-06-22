---
title: "2026-06-22 개발 트렌드: AI 에이전트 관측성은 대시보드에서 증거 계약으로 이동한다"
date: 2026-06-22T10:06:00+09:00
draft: false
tags: ["dev-trends", "ai-agent", "observability", "opentelemetry", "governance", "platform-engineering"]
categories: ["Development", "Tech Trend"]
description: "GenAI OpenTelemetry, 에이전트 런타임, 관측 데이터 보존 이슈를 묶어 AI 에이전트 시대의 관측성을 증거 계약 관점으로 정리합니다."
---

요즘 개발 트렌드에서 반복해서 보이는 흐름은 단순합니다. AI 에이전트가 코드 작성 보조를 넘어 배포, 운영 진단, 티켓 처리, 데이터 조회, 워크플로 실행으로 들어오면서 **관측성의 소비자도 사람에서 사람+기계로 바뀌고 있다**는 점입니다. 사람이 대시보드를 보고 판단하던 시대에는 예쁜 UI, 적당한 샘플링, 짧은 보존 기간이 어느 정도 통했습니다. 하지만 에이전트가 원인 후보를 찾고, 다음 액션을 제안하고, 때로는 도구를 호출하려면 더 다른 조건이 필요합니다. 무엇을 봤고, 어떤 근거로 판단했으며, 어느 권한으로 실행했는지 재현 가능한 증거가 남아야 합니다.

OpenTelemetry 쪽에서는 GenAI semantic conventions가 모델명, 토큰 사용량, 지연, 도구 호출 같은 LLM 작업 정보를 표준 속성으로 남기려는 방향으로 발전하고 있습니다. 동시에 업계 글들은 AI 에이전트 운영에서 거버넌스, 장기 보존, full-fidelity 데이터, 비용 모델, 사람 개입 지점이 중요해졌다고 말합니다. 이것을 한 줄로 정리하면, 2026년의 관측성은 "장애 때 사람이 볼 차트"에서 **에이전트와 사람이 함께 검증할 증거 계약**으로 이동하고 있습니다. 이 흐름은 기존에 정리한 [AI 에이전트 관측성 트렌드](/posts/2026-02-28-ai-agent-observability-trend/), [Tool Contract Test와 Schema Canary](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/), [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)와 자연스럽게 이어집니다.

## 이 글에서 얻는 것

- AI 에이전트 시대에 관측성이 왜 로그/메트릭/트레이스 수집을 넘어 증거 계약이 되는지 이해합니다.
- OpenTelemetry GenAI semantic conventions 흐름을 실무 도입 기준으로 해석할 수 있습니다.
- 에이전트가 사용할 telemetry를 설계할 때 보존 기간, 샘플링, 민감정보, 비용 기준을 숫자로 정할 수 있습니다.
- 대시보드 중심 관측성과 machine-readable evidence 중심 관측성의 트레이드오프를 구분합니다.

## 핵심 개념/이슈

### 1) 에이전트는 차트를 보는 사용자가 아니라 telemetry를 질의하는 실행 주체다

기존 관측성 플랫폼은 대개 사람이 온콜 중에 보는 화면을 중심으로 발전했습니다. 장애가 나면 엔지니어가 대시보드를 열고, p95 latency를 보고, 로그를 검색하고, 트레이스를 따라갑니다. 이때 데이터는 사람이 판단하기에 충분할 정도면 됩니다. 100% 원본을 보관하지 않아도, 경험 있는 사람이 그래프 모양과 최근 배포 이력을 연결해 원인을 추정할 수 있습니다.

AI 에이전트가 들어오면 조건이 달라집니다. 에이전트는 직관이 없습니다. 대신 많은 데이터를 반복 질의하고, 유사 패턴을 비교하고, 도구 호출 결과를 근거로 다음 행동을 정합니다. 그러려면 아래 정보가 구조화돼 있어야 합니다.

- 요청 단위 trace id와 사용자 영향도
- 모델 호출의 입력 유형, 출력 유형, 토큰 사용량, latency
- tool call 이름, 인자 schema, 결과 상태, 실패 원인
- 권한 lease, approval, human gate 통과 여부
- 비용, retry, fallback, cache hit 같은 실행 메타데이터

이 정보가 자연어 로그에만 흩어져 있으면 에이전트는 매번 추론해야 합니다. 반대로 표준 속성과 이벤트로 남아 있으면 사람이든 에이전트든 같은 증거를 보고 판단할 수 있습니다. 그래서 관측성은 UI 문제가 아니라 **계약 문제**가 됩니다.

### 2) GenAI telemetry는 "프롬프트 저장"이 아니라 실행 맥락 표준화다

OpenTelemetry의 GenAI 관련 논의에서 중요한 포인트는 "모든 프롬프트를 다 저장하자"가 아닙니다. 오히려 민감정보와 비용 때문에 전체 본문 저장은 위험할 수 있습니다. 핵심은 모델 호출과 에이전트 실행을 설명하는 공통 어휘를 맞추는 것입니다.

예를 들어 같은 LLM 호출이라도 아래 질문에 답할 수 있어야 합니다.

- 어떤 모델과 provider를 호출했는가
- 입력 토큰과 출력 토큰은 얼마였는가
- stream 응답인지 batch 응답인지
- tool call이 있었는가, 있었다면 어떤 도구였는가
- 실패가 provider 오류인지 rate limit인지 validation 오류인지
- 사용자가 승인한 작업인지 자동 실행된 작업인지

이 정도가 표준화되면 벤더를 바꿔도 운영 분석이 덜 흔들립니다. 특히 여러 모델, 여러 에이전트 프레임워크, 사내 도구, 외부 API가 섞인 팀에서는 trace shape가 제각각이면 장애 분석이 급격히 느려집니다. [OpenTelemetry 실무 가이드](/learning/deep-dive/deep-dive-opentelemetry/)와 [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/)을 먼저 잡아야 하는 이유도 여기에 있습니다.

### 3) 샘플링과 짧은 보존 기간은 사람에게는 절약, 에이전트에게는 기억상실일 수 있다

관측 데이터는 비쌉니다. 그래서 많은 팀은 trace sampling, log sampling, metric rollup, 짧은 retention을 씁니다. 사람이 장애를 보는 모델에서는 합리적인 선택입니다. 모든 요청을 볼 필요 없이 대표 샘플과 주요 지표만 있으면 충분한 경우가 많기 때문입니다.

하지만 에이전트가 장기 패턴을 찾고, 지난 사고와 현재 증상을 비교하고, 배포 전후의 미세한 품질 저하를 찾아야 한다면 조건이 달라집니다. 72시간 보존만으로는 주간 패턴을 못 봅니다. 1% trace sampling으로는 특정 고객군, 특정 도구 호출, 특정 fallback 경로의 희귀 실패를 놓칠 수 있습니다. rollup된 p95만 남기면 개별 실행 증거를 재구성하기 어렵습니다.

실무 기준은 아래처럼 나눌 수 있습니다.

- 일반 웹 트래픽 trace: 비용상 1~10% 샘플링 가능
- 에러, timeout, retry, tool failure trace: 100% 보존 우선
- 에이전트가 외부 상태를 바꾼 실행: 최소 30~90일 원본 receipt 보존
- 결제, 권한, 데이터 삭제, 배포 작업: 감사 요구에 맞춰 180일 이상 보존 검토
- prompt/content 원문: 기본 비저장, 저장 시 명시적 opt-in과 마스킹 필수

즉 모든 데이터를 영구 보존하자는 말이 아닙니다. **실행 책임이 있는 데이터와 단순 성능 분석 데이터를 다르게 취급하자**는 말입니다.

### 4) 관측성의 새 단위는 span 하나가 아니라 "작업 증거 묶음"이다

사람이 REST API 하나를 호출하던 구조에서는 request span 하나가 분석의 중심이었습니다. 에이전트 작업은 더 길고 복잡합니다. 하나의 사용자 요청이 계획, 검색, 코드 변경, 테스트, PR 작성, 배포 요청까지 이어질 수 있습니다. 이때 span 하나만 보면 전체 의사결정이 보이지 않습니다.

그래서 실무에서는 작업 단위를 아래처럼 묶어야 합니다.

- `task_id`: 사용자가 요청한 업무 단위
- `run_id`: 특정 실행 시도
- `step_id`: 계획, 조회, 수정, 검증, 승인 같은 단계
- `tool_call_id`: 실제 도구 호출 단위
- `evidence_id`: 로그, diff, 테스트 결과, API 응답 같은 근거 단위
- `approval_id`: 사람이 승인한 지점

이 구조는 [Workflow State Contract](/posts/2026-04-27-workflow-state-contract-agent-ops-trend/)와도 맞닿아 있습니다. 에이전트 운영에서 중요한 것은 "에이전트가 무슨 말을 했는가"보다 **어떤 상태에서 어떤 근거를 보고 무엇을 실행했는가**입니다. 관측성도 같은 질문에 답하도록 설계해야 합니다.

## 실무 적용

### 1) AI 에이전트 관측성의 최소 스키마

처음부터 완벽한 표준을 만들 필요는 없습니다. 다만 프로덕션 PoC라면 최소한 아래 필드는 공통으로 남겨야 합니다.

| 구분 | 필드 예시 | 목적 |
| --- | --- | --- |
| 작업 식별 | `task_id`, `run_id`, `step_id` | 긴 작업의 재현과 중단점 확인 |
| 모델 호출 | `model`, `provider`, `input_tokens`, `output_tokens`, `latency_ms` | 비용과 성능 분석 |
| 도구 호출 | `tool_name`, `schema_version`, `args_hash`, `status`, `error_code` | tool contract 회귀 확인 |
| 권한 | `permission_scope`, `lease_expires_at`, `approval_id` | 과권한 실행 차단 |
| 결과 | `changed_resources`, `test_result`, `rollback_hint` | 사람 리뷰와 복구 판단 |
| 민감정보 | `redaction_policy`, `content_stored` | 감사와 개인정보 통제 |

여기서 `args_hash`는 원문 인자를 그대로 저장하지 않아도 동일 실행을 비교할 수 있게 해줍니다. 민감정보가 많은 환경에서는 원문 저장보다 hash, schema version, validation 결과를 남기는 편이 안전합니다.

### 2) 의사결정 기준: 언제 도입하고 얼마나 보존할까

팀이 AI 에이전트를 단순 질의 응답에만 쓰는 단계라면 복잡한 관측성 체계는 과합니다. 하지만 아래 조건 중 2개 이상이면 structured telemetry를 우선 도입해야 합니다.

- 에이전트가 파일, 티켓, 배포, 데이터베이스, 클라우드 리소스를 변경한다.
- tool call 실패가 사용자 영향 장애로 이어질 수 있다.
- 월간 모델/도구 비용이 팀 예산의 5% 이상으로 올라왔다.
- 같은 작업을 3명 이상이 반복 실행한다.
- 보안/개인정보/감사 요구가 있는 데이터를 읽는다.
- 장애 후 "에이전트가 왜 그렇게 판단했는지"를 재구성해야 한다.

보존 기준은 위험도별로 나눕니다.

- 읽기 전용 Q&A: 7~30일, 원문 저장은 opt-in
- 코드 변경/PR 생성: 30~90일, diff와 테스트 결과 보존
- 배포/권한/비용 발생 작업: 90~180일, approval과 receipt 필수
- 데이터 삭제/정산/보안 조치: 180일 이상 또는 조직 감사 기준 우선

이 기준은 [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)와 같이 설계하면 더 단단해집니다. 권한이 만료되고, 실행 증거가 남고, 사람이 승인한 지점이 연결돼야 나중에 설명할 수 있습니다.

### 3) 대시보드보다 먼저 만들 운영 질문

도구를 고르기 전에 팀이 답해야 할 질문은 아래입니다.

1. 에이전트 작업 하나를 10분 뒤, 7일 뒤, 90일 뒤에도 재구성할 수 있는가?
2. 모델 비용 상승이 어떤 작업 유형과 연결되는지 알 수 있는가?
3. tool schema 변경이 실패율을 올렸는지 추적할 수 있는가?
4. 사람이 승인한 작업과 자동 실행 작업을 분리해 볼 수 있는가?
5. 민감정보가 telemetry에 들어갔을 때 어디서 마스킹되는가?
6. 샘플링 때문에 실패 증거가 빠질 수 있는 경로는 무엇인가?

이 질문에 답하지 못하면 대시보드가 예뻐도 운영은 약합니다. 반대로 질문에 답할 데이터 모델이 잡히면, UI는 나중에 바꿔도 됩니다.

### 4) 단계적 도입 로드맵

**1주차: 실행 receipt부터 남긴다**  
모든 에이전트 작업에 `task_id`, `run_id`, 시작/종료 시각, 최종 상태, 주요 tool call 목록을 남깁니다. 실패한 작업은 100% 보존합니다.

**2~3주차: 모델 비용과 latency를 붙인다**  
모델명, provider, token, latency, retry를 표준 필드로 수집합니다. 월 비용 상위 10개 작업 유형을 뽑고, 비용 대비 성공률을 봅니다.

**4~6주차: tool contract와 연결한다**  
도구별 schema version, validation error, backward compatibility failure를 trace에 붙입니다. 이때 [Tool Contract Test와 Schema Canary](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/)를 CI에 연결하면 회귀를 빨리 잡을 수 있습니다.

**7주차 이후: 보존과 샘플링 정책을 위험도별로 나눈다**  
모든 데이터를 똑같이 다루지 않습니다. low-risk Q&A는 비용을 줄이고, state-changing action은 증거를 보존합니다. 이 단계에서 보안팀과 개인정보 담당자를 끌어들이는 편이 좋습니다.

## 트레이드오프/주의점

첫째, full-fidelity telemetry는 비쌉니다. 특히 에이전트가 많은 도구를 반복 호출하면 trace volume이 빠르게 커집니다. 그래서 "모든 span 영구 보존"이 아니라 **위험 기반 보존**이 맞습니다. 실패, 외부 상태 변경, 비용 발생, 권한 사용은 우선 보존하고, 단순 조회는 샘플링해도 됩니다.

둘째, prompt와 tool result 원문 저장은 편하지만 위험합니다. 개인정보, secret, 고객 데이터, 내부 코드가 섞일 수 있습니다. 기본값은 원문 비저장으로 두고, 디버깅용 opt-in을 열더라도 TTL, 접근권한, 마스킹, audit log를 같이 둬야 합니다. OpenTelemetry의 민감정보 처리 원칙처럼 데이터 최소화가 출발점이어야 합니다.

셋째, 표준 스키마는 빠르게 변합니다. GenAI semantic conventions는 계속 발전 중이고, 벤더별 지원 수준도 다릅니다. 따라서 특정 벤더 대시보드 필드명에 비즈니스 로직을 묶지 말고, 내부 canonical event를 둔 뒤 exporter를 붙이는 구조가 안전합니다.

넷째, 관측성이 있다고 자동으로 좋은 판단이 나오지는 않습니다. 에이전트가 잘못된 근거를 그럴듯하게 조합할 수 있습니다. 그래서 high-risk action은 human gate를 유지하고, 에이전트의 권고와 실제 실행을 분리해야 합니다. 관측성은 자동 실행의 면허가 아니라, 실행을 검증하는 기반입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 에이전트 작업에 `task_id`, `run_id`, `step_id`가 붙어 있다.
- [ ] 실패한 tool call과 state-changing action은 샘플링 없이 보존한다.
- [ ] 모델명, token, latency, retry, provider 오류를 표준 필드로 남긴다.
- [ ] tool schema version과 validation error를 trace에서 확인할 수 있다.
- [ ] prompt/content 원문 저장 기본값이 꺼져 있고, opt-in 시 TTL과 마스킹이 있다.
- [ ] 사람이 승인한 작업과 자동 실행 작업을 분리해 검색할 수 있다.
- [ ] 비용 상위 작업 유형 10개를 매주 확인한다.
- [ ] 보존 기간이 위험도별로 다르게 정의되어 있다.

### 연습

1. 현재 팀의 AI 도구 또는 자동화 스크립트 하나를 골라 `task_id`, `run_id`, `tool_call_id`를 붙인 이벤트 스키마를 작성해 보세요.
2. 지난 7일간 실패한 자동화 작업 10개를 모아, 실패 원인이 도구 오류인지 권한 오류인지 입력 검증 오류인지 분류해 보세요.
3. prompt 원문을 저장하지 않고도 재현 가능한 증거를 남기려면 어떤 hash, schema version, fixture를 남겨야 하는지 정리해 보세요.
4. 에이전트가 배포나 데이터 변경을 수행하는 경우, 실행 전 human gate와 실행 후 receipt에 들어갈 필드를 각각 5개씩 적어보세요.

## 참고한 흐름

- OpenTelemetry: GenAI observability and semantic conventions  
  https://opentelemetry.io/blog/2026/genai-observability/
- OpenTelemetry: sensitive data handling  
  https://opentelemetry.io/docs/security/handling-sensitive-data/
- OpenTelemetry GenAI semantic conventions repository  
  https://github.com/open-telemetry/semantic-conventions-genai
- LangChain: State of Agent Engineering  
  https://www.langchain.com/state-of-agent-engineering
- TechRadar Pro: AI agents in live operations require new standards and management  
  https://www.techradar.com/pro/ai-agents-in-live-operations-require-new-standards-and-management

오늘의 결론은 단순합니다. AI 에이전트를 운영에 넣을수록 "잘 대답했는가"보다 "무엇을 근거로 실행했는가"가 중요해집니다. 관측성은 더 이상 사고 때 보는 화면만이 아닙니다. 에이전트가 행동하기 전에 제한하고, 행동한 뒤에 설명하며, 사람이 나중에 재현할 수 있게 만드는 증거 계약입니다.
