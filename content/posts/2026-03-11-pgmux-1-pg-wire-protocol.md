---
title: "Go로 PostgreSQL 프록시 만들기 (1) - PG Wire Protocol 이해"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Wire Protocol", "Network"]
keywords: ["PostgreSQL Wire Protocol", "Go DB Proxy", "StartupMessage", "ReadyForQuery", "Query Relay"]
categories: ["Database"]
project: "pgmux"
description: "PostgreSQL wire protocol을 바이트 레벨로 분석하고, Go로 프록시 서버를 구현하며 핸드셰이크와 쿼리 릴레이를 직접 만들어본다."
---

## 들어가며

> PgBouncer는 어떻게 클라이언트의 쿼리를 받아서 DB로 전달하는 걸까?
> PostgreSQL wire protocol을 직접 다뤄보면서 그 원리를 이해해보자.

DB 프록시를 만들려면 가장 먼저 해야 할 일은 **클라이언트와 DB 사이의 통신 프로토콜**을 이해하는 것이다. PostgreSQL은 자체 바이너리 프로토콜(wire protocol)을 사용하며, 이걸 직접 파싱하고 생성할 수 있어야 프록시를 만들 수 있다.

## PG Wire Protocol 구조

### 메시지 포맷

PostgreSQL의 메시지는 크게 두 종류로 나뉜다:

**1. Startup 메시지 (타입 바이트 없음)**
```
[4바이트 길이][프로토콜 버전][파라미터들...]
```

**2. 일반 메시지 (타입 바이트 있음)**
```
[1바이트 타입][4바이트 길이][페이로드...]
```

예를 들어 `SELECT 1`을 보내는 Query 메시지는:
```
'Q' | 길이(4바이트) | "SELECT 1\0"
```

### 주요 메시지 타입들

| 방향 | 타입 | 바이트 | 설명 |
|------|------|--------|------|
| Client→Server | Query | `Q` | SQL 쿼리 전송 |
| Client→Server | Terminate | `X` | 연결 종료 |
| Server→Client | Authentication | `R` | 인증 응답 |
| Server→Client | ReadyForQuery | `Z` | 쿼리 수신 준비 완료 |
| Server→Client | RowDescription | `T` | 컬럼 정보 |
| Server→Client | DataRow | `D` | 행 데이터 |
| Server→Client | CommandComplete | `C` | 쿼리 실행 완료 |
| Server→Client | ErrorResponse | `E` | 에러 |

### 접속 흐름

```
Client                          Server
  │                               │
  │──── StartupMessage ──────────▶│  (버전 3.0 + user/database)
  │                               │
  │◀──── AuthenticationOk ────────│  (R + 0x00000000)
  │◀──── ParameterStatus ────────│  (server_version 등)
  │◀──── BackendKeyData ─────────│  (PID + secret key)
  │◀──── ReadyForQuery ──────────│  (Z + 'I')
  │                               │
  │──── Query("SELECT 1") ──────▶│
  │                               │
  │◀──── RowDescription ─────────│
  │◀──── DataRow ────────────────│
  │◀──── CommandComplete ────────│
  │◀──── ReadyForQuery ──────────│
```

## Go로 구현하기

### 메시지 읽기/쓰기

가장 기본이 되는 메시지 읽기 함수다:

```go
func ReadMessage(r io.Reader) (*Message, error) {
    // 1바이트 타입 읽기
    var typeBuf [1]byte
    if _, err := io.ReadFull(r, typeBuf[:]); err != nil {
        return nil, err
    }

    // 4바이트 길이 읽기 (Big Endian)
    var length int32
    if err := binary.Read(r, binary.BigEndian, &length); err != nil {
        return nil, err
    }

    // 페이로드 읽기 (길이 - 4, 길이 필드 자체 제외)
    payload := make([]byte, length-4)
    if _, err := io.ReadFull(r, payload); err != nil {
        return nil, err
    }

    return &Message{Type: typeBuf[0], Payload: payload}, nil
}
```

Startup 메시지는 타입 바이트가 없어서 별도 함수가 필요하다:

```go
func ReadStartupMessage(r io.Reader) (*Message, error) {
    var length int32
    binary.Read(r, binary.BigEndian, &length)

    payload := make([]byte, length-4)
    io.ReadFull(r, payload)

    return &Message{Type: 0, Payload: payload}, nil
}
```

### SSL 요청 처리

`psql`은 접속 시 먼저 SSL 요청을 보낸다. 매직 넘버 `80877103`으로 구분한다:

```go
if code == SSLRequestCode {  // 80877103
    clientConn.Write([]byte{'N'})  // SSL 미지원
    // 이후 실제 startup 메시지를 다시 읽음
    startup, _ = ReadStartupMessage(clientConn)
}
```

### 핸드셰이크 중계

프록시의 핵심은 클라이언트의 startup 메시지를 백엔드로 **그대로 전달**하고, 백엔드의 인증 응답을 클라이언트로 **그대로 전달**하는 것이다:

```go
// 1. 클라이언트 → 프록시: startup 메시지 수신
// 2. 프록시 → 백엔드: startup 메시지 전달
// 3. 백엔드 → 프록시 → 클라이언트: ReadyForQuery까지 릴레이

func relayAuth(clientConn, backendConn net.Conn) error {
    for {
        msg, _ := protocol.ReadMessage(backendConn)
        protocol.WriteMessage(clientConn, msg.Type, msg.Payload)

        if msg.Type == MsgReadyForQuery {
            return nil  // 인증 완료!
        }
    }
}
```

### 메시지 단위 쿼리 릴레이

인증이 끝나면 쿼리 릴레이 루프에 진입한다. 단순 바이트 복사가 아니라 **메시지 단위**로 릴레이하는 것이 포인트다. 이렇게 해야 나중에 라우팅이나 캐싱 로직을 끼워넣을 수 있다:

```go
func relayQueries(clientConn, backendConn net.Conn) {
    for {
        msg, _ := protocol.ReadMessage(clientConn)

        if msg.Type == MsgTerminate {
            return
        }

        // 여기서 쿼리 텍스트 추출 → 라우팅/캐싱 가능
        if msg.Type == MsgQuery {
            query := ExtractQueryText(msg.Payload)
            slog.Debug("query", "sql", query)
        }

        // 백엔드로 전달
        protocol.WriteMessage(backendConn, msg.Type, msg.Payload)

        // ReadyForQuery까지 응답 릴레이
        relayUntilReady(clientConn, backendConn)
    }
}
```

## 삽질 포인트

### 1. 길이 필드가 자기 자신을 포함한다
PG 프로토콜의 length 필드는 **자기 자신(4바이트)을 포함**한다. 그래서 실제 페이로드는 `length - 4`만큼 읽어야 한다. 이걸 빠뜨리면 바이트가 밀려서 전체 통신이 깨진다.

### 2. Startup 메시지에는 타입 바이트가 없다
일반 메시지는 `[type][length][payload]`인데, startup만 `[length][payload]`다. 같은 함수로 읽으면 타입 바이트를 길이의 첫 바이트로 잘못 읽게 된다.

### 3. SSL 요청을 무시하면 psql이 접속 못 한다
psql은 기본적으로 SSL 접속을 먼저 시도한다. `'N'`으로 거절해줘야 평문 접속으로 재시도한다.

## Simple Query와 Extended Query를 구분해서 이해하기

이번 글에서 구현한 `Q(Query)` 기반 릴레이는 **Simple Query Protocol** 중심이다. 학습용/초기 프록시에는 이 경로가 가장 단순하고 디버깅이 쉽다. 다만 실서비스 프록시로 발전시키려면 Extended Query 흐름까지 반드시 고려해야 한다.

- Simple Query: `Q` 한 번으로 SQL 문자열 전송
- Extended Query: `Parse -> Bind -> Describe -> Execute -> Sync` 단계로 분리

Extended Query를 지원해야 얻는 이점은 명확하다.

1. Prepared Statement 재사용으로 파싱/플랜 비용 감소
2. 바이너리 파라미터 바인딩으로 타입 안정성 향상
3. 쿼리 라우팅 시 statement 단위 정책 적용 가능

반대로 지금 단계에서 무리하게 Extended Query까지 한 번에 넣으면, 메시지 상태 머신이 복잡해져 초기 안정성이 떨어질 수 있다. 그래서 **1단계에서는 Simple Query 릴레이 안정화**, **2단계에서 Prepared Statement 멀티플렉싱**으로 분리하는 전략이 실무적으로 안전하다.

> 이 시리즈에서도 같은 순서를 따른다. 먼저 프로토콜/풀링/라우팅 기반을 고정하고, 이후 Prepared Statement와 세션 호환성 이슈를 단계적으로 다룬다.

## 운영 체크리스트 (1단계 프록시 완성 기준)

아래 체크리스트를 통과하면 "학습용 데모"를 넘어 "운영 가능한 초안"에 가까워진다.

- [ ] Startup/Authentication/ReadyForQuery 핸드셰이크가 100회 반복 테스트에서 모두 성공한다.
- [ ] 비정상 패킷(길이 오류, 타입 오류) 입력 시 프로세스 패닉 없이 연결만 안전 종료된다.
- [ ] 쿼리 릴레이 시 요청/응답 상관관계(trace id 또는 connection id)가 로그에 남는다.
- [ ] `Terminate(X)` 수신 시 백엔드 커넥션 누수 없이 정리된다.
- [ ] 타임아웃(읽기/쓰기) 기본값이 있어 무한 대기 연결이 쌓이지 않는다.

추가로, 초기에 반드시 넣어둘 관찰 포인트는 다음 3가지다.

- **latency**: client→proxy→db 왕복 지연(p50/p95)
- **error taxonomy**: auth/query/network 에러를 코드별로 분리
- **connection lifecycle**: 생성/활성/종료 카운트

이 3개가 없으면 "느리다/불안정하다" 같은 체감 이슈가 생겼을 때 원인을 분리하기 어렵다.

## 관련 글

- [PgMux 프로젝트 허브](/projects/pgmux/)
- [Go로 PostgreSQL 프록시 만들기 (2) - Connection Pooling](/posts/2026-03-11-pgmux-2-connection-pooling/)
- [Go로 PostgreSQL 프록시 만들기 (3) - Read/Write 라우팅](/posts/2026-03-11-pgmux-3-rw-routing/)
- [Prepared Statement Multiplexing 심화](/posts/2026-03-12-pgmux-21-prepared-statement-multiplexing/)

## 마무리

PG wire protocol은 생각보다 단순한 구조다. 타입 1바이트 + 길이 4바이트 + 페이로드, 이 패턴만 알면 기본적인 프록시를 만들 수 있다.

다음 글에서는 이 프록시에 **커넥션 풀링**을 추가해서, 클라이언트가 접속할 때마다 새 DB 연결을 만드는 대신 미리 만들어둔 커넥션을 재사용하도록 개선한다.
