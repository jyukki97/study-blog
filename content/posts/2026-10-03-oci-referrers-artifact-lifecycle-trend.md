---
title: "2026 개발 트렌드: OCI Referrers가 늘릴수록, 컨테이너 레지스트리는 태그 저장소가 아니라 증명 그래프가 된다"
date: 2026-10-03T10:06:00+09:00
lastmod: 2026-10-03T10:06:00+09:00
draft: false
tags: ["OCI", "Container Registry", "Supply Chain Security", "SBOM", "Provenance", "Kubernetes"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["OCI referrers", "OCI artifact manifest", "container image provenance", "SBOM lifecycle", "registry garbage collection"]
description: "OCI Referrers로 이미지 digest에 SBOM·provenance·서명 같은 메타데이터가 붙기 시작하면서, 배포 정책뿐 아니라 복제·보존·삭제·장애 시 검증 경로까지 그래프로 관리해야 하는 이유를 정리합니다."
summary: "이미지 태그 하나를 확인하는 방식으로는 SBOM, provenance, signature가 원본 digest와 함께 이동·보존되는지 설명할 수 없다. OCI Referrers를 쓰는 팀은 attestation 발급보다 먼저 subject digest, registry 복제, 정책 조회 실패, garbage collection을 포함한 아티팩트 생명주기를 운영 계약으로 만들어야 한다."
key_takeaways:
  - "태그는 이동 가능한 배포 별칭이고, provenance·SBOM·서명의 기준점은 변하지 않는 subject digest여야 한다."
  - "referrer가 생성됐다는 사실만으로 대상 레지스트리 복제·retention·admission 조회가 보장되지는 않으므로 경로별 검증이 필요하다."
  - "배포 정책은 서명 존재만 보지 말고 subject 일치, 허용 issuer·workflow, predicate 종류, 생성 시각, 조회 실패 시 행동을 함께 평가해야 한다."
  - "이미지 GC와 태그 정리는 attached artifact를 고아로 만들 수 있으므로 release record와 referrer graph를 함께 보존해야 한다."
operator_checklist:
  - "production 배포는 tag가 아닌 immutable image digest와 그 digest에 연결된 증명을 기록한다."
  - "build registry, mirror registry, runtime registry 각각에서 referrer 조회와 artifact digest를 canary로 대조한다."
  - "admission timeout·registry outage 때 enforce, warn, hold 중 어느 동작을 할지 환경별로 명시한다."
  - "retention·GC 작업 전 release digest와 SBOM·provenance·signature의 참조 관계를 export한다."
---

컨테이너 이미지는 오랫동안 `service:2026.10.03` 같은 태그 하나로 배포 흐름을 설명할 수 있었습니다. 하지만 이제 한 release에는 이미지 외에도 SBOM, build provenance, 취약점 스캔 결과, 서명, 정책 예외 승인이 붙습니다. OCI Referrers와 artifact manifest는 이 메타데이터를 이미지 digest에 연결하는 공통 수단으로 자리 잡고 있습니다. 이 변화의 핵심은 "레지스트리에 파일이 하나 더 생긴다"가 아닙니다. **레지스트리가 배포할 바이트와 그 바이트에 대한 증명의 관계를 보관하는 그래프가 된다**는 점입니다.

그래프를 의식하지 않으면 위험한 장면이 생깁니다. build registry에는 provenance가 있지만 mirror registry에는 복제되지 않을 수 있습니다. `stable` 태그는 새 digest를 가리키는데 deployment admission은 이전 digest의 서명을 찾을 수 있습니다. lifecycle job이 태그 없는 manifest를 청소하면서 SBOM이나 signature만 고아로 남길 수도 있습니다. 이 글은 [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/), [npm Trusted Publishing의 Release Path](/posts/2026-09-05-npm-trusted-publishing-release-path-governance-trend/), [Publish-Time Supply Chain Gate](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/), [CI/CD 공급망 보안](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)의 원칙을 컨테이너 registry lifecycle에 적용합니다.

OCI artifact와 referrer의 형식은 [OCI image-spec의 artifact manifest](https://github.com/opencontainers/image-spec/blob/main/manifest.md)와 각 레지스트리·배포 도구의 구현 상태를 함께 확인해야 합니다. 아래의 수치는 특정 레지스트리 제품의 기본값이 아니라, 운영 설계를 시작할 때 쓸 수 있는 보수적인 기준입니다.

## 이 글에서 얻는 것

- 이미지 태그, manifest digest, referrer artifact가 각각 무엇을 식별하는지 구분할 수 있습니다.
- SBOM·provenance·서명이 registry 복제와 배포 admission에서 같은 subject를 가리키도록 검증할 수 있습니다.
- metadata 조회 장애를 보안 우회나 전체 배포 중단으로 만들지 않는 환경별 정책을 설계할 수 있습니다.
- retention·garbage collection 전후에 release 증명을 잃지 않는 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 태그는 배포 편의성이고, digest가 증명의 기준점이다

`registry.example.com/payments:stable`은 사람이 읽기 좋은 별칭이지만 mutable입니다. 같은 태그가 다음 배포에서 다른 manifest를 가리킬 수 있습니다. 반면 `sha256:...` digest는 특정 manifest의 불변 식별자입니다. referrer artifact는 이 subject digest를 가리키며, 그 artifact 자신도 별도의 digest를 가집니다. 그러므로 "stable 태그에 SBOM이 있다"는 말은 불완전합니다. 정확한 문장은 "배포한 image digest D에 대해 SBOM artifact S, provenance artifact P, signature artifact G가 있으며, 이들이 모두 D를 subject로 가리킨다"입니다.

이 차이는 rollback에서 특히 중요합니다. 태그를 이전 release로 되돌려도, admission 정책이 대상 digest에 연결된 적절한 provenance를 찾지 못하면 rollback도 막힐 수 있습니다. 반대로 태그에 붙은 서명이라는 느슨한 모델을 쓰면 새 digest가 기존 승인처럼 보일 위험이 있습니다. deploy 기록에는 tag를 운영 힌트로 남기되, 실제 image digest와 확인한 referrer digest 목록을 함께 남겨야 합니다.

### 2) referrer 조회 성공은 복제·보존 성공을 뜻하지 않는다

팀은 build registry에서 image를 push하고, 보안 도구가 SBOM과 attestation을 올린 뒤, region별 mirror 또는 customer registry로 복제하는 흐름을 자주 씁니다. 여기서 image manifest만 복제하면 runtime registry에는 subject만 있고 referrer graph가 비어 있게 됩니다. 레지스트리의 artifact 지원 범위, replication filter, media type 허용, GC 구현이 다르면 "source에서는 보인다"는 검증만으로 부족합니다.

최소 검증 단위는 registry마다 다음 네 가지입니다.

| 확인 항목 | 확인 질문 | 실패했을 때 의미 |
| --- | --- | --- |
| subject | runtime registry에 기대한 image digest가 있는가 | 잘못된 image 또는 복제 지연 |
| discovery | subject digest로 referrer 목록을 조회할 수 있는가 | API·권한·구현 차이 |
| content | SBOM·provenance artifact를 실제로 내려받아 digest가 맞는가 | metadata 일부 복제·손상 |
| policy | deployment identity가 허용 predicate를 검증하는가 | 증명은 있으나 배포 계약과 불일치 |

이 검사를 image build job에서 한 번 하고 끝내지 마세요. 배포 직전 runtime registry에서도 한 번 해야 mirror lag와 retention 사고를 잡을 수 있습니다. 다만 모든 pod 시작 때 원격 registry를 강하게 조회하면 registry 장애가 애플리케이션 가용성으로 번질 수 있으므로, admission cache와 실패 정책을 별도로 설계해야 합니다.

### 3) "서명이 있다"는 정책의 절반도 아니다

서명 또는 attestation이 하나 있다는 사실은 누가, 어떤 workflow에서, 어떤 바이트를 만들었다는 질문에 아직 답하지 못합니다. production admission은 적어도 subject digest 일치, 허용된 issuer와 repository, 허용 workflow 또는 build identity, predicate type, 생성 시각 또는 release window, 검증 키·인증서 상태를 함께 봐야 합니다. 예를 들어 취약점 스캔 attestation만 있고 build provenance가 없으면 정책상 허용하지 않을 수 있습니다.

또한 검증 결과는 환경마다 달라야 합니다. 개발 namespace는 provenance 미존재를 `warn`으로 기록할 수 있지만 production은 `enforce`가 보통 더 안전합니다. 반대로 referrer service timeout을 모든 환경에서 자동 거절하면 registry 장애가 긴급 rollback까지 막을 수 있습니다. "장애면 무조건 허용"과 "장애면 무조건 중단" 사이에, 최근에 검증한 immutable digest만 제한적으로 허용하는 hold policy가 필요한 팀도 있습니다. 이 정책은 예외가 아니라 사전에 테스트할 운영 계약입니다.

## 실무 적용

### 1) 먼저 release graph inventory를 만든다

새 도구를 도입하기 전 최근 production release 10개를 골라 `tag → image digest → SBOM digest → provenance digest → signature digest → target registry`를 표로 기록합니다. 빠진 칸이 있으면 툴을 더 붙이기보다 어느 단계에서 관계가 끊겼는지 확인합니다. build, scan, sign, mirror, deploy가 서로 다른 시스템이면 소유자도 각 edge에 붙여야 합니다.

초기에는 production image가 반드시 digest pin으로 배포되는지부터 확인하세요. `:stable`만 manifest에 남기는 배포는 immutable proof를 재현할 출발점이 없습니다. 다음으로 허용 signer·issuer를 **1~3개 release path**로 좁히고, nightly·prerelease·긴급 패치는 별도 identity로 분리합니다. 여러 identity를 한 allowlist에 섞으면 "왜 이 서명이 허용됐는가"를 나중에 설명하기 어렵습니다.

### 2) publish 파이프라인을 image push가 아닌 graph 완성으로 끝낸다

권장 순서는 `build → image digest 확정 → SBOM/provenance 생성 → sign/attest → source registry 조회 → mirror 복제 → target registry 조회 → deploy 승인`입니다. 핵심은 SBOM 파일을 CI artifact로만 저장하지 않는 것입니다. deployment policy가 참조할 subject digest에 attached artifact로 남기고, 각 단계에서 기대한 relation을 확인해야 합니다.

canary 기간에는 low-risk service 한 개를 선택해 target registry 기준으로 비교합니다. image와 required referrer의 복제 완료 p95가 **15분 이내**인지, referrer discovery 실패가 **0.1% 미만**인지, admission cache miss가 baseline보다 늘지 않는지를 48시간 이상 봅니다. 수치가 나쁘면 release를 태그 재시도로 덮지 말고 replication filter, artifact media type, registry 권한, mirror queue를 순서대로 분리합니다. tag가 보인다고 graph가 완성된 것은 아닙니다.

### 3) admission의 중단 기준과 rollback 예외를 명시한다

production의 정상 경로는 "현재 image digest에 대해 허용 provenance와 SBOM이 모두 있고, 검증 identity가 일치할 때만 allow"로 단순하게 시작할 수 있습니다. 단, 서비스 장애가 나서 급히 이전 digest로 되돌릴 때 동일 정책을 어떻게 적용할지를 runbook에 써야 합니다. 검증된 과거 release digest의 allow record를 **24시간** 정도 cache하고, cache 밖의 unknown digest는 emergency approval과 audit event 없이는 열지 않는 방식이 한 예입니다. 기간은 조직의 release 빈도·위험도에 맞춰야 합니다.

정책 rollout은 `observe → warn → enforce` 순서가 안전합니다. observe 동안에는 거절하지 않고, 누락된 predicate·issuer mismatch·referrer lookup failure를 reason code로 수집합니다. warn 단계에서 SRE와 release owner가 false positive를 분류한 뒤, production에서만 enforce로 올립니다. [정책 Shadow Rollout](/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/)처럼 정책 자체도 shadow 결과와 실제 결정의 차이를 관측해야 합니다.

### 4) GC는 tag 목록이 아니라 release graph를 기준으로 한다

"30일 지난 tag 삭제"만으로 registry를 청소하면 digest로 배포된 active release, rollback 후보, 연결된 SBOM·provenance를 잘못 지울 수 있습니다. 먼저 deploy record와 registry inventory에서 protected image digest 집합을 만들고, 그 subject의 required referrer를 closure로 확장합니다. 그 뒤에만 unreferenced artifact를 cleanup 후보로 둡니다. 삭제 전에는 candidate graph export를 보관하고, 작은 repository부터 dry-run으로 시작해야 합니다.

정책상 artifact를 image보다 오래 보관해야 할 수도 있습니다. 사고 조사·감사 기간에는 image layer를 cold tier로 옮겨도 provenance와 SBOM은 release record와 함께 남겨야 합니다. 반대로 관련된 이미지가 합법적으로 삭제됐다면 referrer만 무기한 쌓이지 않도록 owner·retention·legal hold를 붙입니다. 저장비 최적화는 증명 관계를 모르는 lifecycle job에 맡길 일이 아닙니다.

## 트레이드오프/주의점

1. **referrer graph는 저장·조회 비용을 늘린다.** 하지만 SBOM을 별도 위키나 CI 로그에 흩어 놓는 비용보다, release digest에 가까운 곳에서 관계를 확인하는 이점이 큰 경우가 많다.
2. **레지스트리 지원은 균일하지 않다.** API가 있어도 replication·UI·GC·proxy cache가 artifact media type을 같은 수준으로 다루는지 target registry에서 확인해야 한다.
3. **서명 identity는 코드 품질 보증이 아니다.** 허용된 workflow가 잘못된 dependency나 취약한 이미지를 만들 수 있으므로 scan, review, runtime policy를 대체하지 않는다.
4. **강한 admission은 가용성 비용이 있다.** registry 또는 identity provider 장애 때의 cache·hold·break-glass 절차가 없으면 보안 시스템이 복구를 방해할 수 있다.
5. **tag 정리는 graph 정리가 아니다.** 태그가 없어도 active deployment와 rollback이 digest를 참조할 수 있으며, attached metadata까지 함께 확인해야 한다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] production deployment record에 image tag뿐 아니라 immutable digest를 남긴다.
- [ ] required SBOM·provenance·signature가 같은 subject digest를 가리키는지 검사한다.
- [ ] source·mirror·runtime registry에서 referrer discovery와 artifact content를 각각 검증한다.
- [ ] signer/issuer/workflow/predicate/시간 조건을 release path별 policy로 문서화한다.
- [ ] admission lookup timeout, cache miss, unknown digest, emergency rollback의 행동을 환경별로 정했다.
- [ ] observe → warn → enforce의 reason code와 중단 기준이 있다.
- [ ] GC 전 protected release digest와 attached artifact의 graph export를 만든다.

### 연습

최근 배포한 컨테이너 하나를 골라 image digest를 먼저 확인한 뒤, 그 digest에 연결된 SBOM·provenance·signature를 찾는 순서를 작성해 보세요. 다음으로 같은 이미지를 mirror registry에 복제했을 때 네 artifact가 모두 보이는지 확인할 canary를 설계합니다. 마지막으로 target registry의 referrer 조회가 10분 동안 실패한다고 가정하고, 개발·staging·production·긴급 rollback이 각각 allow, warn, hold, deny 중 무엇을 해야 하는지 정리하세요. 이 답이 없으면 attestation은 발급하고 있어도 release lifecycle은 아직 운영하지 않는 상태입니다.

## 관련 글

- [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)
- [npm Trusted Publishing의 Release Path별 권한 모델](/posts/2026-09-05-npm-trusted-publishing-release-path-governance-trend/)
- [Publish-Time Supply Chain Gate와 Review Context Plane](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/)
- [정책 Shadow Rollout과 Agent Runtime](/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/)
- [CI/CD 보안: 공급망 공격 막기](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)
