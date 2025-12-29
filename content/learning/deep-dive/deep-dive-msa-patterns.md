---
title: "마이크로서비스 패턴: 분해, 통신, 데이터 관리"
date: 2025-12-29
draft: false
topic: "Architecture"
tags: ["MSA", "Microservices", "Architecture", "Spring Cloud", "Event-Driven"]
categories: ["Backend Deep Dive"]
description: "모놀리식에서 MSA로 전환할 때 알아야 할 분해 전략, 서비스 간 통신, 데이터 일관성 패턴"
module: "architecture"
study_order: 250
quizzes:
  - question: "모놀리식 아키텍처에서 마이크로서비스로 전환할 때 가장 먼저 고려해야 할 것은?"
    options:
      - "사용할 프레임워크와 언어"
      - "서비스 분해 기준(도메인 경계)과 조직 구조"
      - "배포 자동화 도구"
      - "데이터베이스 종류"
    answer: 1
    explanation: "Conway's Law에 따르면 시스템 구조는 조직 구조를 반영합니다. 도메인 경계(Bounded Context)를 먼저 식별하고, 팀 구조와 맞춰 서비스를 분해해야 합니다."

  - question: "마이크로서비스 간 동기 통신(Sync)과 비동기 통신(Async)의 트레이드오프로 올바른 것은?"
    options:
      - "동기 통신은 항상 비동기보다 빠르다."
      - "동기 통신은 구현이 간단하지만 서비스 간 강한 결합을 만들고, 비동기 통신은 느슨한 결합을 제공하지만 복잡도가 증가한다."
      - "비동기 통신은 실시간 응답이 필요할 때 사용한다."
      - "둘은 동일한 특성을 가진다."
    answer: 1
    explanation: "동기(REST/gRPC)는 직관적이지만 호출된 서비스가 다운되면 호출자도 영향받습니다. 비동기(Kafka/RabbitMQ)는 결합을 줄이지만 eventual consistency와 메시지 처리 복잡도가 추가됩니다."

  - question: "마이크로서비스에서 'Database per Service' 패턴을 적용하면 발생하는 주요 과제는?"
    options:
      - "데이터베이스 비용이 감소한다."
      - "서비스 간 데이터 일관성 유지가 어려워지고, 분산 트랜잭션이나 Saga 패턴 등이 필요하다."
      - "성능이 자동으로 향상된다."
      - "스키마 변경이 불가능해진다."
    answer: 1
    explanation: "각 서비스가 자체 DB를 가지면 독립성이 높아지지만, 여러 서비스에 걸친 트랜잭션은 ACID를 보장할 수 없습니다. Saga, Outbox Pattern 등으로 eventual consistency를 관리해야 합니다."

  - question: "API Gateway의 주요 역할이 아닌 것은?"
    options:
      - "클라이언트 요청 라우팅"
      - "인증/인가 처리"
      - "비즈니스 로직 처리"
      - "Rate Limiting 및 로드밸런싱"
    answer: 2
    explanation: "API Gateway는 인증, 라우팅, 로드밸런싱, Rate Limiting 같은 횡단 관심사를 처리합니다. 비즈니스 로직은 각 마이크로서비스 내부에서 처리해야 합니다."

  - question: "Service Discovery(서비스 디스커버리)가 필요한 이유는?"
    options:
      - "서비스 코드를 자동 생성하기 위해"
      - "동적으로 변하는 서비스 인스턴스의 위치(IP/Port)를 런타임에 찾기 위해"
      - "데이터베이스를 자동 백업하기 위해"
      - "로그를 수집하기 위해"
    answer: 1
    explanation: "컨테이너/클라우드 환경에서 서비스 인스턴스는 동적으로 생성/삭제됩니다. Eureka, Consul 같은 Service Discovery는 서비스 위치를 중앙 레지스트리에서 관리하여 다른 서비스가 동적으로 찾을 수 있게 합니다."
---

## 이 글에서 얻는 것

- **마이크로서비스 아키텍처**의 핵심 개념과 모놀리식 대비 장단점을 이해합니다.
- **서비스 분해 전략**과 도메인 경계를 정하는 방법을 익힙니다.
- **서비스 간 통신**(동기/비동기)과 데이터 일관성 패턴을 학습합니다.

---

## 1) 모놀리식 vs 마이크로서비스

### 모놀리식

```
┌─────────────────────────────────────────┐
│            단일 애플리케이션              │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐    │
│  │ 주문 │  │ 결제 │  │ 상품 │  │ 회원 │    │
│  └─────┘  └─────┘  └─────┘  └─────┘    │
│              ↓                          │
│         단일 데이터베이스                  │
└─────────────────────────────────────────┘
```

**장점**: 개발/배포 단순, 디버깅 용이, 트랜잭션 간단  
**단점**: 스케일링 어려움, 배포 단위 큼, 기술 스택 고정

### 마이크로서비스

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ 주문 서비스 │  │ 결제 서비스 │  │ 상품 서비스 │  │ 회원 서비스 │
│   (DB)   │  │   (DB)   │  │   (DB)   │  │   (DB)   │
└─────────┘  └─────────┘  └─────────┘  └─────────┘
      ↑            ↑            ↑            ↑
      └────────────┴────────────┴────────────┘
                 API Gateway / Message Queue
```

**장점**: 독립 배포/스케일링, 기술 다양성, 장애 격리  
**단점**: 분산 시스템 복잡도, 운영 부담, 데이터 일관성 어려움

---

## 2) 서비스 분해 전략

### 도메인 기반 분해 (DDD Bounded Context)

```mermaid
graph LR
    subgraph "주문 컨텍스트"
        Order[주문]
        OrderItem[주문항목]
    end
    
    subgraph "상품 컨텍스트"
        Product[상품]
        Inventory[재고]
    end
    
    subgraph "결제 컨텍스트"
        Payment[결제]
        Refund[환불]
    end
    
    Order --> Product
    Order --> Payment
```

### 분해 기준

- **비즈니스 능력(Business Capability)**: 조직이 수행하는 비즈니스 기능 단위
- **하위 도메인(Subdomain)**: DDD에서 식별한 Bounded Context
- **팀 구조**: Conway's Law - 시스템은 조직 구조를 반영

---

## 3) 서비스 간 통신

### 동기 통신 (Sync)

```java
// REST 호출
@Service
public class OrderService {
    
    @Autowired
    private RestTemplate restTemplate;
    
    public Order createOrder(OrderRequest request) {
        // 결제 서비스 동기 호출
        PaymentResponse payment = restTemplate.postForObject(
            "http://payment-service/api/payments",
            new PaymentRequest(request.getAmount()),
            PaymentResponse.class
        );
        
        if (!payment.isSuccess()) {
            throw new PaymentFailedException();
        }
        
        return orderRepository.save(new Order(request, payment));
    }
}
```

**장점**: 구현 단순, 즉시 응답  
**단점**: 강한 결합, 장애 전파, Timeout 관리 필요

### 비동기 통신 (Async)

```java
// 이벤트 발행
@Service
public class OrderService {
    
    @Autowired
    private KafkaTemplate<String, OrderEvent> kafkaTemplate;
    
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.save(new Order(request));
        
        // 이벤트 발행 (비동기)
        kafkaTemplate.send("order-events", 
            new OrderCreatedEvent(order.getId(), request));
        
        return order;  // 결제 완료를 기다리지 않음
    }
}

// 결제 서비스에서 이벤트 소비
@KafkaListener(topics = "order-events")
public void handleOrderCreated(OrderCreatedEvent event) {
    Payment payment = processPayment(event);
    kafkaTemplate.send("payment-events", 
        new PaymentCompletedEvent(event.getOrderId(), payment));
}
```

**장점**: 느슨한 결합, 장애 격리, 스케일링 유연  
**단점**: Eventual Consistency, 복잡한 에러 처리, 디버깅 어려움

---

## 4) 데이터 일관성 패턴

### Saga 패턴

```mermaid
sequenceDiagram
    participant Order
    participant Payment
    participant Inventory
    
    Order->>Payment: 결제 요청
    Payment-->>Order: 결제 성공
    Order->>Inventory: 재고 차감
    Inventory-->>Order: 차감 실패!
    
    Note over Order,Inventory: 보상 트랜잭션 시작
    Order->>Payment: 결제 취소 (보상)
    Payment-->>Order: 취소 완료
```

### Outbox 패턴

```java
// 트랜잭션 내에서 Outbox에 이벤트 저장
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = orderRepository.save(new Order(request));
    
    // 같은 트랜잭션에서 Outbox에 저장
    outboxRepository.save(new OutboxEvent(
        "ORDER_CREATED", 
        order.getId().toString(),
        objectMapper.writeValueAsString(new OrderCreatedEvent(order))
    ));
    
    return order;
}

// 별도 프로세스가 Outbox를 폴링하여 Kafka로 발행
@Scheduled(fixedDelay = 1000)
public void publishEvents() {
    List<OutboxEvent> events = outboxRepository.findUnpublished();
    for (OutboxEvent event : events) {
        kafkaTemplate.send(event.getType(), event.getPayload());
        event.markPublished();
        outboxRepository.save(event);
    }
}
```

---

## 5) 운영을 위한 필수 패턴

| 패턴 | 목적 | 예시 |
|------|------|------|
| **API Gateway** | 단일 진입점, 라우팅, 인증 | Spring Cloud Gateway, Kong |
| **Service Discovery** | 동적 서비스 위치 관리 | Eureka, Consul |
| **Config Server** | 중앙화된 설정 관리 | Spring Cloud Config |
| **Circuit Breaker** | 장애 전파 차단 | Resilience4j |
| **Distributed Tracing** | 요청 추적 | Zipkin, Jaeger |

---

## 요약

1. **모놀리식 vs MSA**: 상황에 맞게 선택 (작은 팀/프로젝트는 모놀리식이 유리할 수 있음)
2. **분해 전략**: 도메인 경계(Bounded Context)와 팀 구조 기반
3. **통신**: 동기(REST/gRPC)는 단순하지만 결합 강함, 비동기(이벤트)는 복잡하지만 유연
4. **데이터 일관성**: Database per Service는 Saga/Outbox 패턴 필요

---

## 다음 단계

- API Gateway 설계: `/learning/deep-dive/deep-dive-api-gateway-design/`
- 헥사고날 아키텍처: `/learning/deep-dive/deep-dive-hexagonal-architecture/`
- DDD 전술적 설계: `/learning/deep-dive/deep-dive-ddd-tactical/`
