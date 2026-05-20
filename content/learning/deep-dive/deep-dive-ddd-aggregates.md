---
title: "DDD 심화: Aggregate Root와 트랜잭션 경계"
date: 2025-12-28
draft: false
topic: "Architecture"
tags: ["DDD", "Aggregate", "Transaction", "Eventual Consistency"]
categories: ["Backend Deep Dive"]
description: "DDD에서 가장 자주 무너지는 Aggregate 경계를 실무 시나리오로 풀어내고, 트랜잭션 범위와 결과적 일관성의 판단 기준을 정리합니다."
summary: "Aggregate를 크게 잡으면 락 경합이 커지고, 너무 잘게 쪼개면 비즈니스 규칙이 흩어집니다. 이 글은 Aggregate Root, 트랜잭션 경계, 도메인 이벤트를 한 흐름으로 묶어 설명합니다."
key_takeaways:
  - "Aggregate는 함께 강한 일관성이 필요한 최소 범위로 설계한다."
  - "하나의 트랜잭션에서 여러 Aggregate를 동시에 수정하는 습관은 병목과 복잡도를 부른다."
  - "다른 Aggregate로 퍼지는 변경은 도메인 이벤트와 결과적 일관성으로 푼다."
operator_checklist:
  - "한 서비스 메서드에서 서로 다른 Aggregate Repository를 동시에 save하고 있지 않은지 본다."
  - "외부 Aggregate 참조가 객체 참조가 아니라 ID 중심인지 점검한다."
  - "비동기 후처리에 재시도, 중복 방지, 관측 지표가 준비되어 있는지 확인한다."
series: "DDD와 헥사고날 아키텍처"
module: "architecture-mastery"
learning_refs:
  - title: "DDD 전술적 설계: Entity, VO, 그리고 Aggregate"
    href: "/learning/deep-dive/deep-dive-ddd-tactical/"
    description: "Aggregate를 이해하기 전에 Entity, VO, Root 역할을 먼저 정리해 둔 글입니다."
  - title: "Outbox와 Saga 패턴"
    href: "/learning/deep-dive/deep-dive-outbox-saga-patterns/"
    description: "도메인 이벤트를 실제 운영 환경에서 안전하게 전달하는 방법까지 이어서 볼 수 있습니다."
  - title: "육각형 아키텍처 (Hexagonal)"
    href: "/learning/deep-dive/deep-dive-hexagonal-architecture/"
    description: "Aggregate 경계를 외부 프레임워크 의존으로부터 보호하는 구조를 연결해서 학습합니다."
faqs:
  - question: "Aggregate를 작게 나누면 무조건 좋은가요?"
    answer: "아닙니다. 작게 나누면 동시성에는 유리하지만, 함께 보장해야 할 비즈니스 규칙이 여러 Aggregate로 퍼질 수 있습니다. 핵심은 '항상 동시에 맞아야 하는 규칙'을 기준으로 경계를 잡는 것입니다."
  - question: "결과적 일관성은 사용자 경험을 해치지 않나요?"
    answer: "영향은 있습니다. 그래서 즉시 반영이 꼭 필요한 규칙과 몇 초 지연을 허용할 수 있는 규칙을 나눠야 합니다. 포인트 적립, 등급 반영, 통계 집계처럼 후행 처리 가능한 영역에 먼저 적용하는 것이 현실적입니다."
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

## 🧱 1. Aggregate는 객체 묶음이 아니라 일관성 계약이다

테이블이 비슷하게 생겼다고 한 Aggregate에 넣고, 화면에서 같이 보인다고 같은 트랜잭션에 묶기 시작하면 금방 문제가 생깁니다. Aggregate는 화면 단위도 아니고 ERD 단위도 아닙니다. **강한 일관성을 즉시 보장해야 하는 최소 비즈니스 경계**입니다.

예를 들어 `Order`와 `OrderLine`은 주문 총액, 수량, 배송 가능 여부 같은 규칙을 함께 맞춰야 하므로 한 Aggregate로 묶기 좋습니다. 반면 `User`의 등급, 마케팅 수신 동의, 포인트 적립은 주문과 관련이 있더라도 같은 순간에 꼭 한 트랜잭션으로 묶어야 하는지는 다시 따져봐야 합니다.

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

- `Order`, `OrderLine`, `ShippingInfo`는 같은 변경 경계에 있습니다.
- `User`는 주문과 연관되지만 다른 Aggregate로 분리됩니다.
- 외부는 `OrderLine`을 직접 수정하지 않고 오직 `Order`를 통해서만 명령을 보냅니다.

## 📏 2. One Transaction, One Aggregate가 중요한 이유

실무에서 가장 자주 보이는 안티패턴은 "편하니까 한 메서드에서 다 바꾸자"입니다. 처음엔 깔끔해 보여도 트래픽이 올라가면 DB 락과 경합, 예외 처리 복잡도가 한 번에 터집니다.

### ❌ 나쁜 설계: 거대 트랜잭션

```java
@Transactional
public void orderAndChangeAddress(OrderId id, String newAddr) {
    Order order = orderRepo.findById(id);
    User user = userRepo.findById(order.getUserId());

    order.shipTo(newAddr); // Order 수정
    user.changeAddress(newAddr); // User 수정
}
```

겉으로는 두 줄뿐이지만 실제로는 다음 문제가 숨어 있습니다.

- `Order`와 `User`가 동시에 잠긴다.
- 재시도 시 어느 시점까지 반영됐는지 판단이 어려워진다.
- 규칙이 커질수록 서비스 메서드가 비대해진다.
- 다른 기능도 같은 Aggregate 조합을 따라 하며 결합도가 퍼진다.

특히 주문, 결제, 정산, 멤버십처럼 핵심 도메인이 얽히면 이 결합은 장애 범위를 크게 키웁니다.

## 3. 그럼 다른 Aggregate는 어떻게 반영할까

정답은 대부분 **도메인 이벤트 + 결과적 일관성**입니다. 즉, 지금 트랜잭션에서는 현재 Aggregate만 확실히 완료하고, 다른 Aggregate로 퍼지는 변화는 별도 흐름으로 넘깁니다.

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

예를 들어 "주문 완료 시 사용자 등급 반영"은 보통 몇 밀리초, 몇 초 늦어도 됩니다. 그런 규칙을 굳이 주문 완료 트랜잭션 안에 묶을 이유가 없습니다.

이 방식의 장점은 분명합니다.

- 주문 완료의 응답 시간이 안정적입니다.
- 실패 지점이 분리되어 재처리 전략을 따로 가져갈 수 있습니다.
- 주문과 회원 도메인이 서로를 덜 오염시킵니다.

물론 대가도 있습니다. 중복 이벤트, 순서 역전, 소비 지연 같은 문제가 생길 수 있으니 [Outbox와 Saga 패턴](/learning/deep-dive/deep-dive-outbox-saga-patterns/) 같은 운영 패턴까지 같이 봐야 합니다.

## 4) Aggregate를 크게 잡을지, 작게 잡을지 판단하는 법

이 질문에는 정답보다 판단 기준이 중요합니다. 저는 보통 아래 세 질문으로 봅니다.

1. **이 규칙은 같은 순간에 반드시 맞아야 하는가?**
2. **동시에 변경될 때 락 경합이 커질 가능성이 큰가?**
3. **실패했을 때 재처리 가능한가, 아니면 즉시 원자성이 필요한가?**

예를 들어 `Order`의 총액과 주문 라인은 같은 순간에 맞아야 하니 한 Aggregate가 자연스럽습니다. 반면 `Order`와 `InventoryReservation`은 시스템에 따라 분리할 수 있습니다. 재고 홀드가 외부 시스템이거나 고부하 구간이라면 별도 Aggregate 또는 별도 서비스로 분리하고 보상 전략을 설계하는 편이 낫습니다.

## 5) 참조는 ID로, 규칙은 Root로

다른 Aggregate를 객체로 직접 물고 가면 경계가 흐려집니다. JPA에서는 특히 연관관계가 자동 탐색을 부추겨서 "조금만 더" 하다가 Aggregate 경계가 무너집니다.

그래서 외부 Aggregate는 보통 **ID만 참조**하는 편이 낫습니다.

- `Order`는 `User` 객체 대신 `userId`를 가진다.
- 필요하면 애플리케이션 서비스가 조회를 조합한다.
- Root 바깥에서 내부 컬렉션을 직접 조작하지 않는다.

이 원칙은 성능보다도 **모델의 의도**를 살려 줍니다. "이 객체는 저 Aggregate를 소유하지 않는다"는 사실이 코드에 드러나기 때문입니다.

## 6) 실무 적용 체크리스트

Aggregate 설계를 리뷰할 때는 개념 설명보다 아래 항목이 훨씬 도움이 됩니다.

- 한 서비스 메서드에서 서로 다른 Aggregate Repository를 여러 개 저장하고 있지 않은가?
- Root가 아닌 내부 Entity를 직접 수정하는 public API가 열려 있지 않은가?
- 도메인 이벤트 발행 후 중복 처리 방지가 있는가?
- 후행 작업 실패를 재시도할 큐, 로그, 메트릭이 있는가?
- 조회 편의 때문에 강한 일관성까지 불필요하게 요구하고 있지 않은가?

이 체크리스트로 보면 Aggregate 문제는 철학이 아니라 운영 문제라는 걸 금방 체감하게 됩니다.

## 요약

1. **Aggregate Root**는 외부 명령이 들어오는 유일한 문지기입니다.
2. **하나의 트랜잭션에서는 하나의 Aggregate만 수정**하는 쪽이 대체로 안전합니다.
3. 다른 Aggregate로 퍼지는 변경은 **도메인 이벤트와 결과적 일관성**으로 분리하세요.
4. 참조는 객체보다 **ID**로 두어 경계를 분명하게 유지하세요.

## 다음 단계

- [DDD 전술적 설계: Entity, VO, 그리고 Aggregate](/learning/deep-dive/deep-dive-ddd-tactical/)
- [육각형 아키텍처 (Hexagonal)](/learning/deep-dive/deep-dive-hexagonal-architecture/)
- [Outbox와 Saga 패턴](/learning/deep-dive/deep-dive-outbox-saga-patterns/)
