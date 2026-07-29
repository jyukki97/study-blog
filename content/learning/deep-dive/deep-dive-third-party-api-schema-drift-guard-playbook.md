---
title: "백엔드 커리큘럼 심화: Third-party API Schema Drift Guard, 외부 응답 변화에 무너지지 않는 법"
date: 2026-07-29T10:06:00+09:00
lastmod: 2026-07-29T10:06:00+09:00
draft: false
topic: "Backend Reliability"
tags: ["Third-party API", "Schema Drift", "API Integration", "Contract Testing", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "외부 API 응답 형식이 조용히 바뀔 때 장애로 번지지 않도록 adapter, tolerant reader, schema probe, fallback, quarantine 기준을 숫자 중심으로 정리합니다."
module: "backend-resilience"
study_order: 1266
key_takeaways:
  - "외부 API 응답은 내 서비스의 내부 모델이 아니라 언제든 흔들릴 수 있는 입력 계약으로 다뤄야 한다."
  - "파싱, 정규화, 비즈니스 반영을 분리하면 provider의 작은 변경이 핵심 도메인 장애로 번지는 것을 줄일 수 있다."
  - "schema drift는 테스트 한 번으로 끝나지 않고 canary 호출, shadow parser, fallback, quarantine 지표로 운영해야 한다."
operator_checklist:
  - "tier-0 외부 API는 응답 샘플, 필수 필드, optional 필드, unknown field 정책, fallback owner를 dependency register에 기록한다."
  - "필수 필드 누락률이 0.1%를 넘거나 parse failure가 5분간 1%를 넘으면 자동 강등 또는 provider incident로 분류한다."
  - "신규 parser 배포 전 최근 7~30일 raw sample에 대해 replay validation을 수행한다."
learning_refs:
  - title: "Outbound API Adapter Dependency Isolation"
    href: "/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/"
    description: "외부 API 호출을 timeout, retry, bulkhead, fallback으로 격리하는 기준입니다."
  - title: "API Response Compatibility Contract"
    href: "/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/"
    description: "내가 제공하는 API 응답 변경을 호환성 계약으로 관리하는 방법입니다."
  - title: "Consumer-Driven Contract Testing"
    href: "/learning/deep-dive/deep-dive-consumer-driven-contract-testing/"
    description: "소비자 관점에서 API 계약을 테스트하는 기본 전략입니다."
decision_guide:
  cases:
    - badge: "엄격 차단"
      title: "결제, 권한, 정산처럼 잘못 반영되면 되돌리기 어려운 응답"
      fit: "필수 필드 누락, 금액 타입 변경, 상태 enum 미인식, 서명 불일치가 1건이라도 치명적인 경로"
      watchouts: "너무 넓은 tolerant parser는 조용한 데이터 오염을 만든다."
      next_step: "inbox/quarantine에 원문과 이유를 저장하고 자동 반영을 막는다."
    - badge: "관용 수용"
      title: "검색, 추천, 부가 표시처럼 일시 강등이 가능한 응답"
      fit: "unknown field나 optional field 누락이 사용자 핵심 거래를 막지 않는 경로"
      watchouts: "관용 파싱을 핑계로 provider 계약 변경을 방치하기 쉽다."
      next_step: "기본값, stale cache, partial response fallback을 문서화한다."
faqs:
  - question: "JSON은 필드가 추가되어도 괜찮지 않나요?"
    answer: "필드 추가 자체는 보통 괜찮지만, 타입 변경, enum 확장, nested 구조 변경, nullability 변경은 소비자 코드를 깨뜨릴 수 있습니다. 특히 외부 응답을 내부 엔티티에 바로 매핑하면 작은 변화도 장애가 됩니다."
  - question: "외부 API 문서가 있으면 contract test가 필요 없나요?"
    answer: "문서는 출발점일 뿐입니다. 실제 응답은 지역, 계정 상태, 기능 플래그, provider 배포 단계에 따라 달라질 수 있으므로 샘플 기반 replay와 canary 호출을 함께 봐야 합니다."
---

외부 API 연동 장애는 꼭 500 응답이나 timeout으로만 오지 않습니다. 더 까다로운 장애는 **응답은 200인데 모양이 바뀐 경우**입니다. 문자열이던 금액이 숫자로 오고, 없던 enum 값이 추가되고, `data` 필드 안의 포맷이 달라지고, 특정 지역 계정에서만 nested field가 null이 됩니다. 서버 입장에서는 provider가 정상 응답을 줬으니 호출은 성공입니다. 하지만 우리 parser가 깨지거나, 더 나쁘게는 깨지지 않고 잘못된 값으로 내부 상태를 업데이트할 수 있습니다.

이 문제는 [Outbound API Adapter Dependency Isolation](/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/)의 다음 단계입니다. timeout, retry, circuit breaker로 외부 호출을 격리했다면, 이제 응답 본문 자체를 신뢰 경계로 봐야 합니다. 또 우리가 제공하는 API의 호환성은 [API Response Compatibility Contract](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)에서 다뤘지만, 소비자 입장에서는 반대로 **상대가 계약을 얼마나 안정적으로 지키는지 검증하고 흡수하는 계층**이 필요합니다. 계약 테스트 관점은 [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)과도 이어집니다.

## 이 글에서 얻는 것

- 외부 API 응답을 내부 도메인 모델에 바로 연결하면 왜 작은 schema drift가 장애로 번지는지 이해합니다.
- tolerant reader, strict normalizer, quarantine, fallback을 어떤 순서로 둘지 판단할 수 있습니다.
- provider 응답 변경을 배포 전 테스트와 운영 canary로 잡는 기준을 가져갑니다.
- 필수 필드, optional 필드, unknown field, enum 확장, 타입 변경을 숫자와 조건으로 리뷰하는 체크리스트를 정리합니다.

## 핵심 개념/이슈

### 1) 외부 응답은 DTO가 아니라 오염 가능한 입력이다

외부 API client를 만들 때 흔한 구현은 `ProviderResponse`를 JSON mapper로 바로 읽고, 그 객체를 service layer로 넘기는 방식입니다. 작은 서비스에서는 빠릅니다. 하지만 시간이 지나면 이 객체가 내부 도메인 언어처럼 퍼집니다. `providerStatus == "ACTIVE"` 같은 비교가 여러 파일에 흩어지고, optional field가 사실상 필수처럼 쓰이며, provider 특유의 error code가 사용자 메시지까지 올라옵니다.

이 구조에서는 provider 응답 모양이 바뀌면 영향 범위를 찾기 어렵습니다. 그래서 외부 응답은 최소 세 단계로 나누는 편이 안전합니다.

| 단계 | 역할 | 실패 처리 |
| --- | --- | --- |
| Raw response | 원문 body, header, status, 수신 시각 보존 | 크기 제한, 민감정보 마스킹 |
| Provider DTO | provider 문서와 실제 응답을 최대한 있는 그대로 표현 | parse failure, unknown shape 기록 |
| Normalized model | 우리 도메인이 이해하는 안정된 모델 | 필수 값 검증, 상태 매핑, fallback |

중요한 원칙은 provider DTO가 도메인 밖으로 새지 않게 하는 것입니다. 도메인 로직은 `ACTIVE`, `PAUSED`, `CANCELLED` 같은 내부 상태만 알아야 하고, provider가 `enabled`, `live`, `valid` 같은 값을 어떤 이름으로 주는지는 adapter 안에서 끝나야 합니다.

### 2) Tolerant reader와 strict normalizer를 같이 둔다

외부 JSON을 읽을 때 unknown field 하나 때문에 전체 요청을 실패시키면 provider의 안전한 필드 추가에도 장애가 납니다. 그래서 reader는 어느 정도 관용적이어야 합니다. 반대로 정규화 단계까지 너무 관용적으로 만들면 데이터 오염이 생깁니다. 예를 들어 모르는 결제 상태를 `PENDING`으로 대충 매핑하면 고객에게 이미 실패한 결제를 대기 중으로 보여줄 수 있습니다.

실무 기본값은 아래처럼 나눕니다.

| 변화 유형 | Reader 정책 | Normalizer 정책 |
| --- | --- | --- |
| unknown top-level field | 허용, metric 증가 | 무시 |
| optional field 누락 | 허용 | 기본값 또는 degraded flag |
| 필수 field 누락 | parse는 가능 | reject/quarantine |
| enum 새 값 | 문자열로 보존 | unknown state로 격리 |
| 숫자 타입 변경 | 허용 후보 | 범위와 정밀도 검증 |
| nested 구조 변경 | 샘플 저장 | feature 단위 강등 |

즉 "읽는 것"과 "반영하는 것"의 기준이 달라야 합니다. 읽기는 provider 변화 관측을 위해 넓게 열고, 반영은 도메인 안전을 위해 좁게 닫습니다.

### 3) Drift는 배포 시점이 아니라 운영 중에 온다

우리 코드 배포와 provider 배포는 같은 시계로 움직이지 않습니다. provider는 지역별 rollout을 할 수 있고, 특정 계정군에만 새 응답을 줄 수 있으며, 문서보다 먼저 실험 필드를 내보낼 수 있습니다. 그래서 CI의 mock response 하나로는 부족합니다.

최소 운영 장치는 네 가지입니다.

1. **Sample corpus**: 최근 7~30일 실제 응답 샘플을 민감정보 제거 후 보관
2. **Replay validation**: 새 parser를 배포하기 전 sample corpus로 재검증
3. **Canary request**: provider별 대표 계정으로 주기적 실제 호출
4. **Shadow parser**: 새 parser를 먼저 읽기 전용으로 돌려 기존 parser와 diff 비교

기준은 작게 시작해도 됩니다. tier-0 provider는 응답 유형별 샘플 100개 이상, tier-1은 30개 이상, tier-2는 실패 사례 중심으로 시작합니다. 새 enum 값이 하루 10건 이상 보이면 문서 확인과 provider 문의를 걸고, 필수 필드 누락률이 0.1%를 넘으면 자동 반영을 막습니다.

### 4) Fallback은 성공처럼 보이면 안 된다

외부 응답이 부분적으로 깨졌을 때 fallback을 쓰는 건 좋은 전략입니다. 하지만 fallback 결과를 정상 결과와 같은 모양으로 내려주면 운영자가 문제를 놓칩니다. 예를 들어 배송 상태 API가 깨졌을 때 `status: UNKNOWN`을 내려주면서 `degraded: true`, `source: stale_cache`, `last_success_at`을 같이 줘야 클라이언트와 운영자가 상황을 이해합니다.

초기 정책은 이렇게 둘 수 있습니다.

| 도메인 | fallback 허용 | 기준 |
| --- | --- | --- |
| 결제 승인 | 거의 금지 | 모르는 상태는 quarantine, 사용자에게 확인 중 안내 |
| 배송 추적 | 허용 | 최근 성공 값 24시간 이내면 stale 표시 |
| 추천/랭킹 | 허용 | 빈 결과 또는 기본 랭킹으로 강등 |
| 권한/인증 | 금지에 가까움 | fail-closed, 관리자 확인 |
| 환율/가격 | 제한 허용 | 보관 시각과 허용 오차 표시 |

fallback의 목적은 장애를 숨기는 것이 아니라 핵심 흐름을 보호하면서 문제를 보이게 만드는 것입니다.

## 실무 적용

### 1) Dependency contract card를 만든다

외부 API 3개만 먼저 골라도 효과가 큽니다. 트래픽 상위나 장애 비용이 큰 provider부터 아래 카드를 만듭니다.

```yaml
dependency: payment_provider
owner: payments-team
criticality: tier-0
response_contract:
  required_fields: [event_id, account_id, status, amount, currency, occurred_at]
  optional_fields: [risk_score, failure_reason, metadata]
  unknown_field_policy: tolerate_and_count
  unknown_enum_policy: quarantine
  max_body_size: 512KB
  accepted_clock_skew: 5m
drift_guard:
  sample_replay_window: 30d
  canary_interval: 5m
  parse_failure_alert: "5m rate > 1%"
  required_field_missing_alert: "rate > 0.1%"
fallback:
  stale_cache_allowed: false
  user_message: "결제 상태 확인 중"
```

이 문서는 길 필요가 없습니다. 필수 필드, unknown 정책, fallback, owner만 있어도 장애 때 판단 속도가 달라집니다.

### 2) Adapter 밖으로 provider enum을 내보내지 않는다

가장 먼저 고칠 코드는 provider enum이 도메인 코드로 흘러간 부분입니다.

```kotlin
enum class BillingStatus {
    ACTIVE,
    PAST_DUE,
    CANCELLED,
    UNKNOWN_PROVIDER_STATE
}

fun normalize(raw: ProviderSubscriptionResponse): NormalizedSubscription {
    val status = when (raw.status) {
        "active", "trialing" -> BillingStatus.ACTIVE
        "past_due", "unpaid" -> BillingStatus.PAST_DUE
        "canceled" -> BillingStatus.CANCELLED
        else -> BillingStatus.UNKNOWN_PROVIDER_STATE
    }

    requireNotNull(raw.id) { "missing provider subscription id" }
    requireNotNull(raw.customerId) { "missing provider customer id" }

    return NormalizedSubscription(
        providerId = raw.id,
        customerRef = raw.customerId,
        status = status,
        providerPayloadHash = raw.payloadHash
    )
}
```

모르는 상태를 바로 실패시킬지 `UNKNOWN_PROVIDER_STATE`로 저장할지는 도메인별로 다릅니다. 결제 차단, 권한 부여, 정산 반영처럼 부작용이 크면 자동 진행을 멈춥니다. 단순 표시라면 unknown 상태를 보여주되 action 버튼을 제한할 수 있습니다.

### 3) Drift 지표를 dependency별로 나눈다

대시보드에는 최소 아래 지표를 둡니다.

- `provider_parse_failure_rate`
- `provider_required_field_missing_rate`
- `provider_unknown_enum_count`
- `provider_unknown_field_count`
- `provider_payload_size_p95`
- `normalization_quarantine_count`
- `fallback_served_count`
- `sample_replay_failure_rate`

전체 외부 API 실패율 하나로 묶으면 늦습니다. provider별, endpoint별, account region별로 나눠야 원인을 빨리 찾습니다. 특히 parse failure가 0이라도 unknown enum이 늘면 다음 장애의 예고일 수 있습니다.

### 4) PR 리뷰에서 "응답 예시"보다 "응답 경계"를 본다

외부 API 연동 PR에서 확인할 질문은 단순합니다.

1. provider DTO와 내부 도메인 모델이 분리되어 있는가?
2. 필수 필드 누락, unknown enum, 타입 변경을 어떻게 처리하는가?
3. 최근 실제 응답 샘플로 replay validation을 했는가?
4. fallback이 정상 응답과 구분되는가?
5. provider 장애와 schema drift가 같은 alert로 섞이지 않는가?
6. parser 변경 rollback이 가능한가?

이 기준은 기능 개발을 느리게 만들기보다, 외부 변경 하나에 우리 배포가 흔들리는 일을 줄여 줍니다.

## 트레이드오프/주의점

첫째, 너무 엄격한 parser는 가용성을 떨어뜨립니다. provider가 안전하게 필드를 추가했는데 전체 요청을 실패시키면 우리 쪽이 더 불안정한 소비자가 됩니다. unknown field는 대체로 허용하고, 필수 의미에 영향을 주는 필드만 엄격하게 봅니다.

둘째, 너무 관용적인 normalizer는 데이터 오염을 만듭니다. 모르는 enum을 기본 성공 상태로 매핑하거나, 금액 parse 실패를 0으로 바꾸는 식의 fallback은 장애보다 위험합니다. 기본값은 사용자 표시에는 쓸 수 있어도 원장, 권한, 상태 전이에는 쓰면 안 됩니다.

셋째, raw sample 보관에는 개인정보와 비밀값 이슈가 있습니다. 샘플은 민감정보를 마스킹하고, 접근 권한과 보관 기간을 둬야 합니다. tier-0 provider라도 원문을 영구 보관하는 것이 답은 아닙니다. 필요한 필드와 hash, 실패 재현에 필요한 최소 payload만 남기는 편이 좋습니다.

넷째, provider 문서만 믿으면 늦습니다. 문서가 틀렸다는 뜻이 아니라, 실제 응답 다양성이 문서보다 넓을 수 있다는 뜻입니다. 계정 상태, 지역, 기능 플래그, rollout 단계가 모두 응답 모양에 영향을 줍니다. 문서 검토와 실제 샘플 검증은 서로 대체 관계가 아닙니다.

## 체크리스트 또는 연습

- [ ] tier-0 외부 API의 필수 필드와 optional 필드를 문서화했다.
- [ ] provider DTO가 도메인 모델 밖으로 새지 않는다.
- [ ] unknown field, unknown enum, 필수 field 누락 정책이 다르다.
- [ ] 최근 7~30일 응답 샘플로 parser replay validation을 돌릴 수 있다.
- [ ] fallback 응답에는 `degraded`, `source`, `last_success_at` 같은 신호가 있다.
- [ ] parse failure와 provider 5xx/timeout이 서로 다른 지표로 보인다.
- [ ] schema drift 발생 시 owner, rollback, quarantine 확인 경로가 정해져 있다.

연습은 하나만 해도 됩니다. 현재 서비스에서 결제사, 배송사, 인증 SaaS, 지도/주소 API 중 하나를 고르세요. 최근 응답 샘플 20개를 모아 필수 필드와 optional 필드를 분리하고, 모르는 enum이 들어왔을 때 `reject`, `quarantine`, `degraded display`, `default value` 중 무엇을 택할지 표로 정리합니다. 마지막 줄에는 숫자를 넣습니다. 예를 들어 `parse failure 5분 1% 초과`, `필수 필드 누락 0.1% 초과`, `unknown enum 하루 10건 초과`처럼 시작하면 adapter가 단순 client 코드가 아니라 운영 경계로 보이기 시작합니다.

