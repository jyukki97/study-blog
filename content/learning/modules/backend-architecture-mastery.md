---
title: "11단계: 아키텍처 마스터리 (Architecture Mastery)"
date: 2025-12-28
draft: false
topic: "Backend Roadmap"
tags: ["Distributed Transactions", "Sharding", "DDD", "Microservices"]
categories: ["Learning"]
description: "대규모 분산 시스템에서 발생하는 데이터 정합성 문제와 무한 확장을 위한 샤딩, 그리고 복잡한 도메인을 다루는 DDD까지 아키텍트 레벨의 난제를 다룹니다."
weight: 11
study_order: 110
layout: "learning-module"
module_key: "architecture-mastery"
url: "/learning/career/backend-architecture-mastery/"
---

## 이 단계에서 얻는 것

시스템이 커지면 더 이상 "하나의 DB 트랜잭션"으로 모든 것을 해결할 수 없습니다.  
이 단계에서는 수평 확장의 끝판왕인 **Sharding**과, 서비스 간 정합성을 맞추는 **Distributed Transaction**, 그리고 비즈니스 복잡도를 제어하는 **DDD**를 통해 진정한 시니어 엔지니어, 아키텍트로 거듭납니다.

- **Data Consistency**: 서비스가 쪼개져도 데이터가 깨지지 않게 하는 Saga 패턴과 TCC를 배웁니다.
- **Scalability**: 데이터 10억 건, 사용자 1억 명을 감당하는 샤딩과 Consistent Hashing 원리를 이해합니다.
- **Complexity**: "어디까지 쪼개야 하는가?"에 대한 답을 DDD Aggregate Root로 정의합니다.

## 커리큘럼 (Topic List)

### 1. 분산 트랜잭션 (Distributed Transactions)
- **2PC (Two-Phase Commit)**: XA 트랜잭션의 동작 원리와 치명적인 단점(Blocking).
- **SAGA Pattern**: Choreography(이벤트) vs Orchestration(지휘자). 보상 트랜잭션(Compensating Transaction) 설계.
- **TCC (Try-Confirm-Cancel)**: 예약 시스템 등에서 사용하는 애플리케이션 레벨 트랜잭션.

### 2. 대규모 데이터 확장 (Sharding)
- **Sharding Strategies**: Range(범위) vs Hash(해시) vs Directory(룩업) 샤딩 비교.
- **Consistent Hashing**: 서버가 추가/삭제되어도 데이터 이동을 최소화하는 해싱 알고리즘.
- **Global ID Generation**: 분산 환경에서 유니크 ID 만들기 (Snowflake, UUID).

### 3. 도메인 주도 설계 (Advanced DDD)
- **Aggregate Root**: 트랜잭션의 일관성 경계이자 진입점. "한 트랜잭션에 하나만 수정한다"는 원칙.
- **Bounded Context**: 언어와 모델의 의미가 통용되는 경계 설정.
- **Domain Events**: 결과적 정합성(Eventual Consistency)을 달성하는 핵심 도구.

## 추천 학습 자료
- **책**: *Microservices Patterns (마이크로서비스 패턴)* - 크리스 리처드슨
- **책**: *Domain-Driven Design (도메인 주도 설계)* - 에릭 에반스 (Blue Book)
