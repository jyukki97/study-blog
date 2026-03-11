---
title: "Go로 PostgreSQL 프록시 만들기 (5) - 통합, E2E 테스트, 회고"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Benchmark", "Review"]
categories: ["Database"]
description: "독립적으로 만든 컴포넌트들을 프록시 서버에 통합하고, Docker 환경에서 E2E 테스트로 검증한 뒤, 전체 프로젝트를 돌아본다."
---

## 들어가며

> 4편까지 각 컴포넌트(Pool, Router, Cache)를 독립적으로 만들고 테스트했다. 이제 진짜 연결할 차례다.

지금까지 만든 것들:
1. PG wire protocol 프록시 (메시지 단위 릴레이)
2. 커넥션 풀링 (DialFunc, Acquire/Release/Discard)
3. R/W 쿼리 자동 분산 (Session + RoundRobin)
4. LRU 쿼리 캐싱 + 테이블별 무효화

문제는 — 이것들이 서로 **연결되어 있지 않았다는 것**이다.

## 통합 전 상태

```go
// Before: NewServer에서 Pool, Router, Cache를 초기화하지 않음
func NewServer(cfg *config.Config) *Server {
    return &Server{
        listenAddr: cfg.Proxy.Listen,
        writerAddr: fmt.Sprintf("%s:%d", cfg.Writer.Host, cfg.Writer.Port),
    }
}

// Before: 쿼리를 무조건 writer 1대로 직접 릴레이
func (s *Server) relayQueries(ctx context.Context, clientConn, backendConn net.Conn) {
    // ... 파싱이나 분류 없이 단순 전달
}
```

각 컴포넌트가 독립적으로 존재만 하고, 프록시에 실제로 통합되지 않은 상태였다.

## 통합 설계

### 핵심 결정: Writer는 전용, Reader는 풀링

```
Client connects
    ↓
Read startup (SSL negotiate)
    ↓
Connect to WRITER (direct, per-client)
    ↓ Auth relay (bidirectional)
Session created (Router)
    ↓
Query Loop:
  classify → route → cache check → forward → cache store/invalidate
```

- **Writer 연결**: 클라이언트별 전용 (auth relay로 인증 후 유지)
- **Reader 연결**: Pool에서 관리, RoundRobin으로 분배 (쿼리마다 acquire/release)

Writer를 전용으로 한 이유는 PG auth relay 때문이다. 클라이언트의 인증을 writer로 중계하는 과정에서 해당 연결이 이미 설정되므로, 그대로 세션에 묶는 게 자연스럽다.

### Pool에 DialFunc 추가

Reader 풀은 PG 인증까지 완료된 연결을 관리해야 한다. 기존 Pool은 raw TCP dial만 했는데, `DialFunc`을 추가해서 PG-aware 연결 생성을 지원한다:

```go
type DialFunc func() (net.Conn, error)

type Config struct {
    DialFunc          DialFunc // nil이면 기존 TCP dial 사용
    Addr              string
    MinConnections    int
    MaxConnections    int
    // ...
}
```

서버 초기화 시:

```go
for _, addr := range readerAddrs {
    addr := addr
    p, _ := pool.New(pool.Config{
        DialFunc: func() (net.Conn, error) {
            return pgConnect(addr, cfg.Backend.User, cfg.Backend.Password, cfg.Backend.Database)
        },
        MinConnections: 0, // lazy creation
        MaxConnections: cfg.Pool.MaxConnections,
    })
    s.readerPools[addr] = p
}
```

### PG 인증 구현: MD5 + SCRAM-SHA-256

Reader 풀의 `DialFunc`에서 `pgConnect()`를 호출한다. 이 함수는 TCP 연결 후 PG startup handshake + 인증까지 완료한다.

PostgreSQL 16의 기본 인증이 SCRAM-SHA-256이므로, 이걸 직접 구현해야 했다:

```go
func handleSCRAM(conn net.Conn, mechanisms []byte, user, password string) error {
    // 1. SASLInitialResponse: client-first-message
    clientNonce := generateNonce()
    clientFirstBare := fmt.Sprintf("n=%s,r=%s", user, clientNonce)

    // 2. Read SASLContinue: server-first-message (nonce, salt, iterations)
    // 3. Compute PBKDF2 → HMAC-SHA-256 → client proof
    saltedPassword := pbkdf2.Key([]byte(password), salt, iterations, 32, sha256.New)
    clientKey := hmacSHA256(saltedPassword, []byte("Client Key"))
    // ... XOR로 proof 생성

    // 4. Read SASLFinal: server signature 검증
}
```

SCRAM 인증의 핵심은 **비밀번호를 직접 전송하지 않는다**는 것이다. 대신 challenge-response 방식으로 서로를 검증한다. 4단계 핸드셰이크(InitialResponse → Continue → Response → Final)를 거친다.

### Auth Relay 버그 수정

초기 구현에서 `relayAuth()`는 백엔드→클라이언트 방향만 처리하고 있었다. PG 인증은 **양방향**이다:

```
Backend → AuthenticationMD5Password → Client
Client  → PasswordMessage          → Backend   ← 이 방향이 빠져있었다!
Backend → AuthenticationOk          → Client
```

수정:

```go
func (s *Server) relayAuth(clientConn, backendConn net.Conn) error {
    for {
        msg, _ := protocol.ReadMessage(backendConn)
        protocol.WriteMessage(clientConn, msg.Type, msg.Payload)

        // 인증 요청이면 클라이언트 응답을 읽어서 백엔드로 전달
        if msg.Type == MsgAuthentication {
            authType := binary.BigEndian.Uint32(msg.Payload[0:4])
            if authNeedsResponse(authType) { // MD5(5), SCRAM(10,11)
                clientMsg, _ := protocol.ReadMessage(clientConn)
                protocol.WriteMessage(backendConn, clientMsg.Type, clientMsg.Payload)
            }
        }
    }
}
```

### Extended Query Protocol 지원

`lib/pq` 같은 드라이버는 파라미터가 있는 쿼리에 Extended Query Protocol을 쓴다:

```
Parse(P) → Bind(B) → Execute(E) → Sync(S)
```

이 메시지들은 개별적으로 `ReadyForQuery`를 생성하지 않는다. `Sync` 메시지가 올 때만 백엔드가 `ReadyForQuery`를 보낸다:

```go
if msg.Type != protocol.MsgQuery {
    protocol.WriteMessage(writerConn, msg.Type, msg.Payload)
    // Sync일 때만 응답을 대기
    if msg.Type == protocol.MsgSync {
        s.relayUntilReady(clientConn, writerConn)
    }
    continue
}
```

## 쿼리 라우팅 플로우

통합 후 실제 쿼리 처리 흐름:

```go
query := protocol.ExtractQueryText(msg.Payload)
route := session.Route(query)  // Session이 트랜잭션/R-A-W 상태 추적

if route == RouteWriter {
    forwardAndRelay(clientConn, writerConn, msg)
    // 쓰기 쿼리면 캐시 무효화
    if Classify(query) == QueryWrite {
        for _, table := range ExtractTables(query) {
            queryCache.InvalidateTable(table)
        }
    }
} else { // RouteReader
    // 캐시 확인
    if cached := queryCache.Get(CacheKey(query)); cached != nil {
        clientConn.Write(cached) // 캐시 히트: PG 응답 바이트 그대로 전송
        continue
    }
    // Reader 풀에서 연결 획득 (RoundRobin)
    addr := balancer.Next()
    rConn, _ := readerPools[addr].Acquire(ctx)
    // 쿼리 전달 + 응답 수집 + 캐시 저장
    collected, _ := relayAndCollect(clientConn, rConn)
    queryCache.Set(CacheKey(query), collected, nil)
    readerPools[addr].Release(rConn)
}
```

캐시는 PG wire protocol의 원본 바이트를 그대로 저장한다. 캐시 히트 시 직렬화/역직렬화 없이 바이트를 바로 전송한다.

## E2E 테스트: Docker 환경

```yaml
# docker-compose.yml: Primary + Replica x2
services:
  primary:   # port 15432, wal_level=replica
  replica1:  # port 15433, pg_basebackup from primary
  replica2:  # port 15434, pg_basebackup from primary
```

실제 PostgreSQL 클러스터를 띄우고, 프록시를 통해 `lib/pq`로 접속하는 E2E 테스트:

```go
func TestE2E_ProxyIntegration(t *testing.T) {
    db, _ := sql.Open("postgres", "postgres://postgres:postgres@127.0.0.1:15440/testdb?sslmode=disable")

    t.Run("ReadQuery", func(t *testing.T) {
        // SELECT → reader로 라우팅 → RoundRobin 분배
    })
    t.Run("WriteQuery", func(t *testing.T) {
        // INSERT → writer → Extended Query Protocol 정상 처리
    })
    t.Run("Transaction", func(t *testing.T) {
        // BEGIN~ROLLBACK → 전체 writer 라우팅
    })
    t.Run("CacheHit", func(t *testing.T) {
        // 동일 쿼리 두 번 → 두 번째는 캐시 히트
    })
}
```

프록시 디버그 로그 (실제 출력):

```
query routed sql="SELECT name FROM users ORDER BY id LIMIT 3" route=reader
cache set   sql="SELECT name FROM users ORDER BY id LIMIT 3" size=98
query routed sql="DELETE FROM users WHERE name = 'dave'" route=writer
cache invalidated table=users
query routed sql="BEGIN READ WRITE" route=writer
query routed sql="INSERT INTO users ..." route=writer
query routed sql="SELECT name FROM users WHERE name = 'tx_user'" route=writer  ← 트랜잭션 내
query routed sql=ROLLBACK route=writer
```

## 벤치마크 결과

Apple M4 Pro 기준:

### 핵심 경로 성능

| 컴포넌트 | 연산 | ns/op | alloc |
|----------|------|-------|-------|
| Cache | Key 생성 (FNV-1a) | 15 | 0 |
| Cache | Get (Hit) | 36 | 0 |
| Cache | Get (Miss) | 6 | 0 |
| Cache | Set | 108 | 1 |
| Cache | Invalidate (100건) | 7,901 | 0 |
| Router | RoundRobin Next | 1.8 | 0 |
| Router | Classify (SELECT) | 1,342 | 45 |
| Router | Classify (힌트 주석) | 126 | 1 |
| Router | Session Route | 1,299 | 46 |
| Router | ExtractTables | 189 | 5 |

캐시 히트 36ns는 DB 왕복(~1ms)의 27,000분의 1이다. 캐시 히트율이 높을수록 전체 성능이 크게 향상된다.

## 테스트 커버리지

| 패키지 | 테스트 수 | 내용 |
|--------|-----------|------|
| config | 8 | 파싱, validation, 기본값 |
| protocol | 5 | 메시지 읽기/쓰기, startup, SSL |
| proxy | 3 | TCP 접속, graceful shutdown, parseSize |
| pool | 6 | min 생성, 재사용, 타임아웃, 만료, 헬스체크 |
| router | 34 | 파서 19, 세션 4, 밸런서 5, 테이블추출 6 |
| cache | 8 | get/set, TTL, LRU, max_size, 무효화 |
| integration | 5 | 라우터+캐시 연동, 트랜잭션, LB |
| e2e | 4 | R/W 라우팅, 트랜잭션, 캐시 (Docker PG) |
| **합계** | **73** | |

## 잘한 점

**1. 메시지 단위 릴레이 설계**
처음부터 바이트 릴레이가 아닌 메시지 단위로 설계한 덕분에, 라우팅과 캐싱을 끼워넣기가 쉬웠다. Extended Query Protocol 지원도 메시지 타입만 보고 분기하면 됐다.

**2. 컴포넌트 독립성 → 통합 용이**
Pool, Router, Cache가 서로 의존하지 않아서 단위 테스트가 깔끔했고, 통합할 때도 서버 코드만 수정하면 됐다. 인터페이스 분리의 힘.

**3. 0 alloc 캐시 + PG 바이트 직접 캐싱**
캐시의 핫 경로에서 메모리 할당이 0이다. 그리고 PG wire protocol 바이트를 그대로 캐시하므로, 캐시 히트 시 직렬화 오버헤드가 없다.

**4. SCRAM-SHA-256 직접 구현**
PostgreSQL 16의 기본 인증 방식을 직접 구현하면서, challenge-response 인증의 원리를 깊이 이해했다.

## 아쉬운 점과 개선 방향

**1. ~~Extended Query Protocol 라우팅 미지원~~ → [6편에서 해결](/posts/2026-03-11-pgmux-6-phase7-enhancement/)**
Parse 메시지에서 SQL을 추출하여 Prepared Statement도 reader로 라우팅하도록 구현했다.

**2. 파서 성능**
정규식 기반 파서가 1.3μs인 건 아쉽다. 수동 파싱으로 바꾸면 100ns 이하로 줄일 수 있을 것이다.

**3. Writer 커넥션 풀링**
현재 writer는 클라이언트별 전용 연결이다. PgBouncer처럼 트랜잭션 풀링 모드를 구현하면 writer 연결도 공유할 수 있다.

**4. 캐시 무효화의 한계**
JOIN 쿼리의 테이블 추출이 미지원이고, SELECT의 FROM절 테이블 추출도 없다.

## 배운 것

1. **바이너리 프로토콜은 생각보다 단순하다** — PG wire protocol은 type+length+payload, 이 세 가지만 알면 된다
2. **인증 프로토콜은 생각보다 복잡하다** — SCRAM-SHA-256은 PBKDF2 + HMAC + challenge-response 4단계. MD5보다 훨씬 정교하다
3. **통합이 진짜 어렵다** — 개별 컴포넌트 100% 테스트 통과해도, 조합하면 auth relay 방향 문제 같은 예상 못한 버그가 나온다
4. **Extended Query Protocol을 무시하면 안 된다** — 실제 드라이버는 대부분 Extended Query를 쓴다. Simple Query만 지원하면 INSERT/UPDATE가 안 된다
5. **테스트 가능한 구조가 먼저다** — 인터페이스 분리, 의존성 주입이 테스트를 쉽게 만든다

## 마무리

빈 디렉토리에서 시작해서 커넥션 풀링, R/W 분산, 쿼리 캐싱을 갖춘 DB 프록시를 만들었다. 총 코드 약 2,000줄, 테스트 73건이다. Docker Compose로 Primary + Replica x2 환경을 구성하고, 실제 드라이버(lib/pq)로 E2E 테스트까지 통과했다.

직접 만들어보면서 가장 크게 느낀 건, **프록시는 결국 "중간에서 메시지를 읽고, 판단하고, 전달하는 것"**이라는 점이다. 그런데 그 "판단"을 제대로 하려면, 프로토콜의 세부사항(인증 방향, Extended Query 메시지 흐름, ReadyForQuery 타이밍)을 정확히 알아야 한다. 추상적인 이해와 동작하는 구현 사이의 간극을 채우는 과정이 가장 값진 경험이었다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
