---
title: "2026 개발 트렌드: AI Workload Security Blueprint, Kubernetes 보안 기준이 모델 실행 경로로 확장된다"
date: 2026-07-19T10:06:00+09:00
draft: false
tags: ["Kubernetes", "AI Security", "GKE", "Platform Engineering", "Inference", "GPU", "Cloud Native"]
categories: ["Development", "Platform Engineering", "Security"]
series: "2026 개발 운영 트렌드"
keywords: ["AI workload security", "GKE AI security blueprint", "Kubernetes inference security", "Model Armor", "HAMi GPU virtualization", "vLLM Kubernetes"]
description: "Google Cloud의 GKE AI workload security blueprint와 CNCF의 vLLM, HAMi 신호를 바탕으로, Kubernetes 보안이 컨테이너 보안을 넘어 모델 가중치, 프롬프트, GPU, 추론 비용까지 다루는 흐름을 정리합니다."
lastmod: 2026-07-19
summary: "AI 워크로드가 실험실에서 운영 클러스터로 이동하면서 Kubernetes 보안의 범위가 이미지 스캔과 네트워크 정책을 넘어 모델 가중치, 데이터 반출, 프롬프트 방어, GPU 분할, 추론 세션 관측까지 확장되고 있다."
key_takeaways:
  - "Google Cloud는 2026년 7월 17일 GKE AI workload security blueprint를 공개하며 AI 보안을 infrastructure, model, application layer로 나눠 제시했다."
  - "CNCF에서는 vLLM 기반 self-hosted inference, HAMi의 CNCF incubation, agent network boundary 글이 이어지며 Kubernetes가 AI 실행 경로의 공통 제어면으로 자리 잡는 흐름을 보여준다."
  - "실무 도입은 GPU를 붙이는 일이 아니라 모델 provenance, secretless identity, prompt/response inspection, quota, audit, sandbox를 한 런타임 계약으로 묶는 작업이다."
operator_checklist:
  - "AI inference path를 app, gateway, model server, model artifact storage, GPU node, outbound network로 나눠 threat model을 작성한다."
  - "민감 모델과 고객 데이터가 들어가는 워크로드는 Workload Identity, signed image, model artifact inventory, egress boundary, prompt/response inspection을 최소 기준으로 둔다."
  - "GPU sharing 또는 self-hosted inference를 도입할 때 utilization만 보지 말고 tenant isolation, quota, abuse detection, cost budget, rollback 기준을 같이 둔다."
learning_refs:
  - title: "Kubernetes AI/ML 워크로드 UI"
    href: "/posts/2026-07-17-kubernetes-aiml-workload-ui-headlamp-trend/"
    description: "AI/ML 워크로드 운영 화면과 플랫폼 UX가 왜 중요해지는지 정리한 최근 흐름입니다."
  - title: "AI 보안 리뷰 컨트롤 루프"
    href: "/posts/2026-07-15-ai-security-review-control-loop-trend/"
    description: "AI가 만든 변경과 보안 검토 결과를 반복 가능한 운영 루프로 묶는 관점입니다."
  - title: "Agent Native Temporary Trust Boundary"
    href: "/posts/2026-06-26-agent-native-temporary-trust-boundary-trend/"
    description: "에이전트 실행 경계를 임시 권한과 격리 기준으로 제한하는 흐름입니다."
  - title: "Kubernetes 기본기"
    href: "/learning/deep-dive/deep-dive-kubernetes-basics/"
    description: "Pod, Service, Secret, 네트워크 정책 같은 기본 요소를 먼저 정리할 수 있습니다."
decision_guide:
  title: "AI workload security blueprint를 언제 우선 적용할까"
  intro: "모든 실험용 챗봇에 enterprise blueprint를 통째로 얹을 필요는 없습니다. 다만 민감 데이터, 자체 모델 가중치, GPU 공유, 외부 도구 호출, 규제 요구가 들어오면 일반 웹서비스 보안 기준만으로는 부족합니다."
  cases:
    - badge: "우선 적용"
      title: "고객 데이터 또는 내부 지식이 추론 경로에 들어간다"
      fit: "RAG, 문서 요약, 고객 지원, 코드 분석처럼 입력과 출력 모두 민감할 수 있는 서비스"
      watchouts: "프롬프트 로그, 벡터 DB, 모델 응답에 PII와 영업비밀이 남을 수 있다."
      next_step: "prompt/response inspection, data retention, access log, egress boundary를 먼저 고정한다."
    - badge: "단계 적용"
      title: "self-hosted vLLM 또는 GPU pool을 운영한다"
      fit: "비용 예측, 지연시간, 데이터 주권 때문에 자체 inference stack을 쓰는 팀"
      watchouts: "모델 artifact, Hugging Face token, GPU sharing, cache volume이 새 공격면이 된다."
      next_step: "model artifact inventory와 secretless identity, quota, node isolation을 묶어 본다."
    - badge: "경량 기준"
      title: "내부 PoC 또는 비민감 demo"
      fit: "운영 고객 데이터 없이 기능 검증만 하는 단기 환경"
      watchouts: "PoC가 장기 운영으로 굳어지면 보안 기준이 빠진 채 확산된다."
      next_step: "30일 TTL, 외부 공개 금지, secret 회수, 로그 삭제 기준을 둔다."
faqs:
  - question: "AI workload security는 기존 Kubernetes 보안과 무엇이 다른가요?"
    answer: "기존 기준 위에 모델 가중치, 프롬프트/응답, inference quota, GPU isolation, artifact provenance가 추가됩니다. 컨테이너가 안전해도 모델 파일과 추론 경로가 열려 있으면 충분하지 않습니다."
  - question: "self-hosted LLM이면 managed API보다 항상 안전한가요?"
    answer: "아닙니다. 데이터가 외부 API로 나가지 않는 장점은 있지만, 모델 저장소, GPU 노드, 토큰, 네트워크 egress, 패치 책임을 직접 운영해야 합니다."
---

2026년 7월 중순의 클라우드 네이티브 신호를 보면 Kubernetes가 AI 워크로드의 "실행 장소"를 넘어 보안 제어면으로 확장되고 있습니다. Google Cloud는 2026년 7월 17일 GKE AI workload security blueprint를 공개하며 AI 보안을 infrastructure, model, application layer로 나눴습니다. 같은 주 CNCF 블로그에는 vLLM을 Kubernetes에 올려 self-hosted inference를 구성하는 글, HAMi가 CNCF incubating project가 됐다는 소식, AI agent의 네트워크 경계를 NGINX와 OpenTelemetry로 만드는 글이 이어졌습니다.

이 흐름을 하나로 묶으면 방향이 선명합니다. AI 서비스 운영은 더 이상 "모델 API를 호출하는 애플리케이션"만의 문제가 아닙니다. 모델 가중치가 어디에 저장되는지, GPU를 누가 얼마나 쓰는지, 프롬프트와 응답이 어떤 검사를 통과하는지, agent가 어느 외부 네트워크로 나갈 수 있는지, inference 비용 남용을 어떻게 막는지가 모두 플랫폼 보안의 일부가 되고 있습니다.

이 글은 [Kubernetes AI/ML 워크로드 UI](/posts/2026-07-17-kubernetes-aiml-workload-ui-headlamp-trend/), [AI 보안 리뷰 컨트롤 루프](/posts/2026-07-15-ai-security-review-control-loop-trend/), [Agent Native Temporary Trust Boundary](/posts/2026-06-26-agent-native-temporary-trust-boundary-trend/), [Kubernetes 기본기](/learning/deep-dive/deep-dive-kubernetes-basics/)와 이어집니다. 기존 글들이 AI 운영 화면과 에이전트 신뢰 경계를 다뤘다면, 이번 글은 AI 워크로드 자체를 어떤 보안 계층으로 감싸야 하는지 봅니다.

참고 신호:

- Google Cloud Blog, Securing AI at Enterprise Scale: The Google Kubernetes Engine Blueprint: https://cloud.google.com/blog/topics/developers-practitioners/securing-ai-at-enterprise-scale-the-google-kubernetes-engine-blueprint
- CNCF Blog, Running a self-hosted LLM in Kubernetes with vLLM: https://www.cncf.io/blog/2026/07/16/running-a-self-hosted-llm-in-kubernetes-with-vllm/
- CNCF Blog, HAMi becomes a CNCF incubating project: https://www.cncf.io/blog/2026/07/15/hami-becomes-a-cncf-incubating-project/
- CNCF Blog, Network boundary for AI agents using NGINX and OpenTelemetry: https://www.cncf.io/blog/2026/07/08/network-boundary-for-ai-agents-using-nginx-and-opentelemetry/

## 이 글에서 얻는 것

- AI 워크로드 보안이 컨테이너 이미지 스캔과 RBAC를 넘어 어떤 계층으로 확장되는지 이해합니다.
- GKE blueprint가 제시한 infrastructure, model, application layer 구분을 실무 threat model로 바꿀 수 있습니다.
- vLLM self-hosting, HAMi GPU virtualization, agent egress boundary가 왜 같은 흐름인지 연결할 수 있습니다.
- 플랫폼팀이 AI inference path를 운영할 때 적용할 숫자·조건·우선순위를 가져갑니다.

## 핵심 개념/이슈

### 1) AI workload의 자산은 컨테이너 이미지보다 넓다

전통적인 Kubernetes 보안은 이미지 취약점, RBAC, Secret, NetworkPolicy, admission control, runtime detection을 중심으로 발전했습니다. AI 워크로드는 여기에 몇 가지 자산을 더합니다.

| 자산 | 위험 | 필요한 제어 |
| --- | --- | --- |
| 모델 가중치 | 유출, 변조, 라이선스 위반 | artifact inventory, access control, checksum, provenance |
| 학습·검색 데이터 | PII, 영업비밀 노출 | data classification, retention, encryption, egress guard |
| 프롬프트와 응답 | prompt injection, data leakage | inspection, redaction, policy decision log |
| GPU/가속기 | 비용 남용, tenant 간 간섭 | quota, slicing, node isolation, utilization SLO |
| agent outbound network | 임의 외부 호출, exfiltration | egress proxy, allowlist, OTel audit |
| inference session | abuse, cost spike | per-user quota, session observability, rate limit |

Google Cloud 글에서 눈에 띄는 점은 AI 보안을 세 계층으로 나눈 것입니다. infrastructure layer에서는 Confidential GKE Nodes, Workload Identity, VPC Service Controls 같은 기반 제어를 말합니다. model security에서는 전통적인 SBOM만으로는 AI artifact를 충분히 설명하지 못한다는 문제를 짚고, model·dataset·framework inventory 관점으로 확장합니다. application layer에서는 prompt injection, PII 노출, harmful content 같은 추론 경로의 위협을 다룹니다.

즉 "Pod가 안전한가"만으로는 부족합니다. "그 Pod가 읽는 모델 파일은 누가 만들었고, 어떤 데이터로 튜닝됐으며, 어떤 프롬프트가 들어오고, 어떤 응답이 나가며, 어느 네트워크로 외부 호출을 하는가"까지 이어서 봐야 합니다.

### 2) Self-hosted inference는 데이터 통제와 운영 책임을 같이 가져온다

CNCF의 vLLM 글은 Kubernetes에서 self-hosted LLM을 운영하는 현실적인 패턴을 보여줍니다. vLLM은 OpenAI-compatible REST API를 제공하므로, 기존 OpenAI SDK나 LangChain, LlamaIndex 기반 코드를 URL 변경만으로 붙일 수 있습니다. 이 호환성은 hybrid architecture를 쉽게 만듭니다. 민감하거나 대량인 요청은 내부 vLLM으로 보내고, 특정 capability가 필요한 요청은 managed API로 보내는 식입니다.

하지만 self-hosted가 자동으로 안전하다는 뜻은 아닙니다. 관리형 API를 덜 쓰면 외부 전송 리스크는 줄 수 있지만, 내부 운영 책임이 늘어납니다.

- 모델 다운로드 토큰을 어떻게 보관하는가
- 모델 cache volume은 암호화·백업·삭제 정책이 있는가
- model server image는 누가 패치하는가
- OpenAI-compatible endpoint가 내부망에만 노출되는가
- 사용자별 quota와 비용 상한은 어디서 강제되는가
- 모델 응답 로그를 얼마나 보존하고 어떻게 마스킹하는가

실무 기준은 "self-hosted = 안전"이 아니라 "self-hosted = 통제 가능하지만 운영 책임 증가"입니다. 특히 모델 가중치가 수십 GB 이상이고 GPU 노드가 붙는 순간, 배포 실패와 비용 폭주도 보안 사건처럼 다뤄야 합니다. 추론 비용 남용은 장애와 예산 사고를 동시에 만듭니다.

### 3) GPU sharing은 utilization 문제가 아니라 isolation 문제다

HAMi가 CNCF incubating project가 된 것도 같은 맥락입니다. HAMi는 Kubernetes에서 GPU, NPU, DCU, MLU 같은 heterogeneous accelerator를 memory, core, device count 기준으로 나눠 쓰게 하는 middleware입니다. CNCF 글은 비싼 GPU가 작은 job에 통째로 할당돼 fragment되고 underused되는 문제를 짚습니다.

GPU sharing은 당연히 비용 최적화 효과가 있습니다. 하지만 운영 기준은 utilization 하나로 닫히면 안 됩니다. 같은 물리 GPU를 여러 tenant나 job이 나눠 쓰면 다음 질문이 따라옵니다.

- tenant 간 memory isolation이 충분한가
- noisy neighbor가 다른 inference latency를 흔들지 않는가
- GPU slice quota를 누가 승인하고 언제 회수하는가
- batch training과 real-time inference를 같은 pool에 둘 것인가
- GPU 장애 또는 driver issue가 몇 개 서비스로 전파되는가
- abuse 감지 시 특정 user/session만 차단할 수 있는가

초기 숫자 기준은 이렇게 둘 수 있습니다.

| 지표 | 기준 예시 |
| --- | --- |
| GPU utilization | 평균 50% 미만 7일 지속 시 sharing 검토 |
| inference p95 | control 대비 10% 이상 악화 시 sharing 정책 조정 |
| tenant quota breach | 1건 이상이면 admission/quota 정책 점검 |
| GPU memory OOM | 같은 pool에서 2회 이상이면 binpack 중단 또는 spread 전환 |
| cost per 1K requests | managed API 대비 30% 이상 절감 또는 지연/주권 근거 필요 |

GPU virtualization은 플랫폼팀의 용량 관리 도구이지만, 보안팀 입장에서는 격리 경계입니다. "더 잘게 쪼갠다"보다 "쪼갠 뒤에도 서로 영향을 못 주게 한다"가 우선입니다.

### 4) Agent와 inference는 네트워크 경계를 다르게 봐야 한다

일반 웹서비스의 egress는 외부 API, DB, 메시지 브로커 정도로 예측 가능합니다. AI agent는 다릅니다. 도구를 호출하고, 문서를 가져오고, 코드를 실행하고, 검색 API를 두드릴 수 있습니다. 이때 애플리케이션 코드 안의 guardrail만 믿으면 약합니다. 모델이 어떤 결정을 하든, 네트워크 레벨에서 갈 수 없는 곳은 갈 수 없어야 합니다.

CNCF의 NGINX/OpenTelemetry 글은 이 문제를 익숙한 도구로 푸는 예를 보여줍니다. inbound와 outbound를 proxy 경유로 강제하고, 다른 egress는 차단하며, OpenTelemetry span으로 외부 호출을 감사합니다. 핵심은 intent를 해석하는 것이 아니라 행동 경계를 강제하고 관측하는 것입니다.

이 흐름은 [Agent Native Temporary Trust Boundary](/posts/2026-06-26-agent-native-temporary-trust-boundary-trend/)와 바로 이어집니다. 에이전트가 강력해질수록 권한은 더 짧고 좁게 줘야 합니다. AI workload security blueprint에서도 agentic isolation은 별도 축으로 봐야 합니다. 코드 실행, 외부 도구 호출, untrusted input 처리까지 들어오면 sandbox, egress boundary, audit log가 최소 세트입니다.

### 5) AI 보안은 단계적으로 성숙시켜야 한다

Google Cloud는 baseline, hardening, enterprise governance에 가까운 phased approach를 제시합니다. 실무에서도 한 번에 모든 제어를 넣으려 하면 개발팀이 우회합니다. 대신 위험도별로 단계화하는 편이 좋습니다.

| 단계 | 적용 대상 | 최소 기준 |
| --- | --- | --- |
| PoC | 비민감 demo, 단기 실험 | TTL 30일, 외부 공개 금지, secret 회수, 로그 삭제 |
| Baseline | 내부 사용자, 제한된 데이터 | Workload Identity, Secret 관리, model endpoint 내부망, 기본 quota |
| Production | 고객 데이터, 결제/지원/코드 분석 | signed image, model artifact inventory, prompt/response inspection, audit |
| Regulated | 금융·의료·공공·영업비밀 | confidential nodes, VPC perimeter, SIEM correlation, policy-as-code |

중요한 건 PoC도 기준이 있어야 한다는 점입니다. PoC가 가장 많이 새는 지점은 "잠깐만 열어둔 endpoint", "테스트용 token", "임시 model cache volume", "삭제 안 된 prompt log"입니다. 운영 수준의 모든 제어를 강제하지 않아도, 만료와 삭제, 외부 노출 금지만은 처음부터 넣어야 합니다.

## 실무 적용

### 1) Inference path threat model을 만든다

AI 서비스를 하나 골라 실행 경로를 그립니다.

```yaml
ai_inference_path:
  app: customer-support-api
  gateway: internal-ai-gateway
  model_server: vllm-chat-cluster
  model_artifacts: gs://model-registry/support-llm/v3
  vector_store: support-rag-prod
  gpu_nodes: gke-gpu-pool-a
  outbound_tools: ["search-api", "ticket-api"]
  sensitive_data: ["customer_message", "ticket_history", "agent_notes"]
  controls:
    identity: workload_identity
    egress: proxy_allowlist
    inspection: prompt_response_filter
    audit: otel_span_and_policy_log
    quota: per_user_and_per_tenant
```

이 표가 없으면 보안 리뷰가 추상적으로 흐릅니다. "AI 보안 해주세요"가 아니라 "model artifact storage와 egress tool 호출을 누가 통제하는가"로 질문해야 합니다.

### 2) 최소 운영 게이트를 둔다

운영 반영 전 최소 기준:

- model artifact checksum과 source registry가 기록되어 있다.
- inference endpoint는 내부망 또는 인증된 gateway 뒤에 있다.
- user/session/tenant별 quota가 있고 초과 시 차단된다.
- prompt와 response는 PII/secret 검사 또는 마스킹 정책을 통과한다.
- outbound network는 allowlist 기반이고 감사 로그가 남는다.
- GPU node pool은 일반 app node pool과 분리되어 있다.
- rollback 시 이전 model version과 config로 30분 내 되돌릴 수 있다.

숫자 기준도 둡니다.

| 항목 | 권장 시작점 |
| --- | --- |
| per-user daily token budget | 제품 등급별 상한 |
| prompt log retention | 민감 서비스 7~30일, 원문 최소화 |
| egress deny event | 1건 이상이면 rule 리뷰 |
| model version rollback | 30분 이내 |
| GPU pool saturation | 80% 15분 지속 시 autoscale/queue |
| abuse detection | 동일 user 5분 token burn 3배 증가 시 throttle |

숫자는 서비스마다 조정해야 하지만, 숫자 없이 "주의해서 운영"하는 것은 운영 기준이 아닙니다.

### 3) 모델과 앱 배포를 분리한다

AI 서비스는 앱 코드, prompt template, model version, retrieval index, policy profile이 따로 바뀝니다. 이들을 한 배포로 뭉치면 원인 분석이 어려워집니다. 최소한 release metadata에는 다음이 남아야 합니다.

```yaml
ai_release:
  app_version: "support-api-2026.07.19"
  model_version: "support-llm-v3"
  prompt_version: "support-agent-prompt-18"
  retrieval_index: "tickets-rag-2026-07-18"
  policy_profile: "model-armor-prod-v6"
  gateway_ruleset: "ai-egress-allowlist-2026-07"
  approved_by: "platform-ai-security"
```

장애가 났을 때 "모델이 이상해졌다"는 말로는 부족합니다. prompt가 바뀐 건지, retrieval index가 바뀐 건지, model server image가 바뀐 건지, policy가 과하게 막은 건지 분리해야 합니다. [AI 보안 리뷰 컨트롤 루프](/posts/2026-07-15-ai-security-review-control-loop-trend/)의 핵심도 이 변경 단위를 증거로 남기는 데 있습니다.

### 4) 보안팀과 플랫폼팀의 owner 경계를 정한다

AI workload security는 한 팀이 혼자 못 합니다.

- 플랫폼팀: cluster, node pool, gateway, quota, observability
- 보안팀: threat model, policy, audit, incident response
- ML/AI팀: model artifact, eval, prompt, model card
- 앱팀: 사용자 흐름, 데이터 최소화, fallback UX
- 데이터팀: RAG source, retention, deletion, access review

승인 기준도 나눕니다. 예를 들어 GPU sharing 정책은 플랫폼팀이 승인하되 tenant isolation 기준은 보안팀이 봅니다. prompt/response policy는 보안팀이 정하되 false positive가 사용자 경험을 깨는지는 앱팀이 검증합니다. 책임 경계가 없으면 도입 속도만 빠르고 운영 품질은 낮아집니다.

### 5) 30일 도입 순서를 작게 잡는다

AI workload security는 한 번에 완성하려고 하면 대부분 문서로만 남습니다. 운영에 붙이려면 "무엇을 오늘 막을 것인가"와 "무엇을 다음 릴리스에서 계측할 것인가"를 나눠야 합니다. 특히 이미 Kubernetes에서 AI 기능을 돌리고 있다면 첫 달 목표는 완벽한 enterprise governance가 아니라 **누가, 어떤 모델을, 어떤 데이터로, 어느 경로에서 쓰는지 재현 가능하게 만드는 것**입니다.

| 기간 | 우선 작업 | 완료 기준 | 미루면 생기는 문제 |
| --- | --- | --- | --- |
| 1주차 | inference path inventory | app, model server, artifact, GPU node, egress가 표로 남음 | 보안 리뷰가 추상 질문으로 반복된다 |
| 2주차 | identity와 egress 경계 | Workload Identity, outbound allowlist, deny log 적용 | token 유출과 임의 외부 호출을 늦게 발견한다 |
| 3주차 | prompt/response와 로그 정책 | 원문 보존 범위, 마스킹, retention, 샘플 감사 기준 정의 | 개인정보가 로그와 벡터 저장소에 오래 남는다 |
| 4주차 | quota와 rollback drill | user/tenant token budget, 이전 model/config 복구 훈련 | 비용 폭주와 잘못된 모델 배포에 느리게 대응한다 |

이 순서는 기술 스택과 무관하게 적용할 수 있습니다. managed API를 쓰는 팀은 model server와 GPU node 항목을 provider boundary와 API quota로 바꾸면 됩니다. self-hosted vLLM을 쓰는 팀은 model artifact, cache volume, GPU node, ingress gateway 항목을 더 자세히 쪼개면 됩니다.

릴리스 게이트도 작게 시작합니다.

- 새 모델 또는 새 prompt template은 release metadata 없이는 production traffic을 받지 않는다.
- 외부 도구 호출이 추가되면 egress allowlist와 audit field가 같이 변경되어야 한다.
- prompt/response 원문 로그를 늘릴 때는 retention과 redaction 기준을 먼저 갱신한다.
- GPU pool policy를 바꾸면 p95 latency와 OOM event를 최소 24시간 비교한다.
- 보안 필터가 block으로 바뀌면 false positive 샘플링 담당자를 지정한다.

가장 중요한 롤백 단위는 앱 배포가 아니라 `model_version`, `prompt_version`, `policy_profile`, `gateway_ruleset`입니다. 예를 들어 새 safety profile이 정상 고객 요청을 과하게 막는다면 앱 코드를 되돌릴 필요 없이 이전 `policy_profile`로 낮춰야 합니다. 반대로 새 model version의 응답 품질이 흔들리면 prompt나 gateway가 아니라 model routing만 이전 버전으로 돌려야 합니다.

## 트레이드오프/주의점

첫째, managed API와 self-hosted inference는 보안 우열이 아니라 책임 배분이 다릅니다. managed API는 provider 보안과 운영 안정성을 빌리지만 데이터 전송과 비용 정책을 봐야 합니다. self-hosted는 데이터 통제와 지연시간 최적화가 쉬울 수 있지만 patch, GPU, model storage, token 관리 책임을 직접 집니다.

둘째, GPU sharing은 비용을 줄일 수 있지만 격리와 예측 가능성을 어렵게 만듭니다. 실시간 inference와 batch job을 같은 pool에 넣으면 p95 지연이 흔들릴 수 있습니다. 초기에는 중요도별 pool 분리, 이후 utilization 데이터를 보고 sharing 범위를 넓히는 편이 안전합니다.

셋째, prompt/response inspection은 false positive를 만듭니다. 보안 필터가 정상 고객 요청을 막으면 제품 신뢰가 떨어집니다. 그래서 block, redact, warn, allow-with-audit를 나누고, 고신뢰 차단만 자동화하는 것이 좋습니다.

넷째, egress boundary는 agent intent를 이해하지 않습니다. 네트워크상 갈 수 없는 곳을 막을 뿐입니다. 그래서 sandbox, identity, policy, eval, human approval과 함께 써야 합니다. proxy를 붙였다고 agent가 안전해졌다고 단정하면 안 됩니다.

다섯째, AI artifact inventory는 기존 SBOM보다 운영 습관이 덜 잡혀 있습니다. 모델 파일, adapter, tokenizer, dataset snapshot, prompt template, safety profile을 한 릴리스 단위로 묶지 않으면 나중에 재현이 어렵습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] AI inference path를 app, gateway, model server, artifact storage, GPU node, outbound network로 그렸다.
- [ ] 모델 가중치와 prompt template, retrieval index, policy profile이 release metadata에 남는다.
- [ ] Workload Identity 또는 동등한 secretless identity로 모델 저장소에 접근한다.
- [ ] prompt/response 검사와 로그 retention 기준이 데이터 등급별로 다르다.
- [ ] agent outbound network는 allowlist와 감사 로그를 가진다.
- [ ] GPU sharing은 utilization뿐 아니라 tenant isolation과 p95 latency 기준을 갖는다.
- [ ] PoC 환경에도 TTL, 외부 공개 금지, secret 회수, 로그 삭제 기준이 있다.
- [ ] 모델, prompt, policy, gateway ruleset을 각각 독립적으로 롤백할 수 있다.
- [ ] egress deny, filter block, quota throttle 이벤트를 product/support 팀이 해석할 수 있는 코드로 남긴다.

### 연습

1. 현재 운영 중이거나 검토 중인 AI 기능 1개를 골라 inference path threat model을 YAML로 작성해 보세요.
2. managed API와 self-hosted vLLM을 비교해 데이터 전송, 지연시간, 비용, 패치 책임, 감사 로그 기준을 표로 나눠 보세요.
3. agent가 호출할 수 있는 외부 도구 목록을 만들고, allowlist, rate limit, audit field, emergency deny rule을 각각 정의해 보세요.
4. 최근 1개 AI 릴리스를 골라 app, model, prompt, policy, retrieval index 중 어느 변경이었는지 분리해 보고, 각 항목의 되돌림 시간을 적어 보세요.

## 관련 글

- [Kubernetes AI/ML 워크로드 UI와 Headlamp 흐름](/posts/2026-07-17-kubernetes-aiml-workload-ui-headlamp-trend/)
- [AI 보안 리뷰 컨트롤 루프](/posts/2026-07-15-ai-security-review-control-loop-trend/)
- [Agent Native Temporary Trust Boundary](/posts/2026-06-26-agent-native-temporary-trust-boundary-trend/)
- [Kubernetes 기본기](/learning/deep-dive/deep-dive-kubernetes-basics/)
- [Secret Management 실무](/learning/deep-dive/deep-dive-secret-management/)
