---
title: "CQRS: 명령과 조회의 분리"
study_order: 1103
date: 2025-12-28
topic: "Architecture"
topic_icon: "🔀"
topic_description: "Command Query Responsibility Segregation 패턴과 구현"
tags: ["CQRS", "Architecture", "DDD", "Event Sourcing"]
categories: ["Architecture"]
draft: false
description: "CQRS 패턴의 개념, 읽기/쓰기 모델 분리, Event Sourcing과의 조합 가이드"
module: "architecture-mastery"
quizzes:
  - question: "CQRS(Command Query Responsibility Segregation) 패턴의 핵심 아이디어는?"
    options:
      - "모든 CRUD를 하나의 모델로 처리한다."
      - "쓰기(Command)와 읽기(Query)를 위한 모델을 분리하여 각각 최적화한다."
      - "데이터베이스를 사용하지 않는다."
      - "REST API 대신 GraphQL을 사용한다."
    answer: 1
    explanation: "전통적 CRUD는 같은 모델로 읽기/쓰기를 처리하지만, CQRS는 쓰기용 Write Model(정합성 최적화)과 읽기용 Read Model(조회 최적화)을 분리합니다."

  - question: "CQRS를 적용하기에 적합한 상황은?"
    options:
      - "단순한 CRUD 애플리케이션"
      - "읽기가 쓰기보다 압도적으로 많고, 복잡한 도메인 로직이 있으며, 다양한 조회 뷰가 필요한 경우"
      - "강한 일관성이 필수인 경우"
      - "팀 규모가 작고 빠른 개발이 필요한 경우"
    answer: 1
    explanation: "CQRS는 복잡성이 추가되므로, 읽기/쓰기 비율이 극단적이거나 조회 성능 요구사항이 높을 때 가치가 있습니다. 단순 CRUD에는 과도한 설계입니다."

  - question: "CQRS에서 Read Model을 동기화하는 일반적인 방법은?"
    options:
      - "직접 Write Model을 조회한다."
      - "도메인 이벤트를 발행하고, Projector가 이벤트를 수신하여 Read Model을 갱신한다."
      - "정해진 시간에 배치로 동기화한다."
      - "동기화하지 않는다."
    answer: 1
    explanation: "Command가 처리되면 OrderCreatedEvent 같은 도메인 이벤트를 발행하고, Projector(또는 Event Handler)가 이벤트를 받아 Read Model 테이블을 갱신합니다."

  - question: "Event Sourcing과 CQRS를 함께 사용할 때 '상태'를 어떻게 관리하는가?"
    options:
      - "현재 상태만 DB에 저장한다."
      - "모든 상태 변경을 이벤트로 저장(Event Store)하고, 이벤트를 재생(Replay)하여 현재 상태를 구성한다."
      - "상태를 저장하지 않는다."
      - "캐시에만 저장한다."
    answer: 1
    explanation: "Event Sourcing은 'OrderCreated → OrderPaid → OrderShipped' 같은 이벤트 시퀀스를 저장합니다. 현재 상태는 이벤트들을 순서대로 적용하여 재구성합니다."

  - question: "CQRS에서 Eventual Consistency(결과적 일관성)가 발생하는 이유는?"
    options:
      - "데이터베이스가 느려서"
      - "Command가 성공한 직후 Read Model이 아직 갱신되지 않았을 수 있기 때문 (비동기 동기화)"
      - "네트워크가 불안정해서"
      - "클라이언트 캐싱 때문"
    answer: 1
    explanation: "Command 처리 → 이벤트 발행 → Read Model 갱신은 비동기로 이루어지므로, 쓰기 직후 조회하면 아직 반영되지 않았을 수 있습니다. 이를 허용할 수 있는 시스템에 CQRS가 적합합니다."
---

## 이 글에서 얻는 것

- **CQRS 패턴**의 개념과 적용 시점을 이해합니다
- **Command**와 **Query** 모델을 분리하는 방법을 알아봅니다
- **Event Sourcing**과의 조합을 이해합니다

---

## CQRS란?

### 전통적인 CRUD

```mermaid
flowchart TB
    UI[UI Layer]
    
    UI --> Service[Service Layer]
    Service --> Repo[Repository]
    Repo --> DB[(Database)]
    
    UI -->|"Create/Read/Update/Delete"| Service
```

**문제**:
- 읽기와 쓰기의 요구사항이 다름
- 조회 최적화 ↔ 데이터 정합성 충돌
- 복잡한 도메인에서 모델 비대화

### CQRS (Command Query Responsibility Segregation)

```mermaid
flowchart TB
    subgraph "Command (쓰기)"
        CC[Command Controller]
        CH[Command Handler]
        WM[Write Model]
        WriteDB[(Write DB)]
        
        CC --> CH --> WM --> WriteDB
    end
    
    subgraph "Query (읽기)"
        QC[Query Controller]
        QH[Query Handler]
        RM[Read Model]
        ReadDB[(Read DB)]
        
        QC --> QH --> RM --> ReadDB
    end
    
    WriteDB -->|동기화| ReadDB
    
    style WM fill:#ffebee,stroke:#c62828
    style RM fill:#e8f5e9,stroke:#2e7d32
```

---

## 언제 CQRS를 적용하나?

### ✅ 적합한 경우

- 읽기/쓰기 비율이 극단적 (읽기 >> 쓰기)
- 복잡한 도메인 로직
- 조회 성능 요구사항이 높음
- 다양한 조회 뷰 필요

### ❌ 적합하지 않은 경우

- 단순 CRUD 애플리케이션
- 강한 일관성이 필수
- 팀이 복잡성을 감당할 준비가 안됨

---

## 구현: 단순 CQRS

### Command (쓰기)

```java
// Command 객체
@Getter @AllArgsConstructor
public class CreateOrderCommand {
    private String userId;
    private List<OrderItemDto> items;
    private String shippingAddress;
}

// Command Handler
@Service
public class OrderCommandHandler {
    
    @Autowired
    private OrderRepository orderRepository;
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    @Transactional
    public String handle(CreateOrderCommand command) {
        // 도메인 로직 실행
        Order order = Order.create(
            command.getUserId(),
            command.getItems(),
            command.getShippingAddress()
        );
        
        orderRepository.save(order);
        
        // 이벤트 발행 (Read Model 동기화용)
        eventPublisher.publishEvent(new OrderCreatedEvent(order));
        
        return order.getId();
    }
}

// Controller
@RestController
@RequestMapping("/api/orders")
public class OrderCommandController {
    
    @Autowired
    private OrderCommandHandler commandHandler;
    
    @PostMapping
    public ResponseEntity<String> createOrder(@RequestBody CreateOrderCommand command) {
        String orderId = commandHandler.handle(command);
        return ResponseEntity.ok(orderId);
    }
}
```

### Query (읽기)

```java
// Query 객체
@Getter @AllArgsConstructor
public class GetOrdersByUserQuery {
    private String userId;
    private int page;
    private int size;
}

// Read Model (조회 최적화된 DTO)
@Entity
@Table(name = "order_read_model")
public class OrderReadModel {
    @Id
    private String orderId;
    private String userId;
    private String userName;  // 역정규화
    private BigDecimal totalAmount;
    private String status;
    private int itemCount;
    private LocalDateTime createdAt;
}

// Query Handler
@Service
public class OrderQueryHandler {
    
    @Autowired
    private OrderReadModelRepository readModelRepository;
    
    @Transactional(readOnly = true)
    public Page<OrderReadModel> handle(GetOrdersByUserQuery query) {
        return readModelRepository.findByUserId(
            query.getUserId(),
            PageRequest.of(query.getPage(), query.getSize())
        );
    }
}

// Controller
@RestController
@RequestMapping("/api/orders")
public class OrderQueryController {
    
    @Autowired
    private OrderQueryHandler queryHandler;
    
    @GetMapping
    public Page<OrderReadModel> getOrders(
            @RequestParam String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        return queryHandler.handle(new GetOrdersByUserQuery(userId, page, size));
    }
}
```

### Read Model 동기화

```java
@Component
public class OrderReadModelProjector {
    
    @Autowired
    private OrderReadModelRepository readModelRepository;
    @Autowired
    private UserService userService;
    
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(OrderCreatedEvent event) {
        Order order = event.getOrder();
        User user = userService.findById(order.getUserId());
        
        OrderReadModel readModel = new OrderReadModel(
            order.getId(),
            order.getUserId(),
            user.getName(),  // 역정규화
            order.getTotalAmount(),
            order.getStatus().name(),
            order.getItems().size(),
            order.getCreatedAt()
        );
        
        readModelRepository.save(readModel);
    }
    
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(OrderStatusChangedEvent event) {
        readModelRepository.updateStatus(event.getOrderId(), event.getNewStatus());
    }
}
```

---

## Event Sourcing과 CQRS

### Event Sourcing이란?

```mermaid
flowchart TB
    subgraph "전통적 방식"
        S1[현재 상태만 저장]
        S1 --> DB1[(orders 테이블<br/>status=COMPLETED)]
    end
    
    subgraph "Event Sourcing"
        E1[OrderCreated]
        E2[OrderPaid]
        E3[OrderShipped]
        E4[OrderCompleted]
        
        E1 --> E2 --> E3 --> E4
        E4 --> DB2[(Event Store)]
    end
```

**상태 = 이벤트의 누적**

### Event Store 구현

```java
@Entity
@Table(name = "event_store")
public class StoredEvent {
    @Id
    private String eventId;
    private String aggregateId;
    private String aggregateType;
    private String eventType;
    private String payload;  // JSON
    private int version;
    private LocalDateTime occurredAt;
}

@Repository
public interface EventStoreRepository extends JpaRepository<StoredEvent, String> {
    List<StoredEvent> findByAggregateIdOrderByVersionAsc(String aggregateId);
}
```

### Aggregate 재구성

```java
public class Order {
    private String id;
    private String userId;
    private OrderStatus status;
    private List<DomainEvent> uncommittedEvents = new ArrayList<>();
    
    // Event로부터 상태 재구성
    public static Order fromEvents(List<DomainEvent> events) {
        Order order = new Order();
        for (DomainEvent event : events) {
            order.apply(event);
        }
        return order;
    }
    
    private void apply(DomainEvent event) {
        if (event instanceof OrderCreatedEvent e) {
            this.id = e.getOrderId();
            this.userId = e.getUserId();
            this.status = OrderStatus.CREATED;
        } else if (event instanceof OrderPaidEvent e) {
            this.status = OrderStatus.PAID;
        }
        // ... 다른 이벤트 핸들링
    }
    
    // 명령 처리
    public void pay(PaymentInfo paymentInfo) {
        if (this.status != OrderStatus.CREATED) {
            throw new IllegalStateException("Cannot pay");
        }
        
        OrderPaidEvent event = new OrderPaidEvent(this.id, paymentInfo);
        apply(event);
        uncommittedEvents.add(event);
    }
}
```

### CQRS + Event Sourcing 아키텍처

```mermaid
flowchart TB
    Command[Command] --> Aggregate[Aggregate]
    Aggregate --> ES[(Event Store)]
    
    ES --> Projector[Projector]
    
    Projector --> RM1[(Read Model 1<br/>주문 목록)]
    Projector --> RM2[(Read Model 2<br/>통계/리포트)]
    Projector --> RM3[(Read Model 3<br/>검색 엔진)]
    
    Query1[Query 1] --> RM1
    Query2[Query 2] --> RM2
    Query3[Query 3] --> RM3
```

---

## 데이터 일관성

### Eventual Consistency

```mermaid
sequenceDiagram
    participant Client
    participant Command
    participant EventStore
    participant Projector
    participant ReadModel
    
    Client->>Command: CreateOrder
    Command->>EventStore: OrderCreated 저장
    Command-->>Client: 201 Created
    
    Note over Projector: 비동기 처리
    EventStore->>Projector: OrderCreated
    Projector->>ReadModel: Read Model 갱신
    
    Client->>ReadModel: GetOrder (즉시 조회)
    ReadModel-->>Client: ❌ 아직 없음 (Eventually)
```

### 해결 전략

```java
// 1. 생성 후 ID 반환 → 클라이언트가 폴링
@PostMapping
public ResponseEntity<?> createOrder(@RequestBody CreateOrderCommand command) {
    String orderId = commandHandler.handle(command);
    return ResponseEntity.created(URI.create("/orders/" + orderId))
        .body(Map.of("orderId", orderId));
}

// 2. Read-your-writes 보장
@GetMapping("/{orderId}")
public OrderReadModel getOrder(@PathVariable String orderId) {
    // 먼저 Read Model 조회
    Optional<OrderReadModel> readModel = readModelRepository.findById(orderId);
    if (readModel.isPresent()) {
        return readModel.get();
    }
    
    // 없으면 Write Model에서 직접 조회 (폴백)
    Order order = orderRepository.findById(orderId).orElseThrow();
    return toReadModel(order);
}
```

---

## 요약

### CQRS 도입 체크리스트

| 고려사항 | 질문 |
|---------|------|
| 복잡도 | 팀이 감당할 수 있는가? |
| 읽기/쓰기 비율 | 읽기가 압도적으로 많은가? |
| 조회 요구사항 | 다양한 뷰가 필요한가? |
| 일관성 | Eventual Consistency 허용? |

### 적용 수준

| 수준 | 설명 |
|------|------|
| Level 1 | 코드 분리 (같은 DB) |
| Level 2 | Read Model 분리 |
| Level 3 | + Event Sourcing |

---

## 🔗 Related Deep Dive

- **[DDD 전술 설계](/learning/deep-dive/deep-dive-ddd-tactical/)**: Aggregate, Entity, Value Object.
- **분산 트랜잭션** *(준비 중)*: SAGA 패턴.
