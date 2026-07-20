---
title: "2026 개발 트렌드: Kubernetes Custom Metrics, 오토스케일링 기준이 CPU에서 업무 신호로 이동한다"
date: 2026-07-20T10:06:00+09:00
draft: false
tags: ["Kubernetes", "Autoscaling", "Custom Metrics", "HPA", "Platform Engineering", "Observability"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes custom metrics", "HPA", "autoscaling contract", "custom metrics exporter", "queue depth autoscaling"]
description: "Kubernetes 공식 블로그의 Custom Metrics Exporter 글과 HPA 동작 기준을 바탕으로, 오토스케일링이 CPU 사용률을 넘어 queue depth, 처리 지연, 업무량 신호를 계약으로 삼는 흐름을 정리합니다."
lastmod: 2026-07-20
summary: "Kubernetes HPA는 CPU와 메모리만으로도 시작할 수 있지만, 실제 서비스 병목은 대기열 길이, 작업 지연, 외부 API 한도, tenant별 처리량처럼 업무 신호에서 나타난다. Custom Metrics 흐름은 autoscaling을 단순 리소스 반응이 아니라 제품 SLO와 운영 계약의 문제로 바꾸고 있다."
key_takeaways:
  - "Kubernetes 공식 블로그는 2026년 7월 14일 custom metrics exporter 예제를 통해 CPU·메모리 밖의 업무 신호를 HPA 판단에 연결하는 흐름을 설명했다."
  - "HPA는 현재 metric과 목표 metric의 비율로 replica를 계산하고, 여러 metric이 있으면 가장 큰 replica 제안을 선택한다."
  - "실무 도입은 exporter를 하나 만드는 일이 아니라 metric freshness, cardinality, stabilization, scale-down 실패 조건, queue drain 목표를 함께 계약화하는 작업이다."
operator_checklist:
  - "CPU 기반 HPA로 충분한 서비스와 queue depth·oldest age·business backlog 기반 HPA가 필요한 서비스를 분리한다."
  - "custom metric은 p95 처리 지연, queue depth, oldest item age, in-flight work처럼 사용자 영향과 연결되는 지표부터 고른다."
  - "metric 수집 실패 시 scale-down을 보류하고, stale metric·고카디널리티 label·잘못된 단위가 autoscaling을 흔들지 않는지 canary로 검증한다."
learning_refs:
  - title: "Kubernetes 기본기"
    href: "/learning/deep-dive/deep-dive-kubernetes-basics/"
    description: "Pod, Deployment, Service, HPA 기본 개념을 먼저 정리합니다."
  - title: "Docker/Kubernetes Q&A"
    href: "/learning/qna/docker-kubernetes-qna/"
    description: "HPA, VPA, Cluster Autoscaler 차이를 면접형으로 확인할 수 있습니다."
  - title: "관측성 베이스라인"
    href: "/learning/deep-dive/deep-dive-observability-baseline/"
    description: "메트릭, 로그, 트레이스의 기본 운영 지표를 잡는 글입니다."
  - title: "Metric Cardinality Budget"
    href: "/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/"
    description: "custom metric label이 비용과 알람 품질을 망치지 않게 관리하는 기준입니다."
decision_guide:
  title: "custom metrics 기반 autoscaling을 언제 쓸까"
  intro: "모든 Deployment가 custom metric을 가져야 하는 것은 아닙니다. CPU가 병목을 잘 대표하면 단순한 HPA가 낫습니다. custom metric은 리소스 평균값이 사용자 대기 시간이나 backlog를 설명하지 못할 때 검토합니다."
  cases:
    - badge: "우선 검토"
      title: "큐·배치·비동기 worker"
      fit: "queue depth, oldest message age, job processing delay가 사용자 체감과 직접 연결되는 서비스"
      watchouts: "consumer 수를 늘려도 DB, 외부 API, lock이 병목이면 backlog만 더 빨리 태울 수 없다."
      next_step: "queue depth per replica와 oldest age 목표를 먼저 정한다."
    - badge: "부분 적용"
      title: "API 서버지만 CPU보다 in-flight나 p95가 먼저 흔들린다"
      fit: "I/O 대기가 많고 CPU 사용률은 낮은데 thread pool, DB pool, 외부 API 대기가 병목인 서비스"
      watchouts: "latency metric만으로 scale-out하면 느린 downstream에 더 많은 요청을 보낼 수 있다."
      next_step: "concurrency limit, rate limit, circuit breaker와 함께 설계한다."
    - badge: "보류 가능"
      title: "CPU-bound stateless API"
      fit: "CPU 사용률과 처리량이 거의 선형으로 움직이고, scale-out 시 부작용이 작은 서비스"
      watchouts: "custom metric이 오히려 운영 복잡도와 잘못된 scale event를 만들 수 있다."
      next_step: "CPU HPA와 resource request 정확도를 먼저 개선한다."
faqs:
  - question: "CPU HPA가 있으면 custom metric은 필요 없나요?"
    answer: "서비스에 따라 다릅니다. CPU가 병목을 잘 대표하면 충분합니다. 하지만 큐 기반 worker, I/O 대기형 API, GPU/외부 API 의존 서비스는 CPU보다 backlog, oldest age, in-flight work가 더 좋은 신호일 수 있습니다."
  - question: "custom metric을 만들면 자동으로 비용이 줄어드나요?"
    answer: "아닙니다. 잘못된 metric은 불필요한 scale-out과 scale-down 지연을 만들 수 있습니다. 목표값, 신선도, label cardinality, fallback 동작을 함께 검증해야 합니다."
---

Kubernetes 공식 블로그는 2026년 7월 14일 "Building a Custom Metrics Exporter for Kubernetes"를 공개했습니다. 글의 출발점은 단순합니다. Kubernetes는 CPU와 메모리 같은 리소스 신호를 기본적으로 다루지만, 실제 운영에서 스케일링 판단은 그보다 더 넓은 데이터를 요구합니다. 대기열에 메시지가 얼마나 쌓였는지, 마지막 batch가 얼마나 오래 걸렸는지, 외부 API 호출 지연이 어느 정도인지, 사용자별 작업량이 얼마나 몰리는지는 CPU 평균만으로 잘 보이지 않습니다.

이 흐름은 꽤 현실적입니다. 많은 팀이 HPA를 처음 켤 때 CPU 60~70% 같은 기준으로 시작합니다. 그런데 운영에 들어가면 이상한 일이 생깁니다. CPU는 35%인데 사용자는 오래 기다리고, worker replica를 늘렸는데 DB lock wait가 늘며 더 느려지고, queue depth가 급증했는데 HPA는 조용합니다. 리소스 metric과 사용자 영향 사이가 벌어진 것입니다.

이 글은 [Kubernetes 기본기](/learning/deep-dive/deep-dive-kubernetes-basics/), [Docker/Kubernetes Q&A](/learning/qna/docker-kubernetes-qna/), [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/), [Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)와 이어집니다. 최근 [Kubernetes AI/ML 워크로드 UI](/posts/2026-07-17-kubernetes-aiml-workload-ui-headlamp-trend/)에서 본 것처럼 플랫폼 운영은 Pod 개수만 보는 단계에서 workload의 의미를 같이 보는 단계로 이동하고 있습니다.

참고 신호:

- Kubernetes Blog, Building a Custom Metrics Exporter for Kubernetes: https://kubernetes.io/blog/2026/07/14/custom-metrics-exporter-kubernetes/
- Kubernetes Docs, Horizontal Pod Autoscaling: https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/
- Kubernetes Docs, HorizontalPodAutoscaler Walkthrough: https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/

## 이 글에서 얻는 것

- CPU·메모리 기반 HPA가 충분한 경우와 custom metric이 필요한 경우를 구분합니다.
- queue depth, oldest item age, in-flight work, p95 처리 지연을 autoscaling 계약으로 바꾸는 기준을 이해합니다.
- HPA가 metric 비율로 replica를 계산하고, 여러 metric 중 가장 큰 replica 제안을 고르는 방식을 실무 판단에 연결합니다.
- metric freshness, cardinality, scale-down stabilization, downstream 병목 같은 주의점을 점검합니다.

## 핵심 개념/이슈

### 1) CPU는 좋은 시작점이지만 모든 병목의 대표값은 아니다

CPU 기반 HPA는 단순하고 강력합니다. CPU-bound API, 이미지 변환, 압축, 계산 작업처럼 replica 수와 처리량이 대체로 함께 움직이는 서비스에는 여전히 좋은 기본값입니다. 하지만 백엔드 서비스의 많은 병목은 CPU 밖에 있습니다.

| 서비스 유형 | CPU가 놓치는 신호 | 더 가까운 scaling signal |
| --- | --- | --- |
| 메시지 consumer | backlog와 oldest message age | queue depth per replica, oldest age |
| batch worker | job duration, retry backlog | runnable job count, p95 job time |
| I/O 중심 API | DB pool wait, 외부 API latency | in-flight request, dependency wait |
| 검색·인덱싱 | shard lag, indexing queue | pending document count, lag seconds |
| AI/ML inference | GPU queue, token latency | pending requests, p95 token latency |
| multi-tenant SaaS | 특정 tenant 쏠림 | tenant tier별 backlog, fair queue depth |

CPU가 낮은데 사용자가 기다린다면 scale metric이 잘못된 것일 수 있습니다. 반대로 CPU가 높아도 scale-out이 답이 아닐 수 있습니다. DB가 이미 포화인데 API replica만 늘리면 커넥션 경쟁이 심해지고, 외부 API rate limit이 병목인데 worker를 늘리면 실패와 재시도만 늘어납니다. 그래서 custom metrics는 "더 민감하게 늘리기"가 아니라 **어떤 신호가 사용자 영향과 가장 가까운가**를 고르는 일입니다.

### 2) HPA는 metric 비율로 replica를 계산한다

Kubernetes HPA 공식 문서는 기본 계산을 현재 replica 수에 현재 metric과 목표 metric의 비율을 곱하는 방식으로 설명합니다. 쉽게 말하면 현재 평균 queue depth per pod가 목표의 2배라면 replica도 대략 2배가 필요하다고 보는 식입니다. 여러 metric을 지정하면 각 metric에서 필요한 replica 수를 계산하고, 그중 가장 큰 값을 선택합니다.

이 동작은 실무에서 중요합니다. CPU metric은 scale-down을 말하지만 queue metric은 scale-up을 말할 수 있습니다. 이때 HPA는 더 큰 replica 제안을 택하므로 backlog가 남아 있으면 줄지 않습니다. 또 일부 metric을 가져오지 못하는 상황에서 scale-down이 제안되면 HPA가 축소를 건너뛰는 동작도 있습니다. metric 수집 실패가 곧 잘못된 축소로 이어지지 않게 하는 보호 장치입니다.

의사결정으로 바꾸면 이렇습니다.

- scale-up metric은 사용자 대기와 backlog를 빠르게 반영해야 한다.
- scale-down metric은 보수적으로 안정화해야 한다.
- metric 수집 실패 시 무리한 축소보다 현재 용량 유지가 안전하다.
- 여러 metric을 섞을 때 가장 공격적인 metric이 replica를 지배할 수 있다.
- 목표값은 평균이 아니라 p95 사용자 경험과 drain 목표에서 역산해야 한다.

### 3) custom metric은 exporter보다 metric contract가 먼저다

Kubernetes 공식 블로그의 exporter 예제는 구현 접근을 보여줍니다. 하지만 실무에서 더 중요한 것은 무엇을 export할지입니다. custom metric이 잘못되면 HPA는 정확하게 틀린 결정을 합니다.

좋은 scaling metric의 조건:

1. 사용자 영향과 연결된다.
2. replica 수 변화에 반응한다.
3. 단위와 목표값이 명확하다.
4. 30~60초 안에 최신 상태를 반영한다.
5. 고카디널리티 label을 갖지 않는다.
6. scale-out이 downstream을 무너뜨리지 않는다.

예를 들어 queue worker라면 `queue_depth`만 보는 것보다 `oldest_message_age_seconds`가 더 좋은 경우가 많습니다. 메시지가 10,000개 쌓였어도 초당 5만 개 처리하는 시스템이면 괜찮을 수 있고, 500개만 쌓였어도 30분째 오래된 작업이 있으면 사용자 영향이 큽니다. 그래서 backlog는 count와 age를 같이 봐야 합니다.

초기 기준 예시:

| 지표 | 권장 시작점 |
| --- | --- |
| queue depth per replica | 100~500 이하 |
| oldest message age | 사용자 알림 1분 이하, 정산 5~15분 이하 |
| worker utilization | 60~70% 목표, downstream 포화 시 scale-out 중단 |
| metric freshness | 60초 초과 stale이면 scale-down 보류 |
| scale-up stabilization | 빠르게, 1~2분 안에 반응 |
| scale-down stabilization | 최소 5분 이상 보수적으로 |

숫자는 서비스마다 다르지만, 숫자가 없으면 운영자는 "좀 더 늘리자"와 "비용이 아깝다" 사이에서 감으로 움직이게 됩니다.

### 4) custom metric은 관측성 비용과도 연결된다

custom metrics를 늘릴 때 흔한 실수는 label을 많이 붙이는 것입니다. `tenant_id`, `user_id`, `queue_name`, `job_type`, `priority`, `region`, `version`을 모두 metric label로 넣으면 쿼리와 저장 비용이 빠르게 증가합니다. autoscaling metric은 특히 조심해야 합니다. 너무 세밀한 label은 HPA가 볼 metric series를 불안정하게 만들 수 있고, series 생성/삭제가 많으면 알람도 흔들립니다.

[Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/) 기준을 적용하면 scaling metric label은 짧아야 합니다.

- 허용 후보: `queue`, `workload`, `namespace`, `priority_class`, `region`
- 주의 후보: `tenant_tier`, `plan`, `job_type`
- 금지 후보: `tenant_id`, `user_id`, `request_id`, `object_id`

개별 tenant 문제는 로그나 trace에서 봅니다. HPA metric에는 replica 결정을 내릴 만큼 집계된 신호만 남겨야 합니다. 멀티테넌트 서비스라면 전체 queue depth 하나보다 `critical`, `standard`, `heavy`, `retry` 같은 workload lane 기준이 더 현실적입니다. 이 관점은 [Workload-aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)과 맞닿아 있습니다.

### 5) scale-out은 병목을 이동시킨다

custom metric 기반 autoscaling은 강력하지만, scale-out이 항상 처리량 증가를 의미하지는 않습니다. worker를 5개에서 20개로 늘리면 큐는 빨리 비워질 수 있습니다. 동시에 DB write QPS가 4배가 되고, 외부 API rate limit을 때리고, lock wait가 증가하고, 캐시 miss가 몰릴 수 있습니다.

그래서 autoscaling 목표에는 downstream 보호 조건이 붙어야 합니다.

| 조건 | 조치 |
| --- | --- |
| DB pool utilization 85% 초과 3분 지속 | worker scale-up 상한 고정 |
| 외부 API 429 비율 1% 초과 | concurrency limit 우선, replica 증설 보류 |
| lock wait p95 500ms 초과 | batch size 축소 또는 lane 분리 |
| retry queue가 main queue의 20% 초과 | poison/retry 원인 분리 |
| cache miss rate 2배 증가 | warmup 또는 read-through 보호 적용 |

이 지점에서 custom metrics는 [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)와 같이 설계해야 합니다. HPA는 replica 수를 조정하는 장치이지, downstream capacity를 자동으로 늘리는 장치가 아닙니다.

## 실무 적용

### 1) scaling signal inventory를 만든다

서비스별로 현재 HPA 기준과 실제 사용자 영향 지표를 나란히 적습니다.

```yaml
autoscaling_signal_inventory:
  service: invoice-worker
  current_hpa:
    metric: cpu_utilization
    target: 65
    min_replicas: 3
    max_replicas: 20
  user_impact:
    sli: invoice_generated_within_5m
    target: 99.5
  candidate_custom_metrics:
    - queue_depth_per_replica
    - oldest_invoice_job_age_seconds
    - retry_queue_ratio
  downstream_limits:
    db_write_qps_safe: 1500
    external_tax_api_qps: 200
  decision:
    use_custom_metric: oldest_invoice_job_age_seconds
    scale_up_guard: external_tax_api_429_rate < 1%
```

이 표를 만들면 CPU HPA를 유지할 서비스와 custom metric 후보를 분리할 수 있습니다.

### 2) metric freshness와 실패 동작을 정한다

custom metric은 오래된 값이면 위험합니다. 10분 전 queue depth를 보고 scale-out하면 이미 끝난 작업에 비용을 쓰고, 10분 전 낮은 backlog를 보고 scale-down하면 현재 대기열을 더 밀리게 할 수 있습니다.

운영 기준:

- metric timestamp가 60초 이상 오래되면 stale로 표시
- stale 상태에서는 scale-down을 보류하고 scale-up은 보수적으로 제한
- exporter error rate가 5분 동안 1%를 넘으면 운영 알람
- metric unit 변경은 breaking change로 보고 HPA canary 필요
- exporter 배포는 HPA rule 변경과 같은 변경 관리로 취급

Exporter는 관측 도구가 아니라 제어 입력입니다. 이 차이가 중요합니다. 대시보드 metric 하나가 잠깐 틀리는 것과 HPA 입력이 틀리는 것은 영향이 다릅니다.

### 3) autoscaling contract를 배포 단위로 남긴다

custom metric HPA는 YAML 몇 줄로 끝나지 않습니다. "어떤 신호를 보면 몇 개까지 늘릴 것인가"뿐 아니라 "그 신호가 틀렸을 때 어떻게 멈출 것인가"까지 같이 적어야 운영 계약이 됩니다. 저는 서비스별로 아래 항목을 최소 계약으로 둡니다.

| 계약 항목 | 질문 | 예시 |
| --- | --- | --- |
| scaling intent | 무엇을 개선하려는가 | invoice 99.5%를 5분 안에 생성 |
| primary metric | replica 수를 직접 움직이는 신호는 무엇인가 | `oldest_invoice_job_age_seconds` |
| secondary metric | 보조로 확인할 신호는 무엇인가 | `queue_depth_per_replica`, `retry_queue_ratio` |
| freshness budget | metric은 얼마나 최신이어야 하는가 | 60초 초과 stale이면 scale-down 금지 |
| target value | 목표값은 어디서 왔는가 | SLO 5분에서 p95 처리시간 45초를 뺀 값 |
| upper guardrail | 어디까지 늘릴 수 있는가 | DB write QPS 1,500 이하, maxReplicas 20 |
| stop condition | 늘리면 안 되는 상황은 무엇인가 | 외부 API 429 1% 초과, lock wait p95 500ms 초과 |
| rollback | 문제가 생기면 무엇을 되돌리는가 | custom metric HPA 비활성화 후 CPU HPA로 복귀 |

이 표가 있으면 플랫폼 팀과 서비스 팀의 대화가 쉬워집니다. 플랫폼 팀은 metric API와 HPA 이벤트를 책임지고, 서비스 팀은 SLO와 downstream 한계를 책임집니다. 둘 중 하나가 비어 있으면 custom metric은 "좋아 보이는 자동화"가 아니라 "원인을 알기 어려운 비용 증가"가 됩니다.

구체적인 계약 예시는 이렇게 쓸 수 있습니다.

```yaml
autoscaling_contract:
  workload: invoice-worker
  owner: billing-platform
  intent: "99.5% of invoices generated within 5 minutes"
  primary_metric:
    name: oldest_invoice_job_age_seconds
    target: 180
    freshness_budget_seconds: 60
  secondary_metrics:
    - queue_depth_per_replica
    - retry_queue_ratio
    - db_write_pool_utilization
  hpa_policy:
    min_replicas: 3
    max_replicas: 20
    scale_up_window: "1m"
    scale_down_window: "10m"
  guardrails:
    block_scale_up_when:
      external_tax_api_429_rate: "> 1%"
      db_lock_wait_p95_ms: "> 500"
    block_scale_down_when:
      metric_stale: true
      oldest_invoice_job_age_seconds: "> 120"
  rollback:
    mode: "restore cpu hpa target 65%"
    owner: "platform-oncall"
```

여기서 핵심은 `target` 숫자의 출처입니다. "oldest age 180초"라는 숫자는 아무 데서나 나온 값이면 안 됩니다. 사용자 약속이 5분이고 p95 처리 시간이 45초라면, 큐에서 180초 이상 기다리는 순간 남은 예산이 빠르게 줄어든다는 식으로 설명되어야 합니다. 그래야 나중에 비용이 늘었을 때 목표값을 180초에서 240초로 완화할지, worker 효율을 올릴지, downstream 병목을 풀지 판단할 수 있습니다.

### 4) 실패 모드를 먼저 리허설한다

custom metrics 장애는 대개 조용하게 시작합니다. exporter는 200을 반환하지만 값이 오래됐거나, 단위가 milliseconds에서 seconds로 바뀌었거나, queue label이 바뀌어 HPA가 빈 series를 보고 있을 수 있습니다. 배포 전에는 정상 시나리오만 보지 말고 실패 입력을 일부러 넣어야 합니다.

리허설 목록:

- metric timestamp를 오래된 값으로 고정했을 때 scale-down이 막히는가
- queue depth가 급증했을 때 replica가 목표 window 안에 늘어나는가
- exporter가 5xx를 반환할 때 HPA event와 alert가 남는가
- metric 단위가 1000배 틀어진 경우 canary에서 감지되는가
- label 변경으로 series가 사라졌을 때 빈 값이 0으로 해석되지 않는가
- maxReplicas에 도달했을 때 사용자 SLO 경고가 별도로 뜨는가
- downstream 429 또는 DB lock wait가 높을 때 scale-up이 제한되는가

특히 "빈 값을 0으로 해석하지 않는다"는 규칙이 중요합니다. backlog metric을 가져오지 못했는데 0으로 들어가면 HPA는 줄여도 된다고 판단할 수 있습니다. 제어 시스템에서는 unknown과 zero를 분리해야 합니다. 관측 데이터가 없다는 것은 작업이 없다는 뜻이 아니라, 판단 근거가 없다는 뜻입니다.

운영자는 HPA가 늘지 않았을 때 애플리케이션 로그만 뒤지면 늦습니다. HPA condition, custom metrics API 응답, exporter scrape 상태, metric timestamp, 최근 schema 변경을 한 화면에서 볼 수 있어야 합니다. 이 대시보드가 없으면 custom metric 도입 초반에는 장애 때마다 Kubernetes, Prometheus, 애플리케이션 owner 사이를 오가게 됩니다.

### 5) canary는 replica 변동과 사용자 지표를 같이 본다

custom metric HPA를 바로 전체 workload에 적용하지 않습니다. namespace, tenant tier, queue lane 중 하나를 골라 canary를 둡니다.

확인할 지표:

- control 대비 p95/p99 처리 지연
- queue drain time
- replica oscillation 횟수
- scale-up 후 DB/외부 API 오류율
- scale-down 후 backlog 재증가 여부
- HPA event와 exporter error
- 비용 증가 대비 SLO 개선

성공 기준은 "replica가 자동으로 늘었다"가 아닙니다. 예를 들어 invoice job의 99.5%가 5분 안에 끝나는 목표를 맞추면서, DB lock wait와 외부 API 429가 기준을 넘지 않아야 합니다. 비용도 봅니다. replica-hours가 30% 늘었는데 SLO 개선이 1%p 이하라면 metric 목표값이 너무 공격적일 수 있습니다.

### 6) 운영 runbook은 scale event 중심으로 쓴다

autoscaling 장애 때 운영자가 봐야 할 질문은 반복됩니다.

1. 왜 늘었는가?
2. 왜 안 늘었는가?
3. 왜 줄지 않는가?
4. 늘어난 뒤 무엇이 병목이 되었는가?
5. metric이 stale하거나 잘못된 단위로 들어오지 않았는가?

runbook에는 아래 명령과 대시보드 링크가 들어가야 합니다.

```text
1. HPA event와 condition 확인
2. custom metric 현재값과 timestamp 확인
3. queue depth와 oldest age를 control window와 비교
4. downstream DB/API/lock 지표 확인
5. 최근 exporter 배포와 metric schema 변경 확인
6. 필요 시 maxReplica 임시 상향 또는 scale-down stabilization 연장
7. scale event 종료 후 target value 재조정 여부 기록
```

HPA는 한 번 켜면 잊어도 되는 기능이 아닙니다. scale event는 작은 운영 사건입니다. 특히 custom metric이 들어오면 metric owner, workload owner, platform owner의 책임 경계가 필요합니다.

## 트레이드오프/주의점

첫째, custom metric은 운영 표면을 늘립니다. exporter, metric API, HPA rule, dashboard, alert, runbook이 한 세트로 필요합니다. 작은 서비스라면 CPU HPA와 resource request 개선이 더 나을 수 있습니다.

둘째, backlog 기반 scale-out은 downstream을 압박할 수 있습니다. 큐가 밀린다고 worker만 늘리면 DB, 외부 API, lock, cache가 다음 병목이 됩니다. concurrency limit과 rate limit을 함께 둬야 합니다.

셋째, metric label을 과하게 넣으면 비용과 안정성이 나빠집니다. autoscaling metric은 분석용 metric보다 더 보수적인 label 정책을 가져야 합니다.

넷째, latency metric만으로 HPA를 걸면 불안정할 수 있습니다. p95가 높아진 이유가 capacity 부족인지 downstream 장애인지 구분해야 합니다. 장애 중에는 scale-out보다 circuit breaker나 brownout이 맞을 수 있습니다.

다섯째, scale-down은 scale-up보다 보수적이어야 합니다. backlog가 비워졌다고 바로 줄이면 새 작업이 들어올 때 다시 흔들립니다. 공식 HPA도 downscale stabilization window를 통해 급격한 축소를 완화합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] CPU 기반 HPA로 충분한 서비스와 custom metric 후보 서비스를 분리했다.
- [ ] custom metric이 사용자 SLO 또는 queue drain 목표와 연결되어 있다.
- [ ] metric freshness 기준과 stale 시 동작을 정했다.
- [ ] label cardinality 예산을 정하고 tenant_id/user_id/request_id를 scaling metric에서 제외했다.
- [ ] scale-up이 downstream DB, 외부 API, lock wait를 악화시키지 않는지 guardrail을 뒀다.
- [ ] HPA canary에서 replica oscillation, p95, backlog, 비용을 함께 봤다.
- [ ] scale event runbook에 HPA condition, exporter 상태, metric schema 변경 확인이 들어 있다.

### 연습

현재 운영 중인 worker 하나를 골라 CPU HPA 기준과 실제 사용자 영향 지표를 비교해 보세요. `queue_depth`, `oldest_item_age`, `processing_time_p95`, `retry_queue_ratio`, `downstream_error_rate`를 표로 놓고, 어떤 값이 replica 수를 늘리는 근거가 되어야 하는지 1순위와 2순위를 고릅니다. 그다음 "이 metric이 틀렸을 때 어떤 피해가 나는가"를 한 줄로 적으면 custom metric 도입 여부가 훨씬 선명해집니다.

## 관련 글

- [Kubernetes 기본기](/learning/deep-dive/deep-dive-kubernetes-basics/)
- [Docker/Kubernetes Q&A](/learning/qna/docker-kubernetes-qna/)
- [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/)
- [Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Workload-aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)
