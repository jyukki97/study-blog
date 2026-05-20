---
title: "백엔드 커리큘럼 심화: Cache-Aside, Read-Through, Write-Through, Write-Behind를 workload 기준으로 고르는 법"
date: 2026-05-02
draft: false
topic: "Caching"
tags: ["Caching", "Cache-Aside", "Read-Through", "Write-Through", "Write-Behind", "Redis", "Backend"]
categories: ["Backend Deep Dive"]
description: "캐시 패턴은 취향이 아니라 workload와 데이터 신뢰도 요구에 맞춰 골라야 합니다. Cache-Aside, Read-Through, Write-Through, Write-Behind를 실무 숫자와 조건으로 비교합니다."
module: "data-system"
study_order: 1186
---

캐시 설계에서 제일 흔한 실수는 "우리 서비스는 Redis를 쓰니까 캐시 전략도 이미 정해졌다"고 생각하는 것입니다. 실제로는 Redis를 붙였다는 사실보다 **어떤 읽기/쓰기 패턴을 선택했는지**가 장애 모양과 운영 비용을 더 크게 좌우합니다. 같은 상품 조회 서비스라도 `Cache-Aside`를 쓰느냐, `Write-Through`를 쓰느냐에 따라 stale read가 나는 시점, DB 부하가 튀는 방식, 장애 때 복구 순서가 전부 달라집니다.

특히 캐시는 성능 도구처럼 보이지만, 실무에서는 **정합성, 운영 단순성, 장애 복구성**까지 함께 건드립니다. 그래서 패턴 선택은 "더 빠른가" 한 줄로 끝나지 않습니다. 이 글은 [캐시 일관성 설계](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/), [Redis 캐싱](/learning/deep-dive/deep-dive-redis-caching/), [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/), [캐시 워밍과 콜드 스타트](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/)에서 이어지는 관점으로, 패턴 자체를 **workload 기준으로 고르는 프레임**에 집중해 정리합니다.

## 이 글에서 얻는 것

- Cache-Aside, Read-Through, Write-Through, Write-Behind가 각각 어떤 워크로드에서 유리한지 구분할 수 있습니다.
- read/write 비율, stale 허용 시간, 쓰기 증폭, 장애 복구 방식 같은 실무 기준을 숫자로 잡을 수 있습니다.
- 패턴을 하나만 고집하지 않고, 읽기 경로와 쓰기 경로를 분리해서 조합하는 방법을 이해할 수 있습니다.
- 결제, 재고, 피드, 분석 이벤트처럼 성격이 다른 데이터를 같은 캐시 규칙으로 다루면 왜 사고가 나는지 설명할 수 있습니다.

## 핵심 개념/이슈

### 1) 캐시 패턴은 자료구조가 아니라 데이터 계약이다

패턴 이름만 보면 구현 스타일 차이처럼 보이지만, 실제로는 데이터 계약에 가깝습니다. 예를 들어 `Cache-Aside`는 "읽기 시점에 없으면 애플리케이션이 채운다"는 계약이고, `Write-Through`는 "쓰기 성공 시 캐시도 함께 최신화된다"는 계약입니다. `Write-Behind`는 더 강하게, "사용자 쓰기 성공과 원본 영속화 시점이 분리될 수 있다"는 계약을 받아들이는 패턴입니다.

그래서 먼저 정해야 할 것은 캐시 기술이 아니라 아래 네 가지입니다.

1. 이 데이터는 **얼마나 오래 stale해도 되는가**
2. miss가 몰릴 때 **원본 시스템이 얼마나 버틸 수 있는가**
3. 쓰기 실패나 지연이 났을 때 **복구 경로를 자동화할 수 있는가**
4. 운영자가 문제를 봤을 때 **어디부터 의심해야 하는가**

이 네 질문에 답하지 않은 상태에서 패턴부터 고르면, 구현은 빨라도 운영은 자주 흔들립니다.

### 2) Cache-Aside는 가장 무난하지만, miss 폭증과 무효화 비용을 숨긴다

`Cache-Aside`는 애플리케이션이 캐시를 먼저 읽고, miss면 DB를 읽어 캐시에 채우는 방식입니다. 구현이 단순하고 프레임워크 의존이 적어서 기본값으로 많이 씁니다. 실제로 아래 조건이면 아직도 가장 좋은 출발점인 경우가 많습니다.

- read/write 비율이 **10:1 이상**
- stale 허용 시간이 **수 초~수 분**
- miss 시 원본 조회가 **수십 ms~수백 ms** 안에서 버틴다
- 키 무효화 규칙을 도메인 팀이 직접 이해하고 관리할 수 있다

문제는 miss 폭증입니다. TTL이 같은 키에 몰려 있거나 핫키 비중이 높으면 캐시가 비는 순간 DB가 직접 충격을 받습니다. 그래서 `Cache-Aside`를 고를 때는 [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)나 TTL 지터, soft TTL 같은 보조 장치를 같이 봐야 합니다. 운영 기준으로는 `cache_miss_burst_qps / steady_state_qps`가 **3배 이상** 반복되면 단순 Cache-Aside만으로는 부족한 신호로 보는 편이 안전합니다.

### 3) Read-Through는 읽기 경로를 단순화하지만, 플랫폼 책임이 필요하다

`Read-Through`는 애플리케이션이 miss 처리 로직을 직접 들고 있지 않고, 캐시 계층이 원본 조회와 채우기를 대신합니다. 이 패턴의 장점은 읽기 경로를 한곳으로 모을 수 있다는 점입니다. 여러 서비스가 같은 키를 읽는데 miss 처리 규칙도 같다면, 중복 구현을 줄이기 좋습니다.

다만 이 방식이 잘 맞으려면 전제가 있습니다.

- 캐시 계층 또는 플랫폼 팀이 **원본 조회 규칙**을 소유할 수 있어야 함
- key schema, TTL, fallback, timeout 정책이 서비스마다 크게 다르지 않아야 함
- miss 처리 실패가 났을 때 애플리케이션이 "왜 비었는지" 추적할 관측 지표가 있어야 함

즉 Read-Through는 기술적으로 더 고급이라기보다, **조직적으로 공통 읽기 계층을 운영할 준비가 된 팀**에게 맞습니다. 서비스별 비즈니스 규칙 차이가 큰데도 억지로 중앙화하면, 공통 레이어가 오히려 병목이 됩니다.

### 4) Write-Through는 stale read를 줄이지만, 쓰기 경로의 비용을 숨기지 못한다

`Write-Through`는 DB나 원본 저장소에 쓰는 시점에 캐시도 함께 갱신합니다. 그래서 읽기 일관성이 중요한 서비스에서 자주 검토합니다. 예를 들어 상품 가격, 사용자 권한, 설정 플래그처럼 "방금 바꾼 값이 바로 보여야 한다"는 요구가 강하면 Cache-Aside보다 예측 가능성이 좋습니다.

하지만 이 패턴은 읽기 성능을 위해 쓰기 경로를 무겁게 만듭니다. 아래 조건이 동시에 보이면 신중해야 합니다.

- write QPS가 평시 **1,000/sec 이상**으로 높다
- 쓰기 payload가 커서 캐시 직렬화 비용이 무시되지 않는다
- 같은 쓰기가 여러 secondary key를 갱신해야 한다
- 캐시 업데이트 실패 시 재시도 또는 보정 파이프라인이 없다

실무에선 `Write-Through`를 쓴다고 해도 "DB commit + cache set + invalidation event"를 완전 동기 경로로 몰아넣지 않는 편이 많습니다. 핵심은 **즉시 최신성**이 필요한 키만 좁게 적용하고, 나머지는 [캐시 일관성 설계](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)나 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)로 보정하는 것입니다. 권장 출발선으로는 `write_latency_p95` 증가 허용치를 기존 대비 **20% 이내**로 두고, 그 이상이면 전면 Write-Through 확대를 멈추는 편이 낫습니다.

### 5) Write-Behind는 처리량에는 유리하지만, 정합성 예산이 없는 도메인에는 위험하다

`Write-Behind`는 애플리케이션 또는 캐시 계층이 먼저 쓰기를 받아들이고, 원본 영속화는 뒤로 미루는 방식입니다. 배치성 집계, 랭킹 점수, 비핵심 활동 로그처럼 burst가 크고 약한 eventual consistency를 받아들일 수 있는 곳에서는 꽤 강합니다. 원본 저장소에 직접 쓰기 압력을 덜 주고, burst 흡수력이 좋아지기 때문입니다.

반대로 아래 데이터에는 보수적으로 봐야 합니다.

- 결제, 포인트, 재고처럼 **유실 비용이 큰 데이터**
- 사용자에게 즉시 보이는 상태 변경
- 쓰기 순서 역전이 비즈니스 오류로 이어지는 데이터
- 운영자가 replay reason 없이 수동 재처리하면 사고가 나는 경로

실무 기준으로는 `durable queue`, `idempotency key`, `dead letter/quarantine`, `reconciliation`이 없으면 Write-Behind를 운영 패턴으로 부르기 어렵습니다. 그냥 "나중에 몰아서 저장"은 패턴이 아니라 리스크입니다. 적어도 `write_behind_backlog_age_p95`를 **30초 이하**, `flush_fail_rate`를 **0.1% 이하**로 유지할 자신이 없으면 핵심 데이터엔 적용 범위를 좁혀야 합니다.

### 6) 대부분의 시스템은 패턴 하나가 아니라 조합으로 굴러간다

현실 서비스는 하나의 패턴만으로 닫히지 않습니다. 예를 들어 상품 상세는 `Cache-Aside`, 가격 변경은 `Write-Through`, 분석 집계는 `Write-Behind`, 공통 사용자 프로필은 `Read-Through`처럼 섞이는 경우가 더 흔합니다. 중요한 건 "한 서비스는 한 패턴"이 아니라 **한 데이터 계약은 한 패턴**에 가깝다는 점입니다.

그래서 팀이 먼저 분리해야 할 것은 테이블이 아니라 데이터 클래스입니다.

- 강한 최신성이 필요한가
- 읽기 폭증이 큰가
- 쓰기 폭증이 큰가
- 재처리와 보정이 가능한가
- 운영 설명 가능성이 중요한가

이 다섯 축을 먼저 나누면 패턴 선택이 훨씬 덜 감정적이 됩니다.

## 실무 적용

### 1) 빠른 선택 매트릭스

| 조건 | 우선 검토 패턴 | 이유 | 주의점 |
| --- | --- | --- | --- |
| 읽기 압도적, stale 수 초 허용 | Cache-Aside | 구현 단순, 확장 쉬움 | stampede 방지 필수 |
| 여러 서비스가 같은 조회 규칙 공유 | Read-Through | 공통 miss 처리 중앙화 | 플랫폼 관측성 필요 |
| 방금 쓴 값이 바로 보여야 함 | Write-Through | 최신성 예측 가능 | 쓰기 지연 증가 |
| burst write 흡수, 약한 eventual consistency 허용 | Write-Behind | 쓰기 압력 완화 | queue/replay 없으면 위험 |

이 매트릭스에서 중요한 것은 "더 현대적"인 패턴이 있는가가 아니라, **문제의 중심이 읽기인지 쓰기인지** 먼저 가르는 것입니다. 읽기 장애가 반복되면 Cache-Aside 계열을 먼저 보고, 쓰기 최신성이 문제면 Write-Through를, 쓰기 burst가 본체면 Write-Behind를 보는 식이 더 낫습니다.

### 2) 숫자로 시작하는 의사결정 기준

초기 기준은 아래처럼 잡으면 실무에서 크게 벗어나지 않습니다.

- `read/write ratio >= 20:1`, stale 허용 `>= 3초` → Cache-Aside 우선
- 공통 조회 서비스 3개 이상, miss 처리 로직 중복이 잦음 → Read-Through 검토
- 사용자 체감 stale 허용 `<= 1초`, write QPS가 감당 가능 → Write-Through 부분 적용
- write burst가 평시 대비 `5배 이상`, backlog replay 자동화 가능 → Write-Behind 제한 적용
- cache miss burst 때 DB CPU가 **15%p 이상** 튄다 → Cache-Aside만으로 운영 금지, coalescing 보강
- cache update 실패가 사용자 오류로 직결된다 → 비동기 보정보다 동기 보장 또는 강한 invalidate 우선

우선순위는 보통 이 순서가 안전합니다.

1. 데이터 오류 방지
2. 원본 저장소 보호
3. 운영 복구 가능성 확보
4. 평균 지연 최적화

많은 팀이 4번부터 건드리다가 나중에 1~3번 비용을 더 크게 냅니다.

### 3) 도메인별 권장 출발점

- **상품/콘텐츠 조회**: Cache-Aside + TTL 지터 + singleflight
- **사용자 권한/설정**: Write-Through 또는 강한 invalidate + 짧은 TTL
- **피드/랭킹**: Cache-Aside + precompute, 경우에 따라 Write-Behind 집계
- **정산/원장성 데이터**: 캐시 범위 최소화, 보여주기용 read model만 별도 캐시
- **분석 이벤트/비핵심 카운터**: Write-Behind 가능, 단 durable queue 전제

핵심은 "Redis를 어디에 붙일까"가 아니라, **오류가 나도 어떤 데이터는 늦어도 되고 어떤 데이터는 틀리면 안 되는가**를 분리하는 것입니다.

### 4) 운영 대시보드 최소 구성

패턴을 골랐다면 아래 지표는 같이 봐야 합니다.

- `cache_hit_ratio`
- `cache_miss_burst_qps`
- `stale_read_detected_rate`
- `cache_fill_latency_p95`
- `write_latency_p95`
- `write_behind_backlog_age_p95`
- `invalidation_lag_p95`

패턴별로 보는 포인트도 다릅니다. Cache-Aside는 miss burst와 fill latency, Write-Through는 write latency와 cache update failure, Write-Behind는 backlog age와 replay success rate를 우선 봐야 합니다. 같은 대시보드라도 어디를 먼저 읽을지가 달라야 운영 판단이 빨라집니다.

### 5) 2주 파일럿 권장 순서

**1주차**  
현재 캐시 대상 10개를 골라 `stale 허용 시간`, `read/write 비율`, `원본 조회 비용`, `쓰기 유실 비용`을 표로 적습니다.

**2주차**  
상위 2개 데이터 클래스에만 패턴을 다시 매깁니다. 예를 들어 상품 조회는 Cache-Aside를 유지하되 singleflight를 붙이고, 사용자 설정은 Write-Through 또는 짧은 invalidate 전략으로 바꾸는 식입니다.

중요한 건 한 번에 전면 교체하지 않는 것입니다. 캐시 패턴은 기능보다 운영 관성에 더 깊게 붙어 있어서, 한 구간씩 바꾸고 지표를 비교하는 편이 사고가 적습니다.

## 트레이드오프/주의점

첫째, **Cache-Aside는 쉬워 보여도 무효화가 본체**입니다. TTL만으로 버티려 하면 인기 키와 변경 빈도 높은 키에서 사고가 납니다.

둘째, **Read-Through는 공통화의 이점만큼 공통 장애점도 키웁니다.** 중앙 miss 처리 계층이 흔들리면 여러 서비스가 같이 느려질 수 있습니다.

셋째, **Write-Through는 읽기 최신성을 얻는 대신 쓰기 경로 예산을 써버립니다.** 특히 다중 키 갱신이 붙으면 write amplification이 빠르게 커집니다.

넷째, **Write-Behind는 queue와 replay가 없으면 거의 항상 과소설계**입니다. 나중에 저장한다는 말은 결국 지연, 유실, 순서 역전 리스크를 같이 받겠다는 뜻입니다.

다섯째, **패턴 선택과 일관성 설계를 분리해서 보면 안 됩니다.** 어떤 패턴을 쓰든 [캐시 일관성 설계](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/), [캐시 워밍과 콜드 스타트](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/), [Redis 캐싱](/learning/deep-dive/deep-dive-redis-caching/)까지 같이 봐야 운영이 닫힙니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 데이터별 stale 허용 시간을 초 단위로 적었다.
- [ ] read/write 비율과 miss burst 크기를 측정했다.
- [ ] 캐시 패턴을 서비스 단위가 아니라 데이터 클래스 단위로 나눴다.
- [ ] Write-Behind 후보에는 durable queue, idempotency, replay 경로가 있다.
- [ ] Write-Through 후보에는 write latency 증가 허용치가 정해져 있다.
- [ ] Cache-Aside 후보에는 singleflight, TTL 지터, soft TTL 중 최소 1개 이상 보호 장치가 있다.

### 연습 과제

1. 현재 서비스의 캐시 대상 5개를 골라 `stale 허용 시간`, `read/write 비율`, `오류 비용`을 표로 적어 보세요.  
2. 그중 1개는 Cache-Aside 유지, 1개는 Write-Through 후보, 1개는 캐시 제외 대상으로 나눠 보고 이유를 써 보세요.  
3. miss burst가 심한 키 1개를 골라 [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)를 붙였을 때 줄일 수 있는 DB QPS를 대략 계산해 보세요.  
4. Write-Behind를 쓰고 싶다면 backlog age, flush fail rate, replay SLA를 숫자로 먼저 적어 보세요.

## 관련 글

- [캐시 일관성 설계(Write-Through/Invalidate/CDC)](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)
- [Redis 캐싱](/learning/deep-dive/deep-dive-redis-caching/)
- [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
- [캐시 워밍과 콜드 스타트 완화](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/)
- [백엔드 데이터 시스템 단계](/learning/modules/backend-data-system-phase/)
