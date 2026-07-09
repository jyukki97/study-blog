---
title: "백엔드 커리큘럼 심화: Domain Invariant Registry, 데이터 품질을 운영 계약으로 관리하기"
date: 2026-07-09
draft: false
topic: "Backend Data Quality"
tags: ["Domain Invariant", "Data Quality", "Reconciliation", "Validation", "Backend Reliability", "Operations"]
categories: ["Backend Deep Dive"]
keywords: ["Domain Invariant Registry", "데이터 품질", "도메인 불변식", "reconciliation", "correction job", "백엔드 운영"]
description: "주문·결제·권한·재고처럼 틀리면 복구 비용이 큰 데이터를 사후 보정이 아니라 도메인 불변식, 검증 지점, 위반 SLO, 보정 경로로 관리하는 실무 플레이북입니다."
summary: "Domain Invariant Registry는 중요한 데이터 규칙을 문서, 테스트, 배치, 알람, 보정 작업으로 연결해 데이터 품질을 운영 가능한 계약으로 만드는 방식입니다."
key_takeaways:
  - "데이터 품질은 컬럼 타입과 입력 검증만으로 닫히지 않는다. 도메인 불변식을 별도 계약으로 식별하고 관측해야 한다."
  - "불변식은 DB 제약, 애플리케이션 검증, 비동기 reconciliation, correction job 중 어디서 보장할지 등급을 나눠야 한다."
  - "위반 건수 0이 필요한 규칙과 지연 보정이 가능한 규칙을 섞지 않아야 알람 피로와 오보정을 줄일 수 있다."
operator_checklist:
  - "금전, 권한, 개인정보, 재고, 공개 상태에 대해 핵심 불변식 10개를 먼저 등록한다."
  - "각 불변식에 owner, severity, detection query, 허용 지연, correction path, 종료 기준을 붙인다."
  - "위반 알람은 비즈니스 위험도 기준으로 P0/P1/P2를 나누고, 단순 카운터 증가와 고객 영향 가능성을 분리한다."
learning_refs:
  - title: "운영용 상태 머신 설계"
    href: "/learning/deep-dive/deep-dive-operational-state-machine-design/"
    description: "상태 전이와 불변식을 도메인 규칙으로 닫는 기본 사고방식입니다."
  - title: "Reconciliation Ledger Pipeline"
    href: "/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/"
    description: "불변식 위반 후보를 탐지하고 원장 기준으로 분류하는 앞단 설계입니다."
  - title: "Correction Job 플레이북"
    href: "/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/"
    description: "탐지된 불일치를 승인 가능한 보정 작업으로 닫는 절차입니다."
  - title: "Data Retention/Deletion Architecture"
    href: "/learning/deep-dive/deep-dive-data-retention-deletion-architecture/"
    description: "삭제 요청과 파생 저장소 전파를 불변식으로 관리할 때 같이 봐야 할 글입니다."
decision_guide:
  intro: "모든 규칙을 같은 강도로 막으려 하면 개발 속도와 운영 알람이 모두 망가집니다. 불변식은 복구 비용과 고객 영향 기준으로 등급을 나눠야 합니다."
  cases:
    - badge: "P0"
      title: "한 건이라도 고객 피해나 보안 사고로 이어진다"
      fit: "잔액 음수, 권한 없는 접근, 삭제 요청 후 재노출, 결제 중복 승인 같은 규칙입니다."
      watchouts: "사후 배치로만 잡으면 이미 피해가 발생했을 수 있습니다."
      next_step: "쓰기 경로에서 fail-closed하고, 별도 reconciliation은 누락 감시로 둡니다."
    - badge: "P1"
      title: "짧은 지연 보정은 가능하지만 누적되면 사고가 된다"
      fit: "검색 인덱스 stale, read model lag, 배송 상태 동기화, 포인트 적립 지연 같은 규칙입니다."
      watchouts: "지연 허용 시간이 문서화되지 않으면 운영자는 언제 장애인지 판단하지 못합니다."
      next_step: "허용 지연 p95와 residual count 기준을 정하고 correction job으로 닫습니다."
    - badge: "P2"
      title: "제품 품질에는 영향이 있지만 즉시 고객 피해는 작다"
      fit: "추천 점수 누락, 통계 집계 오차, 관리자 화면 보조 필드 불일치 같은 규칙입니다."
      watchouts: "너무 강하게 알람을 걸면 중요한 위반이 묻힙니다."
      next_step: "일일 리포트와 backlog ticket으로 관리하고, 릴리스 차단 조건은 좁게 둡니다."
module: "backend-data-system"
study_order: 1447
---

서비스가 커질수록 데이터 품질 문제는 "입력값 검증을 더 잘하자"만으로 해결되지 않습니다. 주문은 결제와 배송, 쿠폰, 포인트, 정산, CS 화면으로 퍼지고, 권한은 사용자·조직·역할·정책 캐시·검색 인덱스로 복사됩니다. 어느 한 지점에서만 정상이어도 전체 업무 규칙은 깨질 수 있습니다. `NOT NULL`과 enum은 필요하지만, "환불된 주문은 배송 요청을 만들 수 없다"나 "관리자 권한은 tenant 경계를 넘을 수 없다" 같은 규칙은 더 높은 수준의 도메인 불변식입니다.

Domain Invariant Registry는 이런 중요한 규칙을 머릿속 지식이 아니라 운영 계약으로 등록하는 방식입니다. 각 불변식에 owner, 심각도, 보장 위치, 탐지 쿼리, 허용 지연, 보정 경로, 종료 기준을 붙입니다. 이 글은 [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/), [Snapshot Isolation과 Write Skew](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/), [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/), [Correction Job 플레이북](/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/)을 데이터 품질 운영 관점으로 연결합니다.

## 이 글에서 얻는 것

- 도메인 불변식과 일반 입력 검증, DB 제약, 배치 검증의 차이를 구분할 수 있습니다.
- 불변식을 P0/P1/P2로 나누고, 어떤 규칙은 쓰기 경로에서 막고 어떤 규칙은 reconciliation으로 잡을지 판단할 수 있습니다.
- 데이터 품질 알람을 단순 "불일치 몇 건"이 아니라 고객 영향, 허용 지연, 보정 가능성 기준으로 설계할 수 있습니다.
- 운영팀과 개발팀이 같은 언어로 데이터 품질을 설명할 수 있는 registry 템플릿을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 불변식은 "항상 참이어야 하는 업무 규칙"이다

입력 검증은 보통 요청 하나를 봅니다. `price >= 0`, `email format`, `required field` 같은 규칙입니다. DB 제약은 row나 table 수준을 잘 닫습니다. `UNIQUE(tenant_id, sku)`, `NOT NULL`, `CHECK(amount >= 0)` 같은 형태입니다. 하지만 운영 사고는 자주 여러 row, 여러 시스템, 여러 시간대를 건드립니다.

예를 들면 아래 규칙은 단순 입력 검증보다 큽니다.

| 도메인 | 불변식 예시 | 깨졌을 때 영향 |
| --- | --- | --- |
| 결제 | 결제 승인 합계는 주문 청구 금액을 초과할 수 없다 | 중복 청구, 정산 오류 |
| 권한 | 사용자는 자신이 속한 tenant 밖의 리소스를 볼 수 없다 | 보안 사고 |
| 재고 | 확정 주문 수량과 예약 수량의 합은 판매 가능 수량을 넘을 수 없다 | 초과 판매 |
| 개인정보 | 삭제 요청이 완료된 식별자는 검색·분석 인덱스에 남지 않아야 한다 | 규정 위반 |
| 상태 | `CANCELED` 주문은 새 배송 작업을 만들 수 없다 | 잘못된 fulfillment |

이 규칙은 "어딘가 코드에 있다"만으로 충분하지 않습니다. 어느 코드에 있는지, DB가 막는지, 캐시나 검색 인덱스에는 언제 반영되는지, 이미 깨졌는지 어떻게 아는지까지 운영 계약으로 가져와야 합니다.

### 2) 모든 불변식을 쓰기 경로에서 100% 막을 수는 없다

가장 안전한 방식은 쓰기 경로에서 깨지는 데이터를 만들지 않는 것입니다. 결제 중복 승인, 권한 상승, 잔액 음수처럼 복구 비용이 큰 규칙은 가능한 한 transaction, unique constraint, 조건부 update, lock row, serializable transaction으로 닫아야 합니다.

하지만 모든 규칙을 같은 방식으로 막을 수는 없습니다. 검색 인덱스 삭제 전파, read model lag, 외부 배송사 상태 동기화처럼 비동기 복사본이 얽힌 규칙은 짧은 지연이 정상입니다. 이때 중요한 것은 "언젠가 맞겠지"가 아니라 허용 지연을 숫자로 정하는 것입니다.

초기 기준은 아래처럼 둘 수 있습니다.

- P0 불변식: 쓰기 경로 fail-closed, 위반 감지 1건이면 Sev 분류
- P1 불변식: 허용 지연 p95 30초~5분, residual count 임계치 초과 시 알람
- P2 불변식: 일 1회 이상 검증, 추세 악화 시 backlog ticket
- 고위험 도메인: 금전·권한·개인정보·재고는 "위반 건수 0"을 기본 목표로 둠
- 파생 데이터: 검색·추천·통계는 freshness SLO와 원본 재확인 경로를 함께 둠

### 3) Registry는 문서가 아니라 실행 가능한 색인이다

불변식 목록을 위키에만 쓰면 금방 오래됩니다. Registry는 최소한 detection query, metric, owner, correction path와 연결되어야 합니다.

```yaml
domain_invariant:
  id: INV-PAYMENT-001
  name: "captured_amount_must_not_exceed_order_total"
  owner: payments-platform
  severity: P0
  source_of_truth: payment_ledger
  guarantee_layer:
    - db_unique_constraint
    - conditional_update
    - reconciliation_query
  detection:
    schedule: "*/5 * * * *"
    expected_violation_count: 0
    alert_after: "1 violation"
  correction:
    path: "manual_approval_correction_job"
    required_evidence:
      - before_after_ledger_sample
      - amount_delta_sum
      - affected_user_count
  closure:
    residual_count: 0
    reconciliation_rerun: passed
```

이 정도 필드가 있으면 장애 때 질문이 달라집니다. "결제 데이터 이상한 것 같아요"가 아니라 "INV-PAYMENT-001 위반 3건, 총 금액 42,000원, correction job 승인 필요"처럼 말할 수 있습니다.

### 4) 불변식 위반은 원인보다 먼저 영향도를 분류한다

운영 중 불변식 위반이 나오면 개발자는 원인을 찾고 싶어 합니다. 물론 원인 분석은 필요합니다. 하지만 먼저 할 일은 영향도 분류입니다. 고객에게 노출됐는지, 자동 보정 가능한지, 쓰기 경로를 잠시 닫아야 하는지 판단해야 합니다.

분류 기준은 아래 순서가 현실적입니다.

1. 고객 데이터, 금전, 권한, 삭제/비공개 노출 여부
2. 현재도 위반이 증가 중인지, 과거 잔여분인지
3. source of truth가 명확한지
4. 자동 보정 가능한지, 승인 보정이 필요한지
5. 재발 방지를 위해 쓰기 경로를 즉시 차단해야 하는지

source of truth가 흔들리는 경우에는 보정이 아니라 동결이 먼저입니다. 어느 값이 맞는지 모르는 상태에서 correction job을 돌리면 원장과 감사 로그까지 오염될 수 있습니다.

## 실무 적용

### 1) 핵심 불변식 10개부터 시작한다

처음부터 모든 규칙을 등록하려 하면 실패합니다. 우선순위는 복구 비용 기준으로 잡습니다.

- 결제·환불·포인트·정산: 금액 합계, 중복 효과, ledger balance
- 권한·tenant: tenant boundary, 관리자 권한, 정책 캐시 무효화
- 개인정보·삭제: 삭제 전파, 검색/분석 인덱스 잔존, 외부 전송
- 재고·예약: 예약 만료, 확정 수량, 초과 판매
- 공개 상태: 스캔 전 파일 공개, 비공개 콘텐츠 노출

각 도메인에서 2개씩만 뽑아도 10개가 됩니다. 이 10개는 PR 템플릿, 테스트, reconciliation, 알람, correction job 중 적어도 하나와 연결합니다.

### 2) 보장 위치를 네 층으로 나눈다

불변식마다 어디서 보장할지 정합니다.

| 보장 위치 | 적합한 규칙 | 예시 |
| --- | --- | --- |
| DB 제약 | 단일 row, unique, 단순 합법 범위 | amount >= 0, unique idempotency key |
| 트랜잭션/도메인 서비스 | 상태 전이, 권한, 재고 차감 | PAID -> CANCELED 조건부 update |
| 비동기 reconciliation | 파생 데이터, 외부 시스템 동기화 | 검색 인덱스 삭제 전파, 배송 상태 비교 |
| correction job | 이미 깨진 데이터 보정 | 누락 포인트 재계산, 잘못된 권한 회수 |

P0는 가능하면 앞 두 층에서 막고, reconciliation은 누락 감시로 둡니다. P1은 비동기 검증과 correction path가 핵심입니다. P2는 일일 리포트로 충분한 경우가 많습니다.

### 3) 알람은 위반 건수보다 위험 조합으로 만든다

불변식 알람을 단순 카운터로 만들면 노이즈가 큽니다. 같은 10건이라도 금액 0원인 파생 통계와 관리자 권한 부여는 위험이 다릅니다.

권장 알람 기준:

- P0: 1건 발생 즉시 온콜, 15분 내 owner 판정
- P1: residual count 10건 초과 또는 허용 지연 p95 5분 초과 시 알람
- P2: 일일 리포트, 3일 연속 증가 시 backlog 우선순위 상승
- source of truth unknown: 건수와 무관하게 수동 확인
- 같은 invariant가 7일 내 3회 이상 재발하면 재발 방지 ticket 필수

알람 메시지에는 invariant id, owner, detection query version, 위반 샘플, 예상 correction path가 들어가야 합니다. 로그 링크만 던지면 운영자는 다시 추리를 시작해야 합니다.

### 4) PR과 배포에 invariant delta를 붙인다

불변식은 운영 중에만 볼 문제가 아닙니다. 스키마 변경, 상태 전이 변경, 이벤트 소비자 변경, 캐시 정책 변경, 검색 인덱스 변경은 기존 invariant를 약하게 만들 수 있습니다.

고위험 PR에는 아래 질문을 붙입니다.

- 새 불변식이 생기는가?
- 기존 불변식의 보장 위치가 바뀌는가?
- source of truth가 바뀌는가?
- 비동기 지연 허용 시간이 바뀌는가?
- 위반 시 correction path가 있는가?

이 질문은 [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)과 비슷합니다. API 계약을 깨면 consumer가 깨지듯, 도메인 불변식을 바꾸면 운영 데이터 품질이 깨집니다.

### 5) 운영 리포트는 "위반 수"보다 종료 가능성을 보여준다

불변식 리포트는 단순히 `violation_count=37`을 보여주면 부족합니다. 운영자가 알고 싶은 것은 "지금 고객 영향이 있는가", "어떤 원장을 기준으로 맞출 수 있는가", "보정을 끝냈다고 말할 수 있는가"입니다. 그래서 리포트는 위반 수, 영향 추정, source of truth, 보정 상태, 종료 조건을 같이 보여줘야 합니다.

예를 들어 권한 캐시 불일치 리포트는 아래처럼 나눌 수 있습니다.

| 필드 | 예시 | 해석 |
| --- | --- | --- |
| invariant_id | INV-AUTH-003 | tenant boundary 관련 규칙 |
| current_violations | 12 | 지금 탐지된 불일치 건수 |
| customer_exposed | 0 | 실제 노출 증거가 있는 건수 |
| source_of_truth | auth_policy_ledger | 보정 기준이 되는 원장 |
| oldest_violation_age | 8m | 허용 지연 초과 여부 판단 |
| correction_state | pending_approval | 자동 보정이 아니라 승인 대기 |
| close_condition | residual_count=0 and rerun_passed | 종료 선언 기준 |

이 형식이 있으면 팀은 "몇 건이냐"보다 "어떤 경로로 닫을 수 있느냐"를 먼저 봅니다. 특히 금전·권한·개인정보 규칙은 고객 노출 증거가 0이어도 source of truth가 불명확하면 보류가 맞습니다. 반대로 source of truth가 명확하고 residual count가 작으면 승인 보정으로 빠르게 닫을 수 있습니다.

### 6) 도입 순서는 incident 후보에서 역산한다

처음 registry를 만들 때는 도메인 모델을 위에서 아래로 훑는 것보다 최근 장애, CS, 수동 보정, 정산 차이, 권한 문의에서 역산하는 편이 빠릅니다. 이미 비용을 만든 사건은 좋은 후보입니다.

도입 순서 예시는 아래처럼 잡을 수 있습니다.

1. 최근 3개월의 데이터 보정 ticket과 장애 리포트를 모은다.
2. 각 사건에서 "깨졌던 규칙"을 한 문장으로 쓴다.
3. 그 규칙이 입력 검증, DB 제약, 도메인 서비스, reconciliation 중 어디에서 빠졌는지 표시한다.
4. 고객 영향과 복구 비용으로 P0/P1/P2를 정한다.
5. detection query와 correction path가 없는 P0/P1부터 registry에 올린다.

이 방식은 완벽한 분류표를 만드는 시간을 줄여 줍니다. 운영 비용을 이미 만든 규칙부터 계약으로 바꾸기 때문에 팀이 바로 필요성을 느낍니다. 나중에 도메인별 coverage를 넓히면 됩니다.

## 트레이드오프/주의점

첫째, registry는 너무 크게 시작하면 유지되지 않습니다. "모든 비즈니스 규칙"이 아니라 "깨졌을 때 운영 사고가 되는 규칙"부터 등록해야 합니다.

둘째, P0를 너무 많이 만들면 모두가 P0가 아닙니다. 한 건이라도 즉시 고객 피해, 보안 사고, 금전 불일치로 이어지는 규칙만 P0로 둡니다. 나머지는 허용 지연과 보정 경로를 숫자로 정의하는 편이 더 현실적입니다.

셋째, detection query가 source of truth를 잘못 잡으면 오탐이나 오보정이 생깁니다. 특히 파생 테이블끼리 비교하면 둘 다 틀릴 수 있습니다. 핵심 규칙은 원장, 이벤트 로그, 감사 로그처럼 더 신뢰도 높은 기준과 비교해야 합니다.

넷째, 불변식 위반을 자동 보정할 때는 오보정 비용을 봐야 합니다. 위반 100건을 자동으로 고치는 것보다 잘못 고친 1건이 더 비쌀 수 있습니다. 금전, 권한, 개인정보는 자동 보정보다 승인 보정이 기본입니다.

의사결정 우선순위는 **고객 피해 차단 > source of truth 고정 > 쓰기 경로 방어 > 탐지 신뢰도 > 보정 속도**입니다. 빠른 알람과 빠른 보정은 이 순서를 지킬 때만 의미가 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 금전, 권한, 개인정보, 재고, 공개 상태에서 핵심 불변식을 각각 2개 이상 골랐다.
- [ ] 각 불변식에 owner, severity, source of truth, detection query가 있다.
- [ ] P0/P1/P2별 허용 지연과 알람 기준이 숫자로 정의돼 있다.
- [ ] 불변식마다 보장 위치가 DB, 도메인 서비스, reconciliation, correction job 중 어디인지 명시돼 있다.
- [ ] 위반 발생 시 자동 보정, 승인 보정, 동결 중 어떤 경로로 갈지 정해져 있다.
- [ ] 고위험 PR 템플릿에 invariant delta 질문이 포함돼 있다.
- [ ] 같은 invariant 재발 시 재발 방지 ticket이 자동 생성된다.

### 연습

1. 현재 서비스에서 "깨지면 가장 비싼 데이터 규칙" 5개를 적고 P0/P1/P2로 나눠 보세요. 금액, 권한, 개인정보가 포함되면 왜 그 등급인지 숫자로 설명합니다.
2. 주문 도메인의 `CANCELED 주문은 배송 생성 불가` 규칙을 registry 항목으로 작성해 보세요. 쓰기 경로 방어, detection query, correction path를 각각 분리합니다.
3. 검색 인덱스 삭제 전파 규칙을 P1로 두고 `delete lag p95`, `residual count`, `alert_after` 기준을 정해 보세요.
4. 최근 데이터 보정 사례 하나를 골라 어떤 invariant가 registry에 없어서 늦게 발견됐는지 역추적해 보세요.
