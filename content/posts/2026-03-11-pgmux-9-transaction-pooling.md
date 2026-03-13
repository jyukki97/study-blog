---
title: "Go로 PostgreSQL 프록시 만들기 (9) - Transaction Pooling"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Connection Pooling", "PgBouncer"]
categories: ["Database"]
project: "pgmux"
description: "진정한 커넥션 다중화를 위한 트랜잭션 레벨 풀링을 구현한다. DISCARD ALL, 세션 바인딩, PgBouncer와의 비교."
---

## 들어가며

> "커넥션 풀링이 있는데 왜 클라이언트마다 커넥션을 하나씩 잡고 있을까?"

2편에서 커넥션 풀을 구현했지만, 사실 **세션 레벨 풀링**이었다. 클라이언트가 연결되면 백엔드 커넥션 하나를 잡고, 연결이 끊길 때까지 반환하지 않았다. 100개 클라이언트가 붙으면 100개 DB 커넥션이 필요하다.

PgBouncer가 `transaction` 모드로 동작하는 것처럼, 진짜 커넥션 절약을 하려면 **트랜잭션 단위**로 커넥션을 공유해야 한다.

이번 편에서 구현한 것:
1. 쿼리/트랜잭션 단위 Writer 커넥션 Acquire/Release
2. `DISCARD ALL`로 커넥션 상태 초기화
3. Extended Query Protocol 트랜잭션 추적
4. 실제 다중화 동작 검증

## 🔄 세션 풀링 vs 트랜잭션 풀링

```
Session-Level (기존):
Client A ─── Conn 1 ─── (연결 끊길 때까지 점유)
Client B ─── Conn 2
Client C ─── Conn 3

Transaction-Level (목표):
Client A ─┐
           ├── Conn 1 ─── (쿼리/트랜잭션 끝나면 반환)
Client B ─┤
           ├── Conn 2
Client C ─┘
```

세션 풀링에서 100개 클라이언트 = 100개 커넥션이 필요했다면, 트랜잭션 풀링에서는 **동시에 쿼리를 실행하는 수**만큼만 있으면 된다. 보통 10~20개로 충분하다.

## 🏗️ 핵심 설계: Acquire → Execute → Reset → Release

트랜잭션 풀링의 생명주기:

```
1. 쿼리 도착 → Pool.Acquire()
2. 백엔드에 쿼리 전송 + 응답 릴레이
3. DISCARD ALL 전송 (상태 초기화)
4. Pool.Release()
```

### Writer 커넥션 획득

```go
func (s *Server) acquireWriterConn(ctx context.Context, bound *pool.Conn) (*pool.Conn, bool, error) {
    if bound != nil {
        return bound, false, nil  // 트랜잭션 중이면 기존 커넥션 재사용
    }
    conn, err := s.writerPool.Acquire(ctx)
    if err != nil {
        return nil, false, fmt.Errorf("acquire writer: %w", err)
    }
    return conn, true, nil
}
```

`bound`가 nil이 아니면 트랜잭션 진행 중이라는 뜻이다. 새로 Acquire하지 않고 기존 커넥션을 그대로 쓴다. `bool` 리턴값으로 "새로 획득했는가?"를 구분한다 — 이게 Release 시점을 결정한다.

### 커넥션 초기화: DISCARD ALL

```go
func (s *Server) resetAndReleaseWriter(conn *pool.Conn) {
    if err := s.resetConn(conn); err != nil {
        slog.Warn("reset writer conn failed, discarding", "error", err)
        s.writerPool.Discard(conn)
        return
    }
    s.writerPool.Release(conn)
}
```

다음 클라이언트가 같은 커넥션을 받을 때 이전 세션의 상태(SET 변수, TEMP 테이블, PREPARED STATEMENT 등)가 남아있으면 안 된다. `DISCARD ALL`은 PostgreSQL에서 세션 상태를 완전히 초기화하는 명령이다:

```sql
DISCARD ALL;
-- 효과: SET 변수 초기화, TEMP 테이블 삭제, PREPARED STATEMENT 해제, LISTEN 해제 등
```

reset이 실패하면 그 커넥션은 `Discard()`로 폐기한다. 상태가 불확실한 커넥션을 풀에 돌려보내면 다음 클라이언트가 예측 불가능한 동작을 겪는다.

## 🔀 트랜잭션 생명주기 추적

핵심은 **언제 커넥션을 바인딩하고 언제 해제하는가**이다:

```go
// Transaction lifecycle management
switch {
case !wasInTx && nowInTx:
    // BEGIN — bind writer for transaction duration
    boundWriter = wConn
case wasInTx && !nowInTx:
    // COMMIT/ROLLBACK — unbind and release
    boundWriter = nil
    s.resetAndReleaseWriter(wConn)
case acquired:
    // Single statement outside transaction — release immediately
    s.resetAndReleaseWriter(wConn)
}
```

4가지 상태 전이:

| wasInTx | nowInTx | acquired | 동작 |
|---------|---------|----------|------|
| false | true | true | BEGIN → 커넥션 바인딩 |
| true | true | false | 트랜잭션 중간 → 바인딩 유지 |
| true | false | false | COMMIT/ROLLBACK → 해제 |
| false | false | true | 단일 쿼리 → 즉시 해제 |

단일 SELECT/INSERT는 쿼리 하나 실행하고 바로 반환. 트랜잭션 블록 안에서는 COMMIT/ROLLBACK까지 같은 커넥션을 유지한다.

## 📡 Extended Query Protocol 트랜잭션

Simple Query는 텍스트에서 `BEGIN`/`COMMIT`을 바로 감지할 수 있지만, Extended Query Protocol(Parse/Bind/Execute/Sync)은 다르다. Parse 메시지에서 SQL을 추출해야 한다:

```go
case protocol.MsgParse:
    stmtName, query := protocol.ParseParseMessage(msg.Payload)
    route := session.RegisterStatement(stmtName, query)

    upper := strings.ToUpper(strings.TrimSpace(query))
    if strings.HasPrefix(upper, "BEGIN") || strings.HasPrefix(upper, "START TRANSACTION") {
        extTxStart = true
    }
    if strings.HasPrefix(upper, "COMMIT") || strings.HasPrefix(upper, "ROLLBACK") {
        extTxEnd = true
    }
```

Sync 메시지가 올 때 한꺼번에 실행하고, 같은 바인딩/해제 로직을 적용한다:

```go
case protocol.MsgSync:
    // ... 배치 실행 후 ...
    switch {
    case extTxStart && !extTxEnd:
        boundWriter = wConn    // BEGIN — bind
    case extTxEnd:
        boundWriter = nil      // COMMIT — unbind
        s.resetAndReleaseWriter(wConn)
    case acquired:
        s.resetAndReleaseWriter(wConn)  // 단일 배치 — release
    }
```

## 📊 PgBouncer와의 비교

| 항목 | PgBouncer | pgmux |
|------|-----------|----------|
| 풀링 모드 | session / transaction / statement | transaction |
| 커넥션 초기화 | `DISCARD ALL` 또는 `RESET ALL` | `DISCARD ALL` |
| 상태 추적 | 내부 FSM | 쿼리 파싱 기반 |
| PREPARE 지원 | `server_reset_query` | DISCARD ALL로 해제 |
| Auth | 별도 `userlist.txt` | YAML config 또는 backend relay |

PgBouncer의 `transaction` 모드와 동일한 시맨틱이다. 차이점은 PgBouncer가 C로 작성된 전용 프록시인 반면, 이 구현은 Go로 된 학습용 프로젝트라는 것. 하지만 핵심 원리는 같다.

## ⚠️ 트랜잭션 풀링의 제약

PgBouncer 문서에서도 강조하는 제약:

1. **SET 변수가 트랜잭션 후 사라진다** — `SET search_path = ...` 같은 세션 변수가 `DISCARD ALL`로 초기화됨
2. **LISTEN/NOTIFY 사용 불가** — 커넥션이 바뀌면 LISTEN 등록이 사라짐
3. **TEMP TABLE이 트랜잭션 후 사라진다** — 당연하지만 세션 모드에서는 유지됐음

이런 제약을 감수할 수 있는 OLTP 워크로드(단순 CRUD)에 적합하다.

## 배운 점

1. **커넥션 다중화의 본질은 "상태 격리"** — 이전 세션의 상태가 다음 세션에 영향을 주면 안 된다. `DISCARD ALL`이 그 격리의 핵심이다.
2. **트랜잭션 경계 추적이 가장 어렵다** — Simple Query와 Extended Query에서 각각 다른 방법으로 BEGIN/COMMIT을 감지해야 한다.
3. **bool 하나로 생명주기가 결정된다** — `acquired` 플래그 하나가 "이 커넥션을 지금 반환할까, 바인딩할까?"를 결정한다. 상태 머신을 과설계하지 않아도 충분하다.
4. **풀링 모드의 트레이드오프를 이해해야 한다** — 세션 풀링은 안전하지만 비효율적, 트랜잭션 풀링은 효율적이지만 SET/LISTEN/TEMP 제약이 있다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
