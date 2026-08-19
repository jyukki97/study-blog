---
title: "백엔드 커리큘럼 심화: Authorization-Aware Search, 검색 결과에서 권한 누출을 막는 플레이북"
date: 2026-08-19
draft: false
topic: "Search Architecture"
tags: ["Search", "Authorization", "BOLA", "Elasticsearch", "OpenSearch", "Multi-Tenant", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "검색 인덱스가 원본 권한보다 늦게 바뀌는 환경에서 문서 제목·스니펫·집계·RAG 인용까지 포함한 권한 누출을 막기 위해, query-time filter·권한 전파 SLO·재검증·롤백 기준을 설계하는 방법을 정리합니다."
module: "backend-security"
study_order: 1261
---

검색 기능은 보통 "문서를 빨리 찾게 하는 조회 화면"으로 시작합니다. 하지만 조직 문서, 주문, 고객 티켓, 파일, 관리자 데이터처럼 검색 대상에 권한이 붙는 순간 검색은 보안 경계가 됩니다. 결과 본문을 열 때만 권한을 검사하면 충분해 보이지만, 제목·자동완성·하이라이트 스니펫·문서 개수·facet 집계만으로도 다른 테넌트나 회수된 문서의 존재를 알릴 수 있습니다.

더 어려운 점은 검색 인덱스가 원본 DB의 복사본이라는 데 있습니다. 원본에서 공유가 취소됐어도 인덱스에는 이전 ACL이 남아 있을 수 있고, 권한 서비스의 캐시와 검색 클러스터의 refresh 주기가 겹치면 허용 판단이 서로 다른 시점의 사실을 보게 됩니다. 이 글은 [검색 인덱스 동기화와 무중단 리인덱싱](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/), [Object-Level Authorization과 BOLA 방어](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/), [Authorization Decision Cache 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)를 하나의 요청 경로로 연결합니다.

## 이 글에서 얻는 것

- 검색 응답의 문서 본문만이 아니라 count, suggestion, snippet, aggregation까지 인가 대상이라는 이유를 설명할 수 있습니다.
- tenant·문서 공개 범위·관계 기반 권한을 인덱스와 query에 어떻게 표현할지 선택할 수 있습니다.
- 권한 회수 뒤 인덱스와 캐시의 stale window를 어떤 SLO로 관리할지 숫자로 정할 수 있습니다.
- 키워드 검색과 vector/RAG retrieval에서 후보 생성과 최종 인가를 분리하는 안전한 경로를 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) "열 때 403"은 검색 인가가 아니다

가장 흔한 구현은 검색 엔진에서 관련도 순으로 20개를 받은 뒤, 애플리케이션에서 문서별 권한을 검사하고 허용된 것만 화면에 보이는 방식입니다. 결과 페이지에 보이는 문서 수가 작고 권한 모델도 단순할 때는 동작하지만, 이 구조에는 세 가지 문제가 있습니다.

첫째, 페이지가 비어 보일 수 있습니다. 상위 20개가 전부 권한 없는 문서이면 실제로는 21번째에 볼 수 있는 문서가 있어도 사용자는 "검색 결과 없음"을 받습니다. 다음 페이지를 더 가져와 메우면 지연과 검색 비용이 커지고, 권한 없는 후보가 많다는 사실 자체가 hidden signal이 됩니다. 둘째, `total=1,248`, 부서별 count, 자동완성, 인기 검색어, 하이라이트는 별도 endpoint인 경우가 많아 본문 결과만 필터링하면 그대로 새어 나갑니다. 셋째, 후보를 애플리케이션으로 꺼낸 뒤에 권한을 판단하면 검색 클러스터의 audit trace와 제품의 authorization trace가 끊어집니다.

기본 원칙은 **후보를 만들기 전에 검색 query에 최소 권한 범위를 넣고, 민감한 효과는 최종 응답 직전에 다시 확인한다**입니다. 예를 들어 모든 문서는 `tenant_id`를 반드시 가지며, 조직 문서는 `visibility=ORG`, 개인 문서는 `owner_id`, 공유 문서는 정규화된 `allowed_principal` 또는 policy version을 가질 수 있습니다. 검색 query의 filter는 `tenant_id`를 먼저 닫고, 그 안에서 공개 범위와 관계 조건을 적용합니다. `must` 절에는 키워드·벡터·relevance 조건을, `filter` 절에는 권한 조건을 둬 scoring 비용과 정책 의미를 분리하는 편이 좋습니다.

다만 인덱스의 ACL field를 "모든 role 문자열"로 채우는 것은 장기적으로 위험합니다. 역할 변경, 그룹 확장, 조직 이동이 잦으면 문서마다 재색인해야 할 범위가 폭발하고, old role이 잔류하기 쉽습니다. [RBAC·ABAC·ReBAC 인가 모델](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)처럼 정책의 변동 주기와 관계 수를 먼저 봐야 합니다. tenant와 공개 여부처럼 낮은 변동의 coarse filter는 인덱스에 두고, 민감한 관계나 짧은 유효기간의 grant는 별도 policy decision 또는 final recheck로 두는 분리가 현실적입니다.

### 2) 인덱스의 권한 정보는 원본이 아니라 파생 상태다

검색 인덱스는 빠른 filter를 위한 데이터 제품이지 권한의 source of truth가 아닙니다. 따라서 `document_id`, `tenant_id`, `visibility`, `owner_id`, `acl_epoch`, `source_updated_at`처럼 "어떤 원본 상태를 반영한 문서인가"를 함께 저장해야 합니다. 특히 `acl_epoch` 또는 `policy_version`은 문서 ACL이 마지막으로 계산된 버전을 알려 주므로, 권한 회수 뒤 stale 결과를 탐지하고 재색인·차단 여부를 정하는 근거가 됩니다.

권한 변경의 전파는 일반 텍스트 수정과 같은 우선순위가 아닙니다. 문서 제목 오타가 2분 늦게 반영되는 것은 불편일 수 있지만, 퇴사자 접근 회수나 고객 데이터 비공개 전환이 2분 늦으면 보안 사고가 됩니다. 그래서 이벤트를 최소 두 등급으로 나눕니다.

| 변경 종류 | 인덱스 반영 목표 | 초과 시 처리 | 이유 |
| --- | --- | --- | --- |
| 제목·태그·본문 수정 | p95 2분, p99 10분 | 재시도·backfill | relevance 저하가 주된 영향 |
| 일반 공유 추가·삭제 | p95 30초, p99 2분 | stale 문서 재검증 | 업무 접근성이 영향을 받음 |
| 퇴사·테넌트 이동·법적 비공개 | p95 5초, p99 30초 | 즉시 deny list 또는 search 차단 | 누출 비용이 검색 지연보다 큼 |

숫자는 서비스의 위험도에 따라 조정해야 하지만, "동기화가 언젠가 된다"는 문구로 끝내면 운영할 수 없습니다. 원본 트랜잭션에서 `acl_changed` outbox event를 기록하고, consumer가 인덱스 갱신과 version을 남긴 뒤, 지연·실패·forbidden residual count를 따로 봅니다. 이 흐름은 [CDC lag와 snapshot recovery](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/) 및 [Projection lag와 read model rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)의 운영 방식과 같습니다.

가장 고위험 변경에는 인덱스 전파만 기다리지 않는 fail-closed 장치를 둡니다. 예를 들어 `revoked_subject:{subject_id}` 또는 `blocked_document:{document_id}`를 짧은 TTL의 deny store에 넣고, 검색 gateway가 결과를 반환하기 전에 먼저 확인합니다. deny store가 장애 났을 때도 무조건 허용하면 회수 직후의 경계가 무너집니다. Tier 1 문서에서는 cache miss·dependency timeout을 "조회 불가"로 닫고, 일반 문서는 제한된 stale read를 허용하는 식으로 데이터 등급을 구분해야 합니다.

### 3) count, suggestion, vector 후보도 같은 정책을 따른다

검색 API를 여러 개로 나누면 보안 모델도 쉽게 갈라집니다. 다음 surface는 본문 검색과 같은 `tenant_id`·visibility·ACL filter를 재사용해야 합니다.

- 검색 결과의 `total`, facet, 기간별·부서별 aggregation
- typeahead, 최근 검색, 추천 질의, 인기 문서
- "결과가 너무 많습니다" 같은 힌트와 export 대상 개수
- semantic/vector top-k 후보, reranker 입력, RAG의 source citation

특히 RAG는 "모델이 답변을 생성하기 전에는 사용자에게 문서를 보여 주지 않는다"는 이유로 검색보다 덜 위험하다고 오해하기 쉽습니다. 그러나 권한 없는 chunk가 context에 들어가면 모델은 그 문장을 요약하거나, 존재 여부를 질문받았을 때 간접적으로 노출할 수 있습니다. retrieval query에서 권한 filter를 적용하고, rerank 뒤 상위 N개 문서 ID를 final decision으로 다시 검사한 뒤에만 context를 조립해야 합니다. chunk가 문서보다 세분화돼도 권한은 문서 원본 또는 명시된 segment 정책에 귀속시켜야 하며, chunk text만 복제해 ACL을 잊는 구조는 피해야 합니다.

이중 검사는 모든 요청에 비싼 정책 엔진을 N번 호출하라는 뜻은 아닙니다. 예를 들어 top-k를 50으로 넓혀 받되, query-time filter로 테넌트와 공개 상태를 먼저 제거하고, 최종 5~10개의 document ID만 bulk authorization API로 확인합니다. final recheck 결과가 1건이라도 deny이면 그 문서는 빼고 다음 후보를 채우되, 최대 후보 확장 횟수는 2회처럼 제한합니다. 무한 fill은 공격자가 권한 없는 대량 문서로 검색 비용을 키우는 경로가 됩니다.

### 4) 권한 캐시는 검색 속도보다 회수 시점을 먼저 보장해야 한다

검색 결과마다 policy engine을 호출하면 p99가 악화될 수 있어 decision cache를 쓰고 싶어집니다. 이때 cache key가 `user_id + document_id`만 있으면 tenant, action, share link, policy version이 섞일 수 있습니다. 최소한 `subject`, `tenant`, `action`, `resource`, `policy_version`을 구분하고, allow와 deny의 TTL을 다르게 둡니다. 예를 들어 일반 문서의 allow decision은 15~30초, deny는 5~10초로 시작해도 되지만, 관리자·결제·개인정보 문서는 allow cache를 5초 이하로 낮추거나 권한 이벤트가 발생하면 즉시 evict하는 편이 낫습니다.

캐시 hit율만 보는 것은 부족합니다. 운영 대시보드에는 `decision_cache_age_ms`, `policy_version_mismatch`, `revocation_to_search_block_ms`, `search_filter_reject_count`를 분리해서 둡니다. 권한 변경 후 인덱스가 아직 이전 version인데 final recheck가 deny한 비율은 보안 장치가 실제로 막은 stale window의 크기입니다. 이 값이 계속 높다면 final recheck를 더 넓히기보다 ACL event consumer, bulk update, 재색인 queue의 병목을 고쳐야 합니다.

## 실무 적용

### 1) 요청 경로를 두 단계로 고정한다

안전한 기본 경로는 아래처럼 단순하게 문서화할 수 있습니다.

```text
request(subject, tenant, query, action=search.read)
  -> tenant/visibility/policy-version filter로 후보 검색
  -> top-k 문서 ID의 bulk authorization recheck
  -> 허용 문서만 snippet·facet·citation 생성
  -> audit: query class, policy version, candidate/returned count 기록
```

여기서 `candidate_count`는 내부 telemetry로만 남기고 사용자 응답의 total과 혼동하지 않습니다. 반환 total은 실제로 사용자가 볼 수 있는 결과를 기준으로 계산해야 합니다. exact total 계산이 너무 비싸면 `total_relation=gte`처럼 범위를 표현하거나 "많은 결과"로 닫는 편이, 권한 없는 count를 정확히 보여 주는 것보다 안전합니다.

권한 query filter의 최소 예시는 다음과 같습니다. 실제 DSL은 Elasticsearch, OpenSearch, PostgreSQL full-text, vector database마다 다르지만 **tenant를 첫 조건으로 강제하고, 검색어보다 앞선 filter로 보안 범위를 고정한다**는 원칙은 같습니다.

```json
{
  "bool": {
    "filter": [
      {"term": {"tenant_id": "tenant-a"}},
      {"terms": {"visibility": ["PUBLIC_IN_TENANT", "SHARED"]}},
      {"range": {"acl_epoch": {"gte": 420}}}
    ],
    "must": [{"match": {"body": "계약 갱신"}}]
  }
}
```

`acl_epoch >= 420`은 모든 제품에 그대로 쓸 수 있는 답은 아닙니다. 역할 변경이 그룹별·문서별로 독립적이면 전역 숫자 하나로는 정확하지 않습니다. 이 필드는 stale 탐지 보조 수단으로 사용하고, 진짜 권한 판단은 정책 모델에 맞춘 final recheck 또는 문서별 version으로 보완해야 합니다.

### 2) 도입 우선순위를 데이터 위험도로 정한다

첫 파일럿을 가장 복잡한 ReBAC 전체에 걸면 실패하기 쉽습니다. 우선순위는 **테넌트 교차 노출 차단 → 민감 문서 회수 → 편의 기능 일관성** 순으로 둡니다.

1. **1주차: inventory와 차단선**
   - 검색, typeahead, facet, export, RAG retrieval endpoint를 전부 나열합니다.
   - 모든 query에 `tenant_id` filter가 있는지 로그와 테스트로 확인합니다. 하나라도 없다면 relevance 개선보다 먼저 막습니다.
2. **2주차: 문서 등급과 stale SLO**
   - public, tenant, shared, restricted 네 등급으로 시작하고, 권한 회수 event의 p95/p99 목표를 합의합니다.
   - restricted 문서는 deny store와 final recheck를 강제합니다.
3. **3주차: shadow 비교**
   - 기존 결과와 authorization-aware 결과의 returned count 차이를 관측만 합니다.
   - 차이가 전체 요청의 0.5%를 넘으면 곧바로 강제 전환하지 말고, 누락된 tenant filter·stale ACL·잘못된 policy mapping을 분류합니다.
4. **4주차: 제한된 강제와 회귀 테스트**
   - Tier 1 tenant 또는 문서 유형부터 filter와 final recheck를 켭니다.
   - 다른 tenant, role revoked, share expired, admin support view, index lag를 fixture로 만든 뒤 CI에 넣습니다.

### 3) 승격과 롤백을 수치로 합의한다

검색 보안은 "성능이 조금 느려졌으니 끈다"로 되돌리면 안 됩니다. 성능 보호와 권한 차단을 별도 조건으로 둡니다.

| 지표 | 승격 조건 | 중단·완화 조건 |
| --- | --- | --- |
| 다른 tenant 결과 노출 | 0건 | 1건이라도 확인되면 즉시 해당 surface fail-closed |
| 권한 회수→검색 차단 p99 | restricted 30초 이하 | 60초 초과가 15분 지속하면 consumer/deny store 점검 |
| final recheck timeout | 0.1% 미만 | 1% 초과 시 low-risk만 제한적으로 degrade, restricted는 deny 유지 |
| 검색 p99 | 기존 대비 +15% 이내 | +30%가 10분 지속하면 top-k·bulk API·캐시를 튜닝 |
| shadow 결과 차이 | 원인 분류율 100% | 미분류 차이는 강제 rollout 금지 |

이 수치는 예시입니다. 중요한 것은 security error와 performance error의 우선순위를 뒤집지 않는 것입니다. 민감 데이터의 잘못된 allow는 검색 지연보다 먼저 멈춰야 합니다. [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)의 error budget을 검색 성공률만이 아니라 "forbidden residual 0" 같은 보안 불변식으로 보완하는 이유입니다.

## 트레이드오프/주의점

첫째, 인덱스에 ACL을 많이 복제할수록 query는 빨라질 수 있지만 갱신 fan-out과 저장 비용이 커집니다. 수천 개 그룹에 속한 사용자의 grant를 각 문서에 펼치면 하나의 group change가 대량 reindex가 됩니다. 변동이 낮은 coarse grant만 index filter에 넣고, 변동이 높은 세밀한 관계는 batch recheck로 분리하는 편이 보통 더 안정적입니다.

둘째, post-filtering을 완전히 없애기는 어렵습니다. 법적 hold, 긴급 차단, 외부 policy provider처럼 인덱스가 즉시 알 수 없는 규칙이 있습니다. 이때 post-filter 자체를 금지하는 대신, 그것이 최종 안전망이고 사용자 노출 전에 실행된다는 점, 후보 확장 상한과 timeout 시 fail-closed 규칙을 명확히 해야 합니다.

셋째, 권한이 있는 문서를 "없음"으로 보이게 만드는 응답은 사용자 지원 비용을 올릴 수 있습니다. 외부 사용자에게는 404/빈 결과로 숨기는 것이 안전할 때가 많지만, 권한 요청 기능이 있는 내부 제품에서는 "접근 권한이 필요할 수 있음" 같은 비노출형 안내를 둘 수 있습니다. 단, 그 안내가 특정 문서명이나 존재 여부를 확인해 주어서는 안 됩니다.

마지막으로, 백업 인덱스·analytics warehouse·autocomplete cache·LLM trace도 검색 시스템의 일부입니다. primary search API만 고치고 로그나 evaluation dataset에 원문을 남기면 권한 경계가 다른 곳에서 다시 열립니다. 데이터 보존과 마스킹은 [테스트 데이터 계약·마스킹·synthetic seed](/learning/deep-dive/deep-dive-test-data-contract-masking-synthetic-seed-playbook/)까지 같이 점검해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 검색, suggestion, facet, total, export, RAG retrieval이 같은 tenant·visibility filter를 공유한다.
- [ ] 결과 본문뿐 아니라 제목, snippet, count, aggregation, citation도 권한 검사 범위에 들어간다.
- [ ] 권한 변경 이벤트에 문서 ID, actor/tenant scope, policy 또는 ACL version, 발생 시각이 남는다.
- [ ] restricted 데이터는 권한 회수 후 p99 차단 목표와 fail-closed 경로를 갖는다.
- [ ] top-k 후보는 query-time filter 뒤에 생성되고, 최종 반환 문서는 bulk authorization으로 재검증한다.
- [ ] 다른 tenant, revoked user, expired share, stale index, policy timeout을 포함한 회귀 fixture가 있다.
- [ ] `revocation_to_search_block_ms`, forbidden residual, cache age, filter reject를 운영 대시보드에서 분리해 본다.

### 연습 과제

1. 현재 제품의 검색 관련 endpoint를 모두 적고, 각 endpoint가 사용자에게 노출하는 필드(제목·count·suggestion·snippet)를 표로 만드세요. tenant filter가 없는 endpoint 하나를 최우선 위험으로 표시합니다.
2. 문서 공유 취소 event 하나를 골라 DB commit부터 search result가 사라질 때까지의 시간을 추적해 p50/p95/p99를 계산해 보세요. p99가 데이터 등급별 목표를 넘으면 어느 queue 또는 cache가 원인인지 분류합니다.
3. 같은 검색어를 owner, 같은 tenant의 비공유 사용자, 다른 tenant 사용자, 권한 회수된 사용자로 실행하는 테스트를 만드세요. 네 응답의 문서·count·facet·suggestion·RAG citation이 모두 정책과 일치해야 통과로 둡니다.

검색의 품질은 관련도만으로 결정되지 않습니다. **사용자가 볼 수 있는 문서 집합을 먼저 정확히 닫고, 그 안에서 가장 관련 있는 결과를 고르는 것**이 authorization-aware search의 순서입니다. 이 순서를 지키면 검색 인덱스의 빠름과 원본 권한의 정확성을 서로 바꾸지 않고 운영할 수 있습니다.

## 관련 글

- [검색 인덱스 동기화와 무중단 리인덱싱](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/)
- [Object-Level Authorization과 BOLA 방어](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)
- [Authorization Decision Cache와 권한 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)
- [인가 모델 RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [테스트 데이터 계약·마스킹·Synthetic Seed](/learning/deep-dive/deep-dive-test-data-contract-masking-synthetic-seed-playbook/)
