---
title: "2026 개발 트렌드: Rust MSRV, 빌드 설정이 아니라 라이브러리 소비자와 맺는 호환성 계약이 된다"
date: 2026-10-04T10:06:00+09:00
lastmod: 2026-10-04T10:06:00+09:00
draft: false
tags: ["Rust", "MSRV", "Dependency Management", "CI", "Release Engineering", "Open Source"]
categories: ["Development", "Platform Engineering", "Release Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["Rust MSRV", "minimum supported Rust version", "Rust dependency compatibility", "cargo MSRV CI", "library release contract"]
description: "Rust 라이브러리의 최소 지원 Rust 버전(MSRV)을 Cargo 설정 한 줄이 아니라 transitive dependency, feature 조합, 보안 패치, CI matrix, deprecation notice까지 포함한 소비자 호환성 계약으로 관리하는 기준을 정리합니다."
summary: "최신 stable에서 빌드된다는 사실은 오래된 toolchain을 쓰는 소비자가 다음 patch release를 설치할 수 있다는 뜻이 아니다. Rust 생태계에서 MSRV는 패키지 메타데이터·의존성 선택·feature 조합·보안 업데이트·지원 종료 통지에 걸쳐 움직이는 release contract가 되고 있다."
key_takeaways:
  - "MSRV는 Rust version 하나가 아니라 lockfile, optional dependency, build dependency, target, feature 조합에서 재현돼야 하는 소비자 계약이다."
  - "minor·patch release의 MSRV 상향은 SemVer만으로 충분히 전달되지 않으므로 명시적 지원 정책과 CI 증거가 필요하다."
  - "최신 stable과 MSRV를 모두 시험하되 모든 조합을 무작정 곱하지 말고, 공개 API·기본 feature·지원 target을 우선순위로 matrix화해야 한다."
  - "지원 종료가 필요하면 사전 경고, 마지막 호환 release, security fix의 backport 범위를 정해 소비자의 upgrade runway를 만든다."
operator_checklist:
  - "각 public crate에 `rust-version`, 지원 policy, 마지막 검증 날짜, 기본/중요 feature의 MSRV CI 결과를 남긴다."
  - "의존성 update PR은 newest stable뿐 아니라 최소 toolchain의 `cargo check`와 lockfile resolution을 통과시킨다."
  - "MSRV 상향은 release note와 migration issue에 원인·영향 crate·최소 지원 종료일을 기록한다."
  - "매월 dependency graph를 재해결해 MSRV drift와 yanked·보안 advisory에 따른 선택지 변화를 점검한다."
---

Rust 팀이 compiler 성능을 계속 개선하고, crate 생태계가 더 빠르게 새 언어 기능과 dependency를 받아들이면서 “우리 라이브러리는 어느 Rust 버전까지 지원하는가”가 다시 중요한 운영 문제가 되고 있습니다. 많은 팀이 `rust-version = "1.xx"`를 `Cargo.toml`에 적고 끝내지만, 소비자가 실제로 겪는 호환성은 그 한 줄보다 넓습니다. optional feature가 켜질 때만 들어오는 crate, build script, macro, target별 코드, lockfile이 고르는 transitive version 중 하나만 최소 compiler보다 새로워도 설치·빌드는 깨집니다.

이 변화는 최신 compiler를 쓰지 말자는 이야기가 아닙니다. 최신 stable은 보안 수정과 생산성에 중요합니다. 다만 공개 crate·공유 SDK·사내 platform library는 producer가 업그레이드한 날과 consumer가 toolchain을 올릴 수 있는 날이 다릅니다. 따라서 MSRV(Minimum Supported Rust Version)는 개발자의 로컬 설정이 아니라 **다음 release를 설치하는 소비자가 의존할 수 있는 호환성 계약**으로 다뤄야 합니다.

이 글은 [Rust 컴파일러 성능과 CI 변경 예산](/posts/2026-10-01-rust-compiler-performance-ci-change-budget-trend/), [TypeScript 지원 기간과 SDK 업그레이드 계약](/posts/2026-08-12-typescript-compiler-support-window-sdk-upgrade-contract-trend/), [Engineering Standards Lifecycle](/posts/2026-08-21-engineering-standards-lifecycle-enforcement-trend/), [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)의 관점을 Rust crate 배포에 적용합니다. 목표는 지원 버전을 오래 붙잡는 것이 아니라, 올릴 때의 영향과 출구를 예측 가능하게 만드는 것입니다.

## 이 글에서 얻는 것

- `rust-version` 선언과 실제 의존성 해석·feature 조합 검증의 차이를 구분합니다.
- 공개 crate와 내부 서비스가 서로 다른 MSRV 정책을 가져야 하는 이유를 판단합니다.
- 최신 stable·MSRV·지원 target을 과도한 CI 비용 없이 검증하는 우선순위 matrix를 만듭니다.
- MSRV 상향, 보안 patch, 지원 종료 공지를 소비자 migration runway로 설계합니다.

## 핵심 개념/이슈

### 1) MSRV는 compiler pin이 아니라 설치 가능성의 하한이다

`package.rust-version`은 이 crate가 요구하는 최소 Rust 언어·compiler 수준을 전달하는 중요한 메타데이터입니다. 하지만 실제 소비자는 crate 하나를 컴파일하지 않습니다. Cargo는 dependency graph를 해석하고, feature를 합치며, build dependency와 proc macro를 빌드하고, target에 맞는 코드를 선택합니다. 그래서 CI의 최신 stable에서 `cargo test`가 초록이라는 사실은 MSRV 소비자가 같은 graph를 선택할 수 있다는 증거가 아닙니다.

대표적인 drift는 다음처럼 생깁니다.

| 변화 | 최신 stable에서 보이는 결과 | MSRV 소비자에게 생길 수 있는 문제 |
| --- | --- | --- |
| transitive crate의 patch update | lockfile 갱신 후 정상 | 새 crate가 더 높은 Rust를 요구해 resolve 또는 compile 실패 |
| optional feature 추가 | 기본 CI는 정상 | feature 사용 고객만 새 language feature·build dependency를 만남 |
| proc macro 업데이트 | application은 정상 | macro crate의 MSRV가 올라 compile 초기에 중단 |
| target별 dependency 변경 | Linux runner는 정상 | Windows·musl·embedded 소비자만 실패 |

그러므로 “MSRV 1.xx 지원”의 실질적인 뜻은 적어도 공개된 기본 feature와 지원 target에서 그 toolchain으로 dependency graph가 해석되고 컴파일된다는 뜻이어야 합니다. 모든 과거 Rust patch와 모든 target을 매 commit에 전수 시험할 필요는 없습니다. 대신 무엇을 지원한다는지 좁고 검증 가능하게 표현해야 합니다. 예를 들어 “MSRV와 최신 stable에서 default feature + `serde` feature를 Linux로 테스트하고, release 전 Windows를 확인한다”는 정책은 평가할 수 있습니다. “오래된 Rust도 아마 된다”는 정책은 그렇지 않습니다.

### 2) SemVer와 MSRV change는 같은 축이 아니다

공개 API가 전혀 바뀌지 않아도 MSRV가 올라가면 toolchain을 올릴 수 없는 소비자는 새 patch version조차 채택할 수 없습니다. 이는 API compatibility와 별개인 **build-time compatibility** 변화입니다. 어떤 생태계·조직은 MSRV 상향을 minor release로 간주하고, 어떤 팀은 명확한 정책과 사전 공지가 있으면 patch에서 허용합니다. 어느 쪽이든 중요한 것은 관례를 숨기지 않는 것입니다.

특히 보안 advisory가 특정 dependency 업데이트를 요구할 때 딜레마가 생깁니다. 새 dependency 버전이 MSRV를 올린다면 “안전한 최신 버전”과 “기존 toolchain 호환 버전”이 갈라집니다. 이때 단순 pin은 영구 해결책이 아닙니다. owner가 있는 예외로 두고 **30~90일**의 종료일, backport 가능 여부, 소비자별 migration 상태를 기록해야 합니다. 지원하는 마지막 호환 branch를 유지할지, feature를 분리할지, MSRV를 올릴지의 선택은 CVSS 점수만이 아니라 노출 경로·완화책·consumer blast radius로 결정합니다.

### 3) 지원 범위에는 feature와 target도 포함된다

Rust의 feature unification은 workspace·의존성 관계에 따라 예상 밖의 feature를 켤 수 있습니다. 라이브러리가 기본 feature만 MSRV에서 검증하면서 문서에는 모든 feature를 지원한다고 쓰면, 소비자는 compile error를 제품 결함으로 맞게 인식합니다. native TLS, async runtime, derive macro처럼 MSRV가 흔들리기 쉬운 feature는 별도 matrix 행으로 승격하는 편이 안전합니다.

target 역시 소비자 계약입니다. 서버 crate라면 `x86_64-unknown-linux-gnu` 하나로 시작할 수 있지만, SDK가 macOS·Windows·musl·WASM을 문서에 열거한다면 release 전 최소 check가 있어야 합니다. 타협안은 commit마다 **MSRV × default feature × primary Linux target**과 **latest stable × 주요 feature**를 돌리고, nightly 또는 release candidate에서 target matrix를 확장하는 것입니다. CI 대기열이 15분을 넘거나 실패 원인 분리가 어려워지면 matrix를 더 늘리기보다 cache·job 분리·release gate 순서를 먼저 개선합니다.

## 실무 적용

### 1) 먼저 소비자별 toolchain inventory를 만든다

공개 crate는 downloads 수보다 실제 중요 소비자에게 물어야 합니다. 장기 지원 Linux 배포판, corporate base image, embedded SDK, offline build 환경처럼 toolchain upgrade가 느린 경로를 inventory로 만듭니다. 내부 shared crate도 마찬가지입니다. 최근 **90일** CI artifact에서 `rustc -Vv`, target, 사용 feature를 모으면 “최소 지원 버전”이 추측이 아닌 근거가 됩니다.

그 다음 세 집단을 구분합니다. (1) 다음 분기에 compiler를 올릴 수 있는 최신 경로, (2) release train에 묶여 **3~6개월** 유예가 필요한 경로, (3) 지원 종료를 협의해야 하는 예외 경로입니다. 모두를 최저 버전에 묶어 두면 보안·성능·언어 개선을 놓치고, 반대로 예고 없이 올리면 platform library가 조직 전체 빌드를 멈춥니다. MSRV는 기술 선택인 동시에 consumer segmentation 정책입니다.

### 2) manifest 선언, CI 증거, release note를 같은 변경으로 묶는다

`Cargo.toml`의 `rust-version`을 변경하는 PR에는 최소 toolchain의 `cargo check --locked`, 주요 feature compile, 최신 stable test 결과를 붙입니다. library라면 test보다 compile check가 MSRV drift를 빨리 잡지만, 공개 API와 runtime behavior가 있는 대표 경로는 latest stable에서 반드시 테스트합니다. lockfile이 있는 repository는 `--locked`로 실제 release graph를 고정하고, lockfile을 배포하지 않는 crate도 별도 resolution job에서 최소 compiler와 호환되는 선택을 확인해야 합니다.

권장 release gate는 세 단계입니다.

1. **PR**: MSRV의 default feature `check`와 latest stable의 lint/test. 실패는 merge block.
2. **nightly**: MSRV의 중요 optional feature와 primary target. 실패는 issue와 owner를 만들고 7일 안에 분류.
3. **release candidate**: 지원 target·feature matrix, 새 dependency resolution, upgrade guide. unknown 결과면 publish 보류.

이 구조는 compiler별 모든 test를 반복하는 비용을 피하면서도 계약의 핵심을 지킵니다. [CI 변경 예산](/posts/2026-10-01-rust-compiler-performance-ci-change-budget-trend/)처럼 job duration, queue time, flaky rate를 함께 측정하세요. MSRV 검증이 느리다는 이유로 지우기 전에 어떤 feature나 target이 병목인지 먼저 알아야 합니다.

### 3) MSRV 상향은 지원 종료와 탈출 경로를 같이 공지한다

상향이 필요하면 release note에 새 버전만 쓰지 말고 “왜, 누가 영향을 받고, 언제까지 무엇을 할 수 있는가”를 적습니다. 예를 들어 `1.78 → 1.82` 상향이라면 필요한 security patch·dependency·language feature, 마지막 호환 crate version, 이전 branch에서 제공할 security fix 범위, 최소 **30일**의 migration notice를 함께 둡니다. crate README와 metadata의 `rust-version`만 바꾸면 lockfile을 갱신하는 소비자는 CI가 깨진 뒤에야 사실을 알게 됩니다.

긴급 취약점에서는 notice 기간을 줄일 수 있지만 그 선택도 기록해야 합니다. 심각한 취약점이 runtime에서 외부 입력으로 도달하고 우회가 없다면 빠른 MSRV 상향이 합리적일 수 있습니다. 반대로 dev-only dependency이거나 feature를 끌 수 있다면 compatible branch patch를 먼저 제공할 여지가 있습니다. 핵심은 “security니까 무조건 최신으로 올려라”가 아니라, **위험 감소와 consumer 중단을 같은 의사결정 표에 놓는 것**입니다.

## 트레이드오프/주의점

1. **낮은 MSRV는 무료가 아니다.** 새 표준 라이브러리·compiler bug fix·dependency 보안 패치를 늦추고, 조건부 구현과 CI matrix를 늘릴 수 있다.
2. **높은 MSRV도 단순화만 만들지 않는다.** 사용자 base image와 내부 toolchain rollout이 느리면 업그레이드 비용이 crate maintainer에서 모든 consumer로 이동한다.
3. **metadata 선언만 믿지 않는다.** `rust-version`은 의도이며, 실제 증거는 특정 graph·feature·target을 최소 compiler로 해석하고 컴파일한 CI 결과다.
4. **최소 compiler test가 최신 compiler test를 대체하지 않는다.** 보안·clippy·새 target·runtime regression은 최신 stable에서 별도로 봐야 한다.
5. **지원 종료 예외는 TTL이 필요하다.** 오래된 compatibility branch를 무기한 유지하면 취약점 patch와 release 책임이 모호해진다.

## 체크리스트 또는 연습

### release 체크리스트

- [ ] public crate의 `rust-version`, 지원 policy, 기본/주요 feature, 지원 target을 문서에 명시했다.
- [ ] PR에서 MSRV `cargo check --locked`와 latest stable test를 통과시킨다.
- [ ] optional dependency·proc macro·build dependency가 MSRV를 끌어올리지 않는지 resolution 결과를 확인한다.
- [ ] CI matrix는 primary path를 merge gate로, 나머지 target·feature를 nightly/release gate로 우선순위화했다.
- [ ] MSRV 상향 시 마지막 호환 release, migration notice, security backport 범위, owner와 종료일을 기록한다.
- [ ] 월 1회 dependency 재해결 결과와 MSRV drift를 review한다.

### 연습

팀의 Rust crate 하나를 골라 현재 `rust-version`과 실제 CI toolchain을 비교하세요. 다음으로 default feature, 가장 많이 쓰이는 optional feature, 대표 target 세 가지를 적고 각각이 최소 compiler에서 컴파일되는지 확인합니다. 마지막으로 취약한 transitive dependency가 새 Rust를 요구한다고 가정해 보세요. MSRV를 즉시 올릴지, compatible branch patch를 낼지, feature를 분리할지와 그 결정을 종료일·consumer 공지·release note에 어떻게 남길지 작성해 보면 정책의 빈틈을 발견할 수 있습니다.

## 관련 글

- [Rust 컴파일러 성능을 CI 변경 예산으로 만드는 법](/posts/2026-10-01-rust-compiler-performance-ci-change-budget-trend/)
- [TypeScript 지원 기간과 SDK 업그레이드 계약](/posts/2026-08-12-typescript-compiler-support-window-sdk-upgrade-contract-trend/)
- [Engineering Standards Lifecycle과 점진적 강제](/posts/2026-08-21-engineering-standards-lifecycle-enforcement-trend/)
- [Consumer-Driven Contract Testing으로 호환성 검증하기](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)
