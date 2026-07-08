---
title: "백엔드 커리큘럼 심화: Permission Drift와 Access Review, 오래된 권한을 자동으로 회수하는 운영 설계"
date: 2026-07-08
draft: false
topic: "Backend Security"
tags: ["Authorization", "Access Review", "Permission Drift", "Security", "Audit Log", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "RBAC·ABAC·ReBAC로 권한을 설계한 뒤 시간이 지나며 생기는 권한 드리프트를 탐지하고, 접근권 검토·자동 회수·감사 증거로 운영하는 기준을 정리합니다."
module: "backend-security"
study_order: 1246
key_takeaways:
  - "권한 설계의 진짜 난이도는 최초 부여가 아니라 조직 이동, 임시 예외, 퇴사, 프로젝트 종료 뒤 남는 권한을 회수하는 데 있다."
  - "Access Review는 분기별 엑셀 점검이 아니라 권한 그래프, 사용 이력, 위험도, owner 승인, 회수 이벤트가 연결된 운영 파이프라인이어야 한다."
  - "고위험 권한은 30~90일 단위 재검토와 미사용 자동 회수 기준을 두고, 모든 예외는 만료일과 감사 로그를 가져야 한다."
operator_checklist:
  - "권한 grant row마다 owner, reason, expires_at, last_used_at, source_system을 채운다."
  - "임시 권한은 기본 7~30일 만료로 만들고, 만료 연장은 새 승인 이벤트로 남긴다."
  - "고위험 권한 회수는 audit log와 notification을 남기고, 회수 후 403 증가를 모니터링한다."
learning_refs:
  - title: "인가 모델 실전 설계"
    href: "/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/"
    description: "RBAC, ABAC, ReBAC를 어떤 기준으로 고를지 정리한 기반 글입니다."
  - title: "권한 판정 캐시 무효화"
    href: "/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/"
    description: "권한 변경 직후 stale allow를 줄이는 캐시·이벤트 기준입니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "권한 변경과 회수 이벤트를 나중에 믿을 수 있는 증거로 남기는 방식입니다."
---

권한 시스템은 처음 만들 때보다 운영하면서 더 어려워집니다. 신규 입사자에게 역할을 주고, 고객사 관리자에게 프로젝트 권한을 부여하고, 장애 대응을 위해 임시 admin 권한을 열어 주는 일은 비교적 쉽습니다. 문제는 시간이 지난 뒤입니다. 팀 이동, 프로젝트 종료, 외주 계약 만료, 임시 예외, 테스트 계정, 긴급 대응 계정이 쌓이면 실제 필요한 권한과 시스템에 남아 있는 권한이 어긋납니다. 이것이 **Permission Drift(권한 드리프트)**입니다.

권한 드리프트는 바로 장애로 보이지 않습니다. 사용자는 여전히 로그인되고, API도 정상 응답합니다. 하지만 사고가 났을 때 "왜 이 사람이 아직 이 데이터에 접근할 수 있었나", "왜 만료된 파트너 키가 여전히 정산 API를 호출했나", "왜 임시 운영 권한이 6개월 동안 살아 있었나" 같은 질문으로 돌아옵니다. 그래서 권한 운영은 [인가 모델 실전 설계](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)에서 끝나지 않습니다. 권한을 계속 검토하고, 설명하고, 회수하는 **Access Review 파이프라인**이 필요합니다.

이 글은 [권한 판정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/), [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [시크릿 관리](/learning/deep-dive/deep-dive-secret-management/)와 이어서 보면 좋습니다. 핵심은 권한을 "부여 가능한 기능"이 아니라 "수명이 있는 운영 자산"으로 다루는 것입니다.

## 이 글에서 얻는 것

- 권한 드리프트가 어떤 경로로 생기고, 왜 초기 인가 설계만으로는 막기 어려운지 이해할 수 있습니다.
- 권한 grant row에 어떤 메타데이터를 남겨야 나중에 owner, reason, 만료, 사용 이력을 설명할 수 있는지 기준을 잡을 수 있습니다.
- Access Review를 분기별 수동 점검이 아니라 위험도 기반 자동 후보 생성, owner 승인, 회수, 감사 로그로 연결하는 방법을 가져갈 수 있습니다.
- 고위험 권한, 임시 예외, 미사용 권한, API Key 권한을 어떤 숫자 기준으로 회수할지 정할 수 있습니다.

## 핵심 개념/이슈

### 1) 권한 드리프트는 "잘못 준 권한"보다 "회수하지 못한 권한"에서 많이 생긴다

권한 사고를 떠올리면 보통 처음부터 과도한 권한을 준 장면을 생각합니다. 물론 그것도 문제입니다. 하지만 운영에서는 처음에는 타당했던 권한이 시간이 지나면서 위험해지는 경우가 더 많습니다.

대표 패턴은 아래와 같습니다.

| 패턴 | 예시 | 위험 |
| --- | --- | --- |
| 조직 이동 | 결제팀에서 마케팅팀으로 이동했지만 정산 조회 권한 유지 | 업무상 불필요한 민감 데이터 접근 |
| 임시 예외 | 장애 대응용 admin 권한을 24시간만 쓰기로 했지만 만료 없음 | 상시 superuser화 |
| 프로젝트 종료 | 외주 개발자 계정이 프로젝트 종료 뒤에도 repo/API 접근 가능 | 계약 범위 밖 접근 |
| shadow group | 과거 권한 그룹이 더 이상 쓰이지 않지만 정책에 남음 | 리뷰 누락과 역할 폭발 |
| 미사용 키 | 120일 미사용 API Key가 여전히 활성 | 유출 시 탐지 지연 |

이 문제는 RBAC, ABAC, ReBAC 중 무엇을 쓰느냐와 별개로 발생합니다. RBAC에서는 역할이 늘어나며 고아 역할이 생기고, ABAC에서는 예외 조건이 누적되고, ReBAC에서는 관계 edge가 끊기지 않습니다. 그래서 모델 선택 다음에는 반드시 권한 수명주기와 회수 경로를 설계해야 합니다.

### 2) grant row는 권한의 "현재 상태"가 아니라 "부여 근거"를 담아야 한다

권한 테이블을 단순히 `user_id`, `role`, `created_at`으로 만들면 나중에 검토할 정보가 부족합니다. 왜 줬는지, 누가 승인했는지, 언제까지 필요한지, 최근 사용됐는지 알 수 없기 때문입니다. Access Review를 운영하려면 권한 grant 자체에 검토 가능한 필드가 있어야 합니다.

권장 필드는 아래 정도입니다.

```text
permission_grants
- grant_id
- subject_type        # user, service_account, api_key, group
- subject_id
- resource_type
- resource_id
- permission          # orders:read, billing:admin, project:write
- risk_tier           # low, medium, high, critical
- source_system       # HR, IAM, admin_console, break_glass, migration
- granted_by
- approved_by
- reason_code
- ticket_id
- created_at
- expires_at
- last_used_at
- last_reviewed_at
- review_owner
- status              # active, expiring, suspended, revoked
```

여기서 `reason_code`, `ticket_id`, `expires_at`이 특히 중요합니다. 이유와 만료일이 없는 권한은 시간이 지나면 설명할 수 없습니다. 운영 기준으로는 high-risk 권한의 `expires_at` 누락률을 **0%**로 두는 편이 안전합니다. medium 이하 권한도 owner와 reason은 반드시 가져야 합니다.

### 3) Access Review는 전체 권한 목록을 뿌리는 일이 아니다

많은 팀이 분기마다 권한 목록을 CSV로 뽑아 팀장에게 보내고 "확인해 주세요"라고 합니다. 이 방식은 오래 못 갑니다. 검토자는 수백 행을 보고 의미를 파악하지 못하고, 결국 모두 승인하거나 아무것도 회수하지 않습니다. 좋은 Access Review는 사람에게 전체 데이터를 던지지 않고, 시스템이 먼저 위험 후보를 줄여 줍니다.

후보 생성 기준은 최소 네 가지입니다.

1. **위험도**
   - admin, export, billing, production write, customer PII read는 우선 검토
2. **사용 이력**
   - 30~90일 미사용 권한은 회수 후보
3. **조직/관계 변화**
   - 부서 이동, 그룹 탈퇴, 프로젝트 종료, 계약 만료 이벤트와 비교
4. **예외성**
   - break-glass, manual grant, 정책 우회, 만료 연장 이력이 있는 권한

즉 "모든 권한을 검토하라"보다 "이 37개 권한은 회수 후보이고, 이 중 9개는 7일 안에 결정해야 한다"로 만들어야 합니다. 사람은 도메인 판단을 하고, 시스템은 후보를 압축해야 합니다.

### 4) 권한 회수는 권한 부여보다 더 위험할 수 있다

보안 관점에서는 안 쓰는 권한을 빨리 지우고 싶습니다. 하지만 운영에서는 회수 자체가 장애를 만들 수 있습니다. 오래된 배치 job이 어떤 API Key로 돌아가는지 모르거나, 파트너사가 아직 이전 scope를 쓰고 있거나, 고객 지원팀의 긴급 조회 권한을 갑자기 빼면 업무가 멈출 수 있습니다.

그래서 회수는 단계가 필요합니다.

```text
detect -> notify -> grace period -> suspend -> revoke -> monitor
```

- `detect`: 미사용, 조직 변경, 만료 초과 후보 탐지
- `notify`: subject와 owner에게 회수 예정 알림
- `grace period`: low/medium은 7~14일, high-risk는 1~3일 또는 즉시
- `suspend`: 필요하면 soft block으로 먼저 막고 복구 가능하게 둠
- `revoke`: 최종 회수, 복구는 새 승인으로만 허용
- `monitor`: 회수 뒤 403, job failure, support ticket 증가 확인

의사결정 기준은 **critical 권한은 안전 우선, low 권한은 운영 안정성 우선**입니다. 고객 데이터 export, 결제 취소, 권한 부여, production write 권한은 만료가 지났다면 즉시 중지에 가깝게 운영합니다. 반대로 읽기 전용 내부 대시보드 권한은 알림과 유예 기간을 두는 편이 현실적입니다.

### 5) 회수 후 권한 캐시와 세션을 같이 정리해야 한다

권한 row를 `revoked`로 바꿔도 애플리케이션이 캐시한 결정을 계속 쓰면 효과가 없습니다. 특히 JWT claim, 세션 캐시, API gateway cache, PDP local cache가 있으면 stale allow가 남을 수 있습니다. 권한 회수는 [권한 판정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)와 함께 설계해야 합니다.

권장 기준:

- critical 권한 회수: 1분 이내 전 경로 반영
- high 권한 회수: 5분 이내 반영
- 일반 권한 회수: 캐시 TTL 15~60분 내 반영 가능
- 관리자 권한 회수: 활성 세션 재검증 또는 강제 logout
- API Key revoke: 다음 요청부터 즉시 차단, revoked key 재사용 알림

권한 캐시 TTL이 길다면 회수 이벤트를 push해야 합니다. 반대로 이벤트 파이프라인이 불안정하다면 TTL을 짧게 잡아야 합니다. "언젠가 반영된다"는 권한 회수에서는 부족합니다.

## 실무 적용

### 1) 4단계 도입 플랜

**1단계: 권한 인벤토리**

먼저 권한을 부여하는 경로를 모두 찾습니다. 관리자 UI, IAM sync, DB script, migration, support tool, API Key 발급, break-glass 절차가 후보입니다. 권한 row가 한 테이블에 없더라도 상관없습니다. 중요한 것은 "어디서 권한이 생기고 사라지는가"를 그리는 것입니다.

출발 기준:

- high-risk permission 목록 20개 이내로 정의
- 권한 부여 경로 100% 식별
- owner 없는 권한 grant 비율 측정
- 90일 이상 미사용 grant 수 계산

**2단계: grant metadata 보강**

기존 권한 테이블에 필드를 한 번에 다 넣기 어렵다면 shadow table로 시작해도 됩니다. `grant_id`, `owner`, `reason`, `expires_at`, `last_used_at`, `risk_tier`만 있어도 리뷰 품질이 크게 올라갑니다.

최소 기준:

- 신규 high-risk grant는 `expires_at` 필수
- break-glass grant 기본 만료 24시간
- 외주/파트너 계정은 계약 종료일과 연결
- service account/API Key는 owner 팀과 rotation owner 필수

**3단계: 리뷰 후보 자동 생성**

매일 또는 매주 배치로 회수 후보를 만듭니다.

```yaml
review_candidate_rules:
  critical_expired:
    condition: "risk_tier in [critical, high] and expires_at < now"
    action: "suspend_or_revoke"
    sla: "24h"
  unused_admin:
    condition: "permission contains admin and last_used_at < now - 30d"
    action: "owner_review"
    sla: "7d"
  org_mismatch:
    condition: "subject.department != resource.owner_department"
    action: "owner_review"
    sla: "7d"
  stale_api_key:
    condition: "subject_type == api_key and last_used_at < now - 90d"
    action: "rotate_or_revoke"
    sla: "14d"
```

후보가 너무 많으면 실패합니다. 첫 달에는 critical/high만 대상으로 삼고, 회수 후보가 owner당 주 20개를 넘지 않게 제한하는 편이 좋습니다. 나머지는 통계로만 보고 기준을 다듬습니다.

**4단계: 회수 자동화와 감사 증거**

회수 이벤트는 단순 update가 아니라 감사 이벤트입니다. 최소 아래를 남깁니다.

```text
event: permission.revoked
grant_id: pg_123
subject_id: user_456
permission: billing:admin
resource_id: tenant_789
revoked_by: access_review_job
review_owner: team-billing
reason_code: unused_45d_expired
previous_last_used_at: 2026-05-21T03:10:00Z
policy_version: access-review-2026-07
```

이 기록은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)의 high-risk 액션으로 봐야 합니다. 권한 회수가 잘못됐을 때 되돌리기 위해서도, 회수가 필요했음을 설명하기 위해서도 증거가 필요합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

초기 운영 기준은 아래처럼 잡을 수 있습니다.

| 항목 | 권장 출발선 |
| --- | --- |
| critical 권한 만료 누락률 | 0% |
| high-risk grant 리뷰 주기 | 30~90일 |
| break-glass 기본 만료 | 24시간, 최대 72시간 |
| admin 권한 미사용 회수 후보 | 30일 |
| 일반 권한 미사용 회수 후보 | 90~180일 |
| 파트너/API Key 미사용 회수 후보 | 90일 |
| 회수 후 stale allow 반영 | critical 1분, high 5분 |
| owner 미응답 자동 처리 | high는 suspend, low는 재알림 후 만료 |

우선순위는 **외부 노출/민감 데이터 > 권한 변경 가능 권한 > production write > 결제/정산 > 일반 읽기** 순서가 안전합니다. 모든 권한을 같은 강도로 관리하려고 하면 팀이 지칩니다. 먼저 사고 비용이 큰 권한부터 닫아야 합니다.

### 3) 운영 대시보드

Access Review가 잘 도는지 보려면 결과 지표가 있어야 합니다.

- active high-risk grant 수
- owner 없는 grant 비율
- expires_at 없는 high-risk grant 수
- 30/90/180일 미사용 권한 수
- review candidate 생성 수와 실제 revoke 비율
- owner SLA 초과 건수
- 회수 후 403 증가율
- revoked credential 재사용 시도

여기서 `revoke 비율`만 높이는 것은 목표가 아닙니다. 너무 공격적으로 회수하면 운영 장애가 납니다. 좋은 목표는 owner 없는 권한과 만료 없는 high-risk 권한을 줄이고, 회수 후 장애를 낮게 유지하는 것입니다.

## 트레이드오프/주의점

첫째, 자동 회수는 보안을 높이지만 업무를 끊을 수 있습니다. 특히 오래된 배치, partner integration, 고객 지원 도구는 사용 빈도가 낮아도 필요할 수 있습니다. 그래서 high-risk는 짧게, low-risk는 유예를 두는 위험도 기반 정책이 필요합니다.

둘째, owner 정보를 믿기 어렵습니다. 팀 이동과 조직 개편이 권한 테이블보다 빠르게 변합니다. HR/IdP/프로젝트 관리 도구와 동기화하되, 최종 회수 책임자는 사람이 확인할 수 있게 남겨야 합니다.

셋째, 권한 검토가 너무 잦으면 모두가 형식적으로 승인합니다. critical/high는 30~90일, medium은 6개월, low는 이벤트 기반으로 나누는 편이 낫습니다. 검토 주기는 짧을수록 좋은 것이 아니라, 실제 판단 가능한 단위여야 합니다.

넷째, 감사 로그에 민감정보를 많이 넣으면 또 다른 보안 문제가 됩니다. 권한 회수 이벤트에는 원문 고객 데이터나 secret을 넣지 말고, grant id, subject id, reason code, policy version, digest 중심으로 남기는 것이 안전합니다. 이 지점은 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 함께 봐야 합니다.

다섯째, Access Review는 인가 버그를 대신하지 않습니다. 정책 자체가 잘못됐거나, 코드 경로가 PDP를 우회하거나, 캐시 무효화가 안 되면 리뷰로 해결되지 않습니다. 리뷰는 사후 정리와 drift 축소 장치이고, 실시간 판정 품질은 별도 테스트와 관측으로 지켜야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] high-risk permission 목록이 문서화되어 있다.
- [ ] 권한 grant마다 owner, reason, source, expires_at, last_used_at이 있다.
- [ ] break-glass와 임시 권한은 기본 만료를 가진다.
- [ ] 조직 이동, 그룹 탈퇴, 프로젝트 종료 이벤트가 권한 검토 후보로 연결된다.
- [ ] Access Review 후보는 위험도와 사용 이력으로 우선순위가 매겨진다.
- [ ] owner 미응답 시 suspend/revoke/재알림 기준이 정해져 있다.
- [ ] 권한 회수 이벤트가 감사 로그로 남는다.
- [ ] 회수 후 권한 캐시, 세션, API Key 검증 경로가 즉시 또는 TTL 내 반영된다.
- [ ] 회수 후 403 증가와 job failure를 모니터링한다.
- [ ] owner 없는 권한과 만료 없는 high-risk 권한을 월간 지표로 본다.

### 연습

1. 현재 서비스의 권한 부여 경로를 모두 적어 보세요. 관리자 UI, DB script, migration, IdP group, API Key 발급, 긴급 대응 절차 중 하나라도 빠지면 인벤토리를 다시 봐야 합니다.  
2. `billing:admin`, `customer_pii:export`, `project:write` 세 권한을 예로 들어 risk tier, 기본 만료, 리뷰 주기, 회수 SLA를 표로 정해 보세요.  
3. 최근 90일 동안 사용되지 않은 admin 권한을 찾는 SQL 또는 배치 로직을 설계해 보세요. 단, 바로 삭제하지 말고 owner 알림, 유예 기간, 회수 후 모니터링까지 포함해야 합니다.  
4. 권한 회수 뒤 캐시가 30분 동안 stale allow를 유지하는 상황을 가정하고, 어떤 API가 가장 위험한지와 TTL/이벤트 무효화 기준을 정해 보세요.

## 관련 글

- [인가 모델 실전 설계: RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [권한 판정 캐시와 권한 무효화 플레이북](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)
- [API Key Lifecycle 발급·회전·폐기 플레이북](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)
- [Tamper-Evident Audit Log 운영 플레이북](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [시크릿 관리 실무](/learning/deep-dive/deep-dive-secret-management/)
