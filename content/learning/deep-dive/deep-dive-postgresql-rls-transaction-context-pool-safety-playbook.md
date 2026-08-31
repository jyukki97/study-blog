---
title: "백엔드 커리큘럼 심화: PostgreSQL RLS와 트랜잭션 컨텍스트, 커넥션 풀에서 테넌트 경계를 안전하게 강제하는 법"
date: 2026-08-24T10:06:00+09:00
lastmod: 2026-08-24T10:06:00+09:00
draft: false
topic: "Database Security"
tags: ["PostgreSQL", "Row Level Security", "RLS", "Multitenancy", "Connection Pool", "Authorization"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL Row Level Security를 공유 테이블 SaaS에 적용할 때 tenant context, SET LOCAL, 커넥션 풀 재사용, role 분리, 정책 테스트를 어떻게 묶어야 하는지 정리한 운영 플레이북입니다."
module: "backend-security"
study_order: 1501
summary: "RLS는 WHERE tenant_id 조건을 대신 써 주는 편의 기능이 아닙니다. 누가 테이블을 소유하는지, 요청의 tenant context를 어느 트랜잭션에 넣는지, 풀에서 세션 상태가 어떻게 정리되는지까지 설계해야 교차 테넌트 조회를 마지막 경계에서 차단할 수 있습니다."
keywords: ["PostgreSQL RLS multitenancy", "SET LOCAL tenant context", "connection pool RLS", "FORCE ROW LEVEL SECURITY", "PostgreSQL tenant isolation"]
key_takeaways:
  - "RLS는 권한이 있는 role의 행 범위를 줄이지만, table owner와 BYPASSRLS role은 기본적으로 우회하므로 migration role과 runtime role을 분리해야 한다."
  - "풀을 쓰는 애플리케이션은 세션 단위 SET이 아니라 명시적 트랜잭션 안의 SET LOCAL로 tenant context를 넣어야 다음 요청으로 값이 새지 않는다."
  - "USING은 보이는 기존 행을, WITH CHECK는 INSERT·UPDATE 뒤의 새 행을 통제한다. 둘 중 하나만 검증하면 쓰기 경계가 남는다."
  - "RLS rollout의 완료 조건은 정책 생성이 아니라 no-context 차단, 교차 tenant 읽기·쓰기 차단, pool reuse, 운영자 예외와 백업 경로의 테스트 증거다."
operator_checklist:
  - "runtime role에 BYPASSRLS, table ownership, 불필요한 schema CREATE 권한이 없는지 배포 전 확인한다."
  - "각 request/job transaction에서 검증된 tenant UUID만 SET LOCAL app.tenant_id로 설정하고, transaction 밖 설정을 금지한다."
  - "SELECT, INSERT, UPDATE, DELETE, bulk job, connection reuse, ROLLBACK 후 재사용을 tenant A/B와 context 없음 조합으로 테스트한다."
  - "critical 테이블은 no-context 접근 0건, cross-tenant policy deny 0건을 목표로 하고 1건이라도 발생하면 rollout을 중단한다."
learning_refs:
  - title: "Tenant Context Propagation"
    href: "/learning/deep-dive/deep-dive-tenant-context-propagation-guardrails-playbook/"
    description: "HTTP·메시지·배치에서 tenant scope를 잃지 않는 상위 계약입니다."
  - title: "멀티테넌트 격리 전략"
    href: "/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/"
    description: "RLS가 적합한 공유 DB/공유 스키마의 범위와 물리적 격리 전환 기준을 다룹니다."
  - title: "ThreadLocal Context Propagation"
    href: "/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/"
    description: "애플리케이션 컨텍스트와 DB 트랜잭션 컨텍스트가 함께 누락되지 않게 하는 방법입니다."
  - title: "Database Credential Rotation과 Connection Pool"
    href: "/learning/deep-dive/deep-dive-database-credential-rotation-connection-pool-playbook/"
    description: "풀의 세션 수명과 DB role 변경을 운영 경계로 다루는 기준입니다."
decision_guide:
  title: "RLS를 어느 테이블과 경로에 적용할까"
  intro: "RLS는 강한 마지막 방어선이지만 모든 운영 계정과 모든 테이블에 무차별 적용하면 backup·migration·성능 진단을 어렵게 만들 수 있습니다. 데이터 민감도와 우회 가능성으로 우선순위를 정합니다."
  cases:
    - badge: "즉시 적용"
      title: "고객 데이터가 공유 테이블에 있고 query 누락 비용이 크다"
      fit: "주문, 문서, 파일 메타데이터, 권한, 결제 보조 데이터처럼 tenant_id 누락이 곧 데이터 노출인 테이블"
      watchouts: "table owner 또는 BYPASSRLS role로 접속하면 정책이 기대대로 적용되지 않는다."
      next_step: "runtime role을 분리하고 read/write policy와 no-context 실패 테스트부터 만든다."
    - badge: "제한 파일럿"
      title: "관리자 조회·대량 배치·교차 테넌트 집계가 많은 경로"
      fit: "운영 도구가 여러 tenant를 순회하지만 reason, approval, 범위를 이미 남길 수 있는 서비스"
      watchouts: "전체 조회용 우회 role을 기본 runtime credential로 섞으면 RLS의 의미가 사라진다."
      next_step: "별도 job role과 tenant manifest를 만들고, 허용된 운영 경로만 한 테이블씩 canary한다."
    - badge: "보류"
      title: "tenant 식별자와 권한 모델이 아직 불명확하다"
      fit: "한 행에 여러 조직이 접근하거나 tenant_id가 nullable이며 소유권 규칙이 문서화되지 않은 경우"
      watchouts: "복잡한 subquery policy를 먼저 넣으면 성능 회귀와 권한 오류를 함께 추적하기 어렵다."
      next_step: "resource owner, tenant key, admin override의 의미를 정리한 뒤 단순 policy부터 시작한다."
---

공유 DB·공유 스키마 SaaS에서 가장 무서운 버그는 느린 쿼리보다 `WHERE tenant_id = ?` 하나가 빠진 조회입니다. 컨트롤러에서 tenant를 확인했고 ORM filter도 켰다고 해도, native query, 관리용 report, 새 repository, 재처리 배치 중 하나가 이 규칙을 우회할 수 있습니다. PostgreSQL의 Row Level Security(RLS)는 이때 데이터베이스가 **최종적으로 어느 행을 보거나 바꿀 수 있는지** 제한하는 장치가 됩니다.

다만 RLS를 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` 한 줄로 이해하면 운영에서 위험합니다. 연결을 재사용하는 애플리케이션은 이전 요청의 session state를 다음 요청이 물려받을 수 있고, table owner나 `BYPASSRLS` 권한 role은 기본적으로 정책을 우회합니다. `USING`만 둔 정책은 기존 행을 가리는 데는 성공해도 다른 tenant의 행을 INSERT 또는 UPDATE하는 쓰기 경계에는 빈틈을 남길 수 있습니다.

이 글은 [Tenant Context Propagation](/learning/deep-dive/deep-dive-tenant-context-propagation-guardrails-playbook/), [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/), [ThreadLocal Context Propagation](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/), [Database Credential Rotation과 Connection Pool](/learning/deep-dive/deep-dive-database-credential-rotation-connection-pool-playbook/)의 DB 경계편입니다. 목표는 RLS를 권한 모델의 유일한 해답으로 과장하는 것이 아니라, 애플리케이션 검증을 통과한 요청도 DB에서 한 번 더 fail-closed로 확인하게 만드는 것입니다.

참고한 공식 문서:

- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL: CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)
- [PostgreSQL: SET](https://www.postgresql.org/docs/current/sql-set.html)

## 이 글에서 얻는 것

- RLS가 일반 `GRANT`와 다른 역할, 그리고 table owner·`BYPASSRLS`가 만드는 예외를 구분합니다.
- 요청에서 확인한 tenant scope를 DB 트랜잭션에 안전하게 전달하는 `SET LOCAL` 패턴을 배웁니다.
- `USING`, `WITH CHECK`, permissive/restrictive policy가 읽기와 쓰기를 어떻게 다르게 통제하는지 이해합니다.
- 커넥션 풀, 관리자 작업, backup, migration이 RLS를 무력화하거나 데이터 누락을 만들지 않도록 테스트 기준을 세웁니다.

## 핵심 개념/이슈

### 1) RLS는 권한 다음에 적용되는 행 단위 경계다

일반 SQL 권한은 "이 role이 `orders` 테이블을 SELECT할 수 있는가"를 답합니다. RLS는 그 다음에 "SELECT할 수 있어도 어느 행을 볼 수 있는가"를 답합니다. RLS를 켠 테이블에서 applicable policy가 없으면 일반 사용자는 기본 거부 상태가 됩니다. 이 fail-closed 성질이 tenant 조건을 코드 관례로만 두는 것보다 강한 이유입니다.

하지만 적용 대상 role이 중요합니다. PostgreSQL 문서 기준으로 superuser와 `BYPASSRLS` 속성을 가진 role은 RLS를 항상 우회합니다. table owner도 기본적으로 우회하며 필요하면 `FORCE ROW LEVEL SECURITY`로 owner에게도 정책을 적용할 수 있습니다. 따라서 아래처럼 책임을 분리해야 합니다.

| role | 책임 | RLS 기대값 | 운영 금지 |
| --- | --- | --- | --- |
| `app_runtime` | 일반 API·worker 요청 | 정책 적용, tenant context 필수 | table owner, `BYPASSRLS` |
| `app_migrator` | DDL과 policy 변경 | 별도 change window | 애플리케이션 connection string 공유 |
| `ops_breakglass` | 승인된 긴급 조사 | 기간·사유·감사 아래 예외 | 상시 배포 credential |
| `backup_operator` | 전체 백업·복구 검증 | RLS로 행이 조용히 빠지지 않아야 함 | 일반 API에서 사용 |

runtime role에 `BYPASSRLS`를 주거나 runtime role이 테이블을 소유하면, 정상 path에서 RLS를 테스트해도 실제 방어선은 없습니다. migration role을 따로 두고 runtime role에는 필요한 DML만 grant하는 것이 첫 조건입니다. owner가 application role인 레거시 테이블은 권한 소유권을 이전하거나, 영향을 검증한 뒤 `FORCE ROW LEVEL SECURITY`를 적용합니다.

### 2) tenant context는 session 값이 아니라 transaction 값이어야 한다

공유 테이블에서 흔한 policy는 검증된 tenant UUID를 custom setting에 넣고 `current_setting`으로 읽는 방식입니다. 핵심은 `SET`이 기본적으로 **현재 session**에 남는다는 점입니다. HikariCP, PgBouncer, R2DBC 같은 pool은 session을 다른 요청에 빌려주므로 `SET app.tenant_id = 'A'`를 사용하면 A의 문맥이 B에게 남을 수 있습니다.

명시적 transaction 안에서 `SET LOCAL`을 사용하면 commit과 rollback 뒤 설정이 사라집니다. PostgreSQL 문서도 `SET LOCAL`이 transaction 밖에서는 경고만 내고 효과가 없다고 설명합니다. 그러므로 자동 commit 한 쿼리와 임의 session setting 조합은 RLS context 전달 방식으로 쓰면 안 됩니다.

```sql
BEGIN;
SET LOCAL app.tenant_id = '6e5d71b7-6a8a-4c84-a41a-2f57dcb31ac0';

SELECT id, amount, status
FROM orders
WHERE id = 'order_2026_081';

COMMIT;
```

정책은 context가 없을 때도 전 행이 보이지 않도록 명시합니다. UUID 형식 검증은 API boundary에서 끝내고, DB에는 검증된 값을 parameterized `set_config` 또는 안전한 SQL binding으로 전달합니다.

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_tenant_scope ON orders
  FOR ALL TO app_runtime
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
```

이 예시는 context 없음이면 `USING`과 `WITH CHECK` 모두 false가 되게 합니다. `current_setting(..., true)`의 `true`는 setting이 없을 때 오류 대신 null을 돌려주는 선택입니다. `tenant_id`를 text로 두기보다 UUID 같은 실제 식별자 타입으로 두면 잘못된 형식을 더 빨리 드러낼 수 있습니다.

### 3) USING과 WITH CHECK는 읽기 정책과 쓰기 정책을 같이 완성한다

`USING`은 `SELECT`, `UPDATE`, `DELETE`에서 **기존 행이 대상이 될 수 있는지**를 결정합니다. `WITH CHECK`는 `INSERT`와 `UPDATE`의 **새 행 값이 허용되는지**를 결정합니다. 읽기 조건만 생각해 `USING`을 넣고, insert 경로가 다른 tenant_id를 쓰지 못하도록 보장하지 않으면 write isolation은 불완전합니다.

예를 들어 A tenant가 자기 주문을 update할 권한이 있어도 `tenant_id`를 B로 바꿔서는 안 됩니다. `WITH CHECK`가 이를 막습니다. 반대로 `FOR SELECT USING (true)` 같은 넓은 policy와 쓰기 policy를 같은 role에 붙이면 정책 조합을 잘못 이해할 수 있습니다. 기본 **permissive** policy는 OR로 합쳐지고, restrictive policy는 AND로 합쳐집니다. "보안 policy 하나를 추가했으니 더 좁아지겠지"라고 가정하지 말고, 기존 permissive policy가 이미 true를 허용하는지 함께 봐야 합니다.

| 검증 질문 | 잘못된 결과 | 필요한 policy 증거 |
| --- | --- | --- |
| A가 B 행을 SELECT하는가 | 0행 또는 permission 오류여야 함 | `USING` 차단 테스트 |
| A가 B 행을 UPDATE/DELETE하는가 | 0행 또는 permission 오류여야 함 | 기존 행 `USING` 테스트 |
| A가 `tenant_id=B`로 INSERT하는가 | `WITH CHECK` 위반이어야 함 | 새 행 검사 테스트 |
| context 없이 조회하는가 | 전체 조회가 아니라 0행/차단이어야 함 | no-context test |
| 여러 policy가 붙었는가 | 의도한 논리식만 허용 | `pg_policy`와 role별 test |

RLS는 foreign key나 unique constraint의 정보 노출 가능성까지 자동으로 해결하지 않습니다. PostgreSQL은 참조 무결성 검사를 위해 일부 제약 검사를 row security보다 우선할 수 있다고 문서화합니다. tenant마다 유일해야 하는 business key는 `UNIQUE (tenant_id, external_id)`처럼 schema 경계에도 tenant를 포함하고, 오류 메시지·count 차이에서 무엇이 드러나는지 고위험 테이블에서 검토해야 합니다.

### 4) 연결 풀 안전성은 cleanup이 아니라 transaction discipline에서 만든다

풀 reset hook에만 의존하면 프레임워크 변경이나 예외 경로를 놓치기 쉽습니다. 더 강한 규칙은 **DB 접근을 여는 service method가 transaction, tenant context 설정, query, 종료를 하나의 unit으로 보장하는 것**입니다. Spring이라면 tenant 검증 뒤 `@Transactional` 경계 안에서 `set_config('app.tenant_id', :tenantId, true)`를 실행합니다. 세 번째 인자 `true`는 transaction-local을 뜻합니다. 비동기 consumer와 scheduler도 HTTP filter를 거치지 않으므로 같은 wrapper를 직접 호출해야 합니다.

```sql
SELECT set_config('app.tenant_id', :tenant_id, true);
-- true: transaction-local. :tenant_id는 application parameter binding으로 전달한다.
```

운영 지표는 요청 수가 아니라 경계 실패를 봅니다.

- `rls_context_missing_total`: public API와 tenant worker에서 **0**이 목표입니다.
- `rls_cross_tenant_denied_total`: 평소 0을 유지하되, 1건이라도 발생하면 공격·버그·운영자 오용으로 분류합니다.
- transaction 누락으로 context 설정이 실패한 요청: 5분에 1건이면 배포 확대를 중단합니다.
- pool reuse test: 같은 physical connection에서 A → rollback → B → no-context 순서를 최소 100회 반복해 B가 A 행을 보지 않는지 확인합니다.

`ThreadLocal`에 든 tenant 정보와 DB GUC는 같은 것이 아닙니다. 전자는 애플리케이션의 로그·권한 결정을 돕고, 후자는 DB가 실제 row를 걸러내는 근거입니다. 둘 중 하나가 없으면 충분하지 않으며, 특히 reactive chain이나 worker executor를 건널 때는 [ThreadLocal Context Propagation](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/)의 cleanup 규칙과 transaction wrapper를 같이 적용합니다.

## 실무 적용

### 1) 작은 테이블부터 4단계로 rollout한다

**1단계 — inventory.** 공유 tenant table을 찾고 primary key, foreign key, unique key, ORM/native SQL, admin report, export, batch owner를 기록합니다. `tenant_id`가 null이거나 owner 규칙이 없는 테이블은 policy 대상으로 서두르지 않습니다. 먼저 owner와 자료 접근 규칙을 정합니다.

**2단계 — role과 테스트를 먼저 분리.** `app_runtime`이 owner가 아니고 `BYPASSRLS`가 없는지 확인합니다. tenant A, B, context 없음, break-glass role의 fixture를 만들고 SELECT·INSERT·UPDATE·DELETE 결과를 CI에 고정합니다. 이때 `row_security = off`를 가진 backup verification session은 정책으로 행이 필터되면 오류가 나게 하므로, 백업 누락을 조기에 찾는 데 유용합니다.

**3단계 — read-only canary.** 가장 단순한 customer-owned table 한 개에 SELECT policy를 적용하고, 오류율·no-context·p95 query time을 24시간 비교합니다. critical read가 1건이라도 잘못 차단되면 무작정 `USING (true)`를 넣지 말고 context 전달, role, policy 조합을 되짚습니다.

**4단계 — write와 관리자 경로 확대.** `WITH CHECK`까지 넣고 API 1~5% canary를 24시간 운영합니다. 일반 runtime role로는 전체 tenant query를 만들 수 없어야 합니다. support·reconciliation처럼 여러 tenant가 필요한 작업은 별도 role, 승인 ID, 최대 tenant 수, 실행 receipt를 요구합니다. 이 기준은 [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)의 물리적 분리 판단과도 연결됩니다.

### 2) 승인 기준을 숫자와 순서로 고정한다

RLS rollout의 우선순위는 **교차 테넌트 노출 방지 > 쓰기 정합성 > critical path 가용성 > query 성능 최적화**입니다. 보안 오류가 남아 있는데 p95가 좋아졌다는 이유로 확대하면 안 됩니다.

| 단계 | 확대 조건 | 중단 또는 rollback 조건 |
| --- | --- | --- |
| read policy canary | no-context 0건, cross-tenant test 100% 통과 | 다른 tenant 행 1건 노출 또는 critical 403 1건 |
| write policy canary | insert/update tenant swap 차단 100% | `WITH CHECK` 우회 또는 정합성 오류 1건 |
| 25% traffic | 24시간 p95 +10% 이내, DB error baseline 이내 | p95 +25% 또는 5분 이상 오류 증가 |
| 100% traffic | pool reuse 100회 통과, admin/backup rehearsal 완료 | backup row count 불일치 또는 break-glass 감사 누락 |

RLS expression에서 다른 테이블을 subquery로 읽을수록 policy 자체가 느려지고 lock·race condition 설명도 어려워집니다. 첫 rollout은 `tenant_id = context`처럼 현재 행만 읽는 policy를 우선합니다. 조직 membership 같은 복잡한 권한은 API authorization에서 먼저 판정하고, DB에는 이미 판정된 single tenant scope를 전달하는 편이 성능·감사 양쪽에서 단순합니다.

## 트레이드오프/주의점

첫째, RLS는 애플리케이션 authorization을 없애지 않습니다. RLS는 데이터 행의 마지막 경계이고, actor가 그 tenant를 선택할 자격이 있는지·운영자가 대리 접근할 사유가 있는지는 API와 authorization 계층이 판단해야 합니다. [Authorization Models](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)처럼 actor, resource, relationship의 의미를 먼저 정해야 합니다.

둘째, RLS가 적용된 쿼리는 planner·index 사용을 실제 workload에서 재확인해야 합니다. policy가 단순한 tenant equality라면 `(tenant_id, ...)` 복합 인덱스가 도움이 될 수 있지만, 무턱대고 인덱스를 추가하면 write amplification이 커집니다. RLS 도입의 보안 목적과 성능 조정을 한 release에서 섞지 말고 baseline과 `EXPLAIN (ANALYZE, BUFFERS)`를 분리해 비교합니다.

셋째, 운영자 예외는 RLS를 끄는 편의 기능이 되어서는 안 됩니다. 긴급 role이 필요하면 TTL, 승인 ID, 대상 tenant 목록, row count, reason을 감사 로그에 남기고 가능한 한 read-only로 시작합니다. table owner와 superuser를 일반 application secrets에 섞는 순간 이 모든 policy는 방어막이 아니라 문서가 됩니다.

넷째, 백업과 복구는 전 행을 보아야 하는 경로입니다. RLS 때문에 조용히 일부 행이 빠진 backup은 복구 시점까지 발견되지 않을 수 있습니다. backup 계정과 `row_security` fail-fast 검증을 별도 runbook과 주기적 restore drill에 포함합니다.

## 체크리스트 또는 연습

### 배포 체크리스트

- [ ] `app_runtime`은 table owner가 아니며 `BYPASSRLS`·superuser·불필요한 DDL 권한이 없다.
- [ ] `ENABLE ROW LEVEL SECURITY`와 `USING`, `WITH CHECK`가 read/write tenant table 모두에 의도대로 적용됐다.
- [ ] tenant context는 API에서 검증한 뒤 명시적 transaction 내부의 `SET LOCAL` 또는 `set_config(..., true)`로만 설정한다.
- [ ] tenant A/B/context 없음 조합으로 SELECT·INSERT·UPDATE·DELETE와 bulk path를 CI에서 검증한다.
- [ ] 동일 pooled connection의 A → rollback → B → no-context 반복 test를 최소 100회 통과했다.
- [ ] admin·batch·backup role은 runtime role과 분리됐고 approval·row count·restore drill 증거가 있다.
- [ ] `rls_context_missing_total`과 cross-tenant 차단 이벤트를 alert와 deployment gate에 연결했다.

### 연습

`orders(tenant_id uuid, id uuid, amount numeric)` 테이블에 두 tenant fixture를 넣고 다음을 직접 시험해 보세요. (1) tenant A context에서 tenant B 행이 0건인지, (2) A가 B의 `tenant_id`로 INSERT할 때 `WITH CHECK`가 실패하는지, (3) transaction을 rollback한 뒤 같은 connection에서 context 없이 조회해도 A의 행이 보이지 않는지 확인합니다. 마지막으로 application role을 owner role로 바꿔 실행해 RLS 우회가 왜 role 분리를 요구하는지 재현해 봅니다.
