---
title: "2026 개발 트렌드: npm v12 Install-Time Trust Gate, 패키지 설치가 실행 허가 계약으로 바뀐다"
date: 2026-07-10T10:06:00+09:00
draft: false
tags: ["npm", "Supply Chain Security", "JavaScript", "CI/CD", "Trusted Publishing", "Package Management"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["npm v12", "install-time security", "allowScripts", "approve-scripts", "supply chain security", "trusted publishing"]
description: "npm v12의 install script 기본 차단, Git/remote dependency opt-in, 2FA-bypass token 축소를 바탕으로 패키지 설치 시점의 신뢰 경계가 어떻게 바뀌는지 정리합니다."
lastmod: 2026-07-10
summary: "npm v12는 패키지 설치를 '다운로드하면 자동 실행'에서 '프로젝트가 승인한 실행만 허용'으로 바꿉니다. 이제 CI와 개발자 장비의 dependency install은 보안 계약과 allowlist 관리 대상입니다."
key_takeaways:
  - "npm v12는 dependency lifecycle script, Git dependency, remote URL dependency를 기본 opt-in으로 바꾸며 install-time 실행 경계를 좁힌다."
  - "install allowlist는 package.json에 커밋되는 운영 계약이 되며, CI는 unreviewed script를 warning으로 흘려보낼지 실패시킬지 정책을 가져야 한다."
  - "2FA-bypass GAT 축소와 trusted publishing/staged publishing 전환은 publish 권한도 장기 토큰에서 승인 기반 흐름으로 이동하고 있음을 보여준다."
operator_checklist:
  - "CI 이미지를 npm 11.16.0+ 또는 v12로 올려 install script warning과 allowlist 후보를 수집한다."
  - "`npm approve-scripts --allow-scripts-pending` 결과를 코드 리뷰 대상으로 만들고 native module, browser binary download, Electron 계열을 분리한다."
  - "publish token, trusted publishing, staged publishing, package owner 2FA 상태를 릴리스 런북에 포함한다."
  - "dependency bot PR이 package.json의 allowlist를 바꾸면 일반 버전 업데이트가 아니라 실행 권한 변경으로 리뷰한다."
  - "release build에서는 unapproved script, Git dependency, remote URL dependency exception을 모두 실패 조건으로 둔다."
learning_refs:
  - title: "Package Release Quarantine Gate"
    href: "/posts/2026-05-12-package-release-quarantine-gate-trend/"
    description: "패키지 릴리스를 보안 이벤트로 보고 격리·검증하는 흐름입니다."
  - title: "Dependency Update Pipeline"
    href: "/posts/2026-05-07-dependency-update-pipeline-trend/"
    description: "의존성 업데이트를 패치 속도, 호환성 테스트, 롤백 기준으로 운영하는 방법입니다."
  - title: "CI/CD 보안과 공급망"
    href: "/learning/deep-dive/deep-dive-cicd-security-supply-chain/"
    description: "GitHub Actions, 권한, 토큰, 캐시, 공급망 방어 기준을 다룹니다."
decision_guide:
  title: "Install-Time Trust Gate를 언제 엄격하게 적용할까"
  intro: "패키지 설치가 개발자 장비와 CI runner에서 실행 권한을 얻는 순간, allowlist는 보안 옵션이 아니라 실행 계약이 됩니다."
  cases:
    - badge: "즉시 엄격 적용"
      title: "CI runner가 cloud secret, publish 권한, 배포 권한을 가진다"
      fit: "설치 중 악성 script가 실행되면 production credential이나 registry publish 권한에 닿을 수 있는 팀입니다."
      watchouts: "warning만 보고 넘어가면 v12의 이점을 거의 얻지 못합니다."
      next_step: "CI에서 strict allowlist와 package owner review를 먼저 켭니다."
    - badge: "단계 적용"
      title: "프론트엔드·Electron·native module 의존성이 많다"
      fit: "Playwright, Puppeteer, Cypress, Electron, sharp, bcrypt처럼 설치 시 binary download/build가 필요한 프로젝트입니다."
      watchouts: "무작정 차단하면 개발 환경 bootstrap이 깨질 수 있습니다."
      next_step: "현재 트리를 snapshot approve한 뒤 불필요 script를 줄입니다."
    - badge: "관측 우선"
      title: "개인 프로젝트나 low-risk 내부 도구"
      fit: "민감한 secret과 publish 권한이 없는 작은 프로젝트입니다."
      watchouts: "낮은 위험이어도 새 dependency가 script를 추가하는 순간 위험이 바뀝니다."
      next_step: "npm 11.16.0+ warning과 allowlist diff를 먼저 기록합니다."
---

2026년 7월 8일 GitHub Changelog에서 npm v12가 `latest`로 올라왔고, install-time security 기본값이 실제로 켜졌습니다. 핵심은 간단합니다. 의존성의 `preinstall`, `install`, `postinstall` lifecycle script와 implicit `node-gyp` build는 더 이상 자동 실행되지 않습니다. Git dependency와 remote URL dependency도 기본적으로 resolve되지 않고, 프로젝트가 명시적으로 허용해야 합니다. 동시에 npm은 2FA-bypass granular access token의 민감 작업 권한을 단계적으로 줄이고, 자동 publish는 trusted publishing 또는 staged publishing으로 옮기라고 안내하고 있습니다.

이 변화는 JavaScript 생태계의 사소한 breaking change가 아닙니다. 패키지 설치가 "다운로드 + 자동 실행"이던 시대에서, "다운로드와 실행 허가를 분리하는 시대"로 넘어가는 신호입니다. 저는 이 흐름을 **Install-Time Trust Gate**라고 부르는 편이 맞다고 봅니다. dependency update, CI build, local bootstrap, package publish가 모두 같은 공급망 경계 안에 들어왔기 때문입니다.

이 글은 [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/), [AI Code Provenance와 SBOM](/posts/2026-03-08-ai-code-provenance-and-sbom-trend/), [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)과 이어집니다. 이전 글들이 "새 패키지를 받아도 되는가"와 "릴리스가 믿을 만한가"를 다뤘다면, 이번 글은 "설치 중 어떤 코드가 실행될 자격이 있는가"를 다룹니다.

## 이 글에서 얻는 것

- npm v12의 install-time security 기본값이 실제 운영 경계에서 무엇을 바꾸는지 이해합니다.
- install script allowlist를 코드 리뷰, CI 정책, dependency update pipeline에 연결하는 기준을 잡을 수 있습니다.
- native module, browser automation tool, Electron, Git dependency가 많은 프로젝트의 마이그레이션 순서를 정리합니다.
- 2FA-bypass token 축소와 trusted publishing 전환을 package release 운영 관점으로 해석합니다.

## 핵심 개념/이슈

### 1) 패키지 설치는 이미 실행 표면이었다

`npm install`은 오랫동안 "의존성을 받는 명령"처럼 보였지만, 실제로는 dependency tree 안의 코드가 개발자 장비와 CI runner에서 실행될 수 있는 표면이었습니다. lifecycle script는 native module build, browser binary download, hook 설치, code generation에 유용했습니다. 문제는 유용한 실행 경로와 악성 실행 경로가 같은 문을 쓴다는 점입니다.

npm v12의 변화는 이 문을 기본적으로 닫습니다.

| 대상 | v12 기본값 | 의미 |
| --- | --- | --- |
| dependency lifecycle scripts | 승인 없으면 실행 안 함 | transitive dependency script 실행 차단 |
| implicit `node-gyp` build | 승인 필요 | native addon도 allowlist 대상 |
| Git dependency | `--allow-git=none` | Git source resolve를 명시 허가로 전환 |
| remote URL dependency | `--allow-remote=none` | HTTPS tarball 같은 비 registry 경로 차단 |
| approve/deny scripts | `package.json` allowlist | 실행 허가가 코드 리뷰 대상이 됨 |

여기서 중요한 것은 npm이 모든 공급망 공격을 해결했다는 뜻이 아니라는 점입니다. typosquatting, compromised maintainer, malicious runtime code, dependency confusion은 여전히 남습니다. 다만 **설치 시점에 자동 실행되는 가장 편한 경로**가 기본 차단으로 바뀌었습니다. 공격면이 사라진 것이 아니라, 공격자가 다른 단계에서 실행 허가를 얻어야 하는 구조가 된 것입니다.

### 2) allowlist는 보안 설정이 아니라 소스 코드 계약이다

GitHub의 안내는 `npm approve-scripts --allow-scripts-pending`으로 승인 후보를 보고, 신뢰하는 script를 승인한 뒤 결과 allowlist를 `package.json`에 커밋하라고 설명합니다. 이 지점이 핵심입니다. 실행 허가가 개인 노트북의 로컬 설정이 아니라 repository 안의 계약이 됩니다.

좋은 allowlist에는 최소 네 가지 정보가 따라야 합니다.

- 어떤 package script를 허용하는가
- 왜 필요한가
- 어떤 버전 또는 범위까지 허용하는가
- 누가 재검토할 책임을 가지는가

실무 기준은 아래처럼 잡을 수 있습니다.

| 패키지 유형 | 허용 판단 |
| --- | --- |
| native module (`sharp`, `bcrypt`, DB driver 등) | 필요성 높음, version pinning과 rebuild 환경 고정 |
| browser binary download (`playwright`, `puppeteer`, `cypress`) | explicit install command 분리 검토 |
| Electron | 앱 build pipeline owner 승인 필요 |
| Husky/git hooks | install script 대신 명시 bootstrap으로 이동 가능 |
| unknown transitive script | 기본 보류, owner 확인 전 deny 후보 |
| Git/remote URL dependency | registry package나 vendored source로 대체 우선 |

무조건 하나씩 토론하다가 rollout이 멈추는 것도 위험합니다. 기존 프로젝트는 먼저 현재 tree를 snapshot approve하고, 새로 등장하는 script를 막는 방식이 현실적입니다. 그다음 2~4주 동안 불필요한 script를 `deny-scripts`로 줄이면 됩니다.

### 3) warning-only와 fail-closed 사이에 정책이 필요하다

npm v12의 기본 동작은 모든 unapproved script 때문에 install을 즉시 실패시키는 방식이 아니라, script를 skip하고 warning을 남기는 쪽입니다. 이 기본값은 생태계 충격을 줄이지만, 기업 CI에서는 warning이 쉽게 묻힙니다. 따라서 팀은 어디서 fail-closed로 바꿀지 정해야 합니다.

권장 정책:

- local developer install: warning + 링크 + bootstrap 안내
- pull request CI: unapproved new script 발견 시 실패
- main branch CI: unapproved script 0건 유지
- release build: strict allowlist + lockfile diff 검증
- production image build: install-time secret 최소화, publish token 없음

특히 release build runner가 cloud credential, package publish 권한, deploy key를 가진다면 warning-only는 부족합니다. 설치 중 실행되는 코드는 그 권한을 읽거나 네트워크로 보낼 수 있습니다. [CI-native Agent Runner와 Actions Token](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)에서 다룬 것처럼 runner 권한은 작업 편의가 아니라 신뢰 경계입니다.

### 4) Git/remote dependency 차단은 "비표준 경로"를 드러낸다

많은 팀이 `package.json`에 Git URL이나 HTTPS tarball을 잠깐 넣고 잊습니다. hotfix, fork, private patch, vendor SDK 미공개 버전 같은 이유입니다. npm v12는 이 경로도 기본 차단합니다. 이유는 단순합니다. registry package와 달리 Git/remote dependency는 provenance, review, caching, integrity, lifecycle script 정책이 흐려지기 쉽습니다.

의사결정 기준은 아래처럼 둡니다.

- 임시 fork가 2주 이상 유지된다 → 내부 registry package로 publish하거나 upstream PR 계획을 세운다.
- remote tarball이 production build에 들어간다 → checksum, mirror, owner, 만료일을 기록한다.
- Git dependency가 transitive로 들어온다 → 직접 dependency owner에게 registry release를 요구한다.
- 보안 패치 때문에 급히 쓴다 → exception 만료일 30일 이하와 follow-up issue를 둔다.

이 기준은 [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/)과 맞물립니다. 업데이트 자동화가 dependency를 올리는 것만 보고, 설치 경로가 registry인지 Git인지 remote URL인지 보지 않으면 중요한 신뢰 정보를 놓칩니다.

### 5) Publish 권한도 장기 토큰에서 승인 흐름으로 이동한다

이번 발표에는 install-time security만 있는 것이 아닙니다. npm은 2FA-bypass GAT가 민감한 account/package/org 관리 작업에서 2FA를 건너뛰지 못하게 하고, 이후에는 direct publish 권한도 줄여 staged publishing과 trusted publishing으로 이동하라고 안내했습니다.

흐름은 분명합니다.

- 설치 시점: dependency script 자동 실행을 줄인다.
- 배포 시점: 장기 publish token의 직접 공개 권한을 줄인다.
- 승인 시점: 사람 2FA, OIDC trusted publishing, staged approval을 결합한다.

이제 package release는 "CI가 토큰으로 publish"가 아니라 "어떤 workflow가 어떤 identity로 어떤 package를 어떤 승인 뒤 publish하는가"가 되어야 합니다. [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)에서 말한 격리·검증 기준이 npm v12 이후에는 더 자연스러운 기본 운영 모델이 됩니다.

## 실무 적용

### 1) 현재 install script 표면을 snapshot한다

첫 주 목표는 완벽한 차단이 아니라 보이는 상태를 만드는 것입니다.

```bash
npm --version
npm install
npm approve-scripts --allow-scripts-pending
```

결과를 아래 표로 정리합니다.

```yaml
install_script_inventory:
  project: web-console
  npm_min_version_checked: "11.16.0"
  packages:
    - name: sharp
      reason: image transform native addon
      owner: platform-web
      decision: approve_pinned
    - name: playwright
      reason: browser binary download
      owner: qa-platform
      decision: move_to_explicit_install
    - name: unknown-transitive-package
      reason: not understood
      owner: dependency-review
      decision: deny_or_replace
```

처음부터 모든 package를 보안팀이 직접 판단하려 하면 속도가 안 납니다. native module, browser tool, Electron, Git hooks, unknown transitive script로 나누고 owner를 붙이는 편이 빠릅니다.

### 2) CI 정책을 세 단계로 나눈다

1단계는 관측입니다. PR마다 allowlist diff와 pending script 목록을 comment나 artifact로 남깁니다.

2단계는 신규 script 차단입니다. 기존 allowlist는 인정하되, PR에서 새 install script가 추가되면 실패시킵니다.

3단계는 release strict 모드입니다. main/release branch에서는 unapproved script, Git dependency, remote URL dependency를 모두 실패시킵니다.

운영 숫자:

- unapproved install script: release branch 0건
- Git/remote dependency exception: 30일 이하 만료
- install allowlist owner 없는 항목: 0건
- dependency bot PR 중 allowlist 변경 포함 비율: 주간 리뷰
- CI install warning 미분류: 7일 이상 방치 금지

이 수치를 [Code Quality Policy Gate](/posts/2026-06-25-code-quality-policy-gate-trend/)처럼 조직 정책으로 연결하면 좋습니다. 단순히 "보안 옵션을 켰다"가 아니라 "새 실행 경로가 들어오면 리뷰가 필요하다"는 gate가 됩니다.

### 3) 개발자 경험을 망치지 않는 bootstrap 경로를 제공한다

보안 기본값이 바뀌면 현장은 "설치가 깨졌다"로 느낍니다. 특히 Playwright, Cypress, Puppeteer, Electron, native addon을 쓰는 팀은 불편을 바로 맞습니다. 그래서 개발자 안내는 짧고 실행 가능해야 합니다.

좋은 안내:

- `npm install` 뒤 어떤 warning이 정상인지 보여준다.
- browser binary download는 `npm run setup:browsers`처럼 explicit command로 분리한다.
- native module build 실패 시 필요한 OS package와 Node version을 안내한다.
- allowlist 변경 PR에는 owner와 이유를 요구한다.
- 모르는 transitive script는 임시 승인보다 issue 생성으로 보낸다.

나쁜 안내:

- "보안상 알아서 승인하세요"
- "warning은 무시해도 됩니다"
- 모든 프로젝트에 같은 allowlist를 복사
- CI에서만 엄격하고 로컬은 문서 없음

Install-Time Trust Gate는 개발자 경험과 충돌할 수 있지만, 충돌을 줄이는 해법은 차단을 푸는 것이 아니라 explicit bootstrap을 제공하는 것입니다.

### 4) publish 권한을 같이 정리한다

install script만 정리하고 publish token을 방치하면 절반짜리 개선입니다. 릴리스 workflow에서 아래를 같이 점검합니다.

- npm publish가 장기 토큰으로 직접 실행되는가?
- trusted publishing OIDC subject가 repo/branch/tag 기준으로 제한되는가?
- staged publishing 또는 human 2FA approval이 필요한 package는 무엇인가?
- package maintainer 변경, access 변경, token 생성이 2FA 없는 자동화로 가능한가?
- release workflow가 외부 PR artifact나 cache를 신뢰하지 않는가?

이 점검은 [Third-party OAuth 공급망](/posts/2026-04-22-third-party-oauth-supply-chain-trend/)과도 연결됩니다. 패키지 publish 권한은 단순 secret이 아니라 생태계에 코드를 배포하는 권한입니다.

### 5) PR 리뷰와 릴리스 증거를 분리한다

Install-Time Trust Gate를 도입할 때 자주 생기는 실수는 모든 검증을 하나의 CI job에 밀어 넣는 것입니다. PR에서는 "새 실행 경로가 생겼는가"를 빠르게 판정해야 하고, release에서는 "승인된 실행 경로만 실제로 실행되는가"를 더 엄격하게 봐야 합니다. 둘을 같은 기준으로 묶으면 PR은 느려지고, release는 느슨해집니다.

PR 단계의 증거는 작고 명확해야 합니다.

```yaml
dependency_execution_review:
  lockfile_changed: true
  package_json_allowlist_changed: true
  new_lifecycle_scripts:
    - package: "@vendor/native-image"
      script: "install"
      owner: "platform-web"
      reason: "native binary build"
      decision: "approve_pinned"
  git_or_remote_dependencies:
    - package: "internal-sdk"
      source: "git"
      expires_at: "2026-08-09"
      replacement: "publish scoped registry package"
```

이 정도면 reviewer가 봐야 할 질문이 분명해집니다. "버전이 올라갔는가"가 아니라 "새 코드가 설치 중 실행될 권한을 얻었는가", "registry가 아닌 경로가 들어왔는가", "예외 만료일이 있는가"입니다. dependency bot이 만든 PR도 같은 방식으로 봐야 합니다. 봇이 lockfile만 바꾼 것이 아니라 install allowlist까지 바꿨다면 그 PR은 보안·플랫폼 owner의 리뷰를 타야 합니다.

release 단계에서는 증거가 더 엄격해야 합니다.

- `npm ci` 또는 동등한 clean install에서 pending script가 0건인지 확인한다.
- allowlist가 변경된 commit에는 owner와 사유가 붙어 있는지 확인한다.
- Git/remote dependency exception이 만료되지 않았는지 확인한다.
- release runner에 npm publish token, cloud admin credential, deploy key가 동시에 노출되지 않는지 확인한다.
- install warning을 artifact로 남기되, release branch에서는 warning을 실패 조건으로 승격한다.

이렇게 분리하면 developer experience를 너무 망치지 않으면서도 release 경계는 닫을 수 있습니다. 로컬과 PR은 관측과 빠른 피드백, release는 실패 조건과 감사 증거를 맡는 구조입니다.

### 6) 롤백은 보안 해제가 아니라 예외 축소로 설계한다

엄격 모드를 켰다가 build가 깨지면 가장 쉬운 롤백은 전체 차단을 끄는 것입니다. 하지만 그렇게 하면 도입 이유가 사라집니다. 더 나은 롤백은 범위를 줄이는 것입니다.

예를 들어 release job에서 unapproved script 때문에 실패했다면 아래 순서로 되돌립니다.

1. 해당 package가 직접 dependency인지 transitive dependency인지 확인한다.
2. native build, browser download, git hook, unknown script 중 어느 그룹인지 분류한다.
3. 필요한 경우 특정 package만 임시 approve하고, 만료일과 owner를 적는다.
4. Git/remote dependency라면 registry package 전환 issue를 같이 만든다.
5. 실패한 CI log와 승인 diff를 release note나 운영 기록에 남긴다.

롤백 문서에는 "검증을 껐다"가 아니라 "어떤 실행 경로를 얼마 동안 예외로 열었다"가 남아야 합니다. 이 차이가 중요합니다. 전자는 보안 설정을 원점으로 돌리는 것이고, 후자는 운영 계약을 좁게 예외 처리하는 것입니다.

간단한 exception ledger는 아래처럼 충분합니다.

```yaml
install_time_exceptions:
  - package: "playwright"
    script: "install"
    allowed_until: "2026-08-10"
    owner: "qa-platform"
    reason: "browser binary download used by e2e tests"
    follow_up: "move browser install to explicit setup job"
  - package: "internal-sdk"
    source: "git"
    allowed_until: "2026-07-31"
    owner: "platform-api"
    reason: "security hotfix before registry publish"
    follow_up: "publish @company/internal-sdk 4.8.2"
```

예외가 ledger에 들어가면 dependency update pipeline과 연결할 수 있습니다. 30일이 지난 Git dependency는 자동으로 알림을 보내고, owner 없는 install script는 release gate에서 실패시키며, 반복 승인되는 package는 별도 bootstrap command로 분리합니다.

## 트레이드오프/주의점

첫째, npm v12는 공급망 보안의 끝이 아닙니다. 설치 script가 막혀도 package runtime code는 애플리케이션 안에서 실행됩니다. 악성 dependency가 import된 뒤 credential을 읽거나 네트워크 호출을 하는 위험은 여전히 남습니다. 따라서 SBOM, lockfile review, runtime permission, egress policy와 같이 봐야 합니다.

둘째, allowlist를 너무 넓게 잡으면 효과가 줄어듭니다. `--all`로 현재 tree를 승인하는 것은 rollout 시작점으로는 현실적이지만, 그것을 영구 정책으로 방치하면 "새 script만 막는" 수준에 머뭅니다. 2~4주 안에 불필요 script를 줄이는 follow-up이 필요합니다.

셋째, strict 정책을 너무 빨리 전체 적용하면 생산성이 깨질 수 있습니다. 특히 native addon과 browser automation 도구가 많은 프로젝트는 install 경로가 복잡합니다. 우선 release branch, production image, publish workflow부터 엄격하게 하고, 로컬 개발은 명확한 warning과 setup command를 제공하는 편이 낫습니다.

넷째, Git/remote dependency 예외는 계속 부채가 됩니다. 보안 패치 때문에 어쩔 수 없이 쓰더라도 owner, 만료일, checksum, 대체 계획이 없으면 몇 달 뒤 아무도 기억하지 못하는 공급망 구멍이 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] npm 11.16.0+ 또는 v12에서 install script pending 목록을 확인했다.
- [ ] allowlist 변경은 `package.json` diff로 코드 리뷰된다.
- [ ] release branch CI는 unapproved script, Git dependency, remote URL dependency를 차단한다.
- [ ] native module과 browser binary download는 owner와 이유가 문서화되어 있다.
- [ ] 장기 npm publish token을 trusted publishing 또는 staged publishing으로 전환하는 계획이 있다.
- [ ] dependency bot PR에서 install allowlist 변경이 생기면 보안/플랫폼 owner가 리뷰한다.

### 연습 과제

1. 프로젝트 하나를 골라 `npm approve-scripts --allow-scripts-pending` 결과를 `native build`, `browser download`, `git hook`, `unknown transitive` 네 그룹으로 분류해 보세요.
2. release workflow에서 `npm install`이 실행되는 시점에 어떤 secret과 token이 환경에 있는지 적어 보세요. 설치 중 실행 코드가 볼 수 있는 값이 곧 위험 표면입니다.
3. Git/remote URL dependency가 하나 있다고 가정하고, 30일 만료 예외 문서와 registry package 전환 계획을 10줄로 작성해 보세요.

## 출처 링크

- [GitHub Changelog: npm install-time security and GAT bypass2fa deprecation](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)
- [GitHub Changelog: Upcoming breaking changes for npm v12](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/)
- [GitHub Community: Preparing for npm v12](https://github.com/orgs/community/discussions/198547)

## 관련 글

- [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)
- [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/)
- [AI Code Provenance와 SBOM](/posts/2026-03-08-ai-code-provenance-and-sbom-trend/)
- [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)
- [CI-native Agent Runner와 Actions Token](/posts/2026-07-04-ci-native-agent-runner-actions-token-trend/)
