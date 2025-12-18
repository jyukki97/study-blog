---
title: "Spring 전역 예외 처리: @ControllerAdvice로 에러 응답 통일하기"
date: 2025-12-16
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

## 3) 에러 응답 설계

### 3-1) ErrorResponse DTO

```java
@Getter
@Builder
public class ErrorResponse {
    private String errorCode;       // 에러 코드 (고유 식별자)
    private String message;          // 사용자용 메시지
    private LocalDateTime timestamp; // 발생 시각
    private String path;             // 요청 경로

    // 선택적
    private List<FieldError> fieldErrors;  // Validation 에러 상세
}

@Getter
@AllArgsConstructor
public class FieldError {
    private String field;
    private String value;
    private String reason;
}
```

### 3-2) 에러 코드 관리

```java
public enum ErrorCode {
    // 4xx Client Errors
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "U001", "사용자를 찾을 수 없습니다."),
    ORDER_NOT_FOUND(HttpStatus.NOT_FOUND, "O001", "주문을 찾을 수 없습니다."),
    INVALID_INPUT(HttpStatus.BAD_REQUEST, "C001", "입력값이 올바르지 않습니다."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "A001", "인증이 필요합니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "A002", "권한이 없습니다."),

    // 5xx Server Errors
    INTERNAL_SERVER_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "S001", "서버 오류가 발생했습니다."),
    DATABASE_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "S002", "데이터베이스 오류가 발생했습니다.");

    private final HttpStatus status;
    private final String code;
    private final String message;

    ErrorCode(HttpStatus status, String code, String message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
    public String getMessage() { return message; }
}
```

**사용:**
```java
@Getter
public class BusinessException extends RuntimeException {
    private final ErrorCode errorCode;

    public BusinessException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public BusinessException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }
}

// 비즈니스 로직에서
throw new BusinessException(ErrorCode.USER_NOT_FOUND, "사용자 ID: " + userId);
```

## 4) 커스텀 예외 계층

### 4-1) 예외 계층 설계

```java
// 최상위 비즈니스 예외
public abstract class BusinessException extends RuntimeException {
    private final ErrorCode errorCode;

    protected BusinessException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    protected BusinessException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }
}

// 도메인별 예외
public class UserNotFoundException extends BusinessException {
    public UserNotFoundException(Long userId) {
        super(ErrorCode.USER_NOT_FOUND, "사용자를 찾을 수 없습니다: ID=" + userId);
    }
}

public class OrderNotFoundException extends BusinessException {
    public OrderNotFoundException(Long orderId) {
        super(ErrorCode.ORDER_NOT_FOUND, "주문을 찾을 수 없습니다: ID=" + orderId);
    }
}

public class InvalidOrderStateException extends BusinessException {
    public InvalidOrderStateException(String currentState, String expectedState) {
        super(ErrorCode.INVALID_INPUT,
            String.format("주문 상태가 올바르지 않습니다. 현재: %s, 기대: %s", currentState, expectedState));
    }
}
```

### 4-2) 전역 예외 핸들러

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    // 비즈니스 예외 통합 처리
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusinessException(
            BusinessException e,
            HttpServletRequest request) {

        log.warn("Business exception: {} - {}", e.getErrorCode().getCode(), e.getMessage());

        ErrorResponse error = ErrorResponse.builder()
            .errorCode(e.getErrorCode().getCode())
            .message(e.getMessage())
            .path(request.getRequestURI())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(e.getErrorCode().getStatus())
            .body(error);
    }

    // Validation 예외
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException e,
            HttpServletRequest request) {

        List<FieldError> fieldErrors = e.getBindingResult().getFieldErrors().stream()
            .map(error -> new FieldError(
                error.getField(),
                error.getRejectedValue() != null ? error.getRejectedValue().toString() : null,
                error.getDefaultMessage()
            ))
            .collect(Collectors.toList());

        ErrorResponse error = ErrorResponse.builder()
            .errorCode("VALIDATION_FAILED")
            .message("입력값 검증에 실패했습니다.")
            .path(request.getRequestURI())
            .timestamp(LocalDateTime.now())
            .fieldErrors(fieldErrors)
            .build();

        return ResponseEntity.badRequest().body(error);
    }

    // 인증 예외
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDenied(
            AccessDeniedException e,
            HttpServletRequest request) {

        log.warn("Access denied: {}", request.getRequestURI());

        ErrorResponse error = ErrorResponse.builder()
            .errorCode("ACCESS_DENIED")
            .message("접근 권한이 없습니다.")
            .path(request.getRequestURI())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(error);
    }

    // 모든 예외 (마지막 방어선)
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(
            Exception e,
            HttpServletRequest request) {

        log.error("Unexpected error occurred", e);

        ErrorResponse error = ErrorResponse.builder()
            .errorCode("INTERNAL_SERVER_ERROR")
            .message("서버 오류가 발생했습니다.")
            .path(request.getRequestURI())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

## 5) Validation 예외 처리

### 5-1) Bean Validation

```java
@RestController
@RequestMapping("/users")
public class UserController {

    @PostMapping
    public ResponseEntity<User> createUser(@Valid @RequestBody CreateUserRequest request) {
        // @Valid 검증 실패 시 MethodArgumentNotValidException 발생
        User user = userService.createUser(request);
        return ResponseEntity.ok(user);
    }
}

// DTO
@Getter
@Setter
public class CreateUserRequest {
    @NotBlank(message = "이름은 필수입니다.")
    @Size(min = 2, max = 50, message = "이름은 2-50자 사이여야 합니다.")
    private String name;

    @NotBlank(message = "이메일은 필수입니다.")
    @Email(message = "이메일 형식이 올바르지 않습니다.")
    private String email;

    @Min(value = 18, message = "18세 이상이어야 합니다.")
    private Integer age;
}
```

### 5-2) Validation 예외 처리

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ResponseEntity<ErrorResponse> handleValidationException(
        MethodArgumentNotValidException e) {

    List<FieldError> fieldErrors = e.getBindingResult().getFieldErrors().stream()
        .map(error -> new FieldError(
            error.getField(),
            error.getRejectedValue() != null ? error.getRejectedValue().toString() : null,
            error.getDefaultMessage()
        ))
        .collect(Collectors.toList());

    ErrorResponse error = ErrorResponse.builder()
        .errorCode("VALIDATION_FAILED")
        .message("입력값 검증에 실패했습니다.")
        .timestamp(LocalDateTime.now())
        .fieldErrors(fieldErrors)
        .build();

    return ResponseEntity.badRequest().body(error);
}
```

**응답:**
```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "입력값 검증에 실패했습니다.",
  "timestamp": "2025-12-16T10:30:00",
  "fieldErrors": [
    {
      "field": "name",
      "value": "A",
      "reason": "이름은 2-50자 사이여야 합니다."
    },
    {
      "field": "email",
      "value": "invalid-email",
      "reason": "이메일 형식이 올바르지 않습니다."
    }
  ]
}
```

## 6) 실전 패턴

### 6-1) 환경별 에러 메시지

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @Value("${spring.profiles.active:dev}")
    private String activeProfile;

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(Exception e) {
        log.error("Unexpected error", e);

        // 운영 환경에서는 상세 정보 숨김
        String message = "prod".equals(activeProfile)
            ? "서버 오류가 발생했습니다."
            : e.getMessage();

        ErrorResponse error = ErrorResponse.builder()
            .errorCode("INTERNAL_SERVER_ERROR")
            .message(message)
            .timestamp(LocalDateTime.now())
            .build();

        // 개발 환경에서는 스택 트레이스 포함 (선택적)
        if (!"prod".equals(activeProfile)) {
            error.setStackTrace(ExceptionUtils.getStackTrace(e));
        }

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

### 6-2) 로깅 전략

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusinessException(BusinessException e) {
        // 비즈니스 예외는 WARN 레벨 (예상된 예외)
        log.warn("Business exception: {} - {}", e.getErrorCode().getCode(), e.getMessage());
        // ...
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(Exception e) {
        // 예상치 못한 예외는 ERROR 레벨
        log.error("Unexpected error occurred", e);
        // ...
    }
}
```

### 6-3) 알림 통합

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @Autowired
    private SlackNotifier slackNotifier;

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(
            Exception e,
            HttpServletRequest request) {

        log.error("Critical error occurred", e);

        // 운영 환경에서 심각한 에러는 Slack 알림
        if ("prod".equals(activeProfile)) {
            slackNotifier.sendError(
                "Critical Error",
                String.format("Path: %s\nError: %s", request.getRequestURI(), e.getMessage())
            );
        }

        // ...
    }
}
```

## 7) 베스트 프랙티스

### ✅ 1. 명확한 에러 코드

```java
// ✅ 좋은 예
throw new BusinessException(ErrorCode.USER_NOT_FOUND, "사용자 ID: " + userId);

// ❌ 나쁜 예
throw new RuntimeException("User not found");
```

### ✅ 2. 계층적 예외 처리

```java
// 계층: BusinessException → UserNotFoundException
// 공통 처리 로직은 상위 예외에서
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ErrorResponse> handleBusinessException(BusinessException e) {
    // 모든 비즈니스 예외 공통 처리
}
```

### ✅ 3. 민감 정보 노출 방지

```java
// ❌ 나쁜 예
throw new RuntimeException("Database connection failed: password=secret123");

// ✅ 좋은 예
throw new DatabaseException("데이터베이스 연결에 실패했습니다.");
// 상세 정보는 로그에만
```

### ✅ 4. 일관된 응답 형식

```java
// 모든 에러 응답이 동일한 구조
{
  "errorCode": "...",
  "message": "...",
  "timestamp": "...",
  "path": "..."
}
```

## 8) 자주 하는 실수

### ❌ 실수 1: Exception을 너무 일찍 처리

```java
// ❌ 나쁜 예: 컨트롤러에서 try-catch
@GetMapping("/{id}")
public ResponseEntity<?> getUser(@PathVariable Long id) {
    try {
        return ResponseEntity.ok(userService.findById(id));
    } catch (UserNotFoundException e) {
        return ResponseEntity.notFound().build();  // 응답 형식 불일치!
    }
}

// ✅ 좋은 예: 예외를 던지고 @ControllerAdvice에서 처리
@GetMapping("/{id}")
public User getUser(@PathVariable Long id) {
    return userService.findById(id);  // 예외 발생 시 GlobalExceptionHandler가 처리
}
```

### ❌ 실수 2: 너무 포괄적인 예외 처리

```java
// ❌ 나쁜 예
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleAll(Exception e) {
    return ResponseEntity.ok(new ErrorResponse("에러"));  // 모든 예외를 200으로!
}

// ✅ 좋은 예
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ErrorResponse> handleBusiness(BusinessException e) {
    return ResponseEntity.status(e.getErrorCode().getStatus()).body(...);
}
```

### ❌ 실수 3: 로깅 누락

```java
// ❌ 나쁜 예
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handle(Exception e) {
    return ResponseEntity.status(500).body(new ErrorResponse("에러"));
    // 로그 없음 → 디버깅 불가!
}

// ✅ 좋은 예
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handle(Exception e) {
    log.error("Unexpected error", e);  // 로깅!
    return ResponseEntity.status(500).body(new ErrorResponse("서버 오류"));
}
```

## 연습 (추천)

1. **전역 예외 처리 구현**
   - @RestControllerAdvice 작성
   - 커스텀 예외 계층 설계
   - ErrorResponse DTO 작성

2. **Validation 예외 처리**
   - @Valid 적용
   - 상세한 필드 에러 반환

3. **에러 코드 관리**
   - ErrorCode enum 작성
   - 도메인별 에러 코드 정의

## 요약: 스스로 점검할 것

- @ControllerAdvice로 전역 예외 처리를 구현할 수 있다
- ErrorResponse로 일관된 에러 응답을 설계할 수 있다
- 커스텀 예외 계층을 만들 수 있다
- Validation 예외를 처리할 수 있다
- 환경별로 적절한 에러 메시지를 제공할 수 있다

## 다음 단계

- Spring Validation: `/learning/deep-dive/deep-dive-spring-validation-response/`
- Spring Security 예외 처리: `/learning/deep-dive/deep-dive-spring-security/`
- 로깅 전략: `/learning/deep-dive/deep-dive-logging-strategy/`
