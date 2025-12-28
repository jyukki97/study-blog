---
title: "클린 코드: 읽기 좋은 코드 작성법"
study_order: 109
date: 2025-12-28
topic: "Code Quality"
topic_icon: "✨"
topic_description: "네이밍, 함수 설계, 주석, 리팩토링 원칙"
tags: ["Clean Code", "Refactoring", "Best Practices", "Code Quality"]
categories: ["Foundation"]
draft: false
module: "foundation"
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
