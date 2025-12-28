---
title: "Spring WebFlux와 Reactive Programming: 비동기의 미학"
date: 2025-12-28
draft: false
topic: "Modern Tech"
tags: ["WebFlux", "Reactive", "Reactor", "Netty", "Async"]
categories: ["Backend Deep Dive"]
description: "MVC의 한계를 넘어서는 Event-Loop 기반 아키텍처와 Backpressure 메커니즘."
module: "modern-frontiers"
study_order: 1002
---

## 이 글에서 얻는 것

- **Spring MVC** (Thread per Request)와 **WebFlux** (Event Loop)의 구조적 차이를 이해합니다.
- **Mono**와 **Flux**를 언제 써야 하는지, `subscribe()`가 무엇인지 배웁니다.
- **Backpressure(배압)**가 시스템 안정성에 왜 중요한지 알게 됩니다.

## 1) Thread per Request vs Event Loop

Spring MVC는 요청 하나당 스레드 하나를 할당합니다. DB가 느리면 스레드가 블로킹되어 놉니다.
WebFlux는 **소수의 스레드(Event Loop)**로 모든 요청을 처리합니다 (Node.js와 유사).

```mermaid
flowchart TD
    subgraph MVC [Spring MVC (Blocking)]
        Req1[Request 1] --> T1[Thread 1]
        T1 -->|Wait| DB[Database]
        Req2[Request 2] --> T2[Thread 2]
        T2 -->|Wait| DB
    end

    subgraph WebFlux [WebFlux (Non-blocking)]
        ReqA[Request A] --> Loop[Event Loop]
        ReqB[Request B] --> Loop
        Loop -->|Async Callback| DB_Reactive[R2DBC Driver]
    end

    style MVC fill:#ffebee,stroke:#c62828
    style WebFlux fill:#e3f2fd,stroke:#1565c0
```

- **MVC**: 동시 접속자가 많으면 스레드 풀 고갈(Thread Pool Hell) 발생.
- **WebFlux**: 적은 리소스로 수만 개의 동시 연결 처리 가능 (단, CPU 연산이 많은 작업엔 불리).

## 2) Mono vs Flux (Reactor)

- **Mono<T>**: 0개 또는 1개의 데이터 (`Optional<T>`와 비슷하지만 비동기).
- **Flux<T>**: 0개 또는 N개의 데이터 흐름 (`List<T>` + `Stream`의 비동기 버전).

```java
// 예시: 사용자 조회
public Mono<User> getUser(String id) {
    return userRepository.findById(id);
}

// 예시: 전체 상품 목록 (끝없이 흐를 수도 있음)
public Flux<Product> getAllProducts() {
    return productRepository.findAll();
}
```

**주의**: 리턴했다고 실행되는 게 아닙니다. **`subscribe()`를 해야(수돗물을 틀어야)** 데이터가 흐릅니다. (Lazy Execution)

## 3) Backpressure (배압)

WebFlux의 핵심이자 Reactive Streams의 정수입니다.
**"소비자(Subscriber)가 감당할 수 있는 만큼만 받겠다"**고 생산자(Publisher)에게 알리는 메커니즘입니다.

- 기존(Push 방식): 생산자가 데이터를 막 쏘아 보냄 -> 소비자 버퍼 터짐(OOM).
- 리액티브(Pull 방식): 소비자가 `request(10)` 요청 -> 생산자가 10개만 보냄.

```mermaid
sequenceDiagram
    participant P as Publisher (DB)
    participant S as Subscriber (Client)
    
    S->>P: subscribe()
    P-->>S: Subscription Created
    
    S->>P: request(5) (나 5개만 처리할 수 있어)
    P-->>S: onNext(item 1)
    P-->>S: onNext(item 2)
    ...
    P-->>S: onNext(item 5)
    
    Note right of S: 처리 완료 후
    S->>P: request(5) (또 5개 줘)
```

## 요약

- **WebFlux**는 **Event Loop**로 동작하며 I/O가 많은 서비스에 유리합니다.
- **Mono**는 단일 값, **Flux**는 스트림입니다.
- **Backpressure**는 시스템 전체의 과부하를 막는 안전장치입니다.

## 다음 단계

- **아키텍처 마스터리**: 프레임워크를 넘어 설계의 영역(DDD)으로 갑니다.
