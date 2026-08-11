---
title: "백엔드 커리큘럼 심화: PostgreSQL Generic Plan과 Custom Plan, 파라미터 편향으로 생기는 성능 급락을 진단하는 법"
date: 2026-08-11T10:06:00+09:00
lastmod: 2026-08-11T10:06:00+09:00
draft: false
topic: "Database"
tags: ["PostgreSQL", "Prepared Statement", "Query Plan", "Parameter Skew", "JDBC", "Database Performance"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL prepared statement가 generic plan과 custom plan을 고르는 원리부터 파라미터 편향 진단, JDBC·커넥션 풀 관측, 안전한 완화와 재발 방지 기준까지 정리한 실무 플레이북입니다."
module: "database"
study_order: 1482
summary: "같은 SQL이 어떤 값에서는 빠르고 어떤 값에서는 갑자기 느려진다면 인덱스 유무만 볼 문제가 아닐 수 있습니다. PostgreSQL의 plan cache 선택과 데이터 분포 편향을 분리해 측정하고, force_custom_plan을 임시 처방으로만 쓰는 운영 기준을 정리합니다."
keywords: ["PostgreSQL generic plan", "custom plan", "prepared statement performance", "parameter skew", "plan_cache_mode", "JDBC prepareThreshold"]
key_takeaways:
  - "generic plan은 planning 비용을 줄이지만 tenant·status·기간 값에 따라 결과 건수가 크게 달라지는 쿼리에서는 실행 비용이 급증할 수 있다."
  - "PostgreSQL auto 모드는 처음 5회 custom plan 비용과 generic plan 비용을 비교하므로, 카나리 입력과 실제 트래픽 분포가 다르면 성능 회귀가 늦게 나타날 수 있다."
  - "진단은 SQL 평균 시간이 아니라 query fingerprint별 p95/p99, 파라미터 버킷, generic_plans/custom_plans, 실제 실행 계획을 함께 봐야 한다."
  - "force_custom_plan은 문제 확인과 단기 완화에 유용하지만 세션·트랜잭션 범위를 제한하고 planning CPU와 pool 경계를 같이 검증해야 한다."
operator_checklist:
  - "문제 SQL을 선택도 0.1% 미만·1~10%·30% 초과 파라미터로 나눠 EXPLAIN (ANALYZE, BUFFERS)한다."
  - "pg_prepared_statements의 generic_plans/custom_plans와 pg_stat_statements의 calls, mean, stddev, temp block을 같은 시각대에 기록한다."
  - "JDBC prepareThreshold, ORM query shape, PgBouncer pooling mode, plan_cache_mode 적용 범위를 확인한다."
  - "완화 후 planning time, execution p95/p99, DB CPU, buffer read, connection acquire latency를 최소 30분 비교한다."
learning_refs:
  - title: "Query Plan Regression Guardrail"
    href: "/learning/deep-dive/deep-dive-query-plan-regression-guardrails/"
    description: "통계·인덱스·배포 변화로 생기는 실행 계획 회귀를 CI와 운영에서 탐지하는 기준입니다."
  - title: "PostgreSQL 인덱스 쓰기 증폭 예산"
    href: "/learning/deep-dive/deep-dive-postgresql-index-write-amplification-budget-playbook/"
    description: "새 인덱스를 추가하기 전에 읽기 이득과 쓰기 비용을 함께 계산하는 기준입니다."
  - title: "Partial Index와 Covering Index"
    href: "/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/"
    description: "편향된 조건에 맞는 작은 인덱스를 설계하는 실무 기준입니다."
  - title: "Connection Pool Sizing과 Saturation"
    href: "/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/"
    description: "느린 실행 계획이 커넥션 풀 포화로 번지는 경로를 함께 보는 글입니다."
decision_guide:
  title: "Plan Cache 문제를 어떻게 완화할까"
  intro: "느린 prepared statement를 발견했다고 곧바로 prepared statement를 끄거나 force_custom_plan을 전역 적용하면 planning CPU와 연결 수가 다른 병목이 될 수 있습니다. 영향 범위와 파라미터 분포로 선택합니다."
  cases:
    - badge: "Query rewrite"
      title: "파라미터 버킷에 따라 최적 접근 경로가 명확히 다르다"
      fit: "소형 tenant와 초대형 tenant, 최근 1일과 전체 기간처럼 선택도 차이가 수십 배인 경우"
      watchouts: "SQL variant가 늘면 관측 fingerprint와 캐시 키가 분산된다."
      next_step: "2~3개 query shape로만 나누고 각 shape의 호출량·p99·owner를 별도로 기록한다."
    - badge: "Targeted custom"
      title: "문제 쿼리가 소수이고 planning 비용이 작다"
      fit: "실행 시간이 수백 ms 이상인데 planning은 1~2ms 이하이며 특정 endpoint만 영향받는 경우"
      watchouts: "세션 전체에 강제하면 다른 prepared statement까지 매번 재계획된다."
      next_step: "트랜잭션 범위 SET LOCAL 또는 전용 connection path로 제한해 30분 canary한다."
    - badge: "Index/statistics"
      title: "분포 통계나 인덱스 자체가 부족하다"
      fit: "literal SQL도 느리거나 estimated rows와 actual rows 차이가 10배 이상인 경우"
      watchouts: "plan cache 설정만 바꾸면 근본적인 통계·인덱스 문제를 숨긴다."
      next_step: "ANALYZE, statistics target, extended statistics, partial index 후보를 먼저 검증한다."
faqs:
  - question: "prepared statement를 끄면 문제가 해결되나요?"
    answer: "일부 쿼리는 빨라질 수 있지만 parse·planning 비용, 네트워크 프로토콜, 드라이버 동작이 달라집니다. 전역 비활성화보다 문제 query와 endpoint를 좁혀 custom plan 또는 query shape 분리를 먼저 검증하는 편이 안전합니다."
  - question: "generic_plans가 많으면 나쁜 상태인가요?"
    answer: "아닙니다. 파라미터에 따라 최적 계획이 거의 바뀌지 않는 OLTP 쿼리는 generic plan이 효율적입니다. 실제 p95/p99와 buffer read가 안정적인지가 판단 기준입니다."
  - question: "인덱스를 추가하면 항상 해결되나요?"
    answer: "아닙니다. planner가 generic plan에서 그 인덱스를 선택하지 않거나, 큰 tenant에는 순차 스캔이 더 쌀 수 있습니다. 대표 파라미터별 실제 계획과 쓰기 증폭 비용을 함께 비교해야 합니다."
---

운영에서 까다로운 DB 성능 장애 중 하나는 **SQL 문자열도 같고 배포도 없는데 일부 요청만 갑자기 느려지는 문제**입니다. 개발 환경에서 `tenant_id = 42`를 넣으면 8ms인데, 운영의 대형 tenant에서는 2.4초가 걸립니다. SQL 콘솔에 값을 직접 넣어 실행하면 다시 빨라지고, 애플리케이션의 prepared statement 경로에서만 느립니다. 인덱스는 존재하고 `ANALYZE`도 최근에 돌았습니다. 이때 봐야 할 것은 단순한 인덱스 유무가 아니라 PostgreSQL이 준비된 문장에 **generic plan**과 **custom plan** 중 무엇을 선택했는지입니다.

이 글은 [Query Plan Regression Guardrail](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)의 구체적인 실패 모드를 다룹니다. 실행 계획이 통계나 인덱스 변경으로만 흔들리는 것이 아니라, 같은 prepared statement 안에서도 파라미터 분포와 plan cache 정책에 따라 달라질 수 있습니다. 함께 보면 좋은 글은 [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/), [PostgreSQL 인덱스 쓰기 증폭 예산](/learning/deep-dive/deep-dive-postgresql-index-write-amplification-budget-playbook/), [Connection Pool Sizing과 Saturation](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/)입니다.

## 이 글에서 얻는 것

- PostgreSQL이 prepared statement에서 generic plan과 custom plan을 고르는 이유를 이해합니다.
- tenant 크기, 상태값, 기간 조건처럼 데이터 분포가 치우친 쿼리를 파라미터 버킷으로 진단할 수 있습니다.
- `pg_prepared_statements`, `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)`를 어떤 순서로 볼지 정리합니다.
- `plan_cache_mode`, query shape 분리, 통계 보강, partial index를 어떤 우선순위로 적용할지 판단 기준을 가져갑니다.

## 핵심 개념/이슈

### 1) Generic plan은 재사용하고, custom plan은 값을 보고 다시 고른다

prepared statement는 SQL을 한 번 분석하고 반복 실행해 parse와 planning 비용을 줄입니다. 하지만 파라미터가 있는 문장은 두 방식으로 실행될 수 있습니다.

| 구분 | 계획을 만들 때 아는 것 | 장점 | 위험 |
| --- | --- | --- | --- |
| custom plan | 이번 실행의 실제 파라미터 값 | 선택도에 맞는 인덱스·조인 순서를 고를 수 있음 | 실행마다 planning 비용 발생 |
| generic plan | 파라미터 타입과 전체 통계 | 계획 재사용으로 CPU와 지연 절약 | 값별 분포 차이가 크면 평균적인 계획이 일부 요청에 매우 느림 |

예를 들어 아래 쿼리를 생각해 봅시다.

```sql
SELECT id, created_at, total_amount
FROM orders
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 100;
```

대부분 tenant는 주문이 1만 건 이하이고 `status = 'PENDING'` 비율이 0.2%라고 합시다. 반면 한 대형 tenant는 주문이 5천만 건이고 `PENDING` 비율이 35%입니다. 작은 tenant에는 `(tenant_id, status, created_at DESC)` 인덱스가 매우 유리합니다. 큰 tenant에는 조건과 테이블 layout에 따라 많은 random heap fetch보다 다른 인덱스, bitmap scan, 심지어 순차 스캔이 더 쌀 수 있습니다. SQL 모양이 같아도 최적 계획은 같지 않습니다.

### 2) PostgreSQL의 auto 선택은 처음 몇 번의 입력에 영향을 받는다

PostgreSQL 공식 `PREPARE` 문서에 따르면 기본 `plan_cache_mode=auto`에서는 처음 **5회**를 custom plan으로 실행하고, 그 평균 추정 비용과 generic plan 추정 비용을 비교해 이후 재사용 여부를 정합니다. 이 휴리스틱은 대부분의 쿼리에서 planning 비용과 실행 효율의 균형을 잘 잡습니다. 하지만 트래픽 분포가 심하게 치우치면 문제가 됩니다.

예를 들어 애플리케이션 시작 직후 처음 5회가 작은 tenant 요청이었다면 generic plan이 작은 tenant에 가까운 경로를 선택할 수 있습니다. 반대로 처음 5회가 대형 tenant 배치였다면 작은 tenant의 짧은 조회가 불필요하게 무거운 계획을 탈 수 있습니다. 중요한 것은 "다섯 번째 호출부터 무조건 generic"이 아닙니다. 비용 비교 결과에 따라 선택되지만, **처음 관측된 입력과 planner의 추정치가 이후 실제 분포를 충분히 대표하지 못할 수 있다**는 점입니다.

이 때문에 카나리 테스트 10건이 모두 통과해도 운영 30분 뒤 p99만 나빠질 수 있습니다. 문제는 warm-up 이후, 특정 connection, 특정 prepared statement에서 드러납니다. 평균 latency만 보면 작은 tenant 호출이 대부분이라 장애가 가려집니다.

### 3) 파라미터 편향은 값이 아니라 선택도의 차이다

"특정 tenant가 크다"는 설명만으로는 부족합니다. 실제로는 조건이 반환할 row 비율, 즉 선택도를 봐야 합니다.

대표적인 편향 조건:

- `tenant_id`: 고객별 데이터 크기가 100배 이상 차이
- `status`: `ACTIVE` 99%, `SUSPENDED` 0.1%처럼 enum 분포가 치우침
- `created_at`: 최근 1시간과 5년 전체 기간의 범위 차이
- `deleted_at IS NULL`: soft delete 비율이 서비스별로 다름
- `country`, `plan_type`: 소수 인기 값에 데이터가 집중
- 여러 조건의 상관관계: enterprise tenant에서만 특정 status가 많이 발생

실무에서는 파라미터를 최소 세 버킷으로 나눕니다.

| 버킷 | 예시 기준 | 기대 접근 경로 |
| --- | --- | --- |
| highly selective | 예상 결과가 전체의 0.1% 미만 | index scan 후보 |
| medium | 1~10% | bitmap 또는 index/heap 혼합 |
| broad | 30% 초과 | sequential scan 또는 별도 query shape 후보 |

숫자는 고정 정답이 아닙니다. row 폭, cache hit, LIMIT, 정렬, correlation에 따라 달라집니다. 다만 이 정도 버킷을 만들면 "빠른 값 하나로 EXPLAIN했다"는 진단 오류를 줄일 수 있습니다.

### 4) 평균 실행 시간은 plan cache 문제를 숨긴다

generic plan 문제는 소수의 비싼 호출로 나타나는 경우가 많습니다. 작은 tenant 9,900건이 10ms, 대형 tenant 100건이 2초라면 평균은 약 30ms로 보일 수 있습니다. 사용자와 커넥션 풀은 이미 큰 영향을 받는데 평균 대시보드는 초록색입니다.

최소 관측 단위:

- normalized query fingerprint
- endpoint 또는 job name
- 파라미터 원문이 아닌 안전한 bucket: `tenant_size=large`, `range=365d+`
- p50/p95/p99와 max
- rows returned, shared hit/read blocks, temp blocks
- planning time과 execution time
- `generic_plans`, `custom_plans` 증가량
- DB connection acquire latency와 active connection 수

민감한 tenant ID나 검색 조건을 로그에 그대로 남기면 안 됩니다. 값 자체가 아니라 선택도 버킷과 hash된 식별자를 남깁니다. 이 관점은 [메트릭 카디널리티 예산](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)과도 연결됩니다. `tenant_id`를 메트릭 label로 직접 넣지 말고, 크기 등급과 query class처럼 제한된 label을 사용해야 합니다.

### 5) Driver와 connection pool이 재현 조건을 바꾼다

애플리케이션이 SQL `PREPARE`를 직접 쓰지 않아도 JDBC 같은 드라이버가 extended query protocol과 server-side prepare를 사용할 수 있습니다. 준비된 문장은 세션 단위이므로 connection pool의 물리 connection마다 상태가 다를 수 있습니다. 어떤 connection은 아직 custom plan 구간이고, 다른 connection은 generic plan을 재사용 중일 수 있습니다.

따라서 "같은 Pod에서 한 번은 빠르고 한 번은 느리다"가 가능합니다. 요청이 어느 물리 connection을 빌렸는지에 따라 plan cache 상태가 달라지기 때문입니다. PgBouncer 같은 프록시가 transaction pooling을 사용하면 prepared statement 지원 방식과 세션 호환성도 별도로 확인해야 합니다.

진단 전에 확인할 항목:

- PostgreSQL JDBC의 `prepareThreshold`와 드라이버 버전
- ORM이 literal SQL, bind parameter, 동적 predicate를 어떻게 생성하는지
- 애플리케이션 pool 크기와 connection lifetime
- PgBouncer/프록시의 session 또는 transaction pooling 모드
- 배포 직후 connection이 모두 교체되는지, 일부만 장기 생존하는지

이 항목을 빼고 DB 콘솔에서 literal SQL만 실행하면 애플리케이션 문제를 재현하지 못할 수 있습니다.

## 실무 적용

### 1) 대표 파라미터 세트를 먼저 고정한다

느린 SQL을 찾으면 가장 빠른 값 하나와 가장 느린 값 하나만 비교하지 않습니다. 실제 트래픽 분포에서 아래 세트를 뽑습니다.

```yaml
plan_probe_set:
  query: "orders_by_tenant_status"
  buckets:
    - name: "small-tenant-rare-status"
      estimated_selectivity: "<0.1%"
    - name: "medium-tenant-common-status"
      estimated_selectivity: "1-10%"
    - name: "large-tenant-common-status"
      estimated_selectivity: ">30%"
  evidence:
    - "EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)"
    - "rows estimate vs actual"
    - "planning/execution time"
    - "shared hit/read/temp blocks"
```

production에서 `ANALYZE`를 붙인 `EXPLAIN`은 실제 쿼리를 실행합니다. 쓰기 SQL이나 매우 무거운 조회에는 그대로 사용하지 말고 복제 환경, 격리된 read replica, transaction rollback이 가능한 안전한 경로를 선택합니다. 운영 primary에서는 `EXPLAIN`만 먼저 보고, 실제 실행 검증은 제한된 조건으로 진행합니다.

### 2) 같은 prepared statement를 6회 이상 실행해 전환을 관찰한다

테스트 세션에서 명시적으로 prepared statement를 만들면 동작을 좁혀 볼 수 있습니다.

```sql
PREPARE orders_by_tenant(bigint, text) AS
SELECT id, created_at, total_amount
FROM orders
WHERE tenant_id = $1
  AND status = $2
ORDER BY created_at DESC
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS) EXECUTE orders_by_tenant(101, 'PENDING');
```

서로 다른 대표 값을 섞어 6회 이상 실행한 뒤 현재 세션에서 아래를 봅니다.

```sql
SELECT name, generic_plans, custom_plans, parameter_types, prepare_time
FROM pg_prepared_statements
WHERE name = 'orders_by_tenant';
```

generic plan의 `EXPLAIN EXECUTE`에는 실제 literal 대신 `$1`, `$2` 같은 파라미터 기호가 보일 수 있습니다. 반면 custom plan은 공급된 값이 계획에 반영됩니다. 단, 이 view는 **현재 세션의 prepared statement만** 보여줍니다. 애플리케이션의 다른 pooled connection 상태를 관리자 세션 하나에서 전부 볼 수 있다고 가정하면 안 됩니다. 필요하면 애플리케이션 diagnostic endpoint나 제한된 canary connection에서 증거를 수집합니다.

### 3) 추정 row와 실제 row 차이를 우선 본다

실행 계획에서 가장 먼저 볼 숫자는 estimated rows와 actual rows 차이입니다.

- 차이가 2배 이내: 통계 추정은 대체로 합리적
- 10배 이상: 통계, 상관관계, 편향 문제를 우선 의심
- 100배 이상: generic/custom 논의 전에 통계 품질과 predicate 구조를 먼저 수정
- planning 1ms, execution 2초: custom plan 비용을 지불할 여지가 큼
- planning 30ms, execution 10ms: 매번 custom plan 강제는 손해일 가능성이 큼

`tenant_id`와 `status`가 강하게 연관되면 단일 컬럼 통계만으로 부족할 수 있습니다. 이때 extended statistics 후보를 검토합니다. 자주 조회하는 희소 상태가 명확하다면 [Partial Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/)가 더 직접적인 해법일 수 있습니다. 다만 인덱스를 추가하기 전에 쓰기 QPS, WAL, vacuum, 저장공간을 [인덱스 쓰기 증폭 예산](/learning/deep-dive/deep-dive-postgresql-index-write-amplification-budget-playbook/)으로 같이 계산합니다.

### 4) 완화는 좁은 범위부터 적용한다

우선순위는 보통 다음과 같습니다.

1. 통계가 오래됐거나 추정이 틀리면 `ANALYZE`, statistics target, extended statistics 검토
2. 넓은 기간·대형 tenant 요청을 별도 query shape 또는 비동기 export로 분리
3. 희소 조건에 partial/covering index 검토
4. 문제 endpoint 또는 transaction에만 custom plan 실험
5. 마지막에 드라이버 prepared statement 정책 변경 검토

custom plan을 실험할 때는 전역 변경보다 트랜잭션 범위가 안전합니다.

```sql
BEGIN;
SET LOCAL plan_cache_mode = 'force_custom_plan';
-- 문제 쿼리 실행
COMMIT;
```

이 설정은 원인 확인과 canary에 유용합니다. 하지만 영구 적용 전에 아래 gate를 둡니다.

- 문제 query p95가 30% 이상 감소
- DB 전체 CPU 증가가 10% 이하
- planning time p95가 endpoint budget의 5% 이하
- connection acquire latency가 기준선 대비 20% 이상 늘지 않음
- 최소 30분, 가능하면 peak window 한 번 관측

### 5) Query shape를 분리할 때는 버킷 수를 제한한다

편향이 매우 크다면 하나의 SQL로 모든 값을 처리하려는 것이 오히려 나쁠 수 있습니다. 예를 들어 30일 이하의 interactive 조회와 30일 초과의 report 조회를 분리할 수 있습니다.

```text
if range_days <= 30 and expected_rows <= 10_000:
    interactive indexed query
else:
    async report/export path
```

또는 초대형 tenant만 별도 query hint가 아니라 다른 predicate·요약 테이블·partition 경로를 사용하게 할 수 있습니다. 다만 tenant마다 SQL을 하나씩 만들면 query fingerprint와 운영 복잡도가 폭발합니다. `small/medium/large`처럼 **2~3개 workload class**로 제한하고, 각 class에 owner와 종료 조건을 둡니다.

### 6) 재발 방지 gate를 만든다

plan cache 회귀는 unit test로 잡기 어렵습니다. 대표 데이터 분포가 있는 통합·성능 테스트가 필요합니다.

권장 gate:

- 상위 20개 핵심 query에 small/medium/large 파라미터 fixture 유지
- estimated/actual rows 차이 10배 초과 시 review
- p95 200ms 또는 기존 기준선 대비 1.5배 초과 시 경고
- shared read blocks가 기준선 대비 2배 초과 시 원인 기록
- schema/index/statistics 변경 PR에서 plan diff 생성
- 드라이버·PgBouncer·PostgreSQL major upgrade 때 prepared statement canary 재실행

이 과정은 [Load Testing 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)과 연결해야 합니다. 균일한 랜덤 tenant만 넣으면 편향 문제를 재현하지 못합니다. 실제 traffic histogram을 익명화한 workload mix가 더 중요합니다.

## 트레이드오프/주의점

첫째, generic plan 자체는 문제가 아닙니다. 파라미터에 따라 최적 계획이 거의 바뀌지 않는 짧은 OLTP 쿼리는 generic plan이 planning CPU를 줄이는 좋은 선택입니다. `generic_plans` 숫자가 높다는 이유만으로 장애로 판정하면 안 됩니다.

둘째, `force_custom_plan` 전역 적용은 쉬운 대신 blast radius가 큽니다. 모든 prepared statement가 실행마다 계획을 만들면 DB CPU가 오르고 짧은 쿼리의 latency가 나빠질 수 있습니다. 문제 query보다 planning overhead가 더 비싼 workload도 많습니다.

셋째, prepared statement를 전부 끄면 드라이버와 프로토콜 동작까지 바뀝니다. SQL injection 방지를 위해 bind parameter를 쓰는 것과 server-side prepared plan을 재사용하는 것은 같은 문제가 아닙니다. 보안을 이유로 bind parameter까지 제거해서는 안 됩니다.

넷째, 파라미터를 로그에 그대로 남기면 개인정보와 카디널리티 문제가 생깁니다. tenant ID, 이메일, 검색어, 기간 원문 대신 size bucket, selectivity bucket, hash를 사용합니다.

다섯째, 통계 갱신과 DDL은 cached plan을 다시 분석·계획하게 만들 수 있습니다. 배포 직후 잠시 좋아졌다는 사실만으로 해결됐다고 닫으면 안 됩니다. connection lifetime을 넘는 관측 창과 peak traffic 검증이 필요합니다.

여섯째, 빠른 실행 계획이 항상 전체 시스템에 좋은 것은 아닙니다. 특정 query p99를 줄이려고 큰 covering index를 추가하면 쓰기 latency, WAL, autovacuum 비용이 늘어날 수 있습니다. 읽기 개선 수치와 쓰기 증폭을 같은 변경 기록에 남깁니다.

## 체크리스트 또는 연습

- [ ] 문제 SQL을 query fingerprint와 endpoint/job 단위로 식별했다.
- [ ] 작은 값 하나가 아니라 선택도 3개 버킷으로 실행 계획을 비교했다.
- [ ] estimated rows와 actual rows 차이를 기록했다.
- [ ] planning time과 execution time을 분리해 측정했다.
- [ ] `pg_prepared_statements`의 generic/custom plan 카운트를 동일 세션에서 확인했다.
- [ ] JDBC `prepareThreshold`, pool lifetime, PgBouncer pooling mode를 확인했다.
- [ ] tenant ID나 검색어 원문을 metric label에 넣지 않았다.
- [ ] 통계 보강, query shape 분리, index, targeted custom plan 순서로 검토했다.
- [ ] 완화 후 DB CPU, buffer read, p95/p99, acquire latency를 최소 30분 비교했다.
- [ ] 회귀 테스트에 실제 데이터 편향을 반영한 fixture가 있다.

연습으로 주문 테이블을 가정하고 tenant별 row 수가 1천, 10만, 5천만인 데이터를 만드세요. 같은 prepared statement를 각 값으로 섞어 10회 이상 실행한 뒤 `generic_plans`, `custom_plans`, estimated/actual rows, planning/execution time을 비교해 보세요. 그다음 `force_custom_plan`을 트랜잭션 범위로만 적용하고, 실행 시간 이득이 planning 비용보다 큰 경계를 한 줄로 적어 보세요. 최종 답은 "custom이 빠르다"가 아니라 **어떤 선택도·호출량·지연 예산에서 어떤 계획 정책을 쓸 것인가**여야 합니다.

## 참고 자료

- PostgreSQL `PREPARE`: https://www.postgresql.org/docs/current/sql-prepare.html
- PostgreSQL Query Planning 설정과 `plan_cache_mode`: https://www.postgresql.org/docs/current/runtime-config-query.html
- PostgreSQL `pg_prepared_statements`: https://www.postgresql.org/docs/current/view-pg-prepared-statements.html

