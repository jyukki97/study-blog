---
title: "Go로 PostgreSQL 프록시 만들기 (64) - Active Session Dashboard"
date: 2026-03-18
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Admin API", "Session Management"]
categories: ["Database"]
project: "pgmux"
description: "운영 중인 모든 클라이언트 세션을 실시간으로 조회하고, 문제 세션의 쿼리를 즉시 취소하는 Admin API를 구현한다. sync.Map 기반 세션 레지스트리, cancelTarget 재활용, SQL Redaction 적용까지."
---

## 들어가며

PostgreSQL을 운영하다 보면 "지금 누가 뭘 하고 있는지" 보고 싶을 때가 많다. `pg_stat_activity`가 그 역할이지만, pgmux는 프록시 레벨에서 동작하므로 백엔드 커넥션이 풀링되어 `pg_stat_activity`만으로는 **어떤 클라이언트가 어떤 쿼리를 보냈는지** 추적하기 어렵다.

Active Session Dashboard는 프록시가 관리하는 **모든 클라이언트 세션**의 실시간 스냅샷을 제공한다:

- `GET /admin/sessions` — 세션 목록 (ID, 클라이언트 IP, 사용자, DB, 연결 시각, 현재 쿼리, 백엔드 주소, 트랜잭션/핀 상태)
- `POST /admin/sessions/{id}/cancel` — 특정 세션의 활성 쿼리 취소

---

## 설계

### 세션 레지스트리

각 클라이언트 연결은 `handleConn`에서 시작하고 끝난다. 이 생명주기에 맞춰 세션을 등록/해제한다.

```
Accept → handleConn → [Auth] → registerSession → relayQueries → unregisterSession → Close
```

레지스트리는 `sync.Map`을 사용한다. 읽기(admin 조회)가 쓰기(세션 등록/해제)보다 훨씬 빈번하고, 키 집합이 안정적인 패턴이라 `sync.Map`이 적합하다.

### backendAddr: cancelTarget 재활용

세션이 쿼리를 실행하는 동안 어떤 백엔드에 연결되어 있는지가 중요하다. 이미 `cancelTarget`이 `setFromConn`/`clear`로 백엔드 주소를 정확히 추적하고 있었다.

처음에는 `SessionInfo`에 별도 `backendAddr` 필드를 두고 쿼리 시작/종료마다 업데이트하려 했다. 코드 리뷰에서 이 접근의 문제를 발견했다:

1. 쿼리 시작 시점에는 아직 커넥션을 획득하지 않아 주소를 모른다
2. Reader 경로는 `handleReadQueryTraced` 내부에서 주소가 결정되므로 호출자가 알 수 없다
3. Extended Query의 다양한 경로(boundReader, boundWriter, 신규 획득)마다 주소 설정이 필요하다

**해결: cancelTarget에서 직접 파생**

```go
func (si *SessionInfo) Snapshot() SessionSnapshot {
    si.mu.RLock()
    snap := SessionSnapshot{...}  // 쿼리, 트랜잭션 등 복사
    si.mu.RUnlock()

    // 백엔드 주소는 cancelTarget에서 파생 (자체 mutex 보호)
    if si.ct != nil {
        addr, _, _ := si.ct.get()
        snap.BackendAddr = addr
    }
    return snap
}
```

`ct`는 생성 후 불변이므로 세션 락 없이 접근한다. `ct.get()`은 자체 mutex로 보호된다. 쿼리 실행 중에는 주소가 있고, 유휴 상태에서는 빈 문자열이다 — `pg_stat_activity`와 동일한 의미론이다.

---

## 핵심 구현

### SessionInfo 구조체

```go
type SessionInfo struct {
    mu             sync.RWMutex
    ID             uint32        // proxyPID (고유)
    ClientAddr     string        // 클라이언트 IP:port
    User           string
    Database       string
    ConnectedAt    time.Time
    currentQuery   string        // 현재 실행 중인 SQL
    queryStartedAt time.Time     // 쿼리 시작 시각
    inTransaction  bool
    pinned         bool
    pinnedReason   string
    ct             *cancelTarget // immutable after construction
}
```

불변 필드(ID, ClientAddr, User, Database, ConnectedAt, ct)는 생성 시 설정하고 이후 변경하지 않는다. 가변 필드(currentQuery, queryStartedAt, inTransaction 등)만 `RWMutex`로 보호한다.

### 쿼리 상태 추적

`relayQueries`의 Simple Query와 Extended Query(Sync) 양쪽에 훅을 건다:

```go
// Simple Query
si.SetQueryState(query)         // 쿼리 시작
// ... 실행 ...
si.ClearQueryState()            // 쿼리 종료
si.SetTransactionState(session.InTransaction(), session.Pinned(), session.PinnedReason())

// Extended Query (Sync)
si.SetQueryState(extQueryText)  // 배치 시작
// ... 실행 ...
si.ClearQueryState()            // 배치 종료
si.SetTransactionState(...)
```

### 세션 취소

기존 CancelRequest 메커니즘을 그대로 재활용한다:

```go
func (s *Server) CancelSession(id uint32) (found, cancelled bool) {
    val, ok := s.sessions.Load(id)
    if !ok { return false, false }

    si := val.(*SessionInfo)
    ct := si.ct  // immutable — no lock
    addr, bPID, bSecret := ct.get()
    if addr == "" || bPID == 0 {
        return true, false  // 실행 중인 쿼리 없음
    }
    if err := forwardCancel(addr, bPID, bSecret); err != nil {
        slog.Warn("session cancel forward failed", "session_id", id, "error", err)
        return true, false
    }
    return true, true
}
```

PostgreSQL CancelRequest 프로토콜을 사용하므로 백엔드가 실제로 쿼리를 취소한다.

---

## Admin API 엔드포인트

### GET /admin/sessions

```bash
curl -H "Authorization: Bearer admin-key" http://localhost:9091/admin/sessions
```

```json
{
  "sessions": [
    {
      "id": 1,
      "client_addr": "192.168.1.10:54321",
      "user": "app_user",
      "database": "mydb",
      "connected_at": "2026-03-18T10:30:00Z",
      "current_query": "SELECT * FROM users WHERE id = $1",
      "query_started_at": "2026-03-18T10:35:42.123Z",
      "backend_addr": "10.0.0.1:5432",
      "in_transaction": false,
      "pinned": false
    },
    {
      "id": 2,
      "client_addr": "192.168.1.20:54322",
      "user": "admin_user",
      "database": "mydb",
      "connected_at": "2026-03-18T10:20:00Z",
      "in_transaction": true,
      "pinned": true,
      "pinned_reason": "LISTEN"
    }
  ]
}
```

- 세션 목록은 **ID 오름차순**으로 정렬된다 (`sync.Map` 순회 순서 비결정적이므로)
- `current_query`에는 `observability.sql_redaction` 정책이 적용된다
- 유휴 세션의 `current_query`, `query_started_at`, `backend_addr`는 omitempty로 생략

### POST /admin/sessions/{id}/cancel

```bash
curl -X POST -H "Authorization: Bearer admin-key" \
  http://localhost:9091/admin/sessions/1/cancel
```

| 상황 | 응답 코드 | 응답 |
|------|-----------|------|
| 취소 성공 | 200 | `{"status": "cancelled"}` |
| 실행 중인 쿼리 없음 | 200 | `{"status": "no_active_query", "message": "..."}` |
| 세션 없음 | 404 | `{"error": "session not found"}` |
| 잘못된 경로 | 400 | `{"error": "invalid path, expected /admin/sessions/{id}/cancel"}` |

### 권한

| 엔드포인트 | 필요 역할 |
|-----------|----------|
| GET /admin/sessions | viewer |
| POST /admin/sessions/{id}/cancel | admin |

---

## SQL Redaction 적용

`current_query`는 실행 중인 원본 SQL을 담고 있다. Admin API 응답으로 내보내기 전에 `observability.sql_redaction` 정책을 적용한다:

```go
if redactFn != nil {
    if snapshots, ok := sessions.([]proxy.SessionSnapshot); ok {
        for i := range snapshots {
            if snapshots[i].CurrentQuery != "" {
                snapshots[i].CurrentQuery = redactFn(snapshots[i].CurrentQuery)
            }
        }
    }
}
```

- `none`: 원본 SQL 그대로 노출
- `literals` (기본): `SELECT * FROM users WHERE password = $1`
- `full`: `[fingerprint:abc123]`

프록시 내부 라우팅/캐싱에는 원본 SQL을 사용하므로 기능에 영향 없다.

---

## 코드 리뷰에서 발견한 이슈 3건

| 심각도 | 이슈 | 수정 |
|--------|------|------|
| **Critical** | `backendAddr` 항상 빈 문자열 | cancelTarget에서 직접 파생으로 변경 |
| **Major** | `CancelSession`이 `forwardCancel` 에러를 삼킴 | `slog.Warn` 추가 |
| **Minor** | `QueryStartedAt`이 `string` (RFC3339 초 단위) | `*time.Time`으로 변경, ConnectedAt과 일관성 확보 |

Critical은 모든 경로(Simple/Extended/Reader/Writer)에서 `backend_addr`가 항상 빈 값으로 나오는 버그였다. 기존 `cancelTarget`이 이미 정확한 주소를 추적하고 있었으므로, 중복 추적 대신 파생으로 전환하여 문제를 해결했다.

---

## 테스트

17개 테스트로 커버:

**proxy 패키지 (7건)**
- SetQueryState / ClearQueryState 상태 전이
- cancelTarget에서 backendAddr 파생
- 트랜잭션/핀 상태 업데이트
- 세션 레지스트리 CRUD + ID 정렬
- CancelSession (미존재, 쿼리 없음)
- 동시성 접근 (race detector)

**admin 패키지 (10건)**
- 빈 세션 목록, 활성 세션 응답 형식
- SQL Redaction 적용
- MethodNotAllowed, NotConfigured
- Cancel 성공/NotFound/NoActiveQuery
- 잘못된 경로 형식

---

## 마치며

기존에 구현해둔 `cancelTarget`(CancelRequest 프로토콜)을 세션 대시보드에 재활용한 것이 이번 작업의 핵심이다. 쿼리 실행 중 백엔드 주소를 정확히 추적하는 메커니즘이 이미 있었으므로, 새로 만들 필요 없이 Snapshot에서 파생하는 것만으로 충분했다.

코드 리뷰에서 `backendAddr`가 항상 빈 값인 Critical 버그를 잡은 것도 의미가 있다. 처음 구현에서는 "쿼리 시작 시 주소를 함께 전달"하려 했지만, 커넥션 획득은 쿼리 분류 후에 일어나므로 시점이 맞지 않았다. 이미 존재하는 인프라를 재활용하는 것이 새로 만드는 것보다 정확하고 유지보수 비용도 낮다.

다음은 **Per-User Rate Limiting**으로 멀티테넌트 환경의 noisy neighbor 문제를 해결할 예정이다.
