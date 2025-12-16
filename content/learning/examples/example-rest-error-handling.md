---
title: "REST API 에러 핸들링 모범 사례"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["REST", "Error Handling", "Spring Boot", "Validation"]
categories: ["Development", "Learning"]
description: "표준 에러 응답 포맷, 글로벌 예외 처리, 검증 에러 응답 설계"
module: "spring-core"
study_order: 130
---

## 이 글에서 얻는 것

- REST API에서 “에러 응답”을 어떻게 고정해야 하는지(계약/보안/디버깅) 기준이 생깁니다.
- Validation/Business/System 에러를 분리하고, 상태 코드/에러 코드/로그 레벨을 일관되게 매핑할 수 있습니다.
- `@RestControllerAdvice`로 예외를 한 곳에서 처리하면서도 “중복 로그/정보 과다 노출”을 피할 수 있습니다.

## 1) 에러 응답은 ‘계약’이다

에러는 성공보다 더 자주 바뀌면 안 됩니다.  
클라이언트는 “성공 케이스”보다 “실패 케이스”에서 더 많은 분기 처리를 하기 때문입니다.

그래서 에러 응답은 최소한 아래를 고정하는 게 좋습니다.

- 기계가 분기할 `code`
- 사용자/클라이언트가 보여줄 `message`
- 검증 실패 시 `details`(필드 단위)
- 운영/디버깅을 위한 `traceId`, `path`, `timestamp`

## 2) 에러 응답 포맷 예시

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

## 3) 에러를 3종류로 분류하면 대부분 해결된다

### 3-1) Validation Error(입력 형식 실패)

- 예: `@Valid` 실패, 파라미터 타입 변환 실패, JSON 파싱 실패
- 보통 `400 Bad Request`

### 3-2) Business Error(의미 있는 실패)

- 예: 재고 부족, 권한 없음, 리소스 없음
- 보통 `4xx`로 표현하고, 에러 코드를 명확히 고정

### 3-3) System Error(시스템/인프라 실패)

- 예: DB 다운, 외부 API 타임아웃, 예상 못한 예외
- 보통 `500` (게이트웨이라면 502/503/504 등으로 분리할 수도 있음)

이렇게만 나눠도 “어떤 알람을 울려야 하는지”, “클라이언트가 재시도해야 하는지”가 훨씬 명확해집니다.

## 4) 글로벌 예외 처리: `@RestControllerAdvice`에 모으기

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

여기에 더해, 보통 다음 핸들러를 추가합니다.

- `BusinessException`(직접 정의한 도메인 예외) → 해당 코드/상태로 응답
- `AccessDeniedException` → 403
- `HttpMessageNotReadableException`(JSON 파싱 실패) → 400
- 그 외 `Exception`(catch-all) → 500

## 5) 로깅 전략(중복 로그를 피하기)

- Validation/Business 에러는 보통 `warn` 수준 + 핵심 맥락만 기록(입력 전체를 그대로 찍지 않기)
- System 에러는 `error` + stacktrace + traceId로 추적 가능하게
- “한 요청에 한 번”만 에러 로그를 남기도록 설계(필터/핸들러에서 중복되지 않게)

## 6) 보안/UX 관점에서의 원칙

- 내부 예외 메시지/스택을 그대로 응답에 내리지 않기(정보 노출)
- `message`는 사용자/클라이언트 친화적으로, 디버깅은 `traceId`로 로그에서
- 에러 코드는 바뀌지 않게(클라이언트 분기 기준)

## 연습(추천)

- BusinessException을 하나 만들고(예: `USER_NOT_FOUND`), `@ExceptionHandler`로 상태 코드/응답을 고정해보기
- traceId를 MDC에 심는 필터를 추가하고, 응답에도 traceId가 내려오게 만들어보기
- “에러 응답 스펙”을 문서로 고정하고(예: OpenAPI/REST Docs), 변경이 생기면 테스트가 깨지게 만들어보기
