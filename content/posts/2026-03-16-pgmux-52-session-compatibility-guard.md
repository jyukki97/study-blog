---
title: "Go로 PostgreSQL 프록시 만들기 (52) - Session Compatibility Guard"
date: 2026-03-16
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Session Pinning", "Connection Pooling"]
categories: ["Database"]
project: "pgmux"
description: "Transaction pooling 환경에서 LISTEN, 세션 SET, DECLARE CURSOR 같은 세션 의존 기능을 감지하고, block/warn/pin 모드로 제어하는 Session Compatibility Guard를 구현한다."
---

## 들어가며

Transaction pooling의 핵심은 커넥션 공유다. 쿼리가 끝나면 커넥션을 풀에 반환하고, 다음 쿼리는 다른 커넥션을 받을 수 있다. `DISCARD ALL`로 세션 상태를 초기화하면 대부분의 경우 문제가 없다.

하지만 PostgreSQL에는 **커넥션에 종속된 기능**이 있다. `LISTEN`으로 등록한 알림 채널, `DECLARE`로 선언한 커서, 세션 레벨 `SET`으로 변경한 파라미터 — 이런 것들은 커넥션이 바뀌면 사라진다. Transaction pooling 환경에서 이런 기능을 사용하면 **조용히 깨진다**.

PgBouncer는 이 문제를 문서에 경고하는 것으로 끝낸다. pgmux는 한 걸음 더 나아가 **감지 → 제어**까지 한다.

---

## 세션 의존 기능이 왜 위험한가

Transaction pooling에서 커넥션 수명은 "쿼리 단위" 또는 "트랜잭션 단위"다. 하지만 아래 기능들의 수명은 "세션(커넥션) 단위"다:

| 기능 | 위험 | 예시 |
|------|------|------|
| `LISTEN`/`UNLISTEN` | 알림 채널이 커넥션에 바인딩. 다른 커넥션으로 바뀌면 알림 수신 불가 | `LISTEN order_events` |
| 세션 `SET` | 파라미터가 커넥션에 적용. 다음 쿼리가 다른 커넥션을 받으면 설정이 사라짐 | `SET statement_timeout = '5s'` |
| `DECLARE CURSOR` | 커서가 커넥션에 바인딩. 다른 커넥션에서 `FETCH` 불가 | `DECLARE c CURSOR FOR SELECT ...` |
| `PREPARE` | Prepared statement가 커넥션에 바인딩 | `PREPARE p AS SELECT $1` |
| `CREATE TEMP TABLE` | 임시 테이블이 커넥션에 바인딩 | `CREATE TEMP TABLE tmp (...)` |
| Advisory Lock (세션) | 잠금이 커넥션에 바인딩. 풀에 반환되면 다른 클라이언트가 잠금을 상속 | `SELECT pg_advisory_lock(42)` |

이 중 `SET LOCAL`, `SET TRANSACTION`, `pg_advisory_xact_lock` 같은 **트랜잭션 스코프** 변형은 트랜잭션 종료 시 자동 해제되므로 안전하다. 구분이 중요하다.

---

## 설계: 4가지 모드

```yaml
session_compatibility:
  enabled: true
  mode: "warn"   # "block" | "warn" | "pin" | "allow"
```

| 모드 | 동작 | 용도 |
|------|------|------|
| `block` | 에러 반환, 쿼리 거부 | 세션 의존 기능 완전 차단 |
| `warn` | 경고 로그 + 메트릭, 쿼리는 정상 실행 | 모니터링 단계 (기본값) |
| `pin` | 세션을 Writer에 고정, 커넥션을 세션 수명 동안 유지 | 호환성 보장 |
| `allow` | 무동작 | 기능 비활성화 |

`warn`으로 시작해서 어떤 애플리케이션이 세션 의존 기능을 쓰는지 파악한 뒤, `pin`이나 `block`으로 전환하는 운영 패턴을 상정했다.

---

## 감지 구현: 하이브리드 전략

### 문자열 기반 (Fast Path)

기존 `isSessionModifying()`과 동일한 패턴이다. 첫 번째 키워드를 바이트 레벨로 비교한다:

```go
func detectSingleStmtDependency(query string) SessionDependencyResult {
    // Skip leading whitespace
    i := 0
    for i < len(query) && (query[i] == ' ' || query[i] == '\t' || ...) {
        i++
    }
    rest := query[i:]
    ch := rest[0] | 0x20 // lowercase

    switch ch {
    case 'l': // LISTEN
        if n >= 6 && eqFold6(rest, "LISTEN") && ... {
            return SessionDependencyResult{Detected: true, Feature: FeatureListen}
        }
    case 's': // SET (not SET LOCAL / SET TRANSACTION)
        if n >= 4 && eqFold3(rest, "SET") && ... {
            // SET LOCAL → safe (transaction-scoped)
            // SET TRANSACTION → safe
            // 나머지 SET → session-scoped
        }
    // ...
    }
}
```

`SET LOCAL`과 `SET TRANSACTION`은 트랜잭션 스코프이므로 건너뛴다. `strings.ToUpper` 없이 `|0x20` 비트 연산으로 case-insensitive 비교를 한다.

### Advisory Lock: 부분 문자열 매치

Advisory lock은 `SELECT pg_advisory_lock(42)` 형태로 쿼리 중간에 나타난다. 첫 키워드 비교로는 잡을 수 없다. 여기서 핵심 관찰:

```
pg_advisory_lock       → 세션 스코프 (위험)
pg_advisory_xact_lock  → 트랜잭션 스코프 (안전)
pg_try_advisory_lock   → 세션 스코프 (위험)
```

`"advisory_lock"`이라는 부분 문자열은 `pg_advisory_lock`과 `pg_try_advisory_lock`에는 존재하지만, `pg_advisory_xact_lock`에는 **존재하지 않는다** (`advisory_` 뒤에 `xact_`가 끼어 있으므로). 이 속성 덕분에 단순 `Contains` 하나로 세션/트랜잭션 스코프를 정확히 구분한다:

```go
func containsSessionAdvisoryLock(query string) bool {
    lower := strings.ToLower(query)
    return strings.Contains(lower, "advisory_lock") ||
           strings.Contains(lower, "advisory_unlock")
}
```

### AST 기반 (정확한 감지)

`routing.ast_parser: true`일 때 `pg_query` AST를 사용한다. Statement 타입으로 정확하게 구분:

```go
func detectNodeDependency(node *pg_query.Node) SessionDependencyResult {
    switch n := node.GetNode().(type) {
    case *pg_query.Node_ListenStmt:
        return SessionDependencyResult{Detected: true, Feature: FeatureListen}
    case *pg_query.Node_VariableSetStmt:
        if n.VariableSetStmt.GetIsLocal() {
            return SessionDependencyResult{} // SET LOCAL — safe
        }
        return SessionDependencyResult{Detected: true, Feature: FeatureSessionSet}
    case *pg_query.Node_DeclareCursorStmt:
        return SessionDependencyResult{Detected: true, Feature: FeatureDeclare}
    case *pg_query.Node_CreateStmt:
        if rel := n.CreateStmt.GetRelation(); rel != nil {
            if rel.GetRelpersistence() == "t" { // TEMP
                return SessionDependencyResult{Detected: true, Feature: FeatureCreateTemp}
            }
        }
    // ...
    }
}
```

`VariableSetStmt.GetIsLocal()`은 `SET LOCAL`뿐 아니라 `SET TRANSACTION`도 `true`로 반환한다. PostgreSQL 파서가 `SET TRANSACTION`을 내부적으로 `SET LOCAL`로 처리하기 때문이다.

Advisory lock은 `FuncCall` 노드를 재귀 탐색해야 하므로 문자열 매치로 대신한다.

---

## Pin 모드: 커넥션 수명 관리

`pin` 모드가 가장 복잡하다. 단순히 라우팅을 Writer로 바꾸는 것으로는 부족하다 — **같은 커넥션을 유지**해야 한다.

### 라우팅 오버라이드

Session에 `pinned` 플래그를 추가하고, 라우팅 로직의 최상위에서 체크한다:

```go
func (s *Session) routeQueryLocked(query string) Route {
    // ... transaction state update ...

    if s.pinned || hasTxKeyword || s.inTransaction {
        return RouteWriter
    }
    // ... normal routing ...
}
```

한 번 `pinned`가 설정되면 세션이 끝날 때까지 모든 쿼리가 Writer로 간다.

### 커넥션 바인딩

핵심 변경은 `relayQueries()`의 커넥션 라이프사이클이다:

```go
// 핀된 세션: 커넥션을 세션 수명 동안 유지
case acquired:
    if sessionPinned {
        // 풀에서 꺼낸 커넥션을 반환하지 않고 바인딩
        boundWriter = wConn
        boundWriterPool = acquiredPool
    } else {
        releaseToPool(wConn, acquiredPool)
    }

case wasInTx && !nowInTx:
    // COMMIT/ROLLBACK
    if sessionPinned {
        // 트랜잭션이 끝나도 커넥션 유지
    } else {
        // 정상 해제
        boundWriter = nil
        releaseToPool(wConn, bwp)
    }
```

핀되기 전에는 쿼리마다 커넥션을 빌리고 반환했다. 핀 이후에는 `boundWriter`에 바인딩해서 클라이언트가 연결을 끊을 때까지 유지한다. `defer`에서 `DISCARD ALL`로 정리하므로 LISTEN 채널, 커서, 세션 변수가 깔끔하게 해제된다.

---

## Extended Query 경로

Simple Query뿐 아니라 Extended Query Protocol도 지원한다. Parse 메시지에서 쿼리 텍스트를 추출해 감지하고, Sync 시점에서 block 처리한다:

```go
case protocol.MsgParse:
    // ... register statement ...

    if sessCfg.Enabled {
        depResult := router.DetectSessionDependency(query)
        if depResult.Detected {
            switch sessCfg.Mode {
            case "block":
                extSessionBlocked = true
            case "pin":
                session.Pin(feature)
                extRoute = router.RouteWriter
            }
        }
    }

case protocol.MsgSync:
    if extSessionBlocked {
        s.sendError(clientConn, "session-dependent feature blocked: ...")
        s.sendReadyForQuery(clientConn, session.InTransaction())
        continue
    }
```

Read-only 모드 차단과 동일한 패턴이다. Parse에서 플래그를 세우고, Sync에서 일괄 처리한다.

---

## 메트릭

```
pgmux_session_dependency_detected_total{feature="listen"}     — 감지 횟수
pgmux_session_dependency_blocked_total{feature="listen"}      — 차단 횟수
pgmux_session_pinned_total{feature="listen"}                   — 핀 횟수
```

`feature` 레이블로 어떤 기능이 얼마나 사용되는지 파악할 수 있다. `warn` 모드에서 메트릭을 모니터링한 뒤 정책을 결정하는 운영 패턴에 적합하다.

---

## PgBouncer 비교

| | PgBouncer | pgmux |
|---|---|---|
| 감지 | 문서에 경고만 | 자동 감지 (문자열 + AST) |
| 대응 | 없음 (조용히 깨짐) | block / warn / pin / allow 선택 |
| Session pinning | 없음 | pin 모드에서 커넥션 고정 |
| Advisory lock 구분 | 없음 | 세션/트랜잭션 스코프 자동 구분 |
| 메트릭 | 없음 | feature별 감지/차단/핀 카운터 |

PgBouncer의 `transaction` pooling 모드에서 `LISTEN`을 사용하면 알림이 사라지지만, 에러도 경고도 없다. pgmux는 최소한 `warn` 모드에서 문제를 가시화하고, `pin` 모드에서는 안전하게 동작하도록 보장한다.

---

## 마무리

Session Compatibility Guard는 transaction pooling 프록시의 **안전벨트**다. 세션 의존 기능을 사용하는 애플리케이션을 프록시가 조용히 망가뜨리는 것이 아니라, 감지하고 알려주고 대응한다.

다음 글에서는 Phase 31의 나머지인 **SQL Redaction / Safe Observability** — audit log와 tracing에서 민감정보를 마스킹하는 기능을 다룬다.
