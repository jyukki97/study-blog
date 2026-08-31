---
title: "백엔드 커리큘럼 심화: 도메인 이벤트와 통합 이벤트, 내부 변경을 외부 계약으로 바로 흘리지 않는 법"
date: 2026-08-22T10:06:00+09:00
lastmod: 2026-08-22T10:06:00+09:00
draft: false
topic: "Architecture"
tags: ["Domain Event", "Integration Event", "Event-Driven Architecture", "Outbox", "Schema Contract", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "도메인 이벤트와 통합 이벤트를 분리하고, outbox·번역 계층·스키마 버전·실패 처리까지 하나의 외부 이벤트 계약으로 운영하는 기준을 정리합니다."
module: "backend-architecture"
study_order: 1489
summary: "도메인 이벤트는 내부 모델의 사실이고 통합 이벤트는 다른 시스템에 제공하는 제품 계약입니다. 둘을 같은 객체로 발행하면 내부 리팩터링이 곧 외부 장애가 됩니다."
keywords: ["domain event vs integration event", "event translation layer", "outbox integration event", "event schema governance", "event driven architecture"]
key_takeaways:
  - "도메인 이벤트는 내부 불변식과 업무 언어를 표현하고, 통합 이벤트는 소비자가 의존할 수 있는 안정된 외부 계약을 표현한다."
  - "애그리거트 내부 객체나 ORM 엔티티를 그대로 발행하지 말고, outbox 뒤에서 명시적 번역과 버전 관리를 거친다."
  - "소비자 수가 2개를 넘거나 보존·재처리 요구가 생기면 payload, 소유자, 호환성, 폐기 일정을 계약으로 기록해야 한다."
operator_checklist:
  - "외부로 나가는 이벤트마다 owner, 목적, schema version, PII 분류, 보존 기간, idempotency key를 기록한다."
  - "도메인 모델 변경 PR은 통합 이벤트 계약 diff와 소비자 영향도를 함께 검토한다."
  - "발행은 DB 변경과 같은 트랜잭션에 outbox로 기록하고, relay 지연·실패·재발행을 측정한다."
  - "breaking change는 새 topic/version 또는 expand-contract 순서로 배포하고 최소 14일의 소비자 전환 창을 둔다."
learning_refs:
  - title: "Transactional Outbox와 CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "DB 상태 변경과 외부 발행을 잃지 않게 연결하는 기반 패턴입니다."
  - title: "이벤트 스키마 레지스트리와 호환성"
    href: "/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/"
    description: "스키마 버전과 소비자 호환성 규칙을 운영하는 방법입니다."
  - title: "모듈 아키텍처와 의존성 경계"
    href: "/learning/deep-dive/deep-dive-module-architecture/"
    description: "내부 모듈 경계와 공개 계약을 분리하는 설계 원칙입니다."
  - title: "Event Sourcing과 CQRS"
    href: "/learning/deep-dive/deep-dive-event-sourcing-cqrs/"
    description: "이벤트를 상태 원장으로 쓰는 경우와 단순 통합 메시지를 구분합니다."
---

주문이 결제되었다는 사실을 코드 안에서 알리는 일과, 다른 서비스에 “결제 완료”라는 계약을 제공하는 일은 비슷해 보이지만 책임이 다릅니다. 전자는 같은 애플리케이션 안에서 할인 계산, 재고 예약, 감사 로그 같은 후속 규칙을 묶기 위한 신호입니다. 후자는 알림, 정산, CRM, 데이터 플랫폼처럼 **다른 배포 주기와 다른 소유자를 가진 시스템이 의존할 수 있게 만든 인터페이스**입니다.

둘을 같은 DTO 하나로 처리하면 초기에는 편합니다. 그러나 `Order` 엔티티에 내부 계산 필드를 하나 추가하거나 상태 전이 규칙을 바꾼 순간, 외부 소비자가 예상하지 못한 payload를 받습니다. 반대로 외부 소비자의 편의를 위해 도메인 모델에 조회 전용 필드를 계속 넣으면 업무 규칙도 흐려집니다. 이 글은 [모듈 아키텍처와 의존성 경계](/learning/deep-dive/deep-dive-module-architecture/), [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [이벤트 스키마 레지스트리와 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/), [Event Sourcing과 CQRS](/learning/deep-dive/deep-dive-event-sourcing-cqrs/)를 연결해, 이벤트를 내부 사실과 외부 계약으로 나누는 실무 기준을 정리합니다.

## 이 글에서 얻는 것

- 도메인 이벤트와 통합 이벤트를 이름만 다르게 붙인 객체가 아니라, **변경 비용과 책임이 다른 두 계층**으로 구분할 수 있습니다.
- 내부 상태 변경, outbox 기록, 외부 발행, 소비자 재처리 사이의 경계를 설계할 수 있습니다.
- payload 최소화, 버전 호환성, PII, 소비자 소유권을 숫자와 조건으로 검토할 수 있습니다.

## 핵심 개념/이슈

### 1) 도메인 이벤트는 내부 사실이고, 통합 이벤트는 외부 약속이다

도메인 이벤트는 도메인 언어로 “무슨 일이 일어났는가”를 표현합니다. 예를 들어 `PaymentCaptured`, `ReservationExpired` 같은 이름은 애그리거트가 유효한 상태 전이를 마쳤다는 사실을 가리킵니다. 이 이벤트는 같은 bounded context의 핸들러가 사용하며, 필요하면 내부 모델의 식별자나 규칙 관련 값을 가질 수 있습니다.

통합 이벤트는 외부 소비자가 어떤 행동을 할 수 있도록 만든 계약입니다. `billing.payment-settled.v1`은 정산 시스템에 필요한 `paymentId`, `orderId`, `settledAt`, `amount`, `currency`, `eventId`만 담을 수 있습니다. 내부의 할인 후보 목록, 위험 점수, JPA lazy 관계처럼 외부가 몰라도 되는 구현 세부사항은 넣지 않습니다.

| 구분 | 도메인 이벤트 | 통합 이벤트 |
| --- | --- | --- |
| 주 소비자 | 같은 도메인/모듈 | 다른 서비스·팀·데이터 플랫폼 |
| 변경 기준 | 도메인 규칙 변화 | 공개 계약 호환성 |
| payload | 내부 규칙에 필요한 최소 사실 | 소비자가 독립 처리할 수 있는 안정된 데이터 |
| 실패 처리 | 요청/트랜잭션 정책에 따름 | 재시도, 멱등성, 보존, 재발행 필요 |
| 소유자 | 도메인 팀 | producer owner + 소비자 계약 책임 |

핵심은 도메인 이벤트를 외부에 절대 내보내지 말자는 것이 아닙니다. **외부로 나가기 전에 번역할 책임을 명시하자**는 것입니다. 통합 이벤트는 내부 이벤트의 복사본이 아니라, 제품 API와 같은 독립된 공개 표면입니다.

### 2) ORM 엔티티와 이벤트를 같은 객체로 두면 리팩터링 비용이 폭발한다

`Order` 엔티티를 JSON으로 직렬화해 메시지 브로커에 발행하는 방식은 피해야 합니다. lazy relation이 의도치 않게 로드되고, nullable 필드가 늘어나며, 삭제한 내부 필드가 외부 소비자를 깨뜨립니다. 특히 `status`, `updatedAt` 같은 필드는 내부에서 자주 바뀌지만 소비자는 이를 순서 보장이나 재처리 판단에 쓸 수 있습니다.

번역 계층은 작아도 좋습니다. 예를 들어 `PaymentCaptured`를 받아 `PaymentSettledV1`을 만들 때, 공개할 필드와 의미를 코드에서 한 번 더 결정합니다. 이때 다음 질문을 통과하지 못한 필드는 payload에서 제외합니다.

1. 소비자가 이 필드 없이 업무를 완료할 수 없는가?
2. producer가 이 의미를 12개월 이상 안정적으로 유지할 수 있는가?
3. 개인정보·비밀정보·내부 위험 모델 값이 아닌가?
4. 값이 누락되었을 때 소비자가 재조회할 정식 API가 있는가?

처음 두 질문에 모두 “예”가 아니라면 이벤트에는 ID와 발생 시각만 보내고, 세부 정보는 조회 API에서 가져오게 하는 편이 낫습니다. 다만 소비자가 한 이벤트마다 producer API를 다시 호출해야 한다면 fan-out과 장애 전파가 생기므로, **소비자 자율성 > payload 최소화 > producer 구현 편의** 순으로 판단합니다.

### 3) outbox는 발행을 보장하지만 계약 설계를 대신하지 않는다

DB 트랜잭션 안에서 주문을 `PAID`로 바꾸고 브로커 발행을 별도 호출하면, DB만 성공하거나 메시지만 성공하는 틈이 생깁니다. 그래서 상태 변경과 함께 outbox row를 기록하고 relay가 뒤에서 발행하는 구조를 씁니다. 이 패턴의 핵심은 “발행할 의도”를 DB에 남기는 것이지, 중복 전달이나 소비자 오류를 없애는 것이 아닙니다.

권장 시작 기준은 다음과 같습니다.

- outbox row에는 `event_id`, `event_type`, `schema_version`, `aggregate_id`, `occurred_at`, `payload`, `trace_id`를 둡니다.
- relay는 at-least-once를 전제로 하고, 소비자는 `event_id`로 멱등 처리합니다.
- `outbox_oldest_unpublished_age`가 **5분**을 넘거나 publish failure가 **1%**를 넘으면 배포보다 복구를 우선합니다.
- 한 이벤트가 3개 이상 소비자에 전달되거나 7일 이상 replay가 필요하면 schema owner와 보존 정책을 문서화합니다.

### 4) 이벤트 이름은 과거형, 명령은 의도형으로 구분한다

`SendInvoice`와 `InvoiceSent`는 다릅니다. 전자는 누군가에게 일을 시키는 명령이고, 후자는 이미 일어난 사실입니다. 통합 이벤트 topic에 명령을 섞으면 producer가 소비자의 작업 순서와 실패 정책까지 떠안게 됩니다. 반대로 “새 주문이 생성됨”이라는 사실을 받은 알림 서비스는 자신의 정책으로 이메일을 보낼지, 푸시를 보낼지, 무시할지 결정할 수 있습니다.

이름은 `order.created.v1`처럼 과거형 사실을 기준으로 하고, payload에 “반드시 지금 실행하라”는 제어 값을 넣지 않는 편이 좋습니다. 오케스트레이션이 필요하면 명령 큐나 workflow를 별도로 두고, 사실 이벤트와 섞지 않습니다.

## 실무 적용

### 1) 세 단계로 분리해 도입한다

**1단계: 내부 이벤트를 명확히 한다.** 애그리거트의 상태 전이가 끝난 뒤에만 도메인 이벤트를 만들고, 트랜잭션 중간의 임시 상태나 UI 클릭 자체를 이벤트로 발행하지 않습니다.

**2단계: 통합 이벤트를 번역한다.** application service 또는 outbox writer가 외부 schema를 생성합니다. 이 계층은 도메인 객체 전체가 아니라 필요한 ID와 확정된 값만 받습니다.

**3단계: 계약을 운영한다.** topic, schema version, owner, 소비자 목록, PII 등급, 보존 기간, 폐기 예정일을 registry 또는 저장소 문서로 관리합니다. 소비자가 0명인 이벤트도 즉시 삭제하지 말고 최소 14일 관측한 뒤 제거합니다. 숨은 배치나 분석 파이프라인이 있을 수 있기 때문입니다.

### 2) 변경 의사결정 기준을 고정한다

이벤트 변경의 우선순위는 **소비자 데이터 정합성 > 개인정보 보호 > 재처리 가능성 > producer 개발 속도**입니다.

- optional 필드 추가: 기본적으로 허용하되 소비자가 unknown field를 무시하는지 contract test로 확인
- 필수 필드 추가: 새 version 또는 default 의미를 명시한 expand 단계 필요
- 필드 이름·단위·의미 변경: breaking change로 분류, 같은 필드 재활용 금지
- PII 추가: security owner 승인과 보존 기간·마스킹 기준 없이는 금지
- 순서 의존 소비자: `aggregate_id`별 순서와 dedup key를 계약에 명시; 전역 순서 요구는 별도 설계 검토

릴리스 전에는 producer와 상위 3개 소비자가 sample payload를 재생하는 contract test를 돌립니다. 고위험 결제·정산 이벤트는 최근 30일 payload를 마스킹한 replay로 확인하고, v1과 v2를 최소 **14일** 병행한 뒤 소비자 전환율이 **99%** 이상일 때 이전 version을 종료하는 기준을 둘 수 있습니다.

### 3) 관측은 발행 성공률만 보지 않는다

브로커 publish 성공률 100%여도 소비자가 뒤에서 조용히 실패하면 계약은 실패한 것입니다. 최소 지표는 `outbox_lag_p95`, `published_count`, `consumer_lag`, `dedup_hit_rate`, `schema_validation_failure`, `unknown_version_count`입니다. `schema_validation_failure > 0`은 새 배포의 즉시 조사 조건으로 두고, `consumer_lag`가 업무 SLA의 절반을 넘으면 producer의 추가 발행이나 대량 replay를 멈추는 것이 안전합니다.

## 트레이드오프/주의점

1. **번역 계층은 코드가 늘어난다.** 하지만 이 비용은 내부 모델이 바뀔 때 외부 장애로 번지는 비용보다 작습니다. 처음에는 5~10개 핵심 이벤트만 분리해도 충분합니다.

2. **payload를 너무 작게 하면 동기 재조회가 늘어난다.** 소비자당 추가 API 호출이 이벤트 수의 20%를 넘거나 producer 장애가 소비자 지연으로 전파되면, 필요한 스냅샷 필드를 이벤트에 포함할지 재검토합니다.

3. **version을 남발하면 운영 표면이 커진다.** optional 추가까지 매번 v2를 만들 필요는 없습니다. 의미 변경, 필수성 변경, 단위 변경처럼 해석이 달라지는 경우에만 version을 올립니다.

4. **이벤트는 감사 로그나 event sourcing과 같지 않다.** 통합 이벤트의 보존 기간과 재생 가능성은 업무 원장 요구와 다릅니다. 법적 감사가 필요하면 별도 원장과 보존 정책을 설계해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 외부 이벤트가 ORM 엔티티나 내부 DTO를 직접 직렬화하지 않는다.
- [ ] 각 통합 이벤트에 owner, 목적, schema version, event_id, PII 등급이 있다.
- [ ] DB 변경과 outbox 기록이 같은 트랜잭션에 묶여 있다.
- [ ] 소비자가 `event_id` 기준 멱등 처리와 재처리를 지원한다.
- [ ] breaking change의 병행 기간과 폐기 조건이 숫자로 정해져 있다.
- [ ] publish 성공률뿐 아니라 outbox lag, consumer lag, schema 실패를 함께 본다.

### 연습

1. 현재 서비스의 `주문 생성` 또는 `회원 가입` 흐름을 골라, 내부 도메인 이벤트와 외부 통합 이벤트의 payload를 각각 6개 필드 이내로 작성해 보세요.
2. 그 이벤트의 필드 하나를 이름 변경해야 한다고 가정하고, optional 추가·병행 발행·소비자 전환·폐기의 4단계 rollout을 14일 일정으로 설계해 보세요.
3. 소비자 두 개가 같은 이벤트를 받았을 때 한쪽은 이메일을, 다른 쪽은 정산 기록을 만든다고 가정하고 각각의 멱등 키와 실패 시 재처리 기준을 적어 보세요.

## 관련 글

- [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [이벤트 스키마 레지스트리와 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)
- [모듈 아키텍처와 의존성 경계](/learning/deep-dive/deep-dive-module-architecture/)
- [Event Sourcing과 CQRS](/learning/deep-dive/deep-dive-event-sourcing-cqrs/)
