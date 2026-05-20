---
title: "백엔드 커리큘럼 심화: Reservation Ledger와 Expiry Worker, 재고·좌석·쿠폰 선점을 안전하게 만료시키는 법"
date: 2026-05-20
draft: false
topic: "Backend Consistency"
tags: ["Reservation", "Ledger", "Expiry Worker", "Idempotency", "Distributed Systems", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "재고, 좌석, 쿠폰, 포인트처럼 먼저 잡아두고 나중에 확정하는 자원을 Reservation Ledger와 Expiry Worker로 안전하게 운영하는 기준을 상태 전이, TTL, 멱등성, 정산 관점에서 정리합니다."
module: "backend-distributed"
study_order: 1237
---

이커머스, 티켓팅, 숙박 예약, 쿠폰 발급, 포인트 차감 시스템에는 공통 문제가 있습니다. 사용자가 결제나 확정을 끝내기 전에 자원을 잠깐 잡아두어야 합니다. 장바구니에 담은 상품 재고를 바로 줄일지, 결제 페이지에 진입한 좌석을 몇 분 동안 묶을지, 쿠폰을 발급 요청 시점에 소진할지 확정 시점에 소진할지 같은 결정입니다. 이 구간을 대충 처리하면 oversell, ghost hold, 영구 잠금, 중복 차감이 생깁니다.

그래서 실무에서는 단순 `reserved_count += 1`보다 **Reservation Ledger**와 **Expiry Worker**를 같이 설계하는 편이 안전합니다. Reservation Ledger는 "누가 어떤 자원을 언제까지 어떤 이유로 선점했는가"를 원장처럼 남기고, Expiry Worker는 만료된 선점을 확정적으로 풀어줍니다. 이 글은 [멱등성 API 설계](/learning/deep-dive/deep-dive-idempotency/), [UPSERT·UNIQUE 제약·멱등 키](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/), [Advisory Lock 실무 플레이북](/learning/deep-dive/deep-dive-advisory-locks-coordination-playbook/), [분산 스케줄러 Singleton 실행 보장](/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/)과 함께 보면 좋습니다. 핵심은 자원을 잠그는 것이 아니라, **잠금이 반드시 끝나는 상태 전이**를 만드는 것입니다.

## 이 글에서 얻는 것

- 재고·좌석·쿠폰·포인트 선점을 단순 카운터가 아니라 상태 전이와 원장으로 모델링하는 기준을 잡을 수 있습니다.
- reservation TTL, confirm deadline, expiry batch size, retry budget 같은 숫자 기준을 세울 수 있습니다.
- confirm, cancel, expire가 동시에 들어와도 중복 차감이나 영구 선점이 생기지 않도록 멱등성과 fencing을 설계할 수 있습니다.
- 운영자가 ghost reservation과 oversell 위험을 빠르게 찾는 지표와 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Reservation은 lock이 아니라 비즈니스 약속이다

데이터베이스 lock은 트랜잭션 동안만 의미가 있습니다. 사용자가 결제 화면에서 5분 동안 고민하는 동안 DB row lock을 잡아두는 방식은 현실적이지 않습니다. 커넥션을 오래 점유하고, 장애가 나면 lock 해제가 불명확해지며, 다른 사용자의 처리량도 떨어집니다. Reservation은 기술적 lock이 아니라 "이 사용자가 이 자원을 특정 시각까지 우선 사용할 수 있다"는 비즈니스 약속으로 보는 편이 맞습니다.

따라서 reservation record에는 최소한 아래 정보가 있어야 합니다.

```yaml
reservation_id: rsv_20260520_0001
resource_type: inventory_sku
resource_id: sku_123
owner_id: user_987
quantity: 2
status: HELD
hold_until: 2026-05-20T10:16:00+09:00
idempotency_key: checkout:user_987:cart_456
version: 3
created_at: 2026-05-20T10:06:00+09:00
```

상태는 보통 `HELD → CONFIRMED`, `HELD → CANCELED`, `HELD → EXPIRED` 세 갈래로 갑니다. 이미 `CONFIRMED`된 reservation은 expire worker가 건드리면 안 되고, 이미 `EXPIRED`된 reservation을 결제 성공 콜백이 다시 confirm하면 안 됩니다. 그래서 상태 전이는 조건부 업데이트로 처리해야 합니다. 예를 들어 `UPDATE reservations SET status='CONFIRMED' WHERE reservation_id=? AND status='HELD' AND hold_until >= now()` 같은 식입니다. 업데이트된 row 수가 0이면 이미 늦었거나 다른 경로가 처리한 것입니다.

### 2) Ledger가 없으면 "왜 수량이 안 맞는지" 설명할 수 없다

단순히 상품 테이블에 `available`, `reserved`, `sold` 카운터만 두면 빠르게 구현할 수 있습니다. 하지만 장애 후에는 설명이 어렵습니다. 어떤 사용자가 어떤 요청으로 잡았는지, 결제 실패 후 풀렸는지, 만료 worker가 처리했는지, 재시도 때문에 두 번 차감됐는지 추적하기 힘듭니다. 그래서 수량이 중요한 도메인은 reservation을 원장처럼 남겨야 합니다.

추천 모델은 카운터와 ledger를 같이 쓰는 방식입니다.

| 구성 | 역할 | 주의점 |
| --- | --- | --- |
| resource summary | 빠른 가용 수량 조회 | ledger와 주기적으로 대조 필요 |
| reservation ledger | 선점·확정·취소·만료 이력 | append 또는 상태 전이 감사 로그 필요 |
| idempotency table | 중복 요청 차단 | business key 기준으로 잡아야 함 |
| expiry job state | 만료 worker 진행 위치 | 중복 실행·부분 실패 대비 필요 |

사용자 화면에는 summary가 필요하고, 운영 복구에는 ledger가 필요합니다. 두 값을 항상 완벽히 동기화하려고 하기보다, 쓰기 경로에서는 같은 트랜잭션에서 갱신하고, 이후에는 [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)으로 차이를 잡는 구조가 현실적입니다.

### 3) TTL은 UX가 아니라 실패 비용으로 정한다

reservation TTL을 "사용자가 결제하는 데 보통 10분 걸린다"만 보고 정하면 위험합니다. TTL은 UX와 자원 희소성, 복구 비용을 같이 봐야 합니다. 희소한 좌석과 넉넉한 디지털 쿠폰은 기준이 다릅니다.

출발점은 아래처럼 잡을 수 있습니다.

| 자원 유형 | 예시 | 권장 hold TTL | 이유 |
| --- | --- | ---: | --- |
| 매우 희소 | 공연 좌석, 한정 재고 | 3~7분 | ghost hold 피해가 큼 |
| 중간 희소 | 일반 상품 재고 | 10~15분 | 결제 UX와 재고 회전 균형 |
| 재생성 가능 | 다운로드 권한, 임시 쿠폰 | 15~30분 | 확정 지연 허용 가능 |
| 금전성 자원 | 포인트 차감, 예치금 | 3~10분 + 별도 정산 | 중복 차감 피해가 큼 |

TTL이 길수록 사용자는 편하지만, 버려진 hold가 많아집니다. TTL이 짧으면 자원 회전은 좋아지지만, 결제 성공 콜백이 늦게 도착했을 때 사용자가 돈은 냈는데 재고는 풀린 상태가 될 수 있습니다. 그래서 결제·외부 승인 시스템이 섞이면 `hold_until`과 별개로 `confirm_grace_period`를 둡니다. 예를 들어 hold는 10분, 결제사 콜백 유예는 2분으로 두고, 유예 구간에서는 새 사용자에게 재판매하지 않는 식입니다.

### 4) Expiry Worker는 "지워주는 배치"가 아니라 상태 전이 실행자다

만료 worker를 단순 삭제 배치로 만들면 운영 증거가 사라집니다. Expiry Worker는 `HELD` 상태 중 `hold_until < now()`인 reservation을 찾아 `EXPIRED`로 전이시키고, summary count를 복구하고, 필요하면 outbox 이벤트를 발행해야 합니다. 즉 작은 상태 머신 실행자입니다.

기본 처리 흐름은 아래와 같습니다.

1. `hold_until` 기준으로 만료 후보를 작은 배치로 조회한다.
2. 각 reservation을 `HELD`일 때만 `EXPIRED`로 조건부 업데이트한다.
3. 성공한 건만 resource summary의 reserved 수량을 줄인다.
4. `reservation.expired` 이벤트를 outbox에 남긴다.
5. 처리 건수, 실패 건수, lag를 지표로 남긴다.

배치 크기는 처음에 100~500건으로 시작하고, DB p95가 기준선 대비 20% 이상 나빠지면 줄입니다. 만료 backlog가 커졌다고 batch size를 무작정 10,000으로 올리면 정상 주문 경로와 같은 row를 두고 경쟁할 수 있습니다. 만료 처리는 중요하지만, 신규 confirm보다 낮은 우선순위로 둬야 하는 경우가 많습니다.

### 5) 시간 기준은 반드시 서버 기준으로 통일한다

reservation은 시간에 민감합니다. 클라이언트 시간이 아니라 서버 시간이 기준이어야 합니다. 사용자의 브라우저 시간이 5분 늦거나 빠르다고 hold 만료가 달라지면 안 됩니다. DB 시간과 애플리케이션 시간이 크게 어긋나는 것도 위험합니다. expire worker가 `now()`를 어디서 가져오는지 명확히 해야 합니다.

권장 기준은 하나입니다. 쓰기 트랜잭션에서 `hold_until`을 계산한 기준과 만료 판정 기준을 같은 시간 소스로 맞춥니다. PostgreSQL이라면 `now()` 또는 `clock_timestamp()` 사용 기준을 정하고, 애플리케이션에서 계산한다면 NTP drift 알람을 둡니다. clock skew가 1~2초인 시스템은 대개 괜찮지만, 결제·좌석처럼 민감한 도메인은 30초 이상 drift가 감지되면 reservation 생성이나 expire worker를 보수적으로 멈추는 편이 낫습니다. 이 주제는 [Clock Skew 시간 의미론](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)과 직접 이어집니다.

## 실무 적용

### 1) API를 create, confirm, cancel로 명확히 나눈다

reservation API는 최소 세 동작으로 나누는 것이 좋습니다.

- `POST /reservations`: 자원을 hold한다.
- `POST /reservations/{id}/confirm`: 결제·확정 후 소진 처리한다.
- `POST /reservations/{id}/cancel`: 사용자가 포기하거나 주문이 실패했을 때 푼다.

각 API는 멱등 키를 받아야 합니다. create는 `user_id + cart_id + resource_id`처럼 같은 시도인지 구분되는 키를 쓰고, confirm은 `payment_id + reservation_id`, cancel은 `reservation_id + cancel_reason` 정도가 출발점입니다. 같은 confirm 요청이 두 번 와도 첫 번째만 `CONFIRMED`가 되고 두 번째는 현재 상태를 읽어 같은 결과를 반환해야 합니다. 외부 결제 콜백은 중복·역순·지연을 기본값으로 봐야 합니다.

### 2) 자원 summary 갱신은 조건부로 처리한다

oversell을 막으려면 reservation 생성 시점의 조건부 갱신이 중요합니다. 예를 들어 재고 2개를 잡을 때는 `available - reserved >= 2` 조건을 같은 트랜잭션 안에서 확인해야 합니다. 구현 방식은 DB마다 다르지만 원칙은 같습니다.

```sql
UPDATE inventory_summary
SET reserved = reserved + :quantity
WHERE sku_id = :sku_id
  AND available - reserved >= :quantity;
```

영향받은 row가 1개면 reservation ledger를 만들고, 0개면 품절 또는 경쟁 실패로 응답합니다. 이때 애플리케이션에서 먼저 조회하고 나중에 업데이트하는 read-modify-write는 경쟁 상황에서 깨지기 쉽습니다. 고경합 SKU는 row lock, atomic update, shard counter, queue serialization 중 하나를 선택해야 합니다. 일반적으로 트래픽이 낮으면 atomic update, 특정 상품에 초당 수백 요청이 몰리면 SKU별 queue나 partitioned counter를 검토합니다.

### 3) Expiry Worker는 중복 실행되어도 안전해야 한다

만료 worker가 한 대만 돈다고 가정하면 언젠가 깨집니다. 배포 중 두 개가 뜰 수 있고, 장애 복구 후 같은 배치를 다시 처리할 수 있습니다. 안전한 방식은 조건부 업데이트와 lease/fencing 조합입니다.

- worker lease TTL: 30~60초부터 시작
- 한 번에 가져오는 후보: 100~500건
- 같은 reservation 상태 전이: `HELD`일 때만 성공
- 실패 재시도: 3회 후 별도 `EXPIRY_FAILED` 큐 또는 알람
- expiry lag: `now - min(expired_candidate_hold_until)`이 5분 이상이면 경고

만약 분산 스케줄러가 이미 있다면 worker singleton을 쓰되, 그래도 상태 전이는 멱등해야 합니다. singleton은 중복 실행 가능성을 줄일 뿐, 정확히 한 번 실행을 보장하지 않습니다.

### 4) 운영 지표는 수량보다 상태 불일치를 먼저 본다

대시보드에는 아래 지표를 분리해서 올립니다.

- `reservation_create_success_rate`
- `reservation_confirm_late_total`
- `reservation_expiry_lag_seconds_p95`
- `held_count_by_resource`
- `summary_ledger_mismatch_count`
- `ghost_hold_count`: `hold_until`이 지났는데 아직 `HELD`인 건수
- `oversell_prevented_total`: 조건부 업데이트 실패로 막은 요청 수

우선순위도 정해야 합니다. `ghost_hold_count > 0` 자체는 항상 장애가 아닐 수 있지만, 희소 자원에서 5분 이상 지속되면 P1로 봅니다. `summary_ledger_mismatch_count > 0`은 금전·재고 도메인에서는 업무 시간과 관계없이 확인 대상입니다. 반대로 품절 직전 상품의 create 실패 증가는 정상적인 수요 신호일 수 있으므로, 에러율과 구분해야 합니다.

## 트레이드오프/주의점

첫째, reservation을 너무 강하게 잡으면 구매 전환율이 떨어질 수 있습니다. 사용자가 장바구니에 넣은 순간 재고를 오래 묶으면 실제 구매 의사가 낮은 사용자가 자원을 점유합니다. 보통은 checkout 진입 또는 결제 시작 시점에 hold하고, 단순 장바구니는 hold하지 않는 편이 낫습니다.

둘째, 너무 짧은 TTL은 외부 시스템 지연에 취약합니다. 결제사가 30초 이상 늦게 콜백을 주거나, 사용자가 3DS 인증을 거치는 경우가 있습니다. 이런 도메인은 TTL을 길게 하는 대신 confirm grace period와 reconciliation을 붙입니다. late confirm은 무조건 실패시키지 말고, 재고 재판매 여부와 결제 취소 가능성을 함께 판단해야 합니다.

셋째, ledger는 저장 비용을 만듭니다. 모든 상태 변화를 영구 보관하면 테이블이 빠르게 커집니다. 실무 기준은 활성 reservation은 hot table에 두고, `CONFIRMED/CANCELED/EXPIRED` 후 30~90일이 지난 레코드는 archive table이나 object storage로 옮기는 방식입니다. 단, 금전성 자원과 감사 대상 이벤트는 조직의 보존 정책을 따라야 합니다.

넷째, reservation이 모든 정합성 문제를 해결하지 않습니다. 선점은 oversell 가능성을 줄이지만, 외부 결제, 배송, 쿠폰, 포인트 시스템과 이어지는 순간 보상 트랜잭션이 필요합니다. 그래서 Reservation Ledger는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)나 reconciliation과 같이 설계해야 합니다. 확정 이벤트가 다른 시스템에 전달되지 않으면 내부 재고는 맞아도 고객 상태는 틀릴 수 있습니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] reservation 상태가 `HELD`, `CONFIRMED`, `CANCELED`, `EXPIRED`처럼 명확히 분리되어 있다.
- [ ] create, confirm, cancel, expire가 모두 멱등하게 동작한다.
- [ ] `hold_until`은 서버 기준 시간으로 계산되고, clock drift 알람이 있다.
- [ ] resource summary 갱신은 조건부 update 또는 동등한 atomic 경로로 처리한다.
- [ ] Expiry Worker는 중복 실행되어도 같은 reservation을 두 번 풀지 않는다.
- [ ] ghost hold, late confirm, expiry lag, summary-ledger mismatch 지표가 있다.
- [ ] ledger와 summary를 대조하는 reconciliation 작업이 정기적으로 돈다.

### 연습

1. 현재 서비스의 "먼저 잡아두는 자원"을 1개 고르세요. 장바구니, 좌석, 쿠폰, 포인트, 파일 처리 슬롯 중 무엇이든 됩니다. 해당 자원의 상태 전이를 `HELD → CONFIRMED/CANCELED/EXPIRED`로 그릴 수 있는지 확인합니다.
2. hold TTL을 3분, 10분, 30분으로 바꿨을 때 사용자 경험과 ghost hold 비용이 어떻게 달라지는지 적어 보세요. 희소 자원이라면 TTL보다 confirm grace period가 더 중요할 수 있습니다.
3. 같은 결제 콜백이 2번 오고, 그 사이 expire worker가 실행되는 시나리오를 테스트로 작성해 보세요. 최종 상태가 하나로 수렴해야 합니다.
4. `summary_ledger_mismatch_count`를 계산하는 SQL 또는 배치 의사코드를 작성해 보세요. 운영에서는 이 숫자가 0이 아니어도 "왜 다른지" 추적할 수 있어야 합니다.

Reservation 설계의 목표는 사용자를 오래 붙잡는 것이 아닙니다. 희소한 자원을 짧게 약속하고, 확정·취소·만료 중 하나로 반드시 닫히게 만드는 것입니다. 좋은 시스템은 선점을 많이 하는 시스템이 아니라, **선점이 실패해도 수량과 고객 상태를 설명할 수 있는 시스템**입니다.
