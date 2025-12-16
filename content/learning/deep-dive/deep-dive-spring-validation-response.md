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

## 이 글에서 얻는 것

- 검증(Validation)을 “컨트롤러에 if문”으로 붙이지 않고, 경계에서 일관되게 처리하는 구조를 만들 수 있습니다.
- Bean Validation(`@NotBlank`, `@Email` 등)의 기본 흐름과 예외 타입들을 이해하고, 어떤 예외를 어떻게 응답으로 바꿀지 기준이 생깁니다.
- 공통 응답/에러 규약을 설계할 때 꼭 넣어야 할 필드(에러 코드/필드 에러/traceId)를 정리할 수 있습니다.

## 1) Validation은 어디에서 해야 하나

검증은 레이어별로 목적이 다릅니다.

- **요청 경계(Controller)**: “형식/필수값/범위” 같은 입력 검증(빠르게 4xx로 종료)
- **도메인/서비스(Service)**: “비즈니스 규칙” 검증(재고 부족, 권한 없음 같은 의미 있는 실패)

즉, Bean Validation은 “요청 형식”을 빠르게 거르는 데 매우 좋고,
비즈니스 규칙까지 맡기면 오히려 예외 흐름이 꼬일 수 있습니다.

## 2) Bean Validation 기본 흐름

### 2-1) DTO에 제약 조건 선언

```java
public class CreateUserRequest {
    @NotBlank(message = "이메일은 필수입니다.")
    @Email(message = "이메일 형식이 아닙니다.")
    private String email;

    @NotBlank(message = "이름은 필수입니다.")
    @Size(max = 20, message = "이름은 20자 이하여야 합니다.")
    private String name;
}
```

### 2-2) 컨트롤러에서 `@Valid`로 트리거

```java
@PostMapping("/users")
public ResponseEntity<UserDto> create(@Valid @RequestBody CreateUserRequest req) {
    return ResponseEntity.ok(service.create(req));
}
```

`@Valid`가 붙으면, 실패 시 `MethodArgumentNotValidException`이 발생합니다(일반적으로 `@RestControllerAdvice`에서 처리).

추가로 알아두면 좋은 것:

- 쿼리 파라미터/경로 변수 검증에서 `ConstraintViolationException`이 나오는 경우가 있습니다.
- 중첩 객체 검증은 필드에 `@Valid`를 추가해야 내려갑니다.

## 3) 공통 에러 응답 규약: ‘고정되는 것’이 실무에서 힘이다

에러 응답이 흔들리면 프론트/모바일/다른 서버가 매번 예외 처리를 새로 작성합니다.
그래서 최소한 아래는 고정하는 게 좋습니다.

- `code`: 기계가 처리하기 위한 코드(문자열/Enum)
- `message`: 사용자/클라이언트가 이해할 메시지(필요하면 i18n)
- `errors`: 필드 단위 상세(검증 실패일 때 특히 중요)
- `traceId`: 로그/트레이싱과 연결되는 키
- `path`, `timestamp`: 운영에서 확인하기 좋은 맥락

예시:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "입력 값을 확인하세요.",
  "errors": [{"field":"email","message":"이메일 형식이 아닙니다."}],
  "traceId": "abc-123"
}
```

## 4) `@RestControllerAdvice`로 Validation 예외를 응답으로 바꾸기

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex,
                                                          HttpServletRequest request) {
        List<ErrorDetail> details = ex.getBindingResult().getFieldErrors().stream()
            .map(err -> new ErrorDetail(err.getField(), err.getDefaultMessage()))
            .toList();

        ErrorResponse body = ErrorResponse.validation(details, request.getRequestURI());
        return ResponseEntity.badRequest().body(body);
    }
}
```

핵심 포인트:

- Validation 실패는 대체로 `400 Bad Request`로 응답합니다.
- “비즈니스 실패(예: 재고 부족)”와 “입력 형식 실패(Validation)”는 코드/응답을 분리하는 게 좋습니다.

## 5) 자주 하는 실수

- Validation 에러를 200으로 응답하거나, 메시지/형식이 엔드포인트마다 달라지는 경우
- 서버 로그에 동일 예외를 여러 번 찍는 경우(필터/핸들러/인터셉터 중복)
- DTO 검증과 비즈니스 규칙을 섞어서 “무슨 에러인지”가 모호해지는 경우

## 연습(추천)

- 필드 에러가 2개 이상일 때 응답이 어떻게 나오는지, 클라이언트가 어떻게 표시하면 좋은지까지 설계해보기
- `messages.properties`로 검증 메시지를 분리하고(i18n), 코드/메시지의 역할을 구분해보기
- Validation 실패와 BusinessException 실패를 각각 다른 포맷/코드로 내려보는 예제를 만들어보기
