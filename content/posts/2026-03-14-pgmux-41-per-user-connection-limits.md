---
title: "Go로 PostgreSQL 프록시 만들기 (41) - Per-User/Per-DB 커넥션 제한"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Multi-Tenancy", "Connection Limits", "Observability"]
categories: ["Database"]
project: "pgmux"
description: "멀티테넌트 환경에서 특정 사용자가 커넥션 풀을 독점하지 못하도록 사용자별/DB별 커넥션 수를 제한하는 ConnTracker를 구현한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-40-sync-pool-allocation-optimization/)에서 sync.Pool을 활용한 할당 최적화를 마무리했다. 성능 최적화 Phase를 마치고, 이번에는 **프로덕션 운영**에 직결되는 기능을 추가한다.

멀티테넌트 환경에서 가장 흔한 문제 중 하나가 "한 사용자가 커넥션을 모두 잡아먹는" 상황이다. PostgreSQL 자체에도 `ALTER ROLE ... CONNECTION LIMIT`가 있지만, 프록시 레벨에서 제한하면:

1. **백엔드에 도달하기 전에 거부** — 불필요한 인증/핸드셰이크 비용 제거
2. **DB별로도 제한 가능** — Multi-DB 환경에서 DB 간 자원 격리
3. **Hot-reload** — 설정 변경 시 프록시 재시작 없이 즉시 반영
4. **관측성** — Prometheus 메트릭 + Admin API로 실시간 모니터링

---

## 설계: 어디서 제한할 것인가

`handleConn`의 흐름을 보자:

```
SSL Handshake → StartupMessage 파싱 → DB Group 해석 → ??? → 인증 → relayQueries
```

제한 체크의 위치가 중요하다. **인증 전**에 체크하면:
- 인증 핸드셰이크(MD5, SCRAM-SHA-256) 비용을 아낄 수 있다
- PostgreSQL도 `max_connections` 초과 시 인증 전에 거부한다
- 사용자명은 `StartupMessage`에서 이미 알 수 있다

```
SSL → StartupMessage → DB Group → **ConnTracker.TryAcquire** → 인증 → relayQueries
```

---

## ConnTracker 구현

### 자료구조

```go
type ConnTracker struct {
    mu         sync.Mutex
    byUser     map[string]int // username → active count
    byDB       map[string]int // database → active count
    userLimits map[string]int // username → max (per-user override)
    dbLimits   map[string]int // database → max (per-db override)
    defaultUser int           // 기본 사용자별 제한 (0 = 무제한)
    defaultDB   int           // 기본 DB별 제한 (0 = 무제한)
}
```

두 개의 카운터 맵(`byUser`, `byDB`)과 두 개의 제한 맵(`userLimits`, `dbLimits`)으로 구성된다.

### sync.Mutex vs RWMutex vs atomic

`TryAcquire`는 항상 **읽기와 쓰기를 동시에** 수행한다 — 카운터를 확인하고 증가시켜야 하므로. 그래서 `sync.RWMutex`는 의미가 없다(reader-only 경로가 없다).

`sync/atomic`도 검토했지만, 사용자 제한과 DB 제한을 **동시에 원자적으로** 체크해야 하므로 두 개의 atomic 값을 하나의 트랜잭션으로 묶을 수 없다.

결국 **단일 `sync.Mutex`가 정답**이다. 크리티컬 섹션이 map lookup + 정수 비교뿐이라 경합이 거의 없고, 커넥션 수립 자체가 TCP dial + TLS + 인증을 포함하므로 뮤텍스 비용은 무시할 수 있다.

### TryAcquire: Check-then-Increment

```go
func (ct *ConnTracker) TryAcquire(user, db string) (bool, string) {
    ct.mu.Lock()
    defer ct.mu.Unlock()

    // Check user limit
    userLimit := ct.defaultUser
    if l, ok := ct.userLimits[user]; ok {
        userLimit = l
    }
    if userLimit > 0 && ct.byUser[user] >= userLimit {
        return false, fmt.Sprintf(
            "too many connections for user %q (limit: %d)", user, userLimit)
    }

    // Check DB limit
    dbLimit := ct.defaultDB
    if l, ok := ct.dbLimits[db]; ok {
        dbLimit = l
    }
    if dbLimit > 0 && ct.byDB[db] >= dbLimit {
        return false, fmt.Sprintf(
            "too many connections for database %q (limit: %d)", db, dbLimit)
    }

    ct.byUser[user]++
    ct.byDB[db]++
    return true, ""
}
```

핵심은 **확인과 증가가 하나의 뮤텍스 안에서** 일어난다는 것이다. 만약 확인 후 뮤텍스를 풀고 다시 잡아서 증가시키면 TOCTOU(Time-of-Check to Time-of-Use) 레이스가 발생한다.

사용자 제한과 DB 제한 **둘 다 통과해야** 증가한다. 사용자 제한만 통과하고 DB 제한에서 거부되면 사용자 카운터도 증가하지 않는다.

### Release: defer로 안전하게

```go
// handleConn 내부
if s.connTracker != nil {
    ok, reason := s.connTracker.TryAcquire(username, dbName)
    if !ok {
        s.sendFatalWithCode(clientConn, "53300", reason)
        return
    }
    defer func() {
        s.connTracker.Release(username, dbName)
    }()
}
```

`defer`를 사용하면 `handleConn`의 모든 종료 경로 — 정상 종료, 인증 실패, 패닉 복구 — 에서 카운터가 감소된다.

---

## PostgreSQL 에러 코드

클라이언트 라이브러리가 커넥션 거부를 올바르게 처리하려면 표준 에러 코드가 필요하다:

```go
func (s *Server) sendFatalWithCode(conn net.Conn, code, msg string) {
    var payload []byte
    payload = append(payload, 'S')
    payload = append(payload, []byte("FATAL")...)
    payload = append(payload, 0)
    payload = append(payload, 'C')  // SQLSTATE code
    payload = append(payload, []byte(code)...)
    payload = append(payload, 0)
    payload = append(payload, 'M')
    payload = append(payload, []byte(msg)...)
    payload = append(payload, 0, 0) // terminator
    _ = protocol.WriteMessage(conn, protocol.MsgErrorResponse, payload)
}
```

- **Severity: FATAL** — `ERROR`가 아닌 `FATAL`이다. 커넥션 레벨 거부이므로 클라이언트는 이 커넥션에서 재시도해서는 안 된다.
- **SQLSTATE: 53300** — `too_many_connections`. PostgreSQL이 `max_connections` 초과 시 보내는 것과 동일한 코드다. pgx, JDBC 등 대부분의 드라이버가 이 코드를 인식하여 적절한 예외를 던진다.

기존 `sendError`는 severity `ERROR`와 메시지만 보냈는데, 커넥션 거부에는 `FATAL` + SQLSTATE 코드가 필요하다.

---

## 설정 구조

```yaml
connection_limits:
  enabled: true
  default_max_connections_per_user: 100     # 0 = 무제한
  default_max_connections_per_database: 200

auth:
  enabled: true
  users:
    - username: "app_user"
      password: "secret"
      max_connections: 50   # 기본값(100) 대신 50 적용
    - username: "admin"
      password: "secret"
      max_connections: 0    # 0 = 무제한 (관리자는 제한 없음)

databases:
  prod:
    max_connections: 300    # DB별 오버라이드
    writer: ...
```

**3단계 우선순위**:
1. 사용자/DB별 오버라이드 (`auth.users[].max_connections`, `databases[].max_connections`)
2. 전역 기본값 (`default_max_connections_per_user`, `default_max_connections_per_database`)
3. 0 = 무제한 (Go의 zero value가 자연스럽게 "제한 없음"이 된다)

---

## Hot-Reload

```go
func (s *Server) Reload(newCfg *config.Config) error {
    // ...
    if newCfg.ConnectionLimits.Enabled {
        if s.connTracker != nil {
            s.connTracker.UpdateLimits(newCfg)
        } else {
            s.connTracker = NewConnTracker(newCfg)
        }
    } else {
        s.connTracker = nil
    }
    // ...
}
```

`UpdateLimits`는 제한값만 변경하고 현재 카운터는 유지한다:
- 제한을 낮춰도 **기존 커넥션은 끊기지 않는다** (graceful)
- 현재 카운터가 새 제한보다 크면 **새 커넥션만 거부**된다
- 이는 PostgreSQL과 PgBouncer의 동작과 동일하다

---

## Prometheus 메트릭

세 가지 메트릭을 추가했다:

```go
// 거부 카운터 — user/database 라벨
pgmux_connection_limit_rejected_total{user="app", database="prod"}

// 활성 커넥션 게이지 — user 라벨
pgmux_active_connections_by_user{user="app"}

// 활성 커넥션 게이지 — database 라벨
pgmux_active_connections_by_database{database="prod"}
```

Grafana에서 유용한 쿼리:

```promql
# 사용자별 커넥션 사용률 (%)
pgmux_active_connections_by_user / on(user) group_left pgmux_connection_limit_max_by_user * 100

# 최근 5분간 거부 비율
rate(pgmux_connection_limit_rejected_total[5m])
```

---

## Admin API

`GET /admin/connections`로 현재 커넥션 현황을 조회할 수 있다:

```json
{
  "by_user": {
    "app_user": { "active": 42, "limit": 50 },
    "admin":    { "active": 3,  "limit": 0 }
  },
  "by_database": {
    "prod":   { "active": 45, "limit": 300 },
    "testdb": { "active": 0,  "limit": 200 }
  },
  "defaults": {
    "per_user": 100,
    "per_database": 200
  }
}
```

`limit: 0`은 무제한을 의미한다. 명시적 오버라이드가 없는 사용자는 `defaults.per_user` 값이 적용된다.

---

## 테스트

7개의 유닛 테스트로 커버했다:

| 테스트 | 검증 항목 |
|--------|-----------|
| `BasicAcquireRelease` | 기본 흐름: 제한 도달 → 거부 → Release 후 재획득 |
| `PerUserOverride` | admin(5), limited(1), unknown(기본값 3) 각각 다른 제한 |
| `PerDBLimit` | DB별 제한이 사용자 간 공유되는지 |
| `UnlimitedWhenZero` | 0 = 무제한일 때 1000개 연속 성공 |
| `UpdateLimits` | 제한 낮추기 → 거부, 높이기 → 허용 |
| `Stats` | Admin API용 스냅샷 정확성 |
| `Concurrent` | 200개 고루틴 동시 Acquire/Release |

특히 `Concurrent` 테스트는 뮤텍스의 정합성을 검증한다:

```go
func TestConnTracker_Concurrent(t *testing.T) {
    cfg := connLimitTestConfig(100, 0, nil, nil)
    ct := NewConnTracker(cfg)

    var wg sync.WaitGroup
    for i := 0; i < 200; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            user := fmt.Sprintf("user%d", i%10)
            ok, _ := ct.TryAcquire(user, "testdb")
            if ok {
                ct.Release(user, "testdb")
            }
        }(i)
    }
    wg.Wait()
}
```

---

## PgBouncer 비교

| 항목 | PgBouncer | pgmux |
|------|-----------|-------|
| Per-user limit | `max_user_connections` | `auth.users[].max_connections` |
| Per-DB limit | `max_db_connections` | `databases[].max_connections` |
| Global per-user default | 없음 (각각 설정) | `default_max_connections_per_user` |
| Hot-reload | SIGHUP 시 반영 | SIGHUP + fsnotify + Admin API |
| Error code | 커스텀 메시지 | SQLSTATE 53300 (PG 표준) |
| 모니터링 | `SHOW CLIENTS` (텍스트) | JSON Admin API + Prometheus |

pgmux는 PG 표준 에러 코드를 사용하여 클라이언트 라이브러리 호환성이 더 높고, Prometheus 메트릭으로 알림 자동화가 용이하다.

---

## 마무리

이번 구현의 포인트:

1. **Check-then-increment를 단일 뮤텍스로** — TOCTOU 방지, 사용자+DB 제한을 원자적으로 체크
2. **FATAL + SQLSTATE 53300** — PostgreSQL 표준 준수로 드라이버 호환성 확보
3. **defer Release** — 모든 종료 경로에서 카운터 정합성 보장
4. **Hot-reload 시 카운터 유지** — 기존 커넥션 중단 없이 제한값만 업데이트

멀티테넌트 운영에서 "한 사용자가 전체 풀을 잡아먹는" 문제는 매우 흔하다. 프록시 레벨에서 제한하면 백엔드 DB에 도달하기 전에 빠르게 거부할 수 있어, DB 자체의 안정성에도 기여한다.

다음 글에서는 남은 멀티테넌시 기능(Per-User Rate Limiting) 또는 Query Rewriting Rules를 다룰 예정이다.
