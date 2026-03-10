---
title: "관측성 베이스라인: 로그·메트릭·트레이스"
date: 2025-12-16
draft: false
topic: "Observability"
tags: ["Observability", "Logging", "Metrics", "Tracing", "Prometheus", "ELK", "OpenTelemetry", "Micrometer"]
categories: ["DevOps"]
description: "로그/메트릭/트레이스 3대 기둥과 Spring Boot 기반 기본 설정 가이드"
module: "ops-observability"
study_order: 330
---

## 이 글에서 얻는 것

- 로그/메트릭/트레이스가 각각 어떤 질문에 답하는지(무엇이/얼마나/왜) 구분할 수 있습니다.
- Spring 기반 서비스에 "운영 가능한 최소 관측성"을 붙이는 베이스라인(지표/로그/traceId)을 설계할 수 있습니다.
- 고카디널리티, 로그 폭발, 액추에이터 노출 같은 운영 함정을 피하는 기준이 생깁니다.

## 0) 관측성(Observability)은 "데이터로 디버깅"하는 능력

모니터링이 "알람을 받는 것"이라면,
관측성은 "알람 이후 원인을 좁혀가는 것"까지 포함합니다.

실무에서 자주 쓰는 질문 3가지:

| 질문 | 기둥 | 도구 예시 |
| :--- | :--- | :--- |
| 무엇이 일어났나? | **로그** | ELK, Loki, CloudWatch Logs |
| 얼마나/어느 정도인가? | **메트릭** | Prometheus, Datadog, CloudWatch Metrics |
| 왜 이런 경로로 실패/지연이 생겼나? | **트레이스** | Jaeger, Zipkin, Tempo |

> 세 기둥은 **상호 보완**입니다. 하나만으로는 원인 분석이 불완전합니다.

---

## 1) 로그: 사건의 맥락을 남긴다

### 1-1) 구조 로그(JSON)와 필드

텍스트 로그는 검색/집계가 어렵습니다. 구조 로그는 운영에서 큰 차이를 만듭니다.

**Spring Boot + Logback JSON 구조 로그 설정:**

```xml
<!-- logback-spring.xml -->
<configuration>
  <springProfile name="prod">
    <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
      <encoder class="net.logstash.logback.encoder.LogstashEncoder">
        <!-- 기본 필드: timestamp, level, logger_name, message, stack_trace -->
        <includeMdcKeyName>traceId</includeMdcKeyName>
        <includeMdcKeyName>spanId</includeMdcKeyName>
        <includeMdcKeyName>requestId</includeMdcKeyName>
        <!-- 민감정보 마스킹 -->
        <jsonGeneratorDecorator class="net.logstash.logback.mask.MaskingJsonGeneratorDecorator">
          <valueMask>
            <value>(?&lt;=password["\s:=]+)[\w]+</value>
            <mask>****</mask>
          </valueMask>
        </jsonGeneratorDecorator>
      </encoder>
    </appender>
    <root level="INFO">
      <appender-ref ref="JSON" />
    </root>
  </springProfile>
</configuration>
```

**출력 예시:**
```json
{
  "timestamp": "2025-12-16T10:30:15.123+09:00",
  "level": "ERROR",
  "logger_name": "c.e.o.OrderService",
  "message": "재고 부족으로 주문 실패",
  "traceId": "abc123def456",
  "spanId": "span789",
  "requestId": "req-001",
  "orderId": 12345,
  "productId": 678,
  "stack_trace": "java.lang.IllegalStateException: ..."
}
```

### 1-2) 로그 레벨 정책

| 레벨 | 용도 | 주의점 |
| :--- | :--- | :--- |
| **DEBUG** | 개발 중 흐름 추적 | prod에서 절대 활성화하지 않음. 필요시 일시적으로 특정 패키지만 |
| **INFO** | 정상 흐름 기록 (요청 시작/완료) | 과도하면 비용 폭발. 요청당 1~3줄이 적정 |
| **WARN** | 복구 가능한 이상 (재시도 성공, 폴백 사용) | 방치하면 어느새 수천 줄 → 반드시 주기적 리뷰 |
| **ERROR** | 복구 불가, 사용자 영향 | 모든 ERROR는 알람 후보. 무시되는 ERROR가 있으면 레벨 재조정 |

### 1-3) 실전 로그 안티패턴

```java
// ❌ 안티패턴 1: 무의미한 로그
log.info("메서드 진입");
log.info("메서드 종료");

// ❌ 안티패턴 2: 민감정보 노출
log.info("사용자 로그인: email={}, password={}", email, password);

// ❌ 안티패턴 3: 예외를 문자열로만
log.error("에러 발생: " + e.getMessage());  // 스택트레이스 유실!

// ✅ 올바른 패턴
log.info("주문 생성 완료 orderId={} userId={} amount={}", orderId, userId, amount);
log.error("주문 처리 실패 orderId={}", orderId, e);  // 예외 객체를 마지막 인자로
```

### 1-4) 수집 파이프라인 구성

```
┌─────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
│ App      │────▶│ Filebeat │────▶│ Logstash     │────▶│ Elastic  │
│ (JSON)   │     │ /FluentBit│    │ (파싱/변환)   │     │ Search   │
└─────────┘     └──────────┘     └──────────────┘     └──────────┘
                                                             │
                                                       ┌──────────┐
                                                       │ Kibana   │
                                                       │ (검색/시각화)│
                                                       └──────────┘
```

**경량 대안 (Loki 스택):**
```
App (JSON) → Promtail → Grafana Loki → Grafana
# Elasticsearch 대비 저장 비용 1/10, 인덱싱 오버헤드 없음
# 단점: 풀텍스트 검색 불가, 레이블 기반 필터링만
```

---

## 2) 메트릭: 서비스 건강을 숫자로 본다

메트릭은 알람의 기반입니다. 최소한 아래는 갖추는 게 좋습니다.

### 2-1) Golden Signals / RED / USE

| 프레임워크 | 대상 | 핵심 지표 |
| :--- | :--- | :--- |
| **Golden Signals** | 서비스 전반 | Latency, Traffic, Errors, Saturation |
| **RED** | 요청 기반 서비스 | Rate, Errors, Duration |
| **USE** | 인프라 리소스 | Utilization, Saturation, Errors |

> 서비스에는 RED, 인프라에는 USE를 쓰는 것이 실무 표준입니다.

### 2-2) Spring Boot + Micrometer + Prometheus 설정

**의존성:**
```groovy
// build.gradle
implementation 'org.springframework.boot:spring-boot-starter-actuator'
implementation 'io.micrometer:micrometer-registry-prometheus'
```

**application.yml:**
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, info, prometheus  # 필요한 것만 노출!
      base-path: /internal/actuator       # 기본 /actuator 대신 내부 경로
  endpoint:
    health:
      show-details: when-authorized       # 인증된 사용자만 상세 정보
    prometheus:
      enabled: true
  metrics:
    tags:
      application: ${spring.application.name}
      environment: ${spring.profiles.active:local}
    distribution:
      percentiles-histogram:
        http.server.requests: true         # 히스토그램 활성화 → p50/p95/p99 계산
      slo:
        http.server.requests: 50ms, 100ms, 200ms, 500ms, 1s  # SLO 버킷
```

**Actuator 보안 (필수):**
```java
@Configuration
@EnableWebSecurity
public class ActuatorSecurityConfig {
    @Bean
    public SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/internal/actuator/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/internal/actuator/health").permitAll()
                .requestMatchers("/internal/actuator/prometheus").hasIpAddress("10.0.0.0/8")
                .anyRequest().authenticated()
            )
            .build();
    }
}
```

### 2-3) 커스텀 비즈니스 메트릭

```java
@Service
@RequiredArgsConstructor
public class OrderService {
    private final MeterRegistry meterRegistry;
    private final Counter orderSuccessCounter;
    private final Counter orderFailCounter;
    
    public OrderService(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        this.orderSuccessCounter = Counter.builder("order.created")
            .tag("status", "success")
            .description("성공한 주문 수")
            .register(meterRegistry);
        this.orderFailCounter = Counter.builder("order.created")
            .tag("status", "fail")
            .description("실패한 주문 수")
            .register(meterRegistry);
    }
    
    public Order createOrder(OrderRequest request) {
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            Order order = processOrder(request);
            orderSuccessCounter.increment();
            // 주문 금액 분포 기록
            DistributionSummary.builder("order.amount")
                .baseUnit("won")
                .register(meterRegistry)
                .record(order.getTotalAmount());
            return order;
        } catch (Exception e) {
            orderFailCounter.increment();
            throw e;
        } finally {
            sample.stop(Timer.builder("order.processing.time")
                .description("주문 처리 소요 시간")
                .register(meterRegistry));
        }
    }
}
```

### 2-4) 실전 Prometheus 쿼리 (PromQL)

```promql
# 1. HTTP 요청 에러율 (5분 기준)
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
/ sum(rate(http_server_requests_seconds_count[5m]))

# 2. p95 응답 시간
histogram_quantile(0.95, sum(rate(http_server_requests_seconds_bucket[5m])) by (le, uri))

# 3. 분당 주문 수
sum(rate(order_created_total{status="success"}[1m])) * 60

# 4. HikariCP 커넥션 풀 사용률 (포화도)
hikaricp_connections_active / hikaricp_connections_max

# 5. JVM 힙 메모리 사용률
jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}
```

### 2-5) 메트릭 카디널리티 관리 (핵심 함정)

```java
// ❌ 절대 하지 말 것: 무한 카디널리티 label
meterRegistry.counter("api.request", "userId", userId);  
// userId가 100만이면 → 시계열 100만 개 → Prometheus OOM

// ❌ 위험: URL 경로를 그대로 label로
// /users/123, /users/456 → 무한 시계열

// ✅ 올바른 방법: 템플릿 경로 사용
meterRegistry.counter("api.request", "uri", "/users/{id}", "method", "GET");
```

**카디널리티 가이드라인:**
- label 값의 종류: 최대 **100개** 이내 (status, method, uri_template 정도)
- 시계열 총 수: 단일 서비스에서 **10만 개** 이하 유지
- 초과 시: Prometheus 메모리 폭발, 쿼리 타임아웃 발생

---

## 3) 트레이스: 분산 호출에서 "왜 느린지"를 찾는다

서비스가 여러 개(또는 외부 API, DB, Redis)를 부르면,
로그/메트릭만으로는 병목 지점을 찾기 어렵습니다.

### 3-1) 트레이스 구조: Trace → Span

```
Trace (traceId: abc123)
├── Span 1: API Gateway      [0ms ─────── 250ms]
│   ├── Span 2: OrderService  [10ms ──── 200ms]
│   │   ├── Span 3: DB Query  [20ms ─ 80ms]     ← 60ms
│   │   └── Span 4: Redis     [85ms ─ 90ms]     ← 5ms
│   └── Span 5: PaymentAPI    [205ms ── 240ms]  ← 35ms (외부 호출)
```

- **Trace**: 하나의 요청 전체 경로 (고유한 traceId)
- **Span**: 각 구간 (서비스 호출, DB 쿼리, HTTP 요청 등)
- **Parent-Child**: Span 간 계층으로 호출 경로를 표현

### 3-2) Spring Boot + OpenTelemetry 자동 계측

```groovy
// build.gradle
implementation 'io.micrometer:micrometer-tracing-bridge-otel'
implementation 'io.opentelemetry:opentelemetry-exporter-otlp'
```

```yaml
# application.yml
management:
  tracing:
    sampling:
      probability: 0.1  # 10% 샘플링 (프로덕션 권장)
  otlp:
    tracing:
      endpoint: http://otel-collector:4318/v1/traces
```

**Spring Boot 3.x에서는 Micrometer Tracing이 기본 통합**되어 있어, 별도 에이전트 없이 자동으로:
- HTTP 요청/응답에 traceId/spanId 전파
- RestClient, WebClient 호출에 자동 스팬 생성
- JPA/JDBC 쿼리에 자동 스팬 생성 (spring-boot-starter-data-jpa)

### 3-3) 샘플링 전략

| 전략 | 설명 | 적합 환경 |
| :--- | :--- | :--- |
| **확률 샘플링** | 요청의 N%만 수집 (예: 10%) | 트래픽 높은 서비스 |
| **Rate-Limited** | 초당 최대 N개만 수집 | 트래픽 변동 큰 서비스 |
| **Tail-Based** | 완료 후 느린/에러 요청 우선 수집 | 정밀 분석 필요 |
| **Head-Based** | 요청 시작 시 결정 | 가장 단순, 일반적 |

> **실무 권장**: Head-Based 10% + Error/Slow 요청은 100% 수집. Tail-Based가 이상적이지만 Collector에 버퍼 필요.

### 3-4) 커스텀 스팬 추가

```java
@Service
public class InventoryService {
    private final Tracer tracer;
    
    public boolean checkStock(Long productId, int quantity) {
        Span span = tracer.nextSpan().name("inventory.checkStock").start();
        try (Tracer.SpanInScope ws = tracer.withSpan(span)) {
            span.tag("productId", String.valueOf(productId));
            span.tag("requestedQty", String.valueOf(quantity));
            
            boolean available = inventoryRepository.checkAvailability(productId, quantity);
            span.tag("available", String.valueOf(available));
            
            if (!available) {
                span.event("stock_insufficient");  // 이벤트 기록
            }
            return available;
        } catch (Exception e) {
            span.error(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

---

## 4) 연결고리: traceId로 로그 ↔ 메트릭 ↔ 트레이스를 묶어라

관측성의 핵심은 "한 요청"을 데이터로 엮는 것입니다.

### 4-1) 실전 디버깅 플로우

```
1. 알람 발생: "주문 API p99 > 2초"
   └─ Prometheus 대시보드에서 확인

2. 언제부터?: 메트릭 그래프에서 시점 확인
   └─ 14:23부터 급증

3. 어떤 요청?: 트레이스에서 느린 요청 검색
   └─ Jaeger: service=order-service, minDuration=2s
   └─ traceId: abc123def456 발견

4. 무엇이 원인?: 트레이스 스팬 분석
   └─ DB 쿼리 스팬이 1.8초 (전체 2초 중 90%)

5. 상세 로그 확인: traceId로 필터링
   └─ Kibana: traceId="abc123def456"
   └─ "Slow query: SELECT * FROM orders WHERE ... (1823ms)"

6. 근본 원인: 인덱스 누락 → 풀 테이블 스캔
```

### 4-2) Exemplar: 메트릭에서 트레이스로 점프

```yaml
# Prometheus Exemplar 설정 (Grafana에서 메트릭 → 트레이스 연결)
management:
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true
  tracing:
    sampling:
      probability: 1.0  # exemplar를 위해 높은 샘플링 필요
```

Grafana에서 메트릭 그래프의 특정 포인트를 클릭하면 → 해당 시점의 traceId로 Jaeger/Tempo에 바로 이동.

---

## 5) 관측성 비용 관리

관측성 데이터는 **기하급수적으로 늘어납니다**. 비용 관리가 없으면 인프라비보다 관측비가 더 커집니다.

### 5-1) 비용 추정 공식

```
월간 로그 볼륨 = 서비스 수 × 인스턴스 수 × 요청/초 × 로그 줄/요청 × 평균 바이트/줄 × 86400 × 30

예시: 5개 서비스 × 3 인스턴스 × 100 RPS × 3줄 × 200B × 86400 × 30
    = 약 2.3TB/월
```

### 5-2) 비용 절감 전략

| 전략 | 효과 | 적용 방법 |
| :--- | :--- | :--- |
| **로그 레벨 정책** | 30~50% 감소 | prod에서 DEBUG 비활성화, INFO도 핵심만 |
| **샘플링** | 70~90% 감소 | 트레이스 10%, 정상 로그 필터링 |
| **보존 기간** | 저장 비용 감소 | 로그 30일, 메트릭 90일, 트레이스 14일 |
| **Cold Storage** | 80% 비용 절감 | 30일 이후 S3/GCS로 아카이빙 |
| **Loki 전환** | 인덱싱 비용 제거 | ES 대비 저장 비용 1/10 |

---

## 6) 운영에서 자주 하는 실수

| 실수 | 영향 | 해결 |
| :--- | :--- | :--- |
| `/actuator`를 외부에 노출 | 정보 노출, 공격면 증가 | 내부 네트워크 제한 + 인증 |
| 로그가 너무 많음 | 비용 폭발, 검색 느려짐 | 레벨 정책 + 샘플링 + Rate Limit |
| 메트릭 label에 userId | Prometheus OOM | 고카디널리티 label 금지 |
| 트레이스 100% 수집 | 네트워크/저장 비용 폭발 | 10% + 에러/슬로우 우선 |
| 알람 기준 없이 대시보드만 | 장애를 사후에 발견 | p99 > SLO, 에러율 > 1% 알람 설정 |
| 로그와 트레이스 연결 안 됨 | 디버깅 시 수동 검색 | traceId를 MDC에 자동 삽입 |

---

## 7) 관측성 부트스트랩 체크리스트

새 서비스를 만들 때, 아래를 Day 1에 적용하세요:

### Day 1 (필수)
- [ ] 구조 로그 (JSON) + traceId 자동 삽입
- [ ] Actuator + Prometheus 엔드포인트 (내부 네트워크만)
- [ ] HTTP p95/p99 + 에러율 + 처리량 메트릭
- [ ] JVM/GC/힙 메모리/스레드 기본 메트릭
- [ ] DB 커넥션 풀 사용량 (HikariCP)

### Week 1 (권장)
- [ ] 분산 트레이싱 (OpenTelemetry) + 샘플링 설정
- [ ] Grafana 대시보드: RED + JVM 한 화면
- [ ] 알람 3개: p99 > SLO, 에러율 > 1%, 커넥션 풀 > 80%

### Month 1 (심화)
- [ ] 커스텀 비즈니스 메트릭 (주문 수, 결제 성공률 등)
- [ ] Exemplar 연결 (메트릭 → 트레이스 점프)
- [ ] 로그 보존/아카이빙 정책 설정
- [ ] SLO 대시보드 + Error Budget 추적

---

## 연습 (추천)

1. Spring 로그에 `traceId`가 찍히게 만들고, "한 요청의 로그를 traceId로 묶어" 조회해보기
2. p95/p99 레이턴시/에러율/처리량 대시보드(한 화면)를 만들고, 알람 기준을 1개 정의해보기
3. 외부 API 호출/DB 쿼리 구간이 트레이스에 스팬으로 보이게 인스트루먼트해보기
4. 메트릭에 고카디널리티 label을 넣어보고, Prometheus 메모리 사용량 변화를 관찰해보기

---

## 관련 심화 학습

- [OpenTelemetry 실전](/learning/deep-dive/deep-dive-opentelemetry/) — 트레이싱/메트릭 통합 계측
- [Prometheus & Grafana](/learning/deep-dive/deep-dive-prometheus-grafana/) — 메트릭 수집/대시보드 구축
- [ELK 스택 구축](/learning/deep-dive/deep-dive-elk-stack/) — 로그 수집/분석 파이프라인
- [구조 로그 전략](/learning/deep-dive/deep-dive-structured-logging/) — JSON 로그 설계 심화
- [알람 설계와 노이즈 제거](/learning/deep-dive/deep-dive-observability-alarms/) — 효과적인 알림 전략
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) — 서비스 수준 목표
- [부하 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/) — 성능 기준선 측정
