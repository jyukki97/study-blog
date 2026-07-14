---
title: "2026 개발 트렌드: License Policy Gate, 오픈소스 라이선스 검토가 PR 머지 조건으로 들어온다"
date: 2026-07-14T10:06:00+09:00
draft: false
tags: ["Open Source", "License Compliance", "Supply Chain Security", "GitHub", "Dependency Governance", "Platform Engineering"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["open source license compliance", "license policy gate", "dependency review", "GitHub Advanced Security", "OSPO"]
description: "GitHub의 Open Source License Compliance 공개 프리뷰를 계기로, 오픈소스 라이선스 검토가 사후 법무 검토에서 PR 단계의 정책 게이트로 이동하는 흐름을 정리합니다."
lastmod: 2026-07-14
summary: "의존성 라이선스 관리는 더 이상 릴리스 직전 체크리스트가 아닙니다. PR에서 직접·전이 의존성의 라이선스를 정책과 비교하고, 예외 승인과 ruleset을 통해 머지를 제어하는 흐름으로 이동하고 있습니다."
key_takeaways:
  - "GitHub의 License Compliance 공개 프리뷰는 라이선스 검토를 dependency review와 ruleset 기반 merge gate로 끌어올리는 신호다."
  - "실무 핵심은 허용 라이선스 목록보다 Evaluate→Active 전환, 예외 SLA, package-specific exception, break-glass 절차다."
  - "AI와 dependency bot이 의존성 변경량을 늘릴수록 보안 취약점뿐 아니라 라이선스 의무도 자동 검토 경계 안에 들어와야 한다."
operator_checklist:
  - "의존성 변경 PR에서 direct/transitive license diff, package exception, policy decision을 볼 수 있게 한다."
  - "Evaluate mode로 2~4주 관측한 뒤 alert 패턴과 예외 SLA가 안정되면 Active mode로 일부 repo부터 전환한다."
  - "MIT/Apache-2.0/BSD 계열 같은 permissive baseline과 GPL/AGPL/SSPL/unknown/missing license 대응 기준을 법무·OSPO와 합의한다."
  - "긴급 보안 패치용 break-glass는 owner, expiry, 후속 리뷰 이슈 없이 열지 않는다."
learning_refs:
  - title: "npm v12 Install-Time Trust Gate"
    href: "/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/"
    description: "설치 시점 실행 권한을 allowlist와 CI 정책으로 통제하는 흐름입니다."
  - title: "Package Release Quarantine Gate"
    href: "/posts/2026-05-12-package-release-quarantine-gate-trend/"
    description: "새 패키지 릴리스를 즉시 신뢰하지 않고 격리 검증하는 운영 모델입니다."
  - title: "Dependency Update Pipeline"
    href: "/posts/2026-05-07-dependency-update-pipeline-trend/"
    description: "의존성 업데이트를 테스트·보안·롤백 기준과 연결하는 흐름입니다."
  - title: "CI/CD 보안과 공급망"
    href: "/learning/deep-dive/deep-dive-cicd-security-supply-chain/"
    description: "CI runner, 토큰, dependency review, 공급망 방어 기준을 다룹니다."
decision_guide:
  title: "License Policy Gate를 어디부터 적용할까"
  intro: "모든 저장소를 첫날부터 block하면 개발 흐름이 막힙니다. 의존성 변경 빈도, 제품 배포 형태, 라이선스 리스크를 기준으로 단계 적용하는 편이 안전합니다."
  cases:
    - badge: "즉시 적용"
      title: "상용 배포물에 third-party dependency가 포함된다"
      fit: "고객에게 배포되는 SaaS, on-prem 제품, 모바일 앱, SDK, appliance 이미지입니다."
      watchouts: "전이 의존성의 copyleft/unknown license가 뒤늦게 발견되면 교체 비용이 큽니다."
      next_step: "Evaluate mode로 alert 분포를 보고, 핵심 repo부터 Active mode ruleset을 겁니다."
    - badge: "단계 적용"
      title: "내부 서비스지만 dependency bot PR이 많다"
      fit: "Dependabot/Renovate와 AI 코드 생성이 자주 의존성을 바꾸는 조직입니다."
      watchouts: "보안 패치 자동화가 라이선스 예외를 조용히 늘릴 수 있습니다."
      next_step: "보안 update pipeline에 license diff와 exception owner를 추가합니다."
    - badge: "관측 우선"
      title: "개인/학습용 repo 또는 배포물이 없는 실험 코드"
      fit: "외부 배포와 고객 납품이 없는 낮은 위험 저장소입니다."
      watchouts: "나중에 제품 코드로 승격될 때 라이선스 부채가 따라올 수 있습니다."
      next_step: "block은 보류하되 license inventory와 unknown license 비율을 기록합니다."
faqs:
  - question: "보안 취약점 스캔과 라이선스 컴플라이언스는 같은 문제인가요?"
    answer: "같은 공급망 표면을 보지만 판단 기준은 다릅니다. 취약점은 악용 가능성과 패치 우선순위를 보고, 라이선스는 사용·배포·수정·고지 의무와 조직 정책 적합성을 봅니다."
  - question: "MIT, Apache-2.0만 허용하면 충분한가요?"
    answer: "시작점으로는 좋지만 충분조건은 아닙니다. 제품 형태, 배포 방식, 고객 계약, 고지 의무, package-specific exception을 함께 봐야 합니다."
---

2026년 6월 30일 GitHub는 Open Source License Compliance 공개 프리뷰를 발표했습니다. 핵심은 의존성 라이선스 검토를 "릴리스 전 법무 체크"가 아니라 **pull request 단계의 정책 게이트**로 끌어오는 것입니다. GitHub 설명에 따르면 이 기능은 dependency review를 확장해 enterprise-wide license policy와 ruleset 조건을 붙이고, package manifest가 바뀌는 PR에서 직접·전이 의존성의 라이선스를 정책과 비교합니다. Active mode에서는 위반이 해결될 때까지 머지를 막고, Evaluate mode에서는 주석만 달아 전환 기간을 줄 수 있습니다.

이 변화는 단순한 GitHub 기능 추가로만 보면 작게 보입니다. 하지만 2026년 개발 흐름에서는 꽤 큰 신호입니다. AI 코딩 에이전트, dependency bot, template generator가 의존성 변경량을 늘리고 있고, npm v12는 install script 기본 차단으로 설치 시점 실행 경계를 좁히고 있습니다. 이제 팀은 "취약점이 있는가"뿐 아니라 "이 라이선스 의무를 우리 제품이 감당할 수 있는가"를 코드 리뷰 루프 안에서 봐야 합니다. 저는 이 흐름을 **License Policy Gate**라고 부르겠습니다.

이 글은 [npm v12 Install-Time Trust Gate](/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/), [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/), [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)과 이어집니다. 이전 글들이 "어떤 패키지를 언제 설치·검증할 것인가"를 다뤘다면, 이번 글은 "그 패키지를 우리 제품에 넣어도 되는가"를 정책과 예외 승인으로 다룹니다.

참고 신호:

- GitHub Changelog, Open source license compliance public preview: https://github.blog/changelog/2026-06-30-open-source-license-compliance-is-in-public-preview/
- GitHub Docs, About open source license compliance: https://docs.github.com/en/code-security/concepts/supply-chain-security/open-source-license-compliance
- GitHub Docs, Configuring open source license policies: https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-license-policies
- GitHub Blog, How GitHub maintains compliance for open source dependencies: https://github.blog/enterprise-software/governance-and-compliance/how-github-maintains-compliance-for-open-source-dependencies/

## 이 글에서 얻는 것

- 오픈소스 라이선스 검토가 왜 사후 문서 작업에서 PR merge gate로 이동하는지 이해합니다.
- license policy, ruleset, Evaluate/Active mode, package exception, break-glass를 실무 운영 단위로 나눌 수 있습니다.
- dependency update, AI 생성 코드, 보안 패치 자동화가 라이선스 리스크와 어떻게 연결되는지 판단할 수 있습니다.
- 처음 4~6주 동안 어떤 숫자로 관측하고, 언제 block 모드로 전환할지 기준을 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) 라이선스 리스크는 보안 취약점과 다르지만 같은 PR에서 들어온다

의존성 변경 PR은 여러 위험을 동시에 가져옵니다. 새 버전이 취약할 수 있고, maintainer가 바뀌었을 수 있고, install script가 추가됐을 수 있고, 라이선스가 조직 정책과 맞지 않을 수 있습니다. 보안 스캔은 CVE와 악성 패키지를 보지만, 라이선스 컴플라이언스는 사용 조건과 배포 의무를 봅니다.

예를 들어 MIT나 Apache-2.0 계열은 많은 상용 제품에서 다루기 쉽습니다. 반대로 GPL/AGPL 계열은 제품 배포 방식과 결합될 때 소스 공개 의무나 네트워크 사용 조건 검토가 필요할 수 있습니다. SSPL, BUSL, custom commercial license, missing license, dual license도 그냥 "오픈소스"라는 이름으로 넘기기 어렵습니다. 정확한 법률 판단은 조직의 법무/OSPO가 해야 하지만, 개발팀이 해야 할 일은 **검토가 필요한 변경을 머지 전에 드러내는 것**입니다.

License Policy Gate의 가치는 여기 있습니다. 개발자가 의존성을 추가한 순간 PR에서 direct/transitive license diff를 보고, 허용 목록에 없으면 제거, 대체, 예외 요청, 정책 수정 중 하나를 선택하게 만듭니다. 이 과정이 릴리스 직전이나 고객 납품 직전에 나오면 이미 늦습니다.

### 2) 전이 의존성이 진짜 운영 난이도를 만든다

직접 추가한 패키지는 사람이 비교적 쉽게 봅니다. 문제는 transitive dependency입니다. 프론트엔드 build tool 하나가 수백 개 패키지를 끌어오고, Java/Spring 프로젝트도 BOM이나 starter가 여러 license를 함께 가져옵니다. Python, Go, Rust, JVM, JavaScript가 섞인 monorepo에서는 한 PR이 여러 생태계의 license graph를 동시에 바꿉니다.

그래서 license check는 package manifest 변경을 기준으로 직접·전이 의존성을 모두 봐야 합니다. GitHub Docs도 pull request가 manifest를 바꾸면 dependency changes를 비교하고, dependency graph에서 감지한 transitive dependencies까지 license evaluation에 사용한다고 설명합니다. 이 점은 [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/)에서 말한 "버전 업데이트 PR은 작은 배포 이벤트"라는 관점과 같습니다.

운영 지표도 필요합니다.

| 지표 | 목표 |
| --- | --- |
| unknown/missing license 비율 | 핵심 repo 1% 이하 |
| license exception 평균 처리 시간 | 업무 시간 기준 4~8시간 이내 |
| Evaluate mode alert 중 실제 block 후보 | 2~4주 관측 후 분류 |
| package-specific exception owner 누락 | 0건 |
| emergency override 사용 | 월 0~1건 이하 |

숫자는 조직마다 다르지만, "알림이 있다"보다 "처리 가능한 흐름이 있다"가 중요합니다.

### 3) Evaluate mode는 장식이 아니라 전환 장치다

처음부터 모든 repo에서 Active mode로 막으면 개발팀은 게이트를 우회하려 합니다. 특히 기존 코드베이스는 오래된 dependency, license metadata 누락, private package, vendored source가 섞여 있을 수 있습니다. 그래서 Evaluate mode가 중요합니다. Evaluate mode는 PR에 annotation을 달지만 merge를 막지 않아, alert 패턴과 false positive를 먼저 볼 수 있습니다.

GitHub의 자체 운영 사례도 이 방향을 보여줍니다. GitHub OSPO는 먼저 permissive license 목록을 seed policy로 두고, 조직 단위 Evaluate mode로 개발자가 새 workflow에 익숙해지게 했으며, 약 한 달 병행 운영 뒤 unusual/missing/disallowed license 중심으로 alert가 정리됐다고 설명합니다. 이 방식은 실무적으로도 합리적입니다.

권장 rollout:

1. **1주차: inventory**  
   상위 20개 repo의 dependency graph, license 분포, unknown license를 뽑습니다.

2. **2~4주차: Evaluate mode**  
   PR annotation만 달고, alert 종류와 처리 시간을 측정합니다.

3. **5주차: policy 정리**  
   permissive baseline, 금지 license, 검토 license, package exception 기준을 합의합니다.

4. **6주차: Active mode 일부 적용**  
   배포물에 포함되는 핵심 repo 3~5개부터 block을 겁니다.

5. **이후: repo class 확장**  
   제품, 내부 서비스, 실험 repo를 custom property나 label로 나눠 적용 강도를 다르게 둡니다.

이 흐름은 [Code Quality Gate](/posts/2026-06-25-code-quality-policy-gate-trend/)와도 닮았습니다. 품질이든 라이선스든 처음부터 완벽한 block보다 shadow/evaluate로 조직의 실제 분포를 봐야 합니다.

### 4) 예외 승인이 없으면 정책은 곧 병목이 된다

라이선스 정책은 허용/차단 목록만으로 끝나지 않습니다. 예외 요청이 반드시 생깁니다. 어떤 패키지는 license metadata가 잘못됐을 수 있고, 어떤 commercial package는 특정 팀이 계약을 맺었을 수 있고, 어떤 copyleft dependency는 CLI 도구처럼 배포물에 포함되지 않아 허용 가능할 수도 있습니다.

그래서 예외는 자유 텍스트 댓글이 아니라 구조화된 요청이어야 합니다.

```yaml
license_exception_request:
  package: "example-lib"
  version_range: ">=2.1.0 <3.0.0"
  detected_license: "GPL-3.0-only"
  usage: "build-time code generator"
  distributed_with_product: false
  requesting_repo: "commerce-api"
  owner: "platform-commerce"
  requested_by: "dev-123"
  risk_note: "not shipped in runtime image"
  expiry: "2026-10-14"
  approver: "ospo-license-review"
```

실무 기준:

- license 자체를 전사 허용할지, 특정 package만 예외로 둘지 구분한다.
- 예외에는 owner와 expiry를 둔다.
- runtime dependency와 build/test-only dependency를 분리한다.
- 고객 배포물, SDK, container image에 포함되는지 확인한다.
- 예외 승인 SLA를 둔다. 예: 업무 시간 8시간, 긴급 보안 패치 1시간 triage

예외 처리 흐름이 없으면 개발자는 정책을 "일을 막는 시스템"으로 봅니다. 반대로 예외가 너무 느슨하면 정책은 장식이 됩니다. 균형점은 **빠른 검토, 좁은 예외, 만료일, 감사 로그**입니다.

### 5) AI와 dependency bot은 license gate 필요성을 키운다

예전에는 의존성 추가가 비교적 의도적인 작업이었습니다. 이제는 다릅니다. AI coding agent가 예제를 보고 package를 추가하고, dependency bot이 multi-ecosystem update를 열고, 템플릿 도구가 starter dependency를 자동으로 넣습니다. 사람 리뷰어는 모든 transitive license를 손으로 볼 수 없습니다.

이 상황에서 license gate는 개발자를 불신하는 장치가 아니라, 리뷰어가 볼 수 없는 그래프를 기계가 먼저 펼쳐 주는 장치입니다. 특히 AI가 만든 PR은 "코드가 컴파일된다"만으로 충분하지 않습니다. 새 의존성이 들어왔는지, 설치 시점 실행이 생겼는지, 라이선스 의무가 바뀌었는지까지 evidence에 들어가야 합니다. 이 관점은 [Agentic PR Governance](/posts/2026-05-25-agentic-pr-governance-trend/)와 [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)의 의존성 버전이라고 볼 수 있습니다.

## 실무 적용

### 1) license policy를 세 계층으로 나눈다

처음 policy는 너무 복잡하지 않게 시작합니다.

| 계층 | 예시 | 처리 |
| --- | --- | --- |
| allow baseline | MIT, Apache-2.0, BSD-2/3-Clause, ISC | 자동 허용, 고지 의무는 별도 문서화 |
| review required | MPL, EPL, LGPL, custom, dual license | OSPO/법무 검토 |
| deny by default | AGPL, SSPL, unknown/missing, prohibited commercial terms | 예외 승인 전 block |

이 표는 법률 자문이 아니라 운영 출발점입니다. 실제 허용 여부는 제품 형태와 조직 정책에 따라 달라집니다. 중요한 것은 개발자가 PR에서 "왜 막혔는지"와 "무엇을 제출해야 하는지"를 바로 알 수 있게 하는 것입니다.

### 2) dependency update PR 템플릿에 license diff를 넣는다

의존성 변경 PR에는 최소 아래 정보가 있어야 합니다.

```yaml
dependency_change_evidence:
  changed_manifests:
    - package.json
    - pnpm-lock.yaml
  direct_dependencies_added:
    - name: "new-search-client"
      license: "Apache-2.0"
  transitive_license_changes:
    - license: "LGPL-2.1-only"
      packages:
        - "native-helper"
  install_scripts_changed: true
  license_policy_decision: "review_required"
  exception_request: "licreq_20260714_001"
```

이 증거는 [npm v12 Install-Time Trust Gate](/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/)의 allowlist diff와 같이 봐야 합니다. license는 허용되지만 install script가 위험할 수 있고, install script는 없지만 license가 정책과 안 맞을 수 있습니다. 둘은 같은 PR에서 같이 검토해야 합니다.

### 3) Active mode 전환 조건을 숫자로 둔다

아래 조건을 만족하면 Active mode 전환 후보로 볼 수 있습니다.

- Evaluate mode 2~4주 운영 완료
- license alert 중 false positive 또는 metadata 보정 후보가 20% 이하
- exception reviewer가 지정되어 있고 평균 triage 시간이 1영업일 이하
- allow/review/deny policy가 문서화되어 있음
- 긴급 보안 패치용 break-glass 절차가 있음
- 핵심 repo의 unknown license backlog가 10건 이하 또는 owner 지정 완료

처음부터 모든 repo를 켜지 말고 제품 배포물에 포함되는 repo, 고객에게 전달되는 SDK, container image를 만드는 repo부터 켭니다. 내부 실험 repo는 Evaluate를 유지해도 됩니다.

### 4) break-glass는 열어두되 작게 만든다

긴급 보안 패치를 막는 license gate는 현실적으로 위험할 수 있습니다. 그래서 break-glass가 필요합니다. 다만 break-glass는 "끄고 나중에 보자"가 아니라 임시 예외 레코드여야 합니다.

필수 필드:

- 어떤 repo/ruleset을 언제까지 우회하는가
- 어떤 PR과 보안 패치 때문에 필요한가
- 승인자는 누구인가
- 후속 license review issue는 무엇인가
- 우회 중 merge된 dependency diff는 무엇인가

GitHub의 사례도 custom property를 바꿔 ruleset enforcement를 임시로 우회할 수 있음을 설명하지만, 드물게 쓰는 긴급 절차로 둡니다. 운영 기준으로는 월 1회 이상 break-glass가 반복되면 정책이 너무 넓거나 예외 SLA가 느린 것입니다.

### 5) 고지와 SBOM까지 연결한다

license gate가 merge만 막고 끝나면 반쪽입니다. 허용된 오픈소스도 고지 의무와 SBOM 반영이 필요할 수 있습니다. release pipeline에는 다음을 연결합니다.

- release artifact별 dependency/SBOM 생성
- third-party notices 업데이트
- package exception과 release version 연결
- container image와 SDK에 포함된 dependency 범위 확인
- 고객 납품 문서에 필요한 license notice 반영

이 흐름은 [AI Code Provenance와 SBOM](/posts/2026-03-08-ai-code-provenance-and-sbom-trend/)과도 이어집니다. "머지해도 되는가"와 "배포물에 무엇이 들어갔는가"는 다른 질문이지만, 같은 dependency graph를 기반으로 답해야 합니다.

## 트레이드오프/주의점

첫째, 라이선스 정책을 너무 보수적으로 잡으면 개발 속도가 느려집니다. 모든 copyleft 계열을 무조건 금지하면 안전해 보이지만, build-time tool이나 내부 테스트 도구까지 막아 불필요한 마찰이 생길 수 있습니다. runtime 배포물, build-time, test-only, dev-only를 분리해야 합니다.

둘째, license metadata는 완벽하지 않습니다. 패키지의 `license` 필드가 비어 있거나 잘못됐거나, 여러 라이선스 파일이 섞여 있을 수 있습니다. 이때 자동 도구 결과를 최종 법률 판단처럼 쓰면 안 됩니다. 자동화는 triage를 빠르게 만들고, 애매한 건 사람 검토로 올리는 역할입니다.

셋째, 예외가 늘어나면 정책은 흐려집니다. 예외는 package, version range, repo, usage, expiry를 좁게 둬야 합니다. 전사 예외는 정말 같은 조건이 반복될 때만 열어야 합니다.

넷째, dependency bot과 AI agent PR에는 더 강한 증거가 필요합니다. 사람이 직접 선택한 dependency보다 자동화가 넣은 dependency는 의도 설명이 약할 수 있습니다. 새 dependency가 들어오면 "왜 필요한가", "대체재는 봤는가", "license/install/provenance check는 통과했는가"를 PR evidence로 요구합니다.

다섯째, 법무/OSPO가 병목이 되면 gate는 실패합니다. 검토 팀이 작다면 모든 alert를 직접 보지 말고 permissive baseline, package namespace exception, repo risk class, emergency path를 설계해야 합니다. 정책은 중앙에서 만들되, 낮은 위험 변경은 빠르게 지나가게 해야 합니다.

의사결정 우선순위는 **고객 배포물 리스크 > copyleft/unknown license > 전이 의존성 변화 > install-time execution > 개발 편의** 순서로 두는 편이 안전합니다. 개발 편의가 중요하지 않다는 뜻이 아니라, 늦게 발견되는 라이선스 리스크의 교체 비용이 훨씬 크다는 뜻입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 핵심 repo의 direct/transitive dependency license inventory가 있다.
- [ ] allow/review/deny license baseline이 법무 또는 OSPO와 합의되어 있다.
- [ ] package manifest 변경 PR에 license diff와 policy decision이 노출된다.
- [ ] Evaluate mode와 Active mode 적용 repo가 custom property 또는 label로 구분된다.
- [ ] package-specific exception에는 owner, usage, version range, expiry가 있다.
- [ ] 긴급 보안 패치용 break-glass 절차와 후속 review SLA가 있다.
- [ ] release artifact의 SBOM/third-party notice와 license gate 결과가 연결된다.

### 연습

1. 제품 repo 하나를 골라 최근 30일 의존성 변경 PR을 10개 확인하세요. 새 direct dependency, transitive license change, unknown license가 몇 건인지 표로 적습니다.
2. 조직의 기본 허용 license 5개, 검토 필요 license 5개, 기본 차단 license 5개를 정하고 이유를 한 줄씩 붙여 보세요.
3. `security patch PR`이 금지 license alert로 막힌 상황을 가정하고, break-glass 승인 필드와 후속 issue 템플릿을 작성해 보세요.
4. dependency bot PR 템플릿에 `license_diff`, `install_script_diff`, `exception_ref`, `release_notice_needed` 네 필드를 추가한다고 가정하고 리뷰 흐름을 설계해 보세요.

오늘의 결론은 단순합니다. 오픈소스 라이선스 검토는 개발 속도를 늦추는 사후 행정이 아니라, 의존성 변경을 제품에 받아들일지 결정하는 운영 게이트가 되고 있습니다. AI와 자동화가 dependency graph를 더 빨리 바꿀수록, 라이선스 정책도 사람이 기억하는 규칙이 아니라 PR에서 실행되는 계약이어야 합니다.
