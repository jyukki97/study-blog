---
title: "Go로 PostgreSQL 프록시 만들기 (48) - QA 3차: 풀 안전성의 마지막 구멍들"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Bug Fix", "Connection Pool", "Hot Reload", "Cache", "Circuit Breaker", "Extended Query"]
categories: ["Database"]
project: "pgmux"
description: "QA 3차 소견 6건 — fallback 경로 cross-pool 오염, extended cache 포맷 충돌, 깨진 연결 Release, Pool.Acquire close race, boundWriter discard 누락, circuit breaker 일관성 — 을 분석하고 수정한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-47-qa-round2-five-bugs/)에서 QA 2차 소견 5건을 수정했다. 3차에서는 **2차 수정이 덜 커버한 경로**와 **기존에 아예 누락된 안전장치**가 발견됐다. 6건 중 2건이 High — 모두 hot-reload 시나리오에서 데이터 정확성이나 연결 안전성이 깨지는 문제다.

---

## 소견 1: Fallback 경로 writer pool 소유권 추적 누락 (High)

### 문제

P47에서 `boundWriterPool` 추적을 추가했지만, **simple-query 트랜잭션 경로**에만 적용했다. reader fallback, extended fallback, synthesized fallback, multiplex describe 경로는 여전히 `dbg.writerPool`에서 직접 Acquire/Release한다:

```go
// handleExtendedRead — fallbackToWriter
wConn, err := dbg.writerPool.Acquire(ctx)  // ← reload 후 다른 pool
// ...
dbg.writerPool.Discard(wConn)              // ← 또 다른 pool일 수 있음
```

영향받는 경로 4곳:
1. `fallbackToWriter` (backend.go) — simple-query reader fallback
2. `handleExtendedRead.fallbackToWriter` — extended query reader fallback
3. `handleSynthesizedRead.fallbackToWriter` — multiplex mode reader fallback
4. `handleMultiplexDescribe` — Describe 메시지 처리

### 수정

모든 경로에서 **Acquire 전에 pool 참조를 캡처**하고, 해당 참조로 Release/Discard:

```go
fallbackToWriter := func() error {
    wPool := dbg.writerPool // capture before acquire
    wConn, err := wPool.Acquire(ctx)
    // ...
    wPool.Discard(wConn)   // 원본 pool로 반환
    // ...
    s.resetAndReleaseToPool(wConn, wPool)
}
```

P47에서 도입한 `resetAndReleaseToPool`/`releaseToPool`이 이번에도 그대로 사용된다. 이로써 `resetAndReleaseWriter`/`releaseWriterFast`(dbg.writerPool 직접 참조)는 호출처가 전무해져 삭제했다.

**원칙: 프록시에서 pool을 직접 참조하는 코드는 0이어야 한다.** 모든 Release/Discard는 Acquire 시점의 스냅샷으로 간다.

---

## 소견 2: Extended cache 키가 result format과 partial fetch 무시 (High)

### 문제

P47에서 `$N` 파라미터가 있는 쿼리를 캐시에서 제외했다. 하지만 파라미터가 없는 prepared statement도 **Bind의 result format codes**와 **Execute의 maxRows**에 따라 다른 응답을 만든다:

```
Client A: Parse("SELECT 1") → Bind(resultFormat=text)  → Execute(maxRows=0)
Client B: Parse("SELECT 1") → Bind(resultFormat=binary) → Execute(maxRows=0)
```

같은 SQL이지만 A는 text `'1'`, B는 binary `\x00\x00\x00\x01`을 기대한다. 캐시 키가 SQL 텍스트만 사용하므로 A의 응답이 B에게 반환될 수 있다.

partial fetch(maxRows≠0)도 마찬가지다:

```
Execute(maxRows=1)  → DataRow 1건 + PortalSuspended
Execute(maxRows=0)  → DataRow 전체 + CommandComplete
```

### 수정

캐시 키를 복잡하게 만드는 대신, **non-default 설정을 사용하는 배치는 캐싱에서 제외**:

```go
func hasBinaryFormatOrPartialFetch(buf []*protocol.Message) bool {
    for _, m := range buf {
        switch m.Type {
        case protocol.MsgBind:
            detail, err := protocol.ParseBindMessageFull(m.Payload)
            if err != nil {
                return true // parse 실패 → 안전하게 캐시 제외
            }
            for _, fc := range detail.ResultFormatCodes {
                if fc != 0 { // 0 = text, 1 = binary
                    return true
                }
            }
        case protocol.MsgExecute:
            // Execute: portal_name\0 + int32(maxRows)
            idx := bytes.IndexByte(m.Payload, 0)
            if idx >= 0 && idx+5 <= len(m.Payload) {
                maxRows := binary.BigEndian.Uint32(m.Payload[idx+1 : idx+5])
                if maxRows != 0 {
                    return true
                }
            }
        }
    }
    return false
}
```

캐싱 조건이 이제 3중 가드다:

```go
cacheable := !hasParameterPlaceholders(buf) &&
             !hasBinaryFormatOrPartialFetch(buf)
```

1. `$N` 파라미터 없음 (P47)
2. binary result format 없음 (이번)
3. partial fetch 없음 (이번)

대부분의 ORM/드라이버는 text format + full fetch를 기본으로 사용하므로 캐시 적중률 영향은 최소한이다.

---

## 소견 3: Extended read cache 에러 시 깨진 연결 Release (Medium)

### 문제

`handleExtendedRead()`의 cache-enabled 분기:

```go
collected, err := s.relayAndCollect(clientConn, rConn)
// ...
rPool.Release(rConn)  // ← 에러 확인 전에 Release!
if err != nil {
    dbg.balancer.MarkUnhealthy(readerAddr)
    return fmt.Errorf(...)
}
```

`relayAndCollect()`가 backend read 실패나 client write 실패를 반환해도, 연결 상태가 불명확한 채로 pool에 복귀한다. 다음 Acquire에서 이 연결을 받으면 프로토콜 desync가 발생할 수 있다.

같은 함수의 non-cache 경로와 `handleReadQueryTraced()`는 에러 시 `Discard()` 처리:

```go
// query_read.go — 올바른 패턴
if err != nil {
    rPool.Discard(rConn)  // ← 에러 시 Discard
    // ...
}
rPool.Release(rConn)      // ← 성공 시에만 Release
```

### 수정

에러 확인을 Release 앞으로 이동:

```go
collected, err := s.relayAndCollect(clientConn, rConn)
// ...
if err != nil {
    rPool.Discard(rConn)  // 깨진 연결은 버린다
    dbg.balancer.MarkUnhealthy(readerAddr)
    return fmt.Errorf(...)
}
rPool.Release(rConn)      // 성공 시에만 pool 복귀
```

---

## 소견 4: Pool.Acquire close race (Medium)

### 문제

`Acquire()`에서 `numOpen++` → `Unlock()` → `newConn()` 사이에 `Close()`가 개입할 수 있다:

```
Goroutine A (Acquire)        Goroutine B (Close)
─────────────────────        ──────────────────
p.numOpen++ (10→11)
p.mu.Unlock()
                             p.mu.Lock()
                             p.closed = true
                             // idle conn 정리
                             p.mu.Unlock()
conn, _ := p.newConn()
return conn, nil             // ← 닫힌 pool에서 live conn 탈출!
```

P47에서 `Release()`에 `p.closed` 체크를 추가했으므로, 이 conn이 Release되면 닫히긴 한다. 하지만 그 전까지 caller는 **정상 연결인 줄 알고** 사용한다.

### 수정

`newConn()` 성공 후 closed 상태를 재확인:

```go
if p.numOpen < p.cfg.MaxConnections {
    p.numOpen++
    p.mu.Unlock()

    conn, err := p.newConn()
    if err != nil {
        p.mu.Lock()
        p.numOpen--
        p.mu.Unlock()
        return nil, err
    }

    // Re-check: Close() may have run while we were dialing.
    p.mu.Lock()
    if p.closed {
        p.numOpen--
        p.mu.Unlock()
        conn.Close()
        return nil, ErrPoolClosed
    }
    p.mu.Unlock()

    return conn, nil
}
```

race window가 `newConn()` 동안(수 ms~수십 ms TCP dial)에서 **lock 재확인까지**(sub-μs)로 줄어든다. 완전 제거는 아니지만, lock을 잡은 채로 dial하면 전체 pool이 블로킹되므로 이 trade-off가 합리적이다.

---

## 소견 5: executeSynthesizedQuery — boundWriter write 실패 시 discard 누락 (Medium)

### 문제

```go
if err := protocol.WriteMessage(wConn, protocol.MsgQuery, queryPayload); err != nil {
    ct.clear()
    if acquired {
        discardToPool(wConn, acquiredPool)
    }
    // ← !acquired (boundWriter 사용 중) 경로: 아무것도 안 함!
    return fmt.Errorf("send synthesized query: %w", err)
}
```

boundWriter에 write가 실패하면 연결이 깨진 상태인데, discard하지 않고 그대로 둔다. `relayQueries()`의 다음 루프에서 이 깨진 boundWriter로 다시 쿼리를 보내면 연쇄 실패가 발생하고, 최종적으로 defer의 cleanup이 처리할 때까지 모든 쿼리가 실패한다.

### 수정

```go
if acquired {
    discardToPool(wConn, acquiredPool)
} else {
    discardToPool(wConn, *boundWriterPool)
    *boundWriter = nil
    *boundWriterPool = nil
}
```

boundWriter를 nil로 설정하면 다음 쿼리에서 `acquireWriterConn()`이 새 연결을 할당한다.

---

## 소견 6: Extended/Synthesized read에 circuit breaker 누락 (Low)

### 문제

`handleReadQueryTraced()`(simple-query read 경로)에는 reader circuit breaker가 완전히 통합되어 있다:

```go
// query_read.go — 정상
if cb, ok := dbg.ReaderCB(readerAddr); ok {
    if err := cb.Allow(); err != nil {
        return s.fallbackToWriter(...)
    }
}
// ...
cb.RecordSuccess()  // 성공
cb.RecordFailure()  // 실패
```

하지만 `handleExtendedRead()`와 `handleSynthesizedRead()`에는 CB 체크가 전혀 없다. reader가 장애 상태여도 extended/synthesized 쿼리는 CB를 우회하여 실패한 reader에 계속 시도한다.

### 수정

두 함수 모두에 CB Allow/RecordSuccess/RecordFailure를 추가:

```go
// handleExtendedRead — CB check 추가
if cb, ok := dbg.ReaderCB(readerAddr); ok {
    if err := cb.Allow(); err != nil {
        slog.Warn("reader circuit breaker open for extended query", "addr", readerAddr)
        return fallbackToWriter()
    }
}

// ... 성공 경로
if cb, ok := dbg.ReaderCB(readerAddr); ok {
    cb.RecordSuccess()
}

// ... 에러 경로마다
if cb, ok := dbg.ReaderCB(readerAddr); ok {
    cb.RecordFailure()
}
```

`handleSynthesizedRead()`도 동일하게 적용. 이제 3개 read 경로(simple, extended, synthesized) 모두 CB가 일관되게 작동한다.

---

## 교훈

3차 QA에서 드러난 패턴:

1. **수정 범위의 착각** — P47에서 `boundWriterPool`을 도입했지만 simple-query 트랜잭션 경로에만 적용하고 fallback 경로를 놓쳤다. 같은 패턴(`dbg.writerPool` 직접 접근)을 프로젝트 전체에서 grep하는 습관이 필요하다.
2. **캐시 불변량의 점진적 확장** — 1차에서 extended cache를 추가하고, 2차에서 `$N` 파라미터를 제외하고, 3차에서 binary format/partial fetch를 제외했다. 캐시 키의 완전성은 **처음부터 모든 입력 차원을 나열**해야 안전하다.
3. **에러 경로의 일관성** — 같은 함수 안에서 cache path는 Release, non-cache path는 Discard. 이런 비대칭은 코드 리뷰에서도 놓치기 쉽다.
4. **안전장치의 대칭성** — CB가 simple-query에만 있고 extended/synthesized에 없는 것은 기능 추가 시 **모든 read 경로를 체크리스트로 관리**하지 않으면 반복된다.

---

## 마무리

이번 글에서 수정한 것:

- fallback 4개 경로에서 writer pool 소유권 추적 완성
- extended cache에 binary format/partial fetch 가드 추가
- 깨진 reader 연결이 pool로 복귀하는 버그 수정
- Pool.Acquire에서 close race 방지
- boundWriter write 실패 시 discard + nil 처리
- extended/synthesized read에 circuit breaker 일관성 확보

3번의 QA를 거치면서 커넥션 풀 관련 안전장치가 상당히 촘촘해졌다. 특히 hot-reload 시나리오에서의 pool 소유권 문제는 이제 **모든 writer 접근 경로**에서 캡처 패턴이 적용되었다.
