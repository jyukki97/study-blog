---
title: "스토리지 엔진 내부: B-Tree vs LSM-Tree"
date: 2025-12-28
draft: false
topic: "Database Internals"
tags: ["Database", "B-Tree", "LSM-Tree", "Storage Engine", "Performance"]
categories: ["Backend Deep Dive"]
description: "DB 성능의 핵심인 스토리지 엔진. MySQL의 B-Tree와 Cassandra/RocksDB의 LSM-Tree 구조를 비교하고 장단점을 파헤칩니다."
module: "advanced-cs"
study_order: 902
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
    Root[Root Page] --> Child1[Page A (1-10)]
    Root --> Child2[Page B (11-20)]
    
    Child1 --> Leaf1[Leaf: Data 5]
    Child1 --> Leaf2[Leaf: Data 8]
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
graph TD
    subgraph RAM
    Mem[MemTable (Sorted Memory)]
    end
    
    subgraph Disk
    SST1[SSTable L0]
    SST2[SSTable L1]
    SST3[SSTable L1]
    end
    
    Input[Write Request] --> Mem
    Mem -.->|Flush (Sequential Write)| SST1
    SST1 -.->|Compaction (Merge)| SST2
```

1. **MemTable**: 일단 메모리에 씁니다. (엄청 빠름)
2. **Flush**: 메모리가 차면 디스크에 통째로 씁니다. **순차 쓰기(Sequential Write)**이므로 디스크 속도의 한계까지 씁니다.
3. **SSTable**: 디스크에 저장된 파일은 **불변(Immutable)**입니다. 수정하지 않습니다.
4. **Compaction**: 파일이 너무 많아지면, 백그라운드에서 합치면서 삭제된 데이터를 정리합니다.

### 트레이드오프
- **Write**: B-Tree보다 압도적으로 빠릅니다. (로그 쌓듯이 쓰니까)
- **Read**: 여러 파일을 뒤져야 할 수 있어서 느릴 수 있습니다. (Bloom Filter로 보완)

## 요약

| DB 종류 | 엔진 | 강점 | 약점 | 용도 |
| :--- | :--- | :--- | :--- | :--- |
| **MySQL** | B-Tree | Read Fast | Write Slow | 일반적인 웹 서비스 (CRUD) |
| **Cassandra** | LSM-Tree | Write Fast | Read Slower | 채팅 로그, 센서 데이터, 주문 내역 |

**결론**: 쓰기가 미친듯이 많은 시스템(채팅, 로그)을 만든다면 MySQL을 고집하지 말고 LSM 기반 DB를 검토하세요.
