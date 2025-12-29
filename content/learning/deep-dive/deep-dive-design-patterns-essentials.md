---
title: "백엔드 필수 디자인 패턴: Factory, Strategy, Template Method"
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

## 이 글에서 얻는 것

- **Factory 패턴**으로 객체 생성을 유연하게 관리합니다.
- **Strategy 패턴**으로 알고리즘을 런타임에 교체합니다.
- **Template Method 패턴**으로 공통 로직을 재사용합니다.
- 각 패턴의 **사용 시점과 트레이드오프**를 판단할 수 있습니다.

## 0) 디자인 패턴은 "반복되는 설계 문제의 해결책"

디자인 패턴은 소프트웨어 설계에서 자주 발생하는 문제에 대한 검증된 해결책입니다.

**GoF(Gang of Four) 패턴 분류:**
- **생성 패턴**: 객체 생성 메커니즘 (Factory, Builder, Singleton)
- **구조 패턴**: 클래스/객체 조합 (Adapter, Decorator, Proxy)
- **행위 패턴**: 객체 간 협력 (Strategy, Template Method, Observer)

이 글에서는 백엔드에서 가장 많이 쓰이는 3가지를 다룹니다.

## 1) Factory 패턴: 객체 생성을 캡슐화

**"객체 생성 로직을 별도 클래스로 분리"**

### 1-1) 문제 상황

```java
// ❌ 클라이언트가 구체 클래스에 의존
public class PaymentService {
    public void processPayment(String type, int amount) {
        Payment payment;

        if (type.equals("CARD")) {
            payment = new CardPayment();
        } else if (type.equals("BANK")) {
            payment = new BankTransferPayment();
        } else if (type.equals("PAYPAL")) {
            payment = new PayPalPayment();
        } else {
            throw new IllegalArgumentException("Unknown payment type");
        }

        payment.pay(amount);
    }
}
```

**문제점:**
- 새 결제 수단 추가 시 PaymentService 수정 필요
- if-else가 여러 곳에 중복
- OCP(개방-폐쇄 원칙) 위반

### 1-2) Factory Method 패턴 적용

```java
// 인터페이스
public interface Payment {
    void pay(int amount);
}

// 구현체들
public class CardPayment implements Payment {
    @Override
    public void pay(int amount) {
        System.out.println("Card payment: " + amount);
    }
}

public class BankTransferPayment implements Payment {
    @Override
    public void pay(int amount) {
        System.out.println("Bank transfer: " + amount);
    }
}

// Factory 클래스
public class PaymentFactory {
    public static Payment createPayment(String type) {
        switch (type) {
            case "CARD":
                return new CardPayment();
            case "BANK":
                return new BankTransferPayment();
            case "PAYPAL":
                return new PayPalPayment();
            default:
                throw new IllegalArgumentException("Unknown payment type: " + type);
        }
    }
}

// ✅ 사용
public class PaymentService {
    public void processPayment(String type, int amount) {
        Payment payment = PaymentFactory.createPayment(type);  // Factory 사용
        payment.pay(amount);
    }
}
```

**장점:**
- 객체 생성 로직이 한 곳에 집중
- 클라이언트는 인터페이스만 의존
- 새 타입 추가 시 Factory만 수정

### 1-3) Spring에서의 Factory 패턴

```java
// Spring이 Factory 역할
@Configuration
public class PaymentConfig {

    @Bean
    public Payment cardPayment() {
        return new CardPayment();
    }

    @Bean
    public Payment bankPayment() {
        return new BankTransferPayment();
    }

    // 팩토리 메서드
    @Bean
    public PaymentFactory paymentFactory(List<Payment> payments) {
        return new PaymentFactory(payments);
    }
}

@Service
public class PaymentService {
    private final PaymentFactory factory;

    public PaymentService(PaymentFactory factory) {
        this.factory = factory;
    }

    public void processPayment(String type, int amount) {
        Payment payment = factory.getPayment(type);
        payment.pay(amount);
    }
}
```

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

## 3) Template Method 패턴: 공통 로직 재사용

**"알고리즘의 구조를 정의하고, 세부 단계는 서브클래스에 위임"**

### 3-1) 문제 상황

```java
// ❌ 중복된 코드
public class CsvReportGenerator {
    public void generate() {
        fetchData();
        System.out.println("Converting to CSV...");
        saveToFile("report.csv");
    }

    private void fetchData() {
        System.out.println("Fetching data from DB...");
    }

    private void saveToFile(String filename) {
        System.out.println("Saving to " + filename);
    }
}

public class PdfReportGenerator {
    public void generate() {
        fetchData();  // 중복
        System.out.println("Converting to PDF...");
        saveToFile("report.pdf");  // 중복
    }

    private void fetchData() {  // 중복
        System.out.println("Fetching data from DB...");
    }

    private void saveToFile(String filename) {  // 중복
        System.out.println("Saving to " + filename);
    }
}
```

### 3-2) Template Method 패턴 적용

```java
// 추상 클래스 (템플릿)
public abstract class ReportGenerator {

    // Template Method (알고리즘 구조 정의)
    public final void generate() {
        fetchData();
        String content = convert();  // 서브클래스가 구현
        saveToFile(content);
    }

    // 공통 로직
    private void fetchData() {
        System.out.println("Fetching data from DB...");
    }

    private void saveToFile(String content) {
        System.out.println("Saving: " + content);
    }

    // 추상 메서드 (서브클래스가 구현)
    protected abstract String convert();
}

// 구체 클래스들
public class CsvReportGenerator extends ReportGenerator {
    @Override
    protected String convert() {
        return "CSV format data";
    }
}

public class PdfReportGenerator extends ReportGenerator {
    @Override
    protected String convert() {
        return "PDF format data";
    }
}

public class ExcelReportGenerator extends ReportGenerator {
    @Override
    protected String convert() {
        return "Excel format data";
    }
}

// ✅ 사용
ReportGenerator csvReport = new CsvReportGenerator();
csvReport.generate();

ReportGenerator pdfReport = new PdfReportGenerator();
pdfReport.generate();
```

### 3-3) Hook 메서드 활용

```java
public abstract class DataProcessor {

    // Template Method
    public final void process() {
        loadData();

        if (shouldValidate()) {  // Hook
            validateData();
        }

        transformData();
        saveData();

        if (shouldNotify()) {  // Hook
            sendNotification();
        }
    }

    protected abstract void loadData();
    protected abstract void transformData();
    protected abstract void saveData();

    // Hook 메서드 (기본 구현 제공, 오버라이드 가능)
    protected boolean shouldValidate() {
        return true;  // 기본: 검증함
    }

    protected void validateData() {
        System.out.println("Validating data...");
    }

    protected boolean shouldNotify() {
        return false;  // 기본: 알림 안 함
    }

    protected void sendNotification() {
        System.out.println("Sending notification...");
    }
}

public class UserDataProcessor extends DataProcessor {
    @Override
    protected void loadData() {
        System.out.println("Loading user data...");
    }

    @Override
    protected void transformData() {
        System.out.println("Transforming user data...");
    }

    @Override
    protected void saveData() {
        System.out.println("Saving user data...");
    }

    @Override
    protected boolean shouldNotify() {
        return true;  // 사용자 데이터는 알림 필요
    }
}
```

### 3-4) Spring에서의 Template Method

```java
// JdbcTemplate이 Template Method 패턴 사용
public class UserRepository {
    private final JdbcTemplate jdbcTemplate;

    public UserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public User findById(Long id) {
        // JdbcTemplate이 공통 로직 처리 (연결, 예외 변환, 자원 해제)
        // 우리는 SQL과 RowMapper만 제공
        return jdbcTemplate.queryForObject(
            "SELECT * FROM users WHERE id = ?",
            new Object[]{id},
            (rs, rowNum) -> new User(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("email")
            )
        );
    }
}
```

## 4) 패턴 비교 및 선택 가이드

### 4-1) 언제 어떤 패턴을 쓸까?

**Factory 패턴:**
- ✅ 객체 생성이 복잡할 때
- ✅ 타입에 따라 다른 객체를 생성해야 할 때
- ✅ 객체 생성 로직을 한 곳에 모으고 싶을 때

**Strategy 패턴:**
- ✅ 알고리즘을 런타임에 교체해야 할 때
- ✅ if-else/switch로 분기하는 로직이 많을 때
- ✅ 같은 인터페이스로 다양한 구현체를 사용할 때

**Template Method 패턴:**
- ✅ 알고리즘의 뼈대는 같고 세부 단계만 다를 때
- ✅ 공통 로직을 재사용하고 싶을 때
- ✅ 상속 관계가 자연스러울 때

### 4-2) 실전 조합 예제

```java
// Factory + Strategy 조합
public class DiscountFactory {
    public static DiscountStrategy createStrategy(String customerType) {
        switch (customerType) {
            case "VIP":
                return new VipDiscountStrategy();
            case "REGULAR":
                return new RegularDiscountStrategy();
            default:
                return new NoDiscountStrategy();
        }
    }
}

@Service
public class OrderService {
    public int calculateFinalAmount(Order order, String customerType) {
        // Factory로 Strategy 생성
        DiscountStrategy strategy = DiscountFactory.createStrategy(customerType);
        int discount = strategy.calculate(order.getAmount());
        return order.getAmount() - discount;
    }
}
```

## 5) 자주 하는 실수

### ❌ 실수 1: 과도한 패턴 사용

```java
// ❌ 간단한 로직에 불필요한 패턴
public interface AdderStrategy {
    int add(int a, int b);
}

public class SimpleAdderStrategy implements AdderStrategy {
    @Override
    public int add(int a, int b) {
        return a + b;  // 이런 건 패턴 필요 없음!
    }
}

// ✅ 그냥 메서드로 충분
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
```

### ❌ 실수 2: Factory에서 모든 책임 떠안기

```java
// ❌ Factory가 너무 많은 일을 함
public class PaymentFactory {
    public static Payment createPayment(String type, int amount, User user) {
        Payment payment = switch (type) {
            case "CARD" -> new CardPayment();
            case "BANK" -> new BankTransferPayment();
            default -> throw new IllegalArgumentException();
        };

        payment.setAmount(amount);
        payment.setUser(user);
        payment.validate();  // Factory가 검증까지?
        payment.log();       // 로깅까지?
        return payment;
    }
}

// ✅ Factory는 생성만
public class PaymentFactory {
    public static Payment createPayment(String type) {
        return switch (type) {
            case "CARD" -> new CardPayment();
            case "BANK" -> new BankTransferPayment();
            default -> throw new IllegalArgumentException();
        };
    }
}
```

## 연습 (추천)

1. **Factory 패턴 연습**
   - 여러 타입의 파일 파서 (CSV/JSON/XML) Factory 구현
   - Spring Bean으로 등록해보기

2. **Strategy 패턴 연습**
   - 배송비 계산 전략 (일반/특급/새벽배송)
   - 런타임에 전략 교체해보기

3. **Template Method 패턴 연습**
   - 데이터 ETL 프로세스 (추출/변환/적재)
   - Hook 메서드로 선택적 단계 추가

## 요약: 스스로 점검할 것

- Factory, Strategy, Template Method의 차이를 설명할 수 있다
- 각 패턴의 사용 시점을 판단할 수 있다
- 실무 코드에서 패턴을 식별할 수 있다
- 과도한 패턴 사용을 피할 수 있다
- Spring이 사용하는 패턴을 이해한다

## 다음 단계

- REST API 설계: `/learning/deep-dive/deep-dive-rest-api-design/`
- Spring IoC/DI: `/learning/deep-dive/deep-dive-spring-ioc-di/`
- SOLID 원칙: `/learning/deep-dive/deep-dive-oop-solid-principles/`
