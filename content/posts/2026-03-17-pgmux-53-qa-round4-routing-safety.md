---
title: "Go로 PostgreSQL 프록시 만들기 (53) - QA 4차: 라우팅 우회와 운영 안전성"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Security", "Routing", "Prepared Statement"]
categories: ["Database"]
project: "pgmux"
description: "Prepared statement 재사용으로 read-only를 우회하는 버그, side-effectful SELECT의 잘못된 라우팅, extended query timeout 사각지대 등 QA 4차에서 발견된 5건의 버그를 분석하고 수정한다."
---

## 들어가며

QA 4차에서 5건의 소견이 나왔다. 이번엔 **라우팅 안전성**이 핵심 주제다. Prepared statement 재사용이 read-only 모드를 우회하는 보안 버그, `SELECT ... FOR UPDATE`가 reader로 가는 라우팅 오류, timeout이 빠진 실행 경로 — 모두 "정상 경로에서는 잘 되지만 특정 조합에서 깨지는" 패턴이다.

| # | 심각도 | 요약 |
|---|--------|------|
| 1 | High | Read-only 모드가 prepared statement 재사용으로 우회됨 |
| 2 | High | Side-effectful SELECT가 read로 분류됨 |
| 3 | Medium | Extended/multiplex 경로에서 query timeout 미적용 |
| 4 | Medium | Data API의 기본 DB가 hot-reload를 따라가지 않음 |
| 5 | Medium | Per-database config validation 누락으로 panic 가능 |

---

## 1. Prepared Statement 재사용으로 Read-Only 우회

### 문제

Read-only 모드는 write 쿼리를 차단하는 운영 기능이다. Simple Query에서는 잘 동작한다:

```
-- Simple Query: 정상 차단
INSERT INTO orders VALUES (1, 'test');
→ "cannot execute write query: pgmux is in read-only mode"
```

그런데 Extended Query Protocol에서는 다른 이야기다. PostgreSQL 클라이언트 라이브러리(JDBC, libpq 등)는 prepared statement를 적극적으로 재사용한다. 한 번 Parse한 INSERT 문을 이후에는 Bind/Execute/Sync만 보낸다.

```
-- 1단계: Parse (read-only 전환 전)
Parse("INSERT INTO orders VALUES ($1, $2)")
Bind(params...)
Execute
Sync
→ 성공

-- 2단계: admin에서 read-only 모드 활성화

-- 3단계: 같은 prepared statement 재사용 (Parse 없이)
Bind(params...)     ← Parse가 없으므로 extIsWrite 미설정
Execute
Sync
→ 성공!? ← read-only 우회
```

원인은 `extIsWrite` 플래그의 생명주기에 있다:

```go
// query.go — Parse 때만 설정
case protocol.MsgParse:
    if s.classifyQuery(query) == router.QueryWrite {
        extIsWrite = true   // ← Parse가 있을 때만 실행
    }

// Sync 때 체크
case protocol.MsgSync:
    if s.InReadOnly() && extIsWrite {  // extIsWrite가 false → 통과
        // reject...
    }
    // 배치 끝에서 리셋
    extIsWrite = false
```

Parse가 없는 Bind-only 배치에서는 `extIsWrite`가 이전 배치 리셋으로 `false` 상태다. Read-only 체크가 통과된다.

### 수정

Session에 statement별 write 분류를 추적하는 맵을 추가했다:

```go
// router.go
type Session struct {
    stmtRoutes map[string]Route
    stmtWrite  map[string]bool  // 추가: statement별 write 분류
}

func (s *Session) RegisterStatement(name, query string) Route {
    route := s.routeLocked(query)
    s.stmtRoutes[name] = route
    // write 분류도 함께 저장
    if s.astParser {
        s.stmtWrite[name] = ClassifyAST(query) == QueryWrite
    } else {
        s.stmtWrite[name] = Classify(query) == QueryWrite
    }
    return route
}

func (s *Session) StatementIsWrite(name string) bool {
    if isWrite, ok := s.stmtWrite[name]; ok {
        return isWrite
    }
    return true  // 모르면 write로 간주 (safe default)
}
```

MsgBind에서 statement의 write 여부를 확인한다:

```go
case protocol.MsgBind:
    route := session.StatementRoute(stmtName)
    if route == router.RouteWriter {
        extRoute = router.RouteWriter
    }
    // 추가: write 분류 복원
    if session.StatementIsWrite(stmtName) {
        extIsWrite = true
    }
```

핵심은 **분류 시점과 검사 시점의 분리**다. Parse 때 분류 결과를 저장하고, Bind 때 복원한다. 미등록 statement는 `true`(write)로 간주해서 안전한 방향으로 동작한다.

---

## 2. Side-Effectful SELECT가 Read로 분류

### 문제

pgmux의 쿼리 분류기는 첫 번째 키워드로 read/write를 판단한다. `SELECT`로 시작하면 read, `INSERT`/`UPDATE`/`DELETE`로 시작하면 write. 대부분의 경우 맞지만, PostgreSQL에는 **부작용이 있는 SELECT**가 있다:

```sql
-- 행 잠금 획득 (reader에서 실행 불가)
SELECT * FROM orders WHERE id = 1 FOR UPDATE;

-- 시퀀스 값 증가 (writer에서만 실행해야 함)
SELECT nextval('order_id_seq');

-- 세션 파라미터 변경
SELECT set_config('statement_timeout', '5000', false);

-- Advisory lock 획득
SELECT pg_advisory_lock(12345);
```

이 쿼리들이 reader(replica)로 가면:
- `FOR UPDATE`: replica에서 lock 획득 불가 → 에러
- `nextval()`: replica에서 실행 불가 → 에러
- `set_config()`: replica에서 실행 가능하지만, 커넥션이 풀로 돌아가면 설정 누수
- `pg_advisory_lock()`: replica에서 잠금이 걸리면 writer와 별개 → 동기화 불가

### 수정

문자열 파서와 AST 파서 양쪽에 감지를 추가했다.

**문자열 파서** — SELECT 문에서 locking clause와 부작용 함수를 감지:

```go
// parser.go
var lockingClauses = []string{
    "FOR UPDATE", "FOR NO KEY UPDATE",
    "FOR SHARE", "FOR KEY SHARE",
}

var sideEffectFuncs = []string{
    "NEXTVAL(", "SETVAL(", "CURRVAL(",
    "SET_CONFIG(", "PG_ADVISORY_LOCK(",
    "PG_ADVISORY_XACT_LOCK(", "PG_ADVISORY_UNLOCK(",
    "PG_TRY_ADVISORY_LOCK(", "PG_NOTIFY(",
    "LO_CREATE(", "LO_UNLINK(",
}

func isSideEffectfulSelect(query string) bool {
    stripped := stripStringLiterals(query)
    upper := strings.ToUpper(stripped)
    for _, lc := range lockingClauses {
        if strings.Contains(upper, lc) { return true }
    }
    return hasSideEffectFunc(upper)
}
```

`classifyFast`에서도 SELECT일 때 빠른 탈출을 막는다:

```go
if kw == "SELECT" {
    upper := strings.ToUpper(query)
    if strings.Contains(upper, "FOR UPDATE") || ... || hasSideEffectFunc(upper) {
        return 0, false  // full parser로 위임
    }
    return QueryRead, true
}
```

**AST 파서** — pg_query의 구조화된 정보를 활용:

```go
// parser_ast.go
case *pg_query.Node_SelectStmt:
    s := n.SelectStmt
    // CTE 체크 (기존)
    // ...
    // Locking clause: FOR UPDATE, FOR SHARE 등
    if len(s.GetLockingClause()) > 0 {
        return true
    }
    // 부작용 함수 호출
    return hasSideEffectFuncCalls(node)
```

AST 파서에서는 `FuncCall` 노드를 워킹하며 함수명을 체크한다. 문자열 파서보다 정확하다 — 문자열 리터럴 안의 `nextval(`에 속지 않는다.

---

## 3. Extended/Multiplex 경로의 Timeout 사각지대

### 문제

pgmux는 per-query timeout hint를 지원한다:

```sql
/* timeout:5s */ SELECT * FROM large_table;
```

Simple Query에서는 잘 동작한다. 그런데 Extended Query에서는 global timeout만 적용된다:

```go
// query.go — Sync 핸들러
extQueryTimeout := s.getConfig().Pool.QueryTimeout  // global만!
```

더 심각한 건 multiplex 경로(synthesized query)다. 여기는 **아예 timer가 없다**:

```go
// executeSynthesizedQuery — timer 없이 relay
if err := protocol.WriteMessage(wConn, protocol.MsgQuery, queryPayload); err != nil { ... }
if err := s.relayUntilReady(clientConn, wConn); err != nil { ... }
// ← timeout 없이 무한 대기 가능
```

### 수정

1. Parse에서 query 텍스트를 저장해 Sync에서 hint를 추출한다:

```go
var extQueryText string  // 최신 Parse의 query 텍스트

case protocol.MsgParse:
    extQueryText = query  // 저장

case protocol.MsgSync:
    extQueryTimeout := s.resolveQueryTimeout(extQueryText, s.getConfig())
```

2. `executeSynthesizedQuery`에 `queryTimeout` 파라미터를 추가하고 timer를 건다:

```go
func (s *Server) executeSynthesizedQuery(ctx context.Context, ..., queryTimeout time.Duration, ...) error {
    ct.setFromConn(dbg.writerAddr, wConn)
    stopTimer := s.startQueryTimer(queryTimeout, ct, "writer")
    // ... relay ...
    if stopTimer != nil { stopTimer() }
    ct.clear()
}
```

`handleSynthesizedRead`에도 동일하게 적용해서 reader/writer/fallback 세 경로 모두 커버한다.

---

## 4. Data API의 기본 DB가 Hot-Reload를 무시

### 문제

Data API의 `/v1/query`에 `database` 파라미터를 생략하면 기본 DB로 라우팅된다. 이 기본 DB는 **생성 시점에 한 번** 설정된다:

```go
// main.go
apiSrv := dataapi.New(..., srv.DefaultDBName(), ...)
//                         ^^^^^^^^^^^^^^^^^ 문자열 한 번 평가

// handler.go
type Server struct {
    defaultDB string  // 정적 필드
}
```

Config reload로 기본 DB를 바꾸거나 기존 기본 DB를 제거해도, Data API는 예전 값을 그대로 쓴다.

### 수정

정적 문자열 대신 함수 참조를 저장한다:

```go
// handler.go
type Server struct {
    defaultDBFn func() string  // 동적 조회
}

func (s *Server) handleQuery(...) {
    dbName := r.URL.Query().Get("database")
    if dbName == "" {
        dbName = s.defaultDBFn()  // 매 요청마다 최신값
    }
}
```

```go
// main.go
dataapi.New(..., srv.DefaultDBName, ...)  // 메서드 참조 (호출이 아님)
```

`srv.DefaultDBName`은 이미 `func() string` 시그니처를 가진 메서드다. 호출 결과(`string`) 대신 메서드 자체를 전달하면 된다.

---

## 5. Per-Database Config Validation 누락

### 문제

top-level pool 설정은 검증된다:

```go
if c.Pool.MaxConnections < 1 {
    return fmt.Errorf("pool.max_connections must be >= 1")
}
```

하지만 per-database 설정은 검증이 없다:

```yaml
databases:
  mydb:
    pool:
      max_connections: -5   # ← 검증 없이 통과
      idle_timeout: -1s     # ← 검증 없이 통과
```

`max_connections: -5`는 `make([]*Conn, 0, -5)`까지 흘러 **panic**을 일으킨다. `idle_timeout: -1s`는 `time.NewTicker(-500ms)`에서 panic이다. 설정 오류가 런타임 crash로 이어진다.

### 수정

`validate()`의 per-database 루프에 pool 설정 검증을 추가했다:

```go
for name, db := range c.Databases {
    // 기존: host/port 검증
    // 추가: pool 설정 검증
    if db.Pool.MaxConnections < 1 {
        return fmt.Errorf("databases.%s.pool.max_connections must be >= 1, got %d",
            name, db.Pool.MaxConnections)
    }
    if db.Pool.MinConnections < 0 { ... }
    if db.Pool.MinConnections > db.Pool.MaxConnections { ... }
    if db.Pool.IdleTimeout < 0 { ... }
    if db.Pool.MaxLifetime < 0 { ... }
    if db.Pool.ConnectionTimeout < 0 { ... }
    if db.Pool.QueryTimeout < 0 { ... }
}
```

Top-level timeout도 음수 검증을 추가했다. `applyDefaults()`가 0을 기본값으로 채우지만, 명시적 음수는 건드리지 않기 때문이다.

---

## 마무리

이번 QA 라운드의 패턴을 정리하면:

**1. 프로토콜 레벨 우회** — Finding 1은 PG Extended Query Protocol의 "Parse 재사용" 특성을 이용한 우회다. 프록시는 클라이언트가 메시지를 어떤 조합으로 보낼지 통제할 수 없다. 보안 체크는 모든 경로에서 동일하게 동작해야 한다.

**2. 암묵적 부작용** — Finding 2는 SQL의 의미론적 분석 한계다. `SELECT`라고 다 읽기가 아니다. `FOR UPDATE`, `nextval()`, `pg_advisory_lock()` — PostgreSQL은 SELECT 안에서도 상태를 변경한다. 프록시가 이를 인지하지 못하면 데이터 정합성이 깨진다.

**3. 경로별 일관성** — Finding 3, 4는 "메인 경로에서는 되는데 대체 경로에서 빠진" 패턴이다. Simple Query vs Extended Query, proxy vs multiplex, 생성 시점 vs reload 시점 — 모든 경로에서 동일한 동작을 보장해야 한다.

**4. 방어적 검증** — Finding 5는 "잘못된 입력이 crash로 이어지면 안 된다"는 기본 원칙이다. Go의 panic은 전체 프로세스를 죽인다. 사용자 설정은 반드시 검증하고, 불가능한 값은 시작 시점에 거부해야 한다.

다음 글에서는 성능 벤치마크나 새 기능을 다룰 예정이다.
