---
title: "캐시 워밍과 콜드 스타트 완화 실전: 배포 직후 느려지는 서비스를 줄이는 운영 설계"
study_order: 1178
date: 2026-04-22
draft: false
topic: "Caching"
tags: ["Cache Warmup", "Cold Start", "Redis", "Caching", "Performance", "Backend"]
categories: ["Backend Deep Dive"]
description: "캐시 워밍, 콜드 스타트, 핫셋 선정, 단계적 워밍, 보호 장치를 묶어 배포 직후 성능 흔들림을 줄이는 실무 설계를 정리합니다."
module: "data-system"
---

배포 직후, 오토스케일 직후, 장애 복구 직후에만 유난히 느려지는 서비스가 있습니다. 평소에는 P95가 120ms인데 새 인스턴스가 붙는 순간 900ms까지 튀고, DB QPS가 두 배로 치솟고, 재시도까지 겹치면서 잠깐의 흔들림이 연쇄 장애로 번지는 식입니다. 이 문제를 단순히 "캐시가 아직 안 찼다"로 설명하면 대응이 항상 늦습니다. 실무에서는 **어떤 데이터를 미리 채울지, 얼마만큼만 채울지, 언제부터 보호 장치를 켤지**를 운영 규칙으로 정해 둬야 합니다.

캐시 워밍은 캐시를 많이 채우는 작업이 아닙니다. **사용자 체감 지연과 원본 시스템 부하가 동시에 급등하는 구간을 짧게 만드는 운영 기술**에 가깝습니다. 그래서 [Redis Cache Stampede 방지](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/), [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)를 함께 봐야 설계가 단단해집니다.

## 이 글에서 얻는 것

- 캐시 워밍이 필요한 상황과, 그냥 TTL만 늘리는 방식이 왜 자주 실패하는지 구분할 수 있습니다.
- 핫셋 선정, 단계적 워밍, 배포 연계, 보호 장치를 한 흐름으로 설계하는 기준을 잡을 수 있습니다.
- DB 여유 용량, 히트율, P95, 워밍 속도를 숫자로 놓고 의사결정하는 방법을 정리할 수 있습니다.
- 콜드 스타트 완화를 위해 local cache, Redis, precompute, singleflight를 어떤 순서로 결합할지 감을 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) 콜드 스타트는 한 종류가 아니다

실무에서 자주 섞이는 콜드 스타트는 보통 네 가지입니다.

1. **배포 콜드 스타트**: 새 인스턴스가 떠서 local cache, connection pool, JIT, lazy bean이 비어 있는 상태
2. **오토스케일 콜드 스타트**: 트래픽 급증으로 인스턴스 수가 늘었는데 새 노드가 캐시 없이 트래픽을 바로 받는 상태
3. **장애 복구 콜드 스타트**: Redis failover, cache flush, region failover 뒤에 인기 키가 한꺼번에 미스 나는 상태
4. **대량 무효화 콜드 스타트**: 배치, 가격 변경, 권한 정책 변경으로 핫 키 다수가 동시에 지워진 상태

이 넷을 구분하지 않으면 대책이 엇나갑니다. 배포 콜드 스타트는 **사전 워밍**이 잘 맞고, 장애 복구 콜드 스타트는 **원본 보호**가 먼저이며, 대량 무효화는 **TTL 분산과 단계적 재생성**이 우선입니다. 즉 "캐시를 미리 채우자"는 말만으로는 부족합니다.

### 2) 캐시 워밍의 목표는 히트율이 아니라 급등 구간 압축이다

캐시 워밍을 시작하면 팀이 흔히 보는 지표는 hit ratio입니다. 물론 중요하지만, 실전에서는 아래 네 줄이 더 직접적입니다.

- 배포 후 10분간 `origin QPS`가 평시 대비 몇 배까지 튀는가
- 새 인스턴스 투입 후 `P95/P99`가 몇 분 동안 흔들리는가
- 워밍 중 `DB connection utilization`이 70%를 넘는가
- 워밍 완료 전 `retry rate`, `429`, `timeout`이 어떻게 움직이는가

좋은 워밍은 "히트율 95% 달성"보다 **배포 후 3분 안에 P95를 기준선 ±20% 안으로 복구**시키는 쪽에 가깝습니다. 예를 들어 평시 DB 여유가 30%뿐인데 워밍이 그 여유를 다 먹어 버리면, 히트율은 올라도 전체 서비스는 더 불안해집니다. 그래서 워밍에도 예산이 필요합니다.

실무에서는 보통 이렇게 잡습니다.

- 워밍에 쓰는 DB 여유 용량: **전체 여유 QPS의 30~50% 이내**
- 새 인스턴스가 직접 받는 초기 트래픽: **전체의 5~10%부터 시작**
- 워밍 미완료 상태 허용 시간: **3~10분 이내**
- 핫 키 기준: 최근 1시간 상위 **1~5% 요청 키** 또는 분당 **50회 이상 조회 키**

이 숫자는 업종마다 다르지만, 중요한 건 워밍을 "best effort"가 아니라 **부하 예산 안의 작업**으로 보는 관점입니다.

### 3) 핫셋을 잘못 고르면 워밍은 오히려 낭비가 된다

워밍이 실패하는 가장 흔한 이유는 너무 많은 키를 미리 채우려는 데 있습니다. 사용자 1천만 명 서비스에서 "최근 조회한 상품 전부"를 워밍하는 순간, 워밍 자체가 본 서비스보다 비싼 배치가 됩니다. 그래서 워밍은 전체 데이터가 아니라 **핫셋(hot set)** 을 다루는 것이 맞습니다.

핫셋 선정 기준은 보통 세 축으로 정리하면 실용적입니다.

- **빈도**: 최근 1시간, 24시간 기준 상위 조회 키
- **비용**: 캐시 미스 시 DB/외부 API 비용이 큰 키
- **중요도**: 홈 화면, 랭킹, 가격, 재고, 권한 정책처럼 실패 체감이 큰 키

예를 들어 아래처럼 분리하면 운영이 쉬워집니다.

| 계층 | 예시 | 선정 기준 | 워밍 전략 |
| --- | --- | --- | --- |
| A급 핫셋 | 메인 배너, 인기 상품, 가격표, 주요 설정 | 분당 200회 이상 또는 미스 비용 큼 | 배포 전 사전 워밍 |
| B급 준핫셋 | 카테고리 목록, 검색 필터, 추천 후보 | 분당 20~200회 | 배포 직후 백그라운드 워밍 |
| C급 롱테일 | 개별 상세, 오래된 페이지 | 낮은 조회 | lazy loading + singleflight |

이 분리가 있으면 A급은 반드시 사전 워밍, B급은 제한 속도 워밍, C급은 아예 미리 안 채우는 식으로 비용을 통제할 수 있습니다. 이 구조는 [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)와 특히 잘 맞습니다. 롱테일 키를 전부 예열하려 하지 말고, 첫 미스만 합쳐 처리하는 편이 훨씬 싸기 때문입니다.

### 4) 캐시 워밍은 보통 4단 구조가 가장 현실적이다

실무에서 많이 쓰는 조합은 아래 네 단계입니다.

#### 4-1. 배포 전 사전 워밍

배포 파이프라인이나 canary 시작 직전에 A급 핫셋만 미리 채웁니다. 여기서 핵심은 **전체 데이터가 아니라 가장 비싼 100~1,000개 키만 먼저** 넣는 것입니다. 이때 [Feature Flag 운영](/learning/deep-dive/deep-dive-feature-flags/)과 붙여 새 버전이 실제 트래픽을 받기 전에 warmup 완료 여부를 확인하면 안정적입니다.

#### 4-2. 시작 직후 백그라운드 워밍

인스턴스가 뜬 뒤 B급 준핫셋을 초당 제한을 둔 배치로 채웁니다. DB spare QPS가 200이라면 워밍은 60~80 QPS 이내로 제한하는 식입니다. 이 단계에서 가장 중요한 건 속도보다 **상한선**입니다.

#### 4-3. 런타임 lazy loading + singleflight

워밍에서 빠진 C급 키는 요청 시점에 채우되, 같은 키의 동시 미스는 1회만 원본에 보내야 합니다. 이 패턴이 없으면 warmup 범위를 줄인 이점이 사라집니다. 관련 배경은 [Redis Cache Stampede 방지](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/)와 [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)를 같이 보면 선명해집니다.

#### 4-4. 보호 장치

워밍은 보호 장치 없이 붙이면 위험합니다. 최소한 아래는 같이 있어야 합니다.

- TTL jitter 10~20%
- origin concurrency cap
- timeout + 짧은 backoff
- stale-while-revalidate 허용 구간
- 429/503 시 워밍 자동 감속

여기서 워밍은 주인공이 아니라 **원본 보호 정책의 일부**입니다. 보호 장치가 없으면 워밍 작업이 stampede를 다른 이름으로 다시 만드는 셈입니다.

### 5) local cache와 shared cache를 분리해서 봐야 한다

많은 팀이 Redis만 보고 워밍을 설계합니다. 그런데 실제 사용자 체감은 애플리케이션 내부 L1 cache가 더 크게 좌우하는 경우가 많습니다. 새 인스턴스가 붙는 순간 Redis hit은 높아도, JSON 역직렬화, 객체 조립, 권한 계산, downstream fan-out이 매번 다시 일어나면 응답은 여전히 흔들립니다.

그래서 콜드 스타트 완화는 보통 다음처럼 분리해서 보는 편이 좋습니다.

- **L1(Local cache)**: 인스턴스별로 가장 자주 쓰는 계산 결과 보존
- **L2(Shared cache, Redis)**: 인스턴스 간 공유 가능한 재사용 데이터 보존
- **Origin(DB/API)**: 최종 진실 원본

실무 기준으로는

- L1은 수 초~수 분 TTL, 작은 크기, 매우 빠른 hit
- L2는 수 분~수십 분 TTL, 다중 인스턴스 공유
- Origin은 rate limit과 concurrency limit로 보호

이렇게 나누는 편이 낫습니다. L1 없이 L2만 쓰면 새 인스턴스가 Redis를 잘 맞혀도 체감이 들쑥날쑥할 수 있습니다. 반대로 L1만 믿으면 인스턴스 수가 늘 때 정합성이 흔들립니다. 둘은 대체재가 아니라 역할 분담 관계입니다.

## 실무 적용

### 1) 의사결정 기준(숫자·조건·우선순위)

캐시 워밍을 도입할지 말지 고민될 때는 아래 순서로 판단하면 됩니다.

**1순위, 보호 대상 경로 선정**
- 홈, 랭킹, 가격, 재고, 인증 후 첫 화면처럼 초기 체감이 큰 경로부터 시작
- 배포 후 5분 이내 P95가 기준선 대비 2배 이상 튄 적이 있다면 우선 대상

**2순위, 핫셋 크기 제한**
- 전체 키의 100%가 아니라 상위 1~5% 키부터
- 사전 워밍 대상은 보통 100~1,000키 수준에서 시작

**3순위, 원본 여유 용량 예산화**
- 워밍 트래픽은 DB spare QPS의 30~50% 이내
- connection pool 사용률이 70%를 넘으면 워밍 감속 또는 중단

**4순위, lazy protection 결합**
- singleflight, stale-while-revalidate, rate limit이 없으면 워밍 단독 도입 금지

**5순위, 배포와 연결**
- canary 5% 진입 전에 A급 핫셋 워밍 완료
- P95, error rate, origin QPS가 기준선 안에 들어온 뒤 25% → 50% → 100% 확대

### 2) warmup budget 계산 예시

가장 단순한 계산은 아래처럼 잡을 수 있습니다.

- 평시 DB 최대 안전 처리량: 2,000 QPS
- 평시 실제 사용량: 1,400 QPS
- spare QPS: 600
- 워밍 사용 가능 예산: spare의 40% = 240 QPS
- 키 1개를 채우는 데 평균 원본 쿼리 2회 필요
- 분당 채울 수 있는 키 수: `240 / 2 * 60 = 7,200키`

이 계산만 해도 "우리는 5만 키를 한 번에 미리 채울 수 없다"는 사실이 바로 보입니다. 그래서 워밍은 결국 핫셋 선정 문제로 돌아갑니다. 숫자를 안 보면 배포 직전마다 욕심이 커집니다.

### 3) 단계적 워밍 런북 예시

| 단계 | 조건 | 액션 | 중단 조건 |
| --- | --- | --- | --- |
| 사전 워밍 | 배포 시작 전 | A급 300키 preload | DB util 65% 초과 |
| 1차 카나리 | 새 버전 5% | B급 키 초당 30개 preload | P95 20% 초과 상승 |
| 2차 확대 | 15분 안정 | 새 버전 25% | timeout 증가 시 정지 |
| 전체 확대 | 30분 안정 | 100% 전환, C급은 lazy | origin QPS 1.5배 초과 시 보류 |

핵심은 "워밍 성공"만 보는 게 아니라 **서비스 안정이 유지된 상태의 워밍**인지 확인하는 것입니다. 이 표는 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과 함께 운영할 때 가장 효과가 큽니다.

### 4) 운영 구현 패턴

실무에서 많이 쓰는 조합은 아래와 같습니다.

1. 최근 24시간 access log에서 상위 키 추출
2. 상위 키 중 미스 비용이 큰 A급 목록 생성
3. 배포 전 워커가 Redis/L2에 preload
4. 인스턴스 시작 후 로컬 L1에는 A급 일부만 비동기 preload
5. 롱테일 키는 요청 시 singleflight로 1회만 원본 조회
6. 워밍 중 429/timeout 증가 시 자동 감속

간단한 의사코드로 보면 이렇습니다.

```text
if deploy_start:
  preload(top_a_keys, qps_limit=50)

if instance_boot:
  preload(local_l1_keys, concurrency=4)

on_request(key):
  if l1_hit: return value
  if l2_hit: fill_l1_and_return
  return singleflight(key, load_origin_then_fill)
```

여기서 중요한 건 `preload` 자체보다 `qps_limit`, `concurrency`, `singleflight` 입니다. 제한이 없으면 preload는 쉽게 폭주합니다.

### 5) 어떤 서비스에 특히 잘 맞는가

캐시 워밍은 모든 서비스에 똑같이 필요하지 않습니다. 아래 조건이면 ROI가 높습니다.

- 트래픽 편차가 크고 오토스케일이 잦다.
- 홈/랭킹/추천처럼 핫 키 편중이 심하다.
- origin 조회 비용이 높다. 예를 들어 조인, 외부 API fan-out, 대형 객체 역직렬화.
- 배포 후 첫 5~10분 지표 흔들림이 반복된다.

반대로 아래면 과하게 투자할 필요가 없습니다.

- 트래픽이 낮고 key skew가 약하다.
- origin 조회가 싸고 안정적이다.
- 캐시보다 계산/네트워크가 병목이다.
- 데이터 변경이 매우 잦아 preload 가치가 작다.

즉 워밍은 "좋아 보이는 최적화"가 아니라 **반복되는 콜드 스타트 비용이 충분히 큰 경우에만** 도입하는 편이 맞습니다.

## 트레이드오프/주의점

첫째, **너무 많이 미리 채우면 warmup이 본 서비스보다 더 비싸집니다.** 상위 1~5% 키만 대상으로 줄이지 않으면 배포 파이프라인이 원본 시스템을 흔들 수 있습니다.

둘째, **stale 허용 구간을 안 정하면 운영이 매번 흔들립니다.** 예를 들어 가격, 재고, 권한은 stale 허용이 짧아야 하고, 랭킹, 추천, CMS 콘텐츠는 수십 초~수분 stale이 가능한 경우가 많습니다. 이 구분 없이 전부 강한 최신성으로 가져가면 warmup 비용이 급증합니다.

셋째, **mass invalidation과 warmup을 동시에 일으키지 마세요.** 대량 삭제 후 즉시 전체 preload를 걸면 DB에 두 번 부담을 주게 됩니다. 가능하면 TTL jitter, partitioned invalidation, background refill로 나누는 편이 낫습니다.

넷째, **새 인스턴스에 트래픽을 너무 빨리 붙이면 warmup 효과가 사라집니다.** 특히 HPA가 급하게 늘어나는 환경에서는 readiness는 통과했어도 cache readiness는 아닐 수 있습니다. 준비 신호를 분리해서 보는 편이 좋습니다.

다섯째, **워밍은 보안이나 정합성 기준을 우회하면 안 됩니다.** 사용자별 민감 데이터, 권한별 응답, 테넌트별 결과를 잘못 공유 캐시에 넣으면 성능보다 큰 사고가 납니다. 워밍 후보는 "공유 가능한 값인지"부터 검증해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 배포 콜드 스타트와 장애 복구 콜드 스타트를 구분해 대응한다.
- [ ] 핫셋 선정 기준이 요청 빈도, 미스 비용, 사용자 영향으로 문서화돼 있다.
- [ ] 워밍 트래픽 상한이 DB spare QPS의 일정 비율로 제한돼 있다.
- [ ] singleflight 또는 동등한 중복 미스 합치기 장치가 있다.
- [ ] TTL jitter, timeout, backpressure가 함께 적용돼 있다.
- [ ] canary 확대 조건에 P95, origin QPS, error rate 기준이 들어 있다.
- [ ] L1과 L2 캐시의 역할과 TTL이 분리돼 있다.

### 연습 과제

1. 최근 배포 3건을 골라 배포 후 10분 동안의 `P95`, `origin QPS`, `cache hit ratio`를 비교해 보세요. 콜드 스타트 흔들림이 반복되는지 먼저 확인하는 것이 우선입니다.
2. 홈 화면이나 랭킹 API 하나를 골라 상위 100개 키만 preload했을 때와, 아무 워밍 없이 singleflight만 적용했을 때의 DB QPS 차이를 추정해 보세요.
3. 현재 캐시 키를 A급, B급, C급으로 분리하고 각 등급에 대해 `사전 워밍`, `배경 워밍`, `lazy only` 중 하나를 지정해 보세요. 대부분의 팀은 이 표를 만드는 순간 과한 preload를 줄이게 됩니다.

## 관련 글

- [Redis Cache Stampede 방지](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/)
- [Request Coalescing / Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Feature Flag 운영 전략](/learning/deep-dive/deep-dive-feature-flags/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
