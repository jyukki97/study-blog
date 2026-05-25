---
title: "백엔드 커리큘럼 심화: Cursor Pagination Consistency, 변하는 목록에서 중복·누락을 줄이는 기준"
date: 2026-05-25T10:06:00+09:00
draft: false
topic: "Backend Data Access"
tags: ["Cursor Pagination", "Keyset Pagination", "API Design", "Database", "Consistency", "Backend"]
categories: ["Backend Deep Dive"]
description: "대용량 목록 API에서 offset pagination을 cursor/keyset pagination으로 바꿀 때, 정렬 안정성·동시 변경·커서 토큰·snapshot 기준을 어떻게 설계할지 실무 숫자로 정리합니다."
summary: "Cursor pagination은 빠른 다음 페이지 조회만의 문제가 아닙니다. stable sort, tie-breaker, cursor token, snapshot/live 기준을 함께 정해야 변하는 목록에서도 중복·누락을 줄일 수 있습니다."
key_takeaways:
  - "변경이 잦은 목록에서는 offset보다 cursor/keyset이 유리하지만, stable sort와 unique tie-breaker가 없으면 중복·누락 문제는 그대로 남는다."
  - "cursor token은 마지막 row id가 아니라 sort key, filter hash, 만료, 필요 시 snapshot 기준을 담는 API 계약으로 봐야 한다."
  - "피드·알림은 live cursor, 정산·감사·export는 snapshot 또는 job 기반 흐름처럼 목록의 업무 성격에 따라 일관성 수준을 나눠야 한다."
operator_checklist:
  - "ORDER BY와 cursor WHERE 조건이 같은 방향인지 확인한다."
  - "동점이 생기는 정렬 컬럼에는 id 같은 unique tie-breaker를 붙인다."
  - "cursor token에 version, sort key, filter hash, exp를 포함한다."
  - "cursor invalid rate, empty page rate, duplicate report, DB p95를 운영 지표로 둔다."
learning_refs:
  - title: "페이지네이션과 정렬"
    href: "/learning/deep-dive/deep-dive-pagination/"
    description: "offset pagination과 cursor pagination의 기본 차이를 먼저 정리한 글입니다."
  - title: "Partial Index와 Covering Index"
    href: "/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/"
    description: "soft delete와 필터 조건이 있는 목록 API의 인덱스 설계를 이어서 볼 수 있습니다."
  - title: "Bounded Staleness와 Read-Your-Writes"
    href: "/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/"
    description: "목록 API에서 최신성, 지연 허용, 사용자 직후 쓰기 보장을 분리해 판단하는 기준입니다."
faqs:
  - question: "cursor pagination을 쓰면 중복과 누락이 완전히 사라지나요?"
    answer: "아닙니다. stable sort, unique tie-breaker, 현재 필터에 묶인 cursor token이 같이 있어야 줄어듭니다. 정렬 기준이 자주 바뀌거나 권한 필터가 흔들리면 cursor 방식도 중복·누락을 만들 수 있습니다."
  - question: "전체 건수와 페이지 번호가 꼭 필요하면 cursor를 쓰면 안 되나요?"
    answer: "업무상 임의 페이지 이동이 핵심인 관리자 화면은 offset이나 별도 검색 결과 snapshot이 더 맞을 수 있습니다. 사용자 피드·알림·주문 내역처럼 계속 변하는 목록은 전체 count보다 다음 범위의 안정성이 더 중요합니다."
  - question: "snapshot cursor는 모든 목록에 적용하는 편이 안전한가요?"
    answer: "완전성은 좋아지지만 비용이 큽니다. 긴 transaction, 임시 결과 저장, point-in-time 검색 인덱스, export job 관리가 필요하므로 감사·정산·대량 작업처럼 재현성이 실제 가치가 있는 목록부터 적용하는 편이 현실적입니다."
module: "backend-data-system-phase"
study_order: 1242
---

목록 API는 처음에는 단순해 보입니다. `page=1&size=20`으로 시작하고, 데이터가 많아지면 `limit=20&cursor=...`로 바꾸면 끝이라고 생각하기 쉽습니다. 하지만 실무에서 어려운 부분은 성능보다 **일관성**입니다. 사용자가 피드, 주문 내역, 알림, 관리자 검색 결과를 넘기는 동안 새로운 데이터가 들어오고 기존 데이터가 수정·삭제됩니다. 이때 같은 항목이 두 번 보이거나, 중간 항목이 빠지거나, 다음 페이지 cursor가 갑자기 무효화되면 API 소비자는 "페이지네이션이 느리다"가 아니라 "데이터를 믿기 어렵다"고 느낍니다.

기초적인 offset과 cursor 차이는 [페이지네이션과 정렬](/learning/deep-dive/deep-dive-pagination/)에서 다뤘습니다. 이 글은 한 단계 더 들어가서 **변하는 목록에서 cursor pagination을 운영 가능한 계약으로 만드는 법**을 정리합니다. 함께 보면 좋은 글은 [DB 인덱스 기본](/learning/deep-dive/deep-dive-database-indexing/), [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/), [API 버전 관리](/learning/deep-dive/deep-dive-api-versioning/), [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/)입니다.

## 이 글에서 얻는 것

- offset pagination이 언제 성능 문제가 아니라 정합성 문제로 바뀌는지 판단할 수 있습니다.
- keyset pagination에서 stable sort, tie-breaker, cursor token을 어떻게 설계해야 중복·누락을 줄이는지 이해할 수 있습니다.
- snapshot cursor, live cursor, read-your-writes 보장을 어느 API에 적용할지 기준을 세울 수 있습니다.
- 목록 API를 출시하기 전 확인해야 할 인덱스, 필터, 삭제, 토큰 만료, 관측 지표 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) offset pagination은 뒤로 갈수록 느려지고, 변하는 목록에서는 흔들린다

`OFFSET 100000 LIMIT 20`은 DB가 앞의 10만 건을 건너뛰어야 해서 느립니다. 이 문제만 보면 인덱스나 쿼리 튜닝으로 어느 정도 버틸 수 있습니다. 더 큰 문제는 목록이 변할 때 발생합니다. 예를 들어 최신순 알림 목록에서 사용자가 1페이지를 본 뒤 새 알림 5건이 들어오면, 2페이지의 offset 기준이 밀립니다. 그 결과 이미 본 알림이 다시 나오거나, 원래 봐야 할 알림이 건너뛰어질 수 있습니다.

offset을 계속 써도 되는 기준은 제한적으로 잡는 편이 안전합니다.

| 조건 | 판단 |
| --- | --- |
| 전체 row 수가 1만 건 이하이고 변경 빈도가 낮음 | offset 유지 가능 |
| 관리자 내부 화면이고 정확한 page number가 중요함 | offset + 검색 조건 고정 검토 |
| 사용자 피드, 알림, 주문 내역처럼 계속 변함 | cursor/keyset 우선 |
| `OFFSET`이 5만 이상 자주 발생 | keyset 전환 후보 |
| 목록 API p95가 300ms를 넘고 DB CPU가 같이 증가 | 인덱스와 pagination 방식 동시 점검 |

즉 "몇 페이지까지 갈 수 있나"보다 **정렬 기준 사이에 새 row가 끼어드는가**가 핵심입니다. 변경이 잦은 목록에서 offset은 성능보다 사용자 경험의 일관성을 먼저 망가뜨립니다.

### 2) cursor pagination의 핵심은 stable sort와 tie-breaker다

cursor pagination은 "마지막으로 본 위치 이후를 달라"는 방식입니다. 최신순 주문 목록이라면 `created_at < last_created_at` 조건을 쓰고 `ORDER BY created_at DESC LIMIT 20`으로 조회합니다. 그런데 `created_at`만으로는 충분하지 않습니다. 같은 시각에 생성된 주문이 여러 개 있을 수 있고, DB timestamp 정밀도가 애플리케이션 생성 속도를 따라가지 못할 수 있습니다.

그래서 keyset pagination에는 반드시 tie-breaker가 필요합니다.

```sql
SELECT id, created_at, status, total_amount
FROM orders
WHERE tenant_id = :tenantId
  AND deleted_at IS NULL
  AND (
    created_at < :cursorCreatedAt
    OR (created_at = :cursorCreatedAt AND id < :cursorId)
  )
ORDER BY created_at DESC, id DESC
LIMIT :limit_plus_one;
```

여기서 `created_at DESC, id DESC`가 stable order입니다. `id`는 같은 `created_at` 안에서 순서를 고정하는 tie-breaker입니다. 반대로 `ORDER BY updated_at DESC`처럼 수정될 때마다 값이 바뀌는 필드를 기준으로 삼으면 항목이 페이지 사이를 이동합니다. 검색 결과처럼 점수가 변하는 목록도 마찬가지입니다. 이런 경우에는 cursor에 `score + id`를 넣거나, snapshot 기준을 별도로 둬야 합니다.

출발 규칙은 간단합니다.

- 정렬 컬럼은 가능하면 immutable이어야 한다.
- 정렬 컬럼이 중복될 수 있으면 unique tie-breaker를 반드시 붙인다.
- `ORDER BY`와 `WHERE cursor condition`의 방향이 정확히 일치해야 한다.
- 인덱스는 필터 컬럼과 정렬 컬럼 순서에 맞춰 설계한다.

예를 들어 위 쿼리에는 `(tenant_id, deleted_at, created_at DESC, id DESC)` 또는 partial index를 검토합니다. soft delete가 많다면 [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/) 기준으로 `deleted_at IS NULL` 조건을 인덱스에 반영하는 편이 좋습니다.

### 3) cursor token은 DB 값 노출이 아니라 API 계약이다

커서는 단순히 마지막 row id를 넘기는 값이 아닙니다. 목록 API의 계약입니다. 커서에는 다음 페이지를 재현하는 데 필요한 최소 정보가 들어가야 합니다.

권장 필드:

```json
{
  "v": 1,
  "sort": "created_at_desc_id_desc",
  "created_at": "2026-05-25T09:50:12.123+09:00",
  "id": "ord_918273",
  "filter_hash": "sha256:...",
  "snapshot_at": "2026-05-25T10:00:00+09:00",
  "exp": "2026-05-26T10:00:00+09:00"
}
```

실제 응답에는 이 JSON을 그대로 노출하지 말고 base64url + 서명, 또는 서버 저장형 opaque token으로 제공합니다. 중요한 것은 cursor가 **현재 필터와 정렬 조건에 묶여야 한다**는 점입니다. 사용자가 `status=PAID` 목록에서 받은 cursor를 `status=CANCELED` 목록에 쓰면 거부해야 합니다. 그래서 `filter_hash`가 필요합니다.

토큰 만료도 명시해야 합니다. 일반 목록은 24시간, 민감하거나 빠르게 변하는 검색 결과는 10~60분으로 시작할 수 있습니다. 만료된 cursor는 400 계열 에러와 함께 첫 페이지 재조회 가이드를 줍니다. 조용히 다른 기준으로 이어 붙이면 중복·누락을 디버깅하기 어려워집니다.

### 4) live cursor와 snapshot cursor를 구분해야 한다

모든 목록이 같은 일관성을 요구하지 않습니다. 피드나 알림은 새 항목이 계속 들어오는 live view가 자연스럽습니다. 반대로 정산 내역, 감사 로그 export, 관리자 검색 결과는 사용자가 페이지를 넘기는 동안 결과 집합이 고정되는 편이 낫습니다.

| API 성격 | 권장 방식 | 기준 |
| --- | --- | --- |
| 소셜 피드, 알림 | live cursor | 최신 데이터 반영 우선, 약간의 이동 허용 |
| 주문 내역 | keyset + read-your-writes 보완 | 사용자가 방금 만든 주문은 보여야 함 |
| 정산/감사/export | snapshot cursor | 누락·중복보다 고정 결과가 중요 |
| 검색 결과 | snapshot 또는 search-after | relevance score 변동 관리 필요 |
| 관리자 대량 작업 | snapshot + job id | 재현성과 감사 증거 우선 |

snapshot cursor는 `snapshot_at` 또는 `snapshot_version`을 기준으로 "이 시점까지의 데이터만 보여준다"는 계약입니다. DB가 MVCC snapshot을 장시간 유지하기 어렵다면, 검색 인덱스의 point-in-time 기능, 임시 결과 테이블, export job 방식으로 분리합니다. API 요청 하나에서 긴 snapshot transaction을 유지하는 방식은 위험합니다. DB vacuum, undo/old version 보존, connection 점유 비용이 커질 수 있기 때문입니다.

현실적인 기준은 이렇습니다. 사용자가 3~5페이지 안에서 탐색하는 일반 목록은 live cursor로 충분합니다. 하지만 결과를 업무 증거로 써야 하거나, "총 12,431건 중 전체 다운로드"처럼 완전성이 중요한 경우는 snapshot 또는 비동기 export로 분리합니다.

### 5) 삭제와 권한 변경은 cursor 일관성을 흔드는 숨은 변수다

목록에서 row가 삭제되거나 사용자의 권한이 바뀌면 커서가 가리키던 위치 주변이 사라질 수 있습니다. soft delete라면 필터 조건이 바뀐 것이고, hard delete라면 tie-breaker row가 아예 없어집니다. 이때 cursor에 row 존재를 의존하면 취약합니다. cursor는 "마지막 row를 다시 찾는 키"가 아니라 "정렬 공간의 위치"여야 합니다. 즉 `created_at`, `id` 값만 있으면 마지막 row가 삭제되어도 다음 범위를 조회할 수 있어야 합니다.

권한 변경은 더 어렵습니다. 1페이지를 볼 때 접근 가능했던 프로젝트가 2페이지 조회 전에 권한 해제될 수 있습니다. 이 경우 보안이 우선입니다. 누락 없는 탐색보다 현재 권한 기준 필터가 먼저입니다. 단, 감사·정산 export처럼 결과 고정이 필요한 작업은 시작 시점 권한과 결과 생성 권한을 별도 receipt로 남기는 편이 맞습니다. 이 관점은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와도 연결됩니다.

## 실무 적용

### 1) 목록 API 설계 순서를 고정한다

처음부터 cursor 토큰 포맷을 고민하기보다 아래 순서로 결정합니다.

1. 목록의 주 사용 목적: 탐색, 업무 처리, 감사, export 중 무엇인가
2. 정렬 기준: immutable인지, 동점이 얼마나 자주 생기는지
3. 필터 기준: tenant, status, soft delete, 권한 조건이 인덱스에 반영되는지
4. 일관성 수준: live, bounded staleness, snapshot 중 무엇인지
5. cursor token: version, sort key, tie-breaker, filter hash, 만료
6. 관측 지표: duplicate report, empty page rate, cursor error rate, DB p95

이 순서가 중요한 이유는 cursor가 API 모양이 아니라 데이터 접근 계약이기 때문입니다. 정렬과 필터가 불안정한데 토큰만 예쁘게 만들면 문제는 그대로 남습니다.

### 2) `limit + 1`로 다음 페이지 존재를 판단한다

`COUNT(*)`를 매번 계산해 전체 페이지 수를 보여주려 하면 비용이 커집니다. cursor 기반 API에서는 보통 `limit + 1`개를 조회하고, 하나가 더 있으면 `has_next=true`와 다음 cursor를 내려줍니다. 예를 들어 클라이언트 limit이 20이면 서버는 21개를 조회합니다.

기본 제한도 필요합니다.

- 기본 limit: 20~50
- 최대 limit: 일반 API 100, 내부 batch API 500~1,000
- cursor token 만료: 일반 24시간, 검색 10~60분
- cursor invalid rate가 1%를 넘으면 클라이언트 사용 방식 또는 토큰 호환성 점검
- empty page rate가 5%를 넘으면 삭제·권한 변경·filter drift를 점검

전체 count가 꼭 필요하면 비동기 집계나 추정치를 별도로 제공합니다. 사용자 목록에서 "정확히 12,431페이지"를 보여주기 위해 매 요청마다 count를 때리는 것은 대부분의 서비스에서 비용 대비 가치가 낮습니다.

### 3) 인덱스는 cursor 쿼리와 같이 리뷰한다

cursor pagination은 인덱스가 맞지 않으면 offset보다 나을 게 없습니다. PR 리뷰에서 목록 API가 추가될 때 아래를 같이 확인해야 합니다.

```sql
-- 예: tenant별 최신 주문 목록
CREATE INDEX CONCURRENTLY idx_orders_tenant_active_created_id
ON orders (tenant_id, created_at DESC, id DESC)
WHERE deleted_at IS NULL;
```

쿼리 리뷰 기준:

- `WHERE`의 equality 필터가 인덱스 앞쪽에 있는가
- `ORDER BY`가 인덱스 정렬과 같은 방향인가
- tie-breaker가 unique하고 정렬 마지막에 있는가
- soft delete, status 필터를 partial index로 줄일 수 있는가
- covering index가 필요한지, 아니면 row lookup 비용이 허용 가능한가

운영에서는 `EXPLAIN`만 보지 말고 실제 p95, scanned rows, buffer hit, DB CPU를 같이 봅니다. 목록 API 하나가 홈 화면에 붙으면 호출량은 생각보다 빠르게 커집니다.

## 트레이드오프/주의점

첫째, cursor pagination은 임의 페이지 이동이 어렵습니다. "37페이지로 바로 가기"가 중요한 관리자 화면에서는 offset이 더 편할 수 있습니다. 이 경우에는 필터를 강하게 제한하고, 큰 offset 접근을 막거나 export job으로 유도하는 방식이 현실적입니다.

둘째, stable sort는 제품 요구와 충돌할 수 있습니다. 사용자는 `updated_at` 기준 최신 활동순을 원하지만, 수정이 잦은 필드를 cursor 기준으로 쓰면 항목 이동이 심해집니다. 이때는 `activity_sequence`처럼 append-only 정렬 키를 따로 만들거나, snapshot cursor를 적용해야 합니다.

셋째, cursor token은 버전 관리 대상입니다. 정렬 기준이나 필터 해시 방식이 바뀌면 기존 cursor가 깨질 수 있습니다. 토큰에 `v`를 넣고, 최소 1개 이전 버전을 해석하거나 명시적으로 만료시키는 정책이 필요합니다. 이 부분은 [API 버전 관리](/learning/deep-dive/deep-dive-api-versioning/)와 같은 문제입니다.

넷째, snapshot cursor는 완전성을 주지만 운영 비용이 큽니다. 긴 transaction, 임시 테이블, 검색 인덱스 point-in-time, export job 중 무엇을 쓰든 저장 공간과 만료 정리가 필요합니다. 그래서 모든 목록에 snapshot을 적용하기보다 감사·정산·대량 작업처럼 재현성이 실제 가치가 있는 곳부터 적용하는 편이 낫습니다.

의사결정 우선순위는 **보안 필터 정확성 > 중복·누락 최소화 > p95 지연 > 임의 페이지 이동 편의성 > 정확한 전체 count**입니다. 목록 API에서 편의 기능을 먼저 챙기다 보면 가장 중요한 접근 제어와 데이터 신뢰성이 뒤로 밀립니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] `ORDER BY`에 unique tie-breaker가 포함되어 있다.
- [ ] cursor 조건과 정렬 방향이 정확히 일치한다.
- [ ] cursor token에 version, sort key, filter hash, 만료 시간이 있다.
- [ ] 마지막 row가 삭제되어도 다음 페이지 조회가 동작한다.
- [ ] 권한 조건은 cursor보다 우선 적용된다.
- [ ] `limit + 1` 방식으로 `has_next`를 판단한다.
- [ ] 큰 offset 접근을 막거나 별도 export/job 흐름으로 분리한다.
- [ ] 인덱스가 tenant/filter/order/tie-breaker 순서에 맞게 설계되어 있다.
- [ ] cursor invalid rate, empty page rate, duplicate report, DB p95를 모니터링한다.

### 연습

1. 현재 만든 목록 API 1개를 골라 `ORDER BY` 컬럼이 immutable인지 확인해 보세요. mutable이면 cursor 기준으로 써도 되는지 반례를 적어 봅니다.
2. `created_at DESC`만 쓰는 쿼리에 `id DESC` tie-breaker를 추가하고, 같은 timestamp row 100개를 넣어 중복·누락이 없는지 테스트합니다.
3. `status`, `tenant_id`, `deleted_at` 필터가 있는 목록에 맞는 partial index를 설계하고 `EXPLAIN`으로 scanned rows 차이를 비교합니다.
4. cursor token을 JSON으로 먼저 설계해 보세요. `v`, `sort`, `last_key`, `filter_hash`, `exp` 5개가 빠지지 않으면 출발점으로 충분합니다.

좋은 cursor pagination은 "다음 페이지가 빠르다"에서 끝나지 않습니다. 사용자가 페이지를 넘기는 동안 데이터가 바뀌어도, API가 어떤 기준으로 이어 붙이는지 설명할 수 있어야 합니다. 목록은 서비스에서 가장 자주 호출되는 읽기 경로입니다. 작은 중복·누락이 반복되면 신뢰가 먼저 떨어지므로, 처음 설계할 때부터 정렬 안정성과 커서 계약을 함께 잡는 편이 장기적으로 싸게 먹힙니다.
