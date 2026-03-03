---
title: "Java Concurrent Collections: 스레드 안전 컬렉션 완벽 가이드"
study_order: 45
date: 2025-12-28
topic: "Java"
topic_icon: "☕"
topic_description: "ConcurrentHashMap, CopyOnWriteArrayList, BlockingQueue 원리와 활용"
tags: ["Java", "Concurrency", "Collections", "Thread Safety"]
categories: ["Foundation"]
draft: false
description: "ConcurrentHashMap 등 Java 동시성 컬렉션의 내부 구조와 사용 시나리오 가이드"
module: "foundation"
quizzes:
  - question: "`ConcurrentHashMap` (Java 8+)이 `Collections.synchronizedMap`이나 `Hashtable`보다 멀티스레드 환경에서 성능이 월등히 좋은 주된 이유는?"
    options:
      - "락을 아예 사용하지 않기 때문이다."
      - "모든 데이터에 대해 하나의 거대한 락(Global Lock)을 거는 대신, 각 버킷(Node/TreeBin) 단위로 쪼개진 락(Fine-grained Locking)과 CAS 연산을 사용하여 경합을 최소화하기 때문이다."
      - "데이터를 메모리가 아닌 디스크에 저장하기 때문이다."
      - "읽기 작업에 대해서도 항상 락을 걸기 때문이다."
    answer: 1
    explanation: "전통적인 동기화 맵은 맵 전체에 락을 걸어 병목이 심하지만, ConcurrentHashMap은 버킷(슬롯) 별로 락을 분산시키고 읽기에는 락을 걸지 않아 동시성을 극대화합니다."

  - question: "`CopyOnWriteArrayList`가 가장 적합한 사용처는?"
    options:
      - "데이터가 1초에도 수백 번씩 변경되는 실시간 주식 시세 처리"
      - "데이터 변경(Write)은 매우 드물지만, 다수의 스레드가 빈번하게 조회(Read)하는 이벤트 리스너 목록이나 설정 정보"
      - "메모리가 매우 부족한 환경"
      - "단일 스레드 환경"
    answer: 1
    explanation: "쓰기 작업 시마다 배열 전체를 복사하는 비용이 들기 때문에, 변경이 잦으면 성능이 매우 떨어집니다. 대신 읽기 작업은 락 없이 고속으로 수행됩니다."

  - question: "생산자-소비자(Producer-Consumer) 패턴을 구현할 때, 큐가 꽉 차면 생산자가 대기하고 비어있으면 소비자가 대기하는 기능을 가장 쉽게 구현할 수 있는 컬렉션은?"
    options:
      - "ArrayList"
      - "BlockingQueue (예: LinkedBlockingQueue)"
      - "HashSet"
      - "TreeMap"
    answer: 1
    explanation: "`BlockingQueue`의 `put()`과 `take()` 메서드는 각각 큐가 가득 차거나 비었을 때 스레드를 자동으로 대기(Block) 상태로 만들어주어 복잡한 동기화 코드를 줄여줍니다."

  - question: "`ConcurrentHashMap`을 사용할 때 올바른 원자적(Atomic) 연산 패턴은?"
    options:
      - "`if (!map.containsKey(key)) { map.put(key, val); }`"
      - "`map.computeIfAbsent(key, k -> val);`"
      - "`map.get(key);` 호출 후 null이면 `put`"
      - "synchronized(map) { ... }"
    answer: 1
    explanation: "`containsKey`와 `put`을 따로 호출하면 그 사이에 다른 스레드가 개입할 수 있습니다(Check-then-Act 문제). `computeIfAbsent`, `putIfAbsent`, `merge` 등을 사용해야 원자성이 보장됩니다."

  - question: "`BlockingQueue`의 구현체 중, 내부 버퍼(저장 공간)가 전혀 없어(크기 0) 생산자가 데이터를 넣으려 하면 소비자가 가져갈 때까지 반드시 대기(Hand-off)해야 하는 큐는?"
    options:
      - "ArrayBlockingQueue"
      - "LinkedBlockingQueue"
      - "SynchronousQueue"
      - "PriorityBlockingQueue"
    answer: 2
    explanation: "`SynchronousQueue`는 데이터를 저장하지 않고 스레드 간에 데이터를 직접 건네주는 랑데부(Rendezvous) 채널 역할을 합니다."
---

## 이 글에서 얻는 것

- **동기화 컬렉션 vs 동시성 컬렉션**의 차이를 이해합니다
- **ConcurrentHashMap**의 내부 동작과 성능 특성을 알아봅니다
- **BlockingQueue**로 생산자-소비자 패턴을 구현합니다

---

## 왜 동시성 컬렉션인가?

### 문제: 동기화 컬렉션의 한계

```java
// ❌ 동기화 컬렉션 - 전체 락
Map<String, Integer> syncMap = Collections.synchronizedMap(new HashMap<>());

// 모든 연산에 전체 락 →  심각한 병목
syncMap.put("key1", 1);  // 전체 맵 락
syncMap.get("key1");     // 전체 맵 락
```

```mermaid
flowchart LR
    subgraph "synchronizedMap"
        Lock["🔒 단일 락"]
        T1[Thread 1] -->|대기| Lock
        T2[Thread 2] -->|대기| Lock
        T3[Thread 3] -->|대기| Lock
    end
    
    style Lock fill:#ffebee,stroke:#c62828
```

### 해결: 동시성 컬렉션

```mermaid
flowchart LR
    subgraph "ConcurrentHashMap"
        S1["Segment 1 🔒"]
        S2["Segment 2 🔒"]
        S3["Segment 3 🔒"]
        
        T1[Thread 1] --> S1
        T2[Thread 2] --> S2
        T3[Thread 3] --> S3
    end
    
    style S1 fill:#e8f5e9,stroke:#2e7d32
    style S2 fill:#e8f5e9,stroke:#2e7d32
    style S3 fill:#e8f5e9,stroke:#2e7d32
```

**세분화된 락(Fine-grained locking)**으로 동시 접근 허용

---

## ConcurrentHashMap

### 내부 구조 (Java 8+)

```mermaid
flowchart TB
    CHM[ConcurrentHashMap]
    
    subgraph "Node Array"
        B0["Bucket 0\n(Node)"]
        B1["Bucket 1\n(TreeBin)"]
        B2["Bucket 2\n(null)"]
        B3["Bucket 3\n(Node)"]
    end
    
    CHM --> B0
    CHM --> B1
    CHM --> B2
    CHM --> B3
    
    B0 --> N1[Node] --> N2[Node]
    B1 --> T1["TreeNode\n(Red-Black)"]
```

**특징**:
- **버킷별 락**: 각 버킷에 독립적 락
- **CAS 연산**: 락 없이 원자적 업데이트
- **TreeBin 변환**: 충돌이 많으면 LinkedList → Red-Black Tree

### 주요 연산

```java
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();

// 기본 연산 (스레드 안전)
map.put("key1", 1);
map.get("key1");
map.remove("key1");

// 원자적 복합 연산 ⭐
map.putIfAbsent("key", 100);           // 없으면 추가
map.computeIfAbsent("key", k -> 100);  // 없으면 계산 후 추가
map.computeIfPresent("key", (k, v) -> v + 1);  // 있으면 업데이트
map.merge("key", 1, Integer::sum);     // 있으면 합계, 없으면 추가

// ⚠️ 주의: 아래는 원자적이지 않음!
if (!map.containsKey("key")) {  // check
    map.put("key", value);      // then act → 경쟁 조건!
}

// ✅ 올바른 방법
map.computeIfAbsent("key", k -> expensiveComputation());
```

### 성능 비교

| 연산 | HashMap | synchronizedMap | ConcurrentHashMap |
|------|---------|-----------------|-------------------|
| 단일 스레드 | 매우 빠름 | 느림 (락 오버헤드) | 빠름 |
| 다중 스레드 읽기 | N/A (안전하지 않음) | 느림 (경합) | 매우 빠름 |
| 다중 스레드 쓰기 | N/A | 매우 느림 | 빠름 |

### 실무 활용: 캐시 구현

```java
public class SimpleCache<K, V> {
    private final ConcurrentHashMap<K, V> cache = new ConcurrentHashMap<>();
    private final Function<K, V> loader;
    
    public SimpleCache(Function<K, V> loader) {
        this.loader = loader;
    }
    
    public V get(K key) {
        // 원자적으로 캐시 로드
        return cache.computeIfAbsent(key, loader);
    }
    
    public void invalidate(K key) {
        cache.remove(key);
    }
    
    public void invalidateAll() {
        cache.clear();
    }
}
```

---

## CopyOnWrite 컬렉션

### 개념

```mermaid
flowchart TB
    subgraph "CopyOnWriteArrayList"
        Original["원본 배열\n[A, B, C]"]
        
        Read1[읽기 1] --> Original
        Read2[읽기 2] --> Original
        
        Write["쓰기: D 추가"]
        Write --> Copy["복사본 생성\n[A, B, C, D]"]
        Copy --> Replace["원본 교체"]
    end
```

**동작 원리**:
- **읽기**: 락 없이 현재 배열 참조
- **쓰기**: 전체 배열 복사 → 수정 → 교체

### 사용 사례

```java
// ✅ 읽기가 대부분, 쓰기가 드문 경우
CopyOnWriteArrayList<EventListener> listeners = new CopyOnWriteArrayList<>();

// 읽기: 락 없이 안전한 순회
for (EventListener listener : listeners) {
    listener.onEvent(event);  // ConcurrentModificationException 없음
}

// 쓰기: 전체 복사 (비용 높음)
listeners.add(newListener);

// ✅ 적합한 경우
// - 이벤트 리스너 관리
// - 설정(Configuration) 목록
// - 화이트리스트/블랙리스트

// ❌ 부적합한 경우
// - 자주 변경되는 데이터
// - 대용량 데이터
```

### CopyOnWriteArraySet

```java
// 중복 없는 CopyOnWrite Set
CopyOnWriteArraySet<String> allowedIps = new CopyOnWriteArraySet<>();

allowedIps.add("192.168.1.1");
allowedIps.add("192.168.1.2");

// 읽기 (락 없음)
if (allowedIps.contains(clientIp)) {
    // 허용
}
```

---

## BlockingQueue

### 생산자-소비자 패턴

```mermaid
flowchart LR
    subgraph Producers
        P1[Producer 1]
        P2[Producer 2]
    end
    
    subgraph "BlockingQueue"
        Q["[Task1, Task2, Task3]"]
    end
    
    subgraph Consumers
        C1[Consumer 1]
        C2[Consumer 2]
    end
    
    P1 -->|put| Q
    P2 -->|put| Q
    Q -->|take| C1
    Q -->|take| C2
```

### 구현체 비교

| 구현체 | 경계 | 특징 |
|--------|------|------|
| `ArrayBlockingQueue` | 유한 | 배열 기반, FIFO |
| `LinkedBlockingQueue` | 유한/무한 | 링크드리스트 기반 |
| `PriorityBlockingQueue` | 무한 | 우선순위 정렬 |
| `SynchronousQueue` | 0 | 직접 전달 (버퍼 없음) |
| `DelayQueue` | 무한 | 지연 후 사용 가능 |

### 사용 예시

```java
// 작업 큐
BlockingQueue<Runnable> workQueue = new LinkedBlockingQueue<>(100);

// 생산자
public void submitTask(Runnable task) throws InterruptedException {
    workQueue.put(task);  // 큐가 가득 차면 블로킹
}

// 소비자 (Worker Thread)
public void processLoop() {
    while (!Thread.currentThread().isInterrupted()) {
        try {
            Runnable task = workQueue.take();  // 비어있으면 블로킹
            task.run();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            break;
        }
    }
}
```

### 주요 메서드

| 메서드 | 블로킹 | 타임아웃 | 예외 발생 |
|--------|--------|---------|----------|
| `put()` | ✅ 대기 | - | - |
| `offer(timeout)` | - | ✅ | - |
| `take()` | ✅ 대기 | - | - |
| `poll(timeout)` | - | ✅ | - |
| `add()` | - | - | ✅ 예외 |

```java
// 타임아웃 있는 offer
boolean success = queue.offer(task, 5, TimeUnit.SECONDS);
if (!success) {
    // 5초 내 삽입 실패 처리
    handleQueueFull();
}

// 타임아웃 있는 poll
Runnable task = queue.poll(1, TimeUnit.SECONDS);
if (task == null) {
    // 1초 내 작업 없음
    handleIdleState();
}
```

---

## 실무 패턴

### ConcurrentHashMap 기반 카운터

```java
public class ConcurrentCounter {
    private final ConcurrentHashMap<String, LongAdder> counters = 
        new ConcurrentHashMap<>();
    
    public void increment(String key) {
        counters.computeIfAbsent(key, k -> new LongAdder()).increment();
    }
    
    public long get(String key) {
        LongAdder adder = counters.get(key);
        return adder != null ? adder.sum() : 0;
    }
}

// 사용
ConcurrentCounter hitCounter = new ConcurrentCounter();
hitCounter.increment("/api/users");
hitCounter.increment("/api/orders");
```

### 스레드 안전 싱글톤 레지스트리

```java
public class ServiceRegistry {
    private static final ConcurrentHashMap<Class<?>, Object> services = 
        new ConcurrentHashMap<>();
    
    @SuppressWarnings("unchecked")
    public static <T> T getService(Class<T> type, Supplier<T> factory) {
        return (T) services.computeIfAbsent(type, t -> factory.get());
    }
}

// 사용
UserService userService = ServiceRegistry.getService(
    UserService.class, 
    UserServiceImpl::new
);
```

---

## 선택 가이드

```mermaid
flowchart TD
    Start[컬렉션 선택] --> Q1{스레드 안전 필요?}
    
    Q1 -->|No| Regular[일반 컬렉션]
    Q1 -->|Yes| Q2{Map/List/Queue?}
    
    Q2 -->|Map| Q3{읽기:쓰기 비율?}
    Q3 -->|읽기 >> 쓰기| CHM[ConcurrentHashMap]
    Q3 -->|쓰기 많음| CHM
    
    Q2 -->|List| Q4{쓰기 빈도?}
    Q4 -->|드물게| COWAL[CopyOnWriteArrayList]
    Q4 -->|자주| Sync["synchronized 또는\nCollections.synchronizedList"]
    
    Q2 -->|Queue| Q5{블로킹 필요?}
    Q5 -->|Yes| BQ[BlockingQueue]
    Q5 -->|No| CQ[ConcurrentLinkedQueue]
    
    style CHM fill:#e8f5e9,stroke:#2e7d32
    style COWAL fill:#e8f5e9,stroke:#2e7d32
    style BQ fill:#e8f5e9,stroke:#2e7d32
```

---

## 요약

### 동시성 컬렉션 체크리스트

| 요구사항 | 추천 |
|---------|------|
| 스레드 안전 Map | ConcurrentHashMap |
| 읽기 위주 List | CopyOnWriteArrayList |
| 생산자-소비자 | BlockingQueue |
| 스레드 안전 Set | ConcurrentSkipListSet |
| 정렬된 Map | ConcurrentSkipListMap |

### 핵심 원칙

1. **synchronized 대신 동시성 컬렉션**: 더 나은 성능
2. **원자적 복합 연산 사용**: `computeIfAbsent`, `merge`
3. **적절한 구현체 선택**: 읽기/쓰기 패턴 고려
4. **블로킹 vs 논블로킹**: 요구사항에 맞게

---

## 🔗 Related Deep Dive

- **Java 동시성 기초** *(준비 중)*: Thread, synchronized, volatile.
- **분산 락** *(준비 중)*: 단일 JVM을 넘어선 동시성 제어.
