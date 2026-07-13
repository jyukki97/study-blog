---
title: "2026 개발 트렌드: Agent Resource Provenance Gate, AI가 만든 URL·패키지·스킬을 바로 실행하지 않는 법"
date: 2026-07-13T10:06:00+09:00
draft: false
tags: ["AI Coding", "Agent Security", "Supply Chain Security", "Developer Workflow", "Prompt Injection"]
categories: ["Development", "AI", "Security"]
series: "2026 개발 운영 트렌드"
keywords: ["HalluSquatting", "slopsquatting", "agent resource provenance", "AI coding assistant security", "prompt injection"]
description: "AI 에이전트가 생성한 저장소 URL, 패키지명, 스킬 이름, 문서 링크를 실행 전에 검증하는 Resource Provenance Gate 흐름을 정리합니다."
lastmod: 2026-07-13
summary: "에이전트가 외부 리소스를 찾아 설치하고 실행하는 순간, 환각은 단순 오답이 아니라 공급망 공격 표면이 됩니다. URL·패키지·스킬·문서 출처를 canonical source와 digest로 검증하는 게이트가 필요합니다."
key_takeaways:
  - "HalluSquatting과 slopsquatting 흐름은 모델이 만든 그럴듯한 리소스 식별자가 실제 공격자가 등록한 리소스로 이어질 수 있음을 보여준다."
  - "방어의 핵심은 모델 답변을 믿는 것이 아니라 registry/search/detail 검증, owner 일치, digest pinning, sandbox 실행, egress 제한을 묶는 것이다."
  - "AI prompt injection 정적 분석과 resource provenance gate는 서로 보완 관계다. 하나는 코드 안의 privileged prompt 흐름을 보고, 다른 하나는 런타임 외부 리소스 실행 경계를 본다."
operator_checklist:
  - "에이전트가 제안한 URL, Git repo, package, skill, plugin은 canonical registry/search/detail 검증 전 설치·실행하지 않는다."
  - "패키지·스킬 설치는 owner, slug, publish time, downloads/stars, signature, digest, security scan 결과를 한 receipt로 남긴다."
  - "agent sandbox에는 unknown host egress 차단, curl|sh 금지, registry 외 remote dependency 예외 만료일을 둔다."
  - "CI와 agent harness에서 unverified_resource, hallucinated_slug_diff, direct_remote_execution_attempt 지표를 수집한다."
decision_guide:
  title: "Resource Provenance Gate를 어디부터 적용할까"
  intro: "모든 링크 클릭에 같은 문턱을 둘 필요는 없습니다. 설치, 실행, credential 접근, 외부 전송으로 이어지는 리소스부터 gate를 붙이는 편이 효과가 큽니다."
  cases:
    - badge: "즉시 적용"
      title: "에이전트가 외부 코드를 설치하거나 실행한다"
      fit: "npm/pip/go package 설치, Git clone, marketplace skill/plugin 설치, shell script 실행이 포함된 개발 자동화입니다."
      watchouts: "모델이 만든 이름이 실제 존재한다고 해도 owner가 다르거나 최근 생성된 악성 리소스일 수 있습니다."
      next_step: "설치 전 canonical lookup, owner exact match, digest pinning, sandbox 실행을 hard gate로 둡니다."
    - badge: "점진 적용"
      title: "에이전트가 문서와 API 스키마를 가져온다"
      fit: "공식 문서 URL, OpenAPI schema, SDK 예제를 자동으로 찾아 코드 생성에 쓰는 흐름입니다."
      watchouts: "문서 링크가 틀리면 취약한 예제나 오래된 API를 기준으로 코드가 만들어질 수 있습니다."
      next_step: "공식 host allowlist, sitemap/llms.txt 우선, lastmod/freshness 확인을 붙입니다."
    - badge: "관측 우선"
      title: "읽기 전용 리서치와 요약"
      fit: "외부 글을 읽고 사람에게 요약만 보여주는 작업입니다."
      watchouts: "읽기 전용이라도 prompt injection 문서가 agent의 다음 행동을 유도할 수 있습니다."
      next_step: "요약과 실행을 분리하고, 읽은 URL과 source trust level을 receipt에 남깁니다."
learning_refs:
  - title: "npm v12 Install-Time Trust Gate"
    href: "/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/"
    description: "패키지 설치 시점의 script 실행 허가와 allowlist 운영 기준입니다."
  - title: "Package Release Quarantine Gate"
    href: "/posts/2026-05-12-package-release-quarantine-gate-trend/"
    description: "새 패키지 버전을 격리 창에서 검증하는 공급망 운영 모델입니다."
  - title: "Agent Sandbox Egress Policy"
    href: "/posts/2026-05-16-agent-sandbox-egress-policy-trend/"
    description: "에이전트가 어떤 네트워크 목적지로 나갈 수 있는지 통제하는 기준입니다."
  - title: "Tool Permission Manifest"
    href: "/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/"
    description: "도구 호출 권한을 선언하고 런타임에서 검증하는 운영 흐름입니다."
faqs:
  - question: "검색으로 확인하면 충분한가요?"
    answer: "검색은 중요한 완화책이지만 충분조건은 아닙니다. 검색 결과가 광고, SEO 스팸, typosquat, 오래된 fork를 포함할 수 있으므로 canonical registry, owner, digest, signature, security scan을 함께 봐야 합니다."
  - question: "download 수나 star 수가 많으면 안전한가요?"
    answer: "보조 신호일 뿐입니다. 공격자는 기존 패키지를 탈취하거나 유사 이름을 쓰거나 automation traffic으로 숫자를 만들 수 있습니다. 실행 허가에는 owner와 provenance가 더 중요합니다."
---

AI 코딩 에이전트의 실패를 예전처럼 "환각이라서 틀렸다" 정도로만 보면 부족합니다. 에이전트가 외부 저장소를 clone하고, 패키지를 설치하고, 스킬이나 플러그인을 받아 실행하는 순간 환각은 공급망 문제가 됩니다. 모델이 존재하지 않는 패키지명이나 URL을 그럴듯하게 만들고, 공격자가 그 이름을 먼저 등록해 두면, 에이전트는 사용자를 대신해 악성 리소스를 가져올 수 있습니다. 이 흐름은 typosquatting보다 더 까다롭습니다. 사람이 오타를 내는 것이 아니라, 모델이 자신 있게 만든 식별자를 개발자가 신뢰하는 구조이기 때문입니다.

2026년 7월 8일 공개된 arXiv 논문 "Beware of Agentic Botnets"는 HalluSquatting을 다룹니다. 논문은 공격자가 인기 저장소나 스킬 이름을 기준으로 LLM이 자주 만들어내는 잘못된 리소스 식별자를 찾아 미리 등록하고, 에이전트가 그것을 가져오게 만드는 공격을 설명합니다. 같은 주 GitHub CodeQL 2.26.0은 JavaScript/TypeScript에서 untrusted user input이 AI system prompt로 흐르는 패턴을 찾는 `js/system-prompt-injection` 쿼리를 추가했습니다. 한쪽은 런타임 리소스 검색과 설치의 문제이고, 다른 한쪽은 코드 안의 AI 권한 경계 문제입니다. 둘을 묶어 보면 방향이 선명합니다. **AI 애플리케이션 보안은 prompt만 막는 것이 아니라, 모델이 가리킨 외부 리소스를 실행 전에 검증하는 일**까지 포함해야 합니다.

이 글은 [npm v12 Install-Time Trust Gate](/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/), [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [Agent Sandbox Egress Policy](/posts/2026-05-16-agent-sandbox-egress-policy-trend/), [Tool Permission Manifest](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)와 이어지는 글입니다. 기존 글들이 설치 시점 실행 허가, 새 패키지 검역, 에이전트 네트워크 출구, 도구 권한을 다뤘다면, 이번 글은 그 앞단의 질문을 다룹니다. "이 리소스가 진짜 우리가 의도한 리소스인가?"

참고 신호:

- arXiv 2607.07433, "Beware of Agentic Botnets": https://arxiv.org/abs/2607.07433
- arXiv 2605.17062, "The Range Shrinks, the Threat Remains": https://arxiv.org/abs/2605.17062
- GitHub Changelog, "CodeQL 2.26.0 adds Kotlin 2.4.0 support and AI prompt injection detection": https://github.blog/changelog/2026-07-10-codeql-2-26-0-adds-kotlin-2-4-0-support-and-ai-prompt-injection-detection/
- CodeQL 2.26.0 changelog: https://codeql.github.com/docs/codeql-overview/codeql-changelog/codeql-cli-2.26.0/

## 이 글에서 얻는 것

- HalluSquatting, slopsquatting, phantom URL 문제가 왜 agent runtime의 공급망 이슈인지 이해합니다.
- AI가 제안한 Git repo, package, skill, plugin, 문서 URL을 실행 전에 검증하는 gate 기준을 잡을 수 있습니다.
- 설치·실행 경로에서 canonical lookup, owner exact match, digest pinning, sandbox, egress policy를 어떻게 조합할지 정리합니다.
- 정적 분석, 런타임 policy, 사람 승인 사이의 역할 분담을 숫자와 조건으로 나눌 수 있습니다.

## 핵심 개념/이슈

### 1) 모델이 만든 리소스 식별자는 입력이 아니라 실행 후보가 된다

예전 검색형 챗봇이라면 틀린 URL은 사용자가 클릭하지 않으면 그만이었습니다. 하지만 코딩 에이전트는 다릅니다. "이 라이브러리 설치해줘", "최근 인기 repo를 clone해 테스트해줘", "이 스킬을 설치해줘" 같은 지시에서 모델은 직접 리소스 이름을 만들고 tool을 호출합니다. 그 결과는 단순 텍스트가 아니라 `git clone`, `npm install`, `pip install`, `curl`, marketplace install 같은 실행 경로로 이어집니다.

여기서 식별자는 신뢰 경계가 됩니다.

| 리소스 | 위험 |
| --- | --- |
| GitHub repo slug | 공격자가 유사 owner/name을 선점해 악성 코드 제공 |
| npm/PyPI package | hallucinated package name을 등록해 설치 유도 |
| skill/plugin marketplace slug | 자연어 요청을 잘못된 slug로 해석해 설치 |
| 문서 URL/API schema | 오래된 예제나 공격자 문서를 기준으로 코드 생성 |
| shell install URL | `curl | sh` 형태로 즉시 실행 |

그래서 이제 "모델이 추천했다"는 실행 근거가 될 수 없습니다. 실행 근거는 canonical source와 검증 증거여야 합니다.

### 2) HalluSquatting은 typosquatting보다 자동화 친화적이다

typosquatting은 사람이 오타를 낼 가능성에 베팅합니다. HalluSquatting과 slopsquatting은 모델이 그럴듯하게 만들 가능성에 베팅합니다. 차이는 큽니다. 공격자는 특정 인기 리소스에 대해 모델이 자주 착각하는 이름을 미리 측정하고, 그 이름을 등록해 둘 수 있습니다. 사용자는 오타를 낸 적이 없어도, 에이전트가 "아마 이 repo일 것"이라고 만든 이름을 믿고 가져오면 공격 표면이 열립니다.

2026년 5월 패키지 환각 재평가 논문은 최신 code-capable 모델에서도 PyPI/npm 패키지 환각률이 사라지지 않았고, 여러 모델이 공통으로 만들어내는 이름이 있음을 보고했습니다. 7월 HalluSquatting 논문은 저장소와 스킬 설치 시나리오까지 확장합니다. 숫자의 세부값은 연구 환경에 따라 달라질 수 있지만, 실무자가 받아들여야 할 결론은 보수적으로 잡아도 충분합니다. **모델이 외부 리소스 이름을 생성할 수 있다면, 그 이름은 공격자가 선점할 수 있다**는 점입니다.

### 3) 애플리케이션 레이어의 검증 행동이 모델 성능만큼 중요하다

HalluSquatting 논문에서 흥미로운 지점은 모델 자체보다 애플리케이션 동작이 결과를 크게 바꾼다는 점입니다. 어떤 환경은 web search나 self-verification을 적극적으로 호출해 hallucination을 줄이고, 어떤 환경은 모델의 parametric memory에 의존해 잘못된 slug를 그대로 실행합니다. 같은 모델이라도 harness가 검색, registry lookup, owner 확인을 강제하는지에 따라 위험이 달라집니다.

이 말은 방어가 가능하다는 뜻이기도 합니다. 모델을 더 똑똑하게 만드는 것만 기다릴 필요가 없습니다. agent runtime은 아래 규칙을 강제할 수 있습니다.

- 자연어에서 나온 repo/package/skill 이름은 바로 실행하지 않는다.
- registry/search/detail API로 canonical owner/name을 확인한다.
- official docs, package registry, marketplace detail page처럼 authority가 있는 표면을 우선한다.
- owner가 다르거나 최근 생성된 리소스면 사람 확인을 요구한다.
- 설치 전 digest, signature, security scan, license, publish time을 receipt로 남긴다.
- unknown host egress와 remote script 실행은 sandbox에서만 허용한다.

이 구조는 [Agent Sandbox Egress Policy](/posts/2026-05-16-agent-sandbox-egress-policy-trend/)와 직접 연결됩니다. egress allowlist 없이 agent가 어디든 나갈 수 있으면, 잘못된 리소스 식별자가 곧 네트워크 실행 권한이 됩니다.

### 4) prompt injection 정적 분석은 코드 내부의 같은 문제를 본다

GitHub CodeQL 2.26.0의 `js/system-prompt-injection`은 untrusted user-provided value가 AI model의 system prompt로 흐르는 경우를 잡습니다. 이것은 중요한 신호입니다. prompt injection을 "모델이 알아서 막아야 할 문제"가 아니라, **신뢰되지 않은 입력이 privileged instruction 영역으로 들어가는 코드 결함**으로 보기 시작했다는 뜻이기 때문입니다.

Resource Provenance Gate도 같은 방향입니다. 모델이 생성한 URL이나 package name은 신뢰된 입력이 아닙니다. 그것을 설치 명령, shell 명령, tool invocation으로 바로 넘기면 untrusted data가 privileged action으로 흐르는 것입니다. 정적 분석은 코드 안의 흐름을 보고, 런타임 gate는 에이전트가 만든 외부 리소스 흐름을 봅니다. 둘 다 "LLM이니까 예외"라는 태도를 줄이는 장치입니다.

### 5) provenance receipt가 없으면 나중에 설명할 수 없다

공격이 아니어도 provenance는 필요합니다. 에이전트가 어떤 문서를 보고 API 코드를 만들었는지, 어떤 package를 어떤 owner로 확인했는지, 어떤 digest를 설치했는지 남지 않으면 장애 때 원인을 복원하기 어렵습니다.

receipt에는 최소 아래가 들어가야 합니다.

```yaml
resource_provenance:
  type: "npm_package"
  requested_by_model: "react-codeshift"
  canonical_name: "@scope/real-package"
  registry_url: "https://registry.npmjs.org/..."
  owner_verified: true
  version: "1.4.2"
  digest: "sha512-..."
  publish_time: "2026-07-12T..."
  install_scripts: "blocked_until_approved"
  decision: "allow"
  approver: "dependency-policy"
```

이 receipt는 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)의 특수한 형태로 볼 수 있습니다. 에이전트가 "설치했다"가 아니라, 왜 그 리소스가 맞다고 판단했는지를 남겨야 합니다.

## 실무 적용

### 1) 실행 위험도별 gate를 나눈다

모든 외부 URL에 같은 절차를 붙이면 개발 경험이 망가집니다. 대신 실행 위험도별로 나눕니다.

| 위험도 | 예시 | 기본 처리 |
| --- | --- | --- |
| R0 읽기 전용 | 문서 요약, 블로그 읽기 | URL 기록, source trust 표시 |
| R1 코드 생성 참고 | 공식 docs, OpenAPI schema | official host allowlist, freshness 확인 |
| R2 설치 | npm/pip/go package, Git clone | canonical lookup, owner match, digest pinning |
| R3 실행 | postinstall, binary download, shell script | sandbox, allowlist, 사람 승인 |
| R4 권한 결합 실행 | cloud token, repo write, deploy 권한 있는 runner | fail closed, owner 승인, audit receipt |

R2 이상은 "모델이 말했으니 진행"을 금지합니다. R3 이상은 [npm v12 Install-Time Trust Gate](/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/)처럼 실행 허가를 별도 계약으로 봐야 합니다.

### 2) canonical resolver를 agent harness 앞에 둔다

에이전트가 `git clone some/repo`를 실행하려 하면 먼저 resolver가 끼어들어야 합니다.

```yaml
resource_resolution_policy:
  git:
    require_exact_owner: true
    require_default_branch_protection_signal: true
    new_repo_warning_days: 30
    clone_without_lookup: deny
  npm:
    registry_only: true
    allow_remote_tarball: deny_by_default
    require_integrity_digest: true
    lifecycle_scripts: approve_only
  skills:
    marketplace_detail_required: true
    owner_verified: true
    install_by_natural_language: search_then_confirm
  shell:
    curl_pipe_shell: deny
    unknown_host: deny
```

핵심은 tool 호출 전에 resolver가 작동해야 한다는 점입니다. 실행 후 로그 분석으로는 늦습니다. 이 구조는 [Tool Contract Test](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/)와도 맞닿습니다. 도구가 받는 입력의 schema만 맞는지 보는 것을 넘어, 리소스 식별자가 실행 가능한 신뢰 경로인지 확인해야 합니다.

### 3) 패키지 설치는 "이름 검증"과 "실행 검증"을 분리한다

패키지 이름이 맞아도 설치 중 실행되는 script가 안전하다는 뜻은 아닙니다. 따라서 두 단계를 나눕니다.

첫 번째는 리소스 검증입니다.

- registry에서 canonical package를 찾았다.
- owner나 publisher가 예상과 일치한다.
- version, publish time, changelog, provenance가 확인된다.
- lockfile integrity나 digest가 고정된다.
- Git/remote URL dependency가 없거나 예외 만료일이 있다.

두 번째는 실행 검증입니다.

- lifecycle script는 allowlist에 있는가.
- binary download host가 허용된 곳인가.
- postinstall이 network나 credential에 접근하지 않는가.
- release build runner에 publish token이나 cloud secret이 노출되지 않는가.
- install 결과를 sandbox에서 먼저 재현했는가.

이 분리는 [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)의 검역 창과 자연스럽게 연결됩니다. 이름이 맞는지와 실행해도 되는지는 다른 질문입니다.

### 4) 문서와 API 스키마도 provenance가 필요하다

코드 실행만 위험한 것은 아닙니다. 에이전트가 잘못된 문서를 읽고 코드를 생성하면 취약한 설정, deprecated API, 잘못된 인증 흐름이 들어올 수 있습니다. 특히 SDK 초기화, OAuth redirect, webhook signature 검증, CORS, storage policy 같은 예제는 문서 출처가 중요합니다.

문서 리소스 기준:

- 공식 docs host 또는 repository docs를 우선한다.
- `llms.txt`, sitemap, canonical link를 확인한다.
- 날짜가 중요한 API는 lastmod 또는 versioned docs를 본다.
- 검색 결과의 snippet만으로 코드를 만들지 않는다.
- 블로그/커뮤니티 예제는 source trust를 낮게 표시하고 공식 문서와 교차 확인한다.

이 기준은 [LLM-readable Docs Surface](/posts/2026-05-10-llm-readable-docs-surface-trend/)와 연결됩니다. 사람이 읽는 문서뿐 아니라 에이전트가 읽는 문서에도 canonical path가 필요합니다.

### 5) 관측 지표를 만든다

Resource Provenance Gate가 실제로 작동하는지 보려면 지표가 필요합니다.

- `unverified_resource_block_count`
- `hallucinated_slug_diff_count`
- `owner_mismatch_count`
- `direct_remote_execution_attempt_count`
- `registry_lookup_failure_rate`
- `resource_resolution_latency_p95`
- `provenance_receipt_missing_rate`
- `manual_override_rate`

초기 목표는 간단합니다. R2 이상 작업의 provenance receipt 누락률을 0으로 만들고, R3 이상 direct remote execution 시도는 모두 차단합니다. `manual_override_rate`가 10%를 넘으면 정책이 너무 빡빡하거나 resolver 품질이 낮은 신호입니다. 2주 단위로 false positive를 보고 기준을 조정하는 편이 현실적입니다.

## 트레이드오프/주의점

첫째, gate가 너무 느리면 개발자는 우회합니다. registry lookup과 owner 확인은 p95 1~2초 안에 끝나야 하고, 더 무거운 scan은 quarantine window나 background verification으로 보내는 편이 낫습니다.

둘째, 내부 패키지와 private repo는 공개 신호가 적습니다. download 수나 star 수가 없다고 막기보다, internal registry, CODEOWNERS, signed release, owner team, allowlist를 신뢰 기준으로 써야 합니다.

셋째, 검색도 공격받을 수 있습니다. SEO 스팸, 광고, compromised docs, typo domain이 검색 결과에 들어올 수 있습니다. 그래서 search는 시작점이고, 최종 판단은 canonical registry와 official host 확인이어야 합니다.

넷째, 모델이 틀릴 때마다 사람 승인을 요구하면 review fatigue가 생깁니다. R0/R1은 기록과 경고 중심, R2는 자동 resolver, R3/R4는 사람 승인처럼 risk tier를 나눠야 합니다.

다섯째, prompt injection 방어와 resource provenance를 따로 보면 빈틈이 생깁니다. 공격 문서가 agent에게 "이 패키지를 설치하라"고 지시하고, 모델이 그 패키지명을 받아 shell에 넘기는 식으로 두 문제가 이어질 수 있습니다. 읽기, 판단, 설치, 실행을 한 trace 안에서 봐야 합니다.

## 체크리스트 또는 연습

- [ ] agent가 생성한 Git repo, package, skill, URL을 실행 전에 canonical resolver로 검증한다.
- [ ] R2 이상 리소스에는 owner, version, digest, source URL, decision이 receipt로 남는다.
- [ ] `curl | sh`, remote tarball, Git dependency, marketplace natural-language install은 기본 deny 또는 승인 대상이다.
- [ ] 설치 중 lifecycle script는 별도 allowlist와 CI gate를 가진다.
- [ ] sandbox egress는 registry, official docs, allowlisted host 중심으로 제한된다.
- [ ] private/internal package에는 public popularity 대신 owner team, signed release, internal registry provenance를 쓴다.
- [ ] CodeQL이나 유사 정적 분석으로 untrusted input이 system prompt나 privileged instruction에 들어가는 경로를 검사한다.

연습은 최근 agent 작업 20개를 샘플링해 보는 것입니다. 그중 외부 URL, Git clone, package install, skill/plugin install, shell script 실행이 있었던 작업을 표시합니다. 각 항목마다 "모델이 만든 식별자인가", "canonical source로 확인했는가", "owner가 맞는가", "digest나 version이 고정됐는가", "실행 전에 sandbox와 egress 제한이 있었는가"를 체크하세요. R2 이상인데 증거가 없으면 그것이 첫 번째 개선 대상입니다.

오늘의 결론은 짧습니다. AI 에이전트 시대의 공급망 보안은 lockfile에서 시작하지 않습니다. 그보다 앞에서, **모델이 가리킨 리소스가 정말 의도한 리소스인지 증명하는 gate**가 필요합니다. 환각은 답변 품질 문제가 아니라 실행 경로에 들어오는 순간 보안 경계가 됩니다.
