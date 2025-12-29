---
title: "Chaos Engineering: 장애를 주입하여 시스템 회복력 검증"
date: 2025-12-13
draft: false
topic: "DevOps"
tags: ["Chaos Engineering", "Resilience", "Fault Injection", "Testing"]
categories: ["Backend Deep Dive"]
description: "Chaos Engineering으로 의도적으로 장애를 발생시켜 시스템의 회복력을 테스트하는 방법"
module: "ops-observability"
study_order: 352
quizzes:
  - question: "Chaos Engineering의 핵심 목적은?"
    options:
      - "시스템을 고장내는 것"
      - "프로덕션 환경에서 장애가 발생하기 전에 시스템의 약점을 미리 발견하고 회복력을 검증하는 것"
      - "개발자를 테스트하는 것"
      - "비용을 줄이는 것"
    answer: 1
    explanation: "Chaos Engineering은 '의도적 장애 주입'을 통해 시스템이 실제 장애 상황에서 어떻게 동작하는지 검증하고, Circuit Breaker 등이 제대로 동작하는지 확인합니다."

  - question: "Chaos Engineering 실험에서 'Steady State Hypothesis'란?"
    options:
      - "시스템이 불안정한 상태"
      - "실험 전 정상 상태를 정의하고, 장애 주입 후에도 이 상태가 유지되어야 함을 가설로 세우는 것"
      - "장애를 발생시키는 설정"
      - "롤백 계획"
    answer: 1
    explanation: "'요청 응답 시간 < 1초'같은 정상 상태를 먼저 정의하고, 장애를 주입해도 이 조건이 충족되는지 검증합니다."

  - question: "Chaos Engineering을 프로덕션에 적용할 때 권장되는 접근법은?"
    options:
      - "처음부터 100% 트래픽에 적용"
      - "개발 → 스테이징 → 프로덕션 1% → 프로덕션 100%로 점진적 확대"
      - "프로덕션에서는 적용하지 않음"
      - "비업무 시간에만 적용"
    answer: 1
    explanation: "작게 시작하여 점진적으로 확대해야 합니다. 처음에는 개발/스테이징에서 충분히 테스트하고, 프로덕션은 소수 트래픽부터 시작합니다."

  - question: "Chaos Monkey가 Netflix에서 하는 역할은?"
    options:
      - "코드 리뷰"
      - "무작위로 프로덕션 인스턴스를 종료하여 시스템의 장애 복구 능력을 상시 검증"
      - "부하 테스트"
      - "보안 점검"
    answer: 1
    explanation: "랜덤하게 인스턴스를 죽여서 '언제든 인스턴스가 죽을 수 있다'는 가정 하에 설계하도록 강제하고, 자동 복구가 제대로 동작하는지 검증합니다."

  - question: "Chaos Engineering 실험 중 이상 징후가 발견되면 해야 할 행동은?"
    options:
      - "실험을 계속 진행한다."
      - "즉시 실험을 중단하고 롤백한 후 결과를 분석하여 개선점을 도출한다."
      - "다음 날 분석한다."
      - "무시한다."
    answer: 1
    explanation: "Chaos Engineering은 시스템을 파괴하는 것이 목적이 아닙니다. 이상 징후 발견 시 즉시 중단하고 학습하며, 다음 실험 전에 개선해야 합니다."
---

## 이 글에서 얻는 것

- **Chaos Engineering**이 무엇이고 왜 필요한지 이해합니다.
- **장애 주입** 실험을 설계할 수 있습니다.
- **Chaos Monkey** 같은 도구를 사용할 수 있습니다.
- **시스템 회복력**을 검증하고 개선할 수 있습니다.

## 1) Chaos Engineering이란?

```
"시스템이 혼돈 속에서도 견딜 수 있는가?"

목적:
- 프로덕션 환경에서 장애 발생 전 미리 발견
- 시스템의 약점 파악
- 회복력 개선

원칙:
- 정상 상태 정의
- 가설 수립
- 실제 장애 주입
- 결과 분석
```

## 2) 실험 시나리오

### 1. 서비스 장애

```
실험: 특정 서비스를 10분간 다운시킴

가설:
- 다른 서비스는 정상 동작
- Circuit Breaker가 동작
- Fallback 응답 반환

결과:
✅ Circuit Breaker 동작 확인
❌ 타임아웃이 너무 김 (개선 필요)
```

### 2. 네트워크 지연

```
실험: 서비스 간 통신에 500ms 지연 주입

가설:
- 전체 응답 시간 < 2초
- 타임아웃 발생 안 함

결과:
✅ 응답 시간 1.8초로 유지
❌ 일부 타임아웃 발생 (개선 필요)
```

### 3. 리소스 부족

```
실험: CPU 80% 사용률 강제

가설:
- Auto Scaling 동작
- 성능 저하 < 20%

결과:
✅ Auto Scaling 동작 확인
❌ 스케일링까지 5분 소요 (개선 필요)
```

## 3) Chaos Toolkit 사용

```yaml
# experiment.yaml
version: 1.0.0
title: "Service A 장애 테스트"

steady-state-hypothesis:
  title: "전체 시스템 정상"
  probes:
  - name: "서비스 응답 시간 < 1초"
    type: probe
    provider:
      type: http
      url: http://api/health
      timeout: 1.0

method:
- type: action
  name: "Service A 중단"
  provider:
    type: process
    path: kubectl
    arguments: delete pod -l app=service-a

rollbacks:
- type: action
  name: "Service A 복구"
  provider:
    type: process
    path: kubectl
    arguments: rollout restart deployment service-a
```

```bash
# 실험 실행
chaos run experiment.yaml
```

## 4) 베스트 프랙티스

### ✅ 1. 작게 시작

```
1단계: 개발 환경
2단계: 스테이징 환경
3단계: 프로덕션 (트래픽 1%)
4단계: 프로덕션 (트래픽 100%)
```

### ✅ 2. 모니터링 필수

```
실험 전:
- 메트릭 베이스라인 확인
- 알림 설정 확인

실험 중:
- 실시간 모니터링
- 이상 징후 즉시 중단

실험 후:
- 결과 분석
- 개선 사항 도출
```

### ✅ 3. 점진적 확대

```
- 한 번에 하나의 장애만
- 영향 범위 제한
- 롤백 계획 수립
```

## 요약

- Chaos Engineering: 장애 주입으로 회복력 검증
- 프로덕션 전 약점 발견
- Chaos Toolkit, Chaos Monkey 등 도구 활용
- 작게 시작, 점진적 확대

## 다음 단계

- Circuit Breaker: `/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/`
- 모니터링: `/learning/deep-dive/deep-dive-prometheus-grafana/`
- 분산 시스템: `/learning/deep-dive/deep-dive-distributed-systems/`
