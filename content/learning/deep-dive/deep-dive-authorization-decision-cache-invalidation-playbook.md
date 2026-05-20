---
title: "백엔드 커리큘럼 심화: Authorization Decision Cache와 권한 무효화 플레이북"
date: 2026-05-11
draft: false
topic: "Authorization"
tags: ["Authorization", "Decision Cache", "RBAC", "ABAC", "Policy Engine", "Security", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "권한 판정 결과를 캐시할 때 생기는 stale permission, 정책 버전, tenant 경계, fail-closed 기준을 실무 숫자와 운영 지표 중심으로 정리합니다."
module: "backend-security-phase"
study_order: 1210
---

인가(authorization)는 보통 로그인 이후의 문제로 다뤄집니다. 사용자가 누구인지 확인했으니, 이제 이 사용자가 어떤 리소스에 어떤 액션을 할 수 있는지만 판단하면 된다고 생각하기 쉽습니다. 하지만 트래픽이 커지고 권한 모델이 복잡해지면 질문이 바뀝니다. "매 요청마다 정책 엔진을 호출할 것인가", "권한이 바뀐 뒤 몇 초 안에 반영되어야 하는가", "캐시된 허용 판단이 남아 있으면 보안 사고인가 성능 최적화인가"를 정해야 합니다.

권한 판정 캐시는 단순 성능 최적화가 아닙니다. 잘 설계하면 정책 엔진 부하를 줄이고 p95 지연을 안정화하지만, 잘못 설계하면 이미 권한이 회수된 사용자가 몇 분 동안 계속 접근하는 문제가 생깁니다. 특히 멀티테넌트 서비스, 관리자 권한, 문서 공유, 결제/정산 API처럼 접근 경계가 곧 제품 신뢰인 도메인에서는 캐시 TTL 하나가 보안 정책이 됩니다. 이 글은 [인가 모델 RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/), [캐시 일관성/무효화](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/), [JWT 인증](/learning/deep-dive/deep-dive-jwt-auth/), [멀티테넌트 격리](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)를 잇는 관점으로 권한 판정 캐시의 운영 기준을 정리합니다.

## 이 글에서 얻는 것

- 권한 판정 캐시가 안전한 경우와 위험한 경우를 구분할 수 있습니다.
- cache key에 subject, action, resource, tenant, policy version을 어떻게 반영해야 하는지 기준을 잡을 수 있습니다.
- 권한 회수, 역할 변경, 정책 배포 후 stale decision을 몇 초 안에 줄일지 숫자로 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 권한 판정은 `true/false`가 아니라 계약이다

권한 판정 결과를 단순히 `allowed=true`로만 저장하면 나중에 왜 허용됐는지 설명하기 어렵습니다. 실무에서 필요한 최소 단위는 `subject`, `action`, `resource`, `tenant`, `context`, `decision`, `policy_version`, `reason`입니다. 같은 사용자라도 `read:invoice`와 `refund:payment`는 전혀 다른 위험도를 갖고, 같은 문서라도 개인 문서와 조직 문서는 다른 정책을 탑니다.

그래서 decision cache의 값은 boolean 하나보다 작게라도 설명 가능한 레코드여야 합니다.

```text
subject_id: user_123
action: document.update
resource_type: document
resource_id: doc_456
tenant_id: tenant_a
decision: allow
policy_version: authz-policy-2026-05-11.1
subject_version: 42
resource_acl_version: 17
expires_at: 2026-05-11T01:16:30Z
reason: role_editor_and_acl_member
```

이 구조가 있어야 운영 중에 "왜 이 사용자가 접근했나"를 추적할 수 있습니다. [Execution Receipt 운영](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)처럼 외부 효과가 큰 액션에는 판단 근거가 같이 남아야 사고 분석이 됩니다.

### 2) 캐시 TTL은 성능 값이 아니라 보안 값이다

권한 판정 캐시에서 가장 위험한 오해는 "TTL을 길게 두면 빠르다"입니다. 맞지만 절반만 맞습니다. TTL이 길수록 정책 엔진 호출은 줄어들지만, 권한 회수 후 stale allow가 남는 시간도 길어집니다. 따라서 TTL은 성능팀이 임의로 정할 값이 아니라 도메인 위험도와 같이 정해야 합니다.

기본 출발점은 아래처럼 나눌 수 있습니다.

| 권한 경로 | 예시 | 권장 캐시 정책 |
| --- | --- | --- |
| 고위험 쓰기 | 결제 취소, 권한 변경, 비밀 조회 | 캐시 금지 또는 **10~30초 이하** |
| 일반 쓰기 | 문서 수정, 댓글 삭제, 설정 변경 | **30초~2분**, version 기반 무효화 병행 |
| 일반 읽기 | 목록 조회, 공개 범위 확인 | **2~5분**, resource ACL version 포함 |
| 공개/반공개 읽기 | 공개 프로필, 공개 게시글 | 더 긴 TTL 가능, 단 정책 변경 이벤트 반영 |

권한 회수가 필요한 서비스에서 10분 TTL을 두면, 사실상 "권한 회수는 최대 10분 늦게 반영된다"는 정책을 선언한 것과 같습니다. 이 숫자를 제품·보안·운영이 같이 알고 있어야 합니다.

### 3) cache key에는 권한을 바꾸는 모든 버전이 들어가야 한다

안전한 decision cache는 key 설계가 절반입니다. 흔한 실수는 `user_id + resource_id + action`만 key로 쓰는 것입니다. 이 경우 tenant 이동, role 변경, 그룹 멤버십 변경, resource ACL 변경, 정책 배포가 key에 반영되지 않아 stale allow가 남습니다.

권장 key 구성은 다음과 같습니다.

```text
authz:{tenant_id}:{subject_id}:{subject_version}:{action}:{resource_type}:{resource_id}:{resource_acl_version}:{policy_version}
```

여기서 `subject_version`은 사용자 역할, 조직 멤버십, 계정 상태가 바뀔 때 증가합니다. `resource_acl_version`은 문서 공유 목록, 프로젝트 멤버, 소유자 변경처럼 리소스 접근 규칙이 바뀔 때 증가합니다. `policy_version`은 정책 코드나 규칙 테이블이 배포될 때 증가합니다. 이렇게 하면 모든 캐시 항목을 직접 삭제하지 못해도 새 요청은 새 key를 보게 됩니다.

단, key에 이메일, 문서 제목, 고객명 같은 PII를 직접 넣지 않습니다. 로그와 메트릭으로 흘러갈 수 있기 때문입니다. 식별자는 내부 ID나 해시를 쓰고, 디버깅은 별도 audit log에서 처리하는 편이 안전합니다.

### 4) deny 캐시와 allow 캐시는 다르게 다뤄야 한다

권한 캐시는 보통 allow만 생각하지만 deny도 캐시됩니다. deny 캐시는 정책 엔진 부하를 줄이는 데 유용하지만, 사용자가 방금 권한을 부여받았는데 계속 거절되는 UX 문제를 만들 수 있습니다. 반대로 allow 캐시는 stale 상태에서 보안 문제가 됩니다.

운영 기준은 보수적으로 잡는 편이 좋습니다.

- allow cache: 짧게, version 기반, 고위험 경로는 비활성화
- deny cache: 더 짧게, 보통 **5~30초**부터 시작
- 정책 엔진 장애 시: 고위험 쓰기는 fail-closed, 저위험 읽기는 stale allow 허용 여부를 명시
- 권한 부여 직후 UX가 중요한 협업 도메인: deny cache를 거의 쓰지 않거나 event invalidation 우선

특히 fail-open/fail-closed는 미리 문서화해야 합니다. 장애가 난 뒤 "일단 열어둘까"를 판단하면 거의 항상 위험합니다. [Graceful Degradation](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)처럼 어떤 기능을 읽기 전용으로 낮출지, 어떤 요청은 거절할지 순서를 정해야 합니다.

## 실무 적용

### 1) PEP와 PDP 사이에 작은 캐시 계층을 둔다

인가 구조를 단순화하면 요청을 막는 지점인 PEP(Policy Enforcement Point)와 판단을 내리는 PDP(Policy Decision Point)가 있습니다. 애플리케이션 컨트롤러, API Gateway, GraphQL resolver가 PEP가 될 수 있고, 코드 내부 정책 함수나 외부 정책 엔진이 PDP가 될 수 있습니다.

처음부터 거대한 중앙 정책 엔진을 만들 필요는 없습니다. 다만 아래 기준 중 2개 이상이면 decision cache를 명시적으로 설계하는 편이 낫습니다.

- 요청당 권한 체크가 **3회 이상** 반복된다.
- PDP 호출 p95가 **20ms**를 넘는다.
- 문서/프로젝트/테넌트 단위 ACL이 자주 바뀐다.
- 관리자 권한 회수가 **1분 이내** 반영되어야 한다.
- 권한 관련 장애가 전체 API p95에 직접 영향을 준다.

가벼운 시작점은 애플리케이션 내부 local cache + Redis shared cache 조합입니다. local cache는 1~10초 수준으로 아주 짧게 두고, Redis는 30초~5분 범위에서 위험도별 TTL을 둡니다. 단, 고위험 쓰기는 shared cache를 건너뛰고 PDP 또는 DB를 직접 확인하는 경로를 남겨야 합니다.

### 2) 권한 변경 이벤트를 먼저 정의한다

무효화는 "캐시 삭제"가 아니라 권한 변경 이벤트 모델입니다. 최소 이벤트는 다음 네 가지입니다.

- `subject_permissions_changed`: 사용자 role, 그룹, 계정 상태 변경
- `resource_acl_changed`: 문서/프로젝트/테넌트 리소스의 공유 범위 변경
- `policy_version_published`: 정책 코드 또는 정책 테이블 배포
- `tenant_boundary_changed`: 조직 이동, 테넌트 병합/분리, 계약 상태 변경

각 이벤트에는 `tenant_id`, 영향을 받는 subject/resource 범위, 새 version, 발생 시각, operator를 넣습니다. 이벤트가 누락되더라도 version key가 stale을 줄이고, 이벤트가 도착하면 적극적으로 삭제합니다. 즉 **version 기반 회피 + event 기반 삭제**를 같이 쓰는 구조가 안전합니다.

운영 목표는 아래처럼 시작할 수 있습니다.

| 지표 | 시작 목표 |
| --- | --- |
| 권한 변경 이벤트 발행 지연 | p95 **1초 이하** |
| 캐시 무효화 완료 지연 | p95 **5초 이하**, p99 **30초 이하** |
| stale allow 탐지 | 월 **0건** 목표, 1건도 Sev 분류 |
| PDP 장애 시 고위험 요청 fail-open | **0%** |
| decision cache hit ratio | 읽기 경로 **70~90%**, 쓰기 경로는 낮아도 정상 |

cache hit ratio만 높이는 것은 좋은 목표가 아닙니다. 권한 시스템에서는 hit ratio보다 stale decision과 fail-open 비율이 더 중요합니다.

### 3) 감사 로그와 관측 지표를 분리한다

권한 판정은 디버깅이 어렵습니다. 사용자는 "왜 안 되나요"라고 묻고, 운영자는 "왜 됐나요"를 추적해야 합니다. 이 둘은 요구가 다릅니다. 메트릭에는 PII 없이 카운터와 지연을 남기고, 감사 로그에는 필요한 범위에서 subject/resource/reason/policy version을 남깁니다.

필수 지표는 다음 정도면 충분합니다.

- `authz_decision_total{decision, action, resource_type}`
- `authz_decision_cache_hit_ratio{action, risk_tier}`
- `authz_pdp_latency_ms{policy_version}`
- `authz_invalidation_lag_ms{event_type}`
- `authz_stale_decision_detected_total{decision}`
- `authz_fail_closed_total`, `authz_fail_open_total`

알람은 [관측 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/) 기준처럼 사용자 영향과 운영 조치가 연결되어야 합니다. 예를 들어 `authz_invalidation_lag_ms p99 > 30초`가 5분 지속되면 고위험 쓰기 캐시를 자동 우회하고 PDP 직접 확인으로 전환하는 식입니다.

## 트레이드오프/주의점

첫째, 캐시를 없애면 안전해 보이지만 정책 엔진이 병목이 될 수 있습니다. PDP가 느려지면 모든 요청이 느려지고, 장애 시 전체 서비스가 같이 멈춥니다. 그래서 저위험 읽기에는 짧은 캐시가 현실적입니다. 중요한 것은 캐시 여부가 아니라 위험도별 TTL과 무효화 지연을 알고 있는가입니다.

둘째, 모든 권한 변경을 즉시 전파하려 하면 시스템이 과하게 복잡해집니다. 조직 규모가 작고 권한 변경이 하루 몇 건 수준이라면 version 기반 짧은 TTL만으로 충분할 수 있습니다. 반대로 B2B SaaS에서 고객 관리자가 사용자를 퇴사 처리하는 흐름이라면 5분 TTL도 길 수 있습니다.

셋째, 외부 정책 엔진을 도입하면 정책 재사용성과 감사성은 좋아지지만, 네트워크 의존성과 장애 모드가 늘어납니다. p95 20ms 안에 안정적으로 답하지 못하면 local precompute, partial evaluation, edge cache를 검토해야 합니다.

넷째, 멀티테넌트 서비스에서는 tenant boundary를 key와 로그의 첫 번째 축으로 둬야 합니다. tenant가 빠진 캐시는 단순 버그가 아니라 데이터 유출 사고로 이어집니다. 이 지점은 [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)과 반드시 함께 봐야 합니다.

의사결정 우선순위는 **권한 회수 정확성 > 테넌트 경계 > 감사 가능성 > 지연 시간 > 캐시 적중률**입니다. 캐시가 빠르다는 이유로 앞의 세 가지를 희생하면, 성능 최적화가 아니라 보안 부채를 만든 것입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 권한 판정 결과에 subject, action, resource, tenant, policy version, reason이 남는다.
- [ ] allow cache와 deny cache의 TTL을 다르게 둔다.
- [ ] cache key에 subject version, resource ACL version, policy version이 포함된다.
- [ ] 고위험 쓰기 API는 캐시 금지 또는 10~30초 이하 TTL로 제한된다.
- [ ] 권한 변경 이벤트와 무효화 지연 p95/p99를 측정한다.
- [ ] PDP 장애 시 fail-open 가능한 경로와 fail-closed 경로가 문서화되어 있다.
- [ ] tenant_id 없는 decision cache key가 생성되지 않도록 테스트가 있다.
- [ ] stale allow 탐지 시 Sev 분류와 즉시 완화 절차가 있다.

### 연습

1. 현재 서비스의 권한 체크 5개를 골라 `고위험 쓰기 / 일반 쓰기 / 일반 읽기 / 공개 읽기`로 분류하고, 각 TTL 상한을 직접 정해 보세요.  
2. 사용자 역할이 바뀌었을 때 어떤 캐시가 얼마나 오래 남는지 시퀀스 다이어그램으로 그려 보세요. "권한 회수 후 30초 안에 막히는가"가 첫 질문입니다.  
3. `tenant_id`를 key에서 의도적으로 뺀 테스트를 작성하고, 다른 테넌트의 decision이 재사용되지 않도록 실패하는지 확인해 보세요.

## 관련 글

- [인가 모델 실전 설계: RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [캐시 일관성과 무효화 전략](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)
- [JWT 인증과 토큰 기반 보안](/learning/deep-dive/deep-dive-jwt-auth/)
- [멀티테넌트 격리 전략 플레이북](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)
- [관측 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)
