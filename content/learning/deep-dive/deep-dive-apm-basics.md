---
title: "APM 기초: 애플리케이션 성능 모니터링 시작하기"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["APM", "Monitoring", "Spring Boot Actuator", "Metrics", "Performance"]
categories: ["Backend Deep Dive"]
description: "APM 핵심 개념과 Spring Boot Actuator로 애플리케이션 성능 모니터링 구현"
module: "ops-observability"
study_order: 342
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

## 2) Spring Boot Actuator

### 2-1) Actuator 설정

**의존성:**
```gradle
// build.gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-registry-prometheus'  // Prometheus 메트릭
}
```

**application.yml:**
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus  # 노출할 엔드포인트
  endpoint:
    health:
      show-details: always  # 헬스 체크 상세 정보
  metrics:
    tags:
      application: myapp  # 메트릭에 태그 추가
```

### 2-2) 헬스 체크 (Health Check)

**기본 헬스 체크:**
```bash
# http://localhost:8080/actuator/health
curl http://localhost:8080/actuator/health

# 응답:
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": {
        "database": "MySQL",
        "validationQuery": "isValid()"
      }
    },
    "diskSpace": {
      "status": "UP",
      "details": {
        "total": 499963174912,
        "free": 123456789012
      }
    },
    "ping": {
      "status": "UP"
    }
  }
}
```

**커스텀 헬스 체크:**
```java
@Component
public class ExternalApiHealthIndicator implements HealthIndicator {

    @Autowired
    private RestTemplate restTemplate;

    @Override
    public Health health() {
        try {
            // 외부 API 호출
            ResponseEntity<String> response = restTemplate.getForEntity(
                "https://api.example.com/health",
                String.class
            );

            if (response.getStatusCode().is2xxSuccessful()) {
                return Health.up()
                    .withDetail("api", "External API is healthy")
                    .build();
            } else {
                return Health.down()
                    .withDetail("api", "External API returned " + response.getStatusCode())
                    .build();
            }

        } catch (Exception e) {
            return Health.down()
                .withDetail("error", e.getMessage())
                .build();
        }
    }
}
```

### 2-3) 메트릭 (Metrics)

**기본 메트릭 확인:**
```bash
# 모든 메트릭 목록
curl http://localhost:8080/actuator/metrics

# 응답:
{
  "names": [
    "jvm.memory.used",
    "jvm.gc.pause",
    "http.server.requests",
    "system.cpu.usage",
    "hikaricp.connections.active"
  ]
}

# 특정 메트릭 상세
curl http://localhost:8080/actuator/metrics/http.server.requests

# 응답:
{
  "name": "http.server.requests",
  "measurements": [
    {
      "statistic": "COUNT",
      "value": 1234
    },
    {
      "statistic": "TOTAL_TIME",
      "value": 12.5
    },
    {
      "statistic": "MAX",
      "value": 0.5
    }
  ],
  "availableTags": [
    {
      "tag": "uri",
      "values": ["/api/users", "/api/orders"]
    },
    {
      "tag": "method",
      "values": ["GET", "POST"]
    },
    {
      "tag": "status",
      "values": ["200", "404", "500"]
    }
  ]
}
```

**커스텀 메트릭:**
```java
@Service
public class OrderService {

    private final MeterRegistry meterRegistry;
    private final Counter orderCounter;
    private final Timer orderTimer;

    public OrderService(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;

        // 카운터 (누적 횟수)
        this.orderCounter = Counter.builder("orders.created")
            .description("Number of orders created")
            .tag("type", "online")
            .register(meterRegistry);

        // 타이머 (실행 시간)
        this.orderTimer = Timer.builder("orders.processing.time")
            .description("Time to process an order")
            .register(meterRegistry);
    }

    public Order createOrder(CreateOrderRequest request) {
        return orderTimer.record(() -> {
            // 주문 처리
            Order order = orderRepository.save(request.toEntity());

            // 카운터 증가
            orderCounter.increment();

            // 게이지 (현재 값)
            meterRegistry.gauge("orders.total.amount", order.getAmount());

            return order;
        });
    }
}
```

**메트릭 타입:**
```java
// 1. Counter (누적 증가)
Counter counter = Counter.builder("user.login.count")
    .tag("status", "success")
    .register(meterRegistry);
counter.increment();

// 2. Gauge (현재 값)
meterRegistry.gauge("connection.pool.size", connectionPool, ConnectionPool::getSize);

// 3. Timer (실행 시간)
Timer timer = Timer.builder("api.response.time")
    .register(meterRegistry);
timer.record(() -> {
    // 측정할 코드
});

// 4. Distribution Summary (분포)
DistributionSummary summary = DistributionSummary.builder("order.amount")
    .register(meterRegistry);
summary.record(order.getAmount());
```

## 3) 분산 추적 (Distributed Tracing)

### 3-1) 왜 필요한가?

```
모놀리스:
요청 → App → DB → 응답
(단일 애플리케이션, 추적 쉬움)

마이크로서비스:
요청 → Gateway → Service A → Service B → DB
                         ↓
                    Service C → Redis

(여러 서비스, 추적 어려움)

분산 추적 = 요청이 여러 서비스를 거치는 경로 추적
```

### 3-2) Trace와 Span

```
Trace: 하나의 요청 전체 경로
Span: 요청 내 각 단계

예:
Trace ID: abc-123
├─ Span 1: Gateway (100ms)
├─ Span 2: Service A (200ms)
│  ├─ Span 3: DB Query (50ms)
│  └─ Span 4: Service B (150ms)
└─ Span 5: Service C (100ms)

총 소요 시간: 550ms
```

### 3-3) Spring Boot + Zipkin

**의존성:**
```gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-tracing-bridge-brave'
    implementation 'io.zipkin.reporter2:zipkin-reporter-brave'
}
```

**application.yml:**
```yaml
management:
  tracing:
    sampling:
      probability: 1.0  # 100% 샘플링 (개발), 운영: 0.1 (10%)
  zipkin:
    tracing:
      endpoint: http://localhost:9411/api/v2/spans
```

**Zipkin 실행 (Docker):**
```bash
docker run -d -p 9411:9411 openzipkin/zipkin
# http://localhost:9411에서 확인
```

## 4) APM 도구

### 4-1) 주요 APM 도구 비교

```
New Relic:
- 상용 (유료)
- 강력한 기능
- 쉬운 설정

Datadog:
- 상용 (유료)
- 인프라 + 애플리케이션 통합
- 다양한 통합

Elastic APM:
- 오픈소스 (무료)
- ELK 스택과 통합
- 자체 호스팅

Pinpoint (Naver):
- 오픈소스 (무료)
- 한국어 지원
- Java 특화
```

### 4-2) Prometheus + Grafana

**Prometheus:**
- 메트릭 수집/저장
- Pull 방식 (주기적으로 메트릭 가져옴)

**Grafana:**
- 메트릭 시각화
- 대시보드 구성

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  app:
    image: myapp:1.0
    ports:
      - "8080:8080"

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
  scrape_interval: 15s  # 15초마다 메트릭 수집

scrape_configs:
  - job_name: 'spring-boot-app'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['app:8080']
```

## 5) 알림 (Alerting)

### 5-1) 알림 전략

```
경고 (Warning):
- CPU 사용률 > 80%
- 평균 응답 시간 > 500ms
- 오류율 > 1%

위험 (Critical):
- CPU 사용률 > 90%
- 평균 응답 시간 > 1000ms
- 오류율 > 5%
- 서비스 다운

알림 채널:
- Slack
- 이메일
- PagerDuty
- SMS
```

### 5-2) Prometheus 알림 규칙

**alert-rules.yml:**
```yaml
groups:
  - name: application_alerts
    interval: 30s
    rules:
      # 높은 오류율
      - alert: HighErrorRate
        expr: rate(http_server_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }} (threshold: 0.05)"

      # 느린 응답 시간
      - alert: SlowResponseTime
        expr: http_server_requests_seconds_sum / http_server_requests_seconds_count > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow response time detected"
          description: "Average response time is {{ $value }}s"

      # 높은 CPU 사용률
      - alert: HighCpuUsage
        expr: system_cpu_usage > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value }}"
```

## 6) 실전 모니터링 전략

### 6-1) 단계별 구현

**1단계: 기본 헬스 체크**
```java
// Spring Boot Actuator 활성화
// http://localhost:8080/actuator/health
```

**2단계: 메트릭 수집**
```java
// Prometheus 메트릭 노출
// http://localhost:8080/actuator/prometheus
```

**3단계: 시각화**
```
Grafana 대시보드 구성:
- JVM 메모리
- HTTP 요청 수/응답 시간
- DB 커넥션 풀
- 오류율
```

**4단계: 알림 설정**
```
Prometheus Alertmanager:
- 오류율 > 1% → Slack 알림
- 응답 시간 > 1s → 이메일 알림
```

**5단계: 분산 추적**
```
Zipkin/Jaeger:
- 마이크로서비스 간 요청 추적
- 병목 구간 파악
```

### 6-2) 모니터링 대시보드 예시

```
Grafana 대시보드:

┌─────────────────────────────────────┐
│ Application Overview                │
├─────────────────────────────────────┤
│ RPS: 150 │ Avg Response: 200ms      │
│ Error Rate: 0.5% │ CPU: 60%         │
├─────────────────────────────────────┤
│ [그래프] HTTP Requests (시간별)      │
│ [그래프] Response Time (P50/P95/P99)│
│ [그래프] Error Rate                  │
│ [그래프] JVM Memory                  │
│ [그래프] DB Connection Pool          │
└─────────────────────────────────────┘
```

## 7) 베스트 프랙티스

### ✅ 1. 핵심 메트릭 우선

```
시작:
- 응답 시간
- 오류율
- CPU/메모리

나중:
- 비즈니스 메트릭 (주문 수, 매출 등)
```

### ✅ 2. 적절한 샘플링

```yaml
# 개발: 100% 샘플링
management:
  tracing:
    sampling:
      probability: 1.0

# 운영: 10% 샘플링 (성능 고려)
management:
  tracing:
    sampling:
      probability: 0.1
```

### ✅ 3. 의미 있는 태그

```java
Counter.builder("orders.created")
    .tag("type", "online")      // 주문 타입
    .tag("status", "success")   // 성공/실패
    .tag("region", "seoul")     // 지역
    .register(meterRegistry);
```

### ✅ 4. SLA/SLO 정의

```
SLA (Service Level Agreement):
- 99.9% 가용성 (월 43분 다운타임)
- 평균 응답 시간 < 500ms
- 오류율 < 0.1%

SLO (Service Level Objective):
- P95 응답 시간 < 1s
- P99 응답 시간 < 2s
```

## 8) 자주 하는 실수

### ❌ 실수 1: 너무 많은 메트릭

```
❌ 모든 것을 측정 → 비용 증가, 관리 어려움
✅ 핵심 메트릭만 측정
```

### ❌ 실수 2: 알림 피로

```
❌ 사소한 경고도 알림 → 무시하게 됨
✅ 중요한 것만 알림
```

### ❌ 실수 3: 모니터링 안 함

```
❌ 문제 발생 후 알게 됨
✅ 실시간 모니터링으로 조기 발견
```

## 연습 (추천)

1. **Actuator 설정**
   - Spring Boot 프로젝트에 Actuator 추가
   - 헬스 체크, 메트릭 확인

2. **Prometheus + Grafana**
   - Docker Compose로 구성
   - 대시보드 생성

3. **커스텀 메트릭**
   - 비즈니스 메트릭 추가 (주문 수, 매출 등)
   - Grafana에서 시각화

## 요약: 스스로 점검할 것

- APM의 필요성을 설명할 수 있다
- 핵심 메트릭(응답 시간, 처리량, 오류율)을 이해한다
- Spring Boot Actuator로 헬스 체크를 구현할 수 있다
- 커스텀 메트릭을 추가할 수 있다
- 분산 추적의 개념을 이해한다

## 다음 단계

- Prometheus + Grafana 심화: `/learning/deep-dive/deep-dive-prometheus-grafana/`
- 분산 추적 (Zipkin): `/learning/deep-dive/deep-dive-distributed-tracing/`
- 알림 전략: `/learning/deep-dive/deep-dive-alerting-strategy/`
