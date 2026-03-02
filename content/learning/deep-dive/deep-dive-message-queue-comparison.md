---
title: "메시지 큐 비교: Kafka vs RabbitMQ vs Redis"
study_order: 406
date: 2025-12-28
topic: "Distributed"
topic_icon: "📬"
topic_description: "Kafka, RabbitMQ, Redis Pub/Sub 비교와 선택 기준"
tags: ["Kafka", "RabbitMQ", "Redis", "Message Queue", "Pub/Sub"]
categories: ["Distributed"]
draft: false
description: "Kafka, RabbitMQ, Redis Streams의 아키텍처 차이와 선택 기준"
module: "distributed"
quizzes:
  - question: "Kafka, RabbitMQ, Redis Pub/Sub 중 대용량 로그/이벤트 스트리밍에 가장 적합한 것은?"
    options:
      - "Redis Pub/Sub"
      - "Kafka - 분산 로그 스토리지로 100만+ TPS, 메시지 영구 보관 및 Replay 가능"
      - "RabbitMQ"
      - "셋 다 동일"
    answer: 1
    explanation: "Kafka는 디스크에 메시지를 영구 저장하고, Consumer Group으로 병렬 처리하며, 과거 메시지도 재처리할 수 있습니다."

  - question: "RabbitMQ가 Kafka보다 유리한 상황은?"
    options:
      - "대용량 로그 수집"
      - "유연한 라우팅(Exchange 타입)이 필요하거나, 메시지 우선순위/ACK 기반 신뢰성이 중요한 작업 큐"
      - "초저지연이 필요할 때"
      - "메시지 유실이 허용될 때"
    answer: 1
    explanation: "RabbitMQ는 Direct/Topic/Fanout Exchange로 복잡한 라우팅이 가능하고, 이메일 발송 같은 신뢰성 있는 작업 큐에 적합합니다."

  - question: "Redis Pub/Sub의 가장 큰 제약은?"
    options:
      - "속도가 느리다."
      - "메시지가 저장되지 않아, 구독자가 없으면 메시지가 유실(Fire-and-Forget)"
      - "설정이 복잡하다."
      - "수평 확장이 안 된다."
    answer: 1
    explanation: "Redis Pub/Sub은 초저지연이지만 메시지를 저장하지 않습니다. 캐시 무효화 같은 임시 이벤트에 적합합니다."

  - question: "Kafka에서 메시지 Replay(재처리)가 가능한 이유는?"
    options:
      - "메모리에 저장해서"
      - "메시지를 디스크에 영구 저장하고, Consumer가 Offset을 직접 관리하여 원하는 시점부터 다시 읽을 수 있기 때문"
      - "RabbitMQ처럼 ACK를 사용해서"
      - "불가능하다"
    answer: 1
    explanation: "Kafka는 토픽의 메시지를 보관 기간 동안 삭제하지 않습니다. Offset을 되감으면 과거 데이터를 다시 처리할 수 있습니다."

  - question: "실무에서 Kafka, RabbitMQ, Redis를 함께 사용하는 하이브리드 패턴의 예는?"
    options:
      - "하나만 사용해야 한다."
      - "Redis: 캐시 무효화/실시간 알림, Kafka: 주문/결제 이벤트 로그, RabbitMQ: 이메일 발송 작업 큐"
      - "세 개를 같은 용도로 사용"
      - "불가능하다"
    answer: 1
    explanation: "각 시스템의 강점을 활용합니다. Redis는 초저지연, Kafka는 대용량+재처리, RabbitMQ는 유연한 라우팅과 작업 큐에 적합합니다."
---

## 이 글에서 얻는 것

- **Kafka, RabbitMQ, Redis Pub/Sub**의 핵심 차이를 이해합니다
- 각 시스템의 **적합한 사용 사례**를 알아봅니다
- 프로젝트에 맞는 **메시지 시스템 선택 기준**을 정립합니다

---

## 아키텍처 비교

### 전체 구조

```mermaid
flowchart TB
    subgraph Kafka["Apache Kafka"]
        direction TB
        KP[Producer] --> KB[Broker Cluster]
        KB --> KT[Topic/Partition]
        KT --> KC[Consumer Group]
        KT --> KS[(Log Storage)]
    end
    
    subgraph RabbitMQ["RabbitMQ"]
        direction TB
        RP[Producer] --> RE[Exchange]
        RE --> RQ[Queue]
        RQ --> RC[Consumer]
    end
    
    subgraph Redis["Redis Pub/Sub"]
        direction TB
        RedP[Publisher] --> RedC[Channel]
        RedC --> RedS1[Subscriber 1]
        RedC --> RedS2[Subscriber 2]
    end
    
    style Kafka fill:#e8f5e9,stroke:#2e7d32
    style RabbitMQ fill:#fff3e0,stroke:#ef6c00
    style Redis fill:#ffebee,stroke:#c62828
```

---

## Kafka

### 핵심 특징

```mermaid
flowchart LR
    subgraph Topic["Topic: orders"]
        P0["Partition 0\n[0,1,2,3,4...]"]
        P1["Partition 1\n[0,1,2,3,4...]"]
        P2["Partition 2\n[0,1,2,3,4...]"]
    end
    
    subgraph CG["Consumer Group"]
        C1[Consumer 1]
        C2[Consumer 2]
        C3[Consumer 3]
    end
    
    P0 --> C1
    P1 --> C2
    P2 --> C3
    
    style Topic fill:#e3f2fd,stroke:#1565c0
```

**특징:**
- **분산 로그 스토리지**: 메시지를 디스크에 영구 저장
- **Consumer Group**: 여러 Consumer가 병렬 처리
- **Offset 기반**: Consumer가 읽은 위치 직접 관리
- **Replay 가능**: 과거 메시지 재처리 가능

```java
// Kafka Producer
@Service
public class OrderProducer {
    
    @Autowired
    private KafkaTemplate<String, OrderEvent> kafkaTemplate;
    
    public void sendOrder(OrderEvent order) {
        kafkaTemplate.send("orders", order.getOrderId(), order);
    }
}

// Kafka Consumer
@Service
public class OrderConsumer {
    
    @KafkaListener(
        topics = "orders",
        groupId = "order-processor"
    )
    public void processOrder(OrderEvent order) {
        // 병렬 처리 (Partition 수만큼 Consumer 확장 가능)
        orderService.process(order);
    }
}
```

### 장점 / 단점

| 장점 | 단점 |
|-----|------|
| 초고처리량 (100만 TPS+) | 운영 복잡도 높음 |
| 메시지 영구 보관 | 단순 큐로는 과함 |
| Replay 가능 | 실시간 라우팅 제한적 |
| 수평 확장 용이 | 메시지 순서 (파티션 단위) |

---

## RabbitMQ

### 핵심 특징

```mermaid
flowchart LR
    P[Producer] --> E{Exchange}
    
    E -->|routing_key: order.*| Q1[orders.created]
    E -->|routing_key: order.*| Q2[orders.updated]
    E -->|routing_key: payment.*| Q3[payments]
    
    Q1 --> C1[Consumer 1]
    Q2 --> C2[Consumer 2]
    Q3 --> C3[Consumer 3]
    
    style E fill:#fff3e0,stroke:#ef6c00
```

**Exchange 타입:**

| Exchange | 라우팅 방식 | 사용 예 |
|----------|-----------|--------|
| Direct | Exact match | 특정 큐에 전달 |
| Topic | Pattern match | `order.*`, `#.error` |
| Fanout | 모든 큐에 복제 | 브로드캐스트 |
| Headers | Header 기반 | 복잡한 라우팅 |

```java
// RabbitMQ Publisher
@Service
public class NotificationPublisher {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void sendNotification(Notification notification) {
        rabbitTemplate.convertAndSend(
            "notifications.exchange",  // Exchange
            "user." + notification.getUserId(),  // Routing Key
            notification
        );
    }
}

// RabbitMQ Consumer
@Service
public class NotificationConsumer {
    
    @RabbitListener(queues = "user.notifications")
    public void handleNotification(Notification notification) {
        // 메시지 처리
        pushService.send(notification);
    }
}
```

### 장점 / 단점

| 장점 | 단점 |
|-----|------|
| 유연한 라우팅 | Kafka 대비 처리량 낮음 |
| 메시지 우선순위 | 메시지 영구 보관 X (기본) |
| ACK 기반 신뢰성 | 수평 확장 제한 |
| 플러그인 생태계 | 대용량에 부적합 |

---

## Redis Pub/Sub

### 핵심 특징

```mermaid
flowchart TB
    P1[Publisher 1] --> Ch[Channel: news]
    P2[Publisher 2] --> Ch
    
    Ch --> S1[Subscriber 1]
    Ch --> S2[Subscriber 2]
    Ch --> S3[Subscriber 3]
    
    Note1[⚠️ 구독자 없으면\n메시지 유실]
    
    style Ch fill:#ffebee,stroke:#c62828
    style Note1 fill:#fff9c4,stroke:#f9a825
```

**특징:**
- **Fire-and-Forget**: 메시지 저장 없음
- **실시간 전달**: 구독자에게 즉시 푸시
- **메시지 유실 가능**: 구독자 없으면 버려짐
- **초저지연**: 메모리 기반

```java
// Redis Pub/Sub Publisher
@Service
public class CacheInvalidator {
    
    @Autowired
    private StringRedisTemplate redisTemplate;
    
    public void invalidateCache(String key) {
        // 모든 서버에 캐시 무효화 알림
        redisTemplate.convertAndSend("cache:invalidate", key);
    }
}

// Redis Pub/Sub Subscriber
@Service
public class CacheListener {
    
    @Autowired
    private LocalCache localCache;
    
    @PostConstruct
    public void subscribe() {
        redisTemplate.getConnectionFactory()
            .getConnection()
            .subscribe((message, pattern) -> {
                String key = new String(message.getBody());
                localCache.evict(key);
            }, "cache:invalidate".getBytes());
    }
}
```

### Redis Streams (대안)

Redis 5.0+에서 Kafka 유사 기능 제공:

```java
// Redis Streams (영구 저장 + Consumer Group)
@Service
public class OrderStreamProducer {
    
    @Autowired
    private StringRedisTemplate redisTemplate;
    
    public void addOrder(Order order) {
        Map<String, String> message = Map.of(
            "orderId", order.getId(),
            "status", order.getStatus()
        );
        redisTemplate.opsForStream().add("orders", message);
    }
}
```

### 장점 / 단점

| 장점 | 단점 |
|-----|------|
| 초저지연 | 메시지 유실 가능 |
| 설정 간단 | 영구 저장 없음 |
| 기존 Redis 활용 | Consumer Group 없음 |
| 실시간 이벤트 | 대용량 부적합 |

---

## 선택 가이드

### 비교표

| 기준 | Kafka | RabbitMQ | Redis Pub/Sub |
|------|-------|----------|---------------|
| **처리량** | 100만+ TPS | 10만 TPS | 100만+ TPS |
| **지연시간** | 5~50ms | 1~10ms | <1ms |
| **메시지 보관** | ✅ 영구 | ⚠️ 선택적 | ❌ 없음 |
| **Replay** | ✅ 가능 | ❌ 불가 | ❌ 불가 |
| **라우팅** | ⚠️ 제한적 | ✅ 유연 | ⚠️ 패턴만 |
| **운영 복잡도** | 높음 | 중간 | 낮음 |
| **확장성** | ✅ 수평 | ⚠️ 제한 | ✅ 수평 |

### 사용 사례별 선택

```mermaid
flowchart TD
    Start["메시지 시스템 선택"] --> Q1{"대용량 로그/이벤트?"}
    
    Q1 -->|Yes| Kafka["Apache Kafka"]
    Q1 -->|No| Q2{"유연한 라우팅 필요?"}
    
    Q2 -->|Yes| RabbitMQ["RabbitMQ (Exchange)"]
    Q2 -->|No| Q3{"메시지 유실 허용?"}
    
    Q3 -->|Yes| Redis["Redis Pub/Sub"]
    Q3 -->|No| Q4{"간단한 큐만 필요?"}
    
    Q4 -->|Yes| RabbitMQ2[RabbitMQ / Redis Streams]
    Q4 -->|No| Kafka2[Apache Kafka]
    
    style Kafka fill:#e8f5e9,stroke:#2e7d32
    style Kafka2 fill:#e8f5e9,stroke:#2e7d32
    style RabbitMQ fill:#fff3e0,stroke:#ef6c00
    style RabbitMQ2 fill:#fff3e0,stroke:#ef6c00
    style Redis fill:#ffebee,stroke:#c62828
```

### 구체적 사용 사례

| 시스템 | 적합한 사용 사례 |
|--------|----------------|
| **Kafka** | 로그 집계, 이벤트 소싱, 스트림 처리, 데이터 파이프라인 |
| **RabbitMQ** | 작업 큐, 마이크로서비스 통신, 복잡한 라우팅, RPC |
| **Redis Pub/Sub** | 캐시 무효화, 실시간 알림, 임시 이벤트, 세션 동기화 |

---

## 실무 조합 패턴

### 하이브리드 아키텍처

```mermaid
flowchart TB
    subgraph Services
        API[API Server]
        Worker[Worker]
    end
    
    subgraph MessageSystems
        Redis[(Redis)]
        Kafka[(Kafka)]
        RabbitMQ[(RabbitMQ)]
    end
    
    API -->|실시간 알림| Redis
    API -->|주문 이벤트| Kafka
    Worker -->|작업 큐| RabbitMQ
    
    Kafka -->|로그 분석| Analytics[Analytics]
    RabbitMQ -->|Email 발송| EmailWorker[Email Worker]
    
    style Redis fill:#ffebee,stroke:#c62828
    style Kafka fill:#e8f5e9,stroke:#2e7d32
    style RabbitMQ fill:#fff3e0,stroke:#ef6c00
```

**실무 조합 예시:**
- **Redis**: 캐시 무효화, 실시간 채팅
- **Kafka**: 주문/결제 이벤트, 로그 수집
- **RabbitMQ**: 이메일 발송, 백그라운드 작업

---

## 요약

### 핵심 선택 기준

| 이걸 원하면 | 이걸 선택 |
|-----------|----------|
| 대용량 + 재처리 | **Kafka** |
| 유연한 라우팅 | **RabbitMQ** |
| 초저지연 + 단순 | **Redis Pub/Sub** |
| 작업 큐 + 신뢰성 | **RabbitMQ** |
| 이벤트 소싱 | **Kafka** |
| 캐시 동기화 | **Redis** |

---

## 🔗 Related Deep Dive

- **[Kafka 기본](/learning/deep-dive/deep-dive-kafka-foundations/)**: 토픽, 파티션, Consumer Group 시각화.
- **[Kafka 재시도/DLQ](/learning/deep-dive/deep-dive-kafka-retry-dlq/)**: 실패 처리 전략.
- **[Redis 캐싱](/learning/deep-dive/deep-dive-redis-caching/)**: 캐시 전략과 운영.
