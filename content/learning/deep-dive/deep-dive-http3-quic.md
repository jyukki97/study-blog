---
title: "HTTP/3 & QUIC: TCP를 버리고 UDP로 간 이유"
date: 2025-12-28
draft: false
topic: "Modern Tech"
tags: ["Network", "HTTP/3", "QUIC", "UDP", "Performance"]
categories: ["Backend Deep Dive"]
description: "웹의 속도를 제한하던 TCP의 구조적 한계(Head-of-Line Blocking)와 이를 UDP 기반의 QUIC으로 해결한 HTTP/3의 혁신을 다룹니다."
module: "modern-frontiers"
study_order: 1002
quizzes:
  - question: "HTTP/3가 TCP 대신 UDP를 기반으로 하는 QUIC 프로토콜을 사용하는 가장 큰 이유는?"
    options:
      - "UDP가 더 안전해서"
      - "TCP의 Head-of-Line Blocking 문제를 해결하고, 빠른 연결 수립(0-RTT)을 가능하게 하기 위해"
      - "UDP가 더 오래됐기 때문"
      - "서버 비용을 줄이기 위해"
    answer: 1
    explanation: "TCP는 패킷 하나가 손실되면 뒤 패킷도 모두 대기해야 합니다(HOL Blocking). QUIC은 각 스트림이 독립적이라 이 문제를 해결하고, TLS를 내장하여 연결 속도도 빠릅니다."

  - question: "QUIC의 '0-RTT Handshake'가 가능한 이유는?"
    options:
      - "암호화를 하지 않아서"
      - "이전에 방문한 서버의 암호화 정보를 캐시해두고, 재연결 시 첫 패킷부터 데이터를 함께 보내기 때문"
      - "UDP가 빨라서"
      - "서버가 미리 응답을 준비해서"
    answer: 1
    explanation: "TCP+TLS는 여러 번 왕복해야 암호화 연결이 완성되지만, QUIC은 이전 연결의 키 정보를 재사용하여 첫 패킷부터 데이터를 포함할 수 있습니다."

  - question: "QUIC의 Connection Migration이 해결하는 문제는?"
    options:
      - "서버 이전 문제"
      - "모바일에서 WiFi → LTE로 전환 시 IP가 바뀌어도 연결이 끊기지 않게 하는 것"
      - "데이터 압축 문제"
      - "보안 문제"
    answer: 1
    explanation: "TCP는 IP:Port로 연결을 식별하여 IP 변경 시 끊깁니다. QUIC은 Connection ID로 식별하여 IP가 바뀌어도 같은 세션을 유지합니다."

  - question: "HTTP/2의 Multiplexing이 TCP에서는 완벽하지 않은 이유는?"
    options:
      - "HTTP/2가 느려서"
      - "하나의 TCP 연결에서 패킷 하나가 손실되면 그 뒤의 모든 스트림이 블로킹되기 때문"
      - "브라우저가 지원하지 않아서"
      - "서버 문제"
    answer: 1
    explanation: "HTTP/2는 하나의 TCP 연결에 여러 요청을 담지만, TCP 특성상 패킷 손실 시 모든 스트림이 영향받습니다. QUIC은 스트림별로 독립적이라 이 문제가 없습니다."

  - question: "QUIC에서 신뢰성(Reliability)과 암호화(TLS)를 UDP 위에서 구현하는 방식의 장점은?"
    options:
      - "OS 업데이트 없이 애플리케이션 레벨에서 프로토콜을 업그레이드할 수 있다."
      - "더 느려진다."
      - "보안이 약해진다."
      - "장점이 없다."
    answer: 0
    explanation: "TCP 개선은 전 세계 OS를 업데이트해야 하지만, QUIC은 UDP 위의 라이브러리로 구현되어 앱 업데이트만으로 프로토콜 개선을 배포할 수 있습니다."
---

## 🐌 1. TCP는 억울하다 (하지만 느리다)

TCP는 1970년대에 만들어졌습니다. "신뢰성"이 최우선이었죠.
하지만 현대 웹(이미지, CSS, JS 수백 개 로딩) 환경에서는 **구조적 결함**이 드러났습니다.

### Head-of-Line (HOL) Blocking

```mermaid
graph LR
    subgraph TCP Connection
    P1[Packet 1 OK] --> P2[Packet 2 LOSS!] --> P3[Packet 3 OK] --> P4[Packet 4 OK]
    end
    
    Note[Application Layer 대기중... 🚫]
```

- 패킷 2번이 손실되면, **이미 도착한 3, 4번도 줄을 서서 기다려야 합니다.**
- "앞차가 고장 나면 뒷차들도 못 가는" 왕복 1차선 도로와 같습니다.
- HTTP/2는 하나의 TCP 연결에 여러 요청을 구겨 넣었기(Multiplexing) 때문에, 이 문제가 더 심각했습니다.

---

## 🚀 2. QUIC: UDP 위의 혁명

구글은 생각했습니다. *"TCP를 고치려면 전 세계 OS를 다 업데이트해야 하네? 불가능해. 그냥 UDP 위에 새로 만들자!"*
그게 바로 **QUIC (Quick UDP Internet Connections)**입니다.

### 프로토콜 스택 비교

```mermaid
graph BT
    subgraph HTTP/2
    H2[HTTP/2] --> TLS[TLS 1.2/1.3] --> TCP --> IP1[IP]
    end
    
    subgraph HTTP/3
    H3[HTTP/3] --> QUIC[QUIC (Reliability + TLS)] --> UDP --> IP2[IP]
    end
    
    style QUIC fill:#f96
    style UDP fill:#f96
```

### 1) Independent Streams (진정한 멀티플렉싱)
- QUIC은 각각의 요청(Stream)이 **독립적**입니다.
- 이미지 A 패킷이 날아가도, CSS 파일 패킷은 멈추지 않고 처리됩니다.

### 2) 0-RTT Handshake (연결 속도 혁명)
- **TCP+TLS**: 통성명(Syn/Ack)하고 암호키 교환하느라 2~3번 왔다 갔다 합니다.
- **QUIC**: "안녕!" 할 때 암호키 정보와 데이터를 같이 보냅니다. (1-RTT). 한 번 본 사이트는 바로 데이터부터 쏘기도 합니다 (0-RTT).

---

## 📱 3. Connection Migration (모바일 최적화)

와이파이 잡고 유튜브 보다가, 현관문 나가면서 LTE로 바뀌는 순간 영상이 멈칫하죠?
TCP 연결이 끊어지고 다시 맺기 때문입니다.

```mermaid
sequenceDiagram
    participant Phone
    participant Server
    
    Note over Phone: WIFI (IP: 1.1.1.1)
    Phone->>Server: QUIC Packet (Connection ID: A123)
    
    Note over Phone: LTE로 변경 (IP: 2.2.2.2)
    Note over Phone: IP는 바뀌었지만 ID는 그대로!
    
    Phone->>Server: QUIC Packet (Connection ID: A123)
    Server-->>Phone: "어 너구나? 계속 보내."
```

- **TCP**: `IP:Port`로 식별 -> IP 바뀌면 끊김.
- **QUIC**: `Connection ID`로 식별 -> IP 바뀌어도 유지됨.

## 요약

1. **HOL Blocking 제거**: 패킷 하나 잃어버려도 전체가 안 멈춘다.
2. **0-RTT**: 연결 수립이 미친듯이 빠르다.
3. **Connection Migration**: 와이파이 갈아탈 때 안 끊긴다.
4. 이 모든 게 **UDP** 덕분이다. (HTTP/3 = HTTP over QUIC)
