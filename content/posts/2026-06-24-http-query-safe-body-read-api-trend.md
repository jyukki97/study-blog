---
title: "2026-06-24 개발 트렌드: HTTP QUERY, 복잡한 읽기 API가 GET과 POST 사이의 빈칸을 메운다"
date: 2026-06-24T10:06:00+09:00
draft: false
tags: ["dev-trends", "HTTP", "API Design", "REST", "Caching", "Backend"]
categories: ["Development", "Tech Trend"]
description: "RFC 10008로 공개된 HTTP QUERY 메서드가 복잡한 읽기 요청, 캐시, 자동 재시도, API 의미론에 어떤 변화를 만드는지 실무 관점에서 정리합니다."
keywords: ["HTTP QUERY", "RFC 10008", "safe method with body", "REST API", "complex query API"]
summary: "HTTP QUERY는 본문을 가진 안전하고 멱등적인 읽기 요청을 표준화한다. 당장 모든 API를 바꿀 단계는 아니지만, 복잡한 검색·리포트 API의 GET/POST 선택지를 다시 정리하게 만든다."
key_takeaways:
  - "HTTP QUERY는 GET의 URL 한계와 POST의 의미론 혼란 사이를 메우는 safe/idempotent method다."
  - "QUERY 응답은 cacheable이지만 cache key에 request content와 metadata를 포함해야 하므로 인프라 지원을 검증해야 한다."
  - "초기 도입은 공개 API 전면 전환보다 내부 검색·리포트 API, SDK, gateway canary부터 시작하는 편이 안전하다."
operator_checklist:
  - "복잡한 조회 API 중 POST를 쓰는 경로를 inventory하고 state-changing POST와 read-only POST를 분리한다."
  - "QUERY 도입 후보는 gateway, CDN, WAF, SDK, client, observability tool의 method 지원을 먼저 테스트한다."
  - "request body canonicalization, cache key, filter hash, redaction policy를 함께 설계한다."
learning_refs:
  - title: "REST API 설계 원칙"
    href: "/learning/deep-dive/deep-dive-rest-api-design/"
    description: "HTTP method 의미론과 리소스 설계를 같이 복습합니다."
  - title: "Cursor Pagination Consistency"
    href: "/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/"
    description: "복잡한 조회 결과의 정렬, snapshot, export 전환 기준을 연결합니다."
  - title: "HTTP Caching과 ETag"
    href: "/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/"
    description: "QUERY가 cacheable하더라도 실제 cache key와 revalidation을 어떻게 잡을지 이어서 봅니다."
  - title: "대용량 데이터 Export 파이프라인"
    href: "/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/"
    description: "QUERY로 즉시 응답하기 어려운 긴 조회를 export job으로 분리하는 기준을 정리합니다."
---

2026년 6월, IETF Datatracker에는 RFC 10008 "The HTTP QUERY Method"가 Proposed Standard로 올라왔습니다. 이름 그대로 HTTP에 `QUERY`라는 새 메서드를 정의한 문서입니다. 요지는 단순합니다. 복잡한 검색 조건이나 리포트 조건처럼 URL에 넣기에는 크고 민감하지만, 의미상으로는 읽기인 요청을 `POST`로 애매하게 보내지 말고, **본문을 가진 safe/idempotent 읽기 요청**으로 표현하자는 흐름입니다.

이 변화는 당장 모든 API를 바꾸라는 신호는 아닙니다. 브라우저, CDN, API gateway, WAF, SDK, 로깅 도구가 새 메서드를 얼마나 자연스럽게 처리하는지는 아직 검증이 필요합니다. 그래도 백엔드 팀 입장에서는 중요합니다. 그동안 복잡한 조회 API는 `GET`과 `POST` 사이에서 늘 어색했습니다. URL query string은 길이·인코딩·로그 노출 문제가 있고, `POST /search`는 읽기 요청인데도 중간 인프라가 안전한 재시도나 캐시 의미를 알기 어렵습니다. HTTP QUERY는 이 오래된 빈칸을 표준 수준에서 메우려는 시도입니다.

이 글은 [REST API 설계 원칙](/learning/deep-dive/deep-dive-rest-api-design/), [HTTP Caching과 ETag Revalidation](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/), [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/), [대용량 데이터 Export 파이프라인](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)과 이어서 읽으면 좋습니다. 핵심은 새 메서드 자체보다 **API 의미론, 캐시 키, 필터 계약, 운영 도구 지원을 같이 설계하는 것**입니다.

## 이 글에서 얻는 것

- HTTP QUERY가 왜 GET과 POST 사이의 문제를 해결하려는지 이해할 수 있습니다.
- safe, idempotent, cacheable이라는 속성이 복잡한 읽기 API 운영에 어떤 영향을 주는지 설명할 수 있습니다.
- QUERY를 바로 도입해도 되는 API와 아직 GET/POST를 유지해야 하는 API를 구분할 수 있습니다.
- gateway, CDN, WAF, SDK, 로깅, 캐시 키까지 포함한 도입 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) GET은 공유와 캐시에 좋지만 복잡한 조건을 담기 어렵다

GET은 읽기 요청의 기본값입니다. URL이 곧 요청을 식별하므로 북마크, 공유, 캐시, 관측이 쉽습니다. `/orders?status=paid&from=2026-06-01` 같은 요청은 GET이 자연스럽습니다.

문제는 조건이 커질 때입니다. 관리자 검색, 감사 로그 필터, 리포트 조건, 복잡한 권한 조건, JSONPath류 질의는 URL에 억지로 넣기 어렵습니다. 길이 제한도 중간 시스템마다 다르고, URL은 access log, browser history, analytics, referrer 등에 더 쉽게 남습니다. 민감한 필터 값이나 고객 식별자가 URL에 들어가면 보안 리뷰에서 바로 문제가 됩니다.

그래서 많은 팀이 `POST /search`, `POST /reports/query`, `POST /graphql` 같은 형태를 씁니다. 실무적으로는 편하지만, 의미론은 흐려집니다. `POST`는 상태 변경에도 쓰이고 읽기에도 쓰이기 때문에, proxy나 retry layer가 "이 요청은 실패해도 안전하게 다시 보내도 된다"고 판단하기 어렵습니다. API 문서를 읽어야만 안전한 조회인지 알 수 있습니다.

### 2) HTTP QUERY는 "GET with body"가 아니라 safe/idempotent query operation이다

RFC 10008은 QUERY를 본문이 있는 안전하고 멱등적인 요청으로 정의합니다. 안전하다는 것은 클라이언트가 대상 리소스의 상태 변경을 요청하지 않는다는 뜻이고, 멱등적이라는 것은 같은 요청을 반복해도 의도한 효과가 같다는 뜻입니다. 즉 네트워크 오류 뒤 자동 재시도하거나, 중간 계층이 읽기 요청으로 다루기 쉬워집니다.

단순히 GET에 body를 붙이면 되지 않느냐는 질문이 나올 수 있습니다. 하지만 GET body는 생태계 지원이 불안정합니다. 많은 middlebox, framework, client library가 GET에는 body 의미가 없다고 가정해 왔습니다. QUERY는 새 메서드이므로 지원하지 않는 시스템은 명확히 거부할 수 있고, 지원하는 시스템은 request content를 조회 조건으로 해석할 수 있습니다.

중요한 세부 조건도 있습니다.

- request content와 `Content-Type`이 query의 의미를 정의한다.
- 서버는 `Content-Type`이 없거나 본문과 맞지 않으면 실패시켜야 한다.
- 지원하지 않는 query media type은 `415 Unsupported Media Type`으로 다루기 좋다.
- 문법은 맞지만 처리할 수 없는 질의는 `422 Unprocessable Content`가 어울린다.
- 서버는 `Accept-Query` 헤더로 어떤 query format을 지원하는지 알릴 수 있다.

이 구조는 API 설계를 조금 더 엄격하게 만듭니다. `POST /search`에 아무 JSON이나 넣는 방식보다, `QUERY /orders`에 `application/json` 또는 특정 query media type을 넣고, 지원 범위를 명시하는 방식이 운영에 유리합니다.

### 3) Cacheable하다는 말은 공짜 캐시가 된다는 뜻이 아니다

RFC 10008에서 QUERY 응답은 cacheable로 다뤄집니다. 하지만 여기서 실무자가 주의할 지점이 있습니다. QUERY의 cache key는 URL만 보면 안 되고, request content와 관련 metadata를 포함해야 합니다. 같은 `/orders`라도 본문 필터가 다르면 완전히 다른 결과입니다.

따라서 QUERY 캐시를 쓰려면 아래를 먼저 설계해야 합니다.

- request body canonicalization: JSON key order, whitespace, 기본값을 정규화할 것인가
- content type: `application/json`, `application/sql`, `application/jsonpath` 같은 format을 어떻게 제한할 것인가
- filter hash: 같은 질의를 같은 cache key로 묶기 위한 해시를 둘 것인가
- response variation: `Accept`, locale, timezone, authorization scope를 cache key에 포함할 것인가
- 민감정보: query body와 cache key, trace, log에 개인정보가 남지 않게 할 것인가

즉 QUERY는 캐시 가능성을 열어 주지만, 캐시 설계 난이도도 같이 드러냅니다. GET은 URL이 자연스러운 cache key였지만, QUERY는 body까지 포함한 canonical key가 필요합니다. 이 지점은 [HTTP Caching과 ETag Revalidation](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)의 사고방식을 그대로 적용해야 합니다.

### 4) 복잡한 검색 API와 export API의 경계가 더 선명해진다

QUERY가 생긴다고 모든 검색 문제가 해결되지는 않습니다. 예를 들어 100만 행짜리 정산 리포트는 QUERY로 조회하더라도 한 요청 안에서 바로 반환하면 여전히 위험합니다. 이 경우는 `QUERY`가 아니라 async export job이 맞습니다.

실무 기준은 이렇게 나눌 수 있습니다.

| 상황 | 추천 방식 |
| --- | --- |
| 짧고 공유 가능한 필터 | `GET` 유지 |
| URL에 넣기 큰 읽기 조건, 즉시 응답 가능 | `QUERY` 후보 |
| 상태 변경, 생성, 명령 실행 | `POST` 유지 |
| 수십 초 이상 걸리는 리포트·파일 생성 | `POST /exports` + operation resource |
| cursor 기반 탐색 | `GET` 또는 `QUERY` + cursor contract |

이 구분이 중요합니다. QUERY는 "복잡한 읽기 요청"을 표현하는 방법이지, 긴 작업을 동기화하는 방법이 아닙니다. p95 응답이 3초를 넘거나 결과가 10MB를 넘을 수 있으면 [Async Request-Reply](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/) 또는 [대용량 Export 파이프라인](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)으로 분리하는 편이 안전합니다.

### 5) 표준화와 실전 도입 사이에는 시간이 있다

Kreya는 2026년 6월 글에서 QUERY 지원을 소개하면서도, 클라이언트·프록시·웹서버 지원이 제한적일 수 있다고 짚었습니다. 이 판단은 현실적입니다. HTTP 메서드는 문자열이라 이론상 쉽게 보이지만, 실제 운영 경로에는 많은 장비와 라이브러리가 끼어 있습니다.

특히 확인해야 할 것들:

- API gateway가 `QUERY`를 허용하는가
- WAF나 reverse proxy가 unknown method를 차단하지 않는가
- CORS preflight와 allowed methods 설정이 맞는가
- SDK generator와 API 문서 도구가 QUERY를 표현할 수 있는가
- observability 도구가 method별 latency/error를 정상 집계하는가
- CDN/cache가 body 포함 cache key를 지원하는가
- load test와 canary에서 405/501/403이 튀지 않는가

따라서 2026년 현재의 결론은 "새 API 전부를 QUERY로 만들자"가 아닙니다. 더 정확히는 **read-only POST를 inventory하고, 복잡한 조회 API의 다음 선택지로 QUERY를 실험할 시점이 왔다**입니다.

## 실무 적용

### 1) 먼저 read-only POST를 분류한다

첫 단계는 코드 변경이 아니라 inventory입니다. 최근 90일 로그에서 `POST` 중 실제로 상태 변경이 없는 API를 뽑아 봅니다. 예를 들면 아래 같은 경로입니다.

- `POST /search`
- `POST /orders/query`
- `POST /reports/preview`
- `POST /audit-logs/filter`
- `POST /graphql` 중 query operation

그리고 각 API에 아래 값을 붙입니다.

- 평균/최대 request body 크기
- p95 응답 시간
- 결과 크기
- 캐시 가능 여부
- 민감 필터 포함 여부
- 공유/북마크 필요 여부
- gateway/CDN/WAF 통과 경로

이 중 body가 **2KB 이상** 자주 나오고, URL 공유가 핵심 UX가 아니며, 응답이 **3초 이하**로 끝나는 read-only API가 QUERY 후보입니다. 반대로 결과 생성이 길거나 파일을 만들어야 하면 export job이 후보입니다.

### 2) 도입 순서는 내부 API canary가 좋다

공개 API부터 바꾸면 client 호환성 이슈가 바로 고객 문제가 됩니다. 처음에는 사내 관리자 API, internal service API, BFF와 backend 사이의 검색 API처럼 통제 가능한 경로가 좋습니다.

권장 순서:

1. 기존 `POST /orders/query` 유지
2. 같은 로직으로 `QUERY /orders` 추가
3. gateway, WAF, tracing, access log, metrics에서 method 처리 확인
4. SDK와 API 문서 생성 확인
5. 5~10% 내부 traffic만 QUERY로 전환
6. 4xx/5xx, latency, cache hit, retry 동작 비교
7. 문제가 없으면 신규 client부터 QUERY 사용

하위 호환을 위해 한동안 POST fallback을 유지하는 것이 현실적입니다. QUERY는 의미론을 선명하게 만들지만, 지원하지 않는 client에게는 여전히 장벽입니다.

### 3) Query body 계약을 느슨하게 두지 않는다

QUERY를 도입할 때 가장 위험한 설계는 "body에 아무 JSON이나 받는다"입니다. 그러면 `POST /search`의 모호함이 메서드 이름만 바꾼 채 남습니다. 최소한 아래를 고정합니다.

- 허용 필터 목록
- 필터별 타입과 최대 배열 길이
- 날짜/timezone 해석 기준
- 최대 결과 크기와 page size
- 정렬 가능한 컬럼 목록
- default value와 canonicalization 규칙
- unsupported filter 처리 방식

숫자 기준도 필요합니다.

- 단일 QUERY body 최대 **32KB**부터 시작
- page size 기본 **50~100**, 최대 **500**
- filter 배열 길이 최대 **100개**
- 응답 body 최대 **1~5MB**, 초과 시 export job 유도
- query timeout **1~2초**, 무거운 분석성 질의는 별도 경로

이 기준이 없으면 QUERY는 "안전한 읽기"라는 이름의 비싼 임의 질의 실행기가 됩니다.

### 4) 에러와 관측성을 표준화한다

QUERY API는 실패 이유를 기계적으로 분리해야 운영이 쉽습니다.

- `400 Bad Request`: Content-Type 누락, body 형식 불일치
- `406 Not Acceptable`: 요청한 응답 format 미지원
- `415 Unsupported Media Type`: query media type 미지원
- `422 Unprocessable Content`: 문법은 맞지만 의미적으로 처리 불가
- `429 Too Many Requests`: query cost 또는 rate limit 초과
- `503 Service Unavailable`: downstream 보호를 위한 일시 거부

Metric은 최소한 `method=QUERY`, `resource`, `query_shape`, `filter_hash_prefix`, `cache_hit`, `result_count_bucket`, `body_size_bucket` 정도를 보면 좋습니다. 단, 원문 query body를 로그에 남기는 것은 피해야 합니다. 특히 고객 이름, 이메일, 전화번호, 계정 id 같은 값은 필터에 자주 들어갑니다.

## 트레이드오프/주의점

첫째, 지원 범위가 아직 넓지 않을 수 있습니다. RFC가 나왔다고 해서 모든 proxy와 client가 바로 지원하는 것은 아닙니다. 운영 경로에 unknown method 차단 정책이 있으면 405, 501, 403이 섞여 나올 수 있습니다.

둘째, 공유 가능한 URL이 필요한 화면에는 GET이 여전히 낫습니다. 필터 상태를 링크로 공유해야 하는 관리자 화면, 검색 결과 북마크, 문서화된 공개 API는 GET query string이 더 단순할 수 있습니다. QUERY는 body에 조건이 들어가므로 일반 사용자가 URL만 복사해 같은 결과를 재현하기 어렵습니다.

셋째, 캐시는 더 강력하지만 더 어렵습니다. request body canonicalization이 없으면 같은 의미의 질의가 다른 cache key가 되고, authorization scope를 cache key에 넣지 않으면 데이터가 섞일 수 있습니다. QUERY 캐시는 반드시 보수적으로 시작해야 합니다.

넷째, QUERY는 상태 변경을 숨기는 통로가 되면 안 됩니다. 서버가 "조회하면서 최근 조회 시각 업데이트", "조회하면서 추천 로그 반영", "조회하면서 임시 리소스 영구 생성" 같은 부작용을 넣기 시작하면 safe 의미가 깨집니다. 부수 로그나 metric은 가능하더라도, 비즈니스 상태 변경은 POST로 분리해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 현재 `POST /search`, `POST /query`류 API를 read-only와 state-changing으로 분류했다.
- [ ] QUERY 후보 API의 body 크기, 응답 시간, 결과 크기, 캐시 가능성을 측정했다.
- [ ] gateway, WAF, CDN, SDK, API 문서, tracing이 `QUERY` method를 처리하는지 canary로 확인했다.
- [ ] `Content-Type`, `Accept`, `Accept-Query`, error status code 정책을 문서화했다.
- [ ] request body canonicalization과 cache key 정책을 정의했다.
- [ ] 민감 필터 값이 URL, log, trace, cache key에 원문으로 남지 않게 했다.
- [ ] p95 3초 초과 또는 10MB 초과 결과는 QUERY가 아니라 export job으로 분리한다.

### 연습

1. 서비스에서 `POST`를 쓰는 조회 API 5개를 찾아, 상태 변경 여부와 QUERY 전환 가능성을 표로 적어 보세요.
2. 가장 복잡한 검색 API 하나를 골라 `GET`, `QUERY`, `POST /exports` 중 어떤 경로가 맞는지 행 수·응답 시간·공유 필요성 기준으로 판단해 보세요.
3. JSON body의 key order와 기본값이 달라도 같은 질의로 취급되도록 canonicalization 규칙을 설계해 보세요.
4. API gateway가 QUERY를 막는다고 가정하고, fallback 전략과 client migration 순서를 작성해 보세요.

## 참고한 흐름

- RFC 10008: The HTTP QUERY Method  
  https://datatracker.ietf.org/doc/rfc10008/
- Kreya: The new HTTP QUERY method explained  
  https://kreya.app/blog/new-http-query-method-explained/
- http.dev: QUERY method guide  
  https://http.dev/query

오늘의 결론은 이렇습니다. HTTP QUERY는 REST 설계의 만병통치약이 아니라, 복잡한 읽기 요청의 의미를 더 정확히 표현하는 새 도구입니다. 좋은 팀은 새 메서드를 유행처럼 쓰기보다, read-only POST를 정리하고, cache key와 보안 로그를 정돈하고, 지원 가능한 경로부터 조용히 canary를 걸 것입니다.
