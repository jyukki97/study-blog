---
title: "백엔드 커리큘럼 심화: Outlier Detection과 Ejection으로 느린 인스턴스가 전체 p99를 오염시키지 않게 만드는 법"
date: 2026-04-18
draft: false
topic: "Resilience"
tags: ["Outlier Detection", "Ejection", "Health-Aware Routing", "Tail Latency", "Service Mesh", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "전체 평균은 멀쩡한데 일부 인스턴스가 p99와 재시도를 망가뜨리는 상황에서, outlier detection과 ejection을 어떤 숫자로 운영해야 하는지 실무 기준을 정리합니다."
module: "backend-resilience"
study_order: 1176
keywords: ["outlier detection", "ejection", "partial failure", "health-aware routing", "backend p99"]
---

분산 시스템 장애는 전체가 한 번에 죽는 형태보다, **일부 인스턴스만 이상해지는 partial failure**로 더 자주 시작됩니다. CPU는 괜찮아 보이는데 특정 노드만 GC pause가 길어지거나, 특정 AZ의 네트워크 재전송이 튀거나, drain이 덜 끝난 인스턴스로만 요청이 쏠리는 식입니다. 이때 평균 에러율은 낮게 보일 수 있지만 사용자는 이미 p99 지연과 간헐적 실패를 체감합니다.

문제는 많은 팀이 이런 상황을 health check 하나로만 다루려 한다는 점입니다. 하지만 liveness/readiness는 "죽었는가"를 보기엔 좋아도, **느리지만 아직 응답하는 인스턴스**를 빠르게 배제하는 데는 부족할 때가 많습니다. 그래서 운영이 성숙해질수록 health check와 별도로 `outlier detection`과 `ejection` 정책을 둡니다. 핵심은 장애 난 인스턴스를 영구 퇴출하는 것이 아니라, **짧은 창에서 이상 신호가 반복되는 인스턴스를 잠깐 traffic set에서 빼서 전체 tail latency를 보호하는 것**입니다.

이 글에서는 outlier detection을 서비스 메시나 Envoy 설정 이름으로만 보지 않고, 어떤 신호를 기준으로 잡아야 하는지, retry budget과 어떤 순서로 엮어야 하는지, 그리고 ejection이 오히려 용량 부족을 만드는 함정은 어떻게 피해야 하는지까지 숫자 중심으로 정리합니다. 같이 보면 좋은 글로는 [Service Discovery와 Health-Aware Routing](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/), [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/), [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/), [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)이 있습니다.

## 이 글에서 얻는 것

- outlier detection이 단순 health check나 circuit breaker와 어떻게 다른지 구분할 수 있습니다.
- timeout, 5xx, latency skew, connection reset 같은 신호를 어떤 우선순위와 임계치로 묶어야 하는지 기준을 잡을 수 있습니다.
- ejection이 실제로 p99를 낮추는 상황과, 반대로 healthy capacity를 줄여 사고를 키우는 상황을 구분할 수 있습니다.

## 핵심 개념/이슈

### 1) outlier detection의 목적은 "죽은 서버 찾기"가 아니라 "부분 장애의 전염 차단"이다

health check는 보통 "살아 있는가"를 봅니다. 그런데 운영에서 더 위험한 것은 죽은 서버보다 **애매하게 느린 서버**입니다. 예를 들어 10대 중 1대가 timeout 비율 18%, p99 4초, connection reset sporadic하게 내고 있다고 가정해 보겠습니다. 전체 성공률은 여전히 98%일 수 있고 readiness probe도 통과할 수 있습니다. 하지만 클라이언트 retry가 붙으면 이 1대가 전체 지연을 끌어올립니다.

이때 outlier detection은 아래 질문을 다룹니다.

1. 최근 짧은 시간 안에 유독 나쁜 인스턴스가 있는가
2. 그 인스턴스를 잠시 제외하면 전체 성공률과 p99가 개선되는가
3. 제외 후에도 capacity가 충분한가
4. 다시 복귀시킬 기준은 무엇인가

즉 outlier detection은 개별 인스턴스의 생사 판정이 아니라 **트래픽 집합의 품질 관리**에 가깝습니다. 이 관점은 [Service Discovery와 Health-Aware Routing](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)에서 말한 readiness, drain, passive signal의 조합과 바로 연결됩니다. readiness가 준비 상태를 보고, discovery가 후보군을 관리한다면, outlier detection은 그 후보군 안에서 **지금 이 순간 피해야 할 인스턴스**를 고르는 계층입니다.

### 2) 좋은 detection은 단일 지표보다 "실패 신호 묶음"으로 가는 편이 안전하다

운영에서 흔한 실수는 consecutive 5xx만 보고 ejection을 거는 것입니다. 물론 간단해서 출발점으로는 나쁘지 않습니다. 하지만 partial failure는 꼭 5xx로만 드러나지 않습니다.

- 응답은 오지만 p99가 중앙값의 3배 이상 튄다.
- timeout이 늘지만 HTTP status는 200이 섞여 나온다.
- TCP reset, connection refused, TLS handshake failure가 짧게 반복된다.
- 특정 AZ에서만 packet loss가 올라간다.
- drain 중인데 keep-alive 연결이 남아 새 요청 일부가 계속 들어간다.

그래서 실무에서는 보통 아래처럼 **오류형 신호 + 지연형 신호 + 연결형 신호**를 같이 봅니다.

- **오류형**: consecutive 5xx, gateway error rate, local origin failure 비율
- **지연형**: upstream request timeout 비율, p95/p99 latency skew, queueing delay
- **연결형**: connect failure, reset, TLS error, refused connection

권장 출발값은 서비스 성격에 따라 조금 달라지지만, 일반적인 내부 API라면 아래 정도가 현실적입니다.

- 최근 **30초** 창에서 consecutive 5xx **5회 이상**
- 최근 **30초** 창에서 timeout 또는 reset 비율 **20% 초과**
- 최근 **3개 윈도우 연속** p99가 healthy median의 **2.5배 초과**
- connection failure **3회 이상**이 10초 안에 반복

중요한 것은 신호를 많이 붙이는 것이 아니라, **사용자 체감에 직접 연결되는 것부터** 보는 순서입니다. 대개는 latency skew와 timeout이 먼저 체감됩니다. 그래서 [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 같이 읽으면, outlier detection이 단순 장애 차단이 아니라 p99 보호 장치라는 점이 더 선명해집니다.

### 3) ejection에는 반드시 창, 상한, 격리 시간, 복귀 조건이 같이 있어야 한다

"문제가 있는 인스턴스를 뺀다"는 문장만 있으면 정책이 아닙니다. 실무에서 꼭 들어가야 하는 것은 최소 네 가지입니다.

1. **관측 창(window)**: 최근 10초, 30초, 1분 중 어디를 기준으로 볼지
2. **상한(cap)**: 동시에 몇 %까지 ejection 가능한지
3. **격리 시간(quarantine)**: 한 번 빼면 몇 초 또는 몇 분 후 재평가할지
4. **복귀 조건(re-entry)**: 그냥 시간만 지나면 넣을지, probe/성공률 회복을 볼지

이 네 가지가 없으면 flap이 심해집니다. 예를 들어 10대 중 2대가 일시적으로 느려졌는데 무제한 ejection이 걸리면, 남은 8대가 더 뜨거워지고 다시 2대가 추가로 밀리며 capacity collapse로 번질 수 있습니다.

그래서 대부분의 서비스는 아래처럼 출발하는 편이 무난합니다.

- detection window: **30초**
- base ejection time: **30초~60초**
- max ejection cap: 전체 endpoint의 **20~25% 이하**
- 재복귀 전 최소 success sample: 연속 **20~50건 성공** 또는 passive failure 0회
- max ejection time: **5분 이하**, 그 이상이면 rollout/instance 교체 문제로 승격

이 기준이 중요한 이유는 outlier detection이 자동 복구 장치이면서도, 동시에 **capacity를 갉아먹는 제어기**이기 때문입니다. 그래서 저는 ejection을 공격적으로 켜기 전에 항상 [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)을 같이 점검하는 편이 낫다고 봅니다. 안에서 병목이 생길 때 입구 보호가 없으면, outlier를 제거해도 남은 healthy 인스턴스가 곧 새로운 outlier가 됩니다.

### 4) retry와 outlier detection의 순서가 뒤집히면 장애를 키운다

partial failure 구간에서 retry는 가장 위험한 증폭기입니다. 실제로 인스턴스 1대가 느릴 때 클라이언트가 요청을 2번, 3번 다시 던지면 나머지 healthy 인스턴스까지 부하가 번집니다. 그래서 현장에서는 "retry를 잘 설계하자"보다 먼저 **retry를 줄일 수 있게 outlier를 빨리 배제하자**가 맞는 경우가 많습니다.

권장 우선순위는 아래와 같습니다.

1. timeout budget을 먼저 줄인다.
2. obvious outlier를 짧게 eject한다.
3. retry는 최대 1회 또는 budget 기반으로 제한한다.
4. 그래도 안 되면 brownout, shed, failover를 검토한다.

예를 들어 200ms짜리 내부 API에 대해 timeout 2초, retry 3회를 둔 상태에서 outlier detection이 느리면, 한 요청이 최악의 경우 6초 이상 시스템 슬롯을 잡아먹습니다. 반대로 timeout 300~500ms, retry 1회, outlier eject 30초 구조라면 문제 인스턴스가 더 빨리 traffic set 밖으로 나가고, healthy 인스턴스만으로 복구할 가능성이 커집니다.

실무 기준으로는 아래 정도를 출발점으로 둘 수 있습니다.

- retry amplification ratio가 **1.2~1.3 초과**면 retry 억제 우선
- timeout이 정상 p99의 **2배 초과**로 설정돼 있으면 너무 느슨한 편
- 동일 upstream에 대한 retry 횟수는 일반 조회 API 기준 **최대 1회** 권장
- ejection 도입 후 전체 timeout 비율이 **30% 이상** 줄지 않으면 threshold 재조정 필요

이 부분은 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 [Graceful Degradation 플레이북](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)이 같이 있어야 운영 판단이 쉬워집니다. retry가 줄어들지 않으면 결국 degraded mode 전환이 더 빨라져야 할 수도 있습니다.

### 5) latency-based ejection은 강력하지만, 원인 분리가 안 되면 오탐이 늘어난다

많은 팀이 latency 기준 ejection을 무서워하는 이유는, 느린 원인이 upstream 인스턴스 자체가 아닐 수도 있기 때문입니다. 예를 들어 요청 바디가 큰 특정 고객군만 느리거나, 호출자 한쪽 AZ의 네트워크만 나쁘거나, 하위 DB가 느려 모든 인스턴스가 함께 느려지는 상황도 있습니다. 이때 단순히 latency 상위 몇 대를 빼면 문제를 잘못 해석하게 됩니다.

그래서 latency-based ejection은 아래 조건이 같이 맞아야 효과가 좋습니다.

- **peer 비교**가 가능해야 함, 즉 같은 역할의 인스턴스가 최소 3대 이상
- 전체 공통 slowdown인지, 특정 노드 편차인지 분해 가능해야 함
- request class를 분리해야 함, 예를 들어 read/write, small/large payload, AZ별
- local-origin metrics가 있어야 함, upstream 때문인지 caller side 때문인지 구분 가능해야 함

권장 룰은 "절대 latency"보다 **peer median 대비 배수**로 시작하는 것입니다. 예를 들면 아래처럼 잡을 수 있습니다.

- p99 > peer median p99의 **2.5배**, 3개 윈도우 연속
- 동시에 timeout 비율 또는 reset 비율이 같이 상승할 것
- 전체 fleet median도 함께 느려지면 ejection이 아니라 upstream 의존성 조사로 분기

즉 latency ejection은 강력하지만, **공통 원인을 노드 원인으로 착각하지 않게** guardrail이 필요합니다. 이 구분이 없으면 outlier detection이 진짜 문제 인스턴스를 잡는 대신, 이미 빠듯한 fleet에서 healthy capacity를 잘라내는 장치가 됩니다.

## 실무 적용

### 1) 가장 실전적인 기본 정책은 "가볍게 시작하고, 지표로만 공격적으로 키우는 것"이다

처음부터 Envoy/Istio의 모든 outlier 옵션을 다 켜는 것은 권장하지 않습니다. 시작은 아래 정도면 충분합니다.

- consecutive 5xx: **5회**
- consecutive local origin failure: **3회**
- interval: **30초**
- base ejection time: **30초**
- max ejection percent: **20%**
- success rate ejection: 초기에 off, 2주 후 관측 데이터 보고 검토

왜 이렇게 보수적으로 시작하느냐면, outlier detection 실패는 대개 "너무 약해서 못 잡는 문제"보다 "너무 예민해서 healthy fleet를 흔드는 문제"가 먼저 나오기 때문입니다. 초기에는 obvious한 failure만 잡고, 그다음에 latency skew나 success rate 기반 탐지를 추가하는 편이 안전합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

실무에서는 아래 우선순위를 추천할 만합니다.

1. **사용자 체감 보호**
   - 특정 인스턴스 timeout 비율이 **20% 초과**면 ejection 후보
   - 특정 인스턴스 p99가 peer median의 **2.5배 초과**면 조사 또는 ejection 후보
2. **증폭 억제**
   - retry amplification ratio가 **1.3 초과**면 retry 축소를 ejection과 같이 수행
   - ejection 후 남은 fleet CPU가 **75% 이상**으로 치솟으면 cap 재조정
3. **capacity 보호**
   - healthy endpoint가 4대 미만이면 max ejection percent를 **10% 이하**로 더 보수적으로
   - 동시에 2개 AZ 이상에서 failure signal이 뜨면 node 문제보다 zone 문제로 먼저 분류
4. **자동화 범위 제한**
   - ejection이 **5분 이상 반복**되는 인스턴스는 자동 복귀보다 교체/rollout 점검으로 승격
   - 1시간 내 같은 인스턴스가 **3회 이상** eject되면 auto remediation 대신 사람 확인

핵심은 **ejection 자체 성공률**이 아니라, ejection 후 전체 p99와 timeout 비율이 실제로 개선되는지 보는 것입니다. 자동화는 수단이지 목적이 아닙니다.

### 3) outlier detection, circuit breaker, drain, rollback은 각자 쓰임이 다르다

실무에서 자주 섞이는 네 가지를 아래처럼 나누면 판단이 쉬워집니다.

- **outlier detection/ejection**: fleet 안의 이상 인스턴스를 짧게 제외
- **circuit breaker**: 전체 upstream 자체가 위험할 때 호출량과 동시성을 제한
- **drain**: 배포나 종료 중인 인스턴스를 계획적으로 traffic에서 제거
- **rollback/failover**: 코드/구성/존 자체가 문제일 때 더 큰 경로 수정

그래서 아래처럼 고르면 됩니다.

- 노드 1, 2대만 이상하다 → outlier detection 우선
- 모든 인스턴스가 동시에 느리다 → circuit breaker, brownout, failover 쪽
- 배포 직후 새 버전만 문제다 → drain + rollback 우선
- readiness는 살아 있으나 keep-alive 잔여 연결이 문제다 → drain/connection age 정책 우선

즉 outlier detection은 **노드 편차 문제**에 가장 잘 맞고, 공통 장애의 만능 해법은 아닙니다.

### 4) 대시보드는 반드시 fleet 평균이 아니라 peer 편차 중심으로 봐야 한다

최소한 아래 항목은 대시보드에 있어야 합니다.

- endpoint별 request count, 5xx, timeout, reset
- endpoint별 p95/p99와 peer median 대비 배수
- eject 횟수, 평균 eject 시간, 재복귀 후 재발률
- retry amplification ratio
- 남은 healthy capacity와 CPU, queue depth
- AZ별 failure skew

특히 `eject_count`만 보면 안 됩니다. 어떤 팀은 eject가 많아져서 정책이 잘 작동한다고 착각하는데, 실제로는 threshold가 너무 민감해 flap만 늘어난 경우도 많습니다. 그래서 저는 아래 지표를 같이 보는 편을 권합니다.

- ejection 후 5분 내 fleet p99 개선률
- ejection 후 timeout ratio 감소율
- false ejection 추정률, 즉 eject 직전 실패 없고 직후에도 문제 없던 비율
- reintegration 후 10분 내 재eject 비율

### 5) 4주 도입 순서

**1주차: 관측 분해**  
endpoint별 timeout, reset, latency skew, retry 증폭을 분리해 봅니다. 평균 대시보드만 있으면 먼저 쪼개야 합니다.

**2주차: obvious failure 기반 ejection만 도입**  
consecutive 5xx, local origin failure 중심으로 보수적 정책을 넣고 cap은 20% 이하로 고정합니다.

**3주차: retry/timeout 동시 조정**  
outlier detection만 넣고 retry를 그대로 두면 효과가 반쯤만 나옵니다. timeout budget과 retry upper bound를 같이 낮춥니다.

**4주차: latency skew와 복귀 정책 튜닝**  
peer median 대비 배수 기반 latency signal을 추가하고, reintegration 후 재발률을 보며 base ejection time을 조정합니다.

## 트레이드오프/주의점

첫째, **ejection이 capacity 문제를 가릴 수 있습니다.** 실제로는 healthy 인스턴스 수가 부족한데, 일부를 빼서 순간 체감만 낮추는 경우가 있습니다. 이때는 ejection보다 증설, admission control, queue 분리가 먼저입니다.

둘째, **성공률 기반 detection은 저트래픽 서비스에서 오탐이 많습니다.** 표본이 너무 작으면 2, 3건 실패만으로 과도한 판정이 나옵니다. 저QPS 서비스는 consecutive failure 중심이 낫습니다.

셋째, **latency 기반 ejection은 request class 분리가 없으면 위험합니다.** 큰 요청이 많은 노드를 단순히 느리다고 판단할 수 있습니다.

넷째, **retry를 안 줄이면 ejection의 효과가 희석됩니다.** 느린 인스턴스를 빼도 과도한 재시도가 남은 fleet를 다시 뜨겁게 만듭니다.

다섯째, **복귀 조건이 없으면 flap이 늘고, 너무 엄격하면 유휴 capacity를 버립니다.** quarantine과 reintegration 기준은 같이 튜닝해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] endpoint별 timeout, reset, latency skew를 분리 관측한다.
- [ ] max ejection percent를 명시하고 무제한 ejection을 금지한다.
- [ ] retry budget과 outlier detection을 같은 변경 단위로 다룬다.
- [ ] ejection 후 실제 p99와 timeout 비율 개선 여부를 측정한다.
- [ ] reintegration 후 재발률을 보고 base ejection time을 조정한다.
- [ ] fleet 공통 slowdown과 node-local 문제를 구분하는 대시보드가 있다.

### 연습 과제

1. 최근 7일간 upstream timeout이 높았던 서비스 1개를 골라 endpoint별 timeout 비율과 peer median 대비 p99 배수를 구해 보세요. 평균값만 볼 때와 어떤 차이가 나는지 적어 보세요.  
2. 현재 서비스의 retry 정책을 적고, outlier detection이 없을 때와 있을 때 retry amplification ratio가 어떻게 달라질지 가정값으로 계산해 보세요.  
3. 내부 API 하나를 골라 `consecutive_5xx`, `local_origin_failure`, `base_ejection_time`, `max_ejection_percent` 네 항목의 초기값을 직접 써 보세요. 왜 그 숫자를 골랐는지도 같이 적어 보세요.

## 관련 글

- [Service Discovery와 Health-Aware Routing 실무 설계](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)
- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [Graceful Degradation 플레이북](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)
- [Load Balancer Health Check 설계](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)
