---
title: "백엔드 커리큘럼 심화: 메트릭 카디널리티 예산과 라벨 거버넌스 플레이북"
date: 2026-07-04
draft: false
topic: "Observability"
tags: ["Metric Cardinality", "Prometheus", "OpenTelemetry", "Micrometer", "Observability Cost", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "Prometheus와 OpenTelemetry 메트릭이 라벨 폭증으로 비용·메모리·알람 품질을 망치지 않도록, 카디널리티 예산과 리뷰 기준을 숫자 중심으로 정리합니다."
module: "backend-ops-observability"
study_order: 1452
keywords: ["메트릭 카디널리티", "Prometheus label", "OpenTelemetry attribute", "Micrometer tag", "observability governance"]
---

메트릭은 처음 붙일 때는 가볍습니다. `http_requests_total`, `order_created_total`, `payment_latency_seconds` 같은 지표 몇 개만 있으면 서비스 상태가 훨씬 선명해집니다. 문제는 시간이 지나면서 라벨이 늘어날 때 시작됩니다. 장애를 빨리 보고 싶어서 `userId`, `tenantId`, `requestId`, `path`, `exceptionMessage`를 붙이고, 대시보드 필터가 필요하다는 이유로 `featureFlag`, `experimentGroup`, `clientVersion`까지 추가하면 Prometheus나 장기 저장소가 감당해야 하는 시계열 수가 갑자기 폭발합니다.

운영에서 중요한 점은 "메트릭을 많이 남기자"가 아닙니다. **반복해서 집계할 질문만 메트릭으로 만들고, 고유값이 큰 맥락은 로그와 트레이스로 넘기는 것**입니다. 이 글은 [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/), [APM 기본](/learning/deep-dive/deep-dive-apm-basics/), [OpenTelemetry 통합 관측](/learning/deep-dive/deep-dive-opentelemetry/), [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)을 이미 붙인 팀이 다음 단계에서 정해야 할 카디널리티 예산과 라벨 리뷰 기준을 다룹니다.

## 이 글에서 얻는 것

- 메트릭 카디널리티가 왜 비용 문제가 아니라 **알람 품질과 장애 대응 속도 문제**인지 이해할 수 있습니다.
- 새 라벨을 추가할 때 허용·주의·금지 기준을 숫자로 판단할 수 있습니다.
- Prometheus, Micrometer, OpenTelemetry 기반 서비스에서 적용 가능한 라벨 예산표와 리뷰 체크리스트를 가져갈 수 있습니다.
- 로그·트레이스·메트릭 중 어떤 신호에 어떤 정보를 넣어야 하는지 실무 기준을 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) 시계열 수는 라벨 값 조합의 곱으로 늘어난다

Prometheus 계열에서 하나의 시계열은 대략 `metric name + label set`으로 결정됩니다. 예를 들어 아래 메트릭이 있다고 해 봅시다.

```text
http_server_requests_seconds_bucket{
  method="GET",
  status="200",
  uri="/orders/{id}",
  tenant="enterprise-a",
  le="0.5"
}
```

여기서 각 라벨의 값 종류가 늘어나면 시계열 수는 더하기가 아니라 곱으로 증가합니다.

| 라벨 | 값 종류 예시 | 시계열 영향 |
| --- | ---: | --- |
| `method` | 5개 | 낮음 |
| `status` | 10개 | 낮음 |
| `uri` | 120개 | 중간 |
| `tenant` | 3,000개 | 매우 높음 |
| histogram bucket `le` | 20개 | 기존 조합을 20배로 증폭 |

단순 계산으로도 `5 x 10 x 120 x 3,000 x 20 = 360,000,000` 조합 가능성이 생깁니다. 실제로 모든 조합이 동시에 생기지는 않더라도, 피크 트래픽과 배포 변화가 겹치면 저장소 메모리, remote write 비용, 쿼리 시간이 함께 흔들립니다. 그래서 histogram을 켤 때는 버킷 수와 라벨 수를 같이 봐야 합니다. [관측 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)에서 P95/P99를 계산하려면 histogram이 필요하지만, 모든 비즈니스 차원에 bucket을 곱하는 것은 별개의 문제입니다.

### 2) 라벨은 "검색 편의"가 아니라 "반복 집계 기준"이어야 한다

라벨은 대시보드에서 필터하기 쉽기 때문에 자꾸 늘어납니다. 하지만 메트릭 라벨은 로그 필드가 아닙니다. 좋은 라벨은 반복해서 집계할 축입니다.

허용하기 쉬운 라벨:

- `service`, `env`, `region`, `cluster`
- `method`, `status_class`, `route_template`
- `outcome`: `success`, `fail`, `timeout`, `rejected`
- `dependency`: `mysql`, `redis`, `payment-api`처럼 값이 제한된 의존성 이름

주의가 필요한 라벨:

- `tenant`: 상위 20개 테넌트만 별도 분리하고 나머지는 `other`로 묶을 수 있는가
- `clientVersion`: 모바일 앱처럼 버전 종류가 많으면 major/minor까지만 남길 수 있는가
- `errorCode`: 도메인 코드가 수십 개 수준으로 관리되는가
- `featureFlag`: 임시 플래그 제거 정책이 있는가

금지에 가까운 라벨:

- `userId`, `email`, `sessionId`, `requestId`
- 실제 URL 경로(`/orders/12345`) 또는 raw query string
- exception message 전문
- SQL 전문, 검색어 전문, 파일명, IP 전체

고유값이 큰 정보는 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)이나 trace attribute에 제한적으로 남기는 편이 낫습니다. 메트릭은 "얼마나 자주, 어느 정도로"를 답하고, 로그와 트레이스는 "어떤 요청에서 왜"를 답하게 역할을 나눠야 합니다.

### 3) `uri` 라벨은 실제 경로가 아니라 route template이어야 한다

가장 흔한 사고는 HTTP 지표의 `uri` 라벨에 실제 경로가 들어가는 경우입니다.

```text
# 나쁜 예
uri="/orders/123456"
uri="/orders/123457"
uri="/orders/123458"

# 좋은 예
uri="/orders/{orderId}"
```

Spring MVC나 WebFlux 계측은 보통 route template을 잡아주지만, 커스텀 필터나 gateway 계층에서 직접 메트릭을 만들면 raw path가 들어가기 쉽습니다. 특히 404, 500, fallback route에서는 템플릿 매칭이 안 되어 raw path가 들어가는 경우가 있습니다. 그래서 HTTP 라벨 정책에는 "정상 요청뿐 아니라 unknown route도 저카디널리티 값으로 접는다"가 들어가야 합니다.

실무 기본값:

- 매칭된 route는 `/orders/{id}` 형태로 기록
- 매칭 실패는 `unknown` 또는 `not_found` 하나로 접기
- query string은 metric label에 금지
- customer id, order id, file id는 로그·trace에서만 검색

이 기준은 [API 리소스 예산 설계](/learning/deep-dive/deep-dive-api-resource-budgeting/)와도 연결됩니다. API가 사용하는 CPU, DB, 네트워크 예산을 보려면 경로별 집계는 필요하지만, 리소스 ID별 집계는 대부분 메트릭 저장소를 망칩니다.

### 4) Histogram은 P99를 주지만, 라벨 폭발도 증폭한다

Latency P95/P99를 보려면 histogram이 필요합니다. 하지만 histogram은 bucket마다 시계열을 만들기 때문에 라벨 수가 많을수록 비용이 크게 늘어납니다. 예를 들어 `http_server_requests_seconds_bucket`에 20개 버킷이 있고, `method/status/uri` 조합이 2,000개라면 bucket 시계열만 40,000개가 됩니다. 여기에 `tenant`를 붙이면 바로 감당하기 어려운 숫자가 됩니다.

권장 기준은 아래와 같습니다.

- 사용자 영향 API: route template 기준 histogram 허용
- 내부 짧은 함수: counter 또는 timer summary 수준으로 제한
- tenant별 latency: 상위 N개만 별도 metric, 전체 tenant 분석은 trace/log 샘플링으로 처리
- batch job: job type과 outcome 중심으로 집계, input file id는 로그로 이동
- error message별 latency: 금지, error class 또는 domain error code만 허용

P99가 필요하다는 이유만으로 모든 차원을 histogram에 붙이면 대시보드는 화려해지지만 쿼리와 알람이 느려집니다. 관측성은 저장량이 아니라 질문의 선명도로 평가해야 합니다.

### 5) 카디널리티 사고는 보통 코드 리뷰에서 막아야 한다

카디널리티는 배포 후에야 크게 보이는 경우가 많습니다. 그래서 운영팀이 Prometheus 메모리 사용량을 보고 뒤늦게 잡는 방식은 늦습니다. 새 메트릭과 새 라벨은 코드 리뷰 단계에서 아래 정보를 요구해야 합니다.

- 이 메트릭이 답하려는 운영 질문은 무엇인가
- 라벨별 예상 값 종류는 몇 개인가
- 1일/7일 기준 최대 시계열 수는 얼마로 예상하는가
- 알람에 쓰이는가, 대시보드에만 쓰이는가
- 고유 식별자는 로그나 trace로 대체할 수 없는가
- 제거 기준과 owner는 누구인가

이 기준은 [Telemetry Pipeline FinOps](/posts/2026-03-20-observability-finops-telemetry-pipeline-trend/)에서 말한 비용 제어와 같은 방향입니다. 메트릭 비용은 저장소 요금만이 아니라 쿼리 지연, 알람 누락, 온콜 피로까지 포함합니다.

## 실무 적용

### 1) 서비스별 메트릭 예산을 숫자로 둔다

처음부터 완벽한 기준은 어렵습니다. 그래도 예산이 없으면 리뷰가 취향 싸움이 됩니다. 중간 규모 백엔드 서비스의 출발점은 아래처럼 잡을 수 있습니다.

| 항목 | 시작 기준 | 조치 기준 |
| --- | ---: | --- |
| 서비스당 active series | 10,000 이하 | 30,000 초과 시 리뷰 |
| 단일 metric series | 2,000 이하 | 5,000 초과 시 owner 승인 |
| 단일 label 값 종류 | 100 이하 | 500 초과 시 drop/bucket 검토 |
| route label 값 종류 | 200 이하 | raw path 유입 여부 점검 |
| histogram bucket 수 | 10~20 | 라벨 추가 전 재계산 |
| 새 custom metric | PR당 근거 필수 | owner/unit/cardinality estimate 없으면 반려 |

트래픽이 큰 플랫폼 서비스는 이보다 큰 예산이 필요할 수 있습니다. 반대로 소규모 서비스는 더 작아야 합니다. 핵심은 절대값보다 **초기 예산, 초과 조건, 승인 경로**가 있다는 점입니다.

### 2) 라벨 허용표를 코드 리뷰 템플릿에 넣는다

실무에서는 긴 문서보다 짧은 표가 더 잘 작동합니다.

| 분류 | 예시 | 정책 |
| --- | --- | --- |
| 허용 | `env`, `service`, `region`, `method`, `status_class` | 기본 허용 |
| 제한 허용 | `uri`, `dependency`, `error_code`, `client_type` | 값 종류와 owner 필요 |
| 승인 필요 | `tenant`, `plan`, `feature_flag`, `client_version` | 상위 N개/버킷화 전략 필요 |
| 금지 | `user_id`, `email`, `request_id`, raw path, raw query | 로그/trace로 이동 |

이 표가 있으면 "디버깅하기 편해서 넣었다"는 이유만으로 무제한 라벨이 들어오는 일을 줄일 수 있습니다.

### 3) Micrometer 계측 예시

나쁜 예는 보통 이렇게 생겼습니다.

```java
Counter.builder("payment.failed")
    .tag("userId", userId)
    .tag("orderId", orderId)
    .tag("message", exception.getMessage())
    .register(meterRegistry)
    .increment();
```

좋은 예는 집계 가능한 차원만 남깁니다.

```java
Counter.builder("payment.failed")
    .tag("provider", providerName)
    .tag("reason", normalizeReason(exception))
    .tag("retryable", String.valueOf(isRetryable(exception)))
    .register(meterRegistry)
    .increment();

log.warn("payment failed orderId={} userId={} provider={} reason={}",
    orderId, userId, providerName, normalizeReason(exception));
```

`orderId`와 `userId`는 운영 추적에 필요하지만, 메트릭 라벨에는 맞지 않습니다. 대신 로그에 남기고 `traceId`로 메트릭-로그-트레이스를 연결합니다. 이 방식은 [분산 추적 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)과 같이 적용하면 효과가 큽니다.

### 4) 주간 점검 쿼리

Prometheus 계열에서는 아래처럼 상위 시계열을 대략 확인할 수 있습니다.

```promql
topk(20, count by (__name__)({__name__=~".+"}))
```

서비스별로 보고 싶다면 공통 라벨을 붙여 집계합니다.

```promql
topk(20, count by (job, __name__)({__name__=~".+"}))
```

라벨 값 종류가 많은 후보도 봅니다.

```promql
topk(20, count by (job, uri) (http_server_requests_seconds_count))
```

운영 루틴은 단순하게 둡니다.

1. 매주 active series 상위 20개 metric을 본다.
2. 전주 대비 30% 이상 증가한 metric을 표시한다.
3. 새로 생긴 label key를 리뷰한다.
4. raw path, user id, request id 의심 값을 샘플링한다.
5. owner가 없는 metric은 삭제 후보로 올린다.

### 5) 도입 순서

**1단계, inventory**
- 현재 metric name, label key, label value cardinality를 뽑습니다.
- active series 상위 20개를 기준으로 비용을 잡아먹는 지표를 찾습니다.

**2단계, policy**
- 허용/제한/금지 라벨 표를 만듭니다.
- 새 메트릭 PR 템플릿에 owner, unit, cardinality estimate, alert 사용 여부를 넣습니다.

**3단계, cleanup**
- raw path, request id, user id가 들어간 라벨을 먼저 제거합니다.
- route template 미매칭 값은 `unknown`으로 접습니다.

**4단계, guardrail**
- 저장소 active series가 예산을 넘으면 알람을 냅니다.
- 새 라벨 추가는 관측성 owner 또는 서비스 owner 승인 대상으로 둡니다.

## 트레이드오프/주의점

첫째, 카디널리티를 줄이면 분석 세밀도가 떨어질 수 있습니다. tenant별 문제를 바로 보고 싶을 때 모든 tenant를 라벨로 넣고 싶은 유혹이 큽니다. 하지만 모든 tenant를 실시간 metric label로 두는 대신 상위 N개, 샘플링 trace, 로그 검색, 별도 분석 배치로 나누는 편이 운영 비용이 낮습니다.

둘째, 라벨을 너무 적게 두면 알람이 둔해집니다. 예를 들어 모든 외부 API 실패를 `external_error_total` 하나로만 보면 어떤 의존성이 문제인지 모릅니다. `dependency`처럼 값 종류가 제한된 라벨은 적극적으로 두는 편이 좋습니다.

셋째, 비용 절감만 목표로 삼으면 관측성이 약해집니다. 목표는 적게 저장하는 것이 아니라 **반복 의사결정에 쓰이는 신호만 선명하게 저장하는 것**입니다.

넷째, 로그로 넘긴다고 모든 문제가 해결되지는 않습니다. 로그도 고비용 저장소입니다. 다만 로그는 검색·보존·샘플링 정책을 다르게 적용할 수 있고, 고유 식별자를 metric label로 두는 것보다 운영적으로 낫습니다.

다섯째, OpenTelemetry attribute와 Prometheus label은 같은 의미로 다뤄야 합니다. SDK에서는 attribute처럼 보이더라도 exporter와 backend에서 metric label로 변환되면 카디널리티 비용이 생깁니다.

의사결정 우선순위는 **알람에 필요한 저카디널리티 지표 > 장애 원인 추적용 trace/log > 임시 디버깅 필드 > 편의성 필터**입니다. 편의성 필터가 알람과 저장소 안정성을 이기면 안 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 새 metric PR에 owner, unit, label 목록, 예상 카디널리티가 적혀 있다.
- [ ] HTTP `uri` 라벨은 raw path가 아니라 route template이다.
- [ ] `userId`, `requestId`, `sessionId`, `email`, raw query string은 metric label로 쓰지 않는다.
- [ ] histogram metric에 새 라벨을 붙이기 전에 bucket 수까지 곱해 계산했다.
- [ ] 서비스별 active series 예산과 초과 알람이 있다.
- [ ] 고유 식별자는 로그 또는 trace로 이동하고 `traceId`로 연결한다.
- [ ] owner 없는 metric과 오래된 feature flag label을 주기적으로 제거한다.

### 연습

1. 현재 서비스의 active series 상위 20개 metric을 뽑고, 라벨 조합이 큰 이유를 한 줄씩 적어보세요.
2. `http_server_requests_seconds`에 붙은 `uri` 값 중 raw id가 섞여 있는지 확인하고, `unknown` 처리 기준을 정해보세요.
3. 신규 비즈니스 metric 하나를 설계하면서 `허용/제한/금지 라벨` 표에 따라 어떤 값을 metric에서 빼야 하는지 리뷰해보세요.

## 관련 글

- [관측성 베이스라인: 로그·메트릭·트레이스](/learning/deep-dive/deep-dive-observability-baseline/)
- [APM 기본과 Micrometer 지표 설계](/learning/deep-dive/deep-dive-apm-basics/)
- [OpenTelemetry 통합 관측 표준](/learning/deep-dive/deep-dive-opentelemetry/)
- [구조화 로깅: 검색 가능한 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)
- [Telemetry Pipeline FinOps](/posts/2026-03-20-observability-finops-telemetry-pipeline-trend/)
