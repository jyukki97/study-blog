---
title: "2026 개발 트렌드: Go Compile-Time Instrumentation, 관측성이 빌드 파이프라인으로 들어간다"
date: 2026-07-18T10:06:00+09:00
draft: false
tags: ["OpenTelemetry", "Go", "Observability", "Compile-Time Instrumentation", "SRE", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["OpenTelemetry Go Compile-Time Instrumentation", "otelc", "Go observability", "zero-code instrumentation", "build pipeline observability"]
description: "OpenTelemetry Go Compile-Time Instrumentation v1 발표를 바탕으로, Go 서비스 관측성이 런타임 에이전트나 수동 계측을 넘어 빌드 파이프라인의 표준 단계로 이동하는 이유를 정리합니다."
lastmod: 2026-07-18
summary: "Go는 정적 바이너리 특성 때문에 자동 계측이 까다로웠지만, OpenTelemetry Go Compile-Time Instrumentation v1은 빌드 단계에서 표준 라이브러리와 의존성까지 계측하는 선택지를 안정화했다. 이제 관측성 도입은 코드 수정만이 아니라 빌드 계약, 검증, 배포 정책의 문제다."
key_takeaways:
  - "OpenTelemetry는 2026년 7월 16일 Go Compile-Time Instrumentation v1을 발표하며, `otelc go build` 방식의 안정화된 빌드 타임 계측 흐름을 제시했다."
  - "Go 서비스는 수동 계측, eBPF/OBI, 컴파일타임 계측을 상황별로 조합하는 방향으로 이동하고 있다."
  - "실무 도입은 빌드 한 줄 교체가 아니라 span 품질, library coverage, overhead, rollback, CI 재현성을 함께 검증하는 작업이다."
operator_checklist:
  - "Go 서비스 상위 3개 경로에서 manual span, auto span, eBPF 신호가 서로 어떤 빈칸을 채우는지 표로 정리한다."
  - "컴파일타임 계측은 staging에서 p95 latency, binary size, startup time, trace cardinality, build time 변화를 비교한 뒤 canary로 연다."
  - "빌드 파이프라인에 `otelc`를 넣는다면 버전 고정, 재현 가능한 Docker build, 실패 시 일반 `go build` fallback 기준을 문서화한다."
learning_refs:
  - title: "OpenTelemetry 네이티브 데이터 플레인"
    href: "/posts/2026-07-01-opentelemetry-native-data-plane-trend/"
    description: "OTel을 wrapper보다 native API와 telemetry pipeline 관점으로 다루는 흐름입니다."
  - title: "OpenTelemetry 실무 가이드"
    href: "/learning/deep-dive/deep-dive-opentelemetry/"
    description: "API, SDK, Collector, exporter의 기본 운영 기준입니다."
  - title: "분산 트레이싱 도입 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/"
    description: "트레이싱을 어디에, 얼마나, 어떤 샘플링으로 붙일지 판단하는 기준입니다."
  - title: "eBPF 기반 프로덕션 디버깅"
    href: "/learning/deep-dive/deep-dive-ebpf-production-debugging-playbook/"
    description: "런타임 외부에서 커널/네트워크 신호를 보는 선택지와 비교할 수 있습니다."
decision_guide:
  title: "Go Compile-Time Instrumentation을 언제 검토할까"
  intro: "모든 Go 서비스에 즉시 넣을 필요는 없습니다. 재빌드 가능성, 라이브러리 coverage, 수동 계측 상태, SRE 표준화 필요성을 기준으로 도입 범위를 정해야 합니다."
  cases:
    - badge: "도입 검토"
      title: "Go 서비스가 많고 트레이싱 coverage가 팀별로 들쭉날쭉하다"
      fit: "플랫폼팀이 공통 빌드 파이프라인을 관리하고, 서비스팀이 매번 수동 계측할 여력이 부족한 조직에 맞습니다."
      watchouts: "자동 span이 늘어도 도메인 의미가 있는 span은 여전히 수동 계측이 필요합니다."
      next_step: "상위 2개 서비스에서 `otelc` staging build를 만들고 기존 trace와 span diff를 비교합니다."
    - badge: "부분 적용"
      title: "핵심 서비스는 이미 수동 계측이 잘 되어 있다"
      fit: "HTTP, DB, Redis, gRPC 경계는 이미 보이지만 표준 라이브러리나 일부 dependency coverage가 부족한 경우입니다."
      watchouts: "중복 span과 attribute cardinality가 늘어날 수 있습니다."
      next_step: "manual instrumentation과 compile-time instrumentation의 중복 구간을 먼저 inventory합니다."
    - badge: "보류 가능"
      title: "재빌드가 어렵거나 vendor binary를 그대로 운영한다"
      fit: "소스와 빌드 파이프라인을 통제하지 못하는 바이너리에는 compile-time 방식이 맞지 않습니다."
      watchouts: "이 경우 eBPF/OBI 같은 외부 계측이나 proxy-level telemetry가 더 현실적일 수 있습니다."
      next_step: "재빌드 가능 서비스와 불가능 서비스를 나누고, 후자는 eBPF/sidecar 관측을 검토합니다."
faqs:
  - question: "컴파일타임 계측이면 수동 span은 필요 없나요?"
    answer: "아닙니다. HTTP, DB, Redis 같은 기술 경계는 자동화할 수 있지만, 주문 승인, 정산 마감, 권한 판정 같은 도메인 의미는 수동 span이나 이벤트로 남겨야 합니다."
  - question: "`otelc go build`로 바꾸면 바로 운영에 넣어도 되나요?"
    answer: "빌드는 쉬워 보여도 운영 도입은 별도 검증이 필요합니다. build time, binary size, p95 latency, span 수, attribute cardinality, Collector 비용을 staging과 canary에서 비교해야 합니다."
---

2026년 7월 16일 OpenTelemetry는 Go Compile-Time Instrumentation v1을 발표했습니다. Go 서비스 운영자에게 꽤 중요한 신호입니다. Java, Python, Node.js, .NET은 오래전부터 런타임 에이전트나 자동 계측 선택지가 많았지만, Go는 정적 바이너리로 컴파일되는 특성 때문에 같은 방식이 쉽지 않았습니다. 그래서 Go 팀은 수동으로 OpenTelemetry API를 붙이거나, 프로세스 밖에서 eBPF 기반 도구로 관측하는 선택을 많이 해왔습니다.

이번 v1의 핵심은 빌드 단계입니다. OpenTelemetry 쪽 설명에 따르면 `otelc`라는 도구가 Go toolchain의 `-toolexec` 경로를 활용해 컴파일 중 애플리케이션 코드, 의존성, 표준 라이브러리에 계측을 주입합니다. 사용자는 `go build` 대신 `otelc go build`를 실행하거나, `GOFLAGS`에 toolexec 설정을 넣는 식으로 빌드 경로를 바꿉니다. 즉 관측성이 런타임에 붙는 에이전트나 소스 코드 변경이 아니라 **빌드 파이프라인의 계약**으로 들어오는 흐름입니다.

이 글은 [OpenTelemetry 네이티브 데이터 플레인](/posts/2026-07-01-opentelemetry-native-data-plane-trend/), [OpenTelemetry 실무 가이드](/learning/deep-dive/deep-dive-opentelemetry/), [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/), [eBPF 기반 프로덕션 디버깅](/learning/deep-dive/deep-dive-ebpf-production-debugging-playbook/)과 이어집니다.

참고 신호:

- OpenTelemetry Blog, Announcing v1 of OpenTelemetry Go Compile-Time Instrumentation: https://opentelemetry.io/blog/2026/go-compile-time-instrumentation-v1/
- OpenTelemetry Blog, The Voyage of a Small Environment Variable: https://opentelemetry.io/blog/2026/spring-boot-declarative-config/

## 이 글에서 얻는 것

- Go에서 자동 계측이 왜 다른 언어보다 어려웠고, 컴파일타임 계측이 어떤 빈칸을 채우는지 이해합니다.
- 수동 계측, 컴파일타임 계측, eBPF/OBI를 어떤 기준으로 나눠 쓸지 판단할 수 있습니다.
- `otelc`를 빌드 파이프라인에 넣기 전 검증해야 할 p95 latency, span cardinality, build reproducibility 기준을 가져갑니다.
- 관측성 표준이 코드 라이브러리 선택을 넘어 CI/CD와 플랫폼 정책으로 확장되는 흐름을 파악합니다.

## 핵심 개념/이슈

### 1) Go의 자동 계측 문제는 런타임 구조에서 출발한다

Java나 .NET은 런타임에 에이전트를 붙여 클래스 로딩, method interception, framework hook을 활용할 수 있습니다. Python과 Node.js도 동적 런타임 특성 덕분에 import나 monkey patch 기반 계측이 가능합니다. Go는 다릅니다. 배포 결과물이 정적 바이너리이고, 운영 시점에 attach할 풍부한 런타임 계층이 없습니다.

그래서 Go에서 자동 계측은 오래도록 세 갈래였습니다.

| 방식 | 장점 | 한계 |
| --- | --- | --- |
| 수동 OTel API 계측 | 도메인 의미와 span 품질이 좋음 | 팀별 구현 편차와 도입 비용 |
| eBPF/OBI | 재빌드 없이 외부에서 관측 가능 | 애플리케이션 내부 도메인 의미는 제한적 |
| 컴파일타임 계측 | 재빌드 가능 서비스에 zero-code coverage 제공 | 빌드 파이프라인 변경과 coverage 검증 필요 |

이번 v1은 세 번째 축을 안정화한 신호입니다. 런타임에 붙일 곳이 없다면 빌드할 때 넣자는 접근입니다. 플랫폼팀 입장에서는 이 방식이 매력적입니다. 서비스팀에게 모든 HTTP handler, DB client, Redis client, gRPC client 계측 코드를 직접 쓰라고 요구하지 않아도 기본 trace와 metric을 얻을 수 있기 때문입니다.

### 2) 빌드 한 줄 교체는 운영 변화의 시작일 뿐이다

OpenTelemetry 발표 글은 `otelc go build`처럼 빌드 명령을 바꾸는 간단한 시작점을 제시합니다. 하지만 운영팀이 봐야 할 것은 명령의 간단함이 아니라 결과물의 변화입니다.

검증할 항목은 최소 아래입니다.

- build time이 기준선 대비 얼마나 늘어나는가
- binary size가 얼마나 증가하는가
- HTTP, `database/sql`, gRPC, Redis 같은 주요 라이브러리가 실제로 span을 내는가
- 기존 수동 span과 중복 span이 생기지 않는가
- attribute cardinality가 높아져 저장 비용이 급증하지 않는가
- p95 latency와 CPU overhead가 기준선 대비 허용 범위 안인가
- 계측 실패 시 일반 `go build`로 되돌릴 수 있는가

권장 기준은 staging에서 최소 1주일, 상위 3개 요청 경로, 정상/에러/slow request를 나눠 비교하는 것입니다. p95 latency가 기준선 대비 3~5% 이상 오르거나, span 수가 2배 이상 늘면서 분석 품질이 좋아지지 않는다면 바로 전체 적용하기보다 rule과 sampling을 조정해야 합니다.

### 3) 자동 span은 기술 경계를 채우고, 수동 span은 업무 의미를 채운다

컴파일타임 계측이 안정화되어도 수동 계측이 사라지지는 않습니다. 자동 계측은 `GET /orders`, `SELECT`, `redis.get`, `grpc.client` 같은 기술 경계를 잘 채웁니다. 하지만 서비스 운영자가 장애 때 묻는 질문은 더 업무적입니다.

- 주문 승인 단계가 payment gateway 대기 때문에 늦었는가
- 정산 마감 job이 어떤 tenant에서 멈췄는가
- 권한 판정 cache miss가 특정 role에서만 늘었는가
- retry가 사용자 요청 deadline 안에서 몇 번 발생했는가

이런 의미는 자동 계측만으로 충분하지 않습니다. 그래서 실무 기준은 "자동 계측으로 경계를 넓히고, 수동 계측으로 의미를 깊게 만든다"입니다. [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)에서도 초기 span은 HTTP/gRPC, DB, Redis, 큐 같은 경계부터 잡으라고 했습니다. 컴파일타임 계측은 이 초기 coverage를 빠르게 확보하는 도구가 될 수 있습니다.

### 4) eBPF와 경쟁하는 것이 아니라 위치가 다르다

OpenTelemetry는 v1 발표에서 컴파일타임 계측, eBPF/OBI, 수동 계측을 상호 보완적인 선택지로 설명합니다. 이 구분이 중요합니다. 재빌드 가능한 사내 Go 서비스라면 compile-time instrumentation이 좋을 수 있습니다. 반대로 외부 vendor binary, 레거시 배포물, 소스를 통제하지 못하는 에이전트는 빌드 타임에 손댈 수 없습니다. 이때는 eBPF/OBI가 더 현실적입니다.

또 eBPF는 애플리케이션 코드 밖에서 커널, 네트워크, syscall, off-CPU 같은 신호를 볼 수 있습니다. 컴파일타임 OTel은 애플리케이션과 라이브러리 호출 경계를 더 잘 보여줍니다. 장애 분석에서는 둘이 같이 필요할 수 있습니다. 예를 들어 trace상 `net/http` client span이 길어졌고, 같은 시간대 eBPF에서 TCP retransmit이 평시의 2배라면 애플리케이션 코드보다 네트워크 경로를 먼저 봐야 합니다.

[eBPF 기반 프로덕션 디버깅](/learning/deep-dive/deep-dive-ebpf-production-debugging-playbook/)의 기준을 적용하면, compile-time span은 "어느 요청과 dependency가 느렸는가"를 보여주고, eBPF는 "왜 커널/네트워크 레벨에서 기다렸는가"를 좁혀 줍니다.

### 5) 관측성은 점점 설정과 빌드 계약으로 이동한다

같은 주 OpenTelemetry는 Spring Boot starter의 declarative configuration 지원도 소개했습니다. Spring Boot starter 2.26.0부터 OpenTelemetry SDK의 YAML schema를 `application.yaml` 안의 `otel:` 아래에 둘 수 있다는 흐름입니다. Java 쪽에서는 설정이 env var 목록이나 코드 Bean에서 선언적 설정으로 이동하고, Go 쪽에서는 계측이 소스 코드 변경에서 빌드 도구 단계로 이동합니다.

두 신호를 묶으면 방향이 보입니다. 관측성은 이제 "각 팀이 라이브러리 조금 붙이는 일"이 아니라 플랫폼 표준입니다. 어떤 SDK 설정을 허용할지, 어떤 sampler를 쓸지, 어떤 빌드 단계에서 자동 계측을 넣을지, 어떤 attribute를 금지할지, 어떤 Collector pipeline으로 보낼지가 함께 관리됩니다.

## 실무 적용

### 1) Go 서비스 inventory부터 만든다

도입 전에는 Go 서비스 목록을 먼저 나눕니다.

```yaml
go_observability_inventory:
  service: payment-api
  build_control: internal_dockerfile
  current_instrumentation: manual_partial
  critical_paths: ["approve-payment", "refund", "settlement-callback"]
  dependencies: ["net/http", "database/sql", "grpc", "redis"]
  trace_coverage: "55%"
  p95_latency_budget_ms: 300
  candidate: compile_time_instrumentation_pilot
```

핵심 기준은 재빌드 가능성입니다. 소스와 Dockerfile, CI workflow를 통제할 수 있는 서비스부터 시작합니다. vendor binary나 appliance 형태는 다른 접근이 맞습니다.

### 2) staging 비교는 span diff로 닫는다

단순히 "trace가 더 많이 나온다"는 성공이 아닙니다. 기존 빌드와 `otelc` 빌드를 나란히 돌리고 대표 요청을 replay합니다.

비교표는 아래처럼 둡니다.

| 항목 | 통과 기준 |
| --- | --- |
| build time 증가 | 20% 이하에서 시작 |
| binary size 증가 | 10% 이하 또는 명시 승인 |
| p95 latency 증가 | 3~5% 이하 |
| trace coverage | 핵심 경로 80% 이상 |
| duplicate span rate | 5% 이하 |
| forbidden attribute | 0건 |
| Collector ingest 증가 | 30% 이하 또는 샘플링 조정 |

span diff를 사람이 봐야 합니다. 자동 계측이 만든 span 이름이 너무 세밀하거나, URL path에 고카디널리티 값이 들어가거나, DB statement가 과하게 노출되면 운영 품질이 떨어집니다. 이 부분은 [OpenTelemetry 네이티브 데이터 플레인](/posts/2026-07-01-opentelemetry-native-data-plane-trend/)의 cardinality와 wrapper audit 관점과 이어집니다.

### 3) CI/CD에는 버전 고정과 fallback을 넣는다

빌드 파이프라인에 들어간 도구는 운영 의존성입니다. `otelc@latest`를 매번 받는 구조는 피하는 편이 좋습니다. 최소한 버전 고정, checksum, 캐시, 실패 시 fallback 기준을 둡니다.

```dockerfile
RUN go install go.opentelemetry.io/otelc/tool/cmd/otelc@v1.0.0
RUN otelc go build -trimpath -o /out/app ./cmd/server
```

fallback 기준도 명시합니다.

- 보안 패치 긴급 배포에서 `otelc` 자체가 실패하면 일반 `go build`로 우회 가능
- 우회 배포는 관측성 coverage 하락으로 기록하고 24시간 안에 복구 티켓 생성
- `otelc` 버전 업그레이드는 서비스 코드 변경처럼 staging diff와 canary 필요
- 계측 rule 변경은 빌드 산출물 차이와 trace schema 변경으로 취급

관측성 도구가 빌드를 막는 순간 팀은 우회하고 싶어집니다. 우회를 금지하기보다, 우회 조건과 복구 시간을 정해 두는 편이 현실적입니다.

### 4) canary는 비용과 품질을 같이 본다

운영 canary는 5~10% 트래픽 또는 내부 tenant부터 시작합니다. 단순히 서비스 에러가 없는지만 보면 부족합니다.

확인 지표:

- canary와 control의 p95/p99 latency 차이
- span 수/request, attribute cardinality/request
- trace missing rate와 root span 누락률
- Collector CPU/memory, queue latency, drop rate
- alert rule이 중복 또는 과민하게 울리는지
- 장애 회고에서 느린 경로 설명 시간이 줄었는지

저는 성공 기준을 "span이 늘었다"가 아니라 "상위 3개 장애 질문에 답하는 시간이 줄었다"로 잡는 편이 맞다고 봅니다. 예를 들어 결제 API p95 회귀 원인을 15분 걸려 찾던 팀이 5분 안에 downstream HTTP와 DB 중 어느 쪽인지 말할 수 있어야 합니다.

## 트레이드오프/주의점

첫째, 컴파일타임 계측은 재빌드 가능한 서비스에 강합니다. 소스와 빌드 파이프라인을 통제하지 못하면 맞지 않습니다. 이 경우 eBPF/OBI, proxy telemetry, sidecar 관측이 더 현실적입니다.

둘째, 자동 계측은 span 품질을 보장하지 않습니다. coverage가 늘어도 span 이름, attribute, sampling, 중복 span이 정리되지 않으면 화면은 더 복잡해집니다. 도입 초기에 trace schema와 금지 attribute 목록을 같이 고정해야 합니다.

셋째, 빌드 도구가 늘면 supply chain과 재현성 관리가 필요합니다. `otelc` 버전, Go 버전, Docker build cache, CI runner 환경이 모두 산출물에 영향을 줄 수 있습니다. 운영 서비스에서는 "빌드 한 줄"도 변경 관리 대상입니다.

넷째, 수동 계측을 모두 없애면 도메인 맥락이 사라집니다. 자동 계측은 HTTP, DB, Redis, gRPC 같은 기술 경계를 채우고, 수동 span은 주문, 정산, 권한, 재시도 정책 같은 업무 의미를 남기는 역할로 나눠야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] Go 서비스별 재빌드 가능성, 현재 trace coverage, 수동 계측 상태를 inventory했다.
- [ ] `otelc` 적용 전후 build time, binary size, p95 latency, span 수를 비교했다.
- [ ] 중복 span, 고카디널리티 attribute, 민감 attribute가 없는지 확인했다.
- [ ] CI/CD에서 `otelc` 버전을 고정하고 일반 `go build` fallback 조건을 문서화했다.
- [ ] canary에서 Collector 비용과 trace 품질을 함께 봤다.
- [ ] 자동 계측으로 채워지지 않는 도메인 span 목록을 따로 정했다.

### 연습

1. Go 서비스 하나를 골라 HTTP, DB, Redis, gRPC 중 현재 trace가 빠진 경계를 표시해 보세요. 컴파일타임 계측이 채울 수 있는 부분과 수동 span이 필요한 부분을 나눕니다.
2. 기존 `go build`와 `otelc go build`를 staging에서 비교한다고 가정하고, p95 latency, build time, span count 통과 기준을 숫자로 작성해 보세요.
3. 장애 회고 질문 3개를 적고, 자동 계측 span만으로 답할 수 있는 질문과 도메인 span이 필요한 질문을 구분해 보세요.
