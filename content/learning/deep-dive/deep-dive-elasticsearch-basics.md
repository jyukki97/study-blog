---
title: "Elasticsearch (Part 1: 개념과 구조)"
date: 2025-11-25
draft: false
topic: "Database"
tags: ["Elasticsearch", "Search", "Full-text Search", "Inverted Index", "Analyzer", "BM25"]
categories: ["Backend Deep Dive"]
description: "Elasticsearch의 역인덱스 구조, 분석기 파이프라인(Nori 한국어 포함), 매핑 설계, 쿼리 유형별 실전 코드, BM25 스코어링, 집계, 클러스터 운영 가이드"
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

- **역인덱스(Inverted Index)**의 내부 구조를 이해하고, RDBMS 인덱스와의 차이를 설명할 수 있습니다.
- **분석기(Analyzer)** 파이프라인을 이해하고, 한국어(Nori) 분석기를 설정할 수 있습니다.
- **매핑(Mapping)** 설계 원칙을 익혀 text/keyword/nested 타입을 적절히 선택할 수 있습니다.
- **쿼리 유형**(match/term/bool/range)과 **BM25 스코어링** 원리를 이해할 수 있습니다.
- **집계(Aggregation)**로 실시간 분석 쿼리를 작성할 수 있습니다.
- **클러스터/Shard 설계** 원칙과 운영 체크리스트를 확보합니다.

---

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

| 유형 | 예시 | ES 장점 |
|:-----|:-----|:--------|
| 전문 검색 | 상품 검색, 문서 검색 | 역인덱스 + 형태소 분석 |
| 로그 분석 | ELK Stack | 시계열 인덱싱 + 빠른 집계 |
| 실시간 분석 | 대시보드, 모니터링 | Near Real-Time 집계 |
| 자동완성 | 검색어 추천 | Edge N-gram + Completion Suggester |
| 지리 검색 | 근처 매장 찾기 | Geo-point/Geo-shape 타입 |

---

## 1) 핵심 개념

### 1-1) 인덱스 vs 도큐먼트

```
Elasticsearch      RDBMS             차이점
─────────────────  ──────────────    ──────────────────
Index              Database/Table    스키마리스(동적 매핑)
Document           Row               JSON 구조
Field              Column            중첩/배열 자유
Mapping            Schema            런타임 변경 불가(재인덱싱)
Shard              Partition          수평 분산 저장 단위
```

**예시:**
```json
// Index: products
{
  "_index": "products",
  "_id": "1",
  "_source": {
    "name": "맥북 프로 M3",
    "price": 2500000,
    "category": "노트북",
    "tags": ["Apple", "고성능"],
    "specs": {
      "cpu": "M3 Pro",
      "ram_gb": 18
    },
    "created_at": "2025-12-16"
  }
}
```

### 1-2) 역인덱스 (Inverted Index) 심층

역인덱스는 **"단어(Term) → 문서(DocID) 목록"** 매핑입니다. 일반 DB 인덱스(B-tree)는 "문서 → 값"이지만, 역인덱스는 반대입니다.

**내부 구조:**

```
분석 전 원문:
  Doc 1: "맥북 프로 M3 출시"
  Doc 2: "맥북 에어 경량 노트북"
  Doc 3: "아이패드 프로 M3"

분석 후 Term Dictionary + Posting List:
┌──────────┬──────────────────────────────────────┐
│ Term     │ Posting List                         │
├──────────┼──────────────────────────────────────┤
│ 맥북     │ [Doc1(pos:0, freq:1), Doc2(pos:0, freq:1)] │
│ 프로     │ [Doc1(pos:1, freq:1), Doc3(pos:1, freq:1)] │
│ m3       │ [Doc1(pos:2, freq:1), Doc3(pos:2, freq:1)] │
│ 출시     │ [Doc1(pos:3, freq:1)]                │
│ 에어     │ [Doc2(pos:1, freq:1)]                │
│ 경량     │ [Doc2(pos:2, freq:1)]                │
│ 노트북   │ [Doc2(pos:3, freq:1)]                │
│ 아이패드 │ [Doc3(pos:0, freq:1)]                │
└──────────┴──────────────────────────────────────┘
```

**Posting List 저장 정보:**
- **DocID**: 문서 식별자
- **Term Frequency (TF)**: 해당 문서에서 Term 출현 횟수
- **Position**: Term 위치 (Phrase 검색용)
- **Offset**: 원문 내 시작/끝 위치 (Highlight용)

**검색 동작 예시: "맥북 프로" 검색**
```
1. "맥북 프로" → 분석 → [맥북, 프로]
2. 맥북 → [Doc1, Doc2]
3. 프로 → [Doc1, Doc3]
4. Bool Query에 따라:
   - must(AND): Doc1 (교집합)
   - should(OR): Doc1, Doc2, Doc3 (합집합, Doc1 점수 최고)
```

---

## 2) 분석기(Analyzer) 파이프라인

분석기는 텍스트를 Term으로 변환하는 파이프라인입니다. **인덱싱과 검색 모두에서** 같은 분석기가 적용되어야 정확히 매칭됩니다.

### 2-1) 분석기 구조: 3단계

```
원문 텍스트
    ↓
[Character Filter] → HTML 태그 제거, 특수문자 변환
    ↓
[Tokenizer] → 텍스트를 토큰(단어)으로 분리
    ↓
[Token Filter] → 소문자 변환, 불용어 제거, 동의어 처리
    ↓
최종 Term 목록 → 역인덱스에 저장
```

### 2-2) 내장 분석기 비교

| 분석기 | 입력: "The Quick Brown Fox" | 출력 Term |
|:-------|:--------------------------|:----------|
| `standard` | 기본값 | [the, quick, brown, fox] |
| `simple` | 비문자 기준 분리 | [the, quick, brown, fox] |
| `whitespace` | 공백 기준 분리 | [The, Quick, Brown, Fox] |
| `keyword` | 분석 안 함 | [The Quick Brown Fox] |
| `stop` | + 불용어 제거 | [quick, brown, fox] |

### 2-3) 한국어 분석기: Nori

한국어는 교착어(조사/어미 결합)라서 기본 분석기로는 제대로 검색이 안 됩니다.

**Nori 플러그인 설치:**
```bash
# Elasticsearch에 Nori 플러그인 설치
bin/elasticsearch-plugin install analysis-nori
```

**Nori 분석기 설정:**
```json
PUT /products
{
  "settings": {
    "analysis": {
      "analyzer": {
        "korean_analyzer": {
          "type": "custom",
          "tokenizer": "nori_tokenizer",
          "filter": [
            "nori_readingform",
            "lowercase",
            "nori_part_of_speech_filter",
            "synonym_filter"
          ]
        }
      },
      "tokenizer": {
        "nori_tokenizer": {
          "type": "nori_tokenizer",
          "decompound_mode": "mixed",
          "discard_punctuation": true,
          "user_dictionary": "userdict_ko.txt"
        }
      },
      "filter": {
        "nori_part_of_speech_filter": {
          "type": "nori_part_of_speech",
          "stoptags": ["E", "IC", "J", "MAG", "MAJ",
                       "MM", "SP", "SSC", "SSO", "SC",
                       "SE", "XPN", "XSA", "XSN", "XSV",
                       "UNA", "NA", "VSV"]
        },
        "synonym_filter": {
          "type": "synonym",
          "synonyms": [
            "삼성, 삼성전자, Samsung",
            "맥북, MacBook",
            "노트북, 랩탑, laptop"
          ]
        }
      }
    }
  }
}
```

**Nori decompound_mode 비교:**

| 모드 | 입력: "삼성전자" | 결과 | 사용 상황 |
|:-----|:---------------|:-----|:---------|
| `none` | 복합어 그대로 | [삼성전자] | 정확 매치만 원할 때 |
| `discard` | 분해만 | [삼성, 전자] | 부분 매치 |
| `mixed` (권장) | 원형 + 분해 | [삼성전자, 삼성, 전자] | 정확 + 부분 매치 모두 |

**분석 결과 확인:**
```json
POST /products/_analyze
{
  "analyzer": "korean_analyzer",
  "text": "삼성전자 갤럭시 S25 울트라를 출시했습니다"
}
// 결과: [삼성전자, 삼성, 전자, 갤럭시, s25, 울트라, 출시]
// 조사('를'), 어미('했습니다')가 제거됨
```

---

## 3) 매핑(Mapping) 설계

매핑은 각 필드의 타입과 분석 방법을 정의합니다. **한번 생성된 매핑은 변경 불가** — 변경하려면 재인덱싱이 필요합니다.

### 3-1) 주요 필드 타입

| 타입 | 분석 | 용도 | 예시 |
|:-----|:----:|:-----|:-----|
| `text` | ✅ | 전문 검색 | 상품명, 설명 |
| `keyword` | ❌ | 정확 일치, 필터, 정렬, 집계 | 카테고리, 상태, 이메일 |
| `long`/`integer` | ❌ | 숫자 범위 검색, 정렬 | 가격, 수량 |
| `date` | ❌ | 날짜 범위, 히스토그램 | 생성일, 주문일 |
| `boolean` | ❌ | 필터 | 활성 여부 |
| `nested` | ✅/❌ | 객체 배열 독립 검색 | 리뷰, 옵션 |
| `geo_point` | ❌ | 위치 기반 검색 | 좌표(lat/lon) |
| `completion` | - | 자동완성 Suggest | 검색어 추천 |

### 3-2) text + keyword 복합 매핑 (가장 흔한 패턴)

```json
PUT /products
{
  "mappings": {
    "properties": {
      "name": {
        "type": "text",
        "analyzer": "korean_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          },
          "suggest": {
            "type": "completion"
          }
        }
      },
      "category": {
        "type": "keyword"
      },
      "price": {
        "type": "long"
      },
      "description": {
        "type": "text",
        "analyzer": "korean_analyzer"
      },
      "tags": {
        "type": "keyword"
      },
      "reviews": {
        "type": "nested",
        "properties": {
          "author": { "type": "keyword" },
          "rating": { "type": "integer" },
          "content": { "type": "text", "analyzer": "korean_analyzer" }
        }
      },
      "location": {
        "type": "geo_point"
      },
      "created_at": {
        "type": "date",
        "format": "yyyy-MM-dd'T'HH:mm:ss||yyyy-MM-dd||epoch_millis"
      }
    }
  }
}
```

**`name` 필드 사용 방법:**
- `name` → text 타입, 전문 검색 (`match` 쿼리)
- `name.keyword` → keyword 타입, 정확 일치/정렬/집계 (`term` 쿼리)
- `name.suggest` → completion 타입, 자동완성

### 3-3) Dynamic Mapping vs Explicit Mapping

| | Dynamic | Explicit |
|:--|:--------|:---------|
| 정의 | ES가 필드 타입 자동 추론 | 개발자가 명시적으로 정의 |
| 장점 | 빠른 프로토타이핑 | 정확한 타입 제어 |
| 단점 | 의도와 다른 타입 매핑 (숫자 문자열 → text) | 매핑 작업 필요 |
| 운영 권장 | ❌ | ✅ |

```json
// Dynamic Mapping 비활성화 (권장)
PUT /products
{
  "mappings": {
    "dynamic": "strict",
    "properties": { ... }
  }
}
// dynamic: strict → 매핑에 없는 필드가 들어오면 에러
// dynamic: false  → 매핑에 없는 필드 저장은 하지만 인덱싱 안 함
// dynamic: true   → 자동 매핑 (기본값, 운영 비권장)
```

---

## 4) 쿼리 유형별 실전 코드

### 4-1) 쿼리 유형 분류

```
Query DSL
├── Full-text Query (분석기 거침 → text 타입)
│   ├── match          : 기본 전문 검색
│   ├── multi_match    : 여러 필드 검색
│   ├── match_phrase   : 구문 검색 (순서 유지)
│   └── query_string   : Lucene 구문 직접 사용
│
├── Term-level Query (분석 안 함 → keyword/숫자/날짜)
│   ├── term           : 정확 일치
│   ├── terms          : 다중 값 일치 (IN)
│   ├── range          : 범위 검색
│   ├── exists         : 필드 존재 여부
│   └── prefix/wildcard: 접두사/와일드카드
│
└── Compound Query
    ├── bool           : must/should/must_not/filter 조합
    ├── function_score : 점수 커스터마이징
    └── nested         : nested 객체 검색
```

### 4-2) Bool Query (가장 많이 사용)

```json
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "name": {
              "query": "삼성 노트북",
              "operator": "and"
            }
          }
        }
      ],
      "filter": [
        { "term": { "category": "노트북" } },
        { "range": { "price": { "gte": 500000, "lte": 2000000 } } },
        { "range": { "created_at": { "gte": "2025-01-01" } } }
      ],
      "should": [
        { "term": { "tags": { "value": "고성능", "boost": 2.0 } } },
        { "match": { "description": "가성비" } }
      ],
      "minimum_should_match": 1,
      "must_not": [
        { "term": { "status": "discontinued" } }
      ]
    }
  },
  "highlight": {
    "fields": {
      "name": { "pre_tags": ["<em>"], "post_tags": ["</em>"] },
      "description": { "fragment_size": 150, "number_of_fragments": 3 }
    }
  },
  "sort": [
    { "_score": "desc" },
    { "price": "asc" }
  ],
  "from": 0,
  "size": 20
}
```

**Bool Query 절별 차이:**

| 절 | 점수 계산 | 캐시 | 용도 |
|:---|:---------:|:----:|:-----|
| `must` | ✅ | ❌ | 필수 조건 + 관련도에 영향 |
| `filter` | ❌ | ✅ | 필수 조건 + 점수 무관 (가장 빠름) |
| `should` | ✅ | ❌ | 선호 조건 (점수 부스팅) |
| `must_not` | ❌ | ✅ | 제외 조건 |

> 💡 **성능 팁:** "점수가 필요 없는 조건"은 전부 `filter`로 넣으세요. 캐시되어 반복 쿼리가 빨라집니다.

### 4-3) Nested Query (객체 배열 독립 검색)

```json
// ❌ 일반 object 배열: Cross-matching 문제
// reviews: [{author: "Kim", rating: 5}, {author: "Lee", rating: 1}]
// "Lee가 쓴 별점 5 리뷰" 검색 → 잘못된 매칭 발생!

// ✅ nested 타입 사용
GET /products/_search
{
  "query": {
    "nested": {
      "path": "reviews",
      "query": {
        "bool": {
          "must": [
            { "term": { "reviews.author": "Lee" } },
            { "range": { "reviews.rating": { "gte": 4 } } }
          ]
        }
      },
      "inner_hits": {}
    }
  }
}
```

---

## 5) BM25 스코어링

ES 5.0+의 기본 스코어링 알고리즘은 **BM25(Best Matching 25)**입니다.

### 5-1) BM25 공식 (직관적 이해)

```
score(D, Q) = Σ IDF(qi) × [ TF(qi, D) × (k1 + 1) ]
                            ──────────────────────────
                            TF(qi, D) + k1 × (1 - b + b × |D|/avgdl)
```

| 요소 | 의미 | 영향 |
|:-----|:-----|:-----|
| **TF** (Term Frequency) | 문서 내 검색어 출현 횟수 | 많을수록 높은 점수 (로그적 수렴) |
| **IDF** (Inverse Document Frequency) | 전체 문서 중 검색어 포함 비율의 역수 | 희귀한 단어일수록 높은 점수 |
| **k1** (기본 1.2) | TF 포화 속도 | 높으면 TF가 더 오래 영향 |
| **b** (기본 0.75) | 문서 길이 보정 | 1이면 짧은 문서 유리, 0이면 길이 무시 |
| **avgdl** | 전체 문서 평균 길이 | 정규화 기준 |

**핵심 직관:**
- "맥북"이라는 단어가 3번 나온 짧은 문서 > 3번 나온 긴 문서
- "맥북"(흔한 단어)보다 "M3"(드문 단어)가 매칭 시 점수 기여가 큼

### 5-2) function_score로 비즈니스 로직 반영

```json
GET /products/_search
{
  "query": {
    "function_score": {
      "query": { "match": { "name": "노트북" } },
      "functions": [
        {
          "field_value_factor": {
            "field": "sales_count",
            "modifier": "log1p",
            "factor": 0.5
          },
          "weight": 2
        },
        {
          "gauss": {
            "created_at": {
              "origin": "now",
              "scale": "30d",
              "decay": 0.5
            }
          },
          "weight": 1
        },
        {
          "filter": { "term": { "is_promoted": true } },
          "weight": 3
        }
      ],
      "score_mode": "sum",
      "boost_mode": "multiply"
    }
  }
}
```

| 함수 | 역할 | 효과 |
|:-----|:-----|:-----|
| `field_value_factor` | 판매량으로 부스팅 | 인기 상품 상위 노출 |
| `gauss` (decay) | 최신 상품 우대 | 30일 내 상품이 높은 점수 |
| `filter` + weight | 프로모션 상품 부스팅 | 광고 상품 상위 |

---

## 6) 집계(Aggregation)

집계는 ES의 "실시간 분석 엔진" 기능입니다. SQL의 GROUP BY + SUM/AVG/COUNT를 JSON 형태로 지원합니다.

### 6-1) 집계 유형

| 유형 | 예시 | SQL 대응 |
|:-----|:-----|:---------|
| **Bucket** | 카테고리별 그룹핑 | GROUP BY |
| **Metric** | 평균/최대/최소/합계 | AVG/MAX/MIN/SUM |
| **Pipeline** | 집계 결과에 대한 2차 집계 | 서브쿼리 |

### 6-2) 실전 집계 예시

```json
GET /products/_search
{
  "size": 0,
  "query": {
    "range": { "created_at": { "gte": "2025-01-01" } }
  },
  "aggs": {
    "by_category": {
      "terms": {
        "field": "category",
        "size": 20,
        "order": { "avg_price": "desc" }
      },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } },
        "max_price": { "max": { "field": "price" } },
        "price_ranges": {
          "range": {
            "field": "price",
            "ranges": [
              { "to": 500000, "key": "저가" },
              { "from": 500000, "to": 1500000, "key": "중가" },
              { "from": 1500000, "key": "고가" }
            ]
          }
        },
        "monthly_trend": {
          "date_histogram": {
            "field": "created_at",
            "calendar_interval": "month",
            "format": "yyyy-MM"
          },
          "aggs": {
            "monthly_avg": { "avg": { "field": "price" } }
          }
        }
      }
    },
    "overall_stats": {
      "stats": { "field": "price" }
    }
  }
}
```

---

## 7) 클러스터 아키텍처와 Shard 설계

### 7-1) 노드 역할

| 역할 | 설정 | 주요 기능 | 권장 스펙 |
|:-----|:-----|:---------|:---------|
| Master | `node.roles: [master]` | 클러스터 상태 관리, Shard 할당 | CPU/메모리 적당, 디스크 적음 |
| Data | `node.roles: [data]` | 인덱싱, 검색 | 높은 디스크/메모리 |
| Data Hot | `node.roles: [data_hot]` | 최신 데이터 (SSD) | 빠른 SSD |
| Data Warm | `node.roles: [data_warm]` | 오래된 데이터 (HDD) | 대용량 HDD |
| Coordinating | `node.roles: []` | 요청 라우팅, 결과 병합 | CPU |
| Ingest | `node.roles: [ingest]` | 인덱싱 전 데이터 변환 | CPU |

### 7-2) Shard 크기 가이드라인

| 항목 | 권장 | 이유 |
|:-----|:-----|:-----|
| Shard 크기 | 10~50GB | 너무 작으면 오버헤드, 너무 크면 복구 시간 증가 |
| Shard 수/노드 | 20개 이하/GB 힙 | 힙 사용량(Shard 메타데이터)이 누적 |
| Primary Shard | 생성 후 변경 불가 | `_split`/`_shrink`로만 조정 |
| Replica | 최소 1 | 0이면 노드 장애 시 데이터 유실 |

```json
// 인덱스 생성 시 Shard 설정
PUT /products
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "5s"
  }
}
// 3 Primary × 2(원본+복제) = 6 Shard → 최소 2노드 필요
```

### 7-3) Index Lifecycle Management (ILM)

시계열 데이터(로그, 메트릭)의 인덱스를 자동으로 관리합니다.

```json
PUT _ilm/policy/logs_policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_age": "7d",
            "max_size": "50gb",
            "max_docs": 100000000
          },
          "set_priority": { "priority": 100 }
        }
      },
      "warm": {
        "min_age": "30d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 },
          "set_priority": { "priority": 50 },
          "allocate": {
            "require": { "data": "warm" }
          }
        }
      },
      "cold": {
        "min_age": "90d",
        "actions": {
          "freeze": {},
          "allocate": {
            "require": { "data": "cold" }
          }
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": { "delete": {} }
      }
    }
  }
}
```

```
Hot (SSD)          Warm (HDD)         Cold (Archive)     Delete
0~7일              30~90일             90~365일            365일+
활발한 쓰기/읽기    읽기만              거의 접근 없음       자동 삭제
높은 I/O           Shrink+ForceMerge  Freeze              
```

---

## 8) 성능 최적화 팁

### 인덱싱 성능

| 기법 | 효과 | 설정 |
|:-----|:-----|:-----|
| Bulk API | 건별 요청 대비 10~20배 빠름 | `_bulk`, 배치 크기 5~15MB |
| refresh_interval 늘리기 | 쓰기 부하 감소 | 대량 인덱싱 시 `"30s"` 또는 `"-1"` |
| Replica 0으로 인덱싱 | 복제 오버헤드 제거 | 인덱싱 후 Replica 복구 |
| 불필요한 필드 비활성화 | 인덱스 크기 감소 | `"enabled": false`, `"index": false` |

### 검색 성능

| 기법 | 효과 | 설명 |
|:-----|:-----|:-----|
| filter 활용 | 캐시 + 점수 계산 생략 | 점수 불필요 조건은 전부 filter |
| _source filtering | 네트워크 전송량 감소 | `"_source": ["name", "price"]` |
| Routing | 검색 Shard 수 감소 | `"routing": "category_id"` |
| Search After | Deep paging 대안 | `from: 10000`은 성능 문제 → search_after 사용 |

---

## 안티패턴 6가지

| # | 안티패턴 | 문제 | 올바른 방법 |
|---|:---------|:-----|:-----------|
| 1 | Dynamic Mapping 운영 사용 | 의도치 않은 타입 + Mapping Explosion | `dynamic: strict` |
| 2 | keyword 필드에 match 쿼리 | 분석 안 되므로 정확 일치만 동작 | keyword → term, text → match |
| 3 | from+size deep paging | 10000건+ 시 OOM 위험 | `search_after` + PIT |
| 4 | 무분별한 nested 사용 | 문서당 Lucene 문서 수 폭증 | 정말 독립 검색이 필요한 경우만 |
| 5 | Shard 과다(인덱스당 수십 개) | 힙/메타데이터 오버헤드 | Shard 10~50GB 기준 산정 |
| 6 | refresh_interval=1s + 대량 인덱싱 | Segment 과다 생성 | 대량 인덱싱 시 30s 또는 -1 |

---

## 운영 체크리스트

- [ ] 매핑을 Explicit으로 설계했는가? (`dynamic: strict`)
- [ ] text/keyword 복합 매핑을 적절히 사용하고 있는가?
- [ ] 한국어 필드에 Nori 분석기를 설정했는가?
- [ ] Shard 크기가 10~50GB 범위인가?
- [ ] Replica가 최소 1 이상인가?
- [ ] ILM 정책이 설정되어 있는가? (시계열 데이터)
- [ ] Bulk API를 사용하고 있는가? (건별 인덱싱 아님)
- [ ] 점수 불필요 조건은 filter로 처리하고 있는가?
- [ ] `_cluster/health` 상태가 Green인가?
- [ ] 디스크 사용량 85% 이하인가? (watermark 기본값)

---

## 관련 글

- [Elasticsearch (Part 2: 시작과 실무 활용)](/learning/deep-dive/deep-dive-elasticsearch-basics-part2/)
- [ELK Stack: 로그 수집과 분석](/learning/deep-dive/deep-dive-elk-stack/)
- [로깅 전략](/learning/deep-dive/deep-dive-logging-strategy/)
- [구조화된 로깅](/learning/deep-dive/deep-dive-structured-logging/)
- [Prometheus & Grafana](/learning/deep-dive/deep-dive-prometheus-grafana/)
- [APM 기초](/learning/deep-dive/deep-dive-apm-basics/)
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)
- [데이터베이스 인덱싱](/learning/deep-dive/deep-dive-database-indexing/)
