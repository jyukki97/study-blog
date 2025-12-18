---
title: "분산 추적 심화: Zipkin/Jaeger로 마이크로서비스 디버깅"
date: 2025-12-12
draft: false
topic: "DevOps"
tags: ["Distributed Tracing", "Zipkin", "Jaeger", "OpenTelemetry", "Microservices"]
categories: ["Backend Deep Dive"]
description: "분산 추적으로 마이크로서비스 간 요청 흐름을 추적하고 병목을 찾는 방법"
module: "ops-observability"
study_order: 344
---

## 이 글에서 얻는 것

- **분산 추적**의 필요성을 이해합니다.
- **Zipkin/Jaeger**로 Trace를 수집합니다.
- **Span**을 분석하여 병목을 찾습니다.
- **Spring Cloud Sleuth**로 통합합니다.

## 1) 분산 추적이란?

```
사용자 요청 → Gateway → Service A → Service B → DB
                                  ↓
                             Service C → Cache

하나의 요청이 여러 서비스를 거치는 경로 추적!

Trace ID: abc-123 (전체 요청)
├─ Span 1: Gateway (100ms)
├─ Span 2: Service A (200ms)
│  ├─ Span 3: Service B (150ms)
│  └─ Span 4: Service C (100ms)
└─ Span 5: DB Query (50ms)
```

## 2) Zipkin 설정

```yaml
# docker-compose.yml
version: '3.8'

services:
  zipkin:
    image: openzipkin/zipkin
    ports:
      - "9411:9411"
```

**Spring Boot:**
```gradle
dependencies {
    implementation 'io.micrometer:micrometer-tracing-bridge-brave'
    implementation 'io.zipkin.reporter2:zipkin-reporter-brave'
}
```

```yaml
management:
  tracing:
    sampling:
      probability: 1.0  # 100% 샘플링 (개발), 운영: 0.1
  zipkin:
    tracing:
      endpoint: http://localhost:9411/api/v2/spans
```

## 3) Trace 분석

```
Zipkin UI (http://localhost:9411):

1. Trace 검색:
   - 서비스명, 시간 범위, 최소 duration

2. Trace 상세 보기:
   - 전체 Span 타임라인
   - 각 Span의 소요 시간
   - 병목 구간 파악

3. Dependencies:
   - 서비스 간 의존성 그래프
   - 호출 빈도
```

## 4) 커스텀 Span

```java
@Service
public class OrderService {

    @Autowired
    private Tracer tracer;

    public void processOrder(Order order) {
        // 커스텀 Span 생성
        Span span = tracer.nextSpan().name("process-payment");
        
        try (Tracer.SpanInScope ws = tracer.withSpan(span.start())) {
            // 작업 수행
            paymentService.process(order);
            
            // 태그 추가
            span.tag("order.id", order.getId().toString());
            span.tag("amount", order.getAmount().toString());
            
        } finally {
            span.end();
        }
    }
}
```

## 요약

- 분산 추적으로 요청 전체 경로 파악
- Trace = 전체 요청, Span = 각 단계
- Zipkin/Jaeger로 시각화
- 병목 구간 찾아 성능 최적화

## 다음 단계

- APM: `/learning/deep-dive/deep-dive-apm-basics/`
- 마이크로서비스 패턴: `/learning/deep-dive/deep-dive-microservices-patterns/`
