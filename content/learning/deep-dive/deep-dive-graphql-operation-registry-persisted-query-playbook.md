---
title: "백엔드 커리큘럼 심화: GraphQL Operation Registry와 Persisted Query, 자유 쿼리를 운영 가능한 계약으로 바꾸는 법"
date: 2026-09-09T10:06:00+09:00
lastmod: 2026-09-09T10:06:00+09:00
draft: false
topic: "API Reliability"
tags: ["GraphQL", "Persisted Query", "Operation Registry", "API Security", "Query Cost", "Backend Reliability"]
categories: ["Backend Deep Dive"]
module: "api-platform"
study_order: 1518
keywords: ["GraphQL persisted query", "GraphQL operation registry", "GraphQL query allowlist", "GraphQL query cost limit", "GraphQL production security"]
description: "GraphQL의 유연성을 유지하면서도 operation hash, registry, query cost, 배포 호환성, 관측성을 계약으로 운영하는 실무 플레이북입니다."
summary: "Persisted query의 목적은 요청 본문을 짧게 만드는 데 있지 않습니다. 어떤 쿼리가 누구에게 어느 비용으로 실행되는지 식별하고, schema 변경과 cache·권한·롤백을 함께 통제하는 operation 계약을 만드는 데 있습니다."
key_takeaways:
  - "APQ와 persisted-query allowlist는 다릅니다. 전자는 전송 최적화가 될 수 있지만, 후자는 미등록 operation을 거부해 실행 표면을 줄이는 정책입니다."
  - "query depth 하나로 비용을 판단하면 안 됩니다. list multiplier, resolver fan-out, tenant 범위, cache miss, downstream 호출을 함께 비용 모델에 넣어야 합니다."
  - "operation hash는 배포 artifact와 함께 versioned registry에 남기고, schema·권한·cost diff를 검토한 뒤 canary로 활성화해야 합니다."
operator_checklist:
  - "외부 클라이언트는 operation name과 hash를 반드시 보내고, allowlist 전환 전에는 unknown operation을 관측 모드로 수집한다."
  - "각 operation에 owner, client, auth scope, max cost, 최대 응답 크기, cache 정책, 폐기일을 둔다."
  - "새 registry는 staging -> 5% client -> 24시간 -> 전체 순서로 올리고, unknown hash·reject·p95·resolver error·cache hit을 비교한다."
learning_refs:
  - title: "GraphQL 스키마 설계"
    href: "/learning/deep-dive/deep-dive-graphql-schema-design/"
    description: "type, resolver, N+1, schema evolution의 기본을 먼저 확인합니다."
  - title: "API Rate Limit과 Backpressure"
    href: "/learning/deep-dive/deep-dive-api-rate-limit-backpressure/"
    description: "요청 수가 아닌 작업 비용을 tenant·endpoint budget으로 나누는 기준입니다."
  - title: "API Response Compatibility Contract"
    href: "/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/"
    description: "클라이언트가 의존하는 응답·오류 의미를 버전 계약으로 관리합니다."
  - title: "구조화 로깅 실무"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "operation ID, cost, outcome을 민감정보 없이 추적하는 방법입니다."
---

GraphQL은 클라이언트가 필요한 필드를 고를 수 있게 해 BFF와 복합 화면에서 강력합니다. 그러나 운영 환경의 서버는 "유효한 GraphQL 문서면 무엇이든 실행"하는 인터프리터가 아닙니다. 같은 `/graphql` endpoint로 들어와도 어떤 요청은 프로필 한 건을 읽고 끝나지만, 어떤 요청은 중첩 목록과 여러 resolver를 타며 DB·검색·외부 API를 동시에 압박합니다. 쿼리 문자열만 보고 cache key를 만들고, depth만 세어 제한하고, 오류가 나면 전체 query를 로그에 남기는 방식은 규모가 커질수록 비용·보안·개인정보 문제를 같이 키웁니다.

이 글은 [GraphQL 스키마 설계](/learning/deep-dive/deep-dive-graphql-schema-design/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/), [API Response Compatibility Contract](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/), [구조화 로깅 실무](/learning/deep-dive/deep-dive-structured-logging/)을 이어서 읽는 운영 글입니다. 앞선 글이 schema와 resolver의 기본을 다뤘다면, 여기서는 **배포된 operation을 registry로 식별하고, 실행 비용과 권한을 심사하며, 안전하게 폐기하는 방법**을 정리합니다.

## 이 글에서 얻는 것

- APQ(Automatic Persisted Query), hash 기반 조회, allowlist를 구분하고 공개 API에 어떤 정책을 둘지 판단할 수 있습니다.
- operation hash만 저장하는 수준을 넘어 owner·권한·cost·응답 크기·만료일을 가진 registry를 설계할 수 있습니다.
- depth, list fan-out, resolver 호출, cache miss를 합친 비용 한도와 tenant별 예산을 정할 수 있습니다.
- schema 변경 뒤 unknown hash, stale client, 캐시 오염, 권한 우회를 관측하고 rollback하는 절차를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Persisted query는 두 문제를 풀 수 있고, 둘을 혼동하면 안 된다

클라이언트가 query 전문 대신 `sha256(query)`를 보내고 서버가 이미 아는 문서를 찾아 실행하는 패턴을 persisted query라고 부릅니다. 여기에는 서로 다른 목적이 섞이기 쉽습니다.

| 방식 | 서버의 미등록 query 처리 | 주된 목적 | 공개 API 기본값 |
| --- | --- | --- |
| APQ fallback | hash miss 때 query 전문 등록을 허용 | 초기 요청 왕복·전송량 감소 | 관측 후 제한적으로 사용 |
| hash registry | 배포된 hash에서 문서·메타데이터 조회 | cache·관측성·배포 추적 | 권장 |
| strict allowlist | 등록되지 않은 hash를 거부 | 실행 표면·비용·권한 통제 | 인터넷 노출 client에 권장 |

APQ는 성능 최적화일 수 있지만 보안 정책은 아닙니다. hash miss에서 query 전문을 받아 자동 등록하면 새 문법의 요청도 결국 실행됩니다. 반대로 strict allowlist는 서버가 미리 검토한 operation만 실행하게 합니다. 모바일 앱, 외부 partner, 대규모 SPA처럼 배포 경로를 통제할 수 있는 client라면 기본값을 allowlist로 두는 편이 낫습니다. GraphQL IDE, 내부 분석 도구, 로컬 개발처럼 탐색이 필요한 surface만 별도 endpoint 또는 별도 role로 raw query를 허용합니다.

이 구분은 [API Key Lifecycle과 권한 회전](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)의 원칙과 같습니다. "인증된 클라이언트"라는 사실만으로 모든 실행 형태를 허용하지 말고, client 종류와 책임에 따라 capability를 작게 나눕니다.

### 2) registry는 hash 사전이 아니라 배포된 API 계약의 목록이다

`hash -> query text` 테이블만 있어도 네트워크 전송은 줄일 수 있습니다. 하지만 운영에서 필요한 질문에는 답하지 못합니다. 이 operation은 어느 화면이 쓰는가, 어떤 scope가 필요한가, 목록이 폭증할 때 어디까지 허용하는가, 어느 schema version에서 폐기되는가, 왜 15분 전에 비용이 두 배가 되었는가를 알 수 있어야 합니다.

registry에는 최소한 다음 필드를 둡니다.

```yaml
operation:
  id: "sha256:8b3d..."
  name: "OrderHistoryPage"
  kind: "query"
  client: "web"
  owner: "commerce-web"
  schema_version: "2026-09-09.3"
  required_scopes: ["orders:read"]
  max_cost: 180
  max_response_bytes: 524288
  cache_class: "private-30s"
  rollout: "enabled"
  sunset_at: "2026-12-09"
```

여기서 `id`는 문서 정규화 규칙을 고정한 뒤 계산해야 합니다. formatter가 공백을 바꾸거나 fragment 순서가 바뀌면 의미가 같은 문서도 다른 hash가 됩니다. 빌드 단계에서 canonical query artifact를 만들고 그 artifact의 hash를 계산하세요. 서버가 런타임에 임의로 재정렬한 문서를 hash 기준으로 삼으면 web·iOS·Android가 서로 다른 ID를 만들기 쉽습니다.

registry의 `schema_version`도 단순 기록이 아닙니다. schema에서 field를 없애거나 nullable 의미를 바꿀 때, 어떤 hash가 아직 해당 field를 참조하는지 찾아야 합니다. 제거 예정 field의 consumer 수가 0이라는 증거 없이 schema를 깨는 일은 [API Response Compatibility Contract](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)에서 금지하는 silent breaking change와 같습니다.

### 3) depth 제한만으로는 비싼 query를 막지 못한다

`maxDepth=8`은 필요한 안전망이지만 충분하지 않습니다. depth가 3인 query라도 `orders(first: 100) { items(first: 100) { product { reviews(first: 50) } } }`처럼 list가 겹치면 resolver 수가 폭증할 수 있습니다. 반대로 깊이가 10이어도 singleton field만 따라가는 관리 화면 query는 실제 비용이 작을 수 있습니다.

처음에는 복잡한 비용 엔진보다 다음 네 요소를 합산하는 방식이 실용적입니다.

1. scalar·object field의 base cost
2. list field의 기본 page size와 client가 요청한 `first`의 multiplier
3. DB batch, 검색, 외부 HTTP처럼 fan-out이 생기는 resolver penalty
4. private cache hit/miss와 tenant 범위에 따른 추가 비용

예를 들어 `orders`의 base cost가 5, page size 20의 multiplier가 20, `items`가 3, `product`가 2라면 예상 cost는 `5 + 20 * (3 + 2)`처럼 계산할 수 있습니다. 정확한 절대값보다 중요한 것은 **같은 operation의 비용을 release 전후 비교할 수 있는가**입니다. DataLoader를 빼먹어 DB query 수가 20배가 됐는데 schema가 같다는 이유로 registry cost를 그대로 두면, limit은 있으나 사고를 막지 못합니다.

### 4) 권한은 operation 단위와 field 단위를 함께 본다

registry의 `required_scopes`만 검사하면 간단해 보이지만, 동일 operation 안에 admin만 볼 field와 일반 사용자가 볼 field가 섞일 수 있습니다. 반대로 field authorization만 두면 expensive operation이 반복 실행되는 것을 API gateway에서 빠르게 막기 어렵습니다. 둘 중 하나를 고르는 문제가 아닙니다.

- **operation guard**: client 종류, operation ID, coarse scope, cost budget, introspection 허용 여부를 request 초기에 검사합니다.
- **field guard**: tenant membership, resource ownership, row-level policy, 민감 field 마스킹을 resolver 또는 policy layer에서 검사합니다.
- **response guard**: 오류가 난 field와 전체 operation의 실패 의미를 표준화하고, forbidden field가 cache에 섞이지 않게 private cache key를 분리합니다.

특히 `viewer` 같은 현재 사용자 기반 query는 shared CDN cache에 그대로 올리면 안 됩니다. operation hash는 같은데 권한 결과가 다른 경우가 있으므로 `Authorization`·tenant·role을 cache variance에 안전하게 반영하거나, 기본 private cache로 둬야 합니다.

## 실무 적용

### 1) build에서 registry artifact를 만들고, 서버는 읽기 전용으로 사용한다

가장 안정적인 흐름은 client build가 operation 문서와 registry manifest를 생성하고, schema validation·cost analysis·권한 lint를 통과한 artifact만 서버에 배포하는 것입니다. production 서버가 첫 요청을 받고 hash를 등록하게 두면 누가 어떤 query를 배포했는지 추적하기 어렵습니다.

```text
client query source
  -> schema validation + fragment expansion
  -> canonical document + SHA-256
  -> cost / scope / owner manifest
  -> CI review and signed registry artifact
  -> registry publish
  -> server allowlist lookup
```

서버 request 흐름은 단순하게 유지합니다.

1. client ID, tenant, operation ID, variables 크기를 확인합니다.
2. registry에서 operation을 찾고 enabled 여부·client binding·최대 variable 크기를 검사합니다.
3. coarse scope와 precomputed max cost를 통과한 경우에만 parse·execute합니다.
4. runtime에는 actual cost, resolver 수, DB query 수, cache hit, response bytes를 기록합니다.
5. 결과·오류 code·registry version을 audit event로 남깁니다.

query 전문과 variables를 application log에 기본 기록하지 마세요. 이메일, 검색어, 계좌 식별자, access token이 variables에 들어갈 수 있습니다. [구조화 로깅 실무](/learning/deep-dive/deep-dive-structured-logging/)처럼 `operation_id`, `operation_name`, `client`, `tenant_bucket`, `predicted_cost`, `actual_latency_ms`, `outcome`만 기본 allowlist로 잡고, 조사 시에도 승인된 redacted sample만 사용합니다.

### 2) 숫자 기준을 먼저 작게 고정한다

아래 값은 모든 서비스의 정답이 아니라 첫 canary를 위한 출발점입니다. 숫자보다 더 중요한 것은 reject와 비용 증가가 발생했을 때 owner가 누구이며, 어떤 경로로 낮출지 정해 두는 일입니다.

| 항목 | 시작 gate | 넘었을 때의 우선 조치 |
| --- | --- | --- |
| public client raw query | 14일 관측 뒤 0% 허용 | allowlist 전환, 개발용 endpoint 분리 |
| unknown operation hash | 전체 요청의 0.05% 미만 | stale client·배포 순서 확인, 즉시 auto-register 금지 |
| maximum depth | 8 | depth 예외보다 list multiplier·resolver fan-out 재설계 |
| predicted query cost | 일반 200, admin 500 이하 | pagination 축소 또는 async export로 분리 |
| variables body | 64KB 이하 | 파일·대량 filter는 object storage 또는 job API로 분리 |
| p95 GraphQL latency | 기존 baseline 대비 +10% 이내 | registry rollback, DB query plan·N+1 점검 |
| DB query count | operation별 baseline 대비 +20% 이내 | DataLoader/배치화 또는 cost 상향 후 재승인 |

API별 cost 한도는 tenant fairness와도 연결됩니다. 하나의 enterprise tenant가 정상 범위의 10배 query budget을 계속 쓰면 다른 tenant의 p95가 흔들립니다. [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/)처럼 request 수, predicted cost, 실제 DB time을 함께 tenant bucket에 차감하고, 초과하면 `429`와 retry-after 또는 더 작은 page size를 안내하는 편이 `503`으로 전체를 쓰러뜨리는 것보다 낫습니다.

### 3) allowlist는 shadow mode에서 시작한다

기존 앱에 strict allowlist를 한 번에 켜면 오래된 모바일 앱이나 edge cache의 구버전 bundle이 실패할 수 있습니다. 전환은 네 단계가 안전합니다.

1. **inventory**: 7~14일 동안 raw query, hash, client version, operation name, 실행 비용을 수집합니다. 전문은 저장하지 않습니다.
2. **shadow**: registry miss를 응답에서는 허용하되 `would_reject=true`로 계측합니다. unknown hash가 0.05% 아래로 내려가는지 봅니다.
3. **canary**: web traffic 5% 또는 최신 모바일 버전에서만 miss를 `PERSISTED_QUERY_NOT_FOUND`로 거부합니다.
4. **enforce**: 24시간 동안 p95, error rate, auth failure, customer support signal이 기준 이내면 client class별로 확대합니다.

rollback은 raw query를 전체 공개하는 스위치가 아닙니다. 먼저 직전 registry artifact로 되돌리고, 불가피할 때만 특정 client·특정 operation에 만료 시간 있는 예외를 둡니다. 예외는 owner, 사유, `expires_at`을 남기고 7일 안에 정리해야 합니다. 영구적인 bypass는 결국 allowlist의 의미를 없앱니다.

### 4) schema 배포와 registry 배포의 순서를 명시한다

새 field를 쓰는 operation을 먼저 등록하고 server schema가 아직 없으면 validation error가 납니다. 반대로 기존 field를 먼저 삭제하면 살아 있는 hash가 모두 깨집니다. 그래서 expand/contract 순서를 지킵니다.

1. schema에 additive field 또는 새 resolver를 추가하고, 기존 field는 유지합니다.
2. 새 schema를 포함하는 registry artifact를 canary client에만 활성화합니다.
3. old operation의 사용량이 0이고 최소 지원 client version이 지났음을 확인합니다.
4. registry에서 old operation을 `deprecated`, 그다음 `disabled`로 바꿉니다.
5. 마지막으로 schema field와 resolver를 제거합니다.

이 순서는 API version 숫자를 늘리지 않아도 consumer evidence를 남깁니다. `deprecated` 상태의 operation이 여전히 호출되면 서버가 그 client version과 owner를 알려 주어야 하며, 단순히 "한 달 뒤 삭제"라고 문서에 쓰고 끝내면 안 됩니다.

## 트레이드오프/주의점

첫째, allowlist는 생산성을 낮출 수 있습니다. 개발자가 GraphQL explorer에서 즉석 query를 실행하고 운영자가 incident 중 field를 탐색하는 흐름은 느려집니다. 그래서 운영 API를 전부 막기보다, 내부 전용 explorer를 강한 SSO·짧은 권한·감사 로그와 함께 분리하는 편이 낫습니다. production public endpoint의 안전성과 개발 편의성을 하나의 정책으로 해결하려 하면 둘 다 나빠집니다.

둘째, static cost는 실제 비용을 완전히 예측하지 못합니다. 동일한 `orders(first: 20)`도 특정 tenant가 훨씬 큰 row 또는 느린 권한 확인을 가질 수 있습니다. static cost로 사전 차단하고, runtime DB time·response bytes·downstream call을 추가 관측해 다음 registry diff에 반영하세요. cost를 과신해 200 이하라고 안전하다고 선언하지 않는 것이 중요합니다.

셋째, hash는 비밀값이 아닙니다. SHA-256 query ID를 URL이나 로그에서 보이지 않게 할 필요는 없지만, hash를 안다고 해서 권한이 생겨서는 안 됩니다. hash를 authorization token처럼 쓰거나, role이 다른 응답을 같은 shared cache에 보관하는 설계는 위험합니다.

넷째, registry 자체가 새 배포 의존성이 됩니다. registry backend가 느리거나 내려가면 모든 API가 막힐 수 있습니다. 서버 시작 시 versioned artifact를 로컬 메모리에 로드하고, 명시적으로 검증된 마지막 버전을 일정 시간 유지하는 fail-safe를 둘 수 있습니다. 다만 운영자가 어느 registry version으로 실행 중인지 알 수 있어야 하며, stale artifact를 무기한 허용해서는 안 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] public GraphQL client는 operation name·hash·client version을 보내며, raw query 허용 surface가 분리되어 있다.
- [ ] registry는 hash 외에 owner, client binding, scope, schema version, cost, cache class, sunset date를 가진다.
- [ ] hash miss를 자동 등록하지 않고 shadow mode 지표를 거쳐 allowlist를 강화한다.
- [ ] depth, list multiplier, resolver fan-out, runtime DB time을 함께 비용 모델로 본다.
- [ ] `viewer`·tenant별 결과가 shared cache key에 섞이지 않는다.
- [ ] query 전문과 raw variables는 기본 로그에서 제외하고, operation ID 중심으로 관측한다.
- [ ] schema 삭제 전에 해당 field를 쓰는 operation hash와 client 사용량이 0인지 확인한다.
- [ ] registry rollback, 예외 만료, owner 알림의 절차가 런북에 있다.

### 연습

현재 GraphQL 서비스에서 가장 자주 호출되는 화면 query 하나를 고르세요. `operation_id`, owner, 필요한 scope, 최대 page size, predicted cost, DB query baseline, p95 latency, 최대 응답 크기, cache class, sunset date를 한 줄씩 적어 registry 초안을 만듭니다. 그다음 `first=20`을 `first=100`으로 바꿨을 때 비용과 response byte가 어느 gate를 넘는지 계산해 보세요. 이 작은 표가 없다면 persisted query는 아직 전송 최적화일 뿐, 운영 계약은 아닙니다.
