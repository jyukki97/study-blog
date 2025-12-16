---
title: "Spring Validation과 공통 응답 규약"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Validation", "Spring Boot", "Response", "Error"]
categories: ["Backend Deep Dive"]
description: "Bean Validation 적용, 공통 응답/에러 코드 규약, 필드 에러 처리 패턴 정리"
module: "spring-core"
study_order: 125
---

## Validation 적용

- DTO에 `@NotBlank`, `@Email`, `@Size` 등 선언
- 컨트롤러 메서드 파라미터에 `@Valid` 추가, `BindingResult`로 필드 에러 수집

```java
@PostMapping("/users")
public ResponseEntity<ApiResponse<UserDto>> create(
        @Valid @RequestBody CreateUserRequest req) {
    UserDto user = service.create(req);
    return ApiResponse.ok(user);
}
```

## 공통 응답/에러 코드

- 성공: `{ "code":"OK", "data":{...}, "traceId":"" }`
- 실패: `{ "code":"VALIDATION_ERROR", "message":"입력 값을 확인하세요.", "errors":[{field,message}], "traceId":"" }`
- 에러 코드는 Enum으로 관리, 내부 로깅 메시지와 응답 메시지 분리

## 컨트롤러 어드바이스

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<?> handleValidation(MethodArgumentNotValidException ex) {
        List<FieldError> details = ex.getBindingResult().getFieldErrors().stream()
            .map(err -> new FieldError(err.getField(), err.getDefaultMessage()))
            .toList();
        return ApiResponse.error("VALIDATION_ERROR", "입력 값을 확인하세요.", details);
    }
}
```

## 체크리스트

- [ ] DTO 검증 + 국제화 메시지(`messages.properties`) 분리
- [ ] 공통 응답 래퍼 적용, traceId 포함
- [ ] 비즈니스 예외와 Validation 예외를 구분 처리
