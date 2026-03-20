---
title: "백엔드 커리큘럼 심화: Connection Storm·Thundering Herd를 막는 용량 보호 플레이북"
date: 2026-03-19
draft: false
topic: "Resilience"
tags: ["Connection Storm", "Thundering Herd", "Adaptive Concurrency", "Backpressure", "Capacity Planning"]
categories: ["Backend Deep Dive"]
description: "트래픽 급증·재시작·장애 복구 시 발생하는 Connection Storm과 Thundering Herd를 예방하고 완화하는 실무 설계 기준을 정리합니다."
module: "resilience"
study_order: 1109
---

## 이 글에서 얻는 것

- Connection Storm(짧은 시간에 연결이 폭증하는 현상)과 Thundering Herd(동일 이벤트에 다수 워커가 동시에 몰리는 현상)를 **분리해서 진단**하는 기준을 얻습니다.
- DB/캐시/외부 API를 보호하기 위해 어떤 순서로 제어장치를 넣어야 하는지, **숫자 기반 우선순위**를 잡을 수 있습니다.
- 장애 직후 재기동, 배포 직후 스케일아웃, 캐시 만료 시점 같은 고위험 구간에서 쓸 수 있는 **운영 플레이북**을 확보할 수 있습니다.

## 핵심 개념/이슈

### 1) 두 문제는 같이 터지지만 원인은 다르다

실무에서 자주 보이는 패턴은 이렇습니다. 한 노드가 죽고 오토스케일이 새 인스턴스를 띄우면, 새 인스턴스들이 동시에 DB 커넥션을 잡으려 하면서 Connection Storm이 시작됩니다. 동시에 캐시가 비어 있거나 만료되면 동일 키 조회가 몰리면서 Thundering Herd가 발생합니다. 둘이 겹치면 DB CPU와 커넥션 슬롯이 급격히 소진됩니다.

- **Connection Storm 신호**: `too many connections`, DB 대기 큐 급증, 앱 시작 직후 타임아웃 증가
- **Thundering Herd 신호**: 동일 쿼리/동일 캐시 키가 순간적으로 폭증, 상위 N개 핫키 집중

둘을 한 번에 “트래픽 급증”으로 뭉개서 보면 대응이 늦습니다. 먼저 병목을 분리해야 합니다. 병목 위치를 보는 기본기는 [커넥션 풀 설계](/learning/deep-dive/deep-dive-connection-pool/), [로드 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/), [레이트 리밋/백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)를 같이 보면 빠르게 정리됩니다.

### 2) 보호 우선순위는 "DB 생존 > 요청 성공률 > 응답속도"가 안전하다

장애 상황에서 팀이 흔히 하는 실수는 p95를 먼저 지키려는 것입니다. 하지만 DB가 죽으면 p95는 의미가 없습니다. 우선순위는 보통 다음 순서가 맞습니다.

1. **DB/핵심 저장소 생존 보장** (연결 상한, 큐 길이 제한, 타임아웃 강제)
2. **요청 성공률 유지** (서킷 브레이커, degraded response)
3. **응답속도 최적화** (캐시/쿼리 최적화)

운영 기준 예시:

- DB 연결 사용률 85% 초과 5분 지속 → 신규 인스턴스 cold-start 속도 제한
- 요청 대기열 p95 200ms 초과 + 에러율 1% 초과 → 과부하 보호 모드 전환
- 외부 의존성 타임아웃 비율 3% 초과 → fallback 응답 강제

이 기준은 [SLO/에러 버짓](/learning/deep-dive/deep-dive-slo-sli-error-budget/) 관점에서 문서화해두지 않으면, 장애 때 팀마다 판단이 달라집니다.

### 3) Connection Budget을 먼저 계산하고, 그다음 확장을 논의해야 한다

“인스턴스를 더 띄우면 된다”는 접근은 Connection Storm에서 오히려 위험합니다. 먼저 총량 예산을 계산해야 합니다.

- DB 최대 연결: `max_connections`
- 운영 예약(관리/백업/마이그레이션): 보통 10~20%
- 앱 계층 가용 예산: `usable = max_connections - reserve`
- 인스턴스당 풀 상한: `pool_max_per_pod = floor(usable / 최대 동시 인스턴스 수)`

예를 들어 `max_connections=800`, reserve 120, 동시 20 pods면 인스턴스당 상한은 34입니다. 여기서 배포 중 임시 30 pods까지 늘어날 수 있다면, 평시 상한을 22~24로 더 보수적으로 잡아야 합니다. 이 계산 없이 오토스케일만 키우면 배포 순간마다 스톰이 재현됩니다.

### 4) Thundering Herd는 "동시성 제어 + 재시도 제어 + 캐시 만료 분산" 3종 세트로 막는다

Herd를 막는 핵심은 동일 작업의 동시 시작을 줄이는 것입니다.

- **동일 키 단일화(singleflight/request coalescing)**: 같은 키 요청은 1개만 원본 조회
- **Jittered TTL**: 캐시 만료를 랜덤 분산(예: 300초 ± 15%)
- **재시도 지수 백오프 + 상한**: 즉시 재시도 금지, 100ms→300ms→900ms 식으로 증가
- **Warm cache prefill**: 상위 핫키를 배포/재기동 전에 선충전

특히 동일 키 단일화는 [요청 코얼레싱](/learning/deep-dive/deep-dive-request-coalescing-singleflight/), 재시도 정책은 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 합쳐야 효과가 큽니다.

## 실무 적용

### 1) 4단계 방어선(중간 규모 트래픽 기준)

**1단계: 시작 속도 제어 (Startup Smoothing)**

- 인스턴스 부팅 후 즉시 최대 풀 확보 금지
- `initialDelay 5~30초 랜덤`, `pool warmup rate` 적용
- readiness 통과 전 백그라운드 프리워밍만 허용

**2단계: 동시성 상한 (Admission + Pool Cap)**

- 앱 레벨 in-flight 요청 상한 도입(예: 인스턴스당 200)
- DB 풀 대기 시간 상한(예: 50ms) 초과 시 빠른 실패 또는 대체 응답
- 큐가 무한 증가하지 않도록 queue length cap 적용

**3단계: 복구 시점 보호 (Recovery Guardrail)**

- 장애 복구 후 전체 트래픽 100% 복원 금지, 10%→25%→50%→100%로 단계 상승
- 단계별 3~5분 관찰 창에서 에러율·DB CPU·연결 사용률 확인
- 임계치 초과 시 자동 롤백 또는 현 단계 고정

**4단계: 캐시/재시도 안정화**

- TTL 랜덤화 기본값 적용
- 동일 키 단일화 미들웨어 강제
- 클라이언트 재시도 횟수 상한(보통 2~3회), 총 타임아웃 예산 고정

이 4단계는 [그레이스풀 셧다운](/learning/deep-dive/deep-dive-graceful-shutdown/) 및 [트래픽 컷오버](/learning/deep-dive/deep-dive-traffic-cutover-migration/) 운영과 함께 설계해야 배포 중 장애 재발을 줄일 수 있습니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

아래 기준은 “보수적 운영”을 전제로 한 예시입니다.

- **P0 (즉시 조치)**
  - DB 연결 사용률 > 90% 3분 지속
  - API 에러율 > 5% 5분 지속
  - 조치: 신규 스케일아웃 중지 + 트래픽 단계 하향 + 비핵심 기능 brownout

- **P1 (15분 내 조치)**
  - DB 풀 대기 p95 > 80ms
  - 동일 키 조회 비중 상위 1%가 전체의 35% 초과
  - 조치: 핫키 prefill + coalescing 강제 + TTL 재분배

- **P2 (당일 개선)**
  - cold start 직후 10분 내 타임아웃 비율 1% 초과 반복
  - 조치: startup jitter 상향, readiness 조건 강화

우선순위는 **저장소 보호 > 장애 전파 차단 > UX 최적화**로 유지하는 게 안전합니다.

### 3) 운영 런북 템플릿

1. 장애 징후 감지: 연결 사용률, 풀 대기, 동일 키 집중도 확인  
2. 보호 모드 진입: admission cap 하향, 비핵심 엔드포인트 제한  
3. 원인 분리: Connection Storm인지 Herd인지 지표로 분리  
4. 완화 조치: warmup/jitter/retry 정책 적용  
5. 복구 검증: 30분 안정화 창에서 SLO 회복 확인  
6. 사후 조치: 임계치 조정, 재현 테스트, 문서 갱신

이 흐름을 [관측 가능성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/)과 [장애 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)에 연결해두면, 야간 장애에서도 판단 속도가 크게 올라갑니다.

## 트레이드오프/주의점

1) **보수적 상한은 비용을 낮추지만 피크 처리량을 깎는다**  
연결/동시성 상한을 낮추면 스톰은 줄지만, 단기 피크에서 429/503이 늘 수 있습니다. 상품 정책상 “일시적 거절”이 가능한지 먼저 합의해야 합니다.

2) **재시도 제한은 의존성 보호에 좋지만 사용자 체감 실패를 늘릴 수 있다**  
재시도를 강하게 제한하면 평균 응답시간은 좋아져도 일부 요청은 더 빨리 실패합니다. 결제/정산처럼 재시도 가치가 큰 경로는 별도 정책이 필요합니다.

3) **캐시 TTL 분산은 안정성에 좋지만 일관성 창을 늘린다**  
TTL에 jitter를 넣으면 동시 만료가 줄어들지만 최신 데이터 반영 지연이 늘어날 수 있습니다. 도메인별로 허용 가능한 stale window를 숫자로 정해야 합니다.

4) **brownout은 전체 장애를 막지만 기능 축소를 동반한다**  
추천·검색 고급필터·대시보드 일부를 임시 비활성화하면 핵심 API는 살릴 수 있습니다. 하지만 제품팀과 사전 합의가 없으면 운영 중 갈등이 생깁니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] DB Connection Budget(예약 포함)을 문서화했다.
- [ ] 인스턴스 cold start jitter와 pool warmup rate를 적용했다.
- [ ] 동일 키 요청 coalescing을 기본 경로에 넣었다.
- [ ] 캐시 TTL에 jitter를 적용하고 핫키 prefill 절차를 만들었다.
- [ ] 장애 복구 트래픽을 단계적으로 올리는 런북을 운영 중이다.

### 연습 과제

1. 현재 서비스의 `max_connections`, 배포 중 최대 인스턴스 수를 기준으로 인스턴스당 풀 상한을 계산해보세요.  
2. 상위 20개 핫키를 뽑아 TTL 동시 만료 가능성을 시뮬레이션하고, jitter(±10%, ±20%)별 차이를 비교해보세요.  
3. 10분짜리 장애 게임데이를 설계해, recovery 단계(10%→25%→50%→100%)에서 어떤 지표를 통과 조건으로 둘지 정의해보세요.

## 관련 글

- [커넥션 풀 설계와 운영](/learning/deep-dive/deep-dive-connection-pool/)
- [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [요청 코얼레싱(singleflight) 패턴](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
- [Timeout/Retry/Backoff 실전](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [로드 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)
