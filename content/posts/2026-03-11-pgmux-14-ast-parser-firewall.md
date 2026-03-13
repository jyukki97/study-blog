---
title: "Go로 PostgreSQL 프록시 만들기 (14) - AST 파서와 쿼리 방화벽"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "AST", "Query Parser", "Firewall", "Security"]
categories: ["Database"]
project: "pgmux"
description: "pg_query_go로 PostgreSQL의 실제 파서를 활용하여 정확한 쿼리 분류, 위험 쿼리 차단, 시맨틱 캐시 키를 구현한다."
---

## 들어가며

지금까지 pgmux의 쿼리 라우팅은 문자열 기반 파서에 의존했다. `strings.HasPrefix(upper, "SELECT")` 같은 방식으로 읽기/쓰기를 구분했는데, 단순한 쿼리에서는 잘 동작하지만 현실의 SQL은 그렇게 단순하지 않다.

```sql
-- 문자열 파서로는 SELECT로 분류되지만, 실제로는 write 쿼리
WITH updated AS (
    UPDATE users SET active = false WHERE last_login < '2025-01-01'
    RETURNING id
)
SELECT count(*) FROM updated;

-- 서브쿼리가 포함된 복잡한 케이스
SELECT * FROM orders WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at IS NOT NULL
);

-- DDL인지 DML인지 문자열로 구분하기 어려운 케이스
CREATE TABLE IF NOT EXISTS backup AS SELECT * FROM users;
```

CTE 내부의 write, 서브쿼리, 복잡한 DDL 등을 문자열 매칭만으로 정확히 분류하는 것은 사실상 불가능하다. 결국 SQL을 제대로 이해하려면 **파서**가 필요하다.

[pg_query_go](https://github.com/pganalyze/pg_query_go)는 PostgreSQL의 실제 파서 C 라이브러리를 Go로 바인딩한 프로젝트다. PostgreSQL이 내부적으로 사용하는 것과 동일한 파서를 그대로 사용하기 때문에, PostgreSQL이 파싱할 수 있는 모든 SQL을 정확하게 AST(Abstract Syntax Tree)로 변환할 수 있다. 이번 Phase 13에서는 이 라이브러리를 도입하여 쿼리 분류의 정확도를 높이고, AST를 활용한 쿼리 방화벽과 시맨틱 캐시 키까지 구현했다.

---

## pg_query_go 도입

### AST 파싱과 순회

`internal/router/ast.go`에 pg_query_go를 래핑하는 기본 함수들을 구현했다.

```go
func ParseSQL(query string) (*pg_query.ParseResult, error) {
    result, err := pg_query.Parse(query)
    if err != nil {
        return nil, fmt.Errorf("ast parse: %w", err)
    }
    return result, nil
}
```

파싱된 결과는 Protocol Buffers 기반의 AST 트리 구조로 반환된다. 이 트리를 순회하기 위해 깊이 우선 탐색(DFS) 방식의 `WalkNodes()`를 구현했다.

```go
func WalkNodes(node *pg_query.Node, visitor func(*pg_query.Node) bool) {
    if node == nil {
        return
    }
    if !visitor(node) {
        return
    }
    // 노드 타입별로 자식 노드를 재귀 순회
    switch n := node.Node.(type) {
    case *pg_query.Node_SelectStmt:
        for _, target := range n.SelectStmt.TargetList {
            WalkNodes(target, visitor)
        }
        for _, from := range n.SelectStmt.FromClause {
            WalkNodes(from, visitor)
        }
        WalkNodes(n.SelectStmt.WhereClause, visitor)
        // ...
    case *pg_query.Node_JoinExpr:
        WalkNodes(n.JoinExpr.Larg, visitor)
        WalkNodes(n.JoinExpr.Rarg, visitor)
        WalkNodes(n.JoinExpr.Quals, visitor)
    case *pg_query.Node_SubLink:
        WalkNodes(n.SubLink.Subselect, visitor)
    case *pg_query.Node_CommonTableExpr:
        WalkNodes(n.CommonTableExpr.Ctequery, visitor)
    // InsertStmt, UpdateStmt, DeleteStmt, ...
    }
}
```

지원하는 노드 타입은 `SelectStmt`, `InsertStmt`, `UpdateStmt`, `DeleteStmt`, `JoinExpr`, `SubLink`, `CommonTableExpr` 등 PostgreSQL의 주요 Statement와 Expression을 모두 커버한다.

---

## AST 기반 쿼리 분류

### ClassifyAST

`internal/router/parser_ast.go`에 AST 기반 쿼리 분류 함수를 구현했다.

```go
func ClassifyAST(query string) QueryType {
    // 1. hint 주석 체크 (/*read*/, /*write*/)
    if hint := parseHint(query); hint != QueryUnknown {
        return hint
    }

    // 2. AST 파싱
    result, err := ParseSQL(query)
    if err != nil {
        // 파싱 실패 시 기존 문자열 파서로 fallback
        return Classify(query)
    }

    // 3. AST 순회하며 write 노드 탐지
    for _, stmt := range result.Stmts {
        if isWriteNode(stmt.Stmt) {
            return QueryWrite
        }
    }

    return QueryRead
}
```

핵심은 `isWriteNode()` 함수다. AST 노드 타입으로 write 여부를 판단한다.

```go
func isWriteNode(node *pg_query.Node) bool {
    switch n := node.Node.(type) {
    case *pg_query.Node_InsertStmt:
        return true
    case *pg_query.Node_UpdateStmt:
        return true
    case *pg_query.Node_DeleteStmt:
        return true
    case *pg_query.Node_CreateStmt:
        return true
    case *pg_query.Node_AlterTableStmt:
        return true
    case *pg_query.Node_DropStmt:
        return true
    case *pg_query.Node_TruncateStmt:
        return true
    case *pg_query.Node_GrantStmt:
        return true
    case *pg_query.Node_IndexStmt:
        return true
    case *pg_query.Node_ViewStmt:
        return true
    // DDL 20+ 노드 타입 추가 커버
    case *pg_query.Node_SelectStmt:
        // CTE 내부에 write가 있는지 재귀 검사
        for _, cte := range n.SelectStmt.WithClause.GetCtes() {
            if cteExpr, ok := cte.Node.(*pg_query.Node_CommonTableExpr); ok {
                if isWriteNode(cteExpr.CommonTableExpr.Ctequery) {
                    return true
                }
            }
        }
        return false
    default:
        return false
    }
}
```

### 문자열 파서로는 불가능한 케이스

이 구현의 진가는 CTE 내부의 write를 정확히 감지하는 데 있다.

```sql
WITH x AS (UPDATE accounts SET balance = 0 RETURNING id)
SELECT * FROM x;
```

문자열 파서는 이 쿼리를 `WITH`로 시작하거나 `SELECT`가 포함되어 있다는 이유로 read로 분류할 수 있다. 하지만 AST 파서는 `SelectStmt` → `WithClause` → `CommonTableExpr` → `UpdateStmt` 경로를 재귀적으로 탐색하여, CTE 안에 `UPDATE`가 있음을 정확히 파악하고 write로 분류한다.

DDL도 마찬가지다. `CREATE TABLE`, `ALTER TABLE`, `DROP`, `TRUNCATE`, `GRANT`, `CREATE INDEX`, `CREATE VIEW` 등 20개 이상의 노드 타입을 커버하여, 어떤 DDL이든 write로 올바르게 분류된다.

---

## AST 기반 테이블 추출

캐시 무효화를 위해서는 write 쿼리가 어떤 테이블에 영향을 주는지 정확히 알아야 한다. AST 기반으로 테이블 이름을 추출하는 `ExtractTablesAST` 함수를 구현했다.

```go
func ExtractTablesAST(query string) []string {
    result, err := ParseSQL(query)
    if err != nil {
        return ExtractTables(query) // fallback
    }

    tables := make(map[string]struct{})
    for _, stmt := range result.Stmts {
        WalkNodes(stmt.Stmt, func(node *pg_query.Node) bool {
            if rangeVar := extractRangeVar(node); rangeVar != "" {
                tables[rangeVar] = struct{}{}
            }
            return true
        })
        // CTE 내부의 write 테이블도 추출
        extractCTEWriteTables(stmt.Stmt, tables)
    }

    result := make([]string, 0, len(tables))
    for t := range tables {
        result = append(result, t)
    }
    return result
}
```

`extractCTEWriteTables()` 헬퍼는 CTE 내부의 INSERT, UPDATE, DELETE 대상 테이블까지 정확히 추출한다. 이전 문자열 방식에서는 CTE 안의 테이블을 놓치는 경우가 있었지만, AST 기반에서는 구조를 완전히 파악하므로 빠짐없이 추출된다.

---

## Query Firewall

AST 파서의 가장 실용적인 활용 중 하나가 쿼리 방화벽이다. `internal/router/firewall.go`에 위험한 쿼리를 차단하는 기능을 구현했다.

```go
func CheckFirewall(query string, cfg FirewallConfig) FirewallResult {
    result, err := ParseSQL(query)
    if err != nil {
        // fail-open: 파싱 불가 시 허용
        return FirewallResult{Allowed: true}
    }

    for _, stmt := range result.Stmts {
        if reason := checkStatement(stmt.Stmt, cfg); reason != "" {
            return FirewallResult{
                Allowed: false,
                Reason:  reason,
            }
        }
    }

    return FirewallResult{Allowed: true}
}
```

### 4가지 차단 룰

1. **DELETE without WHERE**: 전체 테이블 삭제 방지
2. **UPDATE without WHERE**: 전체 테이블 갱신 방지
3. **DROP TABLE**: 테이블 삭제 방지
4. **TRUNCATE**: 테이블 비우기 방지

```go
func checkStatement(node *pg_query.Node, cfg FirewallConfig) string {
    switch n := node.Node.(type) {
    case *pg_query.Node_DeleteStmt:
        if cfg.BlockDeleteWithoutWhere && n.DeleteStmt.WhereClause == nil {
            return "DELETE without WHERE clause is blocked"
        }
    case *pg_query.Node_UpdateStmt:
        if cfg.BlockUpdateWithoutWhere && n.UpdateStmt.WhereClause == nil {
            return "UPDATE without WHERE clause is blocked"
        }
    case *pg_query.Node_DropStmt:
        if cfg.BlockDropTable {
            return "DROP TABLE is blocked"
        }
    case *pg_query.Node_TruncateStmt:
        if cfg.BlockTruncate {
            return "TRUNCATE is blocked"
        }
    }
    return ""
}
```

여기서 중요한 것은 **AST의 `WhereClause == nil`로 WHERE 절 유무를 판단**한다는 점이다. 문자열로 `"WHERE"`를 검색하는 방식은 주석이나 문자열 리터럴 안의 "WHERE"에 속을 수 있지만, AST에서는 구문 구조 자체를 보기 때문에 정확하다.

### fail-open 전략

파싱에 실패한 쿼리는 **허용(allow)** 하는 fail-open 전략을 택했다. 프록시는 가용성이 최우선이므로, 파서가 처리하지 못하는 비표준 SQL이나 확장 구문 때문에 정상 쿼리가 차단되는 상황을 방지해야 한다. 반대로 fail-close는 보안이 최우선인 환경에 적합하지만, 범용 DB 프록시로서는 fail-open이 더 합리적인 선택이다.

---

## Semantic Cache Key

### Parse+Deparse 기반 캐시 키

`internal/cache/normalize.go`에 시맨틱 캐시 키 생성 함수를 구현했다. `Parse`로 AST를 생성한 뒤 `Deparse`로 정규화된 SQL을 복원하여 해싱한다. 이 방식은 공백과 대소문자를 정규화하면서 리터럴 값은 보존한다.

```go
func SemanticCacheKey(query string) uint64 {
    tree, err := pg_query.Parse(query)
    if err != nil {
        return CacheKey(query) // fallback
    }
    deparsed, err := pg_query.Deparse(tree)
    if err != nil {
        return CacheKey(query)
    }
    h := fnv.New64a()
    h.Write([]byte(deparsed))
    return h.Sum64()
}
```

다음 두 쿼리는 같은 캐시 키를 갖는다 (공백/대소문자 정규화).

```sql
SELECT id, name FROM users WHERE age > 25;
select  id, name  from  users  where  age > 25;
```

반면 리터럴 값이 다르면 별도의 캐시 키가 생성된다. `age > 25`와 `age > 30`은 서로 다른 캐시 엔트리를 유지한다. 처음에는 `FingerprintToUInt64`를 사용했으나, 이 함수가 리터럴 값을 제거하여 다른 유저의 데이터가 캐시에서 반환되는 심각한 보안 문제가 발견되어 `Parse+Deparse` 방식으로 교체했다. 자세한 내용은 다음 글에서 다룬다.

### 정규화 유틸리티

`Normalize()`는 리터럴 값을 `$1`, `$2` 같은 플레이스홀더로 치환한다. 로깅과 디버깅에 유용하다.

```sql
-- 입력
SELECT * FROM users WHERE id = 42 AND name = 'alice';
-- 정규화 결과
SELECT * FROM users WHERE id = $1 AND name = $2;
```

---

## 벤치마크 결과

AST 파싱은 문자열 비교보다 당연히 느리다. cgo 호출 오버헤드도 있다. 하지만 프록시의 전체 처리 시간 대비 충분히 수용 가능한 수준인지 검증이 필요했다.

| 항목 | 성능 |
|------|------|
| ClassifyAST SELECT | ~7µs |
| ClassifyAST INSERT | ~8µs |
| ClassifyAST Complex JOIN | ~32µs |
| SemanticCacheKey | ~2µs |
| CheckFirewall | ~5.5µs |

모든 항목이 **1ms 미만** 목표를 달성했다. 단순 SELECT의 경우 7마이크로초, 여러 테이블을 JOIN하는 복잡한 쿼리도 32마이크로초로 처리된다. 네트워크 왕복 시간(보통 수백 µs ~ 수 ms)과 비교하면 무시할 수 있는 수준이다.

Fingerprint 계산(`SemanticCacheKey`)은 약 2µs로 매우 빠르다. pg_query 내부에서 파싱과 동시에 최적화된 해시를 생성하기 때문이다.

---

## 설정

AST 파서와 방화벽은 설정으로 활성화한다.

```yaml
routing:
  ast_parser: true      # AST 기반 쿼리 분류 활성화

firewall:
  enabled: true
  block_delete_without_where: true
  block_update_without_where: true
  block_drop_table: false       # 필요에 따라 활성화
  block_truncate: false         # 필요에 따라 활성화
```

`ast_parser: false`이면 기존 문자열 파서로 동작하므로, pg_query_go의 cgo 의존성이 부담스러운 환경에서는 비활성화할 수 있다. 방화벽도 각 룰을 개별적으로 on/off 할 수 있어 운영 환경에 맞게 조절이 가능하다.

---

## 배운 점

### cgo 바인딩의 트레이드오프

pg_query_go는 C 라이브러리 바인딩이므로 cgo가 필요하다. 이는 몇 가지 트레이드오프를 수반한다.

- **빌드 시간 증가**: C 코드 컴파일이 포함되어 첫 빌드가 느려진다
- **크로스 컴파일 제약**: CGO_ENABLED=1 환경이 필요하다
- **바이너리 크기 증가**: C 라이브러리가 포함되어 바이너리가 커진다

하지만 얻는 것은 크다. PostgreSQL의 실제 파서를 사용하므로 **정확도 100%**를 보장받는다. Go로 SQL 파서를 직접 구현하는 것은 비현실적이고, 서드파티 Go 파서는 PostgreSQL의 모든 구문을 지원하지 못한다. 빌드 시간이 좀 더 걸리더라도 정확도를 택하는 것이 DB 프록시에서는 올바른 선택이었다.

### fail-open vs fail-close

방화벽의 기본 동작을 fail-open으로 할지 fail-close로 할지는 서비스 성격에 따라 달라진다.

- **fail-open**: 파싱 실패 시 쿼리 허용. 가용성 우선. 프록시, API 게이트웨이에 적합
- **fail-close**: 파싱 실패 시 쿼리 차단. 보안 우선. 보안 감사, 금융 시스템에 적합

pgmux는 범용 프록시이므로 fail-open을 기본으로 택했다. 프록시가 정상 쿼리를 막아서 서비스 장애를 일으키는 것이, 비정상 쿼리 하나를 놓치는 것보다 훨씬 심각한 문제이기 때문이다.

### 시맨틱 캐시의 가치

캐시 키를 단순 문자열 해시에서 AST 기반 정규화로 바꾸면서, 공백이나 대소문자만 다른 쿼리가 불필요하게 캐시를 낭비하는 문제가 해결됐다. ORM이 생성하는 쿼리는 같은 구조인데 포맷이 미묘하게 다른 경우가 많은데, Parse+Deparse는 이를 정확히 같은 쿼리로 인식한다. 캐시 적중률 향상에 실질적인 효과가 있다.

---

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
