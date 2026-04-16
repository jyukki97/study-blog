---
title: "백엔드 커리큘럼 심화: Graceful Degradation 플레이북 (Fallback·Read Only·Brownout)"
date: 2026-04-16
draft: false
topic: "Backend Reliability"
tags: ["Graceful Degradation", "Brownout", "Fallback", "Read Only Mode", "Load Shedding", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "장애를 0으로 만들 수 없다면 서비스가 어떤 순서로 덜 망가질지 먼저 설계해야 합니다. fallback, read only, brownout, load shedding을 실무 숫자 기준으로 정리합니다."
module: "resilience-degradation"
study_order: 1170
---

실무에서 장애 대응이 어려운 이유는 장애 자체보다도, 장애가 왔을 때 서비스가 어떤 모드로 버틸지 미리 정해 두지 않았기 때문입니다. 많은 팀이 정상 경로에는 공을 들이지만, 비정상 경로는 `500`이나 타임아웃으로 남겨 둡니다. 그런데 사용자는 시스템 내부 사정을 모르고, 운영자는 모든 기능을 한 번에 살리기 어렵습니다. 이때 필요한 관점이 **Graceful Degradation**입니다. 전부 살리는 것이 아니라, 핵심 기능을 먼저 지키고 덜 중요한 기능을 계획적으로 줄이는 방식입니다.

중요한 점은 graceful degradation이 막연한 "우아한 실패"가 아니라는 사실입니다. 실제로는 어떤 기능을 먼저 끌지, 어디까지 read only로 둘지, fallback은 몇 분까지 허용할지, brownout은 어느 임계치에서 시작할지를 숫자로 정해야 합니다. 이 글에서는 fallback, read only, brownout, load shedding을 한 세트로 묶어 실무 판단 기준을 정리합니다.

## 이 글에서 얻는 것

- graceful degradation을 단순 예외 처리와 구분해서, 서비스 운영 모드 전환 문제로 이해할 수 있습니다.
- read only, fallback, brownout, load shedding을 어떤 순서로 붙여야 운영 사고를 줄일 수 있는지 알 수 있습니다.
- CPU, queue depth, error rate, stale data 허용 시간처럼 실제 전환 기준을 숫자로 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) 장애 대응의 목표는 "모든 기능 복구"가 아니라 "핵심 가치 보존"이다

장애 상황에서 가장 먼저 해야 할 일은 서버를 살리는 것이 아니라, **무엇을 끝까지 지킬지 정하는 것**입니다. 예를 들어 커머스라면 상품 조회와 주문 조회는 최대한 유지하고, 추천 위젯이나 배지 집계는 나중에 줄이는 편이 맞습니다. SaaS라면 로그인, 결제, 데이터 조회는 지키고 대시보드의 부가 집계나 내보내기 기능은 늦춰도 됩니다.

그래서 graceful degradation의 첫 질문은 기술 스택이 아니라 기능 계층입니다.

1. 절대 내려가면 안 되는 핵심 경로는 무엇인가
2. stale data로 버틸 수 있는 기능은 무엇인가
3. read only로 전환 가능한 기능은 무엇인가
4. 완전히 끊어도 되는 부가 기능은 무엇인가

이 순서가 없으면 장애 때 모든 기능을 동등하게 대하게 되고, 결국 가장 중요한 경로까지 같이 무너집니다. 이 관점은 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과 같이 봐야 합니다. 에러 버짓은 단지 알람 기준이 아니라, 무엇을 먼저 보호할지 결정하는 운영 기준이기도 합니다.

### 2) fallback은 만능이 아니라, 품질 저하를 통제하는 계약이다

fallback은 다운스트림 호출이 실패했을 때 기본값이나 캐시 값을 대신 쓰는 방식입니다. 하지만 fallback을 무제한 허용하면 조용히 잘못된 데이터를 내보내는 시스템이 됩니다. 예를 들어 재고 수량, 결제 상태, 권한 정보는 낡은 값을 보여 주는 것 자체가 더 위험할 수 있습니다.

그래서 기능별로 fallback 허용 범위를 나눠야 합니다.

- **낡아도 되는 데이터**: 추천 목록, 인기 검색어, 랭킹, 배너
- **짧게만 낡아도 되는 데이터**: 프로필, 통계 카드, 배송 상태 요약
- **낡으면 안 되는 데이터**: 결제 승인, 재고 차감, 권한, 잔액

권장 초기 기준은 아래 정도가 현실적입니다.

- 추천/랭킹 캐시 fallback 허용: 5~15분
- 대시보드 집계 fallback 허용: 1~5분
- 결제/재고/권한 fallback 허용: 0초, 즉시 실패 또는 read only 전환
- fallback 응답 비율이 5분 이동창에서 20%를 넘으면 경고, 40%를 넘으면 brownout 검토

이 기준은 [캐시 스탬피드 대응](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/)이나 [Request Coalescing/SingleFlight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)와 연결됩니다. fallback은 비용 절감 장치가 아니라, 사용자 경험과 정합성의 타협선을 명시하는 장치입니다.

### 3) read only는 "쓰기 차단"이 아니라 "정합성 보호 모드"다

대부분의 장애에서 더 위험한 것은 조회 실패보다 **부분 성공 쓰기**입니다. DB 지연이 길거나 외부 결제/메시징 의존성이 불안정할 때 쓰기를 억지로 받으면 중복 처리, 유실, 보상 트랜잭션 폭증이 뒤따릅니다. 이럴 때 read only 전환은 후퇴가 아니라 손실을 줄이는 선택입니다.

대표적인 read only 전환 조건은 아래와 같습니다.

- DB 커넥션 풀 사용률이 3분 이상 85% 초과
- 쓰기 쿼리 p95 latency가 2초 초과
- deadlock 또는 lock timeout 비율이 평시 대비 3배 이상
- 아웃박스 적체가 임계치, 예를 들어 5만 건 초과

이 상황에서 쓰기를 계속 열어 두면 [트랜잭션 아웃박스 + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)나 [트래픽 컷오버 & 데이터 마이그레이션 전략](/learning/deep-dive/deep-dive-traffic-cutover-migration/)에서 말한 복구 비용이 급격히 커집니다. 실무에서는 "주문 생성 일시 중단, 주문 조회 유지", "설정 변경 차단, 조회 유지" 같은 식의 **부분 read only**가 가장 현실적입니다.

### 4) brownout은 전체 장애 전에 부가 기능을 의도적으로 어둡게 만드는 기술이다

brownout은 장애가 터진 뒤에 기능을 끄는 것이 아니라, 포화 임계치에 가까워질 때 먼저 부가 기능을 줄여 핵심 경로를 지키는 방식입니다. 예를 들어 홈 화면에서 개인화 추천, 실시간 배지, 부가 통계 API를 먼저 끄고 로그인과 주문 API는 유지하는 식입니다.

brownout이 필요한 이유는 포화 구간에서 시스템이 선형으로 느려지지 않기 때문입니다. thread, connection, CPU가 한계에 가까워지면 tail latency가 먼저 튀고, 재시도와 동시성이 겹치면 전체 시스템이 급격히 무너집니다. 이 부분은 [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 [Thread Pool 튜닝](/learning/deep-dive/deep-dive-thread-pool/)을 같이 보면 이해가 쉽습니다.

권장 brownout 트리거 예시:

- CPU 75% 이상 5분 지속, 그리고 p95 latency 1.5배 상승
- in-flight request가 평시 피크의 1.3배 초과
- queue depth 2만 건 초과 또는 처리 지연 60초 초과
- cache miss 급증으로 DB read QPS가 평시의 2배 초과

brownout은 임계치 도달 전 1차, 임계치 근접 시 2차처럼 단계별이 좋습니다.

- 1단계: 추천/배지/부가 통계 off
- 2단계: 검색 자동완성, 실시간 동기화 주기 완화
- 3단계: 쓰기 일부 read only 전환, 비동기 작업 지연 허용

### 5) load shedding은 실패를 감추는 게 아니라, 실패 범위를 제한하는 장치다

모든 요청을 받다가 전부 느려지는 것보다, 우선순위 낮은 일부 요청을 빠르게 거절하는 편이 전체적으로 낫습니다. 이게 load shedding입니다. 핵심은 "누구를 먼저 버릴지"를 미리 정하는 것입니다.

권장 우선순위는 보통 아래와 같습니다.

1. 인증된 핵심 사용자 경로
2. 결제, 주문, 조회 같은 수익/신뢰 핵심 경로
3. 운영자 내부 기능
4. 배치성 조회, 내보내기, 무거운 검색
5. 추천, 실험 기능, 크롤링성 트래픽

이 구조는 [Priority Load Shedding + Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)와 [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)를 함께 봐야 합니다. 재시도를 많이 두는 것보다, 낮은 우선순위 요청을 빨리 자르고 높은 우선순위 요청의 성공 확률을 올리는 편이 운영적으로 더 낫습니다.

## 실무 적용

### 1) 권장 운영 모드 설계

가장 실용적인 시작점은 서비스별로 네 가지 모드를 고정하는 것입니다.

- **Normal**: 모든 기능 정상
- **Degraded**: fallback 허용, 부가 기능 제한
- **Brownout**: 부가 기능 off, 비핵심 작업 지연
- **Read Only / Protected**: 쓰기 차단 또는 일부 기능 차단

모드마다 아래 항목이 문서화돼야 합니다.

- 어떤 기능이 꺼지는가
- 어떤 지표가 진입/해제 조건인가
- 운영자가 수동 override 가능한가
- 사용자에게 어떤 메시지를 보여 주는가

### 2) 의사결정 기준(숫자·조건·우선순위)

권장 우선순위는 **정합성 보호 > 핵심 경로 가용성 > 응답 속도 > 부가 기능 품질**입니다.

출발값 예시는 아래 정도가 좋습니다.

- p95 latency 2배 상승 + error rate 3% 초과 시 degraded 모드 검토
- CPU 75% 초과 5분 지속 또는 thread pool queue 500 초과 시 brownout 1단계
- DB pool utilization 85% 초과 3분 지속 시 쓰기 일부 차단 검토
- 5xx 비율 5분 이동창 5% 초과 시 비핵심 API shed
- cache fallback 응답 비율 40% 초과 시 stale 허용 종료 또는 기능 off
- 메시지 큐 적체가 평시의 3배 초과 시 배치/알림성 작업 일시 정지

중요한 건 임계치를 많이 두는 것이 아니라, **자동 전환 조건과 수동 승인 조건을 구분하는 것**입니다. 예를 들어 추천 위젯 off는 자동, 결제 쓰기 차단은 사람 승인 식으로 나누는 편이 안전합니다.

### 3) 구현 체크포인트

- feature flag로 기능 단위 차단이 가능해야 합니다.
- read only 전환은 API 게이트웨이, 애플리케이션, DB 권한 중 최소 2단계에서 막는 편이 안전합니다.
- fallback 응답에는 `stale=true`, `generated_at`, `degraded_reason` 같은 메타데이터를 실어 디버깅 가능성을 남겨야 합니다.
- brownout 단계는 runbook, 대시보드, 알람과 연결돼야 합니다.
- 고객지원팀이 볼 수 있는 공지 문구도 미리 준비해 두는 편이 좋습니다.

### 4) 4주 도입 순서

**1주차: 기능 계층도 작성**  
핵심 경로, 부가 경로, 낡아도 되는 데이터, 쓰기 차단 가능 경로를 분류합니다.

**2주차: 모드 정의와 지표 연결**  
normal, degraded, brownout, read only 진입 조건과 해제 조건을 수치로 적습니다.

**3주차: 플래그와 우선순위 큐 연결**  
기능 off, 우선순위별 shed, 배치 중단을 실제 시스템에 연결합니다.

**4주차: 게임데이와 복구 훈련**  
의도적으로 다운스트림 지연을 만들고, 어떤 모드 전환이 실제로 동작하는지 검증합니다.

## 트레이드오프/주의점

첫째, **fallback 남용**입니다. 보여 주는 데이터가 많다고 좋은 게 아닙니다. 정합성 민감 데이터에 fallback을 붙이면 사고를 숨기는 결과가 됩니다.

둘째, **모드 설계는 했는데 UI와 운영 절차가 없는 경우**입니다. 백엔드만 read only를 알아도 사용자와 CS 팀이 모르면 혼란이 커집니다.

셋째, **자동 전환 과민 반응**입니다. 임계치가 너무 공격적이면 brownout이 자주 켜졌다 꺼지며 체감 품질이 더 나빠집니다. 최소 지속 시간과 해제 히스테리시스가 필요합니다.

넷째, **우선순위 정의 부재**입니다. 어떤 요청을 먼저 살릴지 정하지 않으면 결국 VIP 경로나 수익 경로도 같이 느려집니다.

다섯째, **복구 기준이 없는 read only**입니다. 전환 기준만 있고 해제 기준이 없으면 운영자가 불안해서 오래 묶어 두게 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 서비스 기능을 핵심, 중요, 부가 기능으로 나눴다.
- [ ] fallback 허용 가능 데이터와 절대 불가 데이터를 구분했다.
- [ ] read only 전환 조건과 해제 조건을 수치로 정했다.
- [ ] brownout 단계별로 끌 기능 목록을 준비했다.
- [ ] load shedding 우선순위를 사용자 경로 기준으로 정했다.
- [ ] degraded 응답 메타데이터와 운영 대시보드를 연결했다.

### 연습 과제

1. 현재 운영 중인 서비스의 API 20개를 골라 `핵심 유지 / stale 허용 / read only 가능 / 즉시 차단 가능` 네 칸으로 분류해 보세요.
2. 장애가 났을 때 제일 먼저 끌 기능 5개와 절대 끄면 안 되는 기능 5개를 적고, 그 이유를 정합성·매출·신뢰 관점으로 설명해 보세요.
3. 최근 3개월 장애 사례를 다시 읽어 보면서 "그때 brownout이 있었다면 무엇을 먼저 줄였을까"를 runbook 형태로 정리해 보세요.

## 관련 글

- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Priority Load Shedding + Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)
- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [트랜잭션 아웃박스 + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Redis Cache Stampede 대응](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/)
