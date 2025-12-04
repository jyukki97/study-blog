---
title: "Prometheus와 Grafana로 Kafka 지표 분석"
date: 2025-01-18
topic: "DevOps"
topic_icon: "📊"
topic_description: "Kafka 클러스터 모니터링 및 성능 분석 시스템 구축"
tags: ["Kafka", "Prometheus", "Grafana", "Monitoring", "Observability"]
categories: ["DevOps", "Kafka"]
draft: false
---

## 1. 문제 상황

### 1.1 운영 중 발생한 장애

이벤트 기반 아키텍처로 전환 후 Kafka 클러스터에서 간헐적인 메시지 지연이 발생했습니다.

**문제 징후**:
- 특정 시간대에 Consumer Lag이 급증 (평소 100 → 15,000)
- 사용자가 주문 후 알림을 받기까지 5분 이상 지연
- 어떤 브로커나 파티션에서 문제가 발생하는지 파악 불가
- 장애 발생 후 사후 분석도 로그만으로는 한계

### 1.2 기존 모니터링의 한계

**문제점**:
- JMX Console로 일일이 브로커별 지표 확인 필요
- 실시간 추이 파악 불가능
- Consumer Lag 증가를 사전에 감지할 수 없음
- 장애 발생 시 근본 원인 분석에 수일 소요

## 2. 해결 과정

### 2.1 아키텍처 설계

```
┌─────────────┐
│ Kafka       │ JMX Metrics
│ Brokers     ├──────────────┐
└─────────────┘              │
                             │
┌─────────────┐              │     ┌─────────────┐
│ Kafka       │ JMX Metrics  │     │ Prometheus  │
│ Producers   ├──────────────┼────▶│ Server      │
└─────────────┘              │     └──────┬──────┘
                             │            │
┌─────────────┐              │            │ Pull
│ Kafka       │ JMX Metrics  │            │
│ Consumers   ├──────────────┘            │
└─────────────┘                           │
                                          │
                              ┌───────────▼──────────┐
                              │ Grafana              │
                              │ - Dashboard          │
                              │ - Alerting           │
                              └──────────────────────┘
```

### 2.2 JMX Exporter 설정

Kafka는 JMX(Java Management Extensions)로 메트릭을 노출하므로, Prometheus JMX Exporter를 사용해 변환합니다.

**JMX Exporter 다운로드 및 설정**:

```bash
# JMX Exporter JAR 다운로드
wget https://repo1.maven.org/maven2/io/prometheus/jmx/jmx_prometheus_javaagent/0.19.0/jmx_prometheus_javaagent-0.19.0.jar \
  -O /opt/kafka/jmx_prometheus_javaagent.jar
```

**kafka-jmx-config.yml**:

```yaml
---
lowercaseOutputName: true
lowercaseOutputLabelNames: true

rules:
  # Broker Metrics
  - pattern: kafka.server<type=(.+), name=(.+), clientId=(.+), topic=(.+), partition=(.*)><>Value
    name: kafka_server_$1_$2
    type: GAUGE
    labels:
      clientId: "$3"
      topic: "$4"
      partition: "$5"

  - pattern: kafka.server<type=(.+), name=(.+), clientId=(.+), brokerHost=(.+), brokerPort=(.+)><>Value
    name: kafka_server_$1_$2
    type: GAUGE
    labels:
      clientId: "$3"
      broker: "$4:$5"

  # Network Metrics
  - pattern: kafka.network<type=RequestMetrics, name=RequestsPerSec, request=(.+)><>Count
    name: kafka_network_requests_total
    type: COUNTER
    labels:
      request: "$1"

  - pattern: kafka.network<type=RequestMetrics, name=TotalTimeMs, request=(.+)><>Mean
    name: kafka_network_request_time_ms
    type: GAUGE
    labels:
      request: "$request"

  # Log Metrics
  - pattern: kafka.log<type=LogFlushStats, name=LogFlushRateAndTimeMs><>Count
    name: kafka_log_flush_total
    type: COUNTER

  - pattern: kafka.log<type=Log, name=Size, topic=(.+), partition=(.+)><>Value
    name: kafka_log_size_bytes
    type: GAUGE
    labels:
      topic: "$1"
      partition: "$2"

  # Controller Metrics
  - pattern: kafka.controller<type=KafkaController, name=(.+)><>Value
    name: kafka_controller_$1
    type: GAUGE

  # Consumer Group Metrics
  - pattern: kafka.consumer<type=consumer-fetch-manager-metrics, client-id=(.+), topic=(.+), partition=(.+)><>records-lag
    name: kafka_consumer_lag
    type: GAUGE
    labels:
      client_id: "$1"
      topic: "$2"
      partition: "$3"

  # Producer Metrics
  - pattern: kafka.producer<type=producer-metrics, client-id=(.+)><>(.+-total|.+-avg|.+-max|.+-min)
    name: kafka_producer_$2
    type: GAUGE
    labels:
      client_id: "$1"
```

### 2.3 Kafka 브로커 설정 수정

**config/server.properties**:

```properties
# JMX 포트 설정
listeners=PLAINTEXT://0.0.0.0:9092
advertised.listeners=PLAINTEXT://kafka-broker-1:9092

# JMX 설정
auto.create.topics.enable=false
delete.topic.enable=true
```

**systemd 서비스 파일 수정** (`/etc/systemd/system/kafka.service`):

```ini
[Unit]
Description=Apache Kafka Server
After=network.target zookeeper.service

[Service]
Type=simple
User=kafka
Environment="KAFKA_HEAP_OPTS=-Xmx2G -Xms2G"
Environment="KAFKA_JMX_OPTS=-Dcom.sun.management.jmxremote \
  -Dcom.sun.management.jmxremote.authenticate=false \
  -Dcom.sun.management.jmxremote.ssl=false \
  -Djava.rmi.server.hostname=kafka-broker-1 \
  -Dcom.sun.management.jmxremote.port=9999 \
  -javaagent:/opt/kafka/jmx_prometheus_javaagent.jar=7071:/opt/kafka/kafka-jmx-config.yml"
ExecStart=/opt/kafka/bin/kafka-server-start.sh /opt/kafka/config/server.properties
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**브로커 재시작**:

```bash
sudo systemctl daemon-reload
sudo systemctl restart kafka
```

**메트릭 확인**:

```bash
curl http://kafka-broker-1:7071/metrics | grep kafka_server
```

### 2.4 Prometheus 설정

**prometheus.yml**:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'production'
    region: 'ap-northeast-2'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - 'alertmanager:9093'

rule_files:
  - 'alerts/kafka-alerts.yml'

scrape_configs:
  # Kafka Brokers
  - job_name: 'kafka-brokers'
    static_configs:
      - targets:
          - 'kafka-broker-1:7071'
          - 'kafka-broker-2:7071'
          - 'kafka-broker-3:7071'
        labels:
          env: 'production'

  # Kafka Consumers
  - job_name: 'kafka-consumers'
    static_configs:
      - targets:
          - 'order-consumer:8080'
          - 'notification-consumer:8080'
          - 'analytics-consumer:8080'
        labels:
          env: 'production'

  # Kafka Producers
  - job_name: 'kafka-producers'
    static_configs:
      - targets:
          - 'order-service:8080'
          - 'user-service:8080'
        labels:
          env: 'production'
```

**Prometheus 실행**:

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v /path/to/prometheus.yml:/etc/prometheus/prometheus.yml \
  -v /path/to/alerts:/etc/prometheus/alerts \
  prom/prometheus:latest
```

### 2.5 Grafana 대시보드 구성

**Grafana 실행**:

```bash
docker run -d \
  --name grafana \
  -p 3000:3000 \
  -e "GF_SECURITY_ADMIN_PASSWORD=admin" \
  -e "GF_INSTALL_PLUGINS=grafana-piechart-panel" \
  grafana/grafana:latest
```

**Prometheus 데이터 소스 추가** (Configuration > Data Sources):

```json
{
  "name": "Prometheus",
  "type": "prometheus",
  "url": "http://prometheus:9090",
  "access": "proxy",
  "isDefault": true
}
```

## 3. 핵심 대시보드 구성

### 3.1 Kafka Cluster Overview

**주요 패널**:

1. **Broker 상태**
```promql
# Active Controller
kafka_controller_activecontrollercount

# Online Brokers
count(up{job="kafka-brokers"} == 1)
```

2. **총 메시지 처리량**
```promql
# Messages In Per Second
sum(rate(kafka_server_brokertopicmetrics_messagesinpersec[5m]))

# Bytes In Per Second
sum(rate(kafka_server_brokertopicmetrics_bytesinpersec[5m]))

# Bytes Out Per Second
sum(rate(kafka_server_brokertopicmetrics_bytesoutpersec[5m]))
```

3. **네트워크 요청 처리**
```promql
# Request Rate by Type
sum(rate(kafka_network_requests_total[5m])) by (request)

# Request Latency (P95)
histogram_quantile(0.95,
  sum(rate(kafka_network_request_time_ms_bucket[5m])) by (le, request)
)
```

### 3.2 Consumer Lag Monitoring

**가장 중요한 메트릭**:

```promql
# Consumer Lag by Group and Topic
kafka_consumer_lag{job="kafka-consumers"}

# Max Lag Across All Partitions
max(kafka_consumer_lag) by (group, topic)

# Total Lag per Consumer Group
sum(kafka_consumer_lag) by (group)

# Lag Trend (5분 변화율)
deriv(kafka_consumer_lag[5m])
```

**대시보드 설정**:

```json
{
  "dashboard": {
    "title": "Kafka Consumer Lag",
    "panels": [
      {
        "title": "Consumer Lag by Topic",
        "targets": [
          {
            "expr": "kafka_consumer_lag",
            "legendFormat": "{{group}} - {{topic}} - {{partition}}"
          }
        ],
        "type": "graph",
        "alert": {
          "conditions": [
            {
              "evaluator": {
                "params": [10000],
                "type": "gt"
              },
              "operator": {
                "type": "and"
              },
              "query": {
                "params": ["A", "5m", "now"]
              },
              "reducer": {
                "params": [],
                "type": "avg"
              },
              "type": "query"
            }
          ],
          "frequency": "1m",
          "handler": 1,
          "name": "High Consumer Lag",
          "message": "Consumer lag exceeded 10,000 messages",
          "noDataState": "no_data",
          "executionErrorState": "alerting"
        }
      }
    ]
  }
}
```

### 3.3 Broker 성능 모니터링

**CPU 및 메모리**:

```promql
# JVM Heap Usage
kafka_server_jvm_memory_bytes_used{area="heap"}
  / kafka_server_jvm_memory_bytes_max{area="heap"} * 100

# GC Time
rate(kafka_server_jvm_gc_collection_seconds_sum[5m])

# Thread Count
kafka_server_jvm_threads_current
```

**디스크 사용량**:

```promql
# Log Size per Topic
sum(kafka_log_size_bytes) by (topic)

# Log Flush Rate
rate(kafka_log_flush_total[5m])
```

**네트워크 I/O**:

```promql
# Network Processor Idle Percentage
kafka_server_kafkarequesthandlerpool_requesthandleravgidlepercent

# Request Queue Size
kafka_server_requestchannel_requestqueuesize
```

### 3.4 Producer 성능 모니터링

```promql
# Record Send Rate
rate(kafka_producer_record_send_total[5m])

# Record Error Rate
rate(kafka_producer_record_error_total[5m])

# Batch Size Average
kafka_producer_batch_size_avg

# Compression Rate
kafka_producer_compression_rate_avg

# Request Latency
kafka_producer_request_latency_avg
```

## 4. 알림 규칙 설정

### 4.1 Alert Rules

**alerts/kafka-alerts.yml**:

```yaml
groups:
  - name: kafka_alerts
    interval: 30s
    rules:
      # Broker Down
      - alert: KafkaBrokerDown
        expr: up{job="kafka-brokers"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Kafka broker {{ $labels.instance }} is down"
          description: "Kafka broker has been unreachable for more than 1 minute."

      # No Active Controller
      - alert: KafkaNoActiveController
        expr: kafka_controller_activecontrollercount == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "No active Kafka controller"
          description: "Cluster has no active controller, new partitions cannot be created."

      # High Consumer Lag
      - alert: KafkaConsumerLagHigh
        expr: kafka_consumer_lag > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High consumer lag on {{ $labels.group }}"
          description: "Consumer group {{ $labels.group }} has lag of {{ $value }} on topic {{ $labels.topic }}."

      # Consumer Lag Growing
      - alert: KafkaConsumerLagGrowing
        expr: deriv(kafka_consumer_lag[10m]) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Consumer lag growing for {{ $labels.group }}"
          description: "Lag is growing at {{ $value }} messages/sec for group {{ $labels.group }}."

      # Under Replicated Partitions
      - alert: KafkaUnderReplicatedPartitions
        expr: kafka_server_replicamanager_underreplicatedpartitions > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Under-replicated partitions detected"
          description: "Broker {{ $labels.instance }} has {{ $value }} under-replicated partitions."

      # Offline Partitions
      - alert: KafkaOfflinePartitions
        expr: kafka_controller_offlinepartitionscount > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Offline partitions detected"
          description: "{{ $value }} partitions are offline."

      # ISR Shrink Rate High
      - alert: KafkaISRShrinkRateHigh
        expr: rate(kafka_server_replicamanager_isrshrinkspersec[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "ISR shrinking frequently"
          description: "ISR is shrinking at {{ $value }} times/sec on {{ $labels.instance }}."

      # Disk Usage High
      - alert: KafkaDiskUsageHigh
        expr: sum(kafka_log_size_bytes) by (instance) > 100 * 1024 * 1024 * 1024
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Disk usage high on {{ $labels.instance }}"
          description: "Disk usage is {{ $value | humanize1024 }}B."

      # JVM Memory Pressure
      - alert: KafkaJVMMemoryPressure
        expr: |
          (kafka_server_jvm_memory_bytes_used{area="heap"}
          / kafka_server_jvm_memory_bytes_max{area="heap"}) > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "JVM memory pressure on {{ $labels.instance }}"
          description: "Heap usage is {{ $value | humanizePercentage }}."

      # GC Time High
      - alert: KafkaGCTimeHigh
        expr: rate(kafka_server_jvm_gc_collection_seconds_sum[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High GC time on {{ $labels.instance }}"
          description: "GC is consuming {{ $value | humanizePercentage }} of CPU time."
```

### 4.2 Alertmanager 설정

**alertmanager.yml**:

```yaml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'

route:
  group_by: ['alertname', 'cluster', 'severity']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'slack-notifications'
  routes:
    - match:
        severity: critical
      receiver: 'slack-critical'
      continue: true
    - match:
        severity: warning
      receiver: 'slack-warning'

receivers:
  - name: 'slack-notifications'
    slack_configs:
      - channel: '#kafka-alerts'
        title: 'Kafka Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}'

  - name: 'slack-critical'
    slack_configs:
      - channel: '#kafka-critical'
        title: '🚨 CRITICAL: Kafka Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}'
        send_resolved: true

  - name: 'slack-warning'
    slack_configs:
      - channel: '#kafka-warnings'
        title: '⚠️ WARNING: Kafka Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}'
```

## 5. 실전 활용 사례

### 5.1 Consumer Lag 급증 원인 분석

**문제 발견**:
- Grafana 알림으로 `order-consumer` 그룹의 lag이 15,000으로 급증 확인

**Prometheus 쿼리로 분석**:

```promql
# 파티션별 Lag 확인
kafka_consumer_lag{group="order-consumer"}

# 특정 파티션의 처리량 확인
rate(kafka_consumer_records_consumed_total{
  group="order-consumer",
  topic="orders"
}[5m])
```

**발견 사항**:
- 파티션 7번의 lag만 급증 (14,500 / 15,000)
- 해당 파티션을 처리하는 컨슈머 인스턴스의 CPU가 100%

**해결 방법**:
```bash
# 문제 컨슈머 인스턴스 재시작
kubectl rollout restart deployment/order-consumer

# 파티션 리밸런싱 확인
kubectl logs -f deployment/order-consumer | grep "Rebalance"
```

**결과**:
- Lag 15,000 → 200 (5분 내 정상화)
- 처리 지연 해소

### 5.2 브로커 성능 병목 해결

**Grafana에서 발견한 이상 징후**:

```promql
# Request Queue가 지속적으로 증가
kafka_server_requestchannel_requestqueuesize > 100

# Network Thread Idle이 0%에 근접
kafka_server_kafkarequesthandlerpool_requesthandleravgidlepercent < 10
```

**원인 분석**:
- `num.network.threads=3`으로 설정되어 있어 네트워크 처리 능력 부족
- Peak 시간대 초당 5,000개 요청 발생

**해결**:

```properties
# config/server.properties
num.network.threads=8
num.io.threads=8
```

**성능 개선 확인**:

```promql
# Request Latency P95 개선
histogram_quantile(0.95,
  sum(rate(kafka_network_request_time_ms_bucket[5m])) by (le)
)
# Before: 850ms → After: 120ms
```

### 5.3 디스크 용량 관리 자동화

**문제**: 특정 토픽의 로그 사이즈가 급증하여 디스크 공간 부족

**모니터링 쿼리**:

```promql
# 토픽별 디스크 사용량
topk(10, sum(kafka_log_size_bytes) by (topic))

# 디스크 증가율
deriv(sum(kafka_log_size_bytes) by (topic)[1h])
```

**자동 정리 정책 설정**:

```properties
# config/server.properties
log.retention.hours=168  # 7일
log.retention.bytes=107374182400  # 100GB
log.segment.bytes=1073741824  # 1GB
log.cleanup.policy=delete
```

**결과**:
- 디스크 사용량 안정화 (85% → 60%)
- 자동 클리닝으로 운영 부담 감소

## 6. 고급 분석 기법

### 6.1 토픽별 성능 비교

```promql
# 토픽별 메시지 처리량 비교
sum(rate(kafka_server_brokertopicmetrics_messagesinpersec[5m])) by (topic)

# 토픽별 평균 메시지 크기
sum(rate(kafka_server_brokertopicmetrics_bytesinpersec[5m])) by (topic)
  / sum(rate(kafka_server_brokertopicmetrics_messagesinpersec[5m])) by (topic)
```

### 6.2 Consumer Group 효율성 분석

```promql
# Consumer Group의 처리 속도
rate(kafka_consumer_records_consumed_total[5m])

# Consumer Group의 Commit 빈도
rate(kafka_consumer_commit_latency_total[5m])

# Fetch 대기 시간
kafka_consumer_fetch_latency_avg
```

### 6.3 Rebalance 모니터링

```promql
# Rebalance 발생 빈도
rate(kafka_consumer_rebalance_total[10m])

# Rebalance 시간
kafka_consumer_rebalance_latency_avg
```

**Rebalance 최소화 설정**:

```properties
# Consumer 설정
session.timeout.ms=30000
heartbeat.interval.ms=3000
max.poll.interval.ms=300000
max.poll.records=500
```

## 7. 성능 최적화 사례

### 7.1 모니터링 기반 튜닝

**Before 상태 (Grafana 분석)**:
- 평균 응답 시간: 450ms
- P95 응답 시간: 1.2s
- Consumer Lag: 평균 5,000

**튜닝 적용**:

```properties
# Producer 설정
compression.type=snappy
batch.size=32768
linger.ms=10
buffer.memory=67108864

# Broker 설정
num.network.threads=8
num.io.threads=8
socket.send.buffer.bytes=1048576
socket.receive.buffer.bytes=1048576
```

**After 상태**:
- 평균 응답 시간: 180ms (60% 개선)
- P95 응답 시간: 320ms (73% 개선)
- Consumer Lag: 평균 500 (90% 감소)

### 7.2 비용 최적화

**리소스 사용 패턴 분석**:

```promql
# 시간대별 트래픽 패턴
avg_over_time(
  sum(rate(kafka_server_brokertopicmetrics_messagesinpersec[5m]))[1d:1h]
)
```

**발견 사항**:
- 오전 9시~12시: Peak (10,000 msg/s)
- 오후 2시~6시: Medium (5,000 msg/s)
- 야간: Low (500 msg/s)

**최적화 조치**:
- Peak 시간대: 브로커 3대 운영
- 야간: 브로커 1대로 축소 (Kubernetes HPA 활용)

**비용 절감 효과**: 월 $1,200 → $750 (38% 절감)

## 8. 트러블슈팅 가이드

### 8.1 메트릭이 수집되지 않을 때

**증상**: Grafana에서 "No data" 표시

**확인 절차**:

```bash
# 1. JMX Exporter가 메트릭을 노출하는지 확인
curl http://kafka-broker-1:7071/metrics

# 2. Prometheus가 타겟을 인식하는지 확인
# Prometheus UI > Status > Targets 확인

# 3. Prometheus 로그 확인
docker logs prometheus | grep ERROR

# 4. 방화벽 확인
telnet kafka-broker-1 7071
```

**해결**:
- JMX Agent가 제대로 로드되지 않은 경우: Kafka 재시작
- 네트워크 문제: 방화벽 규칙 수정

### 8.2 Consumer Lag이 정확하지 않을 때

**원인**: Consumer가 메트릭을 노출하지 않거나 잘못된 방식으로 측정

**해결 - Burrow 사용**:

```bash
# Burrow 실행 (LinkedIn의 Consumer Lag 체커)
docker run -d \
  --name burrow \
  -p 8000:8000 \
  -v /path/to/burrow.toml:/etc/burrow/burrow.toml \
  solsson/burrow:latest
```

**burrow.toml**:

```toml
[zookeeper]
servers=["zookeeper:2181"]
timeout=6
root-path="/burrow"

[kafka "local"]
brokers=["kafka-broker-1:9092", "kafka-broker-2:9092"]
version="2.8.0"

[httpserver]
address=":8000"
```

### 8.3 JVM GC 문제 해결

**Grafana에서 확인**:

```promql
# GC 시간이 전체 실행 시간의 10% 이상
rate(kafka_server_jvm_gc_collection_seconds_sum[5m]) > 0.1

# Old Gen 메모리 사용률이 85% 이상
kafka_server_jvm_memory_bytes_used{area="heap", id="old"}
  / kafka_server_jvm_memory_bytes_max{area="heap", id="old"} > 0.85
```

**해결**:

```bash
# JVM 옵션 튜닝
KAFKA_HEAP_OPTS="-Xms4G -Xmx4G \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=20 \
  -XX:InitiatingHeapOccupancyPercent=35 \
  -XX:G1HeapRegionSize=16M"
```

## 9. 결과 및 개선 효과

### 9.1 운영 효율성 개선

| 지표 | Before | After | 개선율 |
|------|--------|-------|--------|
| 장애 감지 시간 | 평균 15분 | 평균 30초 | 97% 단축 |
| 근본 원인 분석 시간 | 평균 2시간 | 평균 10분 | 92% 단축 |
| 사전 예방 조치 | 월 0건 | 월 8건 | - |
| 장애 발생 빈도 | 월 4건 | 월 0.5건 | 87% 감소 |

### 9.2 성능 개선

- **메시지 처리 지연**: P95 1.2s → 320ms (73% 개선)
- **Consumer Lag**: 평균 5,000 → 500 (90% 감소)
- **브로커 리소스 효율**: CPU 65% → 40% (38% 개선)

### 9.3 비용 절감

- **인프라 비용**: 월 $1,200 → $750 (38% 절감)
- **운영 인력 시간**: 주 12시간 → 주 3시간 (75% 절감)

## 10. 핵심 요약

### 필수 모니터링 메트릭

**Broker 레벨**:
- `kafka_controller_activecontrollercount`: Active Controller 존재 여부
- `kafka_server_replicamanager_underreplicatedpartitions`: 복제 부족 파티션
- `kafka_controller_offlinepartitionscount`: 오프라인 파티션

**Consumer 레벨**:
- `kafka_consumer_lag`: Consumer Lag (가장 중요!)
- `kafka_consumer_records_consumed_total`: 처리 속도

**Producer 레벨**:
- `kafka_producer_record_send_total`: 전송 성공률
- `kafka_producer_record_error_total`: 전송 실패율

### 알림 우선순위

**Critical (즉시 대응)**:
- Broker Down
- No Active Controller
- Offline Partitions

**Warning (5분 내 대응)**:
- High Consumer Lag
- Under-replicated Partitions
- ISR Shrink Rate High

### 운영 팁

1. **대시보드는 3개면 충분**: Cluster Overview, Consumer Lag, Broker Performance
2. **알림은 최소화**: 너무 많으면 alarm fatigue 발생
3. **주간 리포트 자동화**: Grafana Reporting 기능 활용
4. **Retention 정책 수립**: 메트릭은 30일, 로그는 7일이면 충분
