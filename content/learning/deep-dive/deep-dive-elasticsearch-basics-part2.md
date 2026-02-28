---
title: "Elasticsearch (Part 2: 시작과 실무 활용)"
date: 2025-11-25
draft: false
topic: "Database"
tags: ["Elasticsearch", "Search", "Full-text Search", "Inverted Index"]
categories: ["Backend Deep Dive"]
description: "Elasticsearch로 전문 검색을 구현하고 검색 성능을 최적화하는 실전 가이드"
module: "ops-observability"
study_order: 607
quizzes:
  - question: "Elasticsearch가 RDBMS의 LIKE 검색보다 빠른 핵심 이유는?"
    options:
      - "SQL보다 문법이 간단해서"
      - "역인덱스(Inverted Index) 구조로 단어(Term)에서 문서 ID를 O(1)에 가깝게 찾기 때문"
      - "NoSQL이라서"
      - "메모리에만 저장해서"
    answer: 1
    explanation: "LIKE '%키워드%'는 Full Table Scan이 필요하지만, Elasticsearch는 미리 단어별로 문서 ID 목록을 만들어두어(역인덱스) 빠르게 검색합니다."

  - question: "Elasticsearch에서 'text' 타입과 'keyword' 타입의 차이는?"
    options:
      - "둘은 동일하다."
      - "text는 분석(Tokenize)되어 전문 검색에, keyword는 분석 없이 정확히 일치 검색에 사용된다."
      - "keyword가 더 빠르다."
      - "text는 숫자만 저장한다."
    answer: 1
    explanation: "'맥북 프로'를 text로 저장하면 '맥북', '프로'로 분리되어 검색됩니다. keyword는 '맥북 프로' 전체가 하나의 값으로 저장되어 필터링/정렬에 적합합니다."

  - question: "Elasticsearch의 Bool Query에서 'must'와 'filter'의 차이는?"
    options:
      - "둘 다 동일한 AND 조건이다."
      - "must는 점수(Relevance Score)에 영향을 주고, filter는 점수 계산 없이 필터링만 하여 더 빠르다."
      - "filter가 더 느리다."
      - "must는 OR 조건이다."
    answer: 1
    explanation: "검색 결과의 관련도(점수)가 필요 없는 조건(예: 가격 범위)은 filter를 쓰면 캐싱되어 성능이 향상됩니다."

  - question: "Elasticsearch의 Shard와 Replica의 역할은?"
    options:
      - "둘 다 백업용이다."
      - "Primary Shard는 데이터 저장(쓰기), Replica Shard는 읽기 부하 분산과 고가용성(장애 대비)을 제공한다."
      - "Shard는 인덱스, Replica는 문서이다."
      - "Replica가 없으면 검색이 안 된다."
    answer: 1
    explanation: "Primary Shard에 데이터가 저장되고, Replica는 복제본입니다. Primary가 있는 노드가 죽으면 Replica가 Primary로 승격됩니다."

  - question: "Elasticsearch에서 대량 문서를 저장할 때 권장되는 방법은?"
    options:
      - "for문으로 하나씩 save()"
      - "_bulk API 또는 saveAll()로 한 번에 여러 문서를 저장"
      - "트랜잭션으로 묶기"
      - "비동기로 하나씩 저장"
    answer: 1
    explanation: "문서마다 HTTP 요청을 보내면 오버헤드가 큽니다. Bulk API로 한 번에 여러 문서를 보내면 네트워크 왕복이 줄어 성능이 향상됩니다."
---

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

### 2-2) Analyzer Pipeline (분석 과정)

"안녕하세요!"라는 문장이 저장될 때, **Analyzer**를 통해 검색 가능한 **Term**으로 변환됩니다.

```mermaid
flowchart LR
    Input["text: '<b>Hello</b> World!'"] --> CharFilter[Char Filter<br/>(HTML Strip)]
    CharFilter -->|'Hello World!'| Tokenizer[Tokenizer<br/>(Standard)]
    Tokenizer -->|'[Hello, World]'| TokenFilter[Token Filter<br/>(Lowercase)]
    TokenFilter -->|'[hello, world]'| Output["Inverted Index"]

    style Input fill:#eceff1,stroke:#455a64
    style Output fill:#fff3e0,stroke:#e65100
    style Tokenizer fill:#ffe0b2,stroke:#f57c00
```
- **Character Filter**: 문장 전처리 (HTML 태그 제거 등)
- **Tokenizer**: 단어 분리 (공백 기준 등)
- **Token Filter**: 후처리 (소문자 변환, 불용어 제거)

### 2-3) 인덱스 생성


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

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: Elasticsearch (Part 1: 개념과 구조)](/learning/deep-dive/deep-dive-elasticsearch-basics/)**
