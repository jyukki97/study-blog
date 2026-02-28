---
title: "APM 기본 (Part 2: Actuator, Prometheus 연동)"
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

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: APM 기본 (Part 1: 개념과 도구)](/learning/deep-dive/deep-dive-apm-basics/)**
