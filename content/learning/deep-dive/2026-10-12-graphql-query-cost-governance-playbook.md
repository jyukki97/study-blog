---
title: "GraphQL 요청 비용을 운영하는 법: 복잡도 모델·중첩 제한·실행 예산 플레이북"
date: 2026-10-12T10:06:00+09:00
lastmod: 2026-10-12T10:06:00+09:00
draft: false
tags: ["GraphQL", "API Security", "Query Cost", "Performance", "Backend"]
categories: ["Backend", "API"]
series: "백엔드 딥다이브"
keywords: ["GraphQL query complexity", "GraphQL 비용 제한", "query depth", "resolver budget"]
description: "GraphQL 요청을 단순 depth 제한이 아닌 예측 비용·실행 예산·관찰 지표의 계약으로 운영해 정상 사용자를 막지 않고 과부하를 줄이는 방법을 정리합니다."
summary: "GraphQL의 위험은 중첩 단계 수만이 아니라 목록 fan-out, resolver의 I/O, 권한별 데이터 범위에서 나온다. 스키마별 비용 모델과 역할별 예산, 실행 시간 제한을 함께 운영해야 한다."
---

GraphQL은 클라이언트가 필요한 필드를 정확히 요청하게 해 API 왕복을 줄여 줍니다. 반대로 하나의 endpoint에서 관계를 자유롭게 조합할 수 있으므로, 서버가 예상하지 못한 읽기 증폭도 만들 수 있습니다. `users → orders → lineItems → product`처럼 각 단계가 목록인 질의는 텍스트로는 짧아도 수천 번의 resolver 호출과 DB 조회를 유발할 수 있습니다. 최대 depth만 5로 정하는 방식은 재귀적 질의를 일부 막지만, 얕고 넓은 목록 질의나 비싼 외부 API resolver는 놓칩니다.

이 글은 [GraphQL 심화의 스키마·N+1 기초](/learning/deep-dive/deep-dive-graphql-advanced/), [persisted operation registry](/learning/deep-dive/deep-dive-graphql-operation-registry-persisted-query-playbook/), [API resource budget 설계](/learning/deep-dive/deep-dive-api-resource-budgeting/)를 이어서 다룹니다. 목표는 클라이언트의 표현력을 임의로 줄이는 것이 아니라 요청 전 비용을 추정하고 실행 중에도 예산을 지키는 **운영 계약**을 만드는 것입니다.

## 이 글에서 얻는 것

- depth, field 수, query cost, 실제 I/O 비용이 서로 다른 이유를 구분합니다.
- 목록 인자와 resolver 특성을 반영한 스키마 비용 모델을 설계할 수 있습니다.
- 익명·일반 사용자·관리자·내부 배치에 같은 한도를 적용하지 않는 기준을 세웁니다.
- observe → warn → enforce 순서로 제한을 도입하고 정상 기능 회귀를 확인하는 방법을 배웁니다.

## 핵심 개념/이슈

### 1) 깊이는 신호일 뿐, 실행 비용 자체는 아니다

다음 두 질의를 비교해 봅시다. 첫 번째는 깊이가 4이지만 단건 관계와 DataLoader만 사용한다면 비교적 싸게 끝날 수 있습니다. 두 번째는 깊이가 2여도 `first: 500` 아래에서 분석 저장소를 조회하면 DB와 downstream API를 동시에 압박합니다.

```graphql
query AccountView { account(id: "a-1") { owner { organization { plan { name } } } } }
query Dashboard { projects(first: 500) { nodes { riskScore monthlyUsage } } }
```

따라서 request gate는 최소 네 가지 신호를 따로 봐야 합니다.

| 신호 | 잡아내는 문제 | 한계 | 시작 기준 예시 |
| --- | --- | --- | --- |
| depth | 재귀적 중첩과 비정상 탐색 | 얕고 넓은 fan-out을 놓침 | public 8, 내부 12부터 관찰 |
| field/alias 수 | 한 요청의 과도한 병렬 작업 | field별 비용 차이를 모름 | alias 20개 초과를 warn |
| 정적 cost | 스키마상 예상 fan-out | cache hit와 권한 범위를 모름 | 역할별 200~2,000 point |
| 실행 budget | 실제 DB·원격 I/O·CPU 점유 | 사전 거절에는 늦음 | deadline·DB 수·response bytes 병행 |

숫자는 보편적 정답이 아닙니다. 모바일 BFF의 정상 목록 크기가 20이고 dashboard API는 200일 수 있습니다. p99 정상 요청이 180 point인데 200에서 차단하면 제품 기능을 공격으로 오인할 가능성이 큽니다. 차단 규칙을 정하기 전에 operation name, client type, actor role, depth, alias 수, 예상 cost, 실제 latency를 최소 7일 수집하세요.

### 2) 비용 모델은 field 이름이 아니라 fan-out과 I/O 경로를 반영한다

모든 field를 1 point로 두면 `id`와 원격 결제 provider를 호출하는 `availableCredit`을 같은 것으로 취급합니다. 반대로 과도하게 정교한 모델은 스키마 변경 때 유지되지 않습니다. 처음에는 비용 차이가 큰 field와 목록만 분리해도 충분합니다.

```text
base_cost(field) = 1
projects(first: n) = 2 + min(n, 100) * child_cost
riskScore = 25                 # 분석 저장소 또는 원격 계산
monthlyUsage = 10              # 집계 테이블 조회
auditEvents(first: n) = 5 + min(n, 50) * child_cost
```

목록 인자는 반드시 hard maximum을 검증한 뒤 계산합니다. client가 `first: 1000000`을 보내면 validation 단계에서 오류를 반환하고, 서버가 임의로 잘라 일부 결과만 돌려주지 않는 편이 낫습니다. 결과 일부가 나왔는지 client가 구분하지 못하면 pagination 의미가 깨지기 때문입니다. [cursor pagination의 일관성](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)처럼 limit은 성능 옵션이 아니라 API 결과의 일부입니다.

또한 cost가 낮다고 안전한 것은 아닙니다. `reportExport`처럼 job을 생성하는 mutation은 field 수와 무관하게 위험합니다. mutation에는 정적 point와 별도로 idempotency key, 대상 범위, tenant별 동시 실행 수, 하루 생성량을 검증해야 합니다. 오래 걸리는 작업을 request path에 숨기지 말고 [비동기 request-reply 작업의 resource 계약](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)으로 옮기는 것이 낫습니다.

### 3) 사전 추정과 실제 실행 예산은 서로를 보완한다

정적 cost gate는 저렴하게 위험한 shape를 초기 거절하지만 cache hit, DB plan 변화, 외부 dependency 지연은 알 수 없습니다. 실행 중에는 resolver 수, DB query 수·시간, downstream call 수, response bytes, end-to-end deadline을 별도 예산으로 강제해야 합니다. 예를 들어 cost 140이 허용 범위여도 DB query가 80개를 넘거나 남은 deadline이 30ms 미만이면 새 resolver를 시작하지 않을 수 있습니다.

부분 응답을 허용할지는 field 중요도에 따라 다릅니다. 잔액·권한·주문 상태처럼 빈 값이 위험한 field는 전체 오류가 정직할 수 있습니다. 추천 위젯은 `extensions.degraded=true`와 함께 생략할 수 있습니다. 어느 쪽이든 timeout을 성공처럼 보이게 하지 말고, data freshness와 오류 의미를 client 계약으로 남겨야 합니다.

## 실무 적용

### 1) 비용 inventory와 정상 분포를 먼저 만든다

첫 주에는 차단하지 말고 operation name 또는 registry ID, actor role, estimated cost, DB query 수, response bytes를 남깁니다. query 원문에는 개인정보나 business filter가 들어갈 수 있으므로 canonicalized hash를 기본 식별자로 쓰고, 원문은 짧은 보존 기간의 승인된 debugging 경로로 분리합니다. 이름 없는 anonymous query는 별도 집계하세요. 소유자와 release version에 연결할 수 없다면 비용 회귀를 고치기 어렵습니다.

| 등급 | 조건 예시 | 배포 전 확인 | production 정책 |
| --- | --- | --- | --- |
| A | cost 200 이하, 단일 DB read | integration test | 기본 허용, 지표 수집 |
| B | cost 201~800, 목록·집계 포함 | representative data p95 | 역할별 quota·timeout |
| C | cost 800 초과, 외부 호출·대량 export | owner 승인·load test | registry-only 또는 async 전환 |

### 2) 역할이 아니라 위험 조합으로 예산을 배정한다

"관리자니까 무제한"은 안전한 정책이 아닙니다. 관리자 계정 탈취, support 도구의 실수, 백오피스 batch도 서버에는 같은 부하입니다. actor, operation class, tenant 규모를 함께 사용하세요. 시작 예로 public read는 cost 250과 분당 30회, authenticated dashboard는 cost 1,000과 동시 4개, export mutation은 tenant당 동시 1개로 둘 수 있습니다. 실제 p99와 업무 우선순위를 보고 조정해야 합니다.

한도 초과 응답은 안정적인 오류 코드와 재시도 가능 여부를 포함해야 합니다. `QUERY_COST_EXCEEDED`는 client가 page size를 낮추거나 operation을 나눌 수 있게 하고, `EXECUTION_BUDGET_EXHAUSTED`는 서버 지연 또는 예상 밖 I/O를 뜻하게 분리합니다. validation 오류에 즉시 retry하면 방어 규칙이 부하 증폭기가 됩니다. [API 오류의 retryability contract](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)를 적용해 retry와 사용자 수정이 필요한 경우를 구별하세요.

### 3) observe → warn → enforce를 실패 이유별로 진행한다

1. **observe(최소 7일)**: 상위 cost operation 20개와 client별 p99를 확인합니다. 아직 차단하지 않습니다.
2. **warn(1~2주)**: p99의 1.5배 이상 요청에 response extension과 dashboard 경고를 붙이고 owner에게 비용 구성을 전달합니다.
3. **enforce-canary**: anonymous traffic 또는 client 1~5%부터 적용합니다. `QUERY_COST_EXCEEDED`가 정상 요청의 0.1%를 넘거나 checkout·login operation이 한 건이라도 막히면 확대를 중단합니다.
4. **enforce**: 신규 field에 default cost와 owner를 요구하고, 매월 p99와 override를 재검토합니다.

성공 지표는 차단 건수가 아닙니다. resolver p95, DB pool 대기, 5xx, client retry rate, 핵심 전환율이 함께 안정돼야 합니다. 비용이 큰 query를 막아 CPU는 줄었지만 client가 세 번 나누어 호출해 egress와 지연이 늘었다면 정책은 실패입니다. [query plan 회귀 감시](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)처럼 변경 전후 workload를 비교하세요.

## 트레이드오프/주의점

첫째, query cost는 돈이나 CPU 시간을 정확히 예언하는 회계 장부가 아니라 통계적인 위험 점수입니다. cache hit가 많은 field를 과대평가하거나 특정 tenant의 큰 목록을 과소평가할 수 있습니다. 분기마다 상위 operation의 estimated cost와 실제 DB 시간의 상관관계를 보고, 차이가 큰 field만 보정하세요.

둘째, depth 제한은 여전히 필요하지만 유일한 방어선이 아닙니다. fragment cycle 검증, request size 제한, parser time limit, per-client rate limit, resolver deadline이 함께 있어야 합니다. DataLoader도 요청 안의 중복 key를 묶어 줄 뿐, 무한 목록이나 무거운 aggregate를 무료로 만들지 않습니다. cache key에는 tenant와 권한을 포함하고 request 범위를 넘어 재사용하지 않는지 점검하세요.

마지막으로 고비용 operation을 막는 대신 page를 작게 만들면 사용성 문제가 남습니다. 사용자가 정말 대량 데이터를 필요로 한다면 async export, pre-aggregated read model, 필터 강제, 권한 있는 batch job으로 흐름을 바꾸는 것이 낫습니다.

## 체크리스트 또는 연습

### production 체크리스트

- [ ] operation name 또는 registry ID, client type, actor role별 depth·alias·estimated cost·실행 지표를 수집한다.
- [ ] 목록 field의 hard maximum과 비용 multiplier를 문서화하고 상한 초과를 조용히 절단하지 않는다.
- [ ] 외부 호출·대량 집계·export mutation은 별도의 동시성·idempotency·async 정책을 가진다.
- [ ] 익명·인증·관리자·내부 client의 budget을 위험 조합으로 나누고 관리자 무제한을 기본값으로 두지 않는다.
- [ ] cost 초과와 실행 budget 초과를 다른 오류 코드·telemetry로 기록한다.
- [ ] observe 기간의 p99을 검토한 뒤 warn과 canary를 거쳐 enforce한다.
- [ ] 차단 후에도 core conversion, retry rate, DB pool wait, response bytes가 악화되지 않는지 비교한다.

### 연습: 새 dashboard query의 비용 계약 작성하기

`projects(first: 50)` 아래에 `riskScore`, `monthlyUsage`, `openIncidents(first: 20)`를 추가한다고 가정해 봅시다. 세 field 중 외부 I/O가 있는 것, 목록 multiplier가 필요한 것, cache hit에 따라 실제 비용이 흔들리는 것을 나눠 보세요. 일반 사용자의 p99 비용이 320 point라면 400, 600, 1,000 중 어떤 budget으로 observe를 시작할지 이유를 적습니다. 마지막으로 DB query가 60개를 넘었을 때 field를 생략할지 전체 오류로 할지, 그리고 client가 안전하게 행동할 오류 코드를 정해 보세요. 수치를 고정하는 것보다 그 수치가 어떤 과업을 보호하고 어떤 실패를 막는지 설명할 수 있는지가 좋은 비용 계약의 기준입니다.
