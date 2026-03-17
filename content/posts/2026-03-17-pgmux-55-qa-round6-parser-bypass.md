---
title: "Go로 PostgreSQL 프록시 만들기 (55) - QA 6차: 파서 우회와 분류 사각지대"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Security", "SQL Parser", "Routing"]
categories: ["Database"]
project: "pgmux"
description: "앞쪽 주석(/*x*/ BEGIN)이 트랜잭션/세션 상태기를 통째로 우회하고, MERGE·COPY·CALL이 reader로 빠지며, 주석/리터럴 안의 키워드가 false positive를 내는 5건의 파서·라우터 버그를 수정한다."
---

## 들어가며

QA 5차까지는 런타임 안전성(풀 오염, race, timeout)에 집중했다. 이번 라운드는 **쿼리 파서와 라우터의 정확성**을 집중 검토한다. "이 쿼리가 올바른 백엔드에 도달하는가?"가 핵심 질문이다.

발견된 5건 중 3건이 High — 트랜잭션 상태 우회, 세션 오염, write 오분류 — 로, 실제 운영에서 데이터 불일치나 세션 혼선을 유발할 수 있다.

| # | 심각도 | 요약 |
|---|--------|------|
| 1 | High | 앞쪽 주석이 트랜잭션 상태기 우회 (`/*x*/ BEGIN` → reader 라우팅) |
| 2 | High | 앞쪽 주석이 세션 의존 감지·리셋 동시 우회 (`/*x*/ SET` → reader 오염) |
| 3 | High | MERGE, COPY FROM, CALL이 read로 분류 → reader 오라우팅 |
| 4 | Medium | advisory lock 검출이 리터럴/주석에서 false positive |
| 5 | Low-Medium | `isSideEffectfulSelect`가 주석 안 텍스트를 write 신호로 오인 |

---

## 1. 앞쪽 주석이 트랜잭션 상태기를 우회한다

### 문제

`hasTxPrefix`는 쿼리의 첫 번째 키워드를 보고 트랜잭션 진입/이탈을 판단한다. 그런데 **공백만 건너뛰고 주석은 건너뛰지 않는다**:

```go
func hasTxPrefix(query string) int {
    i := 0
    for i < len(query) && (query[i] == ' ' || query[i] == '\t' || ...) {
        i++  // 공백만 skip
    }
    rest := query[i:]
    ch := rest[0] | 0x20
    switch ch {
    case 'b': // BEGIN
    // ...
```

`/*x*/ BEGIN`을 넣으면:
1. 공백 skip → i=0 (첫 글자가 `/`)
2. `rest[0]` = `/` → `ch` = `/` → 어떤 case에도 매칭 안 됨
3. `hasTxPrefix` 반환값 0 → **트랜잭션 상태 미변경**

같은 문제가 `updateTransactionState`, `containsTransactionKeyword`, `routeLocked`에도 있다. `TrimSpace` + `HasPrefix` 패턴은 주석을 제거하지 않기 때문이다:

```go
upper := strings.ToUpper(strings.TrimSpace(stmt))
if strings.HasPrefix(upper, "BEGIN") {  // "/*X*/ BEGIN"은 매칭 실패
```

Extended Query 경로의 tx 체크도 동일한 패턴이다.

### 영향

`/*x*/ BEGIN`이 트랜잭션으로 인식되지 않으면:
- 이후 쿼리가 writer에 묶이지 않고 reader로 분산됨
- reader에서 write 시도 → `ERROR: cannot execute INSERT in a read-only transaction`
- 또는 각 쿼리가 다른 커넥션으로 가서 트랜잭션 격리 깨짐

### 수정

**`SkipLeadingNoise`** 함수를 추가한다. 공백 + 블록 주석(`/* ... */`, 중첩 포함) + 라인 주석(`-- ...\n`)을 모두 건너뛴다:

```go
func SkipLeadingNoise(query string) int {
    i := 0
    for i < len(query) {
        ch := query[i]
        if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
            i++
            continue
        }
        if i+1 < len(query) && ch == '/' && query[i+1] == '*' {
            depth := 1
            i += 2
            for i < len(query) && depth > 0 {
                if i+1 < len(query) && query[i] == '/' && query[i+1] == '*' {
                    depth++; i += 2
                } else if i+1 < len(query) && query[i] == '*' && query[i+1] == '/' {
                    depth--; i += 2
                } else {
                    i++
                }
            }
            continue
        }
        if i+1 < len(query) && ch == '-' && query[i+1] == '-' {
            i += 2
            for i < len(query) && query[i] != '\n' { i++ }
            if i < len(query) { i++ }
            continue
        }
        break
    }
    return i
}
```

적용 범위:
- **`hasTxPrefix`**: 공백 skip 루프를 `SkipLeadingNoise`로 교체
- **`updateTransactionState`**, **`containsTransactionKeyword`**: `stripComments(stmt)` 후 `TrimSpace`+`HasPrefix`
- **`routeLocked`**: 동일하게 `stripComments` 적용
- **Extended Query path** (proxy/query.go): `IsTxControl(query)` export 함수로 교체

```go
// 변경 전 (proxy/query.go, 2곳)
upper := strings.ToUpper(strings.TrimSpace(query))
if strings.HasPrefix(upper, "BEGIN") { extTxStart = true }
if strings.HasPrefix(upper, "COMMIT") { extTxEnd = true }

// 변경 후
if txStart, txEnd := router.IsTxControl(query); txStart {
    extTxStart = true
} else if txEnd {
    extTxEnd = true
}
```

`IsTxControl`은 내부적으로 이미 수정된 `hasTxPrefix`를 호출하므로 주석을 올바르게 처리한다.

---

## 2. 앞쪽 주석이 세션 감지·리셋을 동시에 우회한다

### 문제

Finding 1과 같은 근본 원인이 세션 관련 함수에도 있다.

**`detectSingleStmtDependency`** (session_compat.go):

```go
func detectSingleStmtDependency(query string) SessionDependencyResult {
    i := 0
    for i < len(query) && (query[i] == ' ' || ...) { i++ } // 공백만
    rest := query[i:]
    ch := rest[0] | 0x20
    switch ch {
    case 's': // SET
    case 'l': // LISTEN
```

**`isSessionModifying`** (backend.go) — 동일 구조:

```go
func isSessionModifying(query string) bool {
    i := 0
    for i < len(query) && (query[i] == ' ' || ...) { i++ } // 공백만
```

`/*x*/ SET search_path = 'evil'`을 보내면:
1. `DetectSessionDependency` → 미감지 → pin/block 안 걸림
2. `Classify` → `firstKeyword` = "SET" (stripComments 적용됨) → **하지만 SET은 `writeKeywords`에 없다** → `QueryRead`
3. reader로 라우팅 → reader 커넥션의 search_path가 변경됨
4. `isSessionModifying` → 미감지 → `connDirty` 안 켜짐 → DISCARD ALL 없이 풀에 반환
5. 다음 사용자가 오염된 커넥션을 받음

### 수정

두 함수 모두 공백 skip을 `SkipLeadingNoise`로 교체:

```go
// session_compat.go
func detectSingleStmtDependency(query string) SessionDependencyResult {
    i := SkipLeadingNoise(query) // 주석도 skip
    // ...
}

// backend.go
func isSessionModifying(query string) bool {
    i := router.SkipLeadingNoise(query) // 주석도 skip
    // ...
}
```

---

## 3. MERGE, COPY, CALL이 read로 분류된다

### 문제

string parser의 `writeKeywords` 맵:

```go
var writeKeywords = map[string]bool{
    "INSERT": true, "UPDATE": true, "DELETE": true,
    "CREATE": true, "ALTER": true, "DROP": true,
    "TRUNCATE": true, "GRANT": true, "REVOKE": true,
}
```

**MERGE** (PostgreSQL 15+), **COPY**, **CALL**이 없다. AST parser의 `isWriteNode`에도 해당 노드 타입이 없다.

결과:
- `MERGE INTO target USING source ...` → reader로 라우팅 → `ERROR: read-only transaction`
- `COPY users FROM STDIN` → reader로 라우팅 → `ERROR: read-only transaction` (relay 코드는 있지만 라우팅이 잘못됨)
- `CALL my_procedure(1)` → reader로 라우팅 → 프로시저가 write하면 실패

추가로, `EXPLAIN ANALYZE INSERT INTO ...`는 실제로 INSERT를 실행하지만 string/AST 양쪽에서 read로 분류된다.

### 수정

**String parser** — `writeKeywords`에 추가:

```go
var writeKeywords = map[string]bool{
    // ... 기존 9개 ...
    "MERGE": true,
    "COPY":  true,  // COPY TO도 write로 분류 (안전한 기본값)
    "CALL":  true,
}
```

String parser에서 COPY TO를 read로 정밀 분류하려면 FROM/TO 파싱이 필요해서 복잡도 대비 효용이 낮다. 안전하게 모두 writer로 보낸다.

**AST parser** — `isWriteNode`에 노드 추가:

```go
case *pg_query.Node_MergeStmt:
    return true
case *pg_query.Node_CopyStmt:
    return n.CopyStmt.GetIsFrom()  // COPY FROM만 write, COPY TO는 read
case *pg_query.Node_CallStmt:
    return true
case *pg_query.Node_ExplainStmt:
    // EXPLAIN ANALYZE + write subquery만 write
    for _, opt := range n.ExplainStmt.GetOptions() {
        if de := opt.GetDefElem(); de != nil &&
           strings.ToLower(de.GetDefname()) == "analyze" {
            if n.ExplainStmt.GetQuery() != nil {
                return isWriteNode(n.ExplainStmt.GetQuery())
            }
        }
    }
    return false
```

AST parser는 CopyStmt의 `IsFrom` 필드로 방향을 정확히 구분할 수 있다. `EXPLAIN ANALYZE`는 options에서 `analyze` DefElem을 찾고, 내부 쿼리가 write인 경우에만 write로 분류한다. `EXPLAIN`만 쓰면 실제 실행하지 않으므로 read다.

---

## 4. Advisory lock 검출의 false positive

### 문제

`containsSessionAdvisoryLock`은 원본 쿼리에 바로 `strings.Contains`를 건다:

```go
func containsSessionAdvisoryLock(query string) bool {
    lower := strings.ToLower(query)
    return strings.Contains(lower, "advisory_lock") ||
           strings.Contains(lower, "advisory_unlock")
}
```

- `SELECT 'pg_advisory_lock'` → 문자열 리터럴 안의 텍스트에 반응 → **false positive**
- `/* advisory_unlock */ SELECT 1` → 주석 안의 텍스트에 반응 → **false positive**

`DetectSessionDependencyAST`도 AST를 먼저 체크하지만, advisory lock만은 string 검사로 폴백한다 ("function calls require walking the full expression tree"라는 주석과 함께). 그래서 AST 경로에서도 같은 false positive가 발생한다.

### 수정

```go
func containsSessionAdvisoryLock(query string) bool {
    lower := strings.ToLower(query)
    // Fast path: raw 쿼리에 "advisory"가 없으면 skip
    if !strings.Contains(lower, "advisory") {
        return false
    }
    // Slow path: 리터럴과 주석 제거 후 검사
    cleaned := strings.ToLower(stripComments(stripStringLiterals(query)))
    return strings.Contains(cleaned, "advisory_lock") ||
           strings.Contains(cleaned, "advisory_unlock")
}
```

99.9%의 쿼리는 "advisory"를 포함하지 않으므로 fast path에서 즉시 반환한다. 실제 advisory lock 호출이 있을 때만 `stripComments(stripStringLiterals())`의 비용을 지불한다.

순서가 중요하다: `stripStringLiterals`를 먼저 호출해야 한다. 문자열 안의 `/*`가 주석 시작으로 오인되는 것을 방지하기 위해서다. `stripStringLiterals`는 문자열 내용을 비우고 따옴표는 남기므로, 이후 `stripComments`가 안전하게 동작한다.

---

## 5. String parser가 주석 안 텍스트를 write 신호로 오인한다

### 문제

`isSideEffectfulSelect`와 `containsWriteKeyword`가 `stripStringLiterals`만 호출하고 `stripComments`는 호출하지 않는다:

```go
func isSideEffectfulSelect(query string) bool {
    upper := strings.ToUpper(stripStringLiterals(query))
    // "FOR UPDATE", "nextval(" 등을 검색
}

func containsWriteKeyword(query string) bool {
    upper := strings.ToUpper(stripStringLiterals(query))
    // INSERT, UPDATE 등을 검색
}
```

`/* FOR UPDATE */ SELECT 1`:
1. `stripStringLiterals` → 변화 없음 (문자열 리터럴이 없으므로)
2. `FOR UPDATE`가 주석 안에 있지만 그대로 매칭됨
3. `isSideEffectfulSelect` = true → `QueryWrite` → writer로 오라우팅

`WITH x AS (SELECT 1) /* UPDATE */ SELECT * FROM x`도 같은 문제다.

`classifyFast`는 `/*`를 발견하면 slow path로 넘기므로 이 쿼리들은 반드시 이 경로를 탄다. 그리고 `firstKeyword`는 내부적으로 `stripComments`를 호출해서 키워드 추출은 정확하다. 하지만 이후 `isSideEffectfulSelect(stmt)`에 원본 stmt이 전달된다.

### 수정

두 함수 모두 `stripComments`를 추가:

```go
func isSideEffectfulSelect(query string) bool {
    upper := strings.ToUpper(stripComments(stripStringLiterals(query)))
    // ...
}

func containsWriteKeyword(query string) bool {
    upper := strings.ToUpper(stripComments(stripStringLiterals(query)))
    // ...
}
```

Finding 4와 동일한 순서: `stripStringLiterals` → `stripComments`.

---

## 공통 패턴: "noise skip"의 일관성

5건의 발견을 관통하는 패턴이 있다. **키워드 매칭 전에 제거해야 할 "노이즈"의 범위가 함수마다 달랐다**:

| 함수 | 공백 | 주석 | 문자열 리터럴 |
|------|:----:|:----:|:------------:|
| `hasTxPrefix` (수정 전) | O | X | - |
| `firstKeyword` | O | O | - |
| `isSideEffectfulSelect` (수정 전) | - | X | O |
| `containsSessionAdvisoryLock` (수정 전) | - | X | X |

수정 후에는 모두 동일한 기준으로 노이즈를 제거한다:

| 함수 | 방식 |
|------|------|
| prefix 매칭 (hasTxPrefix, detect*) | `SkipLeadingNoise` (앞쪽만) |
| substring 매칭 (isSideEffectful*, advisory*) | `stripComments(stripStringLiterals())` (전체) |
| keyword 추출 (firstKeyword) | `stripComments` (기존 정상) |

앞쪽만 건너뛰는 `SkipLeadingNoise`가 `stripComments`보다 빠르다. 전체 문자열을 새로 만들지 않고 인덱스만 반환하기 때문이다. prefix 매칭에는 이쪽이 적합하다.

---

## 마무리

이번 라운드는 "파서가 정확한가?"를 집중적으로 파고들었다. 5건 모두 공격자가 의도적으로 주석을 붙이면 라우팅을 조작할 수 있는 문제였다:

1. **`/*x*/ BEGIN`** → 트랜잭션 없이 write 분산
2. **`/*x*/ SET`** → reader 세션 오염
3. **`MERGE INTO ...`** → reader 오라우팅
4. **`SELECT 'pg_advisory_lock'`** → 불필요한 session pin
5. **`/* FOR UPDATE */ SELECT 1`** → 불필요한 writer 라우팅

1~3은 보안/정합성 문제, 4~5는 성능 문제다. 근본 원인은 하나다: **SQL 텍스트에서 의미 있는 부분만 보려면, 주석과 리터럴을 먼저 제거해야 한다.** 이 원칙이 코드베이스 전체에 일관되게 적용되지 않았다.

`SkipLeadingNoise`와 `stripComments(stripStringLiterals())` 두 가지 도구로 통일했다. 앞으로 새 키워드 매칭 로직을 추가할 때도 이 패턴을 따르면 같은 실수를 반복하지 않을 것이다.
