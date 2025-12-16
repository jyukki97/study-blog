---
title: "Redis Streams로 이벤트 스트림 처리하기"
date: 2025-12-16
draft: false
topic: "Messaging"
tags: ["Redis", "Streams", "Consumer Group", "At-least-once", "Idempotency"]
categories: ["Backend Deep Dive"]
description: "Redis Streams 기본 개념부터 Consumer Group/PEL, 멱등 처리와 재처리(복구)까지: 작은 이벤트 파이프라인 설계"
module: "data-system"
study_order: 282
---

## 이 글에서 얻는 것

- Redis Streams가 “Redis로 Kafka 흉내”가 아니라, **작은 이벤트 파이프라인/워크큐**로 어디에 적합한지 판단할 수 있습니다.
- Consumer Group/PEL(Pending Entries List)의 의미를 이해하고, “컨슈머가 죽었을 때” 어떤 메시지가 어떻게 복구되는지 설명할 수 있습니다.
- at-least-once 처리에서 반드시 필요한 멱등성(idempotency)과 재처리 설계를 기본 형태로 구현할 수 있습니다.

## 0) Redis Streams는 언제 쓰면 좋은가

Redis Streams는 보통 아래 같은 상황에서 강점이 있습니다.

- 트래픽/규모가 Kafka까지는 과한데, “이벤트 기반 처리”가 필요하다
- 같은 Redis를 이미 운영 중이고, 운영 복잡도를 크게 늘리고 싶지 않다
- 워크큐(비동기 작업) + 재처리(ack, pending)가 필요하다

반대로, 아래가 중요하면 Kafka 같은 로그 기반 시스템이 더 자연스러울 수 있습니다.

- 장기 보관(리플레이를 오랫동안 해야 함)
- 파티션 기반의 강한 확장/순서 제어
- 생태계(커넥터/스트림 처리/스키마 레지스트리 등)

## 1) 핵심 모델: Append-only 로그 + Consumer Group

Streams는 append-only 로그입니다.

- `XADD`로 스트림에 이벤트를 추가
- `XREAD` 또는 `XREADGROUP`으로 읽기

Consumer Group을 쓰면:

- 여러 컨슈머가 같은 그룹에 속해서 작업을 나눠 처리하고
- 컨슈머가 “처리 완료”를 `XACK`으로 알립니다

## 2) PEL(Pending Entries List): “처리 중” 목록이 핵심이다

Consumer Group은 “읽었지만 아직 ack되지 않은 메시지”를 PEL에 기록합니다.

- 컨슈머가 죽으면, PEL에 남은 메시지는 영원히 ack되지 않습니다
- 그래서 운영에서는 PEL을 주기적으로 관찰하고,
- 일정 시간 이상 처리되지 않은 메시지를 다른 컨슈머가 가져가도록 `XCLAIM`/`XAUTOCLAIM`을 설계합니다

이게 Redis Streams가 “그냥 pub/sub”과 다른 가장 큰 차이입니다.

## 3) 처리 보장: at-least-once → 멱등 처리가 필수

Streams + Consumer Group은 기본적으로 at-least-once입니다.

- 네트워크/컨슈머 장애로 동일 메시지가 다시 전달될 수 있습니다.
- 따라서 “중복 처리되어도 안전”해야 합니다.

대표 멱등 전략(실무에서 자주 쓰는 것):

- 비즈니스 키 기준으로 “처리 완료 마커” 저장(예: `orderId`)
- 마커는 TTL을 두거나, 영속 저장소(DB)에서 유니크 제약으로 강제

## 4) ID 전략: `*`와 비즈니스 키를 구분하라

- Redis Stream ID는 보통 `*`로 생성(타임스탬프 기반)
- 비즈니스 중복 제거는 Stream ID가 아니라 **비즈니스 키(orderId 같은 것)** 로 하는 편이 안전합니다

Stream ID는 전달/재처리 추적에 유용하지만, “중복 처리 방지 키”로 쓰기에는 도메인 의미가 약합니다.

## 5) 백로그/보관: 무한 성장 방지(XTRIM)와 비용

Stream이 무한히 커지면 메모리가 터집니다.
그래서 보통:

- `XTRIM`으로 길이를 제한하거나,
- 특정 보관 정책(최근 N개/최근 T시간)으로 자릅니다.

주의할 점:

- 너무 공격적으로 trim하면 “느린 컨슈머”가 필요한 메시지를 잃을 수 있습니다.
- “재처리 가능 기간”을 정의하고 그 안에서만 보관하는 게 현실적입니다.

## 6) 운영 루틴(최소 세트)

- 처리 지연: consumer group lag(대기 중인 메시지 수), PEL 크기
- 재처리: 오래된 pending(예: 5분 이상)을 주기적으로 claim
- 실패 처리: DLQ(별도 스트림)로 빼거나, 실패 횟수 기준으로 격리

Streams는 “큐를 만들고 끝”이 아니라, **재처리/관측 루프**가 있어야 안정적으로 운영됩니다.

## 연습(추천)

- 주문 이벤트 스트림 `orders`를 만들고 Producer/Consumer를 작성해보기(`XADD`/`XREADGROUP`/`XACK`)
- 컨슈머를 강제로 죽여 PEL에 메시지가 남는 것을 확인한 뒤, `XAUTOCLAIM`으로 재처리 루프를 만들어보기
- `orderId`를 멱등 키로 잡고, 중복 메시지가 들어와도 결과가 한 번만 반영되게 만들어보기
