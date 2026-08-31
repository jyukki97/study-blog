---
title: "2026 개발 트렌드: OpenTelemetry 선언적 구성, 계측 설정이 환경변수 묶음에서 검증 가능한 버전 계약으로 이동한다"
date: 2026-08-29T10:06:00+09:00
lastmod: 2026-08-29T10:06:00+09:00
draft: false
tags: ["OpenTelemetry", "Declarative Configuration", "Spring Boot", "Observability", "Platform Engineering", "Configuration Governance"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["OpenTelemetry declarative configuration", "OpenTelemetry Spring Boot starter 2.26.0", "telemetry configuration contract", "application.yaml observability", "OTEL_SERVICE_NAME"]
description: "OpenTelemetry Spring Boot starter의 선언적 구성 지원을 계기로, telemetry 설정이 흩어진 OTEL_* 환경변수에서 스키마 검증·리뷰·롤백 가능한 버전 계약으로 이동할 때의 도입 기준과 운영 주의점을 정리합니다."
summary: "OpenTelemetry Java agent와 Spring Boot starter가 같은 선언적 구성 스키마를 향하면서, 계측 정책은 환경변수 목록이 아니라 versioned configuration artifact가 된다. 다만 configuration이 코드보다 쉽다는 이유로 sampling·export·민감 attribute 정책을 무분별하게 넓히면 비용과 데이터 노출도 함께 커진다."
key_takeaways:
  - "2026년 7월부터 OpenTelemetry Spring Boot starter 2.26.0은 application.yaml 안에서 SDK 선언적 구성 스키마를 지원한다."
  - "선언적 구성의 핵심 가치는 YAML 자체가 아니라, processor·exporter·sampler의 조합을 스키마·diff·테스트·rollout 대상으로 만들 수 있다는 점이다."
  - "Spring의 property resolution과 SDK standalone YAML의 placeholder 문법·우선순위는 같지 않으므로 복사만으로 이식하면 설정이 조용히 달라질 수 있다."
  - "도입 성공은 trace 양이 아니라 필수 resource attribute 충족률, 금지 attribute 검출, export drop, ingest 비용, rollback 시간이 기준이다."
operator_checklist:
  - "텔레메트리 설정을 애플리케이션 코드와 별도의 reviewable artifact로 version pin하고, schema validation과 representative trace test를 CI에 둔다."
  - "service.name, service.version, deployment.environment의 source와 override 우선순위를 한 문서에서 고정한다."
  - "새 sampler·exporter는 staging에서 export 성공률, Collector queue/drop, 데이터량, 민감 attribute 검출을 함께 canary한다."
  - "starter application.yaml과 agent standalone config를 섞는 경우 placeholder 문법과 property precedence를 테스트 fixture로 검증한다."
learning_refs:
  - title: "OpenTelemetry Blueprints와 관측성 운영 계약"
    href: "/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/"
    description: "워크로드별 telemetry 표준을 템플릿·검증·운영 책임으로 설계하는 앞선 글입니다."
  - title: "Go Compile-Time Instrumentation"
    href: "/posts/2026-07-18-go-compile-time-instrumentation-trend/"
    description: "계측 방식이 코드 라이브러리를 넘어 build pipeline 계약으로 이동하는 흐름을 비교합니다."
  - title: "분산 트레이싱 도입 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/"
    description: "경계 우선 계측과 context continuity를 실제 서비스에서 검증하는 방법입니다."
  - title: "메트릭 카디널리티 예산과 라벨 거버넌스"
    href: "/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/"
    description: "설정으로 새 attribute를 추가할 때 비용과 label 폭발을 막는 기준입니다."
decision_guide:
  title: "선언적 telemetry 구성을 언제 기본 경로로 올릴까"
  intro: "판단 기준은 ‘코드를 덜 쓸 수 있는가’가 아니라, 현재 설정의 차이와 위험을 반복해서 재현·검증할 수 있는가입니다."
  cases:
    - badge: "우선 도입"
      title: "여러 Spring 서비스가 서로 다른 OTEL_* 변수와 customizer 코드를 가진다"
      fit: "sampler, exporter, resource attribute가 팀별로 갈리고 장애 때 실제 설정을 재현하기 어려운 조직에 맞습니다."
      watchouts: "첫 migration에서 모든 설정을 통합하지 말고 한 서비스 유형의 최소 pipeline부터 시작해야 합니다."
      next_step: "HTTP API 유형 하나의 resource·sampling·export 정책을 YAML artifact와 validation test로 묶습니다."
    - badge: "부분 적용"
      title: "기본 계측은 안정적이지만 path filtering이나 exporter routing이 코드에 박혀 있다"
      fit: "운영 정책만 더 빠르게 수정·리뷰하고 싶은 팀에 맞습니다."
      watchouts: "동일 policy가 code customizer와 YAML에 중복되면 span drop·중복 export의 원인이 됩니다."
      next_step: "최근 변경 3개를 inventory하여 YAML로 옮길 policy와 코드에 남길 domain instrumentation을 나눕니다."
    - badge: "보류"
      title: "기본 resource attribute와 trace context 연속성도 검증되지 않았다"
      fit: "구성 표현을 바꿔도 데이터 품질을 확인할 기준이 아직 없는 경우입니다."
      watchouts: "복잡한 sampler tree를 먼저 도입하면 설정 오류를 알아채기 더 어려워집니다."
      next_step: "상위 요청 경로 3개에서 service.name·version·environment와 parent-child trace를 먼저 고정합니다."
---

관측성 설정은 오랫동안 환경변수 목록으로 관리됐습니다. `OTEL_SERVICE_NAME`, exporter endpoint, sampler 이름, header capture처럼 평평한 `OTEL_*` 값을 배포 manifest에 넣는 방식입니다. 이 방식은 단순한 선택에는 좋습니다. 하지만 processor가 exporter를 품고, signal마다 다른 routing·sampling·redaction이 필요해지면 변수 목록은 설정의 구조와 의도를 보여 주지 못합니다. 같은 값을 어디에서 override했는지, 어떤 rule이 어떤 span을 버리는지, release마다 무엇이 달라졌는지 검토하기도 어렵습니다.

2026년 7월 OpenTelemetry는 Spring Boot starter **2.26.0부터** `application.yaml` 안에서 SDK 선언적 구성(declarative configuration) 스키마를 지원한다고 설명했습니다. Java agent가 2025년 말에 도입한 YAML 스키마를 Spring Boot 환경에도 가져온 변화입니다. 이것은 새 exporter 하나의 소식보다, **telemetry policy를 애플리케이션 설정의 일부이면서 동시에 검증 가능한 버전 계약으로 관리할 수 있게 된 신호**에 가깝습니다.

이 글은 [OpenTelemetry Blueprints와 관측성 운영 계약](/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/), [Go Compile-Time Instrumentation](/posts/2026-07-18-go-compile-time-instrumentation-trend/), [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)을 잇습니다. 앞선 글이 공통 telemetry 경로와 계측 방식을 다뤘다면, 여기서는 그 경로를 어떻게 diff·검증·rollback 가능한 configuration artifact로 만들지 다룹니다.

공식 자료:

- [OpenTelemetry: The Voyage of a Small Environment Variable](https://opentelemetry.io/blog/2026/spring-boot-declarative-config/)
- [OpenTelemetry: Declarative configuration is stable](https://opentelemetry.io/blog/2026/stable-declarative-config/)
- [OpenTelemetry Configuration](https://opentelemetry.io/docs/specs/otel/configuration/)

## 이 글에서 얻는 것

- Spring Boot starter의 선언적 구성이 무엇을 바꾸고, 환경변수를 어떤 역할로 남기는지 이해합니다.
- sampler·processor·exporter 조합을 YAML에 옮길 때 source of truth와 precedence를 설계합니다.
- configuration diff를 data quality·비용·rollout gate로 검증하는 기준을 얻습니다.
- schema가 아직 진화하는 구간에서 version pin과 rollback을 어떻게 운영할지 정리합니다.

## 핵심 개념/이슈

### 1) 평평한 변수 목록에서 실행 모델과 닮은 설정 트리로

환경변수는 잘 알려진 기본값을 전달하기에 좋습니다. 예를 들어 service 이름, OTLP endpoint, 단순 sampler 선택처럼 한 값으로 표현되는 옵션은 `OTEL_*`가 간결합니다. 문제는 pipeline이 복잡해지는 순간입니다. custom rule-based sampler, signal별 exporter, processor 순서, resource transform처럼 중첩 구조가 생기면 변수를 늘리는 방식은 표현력이 부족하거나 vendor·custom code로 빠집니다.

Spring Boot starter의 새 경로에서는 `application.yaml`의 `otel:` 아래에 SDK configuration schema를 둡니다. `otel.file_format`이 있는 블록을 SDK schema로 해석하고, resource·tracer provider·processor·exporter의 트리를 런타임 모델과 가까운 모양으로 적을 수 있습니다. 예를 들어 actuator path를 제외하는 sampler rule은 예전에는 `@Configuration`과 customizer 코드로 만들던 조합이었지만, 이제는 configuration rule로 둘 수 있습니다.

중요한 변화는 YAML을 쓴다는 사실이 아닙니다. **누가 pipeline wiring을 작성하는가**가 바뀝니다. platform team은 필요한 rule을 artifact로 제공하고, service team은 코드에 generic wiring을 복사하지 않아도 됩니다. 반면 주문 승인·정산 마감·권한 판정처럼 도메인 의미가 있는 span은 여전히 코드에서 명시적으로 만들어야 합니다. 선언적 구성은 domain instrumentation의 대체물이 아니라, 공통 기술 정책의 배포 형식입니다.

### 2) 하나의 `otel:` 키가 하나의 source of truth를 뜻하지는 않는다

가장 위험한 오해는 “YAML을 넣었으니 환경변수는 더 이상 영향을 주지 않는다”는 것입니다. 공식 설명에 따르면 Spring Boot starter 안에서는 Spring의 property stack이 environment variable, system property, command-line argument, profile overlay, `application.yaml`을 하나의 property universe로 정리합니다. `OTEL_SERVICE_NAME`도 resource detector를 통해 service name에 반영될 수 있고, YAML의 `${VAR:default}` placeholder는 Spring이 아는 source에서 값을 찾습니다.

반면 Java agent가 읽는 standalone SDK YAML은 Spring property stack을 거치지 않습니다. placeholder 문법도 다를 수 있습니다. starter의 Spring YAML에서 `${VAR:default}`가 동작한다고 해서 agent의 standalone file에서 같은 표현을 그대로 복사하면 안 됩니다. agent 쪽 SDK resolver는 environment variable과 JVM system property 중심으로 동작하고 default 표기도 다릅니다. **보이는 문법이 같아도 resolver와 precedence가 다르다**는 점이 migration의 핵심 위험입니다.

그래서 다음 ownership 표를 먼저 정하는 편이 좋습니다.

| 설정 종류 | 기본 source | runtime override | 검증 질문 |
| --- | --- | --- | --- |
| `service.name`, environment | deployment manifest + YAML default | 승인된 환경변수만 | release마다 값이 바뀌지 않는가 |
| exporter endpoint·TLS | environment-specific secret/config | canary flag | staging과 production이 같은 signal routing인가 |
| sampler·processor rule | versioned YAML artifact | 긴급 rollback만 | rule diff가 trace volume에 미친 영향은 무엇인가 |
| domain span | application code | 없음 | business boundary가 trace에 남는가 |

source를 복수로 허용해야 한다면, 우선순위와 허용 범위를 명시해야 합니다. 예를 들어 production에서 `OTEL_SERVICE_NAME` override를 자유롭게 열어 두면 service identity가 배포 manifest와 어긋나면서 dashboard·SLO·비용 귀속이 무너질 수 있습니다. 운영 override는 endpoint 같은 환경 의존 값으로 좁히고, identity와 sampling rule은 code review를 통과한 artifact에서만 바꾸는 편이 안전합니다.

### 3) configuration은 코드보다 쉽게 배포되므로 더 엄격한 gate가 필요하다

YAML change는 compile error 없이 적용될 수 있고, 유효한 schema라도 의도와 다른 data를 내보낼 수 있습니다. 예를 들어 `/actuator` drop pattern의 한 글자 차이가 health check trace를 모두 보내거나, 반대로 정상 API를 drop할 수 있습니다. exporter endpoint 하나가 잘못되면 service는 정상인데 telemetry만 조용히 사라질 수 있습니다. 설정을 코드보다 가볍게 취급하면 안 되는 이유입니다.

최소 CI gate는 네 단계면 충분히 시작할 수 있습니다.

1. **schema validation**: 사용하는 starter/agent version에 맞는 schema인지 검증합니다.
2. **policy lint**: required resource attribute, 금지 header/body capture, 허용 exporter를 검사합니다.
3. **representative trace test**: 정상, 4xx/5xx, 느린 downstream 세 요청에서 span 수·parent-child·resource를 golden expectation과 비교합니다.
4. **canary telemetry gate**: export success, Collector queue/drop, sampled trace 수, ingest bytes, sensitive attribute 검출을 baseline과 비교합니다.

이 중 schema validation만 통과하고 나머지를 생략하면 ‘형식적으로 유효하지만 운영상 틀린’ 설정을 막을 수 없습니다. [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)의 원칙처럼 새 attribute나 rule은 owner, cardinality, PII 등급, 소비처를 함께 가져야 합니다.

### 4) 2026년의 흐름은 설정 표준화와 실험 경계를 분리한다

Spring Boot starter와 Java agent가 같은 configuration schema를 향하는 것은 platform team에 좋은 신호입니다. 동일한 policy를 서비스마다 다른 customizer class와 agent extension jar로 관리할 필요가 줄어들 수 있기 때문입니다. 그러나 모든 구성 요소가 동일한 성숙도를 가진다는 뜻은 아닙니다. 공식 글도 일부 richer composition path를 development 성격으로 구분하고, schema 자체가 생성되는 모델이기 때문에 IDE metadata나 binding 편의성은 계속 발전 중이라고 설명합니다.

따라서 설정을 세 등급으로 나누는 편이 현실적입니다.

| 등급 | 예시 | 운영 방식 |
| --- | --- | --- |
| Baseline | resource attribute, OTLP endpoint, batch exporter, 기본 sampling | 공통 template·release gate·분기별 review |
| Controlled | path filter, signal별 exporter, tail sampling override | service owner 승인·2주 canary·명시 rollback |
| Experimental | development schema, 새 sampler composition, agent-specific extension | isolated staging·production default off |

새 기능을 YAML로 표현할 수 있다는 이유만으로 baseline에 넣지 않습니다. schema stability, library support, cross-service debugability, rollback path를 모두 확인해야 합니다. 선언적 구성은 실험을 쉽게 하는 도구이기도 하므로, 실험이 영구 설정으로 굳는 것을 막는 lifecycle이 필요합니다.

## 실무 적용

### 1) 가장 작은 공통 artifact부터 만든다

첫 migration은 전체 Collector topology를 YAML로 옮기는 일이 아닙니다. HTTP API라는 워크로드 하나를 골라 아래처럼 제한합니다.

- 필수 resource: `service.name`, `service.version`, `deployment.environment.name`
- 허용 signal: inbound HTTP, outbound HTTP, DB dependency, error status
- 기본 제외: request/response body, authorization header, session token, full user identifier
- sampling: 오류 100%, 성공은 정해진 head rate 또는 route 기반 rule
- exporter: 승인된 OTLP endpoint 하나와 TLS policy

이 artifact를 starter version과 함께 pin하고, 각 서비스는 route·tenant policy처럼 정말 다른 부분만 override합니다. `application.yaml` 전체를 중앙 template으로 덮어쓰면 Spring profile과 application 설정의 ownership이 흐려집니다. OTel subtree와 deployment values를 분리하고 merge 방식을 문서화해야 합니다.

### 2) 2주 canary 기준을 숫자로 정한다

제안된 configuration을 staging에서 테스트한 뒤 production 5% traffic에 적용합니다. 다음은 보수적인 출발선입니다.

- 필수 resource attribute 누락률: **0.1% 미만**
- 대표 3개 route의 trace context continuity: **99% 이상**
- export 실패 또는 Collector drop: baseline 대비 **+0.2%p 이내**
- trace ingest bytes: baseline 대비 **+20% 이내** 또는 사전에 승인한 비용 한도 안
- 금지 attribute 검출: **0건**
- rollback: artifact revision 하나로 **15분 이내** 원복 가능

성공 trace 수가 늘었다는 사실만으로 확대하지 않습니다. 오류 trace와 정상 trace를 각각 보고, 실제 incident에서 service name·version·environment를 기준으로 필터링할 수 있는지도 확인합니다. 최종 gate는 “YAML이 예쁘게 정리됐는가”가 아니라 “사고 중 현재 정책과 데이터 품질을 재현할 수 있는가”입니다.

### 3) diff를 운영 이벤트로 취급한다

sampler를 `always_on`에서 rate limit으로 바꾸거나 exporter를 추가하는 change는 데이터 제품의 behavior change입니다. PR에는 최소한 다음을 적습니다.

```text
- 변경 대상: checkout API, Spring Boot starter 2.26.0
- 정책 변화: /actuator server span drop, 오류 trace 보존 유지
- 예상 변화: trace volume -12~18%, P0 route 영향 없음
- 검증: 대표 request 3종, Collector queue/drop, sensitive attribute scan
- rollback: otel-policy v2026.08.29.1 -> v2026.08.16.3
```

이 형식은 [OpenTelemetry Blueprints와 관측성 운영 계약](/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/)의 blueprint를 실제 release 단위로 낮춘 것입니다. configuration repository, application repository, Helm/Kustomize 중 어디에 artifact를 둘지는 조직마다 달라도, version·owner·검증 결과·rollback target은 한 곳에서 연결돼야 합니다.

### 4) 코드와 configuration의 경계를 계속 정리한다

configuration에는 환경별 endpoint, sampling, generic attribute rule, processor/exporter 조합을 둡니다. 코드에는 business span, domain event, 오류 mapping, request context propagation을 둡니다. 같은 policy를 양쪽에 중복시키면 source of truth가 다시 갈라집니다.

예를 들어 `/actuator`를 제외하는 것은 generic telemetry policy라 configuration 후보입니다. `payment.authorize` span 안에 payment method의 민감도 분류를 남기는 것은 domain contract이므로 코드와 domain data policy가 더 적합합니다. 이 선을 PR template에 적으면 “코드 없이 바꿀 수 있다”는 편의가 data governance의 우회로가 되는 일을 줄일 수 있습니다.

## 트레이드오프/주의점

1. **설정 파일이 코드보다 안전한 것은 아닙니다.** version pin·schema validation·canary가 없으면 YAML은 더 빠르게 전 서비스에 잘못된 sampling과 exporter를 퍼뜨릴 수 있습니다.

2. **환경변수를 즉시 없애지 않습니다.** secret endpoint, 배포별 value처럼 runtime injection이 자연스러운 값은 남습니다. 다만 policy와 identity까지 임의 environment override에 맡기지 않습니다.

3. **starter와 agent의 설정을 문법만 보고 복사하지 않습니다.** placeholder resolver, property source, precedence 차이는 테스트로 확인해야 합니다. 같은 `${...}`가 같은 결과를 낸다는 전제는 위험합니다.

4. **더 풍부한 pipeline이 더 좋은 observability를 보장하지 않습니다.** processor와 exporter를 늘리면 latency, memory, data volume, PII 노출 표면도 늘어납니다. 새 rule마다 ‘어떤 incident 질문에 답하는가’를 먼저 적습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] starter/agent와 configuration schema의 version을 함께 pin했다.
- [ ] identity, endpoint, sampler, domain span의 source of truth와 override 범위를 문서화했다.
- [ ] schema validation뿐 아니라 representative trace golden test가 있다.
- [ ] required resource 누락, export/drop, ingest bytes, sensitive attribute를 canary gate로 본다.
- [ ] configuration diff마다 owner, 예상 volume 변화, rollback artifact가 있다.
- [ ] experimental schema와 baseline policy를 같은 release gate로 취급하지 않는다.

### 연습: actuator 제외 정책을 검증 가능한 artifact로 바꾸기

1. 현재 Spring 서비스에서 actuator 또는 health path를 제외하는 코드·환경변수·agent rule을 모두 inventory합니다.
2. 한 가지 source of truth를 골라 starter version에 맞는 선언적 configuration으로 옮깁니다.
3. 정상 API, `/actuator/health`, 500 error 요청으로 trace fixture를 만들고 span 수와 parent-child 관계를 비교합니다.
4. 5% canary에서 trace volume, export drop, 필수 resource 누락, 금지 header 검출을 7일간 기록합니다.
5. 기준을 통과하면 policy artifact version을 올리고, 기존 customizer가 완전히 제거됐는지 재확인합니다.

## 관련 글

- [OpenTelemetry Blueprints와 관측성 운영 계약](/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/)
- [Go Compile-Time Instrumentation](/posts/2026-07-18-go-compile-time-instrumentation-trend/)
- [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)
- [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)
