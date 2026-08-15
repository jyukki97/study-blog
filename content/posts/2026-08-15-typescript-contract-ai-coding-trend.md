---
title: "2026 개발 트렌드: AI 코딩 에이전트 시대의 타입 계약, TypeScript를 검토 가능한 경계로 쓰는 법"
date: 2026-08-15T10:06:00+09:00
lastmod: 2026-08-15T10:06:00+09:00
draft: false
tags: ["TypeScript", "AI Coding", "Code Review", "Software Quality", "Developer Experience", "Agentic Development"]
categories: ["Development", "TypeScript", "AI"]
series: ["dev-trends"]
keywords: ["TypeScript AI coding agents", "typed contracts", "AI code review", "runtime validation", "TypeScript quality gate", "agent generated code"]
description: "GitHub Octoverse 2025의 TypeScript 1위 전환과 AI 에이전트 확산 신호를 바탕으로, 타입 시스템을 AI 생성 코드의 정답 판정기가 아니라 변경 범위를 줄이고 리뷰 증거를 만드는 계약으로 운영하는 기준을 정리합니다."
summary: "AI가 코드 생성 속도를 높일수록 리뷰의 병목은 사라지지 않습니다. TypeScript의 타입 경계, runtime validation, contract test, typecheck evidence를 함께 두면 사람이 모든 줄을 읽지 않아도 되는 범위를 좁힐 수 있습니다."
key_takeaways:
  - "GitHub는 2025년 8월 TypeScript가 GitHub에서 가장 많이 쓰인 언어가 됐다고 보고했고, 이를 agent-assisted coding을 production에서 더 신뢰성 있게 만드는 typed language 전환의 신호로 해석했다."
  - "타입 검사는 AI 생성 코드의 정답 증명이 아니라, public API·데이터 모델·제어 흐름의 모순을 빠르게 좁히는 첫 번째 검증 게이트다."
  - "효과적인 도입은 strict mode 선언이 아니라 boundary schema, discriminated union, exhaustive check, contract test, runtime validation을 변경 위험도에 맞춰 연결하는 데 있다."
  - "팀 지표는 생성 코드량보다 typecheck 실패율, 신규 unsafe escape 수, public contract test 통과율, 리뷰 대기시간과 production regression을 함께 봐야 한다."
operator_checklist:
  - "외부 입력·DB JSON·환경변수·MCP/tool output은 TypeScript type assertion만 믿지 말고 runtime schema validation을 통과시킨다."
  - "public API 또는 event schema 변경 PR에는 typecheck, consumer/contract test, 변경된 type surface 요약을 필수 증거로 붙인다."
  - "AI 생성 PR 파일럿은 2주간 새 `any`, `@ts-ignore`, 무근거 type assertion을 0건 목표로 보고, 예외에는 reason·owner·만료일을 둔다."
  - "typecheck가 10분을 넘거나 flaky하면 에이전트 gate로 쓰기 전에 project reference, cache, package boundary를 정리한다."
learning_refs:
  - title: "TypeScript 지원 창과 SDK 업데이트 계약"
    href: "/posts/2026-08-12-typescript-compiler-support-window-sdk-upgrade-contract-trend/"
    description: "컴파일러와 SDK의 지원 기간을 dependency runway로 관리하는 글입니다."
  - title: "Agent Quality Flywheel과 Evals"
    href: "/posts/2026-07-07-agent-quality-flywheel-eval-runtime-trend/"
    description: "에이전트 변경을 task class별 평가와 회귀 세트로 관리하는 방법입니다."
  - title: "AI Code Review Governance"
    href: "/posts/2026-03-06-ai-code-review-governance-trend/"
    description: "AI 리뷰를 팀 표준·사람 승인·증거 기준과 함께 운영하는 관점입니다."
  - title: "Consumer-Driven Contract Testing"
    href: "/learning/deep-dive/deep-dive-consumer-driven-contract-testing/"
    description: "타입 선언만으로 잡을 수 없는 서비스 간 API 호환성을 검증하는 방법입니다."
decision_guide:
  title: "어디에 타입 게이트를 먼저 둘까"
  intro: "모든 파일을 한 번에 엄격하게 만들기보다, 변경 비용이 큰 경계와 반복되는 AI 작업부터 검증 가능하게 만듭니다."
  cases:
    - badge: "First gate"
      title: "외부 입력·public API·event schema가 바뀐다"
      fit: "HTTP handler, webhook, DB JSON, SDK surface, queue payload처럼 잘못된 형태가 다른 서비스로 전파되는 변경"
      watchouts: "compile-time type만 두면 실제 JSON과 환경변수는 검증되지 않는다."
      next_step: "runtime schema + inferred type + contract test를 한 PR에 묶는다."
    - badge: "Second gate"
      title: "내부 리팩터링이 넓고 에이전트가 여러 파일을 바꾼다"
      fit: "DTO 변환, service boundary 정리, enum 추가, 모듈 이동처럼 누락된 분기를 잡아야 하는 작업"
      watchouts: "`as`, non-null assertion, `any`가 늘면 typecheck 통과가 안전 신호가 아니다."
      next_step: "exhaustive check와 unsafe escape diff를 PR evidence로 남긴다."
    - badge: "Defer"
      title: "prototype이 짧고 변경 효과가 production 경계 밖에 있다"
      fit: "일회성 분석 script, disposable mock, 수명이 짧은 사내 실험"
      watchouts: "실험 코드가 서비스 경로로 승격되면 type debt도 함께 들어온다."
      next_step: "승격 전 schema·typecheck·테스트 기준을 다시 적용하고 예외를 제거한다."
faqs:
  - question: "TypeScript면 runtime validation을 생략해도 되나요?"
    answer: "안 됩니다. TypeScript 타입은 컴파일 뒤 사라지고 HTTP body, database JSON, 환경변수, 외부 tool output은 신뢰할 수 없는 런타임 값입니다. 경계에서 parse·validate한 뒤 내부 타입으로 바꿔야 합니다."
  - question: "AI 생성 코드에는 strict를 바로 켜야 하나요?"
    answer: "목표로는 좋지만 한 번에 켜면 기존 오류와 새 변경의 오류가 섞입니다. 우선 public boundary와 새 코드에서 unsafe escape 증가를 막고, package별 기준선과 migration 순서를 정하는 편이 실용적입니다."
  - question: "typecheck가 통과하면 사람 리뷰를 줄여도 되나요?"
    answer: "줄일 수 있는 것은 형식·누락 분기 검토 일부입니다. 권한, 금액, 성능, 제품 의도, 런타임 데이터는 별도 테스트와 사람이 봐야 합니다. 타입은 리뷰를 대체하는 판정기가 아니라 리뷰 범위를 좁히는 증거입니다."
---

AI 코딩 에이전트가 코드를 더 빠르게 만들수록 팀이 마주치는 질문은 “생성된 코드가 많은가”보다 “어디까지 기계적으로 믿고, 어디부터 사람이 판단할 것인가”가 됩니다. GitHub의 Octoverse 2025는 TypeScript가 2025년 8월 Python과 JavaScript를 넘어 GitHub에서 가장 많이 쓰인 언어가 됐다고 보고했습니다. GitHub는 이 상승을 에이전트 보조 개발을 production에서 더 신뢰성 있게 만들려는 typed language 선호의 신호로 해석했습니다.

그 해석을 인과관계로 과장할 필요는 없습니다. GitHub도 활동 지표가 관찰 신호일 뿐 AI가 직접 원인이라고 단정할 수 없다고 설명합니다. 다만 방향은 분명합니다. 2025년 GitHub의 월평균 merged PR은 4,320만 건으로 전년보다 23% 늘었고, public LLM SDK를 쓰는 저장소도 빠르게 늘었습니다. 코드 변경량이 늘면 모든 diff를 사람이 처음부터 끝까지 읽는 방식은 더 비싸집니다. 타입 계약은 여기서 “AI가 맞다”를 증명하는 마법이 아니라, **명백히 맞지 않는 변경을 빠르게 제거하고 사람이 봐야 할 위험을 드러내는 경계**가 됩니다.

이 글은 [TypeScript 지원 창과 SDK 업데이트 계약](/posts/2026-08-12-typescript-compiler-support-window-sdk-upgrade-contract-trend/)의 compiler lifecycle 이야기를 한 단계 확장합니다. [Agent Quality Flywheel과 Evals](/posts/2026-07-07-agent-quality-flywheel-eval-runtime-trend/), [AI Code Review Governance](/posts/2026-03-06-ai-code-review-governance-trend/), [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)과 연결해, 타입을 AI 생성 코드의 검토 가능한 증거로 쓰는 기준을 정리합니다.

참고한 공식 신호:

- GitHub Octoverse 2025, *A new developer joins GitHub every second as AI leads TypeScript to #1*: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- GitHub Octoverse 2025: https://octoverse.github.com/
- OpenAI, *Running Codex safely at OpenAI*: https://openai.com/index/running-codex-safely/
- TypeScript Handbook, Narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html

## 이 글에서 얻는 것

- TypeScript의 부상을 단순 언어 순위가 아니라 AI 보조 개발의 검증 표면 변화로 해석하는 방법을 얻습니다.
- compile-time type, runtime validation, consumer contract test가 각각 막는 실패를 구분합니다.
- AI가 넓게 바꾼 PR에서 public type surface와 unsafe escape를 리뷰 증거로 남기는 방법을 배웁니다.
- 새 `any`, type assertion, `@ts-ignore`를 무조건 금지하지 않고 위험도·만료일·검증 근거로 관리하는 기준을 만듭니다.
- 팀이 typecheck를 속도 저하가 아니라 리뷰 대기시간과 재작업을 줄이는 게이트로 운영할 수 있습니다.

## 핵심 개념/이슈

### 1) 타입은 정답 증명이 아니라 변경 탐색 공간을 줄이는 장치다

AI 에이전트는 이름이 비슷한 DTO를 연결하고, enum 분기를 추가하고, 여러 파일의 함수 시그니처를 동시에 바꾸는 일을 빠르게 합니다. 이런 작업에서 흔한 실패는 복잡한 알고리즘 오류보다 “호출부 하나를 빼먹었다”, “nullable을 처리하지 않았다”, “새 event variant를 소비자가 모른다” 같은 구조적 불일치입니다. 타입 검사는 이 불일치를 실행 전에 좁힙니다.

예를 들어 상태 이벤트를 문자열과 선택 필드의 묶음으로 두면 에이전트도 리뷰어도 가능한 조합을 추측해야 합니다. discriminated union은 가능한 상태를 코드에 드러냅니다.

```ts
type PaymentEvent =
  | { type: "approved"; paymentId: string; amountMinor: number }
  | { type: "declined"; reason: "limit" | "fraud" | "expired" }
  | { type: "reversed"; paymentId: string; reversalId: string };

function assertNever(value: never): never {
  throw new Error(`unhandled event: ${JSON.stringify(value)}`);
}

function toAuditMessage(event: PaymentEvent): string {
  switch (event.type) {
    case "approved": return `approved:${event.paymentId}`;
    case "declined": return `declined:${event.reason}`;
    case "reversed": return `reversed:${event.reversalId}`;
    default: return assertNever(event);
  }
}
```

새 `refunded` variant를 추가했는데 audit projection을 고치지 않으면 `assertNever`가 compile-time error를 만듭니다. 이것이 타입의 가치입니다. 코드가 제품 요구를 충족한다는 보장은 아니지만, **정의된 계약 안에서 누락된 경로**를 값싸게 드러냅니다. 에이전트가 PR 하나에서 15개 파일을 바꿔도 이 종류의 오류는 사람이 diff를 기억하며 찾을 필요가 줄어듭니다.

### 2) compile-time type과 runtime 입력은 신뢰 경계가 다르다

TypeScript의 타입은 build 결과에 남지 않습니다. 따라서 아래 데이터는 “타입이 맞다”고 선언해도 실제로는 무엇이든 들어올 수 있습니다.

- HTTP request body, query string, multipart metadata
- 외부 webhook, queue message, third-party SDK response
- database의 JSON/JSONB, cache에 남은 이전 schema
- 환경변수와 feature flag payload
- agent가 호출한 MCP/tool output, 파일 파싱 결과

나쁜 예는 `const body = req.body as CreateOrder;`처럼 외부 입력을 assertion 하나로 내부 모델로 바꾸는 것입니다. 이 코드는 검증이 아니라 컴파일러에게 질문을 그만하라고 말하는 행위입니다. 경계에서는 schema validator로 parse한 뒤, 내부에는 검증된 타입만 넘깁니다.

```ts
const CreateOrderSchema = z.object({
  customerId: z.string().uuid(),
  currency: z.enum(["KRW", "USD"]),
  items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() }))
}).strict();

const input = CreateOrderSchema.parse(req.body);
// 여기부터 input은 검증된 내부 계약이다.
```

schema 라이브러리의 선택보다 중요한 것은 흐름입니다. **untrusted value → parse/validate → typed domain value → effect**를 지키면 AI가 handler를 바꿨을 때도 입력 검증이 사라지는지 빠르게 확인할 수 있습니다. 외부 스키마와 내부 도메인 모델을 같은 타입으로 억지로 재사용하면 security와 evolution이 엉킵니다. API가 허용하는 optional field가 도메인에서 항상 유효하다는 뜻은 아닙니다.

### 3) 타입 표면은 AI PR의 작은 변경 요약이 된다

코드 줄 수가 늘어날수록 review comment 수나 “AI가 테스트를 돌렸다”는 문장만으로는 부족합니다. PR에서 변경된 exported type, API request/response schema, event variant, DB migration boundary를 추린 **type surface 요약**은 리뷰어가 먼저 볼 곳을 정해 줍니다.

예시 형식은 간단합니다.

```text
Type surface
- public: CreateOrderRequest에 `couponCode?: string` 추가
- event: PaymentEvent에 `reversed` variant 추가
- internal: OrderStatus를 discriminated union으로 변경
- unsafe escapes: 0 new `any`, 0 new `@ts-ignore`, 1 assertion (validated by CreateOrderSchema)

Evidence
- pnpm typecheck: pass (2m 18s)
- order-api contract test: pass
- payment event consumer test: pass
```

이 형식은 에이전트에 “멋진 요약을 써라”라고 요청하는 것보다 안정적입니다. CI가 git diff와 typecheck 결과에서 추출하도록 만들고, 사람이 이 표와 실제 diff가 일치하는지만 확인하게 하세요. OpenAI가 Codex 운영에서 sandbox, approval, network policy, agent-native telemetry를 함께 둔다고 설명한 것도 같은 맥락입니다. 에이전트의 최종 답변보다 **무엇을 했고 어떤 경계를 통과했는지**가 운영 판단의 근거가 됩니다.

### 4) `any`와 assertion은 금지 목록이 아니라 위험 비용이다

현실의 TypeScript에는 third-party declaration 결함, legacy JSON, generic abstraction, migration 중인 package가 있습니다. `any`, `unknown as T`, `!`, `@ts-ignore`를 완전히 없애겠다는 선언은 빠르게 우회 규칙을 만들 수 있습니다. 더 실용적인 기준은 새 escape가 생길 때 이유와 검증 경로를 남기는 것입니다.

| escape | 허용 가능한 좁은 조건 | PR에 필요한 증거 |
| --- | --- | --- |
| `unknown` | 외부 입력을 받는 시작점 | 바로 뒤의 schema parse 또는 type guard |
| `as T` | compiler가 표현하지 못하지만 런타임 검증이 끝난 값 | validator/guard 링크와 테스트 |
| `!` | framework lifecycle상 존재가 보장되고 local scope가 좁음 | null 불가능한 lifecycle 근거 |
| `any` | generated code 또는 임시 migration boundary | owner, 제거 issue, 최대 30일 TTL |
| `@ts-ignore` | upstream bug workaround | issue 링크, 영향 테스트, 최대 14일 TTL |

처음부터 전체 legacy repository의 `any`를 없애기보다, AI가 새로 만든 diff에서 **신규 unsafe escape = 0**을 2주 파일럿 기준으로 잡는 편이 좋습니다. existing baseline은 줄여 갈 backlog로 두고, 새 빚이 증가하지 않게 막습니다. 이 방식은 [Agent Quality Flywheel과 Evals](/posts/2026-07-07-agent-quality-flywheel-eval-runtime-trend/)의 “변경 전후를 같은 regression set으로 비교한다”는 원칙과 맞습니다.

### 5) contract test가 타입의 사각지대를 닫는다

같은 monorepo 안에서 producer와 consumer가 하나의 shared type을 import하면 typecheck는 통과하기 쉽습니다. 그러나 실제 배포 순서, JSON field의 nullability, older client, 다른 언어 consumer, gateway transform은 타입 import로 보장되지 않습니다. 그래서 public contract에는 runtime example과 consumer-driven test가 필요합니다.

다음 역할을 분리하면 좋습니다.

| 검증 층 | 빠르게 잡는 것 | 놓치는 것 |
| --- | --- | --- |
| typecheck | 함수 호출·nullable·variant·refactor 누락 | 실제 JSON, 배포 순서, business rule |
| schema validation | 외부 입력의 모양·범위·unknown field | producer와 consumer의 버전 조합 |
| contract test | request/response·event 호환성 | 내부 알고리즘·성능 |
| integration/E2E | auth·DB·network·실제 effect | 모든 조합의 exhaustive 증명 |
| human review | 제품 의도·권한·risk acceptance | 기계적으로 찾을 수 있는 누락 |

예를 들어 AI가 `amountMinor`를 optional로 바꾸면 shared type을 쓰는 consumer는 compile을 통과하도록 같이 수정될 수 있습니다. 하지만 이전 mobile client, Kafka consumer, analytics pipeline이 이 필드를 필수로 기대했다면 배포 후 문제가 납니다. [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)처럼 consumer expectation을 독립 artifact로 둬야 하는 이유입니다.

## 실무 적용

### 1) “경계 한 곳”에서 2주 파일럿을 시작한다

AI 코딩 도입과 TypeScript strictness를 한 번에 전사 migration으로 밀어 넣으면 실패 원인이 섞입니다. 가장 좋은 시작점은 request handler 하나, webhook consumer 하나, 또는 public SDK package 하나처럼 effect와 owner가 분명한 경계입니다.

첫 2주의 권장 gate는 다음 정도면 충분합니다.

| 항목 | 초기 기준 | 실패 시 행동 |
| --- | --- | --- |
| typecheck | main branch 기준 100% 통과 | merge 차단, failure class 분류 |
| 신규 `any`/`@ts-ignore` | 0건 | 예외 ticket+TTL 없으면 차단 |
| public schema 변경 | runtime validator 필수 | validator 또는 migration plan 없으면 review 대기 |
| contract test | 영향 consumer 1개 이상 통과 | consumer owner와 범위 재확인 |
| typecheck 시간 | p95 10분 이하 | cache/project reference를 먼저 개선 |
| AI PR 크기 | 기본 300 changed LOC 이하 | 더 크면 task·evidence를 분할 |

300 LOC와 10분은 보편 법칙이 아니라 시작값입니다. 현재 CI와 review capacity의 baseline이 다르면 달라져야 합니다. 중요한 것은 숫자가 아니라, 기준을 넘었을 때 “더 빠른 모델”이 아니라 task 분할·cache·package boundary·추가 evidence 중 무엇을 먼저 고칠지 정하는 것입니다.

### 2) typecheck를 CI의 첫 관문으로 만들되, 최종 관문으로 만들지 않는다

typecheck가 30분 걸리거나 가끔 실패하면 에이전트와 개발자는 우회하게 됩니다. 먼저 package별 project reference, lockfile 재현, incremental cache, 외부 SDK typecheck 범위를 점검해 p95를 10분 아래로 낮추세요. 빠르고 신뢰할 수 있는 typecheck라야 매 PR에 붙일 수 있습니다.

권장 순서는 다음과 같습니다.

1. 에이전트가 변경 전 좁은 package typecheck와 관련 테스트를 실행한다.
2. 코드 변경 뒤 동일 command를 다시 실행한다.
3. public type surface와 unsafe escape diff를 생성한다.
4. public boundary가 바뀌면 schema/contract test를 추가한다.
5. merge queue에서는 전체 typecheck와 integration test를 실행한다.
6. production 오류·rollback은 typecheck 성공률과 별도 지표로 되돌아본다.

이 순서에서 typecheck는 빠른 feedback, contract test는 경계 검증, integration test는 실제 조합 검증, 사람 리뷰는 의도와 위험 판단을 담당합니다. 한 층이 다른 층을 대체하지 않게 해야 합니다.

### 3) 에이전트 task와 repository 규칙을 연결한다

에이전트가 타입을 잘 활용하려면 모호한 “타입 안전하게 해줘”보다 repository가 요구하는 증거를 짧고 실행 가능하게 적어야 합니다. 예를 들어 `AGENTS.md` 또는 PR template에 아래처럼 씁니다.

```text
- API/event shape를 바꾸면 runtime schema와 consumer contract test를 함께 수정한다.
- 외부 JSON에 `as SomeType`을 쓰지 말고 parse 또는 type guard를 둔다.
- 새 `any`, `@ts-ignore`, non-null assertion은 이유·테스트·expires_at 없이는 추가하지 않는다.
- 최종 보고에는 changed type surface, typecheck command/result, 영향 테스트를 적는다.
```

규칙은 길수록 좋은 것이 아닙니다. 에이전트가 실행할 수 없는 “항상 완벽하게 타입 안전해야 한다”는 문장보다, 변경 class별 command와 금지·예외 조건이 좋습니다. [AI Code Review Governance](/posts/2026-03-06-ai-code-review-governance-trend/)에서 다룬 것처럼 AI 리뷰도 repository rule, 위험 분류, 사람 승인 지점이 있어야 일관됩니다.

### 4) 코드량 대신 재작업과 경계 품질을 측정한다

AI가 만든 commit 수와 PR 수는 활동량입니다. 품질을 말하려면 최소 아래 네 축을 분리하세요.

| 지표 | 좋은 변화 | 경고 신호 |
| --- | --- | --- |
| typecheck first-pass rate | 범위가 분명한 task에서 상승 | `any` 증가로만 통과율 상승 |
| unsafe escape 신규 수 | baseline 대비 감소 또는 0 유지 | assertion/ignore가 계속 쌓임 |
| public contract pass rate | 배포 전 안정적 통과 | schema 변경 뒤 consumer 실패 증가 |
| review lead time | 증거가 있는 작은 PR에서 감소 | PR은 빨라졌지만 revert·hotfix 증가 |
| production regression | 위험도 보정 후 감소 또는 유지 | 타입 통과인데 boundary bug가 증가 |

에이전트가 코드를 많이 썼는데 review queue가 길어졌다면 생산성 개선으로 결론 내리기 이릅니다. 마찬가지로 typecheck가 빨라졌는데 `as unknown as`가 늘었다면 품질이 좋아진 것이 아니라 신호를 약화시킨 것입니다. task class별로 before/after를 비교해야 합니다.

## 트레이드오프/주의점

1. **타입은 런타임 신뢰 경계를 검증하지 않습니다.** 외부 JSON, DB의 오래된 payload, feature flag, tool output에는 parse·validation이 필수입니다.
2. **과도하게 복잡한 generic은 리뷰 비용을 늘릴 수 있습니다.** 타입 체조가 도메인 규칙을 숨기고 typecheck를 느리게 만들면, 단순한 명시적 DTO와 validator가 더 낫습니다.
3. **shared type import는 배포 호환성을 보장하지 않습니다.** 다른 서비스·모바일 client·event consumer에는 versioned schema와 contract test가 필요합니다.
4. **strict mode 전환은 migration입니다.** 기존 nullability·implicit any·module 설정을 한 PR에 고치면 AI 변경의 품질을 측정할 수 없습니다. compiler upgrade, strictness 강화, business change를 분리하세요.
5. **type assertion을 전부 악으로 취급하지 마세요.** framework limitation이나 runtime validator 이후의 좁은 assertion은 합리적일 수 있습니다. 다만 근거·테스트·TTL 없는 assertion은 빚입니다.
6. **AI가 typecheck를 통과시켜도 의도 검토는 남습니다.** 할인 조건, 권한 상승, 결제 상태, 성능 예산, 개인정보 공개 범위는 타입이 아닌 제품·운영 판단입니다. 위험 작업에는 테스트 증거와 사람 승인을 유지해야 합니다.

## 체크리스트 또는 연습

### 적용 체크리스트

- [ ] 외부 입력은 `as Type`이 아니라 runtime schema parse 또는 type guard를 거친다.
- [ ] public API·event 변경에는 typecheck와 consumer/contract test가 모두 있다.
- [ ] AI PR 템플릿에 changed type surface와 unsafe escape diff가 있다.
- [ ] 신규 `any`, `@ts-ignore`, broad assertion에는 reason, owner, expires_at이 있다.
- [ ] 파일럿 범위의 typecheck p95가 10분 이하이며 flaky failure가 분류되어 있다.
- [ ] compile-time type, runtime validation, integration test, human review의 책임이 구분되어 있다.
- [ ] compiler upgrade와 strictness·module policy 변경은 별도 PR로 관리한다.
- [ ] typecheck 성공률뿐 아니라 contract pass rate, review lead time, production regression을 함께 본다.
- [ ] AI가 만드는 변경은 기본 300 changed LOC 이하로 쪼개고, 초과 시 task/evidence를 분리한다.
- [ ] `any`를 줄이는 것보다 public boundary에서 invalid value를 막는 일을 먼저 한다.

### 팀 연습

1. 현재 API handler 하나를 골라 request body assertion을 runtime schema parse로 바꾸고, invalid payload 5개가 명시적으로 거부되는 테스트를 추가해 보세요.
2. event union에 variant 하나를 추가한 뒤, exhaustive switch가 놓친 consumer를 typecheck가 잡는지 확인해 보세요.
3. AI가 만든 PR 10개를 표본으로 typecheck first-pass rate, 새 unsafe escape 수, public contract test 결과, review lead time을 기록해 보세요.
4. 가장 자주 바뀌는 public DTO 하나에 type surface 요약을 자동 생성하는 CI step을 설계하고, 리뷰어가 실제로 보는 데 2분 이상 절약되는지 측정해 보세요.

TypeScript가 AI 시대의 답 자체는 아닙니다. 하지만 빠르게 만들어지는 코드에서 계약을 좁히고, 누락된 분기를 드러내고, 검증 결과를 리뷰 증거로 남기는 데는 강력한 도구입니다. 좋은 팀은 “에이전트가 타입을 통과했다”에서 멈추지 않습니다. **어떤 경계가 검증됐고, 어떤 위험은 아직 사람이 판단해야 하는지**를 타입·schema·test·telemetry로 분명하게 만듭니다.
