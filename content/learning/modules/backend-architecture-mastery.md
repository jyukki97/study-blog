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
url: "/learning/modules/backend-architecture-mastery/"
learning_refs:
  - title: "운영용 상태 머신 설계"
    href: "/learning/deep-dive/deep-dive-operational-state-machine-design/"
    description: "도메인 상태를 단순 enum이 아니라 전이표, 불변식, 감사 이력으로 설계하는 기준입니다."
  - title: "DDD Aggregate"
    href: "/learning/deep-dive/deep-dive-ddd-aggregates/"
    description: "상태 전이와 일관성 경계를 aggregate 단위로 묶는 방법을 함께 봅니다."
  - title: "Transactional Outbox + CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "상태 변경과 이벤트 발행을 같은 업무 사실로 다루는 패턴입니다."
  - title: "분산 트랜잭션"
    href: "/learning/deep-dive/deep-dive-distributed-transactions/"
    description: "서비스 간 정합성을 맞출 때 2PC, Saga, 보상 트랜잭션의 선택 기준을 정리합니다."
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

### 4. 운영 가능한 도메인 상태
- **상태 전이표**: 주문, 결제, 업로드, 배치처럼 실패와 재처리가 있는 흐름은 허용 전이와 금지 전이를 먼저 정의합니다.
- **불변식과 감사 이력**: 금전, 권한, 삭제, 공개 상태는 현재값만 저장하지 말고 전이 근거와 actor를 함께 남깁니다.
- **Outbox/이벤트 연계**: 상태 변경 뒤 필요한 메시지 발행은 같은 트랜잭션 경계에서 기록하고 비동기로 전달합니다.

## 이 단계의 핵심 주제

- 분산 트랜잭션(2PC/Saga/TCC) 설계
- 샤딩/라우팅/리밸런싱 전략
- DDD 전술 패턴과 경계(Bounded Context)
- 운영용 상태 머신과 도메인 불변식 설계

## 미니 실습

- **SAGA 시퀀스 설계**: 성공/실패/보상 흐름 작성
- **샤딩 재배치 시나리오**: 노드 추가 시 데이터 이동량 계산
- **Aggregate 경계 설계**: 트랜잭션 경계 1개로 제한하는 모델 작성
- **상태 전이표 작성**: 주문 또는 업로드 흐름의 허용 전이, 금지 전이, 수동 확인 큐를 표로 정리

## 완료 기준

- 대규모 시스템의 핵심 난제를 구조적으로 설명할 수 있다
- 데이터 정합성과 확장성의 균형점을 말로 정리할 수 있다
- 도메인 경계가 어긋날 때 생기는 문제를 설명할 수 있다
- 상태가 있는 업무 흐름에서 전이표, 불변식, 감사 이력을 설계할 수 있다

## 추천 학습 자료
- **책**: *Microservices Patterns (마이크로서비스 패턴)* - 크리스 리처드슨
- **책**: *Domain-Driven Design (도메인 주도 설계)* - 에릭 에반스 (Blue Book)
