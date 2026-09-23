---
title: "2026 개발 트렌드: OTel 환경변수 Context Propagation RC, CI·CLI의 끊긴 Trace를 운영 계약으로 잇는다"
date: 2026-09-12T10:06:00+09:00
lastmod: 2026-09-12T10:06:00+09:00
draft: false
tags: ["OpenTelemetry", "Context Propagation", "CI/CD", "Developer Experience", "Observability", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["OpenTelemetry environment variable carrier", "TRACEPARENT CI", "process context propagation", "OTel CLI tracing", "CI trace correlation"]
description: "OpenTelemetry 환경변수 context propagation release candidate를 계기로, HTTP 밖에서 시작되는 CI·빌드·CLI·배치 프로세스의 trace를 안전하게 연결하는 도입 경계와 운영 기준을 정리합니다."
summary: "환경변수 carrier는 새 tracing 기능보다 process boundary의 관측 계약이다. CI runner가 shell·build·test를 시작할 때 trace context를 이어 줄 수 있지만, secret·무제한 baggage·전역 환경 변경을 허용하면 관측성 도입이 새 공급망 경계가 된다."
key_takeaways:
  - "OpenTelemetry specification의 environment variable carrier는 release candidate이며, HTTP header나 message metadata가 없는 parent-child process 경계에서 trace context와 baggage를 전달하는 공통 규칙을 제안한다."
  - "핵심 lifecycle은 child 시작 시 environment에서 extract하고, 새 child를 시작할 때만 복사한 environment에 inject하는 것이다. 부모 process의 전역 environment를 바꾸는 방식은 동시 실행에서 trace 오염을 만든다."
  - "TRACEPARENT·TRACESTATE는 trace 연결을 위한 값이고, OTEL_EXPORTER_OTLP_ENDPOINT 같은 SDK 설정값이나 secret은 다른 문제다. 같은 env라는 이유로 한 정책으로 묶으면 안 된다."
  - "첫 도입은 단일 CI workflow 또는 비핵심 batch에서 시작해 trace join rate, invalid context, child leak, exporter 비용을 baseline과 비교해야 한다."
operator_checklist:
  - "propagation env allowlist를 TRACEPARENT, TRACESTATE, 제한된 BAGGAGE로 고정하고, secret·access token·raw customer ID는 차단한다."
  - "child process마다 environment copy를 만들고, 병렬 step이나 worker 사이에 mutable global environment를 공유하지 않는다."
  - "trace join rate, invalid extraction, baggage bytes, child process count, telemetry export failure를 workflow·tool·version별로 관측한다."
  - "CI 로그·artifact·support bundle에서 propagation variable이 마스킹되는지 canary 전에 확인한다."
learning_refs:
  - title: "분산 추적 도입 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/"
    description: "서비스 경계를 넘는 trace와 sampling·attribute·운영 지표의 기본선을 잡습니다."
  - title: "ThreadLocal Context Propagation과 Cleanup"
    href: "/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/"
    description: "같은 process 안의 실행 경계에서 context가 누수되지 않도록 하는 기준입니다."
  - title: "종단간 Deadline·Cancellation Propagation"
    href: "/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/"
    description: "trace 연결과 별개로 deadline·취소를 어떤 계약으로 전파할지 다룹니다."
  - title: "OTTL Lambda와 검증 가능한 Telemetry 계약"
    href: "/posts/2026-09-09-otel-ottl-lambda-governed-transform-contract-trend/"
    description: "수집 뒤 변환을 안전하게 검증하는 Collector 운영 경계입니다."
decision_guide:
  title: "환경변수 carrier를 어디에 먼저 쓸까"
  intro: "판단 기준은 trace가 길어지는가가 아니라, 시작하는 child process와 그 환경을 누가 통제하며 실패 시 어떤 진단이 가능한가입니다."
  cases:
    - badge: "Canary 적합"
      title: "하나의 신뢰된 CI workflow가 shell·build·test 도구를 차례로 실행하는 경로"
      fit: "parent-child 관계와 trace owner가 명확하고, workflow 로그·환경을 통제할 수 있습니다."
      watchouts: "병렬 matrix job에는 부모 context와 child environment를 매 실행마다 분리해야 합니다."
      next_step: "한 workflow에서 1~2주간 join rate와 exporter bytes를 baseline과 비교합니다."
    - badge: "설계 먼저"
      title: "공유 runner, 플러그인, third-party action, 임의 스크립트가 섞인 CI"
      fit: "환경을 누가 읽고 재전파하는지 불분명하면 baggage와 로그 노출 범위가 커집니다."
      watchouts: "propagation을 켜는 것만으로 모든 action이 같은 trace에 붙는다고 가정하면 안 됩니다."
      next_step: "allowlist, action provenance, log masking, env scrub policy를 먼저 고정합니다."
    - badge: "보류"
      title: "secret 또는 고객 식별자를 baggage에 실어야만 상관관계를 만들 수 있는 경로"
      fit: "환경변수는 비밀 전달 채널이 아니며, child·로그·디버그 도구에 노출될 가능성이 있습니다."
      watchouts: "hash라고 해도 안정 식별자는 재식별·카디널리티·보존 문제를 남깁니다."
      next_step: "trace ID와 내부 correlation store를 분리하거나, 수집 전 redaction 설계를 검토합니다."
---

CI 파이프라인을 tracing하면 종종 이상한 모양을 봅니다. workflow span은 있는데 shell step은 새 trace이고, build 도구와 test runner는 또 다른 root span이며, 배포 스크립트는 어디에도 연결되지 않습니다. HTTP 요청처럼 header를 넘길 수 없고, 메시지 큐처럼 metadata가 있는 것도 아니기 때문입니다. 실제 작업은 parent process가 child process를 시작하는 방식으로 이어지는데, 관측성의 context는 그 경계를 건너기 어렵습니다.

2026년 9월 11일 OpenTelemetry는 이를 위한 **environment variable context propagation** specification의 release candidate를 공개했습니다. 이 규격은 HTTP header나 message metadata를 쓸 수 없을 때, process environment를 carrier로 사용해 trace context와 baggage를 전달하는 방법을 정합니다. 새로운 exporter나 자동 계측기가 아니라, CI runner → shell → build → test처럼 이어지는 실행 사슬에 공통된 context 규칙을 부여하려는 변화입니다.

이 글은 [분산 추적 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/), [ThreadLocal Context Propagation과 Cleanup](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/), [종단간 Deadline·Cancellation Propagation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/), [OTTL Lambda와 검증 가능한 Telemetry 계약](/posts/2026-09-09-otel-ottl-lambda-governed-transform-contract-trend/)을 process boundary까지 확장합니다. context를 연결하는 일과 deadline을 전파하는 일, telemetry를 export하는 일, secret을 전달하는 일은 서로 다른 계약이라는 점이 출발점입니다.

공식 자료는 [OpenTelemetry의 RC 발표](https://opentelemetry.io/blog/2026/environment-variable-context-propagation/), [environment variable carrier specification](https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/context/env-carriers.md), [W3C Trace Context](https://www.w3.org/TR/trace-context/)를 기준으로 확인했습니다. 이 규격은 아직 RC이므로, 구현이 존재한다는 사실을 전사 기본값 채택 근거로 삼기보다 실제 runtime·OS·CI 경로에서 검증해야 합니다.

## 이 글에서 얻는 것

- 환경변수 carrier가 어떤 process boundary를 해결하며, HTTP·message propagation의 대체재가 아닌 이유를 이해합니다.
- `TRACEPARENT`, `TRACESTATE`, `BAGGAGE`와 `OTEL_*` SDK 설정·secret을 운영 정책에서 분리하는 기준을 얻습니다.
- 병렬 CI, shell, CLI, batch child process에서 context 오염과 노출을 막는 구현 원칙을 배웁니다.
- canary 대상, 품질 지표, rollback 조건을 숫자로 정해 관측성 도입을 검증할 수 있습니다.

## 핵심 개념/이슈

### 1) carrier는 process가 아니라 값의 운반 매체다

OpenTelemetry에서 context propagation은 현재 span의 trace ID·span ID와 필요할 경우 baggage를 다음 작업에 전달하는 메커니즘입니다. HTTP에서는 header가 carrier이고, Kafka 같은 메시징에서는 message metadata가 carrier가 됩니다. 이번 RC에서 environment는 **child가 시작할 때 받는 문자열 key-value 집합**이라는 점에서 또 하나의 carrier가 됩니다.

W3C Trace Context와 Baggage propagator를 쓴다면 대표 값은 다음과 같습니다.

```text
TRACEPARENT=00-<trace-id>-<parent-span-id>-01
TRACESTATE=<vendor-state>
BAGGAGE=build.id=42,repository.name=example
```

중요한 것은 이 값들이 tracing SDK의 전체 설정이 아니라는 점입니다. `TRACEPARENT`는 trace 계보를 잇고, `TRACESTATE`는 vendor state를 전달하며, `BAGGAGE`는 downstream에 전달할 애플리케이션 key-value입니다. 반면 `OTEL_EXPORTER_OTLP_ENDPOINT`는 child가 telemetry를 어디로 export할지 정하는 SDK 설정입니다. access token이나 cloud credential은 관측성 context가 아니며 propagation allowlist에 들어가면 안 됩니다.

규격은 B3처럼 header 이름에 하이픈이 있는 형식도 environment에서 쓸 수 있도록 이름 정규화도 정의합니다. 예를 들어 `x-b3-traceid`는 `X_B3_TRACEID`로 바뀝니다. 이식성에는 도움이 되지만, 팀의 shell script가 임의 변수명을 만들어 쓰는 것을 허용한다는 뜻은 아닙니다. configured propagator가 parse·validation을 맡고, carrier는 문자열을 옮길 뿐입니다.

### 2) 안전한 lifecycle은 extract → 작업 → 복사본에 inject → child 시작이다

환경변수는 HTTP header보다 긴 수명을 가질 수 있습니다. parent process의 전역 environment를 바꾸면 뒤에 시작되는 무관한 child까지 이전 trace를 물려받을 수 있습니다. 특히 CI matrix, test parallelism, worker pool처럼 child를 동시에 여러 개 시작하는 경로에서는 trace가 섞이는 문제가 바로 생깁니다.

권장 lifecycle은 네 단계입니다.

1. child process는 시작 시 받은 environment에서 context를 **extract**한다.
2. 작업 중 현재 context로 span을 생성한다.
3. 새 child를 시작하기 직전, base environment를 **복사**하고 현재 context를 그 복사본에 **inject**한다.
4. 그 복사본만 child process API에 넘긴다.

이 규칙의 핵심은 environment mutation이 아니라 **child-scoped input**입니다. 다른 span에 속하는 두 child가 동시에 실행돼도 각각 다른 `TRACEPARENT`를 받습니다. `export TRACEPARENT=...`를 runner 전체에 해 둔 뒤 모든 명령을 실행하는 방식은 재현하기 어렵고, retry·background process·후속 step까지 잘못된 parent를 가질 수 있습니다.

### 3) CI의 연결성은 늘어나지만 trust boundary도 함께 넓어진다

CI/CD는 이 패턴의 좋은 후보입니다. workflow runner가 shell을 시작하고, shell이 package manager·compiler·test runner·container build를 시작합니다. 연결된 trace가 있으면 "배포가 18분 걸렸다"는 결과를 lint 2분, dependency download 8분, integration test 6분처럼 분해할 수 있고, 실패가 어느 child에서 시작됐는지 바로 따라갈 수 있습니다.

그러나 CI는 third-party action, repository script, plugin, container image가 섞이는 공급망이기도 합니다. environment 변수는 process 안의 코드가 읽을 수 있고, 시스템에 따라 권한 있는 다른 process나 디버그 도구에도 보일 수 있습니다. OpenTelemetry 공식 안내도 propagation 변수에 secret을 넣지 말고, trust boundary를 넘기기 전에 baggage를 검토하라고 명시합니다.

따라서 carrier 도입의 허용 목록은 작아야 합니다.

| 값 | 기본 정책 | 이유 |
| --- | --- | --- |
| TRACEPARENT | 허용 | trace parent 지정에 필요 |
| TRACESTATE | 제한 허용 | vendor state size·owner를 통제해야 함 |
| BAGGAGE | key/size allowlist | PII·비밀·무한 cardinality 위험 |
| OTEL_* exporter 설정 | 별도 정책 | trace 관계가 아니라 telemetry delivery 설정 |
| token, secret, customer ID | 금지 | 환경 노출과 로그 유출 위험 |

`build.id`처럼 한 workflow에만 의미가 있는 짧은 값도 무제한 baggage로 두면 cardinality와 storage 비용을 높입니다. 상관관계에는 trace ID, workflow run ID, 내부 lookup table을 우선 사용하고, baggage가 꼭 필요하면 key 5개 이하·총 512 bytes 이하처럼 보수적인 예산에서 시작하는 편이 낫습니다.

## 실무 적용

### 1) 한 workflow·한 process tree에서 canary한다

첫 대상은 소유자와 실행 도구가 명확한 내부 CI workflow 하나가 좋습니다. 예를 들어 `lint → unit-test → package` 순서로 실행되고, 외부 deploy 권한이나 third-party action이 없는 경로를 고릅니다. 처음부터 모든 runner에 전역 설정을 넣지 않습니다.

2주 canary의 최소 성공 기준은 아래처럼 둘 수 있습니다.

| 지표 | 통과 기준 | 중단/되돌림 기준 |
| --- | --- | --- |
| child trace join rate | 기대 child의 95% 이상 | 90% 미만이 2회 연속 |
| invalid context extraction | 실행의 0.1% 미만 | 1% 이상 또는 format 오류 급증 |
| trace cross-contamination | 0건 | trace ID가 서로 다른 병렬 job에 재사용 |
| exporter bytes/run | baseline 대비 +10% 이내 | +25% 초과가 24시간 지속 |
| CI elapsed p95 | baseline 대비 +3% 이내 | +10% 초과, 원인 미확인 |

join rate가 낮다고 무조건 실패는 아닙니다. 계측하지 않은 tool은 context를 extract하지 않을 수 있습니다. 다만 "모든 명령이 자동으로 이어진다"고 광고하지 않고, 실제로 연결되는 tool·언어·version을 inventory에 기록해야 합니다. 0% join은 SDK 설정 누락, name normalization 차이, child environment 전달 누락을 뜻할 가능성이 큽니다.

### 2) 로그 마스킹과 scrubbing을 배포 gate에 넣는다

trace context 자체는 credential이 아니지만, `TRACESTATE`와 `BAGGAGE`는 조직 정책에 따라 민감 정보가 될 수 있습니다. 문제는 SDK가 아니라 흔한 운영 동작입니다. `env`를 출력하는 debug script, 실패한 shell step의 verbose log, 지원용 diagnostics bundle, child process crash report가 값을 노출할 수 있습니다.

canary 전에 아래 항목을 확인합니다.

- CI 로그에서 `TRACEPARENT`, `TRACESTATE`, `BAGGAGE`가 필요한 수준으로 마스킹·redact되는가
- `set -x`, `printenv`, process dump가 protected job에서 제한되는가
- child를 시작할 때 사용한 environment copy가 프로세스 종료 뒤 장기 artifact로 보존되지 않는가
- third-party action과 container image에 propagation value를 넘겨도 되는가
- baggage key와 value 길이, 허용 문자, TTL을 validator가 강제하는가

특히 "trace를 잇기 위해 repository name과 branch를 baggage에 넣자"는 제안은 먼저 검토해야 합니다. 공개 저장소라 해도 경로·티켓 제목·customer slug 같은 값을 덧붙이는 순간 관측 backend의 보존·접근 정책이 적용됩니다. attribute를 넣는 편의성보다 데이터 분류가 우선입니다.

### 3) trace를 잇는 일과 control signal을 섞지 않는다

관측성을 붙이다 보면 trace context로 deadline, cancel, 재시도 횟수까지 전파하고 싶어집니다. 하지만 trace는 진단과 상관관계의 신호이며, 실행 제어를 보장하는 프로토콜이 아닙니다. `TRACEPARENT`가 있다고 해서 child가 parent의 timeout을 알고 중단하는 것도, context가 있다고 해서 child의 성공을 보장하는 것도 아닙니다.

deadline·cancellation은 [종단간 Deadline·Cancellation Propagation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)처럼 별도 계약으로 전달합니다. CI tool이라면 명시적 timeout, cancellation signal, process group 종료, artifact cleanup을 각각 검증해야 합니다. context propagation은 그 결과를 한 trace에서 읽게 해 줄 뿐입니다.

마찬가지로 Collector의 transform은 이어진 trace에 들어오는 attribute를 안전하게 다듬는 별도 단계입니다. [OTTL Lambda와 검증 가능한 Telemetry 계약](/posts/2026-09-09-otel-ottl-lambda-governed-transform-contract-trend/)처럼 input·output·drop·error mode를 fixture로 검증하지 않으면, CI trace를 성공적으로 연결한 뒤에도 중요한 field를 export 단계에서 잃을 수 있습니다.

## 트레이드오프/주의점

1. **환경변수 carrier는 network propagation의 대체재가 아닙니다.** HTTP, gRPC, 메시지 작업은 기존 protocol carrier를 써야 합니다. Pod나 독립 container도 서로 process environment를 상속하지 않으므로 별도 injection이 필요합니다.
2. **RC는 안정 API 약속이 아닙니다.** 언어별 helper와 tool coverage가 다를 수 있습니다. SDK·CI integration·OS 조합을 version pin하고, spec 안정화 전에는 fallback과 rollback을 준비합니다.
3. **baggage는 context가 아니라 데이터 운반 경로가 될 수 있습니다.** 허용 키·크기·owner·보존 기간이 없으면 PII와 비용 문제가 늦게 드러납니다.
4. **전역 runner env는 편하지만 부정확합니다.** 병렬 process, retry, daemon, background job이 같은 context를 재사용하면 trace는 길어져도 진실성이 떨어집니다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 대상 workflow의 parent-child process tree와 tool version을 그렸다.
- [ ] propagation env allowlist와 baggage key·size budget을 코드/runner 정책에 고정했다.
- [ ] child마다 copied environment를 전달하고 전역 environment mutation을 금지했다.
- [ ] join rate, invalid extraction, export bytes, cross-contamination의 baseline·중단 기준을 정했다.
- [ ] `printenv`, verbose shell, crash dump, artifact에서 값이 노출되지 않는지 canary로 확인했다.
- [ ] deadline·cancel·secret 전달을 trace propagation과 별도 계약으로 유지했다.

### 연습: build trace canary 설계하기

`build-service` workflow가 shell에서 `make test`와 `make package`를 순서대로 실행한다고 가정해 보세요. 각 child가 받는 environment copy에 어떤 key만 inject할지 적고, 두 명령을 병렬 실행했을 때 서로 다른 parent span을 갖는지 검증하는 테스트를 만드세요. 이어서 `BAGGAGE`에 `repository.name`, `build.id`, `customer_id`를 넣자는 세 제안을 놓고, 허용·hash 후 검토·금지로 나누며 이유와 대체 상관관계 수단을 기록해 보세요.

## 마무리

환경변수 context propagation은 CI와 CLI를 마법처럼 자동 관측하는 기능이 아닙니다. process를 시작하는 쪽이 **어떤 context를, 어떤 child에게, 어떤 데이터 경계 안에서 전달할지** 명시하는 계약입니다. 잘 적용하면 끊긴 build·test·batch trace를 하나의 실행 흐름으로 읽게 해 줍니다. 반대로 전역 env, 무제한 baggage, 무검증 third-party step에 그대로 넓히면 observability가 새 공급망 노출이 됩니다. 그러므로 도입 순서는 process tree 확인, 제한된 canary, 로그 검증, 수치 기반 승격이어야 합니다.
