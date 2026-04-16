---
title: "백엔드 커리큘럼 심화: Webhook Delivery Reliability 플레이북 (Signature·Retry·Idempotency·DLQ)"
date: 2026-04-09
draft: false
topic: "Backend Integration"
tags: ["Webhook", "Idempotency", "Retry", "DLQ", "Signature Verification", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "외부 시스템으로 webhook를 보내는 백엔드에서 중복 전송, 유실, 서명 검증 실패, 재시도 폭주를 줄이기 위한 실무 기준을 숫자와 우선순위 중심으로 정리합니다."
module: "integration-reliability"
study_order: 1168
---

실무에서 webhook는 생각보다 자주 사고를 만듭니다. 결제 승인 이벤트를 보냈는데 상대 서비스가 두 번 처리하기도 하고, 배송 상태 변경을 보냈는데 202 응답만 남고 실제 반영은 안 되기도 합니다. 더 까다로운 문제는 대부분의 장애가 "전송 실패" 한 줄로 끝나지 않는다는 점입니다. 서명 검증 실패, 수신 측의 일시 장애, 재시도 폭주, 순서 역전, 같은 이벤트의 중복 발행이 한꺼번에 얽힙니다.

그래서 webhook 설계의 핵심은 단순 HTTP POST가 아닙니다. **전송 성공률보다 효과의 일관성**을 보장하는 구조가 먼저입니다. 이 글에서는 발신 시스템 기준으로 webhook를 운영할 때 반드시 정해야 하는 기준을 정리합니다. 핵심은 네 가지입니다. **서명 검증 가능성, 재시도 제어, 멱등성 보장, 실패 격리(DLQ)** 입니다.

## 이 글에서 얻는 것

- webhook 전달 시스템을 설계할 때 "보내면 끝"이 아니라 어떤 상태 전이를 관리해야 하는지 이해할 수 있습니다.
- 서명, retry, idempotency, DLQ를 어떤 순서와 기준으로 붙여야 운영 사고를 줄일 수 있는지 알 수 있습니다.
- 실무에서 바로 적용 가능한 숫자 기준, 예를 들어 timeout, retry 횟수, dedupe window, DLQ 승격 조건을 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) webhook의 핵심 실패는 네트워크가 아니라 상태 불일치다

많은 팀이 webhook 장애를 "상대 서버가 응답을 안 했다" 정도로만 이해합니다. 하지만 실제로 더 위험한 건 **발신 시스템과 수신 시스템이 서로 다른 진실을 믿는 상태**입니다.

대표 시나리오는 아래와 같습니다.

1. 발신 시스템이 이벤트를 생성하고 webhook 전송 시도
2. 수신 시스템은 실제 처리 완료
3. 응답이 타임아웃 나서 발신 시스템은 실패로 기록
4. 발신 시스템이 재시도
5. 수신 시스템은 같은 이벤트를 다시 받아 중복 처리

이 문제는 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)와 같은 관점으로 봐야 합니다. webhook는 단순 알림이 아니라 외부 효과를 유발하는 명령에 가깝기 때문에, 전송 성공보다 **중복 효과 방지**가 우선입니다.

### 2) 동기 요청으로 직접 보내기보다 비동기 전달 파이프라인이 안전하다

애플리케이션 트랜잭션 안에서 외부 webhook를 직접 호출하면 다음 문제가 생깁니다.

- DB 커밋과 외부 전송 성공 여부가 분리됨
- 외부 시스템 지연 때문에 사용자 요청 지연이 늘어남
- 같은 요청 안에서 재시도하면 thread와 connection을 오래 점유함

그래서 실무에서는 보통 아래 구조가 안정적입니다.

1. 비즈니스 트랜잭션에서 이벤트 레코드 저장
2. Outbox 또는 전송 큐에 적재
3. 별도 dispatcher가 webhook 전송
4. 응답 상태와 재시도 스케줄 기록
5. 반복 실패는 DLQ로 격리

이 패턴은 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)를 적용할 때 가장 자연스럽습니다. 핵심은 "비즈니스 성공"과 "외부 전송 시도"를 분리해, 사용자 요청 경로를 짧게 유지하는 것입니다.

### 3) 서명 검증은 보안 기능이면서 동시에 운영 디버깅 기능이다

수신 시스템 입장에서는 webhook를 믿을 근거가 필요합니다. 이때 흔히 HMAC 기반 서명을 사용합니다. 그런데 서명은 단순 보안 체크로만 끝내면 절반만 구현한 것입니다.

서명 설계 시 필수 항목:

- `event_id`
- `timestamp`
- `delivery_attempt`
- body 원문 해시 또는 body 자체
- 서명 알고리즘 버전(`v1`, `v2`)

권장 검증 규칙:

- timestamp 허용 오차: 3~5분
- 동일 `event_id + signature_version` 재사용 허용 여부 명시
- body canonicalization 규칙 고정(JSON key 정렬 여부 등)
- key rotation 중에는 2개 키 동시 허용 기간 운영

이 기준이 없으면 서명 실패 원인을 구분하기 어렵습니다. 실제 사고에서는 악성 요청보다도, 인코딩 차이·본문 재직렬화·시계 오차 때문에 정상 요청이 거부되는 경우가 더 많습니다.

### 4) 재시도는 많이 할수록 좋은 게 아니라, 빨리 포기해야 할 대상과 끝까지 밀어야 할 대상을 나누는 게 중요하다

재시도 전략을 잘못 잡으면 webhook 시스템이 장애 증폭기가 됩니다. 예를 들어 10초 timeout으로 8회 즉시 재시도하면, 상대 시스템이 이미 느린 상황에서 연결 수만 폭증합니다.

기본 원칙은 이렇습니다.

- **4xx 중 일부는 즉시 중지**: 400, 401, 403, 404, 410은 보통 영구 실패 후보
- **429/5xx는 제한된 재시도**: backoff와 jitter 필수
- **timeout/network error는 짧게 재시도 후 대기열로 회수**

권장 초기값:

- connect timeout: 1초
- read timeout: 3초
- 즉시 재시도: 0~1회
- 총 재시도 횟수: 5~8회
- backoff: 1분, 5분, 15분, 1시간, 6시간
- jitter: 10~20%

이 기준은 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 같은 관점입니다. 성공률을 끌어올리려면 재시도 횟수보다 **동시성 제한과 재시도 간격**을 먼저 조정해야 합니다.

### 5) DLQ는 실패 저장소가 아니라 운영 우선순위 큐다

DLQ를 "나중에 보자"는 창고처럼 쓰면 금방 쌓입니다. 중요한 건 DLQ로 보낸 후 무엇을 할지 미리 정하는 것입니다.

DLQ 승격 예시 조건:

- 24시간 내 최대 재시도 횟수 초과
- 수신 엔드포인트가 410 Gone 반환
- 서명 검증 실패가 3회 연속 발생
- payload 스키마 검증 실패

DLQ 레코드 최소 필드:

- endpoint_id
- event_id
- event_type
- final_status_code
- last_error_reason
- next_action(owner, due_at)
- payload_hash

메시지 재처리 관점은 [Kafka Retry/DLQ](/learning/deep-dive/deep-dive-kafka-retry-dlq/)와 닮아 있습니다. 차이는 webhook DLQ는 단순 재적재보다 **계약 변경 여부, endpoint 폐기 여부, 수신 팀 상태**를 같이 봐야 한다는 점입니다.

## 실무 적용

### 1) 권장 아키텍처

가장 무난한 기본형은 아래 구조입니다.

1. **Event Producer**: 주문/결제/회원 상태 변경 발생
2. **Outbox Table**: 비즈니스 트랜잭션과 함께 이벤트 저장
3. **Dispatcher Worker**: endpoint별 전송 정책에 따라 webhook 발송
4. **Delivery Log**: attempt, 응답 코드, latency, error 기록
5. **Retry Scheduler**: backoff 정책으로 재시도 예약
6. **DLQ + Ops Queue**: 영구 실패 혹은 사람 판단이 필요한 건 별도 분리

여기서 중요한 분리 기준은 세 가지입니다.

- 이벤트 생성과 전송을 분리한다.
- endpoint별 rate limit을 둔다.
- 운영자가 수동 재전송할 때도 같은 멱등성 키를 사용한다.

### 2) 최소 데이터 모델 예시

```sql
CREATE TABLE webhook_endpoint (
  endpoint_id         BIGINT PRIMARY KEY,
  target_url          VARCHAR(500) NOT NULL,
  secret_version      VARCHAR(20)  NOT NULL,
  status              VARCHAR(20)  NOT NULL, -- ACTIVE, PAUSED, DISABLED
  timeout_ms          INT          NOT NULL DEFAULT 3000,
  max_retry_count     INT          NOT NULL DEFAULT 6,
  rate_limit_per_min  INT          NOT NULL DEFAULT 120,
  created_at          TIMESTAMP    NOT NULL,
  updated_at          TIMESTAMP    NOT NULL
);

CREATE TABLE webhook_delivery (
  delivery_id         BIGINT PRIMARY KEY,
  endpoint_id         BIGINT       NOT NULL,
  event_id            VARCHAR(120) NOT NULL,
  event_type          VARCHAR(80)  NOT NULL,
  idempotency_key     VARCHAR(160) NOT NULL,
  attempt_no          INT          NOT NULL,
  status              VARCHAR(20)  NOT NULL, -- PENDING, SENT, ACKED, RETRY, DLQ
  next_attempt_at     TIMESTAMP,
  last_status_code    INT,
  last_error_reason   VARCHAR(200),
  payload_hash        VARCHAR(128) NOT NULL,
  created_at          TIMESTAMP    NOT NULL,
  updated_at          TIMESTAMP    NOT NULL,
  UNIQUE (endpoint_id, event_id)
);
```

`UNIQUE (endpoint_id, event_id)`를 두는 이유는 같은 endpoint에 같은 이벤트가 중복 적재되는 것을 1차로 막기 위해서입니다. 다만 이것만으로는 충분하지 않으므로 수신 측도 `idempotency_key`를 소비해야 합니다.

### 3) 의사결정 기준(숫자·조건·우선순위)

권장 우선순위는 **데이터 무결성 > 중복 효과 방지 > 전송 지연 최소화 > 처리 비용** 입니다.

초기 운영 기준 예시:

- delivery success rate: 99% 이상
- p95 delivery latency: 60초 이내
- duplicate delivery rate: 0.5% 미만
- DLQ 비율: 일간 0.3% 미만
- signature verification failure: 0.1% 미만
- endpoint별 동시 in-flight 요청: 3~10개로 제한

자동 제어 기준 예시:

- 5분 이동창에서 5xx 비율 20% 초과 시 해당 endpoint 일시 pause
- 429 비율 10% 초과 시 동시성 50% 감소
- signature failure 3회 연속 발생 시 key mismatch 경보 + 자동 disable 후보 등록
- 24시간 내 DLQ 10건 초과 endpoint는 운영자 점검 전 수동 승인 모드 전환

실무에서는 "무조건 재전송"보다 **endpoint health에 따라 동작 모드를 바꾸는 것**이 더 중요합니다. 이 부분은 [API Rate Limit + Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)와 연결해서 보면 좋습니다.

### 4) 실패 분류 기준을 먼저 정해야 운영이 빨라진다

실패를 전부 `delivery_failed`로만 남기면 원인 파악 시간이 길어집니다. 최소한 아래 수준으로는 나눠야 합니다.

- `network_timeout`
- `tls_handshake_failed`
- `signature_invalid`
- `http_4xx_permanent`
- `http_5xx_retryable`
- `rate_limited`
- `payload_schema_invalid`
- `endpoint_disabled`

분류 기준이 있으면 대응 자동화가 쉬워집니다.

- `signature_invalid` → secret rotation 확인
- `rate_limited` → endpoint 동시성 낮춤
- `http_4xx_permanent` → 재시도 중단 + 계약 확인
- `payload_schema_invalid` → producer 배포 점검

### 5) 4주 도입 플랜

**1주차: 전송 로그 표준화**  
`event_id`, `endpoint_id`, `attempt_no`, `status_code`, `latency_ms`, `payload_hash`를 전부 기록합니다.

**2주차: 비동기 전송 + 멱등성 키 도입**  
사용자 요청 경로에서 외부 호출을 분리하고, `idempotency_key`와 `UNIQUE(endpoint_id, event_id)`를 도입합니다.

**3주차: endpoint별 정책 분리**  
timeout, retry, concurrency, signing secret rotation 정책을 endpoint 단위로 나눕니다.

**4주차: DLQ 운영 룰과 대시보드 고정**  
DLQ 승격 조건, 자동 pause 조건, 수동 재처리 절차를 문서화합니다.

## 트레이드오프/주의점

1) **너무 강한 재시도는 성공률 대신 장애 반경을 키울 수 있다**  
특히 상대 시스템이 단일 DB에 묶여 있거나 rate limit이 약한 경우, 재시도 폭주는 webhook보다 더 큰 장애를 만들 수 있습니다.

2) **서명만 도입하고 canonicalization을 고정하지 않으면 정상 요청도 깨진다**  
JSON 직렬화 방식, 줄바꿈, charset 차이 때문에 운영 중 허무한 실패가 발생합니다.

3) **발신 측 멱등성만으로는 충분하지 않다**  
수신 측이 같은 `event_id`를 중복 처리하면 여전히 사고가 납니다. 계약 문서에 수신 측 dedupe 책임 범위를 명시해야 합니다.

4) **DLQ를 쌓아두기만 하면 기술 부채가 된다**  
DLQ는 실패 아카이브가 아니라 운영자 액션 큐여야 합니다. owner와 due time이 없는 DLQ는 거의 항상 방치됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] webhook 전송이 사용자 요청 경로와 분리돼 있다.
- [ ] `event_id`, `idempotency_key`, `attempt_no`가 로그와 저장소에 모두 남는다.
- [ ] endpoint별 timeout, retry, concurrency 정책이 숫자로 정의돼 있다.
- [ ] 서명 버전과 key rotation 절차가 문서화돼 있다.
- [ ] DLQ 승격 조건과 수동 재처리 owner가 정해져 있다.

### 연습 과제

1. 현재 운영 중인 외부 연동 1개를 골라, `network_timeout`, `4xx`, `5xx`, `signature_invalid`로 실패를 나눴을 때 지난 2주 비율을 계산해 보세요.
2. `event_id` 기준 중복 전송률과 실제 중복 처리율을 따로 측정해 보세요. 둘의 차이가 크면 수신 측 멱등성 계약이 약하다는 신호입니다.
3. endpoint 하나를 골라 `429 비율 10% 초과 시 동시성 50% 감축` 규칙을 적용했을 때 success rate와 p95 latency가 어떻게 변하는지 비교해 보세요.

## 관련 글

- [멱등성(Idempotency) 설계](/learning/deep-dive/deep-dive-idempotency/)
- [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Timeout/Retry/Backoff 운영 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [API Rate Limit + Backpressure 설계](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Kafka Retry/DLQ 패턴](/learning/deep-dive/deep-dive-kafka-retry-dlq/)
