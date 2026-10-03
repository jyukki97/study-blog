---
title: "2026 개발 트렌드: Rust 컴파일러 성능 개선을 CI 변경 예산으로 바꾸는 법"
date: 2026-10-01T10:06:00+09:00
lastmod: 2026-10-01T10:06:00+09:00
draft: false
tags: ["Rust", "CI", "Build Performance", "Developer Experience", "Platform Engineering"]
categories: ["Development", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["Rust compiler performance", "CI build budget", "incremental build", "remote cache", "developer productivity"]
description: "최근 Rust 컴파일러 성능 개선 흐름을 단순한 언어 벤치마크가 아니라 PR 피드백 시간·CI 용량·검증 범위를 관리하는 변경 예산 관점에서 해석합니다."
summary: "컴파일러가 빨라졌다는 소식은 개발자의 몇 초를 아끼는 이야기로 끝나지 않는다. clean·incremental·test·link·queue 시간을 분리해 측정하면 팀은 빠른 변경을 더 자주 검증하고 더 작게 되돌릴 수 있다. 반대로 cache hit rate 하나만 보면 재현성·보안·tail latency를 놓친다."
---

Rust 컴파일러 팀의 9월 성능 정리는 LLVM 업그레이드, trait·borrow checking, 증분 데이터 처리 등 여러 개선이 실제 crate별 compile 시간을 바꿀 수 있음을 보여줬습니다. 일부 outlier crate에서는 큰 폭의 개선도 관찰됐지만, 이 숫자를 "우리 CI가 같은 비율로 빨라진다"고 읽으면 곤란합니다. workspace 구조, feature flag, proc macro, linker, target, container image, cache, runner 대기열이 다르면 병목 위치도 달라지기 때문입니다.

그럼에도 이 흐름이 중요한 이유는 분명합니다. 빌드 시간은 로컬 개발자의 불편이 아니라 **변경을 얼마나 자주, 얼마나 작은 단위로, 얼마나 충분히 검증할 수 있는가를 제한하는 운영 용량**입니다. PR이 20분 뒤에야 첫 신호를 주면 개발자는 변경을 묶고, 리뷰어는 큰 diff를 받고, 실패한 뒤의 원인 분리는 늦어집니다. 이 글은 2026년 9월 30일 Rust 컴파일러 성능 보고를 출발점으로, [Hermetic Build와 Remote Cache](/posts/2026-03-23-hermetic-build-remote-cache-trend/), [Code Quality Policy Gate](/posts/2026-06-25-code-quality-policy-gate-trend/), [TypeScript 지원 기간과 SDK 업그레이드 계약](/posts/2026-08-12-typescript-compiler-support-window-sdk-upgrade-contract-trend/), [CI/CD와 GitHub Actions](/learning/deep-dive/deep-dive-ci-cd-github-actions/)을 하나의 변경 예산으로 연결합니다.

공식 근거는 [Rust 컴파일러의 2026년 9월 성능 정리](https://nnethercote.github.io/2026/09/30/how-to-speed-up-the-rust-compiler-in-september-2026.html)와 [Rust compiler performance optimization 목표](https://goals.rust-lang.org/2026/compiler-performance-optimization.html)를 확인했습니다. 아래 숫자는 특정 프로젝트의 벤치마크 결과가 아니라, 팀이 측정을 시작할 때 사용할 수 있는 운영 기준선입니다.

## 이 글에서 얻는 것

- 컴파일러 성능 개선을 언어 선택 논쟁이 아니라 CI 처리량과 변경 안전성 관점에서 해석할 수 있습니다.
- clean build, incremental build, test compile, link, cache restore, queue time을 분리해 병목을 찾는 방법을 배웁니다.
- cache를 켜기 전에 재현성·격리·무효화·fallback을 결정하는 기준을 얻습니다.
- 빠른 빌드를 더 많은 검증으로 환원하는 rollout과 체크리스트를 정리합니다.

## 핵심 개념/이슈

### 1) 빌드 시간은 하나의 숫자가 아니라 여섯 개의 대기 시간이다

"CI가 18분 걸린다"는 측정만으로는 무엇을 고쳐야 할지 알 수 없습니다. 동일한 18분도 source compile이 느린 경우, test binary link가 느린 경우, cache가 빗나간 경우, runner가 비어 있지 않아 기다린 경우의 해법은 전혀 다릅니다. 최소한 아래 시간을 분리해 수집해야 합니다.

| 구간 | 질문 | 우선 대응 |
| --- | --- | --- |
| queue | runner를 기다렸는가 | 병렬도·우선순위·예약 용량 |
| dependency restore | artifact를 받았는가 | cache key·네트워크·압축 방식 |
| clean compile | 아무 cache 없이 얼마나 걸리는가 | crate 구조·compiler·codegen 병목 |
| incremental compile | 작은 수정이 얼마나 빨리 돌아오는가 | invalidation 범위·feature flag·proc macro |
| test/link | 컴파일 뒤 무엇이 오래 걸리는가 | link 전략·test sharding·실행 환경 |
| publish/image | 산출물을 조립하고 검증하는가 | layer cache·SBOM·signing 경로 |

Rust의 compiler 개선은 이 중 clean 또는 incremental compile을 줄일 수 있습니다. 하지만 proc macro 하나의 광범위한 invalidation, 느린 linker, 매번 바뀌는 container base image, 독점된 runner queue는 다른 층의 문제입니다. 전체 시간이 20% 줄었어도 queue가 10분이면 개발자가 느끼는 p95는 거의 변하지 않을 수 있습니다. 따라서 release note를 본 직후의 첫 일은 compiler upgrade가 아니라 **시간 분해와 기준선 고정**입니다.

### 2) 빨라진 빌드는 검증을 줄일 명분이 아니라 늘릴 여유다

팀이 build를 빠르게 만들고도 CI timeout을 그대로 두고, 큰 PR을 계속 허용하고, critical test를 nightly에만 남기면 성능 이득은 대기 시간 감소로 끝납니다. 더 좋은 사용법은 남은 시간을 변경 위험을 줄이는 데 배정하는 것입니다. 예를 들어 PR의 fast lane이 15분 안에 끝나면 lint·type check·unit·핵심 contract test를 묶고, 느린 integration·cross-target·fuzz는 merge queue 또는 nightly로 나눌 수 있습니다.

다만 "15분"은 보편적 목표가 아닙니다. 작은 서비스는 5분, 모노레포의 clean build는 30분일 수 있습니다. 중요한 것은 팀이 다음 세 수치를 함께 약속하는 일입니다.

- developer-facing fast lane p95: 예를 들어 **15분 이하**
- main branch의 필수 검증 성공률: flaky retry를 숨기지 않은 상태로 **98% 이상**
- critical path 변경의 rollback 가능한 단위: 되돌림 PR이 **하나의 배포 창** 안에 검증될 수 있는 크기

build가 빨라졌는데 PR이 더 커지기만 하면 품질은 좋아지지 않습니다. 반대로 fast lane이 안정되면 diff 크기, reviewer SLA, merge queue 정책을 조정할 근거가 생깁니다. 이 관점은 [빌드 도구 Gradle·Maven](/learning/deep-dive/deep-dive-build-tooling-gradle-maven/)의 build cache 논의와도 같습니다. 속도 자체가 목적이 아니라 더 짧은 피드백 루프를 안전하게 운영하는 것이 목적입니다.

### 3) cache hit rate는 결과 지표일 뿐, 신뢰 경계는 아니다

원격 cache는 의존성 compile과 중간 artifact를 재사용해 CI 비용을 줄일 수 있지만, 아무 artifact나 받아 쓰는 경로가 되면 빌드 재현성과 공급망 신뢰를 약화시킬 수 있습니다. cache key에 lockfile만 넣고 compiler version, target triple, feature set, build script 입력, 환경 변수, native library 버전을 빼면 "적중"은 했지만 틀린 산출물을 가져올 수 있습니다.

권장 기준은 다음과 같습니다.

1. cache write는 protected branch 또는 검증된 CI identity로 제한한다.
2. key에는 compiler·target·lockfile·feature·build script 입력을 포함하고, 누락할 수 있는 환경 값은 명시적으로 deny/allow 한다.
3. cache miss는 느려도 정상 build로 fallback해야 하며, cache 서비스 장애가 deploy 차단으로 번지지 않게 한다.
4. release 후보와 보안 민감 변경은 cache 결과에만 의존하지 않고 주기적인 clean, hermetic build와 artifact digest 대조를 한다.

cache hit rate가 90%여도 wrong hit가 한 번 나면 얻은 시간을 모두 잃을 수 있습니다. 그래서 cache 성공률과 함께 fallback 성공률, restore 실패율, clean build 결과와 cache build 결과의 digest 차이, stale artifact 의심 건수를 봐야 합니다. 성능 회귀를 줄이려다 correctness 회귀를 만드는 것은 가장 비싼 최적화입니다.

## 실무 적용

### 1) 첫 2주: 개선 전후를 같은 조건에서 비교한다

compiler 또는 CI image를 바꾸기 전에 대표 workspace 3개를 고릅니다. 작은 crate, 의존성이 많은 service, integration test가 무거운 service가 좋습니다. 각 대상에서 clean build, 한 파일 수정 뒤 incremental build, test compile, test execution을 분리하고, 같은 runner image·target·feature flag·cache mode로 최소 20회 측정합니다. 평균보다 p50·p95·최장값과 queue time을 보관해야 burst나 cache eviction을 놓치지 않습니다.

| 항목 | 기준선 | candidate | 통과 조건 |
| --- | --- | --- | --- |
| fast lane p95 | 현재값 | compiler/image 변경 후 | 10% 이상 악화 금지 |
| clean build p50 | 현재값 | 동일 runner에서 비교 | 5% 이상 개선 또는 원인 기록 |
| incremental p95 | 현재값 | 실제 작은 diff 기준 | fast lane 목표 안 |
| cache restore 실패율 | 현재값 | 변경 후 | 0.5% 미만 |
| 필수 test flaky rate | 현재값 | 변경 후 | 2% 미만, 상승 시 확대 중단 |

숫자가 기대와 다르면 compiler를 되돌리기 전에 구간을 다시 봅니다. clean build는 빨라졌는데 link가 늘었는지, cache key가 너무 넓어졌는지, runner image가 다른 native toolchain을 받는지 분류해야 합니다. 한 번의 speedup을 전체 원인으로 착각하지 않는 것이 platform 팀의 역할입니다.

### 2) rollout은 전체 CI가 아니라 위험도별 lane에서 시작한다

candidate toolchain은 문서 build나 low-risk crate부터 5% canary로 적용합니다. 그 다음 non-critical service, 마지막으로 release·security path로 넓힙니다. 변경에는 compiler version, base image digest, cache namespace, rollback revision을 함께 기록합니다. 이 네 값 중 하나라도 빠지면 "어제보다 빨랐다"는 관찰을 재현할 수 없습니다.

초기 48시간 동안은 build 성공률, p95 duration, cache restore error, linker error, test flaky rate, queued job 수를 기존 lane과 나란히 봅니다. candidate가 빠르더라도 failed build가 0.5%p 늘거나 p95가 10% 이상 나빠지면 확대를 멈춥니다. 특히 cross compilation과 generated code는 일반 crate보다 toolchain 차이에 민감할 수 있으므로 별도 fixture가 필요합니다.

### 3) 성능 이득을 개발 정책에 연결한다

fast lane이 안정되면 다음 행동을 한 번에 모두 강제하지 말고 하나씩 올립니다. 첫 주에는 변경 파일 기준 test 선택을 추가하고, 다음 주에는 critical module의 contract test를 required로 만들고, 그 다음에야 timeout이나 PR size guide를 조정합니다. [Code Quality Policy Gate](/posts/2026-06-25-code-quality-policy-gate-trend/)처럼 warn → evaluate → enforce 순서가 안전합니다.

이때 확인할 질문은 "컴파일이 얼마나 빨라졌나"가 아니라 "더 빠른 피드백으로 어떤 실패를 merge 전에 잡았나"입니다. fast lane으로 이동한 test 수, 실패를 발견한 시점, revert까지 걸린 시간, CI queue 감소를 월 단위로 비교하면 성능 투자가 실제 변경 안전성으로 이어졌는지 보입니다.

## 트레이드오프/주의점

1. **벤치마크 개선률은 workload별로 다르다.** compiler report의 outlier 개선을 조직의 CI SLA로 약속하면 안 된다.
2. **incremental build는 빠르지만 숨은 입력에 민감하다.** build script, proc macro, feature flag, 생성 파일이 cache invalidation 경계를 넓힐 수 있다.
3. **remote cache는 성능 계층이지 신뢰 원천이 아니다.** write 권한, key 완전성, digest 검증, clean fallback이 없으면 잘못된 artifact를 빠르게 퍼뜨린다.
4. **parallelism은 queue를 줄일 수 있지만 비용과 shared-resource 경합을 키운다.** runner 수를 늘리기 전 CPU throttling, network, registry rate limit, test DB 격리를 확인한다.
5. **빠른 lane과 완전한 lane을 혼동하지 않는다.** fast lane은 빠른 결정용이고, release proof에는 hermetic build·보안 검사·cross-target 검증이 여전히 필요할 수 있다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] CI duration을 queue, restore, clean compile, incremental compile, test/link, publish로 분해한다.
- [ ] compiler·runner image·target·feature·cache mode를 포함한 기준선이 있다.
- [ ] candidate toolchain은 5% canary와 48시간 비교를 거쳤다.
- [ ] cache write 권한, key 입력, 정상 fallback, clean-build 검증 경로가 있다.
- [ ] fast lane p95, cache restore error, flaky rate, queued jobs의 중단 기준을 정했다.
- [ ] 성능 이득으로 추가할 검증 항목과 rollout 순서가 문서화됐다.
- [ ] release path는 cache 여부와 무관하게 artifact digest와 재현성 증거를 남긴다.

### 연습

최근 20개 PR의 CI 기록에서 가장 오래 걸린 job 하나를 골라 queue·restore·compile·link·test 시간을 나눠 보세요. 그 뒤 작은 Rust 파일 수정 1회와 dependency 변경 1회를 각각 실행해 invalidation 범위를 비교합니다. 마지막으로 fast lane이 20% 빨라졌다고 가정하고, 그 시간을 사용해 required로 올릴 contract test 하나와 nightly에 남길 expensive test 하나를 정하세요. 속도 개선을 "대기 감소"가 아니라 "검증 재배치"로 표현할 수 있으면 실무 변화가 시작된 것입니다.

## 관련 글

- [Hermetic Build와 Remote Cache](/posts/2026-03-23-hermetic-build-remote-cache-trend/)
- [Code Quality Policy Gate](/posts/2026-06-25-code-quality-policy-gate-trend/)
- [TypeScript 지원 기간과 SDK 업그레이드 계약](/posts/2026-08-12-typescript-compiler-support-window-sdk-upgrade-contract-trend/)
- [CI/CD와 GitHub Actions](/learning/deep-dive/deep-dive-ci-cd-github-actions/)
- [빌드 도구 Gradle·Maven](/learning/deep-dive/deep-dive-build-tooling-gradle-maven/)
