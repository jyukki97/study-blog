---
title: "ELK Stack: 로그 수집과 분석 플랫폼 구축하기"
date: 2025-12-09
draft: false
topic: "DevOps"
tags: ["ELK", "Elasticsearch", "Logstash", "Kibana", "Filebeat", "Log Analysis", "ILM", "Fluentd"]
categories: ["Backend Deep Dive"]
description: "ELK/EFK/Loki 로그 스택 비교, Filebeat→Logstash→Elasticsearch→Kibana 파이프라인 구축, ILM 자동 관리, 보안/성능 운영 가이드"
module: "ops-observability"
study_order: 341
quizzes:
  - question: "ELK Stack에서 각 컴포넌트의 역할로 올바른 것은?"
    options:
      - "Elasticsearch가 로그를 수집한다."
      - "Filebeat(수집) → Logstash(변환/필터) → Elasticsearch(저장/검색) → Kibana(시각화)"
      - "Kibana가 로그를 저장한다."
      - "Logstash가 시각화를 담당한다."
    answer: 1
    explanation: "Filebeat는 경량 Agent로 로그 파일을 수집, Logstash는 파싱/변환, Elasticsearch는 저장 및 검색, Kibana는 시각화를 담당합니다."

  - question: "Logstash에서 Grok 패턴을 사용하는 이유는?"
    options:
      - "로그를 압축하기 위해"
      - "정규표현식 기반으로 비정형 로그 문자열을 구조화된 필드로 파싱하기 위해"
      - "Kibana에 직접 전송하기 위해"
      - "로그를 삭제하기 위해"
    answer: 1
    explanation: "일반 텍스트 로그 '2025-01-01 ERROR Something wrong'를 timestamp, level, message 필드로 분리하면 Kibana에서 필터링/집계가 쉬워집니다."

  - question: "Kibana에서 Index Pattern을 생성하는 이유는?"
    options:
      - "로그를 삭제하기 위해"
      - "Elasticsearch에 저장된 어떤 인덱스의 데이터를 시각화할지 지정하기 위해"
      - "로그를 암호화하기 위해"
      - "Filebeat를 설정하기 위해"
    answer: 1
    explanation: "`myapp-logs-*` 패턴을 생성하면 날짜별로 생성된 모든 myapp-logs 인덱스를 하나의 뷰로 검색/시각화할 수 있습니다."

  - question: "Filebeat를 Logstash 없이 Elasticsearch에 직접 연결할 수 있는 경우는?"
    options:
      - "불가능하다."
      - "로그 형식이 이미 JSON이거나 복잡한 변환이 필요 없을 때 경량 파이프라인으로 동작 가능"
      - "항상 직접 연결해야 한다."
      - "Kibana 없이 사용할 때"
    answer: 1
    explanation: "Filebeat는 Elasticsearch에 직접 전송할 수 있습니다. 단, 복잡한 파싱/변환이 필요하면 Logstash를 중간에 둡니다."

  - question: "ELK 스택에서 로그 인덱스를 날짜별(myapp-logs-2025.01.01)로 만드는 이유는?"
    options:
      - "필수 형식이다."
      - "오래된 로그 인덱스를 쉽게 삭제/관리(ILM)하여 스토리지 비용을 절약하기 위해"
      - "검색 속도를 높이기 위해"
      - "이름이 예쁘기 때문"
    answer: 1
    explanation: "30일 보관 정책이면 30일 이전 인덱스를 삭제하면 됩니다. 하나의 거대한 인덱스라면 오래된 데이터 삭제가 어렵습니다."
---

## 이 글에서 얻는 것

- **ELK/EFK/Loki** 3대 로그 스택의 차이와 선택 기준을 이해합니다.
- **Filebeat → Logstash → Elasticsearch → Kibana** 파이프라인을 구축하고, 각 단계의 고급 설정을 적용할 수 있습니다.
- **ILM(Index Lifecycle Management)**으로 로그 인덱스를 Hot-Warm-Cold-Delete 자동 관리합니다.
- **보안**(인증/TLS/RBAC)과 **성능 튜닝**(배치/큐/JVM) 운영 가이드를 확보합니다.
- **Spring Boot** 애플리케이션에서 구조화된 로그를 ELK로 전송하는 실전 패턴을 익힙니다.

---

## 0) 로그 스택 비교: ELK vs EFK vs Loki

로그 시스템을 선택할 때 "무엇을 수집하고, 어떻게 저장하고, 누가 검색하는가"에 따라 적합한 스택이 달라집니다.

### 3대 로그 스택 비교

| | **ELK** | **EFK** | **Grafana Loki** |
|:---|:--------|:--------|:-----------------|
| 수집 | Filebeat/Logstash | Fluentd/Fluent Bit | Promtail/Grafana Agent |
| 저장 | Elasticsearch | Elasticsearch | 자체 저장소 (S3/GCS) |
| 시각화 | Kibana | Kibana | Grafana |
| 인덱싱 | **전문 인덱싱** (역인덱스) | **전문 인덱싱** (역인덱스) | **라벨만 인덱싱** (본문 X) |
| 검색 능력 | 매우 강력 (전문 검색) | 매우 강력 (전문 검색) | 라벨 필터 + grep 수준 |
| 리소스 비용 | 높음 (메모리/디스크) | 높음 | **낮음** (10~20배 저렴) |
| K8s 네이티브 | 보통 | ✅ (CNCF) | ✅ |
| 학습 곡선 | 보통 | 보통 | 낮음 |

### 선택 가이드

```
복잡한 전문 검색이 필요한가? (예: 에러 메시지 패턴 분석)
├── YES → ELK/EFK
│         ├── Kubernetes 환경? → EFK (Fluentd = CNCF 표준)
│         └── 그 외? → ELK
└── NO  → Grafana Loki (비용 효율 최고)
          ├── 이미 Prometheus + Grafana 사용 중? → Loki 강추
          └── 로그 볼륨이 매우 큰가? → Loki (스토리지 비용 10배↓)
```

---

## 1) ELK Stack 구성 요소 심층

```
애플리케이션
    │
    ▼
┌───────────┐     ┌───────────┐     ┌───────────────┐     ┌────────┐
│ Filebeat  │────→│ Logstash  │────→│Elasticsearch  │────→│ Kibana │
│ (수집)    │     │ (변환)    │     │ (저장/검색)   │     │(시각화)│
└───────────┘     └───────────┘     └───────────────┘     └────────┘
    경량 Agent       파싱/필터/         역인덱스            대시보드
    Back-pressure    라우팅             분산 검색           알람
```

### 1-1) Filebeat: 경량 로그 수집기

Filebeat는 Go로 작성된 경량 Agent(~30MB 메모리)로, 로그 파일을 읽어 Logstash 또는 Elasticsearch로 전송합니다.

**핵심 개념: Registry + Harvester**
```
┌─ Filebeat ──────────────────────┐
│                                  │
│  Registry (파일별 읽기 위치 기록) │
│  ┌─────────────────────────┐    │
│  │ /var/log/app.log → 8240 │    │
│  │ /var/log/err.log → 1024 │    │
│  └─────────────────────────┘    │
│                                  │
│  Harvester (파일별 1개씩 읽기)   │
│  ┌──────┐  ┌──────┐            │
│  │app.log│  │err.log│           │
│  └──────┘  └──────┘            │
│                                  │
│  Spooler (배치 + Back-pressure) │
│  → Output (Logstash/ES)         │
└──────────────────────────────────┘
```

**고급 설정:**
```yaml
filebeat.inputs:
  # 1) 애플리케이션 로그 (JSON 형식)
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/*.log
    json.keys_under_root: true
    json.add_error_key: true
    json.overwrite_keys: true
    
    # 멀티라인 (Java Stack Trace)
    multiline.pattern: '^\d{4}-\d{2}-\d{2}'
    multiline.negate: true
    multiline.match: after
    multiline.max_lines: 50
    multiline.timeout: 5s
    
    # 메타데이터
    fields:
      app: myapp
      env: production
      team: backend
    fields_under_root: true
    
    # 성능: 최대 5000개 이벤트를 메모리에 버퍼
    harvester_buffer_size: 65536
    max_bytes: 10485760
    
  # 2) Nginx 액세스 로그
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log
    fields:
      app: nginx
      type: access
    fields_under_root: true

# 출력 설정
output.logstash:
  hosts: ["logstash:5044"]
  # Back-pressure: Logstash가 느리면 자동으로 전송 속도 조절
  bulk_max_size: 2048
  worker: 2
  loadbalance: true  # 여러 Logstash 인스턴스에 분산

# 내부 큐 설정
queue.mem:
  events: 4096
  flush.min_events: 512
  flush.timeout: 1s

# 프로세서 (Logstash 전에 경량 변환)
processors:
  - drop_fields:
      fields: ["agent.ephemeral_id", "agent.hostname", "agent.id"]
  - add_host_metadata: ~
  - add_cloud_metadata: ~
```

### 1-2) Logstash: 데이터 변환 엔진

Logstash는 **Input → Filter → Output** 파이프라인으로 로그를 변환합니다.

**실전 파이프라인:**
```ruby
input {
  beats {
    port => 5044
    ssl => true
    ssl_certificate => "/etc/logstash/certs/logstash.crt"
    ssl_key => "/etc/logstash/certs/logstash.key"
  }
}

filter {
  # 1) 앱 타입별 분기
  if [app] == "myapp" {
    # JSON 구조화 로그 파싱
    if [message] =~ /^\{/ {
      json {
        source => "message"
        target => "log"
        remove_field => ["message"]
      }
    }
    
    # 날짜 파싱
    date {
      match => ["[log][timestamp]", "ISO8601", "yyyy-MM-dd HH:mm:ss.SSS"]
      target => "@timestamp"
    }
    
    # 로그 레벨 정규화
    mutate {
      uppercase => ["[log][level]"]
    }
  }
  
  if [app] == "nginx" {
    # Nginx 로그 파싱 (Grok)
    grok {
      match => {
        "message" => '%{IPORHOST:client_ip} - %{DATA:user} \[%{HTTPDATE:timestamp}\] "%{WORD:method} %{URIPATHPARAM:request} HTTP/%{NUMBER:http_version}" %{NUMBER:status:int} %{NUMBER:bytes:int} "%{DATA:referrer}" "%{DATA:user_agent}" %{NUMBER:request_time:float}'
      }
    }
    
    date {
      match => ["timestamp", "dd/MMM/yyyy:HH:mm:ss Z"]
      target => "@timestamp"
      remove_field => ["timestamp"]
    }
    
    # GeoIP (클라이언트 IP → 위치)
    geoip {
      source => "client_ip"
      target => "geo"
    }
    
    # User-Agent 파싱
    useragent {
      source => "user_agent"
      target => "ua"
    }
  }
  
  # 2) 공통 처리
  # 민감 정보 마스킹
  mutate {
    gsub => [
      "message", '\b\d{3}-\d{2}-\d{4}\b', '***-**-****',  # SSN
      "message", '\b[\w.+-]+@[\w-]+\.[\w.]+\b', '****@****.***'  # 이메일
    ]
  }
  
  # 불필요 이벤트 드롭
  if [log][level] == "DEBUG" and [env] == "production" {
    drop {}
  }
  
  # 3) 메트릭 추출
  metrics {
    meter => "events"
    add_tag => "metric"
  }
}

output {
  # 앱별 인덱스 분리
  if [app] == "myapp" {
    elasticsearch {
      hosts => ["https://es-node1:9200", "https://es-node2:9200"]
      index => "myapp-logs-%{+YYYY.MM.dd}"
      user => "logstash_writer"
      password => "${LOGSTASH_ES_PASSWORD}"
      ssl => true
      cacert => "/etc/logstash/certs/ca.crt"
      
      # 인덱스 템플릿 자동 적용
      template_name => "myapp-logs"
      template => "/etc/logstash/templates/myapp-logs.json"
      template_overwrite => true
    }
  }
  
  if [app] == "nginx" {
    elasticsearch {
      hosts => ["https://es-node1:9200"]
      index => "nginx-access-%{+YYYY.MM.dd}"
      user => "logstash_writer"
      password => "${LOGSTASH_ES_PASSWORD}"
      ssl => true
      cacert => "/etc/logstash/certs/ca.crt"
    }
  }
  
  # 에러 로그는 별도 인덱스 + 알림
  if [log][level] == "ERROR" {
    elasticsearch {
      hosts => ["https://es-node1:9200"]
      index => "errors-%{+YYYY.MM.dd}"
      user => "logstash_writer"
      password => "${LOGSTASH_ES_PASSWORD}"
      ssl => true
      cacert => "/etc/logstash/certs/ca.crt"
    }
  }
}
```

**주요 Grok 패턴 레퍼런스:**

| 패턴 | 매칭 대상 | 예시 |
|:-----|:---------|:-----|
| `%{TIMESTAMP_ISO8601}` | ISO 날짜 | `2025-12-16T10:30:00.000Z` |
| `%{LOGLEVEL}` | 로그 레벨 | `ERROR`, `WARN` |
| `%{IPORHOST}` | IP 또는 호스트 | `192.168.1.1`, `web01` |
| `%{URIPATHPARAM}` | URI 경로+파라미터 | `/api/users?page=1` |
| `%{NUMBER}` | 숫자 | `200`, `3.14` |
| `%{GREEDYDATA}` | 나머지 전부 | `anything here...` |
| `%{DATA}` | 비탐욕 매칭 | (다음 구분자까지) |

> 💡 **Grok 디버거:** [grokdebugger.com](https://grokdebugger.com) 에서 실시간으로 패턴을 테스트할 수 있습니다.

---

## 2) Docker Compose: 운영 수준 구성

```yaml
version: '3.8'

services:
  # ── Elasticsearch ──
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
    container_name: es01
    environment:
      - node.name=es01
      - cluster.name=logging-cluster
      - discovery.type=single-node
      - xpack.security.enabled=true
      - xpack.security.http.ssl.enabled=false  # 개발용. 운영은 true
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD:-changeme}
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
      # JVM 힙은 전체 메모리의 50% 이하, 최대 32GB (CompressedOops)
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    volumes:
      - es-data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
    healthcheck:
      test: ["CMD-SHELL", "curl -s -u elastic:${ELASTIC_PASSWORD:-changeme} http://localhost:9200/_cluster/health | grep -q '\"status\":\"green\\|yellow\"'"]
      interval: 30s
      timeout: 10s
      retries: 5

  # ── Logstash ──
  logstash:
    image: docker.elastic.co/logstash/logstash:8.12.0
    container_name: logstash
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline:ro
      - ./logstash/config/logstash.yml:/usr/share/logstash/config/logstash.yml:ro
    environment:
      - "LS_JAVA_OPTS=-Xms1g -Xmx1g"
      - LOGSTASH_ES_PASSWORD=${ELASTIC_PASSWORD:-changeme}
    ports:
      - "5044:5044"   # Beats input
      - "9600:9600"   # Monitoring API
    depends_on:
      elasticsearch:
        condition: service_healthy

  # ── Kibana ──
  kibana:
    image: docker.elastic.co/kibana/kibana:8.12.0
    container_name: kibana
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
      - ELASTICSEARCH_USERNAME=kibana_system
      - ELASTICSEARCH_PASSWORD=${ELASTIC_PASSWORD:-changeme}
      - SERVER_NAME=kibana
      - SERVER_BASEPATH=""
    ports:
      - "5601:5601"
    depends_on:
      elasticsearch:
        condition: service_healthy

  # ── Filebeat ──
  filebeat:
    image: docker.elastic.co/beats/filebeat:8.12.0
    container_name: filebeat
    user: root
    command: filebeat -e -strict.perms=false
    volumes:
      - ./filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml:ro
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - filebeat-data:/usr/share/filebeat/data  # Registry 영속
    depends_on:
      logstash:
        condition: service_started

volumes:
  es-data:
    driver: local
  filebeat-data:
    driver: local
```

**Logstash 설정 (logstash.yml):**
```yaml
http.host: "0.0.0.0"
xpack.monitoring.elasticsearch.hosts: ["http://elasticsearch:9200"]
xpack.monitoring.elasticsearch.username: "logstash_system"
xpack.monitoring.elasticsearch.password: "${LOGSTASH_ES_PASSWORD}"

# 파이프라인 성능 튜닝
pipeline.workers: 4           # CPU 코어 수에 맞춤
pipeline.batch.size: 500      # 한 번에 처리할 이벤트 수
pipeline.batch.delay: 50      # ms, 배치 채우기 대기 시간

# 영속 큐 (Logstash 재시작 시 데이터 유실 방지)
queue.type: persisted
queue.max_bytes: 1gb
queue.checkpoint.writes: 1024

# Dead Letter Queue (파싱 실패 이벤트 보존)
dead_letter_queue.enable: true
dead_letter_queue.max_bytes: 512mb
```

---

## 3) ILM (Index Lifecycle Management)

시계열 로그 인덱스는 시간이 지나면 가치가 떨어집니다. ILM으로 자동 관리합니다.

### 3-1) Hot-Warm-Cold-Delete 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                     Index Lifecycle                               │
│                                                                   │
│  Hot (SSD)          Warm (HDD)         Cold             Delete   │
│  ─────────          ─────────         ──────            ──────   │
│  0~7일              7~30일            30~90일            90일+    │
│  활발한 쓰기/읽기    읽기 위주          거의 접근 X       자동 삭제 │
│                                                                   │
│  Rollover 조건:     Shrink:           Freeze:                    │
│  - 50GB 초과        1 Shard로 병합     읽기 전용                   │
│  - 7일 경과         Force Merge:      Searchable                  │
│  - 1억 문서          1 Segment로 병합  Snapshot 가능               │
└─────────────────────────────────────────────────────────────────┘
```

### 3-2) ILM 정책 설정

```json
PUT _ilm/policy/logs_lifecycle
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_age": "7d",
            "max_primary_shard_size": "50gb",
            "max_docs": 100000000
          },
          "set_priority": { "priority": 100 },
          "readonly": {}
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": { "number_of_shards": 1 },
          "forcemerge": { "max_num_segments": 1 },
          "set_priority": { "priority": 50 },
          "allocate": {
            "number_of_replicas": 1,
            "require": { "data": "warm" }
          }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "set_priority": { "priority": 0 },
          "allocate": {
            "number_of_replicas": 0,
            "require": { "data": "cold" }
          },
          "freeze": {}
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

### 3-3) 인덱스 템플릿 + ILM 연결

```json
PUT _index_template/myapp-logs
{
  "index_patterns": ["myapp-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "index.lifecycle.name": "logs_lifecycle",
      "index.lifecycle.rollover_alias": "myapp-logs",
      "index.routing.allocation.require.data": "hot",
      "index.refresh_interval": "5s"
    },
    "mappings": {
      "dynamic": "strict",
      "properties": {
        "@timestamp": { "type": "date" },
        "level": { "type": "keyword" },
        "logger": { "type": "keyword" },
        "thread": { "type": "keyword" },
        "message": { "type": "text" },
        "traceId": { "type": "keyword" },
        "spanId": { "type": "keyword" },
        "app": { "type": "keyword" },
        "env": { "type": "keyword" },
        "host": { "type": "keyword" },
        "exception": {
          "properties": {
            "class": { "type": "keyword" },
            "message": { "type": "text" },
            "stacktrace": { "type": "text", "index": false }
          }
        }
      }
    }
  },
  "priority": 200
}

// 초기 인덱스 + alias 생성
PUT myapp-logs-000001
{
  "aliases": {
    "myapp-logs": {
      "is_write_index": true
    }
  }
}
```

---

## 4) Spring Boot 연동

### 4-1) Logback → Logstash 직접 전송

**build.gradle:**
```groovy
implementation 'net.logstash.logback:logstash-logback-encoder:7.4'
```

**logback-spring.xml:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <springProperty scope="context" name="APP_NAME" source="spring.application.name"/>
    <springProperty scope="context" name="APP_ENV" source="spring.profiles.active"/>
    
    <!-- 콘솔 출력 (개발용) -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>
    
    <!-- Logstash TCP 전송 -->
    <appender name="LOGSTASH" class="net.logstash.logback.appender.LogstashTcpSocketAppender">
        <destination>logstash:5000</destination>
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <!-- 커스텀 필드 추가 -->
            <customFields>{"app":"${APP_NAME}","env":"${APP_ENV}"}</customFields>
            <!-- 스택 트레이스 해시 (동일 에러 그룹핑용) -->
            <throwableConverter class="net.logstash.logback.stacktrace.ShortenedThrowableConverter">
                <maxDepthPerThrowable>20</maxDepthPerThrowable>
                <maxLength>2048</maxLength>
                <shortenedClassNameLength>20</shortenedClassNameLength>
                <rootCauseFirst>true</rootCauseFirst>
            </throwableConverter>
            <!-- MDC (traceId, spanId 등) 자동 포함 -->
            <includeMdcKeyName>traceId</includeMdcKeyName>
            <includeMdcKeyName>spanId</includeMdcKeyName>
            <includeMdcKeyName>userId</includeMdcKeyName>
        </encoder>
        
        <!-- 재연결 설정 -->
        <reconnectionDelay>5 seconds</reconnectionDelay>
        <keepAliveDuration>5 minutes</keepAliveDuration>
        
        <!-- 비동기 + 큐 설정 -->
        <ringBufferSize>8192</ringBufferSize>
    </appender>
    
    <!-- 파일 출력 (Filebeat가 수집) -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>/var/log/myapp/app.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>/var/log/myapp/app.%d{yyyy-MM-dd}.%i.log</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>7</maxHistory>
            <totalSizeCap>2GB</totalSizeCap>
        </rollingPolicy>
        <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
    </appender>
    
    <!-- 프로파일별 설정 -->
    <springProfile name="local">
        <root level="DEBUG">
            <appender-ref ref="CONSOLE"/>
        </root>
    </springProfile>
    
    <springProfile name="production">
        <root level="INFO">
            <appender-ref ref="FILE"/>
            <appender-ref ref="LOGSTASH"/>
        </root>
    </springProfile>
</configuration>
```

### 4-2) 구조화 로그 + MDC 활용

```java
@Component
public class LoggingFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        
        // MDC에 요청 컨텍스트 저장 → 모든 로그에 자동 포함
        MDC.put("requestId", req.getHeader("X-Request-ID") != null
            ? req.getHeader("X-Request-ID")
            : UUID.randomUUID().toString());
        MDC.put("clientIp", req.getRemoteAddr());
        MDC.put("method", req.getMethod());
        MDC.put("uri", req.getRequestURI());
        
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}

// 사용 예시
@Service
public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);
    
    public Order createOrder(OrderRequest request) {
        MDC.put("userId", request.getUserId());
        MDC.put("orderId", request.getOrderId());
        
        log.info("주문 생성 시작");
        // → {"@timestamp":"...","level":"INFO","message":"주문 생성 시작",
        //    "requestId":"abc-123","userId":"user-456","orderId":"order-789",...}
        
        // ... 비즈니스 로직
        
        log.info("주문 생성 완료 amount={}", request.getAmount());
        return order;
    }
}
```

---

## 5) Kibana: 실전 대시보드 구축

### 5-1) Data View(Index Pattern) 생성

```
Kibana → Stack Management → Data Views → Create

Name:      myapp-logs
Index:     myapp-logs-*
Timestamp: @timestamp
```

### 5-2) 에러 분석 대시보드 구성

| 패널 | 타입 | 쿼리/설정 |
|:-----|:-----|:---------|
| 시간별 에러 수 | Line Chart | `level:ERROR` + Date Histogram |
| 에러 유형 분포 | Pie Chart | Terms Agg on `exception.class` |
| 최다 에러 TOP 10 | Table | Terms Agg on `exception.message` |
| 응답 시간 분포 | Histogram | Range Agg on `response_time` |
| 서비스별 로그 볼륨 | Bar Chart | Terms Agg on `app` |
| 최근 에러 로그 | Saved Search | `level:ERROR` + 최근 15분 |

### 5-3) Kibana Alerting (Watcher)

```json
// 5분간 에러 100건 초과 시 Slack 알림
PUT _watcher/watch/error_spike_alert
{
  "trigger": {
    "schedule": { "interval": "5m" }
  },
  "input": {
    "search": {
      "request": {
        "indices": ["myapp-logs-*"],
        "body": {
          "query": {
            "bool": {
              "filter": [
                { "term": { "level": "ERROR" } },
                { "range": { "@timestamp": { "gte": "now-5m" } } }
              ]
            }
          }
        }
      }
    }
  },
  "condition": {
    "compare": { "ctx.payload.hits.total.value": { "gt": 100 } }
  },
  "actions": {
    "notify_slack": {
      "webhook": {
        "method": "POST",
        "url": "https://hooks.slack.com/services/xxx",
        "body": "{\"text\":\"🚨 에러 급증! 최근 5분간 {{ctx.payload.hits.total.value}}건 발생\"}"
      }
    }
  }
}
```

---

## 6) 보안 설정

### 6-1) 보안 체크리스트

| 항목 | 설정 | 우선도 |
|:-----|:-----|:-----:|
| 기본 인증 | `xpack.security.enabled: true` | ⭐⭐⭐ |
| 전송 암호화 | TLS/SSL (노드 간, 클라이언트-서버) | ⭐⭐⭐ |
| RBAC | 역할별 인덱스 접근 제어 | ⭐⭐ |
| API Key | 서비스별 인증 분리 | ⭐⭐ |
| Audit Log | 접근 로그 기록 | ⭐ |
| 네트워크 격리 | ES 포트 외부 노출 금지 | ⭐⭐⭐ |

### 6-2) 역할/사용자 생성

```json
// 읽기 전용 역할
POST _security/role/log_reader
{
  "indices": [{
    "names": ["myapp-logs-*"],
    "privileges": ["read", "view_index_metadata"]
  }]
}

// Logstash 쓰기 역할
POST _security/role/logstash_writer
{
  "cluster": ["manage_index_templates", "monitor"],
  "indices": [{
    "names": ["myapp-logs-*", "nginx-access-*", "errors-*"],
    "privileges": ["create_index", "write", "manage"]
  }]
}

// 사용자 생성
POST _security/user/logstash_internal
{
  "password": "strong-password-here",
  "roles": ["logstash_writer"],
  "full_name": "Logstash Internal"
}
```

---

## 7) 성능 튜닝

### 7-1) 파이프라인별 성능 포인트

| 구간 | 병목 | 해결 |
|:-----|:-----|:-----|
| Filebeat → Logstash | 네트워크/Back-pressure | `bulk_max_size` 조정, Worker 수 증가 |
| Logstash Filter | Grok 정규표현식 | 앵커 사용(`^`), 불필요 패턴 제거, JSON 우선 |
| Logstash → ES | ES 인덱싱 속도 | Bulk 크기 조정, Worker 수 = CPU 코어 |
| ES 인덱싱 | Segment Merge, Refresh | `refresh_interval: 30s`, Replica 0 후 복구 |
| ES 검색 | 과도한 Shard 수 | Shard 10~50GB, 불필요 필드 `index: false` |

### 7-2) Logstash 성능 모니터링

```bash
# Logstash 모니터링 API
curl -s localhost:9600/_node/stats/pipeline | jq '
  .pipelines.main.events | {
    in: .in,
    filtered: .filtered,
    out: .out,
    queue_push_duration_ms: .queue_push_duration_in_millis,
    duration_ms: .duration_in_millis
  }
'

# 파이프라인 지연 확인
curl -s localhost:9600/_node/stats/pipeline | jq '
  .pipelines.main.plugins.filters[] | {
    name: .name,
    events_in: .events.in,
    duration_ms: .events.duration_in_millis,
    avg_ms: (.events.duration_in_millis / (.events.in + 1))
  }
'
```

### 7-3) Elasticsearch JVM 튜닝

```yaml
# jvm.options
-Xms4g          # 전체 메모리의 50%
-Xmx4g          # Xms = Xmx (동일하게!)
# 최대 32GB (CompressedOops 한계)
# 나머지 50%는 OS File Cache가 사용 (Lucene 성능에 중요!)
```

---

## 안티패턴 7가지

| # | 안티패턴 | 문제 | 올바른 방법 |
|---|:---------|:-----|:-----------|
| 1 | DEBUG 로그를 운영 ES에 저장 | 볼륨 폭증 + 비용 증가 | Logstash에서 `drop {}` |
| 2 | 인덱스 하나에 모든 로그 | 삭제/관리 불가 | 날짜별 인덱스 + ILM |
| 3 | ILM 없이 인덱스 무한 증식 | 디스크 풀, Shard 폭증 | ILM 정책 필수 |
| 4 | ES 포트(9200) 외부 직접 노출 | 무인증 접근 위험 | 네트워크 격리 + 인증 |
| 5 | Grok만으로 모든 파싱 | 성능 병목 (정규식 비용) | JSON 구조화 로그 우선 |
| 6 | Filebeat Registry 미영속 | 컨테이너 재시작 시 로그 재전송 | Volume 마운트 |
| 7 | JVM 힙을 전체 메모리로 | File Cache 없음 → 검색 느림 | 50% 원칙 (최대 32GB) |

---

## 운영 체크리스트

### 구축
- [ ] Docker Compose 또는 Helm Chart로 재현 가능한 배포인가?
- [ ] Filebeat Registry가 영속 볼륨에 저장되는가?
- [ ] Logstash Dead Letter Queue가 활성화되어 있는가?
- [ ] 인덱스 템플릿이 매핑을 명시적으로 정의하는가?

### 운영
- [ ] ILM 정책이 설정되어 있고 정상 동작하는가?
- [ ] `_cluster/health`가 Green인가?
- [ ] 디스크 사용량이 85% 이하인가?
- [ ] ES JVM 힙이 전체 메모리의 50% 이하인가?
- [ ] 민감 정보(SSN/이메일/토큰)가 마스킹되고 있는가?

### 보안
- [ ] `xpack.security.enabled: true` 인가?
- [ ] 서비스별 역할(RBAC)이 분리되어 있는가?
- [ ] ES 포트(9200/9300)가 외부 직접 노출되지 않는가?
- [ ] 노드 간 통신이 TLS로 암호화되어 있는가?

### 모니터링
- [ ] Kibana에서 에러 급증 알람이 설정되어 있는가?
- [ ] Logstash 파이프라인 지연을 모니터링하는가?
- [ ] 인덱스 크기/Shard 수 추이를 추적하는가?

---

## 관련 글

- [Elasticsearch (Part 1: 개념과 구조)](/learning/deep-dive/deep-dive-elasticsearch-basics/)
- [Elasticsearch (Part 2: 시작과 실무 활용)](/learning/deep-dive/deep-dive-elasticsearch-basics-part2/)
- [로깅 전략](/learning/deep-dive/deep-dive-logging-strategy/)
- [구조화된 로깅](/learning/deep-dive/deep-dive-structured-logging/)
- [Prometheus & Grafana](/learning/deep-dive/deep-dive-prometheus-grafana/)
- [APM 기초](/learning/deep-dive/deep-dive-apm-basics/)
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)
- [Observability Alarms](/learning/deep-dive/deep-dive-observability-alarms/)
- [Docker Compose & 네트워크](/learning/deep-dive/deep-dive-docker-compose-network/)
