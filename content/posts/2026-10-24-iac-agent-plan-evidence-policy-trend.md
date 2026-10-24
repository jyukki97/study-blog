---
title: "2026 개발 트렌드: AI가 IaC를 다룰수록 Plan은 미리보기가 아니라 변경 증거가 된다"
date: 2026-10-24T10:06:00+09:00
lastmod: 2026-10-24T10:06:00+09:00
draft: false
tags: ["AI Coding Agents", "Infrastructure as Code", "Terraform", "Policy as Code", "Platform Engineering", "Change Management"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["AI agent infrastructure as code", "Terraform plan evidence", "IaC policy review", "agent infrastructure change control", "plan apply provenance"]
description: "AI 코딩 에이전트가 IaC 변경을 제안·작성하는 환경에서, plan을 단순 미리보기가 아니라 대상·권한·위험·검증·apply 결과를 잇는 변경 증거로 운영하는 기준을 정리합니다."
summary: "AI가 IaC 코드를 빠르게 만들수록 위험은 문법 오류보다 실제 대상과 권한을 오인한 plan·apply에 있다. 안전한 팀은 plan 파일 하나를 승인 근거로 과신하지 않고 base revision, provider identity, state freshness, policy verdict, apply receipt를 묶어 재현 가능한 변경 패킷으로 만든다."
key_takeaways:
  - "IaC의 핵심 산출물은 HCL·YAML diff가 아니라 특정 state와 credential, provider version에서 계산된 실행 후보(plan)이며, 이 입력이 달라지면 같은 코드도 다른 인프라를 바꿀 수 있다."
  - "AI 에이전트에는 생성 권한보다 plan 조회 범위, 변경 유형, apply 승인, 환경 분리를 먼저 제한해야 한다."
  - "정책 엔진의 allow verdict와 실제 apply 성공은 별개다. 변경 후 resource identity, drift, health, rollback 가능성을 receipt로 확인해야 한다."
operator_checklist:
  - "plan마다 source commit, lockfile/provider version, backend·workspace, state refresh 시각, 실행 identity, policy bundle revision을 기록한다."
  - "public ingress, IAM/RBAC, network egress, data deletion, billing class 변경은 AI의 자동 apply 대상에서 제외하고 별도 승인 lane으로 보낸다."
  - "승인한 plan artifact와 apply 대상이 같은지 digest·workspace·target list로 검증하고, apply 뒤에는 resource ID·health·drift check를 receipt에 남긴다."
---

AI 코딩 에이전트가 애플리케이션 코드뿐 아니라 Terraform, Pulumi, Kubernetes manifest, CI workflow까지 작성하기 시작하면서 IaC의 병목도 바뀌고 있습니다. 예전에는 사람이 HCL 문법과 provider 옵션을 얼마나 잘 아는지가 문제였다면, 지금은 에이전트가 빠르게 만든 변경이 **어느 계정·workspace·state를 기준으로 계산됐고, 누가 어떤 권한으로 실제 apply 했는가**가 더 큰 운영 질문이 됩니다.

여기서 `plan`은 “변경될 리소스 수를 보여 주는 화면”보다 중요합니다. plan은 특정 source revision, 변수, provider lockfile, 원격 state, 실행 identity가 만나서 만든 실행 후보입니다. 따라서 코드 diff가 작아도 state가 오래됐거나 workspace를 잘못 골랐으면 production VPC, IAM policy, database deletion protection을 잘못 바꿀 수 있습니다. 이 글은 [정책 기반 Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/), [Workload Identity와 Secretless Runtime](/posts/2026-03-26-workload-identity-secretless-runtime-trend/), [저장소별 AI 코딩 에이전트 평가](/posts/2026-10-17-ai-coding-agent-repository-evaluation-contract-trend/)를 연결해, AI 시대의 IaC plan을 **승인 가능한 변경 증거**로 다루는 기준을 정리합니다.

## 이 글에서 얻는 것

- 코드 diff, plan, apply 결과가 각각 무엇을 증명하고 무엇을 증명하지 못하는지 구분합니다.
- AI 에이전트의 IaC 작업을 read-only 조사, plan 생성, 승인된 apply로 나누는 권한 경계를 설계할 수 있습니다.
- state freshness·provider identity·정책 verdict·실제 resource health를 묶은 최소 변경 패킷을 만들 수 있습니다.
- 작은 팀이 과한 승인 절차 없이도 위험한 인프라 변경을 우선 분리하는 숫자·조건 기준을 얻습니다.

## 핵심 개념/이슈

### 1) IaC 파일 diff는 실행 효과의 근사가 아니다

애플리케이션 코드의 diff도 완전한 동작 예측은 아니지만, IaC는 외부의 mutable state를 직접 다룹니다. 같은 `main.tf`라도 다음 입력이 다르면 plan이 달라집니다.

| 입력 | 왜 달라지는가 | 누락될 때 생기는 오류 |
| --- | --- | --- |
| remote state와 refresh 시각 | 다른 사람이 이미 자원을 바꿨을 수 있다 | 삭제·교체 대상 오인, drift 은폐 |
| workspace·account·region | 이름은 같아도 대상 환경이 다르다 | staging plan을 보고 production apply |
| provider·module lockfile | provider의 기본값과 API 해석이 바뀔 수 있다 | 예상 밖 replace 또는 권한 확대 |
| 실행 identity와 policy bundle | 읽을 수 있는 자원과 허용되는 action이 달라진다 | reviewer와 runner의 결과 불일치 |
| 변수·secret 참조 | 네트워크 CIDR, image tag, feature flag가 달라진다 | plan에는 안전해 보여도 apply가 다름 |

그래서 AI가 “보안 그룹 rule 하나만 추가했습니다”라고 말해도 reviewer는 표현을 믿기보다 plan의 resource address, action(`create`, `update`, `replace`, `delete`), 실제 대상 account, egress·ingress 범위를 확인해야 합니다. plan은 이 확인을 자동화할 좋은 재료지만, state freshness와 실행 신원을 기록하지 않으면 나중에 재현할 수 없는 스크린샷이 됩니다.

### 2) 에이전트의 권한은 작성·계산·실행을 분리해야 한다

AI 도구에 repository write 권한을 줬다고 cloud apply 권한까지 줄 이유는 없습니다. 가장 안전한 기본 구조는 세 lane입니다.

~~~text
Lane 1: read-only inventory / policy explanation
        -> agent가 state metadata와 docs를 조회, 파일 변경 없음
Lane 2: branch + isolated plan
        -> agent가 PR과 plan artifact 생성, apply 없음
Lane 3: approved apply
        -> CI의 short-lived identity가 승인된 artifact만 실행
~~~

Lane 2에서 agent는 `terraform plan` 또는 동등한 preview를 만들 수 있지만, production credential·broad admin token을 가져서는 안 됩니다. 가능하면 plan용 identity도 환경별 읽기 권한과 필요한 제한적 validation 권한으로 좁힙니다. 실제 apply는 사람의 명시 승인 또는 policy가 정한 낮은 위험의 자동 승인 뒤에, CI가 발급한 짧은 수명의 workload identity로 실행합니다. 장기 cloud key를 에이전트 환경에 두지 않는 이유는 [Secretless Runtime](/posts/2026-03-26-workload-identity-secretless-runtime-trend/)의 원칙과 같습니다. 편의성을 위해 주는 넓은 credential은 tool prompt나 log, checkout artifact를 통해 훨씬 넓은 공격 표면이 됩니다.

### 3) policy verdict는 통과증이 아니라 분류 결과다

OPA, Sentinel, Conftest, cloud policy 같은 검사는 public bucket, `0.0.0.0/0` ingress, privileged role, encryption 미설정 같은 반복 규칙을 빠르게 잡습니다. 하지만 policy가 allow라고 해서 제품 위험이 사라지지는 않습니다. “새 NAT gateway 1개”가 정상 확장인지 비용 급증인지, “role binding 하나”가 최소 권한인지 cross-tenant 접근인지는 제품·운영 맥락이 필요합니다.

따라서 policy 결과를 `allow/deny`만으로 보지 말고, 다음 네 queue로 바꾸는 편이 실무적입니다.

| 분류 | 예시 | 기본 처리 |
| --- | --- | --- |
| 자동 진행 후보 | 태그 수정, 검증된 dev namespace의 replica +1 | 낮은 영향 정책 통과 뒤 canary |
| 리뷰 필요 | 새 internal service, resource replace, 비용 class 변경 | owner가 plan과 비용·rollback 확인 |
| 보안 승인 필요 | IAM/RBAC, public ingress, egress, secret 참조 | security/platform 공동 승인 |
| 자동 중단 | data delete, production state move, broad admin role, policy bypass | 별도 runbook과 명시적 break-glass |

AI가 여기에 기여할 수 있는 가장 좋은 일은 “통과했다”는 결론을 내리는 것이 아니라, plan을 이 분류에 맞게 요약하고 변경 이유·영향 자원·누락된 증거를 reviewer에게 보여 주는 일입니다. [Agentic Stacked PR Review](/posts/2026-10-08-agentic-stacked-pr-review-contract-trend/)에서 큰 변경을 리뷰 가능한 단위로 나누는 원칙은 인프라에도 그대로 적용됩니다.

### 4) 승인한 plan과 apply한 대상이 달라지는 순간을 막아야 한다

사람이 오전에 본 plan을 오후에 apply하면, 그 사이 state·변수·module registry·branch head가 바뀌었을 수 있습니다. 이 time-of-check/time-of-use 간격은 AI가 만든 PR에서만 생기는 문제가 아니지만, 빠른 재생성과 자동 queue로 더 자주 드러납니다.

출발점은 plan artifact를 immutable하게 저장하고 최소한 다음 값을 함께 서명 또는 기록하는 것입니다: source commit SHA, lockfile hash, backend/workspace, 변수 fingerprint(비밀값 원문 제외), provider version, state refresh time, plan digest, policy bundle revision, requested target list. apply job은 승인된 digest와 현재 실행 환경이 일치하지 않으면 다시 plan을 만들고 재승인을 요구해야 합니다. “코드는 안 바뀌었는데 state가 바뀐 경우”도 이 규칙의 대상입니다.

이는 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)의 핵심과 같습니다. 산출물 설명이 아니라 **무엇을, 어떤 전제에서, 어떤 권한으로, 어떻게 검증했는가**를 남겨야 나중에 변경을 되짚을 수 있습니다.

## 실무 적용

### 1) 위험도 규칙을 action과 blast radius로 단순화한다

모든 팀이 거대한 CMDB나 완벽한 비용 모델을 갖출 필요는 없습니다. 먼저 다음 두 축으로 rule을 만들면 충분히 강한 시작점이 됩니다.

1. **action 위험**: `delete`와 `replace`는 `create`·in-place `update`보다 한 단계 이상 높게 둡니다.
2. **blast radius**: production account, public network, identity, data store, 월 비용 영향은 자원 개수보다 우선합니다.

예를 들어 dev account에서 태그 30개를 바꾸는 plan은 자동 진행 후보일 수 있지만, production에서 database instance 1개를 `replace`하는 plan은 resource 수가 하나여도 자동 중단입니다. 첫 rollout에서는 AI가 만든 plan의 100%를 사람이 보고, 2주 동안 false classification과 review lead time을 측정합니다. 그 뒤에도 자동 apply는 아래처럼 좁게 유지하는 것이 좋습니다.

- production 아닌 환경
- `create/update`만 있고 `delete/replace`가 없음
- public ingress, IAM/RBAC, egress, data class, billing tier의 변화가 없음
- plan의 affected resource가 10개 이하이고 예상 비용 변화가 월 5% 이하
- state refresh가 10분 이내이며 policy bundle과 provider lockfile이 검증됨

이 기준을 만족해도 provider API 오류나 quota 문제는 생길 수 있으므로, apply 성공만으로 완료 처리하지 않습니다.

### 2) plan packet과 apply receipt를 CI가 만들게 한다

사람이 PR comment에 정보를 복사하면 빠르게 낡고 빠지는 필드가 생깁니다. CI가 아래와 같은 machine-readable packet을 만들고, PR에는 읽기 쉬운 요약만 보이게 하세요.

```yaml
change_id: iac-2026-10-24-184
source_commit: 4f31c2a
environment: prod-kr
workspace: payments-production
plan_digest: sha256:...
state_refreshed_at: 2026-10-24T10:02:11+09:00
runner_identity: github-oidc:repo/platform/iac-plan
actions: {create: 1, update: 2, replace: 0, delete: 0}
policy: {bundle: platform-2026.10.3, verdict: review_required}
approval: {required: platform-owner, expires_at: 2026-10-24T12:02:11+09:00}
```

apply 뒤에는 최소한 실행 job ID, 실제 resource ID, provider response, health probe, drift check 시각, rollback path를 receipt에 더합니다. database migration이나 network change처럼 즉시 health를 판정하기 어려운 경우에는 15~30분의 post-apply 관찰 window와 owner를 붙입니다. CI가 실패했을 때 에이전트가 알아서 retry·rollback할 권한은 별도입니다. 특히 identity와 network change는 자동 복구가 더 큰 접근 장애를 만들 수 있어, 정해진 runbook과 사람 승인 없이 반복 실행하면 안 됩니다.

### 3) state와 로그를 새로운 민감 정보로 취급한다

IaC state와 plan에는 resource ID, internal DNS, network topology, IAM principal, 때로는 secret 또는 secret의 참조 경로가 들어갑니다. AI tool에 source repository만 전달한다고 안전한 것이 아닙니다. plan artifact, CI log, PR comment, model context가 모두 데이터 유출 경로가 될 수 있습니다.

그래서 plan 원문을 광범위하게 붙이기보다 resource address·action·account·risk label을 기본 요약으로 쓰고, 민감한 값은 권한 있는 reviewer만 artifact store에서 보게 해야 합니다. 로그 redaction도 단순히 `password`라는 이름만 가리는 방식으로 끝내지 말고 provider가 출력하는 token, connection string, certificate data, user-data를 점검합니다. [AI Agent Sandbox와 Handoff 공격 표면](/posts/2026-07-23-agent-sandbox-handoff-attack-surface-trend/)의 경계는 IaC runner와 artifact store에도 적용됩니다.

## 트레이드오프/주의점

첫째, plan packet을 촘촘히 만들수록 리뷰 품질은 올라가지만 pipeline 시간이 늘 수 있습니다. 그래서 모든 변경에 동일한 human gate를 두기보다, 낮은 위험 lane에서는 자동 생성·짧은 만료·canary를 사용하고 위험한 lane에만 느린 검토를 집중해야 합니다. 핵심은 승인 횟수를 늘리는 것이 아니라 **승인자가 실제로 판단할 수 있는 정보만 남기는 것**입니다.

둘째, drift를 모두 즉시 고치려 하면 production 안정성이 오히려 흔들릴 수 있습니다. emergency console 변경이 발견됐을 때 agent가 곧바로 IaC로 되돌리지 말고, 먼저 owner·incident·현재 서비스 상태를 확인해야 합니다. drift는 위반일 수도 있지만 긴급 복구의 흔적일 수도 있습니다. change ticket과 만료일이 없는 drift만 우선 queue로 올리는 방식이 현실적입니다.

셋째, policy-as-code는 책임 전가 도구가 아닙니다. rule 작성자, exception 승인자, provider upgrade owner가 모두 없으면 deny rule은 배포 우회와 긴급 권한 공유를 부릅니다. policy exception에는 근거, 보완 통제, owner, 만료일을 남기고 재검토해야 합니다.

마지막으로 AI의 plan 요약은 보조 설명일 뿐입니다. agent가 “삭제 없음”이라고 요약했더라도 plan parser가 실제 action을 다시 집계하고, apply runner가 승인된 digest와 workspace를 재검증해야 합니다. 자연어의 설득력보다 기계가 확인한 대상 일치가 우선입니다.

## 체크리스트 또는 연습

- [ ] plan마다 commit, lockfile/provider version, account·region·workspace, state refresh 시각, runner identity가 있다.
- [ ] `delete`, `replace`, public ingress, IAM/RBAC, egress, data·비용 tier 변경은 별도 approval lane으로 분류된다.
- [ ] AI는 기본적으로 read-only 조사와 branch의 plan 생성까지만 하며 production apply credential을 보유하지 않는다.
- [ ] 승인한 plan digest·target list·workspace와 apply job의 입력이 다르면 재계산·재승인한다.
- [ ] apply receipt에 job ID, 실제 resource ID, health/drift 검증, rollback path, 관찰 owner가 남는다.
- [ ] plan·state·CI log·PR comment의 민감값 접근권한과 redaction을 분리했다.
- [ ] policy exception에는 근거, compensating control, 승인자, 만료일이 있다.

연습으로 최근 IaC PR 하나를 골라, reviewer가 10분 안에 다음 다섯 질문에 답할 수 있는지 확인하세요. **어느 account·workspace인가? 어떤 resource가 create/update/replace/delete 되는가? plan은 언제 어떤 state에서 만들어졌는가? 누가 apply할 수 있는가? 실패하면 어떤 경로로 복구하는가?** 답 하나라도 PR 본문과 CI artifact에서 재현되지 않는다면, 다음 개선은 AI에게 더 긴 prompt를 주는 일이 아니라 plan packet의 누락 필드를 자동 생성하는 일입니다.

## 관련 글

- [정책 기반 Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/)
- [Workload Identity와 Secretless Runtime](/posts/2026-03-26-workload-identity-secretless-runtime-trend/)
- [저장소별 AI 코딩 에이전트 평가](/posts/2026-10-17-ai-coding-agent-repository-evaluation-contract-trend/)
- [Execution Receipt로 Agent 작업을 검증하는 법](/posts/2026-04-14-execution-receipt-agent-operations-trend/)
- [Agentic Stacked PR Review](/posts/2026-10-08-agentic-stacked-pr-review-contract-trend/)
