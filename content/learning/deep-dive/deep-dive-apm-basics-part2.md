---
title: "APM 기본 (Part 2: Actuator, Prometheus 연동)"
date: 2025-12-10
draft: false
topic: "DevOps"
tags: ["APM", "Monitoring", "Spring Boot Actuator", "Metrics", "Performance"]
categories: ["Backend Deep Dive"]
description: "APM 핵심 개념과 Spring Boot Actuator로 애플리케이션 성능 모니터링 구현"
summary: "Actuator를 켜는 방법에서 끝나지 않고, Prometheus가 실제로 수집할 지표 이름·태그·알림 기준을 어떻게 설계해야 운영 가능한 APM이 되는지 정리합니다."
key_takeaways:
  - "Actuator 엔드포인트는 health/readiness와 prometheus를 분리해 노출 범위와 보안 경계를 먼저 정해야 한다."
  - "메트릭 이름보다 더 위험한 것은 무제한 태그다. uri, userId, tenantId 같은 라벨 카디널리티를 초기에 통제해야 한다."
  - "Prometheus 연동의 목표는 대시보드가 아니라 조치 가능한 SLI/SLO와 알림 규칙까지 닫는 것이다."
operator_checklist:
  - "운영 프로필에서 /actuator/prometheus 접근 주체와 네트워크 경계를 확인한다."
  - "http.server.requests의 uri 태그가 템플릿 경로로 집계되는지 점검한다."
  - "P95 지연, 5xx 오류율, JVM/DB 커넥션 포화도를 기준으로 첫 알림 3개만 만든다."
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

- Spring Boot Actuator를 단순 상태 페이지가 아니라 운영 관측 진입점으로 설계하는 기준을 잡습니다.
- Prometheus가 가져갈 메트릭의 이름, 태그, 카디널리티를 서비스 관점으로 정리합니다.
- 대시보드·알림·장애 대응까지 이어지는 최소 APM 운영 체크리스트를 만듭니다.

Part 1에서 APM의 목적과 Golden Signals를 봤다면, 이번 글은 “그래서 우리 서비스에 무엇을 켜고 무엇을 감출 것인가?”에 답하는 편입니다. Actuator와 Prometheus 연동은 의존성 두 줄로 시작할 수 있지만, 운영 품질은 설정값보다 지표 설계에서 갈립니다. 특히 `/actuator/prometheus`를 외부에 그대로 열거나, 사용자 ID·주문 ID 같은 값을 태그로 넣으면 모니터링 시스템이 장애 원인이 될 수 있습니다.

핵심은 작게 시작하는 것입니다. 처음부터 수십 개 대시보드를 만들기보다, 요청 지연시간, 오류율, 트래픽, 포화도 네 축을 서비스 엔드포인트 기준으로 읽을 수 있게 만들고, 그중 실제로 사람을 깨울 알림만 남깁니다. 아래 예시는 Spring Boot 기준이지만, Micrometer를 쓰는 다른 JVM 서비스에도 거의 같은 방식으로 적용할 수 있습니다.

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

## 2-4) 운영에서 자주 망가지는 지점

### 1. `/actuator/health`와 `/actuator/prometheus`를 같은 경계로 다룬다

헬스 체크는 로드밸런서나 쿠버네티스가 자주 호출합니다. 반면 Prometheus 엔드포인트는 내부 관측 시스템만 접근해야 합니다. 둘을 모두 공개 인터넷에 열어 두면 빌드 버전, JVM 상태, 의존 시스템 이름 같은 운영 정보가 노출될 수 있습니다. 운영에서는 보통 다음처럼 나눕니다.

- `/actuator/health/liveness`: 프로세스가 살아 있는지만 확인, 세부 정보 비공개
- `/actuator/health/readiness`: 트래픽을 받을 준비가 됐는지 확인, 내부 네트워크에서만 상세 확인
- `/actuator/prometheus`: Prometheus 서버 또는 에이전트만 접근

이 구분을 하지 않으면 배포 중 일시적인 DB 지연이 liveness 실패로 이어져 컨테이너가 반복 재시작될 수 있습니다. 반대로 readiness가 너무 느슨하면 의존 시스템이 죽었는데도 트래픽을 계속 받아 사용자 오류가 늘어납니다.

### 2. 태그 카디널리티를 방치한다

Prometheus는 라벨 조합마다 별도 시계열을 만듭니다. `method=GET`, `status=200`, `uri=/orders/{id}` 정도는 안전하지만, `uri=/orders/123456`처럼 실제 ID가 들어가거나 `userId`를 태그로 넣으면 요청 수만큼 시계열이 폭증합니다. 처음에는 대시보드가 자세해 보여도, 며칠 지나면 저장소 비용과 쿼리 지연이 같이 올라갑니다.

권장 기준은 간단합니다. 알림과 의사결정에 쓰지 않을 값은 태그로 넣지 않습니다. 디버깅에 필요한 고유 ID는 메트릭 태그가 아니라 로그의 trace id, span id, request id로 남기고, 필요할 때 트레이스와 연결해 찾아갑니다.

### 3. 평균 응답시간만 본다

평균은 운영에서 가장 자주 오해되는 숫자입니다. 99명의 요청이 50ms이고 1명의 요청이 10초여도 평균은 꽤 멀쩡해 보일 수 있습니다. 사용자는 평균을 경험하지 않습니다. 느린 꼬리 지연을 경험합니다. 그래서 HTTP 지연시간은 최소한 P50, P95, P99를 함께 봐야 합니다.

처음 알림을 만들 때는 P95 기준이 현실적입니다. 예를 들어 “5분 동안 P95가 1초를 넘고 5xx 오류율이 1%를 넘으면 알림”처럼 지연과 오류를 같이 묶으면, 단순 트래픽 증가나 일시 튐으로 인한 알림 피로를 줄일 수 있습니다.

## 2-5) Prometheus 스크랩 설계 예시

서비스가 여러 개라면 Prometheus 설정도 서비스명, 환경, 클러스터를 공통 라벨로 맞춰야 합니다. 그래야 장애 때 “prod의 order-service만 느린가, 전체 JVM 서비스가 느린가?”를 빠르게 분리할 수 있습니다.

```yaml
scrape_configs:
  - job_name: "spring-apps"
    metrics_path: "/actuator/prometheus"
    scrape_interval: 15s
    static_configs:
      - targets:
          - "order-service:8080"
          - "payment-service:8080"
        labels:
          env: "prod"
          cluster: "main"
```

스크랩 주기는 무조건 짧게 잡지 않습니다. 1초 단위로 수집하면 더 정확해 보이지만, 메트릭 저장소와 애플리케이션 양쪽에 부담이 됩니다. 일반적인 백엔드 API는 15초 또는 30초로 시작하고, 배치·크론처럼 짧은 순간에 끝나는 작업은 별도 Counter와 완료 시각 Gauge를 두는 편이 낫습니다.

## 2-6) 첫 대시보드 구성

처음 만드는 Grafana 대시보드는 화려할 필요가 없습니다. 장애 대응자가 30초 안에 방향을 잡을 수 있으면 됩니다. 추천 순서는 다음입니다.

1. **트래픽**: 초당 요청 수, 주요 엔드포인트별 요청 수
2. **오류율**: 5xx 비율, 4xx 급증 여부, 예외 타입 상위 목록
3. **지연시간**: P50/P95/P99, 엔드포인트별 P95 상위 10개
4. **포화도**: CPU, JVM heap, GC pause, HikariCP active/pending connection
5. **의존성**: DB, Redis, 외부 API 호출 시간과 오류율

이 순서가 좋은 이유는 원인보다 사용자 영향을 먼저 보기 때문입니다. CPU가 90%여도 사용자 오류가 없다면 긴급도는 낮을 수 있습니다. 반대로 CPU는 낮아도 DB 커넥션 풀이 가득 차면 결제나 주문 같은 핵심 경로가 바로 막힐 수 있습니다.

## 2-7) 알림 규칙을 만들 때의 체크리스트

- **증상 기반 알림부터 만든다**: CPU보다 “사용자 요청 실패율”과 “P95 지연”이 먼저입니다.
- **기간 조건을 둔다**: 1분 튐은 대시보드에 남기고, 5분 이상 지속될 때 사람을 부릅니다.
- **서비스 중요도를 나눈다**: 결제, 로그인, 주문처럼 사용자 여정의 병목은 더 낮은 임계값을 둡니다.
- **알림 설명에 다음 행동을 적는다**: “Grafana 링크 확인 → 최근 배포 확인 → DB 커넥션 패널 확인”처럼 첫 3단계를 붙입니다.
- **배포 알림과 묶어 본다**: 새 버전 배포 직후 오류율이 오르면 코드 변경 가능성을 먼저 봅니다.

예시 알림 문장은 이렇게 쓰면 좋습니다. “prod order-service의 `/orders` P95가 10분 동안 1.2초 이상이고 5xx 오류율이 1%를 넘었습니다. 최근 배포와 DB 커넥션 풀 대기열을 먼저 확인하세요.” 숫자만 보내는 알림보다 훨씬 조치 가능성이 높습니다.

## 2-8) 운영 적용 순서

1. 개발 환경에서 Actuator와 Prometheus registry를 켜고 `/actuator/prometheus` 출력이 정상인지 확인합니다.
2. 운영에서는 엔드포인트 노출 범위를 `health,info,prometheus` 정도로 제한하고, 상세 health 정보는 내부 접근에서만 보이게 둡니다.
3. 기본 HTTP/JVM/DB 메트릭을 수집한 뒤, 비즈니스 Counter는 주문 생성, 결제 성공/실패처럼 “운영 판단에 쓰는 사건”만 추가합니다.
4. 대시보드는 Golden Signals 중심으로 만들고, 팀 회고 때 실제 장애 질문을 답할 수 있었는지 점검합니다.
5. 알림은 3개 이하로 시작해 한 달 동안 false positive를 줄입니다.

이렇게 접근하면 APM은 “예쁜 그래프 모음”이 아니라, 장애를 빨리 발견하고 원인을 좁히는 운영 도구가 됩니다.

---

> 📚 **다음 편:** [OpenTelemetry: 통합 관측 표준](/learning/deep-dive/deep-dive-opentelemetry/)

---

👈 **[이전 편: APM 기본 (Part 1: 개념과 도구)](/learning/deep-dive/deep-dive-apm-basics/)**
