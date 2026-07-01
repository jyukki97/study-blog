---
title: "백엔드 커리큘럼 심화: 검색 인덱스 동기화와 무중단 리인덱싱 운영 플레이북"
date: 2026-07-01
draft: false
topic: "Search Architecture"
tags: ["Search Index", "Elasticsearch", "OpenSearch", "Reindexing", "CDC", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "검색 인덱스를 단순 조회 최적화가 아니라 원본 데이터와 별도 생명주기를 가진 파생 저장소로 보고, 동기화 지연·삭제 전파·무중단 리인덱싱·검증 기준을 실무 숫자 중심으로 정리합니다."
summary: "검색 인덱스는 빠른 조회용 복사본이 아니라 freshness SLO, 삭제 전파, 재빌드 절차를 가진 파생 데이터 제품입니다."
key_takeaways:
  - "검색 인덱스 품질은 응답 속도보다 원본 변경이 언제, 어떤 조건으로 반영되는지에 더 크게 좌우된다."
  - "운영 중 mapping/analyzer 변경은 기존 인덱스를 비우는 방식이 아니라 새 인덱스 생성, 검증, alias 전환으로 처리해야 한다."
  - "삭제·비공개 전파는 relevance 개선보다 우선순위가 높으며, 별도 지연 SLO와 잔존 검증을 둬야 한다."
operator_checklist:
  - "인덱스별 source of truth, owner, update/delete freshness SLO, rollback window를 문서화한다."
  - "CDC/outbox lag, bulk failure rate, DLQ, forbidden residual count를 검색 대시보드에 분리해 노출한다."
  - "리인덱싱 전 문서 수, checksum, top query overlap, 삭제 문서 잔존율 기준을 먼저 합의한다."
learning_refs:
  - title: "Elasticsearch 기초"
    href: "/learning/deep-dive/deep-dive-elasticsearch-basics/"
    description: "검색 엔진의 인덱스, mapping, shard, query 기본기를 먼저 잡을 수 있는 배경 글입니다."
  - title: "CDC Connector Lag와 Snapshot Recovery"
    href: "/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/"
    description: "검색 동기화의 입력 경로가 되는 CDC 지연, snapshot, 복구 기준을 함께 볼 수 있습니다."
  - title: "Projection Lag와 Read Model Rebuild"
    href: "/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/"
    description: "검색 인덱스를 read model처럼 다룰 때 필요한 lag SLO와 rebuild 사고방식을 연결합니다."
decision_guide:
  intro: "검색 인덱스는 붙이는 순간 운영 데이터 제품이 됩니다. 아래 기준으로 동기화 방식과 리인덱싱 절차의 무게를 정하세요."
  cases:
    - badge: "운영 필수"
      title: "주문, 권한, 개인정보, CS 화면이 검색 결과를 신뢰한다"
      fit: "검색 결과가 사용자 행동이나 운영 판단을 바로 바꾸는 서비스라면 outbox/CDC, delete lag SLO, 원본 재확인 경로가 필요합니다."
      watchouts: "dual write만으로 시작하면 인덱스 실패 후 어떤 변경이 누락됐는지 재생할 근거가 부족해질 수 있습니다."
      next_step: "인덱스 계약서에 source of truth, delete p95, 재처리 기간, 권한 재검증 위치를 먼저 적습니다."
    - badge: "점진 도입"
      title: "콘텐츠·카탈로그 검색처럼 몇 분 지연을 허용한다"
      fit: "검색 freshness가 UX에는 영향을 주지만 결제, 권한, 규정 리스크로 바로 이어지지 않는 화면에 맞습니다."
      watchouts: "지연 허용이 삭제 허용을 뜻하지 않습니다. 비공개 전환과 삭제 이벤트는 별도 우선순위로 봐야 합니다."
      next_step: "batch/full sync로 시작하더라도 삭제 전파 검증과 검색 결과 stale 안내 기준을 함께 둡니다."
    - badge: "전환 보류"
      title: "RDB 인덱스와 제한된 검색 조건으로 충분하다"
      fit: "데이터 규모가 작고 부분 일치·복합 정렬·relevance 요구가 낮다면 별도 검색 클러스터가 과투자일 수 있습니다."
      watchouts: "검색 엔진 도입은 조회 성능 개선만큼 mapping, backfill, 비용, 보안 운영 책임을 추가합니다."
      next_step: "느린 쿼리, 필터 조합, 사용자 검색어 분포를 2주 정도 기록한 뒤 검색 엔진 필요성을 다시 판단합니다."
faqs:
  - question: "검색 인덱스는 캐시처럼 틀리면 비우고 다시 만들면 되지 않나요?"
    answer: "재생 가능하다는 점은 캐시와 비슷하지만, 사용자가 검색 결과를 근거로 행동한다면 이미 제품의 읽기 모델입니다. 비우고 다시 만드는 동안 노출될 stale 결과, 삭제 잔존, rollback 기준까지 운영 절차로 가져가야 합니다."
  - question: "리인덱싱 중 기존 인덱스와 새 인덱스 결과가 꼭 같아야 하나요?"
    answer: "항상 완전히 같을 필요는 없습니다. ranking 개선이나 analyzer 변경이 목적이면 순서는 달라질 수 있습니다. 대신 top N overlap, 필수 문서 포함, 금지 문서 미노출, 핵심 필드 checksum처럼 의도한 차이와 사고를 구분하는 기준이 필요합니다."
  - question: "검색 결과에서 권한 필터를 걸면 애플리케이션 권한 검사는 생략해도 되나요?"
    answer: "민감 데이터라면 생략하지 않는 편이 안전합니다. 인덱스의 tenant_id나 visibility가 늦게 반영될 수 있으므로, 상위 결과에 대해 애플리케이션 권한 검사를 한 번 더 수행하고 실패율을 동기화 이상 지표로 봐야 합니다."
module: "backend-data-system"
study_order: 1445
---

상품명 검색, 주문 관리자 검색, 고객센터 통합 조회, 문서 검색처럼 조건이 복잡한 기능은 어느 순간 RDB 인덱스만으로 버티기 어렵습니다. 그래서 Elasticsearch나 OpenSearch 같은 검색 엔진을 붙입니다. 처음에는 API 응답이 빨라지고, 필터·정렬·부분 일치가 쉬워져 성공처럼 보입니다. 하지만 운영에 들어가면 다른 문제가 나옵니다. 원본 DB에는 값이 바뀌었는데 검색 결과는 예전 값을 보여주고, 삭제된 사용자가 검색에 남아 있고, mapping 변경 때문에 전체 인덱스를 다시 만들어야 하는데 운영 검색을 멈출 수 없습니다.

검색 인덱스는 캐시와 비슷해 보이지만 캐시보다 책임이 큽니다. 사용자는 검색 결과를 제품의 진실처럼 받아들이고, 운영자는 검색 화면으로 장애·정산·CS를 판단합니다. 따라서 검색 인덱스는 **원본 데이터에서 재생성 가능한 파생 저장소**이면서 동시에 **사용자 경험을 직접 결정하는 읽기 모델**입니다. 이 글은 [Elasticsearch 기초](/learning/deep-dive/deep-dive-elasticsearch-basics/), [CDC Connector Lag와 Snapshot Recovery](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/), [Projection Lag와 Read Model Rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)를 검색 운영 관점으로 묶어 정리합니다.

## 이 글에서 얻는 것

- 검색 인덱스를 단순 조회 최적화가 아니라 freshness SLO가 있는 파생 저장소로 설계할 수 있습니다.
- CDC, outbox, dual write, bulk backfill 중 어떤 동기화 방식을 고를지 기준을 잡을 수 있습니다.
- mapping 변경, synonym 변경, analyzer 변경 때 운영 검색을 멈추지 않고 새 인덱스로 전환하는 절차를 이해할 수 있습니다.
- 삭제 전파, 중복 반영, relevance 회귀, backfill 부하를 숫자로 관리하는 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 검색 인덱스의 진짜 문제는 조회 속도보다 "얼마나 늦게 맞는가"다

검색 엔진을 붙이는 이유는 보통 성능입니다. `LIKE '%keyword%'`, 다중 필터, 정렬, nested 조건이 느려지면 별도 인덱스로 빼고 싶어집니다. 하지만 운영 품질은 성능만으로 결정되지 않습니다. 더 중요한 질문은 "원본 변경이 검색 결과에 언제 반영되는가"입니다.

예를 들어 상품 가격이 바뀌었는데 검색 결과 카드에는 10분 전 가격이 남아 있으면 사용자는 결제 화면에서 다른 금액을 봅니다. 주문 상태가 `CANCELLED`로 바뀌었는데 관리자 검색에는 `PAID`로 남으면 CS가 잘못 대응할 수 있습니다. 개인정보 삭제 요청 후 이름이 검색 인덱스에 남으면 단순 성능 문제가 아니라 규정 위반으로 이어집니다.

그래서 검색 인덱스에는 최소 세 가지 지연 기준이 필요합니다.

| 지표 | 의미 | 초기 기준 |
| --- | --- | --- |
| indexing lag | 원본 변경 후 검색 반영까지 걸린 시간 | 일반 검색 p95 1~5분, 운영 화면 p95 30초 |
| delete propagation lag | 삭제/비공개 처리 후 검색에서 사라지는 시간 | 개인정보·권한 데이터 p95 10초~1분 |
| rebuild catch-up lag | 새 인덱스가 실시간 변경분을 따라잡는 시간 | cutover 전 30초 이하 |

모든 검색이 1초 안에 맞아야 하는 것은 아닙니다. 콘텐츠 검색이나 분석 검색은 몇 분 지연을 허용할 수 있습니다. 반대로 권한, 가격, 재고, 결제 상태처럼 사용자가 바로 행동하는 필드는 검색 결과만 믿으면 안 됩니다. 이 경우 검색 결과는 후보 목록으로만 쓰고, 상세 화면이나 최종 액션에서는 원본 DB를 다시 확인해야 합니다.

### 2) 동기화 방식은 "쓰기 경로 신뢰성"과 "운영 복구성"으로 고른다

검색 인덱스를 갱신하는 방식은 크게 네 가지입니다.

| 방식 | 장점 | 위험 | 적합한 조건 |
| --- | --- | --- | --- |
| 애플리케이션 dual write | 구현이 단순하고 지연이 짧음 | DB 성공 후 인덱스 실패 시 불일치 | 작은 서비스, 낮은 정합성 요구 |
| Transactional outbox | DB 트랜잭션과 이벤트 발행 의도가 같이 남음 | outbox relay 운영 필요 | 주문·결제·운영 검색 |
| CDC 기반 동기화 | 애플리케이션 코드 침투가 적음 | 스키마 변경·snapshot·lag 운영 필요 | 대량 테이블, 여러 sink 공유 |
| 주기적 full sync | 이해하기 쉬움 | 최신성 낮고 비용 큼 | 저빈도 카탈로그, 내부 도구 |

실무 기본값은 **outbox 또는 CDC**입니다. 검색 인덱스가 비즈니스 판단에 쓰이면 dual write만으로는 복구성이 부족합니다. DB commit은 성공했는데 검색 색인이 실패한 경우, 어떤 변경이 누락됐는지 나중에 재생할 근거가 있어야 합니다. outbox는 애플리케이션이 도메인 이벤트를 명시적으로 발행한다는 점이 좋고, CDC는 기존 테이블 변경을 폭넓게 잡는 데 유리합니다.

의사결정 기준은 다음처럼 잡을 수 있습니다.

- 원본 변경량이 초당 100건 미만이고 검색 지연 5분을 허용하면 batch sync로 시작 가능
- 주문·결제·권한·CS 화면에 쓰이면 outbox/CDC를 우선 검토
- 검색 인덱스가 2개 이상 sink와 공유되면 CDC lag 대시보드를 필수로 둠
- 삭제·비공개 전파가 1분 안에 필요하면 soft delete 이벤트를 별도 우선순위 큐로 분리
- 재처리 기간은 최소 7일, 운영 감사가 있으면 30~90일 이상 보관

### 3) 리인덱싱은 "덮어쓰기"가 아니라 "새 인덱스 생성 후 alias 전환"이다

검색 인덱스는 mapping, analyzer, synonym, ranking feature가 바뀌면 전체 재생성이 필요할 수 있습니다. 여기서 운영 인덱스를 직접 비우고 다시 채우는 방식은 피해야 합니다. 중간에 실패하면 검색 결과가 반쯤 비고, rollback도 어렵습니다.

안전한 방식은 새 인덱스를 만들고 검증한 뒤 alias를 바꾸는 것입니다.

1. `product-search-v20260701` 같은 새 물리 인덱스 생성
2. 기존 원본 DB 또는 snapshot에서 bulk backfill
3. backfill 중 발생한 변경은 outbox/CDC로 새 인덱스에도 반영
4. 문서 수, 샘플 query, 핵심 필드 checksum, 삭제 문서 잔존율 비교
5. read alias를 일부 트래픽에서 새 인덱스로 canary
6. 이상 없으면 alias atomically switch
7. 구 인덱스는 24~72시간 read-only 보관 후 삭제

숫자 기준은 초기값으로 아래 정도가 현실적입니다.

- backfill 중 원본 DB CPU 추가 사용률: 20% 이하
- 검색 클러스터 indexing CPU: 평상시 대비 150% 이내
- bulk request 실패율: 0.1% 이하
- 핵심 query top 10 overlap: 90% 이상, 단 ranking 변경 의도는 별도 승인
- 삭제 문서 잔존율: 개인정보·비공개 데이터 0%, 일반 데이터 0.1% 이하
- cutover 전 새 인덱스 lag: 30초 이하

이 흐름은 [Shadow Traffic과 Dark Launch](/learning/deep-dive/deep-dive-shadow-traffic-dark-launch-playbook/)와 비슷합니다. 새 검색 경로를 바로 신뢰하지 말고, 기존 결과와 나란히 비교해야 합니다. 다만 검색은 결과 순서가 완전히 같지 않을 수 있으므로 단순 equality보다 top N overlap, 필수 문서 포함 여부, 금지 문서 미노출 여부를 따로 봐야 합니다.

### 4) 삭제 전파는 검색 품질보다 더 엄격하게 다룬다

검색 인덱스 운영에서 가장 자주 과소평가되는 부분이 삭제입니다. 원본 DB에서 soft delete만 했는데 인덱스에는 문서가 남아 있거나, 권한이 바뀌었는데 검색 결과 필터가 예전 권한을 기준으로 동작하는 일이 생깁니다. 특히 개인정보, 비공개 게시글, 관리자 전용 데이터는 "조금 늦게 사라짐"도 사고가 될 수 있습니다.

삭제는 일반 업데이트와 다른 우선순위를 둬야 합니다.

- 삭제·비공개 이벤트는 별도 high-priority consumer로 처리
- 인덱스 문서에는 `visibility`, `tenant_id`, `deleted_at`, `source_version`을 포함
- 검색 API는 인덱스 필터와 애플리케이션 권한 검사를 모두 수행
- 삭제 이벤트 처리 실패는 DLQ에 묻지 않고 알람으로 올림
- 삭제 후 샘플 키워드 검색으로 잔존 여부를 검증

관련 기준은 [Data Retention과 삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)를 같이 보면 좋습니다. 검색 인덱스는 원본 저장소보다 복구와 추적이 느슨해지기 쉬우므로, 삭제 전파 SLO를 별도 숫자로 관리해야 합니다.

## 실무 적용

### 1) 검색 인덱스 계약서를 만든다

검색 인덱스마다 아래 정보를 문서화합니다.

```yaml
search_index_contract:
  name: product-search
  source_of_truth: product_db.products
  sync_method: cdc
  freshness_slo:
    update_p95: 60s
    delete_p95: 10s
  owner: commerce-platform
  alias:
    read: product-search-read
    write: product-search-write
  rebuild:
    source: db_snapshot + cdc_catchup
    rollback_window: 72h
  validation:
    doc_count_tolerance: 0.1%
    top10_overlap_min: 90%
    forbidden_doc_residual: 0
```

이 정도만 있어도 장애 대응이 달라집니다. "검색이 이상하다"가 아니라 "product-search의 update lag가 p95 8분으로 SLO를 넘었고, delete lag는 정상"처럼 말할 수 있습니다.

### 2) 대시보드는 indexing, query, 품질을 분리한다

검색 운영 대시보드는 쿼리 latency만 보면 부족합니다.

- indexing: lag, bulk failure rate, retry count, DLQ count
- query: p95/p99 latency, timeout rate, shard failure, empty result rate
- quality: top query zero-result rate, top N overlap, forbidden residual count
- capacity: heap, CPU, disk watermark, merge pressure, refresh cost
- rebuild: progress percent, catch-up ETA, alias switch readiness

알람 우선순위는 **삭제 실패 > indexing 완전 중단 > 운영 화면 lag 초과 > query latency > relevance 회귀** 순으로 둡니다. relevance는 중요하지만, 비공개 문서 노출이나 원본 변경 누락보다 먼저 볼 수는 없습니다.

### 3) 검색 API는 최종 권한 판단을 인덱스에만 맡기지 않는다

검색 엔진은 후보를 빠르게 찾는 데 강하지만, 최종 권한 판단까지 모두 맡기면 위험합니다. 인덱스 문서의 `tenant_id`나 `visibility`가 밀리면 권한이 깨질 수 있습니다. 따라서 민감 데이터는 검색 결과를 받은 뒤 애플리케이션에서 한 번 더 권한을 확인합니다. 비용이 걱정되면 상위 20~100건만 검증하고, 권한 실패율이 1%를 넘으면 인덱스 동기화 이상으로 알람을 올립니다.

페이지네이션도 주의해야 합니다. relevance score가 변하는 검색 결과에는 단순 offset이 흔들릴 수 있습니다. 긴 검색 세션이나 관리자 화면은 point-in-time 검색, snapshot token, search-after를 검토합니다. 이 기준은 [Cursor Pagination 일관성 플레이북](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)과 연결됩니다.

## 트레이드오프/주의점

첫째, 검색 인덱스를 정교하게 만들수록 원본 DB 부담은 줄지만 운영해야 할 데이터 제품이 늘어납니다. mapping version, analyzer version, synonym 배포, shard 수, refresh interval, backfill worker까지 모두 릴리즈 대상입니다. 작은 서비스에서는 RDB 인덱스와 제한된 검색 조건으로 충분할 수도 있습니다.

둘째, relevance 개선은 기능 배포보다 회귀 검증이 어렵습니다. 정확도는 "더 좋아졌다"로 끝나지 않습니다. 상위 검색어, 매출 기여 검색어, CS 검색어, 금지어, 비공개 문서, 다국어 케이스를 fixture로 만들어야 합니다. ranking 변경은 최소 1~5% canary로 시작하고, zero-result rate와 클릭률이 동시에 나빠지면 되돌리는 편이 안전합니다.

셋째, refresh interval을 무작정 줄이면 최신성은 좋아지지만 indexing 비용이 커집니다. 실시간성이 필요한 필드만 우선 큐로 보내고, 나머지는 30초~5분 지연을 허용하는 편이 비용 대비 효과가 좋습니다.

넷째, 검색 인덱스를 원본처럼 오래 보관하면 삭제·보안·비용 문제가 커집니다. 재생성 가능한 데이터라면 raw snapshot과 이벤트 로그 보존 정책을 기준으로 인덱스 자체는 짧게 유지하는 편이 낫습니다.

의사결정 우선순위는 **비공개/삭제 전파 > 원본 정합성 > 운영 검색 신뢰도 > relevance 개선 > 비용 최적화**입니다. 검색이 빨라도 틀린 문서를 보여주면 제품 신뢰가 먼저 깨집니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 검색 인덱스별 source of truth, owner, freshness SLO가 있다.
- [ ] update lag와 delete lag를 별도 지표로 본다.
- [ ] mapping/analyzer 변경은 새 인덱스 생성 후 alias 전환으로 처리한다.
- [ ] cutover 전 문서 수, top N overlap, 금지 문서 잔존율을 검증한다.
- [ ] 삭제·비공개 이벤트는 일반 업데이트보다 높은 우선순위로 처리한다.
- [ ] 검색 결과의 최종 권한 판단을 인덱스 필터에만 맡기지 않는다.
- [ ] 구 인덱스 rollback window와 삭제 조건이 문서화되어 있다.

### 연습

1. 운영 중인 검색 화면 하나를 골라 update lag와 delete lag 허용치를 초 단위로 적어 보세요. 둘이 같은 값이면 정말 같은 위험인지 다시 검토합니다.
2. 상품 검색 인덱스 mapping을 바꾼다고 가정하고, v2 인덱스 생성부터 alias switch까지 10단계 runbook을 작성해 보세요.
3. 삭제된 문서가 검색에 남는 사고를 가정하고, 탐지 지표·즉시 조치·재처리 범위·고객 영향 확인 방법을 분리해 적어 보세요.

## 관련 글

- [Elasticsearch 기초](/learning/deep-dive/deep-dive-elasticsearch-basics/)
- [CDC Connector Lag와 Snapshot Recovery](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/)
- [Projection Lag와 Read Model Rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)
- [Data Retention과 삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
- [Cursor Pagination 일관성 플레이북](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)
