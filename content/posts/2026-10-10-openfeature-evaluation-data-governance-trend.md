---
title: "2026 개발 트렌드: OpenFeature와 평가 데이터, Feature Flag를 if문이 아닌 변경 통제면으로 운영하는 법"
date: 2026-10-10T10:06:00+09:00
lastmod: 2026-10-10T10:06:00+09:00
draft: false
tags: ["OpenFeature", "Feature Flags", "Platform Engineering", "Progressive Delivery", "Observability", "Engineering Governance"]
categories: ["Development", "Platform Engineering", "DevOps"]
series: "2026 개발 운영 트렌드"
keywords: ["OpenFeature", "feature flag governance", "flag evaluation telemetry", "progressive delivery", "configuration control plane"]
description: "OpenFeature 같은 provider-agnostic API가 늘면서 feature flag의 핵심은 SDK 교체가 아니라, 평가 문맥·변경 권한·노출 증거·정리 기한을 갖춘 변경 통제면으로 만드는 일입니다."
summary: "Feature flag는 배포를 안전하게 만들 수 있지만, 누가 어떤 context로 어떤 값을 받았는지 모르면 또 하나의 보이지 않는 production branch가 된다. 표준 API는 시작점일 뿐이며, 운영 가능한 flag 체계에는 evaluation event, owner, expiry, rollback 조건이 필요하다."
key_takeaways:
  - "OpenFeature는 flag provider 의존성을 줄이는 인터페이스이지, target rule·권한·감사·정리 부채를 자동으로 해결하는 제품은 아니다."
  - "flag 변경은 코드 배포와 분리된 production change이므로 owner, 목적, 대상, 만료일, rollback condition, 승인 수준을 함께 기록해야 한다."
  - "노출 비율만 보지 말고 flag evaluation과 request·experiment exposure·SLO 결과를 연결해야 안전성과 제품 효과를 판단할 수 있다."
  - "처음에는 release flag와 kill switch처럼 되돌릴 수 있는 좁은 용도부터 표준화하고, 권한·가격·데이터 삭제 같은 고위험 결정은 별도 policy 경계로 둬야 한다."
operator_checklist:
  - "모든 production flag에 key, owner, flag class, default, target context, 만료일, rollback rule을 둔다."
  - "평가 event에는 flag key·variant·rule version·anonymized subject·provider state version을 남기되 민감 context 원문은 저장하지 않는다."
  - "flag provider 장애 시 route별 fail-open/fail-closed 기본값과 cache TTL을 사전에 정한다."
  - "rollout 단계마다 error rate, latency, business guardrail, evaluation volume의 중단 조건을 정하고 자동 또는 수동 rollback 책임자를 명시한다."
---

Feature flag는 오래된 기술입니다. 2026년에 다시 중요해진 이유는 deployment 빈도만 늘었기 때문이 아닙니다. SaaS provider, 자체 config service, 실험 플랫폼, edge runtime, AI agent runtime이 각자 flag를 평가하면서 같은 기능이 환경·테넌트·계정·위험도·실험군에 따라 다르게 동작합니다. 코드 repository에는 한 branch만 있어도 production에는 수십 개의 조합이 생깁니다.

[OpenFeature](https://openfeature.dev/)처럼 provider와 애플리케이션 호출을 분리하는 표준 API는 그래서 유용합니다. SDK를 한 provider에 깊게 묶지 않고 evaluation hook과 context 처리의 공통점을 만들 수 있습니다. 다만 표준 API 도입이 곧 운영 성숙도를 뜻하지는 않습니다. key와 targeting rule이 늘수록 “누가 언제 어떤 값을 받았는가”와 “이 변경은 언제 제거되는가”가 추적되지 않으면 flag는 안전장치가 아니라 보이지 않는 production branch가 됩니다.

이 글은 [Feature Flag Lifecycle Cleanup](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/), [Config Change Safety Rollout](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/), [Authorization Policy Shadow Rollout](/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/), [Rust Compiler CI Change Budget](/posts/2026-10-01-rust-compiler-performance-ci-change-budget-trend/)의 원칙을 flag evaluation 데이터 관점에서 묶습니다. 아래 숫자는 특정 vendor의 필수값이 아니라, 운영 계약을 시작할 때 쓸 수 있는 보수적인 기준입니다.

## 이 글에서 얻는 것

- OpenFeature가 해결하는 provider 결합 문제와 팀이 여전히 설계해야 할 운영 책임을 분리할 수 있습니다.
- evaluation event에 무엇을 남기고 무엇을 보내지 말아야 하는지 정할 수 있습니다.
- rollout 비율, SLO, business guardrail, rollback을 하나의 변경 계약으로 설계할 수 있습니다.
- flag를 쓰면 안 되는 고위험 결정과 provider 장애 시 fallback 기준을 구분할 수 있습니다.

## 핵심 개념/이슈

### 1) 표준 API는 제어면의 시작점이지 정책 엔진이 아니다

OpenFeature의 가치는 애플리케이션이 특정 vendor SDK와 직접 결합하지 않게 하는 데 있습니다. 애플리케이션은 공통 API와 evaluation context를 쓰고, provider가 실제 rule·remote state·event export를 담당합니다. test double, local provider, provider migration이 쉬워지고 서비스별 호출 방식도 덜 달라집니다.

그러나 공통 API는 “누가 production targeting을 바꾸는가”, “context에 어떤 개인정보를 넣는가”, “provider가 실패하면 무엇을 반환하는가”, “flag를 누가 언제 지우는가”에 답하지 않습니다. 이 네 가지를 비워 두면 SDK 교체 비용만 줄고 변경 위험은 그대로입니다. 특히 `userId`, email, plan, country, device, risk score를 편하게 모두 context에 넣으면 provider와 telemetry의 데이터 경계가 넓어집니다. raw email 대신 목적 제한 hash, 권한은 `admin` 같은 최소 열거형, tenant는 승인된 stable ID처럼 context schema를 먼저 정해야 합니다.

| 운영 질문 | API만으로 해결되는가 | 팀이 정해야 할 것 |
| --- | --- | --- |
| 누가 production rule을 바꾸는가 | 아니다 | role, 승인, break-glass, audit |
| 어떤 context를 평가에 쓰는가 | 일부만 | PII 최소화, schema, field owner |
| provider가 느리거나 실패하면 | 아니다 | default, timeout, cache, route별 policy |
| flag를 언제 제거하는가 | 아니다 | expiry, owner, cleanup PR, debt SLO |
| 결과가 유효했는가 | 아니다 | exposure, metric window, guardrail |

### 2) evaluation event는 exposure 증거이지 사용자 행동 로그의 복사본이 아니다

“10% rollout”은 설정값일 뿐 실제로 10%의 요청이 새 동작을 봤다는 증거가 아닙니다. cache hit, anonymous context, 오래된 SDK, targeting 오작동, provider fallback이 있으면 결과가 달라집니다. 따라서 모든 request payload를 복사하는 대신, 평가와 상태를 연결할 최소 event를 남겨야 합니다.

```text
flag_key=checkout-pricing-v2
variant=treatment
rule_version=2026-10-10.3
subject_hash=HMAC(tenant_id + user_id)
service=checkout-api
provider_state_version=8f31...
reason=TARGETING_MATCH
fallback_used=false
```

`subject_hash`도 보안의 만능 답은 아닙니다. salt, 접근 통제, 보존 기간이 없으면 작은 tenant 집합에서 다시 추론될 수 있습니다. request body, email, access token, raw IP, prompt를 event에 싣지 않는 것을 기본값으로 두고, debugging은 별도 권한의 단기 sample로 분리하세요. release flag라면 provider state 변경과 fallback 비율은 100% 집계하고, 정상 evaluation의 상세 event는 1~10% sampling으로 시작할 수 있습니다. 단, 결제·인가 같은 high-risk route의 fallback은 sampling하지 말고 즉시 집계·경보해야 합니다.

### 3) rollout은 비율이 아니라 증거 창을 가진 변경이다

좋은 rollout은 `1% → 10% → 50% → 100%` 숫자만 적지 않습니다. 각 단계에서 어떤 지표를 몇 분 또는 몇 시간 관찰하고, 어느 값에서 멈추며, 누가 revert하는지가 있어야 합니다. checkout 계산을 바꾸는 flag라면 error rate뿐 아니라 주문 성공률, 중복 결제 시도, 금액 불일치, support contact를 봐야 합니다. CPU가 안정적이어도 할인 금액이 틀리면 즉시 중단해야 합니다.

| 단계 | 대상 | 최소 관찰 창 | 확대 조건 | 중단·rollback 조건 |
| --- | --- | --- | --- | --- |
| dark read | 내부·shadow | 30분 | mismatch < 0.1% | 불일치 0.5% 초과 또는 원인 미분류 |
| canary | 1% 이하 opt-in tenant | 60분 | error·p95가 baseline의 5% 이내 | error rate 0.2%p 증가 또는 high-risk fallback 1건 |
| limited | 5~10% | 4시간 | business guardrail 안정 | 정합성·conversion 한계 초과 |
| broad | 25~50% | 24시간 | peak 시간대 SLO 통과 | guardrail 두 개 이상 악화 |
| general | 100% | cleanup 전 7일 | 이전 variant 호출 0 | fallback policy 재평가 필요 |

## 실무 적용

### 1) flag를 네 가지 class로 나누고 권한을 다르게 준다

모든 flag에 같은 권한을 주면 일상적인 release와 고위험 권한 변경이 같은 절차를 공유하게 됩니다. 목적별 class를 나누면 approval과 fallback이 선명해집니다.

| Class | 예시 | 기본 TTL | 변경 권한 | failure default |
| --- | --- | --- | --- | --- |
| release | 새 검색 ranking, UI flow | 14~30일 | feature owner + reviewer | 이전 안정 variant |
| experiment | 가격 표현, onboarding copy | 30~90일 | product + data owner | control |
| ops kill switch | 외부 OCR·추천 API 차단 | 7~30일 | on-call 포함 | dependency off/degraded path |
| entitlement/policy | 유료 기능·권한·한도 | 장기 가능 | policy owner, audit 필수 | 별도 authorization source |

마지막 class는 일반 release flag로 취급하면 안 됩니다. 계정 정지, 데이터 삭제, 결제 한도, RBAC는 빠른 rollout보다 즉시 revocation·감사·정책 일관성이 중요합니다. [Authorization Policy Shadow Rollout](/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/)처럼 policy engine과 audit 경계로 분리하는 편이 안전합니다.

### 2) provider outage를 가정한 evaluation contract를 만든다

remote provider 호출을 request path마다 동기적으로 수행하면 provider latency가 서비스 p99가 됩니다. 반대로 무기한 local cache만 믿으면 이미 중단한 기능이 계속 노출됩니다. route와 class별로 timeout, cache TTL, default를 정해야 합니다. 시작값으로 SDK fetch timeout은 **50~100ms**, request path stale cache TTL은 **30~60초**, background refresh는 **10~30초**를 둘 수 있습니다. release flag는 60초 stale로 이전 안정 variant를 유지해도 되지만, 보안 kill switch는 stale cache 허용 여부부터 별도 review가 필요합니다.

fallback 발생률이 전체 evaluation의 0.1%를 넘거나 특정 high-risk flag에서 한 번이라도 발생하면 rollout을 멈추고 원인을 조사하는 기준을 둘 수 있습니다. provider health check가 녹색이어도 실제 SDK가 오래된 state를 쓰거나 context 직렬화가 실패했을 수 있기 때문입니다. 이 상태는 [Config Change Safety Rollout](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/)에서 말하는 “변경 후 실제 동작 증거”로 확인해야 합니다.

### 3) expiry를 작업 항목이 아니라 운영 SLO로 다룬다

flag가 코드보다 위험해지는 시점은 더 이상 누가 소유하는지 모를 때입니다. 생성 시 `owner`, `created_at`, `purpose`, `expected_remove_by`, `default`, `dependencies`를 강제하고, 만료 14일 전 cleanup 후보를 owner에게 알립니다. 만료 뒤에는 자동 삭제보다 “사용량 0, 이전 variant 참조 0, rollback 필요성 없음”을 확인한 cleanup PR을 우선하세요.

목표는 flag 수를 무조건 줄이는 것이 아니라 **만료된 release flag 비율 5% 미만**, owner 없는 production flag 0건입니다. cleanup은 code, test fixture, targeting rule, dashboard alert를 같이 제거해야 합니다. dashboard에서만 숨기면 숫자는 좋아져도 production branch는 남습니다.

## 트레이드오프/주의점

1. **표준화가 즉시 provider 교체를 요구하지는 않는다.** adapter부터 도입하고 event export·hook·fallback 동작 차이를 canary로 검증한다.
2. **모든 evaluation을 저장하면 개인정보와 비용이 커진다.** 목적별 최소 field, sampling, 짧은 보존 기간, 접근 통제가 없으면 observability가 새 데이터 부채가 된다.
3. **flag는 테스트 대체재가 아니다.** variant별 migration, 오래된 SDK fallback, flag-off 경로는 CI·contract test·canary로 따로 확인한다.
4. **실험 결과와 안전성 지표를 혼동하지 않는다.** conversion이 올라도 error·refund·support signal이 나빠지면 확대하지 않는다.
5. **고위험 권한 변경을 release flag로 포장하지 않는다.** rollback의 편의가 authorization audit와 즉시 revocation을 대체하지 못한다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 모든 production flag에 class, owner, 목적, default, 대상, 만료일, rollback 조건이 있다.
- [ ] evaluation context는 승인된 schema를 쓰며 raw PII·token·request body를 provider와 event에 보내지 않는다.
- [ ] event에는 flag key, variant, rule/provider version, fallback 여부, 최소화한 subject 식별자가 있다.
- [ ] rollout 단계마다 관찰 창, SLO, business guardrail, 중단 기준, 책임자가 있다.
- [ ] provider timeout·cache TTL·fallback default가 class와 route 위험도에 맞게 문서화됐다.
- [ ] fallback rate와 stale provider state를 대시보드·알람으로 본다.
- [ ] 만료된 release flag 비율은 5% 미만이고 owner 없는 flag는 0건이다.

### 연습

현재 서비스의 production flag 하나를 골라 `key`, class, owner, context fields, default, cache TTL, expiry, rollback 조건을 한 페이지로 적어 보세요. 다음으로 1% canary에서 볼 지표를 기술 SLO 두 개와 제품 guardrail 한 개로 제한하고, 60분 안에 어떤 값이면 멈출지 숫자로 씁니다. 마지막으로 provider가 5분 동안 응답하지 않을 때 어떤 variant가 어떤 사용자에게 보이는지 설명할 수 없다면, flag는 아직 변경 통제면이 아닙니다.

## 관련 글

- [Feature Flag Lifecycle Cleanup](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/)
- [Config Change Safety Rollout](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/)
- [Authorization Policy Shadow Rollout](/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/)
- [Policy Shadow Rollout과 Agent Runtime](/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/)
- [Rust Compiler Performance CI Change Budget](/posts/2026-10-01-rust-compiler-performance-ci-change-budget-trend/)
