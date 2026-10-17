---
title: "백엔드 커리큘럼 심화: Surrogate Key와 Cache Tag, 엣지 캐시 무효화를 도메인 계약으로 운영하는 법"
date: 2026-10-17T10:06:00+09:00
lastmod: 2026-10-17T10:06:00+09:00
draft: false
topic: "Backend Data Operations"
tags: ["CDN", "Cache Invalidation", "Surrogate Key", "Cache Tag", "Edge Cache", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "상세·목록·추천처럼 여러 representation에 남는 데이터를 Surrogate Key와 Cache Tag로 무효화하고, purge 지연·누락·광역 삭제를 운영하는 기준을 정리합니다."
summary: "cache key는 응답 주소이고 tag는 변경 의존성이다. 두 이름을 분리해야 CDN purge를 빠르게 하면서도 tenant 누출과 origin 폭주를 피할 수 있다."
module: "data-system"
study_order: 1561
keywords: ["surrogate key cache invalidation", "cache tag purge", "CDN cache invalidation", "edge cache domain contract"]
key_takeaways:
  - "캐시 키는 representation을 찾고, Surrogate Key 또는 Cache Tag는 변경된 도메인 사실과 영향받는 representation을 연결한다."
  - "purge 2xx는 접수 신호일 수 있다. 실제 적용 지연과 stale probe를 별도 지표로 관리해야 한다."
  - "entity·group·namespace purge를 분리하고, 넓은 purge는 rate limit과 origin 보호 계획이 있을 때만 쓴다."
operator_checklist:
  - "응답마다 cache key, tag, TTL, stale 허용 시간, owner를 inventory로 기록한다."
  - "DB commit 뒤 Outbox로 versioned purge event를 만들고 receipt·재시도 결과를 보관한다."
  - "PII와 무한 cardinality 입력은 tag에서 제외하고, tag 수와 fan-out에 예산을 둔다."
---

CDN이나 reverse proxy는 원본 부하를 줄이지만, 데이터가 바뀌는 순간 더 어려운 질문을 남깁니다. `GET /products/512`만 지우면 되는 서비스는 드뭅니다. 상품 하나가 상세, 카테고리 목록, 홈 추천, 재고 배지에 함께 들어가고 각 응답은 언어·권한·기기별로 다른 cache key를 갖기 때문입니다. URL을 모두 찾아 지우거나 prefix purge를 넓게 호출하면 cache hit가 무너져 원본까지 흔들립니다.

**Surrogate Key** 또는 **Cache Tag**는 “이 representation은 어떤 도메인 사실에 의존하는가”를 적는 별도 이름입니다. cache key가 응답의 주소라면 tag는 변경 이벤트가 찾아갈 무효화 대상의 집합입니다. 구현체마다 헤더와 API는 달라도 이 역할 분리는 같습니다. 이 글은 [HTTP 캐싱과 ETag 재검증](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/), [캐시 일관성 설계](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/), [캐시 패턴 선택](/learning/deep-dive/deep-dive-cache-pattern-selection-workload-playbook/), [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)를 edge purge에 적용합니다.

## 이 글에서 얻는 것

- cache key, ETag, tag가 해결하는 문제를 구분합니다.
- 엔터티·그룹·namespace tag를 어느 변경에 붙일지 정합니다.
- DB 변경부터 edge purge까지를 idempotent event와 지표로 연결합니다.
- tag 폭증, tenant 누출, broad purge 뒤 origin 폭주를 막는 기준을 만듭니다.

## 핵심 개념/이슈

### 1) 주소와 의존성을 섞지 않는다

상품 상세가 아래 metadata를 가진다고 합시다.

```text
cache key: /ko/products/512|public|mobile
ETag: "product-512-v184"
tags: product:512 category:33 catalog:ko:public
```

ETag는 client가 가진 representation의 버전을 확인합니다. 반면 `product:512`는 가격·공개 상태가 바뀌었을 때 어떤 cached response를 만료할지 가리킵니다. `category:33`은 목록, `catalog:ko:public`은 더 넓은 공개 카탈로그를 뜻합니다. tag는 표준 HTTP cache key가 아닐 수 있으므로, origin-edge 전용 metadata인지와 provider의 최대 tag 수까지 계약으로 문서화해야 합니다.

### 2) 무효화 단위는 작게 시작한다

| 단위 | 예시 | 쓸 때 | 기본 판단 |
| --- | --- | --- | --- |
| Entity | `product:512` | 상세·단일 상태 변경 | 가장 먼저 검토 |
| Group | `category:33` | 분류 이동·목록 집계 변화 | 화면 계약이 바뀔 때만 |
| Namespace | `site:catalog` | key 형식 오류·보안 incident | 승인된 최후 수단 |

가격 변경이 목록의 가격도 즉시 바꿔야 한다면 entity와 좁은 group tag가 필요할 수 있습니다. 반대로 이미지 URL에 version이 포함되어 있고 목록에는 thumbnail만 보인다면 group purge는 불필요합니다. 데이터 모델의 모든 관계를 tag로 만들지 말고, **같은 사실을 최신으로 보이게 하겠다고 약속한 화면만** 연결하세요.

### 3) purge는 비동기 분산 작업이다

외부 purge를 DB transaction 안에서 호출하면 rollback과 side effect 순서를 묶기 어렵고 write p95도 길어집니다. 안전한 흐름은 `DB commit → outbox(product.changed, event_id, version) → purge consumer → provider receipt → stale probe`입니다. `event_id`는 중복을, version은 늦은 이벤트가 최신 상태를 덮는 판단을 돕습니다. timeout 뒤 실제 적용 여부를 알 수 없으므로 `(provider, tag batch, event_id)`별 재시도와 receipt를 남겨야 합니다.

공개 카탈로그는 `purge_end_to_end_p95` 10초 이하, p99 60초 이하를 출발선으로 둘 수 있습니다. 권한·가격처럼 stale 허용이 1초 미만인 값은 edge cache보다 짧은 revalidation 또는 원본 경로가 맞을 수 있습니다.

## 실무 적용

### 1) tag schema에 예산을 둔다

응답당 tag는 처음에 3~8개, 상한은 20개 정도로 시작합니다. 이메일·원문 검색어·authorization claim처럼 민감하거나 계속 늘어나는 값은 tag에 넣지 않습니다. user ID tag로 개인화 응답을 지우기 시작하면 cache metadata와 purge API가 개인정보 시스템이 됩니다. 이런 응답은 private cache, 짧은 TTL, profile version 중 하나를 별도로 선택하세요.

일반 변경 하나가 1만 object 이상의 purge로 확장될 수 있다면 synchronous purge를 멈추고 versioned URL, soft TTL, 배치 revalidation을 비교합니다. `tenant:42` tag 역시 격리 수단이 아닙니다. tenant boundary는 cache key와 authorization 검증에서 먼저 보장되어야 합니다.

### 2) cache hit 대신 purge 예산을 관측한다

| 지표 | 출발 경보 기준 | 확인할 것 |
| --- | --- | --- |
| `purge_end_to_end_p95` | 10초 초과 15분 | consumer lag·provider queue |
| `purge_failure_rate` | 0.1% 초과 | quota·auth·receipt 해석 |
| `broad_purge_ratio` | 전체의 1% 초과 | tag 설계 누락·도구 오용 |
| `origin_qps_after_purge` | 기준선 대비 30% 상승 | fan-out·TTL 동시 만료 |

provider 장애 때도 원본이 무너지지 않게 `stale-while-revalidate` 또는 soft TTL을 데이터 클래스별로 둡니다. group/namespace purge를 막고 entity purge만 제한하는 kill switch도 유용합니다. miss 재구축이 같은 키에 몰리면 [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)로 원본 호출을 합치세요.

### 3) URL 하나가 아니라 영향 그래프로 검증한다

가격 변경, category 이동, 공개→비공개, 삭제는 서로 다른 tag 집합을 내보냅니다. staging에서 cache hit를 만든 뒤 변경 event를 발행하고 상세·목록·권한별 URL의 cache status, age, ETag, receipt를 함께 확인하세요. production은 하나의 category 또는 1~5% namespace로 시작해 최소 24시간 관찰합니다. purge API 성공 로그보다 stale probe가 새 상태를 읽었다는 결과가 더 강한 증거입니다.

## 트레이드오프/주의점

tag 기반 purge는 편리하지만 작은 가격 수정이 인기 상품 전체의 cache miss가 되게 만들 수 있습니다. 넓은 tag에는 pre-warm과 origin 동시성 예산이 필요합니다. 또한 provider가 purge를 접수해도 browser cache, service worker, downstream API cache에는 오래된 값이 남을 수 있습니다. `Cache-Control`, ETag, application cache, edge purge의 책임을 한 표로 분리하세요.

마지막으로 tag는 권한을 검증하지 않습니다. tenant tag를 정확히 지웠더라도 공유 cache key가 tenant·authorization을 구분하지 않으면 정보가 섞일 수 있습니다. 의사결정 순서는 **권한·정확성 계약 → entity tag → 좁은 group tag → TTL/revalidation → namespace 예외**가 안전합니다.

## 체크리스트 또는 연습

- [ ] 상위 response 10개에 cache key, tag, TTL, stale SLA, owner를 기록했다.
- [ ] tag 값에 PII·원문 검색어·unbounded input이 들어가지 않는다.
- [ ] Outbox event에 event ID·entity version·purge receipt를 연결했다.
- [ ] entity/group/namespace purge의 권한과 rate limit을 분리했다.
- [ ] purge p95·실패율·broad purge 비율·origin QPS·stale probe를 함께 본다.
- [ ] provider 장애 시 kill switch와 fallback을 game day로 확인했다.

연습으로 상품 가격 변경 하나를 골라 상세·목록·검색·개인화 화면을 “즉시 갱신”과 “1분 지연 허용”으로 나누세요. 전자에만 최소 tag를 연결하고, 후자는 TTL로 남긴 뒤 예상 purge object 수와 origin QPS를 계산해 보세요. cache invalidation이 명령 한 번이 아니라 정합성과 비용의 계약임을 확인할 수 있습니다.

## 관련 글

- [HTTP 캐싱과 ETag 재검증](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)
- [캐시 일관성 설계](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)
- [캐시 패턴 선택](/learning/deep-dive/deep-dive-cache-pattern-selection-workload-playbook/)
- [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
