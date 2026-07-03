---
title: "백엔드 커리큘럼 심화: API Resource Budgeting, 요청 하나의 CPU·DB·외부 호출 비용을 설계하는 법"
date: 2026-07-03
draft: false
topic: "Architecture"
tags: ["API Design", "Resource Budget", "Capacity Planning", "SLO", "Backend Operations", "Cost Control"]
categories: ["Backend Deep Dive"]
description: "API 요청을 단순 QPS가 아니라 CPU, DB 커넥션, 외부 API, 큐, 캐시 비용을 소비하는 작업 단위로 보고 예산을 설계하는 실무 기준을 정리합니다."
module: "resilience-system"
study_order: 1450
key_takeaways:
  - "API Resource Budgeting은 요청 1건이 쓰는 CPU, DB, 외부 호출, 큐, 캐시 비용을 명시해 과부하와 비용 폭주를 줄이는 설계 방식이다."
  - "QPS 제한만으로는 무거운 요청과 가벼운 요청을 구분할 수 없으므로 endpoint별 cost unit과 tenant별 예산이 필요하다."
  - "예산 초과 시 무조건 실패시키기보다 downgrade, async 전환, partial response, admission control을 우선순위대로 적용해야 한다."
operator_checklist:
  - "핵심 API 10개에 대해 p95 latency, DB query count, external call count, response size, retry count를 cost profile로 기록한다."
  - "비용이 큰 endpoint에는 request cost unit, tenant budget, degraded path, 429/503 응답 기준을 함께 둔다."
  - "budget 초과 로그를 단순 에러가 아니라 설계 피드백으로 보고 2주 단위로 예산을 조정한다."
learning_refs:
  - title: "Capacity Planning과 Little's Law"
    href: "/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/"
    description: "동시성, 처리량, 대기시간의 기본 관계를 잡는 글입니다."
  - title: "Admission Control과 Concurrency Limits"
    href: "/learning/deep-dive/deep-dive-admission-control-concurrency-limits/"
    description: "시스템이 받을 요청을 상태 기반으로 제한하는 운영 패턴입니다."
  - title: "API 레이트 리밋과 백프레셔"
    href: "/learning/deep-dive/deep-dive-api-rate-limit-backpressure/"
    description: "429, 503, retry, load shedding을 함께 설계하는 기준입니다."
---

## 이 글에서 얻는 것

- API를 "엔드포인트별 기능"이 아니라 **리소스를 소비하는 작업 단위**로 바라보는 기준을 잡을 수 있습니다.
- QPS, latency, DB query count, 외부 호출 수, response size를 묶어 요청 비용을 산정하는 방법을 배웁니다.
- 무거운 요청을 막을지, 줄일지, 비동기로 보낼지 결정하는 실무 기준을 가져갈 수 있습니다.
- tenant별 공정성, SLO, 인프라 비용을 같은 표에서 의사결정하는 방식을 익힙니다.

이 글은 [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/), [Admission Control과 Concurrency Limits](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/), [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/), [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 함께 보면 좋습니다. 공통 질문은 하나입니다. **서버가 할 수 있는 일을 어떤 요청에 먼저 배정할 것인가?**

## 핵심 개념/이슈

### 1) QPS만 보면 무거운 요청을 놓친다

운영에서 자주 나오는 착각은 "초당 요청 수가 낮으니 괜찮다"입니다. 하지만 백엔드 부하는 요청 수만으로 결정되지 않습니다. 같은 1건이라도 아래처럼 비용이 다릅니다.

| 요청 | 겉보기 QPS | 실제 비용 |
| --- | ---: | --- |
| `GET /users/me` | 높음 | 캐시 hit, DB 0~1회, 응답 작음 |
| `GET /reports/monthly` | 낮음 | DB aggregation 6개, 외부 API 2회, 응답 큼 |
| `POST /orders/import` | 낮음 | 파일 파싱, row validation, 큐 적재, 중복 검사 |
| `GET /search` | 중간 | 검색 엔진 fan-out, highlight, pagination 비용 |

QPS 기반 rate limit만 있으면 `GET /users/me`와 `GET /reports/monthly`를 같은 1건으로 봅니다. 그러면 낮은 QPS의 무거운 요청이 DB pool을 잠식하고, 평범한 조회 API의 p99까지 같이 끌어내립니다. 그래서 실무에서는 endpoint별 **request cost unit**을 둬야 합니다.

초기 기준은 단순해도 됩니다.

| cost unit | 기준 예시 |
| --- | --- |
| CPU unit | p95 CPU time 10ms를 1점 |
| DB unit | 단순 indexed query 1회를 1점, full scan 또는 aggregation은 5~20점 |
| External unit | 외부 API 1회를 10점, 결제/배송처럼 느린 의존성은 20점 |
| Payload unit | 응답 100KB를 1점, upload 1MB를 2~5점 |
| Queue unit | 메시지 1개 enqueue를 1점, fan-out 메시지는 개수만큼 가산 |

정밀한 원가 계산이 목표가 아닙니다. "이 요청은 평균 요청보다 20배 비싸다"를 팀이 같은 언어로 말하게 만드는 것이 먼저입니다.

### 2) Resource Budget은 timeout과 다르다

timeout은 시간 제한입니다. resource budget은 시간뿐 아니라 리소스 사용량 제한입니다.

- `remaining_time_ms`: 이 요청이 더 쓸 수 있는 시간
- `remaining_db_queries`: 더 실행할 수 있는 DB 쿼리 수
- `remaining_external_calls`: 더 호출할 수 있는 외부 API 수
- `remaining_payload_bytes`: 더 내려줄 수 있는 응답 크기
- `remaining_retry_count`: 더 허용되는 재시도 횟수
- `remaining_cost_units`: 위 항목을 합산한 요청 비용 점수

[종단간 Deadline Budget과 Cancellation Propagation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)이 "언제까지 끝낼 것인가"를 다룬다면, resource budget은 "그 시간 안에 무엇을 얼마나 써도 되는가"를 다룹니다. 둘은 같이 가야 합니다. 시간이 남았더라도 DB 쿼리 예산을 다 썼으면 추가 fan-out을 막아야 하고, DB 예산이 남았더라도 deadline이 50ms밖에 남지 않았다면 degraded response로 빠지는 편이 낫습니다.

### 3) 예산은 endpoint, tenant, request class 세 축으로 잡는다

모든 요청에 같은 예산을 주면 공정하지 않습니다. 실무에서는 세 축을 같이 봅니다.

1. **Endpoint budget**: API 특성별 기본 예산
2. **Tenant budget**: 고객 또는 조직별 공정성 예산
3. **Request class budget**: interactive, background, admin, batch 같은 목적별 예산

예를 들어 같은 검색 API라도 interactive 검색은 p95 500ms 안에 partial result라도 주는 것이 중요하고, 관리자 bulk export는 10분이 걸려도 정확성과 재시작 가능성이 더 중요합니다. 두 요청을 같은 `GET /search` 계열로만 보면 의사결정이 흐려집니다.

출발점은 아래처럼 둘 수 있습니다.

| class | latency 목표 | cost unit | 초과 시 정책 |
| --- | ---: | ---: | --- |
| interactive read | p95 500ms | 50 | partial response, cache fallback |
| interactive write | p95 800ms | 80 | idempotency key 확인 후 빠른 실패 |
| admin report | p95 3s | 200 | async job 전환 |
| batch import | 분 단위 | 1000 | queue, chunk, retry budget |
| internal health | p95 100ms | 5 | 항상 lightweight 유지 |

중요한 우선순위는 **사용자-facing interactive 요청 보호 > 데이터 정합성 유지 > batch 처리량 > 편의성 기능**입니다. 이 기준이 없으면 장애 때 가장 큰 요청이 가장 많은 자원을 계속 가져갑니다.

### 4) 예산 초과는 실패가 아니라 분기 조건이다

budget을 만들면 처음에는 차단 규칙처럼 보입니다. 하지만 좋은 resource budgeting은 무조건 거절보다 먼저 **대체 경로**를 설계합니다.

- 남은 시간이 부족하면 full aggregation 대신 cached summary를 반환
- DB query 예산이 부족하면 N+1 상세 정보를 생략하고 `has_more_details=true` 표시
- 외부 API 예산이 부족하면 실시간 조회 대신 마지막 동기화 시각을 함께 반환
- payload 예산이 부족하면 cursor pagination을 강제
- tenant 예산이 부족하면 429와 `Retry-After`를 명확히 반환
- 시스템 전체 포화면 503과 load shedding으로 빠르게 실패

이 분기는 [Graceful Degradation과 Brownout](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/), [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/), [Cache Consistency와 Invalidation](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)과도 연결됩니다. 예산은 사용자 경험을 망치기 위한 규칙이 아니라, 전체 시스템이 무너지는 것을 막으면서 덜 중요한 부분을 줄이는 기준입니다.

## 실무 적용

### 1) 핵심 API 10개의 cost profile부터 만든다

처음부터 모든 API를 분석할 필요는 없습니다. 트래픽 상위 5개와 장애 때 자주 등장하는 무거운 API 5개를 고릅니다. 각 API에 대해 최근 14일 기준으로 아래 값을 기록합니다.

| 지표 | 권장 기준 |
| --- | --- |
| p50/p95/p99 latency | p95는 SLO, p99는 포화 신호 |
| DB query count | 평균보다 p95 query count가 중요 |
| DB pool wait | p95 50ms 초과면 포화 후보 |
| external call count | 2개 이상이면 fan-out 관리 필요 |
| response size | p95 500KB 초과면 pagination 검토 |
| retry count | 요청당 1회 초과면 retry storm 후보 |
| cache hit ratio | 80% 미만이면 fallback 품질 확인 |
| tenant concentration | 상위 tenant 1곳이 30% 초과면 공정성 검토 |

이 표를 만들면 "느린 API"보다 더 유용한 결론이 나옵니다. 예를 들어 latency는 비슷해도 DB query count가 4배인 API, 외부 호출이 많아 timeout 전파가 중요한 API, 응답 크기 때문에 네트워크 비용이 큰 API를 나눌 수 있습니다.

### 2) request cost unit을 로그와 trace에 남긴다

budget은 코드 안 상수로만 있으면 운영에 쓰기 어렵습니다. 최소한 아래 필드는 structured log 또는 trace attribute에 남깁니다.

```yaml
api_resource_budget:
  endpoint: "GET /reports/monthly"
  request_class: "interactive_read"
  tenant_id_hash: "t_91ab"
  budget_units: 120
  used_units: 146
  db_query_count: 12
  external_call_count: 2
  response_bytes: 842000
  budget_decision: "degraded_partial_response"
```

원문 고객 식별자나 민감 데이터는 남기지 않습니다. 대신 tenant hash, endpoint, class, budget decision을 남기면 운영 판단에 충분합니다.

### 3) 차단 기준은 429와 503을 분리한다

예산 초과 응답은 원인을 구분해야 합니다.

- 특정 사용자, API key, tenant가 자기 예산을 넘김: **429**
- 시스템 전체가 포화되어 정상 요청도 보호해야 함: **503**
- 요청 자체가 너무 큰 형태로 들어옴: **413** 또는 **422**
- deadline이 이미 지나 의미 없는 요청: **408/499 계열 관측 + 빠른 중단**

429에는 `Retry-After`, 남은 quota 또는 다음 window를 알려주는 헤더가 필요합니다. 503에는 클라이언트가 짧은 즉시 재시도를 반복하지 않도록 backoff 힌트가 필요합니다. 둘을 섞으면 클라이언트가 잘못 재시도하고 서버 부하가 커집니다.

### 4) 도입 순서는 측정, 경고, 제한, 자동 조정이다

권장 rollout은 4단계입니다.

1. **측정 전용 2주**: cost unit을 계산하되 차단하지 않습니다.
2. **경고 2주**: budget 120% 초과 요청을 로그와 대시보드에 표시합니다.
3. **부분 제한 2주**: payload, pagination, 외부 호출 같은 안전한 항목부터 제한합니다.
4. **자동 조정**: tenant별 예산, degraded path, admission control을 traffic pattern에 맞춰 조정합니다.

처음부터 강하게 막으면 실제 사용자 흐름을 깨기 쉽습니다. 반대로 측정만 오래 하면 정책이 장식이 됩니다. 6주 안에 최소 하나의 실제 제한 정책까지 가는 것이 좋습니다.

## 트레이드오프/주의점

첫째, cost unit은 완벽한 원가 모델이 아닙니다. CPU, DB, 네트워크, 외부 API 비용을 하나의 점수로 합치면 단순화가 생깁니다. 그래도 아무 기준 없이 QPS만 보는 것보다는 낫습니다.

둘째, 예산이 너무 낮으면 제품 기능이 빈약해집니다. 특히 검색, 추천, 리포트처럼 결과 품질이 중요한 API는 partial response가 사용자 신뢰를 떨어뜨릴 수 있습니다. 이런 API는 degraded 응답에 `generated_at`, `partial`, `omitted_fields` 같은 표시를 넣어야 합니다.

셋째, tenant budget은 영업 정책과 충돌할 수 있습니다. 대형 고객이 더 많은 자원을 쓰는 것은 자연스러울 수 있습니다. 그래서 technical budget과 contract tier를 연결해야 합니다. 무료/기본/엔터프라이즈 tier별로 burst, sustained budget, batch window를 다르게 두는 편이 현실적입니다.

넷째, budget 초과를 모두 에러로 보면 개발자가 우회합니다. 좋은 운영은 차단 수보다 **degraded 성공률**, **budget 초과 후 재시도율**, **tenant별 공정성 개선**을 봅니다.

다섯째, resource budget은 코드만으로 끝나지 않습니다. 제품 요구, SLO, 인프라 비용, 고객 등급, 장애 대응 기준이 같이 들어갑니다. 소유자가 불명확하면 금방 오래된 숫자가 됩니다.

의사결정 우선순위는 **시스템 생존 > interactive 사용자 경험 > 데이터 정합성 > tenant 공정성 > 인프라 비용 > 부가 기능 완성도**입니다. 장애 상황에서는 이 순서가 특히 중요합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 핵심 API 10개의 p95 latency, DB query count, external call count, response size를 알고 있다.
- [ ] endpoint별 request cost unit 기준이 문서화돼 있다.
- [ ] tenant별 budget과 system-wide admission control을 구분한다.
- [ ] budget 초과 시 429, 503, partial response, async 전환 기준이 분리돼 있다.
- [ ] budget decision이 structured log 또는 trace에 남는다.
- [ ] retry 정책이 request budget을 초과하지 않도록 제한돼 있다.
- [ ] budget 초과 알림은 에러율뿐 아니라 degraded path 사용률과 같이 본다.

### 연습

1. 최근 장애 또는 latency 이슈가 있었던 API 1개를 골라 `DB query count`, `external call count`, `response_bytes`, `retry_count`의 p95를 계산해 보세요.
2. 그 API의 기본 budget을 100점으로 두고 DB, 외부 호출, payload, retry가 각각 몇 점을 쓰는지 가중치를 만들어 보세요.
3. budget 120% 초과 시 "무조건 실패"가 아니라 "어떤 필드를 생략할지", "어떤 호출을 캐시로 대체할지", "언제 async job으로 보낼지"를 표로 정리해 보세요.
4. 상위 tenant 5곳의 1시간 단위 cost unit 사용량을 비교해, 한 tenant가 전체의 30%를 넘는 구간이 있는지 확인해 보세요.

API Resource Budgeting의 목적은 개발자를 괴롭히는 제한표를 만드는 것이 아닙니다. 요청 하나가 실제로 무엇을 소비하는지 드러내고, 시스템이 바쁠 때 어떤 일을 먼저 살릴지 합의하는 것입니다. QPS와 평균 latency만 보는 팀은 장애를 늦게 발견합니다. 요청 비용을 보는 팀은 장애가 오기 전에 무거운 흐름을 줄일 수 있습니다.

## 관련 글

- [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)
- [Admission Control과 Concurrency Limits](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [종단간 Deadline Budget과 Cancellation Propagation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
