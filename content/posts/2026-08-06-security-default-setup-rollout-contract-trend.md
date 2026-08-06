---
title: "2026 개발 트렌드: Security Default Setup Rollout, 보안 스캔도 중앙 설정과 점진 적용이 필요하다"
date: 2026-08-06T10:06:00+09:00
lastmod: 2026-08-06T10:06:00+09:00
draft: false
tags: ["GitHub", "CodeQL", "Code Scanning", "Code Quality", "Application Security", "Platform Engineering"]
categories: ["Development", "Security", "Platform Engineering"]
series: ["dev-trends"]
keywords: ["code scanning default setup", "CodeQL configuration", "security default rollout", "GitHub Code Quality", "application security governance"]
description: "GitHub의 code scanning default setup 중앙 설정, Code Quality coverage 자동 생성, CodeQL 업데이트를 바탕으로 보안 스캔 운영이 repo별 워크플로에서 중앙 기본값과 rollout 계약으로 이동하는 흐름을 정리합니다."
summary: "보안 스캔은 이제 각 저장소가 개별 workflow를 복사해 붙이는 작업에서 벗어나고 있습니다. 중앙 CodeQL 설정, repository property, coverage 자동 PR, CodeQL 버전 변화가 묶이면서 플랫폼팀은 기본값, override, rollout, false positive, 비용을 하나의 운영 계약으로 다뤄야 합니다."
key_takeaways:
  - "Code scanning default setup에 중앙 CodeQL config를 병합할 수 있게 되면서 AppSec 기본값은 repo별 workflow가 아니라 조직 정책 아티팩트가 된다."
  - "Code Quality의 coverage workflow 자동 생성은 설정 장벽을 낮추지만, coverage 숫자가 테스트 품질을 보장한다고 착각하면 안 된다."
  - "CodeQL query와 언어 지원이 바뀌면 finding volume도 바뀔 수 있으므로, 스캐너 버전 업데이트를 운영 이벤트로 봐야 한다."
  - "보안 스캔 rollout은 전 repo hard fail보다 repo tier, evaluate mode, false-positive 예산, exception ledger를 먼저 둬야 지속된다."
operator_checklist:
  - "중앙 CodeQL config owner, 변경 리뷰어, rollout 대상 repo tier, override 가능 key를 문서화한다."
  - "새 default setup은 5~10개 repo에서 7일 이상 evaluate mode로 scan success, finding delta, Actions 비용을 본다."
  - "coverage 자동 PR은 least-privilege workflow, 테스트 명령 정확성, flaky rate, diff coverage 기준을 리뷰한다."
  - "CodeQL 버전 변경 후 high/critical finding 증가율과 false positive 샘플을 release note와 함께 검토한다."
learning_refs:
  - title: "Code Quality Policy Gate"
    href: "/posts/2026-06-25-code-quality-policy-gate-trend/"
    description: "코드 품질과 coverage를 merge 정책으로 올리는 기준입니다."
  - title: "AI Security Review Control Loop"
    href: "/posts/2026-07-15-ai-security-review-control-loop-trend/"
    description: "AI 보안 탐지, CodeQL, autofix, 사람 승인을 분리하는 흐름입니다."
  - title: "Security Triage Context Plane"
    href: "/posts/2026-07-08-security-triage-context-plane-trend/"
    description: "보안 finding을 owner와 우선순위가 있는 대응 큐로 바꾸는 기준입니다."
  - title: "CI Runner Version Floor"
    href: "/posts/2026-07-24-ci-runner-version-floor-trend/"
    description: "CI 실행면, Code Quality 비용, runner patch SLO를 함께 보는 글입니다."
decision_guide:
  title: "Security Default Setup을 어디까지 중앙화할까"
  intro: "중앙 설정은 보안 baseline을 빠르게 올리지만, 모든 repo에 같은 강도를 강제하면 false positive와 비용이 먼저 터질 수 있습니다."
  cases:
    - badge: "Central baseline"
      title: "여러 repo에 CodeQL workflow가 제각각이다"
      fit: "언어와 프레임워크는 다양하지만 최소 보안 baseline을 맞춰야 하는 조직"
      watchouts: "중앙 config가 깨지면 여러 repo scan이 동시에 실패할 수 있다."
      next_step: "공통 query suite와 exclude 정책을 중앙 repo에 두고 5개 repo에서 먼저 병합 테스트한다."
    - badge: "Team override"
      title: "일부 repo는 생성 코드, mobile, legacy path가 많다"
      fit: "기본값은 유지하되, false positive가 큰 path와 언어별 보강 query가 필요한 경우"
      watchouts: "exclude가 쌓이면 보안 blind spot이 된다."
      next_step: "override는 owner, reason, expires_at, finding delta를 요구한다."
    - badge: "Hold hard fail"
      title: "기존 alert가 많고 scan 성공률도 낮다"
      fit: "도구 켜기 자체가 첫 단계인 legacy portfolio"
      watchouts: "처음부터 merge block을 걸면 개발자는 우회 경로를 찾는다."
      next_step: "2주 evaluate mode, baseline freeze, 신규 critical만 차단으로 시작한다."
---

2026년 8월 4일 GitHub Changelog에는 애플리케이션 보안 운영자에게 중요한 신호가 여럿 올라왔습니다. code scanning default setup에 중앙 CodeQL configuration file을 적용할 수 있게 되었고, Code Quality settings에서는 AI가 coverage workflow PR을 생성하는 공개 프리뷰가 열렸습니다. 같은 날 CodeQL 2.26.2는 Swift 6.3.3과 Kotlin 2.4.10 지원, path injection과 URL redirection, GitHub Actions query 정확도 개선을 알렸습니다. Dependabot branch name customization도 함께 나왔습니다.

각각은 작은 기능처럼 보입니다. 하지만 같이 보면 방향이 선명합니다. 보안과 품질 스캔은 더 이상 저장소마다 workflow 파일을 복사해 붙이는 작업이 아닙니다. **중앙 기본값, repo별 override, 자동 생성 PR, 스캐너 버전 변화, 비용과 false positive를 함께 다루는 rollout 계약**이 되고 있습니다.

이 글은 [Code Quality Policy Gate](/posts/2026-06-25-code-quality-policy-gate-trend/), [AI Security Review Control Loop](/posts/2026-07-15-ai-security-review-control-loop-trend/), [Security Triage Context Plane](/posts/2026-07-08-security-triage-context-plane-trend/), [CI Runner Version Floor](/posts/2026-07-24-ci-runner-version-floor-trend/)와 이어집니다. 이전 글들이 "finding을 어떻게 정책과 리뷰에 연결할까"를 다뤘다면, 이번 글은 그 앞단입니다. **보안 스캐너 자체를 어떻게 조직 전체에 안전하게 켜고 유지할 것인가**입니다.

참고한 공식 신호:

- GitHub Changelog, Customize code scanning default setup at scale: https://github.blog/changelog/2026-08-04-customize-code-scanning-default-setup-at-scale/
- GitHub Docs, Configuring default setup for code scanning at scale: https://docs.github.com/en/code-security/how-tos/secure-at-scale/configure-organization-security/configure-specific-tools/code-scanning-at-scale
- GitHub Changelog, Code coverage automatic enablement in Code Quality settings: https://github.blog/changelog/2026-08-04-code-coverage-automatic-enablement-in-code-quality-settings/
- GitHub Changelog, CodeQL 2.26.2 adds Swift 6.3.3 and Kotlin 2.4.10 support: https://github.blog/changelog/2026-08-04-codeql-2-26-2-adds-swift-6-3-3-and-kotlin-2-4-10-support/
- GitHub Changelog, Customize Dependabot pull request branch names: https://github.blog/changelog/2026-08-04-customize-dependabot-pull-request-branch-names/

## 이 글에서 얻는 것

- code scanning default setup의 중앙 configuration이 왜 AppSec 운영 모델을 바꾸는지 이해합니다.
- 중앙 CodeQL config, repository property, repo override, private config 접근 권한을 하나의 정책 아티팩트로 설계하는 기준을 얻습니다.
- coverage workflow 자동 생성과 CodeQL 버전 업데이트를 무조건 켜는 기능이 아니라 rollout, 비용, false positive 관점으로 판단할 수 있습니다.
- 전 repo hard fail 대신 evaluate mode, baseline freeze, 신규 고위험 finding 차단으로 시작하는 실무 기준을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Default setup은 더 이상 최소 기능만 뜻하지 않는다

예전에는 보안 스캔을 정교하게 하려면 advanced setup으로 GitHub Actions workflow를 직접 관리해야 했습니다. 문제는 repo가 많아질수록 workflow가 흩어진다는 점입니다. 어떤 repo는 query suite가 다르고, 어떤 repo는 오래된 runner를 쓰고, 어떤 repo는 exclude path가 과하게 들어가고, 어떤 repo는 아예 workflow가 실패한 채 방치됩니다.

이번 변화의 핵심은 default setup의 낮은 유지보수 장점과 중앙 configuration의 통제력을 같이 가져가려는 방향입니다. `github-codeql-config-file` repository property를 통해 CodeQL 설정 파일을 지정하고, 조직 전체 기본값으로도 적용할 수 있습니다. 중앙 repository에 설정을 두고 여러 repo가 참조하게 만들 수도 있습니다.

운영 의미는 큽니다.

| 과거 방식 | 새 방향 | 운영 효과 |
| --- | --- | --- |
| repo마다 CodeQL workflow 유지 | default setup + 중앙 config | drift 감소 |
| advanced setup만 세밀 제어 | default setup에 config 병합 | 유지보수와 통제 균형 |
| 스캐너 설정이 repo 내부에 흩어짐 | 중앙 policy artifact | AppSec 리뷰와 감사 쉬움 |
| private config 접근에 token 관리 | Git Source private registry | token 기반 우회 감소 |

즉 default setup은 "대충 켜는 기본값"이 아니라 조직 baseline을 배포하는 경로가 됩니다.

### 2) 중앙 config는 코드가 아니라 정책 아티팩트다

CodeQL config에는 query 추가, path 제외, threat model, model pack 같은 중요한 판단이 들어갑니다. 이 파일은 보안 정책과 같습니다. 단순 YAML이 아니라 어떤 취약점 클래스를 볼지, 어떤 디렉터리를 분석에서 뺄지, 어떤 언어와 generated path를 예외로 둘지 결정합니다.

따라서 중앙 config에는 owner와 리뷰 규칙이 필요합니다.

```yaml
security_default_setup_contract:
  config_repo: "org/security-codeql-config"
  owner: "appsec-platform"
  rollout_mode: "evaluate_then_enforce"
  override_allowed:
    - "generated_path_exclude"
    - "language_specific_query_pack"
  locked:
    - "secret_scanning_required"
    - "critical_codeql_block"
  exception_ttl_days: 90
  review_required:
    - "appsec"
    - "repo_owner"
```

특히 exclude는 조심해야 합니다. 생성 코드, vendor directory, migration dump처럼 분석 가치가 낮은 경로를 제외하는 것은 합리적입니다. 하지만 `src/legacy/**`처럼 문제 많은 영역을 통째로 빼면 blind spot이 됩니다. 예외에는 reason, owner, expires_at, last finding sample을 붙이는 편이 안전합니다.

의사결정 기준:

- 중앙 config 변경은 최소 5개 대표 repo에서 scan dry-run 또는 evaluate mode를 거친다.
- high/critical finding 증가율이 30%를 넘으면 샘플 triage 후 rollout한다.
- scan success rate가 95% 미만이면 enforce 전환을 보류한다.
- exclude 추가는 90일 TTL과 재검토 owner가 없으면 merge하지 않는다.
- security-critical repo는 repo override보다 중앙 baseline을 우선한다.

### 3) Coverage 자동 생성은 설정 장벽을 낮추지만 품질을 보장하지 않는다

Code Quality settings에서 coverage workflow를 자동 생성하는 기능은 좋은 변화입니다. coverage 설정은 늘 귀찮았습니다. 언어별 테스트 명령, report format, upload step, 권한 설정이 제각각이고, 작은 팀에서는 "나중에 하자"로 밀리기 쉽습니다. AI가 repository context를 보고 PR을 만들어 주면 설정 장벽은 낮아집니다.

하지만 coverage 숫자는 테스트 품질이 아닙니다. 라인이 실행됐다는 뜻이지 중요한 behavior가 검증됐다는 뜻은 아닙니다. 그래서 자동 생성 PR은 "생성됐으니 merge"가 아니라 아래를 리뷰해야 합니다.

| 리뷰 항목 | 기준 |
| --- | --- |
| permissions | least privilege, write 권한 최소화 |
| test command | 실제 CI와 같은 명령인지 |
| report scope | generated/vendor/test fixture 제외 기준 |
| diff coverage | 전체 coverage보다 변경 라인 기준 우선 |
| flaky rate | 7일 동안 실패율 2% 이하 목표 |
| cost | Actions minutes가 기준선 대비 20% 이상 늘면 조정 |

이 기준은 [Code Quality Policy Gate](/posts/2026-06-25-code-quality-policy-gate-trend/)와 같습니다. coverage는 merge gate의 입력일 뿐, 단독 판정자가 아닙니다. 처음에는 hard fail보다 comment 또는 evaluate mode가 낫습니다. 2주 동안 데이터를 보고, critical path와 신규 코드부터 차단하면 저항이 줄어듭니다.

### 4) CodeQL 버전 변화는 finding volume을 바꿀 수 있다

CodeQL 2.26.2는 Swift와 Kotlin 지원 확대뿐 아니라 여러 query behavior 변경을 포함합니다. 예를 들어 sanitizer 판단이 바뀌면 path injection이나 URL redirection finding이 늘 수 있습니다. GitHub Actions 관련 query도 더 많은 결과를 표면화할 수 있습니다.

이런 변화는 좋은 일입니다. 이전에 놓치던 위험을 더 잘 찾는 것이니까요. 하지만 운영 관점에서는 finding volume 변화입니다. AppSec 큐, repo owner SLA, merge gate, 비용이 영향을 받습니다. 따라서 스캐너 버전 업데이트는 조용한 배경 이벤트가 아니라 작은 release event로 보는 편이 안전합니다.

운영 기준:

- CodeQL release note를 주 1회 dependency review에 포함한다.
- 새 버전 반영 후 high/critical finding delta를 7일 단위로 본다.
- 신규 query에서 나온 finding은 confirmed rate를 샘플링한다.
- false positive가 40%를 넘는 query는 즉시 hard fail로 쓰지 않는다.
- GitHub Actions, path traversal, redirect처럼 exploitability가 높은 영역은 보안 owner가 우선 triage한다.

이렇게 해야 "도구가 갑자기 시끄러워졌다"가 아니라 "새 룰이 어떤 위험을 더 보이게 했는가"로 대화할 수 있습니다.

### 5) 작은 branch naming 기능도 자동화 운영에 의미가 있다

같은 날 Dependabot pull request branch name customization도 나왔습니다. 언뜻 작아 보이지만 자동화가 늘어나는 조직에서는 branch namespace가 중요합니다. branch 이름은 CI rule, CODEOWNERS routing, dashboard grouping, exception policy, cleanup script의 입력이 됩니다.

예를 들어 dependency update branch가 `dependabot/npm_and_yarn/Lodash-4.17.21`처럼 제각각이면 규칙을 쓰기 어렵습니다. 표준 prefix와 separator를 두면 "runtime dependency", "dev dependency", "security patch", "ecosystem" 기준으로 큐를 나눌 수 있습니다. 이 흐름은 [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/)과도 연결됩니다. 자동화가 많아질수록 작은 식별자도 운영 계약이 됩니다.

## 실무 적용

### 1) Repo tier별 rollout을 먼저 정한다

보안 스캔은 많이 켤수록 좋아 보이지만, 처음부터 전 repo hard fail로 가면 실패합니다. repo마다 언어, 테스트 안정성, owner, legacy 부채, production 영향이 다릅니다.

권장 tier:

| Tier | 예시 | 초기 정책 |
| --- | --- | --- |
| T0 | 결제, 권한, 인증, 고객 데이터 | default setup + 중앙 config, critical block |
| T1 | 활발한 제품 repo | evaluate 2주 후 신규 high 이상 block |
| T2 | 내부 도구, 낮은 위험 repo | comment/evaluate, 월 1회 triage |
| T3 | archived, 낮은 활동 repo | 주기 scan, release 전만 block |
| T4 | generated/demo repo | owner 승인 후 제한적 제외 |

숫자 기준은 보수적으로 시작합니다.

- 파일럿 repo 5~10개, 최소 7일 관측
- scan success rate 95% 이상
- Actions minutes 증가율 20% 이하
- 신규 high/critical finding 중 confirmed rate 60% 이상
- false positive로 인한 reviewer override 20% 이하
- T0 repo는 critical finding SLA 2영업일, high는 7영업일

이 기준을 통과하면 evaluate에서 warn으로, warn에서 partial enforce로 올립니다. 처음부터 100% 차단보다 rollout evidence를 쌓는 편이 오래 갑니다.

### 2) 중앙 CodeQL config 변경 PR 템플릿을 만든다

중앙 설정 변경 PR에는 일반 코드 PR보다 더 구조적인 설명이 필요합니다.

```yaml
codeql_config_change:
  change_type: "add_query_pack | exclude_path | threat_model | model_pack | private_config_ref"
  affected_repos: 42
  pilot_repos:
    - "checkout-api"
    - "billing-worker"
    - "mobile-ios"
  expected_finding_delta: "+12 high, +0 critical"
  expected_cost_delta: "+8% actions minutes"
  false_positive_sample_size: 20
  rollback:
    property_reset: "github-codeql-config-file -> previous"
    owner: "appsec-platform"
```

리뷰어가 봐야 할 질문은 "YAML 문법이 맞나"가 아닙니다.

- 어떤 위험 클래스를 더 보려는가?
- 어떤 repo에서 finding이 늘어나는가?
- exclude는 blind spot을 만들지 않는가?
- 비용과 scan 시간이 감당 가능한가?
- rollback은 repository property 되돌리기로 충분한가?
- private config repository 접근 권한은 최소화되어 있는가?

이 질문을 PR에 넣으면 중앙 config가 점점 정책 아티팩트답게 관리됩니다.

### 3) Coverage 자동 PR은 테스트 정책 PR로 취급한다

AI가 coverage workflow를 만들어 주면 리뷰어는 workflow 권한, 테스트 명령, report 제외 기준, flaky 가능성을 확인해야 합니다.

실무 적용 순서:

1. 자동 생성 PR을 바로 merge하지 않고 CI owner가 리뷰한다.
2. `pull_request`, `push` trigger와 permission scope를 확인한다.
3. 테스트 명령이 기존 CI와 중복되거나 충돌하지 않는지 본다.
4. coverage report가 generated/vendor path를 잘 제외하는지 본다.
5. 7일 동안 comment-only로 돌리고 flaky rate와 비용을 측정한다.
6. diff coverage 기준을 먼저 적용하고, 전체 coverage 목표는 나중에 잡는다.

coverage gate 전환 기준은 예를 들어 이렇게 잡을 수 있습니다.

- changed line coverage 70% 미만이면 warn
- critical module changed line coverage 80% 미만이면 block 후보
- 전체 repo coverage 하락 2%p 이상이면 owner review
- coverage workflow failure rate 2% 초과면 hard fail 금지

숫자는 조직마다 달라질 수 있습니다. 중요한 것은 coverage를 "도구가 만든 숫자"가 아니라 merge 정책 입력으로 다루는 것입니다.

### 4) Finding queue를 owner와 SLA에 연결한다

보안 스캔을 넓게 켜면 finding이 늘어납니다. finding이 늘었는데 owner와 SLA가 없으면 대시보드만 빨개집니다. 그래서 default setup rollout과 triage plane은 같이 가야 합니다.

최소 queue 필드:

| 필드 | 예시 |
| --- | --- |
| source | `CodeQL 2.26.2` |
| query_id | `java/path-injection` |
| repo_tier | `T0` |
| owner | `payments-platform` |
| introduced_by | PR, dependency update, legacy baseline |
| severity | critical/high/medium |
| state | new, triaged, accepted, fixed, false_positive |
| due_at | severity + tier 기준 |
| exception_expires_at | 최대 90일 |

이 구조는 [Security Triage Context Plane](/posts/2026-07-08-security-triage-context-plane-trend/)과 이어집니다. 스캐너를 켜는 일과 finding을 닫는 일은 같은 운영 루프에 있어야 합니다.

## 트레이드오프/주의점

첫째, 중앙 config는 blast radius를 만듭니다. 잘못된 query pack이나 private config reference가 들어가면 여러 repo의 scan이 동시에 실패할 수 있습니다. 그래서 중앙 config도 canary, staged rollout, rollback property를 가져야 합니다.

둘째, exclude는 빠른 해결처럼 보이지만 장기 blind spot이 됩니다. generated code 제외는 괜찮을 수 있지만, legacy business logic 전체를 빼면 가장 위험한 영역이 안 보입니다. 예외에는 owner와 만료일을 붙여야 합니다.

셋째, coverage 자동화는 테스트 품질을 자동으로 올리지 않습니다. coverage가 올라가도 assertion이 빈약하면 회귀를 못 잡습니다. coverage gate는 mutation test, critical path scenario, flaky test 지표와 함께 봐야 합니다.

넷째, CodeQL finding 증가는 도구 품질 저하가 아니라 탐지 범위 확대일 수 있습니다. 새 버전 이후 finding이 늘면 먼저 release note와 query 변경을 보고, confirmed rate를 샘플링해야 합니다.

다섯째, 비용을 무시하면 품질 정책이 반발을 삽니다. Code scanning, Code Quality, coverage workflow는 Actions minutes와 reviewer 시간을 씁니다. repo tier와 evaluate mode 없이 넓게 켜면 보안보다 피로가 먼저 쌓입니다.

## 체크리스트 또는 연습

- [ ] 중앙 CodeQL configuration file의 owner, 리뷰어, rollback 방법이 있다.
- [ ] `github-codeql-config-file` 같은 repository property 적용 범위와 override 가능 여부를 문서화했다.
- [ ] 새 config는 대표 repo 5~10개에서 7일 이상 evaluate mode로 검증한다.
- [ ] scan success rate, finding delta, false positive rate, Actions minutes 증가율을 rollout gate로 본다.
- [ ] coverage 자동 생성 PR은 권한, 테스트 명령, report 제외 기준, flaky rate를 리뷰한다.
- [ ] CodeQL 버전 업데이트 후 high/critical finding 증가와 query 변경을 함께 본다.
- [ ] finding은 repo owner, severity SLA, exception expiry가 있는 triage queue로 들어간다.
- [ ] Dependabot/agent/coverage 자동화 branch namespace가 CI와 dashboard에서 구분 가능하다.

연습 과제:

1. 현재 조직의 repo 10개를 T0~T4로 나누고, 각 tier에 어떤 보안 스캔 정책을 적용할지 적어 보세요.
2. 중앙 CodeQL config에 `exclude`를 하나 추가한다고 가정하고, owner, reason, expires_at, blind spot 위험을 PR 템플릿으로 작성해 보세요.
3. coverage workflow를 새로 켤 repo 하나를 골라 2주 evaluate mode에서 볼 지표 5개를 정하세요. 비용, flaky, changed line coverage, reviewer override, critical path coverage를 포함하면 좋습니다.
4. CodeQL 새 버전 적용 후 finding이 30% 늘어난 상황을 가정하고, release note 확인, 샘플 triage, enforce 보류/유지 판단을 10줄 runbook으로 써 보세요.

보안 스캔의 성패는 스캐너를 켰느냐가 아니라, 조직이 그 기본값을 계속 유지하고 해석할 수 있느냐에 달려 있습니다. 중앙 default setup은 좋은 출발점입니다. 다만 좋은 기본값도 rollout, override, 비용, 예외, triage가 없으면 곧 잡음이 됩니다. 2026년의 AppSec 운영은 더 많은 스캔보다 더 잘 운영되는 스캔으로 이동하고 있습니다.
