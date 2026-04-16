---
title: "백엔드 커리큘럼 심화: Clock Skew를 전제로 시간 의미론을 설계하는 실무 플레이북"
date: 2026-03-29
draft: false
topic: "Distributed Systems"
tags: ["Clock Skew", "Time Semantics", "NTP", "Lamport Clock", "Hybrid Logical Clock", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "분산 시스템에서 시계 오차를 예외가 아니라 기본 조건으로 보고, 시간 기반 로직을 안전하게 설계·운영하는 기준을 정리합니다."
module: "distributed-system"
study_order: 1161
---

## 이 글에서 얻는 것

- "서버 시간은 대체로 맞는다"는 전제를 버리고, **시계 오차(Clock Skew)를 장애 조건으로 다루는 설계 관점**을 얻습니다.
- wall clock(현실 시간)과 monotonic clock(경과 시간)을 분리해, 타임아웃·재시도·토큰 만료·정렬 로직을 더 안전하게 구현할 수 있습니다.
- **숫자 기반 의사결정 기준(허용 오차, 알람 임계치, 우선순위)**을 갖고 운영 런북을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 시간은 하나가 아니라, 목적별로 다른 타입이 필요하다

실무에서 "시간"을 한 종류로 취급하면 반드시 사고가 납니다. 최소 3개로 분리해야 합니다.

1. **Event Time(업무 사건 시각)**: 결제 완료, 주문 생성처럼 도메인 의미가 있는 시각
2. **Processing Time(처리 시각)**: 시스템이 그 이벤트를 실제로 처리한 시각
3. **Elapsed Time(경과 시간)**: 타임아웃/지연 측정처럼 "얼마나 지났는지"가 중요한 시간

여기서 핵심은, 경과 시간 계산에 wall clock을 쓰지 않는 것입니다. NTP 보정이나 VM 시간 드리프트가 생기면 시계가 뒤로 갈 수 있고, 그 순간 rate limiter·timeout 계산이 깨집니다. 이 문제는 정합성 선택 문제와도 연결되므로 [Consistency 모델 정리](/learning/deep-dive/deep-dive-consistency-models/)를 같이 보면 의사결정이 더 단단해집니다.

### 2) Clock Skew가 실제 장애를 만드는 대표 경로

시계 오차는 "몇 ms 차이" 자체보다, **시간 기반 비즈니스 규칙**에서 치명적입니다.

- JWT 만료 검증: 노드 A는 만료로 판단, 노드 B는 유효로 판단
- 리더 선출/락 만료: 너무 이른 만료 판정으로 이중 리더 발생
- 이벤트 정렬: 순서 역전으로 중복 처리 또는 누락 처리
- 재시도 백오프: 음수 지연 계산으로 과도한 즉시 재시도

대부분은 "시간을 믿은 코드"에서 터집니다. 특히 [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/)와 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/) 없이 시간만으로 중복/순서를 제어하면 복구 비용이 크게 올라갑니다.

### 3) 실무 시간 모델: Wall Clock + Monotonic + Logical Clock의 조합

대규모 시스템에서 많이 쓰는 방식은 아래 조합입니다.

- **Wall Clock**: 로그·감사·사용자 표시 시각
- **Monotonic Clock**: timeout, retry, lease duration 계산
- **Logical/Lamport 또는 HLC**: 분산 이벤트 순서 비교

특히 HLC(Hybrid Logical Clock)는 물리 시간과 논리 카운터를 섞어 "대략적인 실제 시간"과 "인과 순서"를 동시에 확보하려는 접근입니다. 모든 시스템에 필수는 아니지만, 다중 리전/다중 writer에서 ordering 문제가 잦다면 우선 검토할 가치가 큽니다.

### 4) 운영 기준이 없으면 Skew 문제는 늘 "재현 어려운 버그"가 된다

Clock Skew 이슈는 장애 후 회고에서 자주 "그때만 이상했다"로 끝납니다. 이유는 간단합니다. **측정 지표와 기준선이 없기 때문**입니다.

권장 기본 지표:

- `clock_offset_ms`: 노드별 기준 시간 대비 오프셋
- `clock_drift_ppm`: 드리프트 속도(장시간 추세)
- `ntp_step_events_total`: 시간 점프(step) 횟수
- `jwt_not_yet_valid_errors`: 미래 시각 토큰 검증 실패 수
- `negative_elapsed_count`: 음수 경과시간 계산 횟수

이 지표를 [SLO/SLI 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과 연결하고, 원인 추적은 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)으로 묶어야 실효성이 생깁니다.

## 실무 적용

### 1) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **보안/정합성 보호 > 가용성 유지 > 성능 최적화** 순으로 두는 게 안전합니다.

권장 초기 기준:

- 인증 토큰 검증 허용 오차(`clockTolerance`): **±60초**에서 시작, 금융/고보안은 **±10~30초**
- 노드 `clock_offset_ms` 경보: **100ms 초과 경고**, **250ms 초과 즉시 조치**
- `ntp_step_events_total`: 시간 역행(step back) 발생 시 해당 노드 write path 일시 격리
- `negative_elapsed_count > 0`: 코드 결함으로 간주, 배포 승격 차단
- 리더 락 lease: p99 네트워크 지연의 **3~5배 + 안전 마진**으로 설정

중요한 건 숫자 그 자체보다 "조치 규칙이 붙어 있는가"입니다.

### 2) 구현 원칙: 시간 API를 목적별로 강제 분리

팀 규칙으로 아래를 명시하면 재발이 크게 줄어듭니다.

- `Instant.now()`/wall clock 호출은 어댑터 계층으로 제한
- 타임아웃 계산은 monotonic 기반 API만 허용
- 비즈니스 이벤트에는 `event_time`, `ingested_at`, `processed_at`를 분리 저장
- 정렬 키는 `event_time` 단독이 아니라 `(event_time, sequence)` 또는 HLC 사용

예를 들어 "최근 5분" 집계는 wall clock 범위 조건만으로 끝내지 말고, 늦게 도착한 이벤트 허용 윈도우(예: 2분)를 함께 둬야 합니다.

### 3) 배포/운영 런북(4단계)

1. **탐지**: 오프셋/드리프트/음수 경과시간 알람 수집
2. **격리**: 오프셋 큰 노드를 write/read path에서 우선 분리
3. **보정**: 시간 동기화 재수행 후 상태 확인
4. **복귀**: 토큰 검증 에러율·중복처리율 정상화 확인 후 재투입

여기서 핵심은 "시간 보정 즉시 전체 재투입"을 피하는 것입니다. 재투입 전 5~10분 관측 구간을 두고, 중복 이벤트와 인증 오류가 기준 이하인지 확인해야 합니다.

### 4) 코드 리뷰 체크 기준

시간 관련 PR에서 아래 질문이 빠지면 승인하지 않는 정책이 좋습니다.

- 경과 시간 계산이 wall clock에 의존하는가?
- 시간 역행 시 음수/오버플로우 방어가 있는가?
- 이벤트 순서가 timestamp 단독 비교인가?
- 재시도/멱등성 없이 시간만으로 중복을 막으려 하는가?
- 운영 지표(`offset`, `negative elapsed`)를 남기는가?

## 트레이드오프/주의점

1) **엄격한 시간 검증은 사용자 실패율을 높일 수 있다**  
허용 오차를 너무 좁히면 정상 사용자도 인증 실패를 겪습니다. 보안 요구와 UX 손실 사이 균형이 필요합니다.

2) **논리 시계(HLC/Lamport)는 구현 복잡도를 올린다**  
순서 안정성은 좋아지지만, 저장 포맷·인덱스·디버깅 난이도가 함께 상승합니다.

3) **NTP 동기화만으로 문제를 끝낼 수 없다**  
시간 인프라가 정상이어도, 코드가 wall clock을 잘못 쓰면 동일한 장애가 반복됩니다.

4) **"시간 오차=인프라 문제"로만 보면 원인 분석이 왜곡된다**  
실제 사고의 절반 이상은 애플리케이션 레이어의 시간 의미론 부재에서 발생합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] timeout/retry 계산이 monotonic clock 기반으로 구현돼 있다.
- [ ] 인증 토큰 검증 허용 오차와 조정 근거가 문서화돼 있다.
- [ ] `event_time`과 `processed_at`을 분리 저장한다.
- [ ] clock offset/step 이벤트가 대시보드와 알람으로 연결돼 있다.
- [ ] 시간 역행 시 노드 격리 및 복귀 절차가 런북에 정의돼 있다.

### 연습 과제

1. 최근 30일 로그에서 `negative elapsed` 패턴을 찾아 원인 코드를 분류해 보세요.  
2. JWT 검증 허용 오차를 60초→30초로 줄였을 때 실패율 변화(일주일)를 시뮬레이션해 보세요.  
3. 이벤트 정렬 로직을 `timestamp only`와 `(timestamp + sequence)` 두 방식으로 비교해 역전율을 계산해 보세요.

## 관련 글

- [데이터 정합성 모델(Strong vs Eventual)](/learning/deep-dive/deep-dive-consistency-models/)
- [Idempotency 설계와 중복 처리](/learning/deep-dive/deep-dive-idempotency/)
- [Timeout/Retry/Backoff 실전 가이드](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [구조화 로깅 전략](/learning/deep-dive/deep-dive-structured-logging/)
