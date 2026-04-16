---
title: "백엔드 커리큘럼 심화: Hot Partition과 Partition Key Skew 실무 플레이북"
date: 2026-04-13
draft: false
topic: "Distributed Systems"
tags: ["Hot Partition", "Partition Key", "Sharding", "Load Distribution", "Tail Latency", "Backend"]
categories: ["Backend Deep Dive"]
description: "샤딩은 했는데 특정 키와 특정 테넌트만 계속 뜨거워지는 상황에서, skew를 어떻게 탐지하고 어떤 기준으로 salting, resharding, 캐시, 비동기화를 선택할지 실무 숫자로 정리합니다."
module: "backend-distributed"
study_order: 1172
---

샤딩을 도입했다고 해서 부하가 자동으로 고르게 퍼지지는 않습니다. 운영에서 더 자주 마주치는 문제는 **데이터가 아니라 트래픽이 한쪽으로 몰리는 현상**, 즉 `hot partition`입니다. 전체 노드는 16개인데 실제 CPU는 2개 노드만 85%를 넘고, p50은 멀쩡한데 p99만 갑자기 1초를 넘고, 특정 테넌트 요청이 들어오는 시간대에 큐 적체와 타임아웃이 연쇄로 번지는 식입니다.

이 상황이 까다로운 이유는 평균 지표가 문제를 숨기기 때문입니다. 클러스터 평균 CPU는 42%라서 여유 있어 보이지만, 실제 사용자는 "왜 어떤 고객만 느리냐"를 먼저 체감합니다. 결국 hot partition은 저장소 기술의 문제가 아니라 **분산된 것처럼 보이지만 실제 부하는 분산되지 않은 운영 문제**입니다.

이 글은 partition key skew를 감으로 다루지 않고, **언제 단순 캐시로 끝낼지, 언제 salting이나 resharding까지 가야 하는지**를 숫자와 우선순위 기준으로 정리합니다. 같이 보면 좋은 배경 글로는 [Consistent Hashing](/learning/deep-dive/deep-dive-sharding-consistent-hashing/), [Sharding Key와 Resharding](/learning/deep-dive/deep-dive-sharding-key-resharding-playbook/), [Tenant Fairness Scheduling](/learning/deep-dive/deep-dive-tenant-fairness-scheduling-playbook/)이 있습니다.

## 이 글에서 얻는 것

- hot partition과 단순 전체 부하 증가를 어떻게 구분해야 하는지 운영 지표 기준을 잡을 수 있습니다.
- salting, adaptive routing, cache, queue 분산, resharding 중 무엇을 먼저 써야 하는지 의사결정 기준을 세울 수 있습니다.
- 특정 키, 특정 테넌트, 특정 시간대에만 터지는 skew를 완화하는 단계별 런북을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) hot partition은 저장 용량보다 요청 분포 문제에서 더 자주 시작된다

많은 팀이 샤딩을 "데이터 크기 분산"으로만 생각합니다. 하지만 실무에서 먼저 터지는 것은 저장 공간보다 **읽기/쓰기 빈도의 불균형**입니다. 예를 들어 주문 시스템에서 `tenant_id`를 기준으로 잘 나눴더라도, 상위 1개 고객이 전체 쓰기의 28%를 발생시키면 그 shard만 계속 뜨거워집니다. 게임 랭킹, 인기 게시물 카운터, 실시간 채팅방, 대형 셀러 정산처럼 특정 키가 반복해서 두드려지는 모델에서 특히 흔합니다.

중요한 점은 이 문제가 평균 TPS로는 잘 안 보인다는 것입니다. 운영에서는 아래 조합이 보이면 skew를 먼저 의심하는 편이 맞습니다.

- 상위 1% partition이 전체 요청의 20~30% 이상을 차지한다.
- hottest partition의 CPU 또는 queue depth가 중앙값의 3배 이상이다.
- 전체 클러스터 평균은 여유인데 특정 shard의 p99만 2배 이상 튄다.
- 테넌트별 SLO를 보면 상위 고객군만 지속적으로 위반한다.

이런 상황을 전체 증설만으로 해결하면 비용만 늘고 병목은 남습니다. 이 판단은 [Capacity Planning과 Saturation](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/) 글에서 말한 것처럼 **평균이 아니라 병목 자원 단위로 봐야** 선명해집니다.

### 2) 원인은 네 가지로 압축된다: 나쁜 키, 시간대 쏠림, fan-in 쓰기, 재시도 증폭

hot partition의 원인을 좁혀보면 대개 아래 네 범주입니다.

1. **파티션 키가 업무 부하를 대표하지 못한다**  
   데이터 정렬에는 맞지만 요청 분산에는 안 맞는 키를 택한 경우입니다.
2. **시간대 기반 burst가 특정 키로 몰린다**  
   라이브 방송, 플래시 세일, 월말 정산처럼 특정 시점에 같은 키가 집중됩니다.
3. **fan-in 쓰기 구조가 있다**  
   하나의 카운터, 하나의 집계 레코드, 하나의 인기 피드가 계속 갱신됩니다.
4. **느린 partition을 재시도가 더 뜨겁게 만든다**  
   상위 서비스 retry, consumer redelivery, 사용자 새로고침이 겹치며 집중 부하를 증폭합니다.

그래서 skew 대응은 샤드 개수만 늘리는 문제가 아니라, **키 설계 + 재시도 정책 + 캐시 전략 + 스케줄링 공정성**을 같이 봐야 합니다. tail latency가 이미 튀고 있다면 [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)를 같이 점검해야 합니다.

### 3) 첫 대응은 resharding이 아니라, "읽기인지 쓰기인지"를 먼저 자르는 것이다

hot partition이 보이면 많은 팀이 바로 resharding을 떠올립니다. 그런데 이건 가장 비싸고 위험한 대응 중 하나입니다. 먼저 아래처럼 분해하는 편이 훨씬 안전합니다.

- **읽기 hotspot**이면 캐시, request coalescing, replica fan-out 우선
- **쓰기 hotspot**이면 key salting, 비동기 집계, write buffer, queue 분산 우선
- **특정 테넌트 과점**이면 fairness 정책, tenant quota, priority 분리 우선
- **지속적 구조 문제**이면 그때 resharding 검토

예를 들어 인기 상품 조회처럼 읽기가 몰리는 경우는 [Request Coalescing/Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)와 캐시 TTL 조정만으로도 1차 완화가 가능합니다. 반대로 좋아요 수, 조회수, 잔액 집계처럼 같은 row나 같은 partition에 쓰기가 몰리는 구조는 salting이나 append-only event화가 더 잘 맞습니다.

### 4) salting은 빠르지만 읽기 비용을 되돌려 받는다

salting은 가장 흔한 대응입니다. `user:123` 대신 `user:123:bucket-07`처럼 여러 버킷으로 흩뿌려 순간 쓰기 경합을 낮춥니다. 다만 공짜가 아닙니다. 쓰기는 분산되지만 읽을 때 여러 버킷을 다시 합쳐야 하므로 아래 비용이 생깁니다.

- fan-out read 증가
- partial failure 처리 복잡도 증가
- 정렬/집계 비용 상승
- 운영자가 실제 소유 키를 바로 추적하기 어려워짐

그래서 salting은 보통 아래 조건에서만 권장할 만합니다.

- 단일 키 쓰기 빈도가 shard 한계의 30~40% 이상을 지속적으로 차지한다.
- 읽기보다 쓰기가 훨씬 많다. 예를 들어 write:read 비율이 5:1 이상이다.
- 합산 지연을 50~100ms 추가로 감수할 수 있다.
- 장기적으로 별도 집계 파이프라인으로 이전할 계획이 있다.

즉 salting은 영구 해답이라기보다 **급한 hotspot을 식히는 전술**에 가깝습니다.

### 5) 공정성 제어가 없으면 큰 고객 1명이 전체 SLO를 가져가 버린다

멀티테넌트 시스템에서는 hot partition이 단순 기술 문제가 아니라 **고객 간 공정성 문제**로 이어집니다. 상위 테넌트 1명이 inflight 슬롯을 독점하면 나머지 고객의 p95가 같이 밀립니다. 이때 shard 내부 분산보다 먼저 필요한 것이 per-tenant concurrency limit, weighted fair queue, low-priority shed 같은 장치입니다.

실무 기준으로는 아래 정도를 출발점으로 삼을 수 있습니다.

- 단일 테넌트 inflight 상한: 전체 워커의 10~15%
- 배치/백필 요청은 실시간 요청보다 낮은 우선순위 큐로 분리
- 상위 5개 테넌트가 전체 처리량의 50%를 넘기면 fairness 재설계 검토
- 특정 테넌트가 5분 이상 에러버짓 20%를 혼자 소모하면 자동 제한 검토

이 구간은 [Tenant Fairness Scheduling](/learning/deep-dive/deep-dive-tenant-fairness-scheduling-playbook/)과 [Priority Load Shedding/Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)를 같이 보는 편이 좋습니다.

## 실무 적용

### 1) 3단계 대응 순서: 관측, 완화, 구조 수정

**1단계, 관측 고정**  
먼저 partition 단위 지표를 분리합니다. 최소한 `partition qps`, `p95/p99`, `queue depth`, `cpu`, `hot key topN`, `tenant share`는 있어야 합니다. 평균값만 있는 대시보드는 skew를 숨깁니다.

**2단계, 24시간 완화**  
즉시 가능한 액션은 캐시 TTL 상향, request coalescing, retry 축소, per-tenant concurrency limit, 배치 트래픽 분리입니다. 구조 변경 없이도 증폭 부하를 먼저 꺼야 합니다.

**3단계, 2주 내 구조 수정**  
반복되는 hotspot이면 key salting, queue 분산, 비동기 집계, resharding 중 하나를 선택합니다. 여기서 핵심은 "앞으로도 같은 키가 계속 뜨거울 것인가"입니다. 일회성 이벤트라면 캐시와 rate control이 낫고, 상시 구조라면 키 모델을 바꿔야 합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

실무에서는 아래 순서를 권장할 만합니다.

1. **사용자 영향 차단**  
   - hottest partition p99가 전체 평균의 2배 이상이면 즉시 완화 시작
   - 특정 테넌트 에러율이 1%를 넘으면 fairness/limit 우선
2. **증폭 요인 제거**  
   - retry amplification ratio가 1.3을 넘으면 재시도 정책 축소
   - 같은 hot key에 동시 요청이 20개 이상이면 coalescing 검토
3. **구조 수정 여부 판단**  
   - 7일 중 3일 이상 같은 partition이 top hotspot이면 구조 문제로 분류
   - top partition share가 25% 이상으로 1주 지속되면 resharding 또는 salting 검토
4. **장기 비용 비교**  
   - salting 후 read fan-out 비용이 API 예산의 15%를 넘으면 별도 집계 저장소 검토

추천 우선순위는 **캐시/공정성/재시도 조정 > salting > 비동기 집계 > resharding**입니다. resharding은 마지막 카드로 두는 편이 안전합니다.

### 3) 패턴별 처방 예시

**읽기 중심 인기 키**  
- 짧은 TTL 캐시 + singleflight
- replica fan-out
- 인기 구간 precompute

**쓰기 중심 카운터/집계 키**  
- bucket salting
- append-only 이벤트 적재 후 비동기 합산
- 배치성 재정산으로 정확도 보정

**특정 테넌트 과점**  
- tenant별 동시성 상한
- queue 분리
- premium tier와 일반 tier의 우선순위 정책 분리

**이벤트성 burst**  
- 사전 warmup
- rate limit 상향 대신 burst buffer 추가
- 이벤트 종료 후 자동 원복

### 4) 모니터링 대시보드 최소 항목

- top 10 partition share
- top 20 hot key 요청 점유율
- tenant별 p95/p99와 에러율
- retry amplification ratio
- queue lag와 consumer saturation
- 완화 정책 발동 횟수(limit, shed, cache override)

이 정도만 있어도 "전체가 느린가, 일부만 뜨거운가"를 빠르게 구분할 수 있습니다.

## 트레이드오프/주의점

1) **salting은 쓰기 병목을 줄이지만 읽기 복잡도를 올린다**  
   조회 경로가 단순해야 하는 서비스에서는 장기 해법이 아닐 수 있습니다.

2) **resharding은 구조적으로 깔끔하지만 실패 비용이 크다**  
   데이터 이동, dual-write, 검증, cutover까지 포함하면 위험 반경이 큽니다.

3) **캐시는 증상 완화에 좋지만 정합성 비용을 숨길 수 있다**  
   stale 허용 범위와 invalidation 규칙을 같이 정해야 합니다.

4) **큰 고객을 제한하면 매출과 직접 충돌할 수 있다**  
   그래서 기술 정책이 아니라 계약/SLA 정책과 함께 정리해야 합니다.

5) **평균 지표에 안심하면 다시 반복된다**  
   partition, tenant, key 단위 분해가 없으면 동일 문제가 다른 모양으로 재발합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] partition, tenant, hot key 단위 지표가 분리돼 있다.
- [ ] retry amplification ratio를 계산하고 있다.
- [ ] 특정 테넌트가 전체 inflight를 과점하지 못하게 제한이 있다.
- [ ] 읽기 hotspot과 쓰기 hotspot에 대한 대응 전략이 별도로 정리돼 있다.
- [ ] resharding 전 대체 수단(cache, coalescing, salting, async aggregation)을 비교했다.

### 연습 과제

1. 최근 7일 로그에서 top 20 key가 전체 요청의 몇 %를 차지하는지 계산해 보세요. 상위 1개 키와 중앙 partition의 차이가 몇 배인지도 같이 보세요.  
2. 가장 자주 뜨거워지는 테넌트 1개를 골라, fairness limit만 넣었을 때와 샤드 재배치까지 했을 때의 비용 차이를 표로 비교해 보세요.  
3. 현재 서비스에서 읽기 hotspot 1개, 쓰기 hotspot 1개를 골라 각각 cache/coalescing과 salting/async aggregation 중 어느 쪽이 맞는지 이유를 적어 보세요.

## 관련 글

- [Consistent Hashing과 샤딩 기초](/learning/deep-dive/deep-dive-sharding-consistent-hashing/)
- [Sharding Key와 Resharding 플레이북](/learning/deep-dive/deep-dive-sharding-key-resharding-playbook/)
- [Tenant Fairness Scheduling 플레이북](/learning/deep-dive/deep-dive-tenant-fairness-scheduling-playbook/)
- [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Request Coalescing과 Singleflight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
- [Priority Load Shedding/Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)
