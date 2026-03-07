---
title: "Java 개발자를 위한 Kotlin: NPE 종말과 코루틴 혁명"
date: 2025-12-28
draft: false
topic: "Modern Tech"
tags: ["Kotlin", "Coroutines", "Null Safety", "Scope Functions", "Sealed Class", "Spring Boot", "Backend"]
categories: ["Backend Deep Dive"]
description: "Lombok 없이도 간결한 코드를 작성하고, 스레드 지옥에서 벗어나 코루틴의 세계로. Scope Functions, Sealed Class, Spring Boot 통합까지."
module: "modern-frontiers"
study_order: 1001
---

## 이 글에서 얻는 것

- **Java**의 고질적인 `NullPointerException`이 Kotlin에서 어떻게 시스템적으로 사라지는지 봅니다.
- `data class`, `extension function`, Scope Functions으로 코드가 얼마나 간결해지는지 체험합니다.
- **Thread**와 **Coroutine**의 메모리/비용 차이를 이해하고, Structured Concurrency를 배웁니다.
- Kotlin + Spring Boot 통합 시 주의할 점을 정리합니다.

---

## 0) 왜 Kotlin인가?

많은 자바 개발자가 "굳이?"라고 묻지만, 한 번 써보면 돌아가기 힘듭니다.

### Java에서 Kotlin으로 넘어간 대표 사례

- **Google**: Android 공식 언어 (2019~)
- **Spring Framework**: Kotlin 1st-class 지원 (Spring 5+)
- **Gradle**: Kotlin DSL이 Groovy를 대체하는 추세
- **Coupang, LINE, Kakao**: 서버 사이드에서도 적극 도입

### 핵심 이점 3가지

| 영역 | Java의 문제 | Kotlin의 해결 |
|---|---|---|
| **안전성** | 모든 참조가 nullable, 런타임 NPE | 타입 시스템에서 Null 분리, 컴파일 타임 차단 |
| **간결성** | Boilerplate 코드 (getter/setter/equals) | data class, 타입 추론, 확장 함수 |
| **비동기** | Thread 기반, Callback Hell | Coroutines: 동기 코드처럼 비동기 작성 |

---

## 1) Null Safety — 10억 불짜리 실수 해결

Java에서는 모든 것이 Null일 수 있어서 방어 코드가 필수였습니다.
Kotlin은 타입 시스템 레벨에서 Null 가능성을 분리합니다.

```kotlin
// Kotlin: Non-null 타입 (기본)
var name: String = "Alice"
// name = null  // ❌ 컴파일 에러!

// Kotlin: Nullable 타입 (? 붙임)
var nullableName: String? = "Alice"
nullableName = null  // ✅ 가능
```

### Null 처리 연산자 정리

```kotlin
val user: User? = findUser(id)

// 1. Safe Call (?.)
val city = user?.address?.city  // null이면 전파, NPE 없음

// 2. Elvis Operator (?:)
val cityName = user?.address?.city ?: "Unknown"  // null이면 기본값

// 3. Not-null Assertion (!!) — 최후의 수단
val forceCity = user!!.address.city  // null이면 NPE 발생! 가급적 쓰지 마세요

// 4. Safe Cast (as?)
val str: String? = value as? String  // 캐스팅 실패 시 null

// 5. let과 조합 — Null이 아닐 때만 실행
user?.let { u ->
    println("${u.name}은(는) ${u.address?.city}에 살고 있습니다")
}
```

### Java 코드와 비교

```java
// Java: 방어 코드 지옥
String city = "Unknown";
if (user != null) {
    Address address = user.getAddress();
    if (address != null) {
        String c = address.getCity();
        if (c != null) {
            city = c;
        }
    }
}
```

```kotlin
// Kotlin: 한 줄
val city = user?.address?.city ?: "Unknown"
```

---

## 2) Data Class — Lombok이 필요 없다

Java의 지루한 DTO/VO 생성을 한 줄로 끝냅니다.

```kotlin
// Kotlin
data class User(val name: String, val age: Int)
```

`data class`는 컴파일러가 자동 생성합니다:
- `equals()` / `hashCode()` — 프로퍼티 기반 비교
- `toString()` — `User(name=Alice, age=25)` 형태
- `copy()` — 불변 객체의 일부만 변경한 복사본
- `componentN()` — 구조 분해 지원

```kotlin
val user = User("Alice", 25)

// copy: 불변 객체 변형
val older = user.copy(age = 26)  // User(name=Alice, age=26)

// 구조 분해 (Destructuring)
val (name, age) = user
println("$name is $age years old")  // Alice is 25 years old

// Map에서 구조 분해
mapOf("a" to 1, "b" to 2).forEach { (key, value) ->
    println("$key = $value")
}
```

---

## 3) Scope Functions — let, run, apply, also, with

Kotlin의 가장 혼란스러우면서도 강력한 기능입니다. 차이를 명확히 정리합니다.

| 함수 | 객체 참조 | 반환값 | 주 용도 |
|---|---|---|---|
| **let** | `it` | 람다 결과 | Null 체크 후 변환 |
| **run** | `this` | 람다 결과 | 객체 설정 + 결과 계산 |
| **apply** | `this` | 객체 자체 | 객체 초기화/설정 (Builder 패턴) |
| **also** | `it` | 객체 자체 | 부수 효과 (로깅, 검증) |
| **with** | `this` | 람다 결과 | Non-null 객체의 여러 메서드 호출 |

### 실전 예시

```kotlin
// let: Null 체크 + 변환
val length: Int? = name?.let { it.trim().length }

// apply: 객체 초기화 (Builder 대체)
val config = HttpClient().apply {
    connectTimeout = Duration.ofSeconds(5)
    readTimeout = Duration.ofSeconds(10)
    followRedirects = true
}

// also: 부수 효과 (체이닝 중간에 로깅)
val user = userRepository.findById(id)
    .also { log.debug("Found user: $it") }
    .orElseThrow { UserNotFoundException(id) }

// run: 객체 컨텍스트에서 계산
val greeting = user.run {
    "안녕하세요, ${name}님! ${age}세이시군요."
}

// with: Non-null 객체의 다중 호출
with(StringBuilder()) {
    append("Hello, ")
    append(user.name)
    append("!")
    toString()  // 반환
}
```

### 선택 가이드

```
Null 체크 필요?
  └─ Yes → let
  └─ No → 반환값이 객체 자체?
            └─ Yes → apply (설정) / also (로깅/검증)
            └─ No  → run / with
```

---

## 4) Sealed Class — When의 진가

`sealed class`는 상속 가능한 하위 타입을 **같은 파일 내로 제한**합니다. `when`과 조합하면 컴파일러가 모든 케이스를 검증합니다.

```kotlin
sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error(val code: Int, val message: String) : ApiResult<Nothing>()
    data object Loading : ApiResult<Nothing>()
}

// when: else가 필요 없음! 컴파일러가 모든 케이스 커버를 강제
fun <T> handleResult(result: ApiResult<T>): String = when (result) {
    is ApiResult.Success -> "Data: ${result.data}"
    is ApiResult.Error   -> "Error ${result.code}: ${result.message}"
    is ApiResult.Loading -> "Loading..."
    // 새 하위 타입 추가 시 → 여기서 컴파일 에러 발생! 누락 방지
}
```

### 실무 활용: 도메인 이벤트

```kotlin
sealed class OrderEvent {
    data class Created(val orderId: Long, val items: List<Item>) : OrderEvent()
    data class Paid(val orderId: Long, val amount: Money) : OrderEvent()
    data class Shipped(val orderId: Long, val trackingNo: String) : OrderEvent()
    data class Cancelled(val orderId: Long, val reason: String) : OrderEvent()
}

fun processEvent(event: OrderEvent) = when (event) {
    is OrderEvent.Created   -> inventoryService.reserve(event.items)
    is OrderEvent.Paid      -> paymentService.confirm(event.amount)
    is OrderEvent.Shipped   -> notificationService.sendTracking(event.trackingNo)
    is OrderEvent.Cancelled -> inventoryService.release(event.orderId)
}
```

> **Java 비교**: Java 17의 `sealed interface` + `switch` 패턴 매칭과 유사하지만, Kotlin이 훨씬 먼저 도입했고 문법이 더 깔끔합니다.

---

## 5) Coroutines — 스레드는 무겁다

### Thread vs Coroutine 비용

| 항목 | OS Thread | Coroutine |
|---|---|---|
| **메모리** | ~1MB (커널 스택) | ~수 KB |
| **생성 비용** | 높음 (syscall) | 매우 낮음 (객체 생성) |
| **컨텍스트 스위칭** | OS 스케줄러 (비용 높음) | 유저 스페이스 (비용 낮음) |
| **동시 실행 수** | 수천 개가 한계 | 수십만 개 가능 |

```kotlin
// 10만 개 코루틴 — 문제 없음
runBlocking {
    repeat(100_000) {
        launch {
            delay(1000)
            print(".")
        }
    }
}
// Thread로 같은 걸 하면? → OutOfMemoryError 💥
```

### suspend 함수 — 비동기의 핵심

```kotlin
// suspend 함수: "여기서 잠시 멈출 수 있어요"
suspend fun fetchUser(id: Long): User {
    // 네트워크 호출 중 스레드를 점유하지 않음!
    return httpClient.get("https://api.example.com/users/$id")
}

// 호출 코드: 동기처럼 보이지만 비동기로 동작
suspend fun getUserProfile(id: Long): Profile {
    val user = fetchUser(id)            // 네트워크 대기
    val orders = fetchOrders(user.id)    // 네트워크 대기
    return Profile(user, orders)
}
```

### Structured Concurrency — 코루틴의 생명주기 관리

코루틴은 **반드시 CoroutineScope 안에서** 실행됩니다. 부모가 취소되면 자식도 전부 취소됩니다.

```kotlin
suspend fun loadDashboard(): Dashboard = coroutineScope {
    // 두 작업을 병렬로 실행
    val userDeferred = async { fetchUser(userId) }
    val ordersDeferred = async { fetchOrders(userId) }
    
    // 둘 다 완료될 때까지 대기
    Dashboard(
        user = userDeferred.await(),
        orders = ordersDeferred.await()
    )
    // 하나가 실패하면? → 다른 하나도 자동 취소!
}
```

### Dispatcher — 어떤 스레드에서 실행할까?

| Dispatcher | 용도 | 스레드 풀 |
|---|---|---|
| `Dispatchers.IO` | 네트워크, 파일, DB | 64개 이상 (탄력적) |
| `Dispatchers.Default` | CPU 집약 (정렬, 파싱) | CPU 코어 수 |
| `Dispatchers.Main` | UI 업데이트 (Android) | 메인 스레드 1개 |
| `Dispatchers.Unconfined` | 테스트용 | 호출 스레드 그대로 |

```kotlin
suspend fun processData() {
    withContext(Dispatchers.IO) {
        // DB 조회 (IO 스레드)
        val data = repository.findAll()
    }
    withContext(Dispatchers.Default) {
        // 무거운 계산 (CPU 스레드)
        data.map { transform(it) }
    }
}
```

---

## 6) Extension Functions — 확장 함수

상속받지 않고도 기존 클래스에 기능을 추가할 수 있습니다.

```kotlin
// String 클래스에 기능 추가
fun String.lastChar(): Char = this[this.length - 1]

println("Kotlin".lastChar())  // 'n'

// 실무: 도메인 확장
fun Money.toKRW(): String = "₩${String.format("%,.0f", this.amount)}"

val price = Money(15000.0)
println(price.toKRW())  // ₩15,000
```

### 실무 팁: 확장 함수 vs 유틸 클래스

```kotlin
// ❌ Java 스타일: 유틸 클래스
object StringUtils {
    fun isEmail(s: String): Boolean = s.matches(EMAIL_REGEX)
}
StringUtils.isEmail(input)

// ✅ Kotlin 스타일: 확장 함수
fun String.isEmail(): Boolean = matches(EMAIL_REGEX)
input.isEmail()  // 더 자연스러움
```

> **주의**: 확장 함수는 **정적 디스패치(static dispatch)**입니다. 실제로 클래스를 수정하는 것이 아니라, 컴파일 시 정적 메서드로 변환됩니다. 따라서 **다형성(Polymorphism)**이 필요하면 인터페이스를 사용하세요.

---

## 7) Kotlin + Spring Boot — 실전 통합

### 기본 설정 주의사항

```kotlin
// 1. open 문제: Spring은 CGLIB 프록시로 클래스를 상속하는데,
//    Kotlin 클래스는 기본이 final
// 해결: kotlin-spring 플러그인 (자동으로 open 처리)

// build.gradle.kts
plugins {
    kotlin("plugin.spring") version "2.0.0"  // 필수!
    kotlin("plugin.jpa") version "2.0.0"     // JPA 엔티티용
}

// 2. JPA 엔티티: no-arg 생성자 필요
// kotlin-jpa 플러그인이 자동으로 no-arg 생성자 추가

@Entity
data class User(
    @Id @GeneratedValue
    val id: Long = 0,      // 기본값으로 no-arg 대응
    val name: String,
    val email: String
)
```

### Controller 예시

```kotlin
@RestController
@RequestMapping("/api/users")
class UserController(
    private val userService: UserService  // 생성자 주입 (자동)
) {
    @GetMapping("/{id}")
    suspend fun getUser(@PathVariable id: Long): ResponseEntity<User> {
        val user = userService.findById(id)
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(user)
    }
    
    @PostMapping
    suspend fun createUser(@Valid @RequestBody request: CreateUserRequest): ResponseEntity<User> {
        val user = userService.create(request)
        return ResponseEntity.status(CREATED).body(user)
    }
}
```

### WebFlux + Coroutines

Spring WebFlux에서 `Mono`/`Flux` 대신 **코루틴을 직접 사용**할 수 있습니다:

```kotlin
// Mono/Flux 방식 (리액티브 스트림)
fun findById(id: Long): Mono<User> = ...

// Coroutine 방식 (더 읽기 쉬움)
suspend fun findById(id: Long): User? = ...
fun findAll(): Flow<User> = ...  // Flow = 코루틴 버전 Flux
```

---

## 8) Java → Kotlin 마이그레이션 체크리스트

한 번에 전환하지 말고, **점진적으로** 마이그레이션합니다.

### 단계별 전략

| 단계 | 대상 | 리스크 |
|---|---|---|
| **1단계** | 테스트 코드 | 거의 없음 — 여기서 Kotlin에 익숙해지기 |
| **2단계** | 유틸/헬퍼 클래스 | 낮음 — 의존하는 코드 적음 |
| **3단계** | 새로운 기능 | 낮음 — Java/Kotlin 혼용 가능 |
| **4단계** | DTO/Request/Response | 보통 — data class 활용 |
| **5단계** | Service/Repository | 보통~높음 — 핵심 로직 |
| **6단계** | 기존 코드 일괄 변환 | 높음 — IntelliJ 자동 변환 후 리뷰 필수 |

### 주의할 함정

```kotlin
// 1. Java interop: Platform Type
val result: String = javaMethod()  // Java 반환값은 String! (Platform Type)
// null이 올 수 있는데 Non-null로 받으면 → 런타임 NPE!
// 해결: nullable로 받기
val result: String? = javaMethod()

// 2. data class + JPA: equals/hashCode 주의
// JPA의 지연 로딩 프록시에서 문제 발생 가능
// 해결: id만으로 equals/hashCode 정의
@Entity
class User(
    @Id @GeneratedValue val id: Long = 0,
    var name: String
) {
    override fun equals(other: Any?) = other is User && id == other.id
    override fun hashCode() = id.hashCode()
}

// 3. companion object ≠ static
class MyService {
    companion object {
        private val log = LoggerFactory.getLogger(MyService::class.java)
        // Java에서 접근: MyService.Companion.getLog() 😱
        // 해결: @JvmStatic 어노테이션
    }
}
```

---

## 📚 9. 연관 학습

- [Java Concurrency Basics](/learning/deep-dive/deep-dive-java-concurrency-basics/) — Thread, synchronized, volatile 기초
- [Spring WebFlux](/learning/deep-dive/deep-dive-spring-webflux/) — 리액티브 프로그래밍과 코루틴 비교
- [Spring WebFlux vs MVC](/learning/deep-dive/deep-dive-spring-webflux-vs-mvc/) — 언제 어떤 모델을 선택할까
- [Spring IoC & DI](/learning/deep-dive/deep-dive-spring-ioc-di/) — Kotlin에서의 의존성 주입
- [OOP & SOLID](/learning/deep-dive/deep-dive-oop-solid-principles/) — Kotlin의 객체지향 특성과 SOLID

---

## 요약

| 개념 | 핵심 |
|---|---|
| **Null Safety** | `?` 타입 + Safe Call + Elvis로 컴파일 시점 NPE 99% 차단 |
| **data class** | equals/hashCode/toString/copy 자동 생성, Lombok 불필요 |
| **Scope Functions** | let(null 체크), apply(초기화), also(로깅) — 상황별 사용 |
| **Sealed Class** | when에서 모든 케이스 컴파일 검증, 도메인 이벤트에 강력 |
| **Coroutines** | 경량 비동기, Structured Concurrency로 생명주기 자동 관리 |
| **Extension Functions** | 기존 클래스 확장, 유틸 클래스 대체 |
| **Spring 통합** | kotlin-spring/jpa 플러그인 필수, WebFlux + Coroutine 조합 |
| **마이그레이션** | 테스트 → 유틸 → 신규 기능 → DTO → Service 순서로 점진적 |
