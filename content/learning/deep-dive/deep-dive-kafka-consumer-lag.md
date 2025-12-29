---
title: "Kafka Consumer Lag 관리와 리밸런스 대응"
date: 2025-12-16
draft: false
topic: "Kafka"
tags: ["Kafka", "Consumer Lag", "Rebalance", "Offset"]
categories: ["Backend Deep Dive"]
description: "Lag 모니터링, 리밸런스 원인, 처리량/중복/손실 사이 트레이드오프 정리"
module: "data-system"
quizzes:
  - question: "Kafka Consumer Lag의 정의로 올바른 것은?"
    options:
      - "Producer가 메시지를 보내는 데 걸린 시간"
      - "브로커의 최신 오프셋(log_end_offset)과 Consumer가 커밋한 오프셋(committed_offset)의 차이"
      - "Consumer가 메시지를 처리하는 데 걸린 시간"
      - "리밸런싱에 소요된 시간"
    answer: 1
    explanation: "Lag은 '브로커에 쌓인 메시지 중 아직 처리/커밋되지 않은 양'을 의미합니다. Lag이 커지면 Consumer가 Producer를 따라가지 못하고 있다는 신호입니다."

  - question: "Lag이 증가하는 원인 중 '하나의 메시지 처리가 너무 오래 걸려 파티션 전체가 막히는 현상'의 해결책으로 가장 적절한 것은?"
    options:
      - "파티션 수를 늘린다."
      - "Consumer 수를 늘린다."
      - "처리 실패/지연 메시지를 Retry 토픽 또는 DLQ(Dead Letter Queue)로 분리한다."
      - "max.poll.interval.ms 값을 크게 늘린다."
    answer: 2
    explanation: "특정 '독(poison) 메시지'가 전체를 막는 경우, 스케일 아웃으로는 해결되지 않습니다. 문제 메시지를 분리하여 다른 정상 메시지들이 처리될 수 있도록 해야 합니다."

  - question: "Kafka Consumer의 `max.poll.interval.ms` 설정값을 초과하면 어떤 일이 발생하는가?"
    options:
      - "해당 Consumer에게 더 많은 파티션이 할당된다."
      - "해당 Consumer가 그룹에서 제외되고 리밸런싱이 발생한다."
      - "메시지가 자동으로 DLQ로 전송된다."
      - "Producer가 전송을 중단한다."
    answer: 1
    explanation: "`poll()` 호출 간격이 `max.poll.interval.ms`보다 길면, 그룹 코디네이터는 해당 Consumer가 멈췄다고 판단하여 파티션을 다른 Consumer에게 재할당(리밸런싱)합니다."

  - question: "Kafka에서 '리밸런싱(Rebalancing)' 충격을 줄이기 위한 방법으로 적절한 것은?"
    options:
      - "auto.commit.interval.ms 값을 0으로 설정한다."
      - "session.timeout.ms 값을 가능한 짧게 설정한다."
      - "Cooperative Rebalancing(점진적 리밸런싱) 전략을 사용한다."
      - "enable.auto.commit을 true로 설정한다."
    answer: 2
    explanation: "Cooperative Rebalancing은 기존의 Eager Rebalancing과 달리, 파티션 할당을 점진적으로 변경하여 리밸런싱 중에도 일부 Consumer가 계속 처리할 수 있게 해줍니다."

  - question: "Kafka Consumer의 커밋 전략에서 '처리 완료 후 수동 커밋'을 사용할 때, 동일 메시지가 중복 처리될 수 있는 상황은?"
    options:
      - "커밋을 먼저 하고 처리를 나중에 할 때"
      - "처리는 완료했지만 커밋 전에 Consumer가 비정상 종료되었을 때(재시작 시 마지막 커밋 오프셋부터 다시 읽음)"
      - "auto.commit이 활성화되어 있을 때"
      - "Producer가 acks=all로 설정되어 있을 때"
    answer: 1
    explanation: "수동 커밋 시 처리 완료 후 커밋 전에 장애가 발생하면, 재시작 시 마지막 커밋 지점부터 다시 읽어 중복 처리가 발생할 수 있습니다. 이를 대비해 '멱등(idempotent) 처리' 로직이 필요합니다."
study_order: 260
---

## 이 글에서 얻는 것

- Consumer Lag이 무엇인지(어떤 오프셋의 차이인지) 정확히 정의하고, 원인을 분류할 수 있습니다.
- lag이 늘 때 “스케일 아웃이 정답인지, 처리 최적화가 정답인지, 실패 메시지 분리가 정답인지” 판단 기준이 생깁니다.
- 리밸런스가 왜 발생하는지(session timeout, max.poll.interval)와 운영에서 줄이는 방법을 이해합니다.
- 커밋 전략이 중복/유실/지연에 미치는 영향을 감각적으로 연결할 수 있습니다.

## 0) Lag의 정의부터 정확히

파티션 기준으로 lag은 보통:

- `log_end_offset`(브로커에 쌓인 최신 오프셋)  
  vs  
- `committed_offset`(컨슈머 그룹이 “여기까지 처리했다”고 커밋한 오프셋)  

의 차이로 봅니다.

즉, lag이 커진다는 건 “브로커에는 쌓이는데, 우리는 처리/커밋이 따라가지 못한다”는 뜻입니다.

## 1) lag이 늘어나는 대표 원인 5가지

### 1-1) 생산 속도 > 소비 처리량

가장 단순한 케이스입니다.

- 파티션 수가 부족하면 컨슈머를 늘려도 효과가 없습니다(파티션당 1 컨슈머).
- 파티션을 늘리면 병렬성이 올라가지만, 키/정렬 요구와 충돌할 수 있습니다.

### 1-2) 특정 메시지가 너무 느리다(“독” 메시지)

한 메시지가 5초씩 걸리면 해당 파티션 전체가 막힙니다.

대응:

- 실패/지연 메시지는 retry 토픽/DLQ로 분리
- “느린 외부 API 호출”을 분리(벌크헤드/타임아웃/재시도)

### 1-3) 컨슈머가 `poll()`을 제때 못 한다

컨슈머는 일정 주기로 `poll()`을 호출해야 하트비트를 보내고 그룹에서 살아남습니다.
처리가 너무 오래 걸려 `max.poll.interval.ms`를 넘으면 리밸런스가 발생할 수 있습니다.

### 1-4) 리밸런스가 잦다

리밸런스는 파티션 할당이 바뀌는 동안 처리가 멈추거나 지연이 튈 수 있습니다.

원인:

- 컨슈머의 잦은 재시작/스케일링
- 네트워크 이슈로 세션 타임아웃
- `max.poll.interval.ms` 초과

### 1-5) 커밋/DB 병목

처리는 끝났는데 커밋/DB 업데이트가 병목이면 lag이 “커밋 기준”으로 계속 남을 수 있습니다.

## 2) 대응 전략: 무엇부터 해야 하나

### 2-1) 먼저 “독 메시지/실패”를 분리

한 파티션을 막는 메시지가 있으면 스케일 아웃으로도 해결이 안 됩니다.
retry/DLQ로 분리하는 것이 1순위인 경우가 많습니다.

### 2-2) 처리 최적화(배치/병렬/IO 줄이기)

- DB writes는 batch upsert로 줄일 수 있는지
- 외부 호출은 타임아웃/재시도/서킷브레이커로 고립하는지
- 한 메시지 처리에 불필요한 N+1/조회가 없는지

### 2-3) 스케일 아웃(파티션/컨슈머)

처리량이 충분히 최적화됐는데도 생산량이 더 많다면, 파티션/컨슈머 확장이 필요합니다.
단, 키 기반 정렬 요구가 있으면 “핫 키”가 병목이 될 수 있으니 키 설계를 함께 봐야 합니다.

## 3) 리밸런스 이해하기: session timeout vs max poll interval

### session.timeout.ms / heartbeat.interval.ms

브로커(그룹 코디네이터)는 하트비트를 못 받으면 컨슈머를 죽었다고 판단하고 리밸런스를 합니다.

### max.poll.interval.ms

`poll()` 호출 간격이 너무 길면 “처리가 멈춘 컨슈머”로 판단하고 리밸런스를 합니다.

실무 감각:

- “처리가 오래 걸리는 로직”이면 `max.poll.interval.ms` 조정이 필요할 수 있지만,
- 근본적으로는 “한 레코드 처리 시간을 줄이거나, 느린 레코드를 분리”하는 게 더 안전합니다.

추가로:

- Cooperative rebalancing(점진적 리밸런스)을 사용하면 리밸런스 충격을 줄일 수 있습니다(환경/클라이언트 지원 여부 확인).

## 4) 커밋 전략: 지연/중복/유실을 결정한다

- 자동 커밋: 단순하지만 “처리 전 커밋”이 섞일 수 있어 중복/유실을 통제하기 어렵습니다.
- 수동 커밋: 처리 완료 후 커밋(보통 기본). 다만 중복은 생길 수 있으니 멱등 처리가 필요합니다.

운영에서 흔한 선택:

- 처리 후 커밋 + 멱등 처리  
- 커밋은 레코드마다가 아니라 “배치 단위”로 하여 비용을 줄이기(너무 커지면 재처리 범위가 커짐)

## 5) 모니터링: 어떤 지표를 봐야 하나

최소:

- partition별 `lag`(절대값 + 증가율)
- `records-consumed-rate` / `records-lag-max`
- 리밸런스 횟수/시간
- 처리 시간 분포(p95/p99), 실패율(DLQ 유입)

알람은 보통:

- lag 절대값이 일정 기준을 넘거나,
- lag 증가율이 일정 시간 이상 지속될 때  

두 조건을 함께 봐야 노이즈가 줄어듭니다.

## 연습(추천)

- 일부러 처리 시간을 늘려 `max.poll.interval.ms` 초과로 리밸런스를 재현해보기
- 실패 메시지를 retry 토픽으로 분리했을 때 lag/지연이 어떻게 개선되는지 비교해보기
- 파티션 수/컨슈머 수를 바꿔가며 lag이 어디서부터 줄어들지(또는 안 줄어들지) 관찰해보기
