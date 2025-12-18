---
title: "ELK Stack: 로그 수집과 분석 플랫폼 구축하기"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["ELK", "Elasticsearch", "Logstash", "Kibana", "Filebeat", "Log Analysis"]
categories: ["Backend Deep Dive"]
description: "ELK Stack (Elasticsearch, Logstash, Kibana)으로 로그 수집, 저장, 분석 시스템 구축"
module: "ops-observability"
study_order: 341
---

## 이 글에서 얻는 것

- **ELK Stack**의 구성 요소와 역할을 이해합니다.
- **Filebeat**로 로그를 수집하고 Elasticsearch에 저장합니다.
- **Kibana**로 로그를 시각화하고 분석합니다.
- **실전 로그 분석** 대시보드를 구축할 수 있습니다.

## 1) ELK Stack 구성 요소

```
애플리케이션 → Filebeat → Logstash → Elasticsearch → Kibana
             (로그 수집)  (변환/필터) (저장/검색)  (시각화)
```

**각 컴포넌트 역할:**
- **Filebeat**: 로그 파일 수집 (경량 Agent)
- **Logstash**: 로그 변환, 필터링, 파싱
- **Elasticsearch**: 로그 저장 및 검색
- **Kibana**: 로그 시각화 및 대시보드

## 2) Docker Compose로 ELK 구성

```yaml
version: '3.8'

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms1g -Xmx1g"
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data

  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
    ports:
      - "5044:5044"
    depends_on:
      - elasticsearch

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.11.0
    user: root
    volumes:
      - ./filebeat/filebeat.yml:/usr/share/filebeat/filebeat.yml
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    depends_on:
      - logstash

volumes:
  es-data:
```

## 3) Filebeat 설정

**filebeat.yml:**
```yaml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/*.log
    json.keys_under_root: true
    json.add_error_key: true
    fields:
      app: myapp
      env: production

output.logstash:
  hosts: ["logstash:5044"]
```

## 4) Logstash 파이프라인

**logstash/pipeline/logstash.conf:**
```
input {
  beats {
    port => 5044
  }
}

filter {
  # JSON 파싱
  json {
    source => "message"
  }

  # 날짜 파싱
  date {
    match => ["timestamp", "ISO8601"]
  }

  # Grok 패턴으로 로그 파싱
  grok {
    match => { "message" => "%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:level} %{GREEDYDATA:msg}" }
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "myapp-logs-%{+YYYY.MM.dd}"
  }
}
```

## 5) Kibana에서 로그 분석

```
1. Index Pattern 생성:
   Management → Index Patterns → Create
   Pattern: myapp-logs-*

2. Discover에서 로그 검색:
   - 시간 범위 선택
   - 필터 추가 (level:ERROR)
   - 검색어 입력

3. Visualizations 생성:
   - Line chart: 시간별 로그 수
   - Pie chart: 로그 레벨 분포
   - Table: 상위 에러 메시지

4. Dashboard 구성:
   - Visualization 조합
   - 실시간 업데이트
```

## 요약

- ELK = Elasticsearch + Logstash + Kibana
- Filebeat로 로그 수집
- Logstash로 변환/필터링
- Kibana로 시각화 및 분석

## 다음 단계

- 로깅 전략: `/learning/deep-dive/deep-dive-logging-strategy/`
- Elasticsearch: `/learning/deep-dive/deep-dive-elasticsearch-basics/`
