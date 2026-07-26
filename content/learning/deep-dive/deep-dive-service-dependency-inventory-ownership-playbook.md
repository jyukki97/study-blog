---
title: "백엔드 커리큘럼 심화: Service Dependency Inventory, 장애 전파를 줄이는 의존성·소유권 운영 플레이북"
date: 2026-07-26
draft: false
topic: "Backend Reliability"
tags: ["Service Dependency", "Service Catalog", "Ownership", "Reliability", "Incident Response", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "서비스 간 호출, 외부 API, 큐, 배치, 저장소 의존성을 inventory로 관리하고 owner, criticality, SLO, 장애 시 동작을 숫자 기준으로 운영하는 방법을 정리합니다."
module: "backend-reliability"
study_order: 1270
key_takeaways:
  - "백엔드 장애는 단일 서비스 실패보다 숨은 의존성, owner 공백, 장애 시 fallback 부재에서 커지는 경우가 많다."
  - "의존성 inventory는 CMDB가 아니라 배포, 장애 대응, 변경 검토에 쓰이는 실행 가능한 운영 계약이어야 한다."
  - "서비스별 upstream/downstream, criticality, timeout budget, owner, fallback, observability를 한 표로 관리하면 변경 리스크와 incident triage 시간이 줄어든다."
operator_checklist:
  - "Tier-0/Tier-1 서비스부터 30일 안에 dependency inventory coverage 95% 이상을 만든다."
  - "모든 dependency에 owner, criticality, timeout budget, fallback mode, dashboard, paging policy를 기록한다."
  - "unknown owner dependency는 0개를 목표로 하고, 7일 이상 미해결이면 platform review 대상으로 올린다."
  - "새 outbound dependency 추가 PR에는 inventory diff와 장애 시 사용자 경험을 필수로 요구한다."
learning_refs:
  - title: "Outbound API Adapter"
    href: "/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/"
    description: "외부 API 호출을 제품 장애로 번지지 않게 adapter 경계로 관리하는 방법입니다."
  - title: "API Resource Budgeting"
    href: "/learning/deep-dive/deep-dive-api-resource-budgeting/"
    description: "요청 하나가 하위 서비스, DB, 큐, 외부 API를 얼마나 쓰는지 예산화하는 기준입니다."
  - title: "분산 트레이싱 도입 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/"
    description: "서비스 호출 경계를 trace로 관측하고 latency 원인을 찾는 방법입니다."
  - title: "Incident Command Severity"
    href: "/learning/deep-dive/deep-dive-incident-command-severity-playbook/"
    description: "장애 등급, 지휘 체계, owner 호출 기준을 정하는 운영 글입니다."
decision_guide:
  title: "dependency inventory를 어디까지 운영할까"
  intro: "모든 내부 호출을 처음부터 완벽하게 catalog화하려고 하면 오래 걸립니다. 장애 비용과 변경 빈도를 기준으로 우선순위를 잡아야 합니다."
  cases:
    - badge: "즉시 필수"
      title: "결제, 인증, 권한, 주문, 정산, 파일 접근, 고객 알림"
      fit: "장애가 바로 매출, 보안, 데이터 정합성, 고객 신뢰로 이어지는 Tier-0/Tier-1 경로"
      watchouts: "owner나 fallback이 없으면 하위 장애가 곧 전체 장애가 된다."
      next_step: "30일 dependency graph, 90일 변경 이력, paging owner를 먼저 고정한다."
    - badge: "점진 적용"
      title: "검색, 추천, 리포트, 운영 대시보드, 비핵심 enrich"
      fit: "실패해도 축소 응답이나 지연 처리로 사용자 흐름을 유지할 수 있는 경로"
      watchouts: "비핵심이라도 같은 thread pool, DB pool, queue를 공유하면 핵심 경로를 오염시킨다."
      next_step: "criticality와 bulkhead만 먼저 기록하고 fallback을 단계적으로 보강한다."
    - badge: "경량 관리"
      title: "실험 기능, 내부 도구, 일회성 배치"
      fit: "운영 사용자 영향이 작고 수동 복구가 가능한 의존성"
      watchouts: "실험 코드가 운영 경로로 승격될 때 inventory 없이 굳어질 수 있다."
      next_step: "운영 승격 checklist에 inventory 등록을 포함한다."
faqs:
  - question: "서비스 카탈로그와 dependency inventory는 같은 것인가요?"
    answer: "겹치지만 목적이 다릅니다. 서비스 카탈로그는 서비스의 기본 정보를 보여주고, dependency inventory는 장애와 변경 판단에 필요한 호출 관계, 중요도, fallback, owner를 실행 기준으로 기록합니다."
  - question: "분산 트레이싱이 있으면 inventory를 따로 만들 필요가 없나요?"
    answer: "필요합니다. tracing은 실제 호출을 잘 보여주지만 owner, 계약 책임, 장애 시 사용자 경험, 승인 기준을 대신 정해주지 않습니다. trace는 inventory를 최신화하는 증거로 쓰는 편이 좋습니다."
---

백엔드 장애는 대개 한 컴포넌트가 죽었다는 사실보다, 그 컴포넌트가 어디까지 연결되어 있는지 모른다는 사실 때문에 커집니다. 결제 API가 느려졌는데 주문 생성이 기다리고, 주문 생성이 느려지면서 재고 예약 queue가 밀리고, 재고 예약 지연 때문에 고객 알림이 중복되고, CS 도구는 주문 상태를 잘못 보여줍니다. 문제의 출발점은 하나였지만, 운영자는 "누가 owner인지", "어떤 서비스가 이 의존성을 쓰는지", "장애 시 기능을 줄여도 되는지"를 장애 중에 찾기 시작합니다.

그래서 서비스 의존성 관리는 문서 정리가 아니라 장애 반경을 줄이는 일입니다. 단순히 "A가 B를 호출한다"를 그리는 것으로는 부족합니다. 호출 목적, 사용자 영향, timeout budget, retry 정책, fallback, owner, 알림 기준, 변경 승인 기준까지 같이 있어야 실무에서 쓸 수 있습니다. 이 글은 [Outbound API Adapter](/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/), [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/), [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/), [Incident Command Severity](/learning/deep-dive/deep-dive-incident-command-severity-playbook/)와 이어집니다. 핵심은 dependency graph를 예쁜 그림이 아니라 **배포와 장애 대응에 쓰이는 운영 계약**으로 만드는 것입니다.

## 이 글에서 얻는 것

- 서비스 dependency inventory가 왜 architecture diagram이나 CMDB와 다른지 이해합니다.
- 내부 API, 외부 API, DB, queue, batch, cache 의존성을 어떤 필드로 관리해야 하는지 정리합니다.
- owner 공백, criticality 누락, timeout budget 부재가 장애 전파로 이어지는 과정을 설명할 수 있습니다.
- 새 의존성 추가와 기존 의존성 변경을 PR, 배포, incident review에서 검증하는 기준을 가져갑니다.

## 핵심 개념/이슈

### 1) 의존성은 호출 관계가 아니라 책임 관계다

서비스 A가 서비스 B를 호출한다는 정보만으로는 운영 판단이 어렵습니다. 같은 호출이라도 의미가 다릅니다. 로그인 요청에서 인증 서비스를 호출하는 것은 핵심 경로입니다. 상품 상세에서 추천 서비스를 호출하는 것은 실패해도 빈 영역으로 대체할 수 있습니다. 주문 완료 후 마케팅 태그를 붙이는 호출은 지연 처리로 넘길 수 있습니다. 의존성의 위험은 기술 프로토콜보다 **사용자 흐름에서 어떤 역할을 하는가**로 결정됩니다.

따라서 inventory에는 최소 아래 필드가 필요합니다.

| 필드 | 의미 | 예시 |
| --- | --- | --- |
| `consumer` | 의존성을 사용하는 서비스 | `checkout-api` |
| `provider` | 호출 대상 | `payment-gateway-adapter` |
| `dependency_type` | 내부 API, 외부 API, DB, queue, cache, batch | `external_api` |
| `business_flow` | 영향을 받는 사용자 흐름 | `checkout`, `subscription_renewal` |
| `criticality` | 장애 영향도 | `tier-0`, `tier-1`, `tier-2` |
| `owner_team` | 운영 책임 팀 | `payments-platform` |
| `fallback_mode` | 실패 시 동작 | `pending_confirmation`, `degraded_response`, `deny` |
| `timeout_budget_ms` | 호출 대기 예산 | `800` |
| `observability` | dashboard, alert, trace span | `checkout/dependencies` |

이 표가 있으면 장애 중 질문이 바뀝니다. "왜 느리지?"에서 "결제 adapter tier-0 의존성이 p95 2배라 checkout을 pending confirmation으로 낮출까?"로 바뀝니다. 질문이 구체적이면 대응도 빨라집니다.

### 2) owner가 없는 dependency는 장애 때 실제로는 아무도 소유하지 않는다

서비스가 많아지면 "예전에 A팀이 만든 것", "플랫폼에서 관리하는 것 같은 것", "외부 벤더라 어쩔 수 없는 것"이 생깁니다. owner가 불명확한 dependency는 평소에는 문제 없어 보입니다. 하지만 장애가 나면 누가 provider 상태를 확인하고, 누가 rollback을 결정하고, 누가 client에게 공지할지 비어 있습니다.

운영 기준은 단순하게 잡는 편이 좋습니다.

- Tier-0/Tier-1 dependency의 owner unknown: **0개**
- 신규 dependency PR에서 owner 미기재: merge 불가
- owner 변경 후 inventory 반영 지연: **7일 이내**
- 90일 동안 호출량이 있지만 owner가 없는 dependency: platform review
- owner team이 해체되었거나 on-call이 없으면 criticality를 한 단계 올려 재검토

owner는 개인 이름보다 팀과 escalation channel을 우선합니다. 개인 담당자는 휴가, 이직, 조직 변경으로 사라질 수 있습니다. 최소 필드는 `owner_team`, `oncall_rotation`, `slack_channel`, `runbook_url`, `backup_owner` 정도입니다. [Incident Command Severity](/learning/deep-dive/deep-dive-incident-command-severity-playbook/)에서 말하는 incident commander도 결국 owner 정보를 보고 호출합니다.

### 3) runtime dependency와 declared dependency는 다르다

문서에는 "checkout-api -> payment-service"라고 적혀 있어도 실제 운영 호출은 다를 수 있습니다. feature flag에 따라 fraud-check를 추가로 호출하고, 특정 국가에서는 tax provider를 호출하고, 실패 시 fallback cache를 읽고, batch worker가 같은 DB를 직접 조회할 수 있습니다. 즉 선언된 구조와 실제 runtime 호출 그래프가 어긋납니다.

이 간극을 줄이려면 세 가지 source를 같이 봐야 합니다.

1. 코드와 설정: client bean, SDK 설정, queue topic, DB connection, feature flag
2. runtime telemetry: trace span, service mesh metric, API gateway log, DB audit log
3. 운영 문서: owner, fallback, runbook, contract, sunset 계획

분산 트레이싱은 특히 강력한 증거입니다. 하지만 trace가 있다고 inventory가 자동으로 완성되는 것은 아닙니다. trace는 "호출이 있었다"를 보여주고, inventory는 "이 호출을 누가 책임지고 어떤 기준으로 유지할 것인가"를 정합니다. 두 도구는 대체재가 아니라 서로 보완합니다.

### 4) timeout budget 없는 dependency는 상위 SLO를 먹어 치운다

하위 의존성마다 timeout을 대충 3초로 잡으면 상위 요청의 SLO는 금방 무너집니다. checkout API의 p95 목표가 2초인데 내부 인증 1초, 결제 3초, 쿠폰 2초, 재고 2초를 순차 호출하면 이미 설계가 틀렸습니다. [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/) 관점으로 각 dependency는 상위 요청 예산 안에 들어와야 합니다.

초기 기준은 아래처럼 둘 수 있습니다.

| 흐름 | 상위 p95 목표 | 단일 dependency 동기 대기 예산 | 비고 |
| --- | --- | --- | --- |
| 로그인/권한 확인 | 500~1000ms | 100~300ms | cache 또는 local token 검증 우선 |
| 주문 생성 | 1500~2500ms | 300~800ms | 결제/재고는 결과 불명확 상태 고려 |
| 검색/추천 | 1000~2000ms | 200~500ms | 실패 시 축소 응답 가능 |
| 관리자 리포트 | 3~10초 | 1~3초 | 비동기 export 전환 검토 |
| 배치 sync | 분 단위 | provider SLA 기준 | checkpoint와 재시작 기준 필수 |

전체 deadline 중 특정 하위 호출이 **40% 이상**을 지속적으로 쓰면 구조를 다시 봅니다. 같은 provider를 여러 번 순차 호출한다면 aggregation, cache, async workflow, bulk API를 검토합니다. timeout은 느린 장애를 빨리 실패시키는 장치이지, 사용자 경험을 희생하며 기다리는 허가증이 아닙니다.

### 5) dependency 변경은 작은 배포 이벤트다

새로운 내부 API 호출 하나, 외부 SDK 하나, queue topic 하나가 들어오는 것은 코드 diff보다 큰 운영 변화일 수 있습니다. 특히 인증, 결제, 파일, 알림, AI 추론, 검색 인덱스처럼 장애 모드가 다른 의존성을 붙일 때는 PR에 inventory diff가 있어야 합니다.

의존성 추가 PR에서 물어야 할 질문은 아래입니다.

- 이 dependency의 owner는 누구인가?
- 동기 경로인가, 비동기 경로인가?
- 실패하면 사용자는 무엇을 보나?
- timeout, retry, circuit breaker, bulkhead는 어디서 제어하나?
- quota나 비용 제한이 있는가?
- provider contract가 바뀌면 어떤 test가 깨지나?
- 장애 시 기능을 끄는 flag가 있는가?
- dashboard와 alert는 배포 전에 준비되어 있는가?

이 질문은 과한 절차가 아닙니다. 의존성 하나가 추가되면 장애 원인 후보도 하나 늘어납니다. 운영 가능한 팀은 이 후보를 머릿속이 아니라 inventory에 추가합니다.

## 실무 적용

### 1) Dependency inventory schema를 작게 시작한다

처음부터 복잡한 platform catalog를 만들 필요는 없습니다. YAML, Markdown table, Backstage catalog, 내부 DB 무엇이든 좋습니다. 중요한 것은 장애와 변경 검토에 필요한 필드를 빠뜨리지 않는 것입니다.

```yaml
dependency:
  id: checkout-api_to_payment-gateway
  consumer: checkout-api
  provider: payment-gateway-adapter
  dependency_type: external_api
  business_flows: [checkout, subscription_renewal]
  criticality: tier-0
  owner_team: payments-platform
  oncall: payments-primary
  protocol: https
  sync_path: true
  timeout_budget_ms: 700
  retry_policy: write_once_with_idempotency
  fallback_mode: pending_confirmation
  circuit_breaker:
    open_if: "timeout_or_5xx_rate > 10% for 5m"
  observability:
    dashboard: "dashboards/checkout-dependencies"
    alert: "payment_dependency_error_rate"
    trace_span: "PaymentGateway.authorize"
  change_control:
    requires_contract_test: true
    requires_runbook_update: true
```

여기서 `criticality`, `fallback_mode`, `timeout_budget_ms`, `owner_team`은 특히 중요합니다. 이 네 개가 없으면 inventory는 검색용 목록에 가깝고, 장애 대응 도구로는 약합니다.

### 2) 우선순위는 Tier-0/Tier-1부터 잡는다

모든 서비스를 한 번에 정리하려고 하면 실패합니다. 1차 대상은 장애 비용이 큰 경로입니다.

1. 로그인, 인증, 권한
2. 주문, 결제, 정산
3. 파일 업로드/다운로드와 고객 데이터 조회
4. 고객 알림과 webhook
5. 관리자 보정 작업과 대량 export

이 경로의 dependency inventory coverage를 먼저 **95% 이상**으로 올립니다. coverage는 "서비스 수"가 아니라 "핵심 사용자 흐름에서 호출되는 dependency 중 inventory에 등록된 비율"로 봅니다. 호출량이 낮아도 결제 취소나 권한 변경처럼 중요도가 높은 경로는 포함해야 합니다.

### 3) trace와 gateway log로 drift를 잡는다

문서 기반 inventory는 시간이 지나면 낡습니다. 자동 drift 감지가 필요합니다.

```text
daily_dependency_drift_check:
  input:
    - trace service graph last 24h
    - api gateway upstream log
    - queue publish/consume metrics
    - db connection audit
  compare:
    - runtime edge not in inventory
    - inventory edge not seen for 30d
    - owner missing
    - timeout budget missing
    - criticality mismatch
```

운영 기준은 이렇게 둘 수 있습니다.

- runtime에서 새 edge가 보였고 inventory에 없으면 24시간 안에 owner 후보를 붙인다.
- 30일 동안 보이지 않는 dependency는 deprecated 후보로 표시한다.
- Tier-0 서비스에서 unknown runtime edge가 보이면 release review에 올린다.
- feature flag 뒤에 숨어 월 1회만 나타나는 edge를 위해 90일 window도 별도로 본다.

이렇게 해야 inventory가 살아 있는 문서가 됩니다.

### 4) 장애 대응 화면에는 graph보다 action이 먼저 보여야 한다

서비스 dependency graph를 멋지게 그려도 incident 중에는 너무 복잡할 수 있습니다. 장애 화면에는 "지금 무엇을 해야 하는가"가 먼저 보여야 합니다.

좋은 incident view는 아래 질문에 바로 답합니다.

- 영향받는 business flow는 무엇인가?
- 이 dependency의 criticality는 무엇인가?
- owner와 on-call은 누구인가?
- fallback을 켜도 되는가?
- circuit breaker를 열면 어떤 기능이 축소되는가?
- 최근 배포나 설정 변경이 있었는가?
- downstream queue lag와 unknown result는 늘고 있는가?

즉 graph는 원인 탐색에 유용하지만, 대응은 runbook과 action 중심이어야 합니다. [Incident Command Severity](/learning/deep-dive/deep-dive-incident-command-severity-playbook/)의 severity 기준과 dependency criticality를 연결하면 판단이 빨라집니다.

## 트레이드오프/주의점

첫째, inventory를 너무 세밀하게 만들면 유지 비용이 커집니다. 모든 함수 호출과 모든 SQL query를 관리하려고 하면 금방 포기하게 됩니다. 운영 단위는 "장애와 변경 판단이 달라지는 경계"로 잡는 편이 좋습니다. 내부 함수 호출보다 서비스, provider, queue, DB, cache, batch job 단위가 출발점입니다.

둘째, 자동 discovery만 믿으면 의미를 놓칩니다. trace는 호출을 찾지만 비즈니스 중요도와 owner 책임을 알지 못합니다. 자동 수집으로 후보를 만들고, owner가 criticality와 fallback을 확정하는 흐름이 현실적입니다.

셋째, owner를 적었다고 책임이 생기는 것은 아닙니다. on-call, dashboard, alert, runbook, 변경 승인 권한이 함께 있어야 owner가 작동합니다. 이름만 있는 owner는 incident 중에 도움이 되지 않습니다.

넷째, dependency를 줄이는 것이 항상 답은 아닙니다. 어떤 의존성은 제품 기능을 위해 필요합니다. 목표는 무조건 줄이기가 아니라, 핵심 경로의 불필요한 동기 의존성을 줄이고, 필요한 의존성은 timeout, fallback, 관측, owner를 갖게 만드는 것입니다.

의사결정 우선순위는 **고객 영향 경로 > 보안/정합성 경로 > 동기 호출 > owner 공백 > 비용 최적화** 순서로 두면 좋습니다. 비용 때문에 inventory를 만드는 것이 아니라, 장애 반경을 줄이기 위해 만드는 것입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] Tier-0/Tier-1 business flow 목록이 있다.
- [ ] 각 flow의 내부 API, 외부 API, DB, queue, cache dependency가 inventory에 등록되어 있다.
- [ ] 모든 dependency에 owner team과 on-call 경로가 있다.
- [ ] criticality, timeout budget, fallback mode가 비어 있지 않다.
- [ ] 새 dependency 추가 PR은 inventory diff를 요구한다.
- [ ] runtime trace에서 inventory에 없는 edge를 매일 또는 매주 탐지한다.
- [ ] 30일 이상 호출되지 않은 dependency는 deprecation 후보로 표시한다.
- [ ] incident 화면에서 owner, fallback, circuit breaker, dashboard를 바로 볼 수 있다.

### 연습

1. checkout, login, file download 중 하나를 골라 upstream/downstream dependency를 10개 이내로 적어 보세요.
2. 각 dependency에 `criticality`, `owner`, `timeout`, `fallback` 네 필드를 채워 보세요. 하나라도 비면 장애 때 어떤 질문이 생길지 적습니다.
3. 최근 30일 trace나 gateway log에서 문서에 없는 dependency edge가 있는지 찾아 보세요.
4. 신규 외부 API를 하나 붙인다고 가정하고, PR template에 들어갈 dependency inventory diff 항목을 만들어 보세요.

서비스 dependency inventory의 목적은 문서를 예쁘게 만드는 것이 아닙니다. 장애가 났을 때 질문을 줄이고, 변경 전에 위험을 보이게 만들고, owner가 없는 의존성을 없애는 것입니다. 좋은 백엔드 팀은 장애가 난 뒤 관계도를 그리지 않습니다. 평소에 관계와 책임을 작게라도 유지하고, 변경이 들어올 때마다 그 계약을 갱신합니다.
