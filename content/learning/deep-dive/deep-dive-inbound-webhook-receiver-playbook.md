---
title: "백엔드 커리큘럼 심화: Inbound Webhook Receiver 플레이북, 외부 이벤트를 안전하게 받는 법"
date: 2026-06-25
draft: false
topic: "Backend Integration"
tags: ["Webhook", "Signature Verification", "Idempotency", "Replay Protection", "Integration Reliability", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "결제사·인증 SaaS·마켓플레이스·외부 파트너가 보내는 webhook을 수신할 때 서명 검증, replay 방지, 멱등 처리, 상태 전이를 어떻게 설계할지 실무 기준으로 정리합니다."
module: "integration-reliability"
study_order: 1202
keywords: ["inbound webhook receiver", "webhook signature verification", "webhook replay protection", "webhook idempotency", "backend integration"]
---

외부 시스템이 보내는 webhook은 편리합니다. 결제 승인, 환불 완료, 배송 상태 변경, 인증 사용자 변경, 구독 갱신 같은 이벤트를 우리 서버가 polling하지 않아도 받을 수 있습니다. 하지만 수신 endpoint를 단순히 `POST /webhooks/payment` 하나로 열어두면 곧 운영 문제가 됩니다. 같은 이벤트가 두 번 오고, 서명이 맞지 않고, 5분 늦게 도착한 이벤트가 현재 상태를 되돌리고, 장애 중 재전송이 몰리며, 원문 payload가 로그에 남습니다.

발신 시스템 관점의 webhook 운영은 [Webhook Delivery Reliability 플레이북](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)에서 다뤘습니다. 이번 글은 반대 방향입니다. **우리가 외부 이벤트를 받는 수신자일 때, 어떤 순서로 검증하고 저장하고 처리해야 안전한가**를 정리합니다. 함께 읽으면 좋은 글은 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [Upsert와 Idempotency Write Path](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/), [Transactional Inbox](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/), [Operational State Machine](/learning/deep-dive/deep-dive-operational-state-machine-design/)입니다.

## 이 글에서 얻는 것

- webhook 수신 API를 공개 HTTP endpoint가 아니라 **검증, 수락, 처리, 재처리**가 분리된 ingestion pipeline으로 설계할 수 있습니다.
- HMAC 서명, timestamp 허용 오차, replay window, key rotation, raw body 보존 기준을 숫자로 잡을 수 있습니다.
- 같은 이벤트가 중복 또는 지연 도착해도 주문, 결제, 권한, 구독 상태가 뒤집히지 않게 상태 전이 기준을 만들 수 있습니다.
- 외부 provider 장애와 내부 처리 장애를 분리해, 2xx 응답과 실제 반영 성공을 혼동하지 않게 됩니다.

## 핵심 개념/이슈

### 1) Webhook 수신은 "요청 처리"가 아니라 "외부 이벤트 수락"이다

일반 API는 사용자가 요청하고 우리 시스템이 즉시 결과를 돌려줍니다. webhook은 다릅니다. 발신자는 이미 자기 시스템에서 어떤 일이 일어났다고 알려주며, 우리는 그 사실을 받아 내부 상태와 맞춥니다. 그래서 수신 endpoint의 1차 목표는 비즈니스 처리를 끝내는 것이 아니라, **정상 provider가 보낸 변조되지 않은 이벤트를 잃지 않고 수락하는 것**입니다.

권장 흐름은 아래처럼 나눕니다.

1. HTTP layer: size limit, method, content type, provider path 검증
2. Authenticity layer: raw body 기준 서명 검증, timestamp/replay window 확인
3. Ingestion layer: `event_id`, `provider`, `payload_hash`로 inbox 저장
4. Response layer: 수락 가능하면 빠르게 2xx 반환
5. Processing layer: 별도 worker가 내부 상태 전이와 부작용 처리
6. Recovery layer: 실패 이벤트를 retry, quarantine, manual review로 분리

이렇게 나누면 provider에게 응답하는 시간과 내부 처리를 분리할 수 있습니다. 수신 endpoint 안에서 결제 상태 업데이트, 포인트 지급, 메일 발송, 외부 API 호출까지 모두 끝내려 하면 provider timeout이 곧 중복 webhook 폭주로 바뀝니다.

### 2) 서명 검증은 raw body와 clock skew 기준이 핵심이다

Webhook 보안에서 가장 흔한 실수는 JSON을 파싱한 뒤 다시 직렬화한 문자열로 서명을 검증하는 것입니다. 발신자가 서명한 대상은 보통 **원문 body**입니다. key 순서, 공백, unicode escape, newline 하나만 달라져도 서명이 달라질 수 있습니다. 따라서 framework가 body를 consume하기 전에 raw bytes를 확보하거나, raw body를 검증 레이어에 전달해야 합니다.

실무 기준은 보수적으로 잡습니다.

- request body 최대 크기: 일반 이벤트 **256KB~1MB**, 대용량 payload는 별도 fetch API 사용
- timestamp 허용 오차: **3~5분**
- clock skew 경고: provider timestamp와 서버 시간이 **2분 이상** 차이 나면 warning
- 서명 알고리즘: HMAC-SHA256 이상, algorithm prefix를 헤더에 포함
- 비교 방식: constant-time comparison 사용
- 서명 실패율: 정상 운영 기준 **0.1% 미만**

서명에 포함할 값은 provider마다 다르지만, 최소한 `timestamp + "." + raw_body` 형태처럼 시각과 본문이 함께 묶이는 편이 안전합니다. timestamp가 없으면 오래된 요청을 그대로 재전송하는 replay attack을 막기 어렵습니다.

### 3) Replay 방지는 event id와 payload hash를 함께 봐야 한다

Webhook은 재전송될 수 있습니다. 발신자가 응답을 못 받았거나, 내부 retry 정책이 있거나, 운영자가 수동 재전송했을 수 있습니다. 그래서 "같은 요청이 또 왔다"는 사실만으로 실패 처리하면 안 됩니다. 정상 재전송은 2xx로 받아야 하고, 이미 처리한 이벤트라면 같은 결과로 닫아야 합니다.

문제는 `event_id`만 믿을 수 없는 경우입니다. provider 버그나 운영 실수로 같은 id에 다른 payload가 올 수 있고, 테스트 환경과 운영 환경의 id namespace가 섞일 수도 있습니다. 그래서 inbox에는 아래 조합을 남기는 것이 좋습니다.

- `provider`
- `provider_account_id` 또는 tenant mapping key
- `event_id`
- `event_type`
- `occurred_at`
- `received_at`
- `payload_hash`
- `signature_version`
- `processing_status`

Dedup 기준은 보통 `provider + provider_account_id + event_id`입니다. 같은 키가 다시 들어왔는데 `payload_hash`가 같으면 정상 replay로 보고 2xx를 반환합니다. 같은 키인데 hash가 다르면 `payload_mismatch`로 quarantine합니다. 이 값은 거의 **0건**이어야 합니다. 한 건이라도 나오면 provider 계약, 환경 분리, 파서 버전 문제를 확인해야 합니다.

Replay window는 provider의 재전송 정책보다 길게 잡습니다. 결제·구독 webhook은 **72시간~7일**, 회계·정산 이벤트는 **30일 이상** 보존을 검토합니다. 단순 알림 이벤트는 24~72시간으로 충분할 수 있습니다. 보관 기간을 너무 짧게 잡으면 장애 중 멱등성이 깨집니다.

### 4) 상태 전이는 이벤트 도착 순서가 아니라 비즈니스 규칙으로 판단한다

Webhook은 순서대로 오지 않습니다. `payment_failed`가 먼저 오고 `payment_succeeded`가 나중에 올 수 있고, `subscription_canceled` 뒤에 이전 시각의 `invoice_paid`가 도착할 수 있습니다. 따라서 도착 순서대로 `status`를 덮어쓰는 코드는 위험합니다.

상태 변경은 [Operational State Machine](/learning/deep-dive/deep-dive-operational-state-machine-design/)처럼 전이표로 관리하는 편이 좋습니다.

| 현재 상태 | 이벤트 | 처리 기준 |
| --- | --- | --- |
| `PENDING` | `payment_succeeded` | `PAID`로 전이 |
| `PENDING` | `payment_failed` | 실패 사유 저장, 재시도 가능 상태로 전이 |
| `CANCELED` | `payment_succeeded` | 자동 전이 금지, reconciliation 후보 |
| `PAID` | `payment_succeeded` replay | 멱등 성공, 상태 변경 없음 |
| `REFUNDED` | 과거 `payment_succeeded` | stale event로 기록, 상태 변경 없음 |

핵심은 event의 `occurred_at`과 우리 시스템의 상태 변경 시각을 함께 보는 것입니다. 단, timestamp만으로도 부족합니다. 외부 provider가 보낸 시각과 내부 주문 생성 시각의 의미가 다를 수 있기 때문입니다. 금전 도메인에서는 가능하면 provider의 canonical status 조회 API로 확인하는 "verify before irreversible transition" 단계를 둡니다.

### 5) 2xx 응답은 "처리 완료"가 아니라 "수락 완료"일 수 있다

수신 endpoint가 이벤트를 inbox에 안전하게 저장했다면 provider에게 2xx를 반환할 수 있습니다. 내부 처리가 아직 끝나지 않았더라도, 우리가 책임지고 처리할 수 있는 상태가 됐기 때문입니다. 이 관점이 없으면 provider 재시도를 막기 위해 무리하게 endpoint 안에서 모든 일을 끝내려 합니다.

다만 2xx를 너무 빨리 반환하면 안 되는 경우도 있습니다. 서명 검증 실패, replay window 초과, provider account mapping 실패, payload schema가 전혀 맞지 않는 경우는 수락하지 않아야 합니다. 이때도 status code 정책을 구분합니다.

- `2xx`: 검증 통과, inbox 저장 완료, 중복 replay 확인 완료
- `400`: 필수 헤더 누락, schema parse 실패
- `401/403`: 서명 검증 실패, 비활성 endpoint key
- `404`: 알 수 없는 provider account 또는 폐기된 endpoint
- `409`: 같은 event id에 다른 payload hash
- `413`: payload size 초과
- `429`: provider별 rate limit 초과
- `503`: 내부 저장소 장애로 수락 불가

서명 실패나 schema 실패를 무조건 2xx로 삼키면 provider는 성공으로 이해하고 재전송하지 않습니다. 반대로 내부 worker 실패를 5xx로 돌리면 provider가 같은 이벤트를 계속 밀어 넣습니다. 응답 코드는 "어느 단계까지 책임을 인수했는가"를 기준으로 정해야 합니다.

## 실무 적용

### 1) 최소 아키텍처

중소 규모 팀에서 시작하기 좋은 구조는 아래와 같습니다.

1. `WebhookController`: provider별 endpoint, raw body 획득, 기본 limit 검증
2. `SignatureVerifier`: secret version, timestamp, HMAC 검증
3. `WebhookInboxRepository`: event id와 payload hash 기준 저장
4. `WebhookAcceptedResponse`: 저장 성공 또는 replay면 즉시 2xx
5. `WebhookProcessorWorker`: event type별 handler 실행
6. `WebhookQuarantine`: payload mismatch, unknown transition, 반복 실패 격리
7. `ProviderStatusVerifier`: 고위험 이벤트 처리 전 provider 상태 재조회

이 구조는 [Transactional Inbox](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)와 같은 생각입니다. 외부 이벤트를 바로 domain table에 반영하지 않고 inbox를 거치면, 실패와 재처리를 같은 도구로 다룰 수 있습니다.

### 2) 데이터 모델 예시

```sql
CREATE TABLE inbound_webhook_event (
  id                    BIGINT PRIMARY KEY,
  provider              VARCHAR(50)  NOT NULL,
  provider_account_id   VARCHAR(120) NOT NULL,
  event_id              VARCHAR(160) NOT NULL,
  event_type            VARCHAR(100) NOT NULL,
  occurred_at           TIMESTAMP,
  received_at           TIMESTAMP    NOT NULL,
  payload_hash          VARCHAR(128) NOT NULL,
  signature_version     VARCHAR(30)  NOT NULL,
  status                VARCHAR(30)  NOT NULL,
  attempt_count         INT          NOT NULL DEFAULT 0,
  next_attempt_at       TIMESTAMP,
  last_error_code       VARCHAR(80),
  last_error_message    VARCHAR(300),
  raw_payload_ref       VARCHAR(300),
  created_at            TIMESTAMP    NOT NULL,
  updated_at            TIMESTAMP    NOT NULL,
  UNIQUE (provider, provider_account_id, event_id)
);
```

Raw payload를 DB에 그대로 넣을지는 조심해야 합니다. 결제·인증·CRM payload에는 개인정보가 섞입니다. 원문을 저장해야 디버깅이 쉬운 것은 맞지만, 보관 기간과 접근 권한을 강하게 제한해야 합니다. 실무에서는 작은 payload는 암호화 컬럼에 짧게 저장하고, 민감하거나 큰 payload는 object storage에 암호화 저장한 뒤 `raw_payload_ref`만 남기는 방식을 씁니다. JSONB로 일부 필드를 저장하려면 [JSONB Extension Field Governance](/learning/deep-dive/deep-dive-jsonb-extension-field-schema-governance/)의 기준처럼 queryable field와 opaque payload를 분리해야 합니다.

### 3) 처리 우선순위와 숫자 기준

Webhook receiver의 우선순위는 **위조 차단 > 유실 방지 > 중복 효과 방지 > 상태 전이 정확성 > 처리 지연 최소화**입니다. 빠른 반영보다 잘못된 반영을 막는 것이 먼저입니다.

초기 운영 기준은 아래 정도로 둡니다.

- endpoint p95 응답 시간: **500ms 이하**
- inbox 저장 실패율: **0.1% 미만**
- signature failure rate: 정상 traffic 기준 **0.1% 미만**, 5분간 1% 초과면 key/clock 점검
- duplicate replay rate: provider별 기준선 대비 **3배 상승** 시 provider 장애 또는 내부 5xx 확인
- payload mismatch: **0건 목표**, 발생 시 즉시 quarantine
- processing lag p95: 결제·권한 이벤트 **1분 이하**, 일반 알림 이벤트 **5분 이하**
- unknown transition rate: **0.5% 초과** 시 상태 전이표 보강
- quarantine age: P1 도메인은 **30분 초과** 시 온콜 알림

여기서 endpoint p95만 보면 안 됩니다. endpoint가 빠르게 2xx를 반환해도 processing lag가 쌓이면 실제 비즈니스 상태는 늦게 반영됩니다. 반대로 processing worker가 실패해도 endpoint는 정상처럼 보일 수 있습니다. 반드시 `accepted`, `processed`, `quarantined`, `replayed`, `rejected`를 따로 집계합니다.

### 4) Key rotation과 provider account mapping

Webhook secret은 반드시 회전할 수 있어야 합니다. 단일 secret을 코드나 환경변수에 박아두면 provider가 회전을 요구할 때 배포와 장애 대응이 꼬입니다. 최소 설계는 `secret_version`과 `active_from`, `active_until`을 둔 key store입니다.

회전 기준:

- 새 key 등록 후 **24~72시간** dual verification 허용
- 이전 key로 들어온 traffic 비율이 **0건**으로 24시간 유지되면 폐기
- 서명 실패가 회전 직후 1%를 넘으면 즉시 rollback 또는 provider 설정 확인
- provider account별 key를 분리해, 한 고객/파트너의 key 유출이 전체 endpoint로 번지지 않게 함

Provider account mapping도 중요합니다. 같은 Stripe, GitHub, Slack 같은 provider라도 고객별 account, installation, workspace가 다릅니다. 이벤트가 어떤 tenant로 들어와야 하는지 검증하지 않으면 다른 고객의 이벤트를 잘못 반영할 수 있습니다. mapping 실패는 조용히 무시하지 말고 `unknown_account`로 남겨야 합니다.

### 5) 테스트 시나리오

Webhook receiver는 happy path보다 실패 케이스 테스트가 더 중요합니다.

- raw body 공백만 바뀐 경우 서명 실패
- timestamp가 10분 지난 정상 서명 요청 거부
- 같은 event id와 같은 payload 재전송은 2xx
- 같은 event id와 다른 payload는 quarantine
- `payment_succeeded`가 두 번 와도 포인트·메일·상태 변경은 한 번만 실행
- `CANCELED` 주문에 늦은 `payment_succeeded`가 오면 자동 전이하지 않음
- inbox 저장 실패 시 5xx를 반환해 provider가 재전송하게 함
- worker 실패 후 재처리해도 외부 효과가 중복되지 않음

이 테스트는 단위 테스트만으로 끝내지 말고 provider sandbox payload를 fixture로 저장해 regression test에 넣는 편이 좋습니다. 특히 provider가 API 버전을 바꿀 때 필드가 추가되거나 enum이 늘어나는 경우가 많습니다.

## 트레이드오프/주의점

첫째, raw payload 저장은 디버깅에는 좋지만 개인정보 리스크를 키웁니다. 원문을 오래 보관하면 나중에 "왜 이 값이 로그와 DB와 object storage 세 군데에 있나"라는 문제가 생깁니다. 기본값은 짧은 보관, 암호화, 접근 감사입니다. 필요하면 payload hash와 주요 business key만 장기 보관합니다.

둘째, 2xx 조기 반환은 provider retry 폭주를 줄이지만 내부 처리 실패를 숨길 수 있습니다. 그래서 accepted metric과 processed metric을 분리해야 합니다. 운영 대시보드에서 `2xx rate`만 보고 있으면 실제 결제 상태 반영 지연을 놓칩니다.

셋째, 모든 이벤트를 provider 상태 재조회로 검증하면 정확성은 올라가지만 비용과 지연이 늘어납니다. 금전, 권한, 구독 종료처럼 되돌리기 어려운 이벤트는 재조회가 맞고, 단순 마케팅 알림이나 비핵심 profile update는 inbox와 멱등 처리만으로 충분할 수 있습니다.

넷째, replay window를 길게 잡으면 저장 비용이 늘고, 짧게 잡으면 장애 상황에서 중복 처리가 새 이벤트처럼 보입니다. 비용보다 사고 복구 비용이 큰 결제·정산 도메인은 길게 잡는 편이 낫습니다.

다섯째, provider마다 webhook 계약이 다릅니다. 어떤 provider는 event ordering을 보장하지 않고, 어떤 provider는 account id를 header에 두고, 어떤 provider는 payload 안에만 둡니다. 공통 receiver framework를 만들더라도 provider adapter에는 각 계약을 명시해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 수신 endpoint가 raw body 기준으로 HMAC 서명을 검증한다.
- [ ] timestamp 허용 오차와 replay window가 provider별로 문서화되어 있다.
- [ ] `provider + provider_account_id + event_id`에 unique constraint가 있다.
- [ ] 같은 event id와 다른 payload hash는 자동 처리하지 않고 quarantine한다.
- [ ] endpoint 2xx는 inbox 저장 성공을 의미하고, business processing 성공과 분리되어 있다.
- [ ] 결제·권한·구독 종료 같은 고위험 이벤트는 상태 전이표와 provider 재조회 기준이 있다.
- [ ] key rotation 중 dual verification 기간과 폐기 조건이 숫자로 정해져 있다.
- [ ] raw payload 보관 기간, 암호화, 접근 감사 정책이 있다.
- [ ] accepted, processed, replayed, rejected, quarantined 지표가 따로 보인다.

### 연습

1. 현재 서비스에서 외부 webhook 1개를 골라, endpoint 안에서 하는 일을 `검증`, `저장`, `응답`, `처리`, `재처리`로 나눠 보세요. 네 단계 이상이 한 함수에 섞여 있으면 분리 후보입니다.
2. 최근 30일 webhook 로그에서 duplicate replay rate, signature failure rate, processing lag p95를 계산해 보세요. 기준선이 없으면 장애 때 "많다/적다"를 판단할 수 없습니다.
3. `PAID`, `CANCELED`, `REFUNDED` 같은 주문 상태 전이표를 만들고, 늦게 도착한 `payment_succeeded`가 어떤 상태에서는 무시되고 어떤 상태에서는 수동 검토로 가야 하는지 적어 보세요.
4. Provider secret rotation runbook을 작성해 보세요. 새 key 등록, dual verification 기간, 이전 key 폐기, 실패율 알림, rollback 조건을 포함하면 됩니다.
