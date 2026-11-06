---
title: "Go로 PostgreSQL 프록시 만들기 (63) - AST 기반 Query Rewriting Rules 엔진"
date: 2026-03-18
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "AST", "Query Rewriting"]
categories: ["Database"]
project: "pgmux"
description: "pg_query_go AST 파서 위에 선언적 쿼리 변환 엔진을 구현한다. table_rename, column_rename, add_where, schema_qualify 4가지 액션과 코드 리뷰에서 발견한 Critical 버그 수정까지."
---

## 들어가며

v1.0.0 이후 첫 기능으로 **Query Rewriting Rules**를 구현했다. deprecated 테이블명 치환, 조건 자동 주입, 스키마 자동 한정 같은 변환을 YAML 설정으로 선언하면 프록시가 AST 레벨에서 쿼리를 변환한다.

프록시에서 쿼리를 변환하면 애플리케이션 코드를 수정하지 않고도 무중단 스키마 마이그레이션이나 멀티테넌시 격리를 적용할 수 있다. 이미 W21에서 도입한 `pg_query_go` AST 파서 위에 쌓았기 때문에 정규식 치환이 아닌 **구문 트리 조작**으로 안전하게 변환한다.

---

## 설계

### 파이프라인 위치

```
Client → [Parse] → [Rewrite] → [Firewall] → [Route] → Backend
```

Rewriting은 **Firewall보다 앞**에 위치한다. 변환 후의 쿼리가 방화벽 검사를 통과해야 하기 때문이다. 예를 들어 `DELETE FROM orders`를 `DELETE FROM orders WHERE tenant_id = 42`로 변환하면 `block_delete_without_where` 규칙에 걸리지 않는다.

### 4가지 액션

| 액션 | 설명 | 사용 예 |
|------|------|---------|
| `table_rename` | RangeVar 노드의 테이블명 치환 | deprecated 테이블 → 새 테이블 |
| `column_rename` | ColumnRef 노드의 컬럼명 치환 | 컬럼명 변경 마이그레이션 |
| `add_where` | SELECT/UPDATE/DELETE에 AND 조건 주입 | 멀티테넌시 row-level 격리 |
| `schema_qualify` | 미한정 테이블에 스키마 접두사 추가 | `orders` → `shop.orders` |

### 매칭 조건

규칙에는 3가지 선택적 필터가 있다:

- **tables**: 특정 테이블을 참조하는 쿼리만 매칭
- **statement_type**: SELECT, INSERT, UPDATE, DELETE 중 선택
- **query_pattern**: 정규식으로 raw SQL 매칭

모든 필터를 만족해야(AND) 규칙이 적용된다.

---

## 핵심 구현

### Rewriter 구조

```go
type Rewriter struct {
    rules []compiledRule
}

type compiledRule struct {
    rule    RewriteRule
    pattern *regexp.Regexp // nil if no QueryPattern
}
```

`Rewriter`는 생성 후 불변(immutable)이다. `atomic.Pointer`로 관리하면 설정 리로드 시 새 Rewriter를 swap하는 것만으로 lock-free 교체가 가능하다.

### AST 안전성: 항상 Fresh Parse

초기 구현에서는 `ParsedQuery`의 AST를 직접 변형했다. 코드 리뷰에서 이것이 공유 AST를 오염시키는 Critical 버그임을 발견했다.

```go
// Before (buggy): shared AST를 직접 변형
func (rw *Rewriter) Apply(query string, pq *ParsedQuery) RewriteResult {
    tree := pq.Tree  // shared reference!
    // ... mutate tree in-place
}

// After (safe): 항상 fresh tree를 파싱
func (rw *Rewriter) Apply(query string, pq *ParsedQuery) RewriteResult {
    tree, err := ParseSQL(query)  // independent copy
    // ... mutate tree safely
}
```

`Deparse` 비용(~50us)보다 AST 공유 버그의 위험이 훨씬 크다. Rewriting은 규칙이 설정된 경우에만 실행되므로 이 비용은 허용 가능하다.

### add_where: Statement별 독립 파싱

`add_where`는 WHERE 절에 AND 조건을 주입한다. 멀티 statement 쿼리에서 같은 condition 노드를 공유하면 AST 트리가 DAG가 되어 Deparse가 깨진다.

```go
func rewriteAddWhere(tree *pg_query.ParseResult, condition string) bool {
    for _, rawStmt := range tree.GetStmts() {
        // Parse a fresh condition node per statement
        condNode, err := parseCondition(condition)
        if err != nil { return false }

        switch n := stmt.GetNode().(type) {
        case *pg_query.Node_SelectStmt:
            n.SelectStmt.WhereClause = andWhere(
                n.SelectStmt.GetWhereClause(), condNode)
        // ... UPDATE, DELETE
        }
    }
}
```

### Extended Query Proxy 모드: Parse 메시지 리빌드

Simple Query는 SQL 문자열만 교체하면 된다. 하지만 Extended Query Protocol의 Parse 메시지는 **바이너리 와이어 포맷**으로 인코딩되어 있다:

```
Parse: stmtName\0 + query\0 + paramCount(uint16) + paramOID[](uint32)
```

proxy 모드에서는 Parse 메시지를 그대로 backend에 전달한다. 쿼리를 rewrite했는데 원본 메시지를 전달하면 backend는 rewrite 전 쿼리를 받는다.

```go
// Before (buggy): rewrite 후에도 원본 msg를 버퍼링
extBuf = append(extBuf, protocol.CopyMessage(msg))

// After (fixed): rewrite된 경우 새 Parse 메시지 생성
if extRewritten {
    newPayload := protocol.BuildParsePayload(stmtName, query, paramOIDs)
    extBuf = append(extBuf, &protocol.Message{
        Type: protocol.MsgParse, Payload: newPayload,
    })
} else {
    extBuf = append(extBuf, protocol.CopyMessage(msg))
}
```

`BuildParsePayload`는 statement name, rewritten SQL, parameter OID를 재조합하여 유효한 Parse 메시지를 생성한다.

---

## 설정 예시

```yaml
query_rewriting:
  enabled: true
  rules:
    - name: legacy_users_redirect
      match:
        tables: ["users_old"]
      actions:
        - type: table_rename
          from: users_old
          to: users

    - name: tenant_isolation
      match:
        statement_type: ["SELECT", "UPDATE", "DELETE"]
        tables: ["orders"]
      actions:
        - type: add_where
          condition: "tenant_id = current_setting('app.tenant_id')::int"

    - name: qualify_public
      match:
        tables: ["products"]
      actions:
        - type: schema_qualify
          from: products
          to: shop
```

---

## Hot Reload & 관측성

- **무중단 리로드**: `SIGHUP` 또는 fsnotify로 설정 변경 시 새 Rewriter를 `atomic.Pointer`로 swap
- **Admin API**: `GET /admin/rewrite/rules` — 활성 규칙 목록 확인
- **메트릭**: `pgmux_query_rewritten_total{rule="..."}` — 규칙별 적용 횟수

---

## 코드 리뷰에서 발견한 버그 4건

| 심각도 | 버그 | 영향 |
|--------|------|------|
| **Critical** | proxy 모드 Parse 메시지 미리빌드 | backend가 rewrite 전 SQL 실행 |
| **Critical** | 공유 AST in-place 변형 | 동시 쿼리에서 AST 오염 |
| **Major** | appliedRules 누적 추적 | 미적용 규칙이 applied로 기록 |
| **Major** | add_where condNode 공유 | 멀티 statement에서 Deparse 실패 |

4건 모두 코드 리뷰 단계에서 발견하고 수정했다. 특히 Critical #1은 Extended Query Protocol을 사용하는 드라이버(lib/pq 포함) 전체에 영향을 미쳤을 버그다.

---

## 테스트

16개 유닛 테스트로 커버:

- 4가지 액션별 기본 동작 + 엣지 케이스
- statement type / regex / table 필터 조합
- disabled 규칙 스킵
- 복수 규칙 체이닝
- fail-open (파싱 실패 시 원본 반환)
- subquery, CTE 내부 테이블 매칭

---

## 마치며

AST 기반 쿼리 변환은 정규식 치환보다 안전하지만, AST를 직접 변형하는 만큼 **공유 참조**와 **프로토콜 인코딩** 같은 함정이 있다. 코드 리뷰에서 Critical 2건을 잡은 것이 이번 작업의 가장 큰 수확이다.

다음은 Query Rewriting을 기반으로 사용자/DB/테이블 기준의 선언적 **Policy Engine**을 설계할 예정이다.
