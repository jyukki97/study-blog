---
title: "2026 개발 트렌드: Publish-Time Supply Chain Gate와 Review Context Plane, 패키지와 코드리뷰가 실행 전에 멈추기 시작했다"
date: 2026-07-30T10:06:00+09:00
lastmod: 2026-07-30T10:06:00+09:00
draft: false
tags: ["Supply Chain Security", "npm", "GitHub Actions", "Copilot Code Review", "MCP", "Developer Tools"]
categories: ["Development", "Security", "AI", "Platform Engineering"]
series: ["dev-trends"]
keywords: ["npm publish-time malware scanning", "GitHub Actions malicious workflow approval", "Copilot code review MCP", "agent skills code review", "supply chain gate"]
description: "GitHub의 npm publish-time scanning, Actions 악성 workflow 승인 보류, Copilot code review의 skills/MCP GA를 바탕으로 개발 도구가 실행 전 게이트와 리뷰 컨텍스트 평면으로 이동하는 흐름을 정리합니다."
summary: "최근 개발 도구의 신호는 패키지를 설치한 뒤 탐지하거나 PR 코멘트를 사람 감으로 읽는 단계에서, publish·workflow 실행·code review 시점에 컨텍스트와 정책을 붙여 먼저 멈추는 방향으로 이동하고 있습니다."
key_takeaways:
  - "공급망 보안은 install-time 탐지에서 publish-time 보류, workflow pre-execution approval, malware advisory 확장으로 더 앞당겨지고 있다."
  - "코드 리뷰는 diff만 보는 단계에서 repository skill, MCP context, read-only external context를 함께 읽는 review context plane으로 이동한다."
  - "실무 기준은 자동 차단률보다 false positive 처리 시간, release availability delay, read-only 경계, evidence attribution을 함께 보는 것이다."
operator_checklist:
  - "npm publish 자동화는 5~15분 availability delay와 blocked/appeal 상태를 견디도록 설계한다."
  - "보안 관련 npm package는 dual-use metadata, DISCLOSURE, 2FA-enforced publishing 요구를 릴리스 체크리스트에 넣는다."
  - "Copilot code review MCP 연결은 read-only token, source attribution, 내부 표준 skill version을 함께 점검한다."
learning_refs:
  - title: "Package Release Quarantine Gate"
    href: "/posts/2026-05-12-package-release-quarantine-gate-trend/"
    description: "패키지 릴리스를 즉시 공개하지 않고 보류·검증하는 운영 흐름입니다."
  - title: "npm v12 Install-Time Trust Gate"
    href: "/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/"
    description: "설치 시점의 신뢰 게이트와 이번 publish-time 게이트를 비교해 볼 수 있습니다."
  - title: "AI Code Review Governance"
    href: "/posts/2026-03-06-ai-code-review-governance-trend/"
    description: "AI 코드 리뷰를 팀 표준과 증거 기준으로 운영하는 관점입니다."
  - title: "MCP Native Secret Scanning"
    href: "/posts/2026-05-24-mcp-native-secret-scanning-shift-left-trend/"
    description: "에이전트 도구 루프 안으로 들어오는 보안 검사 흐름입니다."
decision_guide:
  title: "어디서 먼저 멈출 것인가"
  intro: "모든 위험을 실행 전에 막으면 개발 속도가 느려지고, 모두 실행 후 탐지하면 피해 반경이 커집니다. 패키지, workflow, code review마다 멈춤 지점을 다르게 잡아야 합니다."
  cases:
    - badge: "Publish gate"
      title: "패키지가 생태계로 퍼지기 전에 검사해야 한다"
      fit: "npm 공개 패키지, CLI, 보안 도구, dual-use capability가 있는 패키지"
      watchouts: "릴리스 자동화가 즉시 install 가능하다고 가정하면 배포가 깨질 수 있습니다."
      next_step: "publish 후 availability polling과 보류 상태 알림을 추가합니다."
    - badge: "Pre-run gate"
      title: "workflow가 token과 secret을 잡기 전에 멈춰야 한다"
      fit: "공개 저장소, 외부 기여, 새 workflow 파일, 권한이 큰 GitHub Actions"
      watchouts: "자동 보류가 모든 위험을 잡는다고 믿으면 안 됩니다."
      next_step: "workflow permissions, third-party action pinning, 승인자 기준을 별도 정책으로 둡니다."
    - badge: "Review context"
      title: "리뷰가 diff 밖의 팀 규칙과 외부 문맥을 읽어야 한다"
      fit: "대형 monorepo, 사내 API 규칙, 보안 표준, issue tracker와 연결된 PR"
      watchouts: "MCP context가 쓰기 권한을 갖거나 오래된 문서를 읽으면 리뷰 품질이 흔들립니다."
      next_step: "read-only MCP, skill attribution, freshness budget을 설정합니다."
faqs:
  - question: "자동 스캔이 있으면 release checklist를 줄여도 되나요?"
    answer: "아닙니다. 자동 스캔은 알려진 패턴과 정책 위반을 줄이는 장치입니다. 릴리스 의도, 권한, changelog, rollback path는 여전히 팀이 관리해야 합니다."
  - question: "코드 리뷰에 MCP를 붙이면 보안 위험이 커지지 않나요?"
    answer: "읽기 전용 경계와 attribution이 있으면 실무 효용이 큽니다. 다만 토큰 범위, 문서 freshness, 외부 데이터 신뢰도를 리뷰 정책에 포함해야 합니다."
---

2026년 7월 말 GitHub Changelog에 나온 신호를 보면 개발 도구의 보안 경계가 한 단계 앞당겨지고 있습니다. 7월 28일에는 npm 패키지를 publish 시점에 자동 스캔해 정상 공개, 수동 검토 보류, 차단으로 나누는 흐름이 공개됐습니다. 같은 날 GitHub Actions는 악성 가능성이 있는 workflow를 실행 전 승인 대기 상태로 두는 보호를 알렸고, Dependabot은 OpenSSF malicious-packages 데이터를 받아 malware advisory 범위를 넓혔습니다. 7월 29일에는 Copilot code review에서 agent skills와 MCP server context가 GA가 되었습니다.

따로 보면 패키지 보안, CI 보안, 코드 리뷰 기능 업데이트입니다. 같이 보면 방향이 더 선명합니다. 개발 도구는 "실행 후 탐지"에서 "실행 전 보류", "사람 리뷰 감"에서 "컨텍스트가 붙은 리뷰", "개별 도구 설정"에서 "정책과 증거가 흐르는 평면"으로 이동하고 있습니다. 이 글은 [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [npm v12 Install-Time Trust Gate](/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/), [AI Code Review Governance](/posts/2026-03-06-ai-code-review-governance-trend/), [MCP Native Secret Scanning](/posts/2026-05-24-mcp-native-secret-scanning-shift-left-trend/)과 이어집니다.

참고한 공식 신호:

- GitHub Changelog, Copilot code review: Agent skills and MCP now generally available: https://github.blog/changelog/2026-07-29-copilot-code-review-agent-skills-and-mcp-now-generally-available/
- GitHub Changelog, npm publish-time malware scanning and dual-use metadata: https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/
- GitHub Changelog, Dependabot alerts on malicious packages across more ecosystems: https://github.blog/changelog/2026-07-28-dependabot-alerts-on-malicious-packages-across-more-ecosystems/
- GitHub Changelog, GitHub Actions holds potentially malicious workflows for approval: https://github.blog/changelog/2026-07-28-github-actions-holds-potentially-malicious-workflows-for-approval/
- Cloudflare Changelog, MCP 2026-07-28 stateless server support: https://developers.cloudflare.com/changelog/

## 이 글에서 얻는 것

- publish-time scanning, install-time scanning, workflow pre-run approval의 차이를 구분할 수 있습니다.
- Copilot code review의 skills/MCP GA가 코드 리뷰 운영에 어떤 의미를 갖는지 이해할 수 있습니다.
- 릴리스 자동화가 package availability delay와 manual review 상태를 견디도록 바꾸는 기준을 잡을 수 있습니다.
- AI 코드 리뷰에 외부 컨텍스트를 붙일 때 read-only, attribution, freshness, token scope를 어떤 순서로 볼지 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) 공급망 보안 게이트가 publish 시점으로 올라왔다

오픈소스 패키지 공격은 설치하는 쪽에서만 막기 어렵습니다. 악성 패키지가 공개되고 몇 분만 지나도 CI, 로컬 개발 환경, 자동 업데이트 봇이 받아 갈 수 있습니다. 그래서 최근 흐름은 "사용자가 설치할 때 경고"뿐 아니라 "패키지가 공개되기 전에 잠깐 멈춤"으로 이동합니다.

GitHub가 공개한 npm publish-time scanning은 새로 publish된 패키지를 공개 전에 검사하고, 결과에 따라 정상 공개, 수동 검토, 차단으로 나눕니다. 일반적인 지연은 몇 분 수준으로 안내되지만, peak나 패키지 특성에 따라 더 길어질 수 있습니다. 실무에서 중요한 점은 보안 기능 자체보다 **릴리스 자동화의 가정이 깨진다는 것**입니다.

많은 파이프라인은 아래 흐름을 가정합니다.

```text
npm publish -> npm install package@new-version -> smoke test -> tag release
```

publish 직후 install 가능하지 않을 수 있다면 이 흐름은 불안정해집니다. 이제는 availability polling, timeout, blocked 상태 알림, 수동 appeal 경로를 넣어야 합니다. 특히 SDK, CLI, internal package registry mirror를 운영하는 팀은 "publish 성공"과 "사용 가능"을 같은 상태로 보면 안 됩니다.

### 2) Dual-use package는 의도 설명도 릴리스 계약이 된다

보안 도구, penetration test helper, credential scanner, browser automation, network probing 도구는 합법적인 목적이 있어도 악성 패턴과 비슷하게 보일 수 있습니다. npm의 새 dual-use metadata 요구는 이런 패키지가 `package.json`의 `contentPolicy`와 루트 `DISCLOSURE` 텍스트 파일로 의도와 합법 사용 맥락을 설명하도록 유도합니다. 2FA가 강제되는 publishing 방식도 요구됩니다.

이 흐름은 단순 서류 작업처럼 보일 수 있지만, 시니어 관점에서는 공급망 provenance의 일부입니다. "우리 패키지는 왜 이런 기능을 포함하는가", "누가 어떤 인증 강도로 publish하는가", "보안팀이 검토할 때 어떤 파일을 읽는가"가 릴리스 산출물에 포함됩니다. 코드는 같아도 설명 가능한 패키지와 설명 없는 패키지의 운영 위험은 다릅니다.

실무 기준:

- 보안 관련 기능이 있으면 dual-use 여부를 release checklist에서 먼저 판단
- `contentPolicy`와 `DISCLOSURE` 변경은 보안 리뷰 대상으로 분류
- publish 주체는 trusted publishing 또는 2FA-enforced 흐름 우선
- granular token이 2FA 우회 성격을 갖는지 점검
- `DISCLOSURE`는 과장 홍보가 아니라 기능, 의도한 사용, 제한을 짧게 설명

### 3) Workflow도 token을 잡기 전에 멈춰야 한다

GitHub Actions가 악성 가능성이 있는 workflow를 실행 전 승인 대기시키는 흐름은 CI 보안에서 중요한 전환입니다. 최근 공급망 공격은 계정 탈취나 compromised credential로 workflow를 밀어 넣고, 실행된 workflow가 CI/CD credential을 훔치는 방식으로 번집니다. 이때 workflow가 시작된 뒤 탐지하면 이미 secret이 노출됐을 수 있습니다.

그래서 pre-run hold는 "편의 기능"보다 피해 반경 축소 장치에 가깝습니다. 다만 자동 hold를 만능으로 보면 안 됩니다. 이 보호가 적용되는 범위, public repository 조건, 승인자의 권한, enterprise 환경 차이를 알아야 합니다. 그리고 팀 내부 기준은 별도로 필요합니다.

최소 기준:

- 새 workflow 파일 또는 권한 변경 PR은 CODEOWNERS 리뷰 필수
- job-level `permissions:`를 명시하고 기본 broad token에 기대지 않음
- third-party action은 full-length commit SHA pin 우선
- secret 접근 job은 external PR, fork, untrusted trigger에서 분리
- 승인 대기 workflow는 24시간 안에 owner가 판정, 불명확하면 닫음
- workflow 실행 전후에 token scope와 artifact upload 경로를 검토

이 관점은 [CI-native Agent Runner](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)와도 연결됩니다. 코딩 에이전트가 CI runner에서 움직이는 시대에는 workflow 하나가 사람 개발자보다 더 넓은 자동 실행 권한을 가질 수 있습니다.

### 4) Code review는 diff 밖의 context를 읽기 시작했다

7월 29일 Copilot code review의 agent skills와 MCP server context GA는 리뷰 표면의 변화를 보여 줍니다. 기존 AI 리뷰는 대체로 PR diff와 주변 파일을 보고 코멘트를 달았습니다. 이제는 repository나 organization의 `.github/skills`에 있는 팀 표준, 내부 도구 규칙, issue tracker, 문서 시스템, service catalog 같은 외부 컨텍스트를 리뷰에 연결할 수 있습니다. GitHub 설명에서 MCP tool call은 read-only로 제한되고, skill/MCP 기반 코멘트 attribution도 표시됩니다.

이것은 코드 리뷰가 "모델이 코드를 잘 읽는가"에서 "모델이 어떤 컨텍스트를 어떤 권한으로 읽었는가"로 이동한다는 뜻입니다. 같은 diff라도 사내 API deprecation 문서, service owner, 보안 예외 정책, 장애 이력, SLO 기준을 읽으면 리뷰 품질이 달라집니다. 반대로 오래된 문서나 과도한 권한을 읽으면 그럴듯한 오답도 더 강해집니다.

Review context plane의 최소 구성:

| 요소 | 좋은 기준 | 위험 신호 |
| --- | --- | --- |
| Agent skill | repo 표준, 테스트 기준, 금지 패턴이 버전 관리됨 | 일반론 prompt를 organization 표준처럼 사용 |
| MCP context | issue, docs, catalog를 read-only로 조회 | write token, broad admin token, stale docs |
| Attribution | 코멘트가 어떤 skill/MCP 근거를 썼는지 표시 | "AI가 봤다" 외 증거 없음 |
| Freshness | 문서 updated_at, policy version 확인 | 오래된 설계 문서 인용 |
| Review gate | 보안/성능/호환성 기준별 checklist | 코멘트 수를 품질 지표로 사용 |

### 5) 자동화의 핵심 지표는 차단 수가 아니라 처리 시간이다

보안 게이트를 도입하면 차단 수가 늘어날 수 있습니다. 하지만 차단 수가 늘었다고 성공은 아닙니다. false positive가 길게 쌓이면 팀은 우회 경로를 만들고, release pressure가 큰 팀은 보안 기능을 끄고 싶어집니다. 그래서 지표는 "얼마나 많이 막았나"보다 "위험한 것을 얼마나 빨리 분류하고, 정상 릴리스를 얼마나 적게 방해했나"에 가까워야 합니다.

권장 지표:

- publish availability p95: 5~15분 범위에서 관측
- publish blocked rate와 appeal resolution time
- dual-use package review lead time
- workflow hold count와 승인/거절 비율
- held workflow의 secret access 여부
- Copilot review MCP attribution rate
- skill 기반 코멘트의 accepted/fixed rate
- stale context 사용률
- review comment false positive rate

특히 release pipeline은 `publish_success_at`과 `install_available_at`을 분리해서 기록해야 합니다. 둘의 차이가 커지면 배포 대기, mirror lag, downstream smoke 실패가 연결됩니다.

## 실무 적용

### 1) 릴리스 파이프라인을 availability-aware로 바꾼다

패키지 publish 자동화는 이제 아래 상태를 구분해야 합니다.

```yaml
package_release_state:
  - PUBLISH_SUBMITTED
  - PUBLISH_ACCEPTED
  - SCANNING_PENDING
  - AVAILABLE_FOR_INSTALL
  - HELD_FOR_REVIEW
  - BLOCKED
  - APPEAL_REQUESTED
```

`npm publish` 명령이 성공했다고 바로 downstream smoke를 시작하지 않습니다. 새 버전이 install 가능한지 registry에서 확인하고, 15분을 넘으면 `HELD_OR_DELAYED`로 운영 알림을 보냅니다. blocked 상태라면 자동 retry보다 maintainer와 보안 owner가 changelog, package diff, dual-use metadata를 확인해야 합니다.

### 2) Dual-use checklist를 릴리스 템플릿에 넣는다

아래 항목 중 하나라도 해당하면 일반 release보다 강하게 봅니다.

- credential, token, cookie, browser session을 읽거나 조작한다.
- network scan, exploit reproduction, fuzzing, malware detection 기능이 있다.
- CI/CD credential, cloud metadata, local filesystem을 넓게 접근한다.
- 사용자가 입력한 script나 command를 실행한다.
- 보안 제품이나 red-team 도구와 기능이 겹친다.

해당하면 `contentPolicy`, `DISCLOSURE`, 2FA-enforced publishing, maintainer list, package provenance를 확인합니다. 이 절차는 귀찮지만, publish-time scanner가 package 의도를 판단할 때 필요한 맥락을 미리 준비하는 일이기도 합니다.

### 3) Workflow 승인 정책을 코드로 만든다

Actions hold가 자동 적용되는 범위 밖에서도 팀 정책은 필요합니다. `.github/workflows` 변경에는 별도 CODEOWNERS를 두고, 새 secret 접근이나 permissions 확대가 있으면 security owner 리뷰를 요구합니다. workflow-lint를 두어 `pull_request_target`, broad `contents: write`, unpinned third-party action, artifact upload path를 검사합니다.

기본 우선순위:

1. secret 접근 job과 untrusted trigger 분리
2. job-level permissions 최소화
3. third-party action SHA pinning
4. workflow 변경 CODEOWNERS
5. suspicious workflow hold 처리 런북

자동 보호는 마지막 방어선이고, repository 정책은 첫 번째 설계선입니다.

### 4) Code review context를 read-only 제품으로 운영한다

Copilot code review에 MCP와 skills를 붙일 때는 "많이 연결"보다 "읽기 전용으로 정확히 연결"이 중요합니다.

초기 추천 구성:

- `.github/skills/security-review/SKILL.md`: 사내 금지 패턴, secret handling, auth 기준
- `.github/skills/api-compatibility/SKILL.md`: API 호환성, deprecation, response schema 기준
- MCP docs server: read-only token, 최근 문서 updated_at 표시
- MCP issue tracker: PR 관련 issue와 acceptance criteria만 조회
- service catalog: owner, SLO, oncall, tier 정보 조회

연결 후에는 review comment에 어떤 skill이나 MCP context가 쓰였는지 확인합니다. Attribution이 없거나 너무 일반적인 코멘트만 나온다면 context plane이 실제 품질을 높이지 못하는 것입니다.

### 5) Security와 developer experience를 같은 대시보드에서 본다

보안 게이트는 개발자 경험과 분리하면 실패합니다. 릴리스가 자주 막히는데 이유를 모르면 팀은 우회합니다. 반대로 아무 것도 안 막히면 게이트가 의미 있는지 알기 어렵습니다.

대시보드에는 최소한 아래가 있어야 합니다.

- 패키지 publish 대기 시간 p50/p95
- scanner hold/block 사유 상위 10개
- workflow hold 후 승인까지 걸린 시간
- security owner SLA 초과 건수
- Copilot review skill/MCP attribution 비율
- false positive로 닫힌 보안 코멘트 비율
- 릴리스 rollback 또는 hotfix와 보안 게이트의 상관관계

개발자에게 필요한 것은 "보안 때문에 막혔다"가 아니라 "어떤 정책 때문에 막혔고, 어떤 증거를 추가하면 풀리는가"입니다.

## 트레이드오프/주의점

첫째, publish-time scanning은 ecosystem 보호에는 유리하지만 release latency를 만듭니다. 즉시 배포가 중요한 incident hotfix에서는 이 지연을 release plan에 넣어야 합니다. 내부 registry mirror나 staged rollout이 없다면 외부 registry availability가 전체 hotfix 시간을 결정할 수 있습니다.

둘째, dual-use metadata는 합법적 도구를 설명하는 장치지만, 잘못 쓰면 보안 홍보 문서가 됩니다. `DISCLOSURE`는 기능 과시가 아니라 검토자가 오해하지 않도록 의도, 제한, 안전한 사용 맥락을 설명해야 합니다.

셋째, workflow pre-run hold는 모든 CI 공격을 막지 않습니다. 이미 신뢰된 workflow 안에서 악성 dependency가 실행되거나, maintainer token이 탈취된 경우에는 다른 방어선이 필요합니다. secret scope, action pinning, runtime isolation, artifact 검증을 함께 봐야 합니다.

넷째, 코드 리뷰 context가 많아지면 AI 코멘트가 더 권위 있어 보입니다. 하지만 외부 문서가 오래됐거나 issue acceptance criteria가 바뀌었으면 틀린 리뷰도 더 설득력 있게 나옵니다. context freshness budget과 source attribution이 없으면 품질은 오히려 흔들릴 수 있습니다.

다섯째, read-only MCP라고 해서 완전히 안전한 것은 아닙니다. 읽기 권한도 민감합니다. issue tracker, service catalog, 보안 문서, 고객 장애 기록은 코드 diff보다 더 민감할 수 있습니다. token scope와 로그 보존을 작게 시작해야 합니다.

## 체크리스트 또는 연습

- [ ] 패키지 release pipeline이 publish 성공과 install 가능 상태를 분리한다.
- [ ] npm publish 후 5분, 15분, blocked 상태별 처리 루틴이 있다.
- [ ] dual-use 가능성이 있는 패키지는 `contentPolicy`, `DISCLOSURE`, 2FA-enforced publishing을 점검한다.
- [ ] workflow 변경 PR에는 CODEOWNERS와 permissions diff 검사가 있다.
- [ ] suspicious workflow hold가 발생했을 때 승인자, 증거, SLA가 정해져 있다.
- [ ] Copilot code review skills는 repo 표준을 담고 version control된다.
- [ ] MCP 연결은 read-only token, 최소 scope, source attribution, freshness 기준을 갖는다.
- [ ] review 코멘트 품질은 comment count가 아니라 accepted/fixed rate와 false positive rate로 본다.

연습으로 현재 조직의 npm package 하나와 GitHub Actions workflow 하나를 골라 보세요. 패키지는 publish 직후 install 가능 여부를 어떻게 확인할지, blocked 되면 누가 무엇을 볼지 적습니다. Workflow는 어떤 trigger에서 어떤 secret을 잡는지, 새 workflow가 추가될 때 누가 승인해야 하는지 적습니다. 마지막으로 Copilot code review에 붙일 repository skill 하나를 정하고, 그 skill이 일반 조언이 아니라 팀의 실제 기준을 담고 있는지 확인하면 됩니다.

## 함께 보면 좋은 글

- [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)
- [npm v12 Install-Time Trust Gate](/posts/2026-07-10-npm-v12-install-time-trust-gate-trend/)
- [AI Code Review Governance](/posts/2026-03-06-ai-code-review-governance-trend/)
- [CI-native Agent Runner](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)
- [MCP Native Secret Scanning](/posts/2026-05-24-mcp-native-secret-scanning-shift-left-trend/)
