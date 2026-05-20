---
title: "백엔드 커리큘럼 심화: UPSERT, UNIQUE 제약, 멱등 키를 쓰기 경로 기준으로 고르는 법"
date: 2026-05-04
draft: false
topic: "Data Engineering"
tags: ["UPSERT", "UNIQUE Constraint", "Idempotency", "PostgreSQL", "MySQL", "Write Path", "Concurrency"]
categories: ["Backend Deep Dive"]
description: "중복 요청과 재처리를 막을 때 UPSERT, UNIQUE 제약, 멱등 키를 언제 어떻게 조합해야 하는지 쓰기 경로 기준으로 정리합니다."
module: "backend-data-system"
study_order: 1189
---

백엔드에서 중복 쓰기 문제는 생각보다 평범한 곳에서 터집니다. 사용자가 결제 버튼을 두 번 누르거나, 모바일 네트워크가 흔들려 같은 요청을 재전송하거나, 큐 컨슈머가 timeout 뒤 같은 메시지를 다시 받아도 문제는 곧바로 생깁니다. 많은 팀이 여기서 `UPSERT 쓰면 끝 아닌가요?`, `UNIQUE 제약만 걸면 되지 않나요?`라고 묻습니다. 그런데 실무에서는 이 셋이 같은 문제가 아닙니다. **DB에 같은 row를 두 번 넣지 않는 것**, **같은 비즈니스 효과를 두 번 내지 않는 것**, **재시도와 재처리를 운영 가능한 비용으로 흡수하는 것**은 서로 다른 레벨의 문제입니다.

그래서 이 글은 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [Transactional Inbox와 Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/), [Optimistic Lock, Pessimistic Lock, Atomic Update 선택 기준](/learning/deep-dive/deep-dive-optimistic-pessimistic-atomic-update-playbook/), [Timeout, Retry, Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)를 잇는 관점으로, **UPSERT, UNIQUE 제약, 멱등 키를 어떤 쓰기 경로에 어떻게 배치해야 하는지**를 정리합니다.

## 이 글에서 얻는 것

- `UNIQUE`, `INSERT ... ON CONFLICT`, `idempotency key`가 각각 막는 문제의 범위를 구분할 수 있습니다.
- 생성, 상태 전이, 외부 연동, 이벤트 소비처럼 다른 쓰기 경로에 어떤 기본 전략을 두는지 판단할 수 있습니다.
- 중복 요청 방지 설계를 감으로 하지 않고 `duplicate_request_rate`, `conflict_rate`, `replay_window`, `side_effect_cost` 같은 운영 기준으로 설명할 수 있습니다.
- "DB 중복은 막았는데 외부 결제는 두 번 나간" 종류의 사고를 줄이기 위한 우선순위를 세울 수 있습니다.

## 핵심 개념/이슈

### 1) 세 가지는 이름이 비슷해 보여도 책임이 다르다

먼저 가장 중요한 구분부터 잡아야 합니다.

- **UNIQUE 제약**: 같은 비즈니스 키가 테이블에 중복 저장되는 것을 막습니다.
- **UPSERT**: 중복이 들어오면 에러 대신 `무시`하거나 `업데이트`하는 저장 동작입니다.
- **멱등 키(idempotency key)**: 같은 요청이나 같은 이벤트가 다시 들어와도 **비즈니스 효과를 한 번만 내도록** 보장하는 장치입니다.

예를 들어 `orders(order_id)`에 UNIQUE를 걸면 같은 `order_id` row는 두 번 안 들어갑니다. 하지만 같은 결제 승인 API를 두 번 불러 외부 PG에 두 번 청구했다면, DB UNIQUE만으로는 이미 늦습니다. 반대로 멱등 키를 잘 설계해도 내부 집계 테이블에서 중복 row가 생기면 운영 비용이 커집니다. 즉 이 셋은 대체 관계가 아니라 **서로 다른 층을 막는 조합 부품**에 가깝습니다.

### 2) UPSERT는 "중복 생성 방지"에는 강하지만 "중복 효과 방지"까지 자동으로 해결하지 않는다

`INSERT ... ON CONFLICT DO NOTHING` 또는 `DO UPDATE`는 실무에서 아주 강력한 도구입니다. 특히 비동기 소비자나 배치 적재처럼 같은 레코드가 다시 들어와도 결과만 맞으면 되는 경로에서 효과가 큽니다.

```sql
INSERT INTO user_profiles (user_id, nickname, updated_at)
VALUES (:user_id, :nickname, now())
ON CONFLICT (user_id) DO UPDATE
SET nickname = EXCLUDED.nickname,
    updated_at = now();
```

이 패턴이 잘 맞는 경우는 아래와 같습니다.

- 최종 상태만 맞으면 되는 **동기화/반영형 write**
- 재처리 시 같은 row를 덮어써도 부작용이 거의 없는 **read model**
- 컨슈머가 같은 이벤트를 다시 받아도 row 상태만 동일하면 충분한 **집계/캐시성 저장소**

하지만 주의점이 있습니다. `DO NOTHING`은 너무 쉽게 **침묵 실패**를 만듭니다. 진짜 중복이라 괜찮은 것과, 예상 밖 데이터 충돌이라 조사해야 하는 것을 한 줄로 묻어버릴 수 있습니다. 그래서 `conflict_rate`가 **0.1% 미만**일 때는 대개 정상 재시도로 볼 수 있지만, 갑자기 **1%를 넘기기 시작하면** API 재전송 버그나 producer 중복 발행을 의심하는 편이 안전합니다.

### 3) UNIQUE 제약은 마지막 방어선으로는 좋지만, 단독 전략으로는 자주 부족하다

UNIQUE 제약은 생각보다 과소평가되지만, 실제로는 가장 믿을 만한 마지막 방어선 중 하나입니다. 애플리케이션 레벨에서 중복 체크를 먼저 하더라도 race condition 때문에 결국 DB 제약이 있어야 합니다. 예를 들어 아래 같은 흐름은 전형적으로 깨집니다.

1. 요청 A가 `SELECT`로 기존 row 없음 확인
2. 요청 B도 같은 시점에 row 없음 확인
3. 둘 다 `INSERT` 시도
4. 제약이 없으면 중복 row 생성

그래서 **비즈니스 키가 명확한 생성 경로는 UNIQUE를 기본값으로 두는 편이 맞습니다.** 이메일, 주문번호, 외부 이벤트 ID, 정산 기준키처럼 "중복되면 안 되는 식별자"는 애플리케이션 체크보다 제약조건이 먼저입니다.

다만 UNIQUE만으로 충분한 경우는 제한적입니다.

- 같은 row 중복 저장만 막고 싶다 → 충분할 수 있음
- 외부 API 호출, 이메일 발송, PG 승인처럼 **부수효과(side effect)** 가 있다 → 부족함
- 기존 row를 갱신할지, 무시할지, 버전 비교할지 판단이 필요하다 → UPSERT 또는 상태 머신이 필요함

즉 UNIQUE는 기본 골조이고, 실제 write semantics는 그 위에 더 얹어야 합니다.

### 4) 멱등 키는 외부 효과와 재시도 창을 다룰 때 본체가 된다

멱등 키가 특히 중요한 건 **같은 요청이 다시 들어왔을 때 결과를 재사용해야 하는 경로**입니다. 결제 생성, 주문 생성, 발송 요청, webhook 수신 같은 경로가 대표적입니다.

핵심 질문은 이겁니다. "같은 요청이 3초 뒤에 다시 오면, 새 작업으로 봐야 하나, 이전 작업의 재시도로 봐야 하나?"

이 질문에 후자라고 답해야 한다면 멱등 키가 필요합니다. 예를 들어 결제 생성 API는 아래 같은 저장소를 둘 수 있습니다.

```sql
CREATE TABLE api_idempotency_keys (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  request_hash TEXT NOT NULL,
  response_code INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL
);
```

흐름은 보통 이렇습니다.

1. 요청이 오면 `idempotency_key` 확인
2. 키가 없으면 작업 시작, 있으면 기존 결과 반환
3. 단, 같은 키인데 payload가 다르면 바로 거절
4. 성공/실패 결과를 저장해 재시도 시 같은 응답을 재사용

실무 기준으로는 `replay_window`를 비즈니스 재시도 창보다 길게 잡는 편이 안전합니다. 모바일/결제/외부 webhook은 보통 **24시간 재시도 가능성**을 보고, 키 보관은 **48~72시간 이상**으로 두는 경우가 많습니다. TTL을 너무 짧게 두면 중복 방지가 "되는 것처럼 보이다가" 실제 장애 상황에서만 풀립니다.

### 5) 상태 전이와 외부 연동은 "UPSERT만으로는 위험"한 대표 구간이다

주문 상태를 `PENDING -> PAID`로 바꾸거나, 결제 승인 후 이메일 발송과 정산 적재를 이어 붙이는 경로는 단순 `UPSERT`보다 더 조심해야 합니다. 이유는 두 가지입니다.

첫째, **상태 전이는 방향성이 있습니다.** 이미 `PAID`인 주문에 예전 이벤트가 다시 와서 `PENDING` 계열 정보를 덮어쓰면 안 됩니다. 이때는 버전 비교, 상태 전이 조건, [Snapshot Isolation/Serializable 판단](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)이 같이 들어갑니다.

둘째, **외부 효과는 DB row와 다른 수명주기를 가집니다.** DB에는 한 번만 저장됐어도, 외부 PG 승인이나 메일 발송이 두 번 나가면 사고입니다. 그래서 이 경로는 보통 아래 우선순위가 안전합니다.

1. 외부 호출 요청 자체에 멱등 키 부여
2. 내부 상태 전이는 `WHERE current_state = 'PENDING'` 같은 조건부 update로 보호
3. 결과 이벤트는 [Transactional Outbox](/learning/deep-dive/deep-dive-transactional-outbox-cdc/) 또는 inbox 패턴으로 분리
4. 재시도 정책은 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/) 기준에 맞춰 상한을 둠

즉 상태 전이와 외부 연동은 "DB 중복만 없으면 된다" 수준으로 보면 거의 항상 부족합니다.

## 실무 적용

### 1) 쓰기 경로별 추천 기본값

| 쓰기 경로 | 우선 전략 | 이유 | 추가 주의점 |
| --- | --- | --- | --- |
| 회원가입, 주문 생성, 단일 비즈니스 키 생성 | UNIQUE + 명시적 에러 처리 | 중복 생성 차단이 핵심 | 사용자 메시지와 재시도 UX 필요 |
| 읽기 모델 반영, 집계 테이블 갱신 | UPSERT | 최종 상태 수렴이 목적 | `DO NOTHING` 남용 금지 |
| 결제/발송/외부 API 생성 | 멱등 키 + UNIQUE 보조 | 외부 효과 한 번 보장 필요 | TTL, payload hash 검증 필수 |
| 큐 컨슈머 재처리 | inbox 또는 멱등 키 + UPSERT | at-least-once 흡수 | 순서 역전, poison message 점검 |
| 상태 전이(`PENDING -> DONE`) | 조건부 update + 멱등 키 | 잘못된 역전 방지 | 영향 행 수 0 해석 필요 |

이 표에서 핵심은 **생성 경로, 수렴 경로, 외부 효과 경로를 같은 방식으로 다루지 않는 것**입니다.

### 2) 숫자로 보는 의사결정 기준

아래 기준으로 시작하면 꽤 실무적입니다.

- `duplicate_request_rate < 0.1%` 이고 부수효과 없음 → UNIQUE + 에러 처리로도 충분할 수 있음
- `duplicate_request_rate >= 0.3%` 또는 모바일/외부 네트워크 재시도 많음 → 멱등 키 기본 검토
- 외부 효과 1건의 비용이 크다(결제, 쿠폰, 발송) → 멱등 키 없이는 출시 보류에 가깝게 보기
- `conflict_rate >= 1%` 인데 `DO NOTHING`으로 묻고 있다 → 원인 분류 대시보드 추가
- 재시도 창이 24시간 이상이다 → idempotency key TTL은 최소 48시간 이상 검토
- 같은 키의 payload mismatch가 발생한다 → 단순 재시도가 아니라 클라이언트 버그 또는 재사용 오용으로 즉시 경보

우선순위는 보통 아래 순서가 안전합니다.

1. 중복 외부 효과를 막는다
2. DB 중복 row를 막는다
3. 재처리와 재시도 비용을 줄인다
4. 마지막에 write 경로 단순화를 최적화한다

### 3) 자주 쓰는 SQL 패턴

#### 패턴 A. 중복 생성 거절

```sql
INSERT INTO coupons (coupon_code, user_id, issued_at)
VALUES (:coupon_code, :user_id, now());
```

- `coupon_code`에 UNIQUE
- 중복이면 애플리케이션에서 409 또는 도메인 에러 처리
- "발급 시도 자체"를 사용자에게 명확히 알려야 할 때 적합

#### 패턴 B. 최종 상태 수렴 UPSERT

```sql
INSERT INTO user_daily_stats (user_id, stat_date, total_count, updated_at)
VALUES (:user_id, :stat_date, :count, now())
ON CONFLICT (user_id, stat_date) DO UPDATE
SET total_count = EXCLUDED.total_count,
    updated_at = now();
```

- 배치 재실행, 이벤트 재처리에 강함
- 단, overwrite가 안전한 컬럼인지 확인 필요

#### 패턴 C. 버전 조건부 UPSERT

```sql
INSERT INTO account_projection (account_id, version, status, balance)
VALUES (:account_id, :version, :status, :balance)
ON CONFLICT (account_id) DO UPDATE
SET version = EXCLUDED.version,
    status = EXCLUDED.status,
    balance = EXCLUDED.balance
WHERE account_projection.version < EXCLUDED.version;
```

- 순서 역전 방지
- out-of-order 이벤트 반영에 유용
- `rows_affected = 0`이면 예전 이벤트일 가능성 해석 필요

#### 패턴 D. 멱등 키 결과 재사용

- 동일 `idempotency_key` + 동일 payload hash → 기존 응답 반환
- 동일 키 + 다른 payload → 409 또는 422로 차단
- TTL 만료 후 재요청은 새 요청으로 처리하되, 고비용 API는 감사 로그 남김

### 4) 운영 지표 최소 세트

아래 지표는 실제로 많이 도움이 됩니다.

- `duplicate_request_rate`
- `idempotency_replay_hit_rate`
- `payload_mismatch_rate`
- `db_unique_violation_rate`
- `upsert_conflict_rate`
- `rows_affected_zero_rate` (조건부 update / versioned upsert)
- `side_effect_duplicate_detected`

특히 `idempotency_replay_hit_rate`가 너무 낮다고 무조건 좋은 건 아닙니다. 모바일 앱, webhook, 비동기 재처리가 많은 서비스에서는 적당한 replay가 정상일 수 있습니다. 반대로 `payload_mismatch_rate`는 거의 0에 가까워야 합니다. 이 값이 튀면 API 사용 규약이 깨지고 있다는 뜻입니다.

### 5) 2주 적용 플레이북

**1주차**
- 중복 쓰기 사고가 날 수 있는 경로 5개를 고릅니다.
- 각 경로를 `생성`, `상태 전이`, `외부 효과`, `이벤트 반영`으로 분류합니다.
- 현재 어떤 방어선이 있는지 적습니다. UNIQUE만 있는지, UPSERT만 있는지, 멱등 키가 있는지 확인합니다.

**2주차**
- 외부 효과가 있는 API 1개에 멱등 키 + payload hash 검증을 붙입니다.
- 이벤트 소비 경로 1개는 UPSERT 또는 inbox 패턴으로 재처리 안전성을 높입니다.
- 상태 전이 경로 1개는 조건부 update로 역전 방지를 넣습니다.
- 배포 후 `duplicate_request_rate`, `payload_mismatch_rate`, `rows_affected_zero_rate`를 비교합니다.

## 트레이드오프/주의점

첫째, **`DO NOTHING`은 간단하지만 관측성을 쉽게 잃습니다.** 진짜 정상 중복인지, 버그성 중복인지 분리할 로그와 메트릭이 없으면 나중에 원인 추적이 어려워집니다.

둘째, **UNIQUE 제약만으로 외부 효과를 보호할 수는 없습니다.** DB에 한 번만 저장됐어도 결제 승인, 메일 발송, webhook 전송이 두 번 나갈 수 있습니다.

셋째, **멱등 키 저장소 TTL을 짧게 두면 평시엔 멀쩡해 보여도 장애 때만 깨집니다.** 네트워크 지연, 사용자 재시도, provider 재전송 창을 실제보다 보수적으로 봐야 합니다.

넷째, **UPSERT는 덮어쓰기 semantics를 숨깁니다.** 최종 상태 수렴에는 좋지만, 감사 추적이나 상태 이력 보존이 중요한 도메인에서는 별도 원장 테이블이 필요할 수 있습니다.

다섯째, **조건부 update에서 `rows_affected = 0`은 그냥 실패가 아닐 수 있습니다.** 이미 처리된 요청인지, 오래된 이벤트인지, 진짜 경쟁 충돌인지 해석 규칙이 있어야 운영이 닫힙니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 생성 경로와 외부 효과 경로를 같은 중복 방지 방식으로 뭉개지 않았다.
- [ ] 비즈니스 키가 있는 생성은 UNIQUE 제약을 기본으로 둔다.
- [ ] 재처리성 반영 경로는 UPSERT overwrite semantics를 문서화했다.
- [ ] 외부 API/결제/발송 경로에는 멱등 키와 payload hash 검증이 있다.
- [ ] idempotency key TTL은 실제 재시도 창보다 길다.
- [ ] `DO NOTHING` 경로의 conflict rate를 모니터링한다.
- [ ] 상태 전이 경로는 조건부 update 또는 버전 검증이 있다.
- [ ] 중복 요청, payload mismatch, side effect duplicate 지표를 분리해서 본다.

### 연습 과제

1. 현재 서비스의 POST API 5개를 골라 `UNIQUE만 있으면 충분한가`, `UPSERT가 필요한가`, `멱등 키가 본체인가`로 분류해 보세요.
2. 같은 `idempotency_key`에 payload가 다른 요청이 들어왔을 때 어떤 응답을 줄지 API 계약으로 적어 보세요.
3. 이벤트 컨슈머 1개를 골라 `UPSERT`, `inbox`, `버전 조건부 update` 중 무엇이 맞는지 이유와 함께 정리해 보세요.
4. 최근 중복 발송, 중복 적재, 중복 승인 사고가 있었다면, 어느 레이어가 빠졌는지 포스트모템 형태로 써 보세요.

## 관련 글

- [멱등성 설계 완벽 가이드](/learning/deep-dive/deep-dive-idempotency/)
- [Transactional Inbox와 Idempotent Consumer 플레이북](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)
- [Optimistic Lock, Pessimistic Lock, Atomic Update 선택 기준](/learning/deep-dive/deep-dive-optimistic-pessimistic-atomic-update-playbook/)
- [Snapshot Isolation, Serializable, Write Skew 실무 판단](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)
- [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Timeout, Retry, Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Webhook 전달 신뢰성 플레이북](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)
- [백엔드 데이터 시스템 단계](/learning/modules/backend-data-system-phase/)
