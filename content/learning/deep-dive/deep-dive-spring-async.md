---
title: "Spring 비동기 프로그래밍: @Async와 CompletableFuture"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Async", "CompletableFuture", "Thread Pool", "Non-blocking"]
categories: ["Backend Deep Dive"]
description: "@Async로 비동기 처리를 구현하고 CompletableFuture로 효율적인 병렬 처리하기"
module: "spring-core"
study_order: 160
---

## 이 글에서 얻는 것

- **@Async**로 비동기 메서드를 만들 수 있습니다.
- **CompletableFuture**로 비동기 작업을 조합할 수 있습니다.
- **ThreadPoolTaskExecutor**로 스레드 풀을 설정할 수 있습니다.
- **비동기 예외 처리**를 구현할 수 있습니다.

## 0) 비동기 처리는 "대기 시간을 활용"한다

### 문제 상황: 동기 처리

```java
@Service
public class OrderService {

    public OrderResult processOrder(Order order) {
        // 1. 결제 처리 (500ms)
        paymentService.processPayment(order);

        // 2. 이메일 발송 (300ms)
        emailService.sendConfirmation(order);

        // 3. SMS 발송 (200ms)
        smsService.sendNotification(order);

        // 총 소요 시간: 500 + 300 + 200 = 1000ms
        return new OrderResult(order);
    }
}
```

**문제점:**
- 순차 실행 → 총 1초 소요
- 이메일/SMS는 결제와 독립적인데 기다려야 함
- 사용자 응답 시간 증가

### 해결: 비동기 처리

```java
@Service
public class OrderService {

    @Async
    public CompletableFuture<Void> sendEmailAsync(Order order) {
        emailService.sendConfirmation(order);
        return CompletableFuture.completedFuture(null);
    }

    @Async
    public CompletableFuture<Void> sendSmsAsync(Order order) {
        smsService.sendNotification(order);
        return CompletableFuture.completedFuture(null);
    }

    public OrderResult processOrder(Order order) {
        // 1. 결제 처리 (동기, 필수)
        paymentService.processPayment(order);  // 500ms

        // 2. 이메일/SMS 비동기 발송 (병렬)
        sendEmailAsync(order);  // 백그라운드에서 실행
        sendSmsAsync(order);    // 백그라운드에서 실행

        // 총 소요 시간: 500ms (이메일/SMS는 백그라운드)
        return new OrderResult(order);
    }
}
```

## 1) @Async 기본

### 1-1) @EnableAsync 설정

```java
@Configuration
@EnableAsync  // Async 기능 활성화
public class AsyncConfig {

    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);           // 기본 스레드 수
        executor.setMaxPoolSize(10);           // 최대 스레드 수
        executor.setQueueCapacity(100);        // 큐 크기
        executor.setThreadNamePrefix("async-");
        executor.initialize();
        return executor;
    }
}
```

### 1-2) @Async 사용

```java
@Service
public class EmailService {

    @Async
    public void sendEmail(String to, String subject, String body) {
        log.info("Sending email to {} - Thread: {}", to, Thread.currentThread().getName());

        // 이메일 발송 로직
        // ...

        log.info("Email sent to {}", to);
    }
}
```

**호출:**
```java
@RestController
public class UserController {

    @Autowired
    private EmailService emailService;

    @PostMapping("/users")
    public ResponseEntity<User> createUser(@RequestBody User user) {
        User saved = userService.save(user);

        // 비동기로 이메일 발송 (즉시 반환)
        emailService.sendEmail(user.getEmail(), "Welcome!", "환영합니다!");

        return ResponseEntity.ok(saved);
    }
}
```

### 1-3) 반환값이 있는 @Async

```java
@Service
public class UserService {

    @Async
    public CompletableFuture<User> findByIdAsync(Long id) {
        log.info("Finding user {} - Thread: {}", id, Thread.currentThread().getName());

        User user = userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));

        return CompletableFuture.completedFuture(user);
    }

    @Async
    public CompletableFuture<List<Order>> findOrdersAsync(Long userId) {
        log.info("Finding orders for user {} - Thread: {}", userId, Thread.currentThread().getName());

        List<Order> orders = orderRepository.findByUserId(userId);

        return CompletableFuture.completedFuture(orders);
    }
}
```

**병렬 실행:**
```java
@GetMapping("/users/{id}/details")
public ResponseEntity<UserDetails> getUserDetails(@PathVariable Long id) {
    // 두 작업을 병렬로 실행
    CompletableFuture<User> userFuture = userService.findByIdAsync(id);
    CompletableFuture<List<Order>> ordersFuture = userService.findOrdersAsync(id);

    // 두 작업이 모두 완료될 때까지 대기
    CompletableFuture.allOf(userFuture, ordersFuture).join();

    // 결과 조합
    User user = userFuture.join();
    List<Order> orders = ordersFuture.join();

    return ResponseEntity.ok(new UserDetails(user, orders));
}
```

## 2) ThreadPoolTaskExecutor 설정

### 2-1) 스레드 풀 파라미터

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        // 기본 스레드 수 (항상 유지)
        executor.setCorePoolSize(5);

        // 최대 스레드 수
        executor.setMaxPoolSize(10);

        // 큐 크기 (대기열)
        executor.setQueueCapacity(100);

        // 유휴 스레드 유지 시간
        executor.setKeepAliveSeconds(60);

        // 스레드 이름 접두사
        executor.setThreadNamePrefix("async-");

        // 거부 정책 (큐가 가득 찼을 때)
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());

        // 종료 대기
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(60);

        executor.initialize();
        return executor;
    }
}
```

**동작 방식:**
```
1. 작업 요청
   ↓
2. CorePoolSize 미만? → 새 스레드 생성
   ↓
3. CorePoolSize 이상? → 큐에 추가
   ↓
4. 큐 가득? → MaxPoolSize까지 스레드 생성
   ↓
5. MaxPoolSize 도달? → RejectedExecutionHandler 실행
```

### 2-2) 여러 Executor 설정

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    // 이메일 발송용
    @Bean(name = "emailExecutor")
    public Executor emailExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(5);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("email-");
        executor.initialize();
        return executor;
    }

    // 파일 처리용
    @Bean(name = "fileExecutor")
    public Executor fileExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(20);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("file-");
        executor.initialize();
        return executor;
    }
}
```

**사용:**
```java
@Service
public class EmailService {

    @Async("emailExecutor")  // 특정 Executor 지정
    public void sendEmail(String to, String subject, String body) {
        // ...
    }
}

@Service
public class FileService {

    @Async("fileExecutor")  // 다른 Executor 사용
    public void processFile(File file) {
        // ...
    }
}
```

## 3) CompletableFuture 활용

### 3-1) 기본 사용

```java
// 비동기 작업 생성
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    // 백그라운드 스레드에서 실행
    Thread.sleep(1000);
    return "Hello";
});

// 결과 대기 (블로킹)
String result = future.get();  // "Hello"

// 타임아웃 설정
String result = future.get(2, TimeUnit.SECONDS);

// 논블로킹 대기
future.join();  // get()과 유사하지만 Checked Exception 없음
```

### 3-2) 작업 체이닝

```java
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    return "user123";
})
.thenApply(userId -> {
    // 이전 결과를 받아서 변환
    return userRepository.findById(userId);
})
.thenApply(user -> {
    // User → UserDTO 변환
    return new UserDTO(user);
})
.thenAccept(userDto -> {
    // 최종 결과 사용 (반환값 없음)
    log.info("User loaded: {}", userDto);
});
```

### 3-3) 병렬 실행

```java
@GetMapping("/dashboard")
public ResponseEntity<Dashboard> getDashboard() {
    // 3개 작업을 병렬로 실행
    CompletableFuture<Long> userCountFuture = CompletableFuture.supplyAsync(() ->
        userRepository.count()
    );

    CompletableFuture<Long> orderCountFuture = CompletableFuture.supplyAsync(() ->
        orderRepository.count()
    );

    CompletableFuture<BigDecimal> totalRevenueFuture = CompletableFuture.supplyAsync(() ->
        orderRepository.calculateTotalRevenue()
    );

    // 모든 작업이 완료될 때까지 대기
    CompletableFuture.allOf(userCountFuture, orderCountFuture, totalRevenueFuture).join();

    // 결과 조합
    Dashboard dashboard = new Dashboard(
        userCountFuture.join(),
        orderCountFuture.join(),
        totalRevenueFuture.join()
    );

    return ResponseEntity.ok(dashboard);
}
```

### 3-4) 예외 처리

```java
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    if (Math.random() > 0.5) {
        throw new RuntimeException("Error!");
    }
    return "Success";
})
.exceptionally(ex -> {
    // 예외 발생 시 기본값 반환
    log.error("Error occurred", ex);
    return "Default Value";
})
.thenApply(result -> {
    return result.toUpperCase();
});
```

**또는 handle():**
```java
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("Error!");
})
.handle((result, ex) -> {
    if (ex != null) {
        // 예외 처리
        log.error("Error occurred", ex);
        return "Error: " + ex.getMessage();
    } else {
        // 정상 처리
        return result;
    }
});
```

### 3-5) 여러 작업 조합

```java
// 둘 중 먼저 완료된 것 사용
CompletableFuture<String> future1 = CompletableFuture.supplyAsync(() -> {
    Thread.sleep(1000);
    return "Result from DB";
});

CompletableFuture<String> future2 = CompletableFuture.supplyAsync(() -> {
    Thread.sleep(500);
    return "Result from Cache";
});

CompletableFuture<Object> fastest = CompletableFuture.anyOf(future1, future2);
String result = (String) fastest.join();  // "Result from Cache" (더 빠름)

// 두 작업이 모두 완료될 때까지 대기
CompletableFuture<Void> allComplete = CompletableFuture.allOf(future1, future2);
allComplete.join();

// 두 결과를 조합
CompletableFuture<String> combined = future1.thenCombine(future2, (result1, result2) -> {
    return result1 + " + " + result2;
});
```

## 4) 비동기 예외 처리

### 4-1) @Async 예외 처리

```java
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
        log.error("Async exception in method: {} with params: {}",
            method.getName(), Arrays.toString(params), ex);

        // 알림 발송 (선택)
        // slackNotifier.sendError(...);
    }
}
```

### 4-2) CompletableFuture 예외 처리

```java
@Service
public class UserService {

    @Async
    public CompletableFuture<User> findByIdAsync(Long id) {
        return CompletableFuture.supplyAsync(() -> {
            return userRepository.findById(id)
                .orElseThrow(() -> new UserNotFoundException(id));
        })
        .exceptionally(ex -> {
            log.error("Error finding user: {}", id, ex);
            return null;  // 또는 기본값
        });
    }
}
```

## 5) 실전 패턴

### 5-1) 이메일 발송

```java
@Service
@Slf4j
public class EmailService {

    @Async("emailExecutor")
    public CompletableFuture<Void> sendWelcomeEmail(User user) {
        log.info("Sending welcome email to {}", user.getEmail());

        try {
            // 이메일 발송
            mailSender.send(createWelcomeEmail(user));
            log.info("Welcome email sent to {}", user.getEmail());

        } catch (Exception e) {
            log.error("Failed to send welcome email to {}", user.getEmail(), e);
            throw e;
        }

        return CompletableFuture.completedFuture(null);
    }
}
```

### 5-2) 파일 처리

```java
@Service
public class FileProcessingService {

    @Async("fileExecutor")
    public CompletableFuture<ProcessResult> processFileAsync(File file) {
        log.info("Processing file: {}", file.getName());

        try {
            // 파일 읽기
            List<String> lines = Files.readAllLines(file.toPath());

            // 처리
            ProcessResult result = processLines(lines);

            log.info("File processed: {} - {} lines", file.getName(), lines.size());

            return CompletableFuture.completedFuture(result);

        } catch (IOException e) {
            log.error("Failed to process file: {}", file.getName(), e);
            return CompletableFuture.failedFuture(e);
        }
    }
}
```

### 5-3) 외부 API 호출

```java
@Service
public class ExternalApiService {

    @Async
    public CompletableFuture<ApiResponse> callExternalApi(String url) {
        return CompletableFuture.supplyAsync(() -> {
            return restTemplate.getForObject(url, ApiResponse.class);
        })
        .orTimeout(3, TimeUnit.SECONDS)  // 타임아웃
        .exceptionally(ex -> {
            log.error("External API call failed: {}", url, ex);
            return ApiResponse.error("External API unavailable");
        });
    }
}
```

## 6) 주의사항

### ⚠️ 1. @Async는 Proxy 기반

```java
// ❌ 나쁜 예: 같은 클래스 내 @Async 메서드 호출
@Service
public class UserService {

    public void registerUser(User user) {
        userRepository.save(user);
        sendWelcomeEmail(user);  // @Async 동작 안 함! (프록시 우회)
    }

    @Async
    public void sendWelcomeEmail(User user) {
        // ...
    }
}

// ✅ 좋은 예: 다른 Bean에서 호출
@Service
public class UserService {

    @Autowired
    private EmailService emailService;

    public void registerUser(User user) {
        userRepository.save(user);
        emailService.sendWelcomeEmail(user);  // @Async 동작!
    }
}
```

### ⚠️ 2. 트랜잭션 주의

```java
// ❌ 나쁜 예: @Transactional과 @Async 함께 사용
@Transactional
@Async
public void updateUser(User user) {
    // 트랜잭션이 다른 스레드에서 실행됨!
}

// ✅ 좋은 예: 분리
@Transactional
public void updateUser(User user) {
    userRepository.save(user);
    // 트랜잭션 커밋 후 비동기 작업
}

@Async
public void sendNotification(User user) {
    // 비동기 작업
}
```

### ⚠️ 3. 스레드 풀 고갈

```java
// ❌ 나쁜 예: 무한정 비동기 작업 생성
for (int i = 0; i < 10000; i++) {
    asyncService.process(i);  // 스레드 풀 고갈!
}

// ✅ 좋은 예: 배치 처리 또는 스로틀링
List<CompletableFuture<Void>> futures = new ArrayList<>();
for (int i = 0; i < items.size(); i += 100) {
    List<Item> batch = items.subList(i, Math.min(i + 100, items.size()));
    futures.add(asyncService.processBatch(batch));
}
CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

## 연습 (추천)

1. **@Async 구현**
   - @EnableAsync 설정
   - 비동기 이메일 발송
   - 반환값 있는 @Async

2. **CompletableFuture 활용**
   - 병렬 실행 (allOf, anyOf)
   - 작업 체이닝 (thenApply, thenCompose)
   - 예외 처리

3. **스레드 풀 튜닝**
   - 적절한 CorePoolSize/MaxPoolSize 설정
   - 작업 특성에 맞는 Executor 설계

## 요약: 스스로 점검할 것

- @Async로 비동기 메서드를 만들 수 있다
- CompletableFuture로 비동기 작업을 조합할 수 있다
- ThreadPoolTaskExecutor를 설정할 수 있다
- 비동기 예외를 처리할 수 있다
- Proxy 기반 동작을 이해한다

## 다음 단계

- Spring WebFlux: `/learning/deep-dive/deep-dive-spring-webflux-vs-mvc/`
- Reactive Programming: `/learning/deep-dive/deep-dive-reactive-streams/`
- 동시성 제어: `/learning/deep-dive/deep-dive-java-concurrency-basics/`
