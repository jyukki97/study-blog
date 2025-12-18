---
title: "API Gateway 설계: 마이크로서비스의 단일 진입점"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["API Gateway", "Microservices", "Kong", "Spring Cloud Gateway", "Routing"]
categories: ["Backend Deep Dive"]
description: "API Gateway로 라우팅, 인증, 속도 제한 등을 중앙 집중식으로 관리하는 방법"
module: "architecture"
study_order: 415
---

## 이 글에서 얻는 것

- **API Gateway**의 역할과 필요성을 이해합니다.
- **라우팅, 인증, 속도 제한** 기능을 구현합니다.
- **Spring Cloud Gateway**를 사용할 수 있습니다.
- **적절한 패턴**을 선택할 수 있습니다.

## 1) API Gateway란?

```
클라이언트 → API Gateway → 마이크로서비스들
                  ↓
              - 라우팅
              - 인증/인가
              - 속도 제한
              - 로드 밸런싱
              - 로깅
```

## 2) Spring Cloud Gateway

```java
@Configuration
public class GatewayConfig {

    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            // 사용자 서비스
            .route("user-service", r -> r
                .path("/api/users/**")
                .filters(f -> f
                    .stripPrefix(1)
                    .addRequestHeader("X-Gateway", "true"))
                .uri("lb://user-service"))
            
            // 주문 서비스
            .route("order-service", r -> r
                .path("/api/orders/**")
                .filters(f -> f.stripPrefix(1))
                .uri("lb://order-service"))
            
            .build();
    }
}
```

## 3) 인증 필터

```java
@Component
public class AuthenticationFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = exchange.getRequest()
            .getHeaders()
            .getFirst("Authorization");

        if (token == null || !isValidToken(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        return chain.filter(exchange);
    }
}
```

## 4) 속도 제한

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: rate-limited-route
          uri: lb://service
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10  # 초당 10개
                redis-rate-limiter.burstCapacity: 20
```

## 요약

- API Gateway: 마이크로서비스 단일 진입점
- 라우팅, 인증, 속도 제한 중앙 관리
- Spring Cloud Gateway로 구현
- 보안 및 성능 최적화

## 다음 단계

- 마이크로서비스: `/learning/deep-dive/deep-dive-microservices-patterns/`
- Service Mesh: `/learning/deep-dive/deep-dive-service-mesh-istio/`
