---
title: "백엔드 커리큘럼 심화: API Error Semantics, 재시도 가능한 실패와 사용자 메시지를 분리하는 법"
date: 2026-07-15
draft: false
topic: "Backend Reliability"
tags: ["API Design", "Error Handling", "Retry", "Idempotency", "SLO", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "HTTP 상태 코드, 비즈니스 error code, retryable 여부, 사용자 메시지, 관측 필드를 분리해 API 실패를 운영 가능한 계약으로 만드는 기준을 정리합니다."
module: "backend-resilience"
study_order: 1256
key_takeaways:
  - "API 에러 응답은 예외를 보기 좋게 포장하는 형식이 아니라 클라이언트, 운영자, 재시도 시스템이 함께 읽는 실패 계약이다."
  - "HTTP status, error code, retryable, user action, correlation id, safe message를 분리해야 자동 재시도와 사용자 안내가 충돌하지 않는다."
  - "5xx를 줄이는 것만큼 4xx taxonomy, 중복 요청 처리, Retry-After, error budget burn 관측이 중요하다."
operator_checklist:
  - "모든 공개 API 에러에 stable error code, correlation id, retryable, user_action 또는 support_action을 포함한다."
  - "재시도 가능한 실패는 429/503/504와 Retry-After 또는 backoff hint로 표현하고, 비멱등 요청은 idempotency key 없이는 자동 재시도하지 않는다."
  - "에러율 대시보드는 HTTP status만 보지 말고 error code, endpoint, client version, retryable 여부, owner를 함께 본다."
learning_refs:
  - title: "Spring Exception Handling"
    href: "/learning/deep-dive/deep-dive-spring-exception-handling/"
    description: "Spring Boot에서 예외 계층과 Problem Details 응답을 구현하는 기본기입니다."
  - title: "Timeout Retry Backoff"
    href: "/learning/deep-dive/deep-dive-timeout-retry-backoff/"
    description: "재시도와 timeout을 실패 계약과 함께 설계하는 기준입니다."
  - title: "Idempotency"
    href: "/learning/deep-dive/deep-dive-idempotency/"
    description: "중복 요청과 안전한 재시도를 다루기 위한 멱등성 설계입니다."
  - title: "SLO/SLI/Error Budget"
    href: "/learning/deep-dive/deep-dive-slo-sli-error-budget/"
    description: "실패율을 운영 판단으로 연결하는 관측 기준입니다."
decision_guide:
  cases:
    - badge: "계약화 우선"
      title: "외부 클라이언트·모바일 앱·파트너 API"
      fit: "클라이언트 배포 주기가 서버보다 느리고 에러 처리 UX가 제품 경험에 직접 영향을 주는 API"
      watchouts: "문자열 메시지를 기준으로 분기하면 다국어, 문구 수정, 보안 마스킹 때 클라이언트가 깨진다."
      next_step: "stable error code와 user_action enum을 먼저 고정한다."
    - badge: "재시도 정책 우선"
      title: "결제·주문·외부 연동·비동기 작업 생성 API"
      fit: "일시 장애가 많고 중복 실행 비용이 큰 write path"
      watchouts: "retryable=true만 붙이고 idempotency key를 요구하지 않으면 장애 때 중복 주문·중복 결제가 생긴다."
      next_step: "Idempotency-Key, Retry-After, operation status 조회를 함께 설계한다."
faqs:
  - question: "HTTP status code만 잘 쓰면 충분한가요?"
    answer: "아닙니다. 409 하나만으로 재고 부족, 중복 주문, 버전 충돌, 정책 위반을 구분할 수 없습니다. HTTP status는 큰 분류이고, 클라이언트 행동은 안정적인 error code와 action hint로 결정해야 합니다."
  - question: "에러 메시지를 사용자에게 그대로 보여줘도 되나요?"
    answer: "대부분 위험합니다. 내부 원인, 테이블명, 권한 구조, 외부 provider 응답이 노출될 수 있습니다. 개발자 진단 메시지와 사용자 표시 메시지는 분리해야 합니다."
---

좋은 API는 성공 응답만 깔끔한 API가 아닙니다. 실제 서비스에서는 실패 응답이 더 자주 제품 경험을 결정합니다. 로그인 토큰이 만료됐을 때 다시 로그인시킬지, 결제 요청이 timeout 됐을 때 자동 재시도할지, 재고 부족을 사용자에게 어떻게 안내할지, 파트너 API가 rate limit에 걸렸을 때 몇 초 뒤 다시 호출할지 모두 에러 응답에 달려 있습니다. 그런데 많은 팀은 에러를 `status`, `message`, `timestamp` 정도로만 내려주고, 나머지 의미는 클라이언트나 운영자가 추측하게 둡니다.

이 방식은 작은 서비스에서는 버틸 수 있습니다. 하지만 모바일 앱, 웹, 배치, 파트너, 백오피스, 다른 microservice가 같은 API를 호출하기 시작하면 문제가 터집니다. 어떤 클라이언트는 500이면 무조건 재시도하고, 어떤 클라이언트는 409를 사용자 오류로 보여주며, 운영자는 대시보드에서 4xx와 5xx만 보고 원인을 찾습니다. 실패의 의미가 계약으로 정리되어 있지 않기 때문입니다.

이 글은 [Spring Exception Handling](/learning/deep-dive/deep-dive-spring-exception-handling/), [Timeout Retry Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/), [Idempotency](/learning/deep-dive/deep-dive-idempotency/), [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과 이어집니다. 구현 관점의 예외 핸들링에서 한 단계 더 나아가, API 실패를 **클라이언트 행동, 자동 재시도, 운영 관측, 고객 안내가 함께 읽는 계약**으로 만드는 방법을 다룹니다.

## 이 글에서 얻는 것

- HTTP status, 비즈니스 error code, retryable 여부, 사용자 메시지를 분리하는 기준을 이해합니다.
- 자동 재시도 가능한 실패와 사용자 조치가 필요한 실패를 숫자와 조건으로 나눌 수 있습니다.
- Problem Details 형식, correlation id, support action, client action을 어떤 필드로 표현할지 정리합니다.
- 에러율 대시보드를 status code가 아니라 error taxonomy와 error budget burn 중심으로 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) HTTP status는 큰 분류이고, 제품 행동은 error code가 결정한다

HTTP status code는 중요합니다. 400번대는 요청이나 권한 문제, 500번대는 서버나 의존성 문제라는 큰 신호를 줍니다. 하지만 제품이 필요한 결정에는 너무 거칩니다. `409 Conflict` 하나만 봐도 의미가 여러 개입니다.

| 상황 | HTTP status | 안정적인 error code | 클라이언트 행동 |
| --- | --- | --- | --- |
| 주문 중복 요청 | 409 | `ORDER_ALREADY_SUBMITTED` | 기존 주문 상태 조회 |
| 재고 부족 | 409 | `STOCK_NOT_ENOUGH` | 사용자에게 수량 변경 안내 |
| 낙관적 락 충돌 | 409 | `VERSION_CONFLICT` | 최신 데이터 재조회 후 재시도 유도 |
| 멱등 키 payload 불일치 | 409 | `IDEMPOTENCY_PAYLOAD_MISMATCH` | 자동 재시도 금지, 개발자 오류로 기록 |

상태 코드만 보고 분기하면 클라이언트는 결국 `message` 문자열을 파싱합니다. 이 순간 계약은 깨집니다. 문구를 바꾸거나 다국어 처리를 하거나 보안상 세부 메시지를 숨기는 순간 앱 동작이 달라질 수 있습니다. 그래서 공개 API에서는 error code를 안정적인 enum처럼 관리해야 합니다.

권장 기준은 간단합니다.

- HTTP status는 표준 의미에 맞춘다.
- error code는 도메인 의미를 표현한다.
- error code는 문구보다 오래 유지한다.
- 삭제·변경은 [API Deprecation/Sunset](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)처럼 마이그레이션 기간을 둔다.
- 클라이언트 분기는 `message`가 아니라 `code`와 `action`을 기준으로 한다.

### 2) retryable은 서버가 명시해야 한다

실패가 발생했을 때 가장 위험한 질문은 "다시 해도 되는가"입니다. 읽기 API라면 대부분 재시도가 안전합니다. 하지만 쓰기 API에서는 다릅니다. 결제, 주문 생성, 쿠폰 사용, 포인트 적립, 알림 발송은 중복 실행이 곧 데이터 사고가 될 수 있습니다. 클라이언트가 timeout만 보고 재시도하면 서버에서는 첫 요청이 성공했는데 응답만 유실된 상태일 수 있습니다.

따라서 에러 계약에는 재시도 가능 여부가 들어가야 합니다.

```json
{
  "type": "https://api.example.com/problems/dependency-timeout",
  "title": "Temporary dependency timeout",
  "status": 503,
  "code": "PAYMENT_PROVIDER_TIMEOUT",
  "retryable": true,
  "retry_after_seconds": 30,
  "idempotency_required": true,
  "user_action": "WAIT_AND_RETRY",
  "correlation_id": "req_01JZQ8Z9..."
}
```

초기 기준은 아래처럼 둘 수 있습니다.

| 실패 유형 | retryable | 자동 재시도 조건 |
| --- | --- | --- |
| 429 rate limit | true | `Retry-After` 이후, jitter 포함 |
| 503 의존성 일시 장애 | true | 멱등 요청 또는 idempotency key 존재 |
| 504 gateway timeout | 조건부 | 서버 처리 상태 조회 API가 있을 때 |
| 400 validation error | false | 사용자 입력 수정 필요 |
| 401/403 auth/permission | false | 토큰 갱신 또는 권한 요청 필요 |
| 409 version conflict | 조건부 | 최신 데이터 재조회 후 사용자 확인 |

여기서 핵심은 `retryable=true`가 "지금 당장 무한 재시도"가 아니라는 점입니다. 재시도 간격, 최대 횟수, idempotency key, operation status 조회가 함께 있어야 합니다. 자세한 재시도 제어는 [Timeout Retry Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 [Idempotency](/learning/deep-dive/deep-dive-idempotency/)를 같이 봐야 합니다.

### 3) 사용자 메시지와 개발자 진단 메시지는 분리한다

에러 응답에서 `message` 하나로 모든 사람을 만족시키려 하면 실패합니다. 사용자는 "다시 시도해주세요"를 원하고, 개발자는 "어느 provider가 어떤 timeout을 냈는지"를 원하며, 운영자는 "어떤 요청과 trace를 봐야 하는지"를 원합니다. 이 정보를 한 필드에 섞으면 보안 노출과 UX 문제가 동시에 생깁니다.

권장 구조는 역할별 필드를 분리하는 것입니다.

```json
{
  "code": "PAYMENT_PROVIDER_TIMEOUT",
  "user_message": "결제 확인이 지연되고 있습니다. 잠시 후 주문 내역을 확인해주세요.",
  "developer_message": "payment provider did not respond within 2s deadline",
  "user_action": "CHECK_ORDER_STATUS",
  "support_action": "SEARCH_BY_CORRELATION_ID",
  "correlation_id": "req_01JZQ8Z9...",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

외부 공개 API에서는 `developer_message`도 조심해야 합니다. 테이블명, 내부 서비스명, SQL, secret 이름, provider 원문 응답을 그대로 노출하면 공격자에게 단서가 됩니다. 운영 상세는 로그와 trace에 남기고, 응답에는 식별 가능한 correlation id를 주는 편이 안전합니다.

### 4) Problem Details는 형식이고, taxonomy는 운영 설계다

RFC 9457 Problem Details는 API 에러 응답 형식을 표준화하는 좋은 출발점입니다. `type`, `title`, `status`, `detail`, `instance` 같은 필드를 제공하므로 클라이언트와 문서화가 쉬워집니다. 하지만 Problem Details를 쓴다고 자동으로 좋은 에러 계약이 되는 것은 아닙니다. `detail`에 내부 예외 메시지를 넣고 끝내면 여전히 의미가 부족합니다.

실무에서는 Problem Details 위에 조직의 taxonomy를 얹어야 합니다.

| 필드 | 목적 | 안정성 |
| --- | --- | --- |
| `type` | 문서 URL 또는 문제 유형 URI | 장기 유지 |
| `status` | HTTP status | 표준 유지 |
| `code` | 도메인 error code | 장기 유지 |
| `retryable` | 자동 재시도 가능 여부 | 정책 유지 |
| `user_action` | 클라이언트 UX 분기 | enum 유지 |
| `correlation_id` | 지원·운영 추적 | 요청마다 변경 |
| `metadata` | 제한된 추가 정보 | allowlist 필요 |

`metadata`는 특히 주의해야 합니다. 편하다고 아무 값이나 넣으면 응답 스키마가 사실상 무제한이 됩니다. 클라이언트가 의존할 수 있는 필드와 디버깅용 임시 필드를 구분하고, 민감 정보는 절대 넣지 않아야 합니다.

### 5) 에러율 관측은 status code보다 code와 owner가 중요하다

운영 대시보드에서 `5xx rate`만 보면 원인이 늦게 보입니다. 같은 500이어도 DB timeout, downstream 502, serialization bug, thread pool exhaustion은 대응 owner가 다릅니다. 4xx도 마찬가지입니다. validation error가 늘어난 것인지, 권한 정책 변경으로 403이 늘어난 것인지, 특정 앱 버전에서만 400이 늘어난 것인지 분리해야 합니다.

최소 지표는 아래 정도입니다.

- `api_error_total{endpoint,status,code,retryable,client_type,client_version}`
- `api_error_budget_burn{service,slo_window}`
- `retry_attempt_total{endpoint,code,result}`
- `retry_after_seconds_bucket{endpoint,code}`
- `client_abort_total{endpoint}`
- `support_ticket_total{code}`

초기 경보 기준 예시는 다음과 같습니다.

| 조건 | 조치 |
| --- | --- |
| 핵심 write API 5xx > 0.5% 5분 지속 | SEV2 후보, rollback 또는 dependency failover 검토 |
| retryable 에러가 전체 요청의 2% 초과 10분 지속 | retry storm 방지, backoff 상향 |
| 동일 error code support ticket 20건 초과 | 사용자 메시지·복구 UX 점검 |
| 특정 client version 4xx가 3배 증가 | 앱 호환성 회귀 또는 API 계약 변경 조사 |
| error budget burn rate 2배 초과 | 배포 freeze 또는 트래픽 완화 검토 |

[SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)의 핵심은 숫자를 보는 데서 끝나지 않습니다. 숫자가 어떤 행동으로 이어지는지가 중요합니다. 에러 taxonomy가 없으면 burn이 발생해도 owner routing이 느려집니다.

## 실무 적용

### 1) 에러 카탈로그를 먼저 만든다

모든 예외 클래스를 곧바로 정리하려 하지 말고, 외부에 노출되는 API error code부터 카탈로그로 만듭니다.

```yaml
error_catalog:
  PAYMENT_PROVIDER_TIMEOUT:
    http_status: 503
    retryable: true
    idempotency_required: true
    user_action: CHECK_ORDER_STATUS
    owner: payment-platform
    alert_priority: P2
  STOCK_NOT_ENOUGH:
    http_status: 409
    retryable: false
    user_action: CHANGE_QUANTITY
    owner: commerce-domain
    alert_priority: none
  TOKEN_EXPIRED:
    http_status: 401
    retryable: false
    user_action: REFRESH_TOKEN
    owner: identity-platform
    alert_priority: none
```

카탈로그에는 적어도 HTTP status, retryable, 사용자 행동, owner, 알림 우선순위가 있어야 합니다. 문서화만 해도 PR 리뷰가 달라집니다. 새 에러를 추가할 때 "그냥 400으로 내려주세요"가 아니라 "이 code는 누가 소유하고, 클라이언트는 무엇을 해야 하며, 운영 알림은 필요한가"를 묻게 됩니다.

### 2) 재시도 가능 실패는 idempotency와 묶는다

write API에서 자동 재시도를 허용하려면 멱등성 설계가 먼저입니다. 실무 기준은 보수적으로 잡는 편이 낫습니다.

- `POST /orders`, `POST /payments`는 `Idempotency-Key` 없으면 client automatic retry 금지
- idempotency record TTL은 최대 재시도 윈도우의 2~3배, 예: 24시간 재시도면 48~72시간
- 같은 key로 다른 payload가 오면 `409 IDEMPOTENCY_PAYLOAD_MISMATCH`
- timeout 이후에는 재요청보다 `GET /operations/{id}` 또는 주문 상태 조회를 우선
- provider timeout은 "실패"가 아니라 "확인 지연"으로 사용자 메시지를 구성

이 기준은 [Upsert/Unique Idempotency Write Path](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)와도 연결됩니다. 안전한 재시도는 클라이언트 친절 기능이 아니라 데이터 무결성 기능입니다.

### 3) 클라이언트 action enum을 작게 유지한다

error code는 수십 개가 될 수 있지만, 클라이언트 행동은 작게 유지하는 편이 좋습니다.

| user_action | 의미 |
| --- | --- |
| `FIX_INPUT` | 입력값 수정 |
| `LOGIN_AGAIN` | 인증 갱신 또는 재로그인 |
| `REQUEST_PERMISSION` | 권한 요청 |
| `WAIT_AND_RETRY` | 일정 시간 후 재시도 |
| `CHECK_STATUS` | 상태 조회로 결과 확인 |
| `CONTACT_SUPPORT` | 사용자가 해결하기 어려운 상태 |
| `NONE` | 별도 사용자 행동 없음 |

이렇게 하면 error code가 늘어도 앱 UX는 안정적으로 유지됩니다. 예를 들어 `PAYMENT_PROVIDER_TIMEOUT`, `ORDER_CONFIRMATION_DELAYED`, `EXPORT_JOB_PENDING`은 모두 `CHECK_STATUS`로 묶을 수 있습니다. 문구는 서버가 내려주거나 클라이언트 locale catalog에서 관리하되, 행동 enum은 자주 바꾸지 않는 것이 좋습니다.

### 4) 로그와 응답의 책임을 분리한다

응답은 클라이언트 행동을 돕고, 로그는 운영 진단을 돕습니다. 둘을 섞으면 둘 다 나빠집니다.

응답에 넣을 것:

- stable error code
- safe user message 또는 message key
- retryable 여부와 retry hint
- correlation id
- 제한된 필드명 또는 validation path

로그와 trace에만 둘 것:

- 내부 exception class와 stack trace
- downstream service 이름과 원문 오류
- SQL/state, provider request id, timeout budget
- 민감 데이터가 마스킹된 request context
- 배포 버전, feature flag, shard/tenant 정보

특히 validation error에서 사용자 입력 원문을 그대로 응답하거나 로그에 남기면 개인정보 문제가 생길 수 있습니다. 필드 경로와 규칙 이름만 내려도 대부분의 UX는 구현할 수 있습니다.

### 5) 배포 전 호환성 테스트를 넣는다

에러 계약은 성공 응답만큼 테스트해야 합니다. 최소 테스트는 아래입니다.

- 각 error code가 문서화된 HTTP status로 매핑되는지
- `retryable=true`인 code에 retry hint가 있는지
- `retryable=false`인 validation/auth error에 자동 재시도 힌트가 없는지
- 사용자 메시지에 내부 서비스명, SQL, secret, provider 원문이 없는지
- client action enum이 허용 목록에 있는지
- deprecated code가 삭제되지 않았는지

이 테스트는 [Consumer Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)과 잘 맞습니다. 클라이언트가 실제로 의존하는 에러 code와 action을 계약으로 고정하면, 서버 리팩터링이나 예외 계층 변경이 앱을 깨는 일을 줄일 수 있습니다.

## 트레이드오프/주의점

첫째, error code를 너무 잘게 쪼개면 관리 비용이 커집니다. 모든 validation rule마다 code를 만들면 카탈로그가 폭발합니다. 클라이언트 행동이 같다면 하나의 code와 field path로 묶는 편이 낫습니다.

둘째, retryable 필드는 강력하지만 위험합니다. 클라이언트가 이를 무한 재시도 허가로 해석하면 장애가 증폭됩니다. retryable에는 항상 backoff, 최대 횟수, idempotency 조건이 함께 가야 합니다.

셋째, 사용자 메시지를 서버에서 내려주면 빠른 수정이 쉽지만, 다국어와 앱 톤 관리가 어려울 수 있습니다. 반대로 클라이언트 message catalog만 쓰면 서버가 상황별 문구를 빠르게 조정하기 어렵습니다. 보통은 `message_key`와 안전한 fallback message를 함께 제공하는 방식이 균형이 좋습니다.

넷째, Problem Details를 도입해도 기존 클라이언트가 곧바로 바뀌지는 않습니다. legacy `errorCode`, `message`와 병행하는 기간이 필요할 수 있습니다. 공개 API라면 최소 1~2개 앱 릴리스 주기 또는 60~90일의 호환 기간을 두는 것이 안전합니다.

다섯째, 내부 오류를 너무 숨기면 지원팀이 답답해집니다. 그래서 correlation id와 support action이 중요합니다. 사용자는 안전한 메시지를 보고, 지원팀은 correlation id로 내부 trace를 찾아야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 공개 API 에러 응답에 `code`, `status`, `correlation_id`가 있다.
- [ ] 클라이언트가 `message` 문자열이 아니라 `code` 또는 `user_action`으로 분기한다.
- [ ] retryable 실패에는 `Retry-After` 또는 backoff hint와 idempotency 조건이 있다.
- [ ] validation/auth/business/dependency/system error가 taxonomy로 나뉘어 있다.
- [ ] 사용자 메시지와 개발자·운영 진단 정보가 분리되어 있다.
- [ ] error code별 owner와 알림 우선순위가 문서화되어 있다.
- [ ] 대시보드에서 HTTP status, error code, client version, retryable 여부를 함께 본다.
- [ ] deprecated error code 삭제 전에 호환 기간과 공지가 있다.

### 연습

1. 현재 서비스의 상위 20개 에러 응답을 모아 HTTP status, error code, retryable, user_action, owner 표로 정리해 보세요. 빈칸이 많은 영역이 계약 부채입니다.
2. 결제나 주문 생성 API 하나를 골라 timeout 발생 시 클라이언트가 해야 할 행동을 설계해 보세요. 즉시 재시도, 상태 조회, 사용자 안내 중 무엇이 안전한지 idempotency 조건과 함께 결정합니다.
3. 최근 7일간 4xx 상위 5개와 5xx 상위 5개를 error code 단위로 나눠 보세요. status code만 볼 때와 owner routing이 어떻게 달라지는지 비교합니다.
4. `message` 문자열을 파싱하는 클라이언트 코드가 있는지 찾아보고, `code`와 `user_action` 기반 분기로 바꾸는 마이그레이션 계획을 작성해 보세요.

정리하면 API Error Semantics의 목적은 예외를 더 예쁘게 보여주는 것이 아닙니다. 실패가 발생했을 때 클라이언트가 안전하게 행동하고, 운영자가 빠르게 owner를 찾고, 사용자가 불필요한 불안을 겪지 않게 만드는 것입니다. 성공 응답은 기능을 전달하지만, 실패 응답은 시스템의 신뢰도를 전달합니다.
