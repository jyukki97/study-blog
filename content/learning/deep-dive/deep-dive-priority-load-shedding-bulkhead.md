---
title: "백엔드 커리큘럼 심화: Priority Load Shedding과 Bulkhead로 혼잡 상황을 통제하는 법"
date: 2026-03-22
draft: false
topic: "Resilience"
tags: ["Load Shedding", "Bulkhead", "Admission Control", "Priority Queue", "Overload"]
categories: ["Backend Deep Dive"]
description: "트래픽 급증 시 모든 요청을 동일하게 처리하려는 접근을 버리고, 우선순위 기반 차단과 격리(Bulkhead)로 시스템 붕괴를 막는 실무 기준을 정리합니다."
module: "backend-resilience"
study_order: 1120
---

서비스 장애의 상당수는 “코드가 틀려서”보다 “혼잡을 통제하지 못해서” 발생합니다. 평소에는 300ms 안에 끝나던 API가 트래픽 급증 순간 3초를 넘어가고, 재시도가 겹치며 커넥션 풀과 스레드 풀이 동시에 포화됩니다. 이때 많은 팀이 하는 실수는 하나입니다. **모든 요청을 끝까지 받으려는 것**입니다.

실무에서는 반대로 가야 합니다. 중요한 요청을 먼저 살리고, 덜 중요한 요청은 빠르게 거절해 전체 시스템을 보호해야 합니다. 이 글은 그때 쓰는 두 축, **Priority Load Shedding(우선순위 기반 트래픽 차단)**과 **Bulkhead(자원 격리)**를 운영 기준 중심으로 정리합니다.

## 이 글에서 얻는 것

- 과부하 상황에서 “전체 실패” 대신 “통제된 부분 실패”로 전환하는 설계 원칙을 이해할 수 있습니다.
- 요청 우선순위를 나눌 때 필요한 **숫자 기준(지연·오류·큐 길이)**과 차단 조건을 바로 적용할 수 있습니다.
- Bulkhead를 스레드/커넥션/워크큐 단위로 나눠 실제 서비스에 붙이는 **의사결정 순서**를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 과부하의 본질은 처리량 부족이 아니라 “경합 확산”이다

트래픽이 임계점을 넘으면 먼저 P99가 나빠지고, 이어서 큐 대기시간이 늘고, 마지막으로 타임아웃/재시도로 폭발합니다. 이 메커니즘은 [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)에서 다룬 것처럼 포화 전이(saturation transition)로 보는 게 정확합니다.

핵심은 단순합니다.

1. 느린 요청이 자원 점유 시간을 늘리고
2. 대기열을 길게 만들고
3. 중요한 요청까지 같이 늦게 만듭니다.

그래서 “다 받자” 전략은 사용자 친화가 아니라, 결국 **모두를 느리게 만드는 전략**이 됩니다.

### 2) Priority Load Shedding: 요청을 중요도별로 다르게 대우한다

우선순위는 보통 3단계로 나눕니다.

- **P0(핵심 경로):** 결제 승인, 인증 토큰 재발급, 주문 확정
- **P1(중요하지만 지연 허용):** 주문 조회, 계정 정보 조회
- **P2(비핵심/배치성):** 추천, 통계성 API, 백오피스 고비용 조회

그리고 혼잡 시점마다 차단 강도를 올립니다.

- 단계 A(경고): `CPU > 70%` 또는 `queue_wait_p95 > 40ms`
  - P2 요청 일부(예: 20%)만 샘플 차단
- 단계 B(혼잡): `CPU > 80%` 또는 `request_p99 > SLO x 1.3`
  - P2 전면 차단, P1 일부 제한
- 단계 C(위기): `timeout_rate > 2%` 또는 `queue_wait_p95 > 100ms`
  - P0만 유지, 나머지 즉시 429/503

이 정책은 [Admission Control/Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)과 같이 동작해야 효과가 납니다. 차단 기준이 없으면 제한은 감으로 운영되고, 결국 늦게 반응합니다.

### 3) Bulkhead: 장애 전파를 막는 “자원 방화벽”

Bulkhead는 우선순위 정책을 실제 자원 배분으로 고정하는 장치입니다. 실무에서 자주 쓰는 분리 축은 아래 3개입니다.

- **스레드 풀 분리:** P0 전용 worker pool 확보
- **DB 커넥션 풀 분리:** 핵심 트랜잭션 전용 커넥션 비율 고정
- **워크큐 분리:** 비핵심 비동기 작업 큐를 독립 처리

예시(중간 규모 API 서버):

- 총 worker 120개
  - P0: 60
  - P1: 40
  - P2: 20
- DB pool 150개
  - 트랜잭션성 쓰기: 70
  - 핵심 조회: 50
  - 비핵심 조회: 30

이렇게 분리하면 P2 트래픽 폭증이 와도 P0 슬롯이 고갈되지 않습니다. [Connection Pool 운영](/learning/deep-dive/deep-dive-connection-pool/)과 [Rate Limiter 설계](/learning/deep-dive/deep-dive-rate-limiter-design/)를 함께 보면 설계 폭이 넓어집니다.

### 4) 차단 응답도 “정책”이어야 한다

Load Shedding을 503 하나로 통일하면 클라이언트 재시도가 오히려 부하를 키울 수 있습니다.

- P2 차단: 429 + `Retry-After`(짧은 재시도 유도)
- 다운스트림 장애 전파: 503 + fallback payload
- 사용자 행동 유도 가능 경로: 캐시 데이터/간소 응답 제공

핵심은 [Timeout·Retry·Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/) 정책과 맞추는 것입니다. 서버가 “줄이라”고 말하는데 클라이언트가 “더 때리는” 구조면 차단은 실패합니다.

### 5) 운영 난점: 우선순위가 조직 구조를 드러낸다

기술보다 어려운 부분은 “무엇이 진짜 P0인가”를 합의하는 일입니다. 모든 팀이 자기 API를 핵심이라고 주장하면 설계는 무너집니다.

그래서 기준을 제품 KPI에 연결해야 합니다.

- 매출 직접 영향, 보안/인증, 법적 의무 경로는 P0
- 사용자 불편이지만 복구 가능한 경로는 P1
- 지연/축소 가능 기능은 P2

즉 우선순위는 기술 분류가 아니라 **비즈니스 연속성 분류**입니다.

## 실무 적용

### 1) 2주 도입 순서

**1~3일차: 경로 분류와 현재 포화 지표 측정**
- 엔드포인트별 P95/P99, timeout_rate, queue_wait 측정
- API를 P0/P1/P2로 태깅(소유 팀·근거 문서 포함)

**4~7일차: 최소 차단 정책 적용**
- 단계 A/B/C 임계치 정의
- P2 우선 차단 정책 배포(초기 10% 트래픽만)
- 429/503 응답 표준화 및 클라이언트 재시도 제한 반영

**8~14일차: Bulkhead와 자동화 연결**
- 풀/큐/커넥션 분리 반영
- 알람-런북-자동 완화 조건 연결
- 카나리(5%→25%→100%)로 확장

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **핵심 사용자 흐름 보호 > 전체 처리량 유지 > 평균 응답시간 개선** 순서로 둡니다.

즉시 완화 트리거 예시:

- `request_p99 > SLO x 1.4`가 5분 이상 지속
- `timeout_rate > 1.5%`
- `queue_wait_p95 > 80ms`

완화 액션 우선순위:

1. P2 요청 차단 비율 상향(20%→50%→100%)
2. P1 동시성 상한 하향(예: 40→25)
3. P0 보호 슬롯 상향(예: 60→80)
4. 그래도 악화되면 읽기 fallback 활성화

주의할 점은 “스케일 아웃 먼저”가 항상 정답은 아니라는 것입니다. 포화 원인이 외부 의존성/DB 락이면 인스턴스 증설은 부하 증폭이 될 수 있습니다.

### 3) 관측과 검증

최소 모니터링 세트:

- `shed_count{priority}`
- `inflight{priority}`
- `queue_wait_p95{priority}`
- `fallback_served_ratio`
- `user_success_rate{critical_path}`

알람은 인프라 지표 단독보다 사용자 성공률과 함께 봐야 합니다. [관측 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)처럼 “행동 가능한 알람”으로 구성해야 온콜 피로를 줄일 수 있습니다.

## 트레이드오프/주의점

1) **부분 실패를 받아들이지 못하면 전체 실패가 온다**  
P2를 살리려다 P0까지 죽는 경우가 가장 비쌉니다. 차단은 품질 저하가 아니라 생존 전략입니다.

2) **우선순위 남발은 제도 붕괴로 이어진다**  
예외 요청을 계속 P0로 올리면 사실상 정책이 사라집니다. 분기마다 P0 목록을 재검토해야 합니다.

3) **잘못된 임계치는 사용자 경험을 흔든다**  
임계치를 너무 낮게 잡으면 평시에도 과차단, 너무 높으면 이미 늦은 대응이 됩니다. 2~4주 데이터로 보정이 필수입니다.

4) **클라이언트 정책 미정렬은 부하 루프를 만든다**  
서버는 차단하는데 모바일/웹이 즉시 재시도하면 트래픽 스파이크가 길어집니다. 서버·클라이언트 정책을 함께 바꿔야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] API 경로가 P0/P1/P2로 분류되고 소유 팀이 명시되어 있다.
- [ ] 단계 A/B/C 임계치가 숫자로 정의되어 있다.
- [ ] P0 전용 worker/DB pool/queue가 분리되어 있다.
- [ ] 429/503 응답 정책과 클라이언트 재시도 정책이 정렬되어 있다.
- [ ] 분기별로 과차단율(shed false positive)과 사용자 성공률을 함께 점검한다.

### 연습 과제

1. 현재 서비스의 상위 20개 API를 P0/P1/P2로 분류하고, 분류 근거를 KPI(매출·보안·복구시간)와 함께 적어보세요.  
2. 혼잡 단계 A/B/C 임계치를 임시로 정의한 뒤, 지난 30일 지표에 리플레이해 과차단/미차단 비율을 계산해보세요.  
3. P2 API 1개를 골라 “즉시 거절(429)”과 “축소 응답(fallback)” 두 전략의 사용자 영향 차이를 A/B로 비교해보세요.

## 관련 글

- [Admission Control과 Concurrency Limit 설계](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Rate Limiter 설계와 운영 기준](/learning/deep-dive/deep-dive-rate-limiter-design/)
- [Connection Pool 운영 원리](/learning/deep-dive/deep-dive-connection-pool/)
- [Timeout·Retry·Backoff 실전 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [관측 알람 임계치 설계 가이드](/learning/deep-dive/deep-dive-observability-alarms/)
