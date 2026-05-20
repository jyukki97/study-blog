---
title: "백엔드 커리큘럼 심화: Transactional Inbox 패턴, 중복 소비와 재처리 비용을 줄이는 실전 기준"
date: 2026-04-21
draft: false
topic: "Backend Architecture"
tags: ["Transactional Inbox", "Idempotent Consumer", "Kafka", "Deduplication", "Reliability"]
categories: ["Backend Deep Dive"]
description: "메시지 중복 소비와 재처리 상황에서 Transactional Inbox 패턴을 어떻게 적용하고, 언제 단순 멱등 처리로 충분한지 실무 기준으로 정리합니다."
module: "backend-reliability"
study_order: 411
---

이벤트 기반 시스템을 운영하다 보면 결국 같은 질문으로 돌아옵니다. "producer 쪽에서 outbox를 넣었는데 왜 consumer 쪽에서 또 사고가 나지?" 이유는 간단합니다. **Outbox는 발행의 일관성을 보장하고, Inbox는 소비의 일관성을 줄이는 장치**이기 때문입니다. 브로커가 at-least-once 전달을 하는 순간, 장애 복구나 재처리 과정에서 중복 소비는 정상 동작의 일부가 됩니다. 문제는 많은 팀이 이 사실을 알면서도 consumer 쪽 중복 효과를 로직 곳곳에서 임시 if문으로 막다가, 결국 환불 중복, 포인트 두 번 적립, 상태 전이 꼬임 같은 비용을 치른다는 점입니다.

Transactional Inbox 패턴은 이 문제를 정면으로 다룹니다. 핵심은 메시지를 받자마자 비즈니스 로직부터 실행하는 것이 아니라, **메시지의 처리 이력과 비즈니스 효과를 같은 트랜잭션 경계 안에서 묶는 것**입니다. 이 구조를 잡아 두면 장애가 나도 "이미 처리한 메시지인지", "처리 중이던 메시지인지", "재시도해도 되는 메시지인지"를 판단하기 쉬워집니다. 이 글에서는 [트랜잭션 아웃박스 + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [Kafka Retry/DLQ 패턴](/learning/deep-dive/deep-dive-kafka-retry-dlq/)과 연결해서, consumer 쪽 일관성을 운영 기준으로 정리해 보겠습니다.

## 이 글에서 얻는 것

- Transactional Inbox가 단순 dedupe 테이블과 어떻게 다른지 설명할 수 있습니다.
- 언제는 단순 멱등 키 저장으로 충분하고, 언제는 별도 inbox 상태 머신이 필요한지 구분할 수 있습니다.
- 중복 소비, 순서 뒤집힘, 재처리, DLQ 복구까지 포함한 실무 의사결정 기준을 숫자 중심으로 잡을 수 있습니다.
- inbox 테이블 스키마, 트랜잭션 경계, 보존 기간, 운영 지표를 한 번에 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) Outbox가 있어도 consumer 중복 효과는 사라지지 않는다

Outbox를 넣으면 producer 입장에서는 "DB 커밋은 됐는데 이벤트는 유실됨" 같은 이중 쓰기 문제가 크게 줄어듭니다. 하지만 broker와 consumer 사이에는 여전히 아래 상황이 남습니다.

- consumer가 처리 완료 직후 offset commit 전에 죽음
- broker 재전송으로 같은 메시지가 다시 도착함
- 운영자가 DLQ 메시지를 수동 재적재함
- 배치 재생성 또는 replay 작업으로 과거 이벤트를 다시 흘림

이때 consumer 로직이 "주문 적립금 지급", "결제 상태 변경", "외부 시스템 전송" 같은 side effect를 만들면, 단순히 "같은 이벤트가 한 번 더 왔다"가 아니라 **같은 업무 효과가 한 번 더 발생**할 수 있습니다. 그래서 consumer 쪽에는 "전달 보장"보다 "효과 보장" 관점이 필요합니다.

여기서 핵심 질문은 하나입니다.

> 이 메시지가 다시 와도 같은 결과로 닫히는가?

닫히지 않는다면 inbox 계층을 별도로 두는 편이 맞습니다. 특히 금전, 재고, 상태 전이, 외부 API 호출처럼 복구 비용이 큰 영역은 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)를 로직 단위로 흩뿌리기보다 inbox에서 한 번 묶는 편이 운영이 훨씬 단순해집니다.

### 2) Transactional Inbox는 "읽음 표시"가 아니라 처리 상태 계약이다

가장 흔한 오해는 inbox를 `message_id` 한 줄 저장하는 dedupe 테이블 정도로 보는 것입니다. 하지만 실무에서는 그 정도로는 부족한 경우가 많습니다. 이유는 장애 시점에 따라 상태가 세 갈래로 나뉘기 때문입니다.

- 아직 처리 전
- 처리 중이었으나 완료 불명확
- 처리 완료

그래서 inbox는 보통 아래 정보를 가집니다.

- `message_id` 또는 `(producer_id, sequence_no)`
- `aggregate_key` 또는 `business_key`
- `status` (`RECEIVED`, `PROCESSING`, `DONE`, `FAILED`, `DEAD`)
- `processed_at`
- `payload_hash`
- `error_code`, `retry_count`
- 필요하면 `result_snapshot` 또는 `effect_ref`

즉 inbox는 단순 중복 체크 저장소가 아니라 **처리 상태 계약서**입니다. 이 구조가 있어야 운영자는 "같은 메시지라서 무시했는지", "실패해서 재시도 대기인지", "이미 효과가 반영됐는지"를 로그가 아니라 데이터로 확인할 수 있습니다.

실무 기준으로는 아래 구분이 유용합니다.

- **단순 멱등 저장이면 충분한 경우**: 조회성 집계, 캐시 갱신, 이미 upsert로 닫히는 작업
- **상태 머신형 inbox가 필요한 경우**: 금전 반영, 상태 전이, 외부 시스템 호출, 사람 승인 큐 적재

후자라면 `DONE/FAILED/DEAD`를 명시하지 않으면 복구 시 판단이 매우 어려워집니다.

### 3) 트랜잭션 경계는 "inbox 기록"과 "비즈니스 효과"를 같이 묶어야 한다

Transactional Inbox의 핵심은 이름 그대로 **같은 데이터 저장소 트랜잭션 안에서 inbox 업데이트와 도메인 변경을 같이 커밋**하는 것입니다. 순서를 잘못 잡으면 dedupe는 됐는데 효과가 빠지거나, 효과는 반영됐는데 inbox는 미기록인 상태가 생깁니다.

권장 흐름은 아래와 같습니다.

1. `message_id` 기준으로 inbox row 조회 또는 생성
2. 이미 `DONE`면 즉시 skip
3. `PROCESSING` 또는 lease 만료 상태면 재진입 규칙 확인
4. 비즈니스 로직 수행
5. 도메인 변경과 inbox `DONE` 업데이트를 **같은 트랜잭션**으로 커밋
6. 커밋 후 offset ack/commit

이 순서가 중요한 이유는 ack를 먼저 하면 재처리 근거가 사라지고, 비즈니스 변경만 먼저 커밋하면 중복 방지 근거가 늦어지기 때문입니다.

숫자 기준도 필요합니다.

- 메시지 처리 시간이 보통 200ms 이내면 `PROCESSING` lease는 **3~5배 수준**, 예를 들어 1초 전후로 시작
- 재시도 횟수는 일반 비즈니스 consumer 기준 **3~5회**에서 닫고, 그 이상은 DLQ 또는 운영 검토로 승격
- 같은 `message_id` 재도착 비율이 **0.5% 이상**이면 장애 복구나 commit 지연 구조를 의심
- `PROCESSING` 상태 체류가 p95 기준 **평시의 2배 이상** 늘면 consumer hang 또는 downstream 지연을 먼저 확인

이 기준이 있어야 inbox가 단순 저장이 아니라 운영 판단 도구가 됩니다.

### 4) 순서 보장은 inbox가 해결하지 않는다, 대신 피해를 줄인다

중복과 순서는 비슷해 보여도 다른 문제입니다. Transactional Inbox는 중복 효과 방지에는 강하지만, 메시지가 뒤집혀 도착했을 때 업무 의미까지 자동 보정해 주지는 않습니다. 예를 들어 `ORDER_CONFIRMED` 뒤에 `ORDER_CREATED`가 늦게 도착하면, 둘 다 중복이 아니므로 inbox만으로는 막기 어렵습니다.

그래서 순서 민감한 도메인은 추가 기준이 필요합니다.

- aggregate별 monotonic version 저장
- `event_time`보다 `version` 또는 `sequence_no` 우선 사용
- 늦게 온 이벤트는 drop, merge, 보류 중 어떤 정책인지 명확히 문서화

실무에서는 아래 우선순위가 무난합니다.

1. 같은 aggregate에서 버전 비교 가능하면 버전 우선
2. 버전이 없으면 상태 전이 허용표(state transition matrix) 사용
3. 둘 다 없으면 inbox만으로 안전하지 않으므로 producer 계약 수정 우선

즉 inbox는 **중복 방지층**이지 **순서 복구 엔진**은 아닙니다. 순서를 다뤄야 하면 [이벤트 스키마 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)이나 [Kafka 멱등성·순서 보장 설계](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)까지 같이 봐야 합니다.

### 5) retention과 재처리 창을 안 정하면 inbox 테이블이 새 병목이 된다

inbox는 시간이 지나면 계속 커집니다. 그래서 보존 기간을 "일단 오래"로 잡는 팀이 많지만, 이 방식은 테이블 크기와 인덱스 비용을 빠르게 키웁니다. 반대로 너무 짧게 잡으면 늦은 재전송이나 수동 replay를 dedupe하지 못합니다.

보통 아래 기준이 실용적입니다.

- 일반 주문/결제성 이벤트: **7~30일** 보존
- 정산/감사 중요 이벤트: **30~90일** 보존 후 아카이브
- 대규모 replay 가능성이 있는 도메인: replay window와 동일하거나 더 길게

의사결정 기준은 "메시지가 얼마나 늦게 다시 올 수 있는가"와 "중복 효과 비용이 얼마나 큰가"입니다. 예를 들어 운영자가 최대 14일치 DLQ를 다시 흘릴 수 있다면, inbox dedupe window를 3일로 두는 건 거의 무의미합니다.

또한 inbox 테이블은 아래 조건이면 샤딩 또는 파티셔닝을 검토할 만합니다.

- 일일 insert가 **1천만 건 이상**
- `message_id` 조회 p95가 **20ms 이상**으로 상승
- purge 작업이 write latency를 눈에 띄게 흔듦

이 시점부터는 도메인별 inbox 분리, 날짜 파티션, TTL 아카이브 전략을 함께 봐야 합니다.

## 실무 적용

### 1) 가장 안전한 도입 순서

처음부터 모든 consumer에 inbox를 붙이기보다, **중복 효과 비용이 큰 상위 10~20% consumer부터** 시작하는 편이 낫습니다.

1. 금전 반영, 상태 전이, 외부 API 호출 consumer 식별
2. 현재 중복 사고 사례를 `중복 반영`, `순서 꼬임`, `재처리 불명확`으로 분류
3. inbox 스키마 도입 후 `DONE` skip만 먼저 적용
4. 이후 `FAILED`, `DEAD`, `retry_count`를 추가해 운영 흐름 확장

이 순서가 좋은 이유는 초기에 상태 머신을 너무 크게 설계하면 복잡도만 늘고, 반대로 dedupe만 넣으면 운영 가시성이 부족하기 때문입니다.

### 2) 최소 스키마 예시

```sql
CREATE TABLE consumer_inbox (
  message_id        VARCHAR(120) PRIMARY KEY,
  consumer_name     VARCHAR(80)  NOT NULL,
  business_key      VARCHAR(120) NOT NULL,
  status            VARCHAR(20)  NOT NULL,
  payload_hash      VARCHAR(128) NOT NULL,
  retry_count       INT          NOT NULL DEFAULT 0,
  processed_at      TIMESTAMP NULL,
  lease_until       TIMESTAMP NULL,
  error_code        VARCHAR(80) NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consumer_inbox_business_key ON consumer_inbox (consumer_name, business_key);
CREATE INDEX idx_consumer_inbox_status_updated ON consumer_inbox (status, updated_at);
```

여기서 중요한 것은 `message_id`만이 아닙니다. `business_key`를 남겨야 운영자가 "같은 주문에 어떤 이벤트가 몇 번 들어왔는지"를 묶어서 볼 수 있습니다. `payload_hash`를 두면 같은 ID인데 payload가 달라진 이상 케이스도 탐지할 수 있습니다.

### 3) 운영 지표와 알람 기준

최소 아래 지표는 대시보드에 올리는 편이 좋습니다.

- `inbox_duplicate_skip_rate`: 중복으로 skip된 비율
- `inbox_processing_stuck`: `PROCESSING` 상태 장기 체류 건수
- `inbox_done_latency_p95`: 수신부터 `DONE`까지 걸린 시간
- `inbox_dead_total`: `DEAD` 상태 누적 건수
- `payload_hash_mismatch_total`: 같은 ID, 다른 payload 감지 건수

권장 알람 기준 예시:

- `inbox_processing_stuck > 50`가 5분 이상 지속되면 경고
- `payload_hash_mismatch_total > 0`이면 즉시 확인
- `duplicate_skip_rate`가 평시 대비 **3배 이상** 상승하면 broker 재전송 또는 consumer commit 이상 의심
- `done_latency_p95`가 SLO의 **80% 이상**을 10분 이상 점유하면 downstream 병목 점검

### 4) 언제 inbox 대신 다른 해법이 나은가

모든 문제를 inbox로 풀 필요는 없습니다.

- 단순 upsert 집계면 DB `UPSERT`만으로 충분할 수 있습니다.
- 순서가 더 중요한 경우는 inbox보다 version check가 먼저입니다.
- cross-service 보상 흐름이 핵심이면 [분산 트랜잭션/Saga](/learning/deep-dive/deep-dive-distributed-transactions/)가 더 맞습니다.
- producer와 consumer를 모두 통제할 수 있으면 아예 event contract를 바꾸는 것이 더 저렴할 수도 있습니다.

실무 우선순위는 보통 이렇습니다.

1. 도메인 로직 자체가 자연 멱등인지 확인
2. 안 되면 간단한 key dedupe로 닫히는지 확인
3. 그래도 복구/운영이 어렵다면 Transactional Inbox 적용
4. 순서/보상까지 얽히면 별도 상태 기계와 계약 수정 검토

즉 inbox는 강력하지만, **비용이 더 싼 단순화 경로를 먼저 배제한 뒤** 들어가는 편이 맞습니다.

## 트레이드오프/주의점

첫째, inbox를 넣으면 write path가 하나 늘어납니다. TPS가 아주 높은 consumer에서는 DB write 부담과 인덱스 비용이 생깁니다. 그래서 정말 필요한 consumer부터 적용해야 합니다.

둘째, "중복 skip"만 믿고 순서 문제를 무시하면 더 큰 사고가 납니다. 상태 전이 도메인은 반드시 version 또는 transition rule이 필요합니다.

셋째, inbox 상태를 남기되 purge 전략이 없으면 저장소가 새 병목이 됩니다. retention과 아카이브를 도입 초기부터 같이 잡아야 합니다.

넷째, 외부 API 호출이 트랜잭션 안에 길게 묶이면 lease 만료와 중복 재진입 위험이 커집니다. 이 경우는 outbox 또는 비동기 단계 분리를 먼저 검토하는 편이 낫습니다.

다섯째, 운영자가 수동 replay를 자주 하는 팀이라면 inbox 설계에 `operator_reason`, `replayed_by`, `replay_batch_id` 같은 감사 필드도 생각보다 중요합니다. 나중에 원인 추적 비용을 크게 줄여 줍니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 중복 효과 비용이 큰 consumer를 상위 위험도 기준으로 식별했다.
- [ ] `message_id`, `business_key`, `status`, `payload_hash`를 inbox에 저장한다.
- [ ] 비즈니스 효과와 inbox `DONE` 업데이트를 같은 트랜잭션으로 커밋한다.
- [ ] 순서 민감 도메인에 version 또는 상태 전이 규칙이 있다.
- [ ] DLQ replay 최대 기간에 맞춰 inbox retention을 정했다.
- [ ] `duplicate_skip_rate`, `processing_stuck`, `payload_hash_mismatch`를 모니터링한다.

### 연습 과제

1. 현재 운영 중인 consumer 하나를 골라, "같은 메시지가 두 번 오면 어떤 side effect가 두 번 실행되는지"를 표로 적어 보세요. 이 단계만 해도 inbox 필요성이 훨씬 선명해집니다.
2. `DONE`만 있는 단순 dedupe 설계와 `RECEIVED/PROCESSING/DONE/FAILED/DEAD` 상태 머신 설계를 비교하고, 복구 시 어떤 질문에 각각 답할 수 있는지 정리해 보세요.
3. DLQ에서 7일치 메시지를 다시 넣는 시나리오를 가정해, 현재 retention과 인덱스 전략이 버틸지 계산해 보세요.

## 함께 보면 좋은 글

- [트랜잭션 아웃박스 + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [멱등성: 안전한 재시도를 위한 API 설계](/learning/deep-dive/deep-dive-idempotency/)
- [Kafka Retry/DLQ 패턴](/learning/deep-dive/deep-dive-kafka-retry-dlq/)
- [Kafka 멱등성·순서 보장 설계](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)
- [분산 트랜잭션: 2PC에서 SAGA까지](/learning/deep-dive/deep-dive-distributed-transactions/)
