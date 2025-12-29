---
title: "Kafka 기본: 토픽, 파티션, Consumer Group"
date: 2025-12-16
draft: false
topic: "Kafka"
tags: ["Kafka", "Partition", "Consumer Group", "Offset"]
categories: ["Backend Deep Dive"]
description: "Kafka 핵심 개념과 메시지 흐름, Ordering/스루풋 설계를 위한 기초"
module: "distributed-system"
quizzes:
  - question: "Kafka가 RabbitMQ 같은 전통적인 메시지 큐와 구별되는 가장 핵심적인 특징은?"
    options:
      - "메시지가 소비되면 즉시 삭제된다."
      - "메시지가 파일에 로그처럼 저장되어 설정된 기간 동안 보존되며, 재처리(Replay)가 가능하다."
      - "반드시 FIFO(선입선출) 순서로 처리된다."
      - "단일 구독자만 지원한다."
    answer: 1
    explanation: "Kafka는 'Distributed Log'로서, 메시지를 소비해도 삭제되지 않고 보존됩니다. 이 덕분에 장애 시 재처리가 가능하고, 여러 시스템이 각자의 속도로 읽을 수 있습니다."

  - question: "Kafka에서 메시지의 순서가 보장되는 범위는?"
    options:
      - "토픽(Topic) 전체에서 순서가 보장된다."
      - "동일한 Consumer Group 내에서 순서가 보장된다."
      - "동일한 파티션(Partition) 내에서만 순서가 보장된다."
      - "Consumer에서 명시적으로 정렬해야만 순서가 보장된다."
    answer: 2
    explanation: "Kafka의 순서 보장은 파티션 단위입니다. 같은 Key를 가진 메시지는 같은 파티션으로 보내져 순서가 보장되지만, 다른 파티션 간에는 순서가 보장되지 않습니다."

  - question: "Consumer Group 내에서 파티션과 Consumer의 매핑 규칙이 아닌 것은?"
    options:
      - "하나의 파티션은 그룹 내 하나의 Consumer에게만 할당된다."
      - "Consumer 수가 파티션 수보다 많으면, 일부 Consumer는 유휴(Idle) 상태가 된다."
      - "파티션보다 Consumer가 적으면, 일부 Consumer가 여러 파티션을 처리한다."
      - "하나의 파티션을 그룹 내 여러 Consumer가 동시에 처리할 수 있다."
    answer: 3
    explanation: "Consumer Group 내에서 하나의 파티션은 반드시 하나의 Consumer에게만 할당됩니다. Consumer를 파티션 수 이상으로 늘려도 성능이 향상되지 않습니다."

  - question: "Kafka Consumer 운영 시 '리밸런싱(Rebalancing)'이 발생하면 어떤 문제가 생기는가?"
    options:
      - "메시지 처리 성능이 일시적으로 크게 향상된다."
      - "리밸런싱 중에는 Consumer들이 메시지 처리를 중단(Stop-the-World)하여 지연이 발생한다."
      - "새로운 파티션이 자동으로 생성된다."
      - "Producer가 메시지를 보낼 수 없게 된다."
    answer: 1
    explanation: "리밸런싱은 Consumer가 추가/제거되거나 장애 시 파티션을 재분배하는 과정인데, 이 동안 모든 Consumer가 일시적으로 처리를 멈춥니다. 이를 최소화하는 것이 Kafka 운영의 핵심입니다."

  - question: "Kafka Producer에서 Key를 지정하여 메시지를 보내는 목적으로 가장 적절한 것은?"
    options:
      - "메시지 압축률을 높이기 위해"
      - "특정 사용자(또는 주문)의 메시지가 항상 같은 파티션으로 전달되어 순서를 보장받기 위해"
      - "Consumer가 메시지를 필터링하기 쉽게 하기 위해"
      - "메시지를 자동으로 암호화하기 위해"
    answer: 1
    explanation: "Key를 지정하면 해시 함수에 의해 항상 같은 파티션에 메시지가 전달됩니다. 예를 들어, `userId`를 Key로 사용하면 특정 사용자의 이벤트 순서가 보장됩니다."
study_order: 401
---

## 🪵 1. Kafka는 '큐(Queue)'가 아니라 '로그(Log)'다

RabbitMQ 같은 메시지 큐는 "소비하면 사라집니다(pop)".
하지만 Kafka는 **"파일에 기록(Log)하고, 소비자가 읽을 위치(Offset)를 관리"**합니다. 소비해도 데이터는 사라지지 않습니다.

이 차이 때문에 Kafka는 **재생(Replay)** 이 가능하고, **다수의 구독자**가 각자의 속도로 읽을 수 있습니다.

### Kafka vs RabbitMQ Comparison

| 특징 | Kafka | RabbitMQ |
| :--- | :--- | :--- |
| **철학** | **Distributed Log** (이벤트 저장소) | **Smart Broker, Dumb Consumer** (메시지 큐) |
| **메시지 수명** | 설정한 기간 동안 **보존** (Persistence) | 소비되면 **삭제** (Volatile) |
| **처리량** | 수십~수백만 TPS (Batch 처리) | 수만 TPS (개별 메시지 ACK) |
| **용도** | 대용량 이벤트 스트리밍, 로그 수집 | 복잡한 라우팅, 즉시 작업 처리 |

---

## 🧩 2. 토픽, 파티션, 그리고 병렬 처리

Kafka 성능의 핵심은 **파티셔닝(Partitioning)** 입니다.

```mermaid
graph TD
    subgraph Topic_Orders ["Topic: Orders (Log)"]
        P0[("Partition 0")]
        P1[("Partition 1")]
        P2[("Partition 2")]
    end
    
    Producer["Producer (App)"] -->|Key: User A| P0
    Producer -->|Key: User B| P1
    Producer -->|Key: User C| P2
    
    style Topic_Orders fill:#fff3e0,stroke:#ff9800
    style P0 fill:#ffe0b2,stroke:#ef6c00
    style P1 fill:#ffe0b2,stroke:#ef6c00
    style P2 fill:#ffe0b2,stroke:#ef6c00
```

- **Topic**: 폴더 이름 (예: `orders`)
- **Partition**: 그 안의 실제 파일들 (`orders-0`, `orders-1`...)

**중요한 규칙**:
1. **순서 보장**: *파티션 내부*에서는 순서가 보장됩니다. 토픽 전체에서는 보장 안 됩니다.
2. **병렬 처리**: 파티션 수가 3개면, 최대 3명의 소비자가 동시에 일할 수 있습니다.

---

## 👥 3. Consumer Group (컨슈머 그룹)

"우리 조(Group)는 이 일을 나눠서 처리한다."

```mermaid
graph LR
    subgraph Kafka_Cluster ["Kafka Cluster"]
        P0[("P0")]
        P1[("P1")]
        P2[("P2")]
    end
    
    subgraph Consumer_Group ["Consumer Group A (Service)"]
        C1["Consumer 1"]
        C2["Consumer 2"]
    end
    
    P0 ==> C1
    P2 ==> C1
    P1 ==> C2
    
    style Consumer_Group fill:#e1f5fe,stroke:#039be5
    style C1 fill:#b3e5fc,stroke:#0277bd
    style C2 fill:#b3e5fc,stroke:#0277bd
```

- **1:1 매핑**: 하나의 파티션은 그룹 내 **단 하나의 컨슈머**만 연결됩니다.
- **스케일 아웃**: 컨슈머가 느리면? 컨슈머를 늘립니다. **단, 파티션 수만큼까지만!** (파티션 3개인데 컨슈머 4명이면 1명은 놉니다.)

---

## ⚖️ 4. 리밸런싱 (Rebalancing) - 헬게이트

컨슈머가 죽거나 새로 들어오면, "자, 다시 나누자!" 하고 파티션을 재분배합니다. 이 과정을 **리밸런싱**이라 합니다.

- **문제**: 리밸런싱 중에는 **Stop-The-World**. 아무도 일을 못 합니다.
- **원인**: 배포(Restart), 네트워크 불안정, GC로 인한 타임아웃 등.
- **운영 팁**: 리밸런싱을 최소화하는 것이 Kafka 운영의 핵심입니다. (heartbeat 설정 등)

---

## 🔑 5. 키(Key) 설계 전략

메시지를 보낼 때 Key를 줄지 말지 결정해야 합니다.

| 전략 | 설명 | 장점 | 단점 |
|---|---|---|---|
| **Key 없음 (Round Robin)** | 그냥 돌아가면서 뿌림 | 부하 분산 최고 | 순서 보장 안 됨 |
| **Key 있음 (Hash)** | `User:123`은 항상 `P0`로 | 특정 사용자의 순서 보장 | 핫 키(Hot Key) 문제 가능성 |

주문 시스템이라면 `OrderId`를 키로 써서, "주문 생성 -> 결제 -> 배송" 순서를 보장해야겠죠?

## 요약

> [!TIP]
> **Kafka Configuration Checklist**:
> - [ ] **Durability**: `acks=all`, `min.insync.replicas=2` (데이터 유실 방지).
> - [ ] **Retention**: `log.retention.hours` 확인 (디스크 Full 방지).
> - [ ] **Consumer**: `enable.auto.commit=false` 권장 (명시적 커밋으로 중복/누락 제어).
> - [ ] **Monitoring**: **Consumer Lag** 모니터링 필수.

1. **Log**: Kafka는 지워지지 않는 로그 파일이다.
2. **Partition**: 병렬 처리의 단위다.
3. **Consumer Group**: 파티션을 나눠 먹는 작업자 팀이다.
4. **Offset**: "나 여기까지 읽었어"라는 책갈피다.
