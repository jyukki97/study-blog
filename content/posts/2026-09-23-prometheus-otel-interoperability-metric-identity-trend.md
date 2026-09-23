---
title: "2026 개발 트렌드: Prometheus와 OpenTelemetry를 함께 쓸 때, 이중 수집보다 Metric Identity 계약이 먼저다"
date: 2026-09-23T10:07:00+09:00
lastmod: 2026-09-23T10:07:00+09:00
draft: false
tags: ["OpenTelemetry", "Prometheus", "Observability", "Metrics", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["Prometheus OpenTelemetry interoperability", "metric identity contract", "OTLP Prometheus migration", "metrics dual pipeline"]
description: "2026년 OpenTelemetry·Prometheus 상호운용성 조사 결과를 바탕으로, 두 생태계를 하나로 바꾸려 하기보다 metric identity·resource metadata·변환 ownership·중복 방지 기준을 운영 계약으로 만드는 방법을 정리합니다."
summary: "Prometheus와 OpenTelemetry는 이제 한쪽을 지우고 다른 쪽으로 옮기는 선택지만 남긴 관계가 아니다. 실제 현장은 exporter·receiver·SDK·relabeling을 함께 쓴다. 위험은 hybrid 자체가 아니라, 같은 비즈니스 신호가 서로 다른 이름·label·unit·temporality로 두 번 저장돼 alert와 비용과 SLO가 갈라지는 데 있다. 전환의 최소 단위는 exporter 교체가 아니라 metric identity와 query 결과의 동등성이다."
---

관측성 플랫폼을 정비할 때 "Prometheus를 OpenTelemetry로 옮길 것인가"라는 질문은 너무 단순합니다. 2026년 9월 22일 OpenTelemetry가 공개한 Prometheus 상호운용성 조사에서, 인프라 지표는 Prometheus exporter 사용이 72%, OTel receiver가 57%였고 응답자의 거의 절반은 두 방식을 함께 썼습니다. 애플리케이션 지표에서는 OTel SDK가 65%, Prometheus SDK가 52%였습니다. 즉 실제 운영의 기본형은 단일 표준으로 급히 갈아타는 모습보다 **서로 다른 수집 방식을 한 backend와 운영 규칙 안에서 공존시키는 모습**에 가깝습니다.

이 숫자를 "둘 다 설치하자"는 결론으로 읽으면 안 됩니다. 조사 표본은 Prometheus 인접 backend를 쓰는 적극적 OTel 사용자 81명이라 전체 업계를 대표하지 않으며, 도입 난이도가 낮아졌다는 신호도 특정 조직의 비용·보존·알람 품질을 보장하지 않습니다. 다만 exporter를 모두 없애야만 OTel을 도입할 수 있다는 전제는 약해졌습니다. 오늘의 핵심 질문은 **같은 서버 상태나 사용자 요청을 가리키는 지표가, 어느 파이프라인을 거쳐도 같은 의미와 같은 운영 결론에 도달하는가**입니다.

이 글은 [Metric Cardinality Budget과 Label Governance](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/), [OpenTelemetry Declarative Config 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/), [OTel Metric Cardinality Overflow](/posts/2026-09-03-opentelemetry-metric-cardinality-overflow-data-completeness-trend/), [Observability Alarm 설계](/learning/deep-dive/deep-dive-observability-alarms/)의 다음 단계입니다. 수집기를 바꾸는 기술보다, metric identity를 일관되게 소유하는 운영 기준에 초점을 둡니다.

공식 근거는 [OpenTelemetry의 2026 Prometheus 상호운용성 조사](https://opentelemetry.io/blog/2026/otel-prometheus-interoperability/), [Prometheus의 OTLP receiver 설정 문서](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#otlp), [OpenTelemetry Prometheus exporter 사양](https://opentelemetry.io/docs/specs/otel/metrics/sdk_exporters/prometheus/)을 기준으로 확인했습니다. 이 글의 임계치는 특정 제품 기본값이 아니라, hybrid 운영을 시작할 때 쓸 수 있는 보수적인 출발점입니다.

## 이 글에서 얻는 것

- Prometheus와 OpenTelemetry의 공존이 "마이그레이션 실패"가 아니라 현실적인 단계적 구조가 될 수 있는 이유를 이해합니다.
- metric name, unit, type, label/attribute, resource metadata, temporality를 하나의 identity로 관리하는 법을 배웁니다.
- scrape, OTLP push, Collector transform, recording rule의 책임 위치를 결정하는 기준을 얻습니다.
- duplicate series, 값 불일치, cardinality 증가, alert 분기를 수치로 감시하는 canary 방법을 정리합니다.

## 핵심 개념/이슈

### 1) hybrid는 예외가 아니라 기본 운영 형태가 됐다

조사에서 인프라 계측은 exporter(72%)와 OTel receiver(57%)가 함께 많이 쓰였고, 응답자의 49.4%는 Prometheus 방식과 OTel 방식을 섞어 사용했습니다. 반면 애플리케이션 계측은 OTel-style만 쓰는 응답자가 41.3%로 가장 컸습니다. 이 차이는 자연스럽습니다. node exporter, kube-state-metrics, 오래된 appliance처럼 `/metrics`가 이미 표준인 영역은 scrape를 유지하는 비용이 낮습니다. 새 서비스의 request latency, dependency, trace correlation은 SDK와 OTLP의 resource context를 함께 쓰는 편이 더 일관되기 쉽습니다.

따라서 권장 출발점은 다음과 같습니다.

| 대상 | 우선 경로 | 바꾸기 전에 확인할 것 |
| --- | --- | --- |
| Kubernetes·node·기존 exporter | Prometheus scrape 또는 Collector Prometheus receiver | scrape target, relabel, `job`/`instance` 의미가 유지되는가 |
| 신규 애플리케이션 지표 | OTel SDK → OTLP | service resource, unit, histogram·temporality, trace 연결이 정해졌는가 |
| vendor·SaaS 지표 | 제공 경로 유지 후 Collector에서 정규화 | license, ingest limit, metadata 누락, 변환 책임자가 분명한가 |
| SLO/alert 핵심 지표 | 한 논리 identity에 한 production alert source | 같은 신호의 두 alert가 서로 다른 paging을 만들지 않는가 |

"OTLP도 받고 scrape도 하니 안전하다"는 판단은 위험합니다. 같은 `http request duration`을 앱 SDK와 exporter가 모두 내보내고 backend가 둘을 구분하지 못하면, series가 두 배가 되고 percentile·error ratio·비용이 달라집니다. hybrid의 목표는 경로의 다양성이 아니라 **결과의 단일성**입니다.

### 2) metric identity는 이름 하나가 아니라 여섯 항목의 계약이다

Prometheus의 label과 OTel의 attribute는 비슷해 보여도 resource metadata를 다루는 방식, 이름 번역, export 시점이 다를 수 있습니다. 조사 응답자도 data model 통합, resource attribute·metadata, naming·formatting을 개선 과제로 꼽았습니다. 아래 여섯 항목을 하나의 registry로 관리해야 "같아 보이지만 다른 지표"를 줄일 수 있습니다.

1. **의미와 owner**: 무엇을 측정하는가? 예: API 서버가 실제로 완료한 요청의 지연. service owner와 변경 승인자는 누구인가?
2. **name과 unit**: `http.server.request.duration`인지, 변환된 Prometheus 이름인지와 초·밀리초 단위를 명시한다.
3. **instrument type**: counter, gauge, histogram 중 무엇이며 reset·aggregation을 어떻게 해석하는가?
4. **dimension**: `http.route`, status class처럼 bounded 값만 허용하고 user ID·raw URL·trace ID 같은 unbounded 값은 금지한다.
5. **resource identity**: `service.name`, environment, cluster, region, workload 같은 구분이 label로 어떻게 보존·변환되는가?
6. **pipeline provenance**: scrape/OTLP, Collector config version, transform rule, backend tenant를 기록한다.

이 여섯 항목이 없으면 대시보드에서 같은 이름이 보이더라도 비교할 수 없습니다. 예를 들어 legacy exporter의 `http_requests_total`이 framework middleware 진입 횟수이고 SDK counter가 auth·route 정규화 뒤 완료 횟수라면, 차이는 버그가 아니라 정의 차이일 수 있습니다. 이때 숫자를 억지로 맞추기보다 둘 중 어느 것이 SLI의 source of truth인지 먼저 고정해야 합니다.

### 3) resource metadata를 무작정 label로 복사하면 cardinality와 비용이 폭발한다

OTel resource에는 service, process, host, Kubernetes metadata가 많이 붙을 수 있습니다. Prometheus query에서 쓰기 편하다는 이유로 모든 resource attribute를 series label로 승격하면, pod UID·container ID·Git SHA·ephemeral node 같은 값이 시계열 수를 빠르게 늘립니다. 반대로 아무 것도 남기지 않으면 cluster나 deployment별 장애를 분리할 수 없습니다.

첫 정책은 단순하게 시작하는 편이 좋습니다. production metrics의 label allowlist를 `service`, `environment`, `cluster`, `region`, `http.route`, `status_class` 정도로 제한하고, `pod`, `container`, `instance`는 인프라·debug metric에만 허용합니다. user, order, session, raw URL, exception message, trace ID는 metric label에 넣지 않고 trace·log·exemplar·event로 보냅니다. [Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)에서 다룬 것처럼 "유용해 보이는 필드"보다 **값의 상한과 SLO 질의 필요성**을 먼저 봐야 합니다.

운영 기준 예시는 다음과 같습니다.

- 새 metric family는 배포 전 예상 active series와 label별 값 상한을 등록한다.
- 기존 baseline 대비 active series가 **20% 이상** 늘면 원인·비용·보존 기간 검토 없이는 확대하지 않는다.
- `service.name`, environment, cluster가 비어 있거나 `unknown` 비율이 **0.5%**를 넘으면 alert rollout을 보류한다.
- transform 뒤 drop·overflow·translation error는 **0.01% 미만**을 목표로 하며, 초과 시 원문 label을 더 추가하는 대신 변환 규칙을 먼저 점검한다.

### 4) 변환은 한 계층에서만 소유해야 한다

Prometheus relabeling, recording rule, OTel Collector processor, backend rule이 모두 같은 label을 바꾸기 시작하면 현재 metric의 의미를 재현하기 어렵습니다. 이번 조사에서도 Prometheus relabeling(54%)과 오픈소스 OTel Collector(53%)가 가장 흔한 처리 단계였고, vendor transform이나 custom Collector 없이 두 요소만 쓰는 "vanilla stack"이 다수였습니다. 도구가 간단하다는 뜻이지, 같은 변환을 중복해도 된다는 뜻은 아닙니다.

권장 책임 분리는 아래와 같습니다.

- **scrape 전 발견·target 선택**: Prometheus scrape config 또는 service discovery
- **수집 직후 drop·resource 정규화·민감값 제거**: Collector 또는 scrape relabel 중 한 곳
- **metric identity 변환**: versioned Collector config 한 곳에서만 수행
- **장기 집계와 SLO 계산**: PromQL recording rule 또는 backend rule 중 조직 표준 한 곳
- **dashboard alias**: 표현 편의용이며 source metric의 의미를 바꾸지 않음

예를 들어 Kubernetes label을 resource attribute로 붙이는 작업과 `service` label rename을 서로 다른 두 계층에서 처리하면 결과가 environment마다 달라집니다. 변환 규칙에는 owner, config version, 입력·출력 예시, rollback revision을 붙이고, [Declarative Config 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/)처럼 canary로 적용해야 합니다.

## 실무 적용

### 1) "이중 export"가 아니라 "이중 비교"를 먼저 한다

전환 첫 주에는 production alert를 건드리지 않습니다. 핵심 SLI 3~5개만 고르고 기존 Prometheus 결과와 candidate OTel 경로를 나란히 관찰합니다. 예를 들어 요청 수, 5xx 비율, histogram 기반 p95, queue depth, process RSS처럼 의미가 명확한 지표가 좋습니다. 새 이름을 전부 정리하려는 시도보다 한 identity가 양쪽 경로에서 어떻게 달라지는지 알아내는 것이 우선입니다.

비교표에는 최소 아래 필드를 둡니다.

| 항목 | legacy 경로 | candidate 경로 | 허용 기준 |
| --- | --- | --- | --- |
| request count | scrape exporter | OTel SDK/OTLP | 1시간 합계 차이 1% 이내 |
| 5xx ratio | recording rule | OTel histogram/counter 집계 | 0.1%p 이내 |
| p95 latency | 기존 histogram | candidate histogram | 5% 이내, bucket 경계 기록 |
| active series | Prometheus TSDB 기준 | backend/Collector 기준 | baseline +20% 이내 |
| resource completeness | `job`/`instance` | service·env·cluster | unknown 0.5% 미만 |

값이 다르면 바로 수집기를 끄지 않습니다. instrumentation point, route normalization, unit, temporality, scrape interval, reset 처리 중 어느 정의가 다른지 먼저 분류합니다. 차이 원인을 설명할 수 없는 지표는 SLO와 paging source로 승격하지 않습니다.

### 2) rollout은 service가 아니라 metric family 단위로 한다

서비스 하나를 통째로 OTLP로 옮기면 request metric, JVM/runtime metric, custom business metric, dependency metric의 실패를 구분하기 어렵습니다. metric family 단위로 진행하면 rollback과 ownership이 명확해집니다.

1. **Inventory**: 현재 scrape target, exporter, SDK, relabel/recording rule, dashboard와 alert 의존성을 목록화한다.
2. **Identity registry**: SLI 후보부터 name·unit·type·allowed dimension·resource·owner·pipeline을 등록한다.
3. **Shadow path**: 전체 traffic의 5% 이하 service 또는 1개 namespace에 candidate pipeline을 적용한다. 경로는 추가하되 paging은 기존 source만 쓴다.
4. **48시간 비교**: 주간 traffic과 batch window를 모두 포함해 count·ratio·p95·series·drop을 비교한다.
5. **Source cutover**: 허용 기준을 통과한 SLI 하나만 새 query로 전환한다. 이전 query와 alert rule은 7일 더 읽기 전용으로 보존한다.
6. **중복 제거**: 새 source가 안정된 뒤에만 중복 dashboard panel, recording rule, exporter metric을 폐기한다.

초기 확대 조건은 candidate metric의 data completeness가 99.9% 이상, 값 불일치가 위 표 기준 안, Collector/Prometheus ingest error가 0.01% 미만, active series 증가가 20% 이내인 상태가 **48시간** 지속되는 것으로 잡을 수 있습니다. 반대로 하나라도 충족하지 않으면 전환이 아니라 조사 대상으로 남깁니다.

### 3) alert와 비용은 마지막에, 그러나 반드시 연결한다

가장 위험한 상태는 dashboard에는 새 metric을 쓰지만 alert는 예전 metric을 쓰고, 비용 대시보드는 둘을 합산하는 경우입니다. 장애 때 각 화면이 다른 결론을 내리고, 정상 시에는 duplicate ingestion 비용만 조용히 쌓입니다. metric registry에 `alert_source`, `dashboard_source`, `billing_owner`, `retire_after`를 추가하면 이런 분기를 잡기 쉽습니다.

특히 error budget을 계산하는 request·error·latency는 한 release window 안에서 source를 섞지 않는 것이 좋습니다. 예를 들어 분모는 exporter counter, 분자는 SDK counter를 쓰면 route filtering과 scrape 지연이 다를 때 ratio가 왜곡됩니다. SLO를 바꿔야 한다면 이전 28일 window와 새 window를 별도로 보고, 서로의 budget을 합치지 않습니다. Alert 조건과 사용자 영향은 [Observability Alarm 설계](/learning/deep-dive/deep-dive-observability-alarms/)의 source-of-truth 원칙으로 검토합니다.

## 트레이드오프/주의점

1. **hybrid는 이행 비용을 낮추지만 데이터 경로를 늘린다.** Collector, scrape config, transform, backend가 함께 있으면 책임 경계가 더 중요해진다. "나중에 정리"는 만료일이 없으면 영구 중복이 된다.
2. **이름 번역이 의미 동등성을 보장하지 않는다.** 동일한 metric name처럼 보여도 계측 시점, unit, histogram bucket, temporality가 다르면 같은 SLI가 아니다.
3. **resource metadata는 유용하지만 무료가 아니다.** 모든 Kubernetes attribute를 label로 올리면 query 편의보다 cardinality·비용·누락 위험이 더 빨리 커질 수 있다.
4. **dual export는 재해 대비가 아니다.** 독립 failure mode가 없는 두 exporter가 같은 app process·network·credential에 묶여 있다면, 둘 다 동시에 실패할 수 있다. 이중화 목적과 비교 목적을 분리한다.
5. **조사 수치를 벤치마크로 오해하지 않는다.** 81명의 선별된 표본에서 보인 사용 비율은 도입 순서를 정하는 힌트일 뿐, 특정 기술을 채택해야 할 근거는 아니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 각 SLI에 name, unit, type, allowed dimension, resource, owner, pipeline version이 있다.
- [ ] 한 logical metric에 production alert source는 하나다.
- [ ] resource attribute를 Prometheus label로 승격하는 allowlist와 값 상한이 있다.
- [ ] relabel, Collector transform, backend rule 중 identity 변환 owner가 한 곳으로 고정돼 있다.
- [ ] candidate 경로는 48시간 동안 count·ratio·p95·series·drop 비교를 통과했다.
- [ ] duplicate metric의 retire_after와 dashboard·alert·billing 영향이 등록돼 있다.
- [ ] cardinality, unknown resource, translation error의 중단 기준이 문서화돼 있다.

### 연습

현재 서비스의 `request count` metric 하나를 고르고, 기존 Prometheus 경로와 OTel 경로의 instrument point·name·unit·label·resource·query를 한 표에 적어 보세요. 그 뒤 1시간 count, 5xx ratio, p95, active series를 48시간 비교합니다. 숫자가 맞지 않으면 transform을 더 추가하기 전에 "어느 요청을 세고 있는가"를 한 문장으로 다시 정의하세요. 이 문장이 합의되지 않으면 어떤 exporter를 선택해도 alert 품질은 좋아지지 않습니다.

## 관련 글

- [Metric Cardinality Budget과 Label Governance](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)
- [OpenTelemetry Declarative Config 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/)
- [OTel Metric Cardinality Overflow와 데이터 완전성](/posts/2026-09-03-opentelemetry-metric-cardinality-overflow-data-completeness-trend/)
- [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)
- [Observability Alarm 설계](/learning/deep-dive/deep-dive-observability-alarms/)
