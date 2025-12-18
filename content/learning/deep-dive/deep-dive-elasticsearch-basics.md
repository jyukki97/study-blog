---
title: "Elasticsearch 기초: 전문 검색 엔진 시작하기"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["Elasticsearch", "Search", "Full-text Search", "Inverted Index"]
categories: ["Backend Deep Dive"]
description: "Elasticsearch로 전문 검색을 구현하고 검색 성능을 최적화하는 실전 가이드"
module: "data-system"
study_order: 230
---

## 이 글에서 얻는 것

- **Elasticsearch**가 무엇이고, 언제 사용하는지 이해합니다.
- **인덱스**를 생성하고 문서를 저장할 수 있습니다.
- **검색 쿼리**를 작성하고 결과를 분석할 수 있습니다.
- **Spring Data Elasticsearch**로 통합할 수 있습니다.

## 0) Elasticsearch는 "검색 특화 데이터베이스"다

### 왜 Elasticsearch인가?

**RDBMS의 LIKE 검색:**
```sql
-- ❌ 느린 검색
SELECT * FROM products
WHERE name LIKE '%맥북%'
   OR description LIKE '%맥북%';

-- 문제:
-- - Full Table Scan (인덱스 사용 불가)
-- - 대용량 데이터에서 매우 느림
-- - 형태소 분석 불가 ("맥북프로" 검색 시 "맥북 프로" 못 찾음)
```

**Elasticsearch:**
```json
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "맥북",
      "fields": ["name", "description"]
    }
  }
}

// 장점:
// - 역인덱스로 빠른 검색 (ms 단위)
// - 형태소 분석으로 유연한 검색
// - 관련도 점수 (relevance score)
```

### 사용 사례

```
✅ 전문 검색: 상품 검색, 문서 검색
✅ 로그 분석: ELK Stack (Elasticsearch + Logstash + Kibana)
✅ 실시간 분석: 대시보드, 모니터링
✅ 자동완성: 검색어 추천
```

## 1) 핵심 개념

### 1-1) 인덱스 vs 도큐먼트

```
Elasticsearch      RDBMS
─────────────────  ──────────
Index              Database
Document           Row
Field              Column
Mapping            Schema
```

**예시:**
```json
// Index: products
{
  "_id": "1",
  "_source": {
    "name": "맥북 프로 M3",
    "price": 2500000,
    "category": "노트북",
    "tags": ["Apple", "고성능"],
    "created_at": "2025-12-16"
  }
}
```

### 1-2) 역인덱스 (Inverted Index)

```
일반 인덱스:
문서 ID → 내용

역인덱스:
단어 → 문서 ID 목록

예시:
"맥북" → [1, 5, 10, 15]
"프로" → [1, 3, 5]

"맥북 프로" 검색 → 교집합 → [1, 5]
```

## 2) Elasticsearch 시작

### 2-1) Docker로 실행

```bash
# Elasticsearch + Kibana
docker-compose up -d
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

volumes:
  es-data:
```

**확인:**
```bash
curl http://localhost:9200
# {
#   "name" : "...",
#   "cluster_name" : "docker-cluster",
#   "version" : { "number" : "8.11.0" }
# }
```

### 2-2) 인덱스 생성

```bash
# 인덱스 생성
PUT /products
{
  "mappings": {
    "properties": {
      "name": {
        "type": "text",
        "analyzer": "standard"
      },
      "price": {
        "type": "integer"
      },
      "category": {
        "type": "keyword"
      },
      "tags": {
        "type": "keyword"
      },
      "created_at": {
        "type": "date"
      }
    }
  }
}
```

**필드 타입:**
```
text: 전문 검색 (분석됨)
keyword: 정확히 일치 (분석 안 됨)
integer, long: 숫자
date: 날짜
boolean: true/false
```

## 3) CRUD 작업

### 3-1) 문서 추가

```bash
# 단일 문서
POST /products/_doc/1
{
  "name": "맥북 프로 M3",
  "price": 2500000,
  "category": "노트북",
  "tags": ["Apple", "고성능"],
  "created_at": "2025-12-16"
}

# ID 자동 생성
POST /products/_doc
{
  "name": "아이패드 프로",
  "price": 1200000,
  "category": "태블릿"
}

# 벌크 삽입
POST /_bulk
{ "index": { "_index": "products", "_id": "2" } }
{ "name": "맥북 에어 M2", "price": 1500000, "category": "노트북" }
{ "index": { "_index": "products", "_id": "3" } }
{ "name": "아이맥 M3", "price": 2000000, "category": "데스크톱" }
```

### 3-2) 문서 조회

```bash
# ID로 조회
GET /products/_doc/1

# 전체 조회
GET /products/_search

# 조건 검색
GET /products/_search
{
  "query": {
    "match": {
      "name": "맥북"
    }
  }
}
```

### 3-3) 문서 수정

```bash
# 전체 교체
PUT /products/_doc/1
{
  "name": "맥북 프로 M3 Max",
  "price": 3000000
}

# 부분 수정
POST /products/_update/1
{
  "doc": {
    "price": 2800000
  }
}
```

### 3-4) 문서 삭제

```bash
# 단일 삭제
DELETE /products/_doc/1

# 조건부 삭제
POST /products/_delete_by_query
{
  "query": {
    "range": {
      "price": {
        "lt": 1000000
      }
    }
  }
}
```

## 4) 검색 쿼리

### 4-1) Match Query (전문 검색)

```bash
GET /products/_search
{
  "query": {
    "match": {
      "name": "맥북 프로"
    }
  }
}

# 결과: "맥북", "프로" 중 하나라도 포함된 문서
```

### 4-2) Multi Match (여러 필드 검색)

```bash
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "Apple 노트북",
      "fields": ["name", "category", "tags"]
    }
  }
}
```

### 4-3) Term Query (정확히 일치)

```bash
GET /products/_search
{
  "query": {
    "term": {
      "category": "노트북"
    }
  }
}

# keyword 타입 필드에 사용
```

### 4-4) Range Query (범위 검색)

```bash
GET /products/_search
{
  "query": {
    "range": {
      "price": {
        "gte": 1000000,
        "lte": 2000000
      }
    }
  }
}

# gte: >=, lte: <=, gt: >, lt: <
```

### 4-5) Bool Query (복합 조건)

```bash
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "name": "맥북" } }
      ],
      "filter": [
        { "range": { "price": { "gte": 1000000 } } }
      ],
      "must_not": [
        { "term": { "category": "중고" } }
      ],
      "should": [
        { "term": { "tags": "Apple" } }
      ]
    }
  }
}

# must: AND (점수 영향 O)
# filter: AND (점수 영향 X, 빠름)
# must_not: NOT
# should: OR (점수 가산)
```

## 5) 정렬과 페이징

### 5-1) 정렬

```bash
GET /products/_search
{
  "query": { "match_all": {} },
  "sort": [
    { "price": "desc" },
    { "created_at": "desc" }
  ]
}
```

### 5-2) 페이징

```bash
GET /products/_search
{
  "query": { "match_all": {} },
  "from": 0,
  "size": 10
}

# from: 시작 위치 (0부터)
# size: 개수 (기본: 10, 최대: 10000)
```

## 6) Spring Data Elasticsearch

### 6-1) 의존성

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-data-elasticsearch'
}
```

### 6-2) 설정

```yaml
spring:
  elasticsearch:
    uris: http://localhost:9200
```

### 6-3) Entity

```java
@Document(indexName = "products")
@Setting(settingPath = "elasticsearch/product-settings.json")
public class Product {

    @Id
    private String id;

    @Field(type = FieldType.Text, analyzer = "standard")
    private String name;

    @Field(type = FieldType.Integer)
    private Integer price;

    @Field(type = FieldType.Keyword)
    private String category;

    @Field(type = FieldType.Keyword)
    private List<String> tags;

    @Field(type = FieldType.Date, format = DateFormat.date)
    private LocalDate createdAt;
}
```

### 6-4) Repository

```java
public interface ProductRepository extends ElasticsearchRepository<Product, String> {

    // Query Method
    List<Product> findByName(String name);

    List<Product> findByPriceBetween(Integer min, Integer max);

    List<Product> findByCategory(String category);

    // @Query 사용
    @Query("{\"match\": {\"name\": \"?0\"}}")
    List<Product> searchByName(String name);

    // Bool Query
    @Query("""
        {
          "bool": {
            "must": [
              { "match": { "name": "?0" } }
            ],
            "filter": [
              { "range": { "price": { "gte": ?1, "lte": ?2 } } }
            ]
          }
        }
        """)
    List<Product> searchByNameAndPriceRange(String name, Integer minPrice, Integer maxPrice);
}
```

### 6-5) Service

```java
@Service
public class ProductSearchService {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private ElasticsearchOperations elasticsearchOperations;

    // 단순 검색
    public List<Product> search(String keyword) {
        return productRepository.findByName(keyword);
    }

    // 복잡한 검색
    public List<Product> advancedSearch(String keyword, Integer minPrice, Integer maxPrice) {
        Criteria criteria = new Criteria("name").matches(keyword)
            .and(new Criteria("price").between(minPrice, maxPrice));

        Query query = new CriteriaQuery(criteria);

        SearchHits<Product> searchHits = elasticsearchOperations.search(query, Product.class);

        return searchHits.stream()
            .map(SearchHit::getContent)
            .collect(Collectors.toList());
    }

    // 자동완성
    public List<String> autocomplete(String prefix) {
        Query query = new NativeQueryBuilder()
            .withQuery(QueryBuilders.prefixQuery("name", prefix))
            .withFields("name")
            .withPageable(PageRequest.of(0, 10))
            .build();

        SearchHits<Product> searchHits = elasticsearchOperations.search(query, Product.class);

        return searchHits.stream()
            .map(hit -> hit.getContent().getName())
            .distinct()
            .collect(Collectors.toList());
    }
}
```

## 7) 실전 패턴

### 7-1) 상품 검색

```java
@RestController
@RequestMapping("/api/products")
public class ProductSearchController {

    @Autowired
    private ProductSearchService searchService;

    @GetMapping("/search")
    public ResponseEntity<SearchResult> search(
            @RequestParam String keyword,
            @RequestParam(required = false) Integer minPrice,
            @RequestParam(required = false) Integer maxPrice,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        List<Product> products = searchService.advancedSearch(
            keyword, minPrice, maxPrice
        );

        return ResponseEntity.ok(new SearchResult(products));
    }

    @GetMapping("/autocomplete")
    public ResponseEntity<List<String>> autocomplete(@RequestParam String q) {
        List<String> suggestions = searchService.autocomplete(q);
        return ResponseEntity.ok(suggestions);
    }
}
```

## 8) 베스트 프랙티스

### ✅ 1. 적절한 필드 타입 선택

```java
// ✅ 전문 검색이 필요한 필드
@Field(type = FieldType.Text)
private String description;

// ✅ 정확히 일치 검색 (필터링)
@Field(type = FieldType.Keyword)
private String category;
```

### ✅ 2. 인덱스 매핑 사전 정의

```json
PUT /products
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "name": { "type": "text" },
      "price": { "type": "integer" }
    }
  }
}
```

### ✅ 3. 벌크 작업 사용

```java
// ❌ 나쁜 예: 하나씩 저장
for (Product product : products) {
    productRepository.save(product);
}

// ✅ 좋은 예: 벌크 저장
productRepository.saveAll(products);
```

## 요약

- Elasticsearch는 전문 검색에 특화된 NoSQL
- 역인덱스로 빠른 검색 제공
- text vs keyword 타입 구분 중요
- Spring Data Elasticsearch로 쉽게 통합
- 상품 검색, 로그 분석에 필수

## 다음 단계

- ELK Stack: `/learning/deep-dive/deep-dive-elk-stack/`
- 로그 분석: `/learning/deep-dive/deep-dive-log-analysis/`
- 검색 최적화: `/learning/deep-dive/deep-dive-search-optimization/`
