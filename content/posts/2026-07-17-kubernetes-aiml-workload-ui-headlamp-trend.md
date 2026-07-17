---
title: "2026 개발 트렌드: Kubernetes AI/ML Workload UI, Kubeflow 운영이 일반 클러스터 UI로 들어온다"
date: 2026-07-17T10:06:00+09:00
draft: false
tags: ["Kubernetes", "AI/ML Platform", "Headlamp", "Kubeflow", "Platform Engineering", "Observability"]
categories: ["Development", "Platform Engineering", "Kubernetes"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes AI/ML workload UI", "Headlamp Kubeflow plugin", "Kubeflow CRD", "Volcano Headlamp", "cluster operations"]
description: "Kubernetes 공식 블로그의 Headlamp Kubeflow 플러그인과 Dashboard 전환 흐름을 바탕으로, AI/ML 워크로드 운영이 전용 ML 대시보드에서 클러스터 진실을 보여주는 일반 Kubernetes UI로 이동하는 이유를 정리합니다."
lastmod: 2026-07-17
summary: "AI/ML 플랫폼은 노트북, 파이프라인, 튜닝, 분산 학습을 Kubernetes CRD로 모델링합니다. 최근 Headlamp 플러그인 흐름은 전용 ML 대시보드만으로는 부족한 Pod 조건, 이벤트, 리소스, ownerReference, queue 상태를 일반 클러스터 UI에서 함께 보려는 운영 변화입니다."
key_takeaways:
  - "Kubernetes 공식 블로그는 Kubeflow, Volcano, Dashboard-to-Headlamp 흐름을 통해 CRD-heavy 플랫폼 운영 UI가 일반 Kubernetes UI의 플러그인 모델로 이동하고 있음을 보여준다."
  - "AI/ML 장애 분석의 핵심은 실험 이름보다 Pod condition, PVC, GPU request/limit, queue, ownerReference, pipeline version diff 같은 클러스터 증거다."
  - "실무 도입은 UI 교체가 아니라 RBAC, multi-cluster 접근, 플러그인 검증, incident runbook, SRE와 ML 플랫폼팀의 책임 분리를 같이 설계해야 한다."
operator_checklist:
  - "Kubeflow Notebook, Pipeline, Katib, Training, Spark 리소스가 어떤 namespace와 RBAC 경계에서 보이는지 먼저 inventory로 만든다."
  - "AI/ML 장애 runbook에 Pod condition, event, PVC, GPU quota, queue, ownerReference, pipeline version diff 확인 순서를 넣는다."
  - "Headlamp 같은 확장 UI는 staging cluster에서 플러그인 권한, read/write 범위, audit log, secret 노출 여부를 먼저 검증한다."
learning_refs:
  - title: "Kubernetes Basics"
    href: "/learning/deep-dive/deep-dive-kubernetes-basics/"
    description: "Pod, Deployment, Service, namespace, 기본 리소스 모델을 정리한 글입니다."
  - title: "Kubernetes Rollouts"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "배포 상태와 rollout 실패를 운영 관점으로 보는 기준입니다."
  - title: "Observability Baseline"
    href: "/learning/deep-dive/deep-dive-observability-baseline/"
    description: "메트릭, 로그, trace를 장애 분석 증거로 연결하는 기본 관점입니다."
  - title: "Workload-Aware Queue Partitioning"
    href: "/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/"
    description: "워크로드별 큐와 공정성, 우선순위를 설계하는 백엔드 운영 기준입니다."
decision_guide:
  title: "AI/ML Workload UI를 언제 표준화할까"
  intro: "모든 팀이 바로 Kubernetes UI를 바꿀 필요는 없습니다. ML 워크로드 규모, 장애 빈도, SRE 참여도, CRD 수, multi-cluster 운영 여부를 기준으로 도입 범위를 정해야 합니다."
  cases:
    - badge: "즉시 검토"
      title: "Kubeflow, Volcano, Spark, Training Operator를 여러 팀이 함께 쓴다"
      fit: "전용 ML 대시보드와 kubectl 사이를 오가며 장애를 분석하고, namespace와 queue가 늘어난 환경입니다."
      watchouts: "읽기 UI를 열었는데 실제로는 write 권한까지 넓어지면 운영 경계가 무너집니다."
      next_step: "read-only Headlamp staging을 열고 Notebook stuck, failed Run, queue pending 3개 시나리오로 runbook을 검증합니다."
    - badge: "부분 적용"
      title: "단일 ML 팀이 한 클러스터에서 Kubeflow 일부만 쓴다"
      fit: "노트북이나 파이프라인 정도만 운영하며 SRE 개입이 가끔 필요한 단계입니다."
      watchouts: "플러그인보다 먼저 리소스 이름, label, ownerReference 정리가 필요할 수 있습니다."
      next_step: "Notebook, Run, Pod, PVC를 한 화면에서 추적할 수 있는 최소 view부터 붙입니다."
    - badge: "보류 가능"
      title: "실험성 클러스터 또는 관리형 ML 플랫폼만 사용한다"
      fit: "운영 장애가 서비스 SLO로 이어지지 않고, Kubernetes 접근을 플랫폼팀만 하는 경우입니다."
      watchouts: "나중에 GPU 비용과 queue 대기가 커지면 전용 SaaS 화면만으로 원인 분석이 부족해질 수 있습니다."
      next_step: "지금은 resource request, quota, event, owner 정보를 로그로 남기는 것부터 시작합니다."
faqs:
  - question: "ML 대시보드가 있는데 왜 Kubernetes UI가 또 필요한가요?"
    answer: "ML 대시보드는 실험과 파이프라인 경험에 강하지만, SRE가 보는 장애 원인은 Pod condition, node, PVC, event, quota, scheduler 상태에 있습니다. 둘은 대체재가 아니라 서로 다른 관점입니다."
  - question: "Headlamp를 쓰면 kubectl이 필요 없어지나요?"
    answer: "아닙니다. UI는 관계와 상태를 빠르게 파악하게 해주지만, 변경 작업, 자동화, 재현 가능한 진단은 여전히 kubectl, GitOps, runbook과 함께 운영해야 합니다."
---

Kubernetes 위의 AI/ML 운영이 한 단계 더 현실적인 문제로 이동하고 있습니다. 예전에는 "Kubeflow를 설치한다", "GPU 노드를 붙인다", "파이프라인을 돌린다"가 중심이었다면, 이제는 장애가 났을 때 누가 어떤 화면에서 어떤 증거를 보고 판단할지가 중요해졌습니다. 노트북이 stuck인지, 파이프라인 run이 실패했는지, Katib 실험이 early stop됐는지, PyTorch TrainJob이 runtime을 잘못 참조했는지, SparkApplication이 어떤 Pod와 PVC를 만들었는지 보는 일이 운영 업무가 됐습니다.

2026년 7월 13일 Kubernetes 공식 블로그는 Headlamp Kubeflow 플러그인을 소개했습니다. 핵심은 Kubeflow의 Notebook, Pipeline, Katib, Training, Spark 리소스를 일반 Kubernetes UI 안에서 직접 보여주는 것입니다. 같은 날에는 Kubernetes Dashboard에서 Headlamp로 옮기는 단계별 가이드도 나왔고, 6월 25일에는 Volcano 워크로드를 Headlamp에서 보는 플러그인 글도 있었습니다. 한 줄로 보면 **CRD-heavy 플랫폼의 운영 UI가 전용 콘솔에서 클러스터 진실을 보여주는 확장형 Kubernetes UI로 이동하는 흐름**입니다.

이 글은 [Kubernetes Basics](/learning/deep-dive/deep-dive-kubernetes-basics/), [Kubernetes Rollouts](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/), [Workload-Aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)과 이어집니다. AI/ML 플랫폼이라고 해서 운영 원리가 완전히 달라지는 것은 아닙니다. 다만 리소스 종류가 늘어나고, 사용자 집단이 data scientist, ML engineer, SRE, platform engineer로 갈라지기 때문에 화면과 권한, runbook이 더 중요해집니다.

참고 신호:

- Kubernetes Blog, Operating AI/ML Workloads on Kubernetes: A Headlamp Plugin for Kubeflow: https://kubernetes.io/blog/2026/07/13/introducing-headlamp-plugin-for-kubeflow/
- Kubernetes Blog, Kubernetes Dashboard to Headlamp: A Step-by-Step Guide: https://kubernetes.io/blog/2026/07/13/kubernetes-dashboard-to-headlamp/
- Kubernetes Blog, Inspect Volcano workloads faster with Headlamp: https://kubernetes.io/blog/2026/06/25/visual-context-volcano-headlamp-plugin/
- Kubernetes Blog, Kubernetes v1.36 release: https://kubernetes.io/blog/2026/04/22/kubernetes-v1-36-release/

## 이 글에서 얻는 것

- AI/ML 워크로드 운영에서 전용 ML 대시보드만으로 부족해지는 지점을 이해합니다.
- Kubeflow CRD, Pod condition, PVC, GPU request/limit, ownerReference, pipeline version diff가 왜 같은 화면에 있어야 하는지 정리합니다.
- Headlamp 같은 확장형 Kubernetes UI를 도입할 때 RBAC, multi-cluster, plugin, audit 기준을 잡을 수 있습니다.
- ML 플랫폼팀과 SRE가 장애를 함께 볼 때 필요한 실무 runbook과 의사결정 숫자를 가져갑니다.

## 핵심 개념/이슈

### 1) AI/ML 플랫폼은 Kubernetes CRD 위에 세워진다

Kubeflow는 노트북, 파이프라인, 실험, 튜닝, 분산 학습을 Kubernetes-native 방식으로 모델링합니다. 겉으로는 "실험 관리 도구"처럼 보이지만 내부적으로는 Custom Resource Definition이 늘어나는 구조입니다. Notebook, Run, Experiment, Trial, TrainJob, SparkApplication 같은 리소스가 있고, 그 아래에는 결국 Pod, PVC, ConfigMap, Secret, ServiceAccount, Event가 있습니다.

이 구조의 장점은 Kubernetes 운영 모델을 재사용할 수 있다는 점입니다. namespace, RBAC, label, ownerReference, event, controller reconciliation이 그대로 적용됩니다. 단점은 장애 분석 시 화면이 갈라진다는 점입니다. Data scientist는 ML 대시보드에서 run 이름과 metric을 보고, SRE는 `kubectl describe pod`와 node event를 봅니다. 같은 사건을 다른 언어로 보는 셈입니다.

Headlamp Kubeflow 플러그인이 의미 있는 이유가 여기에 있습니다. ML 플랫폼 리소스를 일반 클러스터 UI 안으로 가져오면, "이 실험이 실패했다"와 "이 Pod가 OOMKilled였다"를 같은 흐름에서 볼 수 있습니다.

### 2) 운영자가 묻는 질문은 실험 UI와 다르다

ML 대시보드는 실험 제출, metric 비교, pipeline 실행에는 좋습니다. 하지만 운영자가 장애를 볼 때 묻는 질문은 다릅니다.

| 질문 | 필요한 Kubernetes 증거 |
| --- | --- |
| Notebook이 왜 안 뜨나 | Pod condition, ImagePullBackOff, PVC binding, node toleration |
| Run이 왜 실패했나 | Run status, 관련 Pod event, container exit code |
| 튜닝이 왜 오래 걸리나 | Trial 상태, early stop, queue 대기, GPU quota |
| 학습 job이 왜 pending인가 | resource request, node capacity, priority, PodGroup |
| 파이프라인이 왜 예전 spec으로 돌았나 | PipelineVersion diff, RecurringRun schedule, controller event |

이 증거가 여러 콘솔과 CLI에 흩어져 있으면 MTTR이 늘어납니다. 특히 GPU가 부족하거나 PVC가 묶이지 않거나 image pull secret이 깨진 장애는 ML 코드 문제가 아니라 클러스터 운영 문제입니다. 반대로 SRE가 metric 이름만 보고 ML 의미를 모르면 잘못된 queue 조정이나 재시작을 할 수 있습니다.

### 3) Headlamp 흐름은 Dashboard 교체보다 plugin 운영 모델이 핵심이다

Kubernetes Dashboard에서 Headlamp로 옮기는 가이드에서 중요한 포인트는 접근 모델입니다. Dashboard는 주로 in-cluster 웹앱으로 배포되고 service account token에 기대는 흐름이 강했습니다. Headlamp는 desktop에서 kubeconfig로 여러 클러스터를 볼 수도 있고, in-cluster로 배포해 ServiceAccount와 RBAC를 따를 수도 있습니다. 또한 plugin으로 CRD별 view를 추가할 수 있습니다.

이 차이는 단순 UI 취향이 아닙니다. AI/ML 플랫폼은 CRD가 많고 팀마다 보는 리소스가 다릅니다. Kubeflow 팀은 Notebook과 Pipeline을 보고, batch 플랫폼팀은 Volcano Job과 Queue를 보고, cluster lifecycle 팀은 Cluster API를 볼 수 있습니다. 하나의 거대한 콘솔을 새로 만드는 대신, 일반 Kubernetes UI에 도메인별 view를 붙이는 방향이 운영 비용을 줄입니다.

도입 기준은 아래처럼 잡을 수 있습니다.

- cluster 3개 이상 또는 namespace 20개 이상이면 multi-cluster UI 가치가 커진다.
- Kubeflow/Volcano/Spark 같은 CRD가 10종 이상이면 plugin view가 CLI보다 빠르다.
- ML 장애에서 SRE 호출이 월 3회 이상이면 공통 runbook 화면이 필요하다.
- GPU 비용이 월 예산의 20% 이상이면 queue, pending, idle resource를 UI에서 추적해야 한다.
- write 권한이 있는 UI는 staging에서 최소 2주 read-only 검증 후 제한적으로 연다.

### 4) Volcano 플러그인은 AI/ML 스케줄링 운영의 다른 축을 보여준다

Volcano는 Kubernetes batch scheduler로 HPC, AI/ML, batch workload에서 queue, priority, quota, gang scheduling을 다룹니다. 일반 Deployment 운영과 다르게 batch job은 여러 worker가 동시에 떠야 진행될 수 있고, GPU나 대용량 메모리 같은 제한 자원을 두고 경쟁합니다. Pod 하나만 보면 왜 pending인지 모를 때가 많습니다. Queue, PodGroup, Job 전체 상태를 함께 봐야 합니다.

Volcano Headlamp 플러그인 흐름은 Kubeflow 플러그인과 같은 메시지를 줍니다. AI/ML 운영은 Pod 목록만 봐서는 부족하고, 그렇다고 전용 도구 화면만 봐도 부족합니다. 도메인 리소스와 Kubernetes 기반 리소스를 연결해서 봐야 합니다. 이 관점은 [Workload-Aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)과 직접 연결됩니다. 공정성 문제는 코드 버그가 아니라 queue와 quota 정책 문제일 가능성이 큽니다.

### 5) UI의 진짜 가치는 "관계"를 보여주는 것이다

운영 UI가 표만 잘 보여주면 충분하던 시절은 지났습니다. CRD-heavy 플랫폼에서는 리소스 관계가 중요합니다. Notebook은 Pod와 PVC를 만들고, Pipeline Run은 PipelineVersion과 artifact root를 참조하며, TrainJob은 TrainingRuntime과 Pod를 통해 실제 학습을 수행합니다. Volcano Job은 PodGroup, Queue, Pod event와 연결됩니다.

좋은 UI는 이 관계를 줄입니다. 운영자가 클릭 5번과 `kubectl describe` 4번을 거쳐야 하던 것을 하나의 흐름으로 보여줍니다. 특히 ownerReference 그래프, side-by-side YAML diff, Pod condition reason, Secret/ConfigMap 참조, GPU request/limit은 장애 판단 시간을 줄이는 데 바로 도움이 됩니다.

## 실무 적용

### 1) AI/ML 리소스 inventory를 먼저 만든다

Headlamp나 다른 UI를 붙이기 전, 클러스터 안에 어떤 ML 리소스가 있는지 표로 만듭니다.

```yaml
ml_platform_inventory:
  clusters:
    - name: "prod-ml-apne2"
      kubeflow_components: ["notebooks", "pipelines", "katib", "training", "spark"]
      schedulers: ["default", "volcano"]
      namespaces: 34
      gpu_node_pools: 3
      monthly_gpu_budget_ratio: "28%"
      sre_incidents_last_30d: 5
      ui_mode_candidate: "headlamp-readonly-first"
```

이 표가 있어야 UI 도입 범위가 정해집니다. Kubeflow 일부만 쓰는 팀과 Volcano queue까지 운영하는 팀은 필요한 view가 다릅니다.

### 2) 장애 runbook을 화면 순서로 바꾼다

ML 장애 runbook은 "kubectl로 확인"이 아니라 화면과 증거 순서로 써야 합니다.

1. Notebook 또는 Run 상태를 확인한다.
2. 연결된 Pod condition과 event를 본다.
3. PVC, Secret, ConfigMap 참조 오류를 확인한다.
4. GPU/CPU/memory request와 namespace quota를 비교한다.
5. Volcano를 쓰면 Queue와 PodGroup pending reason을 확인한다.
6. Pipeline이면 최신 PipelineVersion과 이전 spec diff를 본다.
7. 해결 후 같은 리소스 graph에서 owner와 재발 방지 label을 남긴다.

권장 숫자는 `stuck notebook triage 10분 이내`, `failed Run owner routing 15분 이내`, `queue pending 원인 분류 20분 이내`, `GPU idle-cost incident 30분 이내` 정도로 시작할 수 있습니다. SLA라기보다 runbook이 실제로 짧아졌는지 보는 기준입니다.

### 3) RBAC는 read-only부터 좁게 연다

운영 UI는 편한 만큼 위험합니다. 특히 AI/ML 플랫폼에는 Secret, volume mount, environment variable, artifact path, data source가 많이 걸립니다. UI가 이것을 보여준다면 보안 경계가 넓어집니다. 처음에는 read-only와 namespace 제한으로 시작합니다.

권장 단계:

| 단계 | 범위 | 기준 |
| --- | --- | --- |
| 1단계 | staging read-only | plugin 설치, secret masking, audit log 확인 |
| 2단계 | prod read-only 일부 namespace | SRE와 ML platform owner만 접근 |
| 3단계 | prod read-only 전체 ML namespace | incident runbook 검증 후 확대 |
| 4단계 | 제한적 write | restart, scale, delete는 별도 승인과 receipt 필요 |

write 버튼이 있는 UI는 꼭 조심해야 합니다. ML job 삭제, queue 조정, recurring run 중지는 비용과 데이터 재현성에 영향을 줍니다. 변경은 GitOps나 운영 API를 통해 남기고, UI write는 긴급 상황으로 제한하는 편이 안전합니다.

### 4) 플러그인은 공급망과 권한 표면으로 본다

Headlamp의 장점은 plugin입니다. 동시에 plugin은 UI 안에서 실행되는 확장 코드입니다. 따라서 "공식 블로그에 나왔으니 바로 production"이 아니라 플러그인 출처, license, 유지보수, 권한, secret 노출, API 호출 범위를 봐야 합니다.

검증 기준:

- plugin repository와 release 출처가 명확한가
- Apache 2.0 등 license가 조직 정책과 맞는가
- read-only view가 실제로 write API를 호출하지 않는가
- Secret value, token, env 원문이 화면이나 로그에 노출되지 않는가
- plugin 오류가 Headlamp 전체 장애로 번지지 않는가
- cluster API 호출량이 apiserver에 부담을 주지 않는가

특히 multi-cluster UI는 실수의 반경이 큽니다. dev cluster를 본다고 생각하고 prod cluster 리소스를 건드리는 사고를 막으려면 cluster name, environment badge, destructive action confirmation이 필요합니다.

### 5) 도입 전 게이트를 수치로 둔다

AI/ML 운영 UI는 "좋아 보인다"보다 "어떤 장애 시간을 줄일 것인가"로 판단해야 합니다. 아래 기준을 만족하지 못하면 먼저 label, ownerReference, event 보존, runbook을 정리하는 편이 낫습니다.

| 게이트 | 통과 기준 | 보류 신호 |
| --- | --- | --- |
| 사고 빈도 | 최근 30일 ML 워크로드 장애 3건 이상 | 장애 원인이 대부분 코드/데이터 품질 문제 |
| 리소스 복잡도 | Kubeflow/Volcano/Spark/Training CRD 합산 8종 이상 | Notebook만 단일 팀이 사용 |
| 권한 경계 | namespace별 read-only RBAC를 분리 가능 | cluster-admin token 공유 관행 |
| 비용 영향 | GPU idle 또는 pending 비용을 월 1회 이상 리뷰 | 비용 데이터와 queue 상태가 연결되지 않음 |
| 운영 협업 | SRE와 ML 플랫폼팀이 같은 runbook을 쓴다 | 팀마다 별도 콘솔과 별도 용어 사용 |

이 표는 도입 승인 문서에도 그대로 넣을 수 있습니다. 핵심은 UI 도입을 "새 화면 추가"가 아니라 incident workflow 변경으로 보는 것입니다. 통과 기준이 3개 이상이면 staging read-only PoC를 열고, 2개 이하이면 먼저 리소스 taxonomy와 runbook을 정리합니다.

### 6) 운영 지표는 MTTR만 보지 않는다

Headlamp류 UI의 효과는 배포 직후 체감되지만, 숫자로 확인하지 않으면 plugin이 늘어날수록 관리 비용만 커집니다. 다음 지표를 2주 단위로 봅니다.

- `triage_to_owner_minutes`: 장애 감지 후 담당 팀을 찾는 데 걸린 시간
- `pending_reason_classification_rate`: pending 워크로드 중 원인을 quota, PVC, image, scheduler, node capacity로 분류한 비율
- `kubectl_handoff_count`: UI에서 본 뒤 CLI로 넘어간 횟수와 이유
- `secret_exposure_incidents`: UI, log, screenshot에 secret성 정보가 노출된 횟수
- `plugin_error_rate`: 플러그인 로딩 실패, 빈 화면, API timeout 비율
- `queue_policy_change_receipts`: queue, priority, quota 변경이 승인 기록과 연결된 비율

좋은 목표는 `MTTR 20% 감소`처럼 큰 숫자 하나가 아닙니다. 처음에는 `owner routing 15분 이내 80%`, `pending reason 분류율 90%`, `UI write action 0건`, `secret exposure 0건`처럼 운영 습관을 바꾸는 지표가 더 안전합니다. 특히 production 첫 달에는 write action을 성과로 보지 말고 위험 신호로 보는 편이 좋습니다.

## 트레이드오프/주의점

첫째, UI가 좋아진다고 운영 책임이 사라지지 않습니다. 오히려 더 많은 사람이 클러스터 상태를 볼 수 있게 되므로 권한, 교육, 감사 로그가 중요해집니다. read-only라도 Secret 참조나 namespace 이름이 민감할 수 있습니다.

둘째, 전용 ML 대시보드를 버리자는 이야기가 아닙니다. Data scientist에게는 실험 metric, artifact, model registry 흐름이 여전히 필요합니다. Headlamp류 UI는 SRE와 플랫폼팀이 클러스터 증거를 보는 운영 화면에 가깝습니다.

셋째, CRD view가 많아지면 화면도 복잡해집니다. 모든 plugin을 켜면 오히려 찾기 어려울 수 있습니다. 팀별로 Notebook/Pipeline 중심, Queue 중심, Cluster lifecycle 중심처럼 sidebar와 권한을 나눠야 합니다.

넷째, UI는 재현 가능한 자동화를 대체하지 못합니다. 장애 원인 확인은 UI가 빠를 수 있지만, 수정은 GitOps PR, Helm values 변경, policy update, quota 조정 runbook으로 남겨야 합니다.

다섯째, AI/ML 리소스는 비용과 보안이 함께 걸립니다. GPU pending만 줄이려고 priority를 높이면 다른 팀 workload가 밀릴 수 있고, artifact path를 넓게 열면 데이터 경계가 흔들릴 수 있습니다. 판단 기준은 **보안/RBAC > 재현성 > SLO 영향 > GPU 비용 최적화** 순서로 두는 편이 안전합니다.

## 체크리스트 또는 연습

- [ ] Kubeflow, Volcano, Spark, Training Operator 등 설치된 CRD 목록을 namespace별로 정리했다.
- [ ] SRE가 Notebook, Run, TrainJob, SparkApplication에서 관련 Pod와 event로 이동할 수 있다.
- [ ] GPU request/limit, namespace quota, queue pending reason을 한 runbook 안에서 확인한다.
- [ ] Headlamp 또는 유사 UI의 production 접근은 read-only부터 시작한다.
- [ ] Secret, ConfigMap, env var 표시 정책에 masking 기준이 있다.
- [ ] plugin 설치 전 source, license, API 호출 범위, audit log를 확인한다.
- [ ] multi-cluster UI에는 environment badge와 destructive action guard가 있다.
- [ ] ML 대시보드와 Kubernetes UI의 책임 경계가 문서화되어 있다.

연습은 간단합니다. 최근 실패한 ML run 하나를 골라 `ML 대시보드에서 보이는 정보`, `Kubernetes 리소스에서 보이는 정보`, `SRE가 실제로 필요했던 정보`를 세 칸으로 나눠 적어 보세요. Pod condition, PVC, queue, quota, version diff 중 두 개 이상이 별도 CLI 없이는 보이지 않았다면, CRD-aware Kubernetes UI 도입 가치를 검토할 시점입니다.
