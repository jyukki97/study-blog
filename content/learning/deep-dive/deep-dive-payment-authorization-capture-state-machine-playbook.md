---
title: "백엔드 커리큘럼 심화: 결제 승인·캡처 상태 머신, 중복 차감과 유령 주문을 막는 법"
date: 2026-08-05
draft: false
topic: "Architecture"
tags: ["Payment", "State Machine", "Idempotency", "Ledger", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "결제 authorize/capture/cancel/refund 흐름을 상태 머신, 원장, 멱등 키, reconciliation 기준으로 설계하는 실무 플레이북입니다."
module: "data-system"
study_order: 1480
---

결제 시스템에서 가장 무서운 장애는 "실패처럼 보였는데 돈은 빠져나간 상태"입니다. 반대로 "성공처럼 보였는데 매입이 되지 않아 매출이 사라진 상태"도 있습니다. 둘 다 단순 API 오류가 아닙니다. 주문, 결제 대행사, 카드사, 재고, 쿠폰, 정산 시스템이 서로 다른 시점에 상태를 바꾸기 때문에 생기는 분산 상태 문제입니다.

그래서 결제 흐름은 `status` 컬럼 몇 개로 처리하면 금방 한계가 옵니다. 승인, 매입, 승인 취소, 환불, 부분 환불, 타임아웃, 웹훅 지연, 수동 보정이 모두 같은 테이블을 건드리기 시작하면 "이 상태에서 이 액션이 가능한가"를 코드만 보고 판단하기 어렵습니다. 필요한 것은 **결제 상태 머신 + 불변 원장 + 멱등 실행 계약 + 대사 파이프라인**입니다.

이 글은 [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/), [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)과 이어집니다. 결제 도메인을 예시로 들지만, 재고 선점, 쿠폰 차감, 포인트 사용, 예약 확정처럼 되돌리기 어려운 쓰기 경로에도 같은 사고방식을 적용할 수 있습니다.

## 이 글에서 얻는 것

- 결제 승인(authorize), 매입(capture), 취소(cancel), 환불(refund)을 하나의 명시적 상태 머신으로 설계하는 기준을 얻습니다.
- PG/API 타임아웃, 웹훅 지연, 중복 요청, 부분 환불 같은 현실적인 실패를 상태 전이와 원장으로 흡수하는 방법을 정리합니다.
- 자동 재시도, 사용자 재시도, 운영자 보정, reconciliation job의 권한 경계를 숫자와 조건으로 나눌 수 있습니다.
- 주문 성공률만 보는 결제 운영에서 벗어나, 유령 주문·중복 차감·미매입 매출을 조기에 찾는 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 승인과 매입은 같은 성공이 아니다

많은 초급 구현은 결제 API가 성공하면 바로 `PAID`로 바꿉니다. 하지만 카드 결제 흐름에서는 승인과 매입을 분리해서 봐야 합니다.

- **Authorize**: 한도를 확보하고 결제 가능성을 확인한다.
- **Capture**: 실제 매출로 확정한다.
- **Cancel/Void**: 아직 매입 전인 승인을 취소한다.
- **Refund**: 이미 매입된 금액을 돌려준다.

쇼핑몰에서는 주문 생성 직후 승인만 하고, 재고 확정·배송 준비 단계에서 매입할 수 있습니다. 디지털 상품처럼 즉시 제공되는 서비스는 authorize와 capture를 붙여 처리할 수도 있습니다. 중요한 것은 "우리 서비스가 어떤 모델인지"를 먼저 정하는 것입니다.

의사결정 기준은 다음처럼 잡을 수 있습니다.

| 서비스 유형 | 권장 흐름 | 이유 |
| --- | --- | --- |
| 즉시 제공 디지털 상품 | authorize + capture 동시 | 재고/배송 지연이 없어 매입 지연 이득이 작다 |
| 물류/예약/재고 확인 필요 | authorize 후 capture 지연 | 재고 실패 시 승인 취소로 비용과 CS를 줄인다 |
| 고액 B2B 주문 | authorize 후 사람/정책 승인 뒤 capture | fraud, 한도, 계약 조건 검증이 필요하다 |
| 부분 배송 가능 주문 | line item별 partial capture | 전체 주문보다 품목 단위 정산이 안전하다 |

승인과 매입을 섞으면 장애 대응이 어려워집니다. 예를 들어 승인 성공 후 재고 확정이 실패했는데 이미 매입했다면 환불 프로세스가 필요합니다. 반대로 승인만 된 주문을 `PAID`처럼 보여주면 사용자는 상품 제공을 기대하지만 실제 매출은 아직 확정되지 않았습니다.

### 2) 결제 상태는 "현재 상태"와 "사실 기록"을 분리해야 한다

운영 화면에는 현재 결제 상태가 필요합니다. 하지만 정산과 복구에는 상태 변경 이력이 필요합니다. 그래서 최소한 두 계층으로 나누는 것이 안전합니다.

- `payment_attempt`: 현재 시도 상태, provider id, 마지막 에러, 다음 조치
- `payment_ledger`: 승인/매입/취소/환불/보정 이벤트의 불변 기록

예시 상태는 아래처럼 시작할 수 있습니다.

```text
INITIATED
  -> AUTHORIZING
  -> AUTHORIZED
  -> CAPTURING
  -> CAPTURED
  -> CANCELING
  -> CANCELED
  -> REFUNDING
  -> REFUNDED
  -> FAILED
  -> UNKNOWN_REQUIRES_RECONCILIATION
```

여기서 `UNKNOWN_REQUIRES_RECONCILIATION`이 중요합니다. 외부 PG 호출이 타임아웃되면 성공인지 실패인지 모를 수 있습니다. 이 상태를 `FAILED`로 닫고 사용자에게 다시 결제하게 만들면 중복 승인 가능성이 생깁니다. 반대로 성공으로 가정하면 상품 제공과 정산이 어긋날 수 있습니다. 모르는 상태는 모른다고 표시하고, provider 조회와 대사 job으로 닫아야 합니다.

이 구조는 [API Error Semantics](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)와도 맞닿아 있습니다. 결제 실패 메시지는 "재시도하세요" 한 줄이 아니라, 재시도 가능한 실패인지, 확인 중인지, 운영자 조치가 필요한지 구분해야 합니다.

### 3) 멱등 키는 주문 ID 하나로 끝나지 않는다

결제에서 멱등 키를 `order_id` 하나로 잡으면 곧 막힙니다. 한 주문에 여러 결제 시도가 있을 수 있고, 같은 결제 시도 안에서도 승인, 매입, 환불은 서로 다른 부작용입니다.

권장 키는 액션 단위로 나눕니다.

| 액션 | 멱등 키 예시 | 중복 방지 대상 |
| --- | --- | --- |
| authorize | `payment_attempt_id + authorize` | 같은 결제 시도 중복 승인 |
| capture | `payment_attempt_id + capture + amount` | 같은 금액 중복 매입 |
| cancel | `payment_attempt_id + cancel` | 승인 취소 중복 호출 |
| refund | `refund_id` 또는 `payment_attempt_id + refund_seq` | 환불 중복 지급 |
| webhook ingest | `provider_event_id` | 외부 이벤트 중복 소비 |

사용자 브라우저가 새로고침하거나 모바일 앱이 네트워크 오류 후 같은 요청을 다시 보내도, 서버는 같은 멱등 키면 기존 결과를 반환해야 합니다. 단, payload hash가 달라졌다면 409로 막는 편이 안전합니다. 같은 키로 10,000원 승인 후 12,000원 승인 요청이 들어오면 "같은 요청 재시도"가 아니라 충돌입니다.

멱등 처리는 API 계층만으로 부족합니다. DB에는 unique 제약이 있어야 하고, 외부 PG 호출 전후의 상태 전이도 원자적으로 보호해야 합니다. 이 부분은 [UPSERT와 UNIQUE 제약](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/), [DB 락 경합 대응](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)과 같이 설계해야 합니다.

### 4) 웹훅은 정답이 아니라 늦게 도착하는 증거다

PG 웹훅은 중요하지만 웹훅만 믿으면 안 됩니다. 웹훅은 중복될 수 있고, 순서가 바뀔 수 있고, 지연될 수 있고, 운영 설정 오류로 누락될 수 있습니다. 따라서 웹훅 처리는 "상태를 바로 덮어쓰기"가 아니라 "provider event를 원장에 적재하고 허용 전이를 평가"하는 흐름이어야 합니다.

예를 들어 `CAPTURED` 상태에 늦은 `AUTHORIZED` 웹훅이 도착했다면 상태를 되돌리면 안 됩니다. 이미 capture 원장이 있다면 authorized 웹훅은 관측 이력으로만 남깁니다. 반대로 `AUTHORIZING` 상태에서 provider의 authorization success 웹훅이 도착하면 `AUTHORIZED`로 전이할 수 있습니다.

웹훅 처리 기준:

- provider event id는 unique로 저장한다.
- 같은 event가 2번 오면 두 번째는 no-op으로 ack한다.
- 상태 전이는 허용표를 통과할 때만 수행한다.
- 금액, 통화, merchant account, order id가 내부 기록과 다르면 quarantine한다.
- 고위험 이벤트는 provider 조회 API로 재확인한다.

이 규칙은 [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/)의 결제 버전입니다. 결제·권한·구독 종료 같은 고위험 웹훅은 "받았다"와 "믿는다" 사이에 검증 단계를 둬야 합니다.

## 실무 적용

### 1) 최소 데이터 모델

처음부터 거대한 결제 플랫폼을 만들 필요는 없습니다. 하지만 아래 필드는 초기에 넣는 편이 좋습니다.

```sql
create table payment_attempt (
  payment_attempt_id varchar(64) primary key,
  order_id varchar(64) not null,
  customer_id varchar(64) not null,
  provider varchar(32) not null,
  provider_payment_id varchar(128),
  status varchar(48) not null,
  amount numeric(20, 2) not null,
  currency char(3) not null,
  idempotency_key varchar(128) not null,
  payload_hash varchar(128) not null,
  last_error_code varchar(64),
  next_reconcile_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index ux_payment_attempt_idempotency
  on payment_attempt (provider, idempotency_key);

create table payment_ledger (
  ledger_id varchar(64) primary key,
  payment_attempt_id varchar(64) not null,
  event_type varchar(48) not null,
  amount numeric(20, 2) not null,
  currency char(3) not null,
  provider_event_id varchar(128),
  source varchar(32) not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null
);
```

`payment_attempt`는 빠른 조회와 운영 화면을 위한 현재 상태입니다. `payment_ledger`는 정산과 감사, 대사를 위한 사실 기록입니다. status를 고칠 수는 있어도 ledger를 지우면 안 됩니다. 잘못된 이벤트는 삭제가 아니라 correction event로 보정합니다.

### 2) 상태 전이표를 코드와 문서 양쪽에 둔다

상태 전이는 리뷰 가능한 표로 관리해야 합니다.

| 현재 상태 | 액션 | 다음 상태 | 조건 |
| --- | --- | --- | --- |
| `INITIATED` | authorize 요청 | `AUTHORIZING` | idempotency key 신규 |
| `AUTHORIZING` | provider 승인 성공 | `AUTHORIZED` | amount/currency 일치 |
| `AUTHORIZING` | provider 타임아웃 | `UNKNOWN_REQUIRES_RECONCILIATION` | provider_payment_id 있거나 확인 불가 |
| `AUTHORIZED` | capture 요청 | `CAPTURING` | 재고/주문 확정 완료 |
| `CAPTURING` | capture 성공 | `CAPTURED` | provider capture id 저장 |
| `AUTHORIZED` | cancel 요청 | `CANCELING` | capture 전 |
| `CAPTURED` | refund 요청 | `REFUNDING` | refund amount <= captured balance |
| `UNKNOWN_REQUIRES_RECONCILIATION` | provider 조회 성공 | `AUTHORIZED` 또는 `CAPTURED` | 외부 상태 기준 |

전이표 없이 if 문으로만 처리하면 운영자 보정, 웹훅, 재시도 job이 서로 다른 규칙을 가질 가능성이 큽니다. 결제 같은 고위험 도메인에서는 상태 전이 함수를 하나로 모으고, 허용되지 않은 전이는 409 또는 quarantine으로 닫는 편이 안전합니다.

### 3) 타임아웃은 실패가 아니라 확인 필요로 분류한다

결제 provider 호출에서 가장 위험한 응답은 500보다 timeout입니다. 500은 provider가 실패를 명시했을 가능성이 있지만, timeout은 네트워크가 끊긴 것인지 provider가 처리 후 응답만 못 준 것인지 알 수 없습니다.

운영 기준:

- authorize/capture write timeout은 즉시 `FAILED`로 닫지 않는다.
- provider payment id가 있으면 1차 조회를 5~30초 안에 예약한다.
- 3회 조회 실패 또는 5분 이상 미확정이면 `UNKNOWN_REQUIRES_RECONCILIATION`으로 운영 알림을 올린다.
- 같은 order에서 새 결제 시도는 기존 attempt가 확정될 때까지 기본 차단한다.
- 사용자에게는 "결제 확인 중" 상태를 보여주고, 중복 결제 버튼은 비활성화한다.

숫자는 서비스에 맞게 조정할 수 있습니다. 다만 고액 결제나 재고 소진 상품에서는 확인 지연을 줄이기보다 중복 차감 방지를 우선해야 합니다. 결제 확인 중 화면에서 30초를 기다리게 하는 것이 중복 결제 환불보다 싸고 안전한 경우가 많습니다.

### 4) 자동 재시도와 사람 재시도 경계를 나눈다

모든 실패를 자동 재시도하면 provider 장애 때 폭주가 납니다. 반대로 아무것도 재시도하지 않으면 사용자가 반복 클릭하게 됩니다.

권장 기준:

| 실패 유형 | 재시도 정책 |
| --- | --- |
| 네트워크 read timeout | provider 조회 후 상태 확정, write 재호출은 보수적 |
| 429/rate limit | exponential backoff + jitter, 사용자 재시도 제한 |
| 4xx 카드 거절 | 자동 재시도 금지, 결제수단 변경 안내 |
| provider 5xx | 멱등 키 유지, 최대 2~3회, 총 2분 이내 |
| amount/currency mismatch | 즉시 quarantine, 자동 복구 금지 |

재시도는 [Timeout·Retry·Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)처럼 기술 문제로만 보면 부족합니다. 결제에서는 재시도 1회가 금전 부작용 1회를 의미할 수 있습니다. 그래서 "재시도 가능한 실패"의 정의를 결제 액션별로 나눠야 합니다.

### 5) 대사 job은 결제의 안전망이다

실시간 경로가 아무리 좋아도 결제에는 대사 job이 필요합니다. 웹훅이 누락될 수 있고, 내부 트랜잭션은 성공했지만 provider 반영은 실패했을 수 있고, 운영자가 수동 처리한 건이 나중에 들어올 수 있습니다.

초기 대사 범위:

- 최근 24시간 `UNKNOWN_REQUIRES_RECONCILIATION`
- `AUTHORIZED` 상태로 30분 이상 머문 주문
- `CAPTURING` 상태로 5분 이상 머문 결제
- 내부 `CAPTURED`인데 provider settlement에는 없는 건
- provider에는 captured인데 내부 주문은 미확정인 건
- refund 요청 금액과 provider refund balance가 다른 건

대사 결과는 세 가지로 나눕니다.

- 자동 전이 가능: provider와 내부 값이 일치하고 허용 전이가 명확함
- 자동 보정 가능: 금액 차이가 0이고 상태만 늦게 따라온 경우
- 사람 승인 필요: 금액, 통화, 결제수단, 환불 잔액, 회계 마감 구간이 걸린 경우

이때도 목표는 "모든 건 자동 처리"가 아닙니다. 금전 도메인의 우선순위는 **오복구 방지 > 중복 차감 방지 > 빠른 확정 > 운영 편의성**입니다.

## 트레이드오프/주의점

첫째, 상태 머신은 코드량을 늘립니다. 단순 CRUD보다 테이블과 전이 함수, 테스트가 늘어납니다. 하지만 결제 흐름은 어차피 복잡합니다. 복잡도를 감추면 운영자가 장애 때 추측하게 되고, 드러내면 테스트와 대사 job이 다룰 수 있습니다.

둘째, 승인과 매입을 분리하면 사용자 경험이 길어질 수 있습니다. 즉시 제공 서비스에서는 authorize/capture를 붙이는 편이 낫습니다. 반대로 배송·예약·재고 검증이 있는 서비스에서는 분리 비용보다 잘못 매입 후 환불하는 비용이 큽니다.

셋째, provider 조회를 자주 하면 비용과 quota 문제가 생깁니다. 모든 결제를 매초 확인하기보다 위험 상태만 좁혀 조회해야 합니다. 예를 들어 `UNKNOWN`과 장시간 `AUTHORIZING/CAPTURING`만 조회하고, 정상 `CAPTURED`는 일 배치 settlement 대사로 충분할 수 있습니다.

넷째, 운영자 보정 권한을 너무 쉽게 열면 내부 사고가 됩니다. 결제 상태를 수동으로 바꾸는 기능에는 [Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/), 실행 영수증, 2인 승인, 사후 리뷰가 필요합니다. 특히 환불과 정산 보정은 감사 로그 없이는 운영 기능으로 두면 안 됩니다.

다섯째, 재고·쿠폰·포인트와 결제 상태를 하나의 분산 트랜잭션처럼 묶으려 하면 시스템이 무거워집니다. 대부분의 서비스에서는 강한 2PC보다 saga, outbox, compensation, reconciliation 조합이 현실적입니다. 이 판단은 [Distributed Transactions](/learning/deep-dive/deep-dive-distributed-transactions/)와 함께 봐야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] authorize, capture, cancel, refund를 각각 별도 액션과 멱등 키로 정의했다.
- [ ] provider write timeout을 `FAILED`가 아니라 확인 필요 상태로 분류한다.
- [ ] 상태 전이표가 문서와 코드 테스트 양쪽에 존재한다.
- [ ] payment ledger가 불변 이벤트로 남고 correction은 삭제가 아니라 보정 이벤트로 처리된다.
- [ ] 웹훅은 provider event id unique, amount/currency 검증, 허용 전이 검사를 통과해야 상태를 바꾼다.
- [ ] `UNKNOWN`, 장시간 `AUTHORIZED`, 장시간 `CAPTURING` 상태를 찾는 reconciliation job이 있다.
- [ ] 수동 환불·상태 보정에는 2인 승인 또는 사후 리뷰 기준이 있다.

### 연습 과제

1. 현재 서비스의 결제 흐름을 `INITIATED -> AUTHORIZED -> CAPTURED` 형태의 전이표로 그려 보세요. 실패 상태와 확인 필요 상태를 최소 3개 이상 추가해야 합니다.
2. 같은 사용자가 결제 버튼을 3번 누르고, 첫 번째 provider 호출은 timeout, 두 번째는 success, 세 번째는 duplicate인 시나리오를 테스트 케이스로 작성해 보세요.
3. `AUTHORIZED` 상태로 30분 이상 남은 결제 100건이 발견됐다고 가정하고, 자동 취소·provider 조회·운영자 승인 중 어떤 기준으로 나눌지 정책표를 만들어 보세요.

## 관련 글

- [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/)
- [멱등성 설계와 중복 요청 제어](/learning/deep-dive/deep-dive-idempotency/)
- [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
- [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/)
- [API Error Semantics](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)
