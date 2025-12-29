---
title: "분산 트랜잭션: 2PC에서 SAGA까지"
date: 2025-12-28
draft: false
topic: "Distributed Systems"
tags: ["Distributed Transaction", "SAGA", "2PC", "Microservices"]
categories: ["Backend Deep Dive"]
description: "마이크로서비스 환경에서 데이터 정합성을 어떻게 보장할까요? 강한 일관성(2PC)의 한계와 결과적 일관성(SAGA) 패턴의 구현 방법을 다룹니다."
module: "distributed-system"
quizzes:
  - question: "마이크로서비스 환경에서 @Transactional이 여러 서비스에 걸쳐 동작하지 않는 이유는?"
    options:
      - "Spring이 지원하지 않아서"
      - "각 서비스가 독립된 DB를 사용하므로, 단일 DB 연결 내에서만 동작하는 로컬 트랜잭션으로는 여러 DB를 묶을 수 없기 때문"
      - "네트워크가 느려서"
      - "트랜잭션 어노테이션 문법이 다르기 때문"
    answer: 1
    explanation: "모놀리스에서는 하나의 DB 연결로 모든 작업을 원자적으로 커밋합니다. MSA에서는 각 서비스가 다른 DB를 사용하므로 분산 트랜잭션 패턴(2PC, Saga)이 필요합니다."

  - question: "2PC(Two-Phase Commit)의 가장 큰 단점은?"
    options:
      - "구현이 너무 쉽다."
      - "모든 참가자가 응답할 때까지 Global Lock이 걸려 성능이 저하되고, Coordinator가 죽으면 락이 영원히 안 풀릴 수 있다."
      - "NoSQL에서만 사용 가능하다."
      - "데이터 일관성을 보장하지 못한다."
    answer: 1
    explanation: "2PC는 Prepare 단계에서 모든 DB가 락을 잡고 대기합니다. 한 노드라도 느리면 전체가 블로킹되고, Coordinator 장애 시 복구가 어려워 SPOF(Single Point of Failure)가 됩니다."

  - question: "Saga 패턴에서 '보상 트랜잭션(Compensating Transaction)'의 역할은?"
    options:
      - "성능을 향상시킨다."
      - "중간 단계에서 실패했을 때, 이전에 성공한 단계들을 되돌리는(Undo) 작업을 수행한다."
      - "로그를 기록한다."
      - "재시도를 방지한다."
    answer: 1
    explanation: "Saga는 여러 로컬 트랜잭션의 시퀀스입니다. 중간에 실패하면 이미 커밋된 단계들을 보상 트랜잭션으로 되돌립니다. 예: 결제 실패 시 → 주문 취소."

  - question: "Saga의 Choreography와 Orchestration 방식의 주요 차이점은?"
    options:
      - "성능 차이"
      - "Choreography는 각 서비스가 이벤트를 주고받으며 자율적으로 진행하고, Orchestration은 중앙 조정자가 명령을 내려 흐름을 관리한다."
      - "사용하는 언어가 다르다."
      - "데이터베이스 종류가 다르다."
    answer: 1
    explanation: "Choreography는 분산적이지만 흐름 파악이 어렵고, Orchestration은 중앙 집중적이라 가시성이 좋지만 복잡해질 수 있습니다. 상황에 맞게 선택합니다."

  - question: "MSA에서 ACID 대신 BASE(Basically Available, Soft state, Eventual consistency)를 따르는 이유는?"
    options:
      - "ACID가 더 느려서"
      - "분산 환경에서 강한 일관성(ACID)을 유지하려면 성능과 가용성을 크게 희생해야 하므로, 결과적 일관성(Eventual Consistency)으로 타협하는 것이 현실적이기 때문"
      - "BASE가 더 안전해서"
      - "데이터베이스가 지원하지 않아서"
    answer: 1
    explanation: "CAP 이론에 따르면 분산 시스템에서 일관성, 가용성, 분할 내성을 모두 만족할 수 없습니다. MSA는 가용성을 우선시하며, 데이터는 짧은 시간 후 일관된 상태가 됩니다."
study_order: 403
---

## 🤯 1. 문제: 서비스가 쪼개지면 트랜잭션도 깨진다

모놀리스(Monolith) 시절에는 `@Transactional` 애노테이션 하나면 세상이 평화로웠습니다.
주문 생성과 재고 차감이 하나의 DB 연결에서 일어나기 때문입니다.

하지만 **마이크로서비스(MSA)** 환경에서는 각자 다른 DB를 씁니다.

```mermaid
graph LR
    User --> OrderService
    OrderService --> OrderDB[(Order DB)]
    OrderService -.->|API Call| InventoryService
    InventoryService --> InventoryDB[(Stock DB)]
    
    style OrderDB fill:#f96
    style InventoryDB fill:#69f
```

**시나리오**:
1. 주문 서비스: 주문 생성 (커밋 완료)
2. 재고 서비스: 재고 차감 시도 -> **에러 발생! (Rollback)**
3. **결과**: 주문은 됐는데 재고는 그대로인 대참사 발생.

---

## 🔒 2. 전통적 해결책: 2PC (Two-Phase Commit)

"다 같이 커밋하거나, 다 같이 죽자"는 방식입니다. 이를 **XA 트랜잭션**이라고도 합니다.

```mermaid
sequenceDiagram
    autonumber
    participant Coord as Coordinator
    participant DB1 as OrderDB
    participant DB2 as StockDB
    
    Note over Coord, DB2: Phase 1: Prepare (Locking)
    Coord->>DB1: Prepare (Lock Row)
    Coord->>DB2: Prepare (Lock Row)
    DB1-->>Coord: OK
    DB2-->>Coord: OK
    
    Note over Coord, DB2: Phase 2: Commit (Finalize)
    Coord->>DB1: Commit (Release Lock)
    Coord->>DB2: Commit (Release Lock)
    DB1-->>Coord: Done
    DB2-->>Coord: Done
```

### 왜 안 쓸까? (2PC vs Saga)

| 특징 | 2PC (XA) | Saga Pattern |
| :--- | :--- | :--- |
| **일관성** | **Strong Consistency** (즉시 일치) | **Eventual Consistency** (결과적 일치) |
| **성능** | 낮음 (Global Locking, Blocking) | 높음 (Local Tx, Non-blocking) |
| **구현 난이도** | 낮음 (DB가 알아서 해줌) | 높음 (보상 트랜잭션 직접 구현) |
| **사용처** | 금융 코어, 강한 정합성 필요 시 | 대부분의 MSA 비즈니스 로직 |

1.  **Blocking**: 한 놈이라도 대답이 늦으면 전체가 멈춥니다. (Deadlock 위험)
2.  **SPOF**: 코디네이터가 죽으면 DB 락이 영원히 안 풀릴 수 있습니다.
3.  **NoSQL 불가**: MongoDB, DynamoDB 등은 XA를 지원하지 않습니다.

---

## 🔄 3. 현대적 해결책: SAGA 패턴

긴 트랜잭션을 잘게 쪼개서 순서대로 실행합니다.
중간에 실패하면? **"되감기(Undo)"**를 실행합니다. 이를 **보상 트랜잭션(Compensating Transaction)**이라 합니다.

### 3.1 Choreography (안무가 없는 댄스)

각 서비스가 이벤트를 주고받으며 다음 행동을 결정합니다.

```mermaid
sequenceDiagram
    participant Order
    participant Stock
    participant Payment
    
    Order->>Stock: Event: OrderCreated
    Stock->>Payment: Event: StockReserved
    Payment--XStock: Error: PaymentFailed
    
    Note over Stock: 보상 트랜잭션 실행
    Stock->>Order: Event: StockRelease
    Note over Order: 주문 취소(Undo)
```

- **장점**: 구축이 쉽고 서비스 간 결합도가 낮습니다.
- **단점**: 프로세스가 복잡해지면 "누가 누구를 호출하는지" 파악하기 힘들어집니다. (순환 참조 지옥)

### 3.2 Orchestration (지휘자)

**Saga Orchestrator**라는 중앙 지휘자가 명령을 내립니다.

```mermaid
flowchart TD
    Orchestrator[Saga Orchestrator]
    
    subgraph Services
    Order[Order Service]
    Stock[Stock Service]
    Pay[Payment Service]
    end
    
    %% Forward Flow
    Orchestrator -->|1. Create Order| Order
    Orchestrator -->|2. Decrease Stock| Stock
    Orchestrator -->|3. Process Payment| Pay
    
    %% Failure Flow
    Pay -.->|Fail!| Orchestrator
    
    %% Compensation Flow
    Orchestrator -.->|Undo: Rollback Stock| Stock
    Orchestrator -.->|Undo: Cancel Order| Order
    
    style Pay fill:#ffcdd2,stroke:#d32f2f,stroke-dasharray: 5 5
    style Orchestrator fill:#e3f2fd,stroke:#2196f3
```

- **장점**: 비즈니스 로직이 한눈에 보입니다. 관리가 쉽습니다.
- **단점**: 오케스트레이터가 너무 비대해질 수 있습니다.

## 요약

> [!TIP]
> **Saga Pattern Checklist**:
> - [ ] **Idempotency (멱등성)**: 보상 트랜잭션이 중복 실행되어도 결과는 같아야 함. (네트워크 타임아웃 대비)
> - [ ] **Compensation (보상)**: `do()`에 대한 `undo()` 로직이 반드시 존재해야 함.
> - [ ] **Monitoring**: 트랜잭션 상태(Started, Pending, Aborted)를 추적할 수 있어야 함. (Saga ID 필수)

1. **ACID는 포기해라**: MSA에서는 **BASE** (Basically Available, Soft state, Eventual consistency)를 따릅니다.
2. **2PC는 성능의 적**: 강한 정합성이 필수(은행 등)가 아니면 피하세요.
3. **SAGA가 표준**: "실패하면 되돌린다(보상 트랜잭션)"는 개념만 기억하면 됩니다.
