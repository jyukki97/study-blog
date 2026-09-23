---
title: "2026 개발 트렌드: Kubernetes v1.37 In-Place Resize Preemption, 무중단 확장보다 퇴출 예산을 먼저 설계하자"
date: 2026-09-14T10:06:00+09:00
lastmod: 2026-09-14T10:06:00+09:00
draft: false
tags: ["Kubernetes", "Kubernetes v1.37", "In-Place Pod Resize", "Preemption", "PriorityClass", "Capacity Planning", "SRE"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes in-place resize preemption", "InPlacePodVerticalScalingSchedulerPreemption", "ResizeDeferred", "PriorityClass", "Kubernetes capacity budget"]
description: "Kubernetes v1.37의 in-place Pod resize scheduler preemption Alpha를 계기로, restart 없는 scale-up을 목표로 삼지 않고 어떤 workload를 언제 퇴출해도 되는지 priority·PDB·capacity·rollback 예산으로 설계하는 기준을 정리합니다."
summary: "v1.37은 노드 여유가 부족해 Deferred가 된 고우선순위 Pod의 in-place resize를 위해 저우선순위 Pod를 preempt할 수 있는 Alpha 기능을 추가했다. 이는 자동 확장 스위치가 아니라, 이미 실행 중인 workload의 중단 비용을 resize 요청과 교환하는 scheduling 정책이다. 첫 도입은 단일 node pool의 재시작 가능한 batch에 한정하고, preemption 0건·PDB 위반 0건·resize 완료 시간 같은 증거를 확보하는 shadow/canary여야 한다."
key_takeaways:
  - "Kubernetes v1.37의 scheduler preemption for in-place Pod resize는 Alpha이며 `InPlacePodVerticalScalingSchedulerPreemption` feature gate를 control plane과 kubelet에 함께 켜야 한다. 기본 production action으로 간주하면 안 된다."
  - "기능은 headroom 부족으로 `ResizeDeferred`가 된 resize를 다시 진행시키기 위해 lower-priority Pod를 preempt할 수 있다. 무중단 resize는 승격되는 Pod의 관점일 뿐, 희생되는 Pod에는 명시적 중단이다."
  - "PriorityClass 값은 중요도 표현일 뿐 안전한 퇴출 허가가 아니다. idempotency, checkpoint, PDB, shutdown time, replacement capacity를 함께 갖춘 workload만 후보가 될 수 있다."
  - "첫 canary는 1개 비핵심 pool과 1~2개의 재시작 가능한 batch deployment에서 시작하고, scheduler event·PDB·SLO·deferred duration을 48시간 이상 대조해야 한다."
operator_checklist:
  - "resize 대상과 preemption 후보를 namespace, PriorityClass, workload class, PDB, owner로 inventory화하고 default PriorityClass를 암묵적으로 쓰는 Pod를 제거한다."
  - "모든 candidate에 terminationGracePeriod, retry/idempotency, checkpoint 또는 safe retry, queue visibility timeout의 합이 운영 SLO와 맞는지 확인한다."
  - "control plane과 node version, feature gate 일관성, scheduler/kubelet event 수집, resize subresource RBAC를 staging에서 검증한다."
  - "preemption을 0건 목표로 관찰한 뒤에만 매우 좁은 workload class에 허용하며, 일반 web/API·stateful data plane·기본 priority Pod에는 자동 퇴출을 허용하지 않는다."
learning_refs:
  - title: "Kubernetes Rollout 전략"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "feature gate와 scheduler 변경을 canary·관찰·rollback 단위로 도입하는 기본 절차입니다."
  - title: "Capacity Planning·Little's Law·Saturation"
    href: "/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/"
    description: "node headroom과 queue 대기시간을 평균 CPU 사용률이 아닌 capacity budget으로 해석합니다."
  - title: "Priority Load Shedding·Bulkhead"
    href: "/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/"
    description: "중요도 차이를 실제 격리·중단 정책으로 만들 때의 서비스 설계 기준입니다."
  - title: "Kubernetes v1.37 Node Lifecycle Conditions"
    href: "/posts/2026-09-11-kubernetes-node-lifecycle-conditions-trend/"
    description: "노드 운영 의도를 행동 명령과 혼동하지 않고 상태 계약으로 다루는 방법을 연결합니다."
decision_guide:
  title: "resize preemption을 지금 어디까지 허용할까"
  intro: "판단 기준은 resize가 restart 없이 끝나는가가 아니라, preempt되는 workload의 중단 비용을 수치와 복구 절차로 감당할 수 있는가다."
  cases:
    - badge: "관찰만"
      title: "중요 API와 batch가 같은 node pool에 섞여 있고 priority/PDB inventory가 없는 cluster"
      fit: "Deferred resize와 potential victim을 기록해 capacity 부족의 원인을 먼저 분리할 수 있습니다."
      watchouts: "feature gate를 켜면 관찰만 되는 것이 아니라 scheduler 행동이 바뀔 수 있습니다. production gate 활성화는 보류합니다."
      next_step: "staging에서 priority·PDB·termination 시간과 ResizeDeferred event를 수집하고, pool 분리 또는 headroom 확보의 비용을 비교합니다."
    - badge: "제한 canary"
      title: "재시작 가능한 batch 또는 queue consumer가 별도 pool에 있고 checkpoint·idempotency가 검증된 경우"
      fit: "preemption이 생겨도 job이 중복 부작용 없이 재시도되고, core API의 p99 회복이라는 명확한 효과를 측정할 수 있습니다."
      watchouts: "PriorityClass가 낮다는 사실만으로 중단해도 안전한 것은 아닙니다. PDB와 queue lease가 충돌할 수 있습니다."
      next_step: "1~2 deployment, 1 node pool, 48시간에서 preemption·PDB violation·resize 완료 시간을 관찰하고 abort 조건을 적용합니다."
    - badge: "보류"
      title: "stateful database, non-idempotent payment worker, 기본 priority web/API에 자동 희생을 허용하려는 경우"
      fit: "중단 비용이 단순 재시작을 넘어 데이터 손상, 이중 처리, 고객 오류로 이어지는 workload입니다."
      watchouts: "무중단 scale-up이라는 표현이 victim의 강제 종료와 recovery 비용을 감춥니다."
      next_step: "node pool 격리, 예약 capacity, 수동 승인 resize, vertical autoscaling policy부터 검토합니다."
---

Pod의 CPU나 memory request가 부족해졌을 때 기존 선택지는 불편했다. Pod를 재생성해 더 큰 노드에 배치하거나, 노드에 여유가 생길 때까지 기다리거나, VPA 권고를 사람이 해석해 rollout했다. Kubernetes의 in-place Pod resize는 실행 중인 container 자원을 조정할 수 있게 하면서 이 간극을 줄였다. 하지만 노드의 allocatable headroom이 부족하면 kubelet은 resize를 `Deferred`로 남긴다. Pod는 살아 있지만 필요한 자원을 얻지 못한 채 기다린다.

Kubernetes v1.37은 이 deferred 상태를 위한 **scheduler preemption for in-place Pod resize**를 Alpha로 추가했다. `InPlacePodVerticalScalingSchedulerPreemption` feature gate를 켜면 scheduler가 높은 우선순위 Pod의 resize를 만족시키기 위해 같은 node의 낮은 우선순위 Pod를 preempt할 수 있다. 공식 발표의 핵심도 “resize가 자동으로 안전해졌다”가 아니라, 정적 배치 이후 생기는 자원 부족을 scheduler가 해소할 수 있는 경로가 열렸다는 것이다.

이 글은 [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Capacity Planning·Little's Law·Saturation](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/), [Priority Load Shedding·Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/), [Node Lifecycle Conditions](/posts/2026-09-11-kubernetes-node-lifecycle-conditions-trend/)를 resize 관점으로 연결한다. 중요한 질문은 “API Pod가 restart 없이 커질 수 있는가”가 아니라, **어느 workload를 얼마나 자주, 어떤 복구 증거가 있을 때 중단시켜도 되는가**다.

공식 자료는 [Kubernetes v1.37의 Scheduler Preemption for In-Place Pod Resize 발표](https://kubernetes.io/blog/2026/09/10/kubernetes-v1-37-scheduler-preemption-for-in-place-pod-resize-alpha/), [container resource resize 문서](https://kubernetes.io/docs/tasks/configure-pod-container/resize-container-resources/), [Pod Priority and Preemption 문서](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/), [PodDisruptionBudget 문서](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)를 기준으로 확인했다. Alpha 기능의 세부 동작과 feature gate는 이후 release에서 달라질 수 있으므로, 문서의 example을 production 정책으로 복사하지 않는다.

## 이 글에서 얻는 것

- `ResizeDeferred`가 의미하는 node headroom 문제와, v1.37이 scheduler preemption으로 메우려는 범위를 이해합니다.
- resize를 받는 high-priority Pod와 preempt되는 low-priority Pod의 가용성 비용을 분리해서 계산합니다.
- PriorityClass, PDB, termination grace, queue lease, checkpoint를 하나의 **퇴출 예산(eviction budget)** 으로 묶는 기준을 얻습니다.
- staging → 단일 pool → 제한 canary로 승격하기 위한 지표와 rollback 조건을 숫자로 정합니다.

## 핵심 개념/이슈

### 1) Deferred resize는 "더 큰 request"가 아니라 node-local capacity 문제다

실행 중인 Pod의 resource request를 늘리면 kubelet은 해당 node에 추가 allocation을 수용할 여유가 있는지 본다. 여유가 없으면 resize 요청은 `ResizeDeferred` 상태가 될 수 있다. 이 상태가 곧 애플리케이션이 실패했다는 뜻은 아니지만, latency가 이미 악화됐거나 OOM 위험을 줄이려는 resize라면 기다리는 시간 자체가 SLO 비용이다.

v1.37의 Alpha 기능은 scheduler가 이 신호를 보고 lower-priority Pod를 preempt해 공간을 만든 뒤, deferred resize가 진행되도록 한다. 이것은 새 Pod를 우선 배치할 때의 preemption과 비슷해 보이지만 이미 실행 중인 workload가 resource를 키우는 상황이라는 점이 다르다. high-priority Pod에는 restart 없는 resize일 수 있어도 low-priority Pod에는 명시적인 중단·재시작·재처리 비용이 생긴다.

따라서 용량 문제를 다음처럼 나눠 관찰해야 한다.

| 관측값 | 해석 | 먼저 확인할 것 |
| --- | --- | --- |
| `ResizeDeferred` 횟수 | 해당 node의 resize headroom 부족 | request 증가량, node allocatable, 기존 reserved request |
| deferred 지속 시간 | scheduler/용량이 부족한 시간 | scale-out 가능 여부, autoscaler delay, victim 후보 |
| preemption 횟수 | 다른 workload에 전가된 가용성 비용 | victim class, PDB, retry/중복 처리 결과 |
| resize 완료 뒤 p99/오류율 | resize가 실제로 SLO를 회복했는지 | application bottleneck이 CPU/memory였는지 |

CPU utilization 40%라는 평균만 보고 “여유가 있다”고 결론 내리면 안 된다. scheduler는 실제 request와 node-local placement를 본다. 한 node에 특정 request가 몰렸거나 fragmentation이 크면 평균 사용률과 상관없이 deferred가 발생한다.

### 2) PriorityClass는 권리의 순서이지 희생의 안전 보증이 아니다

PriorityClass는 scheduler에게 상대적 중요도를 알린다. 하지만 `priority=1000`인 Pod가 `priority=100`인 Pod를 밀어낼 수 있다는 사실은 낮은 priority Pod가 안전하게 종료된다는 증명이 아니다. preemption 후보에는 최소한 아래 다섯 사실이 있어야 한다.

1. 작업이 멈춰도 고객 데이터나 외부 부작용이 중복되지 않는다.
2. `terminationGracePeriodSeconds` 안에 checkpoint, offset commit, lease release 또는 safe retry가 끝난다.
3. PDB가 보호해야 할 replica 수와 충돌하지 않는다.
4. 다시 배치될 node/pool 또는 queue 처리 여력이 있다.
5. owner가 event와 job outcome을 보고 복구 여부를 판단할 수 있다.

예를 들어 image thumbnail 생성 worker는 object key 기반 멱등성이 있고 결과를 overwrite할 수 있다면 좋은 초기 후보다. 반면 결제 capture worker, DB primary, migration job, in-memory session owner는 낮은 priority여도 자동 preemption 후보가 아니다. 비용을 줄이려고 priority를 낮게 준 것이 “강제 종료 승인”으로 해석되면 안 된다.

### 3) PDB는 모든 중단을 막는 안전망이 아니다

PodDisruptionBudget은 voluntary disruption에 대한 availability budget을 표현한다. scheduler preemption, node failure, application crash처럼 모든 경로에 동일하게 적용된다고 가정하면 위험하다. 기능을 켜기 전에 cluster 버전과 실제 preemption 흐름에서 PDB가 어떻게 관찰되는지 staging으로 검증하고, PDB만으로 stateful workload의 안전을 선언하지 않는다.

특히 `minAvailable`이나 `maxUnavailable` 값을 정할 때 replica 수만 세면 부족하다. traffic drain, readiness recovery, cache warm-up, leader election, downstream rate limit까지 포함한 **실제 회복 시간**을 budget에 넣어야 한다. 3 replica API에서 한 Pod가 종료된 뒤 readiness까지 p95 75초가 걸린다면, 30초마다 resize preemption이 반복되는 정책은 replicas가 3개여도 서비스에 압박을 준다.

### 4) feature gate 일관성은 최소 조건이다

공식 안내에 따르면 이 기능은 Kubernetes v1.37 이상과 함께 control plane 구성요소(`kube-apiserver`, `kube-scheduler`) 및 kubelet에 feature gate를 켜야 한다. 일부 node만 다르거나 rollout 중 설정이 섞이면 resize가 특정 node에서만 다르게 보일 수 있다. Gate가 enabled라는 것은 scheduler action이 가능하다는 뜻이지, workload policy가 준비됐다는 뜻이 아니다.

기술 검증과 운영 승인 기준을 분리한다.

| 층위 | 통과 질문 | 통과해도 아직 하지 말 일 |
| --- | --- | --- |
| 기능성 | Deferred 뒤 scheduler event와 resize complete가 보이는가 | 모든 namespace에 gate 적용 |
| 안전성 | victim이 idempotent하게 재시작되고 PDB/SLO 위반이 없는가 | stateful/결제 workload 포함 |
| 효과 | high-priority p99와 error budget이 실제 개선되는가 | capacity 부족을 preemption으로만 해결 |
| 운영성 | on-call이 victim·reason·rollback을 10분 안에 판단하는가 | 수동 승인 없는 전면 자동화 |

## 실무 적용

### 1) resize와 퇴출을 같은 capacity budget으로 모델링한다

resize request를 추가 CPU·memory, victim을 해제 가능한 request, node에 남겨야 할 headroom으로 표현한다. 예를 들어 node allocatable이 8 CPU이고, high-priority Pod가 4→6 CPU로 +2 CPU resize를 원하며 현재 headroom이 1 CPU라면 scheduler는 최소 1 CPU 이상의 victim request를 찾아야 한다. 그러나 여기서 “1 CPU짜리 아무 Pod”가 답은 아니다.

다음처럼 정책을 문서로 만든다.

```text
high-priority resize 허용: API tier-0, request delta <= 1 CPU 또는 2 GiB
victim 후보: batch-low, checkpoint 완료 <= 20초, external side effect 없음
보호 대상: database, payment, migration, default-priority API
node reserve: allocatable의 15% 또는 1 CPU 중 큰 값
자동 preemption 상한: node당 1회 / 30분, pool당 3회 / 1시간
```

수치는 예시이며 workload의 recovery p95와 traffic pattern으로 조정해야 한다. 중요한 것은 `PriorityClass`만 남기지 않고 “resize request의 상한”, “희생 가능 작업”, “남겨 둘 여유”, “반복 횟수”를 한 정책에서 연결하는 점이다. preemption이 잦다면 feature가 잘 작동하는 것이 아니라 request 산정, node packing, HPA/VPA, pool isolation 중 하나가 틀렸다는 신호로 본다.

### 2) 먼저 preemption 없이 deferred를 관찰한다

production gate를 바로 활성화하지 말고 staging에서 high/low PriorityClass, 의도적으로 부족한 node headroom, resize subresource RBAC를 만든다. high-priority Pod의 request를 올려 `ResizeDeferred` event를 확인하고, 다음 이벤트 순서와 실제 cgroup allocation을 기록한다.

```text
ResizeDeferred
  -> scheduler가 victim 선택 또는 보류한 근거
  -> victim Preempted / termination event
  -> ResizeStarted
  -> ResizeCompleted 또는 다시 Deferred
```

그 다음 production에서는 gate 없이도 deferred 시간, candidate victim, autoscaler action, API SLO를 dashboard로 모은다. 2주 데이터를 보면 resize preemption이 실제로 필요한 희귀 spike인지, 예약 headroom과 node pool 분리로 더 싸게 해결할 구조적 부족인지 구분할 수 있다.

### 3) 단일 pool에서 48시간 제한 canary를 실행한다

canary는 high-priority API 하나와 재시작 가능한 batch/consumer 하나가 **전용 node pool**에 있는 경우로 제한한다. customer-facing API와 DB, migration, baseline web workload가 섞인 일반 pool은 첫 대상이 아니다. 48시간 동안 다음 기준을 동시에 통과해야 다음 대상으로 넓힌다.

| 지표 | 승격 기준 | 즉시 중단/rollback 기준 |
| --- | --- | --- |
| 의도하지 않은 victim | 0건 | 보호 대상 또는 default priority가 1건이라도 victim |
| PDB/SLO 위반 | 0건 | availability SLO breach 또는 PDB 관련 unexpected event |
| resize 완료 시간 p95 | 2분 이하 또는 기존 대비 50% 개선 | 10분 초과 deferred가 2회 |
| victim 복구 p95 | checkpoint 포함 2분 이하 | duplicate side effect, data repair 필요 |
| preemption 빈도 | pool당 3회/시간 미만 | 5회/시간이 15분 지속 |
| high-priority p99 | baseline 대비 악화 없음 | +10%가 10분 지속 |

“preemption 0건”도 성공적인 canary 결과일 수 있다. 실제로는 scheduler가 불필요하게 행동하지 않았고, headroom 또는 autoscaler가 충분했다는 뜻일 수 있다. 이 경우 feature를 더 넓히는 대신 deferred 원인이 node fragmentation인지 request inflation인지 점검하는 편이 좋다.

### 4) event와 ownership을 runbook에 넣는다

on-call이 high-priority Pod만 보고 “resize가 성공했다”고 끝내면 victim의 backfill·duplicate·queue lag를 놓친다. alert에는 최소한 resize 대상, request delta, node, victim list, PriorityClass, PDB 상태, queue lag, rollback flag가 함께 있어야 한다.

우선순위는 다음처럼 고정할 수 있다.

1. data integrity와 customer action의 중복 여부를 확인한다.
2. victim workload의 recovery/queue lag가 SLO 안인지 확인한다.
3. high-priority Pod의 allocation과 p99가 회복됐는지 확인한다.
4. 같은 node/pool에서 재발하면 preemption을 끄고 capacity·autoscaling·packing을 조사한다.

이 순서는 high-priority API의 latency가 중요하지 않아서가 아니다. preemption으로 만든 숨은 부채가 늦게 나타나도 되돌릴 수 있도록, 먼저 irreversible side effect를 보는 것이다.

## 트레이드오프/주의점

### "무중단"이라는 단어가 비용을 가린다

in-place resize는 high-priority Pod의 restart를 피할 수 있다. 그러나 그 자원을 만들기 위해 victim이 종료된다면 cluster 전체 관점에서는 가용성 비용을 옮긴 것뿐이다. batch가 안전하게 재시작되는지, queue가 중복을 흡수하는지, downstream가 burst를 견디는지를 증명하지 못하면 무중단이라는 표현을 운영 결론으로 쓰지 않는다.

### preemption은 capacity planning의 대체품이 아니다

지속적으로 deferred가 발생하는 pool은 피크 capacity가 부족하거나 request가 실제 사용량과 맞지 않거나, heterogeneous workload가 한 node에 섞였을 가능성이 크다. 이 경우 preemption을 자주 허용하면 high-priority 부하는 빨라질 수 있어도 batch starvation, queue lag, noisy-neighbor 문제가 늘어난다. headroom reservation, node pool 분리, HPA/VPA tuning, cluster autoscaler latency를 먼저 비교해야 한다.

### Alpha gate는 전체 제어면을 바꾼다

기능이 Alpha이고 feature gate가 여러 component에 걸친다는 점도 중요하다. upgrade·rollback 시 gate 조합, node 교체, scheduler event schema, autoscaler와의 상호작용을 실제 버전에서 확인해야 한다. feature gate를 켠 상태에서 policy 오류가 나면 단순 application rollback으로 scheduler behavior가 사라지지 않을 수 있으므로, gate off 절차와 node rollout 영향을 runbook에 함께 둔다.

## 체크리스트

- [ ] v1.37 이상 control plane과 모든 대상 kubelet의 version/gate 조합을 inventory로 확인했는가?
- [ ] `ResizeDeferred`, `ResizeStarted`, `ResizeCompleted`, `Preempted` event를 workload·node·PriorityClass별로 조회할 수 있는가?
- [ ] resize 대상의 최대 delta와 node reserve를 숫자로 정했는가?
- [ ] victim 후보가 idempotency, checkpoint/safe retry, termination 시간, queue lease 검증을 통과했는가?
- [ ] PriorityClass 기본값을 암묵적으로 사용하는 Pod와 stateful·결제·migration workload를 자동 victim에서 제외했는가?
- [ ] PDB를 실제 preemption 흐름과 cluster version에서 검증했으며, PDB만을 data integrity 보증으로 쓰지 않는가?
- [ ] 1개 pool·1~2 deployment·48시간 canary의 preemption 상한과 abort 조건을 정했는가?
- [ ] gate off, victim scale-out, high-priority resize 취소의 rollback owner와 10분 이내 판단 기준이 문서화됐는가?

### 연습: restart 없는 확장과 안전한 중단을 함께 증명하기

1. constrained staging node에 4 CPU high-priority Pod와 3 CPU low-priority batch Pod를 배치해 1 CPU headroom을 남긴다.
2. high-priority Pod를 6 CPU로 resize해 `ResizeDeferred`가 발생하는지 확인한다.
3. feature gate를 시험 환경에만 켠 뒤, low-priority Pod가 preempt됐을 때 checkpoint·queue re-delivery·idempotency key가 중복 side effect 없이 복구되는지 검사한다.
4. high-priority Pod의 `allocatedResources`, p99, error rate와 low-priority job의 lag·완료 수를 같은 시간축에 놓는다.
5. 마지막으로 victim을 보호 대상(PDB가 있는 stateful Pod 또는 non-idempotent worker)으로 바꾼 fixture에서 automation을 허용하지 않고 alert/abort로 끝나는지 테스트한다.
