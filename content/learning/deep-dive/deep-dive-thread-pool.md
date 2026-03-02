---
title: "Thread Pool 튜닝: 적정 스레드 수 찾기"
study_order: 44
date: 2025-12-28
topic: "Java"
topic_icon: "🧵"
topic_description: "ThreadPoolExecutor 구성, 큐 전략, 모니터링"
tags: ["Java", "Thread Pool", "Concurrency", "Performance"]
categories: ["Foundation"]
draft: false
description: "ThreadPoolExecutor 파라미터 튜닝, 적정 스레드 수 공식, 모니터링 전략"
module: "foundation"
quizzes:
  - question: "`ThreadPoolExecutor`에서 새로운 스레드가 생성되는 시점은 언제인가? (기본 설정 기준)"
    options:
      - "작업이 들어올 때마다 항상 생성된다."
      - "Core Pool Size가 꽉 차고, 작업 큐(Queue)도 가득 찼을 때 Max Pool Size까지 생성된다."
      - "Core Pool Size가 꽉 차면 즉시 Max Pool Size까지 생성된다."
      - "CPU 사용량이 100%일 때 생성된다."
    answer: 1
    explanation: "스레드 풀은 'Core 스레드 채움 -> 큐에 대기 -> 큐가 꽉 차면 Max 스레드까지 확장 -> 그것도 안 되면 거부(Reject)'의 순서로 동작합니다."

  - question: "실무에서 `Executors.newFixedThreadPool()`이나 `newCachedThreadPool()` 대신 `ThreadPoolExecutor`를 직접 생성하여 사용하는 것을 권장하는 가장 큰 이유는?"
    options:
      - "코드가 더 짧아서"
      - "기본 팩토리 메서드들은 '무제한 큐(Unbounded Queue)'나 '무제한 스레드 생성'을 허용하여 OOM(OutOfMemoryError) 발생 위험이 있기 때문이다."
      - "성능이 더 빨라서"
      - "자바 8부터 팩토리 메서드가 Deprecated 되었기 때문이다."
    answer: 1
    explanation: "`newFixedThreadPool`은 `LinkedBlockingQueue`의 크기 제한이 없고, `newCachedThreadPool`은 스레드를 무한정 생성할 수 있어 리소스 고갈 위험이 큽니다."

  - question: "IO 바운드(DB 조회가 많은) 작업의 적정 스레드 수를 결정할 때, CPU 코어 수보다 훨씬 많은 스레드를 할당하는 이유는?"
    options:
      - "IO 작업 중에는 CPU가 놀지 않게 하기 위해 문맥 교환(Context Switching)을 늘려야 하므로"
      - "스레드가 IO 응답을 기다리는(Blocking) 동안 CPU를 다른 스레드가 사용할 수 있도록 하여 전체 처리율을 높이기 위해"
      - "메모리를 더 많이 사용하기 위해"
      - "자바 스레드는 OS 스레드와 1:1 매핑되지 않으므로"
    answer: 1
    explanation: "IO 작업은 CPU를 거의 쓰지 않고 대기하는 시간이 길므로, 그 시간에 다른 스레드가 CPU를 쓰게 하면 자원 효율성이 높아집니다."

  - question: "스레드 풀의 작업 큐가 가득 찼을 때, 요청을 버리지 않고 호출한 스레드(Main Thread 등)가 직접 작업을 실행하게 하여 자연스럽게 부하를 조절(Backpressure)하는 거부 정책은?"
    options:
      - "AbortPolicy"
      - "CallerRunsPolicy"
      - "DiscardPolicy"
      - "DiscardOldestPolicy"
    answer: 1
    explanation: "`CallerRunsPolicy`는 작업을 제출한 스레드가 직접 실행하게 만듦으로써, 작업 제출 속도를 늦추는 효과(Throttle)를 줍니다."

  - question: "`shutdown()`과 `shutdownNow()`의 차이점은?"
    options:
      - "차이가 없다."
      - "`shutdown()`은 이미 제출된 작업은 끝까지 실행하고 종료하지만, `shutdownNow()`는 실행 중인 스레드에 인터럽트(Interrupt)를 걸어 강제 종료를 시도하고 대기 중인 작업 목록을 반환한다."
      - "`shutdown()`이 더 강력하게 즉시 종료한다."
      - "`shutdownNow()`는 JVM을 종료한다."
    answer: 1
    explanation: "우아한 종료(Graceful Shutdown)를 위해서는 `shutdown()`을 먼저 호출하고, 일정 시간(`awaitTermination`) 기다린 후 안 되면 `shutdownNow()`를 호출하는 패턴을 명시합니다."

  - question: "`LinkedBlockingQueue`를 사용할 때 생성자에서 용량(Capacity)을 지정하지 않으면 발생하는 문제는?"
    options:
      - "큐의 크기가 0이 된다."
      - "큐의 크기가 `Integer.MAX_VALUE`가 되어, 작업이 계속 쌓이면 메모리 부족(OOM)으로 앱이 죽을 수 있다."
      - "성능이 가장 빠르다."
      - "동시성 오류가 발생한다."
    answer: 1
    explanation: "무제한 큐는 소비(Consumer) 속도가 생산(Producer) 속도를 따라가지 못할 때 작업이 무한정 쌓이는 '메모리 폭탄'이 될 수 있습니다."
---

## 이 글에서 얻는 것

- **ThreadPoolExecutor의 핵심 파라미터**를 이해합니다
- **적정 스레드 수**를 계산하는 방법을 알아봅니다
- **거부 정책**과 **큐 전략**을 선택합니다

---

## ThreadPoolExecutor 파라미터

### 핵심 구성

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    4,                    // corePoolSize
    8,                    // maximumPoolSize  
    60L, TimeUnit.SECONDS, // keepAliveTime
    new LinkedBlockingQueue<>(100),  // workQueue
    new ThreadPoolExecutor.CallerRunsPolicy()  // rejectedHandler
);
```

```mermaid
flowchart TB
    subgraph "Thread Pool 동작"
        Task[작업 도착]
        
        Task --> C1{core 여유?}
        C1 -->|Yes| Core["Core Thread 실행"]
        C1 -->|No| C2{큐 여유?}
        C2 -->|Yes| Queue["Queue 대기"]
        C2 -->|No| C3{max 여유?}
        C3 -->|Yes| Max["추가 Thread 생성"]
        C3 -->|No| Reject["거부 정책 실행"]
    end
```

### 파라미터 설명

| 파라미터 | 설명 | 권장값 |
|---------|------|-------|
| corePoolSize | 기본 스레드 수 | CPU 바운드: CPU 수 |
| maximumPoolSize | 최대 스레드 수 | I/O 바운드: 더 많이 |
| keepAliveTime | 유휴 스레드 생존 시간 | 60초 |
| workQueue | 대기 큐 | 유한 큐 권장 |

---

## 적정 스레드 수 계산

### CPU 바운드 작업

```java
// 순수 계산 작업 (암호화, 압축, 연산)
int threads = Runtime.getRuntime().availableProcessors();

// 또는 좀 더 여유있게
int threads = Runtime.getRuntime().availableProcessors() + 1;
```

### I/O 바운드 작업

```java
// DB 쿼리, 외부 API 호출, 파일 I/O
// 공식: threads = CPU * (1 + 대기시간/계산시간)

// 예: CPU 4개, 대기 200ms, 계산 50ms
// threads = 4 * (1 + 200/50) = 4 * 5 = 20

int cpuCount = Runtime.getRuntime().availableProcessors();
double targetUtilization = 0.8;  // 80% 활용
double waitTime = 200;   // ms
double computeTime = 50; // ms

int threads = (int) (cpuCount * targetUtilization * (1 + waitTime / computeTime));
```

### Spring 비동기 설정

```java
@Configuration
@EnableAsync
public class AsyncConfig {
    
    @Bean
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        
        int cpuCount = Runtime.getRuntime().availableProcessors();
        
        executor.setCorePoolSize(cpuCount * 2);
        executor.setMaxPoolSize(cpuCount * 4);
        executor.setQueueCapacity(500);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new CallerRunsPolicy());
        executor.initialize();
        
        return executor;
    }
}
```

---

## 큐 전략

### 큐 종류

| 큐 | 특성 | 사용 시점 |
|---|------|---------|
| `SynchronousQueue` | 버퍼 없음 | 즉시 처리 필요 |
| `LinkedBlockingQueue` | 무제한 가능 | 일반적 사용 |
| `ArrayBlockingQueue` | 유한, 공정 옵션 | 메모리 제한 |
| `PriorityBlockingQueue` | 우선순위 | 중요도 기반 |

### 유한 큐 권장

```java
// ❌ 무한 큐 - 메모리 폭발 위험
new LinkedBlockingQueue<>();  // 기본값: Integer.MAX_VALUE

// ✅ 유한 큐
new LinkedBlockingQueue<>(1000);

// ✅ 또는 SynchronousQueue (버퍼 없음)
new SynchronousQueue<>();
```

---

## 거부 정책

### 내장 정책

```java
// 1. AbortPolicy (기본) - 예외 발생
new ThreadPoolExecutor.AbortPolicy();
// RejectedExecutionException 발생

// 2. CallerRunsPolicy - 호출자 스레드에서 실행
new ThreadPoolExecutor.CallerRunsPolicy();
// 백프레셔 효과 (속도 조절)

// 3. DiscardPolicy - 조용히 버림
new ThreadPoolExecutor.DiscardPolicy();

// 4. DiscardOldestPolicy - 가장 오래된 작업 버림
new ThreadPoolExecutor.DiscardOldestPolicy();
```

### 커스텀 정책

```java
public class CustomRejectedHandler implements RejectedExecutionHandler {
    
    private final Counter rejectedCounter;
    
    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor executor) {
        // 메트릭 기록
        rejectedCounter.increment();
        
        // 로깅
        log.warn("Task rejected: {}, queue size: {}", 
            r.getClass().getSimpleName(), 
            executor.getQueue().size());
        
        // 대안 처리 (예: 폴백 큐)
        fallbackQueue.offer(r);
    }
}
```

---

## 모니터링

### 핵심 메트릭

```java
@Scheduled(fixedRate = 10000)
public void monitorThreadPool() {
    ThreadPoolExecutor executor = (ThreadPoolExecutor) taskExecutor;
    
    log.info("=== Thread Pool Status ===");
    log.info("Pool Size: {}", executor.getPoolSize());
    log.info("Active Threads: {}", executor.getActiveCount());
    log.info("Queue Size: {}", executor.getQueue().size());
    log.info("Completed Tasks: {}", executor.getCompletedTaskCount());
    
    // 경고: 큐가 차기 시작하면
    if (executor.getQueue().size() > executor.getQueue().remainingCapacity() * 0.8) {
        log.warn("Queue is 80% full!");
    }
}
```

### Micrometer 연동

```java
@Bean
public ThreadPoolTaskExecutor taskExecutorWithMetrics(MeterRegistry registry) {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    // ... 설정
    
    // Metrics 바인딩
    new ExecutorServiceMetrics(
        executor.getThreadPoolExecutor(),
        "async-pool",
        Tags.empty()
    ).bindTo(registry);
    
    return executor;
}
```

---

## Spring Boot 스레드 풀

### Tomcat 스레드 풀

```yaml
server:
  tomcat:
    threads:
      max: 200      # 최대 스레드
      min-spare: 10 # 최소 유휴 스레드
    accept-count: 100  # 큐 크기
    max-connections: 8192
```

### @Async 스레드 풀

```yaml
spring:
  task:
    execution:
      pool:
        core-size: 8
        max-size: 16
        queue-capacity: 100
      thread-name-prefix: async-
```

---

## 요약

### 스레드 풀 설정 가이드

| 작업 유형 | Core | Max | Queue |
|---------|------|-----|-------|
| CPU 바운드 | CPU + 1 | CPU + 1 | 작게 |
| I/O 바운드 | CPU * 2 | CPU * 4 | 적절히 |
| 혼합 | 상황별 | 상황별 | 유한 |

### 핵심 원칙

1. **유한 큐 사용**: 메모리 보호
2. **적절한 거부 정책**: CallerRunsPolicy 권장
3. **모니터링 필수**: 큐 크기, 활성 스레드
4. **부하 테스트**: 실제 환경에서 검증

---

## 🔗 Related Deep Dive

- **[Java 동시성 기초](/learning/deep-dive/deep-dive-java-concurrency-basics/)**: Thread, synchronized.
- **[동시성 컬렉션](/learning/deep-dive/deep-dive-concurrent-collections/)**: BlockingQueue 상세.
