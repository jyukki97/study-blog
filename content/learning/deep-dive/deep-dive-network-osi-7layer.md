---
title: "OSI 7계층과 TCP/IP 이해"
date: 2025-12-29
draft: false
topic: "CS"
tags: ["Network", "OSI 7 Layer", "TCP/IP", "Load Balancer"]
categories: ["Backend Deep Dive"]
description: "백엔드 개발자가 알아야 할 실무 관점의 네트워크 계층 구조 (L4 vs L7 로드밸런서 차이점 포함)"
module: "foundation"
study_order: 15
quizzes:
  - question: "OSI 7계층 중 '전송 계층(Transport Layer, L4)'의 핵심 역할이자 대표적인 프로토콜은?"
    options:
      - "데이터의 경로를 결정한다 (IP, ICMP)"
      - "양 끝단(End-to-End)의 신뢰성 있는 전송을 담당한다 (TCP, UDP)"
      - "물리적인 신호를 전달한다 (Ethernet)"
      - "데이터의 표현 형식을 변환한다 (JPEG, ASCII)"
    answer: 1
    explanation: "L4는 송신자와 수신자 간의 논리적 연결과 신뢰성(TCP) 또는 신속성(UDP)을 담당합니다. 포트 번호도 여기서 다룹니다."

  - question: "흔히 말하는 'L4 로드밸런서'와 'L7 로드밸런서'의 가장 큰 차이점은?"
    options:
      - "L4는 IP/Port 기반이고, L7은 HTTP URL/Header 내용을 볼 수 있다."
      - "L4가 더 비싸고 느리다."
      - "L7은 암호화를 할 수 없다."
      - "L4는 웹 서버 전용이다."
    answer: 0
    explanation: "L4는 패킷의 IP/Port만 보고 분산하지만, L7은 HTTP 요청 내용(URL, 쿠키 등)을 분석해 정교한 라우팅이 가능합니다."

  - question: "TCP 3-way Handshake 과정에서 클라이언트가 서버에 처음 보내는 패킷의 플래그(Flag)는?"
    options:
      - "ACK"
      - "SYN"
      - "FIN"
      - "RST"
    answer: 1
    explanation: "연결을 요청(Synchronize)하기 위해 SYN 패킷을 먼저 보냅니다."

  - question: "사용자가 브라우저 주소창에 'www.naver.com'을 입력했을 때, 가장 먼저 일어나는 일은?"
    options:
      - "서버와 3-way Handshake를 한다."
      - "HTTP GET 요청을 보낸다."
      - "DNS를 통해 도메인의 IP 주소를 조회한다."
      - "SSL 인증서를 검증한다."
    answer: 2
    explanation: "컴퓨터는 도메인 이름을 이해하지 못하므로, 먼저 DNS 서버에 물어봐서 IP 주소를 알아내야 통신을 시작할 수 있습니다."

  - question: "다음 중 HTTP, FTP, SMTP, DNS 프로토콜이 속하는 계층은?"
    options:
      - "물리 계층 (Physical)"
      - "전송 계층 (Transport)"
      - "네트워크 계층 (Network)"
      - "응용 계층 (Application, L7)"
    answer: 3
    explanation: "사용자가 직접 사용하는 프로그램이나 서비스와 가장 가까운 최상위 계층인 응용 계층입니다."

  - question: "TCP 연결 종료 과정(4-way Handshake)에서, 서버가 클라이언트의 연결 종료 요청(FIN)을 받고 나서 '아직 보낼 데이터가 남았을 때' 잠시 대기 상태로 머무르는 단계는?"
    options:
      - "CLOSE_WAIT"
      - "TIME_WAIT"
      - "ESTABLISHED"
      - "SYN_RCVD"
    answer: 0
    explanation: "서버는 FIN을 받으면 ACK를 보내고, 자신의 종료 준비가 끝날 때까지 CLOSE_WAIT 상태로 대기합니다."

  - question: "UDP 프로토콜의 특징으로 올바르지 않은 것은?"
    options:
      - "비연결형 서비스이다."
      - "데이터의 순서를 보장하지 않는다."
      - "3-way Handshake를 통해 연결을 수립한다."
      - "TCP보다 전송 속도가 빠르다."
    answer: 2
    explanation: "UDP는 연결 수립 과정 없이 데이터를 던지기만 하기 때문에 3-way Handshake가 없습니다. 그래서 빠르지만 신뢰성은 낮습니다."

  - question: "IP 주소만으로는 부족해서, 하나의 컴퓨터 안에서 실행 중인 여러 프로세스를 구분하기 위해 사용하는 식별자는?"
    options:
      - "MAC 주소"
      - "Port 번호"
      - "세션 ID"
      - "쿠키"
    answer: 1
    explanation: "IP는 목적지 호스트(컴퓨터)까지 찾아가는 주소이고, Port는 그 컴퓨터 안의 어떤 프로그램이 받을지를 결정합니다."
---

## 이 글에서 얻는 것

- **OSI 7계층**을 단순히 외우는 것이 아니라, "문제가 발생했을 때 어느 계층을 봐야 하는지" 알게 됩니다.
- **L4 vs L7 로드밸런서**의 차이를 통해 아키텍처 설계의 기본을 익힙니다.
- **TCP Handshake**가 왜 필요한지, 연결 비용이 왜 비싼지 실무적으로 이해합니다.

## 0. 왜 계층을 나눴을까?

복잡한 네트워크 통신 과정을 **역할별로 쪼개서** 관리하기 위함입니다.
- 랜선이 끊어지면(1계층 문제), 유튜브 앱(7계층)을 고칠 필요 없이 랜선만 바꾸면 됩니다.
- 이것이 **캡슐화**와 **모듈화**의 전형적인 예시입니다.

## 1. 실무에서 중요한 4가지 계층 (TCP/IP 모델)

OSI 7계층은 이론에 가깝고, 실무에서는 **TCP/IP 4계층** 위주로 사고합니다.

### L7: 응용 계층 (Application)
- **우리가 만드는 코드**: HTTP, JSON, HTML, DNS
- **장비**: L7 로드밸런서 (Nginx, AWS ALB), WAF(웹 방화벽)
- **특징**: "패킷의 내용"을 볼 수 있습니다. (URL `/login`은 A서버로, `/search`는 B서버로)

### L4: 전송 계층 (Transport)
- **연결과 포트**: TCP, UDP, Port
- **장비**: L4 로드밸런서, 방화벽(Port 제어)
- **특징**: 내용(HTTP 헤더 등)은 모르고, **IP와 Port**만 보고 배달합니다. "이 패킷은 8080 포트로 가는구나"

### L3: 네트워크 계층 (Network)
- **주소와 경로**: IP, 라우터
- **특징**: 목적지 컴퓨터를 찾아가는 네비게이션 역할입니다. (서울시 강남구...)

### L2/L1: 데이터 링크/물리 계층
- **랜선과 MAC**: 이더넷, 와이파이, 스위치
- **특징**: 옆 컴퓨터(공유기 등)로 물리적 신호를 전달합니다.

## 2. L4 vs L7 로드밸런서 (면접 단골, 실무 필수)

| 구분 | L4 로드밸런서 (AWS NLB) | L7 로드밸런서 (AWS ALB, Nginx) |
| :--- | :--- | :--- |
| **기준** | IP 주소 + 포트 번호 | URL, HTTP 헤더, 쿠키 |
| **속도** | 빠름 (패킷 내용을 안 까보니까) | L4보다 느림 (내용 분석 비용) |
| **기능** | 단순 부하 분산 | SSL 종료, URL 라우팅, 인증 처리 가능 |
| **용도** | 대규모 트래픽 단순 분산, TCP 베이스 | 마이크로서비스 라우팅, HTTPS 처리 |

**실무 팁:**
- "서비스가 너무 느린데 HTTPS 복호화 비용 때문인가?" -> L7 앞단에 L4를 둬서 부하를 줄이기도 합니다.
- MSA 환경에서는 **L7(Ingress)**가 필수입니다. `/users` 요청과 `/orders` 요청을 찢어줘야 하니까요.

## 3. TCP 3-way Handshake: "연결은 비싸다"

TCP는 **신뢰성**이 생명입니다. "나 보낸다?" "어, 보내!" "오케이 쏜다!" 확인이 필요합니다.

1.  **SYN**: (클라 -> 서버) "접속해도 돼?"
2.  **SYN+ACK**: (서버 -> 클라) "어, 내 말 들려? 너도 준비 됐어?"
3.  **ACK**: (클라 -> 서버) "어 잘 들려. 이제 데이터 보낸다."

**실무 포인트:**
- 이 과정이 0.1초씩 걸린다면, HTTP 요청 하나 보낼 때마다 낭비가 심합니다.
- 그래서 **HTTP Keep-Alive** (연결 재사용)나 **Connection Pool** (미리 연결해둠)을 씁니다.
- "커넥션 맺는 비용"을 줄이는 것이 성능 최적화의 첫걸음입니다.
