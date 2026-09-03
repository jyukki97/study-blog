---
title: "2026 개발 트렌드: OpenTelemetry Metric Cardinality Limit, 관측성의 다음 운영 문제는 비용이 아니라 분해된 수치의 완전성이다"
date: 2026-09-03T10:06:00+09:00
lastmod: 2026-09-03T10:06:00+09:00
draft: false
tags: ["OpenTelemetry", "Metrics", "Cardinality", "SLO", "Observability", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["OpenTelemetry metric cardinality limit", "otel.metric.overflow", "metric data completeness", "aggregation cardinality limit", "OpenTelemetry Views"]
description: "OpenTelemetry SDK의 metric cardinality limit과 overflow 동작을 바탕으로, 관측성 운영의 핵심을 단순 비용 절감이 아니라 SLO·경보·대시보드의 속성별 분해 결과가 언제 불완전해지는지 드러내는 데이터 품질 계약으로 정리합니다."
summary: "OpenTelemetry metric stream이 cardinality limit에 도달해도 총합은 사라지지 않는다. 대신 추가 measurement의 모든 측정 속성이 overflow data point로 접히므로, route·status·tenant 같은 속성으로 필터·group-by한 수치는 조용히 undercount할 수 있다. 2026년의 운영 기준은 limit을 크게 올려 overflow를 숨기는 일이 아니라, metric별 의도한 dimension·temporality·overflow 가시성·SLO 의존도를 함께 관리하는 일이다."
key_takeaways:
  - "OpenTelemetry Metrics SDK의 기본 aggregation cardinality limit은 metric stream당 2,000개 조합이며, 이는 backend 전체 series 수를 제한하는 값이 아니다."
  - "overflow에서는 값이 버려지지 않고 otel.metric.overflow=true data point에 집계되지만, 원래 measurement attribute 전체가 빠진다. 총합은 맞아도 속성별 breakdown은 누락될 수 있다."
  - "동일한 high-cardinality dimension도 delta temporality에서는 collection cycle의 active set으로, cumulative temporality에서는 process lifetime의 누적으로 평가해야 한다."
  - "Views의 allowlist와 upstream normalization은 무작정 limit을 높이는 것보다 안전한 첫 조치이며, overflow는 paging SLO·autoscaling·핵심 dashboard에서는 즉시 가시화해야 한다."
operator_checklist:
  - "metric, measurement attribute, resource attribute, 예상 동시 조합 수, consumer(SLO·alert·dashboard), owner를 한 inventory에 기록한다."
  - "otel.metric.overflow=true 또는 exporter가 바꾼 otel_metric_overflow=true label을 metric name·service·cluster 단위로 지속 감시한다."
  - "필터·group-by를 쓰는 핵심 차트 옆에 overflow 상태를 같이 보여 주고, overflow 중인 breakdown으로 자동 action을 확대하지 않는다."
  - "raw URL, request ID, user input, session ID, raw exception message는 metric attribute에서 제거하거나 정규화한다."
  - "intentional high-cardinality metric은 delta/cumulative 선택, active set 계산, memory budget, backend series 증가량, rollback 조건을 review한다."
learning_refs:
  - title: "메트릭 카디널리티 예산과 라벨 거버넌스"
    href: "/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/"
    description: "label owner, 허용 차원, 비용과 PII 경계를 metric 설계 단계에 넣는 기본 기준입니다."
  - title: "OpenTelemetry 선언적 구성과 버전 계약"
    href: "/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/"
    description: "View·processor·exporter 정책을 환경변수 묶음이 아니라 검증 가능한 artifact로 운영하는 방법입니다."
  - title: "Observability FinOps와 Telemetry Pipeline"
    href: "/posts/2026-03-20-observability-finops-telemetry-pipeline-trend/"
    description: "수집량·저장비용과 관측 품질을 함께 판단하는 운영 관점입니다."
  - title: "구조화 로그 설계"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "metric에 담기 부적합한 고유 식별자와 상세 오류를 trace·log로 보내는 분리 기준입니다."
decision_guide:
  title: "overflow가 발견됐을 때의 우선순위"
  intro: "첫 질문은 ‘limit을 몇으로 늘릴까’가 아니라, 이 metric의 어떤 속성별 수치가 실제 의사결정에 쓰이며 그 수치가 불완전해졌을 때 무엇이 위험한가입니다."
  cases:
    - badge: "즉시 조치"
      title: "overflowed metric이 paging SLO, autoscaling, 결제·보안 경보의 group-by에 쓰인다"
      fit: "속성별 오류율·queue depth·tenant SLA가 실제 승인이나 자동화의 입력인 경우입니다."
      watchouts: "총합이 정상이라는 이유로 route·tenant·status별 하락을 무시하면 문제가 조용히 가려집니다."
      next_step: "자동 확대를 잠시 보수적으로 낮추고, offending attribute 제거 또는 bounded View를 canary합니다."
    - badge: "계획 조정"
      title: "정당한 tenant·customer dimension을 가진 내부 운영 metric이다"
      fit: "active tenant 집합이 계산 가능하고 개별 tenant SLO가 계약상 필요한 경우입니다."
      watchouts: "delta temporality라도 pod 수와 collection cycle이 늘면 backend series는 빠르게 증가합니다."
      next_step: "active set 산정, headroom, process memory, ingest bytes를 같은 canary gate에 넣습니다."
    - badge: "보류 또는 제거"
      title: "metric의 속성별 결과를 실제로 읽는 사람이 없고 raw identifier만 붙어 있다"
      fit: "debug 편의를 위해 request ID, full URL, 예외 메시지 등을 metric에 넣은 경우입니다."
      watchouts: "limit을 높이면 값비싼 진단 데이터를 장기 metric store로 옮길 뿐입니다."
      next_step: "속성을 drop하고 correlation ID는 trace·구조화 log에서 찾도록 dashboard 링크를 바꿉니다."
faqs:
  - question: "overflow가 나면 measurement가 유실되나요?"
    answer: "값은 overflow data point에 합쳐지므로 총합은 유지됩니다. 하지만 original measurement attribute가 제거되므로 속성별 filter와 group-by는 undercount할 수 있습니다."
  - question: "limit을 2,000에서 20,000으로 올리면 해결되나요?"
    answer: "의도한 bounded dimension이 2,000을 조금 넘는다면 가능하지만, raw path나 request ID처럼 unbounded attribute라면 memory 보호를 늦출 뿐 근본 해결이 아닙니다. attribute 모델과 View를 먼저 검토해야 합니다."
  - question: "SDK의 2,000 제한이면 backend도 series 2,000개 이하인가요?"
    answer: "아닙니다. 제한은 stream·process·collection 동작에 관련된 SDK 보호 장치입니다. 여러 pod와 delta collection cycle에서 서로 다른 조합이 나오면 backend series는 훨씬 많아질 수 있습니다."
---

관측성에서 cardinality는 흔히 “비용이 비싸다”는 말로만 설명됩니다. 하지만 최근 OpenTelemetry의 metric cardinality limit 정리는 더 불편한 운영 사실을 드러냅니다. SDK가 너무 많은 attribute 조합으로부터 process memory를 지켜 주어도, 그 순간부터 **속성별로 쪼갠 수치가 완전하다는 보장은 사라질 수 있다**는 점입니다.

2026년 8월 OpenTelemetry는 SDK의 cardinality limit과 overflow 동작을 실무 관점에서 설명했습니다. 기본 aggregation cardinality limit은 metric stream당 2,000개 조합입니다. limit을 넘는 measurement는 버려지지 않고 overflow data point로 합쳐집니다. 그래서 전체 요청 수는 맞을 수 있습니다. 그러나 원래의 measurement attribute는 모두 빠지므로 route별 5xx, tenant별 실패율, status별 요청 수처럼 filter 또는 group-by한 결과는 실제보다 작아질 수 있습니다.

이는 chart 한 장의 표기 문제가 아닙니다. SLO burn rate, autoscaling, 보안 탐지, 고객별 SLA처럼 dimension을 기준으로 행동을 바꾸는 시스템은 “총합은 정확하다”만으로 안전하지 않습니다. 이 글은 [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/), [OpenTelemetry 선언적 구성과 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/), [Observability FinOps와 Telemetry Pipeline](/posts/2026-03-20-observability-finops-telemetry-pipeline-trend/), [구조화 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)을 잇습니다. 앞선 글이 비용과 설정을 다뤘다면, 여기서는 metric breakdown을 데이터 품질 계약으로 운영하는 기준을 다룹니다.

공식 자료:

- [OpenTelemetry: Metric cardinality limits in practice](https://opentelemetry.io/blog/2026/cardinality-limits-in-opentelemetry/)
- [OpenTelemetry Metrics SDK specification: Cardinality limits](https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits)
- [OpenTelemetry Metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)

## 이 글에서 얻는 것

- cardinality limit이 무엇을 제한하고 무엇을 제한하지 않는지 구분합니다.
- overflow가 total은 보존하지만 어떤 이유로 breakdown과 SLO 판정을 왜곡할 수 있는지 이해합니다.
- cumulative·delta temporality에 따라 의도한 고카디널리티 metric의 한계를 산정합니다.
- attribute 모델, View, alert, canary를 통해 overflow를 숨기지 않고 운영 판단에 드러내는 방법을 배웁니다.

## 핵심 개념/이슈

### 1) cardinality는 attribute 하나가 아니라 조합 수다

metric의 각 data point는 instrument 이름 하나로만 만들어지지 않습니다. measurement에 붙은 전체 attribute set의 고유한 조합마다 별도 aggregation state가 필요합니다. 예를 들어 http.server.request.count에 route 100개, method 5개, success 2개가 있으면 최대 1,000개 조합입니다. 여기에 tenant_id 5,000개를 넣으면 이론상 조합 수는 갑자기 500만이 됩니다. 실제 traffic에서는 모든 조합이 동시에 나타나지 않을 수 있지만, “tenant 하나만 추가했다”는 생각으로는 위험을 판단할 수 없습니다.

~~~text
expected combinations
  = active routes × methods × status buckets × active tenants × other kept dimensions
~~~

OpenTelemetry SDK의 기본 limit 2,000은 metric stream이 process memory를 무한히 쓰지 않도록 하는 안전장치입니다. View에 stream별 aggregation_cardinality_limit을 두거나 MetricReader default를 정할 수 있지만, 숫자를 모르고 크게 바꾸는 것은 circuit breaker의 임계값을 없애는 일과 비슷합니다. limit은 backend ingestion quota도 아니고 fleet 전체의 active series quota도 아닙니다.

| 범위 | 2,000 default가 직접 제한하는가 | 운영자가 별도로 봐야 할 것 |
| --- | --- | --- |
| 한 SDK metric stream의 aggregation state | 예 | language SDK 구현과 stream별 override |
| 한 process가 export하는 현재 data point | temporality에 따라 영향 | active attribute set과 collection 주기 |
| cluster 전체 backend series | 아니오 | pod 수, rollout, retention, backend indexing |
| log·trace의 attribute cardinality | 아니오 | 별도 storage·sampling·redaction 정책 |

특히 1,000개 pod가 각각 한 stream에서 2,000개 조합을 다루면 backend는 시간에 따라 훨씬 많은 series를 볼 수 있습니다. delta temporality에서는 collection cycle마다 다른 조합이 export될 수 있기 때문입니다. SDK limit 통과를 cost gate 통과로 해석하면 안 되는 이유입니다.

### 2) overflow는 값을 버리지 않지만 attribute의 의미를 접는다

limit을 넘긴 measurement는 일반적으로 otel.metric.overflow=true attribute만 가진 synthetic data point에 합쳐집니다. 원래 measurement에 있던 route, method, status, tenant 같은 attribute는 모두 남지 않습니다. 이 동작은 합계의 정합성을 지키는 대신, 추가 조합을 특정 dimension으로 분류할 수 없게 만듭니다.

~~~text
정상 measurement:
  {route="/checkout", success=false, tenant="t-42"} 1

overflow 뒤 exported point:
  {otel.metric.overflow=true} 1
~~~

아래 두 쿼리의 신뢰도는 다릅니다.

| 쿼리 | overflow 뒤 해석 | 위험 |
| --- | --- | --- |
| 전체 요청 수 | overflow 값을 포함하면 total은 유지될 수 있음 | overflow point 자체를 필터에서 빼지 않아야 함 |
| success=false 요청 수 | overflow에 success가 없으므로 undercount 가능 | 오류율·SLO가 좋아 보일 수 있음 |
| route별 p95 latency | route가 제거된 지점은 어떤 route에도 귀속 불가 | 병목 route를 놓칠 수 있음 |
| tenant별 rate | tenant가 제거된 지점은 개별 tenant 수치에서 사라짐 | 계약 SLA·quota 판정 왜곡 |

중요한 점은 “문제를 만든 한 attribute만 사라진다”가 아니라 **그 measurement의 모든 attribute가 사라진다**는 것입니다. raw URL이 overflow의 원인이어도 success=false나 region=kr 같은 low-cardinality dimension까지 해당 data point에서 조회할 수 없습니다. 이 때문에 overflow는 capacity warning이면서 동시에 breakdown completeness warning입니다.

Resource attribute는 measurement attribute와 다릅니다. service.name, deployment.environment, k8s.namespace처럼 producing entity를 설명하는 resource attribute는 overflow data point에서도 남아 query scope를 정하는 데 쓸 수 있습니다. 그러나 이를 tenant_id나 request_id를 resource에 옮기는 우회로로 사용하면 안 됩니다. resource는 process 또는 entity의 정체성이고, 요청별 값은 measurement·trace·log에 맞게 나눠야 합니다.

### 3) temporality는 high-cardinality dimension의 생존 기간을 바꾼다

같은 tenant_id dimension이라도 cumulative와 delta aggregation에서 위험이 다릅니다. cumulative는 process가 본 조합을 시간에 따라 계속 유지할 수 있으므로, 활동 tenant가 매일 바뀌면 결국 lifetime population에 가까워집니다. 반면 delta는 collection cycle에서 관측한 active set을 기준으로 state가 회전할 수 있어, 한정된 동시 활동 집합을 가진 경우 현실적인 선택지가 됩니다.

예를 들어 100만 tenant가 있지만 60초마다 실제 요청을 만드는 tenant가 최대 5,000개이고 success 값 두 개만 유지한다면, 단순 출발 추정은 5,000 × 2 = 10,000 조합입니다. 여기에 method·route를 계속 붙이면 다시 증가합니다. 따라서 2,000 기본값을 10,000보다 약간 크게 바꾸기 전에 다음을 확인해야 합니다.

- pod 하나가 실제로 보는 active tenant가 5,000개인지, shard·sticky routing 때문에 더 많은지
- collection interval 동안 burst가 얼마나 큰지와 목표 headroom이 얼마인지
- 이 metric이 latency histogram이라면 combination마다 필요한 aggregation state와 exemplar 메모리가 얼마나 되는지
- 새 limit이 pod 수와 함께 backend ingest bytes·series churn을 얼마나 늘리는지
- overflow가 보이면 어떤 config version으로 몇 분 안에 rollback할지

초기에는 예상 active set의 1.2~1.5배 정도를 headroom 후보로 놓고, memory와 ingest를 함께 canary하는 편이 낫습니다. 이는 universal default가 아니라 추정 오차를 드러내기 위한 출발선입니다. unbounded identifier를 가진 metric은 10배 headroom도 해결책이 아닙니다.

### 4) 2026년의 핵심 변화는 “더 많이 수집”에서 “분해 결과의 신뢰도 표기”로 이동한다

기존 telemetry 운영은 attribute를 줄여 비용을 낮추는 데 집중했습니다. 이번 guidance가 던지는 더 실무적인 질문은 “이 dashboard의 group-by가 완전한가?”입니다. total request count가 정상이어도 특정 route의 5xx가 overflow로 접히면 incident triage와 error budget은 잘못된 우선순위를 가질 수 있습니다.

따라서 metric consumer를 세 등급으로 나누는 편이 좋습니다.

| 소비처 | overflow 발견 시 기본 행동 | 이유 |
| --- | --- | --- |
| paging SLO·보안·autoscaling | page 또는 자동 action 보수화 | 불완전한 breakdown이 실제 영향·용량 결정을 왜곡 |
| 운영 dashboard·weekly review | ticket + owner triage | 추세 분석은 가능하지만 root-cause 범위가 불완전 |
| 탐색·debug metric | backlog로 분류 | 비용과 개선 우선순위를 비교 가능 |

이 분류는 [Observability FinOps와 Telemetry Pipeline](/posts/2026-03-20-observability-finops-telemetry-pipeline-trend/)의 비용 모델을 품질 모델로 확장합니다. byte가 싼 metric도 의사결정 입력이면 불완전성을 알려야 합니다. 반대로 아무도 읽지 않는 high-cardinality breakdown이라면 backend 비용뿐 아니라 운영자의 오해 비용도 큽니다.

## 실무 적용

### 1) limit 변경 전에 metric dimension inventory를 만든다

카디널리티 장애의 첫 조치는 configuration 파일을 찾는 일이 아니라 metric의 의도를 묻는 일입니다. 핵심 metric마다 아래 다섯 줄을 작성하세요.

~~~yaml
metric_contract:
  name: "http.server.request.count"
  decision: "route별 5xx paging, service 전체 traffic dashboard"
  measurement_attributes: ["http.route", "http.request.method", "error.type"]
  expected_active_combinations: "120 routes × 5 methods × 12 error buckets = 7,200"
  excluded_attributes: ["url.full", "request.id", "enduser.id", "exception.message"]
  owner: "payments-platform"
~~~

여기서 error.type도 free-form exception message가 아니라 제한된 error code family여야 합니다. raw URL은 route template으로, user input은 bounded category로, request ID와 session ID는 trace·log correlation key로 이동합니다. [구조화 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)가 필요한 이유도 여기에 있습니다. 디버깅에 유용한 값과 metric aggregation에 적합한 값은 같지 않습니다.

metric contract에는 consumer도 써야 합니다. tenant별 failure rate가 계약 SLA라면 high cardinality라는 이유만으로 지우면 안 됩니다. 대신 tenant가 실제로 활성화되는 시간·pod별 분포·delta support·backend retention을 계산해 의도한 비용으로 승격해야 합니다. 아무 consumer가 없는 tenant breakdown은 제거 후보입니다.

### 2) View는 마지막 방어막이 아니라 policy artifact로 운영한다

OpenTelemetry View는 특정 instrument에 남길 attribute key를 allowlist로 지정하거나 aggregation을 바꾸고, 필요하면 instrument를 drop할 수 있습니다. upstream library가 원하지 않는 attribute를 붙였을 때 빠른 보호 장치가 됩니다. 그러나 View로 attribute를 제거해도 exemplar가 filtered attribute를 보존할 수 있는 SDK 동작은 별도로 점검해야 합니다. 민감값을 제거했다는 설정만 보고 trace 연결용 exemplar에 남지 않는다고 가정하면 안 됩니다.

예를 들어 먼저 bounded server metric만 남기는 정책은 다음처럼 생각할 수 있습니다.

~~~yaml
metric_view_policy:
  selector:
    instrument: "http.server.request.duration"
  keep_measurement_attributes:
    - "http.route"
    - "http.request.method"
    - "http.response.status_code"
    - "error.type"
  aggregation_cardinality_limit: 12000
  rollout: "staging -> 5% pods -> 24h -> production"
~~~

숫자 12,000은 예시일 뿐이고, contract로 계산한 예상 조합과 canary 결과가 근거여야 합니다. 더 좋은 순서는 upstream instrumentation의 raw value를 고치고, View로 보호하고, metric name·attribute·limit·exporter policy를 [OpenTelemetry 선언적 구성과 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/)처럼 reviewable artifact에서 관리하는 것입니다.

### 3) overflow signal을 차트와 alert의 일부로 만든다

Prometheus-compatible exporter는 dot을 underscore로 바꿔 overflow attribute를 otel_metric_overflow="true" label로 노출할 수 있습니다. 실제 이름은 exporter와 backend mapping을 확인해야 하지만, baseline 검사는 아래 모양으로 시작할 수 있습니다.

~~~promql
count by (__name__, job) (
  last_over_time({otel_metric_overflow="true"}[5m])
) > 0
~~~

이 쿼리는 “어떤 metric·service에서 최근 overflow가 있었는가”를 찾는 출발점입니다. retention을 길게 잡은 전사 query는 비쌀 수 있으므로 cluster, namespace, service 같은 resource label로 먼저 범위를 좁히세요. OTLP-native backend에서는 같은 의미의 overflow attribute filter를 사용합니다.

핵심 dashboard에는 breakdown chart 바로 옆에 overflow badge를 둡니다. 예를 들어 route별 error rate table에 “최근 5분 overflow 없음”을 함께 보여야, on-call이 낮은 route error를 사실로 오인하지 않습니다. paging SLO에 overflow가 생겼다면 깨끗한 breakdown을 기다리며 alert를 끄기보다, total·trace·log·synthetic probe를 함께 보고 자동 scale-down 또는 자동 close 같은 action을 보수화해야 합니다.

### 4) canary는 data volume과 data completeness를 같이 본다

새 attribute나 limit은 staging에서 정상 요청만 보내서는 충분히 검증되지 않습니다. raw path fallback, error message 다양화, tenant burst, route explosion처럼 실제 overflow를 만드는 fixture를 준비하세요. rollout gate에는 아래를 같이 둡니다.

| gate | 통과 판단 예시 | 실패 시 첫 행동 |
| --- | --- | --- |
| overflow 발생 | critical metric에서 0건 | attribute model·View 재검토 |
| process memory | baseline 대비 p95 10% 이내 | limit rollback 또는 aggregation 축소 |
| ingest bytes·series | 사전 합의한 budget 안 | dimension·pod 수·retention 재산정 |
| SLO query | expected fixture count와 일치 | breakdown consumer 중지·query 수정 |
| exemplar 검사 | 금지 attribute 0건 | exemplar filter·redaction 수정 |

canary 중 overflow가 0이라고 해서 완전성을 증명하는 것은 아닙니다. traffic shape가 작았을 수 있고, 사용하는 SDK가 해당 limit을 다르게 구현했을 수 있으며, backend mapping이 overflow attribute를 보이지 않게 했을 수 있습니다. 그래서 limit fixture, process self-metric, backend query, SLO result를 함께 보아야 합니다.

## 트레이드오프/주의점

첫째, 낮은 limit은 accidental cardinality leak을 빨리 보이게 하고 memory를 보호하지만, 정상적인 dimension까지 overflow로 접어 breakdown을 불완전하게 만들 수 있습니다. 높은 limit은 유효한 breakdown을 오래 유지하지만, unbounded attribute의 폭발을 더 늦게 발견하고 memory·ingest 비용을 키웁니다. 목표는 overflow를 절대 0으로 만들기가 아니라, **드물고 의미 있으며 관측 가능한 신호**로 두는 것입니다.

둘째, delta temporality는 high-cardinality active set을 다루는 데 도움을 줄 수 있지만 backend cost의 면죄부가 아닙니다. collection cycle마다 새 조합이 나타나면 backend에는 series churn이 생기고, pod 수가 늘면 같은 estimate가 여러 번 곱해집니다. delta로 바꿀 때는 query semantics, reset 처리, backend aggregation, alert baseline도 함께 검증해야 합니다.

셋째, resource attribute에 high-cardinality 값을 옮기는 것은 해결책이 아닙니다. overflow에서 resource attribute가 남는다는 사실을 이용해 user_id나 request ID를 resource에 넣으면 process identity와 request identity가 섞이고, 다른 signal의 비용·보안 문제가 커집니다. 값의 질문에 따라 metric·trace·log·audit record 중 맞는 집을 고르세요.

넷째, View는 강력하지만 semantic contract를 바꿉니다. 플랫폼 팀이 attribute를 제거하면 서비스 팀의 기존 dashboard가 조용히 깨질 수 있습니다. View diff에는 어떤 chart, SLO, alert가 영향을 받는지와 fallback query를 포함하고, 5% canary 뒤 최소 24시간의 업무 traffic을 비교해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 핵심 metric의 measurement attribute, resource attribute, expected active combination, owner, consumer를 inventory화했다.
- [ ] raw URL, request ID, session ID, user input, raw error message가 metric attribute에 없는지 검사한다.
- [ ] SDK·exporter·backend에서 overflow attribute가 실제로 어떻게 보이는지 staging query로 확인했다.
- [ ] SLO·autoscaling·보안 alert가 의존하는 breakdown 옆에 overflow 상태를 표시한다.
- [ ] intentional high-cardinality metric은 temporality, active set, headroom, memory, ingest budget, rollback 기준을 가진다.
- [ ] View의 attribute allowlist와 exemplar의 민감 attribute 보존 여부를 함께 검증했다.
- [ ] overflow가 난 metric은 limit만 올리기 전에 attribute 모델과 실제 consumer를 먼저 검토한다.

### 연습

1. 서비스 하나에서 최근 24시간의 overflow metric을 metric name·service로 group-by해 보세요. 결과가 없으면 exporter mapping과 SDK support도 함께 기록합니다.
2. request.id를 붙인 test counter와 route template만 붙인 counter를 같은 부하에서 실행해, 언제 overflow가 생기고 어떤 query가 undercount하는지 비교하세요.
3. route별 5xx SLO 하나를 골라 overflow point를 포함한 total, route별 breakdown, trace 기반 오류 수를 비교하고, overflow가 발생한 뒤 자동 action을 어떻게 보수화할지 문서화하세요.
