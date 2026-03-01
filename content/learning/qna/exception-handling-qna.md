---
title: "예외 처리 (Part 1: 예외 기초와 전략)"
study_order: 708
date: 2025-12-01
topic: "Spring"
tags: ["예외처리", "Spring", "ControllerAdvice", "에러처리", "GlobalException"]
categories: ["Spring"]
series: ["핵심 개념 Q&A"]
description: "예외 기초와 전략, Spring 예외 처리 패턴 Q&A"
series_order: 18
draft: false
module: "qna"
---

## Q1. @ControllerAdvice와 @ExceptionHandler를 사용한 글로벌 예외 처리를 설명해주세요.

### 답변

**@ControllerAdvice**는 Spring에서 모든 Controller에 대한 전역적인 예외 처리를 담당하는 컴포넌트입니다. **@ExceptionHandler**와 함께 사용하여 중복 코드를 제거하고 일관된 에러 응답을 제공합니다.

#### 기본 구조

```java
@RestControllerAdvice  // @ControllerAdvice + @ResponseBody
@Slf4j
public class GlobalExceptionHandler {

    // 1. 특정 예외 처리
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        log.error("User not found: {}", ex.getMessage());

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("USER_NOT_FOUND")
            .message(ex.getMessage())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(errorResponse);
    }

    // 2. 여러 예외를 동일하게 처리
    @ExceptionHandler({
        IllegalArgumentException.class,
        IllegalStateException.class
    })
    public ResponseEntity<ErrorResponse> handleBadRequest(RuntimeException ex) {
        log.error("Bad request: {}", ex.getMessage());

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("BAD_REQUEST")
            .message(ex.getMessage())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(errorResponse);
    }

    // 3. Validation 예외 처리
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException ex) {

        Map<String, String> errors = new HashMap<>();

        ex.getBindingResult().getFieldErrors().forEach(error -> {
            errors.put(error.getField(), error.getDefaultMessage());
        });

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("VALIDATION_FAILED")
            .message("입력값 검증 실패")
            .errors(errors)
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(errorResponse);
    }

    // 4. 모든 예외에 대한 Fallback
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleAllExceptions(Exception ex) {
        log.error("Unexpected error occurred", ex);

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("INTERNAL_SERVER_ERROR")
            .message("서버 내부 오류가 발생했습니다")
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(errorResponse);
    }
}
```

#### ErrorResponse 표준 구조

```java
@Getter
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)  // null 필드 제외
public class ErrorResponse {

    private String code;              // 에러 코드 (예: USER_NOT_FOUND)
    private String message;           // 사용자에게 보여줄 메시지
    private Map<String, String> errors;  // Validation 에러 상세
    private String path;              // 요청 경로
    private LocalDateTime timestamp;  // 발생 시간

    // 추가 정보 (개발 환경에서만)
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    private String debugMessage;      // 상세 에러 메시지 (스택 트레이스 등)
}
```

#### 계층별 예외 처리 흐름

```
┌─────────────┐
│ Controller  │  요청 처리
└──────┬──────┘
       │
       │ Exception 발생!
       ▼
┌─────────────────────┐
│ @ExceptionHandler   │  1. 해당 Controller 내 @ExceptionHandler 찾기
│ (Controller 내부)   │
└──────┬──────────────┘
       │ 없으면
       ▼
┌─────────────────────┐
│ @ControllerAdvice   │  2. 글로벌 @ExceptionHandler 찾기
│ GlobalExceptionHandler│
└──────┬──────────────┘
       │ 없으면
       ▼
┌─────────────────────┐
│ Spring 기본 처리     │  3. DefaultHandlerExceptionResolver
│ (Whitelabel Error)  │
└─────────────────────┘
```

### 꼬리 질문 1: @ControllerAdvice의 적용 범위를 제한할 수 있나요?

**가능합니다. 특정 패키지나 어노테이션으로 범위를 제한할 수 있습니다.**

```java
// 1. 특정 패키지에만 적용
@RestControllerAdvice(basePackages = "com.example.api.user")
public class UserExceptionHandler {
    // user 패키지의 Controller에서 발생한 예외만 처리
}

// 2. 특정 Controller에만 적용
@RestControllerAdvice(assignableTypes = {UserController.class, OrderController.class})
public class UserOrderExceptionHandler {
    // UserController, OrderController의 예외만 처리
}

// 3. 특정 어노테이션이 붙은 Controller에만 적용
@RestControllerAdvice(annotations = RestController.class)
public class RestControllerExceptionHandler {
    // @RestController가 붙은 Controller의 예외만 처리
}

// 4. 여러 조건 조합
@RestControllerAdvice(
    basePackages = "com.example.api",
    assignableTypes = AdminController.class
)
public class ApiExceptionHandler {
    // com.example.api 패키지 + AdminController 예외 처리
}
```

**실무 예시: API 버전별 예외 처리**

```java
// V1 API 전용 예외 처리
@RestControllerAdvice(basePackages = "com.example.api.v1")
@Order(1)  // 우선순위 높음
public class ApiV1ExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleUserNotFound(UserNotFoundException ex) {
        // V1 응답 형식: 단순한 Map
        return ResponseEntity.status(404).body(Map.of(
            "error", "User not found",
            "userId", ex.getUserId()
        ));
    }
}

// V2 API 전용 예외 처리
@RestControllerAdvice(basePackages = "com.example.api.v2")
@Order(2)
public class ApiV2ExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        // V2 응답 형식: 표준화된 ErrorResponse
        ErrorResponse response = ErrorResponse.builder()
            .code("USER_NOT_FOUND")
            .message("사용자를 찾을 수 없습니다")
            .details(Map.of("userId", ex.getUserId()))
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
    }
}
```

### 꼬리 질문 2: Controller 내부의 @ExceptionHandler와 @ControllerAdvice의 우선순위는?

**Controller 내부 @ExceptionHandler가 우선순위가 더 높습니다.**

```java
@RestController
@RequestMapping("/users")
public class UserController {

    // ✅ 이 Controller에서 발생한 UserNotFoundException은 여기서 처리
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<String> handleUserNotFound(UserNotFoundException ex) {
        return ResponseEntity.status(404).body("User not found in Controller");
    }

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        throw new UserNotFoundException(id);  // Controller의 @ExceptionHandler 호출
    }
}

@RestControllerAdvice
public class GlobalExceptionHandler {

    // ❌ UserController에서 발생한 UserNotFoundException은 여기까지 오지 않음
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        return ResponseEntity.status(404).body(new ErrorResponse("Global handler"));
    }
}
```

---


---

👉 **[다음 편: 예외 처리 (Part 2: Checked/Unchecked, 실무 패턴)](/learning/qna/exception-handling-qna-part2/)**
