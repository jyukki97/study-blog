---
title: "Redis Streams로 이벤트 스트림 처리하기"
date: 2025-12-16
draft: false
topic: "Messaging"
tags: ["Redis", "Streams", "Consumer Group", "At-least-once", "Idempotency", "XADD", "PEL"]
categories: ["Backend Deep Dive"]
description: "Redis Streams 기본 개념부터 Consumer Group/PEL, 멱등 처리와 재처리(복구)까지: 작은 이벤트 파이프라인 설계"
module: "data-system"
study_order: 282
---

## 이 글에서 얻는 것

- Redis Streams가 "Redis로 Kafka 흉내"가 아니라, **작은 이벤트 파이프라인/워크큐**로 어디에 적합한지 판단할 수 있습니다.
- Consumer Group/PEL(Pending Entries List)의 의미를 이해하고, "컨슈머가 죽었을 때" 어떤 메시지가 어떻게 복구되는지 설명할 수 있습니다.
- at-least-once 처리에서 반드시 필요한 멱등성(idempotency)과 재처리 설계를 **Redis CLI와 Java 코드 예시**로 구현할 수 있습니다.

---

## 0) Redis Streams는 언제 쓰면 좋은가

Redis Streams는 보통 아래 같은 상황에서 강점이 있습니다.

- 트래픽/규모가 Kafka까지는 과한데, "이벤트 기반 처리"가 필요하다
- 같은 Redis를 이미 운영 중이고, 운영 복잡도를 크게 늘리고 싶지 않다
- 워크큐(비동기 작업) + 재처리(ack, pending)가 필요하다

반대로, 아래가 중요하면 Kafka 같은 로그 기반 시스템이 더 자연스러울 수 있습니다.

- 장기 보관(리플레이를 오랫동안 해야 함)
- 파티션 기반의 강한 확장/순서 제어
- 생태계(커넥터/스트림 처리/스키마 레지스트리 등)

### Kafka vs Redis Streams — 선택 기준 비교

| 기준 | Redis Streams | Apache Kafka |
|------|--------------|-------------|
| **내구성** | AOF/RDB 기반, 메모리 한계 | 디스크 로그, 장기 보관 |
| **처리량** | 수만~수십만 msg/s (단일 노드) | 수백만 msg/s (클러스터) |
| **파티션/순서** | 단일 스트림 내 순서 보장 | 파티션별 순서 보장 |
| **Consumer Group** | PEL + XCLAIM 기반 | Offset 커밋 기반 |
| **운영 복잡도** | Redis만 있으면 됨 (낮음) | ZK/KRaft + Broker (높음) |
| **리플레이** | XTRIM 이전 데이터 유실 | 보관 기간 내 자유 |
| **스키마 관리** | 없음 (field-value 자유) | Schema Registry 연동 |
| **적합 규모** | 중소규모 이벤트 파이프라인 | 대규모 데이터 스트리밍 |

> **판단 기준 한 줄**: "Kafka 클러스터를 따로 운영할 여력이 있는가?" → 아니면 Redis Streams가 더 현실적.

---

## 1) 핵심 모델: Append-only 로그 + Consumer Group

Streams는 append-only 로그입니다. 모든 메시지는 타임스탬프 기반 ID로 정렬되고, 한 번 추가되면 수정할 수 없습니다.

### 1-1) 내부 자료구조: Radix Tree + Listpack

Redis Streams는 내부적으로 **Radix Tree**(키: Stream ID의 상위 비트)와 **Listpack**(값: 실제 메시지 바이트)으로 구성됩니다.

```
Radix Tree
├── 1710000000000-*    → Listpack [msg1, msg2, ..., msgN]
├── 1710000001000-*    → Listpack [msg1, msg2, ...]
└── ...
```

- **Listpack**: 연속 메모리 블록으로 저장되어 캐시 효율이 높음
- 같은 밀리초 내 여러 메시지는 sequence number(0, 1, 2…)로 구분
- `stream-node-max-bytes`(기본 4KB)와 `stream-node-max-entries`(기본 100)로 Listpack 크기 제어

이 구조 덕분에 범위 조회(`XRANGE`)와 ID 기반 검색이 O(log N)으로 빠릅니다.

### 1-2) 기본 커맨드 실습 — Redis CLI

```bash
# 스트림에 이벤트 추가 (ID는 Redis가 자동 생성)
> XADD orders * orderId ORD-001 product "MacBook" qty 1
"1710000000000-0"

> XADD orders * orderId ORD-002 product "iPad" qty 2
"1710000000001-0"

# 스트림 길이 확인
> XLEN orders
(integer) 2

# 범위 조회 (전체)
> XRANGE orders - +
1) 1) "1710000000000-0"
   2) 1) "orderId" 2) "ORD-001" 3) "product" 4) "MacBook" 5) "qty" 6) "1"
2) 1) "1710000000001-0"
   2) 1) "orderId" 2) "ORD-002" 3) "product" 4) "iPad" 5) "qty" 6) "2"

# 특정 ID 이후만 조회
> XRANGE orders 1710000000001-0 +
# → ORD-002만 반환

# 역순 조회 (최신 1개)
> XREVRANGE orders + - COUNT 1
```

### 1-3) Consumer Group 생성과 소비

```bash
# Consumer Group 생성 (0 = 스트림 처음부터)
> XGROUP CREATE orders order-processors 0 MKSTREAM

# 컨슈머 worker-1이 새 메시지 읽기
> XREADGROUP GROUP order-processors worker-1 COUNT 10 BLOCK 5000 STREAMS orders >

# 처리 완료 후 ack
> XACK orders order-processors 1710000000000-0
```

- `>`: 아직 전달되지 않은 새 메시지만 가져옴
- `BLOCK 5000`: 5초간 대기 후 메시지 없으면 nil 반환 (long polling)
- 여러 컨슈머가 같은 그룹에 속하면 **round-robin**으로 분배

---

## 2) PEL(Pending Entries List): "처리 중" 목록이 핵심이다

Consumer Group은 "읽었지만 아직 ack되지 않은 메시지"를 PEL에 기록합니다.

### 2-1) PEL이 존재하는 이유

```
[Producer] ──XADD──► [Stream] ──XREADGROUP──► [Consumer]
                                                  │
                                              처리 중...
                                                  │
                                           ┌──────┴──────┐
                                           │    정상      │   장애
                                           │   XACK ✓    │   PEL에 남음
                                           └─────────────┘
```

- 컨슈머가 죽으면, PEL에 남은 메시지는 영원히 ack되지 않습니다
- 그래서 운영에서는 PEL을 주기적으로 관찰하고,
- 일정 시간 이상 처리되지 않은 메시지를 다른 컨슈머가 가져가도록 `XCLAIM`/`XAUTOCLAIM`을 설계합니다

### 2-2) PEL 상태 조회

```bash
# 그룹 전체 pending 요약
> XPENDING orders order-processors
1) (integer) 3              # pending 메시지 수
2) "1710000000000-0"         # 가장 오래된 pending ID
3) "1710000000002-0"         # 가장 새로운 pending ID
4) 1) 1) "worker-1"         # 컨슈머별 pending 수
      2) "2"
   2) 1) "worker-2"
      2) "1"

# 특정 컨슈머의 pending 상세 (최대 10개)
> XPENDING orders order-processors - + 10 worker-1
1) 1) "1710000000000-0"      # 메시지 ID
   2) "worker-1"             # 소유 컨슈머
   3) (integer) 300000       # idle 시간 (ms) — 300초 동안 ack 안 됨
   4) (integer) 1            # 전달 횟수
```

### 2-3) 재처리: XCLAIM vs XAUTOCLAIM

```bash
# 수동 재할당: 5분(300000ms) 이상 idle인 메시지를 worker-2로
> XCLAIM orders order-processors worker-2 300000 1710000000000-0

# 자동 재할당 (Redis 6.2+): 5분 이상 idle인 것을 자동으로
> XAUTOCLAIM orders order-processors worker-2 300000 0-0 COUNT 10
```

**XAUTOCLAIM vs XCLAIM 사용 기준**:

| 방식 | 장점 | 단점 | 적합 상황 |
|------|------|------|----------|
| XCLAIM | 특정 메시지 ID 지정 가능 | 알아야 할 ID를 먼저 조회해야 함 | 특정 메시지만 재처리 |
| XAUTOCLAIM | ID 몰라도 자동 스캔 | 대량 pending 시 스캔 비용 | 주기적 일괄 재처리 |

이게 Redis Streams가 "그냥 pub/sub"과 다른 가장 큰 차이입니다. Pub/Sub은 메시지를 놓치면 끝이지만, Streams는 PEL 덕분에 **"확인될 때까지 보관"** 합니다.

---

## 3) 처리 보장: at-least-once → 멱등 처리가 필수

Streams + Consumer Group은 기본적으로 at-least-once입니다.

- 네트워크/컨슈머 장애로 동일 메시지가 다시 전달될 수 있습니다.
- 따라서 "중복 처리되어도 안전"해야 합니다.

### 3-1) 멱등 전략 비교

| 전략 | 구현 난이도 | 적합 상황 |
|------|-----------|----------|
| **Redis SET + TTL** | 낮음 | 단기 중복 방지 (TTL 내) |
| **DB UNIQUE 제약** | 중간 | 영속 중복 방지 (주문/결제) |
| **처리 플래그 테이블** | 중간 | 다단계 처리 추적 |
| **Outbox 패턴** | 높음 | 트랜잭션 + 이벤트 발행 일관성 |

### 3-2) Redis SET 기반 멱등 처리 — Java 예시

```java
@Service
@RequiredArgsConstructor
public class OrderEventConsumer {

    private final StringRedisTemplate redis;
    private final OrderService orderService;

    /**
     * 멱등 키: orderId
     * TTL: 24시간 (재처리 윈도우 내 중복 차단)
     */
    public void process(MapRecord<String, String, String> record) {
        String orderId = record.getValue().get("orderId");
        String idempotencyKey = "processed:order:" + orderId;

        // 1) 이미 처리했으면 skip + ack
        Boolean alreadyProcessed = redis.opsForValue()
            .setIfAbsent(idempotencyKey, "1", Duration.ofHours(24));
        if (Boolean.FALSE.equals(alreadyProcessed)) {
            log.info("중복 메시지 skip: orderId={}", orderId);
            ack(record);
            return;
        }

        try {
            // 2) 비즈니스 로직
            orderService.fulfill(orderId);
            // 3) 성공 시 ack
            ack(record);
        } catch (Exception e) {
            // 실패 시 멱등 키 삭제 → 재처리 허용
            redis.delete(idempotencyKey);
            log.error("처리 실패, 재처리 대상: orderId={}", orderId, e);
        }
    }

    private void ack(MapRecord<String, String, String> record) {
        redis.opsForStream().acknowledge("orders", "order-processors", record.getId());
    }
}
```

### 3-3) DB UNIQUE 제약 기반 — JPA 예시

```java
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = "orderId"))
public class ProcessedEvent {
    @Id @GeneratedValue
    private Long id;

    @Column(nullable = false)
    private String orderId;

    private Instant processedAt;
}

// 사용: save 시 DataIntegrityViolationException → 중복으로 판단
@Transactional
public void processWithDbGuard(String orderId) {
    try {
        processedEventRepo.save(new ProcessedEvent(orderId, Instant.now()));
        orderService.fulfill(orderId);
    } catch (DataIntegrityViolationException e) {
        log.info("DB 유니크 제약으로 중복 차단: orderId={}", orderId);
    }
}
```

---

## 4) ID 전략: `*`와 비즈니스 키를 구분하라

### 4-1) Stream ID 구조

```
1710000000000-0
│              │
└── 밀리초 타임스탬프  └── 시퀀스 (같은 ms 내 구분)
```

- `*`로 생성하면 Redis 서버 시계 기반 자동 생성
- 커스텀 ID도 가능하지만, **단조증가** 해야 함 (이전 ID보다 커야 함)
- 비즈니스 중복 제거는 Stream ID가 아니라 **비즈니스 키(orderId 같은 것)** 로 하는 편이 안전합니다

### 4-2) 커스텀 ID를 쓰면 안 되는 경우

```bash
# ❌ 위험: 과거 타임스탬프 ID를 삽입하려고 하면 에러
> XADD orders 1700000000000-0 orderId ORD-OLD
(error) ERR The ID specified ... is equal or smaller than ...
```

Stream ID는 전달/재처리 추적에 유용하지만, "중복 처리 방지 키"로 쓰기에는 도메인 의미가 약합니다.

---

## 5) 백로그/보관: 무한 성장 방지(XTRIM)와 비용

Stream이 무한히 커지면 메모리가 터집니다.

### 5-1) XTRIM 전략

```bash
# 최대 10만 건 유지 (정확)
> XTRIM orders MAXLEN 100000

# 근사 트림 (더 빠름, ~100000 근처로)
> XTRIM orders MAXLEN ~ 100000

# ID 기반 트림: 특정 시점 이전 삭제 (Redis 6.2+)
> XTRIM orders MINID 1710000000000-0

# XADD 시 동시 트림 (쓰기+정리 원자적)
> XADD orders MAXLEN ~ 100000 * orderId ORD-003 product "AirPods" qty 1
```

### 5-2) 보관 정책 설계 가이드

| 시나리오 | 권장 정책 | 이유 |
|---------|----------|------|
| 실시간 알림 | MAXLEN ~ 10000 | 최신만 중요 |
| 주문 이벤트 | MINID (24h 전) | 재처리 윈도우 보장 |
| 감사 로그 | MAXLEN ~ 1000000 + 별도 아카이빙 | 장기 보관 필요 |

주의할 점:

- 너무 공격적으로 trim하면 "느린 컨슈머"가 필요한 메시지를 잃을 수 있습니다
- PEL에 있는 메시지도 트림되면 **데이터는 사라지지만 PEL 항목은 남음** → XACK 불가 → 수동 정리 필요
- "재처리 가능 기간"을 정의하고 그 안에서만 보관하는 게 현실적입니다

---

## 6) Spring Boot로 기본 소비자 구현하기

### 6-1) 의존성

```xml
<!-- build.gradle / pom.xml -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

### 6-2) StreamListener 기반 소비자

```java
@Configuration
public class RedisStreamConfig {

    @Bean
    public Subscription orderStreamSubscription(
            RedisConnectionFactory factory,
            OrderStreamListener listener) {

        var options = StreamMessageListenerContainer.StreamMessageListenerContainerOptions
            .builder()
            .pollTimeout(Duration.ofSeconds(2))
            .batchSize(10)
            .build();

        var container = StreamMessageListenerContainer.create(factory, options);

        // Consumer Group이 없으면 생성
        try {
            factory.getConnection().streamCommands()
                .xGroupCreate("orders".getBytes(), "order-processors",
                    ReadOffset.from("0"), true);
        } catch (RedisSystemException e) {
            // BUSYGROUP: 이미 존재
        }

        var subscription = container.receive(
            Consumer.from("order-processors", "worker-" + UUID.randomUUID()),
            StreamOffset.create("orders", ReadOffset.lastConsumed()),
            listener
        );

        container.start();
        return subscription;
    }
}

@Component
@Slf4j
public class OrderStreamListener
        implements StreamListener<String, MapRecord<String, String, String>> {

    @Autowired private StringRedisTemplate redis;
    @Autowired private OrderService orderService;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        String orderId = message.getValue().get("orderId");
        log.info("수신: streamId={}, orderId={}", message.getId(), orderId);

        try {
            orderService.fulfill(orderId);
            redis.opsForStream()
                .acknowledge("orders", "order-processors", message.getId());
            log.info("처리 완료 + ACK: orderId={}", orderId);
        } catch (Exception e) {
            log.error("처리 실패 (PEL에 남음): orderId={}", orderId, e);
            // ack하지 않으면 PEL에 남아 재처리 대상
        }
    }
}
```

### 6-3) Producer 코드

```java
@Service
@RequiredArgsConstructor
public class OrderEventProducer {

    private final StringRedisTemplate redis;

    public RecordId publish(String orderId, String product, int qty) {
        var record = StreamRecords.newRecord()
            .ofMap(Map.of(
                "orderId", orderId,
                "product", product,
                "qty", String.valueOf(qty),
                "timestamp", Instant.now().toString()
            ))
            .withStreamKey("orders");

        RecordId recordId = redis.opsForStream().add(record);
        log.info("이벤트 발행: streamId={}, orderId={}", recordId, orderId);
        return recordId;
    }
}
```

---

## 7) 운영 루틴(최소 세트)

### 7-1) 모니터링 핵심 지표

| 지표 | 확인 방법 | 경보 기준 (예시) |
|------|----------|----------------|
| **스트림 길이** | `XLEN orders` | > 100만 |
| **그룹 lag** | `XINFO GROUPS orders` → `lag` | > 10000 |
| **PEL 크기** | `XPENDING orders group` | > 100 |
| **최고 idle 시간** | `XPENDING ... - + 1` | > 5분 |
| **컨슈머 수** | `XINFO GROUPS orders` → `consumers` | < 기대값 |
| **메모리 사용** | `MEMORY USAGE orders` | > 500MB |

### 7-2) 운영 커맨드 치트시트

```bash
# 스트림 상세 정보
> XINFO STREAM orders FULL

# 그룹별 상태
> XINFO GROUPS orders

# 컨슈머별 상태
> XINFO CONSUMERS orders order-processors

# 죽은 컨슈머 삭제
> XGROUP DELCONSUMER orders order-processors dead-worker-1

# 그룹 오프셋 리셋 (주의: 전체 재처리)
> XGROUP SETID orders order-processors 0
```

### 7-3) 주기적 운영 체크리스트

- [ ] `XPENDING`으로 5분+ idle pending 확인 → XAUTOCLAIM 실행
- [ ] `XINFO CONSUMERS`로 비활성 컨슈머 정리 (DELCONSUMER)
- [ ] `XLEN` → 보관 정책 대비 비정상 증가 여부 확인
- [ ] `MEMORY USAGE` → 메모리 사용량 추세 확인
- [ ] 실패 처리: DLQ(별도 스트림)로 빼거나, 실패 횟수 기준으로 격리

Streams는 "큐를 만들고 끝"이 아니라, **재처리/관측 루프**가 있어야 안정적으로 운영됩니다.

---

## 8) 흔한 실수와 트러블슈팅

### 8-1) 안티패턴 5가지

| # | 실수 | 결과 | 해결 |
|---|------|------|------|
| 1 | XACK 없이 소비만 | PEL 무한 증가, 메모리 고갈 | 처리 후 반드시 XACK |
| 2 | XTRIM 없이 운영 | 스트림 크기 무한 증가 | XADD 시 MAXLEN ~ 옵션 |
| 3 | 단일 컨슈머에 BLOCK 없이 busy loop | CPU 100% | BLOCK 옵션 (1~5초) |
| 4 | Consumer Group 없이 XREAD만 사용 | 재처리 불가, ack 없음 | XREADGROUP 사용 |
| 5 | 죽은 컨슈머 방치 | PEL 증가, XCLAIM 불필요 | DELCONSUMER + XAUTOCLAIM |

### 8-2) 디버깅 시나리오

**"소비가 안 되는데 메시지는 쌓이고 있다"**

```bash
# 1) 그룹이 존재하는지 확인
> XINFO GROUPS orders

# 2) 컨슈머가 살아있는지 확인
> XINFO CONSUMERS orders order-processors
# → idle 시간이 매우 크면 죽은 컨슈머

# 3) 그룹의 last-delivered-id 확인
> XINFO GROUPS orders
# → last-delivered-id가 스트림 끝보다 훨씬 뒤면 정상
# → 같으면 소비자가 메시지를 가져가지 않는 것
```

---

## 연습(추천)

1. **기본 파이프라인**: 주문 이벤트 스트림 `orders`를 만들고 Producer/Consumer를 작성해보기(`XADD`/`XREADGROUP`/`XACK`)
2. **장애 시뮬레이션**: 컨슈머를 강제로 죽여 PEL에 메시지가 남는 것을 확인한 뒤, `XAUTOCLAIM`으로 재처리 루프를 만들어보기
3. **멱등성 검증**: `orderId`를 멱등 키로 잡고, 중복 메시지가 들어와도 결과가 한 번만 반영되게 만들어보기
4. **성능 측정**: `redis-benchmark`로 XADD 성능 측정 후, MAXLEN 옵션 유무에 따른 차이 관찰
5. **모니터링 구축**: Spring Boot Actuator + Micrometer로 stream lag/PEL 크기를 Prometheus 메트릭으로 노출해보기

---

## 관련 심화 학습

- [Redis Streams 심화](/learning/deep-dive/deep-dive-redis-streams-advanced/) — Consumer Group 고급 패턴, Lettuce 실무 코드, DLQ 설계
- [Redis 캐싱 전략](/learning/deep-dive/deep-dive-redis-caching/) — 캐시와 스트림의 역할 분리
- [Kafka Retry & DLQ](/learning/deep-dive/deep-dive-kafka-retry-dlq/) — 메시지 큐 간 패턴 비교
- [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/) — At-least-once 소비의 안전한 처리
- [Spring Batch와 스케줄링](/learning/deep-dive/deep-dive-spring-batch-scheduling/) — 스트림 소비 vs 배치 처리 선택 기준
