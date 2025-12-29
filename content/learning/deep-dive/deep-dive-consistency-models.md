---
title: "데이터 정합성 모델: Strong부터 Eventual까지"
date: 2025-12-28
draft: false
topic: "Distributed Systems"
tags: ["Consistency", "Distributed Systems", "Linearizability", "CAP"]
categories: ["Backend Deep Dive"]
description: "분산 시스템에서 '최신 데이터'를 본다는 것의 의미와 비용. Linearizability, Sequential, Eventual Consistency의 차이를 명확히 구분합니다."
module: "distributed-system"
study_order: 404
quizzes:
  - question: "Linearizability(강한 정합성)와 Eventual Consistency(결과적 정합성)의 핵심 차이는?"
    options:
      - "둘은 동일하다."
      - "Linearizability는 '쓴 즉시 모든 클라이언트가 같은 값을 읽음', Eventual은 '언젠가는 같아짐(지연 허용)'"
      - "Eventual이 더 강하다."
      - "Linearizability는 비용이 낮다."
    answer: 1
    explanation: "Strong Consistency는 모든 노드가 합의할 때까지 기다려 느리지만 정확합니다. Eventual은 복제 지연을 허용해 빠르지만 일시적 불일치가 발생할 수 있습니다."

  - question: "SNS 피드나 유튜브 조회수에 Eventual Consistency를 사용하는 이유는?"
    options:
      - "정확성이 가장 중요해서"
      - "빠른 응답이 더 중요하고, 일시적으로 조회수가 다르게 보여도 치명적이지 않기 때문"
      - "구현이 어려워서"
      - "보안 때문"
    answer: 1
    explanation: "SNS에서 '좋아요'가 1초 늦게 반영되는 건 괜찮지만, 응답이 5초 걸리면 사용자가 떠납니다. 비즈니스 특성에 맞게 정합성 수준을 선택해야 합니다."

  - question: "PACELC 이론에서 'E'(Else)가 의미하는 것은?"
    options:
      - "Error 처리"
      - "네트워크 분단이 없는 평소 상황에서는 Latency와 Consistency 사이에서 선택해야 함"
      - "암호화 여부"
      - "확장성"
    answer: 1
    explanation: "CAP은 장애 시 선택만 다루지만, PACELC는 평소(Else)에도 '빠른 응답(Latency) vs 강한 정합성(Consistency)' 트레이드오프가 있음을 설명합니다."

  - question: "은행 계좌 잔고 조회에 Eventual Consistency를 사용하면 안 되는 이유는?"
    options:
      - "속도가 느려서"
      - "계좌에서 출금 후 아직 복제되지 않은 노드에서 읽으면 잔고가 있는 것처럼 보여 이중 출금이 가능해지기 때문"
      - "구현이 어려워서"
      - "비용 문제"
    answer: 1
    explanation: "금융 시스템처럼 돈이 오가는 곳에서는 '방금 쓴 값이 즉시 보여야' 합니다. 이중 결제나 Over-selling을 방지하려면 Strong Consistency가 필요합니다."

  - question: "Stale Read(오래된 데이터 읽기)가 발생하는 상황은?"
    options:
      - "Strong Consistency 환경"
      - "Leader에 쓰기 후 Replica 복제가 완료되기 전에 Replica에서 읽을 때"
      - "캐시를 사용하지 않을 때"
      - "네트워크가 빠를 때"
    answer: 1
    explanation: "비동기 복제 시 Leader에 쓴 데이터가 Follower에 도착하기 전에 Follower에서 읽으면 이전 값이 반환됩니다. 이것이 Eventual Consistency의 트레이드오프입니다."
---

## 이 글에서 얻는 것

- **Linearizability**(강한 정합성)와 **Eventual Consistency**(결과적 정합성)의 차이를 이해합니다.
- 분산 시스템에서 정합성 모델을 선택하는 기준(**PACELC**)을 배웁니다.

---

## 🧐 1. Consistency Model이란?

개발자는 본능적으로 **"방금 쓴(Write) 건 당연히 바로 읽혀야지(Read)"**라고 생각합니다.
하지만 데이터베이스가 여러 대로 쪼개지는 순간(Replication), 이 "당연한 상식"은 유지하기 매우 비싼 비용이 됩니다.

Consistency Model은 **"데이터가 복제되는 동안, 클라이언트에게 어떤 값을 보여줄 것인가?"**에 대한 계약입니다.

---

## 💎 2. Linearizability (Strong Consistency)

가장 강력한 모델입니다. 시스템이 마치 **"단 하나의 데이터 복사본"**만 있는 것처럼 동작합니다.

### 타임라인 시각화

```mermaid
sequenceDiagram
    autonumber
    participant Client A
    participant Leader as DB Leader
    participant Follower as DB Follower
    participant Client B
    
    Note over Client A, Client B: Global Order (순차적 실행 보장)
    
    Client A->>Leader: Write(x=1)
    activate Leader
    Leader->>Follower: Replicate(x=1) (Sync)
    Follower-->>Leader: Ack
    Leader-->>Client A: OK
    deactivate Leader
    
    Note over Client B: 이 시점부터 누가 읽든 x=1 (보장)
    Client B->>Follower: Read(x)
    Follower-->>Client B: 1
```

- **특징**: 언제나 최신 데이터를 보장합니다.
- **비용**: 모든 노드가 합의할 때까지 기다려야 하므로 **매우 느립니다 (Latency High)**.
- **사례**: 은행 계좌 잔고, 재고 시스템(Over-selling 방지).

---

## ⏳ 3. Eventual Consistency (결과적 정합성)

가장 현실적인 모델입니다. **"지금은 다를 수 있지만, 언젠가는(Eventually) 같아진다"**는 약속입니다.

### Stale Read (철 지난 데이터 읽기)

```mermaid
sequenceDiagram
    autonumber
    participant Client A
    participant Leader as DB Leader
    participant Follower as DB Follower
    participant Client B
    
    Client A->>Leader: Write(x=1)
    Leader-->>Client A: OK (Async Ack)
    
    Note over Leader, Follower: 🚧 Replication Lag (지연 발생) 🚧
    
    Client B->>Follower: Read(x)
    Follower-->>Client B: 0 (Stale Data! 😱)
    
    par Async Replication
        Leader->>Follower: Replicate(x=1)
    and Eventual Consistency
        Note right of Follower: 이제 x=1 됨
    end
```

- **특징**: 쓰기 응답이 매우 빠릅니다. (복제를 기다리지 않음)
- **비용**: 사용자가 "방금 쓴 글이 안 보이는" 현상을 겪을 수 있습니다.
- **사례**: SNS 피드, 유튜브 조회수 ("조회수 0인데 좋아요 10개").

---

## ⚖️ 4. PACELC 이론: 선택의 문제

CAP 이론("3개 중 2개")은 너무 단순합니다. **PACELC**가 더 정확합니다.

```mermaid
graph TD
    Start{"Network Partition?"}
    
    Start -->|"Yes (P)"| Partition[Partitioned]
    Partition -->|Availability| PA["PA: DynamoDB, Cassandra"]
    Partition -->|Consistency| PC["PC: HBase, BigTable"]
    
    Start -->|"No (E)"| Normal["Else (Normal State)"]
    Normal -->|Latency| EL["EL: DynamoDB Default"]
    Normal -->|Consistency| EC["EC: MongoDB, BigTable"]
    
    style Start fill:#fff9c4,stroke:#fbc02d
    style PA fill:#c8e6c9,stroke:#388e3c
    style PC fill:#ffccbc,stroke:#d84315
    style EL fill:#c8e6c9,stroke:#388e3c
    style EC fill:#ffccbc,stroke:#d84315
```

> **P**artition(네트워크 단절) 상황이면 **A**와 **C** 중 선택하고,
> **E**lse(평소)에는 **L**atency(지연)와 **C**onsistency(정합성) 중 선택한다.

| 상황 | 선택 | 설명 |
| :--- | :--- | :--- |
| **장애 (P)** | **PA (Availability)** | 데이터가 틀리더라도 서비스가 죽는 것보다 낫다. (쇼핑몰 장바구니) |
| **장애 (P)** | **PC (Consistency)** | 데이터가 틀리느니 차라리 에러를 뱉겠다. (은행 이체) | 
| **평소 (E)** | **EL (Latency)** | 빠른 응답을 위해 복제 완료를 기다리지 않는다. (Eventual) |
| **평소 (E)** | **EC (Consistency)** | 느리더라도 정확성을 위해 모든 노드 응답을 기다린다. (Strong) |

## 📊 5. Consistency Hierarchy

강한 정합성일수록 느리고, 약한 정합성일수록 빠릅니다.

1.  **Linearizability** (Strongest): 실시간, 전역 순서 보장. (비용: 💰💰💰💰💰)
2.  **Sequential Consistency**: 모든 프로세스가 "동일한 순서"로 보지만, 실시간성은 보장 X.
3.  **Causal Consistency**: "인과 관계"가 있는 이벤트만 순서 보장. (댓글 -> 대댓글)
4.  **Eventual Consistency** (Weakest): 언젠간 같아짐. (비용: 💰)

## 요약

1. **Linearizability**: "지금 쓴 거 지금 보임". 느림. (은행)
2. **Eventual Consistency**: "언젠간 보임". 빠름. (SNS)
3. 무조건 Strong을 고집하면 시스템 성능이 바닥을 칩니다. 비즈니스 요건에 맞춰 타협하세요.
