---
title: "API Gateway: 마이크로서비스의 대문"
date: 2025-12-14
draft: false
topic: "Architecture"
tags: ["API Gateway", "Microservices", "Kong", "Spring Cloud Gateway", "Routing"]
categories: ["Backend Deep Dive"]
description: "왜 Gateway를 써야 하는가? 인증/라우팅/공통 관심사의 분리"
module: "resilience"
quizzes:
  - question: "API Gateway의 주요 역할로 올바르지 않은 것은?"
    options:
      - "클라이언트 요청을 적절한 백엔드 서비스로 라우팅"
      - "JWT 검증 등 인증/인가를 중앙에서 처리"
      - "각 마이크로서비스의 핵심 비즈니스 로직 처리"
      - "Rate Limiting, Circuit Breaker 같은 Resilience 패턴 적용"
    answer: 2
    explanation: "API Gateway는 횡단 관심사(인증, 라우팅, Rate Limiting)를 처리하는 곳입니다. 비즈니스 로직은 각 마이크로서비스 내부에서 처리해야 하며, Gateway가 비대해지면 'God Object' 안티패턴이 됩니다."

  - question: "Spring Cloud Gateway와 Nginx/Kong의 선택 기준으로 올바른 것은?"
    options:
      - "성능이 중요하면 무조건 Spring Cloud Gateway"
      - "복잡한 비즈니스 로직(동적 라우팅, DB 조회 기반 라우팅)이 필요하면 Spring Cloud Gateway, 단순 라우팅이면 Nginx/Kong"
      - "Java 프로젝트면 무조건 Nginx"
      - "둘 사이에 차이가 없다"
    answer: 1
    explanation: "Spring Cloud Gateway는 Java 기반이라 커스텀 필터 구현이 쉽습니다. Nginx/Kong은 C/Lua 기반으로 매우 빠르지만 복잡한 로직 구현이 어렵습니다."

  - question: "BFF(Backend For Frontend) 패턴을 사용하는 이유는?"
    options:
      - "단일 Gateway가 모든 클라이언트를 감당하기 때문"
      - "클라이언트 종류별(Web, Mobile, IoT)로 다른 데이터 형태나 최적화가 필요할 때, 각각에 맞는 Gateway를 분리하기 위해"
      - "Database를 분리하기 위해"
      - "테스트를 쉽게 하기 위해"
    answer: 1
    explanation: "Web은 풍부한 데이터가 필요하고, Mobile은 경량화된 데이터가 필요합니다. BFF 패턴으로 클라이언트별 Gateway를 분리하면 각각에 최적화된 API를 제공할 수 있습니다."

  - question: "API Gateway에서 인증(Auth Offloading)을 처리하면 어떤 이점이 있는가?"
    options:
      - "인증 로직을 각 서비스마다 중복 구현해야 한다."
      - "Gateway에서 JWT 검증을 한 번만 수행하고, 뒷단 서비스는 비즈니스 로직에만 집중할 수 있다."
      - "인증이 비활성화된다."
      - "성능이 저하된다."
    answer: 1
    explanation: "인증을 Gateway에서 중앙 처리하면 각 마이크로서비스에서 중복 구현할 필요가 없습니다. 서비스는 이미 검증된 요청만 받으므로 비즈니스 로직에 집중할 수 있습니다."

  - question: "Gateway Filter Chain의 처리 순서로 올바른 것은?"
    options:
      - "라우팅 → 인증 → Rate Limit → 로깅"
      - "인증(Token 검증) → Rate Limit 확인 → 라우팅 → 로깅/응답 변환"
      - "로깅 → 라우팅 → 인증 → Rate Limit"
      - "순서는 중요하지 않다"
    answer: 1
    explanation: "보통 인증이 가장 먼저(유효하지 않은 요청 조기 거부), 그 다음 Rate Limit(과부하 방지), 라우팅, 마지막으로 로깅/응답 변환 순서로 진행됩니다."
study_order: 502
---

## 🚪 1. 클라이언트가 모든 서비스를 다 알아야 할까?

MSA 환경에서 서비스가 100개가 넘는다고 칩시다.
쇼핑 앱이 주문 서버, 배송 서버, 회원 서버 주소를 다 알고 각각 호출해야 할까요?

**API Gateway**가 모든 요청을 받아 적절한 곳으로 배달해줍니다.

```mermaid
graph LR
    Client[모바일/웹 앱] --> GW[API Gateway]
    
    subgraph "Backend System"
    GW -->|/user| Auth[회원 서비스]
    GW -->|/order| Order[주문 서비스]
    GW -->|/pay| Pay[결제 서비스]
    end
    
    Note over GW: 인증(Auth), 로깅, 라우팅, Rate Limit 처리
```

---

## 🛡️ 2. Gateway의 핵심 역할

1. **Routing**: `/api/v1/user`는 User 서비스로, `/api/v1/order`는 Order 서비스로.
2. **Auth Offloading**: JWT 검증을 서비스마다 하지 않고, Gateway에서 **딱 한 번** 검증합니다. 뒷단 서비스는 비즈니스 로직에만 집중합니다.
3. **Protocol Translation**: 클라이언트는 HTTP로, 내부 서비스는 gRPC나 AMQP로 통신하게 변환해줍니다.
4. **Resilience**: Rate Limiting, Circuit Breaker를 앞단에서 적용합니다.

### 2-1. Gateway Filter Chain 시각화

Gateway는 단순한 프록시가 아니라, 요청/응답에 대한 **필터 파이프라인**입니다.

```mermaid
sequenceDiagram
    participant Client
    participant GW as API Gateway
    participant Auth as Auth Filter
    participant Rate as RateLimit Filter
    participant Service

    Client->>GW: Request
    GW->>Auth: 1. Validate Token
    Auth-->>GW: Token OK
    GW->>Rate: 2. Check Limit
    Rate-->>GW: Allowed
    
    GW->>Service: 3. Route Request
    Service-->>GW: Response
    
    GW->>GW: 4. Logging & Transform
    GW-->>Client: Final Response
```

---

## 🛠️ 3. 기술 스택: Nginx vs Java

### Spring Cloud Gateway (SCG)
- **장점**: Java/Spring 기반이라 커스텀 필터 짜기가 너무 쉽습니다. (DB 조회해서 동적 라우팅 등)
- **단점**: Nginx보다는 무겁습니다. (Netty 기반 비동기라 성능은 준수함)

### Nginx / Kong
- **장점**: 엄청 빠름. C/Lua 기반.
- **단점**: 커스텀 로직 넣기가 빡빡합니다(Lua 스크립팅 필요).

**선택 기준**:
- "복잡한 비즈니스 로직(동적 라우팅, 권한 체크)이 필요하다" -> **Spring Cloud Gateway**
- "그냥 빠르고 단순한 라우팅이면 된다" -> **Nginx/Kong**

---

## 4. BFF (Backend For Frontend) 패턴

Gateway가 너무 비대해지면(God Object) 관리가 힘듭니다.
그래서 클라이언트 별로 Gateway를 쪼개기도 합니다.

- **Web Gateway**: 데스크탑 웹용 풍부한 데이터 조합.
- **Mobile Gateway**: 모바일용 경량화 데이터.
- **IoT Gateway**: IoT 프로토콜(MQTT 등) 지원.

이를 **BFF (Backend For Frontend)** 패턴이라 합니다.

```mermaid
graph TD
    subgraph "Clients"
        Web[Web Browser]
        Mobile[Mobile App]
        IoT[IoT Device]
    end

    subgraph "BFF Gateways"
        WebGW[Web Gateway]
        MobileGW[Mobile Gateway]
        IoTGW[IoT Gateway]
    end

    subgraph "Microservices"
        SvcA[Service A]
        SvcB[Service B]
        SvcC[Service C]
    end

    Web --> WebGW
    Mobile --> MobileGW
    IoT --> IoTGW

    WebGW --> SvcA & SvcB
    MobileGW --> SvcA & SvcC
    IoTGW --> SvcA
```

## 요약

1. **단일 진입점**: 클라이언트는 Gateway 하나만 보면 된다.
2. **Cross-Cutting Concerns**: 인증, 로깅, 제한 등을 한 곳에서 처리한다.
3. **Offloading**: 뒷단 서비스들의 부담을 덜어준다.
