---
title: "2026 개발 트렌드: TypeScript 지원 창이 움직인다, SDK 업데이트가 컴파일러 수명주기 계약이 된다"
date: 2026-08-12T10:06:00+09:00
lastmod: 2026-08-12T10:06:00+09:00
draft: false
tags: ["TypeScript", "AWS SDK", "Dependency Management", "Build Engineering", "Developer Experience", "Release Engineering"]
categories: ["Development", "TypeScript", "Release Engineering"]
series: ["dev-trends"]
keywords: ["AWS SDK JavaScript TypeScript support window", "TypeScript compiler lifecycle", "TypeScript 5.5 end of support", "SDK upgrade policy", "type compatibility CI"]
description: "AWS SDK for JavaScript v3의 2.5년 TypeScript 지원 창 전환을 계기로, 컴파일러 버전·SDK·타입 패키지의 호환성을 inventory, CI matrix, migration runway와 예외 TTL로 관리하는 법을 정리합니다."
summary: "TypeScript 컴파일러가 오래되면 애플리케이션 runtime이 바뀌지 않아도 최신 SDK의 선언 파일을 해석하지 못해 빌드가 깨질 수 있습니다. 컴파일러 버전을 개발 도구 취향이 아니라 계속 움직이는 의존성 지원 계약으로 관리해야 합니다."
key_takeaways:
  - "AWS SDK for JavaScript v3는 2027년 1월 4일부터 최근 2.5년 안에 발표된 TypeScript 버전만 지원하는 rolling window를 적용할 예정이다."
  - "이번 변화는 runtime breaking change가 아니라 type-level 호환성 변화지만, 오래된 compiler에서 최신 SDK update가 CI build failure로 나타날 수 있다."
  - "SDK pinning은 단기 완화일 뿐 최신 update·security patch·기능을 받지 못할 수 있으므로 owner와 종료일이 있는 예외로 관리해야 한다."
  - "팀은 compiler age, 다음 cutoff까지 남은 날짜, typecheck matrix, skipLibCheck 예외를 하나의 dependency runway로 관측해야 한다."
operator_checklist:
  - "모든 workspace의 TypeScript 실제 해석 버전을 lockfile 기준으로 inventory하고 compiler age가 18개월을 넘으면 migration issue를 만든다."
  - "현재 compiler와 목표 compiler를 CI에서 병렬 typecheck하고 새 진단을 오류 유형·package owner별로 분류한다."
  - "AWS SDK package를 섞인 minor 버전으로 두지 말고 lockfile에서 @aws-sdk/* 버전 집합과 최소 TypeScript 요구를 검증한다."
  - "SDK pin 또는 skipLibCheck 예외에는 최대 90일 TTL, 보안 영향, 제거 테스트와 owner를 붙인다."
learning_refs:
  - title: "Dependency Update Pipeline"
    href: "/posts/2026-05-07-dependency-update-pipeline-trend/"
    description: "의존성 업데이트를 자동 PR이 아니라 분류·검증·rollout pipeline으로 운영하는 기준입니다."
  - title: "Runtime Security Patch Runway"
    href: "/posts/2026-07-22-runtime-security-patch-runway-trend/"
    description: "지원 종료일과 패치 가능 기간을 운영 runway로 관리하는 방법입니다."
  - title: "Package Release Quarantine Gate"
    href: "/posts/2026-05-12-package-release-quarantine-gate-trend/"
    description: "새 package 버전을 바로 production에 넣지 않고 격리 검증하는 흐름입니다."
  - title: "서비스 의존성 Inventory와 Ownership"
    href: "/learning/deep-dive/deep-dive-service-dependency-inventory-ownership-playbook/"
    description: "버전보다 먼저 owner와 영향 범위를 찾을 수 있게 만드는 기본기입니다."
decision_guide:
  title: "오래된 TypeScript를 어떻게 처리할까"
  intro: "무조건 최신으로 올리거나 SDK를 영구 고정하는 양극단 대신 cutoff, 코드 규모, 보안 패치 필요성과 검증 비용으로 결정합니다."
  cases:
    - badge: "Upgrade now"
      title: "compiler age가 18개월 이상이거나 cutoff가 180일 안이다"
      fit: "활성 개발 중이고 AWS SDK·@types·lint 도구를 계속 업데이트해야 하는 서비스"
      watchouts: "strictness와 module resolution 변화가 한 번에 섞이면 원인 분리가 어렵다."
      next_step: "compiler만 먼저 올린 dual CI를 만들고 tsconfig 강화는 별도 PR로 분리한다."
    - badge: "Short pin"
      title: "릴리스 freeze 중이고 즉시 compiler migration이 어렵다"
      fit: "현재 lockfile 재현과 보안 영향 검토가 가능하며 30~90일 안에 업그레이드할 owner가 있는 경우"
      watchouts: "SDK pin이 길어지면 security patch와 서비스 API 변화가 누적된다."
      next_step: "마지막 호환 SDK 버전, expires_at, 보안 검토 주기와 제거 issue를 기록한다."
    - badge: "Isolate legacy"
      title: "monorepo 일부 package만 오래된 compiler·framework에 묶여 있다"
      fit: "전체 repository 일괄 업그레이드보다 경계 분리가 빠른 경우"
      watchouts: "공유 source와 declaration을 양쪽 compiler가 다르게 해석할 수 있다."
      next_step: "legacy package를 build boundary로 격리하고 생성된 API contract를 consumer test로 검증한다."
faqs:
  - question: "Node.js runtime도 같이 올려야 하나요?"
    answer: "이번 AWS 발표의 직접 대상은 TypeScript compiler의 type-level 호환성입니다. 다만 새 compiler와 toolchain이 지원하는 Node.js 범위는 별도이므로 package engine, CI image, production runtime을 각각 확인해야 합니다."
  - question: "skipLibCheck를 켜면 해결되나요?"
    answer: "일부 선언 파일 검사 오류를 우회할 수 있지만 compiler가 새 문법 자체를 parse하지 못하는 문제나 애플리케이션 타입 오류는 해결하지 못합니다. 사용하더라도 owner와 짧은 만료일이 있는 임시 예외로 관리해야 합니다."
  - question: "SDK를 pin하면 안전한가요?"
    answer: "빌드 재현에는 도움이 되지만 AWS는 pin된 구버전 경로가 최신 SDK update, security patch, 새 기능을 받지 못한다고 안내합니다. 따라서 무기한 해법이 아니라 migration runway를 확보하는 단기 조치입니다."
---

TypeScript 팀에서 컴파일러 버전은 오랫동안 “빌드가 되면 당장 건드리지 않아도 되는 개발 도구”로 취급되곤 했습니다. 그러나 최신 SDK와 타입 생태계가 지원하는 컴파일러 범위를 계속 앞으로 이동시키면서 이 가정이 깨지고 있습니다. 애플리케이션의 Node.js runtime이나 배포 코드가 그대로여도, 의존성의 `.d.ts`가 새로운 문법과 타입 기능을 사용하면 오래된 compiler는 CI 단계에서 멈춥니다.

AWS는 2026년 7월 15일 AWS SDK for JavaScript v3의 TypeScript 지원 정책을 바꾼다고 발표했습니다. **2027년 1월 4일부터 최근 2.5년 안에 발표된 TypeScript 버전만 지원**합니다. DefinitelyTyped가 2년 미만 버전을 테스트하는 정책에 6개월 grace period를 더한 rolling window입니다. `<=5.5`는 2027년 1월 4일, 5.6은 3월 31일, 5.7은 5월 31일, 5.8은 9월 30일, 5.9는 2028년 2월 29일에 SDK 지원 창 밖으로 나가는 일정이 제시됐습니다.

이 글은 이 발표를 특정 SDK의 공지로만 보지 않습니다. [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/), [Runtime Security Patch Runway](/posts/2026-07-22-runtime-security-patch-runway-trend/), [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [서비스 의존성 Inventory와 Ownership](/learning/deep-dive/deep-dive-service-dependency-inventory-ownership-playbook/)을 TypeScript compiler와 type package까지 확장합니다.

참고한 공식 신호:

- AWS Developer Tools Blog, Updating TypeScript version support in AWS SDK for JavaScript v3: https://aws.amazon.com/blogs/developer/updating-typescript-version-support-in-aws-sdk-for-javascript-v3/
- AWS SDKs and Tools maintenance policy: https://docs.aws.amazon.com/sdkref/latest/guide/maint-policy.html
- DefinitelyTyped README, Support Window: https://github.com/DefinitelyTyped/DefinitelyTyped#support-window
- typescript-eslint, Dependency Versions: https://typescript-eslint.io/users/dependency-versions/
- AWS SDK for JavaScript v3 repository: https://github.com/aws/aws-sdk-js-v3

## 이 글에서 얻는 것

- runtime 호환성과 compiler·declaration 호환성이 왜 별도 계약인지 이해합니다.
- 현재 repository가 rolling support window에서 얼마나 남았는지 inventory하는 방법을 얻습니다.
- compiler upgrade, SDK pin, legacy package 격리를 어떤 조건으로 선택할지 판단합니다.
- CI matrix, 예외 TTL, migration runway를 숫자로 운영하는 기준을 가져갑니다.

## 핵심 개념/이슈

### 1) 실행 코드는 같아도 타입 선언에서 빌드가 깨질 수 있다

이번 변화는 AWS가 명시한 대로 runtime breaking change가 아닙니다. JavaScript로 변환된 코드가 AWS API를 호출하는 방식보다 **최신 SDK가 배포하는 타입 선언을 오래된 TypeScript가 해석할 수 있느냐**가 핵심입니다.

호환성은 최소 세 층입니다.

| 층 | 대표 질문 | 실패 시 증상 |
| --- | --- | --- |
| runtime | 현재 Node.js가 생성된 JavaScript를 실행하는가 | 시작 실패, syntax/runtime error |
| compiler | `tsc`가 source와 dependency declaration을 parse·check하는가 | CI typecheck 실패 |
| toolchain | ESLint, test runner, bundler plugin이 compiler 범위를 지원하는가 | lint/build plugin 실패 |

팀이 “Node.js 버전은 지원 중”이라고 답해도 TypeScript compiler가 지원 창 밖이면 최신 `@aws-sdk/*`를 설치한 dependency PR이 깨질 수 있습니다. 반대로 compiler를 올렸지만 production Node target과 `lib`, `moduleResolution`을 무심코 바꾸면 생성물 동작이 달라질 수 있습니다. 버전을 한 덩어리로 보지 말고 각각 inventory해야 합니다.

### 2) 고정된 최소 버전이 아니라 시간에 따라 움직이는 창이다

`TypeScript >= 5.5` 같은 고정 조건은 시간이 지나면 다시 낡습니다. AWS의 새 기준은 발표일로부터 최근 2.5년이라는 **rolling window**입니다. 지금 통과한 버전도 release date가 창 밖으로 나가면 지원 대상에서 빠집니다.

운영 상태는 다음처럼 표현할 수 있습니다.

```yaml
typescript_support:
  workspace: "services/order-api"
  resolved_compiler: "5.6.x"
  compiler_released_at: "2024-09-24"
  aws_sdk_cutoff_at: "2027-03-31"
  days_to_cutoff: 231
  aws_sdk_version_set: "resolved-from-lockfile"
  next_compiler_tested: "5.9.x"
  owner: "commerce-platform"
  exception_expires_at: null
```

중요한 값은 `package.json`의 range가 아니라 lockfile과 CI에서 실제 해석되는 compiler입니다. root에는 5.9가 있지만 legacy workspace가 자체 `node_modules`에서 5.6을 쓰거나, editor가 global TypeScript를 쓰면 로컬과 CI 결과가 달라질 수 있습니다.

### 3) 타입 생태계 전체가 오래된 compiler 지원 비용을 줄이고 있다

AWS 발표는 DefinitelyTyped가 2년 미만 TypeScript만 테스트하고, typescript-eslint도 이 지원 창을 따른다는 점을 근거로 듭니다. AWS SDK만 이전 버전으로 고정해도 `@types/node`, `@types/react`, lint plugin 같은 다른 축에서 호환성 문제가 먼저 나타날 수 있습니다.

이 흐름의 이유는 단순한 최신 버전 선호가 아닙니다.

- 새 declaration syntax를 오래된 compiler용으로 downlevel하는 release 단계가 필요합니다.
- 여러 compiler 버전을 CI matrix에서 계속 테스트해야 합니다.
- package artifact에 호환용 타입 복사본이 늘어납니다.
- 유지보수자가 오래된 compiler 전용 issue를 분석해야 합니다.

AWS는 downlevel type이 SDK 공개 package 크기의 **18%**를 차지한다고 설명합니다. 공급자에게 지원 창 축소는 build·publish 복잡도와 artifact 크기를 줄이는 선택입니다. 소비자에게는 compiler migration 책임이 더 분명해지는 변화입니다.

### 4) “최신 SDK + 오래된 compiler” 조합의 실패는 늦게 드러난다

애플리케이션 코드가 바뀌지 않았는데 dependency bot PR에서 갑자기 오류가 날 수 있습니다.

```text
node_modules/@aws-sdk/.../types.d.ts
  -> syntax parse error
  -> type instantiation error
  -> module resolution mismatch
  -> CI typecheck failed
```

이때 SDK 버전만 되돌리면 당장 초록색이 됩니다. 하지만 원인은 사라진 것이 아니라 미래로 미뤄집니다. 지원 창 밖 compiler에 머무는 동안 새 서비스 API, 버그 수정과 security patch가 누적됩니다. AWS도 pinning은 단기 선택이며 최신 SDK update, security patch와 기능을 받지 못한다고 안내합니다.

따라서 lockfile pin은 해결 상태가 아니라 **기한이 있는 compatibility exception**이어야 합니다.

```yaml
dependency_exception:
  package_family: "@aws-sdk/*"
  reason: "legacy TypeScript compiler"
  pinned_at: "2026-12-10"
  owner: "order-platform"
  expires_at: "2027-02-28"
  max_ttl_days: 90
  security_review_interval_days: 14
  removal_test: "pnpm typecheck:ts-next && pnpm test"
```

### 5) compiler upgrade와 strictness 강화는 분리해야 한다

TypeScript를 올리는 김에 `strict`, `noUncheckedIndexedAccess`, module system, target까지 한 번에 바꾸면 실패 원인을 분리하기 어렵습니다. compiler 문법 호환성, 새 진단, 생성물 변화, lint rule 변화가 한 PR에 섞입니다.

권장 순서:

1. 기존 `tsconfig`를 유지한 채 compiler만 목표 버전으로 올린다.
2. `noEmit` typecheck와 기존 compiler 결과를 비교한다.
3. type error를 application, dependency declaration, tool plugin으로 분류한다.
4. test·bundle·artifact diff를 확인한다.
5. compiler migration을 merge한 뒤 strictness 강화와 module target 변경을 별도 진행한다.

새 compiler가 더 많은 오류를 찾는 것은 migration 실패가 아니라 숨은 문제를 발견한 것일 수 있습니다. 다만 모든 진단을 같은 우선순위로 처리하면 일정이 늘어집니다. production bug 가능성이 있는 application error, build blocker인 syntax error, 임시 우회 가능한 third-party declaration error를 나눕니다.

### 6) skipLibCheck는 지원 계약을 대신하지 못한다

`skipLibCheck: true`는 declaration file의 타입 검사를 줄여 migration을 도울 수 있습니다. 하지만 새 compiler syntax를 구 compiler가 parse하지 못하는 경우, module resolution 자체가 맞지 않는 경우, 애플리케이션에서 드러나는 타입 오류까지 해결하지는 못합니다.

사용 기준:

- third-party declaration 내부의 중복·충돌이고 애플리케이션 boundary test가 있다.
- issue와 upstream link가 있고 owner가 지정됐다.
- TTL은 기본 14일, 최대 30일이다.
- compiler upgrade 완료 후 옵션 제거를 CI로 검증한다.

`skipLibCheck`를 repository 기본값으로 영구 설정하고 이유를 잊으면 dependency declaration drift를 늦게 발견합니다. 속도 최적화 목적으로 유지한다면 compatibility exception과는 별도로 typecheck 시간·오류 탐지 손실을 문서화해야 합니다.

## 실무 적용

### 1) Repository 전체의 실제 compiler를 inventory한다

monorepo에서는 root `package.json`만 보면 안 됩니다. workspace별로 아래를 수집합니다.

- lockfile에서 해석된 `typescript` 버전
- `tsc --version`을 실행하는 실제 working directory
- `@aws-sdk/*`, `@types/node`, typescript-eslint 버전 집합
- `tsconfig`의 `target`, `module`, `moduleResolution`, `lib`
- CI image의 Node.js와 package manager 버전
- editor가 workspace TypeScript를 사용하는지
- compiler release date와 다음 vendor cutoff

compiler age가 **18개월**을 넘으면 migration issue를 만들고, vendor cutoff가 **180일** 안이면 분기 backlog가 아니라 release 계획에 올립니다. 90일 안인데 owner가 없으면 dependency update를 계속 받기 어려운 운영 위험으로 분류합니다.

### 2) 현재와 목표 compiler를 dual CI로 비교한다

처음부터 기본 compiler를 바꾸지 말고 1~2주간 별도 job을 둡니다.

```yaml
typecheck_matrix:
  current:
    typescript: "workspace-locked"
    blocking: true
  target:
    typescript: "approved-next"
    blocking: false
    promotion_gate:
      new_application_errors: 0
      dependency_errors_with_owner: true
      typecheck_time_regression_percent: 20
      artifact_diff_reviewed: true
```

초기에는 target job을 non-blocking으로 두되 실패를 방치하지 않습니다. 오류를 fingerprint해 매일 남은 개수를 추적하고 5영업일 연속 감소가 없으면 owner와 범위를 다시 조정합니다. application error 0, 테스트 통과, typecheck p95 증가 20% 이하, bundle/artifact diff 검토를 승격 gate로 사용할 수 있습니다.

### 3) AWS SDK package family를 한 묶음으로 본다

AWS SDK v3는 여러 `@aws-sdk/*`, `@smithy/*` package로 나뉩니다. 직접 dependency 하나만 보고 판단하면 transitive package가 다른 minor로 풀려 declaration 조합이 달라질 수 있습니다.

검증 항목:

1. lockfile의 `@aws-sdk/*`와 `@smithy/*` resolved version 분포
2. Renovate·Dependabot이 package family를 group update하는지
3. compiler 최소 버전 검사가 dependency PR에 있는지
4. Lambda bundle 또는 container artifact 크기 변화
5. 실제 사용하는 S3, DynamoDB, STS 등 핵심 API smoke

package update PR에는 `install`, `typecheck`, unit test뿐 아니라 핵심 SDK 호출의 contract test를 붙입니다. 자격 증명 없이 가능한 serialization test와 별도 sandbox account의 최소 smoke를 분리하면 CI 권한을 줄일 수 있습니다.

### 4) Legacy package는 build boundary로 격리한다

오래된 framework나 plugin 때문에 monorepo 전체 compiler를 묶어 두지 않습니다. legacy workspace가 독립적으로 build되어 JavaScript와 안정된 API schema를 내보내게 만들고, 새 workspace는 지원 compiler를 사용합니다.

격리 기준:

- legacy source를 새 package가 직접 import하지 않는다.
- 공유 타입은 compiler-specific 고급 타입보다 JSON Schema, OpenAPI 또는 단순 DTO로 둔다.
- 양쪽에서 contract test를 실행한다.
- legacy build artifact에 provenance와 compiler version을 기록한다.
- 종료일과 교체 owner를 둔다.

격리는 영구적인 이중 toolchain 운영비를 만듭니다. legacy package가 3개를 넘거나 공통 타입 수정마다 양쪽에서 수동 조정이 필요하면 부분 격리보다 전체 migration이 쌀 가능성이 큽니다.

### 5) Migration 결과를 숫자로 닫는다

완료 보고에는 “TypeScript 업그레이드 완료” 대신 다음을 남깁니다.

| 항목 | 기준 예시 |
| --- | --- |
| workspace coverage | 대상 100% 또는 legacy 예외 목록 |
| new application type error | 0 |
| dependency declaration exception | owner·TTL 100% |
| unit/integration test | 기존 대비 통과율 동일 |
| typecheck p95 | 기준선 대비 +20% 이하 |
| bundle size | +5% 초과 시 원인 검토 |
| next cutoff runway | 최소 12개월 |
| SDK pin | 없음 또는 90일 이내 예외 |

compiler만 올리고 editor·CI·release image가 서로 다른 버전을 쓰면 재현성이 없습니다. merge 후 clean install, developer container, release build에서 `tsc --version`과 lockfile hash가 일치하는지 확인합니다.

## 트레이드오프/주의점

1. **빠른 compiler upgrade는 지원성과 진단 품질을 높이지만 migration 빈도를 늘립니다.** 매 버전을 즉시 올릴 필요는 없지만 compiler age budget은 필요합니다.
2. **SDK pin은 안정성을 주지만 패치 runway를 소비합니다.** freeze 기간의 단기 완화에는 유효해도 보안 검토 없이 장기 고정하면 위험합니다.
3. **dual CI는 비용이 듭니다.** 모든 test를 두 번 돌리기보다 target compiler에서는 typecheck와 영향 package test부터 실행하고 승격 직전에 전체 matrix를 돌립니다.
4. **새 진단을 무조건 suppress하면 upgrade 가치가 줄어듭니다.** `any`, `@ts-ignore`, `skipLibCheck` 증가량을 별도 metric으로 보고 suppress에는 이유와 만료일을 붙입니다.
5. **compiler 지원과 runtime 지원은 다릅니다.** TypeScript를 올렸다고 Node.js EOL이나 Lambda runtime 호환성이 해결되지 않습니다. 각각 별도 cutoff를 관리합니다.
6. **공식 일정도 바뀔 수 있습니다.** AWS 표의 DefinitelyTyped 종료일 일부는 추정치로 표시돼 있습니다. automation은 날짜를 영구 하드코딩하기보다 공식 README와 maintenance policy 확인 시각을 함께 기록합니다.

## 체크리스트 또는 연습

### 적용 체크리스트

- [ ] workspace별 실제 TypeScript 버전을 lockfile과 `tsc --version`으로 확인했다.
- [ ] compiler release date와 AWS SDK cutoff까지 남은 날짜를 기록했다.
- [ ] compiler age 18개월 또는 cutoff 180일 기준의 자동 issue가 있다.
- [ ] 현재·목표 compiler dual CI에서 오류 수와 typecheck 시간을 비교한다.
- [ ] compiler upgrade와 strictness·module target 변경을 별도 PR로 나눈다.
- [ ] `@aws-sdk/*`와 `@smithy/*`를 package family로 group update한다.
- [ ] SDK pin과 `skipLibCheck`에 owner, reason, expires_at, 제거 테스트가 있다.
- [ ] clean install, editor, CI, release build가 같은 compiler와 lockfile을 사용한다.
- [ ] legacy workspace는 명시적인 build boundary와 종료 계획이 있다.
- [ ] 다음 cutoff runway가 최소 12개월인지 release closeout에서 확인한다.

### 팀 연습

1. 현재 monorepo의 workspace별 `typescript`, `@types/node`, typescript-eslint, `@aws-sdk/*` 버전 표를 만들고 가장 짧은 지원 runway를 찾으세요.
2. 목표 compiler로 non-blocking typecheck를 추가하고 새 오류를 application, declaration, plugin 세 그룹으로 분류해 보세요.
3. SDK pin이 필요한 상황을 가정해 30일·90일 예외의 보안 검토 주기와 자동 만료 행동을 설계해 보세요.
4. `skipLibCheck`를 켰을 때와 껐을 때 오류 수·typecheck 시간·실제 package contract test 결과를 비교해 보세요.

이번 AWS 정책 변화의 핵심은 “TypeScript 5.5를 올려야 한다”는 한 번의 마이그레이션 공지가 아닙니다. **컴파일러도 시간이 지나면 지원 창 밖으로 이동하는 의존성**이라는 점입니다. 실제 해석 버전, cutoff까지 남은 시간, 목표 compiler 검증, 단기 예외의 종료일을 지속적으로 관리해야 SDK 업데이트와 보안 패치를 멈추지 않고 받을 수 있습니다.
