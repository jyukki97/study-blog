---
title: "백엔드 커리큘럼 심화: Trace Sampling Policy와 Tail Sampling 운영 플레이북"
date: 2026-07-17
draft: false
topic: "Observability"
tags: ["Distributed Tracing", "OpenTelemetry", "Tail Sampling", "Observability", "SRE", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "운영 환경에서 모든 trace를 저장하지 않고도 장애 원인, 느린 요청, 고위험 경로의 증거를 남기기 위한 head sampling, tail sampling, 정책 테이블, 비용 기준을 정리합니다."
summary: "Trace sampling은 저장 비용을 줄이는 스위치가 아니라 장애 증거 예산을 어디에 쓸지 정하는 정책입니다. 기본 비율, 에러 100%, 느린 요청 우선, 고위험 경로 상향, Collector 중앙 정책을 함께 설계해야 합니다."
module: "ops-observability"
study_order: 1470
key_takeaways:
  - "운영 trace sampling은 랜덤 비율 하나가 아니라 endpoint, status, latency, tenant, release phase, risk class를 반영한 증거 수집 정책이다."
  - "Head sampling은 비용을 빨리 줄이지만 늦게 드러나는 에러와 tail latency를 놓치기 쉽고, tail sampling은 증거 품질이 좋지만 Collector 메모리와 decision delay를 요구한다."
  - "실무 목표는 전체 trace 100% 저장이 아니라 error trace coverage, slow trace coverage, root span missing rate, sampling policy drift를 숫자로 관리하는 것이다."
operator_checklist:
  - "운영 기본 head sampling은 1~5%에서 시작하고, 5xx·timeout·retry exhausted·보안/결제 경로는 별도 상향한다."
  - "Collector tail sampling decision wait, expected traces per second, memory limit, dropped span rate를 capacity test로 확인한다."
  - "배포 직후 15~30분, incident window, 특정 tenant 장애 조사 때 sampling override를 적용하고 만료 시간을 둔다."
learning_refs:
  - title: "분산 추적 심화"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-advanced/"
    description: "TraceId, SpanId, propagation, Zipkin/Jaeger 분석의 기반 개념입니다."
  - title: "OpenTelemetry 실무"
    href: "/learning/deep-dive/deep-dive-opentelemetry/"
    description: "OpenTelemetry SDK, Collector, exporter 구성의 기본 흐름입니다."
  - title: "Observability Baseline"
    href: "/learning/deep-dive/deep-dive-observability-baseline/"
    description: "로그, 메트릭, trace, exemplar를 운영 기준으로 묶는 글입니다."
  - title: "Metric Cardinality Budget"
    href: "/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/"
    description: "관측 데이터 비용과 label/cardinality 예산을 관리하는 기준입니다."
decision_guide:
  title: "Trace Sampling을 어떻게 시작할까"
  intro: "모든 서비스에 같은 sampling 비율을 주면 비용은 줄어도 중요한 증거가 사라질 수 있습니다. 트래픽 규모, 장애 분석 요구, 저장소 비용, 고위험 경로를 기준으로 단계 적용해야 합니다."
  cases:
    - badge: "Head 우선"
      title: "초기 도입, 낮은 트래픽, Collector 운영 경험 부족"
      fit: "요청량이 크지 않고, 우선 propagation 누락과 기본 span 구조를 확인해야 하는 단계입니다."
      watchouts: "에러가 응답 끝에서 결정되거나 latency가 긴 요청은 sampling 전에 버려질 수 있습니다."
      next_step: "운영 기본 1~5%, staging 100%, error log와 trace id 연결부터 맞춥니다."
    - badge: "Tail 필요"
      title: "p95/p99 지연, 5xx, retry exhaustion 증거가 자주 사라진다"
      fit: "느린 요청과 실패 요청을 반드시 보존해야 하고, 트래픽이 많아 전체 저장은 불가능한 서비스입니다."
      watchouts: "Collector가 trace를 decision wait 동안 들고 있어야 하므로 메모리와 dropped span을 먼저 검증해야 합니다."
      next_step: "5xx 100%, duration 1초 초과 100%, 나머지 1~3% 같은 혼합 정책으로 시작합니다."
    - badge: "보류 가능"
      title: "단일 서비스 또는 요청량이 매우 작은 내부 도구"
      fit: "하루 요청 수가 작고 저장 비용이 문제되지 않으며 장애 분석도 단순한 경우입니다."
      watchouts: "나중에 배치나 파트너 트래픽이 붙으면 100% 수집이 갑자기 비용 사고가 될 수 있습니다."
      next_step: "현재는 100%를 유지하되 저장 보존 기간과 개인정보 필터를 먼저 고정합니다."
faqs:
  - question: "운영에서 trace를 100% 저장하면 가장 안전하지 않나요?"
    answer: "분석 증거는 많아지지만 저장소 비용, network overhead, 개인정보 노출면, UI 검색 성능이 같이 악화됩니다. 보통은 중요한 trace를 100% 보존하고 일반 성공 요청은 낮은 비율로 수집하는 편이 운영성이 좋습니다."
  - question: "Tail sampling을 쓰면 head sampling은 필요 없나요?"
    answer: "대체라기보다 역할이 다릅니다. SDK head sampling으로 전체 유입량을 줄이고, Collector tail sampling으로 에러와 느린 요청을 보존하는 혼합 구조가 흔합니다. 단, head에서 버린 trace는 tail에서 살릴 수 없습니다."
---

분산 추적을 처음 붙이면 가장 먼저 드는 생각은 "가능하면 전부 저장하자"입니다. 개발 환경에서는 맞는 말입니다. 모든 요청을 봐야 propagation 누락, span 이름, tag 설계를 빨리 고칠 수 있습니다. 하지만 운영 환경에서는 이야기가 달라집니다. 공개 API, 배치, 메시지 컨슈머, 내부 fan-out 호출을 모두 trace로 저장하면 저장소 비용과 네트워크 비용이 먼저 튀고, 정작 장애 때 UI는 너무 많은 trace 속에서 느려집니다.

반대로 sampling 비율을 무작정 1%로 낮추면 장애 증거가 사라집니다. 5xx가 난 요청, p99 지연 요청, retry를 모두 소진한 요청, 결제나 권한 변경처럼 위험한 요청이 랜덤하게 버려질 수 있습니다. 그래서 trace sampling은 비용 절감 스위치가 아니라 **장애 증거 예산을 어디에 쓸지 정하는 정책**으로 봐야 합니다. 이 글은 [분산 추적 심화](/learning/deep-dive/deep-dive-distributed-tracing-advanced/), [OpenTelemetry](/learning/deep-dive/deep-dive-opentelemetry/), [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/), [Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)과 이어집니다.

## 이 글에서 얻는 것

- head sampling과 tail sampling의 차이를 비용, 증거 품질, 운영 부담 관점에서 구분할 수 있습니다.
- endpoint, status code, latency, tenant, release phase, risk class별 sampling 정책을 설계하는 기준을 가져갑니다.
- OpenTelemetry Collector를 중앙 sampling 계층으로 둘 때 필요한 메모리, decision wait, dropped span 지표를 정리합니다.
- "trace를 얼마나 저장했나"가 아니라 "중요한 trace를 얼마나 놓치지 않았나"를 측정하는 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Sampling은 랜덤 절약이 아니라 증거 우선순위다

가장 단순한 설정은 `sampling.probability=0.01`처럼 모든 요청을 1%만 저장하는 방식입니다. 이 방식은 빠르게 비용을 줄입니다. 하지만 모든 요청의 가치가 같다는 가정이 숨어 있습니다. 운영에서는 그렇지 않습니다. 성공한 health check와 결제 승인 실패, 20ms 캐시 hit와 7초 걸린 search query, 일반 조회와 관리자 권한 변경은 같은 1건이 아닙니다.

정책은 아래처럼 위험과 분석 가치를 반영해야 합니다.

| 요청 유형 | 권장 시작점 |
| --- | --- |
| 일반 2xx read API | 1~5% |
| 고트래픽 health check | 0~0.1%, 별도 synthetic 지표로 대체 |
| 4xx validation error | 1~3%, 단 abuse 후보는 별도 보존 |
| 5xx, timeout, retry exhausted | 100% |
| p95 목표의 2배 이상 느린 요청 | 100% |
| 결제, 인증, 권한, 데이터 export | 10~30%, 실패는 100% |
| 배포 직후 canary window | 15~30분 동안 10~50% 상향 |

이 숫자는 정답이 아니라 출발점입니다. 중요한 것은 "운영자가 장애 때 필요한 trace가 저장되어 있는가"입니다. 전체 저장률이 2%여도 5xx trace coverage가 98%라면 좋은 정책일 수 있습니다. 반대로 전체 저장률이 20%인데 timeout trace가 거의 없으면 잘못된 정책입니다.

### 2) Head sampling은 빠르지만 결과를 모르고 결정한다

Head sampling은 요청 초반, 보통 SDK나 ingress에서 trace를 저장할지 결정합니다. 장점은 단순합니다. 애플리케이션과 Collector가 처리해야 할 span 수가 줄고, 저장소 비용이 예측 가능합니다. 초기 도입과 낮은 트래픽 서비스에는 충분히 좋습니다.

약점은 결정 시점입니다. 요청이 성공할지, 3초 뒤 timeout이 날지, downstream retry가 모두 실패할지 아직 모릅니다. 그래서 head에서 버린 trace는 나중에 에러가 나도 복구할 수 없습니다. 결제 API에서 실패 trace가 자주 사라지거나, "가끔 느린데 trace가 없다"는 말이 반복되면 head sampling만으로는 부족합니다.

Head sampling을 유지한다면 보완책이 필요합니다.

- 에러 로그에는 반드시 `trace_id`를 남깁니다.
- 중요 endpoint는 기본 비율을 일반 endpoint보다 높입니다.
- 배포 직후나 incident window에는 임시 override를 둡니다.
- root span missing rate를 측정해 propagation 누락과 sampling 누락을 분리합니다.

### 3) Tail sampling은 결과를 보고 고르지만 운영 비용이 있다

Tail sampling은 trace가 어느 정도 모인 뒤 결정합니다. Collector가 root span duration, status code, span attribute, error event를 보고 저장 여부를 고릅니다. 그래서 "느린 요청은 100%", "5xx는 100%", "일반 성공은 2%" 같은 정책을 만들 수 있습니다.

대신 Collector는 decision wait 동안 span을 들고 있어야 합니다. trace가 초당 5,000개 들어오고 decision wait이 10초라면, Collector는 대략 50,000개 trace의 중간 상태를 관리해야 합니다. span 수가 많은 fan-out 서비스라면 메모리 압박이 빠르게 커집니다. Tail sampling은 정책 품질이 좋은 대신 capacity planning이 필요한 기능입니다.

초기 기준:

- decision wait: 5~10초에서 시작, 장기 batch trace는 별도 경로로 분리
- Collector memory limit: 평시 사용량의 2배 이상 여유
- dropped span rate: 0.1% 초과 5분 지속 시 경고
- late span 비율: 1% 초과면 decision wait 또는 exporter 지연 재검토
- sampling policy reload 실패: fail-open인지 fail-closed인지 명확히 결정

### 4) Sampling 정책은 코드가 아니라 중앙 운영 계약이어야 한다

서비스마다 SDK 설정으로 sampling을 흩어두면 운영자가 전체 정책을 보기 어렵습니다. 어느 서비스는 10%, 어느 서비스는 0.1%, 어느 서비스는 배포 중 100%로 남아 있을 수 있습니다. 가능하면 OpenTelemetry Collector 같은 중앙 계층에서 정책을 관리하고, 서비스 코드는 trace context 전파와 필요한 span attribute를 안정적으로 남기는 역할에 집중하는 편이 좋습니다.

단, 중앙 정책만으로 모든 것이 해결되지는 않습니다. Collector가 tail sampling을 하려면 애플리케이션이 필요한 attribute를 span에 넣어야 합니다. 예를 들어 `http.route`, `http.status_code`, `deployment.environment`, `service.version`, `tenant.tier`, `risk.class`, `error.type` 같은 필드가 없으면 정책이 거칠어집니다. 이 필드는 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)과 같은 이름 규칙으로 맞추는 편이 분석에 좋습니다.

### 5) Sampling은 개인정보 필터가 아니다

Trace를 1%만 저장한다고 해서 민감정보 문제가 사라지지 않습니다. 운이 나쁘면 그 1%에 토큰, 이메일, 원문 SQL, 파일 경로, 고객 식별자가 들어갑니다. Sampling은 저장량을 줄일 뿐, 저장되는 데이터의 안전성을 보장하지 않습니다.

따라서 sampling 전에 redaction과 attribute budget을 정해야 합니다.

- `user.id`는 raw 값 대신 hash 또는 coarse group으로 남깁니다.
- `email`, `phone`, `access_token`, `refresh_token`, `api_key`는 span attribute 금지 목록에 둡니다.
- SQL은 raw query보다 normalized statement 또는 query digest를 우선합니다.
- `tenant_id`가 꼭 필요하면 cardinality와 보안 등급을 같이 검토합니다.
- incident용 full payload trace는 break-glass 경로와 짧은 보존 기간을 둡니다.

이 기준은 [Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)과 같습니다. 관측 데이터는 디버깅 자산이면서 동시에 비용과 보안 리스크입니다.

## 실무 적용

### 1) Sampling policy table을 먼저 만든다

코드 설정부터 바꾸지 말고 정책 표를 씁니다.

| class | 조건 | 비율 | 보존 기간 | owner |
| --- | --- | --- | --- | --- |
| default_success | 2xx, latency < p95 목표 | 2% | 7일 | platform |
| slow_request | duration > endpoint p95 target * 2 | 100% | 14일 | service owner |
| server_error | 5xx, timeout, retry exhausted | 100% | 14일 | service owner |
| auth_payment_write | 인증·결제·권한 write | 20%, 실패 100% | 30일 | security/platform |
| canary_release | 새 버전 배포 후 30분 | 20~50% | 7일 | release owner |
| health_check | `/healthz`, `/readyz` | 0.1% 이하 | 3일 | platform |

이 표가 있어야 비용 증가나 증거 누락이 생겼을 때 무엇을 조정할지 보입니다. 특히 보존 기간은 sampling 비율만큼 중요합니다. 에러 trace를 100% 저장해도 24시간 뒤 삭제되면 주간 장애 분석에는 쓸 수 없습니다.

### 2) Collector 정책은 작은 규칙부터 시작한다

초기 tail sampling은 복잡하게 시작하지 않는 편이 좋습니다.

```yaml
tail_sampling:
  decision_wait: 10s
  num_traces: 50000
  policies:
    - name: keep-server-errors
      type: status_code
      status_code:
        status_codes: [ERROR]
    - name: keep-slow-requests
      type: latency
      latency:
        threshold_ms: 1000
    - name: keep-high-risk-routes
      type: string_attribute
      string_attribute:
        key: risk.class
        values: ["auth", "payment", "permission", "export"]
    - name: sample-default
      type: probabilistic
      probabilistic:
        sampling_percentage: 2
```

처음부터 tenant별, route별, 버전별 규칙을 많이 넣으면 정책을 해석하기 어렵습니다. `error`, `slow`, `high-risk`, `default` 네 가지로 시작하고, 2~4주 동안 놓친 trace와 비용을 보고 세분화합니다.

### 3) 장애 대응용 override에는 만료가 있어야 한다

장애가 나면 sampling을 올리고 싶어집니다. 이때 수동으로 100%를 켠 뒤 잊어버리면 다음 달 저장소 비용으로 돌아옵니다. Override는 반드시 만료 시간을 가집니다.

권장 운영값:

- incident route override: 최대 2시간
- release canary override: 15~30분
- 특정 tenant 조사: 30~60분
- 전체 서비스 100% 수집: 기본 금지, 필요 시 15분 단위 승인
- override 종료 후 비용·dropped span·error coverage 리포트 남김

이 방식은 [SLO/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과도 연결됩니다. 관측을 더 하는 것도 예산을 쓰는 일입니다. 장애 분석 가치가 비용보다 크면 올리고, 끝나면 내려야 합니다.

### 4) 성공 지표를 저장률이 아니라 coverage로 본다

Sampling 운영 지표는 단순 저장량이 아닙니다.

| 지표 | 권장 기준 |
| --- | --- |
| error trace coverage | 95% 이상 |
| slow trace coverage | p95 목표 2배 초과 요청의 90% 이상 |
| root span missing rate | 1% 이하 |
| trace/log correlation success | 99% 이상 |
| collector dropped span rate | 0.1% 이하 |
| sampling policy drift | 선언 정책 대비 10% 이하 |
| high-cardinality attribute rejection | 증가 시 owner 리뷰 |

`error trace coverage`는 에러 로그의 trace id가 실제 trace backend에서 조회되는 비율로 계산할 수 있습니다. 이 값이 낮으면 sampling, exporter 실패, Collector drop, propagation 누락 중 하나입니다. "trace가 별로 없다"는 느낌보다 이 숫자가 훨씬 빠르게 원인을 좁혀줍니다.

## 트레이드오프/주의점

첫째, 100% 수집은 디버깅에는 편하지만 운영 기본값으로는 위험합니다. 트래픽이 작은 서비스에서는 괜찮아 보여도, 배치나 fan-out이 붙는 순간 Collector와 저장소가 관측 자체 때문에 장애를 만들 수 있습니다.

둘째, tail sampling은 만능이 아닙니다. 모든 span이 Collector에 도착해야 좋은 결정을 내릴 수 있고, decision wait보다 늦게 도착한 span은 누락될 수 있습니다. 메시지 기반 비동기 trace나 긴 batch job은 별도 정책이 필요합니다.

셋째, sampling 정책이 너무 복잡하면 운영자가 믿지 못합니다. "이 요청은 왜 저장됐고 저 요청은 왜 버려졌는가"를 설명할 수 있어야 합니다. 초반에는 규칙 4~6개 이하로 시작하는 편이 낫습니다.

넷째, trace attribute는 검색 편의와 비용이 충돌합니다. 모든 span에 `customer_id`, `order_id`, `raw_query`를 넣으면 찾기는 쉬워지지만 cardinality와 개인정보 위험이 커집니다. 운영용 key와 break-glass용 detail을 분리해야 합니다.

다섯째, sampling은 로그와 메트릭을 대체하지 않습니다. 전체 트래픽 경향은 메트릭이 보고, 개별 실행 증거는 trace가 보고, 상세 메시지는 로그가 봅니다. 셋 중 하나만으로 장애 분석을 끝내려 하면 빈틈이 생깁니다.

## 체크리스트 또는 연습

- [ ] 운영 기본 sampling 비율과 보존 기간이 서비스별로 문서화되어 있다.
- [ ] 5xx, timeout, retry exhausted trace는 100% 보존된다.
- [ ] p95 목표의 2배 이상 느린 요청은 별도 정책으로 보존된다.
- [ ] 결제, 인증, 권한, export 같은 고위험 경로는 일반 read API보다 높은 sampling 비율을 가진다.
- [ ] Collector의 memory limit, dropped span rate, queue length, exporter error가 알림으로 잡힌다.
- [ ] sampling override에는 owner, reason, 만료 시간이 있다.
- [ ] trace id가 로그에 남고, 에러 로그에서 trace backend로 99% 이상 연결된다.
- [ ] span attribute 금지 목록에 token, email, phone, raw payload, raw SQL이 들어 있다.

연습은 하나면 충분합니다. 현재 운영 중인 API 5개를 골라 `route`, `risk class`, `p95 target`, `error rate`, `current sampling`, `desired sampling`, `retention`을 표로 적어 보세요. 그다음 최근 7일의 5xx 로그 20건에서 trace backend 조회가 몇 건 성공하는지 확인합니다. 20건 중 18건 미만이면 sampling 비율보다 먼저 propagation, exporter, Collector drop을 의심해야 합니다.
