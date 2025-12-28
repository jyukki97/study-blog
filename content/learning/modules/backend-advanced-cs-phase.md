---
title: "9단계: 컴퓨터 공학 심화 (Deep CS)"
date: 2025-12-28
draft: false
topic: "Backend Roadmap"
tags: ["CS", "Distributed Systems", "Database Internals", "OS"]
categories: ["Learning"]
description: "분산 시스템의 정합성 모델, DB 스토리지 엔진의 원리 등 시니어 레벨로 가기 위한 이론적 깊이를 다룹니다."
weight: 9
study_order: 90
layout: "learning-module"
module_key: "advanced-cs"
url: "/learning/modules/backend-advanced-cs-phase/"
---

## 이 단계에서 얻는 것

프레임워크나 라이브러리 사용법을 넘어, **시스템의 근본 원리(First Principles)**를 파고듭니다.  
왜 분산 시스템에서 데이터가 깨지는지, DB가 디스크에 어떻게 쓰는지 이해하면 "해결할 수 없는 문제"와 "해결할 수 있는 문제"를 구분할 수 있게 됩니다.

- **데이터 정합성(Consistency)**: Eventual Consistency가 실제 시스템에서 어떤 부작용을 낳는지, 어떻게 제어하는지 이해합니다.
- **스토리지 엔진**: B-Tree와 LSM-Tree의 차이를 알고, Write-heavy 워크로드에 맞는 DB를 선정할 수 있습니다.
- **분산 합의**: 리더가 죽었을 때 시스템이 어떻게 합의하고 복구하는지 원리를 봅니다.

## 커리큘럼 (Topic List)

### 1. 분산 시스템 이론 (Distributed Systems)
- **Consistency Models**: Linearizability(Strong) vs Sequential vs Eventual Consistency.
- **CAP & PACELC**: 단순히 "3개 중 2개"가 아니라, 지연(Latency)과 정합성(Consistency)의 트레이드오프 파악.
- **Clock Synchronization**: 물리적 시간의 한계와 Logical Clock (Lamport, Vector Clock).

### 2. 데이터베이스 내부 (Database Internals)
- **Storage Engines**: 
    - **B-Tree**: Read에 유리한 전통적 구조 (MySQL InnoDB).
    - **LSM-Tree (Log Structured Merge)**: Write에 유리한 구조 (Cassandra, RocksDB).
- **Transaction & WAL**: Crash Recovery를 위한 Write Ahead Log의 역할.

### 3. 운영체제와 네트워크 심화 (OS & Network)
- **I/O Models**: Blocking, Non-blocking, Multiplexing (Epoll), BIO/NIO/AIO 비교.
- **Zero Copy**: Kafka가 빠른 이유 (sendfile 시스템 콜).

## 추천 학습 자료
- **책**: *Data-Intensive Applications (데이터 중심 애플리케이션 설계)* - 팀장급 필독서
- **논문**: Google Spanner, Amazon Dynamo, Raft Consensus
