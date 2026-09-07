---
title: "백엔드 커리큘럼 심화: 검색 자동완성의 성능·권한·개인정보 경계 설계"
date: 2026-09-07
draft: false
topic: "Search Systems"
tags: ["Search Autocomplete", "Typeahead", "Prefix Search", "Authorization", "Privacy", "Caching", "Backend Performance"]
categories: ["Backend Deep Dive"]
description: "검색 자동완성을 빠른 UX 장치로만 보지 않고, prefix index·랭킹·권한 필터·입력 개인정보·캐시 격리를 함께 설계하는 실무 기준을 정리합니다."
summary: "자동완성은 한 번의 검색보다 훨씬 자주 호출되고, 사용자가 아직 제출하지 않은 입력까지 다룬다. p95 지연만 낮추는 최적화는 권한 누출과 입력 로그 유출을 만들 수 있다. 요청 예산, 결과 수, 캐시 키, 검색 인덱스 갱신, fallback을 하나의 계약으로 두어야 한다."
key_takeaways:
  - "자동완성은 전체 검색 결과가 아니라 다음 입력을 돕는 제한된 후보 API다. 결과 수·입력 길이·지연 예산을 먼저 고정해야 한다."
  - "캐시와 index는 query만으로 공유하면 안 된다. tenant, 권한 범위, locale, index version을 분리하지 않으면 빠른 응답이 정보 누출이 된다."
  - "사용자가 입력한 문자열은 미제출 개인정보일 수 있다. 원문 로그·학습 데이터·인기어 승격 경로를 기본적으로 분리해야 한다."
operator_checklist:
  - "최소 입력 2자, 최대 64 code point, 최대 10개 후보, 서버 deadline 120ms를 API 계약에 명시한다."
  - "cache key에 tenant/visibility/locale/index version을 포함하고 권한 변경 뒤 stale 결과가 남는 시간을 정한다."
  - "원문 query를 애플리케이션 로그와 metric label에 넣지 않고, 오류 분석용 접근 통제된 표본만 짧은 보존 기간으로 운영한다."
  - "대상 index가 늦거나 timeout이면 전체 검색으로 몰아넣지 말고 빈 후보 또는 안전한 인기 카테고리로 축소 응답한다."
learning_refs:
  - title: "검색 인덱스 동기화와 Reindex"
    href: "/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/"
    description: "자동완성 index의 생성·교체·rollback 기준을 연결합니다."
  - title: "검색 권한 필터와 정보 누출 방지"
    href: "/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/"
    description: "후보를 반환하기 전에 visibility를 적용해야 하는 이유를 다룹니다."
  - title: "Request Coalescing과 Singleflight"
    href: "/learning/deep-dive/deep-dive-request-coalescing-singleflight/"
    description: "인기 prefix가 만드는 중복 cache miss를 줄이는 방법입니다."
  - title: "API Resource Budgeting"
    href: "/learning/deep-dive/deep-dive-api-resource-budgeting/"
    description: "고빈도 API의 시간·결과·연산 예산을 계산하는 기준입니다."
module: "data-system"
study_order: 1505
---

검색 자동완성(typeahead)은 검색창 아래에 후보를 몇 개 보여주는 작은 기능처럼 보인다. 그러나 사용자가 한 글자씩 입력할 때마다 호출되고, 아직 제출하지 않은 문장까지 서버에 전달하며, 인기어 cache와 권한별 데이터가 만나는 지점이라는 점에서 일반 검색보다 운영 난도가 높다. 상품명·문서 제목만 다루던 API가 어느 날 고객 이름, 사내 프로젝트, 이메일 주소 일부, 비공개 문서 제목을 후보로 드러내는 사고도 여기서 시작한다.

좋은 자동완성의 우선순위는 **권한과 개인정보 보호 > 입력에 대한 즉시성 > 결과의 관련성 > 인프라 비용**이다. 이 글은 [검색 인덱스 동기화와 Reindex](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/), [검색 권한 필터와 정보 누출 방지](/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/), [Request Coalescing과 Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/), [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/)을 자동완성의 요청 경계로 묶어 설명한다.

## 이 글에서 얻는 것

- 자동완성을 전체 검색의 축소판으로 만들지 않고, 입력 보조용 API로 범위를 정하는 방법을 배웁니다.
- prefix index, ranking, cache, fallback에 시간·결과 수·동시성 예산을 부여하는 기준을 얻습니다.
- tenant·권한·locale·입력 개인정보가 cache와 인기어 집계에서 섞이지 않게 설계할 수 있습니다.
- 출시 전과 장애 시에 바로 쓸 수 있는 검증 체크리스트를 가져갑니다.

## 핵심 개념/이슈

### 1) 자동완성은 빠른 검색이 아니라 제한된 후보를 주는 별도 계약이다

검색 버튼을 누른 뒤의 full search는 수백 ms를 써서 필터, 정렬, 페이지네이션, 권한 검사를 할 수 있다. 반면 자동완성은 키 입력마다 3~10회가 연속으로 들어올 수 있고, 사용자는 다음 글자를 입력하기 전에 반응을 기대한다. 그러므로 suggest endpoint를 search endpoint에 작은 limit만 붙인 API로 만들면, 검색 cluster와 DB에 같은 부하를 반복해서 준다.

첫 API 계약은 작고 명확해야 한다.

| 항목 | 권장 출발값 | 이유 |
| --- | --- | --- |
| 최소 입력 길이 | 2자 | 한 글자 query의 fan-out과 의미 없는 후보를 줄인다. 고유한 코드 체계는 예외를 문서화한다. |
| 최대 입력 길이 | 64 code point | 긴 paste, 오류 입력, 색인 탐색 비용을 제한한다. |
| 최대 후보 | 5~10개 | 입력 보조에는 충분하고 렌더링·전송·랭킹 비용을 통제한다. |
| 서버 deadline | 120ms | client debounce와 네트워크 시간을 남겨 interaction p95를 보통 200ms 안쪽에서 관리한다. |
| cache TTL | 30초~5분 | 인기 prefix의 반복 비용은 줄이되 재고·권한·문서 변경의 stale window를 과도하게 키우지 않는다. |

응답에는 표시 문자열 외에 suggestion ID, type, display, source version, policy version 정도만 넣는다. 내부 점수, 삭제된 문서 ID, 비공개 분류 값, ranking debug 정보는 public API에 섞지 않는다. 후보 선택 뒤의 상세 조회는 별도의 권한 검사와 존재 확인을 다시 거쳐야 한다. 후보를 보았다는 사실 자체가 정보일 수 있기 때문이다.

### 2) prefix index와 ranking은 데이터 정합성보다 안전한 관련성을 우선한다

자동완성에 부분 일치 SQL을 매번 실행하는 방식은 소규모 데이터에서만 잠깐 통한다. prefix 검색에 맞는 search engine completion suggester, n-gram/prefix index, 또는 데이터 규모가 작은 경우의 정규화된 prefix 테이블 중 하나를 선택하되, 원본 테이블을 매 키 입력마다 스캔하지 않는 것이 기준이다. 언어별 형태소 처리와 오타 보정은 full search에 맡기고, 자동완성은 prefix·정규화·제한된 fuzzy match까지만 허용하는 편이 안정적이다.

랭킹 순서는 제품마다 달라도 정책은 명시해야 한다. 예를 들어 B2B 문서 검색은 다음 순서로 시작할 수 있다.

1. 완전 prefix 일치와 정확한 용어 일치
2. 현재 tenant에서 볼 수 있는 문서와 활성 상태
3. locale·사용자 역할과 일치하는 종류
4. 최근성 또는 승인된 인기 점수

여기서 인기어는 전체 사용자의 raw query 빈도가 아니다. 특정 고객의 내부 프로젝트명이나 사람 이름이 전역 인기어가 되면 다른 고객에게 노출될 수 있다. tenant별 인기어는 tenant 안에서만, 전역 인기어는 애초에 공개가 허용된 corpus에서만 계산한다. 개별 입력을 후보 사전에 자동 편입하는 기능은 최소 k-anonymity, 예를 들어 서로 다른 사용자 20명 이상, 민감어 제외 규칙, 사람이 보는 검토 큐를 통과하기 전까지 끈다.

### 3) cache key는 성능 키가 아니라 접근 제어 키다

가장 흔한 누출은 normalized query 하나로 cache entry를 공유하는 것이다. A 테넌트에서 생성한 alpha 후보가 B 테넌트에도 재사용되고, 상세 화면에서만 403이 나더라도 이미 제목이나 고객명은 보였다. permission filter를 index 조회 뒤에 적용해도 cache가 그 앞에 있으면 같은 문제가 생긴다.

최소한 아래 정보는 결과를 구분하는 cache key 또는 cache namespace에 포함한다.

~~~text
suggest:{tenant_id}:{visibility_scope}:{role_bucket}:{locale}:{index_version}:{normalized_prefix}
~~~

user ID까지 넣으면 안전하지만 hit rate가 급격히 떨어진다. 그래서 권한이 역할·조직 단위로 균일할 때만 role bucket을 쓸 수 있으며, 문서별 ACL이나 공유 링크처럼 사용자별 권한이 다르면 user-level filtering 또는 user-scoped cache가 필요하다. 판단 기준은 hit rate가 아니라 **같은 cache entry를 공유하는 두 사용자가 항상 같은 후보 집합을 볼 수 있는가**다.

권한 삭제와 문서 비공개 전환도 따로 설계한다. cache TTL이 5분이라면 최대 5분 동안 이전 후보가 남을 수 있다. 법적 삭제, 퇴사자 접근 차단, 보안 문서 분류 변경은 TTL 만료를 기다리지 않고 tag/namespace purge 또는 policy version 증가로 즉시 무효화해야 한다. 이것은 [검색 권한 필터와 정보 누출 방지](/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/)의 filter 문제가 cache 계층에도 그대로 이어진다는 뜻이다.

### 4) 입력 문자열은 로그 데이터가 아니라 잠재적인 민감 데이터다

사용자는 검색창에 주문번호, 이메일, 주민등록번호처럼 보이는 문자열, 장애 티켓의 비밀값 일부를 붙여 넣을 수 있다. 자동완성은 제출 전부터 이 입력을 서버로 보내므로, access log의 URL query, APM span attribute, 오류 dump, analytics warehouse로 원문을 복제하면 보존 위치가 순식간에 늘어난다.

기본 원칙은 원문을 **metric label과 일반 애플리케이션 로그에 기록하지 않는 것**이다. 관측에는 query length bucket, script type, cache hit, result count, latency, tenant class, rejection reason처럼 복원 불가능한 정보를 쓴다. 품질 개선을 위해 표본이 필요하다면 명시적인 목적과 접근 권한, 7~30일 같은 짧은 보존 기간, 이메일·전화번호·token 형태를 먼저 제거하는 필터, tenant별 opt-out과 삭제 요청 경로를 함께 둔다.

해시만 남기면 안전하다고 단정할 수도 없다. 짧고 예측 가능한 검색어는 사전 대입으로 다시 추정될 수 있다. raw query 기반 대시보드보다 aggregate 품질 지표를 우선하고, 원문 표본은 정말 필요한 조사에 한정하는 편이 낫다.

## 실무 적용

### 1) 요청 경로를 세 단계로 나눈다

첫 단계는 client debounce와 취소다. 보통 150~250ms debounce, 이전 요청의 abort, 동일 입력의 중복 방지를 적용한다. 다만 client가 이를 지킨다고 가정하지 말고 서버도 per-session 또는 per-principal 동시 요청을 2~3개로 제한한다. 봇이나 오래된 client는 debounce 없이 들어온다.

둘째 단계는 authorization-aware cache다. cache hit이면 최대 10개만 즉시 반환한다. miss이면 같은 prefix와 policy version의 동시 miss를 [Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)로 합쳐 index 조회 한 번으로 만든다. 합치는 범위도 tenant와 visibility scope를 넘으면 안 된다.

셋째 단계는 bounded index lookup과 축소 응답이다. index timeout을 70~90ms로 두고 서버 전체 120ms deadline을 넘기지 않는다. 실패했을 때 full search를 동기 호출하면 자동완성이 장애 증폭기가 된다. 공개 카탈로그 서비스라면 안전한 고정 카테고리를, 내부 문서 서비스라면 빈 후보와 재시도 가능한 상태를 돌려주는 편이 맞다.

~~~text
client debounce -> auth/context 검증 -> scoped cache -> coalesced index lookup
                                                  -> timeout 시 안전한 축소 응답
~~~

### 2) 색인 갱신과 배포를 별도 버전으로 다룬다

자동완성의 품질은 index freshness에 달렸지만, 모든 변경을 실시간으로 반영할 필요는 없다. 상품·공개 문서처럼 5분 이내 반영이 허용되는 corpus와, 권한 회수처럼 즉시 반영해야 하는 policy change를 구분한다. index event에는 entity ID, visibility, tenant ID, locale, updated time, index version을 넣고, indexer가 lag 또는 실패 상태일 때 어느 버전을 서빙하는지 보이게 한다.

새 analyzer나 ranking rule은 기존 index를 덮어쓰지 말고 vNext index를 만든 뒤, 1~5% tenant canary에서 클릭률만이 아니라 0-result rate, 권한 거부, fallback, p95/p99를 비교한다. 자동완성 ranking이 좋아져도 unauthorized candidate가 한 건이라도 나오면 즉시 중단 조건이다. [검색 인덱스 동기화와 Reindex](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/)의 alias 전환·rollback 전략을 적용하면 index build 실패가 사용자 경로로 번지는 일을 줄일 수 있다.

### 3) 운영 기준은 RPS보다 입력 비용으로 계산한다

검색 결과 API가 초당 100건이라고 해서 자동완성도 초당 100건인 것은 아니다. 활성 사용자 1,000명이 평균 6회 입력 요청을 만들면 burst는 훨씬 커진다. 추정과 실제를 분리해 request rate, active search당 요청 수, cancelled request rate, p95/p99, index timeout rate, fallback rate, cache hit rate, coalesced miss count, index lag를 시작점으로 둔다.

예를 들어 p95가 120ms를 10분 넘게 초과하거나 index timeout이 1%를 넘으면 fuzzy match를 먼저 끄고 결과 수를 10개에서 5개로 낮춘다. cache miss가 늘었는데 index lag도 증가한다면 cache TTL을 무작정 늘리기보다 indexer backlog와 permission invalidation 경로를 확인한다. [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/)처럼 한 endpoint의 평균보다 어떤 비용을 어디까지 지불할지 먼저 선언해야 대응 순서가 흔들리지 않는다.

## 트레이드오프/주의점

1. **더 빠른 cache는 더 긴 노출 창을 만들 수 있다.** TTL을 30분으로 늘리면 hit rate는 좋아지지만 비공개 전환·재고 변경·권한 회수의 반영이 늦어진다. 공개 데이터와 권한 민감 데이터를 같은 TTL로 다루지 말아야 한다.

2. **fuzzy match는 좋은 UX와 enumeration 공격을 동시에 키운다.** 1자 입력, edit distance 2 이상, 무제한 후보는 데이터 탐색 API가 된다. 최소 길이, 결과 수, principal별 rate limit, 민감 corpus 제외를 같이 둔다.

3. **개인화 ranking은 cache 공유를 어렵게 만든다.** 개인화로 얻는 클릭률이 미미하다면 tenant/role 단위 ranking이 운영 비용과 privacy risk가 더 낮다. 개인화가 필요하면 cache를 사용자 범위로 내리고 비용을 받아들여야 한다.

4. **빈 결과는 항상 실패가 아니다.** 권한상 볼 수 없는 후보를 감추기 위해서는 빈 결과가 맞을 수 있다. 0 results를 무조건 reindex 장애로 경보내지 말고, access policy와 query length를 함께 본다.

## 체크리스트 또는 연습

- [ ] suggest API의 최소·최대 입력 길이, 최대 후보 수, deadline, fallback가 API 문서에 고정되어 있다.
- [ ] tenant·visibility·locale·index version이 cache 및 coalescing 경계에 포함되어 있다.
- [ ] 권한을 막은 문서와 다른 tenant의 문서가 suggestion, cache hit, 인기어 집계 어디에서도 보이지 않는 회귀 테스트가 있다.
- [ ] URL, application log, trace attribute, metric label에 raw query가 남지 않는지 샘플 요청으로 확인했다.
- [ ] index vNext를 1~5% canary로 전환하고 p95, timeout, 0-result, fallback, authorization leak 지표를 기준선과 비교한다.
- [ ] 고위험 권한 회수 시 TTL을 기다리지 않는 purge 또는 policy-version invalidation 경로가 있다.

연습으로 현재 서비스의 검색창 한 곳을 고른 뒤, 사용자 한 명이 10초 동안 만드는 최대 요청 수와 prefix당 최대 후보 수를 적어 보자. 이어서 cache key를 써 보고, 서로 다른 두 tenant가 그 entry를 공유해도 되는지 판정한다. 이 짧은 작업만으로도 성능 최적화처럼 보이던 문제가 실제로는 접근 제어 설계라는 점이 드러난다.
