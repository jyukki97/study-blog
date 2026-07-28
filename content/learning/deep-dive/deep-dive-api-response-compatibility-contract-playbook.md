---
title: "백엔드 커리큘럼 심화: API Response Compatibility Contract, 응답 스키마 변경을 사고 없이 배포하는 법"
date: 2026-07-28T10:06:00+09:00
lastmod: 2026-07-28T11:30:00+09:00
draft: false
topic: "Backend API Design"
tags: ["API Design", "Schema Evolution", "Backward Compatibility", "OpenAPI", "Contract Testing", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "API 응답 필드 추가·삭제·이름 변경·enum 확장·nullable 변경이 클라이언트 호환성과 성능에 어떤 영향을 주는지, 배포 전 어떤 숫자와 기준으로 판단해야 하는지 정리합니다."
module: "backend-data-system"
study_order: 1264
key_takeaways:
  - "응답 스키마 변경은 서버 내부 리팩터링이 아니라 클라이언트 배포 주기, 캐시, 문서, 관측성을 함께 건드리는 계약 변경이다."
  - "필드 추가도 항상 안전하지 않다. payload 크기, 추가 join, 모바일 파싱 시간, 캐시 value 증가까지 성능 호환성을 같이 봐야 한다."
  - "삭제·이름 변경·enum 의미 변경은 usage telemetry, deprecation window, consumer contract test, rollback 경로 없이는 merge하지 않는 것이 안전하다."
operator_checklist:
  - "응답 필드별 owner, stability, nullable, deprecation status, consumer usage를 문서화한다."
  - "public/mobile/partner API의 breaking change는 최소 30일 또는 2개 앱 릴리스 이상의 이행 기간을 둔다."
  - "스키마 diff, consumer contract test, production field usage, payload size budget을 배포 전 gate로 둔다."
learning_refs:
  - title: "API Versioning"
    href: "/learning/deep-dive/deep-dive-api-versioning/"
    description: "URL, header, media type 기반 버전 전략의 기본기입니다."
  - title: "Consumer Driven Contract Testing"
    href: "/learning/deep-dive/deep-dive-consumer-driven-contract-testing/"
    description: "실제 consumer가 의존하는 API 계약을 테스트로 고정하는 방법입니다."
  - title: "Response Payload Budget"
    href: "/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/"
    description: "응답 필드와 projection을 성능 예산으로 관리하는 기준입니다."
  - title: "API Deprecation/Sunset"
    href: "/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/"
    description: "기존 API를 끊지 않고 폐기 공지와 전환 기간을 운영하는 방법입니다."
decision_guide:
  title: "응답 스키마 변경을 언제 허용할까"
  intro: "변경 유형보다 중요한 것은 consumer 통제권, 배포 주기, payload 비용, rollback 가능성입니다."
  cases:
    - badge: "대체로 허용"
      title: "선택 필드 추가"
      fit: "기존 클라이언트가 unknown field를 무시하고, 새 필드 계산 비용이 낮으며, payload 증가가 예산 안에 있을 때 적합합니다."
      watchouts: "필드 하나가 추가 join, N+1, 모바일 파싱 지연, 캐시 value 증가를 만들 수 있습니다."
      next_step: "payload size와 p95 latency delta를 측정한 뒤 feature flag로 노출합니다."
    - badge: "계약 gate 필요"
      title: "필수 필드 추가, nullable 변경, enum 값 추가"
      fit: "클라이언트가 빠르게 배포되고 contract test가 있는 내부 API에서 제한적으로 가능합니다."
      watchouts: "엄격한 enum parser나 non-null 전제를 가진 앱은 추가 값만으로도 깨질 수 있습니다."
      next_step: "consumer별 parser 정책과 실패율을 먼저 확인합니다."
    - badge: "보수 관리"
      title: "필드 삭제, 이름 변경, 의미 변경"
      fit: "사용량이 거의 없고 deprecation window와 대체 필드가 운영된 뒤에만 가능합니다."
      watchouts: "서버 로그에 호출이 없어도 캐시, SDK, 배치, 파트너 수집기가 필드를 읽을 수 있습니다."
      next_step: "30일 이상 usage 0, consumer 승인, rollback plan을 gate로 둡니다."
---

API 응답은 서버가 마음대로 바꿀 수 있는 JSON 덩어리가 아닙니다. 모바일 앱, 웹 프론트엔드, 파트너 연동, 배치 수집기, 사내 어드민, 다른 microservice가 같은 응답을 각자의 속도로 읽습니다. 서버는 오늘 배포할 수 있어도 모바일 앱은 사용자 업데이트가 필요하고, 파트너는 한 달 뒤에야 반영할 수 있으며, 오래 떠 있는 배치 작업은 예전 SDK를 그대로 쓸 수 있습니다. 그래서 응답 스키마 변경은 코드 변경이 아니라 **클라이언트 생태계와 맺은 계약 변경**으로 봐야 합니다.

실무에서 사고는 대개 큰 버전 변경보다 작은 필드 변경에서 납니다. "필드 하나 추가는 하위 호환이니까 괜찮다"며 user profile 응답에 계산 필드를 붙였는데 DB join이 늘어 p95가 300ms에서 900ms로 튀거나, enum 값을 하나 추가했더니 오래된 앱의 strict parser가 예외를 내는 식입니다. 반대로 "안 쓰는 필드"라고 삭제했는데 파트너 정산 배치가 그 필드를 key로 쓰고 있던 경우도 흔합니다.

이 글은 [API Versioning](/learning/deep-dive/deep-dive-api-versioning/), [Consumer Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/), [Response Payload Budget](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/), [API Deprecation/Sunset](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)과 이어집니다. 목표는 "버전을 어떻게 붙일까"보다 한 단계 구체적입니다. **필드 단위 변경을 어떤 숫자와 조건으로 허용하고, 어떤 변경은 이행 기간 없이는 막을 것인가**를 정합니다.

## 이 글에서 얻는 것

- 응답 필드 추가·삭제·이름 변경·nullable 변경·enum 확장이 각각 어떤 호환성 위험을 만드는지 구분합니다.
- OpenAPI diff, consumer contract test, production usage telemetry, payload budget을 배포 전 gate로 묶는 방법을 배웁니다.
- public/mobile/partner/internal API별로 deprecation window와 승인 기준을 다르게 잡을 수 있습니다.
- "하위 호환"처럼 보이는 변경도 성능 호환성과 운영 관측성까지 확인하는 습관을 가져갑니다.

## 핵심 개념/이슈

### 1) 응답 스키마 호환성은 문법 호환성과 의미 호환성으로 나뉜다

JSON 문법만 보면 필드 추가는 보통 안전합니다. 오래된 클라이언트는 모르는 필드를 무시하면 됩니다. 하지만 실제 호환성은 더 넓습니다.

| 변경 유형 | 문법 호환성 | 의미 호환성 | 주의점 |
| --- | --- | --- | --- |
| optional 필드 추가 | 대체로 안전 | 조건부 안전 | 계산 비용과 payload 증가 확인 |
| required 필드 추가 | 클라이언트 입력에는 위험, 응답에는 조건부 | 조건부 | SDK model 생성 방식에 따라 깨질 수 있음 |
| 필드 삭제 | 위험 | 위험 | 미사용 증거와 deprecation 필요 |
| 필드 이름 변경 | 위험 | 위험 | 새 필드 추가 후 dual-read 기간 필요 |
| nullable -> non-null | 조건부 | 위험 가능 | null 처리하던 client 로직 영향 |
| non-null -> nullable | 문법상 가능 | 위험 | 기존 client가 null을 예상하지 못할 수 있음 |
| enum 값 추가 | 조건부 | 위험 가능 | strict switch/case에서 예외 가능 |
| 필드 의미 변경 | 문법상 안전 | 매우 위험 | 가장 탐지하기 어려운 breaking change |

가장 무서운 변경은 문법상 안전하지만 의미가 바뀌는 경우입니다. 예를 들어 `status: "READY"`가 예전에는 "다운로드 가능"이었는데 새 버전에서 "생성 완료, 보안 스캔 대기"라는 뜻으로 바뀌면 JSON schema는 그대로입니다. 하지만 클라이언트 행동은 깨집니다. 따라서 response compatibility contract에는 타입뿐 아니라 의미, 단위, 시간 기준, 정렬 기준, 상태 전이 규칙도 포함해야 합니다.

### 2) 필드 추가도 성능 호환성을 깨뜨릴 수 있다

응답 필드 추가는 가장 흔한 변경입니다. 하지만 새 필드가 어디서 오는지 확인하지 않으면 성능 사고가 됩니다.

예를 들어 `GET /orders/{id}`에 `latest_payment_attempt`를 추가한다고 합시다. 구현이 단순 조회라면 괜찮습니다. 그런데 payment table join, provider 상태 조회, JSON aggregation, 권한 필터, 캐시 miss가 붙으면 기존 API의 성격이 바뀝니다. 사용자는 "주문 상세"를 요청했을 뿐인데 서버는 결제 시도 전체를 뒤지고 있을 수 있습니다.

초기 예산 기준은 아래처럼 둘 수 있습니다.

| 항목 | 권장 gate |
| --- | --- |
| 응답 payload 증가 | 기존 p50 size 대비 20% 이하, public/mobile API는 10% 이하 |
| API p95 latency delta | 10% 또는 50ms 중 작은 값 이하 |
| DB query count | endpoint당 추가 쿼리 1개 이하, N+1 금지 |
| 캐시 value 증가 | 30% 초과 시 별도 cache key 또는 projection 검토 |
| 모바일 파싱 시간 | 저사양 기준 16ms frame budget 영향 여부 확인 |
| 새 필드 계산 실패 | 전체 응답 실패로 전파하지 않고 field unavailable 정책 검토 |

이 기준은 [Response Payload Budget](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)과 연결됩니다. 필드 하나가 비싸면 API 버전을 올리기보다 projection, expansion parameter, 별도 endpoint, 비동기 operation resource를 검토하는 편이 낫습니다.

### 3) enum 추가는 생각보다 자주 깨진다

서버 개발자는 enum 추가를 하위 호환으로 보는 경우가 많습니다. 기존 값은 그대로 있고 새 값만 생기기 때문입니다. 하지만 클라이언트가 아래처럼 작성되어 있으면 이야기가 달라집니다.

```kotlin
when (order.status) {
    "PENDING" -> showPending()
    "PAID" -> showPaid()
    "CANCELLED" -> showCancelled()
    else -> throw IllegalStateException("unknown status")
}
```

새로운 `REFUND_PENDING`이 내려오면 앱이 크래시할 수 있습니다. TypeScript, Kotlin, Swift, Java SDK가 OpenAPI enum을 sealed type처럼 생성하는 경우도 있습니다. 이때 새 enum 값은 응답 스키마에서 "추가"지만 실제 런타임에서는 breaking change입니다.

권장 기준:

- public API enum에는 `UNKNOWN` 또는 fallback 처리 가이드를 문서화한다.
- 새 enum 값은 최소 1개 릴리스 전에 문서와 SDK에 먼저 노출한다.
- 모바일 앱은 새 enum을 서버에서 바로 내려주기 전에 minimum supported version을 확인한다.
- 상태 전이 enum은 [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/)처럼 허용 전이를 함께 문서화한다.
- 새 enum이 사용자 행동을 바꾸면 단순 스키마 변경이 아니라 product behavior 변경으로 리뷰한다.

### 4) 필드 삭제는 "로그에 안 보인다"만으로 결정하면 안 된다

서버 access log만 보고 필드 사용 여부를 알기는 어렵습니다. HTTP 요청에는 클라이언트가 어떤 응답 필드를 읽었는지가 보통 남지 않습니다. GraphQL처럼 selection set이 있거나 field-level telemetry를 심은 경우가 아니라면 서버는 응답을 보냈다는 사실만 알 뿐, client가 어느 필드를 사용했는지 모릅니다.

삭제 판단에는 여러 증거가 필요합니다.

- SDK와 주요 client repo 검색
- OpenAPI generated model usage 검색
- partner integration 문서 확인
- response field-level logging 또는 structured client telemetry
- deprecated field를 제거한 canary 응답에서 client error 증가 여부
- 고객 지원 ticket, export/report 스크립트, BI 수집기 확인

필드 삭제 gate는 보수적으로 잡는 편이 좋습니다.

| API 유형 | 삭제 전 최소 조건 |
| --- | --- |
| 내부 실험 API | owner 승인, contract test 통과, 7일 usage 확인 |
| 사내 서비스 API | consumer owner 승인, 14일 deprecation 공지 |
| 모바일 API | 최소 2개 앱 릴리스 또는 30~60일 window |
| 파트너/public API | 90일 이상 window, migration guide, sunset header |
| 결제/정산/인증 API | explicit consumer sign-off, rollback plan 필수 |

이 기준은 [API Deprecation/Sunset](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)의 핵심과 같습니다. 삭제는 코드 정리가 아니라 운영 전환입니다.

### 5) OpenAPI는 source of truth가 될 수 있지만 production truth는 아니다

OpenAPI 문서가 최신이면 큰 도움이 됩니다. schema diff로 breaking change를 탐지하고, SDK를 생성하고, mock server와 contract test를 붙일 수 있습니다. 하지만 OpenAPI가 항상 production truth를 보장하지는 않습니다.

실무에서 흔한 차이:

- 문서에는 optional인데 실제 응답에서는 항상 내려온다.
- 문서에는 string인데 일부 데이터에서 number-like string을 내려준다.
- enum 문서는 업데이트됐지만 구버전 서버가 섞여 있다.
- nullable 문서와 실제 null 빈도가 다르다.
- feature flag에 따라 필드가 조건부로 내려온다.
- 에러 응답 schema가 성공 응답보다 덜 관리된다.

따라서 스키마 관리는 세 층으로 봐야 합니다.

```yaml
response_contract_sources:
  design_contract:
    source: "OpenAPI"
    role: "의도한 공개 계약"
  consumer_contract:
    source: "Pact 또는 consumer test"
    role: "실제 consumer가 의존하는 행동"
  production_observation:
    source: "field telemetry, sampled response validation"
    role: "운영 데이터에서 실제로 나가는 값"
```

OpenAPI diff만 통과했다고 끝내면 부족합니다. consumer contract test와 production sampled response validation을 같이 둬야 합니다. [Consumer Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)은 이 간극을 줄이는 실전 도구입니다.

## 실무 적용

### 1) 필드 단위 response catalog를 만든다

모든 API를 한 번에 정리하려 하지 말고, 변경 비용이 큰 API부터 시작합니다. 결제, 주문, 인증, 파일 다운로드, 파트너 정산, 모바일 홈 화면 API가 우선입니다.

```yaml
response_field_catalog:
  endpoint: "GET /v1/orders/{orderId}"
  field: "status"
  type: "enum"
  stability: "stable"
  nullable: false
  owner: "commerce-platform"
  consumers:
    - "ios-app"
    - "android-app"
    - "partner-settlement-batch"
  enum_values:
    - "PENDING"
    - "PAID"
    - "CANCELLED"
  deprecation_status: "active"
  compatibility_notes:
    - "새 enum 값은 앱 minimum version 확인 후 노출"
```

catalog의 목적은 문서 장식이 아닙니다. PR에서 응답 변경이 들어올 때 "이 필드는 stable인가", "누가 읽고 있나", "삭제하려면 어떤 window가 필요한가"를 바로 판단하기 위한 운영 테이블입니다.

### 2) PR에 response schema diff gate를 붙인다

응답 DTO, OpenAPI spec, serialization 설정이 바뀌면 diff를 생성합니다.

```yaml
api_schema_change_gate:
  detect:
    - "openapi diff"
    - "dto public field diff"
    - "enum value diff"
    - "nullable annotation diff"
  block_if:
    - "field_removed_without_deprecation"
    - "enum_removed_or_renamed"
    - "required_field_added_to_public_contract"
    - "nullable_changed_without_consumer_test"
  warn_if:
    - "optional_field_added"
    - "enum_value_added"
    - "payload_size_budget_unknown"
```

block과 warn을 나누는 것이 중요합니다. 모든 변경을 막으면 팀은 gate를 우회합니다. optional 필드 추가는 경고와 성능 예산 확인으로 충분할 수 있습니다. 반면 필드 삭제와 이름 변경은 deprecation 증거가 없으면 막아야 합니다.

### 3) PR 설명에는 변경 유형과 증거를 같이 남긴다

호환성 사고는 코드 diff만 봐서는 잘 보이지 않습니다. DTO에 필드 하나가 추가됐는지보다 그 필드가 어떤 consumer에게 어떤 비용을 만드는지가 중요합니다. 그래서 response contract가 바뀌는 PR에는 아래처럼 짧은 변경 기록을 붙이는 편이 좋습니다.

```markdown
## Response Contract Change

- Endpoint: `GET /v1/orders/{orderId}`
- Change type: optional field added
- Field: `latest_payment_attempt`
- Consumers checked: web-order-detail, ios-app, partner-settlement-batch
- Compatibility verdict: non-breaking with performance gate
- Payload delta: p50 +3.8%, p95 +4.6%
- Latency delta: p95 +18ms, p99 +31ms
- Query delta: +0 on cache hit, +1 on cache miss
- Rollout: feature flag `orders.latest_payment_attempt_response`
- Rollback: disable flag, keep field absent
- Follow-up: add field-level usage telemetry for 14 days
```

반대로 필드 삭제나 이름 변경이라면 기록이 더 길어져야 합니다.

```markdown
## Response Contract Change

- Endpoint: `GET /v1/users/{userId}`
- Change type: field rename with dual-field window
- Old field: `created_at`
- New field: `createdAt`
- Deprecated date: 2026-07-28
- Sunset target: 2026-09-30
- Known consumers: web-profile, android-app, crm-export
- Migration evidence: web-profile merged, android min version pending, crm-export owner approved
- Block removal until: 30-day old-field usage is 0 and android min version reaches 9.4.0
- Rollback: continue emitting both fields
```

이 템플릿의 목적은 문서 양식을 늘리는 것이 아닙니다. 리뷰어가 "이 변경이 깨지는가"를 한눈에 판단하게 만드는 것입니다. 특히 payload delta, latency delta, consumer checked, rollback이 빠져 있으면 optional 필드 추가도 안전하다고 보기 어렵습니다.

운영팀이 보는 release note도 같은 언어를 써야 합니다.

| 릴리스 노트 항목 | 이유 |
| --- | --- |
| endpoint와 field | 장애가 났을 때 영향 범위를 바로 좁힌다 |
| change type | 추가, 삭제, 이름 변경, 의미 변경을 혼동하지 않는다 |
| consumer impact | 모바일, 파트너, 배치처럼 느린 consumer를 놓치지 않는다 |
| observability | 어떤 metric으로 성공/실패를 볼지 정한다 |
| rollback | 새 필드 미노출, dual-field 유지, route-back 중 어떤 방식인지 고정한다 |

작은 팀이라면 처음부터 자동화가 없어도 됩니다. PR 템플릿 한 블록으로 시작하고, 반복되는 항목만 나중에 OpenAPI diff bot이나 CI gate로 옮기면 됩니다.

### 4) consumer별 호환성 등급을 둔다

모든 client를 같은 수준으로 관리하면 현실성이 떨어집니다. consumer 통제권에 따라 기준을 다르게 둡니다.

| Consumer | 통제권 | 변경 기준 |
| --- | --- | --- |
| 같은 repo 내부 client | 높음 | 같은 PR에서 수정 가능 |
| 사내 microservice | 중간 | owner 승인과 contract test |
| 웹 프론트엔드 | 중간 | 배포 순서와 rollback 확인 |
| 모바일 앱 | 낮음 | minimum version과 앱 릴리스 window |
| 파트너 API | 매우 낮음 | 사전 공지, migration guide, sandbox |
| BI/export 수집기 | 낮음 | field usage 확인과 샘플 데이터 검증 |

이 분류가 있으면 의사결정이 빨라집니다. 내부 API에서 7일 window면 충분한 변경도 public API에서는 90일이 필요할 수 있습니다.

### 5) dual-field 전략으로 이름 변경을 처리한다

필드 이름 변경은 삭제와 추가를 동시에 하는 변경입니다. 바로 바꾸지 말고 dual-field 기간을 둡니다.

```json
{
  "created_at": "2026-07-28T10:06:00+09:00",
  "createdAt": "2026-07-28T10:06:00+09:00"
}
```

운영 순서:

1. 새 필드를 추가하고 기존 필드를 유지한다.
2. 문서와 SDK에는 새 필드를 권장으로 표시한다.
3. 기존 필드에 `deprecated: true`와 sunset date를 붙인다.
4. field usage telemetry 또는 consumer sign-off를 수집한다.
5. window가 끝난 뒤 기존 필드를 제거한다.

dual-field는 payload를 잠시 늘립니다. 그래서 response size budget이 필요합니다. 이름 변경이 많으면 새 API version이 더 낫습니다. 작은 이름 정리 때문에 여러 달 동안 응답이 지저분해지는 비용도 계산해야 합니다.

### 6) production sampled validation을 돌린다

테스트 환경에서는 놓치는 데이터가 많습니다. 운영 데이터에서 실제 응답 샘플을 schema에 검증하는 방식이 도움이 됩니다.

권장 기준:

- 핵심 endpoint는 0.1~1% 샘플링으로 response schema validation
- validation 실패는 사용자 응답 실패로 만들지 말고 별도 metric으로 기록
- 필드별 null 빈도, enum unknown 빈도, payload size p95/p99를 수집
- 새 필드 rollout은 1%, 10%, 50%, 100% 단계로 관측
- p95 latency 10% 이상 악화 또는 schema violation 0.1% 초과 시 rollout 중단

이 방식은 [Shadow Traffic/Dark Launch](/learning/deep-dive/deep-dive-shadow-traffic-dark-launch-playbook/)와도 잘 맞습니다. 실제 트래픽 분포에서 새 응답 모양이 안전한지 먼저 볼 수 있습니다.

## 트레이드오프/주의점

첫째, 호환성 gate는 개발 속도를 늦출 수 있습니다. 특히 내부 API가 빠르게 변하는 초기 제품에서는 과한 gate가 부담입니다. 그래서 public/mobile/partner/critical API부터 강하게 적용하고, 내부 실험 API는 경량 diff와 owner 승인 정도로 시작하는 편이 좋습니다.

둘째, 스키마 호환성과 성능 호환성은 다릅니다. optional 필드 추가는 schema 관점에서 안전해도 latency, DB 부하, cache hit rate를 망칠 수 있습니다. API 변경 리뷰에는 schema diff와 함께 p95 latency, query count, payload size delta가 있어야 합니다.

셋째, consumer contract test는 모든 consumer 행동을 잡지 못합니다. 테스트에 없는 필드 의존, BI 수집기, 파트너의 임시 스크립트는 여전히 빠질 수 있습니다. 그래서 contract test와 usage telemetry, deprecation 공지를 같이 써야 합니다.

넷째, field-level telemetry는 개인정보와 비용 이슈를 만듭니다. "누가 어떤 필드를 읽었는가"를 과하게 수집하면 민감할 수 있습니다. 원문 값보다 field name, client id, version, presence 여부 중심으로 최소 수집하는 편이 안전합니다.

다섯째, 버전 추가는 만능 해결책이 아닙니다. `/v2`를 열면 기존 `/v1`도 운영해야 합니다. 문서, SDK, 모니터링, 알림, 보안 패치가 두 배가 됩니다. 작은 변경은 dual-field와 deprecation으로 처리하고, 의미가 크게 바뀌거나 consumer 행동이 달라질 때만 새 버전을 검토합니다.

의사결정 우선순위는 **데이터/금전/권한 영향 > consumer 통제권 > 배포 주기 > 성능 예산 > 코드 정리 욕구**입니다. 오래된 필드를 지우고 싶은 마음보다, 그 필드를 읽는 쪽의 실패 비용이 먼저입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] public/mobile/partner API의 응답 필드 catalog가 있다.
- [ ] OpenAPI diff에서 필드 삭제, required 추가, enum 삭제, nullable 변경을 탐지한다.
- [ ] optional 필드 추가에도 payload size와 p95 latency delta를 본다.
- [ ] enum 값 추가 전 strict parser를 가진 consumer가 있는지 확인한다.
- [ ] 필드 삭제 전 deprecation window, usage 증거, consumer 승인, rollback plan이 있다.
- [ ] 이름 변경은 dual-field 기간과 sunset date를 가진다.
- [ ] production sampled response validation으로 실제 null/enum/payload 분포를 본다.
- [ ] schema 변경은 [Consumer Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)과 연결돼 있다.

### 연습

1. 현재 운영 중인 API 하나를 고르고, 응답 필드 10개에 대해 `stable`, `experimental`, `deprecated` 중 하나를 붙여보세요.
2. 최근 30일 동안 추가된 응답 필드가 payload size와 latency에 어떤 영향을 줬는지 p50/p95로 비교해보세요.
3. enum 필드 하나를 골라 새 값이 추가됐을 때 각 client가 어떻게 동작하는지 테스트를 작성해보세요.
4. 삭제하고 싶은 필드 하나를 정하고, 30일 deprecation plan과 consumer 공지 문구를 만들어보세요.

## 다음에 같이 보면 좋은 글

- [API Versioning](/learning/deep-dive/deep-dive-api-versioning/)
- [Consumer Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)
- [Response Payload Budget과 Field Projection](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)
- [API Deprecation/Sunset 운영 플레이북](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)
- [API Error Semantics](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)
