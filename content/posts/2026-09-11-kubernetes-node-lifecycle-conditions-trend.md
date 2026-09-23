---
title: "2026 개발 트렌드: Kubernetes v1.37 Node Lifecycle Conditions, 노드 정비를 자동화 전에 계약으로 만들기"
date: 2026-09-11T10:07:00+09:00
lastmod: 2026-09-11T10:07:00+09:00
draft: false
tags: ["Kubernetes", "Kubernetes v1.37", "Node Lifecycle Conditions", "Node Maintenance", "Platform Engineering", "SRE"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37 node lifecycle conditions", "DrainInProgress", "MaintenancePlanned", "Kubernetes node maintenance", "node lifecycle contract"]
description: "Kubernetes v1.37의 Node Lifecycle Conditions를 계기로 drain·maintenance·graceful shutdown 상태를 공통 계약으로 다루는 방법과, Alpha 신호를 자동 eviction 정책으로 오해하지 않는 운영 기준을 정리합니다."
summary: "Kubernetes v1.37은 drain·maintenance·graceful shutdown을 표현하는 다섯 NodeCondition 이름을 도입했다. 이 기능은 Alpha이며 기본으로 꺼져 있고, 현 릴리스에서 core controller가 이 신호를 보고 scheduling·eviction을 바꾸지 않는다. 따라서 첫 실무 적용은 자동 조치가 아니라 상태의 author·freshness·관측·rollback을 명시하는 node lifecycle 계약이어야 한다."
key_takeaways:
  - "v1.37의 DrainInProgress, Drained, MaintenancePlanned, MaintenanceInProgress, GracefulNodeShutdownInProgress는 node의 운영 의도를 표현하는 공통 이름이다. Node Ready, taint, cordon, drain을 대체하지 않는다."
  - "NodeLifecycleConditions feature gate는 Alpha이며 v1.37에서 기본 비활성화다. gate를 켜도 core workload controller가 이 상태를 자동 소비하지 않으므로, 이를 근거로 자동 eviction이나 재스케줄을 설계하면 안 된다."
  - "현재는 administrator 또는 권한을 위임받은 controller가 condition을 설정·해제한다. condition 작성 권한, source, freshness를 정하지 않으면 단순 상태 문자열이 신뢰할 수 없는 운영 입력이 된다."
  - "첫 canary의 목표는 schedule 자동화가 아니라 dashboard·runbook·drain 기록의 일관성이다. 1~2 node, 48시간, 기존 cordon/drain 절차와 대조하는 방식이 안전하다."
operator_checklist:
  - "condition을 쓸 controller/service account, Node patch 권한, owner, audit log, clear 조건을 문서화한다. 사람이 kubectl로 임의 설정하는 경로와 자동 controller를 섞지 않는다."
  - "v1.37에서는 cordon, drain, taint, PodDisruptionBudget, load balancer deregistration을 기존 절차대로 유지한다. 새 condition은 관측·의사소통 신호로만 사용한다."
  - "condition source, lastTransitionTime, 메시지, change ticket, maintenance window를 dashboard와 event log에서 함께 연결한다. 10분 이상 갱신되지 않은 maintenance 신호는 사람이 확인한다."
  - "새 상태를 읽는 내부 automation은 staging에서만 shadow mode로 시작하고, 예상 행동과 실제 cordon/drain 결과가 100% 일치하는지 48시간 이상 확인한다."
learning_refs:
  - title: "Kubernetes Rollout 전략"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "노드 풀 변경을 canary·drain·rollback으로 운영하는 기본 절차입니다."
  - title: "Graceful Shutdown"
    href: "/learning/deep-dive/deep-dive-graceful-shutdown/"
    description: "프로세스 종료 신호와 in-flight 요청의 처리 경계를 정리합니다."
  - title: "Load Balancer Health Check"
    href: "/learning/deep-dive/deep-dive-load-balancer-healthchecks/"
    description: "traffic drain과 readiness 신호를 같은 것으로 보지 않는 기준입니다."
  - title: "Kubernetes v1.37 Rootless Node Components"
    href: "/posts/2026-09-08-kubernetes-rootless-node-components-trend/"
    description: "새 node capability를 별도 pool·호환성·rollback 계약으로 도입하는 방식입니다."
decision_guide:
  title: "Node Lifecycle Conditions를 지금 무엇에 써도 되는가"
  intro: "v1.37의 현재 구현은 상태 이름과 공유 언어를 제공한다. 실제 scheduling/eviction 동작이 추가됐다고 가정하지 말고, 소비자 영향이 낮은 순서로 승격한다."
  cases:
    - badge: "지금 적용"
      title: "운영 dashboard, change ticket, runbook의 상태 통일"
      fit: "drain·maintenance의 담당자와 시간 창을 여러 도구가 서로 다르게 표현해 혼선이 있는 cluster입니다."
      watchouts: "condition만 보고 traffic 제거 또는 Pod eviction을 실행하면 안 됩니다."
      next_step: "1~2 node에서 48시간 기존 절차와 병행해 condition·event·drain 기록의 일치율을 확인합니다."
    - badge: "조건부"
      title: "내부 automation의 shadow evaluation 입력"
      fit: "condition writer의 RBAC와 audit trail, stale 판정, manual override가 이미 있는 platform입니다."
      watchouts: "writer가 여러 개이면 같은 node에 상충하는 상태가 기록될 수 있습니다."
      next_step: "automation은 행동하지 않고 예상 action만 기록해, 기존 runbook과 100% 일치할 때까지 비교합니다."
    - badge: "보류"
      title: "condition만으로 실행하는 자동 cordon·eviction·capacity 감소"
      fit: "core controller가 소비하지 않는 Alpha 신호를 production action의 단일 입력으로 쓰려는 경우입니다."
      watchouts: "stale·오작성 condition 하나가 불필요한 대규모 reschedule을 유발할 수 있습니다."
      next_step: "기존 drain/PDB/traffic drain 절차와 독립적인 rollback·human approval 근거를 먼저 만듭니다."
faqs:
  - question: "Node Lifecycle Conditions가 도입되면 cordon과 drain은 필요 없나요?"
    answer: "필요합니다. v1.37의 condition은 node의 lifecycle 의도를 표현하는 신호이며, cordon·drain·taint·PodDisruptionBudget이 수행하는 scheduling과 eviction 동작을 대체하지 않습니다."
  - question: "feature gate를 켜면 workload controller가 MaintenancePlanned를 읽어 Pod를 옮기나요?"
    answer: "아닙니다. v1.37에서는 feature gate가 기본 비활성화이고, 활성화해도 core component가 해당 condition을 소비해 동작을 바꾸지 않습니다. 운영자가 또는 권한 있는 controller가 상태를 기록하는 단계입니다."
  - question: "그럼 지금 도입할 가치는 없나요?"
    answer: "있습니다. node 정비의 source·time window·owner를 공통 형식으로 남기고 dashboard와 runbook에서 해석을 맞추는 기반이 됩니다. 다만 자동 조치의 근거로 승격하기 전에는 shadow 검증이 필요합니다."
---

Kubernetes에서 node 정비는 보통 여러 신호로 흩어진다. 운영자는 `kubectl cordon`으로 새 Pod 배치를 막고, `drain`으로 기존 Pod를 옮기며, taint나 PodDisruptionBudget으로 예외를 다룬다. load balancer는 별도의 health check로 traffic을 뺀다. 이 절차 자체는 맞지만 "이 node가 왜 비어 가는가", "언제 정비가 시작되는가", "drain이 끝났는가"는 label·event·티켓·채팅에 따로 남기기 쉽다.

Kubernetes v1.37이 도입한 **Node Lifecycle Conditions**는 이 간극을 공통 상태 이름으로 메우려는 움직임이다. 새 이름은 `DrainInProgress`, `Drained`, `MaintenancePlanned`, `MaintenanceInProgress`, `GracefulNodeShutdownInProgress` 다섯 가지다. 중요한 제약도 분명하다. 이 기능은 Alpha이고 `NodeLifecycleConditions` feature gate는 v1.37에서 기본 비활성화다. 더구나 gate를 활성화해도 현 릴리스의 core component는 condition을 읽어 scheduling·eviction·drain 동작을 바꾸지 않는다.

즉, 이번 변화는 "노드가 자동으로 안전하게 정비된다"는 기능 출시가 아니다. 먼저 **운영 의도를 누가, 어떤 freshness로, 어떤 실행 절차와 연결해 기록할 것인가**를 정하는 계약의 출시다. 이 글은 [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/), [Load Balancer Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/), [Kubernetes v1.37 Rootless Node Components](/posts/2026-09-08-kubernetes-rootless-node-components-trend/)를 node maintenance 관점으로 연결한다.

참고한 공식 자료:

- Kubernetes Blog, [Kubernetes v1.37: Introducing Node Lifecycle Conditions](https://kubernetes.io/blog/2026/09/09/kubernetes-v1-37-node-lifecycle-conditions/)
- Kubernetes Docs, [Node Status](https://kubernetes.io/docs/reference/node/node-status/)
- Kubernetes Docs, [Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/)
- Kubernetes Docs, [Pod Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)

## 이 글에서 얻는 것

- Node Lifecycle Conditions가 Ready·taint·cordon·drain과 각각 무엇이 다른지 구분합니다.
- v1.37의 Alpha 상태를 자동 조치 기능으로 오해하지 않는 이유를 이해합니다.
- condition writer의 권한·source·freshness·clear 기준을 운영 계약으로 만드는 방법을 익힙니다.
- 기존 node maintenance runbook과 연결하되, 위험한 자동화를 shadow mode로 제한하는 기준을 세웁니다.

## 핵심 개념/이슈

### 1) 다섯 condition은 행동 명령이 아니라 공유 상태다

각 condition은 node lifecycle의 특정 지점을 표현한다.

| Condition | 표현하는 사실 | 대체하지 않는 기존 제어 |
| --- | --- | --- |
| `DrainInProgress` | 관리자가 정한 기준으로 drain이 진행 중 | cordon, eviction, PDB |
| `Drained` | 선택한 drain 기준에 도달함 | node 재부팅·삭제 승인 |
| `MaintenancePlanned` | 앞으로 node 변경이 예정됨 | scheduler의 즉시 placement 변경 |
| `MaintenanceInProgress` | 정비가 실제로 시작됨 | traffic drain, workload 이동 |
| `GracefulNodeShutdownInProgress` | graceful shutdown이 진행됨 | kubelet shutdown policy와 app 종료 처리 |

condition이 `True`라는 사실만으로 Kubernetes scheduler가 새 Pod를 막거나 controller가 기존 Pod를 evict하지 않는다. 그 동작은 여전히 cordon, drain, taint/toleration, PodDisruptionBudget, deployment rollout 같은 기존 API와 runbook이 담당한다. 운영 중 `MaintenancePlanned=True`만 보고 cordon을 생략하거나, 반대로 `Drained=True`만 보고 node를 삭제하면 의도가 실행 결과로 바뀌었다고 잘못 가정하게 된다.

이 구분은 load balancer readiness와도 같다. health check에서 traffic이 빠졌다고 모든 in-flight 요청이 끝난 것이 아니듯, lifecycle condition은 사람이 공유할 상태를 말할 뿐 물리적·논리적 정비의 완료를 보장하지 않는다. application traffic, batch job, local data, storage detach의 종료 기준은 별도 증거를 가져야 한다.

### 2) Alpha feature gate와 신호 소비는 별개다

v1.37에서 새 이름은 well-known `NodeConditionType`으로 예약됐고, 관리자가 또는 관리자가 권한을 준 controller가 설정·해제한다. `NodeLifecycleConditions` gate는 기본으로 꺼져 있으며, 켜더라도 현재 release에서는 실질적으로 no-op에 가깝다. core workload controller가 이 상태에 맞춰 행동하지 않는다는 뜻이다.

이 사실은 두 가지 설계 원칙으로 이어진다.

1. production availability action의 단일 입력으로 쓰지 않는다.
2. 미래 release에서 controller가 소비할 수 있음을 전제로, 지금부터 상태의 author와 의미를 느슨하게 만들지 않는다.

"Alpha라서 아무것도 하지 않는다"도 아쉽고, "Alpha지만 우리 automation이 알아서 처리한다"도 위험하다. 지금 할 수 있는 좋은 작업은 상태 어휘를 dashboard·change ticket·runbook에 일관되게 넣는 일이다. 미래 기능을 기다리는 동안에도 on-call이 node의 의도와 실제 drain 진행을 빠르게 맞출 수 있다.

### 3) condition writer는 작은 control plane이다

Node condition은 보통 node object를 patch할 수 있는 주체가 쓴다. 이 권한을 maintenance bot, cluster autoscaler, hardware controller, 사람이 모두 가지면 같은 node에 상충하는 상태를 만들 수 있다. 예를 들어 한 controller가 `MaintenanceInProgress=True`를 기록한 직후 다른 도구가 작업을 취소했는데 clear하지 못하면, dashboard의 상태는 진실이 아니다.

최소 계약은 아래 네 항목이다.

```text
writer: 서비스 계정 하나 또는 명시적 handoff 규칙
source: controller 이름 + change ticket/maintenance window
freshness: lastTransitionTime 및 heartbeat/재확인 시간
clear: 성공, 취소, timeout 각각의 해제 owner와 절차
```

source는 message에 자유 텍스트만 남기는 것보다 annotation이나 event의 change ID로 참조 가능한 편이 좋다. 단, condition 정의 바깥의 annotation schema는 조직이 정하는 정책이지 Kubernetes가 보장하는 표준은 아니다. 정책을 만들 때는 정비 시작·종료 시간이 기록되는 system of record를 하나 정하고, condition은 그 상태를 cluster에 전달하는 projection으로 보는 편이 안전하다.

### 4) stale 상태를 정상 상태보다 먼저 다룬다

`MaintenancePlanned=True`가 일주일 전 예정을 아직 가리키는지, 실제로 정비가 막힌 것인지, 이미 취소됐는데 clear가 누락된 것인지는 condition 값만으로 알기 어렵다. 그래서 첫 대시보드는 "현재 maintenance node 수"보다 **stale signal**을 먼저 보여줘야 한다.

시작 기준의 예시는 다음과 같다.

| 신호 | 사람이 확인할 조건 | 자동 행동 금지 이유 |
| --- | --- | --- |
| `MaintenancePlanned=True` | 예정 시각이 지났거나 24시간 이상 재확인 없음 | 계획 취소·연기 여부는 외부 change record에 있음 |
| `DrainInProgress=True` | 30분 안에 eviction/event 진행이 없음 | PDB, finalizer, local storage 때문에 멈췄을 수 있음 |
| `Drained=True` | cordon과 workload 잔존 수가 기준과 맞지 않음 | 팀마다 "drained"의 정의가 다를 수 있음 |
| shutdown condition | node heartbeat·graceful shutdown event가 모순 | controller와 kubelet 관측 시간이 다를 수 있음 |

10분, 30분, 24시간은 예시다. 짧은 maintenance window와 수 시간 걸리는 stateful workload를 같은 임계값으로 다루면 alert noise가 커진다. 중요한 것은 condition을 자동 action trigger보다 **investigation trigger**로 시작하는 순서다.

## 실무 적용

### 1) 기존 drain runbook을 바꾸지 않고 상태를 병행 기록한다

처음 도입하는 cluster는 flow를 새로 만들지 않는다. 다음처럼 기존의 검증된 절차에 lifecycle 상태를 붙인다.

```text
change 승인
  -> MaintenancePlanned 기록 (owner·window·ticket 연결)
  -> load balancer에서 traffic 제거 확인
  -> cordon
  -> DrainInProgress 기록
  -> drain + PDB/eviction 관찰
  -> Drained 기록 (조직의 완료 정의 충족 시)
  -> MaintenanceInProgress 기록
  -> 정비·reboot·검증
  -> condition clear + uncordon + traffic 복귀 증거
```

여기서 `Drained`의 완료 정의는 팀마다 명시해야 한다. 예를 들어 "DaemonSet과 mirror Pod는 제외하고, 일반 workload Pod 0개, termination 중 Pod 0개, unschedulable=true"처럼 적는다. stateful workload에 local PV가 있다면 volume detach와 application health까지 완료 조건에 넣을지 정해야 한다. 이름이 표준이어도 종료 기준까지 표준인 것은 아니다.

### 2) writer 권한과 감사 흔적을 분리한다

condition을 쓰는 service account에는 필요 최소의 node patch 권한만 주고, 일반 배포 도구나 개발자 role에 넓은 Node write 권한을 주지 않는다. 변경 이벤트에는 writer, node, condition, 이전/이후 값, ticket, 만료 시각을 남긴다. audit log가 없는 cluster라면 처음에는 사람이 수동 입력하는 횟수를 최소화하는 편이 낫다.

권한 검토에서 확인할 질문은 세 가지다.

- 이 writer가 모든 node를 patch해야 하는가, 아니면 관리하는 node pool만 다루면 되는가?
- 두 writer가 같은 condition을 소유할 때 handoff와 conflict resolution은 무엇인가?
- change ticket이 취소됐을 때 누가 condition을 clear하고, 일정 시간 뒤 stale alert를 받는가?

condition을 "대시보드용 메타데이터"라며 권한을 느슨하게 주면, 나중에 automation이 붙는 순간 신뢰 경계가 이미 무너진다. condition writer를 control plane의 작은 구성요소로 취급해야 하는 이유다.

### 3) 1~2 node, 48시간, shadow consumer로 검증한다

첫 canary는 maintenance가 예정된 worker 1~2대에서 시작한다. 48시간 동안 기존 runbook의 action과 lifecycle condition의 순서를 비교한다. 평가 지표는 feature gate가 작동했는지가 아니라 다음의 운영 일치도다.

| 검증 항목 | 통과 기준 예시 | abort/보류 신호 |
| --- | --- | --- |
| 기록 일치 | ticket·event·condition의 owner와 time window가 100% 일치 | source 또는 완료 시각이 1건이라도 모순 |
| drain 추적 | `DrainInProgress` 후 drain event가 5분 내 관측 | event 없이 상태만 True로 지속 |
| 상태 정리 | 완료·취소 뒤 condition이 10분 안에 clear | stale condition 1건 발생 |
| 안전성 | PDB 위반 0건, 예상 밖 workload eviction 0건 | availability impact 또는 rollback 필요 |
| 관측 | dashboard/event/audit에서 동일 node 상태 확인 | writer를 추적할 수 없음 |

내부 automation을 시험하고 싶다면 `MaintenancePlanned`를 받았을 때 "cordon했을 것"이라는 예상 action만 로그에 적는 shadow mode로 시작한다. 실제 `kubectl cordon`은 수행하지 않는다. 48시간 이상, 또는 여러 maintenance event에서 shadow 결과가 기존 runbook과 100% 맞고 stale·rollback 사례도 경험한 뒤에야 human approval이 있는 제안 모드로 올릴 수 있다.

### 4) node pool capability 변화와 함께 읽는다

최근 Kubernetes v1.37의 rootless node component처럼 node 자체의 capability가 달라지는 변화는 재부팅·drain·rollback을 더 자주 요구한다. 이런 때 lifecycle condition은 rootless, GPU, storage, OS image 같은 capability label의 대체재가 아니다. 반대로 node를 어떤 pool로 되돌리고 어떤 workload가 대기 중인지 설명하는 맥락을 제공한다.

예를 들어 rootless node pool을 upgrade할 때 `MaintenancePlanned`는 계획과 owner를 전달할 수 있다. 실제 placement는 label·taint·affinity가, 작업 중 안전한 축소는 PDB와 capacity budget이, traffic 손실 방지는 readiness와 load balancer deregistration이 맡는다. 한 상태 필드로 모든 control plane 문제를 해결하려 하면 오히려 책임 경계가 흐려진다.

## 트레이드오프/주의점

첫째, condition은 명세화된 단어이지 강제된 workflow가 아니다. `Drained=True`의 기준을 통일하지 않으면 다른 팀의 controller가 서로 다른 완료 상태를 같은 이름으로 기록한다. 처음부터 owner와 종료 정의를 짧게라도 남겨야 한다.

둘째, Alpha feature의 API·소비 방식은 바뀔 수 있다. platform dashboard나 data model을 만들더라도 condition 이름의 미래 동작을 확정적으로 가정하지 말고, raw condition·writer·version을 함께 저장한다. gate를 production 기본값으로 바꾸는 결정도 Kubernetes upgrade와 별도로 review한다.

셋째, maintenance signal을 받자마자 자동 eviction·autoscaling·capacity 감소를 수행하면 false positive가 availability incident로 바뀐다. condition은 외부 ticket·Node Ready·cordon·drain event·PDB 상태와 함께 평가해야 한다. 특히 stateful workload는 event ordering이 맞아도 data path가 종료되지 않았을 수 있다.

넷째, 너무 많은 custom annotation은 공통 어휘의 장점을 잃게 한다. Kubernetes가 제공하는 다섯 condition은 공통으로 쓰고, 조직 고유 메타데이터는 owner·ticket·window·expiry처럼 최소로 유지한다. 운영자가 한 화면에서 30초 안에 "누가 왜 이 node를 비우는가"를 읽지 못하면 계약이 과해진 것이다.

## 체크리스트 또는 연습

- [ ] `DrainInProgress`, `Drained`, `MaintenancePlanned`, `MaintenanceInProgress`, `GracefulNodeShutdownInProgress`의 팀별 완료 정의를 적었다.
- [ ] condition writer, Node patch RBAC, owner handoff, audit log와 clear 절차를 정했다.
- [ ] v1.37에서는 기존 cordon·drain·taint·PDB·traffic drain을 대체하지 않는다는 원칙을 runbook에 명시했다.
- [ ] maintenance ticket, condition, node event, load balancer 상태를 한 화면 또는 한 runbook에서 대조한다.
- [ ] stale maintenance, stalled drain, 완료 뒤 미해제 상태에 대한 사람 확인 임계값을 정했다.
- [ ] 1~2 node에서 48시간 canary하고, consumer automation은 action 없는 shadow mode로 검증했다.
- [ ] 자동 cordon/eviction으로 승격하기 전에 PDB·capacity·rollback·human approval을 별도 게이트로 둔다.

연습으로 최근 node maintenance 한 건을 골라 보자. change ticket의 예정 시각, traffic 제거 시각, cordon, drain 시작/완료, reboot, workload 복귀, uncordon을 타임라인으로 적는다. 그다음 어느 지점에 다섯 lifecycle condition을 기록할지와 각 writer를 정한다. 마지막으로 ticket이 취소되거나 drain이 PDB에서 멈춘 상황을 넣어 condition을 누가 언제 clear할지 써 보면, 이 기능의 핵심이 자동화 문법이 아니라 운영 책임의 명확화라는 점이 드러난다.

## 관련 글

- [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/)
- [Load Balancer Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)
- [Kubernetes v1.37 Rootless Node Components](/posts/2026-09-08-kubernetes-rootless-node-components-trend/)
