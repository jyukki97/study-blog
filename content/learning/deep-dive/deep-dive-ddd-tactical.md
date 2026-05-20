---
title: "DDD 전술적 설계: Entity, VO, 그리고 Aggregate"
date: 2025-12-28
draft: false
topic: "Architecture"
tags: ["DDD", "Architecture", "Entity", "Value Object", "Aggregate"]
categories: ["Backend Deep Dive"]
description: "도메인 주도 설계의 핵심 빌딩 블록을 이해하고, 왜 불변 객체(VO)가 중요한지 실무 예시와 함께 정리합니다."
summary: "Entity, VO, Aggregate를 구분하지 못하면 도메인 로직이 서비스 계층으로 새고, 변경 비용이 빠르게 커집니다. 이 글은 식별자, 불변성, 경계라는 세 기준으로 전술적 설계를 정리합니다."
key_takeaways:
  - "Entity는 ID로 추적하고, VO는 값 전체로 비교한다."
  - "VO를 불변으로 설계하면 사이드 이펙트와 테스트 비용이 함께 줄어든다."
  - "Aggregate Root는 내부 규칙을 지키는 유일한 진입점이어야 한다."
operator_checklist:
  - "도메인 객체에 public setter가 남아 있는지 확인한다."
  - "Repository가 Aggregate Root 단위로만 노출되는지 점검한다."
  - "서비스 계층에 흩어진 규칙이 Entity/VO 안으로 들어갈 수 있는지 본다."
series: "DDD와 헥사고날 아키텍처"
module: "architecture-mastery"
learning_refs:
  - title: "Aggregate Root와 트랜잭션 경계"
    href: "/learning/deep-dive/deep-dive-ddd-aggregates/"
    description: "Aggregate를 어디까지 묶어야 하는지, 트랜잭션 경계를 어떻게 잡아야 하는지 이어서 정리합니다."
  - title: "육각형 아키텍처 (Hexagonal)"
    href: "/learning/deep-dive/deep-dive-hexagonal-architecture/"
    description: "전술적 설계를 프레임워크 바깥으로 밀어내는 구조적 방법을 연결해서 볼 수 있습니다."
  - title: "도메인 모델링과 Aggregate 설계"
    href: "/learning/deep-dive/deep-dive-domain-modeling-aggregates/"
    description: "개념 설명에서 끝나지 않고 실제 모델링 순서까지 확장해 봅니다."
faqs:
  - question: "DTO도 Value Object처럼 다루면 되나요?"
    answer: "항상 그렇지는 않습니다. DTO는 계층 간 전달 형식이고, VO는 도메인 규칙과 의미를 가진 값입니다. 주소나 금액처럼 비즈니스 규칙이 붙는 값은 VO로 승격하는 편이 안전합니다."
  - question: "Entity에 로직을 넣으면 너무 무거워지지 않나요?"
    answer: "모든 로직을 몰아넣으라는 뜻은 아닙니다. 상태를 바꾸는 규칙, 불변식 검증, 자기 일관성을 지키는 로직은 Entity 안에 두고, 여러 Aggregate를 조합하는 흐름은 애플리케이션 서비스로 남기는 분리가 핵심입니다."
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

- **Entity**와 **Value Object(VO)**를 구분하는 명확한 기준을 잡습니다.
- **Aggregate Root**가 왜 단순 연결점이 아니라 규칙 집행자인지 이해합니다.
- 서비스 계층에 쌓인 규칙을 어떻게 도메인 안으로 되돌릴지 감을 잡습니다.

## 1) Entity vs Value Object, 헷갈리면 생기는 문제

DDD 입문에서 가장 자주 헷갈리는 지점이 `Entity`와 `VO`의 차이입니다. 이 구분이 흐려지면 코드가 처음엔 빨리 써지지만, 시간이 지날수록 규칙이 퍼지고 수정 범위가 예측 불가능해집니다.

예를 들어 `Order`, `Coupon`, `Member`는 시간에 따라 상태가 달라지고, 같은 객체를 계속 추적해야 하므로 Entity에 가깝습니다. 반면 `Money`, `Address`, `DateRange`는 **값 자체가 의미**이므로 VO로 두는 편이 자연스럽습니다.

| 구분 | Entity (엔티티) | Value Object (VO, 값 객체) |
|:---|:---|:---|
| **식별자** | 있음 (ID) | 없음 (값 자체가 식별자) |
| **변경 가능성** | 상태 변경 가능 | **불변으로 설계 권장** |
| **비교 기준** | ID가 같으면 같은 객체 | 모든 필드 값이 같으면 같은 객체 |
| **대표 관심사** | 생명주기, 상태 전이 | 유효성, 계산, 표현 규칙 |
| **예시** | 사용자(User), 주문(Order) | 돈(Money), 주소(Address), 좌표(Point) |

핵심은 단순히 "ID가 있냐 없냐"에서 끝나지 않습니다. **시간에 따라 추적할 대상인가, 값으로 대체 가능한가**까지 같이 봐야 합니다.

## 2) VO를 불변으로 두면 왜 그렇게 편해질까

VO를 불변으로 두면 로직이 눈에 띄게 단순해집니다. 같은 `Money` 인스턴스를 여러 객체가 공유해도 걱정할 필요가 없고, 중간에 값이 조용히 바뀌어 버리는 사고를 막을 수 있습니다.

```java
// 나쁜 예: 원본을 직접 바꿈
money.setAmount(current + 1000);

// 좋은 예: 새 값을 만들어 반환
Money increased = money.plus(new Money(1000));
```

이 차이는 테스트에서 더 크게 드러납니다. 가변 객체는 "누가 언제 바꿨는지"를 추적해야 하지만, 불변 VO는 입력과 출력만 보면 됩니다. 특히 할인, 세금, 배송비 계산처럼 조합이 많은 도메인일수록 불변성이 주는 안정감이 큽니다.

### 실무 체크

- `setAmount`, `setCurrency` 같은 public setter가 VO에 열려 있지 않은가?
- 생성 시점에 유효성 검증을 끝내고 있는가?
- 값 연산 결과를 새 객체로 반환하고 있는가?

이 세 가지가 지켜지면 VO는 단순 데이터 뭉치가 아니라 **도메인 규칙을 품은 안전한 값 타입**이 됩니다.

## 3) Aggregate는 "관련 객체 모음"보다 더 엄격한 개념

Aggregate는 단순히 엔티티를 묶는 폴더가 아닙니다. **함께 변경되어야 하는 최소 일관성 경계**입니다. 그래서 Aggregate 안에 들어간 객체는 외부가 직접 만지지 못하게 하고, Root를 통해서만 바뀌게 해야 합니다.

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

이 구조를 지키면 "배송지 변경 시 배송 가능 지역 검증", "주문 금액 변경 시 프로모션 재계산" 같은 규칙을 한 곳에 모을 수 있습니다. 반대로 내부 객체를 바깥에 노출하면 규칙이 여러 서비스와 컨트롤러로 흩어지고, 결국 같은 검증을 여러 번 복사하게 됩니다.

## 4) Anemic Domain Model을 피하려면 어디까지 도메인에 넣어야 할까

많은 프로젝트에서 Entity는 getter/setter만 있고, 진짜 규칙은 Service에 몰려 있습니다. 처음에는 익숙하지만, 기능이 늘어날수록 Service가 커지고 중복 조건문이 늘어납니다.

예를 들어 아래처럼 주문 상태 변경 조건이 여러 서비스에 복제되기 시작하면 위험 신호입니다.

```java
if (order.getStatus() != OrderStatus.PAID) {
    throw new IllegalStateException("결제 완료 주문만 출고할 수 있습니다.");
}
```

이 규칙은 `Order.ship()` 같은 도메인 메서드로 들어가야 합니다. 애플리케이션 서비스는 "어떤 흐름으로 호출할지"를 조합하고, 도메인 객체는 "상태를 바꿔도 되는지"를 스스로 판단해야 응집도가 살아납니다.

## 5) Repository는 테이블 저장소가 아니라 Aggregate 진입점

Repository를 테이블 단위로 나누기 시작하면 `OrderItemRepository`, `AddressRepository`처럼 내부 구성요소가 바깥으로 새어 나옵니다. 그러면 Aggregate Root를 우회해서 내부 데이터만 따로 저장하는 길이 열리고, 일관성 규칙이 깨집니다.

그래서 Repository는 가능하면 **Aggregate Root 기준**으로 정의하는 편이 좋습니다.

- `OrderRepository`는 괜찮음
- `OrderItemRepository`는 대체로 위험 신호
- `CouponRepository`가 필요하다면 Coupon이 별도 Aggregate인지 먼저 판단

이 기준이 익숙해지면 다음 글인 [Aggregate Root와 트랜잭션 경계](/learning/deep-dive/deep-dive-ddd-aggregates/)에서 다루는 "One Transaction, One Aggregate" 원칙도 훨씬 자연스럽게 이어집니다.

## 6) 결국 이 설계는 구조 아키텍처로 연결된다

전술적 설계가 잘 되면 자연스럽게 "이 도메인 로직을 스프링, JPA, 외부 API로부터 어떻게 분리할까?"라는 질문으로 넘어갑니다. 그다음 단계가 바로 [육각형 아키텍처](/learning/deep-dive/deep-dive-hexagonal-architecture/)입니다.

즉,

1. Entity/VO 구분으로 모델의 의미를 명확히 하고,
2. Aggregate로 변경 경계를 세우고,
3. Hexagonal로 외부 기술 의존을 바깥으로 밀어내는 흐름입니다.

이 세 단계가 이어지면 도메인 모델이 "설명용 다이어그램"이 아니라 실제로 유지보수 비용을 낮추는 구조가 됩니다.

## 요약

- **VO**는 불변으로 만들어 값 규칙을 안전하게 캡슐화하세요.
- **Entity**는 생명주기와 상태 전이를 책임지는 객체입니다.
- **Aggregate Root**는 내부 규칙을 지키는 유일한 진입점이어야 합니다.
- **Repository**는 테이블이 아니라 Aggregate 기준으로 생각해야 합니다.

## 다음 단계

- [Aggregate Root와 트랜잭션 경계](/learning/deep-dive/deep-dive-ddd-aggregates/)
- [육각형 아키텍처 (Hexagonal)](/learning/deep-dive/deep-dive-hexagonal-architecture/)
- [도메인 모델링과 Aggregate 설계](/learning/deep-dive/deep-dive-domain-modeling-aggregates/)
