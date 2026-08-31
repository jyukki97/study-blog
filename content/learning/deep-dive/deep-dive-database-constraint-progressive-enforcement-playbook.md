---
title: "백엔드 커리큘럼 심화: DB 제약조건을 점진적으로 강화하는 운영 플레이북"
date: 2026-08-26T10:06:00+09:00
lastmod: 2026-08-26T10:06:00+09:00
draft: false
topic: "Backend Data Integrity"
tags: ["Database", "Constraints", "PostgreSQL", "Schema Migration", "Data Integrity", "Backend Operations"]
categories: ["Backend Deep Dive"]
module: "backend-data-system"
study_order: 1453
keywords: ["DB constraint rollout", "NOT VALID", "PostgreSQL constraint validation", "데이터베이스 제약조건", "점진적 제약 강화"]
description: "CHECK·FOREIGN KEY·UNIQUE 제약을 기존 데이터와 온라인 트래픽을 망가뜨리지 않고 강화하기 위한 사전 정리, 점진 검증, 집행, 관측, 롤백 기준을 정리합니다."
summary: "DB 제약조건은 선언 한 줄이 아니라 쓰기 경로를 차단하는 운영 변경입니다. 기존 위반 데이터를 먼저 가시화하고, 새 쓰기부터 막은 뒤, 검증과 계약 변경을 분리해야 안전합니다."
key_takeaways:
  - "제약조건은 데이터 품질의 최종 방어선이지만, 기존 데이터·배치·구버전 애플리케이션을 동시에 만나는 배포 변경이기도 하다."
  - "새 쓰기를 빠르게 보호하는 단계와 과거 데이터를 검증·정리하는 단계를 분리하면 대형 테이블에서도 실패 반경을 줄일 수 있다."
  - "제약 위반 수, 검증 소요 시간, lock wait, write 오류율, 우회 경로를 함께 봐야 제약 강화가 실제 정합성 개선인지 판단할 수 있다."
learning_refs:
  - title: "Domain Invariant Registry와 데이터 품질"
    href: "/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/"
    description: "어떤 업무 규칙을 DB 제약으로 닫고 어떤 규칙을 reconciliation으로 다룰지 먼저 분류합니다."
  - title: "온라인 스키마 변경과 Expand-Contract"
    href: "/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/"
    description: "DDL, 코드 배포, 백필을 분리해 공유 상태를 안전하게 바꾸는 기본 절차입니다."
  - title: "Snapshot Isolation과 Write Skew"
    href: "/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/"
    description: "단순 제약만으로 막기 어려운 여러 행·여러 트랜잭션의 경쟁 조건을 다룹니다."
  - title: "Correction Job 감사 가드레일"
    href: "/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/"
    description: "기존 위반 데이터를 자동 또는 승인 기반으로 안전하게 보정하는 기준입니다."
---

`NOT NULL`, `UNIQUE`, `CHECK`, `FOREIGN KEY`는 SQL 문법의 작은 기능처럼 보이지만 운영에서는 가장 강한 데이터 품질 장치입니다. 애플리케이션 검증은 버그, 우회 배치, 오래된 관리 도구, 동시성 경쟁을 놓칠 수 있습니다. 반면 DB 제약은 실제 쓰기가 저장되기 직전에 공통으로 적용됩니다. 그래서 잔액 음수, 중복 외부 결제 ID, 존재하지 않는 부모를 가리키는 자식 행처럼 **DB 자체가 판정할 수 있는 규칙**은 가능하면 제약으로 닫는 편이 안전합니다.

다만 운영 DB에 제약 하나를 추가하는 일은 `ALTER TABLE` 한 줄로 끝나지 않습니다. 이미 잘못된 행이 있을 수 있고, 구버전 앱이나 ETL이 새 규칙을 모를 수 있으며, 검증 스캔과 잠금이 온라인 트래픽을 밀 수 있습니다. 이 글은 [Domain Invariant Registry와 데이터 품질](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/), [온라인 스키마 변경과 Expand-Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/), [Snapshot Isolation과 Write Skew](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)를 바탕으로, 제약을 **점진적으로 집행하는 운영 변경**으로 다룹니다.

## 이 글에서 얻는 것

- 어떤 데이터 규칙을 DB 제약으로 두고, 어떤 규칙을 애플리케이션·재조정 작업으로 남겨야 하는지 구분합니다.
- 기존 위반 데이터가 있는 테이블에서 새 쓰기 방어와 과거 데이터 정리를 분리하는 순서를 익힙니다.
- PostgreSQL의 `NOT VALID`와 `VALIDATE CONSTRAINT` 같은 점진 검증의 의미를 이해하고, 엔진별 차이도 확인합니다.
- 제약 추가를 배포·관측·롤백 기준이 있는 변경으로 리뷰하는 체크리스트를 얻습니다.

## 핵심 개념/이슈

### 1) DB 제약은 모든 불변식을 대신하지 않지만, 강한 규칙에는 가장 낮은 층이다

DB가 잘 막을 수 있는 규칙은 범위와 대상이 명확합니다.

| 규칙 | 적합한 방어선 | 예시 |
| --- | --- | --- |
| 한 행 값의 범위 | `CHECK`, `NOT NULL` | `amount >= 0`, `currency IS NOT NULL` |
| 한 테이블 안의 중복 금지 | `UNIQUE` | `(tenant_id, external_payment_id)` |
| 부모 행 존재 | `FOREIGN KEY` | `order_item.order_id -> orders.id` |
| 상태값 집합 | enum 또는 `CHECK` | `status IN ('PENDING', 'PAID', 'CANCELED')` |
| 여러 행 합계·시간 순서 | 트랜잭션/조건부 update | 재고 잔량, 중복 승인 |
| 외부 시스템과의 정합성 | outbox + reconciliation | 배송사·검색 인덱스 반영 |

예를 들어 `order_item.order_id`의 부모 존재는 foreign key가 정확히 책임질 수 있습니다. 반면 “결제 승인 합계가 주문 금액을 넘지 않는다”는 여러 행과 동시 요청을 함께 보므로 단순 `CHECK`만으로 닫기 어렵습니다. 후자는 [도메인 불변식 운영](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)과 [트랜잭션 격리 수준](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)을 결합해야 합니다.

핵심 원칙은 **DB가 결정할 수 있는 규칙은 DB에도 기록하고, DB가 결정할 수 없는 규칙은 DB 제약인 척하지 않는다**입니다. 애플리케이션 코드에만 중복 방지 로직을 두면, 재처리 배치나 새 관리 API가 그 규칙을 빼먹는 순간 정합성이 깨집니다. 반대로 여러 서비스의 비동기 복사본까지 한 DB constraint로 해결하려 하면 거짓 안전감만 생깁니다.

### 2) 제약 추가에는 "새 쓰기 방어"와 "기존 데이터 검증"이라는 두 작업이 있다

이미 운영 중인 테이블에 foreign key를 곧바로 추가하면 DB는 기존 행까지 검사하려 합니다. 데이터가 크거나 위반 행이 있으면 migration이 실패하거나 오래 걸릴 수 있습니다. 이때 가장 먼저 나눠야 할 질문은 다음 둘입니다.

1. **오늘부터 들어오는 새 쓰기를 막아야 하는가?**
2. **과거 행을 언제, 어떤 속도로 조사·보정할 것인가?**

PostgreSQL에서는 `CHECK`와 `FOREIGN KEY`에 `NOT VALID`를 사용해 이 분리를 할 수 있습니다. 제약을 먼저 등록하면 이후의 insert/update에는 규칙이 적용되지만, 기존 행 전체를 즉시 통과시키지는 않습니다. 이후 별도 창에서 `VALIDATE CONSTRAINT`를 실행해 과거 행을 검증합니다. 예시는 아래와 같습니다.

```sql
-- 1. 이후 쓰기부터 잘못된 상태를 차단한다.
ALTER TABLE orders
  ADD CONSTRAINT orders_amount_nonnegative
  CHECK (amount >= 0) NOT VALID;

-- 2. 위반 수와 원인을 먼저 확인·보정한 뒤 별도로 검증한다.
ALTER TABLE orders
  VALIDATE CONSTRAINT orders_amount_nonnegative;
```

이 문법이 모든 제약에 똑같이 적용되는 것은 아닙니다. 특히 unique 보장은 인덱스 생성 방식과 데이터베이스 엔진별 온라인 DDL 제약을 따로 검토해야 합니다. PostgreSQL에서는 대형 테이블에서 `CREATE UNIQUE INDEX CONCURRENTLY`로 인덱스를 먼저 만든 뒤 제약에 연결하는 선택지가 있지만, MySQL·관리형 DB·구버전에서는 잠금 모델과 지원 범위가 다릅니다. 따라서 “온라인”이라는 단어만 믿지 말고 **실제 엔진 버전, 테이블 크기, 복제 구성, DDL timeout**을 릴리스 계획에 적어야 합니다.

### 3) 위반 데이터는 DELETE부터 하지 말고 증거와 분류부터 만든다

`UNIQUE`를 넣기 전 중복 `external_payment_id`를 찾았다고 해서 한쪽 행을 자동 삭제하면 안 됩니다. 정상 결제 재시도인지, 과거 버그인지, 두 행 모두 다른 후속 작업을 만들었는지 먼저 알아야 합니다. 정리 작업은 데이터 클렌징이 아니라 업무 상태를 바꾸는 변경입니다.

위반 후보는 최소한 다음 필드로 분류합니다.

| 필드 | 예시 | 필요한 이유 |
| --- | --- | --- |
| constraint 후보 | `uq_payment_provider_reference` | 어떤 규칙을 강화하는지 식별 |
| 발견 시각·쿼리 버전 | `2026-08-26`, `v3` | 재현 가능한 조사 |
| 건수·영향 범위 | 17건, tenant 3개 | 우선순위와 승인 범위 |
| source of truth | PG ledger, provider settlement | 어떤 값이 맞는지 판단 |
| 보정 방식 | merge, 재처리, 수동 검토 | 무조건 삭제 방지 |
| 종료 조건 | 재검증 0건 + constraint valid | 완료 선언 기준 |

금전·권한·개인정보처럼 P0 성격의 데이터는 자동 삭제보다 승인 기반 보정이 기본입니다. 반대로 오래된 테스트 데이터나 명확한 임시 상태처럼 영향이 작고 source of truth가 분명한 경우만 제한된 자동 보정을 검토합니다. [Correction Job 감사 가드레일](/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/)의 before/after 증거와 재실행 기준을 같은 변경에 포함하면 나중에 "왜 이 행을 고쳤는가"를 설명할 수 있습니다.

### 4) 제약 위반은 버그 신호이면서 호환성 실패 신호이기도 하다

제약을 켠 직후 오류가 증가했다면 DB가 갑자기 문제를 만든 것이 아닙니다. 기존에 숨어 있던 잘못된 쓰기 경로가 표면으로 나온 것입니다. 다만 사용자 요청을 막는 결과가 생길 수 있으므로, 단순히 DB 오류만 모으지 말고 어느 producer가 어떤 이유로 거절됐는지 구분해야 합니다.

권장하는 관측 항목은 다음과 같습니다.

- constraint 이름별 `23505`(unique), `23503`(foreign key), `23514`(check) 오류 수와 호출자
- 새 제약 대상 API의 4xx/5xx 비율과 write p95
- DDL·검증 중 lock wait, statement timeout, replication lag
- 우회 배치·관리 API·ETL별 실패 건수
- `NOT VALID` 상태로 남은 제약의 나이와 owner

새 제약에서 오류가 평소 쓰기 요청의 **0.1%를 넘거나**, critical API의 p95가 기준선보다 **20% 이상** 악화하면 rollout을 멈추고 호출자 호환성을 먼저 확인하는 것이 출발점입니다. 이 수치는 팀의 트래픽과 오류 예산에 맞게 조정하되, 배포 전에 “어느 수치에서 멈출지”를 정해 둬야 합니다.

## 실무 적용

### 1) 제약 하나를 5단계 변경으로 쪼갠다

`payments(provider, provider_reference)`의 중복을 막는 unique 제약을 추가한다고 가정해 보겠습니다.

**1단계 — 규칙과 소비자를 인벤토리한다.** 이 두 필드를 쓰는 API, 메시지 consumer, 재처리 worker, 어드민 도구, 데이터 import를 찾습니다. 값이 `NULL`일 수 있는지, provider마다 reference 형식이 다른지, 과거에 재사용된 값이 있는지 확인합니다. 규칙을 "중복 금지"라고만 적지 말고 "동일 provider 안에서 provider reference는 활성 결제 1건에만 연결된다"처럼 업무 언어로 고정합니다.

**2단계 — shadow query로 기존 위반을 관측한다.** migration 전에 아래처럼 중복 후보를 계산하고, 7일 이상 daily count를 봅니다. 단발성 과거 잔여분인지 지금도 증가하는 버그인지 먼저 구분해야 합니다.

```sql
SELECT provider, provider_reference, COUNT(*) AS duplicate_count
FROM payments
WHERE provider_reference IS NOT NULL
GROUP BY provider, provider_reference
HAVING COUNT(*) > 1;
```

**3단계 — producer를 호환시킨다.** 재시도 consumer가 같은 이벤트를 두 번 실행할 수 있다면, 제약 오류를 일반 500으로 바꾸지 말고 이미 반영된 결과를 조회하거나 idempotency 흐름으로 연결합니다. bulk import는 reject row를 별도 파일·테이블로 돌려보낼지, 전체 batch를 실패시킬지 정책을 정합니다.

**4단계 — 제약을 최소 위험 방식으로 추가한다.** 대형 테이블에서는 엔진 설명서와 스테이징 리허설을 바탕으로 index build, constraint attach, 기존 행 validation을 분리합니다. 진행 중 lock wait, database CPU, replication lag, write error를 보며 예상보다 오래 걸리면 중단할 조건을 적용합니다.

**5단계 — 검증·문서화·우회 제거를 완료한다.** 기존 위반을 승인 절차로 보정하고 validation을 마친 뒤, 임시 application-only check나 예외 import 경로를 제거합니다. DB constraint만 남겨 놓고 producer 오류를 방치하면 고객지원 비용이 커지므로, 오류 semantics와 재시도 규칙도 같이 정리합니다.

### 2) 제약 유형별 기본 의사결정표를 만든다

| 제약 유형 | 먼저 확인할 것 | 시작 방식 | 운영상 주의점 |
| --- | --- | --- | --- |
| `NOT NULL` | 기존 null 비율, backfill 기준 | nullable 추가 → backfill → 검증 → non-null | 기본값이 비즈니스상 유효한지 확인 |
| `CHECK` | 범위 밖 값의 원인·예외 | 새 쓰기 차단 후 기존 행 검증 | enum/정책 변경 때 규칙을 같이 업데이트 |
| `UNIQUE` | 중복의 업무 의미, NULL 처리 | 중복 cleanup → index build → attach | 재시도·재처리와 conflict 응답 설계 |
| `FOREIGN KEY` | orphan row, 삭제 정책 | `NOT VALID` 가능 여부 확인 → validate | cascade가 삭제 폭발을 만들지 않는지 검토 |
| `EXCLUDE`/복합 규칙 | 동시성·범위 겹침 | 작은 canary 테이블/쿼리부터 | lock과 write 경합을 부하 테스트 |

우선순위는 **데이터 손상·보안·금전 차단 > 새 쓰기 보호 > 기존 데이터 정리 > 개발 편의**입니다. 운영이 바쁘다는 이유로 foreign key를 계속 미루면 orphan row를 처리하는 비용이 누적됩니다. 반대로 단순 조회용 통계 테이블에 강한 제약을 성급히 넣어 수집을 멈추는 것도 좋지 않습니다. 영향도와 source of truth에 따라 등급을 나누세요.

### 3) PR 템플릿에 constraint rollout 항목을 넣는다

제약은 DBA나 한 명의 시니어만 아는 변경이 되면 누락됩니다. migration PR에 아래 항목을 고정하면 리뷰의 질문이 일관됩니다.

```text
[Constraint rollout]
- 규칙과 도메인 owner:
- 대상 테이블 / 예상 row 수:
- 기존 위반 shadow query와 최근 7일 결과:
- 새 쓰기·구버전·batch producer 호환성:
- DB 엔진/버전과 온라인 적용 방식:
- 관측 지표와 stop 조건:
- 기존 위반 보정·승인 경로:
- validation 완료 기준과 rollback 범위:
```

이 항목은 문서 작업을 늘리기 위한 것이 아닙니다. 예를 들어 "기존 위반이 0건"이라는 근거가 없으면 unique 제약을 적용하지 않고, "rollback은 migration revert"라고만 쓰여 있으면 실제로 index나 constraint를 제거해도 되는지 다시 묻는 장치입니다. 온라인 스키마 전환과 마찬가지로 **삭제·완화보다 검증과 관측을 먼저** 둡니다.

### 4) 성공은 constraint가 생긴 날이 아니라 우회가 사라진 날에 판단한다

제약을 만들었다고 데이터 품질 문제가 끝나지 않습니다. `NOT VALID` 상태를 몇 달 방치하면 과거 위반을 공식적으로 용인하는 셈이고, application이 오류를 swallow하면 잘못된 write가 사용자에게 조용히 실패할 수 있습니다.

초기 운영 목표는 아래처럼 작게 잡을 수 있습니다.

- 신규 P0/P1 규칙: constraint owner와 validation 목표일을 **PR 안에** 기록
- `NOT VALID` constraint: owner 없는 상태 **0건**, 30일 초과 항목은 주간 리뷰
- constraint error: 새 배포 후 24시간 동안 producer별 top 10을 확인
- 기존 위반 보정: 재실행 가능한 query에서 residual count **0** 확인
- 고위험 제약: validation 뒤 한 번 이상 reconciliation 또는 샘플 audit 통과

이 수치를 [데이터 품질 불변식](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)의 severity, owner, 보정 경로와 묶으면 새 제약이 일회성 migration이 아니라 지속적인 운영 계약이 됩니다.

## 트레이드오프/주의점

1. **강한 제약은 쓰기 가능성을 줄입니다.** 그 대가가 필요한 규칙인지 먼저 판단해야 합니다. 일시적으로 값이 비어도 나중에 보정 가능한 분석 데이터와, 한 번 잘못 저장되면 고객 피해가 나는 결제 참조값을 같은 기준으로 다루면 안 됩니다.
2. **제약은 애플리케이션 오류 처리를 없애지 않습니다.** unique conflict는 정상적인 재시도 결과일 수 있고, foreign key 실패는 호출 순서 버그일 수 있습니다. 어느 오류가 사용자 재시도 가능인지 API error semantics에 명시해야 합니다.
3. **`ON DELETE CASCADE`는 편하지만 영향 반경이 큽니다.** 부모를 삭제할 때 자식이 얼마나 지워지는지 예측·감사할 수 없다면 restrict 또는 명시적 삭제 workflow가 더 안전합니다.
4. **엔진 차이를 일반화하면 안 됩니다.** PostgreSQL의 concurrent index와 `NOT VALID` 경험을 MySQL·Aurora·분산 SQL에 그대로 옮기지 마세요. 지원 문법, metadata lock, replica 적용, statement timeout을 실제 버전 기준으로 확인합니다.
5. **검증 쿼리 자체도 부하를 만들 수 있습니다.** 대형 테이블 full scan을 피크 시간에 반복하지 말고, index·파티션·샤드 단위 또는 read replica 사용 여부를 설계합니다. 검증이 서비스 p95를 악화시키면 정합성 작업도 운영 장애가 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 새 제약이 단일 DB가 판정할 수 있는 규칙인지, 아니면 트랜잭션·reconciliation이 필요한 규칙인지 분류했다.
- [ ] 기존 위반 shadow query, 최근 7일 추세, source of truth를 확인했다.
- [ ] 새 쓰기 보호와 과거 행 validation·보정을 서로 다른 단계로 계획했다.
- [ ] API, batch, ETL, 어드민, 구버전 애플리케이션의 constraint 오류 처리를 확인했다.
- [ ] DB 엔진·버전별 DDL 방식, lock·lag·오류율 stop 조건을 기록했다.
- [ ] `NOT VALID` 또는 임시 우회 경로에 owner와 만료·완료 조건이 있다.
- [ ] validation 후 residual count 0, producer 오류 안정화, audit 증거를 확인했다.

### 연습

1. `orders.customer_id`에 foreign key를 추가한다고 가정하고 orphan row를 찾는 shadow query와 보정 분류표를 작성해 보세요. "삭제" 외에 어떤 처리 경로가 가능한지도 적습니다.
2. `payments(provider, provider_reference)` unique 제약을 추가하는 5단계 rollout을 팀의 DB 엔진과 테이블 크기에 맞춰 써 보세요. 재시도 consumer가 conflict를 받았을 때의 동작도 포함합니다.
3. 최근 migration PR 하나를 골라 "기존 위반 증거 / producer 호환성 / stop 조건 / rollback" 네 칸이 비어 있는지 점검해 보세요.
4. 30일 이상 `NOT VALID` 상태로 남은 제약이 있다고 가정하고, validation을 진행할지 규칙을 폐기할지 결정하는 review 기준을 5줄로 적어 보세요.

## 관련 글

- [Domain Invariant Registry와 데이터 품질](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)
- [온라인 스키마 변경과 Expand-Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)
- [Snapshot Isolation과 Write Skew](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)
- [Correction Job 감사 가드레일](/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/)
