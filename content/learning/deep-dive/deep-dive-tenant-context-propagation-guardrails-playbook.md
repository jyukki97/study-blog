---
title: "백엔드 커리큘럼 심화: Tenant Context Propagation, 테넌트 누락과 교차 접근을 막는 운영 플레이북"
date: 2026-07-20
draft: false
topic: "Backend Security"
tags: ["Multitenancy", "Tenant Context", "Authorization", "ThreadLocal", "Backend Security", "Observability"]
categories: ["Backend Deep Dive"]
description: "멀티테넌트 서비스에서 tenant_id를 단순 컬럼이 아니라 HTTP, 비동기 메시지, 배치, 로그, 권한 판정까지 전파되는 운영 계약으로 관리하는 기준을 정리합니다."
module: "backend-security"
study_order: 1264
key_takeaways:
  - "멀티테넌트 사고는 데이터 모델보다 tenant context가 누락되거나 잘못 전파되는 경로에서 자주 시작된다."
  - "HTTP, 큐, 배치, 관리자 도구, 로그가 서로 다른 방식으로 tenant_id를 다루면 필터 누락과 교차 접근을 리뷰로 잡기 어렵다."
  - "tenant context는 required input, authorization subject, audit dimension, observability label을 함께 가진 운영 계약으로 설계해야 한다."
operator_checklist:
  - "모든 public endpoint, worker, batch job에 tenant context source와 검증 실패 시 동작을 문서화한다."
  - "tenant_id missing rate는 0을 목표로 두고, 내부 admin 경로도 `system` 같은 명시적 actor/tenant scope를 요구한다."
  - "tenant label은 메트릭 고카디널리티를 만들 수 있으므로 전체 metric에는 plan/segment를 쓰고, 원 tenant_id는 로그/trace로 넘긴다."
learning_refs:
  - title: "멀티테넌시 전략"
    href: "/learning/deep-dive/deep-dive-multitenancy-strategy/"
    description: "DB 분리, 스키마 분리, 공유 테이블 전략의 큰 선택지를 먼저 정리합니다."
  - title: "ThreadLocal Context Propagation"
    href: "/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/"
    description: "요청 컨텍스트가 스레드와 비동기 실행 경계를 지날 때 생기는 누락과 오염을 다룹니다."
  - title: "Authorization Models"
    href: "/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/"
    description: "테넌트 스코프와 권한 판정을 RBAC, ABAC, ReBAC 관점으로 연결합니다."
  - title: "구조화 로깅"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "tenant_id, actor, request_id를 검색 가능한 운영 증거로 남기는 기준입니다."
decision_guide:
  title: "tenant context guardrail을 어디까지 강제할까"
  intro: "초기 서비스에서는 tenant_id 필터 몇 개로 충분해 보이지만, 관리자 기능·비동기 작업·데이터 export가 붙으면 누락 경로가 빠르게 늘어납니다. 위험도에 따라 기본 차단, 제한 허용, 명시 승인 경로를 나눠야 합니다."
  cases:
    - badge: "필수 차단"
      title: "고객 데이터 조회·수정 경로"
      fit: "주문, 결제, 문서, 파일, 권한, 과금처럼 테넌트 간 노출이 곧 보안 사고인 경로"
      watchouts: "tenant_id 누락 시 전체 조회가 되거나, admin override가 감사 없이 열릴 수 있다."
      next_step: "API boundary, repository layer, DB policy 중 최소 2곳에서 tenant scope를 강제한다."
    - badge: "명시 허용"
      title: "운영자·배치·마이그레이션 경로"
      fit: "여러 테넌트를 순회해야 하지만 owner, reason, 범위, dry-run 결과가 필요한 작업"
      watchouts: "system job이라는 이름으로 모든 테넌트 접근이 열리면 감사와 롤백이 어렵다."
      next_step: "tenant scope list, max tenant count, approval id, execution receipt를 함께 요구한다."
    - badge: "집계 처리"
      title: "관측·분석·대시보드 경로"
      fit: "전체 사용량, plan별 상태, 운영 SLO처럼 개별 테넌트보다 집계가 중요한 데이터"
      watchouts: "tenant_id를 metric label로 직접 넣으면 비용과 알람 성능이 나빠진다."
      next_step: "메트릭은 plan/segment, 로그와 trace는 원 tenant_id로 분리한다."
faqs:
  - question: "공유 테이블에 tenant_id 인덱스만 있으면 충분한가요?"
    answer: "아닙니다. 인덱스는 성능 장치이고, tenant context 누락을 막는 보안 장치가 아닙니다. API, 권한 판정, repository query, 감사 로그가 같은 scope를 공유해야 합니다."
  - question: "관리자 기능은 tenant scope 없이 전체 조회해도 되나요?"
    answer: "전체 조회가 필요한 경우도 있지만, 기본값이면 위험합니다. 최소한 reason, actor, tenant scope, 결과 row count, approval id를 남기고 대량 조회는 별도 승인 경로로 분리해야 합니다."
---

멀티테넌트 서비스 사고는 대개 "테이블에 `tenant_id` 컬럼이 없어서"만 발생하지 않습니다. 컬럼은 있는데 특정 API에서 where 조건이 빠지고, 비동기 메시지에 tenant 정보가 없고, 배치가 전체 테넌트를 순회하면서 실패 범위를 기록하지 않고, 관리자 도구가 `tenant_id = null`을 전체 조회로 해석하면서 문제가 시작됩니다. 즉 위험의 중심은 데이터 모델이 아니라 **tenant context가 어느 경계를 통과할 때 사라지거나 바뀌는가**입니다.

처음에는 컨트롤러에서 `X-Tenant-Id`를 읽고 쿼리에 붙이는 정도로도 동작합니다. 하지만 로그인 주체, 조직 전환, 관리자 대리 작업, webhook, 메시지 큐, scheduled job, export, 검색 인덱스, 감사 로그가 붙으면 상황이 달라집니다. 어떤 경로는 사용자 토큰에서 테넌트를 얻고, 어떤 경로는 URL path에서 얻고, 어떤 경로는 메시지 payload에서 얻습니다. 이 규칙이 흩어지면 코드 리뷰로 교차 접근을 잡기 어렵습니다.

이 글은 [멀티테넌시 전략](/learning/deep-dive/deep-dive-multitenancy-strategy/), [ThreadLocal Context Propagation](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/), [Authorization Models](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/), [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)과 이어집니다. 핵심은 `tenant_id`를 보조 파라미터로 보지 않고, 요청 수락부터 권한 판정, 데이터 접근, 로그, 재처리까지 따라다니는 운영 계약으로 다루는 것입니다.

## 이 글에서 얻는 것

- tenant context를 단순 DB 필터가 아니라 요청·작업·감사 범위로 이해합니다.
- HTTP, 메시지 큐, 배치, 관리자 작업에서 tenant scope를 어떤 우선순위로 강제할지 정할 수 있습니다.
- `ThreadLocal`, security context, MDC, trace attribute를 사용할 때 누락과 오염을 줄이는 기준을 가져갑니다.
- 테넌트별 관측성을 만들 때 메트릭 카디널리티와 보안 로그 사이의 경계를 나눌 수 있습니다.

## 핵심 개념/이슈

### 1) tenant context는 "누구의 데이터인가"와 "누가 행동하는가"를 함께 담아야 한다

멀티테넌트 요청에는 최소 두 축이 있습니다. 첫째는 데이터 소유 범위인 tenant scope입니다. 둘째는 행동 주체인 actor입니다. 일반 사용자가 자기 조직의 주문을 조회하는 경우에는 actor tenant와 resource tenant가 같을 가능성이 큽니다. 하지만 고객지원 담당자가 특정 고객사를 대리 조회하거나, 정산 배치가 여러 테넌트를 순회하거나, 시스템 작업이 만료 데이터를 삭제하는 경우에는 둘이 다를 수 있습니다.

그래서 context를 아래처럼 나눠 기록하는 편이 안전합니다.

| 필드 | 의미 | 예시 |
| --- | --- | --- |
| `actor_id` | 실제 행동 주체 | `user_123`, `system:billing-reconciler` |
| `actor_type` | 사용자, 시스템, 관리자 | `user`, `admin`, `system` |
| `tenant_scope` | 접근 허용 테넌트 범위 | `tenant_42`, `tenant_42,tenant_51`, `all:approved` |
| `resource_tenant_id` | 대상 데이터의 소유 테넌트 | `tenant_42` |
| `reason_code` | 대리·운영 접근 이유 | `support_case`, `monthly_billing`, `migration` |
| `approval_id` | 고위험 접근 승인 근거 | `apr_20260720_001` |

이 구조가 있으면 "관리자는 볼 수 있다" 같은 넓은 문장을 더 좁게 만들 수 있습니다. 관리자가 보더라도 어떤 테넌트를, 어떤 이유로, 어떤 승인 아래 봤는지가 남아야 합니다. [Authorization Models](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)에서 권한 모델을 고르는 것도 결국 이 context를 판정 가능한 형태로 만드는 일입니다.

### 2) tenant source는 경로마다 다르지만 우선순위는 하나여야 한다

실무에서 tenant_id가 들어오는 곳은 여러 개입니다.

- JWT claim 또는 session
- URL path: `/tenants/{tenantId}/orders`
- header: `X-Tenant-Id`
- message payload
- job parameter
- admin console selection
- system config 또는 migration plan

문제는 이 값들이 서로 다를 때입니다. URL은 `tenantA`인데 token claim은 `tenantB`이고, header에는 `tenantC`가 들어오면 무엇을 믿어야 할까요. 이 규칙이 endpoint마다 다르면 사고가 납니다.

권장 우선순위는 이렇습니다.

1. 인증된 actor가 속한 tenant membership을 1차 진실로 둔다.
2. URL/path tenant는 resource scope 선택값으로 보고 membership과 교차 검증한다.
3. header tenant는 내부 gateway가 서명·주입한 경우에만 신뢰한다.
4. 메시지 tenant는 producer identity와 payload tenant를 함께 검증한다.
5. 배치 tenant는 manifest나 job parameter의 명시 범위만 허용한다.
6. 값이 충돌하면 자동 보정보다 거절하고 audit event를 남긴다.

숫자 기준도 단순하게 시작할 수 있습니다. `tenant_context_missing_total`은 운영 경로에서 0이어야 합니다. 내부 system job도 예외가 아니라 `actor_type=system`, `tenant_scope=explicit_list`처럼 명시해야 합니다. tenant mismatch가 5분에 1건이라도 발생하면 보안 이벤트로 보고, 사용자 오류인지 gateway 버그인지 분류합니다.

### 3) ThreadLocal은 편하지만 비동기 경계에서 쉽게 새거나 사라진다

Spring MVC 같은 request-per-thread 모델에서는 tenant context를 `ThreadLocal`, `SecurityContext`, MDC에 넣는 패턴이 흔합니다. 컨트롤러와 서비스, repository가 같은 스레드에서 실행될 때는 편합니다. 하지만 비동기 실행, scheduler, Reactor, `CompletableFuture`, executor pool, messaging listener로 넘어가면 context가 자동으로 따라가지 않거나, 더 나쁘게는 이전 요청의 context가 남을 수 있습니다.

그래서 원칙은 둘입니다.

첫째, 보안 판단에는 암묵적 `ThreadLocal`만 의존하지 않습니다. repository나 domain service의 핵심 메서드는 명시적 `TenantContext` 또는 `TenantScope`를 인자로 받을 수 있어야 합니다. 적어도 데이터 접근 boundary에서는 "현재 thread에 있겠지"가 아니라 "이 작업의 scope가 무엇인가"를 확인해야 합니다.

둘째, thread pool 사용 후 cleanup을 강제합니다. MDC, SecurityContext, tenant holder는 요청 종료와 task 종료 시 제거되어야 합니다. 이 부분은 [ThreadLocal Context Propagation](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/)의 기준을 그대로 적용하면 됩니다. 특히 worker pool에서 tenant context leak 테스트를 만들어 두는 편이 좋습니다.

운영 기준:

- public API에서 tenant context missing: 0건
- async task에서 tenant context missing: 0건, system task는 명시적 `system` scope 필요
- tenant mismatch: 1건 이상이면 보안 이벤트
- context cleanup test: request, async, scheduler, listener 경로마다 최소 1개
- MDC에 tenant_id 누락 로그 비율: 0.1% 초과 시 계측 누락 점검

### 4) DB 필터는 마지막 방어선이지 유일한 방어선이 아니다

공유 테이블 전략에서는 모든 쿼리에 `tenant_id = ?`가 들어가야 합니다. Hibernate Filter, JPA Specification, MyBatis interceptor, Row Level Security 같은 방법을 쓸 수 있습니다. 하지만 이 장치를 하나만 믿으면 안 됩니다.

예를 들어 애플리케이션 interceptor가 자동으로 tenant 조건을 붙여도 native query, batch job, migration script, admin report query는 우회할 수 있습니다. 반대로 DB Row Level Security만 믿으면 애플리케이션 로그에는 왜 차단됐는지, 어떤 actor가 어떤 resource를 요청했는지 맥락이 부족할 수 있습니다.

저는 최소 2중 방어를 권장합니다.

| 계층 | 역할 | 실패 시 기대 동작 |
| --- | --- | --- |
| API boundary | actor membership과 요청 tenant 충돌 검증 | 403 또는 400 |
| Service/repository | `TenantScope` 없이는 데이터 접근 불가 | build/test 실패 또는 런타임 차단 |
| DB policy | 우회 쿼리의 최종 차단 | 빈 결과 또는 permission denied |
| Audit log | 대리 접근과 차단 이벤트 증거화 | 보안 리뷰 가능 |

모든 팀이 처음부터 RLS까지 넣을 필요는 없습니다. 하지만 결제, 파일, 권한, 고객 문서처럼 테넌트 교차 노출 비용이 큰 도메인은 애플리케이션 필터 하나로 끝내지 않는 편이 안전합니다.

### 5) 관리자·배치 경로가 가장 위험하다

사용자 API는 상대적으로 테스트가 많습니다. 오히려 위험한 곳은 관리자 검색, 데이터 export, 운영 보정 배치, 마이그레이션 스크립트입니다. 이런 경로는 "운영상 필요"라는 이유로 전체 접근을 쉽게 열어 두고, 테스트와 감사는 약한 경우가 많습니다.

관리자 경로는 기본값을 좁게 잡습니다.

- 단일 테넌트 조회가 기본
- 전체 테넌트 조회는 별도 권한과 reason code 필요
- 결과 row count가 10,000건 이상이면 export job과 approval 필요
- 고객 데이터 원문 포함 export는 보관 기간과 다운로드 감사 필요
- support 대리 접근은 case id와 만료 시간을 요구

배치도 마찬가지입니다. `all tenants`를 한 번에 순회하는 job은 편하지만, 장애 반경이 큽니다. tenant batch manifest를 만들고 한 번에 처리할 tenant 수를 제한해야 합니다. 예를 들어 `max_tenants_per_run=100`, `tenant_error_rate > 3%`면 자동 중단, `single_tenant_duration_p95 > 2분`이면 다음 tenant로 넘어가기 전 throttle을 넣는 식입니다.

## 실무 적용

### 1) Tenant context contract를 한 장으로 만든다

먼저 코드부터 고치기보다 contract를 적습니다.

```yaml
tenant_context_contract:
  required_for:
    - public_api
    - internal_api
    - message_consumer
    - scheduled_job
    - admin_console
  source_priority:
    public_api: ["authenticated_membership", "path_tenant", "signed_gateway_header"]
    message_consumer: ["producer_identity", "payload_tenant", "topic_scope"]
    scheduled_job: ["job_manifest", "approval_scope"]
  missing_policy:
    customer_data: deny
    public_catalog: allow_with_public_scope
    system_maintenance: require_system_actor_and_reason
  mismatch_policy:
    default: deny_and_audit
  audit_fields:
    - actor_id
    - actor_type
    - tenant_scope
    - resource_tenant_id
    - reason_code
    - approval_id
    - request_id
```

이 문서가 있으면 API마다 판단이 달라지는 것을 줄일 수 있습니다. 특히 `missing_policy`를 적는 것이 중요합니다. tenant가 없을 때 전체 조회인지, public scope인지, 거절인지가 명확해야 합니다.

### 2) 코드에서는 context 없이는 repository에 못 들어가게 만든다

가능하면 데이터 접근 계층의 함수 시그니처에 scope를 드러냅니다.

```kotlin
data class TenantScope(
    val tenantIds: Set<TenantId>,
    val actor: Actor,
    val reasonCode: String? = null,
    val approvalId: String? = null
)

interface OrderRepository {
    fun findOrders(scope: TenantScope, query: OrderQuery): List<OrderSummary>
    fun findOrderById(scope: TenantScope, orderId: OrderId): OrderDetail?
}
```

이 방식은 귀찮아 보이지만 효과가 큽니다. 호출부가 scope를 만들지 않으면 컴파일 또는 테스트 단계에서 드러납니다. 모든 프로젝트가 이렇게 바꾸기 어렵다면, 최소한 고위험 repository부터 적용합니다. 결제, 권한, 파일, 고객 문서, export가 1순위입니다.

### 3) 관측은 metric과 log를 나눠 설계한다

테넌트별 문제를 보고 싶다고 모든 metric label에 `tenant_id`를 넣으면 곧 비용 문제가 됩니다. 테넌트가 수백·수천 개면 시계열이 폭발하고, Prometheus나 장기 저장소 비용이 커집니다. [Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)의 기준을 적용해 metric과 log의 역할을 나눕니다.

권장 분리:

- metric label: `plan`, `region`, `tenant_tier`, `endpoint`, `status`
- log field: `tenant_id`, `actor_id`, `resource_id`, `approval_id`
- trace attribute: sampled request의 `tenant_id`, `tenant_scope_kind`
- audit event: 고위험 접근의 원문 context 전체

알람은 개별 tenant보다 비율을 먼저 봅니다.

| 지표 | 초기 기준 |
| --- | --- |
| `tenant_context_missing_rate` | 0% |
| `tenant_context_mismatch_total` | 1건 이상 보안 이벤트 |
| `cross_tenant_denied_total` | 급증 시 공격 또는 클라이언트 버그 |
| `admin_all_tenant_query_total` | 하루 0건 목표, 발생 시 승인 근거 확인 |
| `tenant_scope_all_without_approval_total` | 0건 |
| `tenant_id_metric_cardinality` | 예산 초과 시 label 제거 |

### 4) 테스트는 happy path보다 누락 경로를 넣는다

멀티테넌트 테스트는 "A 테넌트가 A 데이터를 볼 수 있다"보다 "A 테넌트가 B 데이터를 못 본다"가 더 중요합니다. 최소 테스트 세트는 아래입니다.

1. token tenant와 path tenant가 다르면 거절된다.
2. tenant context 없이 customer data repository를 호출하면 실패한다.
3. async task로 넘어가도 tenant context가 유지된다.
4. executor 재사용 후 이전 tenant context가 남지 않는다.
5. admin 전체 조회는 approval id 없이는 실패한다.
6. batch job manifest에 없는 tenant는 처리하지 않는다.
7. 로그에는 tenant_id와 request_id가 함께 남는다.

E2E가 무거우면 repository contract test와 filter test부터 둡니다. 특히 native query와 report query는 자동 필터를 우회하기 쉬우므로 샘플 데이터를 A/B 테넌트로 넣고 결과에 B 데이터가 섞이지 않는지 확인해야 합니다.

## 트레이드오프/주의점

첫째, context 강제가 늘면 코드가 장황해집니다. 하지만 고객 데이터 경계에서는 장황함이 비용보다 낫습니다. 편의 때문에 `TenantContextHolder.current()`만 쓰면 비동기 경계와 테스트에서 누락을 놓치기 쉽습니다.

둘째, 관리자 경로를 너무 막으면 운영 대응이 늦어질 수 있습니다. 그래서 전체 접근을 금지하기보다 reason, approval, row count, TTL, audit을 붙인 명시 경로로 분리하는 편이 현실적입니다.

셋째, metric에 tenant_id를 무심코 넣으면 관측 비용이 커집니다. 개별 tenant 디버깅은 로그와 trace, 집계 상태는 metric으로 나누는 원칙이 필요합니다.

넷째, DB RLS는 강력하지만 모든 ORM·배치·마이그레이션 흐름과 잘 맞는지 검증해야 합니다. RLS를 켰는데 운영 배치가 조용히 빈 결과를 처리하면 데이터 누락이 생길 수 있습니다.

다섯째, system actor를 면책 카드로 쓰면 안 됩니다. system job도 어떤 테넌트를 왜 처리했는지 남겨야 하고, 전체 테넌트 순회는 중단 조건과 영향 범위를 가져야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] public API, internal API, worker, batch, admin console별 tenant source를 문서화했다.
- [ ] tenant missing과 mismatch 정책이 endpoint별로 다르지 않다.
- [ ] customer data repository는 `TenantScope` 없이는 호출할 수 없다.
- [ ] 관리자 전체 조회는 reason code, approval id, row count audit을 남긴다.
- [ ] async/executor/scheduler/listener 경로에서 context cleanup 테스트가 있다.
- [ ] metric에는 고카디널리티 tenant_id를 남발하지 않고 로그·trace와 역할을 나눴다.
- [ ] tenant mismatch 1건 이상을 보안 이벤트로 분류한다.

### 연습

현재 서비스에서 `tenant_id`가 들어가는 경로를 10개만 골라 표로 적어 보세요. 각 행에는 `source`, `검증 위치`, `누락 시 동작`, `충돌 시 동작`, `audit field`, `테스트 존재 여부`를 넣습니다. 이 표에서 "코드상 아마 들어올 것"이라고만 적히는 경로가 있다면, 그 지점이 다음 보강 후보입니다.

## 관련 글

- [멀티테넌시 전략](/learning/deep-dive/deep-dive-multitenancy-strategy/)
- [ThreadLocal Context Propagation](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/)
- [Authorization Models: RBAC, ABAC, ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)
- [Metric Cardinality Budget](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)
