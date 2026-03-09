---
title: "GraphQL 스키마 설계 가이드"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["GraphQL", "Schema", "Resolver", "N+1"]
categories: ["Backend Deep Dive"]
description: "스키마 정의, 리졸버 구조, N+1 방지(DataLoader), 버전 관리 베스트 프랙티스"
module: "architecture"
study_order: 485
---

## 이 글에서 얻는 것

- GraphQL을 "한 방에 다 가져오는 API"로만 보지 않고, 스키마/리졸버/권한/성능을 함께 설계하는 감각을 얻습니다.
- N+1, 과도한 쿼리 복잡도, 캐싱/페이징 같은 실무 문제를 어떻게 구조로 풀지 기준이 생깁니다.
- 버전 관리(Deprecated 중심)와 breaking change를 최소화하는 변경 전략을 이해합니다.

## 0) GraphQL의 장점은 '클라이언트 주도'지만, 그만큼 서버가 책임져야 한다

GraphQL의 매력:

- 클라이언트가 필요한 필드만 요청 → over/under-fetch 감소
- 하나의 엔드포인트로 다양한 화면 요구를 수용

대가:

- 서버는 "임의의 쿼리"를 안전하고 빠르게 처리해야 합니다(권한/복잡도/캐싱/관측).

### REST vs GraphQL 선택 기준

| 기준 | REST 유리 | GraphQL 유리 |
|------|-----------|-------------|
| 클라이언트 종류 | 1~2개 (모바일+웹) | 다양한 클라이언트, 각기 다른 데이터 요구 |
| 데이터 구조 | 리소스 중심, 단순한 CRUD | 관계가 복잡하고 중첩 조회가 빈번 |
| 캐싱 | HTTP 캐싱이 자연스러움 | 응답 구조가 가변적이라 캐싱 복잡 |
| 파일 업로드 | 간단 (multipart) | 별도 처리 필요 (multipart spec) |
| 팀 규모/학습 | 진입장벽 낮음 | 스키마 설계/DataLoader 학습 필요 |
| 실시간 | WebSocket/SSE 별도 | Subscription 내장 |

## 1) 스키마 설계: 타입은 계약(Contract)이다

### 1-1) 실전 스키마 예시: 주문 도메인

```graphql
# 기본 타입 정의
type User {
  id: ID!
  name: String!
  email: String!             # non-null: 반드시 존재
  profileImage: String       # nullable: 없을 수 있음
  orders(
    first: Int = 10
    after: String
  ): OrderConnection!        # 커서 기반 페이징
}

type Order {
  id: ID!
  status: OrderStatus!
  totalAmount: Money!
  items: [OrderItem!]!       # 빈 배열은 가능, null 아이템은 불가
  createdAt: DateTime!
  user: User!                # 역방향 관계
}

type OrderItem {
  id: ID!
  product: Product!
  quantity: Int!
  unitPrice: Money!
}

# 값 객체 (Value Object)
type Money {
  amount: BigDecimal!
  currency: CurrencyCode!    # "KRW", "USD"
}

# 열거형
enum OrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
}

enum CurrencyCode {
  KRW
  USD
  JPY
  EUR
}

# 스칼라 타입 정의
scalar DateTime
scalar BigDecimal
```

### 1-2) nullable 설계를 명확히

GraphQL에서 nullable은 "없을 수도 있다"가 아니라 "에러/부분 응답"과도 연결됩니다.

```graphql
type Product {
  id: ID!              # 항상 존재
  name: String!        # 항상 존재
  price: Money!        # 항상 존재

  # nullable = "실패해도 나머지 필드는 반환 가능"
  reviews: [Review!]   # 리뷰 서비스 장애 시 null 반환, 나머지 정상
  recommendation: Product  # 추천 엔진 장애 시 null 반환
}
```

**nullable 설계 원칙:**
- 핵심 필드: `!` (non-null) — 없으면 전체 응답 의미 없음
- 부가/외부 의존 필드: nullable — 장애 격리, 부분 응답 허용
- 리스트: `[Item!]!` (리스트 자체와 아이템 모두 non-null) vs `[Item!]` (리스트가 null 가능)

### 1-3) 입력/출력 타입 분리

```graphql
# 입력: 필요한 필드만, 검증 제약 포함
input CreateOrderInput {
  items: [OrderItemInput!]!       # 최소 1개
  shippingAddressId: ID!
  couponCode: String              # 선택
  note: String                    # 선택
}

input OrderItemInput {
  productId: ID!
  quantity: Int!                  # 서버에서 min=1 검증
}

# 출력: Mutation 결과를 Union으로 표현
type CreateOrderPayload {
  order: Order
  errors: [CreateOrderError!]
}

type CreateOrderError {
  field: String
  message: String!
  code: ErrorCode!
}

enum ErrorCode {
  OUT_OF_STOCK
  INVALID_COUPON
  MINIMUM_AMOUNT_NOT_MET
  INTERNAL_ERROR
}
```

### 1-4) Mutation은 "상태 변경"을 명확히 드러내라

```graphql
type Mutation {
  # 동사 + 명사로 명확한 의도 표현
  createOrder(input: CreateOrderInput!): CreateOrderPayload!
  cancelOrder(orderId: ID!, reason: String): CancelOrderPayload!
  updateOrderStatus(
    orderId: ID!
    status: OrderStatus!
  ): UpdateOrderStatusPayload!

  # ❌ 나쁜 예: 무엇이 바뀌는지 불명확
  # updateOrder(id: ID!, data: JSON): Order
}
```

## 2) 리졸버 구조: N+1은 설계 문제다

### N+1 문제가 발생하는 구조

```graphql
# 이 쿼리를 실행하면...
query {
  orders(first: 20) {
    edges {
      node {
        id
        user { name }         # 주문마다 User 조회 → N+1!
        items {
          product { name }    # 아이템마다 Product 조회 → N+1!
        }
      }
    }
  }
}
```

```
SQL 실행 순서 (N+1):
1. SELECT * FROM orders LIMIT 20                    -- 1회
2. SELECT * FROM users WHERE id = ?   (× 20회)      -- N회
3. SELECT * FROM order_items WHERE order_id = ?  (× 20회)
4. SELECT * FROM products WHERE id = ? (× 아이템 수)
→ 총 수십~수백 회 쿼리!
```

### DataLoader로 N+1 해결

```java
// Spring Boot + GraphQL Java 기반 DataLoader 구현

// 1. BatchLoader 정의
@Component
public class UserBatchLoader implements BatchLoaderEnvironment {

    @Autowired
    private UserRepository userRepository;

    public BatchLoader<Long, User> userLoader() {
        return keys -> {
            // N개의 개별 조회 → 1개의 IN 쿼리로 배치
            Map<Long, User> users = userRepository.findAllById(keys)
                .stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

            // 요청 순서대로 반환 (null 처리 포함)
            return CompletableFuture.completedFuture(
                keys.stream()
                    .map(users::get)
                    .collect(Collectors.toList())
            );
        };
    }
}

// 2. DataLoaderRegistry 등록
@Configuration
public class DataLoaderConfig {

    @Bean
    public DataLoaderRegistry dataLoaderRegistry(
            UserBatchLoader userLoader,
            ProductBatchLoader productLoader) {

        DataLoaderRegistry registry = new DataLoaderRegistry();
        registry.register("users",
            DataLoaderFactory.newDataLoader(userLoader.userLoader()));
        registry.register("products",
            DataLoaderFactory.newDataLoader(productLoader.productLoader()));
        return registry;
    }
}

// 3. 리졸버에서 DataLoader 사용
@Component
public class OrderResolver {

    @SchemaMapping(typeName = "Order", field = "user")
    public CompletableFuture<User> user(
            Order order,
            DataLoader<Long, User> userDataLoader) {

        return userDataLoader.load(order.getUserId());
        // 여러 Order의 user 요청이 자동으로 배치됨
        // → SELECT * FROM users WHERE id IN (1, 2, 3, ...)
    }
}
```

```
DataLoader 적용 후 SQL:
1. SELECT * FROM orders LIMIT 20                         -- 1회
2. SELECT * FROM users WHERE id IN (1,2,3,...,20)        -- 1회 (배치)
3. SELECT * FROM order_items WHERE order_id IN (...)     -- 1회 (배치)
4. SELECT * FROM products WHERE id IN (...)              -- 1회 (배치)
→ 총 4회!
```

### DataLoader 주의사항

| 주의점 | 설명 |
|--------|------|
| 요청 스코프 | DataLoader는 반드시 **요청 단위**로 생성 (캐시 오염 방지) |
| 키 타입 일관성 | `Long`과 `String` 혼용하면 캐시 미스 |
| 에러 전파 | 배치 중 일부 실패 시 `Try` 타입으로 개별 에러 처리 |
| 순서 보장 | 반환 리스트의 순서가 요청 키 순서와 일치해야 함 |

## 3) 페이징: 커서 기반(Connection)으로 간다

### Relay Connection 스펙 구현

```graphql
# Connection 표준 타입
type OrderConnection {
  edges: [OrderEdge!]!
  pageInfo: PageInfo!
  totalCount: Int            # 선택: 전체 개수 (비용 높을 수 있음)
}

type OrderEdge {
  node: Order!
  cursor: String!            # opaque 커서 (클라이언트가 해석하면 안 됨)
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

# 사용
type Query {
  orders(
    first: Int
    after: String
    last: Int
    before: String
    filter: OrderFilter
  ): OrderConnection!
}

input OrderFilter {
  status: OrderStatus
  createdAfter: DateTime
  minAmount: BigDecimal
}
```

### 커서 구현 (서버 사이드)

```java
// 커서: Base64 인코딩된 정렬 키
public class CursorUtil {
    // 커서 생성: 정렬 기준 값을 인코딩
    public static String encode(Instant createdAt, Long id) {
        String raw = createdAt.toEpochMilli() + ":" + id;
        return Base64.getEncoder().encodeToString(raw.getBytes());
    }

    // 커서 디코딩
    public static CursorData decode(String cursor) {
        String raw = new String(Base64.getDecoder().decode(cursor));
        String[] parts = raw.split(":");
        return new CursorData(
            Instant.ofEpochMilli(Long.parseLong(parts[0])),
            Long.parseLong(parts[1])
        );
    }
}

// Repository: 커서 기반 조회
@Query("""
    SELECT o FROM Order o
    WHERE (o.createdAt < :cursorTime
           OR (o.createdAt = :cursorTime AND o.id < :cursorId))
    ORDER BY o.createdAt DESC, o.id DESC
    """)
List<Order> findAfterCursor(
    @Param("cursorTime") Instant cursorTime,
    @Param("cursorId") Long cursorId,
    Pageable pageable
);
```

### Offset vs Cursor 비교

| 기준 | Offset | Cursor |
|------|--------|--------|
| 구현 난이도 | 쉬움 | 중간 |
| 성능 (대량 데이터) | `OFFSET 10000` → 느림 | 일정한 속도 |
| 실시간 데이터 | 중복/누락 발생 가능 | 안정적 |
| 임의 페이지 접근 | 가능 (`?page=5`) | 불가능 (순차 탐색) |
| 추천 | 관리자 UI, 소량 데이터 | 피드, 목록, 대량 데이터 |

## 4) 권한/보안: 필드 단위로 새는 사고를 막아라

### 필드 단위 권한 구현

```java
// 커스텀 디렉티브로 필드 권한 제어
// schema.graphqls
// directive @auth(requires: Role!) on FIELD_DEFINITION

// type User {
//   id: ID!
//   name: String!
//   email: String! @auth(requires: ADMIN)     # 관리자만
//   phone: String @auth(requires: OWNER)      # 본인만
//   orders: OrderConnection! @auth(requires: AUTHENTICATED)
// }

@Component
public class AuthDirective implements SchemaDirectiveWiring {

    @Override
    public GraphQLFieldDefinition onField(
            SchemaDirectiveWiringEnvironment<GraphQLFieldDefinition> env) {

        GraphQLFieldDefinition field = env.getElement();
        DataFetcher<?> originalFetcher = env.getCodeRegistry()
            .getDataFetcher(env.getFieldsContainer(), field);

        String requiredRole = env.getAppliedDirective("auth")
            .getArgument("requires").getValue().toString();

        DataFetcher<?> authFetcher = dataFetchingEnv -> {
            AuthContext ctx = dataFetchingEnv.getGraphQlContext()
                .get("auth");

            if (!ctx.hasRole(requiredRole)) {
                throw new AccessDeniedException(
                    "필드 '" + field.getName() + "' 접근 권한 없음");
            }
            return originalFetcher.get(dataFetchingEnv);
        };

        env.getCodeRegistry().dataFetcher(
            env.getFieldsContainer(), field, authFetcher);
        return field;
    }
}
```

### 쿼리 복잡도 제한

```java
// 악의적 쿼리 차단: depth + complexity 제한
@Configuration
public class GraphQLSecurityConfig {

    @Bean
    public Instrumentation maxQueryDepth() {
        return new MaxQueryDepthInstrumentation(10); // depth 10 제한
    }

    @Bean
    public Instrumentation maxQueryComplexity() {
        return new MaxQueryComplexityInstrumentation(200,
            (env, childComplexity) -> {
                // 리스트 필드는 first/last 인자에 비례하여 가중치
                int first = Optional.ofNullable(
                    env.getArgument("first")).map(Integer.class::cast)
                    .orElse(10);
                return childComplexity * first + 1;
            });
    }
}
```

```graphql
# ❌ 이런 쿼리가 차단됨 (depth 초과)
query DeepNesting {
  user(id: 1) {                    # depth 1
    orders(first: 100) {           # depth 2, complexity ×100
      edges { node {               # depth 3, 4
        items {                    # depth 5
          product {                # depth 6
            reviews(first: 100) {  # depth 7, complexity ×100
              edges { node {       # depth 8, 9
                author {           # depth 10
                  orders { ... }   # depth 11 → 차단!
                }
              }}
            }
          }
        }
      }}
    }
  }
}
```

## 5) 버전 관리: v2를 만들기보다 Deprecated로 이행한다

```graphql
type User {
  # 기존 필드: deprecated 선언
  fullName: String @deprecated(reason: "Use 'name' instead. 2025-06-01 제거 예정")

  # 새 필드: 추가
  name: UserName!
}

type UserName {
  first: String!
  last: String!
  display: String!  # fullName의 역할을 대체
}
```

### 필드 제거 안전 프로세스

```
1. 새 필드 추가 (병행 기간 시작)
2. @deprecated 선언 + 제거 예정일 명시
3. 클라이언트 usage 모니터링 (Apollo Studio, Grafana 등)
4. 사용량 0% 확인 (또는 충분한 마이그레이션 기간)
5. 필드 제거
```

### 필드 사용량 추적

```java
// Instrumentation으로 필드별 사용량 수집
@Component
public class FieldUsageInstrumentation extends SimplePerformantInstrumentation {

    @Autowired private MeterRegistry meterRegistry;

    @Override
    public InstrumentationContext<Object> beginFieldFetch(
            InstrumentationFieldFetchParameters params) {

        String fieldName = params.getExecutionStepInfo()
            .getPath().toString();
        boolean deprecated = params.getField().getDefinition()
            .hasDirective("deprecated");

        if (deprecated) {
            meterRegistry.counter("graphql.deprecated.field.usage",
                "field", fieldName).increment();
        }

        return super.beginFieldFetch(params);
    }
}
```

## 6) 운영 포인트(관측성)

### 핵심 메트릭

| 메트릭 | 목적 | 알림 기준 |
|--------|------|-----------|
| 쿼리별 latency (P50/P95/P99) | 느린 쿼리 식별 | P99 > 1s |
| 에러율 (operation별) | 장애 감지 | > 1% |
| DB 쿼리 수/요청 | N+1 재발 감지 | > 20회/요청 |
| complexity 분포 | 비정상 쿼리 탐지 | > 150 |
| deprecated 필드 사용 | 마이그레이션 진행도 | 주간 리포트 |

### Persisted Queries

프로덕션에서 임의 쿼리를 허용하면 보안/성능 리스크가 있습니다.

```java
// Automatic Persisted Queries (APQ)
// 클라이언트: 쿼리 해시만 전송 → 서버: 해시로 캐시된 쿼리 실행

@Bean
public PersistedQuerySupport persistedQuerySupport() {
    return new ApolloPersistedQuerySupport(
        new InMemoryPersistedQueryCache() // 프로덕션에서는 Redis 사용
    );
}

// 엄격 모드: 사전 등록된 쿼리만 허용
// (보안이 중요한 경우)
@Bean
public PreparsedDocumentProvider preparsedDocumentProvider() {
    Map<String, Document> allowedQueries = loadAllowedQueries();
    return (params, next) -> {
        String hash = sha256(params.getQuery());
        if (!allowedQueries.containsKey(hash)) {
            return ExecutionResult.newExecutionResult()
                .addError(new ValidationError("등록되지 않은 쿼리"))
                .build();
        }
        return next.apply(params);
    };
}
```

## 운영 체크리스트

```markdown
## GraphQL 서비스 점검
- [ ] DataLoader가 모든 1:N 관계에 적용되어 있는가?
- [ ] 쿼리 depth 제한이 설정되어 있는가? (권장: 10 이하)
- [ ] 쿼리 complexity 제한이 설정되어 있는가? (권장: 200 이하)
- [ ] 민감 필드에 권한 디렉티브가 적용되어 있는가?
- [ ] deprecated 필드 사용량을 모니터링하고 있는가?
- [ ] operationName이 로그에 포함되는가?
- [ ] 느린 쿼리 알림이 설정되어 있는가? (P99 > 1s)
- [ ] 에러 응답에 내부 스택트레이스가 노출되지 않는가?
- [ ] Introspection이 프로덕션에서 비활성화되어 있는가?
```

## 연습(추천)

- "주문 조회 화면"을 예로 스키마를 설계하고, N+1이 어떻게 발생하는지 리졸버 호출 흐름을 그려보기
- DataLoader를 적용해 DB 쿼리 수가 어떻게 줄어드는지 측정해보기
- 쿼리 depth/complexity 제한 정책을 정하고, 악의적 쿼리를 만들어 차단되는지 확인해보기
- Relay Connection 스펙으로 커서 기반 페이징을 구현하고, offset 방식과 성능을 비교해보기
- deprecated 필드 하나를 추가하고, 사용량 메트릭이 수집되는지 확인해보기

---

## 관련 심화 학습

- [GraphQL 심화](/learning/deep-dive/deep-dive-graphql-advanced/) — 페이징, 에러 처리, 고급 최적화
- [JPA N+1 문제 해결](/learning/deep-dive/deep-dive-jpa-n-plus-1/) — DataLoader와 유사한 배치 로딩 개념
- [Redis 캐싱 전략](/learning/deep-dive/deep-dive-redis-caching/) — GraphQL 응답 캐싱
- [인증/인가 모델 (RBAC/ABAC/ReBAC)](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/) — 필드 단위 권한 설계
- [REST API 설계](/learning/deep-dive/deep-dive-rest-api-design/) — REST와의 비교 및 하이브리드 전략
