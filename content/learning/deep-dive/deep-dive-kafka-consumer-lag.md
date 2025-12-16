---
title: "Kafka Consumer Lag 관리와 리밸런스 대응"
date: 2025-12-16
draft: false
topic: "Kafka"
tags: ["Kafka", "Consumer Lag", "Rebalance", "Offset"]
categories: ["Backend Deep Dive"]
description: "Lag 모니터링, 리밸런스 원인, 처리량/중복/손실 사이 트레이드오프 정리"
module: "data-system"
study_order: 260
---

## Lag 원인과 대응

- 처리 속도 < 생산 속도 → 파티션/컨슈머 스케일 아웃, 배치 사이즈/페치 사이즈 튜닝
- 느린 메시지 처리: DLQ/재시도 큐 분리
- 리밸런스 잦음: 세션 타임아웃/하트비트 주기 조정, 스테이트풀 처리 시 Cooperative Rebalance

## 모니터링

- 오프셋 지표: `log_end_offset`, `current_offset`, `lag`
- Lag 알람 기준: 절대값 + 증가율

## 커밋 전략

- 자동 커밋: 단순하지만 중복 가능
- 수동 커밋: 처리 완료 후 커밋, batch commit으로 비용 절감
- 멱등/중복 방지 로직 필수

## 체크리스트

- [ ] 파티션 수 ≥ 컨슈머 수, 핫파티션 여부 확인
- [ ] 처리 실패 시 DLQ/재시도 큐로 분리
- [ ] 리밸런스 설정(session.timeout.ms, max.poll.interval.ms) 점검
- [ ] Lag 알람 설정 및 시각화 대시보드 구축
