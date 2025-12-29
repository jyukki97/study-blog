---
title: "로드밸런서/헬스체크: 고가용성의 심장"
date: 2025-12-16
draft: false
topic: "Networking"
tags: ["Load Balancer", "Health Check", "ALB", "NLB"]
categories: ["DevOps"]
description: "ALB/NLB 선택 기준, 헬스체크 실패 시 트래픽 흐름, 타임아웃/리트라이로 인한 장애 전파 차단"
module: "resilience"
study_order: 503
quizzes:
  - question: "헬스체크의 진정한 목적은?"
    options:
      - "서버가 켜져있는지 확인"
      - "'지금 이 서버가 트래픽을 받아도 되는가?'를 판단하여 문제 있는 서버를 제외(Draining)하는 것"
      - "CPU 사용량 측정"
      - "로그 수집"
    answer: 1
    explanation: "헬스체크는 단순 생존 확인이 아니라 '트래픽 스위치'입니다. 실패하면 해당 서버로 요청을 보내지 않습니다."

  - question: "NLB(L4)와 ALB(L7) 중 고정 IP가 필요한 경우 선택해야 하는 것은?"
    options:
      - "ALB"
      - "NLB - 고정 IP 할당 가능, TCP/UDP 성능 우수"
      - "둘 다 동일"
      - "로드밸런서 없이 직접 연결"
    answer: 1
    explanation: "ALB는 IP가 변동되어 DNS로만 접근합니다. 방화벽에 IP를 등록해야 하거나 고정 IP가 필요하면 NLB를 사용합니다."

  - question: "Kubernetes에서 Liveness Probe에 DB 체크를 넣으면 안 되는 이유는?"
    options:
      - "속도가 느려서"
      - "DB가 잠깐 느려지면 멀쩡한 웹 서버를 재시작시켜 Cascading Failure를 유발할 수 있기 때문"
      - "비용 문제"
      - "필수 사항이다"
    answer: 1
    explanation: "Liveness 실패 = 컨테이너 재시작입니다. 외부 의존성 장애를 Liveness로 체크하면 재시작 폭풍이 납니다. 외부 의존성은 Readiness로 체크하세요."

  - question: "Liveness Probe와 Readiness Probe의 실패 시 동작 차이는?"
    options:
      - "둘 다 동일하게 컨테이너를 재시작한다."
      - "Liveness 실패 = 컨테이너 재시작, Readiness 실패 = 로드밸런서에서 제외(트래픽 차단)"
      - "둘 다 트래픽만 차단한다."
      - "차이가 없다."
    answer: 1
    explanation: "Liveness는 프로세스가 죽었는지(데드락 등), Readiness는 트래픽 받을 준비가 됐는지를 체크합니다. 용도에 맞게 분리해야 합니다."

  - question: "헬스체크 Flapping(깜빡임) 현상을 방지하는 방법은?"
    options:
      - "체크를 더 자주 한다."
      - "실패를 3회 연속 감지해야 제외(Threshold)하고, 복귀도 여러 번 성공 후에 하는 보수적 설정"
      - "체크를 하지 않는다."
      - "서버를 늘린다."
    answer: 1
    explanation: "GC로 잠깐 느려졌다고 서버를 뺐다 꼈다 하면 불안정합니다. '제외는 빠르게, 복귀는 보수적으로'가 원칙입니다."
---

## 💓 1. 헬스체크는 '생존 확인'이 아니라 '신호등'이다

헬스체크를 단순히 "서버 켜졌나?" 확인하는 용도로만 쓰면 장애를 키웁니다.
헬스체크는 **"지금 트래픽을 받아도 되는가?"**를 묻는 것입니다.

```mermaid
stateDiagram-v2
    direction LR
    
    state "Healthy (In Service)" as Healthy
    state "Unhealthy (Out of Service)" as Unhealthy
    
    [*] --> Healthy : Initial Check Pass
    
    Healthy --> Healthy : Check OK (200)
    Healthy --> Unhealthy : Check Fail x Threshold
    
    Unhealthy --> Unhealthy : Check Fail
    Unhealthy --> Healthy : Check OK x Threshold
    
    note right of Unhealthy
        Traffic blocked
        Draining active
    end note
```

이 "제외(Draining)" 과정이 얼마나 빠르고 정확하냐가 고가용성을 결정합니다.

---

## ⚖️ 2. L4 (NLB) vs L7 (ALB) 선택 가이드

"그냥 ALB 쓰면 되는 거 아냐?" -> **TCP/UDP 성능**이 중요하다면 NLB입니다.

| 특징 | NLB (Network Load Balancer) | ALB (Application Load Balancer) |
|---|---|---|
| **계층** | L4 (전송 계층) | L7 (응용 계층) |
| **속도** | 초고속 (패킷만 보고 토스) | 보통 (HTTP 헤더 파싱) |
| **IP 주소** | **고정 IP 할당 가능** | IP 변동됨 (DNS로만 접근) |
| **기능** | 단순 포트 포워딩, 소스 IP 보존 | 경로 라우팅(`/api`), 인증(OIDC), WAF |
| **용도** | 게임 서버, 실시간 스트리밍, Private Link | 웹 서비스, 마이크로서비스 API |

---

## 🩺 3. Liveness vs Readiness (이중 헬스체크)

Kubernetes나 최신 프레임워크는 헬스체크를 두 단계로 나눕니다.

### 3-1. Liveness Probe (생존 확인)
- **목적**: "프로세스가 살아있는가?"
- **실패 시**: **컨테이너 재시작 (Restart)**
- **체크 로직**: 데드락 걸렸는지, 메인 스레드 죽었는지 확인.

### 3-2. Readiness Probe (준비 확인)
- **목적**: "트래픽 받을 준비 됐어?"
- **실패 시**: **로드밸런서에서 제외 (Traffic Cut)**
- **체크 로직**: DB 연결 됐는지, 초기 데이터 로딩 끝났는지 확인.

```mermaid
graph TD
    subgraph "Liveness Check (Kubelet)"
    L[Liveness Probe] -->|Fail| R[Restart Container]
    R -->|New Process| P[Pod Running]
    end
    
    subgraph "Readiness Check (Service)"
    Req[Readiness Probe] -->|Fail| NB[Remove Endpoint]
    NB -->|Block Traffic| EP[Service LoadBalancer]
    end
    
    style R fill:#ffcdd2,stroke:#c62828
    style NB fill:#fff9c4,stroke:#fbc02d
```

> ⚠️ **주의**: Liveness에 DB 체크를 넣지 마세요!
> DB가 잠깐 느려졌다고 멀쩡한 웹 서버를 **재시작**시켜버리는 대참사가 일어납니다. (Cascading Failure)

---

## ⏱️ 4. Flapping (깜빡임) 현상 막기

헬스체크가 너무 민감하면, 잠깐의 GC 멈춤에도 서버가 뺐다 꼈다를 반복합니다.

- **Threshold**: 실패를 **3회 연속** 감지해야 제외한다. (Unhealthy Threshold)
- **Interval**: 10초마다 체크한다.
- **Timeout**: 5초 안에 응답 없으면 실패.

**Golden Rule**:
"제외는 빠를수록 좋고(사용자 에러 방지), 복귀는 보수적일수록 좋다(확실히 나았을 때 투입)."

## 요약

1. **의미**: 헬스체크는 트래픽 스위치다.
2. **L4 vs L7**: 성능/고정IP는 NLB, 기능/웹은 ALB.
3. **Probe 분리**: 재시작용(Liveness)과 제외용(Readiness)을 구분해라.
4. **설정**: 너무 예민하게 설정하면 멀쩡한 서버가 널뛰기(Flapping)한다.
