---
title: "REST API 에러 핸들링 모범 사례"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["REST", "Error Handling", "Spring Boot", "Validation"]
categories: ["Development", "Learning"]
description: "표준 에러 응답 포맷, 글로벌 예외 처리, 검증 에러 응답 설계"
module: "spring-core"
study_order: 19
---

## 에러 응답 포맷 예시

```json
{
  "code": "VALIDATION_ERROR",
  "message": "입력 값을 확인하세요.",
  "timestamp": "2025-12-16T12:00:00Z",
  "path": "/api/v1/users",
  "details": [
    {"field": "email", "message": "이메일 형식이 아닙니다."},
    {"field": "age", "message": "0 이상이어야 합니다."}
  ],
  "traceId": "abc-123"
}
```

## 글로벌 예외 처리

- `@RestControllerAdvice` + `@ExceptionHandler`로 공통 처리
- `@Valid`/`BindingResult` 검증 에러를 별도 코드로 매핑
- 공통 `ErrorCode` Enum으로 서비스 전반 일관성 유지

```java
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex,
                                                          HttpServletRequest request) {
        List<ErrorDetail> details = ex.getBindingResult().getFieldErrors().stream()
            .map(err -> new ErrorDetail(err.getField(), err.getDefaultMessage()))
            .toList();

        ErrorResponse body = ErrorResponse.builder()
                .code("VALIDATION_ERROR")
                .message("입력 값을 확인하세요.")
                .path(request.getRequestURI())
                .details(details)
                .traceId(MDC.get("traceId"))
                .build();

        return ResponseEntity.badRequest().body(body);
    }
}
```

## 체크리스트

- [ ] 에러 코드 규칙 정의 (도메인별 prefix 등)
- [ ] Validation, Business, System 에러를 구분
- [ ] 공통 `traceId`를 로그/응답 모두에 포함
- [ ] 클라이언트별(웹/모바일) 필요 필드를 스펙으로 명시
