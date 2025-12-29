---
title: "Graceful Shutdown: 안전한 애플리케이션 종료"
study_order: 610
date: 2025-12-28
topic: "DevOps"
topic_icon: "🛑"
topic_description: "Spring Boot 종료 처리, K8s PreStop Hook, 연결 드레이닝"
tags: ["Graceful Shutdown", "Spring Boot", "Kubernetes", "Zero Downtime"]
categories: ["Ops"]
draft: false
module: "ops-observability"
quizzes:
  - question: "Graceful Shutdown의 핵심 목적은?"
    options:
      - "애플리케이션을 더 빨리 종료시키는 것"
      - "진행 중인 요청을 완료하고, 리소스를 정리한 후 안전하게 종료하여 데이터 손실과 오류 응답을 방지하는 것"
      - "메모리 사용량을 줄이는 것"
      - "로그를 더 많이 남기는 것"
    answer: 1
    explanation: "즉시 종료(SIGKILL)하면 진행 중인 트랜잭션이 롤백되거나 클라이언트가 Connection Reset을 받습니다. Graceful Shutdown은 새 요청을 거부하고, 기존 요청을 완료한 후 종료합니다."

  - question: "Spring Boot에서 `server.shutdown=graceful` 설정 시 새 HTTP 요청에 대한 동작은?"
    options:
      - "정상적으로 처리된다."
      - "종료 시작 후 새 요청은 503 Service Unavailable을 반환하며 거부된다."
      - "요청이 무한 대기한다."
      - "자동으로 다른 서버로 라우팅된다."
    answer: 1
    explanation: "Graceful Shutdown이 시작되면 새 HTTP 요청은 즉시 503을 반환합니다. 진행 중인 요청만 완료 후 종료됩니다."

  - question: "Kubernetes에서 Pod 종료 시 preStop Hook에 `sleep 5`를 넣는 이유는?"
    options:
      - "CPU 사용량을 줄이기 위해"
      - "Endpoint 제거가 모든 Load Balancer에 전파되기 전에 요청이 들어올 수 있으므로, 전파 시간을 기다리기 위해"
      - "로그를 더 많이 남기기 위해"
      - "메모리를 정리하기 위해"
    answer: 1
    explanation: "K8s가 SIGTERM을 보내면서 동시에 Endpoint를 제거하지만, 이 변경이 모든 LB/Ingress에 전파되기까지 약간의 시간이 걸립니다. sleep으로 대기하여 이 기간에 들어오는 요청을 처리합니다."

  - question: "Kafka Consumer의 Graceful Shutdown에서 @PreDestroy로 `registry.stop()`을 호출하는 이유는?"
    options:
      - "Consumer를 더 빠르게 종료시키기 위해"
      - "현재 처리 중인 메시지를 완료하고, 오프셋을 커밋한 후 Consumer를 안전하게 중지하기 위해"
      - "재시작을 위해"
      - "로그를 남기기 위해"
    answer: 1
    explanation: "Kafka Consumer가 처리 중인 메시지가 있는 상태에서 강제 종료되면 중복 처리가 발생할 수 있습니다. `stop()`으로 안전하게 처리를 완료하고 오프셋을 커밋해야 합니다."

  - question: "`terminationGracePeriodSeconds`와 Spring의 `timeout-per-shutdown-phase`의 관계로 올바른 것은?"
    options:
      - "둘은 동일한 설정이다."
      - "terminationGracePeriodSeconds는 K8s의 총 종료 대기 시간이고, Spring 타임아웃 + 여유 시간보다 길어야 한다."
      - "Spring 설정이 K8s 설정을 덮어쓴다."
      - "둘 다 필요 없다."
    answer: 1
    explanation: "Spring의 shutdown timeout이 30초라면 K8s의 terminationGracePeriodSeconds는 최소 35~40초 이상이어야 합니다. 그렇지 않으면 Spring이 완료하기 전에 SIGKILL이 전송됩니다."
---

## 이 글에서 얻는 것

- **Graceful Shutdown**의 필요성을 이해합니다
- **Spring Boot**에서 안전한 종료를 구현합니다
- **Kubernetes**에서 Zero-Downtime 배포를 위한 설정을 알아봅니다

---

## 왜 Graceful Shutdown인가?

### 문제: 즉시 종료

```mermaid
sequenceDiagram
    participant Client
    participant App
    participant DB
    
    Client->>App: POST /orders (진행 중)
    App->>DB: INSERT
    
    Note over App: SIGKILL ❌ 즉시 종료
    
    App--xClient: Connection Reset
    DB->>DB: 트랜잭션 롤백?
    
    Note over Client: 주문 성공? 실패? 🤷
```

### 해결: Graceful Shutdown

```mermaid
sequenceDiagram
    participant Client
    participant App
    participant DB
    
    Note over App: SIGTERM 수신
    App->>App: 새 요청 거부
    
    Client->>App: POST /orders (진행 중)
    App->>DB: INSERT
    DB-->>App: Success
    App-->>Client: 201 Created ✅
    
    Note over App: 모든 요청 완료 후 종료
```

---

## Spring Boot Graceful Shutdown

### 설정

```yaml
# application.yml
server:
  shutdown: graceful  # 기본값: immediate

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s  # 최대 대기 시간
```

### 동작 과정

1. **SIGTERM 수신**
2. **새 HTTP 요청 거부** (503 반환)
3. **진행 중인 요청 대기**
4. **timeout 후 강제 종료**

### 커스텀 종료 로직

```java
@Component
public class ShutdownHandler implements DisposableBean, ApplicationListener<ContextClosedEvent> {
    
    @Autowired
    private ThreadPoolTaskExecutor taskExecutor;
    
    @Override
    public void onApplicationEvent(ContextClosedEvent event) {
        log.info("Application shutdown initiated");
        
        // 백그라운드 작업 완료 대기
        taskExecutor.setWaitForTasksToCompleteOnShutdown(true);
        taskExecutor.setAwaitTerminationSeconds(30);
    }
    
    @Override
    public void destroy() {
        log.info("Cleanup resources");
        
        // 외부 연결 정리
        closeExternalConnections();
        
        // 캐시 플러시
        flushCache();
    }
    
    @PreDestroy
    public void preDestroy() {
        log.info("PreDestroy - final cleanup");
    }
}
```

---

## 컴포넌트별 종료 처리

### 스레드 풀

```java
@Bean
public ThreadPoolTaskExecutor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(10);
    executor.setMaxPoolSize(20);
    
    // Graceful shutdown 설정
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(60);
    
    return executor;
}
```

### Kafka Consumer

```java
@Component
public class KafkaShutdownHandler {
    
    @Autowired
    private KafkaListenerEndpointRegistry registry;
    
    @PreDestroy
    public void shutdown() {
        log.info("Stopping Kafka consumers");
        
        // 모든 컨슈머 중지
        registry.stop();
        
        // 현재 처리 중인 메시지 완료 대기
        // (ContainerProperties.setAckMode 설정에 따라)
    }
}
```

### 스케줄러

```java
@Configuration
public class SchedulerConfig {
    
    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(5);
        
        // Graceful shutdown
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        
        return scheduler;
    }
}
```

---

## Kubernetes 연동

### Pod 종료 시퀀스

```mermaid
sequenceDiagram
    participant K8s
    participant Service
    participant Pod
    
    K8s->>Service: Endpoint 제거
    K8s->>Pod: SIGTERM
    
    Note over Pod: preStop Hook 실행
    Pod->>Pod: sleep 5s (요청 드레이닝)
    
    Note over Pod: Graceful Shutdown
    Pod->>Pod: 진행 중인 요청 완료
    
    alt 30s 후에도 미종료
        K8s->>Pod: SIGKILL
    end
```

### PreStop Hook

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5"]
      # 또는 HTTP
      # preStop:
      #   httpGet:
      #     path: /actuator/shutdown
      #     port: 8080
  terminationGracePeriodSeconds: 30  # 총 종료 대기 시간
```

### 왜 sleep이 필요한가?

```mermaid
flowchart TB
    subgraph "종료 시퀀스"
        T1["1. K8s가 Endpoint 제거\n(Service에서 제외)"]
        T2["2. SIGTERM 전송\n(동시 발생)"]
        T3["3. Ingress/LB 업데이트\n(약간의 지연)"]
    end
    
    T1 --> T2
    T2 --> T3
    
    Note["⚠️ Endpoint 제거가 모든 LB에\n전파되기 전 요청이 올 수 있음\n→ sleep으로 대기"]
```

### 완전한 Deployment 예시

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0  # 모든 Pod 유지
      maxSurge: 1
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: order-service:latest
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
```

---

## 헬스체크 연동

### Readiness vs Liveness

```java
@Component
public class CustomHealthIndicator implements HealthIndicator {
    
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);
    
    @EventListener(ContextClosedEvent.class)
    public void onShutdown() {
        shuttingDown.set(true);
    }
    
    @Override
    public Health health() {
        if (shuttingDown.get()) {
            return Health.down()
                .withDetail("reason", "Shutting down")
                .build();
        }
        return Health.up().build();
    }
}
```

```yaml
# application.yml
management:
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState, db, redis
        liveness:
          include: livenessState
```

---

## 테스트

### 로컬 테스트

```bash
# 애플리케이션 시작
java -jar app.jar &
APP_PID=$!

# 요청 진행 중에 종료 시도
curl -X POST http://localhost:8080/api/long-running &
sleep 1
kill -TERM $APP_PID

# 로그 확인
tail -f app.log
```

### 종료 시간 측정

```java
@Component
public class ShutdownTimer {
    
    private long shutdownStartTime;
    
    @EventListener(ContextClosedEvent.class)
    public void onShutdownStart() {
        shutdownStartTime = System.currentTimeMillis();
        log.info("Shutdown started");
    }
    
    @PreDestroy
    public void onShutdownComplete() {
        long duration = System.currentTimeMillis() - shutdownStartTime;
        log.info("Shutdown completed in {}ms", duration);
    }
}
```

---

## 요약

### Graceful Shutdown 체크리스트

| 항목 | 설정 |
|------|------|
| Spring Boot | `server.shutdown=graceful` |
| 스레드 풀 | `waitForTasksToCompleteOnShutdown=true` |
| K8s preStop | `sleep 5-10s` |
| terminationGracePeriod | 애플리케이션 타임아웃 + 여유 |

### 핵심 원칙

1. **새 요청 거부**: 종료 시작 시 즉시
2. **진행 요청 완료**: 충분한 대기 시간
3. **리소스 정리**: DB 연결, 캐시 플러시
4. **K8s 연동**: preStop + Readiness 조합

---

## 🔗 Related Deep Dive

- **[Kubernetes 기본](/learning/deep-dive/deep-dive-kubernetes-basics/)**: Pod 라이프사이클.
- **[헬스체크](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)**: Liveness/Readiness 설계.
