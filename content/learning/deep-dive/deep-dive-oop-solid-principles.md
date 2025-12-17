---
title: "객체지향 설계 원칙 SOLID: 실무 관점으로 이해하기"
date: 2025-12-16
draft: false
topic: "OOP"
tags: ["OOP", "SOLID", "Design Principles", "Clean Code", "Architecture"]
categories: ["Backend Deep Dive"]
description: "SOLID 5가지 원칙(SRP/OCP/LSP/ISP/DIP)을 실전 코드 예제로 이해하고, 좋은 설계와 나쁜 설계를 구분하는 감각 기르기"
module: "foundation"
study_order: 22
---

## 이 글에서 얻는 것

- **SOLID 5가지 원칙**의 핵심 개념을 실전 예제로 이해합니다.
- **좋은 설계 vs 나쁜 설계**를 구분하고, 리팩터링 방향을 잡을 수 있습니다.
- **변경에 강한 코드**를 작성하는 기준을 세울 수 있습니다.
- SOLID가 "이론"이 아니라 "실무 문제 해결 도구"임을 체감합니다.

## 0) SOLID는 "변경에 강한 코드"를 만드는 5가지 원칙

SOLID는 Robert C. Martin(Uncle Bob)이 제시한 객체지향 설계 5원칙의 앞글자입니다.

```
S - Single Responsibility Principle (단일 책임 원칙)
O - Open/Closed Principle (개방-폐쇄 원칙)
L - Liskov Substitution Principle (리스코프 치환 원칙)
I - Interface Segregation Principle (인터페이스 분리 원칙)
D - Dependency Inversion Principle (의존성 역전 원칙)
```

**왜 SOLID인가?**
- 변경 시 영향 범위 최소화
- 테스트 가능한 코드
- 재사용 가능한 모듈
- 확장이 쉬운 구조

## 1) SRP: Single Responsibility Principle (단일 책임 원칙)

**"하나의 클래스는 하나의 책임만 가져야 한다"**

### ❌ 나쁜 예: 여러 책임을 가진 클래스

```java
public class User {
    private String name;
    private String email;

    // 책임 1: 유저 데이터 관리
    public void setName(String name) {
        this.name = name;
    }

    // 책임 2: 이메일 발송
    public void sendEmail(String message) {
        // SMTP 연결
        // 이메일 발송 로직
        System.out.println("Sending email to " + email);
    }

    // 책임 3: 데이터베이스 저장
    public void save() {
        // DB 연결
        // SQL 실행
        System.out.println("Saving user to database");
    }

    // 책임 4: 비밀번호 암호화
    public String encryptPassword(String password) {
        // 암호화 로직
        return "encrypted_" + password;
    }
}
```

**문제점:**
- 이메일 발송 방식 변경 → User 클래스 수정
- DB 변경 → User 클래스 수정
- 암호화 알고리즘 변경 → User 클래스 수정
- 변경 이유가 4가지나 됨!

### ✅ 좋은 예: 책임 분리

```java
// 책임 1: 유저 데이터만 관리
public class User {
    private String name;
    private String email;

    public String getName() { return name; }
    public String getEmail() { return email; }
}

// 책임 2: 이메일 발송
public class EmailService {
    public void sendEmail(String to, String message) {
        System.out.println("Sending email to " + to);
    }
}

// 책임 3: 데이터베이스 저장
public class UserRepository {
    public void save(User user) {
        System.out.println("Saving user to database");
    }
}

// 책임 4: 비밀번호 암호화
public class PasswordEncryptor {
    public String encrypt(String password) {
        return "encrypted_" + password;
    }
}

// 사용
User user = new User("Alice", "alice@example.com");
new UserRepository().save(user);
new EmailService().sendEmail(user.getEmail(), "Welcome!");
```

**판단 기준:**
- "이 클래스가 변경되는 이유가 여러 개인가?"
- "이 클래스의 메서드들이 서로 다른 목적을 가지는가?"

## 2) OCP: Open/Closed Principle (개방-폐쇄 원칙)

**"확장에는 열려 있고, 수정에는 닫혀 있어야 한다"**

### ❌ 나쁜 예: 새 기능 추가 시 기존 코드 수정

```java
public class PaymentService {
    public void processPayment(String type, int amount) {
        if (type.equals("CARD")) {
            System.out.println("Processing card payment: " + amount);
            // 카드 결제 로직
        } else if (type.equals("BANK")) {
            System.out.println("Processing bank transfer: " + amount);
            // 계좌이체 로직
        } else if (type.equals("PAYPAL")) {  // 새 결제 수단 추가 시 수정!
            System.out.println("Processing PayPal payment: " + amount);
        }
    }
}
```

**문제점:**
- 새 결제 수단 추가 시 기존 코드 수정 필요
- if-else가 계속 늘어남
- 테스트 범위가 계속 확장됨

### ✅ 좋은 예: 인터페이스로 확장 가능하게

```java
// 인터페이스 정의
public interface PaymentMethod {
    void processPayment(int amount);
}

// 구현체들 (확장)
public class CardPayment implements PaymentMethod {
    @Override
    public void processPayment(int amount) {
        System.out.println("Processing card payment: " + amount);
    }
}

public class BankTransferPayment implements PaymentMethod {
    @Override
    public void processPayment(int amount) {
        System.out.println("Processing bank transfer: " + amount);
    }
}

// 새 결제 수단 추가 (기존 코드 수정 없음!)
public class PayPalPayment implements PaymentMethod {
    @Override
    public void processPayment(int amount) {
        System.out.println("Processing PayPal payment: " + amount);
    }
}

// 사용
public class PaymentService {
    public void processPayment(PaymentMethod method, int amount) {
        method.processPayment(amount);  // 다형성 활용
    }
}

// 실행
PaymentMethod card = new CardPayment();
PaymentMethod paypal = new PayPalPayment();
new PaymentService().processPayment(card, 10000);
new PaymentService().processPayment(paypal, 20000);
```

**핵심:**
- 새 기능 추가 = 새 클래스 추가 (기존 코드 수정 X)
- 인터페이스/추상 클래스로 확장 포인트 제공

## 3) LSP: Liskov Substitution Principle (리스코프 치환 원칙)

**"부모 타입을 자식 타입으로 치환해도 동작이 깨지지 않아야 한다"**

### ❌ 나쁜 예: 치환 시 동작이 깨짐

```java
public class Rectangle {
    protected int width;
    protected int height;

    public void setWidth(int width) { this.width = width; }
    public void setHeight(int height) { this.height = height; }
    public int getArea() { return width * height; }
}

public class Square extends Rectangle {
    @Override
    public void setWidth(int width) {
        this.width = width;
        this.height = width;  // 정사각형은 너비=높이
    }

    @Override
    public void setHeight(int height) {
        this.width = height;
        this.height = height;
    }
}

// 문제 발생!
Rectangle rect = new Square();
rect.setWidth(5);
rect.setHeight(10);
System.out.println(rect.getArea());  // 기대: 50, 실제: 100 (10*10)
```

**문제점:**
- Rectangle을 Square로 치환 시 동작이 달라짐
- "is-a" 관계가 논리적으로 성립해도 코드상으로는 위반

### ✅ 좋은 예: 상속 대신 별도 타입

```java
public interface Shape {
    int getArea();
}

public class Rectangle implements Shape {
    private final int width;
    private final int height;

    public Rectangle(int width, int height) {
        this.width = width;
        this.height = height;
    }

    @Override
    public int getArea() {
        return width * height;
    }
}

public class Square implements Shape {
    private final int side;

    public Square(int side) {
        this.side = side;
    }

    @Override
    public int getArea() {
        return side * side;
    }
}

// 사용
Shape rect = new Rectangle(5, 10);
Shape square = new Square(5);
System.out.println(rect.getArea());    // 50
System.out.println(square.getArea());  // 25
```

**판단 기준:**
- 부모 메서드의 계약(contract)을 자식이 위반하는가?
- 자식으로 치환 시 예외 발생이나 예상 밖의 동작이 생기는가?

## 4) ISP: Interface Segregation Principle (인터페이스 분리 원칙)

**"클라이언트는 사용하지 않는 인터페이스에 의존하지 않아야 한다"**

### ❌ 나쁜 예: 비대한 인터페이스

```java
public interface Worker {
    void work();
    void eat();
    void sleep();
}

// 로봇은 eat, sleep이 필요 없음!
public class Robot implements Worker {
    @Override
    public void work() {
        System.out.println("Robot working");
    }

    @Override
    public void eat() {
        throw new UnsupportedOperationException("Robot doesn't eat");
    }

    @Override
    public void sleep() {
        throw new UnsupportedOperationException("Robot doesn't sleep");
    }
}
```

**문제점:**
- Robot은 eat, sleep을 구현할 필요가 없는데 강제됨
- 인터페이스가 너무 많은 책임을 가짐

### ✅ 좋은 예: 인터페이스 분리

```java
public interface Workable {
    void work();
}

public interface Eatable {
    void eat();
}

public interface Sleepable {
    void sleep();
}

// 사람은 모든 인터페이스 구현
public class Human implements Workable, Eatable, Sleepable {
    @Override
    public void work() {
        System.out.println("Human working");
    }

    @Override
    public void eat() {
        System.out.println("Human eating");
    }

    @Override
    public void sleep() {
        System.out.println("Human sleeping");
    }
}

// 로봇은 Workable만 구현
public class Robot implements Workable {
    @Override
    public void work() {
        System.out.println("Robot working");
    }
}
```

**핵심:**
- 인터페이스를 작고 구체적으로 분리
- "역할"별로 인터페이스 구성

## 5) DIP: Dependency Inversion Principle (의존성 역전 원칙)

**"구체화가 아닌 추상화에 의존해야 한다"**

### ❌ 나쁜 예: 구체 클래스에 의존

```java
public class MySQLDatabase {
    public void save(String data) {
        System.out.println("Saving to MySQL: " + data);
    }
}

public class UserService {
    private MySQLDatabase database = new MySQLDatabase();  // 구체 클래스에 의존!

    public void saveUser(String user) {
        database.save(user);
    }
}
```

**문제점:**
- MySQL에서 PostgreSQL로 변경 시 UserService 수정 필요
- 테스트 시 Mock으로 교체 불가
- 강한 결합

### ✅ 좋은 예: 인터페이스에 의존

```java
// 추상화 (인터페이스)
public interface Database {
    void save(String data);
}

// 구현체 1
public class MySQLDatabase implements Database {
    @Override
    public void save(String data) {
        System.out.println("Saving to MySQL: " + data);
    }
}

// 구현체 2
public class PostgreSQLDatabase implements Database {
    @Override
    public void save(String data) {
        System.out.println("Saving to PostgreSQL: " + data);
    }
}

// 추상화에 의존
public class UserService {
    private final Database database;

    public UserService(Database database) {  // 의존성 주입
        this.database = database;
    }

    public void saveUser(String user) {
        database.save(user);
    }
}

// 사용
Database mysql = new MySQLDatabase();
UserService service = new UserService(mysql);
service.saveUser("Alice");

// DB 변경도 쉬움
Database postgres = new PostgreSQLDatabase();
UserService service2 = new UserService(postgres);
service2.saveUser("Bob");
```

**핵심:**
- 구체 클래스 대신 인터페이스/추상 클래스에 의존
- 의존성 주입(DI)으로 결합도 낮춤
- Spring의 핵심 원리!

## 6) SOLID 종합 예제

### 시나리오: 주문 처리 시스템

```java
// ========== SRP: 각 클래스는 하나의 책임만 ==========
public class Order {
    private String id;
    private int totalAmount;
    // 주문 데이터만 관리
}

// ========== OCP: 확장에 열림, 수정에 닫힘 ==========
public interface PaymentMethod {
    void pay(int amount);
}

public class CreditCardPayment implements PaymentMethod {
    @Override
    public void pay(int amount) {
        System.out.println("Paid " + amount + " via credit card");
    }
}

// ========== ISP: 필요한 인터페이스만 의존 ==========
public interface OrderRepository {
    void save(Order order);
    Order findById(String id);
}

public interface OrderNotifier {
    void notifyCustomer(Order order);
}

// ========== DIP: 추상화에 의존 ==========
public class OrderService {
    private final OrderRepository repository;
    private final OrderNotifier notifier;
    private final PaymentMethod paymentMethod;

    // 모두 인터페이스에 의존
    public OrderService(OrderRepository repository,
                       OrderNotifier notifier,
                       PaymentMethod paymentMethod) {
        this.repository = repository;
        this.notifier = notifier;
        this.paymentMethod = paymentMethod;
    }

    public void processOrder(Order order) {
        paymentMethod.pay(order.getTotalAmount());
        repository.save(order);
        notifier.notifyCustomer(order);
    }
}

// ========== 사용 (Spring에서는 자동 주입) ==========
OrderRepository repository = new JpaOrderRepository();
OrderNotifier notifier = new EmailNotifier();
PaymentMethod payment = new CreditCardPayment();

OrderService service = new OrderService(repository, notifier, payment);
service.processOrder(new Order("ORDER-1", 10000));
```

## 7) 실전 체크리스트

### SRP 체크
- [ ] 이 클래스가 변경되는 이유가 1가지뿐인가?
- [ ] 메서드들이 같은 목적을 가지는가?

### OCP 체크
- [ ] 새 기능 추가 시 기존 코드 수정이 필요한가?
- [ ] if-else/switch가 계속 늘어나는가?

### LSP 체크
- [ ] 부모 타입을 자식 타입으로 치환해도 동작이 같은가?
- [ ] 자식이 부모의 계약을 위반하는가?

### ISP 체크
- [ ] 인터페이스에 사용하지 않는 메서드가 있는가?
- [ ] UnsupportedOperationException을 던지는가?

### DIP 체크
- [ ] 구체 클래스를 직접 생성하는가? (new SomeClass())
- [ ] 테스트 시 Mock으로 교체 가능한가?

## 연습 (추천)

1. **기존 코드 리팩터링**
   - SRP 위반 사례 찾기 (여러 책임을 가진 클래스)
   - OCP 위반 사례 찾기 (if-else로 타입 분기)

2. **SOLID 적용 연습**
   - 간단한 주문 시스템 설계
   - 결제/알림/저장 로직을 SOLID 원칙으로 분리

3. **Spring 코드 분석**
   - Spring이 DIP를 어떻게 구현하는지 확인
   - @Service, @Repository의 역할 분리 (SRP)

## 요약: 스스로 점검할 것

- SOLID 5가지 원칙을 각각 설명할 수 있다
- SRP: 하나의 클래스는 하나의 책임만
- OCP: 확장에 열림, 수정에 닫힘
- LSP: 부모를 자식으로 치환 가능
- ISP: 인터페이스를 작게 분리
- DIP: 구체화가 아닌 추상화에 의존
- 실무 코드에서 SOLID 위반 사례를 찾을 수 있다

## 다음 단계

- 디자인 패턴 필수: `/learning/deep-dive/deep-dive-design-patterns-essentials/`
- Spring IoC/DI: `/learning/deep-dive/deep-dive-spring-ioc-di/`
- 클린 코드 실전: 리팩터링 연습
