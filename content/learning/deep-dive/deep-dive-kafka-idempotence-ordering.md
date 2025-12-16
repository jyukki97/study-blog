---
title: "Kafka 멱등·정렬 처리 전략"
date: 2025-12-16
draft: false
topic: "Kafka"
tags: ["Kafka", "Idempotent", "Ordering", "Exactly Once"]
categories: ["Backend Deep Dive"]
description: "멱등 프로듀서, 정렬 보장 패턴, Exactly-once 처리를 위한 설정과 설계"
module: "data-system"
study_order: 265
---

## 멱등 프로듀서

- `enable.idempotence=true`, `acks=all`, `retries` 충분히
- idempotent producer는 파티션 내 중복 방지, 정렬 유지

## 정렬 보장

- Key 기반 파티션 고정 → 동일 Key는 동일 파티션
- 파티션 수 < 컨슈머 수 시 일부 컨슈머는 빈 파티션, 리밸런스 주기 관리

## Exactly-once?

- Kafka Streams/Transactional producer + consumer에서 `isolation.level=read_committed`
- 일반 컨슈머는 멱등 처리/중복 제거로 현실적 보장

## 체크리스트

- [ ] idempotent 설정/acks/retries 확인
- [ ] 메시지 키 설계로 순서 요구 사항 충족
- [ ] 중복 방지 로직(키 기반 upsert/처리 이력) 포함
