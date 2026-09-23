---
title: "2026 개발 트렌드: Kubernetes v1.37 Rootless Node Components, 노드 권한을 워크로드 격리 밖에서 다시 설계하다"
date: 2026-09-08T10:06:00+09:00
lastmod: 2026-09-08T10:06:00+09:00
draft: false
tags: ["Kubernetes", "KubeletInUserNamespace", "Rootless", "Linux User Namespace", "Container Security", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37 rootless", "KubeletInUserNamespace beta", "rootless node components", "Kubernetes user namespaces", "Kubernetes node hardening"]
description: "Kubernetes v1.37에서 Beta가 된 KubeletInUserNamespace를 계기로, Pod user namespace와 node component rootless mode를 구분하고 CNI·CSI 호환성, 스케줄링 격리, 운영 canary 기준으로 검토하는 글입니다."
summary: "Kubernetes v1.37의 KubeletInUserNamespace는 kubelet·CRI/OCI runtime·CNI·kube-proxy를 host의 비루트 사용자 namespace 안에서 실행할 수 있게 한다. feature gate가 기본 활성화됐다고 기존 cluster가 자동 전환되는 것은 아니다. 실무의 핵심은 rootless node를 새로운 capacity class로 취급하고, CNI·CSI·host 권한 workload를 inventory한 뒤 별도 pool canary와 rollback 증거를 만드는 일이다."
key_takeaways:
  - "KubeletInUserNamespace는 Pod를 user namespace에 넣는 hostUsers:false와 다르다. 전자는 host 위 node component 권한을 낮추고, 후자는 Pod의 UID mapping을 분리한다. 둘은 함께 쓸 수 있지만 대체재가 아니다."
  - "v1.37에서 feature gate는 기본 활성화지만 기존 rootful kubelet을 자동으로 user namespace 안으로 옮기지 않는다. host 준비와 runtime·CNI·CSI 호환성이 별도 필요하다."
  - "rootless node는 컨테이너 탈출 취약점의 host root 피해 범위를 낮출 수 있지만 kernel 취약점을 막지는 못한다. seccomp, image provenance, RBAC, patching을 제거할 이유가 아니다."
  - "runningInUserNamespace 상태를 node label·taint·workload compatibility registry와 연결해야 root 권한을 요구하는 installer나 특수 driver가 rootless pool로 잘못 배치되는 것을 막을 수 있다."
operator_checklist:
  - "CNI, CSI, runtime, kube-proxy, node monitoring, GPU/NIC driver, privileged DaemonSet을 rootless compatibility와 필요한 host capability 기준으로 inventory한다."
  - "rootless node의 runningInUserNamespace 상태, node Ready, pod startup p95, network failure, volume mount failure, kubelet error를 rootful 기준선과 비교한다."
  - "처음에는 worker 1~2대 또는 전체의 5% 이하에만 도입하고, 48시간 이상 실제 rollout·restart·drain·rollback을 관찰한다."
  - "host privilege가 필요한 workload에는 node affinity/taint-toleration과 owner·만료일을 붙이고, broad privileged 예외로 rootless 경계를 무력화하지 않는다."
learning_refs:
  - title: "Kubernetes 기본 개념"
    href: "/learning/deep-dive/deep-dive-kubernetes-basics/"
    description: "Pod, Node, kubelet, CNI/CSI의 책임 경계를 먼저 정리합니다."
  - title: "Kubernetes Rollout 전략"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "node pool 수준 변경을 canary, drain, rollback으로 운영하는 절차입니다."
  - title: "Kubernetes v1.37 Metrics API와 DRA 자원 계약"
    href: "/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/"
    description: "node·device 상태를 서로 다른 관측 계약으로 해석하는 기준입니다."
  - title: "Kubernetes v1.37 etcd RangeStream과 대규모 List 읽기"
    href: "/posts/2026-09-06-kubernetes-etcd-rangestream-large-list-memory-trend/"
    description: "새 control-plane 기능을 workload 영향과 별도로 검증하는 관점입니다."
decision_guide:
  title: "rootless node component를 어디부터 도입할까"
  intro: "'Beta이며 feature gate가 켜졌다'는 사실은 production 전환 승인이 아니다. host 권한 의존성, component 호환성, rollback 가능성을 먼저 기준으로 삼는다."
  cases:
    - badge: "우선 후보"
      title: "개발·CI·AI sandbox처럼 격리 실패의 host 영향이 큰 환경"
      fit: "single-purpose worker, 표준 CNI/CSI, 재생성 가능한 workload, 짧은 rollback 경로가 있는 경우입니다."
      watchouts: "테스트 cluster의 성공만으로 production CNI·storage·monitoring 호환성을 가정하면 안 됩니다."
      next_step: "rootless worker 1~2대로 48시간 canary하고 node restart, workload rollout, network·volume fixture를 실행합니다."
    - badge: "조건부"
      title: "일반 production worker pool"
      fit: "node extension과 privileged DaemonSet의 owner·필요 권한·대체 경로가 inventory된 경우입니다."
      watchouts: "GPU, high-performance networking, host installer가 실제 root 권한을 요구할 수 있습니다."
      next_step: "rootless compatible workload만 label/taint로 분리해 전체의 5% 이하 capacity에서 시작합니다."
    - badge: "보류"
      title: "호환성 증거 없는 특수 device 또는 legacy host agent"
      fit: "vendor CNI/CSI, eBPF agent, storage driver가 user namespace에서 검증되지 않았거나 rollback이 불명확한 경우입니다."
      watchouts: "'privileged: true'를 넓게 허용해 우회하면 격리 이점을 잃고 장애 표면만 늘어납니다."
      next_step: "vendor compatibility matrix와 staging failure test가 갖춰질 때까지 rootful pool에 명시적으로 격리합니다."
faqs:
  - question: "Pod의 hostUsers:false를 이미 쓰면 node rootless mode도 필요 없나요?"
    answer: "필요성이 사라지지 않습니다. hostUsers:false는 Pod 안 UID와 host UID의 mapping을 분리하지만 kubelet·runtime 같은 node component가 host root로 실행되는 문제를 해결하지 않습니다. 보호하는 계층이 다릅니다."
  - question: "feature gate가 기본 활성화라면 업그레이드 뒤 자동으로 rootless가 되나요?"
    answer: "아닙니다. gate 활성화는 kubelet이 user namespace 안에서 실행될 때 필요한 동작을 허용할 뿐, 기존 host의 rootful kubelet을 자동 이관하지 않습니다. namespace 준비와 component 호환성 검증이 필요합니다."
  - question: "rootless node를 쓰면 privileged Pod를 완전히 금지해도 되나요?"
    answer: "아닙니다. rootless node는 host root 피해 범위를 줄이는 한 계층일 뿐이며, kernel 취약점이나 잘못된 workload 권한을 막지 못합니다. Pod Security, seccomp, RBAC, image 검증을 계속 적용해야 합니다."
---

Kubernetes의 보안 논의는 오랫동안 Pod의 `runAsNonRoot`, seccomp, Pod Security, admission policy에 집중됐다. 이것들은 중요하지만 node 위에서 kubelet, container runtime, CNI, kube-proxy가 host root로 동작한다는 더 아래 계층을 바꾸지는 않는다. Kubernetes v1.37에서 **`KubeletInUserNamespace`가 Beta**가 되면서, 이 node component들을 Linux user namespace 안의 비루트 host 계정으로 실행하는 rootless mode가 실무 검토 대상이 됐다.

이 기능은 "모든 Kubernetes cluster를 즉시 rootless로 바꾸라"는 신호가 아니다. v1.37에서 feature gate가 기본 활성화됐지만 기존 rootful node를 자동으로 user namespace로 옮기지 않는다. CNI·CSI·runtime·host agent와 실제 workload의 호환성을 준비해야 한다. 중요한 변화는 **node의 권한 모델 자체를 workload placement와 같은 운영 계약으로 다루기 시작했다는 점**이다.

이 글은 [Kubernetes 기본 개념](/learning/deep-dive/deep-dive-kubernetes-basics/), [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Kubernetes v1.37 Metrics API와 DRA 자원 계약](/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/), [Kubernetes v1.37 etcd RangeStream과 대규모 List 읽기](/posts/2026-09-06-kubernetes-etcd-rangestream-large-list-memory-trend/)을 연결한다. 새 node 기능을 feature flag 하나가 아니라 호환성·관측·롤백이 있는 platform capability로 보는 관점이다.

참고한 공식 자료:

- Kubernetes Blog, [Kubernetes v1.37: KubeletInUserNamespace (aka Rootless mode) Graduates to Beta](https://kubernetes.io/blog/2026/09/04/kubernetes-v1-37-rootless-beta/)
- Kubernetes Docs, [User Namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)
- Kubernetes Docs, [Running Kubernetes Node Components as a Non-root User](https://kubernetes.io/docs/tasks/administer-cluster/kubelet-in-userns/)
- Kubernetes Docs, [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)

## 이 글에서 얻는 것

- `KubeletInUserNamespace`와 Pod-level user namespace의 보호 대상과 운영 차이를 구분합니다.
- rootless node가 줄일 수 있는 host root 피해 범위와 줄이지 못하는 kernel·workload 위험을 분리합니다.
- CNI, CSI, device driver, privileged DaemonSet을 rootless compatibility 기준으로 inventory하는 방법을 익힙니다.
- node pool canary, workload placement, rollback을 숫자와 abort 조건으로 결정할 수 있습니다.

## 핵심 개념/이슈

### 1) Pod user namespace와 node rootless mode는 다른 보호선이다

이름이 비슷해도 두 기능의 질문은 다르다.

| 구분 | Pod user namespace | KubeletInUserNamespace / rootless node |
| --- | --- | --- |
| 대상 | workload Pod | kubelet, CRI/OCI runtime, CNI, kube-proxy 등 node component |
| 핵심 설정 | `hostUsers: false` | node component를 Linux user namespace에서 실행 |
| 보호 질문 | Pod 내부 UID 0이 host에서 무엇인가 | node component 탈출 시 host root까지 닿는가 |
| 관계 | Pod 단위 격리 | node 단위 권한 축소, 함께 사용 가능 |

Pod user namespace는 Pod 안의 UID 0을 host의 비특권 UID 범위에 매핑해, 컨테이너 안에서 root인 프로세스가 host root와 같은 권한을 갖지 않게 한다. 반면 rootless node mode는 host에서 root였던 kubelet과 runtime 등의 권한 범위를 바꾼다. 공식 설명대로 user namespace 안의 가짜 UID 0은 namespace 내부의 mount, cgroup, Pod network namespace 구성 같은 작업에는 쓰일 수 있지만 host 전체 root 권한은 아니다.

따라서 "Pod가 non-root이니 node는 안전하다"도, "node가 rootless이니 privileged workload는 괜찮다"도 맞지 않다. 두 기능은 서로 다른 탈출 경로의 피해 범위를 줄이는 방어 심도다. platform 팀은 다음 순서로 이해하는 편이 좋다.

```text
image provenance / admission
  -> Pod Security + seccomp + runtime restrictions
  -> Pod user namespace (workload UID isolation)
  -> rootless node components (node process privilege reduction)
  -> host/kernel patching and infrastructure access control
```

### 2) rootless는 container-breakout의 피해 범위를 줄이지만 kernel 방어는 아니다

Kubernetes 프로젝트가 제시한 배경은 분명하다. 과거 container runtime과 kubelet의 취약점은 attacker가 host root 권한을 얻을 수 있는 경로가 됐다. node component를 host의 비루트 계정과 user namespace 안에 두면, component가 침해돼도 host kernel, boot loader, firmware 같은 영역을 바꾸기 어려워 피해 범위를 낮출 수 있다.

하지만 Linux kernel 자체의 취약점은 user namespace가 해결하지 못한다. 또한 rootless node에서 돌아가는 workload가 여전히 overly broad ServiceAccount, hostPath mount, 민감한 secret, network egress 권한을 가지면 application-level 피해는 남는다. rootless 도입과 동시에 기존 hardening을 줄이는 것은 잘못된 교환이다.

최소 보안 기준은 다음 순서로 유지한다.

1. known critical patch와 node OS/kernel 업데이트를 먼저 적용한다.
2. Pod Security와 seccomp로 불필요한 syscall·privilege를 줄인다.
3. image provenance, registry access, workload RBAC를 검증한다.
4. rootless node는 **host root blast radius를 더 줄이는 추가 계층**으로 넣는다.

특히 AI agent가 만드는 test cluster나 shared CI runner처럼 untrusted input이 코드·manifest·container image로 빠르게 들어오는 환경은 rootless canary의 좋은 첫 대상이다. 반면 결제 처리 같은 critical production path에서 호환성 증거 없이 rootless를 첫 적용 대상으로 삼을 이유는 없다.

### 3) Beta의 기본 활성화와 자동 이관은 전혀 다르다

v1.37에서 `KubeletInUserNamespace` feature gate는 기본 활성화다. 하지만 이 gate는 kubelet이 user namespace 안에서 실행될 때 일부 permission error를 허용하도록 만드는 동작일 뿐이다. 기존 kubelet process를 user namespace 안으로 옮기거나, containerd·CNI·CSI를 호환 모드로 재구성하지 않는다. 기존 rootful cluster는 아무 일도 자동으로 바뀌지 않는다.

도입에는 host 바깥에서 user namespace를 준비하는 과정도 필요하다. 공식 자료는 rootless Docker, nerdctl, Podman 위의 kind/minikube와 같은 경로를 예로 든다. production에서 중요한 것은 특정 배포 도구의 선택보다 다음 의존성을 빠짐없이 확인하는 일이다.

| 계층 | 확인 질문 | 실패할 때의 신호 |
| --- | --- | --- |
| host/kernel | user namespace, cgroup, 필요한 kernel 기능이 준비됐는가 | kubelet startup 오류, mount/cgroup 실패 |
| runtime | CRI/OCI runtime이 rootless node 모드에서 검증됐는가 | container create·image pull 실패 |
| network | CNI와 kube-proxy가 namespace 제약에서 동작하는가 | DNS·Service·NetworkPolicy 오류 |
| storage | CSI와 volume mount가 id mapping·권한에서 안전한가 | mount attach, permission, data access 실패 |
| node agent | monitoring, security, GPU/NIC agent가 필요한 host 접근을 갖는가 | DaemonSet CrashLoop, metrics 공백 |

"cluster가 Ready"만 통과 기준으로 삼으면 안 된다. node Ready 이후의 network route, Service DNS, persistent volume read/write, Pod restart, node drain, monitoring data, privileged installer 동작까지 fixture로 검증해야 한다.

### 4) rootless node는 새로운 workload compatibility class다

v1.37은 node가 user namespace 안에서 실행되는지 `runningInUserNamespace` 상태로 보고한다. 이 값은 단순 진단 정보가 아니라 placement 정책의 입력이 될 수 있다. 예를 들어 CNI installer, 특정 CSI, eBPF 기반 observability agent, GPU/NIC driver, legacy host maintenance job 중 일부는 실제 host root 또는 특정 kernel capability를 요구할 수 있다.

이때 rootless node에 모든 Pod를 허용한 뒤 실패한 workload를 발견하는 방식은 비용이 크다. 반대로 entire fleet을 rootful로 남기면 새 격리 기능의 이점이 없다. 해결책은 rootless node를 새 capacity class로 정의하는 것이다.

```text
node capability: rootless=true / rootless=false
workload registry: compatible / needs-rootful / pending-verification
placement: label + node affinity + taint/toleration
exception: owner + ticket + expiry + rollback path
```

`needs-rootful` workload에 broad `privileged: true`를 붙여 rootless node에서도 강제로 돌리는 것은 피한다. rootful pool에 명시적으로 한정하고, 해당 requirement가 사라질 계획과 담당자를 기록하는 편이 더 안전하다. compatibility label은 security 장식이 아니라 scheduling contract다.

## 실무 적용

### 1) inventory에서 '권한'과 '호환성'을 따로 적는다

첫 단계는 모든 DaemonSet을 rootless 가능/불가로 찍는 일이 아니다. component마다 **필요한 host 권한**과 **현재 검증된 rootless 호환성**을 분리한다. 권한이 크다고 반드시 불가한 것은 아니며, 권한이 작아 보여도 vendor driver가 user namespace에서 테스트되지 않았을 수 있다.

다음 항목을 cluster별 registry에 남긴다.

- CNI, CSI, runtime, kube-proxy와 버전, rootless vendor 지원 문서
- privileged·hostNetwork·hostPID·hostPath를 쓰는 DaemonSet과 owner
- GPU, NIC, storage, eBPF, log collector, node security agent의 실제 mount/capability
- node bootstrap, upgrade, reboot, drain에서 필요한 host 작업
- rootless compatible 판정의 test date, fixture, rollback path

inventory 결과가 `pending-verification`이면 production rootless pool로 바로 보내지 않는다. 새 기능의 속도보다 node가 없어진 뒤 workload를 되돌릴 수 있는지가 우선이다.

### 2) 1~2 node, 48시간, 실패 fixture부터 시작한다

첫 canary는 developer cluster나 low-risk worker 1~2대처럼 회수 가능한 pool에서 시작한다. 전체 cluster capacity의 5% 이하를 넘기지 않고 48시간 이상 관찰한다. 통과 기준은 application request success 하나가 아니라 node lifecycle 전체다.

| 검증 영역 | 최소 fixture | abort 기준 예시 |
| --- | --- | --- |
| node lifecycle | reboot, kubelet restart, cordon/drain | Node NotReady가 5분 초과 또는 drain 후 복구 실패 |
| network | DNS, Service, NetworkPolicy, egress | baseline 대비 network error 0.2%p 증가 |
| storage | PV mount, read/write, Pod restart | mount/permission 오류 1건이라도 재현 |
| platform agent | monitoring/security/logging DaemonSet | 필수 telemetry 5분 이상 공백 |
| workload | standard API, batch, compatible Pod | startup p95가 기준선보다 20% 초과 |

abort 숫자는 조직의 SLO와 node 수에 맞춰 조정한다. 핵심은 배포 전 정하는 것이다. canary 중 새 DaemonSet을 급히 privileged 예외로 바꾸어 통과시키면, rootless 문제를 해결한 것이 아니라 원인을 가린 것이다.

### 3) 관측과 rollback을 node pool 단위로 준비한다

rootless mode는 application Deployment 하나를 되돌리는 일보다 node pool을 교체·cordon·drain하는 운영에 가깝다. 대시보드에는 rootless/rootful label별로 다음 지표를 분리한다.

- `runningInUserNamespace` 상태와 Node Ready, kubelet restart/error
- Pod scheduled-to-ready p50/p95, image pull, container create, volume mount 오류
- DNS/Service request error, NetworkPolicy deny, CNI error
- DaemonSet desired/current/ready와 telemetry freshness
- node drain 성공 시간, rollback pool로의 reschedule 시간

rollback은 "feature gate를 끈다"로 끝나지 않을 수 있다. 이미 rootless host 구성을 가진 node의 replacement, workload placement 복원, PV와 network clean-up, monitoring 확인이 필요하다. staging에서 rootless pool을 cordon·drain하고 rootful pool로 workload를 옮긴 뒤 business SLO와 node agent가 복구되는 것을 실제로 한 번 증명한다.

### 4) production 확대 조건을 명시한다

48시간 canary가 성공했더라도 무조건 100%로 확장하지 않는다. 아래 조건을 만족할 때 5% → 20% → 50%처럼 capacity slice를 넓힌다.

- 필수 CNI·CSI·runtime·monitoring/security agent의 rootless compatibility가 버전별로 기록돼 있다.
- rootless pool과 rootful pool의 Pod startup p95, network error, mount error, Node NotReady 비율이 사전 기준을 넘겨 악화하지 않았다.
- root-required workload에는 affinity/taint 규칙과 owner·만료일이 있고, pending workload가 production pool으로 배치되지 않는다.
- rootful rollback pool의 여유 capacity가 rootless slice의 최대 workload를 수용할 수 있다.
- node replacement와 rollback exercise가 staging에서 한 번 이상 끝났다.

이 기준은 rootless를 느리게 만드는 절차가 아니라 Beta 기능을 실제 security control로 만드는 절차다. 가용성 비용을 계산하지 않은 privilege reduction은 production에서 받아들여지기 어렵다.

## 트레이드오프/주의점

첫째, rootless node는 kernel exploit을 막지 않는다. user namespace 내부의 UID 0은 host 전체 root가 아니지만, kernel 취약점이나 잘못된 host access가 있다면 방어선은 우회될 수 있다. patch management와 seccomp를 계속 강제해야 한다.

둘째, CNI·CSI·device driver·eBPF agent는 가장 먼저 깨질 수 있는 영역이다. "특정 version에서 동작한다"는 vendor statement만으로 충분하지 않다. 실제 OS, kernel, runtime, mount, network topology의 staging fixture를 통과해야 한다.

셋째, rootful exception을 위한 별도 pool은 운영 복잡도를 늘린다. 하지만 호환되지 않는 component를 모든 node의 root 권한으로 되돌리는 것보다 blast radius를 제한한다. exception은 기술 부채 registry처럼 owner와 만료일을 가져야 한다.

넷째, Beta는 API·동작·호환성의 미래 변경 가능성을 뜻한다. 새 cluster 기본값으로 바로 승격하기보다 upgrade plan, managed Kubernetes 지원 범위, rollback 가능한 node image를 함께 관리해야 한다.

## 체크리스트 또는 연습

- [ ] Pod user namespace와 rootless node component의 보호 대상·owner를 별도로 문서화했다.
- [ ] CNI, CSI, runtime, node agent, privileged DaemonSet, device driver의 host 권한과 rootless 호환성을 inventory했다.
- [ ] rootless node 1~2대 또는 5% 이하 capacity에서 48시간 canary와 reboot/drain fixture를 실행했다.
- [ ] `runningInUserNamespace`, Node Ready, Pod ready p95, mount/network 오류, telemetry freshness를 rootful 기준선과 비교한다.
- [ ] root-required workload는 label·affinity·taint/toleration으로 rootful pool에 명시적으로 격리하고 예외 만료일을 둔다.
- [ ] staging에서 rootless pool rollback과 workload reschedule을 실제 수행했다.

연습으로 현재 cluster의 DaemonSet을 한 번 나열해 보자. 각 항목에 `hostNetwork`, `hostPID`, `hostPath`, privileged, 필요한 kernel capability, owner를 적고 rootless compatibility를 `확인됨/미확인/불가`로 나눈다. 그 다음 미확인 항목 하나를 골라 dev node에서 DNS, volume mount, node restart fixture를 실행하면, rootless 전환이 기능 체크가 아니라 운영 설계 문제라는 점이 명확해진다.

## 관련 글

- [Kubernetes 기본 개념](/learning/deep-dive/deep-dive-kubernetes-basics/)
- [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [Kubernetes v1.37 Metrics API와 DRA 자원 계약](/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/)
- [Kubernetes v1.37 etcd RangeStream과 대규모 List 읽기](/posts/2026-09-06-kubernetes-etcd-rangestream-large-list-memory-trend/)

