---
title: "스토리지 엔진 내부: B-Tree vs LSM-Tree"
date: 2025-12-28
draft: false
topic: "Database Internals"
tags: ["Database", "B-Tree", "LSM-Tree", "Storage Engine", "Performance"]
categories: ["Backend Deep Dive"]
description: "DB 성능의 핵심인 스토리지 엔진. MySQL의 B-Tree와 Cassandra/RocksDB의 LSM-Tree 구조를 비교하고 장단점을 파헤칩니다."
module: "data-system"
quizzes:
  - question: "B-Tree 기반 스토리지 엔진(MySQL InnoDB)의 쓰기 성능이 느려질 수 있는 주된 이유는?"
    options:
      - "데이터를 순차적으로 쓰기 때문"
      - "정렬된 상태를 유지하기 위해 페이지 분할(Page Split)과 Random I/O가 발생하기 때문"
      - "압축을 수행하기 때문"
      - "로그를 쓰지 않기 때문"
    answer: 1
    explanation: "B-Tree는 데이터를 정렬된 위치에 삽입해야 하므로, 디스크의 임의 위치에 쓰기(Random I/O)가 발생합니다. 쓰기 부하가 높으면 페이지 분할이 빈번해져 성능이 저하됩니다."

  - question: "LSM-Tree 기반 스토리지 엔진(Cassandra, RocksDB)의 핵심 쓰기 방식은?"
    options:
      - "데이터를 항상 정렬된 위치에 덮어씁니다(Update-in-Place)."
      - "데이터를 메모리(MemTable)에 먼저 쓰고, 가득 차면 순차적으로 디스크(SSTable)에 Flush합니다(Append Only)."
      - "데이터를 쓰기 전에 전체 인덱스를 재구성합니다."
      - "모든 쓰기를 동기적으로 디스크에 커밋합니다."
    answer: 1
    explanation: "LSM-Tree는 '먼저 메모리에 쓰고, 나중에 파일로 한꺼번에 Flush'하는 방식입니다. 디스크에는 순차 쓰기(Sequential Write)로 기록되어 쓰기 성능이 매우 뛰어납니다."

  - question: "LSM-Tree에서 'Compaction'이 필요한 이유는?"
    options:
      - "메모리 용량을 늘리기 위해"
      - "여러 SSTable 파일을 병합하여 중복/삭제된 데이터를 정리하고, 읽기 성능을 개선하기 위해"
      - "B-Tree로 변환하기 위해"
      - "WAL을 삭제하기 위해"
    answer: 1
    explanation: "LSM-Tree는 쓰기 시 새 SSTable 파일을 계속 생성합니다. Compaction은 이 파일들을 병합하여 중복 키와 삭제된 데이터를 제거하고, 읽기 시 탐색해야 할 파일 수를 줄입니다."

  - question: "LSM-Tree의 읽기 성능을 보완하기 위해 사용하는 대표적인 자료구조는?"
    options:
      - "Skip List"
      - "Red-Black Tree"
      - "Bloom Filter"
      - "Hash Table"
    answer: 2
    explanation: "Bloom Filter는 특정 키가 SSTable 파일에 '확실히 없음'을 빠르게 판단할 수 있는 확률적 자료구조입니다. 이를 통해 불필요한 파일 읽기를 건너뛰어 읽기 성능을 개선합니다."

  - question: "채팅 메시지나 로그 데이터처럼 쓰기가 압도적으로 많은 시스템에 더 적합한 스토리지 엔진은?"
    options:
      - "B-Tree (MySQL InnoDB)"
      - "LSM-Tree (Cassandra, RocksDB)"
      - "둘 다 동일한 성능을 보인다."
      - "파일 시스템에 직접 쓰는 것이 가장 빠르다."
    answer: 1
    explanation: "LSM-Tree는 순차 쓰기를 최대화하여 쓰기 부하가 높은 워크로드에서 B-Tree보다 훨씬 뛰어난 성능을 보입니다. 로그 수집, 시계열 데이터, 채팅 등에 적합합니다."
study_order: 305
---

## 💾 1. DB는 어떻게 디스크에 쓸까?

데이터베이스는 마법 상자가 아닙니다. 결국엔 `write()` 시스템 콜을 호출해 하드디스크에 파일을 쓰는 프로그램일 뿐입니다.
하지만 **"어떤 구조로 쓰느냐"**에 따라 성능이 100배 차이 납니다.

두 가지 메이저 진영이 있습니다:
1. **B-Tree**: "읽기 최적화" (MySQL, Oracle)
2. **LSM-Tree**: "쓰기 최적화" (Cassandra, RocksDB)

---

## 🌳 2. B-Tree (Update-in-Place)

데이터를 항상 **정렬된 상태**로 유지합니다.

```mermaid
graph TD
    subgraph B_Tree ["B-Tree Structure (Random I/O)"]
        Root[Root Page] --> Branch1[Branch: 1-50]
        Root --> Branch2[Branch: 51-100]
        
        Branch1 --> Leaf1[Leaf: 10, 20...50]
        Branch1 --> Leaf2[Leaf: Split Occurs!]
        
        style Leaf2 fill:#ffccbc,stroke:#d84315
    end
    
    Note[New Insert forces Page Split -> Random I/O]
    Leaf2 -.-> Note
```

- **Read**: `O(log N)`으로 기막히게 빠릅니다. 이진 탐색과 비슷합니다.
- **Write**: 새로운 데이터를 넣으려면?
    1. 적절한 위치(Page)를 찾는다.
    2. 빈 공간이 없으면 페이지를 쪼갠다 (Split).
    3. 디스크의 난수 위치에 쓴다 (**Random I/O**).

> **단점**: 쓰기 요청이 폭주하면 디스크 헤드가 널뛰기를 하느라 느려집니다.

---

## 📝 3. LSM-Tree (Log Structured Merge)

LSM은 **"무조건 순차적으로 쓴다(Append Only)"**는 철학을 가집니다.

### 동작 원리

```mermaid
flowchart TD
    Request["Write Request"] --> WAL[("1. Write Ahead Log")]
    WAL --> Mem["2. MemTable (In-Memory Sort)"]
    
    Mem -- "Flush (When Full)" --> L0["SSTable L0"]
    L0 -- "Compaction" --> L1["SSTable L1"]
    
    style WAL fill:#e1f5fe,stroke:#0277bd
    style Mem fill:#fff9c4,stroke:#fbc02d
    style L0 fill:#e0f2f1,stroke:#00695c
    style L1 fill:#e0f2f1,stroke:#00695c
```

### 3.1 LSM Write Path 상세 (Sequential Write)
1. **WAL (Write Ahead Log)**: 데이터 유실 방지를 위해 로그 파일에 이어쓰기(Append) 합니다. (Sequential I/O -> 매우 빠름)
2. **MemTable**: 메모리 상에서 데이터를 정렬합니다. (Red-Black Tree, Skip List 등)
3. **Internal Flush**: MemTable이 꽉 차면 불변(Immutable) 상태로 전환되고, 백그라운드 스레드가 디스크(SSTable)로 덤프합니다.

### 3.2 Compaction (Merge Sort)
쌓여있는 SSTable 파일들을 병합(Merge)하여 데이터를 정리합니다.

```mermaid
graph TD
    subgraph Level_0 ["Level 0 (Unsorted Overlap)"]
        File1["File A: Key 1..100"]
        File2["File B: Key 50..150"]
    end
    
    subgraph Level_1 ["Level 1 (Sorted, No Overlap)"]
        Merged["Merged File: Key 1..150 (Unique)"]
    end
    
    File1 & File2 -->|Merge Sort + Delete Garbage| Merged
```

1. **MemTable**: 일단 메모리에 씁니다. (엄청 빠름)
2. **Flush**: 메모리가 차면 디스크에 통째로 씁니다. **순차 쓰기(Sequential Write)**이므로 디스크 속도의 한계까지 씁니다.
3. **SSTable**: 디스크에 저장된 파일은 **불변(Immutable)**입니다. 수정하지 않습니다.
4. **Compaction**: 파일이 너무 많아지면, 백그라운드에서 합치면서 삭제된 데이터를 정리합니다.

### 트레이드오프
- **Write**: B-Tree보다 압도적으로 빠릅니다. (로그 쌓듯이 쓰니까)
- **Read**: 여러 파일을 뒤져야 할 수 있어서 느릴 수 있습니다. (Bloom Filter로 보완)

## 요약

| DB 종류 | 엔진 | 쓰기 패턴 | 강점 | 약점 |
| :--- | :--- | :--- | :--- | :--- |
| **MySQL (InnoDB)** | **B-Tree** | Random I/O (Update-in-Place) | **Read** (Index Search 빠름) | **Write** (Page Split 오버헤드) |
| **Cassandra / RocksDB** | **LSM-Tree** | Sequential I/O (Log-Structured) | **Write** (Append Only) | **Read** (여러 파일 스캔 필요) |

**결론**: 쓰기가 미친듯이 많은 시스템(채팅, 로그)을 만든다면 MySQL을 고집하지 말고 LSM 기반 DB를 검토하세요.
