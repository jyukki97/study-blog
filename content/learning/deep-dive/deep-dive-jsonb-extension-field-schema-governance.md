---
title: "백엔드 커리큘럼 심화: JSONB 확장 필드와 스키마 거버넌스, 빠른 변경과 운영 가능성 사이의 균형"
date: 2026-05-13
draft: false
topic: "JSONB Schema Governance"
tags: ["PostgreSQL", "JSONB", "Schema Design", "Data Modeling", "Backend Architecture", "Operations"]
categories: ["Backend Deep Dive"]
description: "JSONB나 확장 필드가 빠른 제품 변경에 도움이 되는 경우와, 검증·인덱스·마이그레이션·리포팅 비용을 폭발시키는 경우를 구분하고 운영 기준으로 설계하는 방법을 정리합니다."
module: "backend-data-system-phase"
study_order: 1230
---

제품 요구사항이 자주 바뀌면 백엔드 팀은 금방 유혹을 받습니다. `orders` 테이블에 컬럼을 계속 추가하는 대신 `metadata JSONB` 하나를 두고, 고객별 옵션·실험 필드·외부 연동 payload를 넣으면 당장은 훨씬 빠릅니다. 배포 없이 필드를 늘릴 수 있고, 일부 고객에게만 필요한 값을 저장하기도 쉽습니다. 문제는 이 편함이 오래 가지 않는 경우가 많다는 점입니다. JSONB 필드가 검증되지 않은 쓰기 경로, 무제한 쿼리 조건, 임의 인덱스, 리포팅 의존성으로 번지면 스키마가 사라진 것이 아니라 **스키마가 코드·쿼리·대시보드 곳곳에 흩어진 상태**가 됩니다.

그래서 JSONB를 쓸지 말지는 "정규화가 정답인가, 유연성이 정답인가"의 문제가 아닙니다. 핵심은 **변경 속도와 운영 가능성 사이의 계약을 어디에 둘 것인가**입니다. 이 글은 [DB 스키마 설계 기본기](/learning/deep-dive/deep-dive-database-schema-design-basics/), [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/), [Online DDL + Expand/Contract](/learning/deep-dive/deep-dive-online-ddl-expand-contract/), [Query Plan Regression Guardrail](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)과 연결해서 JSONB 확장 필드를 실무적으로 다루는 기준을 정리합니다.

## 이 글에서 얻는 것

- JSONB, EAV, 정규 컬럼, 별도 확장 테이블을 어떤 조건에서 고를지 판단할 수 있습니다.
- JSONB 필드에도 version, validation, owner, promotion 기준이 필요하다는 점을 운영 관점에서 이해할 수 있습니다.
- 인덱스·통계·리포팅·마이그레이션 비용을 숫자로 보며 JSONB 남용을 줄이는 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) JSONB는 스키마가 없는 저장소가 아니라 늦게 고정하는 스키마다

JSONB의 장점은 초기 불확실성을 흡수하는 데 있습니다. 외부 결제사 webhook payload, 고객별 선택 옵션, 실험군별 임시 속성, 아직 제품 의미가 확정되지 않은 설정값처럼 변화가 빠른 데이터는 처음부터 정규 컬럼으로 고정하면 변경 비용이 큽니다. 반대로 주문 금액, 사용자 상태, 권한, 정산 기준처럼 비즈니스 불변식에 가까운 값은 JSONB에 넣는 순간 검증과 감사가 어려워집니다.

실무 기준은 아래처럼 잡는 편이 안전합니다.

| 데이터 성격 | 권장 모델 | 이유 |
| --- | --- | --- |
| 핵심 조회·정렬·조인 조건 | 정규 컬럼 | 인덱스, 제약조건, 실행계획 예측 가능 |
| 고객별 선택 필드 5~20개 수준 | JSONB + 필드 allowlist | 빠른 변경과 제한된 유연성 균형 |
| 고객별 필드가 수백 개 이상이고 검색 조건이 많음 | 별도 extension table 또는 검색 인덱스 | JSONB 하나로는 검증·쿼리 비용 폭증 |
| 외부 원본 payload 보관 | raw JSONB + canonical 컬럼 분리 | 재처리 근거와 운영 필드를 분리 |
| 규제·정산·권한 판단 값 | 정규 컬럼 + 감사 로그 | 변경 추적과 설명 가능성이 우선 |

중요한 숫자는 "필드 개수"보다 **운영 의존성**입니다. JSONB 안의 특정 키가 배치, 알림, 정산, 권한, 리포팅 중 두 곳 이상에서 쓰이기 시작하면 더 이상 임시 필드가 아닙니다. 이때는 promotion 후보로 보고 정규 컬럼이나 별도 테이블로 올릴 준비를 해야 합니다.

### 2) 검증은 애플리케이션 DTO만으로 끝나지 않는다

JSONB 남용의 첫 번째 사고는 쓰기 경로가 여러 개가 되면서 발생합니다. API는 DTO validation을 통과하지만, 배치 import, 관리자 도구, 데이터 보정 스크립트, 외부 연동 재처리 경로가 같은 JSONB를 다른 모양으로 쓰기 시작합니다. 한 달 뒤에는 `customerType`, `customer_type`, `type`이 같은 의미로 공존합니다.

그래서 JSONB 필드는 최소한 세 겹의 검증이 필요합니다.

1. **쓰기 API 검증**: 허용 key, type, enum, size 제한을 DTO나 JSON Schema로 검증한다.
2. **저장 전 canonicalization**: key naming, 날짜 포맷, 숫자 단위, null 처리 규칙을 통일한다.
3. **운영 검증 잡**: 실제 저장된 JSONB에서 unknown key, type mismatch, payload size p95를 주기적으로 집계한다.

초기 기준은 단순해도 됩니다.

```text
unknown_key_ratio < 0.1%
jsonb_payload_size_p95 < 8KB
jsonb_write_validation_fail_rate < 1%
query_predicate_on_jsonb_keys <= 5개 핵심 키
```

이 수치를 넘으면 "유연한 필드"가 아니라 "관리되지 않는 스키마"가 되고 있다는 신호입니다. 특히 payload p95가 8~16KB를 넘어가면 row bloat, TOAST 접근, 네트워크 전송량, audit log 비용까지 같이 봐야 합니다. 이 부분은 [PostgreSQL Index Bloat 운영](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/)과도 연결됩니다.

### 3) JSONB 인덱스는 만능이 아니라 쿼리 계약의 결과다

`GIN` 인덱스를 하나 만들면 JSONB 검색 문제가 끝난다고 생각하기 쉽습니다. 하지만 JSONB 인덱스는 쓰기 비용과 저장 공간을 늘립니다. 또한 `metadata->>'status'`, `metadata @> ...`, `metadata ? 'key'` 같은 연산자에 따라 인덱스 활용 방식이 달라집니다. 쿼리 패턴이 고정되지 않은 상태에서 범용 GIN 인덱스를 먼저 만들면, 읽기보다 쓰기 비용이 먼저 늘어날 수 있습니다.

운영에서는 아래 순서가 낫습니다.

1. 최근 7~14일 slow query에서 JSONB predicate를 모은다.
2. 상위 3개 query shape만 인덱스 후보로 둔다.
3. equality 조건은 expression index, 포함 검색은 제한된 GIN을 검토한다.
4. 인덱스 추가 전후 write latency p95, index size, plan stability를 비교한다.
5. 30일 동안 사용되지 않은 JSONB 인덱스는 제거 후보로 둔다.

예를 들어 `metadata->>'plan' = 'enterprise'`가 자주 쓰이고 cardinality가 충분하다면 expression index가 더 예측 가능할 수 있습니다.

```sql
CREATE INDEX CONCURRENTLY idx_accounts_metadata_plan
ON accounts ((metadata->>'plan'));
```

반대로 고객별 임의 필드를 자유 검색해야 한다면 RDB 테이블에서 해결할 문제가 아닐 수 있습니다. 이 경우는 검색 전용 인덱스, 별도 projection, 또는 고객별 custom field 모델을 검토해야 합니다. JSONB를 선택했으니 모든 검색도 JSONB로 해야 한다는 규칙은 없습니다.

## 실무 적용

### 1) 확장 필드 등록부를 둔다

JSONB를 오래 안전하게 쓰려면 필드 등록부가 필요합니다. 거창한 플랫폼이 아니어도 됩니다. 처음에는 YAML, DB table, 내부 문서 중 하나로 아래 정보를 관리하면 충분합니다.

```yaml
metadata_fields:
  - key: billing_cycle
    type: enum
    allowed_values: [monthly, yearly]
    owner: billing-platform
    introduced_at: 2026-05-13
    status: active
    promote_if:
      query_per_day: 10000
      used_by_domains: 2
      retention_days: 365
  - key: onboarding_source
    type: string
    max_length: 64
    owner: growth
    status: experimental
    expires_at: 2026-06-30
```

등록부의 핵심은 문서화가 아니라 **승격과 만료 기준**입니다. `experimental` 필드는 기본 만료일을 30~60일로 둡니다. 만료 후에도 계속 쓰이면 owner가 유지·삭제·정규화 중 하나를 선택해야 합니다. 이 규칙이 없으면 JSONB는 실험 필드의 무덤이 됩니다.

### 2) promotion lane을 Online DDL과 연결한다

JSONB key가 정규 컬럼으로 승격되는 순간을 별도 프로젝트처럼 다루면 부담이 큽니다. 대신 반복 가능한 promotion lane을 만들어야 합니다.

1. JSONB key 사용량과 의미를 확정한다.
2. nullable 컬럼을 추가한다.
3. 새 쓰기 경로에서 JSONB와 정규 컬럼을 dual-write한다.
4. 과거 데이터를 cursor batch로 backfill한다.
5. 읽기 경로를 정규 컬럼 우선으로 바꾼다.
6. 불일치율이 0.01% 미만으로 7일 유지되면 JSONB key를 deprecated로 표시한다.
7. 보존 기간 이후 JSONB key 제거 또는 raw payload 전용으로 축소한다.

이 흐름은 [Online DDL + Expand/Contract](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)와 거의 같습니다. 차이는 소스가 기존 컬럼이 아니라 JSONB key라는 점뿐입니다. 중요한 것은 backfill 중 lock을 길게 잡지 않고, 불일치 측정을 먼저 넣는 것입니다.

### 3) 리포팅과 분석은 raw JSONB를 직접 물지 않게 한다

운영 DB의 JSONB를 BI 쿼리가 마음대로 파기 시작하면 성능과 의미가 동시에 흔들립니다. 제품팀이 임시 필드를 보고 싶어 하는 것은 자연스럽지만, production read path와 분석 path를 섞으면 장애가 납니다.

권장 순서는 아래와 같습니다.

- 실시간 API 조건: 정규 컬럼 또는 제한된 expression index만 허용
- 운영 대시보드: 검증된 projection table 사용
- 장기 분석: ETL에서 schema version을 붙여 warehouse로 적재
- 원본 재처리: raw JSONB는 근거로 보관하되 직접 조인하지 않음

특히 고객별 필드가 과금, 세그먼트, 권한에 들어가기 시작하면 [Usage Metering·Quota·청구 정합성](/learning/deep-dive/deep-dive-usage-metering-quota-billing-consistency/)처럼 원장성 데이터와 연결됩니다. 이 구간에서는 JSONB 유연성보다 재현성과 감사 가능성이 우선입니다.

## 트레이드오프/주의점

첫째, JSONB는 초기 제품 속도를 올리지만 장기 타입 안정성을 낮춥니다. 그래서 실험 필드에는 좋고 핵심 도메인 불변식에는 약합니다.

둘째, DB 제약조건을 잃으면 애플리케이션 검증 품질이 곧 데이터 품질이 됩니다. 쓰기 경로가 하나일 때는 괜찮아 보여도, import·batch·admin·migration이 늘면 금방 깨집니다.

셋째, 인덱스 비용이 늦게 보입니다. 처음에는 데이터가 작아 모든 쿼리가 빠르지만, JSONB predicate가 늘고 GIN 인덱스가 커지면 write amplification과 vacuum 비용이 올라갑니다.

넷째, 개인정보와 보존 정책을 잊기 쉽습니다. JSONB raw payload에 이메일, 주소, 외부 식별자, 결제 보조 정보가 섞이면 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 충돌합니다. 삭제 요청이 왔을 때 어느 key를 지워야 하는지 모르면 이미 늦습니다.

다섯째, JSONB가 멀티테넌트 커스텀 필드의 정답은 아닙니다. 대형 고객이 수백 개 필드를 만들고 필드별 검색·정렬·권한을 요구하면, 테넌트별 extension schema나 별도 custom field service가 더 안전할 수 있습니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] JSONB 필드 등록부에 owner, type, status, expires_at이 있다.
- [ ] unknown key와 type mismatch를 주기적으로 측정한다.
- [ ] payload size p95와 row bloat를 대시보드에서 본다.
- [ ] JSONB predicate 상위 query shape 3개를 알고 있다.
- [ ] JSONB key가 두 개 이상 도메인에서 쓰이면 promotion 후보로 표시한다.
- [ ] 정규 컬럼 승격을 위한 dual-write, backfill, 검증 절차가 있다.
- [ ] raw payload에 개인정보와 보존 대상 필드가 섞이지 않게 분류한다.

### 연습

1. 현재 서비스에서 `metadata`, `extra`, `attributes`, `payload` 이름의 JSON/JSONB 컬럼을 찾아 key 목록을 뽑아 보세요. owner가 없는 key가 몇 개인지 세는 것만으로도 위험도가 보입니다.
2. JSONB key 하나를 골라 최근 14일 query log에서 predicate 사용 횟수, slow query 포함 여부, 인덱스 사용 여부를 확인해 보세요.
3. 실험 필드 하나에 대해 `30일 후 삭제`, `정규 컬럼 승격`, `raw payload 보관` 세 가지 경로 중 어떤 기준으로 결정할지 표로 작성해 보세요.
4. JSONB에서 정규 컬럼으로 옮기는 backfill을 10만 row 단위 cursor batch로 설계하고, 불일치율 0.01% 미만을 검증하는 쿼리를 만들어 보세요.

정리하면 JSONB는 피해야 할 기능이 아닙니다. 오히려 제품 변화가 빠른 팀에게 매우 유용합니다. 다만 JSONB를 쓰는 순간 스키마 설계가 사라지는 것이 아니라, 스키마를 늦게 고정할 책임이 생깁니다. 좋은 팀은 이 책임을 등록부, 검증, promotion lane, 인덱스 예산으로 다룹니다. 나쁜 팀은 `metadata` 컬럼 하나에 미래의 운영 비용을 전부 숨깁니다.
