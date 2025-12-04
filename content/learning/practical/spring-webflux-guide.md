---
title: "Spring WebFlux 완전 정복"
date: 2025-11-03
draft: true
topic: "Spring"
topic_icon: "🍃"
topic_description: "Spring Framework 및 생태계 학습"
tags: ["Spring", "WebFlux", "Reactive", "Backend"]
categories: ["Development", "Learning"]
description: "Spring MVC vs WebFlux 구조 비교, Reactor 흐름, subscribe 시점 이해"
---

> **학습 목표**: Spring WebFlux의 핵심 개념과 Spring MVC와의 차이점을 이해하고, Reactive Programming의 실제 동작 방식을 파악한다.

## 🤔 왜 WebFlux를 배워야 할까?

Spring MVC는 **요청당 스레드(Thread-per-Request)** 모델을 사용합니다. 이는 직관적이지만, I/O 대기 시간이 긴 작업에서 스레드가 블로킹되어 자원 낭비가 발생합니다.

WebFlux는 **Non-Blocking I/O**와 **Reactive Programming**을 통해 적은 수의 스레드로 더 많은 요청을 처리할 수 있습니다.

### 적합한 사용 사례
- ✅ 많은 I/O 작업이 필요한 서비스 (외부 API 호출, DB 쿼리 등)
- ✅ 실시간 데이터 스트리밍 (SSE, WebSocket)
- ✅ 마이크로서비스 간 비동기 통신
- ❌ CPU 집약적 작업 (복잡한 계산 등)
- ❌ 블로킹 라이브러리에 의존하는 레거시 시스템

---

## 📊 Spring MVC vs WebFlux 구조 비교

### Spring MVC 아키텍처

```
Client Request
    ↓
DispatcherServlet (Servlet Container)
    ↓
Handler Mapping → Controller
    ↓
Service Layer (Blocking I/O)
    ↓
Repository (JDBC - Blocking)
    ↓
Response (Thread 해제)
```

**특징**:
- 요청마다 스레드 할당
- 동기/블로킹 방식
- Tomcat 기본 200개 스레드
- I/O 대기 시 스레드 블로킹

### Spring WebFlux 아키텍처

```
Client Request
    ↓
Netty (Event Loop)
    ↓
DispatcherHandler → Controller
    ↓
Reactive Service Layer
    ↓
R2DBC / MongoDB Reactive (Non-Blocking)
    ↓
Event Loop에서 Response 처리
```

**특징**:
- Event Loop + Worker Thread Pool
- 비동기/논블로킹 방식
- Netty 기본: Event Loop 스레드 = CPU 코어 수
- I/O 대기 시 다른 작업 처리

---

## ⚡ Reactor 핵심 개념

WebFlux는 **Project Reactor**를 기반으로 합니다.

### Mono vs Flux

```java
// Mono: 0~1개의 데이터
Mono<User> user = userRepository.findById(userId);

// Flux: 0~N개의 데이터
Flux<Product> products = productRepository.findAll();
```

| 타입 | 데이터 개수 | 사용 예시 |
|------|------------|-----------|
| **Mono** | 0 or 1 | 단일 엔티티 조회, 단일 응답 |
| **Flux** | 0 to N | 리스트 조회, 스트리밍 데이터 |

### Publisher와 Subscriber

Reactive Streams의 4가지 핵심 인터페이스:

```java
// 1. Publisher: 데이터 발행자
public interface Publisher<T> {
    void subscribe(Subscriber<? super T> subscriber);
}

// 2. Subscriber: 데이터 소비자
public interface Subscriber<T> {
    void onSubscribe(Subscription subscription);
    void onNext(T item);
    void onError(Throwable error);
    void onComplete();
}

// 3. Subscription: 구독 정보
public interface Subscription {
    void request(long n);  // Backpressure
    void cancel();
}

// 4. Processor: Publisher + Subscriber
```

---

## 🔥 Subscribe 시점 이해하기

**가장 중요한 원칙**: **Subscribe하기 전까지는 아무 일도 일어나지 않는다!**

### Cold vs Hot Publisher

#### Cold Publisher (대부분의 경우)

```java
Mono<String> coldMono = Mono.fromCallable(() -> {
    System.out.println("API 호출 실행!");
    return callExternalAPI();
});

// 여기까지는 아무 일도 일어나지 않음!

coldMono.subscribe(result -> System.out.println(result)); // 실제 실행
coldMono.subscribe(result -> System.out.println(result)); // 다시 실행 (각각 독립적)
```

**출력**:
```
API 호출 실행!
결과 출력
API 호출 실행!
결과 출력
```

#### Hot Publisher

```java
Flux<Long> hotFlux = Flux.interval(Duration.ofSeconds(1))
    .share(); // Hot Publisher로 변환

hotFlux.subscribe(t -> System.out.println("Subscriber 1: " + t));

Thread.sleep(3000);

hotFlux.subscribe(t -> System.out.println("Subscriber 2: " + t));
// Subscriber 2는 3초 이후 데이터부터 받음 (중간부터 구독)
```

---

## 🛠️ WebFlux Controller 예시

### 기본 구조

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    @GetMapping("/{id}")
    public Mono<UserResponse> getUser(@PathVariable String id) {
        return userService.findById(id)
            .map(user -> new UserResponse(user))
            .defaultIfEmpty(new UserResponse("Not Found"));
    }

    @GetMapping
    public Flux<UserResponse> getAllUsers() {
        return userService.findAll()
            .map(UserResponse::new);
    }

    @PostMapping
    public Mono<UserResponse> createUser(@RequestBody CreateUserRequest request) {
        return userService.create(request)
            .map(UserResponse::new);
    }
}
```

### Reactive Service Layer

```java
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final ExternalApiClient apiClient;

    public Mono<User> findById(String id) {
        return userRepository.findById(id)
            .switchIfEmpty(Mono.error(new UserNotFoundException(id)))
            .flatMap(user -> enrichUserData(user));
    }

    // 외부 API 호출과 DB 조회 병렬 처리
    private Mono<User> enrichUserData(User user) {
        Mono<ProfileData> profileMono = apiClient.getProfile(user.getId());
        Mono<List<Order>> ordersMono = orderRepository.findByUserId(user.getId())
            .collectList();

        return Mono.zip(profileMono, ordersMono)
            .map(tuple -> {
                user.setProfile(tuple.getT1());
                user.setOrders(tuple.getT2());
                return user;
            });
    }
}
```

---

## 🎯 Reactor 주요 연산자

### 변환 (Transformation)

```java
// map: 1:1 변환
Mono<String> upperCase = Mono.just("hello").map(String::toUpperCase);

// flatMap: 1:N 변환 (비동기 작업)
Mono<User> user = Mono.just("userId")
    .flatMap(id -> userRepository.findById(id));

// flatMapMany: Mono → Flux 변환
Flux<Order> orders = Mono.just(userId)
    .flatMapMany(id -> orderRepository.findByUserId(id));
```

### 결합 (Combining)

```java
// zip: 여러 Publisher를 하나로 결합
Mono<UserProfile> profile = Mono.zip(
    userMono,
    settingsMono,
    (user, settings) -> new UserProfile(user, settings)
);

// merge: 여러 Flux를 하나로 병합 (순서 보장 X)
Flux<Event> events = Flux.merge(
    eventSource1.getEvents(),
    eventSource2.getEvents()
);

// concat: 순차적으로 연결 (순서 보장 O)
Flux<Item> items = Flux.concat(
    cache.getItems(),
    database.getItems()
);
```

### 에러 처리

```java
// onErrorReturn: 에러 시 기본값 반환
Mono<User> user = userRepository.findById(id)
    .onErrorReturn(new User("Guest"));

// onErrorResume: 에러 시 다른 Publisher로 전환
Mono<User> user = primaryDB.findUser(id)
    .onErrorResume(error -> backupDB.findUser(id));

// doOnError: 에러 발생 시 사이드 이펙트 (로깅 등)
Mono<User> user = userRepository.findById(id)
    .doOnError(error -> log.error("Failed to find user: {}", id, error));
```

### 필터링 & 조건

```java
// filter: 조건에 맞는 데이터만
Flux<User> activeUsers = userRepository.findAll()
    .filter(User::isActive);

// switchIfEmpty: 비어있을 때 대체
Mono<User> user = cache.getUser(id)
    .switchIfEmpty(database.getUser(id));

// take: 처음 N개만
Flux<Item> first10 = itemRepository.findAll()
    .take(10);
```

---

## 🚨 주의사항 & 흔한 실수

### 1. Blocking 호출 사용 금지

```java
// ❌ 절대 하지 마세요!
@GetMapping("/user/{id}")
public Mono<User> getUser(@PathVariable String id) {
    return userRepository.findById(id)
        .doOnNext(user -> {
            // JDBC는 blocking!
            legacyService.updateUserStats(user);  // 💥 블로킹 발생
        });
}

// ✅ 올바른 방법
@GetMapping("/user/{id}")
public Mono<User> getUser(@PathVariable String id) {
    return userRepository.findById(id)
        .flatMap(user ->
            // Reactive 방식으로 처리
            reactiveStatsService.updateUserStats(user)
                .thenReturn(user)
        );
}
```

### 2. Subscribe를 Controller에서 호출하지 마세요

```java
// ❌ 잘못된 예시
@GetMapping("/data")
public void getData() {
    dataService.fetchData()
        .subscribe(data -> System.out.println(data));
    // Spring WebFlux가 자동으로 subscribe 해줌!
}

// ✅ 올바른 예시
@GetMapping("/data")
public Mono<Data> getData() {
    return dataService.fetchData();
    // Spring이 알아서 subscribe
}
```

### 3. 적절한 Scheduler 사용

```java
// CPU 집약적 작업
Mono<Result> result = Mono.fromCallable(() -> {
    return heavyComputation();
})
.subscribeOn(Schedulers.parallel());  // parallel: CPU bound

// Blocking I/O (레거시 라이브러리)
Mono<Data> data = Mono.fromCallable(() -> {
    return blockingJdbcCall();
})
.subscribeOn(Schedulers.boundedElastic());  // boundedElastic: I/O bound
```

---

## 💡 실전 팁

### 1. Debugging

```java
// log 연산자 활용
Flux<User> users = userRepository.findAll()
    .log()  // 모든 이벤트 로깅
    .filter(User::isActive)
    .log("After Filter");  // 커스텀 로그 이름
```

### 2. Context 전달 (로깅, 인증 등)

```java
Mono<User> user = Mono.deferContextual(ctx -> {
    String userId = ctx.get("userId");
    return userRepository.findById(userId);
})
.contextWrite(Context.of("userId", "12345"));
```

### 3. Timeout 설정

```java
Mono<Data> data = externalApi.fetchData()
    .timeout(Duration.ofSeconds(5))
    .onErrorResume(TimeoutException.class, e ->
        Mono.just(Data.defaultData())
    );
```

---

## 📚 학습 체크리스트

- [ ] Spring MVC와 WebFlux의 차이점 이해
- [ ] Mono와 Flux의 차이 설명 가능
- [ ] Subscribe 시점과 Cold/Hot Publisher 이해
- [ ] 주요 Reactor 연산자 5개 이상 사용 가능
- [ ] 에러 처리 방법 3가지 이상 구현 가능
- [ ] Blocking 코드를 Reactive로 변환 가능

---

## 🔗 추가 학습 자료

- [Project Reactor Reference](https://projectreactor.io/docs/core/release/reference/)
- [Spring WebFlux Official Docs](https://docs.spring.io/spring-framework/reference/web/webflux.html)
- [Reactive Streams Specification](https://www.reactive-streams.org/)

---

> **다음 학습**: Spring Boot 3.x 마이그레이션에서 WebFlux 적용 시 주의사항
