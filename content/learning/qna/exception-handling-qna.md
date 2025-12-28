---
title: "예외 처리 전략 정리"
study_order: 708
date: 2025-12-01
topic: "Spring"
tags: ["예외처리", "Spring", "ControllerAdvice", "에러처리", "GlobalException"]
categories: ["Spring"]
series: ["핵심 개념 Q&A"]
series_order: 18
draft: false
module: "qna"
---

## Q1. @ControllerAdvice와 @ExceptionHandler를 사용한 글로벌 예외 처리를 설명해주세요.

### 답변

**@ControllerAdvice**는 Spring에서 모든 Controller에 대한 전역적인 예외 처리를 담당하는 컴포넌트입니다. **@ExceptionHandler**와 함께 사용하여 중복 코드를 제거하고 일관된 에러 응답을 제공합니다.

#### 기본 구조

```java
@RestControllerAdvice  // @ControllerAdvice + @ResponseBody
@Slf4j
public class GlobalExceptionHandler {

    // 1. 특정 예외 처리
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        log.error("User not found: {}", ex.getMessage());

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("USER_NOT_FOUND")
            .message(ex.getMessage())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(errorResponse);
    }

    // 2. 여러 예외를 동일하게 처리
    @ExceptionHandler({
        IllegalArgumentException.class,
        IllegalStateException.class
    })
    public ResponseEntity<ErrorResponse> handleBadRequest(RuntimeException ex) {
        log.error("Bad request: {}", ex.getMessage());

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("BAD_REQUEST")
            .message(ex.getMessage())
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(errorResponse);
    }

    // 3. Validation 예외 처리
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException ex) {

        Map<String, String> errors = new HashMap<>();

        ex.getBindingResult().getFieldErrors().forEach(error -> {
            errors.put(error.getField(), error.getDefaultMessage());
        });

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("VALIDATION_FAILED")
            .message("입력값 검증 실패")
            .errors(errors)
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(errorResponse);
    }

    // 4. 모든 예외에 대한 Fallback
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleAllExceptions(Exception ex) {
        log.error("Unexpected error occurred", ex);

        ErrorResponse errorResponse = ErrorResponse.builder()
            .code("INTERNAL_SERVER_ERROR")
            .message("서버 내부 오류가 발생했습니다")
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(errorResponse);
    }
}
```

#### ErrorResponse 표준 구조

```java
@Getter
@Builder
@JsonInclude(JsonInclude.Include.NON_NULL)  // null 필드 제외
public class ErrorResponse {

    private String code;              // 에러 코드 (예: USER_NOT_FOUND)
    private String message;           // 사용자에게 보여줄 메시지
    private Map<String, String> errors;  // Validation 에러 상세
    private String path;              // 요청 경로
    private LocalDateTime timestamp;  // 발생 시간

    // 추가 정보 (개발 환경에서만)
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    private String debugMessage;      // 상세 에러 메시지 (스택 트레이스 등)
}
```

#### 계층별 예외 처리 흐름

```
┌─────────────┐
│ Controller  │  요청 처리
└──────┬──────┘
       │
       │ Exception 발생!
       ▼
┌─────────────────────┐
│ @ExceptionHandler   │  1. 해당 Controller 내 @ExceptionHandler 찾기
│ (Controller 내부)   │
└──────┬──────────────┘
       │ 없으면
       ▼
┌─────────────────────┐
│ @ControllerAdvice   │  2. 글로벌 @ExceptionHandler 찾기
│ GlobalExceptionHandler│
└──────┬──────────────┘
       │ 없으면
       ▼
┌─────────────────────┐
│ Spring 기본 처리     │  3. DefaultHandlerExceptionResolver
│ (Whitelabel Error)  │
└─────────────────────┘
```

### 꼬리 질문 1: @ControllerAdvice의 적용 범위를 제한할 수 있나요?

**가능합니다. 특정 패키지나 어노테이션으로 범위를 제한할 수 있습니다.**

```java
// 1. 특정 패키지에만 적용
@RestControllerAdvice(basePackages = "com.example.api.user")
public class UserExceptionHandler {
    // user 패키지의 Controller에서 발생한 예외만 처리
}

// 2. 특정 Controller에만 적용
@RestControllerAdvice(assignableTypes = {UserController.class, OrderController.class})
public class UserOrderExceptionHandler {
    // UserController, OrderController의 예외만 처리
}

// 3. 특정 어노테이션이 붙은 Controller에만 적용
@RestControllerAdvice(annotations = RestController.class)
public class RestControllerExceptionHandler {
    // @RestController가 붙은 Controller의 예외만 처리
}

// 4. 여러 조건 조합
@RestControllerAdvice(
    basePackages = "com.example.api",
    assignableTypes = AdminController.class
)
public class ApiExceptionHandler {
    // com.example.api 패키지 + AdminController 예외 처리
}
```

**실무 예시: API 버전별 예외 처리**

```java
// V1 API 전용 예외 처리
@RestControllerAdvice(basePackages = "com.example.api.v1")
@Order(1)  // 우선순위 높음
public class ApiV1ExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleUserNotFound(UserNotFoundException ex) {
        // V1 응답 형식: 단순한 Map
        return ResponseEntity.status(404).body(Map.of(
            "error", "User not found",
            "userId", ex.getUserId()
        ));
    }
}

// V2 API 전용 예외 처리
@RestControllerAdvice(basePackages = "com.example.api.v2")
@Order(2)
public class ApiV2ExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        // V2 응답 형식: 표준화된 ErrorResponse
        ErrorResponse response = ErrorResponse.builder()
            .code("USER_NOT_FOUND")
            .message("사용자를 찾을 수 없습니다")
            .details(Map.of("userId", ex.getUserId()))
            .timestamp(LocalDateTime.now())
            .build();

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
    }
}
```

### 꼬리 질문 2: Controller 내부의 @ExceptionHandler와 @ControllerAdvice의 우선순위는?

**Controller 내부 @ExceptionHandler가 우선순위가 더 높습니다.**

```java
@RestController
@RequestMapping("/users")
public class UserController {

    // ✅ 이 Controller에서 발생한 UserNotFoundException은 여기서 처리
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<String> handleUserNotFound(UserNotFoundException ex) {
        return ResponseEntity.status(404).body("User not found in Controller");
    }

    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        throw new UserNotFoundException(id);  // Controller의 @ExceptionHandler 호출
    }
}

@RestControllerAdvice
public class GlobalExceptionHandler {

    // ❌ UserController에서 발생한 UserNotFoundException은 여기까지 오지 않음
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        return ResponseEntity.status(404).body(new ErrorResponse("Global handler"));
    }
}
```

---

## Q2. Checked Exception과 Unchecked Exception의 차이와 언제 사용해야 하는지 설명해주세요.

### 답변

#### Checked Exception vs Unchecked Exception

| 구분 | Checked Exception | Unchecked Exception |
|------|-------------------|---------------------|
| **상속** | `Exception` 상속 (RuntimeException 제외) | `RuntimeException` 상속 |
| **컴파일 시점 검사** | 필수 처리 (try-catch 또는 throws) | 선택적 처리 |
| **트랜잭션 롤백** | 롤백 안 됨 (@Transactional 기본) | 롤백 됨 |
| **대표 예외** | IOException, SQLException | NullPointerException, IllegalArgumentException |
| **사용 목적** | 복구 가능한 예외 | 프로그래밍 오류 |

#### Checked Exception

**반드시 처리해야 하는 예외 (컴파일 에러)**

```java
// ❌ 컴파일 에러: Unhandled exception
public void readFile(String path) {
    FileReader reader = new FileReader(path);  // IOException (Checked)
}

// ✅ try-catch로 처리
public void readFile(String path) {
    try {
        FileReader reader = new FileReader(path);
        // 파일 읽기
    } catch (IOException e) {
        log.error("Failed to read file: {}", path, e);
        throw new FileReadException("파일을 읽을 수 없습니다", e);
    }
}

// ✅ 또는 throws로 위임
public void readFile(String path) throws IOException {
    FileReader reader = new FileReader(path);
}
```

**언제 사용?**
- **복구 가능한 상황**: 네트워크 오류, 파일 없음, DB 연결 실패
- **호출자가 처리해야 하는 경우**: API 호출 실패, 외부 시스템 장애

**문제점:**
```java
// Checked Exception의 전파 문제
public void processOrder(Order order) throws SQLException, IOException, RemoteException {
    validateOrder(order);  // throws SQLException
    saveOrder(order);      // throws IOException
    sendNotification(order);  // throws RemoteException
}

// 모든 메서드가 throws를 선언해야 함 → 코드 가독성 저하
```

#### Unchecked Exception

**처리하지 않아도 컴파일되는 예외**

```java
// 컴파일 에러 없음
public void divide(int a, int b) {
    int result = a / b;  // ArithmeticException 발생 가능
}

// 명시적 처리 (선택)
public void divide(int a, int b) {
    if (b == 0) {
        throw new IllegalArgumentException("0으로 나눌 수 없습니다");
    }
    int result = a / b;
}
```

**언제 사용?**
- **프로그래밍 오류**: null 참조, 잘못된 인자, 배열 인덱스 초과
- **복구 불가능한 상황**: OutOfMemoryError, StackOverflowError
- **비즈니스 규칙 위반**: 재고 부족, 권한 없음

#### 실무 권장 사항

**Custom Exception 설계 (Unchecked 권장)**

```java
// ✅ RuntimeException 상속 (Unchecked)
public class BusinessException extends RuntimeException {

    private final ErrorCode errorCode;

    public BusinessException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public BusinessException(ErrorCode errorCode, Throwable cause) {
        super(errorCode.getMessage(), cause);
        this.errorCode = errorCode;
    }
}

// 구체적인 예외 클래스
public class UserNotFoundException extends BusinessException {
    public UserNotFoundException(Long userId) {
        super(ErrorCode.USER_NOT_FOUND);
    }
}

public class InsufficientStockException extends BusinessException {
    public InsufficientStockException(Long productId, int requested, int available) {
        super(ErrorCode.INSUFFICIENT_STOCK);
    }
}

// 사용
@Service
public class OrderService {

    @Transactional
    public Order createOrder(OrderRequest request) {
        User user = userRepository.findById(request.getUserId())
            .orElseThrow(() -> new UserNotFoundException(request.getUserId()));

        Product product = productRepository.findById(request.getProductId())
            .orElseThrow(() -> new ProductNotFoundException(request.getProductId()));

        if (product.getStock() < request.getQuantity()) {
            throw new InsufficientStockException(
                product.getId(),
                request.getQuantity(),
                product.getStock()
            );
        }

        // 주문 생성
        return orderRepository.save(order);
    }
}
```

### 꼬리 질문 1: 왜 Spring에서는 Unchecked Exception을 권장하나요?

**이유 3가지:**

##### 1. 트랜잭션 롤백

```java
@Transactional
public void createUser(UserRequest request) throws Exception {  // Checked
    User user = new User(request.getName());
    userRepository.save(user);

    if (isDuplicate(user.getEmail())) {
        throw new Exception("Email already exists");  // ❌ 롤백 안 됨!
    }
}

// ✅ Unchecked Exception 사용 시 자동 롤백
@Transactional
public void createUser(UserRequest request) {
    User user = new User(request.getName());
    userRepository.save(user);

    if (isDuplicate(user.getEmail())) {
        throw new DuplicateEmailException(user.getEmail());  // ✅ 자동 롤백
    }
}

// Checked Exception을 롤백하려면 명시 필요
@Transactional(rollbackFor = Exception.class)
public void createUser(UserRequest request) throws Exception {
    // ...
}
```

##### 2. 코드 가독성

```java
// ❌ Checked Exception: throws 지옥
public void processOrder(Order order)
    throws UserNotFoundException,
           ProductNotFoundException,
           InsufficientStockException,
           PaymentException,
           NotificationException {
    // ...
}

// ✅ Unchecked Exception: 깔끔한 메서드 시그니처
public void processOrder(Order order) {
    // 예외는 @ControllerAdvice에서 일괄 처리
}
```

##### 3. 람다 표현식 호환

```java
// ❌ Checked Exception은 람다에서 사용 불편
List<User> users = userIds.stream()
    .map(id -> {
        try {
            return userRepository.findById(id)
                .orElseThrow(() -> new Exception("User not found"));  // Checked
        } catch (Exception e) {
            throw new RuntimeException(e);  // 억지로 변환
        }
    })
    .collect(Collectors.toList());

// ✅ Unchecked Exception
List<User> users = userIds.stream()
    .map(id -> userRepository.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id)))  // 깔끔
    .collect(Collectors.toList());
```

### 꼬리 질문 2: Checked Exception을 Unchecked Exception으로 변환하는 패턴은?

```java
// 1. 생성자에 cause 전달
public class FileProcessException extends RuntimeException {
    public FileProcessException(String message, Throwable cause) {
        super(message, cause);
    }
}

public void processFile(String path) {
    try {
        Files.readAllLines(Paths.get(path));  // IOException (Checked)
    } catch (IOException e) {
        throw new FileProcessException("Failed to process file: " + path, e);
    }
}

// 2. 공통 예외 변환 유틸리티
public class ExceptionUtils {

    public static <T> T uncheck(CheckedSupplier<T> supplier) {
        try {
            return supplier.get();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

@FunctionalInterface
public interface CheckedSupplier<T> {
    T get() throws Exception;
}

// 사용
String content = ExceptionUtils.uncheck(() ->
    Files.readString(Paths.get("file.txt"))
);
```

---

## Q3. 계층별 예외 처리 전략과 에러 코드 관리 방법을 설명해주세요.

### 답변

#### 계층별 예외 처리 전략

```
┌────────────────┐
│ Presentation   │  Controller  → HTTP 상태 코드 + ErrorResponse 반환
│    Layer       │
└────────┬───────┘
         │ BusinessException
┌────────▼───────┐
│ Application    │  Service     → 비즈니스 예외 발생
│    Layer       │
└────────┬───────┘
         │ Entity 도메인 예외
┌────────▼───────┐
│ Domain         │  Entity      → 도메인 규칙 검증
│    Layer       │
└────────┬───────┘
         │ DataAccessException
┌────────▼───────┐
│ Infrastructure │  Repository  → DB 예외를 비즈니스 예외로 변환
│    Layer       │
└────────────────┘
```

#### 1. Domain Layer (엔티티 검증)

```java
@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String email;
    private String name;
    private int age;

    @Enumerated(EnumType.STRING)
    private UserStatus status;

    // 정적 팩토리 메서드로 생성 시점 검증
    public static User create(String email, String name, int age) {
        validateEmail(email);
        validateName(name);
        validateAge(age);

        User user = new User();
        user.email = email;
        user.name = name;
        user.age = age;
        user.status = UserStatus.ACTIVE;
        return user;
    }

    // 도메인 규칙 검증
    private static void validateEmail(String email) {
        if (email == null || !email.matches("^[A-Za-z0-9+_.-]+@(.+)$")) {
            throw new InvalidEmailException(email);
        }
    }

    private static void validateName(String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new InvalidNameException("이름은 필수입니다");
        }
        if (name.length() > 50) {
            throw new InvalidNameException("이름은 50자를 초과할 수 없습니다");
        }
    }

    private static void validateAge(int age) {
        if (age < 0 || age > 150) {
            throw new InvalidAgeException(age);
        }
    }

    // 상태 변경 메서드
    public void deactivate() {
        if (this.status == UserStatus.DELETED) {
            throw new UserAlreadyDeletedException(this.id);
        }
        this.status = UserStatus.INACTIVE;
    }
}
```

#### 2. Application Layer (비즈니스 로직)

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final UserRepository userRepository;
    private final ProductRepository productRepository;
    private final PaymentClient paymentClient;

    @Transactional
    public Order createOrder(OrderRequest request) {
        // 1. 사용자 조회
        User user = userRepository.findById(request.getUserId())
            .orElseThrow(() -> new UserNotFoundException(request.getUserId()));

        // 2. 상품 조회
        Product product = productRepository.findById(request.getProductId())
            .orElseThrow(() -> new ProductNotFoundException(request.getProductId()));

        // 3. 비즈니스 규칙 검증
        if (!user.isActive()) {
            throw new InactiveUserException(user.getId());
        }

        if (product.getStock() < request.getQuantity()) {
            throw new InsufficientStockException(
                product.getId(),
                request.getQuantity(),
                product.getStock()
            );
        }

        // 4. 주문 생성
        Order order = Order.create(user, product, request.getQuantity());

        // 5. 재고 차감
        product.decreaseStock(request.getQuantity());

        // 6. 주문 저장
        Order savedOrder = orderRepository.save(order);

        // 7. 외부 API 호출 (결제)
        try {
            paymentClient.processPayment(savedOrder);
        } catch (PaymentException e) {
            log.error("Payment failed for order: {}", savedOrder.getId(), e);
            throw new OrderPaymentFailedException(savedOrder.getId(), e);
        }

        return savedOrder;
    }
}
```

#### 3. Infrastructure Layer (DB 예외 변환)

```java
@Repository
@RequiredArgsConstructor
public class UserRepositoryImpl implements UserRepositoryCustom {

    private final JPAQueryFactory queryFactory;

    @Override
    public List<User> findActiveUsers() {
        try {
            return queryFactory
                .selectFrom(user)
                .where(user.status.eq(UserStatus.ACTIVE))
                .fetch();

        } catch (DataAccessException e) {
            log.error("Failed to fetch active users", e);
            throw new UserDataAccessException("사용자 조회 중 오류가 발생했습니다", e);
        }
    }
}
```

#### 4. Presentation Layer (HTTP 응답)

```java
@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    @PostMapping
    public ResponseEntity<OrderResponse> createOrder(@Valid @RequestBody OrderRequest request) {
        // 예외는 @ControllerAdvice에서 처리
        Order order = orderService.createOrder(request);
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(OrderResponse.from(order));
    }
}

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        ErrorResponse response = ErrorResponse.of(ex.getErrorCode());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
    }

    @ExceptionHandler(InsufficientStockException.class)
    public ResponseEntity<ErrorResponse> handleInsufficientStock(InsufficientStockException ex) {
        ErrorResponse response = ErrorResponse.of(
            ex.getErrorCode(),
            Map.of(
                "productId", ex.getProductId(),
                "requested", ex.getRequested(),
                "available", ex.getAvailable()
            )
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
    }
}
```

#### 에러 코드 관리 (Enum)

```java
@Getter
@RequiredArgsConstructor
public enum ErrorCode {

    // Common (1xxx)
    INVALID_INPUT_VALUE(1001, "잘못된 입력값입니다", HttpStatus.BAD_REQUEST),
    INTERNAL_SERVER_ERROR(1002, "서버 내부 오류가 발생했습니다", HttpStatus.INTERNAL_SERVER_ERROR),

    // User (2xxx)
    USER_NOT_FOUND(2001, "사용자를 찾을 수 없습니다", HttpStatus.NOT_FOUND),
    DUPLICATE_EMAIL(2002, "이미 사용 중인 이메일입니다", HttpStatus.CONFLICT),
    INACTIVE_USER(2003, "비활성화된 사용자입니다", HttpStatus.FORBIDDEN),
    INVALID_EMAIL(2004, "유효하지 않은 이메일 형식입니다", HttpStatus.BAD_REQUEST),

    // Product (3xxx)
    PRODUCT_NOT_FOUND(3001, "상품을 찾을 수 없습니다", HttpStatus.NOT_FOUND),
    INSUFFICIENT_STOCK(3002, "재고가 부족합니다", HttpStatus.BAD_REQUEST),

    // Order (4xxx)
    ORDER_NOT_FOUND(4001, "주문을 찾을 수 없습니다", HttpStatus.NOT_FOUND),
    ORDER_PAYMENT_FAILED(4002, "결제 처리에 실패했습니다", HttpStatus.PAYMENT_REQUIRED),
    ORDER_ALREADY_CANCELLED(4003, "이미 취소된 주문입니다", HttpStatus.BAD_REQUEST),

    // Auth (5xxx)
    UNAUTHORIZED(5001, "인증이 필요합니다", HttpStatus.UNAUTHORIZED),
    ACCESS_DENIED(5002, "접근 권한이 없습니다", HttpStatus.FORBIDDEN),
    INVALID_TOKEN(5003, "유효하지 않은 토큰입니다", HttpStatus.UNAUTHORIZED),
    TOKEN_EXPIRED(5004, "토큰이 만료되었습니다", HttpStatus.UNAUTHORIZED);

    private final int code;
    private final String message;
    private final HttpStatus httpStatus;
}

// 사용
public class UserNotFoundException extends BusinessException {
    public UserNotFoundException(Long userId) {
        super(ErrorCode.USER_NOT_FOUND, "userId: " + userId);
    }
}
```

### 꼬리 질문 1: 외부 API 호출 시 예외 처리는 어떻게 하나요?

```java
@Component
@Slf4j
public class PaymentClient {

    @Autowired
    private RestTemplate restTemplate;

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    public PaymentResponse processPayment(PaymentRequest request) {
        CircuitBreaker circuitBreaker = circuitBreakerRegistry.circuitBreaker("payment");

        try {
            return circuitBreaker.executeSupplier(() -> {
                try {
                    ResponseEntity<PaymentResponse> response = restTemplate.postForEntity(
                        "https://payment-api.example.com/process",
                        request,
                        PaymentResponse.class
                    );

                    if (!response.getStatusCode().is2xxSuccessful()) {
                        throw new PaymentException("Payment failed with status: " + response.getStatusCode());
                    }

                    return response.getBody();

                } catch (HttpClientErrorException e) {
                    // 4xx 에러 → 재시도 불필요
                    log.error("Payment client error: {}", e.getMessage());
                    throw new PaymentClientException("결제 요청이 거부되었습니다", e);

                } catch (HttpServerErrorException e) {
                    // 5xx 에러 → 재시도 가능
                    log.error("Payment server error: {}", e.getMessage());
                    throw new PaymentServerException("결제 서버 오류", e);

                } catch (ResourceAccessException e) {
                    // 네트워크 오류
                    log.error("Payment network error: {}", e.getMessage());
                    throw new PaymentNetworkException("결제 서버 연결 실패", e);
                }
            });

        } catch (CallNotPermittedException e) {
            // Circuit Breaker Open 상태
            log.error("Circuit breaker is open for payment service");
            throw new PaymentUnavailableException("결제 서비스를 일시적으로 사용할 수 없습니다", e);
        }
    }
}

// Resilience4j 설정
resilience4j:
  circuitbreaker:
    instances:
      payment:
        failureRateThreshold: 50
        waitDurationInOpenState: 30000
        slidingWindowSize: 10
        minimumNumberOfCalls: 5
```

### 꼬리 질문 2: 동일한 예외를 다른 HTTP 상태 코드로 반환해야 한다면?

```java
// Context에 따라 다른 응답
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(
            UserNotFoundException ex,
            HttpServletRequest request) {

        String path = request.getRequestURI();

        // Admin API: 404 (사용자 없음)
        if (path.startsWith("/api/admin")) {
            ErrorResponse response = ErrorResponse.of(ErrorCode.USER_NOT_FOUND);
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
        }

        // Public API: 403 (보안상 사용자 존재 여부 숨김)
        ErrorResponse response = ErrorResponse.of(ErrorCode.ACCESS_DENIED);
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(response);
    }
}
```

---

## Q4. 비동기 처리 시 예외 처리 방법을 설명해주세요.

### 답변

#### @Async 메서드의 예외 처리

**일반 메서드와 다른 점: 호출자가 예외를 받지 못함**

```java
// ❌ 잘못된 예외 처리
@Service
public class NotificationService {

    @Async
    public void sendEmail(String email, String message) {
        // 예외 발생 시 호출자가 알 수 없음!
        throw new EmailSendException("Failed to send email");
    }
}

@RestController
public class UserController {

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody UserRequest request) {
        User user = userService.createUser(request);

        try {
            notificationService.sendEmail(user.getEmail(), "Welcome!");  // ❌ 예외를 잡을 수 없음
        } catch (EmailSendException e) {
            // 여기로 오지 않음!
        }

        return ResponseEntity.ok(user);
    }
}
```

#### 해결 방법 1: AsyncUncaughtExceptionHandler

```java
// 1. 전역 비동기 예외 핸들러
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return new CustomAsyncExceptionHandler();
    }
}

@Slf4j
public class CustomAsyncExceptionHandler implements AsyncUncaughtExceptionHandler {

    @Override
    public void handleUncaughtException(Throwable ex, Method method, Object... params) {
        log.error("Async method '{}' threw exception: {}",
            method.getName(),
            ex.getMessage(),
            ex);

        // 슬랙/이메일 알림
        sendAlert(method, ex, params);

        // DB에 실패 로그 저장
        saveFailureLog(method, ex, params);
    }

    private void sendAlert(Method method, Throwable ex, Object... params) {
        // Slack webhook 호출
        String message = String.format(
            "⚠️ Async method failed\nMethod: %s\nError: %s\nParams: %s",
            method.getName(),
            ex.getMessage(),
            Arrays.toString(params)
        );
        slackClient.sendMessage(message);
    }
}
```

#### 해결 방법 2: CompletableFuture 반환

```java
@Service
@Slf4j
public class NotificationService {

    @Async
    public CompletableFuture<Void> sendEmail(String email, String message) {
        try {
            // 이메일 전송 로직
            emailClient.send(email, message);
            log.info("Email sent to {}", email);

            return CompletableFuture.completedFuture(null);

        } catch (Exception e) {
            log.error("Failed to send email to {}", email, e);
            return CompletableFuture.failedFuture(e);
        }
    }

    @Async
    public CompletableFuture<SmsResponse> sendSms(String phone, String message) {
        return CompletableFuture.supplyAsync(() -> {
            // SMS 전송 로직
            return smsClient.send(phone, message);
        });
    }
}

// 사용
@Service
@RequiredArgsConstructor
public class UserService {

    private final NotificationService notificationService;

    @Transactional
    public User createUser(UserRequest request) {
        User user = userRepository.save(new User(request));

        // 비동기 결과 처리
        notificationService.sendEmail(user.getEmail(), "Welcome!")
            .exceptionally(ex -> {
                log.error("Failed to send welcome email to {}", user.getEmail(), ex);
                // 실패해도 사용자 생성은 성공
                return null;
            });

        return user;
    }

    public void sendMultipleNotifications(User user) {
        CompletableFuture<Void> emailFuture = notificationService.sendEmail(
            user.getEmail(), "Hello"
        );

        CompletableFuture<SmsResponse> smsFuture = notificationService.sendSms(
            user.getPhone(), "Hello"
        );

        // 모든 작업 완료 대기
        CompletableFuture.allOf(emailFuture, smsFuture)
            .thenRun(() -> log.info("All notifications sent"))
            .exceptionally(ex -> {
                log.error("Some notifications failed", ex);
                return null;
            });
    }
}
```

#### 해결 방법 3: try-catch 내부 처리

```java
@Service
@Slf4j
public class NotificationService {

    @Async
    public void sendEmailSafely(String email, String message) {
        try {
            emailClient.send(email, message);
            log.info("Email sent to {}", email);

        } catch (EmailSendException e) {
            log.error("Failed to send email to {}", email, e);

            // 실패 처리
            saveFailedNotification(email, message, e);

            // 재시도 큐에 추가
            retryQueue.add(new EmailRetryTask(email, message));

        } catch (Exception e) {
            log.error("Unexpected error while sending email", e);
        }
    }

    private void saveFailedNotification(String email, String message, Exception e) {
        FailedNotification notification = FailedNotification.builder()
            .email(email)
            .message(message)
            .errorMessage(e.getMessage())
            .failedAt(LocalDateTime.now())
            .build();

        failedNotificationRepository.save(notification);
    }
}
```

### 꼬리 질문 1: @Async와 @Transactional을 함께 사용할 때 주의점은?

**문제: @Async 메서드는 별도 스레드에서 실행되므로 트랜잭션이 공유되지 않음**

```java
// ❌ 잘못된 사용
@Service
public class OrderService {

    @Transactional
    public void createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));

        // ❌ 비동기 메서드는 별도 트랜잭션에서 실행
        // 부모 트랜잭션이 롤백되어도 영향 없음
        notificationService.sendOrderConfirmation(order);
    }
}

@Service
public class NotificationService {

    @Async
    @Transactional  // ❌ 별도 트랜잭션!
    public void sendOrderConfirmation(Order order) {
        // order는 영속성 컨텍스트 밖 (LazyInitializationException 가능)
        String productName = order.getProduct().getName();  // ❌

        emailService.send(order.getUserEmail(), productName);
    }
}
```

**✅ 해결 방법:**

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));

        // 1. 필요한 데이터만 추출
        OrderNotificationDto dto = OrderNotificationDto.builder()
            .orderId(order.getId())
            .userEmail(order.getUserEmail())
            .productName(order.getProduct().getName())  // 즉시 로딩
            .build();

        // 2. DTO로 전달
        notificationService.sendOrderConfirmation(dto);
    }
}

@Service
public class NotificationService {

    @Async
    public void sendOrderConfirmation(OrderNotificationDto dto) {
        // 영속성 컨텍스트와 무관한 DTO 사용
        emailService.send(dto.getUserEmail(), dto.getProductName());
    }
}
```

### 꼬리 질문 2: 비동기 작업의 재시도 전략은?

```java
@Service
@Slf4j
public class NotificationService {

    @Retryable(
        value = {EmailSendException.class, NetworkException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 2000, multiplier = 2)
    )
    @Async
    public CompletableFuture<Void> sendEmailWithRetry(String email, String message) {
        log.info("Attempting to send email to {} (attempt)", email);

        try {
            emailClient.send(email, message);
            return CompletableFuture.completedFuture(null);

        } catch (EmailSendException e) {
            log.warn("Email send failed, will retry: {}", e.getMessage());
            throw e;  // @Retryable이 재시도
        }
    }

    @Recover
    public CompletableFuture<Void> recoverFromEmailFailure(
            EmailSendException e,
            String email,
            String message) {

        log.error("Failed to send email after all retries: {}", email, e);

        // Dead Letter Queue에 저장
        deadLetterQueue.add(new FailedEmailTask(email, message));

        return CompletableFuture.failedFuture(
            new EmailSendException("All retries failed")
        );
    }
}
```

---

## Q5. 실무에서 경험한 예외 처리 관련 장애 사례와 해결 방법을 설명해주세요.

### 답변

#### 사례 1: 예외 로그에 민감 정보 노출

**상황:**
- 로그 모니터링 중 사용자 비밀번호, 카드 번호 등 민감 정보 발견
- 예외 메시지에 요청 전체를 포함하여 로깅

**원인:**
```java
// ❌ 문제 코드
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleException(Exception ex, HttpServletRequest request) {
    log.error("Error occurred. Request: {}, Body: {}, Exception: {}",
        request.getRequestURI(),
        getRequestBody(request),  // ⚠️ 비밀번호, 카드번호 포함!
        ex.getMessage()
    );

    return ResponseEntity.status(500).body(new ErrorResponse("Internal server error"));
}
```

**해결 방법:**

```java
// ✅ 민감 정보 마스킹
@Component
public class SensitiveDataMasker {

    private static final List<String> SENSITIVE_FIELDS = List.of(
        "password", "cardNumber", "cvv", "ssn", "accountNumber"
    );

    public Map<String, Object> maskSensitiveData(Map<String, Object> data) {
        Map<String, Object> masked = new HashMap<>(data);

        for (String field : SENSITIVE_FIELDS) {
            if (masked.containsKey(field)) {
                masked.put(field, "***MASKED***");
            }
        }

        return masked;
    }
}

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @Autowired
    private SensitiveDataMasker masker;

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(
            Exception ex,
            HttpServletRequest request) {

        // ✅ 마스킹 후 로깅
        Map<String, Object> requestData = extractRequestData(request);
        Map<String, Object> maskedData = masker.maskSensitiveData(requestData);

        log.error("Error occurred. URI: {}, Masked request: {}, Exception: {}",
            request.getRequestURI(),
            maskedData,
            ex.getMessage(),
            ex
        );

        return ResponseEntity.status(500).body(
            new ErrorResponse("서버 내부 오류가 발생했습니다")
        );
    }
}

// 2. Custom ToString (Lombok)
@ToString(exclude = {"password", "cardNumber"})
public class UserRequest {
    private String email;
    private String password;  // toString()에서 제외
    private String cardNumber;  // toString()에서 제외
}

// 3. Logback 설정에서 민감 정보 필터링
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="ch.qos.logback.core.encoder.LayoutWrappingEncoder">
            <layout class="com.example.MaskingPatternLayout">
                <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
                <maskPattern>"password"\s*:\s*"[^"]*"</maskPattern>
                <maskPattern>"cardNumber"\s*:\s*"[^"]*"</maskPattern>
            </layout>
        </encoder>
    </appender>
</configuration>
```

#### 사례 2: 재시도 로직으로 인한 데이터 중복 생성

**상황:**
- 결제 API 호출 시 네트워크 타임아웃 발생
- @Retryable로 자동 재시도
- 같은 주문이 2번 결제됨

**원인:**
```java
// ❌ 문제 코드
@Service
public class PaymentService {

    @Retryable(value = NetworkException.class, maxAttempts = 3)
    @Transactional
    public Payment processPayment(PaymentRequest request) {
        // 1. Payment 엔티티 생성 및 저장
        Payment payment = paymentRepository.save(new Payment(request));

        // 2. 외부 결제 API 호출
        paymentClient.charge(payment);  // ⚠️ 타임아웃 발생

        // 3. 상태 업데이트
        payment.setStatus(PaymentStatus.COMPLETED);

        return payment;
    }
}

// 재시도 시 문제:
// 1차 시도: Payment 저장 → API 호출 (타임아웃) → 롤백
// 2차 시도: Payment 저장 → API 호출 (성공) ✅
// 문제: 1차 API 호출이 실제로는 성공했을 수 있음 (중복 결제!)
```

**해결 방법:**

```java
// ✅ 멱등성 키 사용
@Service
public class PaymentService {

    @Retryable(value = NetworkException.class, maxAttempts = 3)
    @Transactional
    public Payment processPayment(PaymentRequest request) {
        // 1. 멱등성 키 생성 (주문 ID + 사용자 ID + 금액)
        String idempotencyKey = generateIdempotencyKey(request);

        // 2. 중복 확인
        Optional<Payment> existing = paymentRepository.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            log.warn("Payment already exists for idempotency key: {}", idempotencyKey);
            return existing.get();
        }

        // 3. Payment 생성
        Payment payment = Payment.builder()
            .idempotencyKey(idempotencyKey)
            .amount(request.getAmount())
            .status(PaymentStatus.PENDING)
            .build();

        paymentRepository.save(payment);

        try {
            // 4. 외부 API 호출 (멱등성 키 전달)
            PaymentResponse response = paymentClient.charge(
                payment.getAmount(),
                idempotencyKey  // ✅ 결제사가 중복 방지
            );

            payment.setStatus(PaymentStatus.COMPLETED);
            payment.setTransactionId(response.getTransactionId());

        } catch (NetworkException e) {
            payment.setStatus(PaymentStatus.FAILED);
            throw e;  // 재시도
        }

        return payment;
    }

    private String generateIdempotencyKey(PaymentRequest request) {
        return DigestUtils.sha256Hex(
            request.getOrderId() + ":" +
            request.getUserId() + ":" +
            request.getAmount()
        );
    }
}

// Entity
@Entity
@Table(indexes = @Index(name = "idx_idempotency_key", columnList = "idempotencyKey", unique = true))
public class Payment {
    @Id
    @GeneratedValue
    private Long id;

    @Column(unique = true, nullable = false)
    private String idempotencyKey;  // 멱등성 키

    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    private PaymentStatus status;
}
```

#### 사례 3: 예외 스택 오버플로우 (순환 참조)

**상황:**
- JSON 직렬화 시 StackOverflowError 발생
- 엔티티 간 양방향 관계로 무한 재귀

**원인:**
```java
@Entity
public class User {
    @Id
    private Long id;

    @OneToMany(mappedBy = "user")
    private List<Order> orders;  // ⚠️ 순환 참조
}

@Entity
public class Order {
    @Id
    private Long id;

    @ManyToOne
    private User user;  // ⚠️ 순환 참조
}

// ❌ 예외 발생
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleException(Exception ex) {
    log.error("Error: {}", ex);  // ⚠️ ex.toString()에서 순환 참조 → StackOverflowError

    return ResponseEntity.status(500).body(new ErrorResponse(ex.getMessage()));
}
```

**해결 방법:**

```java
// 1. @JsonIgnore 사용
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @JsonIgnore  // ✅ JSON 직렬화 시 무시
    private List<Order> orders;
}

// 2. @JsonManagedReference / @JsonBackReference
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @JsonManagedReference  // ✅ 정방향 참조
    private List<Order> orders;
}

@Entity
public class Order {
    @ManyToOne
    @JsonBackReference  // ✅ 역방향 참조 (직렬화 제외)
    private User user;
}

// 3. DTO 변환 (권장)
@Getter
@Builder
public class UserResponse {
    private Long id;
    private String name;
    private List<OrderSummary> orders;  // ✅ 간소화된 DTO

    public static UserResponse from(User user) {
        return UserResponse.builder()
            .id(user.getId())
            .name(user.getName())
            .orders(user.getOrders().stream()
                .map(OrderSummary::from)
                .collect(Collectors.toList()))
            .build();
    }
}

// 4. 로그 메시지 안전하게 출력
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorResponse> handleException(Exception ex) {
    // ✅ 스택 트레이스를 문자열로 변환 (깊이 제한)
    StringWriter sw = new StringWriter();
    ex.printStackTrace(new PrintWriter(sw));
    String stackTrace = sw.toString();

    // 처음 10줄만 로깅
    String limitedStackTrace = Arrays.stream(stackTrace.split("\n"))
        .limit(10)
        .collect(Collectors.joining("\n"));

    log.error("Error: {}\nStack trace (limited):\n{}", ex.getMessage(), limitedStackTrace);

    return ResponseEntity.status(500).body(new ErrorResponse("Internal server error"));
}
```

---

## 요약

### @ControllerAdvice 글로벌 예외 처리
- @RestControllerAdvice로 전역 예외 처리
- ErrorResponse 표준 구조 정의
- 특정 패키지/Controller로 적용 범위 제한 가능
- Controller 내부 @ExceptionHandler가 우선순위 높음

### Checked vs Unchecked Exception
- Checked: 복구 가능한 예외, 컴파일 시점 검사
- Unchecked: 프로그래밍 오류, 런타임 예외
- Spring에서는 Unchecked 권장 (트랜잭션 롤백, 코드 가독성)
- Custom Exception은 RuntimeException 상속

### 계층별 예외 처리
- Domain: 도메인 규칙 검증 (InvalidEmailException)
- Application: 비즈니스 로직 예외 (InsufficientStockException)
- Infrastructure: DB 예외를 비즈니스 예외로 변환
- Presentation: HTTP 상태 코드 + ErrorResponse 반환
- ErrorCode Enum으로 중앙 관리

### 비동기 예외 처리
- @Async 메서드는 호출자가 예외를 받지 못함
- AsyncUncaughtExceptionHandler로 전역 처리
- CompletableFuture 반환으로 예외 처리 가능
- @Async + @Transactional: 별도 트랜잭션, DTO 전달 필요

### 실무 주의사항
- 예외 로그에 민감 정보 마스킹 (password, cardNumber)
- 재시도 시 멱등성 키 사용 (중복 방지)
- 엔티티 순환 참조 방지 (@JsonIgnore, DTO 변환)
- 외부 API: Circuit Breaker, Retry, Fallback

---

## 🔗 Related Deep Dive

더 깊이 있는 학습을 원한다면 심화 과정을 참고하세요:

- **[Spring MVC 요청 흐름](/learning/deep-dive/deep-dive-spring-mvc-request-lifecycle/)**: ExceptionHandler 동작 위치.
- **[Circuit Breaker 패턴](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/)**: 외부 API 장애 대응.
