---
title: "Prometheus + Grafana: 메트릭 수집과 모니터링 대시보드"
date: 2025-12-11
draft: false
topic: "DevOps"
tags: ["Prometheus", "Grafana", "Monitoring", "Metrics", "Alerting", "Spring Boot"]
categories: ["Backend Deep Dive"]
description: "Prometheus로 메트릭을 수집하고 Grafana로 시각화하는 모니터링 시스템 구축"
module: "ops-observability"
study_order: 343
---

## 이 글에서 얻는 것

- **Prometheus**로 메트릭을 수집하고 저장하는 구조를 이해합니다.
- **PromQL**로 실무에서 자주 쓰는 쿼리를 작성할 수 있습니다.
- **Grafana**로 의미 있는 대시보드를 설계합니다.
- **알림 규칙**을 설계하고, 노이즈를 줄이는 전략을 세웁니다.
- **커스텀 메트릭**을 Spring Boot 앱에 추가하는 방법을 익힙니다.

---

## 1) Prometheus 아키텍처 이해

Prometheus는 **Pull 기반** 메트릭 수집 시스템입니다. 모니터링 대상이 `/metrics` 엔드포인트를 노출하면, Prometheus가 주기적으로 가져갑니다(Scrape).

```
┌─────────────┐     scrape     ┌──────────────┐     query     ┌──────────┐
│ Spring Boot │ ←───────────── │  Prometheus  │ ←──────────── │ Grafana  │
│ /actuator/  │    (15초 주기)  │   (TSDB)     │   (PromQL)   │          │
│  prometheus │                └──────┬───────┘              └──────────┘
└─────────────┘                       │
                                      ▼
                               ┌──────────────┐
                               │ Alertmanager │ → Slack/PagerDuty
                               └──────────────┘
```

**Pull vs Push의 의미:**
- Pull: Prometheus가 대상을 찾아감 → 대상이 죽으면 "스크랩 실패" 자체가 장애 신호
- Push: 대상이 보내줌 → 대상이 죽으면 데이터가 안 옴 → "안 보냈는지, 문제인지" 구분 어려움

### Docker Compose 기본 구성

```yaml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./alert-rules.yml:/etc/prometheus/alert-rules.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana

  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml

volumes:
  prometheus-data:
  grafana-data:
```

**prometheus.yml:**
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - 'alert-rules.yml'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
    # 서비스 디스커버리 사용 시
    # kubernetes_sd_configs:
    #   - role: pod
```

---

## 2) Spring Boot 통합

### 의존성 추가

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-registry-prometheus'
}
```

### 설정

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, metrics, prometheus
  endpoint:
    health:
      show-details: when_authorized
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: ${spring.application.name}
      environment: ${spring.profiles.active:local}
```

### 커스텀 메트릭 추가

Micrometer가 자동 수집하는 메트릭(JVM, HTTP, DB 등) 외에, **비즈니스 메트릭**을 직접 추가해야 운영에 의미 있는 모니터링이 됩니다.

```java
@Component
@RequiredArgsConstructor
public class OrderMetrics {

    private final MeterRegistry meterRegistry;

    // Counter: 누적 주문 수 (태그로 상태 구분)
    public void recordOrder(String status) {
        meterRegistry.counter("orders_total",
            "status", status,    // success, failed, cancelled
            "channel", "web"     // web, mobile, api
        ).increment();
    }

    // Gauge: 현재 처리 중인 주문 수
    private final AtomicInteger activeOrders = new AtomicInteger(0);

    @PostConstruct
    public void registerGauges() {
        meterRegistry.gauge("orders_active", activeOrders);
    }

    public void orderStarted() { activeOrders.incrementAndGet(); }
    public void orderFinished() { activeOrders.decrementAndGet(); }

    // Timer: 주문 처리 소요 시간
    public void recordProcessingTime(long durationMs) {
        meterRegistry.timer("order_processing_duration",
            "type", "standard"
        ).record(Duration.ofMillis(durationMs));
    }

    // Distribution Summary: 주문 금액 분포
    public void recordOrderAmount(double amount) {
        meterRegistry.summary("order_amount",
            "currency", "KRW"
        ).record(amount);
    }
}
```

**메트릭 타입 선택 기준:**

| 타입 | 용도 | 예시 |
|---|---|---|
| **Counter** | 단조 증가하는 누적값 | 요청 수, 에러 수, 주문 수 |
| **Gauge** | 현재 상태값 (올라갔다 내려감) | 활성 커넥션, 큐 길이, 메모리 |
| **Timer** | 소요 시간 측정 | API 응답 시간, 쿼리 실행 시간 |
| **Distribution Summary** | 값의 분포 | 요청 크기, 주문 금액 |

---

## 3) PromQL 실전 쿼리

### 기본 쿼리

```promql
# HTTP 요청 수 (instant vector)
http_server_requests_seconds_count

# 초당 요청 수 (RPS) — 5분 범위의 초당 평균
rate(http_server_requests_seconds_count[5m])

# 평균 응답 시간
rate(http_server_requests_seconds_sum[5m]) / rate(http_server_requests_seconds_count[5m])

# P95 응답 시간 (히스토그램 기반)
histogram_quantile(0.95, rate(http_server_requests_seconds_bucket[5m]))

# 에러율 (5xx 비율)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
/
sum(rate(http_server_requests_seconds_count[5m]))
```

### 실무에서 자주 쓰는 쿼리

```promql
# 1. 특정 API 엔드포인트 P99 응답 시간
histogram_quantile(0.99,
  sum by(le) (rate(http_server_requests_seconds_bucket{uri="/api/orders"}[5m]))
)

# 2. JVM 힙 사용률
jvm_memory_used_bytes{area="heap"}
/
jvm_memory_max_bytes{area="heap"} * 100

# 3. DB 커넥션 풀 사용률
hikaricp_connections_active
/
hikaricp_connections_max * 100

# 4. GC 일시정지 시간 (초당)
rate(jvm_gc_pause_seconds_sum[5m])

# 5. 커스텀: 분당 주문 실패율
sum(rate(orders_total{status="failed"}[5m]))
/
sum(rate(orders_total[5m]))
```

### rate vs irate

| 함수 | 특징 | 언제 사용 |
|---|---|---|
| `rate()` | 범위 전체의 평균 변화율 | 대시보드, 알림 (안정적) |
| `irate()` | 마지막 두 데이터 포인트의 순간 변화율 | 스파이크 감지 (민감) |

알림에는 `rate()`를, 디버깅용 대시보드에는 `irate()`를 사용하는 것이 일반적입니다.

---

## 4) Grafana 대시보드 설계 원칙

### USE/RED 방법론

효과적인 대시보드는 구조 없이 메트릭을 나열하지 않습니다. 두 가지 검증된 방법론을 조합합니다:

**RED (서비스 관점 — 외부에서 본 건강 상태):**
- **R**ate — 초당 요청 수
- **E**rrors — 에러율
- **D**uration — 응답 시간 (P50/P95/P99)

**USE (인프라 관점 — 내부 리소스 상태):**
- **U**tilization — CPU, 메모리, 디스크 사용률
- **S**aturation — 큐 깊이, 스레드 풀 대기, 커넥션 풀 대기
- **E**rrors — 하드웨어/시스템 에러

### 대시보드 구성 예시

```
┌──────────────────────────────────────────────────────────┐
│ Row 1: 서비스 개요 (RED)                                    │
│ [RPS] [Error Rate %] [P50/P95/P99 Latency]               │
├──────────────────────────────────────────────────────────┤
│ Row 2: 비즈니스 메트릭                                      │
│ [주문 수/분] [결제 성공률] [활성 사용자]                        │
├──────────────────────────────────────────────────────────┤
│ Row 3: JVM (USE)                                         │
│ [Heap 사용률] [GC Pause] [Thread Count]                    │
├──────────────────────────────────────────────────────────┤
│ Row 4: 의존성                                              │
│ [DB 커넥션 풀] [Redis 지연] [외부 API 응답시간]                │
└──────────────────────────────────────────────────────────┘
```

**대시보드 설계 체크리스트:**
- ✅ 맨 위에 가장 중요한 지표 (에러율, P95)
- ✅ 템플릿 변수로 앱/환경 필터링 가능
- ✅ 시간 범위 변경 시 모든 패널 연동
- ✅ 패널에 임계값 선 표시 (SLO 기준선)
- ❌ 패널 20개 이상 → 집중력 분산, 5~10개가 적정

### Grafana Data Source 연결

```
1. Configuration → Data Sources → Add → Prometheus
   URL: http://prometheus:9090
   Access: Server (default)
   Scrape interval: 15s

2. Dashboard → Import → ID 입력
   - 4701: JVM (Micrometer) — Spring Boot JVM 모니터링
   - 11378: HikariCP — DB 커넥션 풀
   - 12900: Spring Boot Statistics — HTTP/Cache/DB 종합

3. 커스텀 패널 추가:
   - 비즈니스 메트릭은 Import 대시보드에 없으므로 직접 추가
```

---

## 5) 알림 설계: 노이즈를 줄이고 중요한 것만 울리기

알림이 많으면 무시하게 됩니다. **"알림 하나가 울리면 사람이 움직여야 한다"**는 원칙을 지킵니다.

### 알림 규칙 작성

```yaml
# alert-rules.yml
groups:
  - name: service_health
    rules:
      # 에러율 5% 초과 (5분 지속)
      - alert: HighErrorRate
        expr: |
          sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
          /
          sum(rate(http_server_requests_seconds_count[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "에러율 {{ $value | humanizePercentage }} 초과"
          description: "5분간 5xx 에러율이 5%를 넘었습니다."

      # P95 응답 시간 SLO 초과
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            sum by(le) (rate(http_server_requests_seconds_bucket[5m]))
          ) > 1.0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 응답 시간 {{ $value | humanizeDuration }} 초과"

  - name: infrastructure
    rules:
      # JVM 힙 사용률 85% 초과
      - alert: HighHeapUsage
        expr: |
          jvm_memory_used_bytes{area="heap"}
          / jvm_memory_max_bytes{area="heap"} > 0.85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "JVM 힙 사용률 {{ $value | humanizePercentage }}"

      # DB 커넥션 풀 90% 이상 사용
      - alert: ConnectionPoolExhaustion
        expr: |
          hikaricp_connections_active
          / hikaricp_connections_max > 0.9
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "DB 커넥션 풀 포화 {{ $value | humanizePercentage }}"
```

### Alertmanager 라우팅

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s          # 같은 그룹 알림 모아서 전송
  group_interval: 5m       # 같은 그룹 재전송 간격
  repeat_interval: 4h      # 동일 알림 반복 주기
  receiver: 'slack-default'

  routes:
    - match:
        severity: critical
      receiver: 'slack-critical'
      repeat_interval: 1h

receivers:
  - name: 'slack-default'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#alerts'
  - name: 'slack-critical'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#alerts-critical'
```

### 좋은 알림 vs 나쁜 알림

| 나쁜 알림 | 좋은 알림 |
|---|---|
| CPU 80% 초과 | 에러율 5% 초과 (5분 지속) |
| GC 발생 | GC pause 2초 초과 (10분 내 3회) |
| 디스크 70% | 디스크 증가 추세 → 24시간 내 풀 예상 |
| 요청 수 감소 | 요청 수 평소 대비 80% 하락 (5분 지속) |

**원칙:** 증상(Symptom)에 알림, 원인(Cause)은 대시보드에서 조사합니다.

---

## 요약

- **Prometheus**: Pull 기반 메트릭 수집 → TSDB 저장 → PromQL 쿼리
- **Spring Boot**: Micrometer + Actuator로 자동 수집 + 커스텀 비즈니스 메트릭 추가
- **PromQL**: `rate()`, `histogram_quantile()`, 집계 함수가 핵심
- **Grafana**: RED/USE 방법론으로 구조화된 대시보드 설계
- **알림**: 증상 기반, `for` 절로 일시적 스파이크 필터링, 반복 간격으로 노이즈 제어

---

## 다음 단계

- [APM 기초: 트레이싱과 병목 분석](/learning/deep-dive/deep-dive-apm-basics/)
- [OpenTelemetry 실전 정리](/learning/deep-dive/deep-dive-opentelemetry/)
- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
