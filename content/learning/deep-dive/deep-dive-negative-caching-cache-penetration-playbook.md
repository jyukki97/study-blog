---
title: "백엔드 커리큘럼 심화: Negative Caching과 Cache Penetration, 없는 데이터가 DB를 때리지 않게 하는 법"
date: 2026-05-18
draft: false
topic: "Backend Caching"
tags: ["Cache", "Negative Caching", "Cache Penetration", "Redis", "Rate Limiting", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "존재하지 않는 키, 삭제된 리소스, 무작위 ID 조회가 캐시를 우회해 DB를 반복 타격하는 Cache Penetration 문제를 Negative Caching, Bloom Filter, TTL, rate limit 기준으로 설계하는 실무 플레이북입니다."
module: "backend-caching"
study_order: 1235
---

캐시는 보통 "있는 데이터를 빠르게 읽기 위한 장치"로 설명됩니다. 하지만 운영에서 자주 터지는 문제는 반대 방향입니다. **없는 데이터**가 캐시에 남지 않아서 매번 DB까지 내려가는 상황입니다. 존재하지 않는 상품 ID, 이미 삭제된 게시글, 가입하지 않은 사용자 ID, 무작위로 생성된 추천 코드, 크롤러가 훑는 오래된 URL은 모두 캐시 미스가 됩니다. 그리고 캐시 미스는 원본 저장소 조회로 이어집니다.

이 흐름이 적을 때는 문제가 아닙니다. 하지만 특정 API가 `GET /users/{id}`처럼 예측 가능한 ID를 받고, 공격자나 버그가 없는 ID를 대량으로 조회하면 캐시는 거의 도움이 되지 않습니다. 같은 없는 키가 반복 조회되어도 매번 DB를 확인하기 때문입니다. 이를 보통 **Cache Penetration**이라고 부릅니다. 해법은 없는 결과도 제한적으로 캐싱하는 **Negative Caching**입니다. 이 글은 [Cache Pattern Selection](/learning/deep-dive/deep-dive-cache-pattern-selection-workload-playbook/), [Cache Consistency와 Invalidation](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/), [Redis Cache Stampede Mitigation](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)와 함께 보면 좋습니다.

## 이 글에서 얻는 것

- Cache Penetration이 단순 캐시 미스와 어떻게 다른지 구분할 수 있습니다.
- 존재하지 않는 결과를 캐싱할 때 TTL, tombstone, invalidation, stale risk를 숫자로 잡을 수 있습니다.
- Negative Cache, Bloom Filter, rate limit, input validation을 어떤 순서로 적용할지 결정할 수 있습니다.
- 삭제·생성·권한 변경이 섞인 서비스에서 "없는 데이터" 캐싱이 사용자 경험과 정합성을 깨지 않게 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) Cache Penetration은 hit ratio보다 origin miss cost로 봐야 한다

캐시 미스 자체는 정상입니다. 새로 생성된 데이터, TTL 만료, 배포 직후 cold cache는 모두 캐시 미스를 만듭니다. Cache Penetration은 조금 다릅니다. **원본 저장소에도 없는 키가 반복적으로 들어와 캐시를 계속 통과하는 상태**입니다. 캐시 hit ratio만 보면 전체 트래픽의 90%가 캐시 hit라서 좋아 보일 수 있습니다. 하지만 남은 10%가 모두 없는 ID 조회이고, 그 조회가 DB CPU의 40%를 사용한다면 이미 장애 후보입니다.

판단할 때는 아래 지표를 분리해서 봅니다.

| 지표 | 의미 | 위험 신호 |
| --- | --- | --- |
| `cache_miss_total` | 캐시 미스 총량 | 평소 대비 3배 이상 증가 |
| `origin_not_found_total` | 원본 조회 결과 404/empty | 전체 miss의 30% 이상 |
| `not_found_same_key_repeat` | 같은 없는 키 반복 조회 | 5분 안에 10회 이상 |
| `not_found_unique_key_rate` | 없는 키의 고유 개수 증가율 | 초당 수백~수천 개로 급증 |
| `db_lookup_for_absent_key_p95` | 없는 키 조회의 DB 지연 | 정상 키 조회보다 2배 이상 |

중요한 것은 "없는 키"를 정상 미스와 분리하는 것입니다. 캐시 계층이 `MISS`만 기록하면 원인을 모릅니다. 최소한 원본 조회 후 `FOUND`, `NOT_FOUND`, `FORBIDDEN`, `ERROR`를 나눠 기록해야 합니다.

### 2) Negative Cache는 null을 저장하는 것이 아니라 판단 결과를 저장하는 것이다

Negative Caching을 단순히 `null`을 Redis에 넣는 방식으로 이해하면 위험합니다. 실무에서 캐싱해야 하는 것은 null 값이 아니라 **"이 키는 이 시점 기준으로 존재하지 않는다고 판단했다"는 짧은 증거**입니다. 그래서 value에는 최소한 상태와 생성 시각, 버전 힌트를 넣는 편이 안전합니다.

예를 들면 아래처럼 저장할 수 있습니다.

```json
{
  "state": "NOT_FOUND",
  "checked_at": "2026-05-18T10:50:00+09:00",
  "source": "user-db-primary",
  "ttl_seconds": 60
}
```

이 구조가 필요한 이유는 디버깅 때문입니다. 사용자에게 "방금 만든 리소스가 안 보인다"는 문의가 들어왔을 때, 단순 null 캐시는 원인을 설명하기 어렵습니다. 반면 checked_at과 TTL이 있으면 방금 전 not found가 캐시되었고, 생성 이벤트 invalidation이 누락되었는지 추적할 수 있습니다.

기본 TTL은 짧게 시작합니다. 사용자 생성 가능성이 있는 리소스는 30~120초, 삭제되어 다시 생성되지 않는 리소스는 5~30분, 공격성 무작위 키는 1~10분이 출발점입니다. 처음부터 1시간 이상 negative TTL을 주면 생성 직후 조회가 막히는 UX 문제가 생길 수 있습니다.

### 3) 없는 이유를 구분하지 않으면 보안과 UX가 같이 깨진다

`NOT_FOUND`와 `FORBIDDEN`은 다릅니다. 권한이 없는 사용자가 다른 사용자의 문서를 조회했을 때 404처럼 응답하는 패턴은 보안상 유용할 수 있습니다. 하지만 내부 캐시에서는 이 둘을 섞으면 안 됩니다. 권한 없는 사용자 A가 문서 X를 조회해서 "없음"을 캐싱했는데, 권한 있는 사용자 B가 곧바로 X를 조회했을 때도 캐시된 404를 받으면 장애입니다.

따라서 negative cache key에는 범위를 명확히 넣어야 합니다.

- 공개 리소스 존재 여부: `resource:{id}:exists`
- 사용자별 권한 판단: `user:{userId}:resource:{id}:access_denied`
- tenant별 격리 리소스: `tenant:{tenantId}:resource:{id}:exists`
- 삭제 tombstone: `resource:{id}:deleted:{version}`

권한이 섞인 API에서는 전역 negative cache를 기본값으로 두면 안 됩니다. tenant, user, role, visibility 조건이 결과에 영향을 주면 cache key에도 그 조건이 들어가야 합니다. 이 원칙은 [Authorization Decision Cache](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)에서도 동일하게 적용됩니다.

### 4) Bloom Filter는 DB 보호 장치이지 정답 저장소가 아니다

무작위 ID 조회가 많고 키 공간이 큰 서비스에서는 Bloom Filter를 앞단에 둘 수 있습니다. Bloom Filter는 "이 키가 존재하지 않을 가능성이 매우 높다"를 빠르게 판단하는 확률적 자료구조입니다. 없는 키를 DB까지 보내지 않는 데 효과가 있습니다.

하지만 Bloom Filter는 false positive가 있습니다. 즉 실제로 없는 키를 "있을 수도 있다"고 판단할 수 있습니다. 이 경우 DB 조회로 내려가면 되므로 안전합니다. 반대로 false negative는 보통 허용하지 않는 구조로 설계합니다. 실제 있는 키를 없다고 막으면 사용자 장애가 됩니다.

도입 기준은 아래처럼 잡을 수 있습니다.

- 없는 ID 조회가 전체 읽기 트래픽의 20% 이상이고 DB CPU에 눈에 띄는 영향을 준다.
- 키 공간이 커서 모든 absent key를 Redis에 저장하면 메모리 비용이 과하다.
- 리소스 생성·삭제 이벤트를 Bloom Filter에 반영할 수 있는 파이프라인이 있다.
- false positive로 인한 추가 DB 조회는 허용하지만 false negative는 허용하지 않는다.

작은 서비스에서는 Bloom Filter보다 짧은 TTL의 negative cache와 rate limit이 더 단순합니다. Bloom Filter는 운영 상태를 재생성하고 배포하는 절차가 필요하므로, "멋있어서" 넣기에는 비용이 있습니다.

## 실무 적용

### 1) API 경계에서 입력을 먼저 줄인다

Negative Cache는 마지막 방어선이 아닙니다. 먼저 이상한 입력을 DB까지 보내지 않는 것이 좋습니다. 예를 들어 UUID 형식이 아닌 ID, 허용 길이를 넘는 slug, 숫자 범위를 벗어난 page, 존재할 수 없는 tenant prefix는 cache 조회 전 400으로 끊을 수 있습니다.

권장 기준은 다음과 같습니다.

- ID 길이와 문자셋 검증은 application handler 진입 직후 수행한다.
- public slug는 최대 길이 100~150자, 허용 문자셋을 명확히 제한한다.
- 숫자 ID는 음수, 0, 현재 발급 범위를 크게 벗어난 값을 조기 차단한다.
- tenant 식별자가 없는 리소스 조회는 기본 거부 또는 별도 public route로 분리한다.
- 같은 client/IP/API key에서 `NOT_FOUND`가 1분에 60회 이상이면 rate limit 후보로 본다.

입력 검증으로 제거할 수 있는 트래픽을 캐시에 넣으면 캐시 메모리만 낭비합니다. 캐시는 비싼 판단을 줄이기 위한 장치이지, 명백히 잘못된 요청을 받아주는 쓰레기통이 아닙니다.

### 2) Negative TTL은 생성 가능성과 피해 범위로 정한다

Negative Cache의 가장 중요한 숫자는 TTL입니다. TTL이 너무 짧으면 DB 보호 효과가 약하고, 너무 길면 방금 생성된 리소스가 계속 없다고 보입니다. 그래서 TTL은 리소스의 생명주기 기준으로 나눠야 합니다.

| 리소스 유형 | 예시 | 출발 TTL | 이유 |
| --- | --- | ---: | --- |
| 사용자가 곧 생성할 수 있음 | username, invite code | 30~60초 | 생성 직후 UX 보호 |
| 서버가 비동기로 생성 | report, export file | 10~30초 | pending 상태와 혼동 방지 |
| 삭제 후 복구 가능 | 게시글, 댓글 | 1~5분 | restore/invalidation 여지 |
| 삭제 후 재사용 금지 | 결제, 주문 번호 | 10~30분 | not found 반복 방어 |
| 무작위 공격성 키 | 임의 UUID 스캔 | 1~10분 | DB 보호 우선 |

운영 초기는 짧게 시작하고 지표로 늘립니다. `origin_not_found_total`이 줄지 않으면 TTL을 늘리기 전에 key cardinality를 봐야 합니다. 매번 다른 없는 키가 들어오는 공격성 트래픽이면 TTL을 늘려도 효과가 작습니다. 이때는 Bloom Filter, rate limit, WAF/API gateway 룰이 더 효과적입니다.

### 3) 생성·삭제 이벤트와 invalidation을 연결한다

Negative Cache가 무서운 순간은 리소스가 생성되었는데 이전의 `NOT_FOUND`가 남아 있는 경우입니다. 예를 들어 사용자가 방금 가입했는데 username availability cache가 아직 "사용 가능"이라고 말하거나, 방금 생성된 문서를 조회하는데 404가 캐시되어 있으면 신뢰가 깨집니다.

그래서 아래 이벤트에서는 관련 negative key를 지워야 합니다.

- 리소스 생성 성공 후: `resource:{id}:exists` negative 삭제
- username/email 예약 성공 후: availability negative 삭제 또는 상태 전환
- 삭제 복구 후: tombstone negative 삭제
- 권한 부여 후: 사용자·그룹별 access denied cache 삭제
- tenant 이동/visibility 변경 후: tenant scope negative 삭제

이벤트 기반 invalidation이 어렵다면 TTL을 더 짧게 잡고, 생성 직후 read-your-writes 경로에서는 negative cache를 우회합니다. 예를 들어 생성 API 응답에 operation id나 resource version을 주고, 직후 조회에서는 `min_version` 조건이 있으면 캐시보다 원본을 우선 확인합니다. 이는 [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/) 문제와도 연결됩니다.

### 4) 장애 상황에서는 negative cache가 독이 될 수 있다

DB 장애나 timeout을 `NOT_FOUND`로 캐싱하면 큰 사고가 납니다. 원본 저장소가 느려서 조회가 실패했는데 이를 "없음"으로 저장하면 정상 데이터가 사라진 것처럼 보입니다. 따라서 negative cache는 **정상적으로 확인한 absence**에만 써야 합니다.

구분 기준은 단순합니다.

- DB가 200/empty 또는 명확한 404를 반환했다: negative cache 가능
- DB timeout, connection error, circuit open: negative cache 금지
- downstream 5xx: negative cache 금지
- 권한 서비스 오류: access denied cache 금지, fail-closed 응답은 가능하지만 짧게 처리
- replica lag 의심: primary 확인 전 negative cache 금지

장애 중에는 오히려 stale positive cache를 짧게 허용하는 편이 나을 때가 많습니다. "있던 데이터"를 잠시 보여주는 것과 "있는 데이터를 없다고 말하는 것"의 피해는 다릅니다. 주문, 결제, 권한처럼 민감한 도메인은 특히 negative cache보다 원본 확인과 안전한 실패가 우선입니다.

## 트레이드오프/주의점

Negative Cache는 DB를 보호하지만 정합성 리스크를 만듭니다. 없는 결과는 시간이 지나면 틀릴 수 있습니다. 특히 사용자가 직접 생성하는 리소스, 초대 코드, username, 짧은 slug는 방금 전까지 없었지만 지금은 있을 수 있습니다. 이 영역에서는 TTL을 짧게 두고 생성 이벤트 invalidation을 반드시 붙여야 합니다.

메모리 비용도 봐야 합니다. 공격자가 매번 다른 UUID를 던지면 Redis에 absent key가 폭증합니다. 이때 모든 없는 키를 캐싱하면 DB 대신 Redis 메모리가 터집니다. unique absent key rate가 높을 때는 per-client rate limit, Bloom Filter, key prefix validation을 우선 적용합니다. Negative Cache는 같은 없는 키가 반복될 때 효과가 큽니다.

보안적으로도 조심해야 합니다. negative cache hit/miss의 응답 시간이 다르면 공격자가 리소스 존재 여부를 추측할 수 있습니다. 공개하면 안 되는 리소스는 404와 403의 외부 응답을 통일하되, 내부 메트릭과 캐시 key는 반드시 분리해야 합니다. 또한 tenant별 데이터는 tenant scope 없는 전역 key에 저장하지 않는 것이 원칙입니다.

마지막으로 관측 없는 negative cache는 위험합니다. `negative_cache_hit`, `negative_cache_store`, `negative_cache_eviction`, `not_found_origin_lookup`, `negative_cache_bypass_after_create` 같은 지표가 없으면 효과도 부작용도 알 수 없습니다. 캐시는 성능 최적화처럼 보이지만 실제로는 데이터 판정 경로입니다. 판정 경로에는 증거가 필요합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 원본 조회 결과를 `FOUND`, `NOT_FOUND`, `FORBIDDEN`, `ERROR`로 분리해서 기록하는가?
- [ ] DB timeout, 5xx, circuit open을 `NOT_FOUND`로 캐싱하지 않는가?
- [ ] negative cache key에 tenant/user/visibility처럼 결과에 영향을 주는 범위가 포함되어 있는가?
- [ ] 사용자 생성 가능 리소스의 negative TTL이 30~120초 안에서 보수적으로 시작하는가?
- [ ] 생성·복구·권한 부여 이벤트에서 관련 negative key를 삭제하는가?
- [ ] 같은 없는 키 반복 조회와 매번 다른 없는 키 폭증을 다른 지표로 보고 있는가?
- [ ] absent unique key rate가 높을 때 Redis 메모리 상한과 eviction 정책을 확인했는가?
- [ ] `NOT_FOUND`가 1분에 60회 이상 반복되는 client/IP/API key에 rate limit을 적용할 수 있는가?
- [ ] Bloom Filter를 쓰는 경우 재생성 절차, false positive 허용, 생성 이벤트 반영 경로가 있는가?
- [ ] 생성 직후 read-your-writes 경로에서는 negative cache를 우회하거나 version 조건으로 검증하는가?

### 연습

현재 서비스에서 404가 자주 나오는 읽기 API 하나를 고르세요. 최근 24시간 기준으로 아래 값을 적어봅니다.

1. 전체 요청 수와 캐시 miss 수
2. 원본 조회 결과 `NOT_FOUND` 비율
3. 같은 없는 키가 5분 안에 반복된 횟수
4. 없는 키의 고유 개수 증가율
5. 해당 조회가 DB CPU, index scan, connection pool에 주는 영향

그다음 의사결정을 내려보세요.

- 같은 없는 키가 반복된다면 30~120초 negative cache부터 적용합니다.
- 매번 다른 없는 키가 폭증한다면 input validation과 rate limit을 먼저 둡니다.
- 키 공간이 크고 존재 집합을 안정적으로 만들 수 있다면 Bloom Filter를 검토합니다.
- 생성 직후 조회가 중요한 도메인이라면 TTL을 짧게 두고 생성 이벤트 invalidation을 먼저 구현합니다.

목표는 모든 404를 캐싱하는 것이 아닙니다. **원본 저장소에 물어볼 가치가 없는 부재 판단을 짧고 안전하게 재사용하는 것**입니다.
