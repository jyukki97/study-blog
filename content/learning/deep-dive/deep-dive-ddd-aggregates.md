---
title: "DDD 심화: Aggregate Root와 트랜잭션 경계"
date: 2025-12-28
draft: false
topic: "Architecture"
tags: ["DDD", "Aggregate", "Transaction", "Eventual Consistency"]
categories: ["Backend Deep Dive"]
description: "도메인 주도 설계(DDD)에서 가장 어려운 Aggregate 개념. 트랜잭션의 범위를 정의하고 데이터 무결성을 지키는 원칙을 다룹니다."
module: "architecture-mastery"
quizzes:
  - question: "DDD에서 Aggregate를 정의할 때 가장 중요한 기준은?"
    options:
      - "테이블 개수"
      - "함께 생성되고, 함께 변경되고, 함께 삭제되어야 하는 객체들의 묶음(트랜잭션 일관성 경계)"
      - "코드 라인 수"
      - "API 엔드포인트 수"
    answer: 1
    explanation: "Aggregate는 데이터 일관성을 유지해야 하는 객체들의 묶음입니다. Order가 생성되면 OrderLine도 함께 생성되고, Order가 삭제되면 OrderLine도 함께 삭제됩니다."

  - question: "'하나의 트랜잭션에서는 하나의 Aggregate만 수정해야 한다'는 원칙의 이유는?"
    options:
      - "코드가 간단해지기 때문"
      - "여러 Aggregate를 동시에 수정하면 여러 테이블에 락이 걸려 DB 병목과 데드락 위험이 증가하기 때문"
      - "JPA에서 강제하는 규칙이기 때문"
      - "테스트가 쉬워지기 때문"
    answer: 1
    explanation: "한 트랜잭션에서 Order와 User를 동시에 수정하면 두 테이블에 락이 걸립니다. 트래픽이 늘어나면 경합이 심해져 성능이 급격히 저하됩니다."

  - question: "다른 Aggregate를 변경해야 할 때 권장되는 패턴은?"
    options:
      - "같은 트랜잭션에서 모두 수정한다."
      - "도메인 이벤트를 발행하여 비동기로 처리하고, Eventual Consistency(결과적 일관성)를 수용한다."
      - "직접 참조하여 즉시 수정한다."
      - "수정하지 않는다."
    answer: 1
    explanation: "Order가 완료되면 User 등급을 올려야 한다면, OrderCompleted 이벤트를 발행하고 별도 트랜잭션에서 User를 수정합니다. 수 밀리초의 지연이 있지만 시스템은 훨씬 유연합니다."

  - question: "다른 Aggregate를 참조할 때 객체 참조 대신 ID로 참조하는 이유는?"
    options:
      - "메모리를 절약하기 위해"
      - "Lazy Loading 지옥을 피하고, Aggregate 간 경계를 명확히 하여 순환 참조와 과도한 조회를 방지하기 위해"
      - "JPA에서 지원하지 않기 때문"
      - "코드가 짧아지기 때문"
    answer: 1
    explanation: "Order가 User를 직접 참조하면 Order 조회 시 User도 함께 로딩됩니다. ID만 참조하면 필요할 때만 별도 쿼리로 조회하여 N+1 문제와 순환 로딩을 방지합니다."

  - question: "Aggregate 크기를 결정할 때 주의할 점은?"
    options:
      - "가능한 크게 만들어 모든 관련 객체를 포함한다."
      - "너무 크면 트랜잭션 경합이 증가하고, 너무 작으면 일관성 유지가 어려우므로 비즈니스 불변식(Invariant)을 기준으로 적절히 설계한다."
      - "테이블당 하나의 Aggregate로 고정한다."
      - "크기는 중요하지 않다."
    answer: 1
    explanation: "Aggregate가 크면 락 범위가 넓어져 동시성이 떨어집니다. 반면 너무 작으면 비즈니스 규칙이 깨질 수 있습니다. '함께 변경되어야 하는 최소 단위'로 설계하는 것이 핵심입니다."
study_order: 1103
---

## 🧱 1. Aggregate: 객체들의 운명 공동체

데이터베이스 테이블을 설계할 때 가장 많이 하는 실수가 "모든 테이블을 FK로 엮어버리는 것"입니다.
그러면 **어디까지 조회해야 하고, 어디까지 저장해야 하는지** 경계가 사라집니다.

**Aggregate**는 **"함께 생성되고, 함께 변경되고, 함께 죽는 객체들의 묶음"**입니다.

### 경계의 시각화

```mermaid
classDiagram
    namespace OrderAggregate {
        class Order {
            +confirm()
            +cancel()
            -List~OrderLine~ lines
            -ShippingInfo shipping
        }
        class OrderLine {
            -productId
            -quantity
        }
        class ShippingInfo {
            -address
            -receiver
        }
    }
    
    namespace UserAggregate {
        class User {
            +changeName()
        }
    }

    Order "1" *-- "N" OrderLine : Composition
    Order "1" *-- "1" ShippingInfo : Composition
    Order ..> User : Referenced by ID only!
```

- `Order`, `OrderLine`, `ShippingInfo`는 한 묶음입니다.
- **주문(Order)**이 이 구역의 대장(**Aggregate Root**)입니다.
- 외부에서는 `OrderLine`에 직접 접근하면 안 됩니다. 오직 `Order`를 통해서만 명령을 내려야 합니다.

---

## 📏 2. 트랜잭션의 원칙: One Transaction, One Aggregate

가장 중요한 규칙입니다. **"하나의 트랜잭션에서는 하나의 Aggregate만 수정해야 합니다."**

### ❌ 나쁜 설계: 거대 트랜잭션
```java
@Transactional
public void orderAndChangeAddress(OrderId id, String newAddr) {
    Order order = orderRepo.findById(id);
    User user = userRepo.findById(order.getUserId());
    
    order.shipTo(newAddr); // Order 수정
    user.changeAddress(newAddr); // User 수정 (???)
}
```
- 이러면 `Order` 테이블과 `User` 테이블에 동시에 락(Lock)이 걸립니다.
- 트래픽이 늘어나면 DB가 터지는 지름길입니다.

### ✅ 좋은 설계: 결과적 일관성 (Eventual Consistency)
"주문이 완료되면, 사용자 등급을 올려준다"는 요구사항이 있다면?

```mermaid
sequenceDiagram
    participant OrderSvc as Order Aggregate
    participant EventBus
    participant UserSvc as User Aggregate
    
    OrderSvc->>OrderSvc: 1. 주문 완료 (Commit)
    OrderSvc->>EventBus: 2. Publish "OrderCompleted"
    
    EventBus->>UserSvc: 3. Subscribe Event
    UserSvc->>UserSvc: 4. 등급 상향 (New Tx)
```

1. **Order 트랜잭션**: 주문 상태 변경 -> `OrderCompleted` 이벤트 발행 -> 커밋.
2. **비동기 처리**: 이벤트를 받아서 별도의 트랜잭션으로 User를 수정.

> **핵심**: 두 변경 사이에 수 밀리초의 지연이 있지만, 시스템은 훨씬 유연하고 빨라집니다.

## 요약

1. **Aggregate Root**: 문지기. 외부에서는 오직 Root하고만 대화해라.
2. **참조**: 다른 Aggregate는 객체가 아니라 **ID**로 참조해라. (Lazy Loading 지옥 탈출)
3. **이벤트**: 다른 Aggregate를 바꿔야 하면 **도메인 이벤트**를 던져라.
