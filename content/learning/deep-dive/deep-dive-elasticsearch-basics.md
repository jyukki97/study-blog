---
title: "Elasticsearch (Part 1: 개념과 구조)"
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

Elasticsearch의 핵심은 **"단어(Term)"를 보고 "문서 ID(DocID)"를 찾는** 역인덱스 구조입니다.

```mermaid
block-beta
  columns 3
  block:terms
    T1["맥북"]
    T2["프로"]
    T3["M3"]
  end
  space
  block:docs
    D1["Doc 1, 5"]
    D2["Doc 1, 3, 5"]
    D3["Doc 1"]
  end

  T1 --> D1
  T2 --> D2
  T3 --> D3

  style terms fill:#e3f2fd,stroke:#1565c0
  style docs fill:#fff3e0,stroke:#e65100
```
- **Term**: 분석된 단어 (Token)
- **Posting List**: 해당 단어를 포함하는 문서 ID 리스트

### 1-3) Cluster & Sharding Architecture

대용량 데이터를 처리하기 위해 ES는 데이터를 **Shard** 단위로 쪼개서 분산 저장합니다.

```mermaid
flowchart TB
    subgraph Cluster["ES Cluster (docker-cluster)"]
        direction TB
        Node1[Node 1 (Master/Data)]
        Node2[Node 2 (Data)]
        
        subgraph Shards
            P0[Primary Shard 0]
            R0[Replica Shard 0]
        end
        
        Node1 --> P0
        Node2 --> R0
    end

    style Cluster fill:#e3f2fd,stroke:#1565c0
    style Node1 fill:#fff9c4,stroke:#fbc02d
    style Node2 fill:#fff9c4,stroke:#fbc02d
    style P0 fill:#d1c4e9,stroke:#512da8
    style R0 fill:#e1bee7,stroke:#7b1fa2
```
- **Primary Shard**: 원본 데이터 저장 (쓰기 발생)
- **Replica Shard**: 복제본 (읽기 부하 분산, 고가용성)



---

👉 **[다음 편: Elasticsearch (Part 2: 시작과 실무 활용)](/learning/deep-dive/deep-dive-elasticsearch-basics-part2/)**
