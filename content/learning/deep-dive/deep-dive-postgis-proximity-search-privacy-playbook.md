---
title: "백엔드 커리큘럼 심화: PostGIS 근접 검색, 반경·정확도·인덱스·위치 프라이버시를 함께 설계하는 법"
date: 2026-09-24
draft: false
topic: "Data Systems"
tags: ["PostGIS", "Geospatial Search", "PostgreSQL", "GiST Index", "Location Privacy", "Backend Performance"]
categories: ["Backend Deep Dive"]
description: "근처 매장·배달 가능 지역·현장 작업자 검색을 반경 SQL 한 줄로 끝내지 않고, 좌표계·반경 상한·GiST 인덱스·정확도·권한·위치 데이터 보존을 하나의 API 계약으로 설계하는 기준을 정리합니다."
summary: "근접 검색의 실패는 보통 인덱스가 없어서가 아니라, 도 단위 거리 계산, 무제한 반경, 원본 좌표 로그, 도로 거리와 직선 거리의 혼동에서 시작된다. PostGIS는 후보를 빠르게 좁히는 도구이고, 제품 약속과 개인정보 경계는 API·데이터 수명주기·관측 정책으로 별도 설계해야 한다."
module: "backend-data-system"
study_order: 1513
key_takeaways:
  - "사용자와 시설의 위치는 좌표값 하나가 아니라 좌표계, 측정 시각, 정확도, 수집 동의, 보존 기간을 가진 민감한 도메인 데이터다."
  - "`geography(Point, 4326)`와 `ST_DWithin`은 미터 단위 반경 검색의 안전한 출발점이지만, 반경 상한·결과 수·tenant 경계가 없으면 비용과 노출 범위를 통제할 수 없다."
  - "GiST 인덱스는 후보 탐색을 줄일 뿐 도로 이동 시간, 영업 가능 여부, 권한, 최신성까지 해결하지 않는다. 이 조건은 명시적인 후속 단계로 둬야 한다."
operator_checklist:
  - "근접 API마다 최대 반경, 최대 결과 수, p95 목표, 좌표 정확도 허용 범위, 위치 보존 기간을 문서화한다."
  - "원본 위도·경도를 일반 로그·metric label·공유 cache key에 넣지 않고, 접근 가능한 운영 표본과 짧은 보존 기간을 분리한다."
  - "대표 도시·해안·국경·고위도·좌표 누락·오래된 위치 fixture로 결과와 권한 필터를 통합 테스트한다."
---

"내 주변 매장", "10분 안에 도착할 기사", "반경 2km의 재고 보유 지점"은 제품 화면에서는 단순한 목록처럼 보입니다. 하지만 백엔드에서는 좌표계, 거리 단위, 인덱스, 테넌트 권한, 위치의 최신성, 개인정보 보존이 한 요청에 만나는 경계입니다. SQL에서 두 좌표의 차이를 빼거나 `LIMIT 20`만 붙이면 데모는 동작할 수 있습니다. 운영에서 문제가 되는 지점은 사용자가 도시 외곽에 있거나, 반경을 크게 요청하거나, 한 테넌트의 비공개 지점이 cache를 통해 다른 사용자에게 보일 때입니다.

이 글은 [데이터베이스 인덱싱](/learning/deep-dive/deep-dive-database-indexing/), [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/), [검색 권한 필터와 정보 누출 방지](/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/), [데이터 레지던시 리전 분리](/learning/deep-dive/deep-dive-data-residency-regional-architecture-playbook/)를 위치 검색이라는 한 경로로 연결합니다. 우선순위는 **권한·프라이버시 > 제품이 약속한 거리 의미 > 지연시간 > 결과의 풍부함**입니다. 빠르게 찾는 것만큼, 무엇을 얼마나 정확히 보여도 되는지를 먼저 정해야 합니다.

## 이 글에서 얻는 것

- `geometry`와 `geography`를 거리 단위와 사용 사례 기준으로 구분하고, 위도·경도 순서 오류를 줄이는 방법을 배웁니다.
- PostGIS의 GiST 인덱스와 `ST_DWithin`으로 반경 후보를 제한하되, 무제한 검색으로 DB를 소모하지 않는 API 예산을 정할 수 있습니다.
- 직선 거리, 도로 이동 시간, 영업 가능 여부, 위치 최신성을 서로 다른 판단 단계로 분리할 수 있습니다.
- 원본 좌표를 로그·cache·분석 파이프라인에 과도하게 퍼뜨리지 않고 수집·보존·삭제 경계를 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 위치는 숫자 두 개가 아니라 측정 문맥을 가진 데이터다

GPS에서 받은 `37.5665, 126.9780`은 충분한 모델이 아닙니다. 최소한 좌표계(SRID), 측정 시각, 오차 반경, 출처(GPS·수동 주소·IP 추정), 동의 상태가 함께 있어야 합니다. 특히 API와 많은 라이브러리는 위도(latitude)·경도(longitude) 순서로 값을 받지만, PostGIS의 `ST_MakePoint(x, y)`에서 x는 **경도**, y는 **위도**입니다. 서울의 위도와 경도를 바꿔 넣어도 SQL 오류는 나지 않지만, 전혀 다른 장소가 됩니다.

전 지구 범위에서 "반경 1,000m"를 다룬다면 시작점은 보통 WGS 84 좌표를 담는 `geography(Point, 4326)`입니다. `geography`의 거리 함수는 미터 단위를 쓰므로 API의 `radius_m`와 직접 연결하기 쉽습니다. 반면 `geometry(Point, 4326)`는 좌표값을 평면 좌표처럼 다루며 단위가 도(degree)입니다. 여기에 `0.01`을 반경으로 넣고 1km라고 설명하면 위도에 따라 실제 거리가 달라집니다.

`geometry`가 항상 나쁜 선택은 아닙니다. 하나의 도시·공장 내부처럼 좌표가 좁은 구역에 한정되고, 미터 기반 투영 좌표계로 명확히 변환했다면 복잡한 도형 연산에 유리할 수 있습니다. 핵심은 타입의 유명세가 아니라 **API가 약속한 거리 단위와 저장 좌표계가 같은가**입니다. 위치가 마지막으로 갱신된 시각도 거리만큼 중요합니다. 10분 전 기사 위치를 100m 이내라고 보여 주는 일은, 2km 떨어진 최신 위치보다 제품적으로 더 위험할 수 있습니다.

### 2) 반경 검색은 "가까운 순서"가 아니라 후보 예산을 지키는 필터다

근접 검색의 안전한 기본 경로는 다음과 같습니다. 먼저 테넌트·공개 상태·영업 가능 지점 같은 값으로 후보의 의미를 좁히고, `ST_DWithin`으로 원형 반경 안의 후보만 찾습니다. 그 뒤 필요한 경우에만 정확한 직선 거리를 계산해 정렬하고, 결과 수를 제한합니다. 이 순서를 뒤집어 모든 지점의 거리를 계산한 뒤 정렬하면 데이터가 늘수록 비용이 선형으로 커집니다.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE pickup_point (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id           bigint NOT NULL,
  is_public           boolean NOT NULL DEFAULT false,
  position            geography(Point, 4326) NOT NULL,
  location_measured_at timestamptz NOT NULL,
  accuracy_m          integer,
  CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 1 AND 50000)
);

CREATE INDEX pickup_point_position_gix
  ON pickup_point USING GIST (position);
CREATE INDEX pickup_point_tenant_public_idx
  ON pickup_point (tenant_id, is_public);

-- :lon, :lat의 범위 검증과 :radius_m 상한 검증은 SQL 전에 끝낸다.
SELECT id,
       ST_Distance(
         position,
         ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
       ) AS distance_m
FROM pickup_point
WHERE tenant_id = :tenant_id
  AND is_public = true
  AND ST_DWithin(
        position,
        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
        :radius_m
      )
ORDER BY distance_m, id
LIMIT :limit;
```

GiST 인덱스는 공간적으로 가까운 후보를 빠르게 좁히는 데 도움을 줍니다. 그러나 `tenant_id`, 공개 정책, 시간 조건을 자동으로 해결하지는 않습니다. 소수의 거대 테넌트가 대부분의 지점을 가진 서비스라면 tenant 경계가 먼저 충분히 좁혀지는지 `EXPLAIN (ANALYZE, BUFFERS)`로 확인해야 합니다. 필요하면 테넌트별 분리, 지역 partition, 별도 read model을 비교하되, 인덱스를 늘리기 전에 실제 query fingerprint와 데이터 분포를 확인하는 것이 [실행계획 회귀 방지 가드레일](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)의 출발점입니다.

### 3) 직선 거리와 도착 가능성은 서로 다른 제품 약속이다

`ST_Distance`가 알려 주는 것은 두 점 사이의 지표면 직선 거리입니다. 강, 고속도로 진입로, 일방통행, 배달 권역, 주차장 출입구는 이 값에 없습니다. 따라서 "2km 이내" 매장 찾기에는 적합해도 "10분 내 도착"이나 "배달 가능"을 대신할 수 없습니다. 후자는 도로 네트워크·교통·영업 시간·기사 상태를 반영하는 별도 routing 또는 dispatch 단계가 필요합니다.

실무에서는 이 둘을 명시적으로 나눕니다. 1단계는 DB에서 최대 50개 후보를 반경으로 찾고, 2단계는 필요한 소수 후보에만 routing provider 또는 내부 ETA 모델을 적용합니다. 1단계가 timeout이면 전체 지점을 routing API로 보내지 말고, 빈 결과 또는 "가까운 지점 확인 불가"처럼 안전하게 축소 응답합니다. 외부 호출의 deadline·재시도·circuit breaker 기준은 [WebClient 회복탄력성](/learning/deep-dive/deep-dive-webclient-resilience/)처럼 위치 조회와 별도로 운영합니다.

## 실무 적용

### 1) API 계약에 입력·출력·위치 최신성 예산을 넣는다

처음 출시하는 매장 탐색 API의 보수적인 시작값은 다음과 같습니다. 서비스의 밀도와 SLA로 조정하되, 무제한을 기본값으로 두지 않습니다.

| 항목 | 시작 기준 | 이유 |
| --- | --- | --- |
| 위도·경도 | 위도 `-90..90`, 경도 `-180..180`만 허용 | 뒤바뀐 값·깨진 GPS를 DB까지 보내지 않는다 |
| 요청 반경 | 기본 3,000m, 일반 사용자 최대 5,000m | 넓은 반경으로 인한 후보 폭증과 정보 노출을 막는다 |
| 결과 수 | 기본 20, 절대 최대 50 | UI가 소비할 수 있는 양과 정렬 비용을 함께 제한한다 |
| DB deadline | 80ms, API p95 목표 150ms | routing·권한 확인에 남길 시간을 확보한다 |
| 위치 최신성 | 실시간 작업자는 2분, 매장은 운영 변경 시 즉시 갱신 | 오래된 좌표를 현재 상태처럼 쓰지 않는다 |
| cache TTL | 공개 매장 후보 30~120초부터 검증 | 영업 상태·권한 변경과 stale 결과의 균형을 맞춘다 |

반경은 클라이언트가 보내는 숫자를 그대로 신뢰하지 않습니다. `radius_m = min(requested, policy_max)`처럼 조용히 축소하면 호출자가 왜 일부 결과를 받았는지 알기 어렵습니다. 상한을 넘으면 명시적 400 오류와 허용 상한을 반환하거나, 제품 정책상 축소한다면 응답에 적용 반경을 포함하세요. 전자는 API 계약이 분명하고, 후자는 탐색 UX가 끊기지 않는 대신 관측 지표에 `requested_radius_bucket`과 `applied_radius_bucket`을 남겨 정책 효과를 검토해야 합니다. 원본 좌표는 label로 남기지 않습니다.

### 2) 권한·cache·로그의 위치 누출 경로를 먼저 막는다

공개 매장 목록과 내부 현장 기사 위치를 같은 cache 키에 넣어서는 안 됩니다. cache key에는 적어도 `tenant`, visibility 또는 권한 버전, 지역 bucket, 적용 반경 bucket, 데이터 버전을 포함해야 합니다. 사용자 좌표의 전체 소수점 값을 key나 로그에 넣으면 cache가 과도하게 분할될 뿐 아니라 추적 가능한 위치 이력이 쌓입니다. 좌표를 반올림한 grid key를 쓰더라도, 그 grid의 해상도와 TTL이 개인정보 정책에 맞는지 따로 검토해야 합니다.

접근 제어도 결과를 얻은 뒤 필터하는 보조 작업이 아닙니다. 반경 내 비공개 지점의 존재 자체가 민감할 수 있으므로, SQL의 정책 필터와 애플리케이션 권한 검증을 같은 release에서 검증합니다. 권한 변경 뒤 60초 동안 cache에 남는 것이 허용되는지, 즉시 삭제해야 하는지, 결과 수만 달라져도 추론 공격이 가능한지를 제품·보안 담당자와 결정하세요. 위치 원본의 보존 기간은 분석 편의가 아니라 수집 목적과 재식별 위험으로 정합니다. 장기 분석에는 가능한 한 시간·공간을 집계하거나, 접근 제어된 별도 저장소에 한정합니다.

### 3) 출시 전에는 지도 위의 정상 경로보다 경계 fixture를 만든다

테스트 데이터는 서울 중심 좌표 몇 개로 끝내면 안 됩니다. 반경 경계 안·밖의 점, 위도/경도 뒤바뀐 입력, 180도 경선 부근, 고위도, 동일 거리의 tie, 정확도 5km인 오래된 위치, 권한이 바뀐 지점, 폐점 지점을 fixture로 둡니다. API 테스트는 최소 다음을 독립적으로 증명해야 합니다.

1. 1,000m 요청에서 경계 밖 1m 지점이 반환되지 않는다.
2. 다른 테넌트와 비공개 지점은 결과 수에도 영향을 주지 않는다.
3. 반경·결과 수·deadline 상한이 비정상 입력과 대량 데이터에서 유지된다.
4. routing provider가 실패해도 직선 거리 결과를 ETA로 잘못 표시하지 않는다.
5. 위치 삭제 또는 권한 회수 뒤 cache purge와 새 조회가 정책 시간 안에 일치한다.

출시 뒤에는 p50/p95/p99 DB 시간, 후보 row 수, 반경 bucket별 timeout, 결과 0건 비율, stale 위치 반환 비율, 권한 거부와 cache hit를 함께 봅니다. p95만 좋아졌는데 0건 비율이 급등했다면 인덱스 성공이 아니라 반경·권한·좌표 품질 중 하나가 제품 약속을 깨고 있을 수 있습니다.

## 트레이드오프/주의점

1. **PostGIS와 검색엔진은 대체재가 아니다.** 트랜잭션 데이터와 작은 반경 후보 탐색은 PostGIS가 단순할 수 있습니다. 텍스트 relevance, 다국어 검색, 수백만 후보의 복합 랭킹이 핵심이면 검색엔진 read model이 맞을 수 있습니다. 두 저장소를 쓴다면 위치 갱신 지연과 삭제 전파를 명시합니다.
2. **정확한 좌표가 항상 더 좋은 UX는 아니다.** 사용자가 동의하지 않았거나 `accuracy_m`가 큰 경우, 세부 거리·실시간 상태를 표시하면 허위 정밀도와 프라이버시 위험이 함께 생깁니다. 지역 단위 결과나 "약 Nkm" 같은 축소 표현이 더 정직할 수 있습니다.
3. **큰 반경은 성능 기능이 아니라 권한 정책이다.** 50km 검색은 단순히 비싼 쿼리가 아니라 비공개 사업장·작업자 분포를 더 넓게 노출할 수 있는 요청입니다. 역할별 상한과 감사 이벤트를 둡니다.
4. **공간 인덱스는 쓰기 비용도 가진다.** 고빈도 차량 telemetry를 매초 갱신하면 index 유지와 vacuum 비용이 누적됩니다. 원본 시계열과 현재 위치 read model을 분리하거나, 실제 조회 주기에 맞춰 갱신을 coalesce하는 방식을 비교합니다.
5. **IP 기반 위치를 GPS처럼 취급하지 않는다.** IP 추정 위치는 도시 추천의 힌트일 수 있지만, 배달 가능 판정·보안 승인·정산 경계의 근거로 쓰기에는 오차와 정책 위험이 큽니다.

## 체크리스트 또는 연습

### 출시 체크리스트

- [ ] API의 거리 단위, 최대 반경, 최대 결과 수, timeout과 fallback이 문서화되어 있다.
- [ ] `ST_MakePoint(longitude, latitude)` 순서와 좌표 범위를 단위 테스트로 고정했다.
- [ ] `geography`/투영 `geometry` 선택이 제품 거리 약속과 맞고, GiST 인덱스 사용 여부를 대표 쿼리로 확인했다.
- [ ] tenant·공개 상태·권한 버전이 SQL과 cache 경계에 함께 반영된다.
- [ ] 원본 좌표가 일반 애플리케이션 로그, metric label, 장기 debug dump에 남지 않는다.
- [ ] 위치 정확도·측정 시각·삭제·동의 회수의 처리 경로와 owner가 있다.
- [ ] 직선 거리 결과를 ETA나 배송 가능 여부로 오인하지 않도록 응답 필드를 분리했다.

### 연습 과제

가상의 매장 10만 개와 테넌트 100개를 놓고 `GET /pickup-points?lat=&lon=&radius_m=` 계약을 작성해 보세요. 먼저 반경 500m·3km·5km에서 반환 가능한 최대 결과 수와 p95 목표를 정합니다. 그 다음 동일 좌표를 가진 공개·비공개·타 테넌트 지점을 섞은 fixture로 권한 누출 테스트를 만드세요. 마지막으로 `EXPLAIN (ANALYZE, BUFFERS)` 결과에서 후보 수와 실제 반환 수를 기록하면, 공간 인덱스를 추가하는 일과 제품 경계를 설계하는 일이 왜 분리될 수 없는지 확인할 수 있습니다.

## 관련 글

- [데이터베이스 인덱싱](/learning/deep-dive/deep-dive-database-indexing/)
- [API Resource Budgeting](/learning/deep-dive/deep-dive-api-resource-budgeting/)
- [검색 권한 필터와 정보 누출 방지](/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/)
- [실행계획 회귀 방지 가드레일](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)
- [데이터 레지던시 리전 분리 아키텍처](/learning/deep-dive/deep-dive-data-residency-regional-architecture-playbook/)
