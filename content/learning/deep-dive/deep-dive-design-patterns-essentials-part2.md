---
title: "디자인 패턴 필수 (Part 2: Strategy, 실무 적용)"
date: 2025-10-09
draft: false
topic: "Design Patterns"
tags: ["Design Patterns", "Factory", "Strategy", "Template Method", "OOP"]
categories: ["Backend Deep Dive"]
description: "백엔드 개발에서 가장 많이 쓰이는 3가지 패턴을 실전 예제로 마스터"
module: "foundation"
quizzes:
  - question: "객체 생성 로직을 캡슐화하여, 클라이언트가 구체적인 클래스에 의존하지 않게 만드는 생성 패턴은?"
    options:
      - "Singleton Pattern"
      - "Factory Pattern"
      - "Strategy Pattern"
      - "Adapter Pattern"
    answer: 1
    explanation: "Factory 패턴은 '객체 생성'을 전담하는 공장을 두어, 클라이언트 코드가 `new ConcreteClass()`를 직접 호출하지 않도록 분리합니다."

  - question: "실행 중에(Runtime) 알고리즘이나 로직을 교체할 수 있도록 하여, if-else 분기를 줄이고 유연성을 높이는 패턴은?"
    options:
      - "Template Method Pattern"
      - "Strategy Pattern"
      - "Observer Pattern"
      - "Decorator Pattern"
    answer: 1
    explanation: "Strategy 패턴은 공통 인터페이스를 정의하고 여러 알고리즘을 각각의 클래스로 구현하여, 필요에 따라 갈아끼울 수 있게 합니다."

  - question: "알고리즘의 전체 구조(뼈대)는 부모 클래스에서 정의하고, 세부적인 구현 단계는 자식 클래스에게 위임하는 패턴은?"
    options:
      - "Factory Method Pattern"
      - "Template Method Pattern"
      - "Builder Pattern"
      - "Prototype Pattern"
    answer: 1
    explanation: "부모 클래스가 `final` 메서드로 흐름을 제어하고, 변경이 필요한 부분만 `abstract` 메서드로 남겨두어 자식이 구현하게 합니다."

  - question: "Spring Framework의 `Dependency Injection(DI)`은 어떤 디자인 패턴의 응용이라고 볼 수 있을까요?"
    options:
      - "Factory Pattern & Strategy Pattern"
      - "Observer Pattern"
      - "Singleton Pattern only"
      - "Flyweight Pattern"
    answer: 0
    explanation: "DI 컨테이너(Factory 역할)가 빈을 생성하고, 의존성 주입을 통해 구현체를 주입(Strategy 교체)하는 원리가 결합되어 있습니다."

  - question: "Singleton 패턴 사용 시 주의해야 할 점이 아닌 것은?"
    options:
      - "멀티 스레드 환경에서의 동기화 문제"
      - "테스트하기 어려움 (Mocking 등)"
      - "객체 생성 비용이 너무 많이 든다"
      - "전역 상태(Global State)를 공유하므로 의존 관계가 숨겨질 수 있다"
    answer: 2
    explanation: "싱글톤은 오히려 객체를 한 번만 생성하므로 메모리 및 생성 비용을 절약합니다. 문제점은 주로 상태 공유와 테스트의 어려움입니다."

  - question: "다음 상황에서 사용하면 가장 적절한 패턴은? '커피 주문 시 기본 커피에 우유 추가, 시럽 추가, 샷 추가 등 옵션을 동적으로 계속 붙여야 한다.'"
    options:
      - "Builder Pattern"
      - "Decorator Pattern"
      - "Facade Pattern"
      - "Proxy Pattern"
    answer: 1
    explanation: "Decorator 패턴은 객체에 동적으로 새로운 책임(기능)을 덧붙일 때 유용합니다. 상속보다 유연한 확장을 제공합니다."

  - question: "객체의 상태 변화를 관찰하고 있다가, 상태가 변하면 의존하고 있는 다른 객체들에게 자동으로 알림을 보내는 패턴은?"
    options:
      - "Observer Pattern"
      - "Command Pattern"
      - "Mediator Pattern"
      - "State Pattern"
    answer: 0
    explanation: "이벤트 기반 시스템이나 MVC 패턴의 모델-뷰 동기화에 주로 사용되는 Observer(Pub/Sub) 패턴입니다."

  - question: "Strategy 패턴과 Template Method 패턴의 가장 큰 차이점은?"
    options:
      - "Strategy는 상속을 사용하고, Template Method는 위임(인터페이스)을 사용한다."
      - "Strategy는 위임(인터페이스)을 사용하여 런타임 교체가 가능하고, Template Method는 상속을 사용하여 컴파일 타임에 구조가 결정된다."
      - "둘은 완전히 같은 패턴이다."
      - "Template Method가 더 유연하다."
    answer: 1
    explanation: "Strategy는 객체 합성을 통한 '위임'이 핵심이고, Template Method는 클래스 상속을 통한 '구조 재사용'이 핵심입니다."
study_order: 31
---

## 2) Strategy 패턴: 알고리즘을 런타임에 교체

**"알고리즘을 캡슐화하고 교체 가능하게 만듦"**

### 2-1) 문제 상황

```java
// ❌ 할인 정책이 하드코딩됨
public class OrderService {
    public int calculateDiscount(Order order, String customerType) {
        if (customerType.equals("VIP")) {
            return order.getAmount() * 20 / 100;  // 20% 할인
        } else if (customerType.equals("REGULAR")) {
            return order.getAmount() * 10 / 100;  // 10% 할인
        } else {
            return 0;
        }
    }
}
```

**문제점:**
- 새 할인 정책 추가 시 기존 코드 수정
- 할인 로직 재사용 불가
- 테스트 어려움

### 2-2) Strategy 패턴 적용

```java
// Strategy 인터페이스
public interface DiscountStrategy {
    int calculate(int amount);
}

// 구체 전략들
public class VipDiscountStrategy implements DiscountStrategy {
    @Override
    public int calculate(int amount) {
        return amount * 20 / 100;
    }
}

public class RegularDiscountStrategy implements DiscountStrategy {
    @Override
    public int calculate(int amount) {
        return amount * 10 / 100;
    }
}

public class NoDiscountStrategy implements DiscountStrategy {
    @Override
    public int calculate(int amount) {
        return 0;
    }
}

// Context (전략 사용)
public class Order {
    private int amount;
    private DiscountStrategy discountStrategy;

    public Order(int amount, DiscountStrategy discountStrategy) {
        this.amount = amount;
        this.discountStrategy = discountStrategy;
    }

    public void setDiscountStrategy(DiscountStrategy discountStrategy) {
        this.discountStrategy = discountStrategy;
    }

    public int getFinalAmount() {
        int discount = discountStrategy.calculate(amount);
        return amount - discount;
    }
}

// ✅ 사용
Order vipOrder = new Order(10000, new VipDiscountStrategy());
System.out.println(vipOrder.getFinalAmount());  // 8000

Order regularOrder = new Order(10000, new RegularDiscountStrategy());
System.out.println(regularOrder.getFinalAmount());  // 9000

// 런타임에 전략 변경 가능
vipOrder.setDiscountStrategy(new NoDiscountStrategy());
System.out.println(vipOrder.getFinalAmount());  // 10000
```

### 2-3) 실전 예제: 정렬 전략

```java
public interface SortStrategy<T> {
    void sort(List<T> list);
}

public class QuickSortStrategy<T extends Comparable<T>> implements SortStrategy<T> {
    @Override
    public void sort(List<T> list) {
        // 퀵 정렬 구현
        Collections.sort(list);
    }
}

public class MergeSortStrategy<T extends Comparable<T>> implements SortStrategy<T> {
    @Override
    public void sort(List<T> list) {
        // 병합 정렬 구현
    }
}

public class DataProcessor<T extends Comparable<T>> {
    private SortStrategy<T> sortStrategy;

    public DataProcessor(SortStrategy<T> sortStrategy) {
        this.sortStrategy = sortStrategy;
    }

    public void process(List<T> data) {
        sortStrategy.sort(data);
        System.out.println("Sorted: " + data);
    }
}

// 사용
List<Integer> numbers = Arrays.asList(5, 2, 8, 1, 9);
DataProcessor<Integer> processor = new DataProcessor<>(new QuickSortStrategy<>());
processor.process(numbers);
```

### 2-4) Spring에서의 Strategy 패턴

```java
// Strategy 인터페이스
public interface NotificationStrategy {
    void send(String message);
}

// 구현체들
@Component("emailNotification")
public class EmailNotificationStrategy implements NotificationStrategy {
    @Override
    public void send(String message) {
        System.out.println("Email: " + message);
    }
}

@Component("smsNotification")
public class SmsNotificationStrategy implements NotificationStrategy {
    @Override
    public void send(String message) {
        System.out.println("SMS: " + message);
    }
}

// Context
@Service
public class NotificationService {
    private final Map<String, NotificationStrategy> strategies;

    public NotificationService(List<NotificationStrategy> strategyList) {
        this.strategies = strategyList.stream()
            .collect(Collectors.toMap(
                s -> s.getClass().getSimpleName(),
                s -> s
            ));
    }

    public void notify(String type, String message) {
        NotificationStrategy strategy = strategies.get(type + "NotificationStrategy");
        if (strategy != null) {
            strategy.send(message);
        }
    }
}
```

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: 디자인 패턴 필수 (Part 1: 기초 패턴)](/learning/deep-dive/deep-dive-design-patterns-essentials/)**
