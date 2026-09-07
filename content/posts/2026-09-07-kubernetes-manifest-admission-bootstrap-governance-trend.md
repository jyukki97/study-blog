---
title: "2026 개발 트렌드: Kubernetes v1.37 Manifest 기반 Admission Control, 정책 보호선을 API 밖으로 옮기다"
date: 2026-09-07T10:06:00+09:00
lastmod: 2026-09-07T10:06:00+09:00
draft: false
tags: ["Kubernetes", "Admission Control", "Policy Governance", "Control Plane", "CEL", "Platform Security"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37", "manifest-based admission control", "admission bootstrap", "validating admission policy", "CEL policy", "control plane governance"]
description: "Kubernetes v1.37에서 Beta가 된 manifest 기반 admission control을 계기로, API 안의 정책을 보호하려면 bootstrap 신뢰 경로·파일 권한·검증·rollback을 어떻게 다시 설계해야 하는지 정리합니다."
summary: "Kubernetes API로 관리하는 admission 정책은 편리하지만, API와 etcd가 아직 정책을 적용하기 전의 bootstrap 구간 및 정책 객체 변경 자체를 완전히 보호하기 어렵다. v1.37의 manifest 기반 admission control은 policy source를 API 밖의 파일로 옮겨 startup부터 적용하고 유효한 변경만 reload한다. 다만 이는 YAML 배포 편의 기능이 아니라 OS·image·Git 배포 경로를 새 root of trust로 승격하는 선택이다."
key_takeaways:
  - "Kubernetes v1.37에서 manifest 기반 admission control은 Beta이며, admission webhook과 CEL 기반 정책을 API server startup부터 디스크 manifest에서 적용할 수 있다."
  - "유효한 파일 변경은 reload되고 invalid 변경은 마지막 유효 구성을 유지한다. 하지만 잘못된 유효 정책은 여전히 cluster-wide blast radius를 만들 수 있다."
  - "도입 판단은 feature 활성화가 아니라 policy source owner, node filesystem 권한, 테스트·canary·rollback 증거가 기존 API 정책보다 강한지로 해야 한다."
  - "manifest와 API policy를 중복으로 오래 운영하면 enforcement 충돌과 drift가 생긴다. 각 policy의 권위 있는 source를 하나로 선언해야 한다."
operator_checklist:
  - "먼저 어떤 정책이 bootstrap 보호가 필요한지 inventory하고, 일반 workload policy를 무조건 파일 기반으로 옮기지 않는다."
  - "manifest source를 versioned artifact로 관리하고 schema·semantic·negative admission 테스트를 CI에서 통과시킨다."
  - "API server host의 manifest 경로는 최소 권한·immutable mount·change audit을 적용하고, break-glass 수정자를 제한한다."
  - "전환 전후 denial count, allowed/denied reason, API server reload error, policy source version을 같은 대시보드에서 비교한다."
learning_refs:
  - title: "Admission Control과 Concurrency Limits"
    href: "/learning/deep-dive/deep-dive-admission-control-concurrency-limits/"
    description: "요청을 보호하는 admission과 cluster governance policy를 혼동하지 않기 위한 기본 관점입니다."
  - title: "Authorization Policy Shadow Rollout"
    href: "/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/"
    description: "차단 정책을 observe 단계부터 검증하는 rollout 절차를 연결합니다."
  - title: "Config Change Safety 플레이북"
    href: "/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/"
    description: "파일 기반 정책도 배포·검증·rollback 대상이라는 운영 기준입니다."
  - title: "Artifact Attestation과 Deployment Admission Gate"
    href: "/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/"
    description: "무엇을 배포할지 검증하는 정책과 그 정책 자신을 보호하는 경계를 구분합니다."
---

Kubernetes에서 admission control은 보통 Pod 생성 전에 policy를 적용하는 기능으로 설명된다. 실제 운영에서 더 어려운 질문은 따로 있다. **그 policy 객체 자체가 변경되거나 제거되는 일을 누가, 언제, 어느 신뢰 경로에서 막는가?** API server와 etcd에 저장한 ValidatingAdmissionPolicy, webhook configuration, 관련 RBAC는 관리하기 편하지만, API server가 올라오는 bootstrap 구간에는 아직 그 정책이 적용되지 않을 수 있다. 또 API를 수정할 수 있는 강한 권한이 탈취되면 정책 자원을 먼저 약화시키려는 시도가 가능하다.

Kubernetes v1.37은 이 경계에 manifest 기반 admission control을 Beta로 올렸다. admission webhook과 CEL 기반 정책을 API가 아니라 API server가 읽는 디스크 manifest에서 startup부터 적용하고, 파일을 감시해 유효한 변경만 reload한다. invalid update가 들어오면 마지막 유효 구성을 유지한다. 이는 policy를 더 쉽게 쓰는 기능보다, **cluster bootstrap과 policy 보호의 신뢰 원천을 어디에 둘 것인가**라는 platform engineering 변화다. 공식 릴리스 노트는 이 기능이 API 기반 admission configuration을 보호할 수 있도록 별도 관리 경로를 제공한다고 설명한다. [Kubernetes v1.37 release](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)

이 글은 [Admission Control과 Concurrency Limits](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/), [Authorization Policy Shadow Rollout](/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/), [Config Change Safety 플레이북](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/), [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)를 연결한다. 앞선 글들이 workload 요청이나 artifact를 어떤 기준으로 허용할지를 다뤘다면, 여기서는 **그 기준을 누가 바꾸고 API server 시작 시점에 누가 먼저 적용하는가**를 다룬다.

## 이 글에서 얻는 것

- API 기반 admission policy가 가진 bootstrap·자기보호 한계를 구분합니다.
- manifest 기반 policy source를 도입할 때 파일 경로, CI 검증, 승인, rollback을 하나의 trust chain으로 설계할 수 있습니다.
- 어떤 policy를 파일 기반으로 옮기고 어떤 policy를 기존 API 관리로 남길지 결정 기준을 얻습니다.
- Beta 기능을 운영에 넣을 때 기능 활성화 여부보다 중요한 관측·canary·break-glass 체크리스트를 가져갑니다.

## 핵심 개념/이슈

### 1) admission policy의 문제는 무슨 rule인가와 누가 rule을 바꾸는가로 나뉜다

일반 admission policy는 Pod가 privileged인지, 검증되지 않은 image를 쓰는지, 특정 namespace에 배포되는지 판단한다. 이 층은 policy expression과 예외 조건이 핵심이다. 그러나 cluster root 권한을 가진 주체가 admission configuration을 수정하거나, control plane recovery 중 API policy가 아직 로드되지 않았다면, 좋은 expression도 보호 장치가 되지 못한다.

manifest 기반 admission control은 policy artifact를 API 객체와 분리한다. API server가 디스크에서 manifest를 읽어 startup부터 적용하므로, API 안에서 admission resource를 변경해도 그 파일 기반 rule은 같은 경로로 바로 무력화할 수 없다. 이 차이를 API 밖에 YAML 하나 더 둔다는 말로 축소하면 안 된다. 관리 경로가 다음처럼 바뀐다.

~~~text
기존: Git/운영자 -> Kubernetes API -> etcd -> API 기반 admission policy
변경: Git/승인 CI -> signed/config artifact -> API server의 제한된 manifest 경로 -> bootstrap admission policy
~~~

둘째 경로의 보호 수준은 Git repository 이름으로 결정되지 않는다. API server host에서 누가 그 파일을 바꿀 수 있는지, control-plane image에 어떻게 들어가는지, mount가 쓰기 가능한지, 변경을 어떻게 추적하는지가 실제 root of trust다. 파일 권한이 넓거나 노드 접근이 느슨하면 API resource보다 더 약한 방어가 될 수 있다.

### 2) startup enforcement와 valid-only reload는 장애 회복력과 변경 통제를 함께 바꾼다

v1.37의 중요한 운영 특성은 valid manifest는 변경 시 reload하고, invalid update는 이전의 유효한 구성을 계속 쓴다는 점이다. 급하게 편집한 YAML의 문법 오류가 policy를 통째로 사라지게 만드는 위험은 낮춘다. 그러나 이것은 validation layer 하나일 뿐이다. 문법·schema가 맞지만 namespace selector를 넓히거나 deny 조건을 반대로 쓴 정책은 유효해도 서비스 배포를 멈출 수 있다.

그래서 검증을 세 층으로 나눠야 한다.

| 검증 층 | 확인할 것 | 실패 시 조치 |
| --- | --- | --- |
| 구조 검증 | manifest 형식, API version, 필수 필드, 참조 이름 | CI에서 즉시 차단 |
| 의미 검증 | selector 범위, namespace 예외, CEL 표현식, 기존 rule과 충돌 | test cluster에서 allowed/denied fixture 실행 |
| 운영 검증 | API server reload, denial rate, policy version, 배포 lead time | canary cluster에서 관측 후 승격 또는 rollback |

특히 허용되어야 하는 workload와 거부되어야 하는 workload를 같은 fixture 세트에 넣어야 한다. 차단 케이스만 통과시키면 운영 daemon, monitoring agent, bootstrap component가 막히는 회귀를 놓친다. [Authorization Policy Shadow Rollout](/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/)처럼 처음에는 audit 또는 제한된 namespace 관측으로 false positive를 찾고, 실제 차단 범위를 단계적으로 넓히는 편이 안전하다.

### 3) 모든 admission policy를 manifest로 옮기는 것은 정답이 아니다

파일 기반 source는 API 변경을 넘어 보호해야 하는 좁은 bootstrap policy에 적합하다. 반면 application team이 namespace별로 자주 조정하는 quota, 개발용 예외, 빠르게 바뀌는 label rule까지 모두 control-plane 파일로 묶으면 platform 팀이 병목이 되고 변경 반경이 커진다.

다음 기준으로 나누면 실무적이다.

| policy 성격 | 권장 source | 판단 이유 |
| --- | --- | --- |
| admission resource 자체의 무단 변경 방지, control-plane bootstrap 보호 | manifest 우선 검토 | API 안의 policy만으로 자신을 보호하기 어려운 경계다. |
| 전사적으로 고정된 privileged workload·host path·critical namespace 보호 | manifest 또는 강하게 관리된 중앙 policy | 낮은 변경 빈도와 큰 blast radius를 별도 승인으로 다룬다. |
| 팀별 resource rule, 점진적 실험, 자주 바뀌는 제품 정책 | Kubernetes API + GitOps | namespace ownership과 빠른 feedback이 더 중요하다. |
| 일회성 incident 완화 | 명시적 만료가 있는 API policy | 긴급 변경을 permanent host artifact로 남기지 않는다. |

핵심은 두 source를 병렬로 오래 두지 않는 것이다. 같은 rule이 API와 manifest에 중복되면 한쪽은 allow, 다른 쪽은 deny하는 상황에서 운영자는 어떤 source가 권위인지 알기 어렵다. 각 정책마다 policy ID, owner, authoritative source, scope, effective version, rollback target을 registry에 기록하고 중복 enforcement는 migration 기간으로 제한한다.

### 4) filesystem은 이제 control-plane security boundary다

manifest 방식은 etcd ACL 문제 일부를 줄이는 대신 host filesystem과 artifact delivery를 보안 경계로 올린다. API server 노드에서 policy directory에 쓸 수 있는 계정, CI가 push하는 image, configuration management agent, break-glass shell access는 모두 policy editor가 된다. 일반 ConfigMap보다 높은 등급으로 취급해야 하는 이유다.

최소 운영 기준은 다음과 같다.

- manifest는 versioned repository에서 review하며, 생성 artifact에는 source commit과 policy version을 남긴다.
- API server process가 읽는 경로는 일반 workload mount와 분리하고, runtime write 권한을 최소화한다.
- 배포 주체와 break-glass 수정자는 최소 인원으로 제한하며, host-level 변경도 audit log에 남긴다.
- 변경 artifact에 schema lint, policy fixture test, diff 기반 blast-radius 요약을 붙인다.
- 마지막 유효 artifact와 그것을 되돌리는 절차를 control plane 접근 장애 상황에서도 실행 가능하게 문서화한다.

이 방식은 [Config Change Safety 플레이북](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/)의 config registry 개념을 control-plane policy에 적용한 것이다. Kubernetes API 호출이 성공했는지보다 어떤 version이 어느 API server에서 effective인지, reload failure가 없는지, 누가 변경했는지가 더 중요하다.

## 실무 적용

### 1) 4단계 도입으로 trust chain을 먼저 검증한다

**1단계: policy inventory**  
현재 validating webhook, CEL policy, 관련 RBAC를 모아 API policy 변경을 보호하는 rule과 일반 workload rule을 분리한다. source owner와 만료일이 없는 emergency exception도 같이 찾는다.

**2단계: offline fixture와 artifact pipeline**  
정상 control-plane component, 운영 agent, 승인된 workload, 막혀야 하는 privileged Pod, policy resource를 수정하려는 요청을 fixture로 만든다. CI는 syntax 성공만이 아니라 expected allow/deny와 policy diff의 selector 범위 변화를 검증해야 한다.

**3단계: non-production canary**  
개발 또는 staging cluster 한 곳에 먼저 적용한다. 최소 24시간 동안 API server reload error, admission deny count, deployment failure, bootstrap/restart 성공 여부를 기준선과 비교한다. control plane restart와 invalid manifest 배포를 실제로 재현해 이전 유효 구성이 유지되는지도 확인한다.

**4단계: production slice와 rollback rehearsal**  
전체 fleet에 일괄 적용하지 않고 단일 cluster 또는 영향이 제한된 environment에서 시작한다. abort 조건을 미리 적는다. 예를 들어 예상하지 않은 deny가 5분에 10건 이상이거나, platform namespace deployment가 실패하거나, API server reload error가 1회라도 발생하면 이전 artifact로 되돌리고 원인을 분류한다.

### 2) 관측은 deny 숫자 하나로 끝나지 않는다

성공 기준을 denied requests 0으로 잡으면 보호 정책은 아무 일도 하지 않는 것처럼 보인다. 반대로 deny가 늘었다고 항상 나쁜 것도 아니다. 차단해야 할 privileged Pod를 막았다면 정상이다. policy version과 reason을 붙여 분리해야 한다.

최소 대시보드에는 다음을 둔다.

- admission decisions: policy ID, source, decision, reason별 건수
- manifest policy effective version: API server별 version과 reload success/failure timestamp
- deployment failure 및 API request latency를 policy version 전후로 비교한 지표
- allowed fixture·denied fixture의 정기 synthetic 결과
- host artifact 변경자, source commit, break-glass 사용 여부

이 지표들은 policy가 켜져 있다는 상태와 실제로 예측 가능한 방식으로 동작한다는 증거를 나눈다. [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)가 artifact의 출처를 확인하는 문제라면, 여기서는 그 확인 규칙이 부팅부터 유지되는지를 확인하는 문제다.

### 3) 의사결정 기준(숫자·조건·우선순위)

권장 우선순위는 **bootstrap 정책의 무결성 > control plane 가용성 > 일반 배포의 속도 > 운영 편의**다. 이 순서가 없으면 emergency 편집 편의 때문에 high-trust 경로의 쓰기 권한이 넓어진다.

실행 기준 예시는 다음과 같다.

- 최근 30일 동안 변경이 0~2회이고, 무력화되면 cluster 전체에 영향을 주는 policy만 첫 manifest 후보로 둔다.
- 각 policy는 최소 10개의 allow fixture와 10개의 deny fixture를 유지하며, 정책 변경 PR에서 모두 통과해야 한다.
- production 승격 전 canary는 24시간 이상, control-plane restart 1회 이상, invalid artifact recovery 1회 이상을 포함한다.
- reload error, control-plane component의 예상 밖 deny, 새 policy version에서 deployment failure 증가가 있으면 자동 승격하지 않는다.
- break-glass는 만료 시각과 사후 review ticket을 필수로 하고, permanent manifest 편집으로 우회하지 않는다.

숫자는 시작점일 뿐이다. 더 중요한 것은 어떤 policy가 API 밖의 source를 필요로 하는가와 rollback에 API가 정상이어야만 하는가를 각 cluster topology에서 답하는 일이다. managed Kubernetes처럼 control-plane filesystem에 접근할 수 없는 환경이라면, 기능 자체를 쓸 수 있다는 설명과 실제 운영 가능성은 다르다. 이 경우 기존 API policy, provider guardrail, GitOps admission 경로 중 어디가 bootstrap 보호를 제공하는지 다시 평가해야 한다.

## 트레이드오프/주의점

1. **policy source를 API 밖으로 옮겼다고 자동으로 더 안전해지지 않는다.** Host 접근, image supply chain, configuration agent가 약하면 API RBAC보다 넓은 우회 경로가 생긴다.

2. **valid-only reload는 semantic safety를 보장하지 않는다.** 문법이 맞는 broad deny는 더 위험할 수 있다. negative/positive fixture와 canary가 필요하다.

3. **manifest와 API policy의 중복은 drift를 만든다.** 한 policy ID에는 권위 있는 source 하나, migration 기간에는 명확한 precedence와 종료일이 있어야 한다.

4. **Beta라는 상태를 무시하면 안 된다.** Version compatibility, feature 활성화 방식, managed provider의 지원 범위를 upgrade plan에서 별도로 확인해야 한다. 새 security control을 단독 방어선으로 승격하기 전에는 기존 policy와 recovery 절차를 유지한다.

## 체크리스트 또는 연습

- [ ] 현재 cluster에서 admission resource를 수정할 수 있는 principal과 API server host artifact를 수정할 수 있는 principal을 각각 목록화했다.
- [ ] manifest 후보 policy마다 owner, scope, authoritative source, source commit, effective version, rollback target을 기록했다.
- [ ] allow/deny fixture가 privileged workload뿐 아니라 control-plane·monitoring·bootstrap component를 포함한다.
- [ ] invalid manifest, API server restart, 이전 artifact rollback을 non-production에서 실제 실행해 결과를 남겼다.
- [ ] policy version별 deny reason, reload error, deployment failure, API server health를 한 대시보드에서 비교한다.
- [ ] API policy와 manifest policy가 같은 rule을 중복 적용하는 migration에 종료일과 precedence가 있다.

연습으로 현재 운영 중인 admission rule 하나를 고른다. 그 rule을 변경할 수 있는 API principal, Git reviewer, CI deployer, control-plane host 수정자를 모두 적어 보자. 그중 한 경로만 탈취되어도 rule이 약화되는지 확인하면, manifest 기반 admission control이 필요한지와 어떤 보호를 먼저 강화해야 하는지가 훨씬 명확해진다.
