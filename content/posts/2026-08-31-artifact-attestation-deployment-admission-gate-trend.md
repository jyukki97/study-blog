---
title: "2026 개발 트렌드: Artifact Attestation, 빌드 증명이 배포 승인 조건으로 이동한다"
date: 2026-08-31T10:06:00+09:00
lastmod: 2026-08-31T10:06:00+09:00
draft: false
tags: ["Artifact Attestation", "GitHub Actions", "Sigstore", "SLSA", "Kubernetes", "Supply Chain Security"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["artifact attestation", "GitHub Actions provenance", "Kubernetes admission policy", "Sigstore policy controller", "SLSA build provenance"]
description: "GitHub Actions artifact attestation과 Sigstore Policy Controller를 바탕으로, 빌드 provenance를 릴리스 배지에 머물게 하지 않고 Kubernetes 배포 admission·예외·rollback까지 연결하는 운영 기준을 정리합니다."
summary: "빌드 증명이 생겼다고 안전한 배포가 되는 것은 아니다. 중요한 변화는 provenance가 CI의 부가 산출물에서, 어느 digest를 어떤 workflow가 만들었는지 검증해 배포를 허용하거나 보류하는 runtime policy 입력으로 이동하는 데 있다."
key_takeaways:
  - "Artifact attestation은 artifact digest, build workflow, repository·ref 등 provenance를 검증하는 증거이지 이미지 취약점이나 애플리케이션 안전성을 보장하는 만능 서명은 아니다."
  - "배포 정책은 tag가 아니라 immutable digest를 기준으로 검증해야 빌드 뒤 tag 재지정과 증거 대상을 분리할 수 있다."
  - "Kubernetes admission은 처음부터 전체 cluster 차단으로 시작하지 않고, 한 namespace·한 workload 유형의 observe mode와 rollback 경로부터 검증해야 한다."
  - "예외는 bypass switch가 아니라 만료일, owner, ticket, 범위, 사후 검증이 붙은 별도 배포 계약이어야 한다."
operator_checklist:
  - "release workflow에 최소 권한 `contents: read`, `id-token: write`, `attestations: write`를 명시하고 action ref를 commit SHA로 pin한다."
  - "image reference는 tag가 아닌 digest로 artifact attestation을 검증하고, registry·repository·workflow identity를 allowlist로 둔다."
  - "admission 정책은 dry-run 또는 opt-in namespace에서 시작해 false denial, verification latency, rollback 성공률을 관찰한다."
  - "attestation 검증 실패, policy exception, admission bypass를 서로 다른 audit event와 alert로 남긴다."
learning_refs:
  - title: "Publish-Time Supply Chain Gate와 Review Context Plane"
    href: "/posts/2026-07-30-publish-time-supply-chain-review-context-trend/"
    description: "공급망 게이트가 publish와 workflow 실행 이전으로 이동한 배경을 다룹니다."
  - title: "CI-native Agent Runner와 Actions Token"
    href: "/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/"
    description: "CI runner의 token·권한을 workload identity로 다루는 기준입니다."
  - title: "Package Release Quarantine Gate"
    href: "/posts/2026-05-12-package-release-quarantine-gate-trend/"
    description: "릴리스 후 소비 전에 보류·검증 단계를 두는 운영 관점입니다."
  - title: "Kubernetes 롤아웃 전략과 무중단 배포"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "admission을 통과한 이미지도 canary와 rollback을 거쳐야 하는 이유를 연결합니다."
decision_guide:
  title: "어디부터 attestation을 배포 gate로 쓸까"
  intro: "우선순위는 서명 개수보다, 실제 배포 경로에서 믿어야 할 artifact·workflow·registry를 좁히고 실패를 되돌릴 수 있는가입니다."
  cases:
    - badge: "즉시 적용"
      title: "단일 registry와 통제된 GitHub Actions release workflow가 있다"
      fit: "container image가 동일한 조직 repository와 release branch에서 빌드되고, digest deployment를 이미 쓰는 팀에 맞습니다."
      watchouts: "attestation이 있어도 취약점·runtime configuration·권한 검토는 별도 gate로 남아야 합니다."
      next_step: "staging namespace 하나에서 workflow·repository·digest가 일치할 때만 admission을 허용합니다."
    - badge: "관찰 우선"
      title: "여러 CI, legacy registry, tag deployment가 섞여 있다"
      fit: "provenance coverage를 먼저 inventory하고, block 전에 예외와 migration 비용을 측정해야 하는 조직입니다."
      watchouts: "처음부터 deny를 켜면 정상 운영 이미지까지 멈추고 팀이 영구 bypass를 만들 수 있습니다."
      next_step: "30일간 audit-only로 image digest, issuer, workflow, verification failure reason을 수집합니다."
    - badge: "보류"
      title: "누가 어떤 image를 배포하는지 inventory조차 없다"
      fit: "manual kubectl, 공유 registry credential, mutable tag가 혼재해 policy의 기준 대상이 불명확한 경우입니다."
      watchouts: "증명을 발행해도 verifier가 신뢰할 identity와 artifact를 정하지 못하면 신호가 노이즈가 됩니다."
      next_step: "배포 workload별 registry, image digest, CI identity, owner, rollback 방법부터 목록화합니다."
---

소프트웨어 공급망 보안에서 "서명했다"는 말은 너무 쉽게 결론이 됩니다. 하지만 이미지에 provenance가 붙어도 배포 플랫폼이 그것을 읽지 않으면 증명은 release page의 장식에 머뭅니다. 반대로 Kubernetes admission이 검증을 강제하더라도, tag만 보고 검증하거나 예외가 무기한이면 실제 trust boundary는 넓습니다. 최근의 중요한 흐름은 artifact attestation을 더 많이 발행하는 데 있지 않습니다. **빌드 증명을 배포 시점의 허용·보류 판단에 넣고, 그 판단을 rollback 가능한 운영 절차로 만드는 데** 있습니다.

GitHub Actions는 binary와 container image에 build provenance를 위한 artifact attestation을 생성하고 검증하는 경로를 제공하며, Kubernetes에서는 Sigstore Policy Controller를 통해 signature·attestation 정책을 admission 단계에서 적용할 수 있습니다. SLSA도 provenance의 존재 자체와 build tampering에 대한 보호 수준을 분리해 설명합니다. 이 글은 이 세 흐름을 합쳐, "attestation이 있는가"가 아니라 **이 digest가 승인된 workflow에서 만들어졌고 지금 이 workload에 배포돼도 되는가**를 판단하는 실무 기준으로 정리합니다.

이 글은 [Publish-Time Supply Chain Gate와 Review Context Plane](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/), [CI-native Agent Runner와 Actions Token](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/), [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [Kubernetes 롤아웃 전략과 무중단 배포](/learning/deep-dive/deep-dive-kubernetes-rollouts/)의 다음 단계입니다. 앞선 글이 package 공개와 workflow 실행 전 멈춤을 다뤘다면, 여기서는 검증된 build artifact가 runtime 배포 경계에 들어가는 순간을 다룹니다.

참고한 공식 자료:

- [GitHub Docs: Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub Docs: Generating build provenance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub Docs: Enforcing artifact attestations with Kubernetes admission](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/enforce-artifact-attestations)
- [Sigstore Policy Controller overview](https://docs.sigstore.dev/policy-controller/overview/)
- [SLSA Build Levels](https://slsa.dev/spec/v1.1/levels)

## 이 글에서 얻는 것

- attestation, image digest, signature, SBOM, vulnerability scan이 각각 답하는 질문을 구분합니다.
- GitHub Actions provenance를 어떤 workflow identity와 artifact subject로 검증해야 하는지 이해합니다.
- Kubernetes admission을 all-or-nothing 차단이 아닌 관찰·canary·enforcement 단계로 도입하는 기준을 얻습니다.
- 예외, revocation, rollback을 포함해 배포 gate가 가용성을 해치지 않도록 운영하는 방법을 배웁니다.

## 핵심 개념/이슈

### 1) Attestation은 "안전하다"가 아니라 "어떻게 만들어졌는가"에 답한다

artifact attestation은 artifact와 build metadata를 연결하는 검증 가능한 증거입니다. GitHub Actions에서 생성한 build provenance는 특정 binary 또는 container image가 어떤 repository·workflow·ref·commit 맥락에서 생성됐는지 확인할 수 있게 합니다. 즉 이 증거가 직접 답하는 질문은 "이 이미지에 취약점이 없는가?"가 아니라 **"이 digest가 우리가 신뢰하는 build 경로에서 나왔는가?"**입니다.

이 구분이 없으면 운영 정책이 과도해집니다. provenance가 통과한 이미지는 여전히 취약할 수 있고, secret이 포함된 config로 실행될 수 있으며, 지나친 Kubernetes 권한을 요청할 수도 있습니다. 반대로 vulnerability scan이 통과했다고 빌드가 승인된 source에서 만들어졌다는 보장도 없습니다. 서로 다른 gate는 서로 다른 질문을 담당해야 합니다.

| 증거 또는 검사 | 주로 답하는 질문 | 단독으로 답하지 못하는 질문 |
| --- | --- | --- |
| provenance attestation | 누가 어떤 workflow·source에서 artifact를 만들었는가 | 알려진 취약점·runtime 권한이 안전한가 |
| image digest | 지금 배포하려는 바이트가 정확히 무엇인가 | 누가 만들었고 정책을 통과했는가 |
| SBOM | 포함된 component와 version은 무엇인가 | 실제 build workflow가 변조되지 않았는가 |
| vulnerability scan | 알려진 취약점·policy 위반이 있는가 | artifact가 승인된 CI에서 build됐는가 |
| admission policy | 이 workload를 지금 허용할 것인가 | rollout 뒤 사용자 영향이 없는가 |

따라서 attestation 도입의 첫 설계 산출물은 tool 설정이 아니라 trust statement입니다. 예를 들어 "`ghcr.io/acme/payments@sha256:...`는 `acme/payments` repository의 protected `main`에서 `release-image.yml`이 생성하고, production namespace는 이 identity만 받는다"처럼 artifact, source, workflow, environment를 한 문장으로 좁혀야 합니다.

### 2) Tag가 아니라 digest를 배포 단위로 삼아야 한다

`payments:2026.08.31` 같은 tag는 사람이 읽기 좋지만 mutable합니다. 같은 tag가 나중에 다른 image를 가리킬 수 있고, attestation이 어떤 artifact를 증명하는지와 현재 deployment가 실행하는 바이트가 갈라질 수 있습니다. 그래서 admission과 deployment manifest는 가능한 한 digest를 기준으로 연결합니다.

```yaml
# 사람이 읽기 좋은 tag만으로는 증거 대상이 고정되지 않는다.
image: ghcr.io/acme/payments:2026.08.31

# 실제 배포·검증 대상을 고정한다.
image: ghcr.io/acme/payments@sha256:0123...cdef
```

tag를 release catalog나 UI에서 완전히 없앨 필요는 없습니다. 다만 tag는 발견성, digest는 실행 신원으로 역할을 분리합니다. release pipeline은 build 직후 digest를 수집하고, attestation을 그 digest에 연결하며, promotion manifest도 같은 digest를 사용합니다. 이 연결이 끊기면 "attestation은 있었지만 다른 image가 배포됐다"는 가장 비싼 종류의 false assurance가 생깁니다.

실무 시작 기준은 단순합니다.

- production 배포의 **100%**가 digest reference를 사용한다.
- attestation verification subject가 deployment image digest와 정확히 일치한다.
- registry host, repository, workflow path, branch 또는 tag policy를 allowlist로 둔다.
- 이미지 재빌드가 필요하면 기존 tag를 재지정하지 않고 새 digest와 새 attestation을 발행한다.

### 3) CI 권한은 provenance를 강하게도 약하게도 만든다

GitHub Actions의 artifact attestation 생성은 workflow permission과 workload identity 위에서 동작합니다. 일반적으로 build provenance 생성에는 `contents: read`, OIDC token을 위한 `id-token: write`, attestation 기록을 위한 `attestations: write` 같은 권한이 필요합니다. 이것은 단순 syntax가 아니라 "어떤 workflow가 누구의 identity로 증명을 발행할 수 있는가"라는 정책입니다.

여기서 특히 조심할 지점은 provenance action을 넣었다는 이유로 workflow 전체에 broad permission을 주는 것입니다. build job은 source를 읽고 image를 push하고 attestation을 발행해야 할 수 있지만, issue write, pull-request write, broad package admin은 별개입니다. [CI-native Agent Runner와 Actions Token](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)에서 다룬 것처럼 CI runner의 token은 build 편의 토큰이 아니라 배포 identity입니다.

권장 원칙은 다음과 같습니다.

1. attestation을 만드는 job을 release 전용 workflow로 분리합니다.
2. job-level `permissions:`를 명시하고, third-party action은 full commit SHA로 pin합니다.
3. fork PR, 사람이 임의로 dispatch하는 workflow, release branch push의 provenance를 같은 신뢰 등급으로 취급하지 않습니다.
4. workflow path와 source ref를 verifier policy에 포함해, 같은 repository의 다른 workflow가 production 증명을 발행하지 못하게 합니다.

### 4) Admission은 보안 도구가 아니라 배포 control plane의 한 단계다

Sigstore Policy Controller 같은 admission controller는 Kubernetes API 요청이 cluster state가 되기 전에 image signature와 attestation 정책을 평가할 수 있습니다. 이 기능은 강력하지만, 처음부터 모든 namespace에 deny를 걸면 platform team은 정상 서비스까지 멈출 위험을 떠안습니다. 설계의 핵심은 policy syntax가 아니라 **누가 실패를 어떻게 복구하는가**입니다.

권장 rollout은 세 단계입니다.

| 단계 | 범위 | 통과 기준 | 실패 시 행동 |
| --- | --- | --- | --- |
| Observe | staging opt-in namespace | verification coverage 95% 이상, false denial 원인 분류 | 로그·metric만 기록, 배포 차단 안 함 |
| Canary enforce | 저위험 service 1~3개 | verification latency p95 2초 이하, emergency rollback 성공 | approved exception으로 한시 우회 |
| Progressive enforce | production workload 유형별 | digest deployment 100%, 30일간 bypass 없는 정상 운영 | namespace별 확대를 중단하고 원인 수정 |

`opt-in` namespace부터 시작하는 이유는 정책을 약하게 만들기 위해서가 아닙니다. 각 service의 registry, image format, GitHub trust root, deployment tool이 실제로 policy 표현과 맞는지 확인하기 위해서입니다. verification 오류에는 `attestation_missing`, `issuer_not_allowed`, `workflow_mismatch`, `subject_digest_mismatch`, `registry_unreachable`처럼 사람이 조치할 수 있는 reason code가 필요합니다. "admission denied" 한 줄만 남기면 보안과 가용성 모두 나빠집니다.

### 5) 예외는 break-glass가 아니라 만료되는 별도 계약이다

긴급 보안 patch나 legacy service migration 중에는 attestation이 없는 artifact를 배포해야 할 수 있습니다. 이때 영구 allowlist를 한 줄 추가하면 gate는 결국 장식이 됩니다. 예외는 강한 정책의 반대가 아니라, **가용성을 지키면서 책임을 남기는 예외적인 policy object**로 모델링해야 합니다.

최소 예외 필드는 다음과 같습니다.

```yaml
exception:
  workload: "payments-reconciler"
  image_digest: "sha256:..."
  namespace: "production"
  reason: "critical security patch while legacy builder migration is in progress"
  owner: "payments-platform"
  approval_ticket: "SEC-1842"
  expires_at: "2026-09-02T00:00:00Z"
  follow_up: "rebuild via release-image.yml and verify provenance"
```

중요한 것은 `expires_at`입니다. 예외가 만료되기 전 재검증하거나 연장 승인하지 않으면 다음 deployment는 다시 gate를 통과해야 합니다. 예외 사용률이 한 달 동안 1%를 넘거나 같은 workflow가 두 번 이상 예외를 요구하면, individual bypass가 아니라 build platform migration backlog로 승격하는 편이 낫습니다.

## 실무 적용

### 1) Artifact-to-deployment chain을 inventory한다

도입 전 먼저 아래 체인을 workload 10개에 대해 표로 만듭니다. 자동화가 아니라 목록화부터 하는 이유는, attestation을 검증할 대상과 책임자가 없으면 policy를 넓게 열거나 정상 build를 막게 되기 때문입니다.

```text
source repository + protected ref
  -> release workflow + immutable action refs
  -> image digest + registry
  -> provenance attestation
  -> promotion manifest using that digest
  -> target namespace + service owner
```

이 체인에서 하나라도 빈 곳이 있으면 enforce를 미룹니다. 예를 들어 image가 digest로 promotion되지 않는다면 build provenance가 있어도 deployment target이 고정되지 않습니다. registry가 둘 이상이고 trust root가 다르다면 한 policy에 묶지 말고 workload class를 먼저 나눕니다. [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)처럼 공급망 검증은 최종 차단률보다, 확인 불가능한 artifact를 얼마나 빨리 분류 가능한 흐름으로 옮기는지가 초기 목표입니다.

### 2) 한 release workflow에 최소 권한 attestation을 붙인다

release workflow는 build가 끝난 artifact digest를 입력으로 provenance를 발행합니다. 실제 action 버전과 registry 옵션은 조직의 GitHub 설정에 맞춰 확인해야 하지만, 아래처럼 권한과 산출물의 관계를 명시하는 형태가 출발점입니다.

```yaml
permissions:
  contents: read
  id-token: write
  attestations: write

# build step가 만든 immutable digest를 provenance subject로 사용한다.
# action은 organization policy가 허용한 immutable revision으로 pin한다.
```

CI를 통과했다는 사실만으로 promotion하지 않습니다. promotion job에서 동일 digest의 attestation verification을 다시 실행하고, 검증 결과의 workflow identity·repository·source ref를 release record에 남깁니다. 이중 검증은 도구를 믿지 못해서가 아니라, build와 deploy 사이의 handoff가 다른 credential, 다른 runner, 다른 사람에 의해 이루어질 수 있기 때문입니다.

### 3) Canary policy의 숫자를 먼저 합의한다

다음은 조직 상황에 맞게 조정할 수 있는 보수적인 출발선입니다.

- observe mode 30일 동안: production candidate 중 provenance coverage **95% 이상**
- canary namespace: admission verification p95 **2초 이하**, p99 **5초 이하**
- `subject_digest_mismatch`: **0건**이 될 때까지 enforcement 확대 금지
- `attestation_missing`으로 인한 정상 release 차단: 주당 **1건 이하**, 초과하면 developer workflow 개선
- emergency exception: workload별 **30일 1회 이하**, 모든 예외는 **72시간 이내** 만료
- rollout: workload class별 10% → 25% → 50% → 100%, 각 구간 최소 **7일** 관찰

이 기준의 우선순위는 **잘못된 artifact 배포 방지 > rollback 가능성 > release 속도**입니다. 하지만 그 순서가 release를 멈추라는 뜻은 아닙니다. 검증 서비스가 불가용할 때 fail-open할지 fail-closed할지는 workload 위험도와 기존 배포 증거에 따라 명시적으로 정합니다. 결제·identity control plane은 더욱 보수적으로, 내부 dev namespace는 bounded fail-open을 선택할 수 있지만 어떤 선택이든 audit event는 남겨야 합니다.

### 4) Admission을 통과한 뒤에도 progressive delivery를 유지한다

attestation policy가 허용한 것은 artifact의 출처이지 application behavior가 아닙니다. schema migration, feature flag, configuration error, dependency latency는 provenance와 무관하게 장애를 만들 수 있습니다. 그래서 [Kubernetes 롤아웃 전략과 무중단 배포](/learning/deep-dive/deep-dive-kubernetes-rollouts/)의 canary·health check·rollback은 그대로 필요합니다.

운영 흐름을 다음처럼 분리하면 책임이 선명해집니다.

```text
provenance verification pass
  -> policy admission pass
  -> 5% canary deployment
  -> SLO / error / saturation gate
  -> progressive promotion
```

provenance fail은 "무엇을 배포해도 되는가"의 문제이고, canary fail은 "이 artifact가 현재 환경에서 정상 동작하는가"의 문제입니다. 둘을 하나의 green check로 합치면 incident 때 rollback 근거가 흐려집니다.

## 트레이드오프/주의점

1. **Attestation은 vulnerability scan을 대체하지 않습니다.** 어느 workflow가 만들었는지를 증명할 뿐, dependency CVE·license·misconfiguration·runtime permission을 해결하지 않습니다.

2. **모든 build를 같은 identity로 신뢰하지 않습니다.** PR preview, nightly, release branch, 수동 hotfix workflow는 source·review·token 조건이 다릅니다. verifier policy도 이 차이를 표현해야 합니다.

3. **tag pinning을 digest pinning으로 오해하지 않습니다.** semver tag를 고정했다고 대상 바이트가 고정되는 것은 아닙니다. promotion과 verification은 digest를 기준으로 연결합니다.

4. **admission failure의 가용성 영향을 설계해야 합니다.** trust root fetch, registry access, verifier latency가 배포를 막을 수 있습니다. timeout, cache, outage mode, break-glass owner를 test하지 않은 fail-closed는 운영 사고가 될 수 있습니다.

5. **예외를 조용히 허용하지 않습니다.** 만료·owner·ticket·범위·사후 검증 없는 bypass는 policy가 아니라 영구 취약점입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] production manifest가 mutable tag가 아니라 immutable image digest를 사용한다.
- [ ] attestation verifier가 registry, repository, workflow path, source ref, subject digest를 모두 확인한다.
- [ ] release job의 permissions가 최소 권한으로 명시되고 action refs가 immutable revision으로 pin되어 있다.
- [ ] observe → canary enforce → progressive enforce의 단계와 중단 기준이 있다.
- [ ] missing, workflow mismatch, digest mismatch, verifier outage를 구분한 metric과 runbook이 있다.
- [ ] exception은 workload·digest·owner·ticket·expiry·follow-up을 갖고 자동 만료된다.
- [ ] provenance pass 뒤에도 canary SLO gate와 rollback을 유지한다.

### 연습: staging namespace 하나에 검증 가능한 배포 gate 만들기

1. staging의 서비스 하나를 골라 source repository, release workflow, registry, image digest, owner를 inventory합니다.
2. 해당 workflow가 만든 image digest에 build provenance를 발행하고, promotion record에 verification 결과를 남깁니다.
3. admission을 audit-only로 7일 운영해 missing·issuer mismatch·digest mismatch reason을 분류합니다.
4. 정상 coverage가 95%를 넘으면 그 namespace에서만 enforce를 켜고, verification p95와 false denial을 7일 더 봅니다.
5. attestation 없는 긴급 image, 잘못된 workflow image, digest가 다른 image를 각각 배포해 정책이 의도대로 막고 audit record를 남기는지 확인합니다.

## 관련 글

- [Publish-Time Supply Chain Gate와 Review Context Plane](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/)
- [CI-native Agent Runner와 Actions Token](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)
- [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)
- [Kubernetes 롤아웃 전략과 무중단 배포](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
