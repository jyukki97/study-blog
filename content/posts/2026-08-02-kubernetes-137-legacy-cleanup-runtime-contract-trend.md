---
title: "2026 개발 트렌드: Kubernetes 1.37, 레거시 정리와 런타임 계약이 운영 과제로 올라온다"
date: 2026-08-02T10:06:00+09:00
lastmod: 2026-08-02T11:30:00+09:00
draft: false
tags: ["Kubernetes", "Platform Engineering", "Runtime Security", "Observability", "Cloud Native", "DevOps"]
categories: ["Development", "Platform Engineering", "DevOps"]
series: ["dev-trends"]
keywords: ["Kubernetes 1.37", "kube-proxy ipvs deprecation", "cgroup v1 removal", "metrics.k8s.io GA", "rootless kubelet", "volume health monitor"]
description: "Kubernetes v1.37 Sneak Peek의 deprecation, cgroup v1 정리, ipvs 모드 축소, metrics.k8s.io GA, rootless kubelet, volume health monitor를 바탕으로 클러스터 운영 계약이 어떻게 바뀌는지 정리합니다."
summary: "Kubernetes 1.37의 신호는 새 기능보다 오래된 실행 경로를 줄이고, 런타임·네트워크·스토리지·관측 API를 명시적인 계약으로 고정하는 쪽에 가깝습니다. 플랫폼 팀은 업그레이드를 릴리스 노트 확인이 아니라 노드, kube-proxy, static pod, SELinux, metrics API, CSI health inventory로 다뤄야 합니다."
key_takeaways:
  - "Kubernetes v1.37은 ipvs kube-proxy, cgroup v1, static pod의 API 리소스 참조처럼 오래된 예외 경로를 줄이는 방향을 분명히 보여준다."
  - "metrics.k8s.io GA와 volume health monitor는 관측 데이터를 vendor dashboard가 아니라 Kubernetes API 계약 안으로 끌어오는 흐름이다."
  - "실무 기준은 새 버전 추격보다 node runtime inventory, network mode migration, SELinux volume 정책, autoscaling API 호환성을 업그레이드 전에 검증하는 것이다."
  - "릴리스 전 준비는 30분짜리 inventory 루틴, staging 실패 모드 재현, owner가 붙은 migration backlog로 쪼갤 때 실행 가능해진다."
operator_checklist:
  - "모든 클러스터에서 kube-proxy mode, cgroup version, static pod manifest의 ConfigMap/Secret 참조 여부를 inventory한다."
  - "metrics.k8s.io v1 전환은 HPA, kubectl top, custom dashboard, 권한 정책을 함께 canary한다."
  - "SELinuxMount 영향이 있는 CSI driver와 shared volume workload는 staging에서 pod start failure를 먼저 재현한다."
  - "스토리지 장애 대응은 CSI vendor dashboard 링크만 두지 말고 PVC/Pod status 기반 health signal을 운영 화면에 연결한다."
learning_refs:
  - title: "Kubernetes Rollout 심화"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "클러스터 업그레이드와 워크로드 배포를 단계적으로 검증하는 기본기입니다."
  - title: "Kubernetes Custom Metrics Autoscaling Contract"
    href: "/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/"
    description: "HPA와 metrics API를 운영 계약으로 보는 관점입니다."
  - title: "Runtime Security Patch Runway"
    href: "/posts/2026-07-22-runtime-security-patch-runway-trend/"
    description: "런타임과 노드 패치가 애플리케이션 운영에 주는 영향을 다룹니다."
  - title: "Observability Baseline"
    href: "/learning/deep-dive/deep-dive-observability-baseline/"
    description: "업그레이드 전후의 지표 기준선을 잡는 방법입니다."
decision_guide:
  title: "Kubernetes 1.37을 어떤 순서로 준비할 것인가"
  intro: "이번 신호는 기능 하나를 켜는 문제가 아니라 클러스터의 오래된 예외를 줄이는 문제입니다. 위험도는 사용 중인 레거시 경로와 운영 가시성 수준으로 판단합니다."
  cases:
    - badge: "Immediate inventory"
      title: "노드 이미지와 kube-proxy 모드가 오래됐다"
      fit: "self-managed cluster, 오래된 OS 이미지, ipvs kube-proxy, cgroup v1 흔적이 있는 조직"
      watchouts: "업그레이드 당일에 발견하면 rollback이 아니라 노드 풀 재설계 문제가 된다."
      next_step: "모든 cluster/node pool의 cgroup version과 kube-proxy mode를 이번 주 안에 수집한다."
    - badge: "Canary first"
      title: "SELinux, CSI, shared volume workload가 있다"
      fit: "보안 강화 Linux 설정, StatefulSet, shared volume, CSI driver를 많이 쓰는 팀"
      watchouts: "SELinuxMount 기본 동작 변화는 애플리케이션 코드를 바꾸지 않아도 pod start failure를 만들 수 있다."
      next_step: "대표 CSI driver 2개와 shared volume workload 3개를 staging v1.37 candidate에서 먼저 올린다."
    - badge: "API contract"
      title: "Autoscaling과 대시보드가 metrics API에 의존한다"
      fit: "HPA, kubectl top, 내부 비용 대시보드, custom exporter가 metrics.k8s.io를 읽는 조직"
      watchouts: "GA 전환 자체는 안정 신호지만 RBAC, client version, dashboard schema가 v1beta1에 고정되어 있을 수 있다."
      next_step: "v1/v1beta1 병행 기간에 client와 dashboard 호환 테스트를 만든다."
faqs:
  - question: "Kubernetes 1.37은 아직 릴리스 전인데 지금 봐야 하나요?"
    answer: "네. 공식 Sneak Peek 자체도 계획은 바뀔 수 있다고 말하지만, deprecation과 removal 후보는 업그레이드 당일보다 몇 주 먼저 inventory해야 합니다. 특히 node runtime, kube-proxy, static pod, CSI driver는 애플리케이션 PR 하나로 고치기 어렵습니다."
  - question: "metrics.k8s.io GA면 그냥 좋아지는 건가요?"
    answer: "기능 변화가 크지 않더라도 운영 계약은 바뀝니다. stable API를 쓰기 시작하면 dashboard, RBAC, SDK, HPA 검증을 표준화할 수 있지만, 기존 v1beta1 의존이 숨어 있으면 전환 중 혼란이 생길 수 있습니다."
---

Kubernetes v1.37은 2026년 8월 26일 릴리스가 계획되어 있습니다. 7월 31일 공개된 공식 Sneak Peek은 새 기능 소개보다 더 중요한 운영 신호를 담고 있습니다. 오래된 예외 경로를 줄이고, 런타임 권한을 좁히고, 관측 데이터를 표준 API로 올리고, 스토리지 상태를 기계가 읽을 수 있게 만드는 방향입니다.

이 흐름은 화려한 신규 기능보다 지루해 보일 수 있습니다. 하지만 플랫폼 운영에서는 이런 변화가 더 비쌉니다. `kube-proxy` 모드, cgroup 버전, static pod manifest, SELinux volume label, metrics API version, CSI health report는 애플리케이션 개발자가 매일 보는 코드가 아닙니다. 그렇지만 하나가 어긋나면 배포 실패, autoscaling 오작동, 노드 부팅 실패, 장애 분석 지연으로 바로 이어집니다.

이 글은 [Kubernetes Rollout 심화](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Kubernetes Custom Metrics Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/), [Runtime Security Patch Runway](/posts/2026-07-22-runtime-security-patch-runway-trend/), [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)과 이어집니다. 오늘의 질문은 "1.37에서 무엇이 새로워졌나"가 아니라, **우리 클러스터가 더 이상 기대면 안 되는 레거시 경로는 무엇인가**입니다.

참고한 공식 신호:

- Kubernetes Blog, Kubernetes v1.37 Sneak Peek: https://kubernetes.io/blog/2026/07/31/kubernetes-v1-37-sneak-peek/

## 이 글에서 얻는 것

- Kubernetes v1.37에서 눈여겨봐야 할 deprecation, breaking change, featured enhancement를 운영 관점으로 해석합니다.
- `ipvs` kube-proxy, cgroup v1, static pod의 API 리소스 참조, SELinux volume relabeling이 왜 업그레이드 리스크인지 이해합니다.
- metrics.k8s.io GA, rootless kubelet, volume health monitor가 플랫폼 팀의 관측·보안 계약을 어떻게 바꾸는지 정리합니다.
- 업그레이드 전에 확인할 inventory, canary, rollback 기준을 숫자와 조건으로 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) Kubernetes는 오래된 예외 경로를 계속 줄이고 있다

v1.37 Sneak Peek에서 가장 먼저 보이는 흐름은 deprecation과 removal입니다. `kubectl run --filename/-f`는 생성되는 Pod가 CLI 인자만으로 만들어진다는 이유로 deprecate될 예정입니다. 작은 CLI 옵션 하나처럼 보이지만, 오래된 스크립트와 교육 자료에 남아 있으면 자동화가 조용히 낡아갑니다.

더 중요한 것은 static pod입니다. static pod는 API server를 통해 생성되는 pod가 아니므로 본래 ConfigMap이나 Secret 같은 API 리소스를 직접 참조하는 모델과 맞지 않습니다. 그런데 기존에는 버그 때문에 `configMapRef`, `secretRef` 같은 참조가 가능했고, v1.37에서는 이 경로가 엄격히 금지되는 방향으로 정리됩니다. opt-out에 가까웠던 feature gate도 제거됩니다.

이 변화의 실무 의미는 분명합니다. control plane bootstrap, node-local agent, 긴급 복구용 static pod에서 "편해서 넣어둔" ConfigMap·Secret 참조가 없는지 봐야 합니다. 특히 kubelet이 API server보다 먼저 떠야 하는 구성에서 API 리소스 참조를 기대하면 부팅 순서 자체가 모순됩니다.

점검 기준:

| 항목 | 확인 방법 | 위험 신호 |
| --- | --- | --- |
| static pod manifest | `/etc/kubernetes/manifests`와 node image scan | `configMapRef`, `secretRef`, projected API volume |
| bootstrap script | 이미지 빌드와 cloud-init 확인 | API server 준비 전 `kubectl` 의존 |
| secret 주입 | 파일, env, CSI, node-local 경로 구분 | control plane 기동 전 API Secret 필요 |
| 복구 절차 | disaster recovery runbook | API server 장애 시 static pod가 같이 실패 |

이런 항목은 릴리스 당일에 고치기 어렵습니다. 지금 inventory가 필요합니다.

### 2) kube-proxy `ipvs` deprecation은 네트워크 기본값의 재검토다

v1.37은 kube-proxy의 `ipvs` 모드 지원 deprecation도 예고합니다. 공식 Sneak Peek은 `ipvs`가 성능 문제를 풀기 위해 도입됐지만, Kubernetes Service 구현에 필요한 모든 동작을 kernel ipvs API만으로 완전히 구현하지 못해 결국 iptables를 같이 쓰는 한계가 있다고 설명합니다. 일정도 제시됩니다. v1.40에서는 기본 비활성화가 예상되고, v1.43에서는 제거가 목표입니다.

이건 당장 모든 cluster가 깨진다는 뜻은 아닙니다. 하지만 플랫폼 팀에게는 네트워크 모드 전환 계획을 만들라는 신호입니다. `ipvs`를 쓰는 이유가 과거 성능 병목이었다면 현재 대안, CNI, kube-proxy mode, eBPF dataplane, Gateway API 구성까지 다시 봐야 합니다.

실무 판단 기준은 아래처럼 둘 수 있습니다.

| 상황 | 우선 조치 |
| --- | --- |
| kube-proxy mode가 비어 있거나 기본값 | 실제 실행 config를 수집해 baseline 작성 |
| `mode: ipvs` 사용 | v1.40 전환 목표로 canary cluster 준비 |
| 성능 이유로 ipvs 고정 | p95/p99 latency, conntrack, Service 수, EndpointSlice 수 재측정 |
| CNI가 eBPF dataplane 제공 | kube-proxy replacement 지원 범위와 fallback 검증 |

명령 하나로 시작할 수 있습니다.

```bash
kubectl -n kube-system get configmap kube-proxy -o jsonpath='{.data.config\.conf}' | rg 'mode:'
```

중요한 것은 "지금 돌아간다"가 아닙니다. 제거 일정이 공개된 경로에 production 네트워크를 계속 묶어둘 것인지, 어떤 기준으로 옮길 것인지 정해야 합니다.

### 3) cgroup v1 정리는 노드 운영 계약의 변경이다

Kubernetes는 cgroup v1 지원을 단계적으로 줄이고 있습니다. v1.35부터 `failCgroupV1` 기본값이 true가 되었고, v1.37에서도 임시 override는 남지만 장기적으로는 cgroup v2 전환이 권장됩니다. 이유는 단순한 유행이 아닙니다. In-place Pod Resizing, Tiered Memory Protection 같은 고급 리소스 관리 기능이 cgroup v2에 기대기 때문입니다.

이 변화는 애플리케이션 팀보다 플랫폼 팀의 책임입니다. 하지만 영향은 애플리케이션까지 내려옵니다. 노드 OS 이미지, container runtime, JVM·Go runtime의 memory 인식, sidecar resource limit, batch workload의 throttling이 모두 달라질 수 있습니다.

업그레이드 전 지표:

- 노드별 cgroup version 비율: v1 노드 0% 목표
- kubelet start failure: canary node pool에서 0건
- 주요 workload memory OOM rate: baseline 대비 +0.1%p 이내
- CPU throttling p95: baseline 대비 +20% 이내
- HPA scaling event rate: baseline 대비 2배 이상 증가 시 조사

이 기준은 [Runtime Security Patch Runway](/posts/2026-07-22-runtime-security-patch-runway-trend/)와 같은 사고방식입니다. 런타임 변화는 보안 패치처럼 보이지만 실제로는 성능, 관측, 배포 안정성의 문제입니다.

### 4) SELinuxMount GA는 보안 강화와 호환성 비용을 같이 만든다

v1.37에서는 SELinux volume relabeling, 즉 `SELinuxMount`가 GA가 되고 기본 활성화될 것으로 소개됩니다. 기존의 recursive relabeling 대신 mount option의 context label을 사용하는 방향이며, CSI driver가 opt-in한 경우에 적용됩니다. 장점은 성능과 보안 모델의 명확성입니다. 하지만 같은 node에서 서로 다른 SELinux label을 가진 pod가 같은 volume을 공유하던 구성은 시작 실패로 드러날 수 있습니다.

이런 변화는 테스트 환경에서 잘 안 보입니다. staging cluster가 SELinux를 끄고 있거나, CSI driver 구성이 production과 다르거나, shared volume workload가 적으면 통과합니다. production에서만 pod가 뜨지 않는 식의 장애가 생길 수 있습니다.

확인할 항목:

| 질문 | 기준 |
| --- | --- |
| SELinux가 실제 production node에서 enabled인가 | dev/staging과 차이 기록 |
| 어떤 CSI driver가 `seLinuxMount`에 opt-in하는가 | driver별 릴리스 노트 확인 |
| 서로 다른 label의 pod가 같은 volume을 공유하는가 | StatefulSet, DaemonSet, batch job 조사 |
| recursive relabeling이 필요한 workload가 있는가 | `seLinuxChangePolicy: Recursive` 후보 분리 |

보안 강화 기본값은 좋은 방향입니다. 다만 기본값이 바뀌는 순간 호환성 검증도 제품 운영의 일부가 됩니다.

### 5) metrics.k8s.io GA는 autoscaling 계약을 안정화한다

v1.37의 긍정적인 신호 중 하나는 `metrics.k8s.io` API의 GA 예정입니다. 거의 9년 동안 beta였던 API가 stable로 올라오며, Pod와 Node의 CPU·memory 사용량 조회를 표준 방식으로 제공하는 역할이 더 명확해집니다. HPA와 `kubectl top` 같은 기능이 이 API에 기대고 있다는 점을 생각하면 작지 않은 변화입니다.

공식 글은 기능 변화가 크지 않고 `v1`, `v1beta1`이 전환 기간에 함께 사용 가능하다고 설명합니다. 그래서 더더욱 지금이 정리하기 좋습니다. 급한 breaking change가 아니라 안정화 신호일 때 client, dashboard, RBAC, autoscaling 검증을 표준화해야 합니다.

[Kubernetes Custom Metrics Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/)에서 다룬 것처럼 autoscaling은 metric 이름 하나가 아니라 운영 계약입니다. HPA가 어떤 API version을 읽고, metric freshness가 몇 초까지 허용되며, metrics-server 장애 때 어떤 fallback을 택할지 정해야 합니다.

초기 기준:

- HPA 대상 workload 100%에 scaling reason 관측
- metrics freshness p95 30초 이하
- metrics API error rate 0.1% 초과 5분 지속 시 경보
- dashboard와 CLI가 `v1`에서 같은 값을 보이는지 canary
- metrics-server upgrade rollback time 15분 이하

GA는 "이제 신경 쓰지 않아도 된다"가 아니라 "이제 표준 계약으로 관리할 수 있다"는 뜻에 가깝습니다.

### 6) Rootless kubelet과 Volume Health는 장애 반경을 줄이는 방향이다

v1.37에서 kubelet in User Namespace, 즉 rootless mode가 Beta로 올라갈 것으로 소개됩니다. kubelet은 전통적으로 host root 권한을 갖기 때문에 취약점이 생기면 노드 전체 영향이 커질 수 있습니다. user namespace 안에서 host 기준 비특권 사용자로 동작하게 만드는 방향은 노드 컴포넌트의 권한 반경을 줄이는 시도입니다.

이 기능은 당장 모든 팀이 켜야 할 기본값은 아닐 수 있습니다. 하지만 보안 민감 cluster, multi-tenant compute, AI/ML workload처럼 노드 격리가 중요한 환경에서는 미리 평가할 가치가 있습니다. [AI/ML Workload UI와 Headlamp](/posts/2026-07-17-kubernetes-aiml-workload-ui-headlamp-trend/)에서 본 것처럼 Kubernetes가 개발자와 데이터 팀의 공통 실행 표면이 될수록 node-level 격리는 더 중요해집니다.

Volume Health Monitor도 같은 방향입니다. 지금까지 스토리지 장애는 mount 실패, hung I/O, vendor dashboard를 따로 대조해야 드러나는 경우가 많았습니다. v1.37의 alpha 방향은 CSI driver가 controller와 node 측면에서 volume health를 보고하고, PVC와 Pod status에 machine-readable 상태를 남기는 것입니다. `Inaccessible`, `Degraded` 같은 단순한 상태 어휘는 장애 대응 자동화에 유리합니다.

스토리지 장애 대응 기준:

| 신호 | 조치 |
| --- | --- |
| PVC health `Degraded` 5분 지속 | workload owner와 storage owner 동시 알림 |
| Pod volumeHealth `Inaccessible` | 재스케줄 가능 여부와 데이터 손상 가능성 분리 |
| controller와 node health 불일치 | CSI driver·node path·network path 분리 조사 |
| vendor dashboard만 장애 표시 | Kubernetes status로 끌어올릴 수 있는지 검토 |

관측은 사람이 화면을 더 많이 보는 것이 아니라, 시스템이 판단 가능한 상태를 더 가까운 API에 두는 일입니다.

## 실무 적용

### 1) v1.37 preflight inventory를 만든다

업그레이드 준비는 릴리스 노트 요약보다 inventory가 먼저입니다. 최소 파일은 아래처럼 만들 수 있습니다.

```yaml
kubernetes_137_preflight:
  clusters:
    - name: "prod-apne2"
      kube_proxy_mode: "ipvs"
      cgroup_version: "v2"
      static_pod_api_refs: 0
      selinux_enabled_node_pools: ["secure-pool-a"]
      metrics_api_clients:
        - "hpa"
        - "internal-cost-dashboard"
      csi_drivers:
        - name: "ebs.csi.aws.com"
          selinux_mount_opt_in: "unknown"
          volume_health_support: "unknown"
```

unknown을 줄이는 것이 첫 목표입니다. 완벽한 전환 계획보다, 모르는 상태를 줄이는 일이 먼저입니다.

운영팀에서 바로 시작한다면 30분짜리 루틴으로 충분합니다.

| 시간 | 확인 항목 | 산출물 |
| --- | --- | --- |
| 0~10분 | cluster 목록과 Kubernetes minor version | v1.37 영향권 cluster 목록 |
| 10~15분 | kube-proxy mode와 CNI dataplane | `ipvs`, `iptables`, eBPF 대체 경로 구분 |
| 15~20분 | node OS, cgroup version, kubelet flag | cgroup v1 잔존 노드와 override 후보 |
| 20~25분 | static pod manifest와 bootstrap script | API resource 참조 제거 대상 |
| 25~30분 | HPA, metrics-server, CSI driver owner | metrics/volume health 전환 owner |

이 루틴의 목적은 결론을 내리는 것이 아니라 owner 없는 위험을 드러내는 것입니다. `unknown`이 많아도 괜찮습니다. 다만 다음 회의까지 누가 확인할지 붙지 않은 `unknown`은 업그레이드 리스크로 남겨야 합니다.

### 2) canary cluster에서 기능보다 실패 모드를 재현한다

성공 사례만 보면 업그레이드가 쉬워 보입니다. 실제로는 실패 모드를 먼저 재현해야 합니다.

- static pod에서 API Secret 참조 시 실패하는가?
- ipvs cluster에서 대체 모드로 바꿨을 때 Service latency가 어떻게 바뀌는가?
- cgroup v2 node에서 JVM memory, Go runtime, sidecar가 같은 기준으로 동작하는가?
- SELinuxMount 영향 workload가 start failure를 만드는가?
- HPA와 dashboard가 metrics.k8s.io v1 값을 읽을 수 있는가?
- CSI volume health가 운영 화면과 alert에 연결되는가?

통과 기준은 "pod가 뜬다"보다 넓어야 합니다. p95 latency, HPA event, OOM rate, node pressure, pod start failure, volume error를 함께 봐야 합니다.

canary 결과는 아래처럼 성공/실패를 같은 표에 남기는 편이 좋습니다.

| 실패 모드 | 재현 방법 | 통과 기준 | 롤백 기준 |
| --- | --- | --- | --- |
| static pod API 참조 차단 | staging node image에 의도적으로 `secretRef` manifest 배치 | 실패가 문서화된 형태로 재현되고 대체 주입 경로가 확인됨 | control plane bootstrap이 대체 경로 없이 실패 |
| ipvs 전환 | canary node pool에서 대체 kube-proxy/CNI 경로 적용 | Service error rate +0.1%p 이하, p95 latency +10% 이하 | 30분 내 rollback 불가 또는 conntrack 오류 급증 |
| cgroup v2 전환 | 대표 JVM/Go/batch workload를 cgroup v2 node로 이동 | OOM rate와 CPU throttling이 baseline 범위 | OOM rate +0.1%p 초과 또는 HPA 진동 증가 |
| SELinuxMount | shared volume workload와 CSI driver 조합 테스트 | pod start failure 0건 또는 명시적 예외 정책 수립 | production과 다른 staging 설정 때문에 판단 불가 |
| metrics.k8s.io v1 | HPA, dashboard, CLI를 v1 client로 canary | 값 차이와 RBAC 오류 0건 | autoscaling decision 누락 또는 dashboard schema 오류 |

여기서 중요한 값은 절대적인 숫자보다 baseline 대비 변화입니다. [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) 없이 canary를 돌리면 "느낌상 괜찮다"로 끝나기 쉽습니다.

### 3) migration backlog를 위험도별로 쪼갠다

모든 cluster를 한 번에 고치려 하지 말고 위험도별 backlog를 만듭니다.

| 우선순위 | 작업 | 완료 기준 |
| --- | --- | --- |
| P0 | static pod API 참조 제거 | production node image scan 0건 |
| P0 | cgroup v1 노드 제거 | v1 노드 0%, override 0건 |
| P1 | ipvs 모드 전환 계획 | v1.40 전 canary와 rollback 검증 |
| P1 | SELinuxMount 영향 조사 | opt-in CSI driver와 shared volume 목록 확정 |
| P2 | metrics.k8s.io v1 client 전환 | dashboard/HPA canary 통과 |
| P2 | volume health alert 설계 | PVC/Pod status 기반 runbook 작성 |

이 표가 있으면 "Kubernetes 업그레이드"라는 큰 일을 팀별 작업으로 나눌 수 있습니다. 네트워크 팀, 보안팀, 스토리지 팀, 애플리케이션 owner가 각각 무엇을 확인해야 하는지 보입니다.

backlog에는 rollback 방법도 같이 적어야 합니다. 특히 ipvs 전환, cgroup v2, SELinuxMount는 설정만 되돌리면 끝나는 경우와 node pool 재생성이 필요한 경우가 섞입니다. 작업 티켓에는 최소한 아래 4개 필드를 넣습니다.

- `blast_radius`: cluster 전체, node pool, namespace, workload 중 어디까지 영향이 있는가
- `rollback_path`: config rollback, node pool rollback, workload pinning, feature gate 중 무엇을 쓸 것인가
- `owner`: 네트워크, 보안, 스토리지, 앱 owner 중 누가 최종 판단하는가
- `evidence`: latency, OOM, HPA event, pod start failure, volume health 중 어떤 지표로 통과를 증명하는가

이 형식은 [Policy Driven Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/)에서 다룬 점진 배포 사고방식과도 맞닿아 있습니다. 업그레이드는 큰 배포이고, 큰 배포에는 정책과 증거가 필요합니다.

### 4) 애플리케이션 팀에 전달할 질문을 미리 만든다

플랫폼 팀이 모든 workload 특성을 알 수는 없습니다. 그래서 v1.37 준비는 애플리케이션 팀에게 "Kubernetes가 바뀐다"가 아니라 구체적인 질문으로 전달해야 합니다.

| 질문 | 왜 필요한가 |
| --- | --- |
| 이 서비스는 startup 때 Secret/ConfigMap이 없으면 fail-fast하는가 | static pod와 bootstrap 경로에서 API 의존을 걷어내기 위해 |
| p95 latency가 10% 늘어도 괜찮은 endpoint가 있는가 | 네트워크 dataplane canary 허용 범위를 정하기 위해 |
| JVM heap과 container limit 사이에 별도 튜닝이 있는가 | cgroup v2 전환 후 memory 인식 차이를 보기 위해 |
| 같은 PVC를 여러 pod/security context가 공유하는가 | SELinuxMount로 인한 pod start failure 가능성을 찾기 위해 |
| HPA가 CPU/memory 외 custom metric에도 의존하는가 | metrics API 전환과 custom metrics 계약을 분리하기 위해 |

이 질문은 회의용 문서보다 PR 템플릿이나 upgrade readiness issue에 붙이는 편이 낫습니다. 애플리케이션 owner가 자기 서비스 기준으로 답해야 실제 migration backlog가 줄어듭니다.

## 트레이드오프/주의점

첫째, deprecation은 곧바로 장애가 아닙니다. 그래서 미루기 쉽습니다. 하지만 v1.40, v1.43처럼 제거 일정이 보이는 항목은 지금부터 migration budget을 잡아야 합니다. 네트워크 모드 전환은 sprint 하나로 끝나지 않습니다.

둘째, 보안 강화 기본값은 호환성 비용을 만듭니다. static pod 제한, SELinuxMount, rootless kubelet은 방향이 맞지만 기존 운영 관습을 깨뜨릴 수 있습니다. 보안과 호환성을 대립시키지 말고, staging에서 실패를 재현해 안전하게 옮기는 쪽이 현실적입니다.

셋째, stable API 전환도 검증이 필요합니다. metrics.k8s.io GA는 좋은 소식이지만, 내부 dashboard나 controller가 beta schema와 client behavior에 기대고 있을 수 있습니다. 안정화는 자동 마이그레이션이 아니라 전환 기회입니다.

넷째, vendor dashboard만 믿는 스토리지 운영은 점점 부족해집니다. CSI health가 Kubernetes status로 올라오면 애플리케이션 owner도 같은 상태를 볼 수 있습니다. 대신 alert noise가 늘 수 있으므로 `Degraded`와 `Inaccessible`의 운영 의미를 먼저 정해야 합니다.

의사결정 우선순위는 **부팅 실패 방지 > 네트워크 경로 안정성 > 노드 리소스 호환성 > 보안 기본값 전환 > 관측 API 표준화 > 새 기능 실험** 순서가 안전합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 모든 cluster의 kube-proxy mode를 수집했고 `ipvs` 사용 cluster에 owner가 있다.
- [ ] cgroup v1 노드와 `failCgroupV1: false` override가 inventory에 없다.
- [ ] static pod manifest에서 ConfigMap/Secret/API resource 참조를 제거했다.
- [ ] SELinux enabled node pool과 CSI driver opt-in 여부를 확인했다.
- [ ] metrics.k8s.io v1 전환이 HPA, dashboard, RBAC, SDK에서 canary됐다.
- [ ] volume health signal을 PVC/Pod status 기준 runbook으로 연결할 계획이 있다.
- [ ] v1.37 upgrade report에 p95 latency, OOM, HPA event, pod start failure, volume error가 포함된다.

### 연습

1. 현재 운영 중인 cluster 3개를 골라 `kube_proxy_mode`, `cgroup_version`, `static_pod_api_refs`, `selinux_enabled`, `metrics_api_clients`, `csi_drivers`를 한 표로 정리해 보세요.
2. `ipvs` 모드를 쓰는 cluster가 있다고 가정하고, 대체 경로 전환 canary의 성공 기준을 `latency p95`, `Service error rate`, `conntrack`, `rollback time`으로 정의해 보세요.
3. StatefulSet 하나를 골라 SELinuxMount 전환 시 같은 volume을 다른 label의 pod가 공유할 가능성이 있는지 확인하고, 실패 시 `seLinuxChangePolicy: Recursive`가 임시 대응인지 장기 대응인지 판단해 보세요.

## 함께 읽으면 좋은 글

- [Kubernetes Rollout 심화](/learning/deep-dive/deep-dive-kubernetes-rollouts/): 업그레이드와 배포를 단계별로 검증하는 기본 절차입니다.
- [Kubernetes Custom Metrics Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/): HPA와 metrics API를 운영 계약으로 다루는 관점입니다.
- [Runtime Security Patch Runway](/posts/2026-07-22-runtime-security-patch-runway-trend/): 노드·런타임 패치가 애플리케이션 안정성에 주는 영향을 다룹니다.
- [Policy Driven Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/): 큰 변경을 정책, canary, rollback evidence로 나누는 방법입니다.

## 출처 링크

- Kubernetes Blog - Kubernetes v1.37 Sneak Peek: https://kubernetes.io/blog/2026/07/31/kubernetes-v1-37-sneak-peek/
