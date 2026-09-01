---
title: "백엔드 커리큘럼 심화: Bloom Filter로 존재하지 않는 키의 DB 조회를 제한하는 정합성 경계"
date: 2026-09-01
draft: false
topic: "Data Systems"
tags: ["Bloom Filter", "Cache Penetration", "Probabilistic Data Structure", "Redis", "Database Protection", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "존재하지 않는 ID 조회가 캐시와 DB를 반복 통과하는 문제를 Bloom Filter로 줄이되, false positive·재구축·쓰기 경합이 사용자 데이터 정합성을 해치지 않도록 설계하는 기준을 정리합니다."
module: "data-system"
study_order: 1204
---

## 이 글에서 얻는 것

- Bloom Filter가 캐시보다 앞에 둘 수 있는 확률적 부재 판별기라는 점과, 어떤 요청에서는 쓰면 안 되는지 구분합니다.
- 필터 크기, 허용 false positive율, 재구축 주기를 숫자로 계산해 DB 보호 효과와 메모리 비용을 함께 판단합니다.
- 생성·삭제·재배포·재구축 중에도 잘못된 404를 만들지 않는 정합성 경계와 운영 절차를 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 캐시 침투는 cache miss 자체가 아니라 같은 부재 키의 반복 조회다

상품 ID, 공개 게시물 ID, 단축 URL처럼 외부에서 키를 직접 넣을 수 있는 API는 존재하지 않는 키에도 요청을 받습니다. 캐시가 비어 있으면 보통 다음 경로가 반복됩니다.

~~~text
요청 -> Redis miss -> DB 조회 -> 없음(404) -> 캐시 미저장 또는 짧은 negative cache
~~~

정상 사용자의 오타도 이 경로를 만들지만, 랜덤 ID를 대량으로 보내는 봇은 캐시 hit ratio가 높아 보여도 DB의 point lookup과 connection pool을 지속적으로 점유할 수 있습니다. [Negative Cache와 Cache Penetration 방어](/learning/deep-dive/deep-dive-negative-caching-cache-penetration-playbook/)에서 다룬 negative cache는 이미 본 부재 키를 잠시 기억하는 데 효과적입니다. 하지만 키 공간이 매우 넓고 매번 다른 랜덤 키가 들어오면 저장할 부재 키가 끝없이 늘어납니다.

Bloom Filter는 이 앞단에서 “이 키는 집합에 확실히 없다” 또는 “있을 수 있다”만 빠르게 답합니다. 비트 배열과 여러 hash 함수를 쓰므로 원본 키를 저장하지 않고도 큰 집합을 작게 표현합니다. 중요한 비대칭은 다음입니다.

| 결과 | 의미 | 다음 행동 |
| --- | --- | --- |
| definitely absent | 필터에 필요한 비트 중 하나라도 0 | DB까지 가지 않고 404 또는 정해진 fallback |
| might be present | 필요한 비트가 모두 1 | cache와 DB에서 실제 존재 여부를 확인 |

따라서 false positive는 없는 키인데 DB를 한 번 더 본다는 비용 문제이고, false negative는 있는 키를 없다고 답한다는 정합성 문제입니다. 표준 Bloom Filter의 삽입과 조회 자체는 false negative를 만들지 않지만, 필터의 데이터가 뒤처지거나 비어 있는 운영 상태는 충분히 잘못된 404를 만들 수 있습니다. 이 글의 핵심은 알고리즘보다 그 경계를 설계하는 일입니다.

### 2) 필터는 권한 판단이나 데이터의 진실 원천이 아니다

Bloom Filter가 알 수 있는 것은 membership의 근사치일 뿐입니다. 다음 판단을 Bloom 결과 하나로 끝내면 안 됩니다.

- 사용자·테넌트별 접근 권한: 같은 ID가 존재해도 현재 사용자가 볼 수 있는지는 DB 또는 권한 계층이 결정해야 합니다.
- 결제, 재고 차감, 쿠폰 사용처럼 잘못된 부재 응답이 비즈니스 결과를 바꾸는 쓰기 경로
- 삭제 직후 법적·보안상 즉시 차단해야 하는 객체의 접근 제어
- 검색 결과나 자동완성처럼 부재 판정이 제품 랭킹을 직접 바꾸는 경로

안전한 첫 후보는 공개 읽기 API의 DB 보호입니다. 예를 들어 공개 문서 상세 조회에서 현재 운영 중인 document ID 집합을 대상으로 쓰되, 필터는 데이터베이스를 대체하지 않고 DB 조회를 생략할 수 있는 부재 증거로만 씁니다. 권한은 [검색 권한 필터와 정보 누출 방지](/learning/deep-dive/deep-dive-search-authorization-filtering-leakage-playbook/), 캐시의 최신성은 [캐시 일관성과 무효화](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)처럼 별도 계약으로 남겨야 합니다.

### 3) 메모리 예산은 대략 작다가 아니라 목표 false positive율로 계산한다

예상 원소 수를 n, 목표 false positive율을 p라 하면 필요한 bit 수와 hash 수의 근사값은 다음과 같습니다.

~~~text
m = -n * ln(p) / (ln(2)^2)
k = (m / n) * ln(2)
~~~

예를 들어 활성 공개 ID가 1,000만 개이고 p를 0.1%로 잡으면 약 1억 4,400만 bit, 즉 약 17.1 MiB가 필요하고 권장 hash 수는 약 10개입니다. 이 계산은 DB를 0.1%만 조회한다는 뜻이 아닙니다. 정상 존재 키와 모든 might-be-present 키는 여전히 DB까지 갈 수 있습니다. 대신 실제로 존재하지 않는 랜덤 키 중 약 99.9%를 앞단에서 걸러낼 수 있다는 의미입니다.

| 조건 | 시작 판단 |
| --- | --- |
| 부재 키 요청이 전체 읽기의 1% 미만이고 DB 여유가 큼 | 먼저 rate limit과 negative cache를 점검하고 Bloom Filter는 보류 |
| 부재 키가 5% 이상이거나 랜덤 ID 요청이 DB read의 20% 이상 | 대상 endpoint 하나에서 canary 검토 |
| 예상 원소 수를 2배 이상 오차 낼 수 있음 | n을 보수적으로 잡거나 scalable Bloom Filter 사용 |
| false positive가 DB 예산의 5% 이상을 계속 차지 | bit 수 확대 또는 재구축·분할 전략 검토 |
| false negative를 허용할 수 없음 | 필터가 준비되지 않은 상태에서는 DB fallback, 아니면 도입 보류 |

이는 [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)를 대체하지 않습니다. 동일 IP나 API key가 분당 수천 개의 무작위 키를 보내는 상황은 필터를 통과하지 못해도 ingress에서 제한해야 합니다. Bloom Filter는 비싼 miss를 줄이는 보조 계층이지 공격자의 요청 수를 줄이는 보안 경계가 아닙니다.

### 4) 생성·삭제·재구축의 순서가 false negative를 결정한다

운영에서 가장 위험한 장면은 새 데이터가 DB에는 있는데 필터에는 없는 상태입니다. 이를 피하는 간단한 규칙은 생성 시 필터를 먼저 add하고, 그 뒤 DB write를 시도하는 것입니다. DB write가 실패해도 필터에는 남을 수 있지만, 이는 might be present인데 실제로는 없음이라는 false positive일 뿐입니다. 반대로 DB commit 뒤 비동기 이벤트만 기다리면, 그 사이 조회는 definitely absent가 되어 잘못된 404를 낼 수 있습니다.

삭제는 일반 Bloom Filter에서 remove하지 않는 편이 안전합니다. 삭제된 ID의 비트는 그대로 두고 DB가 최종 부재를 확인하게 하면 false positive만 늘어납니다. bit를 무작정 지우면 다른 ID가 공유하던 bit까지 사라져 false negative가 생길 수 있습니다. 삭제 누적으로 효율이 떨어지는 문제는 정기 재구축으로 해결합니다.

## 실무 적용

### 1) 읽기 경로를 세 계층으로 고정한다

안전한 기본 흐름은 다음과 같습니다.

~~~text
1. 요청 형식·인증·rate limit 검사
2. Bloom Filter가 definitely absent면 즉시 부재 응답
3. might be present면 object cache 조회
4. cache miss일 때만 DB 조회와 정상 cache 채움
5. 모든 계층의 결과와 이유를 별도 metric으로 기록
~~~

여기서 2단계는 필터가 ready이고 현재 generation이 유효할 때만 허용합니다. 프로세스 시작, Redis 연결 장애, 새 generation 다운로드 실패, rebuild 검증 실패 중에는 필터를 비활성화하고 DB 경로로 fail open합니다. 부재 응답이 조금 느려지는 것은 괜찮지만, 데이터가 있는데 404를 돌려주는 것은 대개 더 비싼 사고이기 때문입니다.

예를 들어 filter key에 catalog:v42처럼 generation을 넣고, 애플리케이션은 검증을 마친 generation pointer만 읽습니다. rebuild worker는 새 v43을 별도로 채운 뒤 원소 수·예상 bit density·샘플 DB 대조를 통과할 때만 pointer를 원자적으로 바꿉니다. old generation은 grace period 뒤 제거합니다. [캐시 워밍과 Cold Start](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/)의 원칙처럼 새 캐시를 만들었다와 읽기 경로에서 안전하게 쓸 수 있다를 분리하는 방식입니다.

### 2) 관측 지표로 실제 절감과 위험을 분리한다

Bloom Filter가 켜진 뒤 404가 줄어들었다는 사실만으로 성공을 선언하지 않습니다. 다음 네 비율을 같은 dashboard에서 봅니다.

- bloom_definitely_absent_total / lookup_total: DB까지 보내지 않은 요청의 비율
- bloom_might_present_but_db_absent_total / bloom_might_present_total: 관측된 false positive율
- bloom_generation_ready: ready가 아닌 상태가 0인지와 fallback 시간
- bloom_absent_response_then_create_or_read_total: 부재 응답 뒤 짧은 시간 내 같은 키가 생성·정상 조회된 신호

마지막 지표는 완전한 false negative 증명은 아니지만, 쓰기 순서·generation 전환·event 지연의 이상을 빨리 찾는 안전망입니다. 초기 canary에서는 대상 API 한 개, 트래픽 5%, 7일 관찰로 시작합니다. DB point lookup 수가 baseline 대비 30% 이상 줄고, bloom-ready 상태가 99.99% 이상이며, 잘못된 부재 의심 사건이 0건일 때만 확대합니다. 목표 수치는 서비스의 SLO와 키 분포에 맞게 조정해야 합니다.

### 3) 구현 선택은 데이터 규모와 변경률로 나눈다

- 프로세스 메모리 filter: 단일 서비스, 수백만 키, 빠른 조회가 필요할 때 적합합니다. 배포마다 warm-up과 generation 배포 비용을 감수합니다.
- 공유 Redis Bloom 계열: 여러 애플리케이션이 같은 membership을 봐야 할 때 편합니다. 다만 Redis 장애가 부재 판별 오류로 바뀌지 않도록 fail-open과 latency budget을 둡니다.
- partitioned 또는 scalable filter: 테넌트·날짜·객체 종류별로 키 공간을 나누거나 예상 n이 계속 늘어나는 경우에 맞습니다. 어떤 partition이 ready인지도 함께 관리해야 합니다.
- negative cache만 사용: 요청 수가 낮거나 대상 집합이 너무 자주 바뀌어 filter 동기화 비용이 큰 경우에 더 단순하고 안전합니다.

우선순위는 정합성, DB 보호, 메모리 절감 순입니다. 필터를 작게 만들어 false positive가 늘면 성능 이점이 사라질 뿐이지만, 생성 순서나 rollout을 잘못 설계해 false negative가 나면 제품 동작이 바뀝니다.

## 트레이드오프/주의점

첫째, Bloom Filter는 정확한 존재 목록이 아닙니다. false positive가 늘면 CPU와 DB를 아끼지 못하며, filter가 오래될수록 삭제된 키가 남아 효율이 떨어집니다. 재구축 주기를 짧게 하면 최신성은 좋아지지만 DB scan과 배포 비용이 커집니다.

둘째, 정합성을 유지하려고 생성 전에 add하면 실패한 write의 key도 filter에 남습니다. 이는 의도적으로 false positive를 택해 false negative를 피하는 교환입니다. 생성 실패율이 높다면 DB 오류 자체를 먼저 다뤄야 하며, filter 재구축으로 누적을 정리합니다.

셋째, hash seed나 serialization 형식이 다른 애플리케이션 버전을 섞으면 같은 key가 서로 다른 bit를 가리킬 수 있습니다. filter format version, seed, expected n, target dataset, 생성 시각을 generation metadata로 기록하고, reader가 모르는 format은 절대 부재 판별에 사용하지 않아야 합니다.

넷째, Bloom Filter가 악성 요청을 모두 막아 주지 않습니다. 공격자는 존재하는 키를 반복하거나 might-be-present를 만들 수 있습니다. WAF, 인증별 quota, connection pool 보호, [우선순위 로드 셰딩](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)은 계속 필요합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 대상 endpoint는 존재 여부를 빠르게 숨기면 안 되는 권한·결제·보안 경로가 아니다.
- [ ] 예상 원소 수 n, 목표 p, 필요한 bit 수 m, hash 수 k가 문서화돼 있다.
- [ ] 생성은 DB commit보다 먼저 filter에 add하거나, 동등하게 false negative를 막는 fallback 경로가 있다.
- [ ] 삭제 bit를 직접 지우지 않으며, 재구축과 generation swap 절차가 있다.
- [ ] filter가 not-ready·형식 불일치·의존성 장애일 때 DB로 fail open한다.
- [ ] filter bypass율, 실제 false positive율, ready 상태, 의심되는 false negative 신호를 함께 측정한다.
- [ ] rate limit과 negative cache를 filter와 별개의 보호 계층으로 유지한다.

### 연습

1. 최근 7일의 한 read API에서 전체 조회, DB miss, 고유 부재 키 수를 구하고, p=1%, 0.1%, 0.01%일 때 필요한 Bloom Filter 크기를 계산해 보세요.
2. 생성 성공·실패, 삭제, process restart, generation 교체가 동시에 일어나는 순서를 그린 뒤, definitely absent가 잘못 반환될 수 있는 지점을 표시해 보세요.
3. 대상 API에 5% canary를 적용한다고 가정하고, 확대 조건 3개와 즉시 rollback 조건 3개를 숫자로 정해 보세요.

## 관련 글

- [Negative Cache와 Cache Penetration 방어](/learning/deep-dive/deep-dive-negative-caching-cache-penetration-playbook/)
- [캐시 패턴 선택과 워크로드 설계](/learning/deep-dive/deep-dive-cache-pattern-selection-workload-playbook/)
- [캐시 일관성과 무효화](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [캐시 워밍과 Cold Start](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/)
