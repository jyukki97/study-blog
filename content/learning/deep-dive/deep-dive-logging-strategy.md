---
title: "로깅 전략: 효과적인 로그 설계와 관리"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Logging", "Logback", "SLF4J", "Structured Logging", "MDC", "ELK"]
categories: ["Backend Deep Dive"]
description: "구조화된 로깅, 로그 레벨 전략, MDC 활용, 로그 수집/분석까지 실무 가이드"
module: "ops-observability"
study_order: 340
---

## 이 글에서 얻는 것

- **로그 레벨**(DEBUG/INFO/WARN/ERROR)을 적절히 사용할 수 있습니다.
- **구조화된 로깅**(Structured Logging)으로 검색 가능한 로그를 작성합니다.
- **MDC**(Mapped Diagnostic Context)로 요청별 추적을 구현합니다.
- **로그 수집**(ELK 스택)의 기본 개념을 이해합니다.

## 0) 로깅은 "운영 환경에서 눈"이다

### 왜 로깅이 중요한가?

```
개발 환경:
- 디버거로 단계별 실행
- 로컬에서 재현 가능

운영 환경:
- 디버거 사용 불가
- 재현 어려움
- 로그만이 유일한 단서!
```

**로그의 역할:**
- 문제 원인 파악 (디버깅)
- 사용자 행동 추적
- 성능 분석
- 보안 감사 (Audit)
- 비즈니스 인사이트

## 1) 로그 레벨

### 1-1) 로그 레벨 종류

```
TRACE: 가장 상세한 정보 (거의 사용 안 함)
DEBUG: 디버깅 정보
INFO:  중요한 비즈니스 이벤트
WARN:  경고 (처리는 됐지만 주의 필요)
ERROR: 오류 (처리 실패)
```

### 1-2) 레벨별 사용 예시

**TRACE (거의 사용 안 함)**
```java
log.trace("Entering method calculateTotal() with params: {}", params);
log.trace("Variable x = {}, y = {}", x, y);
```

**DEBUG (개발/테스트)**
```java
log.debug("Fetching user from database: userId={}", userId);
log.debug("Query executed: {} (took {}ms)", sql, duration);
log.debug("Cache hit: key={}", key);
```

**INFO (중요 이벤트)**
```java
log.info("User logged in: userId={}", userId);
log.info("Order created: orderId={}, amount={}", orderId, amount);
log.info("Email sent to: {}", email);
log.info("Application started in {}ms", startupTime);
```

**WARN (주의 필요)**
```java
log.warn("Retry attempt {}/{} for orderId={}", attempt, maxRetries, orderId);
log.warn("Deprecated API called: /api/v1/users");
log.warn("Connection pool usage high: {}/{}", active, max);
log.warn("Fallback to default value: {}", defaultValue);
```

**ERROR (오류)**
```java
log.error("Failed to process order: orderId={}", orderId, exception);
log.error("Database connection failed", exception);
log.error("Payment gateway timeout: orderId={}", orderId);
```

### 1-3) Spring Boot 로그 레벨 설정

```yaml
# application.yml
logging:
  level:
    root: INFO                           # 기본 레벨
    com.myapp: DEBUG                     # 패키지별 설정
    org.springframework.web: DEBUG       # Spring Web 로그
    org.hibernate.SQL: DEBUG             # SQL 로그
    org.hibernate.type.descriptor.sql: TRACE  # SQL 파라미터
```

**환경별 설정:**
```yaml
# application-dev.yml (개발)
logging:
  level:
    root: DEBUG

# application-prod.yml (운영)
logging:
  level:
    root: INFO
    com.myapp: WARN  # 운영에서는 WARN 이상만
```

## 2) 구조화된 로깅 (Structured Logging)

### 2-1) 왜 구조화가 필요한가?

**❌ 비구조화 로그 (검색 어려움)**
```java
log.info("User Alice logged in from 192.168.1.1 at 2025-12-16 10:30:00");
log.info("Order 12345 created by user Bob with amount $1000");
```

**검색 시:**
```
"Alice" 검색 → 다른 Alice도 나옴
"amount" 검색 → 정확한 금액 추출 어려움
```

**✅ 구조화 로그 (검색 쉬움)**
```java
log.info("User logged in: userId={}, ip={}", userId, ipAddress);
log.info("Order created: orderId={}, userId={}, amount={}", orderId, userId, amount);
```

**JSON 로그 (더 강력):**
```json
{
  "timestamp": "2025-12-16T10:30:00.000Z",
  "level": "INFO",
  "message": "User logged in",
  "userId": "alice",
  "ipAddress": "192.168.1.1",
  "requestId": "abc-123"
}
```

### 2-2) Logback JSON 설정

**의존성:**
```gradle
// build.gradle
implementation 'net.logstash.logback:logstash-logback-encoder:7.4'
```

**logback-spring.xml:**
```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <!-- JSON 형식으로 출력 -->
        </encoder>
    </appender>

    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>logs/application.log</file>
        <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <fileNamePattern>logs/application-%d{yyyy-MM-dd}.log</fileNamePattern>
            <maxHistory>30</maxHistory>
        </rollingPolicy>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE" />
        <appender-ref ref="FILE" />
    </root>
</configuration>
```

### 2-3) 구조화 로깅 예시

```java
@Service
public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public Order createOrder(CreateOrderRequest request) {
        log.info("Creating order: userId={}, items={}, totalAmount={}",
                request.getUserId(),
                request.getItems().size(),
                request.getTotalAmount());

        try {
            Order order = orderRepository.save(request.toEntity());

            log.info("Order created successfully: orderId={}, userId={}, amount={}",
                    order.getId(),
                    order.getUserId(),
                    order.getAmount());

            return order;

        } catch (Exception e) {
            log.error("Failed to create order: userId={}, error={}",
                    request.getUserId(),
                    e.getMessage(),
                    e);  // 마지막 파라미터는 예외
            throw e;
        }
    }
}
```

**출력 (JSON):**
```json
{
  "timestamp": "2025-12-16T10:30:00.000Z",
  "level": "INFO",
  "logger": "com.myapp.service.OrderService",
  "message": "Order created successfully: orderId=12345, userId=alice, amount=1000",
  "orderId": 12345,
  "userId": "alice",
  "amount": 1000
}
```

## 3) MDC: 요청별 컨텍스트 추적

### 3-1) MDC란?

```
MDC (Mapped Diagnostic Context)
= 현재 스레드에 컨텍스트 정보 저장

용도:
- 요청 ID 추적
- 사용자 ID 추적
- 세션 ID 추적

장점:
- 모든 로그에 자동으로 추가
- 요청별로 로그 필터링 가능
```

### 3-2) MDC 사용 예시

**Filter에서 MDC 설정:**
```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class MdcLoggingFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            // 요청 ID 생성
            String requestId = UUID.randomUUID().toString();
            MDC.put("requestId", requestId);

            // 사용자 ID (인증된 경우)
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated()) {
                MDC.put("userId", auth.getName());
            }

            // IP 주소
            MDC.put("ipAddress", request.getRemoteAddr());

            filterChain.doFilter(request, response);

        } finally {
            // 요청 종료 시 MDC 클리어 (메모리 누수 방지)
            MDC.clear();
        }
    }
}
```

**로그 출력:**
```java
@Service
public class UserService {
    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    public User findUser(Long id) {
        // MDC에서 자동으로 requestId, userId 추가
        log.info("Fetching user: id={}", id);
        return userRepository.findById(id).orElseThrow();
    }
}
```

**Logback 설정 (MDC 포함):**
```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} [requestId=%X{requestId}, userId=%X{userId}] - %msg%n</pattern>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE" />
    </root>
</configuration>
```

**출력:**
```
10:30:00.123 [http-nio-8080-exec-1] INFO  c.m.service.UserService [requestId=abc-123, userId=alice] - Fetching user: id=1
```

### 3-3) 비동기 작업에서 MDC

```java
@Service
public class AsyncService {

    @Async
    public CompletableFuture<Void> processAsync(Order order) {
        // ❌ 새 스레드에서는 MDC가 비어있음!

        // ✅ 해결: MDC를 전달
        Map<String, String> mdcContext = MDC.getCopyOfContextMap();

        return CompletableFuture.runAsync(() -> {
            // MDC 복원
            if (mdcContext != null) {
                MDC.setContextMap(mdcContext);
            }

            try {
                log.info("Processing order asynchronously: orderId={}", order.getId());
                // 처리...
            } finally {
                MDC.clear();
            }
        });
    }
}
```

## 4) 로그 수집과 분석 (ELK 스택)

### 4-1) ELK 스택이란?

```
ELK = Elasticsearch + Logstash + Kibana

Elasticsearch: 로그 저장/검색
Logstash:      로그 수집/변환
Kibana:        로그 시각화/대시보드

플로우:
App → (JSON 로그) → Logstash → Elasticsearch → Kibana
```

### 4-2) Filebeat로 로그 수집

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  app:
    image: myapp:1.0
    volumes:
      - ./logs:/app/logs  # 로그 파일 공유

  filebeat:
    image: docker.elastic.co/beats/filebeat:8.11.0
    volumes:
      - ./logs:/var/log/myapp
      - ./filebeat.yml:/usr/share/filebeat/filebeat.yml
    depends_on:
      - elasticsearch

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch
```

**filebeat.yml:**
```yaml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/myapp/*.log
    json.keys_under_root: true  # JSON 파싱

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "myapp-logs-%{+yyyy.MM.dd}"

setup.kibana:
  host: "kibana:5601"
```

### 4-3) Kibana에서 로그 검색

```
검색 예시:
- level: ERROR
- userId: alice
- requestId: abc-123
- message: *order*
- amount > 1000
- @timestamp: [now-1h TO now]
```

## 5) 로깅 베스트 프랙티스

### ✅ 1. 로그 레벨 적절히 사용

```java
// ✅ 좋은 예
log.debug("Cache lookup: key={}", key);  // 디버깅용
log.info("User logged in: userId={}", userId);  // 비즈니스 이벤트
log.warn("Retry attempt {}/{}", attempt, max);  // 경고
log.error("Payment failed: orderId={}", orderId, e);  // 오류

// ❌ 나쁜 예
log.info("x = 1, y = 2");  // DEBUG가 적절
log.error("User logged in");  // ERROR가 아님, INFO
```

### ✅ 2. 파라미터 바인딩 사용

```java
// ❌ 나쁜 예 (문자열 연결)
log.info("User " + userId + " logged in");  // 항상 문자열 생성

// ✅ 좋은 예 (파라미터 바인딩)
log.info("User logged in: userId={}", userId);  // 로그 레벨이 활성화된 경우만 생성
```

### ✅ 3. 예외는 마지막 파라미터로

```java
// ✅ 좋은 예
try {
    // ...
} catch (Exception e) {
    log.error("Failed to process order: orderId={}", orderId, e);
    // 예외는 마지막 파라미터 → 스택 트레이스 출력
}

// ❌ 나쁜 예
catch (Exception e) {
    log.error("Error: {}", e.getMessage());  // 스택 트레이스 없음!
}
```

### ✅ 4. 민감 정보 로그 안 함

```java
// ❌ 나쁜 예
log.info("Login attempt: email={}, password={}", email, password);
log.info("Credit card: {}", creditCardNumber);

// ✅ 좋은 예
log.info("Login attempt: email={}", maskEmail(email));
log.info("Payment processed: cardLast4={}", cardLast4Digits);
```

### ✅ 5. 구조화된 데이터

```java
// ❌ 나쁜 예
log.info("User Alice ordered 3 items for $100");

// ✅ 좋은 예
log.info("Order created: userId={}, itemCount={}, amount={}",
        userId, itemCount, amount);
```

### ✅ 6. 요청 시작/종료 로깅

```java
@RestController
public class OrderController {

    @PostMapping("/orders")
    public ResponseEntity<Order> createOrder(@RequestBody CreateOrderRequest request) {
        log.info("API called: POST /orders, userId={}", request.getUserId());

        try {
            Order order = orderService.createOrder(request);
            log.info("API success: POST /orders, orderId={}, duration={}ms",
                    order.getId(), duration);
            return ResponseEntity.ok(order);

        } catch (Exception e) {
            log.error("API failed: POST /orders, userId={}, error={}",
                    request.getUserId(), e.getMessage(), e);
            throw e;
        }
    }
}
```

## 6) 자주 하는 실수

### ❌ 실수 1: 너무 많은 로그

```java
// ❌ 나쁜 예
for (User user : users) {
    log.info("Processing user: {}", user.getId());  // 100만 건 루프!
}

// ✅ 좋은 예
log.info("Processing {} users", users.size());
for (User user : users) {
    log.debug("Processing user: {}", user.getId());  // DEBUG 레벨
}
log.info("Processed {} users in {}ms", users.size(), duration);
```

### ❌ 실수 2: 로그에 예외 안 넣음

```java
// ❌ 나쁜 예
catch (Exception e) {
    log.error("Error occurred: {}", e.getMessage());
}

// ✅ 좋은 예
catch (Exception e) {
    log.error("Error occurred", e);  // 스택 트레이스 포함
}
```

### ❌ 실수 3: MDC 클리어 안 함

```java
// ❌ 나쁜 예
MDC.put("userId", userId);
// 요청 끝나도 MDC가 남아있음 (메모리 누수)

// ✅ 좋은 예
try {
    MDC.put("userId", userId);
    // 처리...
} finally {
    MDC.clear();
}
```

## 연습 (추천)

1. **구조화 로깅 적용**
   - 프로젝트에 JSON 로깅 설정
   - 모든 로그를 key=value 형식으로 변경

2. **MDC 구현**
   - Filter에서 requestId 추가
   - 모든 로그에 requestId 포함 확인

3. **ELK 스택 실습**
   - Docker Compose로 ELK 구성
   - Kibana에서 로그 검색/시각화

## 요약: 스스로 점검할 것

- 로그 레벨을 적절히 사용할 수 있다
- 구조화된 로그를 작성할 수 있다
- MDC로 요청별 추적을 구현할 수 있다
- ELK 스택의 기본 개념을 이해한다
- 로깅 베스트 프랙티스를 적용할 수 있다

## 다음 단계

- APM (Application Performance Monitoring): `/learning/deep-dive/deep-dive-apm-basics/`
- Prometheus + Grafana: `/learning/deep-dive/deep-dive-prometheus-grafana/`
- 분산 추적 (Zipkin): `/learning/deep-dive/deep-dive-distributed-tracing/`
