---
title: "Outbox/Saga 패턴으로 분산 트랜잭션 다루기"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Outbox", "Saga", "Event Driven", "분산트랜잭션"]
categories: ["Backend Deep Dive"]
description: "Outbox 패턴, Saga(Choreography/Orchestration)로 데이터 일관성을 유지하는 방법"
module: "data-system"
study_order: 37
---

## Outbox 패턴

- 로컬 트랜잭션에 이벤트를 함께 기록 → 별도 프로세스가 이벤트를 전송(Kafka 등)
- 재전송/중복 대비: 이벤트 ID/상태 컬럼, 멱등 컨슈머 필요

## Saga 패턴

- **Choreography**: 서비스들이 이벤트를 구독/발행하며 보상 트랜잭션 수행
- **Orchestration**: 중앙 Orchestrator가 단계별 호출/보상 관리

## 설계 팁

- 보상 트랜잭션을 먼저 정의(실패 대비)
- 상태 머신/워크플로 엔진(예: Camunda, Temporal) 고려
- 이벤트 스키마 버전 관리, 순서/중복 처리

## 체크리스트

- [ ] 로컬 트랜잭션 + Outbox 테이블 트랜잭션을 묶었는가?
- [ ] 이벤트 발행 재시도/중복 대비 멱등 키 적용
- [ ] 보상 트랜잭션과 타임아웃/재시도 정책 정의
