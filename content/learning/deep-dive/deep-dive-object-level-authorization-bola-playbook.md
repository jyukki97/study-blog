---
title: "백엔드 커리큘럼 심화: Object-Level Authorization, IDOR/BOLA를 막는 소유권 검증 플레이북"
date: 2026-07-24
draft: false
topic: "Backend Security"
tags: ["Authorization", "IDOR", "BOLA", "Access Control", "Backend Security", "Multi-Tenant"]
categories: ["Backend Deep Dive"]
description: "주문, 파일, 문서, 관리자 도구에서 리소스 ID만으로 접근을 허용하지 않도록 객체 단위 인가, tenant scope, 소유권 검증, 감사 로그, 테스트 기준을 정리합니다."
summary: "Object-Level Authorization은 로그인 여부나 role 확인만으로는 막을 수 없는 IDOR/BOLA 사고를 줄이는 백엔드 기본기입니다. 핵심은 리소스를 조회한 뒤 권한을 확인하는 습관이 아니라, 조회 조건과 정책 판정에 actor, tenant, relation, action을 함께 넣는 것입니다."
module: "backend-security"
study_order: 1260
key_takeaways:
  - "IDOR/BOLA는 인증 실패가 아니라 객체 단위 인가 실패다. 사용자가 로그인되어 있어도 그 리소스를 볼 권한이 있는지는 별도 판단해야 한다."
  - "리소스 조회는 id 단독 조회가 아니라 tenant, owner, membership, action scope를 포함한 조건으로 닫아야 한다."
  - "권한 실패는 403/404 응답, 감사 로그, 테스트 fixture, metric까지 함께 설계해야 운영에서 반복 사고를 줄일 수 있다."
operator_checklist:
  - "외부에서 받은 resource_id로 바로 findById를 호출하는 경로를 Top 20 API부터 제거한다."
  - "권한 검사에는 actor_id, tenant_id, resource_id, action, policy_version, decision_reason을 남긴다."
  - "IDOR 회귀 테스트는 owner, 같은 tenant 다른 사용자, 다른 tenant, 관리자, revoked user를 모두 포함한다."
learning_refs:
  - title: "인가 모델 RBAC·ABAC·ReBAC"
    href: "/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/"
    description: "역할, 속성, 관계 기반 인가 모델을 선택하는 기준입니다."
  - title: "OWASP Top 10 체크리스트"
    href: "/learning/deep-dive/deep-dive-owasp-top10-checklist/"
    description: "Broken Access Control과 IDOR 방어의 보안 기본기를 복습합니다."
  - title: "Tenant Context 전파 가드레일"
    href: "/learning/deep-dive/deep-dive-tenant-context-propagation-guardrails-playbook/"
    description: "요청, 배치, 관리자 작업에서 tenant scope를 잃지 않는 운영 기준입니다."
---

로그인 기능을 붙였다고 해서 접근 제어가 끝나는 것은 아닙니다. 실제 사고는 "인증되지 않은 사용자가 들어왔다"보다 "로그인된 사용자가 자기 것이 아닌 주문, 파일, 문서, 정산 내역을 봤다"에서 자주 발생합니다. URL의 `orderId`를 바꿨더니 다른 사람 주문이 보이거나, 모바일 앱이 숨긴 버튼을 직접 호출했더니 관리자 액션이 실행되는 식입니다. 이 유형을 흔히 IDOR(Insecure Direct Object Reference) 또는 API 문맥에서는 BOLA(Broken Object Level Authorization)라고 부릅니다.

이 문제의 까다로운 점은 코드가 겉보기에는 정상이라는 데 있습니다. 컨트롤러는 인증된 사용자만 받았고, `orders.findById(id)`는 정확한 row를 찾았고, 응답도 200입니다. 빠진 것은 "이 actor가 이 object에 이 action을 할 수 있는가"라는 객체 단위 판단입니다. 이 글은 [인가 모델 RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/), [OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/), [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/), [Tenant Context 전파 가드레일](/learning/deep-dive/deep-dive-tenant-context-propagation-guardrails-playbook/)과 이어지는 실무 기준입니다.

## 이 글에서 얻는 것

- IDOR/BOLA가 왜 단순 role 체크나 로그인 체크로 막히지 않는지 이해합니다.
- `resource_id` 기반 조회를 actor, tenant, relation, action scope와 함께 닫는 설계 기준을 얻습니다.
- 일반 사용자 API, 관리자 도구, 배치, 파일 다운로드 URL에서 소유권 검증을 어떻게 다르게 적용할지 판단할 수 있습니다.
- 객체 단위 인가를 테스트, 감사 로그, metric으로 운영하는 체크리스트를 가져갑니다.

## 핵심 개념/이슈

### 1) 인증은 "누구인가"이고, 객체 단위 인가는 "이것을 해도 되는가"다

인증은 요청자가 누구인지 확인합니다. 세션, JWT, API Key, OAuth token이 여기에 들어갑니다. 하지만 인증이 성공했다는 사실은 특정 리소스 접근 권한을 의미하지 않습니다. `user_id=10`인 사용자가 로그인했다고 해서 `GET /orders/9001`을 볼 수 있는 것은 아닙니다. 주문 9001이 그 사용자의 주문인지, 같은 조직의 주문인지, 지원 담당자가 ticket 범위로 접근하는지 별도로 판단해야 합니다.

실무에서 위험한 패턴은 아래처럼 시작합니다.

```java
@GetMapping("/orders/{orderId}")
public OrderResponse getOrder(@PathVariable Long orderId) {
    Order order = orderRepository.findById(orderId)
        .orElseThrow(NotFoundException::new);
    return OrderResponse.from(order);
}
```

이 코드는 "존재 여부"만 확인합니다. 안전한 기본형은 리소스 조회 조건에 권한 경계를 포함하거나, 조회 직후 동일 트랜잭션 안에서 명시적으로 정책을 판정해야 합니다.

```java
Order order = orderRepository.findVisibleOrder(
    orderId,
    currentUser.id(),
    currentUser.tenantId(),
    Action.ORDER_READ
).orElseThrow(NotFoundException::new);
```

중요한 차이는 `id` 단독 조회가 아니라 `id + actor + tenant + action`으로 접근 가능한 객체만 찾는다는 점입니다. 리소스가 없어서 404인지, 권한이 없어서 403인지는 제품과 보안 정책에 따라 다르게 응답할 수 있지만, 내부 판정은 반드시 분리되어야 합니다.

### 2) role 체크만으로는 수평 권한 침해를 막지 못한다

`ROLE_USER`인지 확인하는 코드는 수직 권한 침해, 즉 일반 사용자가 관리자 기능을 호출하는 문제를 어느 정도 줄입니다. 하지만 같은 role 사이의 수평 권한 침해는 막지 못합니다. 주문 조회, 문서 다운로드, 프로젝트 댓글 수정, 팀 초대 링크, 정산 파일, 고객 지원 티켓은 모두 객체마다 소유자나 관계가 다릅니다.

권한 판단에는 최소 네 가지 축이 들어가야 합니다.

| 축 | 질문 | 예시 |
| --- | --- | --- |
| actor | 누가 요청했는가 | 사용자, 관리자, 파트너 서비스 |
| object | 무엇을 대상으로 하는가 | 주문, 파일, 문서, API key |
| relation | 어떤 관계인가 | owner, member, assignee, support ticket |
| action | 무엇을 하려는가 | read, update, delete, export, approve |

이 축 중 하나라도 빠지면 예외가 쌓입니다. 예를 들어 같은 조직 멤버는 문서를 볼 수 있지만 삭제는 소유자만 가능하고, 지원 담당자는 ticket이 열린 동안만 일부 필드를 볼 수 있으며, 정산 export는 owner라도 추가 승인과 감사 로그가 필요할 수 있습니다. 이때 단순 role보다 [ReBAC 또는 ABAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)가 더 자연스러울 수 있습니다.

### 3) tenant scope는 권한 검사의 일부이지 필터 편의 기능이 아니다

멀티테넌트 SaaS에서는 `tenant_id`가 누락되는 순간 사고 범위가 커집니다. `WHERE id = :id`는 개발 환경에서는 잘 동작합니다. 하지만 운영에서 ID가 전역 sequence라면 다른 tenant의 row도 찾을 수 있습니다. UUID를 쓰더라도 안전해지는 것은 아닙니다. UUID가 추측하기 어렵다는 사실은 권한 검사를 대체하지 못합니다. 로그, 브라우저 히스토리, 공유 URL, support 화면, 외부 연동 payload를 통해 ID는 얼마든지 노출될 수 있습니다.

기본 규칙은 아래처럼 두는 편이 안전합니다.

- tenant가 있는 리소스의 조회 조건에는 `tenant_id`를 항상 포함한다.
- 캐시 key에도 tenant dimension을 포함한다.
- 이벤트 payload와 배치 job manifest에도 tenant scope를 명시한다.
- 관리자 전체 조회는 reason, approval, row count audit 없이는 허용하지 않는다.
- cross-tenant 작업은 일반 API가 아니라 별도 운영 명령으로 분리한다.

이 부분은 [Tenant Context 전파 가드레일](/learning/deep-dive/deep-dive-tenant-context-propagation-guardrails-playbook/)과 직접 이어집니다. HTTP 요청에서는 잘 들어간 tenant가 async worker, scheduler, native query, migration script에서 사라지는 경우가 많습니다. 객체 단위 인가는 웹 컨트롤러만의 책임이 아니라 모든 실행 경로의 계약입니다.

### 4) 403과 404는 UX보다 정보 노출 정책으로 결정한다

권한이 없는 리소스에 대해 403을 줄지 404를 줄지는 자주 논쟁이 됩니다. 정답은 하나가 아닙니다. 공개적으로 존재가 알려져도 되는 리소스라면 403이 디버깅과 사용자 안내에 좋습니다. 반대로 주문, 파일, 개인 문서처럼 존재 여부 자체가 민감한 리소스는 404로 감추는 편이 안전할 수 있습니다.

실무 기준은 이렇게 나눌 수 있습니다.

| 리소스 유형 | 외부 응답 | 내부 로그 |
| --- | --- | --- |
| 공개 문서, 공개 프로젝트 | 403 가능 | denied reason 기록 |
| 주문, 결제, 개인정보 파일 | 404 선호 | actual reason은 audit/metric에 기록 |
| 관리자 액션 | 403 선호 | actor, target, policy version 기록 |
| 삭제된 리소스 | 404 또는 410 | 삭제 시각과 actor는 내부 추적 |

핵심은 외부 응답을 404로 통일하더라도 내부에서는 `not_found`, `forbidden`, `tenant_mismatch`, `revoked_membership`을 구분해야 한다는 점입니다. 운영자가 모두 404로만 보면 실제 공격 시도와 정상 오입력을 분리할 수 없습니다.

### 5) 파일·URL·캐시는 IDOR의 우회 경로가 되기 쉽다

객체 단위 인가는 DB 조회 API에만 있는 문제가 아닙니다. 파일 다운로드, presigned URL, CDN 캐시, 이미지 변환 서버, 검색 인덱스가 더 자주 빈틈이 됩니다. 애플리케이션 API에서는 권한을 확인했지만, 생성된 파일 URL이 너무 오래 살아 있거나 CDN key에 tenant가 빠지면 우회 접근이 가능합니다.

파일 계층의 기본 기준:

- presigned URL TTL은 일반 다운로드 5~15분, 민감 파일 1~5분부터 시작한다.
- URL 발급 시 actor, tenant, file_id, purpose, expires_at을 감사 로그에 남긴다.
- 파일 key에는 tenant 또는 owner 경계를 포함하되, 추측 가능한 경로만 믿지 않는다.
- CDN cache key에 authorization 영향 필드를 반영하거나 민감 파일은 private cache로 둔다.
- 권한 회수 후 기존 URL을 즉시 무효화해야 하는 도메인은 token version 또는 object version을 둔다.

자세한 다운로드 URL 기준은 [Presigned URL 접근 제어](/learning/deep-dive/deep-dive-presigned-url-access-control-playbook/)와 같이 보면 좋습니다. "API에서 한 번 검사했으니 파일 서버는 안전하다"는 가정은 오래 버티지 못합니다.

## 실무 적용

### 1) Top 20 API부터 resource access pattern을 분류한다

처음부터 모든 코드를 고치려 하면 실패합니다. 트래픽 상위, 민감도 상위, 외부 노출 상위 API부터 아래 표를 만듭니다.

```yaml
endpoint: GET /orders/{orderId}
resource: order
actions: [read]
required_scope:
  tenant_id: required
  relation: owner_or_org_member
  support_exception: ticket_open_only
not_found_policy: hide_forbidden_as_404
audit:
  denied: true
  high_risk_success: false
tests:
  - owner_allowed
  - same_tenant_other_user_denied
  - other_tenant_denied
  - support_ticket_allowed
  - revoked_user_denied
```

이 표에서 빈칸이 많을수록 위험합니다. 특히 `support_exception`, `admin_override`, `file_download`, `export`가 있는 API는 일반 사용자 조회보다 더 강한 증거가 필요합니다.

### 2) Repository 계층에 안전한 조회 함수를 기본값으로 둔다

가장 실용적인 변화는 `findById`를 외부 입력 경로에서 직접 쓰지 않는 것입니다. 아예 Repository 또는 Query Service에 접근 가능한 객체만 조회하는 함수를 둡니다.

- `findOrderForRead(orderId, actorContext)`
- `findDocumentForUpdate(documentId, actorContext)`
- `findFileForDownload(fileId, actorContext, purpose)`
- `findAdminTargetWithApproval(targetId, actorContext, approvalId)`

이름이 길어져도 좋습니다. 보안 경계가 함수 이름에 드러나야 리뷰어가 놓치지 않습니다. 반대로 `getOrder(orderId)` 같은 이름은 내부 조회인지 사용자 접근 조회인지 구분하기 어렵습니다.

우선순위는 **외부 입력 ID > 파일/다운로드 > 관리자 도구 > 배치 재처리 > 내부 join** 순서로 잡습니다. 외부에서 받은 ID가 가장 위험합니다. 내부에서 이미 권한 검증된 aggregate를 따라가는 조회는 상대적으로 낮은 위험입니다.

### 3) 권한 결정을 감사 가능한 이벤트로 남긴다

모든 조회 성공을 장기 보관할 필요는 없습니다. 하지만 고위험 접근과 거부 이벤트는 남겨야 합니다. 최소 필드는 아래 정도입니다.

```text
occurred_at, actor_id, actor_type, tenant_id, resource_type,
resource_id_hash, action, decision, reason_code,
policy_version, request_id, source_ip_hash
```

민감한 리소스 ID를 원문으로 남길지 hash로 남길지는 도메인에 따라 결정합니다. 감사 로그가 또 다른 개인정보 저장소가 되면 안 됩니다. 권한 변경, export, 관리자 impersonation처럼 고위험 액션은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/) 기준으로 별도 보존하는 편이 안전합니다.

운영 지표는 아래부터 시작합니다.

- `authz_object_denied_total` by endpoint/reason
- `tenant_mismatch_total`
- `forbidden_as_not_found_total`
- `admin_override_success_total`
- `policy_decision_latency_p95`

경보 기준 예시는 `tenant_mismatch_total`이 10분 동안 평소 대비 3배 이상 증가하거나, 특정 endpoint의 deny rate가 20%p 이상 급변할 때입니다. 공격일 수도 있고, 배포가 잘못되어 tenant context가 빠졌을 수도 있습니다.

### 4) IDOR 회귀 테스트를 fixture로 고정한다

객체 단위 인가는 테스트 없이는 계속 깨집니다. 기능을 추가하면서 "내 데이터 조회"만 테스트하면, 남의 데이터 조회 실패를 보장하지 못합니다. 최소 fixture는 아래처럼 둡니다.

| 사용자 | tenant | 관계 | 기대 |
| --- | --- | --- | --- |
| owner | A | resource owner | 허용 |
| same tenant member | A | member, no relation | 정책에 따라 허용/거부 |
| other tenant user | B | none | 거부 |
| support agent | internal | ticket open | 제한 허용 |
| revoked user | A | membership revoked | 거부 |

테스트는 status code만 보지 말고 응답 body에 다른 리소스의 식별자나 일부 필드가 섞이지 않는지도 봐야 합니다. 목록 API는 더 중요합니다. `GET /orders`가 200이어도 결과 중 다른 tenant row가 1개라도 섞이면 치명적입니다.

### 5) 배치와 관리자 도구에도 같은 정책 함수를 통과시킨다

많은 사고가 "사용자 API는 안전한데 운영 도구가 우회했다"에서 납니다. 관리자 화면, CS 도구, correction job, export job, migration script는 편의상 넓은 권한을 갖기 쉽습니다. 하지만 이 경로가 실제 데이터 변경과 조회를 더 많이 합니다.

운영 기준:

- 관리자 전체 조회는 기본 차단하고 검색 조건, reason, ticket, row count를 요구한다.
- correction/export job은 target scope를 manifest에 명시하고 실행 전 dry-run count를 확인한다.
- batch worker는 system actor라도 tenant scope와 action을 갖는다.
- break-glass 접근은 만료 시간과 사후 리뷰를 둔다.
- 정책 함수 우회 경로는 주 1회 정적 검색 또는 테스트로 점검한다.

이 기준은 [Correction Job 플레이북](/learning/deep-dive/deep-dive-correction-job-audit-guardrails-playbook/)과 연결됩니다. 수동 보정이나 export는 빠르게 처리할수록 좋아 보이지만, 권한 경계를 우회하면 나중에 설명할 방법이 없습니다.

## 트레이드오프/주의점

첫째, 권한 검사를 강하게 넣으면 초기에는 404/403이 늘 수 있습니다. 이것은 나쁜 신호만은 아닙니다. 그동안 통과되던 잘못된 호출이 보이기 시작한 것일 수 있습니다. 다만 배포 전 shadow mode나 evaluate mode로 deny 후보를 관측하고, 정상 클라이언트가 깨지는지 확인하는 단계가 있으면 안전합니다.

둘째, 모든 권한 결정을 중앙 PDP로 보내면 지연시간과 가용성 문제가 생길 수 있습니다. 핵심 API p95가 150ms라면 권한 판정은 보통 p95 5~15ms 안에 들어와야 합니다. 외부 PDP가 p95 20ms를 넘기면 로컬 캐시, 사전 계산 relation, 권한 snapshot을 검토해야 합니다. 단, 캐시 TTL이 길수록 권한 회수 지연이 커지므로 권한 변경·계정 정지·파일 공개 같은 고위험 액션은 짧게 가져갑니다.

셋째, 404로 권한 실패를 숨기면 정보 노출은 줄지만 디버깅이 어려워집니다. 그래서 외부 응답과 내부 reason code를 분리해야 합니다. 사용자에게는 404를 주더라도 내부 metric에는 `tenant_mismatch`인지 `membership_revoked`인지 남겨야 합니다.

넷째, UUID는 권한 검사가 아닙니다. 추측 가능성을 낮추는 보조 장치일 뿐입니다. UUID가 로그, URL, 외부 연동 payload, 고객 지원 화면에 노출되는 순간 공격자는 값을 알 수 있습니다. "알 수 없으니 안전하다"가 아니라 "알아도 접근할 수 없다"가 목표입니다.

다섯째, 관리자와 지원 도구의 예외를 방치하면 일반 API 보안이 무력화됩니다. 운영 대응을 위해 예외는 필요하지만, reason, ticket, approval, row count, audit 없이 넓은 조회를 허용하면 결국 가장 위험한 API가 내부 도구가 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 외부 입력 resource ID를 `findById`로 직접 조회하는 API를 식별했다.
- [ ] 리소스별로 actor, tenant, relation, action 기준을 표로 정리했다.
- [ ] tenant가 있는 리소스의 DB 조회, 캐시 key, 이벤트 payload에 tenant scope가 포함된다.
- [ ] 403/404 정책과 내부 reason code가 분리되어 있다.
- [ ] IDOR 테스트 fixture에 owner, 같은 tenant 다른 사용자, 다른 tenant, support agent, revoked user가 있다.
- [ ] 파일 다운로드 URL, CDN cache, export job에도 객체 단위 인가가 적용된다.
- [ ] 고위험 성공과 권한 거부 이벤트가 감사 로그 또는 metric으로 남는다.

### 연습 과제

1. 현재 서비스의 `GET /{resource}/{id}` 형태 API 10개를 골라 `id 단독 조회`가 있는지 찾아보세요. 하나라도 있으면 actor/tenant/action을 포함한 조회 함수 이름으로 바꿔봅니다.
2. 주문, 파일, 문서 중 하나를 골라 IDOR 회귀 테스트 fixture 5개를 작성하세요. 정상 사용자 테스트만 있던 API라면 다른 tenant 사용자의 실패 케이스부터 추가합니다.
3. 관리자 전체 조회 기능 하나에 대해 reason, ticket, row count, approval, audit 필드를 붙인 실행 로그 예시를 만들어보세요. 5분 안에 어떤 사람이 왜 조회했는지 설명할 수 있어야 합니다.

## 관련 글

- [인가 모델 RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/)
- [Tenant Context 전파 가드레일](/learning/deep-dive/deep-dive-tenant-context-propagation-guardrails-playbook/)
- [Presigned URL 접근 제어](/learning/deep-dive/deep-dive-presigned-url-access-control-playbook/)
- [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
