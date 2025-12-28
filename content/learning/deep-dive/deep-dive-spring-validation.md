---
title: "Spring Validation: 입력 검증 완벽 가이드"
study_order: 213
date: 2025-12-28
topic: "Spring"
topic_icon: "✔️"
topic_description: "Bean Validation, Custom Validator, 에러 핸들링"
tags: ["Spring", "Validation", "Bean Validation", "Error Handling"]
categories: ["Spring"]
draft: false
module: "spring-core"
---

## 이 글에서 얻는 것

- **Bean Validation**으로 선언적 검증을 구현합니다
- **Custom Validator**로 복잡한 검증 로직을 처리합니다
- **글로벌 예외 핸들링**으로 일관된 에러 응답을 제공합니다

---

## Bean Validation 기본

### 의존성

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

### 기본 어노테이션

```java
@Getter @Setter
public class CreateUserRequest {
    
    @NotBlank(message = "이름은 필수입니다")
    @Size(min = 2, max = 50, message = "이름은 2-50자 사이여야 합니다")
    private String name;
    
    @NotBlank(message = "이메일은 필수입니다")
    @Email(message = "올바른 이메일 형식이 아닙니다")
    private String email;
    
    @NotNull(message = "나이는 필수입니다")
    @Min(value = 0, message = "나이는 0 이상이어야 합니다")
    @Max(value = 150, message = "나이는 150 이하여야 합니다")
    private Integer age;
    
    @Pattern(regexp = "^010-\\d{4}-\\d{4}$", message = "전화번호 형식이 올바르지 않습니다")
    private String phone;
    
    @Past(message = "생년월일은 과거여야 합니다")
    private LocalDate birthDate;
}
```

### Controller 적용

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @PostMapping
    public ResponseEntity<UserResponse> createUser(
            @Valid @RequestBody CreateUserRequest request) {
        // @Valid가 없으면 검증 수행 안됨
        User user = userService.create(request);
        return ResponseEntity.ok(toResponse(user));
    }
}
```

---

## 주요 어노테이션

| 어노테이션 | 대상 | 설명 |
|-----------|------|------|
| `@NotNull` | 참조 타입 | null 불가 |
| `@NotEmpty` | 문자열, 컬렉션 | null, 빈 값 불가 |
| `@NotBlank` | 문자열 | null, 빈값, 공백만 불가 |
| `@Size` | 문자열, 컬렉션 | 크기 제한 |
| `@Min`, `@Max` | 숫자 | 최소/최대값 |
| `@Email` | 문자열 | 이메일 형식 |
| `@Pattern` | 문자열 | 정규식 |
| `@Past`, `@Future` | 날짜 | 과거/미래 |
| `@Positive`, `@Negative` | 숫자 | 양수/음수 |

### 중첩 객체 검증

```java
public class OrderRequest {
    
    @NotNull
    @Valid  // 중첩 객체도 검증
    private ShippingAddress shippingAddress;
    
    @NotEmpty
    @Valid
    private List<OrderItemRequest> items;
}

public class ShippingAddress {
    @NotBlank
    private String city;
    
    @NotBlank
    private String street;
}
```

---

## Custom Validator

### 커스텀 어노테이션 정의

```java
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PhoneNumberValidator.class)
public @interface PhoneNumber {
    String message() default "올바른 전화번호 형식이 아닙니다";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

### Validator 구현

```java
public class PhoneNumberValidator implements ConstraintValidator<PhoneNumber, String> {
    
    private static final Pattern PHONE_PATTERN = 
        Pattern.compile("^01[016789]-\\d{3,4}-\\d{4}$");
    
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;  // null은 @NotNull로 처리
        }
        return PHONE_PATTERN.matcher(value).matches();
    }
}

// 사용
public class UserRequest {
    @PhoneNumber
    private String phone;
}
```

### 다중 필드 검증 (클래스 레벨)

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = PasswordMatchValidator.class)
public @interface PasswordMatch {
    String message() default "비밀번호가 일치하지 않습니다";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}

public class PasswordMatchValidator 
        implements ConstraintValidator<PasswordMatch, PasswordChangeRequest> {
    
    @Override
    public boolean isValid(PasswordChangeRequest request, 
                           ConstraintValidatorContext context) {
        if (request.getPassword() == null) {
            return true;
        }
        return request.getPassword().equals(request.getPasswordConfirm());
    }
}

// 사용
@PasswordMatch
public class PasswordChangeRequest {
    @NotBlank
    private String password;
    
    @NotBlank
    private String passwordConfirm;
}
```

---

## Validation Groups

### 상황별 검증

```java
// 그룹 인터페이스 정의
public interface OnCreate {}
public interface OnUpdate {}

public class UserRequest {
    
    @Null(groups = OnCreate.class, message = "생성 시 ID는 null이어야 합니다")
    @NotNull(groups = OnUpdate.class, message = "수정 시 ID는 필수입니다")
    private Long id;
    
    @NotBlank(groups = {OnCreate.class, OnUpdate.class})
    private String name;
    
    @NotBlank(groups = OnCreate.class)  // 생성 시에만 필수
    private String password;
}

// Controller
@PostMapping
public void create(@Validated(OnCreate.class) @RequestBody UserRequest request) { ... }

@PutMapping("/{id}")
public void update(@Validated(OnUpdate.class) @RequestBody UserRequest request) { ... }
```

---

## 예외 핸들링

### 글로벌 예외 핸들러

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationError(
            MethodArgumentNotValidException ex) {
        
        List<FieldError> fieldErrors = ex.getBindingResult().getFieldErrors()
            .stream()
            .map(error -> new FieldError(
                error.getField(),
                error.getDefaultMessage()
            ))
            .collect(Collectors.toList());
        
        ErrorResponse response = new ErrorResponse(
            "VALIDATION_ERROR",
            "입력값이 올바르지 않습니다",
            fieldErrors
        );
        
        return ResponseEntity.badRequest().body(response);
    }
    
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolation(
            ConstraintViolationException ex) {
        
        List<FieldError> fieldErrors = ex.getConstraintViolations()
            .stream()
            .map(v -> new FieldError(
                v.getPropertyPath().toString(),
                v.getMessage()
            ))
            .collect(Collectors.toList());
        
        return ResponseEntity.badRequest()
            .body(new ErrorResponse("VALIDATION_ERROR", "입력값이 올바르지 않습니다", fieldErrors));
    }
}

@Getter @AllArgsConstructor
public class ErrorResponse {
    private String code;
    private String message;
    private List<FieldError> errors;
    
    @Getter @AllArgsConstructor
    public static class FieldError {
        private String field;
        private String message;
    }
}
```

### 응답 예시

```json
{
    "code": "VALIDATION_ERROR",
    "message": "입력값이 올바르지 않습니다",
    "errors": [
        {
            "field": "email",
            "message": "올바른 이메일 형식이 아닙니다"
        },
        {
            "field": "name",
            "message": "이름은 2-50자 사이여야 합니다"
        }
    ]
}
```

---

## 서비스 레이어 검증

### @Validated로 메서드 파라미터 검증

```java
@Validated
@Service
public class UserService {
    
    public User findByEmail(@Email String email) {
        return userRepository.findByEmail(email)
            .orElseThrow(() -> new UserNotFoundException(email));
    }
    
    public void updatePassword(
            @NotBlank String userId,
            @Size(min = 8, max = 20) String newPassword) {
        // ...
    }
}
```

---

## 요약

### Validation 체크리스트

| 항목 | 방법 |
|------|------|
| 기본 검증 | Bean Validation 어노테이션 |
| 복잡한 검증 | Custom Validator |
| 상황별 검증 | Validation Groups |
| 중첩 객체 | @Valid |
| 에러 응답 | @RestControllerAdvice |

### 핵심 원칙

1. **입력은 항상 검증**: 신뢰할 수 없는 입력
2. **선언적 검증**: 어노테이션 활용
3. **일관된 에러 응답**: 글로벌 핸들러
4. **빨리 실패**: Controller에서 조기 검증

---

## 🔗 Related Deep Dive

- **[Spring MVC 요청 흐름](/learning/deep-dive/deep-dive-spring-mvc-request-lifecycle/)**: 검증이 수행되는 시점.
- **[API 버전 관리](/learning/deep-dive/deep-dive-api-versioning/)**: API 설계와 검증.
