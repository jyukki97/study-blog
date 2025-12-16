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

## 이 글에서 얻는 것

- Redis Streams의 Consumer Group 모델과 PEL(Pending Entries List)이 무엇인지 이해하고, “왜 backlog가 쌓이는지” 설명할 수 있습니다.
- 장애/크래시 상황에서 pending 메시지를 재처리하는 방법(XPENDING/XCLAIM/XAUTOCLAIM)을 운영 패턴으로 정리할 수 있습니다.
- 트림(MAXLEN/XTRIM), 재처리 가능성, 멱등 처리, DLQ 설계를 함께 고려해 “운영 가능한 스트림”을 만들 수 있습니다.

## 0) Redis Streams를 한 문장으로

Redis Streams는 Redis 안에서 “로그처럼 append되는 메시지 스트림”을 제공하고,
Consumer Group으로 “협업 소비 + pending 관리”를 제공합니다.

Kafka와 비슷한 용어가 나오지만, 운영 모델/내구성/관측 포인트는 다를 수 있으니
Streams의 기본 구조(PEL)를 먼저 이해하는 게 중요합니다.

## 1) Consumer Group과 PEL(Backlog)의 의미

Consumer Group에서 소비는 보통 `XREADGROUP`으로 합니다.

- 컨슈머가 메시지를 읽으면 “그 메시지는 처리 중” 상태가 되고,
- 그룹의 PEL(Pending Entries List)에 등록됩니다.
- 처리가 끝나면 `XACK`로 ack해서 pending에서 제거합니다.

즉, backlog(pending)가 늘어난다는 건 보통:

- 처리가 느리거나,
- 컨슈머가 죽었거나,
- `XACK`를 못 하고 있거나(버그/예외)  

중 하나입니다.

## 2) 모니터링의 출발점: XPENDING

pending을 보기 위한 기본 도구는 `XPENDING`입니다.

```bash
XPENDING mystream group1 - + 10
```

여기서 특히 중요한 관점은:

- pending 개수(쌓이고 있는가)
- idle time(얼마나 오래 처리되지 않았나)
- 특정 consumer에 pending이 몰리는지(핫 컨슈머/장애)

추가로 `XINFO GROUPS/CONSUMERS`도 함께 보면 그룹/컨슈머 상태를 더 쉽게 파악할 수 있습니다.

## 3) 재처리 전략: XCLAIM / XAUTOCLAIM

컨슈머가 읽었지만 ack하지 못한 메시지는 pending에 남습니다.
이 메시지를 다른 컨슈머가 가져가 처리하려면 “claim”이 필요합니다.

### 3-1) XCLAIM(명시적 클레임)

```bash
XCLAIM mystream group1 consumerB 60000 1670000000000-0
```

- `60000`은 최소 idle time(ms)입니다.
- “오랫동안 처리되지 않은 메시지”를 다른 컨슈머로 이관합니다.

### 3-2) XAUTOCLAIM(자동 클레임)

Redis 버전에 따라 `XAUTOCLAIM`으로 “idle이 긴 pending을 자동으로 가져오는” 루프를 만들 수 있습니다.
운영에서는 주기적으로 XAUTOCLAIM을 돌려 “죽은 컨슈머가 남긴 pending”을 회수하는 패턴이 흔합니다.

## 4) 멱등 처리는 필수: 재처리는 곧 중복이다

pending 재처리를 하면, 같은 이벤트가 두 번 처리될 수 있습니다.
따라서 처리 로직은 멱등해야 합니다.

- 이벤트 ID 기반 처리 이력 테이블/키
- upsert/유니크 키로 중복 반영 방지

## 5) 트림(MAXLEN/XTRIM): 메모리 관리 vs 재처리 가능성

Streams는 무한히 쌓이므로 길이 제한이 필요할 수 있습니다.

- `MAXLEN ~`(대략적 트림) / `XTRIM`으로 길이를 제한할 수 있습니다.

하지만 주의:

- 너무 공격적으로 트림하면, pending 재처리 시점에 원본 엔트리가 사라져 재처리가 어려워질 수 있습니다.
- 따라서 트림/보관 정책은 “최대 재처리 지연”과 함께 설계해야 합니다.

실무에서는:

- 충분히 큰 보관 창(예: 몇 시간~며칠)을 두고,
- pending이 비정상적으로 늘면 알람/조치로 해결  

하는 편이 운영이 단순합니다.

## 6) DLQ(죽은 메시지) 설계

Streams 자체에 “DLQ”가 내장된 형태는 아니기 때문에,
독 메시지(poison message)는 별도 스트림/리스트/토픽으로 옮기는 설계를 합니다.

권장:

- 재시도 횟수 상한
- 실패 사유/원본 ID/타임스탬프를 함께 기록
- DLQ 모니터링 + 재처리 도구/프로세스

## 7) 자주 하는 실수

- `XACK`를 빼먹어서 pending이 무한히 증가
- 컨슈머가 죽었는데 pending 회수(XCLAIM)가 없어 메시지가 영원히 처리되지 않음
- 트림을 너무 공격적으로 해서 재처리 창이 깨짐
- 멱등 처리가 없어 재처리/중복으로 데이터가 오염

## 연습(추천)

- 컨슈머 2개로 그룹을 구성하고, 하나를 강제 종료한 뒤 pending이 어떻게 남는지 XPENDING으로 확인해보기
- XCLAIM 또는 XAUTOCLAIM으로 pending을 회수해 “다른 컨슈머가 재처리”하는 흐름을 만들어보기
- 독 메시지를 DLQ 스트림으로 보내고, 재시도 상한/알람 기준을 정의해보기
