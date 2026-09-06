---
title: "2026 개발 트렌드: Kubernetes v1.37 etcd RangeStream, 대량 List의 메모리 피크를 용량 계약으로 바꾸다"
date: 2026-09-06T10:06:00+09:00
lastmod: 2026-09-06T10:06:00+09:00
draft: false
tags: ["Kubernetes", "etcd", "RangeStream", "Control Plane", "Scalability", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37", "etcd RangeStream", "EtcdRangeStream", "large list reads", "watch cache initialization", "API server memory"]
description: "Kubernetes v1.37과 etcd v3.7의 RangeStream Beta를 계기로, control plane의 대형 List 요청을 단순히 빠르게 만드는 문제가 아니라 object 크기·동시성·fallback·메모리 피크를 함께 관리하는 용량 계약으로 다룹니다."
summary: "RangeStream은 etcd가 큰 Range 응답을 한 번에 조립하지 않고 byte-aware chunk로 흘려보내 API server와 etcd의 메모리 피크를 낮춘다. 하지만 이는 CRD 비대화나 무제한 list client를 해결하지 않는다. 업그레이드 성공 기준은 gate가 켜졌는지가 아니라 listStream 사용 증거, etcd v3.7 호환, cache miss·OOM·list latency의 기준선이 모두 개선되는지다."
key_takeaways:
  - "Kubernetes v1.37에서 EtcdRangeStream은 Beta·기본 활성화지만, 실제 스트리밍 경로에는 etcd v3.7 이상이 필요하다."
  - "key 수 기준 pagination은 object 크기 편차를 제한하지 못한다. RangeStream은 적응형 chunk로 전체 page를 양쪽 메모리에 동시에 쌓는 피크를 줄인다."
  - "성공 증거는 `etcd_request_duration_seconds_count{operation=\"listStream\"}`가 증가하는지와, startup·cache 재초기화·cache miss에서 OOM과 tail latency가 어떻게 바뀌는지다."
  - "RangeStream은 성능 튜닝 버튼이 아니라 control-plane upgrade의 한 요소다. oversized CRD, list 권한, controller cache 범위, fallback을 별도 경계로 유지해야 한다."
operator_checklist:
  - "kube-apiserver v1.37과 etcd v3.7 이상 조합인지, managed Kubernetes의 control-plane 버전 정책이 이를 실제로 제공하는지 먼저 확인한다."
  - "업그레이드 전후 `listStream` operation, apiserver·etcd RSS, watch cache 초기화 시간, cache-miss list p95/p99, OOM restart를 같은 시간축에 둔다."
  - "전체 cluster 변경 전에 크고 자주 list되는 resource와 controller를 inventory하고, 24시간 이상 canary 환경에서 list storm과 apiserver 재시작을 재현한다."
  - "`listStream=0`은 feature가 실패했다는 뜻이 아니라 구형 etcd fallback일 수 있으므로, gate·etcd 버전·요청 경로를 순서대로 확인한다."
learning_refs:
  - title: "Kubernetes v1.37 Scale-to-Zero와 Control Plane 회복력"
    href: "/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/"
    description: "watch cache 복구와 429를 backpressure 계약으로 다루는 기준입니다."
  - title: "Kubernetes Metrics API와 DRA 리소스 계약"
    href: "/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/"
    description: "control plane의 상태·관측 데이터를 서로 다른 진실 원천으로 분리하는 방법입니다."
  - title: "Kubernetes Rollout 전략"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "플랫폼 업그레이드를 canary·health check·rollback으로 관리하는 기본 절차입니다."
---

Kubernetes control plane에서 `LIST`는 평상시에는 눈에 잘 띄지 않습니다. 하지만 API server가 시작하거나 watch cache를 다시 채우고, cache에서 처리할 수 없는 list가 etcd로 내려가며, 수십만 개의 Pod나 큰 CRD object를 읽는 순간에는 메모리 피크를 만들 수 있습니다. Kubernetes v1.37과 etcd v3.7은 이 지점에 `RangeStream`을 Beta로 넣었습니다. 한 번에 큰 응답을 조립하던 `Range` 읽기를 byte-aware chunk 스트림으로 바꿔, etcd와 API server가 전체 collection을 동시에 붙잡지 않도록 합니다.

이 변화는 "List가 빨라진다"는 한 줄보다 운영적으로 중요합니다. 기존 pagination은 key 개수를 기준으로 page를 나눴습니다. 그러나 key가 500개여도 각 object가 2KiB인지 2MiB인지에 따라 page의 메모리 비용은 전혀 다릅니다. 큰 object와 동시 list가 겹치면 etcd가 응답을 조립하고 API server가 decode하는 동안 같은 payload가 양쪽에 존재할 수 있습니다. RangeStream은 chunk를 받고 처리한 뒤 해제하도록 만들어, 적어도 **응답 조립 때문에 생기는 예측 불가능한 peak**를 줄이는 방향입니다.

이 글은 [Kubernetes v1.37의 Scale-to-Zero와 Control Plane 회복력](/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/), [Kubernetes Metrics API와 DRA 리소스 계약](/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/), [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)을 잇습니다. 앞선 글이 control plane이 과부하에서 요청을 어떻게 제한하고 자원 상태를 어떻게 해석할지를 다뤘다면, 여기서는 대량 상태를 **어떤 메모리 상한 안에서 읽을 것인가**를 다룹니다.

공식 참고 자료:

- Kubernetes Blog, [Kubernetes v1.37: etcd RangeStream Cuts Memory Use on Large List Reads](https://kubernetes.io/blog/2026/09/01/kubernetes-v1-37-etcd-range-stream/)
- etcd Docs, [RangeStream RPC API](https://etcd.io/docs/v3.7/dev-guide/api_grpc_gateway/)
- Kubernetes Blog, [Kubernetes v1.37: Garhwal](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)

## 이 글에서 얻는 것

- RangeStream이 기존 `Range`·key-count pagination과 무엇이 다른지, 그리고 어떤 메모리 피크를 줄이는지 이해합니다.
- 실제 사용 조건인 Kubernetes v1.37, etcd v3.7, `EtcdRangeStream` feature gate와 runtime fallback을 구분합니다.
- "기능이 켜졌다"가 아니라 listStream metric·RSS·cache 초기화 시간·tail latency로 효과를 판정하는 기준을 세웁니다.
- 대형 CRD와 list-heavy controller를 가진 cluster에서 canary와 rollback을 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) List 비용은 object 개수가 아니라 object 크기 × 동시성 × 경로로 계산해야 한다

API server의 watch cache는 대부분의 list/watch를 메모리에서 처리하지만, cache는 시작과 재초기화 때 resource의 전체 상태를 etcd에서 읽어야 합니다. cache miss나 특정 fallback list도 etcd를 읽을 수 있습니다. 기존의 paginated `Range`는 page를 key 수로 나눴으므로, 한 page에 우연히 큰 Pod spec·status, annotation이 과도한 CRD, 많은 managed field가 섞이면 byte 크기는 여전히 커집니다.

문제는 payload가 한 번만 존재하지 않는다는 점입니다. unary `Range`는 etcd가 page 전체를 조립한 후 전송하고, API server는 이를 받은 뒤 decode합니다. 큰 page가 여러 request와 겹치면 etcd heap, API server heap, GC pause, OOM retry가 연쇄할 수 있습니다. `kubectl get` 한 번이 문제가 아니라, controller restart·API server failover·inventory job이 동시에 대량 list를 하는 복구 장면이 위험합니다.

| 관측값 | 먼저 묻는 질문 | 우선 조치 |
| --- | --- | --- |
| apiserver RSS 급증 | 어떤 resource의 cache 초기화와 겹쳤는가 | resource별 object 크기·개수·초기화 시간을 inventory |
| etcd memory spike | unary Range 응답 조립과 list 동시성이 겹쳤는가 | v3.7 호환·listStream 사용 여부 확인 |
| list p99 증가 | cache hit가 줄었는가, client가 너무 넓게 list하는가 | selector·namespace·controller cache 범위 축소 |
| OOMKilled 뒤 반복 복구 | peak를 만든 object가 사라졌는가 | limit 상향 전 oversized object와 concurrency를 먼저 제거 |

따라서 RangeStream은 object 크기를 작게 만들거나 list 요청 수를 제한하는 기능이 아닙니다. [Kubernetes Metrics API와 DRA 리소스 계약](/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/)에서 resource status를 단일 진실로 보지 않듯, memory 사용량도 "기능 gate가 on"이라는 한 신호로 설명하면 안 됩니다.

### 2) RangeStream은 byte-aware streaming이고, etcd v3.7이 실제 경계다

etcd v3.7의 `RangeStream` RPC는 `RangeRequest`와 같은 결과를 반환하되, 응답 전체를 만들기 전에 적응형 chunk로 나눠 전송합니다. 큰 value가 섞여도 chunk는 key 수보다 byte 크기에 맞춰 조절되고, consumer는 받은 chunk를 처리·해제한 뒤 다음 chunk를 받습니다. Kubernetes v1.37의 API server는 whole collection을 읽는 watch cache initialization과 cache에서 답할 수 없는 직접 etcd list에 이 경로를 사용합니다.

조건은 세 개입니다.

```text
kube-apiserver >= 1.37
etcd           >= 3.7
EtcdRangeStream feature gate = true (v1.37에서는 Beta·기본 활성화)
```

여기서 "v1.37로 올렸으니 streaming이다"라고 단정하면 안 됩니다. API server는 시작 시 etcd 지원 여부를 확인하고, `Unimplemented` 응답이면 runtime에서 기존 paginated `Range`로 fallback합니다. 즉 managed control plane이 etcd 버전을 공개하지 않거나, self-managed cluster가 API server만 먼저 올렸다면 기능은 안전하게 fallback할 수 있습니다. 안전한 fallback은 좋지만, 기대했던 memory profile이 나오지 않는 이유이기도 합니다.

### 3) 새로운 metric은 adoption 확인용이고 SLO 자체는 아니다

공식 안내에서 가장 직접적인 증거는 다음 metric입니다.

```promql
etcd_request_duration_seconds_count{operation="listStream"}
```

이 count가 0보다 크면 API server가 RangeStream을 사용한 것입니다. 계속 0이면 오래된 etcd가 가장 흔한 원인이지만, 해당 시간에 whole-collection read가 없었을 수도 있습니다. 따라서 rate를 request volume·cache initialization event와 함께 해석해야 합니다. count 하나만 보고 "활성화 실패" alert를 걸면 조용한 cluster에서 거짓 경보를 낼 수 있습니다.

시작 기준은 다음처럼 잡을 수 있습니다.

| 지표 | 기준선 | canary 통과 예시 |
| --- | --- | --- |
| `listStream` count/rate | upgrade 전 0 | 계획한 cache warm-up·direct list 때 증가 |
| apiserver/etcd RSS peak | 같은 object set, 같은 load | peak가 기존 SLO를 넘지 않고 OOM 0회 |
| watch cache 초기화 p95 | rollout 전 7일 | 20% 이상 악화하지 않음 |
| direct list p99 | 동일 selector·namespace | 사용자·controller deadline 안 유지 |
| list 오류/429 | 복구·부하 이벤트 기준 | retry queue와 oldest work age가 같이 악화하지 않음 |

[Scale-to-Zero와 Control Plane 회복력](/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/)에서 본 429와 `Retry-After`도 같은 맥락입니다. streaming이 memory peak를 줄여도 API server의 동시성 한계가 사라지지는 않습니다. controller가 429를 즉시 재시도하면 새 read path의 이점을 스스로 상쇄할 수 있습니다.

## 실무 적용

### 1) "업그레이드"보다 먼저 list surface를 inventory한다

첫 단계는 cluster 전체에서 어떤 API resource가 크고, 누가 넓게 list하는지를 알아내는 것입니다. Pod, Secret, Event뿐 아니라 CRD의 spec/status와 `metadata.managedFields` 크기를 표본으로 뽑으세요. operator 하나가 모든 namespace와 모든 CR을 cache에 넣는다면 RangeStream 도입 뒤에도 steady-state memory가 높을 수 있습니다.

아래처럼 workload별로 성격을 나누면 우선순위가 선명해집니다.

| 후보 | RangeStream 효과 기대 | 별도 개선 우선 |
| --- | --- | --- |
| 많은 Pod/CR을 가진 control plane 재시작 | 높음: cache re-initialization peak | etcd v3.7·apiserver compatibility 확인 |
| namespace 하나만 보는 controller | 제한적 | namespace/label selector를 먼저 고정 |
| 수 MiB status를 가진 CRD | 부분적 | status 분리·크기 budget·retention 우선 |
| ad-hoc 전수 inventory job | 부분적 | pagination, QPS, resume cursor, retry budget 우선 |

CRD object 1개가 수 MiB까지 자라면 chunk streaming은 OOM 피크를 낮출 수 있어도, 그 object를 모든 cache와 webhook이 deserialize하는 구조를 건강하게 만들지 않습니다. 플랫폼 팀은 resource 유형별 p95/p99 serialized size, object count, owner, retention 정책을 기록하고, p99 크기가 정한 budget을 넘으면 새 필드·상태 이력을 제한하는 gate를 두는 편이 낫습니다.

### 2) canary에서는 startup만이 아니라 fallback list를 재현한다

RangeStream의 사용 지점은 watch cache 초기화만이 아닙니다. cache로 서비스할 수 없는 direct etcd list도 대상이므로, canary 계획에는 API server restart와 cache miss 성격의 read를 모두 넣어야 합니다. production과 같은 object 크기 분포를 쓸 수 없다면 최소한 큰 object의 p95/p99, resource 수, controller 동시성을 재현합니다.

권장 순서는 다음입니다.

1. **호환성 확인**: control-plane과 etcd의 실제 버전, feature gate, managed provider 지원 범위를 문서로 확인합니다.
2. **기준선 확보**: 7일 동안 RSS peak, OOM, cache initialization duration, list p95/p99, 429·workqueue age를 저장합니다.
3. **한 cluster 또는 control-plane canary**: API server restart와 controller restart를 분리해 실행하고, `listStream` metric과 memory profile을 확인합니다.
4. **복구 시험**: etcd가 구형이거나 RPC가 `Unimplemented`인 fallback을 확인해, 기존 Range path에서도 deadline·memory limit이 안전한지 봅니다.
5. **확대 기준**: OOM 0회, initialization p95가 기준선 대비 20% 이상 나빠지지 않음, list p99와 429·workqueue oldest age가 SLO 안이라는 세 조건을 모두 만족할 때만 확대합니다.

여기서 rollback은 `EtcdRangeStream=false`만을 뜻하지 않습니다. 심각한 memory 회귀가 있으면 controller cache scope, list concurrency, oversized CRD rollout도 함께 되돌릴 수 있어야 합니다. [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)의 canary 원칙처럼, feature gate가 아니라 관찰 가능한 behavior를 rollback 단위로 다뤄야 합니다.

### 3) 대시보드는 memory와 사용자 영향 사이를 연결한다

etcd/apiserver memory graph만 보면 절반만 보입니다. control plane에서 list가 느려지면 scheduler·controller의 reconcile가 늦고, 최종적으로 Pod readiness, Service endpoint 갱신, 배포 진행 시간에 영향을 줍니다. 그래서 같은 dashboard에 다음을 같이 놓습니다.

```text
object size / listStream rate / apiserver·etcd RSS
     -> cache initialization duration / list p99 / 429 rate
     -> controller workqueue oldest age / reconcile latency
     -> deployment progress deadline / workload readiness
```

예를 들어 RSS peak는 줄었는데 `listStream` 사용이 거의 없고 list p99가 높다면, RangeStream 문제가 아니라 cache hit 저하나 list client의 selector 누락일 수 있습니다. 반대로 streaming count가 늘고 OOM은 사라졌지만 workqueue oldest age가 계속 증가하면, request 동시성이나 downstream 처리량을 따로 봐야 합니다. 관측을 한 개의 "성능 개선" 수치로 접으면 원인별 조치가 섞입니다.

## 트레이드오프/주의점

첫째, RangeStream은 v1.37에서 Beta입니다. production 사용은 가능하지만, 기능 gate와 etcd 버전, provider가 지원하는 control-plane 조합을 명시적으로 확인해야 합니다. 둘째, 스트리밍은 peak memory를 줄이는 기술이지 average memory·etcd I/O·network 비용을 0으로 만들지 않습니다. object 전체를 읽는 필요 자체가 남아 있다면 list surface와 data model을 고쳐야 합니다.

셋째, fallback이 자동이라는 이유로 compatibility 검증을 생략하면 안 됩니다. 구형 etcd와도 동작할 수 있지만, 운영 목표가 "memory peak 감소"라면 fallback은 통과가 아니라 관찰·추가 업그레이드가 필요한 상태입니다. 넷째, metric cardinality를 늘려 resource 이름·namespace를 무한 label로 넣어 RangeStream 효과를 측정하려 하면 관측성 비용을 새로 만듭니다. [Metric Cardinality Limit과 데이터 완전성](/posts/2026-09-03-opentelemetry-metric-cardinality-overflow-data-completeness-trend/)의 budget 원칙을 적용해 상위 resource type과 sampled exemplar를 분리하세요.

## 체크리스트 또는 연습

### 체크리스트

- [ ] kube-apiserver와 etcd가 각각 v1.37·v3.7 이상이며 provider 지원 정책도 확인했다.
- [ ] `EtcdRangeStream` gate, `listStream` metric, fallback Range path를 별도 상태로 기록한다.
- [ ] resource별 object count와 serialized size p95/p99, owner, retention 정책을 inventory했다.
- [ ] canary에서 API server restart·controller restart·direct list를 각각 재현했다.
- [ ] RSS peak, OOM, cache initialization p95, list p99, 429, workqueue oldest age를 기준선과 비교했다.
- [ ] failure 시 gate뿐 아니라 cache scope·list concurrency·oversized CRD 변경을 되돌릴 owner와 절차가 있다.

### 연습

staging에서 object 크기가 큰 CRD 하나와 Pod collection 하나를 고릅니다. 업그레이드 전후로 API server restart를 한 번씩 수행하고 `listStream` count, etcd/apiserver RSS peak, watch cache 초기화 시간, controller workqueue oldest age를 표로 비교하세요. `listStream`이 0이면 성능 결론을 내리지 말고 etcd 버전과 해당 read가 실제로 발생했는지부터 확인합니다.

## 관련 글

- [Kubernetes v1.37: Scale-to-Zero와 Control Plane 회복력](/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/)
- [Kubernetes Metrics API와 DRA 리소스 계약](/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/)
- [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [OpenTelemetry Metric Cardinality Limit](/posts/2026-09-03-opentelemetry-metric-cardinality-overflow-data-completeness-trend/)
