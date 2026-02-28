---
title: "Spring 예외 처리 (Part 1: 동작 원리)"
date: 2025-10-24
draft: false
topic: "Spring"
tags: ["Spring", "Exception Handling", "ControllerAdvice", "Error Response", "REST API"]
categories: ["Backend Deep Dive"]
description: "@ControllerAdvice와 @ExceptionHandler로 전역 예외를 처리하고 일관된 에러 응답 설계"
module: "spring-core"
study_order: 120
---

## 이 글에서 얻는 것

- **@ControllerAdvice**로 전역 예외 처리를 구현할 수 있습니다.
- **@ExceptionHandler**로 예외 타입별로 응답을 구분할 수 있습니다.
- **일관된 에러 응답 포맷**을 설계할 수 있습니다.
- **커스텀 예외**를 만들고 적절히 처리할 수 있습니다.

## 0) 예외 처리는 "사용자 경험"이다

### 문제 상황

**❌ 예외 처리 없이:**
```java
@RestController
public class UserController {

    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        // 예외 발생 시 Spring이 기본 에러 페이지 반환
        return userService.findById(id);  // UserNotFoundException!
    }
}
```

**결과:**
```json
{
  "timestamp": "2025-12-16T10:30:00.000+00:00",
  "status": 500,
  "error": "Internal Server Error",
  "path": "/users/999"
}
```

**문제점:**
- 사용자에게 의미 없는 500 에러
- 어떤 문제인지 알 수 없음
- API마다 에러 형식이 다름
- 로그에 스택 트레이스만 쌓임

### 해결: 전역 예외 처리

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException e) {
        ErrorResponse error = new ErrorResponse(
            "USER_NOT_FOUND",
            e.getMessage(),
            LocalDateTime.now()
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }
}
```

**결과:**
```json
{
  "errorCode": "USER_NOT_FOUND",
  "message": "사용자를 찾을 수 없습니다: ID=999",
  "timestamp": "2025-12-16T10:30:00"
}
```

## 1) @ControllerAdvice와 @RestControllerAdvice

### 1-1) @ControllerAdvice

```java
@ControllerAdvice
public class GlobalExceptionHandler {

    // 모든 컨트롤러의 예외를 처리
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(Exception e) {
        // ...
    }
}
```

**특징:**
- 모든 `@Controller`에 적용
- `@ExceptionHandler`와 함께 사용
- View 이름 반환 가능

### 1-2) @RestControllerAdvice

```java
@RestControllerAdvice  // = @ControllerAdvice + @ResponseBody
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public ErrorResponse handleException(Exception e) {
        // 자동으로 JSON 변환
        return new ErrorResponse(e.getMessage());
    }
}
```

**차이점:**
```
@ControllerAdvice:
- View 이름 반환
- @ResponseBody 필요

@RestControllerAdvice:
- 객체 반환 → 자동 JSON 변환
- REST API에 적합
```

### 1-3) 특정 패키지/컨트롤러에만 적용

```java
// 특정 패키지에만 적용
@RestControllerAdvice(basePackages = "com.myapp.api")
public class ApiExceptionHandler {
    // ...
}

// 특정 컨트롤러에만 적용
@RestControllerAdvice(assignableTypes = {UserController.class, OrderController.class})
public class UserOrderExceptionHandler {
    // ...
}

// 특정 애노테이션이 있는 컨트롤러에만
@RestControllerAdvice(annotations = RestController.class)
public class RestExceptionHandler {
    // ...
}
```

## 2) @ExceptionHandler

### 2-1) 기본 사용

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    // 특정 예외 처리
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException e) {
        ErrorResponse error = ErrorResponse.builder()
            .errorCode("USER_NOT_FOUND")
            .message(e.getMessage())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    // 여러 예외를 동일하게 처리
    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<ErrorResponse> handleBadRequest(RuntimeException e) {
        ErrorResponse error = ErrorResponse.builder()
            .errorCode("BAD_REQUEST")
            .message(e.getMessage())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.badRequest().body(error);
    }

    // 모든 예외 처리 (마지막 방어선)
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(Exception e) {
        log.error("Unexpected error occurred", e);

        ErrorResponse error = ErrorResponse.builder()
            .errorCode("INTERNAL_SERVER_ERROR")
            .message("서버 오류가 발생했습니다.")
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

### 2-2) HttpServletRequest 접근

```java
@ExceptionHandler(UserNotFoundException.class)
public ResponseEntity<ErrorResponse> handleUserNotFound(
        UserNotFoundException e,
        HttpServletRequest request) {

    log.warn("User not found: {} - {}", request.getRequestURI(), e.getMessage());

    ErrorResponse error = ErrorResponse.builder()
        .errorCode("USER_NOT_FOUND")
        .message(e.getMessage())
        .path(request.getRequestURI())
        .timestamp(LocalDateTime.now())
        .build();

    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
}
```


---

👉 **[다음 편: Spring 예외 처리 (Part 2: 에러 응답 설계, 실무)](/learning/deep-dive/deep-dive-spring-exception-handling-part2/)**
