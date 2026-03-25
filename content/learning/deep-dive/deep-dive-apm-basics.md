---
title: "APM 기본 (Part 1: 개념과 도구)"
date: 2025-12-10
draft: false
topic: "DevOps"
tags: ["APM", "Monitoring", "Spring Boot Actuator", "Metrics", "Performance", "Micrometer", "Golden Signals"]
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

## 이 글에서 얻는 것

- **APM**(Application Performance Monitoring)이 무엇이고, 왜 필요한지 이해합니다.
- **핵심 메트릭**(응답 시간, 처리량, 오류율)을 모니터링할 수 있습니다.
- **Spring Boot Actuator**로 헬스 체크와 메트릭을 노출합니다.
- **분산 추적**의 기본 개념을 이해합니다.
- APM 도구 생태계를 비교하고 팀 상황에 맞는 도구를 선택할 수 있습니다.

---

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

### 로깅 vs 모니터링 vs 트레이싱 (관측 3대 신호)

운영 시스템을 이해하기 위한 세 가지 신호는 각각 다른 질문에 답합니다.

| 신호 | 질문 | 예시 | 도구 |
| :--- | :--- | :--- | :--- |
| **Logs (로그)** | "무슨 일이 일어났는가?" | `User alice login failed: bad password` | ELK, Loki |
| **Metrics (메트릭)** | "시스템이 얼마나 건강한가?" | `http_requests_total{status="500"} = 42` | Prometheus, Datadog |
| **Traces (트레이스)** | "이 요청이 어디서 느려졌는가?" | `OrderAPI → PaymentService (320ms) → DB (280ms)` | Jaeger, Tempo |

```
사용자 요청 하나를 추적한다고 생각해보세요:

[Metrics] → "지금 p95가 2초야, 뭔가 느려졌다" (감지)
[Traces]  → "느린 요청을 따라가보니 PaymentService에서 병목" (위치 파악)
[Logs]    → "PaymentService 로그: DB connection timeout" (원인 확인)

세 가지를 조합해야 문제를 빠르게 해결할 수 있습니다.
```

### APM이 없으면 생기는 일

실제 장애 시나리오를 비교해보겠습니다.

**APM 없는 팀:**
1. 고객 CS: "결제가 안 돼요" (발생 후 30분)
2. 개발팀: 서버 접속 → 로그 grep → "어디 로그를 봐야 하지?"
3. 2시간 후: "DB 커넥션 풀이 고갈됐었네"
4. 근본 원인: 슬로우 쿼리 하나가 커넥션을 점유

**APM 있는 팀:**
1. 알림: "결제 API p95 > 3초, 에러율 > 5%" (발생 즉시)
2. 대시보드: 커넥션 풀 사용률 100% 확인
3. 트레이스: 특정 쿼리가 8초 걸리는 것 확인
4. 5분 만에 슬로우 쿼리 인덱스 추가로 해결

---

## 1) APM 핵심 메트릭

### 1-1) Golden Signals (핵심 지표 4가지)

Google SRE 팀이 정의한 4가지 핵심 지표입니다. "이것만 모니터링해도 대부분의 문제를 감지할 수 있다"는 뜻입니다.

| Signal | 측정 대상 | 예시 지표 | 왜 중요한가 |
| :--- | :--- | :--- | :--- |
| **Latency** | 요청 처리 시간 | p50, p95, p99 | 사용자 체감 성능 |
| **Traffic** | 요청량 | RPS, RPM | 용량 계획 기준 |
| **Errors** | 실패한 요청 비율 | 5xx rate, timeout rate | 서비스 품질 |
| **Saturation** | 리소스 사용률 | CPU%, 커넥션 풀, 큐 길이 | 한계 예측 |

### 1-2) RED 메서드 vs USE 메서드

Golden Signals 외에 두 가지 프레임워크가 자주 쓰입니다. 대상이 다릅니다.

**RED 메서드** — 서비스(엔드포인트) 관점

| 항목 | 설명 | PromQL 예시 |
| :--- | :--- | :--- |
| **R**ate | 초당 요청 수 | `rate(http_server_requests_seconds_count[5m])` |
| **E**rrors | 초당 에러 수 | `rate(http_server_requests_seconds_count{status=~"5.."}[5m])` |
| **D**uration | 요청 처리 시간 | `histogram_quantile(0.95, rate(http_server_requests_seconds_bucket[5m]))` |

**USE 메서드** — 리소스(인프라) 관점

| 항목 | 설명 | 예시 |
| :--- | :--- | :--- |
| **U**tilization | 사용률 | CPU 70%, 메모리 80% |
| **S**aturation | 포화(큐/대기) | 스레드 풀 큐 길이, 디스크 I/O 대기 |
| **E**rrors | 리소스 에러 | 디스크 에러, 네트워크 패킷 손실 |

```
💡 실무 팁:
- 마이크로서비스 → RED로 서비스 상태 모니터링
- 인프라/DB/캐시 → USE로 리소스 상태 모니터링
- 둘 다 함께 보는 게 이상적
```

### 1-3) 주요 메트릭 상세

**응답 시간 (Response Time)**

```
평균 응답 시간: 200ms
P50 (중앙값): 150ms    ← 절반의 요청이 이 시간 내 완료
P95 (95 백분위수): 500ms  ← 중요!
P99: 1000ms             ← 꼬리 지연(tail latency)

P95가 높다 = 일부 사용자가 느린 경험

⚠️ "평균"의 함정:
  요청 100개 중 99개가 10ms, 1개가 9,010ms → 평균 100ms
  → "평균 100ms"는 정상처럼 보이지만, 1%는 9초를 기다림
  → 반드시 P95/P99를 함께 봐야 합니다.
```

**처리량 (Throughput)**

```
RPS (Requests Per Second): 초당 요청 수
TPM (Transactions Per Minute): 분당 트랜잭션 수

예:
- 평균 RPS: 100
- 피크 RPS: 500 (트래픽 급증 시)

용량 산정 공식 (Little's Law):
  동시 요청 수 = RPS × 평균 응답 시간(초)
  
  100 RPS × 0.2초 = 20 동시 요청
  → 스레드 풀 20개면 이론상 커버 (여유분 고려해 40~50)
```

**오류율 (Error Rate)**

```
오류율 = (실패한 요청 / 전체 요청) × 100

예:
- 전체 요청: 10,000
- 실패: 50
- 오류율: 0.5%

목표: 오류율 < 0.1% (SLA에 따라 다름)

⚠️ 주의:
  - 5xx만 세면 안 됩니다. 타임아웃(504), 서킷브레이커(503)도 에러입니다.
  - 4xx 중에서도 429(Rate Limit), 408(Timeout)은 서버 측 문제 징후입니다.
  - 비즈니스 에러(결제 실패 등)도 별도 카운터로 추적해야 합니다.
```

**리소스 사용률 임계값 가이드**

| 리소스 | 정상 | 경고 | 위험 | 측정 방법 |
| :--- | :--- | :--- | :--- | :--- |
| CPU | < 60% | 60~80% | > 80% | `system_cpu_usage` |
| 메모리(힙) | < 70% | 70~85% | > 85% | `jvm_memory_used_bytes / jvm_memory_max_bytes` |
| 커넥션 풀 | < 70% | 70~90% | > 90% | `hikaricp_connections_active / hikaricp_connections_max` |
| 스레드 풀 | < 60% | 60~80% | > 80% | `tomcat_threads_busy_threads / tomcat_threads_config_max_threads` |
| 디스크 | < 70% | 70~85% | > 85% | `disk_free_bytes` |

---

## 2) APM 도구 생태계 비교

### 상용 vs 오픈소스

| 기준 | Datadog | New Relic | Elastic APM | Grafana Stack |
| :--- | :--- | :--- | :--- | :--- |
| **유형** | SaaS | SaaS | Self-hosted/Cloud | Self-hosted/Cloud |
| **비용** | 호스트당 $31/월~ | 사용량 기반 | 무료(OSS) ~ Cloud | 무료(OSS) ~ Cloud |
| **장점** | 올인원, UX 최고 | AI 이상 탐지, NRQL | ELK 통합, 로그 강점 | 완전 오픈소스, 유연 |
| **단점** | 비쌈 | 가격 예측 어려움 | 리소스 많이 씀 | 직접 구축 필요 |
| **에이전트** | dd-agent | New Relic agent | elastic-apm-agent | OTel Collector |
| **추천 상황** | 예산 있는 중대형 팀 | AI 기반 분석 필요 | 이미 ELK 운영 중 | 벤더 락인 회피 |

### 오픈소스 Grafana Stack 구성도

```
┌──────────────────────────────────────────┐
│                Grafana                    │  ← 시각화/대시보드/알림
├───────────┬───────────┬──────────────────┤
│ Prometheus│   Loki    │     Tempo        │
│ (Metrics) │  (Logs)   │   (Traces)       │
├───────────┴───────────┴──────────────────┤
│          OpenTelemetry Collector          │  ← 수집/변환/라우팅
├──────────────────────────────────────────┤
│    Spring Boot + Micrometer + OTel SDK   │  ← 계측
└──────────────────────────────────────────┘
```

> 💡 **선택 가이드**: 초기 스타트업 → Grafana Stack(무료). 팀이 10명 이상이고 운영 인력이 부족하면 → Datadog/New Relic(관리형). 이미 ELK를 쓰고 있으면 → Elastic APM 추가.

---

## 3) Spring Boot Actuator 실전 설정

### 3-1) 의존성 및 기본 설정

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, prometheus, metrics, env
      base-path: /actuator
  endpoint:
    health:
      show-details: when_authorized   # 인증된 사용자에게만 상세 정보
      show-components: when_authorized
      probes:
        enabled: true                  # K8s liveness/readiness 프로브
  metrics:
    tags:
      application: ${spring.application.name}
      environment: ${spring.profiles.active:local}
    distribution:
      percentiles-histogram:
        http.server.requests: true     # 히스토그램 활성화 (p95/p99 계산용)
      percentiles:
        http.server.requests: 0.5, 0.95, 0.99
      sla:
        http.server.requests: 100ms, 500ms, 1s, 5s  # SLO 버킷
```

### 3-2) Actuator 보안 설정

운영 환경에서 Actuator 엔드포인트를 그대로 노출하면 **정보 유출 위험**이 있습니다.

```java
@Configuration
@EnableWebSecurity
public class ActuatorSecurityConfig {
    
    @Bean
    public SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/actuator/**")
            .authorizeHttpRequests(auth -> auth
                // health와 prometheus는 내부 네트워크에서 인증 없이 접근 가능
                .requestMatchers("/actuator/health/liveness").permitAll()
                .requestMatchers("/actuator/health/readiness").permitAll()
                .requestMatchers("/actuator/prometheus").hasIpAddress("10.0.0.0/8")
                // 나머지는 ADMIN 역할 필요
                .anyRequest().hasRole("ADMIN")
            )
            .httpBasic(Customizer.withDefaults())
            .build();
    }
}
```

> ⚠️ **운영 환경 필수 점검**: `/actuator/env`는 환경 변수(DB 비밀번호 등)가 노출될 수 있으므로 반드시 접근 제한하세요. 가능하면 Actuator를 별도 포트(management.server.port=9090)로 분리하는 것이 안전합니다.

### 3-3) 커스텀 Health Indicator

기본 헬스 체크(DB, Redis, Disk)만으로는 부족합니다. 비즈니스 의존성도 체크해야 합니다.

```java
@Component
public class PaymentGatewayHealthIndicator implements HealthIndicator {
    
    private final PaymentGatewayClient paymentClient;
    private final CircuitBreaker circuitBreaker;
    
    @Override
    public Health health() {
        try {
            // 결제 게이트웨이 ping (타임아웃 2초)
            PaymentStatus status = paymentClient.healthCheck();
            
            if (status.isHealthy()) {
                return Health.up()
                    .withDetail("gateway", "PG사 연동 정상")
                    .withDetail("latency_ms", status.getLatencyMs())
                    .build();
            }
            
            return Health.down()
                .withDetail("gateway", "PG사 응답 이상")
                .withDetail("reason", status.getReason())
                .build();
                
        } catch (Exception e) {
            return Health.down()
                .withDetail("gateway", "PG사 연결 불가")
                .withException(e)
                .build();
        }
    }
}
```

**결과 예시 (`/actuator/health`):**

```json
{
  "status": "UP",
  "components": {
    "db": { "status": "UP", "details": { "database": "PostgreSQL" } },
    "redis": { "status": "UP" },
    "paymentGateway": {
      "status": "UP",
      "details": { "gateway": "PG사 연동 정상", "latency_ms": 45 }
    }
  }
}
```

---

## 4) Micrometer 커스텀 메트릭 실전

### 4-1) 메트릭 타입별 활용

```java
@Component
@RequiredArgsConstructor
public class OrderMetrics {
    
    private final MeterRegistry registry;
    
    // === Counter: 누적 횟수 (증가만 가능) ===
    public void recordOrderCreated(String paymentMethod) {
        registry.counter("orders.created",
            "payment_method", paymentMethod,  // 결제수단별 분류
            "channel", "web"                  // 채널별 분류
        ).increment();
    }
    
    // === Gauge: 현재 값 (증감 가능) ===
    // AtomicInteger 등을 바인딩하면 현재 상태를 추적
    private final AtomicInteger activeOrders = new AtomicInteger(0);
    
    @PostConstruct
    public void initGauges() {
        Gauge.builder("orders.active", activeOrders, AtomicInteger::get)
            .description("현재 처리 중인 주문 수")
            .register(registry);
    }
    
    // === Timer: 실행 시간 측정 ===
    public <T> T measureOrderProcessing(Supplier<T> task) {
        return registry.timer("orders.processing.duration",
            "type", "sync"
        ).record(task);
    }
    
    // === DistributionSummary: 값의 분포 ===
    public void recordOrderAmount(double amount) {
        DistributionSummary.builder("orders.amount")
            .description("주문 금액 분포")
            .baseUnit("won")
            .publishPercentiles(0.5, 0.95, 0.99)
            .publishPercentileHistogram()
            .maximumExpectedValue(10_000_000.0)
            .register(registry)
            .record(amount);
    }
}
```

### 4-2) 히스토그램 vs 서머리: 언제 뭘 쓰나?

| 기준 | Histogram | Summary |
| :--- | :--- | :--- |
| Percentile 계산 | 서버 측 (PromQL) | 클라이언트 측 (앱 내) |
| 집계 가능 | ✅ 여러 인스턴스 합산 가능 | ❌ 인스턴스별로만 의미 있음 |
| 정확도 | 버킷 경계에 따라 근사 | 정확(windowed) |
| 추천 상황 | 다중 인스턴스 서비스 | 단일 인스턴스, 정밀도 필요 시 |

```
💡 실무 원칙: 대부분의 경우 Histogram을 쓰세요.
  - 서비스가 여러 인스턴스로 스케일되면 Summary는 합산할 수 없습니다.
  - publishPercentileHistogram()을 켜면 Prometheus에서 
    histogram_quantile()로 p95/p99를 구할 수 있습니다.
```

### 4-3) 카디널리티 관리 (지표 폭발 방지)

메트릭 태그(라벨)를 남용하면 시계열이 기하급수적으로 늘어나 Prometheus가 OOM됩니다.

```java
// ❌ 나쁜 예: 사용자 ID를 태그에 넣음 (카디널리티 폭발!)
registry.counter("api.requests", "user_id", userId);
// 사용자 100만명 × API 50개 = 5천만 시계열 → Prometheus 사망

// ✅ 좋은 예: 낮은 카디널리티 태그만 사용
registry.counter("api.requests", 
    "endpoint", "/api/orders",    // 50개 이내
    "method", "GET",              // 5종
    "status", "200"               // 10종 이내
);
// 50 × 5 × 10 = 2,500 시계열 → 안전
```

**카디널리티 안전 기준:**

| 태그 | 안전 범위 | 위험 신호 |
| :--- | :--- | :--- |
| endpoint | < 100 | URL에 path variable 포함 |
| status | < 20 | 커스텀 비즈니스 코드 수백 개 |
| user_id | ❌ 절대 금지 | 사용자 수 = 시계열 수 |
| request_id | ❌ 절대 금지 | 요청마다 새 시계열 생성 |

---

## 5) 대시보드 설계 원칙

### 5-1) 3계층 대시보드 전략

```
┌─────────────────────────────────────┐
│ Level 1: Overview (전체 서비스 상태)  │  ← NOC/온콜 엔지니어가 항상 보는 화면
│   - 전체 에러율, p95, 서비스 맵      │
├─────────────────────────────────────┤
│ Level 2: Service (개별 서비스 상세)   │  ← 문제 발생 시 드릴다운
│   - RED 메트릭, 엔드포인트별 분포     │
├─────────────────────────────────────┤
│ Level 3: Resource (인프라/리소스)     │  ← 병목 원인 파악
│   - CPU/메모리/GC/커넥션 풀/슬로우쿼리│
└─────────────────────────────────────┘
```

### 5-2) Level 1 대시보드에 반드시 포함할 패널

```
1. Traffic Light (Red/Yellow/Green)
   - 각 서비스의 에러율 기반 상태 신호등
   
2. p95 Latency 추이 (시계열 그래프)
   - 엔드포인트별 p95, SLO 라인과 겹쳐서 표시
   
3. Error Rate 추이
   - 5xx rate, 서킷브레이커 트립 횟수
   
4. Saturation 게이지
   - CPU, 힙 메모리, 커넥션 풀 사용률

5. 최근 배포/변경 이벤트 (Annotation)
   - 배포 시점을 그래프에 표시 → 성능 변화와 배포의 상관관계 파악
```

---

## 6) APM 도입 로드맵

모든 것을 한꺼번에 하려면 실패합니다. 단계별로 접근하세요.

### Day 1: 최소 관측성

```
✅ Spring Boot Actuator + Prometheus 엔드포인트 활성화
✅ /health, /prometheus 엔드포인트 확인
✅ Prometheus scrape 설정 추가
✅ Grafana에 Spring Boot 템플릿 대시보드 import (ID: 12900)
```

### Week 1: 핵심 메트릭 + 알림

```
✅ 커스텀 비즈니스 메트릭 3~5개 추가 (주문 수, 결제 성공률 등)
✅ SLO 기반 알림 2~3개 설정 (p95 > 1s, error rate > 1%)
✅ 커넥션 풀/스레드 풀 메트릭 대시보드 추가
✅ 구조 로깅(Structured Logging) 전환 시작
```

### Month 1: 전체 관측성 파이프라인

```
✅ 분산 트레이싱 도입 (OpenTelemetry + Tempo/Jaeger)
✅ Log ↔ Trace 연결 (traceId를 로그에 포함)
✅ 3계층 대시보드 완성
✅ 온콜 Runbook에 대시보드 링크 + 조치 가이드 포함
✅ 정기 리뷰: 월 1회 알림 품질 점검 (노이즈 비율 < 20%)
```

---

## 7) 흔한 실수와 안티패턴

| # | 안티패턴 | 왜 문제인가 | 올바른 접근 |
| :--- | :--- | :--- | :--- |
| 1 | 평균만 모니터링 | P99 문제를 놓침 | P95/P99 필수 |
| 2 | 모든 것에 알림 | Alert Fatigue → 무시 | SLO 기반 핵심 알림만 |
| 3 | 태그에 고카디널리티 값 | Prometheus OOM | user_id, request_id 금지 |
| 4 | Actuator 전체 공개 | 정보 유출 | 네트워크/인증 제한 |
| 5 | 메트릭만 보고 로그/트레이스 무시 | 원인 파악 불가 | 3대 신호 통합 |
| 6 | 배포 후 메트릭 확인 안 함 | 성능 저하 뒤늦게 발견 | 배포 이벤트 annotation + 자동 비교 |

---

## 운영 체크리스트

- [ ] Actuator + Prometheus 엔드포인트 활성화 및 보안 설정 완료
- [ ] Actuator를 별도 포트(management.server.port)로 분리했는가?
- [ ] Golden Signals 4가지가 대시보드에 모두 있는가?
- [ ] SLO 기반 알림이 2개 이상 설정되어 있는가?
- [ ] 커스텀 비즈니스 메트릭이 3개 이상인가?
- [ ] 카디널리티 검증: 태그 조합 시계열 수가 10,000 이하인가?
- [ ] 로그에 traceId가 포함되어 있는가?
- [ ] 배포 이벤트가 그래프에 annotation으로 표시되는가?
- [ ] 월 1회 알림 품질 리뷰를 하고 있는가?

---

## 관련 글

- [APM 기본 (Part 2: Actuator, Prometheus 연동)](/learning/deep-dive/deep-dive-apm-basics-part2/) — Prometheus 스크랩 설정, Grafana 대시보드 구축 실습
- [Prometheus & Grafana 모니터링](/learning/deep-dive/deep-dive-prometheus-grafana/) — PromQL 쿼리, 알림 규칙 상세
- [구조 로깅 전략](/learning/deep-dive/deep-dive-structured-logging/) — JSON 로그, MDC, 로그 레벨 설계
- [분산 트레이싱 심화](/learning/deep-dive/deep-dive-distributed-tracing-advanced/) — OpenTelemetry, 샘플링, 커스텀 Span
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — Metrics+Logs+Traces 통합 관측성 구축
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) — 서비스 수준 목표 설계
- [Observability Alarms](/learning/deep-dive/deep-dive-observability-alarms/) — 알림 설계, Runbook, 온콜 운영
- [커넥션 풀 관리](/learning/deep-dive/deep-dive-connection-pool/) — HikariCP 튜닝, 모니터링

---

👉 **[다음 편: APM 기본 (Part 2: Actuator, Prometheus 연동)](/learning/deep-dive/deep-dive-apm-basics-part2/)**
