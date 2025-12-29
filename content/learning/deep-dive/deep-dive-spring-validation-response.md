---
title: "Spring Validation과 공통 응답 규약"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Validation", "Spring Boot", "Response", "Error"]
categories: ["Backend Deep Dive"]
description: "Bean Validation 적용, 공통 응답/에러 코드 규약, 필드 에러 처리 패턴 정리"
module: "spring-core"
quizzes:
  - question: "Spring DTO 검증에서 `@Valid` 애노테이션이 붙은 객체의 유효성 검사가 실패할 때 발생하는 예외는?"
    options:
      - "IllegalArgumentException"
      - "MethodArgumentNotValidException"
      - "ConstraintViolationException"
      - "DataIntegrityViolationException"
    answer: 1
    explanation: "`@Valid`가 붙은 RequestBody 검증 실패 시 `MethodArgumentNotValidException`이 발생하며, 이는 보통 400 Bad Request로 처리됩니다."

  - question: "입력값 검증(Validation)과 비즈니스 로직 검증의 차이로 가장 적절한 것은?"
    options:
      - "입력값 검증은 Service 계층에서, 비즈니스 검증은 Controller에서 수행한다."
      - "입력값 검증은 `@NotNull`, `@Email` 등 형식 체크 위주이고, 비즈니스 검증은 '재고 부족' 같은 상태 의존적 로직이다."
      - "두 검증 모두 데이터베이스 조회를 필수로 한다."
      - "Spring에서는 두 검증을 구분하지 않고 모두 `@Valid`로 처리한다."
    answer: 1
    explanation: "입력값 검증은 형식을 체크하여 빠르게 4xx로 거르는 것이 목적이고, 비즈니스 검증은 DB 상태 등을 확인해야 하므로 Service 계층에서 수행합니다."

  - question: "모든 컨트롤러에서 발생하는 예외를 한 곳에서 처리하여 일관된 에러 응답을 내려주기 위해 사용하는 Spring 애노테이션은?"
    options:
      - "@Controller"
      - "@Service"
      - "@RestControllerAdvice"
      - "@Component"
    answer: 2
    explanation: "`@RestControllerAdvice`(또는 `@ControllerAdvice`)를 사용하면 전역적으로 예외를 잡아서 공통된 포맷의 에러 응답(JSON 등)을 반환할 수 있습니다."

  - question: "Spring Boot에서 Validation 의존성을 추가할 때 사용하는 스타터 패키지 이름은?"
    options:
      - "spring-boot-starter-web"
      - "spring-boot-starter-validation"
      - "spring-boot-starter-test"
      - "spring-boot-starter-logging"
    answer: 1
    explanation: "Spring Boot 2.3부터 Validation이 `spring-boot-starter-web`에서 분리되어 `spring-boot-starter-validation`을 별도로 추가해야 합니다."

  - question: "API 에러 응답 설계를 할 때, 클라이언트가 예외의 종류를 기계적으로 식별하기 위해 가장 중요한 필드는?"
    options:
      - "message (사용자용 메시지)"
      - "code (에러 코드)"
      - "stackTrace (스택 트레이스)"
      - "timestamp (발생 시간)"
    answer: 1
    explanation: "메시지는 사용자가 보기 위한 것이고, 클라이언트(프론트엔드) 코드가 분기 처리를 하려면 고유하고 불변하는 `code`(예: `USER_NOT_FOUND`)가 필요합니다."
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
