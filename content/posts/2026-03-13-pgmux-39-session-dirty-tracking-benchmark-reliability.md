---
title: "Go로 PostgreSQL 프록시 만들기 (39) - DISCARD ALL 최적화와 벤치마크 신뢰성"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Performance", "Connection Pool", "Benchmark"]
categories: ["Database"]
project: "pgmux"
description: "세션 상태 추적으로 불필요한 DISCARD ALL을 건너뛰고, RouteWithTxState로 lock 횟수를 줄이고, 벤치마크 방법론을 개선한다."
---

## 들어가며

[이전 글](/posts/2026-03-13-pgmux-38-pprof-optimization-transparency/)에서 pprof 기반 최적화와 투명 프록시의 경계를 다뤘다. 이번 글에서는 같은 PR에서 진행한 나머지 개선사항을 다룬다:

1. **DISCARD ALL 건너뛰기** — 세션 상태를 변경하지 않은 커넥션은 리셋 없이 풀에 반환
2. **RouteWithTxState** — 라우팅 시 3회 lock을 1회로 통합
3. **fallbackToWriter 에러 처리** — reader 전원 다운 시 writer fallback의 정리 로직 개선
4. **벤치마크 스크립트 신뢰성** — warmup, 다회 평균, CHECKPOINT 동기화

---

## DISCARD ALL 건너뛰기

### 문제

Transaction Pooling에서 커넥션을 풀에 반환할 때, 이전 세션 상태(SET 변수, PREPARE문 등)를 정리하기 위해 `DISCARD ALL`을 보낸다. 이것은 쿼리 하나를 추가로 실행하는 것과 같다.

하지만 대부분의 쿼리는 세션 상태를 변경하지 않는다. `SELECT * FROM users WHERE id = 1`은 어떤 세션 상태도 남기지 않는다. 이런 쿼리 후에도 매번 `DISCARD ALL`을 보내는 것은 낭비다.

### 해법: connDirty 플래그

`relayQueries`에 `connDirty` 불리언 플래그를 추가했다. 세션을 변경하는 쿼리(SET, PREPARE, LISTEN, CREATE TEMP 등)가 실행될 때만 true로 설정한다:

```go
func (s *Server) relayQueries(ctx context.Context, clientConn net.Conn, ...) {
    var boundWriter *pool.Conn
    var connDirty bool // 세션 변경 여부 추적

    defer func() {
        if boundWriter != nil {
            if connDirty {
                s.resetAndReleaseWriter(boundWriter, dbg) // DISCARD ALL + Release
            } else {
                s.releaseWriterFast(boundWriter, dbg)     // Release만 (리셋 건너뜀)
            }
        }
    }()
    // ...
}
```

### isSessionModifying — 세션 변경 쿼리 감지

AST 파서를 사용하지 않고, 첫 키워드만 보고 판별하는 zero-allocation 함수를 작성했다:

```go
func isSessionModifying(query string) bool {
    // leading whitespace 건너뛰기
    // ...
    ch := rest[0] | 0x20 // 소문자로 변환 (ASCII)
    switch ch {
    case 's': // SET (단, SET LOCAL / SET TRANSACTION 제외)
        if eqFold3(rest, "SET") {
            // "SET LOCAL" → transaction-scoped → false
            // "SET TRANSACTION" → transaction-scoped → false
            // 그 외 SET → true
        }
    case 'p': return PREPARE
    case 'd': return DECLARE, DEALLOCATE
    case 'l': return LISTEN, LOAD
    case 'u': return UNLISTEN
    case 'c': return CREATE TEMP / CREATE TEMPORARY
    }
    return false
}
```

핵심 설계 결정:

1. **SET LOCAL과 SET TRANSACTION은 false** — 이들은 트랜잭션이 끝나면 자동으로 사라진다. `DISCARD ALL`이 필요 없다.
2. **바이트 레벨 비교** — `strings.ToUpper`를 피하고 `|0x20` 비트 연산으로 대소문자 비교. 매 쿼리마다 호출되므로 allocation이 없어야 한다.
3. **false negative보다 false positive이 안전** — 미탐지된 세션 변경 쿼리가 있으면 커넥션 오염이 발생한다. 반대로 과탐지는 불필요한 `DISCARD ALL`을 보낼 뿐, 정확성에 영향이 없다.

### 적용 지점

dirty 추적은 세 곳에서 사용된다:

```go
// 1. 쿼리 실행 후 — 세션 변경 감지
if isSessionModifying(query) {
    connDirty = true
}

// 2. 트랜잭션 종료 시 (COMMIT/ROLLBACK) — dirty 여부로 분기
if connDirty {
    s.resetAndReleaseWriter(wConn, dbg) // DISCARD ALL
} else {
    s.releaseWriterFast(wConn, dbg)     // 바로 Release
}
connDirty = false

// 3. 단일 문장 (트랜잭션 밖) — 즉시 Release 여부
if connDirty || isSessionModifying(query) {
    s.resetAndReleaseWriter(wConn, dbg)
    connDirty = false
} else {
    s.releaseWriterFast(wConn, dbg)
}
```

`releaseWriterFast`는 단순히 `pool.Release(conn)`을 호출한다. `resetAndReleaseWriter`는 `DISCARD ALL` 쿼리를 보낸 뒤 Release한다. 대부분의 읽기 쿼리에서 DISCARD ALL 왕복이 사라진다.

---

## RouteWithTxState — 3-lock을 1-lock으로

### 문제

기존 쿼리 루프에서 라우팅과 트랜잭션 상태 확인이 분리되어 있었다:

```go
// Before: 3회 lock 획득
wasInTx := session.InTransaction()    // Lock #1
route := session.Route(query)          // Lock #2
nowInTx := session.InTransaction()    // Lock #3
```

`Session`은 모든 메서드가 `mu.Lock()`을 잡는다. 쿼리당 3회의 mutex 획득/해제는 불필요하다.

### 해법: 단일 lock으로 통합

```go
// router/router.go
func (s *Session) RouteWithTxState(query string) (route Route, wasInTx, nowInTx bool) {
    s.mu.Lock()
    wasInTx = s.inTransaction
    route = s.routeQueryLocked(query) // lock 없이 내부 로직 실행
    nowInTx = s.inTransaction         // Route가 BEGIN/COMMIT을 처리한 후의 상태
    s.mu.Unlock()
    return
}
```

호출부가 깔끔해진다:

```go
// After: 1회 lock
route, wasInTx, nowInTx := session.RouteWithTxState(query)
```

쿼리당 2회의 불필요한 lock 연산이 제거된다. 동시성 50개 고루틴에서 mutex contention 감소 효과가 있다.

---

## fallbackToWriter 에러 처리

reader가 전부 다운되면 write 풀에서 커넥션을 빌려 읽기 쿼리를 실행하는 `fallbackToWriter`가 있다. 기존에는 에러 발생 시 커넥션을 그냥 Release해서, 오염된 커넥션이 풀에 들어갈 수 있었다:

```go
// Before
err = s.forwardAndRelay(clientConn, wConn, msg)
s.releaseWriterFast(wConn, dbg) // 에러가 있어도 Release

// After
err = s.forwardAndRelay(clientConn, wConn, msg)
ct.clear()
if err != nil {
    dbg.writerPool.Discard(wConn) // 에러 시 Discard (커넥션 폐기)
} else {
    s.releaseWriterFast(wConn, dbg) // 성공 시에만 Release
}
```

읽기 전용 fallback이므로 세션 상태를 변경하지 않는다. 따라서 성공 시 `releaseWriterFast`(DISCARD ALL 건너뜀)를 사용한다.

---

## 벤치마크 스크립트 신뢰성

### 기존 문제

이전 벤치마크 스크립트는 단일 실행의 TPS를 보고했다. 문제:

1. **콜드 스타트 효과** — 첫 실행은 PostgreSQL 캐시가 차갑다
2. **실행 간 편차** — 같은 설정에서도 ±10% 편차가 흔하다
3. **WAL 압력** — TPC-B 후 WAL이 쌓여서 다음 벤치마크에 영향

### 개선

`bench-compare.sh`를 전면 재작성했다:

```bash
ROUNDS=${BENCH_ROUNDS:-3}        # 3회 평균
WARMUP_DURATION=${BENCH_WARMUP:-5} # 5초 warmup (결과 버림)

run_pgbench() {
    # 1. Warmup round (결과 폐기)
    run_pgbench_single "$host" "$port" "$clients" "$mode" "$WARMUP_DURATION" >/dev/null

    # 2. N-round 평균
    for r in $(seq 1 "$ROUNDS"); do
        result=$(run_pgbench_single "$host" "$port" "$clients" "$mode" "$DURATION")
        # tps_sum, lat_sum 누적
    done
    # avg = sum / ok_rounds
}
```

추가 개선:
- **CHECKPOINT 삽입**: SELECT-only와 TPC-B 사이에 `CHECKPOINT`를 실행해서 WAL flush를 강제한다
- **Docker Compose 설정**: `max_connections=200`으로 c=100 벤치마크에서 커넥션 부족 방지
- **결과 파싱 분리**: `tmpfile`에 pgbench 출력을 저장한 뒤 grep으로 TPS/latency를 추출. 파이프라인 실패 시 "error"로 처리

이전에는 한 번의 측정값에 의존했지만, 이제는 warmup으로 캐시를 데우고 3회 평균으로 편차를 줄인다. 결과의 재현성이 크게 향상됐다.

---

## 마무리

이번 글에서 다룬 최적화들은 눈에 띄는 TPS 향상보다는 **정확성과 효율성**에 초점을 맞췄다:

1. **DISCARD ALL 건너뛰기** — 대부분의 쿼리에서 불필요한 왕복을 제거. 커넥션 풀의 throughput 개선
2. **RouteWithTxState** — 쿼리당 lock 3회 → 1회. 고동시성에서 mutex contention 감소
3. **fallbackToWriter Discard** — 에러 시 오염된 커넥션이 풀로 돌아가는 것을 방지
4. **벤치마크 warmup + 다회 평균** — 측정의 신뢰성 확보

이전 글의 pprof 최적화(atomic.Pointer, ReadMessageReuse, wire buffer 재사용)와 합치면, 이번 PR은 **할당 감소**, **lock 감소**, **불필요한 쿼리 제거**, **에러 경로 안전성**을 모두 다룬 것이다. 성능 최적화는 hot path만이 아니라 이런 세부 경로에서도 누적된다.
