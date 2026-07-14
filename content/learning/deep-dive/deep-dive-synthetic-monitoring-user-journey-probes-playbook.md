---
title: "백엔드 커리큘럼 심화: Synthetic Monitoring과 User Journey Probe, 헬스체크가 놓치는 장애를 먼저 보는 법"
date: 2026-07-14
draft: false
topic: "Observability"
tags: ["Synthetic Monitoring", "Blackbox Probe", "SLO", "Observability", "Incident Response", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "서비스 내부 지표와 헬스체크가 정상인데도 사용자가 실패하는 상황을 줄이기 위해, 외부 관점 synthetic monitoring과 핵심 사용자 여정 probe를 설계하는 실무 기준을 정리합니다."
summary: "Synthetic monitoring은 서버가 살아 있는지 확인하는 장치가 아니라, 사용자가 실제로 성공해야 하는 업무 흐름을 외부에서 반복 검증하는 운영 계약입니다."
module: "backend-ops-observability"
study_order: 1470
key_takeaways:
  - "readiness/liveness는 트래픽 라우팅 신호이고, synthetic probe는 사용자 관점 성공 여부를 보는 외부 증거다."
  - "좋은 synthetic monitoring은 로그인, 검색, 결제 전 단계, 파일 다운로드처럼 핵심 여정을 얇게 재현하고, 실패를 의존성별로 분해한다."
  - "프로브는 너무 깊으면 비용과 오탐이 커지고, 너무 얕으면 진짜 장애를 놓친다. 계층별 probe와 SLO 연결 기준이 필요하다."
operator_checklist:
  - "핵심 사용자 여정 3~5개를 고르고 지역, 인증, 데이터 seed, 성공 조건, 알림 기준을 문서화한다."
  - "synthetic failure는 readiness failure와 분리해서 보고, 내부 지표와 상관관계를 trace_id 또는 probe_id로 연결한다."
  - "probe 계정, 테스트 데이터, 외부 전송 방지, rate limit 예외, 비용 예산을 운영 정책으로 둔다."
learning_refs:
  - title: "로드밸런서/헬스체크"
    href: "/learning/deep-dive/deep-dive-load-balancer-healthchecks/"
    description: "liveness/readiness와 트래픽 라우팅 신호를 먼저 정리한 글입니다."
  - title: "Observability 알람 임계치 설계"
    href: "/learning/deep-dive/deep-dive-observability-alarms/"
    description: "SLO, burn rate, page 기준과 연결할 수 있는 배경 글입니다."
  - title: "배포 런북"
    href: "/learning/deep-dive/deep-dive-deployment-runbook/"
    description: "배포 직후 smoke test와 rollback 기준을 운영 절차로 묶는 글입니다."
  - title: "DB Failover 운영 플레이북"
    href: "/learning/deep-dive/deep-dive-db-failover-fencing-playbook/"
    description: "장애조치 뒤 핵심 API synthetic check를 어떻게 복구 판정에 넣을지 연결됩니다."
decision_guide:
  title: "Synthetic Monitoring을 어디부터 붙일까"
  intro: "모든 기능을 자동 사용자로 돌리면 비용과 오탐이 빠르게 커집니다. 사용자 영향, 외부 경로 의존성, 배포 회귀 탐지 효과를 기준으로 probe 대상을 고르는 편이 안전합니다."
  cases:
    - badge: "즉시 적용"
      title: "로그인, 결제 전 단계, 핵심 목록 조회처럼 실패 비용이 큰 여정"
      fit: "장애가 나면 고객 문의나 매출 손실로 바로 이어지는 Tier 1 사용자 흐름입니다."
      watchouts: "실제 결제, 실제 알림 발송처럼 부작용이 있는 단계는 no-send 또는 sandbox 경로가 없으면 제외해야 합니다."
      next_step: "API probe로 시작하고, 인증 redirect나 브라우저 렌더링이 중요할 때만 browser probe를 추가합니다."
    - badge: "단계 적용"
      title: "파일 다운로드, 검색, read model처럼 내부 지표만으로 놓치기 쉬운 경로"
      fit: "CDN, object storage, 검색 인덱스, 캐시, 권한 필터가 섞여 특정 지역이나 데이터에서만 실패할 수 있는 흐름입니다."
      watchouts: "seed data가 삭제되거나 권한이 바뀌면 실제 장애가 아닌데 probe가 실패할 수 있습니다."
      next_step: "전용 tenant와 checksum/assertion 기준을 만들고, 단일 지역 실패와 다지역 실패의 알림 강도를 분리합니다."
    - badge: "관측 우선"
      title: "관리자 기능이나 저빈도 내부 도구"
      fit: "사용자 영향은 있지만 즉시 page보다 업무 시간 내 조사로 충분한 경로입니다."
      watchouts: "낮은 빈도 기능을 너무 자주 probe하면 비용, 권한, 감사 로그 소음이 늘어납니다."
      next_step: "10분 이상 낮은 주기와 warning 중심 알림으로 시작하고, 실제 incident 데이터를 보고 승격합니다."
faqs:
  - question: "synthetic monitoring과 smoke test는 같은 건가요?"
    answer: "겹치는 부분은 있지만 목적이 다릅니다. smoke test는 주로 배포 직후 새 버전이 최소 동작하는지 보는 검증이고, synthetic monitoring은 평시에도 외부 사용자 관점의 핵심 여정을 반복 관측하는 운영 신호입니다."
  - question: "probe 실패를 SLO error budget에 그대로 넣어야 하나요?"
    answer: "보통은 별도 SLI로 두고 실제 사용자 오류율과 함께 봅니다. synthetic은 사용자 영향의 선행 신호가 될 수 있지만 실제 트래픽 표본은 아니므로, 단독 실패와 실제 오류 증가가 겹친 경우를 다르게 page하는 편이 현실적입니다."
  - question: "브라우저 probe와 API probe 중 무엇을 먼저 만들어야 하나요?"
    answer: "대부분은 API probe로 먼저 시작합니다. 브라우저 probe는 로그인 redirect, SPA 렌더링, 쿠키 정책, third-party script처럼 API만으로 확인하기 어려운 통합 경로에 좁게 쓰는 편이 오탐과 비용을 줄입니다."
---

서비스가 장애를 내는 방식은 늘 비슷하지 않습니다. 프로세스는 살아 있고, `/readyz`는 통과하고, DB 커넥션도 열리는데 사용자는 로그인 후 주문 목록을 못 보거나 파일 다운로드가 중간에 끊길 수 있습니다. CDN 경로가 특정 리전에서만 실패하거나, OAuth redirect가 잘못된 도메인으로 돌아가거나, 결제사 sandbox는 정상인데 production callback 서명이 깨지는 경우도 있습니다. 내부 지표만 보면 "초록"인데 사용자는 실패하는 상태입니다.

이런 공백을 줄이는 장치가 **Synthetic Monitoring**입니다. synthetic monitoring은 단순 uptime ping이 아닙니다. 사람이 실제로 성공해야 하는 업무 여정을 작은 자동 사용자로 반복 실행하고, 그 결과를 SLO와 배포/장애 런북에 연결하는 방식입니다. 이 글은 [로드밸런서/헬스체크](/learning/deep-dive/deep-dive-load-balancer-healthchecks/), [Observability 알람 임계치 설계](/learning/deep-dive/deep-dive-observability-alarms/), [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/), [DB Failover 운영 플레이북](/learning/deep-dive/deep-dive-db-failover-fencing-playbook/)과 이어서 보면 좋습니다. 핵심은 "서버가 살아 있나"가 아니라 **사용자가 해야 하는 일이 지금도 되는가**입니다.

## 이 글에서 얻는 것

- liveness, readiness, deep health check, synthetic probe의 역할을 구분할 수 있습니다.
- 로그인, 조회, 검색, 다운로드, 결제 직전 단계처럼 핵심 사용자 여정을 probe로 설계하는 기준을 잡을 수 있습니다.
- probe 주기, 지역, 성공 조건, timeout, 알림 임계치, 비용 예산을 숫자로 정할 수 있습니다.
- 오탐, 테스트 데이터 오염, 외부 전송 사고, rate limit 충돌을 줄이는 운영 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 헬스체크와 synthetic probe는 묻는 질문이 다르다

헬스체크는 주로 트래픽 라우팅을 위한 신호입니다. Kubernetes readiness는 "이 Pod로 요청을 보내도 되는가"를 묻고, liveness는 "프로세스를 재시작해야 하는가"를 묻습니다. 그래서 헬스체크는 가볍고 빠르고 안정적이어야 합니다. DB, 외부 API, 검색 엔진, 결제사를 모두 깊게 확인하는 endpoint를 readiness에 묶으면, 하류 의존성 하나가 흔들릴 때 정상 인스턴스까지 트래픽에서 빠지거나 재시작될 수 있습니다.

synthetic probe는 반대로 사용자의 성공을 묻습니다. 외부 위치에서 DNS, TLS, CDN, gateway, auth, API, DB, 캐시, 브라우저 렌더링 일부까지 지나가며 "이 업무가 실제로 가능한가"를 확인합니다. 따라서 헬스체크보다 느리고 비싸도 됩니다. 대신 라우팅 결정에 직접 쓰기보다 알림, 배포 검증, 장애 복구 판정에 씁니다.

역할을 표로 나누면 명확합니다.

| 신호 | 질문 | 실패 시 기본 액션 |
| --- | --- | --- |
| liveness | 프로세스가 교착/죽음 상태인가 | 재시작 |
| readiness | 지금 트래픽을 받아도 되는가 | 라우팅 제외 |
| dependency health | 내부 의존성이 정상 범위인가 | 운영 경보, degradation |
| synthetic probe | 사용자의 핵심 여정이 성공하는가 | page, rollback 후보, incident 분류 |

이 네 가지를 섞으면 장애가 커집니다. 예를 들어 OAuth provider가 30초 흔들렸다고 모든 API Pod readiness를 내리면, 실제로는 로그인만 불안정한데 전체 서비스가 트래픽을 잃을 수 있습니다. 반대로 readiness가 정상이라고 synthetic failure를 무시하면, 사용자 영향 장애를 늦게 봅니다.

### 2) 좋은 probe는 넓게 훑는 것이 아니라 비싼 실패를 얇게 찌른다

모든 기능을 synthetic으로 돌릴 필요는 없습니다. probe는 테스트 스위트가 아니라 운영 감시입니다. 실패했을 때 사용자 영향이 크고, 내부 지표만으로 놓치기 쉬운 경로부터 고릅니다.

우선순위가 높은 후보는 보통 아래입니다.

- 로그인 또는 토큰 갱신: 인증 provider, redirect URI, cookie, session 저장소 확인
- 핵심 목록 조회: API gateway, 권한 필터, DB/read model, pagination 확인
- 검색: 검색 인덱스 freshness, analyzer, 권한 필터 확인
- 파일 업로드/다운로드: object storage, CDN, signed URL, content-type 확인
- 주문/결제 직전 단계: 재고 확인, 가격 조회, 결제사 redirect 생성까지 확인
- 관리자 critical flow: 고객 조회, 권한 변경 preview, audit log 기록 확인

단, 결제 승인, 실제 이메일 발송, 실제 SMS, 외부 파트너 mutation처럼 부작용이 큰 작업은 production synthetic에서 바로 실행하지 않는 편이 안전합니다. 이런 흐름은 sandbox, dry-run, test merchant, no-send provider, idempotency key를 따로 둬야 합니다. [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/)나 [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)처럼 외부 이벤트가 얽힌 경로는 더욱 보수적으로 봐야 합니다.

### 3) 성공 조건은 HTTP 200보다 업무 의미를 봐야 한다

synthetic probe에서 가장 흔한 실수는 `status == 200`만 보는 것입니다. 200이 와도 로그인 페이지 HTML이 돌아왔을 수 있고, 에러 메시지를 포함한 JSON이 정상 응답 형식으로 내려올 수도 있습니다. 검색 API는 200이지만 결과가 0건이면 인덱스 동기화가 깨진 것일 수 있습니다.

성공 조건에는 업무 의미가 들어가야 합니다.

```yaml
synthetic_probe:
  name: order-history-read
  steps:
    - login_test_user
    - call_get_orders
    - assert_status_200
    - assert_json_path: "$.items[0].order_id"
    - assert_trace_header_present
    - assert_latency_p95_under: 1200ms
  data_seed:
    user: synthetic_user_kr_01
    expected_min_orders: 1
```

이때 테스트 데이터는 고정돼야 합니다. probe 계정의 주문 1건이 삭제되거나 권한이 바뀌면 실제 장애가 아닌데 probe가 실패합니다. 그래서 synthetic 전용 tenant, 전용 사용자, 전용 seed data, 정기 검증 job을 둡니다. 데이터 보존 정책 때문에 seed가 사라질 수 있다면 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 예외 정책을 맞춰야 합니다.

### 4) 지역과 네트워크 경로를 나누지 않으면 CDN/DNS 장애를 놓친다

내부 클러스터에서만 probe를 돌리면 애플리케이션 코드는 볼 수 있지만 외부 사용자 경로는 못 봅니다. 사용자는 DNS, ISP, CDN edge, WAF, public gateway를 거칩니다. 특히 글로벌 서비스는 특정 리전에서만 TLS chain, CDN cache, WAF rule, DNS resolver가 실패할 수 있습니다.

초기 지역 기준은 단순하게 시작합니다.

- 국내 사용자가 대부분이면 서울/도쿄 2곳
- 글로벌 SaaS면 미주, 유럽, 아시아 3곳 이상
- B2B 전용이면 주요 고객 리전 또는 사무망과 유사한 egress 1곳
- private admin이면 VPN/Zero Trust 경유 probe 1곳

판정도 지역별로 달라야 합니다. 한 지역 1회 실패는 warning, 두 지역 이상 2회 연속 실패는 page 후보처럼 둡니다. 반대로 결제나 로그인처럼 사업 영향이 큰 경로는 단일 주요 리전 실패도 빠르게 올립니다. DNS failover나 multi-region routing은 [멀티리전 Active-Active 설계](/learning/deep-dive/deep-dive-multi-region-active-active-strategy/)와 연결해 봐야 합니다.

### 5) probe는 관측 데이터의 시작점이어야 한다

synthetic probe가 실패했을 때 "실패했습니다"만 알리면 운영자는 다시 로그를 뒤져야 합니다. 좋은 probe는 실패 결과를 내부 trace와 연결합니다.

필수 필드 예시는 아래입니다.

```yaml
probe_result:
  probe_id: "order-history-read"
  run_id: "syn_20260714_100600_kr01"
  region: "ap-northeast-2"
  status: "failed"
  failed_step: "call_get_orders"
  http_status: 200
  assertion: "expected_min_orders"
  latency_ms: 842
  trace_id: "4f7b..."
  app_version: "2026.07.14.1"
  dependency_hint: "read_model_empty"
```

trace id가 있으면 APM에서 해당 synthetic 요청의 gateway, service, DB, cache 경로를 바로 볼 수 있습니다. `app_version`이 있으면 배포 회귀인지 판단하기 쉽고, `region`이 있으면 edge 문제인지 좁힐 수 있습니다. 이 구조는 [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)과 같이 설계해야 효과가 큽니다.

## 실무 적용

### 1) 핵심 여정 3개부터 시작한다

처음부터 모든 화면을 자동화하지 않습니다. 2주 안에 안정화할 수 있는 핵심 여정 3개를 고릅니다.

예시:

| 여정 | 성공 조건 | 주기 | 알림 |
| --- | --- | ---: | --- |
| 로그인 + 내 정보 조회 | 토큰 발급, `user_id` 일치 | 1분 | 3회 연속 실패 page |
| 주문 목록 조회 | seed 주문 1건 이상, p95 1.2초 이하 | 2분 | 2지역 동시 실패 page |
| 파일 다운로드 | signed URL 생성, 1MB object checksum 일치 | 5분 | 2회 연속 실패 warning, 3회 page |

여기서 중요한 기준은 **짧고 결정적인 성공 조건**입니다. 브라우저 전체 E2E를 15분마다 돌리면 느리고 불안정합니다. synthetic probe는 보통 1~5분 주기로 돌기 때문에 5~30초 안에 끝나는 얇은 흐름이 좋습니다. 브라우저가 꼭 필요한 경우와 API만으로 충분한 경우를 나눕니다.

### 2) 숫자 기준을 정한다

출발점으로 쓸 수 있는 숫자는 아래 정도입니다.

- probe timeout: API probe 3~5초, browser probe 10~20초
- probe 주기: Tier 1 여정 1분, Tier 2 여정 2~5분, 저위험 여정 10분
- page 기준: Tier 1은 2~3회 연속 실패 또는 2지역 동시 실패
- warning 기준: 단일 지역 1회 실패, latency 기준선 2배 초과
- false positive 목표: 월 probe 알림 중 오탐 20% 이하
- probe 데이터 seed 검증: 하루 1회
- synthetic traffic 비율: 전체 트래픽의 0.1% 이하 또는 명시 예산

SLO와 연결할 때는 probe를 사용자 요청과 같은 error budget에 그대로 합산할지 조심해야 합니다. synthetic은 실제 사용자 요청은 아니지만 사용자 영향의 선행 신호입니다. 보통은 별도 SLI로 두고, 실제 사용자 오류율과 결합해 page 강도를 결정합니다. 예를 들어 synthetic 3회 실패 + 실제 5xx 증가가 같이 오면 P1, synthetic만 실패하고 실제 오류가 없으면 P2 조사로 시작할 수 있습니다.

### 3) 배포와 장애 복구 런북에 넣는다

synthetic monitoring은 평시 알림보다 배포와 복구 판정에서 더 큰 가치를 냅니다.

배포 후 기준:

1. 새 버전 5% 카나리
2. 핵심 synthetic 3개를 즉시 2회 실행
3. `error_rate`, `p95`, `probe_success`를 10분 관측
4. probe 실패가 새 버전에만 집중되면 rollout 중단
5. 실패가 전 리전에 퍼지면 배포보다 외부 의존성/인프라를 먼저 확인

DB failover 뒤에도 비슷합니다. 새 리더 승격, connection draining, 애플리케이션 재연결이 끝났다고 복구가 아닙니다. 주문 조회, 쓰기 가능 여부, 검색/캐시 freshness, 파일 다운로드 같은 synthetic이 통과해야 사용자 관점 복구라고 말할 수 있습니다.

### 4) 테스트 계정과 부작용을 통제한다

probe 계정은 운영 자산입니다. 아무 계정이나 쓰면 보안과 데이터 품질이 흔들립니다.

필수 기준:

- 전용 synthetic tenant 또는 user를 둔다.
- 권한은 probe 여정에 필요한 최소 read/write만 준다.
- 실제 이메일, SMS, 결제, 외부 파트너 호출은 no-send 또는 sandbox로 라우팅한다.
- 생성 데이터는 prefix와 TTL을 둔다. 예: `syn_`, 7일 보존
- 계정 비밀번호나 토큰은 secret manager에서 회전한다.
- rate limit은 완전 예외보다 별도 낮은 quota를 준다.

probe가 production을 오염시키면 팀은 금방 probe를 끄고 싶어집니다. 그래서 처음부터 부작용 없는 여정과 부작용 있는 여정을 나눠야 합니다. write probe가 필요하다면 [멱등성 API 설계](/learning/deep-dive/deep-dive-idempotency/)와 [운영용 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/) 기준을 적용해, 중복 실행되어도 상태가 수렴하도록 만듭니다.

### 5) 실패 분류를 자동화한다

probe 실패는 원인 힌트가 있어야 합니다.

| 실패 유형 | 힌트 |
| --- | --- |
| DNS/TLS 실패 | 외부 경로, 인증서, CDN 확인 |
| 401/403 | 인증, 세션, 권한 정책 확인 |
| 5xx | 애플리케이션 오류, downstream 장애 |
| assertion 실패 | 데이터 seed, read model, 인덱스 freshness |
| latency 초과 | DB pool, cache miss, 외부 API 지연 |
| 지역 편향 실패 | CDN edge, WAF, routing, regional dependency |

분류가 있어야 on-call이 바로 담당 영역을 좁힙니다. 단순히 "synthetic failed"만 울리면, 오히려 알림 피로가 커집니다.

### 6) 실패 시 판정 순서를 정해 둔다

synthetic 알림이 울렸을 때 가장 먼저 할 일은 "장애인가 아닌가"를 논쟁하는 것이 아니라, 정해 둔 순서로 사용자 영향과 원인 범위를 좁히는 것입니다. 순서가 없으면 팀마다 다른 화면을 보고, 같은 알림을 두고 배포 문제인지 외부 의존성 문제인지 오래 다툽니다.

실무에서는 아래 순서가 유용합니다.

1. **범위 확인**: 단일 probe인지, 같은 여정의 여러 지역인지, 여러 여정이 동시에 실패했는지 본다.
2. **실사용자 지표 확인**: 5xx, latency, conversion, support ticket, RUM 오류가 같이 움직이는지 본다.
3. **최근 변경 확인**: 배포, feature flag, DNS/CDN/WAF rule, 인증 설정, schema migration이 있었는지 본다.
4. **실패 단계 확인**: DNS/TLS, auth, API, assertion, latency 중 어디에서 깨졌는지 본다.
5. **복구 기준 선택**: 재시도 대기, rollout 중단, rollback, failover, provider status 확인 중 하나로 좁힌다.

예를 들어 주문 목록 probe가 서울 리전에서 1회 실패했지만 실제 5xx와 conversion 저하가 없다면 P2 조사로 충분할 수 있습니다. 반대로 서울/도쿄/버지니아에서 동시에 실패하고 실제 API 5xx도 올라가면 synthetic은 이미 page 근거입니다. 배포 직후 새 버전 트래픽에서만 실패하면 rollout 중단이 먼저이고, 모든 버전에서 동일하게 실패하면 외부 의존성이나 데이터 경로를 먼저 봅니다.

이 판정 순서를 알림 본문이나 runbook에 넣어 두면 on-call이 매번 처음부터 추론하지 않아도 됩니다.

```yaml
synthetic_alert_triage:
  first_question: "사용자 영향이 실제 지표와 함께 보이는가?"
  page_when:
    - "tier1_probe_failed_3_times"
    - "same_journey_failed_in_2_regions"
    - "synthetic_failure_and_real_5xx_increase"
  rollback_candidate_when:
    - "failure_started_after_deploy"
    - "only_new_version_trace_ids_fail"
    - "canary_probe_failed_twice"
  wait_or_warn_when:
    - "single_region_single_failure"
    - "known_provider_degraded_but_user_error_flat"
    - "seed_data_validation_job_failed"
```

### 7) 팀 적용 템플릿을 작게 만든다

synthetic monitoring 도입 문서는 길 필요가 없습니다. 실제로 운영자가 쓰는 문서는 한 여정당 한 장이면 충분합니다. 아래 템플릿을 채우면 probe가 무엇을 보장하고, 무엇을 보장하지 않는지 분명해집니다.

| 항목 | 예시 |
| --- | --- |
| 여정 이름 | `login-and-profile-read` |
| 사용자 가치 | 로그인한 사용자가 내 정보를 볼 수 있어야 한다 |
| 실행 위치 | 서울, 도쿄 |
| 주기/timeout | 1분 / 5초 |
| 성공 조건 | 토큰 발급, `user_id` 일치, p95 800ms 이하 |
| 제외 범위 | 실제 이메일 발송, 마케팅 동의 변경 |
| 데이터/계정 | `synthetic_user_kr_01`, seed profile 1건 |
| 알림 기준 | 3회 연속 실패 또는 2지역 동시 실패 |
| 대시보드 | APM trace filter `probe_id=login-and-profile-read` |
| 복구 판정 | 2지역에서 3회 연속 성공 |

이 정도 정보가 있어야 probe가 팀의 공유 계약이 됩니다. probe 코드만 있고 문서가 없으면, 몇 달 뒤 누군가 "이 계정은 왜 로그인하나요?", "이 알림은 꺼도 되나요?", "이 실패는 장애인가요?"를 다시 묻게 됩니다. 반대로 템플릿이 있으면 새 여정을 추가할 때도 기준을 복사해 일관성을 유지할 수 있습니다.

## 트레이드오프/주의점

첫째, probe를 너무 깊게 만들면 오탐이 늘어납니다. 로그인, 검색, 다운로드, 결제사 redirect, 이메일 발송까지 한 probe에 묶으면 어디가 깨졌는지 알기 어렵고, 작은 외부 지연에도 전체가 실패합니다. 긴 여정은 여러 짧은 probe로 쪼개고, end-to-end probe는 낮은 주기로 둡니다.

둘째, probe가 실제 트래픽을 왜곡할 수 있습니다. 1분마다 검색을 돌리면 인기 검색어 랭킹, 추천 피처, 캐시 hit ratio에 영향을 줄 수 있습니다. synthetic 요청에는 전용 header, user agent, tenant를 붙이고 분석 파이프라인에서 제외하거나 별도 태깅합니다.

셋째, 브라우저 기반 probe는 강력하지만 비쌉니다. UI 렌더링, JS bundle, third-party script, cookie 정책까지 잡을 수 있지만 flake도 많습니다. API probe 80%, browser probe 20% 정도로 시작하고, 브라우저는 로그인/결제/핵심 폼처럼 UI 통합이 중요한 경로에만 씁니다.

넷째, synthetic 통과가 무장애를 의미하지 않습니다. seed 사용자와 실제 사용자의 권한, 데이터 크기, 네트워크, 브라우저 확장, 모바일 앱 버전은 다릅니다. synthetic은 빠른 감지와 복구 검증의 한 축이고, 실제 사용자 모니터링, 로그, trace, support ticket과 같이 봐야 합니다.

다섯째, 외부 서비스 약관과 비용을 확인해야 합니다. 결제, SMS, 이메일, 지도, 검색 API를 probe로 자주 호출하면 비용이나 abuse detection에 걸릴 수 있습니다. provider별 sandbox, quota, test credential, no-op mode를 확인합니다.

의사결정 우선순위는 **사용자 영향 큰 여정 > 외부 경로에서만 보이는 장애 > 배포 회귀 탐지 > 내부 의존성 진단 > 세부 UI 회귀** 순서가 현실적입니다. 모든 것을 probe로 잡으려 하지 말고, 내부 지표가 약한 곳을 보완하는 방식으로 설계하는 편이 오래 갑니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] liveness/readiness와 synthetic probe의 목적이 문서에서 분리되어 있다.
- [ ] 핵심 사용자 여정 3~5개에 대해 성공 조건, 주기, timeout, page 기준이 있다.
- [ ] probe 계정, seed data, secret rotation, no-send 외부 연동 기준이 있다.
- [ ] synthetic 요청에는 `probe_id`, `run_id`, `region`, `trace_id`가 남는다.
- [ ] probe 실패가 DNS/TLS, auth, 5xx, assertion, latency, regional failure로 분류된다.
- [ ] 배포/DB failover/장애 복구 런북에 synthetic 통과 기준이 포함되어 있다.
- [ ] probe 알림 오탐률과 방치 시간을 월 1회 리뷰한다.

### 연습

1. 현재 서비스에서 사용자가 실패하면 가장 비싼 여정 3개를 고르세요. 각 여정에 대해 API probe로 충분한지, browser probe가 필요한지 나눕니다.
2. `로그인 → 내 정보 조회`, `목록 조회`, `파일 다운로드` 중 하나를 골라 성공 조건을 HTTP status가 아닌 업무 의미로 5개 작성해 보세요.
3. 단일 리전 probe 실패, 2개 리전 동시 실패, synthetic 실패 + 실제 5xx 증가 세 상황을 각각 P2/P1/배포 중단 중 어디에 둘지 표로 정해 보세요.
4. probe 계정이 실제 이메일을 보내거나 결제를 만들지 않도록 no-send route와 test data cleanup 규칙을 설계해 보세요.

좋은 synthetic monitoring은 거대한 자동 QA가 아닙니다. 운영자가 "사용자는 지금 핵심 업무를 할 수 있는가"를 빠르게 판단하도록 해 주는 얇고 반복 가능한 증거입니다. 내부 지표가 초록이어도 사용자 여정이 빨간색이면 장애입니다. 반대로 synthetic이 실패했을 때 내부 지표와 연결할 수 있어야 알림이 소음이 아니라 행동으로 바뀝니다.
