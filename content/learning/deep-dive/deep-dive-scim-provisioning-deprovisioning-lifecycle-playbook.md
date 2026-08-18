---
title: "백엔드 커리큘럼 심화: SCIM 프로비저닝·비활성화, IdP-애플리케이션 계정 수명주기 운영 플레이북"
date: 2026-08-17
draft: false
topic: "Backend Security"
tags: ["SCIM", "Identity Lifecycle", "Provisioning", "Deprovisioning", "Authorization", "SaaS Security", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "SCIM으로 사용자와 그룹을 연동할 때 계정 생성보다 어려운 비활성화, 그룹 동기화, 재시도, 권한 캐시 무효화, 정합성 점검을 운영 기준과 함께 정리합니다."
module: "backend-security"
study_order: 1485
key_takeaways:
  - "SCIM은 로그인 프로토콜이 아니라 IdP의 조직 변경을 애플리케이션 계정과 권한에 반영하는 수명주기 계약이다."
  - "고위험 계정의 비활성화는 SCIM 요청 성공만이 아니라 세션·API Key·권한 캐시까지 차단됐다는 증거로 완료한다."
  - "Push 이벤트가 있어도 일 단위 reconciliation이 있어야 누락·중복·수동 변경으로 생긴 권한 드리프트를 찾을 수 있다."
operator_checklist:
  - "외부 식별자는 변경 가능한 이메일이 아니라 IdP의 불변 ID와 tenant 범위를 조합해 저장한다."
  - "admin·PII export·production write 권한은 IdP 비활성화 후 5분 이내 차단을 목표로 하고, 일반 계정은 60분 이내 반영 SLO를 둔다."
  - "SCIM PATCH/PUT 재시도는 request ID, 대상 version, 최종 desired state를 기록해 중복 호출에도 안전하게 만든다."
  - "매일 IdP와 애플리케이션의 active user, group membership, privileged role 차이를 대조하고 예외를 티켓으로 남긴다."
learning_refs:
  - title: "OAuth 2.0과 OpenID Connect"
    href: "/learning/deep-dive/deep-dive-oauth2-oidc/"
    description: "인증과 토큰 발급의 경계를 먼저 이해하면 SCIM이 무엇을 대신하지 않는지 분명해집니다."
  - title: "Permission Drift와 Access Review"
    href: "/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/"
    description: "동기화가 끝난 뒤에도 남는 오래된 권한을 검토·회수하는 운영 기준입니다."
  - title: "권한 판정 캐시 무효화"
    href: "/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/"
    description: "계정 비활성화가 실제 요청 차단으로 이어지게 만드는 캐시·이벤트 설계입니다."
  - title: "API Key Lifecycle과 회수"
    href: "/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/"
    description: "사람 계정 삭제와 함께 서비스 계정·API Key도 회수해야 하는 이유를 다룹니다."
---

SaaS나 사내 관리 도구에서 SSO를 붙인 뒤에도 계정 운영 문제는 사라지지 않습니다. 사용자는 IdP(Identity Provider)에서 입사·부서 이동·휴직·퇴사 상태가 바뀌고, 애플리케이션에는 별도의 사용자 row, 그룹, 역할, 세션, API Key, 캐시된 권한 판정이 남습니다. 로그인만 OIDC로 연결해 두면 퇴사자는 다음 로그인만 막힐 수 있습니다. 이미 발급된 세션이나 service account가 계속 동작하고, 수동으로 부여한 admin 역할이 남으면 실제 접근은 끊기지 않습니다.

이때 SCIM(System for Cross-domain Identity Management)은 "사용자를 자동 생성하는 API"보다 **IdP의 조직 상태를 애플리케이션의 접근 상태로 전파하는 수명주기 계약**입니다. [OAuth 2.0과 OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/)가 로그인과 토큰의 계약이라면, SCIM은 누가 계정을 가져야 하는지와 언제 회수할지를 다룹니다. [Permission Drift와 Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/), [권한 판정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/), [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)까지 함께 설계해야 "IdP에서는 비활성인데 서비스에는 살아 있는 계정"을 줄일 수 있습니다.

## 이 글에서 얻는 것

- SCIM, SSO, 애플리케이션 인가가 각각 무엇을 책임지는지 구분할 수 있습니다.
- 사용자·그룹 연동에서 불변 식별자, 상태 전이, 멱등 재시도, 실패 큐를 어떤 데이터로 남길지 결정할 수 있습니다.
- 퇴사·계약 만료·고위험 권한 회수에서 비활성화 완료를 판정하는 시간 기준과 증거를 만들 수 있습니다.
- push 연동이 있어도 필요한 reconciliation과 Access Review의 역할을 분리할 수 있습니다.

## 핵심 개념/이슈

### 1) SCIM은 인증을 대신하지 않고, 계정 수명주기를 전달한다

역할을 섞으면 장애가 길어집니다. OIDC/SAML은 사용자가 IdP에서 인증됐음을 애플리케이션에 전달합니다. SCIM은 `Users`, `Groups` 리소스를 통해 그 사용자가 어떤 애플리케이션 계정과 조직 관계를 가져야 하는지 전달합니다. 애플리케이션의 RBAC·ABAC·ReBAC은 마지막으로 특정 요청을 허용할지 판단합니다.

| 계층 | 핵심 질문 | 대표 실패 | 운영 책임 |
| --- | --- | --- | --- |
| 인증(SSO) | 지금 이 사용자는 본인인가 | 토큰 검증·issuer 오류 | IdP, OIDC/SAML 설정 |
| 프로비저닝(SCIM) | 이 사용자는 이 앱에 존재해야 하는가 | 퇴사자·그룹 변경 미반영 | IdP와 앱의 동기화 계약 |
| 인가 | 이 요청을 실행해도 되는가 | 과도한 role, stale allow | 앱의 policy와 PDP/PEP |
| 세션·자격증명 | 과거에 발급한 접근 수단을 끊었는가 | 기존 세션·API Key 생존 | session/key revoke 경로 |

SCIM의 `active: false`를 받았다고 곧바로 데이터 row를 지우면 안 됩니다. 감사·복구·재고용 처리에 필요한 식별자와 이벤트가 사라지고, 지연된 그룹 이벤트가 계정을 다시 만들 때 원인을 추적하기 어렵습니다. 일반적으로는 `active -> suspended -> revoked`처럼 접근 가능 상태와 보존 상태를 분리합니다. 삭제는 보존 기간과 법적 요구가 정해진 뒤 별도 데이터 수명주기로 처리합니다.

### 2) 이메일은 식별자가 아니라 속성이다

SCIM 연동에서 가장 위험한 설계 중 하나는 `userName`이나 이메일을 데이터베이스의 유일한 외부 키로 쓰는 일입니다. 이메일은 개명, 도메인 통합, 재입사, 고객사 테넌트 이동으로 바뀔 수 있습니다. 서로 다른 IdP가 같은 이메일을 보낼 수도 있습니다. 다음처럼 IdP 연결과 테넌트 범위 안에서 불변 ID를 보관하는 편이 안전합니다.

```text
identity_links
- tenant_id
- idp_connection_id
- scim_resource_id
- external_subject_id      # IdP의 불변 subject/object ID
- account_id
- lifecycle_state          # pending, active, suspended, revoked
- source_version           # IdP가 보낸 revision 또는 updated_at
- last_scim_event_at
- last_reconciled_at
```

`external_subject_id`가 같은데 이메일이 바뀌면 계정 속성만 업데이트합니다. 반대로 이메일이 같아도 `tenant_id`나 `idp_connection_id`가 다르면 자동 병합하지 않습니다. 자동 병합은 다른 고객사의 사용자가 기존 계정의 데이터·권한을 이어받는 계정 탈취로 번질 수 있습니다. 모호한 충돌은 `manual_review` 상태로 보내고, tenant owner가 승인하기 전에는 login을 열지 않는 것이 안전합니다.

### 3) 사용자 비활성화는 하나의 PATCH가 아니라 fan-out 작업이다

SCIM provider가 `active: false`를 보내면 애플리케이션은 적어도 네 경로를 정리해야 합니다.

```text
SCIM event -> lifecycle ledger -> account disable
                            ├-> session revoke
                            ├-> authorization cache invalidate
                            ├-> API key / personal token revoke
                            └-> group-role detach + audit event
```

여기서 순서와 완료 조건이 중요합니다. 계정을 먼저 `suspended`로 바꿔 새 요청을 deny하고, 이어서 세션과 토큰을 끊고, 권한 캐시를 무효화하며, 비동기 후속 작업은 outbox나 작업 큐로 끝까지 추적합니다. 특정 worker가 실패해도 "SCIM 200 응답"만으로 완료 처리하면 안 됩니다. `lifecycle_ledger`에 correlation ID, desired state, 후속 task 상태, 재시도 횟수, 완료 시각을 남겨야 합니다.

권장 목표는 업무 위험도에 따라 다릅니다.

| 대상 | 차단 목표 | 검증 증거 |
| --- | --- | --- |
| 결제·권한 부여·PII export | 5분 이내 | 다음 요청이 401/403, 활성 세션 0, privileged role 0 |
| production write·운영 admin | 15분 이내 | policy version 갱신, break-glass 제외 역할 해제 |
| 일반 내부 사용자 | 60분 이내 | 신규 로그인 거부, 다음 세션 갱신에서 차단 |
| 분석·학습용 read-only | 24시간 이내 | 일일 reconciliation에서 inactive 반영 |

숫자는 SLO의 출발점입니다. 더 중요한 것은 각 등급에 owner와 알림 규칙을 붙이는 것입니다. high-risk 차단이 5분을 넘기면 단순 SCIM 오류가 아니라 보안 incident 후보로 전환해야 합니다.

### 4) 그룹 동기화는 role을 덮어쓰는 정책이 아니다

IdP 그룹을 `billing-admin`, `project-reader` 같은 역할로 바로 매핑하면 시작은 빠릅니다. 그러나 tenant 내부에서만 허용된 예외 권한, break-glass 권한, 서비스 계정 역할까지 한 번의 전체 교체로 지우면 운영 장애가 납니다. 반대로 SCIM 그룹 삭제를 무시하면 권한 드리프트가 누적됩니다.

해결은 role grant에 **출처**를 남기는 것입니다. 예를 들어 `source = scim_group`, `source = manual_approval`, `source = break_glass`를 구분합니다. SCIM은 자신이 소유한 `scim_group` grant만 desired state로 맞추고, 수동 예외는 만료·승인 규칙으로 별도 관리합니다. "SCIM이 모든 권한의 source of truth인가"는 서비스마다 명시적으로 결정해야 합니다. 고객 테넌트 role을 IdP 그룹으로 전부 관리하기 어렵다면, 전사 baseline만 SCIM으로 받고 프로젝트 권한은 앱 내부 워크플로로 분리하는 편이 낫습니다.

### 5) push 연동에는 반드시 reconciliation이 따라야 한다

웹훅이나 SCIM API는 네트워크 timeout, 429, provider 재시도, 잘못된 필터, 수동 DB 수정으로 누락될 수 있습니다. 따라서 push는 신속성, reconciliation은 정합성에 책임을 둡니다. 매일 최소 한 번 IdP와 앱의 다음 집합을 비교합니다.

- active user 수와 불변 외부 ID 집합
- SCIM 관리 그룹의 membership 차이
- high-risk role을 가진 inactive account
- 24시간 이상 처리되지 않은 lifecycle task와 DLQ
- IdP에 없는 앱 계정 및 앱에 없는 IdP 사용자

처음부터 전체 사용자를 매시간 전수 조회할 필요는 없습니다. 변경 시각이나 cursor로 증분 비교하고, 고위험 role만 1시간마다 별도 대조하는 방식이 현실적입니다. 단, "차이가 0"인지와 "조회가 실패했다"는 다른 상태입니다. 실패한 reconciliation을 성공으로 집계하면 드리프트가 보이지 않습니다.

## 실무 적용

### 1) IdP 연결별 수명주기 계약을 문서화한다

새 고객사나 사내 IdP를 연결하기 전에 아래 항목을 한 페이지로 고정합니다.

```text
Connection: acme-okta-prod
Authoritative fields: external_subject_id, active, department
SCIM-managed groups: acme-engineering, acme-support
Manual-role policy: allowed only for incident responder, expires in 8h
Deactivation SLO: privileged 5m / standard 60m
Retry policy: exponential backoff, max 10 attempts, then DLQ
Reconciliation: daily full diff, hourly privileged-role diff
Conflict policy: same email + different external ID -> manual review, deny login
```

이 문서가 없으면 IdP 관리자와 애플리케이션 운영자가 서로 다른 기대를 갖게 됩니다. 특히 "그룹 삭제가 role 회수인가", "재입사자는 이전 계정을 되살리는가", "SCIM이 멈췄을 때 신규 가입을 막는가"를 사전에 정해야 합니다.

### 2) 동기화 worker는 at-least-once를 전제로 멱등하게 만든다

SCIM 호출은 timeout 뒤 실제로 적용됐을 수 있습니다. 그래서 worker는 "이번 요청을 처음 받았는가"가 아니라 "이 resource를 이 desired state로 이미 수렴시켰는가"를 기준으로 동작해야 합니다. `tenant_id + idp_connection_id + external_subject_id + source_version`을 이벤트 dedupe 키 후보로 두고, 이전 version보다 오래된 이벤트는 무시하거나 기록만 합니다.

사용자 생성과 역할 부여를 하나의 큰 트랜잭션으로 묶기보다, 계정 상태를 먼저 deny-safe하게 전환하고 후속 권한 변경은 재시도 가능한 task로 분리합니다. 재시도는 429와 5xx에는 지수 backoff를 적용하되, 4xx schema 오류는 바로 DLQ로 보내 provider mapping을 수정합니다. 같은 실패를 10번 반복해도 해결되지 않는다면 재시도 횟수가 아니라 운영자 알림이 필요합니다.

### 3) 관측 지표를 보안 SLO와 연결한다

대시보드에는 처리량만 두지 말고 접근 차단 결과를 함께 둡니다.

```text
scim_event_age_seconds{connection}
scim_apply_latency_seconds{operation, risk_tier}
scim_reconciliation_mismatch_total{type}
identity_inactive_with_privileged_role_total
identity_lifecycle_task_failures_total{step}
authorization_stale_allow_total{risk_tier}
```

`scim_apply_latency`가 높아도 계정이 이미 deny 상태라면 영향은 제한될 수 있습니다. 반대로 API 호출은 성공했는데 `inactive_with_privileged_role`이 1이라도 남으면 고위험 문제입니다. 운영자는 전자를 지연으로, 후자를 권한 회수 실패로 분리해 우선순위를 정해야 합니다.

## 트레이드오프/주의점

SCIM을 켠다고 모든 계정 운영이 중앙집중화되지는 않습니다. 고객사별 IdP 품질, 그룹 명명 규칙, HR 데이터 지연, 서비스 계정의 소유권은 제각각입니다. 모든 앱 role을 IdP 그룹에 넣으면 중앙 통제는 쉬워지지만, 프로젝트 단위의 세밀한 위임과 긴급 대응이 경직될 수 있습니다. 반대로 앱 내부 role을 너무 많이 허용하면 SCIM은 계정 생성 도구로만 남고 권한 드리프트를 막지 못합니다.

비활성화 실패 시의 정책도 구분해야 합니다. IdP에서 퇴사 이벤트를 받았는데 후속 revoke가 실패하면 **deny를 유지한 채 복구 작업을 재시도**하는 것이 안전합니다. 반면 IdP와의 연결이 완전히 끊긴 상태에서 일반 사용자를 모두 잠그는 것은 가용성 사고가 될 수 있습니다. 이 경우에는 마지막 성공 동기화 시각, 역할 위험도, 기존 세션 최대 수명을 기준으로 fail-closed 범위를 제한합니다. 고위험 관리 권한은 fail-closed, 낮은 위험의 읽기 권한은 짧은 grace period처럼 구분하는 이유입니다.

또한 SCIM payload와 감사 로그에는 이름, 이메일, 부서 정보가 포함될 수 있습니다. 전체 원문을 장기 보관하기보다 request ID, 외부 식별자 해시, 변경 필드, 결과 코드, 보존 기간을 분리하고, 필요할 때만 제한된 권한으로 원문을 조회하도록 만듭니다.

## 체크리스트 또는 연습

다음 주에 한 개의 SCIM 연결을 골라 아래 항목을 검증해 보세요.

- [ ] 이메일 변경 이벤트가 새 계정 생성이 아니라 기존 계정 속성 갱신으로 처리되는가?
- [ ] 같은 이메일·다른 외부 ID 충돌이 자동 병합되지 않고 review queue로 가는가?
- [ ] `active:false` 뒤 새 로그인, 기존 세션, personal token, cached allow가 각각 언제 끊기는가?
- [ ] privileged role을 가진 inactive account가 0인지 매시간 확인하는가?
- [ ] 그룹 삭제가 SCIM 출처 grant만 회수하고, 만료 전 break-glass 권한은 보존하는가?
- [ ] 429, timeout, 이전 version 이벤트, 잘못된 schema를 포함한 재시도 테스트가 있는가?
- [ ] reconciliation 실패와 "차이 없음"을 다른 상태로 기록하는가?

연습으로는 테스트 테넌트에서 사용자 한 명을 만들고, 이메일 변경 → 그룹 추가 → admin 임시 부여 → IdP 비활성화 → 재입사 순서의 이벤트를 재생해 보세요. 각 단계에서 계정 상태, 역할 출처, 세션, API Key, audit event를 표로 기록하면 현재 시스템이 어디에서 수명주기 계약을 잃는지 빠르게 드러납니다.

SCIM의 성공 기준은 사용자가 자동 생성됐다는 데 있지 않습니다. 조직에서 더 이상 필요하지 않은 사람이, 어떤 우회 경로로도 접근하지 못한다는 것을 정해진 시간 안에 증명하는 데 있습니다.
