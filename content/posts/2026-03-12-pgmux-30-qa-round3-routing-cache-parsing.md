---
title: "Go로 PostgreSQL 프록시 만들기 (30) - AST 라우팅 사각지대와 캐시 무효화 실종"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "AST", "Cache", "Routing", "QA", "Performance"]
categories: ["Database"]
description: "QA 3차 리포트 5건 — AST 분류가 라우팅에 미반영, 캐시 테이블 무효화 no-op, 중복 파싱 5회/요청, 헬스체크 순차 지연, splitStatements 달러쿼팅 미처리 — 의 원인과 수정 과정을 정리한다."
---

## 들어가며

P29까지의 수정이 끝나자마자 QA 팀이 3차 리포트를 보내왔다. 이번에는 "표면적으로는 동작하지만 실은 안 하고 있는" 유형의 버그가 주를 이뤘다. 설정을 켜도 반영되지 않는 AST 라우팅, nil 하나 때문에 통째로 무력화된 캐시 무효화, 요청 하나에 같은 SQL을 5번 파싱하는 낭비까지. 총 5건, 높음 2건 + 중간 3건이다.

---

## 버그 1: AST 라우팅이 껍데기뿐 (높음)

### 증상

`routing.ast_parser: true`를 설정해도 CTE 내 INSERT/UPDATE가 reader로 라우팅될 수 있다.

### 원인

`Session.Route()`가 AST 설정을 전혀 모른다.

```go
// internal/router/router.go — 수정 전
func (s *Session) Route(query string) Route {
    // ...
    qtype := Classify(query)  // 항상 문자열 기반
    // ...
}
```

`ClassifyAST()`는 `proxy/helpers.go`의 `classifyQuery()`를 통해 호출되지만, 그 결과는 **텔레메트리 span의 attribute**와 **캐시 무효화 판단**에만 사용된다. 실제 라우팅 결정을 내리는 `Session.Route()`에는 도달하지 않는다.

`Session` 구조체에는 `astParser` 필드 자체가 없었다:

```go
type Session struct {
    inTransaction       bool
    readAfterWriteDelay time.Duration
    causalConsistency   bool
    lastWriteLSN        LSN
    stmtRoutes          map[string]Route
    // astParser 필드 없음!
}
```

`NewSession()` 호출부(`server.go`)에서도 AST 설정을 전달하지 않았다. 기능은 구현되어 있지만 **배선이 안 된** 것이다.

### 수정

`Session`에 `astParser` 필드를 추가하고, `Route()`와 `routeLocked()`에서 분기한다:

```go
// internal/router/router.go — 수정 후
type Session struct {
    // ...
    astParser bool
    stmtRoutes map[string]Route
}

func NewSession(readAfterWriteDelay time.Duration, causalConsistency bool, astParser bool) *Session {
    return &Session{
        readAfterWriteDelay: readAfterWriteDelay,
        causalConsistency:   causalConsistency,
        astParser:           astParser,
        stmtRoutes:          make(map[string]Route),
    }
}

func (s *Session) Route(query string) Route {
    // ...
    var qtype QueryType
    if s.astParser {
        qtype = ClassifyAST(query)
    } else {
        qtype = Classify(query)
    }
    // ...
}
```

`server.go`에서 설정 전달:

```go
session := router.NewSession(cfg.Routing.ReadAfterWriteDelay, cfg.Routing.CausalConsistency, cfg.Routing.ASTParser)
```

### 교훈

기능을 구현하는 것과 기능을 **연결하는 것**은 별개다. 이 버그의 위험한 점은 `ClassifyAST`가 분명히 호출되고 있어서 — span에 올바른 `query.type` 값이 찍히고, 캐시 무효화에도 쓰이고 있어서 — "잘 되고 있다"고 착각하기 쉽다는 것이다. 실제 라우팅 결정은 전혀 다른 경로에서 이루어지고 있었다.

---

## 버그 2: nil 하나로 캐시 무효화가 전멸 (높음)

### 증상

테이블에 INSERT 후 다른 세션에서 SELECT하면 TTL 만료 전까지 stale 데이터가 반환된다.

### 원인

읽기 캐시 저장 3곳 모두 `tables=nil`:

```go
// internal/proxy/query_read.go:137 — handleReadQueryTraced
s.queryCache.Set(key, collected, nil)  // tables가 nil!

// internal/proxy/query_read.go:258 — handleReadQuery
s.queryCache.Set(key, collected, nil)  // 여기도 nil!

// internal/proxy/query_extended.go:109 — handleExtendedRead
s.queryCache.Set(key, collected, nil)  // 여기도 nil!
```

캐시의 `Set()` → `updateTableIndex()` 흐름:

```go
func (c *Cache) updateTableIndex(key uint64, tables []string) {
    for _, t := range tables {  // tables가 nil이면 루프 진입 안 함
        c.tableIndex[t] = append(c.tableIndex[t], key)
    }
}
```

`tables=nil`이면 `tableIndex`에 아무것도 등록되지 않는다. 쓰기 후 `InvalidateTable("users")`을 호출해도:

```go
func (c *Cache) InvalidateTable(table string) {
    keys, ok := c.tableIndex[table]  // 비어있으므로 ok=false
    if !ok {
        return  // 즉시 반환 — 무효화 안 됨
    }
    // ...
}
```

빈 `tableIndex`에서 조회 → no-op. 캐시 무효화 코드가 존재하지만 **한 번도 실행된 적이 없는** 상태다.

### 수정

읽기 쿼리에서 테이블명을 추출하는 함수를 추가하고, 캐시 저장 시 전달한다.

```go
// internal/router/parser_ast.go — 새 함수
func ExtractReadTablesAST(query string) []string {
    tree, err := ParseSQL(query)
    if err != nil {
        return ExtractReadTables(query) // 문자열 fallback
    }
    seen := make(map[string]bool)
    var tables []string
    WalkNodes(tree, func(node *pg_query.Node) bool {
        if rv := node.GetRangeVar(); rv != nil {
            t := strings.ToLower(rv.GetRelname())
            if t != "" && !seen[t] {
                seen[t] = true
                tables = append(tables, t)
            }
        }
        return true
    })
    return tables
}
```

호출부 수정:

```go
// internal/proxy/query_read.go — 수정 후
tables := s.extractReadQueryTables(query)
s.queryCache.Set(key, collected, tables)  // nil → 실제 테이블명
```

3곳 모두 동일하게 수정했다.

### 테스트

```go
func TestCache_InvalidateTable_ReadCacheWithTables(t *testing.T) {
    c := New(Config{MaxEntries: 100, TTL: time.Minute, MaxSize: 1024})

    c.Set(CacheKey("SELECT * FROM users"), []byte("users-result"), []string{"users"})
    c.Set(CacheKey("SELECT * FROM orders"), []byte("orders-result"), []string{"orders"})
    c.Set(CacheKey("SELECT * FROM users JOIN orders ..."), []byte("join-result"), []string{"users", "orders"})

    c.InvalidateTable("users")

    // users, join 캐시 삭제됨, orders는 유지
    if c.Len() != 1 { t.Errorf("Len() = %d, want 1", c.Len()) }
}
```

### 교훈

함수 시그니처에 `tables []string`이 있고 nil이 합법적인 값이면, 호출자는 "나중에 채우자"고 nil을 넣고 잊어버리기 쉽다. 이 경우 nil은 "테이블 없음"이 아니라 "추출을 안 함"이라는 뜻이었다. Go에서 nil slice는 조용히 empty처럼 동작하므로 에러도 패닉도 없이 로직 전체를 무력화한다.

---

## 개선 3: 요청 1건에 같은 SQL을 5번 파싱 (중간)

### 증상

AST 모드에서 트래픽이 올라가면 CPU 사용량이 예상보다 급격히 증가한다.

### 원인

요청 하나의 처리 경로에서 `pg_query.Parse()`가 **독립적으로 5회 이상** 호출된다:

| 단계 | 위치 | 호출 |
|------|------|------|
| 방화벽 | `firewall.go:42` | `ParseSQL(query)` |
| 분류 | `parser_ast.go:46` | `ParseSQL(query)` |
| 캐시 키 | `normalize.go:17` | `pg_query.Parse(query)` |
| 테이블 추출 | `parser_ast.go:125` | `ParseSQL(query)` |
| 힌트 | `parser_ast.go:38` | `pg_query.Scan(query)` |

`pg_query.Parse()`는 CGO 경계를 넘어 PostgreSQL C 파서를 호출한다. 벤치마크:

- `ClassifyAST` SELECT: ~10.3us
- `SemanticCacheKey`: ~17.5us
- `CheckFirewall`: ~5.5us

요청당 ~33us 이상이 순수 파싱에 소비된다.

### 수정

`ParsedQuery` 구조체로 파싱 결과를 한 번 만들어 재사용한다:

```go
// internal/router/parsed_query.go
type ParsedQuery struct {
    SQL  string
    Tree *pg_query.ParseResult
}

func NewParsedQuery(sql string) (*ParsedQuery, error) {
    tree, err := pg_query.Parse(sql)
    if err != nil {
        return nil, fmt.Errorf("parse SQL: %w", err)
    }
    return &ParsedQuery{SQL: sql, Tree: tree}, nil
}
```

각 함수에 `WithTree` 변형을 추가하고, 기존 함수는 backward-compatible 래퍼로 유지:

```go
func ClassifyASTWithTree(query string, pq *ParsedQuery) QueryType { ... }
func CheckFirewallWithTree(pq *ParsedQuery, cfg FirewallConfig) FirewallResult { ... }
func ExtractTablesASTWithTree(pq *ParsedQuery) []string { ... }
func SemanticCacheKeyWithTree(tree *pg_query.ParseResult, query string) uint64 { ... }
```

쿼리 처리 진입점에서 한 번 파싱:

```go
// internal/proxy/query.go — 쿼리 루프 내
var parsedQuery *router.ParsedQuery
if queryCfg.Routing.ASTParser {
    if pq, err := router.NewParsedQuery(query); err == nil {
        parsedQuery = pq
    }
}

// 이후 모든 호출에 parsedQuery 전달
fwResult = router.CheckFirewallWithTree(parsedQuery, fwCfg)
qtype = s.classifyQueryParsed(query, parsedQuery)
key = s.cacheKeyParsed(query, parsedQuery)
tables = s.extractQueryTablesParsed(query, parsedQuery)
```

### 벤치마크 결과

```
BenchmarkQueryPipeline_WithoutParsedQuery   25,000 ns/op   6,552 B/op   135 allocs/op
BenchmarkQueryPipeline_WithParsedQuery       7,300 ns/op   2,280 B/op    46 allocs/op
```

**3.4x 속도 향상, 65% 메모리 감소, 66% 할당 감소.**

### 교훈

모듈별로 독립적으로 파싱하는 것이 깔끔한 설계처럼 보이지만, CGO 호출이 포함되면 비용이 기하급수적으로 쌓인다. "parse once, pass the tree" 패턴은 모듈 간 결합을 약간 높이지만, 요청 경로의 latency를 극적으로 줄인다.

---

## 버그 4: 백엔드가 죽을수록 헬스체크가 느려진다 (중간)

### 증상

reader 3대 중 2대가 죽으면 `/admin/health` 응답이 ~6초 걸린다.

### 원인

순차적 TCP 다이얼:

```go
// internal/admin/admin.go — 수정 전
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
    writerHealthy := checkTCP(writerAddr)          // 죽으면 2초
    for _, r := range cfg.Readers {
        readers = append(readers, backendHealth{
            Healthy: checkTCP(addr),               // 각각 2초
        })
    }
}

func checkTCP(addr string) bool {
    conn, err := net.DialTimeout("tcp", addr, 2*1e9)  // 2초 타임아웃
    // ...
}
```

writer 1 + reader N개를 순차 검사하므로, 모두 죽으면 `(1+N) × 2초`.

### 수정

goroutine으로 병렬화:

```go
// internal/admin/admin.go — 수정 후
readers := make([]backendHealth, len(cfg.Readers))
for i, rd := range cfg.Readers {
    readers[i].Addr = fmt.Sprintf("%s:%d", rd.Host, rd.Port)
}

var wg sync.WaitGroup
var writerHealthy bool

wg.Add(1)
go func() {
    defer wg.Done()
    writerHealthy = checkTCP(writerAddr)
}()

for i := range readers {
    wg.Add(1)
    go func(idx int) {
        defer wg.Done()
        readers[idx].Healthy = checkTCP(readers[idx].Addr)
    }(i)
}

wg.Wait()
```

pre-allocated slice의 서로 다른 인덱스에 쓰므로 mutex 불필요. `WaitGroup`만으로 동기화 완료.

### 테스트

```go
func TestHandleHealth_ParallelTiming(t *testing.T) {
    // RFC 5737 TEST-NET 주소 — 무조건 타임아웃
    cfg := &config.Config{
        Writer:  config.DBConfig{Host: "192.0.2.1", Port: 9999},
        Readers: []config.DBConfig{
            {Host: "192.0.2.1", Port: 9999},
            {Host: "192.0.2.1", Port: 9999},
        },
    }
    // ...
    start := time.Now()
    srv.handleHealth(w, req)
    elapsed := time.Since(start)

    // 순차 시 ~6초, 병렬이면 ~2초
    if elapsed > 4*time.Second {
        t.Errorf("took %v; expected < 4s", elapsed)
    }
}
```

### 교훈

I/O 바운드 작업을 루프에서 순차 실행하면, 장애 상황에서 지연이 선형으로 누적된다. 헬스체크는 장애 시에 가장 빨라야 하는데, 장애 시에 가장 느려지는 역설이 발생한다. Go에서는 goroutine + WaitGroup으로 O(N)을 O(1)로 만드는 비용이 매우 낮다.

---

## 버그 5: splitStatements가 달러 쿼팅을 모른다 (중간)

### 증상

PL/pgSQL 함수 정의가 세미콜론 기준으로 잘못 분리되어 라우팅 및 트랜잭션 추적 오류 발생.

### 원인

`splitStatements()` 구현이 `'`와 `"` 만 인식:

```go
// internal/router/router.go — 수정 전
func splitStatements(query string) []string {
    inSingleQuote := false
    inDoubleQuote := false
    for i := 0; i < len(query); i++ {
        ch := query[i]
        switch {
        case ch == '\'' && !inDoubleQuote:
            inSingleQuote = !inSingleQuote  // '' 이스케이프도 오동작
        case ch == '"' && !inSingleQuote:
            inDoubleQuote = !inDoubleQuote
        case ch == ';' && !inSingleQuote && !inDoubleQuote:
            // 분리!
        }
    }
}
```

아래 입력에서 잘못 분리된다:

```sql
CREATE FUNCTION f() AS $$ BEGIN SELECT 1; END; $$ LANGUAGE plpgsql
```

결과: `CREATE FUNCTION f() AS $$ BEGIN SELECT 1` / `END` / `$$ LANGUAGE plpgsql` — 3개로 분리.

같은 패키지의 `parser.go`에는 `stripStringLiterals()`가 달러 쿼팅을 정상 처리하고, `stripComments()`가 `--`와 `/* */`를 정상 처리한다. 하지만 `splitStatements()`는 이 유틸을 사용하지 않고 독자 구현.

### 수정

`splitStatements()`를 재작성. 기존 `parseDollarTag()`를 재사용하고 라인/블록 주석을 추가:

```go
func splitStatements(query string) []string {
    for i := 0; i < len(query); i++ {
        ch := query[i]

        // Dollar quoting: $$ 또는 $tag$ 감지 → 닫는 태그까지 skip
        if ch == '$' && !inSingleQuote && !inDoubleQuote {
            tag, ok := parseDollarTag(query, i)
            if ok {
                // opening tag + body + closing tag를 통째로 current에 추가
                // i를 closing tag 끝으로 이동
                continue
            }
        }

        // Line comment: -- → 줄 끝까지 skip
        if ch == '-' && !inSingleQuote && !inDoubleQuote && i+1 < len(query) && query[i+1] == '-' {
            for i < len(query) && query[i] != '\n' { current.WriteByte(query[i]); i++ }
            continue
        }

        // Block comment: /* → */ (중첩 지원)
        if ch == '/' && !inSingleQuote && !inDoubleQuote && i+1 < len(query) && query[i+1] == '*' {
            depth := 1
            // depth == 0 될 때까지 skip
            continue
        }

        // Escaped quote: '' → skip (기존 토글 방식 수정)
        // ...
    }
}
```

### 테스트 (4건 → 14건)

```go
{"dollar-quoted function body",
 "CREATE FUNCTION f() AS $$ BEGIN SELECT 1; END; $$ LANGUAGE plpgsql", 1},
{"tagged dollar quote",
 "SELECT $tag$hello;world$tag$", 1},
{"line comment with semicolon",
 "SELECT 1; -- comment; here\nSELECT 2", 2},
{"block comment with semicolon",
 "SELECT 1; /* comment; here */ SELECT 2", 2},
{"nested block comment",
 "SELECT 1; /* outer /* inner; */ still; */ SELECT 2", 2},
{"escaped single quotes",
 "SELECT 'it''s;fine'; SELECT 2", 2},
{"mixed function with comments",
 "CREATE FUNCTION f() AS $$ BEGIN\n-- a; comment\nSELECT 1; /* block; */ END; $$ LANGUAGE plpgsql; SELECT 2", 2},
```

### 교훈

SQL의 "세미콜론으로 분리"는 자명한 작업처럼 보이지만, PostgreSQL의 quoting 규칙은 매우 풍부하다. 같은 패키지에 이미 올바른 구현이 있었는데 `splitStatements`만 독자적으로 간략화한 것이 원인이다. **유틸리티 함수는 만들었으면 써야 한다.**

---

## 마무리

이번 QA 라운드에서 발견된 5건의 공통점은 **"기능이 존재하지만 연결되지 않았거나, 정상 경로에서만 동작하는"** 유형이다.

| 패턴 | 사례 |
|------|------|
| 배선 누락 | AST 라우팅 (#143) — 구현은 있으나 Session에 미연결 |
| nil 전파 | 캐시 무효화 (#144) — nil slice가 조용히 로직 전체를 무력화 |
| 중복 비용 | AST 파싱 (#145) — 모듈 독립성이 CGO 비용을 5배로 증폭 |
| 장애 시 역전 | 헬스체크 (#146) — 장애 시에 가장 느려지는 역설 |
| 유틸 미사용 | splitStatements (#147) — 같은 패키지의 유틸을 안 쓴 독자 구현 |

버그는 "없는 기능" 보다 "있는 것 같은 기능"이 더 위험하다. 설정을 켜도 반영되지 않는 라우팅, nil을 넘겨도 에러 없이 돌아가는 캐시 — 이런 것들은 정상 경로 테스트에서 잡히지 않는다. QA의 엣지케이스 리뷰가 또 한 번 빛을 발한 라운드였다.
