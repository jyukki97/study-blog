---
title: "2026 개발 트렌드: Kubernetes v1.37 Memory QoS Beta, OOM 직전의 메모리를 운영 계약으로 바꾸다"
date: 2026-09-16T10:06:00+09:00
lastmod: 2026-09-16T10:06:00+09:00
draft: false
tags: ["Kubernetes", "Memory QoS", "cgroup v2", "Kubelet", "SRE", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37 Memory QoS", "memory.high", "memory.min", "memory.low", "cgroup v2 memory throttling"]
description: "Kubernetes v1.37에서 Beta가 된 Memory QoS를 계기로, memory.high·memory.min·memory.low를 OOM 회피 옵션이 아니라 워크로드 분리·관측·rollback이 필요한 node-level 운영 계약으로 해석합니다."
summary: "v1.37의 MemoryQoS feature gate는 기본 활성화지만, 기본 kubelet 설정은 throttling과 reservation을 켜지 않는다. cgroup v2 node에서 memory.high와 TieredReservation을 명시적으로 선택할 때만 기존 workload의 지연·reclaim·OOM 경로가 바뀐다. 안전한 도입은 전용 node pool, resource request 품질, page cache 특성, memory event와 p99를 함께 검증하는 canary에서 시작한다."
---

Kubernetes에서 메모리 문제는 오랫동안 단순한 두 가지 질문으로 축소되곤 했다. Pod에 `requests.memory`를 줬는가, 그리고 `limits.memory`를 넘겨 OOMKilled가 났는가. 하지만 request는 주로 스케줄러의 배치 판단에 쓰였고, 실제 node가 압박을 받을 때 어떤 메모리를 먼저 회수하고 어떤 workload를 늦출지는 cgroup과 kernel의 더 아래 계층에서 결정됐다. 평균 사용률이 낮은데 p99가 튀거나, 한 batch Pod의 burst 뒤 옆 서비스가 죽는 이유가 여기 있다.

2026년 9월 14일 공개된 Kubernetes v1.37의 **Memory QoS Beta**는 이 빈틈을 직접 다룬다. Linux cgroup v2의 `memory.high`, `memory.min`, `memory.low`를 kubelet이 Pod QoS class와 resource 설정에 연결한다. 다만 "Beta이고 기본 활성화"라는 문구를 곧바로 production 기본값으로 읽으면 안 된다. v1.37의 기본 kubelet 설정은 throttling과 memory reservation을 모두 켜지 않으며, 동작 변화는 `memoryThrottlingFactor` 또는 `memoryReservationPolicy`를 **명시**할 때 시작한다.

이 글은 [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [SLO·SLI·Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/), [Kubernetes v1.37 In-Place Resize와 preemption budget](/posts/2026-09-14-kubernetes-inplace-resize-preemption-budget-trend/), [Kubernetes rootless node component](/posts/2026-09-08-kubernetes-rootless-node-components-trend/)를 연결한다. 새 memory control을 Pod YAML의 한 필드가 아니라, node pool의 자원 약속과 workload placement를 바꾸는 platform capability로 다룬다.

공식 기준은 Kubernetes Blog의 [Memory QoS Beta 발표](https://kubernetes.io/blog/2026/09/14/kubernetes-v1-37-memory-qos-graduates-to-beta/), Kubernetes Docs의 [Pod QoS와 Memory QoS](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/), [v1.37 release note](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)다. 본문 수치와 설정은 이 문서의 v1.37 기준이며, managed Kubernetes 배포판은 kubelet config와 node OS를 별도로 확인해야 한다.

## 이 글에서 얻는 것

- v1.37에서 "feature gate 기본 활성화"와 "기존 Pod의 runtime 동작 변경"이 다른 이유를 이해합니다.
- `memory.max`, `memory.high`, `memory.min`, `memory.low`가 OOM·throttling·reclaim에 각각 어떤 계약을 만드는지 구분합니다.
- request/limit 품질, page cache, mixed workload가 TieredReservation에서 왜 중요한지 판단할 수 있습니다.
- node pool canary, 관측 지표, 확대·중단·rollback 조건을 수치로 설정할 수 있습니다.

## 핵심 개념/이슈

### 1) v1.37은 Memory QoS를 켰지만, throttling과 reservation을 자동으로 켜지 않는다

v1.37에서 `MemoryQoS` feature gate는 Beta이며 기본 활성화다. 그러나 기본 `KubeletConfiguration`의 `memoryThrottlingFactor`는 `null`, `memoryReservationPolicy`는 `None`이다. 즉 업그레이드 뒤 아무 설정도 하지 않았다면 kubelet은 `memory.high`, `memory.min`, `memory.low`를 새로 쓰지 않는다. 이 기본값은 Alpha 시절의 암묵적인 throttling이 업그레이드만으로 기존 서비스의 지연을 바꾸지 않게 하려는 호환성 선택이다.

여기서 특히 확인할 점은 **기존에 명시적으로 `memoryThrottlingFactor`를 설정한 node**다. 그 값은 업그레이드 뒤에도 유지되어 throttling이 계속된다. 반대로 feature gate만 켜고 값을 명시하지 않았던 환경은 v1.37에서 `null` 기본값을 적용받아 `memory.high`를 더 이상 쓰지 않을 수 있다. 버전 번호나 gate 상태만 보는 upgrade review는 이 차이를 놓친다.

도입 전에는 모든 node pool에서 아래 세 사실을 분리해 inventory한다.

1. Linux와 cgroup v2를 쓰는가. Memory QoS는 cgroup v2가 필요하며, `memory.high` throttling에는 kernel 5.9 이상이 권장된다.
2. kubelet config에 `memoryThrottlingFactor`, `memoryReservationPolicy`, `MemoryQoS`가 실제로 어떤 값으로 있는가.
3. Pod의 request/limit이 실제 힙·page cache·sidecar 사용량을 반영하는가. 설정이 비어 있거나 임의의 과거 값이면 Memory QoS도 그 품질을 그대로 증폭한다.

### 2) 네 개의 경계는 같은 limit이 아니다

Memory QoS를 이해할 때 가장 위험한 오해는 `memory.high`를 또 하나의 hard limit으로 보는 것이다. 네 값은 서로 다른 kernel 행동을 요청한다.

| cgroup 값 | Kubernetes에서의 관계 | 압박 시 의미 | 운영 해석 |
| --- | --- | --- | --- |
| `memory.max` | `limits.memory` | 넘으면 OOM kill 가능 | 절대 상한, 실패 경계 |
| `memory.high` | throttling factor로 계산 | 강한 reclaim/throttling 압력 | OOM 이전의 성능·지연 경계 |
| `memory.min` | Guaranteed request 보호 | kernel이 회수하지 않아야 함 | 가장 강한 reservation |
| `memory.low` | Burstable request 보호 | 우선 보존하되 극한에는 회수 가능 | soft reservation |

Burstable container에서 `memoryThrottlingFactor`를 `f`로 설정하면 Kubernetes는 아래 기준으로 `memory.high`를 계산한다.

```text
memory.high = request + f × (limit - request)
```

예를 들어 request가 256MiB, limit가 1GiB, factor가 `0.9`라면 `memory.high`는 약 947MiB가 된다. hard limit 바로 아래에서 process를 죽이는 대신 reclaim 압력을 주어 allocation을 늦추는 것이다. **이 결과는 OOM 수가 줄어드는 대신 p99 지연이 길어질 수 있음**을 뜻한다. OOM count만 성공 지표로 삼으면 실패를 늦은 응답으로 옮겼다는 사실을 놓친다.

Guaranteed Pod는 request와 limit가 같으므로 `memory.high`가 설정되지 않는다. BestEffort는 request와 limit가 없어서 node allocatable memory를 계산 기준으로 쓴다. 따라서 QoS class는 단순한 eviction 우선순위 라벨이 아니라 실제 cgroup control의 입력이 된다. resource spec을 대충 두면 node-level policy의 결과도 예측하기 어려워진다.

### 3) TieredReservation은 request를 스케줄 힌트에서 reclaim 정책으로 승격한다

`memoryReservationPolicy: TieredReservation`을 설정하면 Guaranteed Pod에는 request만큼 `memory.min`, Burstable Pod에는 request만큼 `memory.low`가 설정된다. BestEffort에는 보호가 없다. `memory.min`은 kernel이 회수하지 않아야 하는 hard protection이고, `memory.low`는 우선 보호하지만 심한 압박에서는 회수할 수 있는 soft protection이다.

이 변화는 중요한 장점이 있다. 예를 들어 latency-sensitive API와 낮은 우선순위 batch가 같은 node에서 경쟁할 때, 정상적으로 sizing된 API request를 지켜 batch의 무분별한 reclaim 영향을 낮출 수 있다. 그러나 request는 이제 "scheduler가 자리만 잡아 둔 숫자"가 아니다. 많이 잡은 request는 실제 reclaim 가능한 메모리를 줄이며, 모든 팀이 과장된 request를 올리면 node가 예상보다 일찍 압박을 받을 수 있다.

더 까다로운 경우는 page cache다. Guaranteed Pod의 `memory.min` 보호 범위에는 cgroup에 청구되는 page cache도 들어간다. 대형 파일을 읽는 ETL, image processing, search indexing workload가 큰 limit를 가진 Guaranteed Pod로 실행되면, kernel이 이 cache를 이웃 workload를 위해 회수하기 어려워질 수 있다. 결국 그 Pod 자체가 `memory.max`에 도달해 OOMKilled가 나는 역설도 가능하다. "Guaranteed니까 안전"이 아니라 **heap과 cache를 합친 working set을 limit 안에서 감당하는가**가 질문이다.

### 4) node-wide policy라는 사실이 rollout 단위를 결정한다

`memoryReservationPolicy`는 Pod annotation이나 namespace opt-in이 아니라 node의 kubelet 설정이다. `TieredReservation`을 켜면 해당 node의 모든 Guaranteed/Burstable Pod가 영향을 받는다. 한 node에서 hard reservation이 필요한 API와 대량 cache를 쓰는 batch를 섞어 두고 특정 deployment만 opt-out하는 방법은 없다.

그래서 안전한 첫 rollout 단위는 namespace가 아니라 **전용 node pool**이다. resource profile이 잘 알려진 stateless API pool, 재생성이 쉬운 CI pool, 또는 batch-only pool처럼 workload 성격을 단순화한 곳이 좋다. 반대로 legacy JVM, 대형 file scan, unmanaged sidecar, request/limit가 빠진 BestEffort Pod가 뒤섞인 범용 pool은 먼저 inventory와 정리가 필요하다.

이는 rootless node나 in-place resize와 같은 v1.37 기능을 다룰 때와 같은 원리다. 새 kubelet policy는 한 workload의 YAML만 바꾸지 않고, node 위에서 함께 사는 모든 프로세스의 자원 규칙을 바꾼다. 따라서 배치 정책, taint/toleration, capacity 여유, rollback pool을 함께 설계해야 한다.

## 실무 적용

### 1) 먼저 "관찰만 하는" baseline을 만든다

첫 주에는 `memoryThrottlingFactor`와 `TieredReservation`을 켜지 않는다. 대신 후보 node pool에서 resource spec, QoS class, OOM, restart, latency를 조사한다. 최소 질문은 다음과 같다.

- 각 workload의 request 대비 실제 RSS/working set p50·p95·p99는 얼마인가?
- `limits.memory`에 heap 외 direct memory, native memory, sidecar, page cache headroom이 포함됐는가?
- `container_memory_working_set_bytes`만이 아니라 cgroup `memory.events`의 `high`, `oom`, `oom_kill`과 node memory PSI를 수집하는가?
- 현재 OOMKilled는 limit 초과, node pressure eviction, application leak, traffic burst 중 어느 원인이 많은가?
- node pool의 Kubernetes version, kernel, cgroup v2, container runtime이 같은 운영 기준을 만족하는가?

`memory.current`가 낮다고 바로 안전한 것은 아니다. 짧은 burst와 reclaim stall은 평균 대시보드에서 보이지 않는다. request와 actual p99, request 대비 cache 비중, OOM 전의 latency와 PSI를 같은 시간축에 놓아야 한다. [SLO·SLI·Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)에서 다루는 것처럼, resource control의 성공은 CPU·메모리 그래프가 예쁜가가 아니라 사용자 SLO가 유지되는가로 판단해야 한다.

### 2) 정책을 한 번에 둘 다 켜지 않는다

Memory QoS는 throttling과 reservation을 독립적으로 설정할 수 있다. 첫 canary에서는 문제의 원인을 분리할 수 있도록 하나만 선택한다.

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
# 선택 A: OOM 직전 reclaim/throttling만 관찰
memoryThrottlingFactor: 0.9

# 선택 B: QoS별 보호만 관찰
# memoryReservationPolicy: TieredReservation
```

선택 A는 memory burst가 잦은 Burstable batch를 격리한 node pool에서 적합하다. `memory.high` event가 늘어도 p99와 queue latency가 허용 범위 안인지 본다. 선택 B는 request sizing이 비교적 신뢰할 수 있고, 중요한 API의 memory reclaim을 줄이고 싶은 pool에서 적합하다. 둘을 함께 켜는 것은 각 효과와 부작용의 baseline을 얻은 뒤에 한다.

`0.9`는 공식 예시에 있는 출발점이지 보편적인 정답이 아니다. factor를 낮추면 더 일찍 throttling되어 node를 보수적으로 보호할 수 있지만 latency 비용은 커진다. factor를 높이면 기존 성능을 더 오래 유지하지만 OOM 직전의 완충 구간이 좁아진다. 팀의 request/limit 품질, queueing, user-facing p99 budget을 먼저 정하지 않은 채 숫자만 복사하지 않는다.

### 3) 1~2 node 또는 capacity 5% 이하에서 48시간 검증한다

canary pool은 전체 worker capacity의 5% 이하, 가능하면 1~2 node로 시작한다. 표준 deployment 하나를 해당 pool으로만 보내고, 새 Pod 생성·재시작·in-place resize까지 포함해 적어도 48시간 관찰한다. 주중 트래픽과 배치 window가 다른 서비스라면 시간만 48시간 채우기보다 두 종류의 부하를 모두 통과시킨다.

| 지표 | 확대 기준 | 중단·되돌림 기준 |
| --- | --- | --- |
| API p99 / queue 처리 지연 | 기존 baseline 대비 +5% 이내 | +15% 초과가 15분 지속 |
| OOMKilled / node pressure eviction | baseline 이하 또는 원인 분류 완료 | 동일 workload에서 2회 이상 미설명 증가 |
| `memory.events.high` | 증가해도 latency와 상관관계 설명 가능 | 급증과 p99 악화가 동반 |
| memory PSI full | baseline 대비 +10% 이내 | +25% 초과가 10분 지속 |
| pod restart / readiness failure | baseline 수준 | 서비스 SLO를 훼손하는 증가 |

숫자는 예시이므로 각 서비스의 error budget에 맞춰 바꾼다. 다만 `memory.events.high`가 많이 발생했다는 사실 하나만으로 rollback할 필요는 없다. 그 값은 throttling이 실제로 일어났다는 관측 신호다. 반대로 high event가 줄었다고 무조건 좋은 것도 아니다. throttling이 동작하지 않았거나 workload가 이미 OOM으로 죽었을 수 있다. event, latency, restart, PSI, traffic을 함께 해석해야 한다.

### 4) rollback은 config 제거만이 아니라 cgroup 상태 수렴까지 확인한다

Memory QoS를 끌 때는 feature gate와 kubelet config의 관계를 함께 확인한다. 공식 문서 기준으로 `MemoryQoS: false`로 rollback하려면 `memoryReservationPolicy`를 `None` 또는 unset으로 바꾸고, 이전과 호환되지 않는 `memoryThrottlingFactor` 설정을 정리한 뒤 kubelet을 재시작해야 한다. startup 뒤 ancestor cgroup의 `memory.min`/`memory.low`는 0으로 reset된다.

그러나 이미 실행 중인 container의 `memory.high`는 restart 또는 in-place resize 전까지 남아 있을 수 있다. 따라서 rollback 완료 조건을 "config merge됨"으로 잡으면 부족하다. candidate pool의 kubelet restart, representative Pod restart, cgroup 파일 값, latency·OOM·readiness 복구까지 확인해야 한다. [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)의 drain·replacement·rollback rehearsal을 node configuration에도 적용해야 하는 이유다.

## 트레이드오프/주의점

1. **OOM을 지연으로 바꿀 수 있다.** `memory.high`는 hard kill 이전에 reclaim/throttling을 유도한다. 안정성은 좋아질 수 있지만 tail latency·queue depth·timeout은 악화될 수 있으므로 SLO와 함께 승인한다.
2. **request의 과장은 실제 보호 자원을 잠근다.** TieredReservation에서 과도한 request는 reclaimable memory를 줄인다. scheduler의 여유를 위해 올린 숫자가 node pressure의 원인이 될 수 있다.
3. **TieredReservation은 node-wide다.** workload별 opt-out이 안 되므로 mixed pool에는 맞지 않을 수 있다. node pool 분리와 placement policy가 없는 도입은 보류하는 편이 안전하다.
4. **page cache는 눈에 덜 보이지만 limit에 청구된다.** 파일 읽기·indexing·image workload는 heap만 측정한 sizing으로는 충분하지 않다.
5. **기본 활성화는 기본 동작 변경이 아니다.** `memoryThrottlingFactor: null`, `memoryReservationPolicy: None`이면 새 cgroup 값이 쓰이지 않는다. 반대로 기존 explicit config는 업그레이드 뒤에도 계속 효과가 있다.
6. **cgroup v1 또는 오래된 kernel은 canary 대상이 아니다.** 먼저 node OS·kernel·runtime 표준화를 끝내고 cgroup v2 pool에서만 검증한다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 후보 node가 Linux cgroup v2이며 `memory.high` 용 kernel 권장 버전을 충족한다.
- [ ] 모든 후보 pool의 kubelet config와 기존 explicit Memory QoS 값을 inventory했다.
- [ ] 대상 workload의 request/limit, RSS, cache, sidecar, OOM 원인을 p99 기준으로 기록했다.
- [ ] `memory.events`, memory PSI, p99, queue depth, restart, eviction을 하나의 dashboard에서 본다.
- [ ] throttling과 TieredReservation을 같은 canary에서 동시에 켜지 않는다.
- [ ] canary는 1~2 node 또는 5% 이하 capacity이고 48시간 및 대표 부하를 통과한다.
- [ ] 중단 기준과 rollback pool 여유 capacity, kubelet·Pod restart 절차를 사전에 검증했다.

### 연습

Burstable API 하나를 골라 request 512MiB, limit 2GiB, `memoryThrottlingFactor: 0.9`일 때 `memory.high`가 어디에 생기는지 계산해 보자. 그 값은 약 1.84GiB다. 이어서 최근 p99 working set, page cache, request queue 길이를 같은 chart에 놓는다. `memory.high`를 켰을 때 줄이고 싶은 실패가 OOM인지, node-wide reclaim인지, 단순히 잘못 잡은 heap limit인지 먼저 답할 수 있어야 Memory QoS의 rollout 범위를 정할 수 있다.
