---
title: "2026 개발 트렌드: Kubernetes v1.37 Metrics API GA와 DRA 상태, 자원 관측이 스케줄링 계약이 된다"
date: 2026-09-02T10:06:00+09:00
lastmod: 2026-09-02T10:06:00+09:00
draft: false
tags: ["Kubernetes", "Metrics API", "Dynamic Resource Allocation", "DRA", "ResourceClaim", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37 Metrics API v1", "metrics.k8s.io v1", "Dynamic Resource Allocation", "ResourceClaim status devices", "Kubernetes DRA observability"]
description: "Kubernetes v1.37에서 stable이 된 metrics.k8s.io/v1과 Dynamic Resource Allocation의 ResourceClaim device status를 계기로, CPU·메모리 표본과 특수 장치 할당 상태를 각각 검증 가능한 자원 계약으로 운영하는 기준을 정리합니다."
summary: "Kubernetes v1.37은 CPU·메모리 resource metrics API를 v1으로 안정화하고, DRA ResourceClaim의 장치 상태를 stable로 올렸다. 중요한 변화는 새 대시보드를 하나 더 만드는 일이 아니라, metrics freshness·API version·device driver 상태·RBAC·스케줄링 결과를 서로 다른 진실 원천으로 분리해 검증해야 한다는 점이다."
key_takeaways:
  - "metrics.k8s.io/v1은 기존 v1beta1과 같은 NodeMetrics·PodMetrics 형태를 stable API로 제공한다. 새 지표나 HPA 동작 변경이 아니며, Kubernetes v1.37 HPA는 여전히 v1beta1만 사용한다."
  - "DRA의 ResourceClaim.status.devices는 driver가 할당한 GPU·NIC 등 장치의 상태를 보고할 수 있는 stable 경로지만, driver별 데이터 정확도와 최소 권한 RBAC를 별도로 검증해야 한다."
  - "CPU·메모리 표본, HPA 입력, DRA 장치 상태, 실제 업무 처리량은 서로 대체할 수 없다. freshness·할당·건강·사용자 SLO를 같은 대시보드에서 교차 검증해야 한다."
  - "v1.37 도입은 모든 device plugin을 급히 DRA로 바꾸는 작업이 아니다. API discovery, metrics implementation 호환성, ResourceClaim status writer, rollback 기준을 갖춘 workload별 canary가 우선이다."
operator_checklist:
  - "metrics.k8s.io API discovery와 v1.metrics.k8s.io APIService 상태를 먼저 확인하고, v1beta1 consumer를 없다고 가정하지 않는다."
  - "resource metrics의 timestamp와 window를 freshness 지표로 수집하고, 지연·누락 상태에서 자동 scale-down 또는 capacity 판단을 확대하지 않는다."
  - "DRA driver가 쓰는 ResourceClaim status writer ServiceAccount와 synthetic subresource 권한을 문서화하고, broad cluster-admin 권한으로 우회하지 않는다."
  - "DRA canary에서는 ResourceClaim 할당, device condition, Pod readiness, 실제 accelerator/NIC job 성공률, device taint/eviction을 함께 확인한다."
learning_refs:
  - title: "Kubernetes v1.37 Scale-to-Zero와 Control Plane 회복력"
    href: "/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/"
    description: "외부 업무 지표로 HPA를 깨우고 control plane overload를 다루는 기준입니다."
  - title: "Kubernetes Custom Metrics와 Autoscaling Contract"
    href: "/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/"
    description: "CPU·메모리 밖의 업무 신호가 autoscaling 결정을 할 때 필요한 freshness와 보호 규칙입니다."
  - title: "Capacity Planning과 Little's Law"
    href: "/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/"
    description: "자원 사용률을 처리량, 대기열, 포화와 함께 해석하는 기본 틀입니다."
  - title: "Kubernetes Rollout 전략"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "플랫폼 API·driver 변경을 canary와 rollback으로 전개하는 절차입니다."
---

Kubernetes v1.37은 2026년 8월 26일 공개됐고, 그 다음 날 resource Metrics API가 `metrics.k8s.io/v1`으로 stable이 됐습니다. 같은 릴리스에서 Dynamic Resource Allocation(DRA)의 `ResourceClaim.status.devices`도 stable이 됐습니다. 하나는 CPU·메모리 사용량을 읽는 오래된 API의 버전 약속이고, 다른 하나는 GPU·NIC 같은 특수 장치가 실제로 무엇을 할당받고 어떤 상태인지 driver가 보고하는 경로입니다.

두 변화는 직접 연결된 기능처럼 보이지 않습니다. 하지만 platform 팀의 운영 질문은 같습니다. “Pod가 CPU를 얼마나 썼는가”와 “이 Pod가 어떤 장치를 받았고 정상인가”와 “그 결과 실제 업무가 처리됐는가”를 같은 숫자로 답하려 하면 틀립니다. v1.37의 실무적 의미는 **자원 관측을 한 API에 몰아넣는 대신, 측정·할당·건강·업무 결과의 계약을 분리하고 교차 검증하는 방향**에 있습니다.

이 글은 [Kubernetes v1.37 Scale-to-Zero와 Control Plane 회복력](/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/), [Kubernetes Custom Metrics와 Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/), [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/), [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)의 다음 단계로 읽을 수 있습니다.

참고한 공식 자료:

- Kubernetes Blog, [Kubernetes v1.37: Garhwal](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)
- Kubernetes Blog, [Metrics API graduates to stable](https://kubernetes.io/blog/2026/08/27/kubernetes-v1-37-metrics-api-ga/)
- Kubernetes Docs, [Kubernetes Metrics v1 API](https://kubernetes.io/docs/reference/external-api/metrics.v1/)
- Kubernetes Docs, [Observability of Dynamic Resources](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/dra-observability/)
- Kubernetes Docs, [Harden Dynamic Resource Allocation](https://kubernetes.io/docs/tasks/administer-cluster/hardening-dra/)

## 이 글에서 얻는 것

- `metrics.k8s.io/v1` 안정화가 무엇을 보장하고, 무엇을 새로 보장하지 않는지 구분합니다.
- `kubectl top`, HPA 입력, business metric을 같은 것으로 취급하지 않는 이유를 이해합니다.
- ResourceClaim의 allocation·device status·device health를 DRA driver의 신뢰성과 RBAC 경계 안에서 해석할 수 있습니다.
- metrics API와 DRA를 어떤 순서로 discovery, canary, rollback할지 실무 기준을 세울 수 있습니다.

## 핵심 개념/이슈

### 1) Metrics API GA는 새 metric이 아니라 API 버전 계약이다

`metrics.k8s.io/v1`은 NodeMetrics와 PodMetrics를 제공하며, CPU와 memory working set 정보를 timestamp와 관측 window와 함께 돌려줍니다. `kubectl top`과 resource-metrics 기반 HPA가 오래 사용해 온 데이터 경로입니다. v1.37의 GA는 이 API가 stable Kubernetes API의 호환성 약속을 얻었다는 뜻이지, 새 GPU 사용률·queue depth·application latency가 생겼다는 뜻은 아닙니다.

특히 두 가지를 분리해야 합니다.

- **metrics-server/API 구현체**: aggregation layer를 통해 `v1.metrics.k8s.io`를 실제로 serve하고 APIService가 Available이어야 합니다.
- **HPA controller**: v1.37에서는 여전히 `v1beta1`만 사용합니다. discovery 기반으로 v1과 v1beta1 중 하나를 고르는 지원은 계획돼 있지만 이 릴리스의 HPA 동작 변경은 아닙니다.

따라서 “클러스터를 1.37로 올렸으니 `v1beta1`을 바로 제거한다”는 결론은 위험합니다. custom dashboard, admission check, exporter, 오래된 client가 어느 version endpoint를 읽는지 먼저 찾고, metrics implementation은 전환 기간에 두 버전을 모두 제공하는 편이 안전합니다.

```bash
kubectl get --raw /apis/metrics.k8s.io/ | jq .
kubectl get apiservice v1.metrics.k8s.io
```

이 두 확인은 API를 쓸 수 있는지 알려 주지만, 데이터가 제품 의사결정에 충분히 최신인지는 말해 주지 않습니다. `timestamp`와 `window`를 함께 저장하지 않으면, 2분 전 CPU 표본을 방금 수집한 값처럼 읽고 scale-down이나 capacity 확대를 승인할 수 있습니다.

### 2) CPU·메모리 사용률은 용량 결정의 한 입력일 뿐이다

resource Metrics API는 Pod와 Node의 현재 자원 사용을 보기 좋게 표준화합니다. 그러나 낮은 CPU가 곧 여유라는 뜻은 아닙니다. Pod가 DB connection pool, 외부 API quota, GPU queue, lock wait에서 막히면 CPU는 낮아도 사용자 지연과 backlog가 계속 늘 수 있습니다. 반대로 batch workload는 CPU가 높아도 deadline 안에 끝나면 문제없을 수 있습니다.

그래서 resource metric을 다음 네 층 가운데 하나로만 둡니다.

| 층 | 대표 신호 | 답하는 질문 |
| --- | --- | --- |
| 측정 | Pod/Node CPU, memory working set, timestamp/window | 지금 자원 압력이 있는가? |
| 제어 | HPA target, max replicas, stabilization window | 어떤 조건에서 replica를 바꿀 것인가? |
| 할당 | ResourceClaim allocation, device topology, reservation | 어떤 특수 장치가 이 workload에 배정됐는가? |
| 결과 | queue oldest age, job success rate, p95, error rate | 고객 작업이 목표 시간 안에 끝나는가? |

[Custom Metrics와 Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/)에서 다룬 것처럼, queue consumer의 replica는 CPU보다 oldest message age와 downstream 동시성으로 결정되는 경우가 많습니다. [Scale-to-Zero 글](/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/)의 `minReplicas: 0` 역시 Pod가 0개일 때 읽을 수 있는 external/object metric이 필요합니다. Metrics API GA가 custom metric이나 wake-up signal을 대체하지 않는 이유입니다.

초기 운영 기준은 간단하게 둘 수 있습니다. metric timestamp가 60초 이상 늦거나, 정해진 수집 간격의 3배 동안 새 표본이 없으면 autoscaling 확대·축소 판단을 보류하고 관측 파이프라인부터 확인합니다. 이 숫자는 보편적 정답이 아니라 데이터 수집 간격과 SLO를 반영한 출발점입니다. 중요한 것은 stale metric을 0 사용률로 해석하지 않는 일입니다.

### 3) DRA 상태는 “특수 장치를 받았다”를 데이터로 보여 주는 경로다

기존 extended resource와 device plugin 모델은 GPU 수량 같은 요청을 잘 표현했지만, Pod가 어떤 구체적 장치와 네트워크 인터페이스를 받았고 driver가 어떤 상태를 보고하는지 표준적으로 연결하기 어려운 경우가 있었습니다. DRA는 workload가 `ResourceClaim`으로 장치를 요청하고 scheduler와 driver가 이를 할당하는 모델입니다.

v1.37에서 stable이 된 `ResourceClaim.status.devices`에는 driver별 device status를 담을 수 있습니다. 예를 들어 NIC driver는 할당된 interface name과 IP 주소를, accelerator driver는 장치 상태를 보고할 수 있습니다. 이 정보는 “기기가 할당됐는가”와 “Pod가 실제 일을 하는가” 사이의 빈칸을 줄여 줍니다. 하지만 Kubernetes 문서도 driver가 넣는 상태 값의 정확도는 driver에 따라 다르므로 그 값만으로 장치의 유일한 진실 원천이라고 보지 말라고 명시합니다.

따라서 DRA의 읽기 모델은 다음처럼 나눕니다.

```text
ResourceClaim.status.allocation  -> scheduler가 무엇을 배정했는가
ResourceClaim.status.devices     -> driver가 해당 장치의 구체 상태를 어떻게 보고하는가
Pod readiness / job success      -> workload가 그 장치로 실제 시작·처리를 했는가
device telemetry / vendor health -> 장치가 물리적으로 건강한가
```

allocation이 성공했는데 job이 실패한다면, scheduler보다 driver prepare 단계, 컨테이너 권한, device metadata, 애플리케이션 초기화를 먼저 좁혀야 합니다. 반대로 driver status가 `NetworkReady=True`여도 실제 서비스 요청이 실패하면 CNI, 보안 그룹, 이름 해석, 대상 의존성을 따로 봐야 합니다. 이 분리는 [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)에서 말한 증거 연결 원칙과 같습니다.

### 4) DRA status writer는 관측 권한이 아니라 제어 권한이 될 수 있다

`ResourceClaim.status.devices`는 아무 ServiceAccount나 쓰게 두면 안 됩니다. DRA status update는 driver가 장치 상태를 표현하는 제어면의 일부이고, Kubernetes는 synthetic subresource와 node-aware 권한을 이용해 세분화한 승인을 요구합니다. driver가 cluster-admin으로 모든 ResourceClaim을 수정하게 만들면 편해 보이지만, 손상된 driver가 다른 workload의 상태·할당 흐름에 영향을 줄 수 있습니다.

도입 전에 아래 세 가지를 문서화합니다.

1. 어떤 scheduler, allocation controller, node-local driver가 어느 status field를 쓰는가
2. 각 writer의 ServiceAccount가 필요한 namespace·node·subresource에만 patch/update 권한을 갖는가
3. status update 실패가 단순 dashboard 누락인지, Pod start/eviction에 영향을 주는 제어 실패인지

특수 장치 maintenance에는 DRA device taint/toleration도 고려 대상입니다. 다만 이는 “고장 난 GPU를 표시한다” 이상의 동작이 될 수 있습니다. `NoSchedule`은 새 Pod 배정을 막고, `NoExecute`는 tolerant하지 않은 이미 실행 중인 Pod를 축출할 수 있습니다. driver health 판정의 오탐이 곧 workload interruption이 될 수 있으므로, 첫 rollout은 informational condition과 alert부터 시작하고 eviction 효과는 명시적인 owner 승인과 canary 증거 뒤에 올리는 편이 좋습니다.

## 실무 적용

### 1) 먼저 API discovery와 metric freshness 기준을 고정한다

metrics API migration의 첫 작업은 코드 변경이 아니라 inventory입니다. cluster별로 다음을 기록하세요.

- metrics implementation의 버전과 `v1.metrics.k8s.io` APIService availability
- `v1beta1.metrics.k8s.io`를 직접 호출하는 dashboard, script, operator, exporter
- resource metric의 실제 timestamp lag와 수집 성공률
- HPA가 CPU/memory와 external/custom metric 중 무엇을 쓰는지

이 목록이 없으면 v1 API를 활성화해도 어느 consumer가 깨지는지 알 수 없습니다. 특히 HPA가 v1.37에서 v1beta1을 계속 쓴다는 사실을 기준선에 넣어야 합니다. 두 API를 짧게 병행하며 NodeMetrics/PodMetrics의 object 수, 대상 namespace, timestamp/window 분포가 기대와 같은지 비교한 뒤 client를 점진적으로 옮깁니다.

| 판정 | 시작 행동 | 확대 조건 |
| --- | --- | --- |
| v1 APIService가 없음 또는 Unavailable | metrics implementation/APIService부터 수정 | 24시간 안정 availability |
| v1beta1-only client가 존재 | dual serve 유지, client inventory 보완 | owner가 v1 호환·rollback 확인 |
| timestamp lag가 기준 초과 | HPA 설정 변경 보류, 수집 경로 진단 | p95 freshness가 목표 안 복귀 |
| CPU는 낮지만 queue age/p95 악화 | resource scale-down 보류 | 업무 지표와 병목 원인 확인 |

### 2) DRA는 한 driver·한 workload·한 failure mode부터 canary한다

DRA의 첫 후보는 장치 topology가 실제 성능·장애 판단에 중요한데, 운영자가 일단 수동 inventory로도 검증할 수 있는 workload입니다. 예를 들어 batch GPU worker나 보조 NIC를 쓰는 내부 서비스가 적합할 수 있습니다. 인증, 결제, 생산 line 같은 즉시 중단 비용이 큰 경로는 driver의 status semantics와 rollback이 검증되기 전에는 확대하지 않습니다.

canary 순서는 다음처럼 작게 잡습니다.

1. **claim fixture**: 정상 장치, 사용 불가 장치, 부족한 capacity, driver 응답 지연을 재현할 ResourceClaim과 Pod fixture를 만듭니다.
2. **권한 검사**: status writer ServiceAccount가 자신의 claim 상태만 갱신하고 다른 namespace/claim은 거절되는지 확인합니다.
3. **관측 연결**: allocation latency, `status.devices` condition, Pod readiness, device telemetry, job success를 동일 trace/job ID로 연결합니다.
4. **failure canary**: device가 unhealthy가 된 상황에서 새 할당, 기존 Pod, taint 적용, alert, 사람의 rollback 순서를 검증합니다.

처음 14일은 1개 driver와 저위험 namespace에 한정하고, 아래 기준을 만족할 때만 범위를 넓힙니다.

- ResourceClaim allocation p95와 Pod ready p95가 기존 방식보다 목표 SLO를 넘겨 악화하지 않는다.
- status writer 권한 거절, status update 오류, allocation timeout이 0건 또는 사전에 합의한 error budget 안이다.
- 할당 성공 후 실제 job 시작 실패가 기존 기준선보다 증가하지 않는다.
- rollback 뒤 기존 device plugin/요청 경로로 돌아가는 절차를 staging에서 한 번 완료했다.

### 3) 자원 대시보드를 “값”이 아니라 인과관계로 바꾼다

대시보드 한 화면에는 `CPU 70%`만 놓지 말고 다음 순서를 보이게 만드세요.

```text
metric timestamp/window
  -> Pod/Node resource usage
  -> HPA 또는 scheduler 결정
  -> ResourceClaim allocation / device status
  -> Pod ready 및 실제 job 처리량·오류율
```

이 흐름이 있으면 “GPU가 있는데 작업이 느리다”를 빠르게 분리할 수 있습니다. claim allocation이 늦으면 장치 공급·scheduler 문제를, allocation은 빠른데 ready가 늦으면 image pull·driver prepare·init container를, ready인데 job rate가 낮으면 애플리케이션·입력 queue·외부 의존성을 조사합니다. 자원 수치 하나의 평균값보다 [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)에서 다룬 처리량·대기열·포화의 관계가 운영 판단에 더 직접적입니다.

## 트레이드오프/주의점

첫째, Metrics API의 stable 표시는 API 호환성 약속입니다. metrics-server의 가용성, 수집 지연, API aggregation 장애, HPA의 version 사용 방식까지 자동으로 해결하지 않습니다. `kubectl top`이 나온다는 사실만으로 autoscaling 입력이 최신·완전하다고 가정하면 안 됩니다.

둘째, DRA는 device plugin보다 더 풍부한 모델을 제공할 수 있지만 driver, ResourceClaim lifecycle, kubelet node operation, RBAC, 상태 해석의 복잡도도 같이 가져옵니다. 단순히 GPU 개수만 요청하면 되는 서비스에 DRA를 서둘러 강제할 이유는 없습니다. topology, multi-device allocation, device health, 비표준 metadata가 실제 운영 문제를 줄이는 workload부터 판단하세요.

셋째, driver가 제공하는 `status.devices`에는 interface name, IP, 장치 ID 같은 민감한 인프라 메타데이터가 들어갈 수 있습니다. 누가 ResourceClaim을 읽고 watch할 수 있는지, 상태를 로그·analytics로 내보낼 때 무엇을 마스킹하는지 점검해야 합니다. 상태 관측을 위해 권한을 넓히는 일은 가장 나쁜 교환입니다.

넷째, device taint와 eviction은 장애 격리에 강하지만 오탐 비용이 큽니다. health signal의 false positive율, toleration 기간, 업무 재시작 비용, 사람이 확인할 time budget을 정하지 않은 상태에서 `NoExecute`를 자동화하지 마세요.

## 체크리스트 또는 연습

### 체크리스트

- [ ] `v1.metrics.k8s.io` API discovery와 APIService availability를 cluster별로 확인했다.
- [ ] v1.37에서 HPA가 `v1beta1`을 계속 사용한다는 사실을 반영해 dual-version consumer inventory를 만들었다.
- [ ] Pod/Node metric의 timestamp, window, freshness SLO가 있고 stale 표본을 0 사용률로 해석하지 않는다.
- [ ] CPU/memory, external/custom signal, HPA decision, business SLO를 서로 다른 지표로 본다.
- [ ] DRA driver별 ResourceClaim status writer와 최소 RBAC 권한이 문서화돼 있다.
- [ ] allocation, device condition, Pod readiness, 실제 job success를 한 correlation key로 추적한다.
- [ ] device taint/eviction은 fixture와 canary, rollback을 통과하기 전 자동 실행하지 않는다.

### 연습

1. 운영 클러스터 한 곳에서 `metrics.k8s.io` discovery 결과, APIService 상태, 최근 1시간의 timestamp lag p95를 기록하고 `v1beta1` consumer를 세 개 찾아보세요.
2. GPU 또는 NIC workload 하나를 가정해 allocation 성공, driver status 정상, Pod ready, job failure가 서로 다른 네 가지 장애 시나리오를 표로 작성해 보세요.
3. DRA driver가 `ResourceClaim.status.devices`를 갱신할 때 필요한 최소 권한과, 다른 namespace claim을 수정하려 할 때 기대하는 거절 결과를 test fixture로 만드세요.

## 관련 글

- [Kubernetes v1.37 Scale-to-Zero와 Control Plane 회복력](/posts/2026-08-27-kubernetes-137-scale-to-zero-control-plane-resilience-trend/)
- [Kubernetes Custom Metrics와 Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/)
- [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)
- [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)
