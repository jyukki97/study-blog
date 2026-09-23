---
title: "2026 개발 트렌드: OTel OTTL Lambda, Collector 변환이 설정을 넘어 검증 가능한 데이터 계약이 된다"
date: 2026-09-09T10:06:00+09:00
lastmod: 2026-09-09T10:06:00+09:00
draft: false
tags: ["OpenTelemetry", "OTTL", "OpenTelemetry Collector", "Observability", "Data Governance", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["OTTL lambda", "OpenTelemetry Collector Contrib v0.157.0", "telemetry transformation", "OTel attribute governance", "Collector transform rollout"]
description: "OpenTelemetry Collector Contrib v0.157.0의 OTTL lambda 기능을 계기로, telemetry 변환을 편리한 YAML 조각이 아니라 입력·출력·비용·실패 모드를 검증하는 데이터 계약으로 운영하는 기준을 정리합니다."
summary: "OTTL lambda는 Collection 변환을 간결하게 만들지만, 그만큼 Collector가 애플리케이션 데이터의 정규화·필터·파생을 수행하는 programmable boundary가 된다. production 도입의 핵심은 함수 문법이 아니라 version pin, fixture, attribute allowlist, cardinality 예산, canary, rollback 증거다."
key_takeaways:
  - "Collector Contrib v0.157.0은 Filter·MapEach·MapKeys·Any·All·Find·Reduce·When을 위한 OTTL lambda를 추가했지만, 기능은 experimental이며 feature gate가 필요하다."
  - "Collector 변환은 PII 제거, schema 정규화, 비용 제어에 유용하지만, 잘못된 규칙 하나가 전체 trace·log·metric의 의미를 바꾸거나 조용히 drop할 수 있다."
  - "변환 규칙마다 input signal, 허용·금지 attribute, output schema, error mode, 예상 처리량, owner, 만료일을 명시하면 설정 diff를 review 가능한 계약으로 바꿀 수 있다."
  - "첫 rollout은 비핵심 pipeline에서 shadow export와 fixture replay로 시작하고, transform error·drop·queue·CPU·ingest bytes·필수 field 누락을 baseline과 함께 비교해야 한다."
operator_checklist:
  - "Collector Contrib version과 feature gate를 pin하고, core·Kubernetes distribution에 동일 기능이 있다고 가정하지 않는다."
  - "lambda rule을 공통 global transform으로 바로 넣지 않고 signal·service·attribute를 좁힌 canary pipeline에 둔다."
  - "rule마다 sample fixture와 expected output, error path, rollback artifact를 CI에 넣는다."
  - "규칙으로 새 high-cardinality attribute를 만들거나 raw PII를 hash해도, 목적·retention·access policy 없이 export하지 않는다."
learning_refs:
  - title: "OpenTelemetry 선언적 구성과 버전 계약"
    href: "/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/"
    description: "telemetry 설정을 YAML이 아니라 schema·diff·rollout 대상 artifact로 다루는 기준입니다."
  - title: "OpenTelemetry Blueprints와 관측성 운영 계약"
    href: "/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/"
    description: "공통 telemetry 정책을 workload별 책임과 검증으로 묶는 방법을 다룹니다."
  - title: "메트릭 카디널리티 예산과 라벨 거버넌스"
    href: "/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/"
    description: "새 attribute와 label이 메모리·저장비·query 비용을 증폭시키는 경계를 정리합니다."
  - title: "구조화 로깅 실무"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "로그 필드의 목적·민감도·검색성과 마스킹을 설계하는 기본입니다."
decision_guide:
  title: "OTTL lambda를 어디에 먼저 쓸까"
  intro: "판단 기준은 YAML을 짧게 만들 수 있는가가 아니라, 변환 전후의 의미와 비용을 재현 가능한 테스트로 증명할 수 있는가입니다."
  cases:
    - badge: "Canary 적합"
      title: "명확한 allowlist·정규화 규칙이 있는 비핵심 로그 pipeline"
      fit: "예: 이미 승인된 http.* attribute만 유지하거나, 두 개의 알려진 key 표현을 하나로 정규화하는 경우입니다."
      watchouts: "원본 signal과 변환 결과를 같은 기간 비교하지 않으면 의도치 않은 field 손실을 놓칠 수 있습니다."
      next_step: "fixture 50개 이상과 shadow exporter를 먼저 붙여 output diff·CPU·bytes를 비교합니다."
    - badge: "준비 먼저"
      title: "여러 팀이 같은 Collector를 공유하고 attribute owner가 없는 경우"
      fit: "하나의 global rule이 다수 서비스의 trace·metric·log를 동시에 바꿀 수 있는 환경입니다."
      watchouts: "편의를 위해 공통 transform에 넣으면 변경 반경과 rollback 범위가 너무 커집니다."
      next_step: "signal별 schema owner와 금지 field 목록, pipeline별 feature flag을 먼저 정합니다."
    - badge: "보류"
      title: "결제·보안 조사처럼 원본 telemetry 보존이 우선인 경로"
      fit: "필터 오류나 hash 충돌이 forensic evidence를 훼손할 수 있는 고위험 signal입니다."
      watchouts: "Collector에서 파생·삭제한 값은 downstream에서 원복하기 어렵습니다."
      next_step: "원본 보관·접근 통제·법적 보존 정책을 먼저 확인하고, 필요 시 별도 sanitized export를 만듭니다."
---

OpenTelemetry Collector는 receiver에서 받은 trace·metric·log를 processor로 다듬어 여러 backend로 내보내는 파이프라인입니다. 그동안 OTTL(OpenTelemetry Transformation Language)은 attribute 수정, 필터, status 보정 같은 작업을 맡아 왔습니다. 2026년 7월 공개된 Collector Contrib `v0.157.0`은 OTTL에 lambda 표현식과 `Filter`, `MapEach`, `MapKeys`, `Any`, `All`, `Find`, `Reduce`, `When` 같은 고차 함수를 더했습니다. map이나 list 안의 값을 한 번에 검사·변환하는 규칙을 전용 함수 추가 없이 표현할 수 있게 된 변화입니다.

중요한 점은 Collector가 "데이터를 전달하는 프록시"에서 한 걸음 더 나아가, 신호의 의미와 비용을 바꾸는 programmable boundary가 된다는 사실입니다. PII처럼 보이는 attribute를 제거하고, 서로 다른 서비스가 만든 key를 정규화하며, exporter가 받기 어려운 값을 제한하는 일은 분명 필요합니다. 그러나 규칙 한 줄이 모든 span에서 field를 지우거나, label 조합을 폭증시키거나, transform error를 조용히 무시할 수도 있습니다.

이 글은 [OpenTelemetry 선언적 구성과 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/), [OpenTelemetry Blueprints와 관측성 운영 계약](/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/), [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/), [구조화 로깅 실무](/learning/deep-dive/deep-dive-structured-logging/)의 다음 단계입니다. 앞선 글이 telemetry의 설정과 표준을 다뤘다면, 여기서는 **표준을 강제하기 위해 Collector가 데이터를 바꿀 때 필요한 운영 계약**을 다룹니다.

공식 자료는 [OTTL lambda 발표](https://opentelemetry.io/blog/2026/lambda-powered-function-land-in-ottl/), [Collector telemetry transformation 가이드](https://opentelemetry.io/docs/collector/transforming-telemetry/), [Collector processor 안정성 목록](https://opentelemetry.io/docs/collector/components/processor/)을 기준으로 확인했습니다. 발표 시점의 lambda 기능은 experimental이며 `ottl.functions.enableLambda` feature gate가 필요합니다. 따라서 "Collector에 들어갔다"와 "전사 기본값으로 고정해도 된다"는 다른 판단입니다.

## 이 글에서 얻는 것

- OTTL lambda가 해결하는 collection 변환 문제와, 기존 processor로 남겨야 하는 문제를 구분할 수 있습니다.
- transform rule을 input·output·owner·error mode·cardinality·만료일을 가진 데이터 계약으로 작성할 수 있습니다.
- trace·metric·log별로 원본 보존, PII 제거, schema 정규화, 파생 attribute를 어떤 순서로 적용할지 결정할 수 있습니다.
- feature gate 기반 experimental 기능을 fixture replay, shadow export, canary, rollback으로 검증하는 숫자 기준을 얻습니다.

## 핵심 개념/이슈

### 1) lambda가 만든 변화는 표현력이고, 실행 경계의 책임도 함께 커진다

기존 OTTL은 attribute 하나를 읽어 조건부로 `set`하거나 `delete_key`하는 데는 충분했습니다. 하지만 map에서 특정 접두사의 key만 남기고 싶거나, list 안의 모든 값을 정규화하거나, 여러 값 중 하나라도 위험 범위인지 검사하려면 전용 함수·복잡한 rule·별도 processor가 늘었습니다. lambda는 "각 원소에 적용할 판단"을 호출 위치에 적을 수 있게 합니다.

다음은 `http.`로 시작하는 span attribute만 남겨 보는 작은 예입니다. 실제 production rule은 이처럼 광범위한 keep-only 정책보다 허용 key 목록과 fallback을 명시하는 쪽이 안전합니다.

~~~yaml
processors:
  transform/http-attribute-canary:
    error_mode: ignore
    trace_statements:
      - set(span.attributes,
          Filter(span.attributes, (key, _) => HasPrefix(key, "http.")))
~~~

이 예가 보여 주는 장점은 rule 수를 줄이는 것입니다. 하지만 `Filter` 결과를 원래 map에 덮어쓰는 순간 `http.`가 아닌 `error.type`, `service.*`, custom business field도 사라집니다. 편한 표현식과 안전한 정책은 다릅니다. lambda를 쓰는 순간부터 transform은 배포 설정이 아니라 input telemetry를 output telemetry로 바꾸는 **프로그램 변경**으로 취급해야 합니다.

### 2) 규칙은 "무엇을 바꾼다"보다 "무엇을 절대 바꾸지 않는다"가 먼저다

Collector가 모든 service의 data를 받는 환경에서는 전역 transform의 blast radius가 큽니다. 특히 아래 신호는 쉽게 복구할 수 없습니다.

| 변환 유형 | 유용한 목적 | 먼저 고정할 불변식 |
| --- | --- | --- |
| PII 제거 | raw email·전화번호·token export 방지 | trace ID, timestamp, service identity, 오류 원인은 유지 |
| key 정규화 | `http.status_code`와 legacy key를 통일 | semantic convention의 표준 key를 임의로 삭제하지 않음 |
| 값 bucket화 | user ID·URL path의 cardinality 비용 제한 | security incident에 필요한 stable error code는 유지 |
| 파생 field | SLO 분류, route family, tenant tier 추가 | 원본 field와 derived field의 의미·owner를 구분 |
| filter/drop | noise·테스트 traffic·무의미한 health check 제거 | 적용률·drop count·제외 사유를 계측 |

하나의 rule마다 짧은 contract를 함께 두면 review가 쉬워집니다.

```yaml
rule_id: normalize-http-status-v1
owner: platform-observability
input: traces from checkout-api, api-gateway
allowed_output: http.response.status_code, error.type
forbidden_output: authorization, cookie, raw.email
error_mode: ignore-in-canary
expected_match_rate: 20-35%
expiry_review: 2026-12-01
rollback: registry/collector-rules-2026-09-01.yaml
```

`expected_match_rate`가 중요한 이유는 rule이 "성공"했는지만으로 부족하기 때문입니다. 평소 25%인 변환 적용률이 release 뒤 99%가 되면 attribute 명칭이 달라졌거나 selector가 너무 넓어졌을 수 있습니다. 0%면 dead rule, 100%면 과도한 global rule일 가능성을 각각 조사해야 합니다.

### 3) error mode는 장애를 숨기거나 신호를 버리는 정책이 될 수 있다

Collector transform 문서의 예제는 `error_mode: ignore`를 자주 사용합니다. 테스트 중 malformed data 때문에 전체 pipeline을 멈추지 않기에는 합리적입니다. 하지만 production에서 ignore를 기본값으로 두면 rule 문법 오류, 예상하지 못한 attribute type, expression 실패가 아무 경고 없이 지나가고, 결과만 바뀔 수 있습니다.

실무에서는 error mode 이름보다 **각 mode가 해당 signal을 어떻게 취급하는지**를 배포한 distribution·version에서 확인하고 테스트하는 편이 낫습니다. 다음 분리가 출발점입니다.

- staging fixture: 엄격한 validation으로 schema/type 오류를 실패로 드러낸다.
- production canary: application traffic을 막지 않도록 fail-open 성격의 mode를 쓸 수 있지만, transform error counter와 unmatched counter를 반드시 수집한다.
- PII 차단: "오류면 원본을 내보낸다"가 허용되지 않을 수 있다. 이 경우 원본 보존 pipeline과 외부 export pipeline을 분리하고, sanitizer 실패 시 export를 quarantine하는 정책을 별도로 심사한다.

transform error가 0이라는 수치도 그대로 믿지 마세요. rule이 전혀 match하지 않아 평가되지 않았을 수 있습니다. fixture에 정상 match, empty collection, wrong type, oversize value, 금지 key, nested map을 모두 넣고 expected output을 비교해야 합니다.

### 4) 고차 함수는 cardinality와 CPU 비용도 고차로 키울 수 있다

`MapKeys`로 모든 key에 prefix를 붙이거나 `MapEach`로 값을 문자열화하는 작업은 보기에는 가볍습니다. 하지만 request마다 100개 attribute, 초당 수만 span, 여러 pipeline이 겹치면 map 복사·문자열 변환·정규식·hash 계산이 Collector CPU와 GC를 밀어 올릴 수 있습니다. Collector architecture에서 processor는 pipeline에서 순차적으로 데이터를 전달받습니다. 한 transform이 느려지면 뒤의 batch와 exporter까지 압박을 받을 수 있습니다.

더 위험한 것은 새 label 조합입니다. `route + user_id_hash`, `error_message`, 동적 header 이름처럼 값이 끝없이 늘어나는 필드를 metric attribute로 만들면, 변환은 성공해도 backend memory·ingest bytes·query 시간이 망가집니다. [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)의 원칙대로, 변환 전부터 attribute의 허용값과 owner·retention·cardinality 예산을 정하세요. hash는 값을 가려 줄 뿐, 고유값 수를 줄여 주지 않습니다.

## 실무 적용

### 1) 단일 목적 rule과 별도 canary pipeline으로 시작한다

첫 lambda rule로 전사 key 정규화나 모든 로그 PII 제거를 시도하지 마세요. input이 작고 성공 조건이 명확한 대상 하나를 고릅니다. 예를 들어 특정 서비스의 legacy `http.status_code`를 current semantic key로 옮기거나, 이미 allowlist가 합의된 debug attribute만 제거하는 정도가 적합합니다.

권장 순서는 다음과 같습니다.

1. 현재 signal에서 50~200개의 redacted fixture를 만들고 attribute별 빈도·type·크기를 기록합니다.
2. rule을 적용한 expected fixture를 version control에 두고, parse·type·output diff 검사를 CI에서 실행합니다.
3. production에서는 service 하나, signal 하나, traffic 5%의 canary pipeline에만 feature gate와 rule을 켭니다.
4. 원본 pipeline은 유지하고 transformed pipeline은 shadow exporter로 보냅니다. 두 결과의 필수 field·record 수·bytes·query 결과를 비교합니다.
5. 24시간과 traffic peak를 통과한 뒤 대상 service를 확대합니다. global processor 반영은 마지막입니다.

원본과 변환본을 같은 backend의 같은 index에 섞으면 비교가 어려워집니다. `pipeline_variant=raw|lambda-canary`처럼 안전한 resource attribute를 붙이거나, 짧은 retention의 별도 dataset을 써서 diff 가능성을 남기세요. 다만 variant도 metric cardinality를 과도하게 늘리지 않도록 pipeline 차원에서만 붙이는 것이 좋습니다.

### 2) rollout gate를 기능이 아니라 관측 가능한 결과로 둔다

experimental feature에는 정답 SLA가 없습니다. 팀의 signal volume과 downstream 비용에 맞춰 기준을 정하되, 아래처럼 application SLO와 telemetry 품질을 같이 보호하는 gate가 필요합니다.

| 지표 | canary 통과 기준 예시 | 실패 시 첫 조치 |
| --- | --- | --- |
| transform error rate | 처리 record의 0.01% 미만 | rule type·nil handling 확인, 확대 중지 |
| 필수 attribute 누락 | raw baseline 대비 +0.1%p 이내 | output diff 확인, rule rollback |
| transformed record 수 | raw 대비 ±1% 이내(의도적 filter 제외) | selector·drop 조건 조사 |
| Collector CPU | baseline 대비 +10% 이내 | regex·map 전체 순회 축소 |
| Collector queue/drop | 24시간 0회 또는 원인 재현 가능 | batch/exporter 병목부터 해소 |
| ingest bytes | baseline 대비 +5% 이내 | derived field·중복 attribute 제거 |
| application p95/error rate | baseline 대비 악화 없음 | canary feature gate off |

여기서 `raw 대비 ±1%`는 신호를 삭제하지 않는 normalizer의 예시입니다. health check를 의도적으로 30% drop하는 filter라면 expected drop을 contract에 적고, 그 비율 밖의 변화를 alert로 봐야 합니다. 숫자는 선언이 아니라 rollout 전후 비교 가능한 baseline에서 출발합니다.

### 3) version pin과 feature gate를 deployment evidence로 남긴다

이번 lambda 기능은 Collector Contrib `v0.157.0`에서 experimental feature gate 뒤에 제공됩니다. 따라서 config 파일만 repository에 넣고 image tag를 `latest`로 두면 재현성이 없습니다. 다음 네 값은 release ticket 또는 change manifest에서 함께 움직여야 합니다.

```yaml
collector_image: otel/opentelemetry-collector-contrib:0.157.0
feature_gate: ottl.functions.enableLambda
rule_bundle: telemetry-rules-2026-09-09.1
target_pipeline: traces/checkout-canary
rollback_bundle: telemetry-rules-2026-09-01.4
```

feature gate를 켠 상태와 rule을 활성화한 상태도 구분하세요. image와 gate는 올리되 rule은 disabled로 두고 startup·config validation·self telemetry만 확인할 수 있습니다. 문제가 나면 gate를 끄는 것보다 먼저 마지막 검증 rule bundle로 되돌리는 편이 다른 experimental feature의 영향을 줄일 수 있습니다. 다만 해당 version에서 gate off가 정확히 어떤 동작을 하는지는 test cluster에서 미리 확인해야 합니다.

### 4) PII redaction은 transform만으로 끝나지 않는다

lambda의 `Filter`와 `MapEach`는 key 이름 패턴으로 email·phone·token 후보를 찾고 값을 마스킹하는 규칙을 간결하게 만들 수 있습니다. 하지만 key 이름이 `customer_contact`처럼 예외적이거나, PII가 log body와 nested JSON에 들어가면 keyword match는 놓칩니다. 반대로 `id`라는 이름을 모두 제거하면 tracing correlation에 필요한 ID까지 잃을 수 있습니다.

그래서 우선순위는 **애플리케이션에서 기록하지 않기 > SDK instrumentation allowlist > Collector sanitization > backend access control·retention**입니다. Collector rule은 마지막 방어선이지 PII 수집을 정당화하는 수단이 아닙니다. 보안 조사 또는 법적 보존 때문에 원본이 필요한 경우도 raw dataset의 접근 권한·암호화·retention과 sanitized analytics dataset을 분리해 심사하세요.

## 트레이드오프/주의점

첫째, OTTL의 표현력이 늘면 "작은 코드는 설정에 넣고, 큰 코드는 애플리케이션에 둔다"는 경계가 흐려집니다. lambda가 10줄 이상 중첩되고, 여러 team의 예외를 합치며, state나 외부 lookup이 필요해지면 dedicated processor 또는 애플리케이션 계측이 더 읽기 쉽고 testable할 수 있습니다. YAML이 코드보다 review가 쉬울 것이라는 가정은 위험합니다.

둘째, 하나의 transform을 trace·metric·log에 재사용할 수 있다고 의미가 같지는 않습니다. trace의 `http.route`는 metric label로 쓰면 cardinality 예산이 다르고, log의 body는 metric attribute로 옮겨서는 안 됩니다. signal별 output contract와 stability level을 따로 봐야 합니다.

셋째, fail-open과 fail-closed는 데이터 분류에 따라 다릅니다. 평범한 schema normalizer가 실패했다고 telemetry 전체를 drop하면 incident 관측성이 더 나빠질 수 있습니다. 반면 PII sanitizer가 실패했을 때 원문을 외부 backend로 보내는 것은 보안 사고가 될 수 있습니다. rule 하나에 모든 오류 정책을 쓰지 말고, raw 보관·sanitized export·quarantine의 경계를 분리하세요.

넷째, Collector에서 고친 데이터는 upstream 품질 문제를 숨길 수 있습니다. legacy service가 잘못된 key를 계속 내보내는데 Collector가 영구 변환하면, 팀은 계측 부채를 갚지 않고 변환 규칙만 늘립니다. rule에는 owner와 만료 review를 넣고, upstream 수정이 끝나면 legacy branch를 제거해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] lambda 지원 distribution, 정확한 Collector Contrib version, feature gate, component 안정성 수준을 확인했다.
- [ ] rule마다 input signal·selector·owner·허용/금지 output·error policy·만료일·rollback bundle이 있다.
- [ ] 정상, 빈 collection, wrong type, 금지 key, oversize value fixture의 expected output을 CI에서 비교한다.
- [ ] raw pipeline과 lambda canary 결과의 record 수, 필수 field, bytes, CPU, queue/drop을 같은 시간창에서 비교한다.
- [ ] 새 metric attribute에는 허용값·cardinality 예산·retention·query owner가 있다.
- [ ] raw query/body/token/이메일을 변환으로 "가공"하기 전에 application의 기본 기록 금지 정책을 확인했다.
- [ ] global pipeline 확대 전 5% canary와 24시간 이상 peak traffic 검증을 통과했다.
- [ ] registry artifact와 feature gate를 각각 되돌릴 수 있고, rollback 뒤 self telemetry를 확인한다.

### 연습

현재 Collector 설정에서 서로 다른 서비스가 같은 의미로 쓰는 attribute key 두 개를 고르세요. 예를 들어 `http.status_code`와 `http.response.status_code`처럼 하나는 legacy, 하나는 표준인 경우입니다. 먼저 redacted fixture 50개에서 각 key의 type·누락률·값 범위를 기록합니다. 그다음 한 서비스의 trace canary에만 정규화 rule을 적용하고, 24시간 동안 필수 field 누락률·Collector CPU·export bytes·backend query 결과를 raw baseline과 비교하세요. 이 네 값과 rollback 조건을 적을 수 있을 때에만 global rollout을 검토하는 것이 안전합니다.
