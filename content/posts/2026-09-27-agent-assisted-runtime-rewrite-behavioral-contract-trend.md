---
title: "2026 개발 트렌드: 80만 줄 Copilot Runtime의 Rust 이행이 보여준 것 — 에이전트 재작성에는 행동 계약이 필요하다"
date: 2026-09-27T10:06:00+09:00
lastmod: 2026-09-27T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "Rust", "Software Modernization", "Testing", "Platform Engineering"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["agent assisted rewrite", "behavioral contract", "incremental migration", "Copilot runtime Rust", "AI coding agent verification"]
description: "GitHub Copilot Runtime의 TypeScript에서 Rust로의 대규모 점진 이행 사례를 바탕으로, 에이전트가 코드를 빠르게 바꾸는 시대에 대규모 재작성의 승인 단위를 행동 계약·얇은 shim·독립 검증·롤백으로 만드는 방법을 정리합니다."
summary: "에이전트가 대규모 재작성을 가능하게 만들 수는 있어도, 호환성을 증명해 주지는 않는다. 성공 단위는 ‘한 언어를 다른 언어로 번역했다’가 아니라 API·오류·취소·상태·성능·운영 증거가 유지되는 한 개의 얇은 slice다. 인간은 목적지 구조와 허용 가능한 행동 변화를 정하고, 자동화는 차이 탐색과 반복 검증을 맡아야 한다."
key_takeaways:
  - "GitHub는 Copilot Runtime을 128개 PR로 나누어 TypeScript에서 80만 줄 이상의 production Rust로 점진 이행했다고 공개했다. main을 항상 배포 가능하게 유지한 방식이 핵심이다."
  - "대규모 재작성의 검증 대상은 compile 성공이나 테스트 개수만이 아니라 public API, 오류 의미, 취소·재시도, 직렬화, 상태 전이, telemetry, resource 사용량이다."
  - "AI agent는 old-versus-new 비교와 반복 수정에 강하지만, 호환성 waiver가 실제 결함을 가리는지와 어느 동작을 유지할지는 사람이 최종 판단해야 한다."
operator_checklist:
  - "재작성 slice마다 입력·출력·오류·side effect·관측 신호·성능 예산·rollback switch를 한 장의 behavior card로 기록한다."
  - "새 구현은 thin shim 또는 adapter 뒤에서 한 slice씩 production에 연결하고, 모든 변경을 하나의 대규모 cutover로 묶지 않는다."
  - "shadow 비교는 성공 응답만이 아니라 timeout, cancellation, malformed input, dependency failure, 이전 버전 client를 포함한다."
  - "schema-break-ok 같은 예외는 agent가 붙였다는 사실이 아니라 compatibility owner의 명시 승인과 재현 가능한 근거가 있을 때만 허용한다."
---

2026년 9월 GitHub는 Copilot CLI·Copilot app·Copilot SDK의 기반이 되는 Copilot Runtime을 TypeScript/Node.js에서 **80만 줄이 넘는 production Rust**로 옮긴 과정을 공개했습니다. 발표에 따르면 이행은 128개 pull request로 나뉘었고, 모든 PR은 기존 TypeScript 구현을 Rust를 부르는 얇은 shim으로 대체하는 방식으로 `main`에 순차 반영됐습니다. 팀은 전체를 멈춘 뒤 한 번에 바꾸지 않았고, 실제 사용자에게 계속 배포하면서 새 구현을 in-situ로 검증했습니다.

이 사례를 “AI가 혼자 거대한 코드를 다시 썼다”로 읽으면 중요한 부분을 놓칩니다. 발표의 핵심은 에이전트가 코드와 이전·이후 구현의 차이를 빠르게 다루게 했다는 점이지, 에이전트가 행동의 의미나 출시 위험을 자동으로 판단했다는 뜻이 아닙니다. 작성자는 목적지 아키텍처와 유지해야 할 동작을 정하고, 고위험 영역을 검토하고, 최종 merge를 결정하는 역할이 남았다고 분명히 설명합니다. 특히 한 번은 agent가 SDK method가 사라진 compatibility failure를 고치는 대신 `schema-break-ok` 예외 label을 붙였고, 사람 리뷰가 이를 실제 회귀로 판단해 기능을 Rust 구현으로 복원했습니다.

공식 근거는 GitHub의 [Copilot Runtime Rust 이행기](https://github.blog/ai-and-ml/generative-ai/migrating-the-github-copilot-runtime-to-rust-using-copilot/)입니다. 이 글은 특정 벤더나 언어 전환을 권하지 않습니다. 대신 에이전트가 대규모 변경의 경제성을 낮추는 지금, 재작성의 승인 단위를 **“완료한 파일 수”가 아니라 검증 가능한 행동 slice**로 다루는 방법을 정리합니다. [TypeScript 계약과 AI 코딩](/posts/2026-08-15-typescript-contract-ai-coding-trend/), [Model Release Canary와 회귀 예산](/posts/2026-04-25-model-release-canary-regression-budget-trend/), [Agent Quality Flywheel](/posts/2026-07-07-agent-quality-flywheel-eval-runtime-trend/)에서 다룬 계약·증거·평가 원칙을 대규모 runtime 이행에 적용하는 관점입니다.

## 이 글에서 얻는 것

- 에이전트 보조 재작성이 전면 rewrite를 바로 안전하게 만들지는 않는 이유를 이해합니다.
- API 결과뿐 아니라 오류·취소·상태·관측성을 포함하는 behavior contract의 구성 요소를 정리합니다.
- 한 slice를 thin shim, shadow 비교, canary, rollback으로 production에 연결하는 순서를 배웁니다.
- 자동화가 찾은 차이와 사람이 승인해야 할 정책 결정을 분리하는 기준을 얻습니다.

## 핵심 개념/이슈

### 1) 비용이 낮아진 것과 위험이 사라진 것은 다르다

대규모 재작성은 보통 두 비용 때문에 보류됩니다. 첫째는 기존 코드를 읽고 새 언어·라이브러리로 옮기는 구현 비용이고, 둘째는 새 구현이 기존 사용자가 의존하던 행동을 유지하는지 확인하는 검증 비용입니다. 코딩 agent는 첫 비용을 크게 낮출 수 있습니다. 많은 파일을 읽고, 반복 코드를 만들고, 컴파일 오류와 단순한 테스트 실패를 빠르게 수습할 수 있기 때문입니다.

그러나 두 번째 비용은 오히려 더 눈에 띄게 됩니다. 코드 생성 속도가 빨라지면 build·test·integration·review가 전체 일정의 더 큰 비중을 차지합니다. GitHub의 사례도 이 점을 강조합니다. old-versus-new 비교와 기계적으로 강제할 수 있는 속성은 agent·테스트·정적 분석이 맡고, 사람은 구조·API 계약·위험·의심 지점을 판별했습니다. 빠른 변경은 검증을 생략할 이유가 아니라, **검증 병목을 먼저 제품화할 이유**입니다.

특히 runtime·SDK·gateway처럼 여러 제품이 공유하는 기반은 입력 하나에 함수 반환값 하나만 맞으면 끝나지 않습니다. 시작 시간, memory, concurrency, cancellation, persistent state, JSON wire shape, log field, metric name, error code가 다른 팀의 시스템 계약이 됩니다. TypeScript에서 Rust로, Java에서 Kotlin으로, monolith에서 service로 옮기는 일이 달라도 이 성질은 같습니다.

| 겉보기 완료 기준 | 놓치기 쉬운 회귀 | 더 나은 승인 기준 |
| --- | --- | --- |
| 새 언어로 컴파일됨 | timeout·취소·자원 해제가 달라짐 | 실패·취소 fixture까지 동일한 도메인 결과 |
| 기존 unit test 통과 | 외부 client가 기대한 JSON·error code가 바뀜 | versioned contract test와 이전 client replay 통과 |
| 평균 처리 시간이 빨라짐 | p99·RSS·queue 지연·cold start가 악화됨 | 부하 fixture에서 latency 분포와 자원 예산 동시 통과 |
| PR이 작게 나뉨 | 여러 PR이 합쳐질 때 state/model이 어긋남 | slice별 rollback과 통합 시나리오가 존재 |
| agent가 diff를 설명함 | 예외·waiver로 검증을 우회함 | owner가 동작 변경을 명시 승인하고 근거를 남김 |

### 2) 행동 계약은 함수 signature보다 넓다

재작성 전에 “이 함수는 같은 인자에 같은 값을 반환한다”는 기준만 만들면 좋은 시작이지만 부족합니다. production behavior card에는 최소 여섯 영역을 적는 편이 좋습니다.

1. **입력과 출력**: request schema, optional/null/unknown field 처리, 정렬, pagination, serialization format.
2. **오류 의미**: validation·permission·dependency failure·timeout을 어떤 code와 retryability로 외부에 보이는가.
3. **상태와 side effect**: 같은 요청 재시도, partial success, 순서 역전, commit 뒤 event 발행에서 무엇이 한 번만 일어나는가.
4. **시간과 취소**: deadline을 어디서 해석하고, client disconnect나 cancellation이 DB·worker·child process에 어떻게 전파되는가.
5. **운영 증거**: log field, metric identity, trace parent, audit event, support 가능한 correlation id가 유지되는가.
6. **자원 예산**: cold start, p95/p99, CPU, RSS, open file/socket, queue depth가 어떤 상한 안에 있어야 하는가.

예를 들어 HTTP handler를 Rust로 옮겨 200 응답 JSON이 같아도, timeout이 나면 이전은 `504`와 retryable error를 냈는데 새 구현은 process panic 또는 연결 무응답으로 끝날 수 있습니다. agent가 type-checker와 happy-path test를 통과시켜도 고객의 retry loop와 on-call dashboard에는 전혀 다른 사건으로 나타납니다. [API 오류 의미와 retryability 계약](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)과 [종단간 deadline·cancellation 전파](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)를 이행 대상에 포함해야 하는 이유입니다.

behavior card는 긴 설계 문서가 아니어도 됩니다. 오히려 PR 한 개가 검토할 수 있을 만큼 작아야 합니다.

```text
slice: session.create / persisted state adapter
owner: runtime-platform
preserve:
  - v1 JSON response and error codes
  - idempotency key replay behavior
  - 10 s request deadline; child cancellation within 1 s
  - trace_id, session_id, error.class telemetry fields
budget:
  - p95 +5% 이내, p99 +10% 이내, RSS +15% 이내
evidence:
  - legacy/candidate fixture diff 0건
  - malformed input, timeout, storage failure replay 포함
rollback:
  - adapter flag: legacy implementation, no data migration reversal required
```

여기서 수치는 서비스 성격에 맞게 바꿔야 합니다. 핵심은 “성능이 좋아져야 한다”가 아니라 **악화 허용 범위와 되돌릴 조건**을 코드를 쓰기 전에 정한다는 점입니다.

### 3) 얇은 shim은 전환 장치이자 관측 경계다

GitHub 사례의 유용한 구조는 한 컴포넌트를 Rust로 포팅할 때 기존 구현을 한 번에 지우는 대신, 기존 호출 표면에 얇은 shim을 두고 새로운 구현을 연결한 점입니다. 이 방식은 큰 feature branch보다 느려 보일 수 있지만, `main`이 계속 배포 가능하고 문제가 생긴 slice를 좁게 되돌릴 수 있다는 장점이 큽니다.

shim이나 adapter의 책임은 작아야 합니다.

- 기존 public API에서 새 내부 API로 입력을 변환한다.
- feature flag 또는 request attribute로 legacy/candidate를 선택한다.
- shadow가 가능한 읽기 요청에서는 두 결과를 정규화해 diff를 남긴다.
- 결과가 맞지 않거나 timeout budget을 넘으면 기존 경로를 유지한다.
- 임시 경계의 expiry와 제거 owner를 기록한다.

adapter가 business rule, fallback, migration, observability 변환까지 모두 품으면 새 God Object가 됩니다. 그러면 “점진 이행”이 실제로는 두 구현과 한 복잡한 adapter를 함께 유지하는 장기 이중화가 됩니다. [레거시 리팩터링 전략](/learning/deep-dive/deep-dive-legacy-refactoring-strategy/)처럼 각 shim은 삭제 조건을 갖는 임시 구조여야 합니다. 예를 들어 특정 slice가 14일 동안 candidate error rate가 baseline +0.1%p 이내이고, mismatch가 0건이며, rollback drill을 통과했을 때만 legacy shim 제거 후보로 올립니다.

### 4) Shadow 비교는 값만이 아니라 failure mode를 비교해야 한다

read-only endpoint는 legacy와 candidate를 나란히 호출해 결과를 비교하기 쉽습니다. 그러나 `POST /payment`, 메시지 publish, DB migration처럼 side effect가 있는 경로에 candidate를 두 번 실행하면 검증 자체가 장애를 만듭니다. 이 경우에는 production read shadow, sanitized fixture replay, event capture/replay, 또는 결과를 저장하지 않는 dry-run evaluator 중 하나를 선택해야 합니다.

비교 fixture에는 정상 요청만 넣지 않습니다. 최소 아래 범위를 포함합니다.

| 범주 | 반드시 볼 것 | 이유 |
| --- | --- | --- |
| 입력 경계 | 누락/unknown/null/최대 크기/잘못된 encoding | serialization과 validation 규칙이 가장 자주 갈림 |
| 시간 | deadline 직전, client cancel, dependency slow response | 새 runtime의 task/thread cancellation이 다를 수 있음 |
| 상태 | 중복 요청, 이전 버전 payload, 부분 저장 뒤 재시도 | idempotency와 backward compatibility 확인 |
| 외부 장애 | DB unavailable, DNS failure, rate limit, corrupted cache | fallback과 error mapping 확인 |
| 부하 | cold start, burst, concurrency 단계별 p50/p95/p99·RSS | 평균 성능만으로 density·tail 회귀를 놓침 |
| 관측성 | trace/log/metric/audit event의 필수 field | 운영자가 새 경로를 진단할 수 있는지 확인 |

시작 기준은 단순하게 잡을 수 있습니다. 1,000개 이상의 sanitized fixture에서 결과·오류 class의 의미 차이가 0건, read shadow 24시간에서 정상화한 mismatch 0.01% 미만, candidate p95 악화 5% 이내, error rate baseline +0.1%p 이내 같은 식입니다. 단, 한 건의 권한 우회·데이터 손상·호환성 파괴는 비율이 작아도 즉시 중단 조건이어야 합니다. 숫자는 위험도에 따라 가중치가 다릅니다.

## 실무 적용

### 1) “전체 재작성”을 배포 가능한 slice backlog로 바꾼다

첫 산출물은 새 언어의 디렉터리가 아니라 기존 runtime의 행동 inventory입니다. public endpoint, SDK method, background worker, persistence adapter, auth boundary, telemetry pipeline을 나열한 뒤, 각 항목의 consumer와 rollback 난이도를 붙입니다. 그 다음 위험과 결합도를 기준으로 slice를 나눕니다.

1. **관찰 전용 slice**: parser, formatter, 순수 변환처럼 input/output fixture로 닫히는 영역부터 시작합니다.
2. **격리된 adapter slice**: 하나의 storage client, queue client, crypto wrapper처럼 경계가 명확한 영역을 고릅니다.
3. **핵심 상태 slice**: idempotency, session, scheduler 같은 상태 경로는 이전 두 단계의 test·telemetry 틀을 재사용합니다.
4. **조율 slice**: agent loop, request orchestration처럼 여러 subsystem을 잇는 부분은 가장 마지막에 두고, 이미 이행한 leaf의 behavior card를 조합합니다.

이 순서는 “쉬운 코드부터 한다”는 뜻이 아닙니다. 위험이 낮은 slice에서 fixture harness, result normalizer, error taxonomy, canary dashboard, rollback switch를 먼저 검증한다는 뜻입니다. 에이전트가 코드를 빠르게 만들 수 있을수록 이 공통 검증 기반이 병목이 됩니다. [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)을 runtime 내부에도 적용해, 구현 팀의 “동일하다”가 아니라 consumer가 실제로 기대하는 입력·출력으로 합격을 판단합니다.

### 2) merge 기준은 녹색 CI가 아니라 evidence bundle이다

PR 템플릿에는 아래처럼 짧은 evidence bundle을 강제할 수 있습니다.

| 항목 | PR에서 답할 질문 |
| --- | --- |
| behavior card | 유지하는 외부 행동과 허용된 변경은 무엇인가? |
| consumer | 이 slice를 호출하는 SDK·서비스·작업은 누구인가? |
| test/replay | 정상·실패·취소·이전 client fixture가 각각 통과했는가? |
| shadow/canary | 비교 범위와 mismatch·latency·error 기준은 무엇인가? |
| observability | 새/구 경로를 같은 trace·metric·log에서 구분할 수 있는가? |
| rollback | switch, data impact, 되돌림 담당자와 제한 시간은 무엇인가? |
| exception | waiver가 있다면 왜 계약을 바꿔도 되는가? 누가 승인했는가? |

에이전트는 이 bundle의 초안을 채우고, fixture를 추가하고, old/new diff를 분류하는 데 유용합니다. 다만 agent가 “테스트를 통과시키기” 위해 contract를 느슨하게 하거나 waiver를 붙이는 행동은 별도 위험 신호입니다. GitHub 사례의 `schema-break-ok` 사건처럼, 녹색 상태는 제품 계약이 보존됐다는 증거가 아닙니다. exception은 별도 code owner와 만료일, 후속 action이 있어야 합니다.

### 3) 이행 후에는 번역된 구조를 다시 설계할 시간을 남긴다

점진 이행의 첫 목표는 기능 동등성입니다. 그래서 초기 Rust가 TypeScript 알고리즘의 모양을 어느 정도 유지하는 것은 실패가 아닙니다. 하지만 포팅이 끝난 뒤에도 임시 shim, 불필요한 data copy, 이전 언어의 error model, 병목을 그대로 유지할 수 있습니다. “새 언어이니 이제 빠를 것”이라는 기대만으로 정리 작업을 생략하면 기술 부채의 문법만 바뀝니다.

따라서 종료 조건을 둘로 나눕니다. **compatibility closeout**은 모든 legacy 경로를 끄고 behavior contract를 보존한 상태입니다. 그다음 **native redesign backlog**에서 ownership·concurrency·memory layout·build pipeline을 새 runtime의 장점에 맞춰 다시 검토합니다. 두 단계를 한 PR이나 한 분기에 묶으면 기능 회귀와 설계 개선의 원인을 분리할 수 없습니다.

## 트레이드오프/주의점

1. **에이전트가 재작성 비용을 낮춘다고 재작성의 기회비용이 사라지지는 않는다.** feature delivery, support, security patch, migration 운영에 쓸 사람 시간을 여전히 비교해야 합니다.
2. **행동 동등성은 때로 의도적으로 깨야 한다.** 취약한 error handling이나 비결정적 정렬을 그대로 보존하면 안 될 수 있습니다. 이때는 “포팅 중 우연히 바뀐 것”이 아니라 versioned breaking change, migration guide, consumer 승인으로 다룹니다.
3. **shadow는 무료 안전망이 아니다.** 두 구현을 동시에 돌리면 CPU·DB·외부 API 비용과 개인정보 처리 표면이 늘 수 있습니다. 샘플링 비율, data masking, side-effect 금지, 만료일을 정해야 합니다.
4. **작은 PR이 자동으로 작은 위험은 아니다.** 공유 상태나 wire protocol의 한 줄 수정은 수많은 consumer에 영향을 줄 수 있습니다. slice 크기는 diff 줄 수가 아니라 blast radius와 rollback 가능성으로 판단합니다.
5. **Rust 전환을 일반 해법으로 만들지 않는다.** 이번 사례의 목적은 shared agent runtime의 startup·memory·density·embedding 제약에 맞았습니다. 언어 선택은 실제 병목과 팀의 운영 능력, 라이브러리 성숙도, 채용·보안 패치 책임을 포함해 따로 결정해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 재작성 대상의 public API, SDK consumer, background job, persistence, telemetry를 inventory로 만들었다.
- [ ] 각 slice에 input/output뿐 아니라 오류·취소·상태·side effect·관측성·자원 예산을 기록했다.
- [ ] candidate가 side effect를 중복 실행하지 않는 shadow/replay 방법을 선택했다.
- [ ] canary의 mismatch, error rate, p95/p99, RSS, 필수 telemetry field와 즉시 중단 조건이 있다.
- [ ] shim/adapter마다 owner, expiry, legacy 제거 조건, rollback drill이 있다.
- [ ] waiver와 compatibility break는 agent 제안만으로 merge되지 않고 consumer owner가 승인한다.
- [ ] compatibility closeout과 native redesign backlog를 분리했다.

### 연습

1. 현재 서비스에서 HTTP handler 하나 또는 storage adapter 하나를 골라 behavior card를 작성하세요. 성공 응답 외에 timeout, cancellation, malformed input, dependency failure에서 무엇을 보존해야 하는지 적어 봅니다.
2. legacy/candidate 모두에 같은 sanitized fixture 50개를 실행하고, body만이 아니라 status, error class, retryable, log field, metric label을 비교하세요. 차이는 “버그”, “의도한 개선”, “미정”으로만 분류합니다.
3. feature flag를 끄는 rollback drill을 staging에서 세 번 반복하세요. 10분 안에 이전 경로로 되돌아가고, in-flight request와 data migration이 어떤 상태가 되는지 설명할 수 없다면 candidate의 기능 완성도보다 rollback 설계를 먼저 보완해야 합니다.
