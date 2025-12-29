---
title: "REST API 설계 원칙: 리소스, HTTP 메서드, 상태코드 완벽 가이드"
date: 2025-10-12
draft: false
topic: "API Design"
tags: ["REST", "API", "HTTP", "RESTful", "Web"]
categories: ["Backend Deep Dive"]
description: "RESTful API 설계 원칙과 HTTP 메서드, 상태코드, URL 설계 패턴을 실전 예제로 마스터"
module: "foundation"
quizzes:
  - question: "HTTP 메서드 중 '리소스의 식별자(ID)를 알고 있을 때, 해당 리소스 전체를 클라이언트가 보낸 데이터로 완전히 교체(Replace)'하는 메서드는?"
    options:
      - "PATCH"
      - "PUT"
      - "POST"
      - "OPTIONS"
    answer: 1
    explanation: "PUT은 리소스 전체를 교체하는 의미를 가지며, 멱등성(Idempotence)을 가집니다. 반면 PATCH는 리소스의 일부만 변경할 때 사용합니다."

  - question: "다음 중 '안전함(Safe)'과 '멱등함(Idempotent)'을 모두 만족하는 HTTP 메서드는?"
    options:
      - "DELETE"
      - "POST"
      - "GET"
      - "PATCH"
    answer: 2
    explanation: "GET은 서버의 상태를 변경하지 않으므로 안전(Safe)하고, 여러 번 호출해도 결과가 같으므로 멱등(Idempotent)합니다. (DELETE는 멱등하지만 안전하지 않고, POST는 둘 다 아닙니다.)"

  - question: "REST API 설계 시, '특정 사용자(ID: 123)의 주문 목록'을 조회하는 가장 적절한 URL 구조는?"
    options:
      - "GET /getOrders?userId=123"
      - "POST /users/getOrders {id: 123}"
      - "GET /users/123/orders"
      - "GET /orders/users/123"
    answer: 2
    explanation: "REST는 리소스 간의 계층 구조를 URL 경로로 표현하는 것을 권장합니다. `/users/{id}/orders`는 '사용자 123의 하위 리소스인 주문들'을 명확히 표현합니다."

  - question: "리소스 생성 요청(POST)이 성공했을 때, 서버가 반환해야 하는 가장 적절한 상태 코드와 헤더는?"
    options:
      - "200 OK"
      - "201 Created 와 Location 헤더"
      - "204 No Content"
      - "202 Accepted"
    answer: 1
    explanation: "생성 성공 시 `201 Created` 코드와 함께, 새로 생성된 리소스에 접근할 수 있는 URI를 `Location` 헤더에 담아 보내는 것이 표준입니다."

  - question: "클라이언트가 요청한 데이터 형식이 맞지 않거나 유효성 검증(Validation)에 실패했을 때 반환하기 가장 적절한 상태 코드는?"
    options:
      - "500 Internal Server Error"
      - "401 Unauthorized"
      - "400 Bad Request"
      - "404 Not Found"
    answer: 2
    explanation: "400 Bad Request는 클라이언트의 잘못된 문법이나 유효하지 않은 요청 데이터로 인해 서버가 요청을 처리할 수 없음을 의미합니다."

  - question: "REST 아키텍처 원칙 중 하나로, 서버가 응답에 '이 데이터를 어떻게 처리해야 하는지' 또는 '다음 상태로 전이할 수 있는 링크'를 포함하는 개념은?"
    options:
      - "Stateless (무상태성)"
      - "Cacheable (캐시 가능)"
      - "Layered System (계층형 시스템)"
      - "HATEOAS (Hypermedia as the Engine of Application State)"
    answer: 3
    explanation: "HATEOAS를 만복하면 클라이언트는 서버가 제공하는 링크(Links)를 통해 동적으로 리소스 상태를 전이할 수 있게 됩니다."
study_order: 53
---

## 이 글에서 얻는 것

- **REST 아키텍처 스타일**의 핵심 원칙을 이해합니다.
- **리소스 중심 URL 설계**와 HTTP 메서드의 올바른 사용법을 익힙니다.
- **HTTP 상태코드**(2xx/3xx/4xx/5xx)를 상황에 맞게 선택할 수 있습니다.
- **API 버저닝, 페이징, 필터링** 같은 실전 패턴을 적용할 수 있습니다.

## 0) REST는 "리소스 중심"의 아키텍처 스타일

REST (Representational State Transfer)는 HTTP를 기반으로 한 아키텍처 스타일입니다.

**핵심 개념:**
- **리소스(Resource)**: 데이터의 단위 (예: 사용자, 주문, 상품)
- **표현(Representation)**: 리소스의 형태 (JSON, XML 등)
- **상태 전이(State Transfer)**: HTTP 메서드로 리소스 상태 변경

## 1) REST 설계 원칙

### 1-1) 리소스 중심 설계

**❌ 잘못된 설계 (동사 중심)**
```
POST /createUser
GET /getAllUsers
POST /updateUser
POST /deleteUser
```

**✅ 올바른 설계 (명사 중심)**
```
POST   /users          # 사용자 생성
GET    /users          # 사용자 목록 조회
GET    /users/{id}     # 특정 사용자 조회
PUT    /users/{id}     # 사용자 전체 수정
PATCH  /users/{id}     # 사용자 부분 수정
DELETE /users/{id}     # 사용자 삭제
```

**핵심:**
- URL은 리소스를 나타냄 (명사 사용)
- 동작은 HTTP 메서드로 표현 (GET/POST/PUT/DELETE)

### 1-2) 계층 구조 표현

```
GET /users/{userId}/orders              # 특정 사용자의 주문 목록
GET /users/{userId}/orders/{orderId}    # 특정 주문 상세
GET /orders/{orderId}/items             # 주문의 아이템 목록
```

**주의:**
- 너무 깊은 중첩은 피함 (3단계 이내 권장)
- 독립적인 리소스는 최상위로

## 2) HTTP 메서드

### 2-1) GET: 리소스 조회

```text
# 목록 조회
GET /users HTTP/1.1
Host: api.example.com

# 응답
HTTP/1.1 200 OK
Content-Type: application/json

[
  {"id": 1, "name": "Alice", "email": "alice@example.com"},
  {"id": 2, "name": "Bob", "email": "bob@example.com"}
]
```

```text
# 단일 조회
GET /users/1 HTTP/1.1

# 응답
HTTP/1.1 200 OK
Content-Type: application/json

{"id": 1, "name": "Alice", "email": "alice@example.com"}
```

**특징:**
- **안전(Safe)**: 서버 상태 변경 없음
- **멱등성(Idempotent)**: 여러 번 호출해도 같은 결과
- Body 없음 (쿼리 파라미터로 조건 전달)

### 2-2) POST: 리소스 생성

```text
POST /users HTTP/1.1
Content-Type: application/json

{
  "name": "Charlie",
  "email": "charlie@example.com"
}

# 응답
HTTP/1.1 201 Created
Location: /users/3
Content-Type: application/json

{
  "id": 3,
  "name": "Charlie",
  "email": "charlie@example.com",
  "createdAt": "2025-12-16T10:00:00Z"
}
```

**특징:**
- **비멱등성**: 여러 번 호출 시 여러 리소스 생성
- 201 Created + Location 헤더 반환
- 생성된 리소스의 URI 제공

### 2-3) PUT: 리소스 전체 교체

```text
PUT /users/1 HTTP/1.1
Content-Type: application/json

{
  "name": "Alice Updated",
  "email": "alice.new@example.com"
}

# 응답
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": 1,
  "name": "Alice Updated",
  "email": "alice.new@example.com"
}
```

**특징:**
- **멱등성**: 같은 요청 반복 시 같은 결과
- 전체 필드 교체 (일부 누락 시 null로 처리 가능)
- 리소스가 없으면 생성 가능 (선택적)

### 2-4) PATCH: 리소스 부분 수정

```text
PATCH /users/1 HTTP/1.1
Content-Type: application/json

{
  "name": "Alice Renamed"
}

# 응답
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": 1,
  "name": "Alice Renamed",
  "email": "alice@example.com"  # 기존 값 유지
}
```

**특징:**
- 일부 필드만 수정
- PUT보다 유연함

### 2-5) DELETE: 리소스 삭제

```text
DELETE /users/1 HTTP/1.1

# 응답
HTTP/1.1 204 No Content
```

**특징:**
- **멱등성**: 여러 번 삭제해도 결과 동일
- 204 No Content (본문 없음) 또는 200 OK (삭제된 리소스 반환)

## 3) HTTP 상태코드

### 3-1) 2xx: 성공

```
200 OK               # 요청 성공 (GET, PUT, PATCH)
201 Created          # 생성 성공 (POST)
202 Accepted         # 요청 수락 (비동기 처리)
204 No Content       # 성공, 응답 본문 없음 (DELETE)
```

### 3-2) 3xx: 리다이렉션

```
301 Moved Permanently   # 영구 이동
302 Found               # 임시 이동
304 Not Modified        # 캐시된 리소스 사용
```

### 3-3) 4xx: 클라이언트 오류

```
400 Bad Request          # 잘못된 요청 (유효성 검증 실패)
401 Unauthorized         # 인증 필요
403 Forbidden            # 권한 없음
404 Not Found            # 리소스 없음
405 Method Not Allowed   # 지원하지 않는 HTTP 메서드
409 Conflict             # 리소스 충돌 (중복 등)
422 Unprocessable Entity # 유효성 검증 실패 (상세)
429 Too Many Requests    # 요청 횟수 초과
```

### 3-4) 5xx: 서버 오류

```
500 Internal Server Error  # 서버 내부 오류
502 Bad Gateway            # 게이트웨이 오류
503 Service Unavailable    # 서비스 이용 불가
504 Gateway Timeout        # 게이트웨이 타임아웃
```

### 3-5) 상태코드 선택 가이드

```java
// ✅ 올바른 상태코드 사용
@GetMapping("/users/{id}")
public ResponseEntity<User> getUser(@PathVariable Long id) {
    User user = userService.findById(id);
    if (user == null) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).build();  // 404
    }
    return ResponseEntity.ok(user);  // 200
}

@PostMapping("/users")
public ResponseEntity<User> createUser(@RequestBody User user) {
    User created = userService.create(user);
    return ResponseEntity
        .status(HttpStatus.CREATED)  // 201
        .header("Location", "/users/" + created.getId())
        .body(created);
}

@DeleteMapping("/users/{id}")
public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
    userService.delete(id);
    return ResponseEntity.noContent().build();  // 204
}
```

## 4) URL 설계 패턴

### 4-1) 복수형 명사 사용

```
✅ /users
✅ /orders
✅ /products

❌ /user
❌ /order
❌ /getUsers
```

### 4-2) 케밥 케이스 (kebab-case)

```
✅ /order-items
✅ /user-profiles

❌ /orderItems  (camelCase)
❌ /Order_Items (snake_case)
```

### 4-3) 쿼리 파라미터 활용

```text
# 필터링
GET /users?status=active&age=25

# 정렬
GET /users?sort=createdAt,desc

# 페이징
GET /users?page=1&size=20

# 검색
GET /users?search=alice

# 필드 선택
GET /users?fields=id,name,email
```

### 4-4) 하위 리소스

```text
# 특정 사용자의 주문
GET /users/{userId}/orders

# 특정 주문의 아이템
GET /orders/{orderId}/items

# ⚠️ 너무 깊은 중첩 피하기
❌ /users/{userId}/orders/{orderId}/items/{itemId}/reviews
✅ /reviews?itemId={itemId}
```

## 5) 실전 패턴

### 5-1) 페이징

```text
GET /users?page=1&size=20 HTTP/1.1

# 응답
HTTP/1.1 200 OK
Content-Type: application/json

{
  "content": [
    {"id": 1, "name": "Alice"},
    {"id": 2, "name": "Bob"}
  ],
  "page": 1,
  "size": 20,
  "totalElements": 100,
  "totalPages": 5
}
```

### 5-2) 필터링 & 정렬

```text
# 필터링
GET /products?category=electronics&minPrice=10000&maxPrice=50000

# 정렬
GET /products?sort=price,asc&sort=createdAt,desc

# 복합
GET /products?category=electronics&sort=price,asc&page=1&size=10
```

### 5-3) 부분 응답 (Field Selection)

```text
GET /users?fields=id,name,email HTTP/1.1

# 응답 (필요한 필드만)
[
  {"id": 1, "name": "Alice", "email": "alice@example.com"},
  {"id": 2, "name": "Bob", "email": "bob@example.com"}
]
```

### 5-4) API 버저닝

```text
# URL 버전
GET /v1/users
GET /v2/users

# 헤더 버전
GET /users HTTP/1.1
Accept: application/vnd.myapi.v1+json

# 쿼리 파라미터 버전 (비권장)
GET /users?version=1
```

### 5-5) 에러 응답 포맷

```text
POST /users HTTP/1.1
Content-Type: application/json

{"email": "invalid-email"}

# 응답
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "timestamp": "2025-12-16T10:00:00Z",
  "status": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "path": "/users",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format",
      "rejectedValue": "invalid-email"
    }
  ]
}
```

### 5-6) HATEOAS (Hypermedia)

```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@example.com",
  "_links": {
    "self": {"href": "/users/1"},
    "orders": {"href": "/users/1/orders"},
    "update": {"href": "/users/1", "method": "PUT"},
    "delete": {"href": "/users/1", "method": "DELETE"}
  }
}
```

## 6) 실전 예제: RESTful API 설계

### 블로그 시스템 API

```text
# 게시글 (Posts)
GET    /posts                    # 목록 조회
GET    /posts/{id}               # 상세 조회
POST   /posts                    # 생성
PUT    /posts/{id}               # 수정
DELETE /posts/{id}               # 삭제

# 댓글 (Comments)
GET    /posts/{postId}/comments  # 특정 게시글의 댓글
POST   /posts/{postId}/comments  # 댓글 작성
DELETE /comments/{id}            # 댓글 삭제 (독립적)

# 좋아요
POST   /posts/{id}/like          # 좋아요
DELETE /posts/{id}/like          # 좋아요 취소

# 검색
GET    /posts?search=keyword&sort=createdAt,desc&page=1&size=10
```

### Spring Boot 구현 예제

```java
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    // 목록 조회
    @GetMapping
    public ResponseEntity<Page<UserDTO>> getUsers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status) {
        Page<UserDTO> users = userService.findAll(page, size, status);
        return ResponseEntity.ok(users);
    }

    // 단일 조회
    @GetMapping("/{id}")
    public ResponseEntity<UserDTO> getUser(@PathVariable Long id) {
        UserDTO user = userService.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
        return ResponseEntity.ok(user);
    }

    // 생성
    @PostMapping
    public ResponseEntity<UserDTO> createUser(@Valid @RequestBody CreateUserRequest request) {
        UserDTO created = userService.create(request);
        URI location = URI.create("/api/v1/users/" + created.getId());
        return ResponseEntity.created(location).body(created);
    }

    // 수정
    @PutMapping("/{id}")
    public ResponseEntity<UserDTO> updateUser(
            @PathVariable Long id,
            @Valid @RequestBody UpdateUserRequest request) {
        UserDTO updated = userService.update(id, request);
        return ResponseEntity.ok(updated);
    }

    // 부분 수정
    @PatchMapping("/{id}")
    public ResponseEntity<UserDTO> patchUser(
            @PathVariable Long id,
            @RequestBody Map<String, Object> updates) {
        UserDTO patched = userService.patch(id, updates);
        return ResponseEntity.ok(patched);
    }

    // 삭제
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        userService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
```

## 7) 자주 하는 실수

### ❌ 실수 1: 동사 사용
```
POST /createUser
GET /getUserById?id=1
```

### ✅ 수정
```
POST /users
GET /users/1
```

### ❌ 실수 2: 잘못된 HTTP 메서드
```
GET /users/delete?id=1    # GET으로 삭제
POST /users/search        # POST로 조회
```

### ✅ 수정
```
DELETE /users/1
GET /users?search=keyword
```

### ❌ 실수 3: 부적절한 상태코드
```java
// 리소스 없을 때 200 반환
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) {
    return userService.findById(id).orElse(null);  // null 반환 시 200
}
```

### ✅ 수정
```java
@GetMapping("/users/{id}")
public ResponseEntity<User> getUser(@PathVariable Long id) {
    return userService.findById(id)
        .map(ResponseEntity::ok)
        .orElse(ResponseEntity.notFound().build());  // 404
}
```

## 연습 (추천)

1. **간단한 REST API 설계**
   - 도메인 선택 (예: 도서관, 쇼핑몰)
   - 리소스 정의
   - URL/메서드 매핑

2. **Spring Boot로 구현**
   - Controller 작성
   - 상태코드 올바르게 반환
   - 예외 처리 (@ControllerAdvice)

3. **Postman으로 테스트**
   - 각 엔드포인트 호출
   - 상태코드 확인
   - 에러 케이스 테스트

## 요약: 스스로 점검할 것

- REST는 리소스 중심 설계 (명사 사용)
- HTTP 메서드로 동작 표현 (GET/POST/PUT/PATCH/DELETE)
- 상태코드를 상황에 맞게 선택 (2xx/4xx/5xx)
- 쿼리 파라미터로 필터링/페이징/정렬
- 에러 응답은 일관된 포맷으로 제공
- URL은 계층 구조 표현 (3단계 이내)

## 다음 단계

- Spring MVC 요청 라이프사이클: `/learning/deep-dive/deep-dive-spring-mvc-request-lifecycle/`
- Spring Validation: `/learning/deep-dive/deep-dive-spring-validation-response/`
- API 문서화 (Swagger): `/learning/deep-dive/deep-dive-spring-restdocs-swagger/`
