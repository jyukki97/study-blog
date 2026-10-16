---
title: "2026 개발 트렌드: Confidential AI, 민감한 추론을 ‘격리됐다’가 아니라 검증 가능한 데이터 경계로 운영하는 법"
date: 2026-10-14T10:06:00+09:00
lastmod: 2026-10-14T10:06:00+09:00
draft: false
tags: ["Confidential Computing", "Confidential AI", "AI Security", "Attestation", "Privacy Engineering", "Platform Engineering"]
categories: ["Development", "AI", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["confidential AI", "confidential computing inference", "TEE attestation", "AI data boundary", "hardware attestation"]
description: "민감한 AI 추론에서 confidential computing을 도입할 때 하드웨어 격리 주장과 실제 데이터 경계, attestation, key release, 관측성, rollback을 분리해 검증하는 기준을 정리합니다."
summary: "Confidential AI는 GPU나 VM의 메모리를 암호화했다는 제품 기능으로 끝나지 않는다. 어떤 이미지·정책·측정값에서만 key를 풀지, 입력과 출력이 어디에 남는지, 운영자가 무엇을 볼 수 있는지, 성능 저하와 장애 시 어떤 경로로 돌아갈지를 증거로 연결해야 비로소 신뢰 경계가 된다."
key_takeaways:
  - "TEE와 메모리 암호화는 privileged operator가 평문을 쉽게 읽는 위험을 줄일 수 있지만, application log·prompt store·network endpoint·tool call의 데이터 경계를 자동으로 좁히지는 않는다."
  - "remote attestation은 '격리 기능이 켜졌다'는 표식보다 workload measurement, signed image, policy version, key-release decision을 묶어 검증할 때 가치가 있다."
  - "민감 추론 pilot은 데이터 등급이 높은 좁은 read-only 경로부터 시작하고, latency·비용·attestation failure·fallback의 stop condition을 일반 AI SLO와 함께 둬야 한다."
operator_checklist:
  - "프롬프트·응답·file/vector state·tool result·telemetry를 각각 어느 trust boundary와 보존 경로에 두는지 inventory한다."
  - "KMS key release를 attestation measurement, image provenance, environment, policy version과 결합하고 break-glass 사용을 별도 감사한다."
  - "confidential path와 일반 path를 같은 평가 세트로 비교하고, 품질·p95·비용·failed attestation·fallback을 canary dashboard에 분리한다."
  - "고위험 write action은 격리 여부와 무관하게 최소 권한 tool token, 승인, idempotency, audit receipt를 유지한다."
---

AI 기능이 고객 문서, 소스 코드, 금융 정보, 건강 정보처럼 민감한 입력을 다루기 시작하면서 “모델 제공자가 데이터를 저장하지 않는다”는 약속만으로는 부족한 경우가 늘고 있습니다. 이 흐름에서 Confidential AI는 신뢰 실행 환경(TEE)과 하드웨어 기반 attestation을 이용해, 특정 workload가 승인된 격리 상태에서 실행된다는 증거를 만들려는 접근입니다. VM·CPU·가속기 메모리 보호, 부팅 체인 측정, key release 정책이 함께 이야기되는 이유도 여기에 있습니다.

다만 confidential computing은 만능 privacy 스위치가 아닙니다. 격리된 메모리 안에서 추론하더라도 request log에 프롬프트 원문을 남기거나, tool이 광범위한 고객 DB를 읽거나, 응답이 일반 analytics pipeline으로 복제되면 데이터 경계는 넓습니다. 반대로 하드웨어 격리만 보고 운영자가 아무것도 조사할 수 없게 만들면 장애 대응과 감사가 불가능해집니다. 최근의 핵심 질문은 “TEE를 쓸 수 있는가”보다 **어떤 증거가 있어야 어떤 데이터와 key를 어느 실행 경로에만 허용할 것인가**로 이동하고 있습니다.

이 글은 [Zero Data Retention과 처리 계약](/posts/2026-08-24-zero-data-retention-private-safety-processing-contract-trend/), [AI inference portability와 exit plan](/posts/2026-07-16-ai-inference-portability-exit-plan-trend/), [AI workload security blueprint](/posts/2026-07-19-ai-workload-security-blueprint-gke-kubernetes-trend/), [artifact attestation 기반 배포 gate](/posts/2026-08-31-artifact-attestation-deployment-admission-gate-trend/)를 연결합니다. 목표는 격리 기술을 과장하는 것이 아니라, 민감한 추론 경로의 trust boundary를 **검증·감사·되돌림 가능한 운영 계약**으로 바꾸는 것입니다.

## 이 글에서 얻는 것

- TEE, memory encryption, remote attestation, key release가 각각 증명하는 범위를 구분합니다.
- AI 요청의 원문·상태·telemetry·tool 결과가 남는 경로를 분리해 inventory하는 방법을 배웁니다.
- attestation을 image provenance와 KMS 정책에 연결하고, 실패 시 fail-closed 또는 대체 경로를 고르는 기준을 세웁니다.
- latency·비용·관측성·vendor portability를 고려한 좁은 pilot과 rollout 조건을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) ‘암호화된 메모리’와 ‘안전한 데이터 처리’는 같은 주장이 아니다

Confidential computing은 일반적으로 host 운영체제나 hypervisor처럼 높은 권한을 가진 계층이 workload의 사용 중 메모리를 직접 읽거나 바꾸는 위험을 낮추려 합니다. TEE는 code와 data가 실행되는 격리 영역을 만들고, remote attestation은 외부 검증자가 그 영역의 측정값(measurement)과 보안 상태를 확인할 수 있게 합니다. 모델 가중치, 고객 입력, 중간 activation, API key를 같은 보호 경계 안에 둘 수 있다는 점은 민감 추론에 의미가 있습니다.

그러나 다음 경로는 별도로 설계해야 합니다.

| 경로 | TEE가 줄일 수 있는 위험 | 여전히 팀이 결정할 것 |
| --- | --- | --- |
| prompt·response 메모리 | host의 직접 메모리 열람 위험 | application log, trace, error report의 마스킹·TTL |
| model weight·secret | 승인되지 않은 workload의 key 접근 | KMS key release policy, secret rotation, owner |
| file·vector retrieval | runtime 내부 처리 노출 일부 | 검색 권한, tenant filter, source 보존·삭제 |
| network·tool call | 일부 runtime 경계 보호 | egress allowlist, tool scope, request signing, audit |
| 운영 조사 | attestation 기반 상태 증거 | 누가 어떤 metadata를 보고 incident를 조사하는가 |

따라서 “데이터가 암호화된다”, “벤더가 학습에 쓰지 않는다”, “운영자가 평문을 못 본다”, “우리 서비스가 보존하지 않는다”는 문장을 하나로 합치면 안 됩니다. 데이터 분류가 높을수록 각 주장을 request lifecycle에 대응시켜야 합니다. 예를 들어 `restricted` 등급의 원문은 confidential path에서만 처리하고, 일반 observability에는 request ID·정책 결과·길이·hash·지연시간만 남기며 원문 확인은 고객 소유 시스템의 승인된 조사 절차로 제한할 수 있습니다.

### 2) attestation은 확인 화면이 아니라 key-release gate다

attestation report에는 platform, firmware, TEE mode, workload measurement, nonce 같은 정보가 들어갈 수 있습니다. 이를 단지 deploy 로그에 붙이면 나중에 “그때 격리였던 것 같다”는 사후 메모에 그칩니다. 더 강한 설계는 KMS 또는 secret broker가 **승인된 policy와 일치하는 report를 확인한 경우에만** 추론용 key·model decrypt key·짧은 수명의 tool credential을 release하게 하는 것입니다.

```text
signed image + deployment policy
          ↓
workload measurement → attestation verifier → KMS key-release decision
          ↓                         ↓                 ↓
  confidential inference      audit metadata      short-lived credential
```

이 흐름에서 중요한 것은 measurement 하나가 아닙니다. 이미지 digest, SBOM 또는 provenance, 허용된 runtime·region, policy version, certificate chain, report freshness를 함께 연결해야 합니다. 예를 들어 이미지는 서명됐지만 허용되지 않은 debug build이거나, report nonce가 재사용됐거나, 정책이 rollback된 버전이면 key를 주지 않아야 합니다. credential은 긴 static key보다 **5~15분** 수명의 session token으로 시작하고, attestation 실패 시 자동으로 일반 환경에 같은 key를 넘겨주는 fallback은 금지하는 편이 안전합니다.

물론 fail-closed가 항상 정답은 아닙니다. 고객 상담 초안처럼 지연 가능한 기능은 `attestation unavailable`일 때 job을 보류하고 재시도할 수 있습니다. 생명·안전과 직접 관계된 실시간 기능은 별도 승인된 대체 경로가 필요할 수 있습니다. 다만 fallback이 confidential guarantee를 포기한다면 사용자·제품·감사 정책이 그것을 명시적으로 알고 있어야 합니다. 내부적으로 조용히 일반 runtime으로 우회하면 도입 이유가 사라집니다.

### 3) 격리 경계도 공급망과 실행 권한을 통과해야 한다

TEE가 깨끗한 application image를 자동으로 보장하지는 않습니다. 취약한 의존성, prompt injection으로 열린 tool, 과도한 database token, 잘못된 egress policy는 격리된 runtime 안에서도 위험합니다. Confidential AI의 security review는 image signing과 hardware capability에서 멈추지 않고, 모델·retrieval corpus·tool adapter·policy bundle·sidecar가 어떤 digest와 권한으로 실행되는지 봐야 합니다.

특히 agent 또는 RAG workload는 “원문이 보호된다”는 이유로 tool 권한을 넓히기 쉽습니다. 그러나 민감 정보를 안전하게 읽는 것과 임의의 외부 API에 쓰는 것은 별개의 위험입니다. tool token은 tenant·action·시간으로 scope를 좁히고, 결제·계정 변경·배포 같은 write action에는 격리 여부와 무관하게 사람 승인, idempotency key, 실행 receipt를 유지하세요. 이 원칙은 [MCP OAuth의 resource-bound authorization](/posts/2026-10-05-mcp-oauth-resource-bound-tool-authorization-trend/)처럼 권한을 호출 대상과 묶는 설계와도 맞닿습니다.

## 실무 적용

### 1) 데이터 등급과 workload를 함께 분류한다

도입 전에 “모든 AI 요청을 confidential runtime으로” 보내는 대신, workload별 질문을 표로 만드세요. 데이터 민감도만으로 정하면 비용과 latency를 과도하게 쓰고, 모델 이름만으로 정하면 실제 egress와 state를 놓칩니다.

| workload | 데이터·행동 위험 | 권장 시작 경로 | 일반 경로 허용 조건 |
| --- | --- | --- | --- |
| 사내 코드 요약 | source·secret 포함 가능, read-only | confidential read pilot | secret scan·redaction 후 낮은 등급 샘플만 |
| 고객 문서 질의 | PII·계약 정보, retrieval 포함 | confidential + tenant-scoped retrieval | 고객 계약과 data control이 명시된 경우 |
| 상담 초안 | 민감 원문, 사람이 최종 발송 | confidential async job | 결과가 redacted되고 보존 정책이 충족될 때 |
| 결제·계정 조치 agent | 민감 원문 + write side effect | confidential inference만으로 불충분 | 별도 policy·approval·execution receipt 필수 |

각 workload에 input, model context, file/vector state, output, safety signal, tool request, log를 한 줄씩 쓰고 owner·retention·egress·deletion 경로를 붙입니다. 이 inventory 없이 TEE cluster를 먼저 만들면 실제 민감 경로가 일반 cache나 debug log로 새는 사실을 늦게 발견하기 쉽습니다.

### 2) 작은 pilot은 attestation 실패까지 측정한다

처음에는 write side effect가 없는 read-only workflow 한 개를 골라, 내부 또는 opt-in tenant의 **5% 이하**에서 시작하세요. 적어도 **7일** 동안 정상 피크와 key rotation, node replacement, image update를 포함해 봐야 합니다. confidential path와 control path에는 같은 replay evaluation set을 사용하되, 원문은 최소화·마스킹하고 결과 품질은 schema-valid rate, task success, human correction rate로 비교합니다.

운영 dashboard에는 일반 inference 지표와 trust 지표를 분리해 올립니다.

- quality: 기준 모델 대비 task success의 절대 하락이 **1%p**를 넘으면 확대 중지
- latency: p95가 control보다 **20% 또는 500ms** 중 더 작은 예산을 넘으면 batch·cache·모델 배치를 재검토
- availability: successful attestation이 **99.9%** 아래로 내려가거나 failed/expired report가 증가하면 key-release chain을 조사
- cost: 요청당 비용이 control의 **1.5배**를 3일 연속 넘으면 data class와 대상 범위를 재평가
- security: 승인되지 않은 measurement, policy mismatch, confidential→general silent fallback은 **1건**이라도 incident로 분류

숫자는 제품 성격에 맞게 바꾸되, “격리가 됐는가”와 “서비스로서 쓸 수 있는가”를 한 gate에서 보아야 합니다. attestation success만 100%여도 latency가 고객 SLA를 깨면 운영 가능한 도입이 아닙니다.

### 3) portability와 incident 대응을 처음부터 남긴다

confidential runtime은 hardware vendor, cloud region, driver, verifier, KMS integration의 조합에 의존할 수 있습니다. 따라서 model API를 abstraction 뒤에 둔다고 끝나지 않습니다. approved measurement를 어떻게 재생성하는지, image signing key가 유출됐을 때 어떤 policy version을 revoke하는지, 특정 region의 TEE capability가 사라졌을 때 어떤 workload를 보류하는지까지 runbook에 적어야 합니다.

break-glass도 필요하지만, “운영 편의상 일반 node에서 실행” 버튼이어서는 안 됩니다. 기간 제한된 승인, case ID, 최소 scope, 사후 review, 고객 영향 표시를 포함하고, break-glass 실행 자체가 confidential guarantee의 예외로 audit ledger에 남아야 합니다. 월 1회 정도의 tabletop 또는 제한된 drill로 verifier 장애·KMS deny·attestation expiry·policy rollback을 시험하면, 실제 사고에서 secret을 무분별하게 넓히는 대응을 줄일 수 있습니다.

## 트레이드오프/주의점

첫째, TEE의 보호 범위와 side-channel·firmware·driver·host configuration 위험은 다릅니다. vendor 문서의 “confidential”이라는 단어만으로 threat model을 확정하지 말고, 어떤 공격자와 어느 계층을 포함·제외하는지 확인해야 합니다. 특히 GPU acceleration이 들어가면 CPU TEE와 같은 보장을 당연하게 가정하면 안 됩니다.

둘째, attestation log에도 민감한 정보가 들어갈 수 있습니다. raw report, device serial, workload argument, full measurement를 모두 analytics에 보내면 새로운 fingerprinting·운영 노출 경로가 됩니다. verification outcome, policy version, image digest prefix처럼 조사에 필요한 최소 metadata와 접근 통제를 우선 설계하세요.

셋째, confidential path의 성능 비용을 사용자에게 숨기면 기능 채택이 실패합니다. 작은 민감 요청에는 strong isolation을, 낮은 등급의 batch summary에는 일반 path를 선택하는 등 데이터 등급과 latency 목표에 맞는 tier가 현실적입니다. 다만 tier 선택은 client가 임의로 선언하게 하지 말고 서버 측 data classification과 policy로 결정해야 합니다.

마지막으로 confidentiality는 integrity와 availability를 대신하지 않습니다. 잘못된 retrieval, 취약한 prompt policy, hallucinated output, model outage, 과도한 tool 권한은 여전히 별도 control이 필요합니다. 격리된 실행은 신뢰 모델의 한 층일 뿐, 검증·권한·관측성·복구의 나머지 층을 없애지 않습니다.

## 체크리스트 또는 연습

### Confidential AI 도입 체크리스트

- [ ] workload별 prompt, response, file/vector state, tool result, telemetry의 data class·owner·retention·egress를 inventory했다.
- [ ] attestation verifier가 image digest, policy version, report freshness, 허용 runtime을 검증하고 KMS key release와 연결된다.
- [ ] confidential path에서 일반 path로 key나 원문이 조용히 fallback하지 않으며, 예외는 승인·감사·고객 영향 표시를 거친다.
- [ ] tool credential은 짧은 수명·최소 scope이고, write action에는 별도 approval·idempotency·receipt가 있다.
- [ ] 5% 이하·7일 pilot에서 quality, p95, cost, attestation, policy mismatch, fallback의 중단 기준을 운영한다.
- [ ] raw attestation·debug log의 보존 기간과 접근 권한이 원문 데이터 정책과 충돌하지 않는다.
- [ ] verifier·KMS·driver·region 장애와 policy revoke를 포함한 break-glass·rollback runbook을 drill했다.

### 연습: 고객 문서 요약 경로를 그려 보기

고객이 계약서 PDF를 올리고 요약을 요청하는 흐름을 생각해 보세요. 업로드 파일, OCR 결과, retrieval chunk, prompt, model output, 감사 log가 어느 저장소와 runtime을 지나가는지 그립니다. 그다음 “attestation이 통과한 image에서만 decrypt key를 준다”는 규칙을 어디에서 시행할지, verifier가 장애면 요청을 보류할지 일반 path로 보낼지 결정합니다. 마지막으로 고객 지원이 결과 오류를 조사할 때 원문 없이도 볼 수 있는 metadata와, 별도 승인 후에만 볼 수 있는 데이터를 나누어 보세요. 이 네 가지가 연결돼야 confidential computing은 배지나 옵션이 아니라 실제 데이터 경계가 됩니다.
