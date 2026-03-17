---
title: "Redis Streams 심화: Backlog 관리와 재처리 전략"
date: 2025-12-16
draft: false
topic: "Redis"
tags: ["Redis", "Streams", "Consumer Group", "Backlog", "XCLAIM", "DLQ", "Lettuce"]
categories: ["Backend Deep Dive"]
description: "Pending 리스트 관리, 장애 시 재처리, 대량 backlog를 제어하는 Streams 운영 패턴 — Spring Boot + Lettuce 실무 코드 포함"
module: "data-system"
study_order: 285
---

## 이 글에서 얻는 것

- Redis Streams의 Consumer Group 모델과 PEL(Pending Entries List)이 무엇인지 이해하고, "왜 backlog가 쌓이는지" 설명할 수 있습니다.
- 장애/크래시 상황에서 pending 메시지를 재처리하는 방법(XPENDING/XCLAIM/XAUTOCLAIM)을 **실제 Java/Lettuce 코드**로 구현할 수 있습니다.
- 트림(MAXLEN/XTRIM), 멱등 처리, DLQ 설계, Prometheus 모니터링까지 갖춘 **"운영 가능한 스트림"**을 만들 수 있습니다.

---

## 0) Redis Streams를 한 문장으로

Redis Streams는 Redis 안에서 "로그처럼 append되는 메시지 스트림"을 제공하고,
Consumer Group으로 "협업 소비 + pending 관리"를 제공합니다.

Kafka와 비슷한 용어가 나오지만 운영 모델/내구성/관측 포인트는 다릅니다.
특히 **PEL(Pending Entries List)**을 이해하는 것이 Streams 운영의 핵심입니다.

### Kafka Streams vs Redis Streams — 언제 무엇을

| 기준 | Redis Streams | Kafka |
|------|-------------|-------|
| 메시지 볼륨 | 초당 수천~수만 건(단일 노드) | 초당 수십만~수백만 건(클러스터) |
| 내구성 | RDB/AOF 의존, 복제 가능 | 디스크 기반, 복제 팩터 설정 |
| Consumer Group | PEL 기반, XACK 필수 | 오프셋 커밋 기반 |
| 사용 시나리오 | 이벤트 큐/알림/실시간 피드 | 대규모 이벤트 스트리밍/로그 집계 |
| 운영 복잡도 | Redis 운영만으로 충분 | ZooKeeper/KRaft + 브로커 관리 |

**판단 기준**: 이미 Redis를 사용 중이고 볼륨이 적당하면 Streams가 간결합니다.
볼륨·내구성·파티셔닝이 핵심이면 Kafka를 선택합니다.

---

## 1) Consumer Group과 PEL — 내부 구조를 코드로 이해하기

### 1-1) 핵심 개념

Consumer Group에서 소비는 `XREADGROUP`으로 합니다.

1. 컨슈머가 메시지를 읽으면 → **PEL에 등록** (처리 중)
2. 처리가 끝나면 → `XACK`로 PEL에서 제거
3. ACK 없이 컨슈머가 죽으면 → **PEL에 영원히 남음**

```
[Producer] --XADD--> [Stream: mystream]
                           |
                    [Consumer Group: order-group]
                     /              \
              [consumer-1]     [consumer-2]
                  |                  |
              XREADGROUP         XREADGROUP
                  |                  |
              처리 → XACK       장애 → PEL에 잔류
```

### 1-2) 그룹/스트림 생성과 기본 소비 — Lettuce 코드

```java
@Configuration
public class RedisStreamConfig {

    @Bean
    public RedisConnectionFactory redisConnectionFactory() {
        LettuceConnectionFactory factory = new LettuceConnectionFactory("localhost", 6379);
        factory.afterPropertiesSet();
        return factory;
    }

    @Bean
    public StringRedisTemplate redisTemplate(RedisConnectionFactory factory) {
        return new StringRedisTemplate(factory);
    }

    /**
     * 애플리케이션 시작 시 스트림 & 그룹 생성 (없으면 생성)
     */
    @Bean
    public ApplicationRunner streamGroupInitializer(StringRedisTemplate redis) {
        return args -> {
            String streamKey = "order-events";
            String groupName = "order-group";
            try {
                // 그룹 생성 (스트림이 없으면 MKSTREAM으로 자동 생성)
                redis.opsForStream().createGroup(streamKey,
                    ReadOffset.from("0"), groupName);
            } catch (RedisSystemException e) {
                // BUSYGROUP: 이미 존재하면 무시
                if (!e.getMessage().contains("BUSYGROUP")) throw e;
            }
        };
    }
}
```

### 1-3) 메시지 발행과 소비

```java
@Service
@RequiredArgsConstructor
public class OrderEventProducer {
    private final StringRedisTemplate redis;

    /**
     * 주문 이벤트 발행 — MAXLEN ~10000으로 자동 트림
     */
    public RecordId publish(String orderId, String eventType, String payload) {
        Map<String, String> fields = Map.of(
            "orderId", orderId,
            "eventType", eventType,
            "payload", payload,
            "timestamp", Instant.now().toString()
        );
        // XADD order-events MAXLEN ~ 10000 * field1 val1 ...
        StringRecord record = StreamRecords.string(fields)
            .withStreamKey("order-events");
        return redis.opsForStream().add(record);
    }
}
```

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class OrderEventConsumer implements StreamListener<String, MapRecord<String, String, String>> {
    private final StringRedisTemplate redis;
    private final OrderProcessingService processingService;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        String orderId = message.getValue().get("orderId");
        String eventType = message.getValue().get("eventType");
        try {
            processingService.process(orderId, eventType, message.getValue());
            // 처리 성공 → ACK
            redis.opsForStream().acknowledge("order-events", "order-group", message.getId());
            log.info("ACK 완료: messageId={}, orderId={}", message.getId(), orderId);
        } catch (Exception e) {
            // ACK하지 않으면 PEL에 남음 → 재처리 대상
            log.error("처리 실패 (PEL 잔류): messageId={}, error={}",
                message.getId(), e.getMessage());
        }
    }
}
```

### 1-4) Spring Boot StreamMessageListenerContainer 설정

```java
@Configuration
public class StreamListenerConfig {

    @Bean
    public Subscription orderStreamSubscription(
            RedisConnectionFactory factory,
            OrderEventConsumer consumer) {

        var options = StreamMessageListenerContainer.StreamMessageListenerContainerOptions
            .builder()
            .pollTimeout(Duration.ofSeconds(2))
            .batchSize(10)
            .targetType(String.class)
            .build();

        var container = StreamMessageListenerContainer.create(factory, options);

        // Consumer Group 모드: ">" = 아직 전달되지 않은 새 메시지만
        Subscription subscription = container.receive(
            Consumer.from("order-group", "consumer-" + UUID.randomUUID().toString().substring(0, 8)),
            StreamOffset.create("order-events", ReadOffset.lastConsumed()),
            consumer
        );
        container.start();
        return subscription;
    }
}
```

---

## 2) 모니터링의 출발점: XPENDING + XINFO

### 2-1) CLI로 상태 확인

```bash
# 그룹의 pending 요약
XPENDING order-events order-group
# → 1) (integer) 42        ← pending 총 수
#   2) "1670000000000-0"    ← 가장 오래된 pending ID
#   3) "1670000099999-0"    ← 가장 최근 pending ID
#   4) 1) 1) "consumer-1"  2) "30"
#      2) 1) "consumer-2"  2) "12"

# 상세: idle time이 60초 이상인 pending 10개
XPENDING order-events order-group IDLE 60000 - + 10

# 그룹/컨슈머 상태
XINFO GROUPS order-events
XINFO CONSUMERS order-events order-group
```

### 2-2) Prometheus 모니터링 — Micrometer 커스텀 메트릭

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class StreamMetricsCollector {
    private final StringRedisTemplate redis;
    private final MeterRegistry meterRegistry;

    /**
     * 30초마다 PEL 상태를 Prometheus로 노출
     */
    @Scheduled(fixedRate = 30_000)
    public void collectPendingMetrics() {
        try {
            PendingMessagesSummary summary = redis.opsForStream()
                .pending("order-events", "order-group");

            if (summary != null) {
                // 전체 pending 수
                meterRegistry.gauge("redis.stream.pending.total",
                    Tags.of("stream", "order-events", "group", "order-group"),
                    summary.getTotalPendingMessages());

                // 컨슈머별 pending 수
                summary.getPendingMessagesPerConsumer().forEach((consumer, count) ->
                    meterRegistry.gauge("redis.stream.pending.consumer",
                        Tags.of("stream", "order-events",
                                "group", "order-group",
                                "consumer", consumer),
                        count)
                );
            }

            // 스트림 길이
            Long length = redis.opsForStream().size("order-events");
            meterRegistry.gauge("redis.stream.length",
                Tags.of("stream", "order-events"),
                length != null ? length : 0);

        } catch (Exception e) {
            log.warn("스트림 메트릭 수집 실패: {}", e.getMessage());
        }
    }
}
```

### 2-3) 핵심 PromQL 쿼리 & 알람 기준

```yaml
# Grafana 알람 규칙
groups:
  - name: redis-streams
    rules:
      # PEL이 1000건 이상이면 Warning
      - alert: StreamPendingHigh
        expr: redis_stream_pending_total > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis Stream PEL 적체 ({{ $labels.stream }})"
          description: "pending={{ $value }} (5분 지속)"

      # PEL이 5000건 이상이면 Critical
      - alert: StreamPendingCritical
        expr: redis_stream_pending_total > 5000
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Redis Stream PEL 임계 초과 ({{ $labels.stream }})"

      # 특정 컨슈머에 pending 집중 (전체의 80% 이상)
      - alert: StreamConsumerHotspot
        expr: >
          redis_stream_pending_consumer
          / ignoring(consumer) group_left
            redis_stream_pending_total > 0.8
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "컨슈머 핫스팟 감지: {{ $labels.consumer }}"
```

---

## 3) 재처리 전략: XCLAIM / XAUTOCLAIM — 실무 구현

### 3-1) XCLAIM(명시적 클레임)

```bash
# idle이 60초 이상인 메시지를 consumer-recovery로 이관
XCLAIM order-events order-group consumer-recovery 60000 1670000000000-0 1670000001000-0
```

사용 시점:
- 특정 메시지 ID를 알고 있을 때
- 관리자가 수동으로 재할당할 때

### 3-2) XAUTOCLAIM(자동 클레임) — Redis 6.2+

```bash
# idle 60초 이상인 pending을 최대 100개 자동 클레임
XAUTOCLAIM order-events order-group consumer-recovery 60000 0-0 COUNT 100
# → 1) "1670000050000-0"   ← 다음 스캔 시작점
#   2) (메시지 목록)
#   3) (삭제된 ID 목록)
```

### 3-3) Spring Boot 자동 복구 스케줄러

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class PendingRecoveryScheduler {
    private final StringRedisTemplate redis;
    private final OrderProcessingService processingService;

    private static final String STREAM_KEY = "order-events";
    private static final String GROUP = "order-group";
    private static final String RECOVERY_CONSUMER = "recovery-worker";
    private static final Duration MIN_IDLE = Duration.ofMinutes(2);
    private static final int MAX_RETRY = 5;
    private static final int BATCH_SIZE = 50;

    /**
     * 1분마다 idle pending 메시지를 자동 클레임 + 재처리
     */
    @Scheduled(fixedRate = 60_000)
    public void recoverPendingMessages() {
        String cursor = "0-0";

        while (true) {
            // XAUTOCLAIM으로 idle 메시지 배치 가져오기
            List<MapRecord<String, Object, Object>> claimed = xautoclaim(cursor);
            if (claimed == null || claimed.isEmpty()) break;

            for (var record : claimed) {
                int deliveryCount = getDeliveryCount(record.getId());

                if (deliveryCount > MAX_RETRY) {
                    // DLQ로 이동
                    moveToDlq(record, deliveryCount);
                    redis.opsForStream().acknowledge(STREAM_KEY, GROUP, record.getId());
                    log.warn("DLQ 이동: messageId={}, deliveryCount={}",
                        record.getId(), deliveryCount);
                    continue;
                }

                try {
                    String orderId = (String) record.getValue().get("orderId");
                    String eventType = (String) record.getValue().get("eventType");
                    processingService.process(orderId, eventType,
                        toStringMap(record.getValue()));
                    redis.opsForStream().acknowledge(STREAM_KEY, GROUP, record.getId());
                    log.info("복구 성공: messageId={}, attempt={}",
                        record.getId(), deliveryCount);
                } catch (Exception e) {
                    log.error("복구 실패 (다음 주기 재시도): messageId={}, error={}",
                        record.getId(), e.getMessage());
                }
            }

            // 배치가 BATCH_SIZE 미만이면 더 이상 없음
            if (claimed.size() < BATCH_SIZE) break;
        }
    }

    /**
     * XPENDING 상세 조회로 delivery count 확인
     */
    private int getDeliveryCount(RecordId recordId) {
        PendingMessages pending = redis.opsForStream()
            .pending(STREAM_KEY, GROUP, Range.closed(
                recordId.getValue(), recordId.getValue()), 1);
        if (pending != null && pending.size() > 0) {
            return (int) pending.get(0).getTotalDeliveryCount();
        }
        return 0;
    }

    @SuppressWarnings("unchecked")
    private List<MapRecord<String, Object, Object>> xautoclaim(String cursor) {
        // Spring Data Redis 3.x: XAUTOCLAIM 직접 실행
        return redis.execute((RedisCallback<List<MapRecord<String, Object, Object>>>) connection -> {
            // Lettuce native command
            var commands = connection.getNativeConnection();
            // ... XAUTOCLAIM 실행 로직
            return List.of(); // 실제 구현에서는 Lettuce API 사용
        });
    }

    private Map<String, String> toStringMap(Map<Object, Object> source) {
        Map<String, String> result = new HashMap<>();
        source.forEach((k, v) -> result.put(String.valueOf(k), String.valueOf(v)));
        return result;
    }
}
```

---

## 4) 멱등 처리 — 재처리는 곧 중복이다

pending 재처리를 하면 같은 이벤트가 두 번 처리될 수 있습니다.
**모든 소비 로직은 멱등해야 합니다.**

### 4-1) 패턴 비교

| 패턴 | 구현 | 장점 | 단점 |
|------|------|------|------|
| DB Upsert | `INSERT ON CONFLICT UPDATE` | 간단, DB 수준 보장 | 복잡한 로직에는 부족 |
| 이력 테이블 | `processed_events (event_id PK)` | 범용, 감사 추적 가능 | 추가 쓰기 비용 |
| Redis SET | `SETNX event:{id} 1 EX 86400` | 빠름, TTL로 자동 정리 | Redis 장애 시 중복 가능 |
| 버전 비교 | `WHERE version < :newVersion` | 순서 역전 방지 | 스키마 변경 필요 |

### 4-2) Redis + DB 조합 — 이중 방어 코드

```java
@Service
@RequiredArgsConstructor
public class IdempotentProcessor {
    private final StringRedisTemplate redis;
    private final JdbcTemplate jdbc;

    private static final Duration DEDUP_TTL = Duration.ofHours(24);

    /**
     * Redis로 빠른 체크 → DB로 영구 기록
     */
    public boolean tryProcess(String eventId, Runnable businessLogic) {
        String redisKey = "processed:" + eventId;

        // 1) Redis 빠른 중복 체크
        Boolean isNew = redis.opsForValue()
            .setIfAbsent(redisKey, "1", DEDUP_TTL);
        if (Boolean.FALSE.equals(isNew)) {
            return false; // 이미 처리됨
        }

        // 2) DB에 이력 기록 (Redis 장애 대비 영구 저장)
        try {
            jdbc.update(
                "INSERT INTO processed_events (event_id, processed_at) VALUES (?, NOW()) "
                + "ON CONFLICT (event_id) DO NOTHING", eventId);

            // 3) 비즈니스 로직 실행
            businessLogic.run();
            return true;
        } catch (DuplicateKeyException e) {
            // DB 수준 중복 → 무시
            redis.delete(redisKey); // Redis 상태 정리
            return false;
        }
    }
}
```

---

## 5) 트림 전략: 메모리 vs 재처리 가능성

### 5-1) 트림 옵션 비교

| 명령 | 동작 | 사용 시점 |
|------|------|----------|
| `XADD ... MAXLEN ~ 10000` | 발행 시 대략적 트림 | 가장 권장 — 발행과 트림이 원자적 |
| `XTRIM stream MAXLEN ~ 10000` | 별도 트림 | 배치 정리/야간 작업 |
| `XTRIM stream MINID ~ <id>` | ID 기준 트림 (시간 기반) | 보관 기간 정책 |

### 5-2) 보관 창 설계 공식

```
보관 창 = max(재처리 지연 최대값, DLQ 판단 시간) × 안전 계수(2~3배)
```

예시:
- 재처리 스케줄러가 2분마다 실행, 최대 5회 재시도 → 최대 10분
- 안전 계수 3배 → **30분 보관**
- 초당 100건 발행 → 30분 × 60초 × 100건 = **180,000건 MAXLEN**

### 5-3) 시간 기반 트림 스케줄러

```java
@Scheduled(fixedRate = 300_000) // 5분마다
public void trimByAge() {
    // 1시간 이전 메시지 트림
    Instant cutoff = Instant.now().minus(Duration.ofHours(1));
    String minId = cutoff.toEpochMilli() + "-0";

    redis.execute((RedisCallback<Object>) connection -> {
        connection.execute("XTRIM", "order-events".getBytes(),
            "MINID".getBytes(), "~".getBytes(), minId.getBytes());
        return null;
    });

    log.debug("스트림 트림 완료: minId={}", minId);
}
```

---

## 6) DLQ(Dead Letter Queue) — 독 메시지 격리

Redis Streams에는 DLQ가 내장되어 있지 않으므로 직접 설계해야 합니다.

### 6-1) DLQ 아키텍처

```
[order-events 스트림]
       ↓ XREADGROUP
[Consumer] → 처리 실패 → PEL 잔류
       ↓ XAUTOCLAIM (재시도)
[Recovery Worker]
       ↓ delivery_count > MAX_RETRY
[order-events-dlq 스트림]  ← 별도 스트림
       ↓
[DLQ Dashboard / 수동 재처리 도구]
```

### 6-2) DLQ 이동 코드

```java
private void moveToDlq(MapRecord<String, Object, Object> record, int deliveryCount) {
    Map<String, String> dlqFields = new LinkedHashMap<>();
    // 원본 데이터 복사
    record.getValue().forEach((k, v) ->
        dlqFields.put(String.valueOf(k), String.valueOf(v)));
    // DLQ 메타데이터 추가
    dlqFields.put("_original_id", record.getId().getValue());
    dlqFields.put("_original_stream", STREAM_KEY);
    dlqFields.put("_delivery_count", String.valueOf(deliveryCount));
    dlqFields.put("_moved_at", Instant.now().toString());
    dlqFields.put("_failure_reason", "max_retry_exceeded");

    StringRecord dlqRecord = StreamRecords.string(dlqFields)
        .withStreamKey(STREAM_KEY + "-dlq");
    redis.opsForStream().add(dlqRecord);

    // DLQ 메트릭
    meterRegistry.counter("redis.stream.dlq.moved",
        "stream", STREAM_KEY).increment();
}
```

### 6-3) DLQ 재처리 도구 (관리자용)

```java
@RestController
@RequestMapping("/admin/dlq")
@RequiredArgsConstructor
public class DlqAdminController {

    private final StringRedisTemplate redis;

    /** DLQ 메시지 목록 조회 */
    @GetMapping("/{stream}")
    public List<MapRecord<String, Object, Object>> listDlq(
            @PathVariable String stream,
            @RequestParam(defaultValue = "20") int limit) {
        return redis.opsForStream().read(
            StreamOffset.fromStart(stream + "-dlq"),
            StreamReadOptions.empty().count(limit));
    }

    /** DLQ 메시지를 원본 스트림으로 재발행 */
    @PostMapping("/{stream}/replay/{messageId}")
    public String replayMessage(
            @PathVariable String stream,
            @PathVariable String messageId) {
        // DLQ에서 메시지 읽기
        List<MapRecord<String, Object, Object>> records = redis.opsForStream()
            .range(stream + "-dlq",
                Range.closed(messageId, messageId));
        if (records.isEmpty()) return "NOT_FOUND";

        // 원본 스트림에 재발행 (메타데이터 제거)
        Map<String, String> fields = new LinkedHashMap<>();
        records.get(0).getValue().forEach((k, v) -> {
            String key = String.valueOf(k);
            if (!key.startsWith("_")) {
                fields.put(key, String.valueOf(v));
            }
        });
        fields.put("_replayed_from_dlq", "true");
        fields.put("_replayed_at", Instant.now().toString());

        StringRecord record = StreamRecords.string(fields)
            .withStreamKey(stream);
        RecordId newId = redis.opsForStream().add(record);
        return "REPLAYED: " + newId.getValue();
    }
}
```

---

## 7) 멀티 스트림 소비 & 파티셔닝 패턴

### 7-1) 단일 컨슈머가 여러 스트림 구독

```java
// 여러 스트림을 하나의 XREADGROUP으로 소비
container.receive(
    Consumer.from("order-group", consumerName),
    StreamOffset.create("order-events", ReadOffset.lastConsumed()),
    StreamOffset.create("payment-events", ReadOffset.lastConsumed()),
    consumer
);
```

### 7-2) 해시 기반 가상 파티셔닝

Redis Streams는 Kafka처럼 파티션이 없지만, 여러 스트림으로 분산할 수 있습니다.

```java
// 발행 시: orderId 해시로 스트림 선택
public RecordId publishPartitioned(String orderId, Map<String, String> fields) {
    int partition = Math.abs(orderId.hashCode()) % PARTITION_COUNT;
    String streamKey = "order-events:" + partition;
    StringRecord record = StreamRecords.string(fields).withStreamKey(streamKey);
    return redis.opsForStream().add(record);
}
```

장점: 순서 보장(같은 orderId는 같은 스트림), 처리량 분산  
단점: 파티션 수 변경이 어려움(리밸런싱 직접 구현 필요)

---

## 8) 운영 체크리스트

### Day 1 — 기본 설정

- [ ] Consumer Group 생성 & MKSTREAM 확인
- [ ] XADD에 `MAXLEN ~` 설정 (트림 정책)
- [ ] 모든 소비 로직에 `XACK` 포함 확인
- [ ] 멱등성 키 설계 (event_id 기반)
- [ ] DLQ 스트림 생성 & 최대 재시도 횟수 결정

### Week 1 — 모니터링

- [ ] Prometheus: pending 수, 스트림 길이, DLQ 카운터
- [ ] Grafana 대시보드: PEL 추이, 컨슈머별 처리 속도
- [ ] 알람: pending > 1000 (5분), pending > 5000 (2분)
- [ ] XINFO CONSUMERS로 유령 컨슈머 정리 스케줄러

### Month 1 — 운영 안정화

- [ ] 보관 창 재검증 (실제 재처리 패턴 기반)
- [ ] DLQ 재처리 프로세스 문서화 & 런북
- [ ] 장애 시나리오 테스트: 컨슈머 kill → 복구 시간 측정
- [ ] Redis 메모리 사용량 추이 확인 & 트림 정책 조정

---

## 9) 안티패턴 5가지

| # | 안티패턴 | 증상 | 해결 |
|---|---------|------|------|
| 1 | XACK 누락 | PEL 무한 증가, 메모리 소진 | 모든 처리 경로(성공/실패)에서 ACK 또는 DLQ 이동 |
| 2 | 트림 과격 | 재처리 시 원본 소실 | 보관 창 = 최대 재처리 지연 × 안전 계수 |
| 3 | 복구 없는 PEL | 죽은 컨슈머의 메시지 영구 유실 | XAUTOCLAIM 스케줄러 필수 |
| 4 | 멱등성 미구현 | 재처리로 데이터 오염/중복 | event_id 기반 dedup 필수 |
| 5 | 단일 거대 스트림 | 처리량 병목 | 해시 기반 가상 파티셔닝 검토 |

---

## 10) 자주 하는 실수 — 트러블슈팅 가이드

| 증상 | 원인 | 진단 | 해결 |
|------|------|------|------|
| pending이 계속 증가 | XACK 누락 또는 컨슈머 장애 | `XPENDING` + `XINFO CONSUMERS` | 코드 리뷰 + XAUTOCLAIM |
| 메모리 급증 | 트림 미설정 | `XLEN` + `MEMORY USAGE` | MAXLEN 설정 |
| 재처리 시 원본 없음 | 트림이 너무 공격적 | `XRANGE` 조회 실패 | 보관 창 확대 |
| 중복 처리 | 멱등성 미구현 + 재시도 | DB 중복 데이터 확인 | dedup 로직 추가 |
| 특정 컨슈머에 편중 | 해시 스큐 또는 처리 속도 차이 | `XPENDING` 컨슈머별 분포 | 파티셔닝 재설계 |

---

## 연습(추천)

1. **PEL 관찰 실습**: 컨슈머 2개로 그룹을 구성하고, 하나를 강제 종료한 뒤 XPENDING으로 pending이 어떻게 남는지 확인
2. **XAUTOCLAIM 복구**: pending을 회수해 "다른 컨슈머가 재처리"하는 흐름을 만들어보기
3. **DLQ 파이프라인**: 독 메시지를 DLQ 스트림으로 보내고, 재시도 상한/알람 기준을 정의
4. **부하 테스트**: 초당 1000건 발행 시 PEL 추이와 트림 정책의 균형점을 찾기
5. **Prometheus 대시보드**: pending 수, 스트림 길이, DLQ 카운터를 Grafana에서 시각화

---

## 관련 심화 학습

- [Redis Streams 기초](/learning/deep-dive/deep-dive-redis-streams/) — Consumer Group과 기본 XADD/XREAD 패턴
- [Redis 캐싱 전략](/learning/deep-dive/deep-dive-redis-caching/) — Redis 전반 운영과 캐시 설계
- [Kafka 기초](/learning/deep-dive/deep-dive-kafka-foundations/) — Streams vs Kafka 비교 맥락
- [Kafka Consumer Lag 관리](/learning/deep-dive/deep-dive-kafka-consumer-lag/) — 유사한 백로그 모니터링 패턴
- [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/) — 재처리 안전성의 기반
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — Prometheus/Grafana 모니터링 기반
- [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/) — 소비 실패 시 서킷 브레이커 연동
