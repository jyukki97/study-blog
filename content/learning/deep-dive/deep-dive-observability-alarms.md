---
title: "알람 전략: 에러율/레이턴시/자원지표 설계"
date: 2025-12-16
draft: false
topic: "Observability"
tags: ["Alerting", "SLO", "Prometheus", "On-call", "Runbook"]
categories: ["DevOps"]
description: "알람 설계 원칙, PromQL 규칙, Alertmanager 라우팅, SLO 번레이트, Runbook 템플릿까지 실무 가이드"
module: "ops-observability"
study_order: 360
---

## 이 글에서 얻는 것

- "알람이 많으면 안전하다"가 아니라, **액션 가능한 알람을 소수로 유지**하는 이유를 이해합니다.
- 레이턴시/에러율/트래픽/포화(Golden Signals)를 기준으로 "무엇을 알람으로 만들지" 선택할 수 있습니다.
- SLO/에러 버짓 기반 알람(번레이트)과 단순 임계치 알람을 구분해서 운영할 수 있습니다.
- **PromQL로 실제 알람 규칙을 작성**하고, Alertmanager 라우팅/억제/무음을 설정할 수 있습니다.
- Runbook/온콜 라우팅/무음(silence) 같은 운영 루프까지 포함해 알람 체계를 설계할 수 있습니다.

---

## 0) 알람의 목표는 "깨우기"가 아니라 "복구"다

좋은 알람은 한 문장으로 정의됩니다.

> 지금 당장 사람이 개입하면 결과가 좋아진다.

반대로, 아래는 나쁜 알람입니다.

- 너무 자주 울린다(노이즈)
- 울려도 뭘 해야 할지 모른다(액션 불가)
- 이미 늦었다(탐지 지연)

**알람 피로(alert fatigue)**는 실제 장애를 놓치게 만드는 가장 큰 원인입니다. Google SRE 보고에 따르면, 하루 알람 10건을 넘기면 온콜 엔지니어의 응답 품질이 급격히 떨어집니다.

## 1) 알람 vs 대시보드: 역할이 다르다

| 구분 | 대시보드 | 알람 |
|------|----------|------|
| 목적 | 상황 이해(분석) | 즉시 대응(행동 트리거) |
| 수신 | 필요할 때 열어봄 | 푸시(슬랙/PagerDuty/전화) |
| 지표 수 | 수십~수백 개 | 서비스당 3~7개 |
| 설계 기준 | "무슨 일이 일어나고 있나?" | "지금 사람이 개입해야 하나?" |

대시보드에 있는 모든 지표를 알람으로 만들면 온콜은 곧 마비됩니다.

## 2) 무엇을 알람으로 만들까: Golden Signals로 시작

서비스 관점에서 최소한 아래 4개 축을 봅니다.

| Signal | 지표 예시 | 알람 기준(감각) |
|--------|----------|----------------|
| **Latency** | p95/p99 응답시간 | p99 > SLO 목표의 2배, 5분 지속 |
| **Errors** | 5xx 비율, 비즈니스 실패율 | 에러율 > 1%, 또는 번레이트 초과 |
| **Traffic** | RPS, 처리량 | 급증(정상 대비 3배) 또는 급감(50% 이하) |
| **Saturation** | CPU/메모리/커넥션풀/큐 | 사용률 > 85%, 5분 지속 |

메시징/배치가 있다면:

- **Kafka consumer lag** — 컨슈머 처리가 뒤처지는 정도
- **DLQ(Dead Letter Queue) 유입** — 실패 메시지 누적

도 핵심 알람 후보입니다.

## 3) 증상 알람(Symptom) vs 원인 알람(Cause)

알람은 크게 두 종류가 있습니다.

### 3-1) 증상 알람(서비스가 깨졌다) — 1순위

```
에러율 급증 → 사용자가 실제로 아프다
p99 레이턴시 급증 → 사용자 체감이 나빠졌다
SLO 위반(번레이트 초과) → 이 속도면 월말까지 에러 버짓을 다 쓴다
```

이 알람이 항상 1순위입니다. "사용자가 아픈가?"를 가장 먼저 알려주기 때문입니다.

### 3-2) 원인 알람(곧 깨질 것 같다) — 2순위

```
DB 커넥션 풀 고갈 → 10분 안에 요청 실패 시작될 수 있다
메모리 누수(점진 상승) → OOM까지 몇 시간 남았다
큐 backlog 증가 → 처리 지연이 사용자에게 곧 전달된다
디스크 사용률 상승 → 며칠 안에 write 실패 가능
```

원인 알람은 유용하지만, 너무 많아지면 노이즈가 됩니다.
**"증상 알람이 울리기 전에 고칠 수 있는 것"만 선별**하는 편이 좋습니다.

### 판단 기준 체크리스트

알람을 추가할 때 아래 3가지 중 하나라도 No면 재고합니다:

- [ ] 이 알람이 울렸을 때 **즉시 할 수 있는 액션**이 있는가?
- [ ] 이 알람 없이 **증상 알람으로 대체** 가능하지 않은가?
- [ ] 주 1회 이상 의미 있는 트리거가 있는가(아니면 죽은 알람)?

## 4) SLO 기반 알람: 번레이트(burn rate)로 노이즈를 줄이기

단순 임계치(`p99 > 1s`)는 쉽지만, 트래픽 변동/노이즈에 약합니다.
SLO 기반 알람은 "에러 버짓을 얼마나 빨리 태우고 있는지"로 판단합니다.

### 4-1) 번레이트 개념

```
에러 버짓 = 1 - SLO = 0.1% (SLO 99.9%)
번레이트 = 실제 에러율 / 에러 버짓

번레이트 1 = 정확히 예산대로 소비 (30일 뒤 0%)
번레이트 14.4 = 1시간이면 에러 버짓 2%를 태움 → 즉시 대응 필요
번레이트 6 = 6시간이면 에러 버짓 5%를 태움 → 티켓/조사 필요
```

### 4-2) 멀티 윈도우 번레이트 알람 (Google SRE 권장)

단일 윈도우만 보면 스파이크에 과민하거나, 느린 악화를 놓칩니다.
**짧은 창 + 긴 창을 함께 보는 멀티 윈도우** 방식이 실무 표준입니다.

| 심각도 | 긴 창 | 짧은 창 | 번레이트 | 의미 |
|--------|-------|---------|---------|------|
| **Page** (즉시) | 1시간 | 5분 | 14.4× | 이 속도면 2% 버짓을 1시간에 소진 |
| **Page** (즉시) | 6시간 | 30분 | 6× | 이 속도면 5% 버짓을 6시간에 소진 |
| **Ticket** (조사) | 3일 | 6시간 | 1× | 예산대로 소비 중이지만 지속되면 위험 |

### 4-3) PromQL로 번레이트 알람 작성

SLO 99.9% 가용성 (HTTP 요청 기준):

```yaml
# prometheus/rules/slo-burn-rate.yml
groups:
  - name: slo-availability-burn-rate
    interval: 30s
    rules:
      # -- SLI 기록 규칙 (재사용) --
      - record: sli:http_requests:error_rate_5m
        expr: |
          1 - (
            sum(rate(http_requests_total{status!~"5.."}[5m]))
            /
            sum(rate(http_requests_total[5m]))
          )

      - record: sli:http_requests:error_rate_30m
        expr: |
          1 - (
            sum(rate(http_requests_total{status!~"5.."}[30m]))
            /
            sum(rate(http_requests_total[30m]))
          )

      - record: sli:http_requests:error_rate_1h
        expr: |
          1 - (
            sum(rate(http_requests_total{status!~"5.."}[1h]))
            /
            sum(rate(http_requests_total[1h]))
          )

      - record: sli:http_requests:error_rate_6h
        expr: |
          1 - (
            sum(rate(http_requests_total{status!~"5.."}[6h]))
            /
            sum(rate(http_requests_total[6h]))
          )

      # -- 알람 규칙 --
      # Page: 1시간 창에서 번레이트 14.4× 초과 + 5분 창에서도 확인
      - alert: SLOBurnRateCritical
        expr: |
          sli:http_requests:error_rate_1h > (14.4 * 0.001)
          and
          sli:http_requests:error_rate_5m > (14.4 * 0.001)
        for: 2m
        labels:
          severity: page
          slo: availability
        annotations:
          summary: "SLO 번레이트 Critical — 1시간 내 에러 버짓 2% 소진 속도"
          description: |
            1h 에러율: {{ $value | humanizePercentage }}
            SLO: 99.9%, 번레이트: 14.4×
          runbook_url: "https://wiki.internal/runbooks/slo-burn-rate-critical"

      # Page: 6시간 창에서 번레이트 6× 초과
      - alert: SLOBurnRateHigh
        expr: |
          sli:http_requests:error_rate_6h > (6 * 0.001)
          and
          sli:http_requests:error_rate_30m > (6 * 0.001)
        for: 5m
        labels:
          severity: page
          slo: availability
        annotations:
          summary: "SLO 번레이트 High — 6시간 내 에러 버짓 5% 소진 속도"
          runbook_url: "https://wiki.internal/runbooks/slo-burn-rate-high"

      # Ticket: 3일 창에서 번레이트 1× 지속
      - alert: SLOBurnRateWarning
        expr: |
          sli:http_requests:error_rate_6h > (1 * 0.001)
        for: 30m
        labels:
          severity: ticket
          slo: availability
        annotations:
          summary: "SLO 번레이트 Warning — 에러 버짓 소비가 예산 속도 이상"
          runbook_url: "https://wiki.internal/runbooks/slo-burn-rate-warning"
```

**핵심 포인트:**
- `record` 규칙으로 SLI를 미리 계산해두면 알람 규칙이 깔끔해집니다.
- `for` 절로 일시적 스파이크 방어합니다.
- `0.001`은 에러 버짓(= 1 - 0.999)입니다.

## 5) Golden Signal 알람: 실무 PromQL 예시

### 5-1) 에러율 알람

```yaml
- alert: HighErrorRate
  expr: |
    sum(rate(http_requests_total{status=~"5.."}[5m]))
    /
    sum(rate(http_requests_total[5m]))
    > 0.01
  for: 5m
  labels:
    severity: page
  annotations:
    summary: "5xx 에러율 {{ $value | humanizePercentage }} (> 1%)"
    dashboard: "https://grafana.internal/d/http-overview"
```

### 5-2) 레이턴시 알람

```yaml
- alert: HighP99Latency
  expr: |
    histogram_quantile(0.99,
      sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
    ) > 2.0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "p99 레이턴시 {{ $value }}s (> 2s)"
    description: "최근 5분간 p99 응답시간이 2초를 넘겼습니다."
```

### 5-3) 트래픽 급변(급증/급감)

```yaml
# 트래픽 급감: 정상 대비 50% 이하
- alert: TrafficDropSevere
  expr: |
    sum(rate(http_requests_total[5m]))
    < 0.5 * sum(rate(http_requests_total[1h] offset 1d))
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "트래픽 급감 — 전일 동시간 대비 50% 이하"

# 트래픽 급증: 정상 대비 3배 이상
- alert: TrafficSpikeSevere
  expr: |
    sum(rate(http_requests_total[5m]))
    > 3 * sum(rate(http_requests_total[1h] offset 1d))
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "트래픽 급증 — 전일 동시간 대비 300% 이상"
```

### 5-4) 포화도(Saturation) 알람

```yaml
# DB 커넥션 풀 고갈 임박
- alert: DBConnectionPoolExhaustion
  expr: |
    hikaricp_connections_active
    /
    hikaricp_connections_max
    > 0.85
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "HikariCP 커넥션 풀 사용률 {{ $value | humanizePercentage }}"

# JVM 메모리 — Old Gen 지속 상승(누수 의심)
- alert: JVMOldGenHighUsage
  expr: |
    jvm_memory_used_bytes{area="heap", id=~".*Old.*|.*Tenured.*"}
    /
    jvm_memory_max_bytes{area="heap", id=~".*Old.*|.*Tenured.*"}
    > 0.85
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "JVM Old Gen 힙 사용률 85% 초과, 15분 지속 — 메모리 누수 의심"

# 디스크 잔여 용량 예측
- alert: DiskSpaceRunningOut
  expr: |
    predict_linear(
      node_filesystem_avail_bytes{mountpoint="/"}[6h], 24*3600
    ) < 0
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "디스크 여유 공간이 24시간 내 소진 예상"
```

### 5-5) Kafka Consumer Lag

```yaml
- alert: KafkaConsumerLagHigh
  expr: |
    kafka_consumer_group_lag_sum > 10000
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Kafka consumer lag {{ $value }} (> 10,000)"
    description: "consumer group이 10분 이상 10,000건 이상 뒤처져 있습니다."
```

## 6) Alertmanager 설정: 라우팅/그루핑/억제/무음

알람 규칙을 잘 만들어도 **전달 경로**가 엉망이면 소용없습니다.

### 6-1) 기본 라우팅 설정

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/xxx/yyy/zzz'

route:
  receiver: 'default-slack'
  group_by: ['alertname', 'service']
  group_wait: 30s        # 첫 알람 후 그룹핑 대기
  group_interval: 5m     # 같은 그룹 재알림 간격
  repeat_interval: 4h    # 해소 안 될 때 반복 간격

  routes:
    # Page 심각도 → PagerDuty (즉시 호출)
    - match:
        severity: page
      receiver: 'pagerduty-oncall'
      group_wait: 10s
      repeat_interval: 30m

    # Ticket 심각도 → Jira + Slack
    - match:
        severity: ticket
      receiver: 'jira-slack'
      repeat_interval: 12h

    # Warning → Slack만
    - match:
        severity: warning
      receiver: 'default-slack'
      repeat_interval: 4h

receivers:
  - name: 'default-slack'
    slack_configs:
      - channel: '#alerts-warning'
        send_resolved: true
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'

  - name: 'pagerduty-oncall'
    pagerduty_configs:
      - service_key: '<PD_SERVICE_KEY>'
        severity: 'critical'

  - name: 'jira-slack'
    slack_configs:
      - channel: '#alerts-tickets'
        send_resolved: true
```

### 6-2) 억제(Inhibition) 규칙

상위 알람이 울리면 하위 알람을 자동 억제해서 폭풍을 줄입니다:

```yaml
inhibit_rules:
  # Page가 울리면 같은 서비스의 Warning은 억제
  - source_match:
      severity: 'page'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'service']

  # 인프라 다운이면 해당 인프라 위 서비스 알람 억제
  - source_match:
      alertname: 'NodeDown'
    target_match_re:
      alertname: '.+'
    equal: ['instance']
```

### 6-3) 무음(Silence) — 배포/점검 시 노이즈 차단

배포 시 일시적으로 에러율이 오르는 것은 정상입니다. 배포 파이프라인에서 자동으로 silence를 생성하면 노이즈를 줄일 수 있습니다:

```bash
# CI/CD 파이프라인에서 배포 시작 시 silence 생성
amtool silence add \
  --alertmanager.url=http://alertmanager:9093 \
  --duration=30m \
  --comment="Deployment: ${SERVICE_NAME} ${VERSION}" \
  service="${SERVICE_NAME}" severity="warning"
```

## 7) 임계치 알람을 쓸 때의 최소 원칙

번레이트가 모든 상황에 맞는 것은 아닙니다. 자원 지표나 특수 도메인에서는 임계치 알람이 더 직관적입니다.

| 원칙 | 설명 | 예시 |
|------|------|------|
| **관찰 기간 명시** | 스파이크 노이즈 방지 | `for: 5m` (1분이 아닌 5분) |
| **절대값 + 변화율** | 한쪽만 보면 놓침 | 메모리 80% AND 30분간 10% 상승 |
| **컨텍스트 포함** | 알람만 봐도 판단 가능하게 | 현재 값, 임계치, 대시보드 링크 |
| **임계치 근거 기록** | 왜 이 숫자인지 | "p99 SLO 2s → 알람 4s(2배)" |

## 8) Runbook: 알람이 '행동'으로 이어지게 만든다

### 8-1) Runbook 템플릿

```markdown
# Runbook: [알람 이름]

## 의미
- 이 알람은 [어떤 증상/위험]을 나타냅니다.
- 영향 범위: [사용자 영향 / 내부 영향]

## 1차 확인 (5분 이내)
1. [ ] 최근 배포가 있었는가? → [배포 이력 링크]
2. [ ] 의존성(DB/외부 API)은 정상인가? → [의존성 대시보드 링크]
3. [ ] 에러 로그에 새로운 패턴이 있는가? → [Kibana/Loki 검색 링크]

## 응급 조치 (10분 이내)
- 배포가 원인이면: `kubectl rollout undo deployment/xxx`
- 트래픽 급증이면: HPA min replica 상향 또는 기능 플래그 off
- DB 커넥션 고갈이면: 커넥션 풀 사이즈 임시 상향

## 근본 원인 분석
- 트레이스: [Jaeger/Tempo 링크]
- 메트릭: [Grafana 대시보드 링크]
- 로그: [구조화 로그 검색 쿼리]

## 에스컬레이션
- 15분 내 해결 안 되면: [팀 리드/SRE 담당 연락처]
- 30분 내 해결 안 되면: [인시던트 선포 절차]
```

### 8-2) 알람 ↔ Runbook 연결

알람 annotation에 `runbook_url`을 반드시 포함합니다:

```yaml
annotations:
  runbook_url: "https://wiki.internal/runbooks/{{ $labels.alertname }}"
```

Slack/PagerDuty 알림에 이 URL이 자동으로 포함되면, 온콜 엔지니어가 "이게 뭐지?"라고 헤매는 시간을 줄일 수 있습니다.

## 9) 온콜 운영: 라우팅/에스컬레이션/교대

### 9-1) 심각도 분류 기준

| 심각도 | 응답 목표 | 전달 방식 | 예시 |
|--------|----------|----------|------|
| **Page** | 5분 내 확인 | PagerDuty/전화 | SLO 번레이트 초과, 서비스 다운 |
| **Ticket** | 4시간 내 조사 | Jira + Slack | 에러 버짓 소비 속도 주의 |
| **Warning** | 다음 근무일 | Slack | 디스크 여유 감소 추세 |
| **Info** | 기록만 | 대시보드 | 배포 완료, 스케일링 이벤트 |

### 9-2) 에스컬레이션 체인

```
0~5분:  1차 온콜 → PagerDuty 자동 호출
5~15분: 응답 없으면 → 2차 온콜 자동 에스컬레이션
15~30분: 해결 안 되면 → 팀 리드 + SRE 합류
30분+:  인시던트 선포 → 전사 커뮤니케이션 채널 활성화
```

### 9-3) 교대 시 인수인계

온콜 교대 시 최소 인수인계 항목:

- 현재 열린 알람 목록 + 상태
- 진행 중인 인시던트 + 진행 상황
- 예정된 배포/점검 + silence 설정 여부
- 최근 1주 노이즈 알람 + 조정 필요 사항

## 10) 알람 테스트/위생(운영 루프)

알람은 코드와 마찬가지로 **지속적 관리**가 필요합니다.

### 10-1) 알람 품질 지표

| 지표 | 건강한 범위 | 나쁜 신호 |
|------|-----------|----------|
| 일일 Page 알람 수 | 0~2건 | 5건 이상 |
| 알람 → 액션 전환율 | > 80% | 절반 이상 무시 |
| MTTA (확인까지 시간) | < 5분 | 15분 이상 |
| MTTR (복구까지 시간) | < 30분 | 2시간 이상 |
| 노이즈 비율 (false positive) | < 10% | 30% 이상 |

### 10-2) 월간 알람 리뷰 체크리스트

```markdown
## 월간 알람 위생 리뷰

- [ ] 지난 달 울린 알람 전수 목록 확인
- [ ] 액션 없이 해소된 알람 → 임계치 조정 또는 삭제 후보
- [ ] 한 번도 안 울린 알람 → 임계치가 너무 높거나 죽은 알람
- [ ] 중복 알람(같은 증상을 다른 규칙으로) → 통합
- [ ] Runbook이 없는 알람 → Runbook 작성 또는 알람 삭제
- [ ] 새로 추가한 알람 → 1주일 노이즈 리뷰 후 심각도 조정
```

### 10-3) 장애 회고 시 알람 점검 항목

장애 후에는 반드시 아래를 확인합니다:

- 이 장애를 **알람이 먼저 감지**했는가, 사용자가 먼저 신고했는가?
- 알람이 울렸다면, 울린 시점과 실제 영향 시작 시점의 차이는?
- Runbook대로 대응했는가, 아니면 현장에서 즉흥 대응했는가?
- 더 빨리 감지할 수 있었던 신호가 있었는가?

## 11) 안티패턴 6가지와 대응

| # | 안티패턴 | 증상 | 대응 |
|---|---------|------|------|
| 1 | 모든 지표에 알람 | 하루 50건 이상 알림 | Golden Signals만 남기고 나머지 대시보드로 |
| 2 | `for: 0s` (즉시 트리거) | 스파이크에 매번 울림 | 최소 `for: 2m~5m` 적용 |
| 3 | 고정 임계치만 사용 | 트래픽 패턴 변화에 대응 못 함 | 번레이트 또는 이동평균 대비 비율 사용 |
| 4 | Runbook 없는 알람 | 온콜이 "이게 뭐지?" | Runbook URL 필수, 없으면 알람 삭제 |
| 5 | 억제 규칙 없음 | 1개 장애에 10개 알람 | inhibit_rules 설정 |
| 6 | 알람 리뷰 안 함 | 죽은 알람 / 노이즈 누적 | 월 1회 위생 리뷰 |

## 12) 실무 적용 순서 (부트스트랩 가이드)

### Day 1: 최소 알람 3개

1. HTTP 5xx 에러율 > 1% (5분 지속) → Page
2. p99 레이턴시 > SLO의 2배 (5분 지속) → Warning
3. 헬스체크 실패 → Page

### Week 1: SLO 기반 전환

4. 번레이트 알람(Critical + High + Warning) 추가
5. 자원 포화 알람(커넥션 풀, 힙) 추가
6. Alertmanager 라우팅 + 억제 규칙 설정

### Month 1: 운영 루프

7. Runbook 전체 작성
8. 첫 알람 리뷰(노이즈/임계치 조정)
9. 인시던트 회고에 알람 점검 항목 포함

---

## 연습(추천)

1. 서비스에서 Page 알람 3개만 선정해보기(에러율, p99, 의존성 실패) + 각각 Runbook 10줄 작성
2. 배포 시간에만 자주 울리는 알람을 찾아, `for` 기간/조건을 조정해 노이즈를 줄여보기
3. "증상 알람 → 원인 지표"로 이어지는 대시보드 링크를 구성해, 알람 하나로 원인 탐색이 가능하게 만들기
4. 지난 1개월 알람 이력을 내보내서, "액션 없이 해소된 알람"의 비율을 측정해보기
5. 멀티 윈도우 번레이트 알람을 스테이징 환경에 배포하고, 인위적 에러를 주입해 트리거되는지 확인하기

---

## 관련 글

- [Prometheus + Grafana: 메트릭 수집과 대시보드](/learning/deep-dive/deep-dive-prometheus-grafana/) — 알람의 기반이 되는 메트릭 수집/PromQL
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) — 번레이트 알람의 이론적 배경
- [Observability 기초](/learning/deep-dive/deep-dive-observability-baseline/) — 로그/메트릭/트레이스 3축 설계
- [OpenTelemetry 기초](/learning/deep-dive/deep-dive-opentelemetry/) — 분산 트레이싱과 관측 표준
- [API 레이트 리밋과 백프레셔 심화](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/) — 트래픽 제어와 결합한 알람 설계
- [Timeout/Retry/Backoff 전략](/learning/deep-dive/deep-dive-timeout-retry-backoff/) — 장애 전파 방지 패턴
