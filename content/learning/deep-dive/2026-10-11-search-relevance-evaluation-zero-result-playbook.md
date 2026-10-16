---
title: "검색 품질을 운영하는 법: relevance 평가·무결과·회귀를 함께 다루는 백엔드 플레이북"
date: 2026-10-11T10:06:00+09:00
lastmod: 2026-10-11T10:06:00+09:00
draft: false
tags: ["Search", "Relevance", "Elasticsearch", "Observability", "Experimentation", "Backend"]
categories: ["Backend", "Search"]
series: "백엔드 딥다이브"
keywords: ["검색 품질", "relevance evaluation", "zero result", "검색 회귀", "검색 랭킹"]
description: "검색 기능을 색인 성공 여부가 아닌 사용자 과업 성공률로 운영하기 위한 평가셋, 무결과 분류, 변경 검증, 롤백 기준을 정리합니다."
summary: "검색은 응답이 200이고 p95가 낮아도 사용자가 원하는 문서를 찾지 못하면 실패다. 대표 질의 집합, 무결과 원인 분류, 클릭만으로 판단하지 않는 지표, query·index 변경의 점진 배포를 하나의 운영 루프로 설계해야 한다."
---

검색 시스템은 종종 두 팀의 언어가 갈리는 지점입니다. 백엔드 팀은 색인 지연, 오류율, CPU와 p95를 보고 "정상"이라고 말합니다. 사용자는 검색 결과가 비어 있거나 첫 화면에 엉뚱한 항목만 있어 "검색이 안 된다"고 말합니다. 둘 다 사실일 수 있습니다. 색인은 정상인데 동의어가 없거나, 필터가 과도하거나, 최신 문서가 낮은 점수를 받아 발견되지 않을 수 있기 때문입니다.

검색 품질은 감각적인 튜닝 작업이 아니라 **변경 전후에 같은 질의로 비교하고, 실패를 분류하고, 위험을 제한하는 운영 문제**로 다룰 수 있습니다. 이 글은 [검색 색인 동기화와 재색인](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/), [검색 권한 필터 누출 방지](/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/), [자동완성의 개인정보·성능 설계](/learning/deep-dive/deep-dive-search-autocomplete-privacy-performance-playbook/)를 전제로, "어떤 결과가 좋은가"를 측정 가능한 계약으로 바꾸는 방법을 설명합니다.

## 이 글에서 얻는 것

- 검색 응답 시간과 검색 품질을 별도 SLO로 두어야 하는 이유를 이해합니다.
- 대표 질의 집합(golden query set)을 만들고, 결과 정답·제외 대상·판정 규칙을 관리하는 방법을 배웁니다.
- 무결과를 데이터 부재, 어휘 불일치, 권한 필터, 색인 지연으로 나누어 대응할 수 있습니다.
- analyzer·동의어·boost·필터를 바꿀 때 canary와 롤백을 포함한 변경 절차를 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 검색의 성공은 "문서 반환"이 아니라 과업 완료다

`GET /search?q=...`가 50ms 안에 10건을 반환했다는 사실은 availability 신호일 뿐 relevance 신호는 아닙니다. 예를 들어 고객이 "지난달 세금계산서"를 찾는데 제목에 같은 단어가 많은 공지 글만 먼저 보이면, 검색 엔진은 성공했어도 과업은 실패했습니다. 운영 지표를 다음 세 층으로 나누면 이 혼동을 줄일 수 있습니다.

| 층 | 질문 | 시작 지표 | 경보·판단에 쓰는 방식 |
| --- | --- | --- | --- |
| 시스템 건강 | 요청을 처리했는가 | error rate, p95/p99, index lag | 오류율 1% 초과 또는 p99가 예산을 넘으면 즉시 조사 |
| 결과 유효성 | 허용되는 결과를 보였는가 | top-3 hit rate, NDCG@10, 필터 누락 | golden query 기준선보다 2%p 이상 하락 시 확대 중지 |
| 과업 신호 | 사용자가 다음 행동을 했는가 | result click, reformulation, zero-result exit | 클릭만으로 승인하지 않고 세그먼트별로 해석 |

`NDCG@10` 같은 오프라인 지표는 상위 결과의 순서를 평가하기 좋습니다. 반면 실제 클릭은 위치 편향을 가집니다. 첫 번째 결과가 눌린다고 해서 가장 관련성이 높았다는 뜻은 아닙니다. 사용자가 내용을 확인한 뒤 바로 같은 검색어를 고쳐 입력했는지, 결과를 열고 저장·구매·설정 변경처럼 도메인별 성공 행동을 했는지도 함께 보아야 합니다. 검색 결과 노출 자체와 사용자의 후속 행동을 분리해 기록하는 이유입니다.

### 2) golden query set은 회의의 기억이 아니라 버전 있는 테스트 자산이다

운영 중 자주 들어온 문의, 고객 지원 티켓, 로그의 상위 질의, 신규 기능 용어에서 대표 질의를 모읍니다. 하지만 raw query를 그대로 commit하면 개인정보와 우연한 오타를 저장할 수 있습니다. 목적별로 정규화하고 익명화한 뒤, 최소한 아래 필드를 가진 테스트 자산으로 관리하세요.

```yaml
id: invoice-recent-001
query: "최근 세금계산서"
locale: ko-KR
actor: authenticated-business-user
required_any: [invoice-2026-09-123, invoice-list]
must_not_return: [other-tenant-invoice]
intent: document-navigation
weight: 5
owner: billing-search
review_after: 2026-11-11
```

`required_any`는 정확히 한 문서만 정답인 경우보다 현실적입니다. 문서가 삭제·통합될 수 있으므로 "이 의도를 해결하는 허용 결과 집합"을 표현합니다. 반대로 `must_not_return`은 권한·테넌트 누출처럼 점수 하락보다 심각한 회귀를 잡습니다. 고가치 질의 20~50개로 시작하고, 매주 5~10개씩 실제 실패 사례를 추가하는 편이 처음부터 수천 개를 모으다 방치하는 것보다 낫습니다. 결제·권한·법무처럼 잘못된 결과의 비용이 큰 intent에는 weight를 높이고, 해당 query 하나라도 실패하면 배포를 막는 hard gate를 둘 수 있습니다.

### 3) 무결과는 하나의 숫자가 아니라 원인별 backlog다

무결과율 8%라는 숫자는 유용하지만, 해결책을 알려 주지 않습니다. 같은 8%라도 데이터가 존재하지 않는 정상 실패와 색인 장애는 전혀 다르게 다뤄야 합니다. 요청마다 raw query를 장기간 보관하는 대신, 정규화 query fingerprint, locale, index version, filter version, result count, 권한 상태처럼 필요한 최소 신호를 기록하고 보존 기간을 정합니다.

| 무결과 유형 | 확인 신호 | 우선 대응 |
| --- | --- | --- |
| 콘텐츠 부재 | source DB에도 대상 없음 | FAQ·생성 흐름·콘텐츠 backlog로 전달 |
| 어휘 불일치 | 유사 질의는 성공, 오타·약어만 실패 | 동의어·형태소·spell correction을 실험 |
| 필터 과잉 | admin은 보이고 일반 사용자는 0건 | filter clause와 권한 projection 점검 |
| 색인 지연·실패 | DB에는 있고 index version이 뒤처짐 | 색인 lag, DLQ, 재처리 범위를 확인 |
| 의도 모호 | 짧은 한두 글자 질의, 재검색 다수 | 자동완성·facet·질문형 UX 검토 |

전체 무결과율보다 **지난 7일 대비 증가 폭**, 상위 intent별 비중, 로그인 상태·locale별 분포가 더 유용합니다. 예를 들어 전체는 0.4%p만 올랐지만 사업자 계정의 "invoice" 계열이 18%에서 42%로 뛰었다면 즉시 조사할 사건입니다. 반면 새 기능명 검색으로 생긴 소량의 무결과는 콘텐츠 등록 순서 문제일 수 있습니다. 따라서 무결과 알림에는 최소 100건 이상 표본, 기준 기간, 상위 fingerprint와 index/filter version을 함께 붙여야 소음이 줄어듭니다.

## 실무 적용

### 1) 검색 변경을 세 종류로 나누고 검증 강도를 맞춘다

모든 변경을 재색인 수준으로 취급하면 팀이 우회하고, 모든 boost 변경을 가볍게 처리하면 회귀가 누적됩니다. 영향 경로를 기준으로 다음처럼 나눌 수 있습니다.

| 변경 종류 | 예 | 사전 검증 | production 시작값 |
| --- | --- | --- | --- |
| query-time | boost, synonym set, ranking function | golden set + shadow 비교 | 5% traffic, 30분 관찰 |
| index-time | analyzer, mapping, 새 필드 | 새 index 병렬 생성 + sample diff | read alias 1% 전환 후 24시간 |
| access/filter | tenant, 상태, visibility 조건 | 권한 fixture와 negative test | 내부 tenant부터, 누출 1건이면 즉시 중단 |

query-time 변경은 구 index와 신 query를 같은 요청에 shadow로 실행해 top-10 차이를 수집할 수 있습니다. 이때 사용자에게 두 결과를 모두 노출하지 말고, 주 응답 하나만 반환합니다. `top-3 hit rate`가 기준선보다 2%p 이상 떨어지거나 고가치 query의 required result가 빠지면 canary를 5%에서 올리지 않습니다. index-time 변경은 문서 수 비교만으로 충분하지 않습니다. mapping 차이로 token 수가 폭증하거나 특정 언어 analyzer가 빈 토큰을 만들 수 있으므로, 샘플 1,000건의 token·field length·검색 결과를 비교합니다.

### 2) event schema에서 위치 편향과 개인정보를 동시에 다룬다

검색 로그에는 query 원문, 계정 식별자, 권한 정보가 섞이기 쉽습니다. 기본 event는 아래 정도의 최소 구조로 시작할 수 있습니다.

```text
search_id, query_fingerprint, locale, index_version, ranking_version,
result_count, displayed_rank, clicked_rank, filter_profile,
latency_ms, zero_result_reason, outcome_type
```

원문 질의는 debugging 승인 절차가 있는 별도 단기 저장소로 분리하고, 일반 dashboard에는 fingerprint와 분류 label만 보냅니다. `clicked_rank`를 남기는 것은 순위 편향을 완전히 제거하지 못해도 "1위만 클릭되는가", "7위 이후 결과가 전혀 소비되지 않는가"를 구분하기 위해서입니다. 결과 상세 화면의 dwell time은 탭을 열어 둔 경우 왜곡되므로, 저장·다운로드·다음 작업 진입 같은 도메인 성공 event와 함께 사용하세요.

권한 필터는 ranking 뒤의 장식이 아닙니다. 후보 문서를 만든 뒤 권한을 제거하면 상위 10개가 모두 제외되어 0건이 될 수 있고, 반대로 filter 누락은 정보 노출입니다. filter가 적용된 뒤의 candidate 수, filter rule version, deny count를 지표로 남기되 resource ID나 tenant 이름은 집계 event에 넣지 않는 것이 안전합니다. 이 경계는 [권한 모델 RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)의 policy source와 같은 원칙을 따릅니다.

### 3) 매주 30분의 relevance 운영 루프를 고정한다

거대한 ML ranking 프로젝트가 없더라도 운영 루프는 만들 수 있습니다.

1. 지난 7일의 top zero-result fingerprint와 reformulation이 많은 질의를 20개 추립니다. 개인정보 또는 매우 희귀한 질의는 제외하거나 수동 승인으로 넘깁니다.
2. 각 질의를 콘텐츠 부재·어휘·필터·색인·모호성으로 분류하고 owner와 다음 검토일을 적습니다.
3. 변경 후보는 golden set과 shadow 결과로 먼저 비교합니다. 고가치 query에서 regression이 있으면 feature flag를 만들지 말고 설계를 다시 봅니다.
4. 5% canary에서 30분, 25%에서 피크 시간대를 포함해 최소 4시간 관찰합니다. error, p95, zero-result, top-3 hit, domain outcome을 함께 봅니다.
5. 100% 전환 뒤 7일 동안 이전 ranking version과 비교하고, 원인을 설명할 수 없는 지표 변동은 새 기준선으로 고정하지 않습니다.

이 루프의 핵심은 "클릭률이 올랐다"로 끝내지 않는 것입니다. 예를 들어 자동완성이 인기 문구를 강하게 제안해 클릭은 늘어도 사용자의 원래 intent가 좁아질 수 있습니다. query abandonment와 downstream 성공률이 같이 좋아졌는지 확인해야 합니다. 데이터가 부족할 때는 [feature flag의 evaluation 데이터 운영](/posts/2026-10-10-openfeature-evaluation-data-governance-trend/)처럼 exposure와 version을 먼저 정확히 남기는 것이 모델 도입보다 우선입니다.

## 트레이드오프/주의점

첫째, offline relevance 지표는 빠르고 재현 가능하지만 오래된 golden set에 과적합될 수 있습니다. 매주 실제 실패 사례를 보충하되, 한 고객의 요구를 전 서비스의 기본 ranking으로 일반화하지 마세요. query를 새로 추가할 때는 intent, 영향 사용자, expected result의 근거를 기록해야 합니다.

둘째, 동의어는 recall을 높이지만 precision과 권한 검토 범위를 넓힙니다. "계정"을 "사용자"로 묶는 일반 동의어는 유용할 수 있으나, 도메인에서 "계정"이 회계 계정을 뜻한다면 다른 결과를 오염시킵니다. 동의어는 전역 배포보다 locale·product scope가 좁은 set으로 시작하고, 한 변경에는 10~20개 항목 이하를 묶어 원인을 추적할 수 있게 하세요.

셋째, semantic/vector retrieval은 표현 차이를 줄일 수 있지만 결과의 설명 가능성과 비용을 자동으로 해결하지 않습니다. embedding 모델 변경은 ranking 변경이면서 index-time migration일 수 있습니다. lexical baseline과 hybrid score를 남기고, top-k 후보 수·rerank timeout·fallback 결과를 계약으로 둬야 합니다. 사용자가 요청하지 않은 민감 문서를 "의미가 비슷하다"는 이유로 넓게 찾지 않도록 authorization filter는 후보 생성 전에 강제되어야 합니다.

마지막으로, 무결과를 무조건 줄이는 것이 목적은 아닙니다. 존재하지 않는 리소스를 그럴듯한 결과로 대체하면 사용자는 더 늦게 실패합니다. 결제 영수증, 계약서, 권한 있는 내부 문서처럼 정확성이 우선인 intent에서는 0건과 생성 안내가 잘못된 유사 결과보다 낫습니다.

## 체크리스트 또는 연습

### 배포 전 체크리스트

- [ ] 상위 intent 20개 이상을 포함한 golden query set에 `required_any`와 고위험 `must_not_return`을 정의했다.
- [ ] 평가 결과에 index version, ranking version, filter profile을 남겨 같은 결과를 재현할 수 있다.
- [ ] query 원문·계정 식별자·권한 데이터의 저장 위치, 접근 권한, 보존 기간을 분리했다.
- [ ] high-risk query 하나라도 required result를 잃거나 권한 fixture가 실패하면 rollout을 중단한다.
- [ ] canary의 확대 조건을 top-3 hit rate, zero-result 증가 폭, p95, domain outcome으로 수치화했다.
- [ ] rollback은 이전 query/ranking version으로 즉시 가능한지, index-time 변경이면 read alias를 되돌릴 수 있는지 확인했다.

### 연습: "최근 청구서" 회귀를 설계해 보자

`최근 청구서` 검색이 새 analyzer 적용 후 0건을 반환했다고 가정해 봅시다. source DB에는 문서가 있고 다른 언어 locale에서는 정상입니다. 먼저 index lag인지, 한국어 tokenization 차이인지, authenticated filter인지 순서대로 가설을 세우세요. 그다음 golden query에 required result와 locale을 추가하고, 새 index와 이전 index의 token·candidate count·top-10을 비교합니다. 마지막으로 5% canary의 중단 기준을 "해당 intent zero-result가 기준선 대비 3%p 증가"처럼 작성해 보세요. 원인을 모른 채 동의어만 추가하는 선택은 가장 마지막이어야 합니다.
