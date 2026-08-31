---
title: "백엔드 커리큘럼 심화: 실험 배정과 노출 이벤트 무결성, A/B 테스트 결과를 믿을 수 있게 만드는 법"
date: 2026-08-27T10:06:00+09:00
lastmod: 2026-08-27T10:06:00+09:00
draft: false
topic: "Backend Product Infrastructure"
tags: ["Experimentation", "A/B Test", "Feature Flag", "Analytics", "Data Quality", "Backend Reliability"]
categories: ["Backend Deep Dive"]
module: "backend-data"
study_order: 1492
description: "피처 플래그의 분기 처리와 실험의 인과 추론을 구분하고, 안정적 버킷팅·assignment snapshot·exposure event·Sample Ratio Mismatch·kill switch를 운영 계약으로 설계하는 방법을 정리합니다."
summary: "A/B 테스트는 variant를 나눠 보이는 기능이 아니라, 누가 언제 어떤 조건에서 실제로 처치를 받았는지 재현 가능한 데이터 계약이다. 배정과 노출을 분리하고 SRM·중복·지연·override를 검증해야 결과로 제품 결정을 할 수 있다."
keywords: ["A/B testing backend", "experiment assignment", "exposure event", "sample ratio mismatch", "deterministic bucketing", "feature flag analytics"]
key_takeaways:
  - "피처 플래그는 노출 제어 장치이고, 실험은 인과 관계를 측정하는 장치다. 같은 해시 분기를 써도 목적과 기록 방식은 다르다."
  - "assignment는 대상이 variant에 배정된 사실, exposure는 실제 기능을 본 사실이다. 전환 분석은 원칙적으로 exposure를 기준으로 하고 assignment는 편향·누락 진단에 쓴다."
  - "실험마다 unit, hash salt, variant weight, eligibility, start/end time, override, metric version을 snapshot으로 남겨야 과거 결과를 재현할 수 있다."
  - "SRM, exposure 지연, 중복 이벤트, control-plane override는 분석 후처리가 아니라 실험을 중단할 수 있는 운영 신호로 관리해야 한다."
operator_checklist:
  - "실험 시작 전 primary metric 1개, guardrail metric 2~3개, unit, 최소 표본·최소 기간, 중단 조건을 문서화한다."
  - "user_id 또는 account_id처럼 실험 단위에 맞는 안정 키와 experiment별 salt를 사용하고, 요청 ID·랜덤값·가변 IP로 버킷을 만들지 않는다."
  - "exposure event에는 experiment key, variant, assignment version, subject ID의 privacy-safe 식별자, occurred_at, event schema version을 넣는다."
  - "예정 비율과 실제 assignment·exposure 비율의 차이가 통계적으로 유의하면 결과 해석을 중단하고 eligibility·로그·override를 조사한다."
learning_refs:
  - title: "피처 플래그: 안전한 기능 릴리스"
    href: "/learning/deep-dive/deep-dive-feature-flags/"
    description: "배포와 릴리스를 분리하고 점진적으로 노출하는 기본 패턴입니다."
  - title: "Feature Flag Lifecycle Cleanup"
    href: "/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/"
    description: "실험 종료 후 flag·분기·owner를 정리해 운영 부채를 남기지 않는 기준입니다."
  - title: "Config Change Safety"
    href: "/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/"
    description: "실험 설정과 targeting rule도 위험한 운영 변경으로 검증·롤백하는 방법입니다."
  - title: "도메인 불변식 Registry와 데이터 품질"
    href: "/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/"
    description: "배정·노출 데이터의 합계와 시점 규칙을 운영 불변식으로 만드는 다음 단계 글입니다."
---

`if (flag) { ... }`가 있다고 해서 A/B 테스트가 되는 것은 아닙니다. 같은 기능을 50% 사용자에게만 보이게 할 수는 있지만, 그 50%가 누구인지, 실제로 화면을 봤는지, 분석 시점에 어떤 규칙이 적용됐는지 모르면 결과는 제품 결정을 뒷받침하지 못합니다. 특히 로그인 전·후 식별자가 바뀌거나, 캐시와 재시도가 섞이거나, 운영자가 특정 고객을 강제로 override하는 서비스에서는 “대충 반반”이 가장 위험한 상태가 됩니다.

이 글은 [피처 플래그: 안전한 기능 릴리스](/learning/deep-dive/deep-dive-feature-flags/), [Feature Flag Lifecycle Cleanup](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/), [Config Change Safety](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/), [도메인 불변식 Registry와 데이터 품질](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)을 실험 데이터의 신뢰성 관점으로 연결합니다. 목표는 통계 기법을 많이 나열하는 것이 아니라, **배정·노출·결과를 다시 따라갈 수 있는 백엔드 계약**을 만드는 것입니다.

## 이 글에서 얻는 것

- 피처 플래그와 실험을 각각 언제 써야 하는지 구분합니다.
- stable bucketing, assignment snapshot, exposure event를 분리해 설계할 수 있습니다.
- Sample Ratio Mismatch(SRM), 중복·지연 이벤트, override가 결과를 왜곡하는 이유를 이해합니다.
- 실험 시작·중단·판정에 필요한 숫자와 운영 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 플래그의 목표와 실험의 목표는 다르다

피처 플래그는 배포와 릴리스를 분리하고, 위험할 때 기능을 끄거나 특정 고객에게만 여는 **제어 장치**입니다. 반면 실험은 처치(treatment)가 결과에 어떤 차이를 만들었는지 보는 **측정 장치**입니다. 실험을 플래그 구현 위에 올릴 수는 있지만, 플래그가 있다고 실험 데이터의 편향이 자동으로 사라지지는 않습니다.

| 질문 | 피처 플래그 | 제품 실험 |
| --- | --- | --- |
| 주된 목적 | 안전한 노출·빠른 롤백 | 인과 효과 측정 |
| 대상 선정 | tenant, role, region, allowlist도 가능 | 사전에 정한 실험 단위에서 무작위에 가까운 배정 |
| 중요한 기록 | 현재 rule·owner·만료 | assignment, exposure, metric, 분석 기간 |
| 결과 해석 | 기능이 켜졌는가 | 기능이 결과를 바꿨는가 |
| 종료 조건 | 안정화 후 100% 또는 제거 | 최소 표본·최소 기간·guardrail 확인 후 판정 |

예를 들어 결제 화면을 새 UI로 바꾸는 경우, 첫날에는 내부 계정과 1% canary로 오류를 확인하는 플래그가 필요합니다. 그 다음 “새 UI가 결제 완료율을 높였는가”를 보려면 별도의 실험이 필요합니다. 운영 안정성 canary와 제품 효과 실험을 같은 데이터로 섞으면, 오류를 피하려고 특정 국가·단말·고객 등급을 제외한 순간부터 비교 집단의 성격이 달라집니다.

### 2) assignment와 exposure는 다른 사건이다

**assignment**는 `account-42`가 실험 `checkout-layout-v3`의 B variant에 배정됐다는 사실입니다. **exposure**는 그 계정이 실제로 새 결제 화면을 렌더링하거나 기능을 호출했다는 사실입니다. 앱이 시작될 때 배정만 하고 사용자가 결제 화면에 오지 않았다면, 그 사용자는 처치를 받지 않았습니다.

두 이벤트를 하나로 합치면 두 가지 오류가 생깁니다. assignment만 보고 전환율을 계산하면 기능을 보지 않은 사람까지 분모에 들어가 효과가 희석됩니다. 반대로 exposure만 남기고 assignment를 버리면 50:50 배정이 실제로 지켜졌는지, 특정 SDK·지역에서 로그가 빠졌는지 조사할 근거가 없습니다.

```json
{
  "event": "experiment_exposure",
  "experiment_key": "checkout-layout-v3",
  "variant": "treatment_b",
  "assignment_version": 3,
  "subject_type": "account",
  "subject_hash": "hmac:...",
  "surface": "web_checkout",
  "occurred_at": "2026-08-27T01:06:12Z",
  "schema_version": 1
}
```

여기서 `subject_hash`는 분석에 필요한 안정 식별자이되 원문 개인정보를 노출하지 않는 값이어야 합니다. `assignment_version`은 weights나 eligibility가 바뀐 뒤에도 어떤 배정 규칙으로 노출됐는지 복원하게 해 줍니다. 화면 진입마다 수십 번 이벤트를 쏘지 않도록, 기본은 **실험·subject·surface·일 단위 중복 제거**부터 시작하고 결제·광고처럼 정확한 노출 시점이 중요한 영역에서만 더 촘촘한 정의를 둡니다.

### 3) stable bucketing은 일관성을 위한 기반이다

같은 사용자가 새로고침할 때마다 A와 B를 번갈아 보면 경험도 망가지고 측정도 망가집니다. 보통은 다음처럼 실험별 salt와 안정 키를 합쳐 0~9,999 bucket으로 만듭니다.

```text
bucket = hash(experiment_key + experiment_salt + stable_subject_id) mod 10000
0..4999     -> control
5000..9999  -> treatment
```

`stable_subject_id`는 질문에 맞춰 골라야 합니다. 개인 화면의 버튼 위치라면 `user_id`가 적합할 수 있지만, 조직 단위 가격 정책이라면 같은 회사 구성원이 다른 variant를 보면 안 되므로 `account_id`가 낫습니다. 장바구니·가구·디바이스 공유 같은 간섭(interference)이 큰 기능은 더 큰 단위를 선택해야 합니다. request ID, 현재 시간, IP 주소처럼 바뀌는 키는 절대 쓰면 안 됩니다.

hash salt도 버전 관리 대상입니다. salt를 재사용하면 서로 다른 실험이 같은 사용자군에 지속적으로 겹칠 수 있고, salt를 무심코 바꾸면 진행 중 실험에서 대상이 재배정됩니다. 실험 시작 뒤에는 `unit`, `salt`, `weight`, `eligibility`, `metric_definition`을 immutable snapshot으로 남기고, 수정이 필요하면 새 `assignment_version` 또는 새 실험으로 취급하세요.

### 4) SRM은 “분석이 이상하다”가 아니라 “배정 경로가 깨졌다”는 신호다

50:50으로 설계했는데 exposure가 52:48로 지속된다면 결과를 보기 전에 이유를 찾아야 합니다. 이 현상을 Sample Ratio Mismatch, SRM이라고 합니다. 작은 표본은 흔들릴 수 있으므로 카이제곱 검정 같은 방법으로 우연 범위인지 확인하되, 운영 관점에서는 **예정 비율과 실제 비율을 매일 비교하고 임계값을 넘으면 판정을 보류**하는 편이 중요합니다.

초기 운영 규칙 예시는 다음과 같습니다.

| 신호 | 시작 기준 | 첫 조치 |
| --- | --- | --- |
| assignment 비율 편차 | 계획 대비 1 percentage point 초과가 24시간 지속 | hash·eligibility·override 로그 확인 |
| exposure SRM | 유의수준 0.01 미만 또는 2일 연속 편차 | SDK·캐시·event drop 분리 조사 |
| duplicate exposure | subject 기준 0.5% 초과 | retry·multi-tab·idempotency key 확인 |
| event 지연 | p95가 15분 초과 | 실시간 판정 중단, batch 분석 전환 |
| guardrail 악화 | 오류율 +0.3pp 또는 결제 p95 +20% | 신규 배정 중지·rollback 검토 |

SRM의 원인은 통계가 아니라 구현인 경우가 많습니다. B variant에서만 로그인 redirect가 발생해 exposure가 빠지거나, CDN cache key가 flag를 포함하지 않아 한 사용자가 다른 variant를 보거나, Android SDK만 구 버전이라 이벤트 schema가 누락되는 식입니다. `p-value`만 보고 통과·실패를 선언하지 말고, assignment와 exposure를 환경·앱 버전·region·로그인 상태별로 쪼개 원인을 찾습니다.

## 실무 적용

### 1) 실험 계약을 코드와 함께 등록한다

실험을 운영 콘솔의 임시 토글로 두면 나중에 누가 어떤 선택을 했는지 사라집니다. 최소 계약을 git 또는 변경 이력이 남는 control plane에 둡니다.

```yaml
experiment: checkout-layout-v3
unit: account_id
assignment:
  salt_version: 1
  weights: {control: 5000, treatment_b: 5000}
  eligibility: "country=KR and app_version>=6.4"
metrics:
  primary: checkout_completed_per_exposed_account
  guardrails:
    - payment_error_rate
    - checkout_p95_ms
stop_rules:
  - "payment_error_rate > control + 0.3pp for 15m"
  - "exposure_srm_p_value < 0.01 after 1000 exposures"
minimum: {exposed_accounts: 10000, duration_days: 14}
owner: checkout-product
expires_at: "2026-09-30"
```

숫자는 보편 정답이 아닙니다. 결제처럼 위험이 큰 흐름은 오류율 guardrail을 더 짧게 보고 즉시 중단할 수 있어야 하고, 주말·월말 효과가 큰 서비스는 최소 7일보다 14일이 낫습니다. 다만 최소 표본과 최소 기간 중 하나라도 비어 있으면, 좋은 숫자가 보이는 날만 골라 종료하는 선택 편향이 생깁니다.

### 2) override와 kill switch를 분석 데이터에 남긴다

고객 지원, 장애 대응, 법적 요구 때문에 특정 계정에 variant를 강제해야 하는 경우가 있습니다. override 자체를 금지할 필요는 없지만, override된 대상은 무작위 배정이 아닙니다. `assignment_source=manual_override`를 별도 기록하고 기본 분석에서는 제외하거나 별도 층으로 보고해야 합니다. 같은 이유로 직원 계정, QA automation, bot traffic, 비정상 결제 재시도도 eligibility에서 어떻게 처리하는지 명시합니다.

kill switch는 실험 실패를 인정하는 장치입니다. 새 variant의 결제 오류율이 15분 동안 control보다 0.3 percentage point 높거나, p95가 20% 이상 악화되고 500건 이상 노출됐다면 자동으로 **신규 assignment만 멈추고**, 이미 진행 중인 결제는 안전한 경로로 마무리하게 설계할 수 있습니다. 전부를 즉시 A로 바꾸는 것이 중복 요청을 만들 수 있는 흐름이라면 request-boundary를 지켜야 합니다.

### 3) 결과 테이블에는 측정 가능성도 함께 적는다

실험 결과를 `B가 +2.1%` 한 줄로 쓰지 않습니다. 노출 정의, 분석 기간, 제외 규칙, SRM 상태, metric freshness, guardrail을 같이 둬야 다음 분기에 재사용할 수 있습니다.

| 항목 | 기록 예시 |
| --- | --- |
| 분석 단위 | account, first exposure 기준 |
| 처리 정의 | checkout 화면을 1회 이상 렌더링 |
| 기간 | 2026-08-27~2026-09-10, 14일 |
| 데이터 품질 | assignment SRM 없음, exposure 중복 0.12%, p95 지연 4분 |
| 효과 | 완료율 +2.1%, 신뢰구간과 절대 차이 함께 기록 |
| guardrail | 결제 오류율 변화 없음, p95 +3% |
| 결정 | 10% 확대 또는 종료·정리, owner와 날짜 |

이 표는 분석팀만을 위한 문서가 아닙니다. 다음에 플래그를 제거할 때 왜 100% rollout했는지, 장애가 났을 때 어느 이벤트부터 믿어야 하는지 알려주는 운영 증거입니다.

## 트레이드오프/주의점

첫째, exposure를 엄격히 정의할수록 데이터는 정확해지지만 구현과 이벤트 비용이 늘어납니다. 단순 콘텐츠 카드라면 render exposure로 충분할 수 있으나, 결제·가격·권한처럼 행위가 중요한 곳은 실제 action 직전에 노출을 기록해야 합니다.

둘째, account 단위 배정은 한 조직 안의 오염을 줄이지만 표본 수와 실험 속도를 낮춥니다. user 단위와 account 단위 중 무엇이 맞는지는 분석 편의가 아니라 사용자가 서로 영향을 주는지로 결정합니다.

셋째, metric을 많이 붙이면 사후에 유리한 결과만 고르기 쉬워집니다. primary metric은 하나로 고정하고, guardrail은 안전을 위한 2~3개로 제한하세요. 탐색 지표는 탐색이라고 표시해야 확정 지표와 혼동하지 않습니다.

넷째, 개인정보 보호와 관측성은 동시에 설계해야 합니다. 원문 이메일·전화번호를 이벤트에 넣지 말고, 실험 목적에 필요한 안정 pseudonymous ID와 보존 기간만 둡니다. 실험 종료 뒤에는 [Feature Flag Lifecycle Cleanup](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/)과 함께 event·dashboard·access 권한도 정리합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 실험의 unit, stable key, salt version, variant weight, eligibility가 시작 전에 고정돼 있다.
- [ ] assignment와 exposure가 별도 이벤트이며 schema·idempotency·지연 기준이 있다.
- [ ] primary metric 1개, guardrail 2~3개, 최소 기간·최소 노출·중단 조건이 문서화돼 있다.
- [ ] manual override, 직원·bot·QA traffic을 어떻게 처리하는지 분석 계약에 적었다.
- [ ] assignment와 exposure의 계획 대비 비율, SRM, 중복률, p95 event 지연을 매일 확인한다.
- [ ] 결과 기록에 분석 단위·기간·제외 규칙·데이터 품질·decision owner가 있다.
- [ ] 종료 뒤 flag, targeting rule, event, dashboard, 권한의 제거 owner와 날짜가 있다.

### 연습

1. 현재 서비스의 “새 결제 버튼” 또는 “추천 정렬” 기능 하나를 골라 `user_id`와 `account_id` 중 어느 실험 단위가 맞는지, 간섭 사례를 들어 결정해 보세요.
2. 50:50 실험에서 assignment는 50:50인데 exposure가 54:46으로 나왔다고 가정해 보세요. 앱 버전, 캐시, 로그인 redirect, event drop 중 어떤 순서로 확인할지 적어 보세요.
3. 실험 계약 YAML에 primary metric, 오류율 guardrail, p95 guardrail, 최소 14일, 수동 override 제외 규칙을 작성해 보세요.
