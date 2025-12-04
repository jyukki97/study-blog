---
title: "Kafka Consumer Lag 최적화"
date: 2025-01-21
topic: "Kafka"
topic_icon: "📨"
topic_description: "Kafka 컨슈머 지연 최소화 및 처리 성능 향상"
tags: ["Kafka", "Performance", "Consumer", "Optimization", "Scalability"]
categories: ["Kafka", "Performance"]
draft: false
---

## 1. 문제 상황

### 1.1 발생한 장애

이벤트 기반 주문 시스템에서 Consumer Lag이 급증하면서 실시간 알림이 지연되는 문제가 발생했습니다.

**문제 징후**:
- 정상 시 Lag 100~200 → 피크 시간 Lag 15,000 이상 급증
- 주문 완료 후 알림 도착까지 평균 5분 이상 지연
- 특정 파티션에만 Lag 집중 (불균형 분포)
- Consumer 인스턴스 추가해도 Lag 감소하지 않음

### 1.2 비즈니스 영향

- **고객 불만**: "주문했는데 알림이 안 와요" 문의 급증 (일 120건)
- **매출 손실**: 주문 취소율 8% 증가
- **운영 부담**: 수동으로 알림 재발송 처리 (일 평균 3시간 소요)

## 2. Consumer Lag 이해하기

### 2.1 Lag이란?

**Consumer Lag = Latest Offset - Current Offset**

```
Producer                Consumer
   │                       │
   │  Msg 1 (offset 0)     │
   │  Msg 2 (offset 1)     │
   │  Msg 3 (offset 2)     │  ◀─ Consumer가 읽고 있는 위치 (Lag = 3)
   │  Msg 4 (offset 3)     │
   │  Msg 5 (offset 4)     │
   │  Msg 6 (offset 5)     │  ◀─ Producer가 쓴 최신 위치
   │                       │
```

**Lag이 증가하는 이유**:
- Producer 처리량 > Consumer 처리량
- Consumer 처리 시간 증가
- 파티션 불균형
- 컨슈머 다운 또는 리밸런싱

### 2.2 Lag 측정 방법

**명령어로 확인**:

```bash
# Consumer Group의 Lag 확인
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group order-notification-consumer

# 출력 예시
GROUP                      TOPIC       PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
order-notification-consumer orders     0          12500           12800           300
order-notification-consumer orders     1          8900            9100            200
order-notification-consumer orders     2          5600            21000           15400  ← 문제 파티션!
```

**Prometheus + Grafana로 모니터링**:

```promql
# 파티션별 Lag
kafka_consumer_lag{group="order-notification-consumer"}

# 최대 Lag
max(kafka_consumer_lag{group="order-notification-consumer"}) by (partition)

# Lag 증가율
rate(kafka_consumer_lag{group="order-notification-consumer"}[5m])
```

## 3. Lag 원인 분석

### 3.1 느린 메시지 처리

**문제 코드**:

```java
// ❌ 동기 블로킹 처리로 인한 성능 저하
@KafkaListener(topics = "orders", groupId = "order-notification-consumer")
public void handleOrder(OrderEvent event) {
    // 블로킹 HTTP 호출 (평균 500ms)
    UserProfile profile = restTemplate.getForObject(
        "https://api.user-service.com/users/" + event.getUserId(),
        UserProfile.class
    );

    // 블로킹 데이터베이스 쿼리 (평균 200ms)
    NotificationTemplate template = notificationRepository
        .findByType(event.getOrderType());

    // 블로킹 외부 API 호출 (평균 800ms)
    notificationService.send(
        profile.getEmail(),
        template.getContent()
    );

    // 총 처리 시간: 약 1.5초/메시지
    // 처리량: 약 40 msg/min
}
```

**병목 지점 분석**:
- 외부 API 호출: 800ms (53%)
- HTTP 사용자 조회: 500ms (33%)
- 데이터베이스 조회: 200ms (13%)

### 3.2 파티션 불균형

**문제 상황**:

```
Partition 0: Consumer A (처리량: 100 msg/s) → Lag: 200
Partition 1: Consumer B (처리량: 100 msg/s) → Lag: 150
Partition 2: Consumer C (처리량: 20 msg/s)  → Lag: 15,000  ← 느린 Consumer!
```

**원인**:
- 특정 파티션에 대용량 메시지 집중
- 특정 Consumer 인스턴스의 리소스 부족
- Hot Key 문제 (특정 키에 메시지 집중)

### 3.3 잦은 리밸런싱

```bash
# Consumer 로그
[2025-01-21 10:15:23] Revoking previously assigned partitions [orders-0, orders-1]
[2025-01-21 10:15:25] Partitions assigned: [orders-2]
[2025-01-21 10:17:30] Revoking previously assigned partitions [orders-2]
[2025-01-21 10:17:32] Partitions assigned: [orders-0, orders-1]
```

**리밸런싱 발생 원인**:
- Consumer 인스턴스 추가/제거
- `max.poll.interval.ms` 초과 (처리 시간이 너무 오래 걸림)
- 네트워크 지연으로 인한 하트비트 실패

## 4. 해결 과정

### 4.1 비동기 처리 전환

**Before (동기 블로킹)**:

```java
@KafkaListener(topics = "orders")
public void handleOrder(OrderEvent event) {
    // 동기 처리: 1.5초/메시지
    UserProfile profile = getUserProfile(event.getUserId());
    NotificationTemplate template = getTemplate(event.getOrderType());
    sendNotification(profile, template);
}
```

**After (비동기 병렬 처리)**:

```java
@KafkaListener(topics = "orders", concurrency = "3")
public void handleOrder(OrderEvent event) {
    CompletableFuture<UserProfile> profileFuture = CompletableFuture.supplyAsync(
        () -> webClient.get()
            .uri("/users/" + event.getUserId())
            .retrieve()
            .bodyToMono(UserProfile.class)
            .block(),
        asyncExecutor
    );

    CompletableFuture<NotificationTemplate> templateFuture = CompletableFuture.supplyAsync(
        () -> templateRepository.findByType(event.getOrderType()),
        asyncExecutor
    );

    // 병렬 실행 후 조합
    CompletableFuture.allOf(profileFuture, templateFuture)
        .thenAccept(v -> {
            UserProfile profile = profileFuture.join();
            NotificationTemplate template = templateFuture.join();

            notificationService.sendAsync(profile.getEmail(), template.getContent());
        })
        .exceptionally(ex -> {
            log.error("Failed to process order event", ex);
            return null;
        });
}
```

**성능 개선**:
- 처리 시간: 1.5초 → 0.8초 (47% 단축)
- 처리량: 40 msg/min → 225 msg/min (463% 증가)

### 4.2 배치 처리

```java
@Component
public class BatchOrderConsumer {

    private final List<OrderEvent> buffer = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @PostConstruct
    public void init() {
        // 5초마다 또는 100개 이상 쌓이면 처리
        scheduler.scheduleAtFixedRate(this::processBatch, 5, 5, TimeUnit.SECONDS);
    }

    @KafkaListener(topics = "orders", concurrency = "5")
    public void handleOrder(OrderEvent event,
                           Acknowledgment acknowledgment) {
        buffer.add(event);

        // 버퍼가 100개 이상이면 즉시 처리
        if (buffer.size() >= 100) {
            processBatch();
        }

        acknowledgment.acknowledge();
    }

    private void processBatch() {
        if (buffer.isEmpty()) {
            return;
        }

        List<OrderEvent> batch = new ArrayList<>(buffer);
        buffer.clear();

        try {
            // 배치로 한 번에 처리
            Set<String> userIds = batch.stream()
                .map(OrderEvent::getUserId)
                .collect(Collectors.toSet());

            // 사용자 정보 일괄 조회 (N+1 문제 해결)
            Map<String, UserProfile> profiles = userService
                .getUserProfiles(userIds);

            // 일괄 알림 발송
            List<NotificationRequest> notifications = batch.stream()
                .map(event -> createNotification(
                    event,
                    profiles.get(event.getUserId())
                ))
                .collect(Collectors.toList());

            notificationService.sendBatch(notifications);

            log.info("Processed batch of {} orders", batch.size());

        } catch (Exception ex) {
            log.error("Failed to process batch", ex);
            // 실패한 배치 재처리 또는 DLQ로 전송
        }
    }
}
```

**성능 개선**:
- API 호출 횟수: 100번 → 1번 (99% 감소)
- 처리 시간: 150초 → 8초 (95% 단축)
- 처리량: 600 msg/min → 7,500 msg/min (1,150% 증가)

### 4.3 Consumer 설정 최적화

**application.yml**:

```yaml
spring:
  kafka:
    consumer:
      bootstrap-servers: localhost:9092
      group-id: order-notification-consumer
      auto-offset-reset: earliest
      enable-auto-commit: false  # 수동 커밋으로 정확성 보장

      # 처리 성능 최적화
      max-poll-records: 100      # 한 번에 가져올 레코드 수 (기본: 500)
      fetch-min-bytes: 1024      # 최소 Fetch 크기 (1KB)
      fetch-max-wait-ms: 500     # Fetch 대기 시간

      # 리밸런싱 방지
      session-timeout-ms: 30000       # 세션 타임아웃 (30초)
      heartbeat-interval-ms: 3000     # 하트비트 간격 (3초)
      max-poll-interval-ms: 300000    # Poll 간격 최대 시간 (5분)

      # 처리 속도 향상
      properties:
        max.partition.fetch.bytes: 1048576  # 파티션당 최대 Fetch 크기 (1MB)

    listener:
      ack-mode: manual           # 수동 ACK
      concurrency: 5             # Consumer 스레드 수
      poll-timeout: 3000         # Poll 타임아웃 (3초)
```

**설정 튜닝 가이드**:

| 설정 | 기본값 | 권장값 | 효과 |
|------|-------|-------|------|
| `max-poll-records` | 500 | 100-200 | 처리 시간 단축, 리밸런싱 방지 |
| `fetch-min-bytes` | 1 | 1024-10240 | 네트워크 효율 증가 |
| `fetch-max-wait-ms` | 500 | 500-1000 | Latency 감소 |
| `max-poll-interval-ms` | 300000 | 300000-600000 | 리밸런싱 방지 |
| `concurrency` | 1 | CPU 코어 수 | 처리량 증가 |

### 4.4 파티션 수 최적화

**파티션 수 계산 공식**:

```
파티션 수 = max(
    목표 처리량 / 단일 Consumer 처리량,
    목표 처리량 / 단일 Producer 처리량
)
```

**실전 예시**:

```
목표 처리량: 10,000 msg/s
단일 Consumer 처리량: 500 msg/s
단일 Producer 처리량: 1,000 msg/s

파티션 수 = max(10,000/500, 10,000/1,000) = max(20, 10) = 20개
```

**파티션 추가**:

```bash
# 현재 파티션 수 확인
kafka-topics.sh --bootstrap-server localhost:9092 \
  --describe --topic orders

# 파티션 수 증가 (3 → 10)
kafka-topics.sh --bootstrap-server localhost:9092 \
  --alter --topic orders --partitions 10
```

**주의사항**:
- 파티션은 증가만 가능, 감소 불가
- 기존 메시지의 키 기반 분산이 변경될 수 있음
- Consumer Group 재조정 필요

### 4.5 Consumer 인스턴스 스케일링

**Kubernetes HorizontalPodAutoscaler**:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-consumer-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-consumer
  minReplicas: 3
  maxReplicas: 10
  metrics:
    # CPU 기반 스케일링
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70

    # Consumer Lag 기반 스케일링
    - type: External
      external:
        metric:
          name: kafka_consumer_lag
          selector:
            matchLabels:
              topic: orders
        target:
          type: AverageValue
          averageValue: "1000"  # Lag이 1,000 초과 시 스케일 아웃
```

**스케일링 전략**:

```
Lag < 500:        최소 인스턴스 (3개) 유지
Lag 500-1,000:    안정 상태, 모니터링
Lag 1,000-5,000:  스케일 아웃 (최대 10개까지)
Lag > 5,000:      알림 발송, 수동 개입
```

## 5. 고급 최적화 기법

### 5.1 멀티 스레드 처리

```java
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, OrderEvent>
            kafkaListenerContainerFactory(
                ConsumerFactory<String, OrderEvent> consumerFactory,
                TaskExecutor taskExecutor) {

        ConcurrentKafkaListenerContainerFactory<String, OrderEvent> factory =
            new ConcurrentKafkaListenerContainerFactory<>();

        factory.setConsumerFactory(consumerFactory);
        factory.setConcurrency(10);  // 10개 Consumer 스레드 생성

        // 메시지 처리를 별도 스레드 풀에서 실행
        factory.getContainerProperties()
            .setListenerTaskExecutor(taskExecutor);

        return factory;
    }

    @Bean
    public TaskExecutor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(20);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("kafka-consumer-");
        executor.initialize();
        return executor;
    }
}
```

### 5.2 캐싱으로 외부 API 호출 최소화

```java
@Service
public class CachedUserService {

    private final WebClient userWebClient;
    private final LoadingCache<String, UserProfile> userCache;

    public CachedUserService(WebClient userWebClient) {
        this.userWebClient = userWebClient;
        this.userCache = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(Duration.ofMinutes(10))
            .recordStats()
            .build(this::loadUserProfile);
    }

    public UserProfile getUserProfile(String userId) {
        return userCache.get(userId);
    }

    private UserProfile loadUserProfile(String userId) {
        return userWebClient.get()
            .uri("/users/" + userId)
            .retrieve()
            .bodyToMono(UserProfile.class)
            .block();
    }
}
```

**캐시 효과**:
- Cache Hit Rate: 85%
- API 호출 감소: 1,000건 → 150건 (85% 감소)
- 평균 응답 시간: 500ms → 2ms (99.6% 개선)

### 5.3 압축 활용

**Producer 압축 설정**:

```yaml
spring:
  kafka:
    producer:
      compression-type: snappy  # snappy, gzip, lz4, zstd
      properties:
        linger.ms: 10           # 배치를 위한 대기 시간
        batch.size: 32768       # 배치 크기 (32KB)
```

**압축 알고리즘 비교**:

| 압축 방식 | 압축률 | CPU 사용 | 처리량 | 권장 용도 |
|---------|-------|---------|-------|---------|
| None | 0% | 낮음 | 높음 | 작은 메시지 |
| snappy | 50% | 낮음 | 높음 | 일반적 사용 |
| lz4 | 55% | 낮음 | 매우 높음 | 대용량 처리 |
| gzip | 65% | 높음 | 낮음 | 네트워크 제약 |
| zstd | 70% | 중간 | 중간 | 균형잡힌 선택 |

**효과 측정**:

```
Before (압축 없음):
- 메시지 크기: 평균 5KB
- 네트워크 대역폭: 50MB/s
- 처리량: 10,000 msg/s

After (snappy 압축):
- 메시지 크기: 평균 2.5KB (50% 감소)
- 네트워크 대역폭: 25MB/s (50% 감소)
- 처리량: 18,000 msg/s (80% 증가)
```

### 5.4 Dead Letter Queue (DLQ) 패턴

```java
@Component
public class OrderConsumerWithDLQ {

    @KafkaListener(topics = "orders", groupId = "order-consumer")
    public void handleOrder(OrderEvent event,
                           @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
                           @Header(KafkaHeaders.RECEIVED_PARTITION_ID) int partition,
                           @Header(KafkaHeaders.OFFSET) long offset) {
        try {
            processOrder(event);

        } catch (RetryableException ex) {
            // 재시도 가능한 예외는 재시도
            log.warn("Retryable error, will retry", ex);
            throw ex;  // Spring Kafka가 재시도 처리

        } catch (NonRetryableException ex) {
            // 재시도 불가능한 예외는 DLQ로 전송
            log.error("Non-retryable error, sending to DLQ", ex);
            sendToDLQ(event, topic, partition, offset, ex);
        }
    }

    private void sendToDLQ(OrderEvent event, String topic, int partition,
                          long offset, Exception ex) {
        DLQMessage dlqMessage = DLQMessage.builder()
            .originalTopic(topic)
            .partition(partition)
            .offset(offset)
            .payload(event)
            .errorMessage(ex.getMessage())
            .errorStackTrace(getStackTrace(ex))
            .timestamp(Instant.now())
            .build();

        kafkaTemplate.send("orders-dlq", dlqMessage);
    }
}
```

**DLQ 설정**:

```yaml
spring:
  kafka:
    listener:
      ack-mode: manual
    producer:
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer

    # 재시도 설정
    consumer:
      properties:
        spring.kafka.retry.topic.enabled: true
        spring.kafka.retry.topic.attempts: 3
        spring.kafka.retry.topic.delay: 1000  # 1초
        spring.kafka.retry.topic.multiplier: 2.0
        spring.kafka.retry.topic.max-delay: 10000  # 최대 10초
```

## 6. 모니터링 및 알림

### 6.1 Grafana 대시보드

**핵심 지표**:

```promql
# Consumer Lag
kafka_consumer_lag{group="order-consumer"}

# Lag 변화율 (초당 증가량)
rate(kafka_consumer_lag{group="order-consumer"}[5m])

# Consumer 처리 속도
rate(kafka_consumer_records_consumed_total{group="order-consumer"}[5m])

# Lag 대비 처리 속도 비율
(
  rate(kafka_consumer_records_consumed_total[5m])
  / kafka_consumer_lag
) * 100
```

### 6.2 알림 규칙

```yaml
groups:
  - name: kafka_consumer_lag_alerts
    interval: 30s
    rules:
      # Lag이 높을 때
      - alert: KafkaConsumerLagHigh
        expr: kafka_consumer_lag > 5000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High consumer lag on {{ $labels.group }}"
          description: "Lag is {{ $value }} on topic {{ $labels.topic }}"

      # Lag이 계속 증가할 때
      - alert: KafkaConsumerLagGrowing
        expr: deriv(kafka_consumer_lag[10m]) > 100
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Consumer lag growing for {{ $labels.group }}"
          description: "Lag growing at {{ $value }} msg/s"

      # Consumer가 메시지를 처리하지 않을 때
      - alert: KafkaConsumerNotConsuming
        expr: rate(kafka_consumer_records_consumed_total[5m]) == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Consumer {{ $labels.group }} not consuming"
          description: "No messages consumed in last 5 minutes"
```

### 6.3 커스텀 메트릭 추가

```java
@Component
@RequiredArgsConstructor
public class ConsumerMetrics {

    private final MeterRegistry meterRegistry;

    @KafkaListener(topics = "orders")
    public void handleOrder(OrderEvent event,
                           @Header(KafkaHeaders.RECEIVED_TIMESTAMP) long timestamp) {

        // 처리 시간 측정
        Timer.Sample sample = Timer.start(meterRegistry);

        try {
            processOrder(event);

            sample.stop(Timer.builder("kafka.consumer.processing.time")
                .tag("topic", "orders")
                .tag("status", "success")
                .register(meterRegistry));

            // End-to-End Latency 측정
            long latency = System.currentTimeMillis() - timestamp;
            meterRegistry.gauge("kafka.consumer.e2e.latency",
                Tags.of("topic", "orders"), latency);

        } catch (Exception ex) {
            sample.stop(Timer.builder("kafka.consumer.processing.time")
                .tag("topic", "orders")
                .tag("status", "error")
                .register(meterRegistry));

            meterRegistry.counter("kafka.consumer.errors",
                "topic", "orders",
                "exception", ex.getClass().getSimpleName()
            ).increment();

            throw ex;
        }
    }
}
```

## 7. 트러블슈팅

### 7.1 Lag이 감소하지 않을 때

**체크리스트**:

```bash
# 1. Consumer가 실제로 동작하는지 확인
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group order-consumer --state

# 2. Consumer 로그 확인
kubectl logs -f deployment/order-consumer | grep -i error

# 3. 파티션별 Lag 분포 확인
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group order-consumer

# 4. Consumer 인스턴스 수 vs 파티션 수 확인
# Consumer 수 > 파티션 수면 일부 Consumer가 유휴 상태
```

### 7.2 리밸런싱이 자주 발생할 때

**원인 및 해결**:

```yaml
# max.poll.interval.ms 초과 방지
spring:
  kafka:
    consumer:
      max-poll-interval-ms: 600000  # 10분으로 증가
      max-poll-records: 50          # Poll 크기 감소

# 하트비트 설정 조정
session-timeout-ms: 45000  # 45초로 증가
heartbeat-interval-ms: 3000  # 3초 유지
```

### 7.3 특정 파티션에만 Lag 발생

**원인**: Hot Key 또는 느린 Consumer 인스턴스

**해결**:

```java
// Hot Key 분산을 위한 커스텀 Partitioner
public class BalancedPartitioner implements Partitioner {

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {

        List<PartitionInfo> partitions = cluster.partitionsForTopic(topic);
        int numPartitions = partitions.size();

        if (keyBytes == null) {
            // 키가 없으면 라운드 로빈
            return ThreadLocalRandom.current().nextInt(numPartitions);
        }

        // 키의 해시에 랜덤 솔트 추가로 분산
        int hash = (key.hashCode() ^ ThreadLocalRandom.current().nextInt()) & Integer.MAX_VALUE;
        return hash % numPartitions;
    }
}
```

## 8. 결과 및 개선 효과

### 8.1 성능 지표

| 지표 | Before | After | 개선율 |
|------|--------|-------|--------|
| 평균 Lag | 5,000 | 150 | 97% 감소 |
| 최대 Lag | 21,000 | 800 | 96% 감소 |
| 평균 처리 시간 | 1.5초/msg | 0.3초/msg | 80% 단축 |
| 처리량 | 600 msg/min | 12,000 msg/min | 1,900% 증가 |
| 알림 지연 시간 | 5분 | 8초 | 97% 단축 |

### 8.2 비즈니스 임팩트

- **고객 만족도**: CS 문의 120건/일 → 5건/일 (96% 감소)
- **주문 취소율**: 8% → 1.2% (6.8%p 감소)
- **매출 복구**: 월 $45,000 추가 매출

### 8.3 운영 효율성

- **수동 개입 시간**: 일 3시간 → 주 30분 (95% 감소)
- **장애 감지 시간**: 평균 12분 → 평균 1분 (92% 단축)
- **인프라 비용**: 월 $2,400 → 월 $1,800 (25% 절감)

## 9. 핵심 요약

### Consumer Lag 최적화 우선순위

1. **측정 및 모니터링**: Lag을 실시간으로 모니터링하고 알림 설정
2. **비동기 처리**: 블로킹 작업을 비동기로 전환
3. **배치 처리**: 메시지를 묶어서 일괄 처리
4. **Consumer 설정 튜닝**: `max-poll-records`, `fetch-min-bytes` 등 최적화
5. **파티션 수 조정**: 처리량에 맞게 파티션 수 증가
6. **Consumer 스케일링**: HPA로 자동 스케일링

### 필수 모니터링 지표

- **Lag**: Consumer Group의 처리 지연
- **Lag Growth Rate**: Lag 증가 속도
- **Consumer Rate**: 초당 처리 메시지 수
- **End-to-End Latency**: Producer → Consumer 전체 지연 시간
- **Rebalance Count**: 리밸런싱 발생 빈도

### 설정 권장값

```yaml
# 일반적인 워크로드
max-poll-records: 100-200
fetch-min-bytes: 1024
max-poll-interval-ms: 300000
concurrency: CPU 코어 수

# 대용량 처리
max-poll-records: 500-1000
fetch-min-bytes: 10240
compression-type: lz4
배치 처리 활용
```

### 장애 대응 체크리스트

1. Consumer 인스턴스가 살아있는가?
2. 리밸런싱이 발생하고 있는가?
3. 특정 파티션에만 Lag이 집중되는가?
4. 외부 API가 정상적으로 응답하는가?
5. 데이터베이스 성능에 문제가 없는가?
6. Consumer 설정이 적절한가?
