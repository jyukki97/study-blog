---
title: "예외 처리 패턴: 비즈니스 예외 설계"
study_order: 215
date: 2025-12-28
topic: "Spring"
topic_icon: "⚠️"
topic_description: "커스텀 예외, 예외 계층, 글로벌 핸들링, 로깅 전략"
tags: ["Exception Handling", "Spring", "Error Handling", "Best Practices"]
categories: ["Spring"]
draft: false
module: "spring-core"
quizzes:
  - question: "Java에서 비즈니스 예외를 Checked Exception 대신 Unchecked Exception(RuntimeException)으로 만드는 이유는?"
    options:
      - "Checked가 더 안전하기 때문"
      - "Unchecked는 throws 선언 없이 사용할 수 있어 코드가 간결해지고, 호출자가 처리 방법을 강제받지 않기 때문"
      - "컴파일 속도가 빨라지기 때문"
      - "JVM이 Unchecked만 지원하기 때문"
    answer: 1
    explanation: "Checked Exception은 모든 호출 경로에서 try-catch나 throws가 필요해 코드가 복잡해집니다. 비즈니스 예외는 대부분 글로벌 핸들러에서 처리하므로 Unchecked가 적합합니다."

  - question: "@RestControllerAdvice와 @ExceptionHandler를 사용하는 이유는?"
    options:
      - "성능을 향상시키기 위해"
      - "모든 컨트롤러에서 발생하는 예외를 한 곳에서 일관된 형식(ErrorResponse)으로 처리하기 위해"
      - "예외를 숨기기 위해"
      - "로깅을 비활성화하기 위해"
    answer: 1
    explanation: "글로벌 예외 핸들러를 통해 모든 API에서 동일한 형식의 에러 응답({code, message, timestamp, path})을 반환할 수 있어 클라이언트 처리가 쉬워집니다."

  - question: "비즈니스 예외에 `errorCode`를 포함시키는 이유는?"
    options:
      - "디버깅이 어려워지기 때문"
      - "클라이언트가 에러 종류를 식별하고 적절히 대응할 수 있도록 하기 위해 (예: USER_NOT_FOUND → 회원가입 유도)"
      - "보안을 위해"
      - "필요 없다"
    answer: 1
    explanation: "HTTP 상태 코드(404)만으로는 '무엇이' 없는지 알 수 없습니다. errorCode를 추가하면 클라이언트가 UI/UX를 다르게 처리할 수 있습니다."

  - question: "예외 로깅 레벨로 올바른 조합은?"
    options:
      - "모든 예외를 ERROR로 기록"
      - "404/400은 WARN, 500 Internal Error는 ERROR, 예상된 비즈니스 오류는 INFO"
      - "모든 예외를 DEBUG로 기록"
      - "로깅하지 않음"
    answer: 1
    explanation: "클라이언트 오류(404, 400)는 시스템 문제가 아니므로 WARN으로, 서버 오류는 조사가 필요하므로 ERROR로 기록합니다. 정상적인 비즈니스 흐름의 예외는 INFO가 적합합니다."

  - question: "Repository 계층에서 DataIntegrityViolationException을 BusinessException으로 래핑하는 이유는?"
    options:
      - "성능을 높이기 위해"
      - "저수준 DB 예외를 비즈니스 의미가 있는 예외(예: DuplicateResourceException)로 변환하여 상위 계층이 이해하기 쉽게 하기 위해"
      - "예외를 숨기기 위해"
      - "JPA가 요구하기 때문"
    answer: 1
    explanation: "Service/Controller 계층은 DB 구현 세부사항(Unique 제약조건)을 몰라도 됩니다. '이미 존재하는 이메일' 같은 비즈니스 의미로 변환하면 처리가 명확해집니다."
---

## 이 글에서 얻는 것

- **비즈니스 예외 계층**을 설계합니다
- **글로벌 예외 핸들링**으로 일관된 에러 응답을 제공합니다
- **예외 로깅 전략**을 구현합니다

---

## 예외 계층 설계

### 기본 구조

```mermaid
classDiagram
    RuntimeException <|-- BusinessException
    BusinessException <|-- ResourceNotFoundException
    BusinessException <|-- DuplicateResourceException
    BusinessException <|-- InvalidOperationException
    
    class BusinessException {
        +String errorCode
        +String message
        +HttpStatus status
    }
    
    class ResourceNotFoundException {
        +String resourceType
        +String resourceId
    }
```

### 기본 예외 클래스

```java
@Getter
public abstract class BusinessException extends RuntimeException {
    
    private final String errorCode;
    private final HttpStatus status;
    
    protected BusinessException(String errorCode, String message, HttpStatus status) {
        super(message);
        this.errorCode = errorCode;
        this.status = status;
    }
    
    protected BusinessException(String errorCode, String message, 
                                 HttpStatus status, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.status = status;
    }
}
```

### 구체 예외 클래스

```java
public class ResourceNotFoundException extends BusinessException {
    
    private final String resourceType;
    private final String resourceId;
    
    public ResourceNotFoundException(String resourceType, String resourceId) {
        super(
            "RESOURCE_NOT_FOUND",
            String.format("%s not found with id: %s", resourceType, resourceId),
            HttpStatus.NOT_FOUND
        );
        this.resourceType = resourceType;
        this.resourceId = resourceId;
    }
    
    // 팩토리 메서드
    public static ResourceNotFoundException user(Long id) {
        return new ResourceNotFoundException("User", id.toString());
    }
    
    public static ResourceNotFoundException order(String orderId) {
        return new ResourceNotFoundException("Order", orderId);
    }
}

public class DuplicateResourceException extends BusinessException {
    
    public DuplicateResourceException(String resourceType, String field, String value) {
        super(
            "DUPLICATE_RESOURCE",
            String.format("%s already exists with %s: %s", resourceType, field, value),
            HttpStatus.CONFLICT
        );
    }
}

public class InvalidOperationException extends BusinessException {
    
    public InvalidOperationException(String message) {
        super("INVALID_OPERATION", message, HttpStatus.BAD_REQUEST);
    }
}
```

---

## 서비스 레이어에서 사용

```java
@Service
public class UserService {
    
    public User findById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> ResourceNotFoundException.user(id));
    }
    
    public User create(CreateUserRequest request) {
        // 중복 검사
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new DuplicateResourceException("User", "email", request.getEmail());
        }
        
        return userRepository.save(new User(request));
    }
    
    public void deactivate(Long id) {
        User user = findById(id);
        
        if (user.isAlreadyDeactivated()) {
            throw new InvalidOperationException("User is already deactivated");
        }
        
        user.deactivate();
    }
}
```

---

## 글로벌 예외 핸들러

```java
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {
    
    // 비즈니스 예외 처리
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusinessException(
            BusinessException ex, WebRequest request) {
        
        log.warn("Business exception: {} - {}", ex.getErrorCode(), ex.getMessage());
        
        ErrorResponse response = ErrorResponse.builder()
            .code(ex.getErrorCode())
            .message(ex.getMessage())
            .timestamp(LocalDateTime.now())
            .path(extractPath(request))
            .build();
        
        return ResponseEntity.status(ex.getStatus()).body(response);
    }
    
    // Validation 예외
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex, WebRequest request) {
        
        List<FieldError> fieldErrors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .map(e -> new FieldError(e.getField(), e.getDefaultMessage()))
            .collect(Collectors.toList());
        
        ErrorResponse response = ErrorResponse.builder()
            .code("VALIDATION_ERROR")
            .message("입력값이 올바르지 않습니다")
            .timestamp(LocalDateTime.now())
            .path(extractPath(request))
            .errors(fieldErrors)
            .build();
        
        return ResponseEntity.badRequest().body(response);
    }
    
    // 알 수 없는 예외
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(
            Exception ex, WebRequest request) {
        
        // 예상치 못한 에러는 ERROR 레벨로 로깅
        log.error("Unexpected error occurred", ex);
        
        ErrorResponse response = ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("서버 오류가 발생했습니다")
            .timestamp(LocalDateTime.now())
            .path(extractPath(request))
            .build();
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }
    
    private String extractPath(WebRequest request) {
        return request.getDescription(false).replace("uri=", "");
    }
}
```

### 에러 응답 DTO

```java
@Getter @Builder
public class ErrorResponse {
    private String code;
    private String message;
    private LocalDateTime timestamp;
    private String path;
    private List<FieldError> errors;
    
    @Getter @AllArgsConstructor
    public static class FieldError {
        private String field;
        private String message;
    }
}
```

---

## 로깅 전략

### 로깅 레벨 기준

| 예외 유형 | 로깅 레벨 | 이유 |
|---------|---------|------|
| 404 Not Found | WARN | 클라이언트 오류, 주의 필요 |
| 400 Bad Request | WARN | 입력 오류 |
| 401/403 | WARN | 보안 관련 |
| 500 | ERROR | 서버 오류, 조사 필요 |
| 예상된 비즈니스 오류 | INFO | 정상 흐름 |

### 에러 컨텍스트 포함

```java
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ErrorResponse> handleBusinessException(
        BusinessException ex, WebRequest request, HttpServletRequest httpRequest) {
    
    // 디버깅에 유용한 컨텍스트 로깅
    log.warn("Business exception: code={}, message={}, path={}, userId={}, traceId={}",
        ex.getErrorCode(),
        ex.getMessage(),
        httpRequest.getRequestURI(),
        getCurrentUserId(),
        MDC.get("traceId")
    );
    
    // ...
}
```

---

## Checked vs Unchecked

### Unchecked 권장 (RuntimeException)

```java
// ✅ Unchecked - 비즈니스 예외
public class OrderNotFoundException extends RuntimeException { ... }

// 사용: throws 선언 불필요
public Order findOrder(String id) {
    return orderRepository.findById(id)
        .orElseThrow(() -> new OrderNotFoundException(id));
}
```

### Checked는 복구 가능할 때만

```java
// Checked - 복구 가능한 예외
public class RetryableException extends Exception {
    // 재시도로 복구 가능한 경우
}

public void processWithRetry() throws RetryableException {
    // 호출자가 재시도 로직 구현
}
```

---

## 예외 래핑

### 저수준 예외를 비즈니스 예외로

```java
@Repository
public class OrderRepository {
    
    public Order save(Order order) {
        try {
            return jdbcTemplate.update(...);
        } catch (DataIntegrityViolationException e) {
            // DB 제약조건 위반 → 비즈니스 예외로 변환
            throw new DuplicateOrderException(order.getOrderNumber(), e);
        } catch (DataAccessException e) {
            // 데이터 접근 오류 → 인프라 예외로 변환
            throw new DatabaseAccessException("Failed to save order", e);
        }
    }
}
```

---

## 요약

### 예외 처리 체크리스트

| 항목 | 권장 |
|------|------|
| 예외 타입 | Unchecked (RuntimeException) |
| 계층 구조 | BusinessException 기반 |
| 에러 코드 | 일관된 코드 체계 |
| 핸들링 | @RestControllerAdvice |
| 로깅 | 레벨별 분리 |

### 핵심 원칙

1. **명확한 예외 계층**: 의미있는 예외 타입
2. **일관된 응답 형식**: 글로벌 핸들러
3. **적절한 로깅**: 레벨별 분리
4. **예외 래핑**: 저수준 → 비즈니스 예외

---

## 🔗 Related Deep Dive

- **[Spring Validation](/learning/deep-dive/deep-dive-spring-validation/)**: 입력 검증과 예외.
- **[구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)**: 에러 로깅 전략.
