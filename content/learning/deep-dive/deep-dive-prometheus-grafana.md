---
title: "Prometheus + Grafana: 메트릭 수집과 모니터링 대시보드"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Prometheus", "Grafana", "Monitoring", "Metrics", "Alerting"]
categories: ["Backend Deep Dive"]
description: "Prometheus로 메트릭을 수집하고 Grafana로 시각화하는 모니터링 시스템 구축"
module: "ops-observability"
study_order: 343
---

## 이 글에서 얻는 것

- **Prometheus**로 메트릭을 수집하고 저장합니다.
- **PromQL**로 메트릭을 쿼리합니다.
- **Grafana**로 대시보드를 만듭니다.
- **알림 규칙**을 설정합니다.

## 1) Prometheus 기본

```yaml
# docker-compose.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

**prometheus.yml:**
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
```

## 2) Spring Boot 통합

```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-registry-prometheus'
}
```

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
```

## 3) PromQL 기본

```promql
# HTTP 요청 수
http_server_requests_seconds_count

# 초당 요청 수 (RPS)
rate(http_server_requests_seconds_count[5m])

# 평균 응답 시간
rate(http_server_requests_seconds_sum[5m]) / rate(http_server_requests_seconds_count[5m])

# P95 응답 시간
histogram_quantile(0.95, rate(http_server_requests_seconds_bucket[5m]))

# 에러율
rate(http_server_requests_seconds_count{status=~"5.."}[5m]) / rate(http_server_requests_seconds_count[5m])
```

## 4) Grafana 대시보드

```
1. Data Source 추가:
   Configuration → Data Sources → Prometheus
   URL: http://prometheus:9090

2. Dashboard 생성:
   - Requests Per Second (RPS)
   - Response Time (P50/P95/P99)
   - Error Rate
   - JVM Memory
   - CPU Usage

3. 템플릿 변수:
   - $app: 애플리케이션 선택
   - $env: 환경 선택
```

## 5) 알림 규칙

```yaml
# alert-rules.yml
groups:
  - name: app_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_server_requests_seconds_count{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
```

## 요약

- Prometheus: 메트릭 수집 및 저장
- PromQL: 메트릭 쿼리 언어
- Grafana: 시각화 대시보드
- 알림으로 장애 조기 감지

## 다음 단계

- APM: `/learning/deep-dive/deep-dive-apm-basics/`
- 알림 전략: `/learning/deep-dive/deep-dive-alerting-strategy/`
