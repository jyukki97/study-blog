---
title: "APM 기본 (Part 1: 개념과 도구)"
date: 2025-12-10
draft: false
topic: "DevOps"
tags: ["APM", "Monitoring", "Spring Boot Actuator", "Metrics", "Performance"]
categories: ["Backend Deep Dive"]
description: "APM 핵심 개념과 Spring Boot Actuator로 애플리케이션 성능 모니터링 구현"
module: "ops-observability"
study_order: 342
quizzes:
  - question: "APM(Application Performance Monitoring)의 핵심 'Golden Signals' 4가지는?"
    options:
      - "CPU, 메모리, 디스크, 네트워크"
      - "Latency(지연시간), Traffic(트래픽), Errors(오류율), Saturation(포화도)"
      - "GET, POST, PUT, DELETE"
      - "Create, Read, Update, Delete"
    answer: 1
    explanation: "Google SRE가 정의한 Golden Signals는 서비스 건강 상태를 판단하는 핵심 지표입니다. 이 4가지만 모니터링해도 대부분의 문제를 조기 발견할 수 있습니다."

  - question: "응답 시간 지표에서 P95가 P50보다 더 중요한 이유는?"
    options:
      - "P95가 더 작은 값이기 때문"
      - "P95는 95% 사용자가 경험하는 최대 응답 시간을 보여주어, 일부 사용자의 느린 경험을 파악할 수 있기 때문"
      - "P50은 측정이 어렵기 때문"
      - "모든 시스템에서 P95가 더 낮기 때문"
    answer: 1
    explanation: "평균(또는 P50)은 극단적으로 느린 응답을 숨깁니다. P95=1초면 20명 중 1명은 1초 이상 기다린다는 의미입니다. 사용자 경험을 정확히 파악하려면 P95/P99가 중요합니다."

  - question: "Spring Boot Actuator에서 `/actuator/prometheus` 엔드포인트의 역할은?"
    options:
      - "애플리케이션을 재시작한다."
      - "Prometheus가 스크랩할 수 있는 형식으로 메트릭을 노출한다."
      - "로그를 출력한다."
      - "데이터베이스를 백업한다."
    answer: 1
    explanation: "Prometheus는 Pull 방식으로 메트릭을 수집합니다. `/actuator/prometheus`는 애플리케이션의 메트릭을 Prometheus 형식(Counter, Gauge 등)으로 제공합니다."

  - question: "Micrometer에서 Counter, Gauge, Timer의 차이점으로 올바른 것은?"
    options:
      - "모두 동일한 기능을 한다."
      - "Counter는 누적 횟수(증가만), Gauge는 현재 값(증감), Timer는 실행 시간을 측정한다."
      - "Counter만 Prometheus에서 사용 가능하다."
      - "Timer는 문자열을 저장한다."
    answer: 1
    explanation: "Counter는 주문 수, 로그인 횟수 같은 누적값. Gauge는 현재 활성 유저, 커넥션 풀 크기 같은 순간 값. Timer는 API 응답 시간 같은 duration을 측정합니다."

  - question: "운영 환경에서 모니터링 알림(Alerting) 설정 시 '알림 피로(Alert Fatigue)'를 방지하려면?"
    options:
      - "모든 메트릭에 알림을 설정한다."
      - "중요한 지표만 알림을 설정하고, 임계값을 적절히 조정하여 실제 문제만 알림을 받는다."
      - "알림을 끈다."
      - "알림을 이메일로만 받는다."
    answer: 1
    explanation: "사소한 경고까지 모두 알림을 보내면 담당자가 무시하게 됩니다. 오류율 > 1%, 응답시간 > 1초 같이 실제 조치가 필요한 상황만 알림을 설정해야 합니다."
---

## 이 글에서 얻는 것

- **APM**(Application Performance Monitoring)이 무엇이고, 왜 필요한지 이해합니다.
- **핵심 메트릭**(응답 시간, 처리량, 오류율)을 모니터링할 수 있습니다.
- **Spring Boot Actuator**로 헬스 체크와 메트릭을 노출합니다.
- **분산 추적**의 기본 개념을 이해합니다.

## 0) APM은 "운영 중인 애플리케이션의 건강 상태"를 보여준다

### APM이란?

```
APM (Application Performance Monitoring)
= 애플리케이션 성능을 실시간으로 모니터링

목적:
- 성능 병목 발견
- 장애 조기 감지
- 사용자 경험 최적화
- 리소스 사용량 추적
```

### 로깅 vs 모니터링

```
로깅:
- "무슨 일이 일어났는가?" (이벤트)
- 문제 원인 파악
- 예: "User alice logged in"

모니터링:
- "시스템이 얼마나 건강한가?" (지표)
- 문제 조기 감지
- 예: "평균 응답 시간: 200ms, CPU 사용률: 60%"

둘 다 필요!
```

## 1) APM 핵심 메트릭

### 1-1) Golden Signals (핵심 지표 4가지)

```
1. Latency (지연시간)
   - 요청 처리 시간
   - 예: 평균 응답 시간 200ms

2. Traffic (트래픽)
   - 요청 수
   - 예: 초당 100 요청 (100 RPS)

3. Errors (오류)
   - 실패한 요청 비율
   - 예: 오류율 0.5%

4. Saturation (포화도)
   - 리소스 사용률
   - 예: CPU 70%, 메모리 80%
```

### 1-2) 주요 메트릭 상세

**응답 시간 (Response Time)**
```
평균 응답 시간: 200ms
P50 (중앙값): 150ms
P95 (95 백분위수): 500ms  ← 중요!
P99: 1000ms

P95가 높다 = 일부 사용자가 느린 경험
```

**처리량 (Throughput)**
```
RPS (Requests Per Second): 초당 요청 수
TPM (Transactions Per Minute): 분당 트랜잭션 수

예:
- 평균 RPS: 100
- 피크 RPS: 500 (트래픽 급증 시)
```

**오류율 (Error Rate)**
```
오류율 = (실패한 요청 / 전체 요청) × 100

예:
- 전체 요청: 10,000
- 실패: 50
- 오류율: 0.5%

목표: 오류율 < 0.1% (SLA에 따라 다름)
```

**리소스 사용률**
```
CPU 사용률: 70%
메모리 사용률: 80%
디스크 I/O: 60%
네트워크 대역폭: 50%

경고: > 80%
위험: > 90%
```


---

👉 **[다음 편: APM 기본 (Part 2: Actuator, Prometheus 연동)](/learning/deep-dive/deep-dive-apm-basics-part2/)**
