---
title: "백엔드 커리큘럼 심화: Poison Message Quarantine과 Safe Replay, 재처리가 장애를 키우지 않게 하는 법"
date: 2026-05-19
draft: false
topic: "Backend Messaging Reliability"
tags: ["Message Queue", "DLQ", "Poison Message", "Replay", "Idempotency", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "메시지 큐에서 반복 실패하는 poison message를 무한 재시도하지 않고 격리·분류·안전 재처리하는 운영 기준을 DLQ, 멱등성, replay throttle, 승인 절차 중심으로 정리합니다."
module: "backend-resilience"
study_order: 1236
---

메시지 큐를 쓰면 실패가 사라지는 것이 아니라 **실패가 나중으로 이동**합니다. API 요청 안에서 바로 터지던 오류가 consumer retry, pending backlog, DLQ, 수동 replay로 옮겨갈 뿐입니다. 그래서 큐 기반 시스템을 운영할 때 가장 위험한 순간은 "실패했으니 다시 돌리자"가 자동 반사처럼 나오는 때입니다. 같은 메시지가 계속 실패하는데 재시도만 늘리면, poison message 1건이 consumer slot을 점유하고 정상 메시지의 처리를 늦추며, 결국 장애 반경을 큐 전체로 넓힙니다.

이 글은 반복 실패 메시지를 **Poison Message Quarantine**으로 격리하고, 재처리를 **Safe Replay** 절차로 다루는 기준을 정리합니다. 함께 보면 좋은 글은 [Queue Visibility Timeout·Ack/Nack·DLQ 재처리](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/), [Kafka Retry/DLQ 운영 전략](/learning/deep-dive/deep-dive-kafka-retry-dlq/), [Transactional Inbox 패턴](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/), [Batch Idempotency/재처리 전략](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)입니다. 핵심은 재시도 횟수를 늘리는 것이 아니라, **다시 처리해도 안전한 조건을 먼저 증명하는 것**입니다.

## 이 글에서 얻는 것

- Poison message를 일시적 실패, 코드 버그, 데이터 오염, 계약 불일치와 구분하는 기준을 잡을 수 있습니다.
- DLQ를 단순 쓰레기통이 아니라 원인 분류, 승인, 재처리 상태를 가진 quarantine 영역으로 설계할 수 있습니다.
- replay batch size, throttle, idempotency guard, canary replay 같은 숫자 기준을 정할 수 있습니다.
- 운영자가 수동 재처리 버튼을 누르기 전에 확인해야 할 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Poison message는 "실패한 메시지"가 아니라 "같은 조건에서 계속 실패할 메시지"다

모든 실패 메시지를 poison message라고 부르면 대응이 거칠어집니다. 네트워크 timeout, 외부 API 503, DB deadlock처럼 재시도하면 성공할 가능성이 높은 실패도 있습니다. 반대로 payload schema가 바뀌었는데 consumer가 예전 구조만 읽거나, 금액 필드가 음수인데 검증이 빠졌거나, 이미 삭제된 리소스를 참조하는 메시지는 같은 코드와 같은 데이터 상태에서는 계속 실패합니다. 이런 메시지가 poison message입니다.

운영에서는 아래처럼 실패 유형을 먼저 나눕니다.

| 유형 | 예시 | 기본 대응 | 재시도 상한 |
| --- | --- | --- | --- |
| transient | 외부 API 503, DB lock wait timeout | 지수 백오프 + jitter | 3~5회 |
| dependency degraded | 결제사 장애, 검색 클러스터 지연 | circuit breaker, 별도 지연 큐 | 30~60분 윈도우 |
| data invalid | 필수 필드 누락, 음수 금액, 잘못된 enum | 즉시 quarantine | 0~1회 |
| contract mismatch | producer schema 변경, consumer 미배포 | 배포/스키마 수정 후 replay | 자동 replay 금지 |
| business conflict | 이미 취소된 주문에 배송 시작 이벤트 | 도메인 판정 필요 | 승인 후 제한 replay |

중요한 기준은 **같은 입력을 같은 코드로 다시 실행했을 때 성공 가능성이 있는가**입니다. 가능성이 낮으면 retry queue로 보내지 말고 quarantine으로 보내야 합니다. 일반적인 출발점은 동일 메시지 3회 실패 또는 동일 에러 시그니처 50건 이상 발생 시 자동 재시도를 멈추는 것입니다. 금액, 권한, 재고처럼 부작용이 큰 도메인은 1회 실패만으로도 격리하는 편이 안전합니다.

### 2) DLQ는 끝이 아니라 격리된 작업 큐다

많은 팀이 DLQ를 "실패 메시지 보관함"으로만 둡니다. 이러면 장애 후에 남는 것은 메시지 더미뿐입니다. 어떤 메시지가 재처리 가능한지, 어떤 코드를 고쳐야 하는지, 어떤 메시지는 영구 폐기해야 하는지 알 수 없습니다. DLQ를 운영 가능하게 만들려면 최소한 quarantine metadata가 필요합니다.

추천 필드는 아래와 같습니다.

```json
{
  "message_id": "evt_20260519_001",
  "original_topic": "order.payment.completed",
  "consumer": "point-credit-v3",
  "failure_count": 4,
  "first_failed_at": "2026-05-19T10:12:03+09:00",
  "last_error_code": "INVALID_POINT_RULE",
  "error_signature": "PointRuleNotFound:campaignId",
  "payload_hash": "sha256:...",
  "idempotency_key": "point:order:9842",
  "quarantine_reason": "CONTRACT_MISMATCH",
  "replay_status": "BLOCKED"
}
```

payload 전체를 아무 곳에나 복사하는 방식은 피해야 합니다. 개인정보, 토큰, 결제 관련 값이 들어갈 수 있기 때문입니다. quarantine 저장소에는 원본 위치, payload hash, 필요한 최소 필드, 민감도 라벨을 남기고, 원본 접근은 감사 가능한 경로로 제한하는 편이 낫습니다. 이 원칙은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와도 연결됩니다. 나중에 "누가 어떤 근거로 replay했는가"를 설명할 수 있어야 합니다.

### 3) Safe Replay의 첫 조건은 멱등성이다

replay는 과거 이벤트를 다시 실행하는 행위입니다. 따라서 중복 처리 가능성을 기본값으로 봐야 합니다. consumer가 이미 일부 side effect를 만들고 ack 전에 죽었을 수도 있고, 외부 API 호출은 성공했는데 내부 DB commit만 실패했을 수도 있습니다. 이런 상황에서 replay를 누르면 포인트가 두 번 적립되거나 이메일이 반복 발송되거나 재고가 한 번 더 차감됩니다.

Safe Replay의 최소 조건은 세 가지입니다.

1. **idempotency key**: 같은 비즈니스 효과를 한 번만 반영한다.
2. **processing ledger**: 처리 성공, 실패, 보류, 보상 여부를 조회할 수 있다.
3. **effect boundary**: replay가 DB 쓰기, 외부 API, 알림 발송 중 어디까지 건드리는지 분리한다.

예를 들어 포인트 적립 consumer라면 `point_credit:{orderId}:{eventVersion}`을 멱등 키로 두고, 이미 `APPLIED` 상태면 replay를 no-op으로 끝내야 합니다. 단순히 `message_id`만 쓰면 producer가 같은 의미의 이벤트를 새 ID로 다시 발행할 때 막지 못합니다. 반대로 key를 너무 넓게 잡으면 정상 수정 이벤트까지 차단할 수 있습니다. 이 기준은 [UPSERT, UNIQUE 제약, 멱등 키](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)와 [Transactional Inbox](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)에서 더 자세히 이어집니다.

### 4) replay는 대량 실행보다 canary 실행이 먼저다

DLQ가 10만 건 쌓였다고 해서 한 번에 10만 건을 다시 넣으면 두 번째 장애를 직접 만드는 셈입니다. replay는 배포와 비슷하게 단계 확장이 필요합니다. 특히 code fix 직후에는 "고쳤으니 전부 재처리"가 아니라, 에러 시그니처별로 작은 샘플을 먼저 흘려야 합니다.

출발 기준은 아래 정도가 현실적입니다.

| 단계 | 실행량 | 관찰 시간 | 통과 조건 |
| --- | --- | --- | --- |
| dry-run | 0건 | 즉시 | schema parse, idempotency key 계산, dependency 존재 확인 |
| canary replay | 에러 그룹별 10~100건 또는 1% | 10~30분 | 실패율 1% 이하, 중복 효과 0건 |
| throttled replay | 초당 10~100건 | 30~60분 | consumer lag 안정, DB p95 20% 이상 악화 없음 |
| full replay | backlog 전체 | 완료까지 | error budget burn 허용 범위 내 |

도메인별로 숫자는 달라질 수 있습니다. 결제·정산·권한 이벤트는 canary를 더 작게 잡고, 로그·분석 이벤트는 더 빠르게 처리해도 됩니다. 중요한 것은 replay 속도를 consumer 처리량이 아니라 **다운스트림 side effect의 안전 처리량** 기준으로 잡는 것입니다. DB 쓰기, 외부 API rate limit, 알림 발송 제한, search indexing throughput이 모두 replay budget에 들어갑니다.

### 5) quarantine 해제는 사람 승인보다 근거 패킷이 먼저다

고위험 replay에는 사람 승인이 필요합니다. 하지만 승인 버튼만 있다고 안전해지지는 않습니다. 운영자가 봐야 할 근거가 없으면 승인도 감에 의존합니다. quarantine 해제 전에 최소한 아래 근거가 있어야 합니다.

- root cause: 코드 버그, schema mismatch, 데이터 보정 누락 중 무엇이었는가
- fix evidence: 배포 버전, migration, config 변경, contract test 결과
- impact range: 메시지 수, tenant 수, 금액/포인트/권한 영향 범위
- replay plan: batch size, throttle, 예상 완료 시간, 중단 조건
- rollback/compensation: replay 후 잘못 반영되면 어떻게 되돌릴 것인가

이 근거를 `replay_request`로 남기고, operator id와 승인 시간을 기록합니다. 특히 금전·포인트·권한 변경은 replay 후 [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)으로 결과를 대조해야 합니다. replay 성공 로그만으로는 부족합니다. 원장과 파생 테이블, 외부 시스템 상태가 일치하는지 확인해야 운영이 닫힙니다.

## 실무 적용

### 1) 실패 경로를 retry, delay, quarantine으로 분리한다

처음부터 완벽한 플랫폼을 만들 필요는 없습니다. 우선 consumer 공통 라이브러리나 미들웨어에서 실패를 세 갈래로 나누면 효과가 큽니다.

1. `retryable`: timeout, 429, 503처럼 재시도 가치가 있는 오류
2. `delayable`: 의존성 장애나 순서 대기처럼 시간이 필요한 오류
3. `quarantine`: payload/contract/business conflict처럼 사람이 판단해야 하는 오류

이 분류를 코드에서 예외 타입이나 error code로 명시합니다. 문자열 로그를 사람이 읽고 분류하는 방식은 오래가지 못합니다. 추천 기준은 신규 consumer부터 `error_class`, `message_id`, `business_key`, `idempotency_key`, `failure_count`를 구조화 로그로 남기는 것입니다. 2주만 쌓아도 어떤 실패가 retry로 해결되고 어떤 실패가 quarantine 후보인지 보입니다.

### 2) DLQ 대시보드는 총량보다 그룹화를 먼저 보여줘야 한다

운영자가 보고 싶은 것은 "DLQ 12,381건"이 아닙니다. 같은 원인 12,000건인지, 서로 다른 원인 12,000건인지가 더 중요합니다. 대시보드는 아래 순서로 보여주는 편이 좋습니다.

- 에러 시그니처별 건수와 최초/최종 발생 시각
- producer version, consumer version, schema version 분포
- tenant 또는 aggregate별 편중
- replay 가능/차단/영구 실패 라벨
- 최근 replay 결과와 실패율

우선순위도 숫자로 둡니다. 예를 들어 `quarantine_age_p95 > 24h`이면 P2, 결제·권한 도메인에서 `blocked_replay_count > 100`이면 P1, 같은 에러 시그니처가 10분에 1,000건 이상 증가하면 P1로 올립니다. 반대로 분석 이벤트 10건이 DLQ에 있는 정도는 업무 시간 중 처리로 충분할 수 있습니다.

### 3) replay API에는 속도 제한과 중단 조건을 넣는다

수동 replay 도구는 관리자 기능이지만, 동시에 장애를 만드는 버튼이기도 합니다. 최소한 아래 guardrail이 필요합니다.

- 한 번의 replay request 최대 메시지 수: 기본 1,000건, 고위험 도메인 100건
- 기본 throttle: consumer 정상 처리량의 10~20% 이하
- 같은 business key에 대한 동시 replay 금지
- 실패율 1~5% 초과 시 자동 중단
- DB p95 또는 외부 API error rate가 기준선 대비 20~30% 악화되면 중단
- reason code, ticket link, operator id 없이는 실행 금지

이 기준은 느려 보이지만 실제로는 빠릅니다. 무제한 replay로 두 번째 장애를 만들고 다시 복구하는 시간보다, 작은 canary와 throttle로 안전하게 처리하는 시간이 짧습니다.

## 트레이드오프/주의점

첫째, quarantine을 너무 빨리 보내면 자동 복구율이 떨어집니다. 일시적 장애였는데 바로 사람 대기열로 보내면 운영 비용이 늘어납니다. 그래서 transient 오류에는 짧은 retry budget을 주되, payload invalid나 contract mismatch는 즉시 격리하는 식으로 오류 유형별 정책을 다르게 둬야 합니다.

둘째, DLQ 보관은 비용과 개인정보 리스크를 만듭니다. 모든 payload를 장기 보관하면 디버깅은 편하지만, 보안·컴플라이언스 부담이 커집니다. 보관 기간은 도메인별로 나눕니다. 분석 이벤트는 7~14일, 주문·정산 이벤트는 30~90일, 법적 근거가 필요한 원장 이벤트는 별도 보관 정책을 따르는 식입니다. 단, payload 원문과 처리 ledger는 접근 권한을 분리해야 합니다.

셋째, replay가 항상 정답은 아닙니다. 이미 비즈니스 시간이 지나 의미가 없어진 알림, 취소된 주문의 후속 이벤트, 폐기된 캠페인 포인트는 replay보다 폐기 또는 보상 처리가 맞을 수 있습니다. 의사결정 우선순위는 `금전/권한 정합성 > 고객 상태 복구 > 내부 분석 완전성 > 알림 재발송` 순서로 두는 편이 안전합니다.

넷째, exactly-once를 목표로 잡으면 과설계하기 쉽습니다. 현실적인 목표는 at-least-once 전달을 인정하고, idempotent consumer, processing ledger, quarantine, reconciliation을 조합해 **중복 효과를 0에 가깝게 줄이는 것**입니다. 메시지가 두 번 도착하는 것은 정상입니다. 같은 비즈니스 효과가 두 번 반영되는 것이 장애입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] consumer 오류가 retryable, delayable, quarantine으로 분류된다.
- [ ] 동일 메시지 실패 횟수와 동일 에러 시그니처 증가율 기준이 숫자로 정의되어 있다.
- [ ] DLQ/quarantine 레코드에 message id, business key, error signature, payload hash, replay status가 남는다.
- [ ] replay 전에 idempotency key와 processing ledger를 확인한다.
- [ ] replay API에는 batch size, throttle, 실패율 기반 자동 중단 조건이 있다.
- [ ] 고위험 replay에는 reason code, ticket link, operator id, 승인 시간이 남는다.
- [ ] replay 후 reconciliation 또는 샘플 검증으로 실제 side effect를 확인한다.

### 연습

1. 현재 운영 중인 consumer 1개를 골라 최근 7일 실패 로그를 `transient`, `data invalid`, `contract mismatch`, `business conflict`로 분류해 보세요. 가장 많은 유형이 retry로 해결되는지, quarantine이 맞는지 판단합니다.
2. DLQ 메시지 100건을 샘플링해 같은 에러 시그니처가 몇 개로 묶이는지 계산해 보세요. 5개 이하 그룹이 대부분이면 대시보드 그룹화만으로 운영 난이도가 크게 줄어듭니다.
3. 포인트 적립, 이메일 발송, 검색 색인 중 하나를 골라 replay throttle을 정해 보세요. 다운스트림 p95 지연이 20% 악화되면 자동 중단하는 조건까지 포함합니다.
4. 고위험 replay request 템플릿을 만들어 보세요. root cause, fix evidence, impact range, replay plan, rollback/compensation 5개 필드를 1페이지 안에 담는 것이 목표입니다.

Poison message 대응의 목적은 실패를 숨기는 것이 아닙니다. 실패를 **정상 메시지 처리 경로에서 떼어내고, 다시 처리해도 안전하다는 근거가 생길 때만 제한적으로 되돌리는 것**입니다. 큐는 비동기화를 쉽게 만들어 주지만, 재처리의 책임까지 대신 지지는 않습니다. 좋은 메시징 시스템은 retry가 많은 시스템이 아니라, retry하지 말아야 할 메시지를 빨리 알아보고 안전한 replay 절차로 넘기는 시스템입니다.
