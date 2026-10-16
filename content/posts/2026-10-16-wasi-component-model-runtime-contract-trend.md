---
title: "2026 개발 트렌드: WASI Component Model, WebAssembly를 조합 가능한 런타임 계약으로 운영하는 법"
date: 2026-10-16T10:06:00+09:00
lastmod: 2026-10-16T10:06:00+09:00
draft: false
tags: ["WebAssembly", "WASI", "Component Model", "Platform Engineering", "Runtime Security", "Developer Platform"]
categories: ["Development", "Platform Engineering", "Architecture"]
series: "2026 개발 운영 트렌드"
keywords: ["WASI Component Model", "WIT interface contract", "WebAssembly runtime", "capability security", "component deployment"]
description: "WASI Component Model을 단순한 경량 배포 기술이 아니라 인터페이스·권한·관측·호환성을 묶는 런타임 계약으로 운영하는 기준을 정리합니다."
summary: "Wasm component는 작은 바이너리를 어디서나 실행한다는 약속만으로 운영되지 않는다. WIT 인터페이스, host capability, adapter 버전, artifact provenance, 장애 관측을 함께 관리해야 여러 언어의 확장 기능을 안전하게 조합할 수 있다."
key_takeaways:
  - "WASI Component Model의 가치는 단일 Wasm module 실행보다, 언어 경계를 넘는 WIT 계약과 component 조합을 명시적으로 검증할 수 있다는 데 있다."
  - "sandbox는 권한 정책을 대신하지 않는다. filesystem, network, clock, random, secret, host function을 component별 capability로 좁혀야 한다."
  - "도입 판단은 바이너리 크기만이 아니라 cold start, host-call 비용, 디버깅 가능성, 배포 provenance, 장기 상태 처리 요구를 함께 비교해야 한다."
  - "호환성은 component가 로드되는가가 아니라 WIT 버전, optional field, error 의미, resource lifecycle이 실제 호출 흐름에서 유지되는가로 검증한다."
operator_checklist:
  - "component마다 제공·소비 WIT interface, 허용 capability, owner, artifact digest, runtime version을 inventory에 연결한다."
  - "새 host capability는 기본 거부로 두고, network destination·filesystem 경로·secret reference를 component identity별 allowlist로 승인한다."
  - "배포 전 contract fixture와 policy-denied fixture를 모두 실행하고, canary에서 error rate·p95·trap·capability denial을 기존 구현과 비교한다."
  - "adapter·runtime·WIT 변경은 하나의 compatibility change로 취급하고 rollback할 artifact digest와 이전 interface를 보존한다."
---

WebAssembly는 오랫동안 브라우저의 빠른 실행 포맷으로 소개됐지만, 최근 플랫폼 팀의 관심은 단일 `.wasm` 파일을 실행하는 데서 더 멀리 가고 있습니다. 플러그인, edge handler, 정책 엔진, 데이터 변환기처럼 서로 다른 언어로 만든 작은 기능을 한 프로세스 안에서 조합하려면, 단순 바이너리 호환성보다 **함수 인터페이스·권한·resource 수명·배포 증거**가 맞아야 하기 때문입니다. 그 맥락에서 WASI와 Component Model은 “컨테이너보다 작다”는 홍보 문구가 아니라 런타임 경계를 더 명시적으로 만드는 흐름으로 볼 만합니다.

핵심은 Wasm을 기존 서비스의 만능 대체재로 보는 것이 아닙니다. component는 host가 제공한 capability 안에서 실행되고, WIT(WebAssembly Interface Types)가 component 간 계약을 기술합니다. 이 계약과 운영 정책을 분리하면 팀은 언어 선택권을 주면서도 filesystem·network·secret 접근을 좁힐 수 있습니다. 이 글은 [OCI Referrers와 artifact lifecycle](/posts/2026-10-03-oci-referrers-artifact-lifecycle-trend/), [artifact attestation 기반 deployment admission](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/), [Rust MSRV 소비자 호환성 계약](/posts/2026-10-04-rust-msrv-consumer-compatibility-contract-trend/), [MCP OAuth의 resource-bound 권한 위임](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)을 component runtime의 관점으로 연결합니다.

## 이 글에서 얻는 것

- core Wasm module, WASI capability, component, WIT interface가 서로 다른 책임임을 구분할 수 있습니다.
- 다언어 플러그인 또는 edge extension에 component model이 맞는 조건과 맞지 않는 조건을 판단할 수 있습니다.
- component별 권한을 filesystem sandbox 하나가 아니라 network·secret·host function까지 포함한 정책으로 설계할 수 있습니다.
- canary에 넣을 호환성·성능·보안 지표와 rollback 기준을 수치로 만들 수 있습니다.

## 핵심 개념/이슈

### 1) module을 실행하는 일과 component를 조합하는 일은 다르다

기본 Wasm module은 메모리, 함수 export/import 같은 낮은 수준의 실행 단위를 제공합니다. 이것만으로도 sandboxed 계산이나 브라우저 코드 실행에는 유용하지만, 문자열·리스트·오류·파일 handle·HTTP request 같은 애플리케이션 수준의 자료형과 resource 수명은 host와 각 언어 binding이 제각각 처리하기 쉽습니다. 그 결과 Rust에서 만든 plugin을 Go host가 부를 때 값 복사, ABI, error 전달이 보이지 않는 관습에 기대게 됩니다.

Component Model은 이 경계를 WIT로 드러냅니다. WIT는 `validate(input) -> result<output, validation-error>`처럼 제공·소비하는 interface와 타입을 표현하고, component는 필요한 interface를 import하며 제공하는 interface를 export합니다. adapter는 서로 다른 module이나 interface revision을 연결할 수 있습니다. 즉 배포 단위가 “실행 가능한 바이너리”에서 **명시된 계약을 소비하고 제공하는 구성요소**로 넓어집니다.

| 층 | 주된 질문 | 운영에서 확인할 증거 |
| --- | --- | --- |
| core Wasm module | 이 코드가 주어진 메모리 안에서 실행되는가 | runtime·compiler 버전, trap, CPU·memory 제한 |
| WASI | 어떤 시스템 기능을 host에서 요청하는가 | filesystem·network·clock·random capability 정책 |
| WIT interface | caller와 callee가 어떤 값·오류·resource를 교환하는가 | interface version, fixture, breaking-change 판정 |
| component 조합 | 여러 module·adapter가 실제로 맞물리는가 | resolved dependency graph, component digest, integration test |
| platform 운영 | 누가 어떤 component를 어느 환경에서 승인했는가 | owner, provenance, policy decision, rollback artifact |

이 구분은 특히 사내 plugin 플랫폼에서 중요합니다. “Wasm이라 안전하다”는 말은 memory isolation 일부만 설명할 뿐입니다. host가 넓은 filesystem preopen, unrestricted egress, 모든 secret을 읽는 API를 제공하면 component는 작은 바이너리일 뿐 권한은 넓습니다.

### 2) capability는 process 권한이 아니라 요청 단위의 계약으로 줄인다

component가 `fetch` 같은 host function을 import한다고 해도 인터넷 전체에 접근해야 하는 것은 아닙니다. platform은 component identity와 실행 환경별로 허용 DNS name·port·HTTP method·최대 요청 시간·최대 응답 크기를 정책에 둬야 합니다. filesystem도 `/tmp` 하나를 통째로 공유하는 대신 읽기 전용 template, component 전용 scratch directory, 명시된 output directory처럼 용도를 나눕니다.

secret은 더 좁게 봐야 합니다. 환경변수 전체를 전달하면 Wasm process를 격리해도 credential boundary는 없습니다. component가 특정 credential의 이름을 요청하고 host가 allowlist와 환경을 확인한 뒤 짧은 수명의 scoped token 또는 서명된 request만 주는 구조가 낫습니다. 이 방식은 [MCP OAuth의 resource·audience 검증](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)처럼 호출 대상과 권한을 연결하는 원칙과 같습니다.

```yaml
component_policy:
  component: invoice-normalizer
  digest: sha256:example
  filesystem:
    read_only: ["/templates/invoice-v3"]
    write_only: ["/scratch/invoice-normalizer"]
  network:
    allow: ["tax-api.internal:443"]
    connect_timeout_ms: 300
    response_limit_bytes: 1048576
  secrets:
    allow: ["tax-api-delegated-token"]
  limits:
    cpu_ms: 200
    memory_mib: 64
```

이 정책은 예시일 뿐이며, 숫자는 현재 workload의 정상 p95와 실패 비용에서 출발해야 합니다. 중요한 순서는 component가 먼저 “무엇이 필요한지” 선언하고, platform owner가 그 필요를 최소 권한으로 승인하며, runtime이 허용·거부 결정을 trace에 남기는 것입니다. import가 존재한다는 사실만으로 capability를 자동 승인하면 WIT가 오히려 넓은 권한의 카탈로그가 될 수 있습니다.

### 3) WIT의 호환성은 타입 검사보다 넓다

interface에 optional field 하나를 추가했다고 항상 안전한 것은 아닙니다. caller가 새 field를 보내지 않을 때 business default가 달라질 수 있고, error variant를 합쳐 버리면 caller의 재시도 정책이 바뀔 수 있습니다. resource handle을 반환하는 interface에서는 close 책임이 바뀌는 것만으로도 누수나 request 고갈이 생깁니다.

그래서 component release는 다음 네 층을 같이 검사해야 합니다.

1. **형식 호환성**: provider와 consumer가 같은 WIT revision 또는 검증된 adapter 조합을 쓰는가.
2. **행동 호환성**: 정상·빈 값·큰 입력·중복 호출·timeout에서 output과 error 의미가 기존 contract를 유지하는가.
3. **자원 호환성**: memory, CPU, open resource, host call 수가 정한 상한 안에 있는가.
4. **정책 호환성**: 새 interface import가 network, filesystem, secret 권한을 넓히지 않는가.

특히 “component가 load됐다”는 smoke test는 첫 단계일 뿐입니다. 정책 거부를 예상한 fixture가 실제로 deny되는지, timeout 뒤 resource가 해제되는지, adapter가 error를 바꾸지 않는지까지 검증해야 합니다. 이는 [tool contract test와 schema canary](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/)의 적용 범위를 LLM tool에서 runtime component로 옮긴 것과 비슷합니다.

## 실무 적용

### 1) 첫 도입은 stateless extension 하나로 제한한다

좋은 첫 후보는 요청별 입력과 출력이 명확하고, 긴 DB transaction이나 in-process shared mutable state를 요구하지 않는 기능입니다. 예를 들어 webhook payload 정규화, 이미지 metadata 검사, 세금 코드 검증, policy evaluation, format 변환은 component의 장점을 시험하기 좋습니다. 반면 connection pool을 오래 붙잡는 API 서버, 대용량 stream fan-out, JVM 전체 라이브러리 생태계에 깊이 의존한 업무, 복잡한 background workflow는 기존 runtime이 더 단순할 가능성이 큽니다.

후보를 고를 때는 다음 우선순위를 둡니다.

| 우선순위 | 조건 | 첫 도입 판단 |
| --- | --- | --- |
| 1 | 입력·출력 schema와 실패 결과가 명확함 | 적합 |
| 2 | filesystem·network·secret이 없거나 한두 개로 좁음 | 적합 |
| 3 | p95 실행 시간이 100ms 안팎, memory 상한을 예측 가능 | 적합 |
| 4 | 지속 연결·대규모 shared state·장시간 transaction 필요 | 보류 또는 기존 runtime 유지 |
| 5 | 권한이 넓거나 사용자 데이터의 외부 전송이 필요 | 별도 security review 후 판단 |

### 2) artifact, interface, 정책을 한 release record로 묶는다

container image만 digest로 고정하고 component의 WIT·adapter·runtime 버전을 따로 관리하면 문제를 재현하기 어렵습니다. 배포 record에는 component digest, source revision, 제공/소비 interface, adapter digest, runtime version, capability policy version, owner를 함께 넣으세요. OCI artifact lifecycle을 활용하든 내부 registry를 쓰든, **실행한 binary와 검증한 contract가 같은 release인지**가 추적돼야 합니다.

이 레코드는 취약점 대응에도 도움이 됩니다. runtime 업데이트가 필요할 때 어떤 component가 영향받는지, 특정 WIT revision을 소비하는 caller가 몇 개인지, network capability를 가진 plugin이 어느 환경에 있는지를 바로 좁힐 수 있습니다. [runtime reachability evidence](/posts/2026-10-15-runtime-reachability-evidence-vulnerability-prioritization-trend/)가 package 존재와 실제 위험을 구분하듯, component inventory도 registry 등록과 production 실행을 분리해 기록해야 합니다.

### 3) canary는 성능뿐 아니라 거부와 trap을 본다

처음에는 트래픽 1~5%만 새 component로 보내고 정상 피크를 포함해 24시간 이상 관찰합니다. 승격 기준은 서비스별로 다르지만, 출발점은 다음처럼 명시할 수 있습니다.

- business validation mismatch: 0건
- 처리 오류율: 기존 구현 대비 0.1%p 이상 증가하지 않음
- p95 latency: 기존 구현보다 10% 이상 악화하지 않음
- trap 또는 resource leak 의심: 0건
- 허용되지 않은 capability 요청: 0건, 예상된 deny fixture는 100% 차단
- CPU·memory: component별 설정 상한의 80%를 지속적으로 넘지 않음

오류율만 맞으면 승격하는 것은 위험합니다. 특정 input에서 retry가 늘거나 policy deny가 조용히 fallback될 수 있기 때문입니다. `component_digest`, `wit_revision`, `policy_decision`, `host_call`, `trap_reason`, `correlation_id`를 trace·metric에 연결하고, 원문 payload나 secret은 기록하지 않는 기준이 필요합니다.

## 트레이드오프/주의점

첫째, portability는 자동이 아닙니다. runtime마다 지원하는 WASI 기능, networking 구현, preview 기능, observability hook이 다를 수 있습니다. “로컬에서 실행됐다”만으로 edge·CI·production host에서 같은 정책과 시간 제한이 적용된다고 가정하지 말고, 지원하는 interface와 capability를 environment matrix로 관리하세요.

둘째, component 경계는 디버깅 비용을 높일 수 있습니다. 언어별 stack trace, adapter layer, host call을 하나의 trace로 연결하지 못하면 작은 plugin 오류가 opaque한 trap으로 보입니다. 성능도 함수 호출 하나의 비용보다 serialization, data copy, host transition, cold start를 포함해 측정해야 합니다. 작은 request를 매우 높은 QPS로 처리하는 길에서는 native in-process library가 더 쌀 수 있습니다.

셋째, sandbox가 tenant isolation·data residency·감사 요구를 모두 해결하지는 않습니다. component가 받은 입력을 허용된 외부 API로 보낼 수 있다면 그 데이터 흐름은 여전히 제품·보안 책임입니다. capability allowlist, request size, destination ownership, retention, audit receipt를 component 운영의 일부로 남겨야 합니다.

## 체크리스트 또는 연습

- [ ] 첫 후보가 명확한 입력·출력과 짧은 stateless 실행을 갖는지 확인했다.
- [ ] 제공·소비 WIT interface, adapter, runtime version을 digest와 함께 release record에 남긴다.
- [ ] filesystem, network destination, secret reference, host function을 component별 기본 거부 정책으로 정의했다.
- [ ] 정상·빈 값·대형 입력·timeout·중복 호출·policy deny fixture를 contract test에 포함했다.
- [ ] 1~5% canary에서 24시간 이상 error rate, p95, trap, capability denial, CPU·memory를 비교한 뒤 승격한다.

연습으로 현재 서비스의 작은 변환 기능 하나를 골라 WIT 초안을 작성해 보세요. 그다음 “이 기능이 정말 필요한 host capability는 무엇인가”, “새 error variant가 caller의 재시도를 바꾸는가”, “runtime을 교체하면 어느 artifact와 adapter를 되돌려야 하는가”를 답해 보세요. 이 세 질문에 구체적으로 답할 수 없다면 component를 먼저 빌드하기보다 계약과 운영 record를 먼저 설계하는 편이 낫습니다.

## 관련 글

- [OCI Referrers와 artifact lifecycle](/posts/2026-10-03-oci-referrers-artifact-lifecycle-trend/)
- [Artifact Attestation 기반 Deployment Admission Gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)
- [Rust MSRV와 소비자 호환성 계약](/posts/2026-10-04-rust-msrv-consumer-compatibility-contract-trend/)
- [MCP OAuth의 Resource-Bound Tool Authorization](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)
