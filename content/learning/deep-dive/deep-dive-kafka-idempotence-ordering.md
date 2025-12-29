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
quizzes:
  - question: "Kafka Producer 멱등성(idempotent producer)이 해결하는 문제는?"
    options:
      - "Consumer 중복 처리"
      - "네트워크 오류/재시도 시 같은 레코드가 브로커에 중복 기록되는 것을 방지"
      - "정렬 보장"
      - "모든 중복 문제 해결"
    answer: 1
    explanation: "Producer가 ACK를 못 받아 재시도하면 같은 메시지가 두 번 저장될 수 있습니다. 멱등 설정으로 이를 방지하지만, Consumer 측 중복은 별도 처리가 필요합니다."

  - question: "Kafka에서 메시지 순서(Ordering)가 보장되는 범위는?"
    options:
      - "토픽 전체"
      - "같은 파티션 내의 레코드만 순서 보장"
      - "모든 Consumer 그룹"
      - "클러스터 전체"
    answer: 1
    explanation: "같은 orderId를 키로 사용하면 같은 파티션에 들어가 순서가 유지됩니다. 다른 파티션 간의 순서는 보장되지 않습니다."

  - question: "Consumer 멱등성을 구현하는 대표적인 패턴은?"
    options:
      - "Producer 설정만 하면 된다."
      - "처리 이력 테이블에 eventId를 unique로 저장하고, 이미 있으면 스킵"
      - "메시지를 삭제한다."
      - "더 빠른 네트워크를 사용한다."
    answer: 1
    explanation: "같은 이벤트가 두 번 와도 DB에 중복 저장되지 않도록 eventId나 비즈니스 키로 중복 체크를 해야 합니다."

  - question: "Kafka의 Exactly-once 처리가 현실적으로 어려운 이유는?"
    options:
      - "Kafka가 지원하지 않아서"
      - "Transactional Producer, Consumer offset 커밋 트랜잭션 포함, isolation.level 설정 등 조건이 많고 운영 복잡도가 높기 때문"
      - "비용이 비싸서"
      - "속도가 느려서"
    answer: 1
    explanation: "End-to-end Exactly-once는 가능하지만 설정과 운영이 복잡합니다. 많은 서비스가 '멱등 처리 + At-least-once'를 선택합니다."

  - question: "Kafka 메시지에 eventId 필드를 포함해야 하는 이유는?"
    options:
      - "로깅을 위해"
      - "Consumer에서 중복 처리 여부를 판단하기 위한 고유 식별자로 사용하기 위해"
      - "압축을 위해"
      - "필요 없다"
    answer: 1
    explanation: "eventId가 없으면 같은 메시지가 두 번 왔는지 판단할 수 없습니다. 처리 이력 테이블에 eventId를 저장하여 중복을 방지합니다."
---

## 이 글에서 얻는 것

- “멱등(idempotent)”이 producer에만 적용되는지, consumer 처리에도 필요한지 구분할 수 있습니다.
- Kafka에서 정렬(ordering)이 어디까지 보장되는지(파티션 단위)와 키 설계가 왜 중요한지 이해합니다.
- Exactly-once라는 말을 “마케팅 용어”가 아니라, 어떤 조건에서 어떤 범위로 가능한지 현실적으로 정리할 수 있습니다.

## 0) 전제: Kafka에서 중복/재처리는 정상이다

Kafka 소비는 보통 at-least-once(중복 가능)로 운영합니다.

- 컨슈머 재시작/리밸런스
- 처리 후 커밋(정상적인 전략)
- 재시도 토픽

이 조합이 있으면 “같은 이벤트가 두 번 처리되는 상황”은 자연스럽게 발생합니다.
따라서 시스템 설계의 핵심은 “중복이 와도 안전한 처리”입니다.

## 1) Producer 멱등성: “브로커에 중복 저장”을 줄인다

Kafka의 idempotent producer는 네트워크 오류/재시도 상황에서
같은 레코드가 브로커에 중복으로 기록되는 것을 줄입니다(파티션 단위).

핵심 설정(개념):

- `enable.idempotence=true`
- `acks=all`
- `retries` 충분히(재시도 허용)
- `max.in.flight.requests.per.connection`은 환경에 따라 제한(재시도 시 정렬 보장과 관련)

중요: producer 멱등성은 “produce 중복”을 줄여줄 뿐,
컨슈머 측 중복(커밋/재시작)까지 자동으로 없애주지는 않습니다.

## 2) 정렬 보장: “파티션 내부”에서만

Kafka의 정렬은 이 한 문장으로 정리됩니다.

> 같은 파티션에 들어간 레코드는 순서가 유지된다.

그래서 정렬이 필요한 도메인에서는 키 설계가 핵심입니다.

예:

- 주문 상태 이벤트를 `orderId`로 키잉하면, 같은 주문의 이벤트는 같은 파티션에 들어가 순서가 유지됩니다.

반대로:

- 키를 안 넣거나(null key),
- 파티션이 여러 개로 흩어지면,

토픽 전체 순서는 보장되지 않습니다.

## 3) Consumer 멱등성: “비즈니스 결과 중복”을 막는다

현업에서 진짜 중요한 건 consumer 멱등입니다.

대표 패턴:

- **처리 이력 테이블**: `processed_event(event_id)`를 unique로 저장하고, 이미 있으면 스킵
- **업서트/유니크 키**: 결과 테이블에 유니크 제약을 두고 중복 삽입을 실패로 처리
- **외부 API**: 가능한 경우 idempotency key를 사용(결제/발송 등)

핵심은 “이벤트 ID” 또는 “비즈니스 키”가 있어야 한다는 점입니다.
없다면 이벤트 스키마에 `eventId`를 넣는 것부터 시작하는 게 좋습니다.

## 4) Exactly-once: 무엇을 의미하는가(현실 버전)

Exactly-once는 범위를 분리해서 이해해야 합니다.

### 4-1) Producer → Broker 레벨

idempotent producer/transactional producer로 “브로커에 중복 기록”을 줄이거나 없앨 수 있습니다.

### 4-2) End-to-end(Consume → Process → Produce)

진짜 end-to-end exactly-once는 조건이 많습니다.

- transactional producer
- consumer offset 커밋을 트랜잭션에 포함(consume-transform-produce)
- consumer는 `isolation.level=read_committed`로 커밋된 트랜잭션만 읽기

Kafka Streams는 이 흐름을 비교적 쉽게 제공합니다.
하지만 일반적인 서비스에서는 “멱등 처리 + at-least-once”가 운영 난이도 대비 가장 현실적인 선택인 경우가 많습니다.

## 5) 자주 하는 실수

- producer 멱등을 켜면 “중복 처리가 끝났다”라고 생각(consumer 중복은 여전히 발생)
- 키 설계 없이 파티션만 늘려서 “정렬이 깨지는” 사고
- 처리 이력 없이 재시도/DLQ를 운영해서 데이터가 중복 반영
- “exactly-once”를 목표로 했는데 운영 복잡도가 커져 오히려 장애가 늘어남

## 연습(추천)

- 주문 이벤트에 `eventId`를 추가하고, 처리 이력 테이블로 중복 소비를 막는 예제를 만들어보기
- 동일 `orderId` 키로 메시지를 보내고, 파티션 내부 순서가 유지되는지 확인해보기
- producer 재시도 상황(네트워크 오류를 가정)에서 idempotence가 어떤 효과를 주는지 로그로 관찰해보기
