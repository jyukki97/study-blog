---
title: "Go로 PostgreSQL 프록시 만들기 (15) - 보안 QA와 취약점 수정"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Security", "QA", "Cache", "Firewall"]
categories: ["Database"]
description: "QA 과정에서 발견된 4건의 보안 취약점 — 캐시 충돌로 인한 개인정보 유출, 무한 재귀, 방화벽 우회, 힌트 주입 — 을 분석하고 수정한다."
---

## 들어가며

지난 글에서 pg_query_go를 도입하여 AST 기반 쿼리 분류, 쿼리 방화벽, 시맨틱 캐시 키를 구현했다. 코드를 작성하고 단위 테스트를 통과시켰을 때는 꽤 만족스러웠다. 그런데 QA에서 올라온 리포트를 보고 식은땀이 났다.

**Critical 2건, Major 2건. 총 4건의 보안 취약점.**

한 건은 다른 유저의 개인정보가 노출되는 사고, 한 건은 설정 하나로 서버가 죽는 버그, 나머지 두 건은 보안 기능 자체를 우회하는 취약점이었다. 코드를 짤 때는 "잘 돌아간다"에 집중하느라 놓친 것들이었다. 이번 글에서는 각 취약점의 원인을 분석하고 어떻게 수정했는지 정리한다.

---

## 1. 캐시 충돌로 인한 개인정보 유출 (CRITICAL)

### 문제

시맨틱 캐시 키에 `pg_query.FingerprintToUInt64`를 사용했다. 이 함수는 쿼리의 **구조적 동등성**을 판단하기 위해 리터럴 값을 모두 제거한다.

```go
// 수정 전
func SemanticCacheKey(query string) uint64 {
    fp, _ := pg_query.FingerprintToUInt64(query)
    return fp  // 리터럴 값이 제거된 구조 해시
}
```

문제는 이 특성이 캐시 키로는 치명적이라는 점이다.

```sql
-- A 유저
SELECT * FROM payment_logs WHERE user_id = 1;
-- B 유저
SELECT * FROM payment_logs WHERE user_id = 2;
```

두 쿼리는 구조가 같으므로 **동일한 캐시 키**가 생성된다. A 유저의 결제 내역이 캐시에 저장된 상태에서 B 유저가 같은 쿼리를 보내면, B 유저에게 A 유저의 결제 내역이 그대로 반환된다.

### 원인 분석

Fingerprint의 용도를 잘못 이해한 것이 근본 원인이다. Fingerprint는 **쿼리 통계 집계**를 위해 설계되었다. "이 구조의 쿼리가 몇 번 실행되었는가"를 추적하는 용도이지, 캐시 키로 쓰라고 만든 것이 아니다. pg_query의 공식 문서에도 이 점이 명시되어 있다.

시맨틱 캐시 키가 원했던 것은 "공백과 대소문자가 달라도 같은 쿼리면 같은 키"였는데, Fingerprint는 거기에 "리터럴 값이 달라도 같은 키"까지 포함해버렸다.

### 수정

`FingerprintToUInt64` 대신 `Parse` + `Deparse` 조합을 사용했다. `Deparse`는 AST를 다시 SQL 문자열로 변환하는데, 이 과정에서 공백과 대소문자가 정규화되면서 리터럴 값은 그대로 보존된다.

```go
// 수정 후
func SemanticCacheKey(query string) uint64 {
    tree, err := pg_query.Parse(query)
    if err != nil {
        return CacheKey(query)
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

이제 `WHERE user_id = 1`과 `WHERE user_id = 2`는 다른 캐시 키를 생성하고, `SELECT * FROM users`와 `select  *  from  users`는 같은 캐시 키를 생성한다.

```go
func TestSemanticCacheCollision(t *testing.T) {
    key1 := SemanticCacheKey("SELECT * FROM users WHERE id = 1")
    key2 := SemanticCacheKey("SELECT * FROM users WHERE id = 2")
    if key1 == key2 {
        t.Error("different literals must produce different cache keys")
    }
}

func TestSemanticCacheEquivalence(t *testing.T) {
    key1 := SemanticCacheKey("SELECT * FROM users WHERE id = 1")
    key2 := SemanticCacheKey("select  *  from  users  where  id  =  1")
    if key1 != key2 {
        t.Error("equivalent queries should produce the same cache key")
    }
}
```

---

## 2. 설정 변경으로 서버 즉사 (CRITICAL)

### 문제

```go
func (s *Server) cacheKey(query string) uint64 {
    if s.cfg.Routing.ASTParser {
        return cache.SemanticCacheKey(query)
    }
    return s.cacheKey(query) // 자기 자신을 호출!
}
```

`ASTParser = true`일 때는 정상 동작하지만, `false`로 설정하면 `s.cacheKey`가 자기 자신을 무한 재귀 호출한다. 단 1건의 쿼리만 들어와도 즉시 stack overflow로 서버가 패닉한다.

### 원인 분석

단순 오타다. `cache.CacheKey(query)`를 호출해야 하는데 `s.cacheKey(query)`를 타이핑했다. Go에서 메서드 이름과 패키지 함수 이름이 같을 때 발생하기 쉬운 실수인데, 컴파일러가 잡아주지 못한다. 타입이 같고 시그니처가 호환되기 때문이다.

### 수정

```go
func (s *Server) cacheKey(query string) uint64 {
    if s.cfg.Routing.ASTParser {
        return cache.SemanticCacheKey(query)
    }
    return cache.CacheKey(query) // 패키지 함수 호출
}
```

한 줄 수정이지만, `ASTParser = false`로 배포했을 때 서비스 전면 장애로 이어질 수 있는 버그였다.

### 교훈

이런 유형의 버그를 잡으려면:
- `go vet`이나 정적 분석 도구(`staticcheck`)로 무한 재귀를 탐지할 수 있다
- 두 가지 코드 경로(AST on/off)에 대해 각각 테스트를 작성해야 한다
- 메서드 이름과 패키지 함수 이름이 겹치지 않게 네이밍하는 것이 안전하다

---

## 3. CTE로 우회되는 쿼리 방화벽 (MAJOR)

### 문제

방화벽의 `checkNode` 함수가 top-level 노드만 검사하고 있었다.

```go
func checkNode(node *pg_query.Node, cfg FirewallConfig) FirewallResult {
    switch n := node.GetNode().(type) {
    case *pg_query.Node_DeleteStmt:
        // WHERE 없는 DELETE 차단
    case *pg_query.Node_UpdateStmt:
        // WHERE 없는 UPDATE 차단
    case *pg_query.Node_DropStmt:
        // DROP 차단
    case *pg_query.Node_TruncateStmt:
        // TRUNCATE 차단
    // SelectStmt는? → 검사 안 함!
    }
}
```

공격자가 CTE를 사용하면 방화벽을 완전히 우회할 수 있다.

```sql
WITH bypass AS (DELETE FROM users) SELECT 1;
```

이 쿼리의 루트 노드는 `SelectStmt`이고, `checkNode`에 `SelectStmt` 케이스가 없으므로 방화벽을 그대로 통과한다.

### 아이러니

재미있는 것은, 쿼리 **분류** 로직(`parser_ast.go`)에서는 이미 CTE 내부의 write를 감지하고 있었다는 점이다. `isWriteNode`에 `SelectStmt` → `WithClause` → `CommonTableExpr` 재귀 검사가 구현되어 있었다. 방화벽에만 같은 로직을 빠뜨린 것이다.

### 수정

`checkNode`에 `SelectStmt` 케이스를 추가하여 CTE 내부를 재귀적으로 검사한다.

```go
case *pg_query.Node_SelectStmt:
    if wc := n.SelectStmt.GetWithClause(); wc != nil {
        for _, cte := range wc.GetCtes() {
            if ce := cte.GetCommonTableExpr(); ce != nil {
                if q := ce.GetCtequery(); q != nil {
                    if result := checkNode(q, cfg); result.Blocked {
                        return result
                    }
                }
            }
        }
    }
```

---

## 4. Dollar Quoting으로 우회되는 힌트 추출 (MAJOR)

### 문제

AST 파서를 도입했지만, 라우팅 힌트를 추출하는 부분은 여전히 문자열 기반의 레거시 코드를 사용하고 있었다.

```go
func ClassifyAST(query string) QueryType {
    // AST 모드인데 문자열 파서의 extractHint를 사용!
    if hint := extractHint(query); hint != "" {
        // ...
    }
}
```

`extractHint`는 `stripStringLiterals`라는 문자열 치환 함수로 문자열 리터럴을 제거한 뒤 주석을 파싱한다. 이 방식은 Dollar Quoting 등의 edge case에서 우회될 수 있다.

### 수정

pg_query의 렉서(`Scan`)를 사용하여 실제 SQL 주석만 정확히 추출하는 `extractHintAST`를 구현했다.

```go
func extractHintAST(query string) string {
    result, err := pg_query.Scan(query)
    if err != nil {
        return extractHint(query) // fallback
    }
    for _, token := range result.GetTokens() {
        if token.GetToken() == pg_query.Token_C_COMMENT {
            comment := query[token.GetStart():token.GetEnd()]
            matches := hintRegex.FindStringSubmatch(comment)
            if len(matches) >= 2 {
                return matches[1]
            }
        }
    }
    return ""
}
```

`pg_query.Scan`은 PostgreSQL의 렉서를 직접 사용하므로 Dollar Quoting, 문자열 리터럴, 중첩 주석 등을 정확히 처리한다. 문자열 안에 `/* route:writer */`가 있어도 주석 토큰이 아닌 문자열 토큰으로 분류되므로 힌트로 인식되지 않는다.

```go
func TestClassifyAST_DollarQuotingHintInjection(t *testing.T) {
    // Dollar-quoted 문자열 안의 힌트는 무시되어야 함
    query := `SELECT $$ /* route:writer */ $$ FROM readonly_table`
    result := ClassifyAST(query)
    if result != QueryRead {
        t.Error("hint inside dollar quote should not affect routing")
    }
}
```

---

## 배운 점

### 기능의 용도를 정확히 이해하기

Fingerprint 캐시 충돌은 라이브러리 함수의 용도를 제대로 확인하지 않은 데서 비롯됐다. `FingerprintToUInt64`라는 이름이 "쿼리의 고유 식별자를 만들어준다"처럼 보여서 캐시 키로 쓰기 딱 좋다고 생각했지만, 실제로는 리터럴을 제거하는 통계용 함수였다. 라이브러리를 사용할 때는 API 이름만 보고 추측하지 말고 문서와 소스를 반드시 확인해야 한다.

### 모든 코드 경로에 대한 테스트

무한 재귀 버그는 `ASTParser = true`인 기본 경로만 테스트하고 `false` 경로를 놓쳐서 발생했다. 설정 분기가 있으면 양쪽 모두에 대한 테스트를 작성해야 한다. 특히 feature flag처럼 런타임에 동작이 바뀌는 코드는 더욱 그렇다.

### 보안 기능은 일관되게 적용하기

방화벽 CTE 우회와 힌트 주입은 "새로운 보안 로직을 추가했지만 기존 코드의 일부를 업데이트하지 않은" 패턴이다. 쿼리 분류에서는 CTE를 처리하면서 방화벽에서는 빠뜨렸고, AST 파서를 도입하면서 힌트 추출은 레거시 그대로 놔뒀다. 보안 관련 로직을 변경할 때는 같은 패턴이 적용되어야 하는 다른 코드 경로가 없는지 반드시 점검해야 한다.

### QA의 가치

4건 모두 단위 테스트를 통과한 코드였다. "테스트가 통과한다"와 "버그가 없다"는 다른 이야기다. 테스트는 작성자가 예상한 시나리오만 커버하고, 공격적인 QA는 작성자가 예상하지 못한 시나리오를 찾아낸다. 특히 보안 관련 코드에서는 "정상 동작"이 아닌 "우회 가능성"을 중심으로 테스트하는 시각이 필수적이다.

---

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
