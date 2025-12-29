---
title: "분산 락(Distributed Lock): 동시성 이슈 종결자"
date: 2025-11-29
draft: false
topic: "Database"
tags: ["Distributed Lock", "Redis", "Redisson", "Concurrency"]
categories: ["Backend Deep Dive"]
description: "서버가 여러 대일 때 synchronized는 무용지물입니다. Redis와 Redisson을 활용한 안전한 락 구현"
module: "distributed-system"
quizzes:
  - question: "Java의 `synchronized` 키워드가 분산 환경에서 동작하지 않는 이유는?"
    options:
      - "Java 버전이 낮아서"
      - "synchronized는 단일 JVM(프로세스) 내에서만 유효하고, 여러 서버(JVM)는 서로의 락을 볼 수 없기 때문"
      - "데이터베이스와 연동되지 않아서"
      - "너무 느려서"
    answer: 1
    explanation: "synchronized는 하나의 JVM 메모리 내에서 스레드 간 동기화를 합니다. 서버가 2대 이상이면 각각 다른 JVM이므로 락이 공유되지 않아 Race Condition이 발생합니다."

  - question: "Redis SETNX 기반 분산 락(Spin Lock)의 가장 큰 단점은?"
    options:
      - "구현이 너무 복잡하다."
      - "락을 얻을 때까지 계속 Redis에 요청(Polling)하여 부하가 발생하고, 서버가 죽으면 락이 영원히 안 풀릴 수 있다."
      - "Redis가 느리다."
      - "보안에 취약하다."
    answer: 1
    explanation: "Spin Lock은 무한 루프로 락 상태를 확인하여 Redis 부하가 커집니다. 또한 락을 잡은 서버가 죽으면 DEL이 호출되지 않아 Deadlock이 발생합니다. TTL 설정이 필수입니다."

  - question: "Redisson이 Spin Lock 문제를 해결하는 방식은?"
    options:
      - "더 빠른 폴링"
      - "Pub/Sub 방식으로 '락이 풀리면 알려줘'라고 구독하고 대기하여, 무한 루프 없이 알림을 받는다."
      - "락을 사용하지 않는다."
      - "데이터베이스 락을 사용한다."
    answer: 1
    explanation: "Redisson은 락 해제 시 PUBLISH로 대기 중인 클라이언트에게 알립니다. 클라이언트는 SUBSCRIBE로 대기하므로 Redis에 계속 요청을 보내지 않아 부하가 줄어듭니다."

  - question: "Optimistic Lock과 Pessimistic Lock의 사용 시점으로 올바른 것은?"
    options:
      - "둘 다 동일한 상황에 사용한다."
      - "충돌이 드물면 Optimistic Lock(@Version), 충돌이 잦고 데이터 무결성이 중요하면 Pessimistic Lock(SELECT FOR UPDATE)"
      - "Optimistic Lock이 항상 더 빠르다."
      - "Pessimistic Lock은 분산 환경에서 사용할 수 없다."
    answer: 1
    explanation: "Optimistic Lock은 충돌 시 재시도하므로 충돌이 잦으면 비용이 커집니다. Pessimistic Lock은 미리 락을 걸어 안전하지만 성능 저하와 데드락 위험이 있습니다."

  - question: "Redisson `tryLock(waitTime, leaseTime, TimeUnit)`에서 leaseTime의 역할은?"
    options:
      - "락 대기 시간"
      - "락 점유 시간(이 시간이 지나면 락이 자동으로 해제되어 Deadlock 방지)"
      - "Redis 연결 타임아웃"
      - "재시도 간격"
    answer: 1
    explanation: "leaseTime은 락을 잡은 후 최대 점유 시간입니다. 이 시간이 지나면 락이 자동 해제되어, 서버가 죽거나 처리가 길어져도 영원히 락이 걸려있는 상황을 방지합니다."
study_order: 400
---

## 🔐 1. 왜 `synchronized`로 안 되나요?

Java의 `synchronized`는 **하나의 프로세스(JVM)** 안에서만 유효합니다.
서버가 2대 이상일 때, 서로 다른 JVM은 서로의 락을 볼 수 없습니다.

```mermaid
graph TD
    User((User Requests)) --> LB[Load Balancer]
    LB --> ServerA[Server A]
    LB --> ServerB[Server B]
    
    subgraph JVM_A [JVM A: synchronized]
    ServerA --> LockA{Local Lock A}
    LockA --> DB_A[(Database)]
    end
    
    subgraph JVM_B [JVM B: synchronized]
    ServerB --> LockB{Local Lock B}
    LockB --> DB_A
    end
    
    style LockA fill:#ffcdd2
    style LockB fill:#ffcdd2
    style DB_A fill:#e1bee7
    
    NoteA[동시에 접근 가능! 💥] --- DB_A
```

결과적으로 DB 업데이트가 덮어씌워지는 **Race Condition**이 발생합니다.

---

## 🧩 2. Redis로 락 구현하기 (Spin Lock)

모든 서버가 공유하는 **Redis**를 이용해 "나 지금 작업 중이야"라고 깃발을 꽂습니다.

```mermaid
sequenceDiagram
    participant S1 as Server A
    participant S2 as Server B
    participant R as Redis
    
    S1->>R: SETNX lock:coupon (깃발 꽂기)
    R-->>S1: OK (성공)
    S1->>S1: 쿠폰 발급 로직 실행
    
    S2->>R: SETNX lock:coupon
    R-->>S2: Fail (이미 있음)
    S2->>S2: sleep(100ms) 후 재시도 (Spin Lock)
    
    S1->>R: DEL lock:coupon (완료 후 삭제)
```

### 문제점
1. **Spin Lock**: 락을 얻을 때까지 계속 Redis에 물어봐야 해서(Polling) 부하가 심합니다.
2. **Timeout**: 락을 잡은 서버가 죽으면? 영원히 락이 안 풀립니다(Deadlock). -> **TTL** 필수!

---

## 🚀 3. Redisson: 우아한 해결책

Redisson은 **Pub/Sub** 방식을 써서 Spin Lock의 무한 루프 부하를 해결했습니다.

```mermaid
sequenceDiagram
    participant ClientA
    participant ClientB
    participant Redis_Channel
    
    ClientA->>Redis_Channel: 1. 락 획득 (Job 시작)
    
    ClientB->>Redis_Channel: 2. 락 요청 -> 실패
    ClientB->>Redis_Channel: 3. SUBSCRIBE (락 해제 알림 구독)
    ClientB-->>ClientB: 대기 (Sleep X, Event Wait)
    
    ClientA->>Redis_Channel: 4. 락 해제 & PUBLISH (끝났어!)
    Redis_Channel->>ClientB: 5. 알림 도착
    ClientB->>Redis_Channel: 6. 락 획득 시도
```

"락 풀리면 알려줘!"라고 구독하고 대기하는 방식입니다.

```java
RLock lock = redissonClient.getLock("coupon:1234");

try {
    // waitTime: 락 대기 시간 (5초)
    // leaseTime: 락 점유 시간 (10초 지나면 강제 해제)
    boolean available = lock.tryLock(5, 10, TimeUnit.SECONDS);
    
    if (!available) {
        throw new RuntimeException("락 획득 실패");
    }
    
    // 비즈니스 로직
    issueCoupon();
    
} finally {
    lock.unlock(); // 꼭 해제!
}
```

### 동시성 제어 3단계 전략 비교

| 전략 | 메커니즘 | 장점 | 단점 | 추천 상황 |
| :--- | :--- | :--- | :--- | :--- |
| **Optimistic Lock** | Application (`@Version`) | DB 락을 안 걺 (빠름) | 충돌 많으면 재시도 비용 급증 | 충돌이 드문 경우 |
| **Pessimistic Lock** | DB (`SELECT FOR UPDATE`) | 데이터 무결성 확실 | 데드락 위험, 성능 저하 | 충돌이 잦고 데이터가 중요할 때 |
| **Distributed Lock** | Redis / Zookeeper | DB 부하 분산, 여러 자원 제어 | 구현 복잡도 증가, Redis 의존성 | 분산 환경, 외부 API 제어 |

> [!TIP]
> **선택 기준**:
> - **재고 차감**: Pessimistic Lock (가장 안전)
> - **조회수 증가**: Optimistic Lock (충돌나도 재시도하거나 무시)
> - **선착순 쿠폰**: Distributed Lock (Redis 성능 활용)

## 요약

1. **분산 환경**: 서버가 다르면 `synchronized` 못 쓴다.
2. **Redis**: 빠르고 간편해서 분산 락 저장소로 딱이다.
3. **Redisson**: 직접 `SETNX` 짜지 말고 라이브러리 써라. (Pub/Sub, 타임아웃 자동 연장 등 기능 강력)
