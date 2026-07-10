---
title: "백엔드 커리큘럼 심화: Response Payload Budget, 큰 응답을 안전하게 내려주는 법"
date: 2026-07-10
draft: false
topic: "Backend Reliability"
tags: ["API Design", "Response Payload", "Pagination", "Field Projection", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "목록·상세·대시보드 API에서 응답 크기, 필드 선택, 페이지네이션, export 전환 기준을 숫자 중심으로 정리합니다."
module: "backend-resilience"
study_order: 1252
key_takeaways:
  - "응답 크기는 네트워크 비용만이 아니라 DB 조회, JSON 직렬화, 캐시, 모바일 렌더링, 장애 전파까지 흔든다."
  - "목록 API는 page size, payload budget, field projection, export job 전환 기준을 함께 가져야 한다."
  - "큰 응답을 압축만으로 해결하지 말고 pagination, partial response, read model, async export 중 하나로 분리해야 한다."
operator_checklist:
  - "endpoint별 response size p95/p99, row count, serialization time, client abort count를 대시보드에 올린다."
  - "p95 응답이 500KB를 넘거나 1,000행 이상 목록을 반환하면 pagination 또는 projection을 재검토한다."
  - "10MB 이상 결과나 5초 이상 생성 작업은 동기 API가 아니라 export job 또는 operation resource로 분리한다."
learning_refs:
  - title: "API Resource Budgeting"
    href: "/learning/deep-dive/deep-dive-api-resource-budgeting/"
    description: "요청 하나가 CPU, DB, 외부 호출, payload 예산을 얼마나 쓰는지 계산하는 기준입니다."
  - title: "Cursor Pagination Consistency"
    href: "/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/"
    description: "큰 목록 API를 stable sort와 cursor token으로 안전하게 나누는 방법입니다."
  - title: "Large Data Export Pipeline"
    href: "/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/"
    description: "대형 결과를 동기 응답이 아니라 파일 생성 파이프라인으로 분리하는 기준입니다."
decision_guide:
  cases:
    - badge: "동기 응답"
      title: "작고 자주 보는 화면 API"
      fit: "p95 응답 500KB 이하, p95 latency 300~500ms 이하, 결과 행 수 100개 이하인 경로"
      watchouts: "필드가 계속 추가되면 모바일 렌더링과 캐시 효율이 먼저 나빠진다."
      next_step: "기본 필드 세트와 optional projection을 문서화한다."
    - badge: "분리 권장"
      title: "대형 목록·리포트·관리자 검색"
      fit: "1,000행 이상, 10MB 이상, 5초 이상 생성, 공유·감사가 필요한 결과"
      watchouts: "동기 JSON으로 유지하면 timeout, 재시도, 중복 쿼리가 부하를 증폭한다."
      next_step: "cursor pagination, async export, object storage artifact 중 하나로 전환한다."
faqs:
  - question: "gzip을 켜면 큰 응답 문제는 해결되나요?"
    answer: "아닙니다. 전송 바이트는 줄어도 DB 조회, JSON 직렬화, 메모리, 클라이언트 파싱 비용은 남습니다. 압축은 보조 수단이고, 응답 계약 자체를 줄여야 합니다."
  - question: "필드 선택 API는 언제 필요한가요?"
    answer: "같은 리소스를 모바일, 웹, 관리자, 배치가 서로 다른 필드 세트로 쓰고 응답 p95가 500KB를 넘기 시작하면 검토할 만합니다."
---

큰 요청 본문을 제한하는 팀은 많지만, 큰 응답을 제한하는 팀은 의외로 적습니다. `GET /orders`가 처음에는 20개 주문의 요약만 내려주다가, 나중에는 결제 정보, 배송 상태, 쿠폰, 리뷰 가능 여부, 추천 액션까지 붙습니다. 화면은 편해지지만 응답은 조용히 커지고, 어느 날 모바일 앱에서 스크롤이 끊기고 API p95가 1초를 넘고 CDN 비용이 늘어납니다. 서버 로그에는 에러가 없습니다. 단지 **너무 많이 내려주는 계약**이 기본값이 된 것입니다.

응답 payload는 네트워크 바이트만의 문제가 아닙니다. DB에서 더 많은 row와 column을 읽고, 애플리케이션이 더 큰 객체 그래프를 만들고, JSON serializer가 CPU를 쓰고, 캐시는 더 큰 값을 저장하며, 클라이언트는 그 값을 다시 파싱하고 렌더링합니다. 특히 관리자 검색, 대시보드, 피드, 주문 목록처럼 자주 보는 API에서 응답 크기 관리를 놓치면 작은 기능 추가가 누적되어 성능 사고로 바뀝니다.

이 글은 [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/), [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/), [Large Data Export Pipeline](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/), [HTTP Caching과 ETag](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)와 이어집니다. 핵심은 "빠르게 직렬화하기"가 아니라, **어떤 필드를 지금 내려줄 자격이 있는지, 어디서부터 나눌지, 언제 파일 생성으로 넘길지**를 계약으로 만드는 것입니다.

## 이 글에서 얻는 것

- 응답 크기가 DB, 애플리케이션 CPU, 캐시, 네트워크, 클라이언트 렌더링에 어떤 비용을 만드는지 이해합니다.
- 목록·상세·대시보드 API에서 page size, field projection, partial response 기준을 숫자로 잡을 수 있습니다.
- gzip, pagination, read model, async export를 어떤 순서로 검토할지 의사결정 기준을 가져갑니다.
- 큰 응답에서 관측해야 할 지표와 PR 리뷰 체크리스트를 정리합니다.

## 핵심 개념/이슈

### 1) 큰 응답은 서버 바깥에서도 비용을 만든다

응답 payload가 커지면 서버의 outbound traffic만 증가한다고 생각하기 쉽습니다. 실제 비용은 더 넓습니다.

| 구간 | 커지는 비용 | 자주 보이는 증상 |
| --- | --- | --- |
| DB | 더 많은 row/column, join, sort | `rows_examined`, temp table 증가 |
| App | 객체 생성, 직렬화 CPU, heap | GC 증가, p95 지연 상승 |
| Cache | key별 value 크기, eviction | hit ratio 하락, Redis memory 증가 |
| Network | 전송 시간, CDN 비용 | 모바일 지연, client abort |
| Client | JSON parse, 렌더링, 메모리 | 스크롤 끊김, 저사양 기기 crash |

그래서 응답 크기 예산은 API 성능 예산의 일부로 봐야 합니다. [Request Body Guardrail](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)이 입구를 지키는 장치라면, Response Payload Budget은 출구를 지키는 장치입니다.

초기 기준은 아래처럼 둘 수 있습니다.

| API 유형 | 권장 시작 예산 |
| --- | --- |
| 모바일 목록 | page size 20~50, p95 payload 200KB 이하 |
| 웹 목록 | page size 50~100, p95 payload 500KB 이하 |
| 상세 화면 | p95 payload 300KB 이하, optional section lazy load |
| 관리자 검색 | page size 100 이하, 1,000행 초과는 export 유도 |
| 대시보드 | 카드별 부분 조회, 전체 payload 1MB 이하 |
| 파일/리포트 | 10MB 이상 또는 5초 이상이면 async export |

숫자는 서비스마다 달라질 수 있습니다. 중요한 것은 "응답이 클 수도 있음"을 방치하지 않고, endpoint마다 설명 가능한 예산을 둔다는 점입니다.

### 2) 필드 추가는 하위 호환처럼 보이지만 성능 호환성을 깨뜨릴 수 있다

REST나 JSON API에서 필드 추가는 보통 non-breaking change로 분류됩니다. 기존 클라이언트가 모르는 필드를 무시할 수 있기 때문입니다. 하지만 성능 관점에서는 이야기가 다릅니다. 새 필드 하나가 추가 join을 만들고, N+1 조회를 유발하고, 캐시 value를 2배 키우고, 모바일 앱의 파싱 시간을 늘릴 수 있습니다.

특히 위험한 필드는 아래입니다.

- 이미지 목록, 큰 HTML/Markdown 본문, base64 인라인 데이터
- 권한 계산 결과처럼 사용자별로 달라져 캐시를 깨는 필드
- 외부 API 호출이나 별도 microservice fan-out이 필요한 필드
- 배열 안에 또 다른 배열을 넣는 nested collection
- 관리자 화면에서만 쓰는 진단 필드를 일반 사용자 API에 섞는 경우

필드 추가 PR에서는 최소 세 가지를 확인해야 합니다. 첫째, 이 필드가 기본 응답에 꼭 필요한가. 둘째, 필드를 계산하는 비용이 p95에서 얼마인가. 셋째, 클라이언트가 lazy load나 별도 endpoint로 받을 수 있는가. 이 질문 없이 "필드 추가는 안전하다"고 보면 응답 계약이 계속 비대해집니다.

### 3) Field projection은 만능이 아니라 계약 축소 도구다

`fields=id,title,status` 같은 field projection은 유용하지만 잘못 쓰면 캐시 키 폭발과 권한 버그를 만듭니다. 모든 필드를 마음대로 조합하게 하면 API 제공자는 조합 수만큼 테스트해야 하고, 캐시는 `fields` 조합마다 갈라집니다. 그래서 실무에서는 자유 조합보다 **named projection**이 더 안정적입니다.

예시:

```yaml
GET /orders?view=summary
views:
  summary:
    fields: [id, status, total_price, created_at]
    max_payload_p95: 200KB
  detail:
    fields: [id, status, items, payment, shipment, available_actions]
    max_payload_p95: 500KB
  admin_audit:
    fields: [id, status, payment, shipment, risk_flags, audit_refs]
    auth: order.audit.read
    max_payload_p95: 1MB
```

이렇게 하면 클라이언트는 필요한 형태를 고를 수 있고, 서버는 각 projection의 비용과 권한을 테스트할 수 있습니다. 필드 단위 자유 선택이 필요하다면 allowlist를 두고, nested collection과 민감 필드는 별도 projection으로 분리하는 편이 좋습니다.

### 4) Pagination은 성능 기능이 아니라 응답 계약이다

큰 목록에서 pagination을 나중에 붙이면 클라이언트 계약을 바꾸기 어렵습니다. 처음부터 목록 API에는 page size 상한, 정렬 기준, 다음 페이지 토큰, snapshot/live 기준이 들어가야 합니다.

운영 기준:

- 기본 page size: 20~50
- 최대 page size: 일반 사용자 100, 관리자 200 이하부터 시작
- offset 10,000 초과 접근: 차단 또는 export 유도
- cursor token invalid rate: 1% 초과 시 클라이언트 사용 방식 점검
- 목록 응답 p95 payload: 500KB 초과 시 projection 또는 page size 축소 검토

정렬이 흔들리는 목록에서는 [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/) 기준이 필요합니다. 단순히 `limit`만 붙인다고 해결되지 않습니다. stable sort, tie-breaker, cursor token, 삭제/삽입 중복 처리까지 API 계약에 포함해야 합니다.

### 5) Export는 "큰 다운로드 버튼"이 아니라 별도 파이프라인이다

관리자나 파트너가 "전체 데이터를 한 번에 받고 싶다"고 요구하면 동기 API에 `size=100000`을 열어주기 쉽습니다. 이 방식은 위험합니다. 사용자는 기다리다 timeout을 만나고, 브라우저나 gateway가 재시도하고, 서버는 같은 대형 쿼리를 여러 번 실행합니다.

아래 조건 중 하나라도 맞으면 export job으로 분리하는 편이 안전합니다.

- 결과가 10MB 이상이다.
- 생성 시간이 p95 5초를 넘는다.
- 행 수가 10,000개 이상이다.
- 파일 공유, 감사, 재다운로드, 만료가 필요하다.
- DB snapshot 기준이나 권한 검증 기록이 필요하다.

이때 응답은 `202 Accepted`와 `operation_id`를 주고, 상태 조회 API와 완료 artifact URL을 제공합니다. 자세한 흐름은 [Large Data Export Pipeline](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)과 [Async Request-Reply Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)를 따르면 됩니다.

## 실무 적용

### 1) Endpoint별 response budget 표를 만든다

먼저 모든 API를 완벽히 고치려 하지 말고, 트래픽 상위 20개 endpoint부터 표를 만듭니다.

```yaml
endpoint: GET /orders
default_view: summary
page_size_default: 30
page_size_max: 100
payload_budget:
  p95_bytes: 300KB
  p99_bytes: 700KB
latency_budget:
  p95: 400ms
  p99: 1s
expensive_fields:
  - items
  - shipment_tracking
  - available_actions
fallback:
  over_budget: reduce_optional_sections
  export_threshold_rows: 10000
observability:
  labels: [endpoint, view, client_type]
```

이 표가 있으면 새 필드를 추가할 때 "응답이 커질 것 같다"가 아니라 "summary p95 예산을 넘는가"로 리뷰할 수 있습니다.

### 2) 계측은 byte, row, time을 같이 본다

큰 응답 관측에는 최소 아래 지표가 필요합니다.

- `response_size_bytes` p50/p95/p99
- `row_count` 또는 item count
- `serialization_duration_ms`
- `db_rows_read`와 `db_query_count`
- `cache_value_size_bytes`
- `client_abort_count`
- `export_suggested_count`
- `projection_name` 또는 `view`

응답 크기만 보면 원인을 놓칩니다. 800KB 응답이어도 DB는 가볍고 이미지 URL 배열만 큰 경우와, 200KB 응답인데 외부 API 6개 fan-out이 붙은 경우는 조치가 다릅니다. 전자는 projection과 CDN, 후자는 [API Composition/Aggregation](/learning/deep-dive/deep-dive-api-composition-aggregation-playbook/)이나 deadline budget 쪽을 봐야 합니다.

### 3) PR 리뷰 기준을 짧게 고정한다

응답 필드 추가 PR에서는 아래 질문을 기본 템플릿으로 둡니다.

1. 기본 응답에 포함되어야 하는 필드인가, optional view로 충분한가?
2. 해당 필드가 추가 query, 외부 호출, 권한 계산, 큰 문자열/배열을 만들지 않는가?
3. p95 response size와 serialization time 변화가 측정되었는가?
4. 모바일/저사양 클라이언트에서 parse와 렌더링 비용을 감당할 수 있는가?
5. 캐시 key 또는 CDN cacheability를 깨지 않는가?
6. 1,000행 이상 또는 10MB 이상 결과는 export job으로 유도되는가?

이 기준은 기능팀을 귀찮게 하려는 절차가 아니라, API가 조용히 무거워지는 것을 막는 최소 안전장치입니다.

### 4) 단계적 개선 순서

1단계는 관측입니다. 상위 endpoint의 response size와 serialization time을 수집합니다.

2단계는 page size 상한입니다. 무제한 목록과 큰 offset 접근을 막습니다.

3단계는 projection입니다. `summary`, `detail`, `admin`처럼 named view를 나눕니다.

4단계는 async export입니다. 큰 결과는 동기 JSON에서 빼고 operation resource와 artifact로 전환합니다.

5단계는 read model과 캐시입니다. 반복적으로 같은 큰 조합을 만들면 API마다 join하지 말고 별도 read model 또는 materialized view를 검토합니다.

## 트레이드오프/주의점

첫째, projection은 API 표면을 늘립니다. view가 2~3개일 때는 좋지만, 10개를 넘으면 사실상 새 API 버전 관리 문제가 됩니다. view owner와 deprecation 기준을 같이 둬야 합니다.

둘째, page size를 너무 작게 줄이면 클라이언트 왕복이 늘어납니다. 모바일 목록에서 10개씩만 내려주면 payload는 작아도 화면 전환이 자주 끊길 수 있습니다. page size는 response byte, user scroll pattern, cache hit ratio를 같이 보고 정해야 합니다.

셋째, gzip이나 Brotli는 전송 비용을 줄이지만 서버 내부 비용을 없애지 않습니다. 직렬화 전 객체 생성, DB 조회, 권한 계산은 그대로 남습니다. 압축률이 높다는 이유로 큰 응답 계약을 방치하면 나중에 export나 projection으로 빼기가 더 어려워집니다.

넷째, export job은 운영 복잡도를 추가합니다. 상태 저장, 만료, 재다운로드, 권한 재검증, 파일 삭제 정책이 필요합니다. 하지만 큰 결과를 동기 API에 계속 얹는 것보다 장애 반경이 작고 사용자 경험도 예측 가능합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 트래픽 상위 20개 API의 response size p95/p99를 알고 있다.
- [ ] 목록 API에 page size 기본값과 최대값이 문서화되어 있다.
- [ ] 기본 응답 필드와 optional projection이 구분되어 있다.
- [ ] 10MB 이상 또는 5초 이상 결과는 export job으로 전환하는 기준이 있다.
- [ ] 새 필드 추가 PR에서 serialization time과 cache 영향이 확인된다.
- [ ] client abort, cursor invalid, export suggested 지표를 운영 대시보드에서 본다.

### 연습 과제

1. 현재 서비스의 목록 API 하나를 골라 p95 response size, item count, serialization time을 측정해 보세요. 예산을 넘는다면 page size 축소와 projection 중 무엇이 먼저인지 판단합니다.
2. 주문 상세 API를 `summary`, `detail`, `admin_audit` 세 projection으로 나누고 각 projection의 필드, 권한, p95 payload 예산을 적어 보세요.
3. 관리자 검색에서 10,000행 결과가 필요한 상황을 가정하고, 동기 API 유지와 export job 전환을 latency, DB 부하, 사용자 경험, 감사 가능성 기준으로 비교해 보세요.

## 관련 글

- [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/)
- [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)
- [Large Data Export Pipeline](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)
- [Request Body Guardrail](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)
- [HTTP Caching과 ETag](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)
