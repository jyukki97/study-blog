---
title: "백엔드 커리큘럼 심화: PostgreSQL Timeout Budget, 쿼리·락·유휴 트랜잭션을 서로 다른 실패로 다루는 법"
date: 2026-09-08T10:06:00+09:00
lastmod: 2026-09-08T10:06:00+09:00
draft: false
topic: "Database"
tags: ["PostgreSQL", "Timeout", "statement_timeout", "lock_timeout", "Transaction", "Connection Pool", "Database Reliability"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL의 statement_timeout, lock_timeout, idle_in_transaction_session_timeout을 하나의 숫자로 뭉개지 않고, 요청 deadline·커넥션 풀·재시도와 연결해 안전한 DB 실행 시간 예산을 설계하는 실무 플레이북입니다."
module: "data-system"
study_order: 1485
summary: "DB timeout은 '느리면 끊기' 옵션이 아니다. 실행이 긴 쿼리, lock을 기다리는 쿼리, 아무 일도 하지 않은 채 트랜잭션을 붙잡는 세션은 서로 다른 실패다. 요청 전체 deadline에서 DB 예산을 역산하고, 세션 기본값·endpoint override·관측·재시도를 함께 설계해야 타임아웃이 장애 증폭 장치가 되지 않는다."
keywords: ["PostgreSQL timeout strategy", "statement_timeout", "lock_timeout", "idle in transaction timeout", "database deadline budget", "JDBC SET LOCAL"]
key_takeaways:
  - "statement_timeout은 실행과 대기 시간을 포함한 SQL statement 전체를 제한하고, lock_timeout은 lock 획득 대기만 제한한다. 둘은 대체 관계가 아니다."
  - "idle_in_transaction_session_timeout은 열린 트랜잭션을 아무 SQL 없이 방치하는 세션을 정리하는 안전장치다. 긴 배치의 실행 시간을 통제하는 값으로 쓰면 안 된다."
  - "DB 예산은 HTTP deadline에서 역산한다. 예를 들어 800ms 요청이면 연결·직렬화·하위 호출 여유를 뺀 450~550ms만 DB에 배정하고, 같은 호출 안에 더 긴 client timeout을 두지 않는다."
  - "전역 timeout을 단번에 낮추기보다 읽기 endpoint, 쓰기 트랜잭션, migration·batch를 분리하고 SQLSTATE 57014·lock wait·pool acquire latency를 함께 관측해야 한다."
operator_checklist:
  - "서비스·role·database별 SHOW statement_timeout, lock_timeout, idle_in_transaction_session_timeout과 ORM·JDBC client timeout을 같은 표로 기록한다."
  - "최근 7일의 query fingerprint별 p95/p99, lock wait, cancel(SQLSTATE 57014), connection acquire p95를 기준선으로 저장한다."
  - "온라인 요청은 transaction 안에서 SET LOCAL로 예산을 좁히고, 배치·migration은 별도 role 또는 명시적 상향 예산을 사용한다."
  - "timeout 증가·감소 전에는 5xx, rollback, retry rate, DB CPU, long transaction age를 30분 이상 동일 트래픽 구간에서 비교한다."
learning_refs:
  - title: "Timeout/Retry/Backoff 설계"
    href: "/learning/deep-dive/deep-dive-timeout-retry-backoff/"
    description: "요청 deadline과 재시도가 장애를 증폭하지 않게 만드는 상위 원칙입니다."
  - title: "Connection Pool Sizing과 Saturation"
    href: "/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/"
    description: "취소되지 않는 DB 작업이 pool 대기열로 전파되는 과정을 다룹니다."
  - title: "Database Locking과 Contention"
    href: "/learning/deep-dive/deep-dive-database-locking-contention-playbook/"
    description: "lock wait를 쿼리 실행 시간과 분리해 진단하는 기준입니다."
  - title: "JPA Transaction Boundary"
    href: "/learning/deep-dive/deep-dive-jpa-transaction-boundaries/"
    description: "트랜잭션 범위와 외부 I/O가 timeout 예산을 망가뜨리는 이유를 연결합니다."
decision_guide:
  title: "어떤 PostgreSQL timeout을 먼저 조정할까"
  intro: "첫 기준은 느린 요청의 원인이 실제 실행인지, lock 대기인지, 방치된 트랜잭션인지다. 모든 값을 동시에 낮추면 원인 신호를 잃고 정상 작업까지 취소한다."
  cases:
    - badge: "실행 시간"
      title: "특정 query fingerprint의 p99가 요청 DB 예산을 넘는다"
      fit: "계획·I/O·결과 row 수 때문에 SQL 실행 자체가 긴 경우입니다."
      watchouts: "statement_timeout을 낮추기만 하면 cancel은 줄지 않고 retry와 pool churn이 늘 수 있습니다."
      next_step: "EXPLAIN (ANALYZE, BUFFERS)와 반환 row 수를 확인하고, endpoint별 SET LOCAL statement_timeout을 10% 트래픽 canary로 적용합니다."
    - badge: "Lock 대기"
      title: "평소 SQL은 빠르지만 pg_stat_activity wait_event가 Lock으로 몰린다"
      fit: "DDL, hot row, 긴 트랜잭션 또는 순서가 다른 갱신이 충돌하는 경우입니다."
      watchouts: "긴 statement_timeout은 잠긴 요청을 오래 살려 pool을 소진할 수 있습니다."
      next_step: "짧은 lock_timeout과 충돌 원인 제거를 우선하고, 멱등 write만 제한적으로 재시도합니다."
    - badge: "유휴 트랜잭션"
      title: "idle in transaction 세션이 오래 남고 vacuum·lock을 막는다"
      fit: "API가 트랜잭션을 연 뒤 외부 HTTP 호출·사용자 입력·느린 직렬화를 기다리는 경우입니다."
      watchouts: "정상 배치의 긴 SQL과 idle 상태를 같은 것으로 취급하면 batch를 잘못 끊습니다."
      next_step: "idle_in_transaction_session_timeout을 role별로 설정하고, 외부 I/O를 트랜잭션 밖으로 이동합니다."
faqs:
  - question: "statement_timeout 하나만 설정하면 충분하지 않나요?"
    answer: "충분하지 않습니다. statement_timeout은 실행과 대기를 통틀어 제한하지만, lock 경쟁을 짧게 실패시키는 정책이나 방치된 트랜잭션 정리까지 명확하게 표현하지 못합니다. 실패 유형마다 다른 관측과 복구가 필요합니다."
  - question: "timeout으로 취소된 write를 바로 재시도해도 되나요?"
    answer: "커밋 여부와 멱등성이 확인되기 전에는 안 됩니다. client가 timeout을 받았다고 DB rollback이 보장되는 것은 아니므로 idempotency key, 결과 조회, SQLSTATE와 트랜잭션 경계를 먼저 확인해야 합니다."
  - question: "전역 기본값을 아주 짧게 두고 배치만 늘리면 안전한가요?"
    answer: "역할과 작업 종류가 명확히 분리되고 예외가 문서화돼 있을 때만 가능합니다. 관리자 세션·migration·ETL까지 같은 기본값을 쓰면 임시 우회가 누적되므로 role과 connection path를 분리하는 편이 안전합니다."
---

서비스가 느려질 때 DB timeout을 하나 추가하면 안전해 보인다. 하지만 `statement_timeout = 500ms` 같은 설정 하나는 세 가지 서로 다른 문제를 섞는다. SQL이 CPU·I/O 때문에 500ms 넘게 **실행**되는 경우, 빠른 SQL이 다른 트랜잭션 때문에 500ms **대기**하는 경우, 트랜잭션만 열어 둔 채 애플리케이션이 아무 SQL도 보내지 않는 **유휴** 경우다. 실패 원인이 다르면 사용자에게 돌려줄 오류, 재시도 가능성, 고칠 대상도 다르다.

이 글의 목표는 timeout 값을 외우는 것이 아니라, **요청 전체 deadline에서 DB 예산을 역산하고 실패 유형마다 다른 PostgreSQL guardrail을 배치하는 것**이다. [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)의 상위 deadline 원칙, [Connection Pool Sizing과 Saturation](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/)의 대기열 관점, [Database Locking과 Contention](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)의 lock 진단, [JPA Transaction Boundary](/learning/deep-dive/deep-dive-jpa-transaction-boundaries/)의 트랜잭션 범위를 함께 적용한다.

참고한 공식 문서:

- [PostgreSQL Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html)
- [PostgreSQL SET](https://www.postgresql.org/docs/current/sql-set.html)
- [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

## 이 글에서 얻는 것

- `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`이 각각 어느 실패를 차단하는지 구분합니다.
- API deadline, JDBC/ORM timeout, PostgreSQL 세션 설정을 충돌 없이 정렬하는 방법을 익힙니다.
- 정상적인 긴 batch와 위험한 긴 transaction을 다른 role·다른 connection path로 분리할 수 있습니다.
- timeout 취소율, lock wait, connection acquire latency를 이용해 숫자를 조정하는 운영 기준을 만듭니다.

## 핵심 개념/이슈

### 1) timeout은 계층마다 한 개의 시간 예산을 공유해야 한다

사용자가 800ms 안에 응답을 받아야 하는 조회 API를 예로 들어 보자. 여기에 gateway timeout 800ms, 애플리케이션 future timeout 800ms, JDBC socket timeout 800ms, PostgreSQL `statement_timeout` 800ms를 각각 넣으면 안전망이 네 겹이 되는 것이 아니다. 연결을 빌리는 시간, JSON 직렬화, 네트워크 왕복, fallback 판단을 전혀 남기지 않아 가장 바깥 계층이 먼저 요청을 버리고 DB 작업은 계속될 수 있다.

실무에서는 바깥 deadline에서 안쪽 budget을 역산한다. 다음 수치는 출발점이며 서비스의 p95와 SLO에 맞춰 조정한다.

| 계층 | 800ms API의 예산 예시 | 역할 |
| --- | ---: | --- |
| ingress/client deadline | 800ms | 사용자에게 약속한 최종 한계 |
| 앱의 DB 호출 구간 | 600ms | acquire, SQL, 결과 매핑을 포함한 상한 |
| pool acquire | 80~120ms | 포화 상황에서 빠르게 거절할 기준 |
| PostgreSQL statement | 450~550ms | SQL 실행과 서버 내부 대기에 쓰는 예산 |
| 응답 직렬화·오류 처리 여유 | 100~150ms | timeout을 정상적인 504/503으로 바꿀 시간 |

중요한 관계는 **바깥 timeout > 안쪽 timeout**이다. DB가 500ms에서 취소되고 앱이 600ms 안에 cleanup과 오류 분류를 마치는 편이, 앱이 먼저 500ms에 포기하고 DB가 800ms까지 실행되는 것보다 예측 가능하다. 긴 보고서 다운로드나 월말 정산을 온라인 API의 500ms 예산에 억지로 넣지 말고 비동기 job 또는 별도 read replica·role로 분리한다.

### 2) 세 PostgreSQL timeout은 관찰 대상이 다르다

PostgreSQL은 모두 세션 또는 트랜잭션 범위로 설정할 수 있지만, 중단하는 상태는 다르다.

| 설정 | 멈추는 대상 | 먼저 확인할 지표 | 흔한 오해 |
| --- | --- | --- | --- |
| `statement_timeout` | 실행 중인 SQL statement 전체 | query p95/p99, rows, buffer read, cancel 수 | 느린 실행만 제한한다고 생각함 |
| `lock_timeout` | lock을 얻기 위한 대기 | `wait_event_type=Lock`, blocker, deadlock | statement_timeout의 축소판이라고 생각함 |
| `idle_in_transaction_session_timeout` | transaction을 열고 SQL 없이 idle인 세션 | transaction age, `state`, xmin, pool 사용량 | 긴 batch를 제한하는 값으로 사용함 |

`statement_timeout`은 SQL이 시작된 뒤의 전체 시간을 센다. 따라서 table scan, 느린 네트워크 스토리지, 다른 transaction의 lock 대기 모두 이 값에 닿을 수 있다. 반대로 `lock_timeout`은 lock을 기다리는 순간에만 의미가 있다. 주문 row를 갱신하는 SQL의 정상 실행은 20ms인데 간헐적으로 3초 wait가 생긴다면, 2초 statement timeout만 두기보다 150~300ms lock timeout으로 빠르게 충돌을 드러내고 blocker를 고치는 쪽이 보통 더 안전하다.

`idle_in_transaction_session_timeout`은 특히 과소평가된다. `BEGIN` 후 외부 결제 API를 호출하거나 화면 입력을 기다리면, 해당 세션은 SQL을 하지 않아도 snapshot·row lock·connection을 오래 잡을 수 있다. 이 상태는 autovacuum과 pool 모두에 해롭다. 긴 SQL을 10분 실행하는 batch와는 구분해야 한다. 전자는 `active`, 후자는 `idle in transaction`이라는 점부터 다르다.

### 3) 값은 전역 하나가 아니라 작업 성격별로 정한다

전역 default를 바꾸는 것은 가장 큰 blast radius를 가진다. 우선은 online read, online write, worker, migration을 나눈다.

```sql
-- 요청 트랜잭션 안에서만 적용한다. commit/rollback 뒤에는 사라진다.
BEGIN;
SET LOCAL statement_timeout = '500ms';
SET LOCAL lock_timeout = '200ms';

SELECT id, status, updated_at
FROM orders
WHERE customer_id = $1
ORDER BY updated_at DESC
LIMIT 50;
COMMIT;
```

`SET LOCAL`은 connection pool의 다음 사용자에게 설정이 새지 않게 하는 중요한 장치다. pool checkout 직후 일반 `SET statement_timeout`을 쓰면 reset 실패나 예외 경로에서 다른 endpoint가 같은 제한을 물려받을 수 있다. 반면 migration·reindex·대량 backfill처럼 일부러 긴 시간이 필요한 작업은 온라인 role의 예산을 올려서 해결하지 않는다. 별도 DB role, 별도 connection string, 명시된 maintenance window, 진행률·rollback 계획을 둔다.

초기 정책을 아래처럼 잡을 수 있다.

| 작업 경로 | statement timeout | lock timeout | idle transaction timeout | 승격 조건 |
| --- | ---: | ---: | ---: | --- |
| 동기 조회 API | 450~800ms | 100~250ms | 15~30초 | p99·cancel·5xx가 기준선 안 |
| 짧은 쓰기 API | 700~1,500ms | 150~400ms | 15~30초 | 멱등 결과 확인과 retry budget 보유 |
| 비동기 worker | 업무별 5~60초 | 0.5~2초 | 30~60초 | lease·재처리·중단 복구 검증 |
| migration/ETL | 명시적 per-job 값 | 명시적 per-job 값 | 운영 정책에 맞춤 | change window·rollback·관측 준비 |

이 숫자는 보편 정답이 아니다. 예를 들어 200ms p99 API에서 1,500ms statement timeout은 사실상 사고를 숨긴다. 반대로 partition maintenance가 필요한 DB에서 500ms 전역 제한은 운영 절차를 깨뜨린다. 그래서 각 값에 owner와 적용 scope를 붙인다.

### 4) 취소는 성공도 실패도 아닌 '불확실성'을 만들 수 있다

PostgreSQL이 `statement_timeout`으로 statement를 취소하면 SQLSTATE `57014`를 돌려준다. 하지만 애플리케이션이 받은 client-side timeout만으로는 DB가 rollback됐는지, 이미 commit했는지 알 수 없는 경우가 있다. 특히 write 요청을 재시도할 때 "응답이 없었으니 실패"라고 가정하면 중복 주문·중복 발송이 생긴다.

다음 순서로 복구 경로를 나눈다.

1. **읽기**: 결과가 없어도 재시도가 안전한지, 같은 요청이 cache·replica에 부하를 더하지 않는지 확인한다.
2. **멱등 write**: idempotency key나 unique business key로 결과를 먼저 조회한다. 이미 완료됐으면 이전 결과를 반환한다.
3. **비멱등 write**: 자동 재시도하지 않는다. operation ledger나 수동 검토 상태로 넘긴다.
4. **lock timeout**: 재시도 전 blocker와 lock 순서를 확인한다. 같은 경쟁이 남아 있으면 retry는 대기열을 키운다.

이는 [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)에서 말한 retry budget과 같은 원칙이다. timeout 비율이 1%에서 5%로 올랐을 때 재시도 2회를 모두 허용하면 DB 호출량이 얼마나 늘어나는지 계산하지 않으면, 보호 장치가 포화 가속기가 된다.

## 실무 적용

### 1) 관측표를 먼저 만들고 값을 바꾼다

설정 변경 전에 7일 기준선을 기록한다. query fingerprint마다 `calls`, p50/p95/p99, rows, shared/local block read, temporary file, SQLSTATE `57014` 횟수를 수집한다. 동시에 `pg_stat_activity`에서 `state`, transaction 시작 시각, `wait_event_type`, `wait_event`를 확인하고, pool의 acquire p95와 active/idle connection 수를 같은 시각축에 둔다.

원인별로 첫 액션을 정해 둔다.

| 관측 | 먼저 할 일 | timeout 조정 여부 |
| --- | --- | --- |
| 특정 SQL의 p99만 상승, Lock wait 없음 | 실행 계획·인덱스·row 수·I/O 확인 | 원인 수리 전 endpoint canary만 |
| Lock wait와 blocker가 동시 증가 | 긴 transaction·갱신 순서·DDL 분석 | 짧은 lock timeout을 우선 검토 |
| `idle in transaction` 60초 초과가 반복 | 코드에서 외부 I/O·사용자 대기 분리 | idle timeout을 role에 적용 |
| pool acquire p95가 DB statement보다 큼 | pool 크기·동시성·cancel 누수 확인 | statement 값만 낮추지 않음 |

`pg_cancel_backend`를 수동으로 자주 쓰게 된다면 timeout 값이 없어서가 아니라 query ownership과 budget이 문서화되지 않았다는 신호일 수 있다. 취소한 세션 ID, SQL fingerprint, 호출 endpoint, 원인 분류를 남겨야 다음 alert가 같은 문제를 재현한다.

### 2) 10% canary에서 취소율과 사용자 결과를 같이 본다

처음에는 latency-sensitive read endpoint 하나에만 `SET LOCAL statement_timeout`을 적용한다. traffic의 10%로 30분 이상 관찰하고, 아래 abort 조건 중 하나라도 맞으면 값을 더 낮추지 않고 원인을 분석한다.

- `57014` cancel 비율이 0.1%를 넘거나 기준선의 2배가 된다.
- 해당 endpoint의 5xx 또는 fallback 비율이 기준선보다 0.2%p 이상 증가한다.
- pool acquire p95가 20% 이상 늘거나 active connection이 지속적으로 80%를 넘는다.
- 같은 query fingerprint의 p99가 낮아졌는데 retry count가 증가해 총 DB calls가 10% 이상 늘어난다.

성공은 평균 latency 하락이 아니다. **p99, cancel, retry, pool, business success가 같이 안정적인 상태**다. 이 다섯 가지가 안정된 뒤에 유사 endpoint로 확장한다. lock timeout은 hot row를 다루는 write에서 따로 canary하고, deadlock·serialization failure와 동일 오류로 집계하지 않는다.

### 3) 코드와 운영 예외를 분리한다

Spring/JPA 같은 ORM 환경에서는 transaction interceptor와 connection pool initialization SQL이 실제 설정 범위를 결정한다. request filter에서 deadline을 만들고 service method는 `@Transactional` 안에서 `SET LOCAL`을 적용한다. 다만 트랜잭션을 연 뒤 외부 HTTP 호출, 파일 업로드, message publish를 기다리면 idle guardrail을 피하려고 timeout을 올리는 대신 설계가 더 나빠진다. 데이터 변경을 commit한 뒤 outbox·worker로 후속 작업을 넘기거나, 외부 결과를 먼저 얻고 짧은 DB transaction을 연다.

DBA가 전역값을, 애플리케이션이 endpoint 예외를 각각 몰래 관리하면 회귀가 생긴다. 다음 네 가지를 하나의 config registry에 둔다.

- role/database 기본값과 변경 owner
- endpoint 또는 job별 `SET LOCAL` 값과 요청 deadline
- migration/maintenance의 별도 connection path와 만료 시각
- alert threshold, rollback 값, 예외 검토 일자

이 기록은 timeout을 "성능 튜닝 상수"가 아니라 운영 계약으로 만든다.

## 트레이드오프/주의점

첫째, 짧은 timeout은 대기열을 줄일 수 있지만 실제 서비스 용량을 만들지는 않는다. 인덱스 누락, 잘못된 join, hot row, 느린 스토리지가 원인이면 cancel 수만 늘고 사용자는 더 자주 실패한다. [Query Plan Regression Guardrail](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)처럼 계획과 데이터 분포를 먼저 점검해야 한다.

둘째, `lock_timeout`을 너무 낮추면 정상적인 짧은 경합도 오류가 되어 write 성공률이 떨어질 수 있다. 반대로 너무 길면 lock queue 뒤에 요청이 쌓인다. business operation의 허용 지연, 멱등성, blocker 제거 난이도로 결정한다.

셋째, cancel된 write의 결과는 앱이 모를 수 있다. HTTP 504를 받은 사용자에게 "실패"라고 단정하지 말고 idempotency ledger를 조회할 수 있어야 한다. timeout 수치만 바꾸고 결과 확인 경로를 만들지 않으면 신뢰성은 개선되지 않는다.

넷째, managed PostgreSQL 또는 proxy/PgBouncer 환경에서는 parameter 적용 scope와 reset 동작이 다를 수 있다. production 전에 `SHOW`로 실제 세션 값을 확인하고, transaction pooling에서 `SET LOCAL`이 commit/rollback 뒤 사라지는지 integration test로 검증한다.

## 체크리스트 또는 연습

- [ ] 사용자-facing API 하나의 최종 deadline에서 network, pool acquire, SQL, serialization 예산을 역산했다.
- [ ] `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`의 owner·scope·rollback 값을 문서화했다.
- [ ] query p95/p99, lock wait, `57014`, transaction age, pool acquire p95를 같은 dashboard에서 본다.
- [ ] online API와 migration/ETL이 다른 role 또는 connection path를 사용한다.
- [ ] timeout write는 idempotency key 또는 결과 ledger로 커밋 여부를 확인한다.
- [ ] 10% canary의 abort 조건과 30분 관측 지표를 배포 전에 합의했다.

연습으로 주문 조회 API 하나를 고른다. 현재 p99와 pool acquire p95를 측정한 뒤 800ms 전체 deadline을 각 계층에 나눠 보자. 다음으로 같은 DB에서 `idle in transaction` 세션을 하나 만들고, 실행 중인 10초 `pg_sleep` statement와 무엇이 다른지 `pg_stat_activity`에서 비교한다. 세 상태가 구분돼야 timeout 값도 안전하게 분리할 수 있다.

## 관련 글

- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Connection Pool Sizing과 Saturation](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/)
- [Database Locking과 Contention](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)
- [JPA Transaction Boundary](/learning/deep-dive/deep-dive-jpa-transaction-boundaries/)
- [Query Plan Regression Guardrail](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)

