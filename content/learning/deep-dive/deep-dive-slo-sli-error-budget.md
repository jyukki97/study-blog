---
title: "SLO/SLI/Error Budget: 운영 의사결정을 숫자로 만드는 법"
date: 2026-02-12
draft: false
topic: "Observability"
tags: ["SLO", "SLI", "Error Budget", "Observability", "Reliability"]
categories: ["DevOps"]
description: "서비스의 안정성을 감(感)으로 판단하지 않도록, SLO/SLI/Error Budget을 설정하고 운영에 적용하는 실무 가이드"
module: "ops-observability"
study_order: 360
---

## 이 글에서 얻는 것

- SLO/SLI/Error Budget의 차이를 **명확히 구분**할 수 있습니다.
- “릴리즈 vs 안정성” 갈등을 **숫자로 해결**하는 기준을 세웁니다.
- Prometheus 기준으로 **실제 SLI 계산**을 적용해봅니다.

---

## 1) 용어 정리 (한 줄 정의)

- **SLI**: 신뢰도를 측정하는 지표 (예: 성공률, p95 latency)
- **SLO**: 목표치 (예: 성공률 99.9%)
- **Error Budget**: 허용 가능한 실패량 = 100% - SLO

---

## 2) 예시로 이해하기

### SLO 설정
- 주문 API 성공률 99.9%
- 월간 요청 1,000,000건

### Error Budget
- 실패 허용량: 0.1% → **1,000건**

> “이번 달 실패는 1,000건까지 허용. 그 이상이면 기능 릴리즈를 멈춘다.”

---

## 3) Prometheus SLI 계산 예시

### 성공률(Success Rate)
```promql
sum(rate(http_requests_total{status=~"2.."}[5m]))
/
sum(rate(http_requests_total[5m]))
```

### p95 Latency
```promql
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

---

## 4) 운영 적용 기준

- **Error Budget 소진률이 높으면** → 릴리즈 속도 제한
- **Budget 여유가 충분하면** → 릴리즈 가속 가능

### 예시 룰
- 30일 SLO 기준
- 7일 이내 50% 이상 소진 → 배포 Freeze

---

## 자주 하는 실수

- SLI를 너무 많이 설정 → 운영/측정 불가능
- “99.99%”처럼 과도한 목표 → 개발/운영 속도 저하
- 지표는 있는데 **의사결정 룰**이 없는 상태

---

## 연습

1. 서비스의 핵심 API 1개를 고르고 SLI/SLO를 정의해보세요.
2. 현재 로그/메트릭으로 SLI를 계산할 수 있는지 확인해보세요.
3. Error Budget 소진률에 따른 배포 정책을 1줄로 작성해보세요.
