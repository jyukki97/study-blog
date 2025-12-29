---
title: "클린 코드: 읽기 좋은 코드 작성법"
study_order: 22
date: 2025-12-28
topic: "Code Quality"
topic_icon: "✨"
topic_description: "네이밍, 함수 설계, 주석, 리팩토링 원칙"
tags: ["Clean Code", "Refactoring", "Best Practices", "Code Quality"]
categories: ["Foundation"]
draft: false
module: "foundation"
quizzes:
  - question: "변수나 메서드의 이름을 지을 때 가장 중요한 원칙은?"
    options:
      - "가장 짧게 짓는 것"
      - "의도와 맥락을 명확하게 드러내는 것"
      - "모든 변수에 데이터 타입(접두어)을 붙이는 것"
      - "a, b, c 순서대로 짓는 것"
    answer: 1
    explanation: "코드는 읽는 시간이 쓰는 시간보다 훨씬 깁니다. 이름만 보고도 '무엇을 하는지, 왜 존재하는지' 알 수 있어야 합니다."

  - question: "클린 코드에서 권장하는 '함수(메서드)의 크기'와 책임에 대한 설명으로 옳은 것은?"
    options:
      - "함수는 길수록 많은 정보를 담아 좋다."
      - "가능한 작게 만들고, 한 가지 일만 단일 책임으로 수행해야 한다."
      - "모든 로직을 하나의 main 함수에 넣는 것이 효율적이다."
      - "함수 인자는 많을수록 재사용성이 높아진다."
    answer: 1
    explanation: "함수가 작고 한 가지 일만 할 때 이해하기 쉽고, 테스트하기 쉬우며, 재사용성이 높아집니다."

  - question: "다음 중 '나쁜 주석(Bad Comment)'에 해당하는 것은?"
    options:
      - "저작권 정보 및 라이선스 표시"
      - "TODO 주석"
      - "코드로 충분히 설명할 수 있는데 중복 서술한 주석"
      - "API의 중요 제약사항이나 경고"
    answer: 2
    explanation: "주석은 코드가 표현하지 못하는 '왜(Why)'를 설명해야 합니다. 코드 자체를 설명하는 주석은 관리가 안 되어 거짓말을 하게 될 위험이 큽니다."

  - question: "함수의 인자(Parameter) 개수에 대한 클린 코드의 조언으로 가장 적절한 것은?"
    options:
      - "인자는 많을수록 유연하다."
      - "인자 개수는 0~2개가 이상적이며, 3개 이상이면 객체로 묶는 것을 고려한다."
      - "인자의 순서는 중요하지 않다."
      - "모든 인자를 문자열(String)로 받는 것이 좋다."
    answer: 1
    explanation: "인자가 많으면 함수를 이해하고 호출하기 어려워집니다. 관련된 데이터는 DTO나 별도 클래스로 묶어 전달하는 것이 좋습니다."

  - question: "코드에서 매직 넘버(Magic Number, 예: if (status == 3))를 발견했을 때 가장 좋은 리팩토링 방법은?"
    options:
      - "주석으로 3이 뭔지 설명한다."
      - "그냥 둔다."
      - "의미 있는 이름을 가진 상수(Constant)나 Enum으로 대체한다."
      - "3 대신 4로 바꾼다."
    answer: 2
    explanation: "숫자 3이 무엇을 의미하는지(`ORDER_SHIPPED` 등) 상수로 정의하면 가독성이 높아지고 유지보수가 쉬워집니다."

  - question: "단일 책임 원칙(SRP)을 위배하는 클래스의 특징은?"
    options:
      - "클래스가 변경되어야 할 이유가 하나뿐이다."
      - "클래스 이름이 명확하다."
      - "하나의 클래스가 비즈니스 로직, 데이터베이스 접근, UI 출력 등 너무 많은 일을 한다."
      - "응집도가 높다."
    answer: 2
    explanation: "God Class처럼 너무 많은 책임을 가진 클래스는 변경에 취약하고 재사용이 어렵습니다. 책임을 분리해야 합니다."

  - question: "코드를 작성할 때 'DRY 원칙'이 의미하는 것은?"
    options:
      - "Don't Repeat Yourself (중복하지 마라)"
      - "Do Repeat Yourself (반복해라)"
      - "Direct Run Yield (바로 실행해라)"
      - "Database Record Year (DB 기록 연도)"
    answer: 0
    explanation: "같은 로직이 여러 곳에 중복되면 수정 시 실수할 가능성이 커집니다. 중복을 제거하고 추상화해야 합니다."

  - question: "불리언(boolean) 플래그 인자를 사용하는 함수(예: render(true))가 좋지 않은 이유는?"
    options:
      - "메모리를 많이 차지해서"
      - "함수가 한 번에 두 가지 일(true일 때, false일 때)을 처리하고 있음을 암시하기 때문에"
      - "컴파일 속도가 느려서"
      - "자바에서는 불리언을 지원하지 않아서"
    answer: 1
    explanation: "플래그 인자는 함수 내부에서 분기 처리를 유발합니다. 두 개의 함수로 분리하는 것이 더 명확합니다."
---

## 이 글에서 얻는 것

- **좋은 네이밍**으로 코드의 의도를 명확히 전달합니다
- **함수 설계 원칙**으로 단일 책임을 지키는 함수를 작성합니다
- **코드 스멜**을 인식하고 리팩토링합니다

---

## 네이밍

### 의도를 드러내는 이름

```java
// ❌ 의미 없는 이름
int d;  // 경과 시간 (일)
List<int[]> list1;

// ✅ 의도가 명확한 이름
int elapsedTimeInDays;
List<Cell> flaggedCells;
```

### 맥락 있는 이름

```java
// ❌ 맥락 없음
private void printGuessStatistics(char candidate, int count) {
    String number;
    String verb;
    String pluralModifier;
    // ...
}

// ✅ 클래스로 맥락 제공
public class GuessStatisticsMessage {
    private String number;
    private String verb;
    private String pluralModifier;
    
    public String make(char candidate, int count) { ... }
}
```

### 네이밍 규칙

| 대상 | 규칙 | 예시 |
|------|------|------|
| 클래스 | 명사/명사구 | `Customer`, `OrderProcessor` |
| 메서드 | 동사/동사구 | `save()`, `deletePage()` |
| 불리언 | is/has/can | `isValid`, `hasPermission` |
| 컬렉션 | 복수형 | `users`, `orderItems` |

### ❌ 피해야 할 패턴

```java
// ❌ 불용어
getProductInfo()  // Info 불필요
theProductData   // the 불필요
aUser            // a 불필요

// ❌ 인코딩
m_name           // 헝가리안 표기법
strName          // 타입 접두사
IShapeFactory    // 인터페이스 접두사 I

// ❌ 약어
genymdhms()      // 무슨 의미?

// ✅ 개선
getName()
productData
user
name
ShapeFactory
generateTimestamp()
```

---

## 함수

### 작게 만들기

```java
// ❌ 너무 긴 함수
public void processOrder(Order order) {
    // 검증 (20줄)
    if (order.getItems().isEmpty()) { ... }
    if (order.getCustomer() == null) { ... }
    // ... 더 많은 검증
    
    // 재고 확인 (30줄)
    for (OrderItem item : order.getItems()) { ... }
    
    // 결제 처리 (40줄)
    Payment payment = new Payment();
    // ...
    
    // 알림 발송 (20줄)
    // ...
}

// ✅ 작은 함수로 분리
public void processOrder(Order order) {
    validateOrder(order);
    checkInventory(order);
    processPayment(order);
    sendNotification(order);
}

private void validateOrder(Order order) { ... }
private void checkInventory(Order order) { ... }
private void processPayment(Order order) { ... }
private void sendNotification(Order order) { ... }
```

### 한 가지만 하기

```java
// ❌ 여러 가지 일
public void emailClients(List<Client> clients) {
    for (Client client : clients) {
        // 1. 이메일 유효성 검사
        if (isValidEmail(client.getEmail())) {
            // 2. 활성 사용자 필터
            if (client.isActive()) {
                // 3. 이메일 발송
                sendEmail(client);
            }
        }
    }
}

// ✅ 한 가지 일만
public void emailActiveClientsWithValidEmail(List<Client> clients) {
    clients.stream()
        .filter(client -> isValidEmail(client.getEmail()))
        .filter(Client::isActive)
        .forEach(this::sendEmail);
}
```

### 인자 개수 줄이기

```java
// ❌ 너무 많은 인자
public Order createOrder(String userId, String productId, 
    int quantity, String shippingAddress, String paymentMethod,
    boolean giftWrap, String couponCode, String memo) { ... }

// ✅ 객체로 묶기
public Order createOrder(CreateOrderRequest request) { ... }

@Getter @Builder
public class CreateOrderRequest {
    private String userId;
    private String productId;
    private int quantity;
    private ShippingInfo shippingInfo;
    private PaymentInfo paymentInfo;
    private GiftOptions giftOptions;
}
```

### 플래그 인자 피하기

```java
// ❌ 불리언 플래그
public void render(boolean isSuite) {
    if (isSuite) {
        renderForSuite();
    } else {
        renderForSingle();
    }
}

// ✅ 별도 함수로 분리
public void renderForSuite() { ... }
public void renderForSingle() { ... }
```

---

## 주석

### 좋은 주석

```java
// ✅ 법적 주석
// Copyright (C) 2024 by Company. All rights reserved.

// ✅ 의도 설명
// 스레드 안전성을 위해 새 리스트 반환
return new ArrayList<>(items);

// ✅ 결과 경고
// 이 메서드는 시간이 오래 걸릴 수 있음 (최대 5분)
public void heavyProcess() { ... }

// ✅ TODO
// TODO: 다음 릴리스에서 deprecated API 제거 예정
```

### 나쁜 주석

```java
// ❌ 주절거리는 주석
// 기본 생성자
public Order() { }

// ❌ 이력 기록 (VCS 사용)
// 2024-01-15: John이 버그 수정
// 2024-01-20: Jane이 기능 추가

// ❌ 코드 반복
// 사용자를 저장한다
userRepository.save(user);

// ❌ 주석 처리된 코드
// if (isLegacy) {
//     oldMethod();
// }

// ❌ 함수 헤더
/**
 * @param userId 사용자 ID
 * @param email 이메일
 * @return User 객체
 */
public User findUser(String userId, String email) { ... }
// → 이름으로 충분히 설명됨
```

### 주석 대신 코드로

```java
// ❌ 주석으로 설명
// 직원에게 복지 혜택을 받을 자격이 있는지 검사
if ((employee.flags & HOURLY_FLAG) != 0 
    && employee.age > 65) { ... }

// ✅ 코드로 설명
if (employee.isEligibleForBenefits()) { ... }

// Employee 클래스 내부
public boolean isEligibleForBenefits() {
    return isHourly() && isRetirementAge();
}
```

---

## 코드 스멜과 리팩토링

### 긴 메서드 → 추출

```java
// ❌ 긴 메서드
public void printOwing() {
    printBanner();
    
    // 미결제 금액 계산
    double outstanding = 0.0;
    for (Order order : orders) {
        outstanding += order.getAmount();
    }
    
    // 세부사항 출력
    System.out.println("name: " + name);
    System.out.println("amount: " + outstanding);
}

// ✅ 메서드 추출
public void printOwing() {
    printBanner();
    double outstanding = calculateOutstanding();
    printDetails(outstanding);
}

private double calculateOutstanding() {
    return orders.stream()
        .mapToDouble(Order::getAmount)
        .sum();
}

private void printDetails(double outstanding) {
    System.out.println("name: " + name);
    System.out.println("amount: " + outstanding);
}
```

### 조건문 간소화

```java
// ❌ 복잡한 조건
if (date.before(SUMMER_START) || date.after(SUMMER_END)) {
    charge = quantity * winterRate + winterServiceCharge;
} else {
    charge = quantity * summerRate;
}

// ✅ 메서드 추출 + 명확한 의도
if (isSummer(date)) {
    charge = summerCharge(quantity);
} else {
    charge = winterCharge(quantity);
}

private boolean isSummer(Date date) {
    return !date.before(SUMMER_START) && !date.after(SUMMER_END);
}
```

### Null 처리

```java
// ❌ Null 반환
public List<Employee> getEmployees() {
    if (employees == null) {
        return null;  // 호출자가 null 체크 필요
    }
    return employees;
}

// ✅ 빈 컬렉션 반환
public List<Employee> getEmployees() {
    if (employees == null) {
        return Collections.emptyList();
    }
    return employees;
}

// ✅ Optional 사용
public Optional<Employee> findById(String id) {
    return Optional.ofNullable(employeeMap.get(id));
}
```

---

## SOLID 요약

### 단일 책임 원칙 (SRP)

```java
// ❌ 여러 책임
public class Employee {
    public void calculatePay() { ... }
    public void reportHours() { ... }
    public void save() { ... }
}

// ✅ 책임 분리
public class Employee { ... }
public class PayCalculator { ... }
public class HourReporter { ... }
public class EmployeeRepository { ... }
```

### 개방-폐쇄 원칙 (OCP)

```java
// ❌ 수정에 열려 있음
public double calculateArea(Shape shape) {
    if (shape instanceof Rectangle) {
        return ((Rectangle) shape).width * ((Rectangle) shape).height;
    } else if (shape instanceof Circle) {
        return Math.PI * ((Circle) shape).radius * ((Circle) shape).radius;
    }
    // 새 도형 추가 시 메서드 수정 필요
}

// ✅ 확장에 열려 있음
public interface Shape {
    double area();
}

public double calculateArea(Shape shape) {
    return shape.area();  // 새 도형 추가해도 수정 불필요
}
```

---

## 요약

### 클린 코드 체크리스트

| 항목 | 기준 |
|------|------|
| 네이밍 | 의도가 명확한가? |
| 함수 크기 | 20줄 이하인가? |
| 함수 인자 | 3개 이하인가? |
| 주석 | 코드로 설명 불가한 것만? |
| 중복 | DRY 원칙 지켰나? |

### 핵심 원칙

1. **의도를 드러내라**: 이름으로 목적 표현
2. **작게 만들라**: 한 함수 = 한 가지 일
3. **중복을 제거하라**: DRY (Don't Repeat Yourself)
4. **추상화 수준 맞추라**: 함수 내 일관된 추상화

---

## 🔗 Related Deep Dive

- **[디자인 패턴](/learning/deep-dive/deep-dive-design-patterns-essentials/)**: 검증된 설계 해결책.
- **[테스트 전략](/learning/deep-dive/deep-dive-testing-strategy/)**: 리팩토링을 지탱하는 테스트.
