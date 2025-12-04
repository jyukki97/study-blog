---
title: "Kafka 멀티테넌트 큐 서비스 설계기"
date: 2025-11-03
topic: "Kafka"
topic_icon: "🔀"
topic_description: "Apache Kafka 메시징 시스템 학습"
tags: ["Kafka", "Message Queue", "Multi-tenant", "Architecture"]
categories: ["Development", "Learning"]
description: "EasyQueue 구조, Cluster 구성, SASL_SSL 인증, Consumer Group 전략"
draft: true
---

> **학습 목표**: Kafka를 활용한 멀티테넌트 메시지 큐 시스템 설계와 운영 경험 정리. 실제 프로젝트에서 마주한 아키텍처 결정과 트레이드오프를 기록한다.

## 🎯 프로젝트 개요: EasyQueue

### 배경

회사 내부에서 여러 팀이 메시지 큐를 필요로 했지만, 각 팀마다 별도의 Kafka 클러스터를 운영하는 것은 비효율적이었습니다.

**문제점**:
- ❌ 팀마다 Kafka 클러스터 설치 및 운영 부담
- ❌ 리소스 낭비 (소규모 트래픽에도 3 Broker 필요)
- ❌ 보안 설정 및 모니터링 중복 작업

**해결책**: **멀티테넌트 Kafka 클러스터 + Self-Service Portal**

---

## 🏗️ 아키텍처 설계

### 전체 구조

```
┌─────────────────────────────────────────────────────┐
│            EasyQueue Admin Portal (Web UI)           │
│  - Tenant 생성/관리                                   │
│  - Topic 생성/권한 관리                                │
│  - 모니터링 대시보드                                    │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│           Kafka Cluster (Strimzi on K8s)            │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Broker 1 │  │ Broker 2 │  │ Broker 3 │         │
│  │  Zone A  │  │  Zone B  │  │  Zone C  │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│  ┌──────────────────────────────────────┐          │
│  │      ZooKeeper Ensemble (3 nodes)   │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│              Tenant Applications                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │ Team A  │  │ Team B  │  │ Team C  │            │
│  │ Topics  │  │ Topics  │  │ Topics  │            │
│  └─────────┘  └─────────┘  └─────────┘            │
└─────────────────────────────────────────────────────┘
```

### 핵심 설계 결정

#### 1. Topic Naming Convention

```
{tenant-id}.{environment}.{domain}.{topic-name}

예시:
- team-alpha.prod.order.created
- team-beta.dev.user.registered
- team-gamma.prod.payment.completed
```

**장점**:
- 테넌트별 격리 명확
- 환경별 분리 (prod/dev/stg)
- 도메인별 구분 용이
- ACL 설정 간편 (`team-alpha.*`)

#### 2. Multi-tenancy 전략

**네임스페이스 기반 격리**:
```yaml
# Kafka ACL 예시
User:team-alpha-producer -> ALLOW WRITE topic:team-alpha.*
User:team-alpha-consumer -> ALLOW READ topic:team-alpha.*
User:team-alpha-consumer -> ALLOW READ group:team-alpha.*
```

**리소스 쿼터 설정**:
```properties
# 테넌트별 쿼터
quota.producer.byte-rate=10485760  # 10MB/s
quota.consumer.byte-rate=20971520  # 20MB/s
```

---

## 🔐 보안: SASL_SSL 인증

### 인증 메커니즘

**SASL_SSL = SASL (인증) + SSL/TLS (암호화)**

```yaml
# Kafka Broker 설정
listeners:
  - name: external
    port: 9093
    type: loadbalancer
    tls: true
    authentication:
      type: scram-sha-512  # SASL/SCRAM-SHA-512

# Client 설정
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-512
sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required \
  username="team-alpha-producer" \
  password="secure-password";
ssl.truststore.location=/path/to/truststore.jks
ssl.truststore.password=truststore-password
```

### SCRAM vs PLAIN vs OAuth

| 방식 | 장점 | 단점 | 사용 사례 |
|------|------|------|----------|
| **SCRAM-SHA-512** | 비밀번호 해싱, 안전 | ZK 의존 | 일반적인 내부 인증 |
| **PLAIN** | 간단 | 비밀번호 평문 전송 | 개발 환경 only |
| **OAuth** | 중앙 인증, SSO | 복잡, 외부 의존 | 엔터프라이즈 환경 |

**선택**: SCRAM-SHA-512 (보안 + 관리 용이성)

### 인증 구현

```java
// Spring Kafka Producer 설정
@Configuration
public class KafkaProducerConfig {

    @Value("${kafka.bootstrap-servers}")
    private String bootstrapServers;

    @Value("${kafka.username}")
    private String username;

    @Value("${kafka.password}")
    private String password;

    @Bean
    public ProducerFactory<String, Object> producerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, JsonSerializer.class);

        // SASL_SSL 설정
        props.put("security.protocol", "SASL_SSL");
        props.put("sasl.mechanism", "SCRAM-SHA-512");
        props.put("sasl.jaas.config", String.format(
            "org.apache.kafka.common.security.scram.ScramLoginModule required " +
            "username=\"%s\" password=\"%s\";",
            username, password
        ));

        // SSL Truststore
        props.put("ssl.truststore.location", "/etc/kafka/truststore.jks");
        props.put("ssl.truststore.password", "changeit");

        return new DefaultKafkaProducerFactory<>(props);
    }
}
```

---

## 📊 Consumer Group 전략

### Consumer Group 설계 패턴

#### 패턴 1: 독립 처리 (각자 모든 메시지)

```
Topic: order.created

Consumer Group A (Notification Service)
Consumer Group B (Analytics Service)
Consumer Group C (Audit Service)

→ 모든 그룹이 동일한 메시지를 각각 소비
```

**사용 사례**: 이벤트 브로드캐스트

#### 패턴 2: 병렬 처리 (파티션 분산)

```
Topic: order.created (3 partitions)

Consumer Group: order-processor
  ├─ Consumer 1 → Partition 0
  ├─ Consumer 2 → Partition 1
  └─ Consumer 3 → Partition 2

→ 부하 분산, 처리량 증가
```

**사용 사례**: 대용량 처리

#### 패턴 3: 우선순위 처리

```
Topic: task.high-priority
Topic: task.low-priority

Consumer Group: task-processor
  ├─ Consumer 1,2 → high-priority (60% 리소스)
  └─ Consumer 3   → low-priority (40% 리소스)
```

**사용 사례**: 우선순위 큐

### Rebalance 이해하기

**Rebalance 발생 시점**:
1. Consumer가 그룹에 추가/제거될 때
2. Consumer가 죽었을 때
3. 파티션 개수가 변경될 때
4. Consumer가 heartbeat를 보내지 못할 때

**Rebalance 중 문제**:
- ❌ 메시지 처리 중단 (Stop-the-World)
- ❌ 중복 처리 가능 (커밋 전 rebalance)
- ❌ 레이턴시 증가

**Rebalance 최소화 방법**:

```properties
# Consumer 설정
session.timeout.ms=30000           # 30초
heartbeat.interval.ms=3000         # 3초
max.poll.interval.ms=300000        # 5분
max.poll.records=500               # 한 번에 가져올 최대 레코드 수
```

```java
// Cooperative Rebalancing (Kafka 2.4+)
@Bean
public ConsumerFactory<String, String> consumerFactory() {
    Map<String, Object> props = new HashMap<>();
    // ...
    props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
        CooperativeStickyAssignor.class.getName());  // 점진적 rebalance
    return new DefaultKafkaConsumerFactory<>(props);
}
```

---

## ⚙️ Cluster 운영 설정

### Strimzi Kafka Operator

**Kubernetes 기반 Kafka 배포**:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: easyqueue-cluster
spec:
  kafka:
    version: 3.5.0
    replicas: 3

    # 리소스 할당
    resources:
      requests:
        memory: 4Gi
        cpu: "1"
      limits:
        memory: 8Gi
        cpu: "2"

    # 스토리지 (JBOD)
    storage:
      type: jbod
      volumes:
        - id: 0
          type: persistent-claim
          size: 500Gi
          deleteClaim: false
          class: fast-ssd

    # 리스너 설정
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: loadbalancer
        tls: true
        authentication:
          type: scram-sha-512

    # Kafka 설정
    config:
      offsets.topic.replication.factor: 3
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2
      default.replication.factor: 3
      min.insync.replicas: 2
      auto.create.topics.enable: false  # 수동 생성만 허용
      log.retention.hours: 168          # 7일
      log.segment.bytes: 1073741824     # 1GB

  zookeeper:
    replicas: 3
    resources:
      requests:
        memory: 2Gi
        cpu: "500m"
    storage:
      type: persistent-claim
      size: 100Gi
      class: fast-ssd
```

### JBOD (Just a Bunch of Disks)

**왜 JBOD?**
- 여러 디스크를 독립적으로 사용
- 디스크 장애 시 해당 디스크만 교체
- 성능 향상 (I/O 분산)

```yaml
storage:
  type: jbod
  volumes:
    - id: 0
      type: persistent-claim
      size: 500Gi
    - id: 1
      type: persistent-claim
      size: 500Gi
```

---

## 📈 모니터링 & 알람

### Prometheus + Grafana

**Kafka Exporter 설정**:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: easyqueue-cluster
spec:
  kafka:
    # ... 기타 설정 ...
    metricsConfig:
      type: jmxPrometheusExporter
      valueFrom:
        configMapKeyRef:
          name: kafka-metrics
          key: kafka-metrics-config.yml
```

**주요 메트릭**:

| 메트릭 | 의미 | 임계값 |
|--------|------|--------|
| `kafka_server_replicamanager_underreplicatedpartitions` | 복제 지연 파티션 | > 0 |
| `kafka_controller_kafkacontroller_activecontrollercount` | Active Controller | != 1 |
| `kafka_server_brokertopicmetrics_messagesinpersec` | 메시지 유입률 | 급격한 증가 |
| `kafka_consumergroup_lag` | Consumer Lag | > 10000 |

**Grafana Dashboard**:
- Broker 상태 및 리소스 사용량
- Topic별 Throughput
- Consumer Group Lag
- Rebalance 횟수

---

## 🚨 트러블슈팅 경험

### 문제 1: Consumer Lag 급증

**증상**:
```
Consumer Group: payment-processor
Lag: 50,000 messages (평소 100 이하)
```

**원인**:
- 외부 API 호출 시간 증가 (500ms → 5초)
- Consumer가 `max.poll.interval.ms` 초과

**해결**:

```java
// AS-IS: 동기 처리
@KafkaListener(topics = "payment.created")
public void processPayment(PaymentEvent event) {
    externalApi.processPayment(event);  // 5초 걸림!
}

// TO-BE: 비동기 처리 + 재시도
@KafkaListener(topics = "payment.created", concurrency = "5")
public void processPayment(PaymentEvent event) {
    CompletableFuture.runAsync(() -> {
        try {
            externalApi.processPayment(event);
        } catch (Exception e) {
            retryQueue.send(event);  // DLQ로 전송
        }
    }, executorService);
}
```

**결과**: Lag 100 이하로 복구

### 문제 2: Broker Disk Full

**증상**:
```
Broker 2: Disk usage 95%
Error: No space left on device
```

**원인**:
- 특정 테넌트가 대용량 메시지 전송
- 로그 세그먼트 삭제가 느림

**해결**:

```properties
# 로그 압축 활성화
compression.type=lz4  # 평균 70% 압축률

# 세그먼트 크기 감소 (빠른 삭제)
log.segment.bytes=536870912  # 512MB (기존 1GB)

# 로그 보관 기간 단축
log.retention.hours=72  # 3일 (기존 7일)
```

**추가 조치**:
- 테넌트별 메시지 크기 제한 (1MB)
- 대용량 데이터는 S3 저장 후 링크만 전송

---

## 💡 Best Practices

### 1. Producer 설정

```properties
# 신뢰성 우선
acks=all                    # 모든 ISR 복제 완료 대기
retries=2147483647          # 무한 재시도
max.in.flight.requests.per.connection=1  # 순서 보장

# 성능 우선
acks=1                      # Leader만 확인
compression.type=lz4        # 압축으로 네트워크 절약
batch.size=16384            # 배치 크기 증가
linger.ms=10                # 대기 시간 증가
```

### 2. Consumer 설정

```properties
# At-Least-Once (중복 허용, 유실 방지)
enable.auto.commit=false
isolation.level=read_committed

# At-Most-Once (중복 방지, 유실 허용)
enable.auto.commit=true
auto.commit.interval.ms=5000
```

### 3. Topic 설계

```properties
# Partition 개수 계산
partitions = max(
  목표_처리량(MB/s) / 파티션당_처리량(MB/s),
  총_Consumer_수
)

# 예시: 100MB/s 처리, 파티션당 10MB/s
partitions = 100 / 10 = 10

# Replication Factor
replication.factor=3  # 최소 3개 권장
min.insync.replicas=2  # 최소 2개 복제 완료
```

---

## 📋 학습 체크리스트

- [ ] Kafka 기본 개념 (Broker, Topic, Partition, Consumer Group)
- [ ] SASL_SSL 인증 메커니즘 이해
- [ ] Consumer Group Rebalance 동작 원리
- [ ] Strimzi Operator로 Kafka 배포 가능
- [ ] Prometheus + Grafana 모니터링 구성
- [ ] Consumer Lag 원인 파악 및 해결 가능
- [ ] 멀티테넌시 아키텍처 설계 가능

---

## 🔗 참고 자료

- [Kafka Documentation](https://kafka.apache.org/documentation/)
- [Strimzi Documentation](https://strimzi.io/docs/)
- [Confluent Best Practices](https://docs.confluent.io/platform/current/kafka/deployment.html)

---

> **다음 학습**: WebSocket + gRPC 실시간 음성처리 서비스 아키텍처
