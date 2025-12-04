---
title: "OAuth 기반 Kafka 인증 구조"
date: 2025-01-16
topic: "Security"
topic_icon: "🔐"
topic_description: "Kafka OAuth2 인증 구현 및 Keycloak 통합"
tags: ["Kafka", "OAuth2", "Security", "Keycloak", "SASL"]
categories: ["Security", "Kafka"]
draft: false
---

## 개요

Kafka 클러스터에 OAuth2 기반 인증을 도입하면서 얻은 경험을 정리합니다. 기존 SASL/SCRAM-SHA-512에서 SASL/OAUTHBEARER로 전환하여 중앙화된 인증 관리와 토큰 기반 보안을 구현한 과정을 공유합니다.

## 기존 인증 방식의 문제점

### SASL/SCRAM-SHA-512의 한계

```yaml
# 기존 방식: Kafka User 리소스로 사용자 관리
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: my-app-user
  labels:
    strimzi.io/cluster: production-cluster
spec:
  authentication:
    type: scram-sha-512
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: my-topic
        operations: [Read, Write]
```

**문제점:**
1. **분산된 사용자 관리**: Kafka별로 사용자 생성 및 관리
2. **비밀번호 관리 어려움**: 수동으로 비밀번호 변경, 주기적 갱신 불가
3. **권한 관리 복잡성**: 각 Kafka 클러스터마다 ACL 설정 필요
4. **감사 로그 부족**: 누가 언제 접속했는지 추적 어려움
5. **토큰 만료 없음**: 한 번 발급된 자격증명은 영구적

### 실제 운영 이슈

```
문제 상황:
- 퇴사자 계정 관리: Kafka User 수동 삭제 필요 (휴먼 에러 위험)
- 비밀번호 유출: 영구적 자격증명이라 즉시 무효화 어려움
- 멀티 클러스터: 3개 환경(dev, staging, prod)마다 사용자 생성
- 권한 변경: 각 환경마다 ACL 수정 필요
- 모니터링: 누가 접속했는지 파악 불가

측정 지표:
- 사용자 프로비저닝 시간: 평균 30분 (3개 환경 × 10분)
- 권한 변경 시간: 평균 45분
- 보안 인시던트 대응: 평균 2시간 (수동 비밀번호 변경)
```

## OAuth2 기반 인증 아키텍처

### 전체 구조

```
┌─────────────────┐
│  Client App     │
│  (Producer/     │
│   Consumer)     │
└────────┬────────┘
         │ 1. Request Access Token
         │    (Client ID + Secret)
         ↓
┌─────────────────┐
│   Keycloak      │ ← Identity Provider (IdP)
│   (OAuth2)      │    - 사용자 관리
└────────┬────────┘    - 토큰 발급
         │ 2. Issue JWT Access Token
         │    (exp, scope, claims)
         ↓
┌─────────────────┐
│  Kafka Broker   │
│  + OAuth        │
│  Validator      │
└────────┬────────┘
         │ 3. Validate Token
         │    - JWT Signature 검증
         │    - Expiration 확인
         │    - Scope/Claim 검증
         ↓
┌─────────────────┐
│  Kafka Topic    │
│  (Authorized)   │
└─────────────────┘
```

### 인증 플로우

```
[Client Credentials Flow]

1. Client → Keycloak
   POST /realms/kafka/protocol/openid-connect/token
   {
     "grant_type": "client_credentials",
     "client_id": "kafka-producer",
     "client_secret": "xxx",
     "scope": "kafka"
   }

2. Keycloak → Client
   {
     "access_token": "eyJhbGci...",
     "token_type": "Bearer",
     "expires_in": 300,
     "scope": "kafka"
   }

3. Client → Kafka
   SASL/OAUTHBEARER with access_token

4. Kafka Broker
   - JWT Signature 검증 (공개키)
   - Expiration 확인
   - Claims 추출 (username, scope)
   - ACL 매핑 및 권한 확인

5. Kafka → Client
   - Authorization Success/Failure
```

## Keycloak 설정

### 1. Realm 및 Client 생성

```bash
# Keycloak 설치 (Kubernetes)
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install keycloak bitnami/keycloak \
  --set auth.adminUser=admin \
  --set auth.adminPassword=admin \
  --namespace kafka

# Keycloak Admin Console 접속
kubectl port-forward svc/keycloak 8080:80 -n kafka
# http://localhost:8080
```

**Realm 생성:**
```
1. Admin Console → Add Realm
   - Name: kafka
   - Enabled: ON

2. Realm Settings → Tokens
   - Access Token Lifespan: 5 minutes
   - Refresh Token Lifespan: 30 minutes
   - Access Token Lifespan For Implicit Flow: 15 minutes
```

**Client 생성 (Producer 예시):**
```
1. Clients → Create
   - Client ID: kafka-producer
   - Client Protocol: openid-connect
   - Access Type: confidential
   - Service Accounts Enabled: ON
   - Authorization Enabled: OFF

2. Credentials Tab
   - Secret: (자동 생성됨, 복사해두기)

3. Service Account Roles
   - Client Roles → realm-management
   - Assign Role: view-users

4. Mappers (Custom Claims 추가)
   - Create Protocol Mapper
   - Name: kafka-username
   - Mapper Type: User Property
   - Property: username
   - Token Claim Name: preferred_username
   - Claim JSON Type: String
   - Add to ID token: ON
   - Add to access token: ON
```

### 2. 사용자 및 그룹 관리

```bash
# Keycloak CLI로 사용자 생성
kubectl exec -it keycloak-0 -n kafka -- bash

# Realm admin 토큰 획득
ADMIN_TOKEN=$(curl -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

# 사용자 생성
curl -X POST http://localhost:8080/admin/realms/kafka/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "producer-service",
    "enabled": true,
    "credentials": [{
      "type": "password",
      "value": "secure-password",
      "temporary": false
    }],
    "attributes": {
      "kafka_group": ["producers"],
      "kafka_scope": ["write"]
    }
  }'

# 그룹 생성 및 권한 매핑
curl -X POST http://localhost:8080/admin/realms/kafka/groups \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "kafka-producers",
    "attributes": {
      "kafka_acl": ["topic:my-topic:write"]
    }
  }'
```

## Strimzi Kafka OAuth 설정

### 1. Kafka Cluster OAuth 설정

```yaml
# kafka-cluster-oauth.yaml
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
      # Plain listener (내부용)
      - name: plain
        port: 9092
        type: internal
        tls: false

      # OAuth listener (외부용)
      - name: oauth
        port: 9093
        type: internal
        tls: true
        authentication:
          type: oauth
          validIssuerUri: http://keycloak.kafka.svc.cluster.local/realms/kafka
          jwksEndpointUri: http://keycloak.kafka.svc.cluster.local/realms/kafka/protocol/openid-connect/certs
          userNameClaim: preferred_username
          enableOauthBearer: true
          maxSecondsWithoutReauthentication: 3600

          # Token 검증 설정
          checkIssuer: true
          checkAudience: true
          clientAudience: kafka

          # Custom claim 검증
          customClaimCheck: "@.kafka_scope && @.kafka_scope =~ /.*write.*/"

    authorization:
      type: keycloak
      tokenEndpointUri: http://keycloak.kafka.svc.cluster.local/realms/kafka/protocol/openid-connect/token
      clientId: kafka-broker
      delegateToKafkaAcls: true
      superUsers:
        - User:admin
        - User:CN=kafka-broker

    config:
      auto.create.topics.enable: false
      log.retention.hours: 168

  zookeeper:
    replicas: 3

  entityOperator:
    topicOperator:
      watchedNamespace: kafka
    userOperator:
      watchedNamespace: kafka
```

### 2. Kafka User OAuth 매핑

```yaml
# kafka-user-oauth.yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: oauth-producer
  namespace: kafka
  labels:
    strimzi.io/cluster: production-cluster
spec:
  # OAuth 사용자는 authentication 섹션 없음
  # Keycloak에서 관리

  authorization:
    type: simple
    acls:
      # Keycloak username과 매핑
      - resource:
          type: topic
          name: user-events
          patternType: literal
        operations:
          - Write
          - Describe
        host: "*"

      - resource:
          type: group
          name: producer-group
          patternType: literal
        operations:
          - Read
        host: "*"
```

## Client 구현

### 1. Java Producer (Spring Kafka)

```java
// application.yml
spring:
  kafka:
    bootstrap-servers: kafka:9093
    security:
      protocol: SASL_SSL
    properties:
      sasl.mechanism: OAUTHBEARER
      sasl.jaas.config: |
        org.apache.kafka.common.security.oauthbearer.OAuthBearerLoginModule required
        oauth.client.id="kafka-producer"
        oauth.client.secret="${KAFKA_CLIENT_SECRET}"
        oauth.token.endpoint.uri="http://keycloak/realms/kafka/protocol/openid-connect/token"
        oauth.scope="kafka";
      sasl.login.callback.handler.class: io.strimzi.kafka.oauth.client.JaasClientOauthLoginCallbackHandler

// Kafka Configuration
@Configuration
public class KafkaProducerConfig {

    @Value("${spring.kafka.properties.sasl.jaas.config}")
    private String saslJaasConfig;

    @Bean
    public ProducerFactory<String, String> producerFactory() {
        Map<String, Object> configProps = new HashMap<>();
        configProps.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "kafka:9093");
        configProps.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        configProps.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);

        // Security
        configProps.put(CommonClientConfigs.SECURITY_PROTOCOL_CONFIG, "SASL_SSL");
        configProps.put(SaslConfigs.SASL_MECHANISM, "OAUTHBEARER");
        configProps.put(SaslConfigs.SASL_JAAS_CONFIG, saslJaasConfig);
        configProps.put(SaslConfigs.SASL_LOGIN_CALLBACK_HANDLER_CLASS,
            "io.strimzi.kafka.oauth.client.JaasClientOauthLoginCallbackHandler");

        // OAuth 설정
        configProps.put("oauth.access.token.is.jwt", "true");
        configProps.put("oauth.token.endpoint.uri",
            "http://keycloak/realms/kafka/protocol/openid-connect/token");

        return new DefaultKafkaProducerFactory<>(configProps);
    }

    @Bean
    public KafkaTemplate<String, String> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }
}

// Producer Service
@Service
@Slf4j
public class EventProducer {

    @Autowired
    private KafkaTemplate<String, String> kafkaTemplate;

    public void sendEvent(String topic, String key, String message) {
        try {
            CompletableFuture<SendResult<String, String>> future =
                kafkaTemplate.send(topic, key, message);

            future.whenComplete((result, ex) -> {
                if (ex == null) {
                    log.info("Sent message=[{}] with offset=[{}]",
                        message, result.getRecordMetadata().offset());
                } else {
                    log.error("Unable to send message=[{}] due to : {}",
                        message, ex.getMessage());
                }
            });
        } catch (Exception e) {
            log.error("Error sending message: {}", e.getMessage());
            throw new RuntimeException("Failed to send message", e);
        }
    }
}
```

### 2. Python Consumer

```python
# requirements.txt
kafka-python==2.0.2
requests==2.31.0
python-keycloak==3.8.0

# kafka_oauth_consumer.py
import requests
import time
from kafka import KafkaConsumer
from kafka.errors import KafkaError

class OAuthTokenProvider:
    def __init__(self, token_endpoint, client_id, client_secret):
        self.token_endpoint = token_endpoint
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token = None
        self.expires_at = 0

    def get_token(self):
        # 토큰 만료 5분 전에 갱신
        if time.time() < self.expires_at - 300:
            return self.access_token

        # 새 토큰 요청
        response = requests.post(
            self.token_endpoint,
            data={
                'grant_type': 'client_credentials',
                'client_id': self.client_id,
                'client_secret': self.client_secret,
                'scope': 'kafka'
            },
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        if response.status_code == 200:
            token_data = response.json()
            self.access_token = token_data['access_token']
            self.expires_at = time.time() + token_data['expires_in']
            print(f"✅ New token acquired, expires in {token_data['expires_in']}s")
            return self.access_token
        else:
            raise Exception(f"Failed to get token: {response.text}")

def oauth_token_provider(token_provider):
    """Kafka OAuth 콜백 함수"""
    return token_provider.get_token()

# Consumer 설정
def create_oauth_consumer(
    bootstrap_servers,
    topic,
    group_id,
    token_endpoint,
    client_id,
    client_secret
):
    # Token Provider 생성
    token_provider = OAuthTokenProvider(
        token_endpoint=token_endpoint,
        client_id=client_id,
        client_secret=client_secret
    )

    # Consumer 생성
    consumer = KafkaConsumer(
        topic,
        bootstrap_servers=bootstrap_servers,
        group_id=group_id,

        # Security 설정
        security_protocol='SASL_SSL',
        sasl_mechanism='OAUTHBEARER',
        sasl_oauth_token_provider=lambda: oauth_token_provider(token_provider),

        # SSL 설정 (선택사항)
        # ssl_cafile='/path/to/ca-cert',
        # ssl_certfile='/path/to/client-cert',
        # ssl_keyfile='/path/to/client-key',

        # Consumer 설정
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        value_deserializer=lambda v: v.decode('utf-8')
    )

    return consumer

# 사용 예시
if __name__ == '__main__':
    consumer = create_oauth_consumer(
        bootstrap_servers='kafka:9093',
        topic='user-events',
        group_id='analytics-consumer',
        token_endpoint='http://keycloak/realms/kafka/protocol/openid-connect/token',
        client_id='kafka-consumer',
        client_secret='your-client-secret'
    )

    print("🔄 Consuming messages...")
    try:
        for message in consumer:
            print(f"📨 Received: {message.value}")
            print(f"   Partition: {message.partition}, Offset: {message.offset}")
    except KeyboardInterrupt:
        print("\n⏹️  Shutting down consumer...")
    finally:
        consumer.close()
```

### 3. Node.js Producer (KafkaJS)

```javascript
// package.json
{
  "dependencies": {
    "kafkajs": "^2.2.4",
    "axios": "^1.6.0"
  }
}

// oauth-token-provider.js
const axios = require('axios');

class OAuthTokenProvider {
  constructor(tokenEndpoint, clientId, clientSecret) {
    this.tokenEndpoint = tokenEndpoint;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async getToken() {
    // 토큰 만료 5분 전에 갱신
    if (Date.now() < this.expiresAt - 300000) {
      return this.accessToken;
    }

    // 새 토큰 요청
    const response = await axios.post(
      this.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'kafka'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    this.accessToken = response.data.access_token;
    this.expiresAt = Date.now() + (response.data.expires_in * 1000);

    console.log(`✅ New token acquired, expires in ${response.data.expires_in}s`);
    return this.accessToken;
  }
}

// kafka-producer.js
const { Kafka } = require('kafkajs');
const OAuthTokenProvider = require('./oauth-token-provider');

const tokenProvider = new OAuthTokenProvider(
  'http://keycloak/realms/kafka/protocol/openid-connect/token',
  'kafka-producer',
  'your-client-secret'
);

const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['kafka:9093'],

  // OAuth 설정
  sasl: {
    mechanism: 'oauthbearer',
    oauthBearerProvider: async () => {
      const token = await tokenProvider.getToken();
      return {
        value: token
      };
    }
  },

  // SSL 설정
  ssl: {
    rejectUnauthorized: false, // 개발 환경용, 프로덕션에서는 true
    // ca: [fs.readFileSync('/path/to/ca-cert', 'utf-8')],
    // cert: fs.readFileSync('/path/to/client-cert', 'utf-8'),
    // key: fs.readFileSync('/path/to/client-key', 'utf-8')
  }
});

const producer = kafka.producer();

async function sendMessage(topic, key, value) {
  await producer.connect();

  try {
    const result = await producer.send({
      topic: topic,
      messages: [
        {
          key: key,
          value: value
        }
      ]
    });

    console.log(`✅ Message sent successfully:`, result);
  } catch (error) {
    console.error(`❌ Error sending message:`, error);
    throw error;
  } finally {
    await producer.disconnect();
  }
}

// 사용 예시
(async () => {
  await sendMessage('user-events', 'user-123', JSON.stringify({
    userId: '123',
    action: 'login',
    timestamp: new Date().toISOString()
  }));
})();
```

## 모니터링 및 감사

### 1. Keycloak 이벤트 로깅

```yaml
# Keycloak Realm Events 설정
Realm Settings → Events:
  - Save Events: ON
  - Event Listeners: jboss-logging
  - Saved Types:
    - LOGIN
    - LOGIN_ERROR
    - LOGOUT
    - CLIENT_LOGIN
    - CLIENT_LOGIN_ERROR
    - REFRESH_TOKEN
```

**이벤트 조회:**
```bash
# Keycloak Events API
curl -X GET "http://keycloak/admin/realms/kafka/events" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# 출력 예시
{
  "events": [
    {
      "time": 1705392000000,
      "type": "CLIENT_LOGIN",
      "realmId": "kafka",
      "clientId": "kafka-producer",
      "userId": null,
      "ipAddress": "10.244.1.5",
      "details": {
        "grant_type": "client_credentials",
        "scope": "kafka",
        "client_auth_method": "client-secret"
      }
    }
  ]
}
```

### 2. Kafka Broker OAuth 메트릭

```yaml
# Prometheus Exporter 설정
apiVersion: v1
kind: ConfigMap
metadata:
  name: kafka-metrics-config
  namespace: kafka
data:
  kafka-metrics-config.yml: |
    lowercaseOutputName: true
    rules:
      # OAuth 인증 메트릭
      - pattern: kafka.server<type=oauth-metrics><>(token-validation-time-ms)
        name: kafka_oauth_token_validation_time_ms
        type: GAUGE

      - pattern: kafka.server<type=oauth-metrics><>(successful-authentications-total)
        name: kafka_oauth_successful_authentications_total
        type: COUNTER

      - pattern: kafka.server<type=oauth-metrics><>(failed-authentications-total)
        name: kafka_oauth_failed_authentications_total
        type: COUNTER

      - pattern: kafka.server<type=oauth-metrics><>(token-renewals-total)
        name: kafka_oauth_token_renewals_total
        type: COUNTER
```

**Grafana 대시보드 쿼리:**
```promql
# 인증 성공률
sum(rate(kafka_oauth_successful_authentications_total[5m]))
  / (
    sum(rate(kafka_oauth_successful_authentications_total[5m]))
    + sum(rate(kafka_oauth_failed_authentications_total[5m]))
  ) * 100

# 평균 토큰 검증 시간
avg(kafka_oauth_token_validation_time_ms)

# 시간당 토큰 갱신 횟수
sum(rate(kafka_oauth_token_renewals_total[1h]))
```

### 3. 감사 로그 분석

```python
# audit-log-analyzer.py
import requests
from datetime import datetime, timedelta
from collections import Counter

class KafkaOAuthAuditor:
    def __init__(self, keycloak_url, admin_token):
        self.keycloak_url = keycloak_url
        self.admin_token = admin_token

    def get_events(self, hours=24):
        """최근 N시간 동안의 이벤트 조회"""
        url = f"{self.keycloak_url}/admin/realms/kafka/events"

        # 시작 시간 (Unix timestamp, milliseconds)
        date_from = int((datetime.now() - timedelta(hours=hours)).timestamp() * 1000)

        response = requests.get(
            url,
            headers={'Authorization': f'Bearer {self.admin_token}'},
            params={
                'dateFrom': date_from,
                'type': ['CLIENT_LOGIN', 'CLIENT_LOGIN_ERROR', 'REFRESH_TOKEN']
            }
        )

        return response.json()

    def analyze_authentication_patterns(self, events):
        """인증 패턴 분석"""
        stats = {
            'total_logins': 0,
            'failed_logins': 0,
            'clients': Counter(),
            'ip_addresses': Counter(),
            'hourly_distribution': Counter()
        }

        for event in events:
            event_type = event['type']
            client_id = event.get('clientId', 'unknown')
            ip_address = event.get('ipAddress', 'unknown')
            timestamp = datetime.fromtimestamp(event['time'] / 1000)
            hour = timestamp.hour

            if event_type == 'CLIENT_LOGIN':
                stats['total_logins'] += 1
                stats['clients'][client_id] += 1
                stats['ip_addresses'][ip_address] += 1
                stats['hourly_distribution'][hour] += 1

            elif event_type == 'CLIENT_LOGIN_ERROR':
                stats['failed_logins'] += 1

        return stats

    def detect_anomalies(self, stats):
        """이상 패턴 감지"""
        alerts = []

        # 실패율이 20% 이상
        if stats['total_logins'] > 0:
            failure_rate = (stats['failed_logins'] /
                          (stats['total_logins'] + stats['failed_logins'])) * 100
            if failure_rate > 20:
                alerts.append(f"⚠️  High failure rate: {failure_rate:.1f}%")

        # 단일 IP에서 과도한 요청
        for ip, count in stats['ip_addresses'].items():
            if count > 1000:  # 1시간에 1000번 이상
                alerts.append(f"🚨 Suspicious activity from IP: {ip} ({count} requests)")

        # 비정상적인 시간대 접근
        for hour, count in stats['hourly_distribution'].items():
            if hour in range(0, 6) and count > 100:  # 새벽 시간대
                alerts.append(f"🌙 Unusual activity at {hour}:00 ({count} logins)")

        return alerts

    def generate_report(self, hours=24):
        """감사 리포트 생성"""
        events = self.get_events(hours)
        stats = self.analyze_authentication_patterns(events)
        alerts = self.detect_anomalies(stats)

        print(f"📊 Kafka OAuth Audit Report (Last {hours} hours)")
        print("=" * 60)
        print(f"Total Logins: {stats['total_logins']}")
        print(f"Failed Logins: {stats['failed_logins']}")
        print(f"\nTop 5 Clients:")
        for client, count in stats['clients'].most_common(5):
            print(f"  - {client}: {count} logins")

        print(f"\nTop 5 IP Addresses:")
        for ip, count in stats['ip_addresses'].most_common(5):
            print(f"  - {ip}: {count} requests")

        if alerts:
            print(f"\n⚠️  Security Alerts:")
            for alert in alerts:
                print(f"  {alert}")
        else:
            print(f"\n✅ No anomalies detected")

# 사용 예시
auditor = KafkaOAuthAuditor(
    keycloak_url='http://keycloak',
    admin_token='admin-token-here'
)

auditor.generate_report(hours=24)
```

## 트러블슈팅

### 1. Token Validation 실패

```bash
# 증상
Error: Authentication failed: Token validation failed

# 원인 1: JWT Signature 검증 실패
# - Keycloak 공개키와 Kafka 설정 불일치

# 해결:
# Keycloak JWKS 엔드포인트 확인
curl http://keycloak/realms/kafka/protocol/openid-connect/certs | jq

# Kafka 설정 확인
kubectl get kafka production-cluster -n kafka -o yaml | grep jwksEndpointUri

# 원인 2: Token 만료
# - Access Token Lifespan이 너무 짧음

# 해결:
# Keycloak Realm Settings → Tokens
# Access Token Lifespan: 5분 → 15분으로 증가
```

### 2. Token Refresh 실패

```java
// 문제: Token이 만료되었는데 자동 갱신 안됨

// 해결: Token Refresh 로직 추가
@Scheduled(fixedRate = 240000) // 4분마다 (5분 만료 전)
public void refreshToken() {
    try {
        // Producer/Consumer 재연결하여 새 토큰 획득
        kafkaTemplate.flush();
        log.info("✅ Token refreshed successfully");
    } catch (Exception e) {
        log.error("❌ Failed to refresh token: {}", e.getMessage());
        // Retry 로직 또는 알람
    }
}
```

### 3. ACL 매핑 문제

```bash
# 증상
Error: Not authorized to access topic 'user-events'

# 원인: Keycloak username과 Kafka ACL 불일치

# 디버깅:
# 1. Token Claims 확인
echo "eyJhbGci..." | base64 -d | jq

# 2. Kafka ACL 확인
kubectl exec -it production-cluster-kafka-0 -n kafka -- \
  bin/kafka-acls.sh --bootstrap-server localhost:9092 \
  --list --topic user-events

# 해결: KafkaUser 리소스 수정
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaUser
metadata:
  name: producer-service  # Keycloak username과 일치
spec:
  authorization:
    type: simple
    acls:
      - resource:
          type: topic
          name: user-events
        operations: [Write, Describe]
```

## 성과 측정

### Before vs After

| 지표 | Before (SCRAM) | After (OAuth) | 개선율 |
|------|----------------|--------------|--------|
| 사용자 프로비저닝 시간 | 30분 | 5분 | 83% ⬇️ |
| 권한 변경 시간 | 45분 | 10분 | 78% ⬇️ |
| 보안 인시던트 대응 | 2시간 | 5분 | 96% ⬇️ |
| 계정 감사 가능 여부 | ❌ | ✅ | - |
| 토큰 자동 만료 | ❌ | ✅ 5분 | - |
| 중앙화된 관리 | ❌ | ✅ | - |

### 보안 개선

```
1. 토큰 기반 인증
   - 자격증명 유출 시 5분 내 자동 만료
   - 주기적 토큰 갱신으로 보안 강화

2. 중앙화된 사용자 관리
   - Keycloak에서 모든 사용자 관리
   - 퇴사자 계정 즉시 비활성화

3. 감사 로그
   - 모든 인증 시도 기록
   - 이상 패턴 자동 감지 및 알람

4. Role-Based Access Control
   - Keycloak Groups/Roles과 Kafka ACL 통합
   - 세밀한 권한 제어 가능
```

## 모범 사례

### 1. Token Lifespan 설정

```
권장 설정:
- Access Token: 5-15분
- Refresh Token: 30-60분
- Session Idle: 30분
- Session Max: 12시간

이유:
- 짧은 Access Token: 유출 시 피해 최소화
- Refresh Token: 사용자 경험 향상 (재로그인 없이 토큰 갱신)
- Session 제한: 좀비 세션 방지
```

### 2. Client Credentials 관리

```bash
# ❌ 나쁜 예: 하드코딩
export KAFKA_CLIENT_SECRET="my-secret-123"

# ✅ 좋은 예: Kubernetes Secret
kubectl create secret generic kafka-oauth-secret \
  --from-literal=client-id=kafka-producer \
  --from-literal=client-secret=$(openssl rand -base64 32) \
  -n applications

# Deployment에서 사용
env:
  - name: KAFKA_CLIENT_ID
    valueFrom:
      secretKeyRef:
        name: kafka-oauth-secret
        key: client-id
  - name: KAFKA_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: kafka-oauth-secret
        key: client-secret
```

### 3. 정기 감사

```bash
# Cron으로 일일 감사 리포트 생성
apiVersion: batch/v1
kind: CronJob
metadata:
  name: kafka-oauth-audit
  namespace: kafka
spec:
  schedule: "0 9 * * *"  # 매일 오전 9시
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: auditor
              image: kafka-oauth-auditor:latest
              command: ["/usr/bin/python3", "/app/audit.py"]
              env:
                - name: KEYCLOAK_URL
                  value: "http://keycloak"
                - name: ADMIN_TOKEN
                  valueFrom:
                    secretKeyRef:
                      name: keycloak-admin
                      key: token
          restartPolicy: OnFailure
```

## 결론

### 핵심 정리

1. **OAuth2 도입 효과**
   - 중앙화된 인증 관리로 운영 효율 3배 향상
   - 토큰 기반 보안으로 유출 위험 96% 감소
   - 감사 로그로 완전한 추적 가능

2. **구현 포인트**
   - Keycloak + Strimzi OAuth 조합
   - SASL/OAUTHBEARER 메커니즘
   - JWT 토큰 검증 및 갱신

3. **운영 시 주의사항**
   - Token Lifespan 적절히 설정
   - Client Credentials 안전하게 관리
   - 정기적인 감사 및 모니터링

OAuth2 기반 인증은 초기 구축 비용이 있지만, 장기적으로 보안과 운영 효율을 크게 향상시킵니다. 멀티 클러스터 환경이나 엄격한 보안 요구사항이 있는 경우 필수적으로 고려해야 합니다.
