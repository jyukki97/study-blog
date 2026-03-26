---
title: "Spring 예외 처리 (Part 1: 동작 원리)"
date: 2025-10-24
draft: false
topic: "Spring"
tags: ["Spring", "Exception Handling", "ControllerAdvice", "Error Response", "REST API"]
categories: ["Backend Deep Dive"]
description: "@ControllerAdvice와 @ExceptionHandler로 전역 예외를 처리하고 일관된 에러 응답 설계"
module: "spring-core"
study_order: 120
---

## 이 글에서 얻는 것

- **DispatcherServlet → HandlerExceptionResolver** 체인 전체를 따라가며 예외가 "어디서, 어떤 순서로" 처리되는지 설명할 수 있습니다.
- **@ControllerAdvice**와 **@ExceptionHandler**의 우선순위·스코핑 규칙을 정확히 구분할 수 있습니다.
- **Filter/Interceptor 레벨** 예외가 @ExceptionHandler에 잡히지 않는 이유와 대응 전략을 알 수 있습니다.
- **ResponseStatusException**(Spring 5+)과 **RFC 9457 Problem Details**를 활용한 현대적 예외 응답 방식을 이해합니다.
- **@WebMvcTest** 기반 예외 핸들러 테스트 코드를 작성할 수 있습니다.
- 실무에서 자주 빠지는 안티패턴 7가지와 운영 체크리스트를 확보합니다.

---

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

---

## 1) Spring MVC 예외 처리 전체 흐름

### 1-1) DispatcherServlet → HandlerExceptionResolver 체인

Spring MVC에서 예외가 발생하면 다음 순서를 타고 내려갑니다.

```
클라이언트 요청
   │
   ▼
┌──────────────────────────┐
│   Filter Chain           │  ← (1) Filter 예외는 여기서 처리해야 함
│   (Security Filter 등)   │       @ExceptionHandler가 잡지 못함
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│   DispatcherServlet      │  ← (2) 핸들러 매핑 → 핸들러 실행
│                          │
│   try {                  │
│     handler.handle()     │
│   } catch (Exception e) {│
│     processHandlerEx()   │  ← (3) 여기서 ExceptionResolver 체인 탐색
│   }                      │
└──────────┬───────────────┘
           ▼
┌──────────────────────────────────────────────┐
│   HandlerExceptionResolverComposite          │
│                                              │
│   [1] ExceptionHandlerExceptionResolver      │ ← @ExceptionHandler 처리
│       → 컨트롤러 내부 핸들러 먼저             │
│       → @ControllerAdvice 핸들러 다음         │
│                                              │
│   [2] ResponseStatusExceptionResolver        │ ← @ResponseStatus 처리
│                                              │
│   [3] DefaultHandlerExceptionResolver        │ ← Spring 내장 예외 처리
│       (TypeMismatch, HttpMethod 등)          │
└──────────────────────────────────────────────┘
```

핵심 포인트:
- **DispatcherServlet 바깥**(Filter, Interceptor의 preHandle) 예외는 이 체인을 타지 않습니다.
- 체인은 순서대로 시도하고, **첫 번째로 처리에 성공한 Resolver**가 응답을 결정합니다.
- 모든 Resolver가 처리하지 못하면 서블릿 컨테이너의 기본 에러 페이지로 넘어갑니다.

### 1-2) ExceptionHandlerExceptionResolver 내부 동작

이 Resolver가 @ExceptionHandler를 찾는 순서를 정확히 이해해야 합니다.

```
예외 발생 (UserNotFoundException)
   │
   ▼
[Step 1] 예외를 던진 컨트롤러 클래스에 @ExceptionHandler가 있는가?
         → 있으면 실행 (가장 높은 우선순위)
   │
   ▼ (없으면)
[Step 2] @ControllerAdvice 클래스들을 @Order 순서대로 탐색
         → 해당 예외를 처리하는 @ExceptionHandler를 찾으면 실행
   │
   ▼ (없으면)
[Step 3] 부모 예외 타입으로 거슬러 올라가며 재탐색
         → RuntimeException → Exception 순서로 확대
   │
   ▼ (없으면)
[Step 4] 다음 Resolver(ResponseStatusExceptionResolver)로 넘어감
```

**예외 타입 매칭 우선순위**: 구체적인 예외가 먼저 매칭됩니다.

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    // UserNotFoundException이 발생하면 이것이 먼저 매칭됨 (더 구체적)
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException e) { ... }

    // UserNotFoundException이 BusinessException을 상속해도, 위가 먼저
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusiness(BusinessException e) { ... }

    // 위 두 가지 모두 못 잡은 예외의 마지막 방어선
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleAll(Exception e) { ... }
}
```

### 1-3) 실행 흐름을 디버깅으로 확인하는 법

실제로 어떤 Resolver가 동작하는지 확인하려면:

```yaml
# application.yml
logging:
  level:
    org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver: DEBUG
    org.springframework.web.servlet.handler.HandlerExceptionResolverComposite: DEBUG
```

로그 출력 예시:
```
DEBUG ExceptionHandlerExceptionResolver: Using @ExceptionHandler 
  com.myapp.handler.GlobalExceptionHandler#handleUserNotFound(UserNotFoundException)
```

---

## 2) @ControllerAdvice와 @RestControllerAdvice

### 2-1) @ControllerAdvice

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

### 2-2) @RestControllerAdvice

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

**차이점 비교표:**

| 구분 | @ControllerAdvice | @RestControllerAdvice |
|------|-------------------|----------------------|
| 응답 방식 | View 이름 반환 가능 | 객체 → JSON 자동 변환 |
| @ResponseBody | 필요 | 내장 |
| 주 용도 | MVC (HTML 반환) | REST API |
| 실무 선택 기준 | SSR 프로젝트 | API 프로젝트 (대부분) |

### 2-3) 스코핑: 특정 패키지/컨트롤러에만 적용

```java
// 특정 패키지에만 적용
@RestControllerAdvice(basePackages = "com.myapp.api")
public class ApiExceptionHandler {
    // /api/** 관련 컨트롤러만 처리
}

// 특정 컨트롤러에만 적용
@RestControllerAdvice(assignableTypes = {UserController.class, OrderController.class})
public class UserOrderExceptionHandler {
    // 지정된 컨트롤러만 처리
}

// 특정 애노테이션이 있는 컨트롤러에만
@RestControllerAdvice(annotations = RestController.class)
public class RestExceptionHandler {
    // @RestController가 붙은 것만 처리
}
```

### 2-4) 다중 @ControllerAdvice 우선순위 (@Order)

프로젝트가 커지면 도메인별로 핸들러를 분리하게 됩니다. 이때 우선순위를 명시해야 합니다.

```java
@RestControllerAdvice(basePackages = "com.myapp.api.user")
@Order(1)  // 높은 우선순위 (숫자가 작을수록 먼저)
public class UserExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException e) {
        // User 도메인 전용 처리
    }
}

@RestControllerAdvice
@Order(Ordered.LOWEST_PRECEDENCE)  // 마지막 방어선
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusiness(BusinessException e) {
        // 모든 도메인 공통 처리
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleAll(Exception e) {
        // 최종 fallback
    }
}
```

**실무 패턴: 3계층 핸들러 구조**

```
[1] 도메인별 핸들러 (@Order(1))
    - UserExceptionHandler
    - OrderExceptionHandler
    → 도메인 특화 예외만 처리

[2] 공통 비즈니스 핸들러 (@Order(10))
    - BusinessExceptionHandler
    → BusinessException 계열 통합 처리

[3] 글로벌 핸들러 (@Order(LOWEST_PRECEDENCE))
    - GlobalExceptionHandler
    → Validation, 인증, 500 등 최종 방어선
```

---

## 3) @ExceptionHandler 심화

### 3-1) 기본 사용

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

### 3-2) 핸들러 메서드가 받을 수 있는 파라미터

@ExceptionHandler 메서드는 예외 객체 외에도 다양한 파라미터를 주입받을 수 있습니다.

```java
@ExceptionHandler(UserNotFoundException.class)
public ResponseEntity<ErrorResponse> handleUserNotFound(
        UserNotFoundException e,           // 예외 객체
        HttpServletRequest request,        // 요청 정보 (URI, method 등)
        HttpServletResponse response,      // 응답 객체 직접 제어
        WebRequest webRequest,             // Spring 추상화 요청
        Locale locale,                     // 다국어 지원 시
        HandlerMethod handlerMethod        // 예외 발생한 컨트롤러 메서드 정보
) {
    log.warn("[{}] {} - {} (handler: {}#{})",
        request.getMethod(),
        request.getRequestURI(),
        e.getMessage(),
        handlerMethod.getBeanType().getSimpleName(),
        handlerMethod.getMethod().getName()
    );

    ErrorResponse error = ErrorResponse.builder()
        .errorCode("USER_NOT_FOUND")
        .message(e.getMessage())
        .path(request.getRequestURI())
        .timestamp(LocalDateTime.now())
        .build();

    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
}
```

### 3-3) 컨트롤러 내부 핸들러 vs 글로벌 핸들러

컨트롤러 내부에 @ExceptionHandler를 두면 해당 컨트롤러에서 발생한 예외를 가장 먼저 잡습니다.

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    // 이 컨트롤러에서 발생한 예외만 잡음 (글로벌보다 우선)
    @ExceptionHandler(OptimisticLockException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLock(OptimisticLockException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ErrorResponse.builder()
                .errorCode("ORDER_CONCURRENT_MODIFICATION")
                .message("주문이 다른 사용자에 의해 수정되었습니다. 다시 시도해주세요.")
                .timestamp(LocalDateTime.now())
                .build());
    }

    @PostMapping("/{id}/confirm")
    public ResponseEntity<Order> confirmOrder(@PathVariable Long id) {
        return ResponseEntity.ok(orderService.confirm(id));
    }
}
```

**사용 시 주의**:
- 컨트롤러 내부 핸들러가 많아지면 관리가 어려워집니다.
- 도메인 특화된 예외(낙관적 락 충돌 등)에만 제한적으로 사용하세요.
- 대부분의 예외는 @ControllerAdvice에서 중앙 관리가 바람직합니다.

---

## 4) ResponseStatusException (Spring 5+)

### 4-1) 기본 사용법

커스텀 예외 클래스를 만들지 않고도 빠르게 상태 코드를 지정할 수 있습니다.

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(
                HttpStatus.NOT_FOUND,
                "사용자를 찾을 수 없습니다: ID=" + id
            ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        if (!userRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "삭제 대상 없음");
        }
        if (!currentUser.hasRole("ADMIN")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "관리자만 삭제 가능");
        }
        userRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}
```

### 4-2) 원인 예외 체인 연결

```java
try {
    externalApiClient.call();
} catch (ExternalApiException e) {
    throw new ResponseStatusException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "외부 API 호출 실패",
        e  // cause 연결 → 로그에 원본 스택 트레이스 포함
    );
}
```

### 4-3) @ResponseStatus vs ResponseStatusException 비교

| 구분 | @ResponseStatus | ResponseStatusException |
|------|----------------|------------------------|
| 적용 대상 | 예외 클래스에 선언 | 던지는 시점에 지정 |
| 유연성 | 클래스당 상태 코드 고정 | 상황별 다른 상태 코드 가능 |
| 메시지 | reason 고정 | 동적 메시지 가능 |
| cause 연결 | 불가 | 가능 |
| 추천 시점 | 단순한 매핑 | 동적/조건부 응답 |

```java
// @ResponseStatus 방식: 클래스에 고정
@ResponseStatus(HttpStatus.NOT_FOUND)
public class UserNotFoundException extends RuntimeException {
    public UserNotFoundException(String message) { super(message); }
}

// ResponseStatusException 방식: 던지는 곳에서 유연하게
throw new ResponseStatusException(HttpStatus.NOT_FOUND, "동적 메시지");
```

---

## 5) RFC 9457 Problem Details (Spring 6 / Boot 3+)

### 5-1) Problem Details란?

HTTP API 에러 응답을 표준화한 RFC입니다. Spring 6부터 기본 지원합니다.

```json
{
  "type": "https://api.example.com/errors/user-not-found",
  "title": "User Not Found",
  "status": 404,
  "detail": "사용자 ID 999를 찾을 수 없습니다.",
  "instance": "/api/users/999",
  "timestamp": "2025-12-16T10:30:00Z"
}
```

### 5-2) Spring Boot 3에서 활성화

```yaml
# application.yml
spring:
  mvc:
    problemdetails:
      enabled: true  # Spring Boot 3.0+에서 RFC 9457 자동 적용
```

### 5-3) 커스텀 Problem Details 핸들러

```java
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ProblemDetail handleUserNotFound(UserNotFoundException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.NOT_FOUND,
            e.getMessage()
        );
        problem.setTitle("User Not Found");
        problem.setType(URI.create("https://api.example.com/errors/user-not-found"));
        problem.setProperty("errorCode", "U001");           // 커스텀 필드 확장
        problem.setProperty("timestamp", Instant.now());
        return problem;
    }

    @ExceptionHandler(BusinessException.class)
    public ProblemDetail handleBusinessException(BusinessException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            e.getErrorCode().getStatus(),
            e.getMessage()
        );
        problem.setTitle(e.getErrorCode().name());
        problem.setProperty("errorCode", e.getErrorCode().getCode());
        problem.setProperty("timestamp", Instant.now());
        return problem;
    }
}
```

### 5-4) ResponseEntityExceptionHandler 상속의 이점

```java
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {
    // 이 클래스를 상속하면 Spring 내장 예외(MethodArgumentNotValidException,
    // HttpRequestMethodNotSupportedException 등)에 대한 기본 처리를
    // Problem Details 형식으로 자동 제공합니다.
    //
    // 필요한 예외만 오버라이드해서 커스터마이징하면 됩니다.

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {

        ProblemDetail problem = ProblemDetail.forStatus(status);
        problem.setTitle("Validation Failed");

        List<Map<String, String>> fieldErrors = ex.getBindingResult()
            .getFieldErrors().stream()
            .map(error -> Map.of(
                "field", error.getField(),
                "message", Objects.requireNonNullElse(error.getDefaultMessage(), ""),
                "rejected", String.valueOf(error.getRejectedValue())
            ))
            .toList();

        problem.setProperty("fieldErrors", fieldErrors);
        problem.setProperty("timestamp", Instant.now());

        return ResponseEntity.status(status).body(problem);
    }
}
```

---

## 6) Filter/Interceptor 레벨 예외 처리

### 6-1) @ExceptionHandler가 잡지 못하는 영역

```
[Filter Chain]        ← 여기서 터진 예외는 @ExceptionHandler 못 잡음
  │
  └→ [DispatcherServlet]
       │
       └→ [Interceptor preHandle]  ← 여기도 (조건부)
            │
            └→ [Controller]        ← 여기서부터 @ExceptionHandler 동작
```

**이유**: @ExceptionHandler는 DispatcherServlet의 `processHandlerException()` 내부에서 동작합니다. Filter는 DispatcherServlet 바깥이므로 체인을 타지 않습니다.

### 6-2) Filter 예외 처리 전략

**방법 1: Filter 내부에서 직접 응답 작성**

```java
@Component
@Order(1)
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private final ObjectMapper objectMapper;

    public ApiKeyAuthFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String apiKey = request.getHeader("X-API-Key");
        if (apiKey == null || !isValidApiKey(apiKey)) {
            // Filter에서 직접 에러 응답 작성
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding("UTF-8");

            ErrorResponse error = ErrorResponse.builder()
                .errorCode("INVALID_API_KEY")
                .message("유효하지 않은 API 키입니다.")
                .timestamp(LocalDateTime.now())
                .build();

            objectMapper.writeValue(response.getOutputStream(), error);
            return;  // 체인 중단
        }

        filterChain.doFilter(request, response);
    }
}
```

**방법 2: 예외를 HandlerExceptionResolver로 위임**

```java
@Component
@Order(1)
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private final HandlerExceptionResolver resolver;

    // Spring이 등록한 HandlerExceptionResolver를 주입
    public ApiKeyAuthFilter(
            @Qualifier("handlerExceptionResolver") HandlerExceptionResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        try {
            filterChain.doFilter(request, response);
        } catch (Exception e) {
            // @ExceptionHandler로 위임 가능!
            resolver.resolveException(request, response, null, e);
        }
    }
}
```

> 방법 2를 사용하면 Filter에서 발생한 예외도 @ControllerAdvice에서 일관되게 처리할 수 있습니다.

### 6-3) Spring Security 필터 예외 처리

Spring Security의 인증/인가 예외는 별도의 진입점을 제공합니다.

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .exceptionHandling(ex -> ex
                // 인증 실패 (401)
                .authenticationEntryPoint((request, response, authException) -> {
                    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.setCharacterEncoding("UTF-8");
                    response.getWriter().write("""
                        {
                          "errorCode": "AUTHENTICATION_REQUIRED",
                          "message": "인증이 필요합니다.",
                          "path": "%s"
                        }
                        """.formatted(request.getRequestURI()));
                })
                // 인가 실패 (403)
                .accessDeniedHandler((request, response, accessDeniedException) -> {
                    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.setCharacterEncoding("UTF-8");
                    response.getWriter().write("""
                        {
                          "errorCode": "ACCESS_DENIED",
                          "message": "접근 권한이 없습니다.",
                          "path": "%s"
                        }
                        """.formatted(request.getRequestURI()));
                })
            )
            .build();
    }
}
```

---

## 7) DefaultHandlerExceptionResolver가 처리하는 Spring 내장 예외

DispatcherServlet이 던지는 표준 예외들은 DefaultHandlerExceptionResolver가 자동 처리합니다.

| 예외 | HTTP 상태 코드 | 발생 상황 |
|------|--------------|----------|
| `HttpRequestMethodNotSupportedException` | 405 | GET 전용 엔드포인트에 POST 요청 |
| `HttpMediaTypeNotSupportedException` | 415 | Content-Type 불일치 |
| `HttpMediaTypeNotAcceptableException` | 406 | Accept 헤더에 맞는 응답 불가 |
| `MissingServletRequestParameterException` | 400 | 필수 쿼리 파라미터 누락 |
| `MissingPathVariableException` | 500 | @PathVariable 매핑 실패 |
| `MethodArgumentTypeMismatchException` | 400 | 타입 변환 실패 (문자열 → 숫자) |
| `MethodArgumentNotValidException` | 400 | @Valid 검증 실패 |
| `BindException` | 400 | 바인딩 오류 |
| `NoHandlerFoundException` | 404 | 매핑된 핸들러 없음 |
| `AsyncRequestTimeoutException` | 503 | 비동기 요청 타임아웃 |

> **주의**: `NoHandlerFoundException`이 발생하려면 아래 설정이 필요합니다.
>
> ```yaml
> spring:
>   mvc:
>     throw-exception-if-no-handler-found: true
>   web:
>     resources:
>       add-mappings: false
> ```

---

## 8) 예외 핸들러 테스트 (@WebMvcTest)

### 8-1) 기본 테스트 구조

```java
@WebMvcTest(UserController.class)
@Import(GlobalExceptionHandler.class)  // 핸들러를 컨텍스트에 포함
class UserExceptionHandlerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private UserService userService;

    @Test
    @DisplayName("존재하지 않는 사용자 조회 시 404 + 에러 응답 반환")
    void getUser_NotFound_Returns404() throws Exception {
        // given
        given(userService.findById(999L))
            .willThrow(new UserNotFoundException(999L));

        // when & then
        mockMvc.perform(get("/api/users/{id}", 999L)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.errorCode").value("USER_NOT_FOUND"))
            .andExpect(jsonPath("$.message").value("사용자를 찾을 수 없습니다: ID=999"))
            .andExpect(jsonPath("$.timestamp").exists())
            .andExpect(jsonPath("$.path").value("/api/users/999"))
            .andDo(print());
    }

    @Test
    @DisplayName("Validation 실패 시 400 + 필드 에러 목록 반환")
    void createUser_InvalidInput_Returns400() throws Exception {
        // given
        String invalidBody = """
            {
              "name": "",
              "email": "not-an-email"
            }
            """;

        // when & then
        mockMvc.perform(post("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalidBody))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.fieldErrors").isArray())
            .andExpect(jsonPath("$.fieldErrors[0].field").exists())
            .andDo(print());
    }

    @Test
    @DisplayName("예기치 않은 예외 시 500 + 메시지 은닉")
    void getUser_UnexpectedError_Returns500WithGenericMessage() throws Exception {
        // given
        given(userService.findById(1L))
            .willThrow(new RuntimeException("DB connection failed"));

        // when & then
        mockMvc.perform(get("/api/users/{id}", 1L))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.errorCode").value("INTERNAL_SERVER_ERROR"))
            .andExpect(jsonPath("$.message").value("서버 오류가 발생했습니다."))
            // 내부 메시지("DB connection failed")가 노출되지 않는지 확인
            .andExpect(jsonPath("$.message").value(
                Matchers.not(Matchers.containsString("DB connection"))))
            .andDo(print());
    }
}
```

### 8-2) 테스트 핵심 포인트

```java
// ✅ 좋은 테스트: 에러 응답 구조 전체를 검증
.andExpect(jsonPath("$.errorCode").value("USER_NOT_FOUND"))     // 에러 코드
.andExpect(jsonPath("$.message").exists())                       // 메시지 존재
.andExpect(jsonPath("$.path").value("/api/users/999"))          // 경로
.andExpect(jsonPath("$.timestamp").exists())                     // 타임스탬프

// ❌ 나쁜 테스트: 상태 코드만 검증
.andExpect(status().isNotFound())  // 이것만으로는 응답 형식 보장 불가
```

---

## 9) 실무 안티패턴 7가지

### ❌ 1. catch(Exception e) 남발

```java
// BAD: 모든 예외를 뭉뚱그려 처리
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handleAll(Exception e) {
    return ResponseEntity.badRequest().body(e.getMessage());  // 500인데 400?
}

// GOOD: 예외 계층별로 구분
@ExceptionHandler(BusinessException.class)   // 비즈니스 예외 → 4xx
@ExceptionHandler(Exception.class)           // 나머지 → 500
```

### ❌ 2. 내부 스택 트레이스 노출

```java
// BAD: 운영 환경에서 스택 트레이스가 응답에 포함됨
return ResponseEntity.status(500)
    .body(Map.of("error", e.toString()));  // 클래스명, DB 정보 등 노출!

// GOOD: 운영에서는 제네릭 메시지, 내부에만 로깅
log.error("Unexpected error at {}", request.getRequestURI(), e);
return ResponseEntity.status(500)
    .body(ErrorResponse.of("INTERNAL_SERVER_ERROR", "서버 오류가 발생했습니다."));
```

### ❌ 3. 예외 삼키기 (Silent Swallow)

```java
// BAD: 예외를 로그도 안 남기고 삼킴
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handle(Exception e) {
    return ResponseEntity.ok().build();  // 에러인데 200? 로그도 없음?
}

// GOOD: 최소한 로깅 + 적절한 상태 코드
@ExceptionHandler(Exception.class)
public ResponseEntity<?> handle(Exception e) {
    log.error("Unhandled exception", e);
    return ResponseEntity.status(500).body(genericError());
}
```

### ❌ 4. 예외를 정상 흐름 제어에 사용

```java
// BAD: 예외로 비즈니스 분기 (느리고 의도가 불명확)
try {
    User user = userService.findById(id);
} catch (UserNotFoundException e) {
    user = userService.createDefault(id);  // 예외가 정상 흐름
}

// GOOD: Optional 사용
User user = userService.findById(id)
    .orElseGet(() -> userService.createDefault(id));
```

### ❌ 5. checked 예외 무분별 사용

```java
// BAD: Service에서 checked 예외 → 호출자마다 try-catch 강제
public User findById(Long id) throws UserNotFoundException { ... }

// GOOD: unchecked 예외 (RuntimeException) + 글로벌 핸들러
public User findById(Long id) {
    return userRepository.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id));
}
```

### ❌ 6. HTTP 상태 코드 오용

```java
// BAD: 비즈니스 에러에 200을 반환하고 body로 구분
return ResponseEntity.ok(Map.of("success", false, "error", "not found"));

// GOOD: 의미에 맞는 상태 코드
return ResponseEntity.status(HttpStatus.NOT_FOUND).body(errorResponse);
```

### ❌ 7. @Order 없이 다중 @ControllerAdvice 사용

```java
// BAD: 두 핸들러가 같은 예외를 처리하는데 순서가 불명확
@RestControllerAdvice
public class HandlerA { @ExceptionHandler(BusinessException.class) ... }

@RestControllerAdvice
public class HandlerB { @ExceptionHandler(BusinessException.class) ... }
// 어느 것이 먼저? → 실행 환경마다 다를 수 있음

// GOOD: @Order로 명시
@RestControllerAdvice @Order(1)  public class HandlerA { ... }
@RestControllerAdvice @Order(2)  public class HandlerB { ... }
```

---

## 10) 운영 체크리스트

| # | 항목 | 확인 |
|---|------|------|
| 1 | 모든 API 엔드포인트가 일관된 에러 JSON 형식을 반환하는가? | ☐ |
| 2 | 500 에러 응답에 내부 스택 트레이스/DB 정보가 노출되지 않는가? | ☐ |
| 3 | Exception.class를 잡는 마지막 방어선 핸들러가 있는가? | ☐ |
| 4 | Filter 레벨 예외(인증 등)도 동일한 에러 형식으로 응답하는가? | ☐ |
| 5 | @ControllerAdvice 간 @Order가 명시되어 우선순위가 명확한가? | ☐ |
| 6 | Validation 에러에 필드별 상세 정보가 포함되는가? | ☐ |
| 7 | 에러 로그에 요청 경로/메서드/사용자 식별자가 포함되는가? | ☐ |
| 8 | @WebMvcTest로 주요 예외 시나리오가 테스트되는가? | ☐ |
| 9 | 운영/개발 환경별로 에러 상세 수준이 분리되는가? | ☐ |
| 10 | RFC 9457 Problem Details 적용 여부를 팀에서 합의했는가? (Spring 6+) | ☐ |

---

## 관련 글

- [Spring 예외 처리 (Part 2: 에러 응답 설계, 실무)](/learning/deep-dive/deep-dive-spring-exception-handling-part2/)
- [Spring Validation: 입력 검증 기본](/learning/deep-dive/deep-dive-spring-validation/)
- [Spring Validation: 응답 설계](/learning/deep-dive/deep-dive-spring-validation-response/)
- [Spring Security 아키텍처](/learning/deep-dive/deep-dive-spring-security-architecture/)
- [Spring MVC Request Lifecycle](/learning/deep-dive/deep-dive-spring-mvc-request-lifecycle/)
- [REST API 설계 가이드](/learning/deep-dive/deep-dive-rest-api-design/)
- [로깅 전략](/learning/deep-dive/deep-dive-logging-strategy/)
- [테스트 전략](/learning/deep-dive/deep-dive-testing-strategy/)

---

## 연습(추천)

1. **핸들러 탐색 순서 확인**: 컨트롤러 내부에 @ExceptionHandler를 두고, 동시에 @ControllerAdvice에도 같은 예외 핸들러를 두면 어느 것이 실행되는지 디버그 로그로 확인해보세요.
2. **Filter 예외 위임**: `HandlerExceptionResolver`를 Filter에 주입해서, Filter에서 던진 예외를 @ExceptionHandler로 일관 처리하는 구조를 만들어보세요.
3. **Problem Details 마이그레이션**: 기존 ErrorResponse를 RFC 9457 ProblemDetail로 전환하고, 기존 API 클라이언트와의 하위 호환성을 어떻게 유지할지 설계해보세요.
4. **에러 응답 계약 테스트**: 주요 에러 시나리오(404, 400, 401, 403, 500)에 대해 @WebMvcTest를 작성하고, CI에서 응답 형식이 깨지면 빌드가 실패하도록 구성해보세요.

---

👉 **[다음 편: Spring 예외 처리 (Part 2: 에러 응답 설계, 실무)](/learning/deep-dive/deep-dive-spring-exception-handling-part2/)**
