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
quizzes:
  - question: "Spring MVC(Thread per Request)와 WebFlux(Event Loop)의 핵심 차이는?"
    options:
      - "둘 다 동일하다."
      - "MVC는 요청당 스레드를 할당하여 I/O 시 블로킹, WebFlux는 소수의 스레드(Event Loop)로 논블로킹 처리"
      - "WebFlux가 더 느리다."
      - "MVC가 더 적은 스레드를 사용한다."
    answer: 1
    explanation: "MVC는 DB 대기 시 스레드가 잠들어 스레드 풀 고갈 가능. WebFlux는 Node.js처럼 적은 스레드로 수만 연결을 처리합니다."

  - question: "Mono와 Flux의 차이는?"
    options:
      - "둘 다 동일하다."
      - "Mono: 0~1개 데이터(Optional의 비동기 버전), Flux: 0~N개 데이터 흐름(List+Stream의 비동기 버전)"
      - "Flux가 단일 값이다."
      - "Mono가 여러 값이다."
    answer: 1
    explanation: "사용자 한 명 조회는 Mono<User>, 사용자 목록은 Flux<User>를 반환합니다. 둘 다 subscribe() 전에는 실행되지 않습니다."

  - question: "WebFlux에서 Backpressure(배압)가 중요한 이유는?"
    options:
      - "속도를 높이기 위해"
      - "Consumer가 처리 가능한 속도보다 빠르게 데이터가 들어오면 OOM이 발생할 수 있어, 흐름 제어가 필요"
      - "메모리를 더 쓰기 위해"
      - "필요 없다"
    answer: 1
    explanation: "Producer가 1000 TPS로 보내는데 Consumer가 100 TPS만 처리하면 큐가 쌓입니다. Backpressure로 '천천히 보내라'고 신호를 줍니다."

  - question: "WebFlux가 적합하지 않은 워크로드는?"
    options:
      - "I/O 바운드 작업"
      - "CPU 집약적 연산(이미지 처리, 암호화 등) - Event Loop를 블로킹해 전체 성능 저하"
      - "네트워크 호출이 많은 작업"
      - "DB 조회가 많은 작업"
    answer: 1
    explanation: "Event Loop 스레드가 CPU 연산으로 묶이면 다른 요청도 처리 못합니다. CPU 작업은 별도 스레드 풀로 분리해야 합니다."

  - question: "R2DBC가 WebFlux와 함께 사용되는 이유는?"
    options:
      - "성능이 더 나빠서"
      - "기존 JDBC는 블로킹 I/O라 Event Loop를 막지만, R2DBC는 리액티브/논블로킹 DB 드라이버이기 때문"
      - "JDBC보다 오래됐기 때문"
      - "차이가 없다"
    answer: 1
    explanation: "JDBC는 결과를 기다리며 스레드를 블로킹합니다. WebFlux의 이점을 살리려면 R2DBC 같은 논블로킹 드라이버가 필요합니다."
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
