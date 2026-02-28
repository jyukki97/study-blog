---
title: "Spring 예외 처리 (Part 2: 에러 응답 설계, 실무)"
date: 2025-10-24
draft: false
topic: "Spring"
tags: ["Spring", "Exception Handling", "ControllerAdvice", "Error Response", "REST API"]
categories: ["Backend Deep Dive"]
description: "@ControllerAdvice와 @ExceptionHandler로 전역 예외를 처리하고 일관된 에러 응답 설계"
module: "spring-core"
study_order: 120
---

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

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: Spring 예외 처리 (Part 1: 동작 원리)](/learning/deep-dive/deep-dive-spring-exception-handling/)**
