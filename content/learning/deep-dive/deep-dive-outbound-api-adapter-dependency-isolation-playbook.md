---
title: "백엔드 커리큘럼 심화: Outbound API Adapter, 외부 API 의존성을 제품 장애로 번지지 않게 막는 법"
date: 2026-07-16
draft: false
topic: "Backend Reliability"
tags: ["External API", "Adapter Pattern", "Resilience", "Contract Testing", "Observability", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "결제, 인증, 메일, 지도, AI 추론처럼 외부 API에 기대는 기능을 어댑터 경계, timeout budget, 재시도, 에러 변환, 관측 지표로 안전하게 운영하는 기준을 정리합니다."
module: "backend-resilience"
study_order: 1259
key_takeaways:
  - "외부 API 호출은 단순 HTTP client 코드가 아니라 제품 가용성과 데이터 정합성을 흔드는 운영 의존성이다."
  - "도메인 코드는 provider SDK와 원문 에러에 직접 묶지 말고, 내부 계약을 가진 outbound adapter 뒤에 둬야 한다."
  - "timeout, retry, idempotency, circuit breaker, quota, 관측 지표는 호출부마다 흩어두지 말고 adapter 정책으로 고정해야 한다."
operator_checklist:
  - "외부 API별 owner, 기능 중요도, timeout budget, retry 정책, rate limit, 장애 시 사용자 경험을 dependency register에 기록한다."
  - "핵심 요청의 전체 deadline 중 외부 API 대기 시간이 30~40%를 넘으면 동기 경로 유지 여부를 재검토한다."
  - "provider timeout/5xx가 5분 동안 10%를 넘거나 기준선 대비 p95가 2배가 되면 circuit breaker 또는 degraded mode를 검토한다."
  - "쓰기 호출은 idempotency key와 provider request id를 남기고, 결과 불명확 상태를 reconciliation queue로 넘긴다."
learning_refs:
  - title: "API Resource Budgeting"
    href: "/learning/deep-dive/deep-dive-api-resource-budgeting/"
    description: "요청 하나가 외부 API와 내부 자원을 얼마나 쓰는지 예산화하는 기준입니다."
  - title: "Timeout, Retry, Backoff"
    href: "/learning/deep-dive/deep-dive-timeout-retry-backoff/"
    description: "외부 호출의 deadline, 재시도, 지수 backoff를 안전하게 잡는 기본기입니다."
  - title: "API Error Semantics"
    href: "/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/"
    description: "provider 에러를 사용자 메시지, 재시도 가능성, 운영 조치로 분리하는 방법입니다."
  - title: "Resilience4j Circuit Breaker"
    href: "/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/"
    description: "하류 의존성 장애가 전체 서비스로 번지지 않게 차단하는 패턴입니다."
decision_guide:
  cases:
    - badge: "어댑터 필수"
      title: "결제, 인증, 권한, 정산, 고객 알림, AI 추론 핵심 경로"
      fit: "provider 실패가 사용자 행동 실패, 금전 손실, 데이터 불일치, 보안 사고로 이어지는 호출"
      watchouts: "SDK 편의 메서드를 controller나 service에 직접 넣으면 전환, 테스트, 장애 대응이 모두 어려워진다."
      next_step: "도메인 인터페이스, provider adapter, retry 정책, reconciliation queue를 한 묶음으로 설계한다."
    - badge: "경량 어댑터"
      title: "지도 보조 정보, 마케팅 enrich, 비핵심 추천"
      fit: "실패해도 핵심 업무가 계속 진행되고, 사용자에게 축소된 결과를 보여줄 수 있는 호출"
      watchouts: "비핵심이라도 같은 thread pool과 connection pool을 쓰면 핵심 API를 같이 느리게 만든다."
      next_step: "짧은 timeout, 별도 bulkhead, fallback response, 관측 지표부터 둔다."
    - badge: "직접 호출 허용"
      title: "로컬 개발 도구나 일회성 내부 배치"
      fit: "운영 사용자 영향이 없고, 실패해도 수동 재실행이 쉬우며, 장기 유지 코드가 아닌 경우"
      watchouts: "실험 코드가 운영 경로로 승격될 때 adapter 없이 굳어지는 순간이 가장 위험하다."
      next_step: "운영 승격 조건에 adapter 전환과 dependency register 등록을 포함한다."
faqs:
  - question: "외부 SDK가 이미 잘 만들어져 있는데 굳이 adapter가 필요한가요?"
    answer: "필요합니다. SDK는 provider 계약을 편하게 쓰게 해주지만, 우리 도메인의 timeout, 재시도, 에러 의미, 관측, 전환 전략을 대신 설계하지 않습니다."
  - question: "provider가 하나뿐이면 추상화가 과한가요?"
    answer: "여러 provider를 당장 지원하지 않아도 adapter는 가치가 있습니다. 교체 가능성보다 더 중요한 목적은 외부 장애와 계약 변화를 내부 도메인 코드로 번지지 않게 막는 것입니다."
---

백엔드 서비스는 생각보다 많은 외부 API 위에서 돌아갑니다. 결제 승인, OAuth 로그인, 메일 발송, SMS, 주소 정규화, 지도 거리 계산, 파일 바이러스 검사, AI 추론, 세금 계산, 배송 조회가 모두 그렇습니다. 처음에는 SDK 하나를 넣고 `client.send()`를 호출하면 끝나는 것처럼 보입니다. 하지만 운영에 들어가면 질문이 달라집니다. provider가 2초 느려지면 우리 API는 몇 초까지 기다릴 것인가. 쓰기 요청이 timeout 났는데 실제로는 처리됐을 수 있다면 사용자는 어떤 상태를 보게 할 것인가. provider가 필드 이름이나 에러 코드를 바꾸면 어느 테스트가 먼저 깨질 것인가.

외부 API 호출은 코드 한 줄이 아니라 **제품 의존성**입니다. 그래서 controller나 domain service 안에서 provider SDK를 직접 호출하는 구조는 편해 보여도 오래 버티기 어렵습니다. 호출 정책, 장애 처리, 비용, 감사 로그, 데이터 경계가 각 호출부에 흩어지고, 나중에 provider를 교체하거나 장애 모드를 만들 때 모든 비즈니스 로직을 다시 열어야 합니다. 이 글은 [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/), [Timeout, Retry, Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/), [API Error Semantics](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/), [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/)와 이어집니다. 핵심은 "HTTP client를 감싸자"가 아니라, **우리 시스템이 감당할 수 있는 외부 의존성 계약을 만들자**입니다.

## 이 글에서 얻는 것

- 외부 API 호출을 단순 네트워크 호출이 아니라 가용성, 정합성, 비용, 보안 경계로 이해합니다.
- provider SDK와 도메인 코드를 분리하는 outbound adapter의 역할을 설명할 수 있습니다.
- timeout, retry, idempotency, circuit breaker, fallback을 호출 유형별로 숫자 기준과 함께 잡을 수 있습니다.
- provider 변경, 장애, brownout, quota 초과를 대비하는 dependency register와 contract fixture 운영법을 가져갑니다.

## 핵심 개념/이슈

### 1) 외부 API는 우리 SLO 안으로 들어온다

외부 API가 느리거나 실패하면 사용자는 provider 이름을 보지 않습니다. 그냥 우리 서비스가 느리거나 실패했다고 느낍니다. 특히 로그인, 결제, 파일 업로드, AI 응답 생성처럼 사용자 흐름 한가운데 있는 호출은 provider SLO가 곧 우리 SLO 일부가 됩니다.

초기 분류는 아래처럼 할 수 있습니다.

| 호출 유형 | 예시 | 기본 목표 |
| --- | --- | --- |
| 핵심 읽기 | 사용자 권한 조회, 배송 상태 확인 | p95 500~1500ms, 짧은 retry 가능 |
| 핵심 쓰기 | 결제 승인, 구독 변경, 외부 티켓 생성 | idempotency key 필수, retry 0~1회 |
| 비핵심 enrich | 추천, 주소 보정, 마케팅 태그 | 300~800ms timeout, 실패 시 생략 |
| 비동기 작업 | 메일 발송, 리포트 전송, 정산 sync | queue 기반, 재시도와 dead letter |
| 검증 작업 | 바이러스 검사, 정책 확인 | 결과 불명확 상태와 quarantine |

여기서 중요한 기준은 전체 요청 deadline입니다. 사용자 요청 p95 목표가 2초라면 외부 API 하나가 2초를 모두 써서는 안 됩니다. 동기 경로에서는 외부 API 대기 시간이 전체 deadline의 **30~40%**를 넘지 않게 시작하는 편이 좋습니다. 여러 provider를 연쇄 호출한다면 더 보수적으로 잡아야 합니다.

### 2) Adapter는 provider SDK 래퍼가 아니라 내부 계약이다

좋은 outbound adapter는 SDK 메서드를 그대로 노출하지 않습니다. 내부 도메인이 이해하는 입력과 결과를 제공합니다. 예를 들어 결제 provider SDK가 `ChargeResponse`, `status_code`, `decline_reason`, `raw_error`를 준다고 해서 주문 도메인이 그 값을 모두 알아야 하는 것은 아닙니다.

예시는 아래처럼 단순하게 시작할 수 있습니다.

```java
public interface PaymentGateway {
    PaymentAttemptResult authorize(PaymentAuthorizeCommand command);
    PaymentCaptureResult capture(PaymentCaptureCommand command);
}

public record PaymentAttemptResult(
    String attemptId,
    ExternalDecision decision,
    Retryability retryability,
    String providerRequestId,
    boolean reconciliationRequired
) {}
```

도메인 입장에서 중요한 것은 provider의 원문 필드가 아니라 "승인됐는가", "거절됐는가", "다시 시도해도 되는가", "결과 확인 작업이 필요한가"입니다. provider별 세부 계약은 adapter 내부에 둡니다. 이렇게 해야 provider A의 `PENDING`, provider B의 `PROCESSING`, provider C의 timeout을 내부 상태 전이표로 안정적으로 매핑할 수 있습니다.

Adapter 경계에는 최소 네 가지가 들어갑니다.

- 내부 command/result 모델
- provider별 request/response 변환
- timeout, retry, idempotency, rate limit 정책
- metric, trace, log, provider request id 기록

이 네 가지가 없으면 adapter는 이름만 있는 wrapper가 됩니다.

### 3) 재시도는 성공률을 높이지만 중복 부작용도 만든다

읽기 호출은 짧은 재시도가 유용할 때가 많습니다. DNS 흔들림, 일시적인 502, connection reset은 1~2회 재시도로 회복될 수 있습니다. 반대로 쓰기 호출은 조심해야 합니다. 결제 승인, 메일 발송, 외부 티켓 생성 같은 작업을 아무 생각 없이 재시도하면 중복 결제, 중복 발송, 중복 케이스가 생깁니다.

초기 기준은 아래 정도가 현실적입니다.

| 호출 | timeout | retry | 필수 조건 |
| --- | --- | --- | --- |
| 읽기 API | 500~1500ms | 1~2회, jitter 포함 | 전체 deadline 안에서만 |
| 사용자 요청 중 쓰기 | 2~3초 | 0~1회 | idempotency key, payload hash |
| 비동기 쓰기 | provider SLA 기준 | 제한적 backoff | job id, dead letter, max attempt |
| 대량 sync | batch 단위 timeout | rate limit 기반 | checkpoint, resume token |

재시도는 반드시 [Timeout, Retry, Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)의 deadline 안에 있어야 합니다. 상위 요청 deadline이 2초인데 하위 adapter가 1초 timeout을 3회 반복하면 이미 정책이 깨진 것입니다. 또한 retryable 판단은 HTTP status만으로 하지 않는 편이 좋습니다. `429`, `503`, connection timeout은 retry 후보일 수 있지만, `400`, 권한 오류, payload validation 실패는 대부분 재시도해도 해결되지 않습니다.

### 4) 에러 변환은 사용자 경험과 운영 대응을 분리한다

Provider 에러를 그대로 사용자에게 노출하면 두 가지 문제가 생깁니다. 첫째, 사용자는 provider 내부 코드나 영어 메시지를 이해하지 못합니다. 둘째, 내부 서비스명, 계정 구조, quota 이름 같은 민감 정보가 노출될 수 있습니다.

Adapter는 외부 에러를 내부 에러 의미로 변환해야 합니다.

```yaml
provider_error_mapping:
  timeout:
    user_message: "요청 처리 상태를 확인 중입니다."
    retryability: "unknown_result_check_later"
    operation: "enqueue_reconciliation"
  rate_limited:
    user_message: "잠시 후 다시 시도해 주세요."
    retryability: "retry_after"
    operation: "open_circuit_if_sustained"
  invalid_payload:
    user_message: "요청 정보를 다시 확인해 주세요."
    retryability: "not_retryable"
    operation: "developer_alert_if_new_schema"
```

핵심은 실패를 `success/fail` 두 값으로만 보지 않는 것입니다. 외부 쓰기 호출은 결과가 불명확할 수 있습니다. timeout이 났지만 provider 쪽에서는 성공했을 수 있습니다. 이런 상태는 사용자에게 무작정 실패라고 말하기보다 `PENDING_CONFIRMATION` 같은 내부 상태로 두고, provider status 조회나 webhook으로 확인하는 편이 안전합니다. 이 관점은 [API Error Semantics](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)와 [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/)에서도 중요합니다.

### 5) 관측 지표는 provider별, 기능별로 쪼개야 한다

외부 API 장애는 전체 error rate만 보면 늦게 보입니다. 특정 provider의 특정 endpoint만 느려질 수 있고, 특정 tenant의 quota만 막힐 수 있으며, 특정 지역에서 DNS나 TLS handshake가 흔들릴 수도 있습니다. Adapter에서 지표를 남기면 이런 차이를 빠르게 볼 수 있습니다.

최소 지표:

- `external_api.request.count{provider, operation, result}`
- `external_api.latency.ms{provider, operation}`
- `external_api.timeout.count{provider, operation}`
- `external_api.retry.count{provider, operation, reason}`
- `external_api.circuit.state{provider, operation}`
- `external_api.unknown_result.count{provider, operation}`
- `external_api.quota.remaining{provider, account}`

알림 기준은 처음부터 완벽할 필요는 없습니다. 시작 기준으로는 timeout 또는 5xx가 **5분 동안 10% 초과**, p95 latency가 기준선 대비 **2배 이상**, unknown result가 평소 대비 **3배 이상**, quota remaining이 **20% 이하**일 때 알림을 걸 수 있습니다. 이후 실제 트래픽과 장애 이력을 보며 조정하면 됩니다.

## 실무 적용

### 1) Dependency register부터 만든다

코드보다 먼저 외부 의존성 목록을 표로 만듭니다.

```yaml
provider: "AcmePay"
owner: "payments-platform"
business_flow: ["checkout", "subscription_renewal"]
criticality: "tier-0"
sync_path: true
request_deadline_budget_ms: 2500
adapter_timeout_ms: 1200
retry_policy: "write_once_with_idempotency"
idempotency_key: "order_id + payment_attempt_id"
fallback: "pending_confirmation"
reconciliation:
  method: "provider_status_api + webhook"
  max_delay_minutes: 10
observability:
  dashboard: "external-api/acmepay"
  alert: "timeout_rate_10pct_5m"
exit_plan:
  alternative_provider: "BetaPay"
  contract_fixture_count: 80
```

이 문서가 있으면 장애 때 "어디까지 기다릴지", "누가 owner인지", "무엇을 낮춰 제공할지"를 바로 확인할 수 있습니다. 반대로 이 목록이 없으면 외부 API 장애는 매번 코드 검색부터 시작합니다.

### 2) 패키지 구조는 도메인과 provider를 분리한다

Spring 기준으로는 아래처럼 둘 수 있습니다.

```text
payment/
  application/
    PaymentService.java
  domain/
    PaymentAttempt.java
    PaymentGateway.java
  infrastructure/
    acmepay/
      AcmePayAdapter.java
      AcmePayClient.java
      AcmePayErrorMapper.java
      AcmePayProperties.java
      AcmePayContractFixturesTest.java
```

`PaymentService`는 `AcmePayClient`를 몰라야 합니다. 도메인은 `PaymentGateway`만 알고, provider 전용 request, response, signature, endpoint, raw error는 infrastructure 아래에 둡니다. 이 경계가 있어야 테스트도 쉬워집니다. 도메인 테스트는 fake gateway로 상태 전이를 확인하고, adapter 테스트는 provider fixture와 mock server로 계약 변환을 확인합니다.

### 3) Contract fixture를 저장한다

Provider API는 문서만 믿기 어렵습니다. 실제 sandbox 응답, webhook payload, error response, rate limit header를 fixture로 저장해 회귀 테스트에 넣는 편이 좋습니다.

검증 항목:

- 정상 응답이 내부 result로 매핑되는가
- provider enum이 새 값으로 늘어났을 때 unknown으로 안전하게 떨어지는가
- timeout, 429, 5xx, validation error가 retryability로 분리되는가
- 민감 필드가 로그에 남지 않는가
- provider request id와 trace id가 함께 남는가

Provider가 API version을 올리거나 SDK를 업데이트할 때는 fixture 테스트를 먼저 돌립니다. 외부 API 변경은 런타임에서 처음 발견하면 늦습니다.

### 4) Circuit breaker와 bulkhead를 adapter 단위로 둔다

외부 API가 느려졌을 때 가장 나쁜 구조는 모든 웹 요청 thread가 같은 provider 응답을 기다리는 것입니다. 이때는 우리 DB가 멀쩡해도 서비스 전체가 느려집니다. Adapter별로 bulkhead를 두고, 실패율이 일정 기준을 넘으면 circuit을 열어 호출을 잠시 멈춥니다.

권장 시작값:

- 외부 provider별 최대 동시 호출 수를 전체 worker thread의 10~20% 이하로 제한
- timeout/5xx 비율 10% 초과가 5분 지속되면 open
- half-open은 5~20개 probe 요청으로 제한
- 핵심 write path는 breaker open 시 `pending` 또는 명확한 사용자 메시지로 전환
- 비핵심 path는 빈 추천, cached value, "나중에 갱신"으로 degraded response 제공

Circuit breaker는 실패를 숨기는 장치가 아닙니다. 실패가 전체 시스템으로 번지지 않게 경계를 만드는 장치입니다.

## 트레이드오프/주의점

첫째, adapter를 너무 일반화하면 오히려 망가집니다. 모든 provider를 같은 인터페이스에 억지로 맞추면 결제, 메일, AI 추론, 지도 호출의 중요한 차이가 사라집니다. 공통화할 것은 관측, timeout, error mapping 같은 운영 골격이고, 도메인 의미는 각 adapter에 남겨야 합니다.

둘째, provider 고유 기능을 숨기면 제품 속도가 느려질 수 있습니다. 이때는 내부 계약에 필요한 기능을 명시적으로 올리는 편이 낫습니다. "나중에 바꿀 수 있게 아무것도 쓰지 말자"가 아니라 "우리가 의식적으로 선택한 provider 기능을 문서화하자"가 맞습니다.

셋째, fallback은 언제나 가능한 것이 아닙니다. 결제 승인, 권한 변경, 보안 검증처럼 되돌리기 어려운 작업은 가짜 성공으로 넘기면 더 큰 사고가 됩니다. 이런 경로에서는 축소 제공보다 pending 상태, 수동 확인, 재처리 큐가 안전합니다.

넷째, 외부 API를 캐시하면 비용과 지연은 줄지만 신선도 문제가 생깁니다. 권한, 가격, 재고, 환율처럼 최신성이 중요한 값은 TTL과 stale 허용 범위를 명확히 해야 합니다.

다섯째, provider 상태 페이지를 맹신하면 안 됩니다. 상태 페이지가 정상이어도 특정 region, account, endpoint, quota만 실패할 수 있습니다. 우리 synthetic probe와 실제 사용자 지표가 더 빠른 신호일 때가 많습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 외부 API별 owner, criticality, timeout, retry, quota, fallback이 dependency register에 있다.
- [ ] 도메인 코드는 provider SDK 타입과 raw error를 직접 참조하지 않는다.
- [ ] 쓰기 호출에는 idempotency key, payload hash, provider request id가 남는다.
- [ ] timeout과 retry는 상위 request deadline 안에서 계산된다.
- [ ] provider timeout, 5xx, 429, unknown result, quota remaining 지표가 adapter에서 나온다.
- [ ] provider fixture와 error mapping 회귀 테스트가 있다.
- [ ] 장애 시 degraded response, pending confirmation, reconciliation queue 중 하나로 흐름이 정리된다.

### 연습

1. 현재 서비스에서 외부 API 3개를 고르고 criticality를 `tier-0`, `tier-1`, `tier-2`로 나눠 보세요.
2. 가장 위험한 쓰기 호출 하나를 골라 timeout 이후 실제 provider 처리 여부를 어떻게 확인하는지 적어 보세요.
3. provider SDK 타입이 도메인 service까지 새어 들어간 코드가 있다면 내부 result 타입으로 감싸는 adapter를 설계해 보세요.
4. provider 장애를 가정하고 5분 동안 timeout 20%가 발생했을 때 사용자 화면, 알림, queue, 재처리 흐름이 어떻게 움직이는지 런북으로 써 보세요.
