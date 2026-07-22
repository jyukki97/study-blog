---
title: "백엔드 커리큘럼 심화: Authorization Policy Shadow Rollout, 인가 정책을 안전하게 바꾸는 법"
date: 2026-07-22
draft: false
topic: "Backend Security"
tags: ["Authorization", "Policy Engine", "Shadow Rollout", "RBAC", "ABAC", "Audit Log", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "RBAC, ABAC, 정책 엔진을 바꿀 때 바로 차단하지 않고 shadow decision, diff taxonomy, canary enforcement, 감사 로그로 안전하게 rollout하는 기준을 정리합니다."
module: "backend-security"
study_order: 1260
key_takeaways:
  - "인가 정책 변경은 기능 배포가 아니라 사용자 접근권을 바꾸는 운영 변경이다."
  - "새 정책은 먼저 shadow mode에서 기존 판정과 비교하고, allow-to-deny와 deny-to-allow diff를 별도 위험으로 분류해야 한다."
  - "enforce 전에는 decision log, owner, rollback flag, 캐시 무효화, support 대응 기준이 준비되어야 한다."
operator_checklist:
  - "정책 변경 PR마다 affected resource, subject group, risk class, expected diff rate를 기록한다."
  - "shadow 기간에는 기존 정책 결과와 새 정책 결과를 함께 남기고 allow-to-deny diff를 0.1% 이하로 낮춘 뒤 canary를 시작한다."
  - "고위험 권한 상승, 결제, 개인정보 export, 관리자 액션은 canary 중에도 fail-closed와 2인 승인 기준을 유지한다."
learning_refs:
  - title: "인가 모델 RBAC·ABAC·ReBAC"
    href: "/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/"
    description: "권한 모델과 PDP/PEP 구조를 먼저 잡기 위한 기본 글입니다."
  - title: "권한 판정 캐시 무효화"
    href: "/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/"
    description: "정책 변경 후 stale allow를 줄이는 캐시 TTL, invalidation, fail-open 기준입니다."
  - title: "Permission Drift와 Access Review"
    href: "/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/"
    description: "시간이 지나며 생기는 오래된 권한과 자동 회수 운영 기준입니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "권한 변경과 정책 판정 로그를 나중에 설명 가능한 증거로 남기는 방법입니다."
decision_guide:
  cases:
    - badge: "shadow 필수"
      title: "기존 권한 정책을 새 정책 엔진이나 ABAC 규칙으로 교체"
      fit: "실제 사용자 접근 결과가 달라질 수 있고 영향 클라이언트가 여러 개인 경우"
      watchouts: "테스트 fixture만 통과해도 운영 데이터의 예외 권한, 휴면 사용자, 관리자 override가 깨질 수 있습니다."
      next_step: "7~14일 shadow decision log를 쌓고 diff taxonomy를 먼저 분석합니다."
    - badge: "canary 가능"
      title: "저위험 read API의 권한 조건 보강"
      fit: "사용자 조회, 목록 필터링처럼 거절되어도 금전·권한 상승 피해가 작은 경로"
      watchouts: "read API라도 개인정보, 테넌트 교차 조회, 관리자 검색은 저위험이 아닙니다."
      next_step: "1%, 5%, 25%, 100% enforcement 단계와 즉시 rollback flag를 둡니다."
    - badge: "수동 승인"
      title: "관리자 권한, 결제, 개인정보 export, 계정 정지"
      fit: "잘못 허용하면 보안 사고, 잘못 거절하면 업무 중단이 되는 고위험 액션"
      watchouts: "자동 rollout보다 감사 로그, 2인 승인, break-glass 회수 절차가 먼저입니다."
      next_step: "shadow 결과를 security owner가 리뷰하고 allowlist 기반으로 좁게 적용합니다."
faqs:
  - question: "정책 테스트가 충분하면 shadow rollout이 필요 없나요?"
    answer: "아닙니다. 테스트는 예상한 케이스를 검증하고, shadow rollout은 운영 데이터의 예외와 실제 호출 패턴을 보여줍니다. 권한 변경은 둘 다 필요합니다."
  - question: "deny-to-allow diff도 위험한가요?"
    answer: "위험합니다. 사용자가 막히던 기능을 쓰게 되는 것은 좋은 변화일 수 있지만, 의도하지 않은 권한 확대일 수도 있습니다. allow-to-deny와 별도로 보안 리뷰해야 합니다."
---

인가 정책은 조용히 바뀌는 것처럼 보여도 실제로는 제품의 경계를 바꾸는 일입니다. `admin` 역할 하나를 세분화하거나, RBAC에서 ABAC로 일부 조건을 옮기거나, 새 정책 엔진을 붙이는 변경은 코드 diff보다 운영 영향이 큽니다. 잘못 거절하면 정상 사용자가 업무를 못 하고, 잘못 허용하면 고객 데이터와 관리자 기능이 열립니다. 그래서 인가 변경은 일반 기능 flag보다 더 엄격한 rollout 절차가 필요합니다.

이 글은 [인가 모델 RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/), [권한 판정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/), [Permission Drift와 Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와 이어집니다. 핵심은 새 정책을 바로 강제하지 말고, 기존 판정과 새 판정을 나란히 기록한 뒤 차이를 해석하고 단계적으로 강제하는 것입니다.

## 이 글에서 얻는 것

- 인가 정책 rollout을 feature release가 아니라 access control migration으로 보는 관점을 얻습니다.
- shadow decision, diff taxonomy, canary enforcement, rollback flag를 어떤 순서로 붙일지 정리합니다.
- allow-to-deny, deny-to-allow, error-to-allow, cache-stale diff를 서로 다른 위험으로 분류할 수 있습니다.
- 정책 변경 PR과 운영 대시보드에 필요한 숫자 기준을 바로 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) Shadow mode는 새 정책을 실행하되 결과를 강제하지 않는 단계다

shadow mode에서는 기존 정책이 실제 응답을 결정합니다. 새 정책은 같은 입력을 받아 별도로 판정하고, 결과만 로그와 지표에 남깁니다. 예를 들어 기존 코드가 `role == ADMIN`이면 허용하고, 새 정책은 `role == ADMIN && department == resource.owner_department`를 요구한다고 합시다. 이때 새 정책을 바로 켜면 일부 관리자가 갑자기 막힙니다. shadow mode에서는 실제 사용자는 기존처럼 통과하지만, 새 정책이라면 막혔을 요청을 미리 볼 수 있습니다.

권장 로그 단위는 요청 로그보다 좁은 `authorization decision`입니다. 하나의 API 요청 안에서도 여러 자원에 대해 여러 번 권한 판정을 할 수 있기 때문입니다.

```yaml
authz_decision:
  request_id: "req_01J..."
  subject_id_hash: "sub_9f2..."
  tenant_id: "tenant_42"
  action: "invoice.export"
  resource_type: "invoice"
  resource_id_hash: "res_8ac..."
  current_decision: "allow"
  shadow_decision: "deny"
  policy_version_current: "rbac-2026-06"
  policy_version_shadow: "abac-2026-07-22"
  diff_type: "allow_to_deny"
  risk_class: "high"
  reason_code: "department_mismatch"
```

여기서 원문 사용자 ID나 resource ID를 그대로 metric label로 넣으면 안 됩니다. 자세한 디버깅은 로그 검색으로 하고, metric은 `action`, `resource_type`, `diff_type`, `policy_version`, `risk_class` 정도로 제한합니다.

### 2) Diff는 단순 mismatch가 아니라 위험 분류다

기존 정책과 새 정책의 결과가 다르다고 모두 같은 의미는 아닙니다. 적어도 아래처럼 분류해야 합니다.

| diff type | 의미 | 기본 위험 |
| --- | --- | --- |
| `allow_to_deny` | 기존에는 허용, 새 정책은 거절 | 정상 사용자 차단 가능성 |
| `deny_to_allow` | 기존에는 거절, 새 정책은 허용 | 권한 확대 가능성 |
| `allow_to_error` | 기존 허용, 새 정책 평가 실패 | 정책 엔진 안정성 문제 |
| `deny_to_error` | 기존 거절, 새 정책 평가 실패 | 관측 필요, 보통 낮음 |
| `error_to_allow` | 기존 오류, 새 정책 허용 | 원인 분석 전 자동 승격 금지 |
| `same_decision_reason_changed` | 결과는 같지만 이유가 달라짐 | 나중에 회귀 신호 가능 |

실무 기준은 보수적으로 둡니다. 고위험 write action에서 `deny_to_allow`가 1건이라도 나오면 security owner 리뷰 전 enforcement로 넘기지 않습니다. `allow_to_deny`는 정상 마이그레이션일 수 있지만, 고객 지원 영향이 큽니다. 외부 파트너 API나 관리자 업무 경로에서는 전체 호출의 **0.1% 초과**만 되어도 canary를 보류하는 편이 안전합니다.

### 3) 정책 rollout은 경로, action, subject group별로 나눠야 한다

인가 정책을 전역 flag 하나로 켜는 방식은 위험합니다. 사용자군과 자원군에 따라 실패 비용이 다르기 때문입니다.

- 저위험 read: 공개 프로필 조회, 일반 목록 조회
- 중위험 write: 사용자 설정 변경, 내부 메모 수정
- 고위험 write: 결제 취소, 권한 상승, 개인정보 export, 계정 정지
- 시스템 작업: 배치, webhook, support tool, migration script

처음에는 read path의 일부 action에서만 canary를 시작합니다. 이후 subject group을 넓힙니다. 예를 들어 내부 직원 1%, 베타 테넌트 5%, 전체 free plan 25%, 전체 100%처럼 올릴 수 있습니다. 단, 고위험 action은 비율 rollout보다 allowlist와 수동 승인에 가깝게 운영합니다.

### 4) 캐시는 rollout의 숨어 있는 적이다

정책 엔진을 바꿔도 권한 판정 캐시가 오래 살아 있으면 사용자는 계속 이전 결정으로 통과할 수 있습니다. 반대로 캐시를 한 번에 비우면 PDP 부하가 튀고, latency가 올라가며, 장애 중 fail-open 여부가 흔들릴 수 있습니다.

초기 기준은 아래처럼 둡니다.

- local decision cache TTL: 저위험 read **1~10초**, 고위험 write **0초 또는 직접 확인**
- shared decision cache TTL: 저위험 read **30초~5분**, 권한 변경 직후 invalidation 필수
- `authz_invalidation_lag_ms` p99: 고위험 권한 **30초 이하**
- shadow rollout 중 `policy_eval_error_rate`: **0.05% 이하**
- PDP p95 latency: 일반 API budget의 **10% 이하**, 예: API p95 300ms면 PDP p95 30ms 이하

이 기준은 [권한 판정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)에서 더 자세히 다룬 내용과 같습니다. 정책 rollout은 엔진만 바꾸는 일이 아니라 캐시 생명주기까지 바꾸는 일입니다.

### 5) Decision log는 감사 로그와 다르게 설계한다

모든 권한 판정을 변조 방지 감사 로그에 다 넣으면 비용이 너무 큽니다. 반대로 아무것도 남기지 않으면 장애 때 설명할 수 없습니다. 그래서 decision log와 audit log의 역할을 나눕니다.

| 로그 | 목적 | 보관 기준 |
| --- | --- | --- |
| decision log | 정책 diff, latency, reason 분석 | 7~30일 상세, 이후 집계 |
| audit log | 고위험 액션의 승인과 실제 효과 설명 | 1년 이상 또는 규정 기준 |
| rollout event | policy version 변경, flag 변경, owner 승인 | 정책 수명 동안 유지 |

고위험 action은 decision log와 audit log가 연결되어야 합니다. 예를 들어 개인정보 export가 허용됐다면, "어떤 정책 버전에서 왜 allow였는가"와 "누가 실제 export를 실행했는가"가 같은 사건으로 추적되어야 합니다.

## 실무 적용

### 1) 최소 rollout 아키텍처

가장 단순한 구조는 아래 정도면 충분합니다.

1. PEP가 기존 PDP 또는 기존 코드 정책으로 실제 결정을 내린다.
2. 같은 input을 새 policy evaluator에도 보낸다.
3. 두 결과를 비교해 diff type을 계산한다.
4. 샘플링된 decision log와 집계 metric을 남긴다.
5. risk class별 threshold를 넘으면 rollout gate를 자동 보류한다.
6. canary enforcement는 action, tenant, subject group별 feature flag로 켠다.
7. rollback flag는 새 정책 강제를 즉시 끌 수 있어야 한다.

정책 input도 versioned schema로 관리해야 합니다.

```yaml
policy_input_v1:
  subject:
    kind: "user"
    roles: ["support_admin"]
    attributes:
      department: "finance"
      mfa_level: "phishing_resistant"
  action: "invoice.export"
  resource:
    type: "invoice"
    tenant_tier: "enterprise"
    owner_department: "finance"
    data_classification: "restricted"
  context:
    request_channel: "admin_console"
    network_zone: "corp"
    break_glass: false
```

입력 스키마가 없으면 shadow 결과를 신뢰하기 어렵습니다. 새 정책이 필요한 속성이 실제 요청에서는 비어 있거나, 배치에서는 `subject.kind = system`이 누락되는 일이 자주 생깁니다.

### 2) 단계별 운영 기준

권장 rollout 단계는 다음과 같습니다.

| 단계 | 기간 | 통과 기준 |
| --- | --- | --- |
| inventory | 3~7일 | action/resource/subject group별 호출량과 owner 확인 |
| shadow 1 | 7일 | 전체 diff rate 1% 이하, eval error 0.05% 이하 |
| shadow 2 | 7일 | 고위험 `deny_to_allow` 0건, 고위험 `allow_to_deny` owner 확인 |
| canary 1 | 1~2일 | 저위험 read 1~5%, support ticket spike 없음 |
| canary 2 | 3~7일 | 중위험 action 25~50%, rollback 미사용 |
| enforce | 지속 | 정책 version, diff, incident를 주간 리뷰 |

숫자는 서비스마다 조정해야 합니다. 중요한 것은 "테스트 통과"를 enforcement 조건으로 삼지 않는 것입니다. 운영 데이터의 diff와 owner 확인이 있어야 합니다.

### 3) 정책 변경 PR 템플릿

정책 변경에는 코드 변경 PR과 다른 정보가 필요합니다.

```markdown
## Policy Change

- Policy version:
- Changed actions:
- Affected resource types:
- Affected subject groups:
- Expected allow_to_deny:
- Expected deny_to_allow:
- Risk class:
- Shadow duration:
- Enforcement flag:
- Rollback owner:
- Support message:
- Audit evidence:
```

특히 `expected deny_to_allow`는 비워두면 안 됩니다. 권한을 더 열어야 하는 변경이라면 그 이유와 대상이 명확해야 합니다. "기존에 막히던 고객 요청을 풀기 위해" 같은 설명만으로는 부족하고, 어떤 고객, 어떤 action, 어떤 조건에서 열리는지 써야 합니다.

### 4) 대시보드와 알림

운영 대시보드는 정책 엔진 성공률만 보면 부족합니다.

- `authz_decision_total{action,resource_type,decision,policy_version}`
- `authz_shadow_diff_total{diff_type,action,risk_class}`
- `authz_eval_error_rate{policy_version}`
- `authz_pdp_latency_ms{policy_version}`
- `authz_cache_stale_allow_total{action,risk_class}`
- `authz_enforcement_rollback_total{policy_version}`
- `authz_support_ticket_total{action,policy_version}`

경보는 조치와 연결해야 합니다.

| 조건 | 조치 |
| --- | --- |
| 고위험 `deny_to_allow` 1건 이상 | enforcement 보류, security owner 리뷰 |
| `allow_to_deny` 0.1% 초과 30분 지속 | canary 확대 중단, owner 확인 |
| PDP p95 50ms 초과 10분 지속 | 저위험 read cache TTL 임시 상향, 고위험 직접 확인 유지 |
| eval error 0.1% 초과 | 새 정책 강제 중단, 기존 정책 유지 |
| support ticket 기준선 2배 | 사용자 메시지와 migration guide 점검 |

## 트레이드오프/주의점

첫째, shadow mode는 완벽한 미래 예측이 아닙니다. 새 정책이 실제로 enforce되면 사용자 행동이 달라집니다. 막힌 사용자는 재시도하거나 다른 경로를 찾고, 관리자 tool은 예외 요청을 만들 수 있습니다. shadow 결과는 출발점이지 최종 보증이 아닙니다.

둘째, 로그 비용이 커질 수 있습니다. 모든 decision을 원문 그대로 남기면 저장 비용과 개인정보 위험이 올라갑니다. 전체 요청은 집계하고, 고위험 action과 diff 발생 decision만 상세 로그로 남기는 방식이 현실적입니다.

셋째, deny-to-allow를 제품 개선으로만 보면 안 됩니다. 막히던 기능이 열리면 고객 불만은 줄 수 있지만, 테넌트 경계나 관리자 경계가 같이 열렸을 수도 있습니다. 권한 확대 diff는 항상 보안 리뷰 대상입니다.

넷째, 정책 엔진 장애 시 fail-open을 쉽게 선택하면 안 됩니다. 공개 문서 조회 같은 저위험 read는 제한적 fail-open이 가능하지만, 권한 상승, 개인정보 export, 결제 취소는 fail-closed가 기본입니다.

다섯째, shadow rollout을 너무 길게 끌면 정책 변경이 정체됩니다. 2주 shadow 후에도 diff owner가 정리되지 않으면 rollout 문제가 아니라 권한 모델과 owner 데이터 품질 문제일 가능성이 큽니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 정책 변경 PR에 affected action, resource, subject group, risk class가 있다.
- [ ] 새 정책은 enforcement 전 shadow mode에서 기존 정책과 비교된다.
- [ ] diff type을 `allow_to_deny`, `deny_to_allow`, `error_to_allow`처럼 위험별로 나눈다.
- [ ] 고위험 action의 `deny_to_allow`는 0건 또는 명시 승인으로만 통과한다.
- [ ] canary enforcement는 action, tenant, subject group별로 따로 켤 수 있다.
- [ ] rollback flag가 있고 5분 안에 기존 정책으로 되돌릴 수 있다.
- [ ] PDP latency, eval error, cache stale allow, support ticket을 함께 본다.
- [ ] decision log와 audit log의 보관 기간과 접근 권한이 분리되어 있다.

### 연습

1. 현재 서비스의 관리자 action 5개를 고르고 risk class를 `low`, `medium`, `high`로 나눠 보세요. 기준은 "잘못 허용했을 때 피해"와 "잘못 거절했을 때 업무 중단"입니다.
2. RBAC 조건 하나를 ABAC 조건으로 바꾸는 정책 변경을 가정하고, expected `allow_to_deny`와 `deny_to_allow`를 표로 적어 보세요.
3. 최근 7일 access log에서 실제 호출자 유형을 뽑아 `user`, `admin`, `system`, `partner`, `batch`로 분류해 보세요. `system`과 `batch`가 빠져 있으면 shadow 결과가 과신될 가능성이 큽니다.
4. 고위험 action 하나에 대해 PDP 장애 시 fail-open, fail-closed, read-only, manual approval 중 어떤 모드가 맞는지 근거와 숫자를 붙여 결정해 보세요.
