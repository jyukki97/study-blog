---
title: "HTTP/3 & QUIC: TCP를 버리고 UDP로 간 이유"
date: 2025-12-28
draft: false
topic: "Modern Tech"
tags: ["Network", "HTTP/3", "QUIC", "UDP", "Performance", "TLS"]
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

## 이 글에서 얻는 것

- HTTP/1.1 → HTTP/2 → HTTP/3 발전 흐름과 **각 버전이 해결하려 한 핵심 문제**를 설명할 수 있습니다.
- TCP의 구조적 한계(**HOL Blocking, 느린 핸드셰이크**)가 왜 HTTP/2에서도 해결되지 않았는지 이해합니다.
- QUIC의 4가지 핵심 혁신(**독립 스트림, 0-RTT, Connection Migration, 내장 TLS**)을 구체적으로 이해합니다.
- 백엔드 관점에서 HTTP/3 도입 시 **고려사항, 성능 영향, 점진 전환 전략**을 판단할 수 있습니다.
- QUIC의 **보안 특성**(0-RTT의 Replay Attack 위험 포함)을 이해합니다.

---

## 1. HTTP 프로토콜의 진화 (왜 HTTP/3까지 왔는가)

### 1-1) 버전별 핵심 변화 요약

| 버전 | 연도 | 전송 계층 | 핵심 혁신 | 남은 한계 |
|------|------|----------|----------|----------|
| HTTP/1.0 | 1996 | TCP | 요청마다 연결/종료 | 매 요청 3-way handshake |
| HTTP/1.1 | 1997 | TCP | Keep-Alive (연결 재사용) | HOL Blocking (순차 처리) |
| HTTP/2 | 2015 | TCP | 멀티플렉싱 (하나의 연결에 여러 스트림) | TCP 레벨 HOL Blocking |
| **HTTP/3** | **2022** | **QUIC (UDP)** | **스트림 독립, 0-RTT, Connection Migration** | **미들박스 호환성** |

### 1-2) HTTP/1.1의 문제: 줄 서서 기다리기

```
브라우저가 index.html, style.css, app.js, logo.png 를 요청

HTTP/1.1 (파이프라이닝 이론):
  요청1 ──→ ──→ 응답1 ──→
  요청2 ──→ ──→ (응답1 끝나야 응답2 시작) ──→ 응답2
  요청3 ──→ ──→ (응답2 끝나야 응답3 시작) ──→ 응답3

→ 앞의 응답이 느리면 뒤가 모두 대기 (Application-level HOL Blocking)
→ 실무에서는 파이프라이닝 비활성화, 연결 6개를 동시에 열어서 회피 (비효율)
```

### 1-3) HTTP/2의 해결과 미완의 문제

HTTP/2는 하나의 TCP 연결에 여러 스트림을 동시에 흘려보냅니다 (멀티플렉싱).

```
HTTP/2:
  ┌── TCP 연결 1개 ──────────────────────┐
  │  Stream 1: [Header] [Data] [Data]    │
  │  Stream 2: [Header] [Data]           │
  │  Stream 3: [Header] [Data] [Data]    │
  └──────────────────────────────────────┘
  → 요청/응답이 순서 상관없이 섞여서 전달됨 (빠름!)
```

그런데 **TCP 레벨**에서 패킷이 하나 유실되면?

```
TCP 패킷 순서: [1] [2-LOST] [3] [4] [5]

TCP의 규칙: "2번이 올 때까지 3, 4, 5번을 앱에 전달하지 않음"
→ Stream 1의 패킷(3번)도, Stream 3의 패킷(5번)도 모두 대기
→ 서로 관계없는 스트림끼리 간섭 = TCP-level HOL Blocking
```

**핵심**: HTTP/2는 HTTP 레벨의 HOL Blocking을 해결했지만, TCP 레벨의 HOL Blocking은 해결할 수 없었습니다. TCP를 고치려면 전 세계 OS 커널을 업데이트해야 하니까요.

---

## 2. QUIC: UDP 위에 새로 만든 전송 프로토콜

구글의 발상: *"TCP를 고칠 수 없으면, UDP 위에 신뢰성/암호화를 새로 구현하자."*

### 2-1) 프로토콜 스택 비교

```
HTTP/2 스택                HTTP/3 스택
┌─────────────┐           ┌─────────────┐
│  HTTP/2     │           │  HTTP/3     │
├─────────────┤           ├─────────────┤
│  TLS 1.2/3  │           │             │
├─────────────┤           │  QUIC       │ ← 신뢰성 + TLS 1.3 통합
│  TCP        │           │  (User-space)│
├─────────────┤           ├─────────────┤
│  IP         │           │  UDP        │
└─────────────┘           ├─────────────┤
                          │  IP         │
                          └─────────────┘
```

**QUIC이 UDP 위에 직접 구현하는 것들:**
- **신뢰성 (Reliability)**: 패킷 번호, 재전송, 흐름 제어, 혼잡 제어
- **암호화 (TLS 1.3)**: 핸드셰이크 단계에서부터 통합
- **멀티플렉싱**: 스트림별 독립적 흐름 제어

> **왜 UDP인가?** UDP는 "빈 깡통"에 가깝습니다. 신뢰성 보장이 없는 대신, 그 위에 원하는 기능을 자유롭게 구현할 수 있습니다. 그리고 중요한 점 — UDP는 거의 모든 네트워크 장비가 이미 통과시킵니다.

### 2-2) 핵심 혁신 1: Independent Streams (진정한 멀티플렉싱)

```
QUIC의 스트림 독립성:

  ┌── QUIC 연결 1개 ───────────────────────┐
  │                                         │
  │  Stream 1: [Pkt A] [Pkt B-LOST] [Pkt C]│ ← B 재전송 대기
  │  Stream 2: [Pkt D] [Pkt E]             │ ← 영향 없음! 즉시 전달
  │  Stream 3: [Pkt F] [Pkt G] [Pkt H]     │ ← 영향 없음! 즉시 전달
  │                                         │
  └─────────────────────────────────────────┘
```

- Stream 1의 패킷 B가 유실되어도, Stream 2와 3은 멈추지 않습니다.
- 각 스트림이 독자적인 순서 보장과 흐름 제어를 가집니다.
- 이것이 TCP와의 근본적 차이이며, HTTP/3의 핵심 가치입니다.

**체감 효과가 큰 환경:**
- 모바일 네트워크 (패킷 손실률 1~5%)
- 고지연 네트워크 (위성, 해외 CDN)
- 동시에 많은 리소스를 로딩하는 웹페이지

### 2-3) 핵심 혁신 2: 빠른 연결 수립 (0-RTT ~ 1-RTT)

```
TCP + TLS 1.3 (최소 2-RTT):
  Client                    Server
    │── SYN ──────────────→│   }
    │←─ SYN-ACK ───────────│   } TCP 핸드셰이크: 1 RTT
    │── ACK ──────────────→│   }
    │── ClientHello ──────→│   }
    │←─ ServerHello ───────│   } TLS 핸드셰이크: 1 RTT
    │── Finished ─────────→│   }
    │── HTTP Request ─────→│   ← 드디어 데이터!
    │←─ HTTP Response ─────│
    총: 2 RTT 후 데이터 전송 시작

QUIC 첫 연결 (1-RTT):
  Client                    Server
    │── Initial ──────────→│   } QUIC + TLS 핸드셰이크 통합
    │←─ Initial + Handshake│   } 1 RTT
    │── Handshake + Data ─→│   ← 1 RTT 만에 데이터!
    총: 1 RTT 후 데이터 전송 시작

QUIC 재연결 (0-RTT):
  Client                    Server
    │── Initial + Data ───→│   ← 첫 패킷부터 데이터! (캐시된 키 사용)
    │←─ Handshake + Data ──│
    총: 0 RTT로 데이터 전송 시작
```

**0-RTT의 비밀**: 이전 연결에서 서버가 발급한 **세션 티켓(Session Ticket)**을 클라이언트가 저장합니다. 재연결 시 이 티켓으로 암호화된 데이터를 첫 패킷에 포함시킵니다.

**실측 효과 (RTT = 100ms 가정)**:

| 시나리오 | TCP+TLS | QUIC | 절약 |
|---------|---------|------|------|
| 첫 연결 | 200ms | 100ms | 100ms |
| 재연결 | 200ms | 0ms | 200ms |
| 모바일 (RTT=300ms) 첫 연결 | 600ms | 300ms | 300ms |

> 절대값이 작아 보이지만, 페이지 로딩에 수십 개의 연결이 필요하고, 모바일에서 RTT가 큰 환경에서는 체감 차이가 큽니다.

### 2-4) 핵심 혁신 3: Connection Migration (네트워크 전환 시 끊김 방지)

와이파이 잡고 유튜브 보다가, 현관문 나가면서 LTE로 바뀌는 순간 영상이 멈칫하죠?

**TCP의 문제:**
```
TCP 연결 식별자: (클라이언트 IP, 클라이언트 Port, 서버 IP, 서버 Port)

WiFi:  (192.168.0.10 : 54321, 1.2.3.4 : 443) ← 연결 A
  ↓ WiFi → LTE 전환
LTE:   (10.0.0.5 : 38912, 1.2.3.4 : 443)     ← 새 연결 (IP+Port 모두 변경)
→ 연결 A는 사라짐 → 재접속 필요 → 버퍼링/끊김
```

**QUIC의 해결:**
```
QUIC 연결 식별자: Connection ID (64비트 랜덤 값)

WiFi:  IP=192.168.0.10, Connection ID = 0xA1B2C3D4
  ↓ WiFi → LTE 전환
LTE:   IP=10.0.0.5, Connection ID = 0xA1B2C3D4
→ IP가 바뀌어도 Connection ID가 같으므로 동일 세션 유지
→ 추가 핸드셰이크 없이 바로 데이터 이어보냄
```

**적용 사례:**
- 유튜브: WiFi → LTE 전환 시 끊김 없는 재생
- 구글 검색: 이동 중에도 검색 결과 즉시 표시
- 대중교통 앱: 지하철 역 간 네트워크 전환에서 끊김 최소화

### 2-5) 핵심 혁신 4: TLS 1.3 기본 내장

QUIC은 TLS 1.3을 선택이 아닌 **필수**로 내장합니다.

**기존 (TCP + TLS)**:
```
TCP 연결이 먼저 수립됨 (평문) → 그 위에 TLS 핸드셰이크 → 암호화 시작
→ 초기 패킷(TCP 핸드셰이크)은 암호화되지 않음
→ 관찰자가 연결 수립 과정을 볼 수 있음
```

**QUIC**:
```
첫 패킷(Initial)부터 TLS 1.3 핸드셰이크가 포함됨
→ 핸드셰이크 이후 모든 페이로드 + 대부분의 헤더가 암호화됨
→ 미들박스(방화벽, ISP)가 내부를 들여다볼 수 없음
→ 프로토콜 경직화(Ossification) 방지
```

**암호화 범위 비교:**

| 구성 요소 | TCP+TLS | QUIC |
|----------|---------|------|
| 페이로드 (HTTP 데이터) | ✅ 암호화 | ✅ 암호화 |
| HTTP 헤더 | ✅ 암호화 | ✅ 암호화 |
| 전송 계층 헤더 | ❌ 평문 (TCP 헤더) | ✅ 대부분 암호화 |
| 연결 수립 과정 | ❌ 평문 (SYN/ACK) | ⚠️ Initial은 일부 평문 |
| 패킷 번호 | N/A | ✅ 암호화 (재전송 분석 차단) |

---

## 3. 0-RTT의 보안 위험: Replay Attack

0-RTT는 빠르지만, **보안 트레이드오프**가 있습니다.

### 3-1) Replay Attack이란?

```
공격자가 0-RTT 패킷을 복사하여 서버에 재전송

정상 클라이언트:
  [0-RTT: POST /transfer?amount=1000&to=attacker]  ──→ 서버 (처리)

공격자 (패킷 가로채기):
  [0-RTT: POST /transfer?amount=1000&to=attacker]  ──→ 서버 (또 처리?!)
```

0-RTT 데이터는 서버가 아직 클라이언트를 완전히 인증하기 전에 처리하므로, 공격자가 패킷을 복제해서 재전송할 수 있습니다.

### 3-2) 방어 전략

```
✅ 0-RTT에 허용해도 안전한 요청:
  - GET /api/products (조회, 멱등)
  - GET /api/user/profile (읽기 전용)
  - HEAD, OPTIONS

❌ 0-RTT에 허용하면 안 되는 요청:
  - POST /api/transfer (송금)
  - PUT /api/orders/{id}/confirm (상태 변경)
  - DELETE /api/users/{id} (삭제)
```

**서버 측 대응:**
```nginx
# Nginx에서 0-RTT 활성화 시
ssl_early_data on;

# 프록시에 0-RTT 여부를 전달
proxy_set_header Early-Data $ssl_early_data;
```

```java
// 애플리케이션에서 0-RTT 요청 검증
@PostMapping("/api/transfer")
public ResponseEntity<?> transfer(
        @RequestHeader(value = "Early-Data", required = false) String earlyData,
        @RequestBody TransferRequest request) {

    if ("1".equals(earlyData)) {
        // 0-RTT 요청은 비멱등 작업에서 거부
        return ResponseEntity.status(HttpStatus.TOO_EARLY) // 425
            .body("0-RTT 요청으로는 송금을 처리할 수 없습니다.");
    }
    return ResponseEntity.ok(transferService.execute(request));
}
```

> HTTP 425 (Too Early)는 RFC 8470에서 정의된 상태 코드로, 0-RTT 요청을 거부할 때 사용합니다.

---

## 4. 백엔드 관점에서의 HTTP/3 도입

### 4-1) 성능 영향 분석

| 환경 | 개선 효과 | 설명 |
|------|----------|------|
| 모바일 (높은 패킷 손실) | ⭐⭐⭐ 높음 | HOL Blocking 해소 + Connection Migration |
| 글로벌 서비스 (높은 RTT) | ⭐⭐⭐ 높음 | 0-RTT로 연결 시간 대폭 단축 |
| 사내 API 서버 (로컬) | ⭐ 낮음 | RTT가 이미 <1ms, 패킷 손실 거의 없음 |
| CDN/정적 콘텐츠 | ⭐⭐ 보통 | 다수의 작은 파일 전송에 유리 |
| 실시간 스트리밍 | ⭐⭐⭐ 높음 | 끊김 없는 네트워크 전환 |

### 4-2) 주요 서버/CDN의 HTTP/3 지원 현황

| 서버/서비스 | HTTP/3 지원 | 비고 |
|------------|-----------|------|
| Nginx | ✅ (1.25.0+, quic 모듈) | 프로덕션 사용 가능 |
| Caddy | ✅ (기본 활성화) | 가장 간편한 설정 |
| HAProxy | ✅ (2.6+, 실험적) | 프로덕션 주의 |
| Apache | ⚠️ (mod_http3, 실험적) | 아직 불안정 |
| Cloudflare | ✅ (자동 활성화) | 추가 설정 불필요 |
| AWS CloudFront | ✅ | 배포 설정에서 활성화 |
| Google Cloud CDN | ✅ | 자동 활성화 |

### 4-3) Nginx에서 HTTP/3 활성화 예시

```nginx
server {
    # HTTP/3 (QUIC)
    listen 443 quic reuseport;

    # HTTP/2 (기존 호환)
    listen 443 ssl;

    http2 on;
    http3 on;

    ssl_certificate /etc/ssl/certs/example.com.crt;
    ssl_certificate_key /etc/ssl/private/example.com.key;

    # 0-RTT 활성화 (주의: 비멱등 요청 방어 필요)
    ssl_early_data on;

    # Alt-Svc 헤더로 HTTP/3 지원을 브라우저에 알림
    add_header Alt-Svc 'h3=":443"; ma=86400';

    # QUIC 전용 설정
    quic_retry on;  # Address Validation (DDoS 방어)

    location / {
        proxy_pass http://backend;
        proxy_set_header Early-Data $ssl_early_data;
    }
}
```

### 4-4) Alt-Svc: HTTP/3 발견 메커니즘

브라우저는 처음에 HTTP/2(TCP)로 접속합니다. 서버가 `Alt-Svc` 헤더를 통해 "나 HTTP/3도 지원해"라고 알려주면, 브라우저가 다음 요청부터 QUIC으로 전환합니다.

```
[첫 번째 요청] HTTP/2 over TCP
  Client ──→ Server
  Server ──→ Client: Alt-Svc: h3=":443"; ma=86400

[두 번째 요청~] HTTP/3 over QUIC
  Client ──→ Server (QUIC)
```

> `ma=86400`은 이 정보를 86400초(24시간) 캐시하라는 의미입니다.

### 4-5) 점진적 전환 전략

```
Phase 1: CDN에서 HTTP/3 활성화
  └─ 가장 안전. Cloudflare/CloudFront 설정만 바꾸면 됨.
  └─ 정적 콘텐츠(이미지, JS, CSS)에서 효과 확인

Phase 2: 리버스 프록시(Nginx/Caddy)에서 HTTP/3 활성화
  └─ Alt-Svc 헤더 추가
  └─ 백엔드 서버는 여전히 HTTP/2 또는 HTTP/1.1 (변경 없음)
  └─ QUIC은 프록시 ↔ 클라이언트 구간에만 적용

Phase 3: 모니터링 및 튜닝
  └─ QUIC 연결 비율 모니터링
  └─ UDP 방화벽 규칙 확인
  └─ 0-RTT 비율 및 실패율 관찰

Phase 4: API 서버에 직접 적용 (필요 시)
  └─ gRPC over QUIC 등 고려
  └─ 0-RTT 비멱등 요청 방어 구현
```

---

## 5. QUIC 도입 시 실무 고려사항

### 5-1) UDP 방화벽 이슈

가장 흔한 장애물입니다. 많은 기업 방화벽/NAT이 UDP 443을 차단합니다.

```
문제: 기업 네트워크에서 UDP 443 차단
  → QUIC 연결 실패
  → 브라우저가 자동으로 TCP(HTTP/2)로 폴백
  → 사용자는 모름, 하지만 HTTP/3 혜택을 받지 못함
```

**확인 방법:**
```bash
# UDP 443이 열려있는지 확인
nc -zuv example.com 443

# curl로 HTTP/3 테스트
curl --http3-only -v https://example.com

# 브라우저에서 확인
# Chrome: chrome://net-internals/#quic
# Firefox: about:networking#quic
```

### 5-2) QUIC vs TCP 성능 비교 기준

| 지표 | 측정 방법 | QUIC 유리한 조건 |
|------|----------|----------------|
| 첫 바이트 시간 (TTFB) | 서버 응답까지 지연 | 높은 RTT, 재연결 |
| 페이지 로드 시간 | 모든 리소스 완료 | 많은 리소스, 패킷 손실 |
| 연결 재사용률 | 0-RTT 비율 | 재방문 사용자 많음 |
| 끊김 빈도 | 네트워크 전환 시 실패율 | 모바일 환경 |

### 5-3) 알려진 제한 사항

```
1. CPU 사용량: QUIC은 커널이 아닌 유저스페이스에서 동작
   → TCP 대비 CPU 사용량이 높을 수 있음 (특히 고트래픽)
   → GSO/GRO 최적화, io_uring 등으로 개선 중

2. 미들박스 호환성: 일부 네트워크 장비가 UDP를 제한
   → 자동 TCP 폴백으로 대응, 하지만 폴백 지연 발생

3. 디버깅 난이도: 패킷이 암호화되어 tcpdump로 내용을 볼 수 없음
   → qlog (QUIC 전용 로그 포맷) 활용
   → Wireshark QUIC 디코더 사용 (키 로그 필요)

4. 서버 부하: 연결당 상태 관리가 TCP보다 복잡
   → 대규모 서비스에서는 로드밸런서 설정 주의
```

---

## 6. 운영 체크리스트

| # | 항목 | 확인 |
|---|------|------|
| 1 | CDN에서 HTTP/3 활성화 여부를 확인했는가? | ☐ |
| 2 | 리버스 프록시에 Alt-Svc 헤더를 추가했는가? | ☐ |
| 3 | UDP 443 방화벽 규칙을 확인했는가? | ☐ |
| 4 | TCP 폴백이 정상 동작하는지 테스트했는가? | ☐ |
| 5 | 0-RTT 활성화 시 비멱등 요청 방어를 구현했는가? | ☐ |
| 6 | QUIC 연결 비율/성능을 모니터링하고 있는가? | ☐ |
| 7 | qlog 또는 QUIC 디버깅 도구를 준비했는가? | ☐ |
| 8 | 백엔드 서버는 프록시 뒤에서 HTTP/1.1 or HTTP/2를 유지하는가? (직접 QUIC 불필요) | ☐ |

---

## 요약

1. **HOL Blocking 제거**: 패킷 하나 잃어버려도 다른 스트림은 안 멈춥니다.
2. **0-RTT**: 재방문 시 연결 수립 지연이 0에 가깝습니다.
3. **Connection Migration**: WiFi ↔ LTE 전환에도 연결이 유지됩니다.
4. **TLS 1.3 내장**: 암호화가 선택이 아닌 기본이며, 프로토콜 경직화를 방지합니다.
5. **UDP 기반**: OS 업데이트 없이 앱 레벨에서 프로토콜을 진화시킬 수 있습니다.
6. **점진 도입**: CDN → 프록시 → API 서버 순서로 안전하게 전환하세요.

---

## 관련 글

- [TCP/HTTP2 기초](/learning/deep-dive/deep-dive-tcp-http2-basics/)
- [HTTP 심화](/learning/deep-dive/deep-dive-http-deep-dive/)
- [HTTP 필수 지식](/learning/deep-dive/deep-dive-http-essentials/)
- [TLS 핸드셰이크](/learning/deep-dive/deep-dive-tls-handshake/)
- [HTTPS/SSL 핸드셰이크](/learning/deep-dive/deep-dive-https-ssl-handshake/)
- [DNS 내부 동작](/learning/deep-dive/deep-dive-dns-internals/)
- [네트워크 OSI 7계층](/learning/deep-dive/deep-dive-network-osi-7layer/)
- [TCP 성능 최적화](/learning/deep-dive/deep-dive-network-tcp-performance/)
- [WebSocket/SSE 패턴](/learning/deep-dive/deep-dive-websocket-sse-patterns/)

---

## 연습(추천)

1. **HTTP/3 확인 실습**: `curl --http3-only -v https://google.com`으로 실제 QUIC 연결을 확인해보세요. 실패하면 `curl --http3 -v`(폴백 허용)로 비교해보세요.
2. **브라우저 확인**: Chrome에서 `chrome://net-internals/#quic`을 열어, 현재 QUIC으로 연결된 사이트 목록을 확인해보세요.
3. **Alt-Svc 관찰**: 브라우저 개발자 도구(Network 탭)에서 `Alt-Svc` 응답 헤더가 포함된 사이트를 찾고, 새로고침 후 프로토콜이 h3로 바뀌는지 확인해보세요.
4. **성능 비교**: WebPageTest에서 같은 사이트를 HTTP/2와 HTTP/3로 테스트하고, TTFB와 로드 시간 차이를 비교해보세요.

---

👈 **[이전: TCP/HTTP2 기초](/learning/deep-dive/deep-dive-tcp-http2-basics/)**
