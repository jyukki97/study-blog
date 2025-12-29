---
title: "Linux I/O 모델 심화: BIO, NIO부터 Epoll, Zero Copy까지"
date: 2025-12-28
draft: false
topic: "OS"
tags: ["Linux", "I/O", "Epoll", "Zero Copy", "NIO"]
categories: ["Backend Deep Dive"]
description: "Blocking vs Non-blocking, Synchronous vs Asynchronous의 정확한 구분과 고성능 서버(Nginx, Node.js, Kafka)의 기반 기술 해부."
module: "advanced-cs"
study_order: 901
quizzes:
  - question: "Blocking I/O와 Non-blocking I/O의 핵심 차이는?"
    options:
      - "둘은 동일하다."
      - "Blocking은 커널이 응답할 때까지 스레드가 잠들고, Non-blocking은 즉시 리턴(EWOULDBLOCK)하여 다른 작업을 할 수 있다."
      - "Non-blocking이 더 느리다."
      - "Blocking이 더 복잡하다."
    answer: 1
    explanation: "Blocking에서는 read() 호출 시 데이터가 올 때까지 스레드가 대기합니다. Non-blocking은 데이터가 없으면 바로 에러를 리턴하여 앱이 다른 작업을 할 수 있습니다."

  - question: "I/O Multiplexing(select/poll/epoll)이 C10K 문제를 해결하는 방식은?"
    options:
      - "스레드를 1만 개 생성한다."
      - "여러 소켓을 감시하다가 '데이터가 온 소켓'만 알려주어, 적은 스레드로 많은 연결을 처리"
      - "네트워크 속도를 높인다."
      - "메모리를 늘린다."
    answer: 1
    explanation: "1만 연결에 1만 스레드를 쓰면 컨텍스트 스위칭 오버헤드가 큽니다. epoll은 준비된 소켓만 알려주어 적은 스레드로 효율적으로 처리합니다."

  - question: "epoll이 select/poll보다 성능이 좋은 이유는?"
    options:
      - "더 오래되어서"
      - "커널이 준비된 fd만 반환하고, fd 등록이 O(1)이며, 매번 전체 목록을 복사하지 않기 때문"
      - "더 단순해서"
      - "차이가 없다"
    answer: 1
    explanation: "select는 매번 모든 fd를 검사(O(n))하고 1024개 제한이 있습니다. epoll은 callback 방식으로 준비된 fd만 반환하여 O(1)에 가깝게 동작합니다."

  - question: "Zero Copy 기술이 Kafka/Nginx 성능을 높이는 원리는?"
    options:
      - "데이터를 압축해서"
      - "디스크→User Space→Socket 복사 대신, sendfile()로 커널 내에서 직접 전송하여 CPU 복사를 줄임"
      - "더 빠른 디스크를 사용해서"
      - "메모리를 늘려서"
    answer: 1
    explanation: "일반적으로 파일을 전송하면 디스크→커널→유저→커널→네트워크로 여러 번 복사합니다. Zero Copy는 유저 공간을 거치지 않아 복사 횟수가 줄어듭니다."

  - question: "Node.js가 단일 스레드로 고성능을 달성하는 I/O 모델은?"
    options:
      - "Blocking I/O"
      - "libuv를 이용한 Asynchronous I/O (이벤트 루프 + 논블로킹)"
      - "멀티 스레드"
      - "Polling"
    answer: 1
    explanation: "Node.js는 이벤트 루프가 I/O 완료 이벤트를 받아 콜백을 실행합니다. I/O 중에 블로킹되지 않으므로 적은 리소스로 많은 요청을 처리합니다."
---

## 이 글에서 얻는 것

- **Blocking vs Non-blocking**과 **Sync vs Async**를 명확히 구분합니다.
- **I/O Multiplexing (select, poll, epoll)**의 진화 과정을 이해합니다.
- **Zero Copy** 기술이 Kafka나 Nginx의 성능을 어떻게 극대화하는지 배웁니다.

## 1) I/O 모델의 4가지 분류

IBM의 분류에 따르면, I/O는 크게 두 가지 축으로 나뉩니다.

1.  **Blocking 여부**: 커널이 응답할 때까지 기다리는가?
2.  **Synchronous 여부**: 애플리케이션이 직접 결과를 확인하는가?

```mermaid
quadrantChart
    title I/O Models Matrix
    x-axis Synchronous --> Asynchronous
    y-axis Non-blocking --> Blocking
    quadrant-1 AIO (Async Blocking - X)
    quadrant-2 BIO (Blocking I/O)
    quadrant-3 NIO (Non-blocking I/O)
    quadrant-4 AIO (Asynchronous I/O)
    
    "Java IO (InputStream)" : [0.2, 0.8]
    "Polling (wait)" : [0.2, 0.3]
    "Epoll / Kqueue" : [0.5, 0.5]
    "Windows IOCP / Linux io_uring" : [0.8, 0.2]
```

- **BIO (Blocking Sync)**: `read()` 호출 시 데이터가 올 때까지 스레드가 잠듭니다. (전통적인 Java Socket)
- **NIO (Non-blocking Sync)**: `read()` 호출 시 데이터가 없으면 즉시 에러(EWOULDBLOCK)를 리턴합니다. 앱은 계속 물어봐야 합니다(Polling).
- **I/O Multiplexing (Epoll)**: 여러 소켓을 감시하다가, "데이터가 온 소켓"만 알려줍니다. (Nginx, Netty, Redis의 핵심)
- **AIO (Asynchronous)**: "다 읽으면 콜백해줘"라고 맡기고 다른 일을 합니다. (Node.js의 libuv, Windows IOCP)

## 2) I/O Multiplexing: Select vs Poll vs Epoll

C10K 문제(동시 접속자 1만 명)를 해결하기 위해 진화해왔습니다.

### Select / Poll의 한계
- 관리하는 소켓 리스트(File Descriptor Set)를 매번 커널(Kernel)에 **복사**해서 넘김. (O(N) 비용)
- 커널은 모든 소켓을 순회하며 상태를 체크해야 함.

### Epoll (Linux) / Kqueue (BSD, macOS)
- **이벤트 기반**: 커널 내부에 상태를 저장해두고, **"변화가 생긴 소켓"**만 리턴합니다. (O(1)에 가까움)
- **Level Trigger vs Edge Trigger**: 상태 유지 방식의 차이. (보통 Edge Trigger가 더 고성능)

```mermaid
flowchart LR
    App[Application]
    Kernel[Kernel Space]
    
    subgraph Select 방식
    App --"FD List 전체 복사 (Heavy)"--> Kernel
    Kernel --"전체 순회 검사 (Slow)"--> Kernel
    end
    
    subgraph Epoll 방식
    App --"epoll_wait()"--> Kernel
    Kernel --"이벤트 발생한 FD만 리턴 (Fast)"--> App
    end
```

## 3) Zero Copy (sendfile)

파일 서버나 Kafka처럼 "디스크에서 읽어서 네트워크로 보내는" 작업에 필수적입니다.

### Traditional Data Transfer
1.  Disk -> Kernel Buffer (DMA)
2.  Kernel Buffer -> User Buffer (CPU Copy) 🐢
3.  User Buffer -> Socket Buffer (CPU Copy) 🐢
4.  Socket Buffer -> NIC (DMA)

총 **4번의 복사**와 **4번의 Context Switching**이 발생합니다.

### Zero Copy (sendfile)
1.  Disk -> Kernel Buffer (DMA)
2.  Kernel Buffer -> NIC (DMA, Descriptor만 복사) 🚀

USER 영역을 거치지 않고, 커널 안에서 바로 데이터를 쏘아 보냅니다.
**CPU Copy가 0번**이기에 "Zero Copy"라고 부릅니다.

```mermaid
sequenceDiagram
    participant Disk
    participant KernelBuf as Kernel Buffer
    participant UserBuf as User Buffer
    participant SocketBuf as Socket Buffer
    participant NIC
    
    Note over Disk, NIC: Traditional Copy
    Disk->>KernelBuf: DMA Copy
    KernelBuf->>UserBuf: CPU Copy (Expensive)
    UserBuf->>SocketBuf: CPU Copy (Expensive)
    SocketBuf->>NIC: DMA Copy
    
    Note over Disk, NIC: Zero Copy (sendfile)
    Disk->>KernelBuf: DMA Copy
    KernelBuf->>NIC: SG-DMA Copy (Descriptor only)
```

## 요약

- **Epoll**은 수만 개의 연결을 효율적으로 관리하기 위한 Linux의 핵심 무기입니다. (vs Select/Poll)
- **Zero Copy**는 OS 차원에서 불필요한 데이터 복사를 없애 성능을 극대화합니다.
- 고성능 서버(Nginx, Kafka, Redis)는 모두 **Epoll + Non-blocking I/O** 기반입니다.

## 다음 단계

- **네트워크 심화**: `/learning/deep-dive/deep-dive-network-tcp-performance/` (TCP 혼잡 제어, Flow Control)
