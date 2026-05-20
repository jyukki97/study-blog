---
title: "백엔드 커리큘럼 심화: Admission Control과 Concurrency Limit, 과부하를 입구에서 막는 운영 기준"
date: 2026-04-17
draft: false
topic: "Resilience"
tags: ["Admission Control", "Concurrency Limit", "Overload Protection", "Backpressure", "Queueing"]
categories: ["Backend Deep Dive"]
description: "과부하 상황에서 모든 요청을 끝까지 받으려는 습관을 버리고, admission control과 concurrency limit으로 시스템을 보호하는 실무 기준을 숫자 중심으로 정리합니다."
module: "backend-resilience"
study_order: 1115
---

트래픽이 오를 때 많은 팀이 제일 늦게 손대는 것이 admission control입니다. 평소에는 눈에 잘 띄지 않기 때문입니다. 하지만 실제 장애는 자주 여기서 시작됩니다. 처리할 수 있는 양보다 더 많은 요청을 계속 안으로 들여보내고, 스레드 풀과 DB 커넥션 풀, 외부 API 동시 호출 슬롯이 동시에 잠기기 시작하면 그다음은 대개 비슷합니다. 큐 대기시간이 늘고, 타임아웃이 튀고, 재시도가 겹치면서 시스템 전체가 느려집니다.

그래서 실무에서는 “더 빨리 처리하는 법”만큼 “언제부터는 덜 받는 법”이 중요합니다. Admission control과 concurrency limit은 사용자를 거절하기 위한 기술이 아니라, **중요한 요청을 끝까지 살리기 위한 보호 장치**입니다. 이 글에서는 rate limit, queue, load shedding과 헷갈리기 쉬운 개념을 분리하고, 실제 운영에서 어떤 숫자를 기준으로 걸어야 하는지 정리합니다.

## 이 글에서 얻는 것

- admission control과 concurrency limit이 단순 rate limit과 어떻게 다른지 구분할 수 있습니다.
- 병목 리소스별로 동시 처리 상한을 잡는 방법과, 큐를 어디까지 허용할지 **숫자 기준**을 세울 수 있습니다.
- 과부하 상황에서 **사용자 경험 보호 > 시스템 생존 > 평균 성능** 순으로 의사결정하는 운영 기준을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) admission control은 "빨리 막는 기술"이 아니라 "늦게 망하지 않게 하는 기술"이다

장애는 보통 CPU 100%에서 갑자기 시작되지 않습니다. 그 전에 이미 입구에서 신호가 나옵니다. inflight 요청 수가 늘고, 큐 대기시간이 길어지고, 처리시간이 조금만 늘어도 전체 체류시간이 함께 불어납니다. 이런 구조는 [용량 계획과 Little's Law 기반 포화도 해석](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)과 [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)을 같이 보면 더 명확합니다.

Admission control의 핵심은 단순합니다.

1. 지금 시스템이 감당 가능한 동시 작업량을 정한다.
2. 그 상한을 넘는 요청은 무한 대기시키지 않는다.
3. 핵심 경로는 별도 예산을 둬서 끝까지 보호한다.

즉 admission control은 "모든 요청을 공평하게 늦게 처리"하는 방식이 아니라, **중요 요청을 위해 비중요 요청을 먼저 제어**하는 방식입니다.

### 2) rate limit, concurrency limit, load shedding은 같은 말이 아니다

셋을 섞어서 쓰면 운영 기준이 흔들립니다.

- **Rate Limit**: 초당 요청 수를 제한, 입구의 유입률 제어
- **Concurrency Limit**: 동시에 처리 중인 작업 수를 제한, 내부 점유량 제어
- **Load Shedding**: 이미 혼잡한 순간에 일부 요청을 적극적으로 버림, 붕괴 방지

예를 들어 초당 100건만 받도록 제한해도, 각 요청이 3초씩 걸리면 inflight는 300개가 됩니다. 반대로 초당 500건이 들어와도 요청당 30ms면 충분히 버틸 수 있습니다. 그래서 고부하 시스템에서는 rate limit 하나만으로는 부족하고, **현재 처리 중인 양(inflight)을 직접 제한**해야 합니다.

이 흐름은 [Priority Load Shedding과 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)와 함께 설계해야 일관성이 생깁니다. 입구 제한 없이 차단만 뒤늦게 붙이면 대응이 항상 늦습니다.

### 3) 동시성 상한은 서버 대수보다 병목 자원에서 결정된다

많은 팀이 "인스턴스가 10대니까 요청도 많이 받자"처럼 계산합니다. 하지만 실제 상한은 병목 자원에서 먼저 결정됩니다.

- 앱 worker 또는 event loop 처리 슬롯
- DB 커넥션 풀
- 외부 API 동시 호출 수
- 캐시 재계산 worker
- 메시지 소비자 concurrency

예를 들어 핵심 API가 DB 커넥션을 평균 1개, p95 180ms 동안 점유하고 DB pool이 120개라면, 이 API 계열은 안전 구간을 pool의 60~70% 이내로 두는 편이 낫습니다. 즉 운영 상한을 대략 70~80 inflight에서 시작해 보는 식입니다. CPU나 메모리 여유가 있어도 DB가 병목이면 더 받는 순간 p99만 길어집니다.

권장 출발값은 보수적으로 잡는 편이 좋습니다.

- 핵심 쓰기 경로: 병목 풀 실효 용량의 **50~60%**
- 중요 조회 경로: **60~70%**
- 비핵심/배치 경로: 남는 슬롯 안에서만 허용
- 전체 시스템 보호선: 최근 10분 `queue_wait_p95 > 40ms` 또는 `timeout_rate > 1%`이면 즉시 하향 조정 검토

정답 숫자는 서비스마다 다르지만, **병목 자원의 80%를 평시 목표로 두는 운영은 대체로 위험**합니다. 피크 변동과 재시도, GC, 일시적 lock wait가 들어오면 여유가 너무 작기 때문입니다.

### 4) 큐는 공짜 완충재가 아니라 지연 부채다

Admission control이 없는 팀은 보통 큐로 버팁니다. 일단 받자, 나중에 처리하자, 잠깐 밀려도 괜찮겠지, 이런 식입니다. 그런데 짧은 API 요청에서 큐는 완충재라기보다 **지연을 미래로 미루는 부채**에 가깝습니다.

실무에서는 아래처럼 생각하는 편이 맞습니다.

- 사용자 동기 요청: 큐보다 **즉시 실패 또는 축소 응답** 우선
- 내부 비동기 작업: 큐 허용, 단 backlog 상한 필수
- 재처리성 작업: 별도 low-priority queue 분리

권장 기준 예시는 아래와 같습니다.

- 동기 API `queue_length <= worker * 1~2`
- 동기 API `queue_wait_p95 <= 30~50ms`
- 초과 시 신규 요청 대기보다 `429/503` 또는 fallback 우선
- 비동기 작업 큐는 backlog 허용 시간 기준으로 관리, 예를 들어 `lag <= 2분`

이건 [Timeout·Retry·Backoff 실전 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)과도 연결됩니다. 이미 오래 기다린 요청에 다시 재시도까지 붙으면 같은 시스템이 자기 자신을 더 밀어넣는 구조가 됩니다.

### 5) 멀티테넌트 환경에서는 전체 상한만 두면 노이즈 네이버를 못 막는다

SaaS나 내부 플랫폼에서는 전체 inflight 제한만으로 충분하지 않은 경우가 많습니다. 한 테넌트 또는 한 배치 작업이 슬롯을 대부분 차지해 버리면 나머지 고객이 같이 느려집니다. 이때 필요한 것은 전체 limit 하나가 아니라 **per-tenant limit, class-based limit, 우선순위별 limit**입니다.

예를 들어 아래처럼 나눌 수 있습니다.

- 전체 inflight 상한: 240
- 테넌트당 기본 상한: 12
- 프리미엄 테넌트 상한: 24
- 배치/백오피스 작업 상한: 전체의 10% 이내
- 인증/결제 계열 보호 슬롯: 별도 40 확보

이런 설계는 [멀티테넌트 공정성 스케줄링](/learning/deep-dive/deep-dive-tenant-fairness-scheduling-playbook/)과 함께 봐야 실제로 동작합니다. 전체 평균이 아니라 고객별 tail latency를 봐야 하는 이유도 여기 있습니다.

## 실무 적용

### 1) 도입 순서는 limit 숫자보다 "무엇을 먼저 보호할지"부터 정해야 한다

현업에서 가장 효과적인 순서는 대체로 이렇습니다.

**1단계, 경로 분류**
- P0: 인증, 결제, 주문 확정처럼 실패 비용이 큰 경로
- P1: 조회성 핵심 경로
- P2: 백오피스, 추천, 대량 조회, 배치성 경로

**2단계, 병목 자원 식별**
- 각 경로가 주로 점유하는 리소스가 worker인지, DB pool인지, 외부 API인지 확인
- 경로별 p95 처리시간과 inflight 추정치 계산

**3단계, 동시성 상한과 큐 상한 적용**
- P0는 별도 보호 슬롯
- P1은 제한적 큐 허용
- P2는 먼저 차단 또는 샘플 shed

**4단계, 알람과 자동 완화 연결**
- 임계치를 넘으면 limit을 자동 하향하거나 P2를 먼저 차단
- 사람이 보는 런북에는 조정 순서를 고정

이 순서를 지키면 "일단 limit 걸어봤더니 핵심 주문도 같이 막힌다" 같은 사고를 줄일 수 있습니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

추천 우선순위는 **핵심 사용자 흐름 보호 > 병목 자원 보호 > 평균 응답시간 개선 > 전체 처리량 유지**입니다.

즉시 조치 조건 예시:

- `request_p99 > SLO x 1.4`가 5분 이상 지속
- `queue_wait_p95 > 50ms`
- `timeout_rate > 1%`
- `db_pool_in_use > 75%`가 지속되며 wait time 증가
- 특정 테넌트의 inflight 비중이 전체의 20% 초과

조치 우선순위 예시:

1. P2 동시성 상한 30~50% 하향
2. 테넌트별 상한 재조정 또는 hot tenant 임시 제한
3. 재시도 횟수 축소 또는 비활성화
4. P0 보호 슬롯 확대
5. 그래도 지속되면 부분 기능 강등 또는 load shedding 강화

중요한 건 limit 값 자체보다 **하향 순서와 보호 순서가 문서화돼 있느냐**입니다. 숫자가 조금 틀린 것보다, 혼잡 시 모두 제각각 대응하는 것이 훨씬 위험합니다.

### 3) 구현 패턴 예시

구현은 거창할 필요가 없습니다. 오히려 단순한 방식이 운영에 강합니다.

- 프로세스 로컬 세마포어로 경로별 inflight 제한
- Redis 기반 분산 토큰 또는 lease로 다중 인스턴스 상한 공유
- API Gateway 레벨 rate limit + 서비스 내부 concurrency limit 이중 방어
- per-tenant key 기준 슬라이딩 카운터 + 우선순위 큐

실무에서는 "전역 limit 1개"보다 **경로별 + 테넌트별 + 자원별** 세 층으로 나누는 편이 효과적입니다. 예를 들어 인증 API는 Gateway rate limit, 서비스 inflight limit, DB pool reserve를 동시에 둬야 진짜로 보호됩니다.

### 4) 관측 지표 최소 세트

다음 정도는 반드시 분리해서 보기를 권합니다.

- `inflight_requests{route,priority,tenant_class}`
- `admission_reject_count{reason}`
- `queue_wait_p95{route}`
- `timeout_rate{route}`
- `db_pool_wait_p95` 또는 외부 API inflight
- `user_success_rate{critical_path}`

특히 `reject_count`만 보면 안 됩니다. 거절이 늘었는데 핵심 경로 성공률도 떨어지면 limit 설계가 잘못된 것입니다. 반대로 거절은 조금 늘었지만 P0 성공률과 p99가 회복됐다면 좋은 제어일 수 있습니다.

## 트레이드오프/주의점

1) **제한은 단기적으로 거절률을 올릴 수 있다**  
무제한 대기를 하던 시스템에 상한을 넣으면 처음엔 429/503이 보일 수 있습니다. 하지만 이건 통제된 실패이고, 전체 붕괴보다 훨씬 싸게 끝납니다.

2) **limit만 있고 우선순위가 없으면 핵심 경로도 같이 죽는다**  
전체 200개 상한만 두고 경로 구분이 없으면, 비핵심 조회가 인증 요청 슬롯까지 잡아먹습니다.

3) **분산 limit은 구현이 복잡해질 수 있다**  
너무 정교한 전역 스케줄러를 먼저 만들 필요는 없습니다. 로컬 limit과 핵심 경로 분리만으로도 많은 장애를 줄일 수 있습니다.

4) **클라이언트 정책이 맞물리지 않으면 효과가 반감된다**  
서버가 admission reject를 보내는데 모바일 앱이 즉시 재시도하면 부하 루프가 생깁니다. 서버와 클라이언트의 재시도 규칙을 함께 보정해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] P0, P1, P2 경로 구분과 보호 우선순위가 문서화돼 있다.
- [ ] 병목 자원 기준으로 concurrency limit을 잡고 있다.
- [ ] 동기 API의 큐 길이와 대기시간 상한이 숫자로 정의돼 있다.
- [ ] per-tenant 또는 workload class 상한이 필요할지 검토했다.
- [ ] reject, timeout, 핵심 성공률을 함께 관측한다.
- [ ] 혼잡 시 하향 조정 순서가 런북에 고정돼 있다.

### 연습 과제

1. 현재 서비스의 상위 5개 API에 대해 `병목 자원 / p95 처리시간 / 현재 inflight / 권장 상한`을 한 표로 적어보세요.  
2. 특정 테넌트 또는 특정 배치 작업이 전체 슬롯을 독점하는 상황을 가정하고, `per-tenant limit`과 `P0 보호 슬롯`을 각각 몇 개로 둘지 근거를 써보세요.  
3. 지난 2주 지표에서 `queue_wait_p95`와 `timeout_rate`가 같이 튄 시간대를 골라, admission control이 있었다면 어떤 요청을 먼저 막았을지 우선순위를 정해보세요.

## 관련 글

- [용량 계획과 Little's Law 기반 포화도 해석](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Priority Load Shedding과 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)
- [Timeout·Retry·Backoff 실전 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [멀티테넌트 공정성 스케줄링 플레이북](/learning/deep-dive/deep-dive-tenant-fairness-scheduling-playbook/)
- [Rate Limiter 설계와 운영 기준](/learning/deep-dive/deep-dive-rate-limiter-design/)
