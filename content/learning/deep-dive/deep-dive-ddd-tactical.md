---
title: "DDD 전술적 설계: Entity, VO, 그리고 Aggregate"
date: 2025-12-28
draft: false
topic: "Architecture"
tags: ["DDD", "Architecture", "Entity", "Value Object", "Aggregate"]
categories: ["Backend Deep Dive"]
description: "도메인 주도 설계의 핵심 빌딩 블록을 이해하고, 왜 불변 객체(VO)가 중요한지 파헤칩니다."
module: "architecture-mastery"
quizzes:
  - question: "DDD에서 Entity와 Value Object(VO)를 구분하는 핵심 기준은?"
    options:
      - "크기가 큰 것이 Entity, 작은 것이 VO"
      - "Entity는 고유한 식별자(ID)를 가지고, VO는 식별자 없이 값 자체로 동일성을 비교한다."
      - "Entity는 읽기 전용, VO는 수정 가능"
      - "둘은 동일한 개념이다."
    answer: 1
    explanation: "Entity는 ID로 식별됩니다(같은 ID면 같은 객체). VO는 모든 필드 값이 같으면 같은 객체입니다. 예: User(Entity)는 ID로, Money(VO)는 금액과 통화로 동일성을 판단합니다."

  - question: "Value Object(VO)를 불변(Immutable)으로 만드는 이유는?"
    options:
      - "성능이 저하되기 때문"
      - "불변 객체는 공유해도 안전(Thread-safe)하며, 예상치 못한 사이드 이펙트를 방지한다."
      - "데이터베이스에 저장하기 어렵기 때문"
      - "JPA에서 지원하지 않기 때문"
    answer: 1
    explanation: "불변 VO는 값이 바뀌지 않으므로 여러 곳에서 참조해도 안전합니다. 값을 변경하려면 새 객체를 생성(`money.plus(...)`)하므로 원본이 변경되는 버그를 방지합니다."

  - question: "Aggregate Root의 역할로 올바른 것은?"
    options:
      - "모든 데이터를 캐싱한다."
      - "Aggregate 내부 객체의 일관성(Invariant)을 보장하고, 외부에서 Aggregate 내부로 접근하는 유일한 진입점 역할을 한다."
      - "다른 Aggregate를 직접 수정할 수 있다."
      - "데이터베이스 연결을 관리한다."
    answer: 1
    explanation: "Aggregate Root는 트랜잭션의 경계이자 일관성을 지키는 수문장입니다. 외부에서는 Root를 통해서만 내부 객체에 접근해야 비즈니스 규칙을 보장할 수 있습니다."

  - question: "DDD에서 Repository가 Aggregate Root 단위로만 존재해야 하는 이유는?"
    options:
      - "코드를 줄이기 위해"
      - "Aggregate는 트랜잭션의 일관성 단위이므로, 내부 Entity를 개별적으로 저장하면 일관성이 깨질 수 있기 때문"
      - "성능이 향상되기 때문"
      - "JPA에서 강제하기 때문"
    answer: 1
    explanation: "OrderItemRepository가 따로 있으면 Order 없이 OrderItem만 변경할 수 있어 비즈니스 규칙이 깨질 수 있습니다. OrderRepository를 통해 Order(Root)와 함께 저장해야 일관성을 유지합니다."

  - question: "'빈약한 도메인 모델(Anemic Domain Model)'의 문제점은?"
    options:
      - "객체에 비즈니스 로직이 많아 복잡하다."
      - "Entity가 getter/setter만 가지고 비즈니스 로직이 Service에 흩어져 있어, 응집도가 낮고 중복 로직이 발생하기 쉽다."
      - "테스트하기 쉽다."
      - "성능이 좋다."
    answer: 1
    explanation: "Entity가 단순한 데이터 구조체이고 로직이 Service에 있으면, 같은 로직이 여러 Service에 중복됩니다. Rich Domain Model은 Entity 안에 관련 로직을 두어 응집도를 높입니다."
study_order: 1101
---

## 이 글에서 얻는 것

- **Entity**와 **Value Object(VO)**를 구분하는 명확한 기준(식별자 유무)을 배웁니다.
- **Aggregate Root**가 왜 트랜잭션의 단위가 되어야 하는지 이해합니다.
- **Anemic Domain Model**(빈약한 도메인 모델)을 피하고 **Rich Domain Model**을 만드는 법을 봅니다.

## 1) Entity vs Value Object (VO)

DDD에서 가장 기본이 되는 구분입니다.

| 구분 | Entity (엔티티) | Value Object (VO, 값 객체) |
|:---|:---|:---|
| **식별자** | 있음 (ID) | 없음 (값 자체가 식별자) |
| **변경 가능성** | Mutable (상태 변경 가능) | **Immutable** (불변) |
| **비교 기준** | ID가 같으면 같은 객체 | 모든 필드 값이 같으면 같은 객체 (`equals()`) |
| **예시** | 사용자(User), 주문(Order) | 돈(Money), 주소(Address), 좌표(Point) |

### VO의 마법: 불변성 (Immutability)
VO는 불변이므로 **공유해도 안전(Thread-safe)**하며, 사이드 이펙트가 없습니다.
`Money` 객체의 값을 바꾸고 싶다면? 값을 바꾸는 게 아니라 **새로운 `Money` 객체를 생성**해서 반환해야 합니다.

```java
// 나쁜 예 (Mutable)
money.setAmount(current + 1000);

// 좋은 예 (Immutable)
Money newMoney = money.plus(new Money(1000));
```

## 2) Aggregate & Aggregate Root

**Aggregate(애그리거트)**는 "관련된 객체들의 묶음"이자 **"데이터 변경의 단위"**입니다.
**Aggregate Root**는 그 묶음의 대장(진입점)입니다.

### 규칙: Root를 통해서만 접근하라
외부에서는 Aggregate 내부의 객체(Item, ShippingInfo)를 직접 수정하면 안 됩니다.
반드시 **Root(Order)**에게 요청해야 합니다.

```mermaid
graph TD
    subgraph Aggregate [Order Aggregate]
        Root[Order (Root)]
        Item1[OrderItem 1]
        Item2[OrderItem 2]
        Addr[ShippingAddress (VO)]
        
        Root --> Item1
        Root --> Item2
        Root --> Addr
    end
    
    Client[Client Code]
    
    Client --"order.changeShippingInfo()"--> Root
    Client --"❌ order.getAddress().setCity()"--> Addr
    
    style Root fill:#ffe0b2,stroke:#f57c00
    style Aggregate fill:#fff3e0,stroke:#ff9800,stroke-dasharray: 5 5
```

이렇게 하면 **"배송지가 변경되면 배송비도 다시 계산해야 한다"**는 비즈니스 불변식(Invariant)을 Root가 책임지고 보장할 수 있습니다.

## 3) Repository의 진정한 의미

Repository는 단순한 DAO(Data Access Object)가 아닙니다.
**"Aggregate를 저장하고 불러오는 컬렉션 같은 인터페이스"**입니다.

- **원칙**: Repository는 **Aggregate Root 단위로만** 존재해야 합니다.
- `OrderItemRepository`는 존재하면 안 됩니다. `OrderRepository`를 통해 저장하고 불러와야 합니다.

## 요약

- **VO**는 불변으로 만들어 부작용을 원천 차단하세요.
- **Aggregate Root**는 트랜잭션의 일관성을 지키는 수문장입니다.
- **Repository**는 DB 테이블 단위가 아니라, Aggregate 단위로 만드세요.

## 다음 단계

- **Hexagonal Architecture**: 이 도메인 모델을 외부 기술(Web, DB)로부터 지키는 성벽을 쌓습니다.
