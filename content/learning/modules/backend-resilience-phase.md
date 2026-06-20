---
title: "5단계: 시스템 안정성 & 회복탄력성 (Resilience)"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["Resilience", "CircuitBreaker", "RateLimiter", "Gateway"]
categories: ["Learning"]
description: "장애 전파 차단, 트래픽 제어, 고가용성 설계를 다루는 모듈"
weight: 5
study_order: 500
layout: "learning-module"
module_key: "resilience"
url: "/learning/modules/backend-resilience-phase/"
aliases:
  - "/learning/modules/backend-resilience-phase/"
learning_refs:
  - title: "Timeout/Retry/Backoff 설계"
    href: "/learning/deep-dive/deep-dive-timeout-retry-backoff/"
    description: "타임아웃, 재시도, 백오프가 장애 전파를 막거나 키우는 기준을 숫자와 시나리오로 정리합니다."
  - title: "Resilience4j Circuit Breaker"
    href: "/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/"
    description: "서킷 브레이커의 상태 전이, 실패율 기준, half-open 검증 흐름을 Spring 환경에서 적용합니다."
  - title: "Rate Limiter 설계"
    href: "/learning/deep-dive/deep-dive-rate-limiter-design/"
    description: "트래픽 급증 상황에서 사용자 공정성, 시스템 보호, 429 응답 설계를 함께 다룹니다."
  - title: "Graceful Degradation & Brownout"
    href: "/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/"
    description: "전체 장애 대신 일부 기능을 낮춰 핵심 경로를 살리는 운영 의사결정 기준입니다."
---

## 이 단계에서 얻는 것

이 단계는 **"장애는 반드시 발생한다"**는 전제 하에 시스템을 지키는 기술을 다룹니다.

- **격벽과 차단**: 서킷 브레이커로 장애 전파를 막는 원리를 배웁니다.
- **트래픽 제어**: 레이트 리미터로 시스템을 보호하고 공정성을 확보합니다.
- **게이트웨이 전략**: 인증/라우팅/필터를 중앙화하여 마이크로서비스를 보호합니다.

## 이 모듈을 보는 방법

1) **보호**: 서킷 브레이커와 레이트 리미터로 개별 서비스를 보호하고
2) **진입점**: API 게이트웨이로 전체 시스템의 대문을 튼튼하게 만든 뒤
3) **관문**: 로드밸런서와 헬스체크로 고가용성 인프라를 완성합니다.

## 왜 이런 순서인가

애플리케이션 내부의 보호 장치(Resilience4j)부터 시작해, 앞단의 게이트웨이, 로드밸런서로 나아가는 **Inside-Out** 접근 방식입니다.

장애 대응은 도구 이름을 많이 아는 것보다 **어디에서 끊고, 어디까지 기다리고, 무엇을 포기할지**를 먼저 정하는 일이 중요합니다.
그래서 이 모듈은 `Timeout → Retry/Backoff → Circuit Breaker → Rate Limit/Bulkhead → Degradation` 순서로 읽으면 좋습니다.
앞 단계의 기준이 없으면 뒤 단계가 오히려 장애를 키울 수 있습니다. 예를 들어 타임아웃 없이 재시도만 붙이면 호출 수가 폭증하고, 서킷 브레이커 없이 fallback만 붙이면 실패가 조용히 숨겨져 장애 탐지가 늦어집니다.

## 이 단계의 핵심 주제

- Circuit Breaker/Retry/Timeout 기본 패턴
- Rate Limiting/Backpressure 전략
- API Gateway/Load Balancer 패턴
- 헬스체크/장애 전파 차단

## 운영 판단 루프: 기다릴지, 끊을지, 낮출지

회복탄력성 설계의 핵심 질문은 "장애가 났을 때 자동으로 무엇을 할 것인가"입니다. 실무에서는 아래 루프를 문서와 코드에 같이 남겨두면 좋습니다.

1. **대기 예산 정하기**: 사용자가 기다릴 수 있는 전체 시간을 먼저 정하고, 내부 API/DB/외부 API별 timeout budget을 나눕니다. 상위 요청이 2초를 넘기면 실패해야 한다면 하위 호출 3개가 각각 2초씩 기다리면 안 됩니다.
2. **재시도 조건 제한하기**: 네트워크 순간 오류처럼 회복 가능성이 높은 실패에만 재시도하고, 결제/주문 생성처럼 부작용이 있는 요청은 idempotency key 없이 재시도하지 않습니다.
3. **차단 기준 고정하기**: 실패율, slow call rate, 최소 호출 수, half-open probe 수를 숫자로 정합니다. "느리면 차단"이 아니라 "최근 N개 호출 중 실패율 X% 이상이면 Y초 동안 차단"처럼 운영자가 해석할 수 있어야 합니다.
4. **진입량 조절하기**: 사용자/테넌트/엔드포인트별 rate limit을 분리하고, 초과 시 `429`와 `Retry-After`를 일관되게 반환합니다. 내부 큐가 차오르는 상황에서는 더 받는 것보다 빨리 거절하는 편이 복구에 유리합니다.
5. **낮춰서 제공하기**: 추천, 통계, 실시간 동기화처럼 핵심 경로가 아닌 기능은 brownout 후보로 둡니다. 장애 중에도 로그인/조회/결제 같은 핵심 기능을 살릴 수 있으면 사용자 피해를 줄일 수 있습니다.

이 루프가 없으면 각 패턴이 따로 놉니다. 타임아웃은 짧지만 재시도 횟수가 많아 총 대기 시간이 길어지고, rate limit은 있지만 테넌트별 공정성이 없어 한 고객의 트래픽이 전체를 밀어내며, fallback은 있지만 stale data 허용 시간이 없어 잘못된 정보를 오래 보여줄 수 있습니다.

### 상황별 우선 적용 기준

회복탄력성 패턴은 모두 좋아 보이지만, 장애 상황에서 한꺼번에 붙이면 원인과 효과를 구분하기 어렵습니다. 먼저 관측 가능한 병목을 하나 고르고, 그 병목을 가장 직접적으로 줄이는 보호 장치부터 적용하는 편이 안전합니다.

| 관측된 신호 | 먼저 의심할 문제 | 우선 적용할 장치 | 확인할 지표 |
|---|---|---|---|
| p95/p99가 갑자기 길어짐 | 하위 호출 대기 시간이 상위 요청 예산을 잠식 | Timeout, TimeLimiter | timeout count, slow call rate, thread/connection pool 사용률 |
| 5xx보다 timeout이 먼저 증가 | 재시도와 대기 요청이 동시에 쌓임 | Retry 제한, Backoff + Jitter | retry attempts, downstream QPS, rejected count |
| 특정 외부 API 장애가 전체 API로 번짐 | 실패 경로가 계속 호출되어 자원 고갈 | Circuit Breaker | open/half-open 전이, fallback rate, error budget burn |
| 특정 테넌트나 엔드포인트가 자원을 독점 | 공정성 없이 요청을 계속 수락 | Rate Limiter, Bulkhead | 429 비율, tenant별 QPS, queue depth |
| 핵심 기능까지 느려짐 | 부가 기능이 같은 자원을 사용 | Brownout, Graceful Degradation | 핵심 API latency, degraded feature count, 사용자 영향 범위 |

예를 들어 외부 결제 API가 느려졌다면 처음부터 fallback 화면을 만들기보다, 먼저 상위 요청의 전체 대기 예산을 정하고 외부 API read timeout을 줄입니다. 그다음 멱등 요청만 제한적으로 재시도하고, 실패율이 일정 기준을 넘으면 circuit breaker로 호출 자체를 잠깐 멈춥니다. 그래도 전체 트래픽이 밀리면 결제와 무관한 추천·통계·실시간 동기화 같은 부가 기능을 brownout 후보로 낮춥니다.

반대로 대시보드에서 DB 커넥션 풀이 먼저 포화된다면 circuit breaker보다 admission control이나 bulkhead가 먼저입니다. 이미 큐가 꽉 찬 상태에서 재시도를 늘리면 회복 시간이 길어집니다. 이때는 “더 기다리기”가 아니라 “더 받지 않기”가 복구 전략입니다.

### 설계 리뷰에서 자주 놓치는 질문

아래 질문은 코드 리뷰나 장애 대비 리뷰에 그대로 붙여두기 좋습니다.

- 상위 API의 전체 deadline이 정해져 있고, 하위 호출별 timeout 합이 그 안에 들어오는가?
- 재시도 대상이 네트워크 순단, 429, 503처럼 회복 가능성이 있는 오류로 제한되어 있는가?
- POST/결제/주문/포인트 차감 같은 부작용 요청에 idempotency key가 없는데 재시도하고 있지 않은가?
- circuit breaker가 열렸을 때 사용자에게 보여줄 응답, 알람, 수동 복구 절차가 정해져 있는가?
- fallback 응답이 오래된 데이터를 반환한다면 stale 허용 시간이 명시되어 있는가?
- rate limit 초과 응답에 `Retry-After` 또는 재시도 가능한 시간 힌트가 포함되어 있는가?
- bulkhead가 기능별/테넌트별로 나뉘어 있는가, 아니면 하나의 풀을 모두가 공유하는가?
- 장애 실험에서 성공률만 보지 않고 p95/p99, saturation, retry attempts, rejected count를 같이 봤는가?

이 질문에 답하지 못하면 패턴은 적용했지만 운영 기준은 비어 있을 가능성이 큽니다. 회복탄력성은 장애를 “없애는” 기술이 아니라, 장애가 났을 때 피해 반경과 복구 시간을 줄이는 운영 계약에 가깝습니다.

### 추천 연결 글

- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/): 장애 전파의 시작점인 대기 시간과 재시도 폭증을 먼저 잡습니다.
- [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/): 실패율 기반 차단과 half-open 검증을 구현 기준으로 연결합니다.
- [Rate Limiter 설계](/learning/deep-dive/deep-dive-rate-limiter-design/): 초과 요청을 어떻게 거절하고 공정성을 지킬지 정합니다.
- [Graceful Degradation & Brownout](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/): 전체 장애 대신 기능 수준을 낮추는 판단 기준을 만듭니다.
- [Admission Control & 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/): 큐가 터지기 전에 요청을 받지 않는 방어선을 설계합니다.

## 점검 체크리스트

- 외부 호출마다 connect/read/response timeout이 명시되어 있는가?
- 재시도 대상이 멱등 요청 또는 idempotency key가 있는 요청으로 제한되어 있는가?
- circuit breaker, rate limiter, bulkhead의 메트릭이 대시보드에서 보이는가?
- fallback 응답에 stale 허용 시간, 사용자 안내, 알람 기준이 붙어 있는가?
- 장애 실험에서 p95/p99, error rate, saturation, rejected count가 함께 기록되는가?

## 미니 실습

- **서킷 브레이커 실험**: 실패율에 따라 열린/닫힌 상태 확인
- **레이트 리미터 적용**: 초당 요청 제한과 응답 코드 설계
- **헬스체크 분리**: Liveness/Readiness 차이 적용
- **Brownout 연습**: 추천/통계 같은 부가 기능을 끄고 핵심 API 지연이 줄어드는지 확인
- **재시도 폭증 실험**: 외부 API 지연을 강제로 늘리고 retry count와 downstream QPS 변화를 관찰

## 완료 기준

- 장애 전파를 막는 패턴과 사용 기준을 설명할 수 있다
- 트래픽 급증 시 어떤 보호 장치를 먼저 켤지 판단할 수 있다
- 헬스체크/타임아웃/재시도 조합을 설계할 수 있다
- 장애 중에도 반드시 살릴 핵심 기능과 낮춰도 되는 부가 기능을 구분할 수 있다
- 각 보호 장치의 성공/차단/거절/복구 메트릭을 운영 대시보드에서 확인할 수 있다
