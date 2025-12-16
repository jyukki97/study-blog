---
title: "Redis Streams 심화: Backlog 관리와 재처리 전략"
date: 2025-12-16
draft: false
topic: "Redis"
tags: ["Redis", "Streams", "Consumer Group", "Backlog", "XCLAIM"]
categories: ["Backend Deep Dive"]
description: "Pending 리스트 관리, 장애 시 재처리, 대량 backlog를 제어하는 Streams 운영 패턴"
module: "data-system"
study_order: 285
---

## Backlog 관리

- PEL(Processing Entries List) 감시: `XPENDING`로 idle 시간/크기 모니터링
- 대량 백로그는 `MAXLEN ~`/`XTRIM`으로 길이 제한, 단 TTL 영향 고려

## 재처리 전략

- 재시도 기준: idle 시간이 임계 초과 시 `XCLAIM`으로 다른 컨슈머가 가져감
- 멱등 처리 필수: 이벤트 ID/비즈니스 키 기반 중복 방지

```bash
XPENDING mystream group1 - + 10
XCLAIM mystream group1 consumerB 60000 1670000000000-0
```

## 운영 체크리스트

- [ ] 소비/발행 속도 모니터링, 백로그 증가 알람
- [ ] 메시지 TTL/트림 정책과 재처리 가능성 균형
- [ ] DLQ나 재시도 횟수 상한 설계
- [ ] 장애 복구 후 재처리 순서/중복 검증
