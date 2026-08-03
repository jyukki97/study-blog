---
title: "백엔드 커리큘럼 심화: Bitemporal Effective-Dated Records, 가격·권한·계약 이력을 현재처럼 조회하는 법"
date: 2026-08-03T10:06:00+09:00
lastmod: 2026-08-03T11:30:00+09:00
draft: false
topic: "Backend Data Modeling"
tags: ["Data Modeling", "PostgreSQL", "Temporal Data", "Audit Log", "Backend Reliability", "Domain Modeling"]
categories: ["Backend Deep Dive"]
description: "가격, 권한, 약관, 플랜처럼 과거 기준 조회와 정정 이력이 필요한 데이터를 bitemporal/effective-dated record로 설계하는 기준을 정리합니다."
module: "backend-data-system"
study_order: 1468
key_takeaways:
  - "현재값을 UPDATE로 덮어쓰면 과거 시점의 가격·권한·계약 판단을 재현하기 어렵다."
  - "valid time은 비즈니스상 효력이 있었던 시간이고, transaction time은 시스템이 그 사실을 알고 기록한 시간이다."
  - "bitemporal 모델은 모든 테이블에 쓰는 기본값이 아니라 금전, 권한, 계약, 정산, 감사처럼 사후 설명 비용이 큰 데이터에 우선 적용한다."
  - "중복 구간 0건, current row 1건, backdated correction 승인, as-of query 테스트를 gate로 두면 시간 기반 데이터 사고를 줄일 수 있다."
operator_checklist:
  - "가격·권한·계약·정산 테이블에서 과거 시점 조회 요구가 있는 필드를 먼저 inventory한다."
  - "effective_from/effective_to와 recorded_from/recorded_to의 의미를 분리하고, 구간 overlap을 DB 제약과 테스트로 막는다."
  - "과거 정정은 기존 row UPDATE가 아니라 supersede/correction event로 남기고 reason code와 승인자를 기록한다."
  - "as-of query, 현재 row 조회, correction replay를 각각 테스트한다."
learning_refs:
  - title: "Operational State Machine"
    href: "/learning/deep-dive/deep-dive-operational-state-machine-design/"
    description: "상태 전이와 이력 모델을 구분하는 기본기입니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "나중에 설명 가능한 증거를 남기는 감사 로그 설계입니다."
  - title: "Data Retention/Deletion Architecture"
    href: "/learning/deep-dive/deep-dive-data-retention-deletion-architecture/"
    description: "시간 기반 데이터의 보관·삭제 정책을 함께 봐야 합니다."
  - title: "Reconciliation Ledger Pipeline"
    href: "/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/"
    description: "정정 후 원장과 파생 데이터를 대조하는 흐름입니다."
decision_guide:
  title: "bitemporal 모델을 언제 쓸 것인가"
  intro: "시간 모델은 강력하지만 비용이 있습니다. 모든 엔티티에 적용하기보다 사후 재현과 정정 비용이 큰 도메인부터 선택합니다."
  cases:
    - badge: "강력 추천"
      title: "가격, 약관, 수수료, 권한 정책"
      fit: "특정 과거 시점에 어떤 값이 적용됐는지 고객, 감사, 정산 관점에서 재현해야 하는 데이터입니다."
      watchouts: "기간 overlap과 backdated correction을 막지 않으면 현재값 테이블보다 더 위험합니다."
      next_step: "effective interval과 recorded interval을 분리한 append-only 테이블을 설계합니다."
    - badge: "조건부"
      title: "플랜, 쿠폰, 프로모션, 세금 규칙"
      fit: "변경 이력이 많고 주문·청구와 연결되지만 모든 조회가 과거 기준은 아닌 데이터입니다."
      watchouts: "조회 path가 복잡해지므로 current projection 또는 materialized view가 필요할 수 있습니다."
      next_step: "쓰기 원장은 bitemporal로 두고 읽기 모델은 현재값 projection으로 분리합니다."
    - badge: "대체 가능"
      title: "단순 화면 상태, 임시 작업 상태"
      fit: "과거 기준 재현보다 현재 진행 상태가 중요한 내부 상태입니다."
      watchouts: "상태 전이 이력이나 audit log만으로 충분한데 bitemporal을 넣으면 구현 비용이 커집니다."
      next_step: "state machine history와 audit log로 먼저 해결합니다."
---

많은 백엔드 테이블은 현재값 중심으로 시작합니다. `users.plan = 'PRO'`, `products.price = 12000`, `roles.name = 'ADMIN'`처럼 한 row에 최신 상태를 저장하고 변경되면 UPDATE합니다. 작은 서비스에서는 이 방식이 빠르고 단순합니다. 문제는 시간이 비즈니스 의미를 갖기 시작할 때 생깁니다. 2026년 8월 3일에 주문을 다시 계산해야 하는데 "2026년 7월 15일 오전 10시에 사용자가 봤던 가격"을 알아야 하거나, 과거 권한 사고를 조사하면서 "그 시점에 운영자가 어떤 tenant에 접근할 수 있었는가"를 재현해야 하는 상황입니다.

현재값을 덮어쓴 테이블은 이런 질문에 약합니다. 감사 로그가 있더라도 로그는 사건을 설명하는 자료이지, 애플리케이션이 같은 기준으로 다시 계산할 수 있는 도메인 모델이 아닐 수 있습니다. 그래서 가격, 수수료, 약관, 구독 플랜, 권한 정책, 세금 규칙처럼 시간이 핵심인 데이터는 effective-dated record 또는 bitemporal 모델로 설계하는 편이 안전합니다.

이 글은 [Operational State Machine](/learning/deep-dive/deep-dive-operational-state-machine-design/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [Data Retention/Deletion Architecture](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)과 이어집니다. 핵심은 이력 테이블을 많이 만들자는 이야기가 아닙니다. **과거 시점의 판단을 같은 코드와 같은 데이터로 다시 설명할 수 있게 만들자**는 것입니다.

## 이 글에서 얻는 것

- 현재값 UPDATE, audit log, 상태 이력, effective-dated record, bitemporal record의 역할을 구분합니다.
- valid time과 transaction time을 분리해 "그때 효력이 있었던 값"과 "그때 시스템이 알고 있던 값"을 따로 조회하는 법을 배웁니다.
- 가격·권한·계약 데이터에서 interval overlap, gap, backdated correction을 막는 실무 기준을 잡습니다.
- 모든 테이블에 시간 모델을 붙이는 과설계를 피하고, 비용 대비 효과가 큰 도메인부터 적용하는 기준을 가져갑니다.

## 핵심 개념/이슈

### 1) 현재값 UPDATE는 과거 판단을 지운다

가장 흔한 가격 테이블을 생각해 봅시다.

```sql
CREATE TABLE product_price (
  product_id bigint PRIMARY KEY,
  price_cents bigint NOT NULL,
  currency text NOT NULL,
  updated_at timestamptz NOT NULL
);
```

이 구조는 현재 가격을 빠르게 읽기 좋습니다. 하지만 가격이 바뀐 뒤에는 과거 주문, 환불, 정산, 고객 문의를 같은 기준으로 재현하기 어렵습니다. "주문 당시 가격은 order_line에 복사해 두면 되지 않나"라고 할 수 있습니다. 주문 금액만 보면 맞습니다. 하지만 가격 정책 자체가 왜 그렇게 적용됐는지, 특정 쿠폰과 세금 규칙이 그 시점에 유효했는지, 약관 개정 전후 판단이 맞는지는 별도 근거가 필요합니다.

현재값 테이블은 아래 질문에 약합니다.

| 질문 | 현재값 UPDATE의 한계 |
| --- | --- |
| 7월 15일 10시에 유효한 가격은? | 이전 값이 사라짐 |
| 7월 20일에 시스템이 알고 있던 7월 15일 가격은? | 사후 정정 전후를 구분 못함 |
| 운영자가 당시 어떤 tenant 권한을 가졌나? | 권한 변경 이력과 현재 권한이 섞임 |
| 과거 계산을 오늘 다시 실행하면 같은 결과가 나오나? | 정책·코드·데이터 버전이 바뀌었을 수 있음 |

그래서 시간 기반 데이터는 "최신값"과 "판단 근거"를 분리해야 합니다. 현재 화면은 projection으로 빠르게 제공하고, 판단 근거는 append-only 또는 bitemporal 원장에 남기는 구조가 현실적입니다.

### 2) valid time과 transaction time은 다르다

effective-dated record의 첫 단계는 valid time입니다. valid time은 비즈니스 세계에서 값이 효력을 가진 기간입니다. 예를 들어 `2026-08-01 00:00`부터 새 가격이 적용됐다면, 그 가격의 `effective_from`은 8월 1일입니다.

transaction time은 시스템이 그 사실을 기록하고 알고 있었던 시간입니다. 예를 들어 담당자가 8월 3일에 "사실 8월 1일부터 적용됐어야 하는 가격"을 뒤늦게 등록했다면 valid time은 8월 1일이고 transaction time은 8월 3일입니다. 이 차이가 중요합니다.

| 시간 축 | 질문 | 대표 컬럼 |
| --- | --- | --- |
| valid time | 비즈니스상 언제 효력이 있었나 | `effective_from`, `effective_to` |
| transaction time | 시스템이 언제 이 사실을 알았나 | `recorded_from`, `recorded_to` |
| event time | 변경 요청이나 외부 이벤트가 언제 발생했나 | `event_occurred_at` |
| processing time | worker가 언제 처리했나 | `processed_at` |

bitemporal 모델은 valid time과 transaction time을 모두 저장합니다. 그러면 두 종류의 as-of query가 가능해집니다.

- "2026년 8월 1일에 유효했던 가격을 오늘 기준으로 알려줘."
- "2026년 8월 2일 당시 시스템이 알고 있던 8월 1일 가격을 알려줘."

두 질문의 답이 다를 수 있습니다. 사후 정정, 지연 수집, 정책 오류 수정이 있었기 때문입니다. 감사나 정산에서는 이 차이를 설명할 수 있어야 합니다.

### 3) interval overlap은 데이터 버그가 아니라 비즈니스 사고다

effective-dated 테이블에서 가장 위험한 버그는 같은 키에 같은 시간 구간이 두 번 존재하는 것입니다.

```text
product A
  2026-08-01 00:00 ~ 2026-09-01 00:00 : 12000원
  2026-08-15 00:00 ~ 2026-10-01 00:00 : 13000원
```

8월 20일 가격은 무엇일까요? 쿼리 조건에 따라 12000원이 나오거나 13000원이 나올 수 있습니다. 더 나쁜 것은 둘 다 나와 애플리케이션이 임의로 첫 row를 선택하는 경우입니다. 가격, 권한, 약관, 세금 규칙에서 이런 overlap은 단순 데이터 오류가 아닙니다. 고객 청구, 접근 통제, 감사 증거가 흔들립니다.

초기 기준은 보수적으로 잡습니다.

| 지표 | 권장 기준 |
| --- | --- |
| 같은 business key의 valid interval overlap | 0건, 배포 차단 |
| current row 개수 | key당 정확히 1건 |
| gap 허용 여부 | 가격·권한은 기본 0건, 프로모션은 명시적 gap 가능 |
| backdated correction | ticket/reason/approver 필수 |
| correction rate | 주간 0.5% 초과 시 정책 또는 입력 UX 점검 |
| as-of query p95 | 현재값 조회 대비 2배 이상이면 projection 검토 |

PostgreSQL을 쓴다면 range type과 exclusion constraint를 검토할 수 있습니다. 모든 팀이 처음부터 복잡한 제약을 넣을 필요는 없지만, 최소한 application test와 daily integrity job으로 overlap 0건은 지켜야 합니다.

### 4) 정정은 UPDATE가 아니라 새 사실의 기록이다

시간 모델에서 과거 값을 고치는 일은 흔합니다. 세금 코드가 잘못 들어갔거나, 파트너 수수료율 파일이 늦게 도착했거나, 운영자가 날짜를 잘못 선택했을 수 있습니다. 이때 과거 row를 UPDATE로 고치면 "처음부터 그렇게 알고 있었다"는 기록이 됩니다. 실제로는 그렇지 않습니다.

권장 흐름은 아래에 가깝습니다.

1. 기존 row의 `recorded_to`를 닫는다.
2. 같은 valid interval 또는 조정된 valid interval로 새 row를 추가한다.
3. `correction_reason`, `source_event_id`, `approved_by`, `ticket_id`를 남긴다.
4. 영향을 받는 주문·정산·권한 판정을 reconciliation 대상으로 보낸다.

이 방식은 저장공간을 더 쓰지만, 나중에 "언제 누가 무엇을 정정했는가"를 설명할 수 있습니다. [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와 다른 점은 bitemporal 원장은 도메인 계산의 입력이고, audit log는 변경 행위의 증거라는 점입니다. 둘은 경쟁하지 않습니다. 함께 있어야 합니다.

## 실무 적용

### 1) 테이블은 원장과 현재 projection으로 나눈다

가격 정책을 예로 들면 원장은 아래처럼 설계할 수 있습니다.

```sql
CREATE TABLE product_price_policy (
  price_policy_id bigserial PRIMARY KEY,
  product_id bigint NOT NULL,
  currency text NOT NULL,
  price_cents bigint NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  recorded_from timestamptz NOT NULL DEFAULT now(),
  recorded_to timestamptz,
  source_type text NOT NULL,
  source_id text NOT NULL,
  correction_reason text,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from < effective_to),
  CHECK (recorded_to IS NULL OR recorded_from < recorded_to)
);
```

운영 API가 매번 이 테이블을 복잡하게 조회하면 비용이 커질 수 있습니다. 그래서 현재값 projection을 별도로 둡니다.

```sql
CREATE VIEW current_product_price AS
SELECT *
FROM product_price_policy
WHERE effective_from <= now()
  AND (effective_to IS NULL OR now() < effective_to)
  AND recorded_to IS NULL;
```

트래픽이 크면 view 대신 materialized projection이나 별도 current table을 둡니다. 중요한 것은 projection을 원본으로 착각하지 않는 것입니다. projection은 빠른 조회용이고, 원장은 판단 근거입니다.

### 2) 쓰기 API는 "구간 닫기 + 새 구간 추가"를 하나의 명령으로 제공한다

개발자가 직접 row를 만지게 두면 interval 사고가 납니다. 도메인 명령을 명확히 둡니다.

```yaml
change_price_policy:
  product_id: 1001
  new_price_cents: 130000
  effective_from: "2026-09-01T00:00:00+09:00"
  reason_code: "QUARTERLY_PRICE_CHANGE"
  ticket_id: "BILLING-2412"
  validation:
    - "same product/currency interval overlap must be 0"
    - "effective_from is not more than 30 days in the past unless approved"
    - "current price projection rebuild succeeds"
```

실무 기준은 아래처럼 시작할 수 있습니다.

- 미래 적용 예약은 90일 이내만 일반 승인으로 허용한다.
- 과거 적용은 7일 이내면 owner 승인, 7일 초과면 정산·감사 승인까지 요구한다.
- 금전 영향이 100만원 이상이면 reconciliation plan을 먼저 만든다.
- 같은 product/currency에 open-ended current row가 2건 이상이면 write를 차단한다.
- 정책 변경 후 5분 안에 current projection과 원장 count 검증을 실행한다.

이 숫자는 도메인마다 달라집니다. 중요한 것은 "날짜만 바꾸는 작은 수정"처럼 보이는 작업을 운영 명령으로 취급하는 것입니다.

### 3) as-of query를 제품 기능처럼 테스트한다

bitemporal 모델은 조회가 어려워지기 때문에 테스트가 없으면 금방 깨집니다. 기본 쿼리 패턴을 라이브러리나 repository method로 고정합니다.

```sql
SELECT *
FROM product_price_policy
WHERE product_id = :product_id
  AND currency = :currency
  AND effective_from <= :business_time
  AND (:business_time < effective_to OR effective_to IS NULL)
  AND recorded_from <= :system_time
  AND (:system_time < recorded_to OR recorded_to IS NULL)
ORDER BY recorded_from DESC
LIMIT 1;
```

테스트 케이스는 최소 5개가 필요합니다.

1. 현재 가격 조회
2. 미래 예약 가격이 현재 조회에 나오지 않음
3. 과거 시점 가격 조회
4. backdated correction 전 system time으로 조회하면 정정 전 값 반환
5. backdated correction 후 system time으로 조회하면 정정 후 값 반환

이 테스트가 없으면 팀은 valid time과 transaction time을 섞기 시작합니다. 섞이는 순간 bitemporal 모델은 복잡하기만 하고 믿을 수 없는 구조가 됩니다.

### 4) 변경 후 reconciliation 범위를 계산한다

과거 유효기간을 정정하면 이미 생성된 파생 데이터가 틀릴 수 있습니다. 주문 금액, 정산 원장, 권한 grant, 세금 리포트, 고객 고지 내역이 영향을 받을 수 있습니다. 그래서 정정 명령은 영향 범위를 계산해야 합니다.

```yaml
correction_impact:
  target: "product_price_policy"
  valid_interval: "2026-08-01..2026-08-10"
  affected_orders: 1842
  estimated_amount_delta: 3720000
  downstream:
    - "order_line_snapshot"
    - "settlement_ledger"
    - "refund_calculator"
  action:
    - "sample 30 orders"
    - "run reconciliation batch"
    - "manual approval before customer-visible adjustment"
```

[Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)이 여기서 필요합니다. bitemporal 테이블에 정정 이력이 있다는 사실만으로 운영이 끝나지 않습니다. 정정이 실제 비즈니스 결과에 어떤 차이를 만들었는지 대조해야 합니다.

## 트레이드오프/주의점

첫째, bitemporal 모델은 조회 복잡도를 늘립니다. 대부분의 화면은 현재값만 필요합니다. 모든 요청에서 as-of query를 직접 실행하면 latency와 개발 난이도가 올라갑니다. 원장과 projection을 분리하고, current path에는 단순한 인덱스를 제공하는 편이 좋습니다.

둘째, 저장공간과 인덱스 비용이 늘어납니다. 가격 정책처럼 변경 빈도가 낮은 데이터는 부담이 작지만, 권한 decision이나 세션 상태처럼 초당 변경이 많은 데이터에 그대로 적용하면 비용이 커집니다. 고빈도 이벤트는 event log나 state machine history로 두고, bitemporal record는 정책·계약처럼 변경 빈도보다 설명 책임이 큰 데이터에 우선 적용합니다.

셋째, 시간대와 시계 기준을 가볍게 보면 안 됩니다. `effective_from`이 사용자의 현지 날짜 기준인지, 회사 정책 기준 KST인지, UTC timestamp인지 명확히 해야 합니다. 만료 시각과 예약 적용은 [Clock Skew 시간 의미론](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)과 연결됩니다. 서버 간 clock drift가 30초 이상이면 예약 적용과 만료 처리에서 보수 모드로 들어가는 기준을 둘 만합니다.

넷째, 개인정보와 삭제 요구가 섞이면 더 조심해야 합니다. 이력 원장은 오래 보관하고 싶지만, 개인정보 원문을 영원히 남기면 [Data Retention/Deletion Architecture](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)의 요구와 충돌합니다. 원장에는 내부 ID, digest, 정책 버전, 금액, 권한 범위처럼 계산에 필요한 최소값을 남기고, 원문 개인정보는 별도 보관 정책을 따르는 편이 안전합니다.

다섯째, 감사 로그를 bitemporal 원장으로 대체하지 마세요. 원장은 "어떤 값이 언제 유효했는가"를 말하고, 감사 로그는 "누가 어떤 권한으로 왜 바꿨는가"를 말합니다. 권한 변경, 가격 정정, 약관 소급 적용은 두 기록이 모두 필요합니다.

의사결정 우선순위는 **사후 재현 가능성 > 구간 무결성 > 현재 조회 성능 > 저장 비용 > 구현 단순성**입니다. 가격이나 권한처럼 틀렸을 때 설명 비용이 큰 데이터에서는 구현 단순성보다 재현 가능성이 먼저입니다.

## 체크리스트 또는 연습

- [ ] 과거 기준 조회가 필요한 엔티티를 가격, 권한, 계약, 정산, 세금, 약관으로 분류했다.
- [ ] 각 엔티티에 valid time과 transaction time이 모두 필요한지, valid time만으로 충분한지 결정했다.
- [ ] 같은 business key에서 effective interval overlap이 0건임을 DB 제약 또는 daily job으로 검증한다.
- [ ] 현재값 projection과 bitemporal 원장의 역할이 분리되어 있다.
- [ ] backdated correction에는 reason code, ticket id, 승인자, 영향 범위가 남는다.
- [ ] as-of query 테스트가 현재, 과거, 미래 예약, 정정 전, 정정 후를 모두 포함한다.
- [ ] 정정 후 파생 데이터 reconciliation 경로가 있다.
- [ ] 개인정보 원문을 원장에 장기 보관하지 않도록 retention 정책을 확인했다.

연습으로 현재 서비스의 "가격 변경" 또는 "관리자 권한 부여" 중 하나를 골라 보세요. 먼저 현재값 테이블로만 설계했을 때 답할 수 없는 질문 5개를 적습니다. 그다음 `effective_from`, `effective_to`, `recorded_from`, `recorded_to`, `source_id`, `correction_reason`을 가진 원장 row 예시를 3개 만듭니다. 마지막으로 "2026-08-01 기준 값"과 "2026-08-02 당시 시스템이 알고 있던 2026-08-01 기준 값"을 각각 조회하는 SQL을 작성해 보세요. 두 답이 달라질 수 있는 예시까지 만들면 시간 모델의 감각이 잡힙니다.

오늘의 결론은 단순합니다. 시간이 중요한 데이터는 현재값만으로 충분하지 않습니다. 좋은 백엔드 데이터 모델은 최신 상태를 빠르게 보여주는 동시에, 과거의 판단을 같은 기준으로 다시 설명할 수 있어야 합니다.
