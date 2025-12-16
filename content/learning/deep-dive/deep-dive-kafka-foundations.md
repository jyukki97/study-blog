---
title: "Kafka 기본: 토픽, 파티션, Consumer Group"
date: 2025-12-16
draft: false
topic: "Kafka"
tags: ["Kafka", "Partition", "Consumer Group", "Offset"]
categories: ["Backend Deep Dive"]
description: "Kafka 핵심 개념과 메시지 흐름, Ordering/스루풋 설계를 위한 기초"
module: "data-system"
study_order: 35
---

## 메시지 흐름

- Producer → Topic → Partition → Broker 저장
- Consumer Group: 파티션당 1컨슈머 매핑, 스케일 아웃 시 파티션 수 ≥ 컨슈머 수
- Offset 저장: 기본은 Kafka 내부 __consumer_offsets, 수동 커밋 가능

## 파티션 설계

- Key 해시 기반 분배 → 동일 Key는 동일 파티션(순서 보장)
- 스루풋이 필요하면 파티션 수 확장, 단 재밸런싱/핫파티션 고려

## 체크리스트

- [ ] 파티션/복제 팩터 결정: 내구성 + 스루풋
- [ ] 메시지 키 설계로 Ordering 요구 충족
- [ ] 자동 커밋 주기, 수동 커밋 여부 명시
- [ ] 압축/배치 설정으로 네트워크 최적화
