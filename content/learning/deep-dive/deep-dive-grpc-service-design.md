---
title: "gRPC 서비스 설계 기초"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["gRPC", "Protobuf", "Streaming", "IDL"]
categories: ["Backend Deep Dive"]
description: "프로토 정의, 일방향/양방향 스트리밍, gRPC-Gateway 연계 등 gRPC 설계 핵심"
module: "ops-observability"
study_order: 606
quizzes:
  - question: "gRPC가 REST보다 성능이 좋은 주요 이유는?"
    options:
      - "HTTP/1.1을 사용하기 때문"
      - "Protobuf로 바이너리 직렬화하여 데이터 크기가 작고, HTTP/2 기반으로 멀티플렉싱이 가능하기 때문"
      - "JSON보다 개발이 쉽기 때문"
      - "암호화가 없기 때문"
    answer: 1
    explanation: "JSON은 필드 이름이 반복되어 용량이 크지만, Protobuf는 바이너리로 압축됩니다. 또한 HTTP/2는 하나의 커넥션으로 여러 요청을 동시 처리(Multiplexing)하여 Head-of-Line Blocking을 피합니다."

  - question: "gRPC에서 proto 파일을 먼저 정의하고 코드를 생성하는 이유는?"
    options:
      - "성능을 위해"
      - "IDL(Interface Definition Language)로 계약을 명확히 하고, 여러 언어(Java, Go, Python 등)로 일관된 클라이언트/서버 코드를 자동 생성하기 위해"
      - "보안을 위해"
      - "테스트가 쉬워지기 때문"
    answer: 1
    explanation: "proto 파일은 서비스 계약(Contract)을 정의합니다. protoc 컴파일러가 이를 기반으로 스텁 코드를 생성하므로, 언어가 달라도 호환되는 통신이 가능합니다."

  - question: "gRPC의 4가지 통신 패턴 중 '실시간 채팅'에 가장 적합한 것은?"
    options:
      - "Unary (단순 요청-응답)"
      - "Server Streaming"
      - "Client Streaming"
      - "Bidirectional Streaming (양방향 스트리밍)"
    answer: 3
    explanation: "채팅은 클라이언트와 서버가 동시에 메시지를 주고받아야 합니다. Bidirectional Streaming은 양쪽 모두 스트림으로 데이터를 보낼 수 있어 적합합니다."

  - question: "gRPC proto 스키마 진화 시 '필드 번호를 재사용하면 안 되는' 이유는?"
    options:
      - "성능이 저하되기 때문"
      - "구버전 클라이언트가 새 필드를 잘못 해석하여 데이터 오류가 발생할 수 있기 때문"
      - "컴파일이 안 되기 때문"
      - "보안 문제"
    answer: 1
    explanation: "Protobuf는 필드 번호(Tag)로 데이터를 식별합니다. 번호를 재사용하면 구버전 코드가 잘못된 타입으로 데이터를 읽어 파싱 에러나 데이터 손상이 발생합니다."

  - question: "gRPC에서 데드라인(Deadline)을 클라이언트가 설정하는 이유는?"
    options:
      - "서버가 더 많은 요청을 처리하기 위해"
      - "클라이언트가 '얼마나 기다릴지'를 정하고, 서버는 데드라인 초과 시 불필요한 작업을 중단하여 리소스를 절약하기 위해"
      - "보안을 강화하기 위해"
      - "로깅을 위해"
    answer: 1
    explanation: "클라이언트가 이미 포기했는데 서버가 계속 작업하면 리소스 낭비입니다. 데드라인 초과 시 서버가 즉시 중단하면 부하가 누적되지 않아 장애를 예방할 수 있습니다."
---

## 이 글에서 얻는 것

- gRPC를 “빠른 REST” 정도로 오해하지 않고, **IDL/코드 생성/스트리밍/데드라인** 중심의 설계 감각을 잡습니다.
- proto 스키마를 호환성 있게 진화시키는 규칙(필드 번호/예약/reserved, deprecated)을 이해합니다.
- 데드라인/리트라이/스트리밍 백프레셔 같은 운영 포인트를 포함해 서비스 계약을 설계할 수 있습니다.

## 0) gRPC는 “계약(Contract) 기반”이다

gRPC의 강점은 **Protobuf(Protocol Buffers)**를 사용한 고효율 바이너리 통신입니다.

### 0.1 Protobuf vs JSON

**JSON**: 사람이 읽을 수 있지만, 필드 이름이 반복되어 용량이 큽니다.
```json
{ "id": 1, "username": "alice" }  // 30 bytes
```

**Protobuf**: 바이너리로 직렬화되며, 필드 번호(Tag)로 데이터를 식별해 매우 작습니다.
```mermaid
block-beta
  columns 4
  block:proto
    Tag1["Tag: 1 (id)"]
    Val1["Value: 1"]
    Tag2["Tag: 2 (username)"]
    Val2["Value: 'alice'"]
  end
  style proto fill:#e1f5fe,stroke:#0277bd
```
*(실제로는 [Tag|Type] + [Length] + [Value] 구조의 TLV 패킹으로 약 9~10 bytes)*

### 0.2 gRPC Interface Definition (IDL)
gRPC는 **계약(Proto)**을 먼저 정의하고, 코드를 자동 생성합니다.

```mermaid
flowchart LR
    Proto[order.proto] -->|protoc| Compiler[Protobuf Compiler]
    
    Compiler -->|Generate| Java[OrderServiceGrpc.java<br/>OrderOuterClass.java]
    Compiler -->|Generate| Go[order.pb.go<br/>order_grpc.pb.go]
    Compiler -->|Generate| Python[order_pb2.py<br/>order_pb2_grpc.py]

    style Proto fill:#ffebee,stroke:#c62828
    style Compiler fill:#e3f2fd,stroke:#1565c0
    style Java fill:#fff3e0,stroke:#e65100
```
- **Service Stub**: 클라이언트/서버가 통신하기 위한 기본 코드.
- **Message Class**: 데이터를 담는 DTO (Builder 패턴 등 제공).


좋은 gRPC 설계의 핵심 질문:

- 클라이언트가 어떤 타입/에러/타임아웃을 기대할 수 있는가?
- 호출이 멱등(idempotent)한가? 재시도해도 안전한가?
- 스트리밍이 필요한가, 단순 Unary가 충분한가?

## 1) Unary vs Streaming (feat. HTTP/2)

gRPC는 **HTTP/2** 위에서 동작하며, 하나의 커넥션으로 여러 요청을 동시에 처리(Multiplexing)합니다.

```mermaid
sequenceDiagram
    participant Client
    participant Server

    Note over Client,Server: HTTP/1.1 (Blocking / Head-of-Line Blocking)
    Client->>Server: Request 1
    Server-->>Client: Response 1
    Client->>Server: Request 2
    Server-->>Client: Response 2

    Note over Client,Server: HTTP/2 (Multiplexing)
    par Parallel Requests
        Client->>Server: Request 1 (Stream 1)
        Client->>Server: Request 2 (Stream 3)
    and
        Server-->>Client: Response 2 (Stream 3)
        Server-->>Client: Response 1 (Stream 1)
    end
```

### 1.1 Communication Patterns
- **Unary**: 단순 Req/Res (대부분의 API).
- **Server Streaming**: `returns (stream response)` (알림, 피드, 로그).
- **Client Streaming**: `(stream request)` (대용량 업로드).
- **Bidirectional**: `(stream request) returns (stream response)` (실시간 채팅, 게임).

필요한 경우에만 스트리밍을 사용하세요. (운영 복잡도 증가)

## 2) proto 설계: 호환성 규칙이 ‘운영 안전성’이다

proto는 시간이 지나며 바뀝니다. 그래서 호환성 규칙을 지키는 게 중요합니다.

- 필드 번호는 절대 재사용하지 않는다
- 삭제는 `deprecated`로 표시하고, 실제 삭제는 충분히 오래 뒤에
- 제거한 번호/이름은 `reserved`로 막아 사고를 방지
- 타입 변경은 사실상 breaking change일 수 있음(특히 string ↔ int)

예시(개념):

```proto
message Order {
  string id = 1;
  string user_id = 2;
  // deprecated: use created_at instead
  int64 createdAtMillis = 3 [deprecated = true];
  reserved 4, 5;
  reserved "old_field_name";
}
```

## 3) 데드라인/타임아웃: “서버가 아니라 클라이언트가 정한다”

gRPC는 데드라인(deadline)이 문화입니다.

- 클라이언트는 “얼마까지 기다릴지”를 정하고,
- 서버는 데드라인을 넘기면 불필요한 작업을 중단해야 합니다.

서버에서 타임아웃을 무시하면:

- 이미 클라이언트는 포기했는데 서버는 계속 일한다(낭비)
- 부하가 누적돼 장애로 이어질 수 있습니다

## 4) 재시도/멱등성: 자동 재시도는 항상 위험하다

gRPC/클라이언트 SDK는 재시도 기능이 있지만, 무턱대고 켜면 사고가 납니다.

- 멱등한 요청만 재시도(조회/상태 확인 등)
- 쓰기 요청은 idempotency key를 도입하거나, 재시도 정책을 더 보수적으로
- 백오프 + jitter, retry budget 같은 “증폭 방지”가 필요

## 5) 인증/메타데이터/관측성

- 인증 토큰은 메타데이터로 전달(Authorization)
- traceId/correlationId를 메타데이터로 전파
- 서버/클라이언트 인터셉터로 로깅/메트릭/트레이싱을 표준화

## 6) gRPC-Gateway(외부 공개가 필요할 때)

브라우저/외부 파트너는 HTTP/JSON이 필요할 수 있습니다.
이때 gRPC-Gateway로 변환하면 “내부는 gRPC, 외부는 REST” 같은 구조가 가능합니다.

포인트:

- 외부에서 들어오는 rate limit/인증은 게이트웨이에서 1차로 처리하는 편이 안전합니다.

## 연습(추천)

- 간단한 `OrderService` proto를 설계해보고, “필드 추가/이름 변경/삭제” 시나리오에서 호환성을 어떻게 지킬지 `reserved/deprecated`로 표현해보기
- Unary API에 데드라인을 적용하고, 데드라인 초과 시 서버가 작업을 중단하도록 구현해보기
- 서버 스트리밍 API에서 느린 소비자(클라이언트)를 시뮬레이션하고, 백프레셔/버퍼 정책을 어떻게 둘지 실험해보기
