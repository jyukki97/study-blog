---
title: "2026 개발 트렌드: npm Trusted Publishing은 한 개 OIDC 설정이 아니라 Release Path별 권한 모델이 된다"
date: 2026-09-05T10:06:00+09:00
lastmod: 2026-09-05T10:06:00+09:00
draft: false
tags: ["npm", "OIDC", "Trusted Publishing", "Software Supply Chain", "GitHub Actions", "Release Engineering"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["npm trusted publishing", "OIDC package publishing", "staged publishing", "release path governance", "npm malware scanning"]
description: "npm의 다중 trusted publisher와 staged publishing 변경을 바탕으로, 장기 publish token을 없애는 데서 그치지 않고 stable·prerelease·긴급 경로를 서로 다른 OIDC 권한과 승인 증거로 운영하는 기준을 정리합니다."
summary: "OIDC publish는 비밀값 회전을 줄이지만, 하나의 패키지에 publisher 설정을 여러 개 더하면 허용 경로도 함께 늘어난다. 최근 npm의 다중 trusted publisher와 scan 뒤 staged approval 흐름은 release를 한 개의 CI job이 아니라 서로 다른 위험도를 가진 경로들의 정책 집합으로 관리해야 한다는 신호다."
key_takeaways:
  - "npm은 2026년 9월 3일부터 패키지당 여러 trusted publisher 설정을 지원한다. 각 설정은 additive이며 하나라도 일치하면 허용되므로 설정 수는 곧 publish 공격 표면의 수다."
  - "새 trusted publisher는 기본적으로 stage만 허용하고 direct publish는 설정별 opt-in이다. malware scan 완료 뒤 사람의 stage approval을 거치는 경로를 기본값으로 두는 편이 안전하다."
  - "stable, prerelease, staging, break-glass를 하나의 범용 workflow·권한에 섞지 말고, artifact·environment·승인자·rollback 신호를 각 release path에 붙여야 한다."
  - "trusted publishing은 token 문제를 줄일 뿐, 태그 탈취, workflow injection, dependency confusion, 악성 artifact, 잘못된 버전 승인까지 자동으로 해결하지 않는다."
operator_checklist:
  - "패키지별 trusted publisher를 inventory로 만들고 repository, workflow filename, environment, allowed action, owner, 마지막 사용일을 기록한다."
  - "새 publisher는 stage-only로 시작하고, direct publish는 protected environment·artifact evidence·rollback owner가 있는 stable 경로에만 별도 승인한다."
  - "release workflow에는 `id-token: write`와 필요한 read 권한만 두고, third-party action은 full commit SHA로 pin한다."
  - "stage 승인 전에는 source tag, commit SHA, `npm pack` 결과, test·SBOM·provenance evidence, malware scan 완료 여부를 하나의 검토 화면에서 대조한다."
  - "publisher 설정 추가·삭제와 stage approve·reject를 release audit event로 수집하고, 장기 write token은 제거하거나 break-glass로 격리한다."
learning_refs:
  - title: "Publish-time 공급망 검토와 Release Context"
    href: "/posts/2026-07-30-publish-time-supply-chain-review-context-trend/"
    description: "배포 산출물이 어떤 소스·정책·검증 결과에서 나왔는지를 package publish 전까지 연결하는 관점입니다."
  - title: "Artifact Attestation과 Deployment Admission Gate"
    href: "/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/"
    description: "서명이나 attestation의 존재만 보지 않고 실제 배포 승인에 쓰는 방법을 다룹니다."
  - title: "CI/CD 보안과 공급망 방어"
    href: "/learning/deep-dive/deep-dive-cicd-security-supply-chain/"
    description: "workflow 권한, secret, action pinning을 release 경계에서 점검하는 기본기입니다."
  - title: "Config Change Safety와 Rollout"
    href: "/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/"
    description: "registry의 publisher 설정도 배포처럼 shadow·검증·rollback해야 하는 이유를 연결합니다."
---

패키지 publish는 보통 CI 마지막 줄의 `npm publish`로 보입니다. 그러나 오픈소스 또는 사내 공용 패키지에서 이 한 줄은 수많은 하위 의존성에 코드를 배포하는 권한입니다. 그래서 장기 npm token을 CI secret에 넣는 방식은 위험합니다. token이 로그·fork·의존성 스크립트·잘못된 권한을 통해 유출되면, 누가 어떤 release artifact를 publish하는지 분리하기 어렵고 회전도 운영 부담이 됩니다.

최근 npm은 이 흐름을 한 단계 더 밀었습니다. 2026년 9월 3일 GitHub Changelog은 패키지당 여러 trusted publishing(OIDC) 설정, malware scan 완료 뒤에만 가능한 staged package 승인, stage 이력 표시를 공개했습니다. npm 공식 문서는 한 패키지에 최대 10개의 trusted publisher를 둘 수 있고, GitHub Actions·GitLab CI/CD·CircleCI의 특정 workflow와 연결할 수 있다고 설명합니다. 중요한 사실은 다중 설정이 **서로를 제한하지 않고 additive**라는 점입니다. 들어온 OIDC token이 설정 중 하나와 맞으면 publish 또는 stage가 허용되며, 어떤 설정이 먼저 평가되는지에 기대서는 안 됩니다.

이 변경은 단순히 "OIDC도 쓸 수 있다"는 뉴스가 아닙니다. release를 stable, prerelease, staging, 긴급 대응처럼 위험도가 다른 경로로 나누고, 각 경로에 최소 권한과 증거를 붙일 수 있게 된 변화입니다. 다만 설정을 무작정 늘리면 한 개의 장기 token 대신 여러 개의 유효한 publish 입구를 만드는 셈이기도 합니다. 이 글은 [Publish-time 공급망 검토와 Release Context](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/), [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/), [CI/CD 보안과 공급망 방어](/learning/deep-dive/deep-dive-cicd-security-supply-chain/), [Config Change Safety와 Rollout](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/)의 다음 단계입니다.

참고한 공식 자료:

- [GitHub Changelog: Multiple trusted publishing configurations for npm](https://github.blog/changelog/2026-09-03-multiple-trusted-publishing-configurations-for-npm/)
- [npm Docs: Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)
- [GitHub Docs: GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect)

## 이 글에서 얻는 것

- OIDC trusted publishing이 장기 token과 무엇을 바꾸고, 무엇을 바꾸지 못하는지 구분합니다.
- 여러 publisher 설정을 stable·prerelease·staging·break-glass release path로 나누는 기준을 얻습니다.
- stage-only, scan, human approval, direct publish를 어떤 순서와 조건으로 둘지 정리합니다.
- registry 설정·workflow·artifact·승인 이력을 하나의 release evidence로 운영하는 체크리스트를 가져갑니다.

## 핵심 개념/이슈

### 1) OIDC는 '누가 publish할 수 있는가'를 secret에서 workload identity로 옮긴다

기존 방식은 CI가 `NPM_TOKEN` 같은 장기 credential을 환경 변수로 읽어 registry에 전달합니다. 이 방식은 단순하지만 token의 수명·복사본·권한 범위를 계속 관리해야 합니다. OIDC trusted publishing은 registry와 CI provider 사이에 신뢰 관계를 만들고, CI가 실행 시점에 짧은 수명의 서명된 identity token을 받아 npm에 제시하게 합니다. npm은 설정된 repository, workflow, environment 같은 조건에 토큰 claim이 맞을 때만 publish 경로를 허용합니다.

이 구조의 이점은 분명합니다.

- publish 권한을 가진 장기 token을 일반 CI secret에 보관하지 않아도 됩니다.
- 어느 workflow가 어떤 패키지를 publish했는지 identity 기준으로 좁힐 수 있습니다.
- workflow 파일이나 environment를 바꾼 경로는 registry 설정과 맞지 않아 실패하게 만들 수 있습니다.
- token 회전보다 publisher 설정 추가·삭제를 release policy 변경으로 검토할 수 있습니다.

하지만 OIDC token은 "신뢰된 workflow가 현재 실행 중"이라는 증명일 뿐입니다. 그 workflow가 공격받지 않았는지, release tag가 올바른 commit인지, 빌드 산출물에 악성 코드가 없는지, 사람이 잘못된 stage를 승인하지 않는지는 별도 문제입니다. 그래서 OIDC는 공급망 방어의 종착점이 아니라 **credential 경계를 좁히는 첫 계층**입니다.

### 2) 다중 publisher는 고가용성 기능이면서 권한 합집합이다

한 패키지에 stable publish, prerelease, staging을 모두 한 workflow에서 처리하면 권한 경계가 흐려집니다. 반대로 신뢰된 publisher 설정을 경로별로 나누면 운영 의도를 나타낼 수 있습니다. 그러나 npm의 동작은 deny rule이 아니라 allow rule의 합집합입니다.

```text
incoming OIDC identity
  ├─ stable-release.yml + production 환경과 일치 -> 허용 가능
  ├─ prerelease-stage.yml + prerelease 환경과 일치 -> 허용 가능
  └─ emergency-stage.yml + break-glass 환경과 일치 -> 허용 가능

설정 하나라도 일치하면 통과
→ 다른 설정이 더 엄격해도 서로 제한하지 않음
```

따라서 "stable 경로는 엄격하니 안전하다"는 결론은 틀릴 수 있습니다. 같은 패키지에 덜 엄격한 staging workflow가 direct publish를 허용하면 그것도 production registry에 쓰기 가능한 경로입니다. 패키지 settings의 publisher 목록은 CI 설정의 부속물이 아니라 **publish allowlist**로 취급해야 합니다.

실무에서는 npm이 허용하는 최대 10개를 목표로 삼지 말고, active publisher를 처음에는 2~4개 이하로 유지하는 것이 낫습니다. 더 늘어야 한다면 각 항목의 목적·owner·마지막 성공 release·direct/stage action을 inventory에 기록하고 90일 미사용 항목을 검토합니다. 사용하지 않는 구 publisher를 남겨 두는 것은 "나중에 필요할 수도 있는 백업"이 아니라 현재도 token을 발급받을 수 있는 release path일 수 있습니다.

### 3) Stage는 품질 보증이 아니라 사람이 검토할 시간을 만드는 격리 상태다

새 trusted publisher 설정은 기본으로 `npm stage publish`를 허용하고, direct `npm publish`는 설정별 opt-in입니다. npm은 staged package가 malware scan을 마친 뒤에만 승인할 수 있도록 바꿨습니다. 이 순서는 좋습니다. 자동 workflow가 잘못 동작하거나 취약한 action을 통해 악성 artifact가 만들어져도, 즉시 공개 registry version이 되는 것을 한 단계 늦출 수 있기 때문입니다.

그렇다고 scan 완료가 무해 판정이나 배포 승인은 아닙니다. malware scanner는 알려진 위협·정적 신호·정책을 검토하는 계층이고, 패키지 API가 의도치 않게 바뀌었는지, 번들에 비밀값이 포함됐는지, version이 올바른 tag에서 나왔는지, 라이선스가 맞는지는 별도 확인이 필요합니다. stage approval은 다음 질문에 답하는 human gate로 설계해야 합니다.

| 확인 항목 | 승인자가 보는 증거 | 승인 중단 조건 |
| --- | --- | --- |
| 소스 식별 | package version, Git tag, commit SHA, release PR | tag가 protected release commit과 다름 |
| artifact 동일성 | CI의 `npm pack` hash, tarball 파일 목록, SBOM/provenance | stage artifact와 검증 artifact hash 불일치 |
| build·test | 잠긴 dependency install, unit/integration 결과 | required test 또는 policy job 누락 |
| registry 상태 | malware scan 완료, stage 상태, 이전 version 이력 | scan 미완료·실패·설명 불가 경고 |
| 변경 의도 | changelog, breaking change 표기, rollback owner | release owner 또는 rollback 경로 부재 |

위 표의 숫자는 조직이 정해야 하지만, 초기 기준으로는 모든 신규 publisher를 30일간 stage-only로 운영하고, stable package는 stage 승인 1명 이상, 보안·기반 패키지는 owner 외 2인 검토를 둘 수 있습니다. 중요한 것은 승인자 수보다 승인자가 서로 다른 evidence를 보는지입니다. 같은 CI 로그만 두 사람이 확인하면 독립된 gate가 아닙니다.

### 4) Release path는 버전 문자열이 아니라 서로 다른 권한 계약이다

`1.4.0`, `1.5.0-rc.1`, `1.4.1-hotfix`는 같은 코드베이스에서 시작해도 배포 위험이 다릅니다. 이를 하나의 `publish.yml`의 조건문으로만 다루면 나중에 권한을 분리하기 어렵습니다. 아래처럼 경로별 계약을 먼저 만들면 다중 publisher의 목적이 선명해집니다.

| 경로 | OIDC publisher | registry action | environment·승인 | 되돌림 기준 |
| --- | --- | --- | --- | --- |
| prerelease | `prerelease-stage.yml` | stage-only | prerelease environment, 자동 test | scan·smoke 실패면 reject |
| stable | `stable-release.yml` | 처음에는 stage-only | protected production environment, artifact 검토 | 24시간 내 critical issue면 deprecate/rollback 공지 |
| emergency | `emergency-stage.yml` | stage-only | incident ID, on-call + owner 승인 | 원인·영향·후속 normal release 미기록 시 reject |
| 실험 패키지 | 별도 package 또는 scope | stage-only | sandbox registry/namespace | public promotion 금지 |

여기서 npm trusted publisher 설정에는 repository, workflow filename, 선택적 environment, 허용 action 같은 필드를 명시합니다. branch·tag 조건은 GitHub Actions workflow와 protected environment 쪽에서 강제합니다. 그러므로 registry 설정만 보고 "main branch에서만 publish된다"고 가정하지 말고, **registry settings와 workflow trigger, GitHub environment protection을 한 release contract로** 검토해야 합니다.

stable 경로가 충분히 성숙한 뒤 direct publish를 검토할 수는 있습니다. 그 경우에도 prerelease나 emergency publisher의 direct action까지 켜지 않으며, direct publish가 된 artifact의 source tag·hash·scan·attestation·rollback 책임자가 자동으로 남는지를 먼저 확인합니다. direct publish는 속도 최적화이지 기본 권한이 아닙니다.

## 실무 적용

### 1) 먼저 token과 publisher를 발견하고, 한 패키지로 canary한다

전 조직의 모든 패키지를 한 번에 전환하지 마세요. 다음 순서가 되돌리기 쉽습니다.

1. **inventory를 만듭니다.** 패키지, scope, 현재 publish workflow, long-lived token 위치, owner, 최근 version, rollback 방법을 적습니다. token 값은 문서에 복사하지 않습니다.
2. **위험이 낮은 패키지 하나를 고릅니다.** release 빈도가 있고, test와 owner가 있으며, 잘못된 version을 빠르게 deprecate할 수 있는 패키지가 적합합니다.
3. **stage-only trusted publisher를 추가합니다.** GitHub Actions라면 workflow에는 필요한 `id-token: write`와 최소 `contents: read`만 둡니다. 그 외 broad permission은 피합니다.
4. **같은 commit에서 artifact를 두 번 만들지 않게 합니다.** test·build 뒤 `npm pack` 결과와 hash를 보관하고, stage된 tarball이 그 evidence와 같은지 대조합니다.
5. **기존 token을 즉시 방치하지 않습니다.** OIDC stage canary가 성공한 뒤 token publish를 차단할 일정을 정하고, break-glass가 필요하면 별도 보관·만료·승인 정책으로 격리합니다.

GitHub Actions 예시는 의도를 드러내는 최소 모양으로 두는 편이 좋습니다.

```yaml
name: stage prerelease
on:
  push:
    tags: ["v*-rc.*"]

permissions:
  contents: read
  id-token: write

jobs:
  stage:
    environment: prerelease
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-commit-sha>
      - run: npm ci
      - run: npm test
      - run: npm run build --if-present
      - run: npm pack --json
      - run: npm stage publish
```

이 예시는 `id-token: write`가 꼭 필요하다는 점만 보여 줍니다. 실제 release workflow에는 pinned action SHA, dependency install policy, artifact 업로드 권한, package manager cache 사용 여부, network egress를 조직 정책에 따라 더 좁혀야 합니다. 특히 pull request에서 온 수정 코드가 privileged publish job에 도달하는 경로를 별도로 검사하세요.

### 2) Publisher configuration도 변경관리 대상으로 다룬다

trusted publisher 추가는 CI 파일 한 줄 변경이 아닙니다. registry 외부에 쓰기 가능한 identity를 새로 허용하는 설정 변경입니다. 그래서 code review, inventory 업데이트, 두 번째 운영자 확인, canary, 제거 계획을 갖춰야 합니다.

권장 audit record는 아래 정도입니다.

```yaml
package: "@example/parser"
publisher_id: "npm-settings-ref"
repository: "example/parser"
workflow: "stable-release.yml"
environment: "production"
allowed_action: "stage"
owner: "runtime-platform"
change_ref: "SEC-1842"
added_at: "2026-09-05T01:06:00Z"
last_success_at: null
review_after: "2026-12-05"
```

여기서 `allowed_action`을 `publish`로 바꾸는 일은 stage publisher를 새로 넣는 것보다 위험도가 높습니다. 변경 전에는 해당 workflow가 어떤 tag·branch·manual dispatch에서 실행되는지, environment approval이 실제로 걸리는지, package version이 CI가 검증한 source에서 만들어지는지, 긴급 rollback owner가 누구인지 대조합니다. 90일 무사용 publisher 정리도 삭제 실수로 보지 말고, 먼저 stage-only disable 또는 change window를 거쳐 수행하면 안전합니다.

### 3) 지표는 publish 성공률보다 '경계가 실제로 작동했는가'를 보여야 한다

릴리스 pipeline의 초록색 비율만 보면 정책이 너무 약해도 성공처럼 보입니다. 최소 대시보드는 아래처럼 구성할 수 있습니다.

| 지표 | 권장 해석 | 주의 신호 |
| --- | --- | --- |
| `active_trusted_publishers` | package별 유효 publish 입구 수 | owner 없는 증가, 4개 초과 검토 |
| `staged_to_approved_lead_time_p95` | 검토 병목과 release window | 급격한 지연은 승인 인력 또는 scan 의존성 확인 |
| `stage_rejected_total` | human gate가 실제로 잡은 사례 | 0이 목표가 아니라 reason 분류가 목표 |
| `direct_publish_total` | 자동 공개 배포 범위 | stable 외 publisher에서 발생하면 즉시 조사 |
| `token_publish_attempt_total` | 장기 token 제거 진척도 | 전환 뒤에도 성공하면 policy gap |
| `publisher_config_change_total` | 권한 표면 변화 | release와 무관한 급증, owner 미지정 |

`stage_rejected_total`이 0이라고 해서 성숙한 pipeline은 아닙니다. 반대로 reject가 늘었다고 실패도 아닙니다. scan 미완료, version conflict, missing artifact, policy violation, 사람의 판단 변경을 분리해야 운영 개선점을 찾을 수 있습니다. 이 기록은 [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)에서 다룬 것처럼 "서명이 있나"보다 "어떤 evidence로 거절·승인했나"를 보여 주는 자료가 됩니다.

## 트레이드오프/주의점

첫째, publisher를 나누면 least privilege가 좋아지지만 설정 drift가 생깁니다. workflow filename을 바꿨는데 registry 설정을 지우지 않거나, repository를 옮겼는데 이전 publisher를 남기는 식입니다. settings는 기존 연결을 수정하지 못하고 삭제 후 재생성해야 하는 경우가 있으므로, 변경 전후에 inventory와 실제 npm settings를 대조해야 합니다. 이름이 비슷한 workflow를 새로 만들었다고 기존 권한이 저절로 좁아지지 않습니다.

둘째, stage approval은 릴리스 속도를 늦춥니다. 새 버전을 자주 내는 라이브러리에서 모든 prerelease를 두 명이 손으로 승인하면 병목이 됩니다. 해결책은 모든 gate를 없애는 것이 아니라 위험도를 나누는 것입니다. prerelease는 stage-only 자동 검증과 짧은 승인 window, stable은 release owner의 artifact 검토, 긴급은 incident ID와 사후 review처럼 경로별로 비용을 다르게 둡니다.

셋째, OIDC 환경 지원 범위를 확인해야 합니다. npm 문서 기준 trusted publishing은 특정 hosted CI 환경을 전제로 하며, self-hosted runner는 현재 지원 대상이 아닙니다. 지원하지 않는 runner 때문에 기존 token을 무기한 예외로 남기지 말고, 지원되는 release runner로 분리할지, private registry·deploy key·break-glass 절차를 어떤 만료 조건으로 둘지 결정해야 합니다.

넷째, malware scan과 provenance는 유용하지만 release review를 대체하지 않습니다. 이름이 비슷한 dependency, 정상 동작처럼 보이는 데이터 유출, source와 artifact의 불일치, 문서에 없는 breaking change는 별도 검토가 필요합니다. 특히 publish 권한이 있는 workflow에서는 untrusted PR code, broad `GITHUB_TOKEN`, branch 이름만 믿는 trigger, mutable action tag가 합쳐지지 않게 해야 합니다.

## 체크리스트 또는 연습

### 패키지 release path 체크리스트

- [ ] 패키지마다 현재 long-lived token, trusted publisher, repository, workflow, environment, allowed action, owner를 inventory로 보관한다.
- [ ] publisher는 필요 최소 수로 유지하며, 하나라도 매칭되면 허용되는 additive 규칙을 review checklist에 넣었다.
- [ ] 새 publisher는 `stage`만 허용하고 direct `publish`는 별도 risk review 뒤 stable 경로에만 켠다.
- [ ] GitHub Actions release job은 `id-token: write`와 최소 read permission만 쓰며 action ref는 full commit SHA로 고정했다.
- [ ] stage approval 전에 source tag·commit·artifact hash·test·SBOM/provenance·malware scan 완료를 대조한다.
- [ ] direct publish, token publish attempt, publisher config change는 package·workflow·actor와 함께 audit한다.
- [ ] 30일 canary 뒤 기존 token publish 접근을 막거나, break-glass exception에 owner·만료·사용 기록을 붙였다.
- [ ] 90일 동안 사용하지 않은 publisher는 영향 확인 뒤 disable/remove review 대상으로 올린다.

### 연습: 하나의 패키지를 네 경로로 분리하기

현재 `publish.yml` 하나로 `npm publish`하는 패키지를 골라 아래 표를 채워 보세요.

1. stable, prerelease, emergency, experiment 중 실제로 필요한 경로만 고르고 각 경로의 workflow filename과 GitHub environment를 정합니다.
2. 각 경로에서 `stage`와 direct `publish` 중 무엇을 허용할지 선택합니다. 초기에는 direct publish를 모두 끈 뒤, 30일의 stage evidence를 보고 stable만 승격하는 결정을 적습니다.
3. 승인자가 보는 artifact hash·commit SHA·scan 상태·rollback owner를 한 release receipt에 모읍니다.
4. publisher 하나가 탈취됐다고 가정하고, 그 경로가 어떤 version을 공개할 수 있는지와 registry·GitHub 양쪽에서 즉시 끄는 순서를 연습합니다.

## 관련 글

- [Publish-time 공급망 검토와 Release Context](/posts/2026-07-30-publish-time-supply-chain-review-context-trend/)
- [Artifact Attestation과 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)
- [CI/CD 보안과 공급망 방어](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)
- [Config Change Safety와 Rollout](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/)
