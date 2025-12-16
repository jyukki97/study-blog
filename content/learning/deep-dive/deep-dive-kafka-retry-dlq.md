---
title: "Kafka 재시도/DLQ 설계"
date: 2025-12-16
draft: false
topic: "Kafka"
tags: ["Kafka", "Retry", "DLQ", "Error Handling"]
categories: ["Backend Deep Dive"]
description: "재시도 토픽, DLQ, 멱등 처리로 Kafka 소비 실패를 다루는 패턴"
module: "data-system"
study_order: 255
---

## 재시도 전략

- 재시도 토픽(Delay): 일정 시간 후 재처리, backoff 적용
- 즉시 재시도는 Poll 블로킹 위험 → 짧은 재시도 횟수 + DLQ 권장

## DLQ

- 실패 메시지/예외/스택 정보와 함께 별도 토픽 저장
- DLQ 모니터링 및 재처리 도구 필요

## 멱등 처리

- 메시지 키/비즈니스 키로 중복 방지
- 상태 저장형 처리 시, 처리 이력 테이블/캐시 활용

## 체크리스트

- [ ] 재시도 횟수/지연/최대 지연 정의
- [ ] DLQ 스키마 설계(원본 토픽/오프셋/에러 메시지)
- [ ] 모니터링/알람 연계
