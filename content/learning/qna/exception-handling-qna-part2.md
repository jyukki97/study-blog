---
title: "예외 처리 (Part 2: Checked/Unchecked, 실무 패턴)"
study_order: 708
date: 2025-12-01
topic: "Spring"
tags: ["예외처리", "Spring", "ControllerAdvice", "에러처리", "GlobalException"]
categories: ["Spring"]
series: ["핵심 개념 Q&A"]
description: "Checked/Unchecked 예외 구분, ControllerAdvice 등 실무 패턴 심화 Q&A"
series_order: 18
draft: false
module: "qna"
---

## Q2. Checked Exception과 Unchecked Exception의 차이와 언제 사용해야 하는지 설명해주세요.

### 답변

#### Checked Exception vs Unchecked Exception

| 구분 | Checked Exception | Unchecked Exception |
|------|-------------------|---------------------|
| **상속** | `Exception` 상속 (RuntimeException 제외) | `RuntimeException` 상속 |
| **컴파일 시점 검사** | 필수 처리 (try-catch 또는 throws) | 선택적 처리 |
| **트랜잭션 롤백** | 롤백 안 됨 (@Transactional 기본) | 롤백 됨 |
| **대표 예외** | IOException, SQLException | NullPointerException, IllegalArgumentException |
| **사용 목적** | 복구 가능한 예외 | 프로그래밍 오류 |

#### Checked Exception

**반드시 처리해야 하는 예외 (컴파일 에러)**

```java
// ❌ 컴파일 에러: Unhandled exception
public void readFile(String path) {
    FileReader reader = new FileReader(path);  // IOException (Checked)
}

// ✅ try-catch로 처리
public void readFile(String path) {
    try {
        FileReader reader = new FileReader(path);
        // 파일 읽기
    } catch (IOException e) {
        log.error("Failed to read file: {}", path, e);
        throw new FileReadException("파일을 읽을 수 없습니다", e);
    }
}

// ✅ 또는 throws로 위임
public void readFile(String path) throws IOException {
    FileReader reader = new FileReader(path);
}
```

**언제 사용?**
- **복구 가능한 상황**: 네트워크 오류, 파일 없음, DB 연결 실패
- **호출자가 처리해야 하는 경우**: API 호출 실패, 외부 시스템 장애

**문제점:**
```java
// Checked Exception의 전파 문제
public void processOrder(Order order) throws SQLException, IOException, RemoteException {
    validateOrder(order);  // throws SQLException
    saveOrder(order);      // throws IOException
    sendNotification(order);  // throws RemoteException
}

// 모든 메서드가 throws를 선언해야 함 → 코드 가독성 저하
```

#### Unchecked Exception

**처리하지 않아도 컴파일되는 예외**

```java
// 컴파일 에러 없음
public void divide(int a, int b) {
    int result = a / b;  // ArithmeticException 발생 가능
}

// 명시적 처리 (선택)
public void divide(int a, int b) {
    if (b == 0) {
        throw new IllegalArgumentException("0으로 나눌 수 없습니다");
    }
    int result = a / b;
}
```

**언제 사용?**
- **프로그래밍 오류**: null 참조, 잘못된 인자, 배열 인덱스 초과
- **복구 불가능한 상황**: OutOfMemoryError, StackOverflowError
- **비즈니스 규칙 위반**: 재고 부족, 권한 없음

#### 실무 권장 사항

**Custom Exception 설계 (Unchecked 권장)**

```java
// ✅ RuntimeException 상속 (Unchecked)
public class BusinessException extends RuntimeException {

    private final ErrorCode errorCode;

    public BusinessException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public BusinessException(ErrorCode errorCode, Throwable cause) {
        super(errorCode.getMessage(), cause);
        this.errorCode = errorCode;
    }
}

// 구체적인 예외 클래스
public class UserNotFoundException extends BusinessException {
    public UserNotFoundException(Long userId) {
        super(ErrorCode.USER_NOT_FOUND);
    }
}

public class InsufficientStockException extends BusinessException {
    public InsufficientStockException(Long productId, int requested, int available) {
        super(ErrorCode.INSUFFICIENT_STOCK);
    }
}

// 사용
@Service
public class OrderService {

    @Transactional
    public Order createOrder(OrderRequest request) {
        User user = userRepository.findById(request.getUserId())
            .orElseThrow(() -> new UserNotFoundException(request.getUserId()));

        Product product = productRepository.findById(request.getProductId())
            .orElseThrow(() -> new ProductNotFoundException(request.getProductId()));

        if (product.getStock() < request.getQuantity()) {
            throw new InsufficientStockException(
                product.getId(),
                request.getQuantity(),
                product.getStock()
            );
        }

        // 주문 생성
        return orderRepository.save(order);
    }
}
```

### 꼬리 질문 1: 왜 Spring에서는 Unchecked Exception을 권장하나요?

**이유 3가지:**

##### 1. 트랜잭션 롤백

```java
@Transactional
public void createUser(UserRequest request) throws Exception {  // Checked
    User user = new User(request.getName());
    userRepository.save(user);

    if (isDuplicate(user.getEmail())) {
        throw new Exception("Email already exists");  // ❌ 롤백 안 됨!
    }
}

// ✅ Unchecked Exception 사용 시 자동 롤백
@Transactional
public void createUser(UserRequest request) {
    User user = new User(request.getName());
    userRepository.save(user);

    if (isDuplicate(user.getEmail())) {
        throw new DuplicateEmailException(user.getEmail());  // ✅ 자동 롤백
    }
}

// Checked Exception을 롤백하려면 명시 필요
@Transactional(rollbackFor = Exception.class)
public void createUser(UserRequest request) throws Exception {
    // ...
}
```

##### 2. 코드 가독성

```java
// ❌ Checked Exception: throws 지옥
public void processOrder(Order order)
    throws UserNotFoundException,
           ProductNotFoundException,
           InsufficientStockException,
           PaymentException,
           NotificationException {
    // ...
}

// ✅ Unchecked Exception: 깔끔한 메서드 시그니처
public void processOrder(Order order) {
    // 예외는 @ControllerAdvice에서 일괄 처리
}
```

##### 3. 람다 표현식 호환

```java
// ❌ Checked Exception은 람다에서 사용 불편
List<User> users = userIds.stream()
    .map(id -> {
        try {
            return userRepository.findById(id)
                .orElseThrow(() -> new Exception("User not found"));  // Checked
        } catch (Exception e) {
            throw new RuntimeException(e);  // 억지로 변환
        }
    })
    .collect(Collectors.toList());

// ✅ Unchecked Exception
List<User> users = userIds.stream()
    .map(id -> userRepository.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id)))  // 깔끔
    .collect(Collectors.toList());
```

### 꼬리 질문 2: Checked Exception을 Unchecked Exception으로 변환하는 패턴은?

```java
// 1. 생성자에 cause 전달
public class FileProcessException extends RuntimeException {
    public FileProcessException(String message, Throwable cause) {
        super(message, cause);
    }
}

public void processFile(String path) {
    try {
        Files.readAllLines(Paths.get(path));  // IOException (Checked)
    } catch (IOException e) {
        throw new FileProcessException("Failed to process file: " + path, e);
    }
}

// 2. 공통 예외 변환 유틸리티
public class ExceptionUtils {

    public static <T> T uncheck(CheckedSupplier<T> supplier) {
        try {
            return supplier.get();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

@FunctionalInterface
public interface CheckedSupplier<T> {
    T get() throws Exception;
}

// 사용
String content = ExceptionUtils.uncheck(() ->
    Files.readString(Paths.get("file.txt"))
);
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: 예외 처리 (Part 1: 예외 기초와 전략)](/learning/qna/exception-handling-qna/)**
