---
title: "로깅 전략: ELK와 구조화된 로그(Structured Logging)"
date: 2025-12-07
draft: false
topic: "DevOps"
tags: ["Logging", "Structured Logging", "MDC", "ELK"]
categories: ["Backend Deep Dive"]
description: "단순 텍스트 로그가 아니라 '검색 가능한' JSON 로그를 남겨야 하는 이유와 MDC 활용법"
module: "ops-observability"
study_order: 603
quizzes:
  - question: "구조화된 로그(Structured Logging)가 텍스트 로그보다 나은 점은?"
    options:
      - "사람이 읽기 쉽다."
      - "JSON 형식으로 키-값 필터링이 가능하여 Kibana 등에서 order_id:123 같은 검색이 바로 된다."
      - "파일 크기가 작다."
      - "차이가 없다."
    answer: 1
    explanation: "텍스트 로그는 정규식으로 파싱해야 하지만, JSON 로그는 필드별 인덱싱이 되어 빠른 검색과 대시보드 생성이 가능합니다."

  - question: "MDC(Mapped Diagnostic Context)를 사용하는 이유는?"
    options:
      - "로그 파일을 분리하기 위해"
      - "멀티스레드 환경에서 모든 로그에 requestId 같은 '꼬리표'를 자동으로 붙여 요청 흐름을 추적하기 위해"
      - "로그 크기를 줄이기 위해"
      - "암호화를 위해"
    answer: 1
    explanation: "스레드 로컬에 requestId를 저장하면 해당 스레드의 모든 로그에 자동 포함됩니다. 에러 발생 시 해당 ID로 필터링하면 전체 흐름을 볼 수 있습니다."

  - question: "MDC 사용 시 finally 블록에서 MDC.clear()를 호출해야 하는 이유는?"
    options:
      - "성능을 위해"
      - "스레드 풀 재사용 시 이전 요청의 MDC 값이 오염되어 잘못된 requestId가 로그에 찍히는 것을 방지"
      - "메모리를 절약하기 위해"
      - "필요 없다"
    answer: 1
    explanation: "스레드 풀은 스레드를 재사용합니다. clear() 없이 다음 요청이 오면 이전 요청의 requestId가 그대로 남아있을 수 있습니다."

  - question: "로그를 AsyncAppender로 비동기 처리해야 하는 이유는?"
    options:
      - "로그를 더 많이 남기기 위해"
      - "로그 I/O가 메인 스레드를 블로킹하면 응답 시간이 느려지므로, 별도 스레드로 처리하여 성능 영향 최소화"
      - "로그를 암호화하기 위해"
      - "차이가 없다"
    answer: 1
    explanation: "동기 로깅은 디스크 I/O가 느리면 요청 처리도 느려집니다. 비동기 큐에 넣고 별도 스레드가 처리하면 메인 스레드에 영향이 적습니다."

  - question: "운영 환경 로그에서 민감 정보(비밀번호, 카드번호) 처리 방법은?"
    options:
      - "그대로 남긴다."
      - "마스킹(Sanitization) 처리하여 ****로 표시하고, 절대 평문으로 로깅하지 않는다."
      - "로그를 남기지 않는다."
      - "암호화해서 남긴다."
    answer: 1
    explanation: "로그에 민감 정보가 남으면 보안 사고 시 유출됩니다. 비밀번호는 로깅하지 않고, 카드번호는 앞 4자리만 남기는 등 마스킹이 필수입니다."
---

## 📝 1. 로그는 인간이 아니라 "기계"가 읽는 것이다

`System.out.println("User login: " + name)` -> 최악의 로그입니다.
서버가 10대고 로그가 초당 1000줄 쌓이면, `grep`으로는 답이 없습니다.

로그는 **수집하고, 인덱싱하고, 검색하기 위해** 남기는 데이터입니다.

---

## 📊 2. 구조화된 로그 (Structured Logging)

텍스트 대신 **JSON**으로 남기세요.

### Text vs JSON Comparison

| 특징 | Text Log (Bad) | JSON Log (Good) |
| :--- | :--- | :--- |
| **가독성** | 인간 친화적 | 기계 친화적 |
| **검색** | 정규식 (`grep`) 필요 | 키-값 필터링 (`order_id: 123`) |
| **확장성** | 필드 추가 시 파싱 로직 수정 필요 | 유연함 (New field = New key) |

**Structure Example:**
```json
{
  "@timestamp": "2025-01-01T10:00:00Z",
  "level": "ERROR",
  "message": "Order processing failed",
  "service": "order-service",
  "context": {
    "order_id": 123,
    "user_id": "userA",
    "reason": "connection_timeout"
  },
  "trace": {
    "id": "a1b2c3d4"
  }
}
```
-> `event="order_failed"` 로 검색 0.1초 컷. Kibana 대시보드 만들기 쉬움.

---

## 🕸️ 3. ELK Stack 아키텍처

로그를 어떻게 모으는지 흐름을 이해해야 합니다.

```mermaid
flowchart TD
    subgraph App_Server [Application Server]
        App[Spring Boot] -->|JSON Log file| File[app.json]
        Filebeat[Filebeat] -.->|Tail| File
    end
    
    subgraph Log_Pipeline [Log Pipeline]
        Filebeat -->|Ship| Kafka["Kafka (Buffer)"]
        Kafka -->|Consume| Logstash["Logstash (Filter/GeoIP)"]
        Logstash -->|Index| ES[Elasticsearch]
    end
    
    ES -->|Visualize| Kibana[Kibana]
    
    style App fill:#e3f2fd,stroke:#2196f3
    style Kafka fill:#fff9c4,stroke:#fbc02d
    style ES fill:#f3e5f5,stroke:#9c27b0
```

1. **App**: 로그를 파일(`app.json`)에 씁니다. (네트워크로 직접 쏘면 앱 느려짐)
2. **Filebeat**: 파일을 꼬리물기(tail)해서 가볍게 퍼나릅니다.
3. **Elasticsearch**: 검색 엔진에 저장합니다.
4. **Kibana**: 시각화합니다.

---

## 🔍 4. MDC: 분산 추적의 시작

멀티 스레드 환경에서 로그가 뒤섞이면 **"이 에러가 누구 요청에서 난 거지?"** 알 수 없습니다.
**MDC (Mapped Diagnostic Context)** 는 스레드 로컬에 "꼬리표"를 붙입니다.

**MDC Flow Visualization:**

```mermaid
sequenceDiagram
    participant Client
    participant Filter as MDCFilter
    participant Controller
    participant Service
    
    Client->>Filter: HTTP Request (Header: X-Request-ID)
    Filter->>Filter: MDC.put("requestId", uuid)
    
    Filter->>Controller: Controller Call
    Controller->>Service: Service Call (Thread Local 유지)
    Service->>Service: log.info("Done") 
    Note right of Service: Log includes [requestId=uuid]
    
    Service-->>Filter: Return
    Filter->>Filter: MDC.clear()
```

```java
// MDC Usage Pattern
public class MdcFilter implements Filter {
    public void doFilter(...) {
        MDC.put("requestId", UUID.randomUUID().toString());
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear(); // 필수: 스레드 풀 재사용 시 오염 방지
        }
    }
}
```

로그를 볼 때 `requestId` 하나로 전체 흐름을 필터링할 수 있게 됩니다.

## 요약

## 요약

> [!TIP]
> **Production Logging Checklist**:
> - [ ] **Async**: Logback AsyncAppender 사용 (Main 스레드 블로킹 방지)
> - [ ] **Rolling**: 시간/용량 기반 로그 회전 정책 설정 (Disk Full 방지)
> - [ ] **Trace**: 모든 로그에 `traceId` 포함 (MDC 활용)
> - [ ] **Sanitization**: 민감 정보(비밀번호, 카드번호) 마스킹 처리

1. **Format**: JSON으로 남겨라. (LogstashEncoder 등 사용)
2. **Context**: MDC를 써서 모든 로그에 요청 ID를 박아라.
3. **Async**: 별도 스레드로 로그를 수집해라. (App 성능 영향 최소화)
