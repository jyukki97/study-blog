---
title: "Redis Streams로 이벤트 스트림 처리하기"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Redis", "Streams", "Consumer Group", "백엔드", "이벤트"]
categories: ["Backend Deep Dive"]
description: "Redis Streams 핵심 개념, Consumer Group 설계, 장애 복구 전략 정리"
module: "data-system"
---

## Streams 핵심 개념

- Append-only 로그: `XADD`로 시간순 이벤트 저장
- Consumer Group: 여러 컨슈머가 Partition 없이 협업 (Pending List로 재처리)
- 메시지 인식 확인: `XACK`로 처리 완료 표시, 미확인 메시지는 재전달 가능

## 설계 포인트

- **ID 전략**: 서버에서 `*` 사용 시 Redis 타임스탬프 사용, 애플리케이션 생성 ID는 중복/정렬 주의
- **처리 보장**: 최소 1회(at-least-once) → 멱등 처리 필수 (키 기반 중복 체크)
- **백로그 관리**: `XTRIM ~ MAXLEN`으로 무한 성장 방지, 단 TTL과 지연 읽기 영향 주의
- **오프셋 관리**: Pending Entries List(PEL)로 미완료 메시지 확인, `XCLAIM`으로 다른 컨슈머가 가져와 복구

## 실습 시나리오

- [ ] 주문 이벤트 스트림 `orders` 생성 후 Producer/Consumer 작성
- [ ] Consumer Group 2개 구성, Consumer 장애 시 `XCLAIM`으로 재처리
- [ ] `XTRIM`과 `MAXLEN ~` 적용 전/후 지연 차이 측정
- [ ] 멱등 키(`orderId`) 기반 중복 방지 로직 추가

## 참고

- Redis 공식 문서: Streams intro, XADD/XREADGROUP/XACK/XCLAIM
- 설계 비교: Kafka가 필요 없는 소규모 이벤트 처리/워크큐에 Streams 활용
