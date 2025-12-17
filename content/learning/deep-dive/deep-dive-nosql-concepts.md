---
title: "NoSQL 기초: RDBMS와 비교하고 언제 사용할지 판단하기"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["NoSQL", "MongoDB", "Redis", "CAP Theorem", "Document DB", "Key-Value Store"]
categories: ["Backend Deep Dive"]
description: "NoSQL의 종류와 특징을 이해하고, RDBMS vs NoSQL 선택 기준을 실무 관점에서 정리"
module: "data-system"
study_order: 215
---

## 이 글에서 얻는 것

- **NoSQL**이 무엇이고, RDBMS와 어떻게 다른지 이해합니다.
- **CAP 이론**으로 분산 시스템의 트레이드오프를 설명할 수 있습니다.
- **MongoDB**(Document DB)와 **Redis**(Key-Value Store)의 기본 사용법을 익힙니다.
- **언제 NoSQL을 쓰고, 언제 RDBMS를 쓸지** 판단할 수 있습니다.

## 0) NoSQL은 "Not Only SQL"이다

### NoSQL이란?

```
NoSQL = Not Only SQL
- 관계형 모델이 아닌 다양한 데이터 모델
- 분산 환경에 최적화
- 유연한 스키마
- 수평 확장(Scale-out)에 강함
```

**왜 등장했나?**
- 대용량 데이터 처리 필요성 증가
- 빠른 서비스 변화에 유연한 스키마 필요
- 수평 확장이 쉬워야 함
- JOIN보다 빠른 읽기가 필요한 경우

## 1) RDBMS vs NoSQL 비교

### 1-1) 핵심 차이

| 특징 | RDBMS | NoSQL |
|------|-------|-------|
| **데이터 모델** | 테이블(행/열) | Document, Key-Value, Column, Graph 등 |
| **스키마** | 고정(엄격) | 유연(schema-less) |
| **확장** | 수직 확장(Scale-up) | 수평 확장(Scale-out) |
| **트랜잭션** | ACID 보장 | BASE (최종 일관성) |
| **JOIN** | 강력한 JOIN 지원 | JOIN 제한적 (비정규화 선호) |
| **사용 사례** | 금융, 회계, ERP | 실시간 분석, 로그, 캐시, 소셜 네트워크 |

### 1-2) 예시 비교

**RDBMS (MySQL)**
```sql
-- 테이블 구조 (고정 스키마)
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    age INT
);

INSERT INTO users (id, name, email, age)
VALUES (1, 'Alice', 'alice@example.com', 25);

-- JOIN
SELECT u.name, o.amount
FROM users u
JOIN orders o ON u.id = o.user_id;
```

**NoSQL (MongoDB)**
```javascript
// Document (JSON-like, 유연한 스키마)
db.users.insertOne({
    _id: 1,
    name: "Alice",
    email: "alice@example.com",
    age: 25,
    address: {  // 중첩 구조 가능
        city: "Seoul",
        zipcode: "12345"
    },
    tags: ["developer", "gamer"]  // 배열 가능
});

// 다른 구조도 같은 컬렉션에 저장 가능
db.users.insertOne({
    _id: 2,
    name: "Bob",
    email: "bob@example.com"
    // age 없어도 됨!
});

// JOIN 대신 비정규화 또는 임베딩
db.users.insertOne({
    _id: 3,
    name: "Charlie",
    orders: [  // 주문 정보를 사용자 문서에 포함
        { orderId: 101, amount: 10000 },
        { orderId: 102, amount: 20000 }
    ]
});
```

## 2) CAP 이론: 분산 시스템의 트레이드오프

### 2-1) CAP란?

```
CAP Theorem:
분산 시스템은 다음 3가지 중 최대 2가지만 보장 가능

C (Consistency): 일관성
  - 모든 노드가 같은 시간에 같은 데이터를 본다

A (Availability): 가용성
  - 모든 요청이 항상 응답을 받는다

P (Partition Tolerance): 분할 내성
  - 네트워크 장애가 발생해도 시스템이 동작한다
```

### 2-2) 선택의 예

```
CP (일관성 + 분할 내성):
- 예: MongoDB, HBase
- 네트워크 장애 시 일관성을 위해 일부 요청 거부
- 사용 사례: 금융 데이터, 재고 관리

AP (가용성 + 분할 내성):
- 예: Cassandra, DynamoDB
- 네트워크 장애 시에도 응답 (나중에 일관성 맞춤)
- 사용 사례: 소셜 미디어, 로그 수집

CA (일관성 + 가용성):
- 예: 전통적인 RDBMS (단일 노드)
- 분산 환경에서는 비현실적
```

### 2-3) ACID vs BASE

**ACID (RDBMS)**
```
Atomicity: 전체 성공 또는 전체 실패
Consistency: 일관성 규칙 유지
Isolation: 트랜잭션 간 독립성
Durability: 영구 저장
```

**BASE (NoSQL)**
```
Basically Available: 기본적으로 가용
Soft state: 일시적 불일치 허용
Eventually consistent: 최종적으로 일관성
```

## 3) NoSQL 종류

### 3-1) Key-Value Store

**대표: Redis, DynamoDB**

```
특징:
- 가장 단순한 구조 (Key → Value)
- 매우 빠른 읽기/쓰기
- 캐시, 세션 저장에 적합

데이터 구조:
Key      → Value
"user:1" → {"name": "Alice", "age": 25}
"cart:1" → ["item1", "item2"]
```

**Redis 예시:**
```bash
# String
SET user:1:name "Alice"
GET user:1:name  # "Alice"

# Hash
HSET user:1 name "Alice" age 25
HGET user:1 name  # "Alice"

# List
LPUSH cart:1 "item1" "item2"
LRANGE cart:1 0 -1  # ["item2", "item1"]

# Set
SADD tags:1 "developer" "gamer"
SMEMBERS tags:1  # ["developer", "gamer"]

# Sorted Set (스코어 기반 정렬)
ZADD leaderboard 100 "Alice" 200 "Bob"
ZRANGE leaderboard 0 -1 WITHSCORES
```

### 3-2) Document Store

**대표: MongoDB, Couchbase**

```
특징:
- JSON/BSON 형태의 문서 저장
- 유연한 스키마
- 중첩 구조, 배열 지원
- 복잡한 쿼리 가능
```

**MongoDB 예시:**
```javascript
// 삽입
db.users.insertOne({
    name: "Alice",
    email: "alice@example.com",
    age: 25,
    address: {
        city: "Seoul",
        zipcode: "12345"
    },
    tags: ["developer", "gamer"]
});

// 조회
db.users.find({ age: { $gte: 20 } });  // age >= 20
db.users.find({ "address.city": "Seoul" });  // 중첩 필드 쿼리
db.users.find({ tags: "developer" });  // 배열 검색

// 업데이트
db.users.updateOne(
    { name: "Alice" },
    { $set: { age: 26 } }
);

// 집계
db.users.aggregate([
    { $match: { age: { $gte: 20 } } },
    { $group: { _id: "$address.city", count: { $sum: 1 } } }
]);
```

### 3-3) Column-Family Store

**대표: Cassandra, HBase**

```
특징:
- 열 단위로 데이터 저장
- 대용량 쓰기에 최적화
- 시계열 데이터, 로그에 적합

구조:
Row Key | Column Family: columns
--------|----------------------
user:1  | profile: {name: "Alice", age: 25}
        | activity: {last_login: "2025-12-16", login_count: 100}
```

### 3-4) Graph Database

**대표: Neo4j, ArangoDB**

```
특징:
- 노드(Node)와 관계(Edge)로 데이터 표현
- 복잡한 관계 쿼리에 강함
- 소셜 네트워크, 추천 시스템에 적합

예: "Alice는 Bob을 팔로우한다"
(Alice) -[FOLLOWS]-> (Bob)
```

## 4) 실무 사용 사례

### 4-1) Redis: 캐시 + 세션

**Spring Boot + Redis 캐시**
```yaml
# application.yml
spring:
  data:
    redis:
      host: localhost
      port: 6379
  cache:
    type: redis
```

```java
@Service
public class UserService {

    @Cacheable(value = "users", key = "#id")
    public User findById(Long id) {
        // DB 조회 (캐시 미스 시에만 실행)
        return userRepository.findById(id).orElseThrow();
    }

    @CacheEvict(value = "users", key = "#id")
    public void deleteUser(Long id) {
        userRepository.deleteById(id);
    }
}
```

**세션 저장**
```java
// Redis에 세션 저장
@Configuration
@EnableRedisHttpSession
public class RedisSessionConfig {
    // spring-session-data-redis 사용
}
```

### 4-2) MongoDB: 유연한 스키마

**Spring Boot + MongoDB**
```java
// 엔티티 (유연한 구조)
@Document(collection = "products")
public class Product {
    @Id
    private String id;
    private String name;
    private Double price;

    // 동적 필드 (Document에만 있을 수 있음)
    private Map<String, Object> attributes;  // 카테고리별 다른 속성
}

// Repository
public interface ProductRepository extends MongoRepository<Product, String> {
    List<Product> findByPriceGreaterThan(Double price);

    @Query("{ 'attributes.color': ?0 }")
    List<Product> findByColor(String color);
}

// Service
@Service
public class ProductService {
    @Autowired
    private ProductRepository productRepository;

    public List<Product> findExpensiveProducts() {
        return productRepository.findByPriceGreaterThan(10000.0);
    }
}
```

## 5) RDBMS vs NoSQL 선택 기준

### 5-1) RDBMS를 써야 할 때

```
✅ 강한 일관성이 필요: 금융, 결제, 재고
✅ 복잡한 트랜잭션: 여러 테이블 간 ACID 보장
✅ 복잡한 JOIN: 정규화된 데이터, 관계형 쿼리
✅ 명확한 스키마: 데이터 구조가 고정적
✅ 예측 가능한 확장: 수직 확장으로 충분

예:
- 은행 계좌 이체
- ERP 시스템
- 주문/결제 시스템
```

### 5-2) NoSQL을 써야 할 때

```
✅ 대용량 데이터: TB ~ PB급 데이터
✅ 수평 확장: 서버 추가로 확장
✅ 유연한 스키마: 빠른 변경, 다양한 구조
✅ 빠른 읽기/쓰기: 캐시, 실시간 분석
✅ 최종 일관성 허용: 약간의 지연 괜찮음

예:
- 로그 수집 (Cassandra)
- 캐시/세션 (Redis)
- 실시간 분석 (MongoDB)
- 소셜 그래프 (Neo4j)
```

### 5-3) 하이브리드 전략 (추천)

```
실무에서는 RDBMS + NoSQL 병행 사용

예: 전자상거래
- RDBMS (MySQL): 주문, 결제, 재고 (강한 일관성)
- Redis: 장바구니, 세션 (빠른 읽기/쓰기)
- MongoDB: 상품 리뷰, 로그 (유연한 스키마)
- Elasticsearch: 상품 검색 (전문 검색)
```

## 6) 주의사항

### ❌ 실수 1: NoSQL을 만능으로 생각

```
NoSQL이 빠르다고 모든 곳에 쓰면 안 됨!
- 복잡한 JOIN이 필요하면 RDBMS가 더 적합
- 강한 일관성이 필요하면 RDBMS 사용
```

### ❌ 실수 2: 스키마 없다고 설계 안 함

```
NoSQL도 데이터 모델링이 중요!
- MongoDB도 인덱스 설계 필요
- Redis도 키 네이밍 전략 필요
- Cassandra도 파티션 키 설계 필수
```

### ❌ 실수 3: 트랜잭션 무시

```
NoSQL은 트랜잭션이 약함
- MongoDB는 4.0부터 멀티 문서 트랜잭션 지원
- Redis는 MULTI/EXEC로 제한적 지원
- 설계 시 이를 고려해야 함
```

## 연습 (추천)

1. **Redis 캐시 구현**
   - Spring Boot + Redis로 사용자 정보 캐싱
   - TTL 설정, 캐시 무효화

2. **MongoDB CRUD**
   - Document 삽입/조회/업데이트/삭제
   - 복잡한 쿼리 (중첩 필드, 배열)

3. **RDBMS vs NoSQL 비교**
   - 같은 데이터를 MySQL과 MongoDB에 저장
   - 쿼리 성능 비교

## 요약: 스스로 점검할 것

- NoSQL과 RDBMS의 차이를 설명할 수 있다
- CAP 이론으로 분산 시스템의 트레이드오프를 이해한다
- Redis와 MongoDB의 기본 사용법을 안다
- RDBMS vs NoSQL 선택 기준을 설명할 수 있다
- 하이브리드 전략의 필요성을 이해한다

## 다음 단계

- Redis 심화: `/learning/deep-dive/deep-dive-redis-advanced/`
- MongoDB 인덱싱: `/learning/deep-dive/deep-dive-mongodb-indexing/`
- Elasticsearch: `/learning/deep-dive/deep-dive-elasticsearch-basics/`
