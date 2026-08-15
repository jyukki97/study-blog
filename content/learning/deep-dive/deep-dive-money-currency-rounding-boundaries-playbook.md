---
title: "백엔드 커리큘럼 심화: 금액·통화·반올림 경계, Money 값을 정산 사고 없이 다루는 법"
date: 2026-08-15T10:06:00+09:00
lastmod: 2026-08-15T10:06:00+09:00
draft: false
topic: "Backend Domain Modeling"
tags: ["Money", "Currency", "Rounding", "Billing", "Domain Modeling", "Data Integrity", "Backend Reliability"]
categories: ["Backend Deep Dive"]
module: "backend-data"
study_order: 1484
description: "금액을 부동소수점이나 단순 DECIMAL 컬럼으로만 다루지 않고, 통화 단위·반올림 시점·배분 규칙·원본 산식·정산 검증을 하나의 Money 계약으로 설계하는 실무 플레이북입니다."
summary: "금액 사고는 더하기 연산보다 의미가 흐려질 때 발생합니다. 저장 단위, 통화, 세금·할인 반올림, 잔여 1원 배분, 외부 결제 금액 검증, 정정 이력을 분리해 Money를 재현 가능한 도메인 값으로 만드는 기준을 정리합니다."
keywords: ["money value object", "currency minor unit", "rounding policy", "discount allocation", "financial data integrity", "BigDecimal backend"]
key_takeaways:
  - "금액은 숫자 하나가 아니라 amount, currency, scale, rounding rule, 계산 시점과 원본 산식을 함께 가져야 재현할 수 있는 도메인 값이다."
  - "저장 단위는 통화별 minor unit 정수 또는 명시적인 DECIMAL scale로 고정하고, Java double·JavaScript Number를 금액의 기준 저장소로 쓰지 않는다."
  - "할인·세금의 반올림은 항목별, 주문 합계, 청구서별 중 어느 경계에서 한 번 적용하는지 정책으로 정하고, 잔여 단위는 결정적인 배분 규칙으로 처리해야 한다."
  - "외부 결제·정산의 금액과 통화가 내부 의도와 한 단위라도 다르면 자동 보정하지 말고 quarantine과 재조회를 우선한다."
operator_checklist:
  - "금액 관련 테이블에는 amount뿐 아니라 currency, scale 또는 minor-unit 규칙, pricing/rounding policy version을 남긴다."
  - "할인·세금·환불 경로마다 반올림 경계와 residual 배분 순서를 테스트 fixture로 고정한다."
  - "결제 승인·capture·refund webhook은 amount, currency, provider transaction id, idempotency key를 모두 검증한 뒤 상태를 바꾼다."
  - "금액 불일치는 0건을 목표로 보고, 1건이라도 발생하면 영향을 준 order·ledger·provider event를 묶어 조사한다."
learning_refs:
  - title: "결제 Authorization·Capture 상태 머신"
    href: "/learning/deep-dive/deep-dive-payment-authorization-capture-state-machine-playbook/"
    description: "결제 상태 전이와 provider 금액 검증을 다루는 다음 단계 글입니다."
  - title: "Reconciliation 파이프라인"
    href: "/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/"
    description: "내부 원장과 외부 정산 결과가 어긋났을 때 비교·격리·보정하는 방법입니다."
  - title: "Bitemporal·유효기간 데이터 설계"
    href: "/learning/deep-dive/deep-dive-bitemporal-effective-dated-records-playbook/"
    description: "과거의 가격·세율·할인 정책을 당시 기준으로 재현해야 할 때 연결됩니다."
  - title: "도메인 불변식 Registry와 데이터 품질"
    href: "/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/"
    description: "금액 합계와 잔액 불변식을 운영 지표와 알림으로 만드는 방법입니다."
decision_guide:
  title: "금액 표현을 어떻게 고를까"
  intro: "표현 방식은 편의보다 통화 범위, 소수 단위, 정산 요구, 외부 provider 계약을 기준으로 고릅니다."
  cases:
    - badge: "Minor-unit integer"
      title: "단일 또는 소수 자릿수가 고정된 통화를 주로 다룬다"
      fit: "KRW 포인트·쿠폰, USD/EUR 결제처럼 통화 코드별 소수 자릿수를 명확히 알고 있고 합계·비교가 많은 서비스"
      watchouts: "통화 코드 없이 amount만 저장하면 1000이 1,000원인지 10.00달러인지 해석할 수 없다."
      next_step: "amount_minor bigint, currency char(3), policy_version을 한 값 객체와 DB 제약으로 묶는다."
    - badge: "Fixed DECIMAL"
      title: "세율·환율·측정 단가처럼 중간 계산의 소수 자리가 중요하다"
      fit: "금액 확정 전의 과금 계산, 환율 계산, 사용량 기반 청구"
      watchouts: "DECIMAL scale만 믿고 반올림 시점·mode를 정하지 않으면 서비스마다 다른 결과가 나온다."
      next_step: "중간 산식용 scale과 청구 확정 scale을 분리하고 확정 지점에서만 정책 반올림을 적용한다."
    - badge: "Provider-native amount"
      title: "외부 결제사가 자체 단위·통화 규칙을 정한다"
      fit: "PG 승인, 앱스토어 결제, 다중 통화 정산 연동"
      watchouts: "provider amount를 내부 display 금액으로 변환한 뒤 비교하면 scale 또는 환율 차이가 숨는다."
      next_step: "provider 원문 amount·currency와 내부 canonical amount를 모두 보관하고 변환 근거를 남긴다."
faqs:
  - question: "BigDecimal이면 금액 문제는 해결되나요?"
    answer: "아닙니다. BigDecimal은 이진 부동소수점 오차를 피하는 도구일 뿐입니다. scale, rounding mode, 반올림 경계, 통화, 배분 규칙이 없으면 같은 BigDecimal 연산도 다른 결과를 낼 수 있습니다."
  - question: "모든 금액을 cents 같은 정수로 저장하면 되나요?"
    answer: "확정 금액과 단순 합계에는 좋지만, 세율·환율·비례 배분의 중간 계산에는 더 높은 정밀도가 필요할 수 있습니다. 중간 계산용 정밀도와 확정 금액의 통화 단위를 분리해야 합니다."
  - question: "1원 차이는 자동으로 무시해도 되나요?"
    answer: "아니요. 금액 불일치는 크기가 작아도 규칙 누락·통화 해석 오류·중복 반영의 초기 신호일 수 있습니다. 표시용 집계 오차와 실제 원장·결제 금액 불일치를 구분하고, 후자는 0건으로 관리하는 편이 안전합니다."
---

결제, 포인트, 쿠폰, 사용량 과금에서 금액은 흔히 `amount decimal(19,2)` 하나로 시작합니다. 초기에는 잘 동작합니다. 그러나 통화가 하나 더 붙고, 부가세 포함·별도 표시가 갈리고, 쿠폰을 여러 상품에 나누고, 부분 환불과 외부 PG 정산까지 들어오면 숫자 하나로는 질문에 답할 수 없습니다. “이 주문이 왜 10,001원인가?”, “할인 1원이 어느 상품에 붙었는가?”, “승인 금액과 환불 잔액이 왜 다른가?”가 남습니다.

금액 사고의 핵심은 덧셈 실수가 아니라 **의미가 사라지는 것**입니다. 금액을 재현하려면 값뿐 아니라 통화, 적용 자릿수, 반올림 방식, 반올림한 경계, 가격·세금 정책 버전, 원본 산식이 필요합니다. 이 글은 [결제 Authorization·Capture 상태 머신](/learning/deep-dive/deep-dive-payment-authorization-capture-state-machine-playbook/), [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/), [Bitemporal·유효기간 데이터 설계](/learning/deep-dive/deep-dive-bitemporal-effective-dated-records-playbook/), [도메인 불변식 Registry와 데이터 품질](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)을 금액이라는 공통 경계로 연결합니다.

## 이 글에서 얻는 것

- `1000`이라는 숫자가 왜 금액으로는 불완전한지, Money 값에 무엇을 붙여야 하는지 설명할 수 있습니다.
- 정수 minor unit, `DECIMAL`, `BigDecimal`을 저장·중간 계산·확정 금액의 역할로 나눌 수 있습니다.
- 할인과 세금에서 반올림을 어느 경계에서 적용할지, 남은 1원을 어떤 규칙으로 배분할지 설계합니다.
- 결제 provider, 내부 원장, 고객 화면의 값을 비교할 때 자동 보정하면 안 되는 경우를 구분합니다.
- 금액 불변식, 예외 격리, 정정 이력을 운영 기준과 숫자로 관리할 수 있습니다.

## 핵심 개념/이슈

### 1) Money는 숫자가 아니라 해석 가능한 값이다

`amount = 1000`만 저장하면 두 가지 문제가 바로 생깁니다. 첫째, 통화가 없습니다. KRW라면 1,000원일 수 있고, USD라면 10.00달러일 수도 있습니다. 둘째, 그 금액이 확정 금액인지, 세금 전 금액인지, 환율 적용 전 중간값인지 알 수 없습니다. 나중에 정책이 바뀌면 같은 숫자를 다시 계산해도 같은 결과를 얻을 수 없습니다.

최소 Money 계약은 다음 질문에 답해야 합니다.

| 필드 또는 규칙 | 답하는 질문 | 예시 |
| --- | --- | --- |
| `amount_minor` 또는 `decimal_amount` | 얼마인가 | `1000`, `10.00` |
| `currency` | 어느 통화인가 | `KRW`, `USD`, `JPY` |
| `scale` 또는 통화 minor-unit 표 | 몇 자리까지 유효한가 | KRW 0, USD 2 |
| `rounding_mode` | 중간값을 어떻게 확정했는가 | HALF_UP, HALF_EVEN, floor |
| `pricing_policy_version` | 어떤 가격·세금 규칙을 썼는가 | `price-2026-08-v3` |
| calculation snapshot | 왜 그 결과가 나왔는가 | 세율, 쿠폰, 환율 기준시각 |

모든 화면 응답에 이 값을 전부 내보내라는 뜻은 아닙니다. 고객에게는 `10,000원`이라는 표시값이면 충분할 수 있습니다. 하지만 order line, invoice, payment attempt, ledger entry처럼 나중에 재현·정산해야 하는 레코드에서는 숫자만 남기면 안 됩니다. 특히 **가격 규칙의 현재값을 다시 읽어 과거 주문을 계산하는 방식**은 위험합니다. 과거를 다시 해석해야 한다면 정책 버전과 입력 snapshot을 남겨야 합니다.

### 2) `double`의 문제와 `BigDecimal`의 한계는 다르다

Java `double`이나 JavaScript `Number`는 많은 소수를 이진 부동소수점으로 표현합니다. 따라서 `0.1 + 0.2`가 사람이 기대한 0.3과 정확히 같지 않을 수 있습니다. 금액의 기준 저장·비교·합계에 쓰면 안 되는 이유입니다.

그렇다고 `BigDecimal`을 쓰면 설계가 끝나는 것은 아닙니다. `new BigDecimal(0.1)`처럼 binary float에서 만들면 이미 오차를 들고 들어옵니다. 문자열 또는 정수에서 만들고, scale과 rounding mode를 명시해야 합니다.

```java
// 금지: binary float의 근사값을 BigDecimal로 옮긴다.
new BigDecimal(0.1);

// 권장: 문자열 또는 minor unit에서 만든다.
BigDecimal rate = new BigDecimal("0.1");
BigDecimal price = BigDecimal.valueOf(10_000L);
BigDecimal tax = price.multiply(rate).setScale(0, RoundingMode.HALF_UP);
```

하지만 위 코드의 `HALF_UP`도 정책입니다. 어느 나라의 세금 규정, 계약, 회계 기준이든 반올림 방식과 시점이 다를 수 있습니다. 기술팀이 라이브러리 기본값으로 정해서는 안 되고, 도메인 정책으로 명시한 뒤 재사용해야 합니다.

### 3) 저장 단위와 계산 단위를 분리한다

확정된 금액은 보통 통화의 minor unit 정수로 저장하는 편이 단순합니다. KRW처럼 소수 단위가 없는 통화는 `amount_minor = 1000`이 곧 1,000원입니다. USD가 2자리 소수 단위를 쓴다는 계약이라면 `amount_minor = 1000`, `currency = 'USD'`는 10.00달러를 뜻합니다. 정수 합계와 비교는 정확하고 index·aggregation도 단순합니다.

다만 세율, 환율, 사용량 단가, 비례 할인처럼 중간값이 소수를 만드는 계산은 더 높은 정밀도로 해야 합니다. 핵심은 **중간 계산을 정밀하게 하고, 도메인이 정한 확정 경계에서 한 번 반올림한다**는 것입니다. 매 연산 뒤 습관적으로 scale을 잘라 내면 작은 오차가 누적됩니다.

```text
중간 계산: usage × unit_rate × exchange_rate  -> 높은 정밀도 유지
청구 확정: invoice line 또는 invoice total    -> 정책 scale로 반올림
저장/정산: canonical minor unit               -> 정수로 확정
```

예외도 있습니다. 법·계약이 “각 주문 행의 세금을 원 단위로 반올림한 뒤 합산”하도록 정했다면 line이 확정 경계입니다. 반대로 invoice 총액에만 세금을 부과한다면 invoice가 경계입니다. 둘 중 무엇이 옳은지는 프로그래밍 취향이 아니라 **상품·세무·결제 계약**의 문제입니다.

### 4) 할인 배분의 잔여 1원은 반드시 결정적으로 처리한다

상품 A 1,990원, 상품 B 2,010원인 주문에 주문 쿠폰 1,000원을 비율로 배분한다고 해 봅시다. 이론적인 할인은 A 497.5원, B 502.5원입니다. 하지만 KRW 확정 금액은 반 원을 저장할 수 없습니다. A와 B를 각각 반올림하면 합계가 999원 또는 1,001원이 될 수 있습니다.

안전한 방식은 세 단계입니다.

1. 각 line의 이론 배분액을 높은 정밀도로 계산합니다.
2. 모든 line에 floor 또는 정책상 기본 반올림을 적용합니다.
3. 목표 할인 총액과 현재 합계의 차이(residual)를 fractional remainder가 큰 순서, 동률이면 stable line id 순서로 한 단위씩 배분합니다.

```text
coupon_total = 1,000 KRW
line A raw = 497.5 -> base 497, remainder 0.5
line B raw = 502.5 -> base 502, remainder 0.5
base sum = 999, residual = 1
stable line id가 작은 A에 +1 -> A 498, B 502, 합계 1,000
```

여기서 중요한 것은 A에 1원을 주는 정책 자체가 아니라, **언제나 같은 입력이면 같은 line이 그 1원을 받는다는 것**입니다. DB 조회 순서, hash map 순회 순서, 워커 실행 순서에 따라 결과가 바뀌면 고객 문의와 재처리에서 설명할 수 없습니다. 잔여 배분의 기준과 tie-breaker를 `pricing_policy_version`에 포함하고 fixture로 고정하세요.

### 5) 원장, 표시값, provider 금액은 같은 숫자여도 같은 역할이 아니다

금액을 한 테이블에 덮어쓰면 감사와 재현이 무너집니다. 최소한 아래 역할을 분리합니다.

| 레이어 | 역할 | 수정 원칙 |
| --- | --- | --- |
| 가격 계산 snapshot | 상품가·쿠폰·세율·환율로 계산한 근거 | 확정 후 append 또는 versioned |
| 주문/청구서 합계 | 고객에게 청구하기로 한 금액 | 변경은 명시적 재계산 명령으로 |
| payment attempt | PG에 보낸 amount·currency·idempotency key | provider 원문과 함께 보관 |
| ledger entry | 승인·환불·조정의 회계적 효과 | 원칙적으로 append-only |
| display projection | UI용 합계·포맷 | 원장에서 재구축 가능해야 함 |

PG webhook이 `approved_amount = 10,000`, `currency = KRW`를 보냈을 때 내부 payment attempt가 9,900원이면 “1% 정도 차이”로 넘어가면 안 됩니다. 금액, 통화, merchant account, provider transaction id 중 하나라도 맞지 않으면 상태 전이를 멈추고 `AMOUNT_OR_CURRENCY_MISMATCH`로 격리하는 편이 안전합니다. 네트워크 timeout 뒤 provider가 실제로 승인했는지 모르는 경우도 마찬가지입니다. [결제 Authorization·Capture 상태 머신](/learning/deep-dive/deep-dive-payment-authorization-capture-state-machine-playbook/)처럼 조회와 수동 확인으로 효과를 확정합니다.

### 6) 금액 불변식은 DB·코드·운영에서 세 번 확인한다

금액은 테스트만으로 충분하지 않습니다. 아래 불변식은 한 계층에만 두지 말고, 가능한 것은 DB 제약과 원장 집계로, 업무 규칙은 서비스 코드로, 사후 탐지는 배치·대시보드로 중복 확인합니다.

- `invoice_total = line_total + tax_total - discount_total`이 통화 단위까지 일치한다.
- 같은 currency가 아닌 금액은 합산하지 않는다. 환산했다면 exchange rate와 기준시각이 있다.
- `authorized >= captured >= refunded` 또는 도메인별 허용 상태 관계가 항상 성립한다.
- 한 `provider_event_id`와 한 idempotency key가 두 개의 금전 효과를 만들지 않는다.
- line 할인 합계와 order 할인 총액의 차이는 정확히 0이다.

운영 기준은 보수적으로 둡니다. 원장·PG·청구 금액 불일치는 **0건**이 목표입니다. 표시용 통계의 반올림 오차와 섞지 마세요. 금액 mismatch가 1건이라도 발생하면 자동 재시도만 반복하지 말고 order id, invoice id, provider event id, policy version, 최초 불일치 시각을 한 사건으로 묶어 조사합니다. 이 관점은 [도메인 불변식 Registry와 데이터 품질](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)의 P0 불변식 운영과 같습니다.

## 실무 적용

### 1) Money 값 객체와 확정 API를 먼저 만든다

애플리케이션 전체에 `BigDecimal`을 흩뿌리면 scale과 rounding mode가 호출자마다 달라집니다. 금액 생성·더하기·환산·확정을 한 값 객체 또는 좁은 domain service로 모으세요. 아래는 개념적 인터페이스입니다.

```java
public record Money(long amountMinor, Currency currency) {
    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.addExact(amountMinor, other.amountMinor), currency);
    }
}

public interface PricingPolicy {
    Money finalizeInvoice(PriceSnapshot snapshot);
    List<AllocatedDiscount> allocateDiscount(Money coupon, List<LineAmount> lines);
    String version();
}
```

이 예제는 모든 통화의 중간 계산을 `long`으로 하라는 뜻이 아닙니다. `Money`는 확정 금액, `PreciseAmount` 또는 `BigDecimal`은 계산 중간값처럼 역할을 나누면 좋습니다. 또한 `currency`가 다르면 `plus`를 실패시켜야 합니다. 환산은 `convert(exchangeRate, asOf, policy)`처럼 의도적인 명령으로만 일어나야 합니다.

### 2) DB 스키마에 해석 단서를 남긴다

확정 payment·ledger에는 다음과 같은 형태가 출발점이 될 수 있습니다.

```sql
CREATE TABLE payment_attempts (
  id                    uuid PRIMARY KEY,
  order_id              uuid NOT NULL,
  amount_minor          bigint NOT NULL CHECK (amount_minor >= 0),
  currency              char(3) NOT NULL,
  pricing_policy_version text NOT NULL,
  provider              text NOT NULL,
  provider_payment_id   text,
  idempotency_key       text NOT NULL,
  status                text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id),
  UNIQUE (idempotency_key)
);
```

이 테이블에 환율·세율·쿠폰 세부 산식까지 모두 넣을 필요는 없습니다. 그러나 이를 조회할 수 있는 immutable snapshot id, invoice id 또는 pricing calculation id는 있어야 합니다. `amount_minor`의 해석을 정하는 통화·정책 버전까지 없으면 원인 분석 시점에 현재 코드로 과거 결과를 추측하게 됩니다.

### 3) 반올림·배분을 예제 기반 테스트로 잠근다

정상값만 테스트하면 residual 버그를 놓칩니다. 최소 fixture는 다음을 포함합니다.

| 경우 | 반드시 확인할 결과 |
| --- | --- |
| 1원·1cent 쿠폰 | 할인 합계가 목표 금액과 정확히 같은가 |
| 세 상품에 1원 배분 | tie-breaker가 stable id 기준으로 고정되는가 |
| 동일 가격 line 순서 변경 | 결과가 입력 순서가 아닌 정책 기준으로 같은가 |
| 부분 환불 | 원 할인·세금 배분과 환불 금액의 관계가 보존되는가 |
| 통화 불일치 | 합산·환불·capture가 즉시 거부되는가 |
| provider timeout 후 webhook | 중복 승인 또는 이중 ledger entry가 없는가 |

새 가격 정책을 배포할 때는 최근 30일 주문 snapshot을 재계산해 기존 확정값과 비교하는 shadow run이 도움이 됩니다. 정책 변경이 의도된 주문을 분리한 뒤, 의도하지 않은 금액 차이는 0건이어야 합니다. 차이가 있다면 `어떤 주문이 몇 원 달라졌는가`만 보지 말고 rounding boundary, input snapshot, residual rule, currency scale 중 어디가 달라졌는지 분류하세요.

### 4) 수정은 overwrite가 아니라 보정 효과로 남긴다

정산 오류가 났을 때 `orders.total_amount`를 직접 update하면 현재 화면은 맞아 보일 수 있습니다. 그러나 이전 청구, 승인, 환불, 고객 안내와의 관계가 끊깁니다. 금전 효과는 가능한 한 compensation entry 또는 adjustment entry로 남기고, 원인을 `reason_code`, 승인자, policy version, 연결된 incident로 기록하세요.

자동 보정은 좁게 시작합니다. 예를 들어 display projection 재생성처럼 원장이 바뀌지 않는 작업은 자동으로 해도 됩니다. 반면 승인·환불·포인트 잔액·세금 금액이 바뀌는 작업은 차이가 1원이어도 수동 승인을 기본으로 두는 편이 안전합니다. [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)과 [정정 Job 감사 가드레일](/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/)의 dry-run·영향 범위·rollback 기준을 그대로 적용할 수 있습니다.

## 트레이드오프/주의점

1. **정수 저장이 모든 계산을 단순화하지는 않습니다.** 확정 금액에는 강하지만, 환율·세율·비례 배분은 고정 정밀도 중간 계산이 필요합니다. 정수로 일찍 자르면 오차가 커집니다.
2. **통화 minor unit을 하드코딩하지 마세요.** 현재 지원 통화가 KRW 하나여도 provider가 반환하는 scale, 향후 다중 통화, 통화 코드 변경을 고려해 중앙 policy로 관리해야 합니다.
3. **반올림 방식은 법무·재무와 확인해야 합니다.** HALF_UP이 익숙하다는 이유로 선택하지 말고, 청구서·세금·계약의 확정 경계를 문서로 합의해야 합니다.
4. **잔여 배분은 공정성 문제도 됩니다.** 항상 첫 상품에 1원을 몰아주면 대량 주문에서 편향이 생길 수 있습니다. stable id, remainder, 고객 혜택 우선순위 중 어떤 기준을 쓸지 제품 정책으로 결정합니다.
5. **외부 provider 금액을 조용히 변환하지 마세요.** amount와 currency mismatch는 단순 파싱 오류일 수도 있지만, 잘못된 merchant 설정·이벤트 연결·중복 처리의 신호일 수도 있습니다. 자동 보정이 아니라 quarantine이 기본입니다.
6. **Money 모델을 과도하게 일반화하지 마세요.** 단일 통화의 내부 포인트를 처리하는 작은 기능에 FX ledger, 다중 tax engine, 범용 allocation framework를 먼저 넣을 필요는 없습니다. 현재 도메인에 필요한 통화·반올림 경계부터 작게 고정하고, 지원 범위가 늘 때 정책 버전을 올리면 됩니다.

## 체크리스트 또는 연습

### 적용 체크리스트

- [ ] 금액 기준 저장소에 `double` 또는 JavaScript `Number`를 쓰지 않는다.
- [ ] 확정 금액에는 amount, currency, 해석 가능한 scale/minor-unit 규칙이 있다.
- [ ] 통화가 다른 Money는 명시적인 환산 명령 없이는 합산할 수 없다.
- [ ] 세금·할인·환불별 반올림 mode와 확정 경계가 문서화되어 있다.
- [ ] residual 1원/1cent 배분의 순서와 tie-breaker가 결정적이다.
- [ ] pricing policy version과 계산 snapshot을 과거 주문에서 조회할 수 있다.
- [ ] payment webhook은 amount, currency, provider transaction id, idempotency key를 함께 검증한다.
- [ ] ledger·invoice·provider 정산의 금액 mismatch는 0건 기준으로 관측한다.
- [ ] 금전 effect의 정정은 overwrite가 아니라 adjustment/compensation으로 남긴다.
- [ ] 가격 정책 변경 전 최근 주문 snapshot shadow run과 차이 분류를 수행한다.

### 연습

1. 현재 서비스의 금액 필드 5개를 골라 “확정 금액 / 중간 계산 / 화면 projection / 외부 provider 원문” 중 어디에 속하는지 분류해 보세요.
2. 세 line에 1,000원 쿠폰을 비례 배분하는 fixture를 만들고, 합계가 정확히 1,000원인지와 line 순서가 바뀌어도 결과가 같은지 테스트하세요.
3. `amount = 1000`만 가진 payment 레코드에 어떤 정보가 더 있어야 1년 뒤 승인 근거를 재현할 수 있는지 schema diff를 작성해 보세요.
4. PG webhook에서 amount 또는 currency가 한 단위라도 다를 때 어떤 상태로 격리하고, 누가 어떤 증거를 보고 해제할지 runbook으로 정리해 보세요.

좋은 Money 모델의 목표는 모든 금액 계산을 복잡하게 만드는 것이 아닙니다. **같은 입력과 정책이면 언제나 같은 결과가 나오고, 다른 결과가 나오면 이유를 추적할 수 있게 만드는 것**입니다. amount, currency, rounding boundary, allocation rule, provider evidence를 한 계약으로 관리하면 작은 1원 차이가 큰 정산 사고로 번지는 경로를 일찍 차단할 수 있습니다.
