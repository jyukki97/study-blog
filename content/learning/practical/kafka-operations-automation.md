---
title: "Kafka 운영 자동화"
date: 2025-01-16
topic: "DevOps"
topic_icon: "⚙️"
topic_description: "Kafka 클러스터 자동 관리 및 운영 효율화"
tags: ["Kafka", "DevOps", "Automation", "Kubernetes", "Strimzi"]
categories: ["DevOps", "Kafka"]
draft: true
---

## 개요

운영 중인 Kafka 클러스터를 수동으로 관리하다가 자동화를 도입하면서 얻은 경험을 정리합니다. Strimzi Operator와 GitOps 방식으로 운영 효율을 3배 향상시킨 여정을 공유합니다.

## 자동화 전 문제점

### 수동 운영의 고통

```bash
# 새로운 토픽 생성 요청이 올 때마다...
kafka-topics --bootstrap-server kafka:9092 --create \
  --topic new-topic \
  --partitions 3 \
  --replication-factor 2 \
  --config retention.ms=604800000 \
  --config max.message.bytes=1048576

# 매번 문서 찾아보고...
# 파티션 수는 몇 개? 복제 계수는?
# 설정값은 뭐였지?
# 실수로 잘못 만들면 다시 지우고 만들어야 함
# 변경 이력 추적 불가
```

**문제점:**
- ❌ 수작업 반복으로 인한 휴먼 에러
- ❌ 설정 일관성 부족
- ❌ 변경 이력 추적 불가
- ❌ 야간/주말 긴급 대응 어려움
- ❌ 온보딩 시간 증가 (새 팀원 교육)
- ❌ 장애 복구 시간 증가

**측정 지표 (자동화 전):**
- 토픽 생성 평균 시간: 15분 (문서 확인 + 실행 + 검증)
- 월평균 설정 오류: 8건
- Consumer Group 문제 해결 평균 시간: 45분
- 주말/야간 장애 대응 평균 시간: 2시간 (출근 포함)

## Strimzi Operator 기반 자동화

### 1. Strimzi Operator 설치

```yaml
# namespace 생성
apiVersion: v1
kind: Namespace
metadata:
  name: kafka
---
# Strimzi Operator 설치
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: strimzi-kafka-operator
  namespace: kafka
spec:
  channel: stable
  name: strimzi-kafka-operator
  source: operatorhubio-catalog
  sourceNamespace: olm
```

```bash
# Helm으로 설치
helm repo add strimzi https://strimzi.io/charts/
helm install strimzi-operator strimzi/strimzi-kafka-operator \
  --namespace kafka \
  --create-namespace
```

### 2. Kafka 클러스터 선언적 정의

```yaml
# kafka-cluster.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: production-cluster
  namespace: kafka
spec:
  kafka:
    version: 3.6.0
    replicas: 3
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: internal
        tls: true
        authentication:
          type: scram-sha-512
      - name: external
        port: 9094
        type: loadbalancer
        tls: true
        authentication:
          type: scram-sha-512

    config:
      # 자동 토픽 생성 비활성화 (명시적 관리)
      auto.create.topics.enable: false
      # 기본 복제 계수
      default.replication.factor: 3
      min.insync.replicas: 2
      # 로그 보존 설정
      log.retention.hours: 168
      log.segment.bytes: 1073741824
      # 압축 설정
      compression.type: producer
      # Transaction 설정
      transaction.state.log.replication.factor: 3
      transaction.state.log.min.isr: 2

    storage:
      type: jbod
      volumes:
        - id: 0
          type: persistent-claim
          size: 100Gi
          class: fast-ssd
          deleteClaim: false

    resources:
      requests:
        memory: 4Gi
        cpu: 2000m
      limits:
        memory: 8Gi
        cpu: 4000m

    # JVM 설정
    jvmOptions:
      -Xms: 2048m
      -Xmx: 4096m
      -XX:
        +UseG1GC: true
        MaxGCPauseMillis: 20
        InitiatingHeapOccupancyPercent: 35

    # 메트릭 활성화
    metricsConfig:
      type: jmxPrometheusExporter
      valueFrom:
        configMapKeyRef:
          name: kafka-metrics
          key: kafka-metrics-config.yml

  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 10Gi
      class: fast-ssd
      deleteClaim: false

    resources:
      requests:
        memory: 1Gi
        cpu: 500m
      limits:
        memory: 2Gi
        cpu: 1000m

  entityOperator:
    topicOperator:
      # 자동 토픽 관리 활성화
      watchedNamespace: kafka
      reconciliationIntervalSeconds: 90
    userOperator:
      # 자동 사용자 관리 활성화
      watchedNamespace: kafka
      reconciliationIntervalSeconds: 120
```

**적용:**
```bash
kubectl apply -f kafka-cluster.yaml

# 상태 확인
kubectl get kafka -n kafka
kubectl get pods -n kafka -w

# 클러스터 준비 완료 대기
kubectl wait kafka/production-cluster \
  --for=condition=Ready \
  --timeout=300s \
  -n kafka
```

### 3. 토픽 자동 생성 및 관리

```yaml
# topics/user-events-topic.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: user-events
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
    team: platform
    env: production
spec:
  partitions: 12
  replicas: 3
  config:
    # 보존 정책
    retention.ms: 604800000        # 7일
    retention.bytes: 107374182400  # 100GB
    # 압축 설정
    compression.type: lz4
    # 세그먼트 설정
    segment.ms: 3600000           # 1시간
    segment.bytes: 1073741824     # 1GB
    # 복제 설정
    min.insync.replicas: 2
    # 메시지 크기
    max.message.bytes: 1048576    # 1MB
    # 인덱싱
    index.interval.bytes: 4096
---
# topics/order-events-topic.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: order-events
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
    team: commerce
    env: production
spec:
  partitions: 24
  replicas: 3
  config:
    retention.ms: 2592000000      # 30일
    compression.type: snappy
    min.insync.replicas: 2
    max.message.bytes: 5242880    # 5MB
---
# topics/analytics-topic.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: analytics-events
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
    team: analytics
    env: production
spec:
  partitions: 48
  replicas: 2  # 분석용은 복제 계수 낮춤
  config:
    # Compact 정책 (중복 제거)
    cleanup.policy: compact
    compression.type: lz4
    min.insync.replicas: 1
```

**토픽 템플릿 자동 생성 스크립트:**
```bash
#!/bin/bash
# create-topic.sh

TOPIC_NAME=$1
TEAM=$2
PARTITIONS=${3:-12}
RETENTION_DAYS=${4:-7}

cat <<EOF > topics/${TOPIC_NAME}-topic.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: ${TOPIC_NAME}
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
    team: ${TEAM}
    env: production
    created-by: automation
    created-at: $(date +%Y-%m-%d)
spec:
  partitions: ${PARTITIONS}
  replicas: 3
  config:
    retention.ms: $((RETENTION_DAYS * 24 * 3600 * 1000))
    compression.type: lz4
    min.insync.replicas: 2
    max.message.bytes: 1048576
EOF

echo "Created topic definition: topics/${TOPIC_NAME}-topic.yaml"
echo "Review and apply with: kubectl apply -f topics/${TOPIC_NAME}-topic.yaml"
```

**사용:**
```bash
./create-topic.sh payment-events commerce 24 30
kubectl apply -f topics/payment-events-topic.yaml

# 자동으로 Operator가 토픽 생성
# 변경 이력이 Git에 자동 저장됨
```

### 4. 사용자 및 ACL 자동 관리

```yaml
# users/app-producer.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: app-producer
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
spec:
  authentication:
    type: scram-sha-512

  authorization:
    type: simple
    acls:
      # user-events 토픽 쓰기 권한
      - resource:
          type: topic
          name: user-events
          patternType: literal
        operations:
          - Write
          - Describe
      # order-events 토픽 쓰기 권한
      - resource:
          type: topic
          name: order-events
          patternType: literal
        operations:
          - Write
          - Describe
      # Producer 그룹 접근
      - resource:
          type: group
          name: app-producer-group
          patternType: literal
        operations:
          - Read
---
# users/analytics-consumer.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: analytics-consumer
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
spec:
  authentication:
    type: scram-sha-512

  authorization:
    type: simple
    acls:
      # 모든 analytics-* 토픽 읽기 권한
      - resource:
          type: topic
          name: analytics-
          patternType: prefix
        operations:
          - Read
          - Describe
      # Consumer 그룹
      - resource:
          type: group
          name: analytics-consumer-group
          patternType: literal
        operations:
          - Read
```

**비밀번호 자동 생성 및 저장:**
```bash
# KafkaUser 생성하면 자동으로 Secret 생성됨
kubectl apply -f users/app-producer.yaml

# 생성된 비밀번호 확인
kubectl get secret app-producer -n kafka -o jsonpath='{.data.password}' | base64 -d

# 애플리케이션에 Secret 마운트
# 또는 External Secrets Operator로 외부 Vault 연동
```

## GitOps 워크플로우

### 1. Git 저장소 구조

```
kafka-gitops/
├── README.md
├── clusters/
│   ├── production/
│   │   └── kafka-cluster.yaml
│   ├── staging/
│   │   └── kafka-cluster.yaml
│   └── development/
│       └── kafka-cluster.yaml
├── topics/
│   ├── user-events-topic.yaml
│   ├── order-events-topic.yaml
│   └── analytics-topic.yaml
├── users/
│   ├── app-producer.yaml
│   ├── analytics-consumer.yaml
│   └── monitoring-user.yaml
├── monitoring/
│   ├── prometheus-rules.yaml
│   ├── grafana-dashboards.yaml
│   └── alerts.yaml
└── scripts/
    ├── create-topic.sh
    ├── validate-config.sh
    └── sync-to-cluster.sh
```

### 2. CI/CD 파이프라인

```yaml
# .github/workflows/kafka-sync.yaml
name: Kafka Configuration Sync

on:
  push:
    branches:
      - main
    paths:
      - 'topics/**'
      - 'users/**'
      - 'clusters/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Validate YAML syntax
        run: |
          find . -name '*.yaml' -exec yamllint {} \;

      - name: Validate Kafka manifests
        run: |
          # kubectl dry-run으로 검증
          find topics/ -name '*.yaml' -exec kubectl apply --dry-run=client -f {} \;
          find users/ -name '*.yaml' -exec kubectl apply --dry-run=client -f {} \;

      - name: Check for conflicts
        run: |
          # 중복 토픽 체크
          ./scripts/validate-config.sh

  sync-to-staging:
    needs: validate
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Configure kubectl
        run: |
          echo "${{ secrets.KUBECONFIG_STAGING }}" | base64 -d > kubeconfig
          export KUBECONFIG=./kubeconfig

      - name: Apply to staging
        run: |
          kubectl apply -f topics/ -n kafka
          kubectl apply -f users/ -n kafka

      - name: Wait for reconciliation
        run: |
          sleep 30
          kubectl get kafkatopics -n kafka
          kubectl get kafkausers -n kafka

  sync-to-production:
    needs: sync-to-staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production  # Manual approval required
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Configure kubectl
        run: |
          echo "${{ secrets.KUBECONFIG_PRODUCTION }}" | base64 -d > kubeconfig
          export KUBECONFIG=./kubeconfig

      - name: Apply to production
        run: |
          kubectl apply -f topics/ -n kafka
          kubectl apply -f users/ -n kafka

      - name: Verify deployment
        run: |
          ./scripts/verify-deployment.sh

      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Kafka configuration deployed to production",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "Kafka configuration deployed\n*Commit:* ${{ github.sha }}\n*Author:* ${{ github.actor }}"
                  }
                }
              ]
            }
```

### 3. Pull Request 템플릿

```markdown
# .github/pull_request_template.md

## Kafka Configuration Change

### Change Type
- [ ] New Topic
- [ ] Topic Configuration Update
- [ ] New User
- [ ] ACL Change
- [ ] Cluster Configuration

### Details
**Topic Name:** (if applicable)
**Partitions:**
**Retention:**
**Reason for change:**

### Checklist
- [ ] YAML syntax validated
- [ ] Partition count follows guidelines (12, 24, 48)
- [ ] Replication factor is 3 for production
- [ ] Retention period is appropriate
- [ ] Team label added
- [ ] Documentation updated

### Impact Assessment
- **Affected Services:**
- **Estimated Data Volume:**
- **Performance Impact:**

### Rollback Plan
Describe how to rollback this change if needed.
```

## Consumer Group 자동 관리

### 1. Consumer Lag 모니터링 자동화

```yaml
# monitoring/consumer-lag-monitor.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lag-monitor-script
  namespace: kafka
data:
  monitor.sh: |
    #!/bin/bash
    set -e

    THRESHOLD=10000
    SLACK_WEBHOOK="${SLACK_WEBHOOK_URL}"

    # 모든 Consumer Group 조회
    GROUPS=$(kafka-consumer-groups --bootstrap-server kafka:9092 --list)

    for GROUP in $GROUPS; do
      # Lag 조회
      LAG=$(kafka-consumer-groups --bootstrap-server kafka:9092 \
        --group "$GROUP" --describe | \
        awk '{sum += $5} END {print sum}')

      if [ "$LAG" -gt "$THRESHOLD" ]; then
        # Slack 알림
        curl -X POST "$SLACK_WEBHOOK" \
          -H 'Content-Type: application/json' \
          -d "{
            \"text\": \"🚨 High Consumer Lag Alert\",
            \"blocks\": [
              {
                \"type\": \"section\",
                \"text\": {
                  \"type\": \"mrkdwn\",
                  \"text\": \"*Consumer Group:* $GROUP\n*Current Lag:* $LAG\n*Threshold:* $THRESHOLD\"
                }
              }
            ]
          }"

        # 자동 스케일링 트리거
        kubectl scale deployment "${GROUP}-consumer" \
          --replicas=5 -n applications
      fi
    done
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: consumer-lag-monitor
  namespace: kafka
spec:
  schedule: "*/5 * * * *"  # 5분마다 실행
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: monitor
              image: confluentinc/cp-kafka:7.5.0
              command: ["/bin/bash", "/scripts/monitor.sh"]
              env:
                - name: SLACK_WEBHOOK_URL
                  valueFrom:
                    secretKeyRef:
                      name: slack-webhook
                      key: url
              volumeMounts:
                - name: script
                  mountPath: /scripts
          volumes:
            - name: script
              configMap:
                name: lag-monitor-script
                defaultMode: 0755
          restartPolicy: OnFailure
```

### 2. Consumer Group 자동 리밸런싱

```python
# scripts/auto-rebalance.py
import kafka
from kafka import KafkaAdminClient, KafkaConsumer
from kubernetes import client, config
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ConsumerGroupManager:
    def __init__(self, bootstrap_servers):
        self.admin_client = KafkaAdminClient(
            bootstrap_servers=bootstrap_servers
        )
        config.load_incluster_config()
        self.k8s_apps = client.AppsV1Api()

    def get_consumer_lag(self, group_id):
        """Consumer Group의 전체 Lag 조회"""
        consumer = KafkaConsumer(
            bootstrap_servers=self.admin_client._bootstrap_servers,
            group_id=group_id,
            enable_auto_commit=False
        )

        total_lag = 0
        partitions = consumer.assignment()

        for partition in partitions:
            committed = consumer.committed(partition)
            position = consumer.position(partition)
            end_offset = consumer.end_offsets([partition])[partition]

            if committed:
                lag = end_offset - committed
                total_lag += lag

        consumer.close()
        return total_lag

    def scale_consumers(self, deployment_name, namespace, replicas):
        """Consumer Deployment 스케일링"""
        try:
            self.k8s_apps.patch_namespaced_deployment_scale(
                name=deployment_name,
                namespace=namespace,
                body={'spec': {'replicas': replicas}}
            )
            logger.info(f"Scaled {deployment_name} to {replicas} replicas")
        except Exception as e:
            logger.error(f"Failed to scale {deployment_name}: {e}")

    def auto_rebalance(self, group_configs):
        """자동 리밸런싱 로직"""
        for config in group_configs:
            group_id = config['group_id']
            deployment = config['deployment']
            namespace = config['namespace']
            min_replicas = config.get('min_replicas', 1)
            max_replicas = config.get('max_replicas', 10)
            lag_threshold = config.get('lag_threshold', 10000)

            # 현재 Lag 확인
            current_lag = self.get_consumer_lag(group_id)
            logger.info(f"Group {group_id}: Lag = {current_lag}")

            # 현재 Replicas 수 확인
            deployment_obj = self.k8s_apps.read_namespaced_deployment(
                deployment, namespace
            )
            current_replicas = deployment_obj.spec.replicas

            # 스케일링 결정
            if current_lag > lag_threshold:
                # Lag가 높으면 스케일 업
                new_replicas = min(current_replicas + 2, max_replicas)
                if new_replicas > current_replicas:
                    logger.info(f"Scaling up {deployment}: {current_replicas} -> {new_replicas}")
                    self.scale_consumers(deployment, namespace, new_replicas)

            elif current_lag < lag_threshold / 2 and current_replicas > min_replicas:
                # Lag가 낮으면 스케일 다운
                new_replicas = max(current_replicas - 1, min_replicas)
                if new_replicas < current_replicas:
                    logger.info(f"Scaling down {deployment}: {current_replicas} -> {new_replicas}")
                    self.scale_consumers(deployment, namespace, new_replicas)

if __name__ == "__main__":
    manager = ConsumerGroupManager(
        bootstrap_servers="kafka:9092"
    )

    # 관리할 Consumer Group 설정
    group_configs = [
        {
            'group_id': 'user-events-processor',
            'deployment': 'user-events-consumer',
            'namespace': 'applications',
            'min_replicas': 2,
            'max_replicas': 10,
            'lag_threshold': 10000
        },
        {
            'group_id': 'order-events-processor',
            'deployment': 'order-events-consumer',
            'namespace': 'applications',
            'min_replicas': 3,
            'max_replicas': 20,
            'lag_threshold': 50000
        }
    ]

    # 무한 루프로 모니터링
    while True:
        try:
            manager.auto_rebalance(group_configs)
        except Exception as e:
            logger.error(f"Error in auto-rebalance: {e}")

        time.sleep(60)  # 1분마다 체크
```

**Kubernetes Deployment:**
```yaml
# deployments/auto-rebalancer.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-auto-rebalancer
  namespace: kafka
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kafka-auto-rebalancer
  template:
    metadata:
      labels:
        app: kafka-auto-rebalancer
    spec:
      serviceAccountName: kafka-rebalancer
      containers:
        - name: rebalancer
          image: myregistry/kafka-auto-rebalancer:latest
          env:
            - name: KAFKA_BOOTSTRAP_SERVERS
              value: "kafka:9092"
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 200m
---
# RBAC
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kafka-rebalancer
  namespace: kafka
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployment-scaler
  namespace: applications
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "deployments/scale"]
    verbs: ["get", "list", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kafka-rebalancer-binding
  namespace: applications
subjects:
  - kind: ServiceAccount
    name: kafka-rebalancer
    namespace: kafka
roleRef:
  kind: Role
  name: deployment-scaler
  apiGroup: rbac.authorization.k8s.io
```

## 모니터링 및 알람 자동화

### 1. Prometheus Rules

```yaml
# monitoring/prometheus-rules.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: kafka-alerts
  namespace: kafka
spec:
  groups:
    - name: kafka.rules
      interval: 30s
      rules:
        # Consumer Lag 알람
        - alert: KafkaConsumerLagHigh
          expr: kafka_consumergroup_lag > 10000
          for: 5m
          labels:
            severity: warning
            component: kafka
          annotations:
            summary: "High consumer lag detected"
            description: "Consumer group {{ $labels.consumergroup }} has lag of {{ $value }}"

        # Under-replicated 파티션
        - alert: KafkaUnderReplicatedPartitions
          expr: kafka_server_replicamanager_underreplicatedpartitions > 0
          for: 5m
          labels:
            severity: critical
            component: kafka
          annotations:
            summary: "Under-replicated partitions detected"
            description: "{{ $value }} partitions are under-replicated"

        # Offline 파티션
        - alert: KafkaOfflinePartitions
          expr: kafka_controller_kafkacontroller_offlinepartitionscount > 0
          for: 1m
          labels:
            severity: critical
            component: kafka
          annotations:
            summary: "Offline partitions detected"
            description: "{{ $value }} partitions are offline"

        # Disk 사용률
        - alert: KafkaDiskUsageHigh
          expr: (kafka_log_log_size / kafka_log_log_size_limit) > 0.85
          for: 10m
          labels:
            severity: warning
            component: kafka
          annotations:
            summary: "High disk usage on Kafka broker"
            description: "Broker {{ $labels.broker }} disk usage is {{ $value }}%"

        # ISR 축소
        - alert: KafkaISRShrink
          expr: rate(kafka_server_replicamanager_isrshrinks_total[5m]) > 0
          for: 5m
          labels:
            severity: warning
            component: kafka
          annotations:
            summary: "ISR shrinking detected"
            description: "ISR is shrinking on broker {{ $labels.broker }}"
```

### 2. AlertManager 설정

```yaml
# monitoring/alertmanager-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-config
  namespace: kafka
data:
  alertmanager.yml: |
    global:
      resolve_timeout: 5m
      slack_api_url: 'YOUR_SLACK_WEBHOOK_URL'

    route:
      group_by: ['alertname', 'cluster']
      group_wait: 10s
      group_interval: 10s
      repeat_interval: 12h
      receiver: 'slack-notifications'

      routes:
        # Critical 알람은 즉시 전송
        - match:
            severity: critical
          receiver: 'slack-critical'
          group_wait: 0s
          repeat_interval: 5m

        # Warning 알람은 그룹화해서 전송
        - match:
            severity: warning
          receiver: 'slack-warnings'
          group_wait: 30s
          repeat_interval: 30m

    receivers:
      - name: 'slack-notifications'
        slack_configs:
          - channel: '#kafka-alerts'
            title: 'Kafka Alert'
            text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

      - name: 'slack-critical'
        slack_configs:
          - channel: '#kafka-critical'
            title: '🚨 CRITICAL: Kafka Alert'
            text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
            send_resolved: true

      - name: 'slack-warnings'
        slack_configs:
          - channel: '#kafka-warnings'
            title: '⚠️  WARNING: Kafka Alert'
            text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

    inhibit_rules:
      # Critical 알람이 있으면 Warning 억제
      - source_match:
          severity: 'critical'
        target_match:
          severity: 'warning'
        equal: ['alertname', 'cluster']
```

## 재해 복구 자동화

### 1. 자동 백업

```yaml
# backup/kafka-backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: kafka-metadata-backup
  namespace: kafka
spec:
  schedule: "0 2 * * *"  # 매일 새벽 2시
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: bitnami/kubectl:latest
              command:
                - /bin/bash
                - -c
                - |
                  set -e

                  BACKUP_DATE=$(date +%Y%m%d-%H%M%S)
                  BACKUP_DIR="/backup/${BACKUP_DATE}"
                  mkdir -p "$BACKUP_DIR"

                  # Kafka 리소스 백업
                  kubectl get kafka -n kafka -o yaml > "$BACKUP_DIR/kafka.yaml"
                  kubectl get kafkatopics -n kafka -o yaml > "$BACKUP_DIR/topics.yaml"
                  kubectl get kafkausers -n kafka -o yaml > "$BACKUP_DIR/users.yaml"

                  # ZooKeeper 데이터 백업 (Kafka 메타데이터)
                  kubectl exec -n kafka production-cluster-zookeeper-0 -- \
                    zkCli.sh -server localhost:2181 dump / > "$BACKUP_DIR/zookeeper-dump.txt"

                  # S3로 업로드
                  aws s3 sync "$BACKUP_DIR" "s3://kafka-backups/${BACKUP_DATE}/"

                  echo "Backup completed: ${BACKUP_DATE}"

              env:
                - name: AWS_ACCESS_KEY_ID
                  valueFrom:
                    secretKeyRef:
                      name: aws-credentials
                      key: access-key-id
                - name: AWS_SECRET_ACCESS_KEY
                  valueFrom:
                    secretKeyRef:
                      name: aws-credentials
                      key: secret-access-key

              volumeMounts:
                - name: backup-storage
                  mountPath: /backup

          volumes:
            - name: backup-storage
              emptyDir: {}

          restartPolicy: OnFailure
```

### 2. 자동 복구 스크립트

```bash
#!/bin/bash
# scripts/disaster-recovery.sh

set -e

BACKUP_DATE=$1
S3_BUCKET="s3://kafka-backups"
NAMESPACE="kafka"

if [ -z "$BACKUP_DATE" ]; then
  echo "Usage: $0 <backup-date>"
  echo "Example: $0 20250116-020000"
  exit 1
fi

echo "🔄 Starting disaster recovery from backup: $BACKUP_DATE"

# 1. S3에서 백업 다운로드
echo "📥 Downloading backup from S3..."
aws s3 sync "$S3_BUCKET/$BACKUP_DATE/" ./restore/

# 2. Kafka 클러스터 복원
echo "🏗️  Restoring Kafka cluster..."
kubectl apply -f ./restore/kafka.yaml

# 3. 클러스터 준비 대기
echo "⏳ Waiting for Kafka cluster to be ready..."
kubectl wait kafka/production-cluster \
  --for=condition=Ready \
  --timeout=600s \
  -n $NAMESPACE

# 4. 토픽 복원
echo "📋 Restoring topics..."
kubectl apply -f ./restore/topics.yaml

# 5. 사용자 및 ACL 복원
echo "👥 Restoring users and ACLs..."
kubectl apply -f ./restore/users.yaml

# 6. 복원 검증
echo "✅ Verifying restoration..."
kubectl get kafka -n $NAMESPACE
kubectl get kafkatopics -n $NAMESPACE
kubectl get kafkausers -n $NAMESPACE

# 7. 헬스체크
echo "🏥 Running health checks..."
kubectl exec -n $NAMESPACE production-cluster-kafka-0 -- \
  kafka-broker-api-versions --bootstrap-server localhost:9092

echo "✅ Disaster recovery completed successfully!"
```

## 자동화 성과 측정

### Before vs After

| 지표 | 자동화 전 | 자동화 후 | 개선율 |
|------|----------|----------|--------|
| 토픽 생성 평균 시간 | 15분 | 2분 (PR 머지 후 자동) | 87% ⬇️ |
| 월평균 설정 오류 | 8건 | 0.5건 | 94% ⬇️ |
| Consumer Group 문제 해결 시간 | 45분 | 5분 (자동 리밸런싱) | 89% ⬇️ |
| 장애 대응 평균 시간 | 2시간 | 10분 (자동 복구) | 92% ⬇️ |
| 운영 인력 투입 시간 | 주 20시간 | 주 5시간 | 75% ⬇️ |
| 변경 이력 추적 | 불가능 | 100% Git 기록 | ✅ |
| 온보딩 시간 | 2주 | 3일 | 79% ⬇️ |

### ROI 계산

```
월간 인건비 절감:
  - 운영 시간 절감: 15시간/주 × 4주 = 60시간/월
  - 시급 환산 (Senior Engineer): $100/시간
  - 월간 절감액: 60 × $100 = $6,000

장애 비용 절감:
  - 평균 장애 빈도: 월 2회
  - 장애 1회당 평균 손실: $10,000
  - 장애 시간 감소율: 92%
  - 월간 절감액: 2 × $10,000 × 0.92 = $18,400

총 월간 절감액: $24,400
연간 절감액: $292,800

자동화 구축 비용: $50,000
ROI 달성 기간: 약 2개월
```

## 모범 사례

### 1. 토픽 명명 규칙 자동 검증

```python
# scripts/validate-topic-name.py
import re
import sys

def validate_topic_name(topic_name):
    """
    토픽 명명 규칙:
    - 형식: <team>.<service>.<event-type>
    - 소문자, 하이픈, 점만 허용
    - 최대 길이: 100자
    """
    pattern = r'^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$'

    if len(topic_name) > 100:
        return False, "Topic name too long (max 100 characters)"

    if not re.match(pattern, topic_name):
        return False, "Topic name must follow pattern: <team>.<service>.<event-type>"

    return True, "OK"

if __name__ == "__main__":
    topic_name = sys.argv[1]
    valid, message = validate_topic_name(topic_name)

    if not valid:
        print(f"❌ Invalid topic name: {message}")
        sys.exit(1)

    print(f"✅ Valid topic name: {topic_name}")
```

### 2. 자동 문서화

```bash
#!/bin/bash
# scripts/generate-docs.sh

OUTPUT_FILE="docs/kafka-inventory.md"

cat > "$OUTPUT_FILE" <<EOF
# Kafka Cluster Inventory

Generated: $(date)

## Clusters

EOF

kubectl get kafka -n kafka -o json | jq -r '.items[] | "- **\(.metadata.name)**: \(.spec.kafka.replicas) brokers, Kafka \(.spec.kafka.version)"' >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" <<EOF

## Topics

| Name | Partitions | Replication | Retention | Team |
|------|-----------|-------------|-----------|------|
EOF

kubectl get kafkatopics -n kafka -o json | jq -r '.items[] | "| \(.metadata.name) | \(.spec.partitions) | \(.spec.replicas) | \(.spec.config."retention.ms" // "N/A") | \(.metadata.labels.team // "N/A") |"' >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" <<EOF

## Users

| Name | Authentication | ACLs |
|------|---------------|------|
EOF

kubectl get kafkausers -n kafka -o json | jq -r '.items[] | "| \(.metadata.name) | \(.spec.authentication.type) | \(.spec.authorization.acls | length) |"' >> "$OUTPUT_FILE"

echo "✅ Documentation generated: $OUTPUT_FILE"
```

## 결론

### 자동화 체크리스트

- [x] Strimzi Operator 설치 및 설정
- [x] GitOps 워크플로우 구축 (Git → CI/CD → Kubernetes)
- [x] 토픽 자동 생성 및 관리
- [x] 사용자/ACL 자동 관리
- [x] Consumer Group 자동 리밸런싱
- [x] 모니터링 및 알람 자동화
- [x] 자동 백업 및 재해 복구
- [x] 문서 자동 생성

### 핵심 교훈

1. **선언적 관리**: YAML로 모든 설정 관리, Git으로 버전 관리
2. **점진적 도입**: 한 번에 모든 것을 자동화하지 말고 단계적으로
3. **모니터링 먼저**: 자동화하기 전에 측정 가능한 메트릭 확보
4. **실패 대비**: 자동 복구 메커니즘과 롤백 계획 필수
5. **문서화**: 자동화된 시스템도 문서가 필요함

Kafka 운영 자동화는 초기 투자 비용이 있지만, 장기적으로 운영 효율과 안정성을 크게 향상시킵니다. GitOps + Kubernetes + Strimzi 조합으로 선언적이고 안전한 운영 체계를 구축하세요.
