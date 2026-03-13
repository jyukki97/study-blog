---
title: "Go로 PostgreSQL 프록시 만들기 (34) - Multi-Database Routing"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Multi-Database", "Connection Pool", "Routing"]
categories: ["Database"]
project: "pgmux"
description: "단일 pgmux 인스턴스에서 여러 PostgreSQL 데이터베이스를 동시 프록시하는 Multi-Database Routing을 구현한다. DatabaseGroup 추상화, per-DB 풀/밸런서 격리, 캐시 키 혼합까지."
---

## 들어가며

pgmux는 33편에 걸쳐 커넥션 풀링, R/W 분산, 캐싱, 방화벽, Prepared Statement Multiplexing, Query Mirroring, CI/CD까지 구현했다. 기능 면에서는 PgBouncer를 넘어섰지만, 한 가지 결정적인 갭이 남아있었다.

**Multi-Database 지원**.

PgBouncer, PgCat, Odyssey 모두 단일 프록시 인스턴스에서 여러 데이터베이스를 동시에 프록시할 수 있다. pgmux는 `backend.database` 하나만 지원했다. 마이크로서비스 환경에서 서비스별로 DB가 다를 때, pgmux 인스턴스를 DB 수만큼 띄워야 했다.

이번 글에서는 Multi-Database Routing의 설계 결정과 구현 과정을 다룬다.

---

## 경쟁 제품 비교

| 기능 | PgBouncer | PgCat | Odyssey | pgmux (before) | pgmux (after) |
|------|-----------|-------|---------|-----------------|---------------|
| Multi-DB | O | O | O | **X** | **O** |

PgBouncer는 `[databases]` 섹션에서 DB별 설정을 정의한다:

```ini
[databases]
mydb = host=primary1 port=5432 dbname=mydb
otherdb = host=primary2 port=5432 dbname=otherdb
```

pgmux도 비슷한 개념이 필요했다. 클라이언트가 `psql -d mydb`로 접속하면 mydb 풀을, `psql -d otherdb`로 접속하면 otherdb 풀을 사용해야 한다.

---

## 설계 원칙

### 1. 완전 하위호환

기존 single-DB config는 **한 글자도 바꾸지 않고** 동작해야 한다:

```yaml
# 기존 config — 그대로 동작
writer:
  host: primary.db
  port: 5432
readers:
  - host: replica1.db
    port: 5432
backend:
  user: postgres
  password: secret
  database: mydb
```

### 2. 글로벌 vs Per-DB 리소스

모든 것을 DB별로 분리할 필요는 없다:

| 리소스 | 범위 | 이유 |
|--------|------|------|
| Writer/Reader 풀 | **Per-DB** | DB별로 다른 서버를 가리킨다 |
| 밸런서 | **Per-DB** | Reader 목록이 DB별로 다르다 |
| Circuit Breaker | **Per-DB** | 한 DB의 장애가 다른 DB에 영향을 주면 안 된다 |
| 캐시 | **글로벌** (키에 DB명 혼합) | 단일 LRU가 메모리 효율적 |
| Rate Limiter | **글로벌** | 프록시 전체 부하 제어 |
| Mirror | **글로벌** | 미러링 타겟은 하나 |
| Audit Logger | **글로벌** | 감사 로그는 통합 |

### 3. 라우팅 메커니즘

PostgreSQL Wire Protocol에서 클라이언트가 접속할 때 보내는 `StartupMessage`에 `database` 파라미터가 포함된다. pgmux는 이미 이 파라미터를 파싱하고 있었으므로, 이 값으로 DB 그룹을 분기하면 된다.

---

## Config 설계

```yaml
# 새로운 multi-db config
databases:
  mydb:
    writer:
      host: primary-1.db
      port: 5432
    readers:
      - host: replica-1a.db
        port: 5432
    backend:
      user: postgres
      password: secret
      database: mydb
  otherdb:
    writer:
      host: primary-2.db
      port: 5432
    backend:
      user: admin
      password: secret
      database: otherdb
```

**규칙**: `databases`가 있으면 top-level `writer`/`readers`/`backend`는 무시된다. 없으면 top-level에서 자동 합성한다.

```go
type DatabaseConfig struct {
    Writer  DBConfig      `yaml:"writer"`
    Readers []DBConfig    `yaml:"readers"`
    Backend BackendConfig `yaml:"backend"`
    Pool    PoolConfig    `yaml:"pool"`
}

// ResolvedDatabases는 databases가 없으면 top-level에서 합성한다.
func (c *Config) ResolvedDatabases() map[string]DatabaseConfig {
    if len(c.Databases) > 0 {
        return c.Databases
    }
    name := c.Backend.Database
    return map[string]DatabaseConfig{
        name: {Writer: c.Writer, Readers: c.Readers,
               Backend: c.Backend, Pool: c.Pool},
    }
}
```

이 `ResolvedDatabases()` 패턴이 하위호환의 핵심이다. 기존 config에서는 top-level 값으로 단일 DatabaseConfig를 자동 생성하므로, 이후 코드가 항상 `map[string]DatabaseConfig`를 다루면 된다.

---

## DatabaseGroup 추상화

가장 중요한 구조체 설계. Per-DB 리소스를 하나로 묶는 `DatabaseGroup`을 만들었다:

```go
type DatabaseGroup struct {
    mu          sync.RWMutex
    name        string
    writerAddr  string
    writerPool  *pool.Pool
    readerPools map[string]*pool.Pool
    balancer    *router.RoundRobin
    writerCB    *resilience.CircuitBreaker
    readerCBs   map[string]*resilience.CircuitBreaker
    backendCfg  config.BackendConfig
}
```

기존 `Server` 구조체에 흩어져 있던 `writerPool`, `readerPools`, `balancer`, `writerCB`, `readerCBs`를 모두 `DatabaseGroup`으로 옮겼다.

### 생성

```go
func newDatabaseGroup(name string, dbCfg config.DatabaseConfig,
    cbCfg config.CircuitBreakerConfig) *DatabaseGroup {
    writerAddr := fmt.Sprintf("%s:%d", dbCfg.Writer.Host, dbCfg.Writer.Port)
    // Writer pool 생성 (MinConnections: 0, lazy)
    // Reader pools 생성 (각각 독립 풀)
    // Circuit breakers 생성
    return dbg
}
```

Pool의 `MinConnections`을 0으로 설정하여 lazy creation을 사용한다. 프록시 시작 시 모든 DB의 백엔드가 준비되지 않았을 수 있기 때문이다.

### Hot Reload

설정 변경 시 기존 Reader가 추가/제거될 수 있다:

```go
func (g *DatabaseGroup) Reload(dbCfg config.DatabaseConfig,
    cbCfg config.CircuitBreakerConfig) {
    g.mu.Lock()
    defer g.mu.Unlock()

    // 새 Reader 주소 목록
    newReaderAddrs := ...

    // 기존 풀 재사용, 새 풀 생성, 제거된 풀 Close
    for _, addr := range newReaderAddrs {
        if p, ok := g.readerPools[addr]; ok {
            newPools[addr] = p  // 기존 유지
        } else {
            // 새 풀 생성
        }
    }
    for addr, p := range g.readerPools {
        if _, ok := newPools[addr]; !ok {
            p.Close()  // 제거된 Reader
        }
    }
}
```

---

## Server 리팩터링

`Server` 구조체가 크게 바뀌었다:

```go
// Before
type Server struct {
    writerAddr  string
    writerPool  *pool.Pool
    readerPools map[string]*pool.Pool
    balancer    *router.RoundRobin
    writerCB    *resilience.CircuitBreaker
    readerCBs   map[string]*resilience.CircuitBreaker
    // ...
}

// After
type Server struct {
    dbGroups  map[string]*DatabaseGroup
    defaultDB string
    // ... (글로벌 리소스는 그대로)
}
```

6개의 필드가 `dbGroups` 맵 하나로 교체되었다. 하위호환을 위해 기존 getter를 유지한다:

```go
func (s *Server) WriterPool() *pool.Pool {
    return s.dbGroups[s.defaultDB].WriterPool()
}
```

### handleConn에서 DB 라우팅

클라이언트 접속 시 `StartupMessage`의 `database` 파라미터로 DB 그룹을 결정한다:

```go
func (s *Server) handleConn(ctx context.Context, clientConn net.Conn) {
    // ... StartupMessage 파싱 후
    dbName := params["database"]
    if dbName == "" {
        dbName = s.defaultDB
    }
    dbg := s.resolveDBGroup(dbName)
    if dbg == nil {
        s.sendError(clientConn, fmt.Sprintf("unknown database %q", dbName))
        return
    }
    // Auth는 dbg.writerAddr로 relay
    // 쿼리 루프에 dbg 전달
    s.relayQueries(ctx, clientConn, session, ct, dbg)
}
```

---

## 쿼리 경로에 dbg 전달

가장 노동 집약적인 부분. 모든 쿼리 처리 함수에 `dbg *DatabaseGroup` 파라미터를 추가해야 했다:

| 파일 | 함수 | 변경 |
|------|------|------|
| `query.go` | `relayQueries` | `s.writerPool` → `dbg.writerPool` |
| `backend.go` | `acquireWriterConn` | `s.writerCB` → `dbg.writerCB` |
| `backend.go` | `fallbackToWriter` | `s.writerAddr` → `dbg.writerAddr` |
| `query_read.go` | `handleReadQueryTraced` | `s.balancer` → `dbg.balancer` |
| `query_extended.go` | `executeSynthesizedQuery` | `s.writerPool` → `dbg.writerPool` |
| `lsn.go` | `pollReaderLSNs` | 모든 DB 그룹 순회 |

패턴은 단순하다 — `s.writerPool`을 `dbg.writerPool`으로, `s.balancer`를 `dbg.balancer`로 교체. 하지만 함수가 10개 이상이라 누락 없이 바꾸는 것이 관건이었다.

---

## 캐시 키 격리

같은 SQL이라도 DB가 다르면 결과가 다르다. 캐시 키에 DB명을 혼합해야 한다:

```go
func mixDBName(key uint64, dbName string) uint64 {
    if dbName == "" {
        return key
    }
    h := fnv.New64a()
    h.Write([]byte(dbName))
    return key ^ h.Sum64()
}
```

FNV-1a 해시의 XOR 혼합을 선택한 이유:
- **충돌 가능성**: 이론적으로 존재하지만, DB명은 소수(수십 개 이하)이고 XOR의 분포가 균일하므로 실무에서 문제 없다
- **성능**: FNV-1a는 allocation 없이 몇 나노초면 끝난다
- **단순함**: 별도의 해시 테이블이나 프리픽스 없이 기존 uint64 키를 그대로 사용

---

## Admin API 변경

DB별 health check와 pool stats를 제공한다:

```json
// GET /admin/health
{
  "databases": {
    "mydb": {
      "writer": {"addr": "primary-1:5432", "healthy": true},
      "readers": [
        {"addr": "replica-1a:5432", "healthy": true}
      ]
    },
    "otherdb": {
      "writer": {"addr": "primary-2:5432", "healthy": true},
      "readers": []
    }
  }
}
```

Health check는 writer와 모든 reader를 **병렬로** TCP 체크한다. DB 그룹 간에도 병렬이고, 그룹 내 writer/reader 간에도 병렬이다.

---

## Data API 변경

`?database=` 쿼리 파라미터로 DB 그룹을 선택한다:

```bash
# mydb에 쿼리
curl -X POST "http://localhost:8080/v1/query?database=mydb" \
  -H "Authorization: Bearer key" \
  -d '{"sql": "SELECT * FROM users"}'

# otherdb에 쿼리
curl -X POST "http://localhost:8080/v1/query?database=otherdb" \
  -H "Authorization: Bearer key" \
  -d '{"sql": "SELECT * FROM orders"}'
```

생략하면 default DB를 사용한다.

---

## Hot Reload: DB 그룹 Diff

설정 리로드 시 DB 그룹의 추가/제거/업데이트를 처리한다:

```go
func (s *Server) Reload(newCfg *config.Config) error {
    newDBs := newCfg.ResolvedDatabases()
    oldGroups := s.getDBGroups()

    for name, dbCfg := range newDBs {
        if g, ok := oldGroups[name]; ok {
            g.Reload(dbCfg, newCfg.CircuitBreaker)  // 업데이트
        } else {
            newGroups[name] = newDatabaseGroup(...)   // 추가
        }
    }
    for name, g := range oldGroups {
        if _, ok := newDBs[name]; !ok {
            g.Close()  // 제거
        }
    }
}
```

---

## 검증

```bash
# 컴파일
$ go build ./...
# ✅

# 전체 테스트 (14 packages)
$ go test ./...
# ok  github.com/jyukki97/pgmux/internal/config    8.247s
# ok  github.com/jyukki97/pgmux/internal/proxy      3.769s
# ok  github.com/jyukki97/pgmux/internal/admin       2.624s
# ok  github.com/jyukki97/pgmux/internal/dataapi     1.192s
# ... (14 packages all pass)

# Race detector
$ go test -race ./internal/proxy/ ./internal/admin/ ./internal/dataapi/
# ok  (no races)
```

기존 single-DB config로 실행해도 동작이 **완전히 동일**하다. `ResolvedDatabases()`가 top-level 값에서 자동 합성하기 때문이다.

---

## 마무리

이번 작업으로 pgmux는 경쟁 제품(PgBouncer, PgCat, Odyssey) 대비 **모든 핵심 기능을 갖추게 되었다**:

| 기능 | PgBouncer | PgCat | Odyssey | pgmux |
|------|-----------|-------|---------|-------|
| Transaction Pooling | O | O | O | **O** |
| R/W Splitting | X | O | O | **O** |
| Multi-DB | O | O | O | **O** |
| Query Caching | X | X | X | **O** |
| Query Firewall | X | X | X | **O** |
| AST Parser | X | X | X | **O** |
| Prepared Stmt Mux | X | X | X | **O** |
| Query Mirroring | X | X | X | **O** |
| Audit Log | X | X | X | **O** |
| Data API | X | X | X | **O** |

`DatabaseGroup` 추상화가 핵심이었다. Per-DB 리소스를 하나의 구조체로 캡슐화하니, Server가 단순해지고 Hot Reload도 DB 그룹 단위로 깔끔하게 처리된다.

변경량은 16파일, +888 -499줄. 대부분은 `s.writerPool` → `dbg.writerPool` 같은 기계적 치환이었지만, 설계 결정(글로벌 vs per-DB, 캐시 키 혼합 방식, 하위호환 전략)이 구현보다 중요했다.

[GitHub PR #172](https://github.com/jyukki97/pgmux/pull/172)
