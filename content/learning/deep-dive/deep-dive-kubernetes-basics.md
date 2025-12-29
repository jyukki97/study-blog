---
title: "Kubernetes 기본: Pod가 죽지 않는 항해"
date: 2025-12-03
draft: false
topic: "DevOps"
tags: ["Kubernetes", "K8s", "Pod", "Deployment", "Service"]
categories: ["Backend Deep Dive"]
description: "컨테이너 오케스트레이션이 필요한 이유. Pod/Deployment/Service의 관계와 자가 치유(Self-Healing)"
module: "ops-observability"
study_order: 601
quizzes:
  - question: "Kubernetes(K8s)가 Docker Compose보다 강력한 가장 큰 이유는?"
    options:
      - "Docker보다 빠르기 때문"
      - "다중 노드 클러스터에서 자동 스케일링, 자가 치유(Self-healing), 롤링 업데이트를 지원하기 때문"
      - "YAML 파일이 더 간단하기 때문"
      - "무료이기 때문"
    answer: 1
    explanation: "Docker Compose는 단일 호스트에서 동작하지만, K8s는 여러 노드에 걸쳐 컨테이너를 배포하고, 장애 시 자동 복구, HPA로 자동 스케일링이 가능합니다."

  - question: "Kubernetes에서 Pod가 '일시적(Ephemeral)'이라는 것의 의미와 이에 따른 설계 원칙은?"
    options:
      - "Pod는 영구적이므로 IP를 설정에 하드코딩해도 된다."
      - "Pod가 죽으면 새 Pod가 생성되고 IP가 바뀌므로, Pod IP를 직접 참조하지 말고 Service를 통해 접근해야 한다."
      - "Pod는 재시작되지 않으므로 재시작 정책이 필요 없다."
      - "Pod는 메모리에만 존재한다."
    answer: 1
    explanation: "Pod는 언제든 죽고 새로 생성될 수 있으며, 새 Pod는 다른 IP를 받습니다. 그래서 Service(고정 IP/ClusterIP)를 사용해 Pod 집합에 접근해야 합니다."

  - question: "Kubernetes에서 Deployment와 Service의 관계로 올바른 것은?"
    options:
      - "둘은 동일한 역할을 한다."
      - "Deployment는 'Pod N개 유지'를 담당하고, Service는 '변하는 Pod들에게 고정 IP(로드밸런서)'를 제공한다."
      - "Service가 Pod를 직접 생성한다."
      - "Deployment는 네트워킹을 담당한다."
    answer: 1
    explanation: "Deployment는 ReplicaSet을 관리하여 원하는 개수의 Pod를 유지합니다. Service는 Label Selector로 Pod를 찾아 트래픽을 분산하는 내부 로드밸런서입니다."

  - question: "Kubernetes에서 Service가 Pod를 찾을 때 사용하는 메커니즘은?"
    options:
      - "Pod의 IP 주소"
      - "Label과 Selector 매칭"
      - "Pod 이름"
      - "컨테이너 ID"
    answer: 1
    explanation: "Service의 selector와 Pod의 labels가 정확히 일치해야 연결됩니다. `kubectl get pod --show-labels`로 라벨을 확인할 수 있습니다."

  - question: "Kubernetes의 '선언적(Declarative) API'가 의미하는 것은?"
    options:
      - "명령어로 직접 Pod를 실행한다."
      - "'원하는 상태(Desired State)'를 YAML로 선언하면 K8s가 현재 상태를 맞춰간다."
      - "수동으로 Pod를 관리해야 한다."
      - "REST API만 사용할 수 있다."
    answer: 1
    explanation: "K8s는 'replicas: 3'이라고 선언하면 현재 Pod 수를 확인하고 부족하면 생성, 많으면 삭제하여 원하는 상태를 유지합니다."
---

## ☸️ 1. Docker만 쓰면 되지 않나요?

컨테이너가 10개면 수동으로 관리할 수 있습니다.
하지만 100개, 1000개가 되면?

- 어떤 서버에 빈 자리가 있는지? (Scheduling)
- 컨테이너가 죽으면 누가 살려주는지? (Self-healing)
- 새로운 버전 배포할 때 무중단으로 어떻게 하는지? (Rolling Update)

이걸 **자동화**해주는 선장(Pilot)이 Kubernetes입니다.

### Docker Compose vs Kubernetes 비교

| 특징 | Docker Compose | Kubernetes (K8s) |
| :--- | :--- | :--- |
| **규모** | 단일 호스트 (로컬 개발용) | 다중 노드 클러스터 (대규모 운영용) |
| **스케일링** | 수동 (`scale` 명령) | 자동 (Auto-scaling, HPA) |
| **장애 복구** | 컨테이너 재시작 (단순) | 자가 치유 (Self-healing), 노드 간 이동 |
| **네트워크** | 단순 링크 | 복잡한 오버레이 네트워크 (CNI) |

---

## 🏗️ 2. 아키텍처: Master와 Node

```mermaid
graph TD
    API[API Server] --> Kubelet1[Kubelet 1]
    API --> Kubelet2[Kubelet 2]
    
    Kubelet1 --> Pod1[Pod A]
    Kubelet1 --> Pod2[Pod B]
    
    Kubelet2 --> Pod3[Pod C]
    
    style API fill:#bbdefb
```

1. **Control Plane**: 두뇌입니다. "Pod 3개 유지해"라는 명령을 기억하고 감시합니다.
2. **Worker Node**: 일꾼입니다. 실제 컨테이너(Pod)가 여기서 돌아갑니다.

---

## 📦 3. 핵심 3대장: Pod, Deployment, Service

가장 헷갈리는 3가지 개념을 정리합니다.

### 3-1. Pod (콩깍지)
- **가장 작은 단위**: 쿠버네티스는 컨테이너를 직접 다루지 않고, Pod라는 껍질로 감싸서 다룹니다.
- **특징**: IP를 하나 가집니다. (같은 Pod 내 컨테이너끼리는 `localhost` 통신 가능)

> [!WARNING]
> **Pod는 영원하지 않습니다 (Ephemeral)**.
> Pod가 죽으면 살려내는 게 아니라, **새로운 Pod**를 만들어서 갈아끼웁니다. 따라서 Pod의 IP는 언제든 바뀔 수 있습니다. 절대 Pod IP를 직접 설정에 박지 마세요!

### 3-2. Deployment (관리자)
- **역할**: "Pod 3개를 항상 유지해라" (ReplicaSet 관리)
- **배포**: 버전을 v1 -> v2로 올릴 때 하나씩 갈아끼우는 전략을 담당합니다.

```mermaid
graph LR
    Service[Service IP: 10.96.1.5] --> Pod1[Pod A]
    Service --> Pod2[Pod B]
    Service -.-> Pod3[Pod C New]
    
    style Service fill:#fff9c4
```

### 3-3. Service (전화번호부)
- **문제**: Pod는 죽었다 살아나면 **IP가 바뀝니다.**
- **해결**: 고정된 IP(ClusterIP)를 제공해서, 뒤쪽 Pod가 바뀌든 말든 항상 연결되게 해줍니다. 일종의 **내부 로드밸런서**입니다.

---

## 🛠️ 4. 실무 패턴 (YAML 읽는 법)

```yaml
# Deployment: "3개 띄워줘"
kind: Deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-server

---
# Service: "my-server 찾는 애들 이리로 보내줘"
kind: Service
spec:
  selector:
    app: my-server
  ports:
    - port: 80
      targetPort: 8080
```

`Label`로 서로를 찾습니다. Deployment가 만든 Pod에 붙은 라벨(`app: my-server`)을 Service가 보고 트래픽을 토스합니다.

> [!TIP]
> **디버깅 팁**:
> 내 Service가 Pod를 못 찾는 것 같다면? 라벨을 확인하세요.
> `kubectl get pod --show-labels`
> Service의 selector와 Pod의 labels가 **정확히(글자 하나라도 틀리면 안 됨)** 일치해야 합니다.

## 요약

1. **선언적 API**: "명령(Run)"이 아니라 "원하는 상태(State)"를 적어두면 알아서 맞춘다.
2. **Pod**: 배포의 최소 단위. 쉽게 죽고 다시 태어난다.
3. **Service**: 쉽게 죽는 Pod들에게 불멸의 주소를 부여한다.
