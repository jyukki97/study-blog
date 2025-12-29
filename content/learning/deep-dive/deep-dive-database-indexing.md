---
title: "인덱스 기본: B-Tree 구조와 쿼리 성능"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["Database", "Index", "B-Tree", "Query Optimization", "Performance"]
categories: ["Backend Deep Dive"]
description: "인덱스가 왜 빨라지는지(B-Tree/선택도/커버링), 복합 인덱스 설계와 쿼리 튜닝의 기본 감각"
module: "data-system"
quizzes:
  - question: "Clustered Index와 Non-Clustered Index의 가장 핵심적인 차이는?"
    options:
      - "Clustered Index는 더 빠르고, Non-Clustered Index는 느리다."
      - "Clustered Index의 리프 노드에는 실제 데이터(Row)가 있고, Non-Clustered Index의 리프 노드에는 PK 값(포인터)만 있다."
      - "Non-Clustered Index가 더 많은 저장 공간을 차지한다."
      - "둘은 동일한 구조이다."
    answer: 1
    explanation: "Clustered Index는 테이블 데이터 자체를 정렬된 형태로 저장합니다. Non-Clustered Index는 별도 공간에 정렬된 키와 PK 포인터를 저장하며, 실제 데이터를 얻으려면 Clustered Index를 다시 조회해야 합니다(Random Access)."

  - question: "복합 인덱스(Composite Index) `(gender, age)`에서 `WHERE age = 20` 만 쿼리하면 인덱스를 효율적으로 사용하지 못하는 이유는?"
    options:
      - "age 컬럼에 인덱스가 없기 때문"
      - "복합 인덱스는 선두 컬럼(gender)부터 순서대로 매칭되어야 하는데(Leftmost Prefix Rule), 첫 번째 컬럼을 건너뛰었기 때문"
      - "age가 숫자 타입이기 때문"
      - "인덱스 크기가 너무 크기 때문"
    answer: 1
    explanation: "복합 인덱스는 `(gender, age)` 순서로 정렬됩니다. gender 없이 age만 조회하면 정렬된 순서를 활용할 수 없어 인덱스 스캔 효율이 떨어지거나 풀 스캔이 발생합니다."

  - question: "'커버링 인덱스(Covering Index)'가 성능에 유리한 이유는?"
    options:
      - "인덱스 크기가 작아지기 때문"
      - "쿼리에 필요한 모든 컬럼이 인덱스에 포함되어 있어, 테이블(Clustered Index) 접근 없이 인덱스만으로 결과를 반환할 수 있기 때문"
      - "B-Tree 높이가 낮아지기 때문"
      - "쓰기 성능이 향상되기 때문"
    answer: 1
    explanation: "커버링 인덱스는 SELECT하려는 컬럼이 이미 인덱스에 다 있으므로, 별도의 테이블 데이터 파일(Heap/Clustered Index)을 읽지 않아 디스크 I/O를 줄입니다. `SELECT *`를 피하면 커버링 효과를 얻기 쉽습니다."

  - question: "인덱스를 생성하면 쓰기(INSERT/UPDATE/DELETE) 성능이 저하될 수 있는 이유는?"
    options:
      - "쿼리 파싱 시간이 늘어나기 때문"
      - "데이터 변경 시 인덱스의 정렬된 상태를 유지하기 위해 인덱스도 함께 갱신해야 하기 때문"
      - "트랜잭션 로그가 늘어나기 때문"
      - "잠금(Lock)이 발생하지 않기 때문"
    answer: 1
    explanation: "인덱스는 정렬된 상태를 유지해야 합니다. 데이터가 추가/수정/삭제될 때마다 인덱스도 갱신되어야 하므로 쓰기 오버헤드가 발생합니다. 인덱스가 많을수록 쓰기 비용이 커집니다."

  - question: "카디널리티(Cardinality)가 낮은 컬럼(예: 성별: 남/여)에 단독 인덱스를 거는 것이 비효율적인 이유는?"
    options:
      - "인덱스 파일 크기가 너무 커지기 때문"
      - "중복 값이 많아 인덱스로 걸러지는 데이터 비율(선택도)이 낮아, 대부분의 데이터를 여전히 스캔해야 하기 때문"
      - "B-Tree 구조를 사용할 수 없기 때문"
      - "NULL 값이 포함될 수 없기 때문"
    answer: 1
    explanation: "인덱스 효율은 '선택도(Selectivity)'에 달려 있습니다. 성별처럼 값의 종류가 적으면 인덱스로 필터링해도 절반의 데이터를 읽어야 해서 풀 스캔과 성능 차이가 적습니다. 주민번호처럼 유니크한 컬럼이 인덱스 효과가 큽니다."
study_order: 301
---

## 🏎️ 1. 인덱스는 '책의 목차'가 아니다

많은 입문서가 인덱스를 책의 목차에 비유하지만, 엔지니어라면 좀 더 정확한 비유가 필요합니다.
인덱스는 **"정렬된 상태를 유지하는 별도의 자료구조"**입니다.

- **Full/Table Scan**: 사전의 첫 페이지부터 끝 페이지까지 단어 하나하나 찾는 것. `O(N)`
- **Index Scan**: 사전의 'ㄱ', 'ㄴ', 'ㄷ' 탭을 이용해 범위를 좁히고 이진 탐색하는 것. `O(log N)`

하지만 공짜 점심은 없습니다. **정렬된 상태**를 유지해야 하므로, **쓰기(Insert/Update/Delete) 성능을 희생**하여 읽기 속도를 얻는 것입니다.

---

## 🏗️ 2. Clustered vs Non-Clustered Index

가장 중요한 개념이자 가장 많이 헷갈리는 개념입니다.

```mermaid
graph TD
    subgraph Clustered_Index ["Clustered Index (PK)"]
        Root1[Root] --> Leaf1[Leaf Node]
        Leaf1 --> Data1["📄 실제 데이터 행 (Row Data)"]
    end
    
    subgraph Non_Clustered_Index ["Non-Clustered Index"]
        Root2[Root] --> Leaf2[Leaf Node]
        Leaf2 --> Pointer2["📍 PK 값 (Pointer)"]
    end
    
    Pointer2 -.->|Lookup| Root1
    
    style Data1 fill:#ffccbc,stroke:#d84315
    style Pointer2 fill:#b3e5fc,stroke:#0277bd
```

1.  **Clustered Index (PK)**: 책의 **페이지 번호**입니다. 리프 노드에 **실제 데이터(Row)**가 저장됩니다. 테이블당 **하나만** 존재할 수 있습니다.
2.  **Non-Clustered Index**: 책의 **색인(목차)**입니다. 리프 노드에는 **PK 값(주소)**만 있습니다. 이걸 보고 다시 Clustered Index를 뒤져야 실제 데이터를 얻을 수 있습니다 (이 과정을 **Random Access**라고 하며 비쌉니다).

---

## 🌳 2. B-Tree (Balanced Tree) 구조

대부분의 RDBMS(MySQL, Oracle)가 사용하는 기본 인덱스 구조입니다.
핵심은 **트리 높이(Height)를 일정하게 유지**하여, 어떤 데이터를 찾든 균일한 속도(Log N)를 보장하는 것입니다.

```mermaid
graph TD
    Root[Root Node] --> Branch1[Branch: 1-50]
    Root --> Branch2[Branch: 51-100]
    
    Branch1 --> Leaf1[Leaf: 10, 20]
    Branch1 --> Leaf2[Leaf: 30, 40]
    
    Branch2 --> Leaf3[Leaf: 60, 70]
    Branch2 --> Leaf4[Leaf: 80, 90]
    
    Leaf1 -.->|Linked List| Leaf2
    Leaf2 -.->|Linked List| Leaf3
    Leaf3 -.->|Linked List| Leaf4
    
    style Root fill:#e3f2fd,stroke:#2196f3
    style Branch1 fill:#fff9c4,stroke:#fbc02d
    style Leaf1 fill:#c8e6c9,stroke:#4caf50
```

### B-Tree vs Hash Index 비교

| 특징 | B-Tree Index | Hash Index |
| :--- | :--- | :--- |
| **구조** | 트리 (Balanced Tree) | 해시 테이블 (Key-Value) |
| **시간 복잡도** | `O(log N)` | `O(1)` (단건 조회 시) |
| **범위 검색** | **가능** (`BETWEEN`, `>`, `<`) | **불가능** (Equality `=` 만 가능) |
| **사용처** | 대부분의 범용 인덱스 | 인메모리 DB, 정확한 일치 검색 |

### 왜 B-Tree일까?
1. **균형(Balanced)**: 데이터가 편향되지 않아 최악의 경우에도 빠릅니다.
2. **범위 검색(Range Scan)**: 리프 노드끼리 **Linked List**로 연결되어 있습니다. "20살부터 30살까지" 찾을 때, 20살만 찾으면 그 뒤는 쭉 읽으면(Scan) 됩니다.

---

## 🧬 3. 복합 인덱스 (Composite Index)

여러 컬럼을 묶어서 인덱스를 만들 때 가장 중요한 규칙은 **순서**입니다.

### 복합 인덱스: (성별, 나이) 순서라면?

```mermaid
classDiagram
    class CompositeIndex {
        +Male (남)
        +Female (여)
    }
    class MaleGroup {
        20세
        21세
        25세
    }
    class FemaleGroup {
        20세
        22세
        30세
    }
    
    CompositeIndex *-- MaleGroup : 1차 정렬 (성별)
    CompositeIndex *-- FemaleGroup
    MaleGroup : 2차 정렬 (나이)
```
```
(남, 20), (남, 21), (남, 25) ... (여, 20), (여, 22) ...
```
-> **성별**끼리 먼저 뭉치고, 그 안에서 **나이**순으로 정렬됩니다.

```sql
-- ✅ 인덱스 잘 탐 (성별로 먼저 거르고 나이 찾음)
SELECT * FROM users WHERE gender = '남' AND age = 20;

-- ❌ 인덱스 못 탐 (성별 없이 나이만? 정렬 안 되어 있음)
SELECT * FROM users WHERE age = 20;
```

> **Leftmost Prefix Rule**: 인덱스의 왼쪽 컬럼부터 차례대로 사용해야 인덱스가 적용됩니다. 중간을 건너뛰면 그 뒤 컬럼은 인덱스 효과가 사라집니다.

---

## 🛡️ 4. 커버링 인덱스 (Covering Index)

쿼리에 필요한 모든 컬럼이 인덱스 안에 다 있다면? 실제 데이터 파일(Table Heap)을 열어볼 필요가 없습니다.

```mermaid
sequenceDiagram
    participant Query
    participant Index
    participant Table
    
    Note over Query: SELECT name FROM users <br/> WHERE id = 10
    
    Query->>Index: "id=10 있니?"
    Note right of Index: 어, 나 name도 갖고 있는데?
    Index-->>Query: 여기 있어! (name='Alice')
    
    Note over Table: (테이블 접근 안 함 ⚡)
```

이것을 **커버링 인덱스**라고 하며, 쿼리 튜닝의 **치트키**입니다. 불필요한 `SELECT *`만 피해도 성능이 비약적으로 좋아지는 이유입니다.

## 요약

> [!TIP]
> **Index Design Checklist**:
> - [ ] **Cardinality**: 중복도가 낮은(유니크한) 컬럼에 걸어라. (ex. 성별(X) vs 주민번호(O))
> - [ ] **Update**: 쓰기가 너무 빈번한 테이블은 인덱스를 최소화해라.
> - [ ] **Covering**: 쿼리에 필요한 컬럼을 인덱스에 다 포함시켜 테이블 접근을 막아라.
> - [ ] **Composite**: `WHERE`, `ORDER BY`, `GROUP BY` 컬럼 순서대로 인덱스를 구성해라.

1. **Trade-off**: 인덱스는 **쓰기를 죽이고 읽기를 살리는** 기술이다.
2. **B-Tree**: **정렬**되어 있고 **균형** 잡혀 있다.
3. **복합 인덱스**: **순서**가 생명이다. (Leftmost Prefix).
4. **커버링 인덱스**: 테이블 접근을 생략하는 쿼리 튜닝의 핵심.
