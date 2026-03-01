---
title: "Kafka 전달 보장 면접 Q&A (At-most/At-least/Exactly-once)"
study_order: 863
date: 2025-12-28
topic: "Backend"
tags: ["Kafka", "전달보장", "중복처리", "면접"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
description: "Kafka At-most/At-least/Exactly-once 전달 보장과 중복 처리 면접 Q&A"
series_order: 33
draft: false
module: "interview-readiness"
---

## Q1. At-most-once / At-least-once / Exactly-once 차이?

### 답변

- **At-most-once**: 유실 가능, 중복 거의 없음
- **At-least-once**: 유실 방지, 중복 가능
- **Exactly-once**: 이론상 유실/중복 최소화, 설정/운영 복잡도 높음

핵심은 "유실 vs 중복" 중 뭘 더 허용할지입니다.

## Q2. At-least-once에서 중복은 왜 발생하나요?

### 답변

대표 케이스는 "처리 성공 후 offset commit 전 장애"입니다.
재시작 후 같은 메시지를 다시 읽어 중복 처리됩니다.

대응:
- 멱등 키(idempotency key)
- DB unique constraint
- processed_event 테이블

## Q3. 순서 보장은 어디까지 되나요?

### 답변

Kafka 순서는 **파티션 단위**로 보장됩니다.
멀티 파티션 전역 순서는 기본적으로 보장되지 않습니다.

운영 팁:
- 같은 키는 같은 파티션으로 라우팅
- producer 재시도/`max.in.flight.requests.per.connection` 영향 이해

## Q4. 면접에서 실무형으로 어떻게 말하나요?

### 답변

"저희는 At-least-once를 기본으로 두고, 소비자에서 멱등 처리를 적용했습니다. 유실보다 중복을 허용하는 게 안전했고, 중복은 DB unique key + 재처리 방지 테이블로 제어했습니다. 순서는 파티션 단위로 설계하고, 키 전략으로 비즈니스 순서를 맞췄습니다."

## 요약

- 전달 보장은 기술 선택이 아니라 **도메인 리스크 선택**이다.
- 실무 기본은 At-least-once + 멱등 처리 조합이다.

## 다음 글

- [Kafka 파티션 설계 Q&A](/learning/qna/kafka-partition-design-qna/)
- [동시성 제어 Part 2](/learning/qna/concurrency-control-qna-part2/)
