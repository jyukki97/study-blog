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
- "릴리즈 vs 안정성" 갈등을 **숫자로 해결**하는 기준을 세웁니다.
- Prometheus 기준으로 **실제 SLI 계산**을 적용해봅니다.
- Error Budget 기반 **배포 정책 자동화** 기초를 이해합니다.

---

## 1) 용어 정리 (한 줄 정의)

| 용어 | 정의 | 예시 |
|------|------|------|
| **SLI** (Service Level Indicator) | 신뢰도를 측정하는 **지표** | 성공률, p95 latency, 가용성 |
| **SLO** (Service Level Objective) | SLI에 대한 **목표치** | 성공률 ≥ 99.9% |
| **SLA** (Service Level Agreement) | SLO를 기반으로 한 **계약** | SLO 미달 시 크레딧 환불 |
| **Error Budget** | 허용 가능한 실패량 = 100% − SLO | 0.1% = 월 1,000건 실패 허용 |

> **핵심 구분:** SLI는 "무엇을 측정하나", SLO는 "얼마나 좋아야 하나", SLA는 "못 지키면 어떻게 되나", Error Budget은 "얼마나 실패해도 되나"입니다.

---

## 2) 왜 Error Budget이 필요한가?

개발팀과 운영팀 사이에는 항상 긴장이 있습니다:

- **개발팀:** 빨리 배포하고 싶다 → 장애 가능성 ↑
- **운영팀:** 안정적으로 유지하고 싶다 → 배포 속도 ↓

Error Budget은 이 갈등을 **숫자로 해결**합니다:

```
"이번 달 Error Budget이 70% 남아있으니 신기능 배포 OK."
"Budget을 이미 80% 소진했으니 이번 주는 안정화에 집중."
```

### Error Budget 없이 운영하면?

- "이번 장애 심각했으니 배포 중단" → 감(感)에 의존
- "이번 달 장애 많았나?" → 기준 없이 체감에 의존
- "새 기능 올려도 되나?" → 매번 회의에서 논쟁

---

## 3) SLI 선정 기준: 무엇을 측정할 것인가

### 좋은 SLI의 조건

1. **사용자 경험과 직결:** 내부 지표(CPU 사용률)보다 사용자 체감 지표(응답 시간) 우선
2. **측정 가능:** 실제 메트릭으로 계산할 수 있어야 함
3. **비율로 표현 가능:** "좋은 이벤트 / 전체 이벤트" 형태

### 서비스 유형별 SLI 권장 기준

| 서비스 유형 | 권장 SLI | 측정 방법 |
|------------|---------|----------|
| **API 서버** | 요청 성공률, p95/p99 latency | HTTP 상태 코드, 히스토그램 |
| **데이터 파이프라인** | 처리 완료율, 처리 지연 시간 | 작업 상태 메트릭 |
| **스토리지** | 읽기/쓰기 성공률, 내구성 | 에러 카운터 |
| **배치 작업** | 정시 완료율, 실패율 | 작업 스케줄러 로그 |

### 실무 팁: SLI는 3개 이내

SLI를 너무 많이 설정하면 운영이 불가능합니다. 핵심 API 기준으로 **가용성(Availability)**, **지연(Latency)**, **정확성(Correctness)** 중 2~3개만 선정하세요.

---

## 4) SLO 설정: 목표치를 어떻게 정할까

### 단계별 접근법

**Step 1: 현재 성능 측정 (Baseline)**
```promql
# 최근 30일 성공률
sum(rate(http_requests_total{status=~"2.."}[30d]))
/
sum(rate(http_requests_total[30d]))
# 결과: 0.9985 (99.85%)
```

**Step 2: Baseline보다 약간 높게 SLO 설정**
- 현재 99.85% → SLO 99.9%로 설정
- 처음부터 99.99%로 설정하면 개발 속도 급감

**Step 3: 이해관계자 합의**
- 사용자 기대치, 비즈니스 중요도, 인프라 비용 고려
- 문서화하여 팀 간 공유

### 9의 개수와 실제 의미

| SLO | 월간 허용 다운타임 | 연간 허용 다운타임 | 난이도 |
|-----|------------------|------------------|--------|
| 99% | 7시간 18분 | 3일 15시간 | 보통 |
| 99.9% | 43분 48초 | 8시간 46분 | 높음 |
| 99.95% | 21분 54초 | 4시간 23분 | 매우 높음 |
| 99.99% | 4분 23초 | 52분 36초 | 극한 |

> **주의:** 99.9% → 99.99%로 올리는 것은 10배 어렵고, 비용도 10배 이상 증가합니다. 모든 서비스에 99.99%를 요구하지 마세요.

---

## 5) Error Budget 계산과 운영

### 기본 공식

```
Error Budget = 1 - SLO
허용 실패 건수 = 전체 요청 수 × Error Budget
```

### 예시: 주문 API

- **SLO:** 99.9%
- **월간 총 요청:** 1,000,000건
- **Error Budget:** 0.1% = **1,000건 실패 허용**

### Error Budget 소진률 계산 (Prometheus)

```promql
# 현재 소진률 (30일 Rolling Window)
1 - (
  sum(increase(http_requests_total{status=~"2.."}[30d]))
  /
  sum(increase(http_requests_total[30d]))
) / (1 - 0.999)
```

### Burn Rate Alert (Google SRE 방식)

단순 소진률보다 **소진 속도(Burn Rate)**가 더 유용합니다:

```promql
# 1시간 Burn Rate
(
  1 - sum(rate(http_requests_total{status=~"2.."}[1h]))
  / sum(rate(http_requests_total[1h]))
) / (1 - 0.999)
```

| Burn Rate | 의미 | 예상 Budget 소진 시점 |
|-----------|------|---------------------|
| 1x | 정상 페이스 | 30일 후 |
| 2x | 2배 빠른 소진 | 15일 후 |
| 10x | 10배 → 긴급 | 3일 후 |
| 14.4x | 매우 위험 | 약 2일 후 |

---

## 6) Error Budget 기반 배포 정책

### 정책 예시 (실무 적용)

```yaml
# error-budget-policy.yaml (팀 내 공유 문서)
policies:
  - name: "정상"
    condition: "소진률 < 50%"
    actions:
      - "일반 배포 진행"
      - "실험적 변경 허용"
  
  - name: "주의"
    condition: "소진률 50% ~ 75%"
    actions:
      - "배포 시 동료 리뷰 필수"
      - "Canary 배포만 허용"
      - "실험적 변경 보류"
  
  - name: "경고"
    condition: "소진률 75% ~ 90%"
    actions:
      - "신기능 배포 중단"
      - "안정화/버그픽스만 허용"
      - "SRE 팀 주간 리뷰"
  
  - name: "위험"
    condition: "소진률 > 90%"
    actions:
      - "모든 배포 중단 (핫픽스 제외)"
      - "장애 원인 분석 우선"
      - "경영진 보고"
```

### Grafana 대시보드 구성 권장 패널

1. **SLI 현재값** (게이지): 현재 성공률
2. **Error Budget 잔량** (게이지): 남은 Budget %
3. **Burn Rate** (타임시리즈): 1h/6h/24h 소진 속도
4. **소진 추세** (타임시리즈): 30일 Rolling 트렌드

---

## 7) 자주 하는 실수와 대응

### ❌ 실수 1: SLI를 너무 많이 설정

- 10개 이상의 SLI → 모니터링 불가능, 알림 피로
- **대응:** 핵심 API 1~2개에 SLI 2~3개로 시작

### ❌ 실수 2: 처음부터 99.99% 목표

- 비현실적 목표 → 영원히 배포 불가
- **대응:** Baseline 측정 후 현실적 목표 설정 (99% → 99.9% 순차)

### ❌ 실수 3: 지표는 있는데 의사결정 룰이 없는 상태

- 대시보드만 예쁘고 "그래서 뭐?" 상태
- **대응:** Error Budget 정책 문서 작성 + 팀 합의

### ❌ 실수 4: SLO를 한번 정하고 방치

- 트래픽/서비스 변화에 SLO가 맞지 않게 됨
- **대응:** 분기 1회 SLO 리뷰, 필요 시 조정

---

## 8) 도입 체크리스트

- [ ] 핵심 서비스의 **사용자 경험 기반 SLI** 2~3개 선정
- [ ] 최근 30일 Baseline 데이터 수집
- [ ] SLO 목표치 설정 (Baseline + α)
- [ ] Error Budget 계산 공식을 Prometheus/Grafana에 등록
- [ ] Burn Rate Alert 설정 (1h, 6h, 24h 윈도우)
- [ ] Error Budget 소진률별 **배포 정책** 문서화
- [ ] 팀/이해관계자 합의 및 공유
- [ ] 분기별 SLO 리뷰 일정 등록

---

## 연습 문제

1. 자신이 운영하는 (또는 개발 중인) 서비스에서 **SLI 2개**를 선정하고, 각각의 SLO 목표치를 설정해보세요.
2. Prometheus에서 SLI 계산 쿼리를 작성하고, **Burn Rate 10x**일 때 Budget이 며칠 만에 소진되는지 계산해보세요.
3. Error Budget 소진률 75% 상황에서 팀이 취해야 할 행동 3가지를 적어보세요.
4. "우리 서비스는 99.99% SLO가 필요하다"라고 주장하는 동료에게 **비용/효과 관점**에서 반론을 작성해보세요.

---

## 더 읽기

- [Google SRE Book - Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)
- [Google SRE Workbook - Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [Prometheus 기반 SLO 모니터링](/learning/deep-dive/deep-dive-prometheus-grafana/)
- [관측성 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)
- [APM 기초](/learning/deep-dive/deep-dive-apm-basics/)
