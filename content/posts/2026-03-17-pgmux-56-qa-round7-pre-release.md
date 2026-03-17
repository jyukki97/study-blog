---
title: "Go로 PostgreSQL 프록시 만들기 (56) - QA 7차: 릴리즈 전 최종 코드 리뷰"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Race Condition", "Memory Leak", "Security"]
categories: ["Database"]
project: "pgmux"
description: "v1.0.0 릴리즈 직전, 전체 코드베이스를 엣지케이스까지 훑어 CopyBoth 고루틴 race, 캐시 인덱스 정합성 파손, Synthesizer 메모리 고갈 등 14건을 수정한다."
---

## 들어가며

QA 6차까지 파서 정확성을 잡았다. 이번에는 릴리즈 직전 **전체 코드베이스를 처음부터 끝까지** 훑는다. 엣지케이스, 동시성, 메모리, 보안 — 카테고리를 가리지 않고 14건을 찾아 수정했다.

심각도별로 3개 그룹으로 나뉜다:

| 그룹 | 건수 | 핵심 |
|------|------|------|
| HIGH | 4건 | CopyBoth race, rate limiter clock skew, SQL 에러 노출, 캐시 인덱스 파손 |
| MEDIUM | 5건 | 메시지 크기 제한, synthesizer 메모리, watcher 블로킹, parseSize 무경고, 테스트 fmt.Println |
| Parser 일관성 | 5건 | EXPLAIN ANALYZE, ABORT, 캐시 무효화 갭, Data API COPY, SET CONSTRAINTS |

---

## HIGH: 운영 장애를 유발할 수 있는 4건

### 1. CopyBoth 고루틴 race

PostgreSQL의 Logical Replication은 `CopyBoth` 서브프로토콜을 사용한다. 클라이언트→백엔드, 백엔드→클라이언트 두 방향을 동시에 릴레이해야 하므로 고루틴 2개를 띄운다:

```go
// 변경 전
errCh := make(chan error, 2)
go func() { errCh <- relayCopyData(clientConn, backendConn) }()
go func() { errCh <- relayCopyData(backendConn, clientConn) }()
err := <-errCh  // 하나만 기다림
return err
```

한쪽이 에러로 종료하면 **나머지 고루틴은 방치된다**. 반대편 소켓이 닫히면 결국 종료되지만, 그 사이에 닫힌 소켓에 쓰기를 시도하거나 이미 반환된 커넥션에 접근할 수 있다.

수정은 양쪽 모두 수거하는 것이다:

```go
err1 := <-errCh
err2 := <-errCh
if err1 != nil {
    return err1
}
return err2
```

### 2. Rate Limiter 시계 역행

Token Bucket rate limiter는 `time.Now()`의 차분으로 토큰을 채운다:

```go
elapsed := now.Sub(rl.lastTime)
rl.tokens += elapsed.Seconds() * rl.rate
```

NTP 보정으로 시계가 뒤로 가면 `elapsed`가 음수가 된다. 토큰이 음수로 빠져서 rate limiter가 모든 요청을 무기한 차단한다.

```go
if elapsed < 0 {
    elapsed = 0
}
```

한 줄이면 된다. 시계가 뒤로 가면 토큰을 추가하지 않을 뿐, 차감하지도 않는다.

### 3. Data API SQL 에러 노출

Data API에서 쿼리 실패 시 PostgreSQL 에러 메시지를 그대로 HTTP 응답에 넣고 있었다:

```go
writeError(w, http.StatusInternalServerError, err.Error())
// → {"error": "ERROR: relation \"users\" does not exist (SQLSTATE 42P01)"}
```

테이블 이름, 스키마 구조, PostgreSQL 버전 정보가 외부에 노출된다. 제네릭 메시지로 교체:

```go
writeError(w, http.StatusInternalServerError, "query execution failed")
```

### 4. 캐시 tableIndex 스테일 엔트리

캐시 `Set()`에서 기존 엔트리를 업데이트할 때, 이전 테이블 목록의 인덱스 참조를 제거하지 않았다:

```go
// 변경 전
if e, ok := c.items[key]; ok {
    e.result = result
    e.tables = tables  // 이전 tables의 tableIndex 참조가 남음
    // ...
}
```

시나리오:
1. 캐시 엔트리가 `tables: ["users"]`로 저장됨 → `tableIndex["users"]`에 키 등록
2. 같은 쿼리가 `tables: ["users", "orders"]`로 업데이트됨
3. `tableIndex["users"]`에 **이전 참조가 남아있음**
4. `users` 테이블 무효화 시, 이미 업데이트된 엔트리를 삭제 시도 — 키는 같으므로 문제없어 보이지만
5. **반대 케이스**: `tables: ["users", "orders"]` → `tables: ["orders"]`로 업데이트되면 `tableIndex["users"]`에 stale 참조가 영구히 남음
6. `users` 무효화 시 이 엔트리를 삭제하지만, 실제로는 `users`와 무관한 엔트리임 → **과잉 무효화**

`removeTableIndex` 헬퍼를 추가해서 업데이트 전에 이전 참조를 정리한다:

```go
func (c *Cache) removeTableIndex(key uint64, tables []string) {
    for _, table := range tables {
        if keys, ok := c.tableIndex[table]; ok {
            delete(keys, key)
            if len(keys) == 0 {
                delete(c.tableIndex, table)
            }
        }
    }
}
```

---

## MEDIUM: 운영 안정성 5건

### 5. 백엔드 메시지 크기 미검증

`relayUntilReady`에서 백엔드 메시지의 payload 길이를 읽고 바로 `make([]byte, payloadLen)`을 호출한다. 악의적이거나 손상된 백엔드가 `payloadLen = 2GB`를 보내면 OOM이 발생한다.

프로토콜 레이어에 이미 `MaxMessageSize` 상수가 있다. `ReadMessage`에서는 체크하지만 `relayUntilReady`의 수동 읽기 경로에는 빠져있었다:

```go
if payloadLen > protocol.MaxMessageSize {
    return fmt.Errorf("backend message too large: %d bytes (max %d)",
        payloadLen, protocol.MaxMessageSize)
}
```

### 6. Synthesizer 무한 증가

Prepared Statement Multiplexing의 `StatementStore`가 등록된 statement를 삭제하지 않으면 메모리가 계속 증가한다. `CloseStatement`가 있지만, 드라이버가 Close를 보내지 않거나 연결이 비정상 종료되면 누적된다.

10,000개 상한 + LRU 퇴거를 추가:

```go
const maxSynthStatements = 10000

func (s *StatementStore) RegisterStatement(name string, ...) {
    if len(s.statements) >= maxSynthStatements {
        oldest := s.order[0]
        s.order = s.order[1:]
        delete(s.statements, oldest)
    }
    s.statements[name] = stmt
    s.order = append(s.order, name)
}
```

### 7. Config watcher 블로킹 시작

`main.go`에서 `<-fw.Ready()`를 무조건 기다린다. 파일이 존재하지 않거나 권한이 없으면 `Start()`가 `readyCh`를 닫지 않고 에러를 반환한다. 그런데 `Start()`는 별도 고루틴에서 실행되므로 메인 고루틴이 `<-fw.Ready()`에서 영원히 블록된다.

```go
select {
case <-fw.Ready():
case <-ctx.Done():
    return ctx.Err()
case <-time.After(5 * time.Second):
    slog.Warn("config file watcher did not become ready within 5s, continuing")
}
```

### 8. parseSize 무경고 0 반환

`parseSize("invalid")` → 0. 설정 파일에 `max_result_size: "1mbb"` 같은 오타가 있으면 캐시가 결과를 저장하지 않지만, 왜 캐시가 안 되는지 알 수 없다. `slog.Warn`으로 경고를 남기도록 수정.

### 9. 테스트에서 fmt.Println 사용

`e2e_test.go`에서 `fmt.Println("proxy start/stop OK")` — `go test -v`가 아니면 출력 안 되고, 병렬 테스트 시 출력이 섞인다. `t.Log()`로 교체.

---

## Parser 일관성: String/AST 파서 동기화 5건

QA 6차에서 AST parser에 MERGE, COPY, CALL, EXPLAIN ANALYZE를 추가했다. 이번에는 **반대 방향** — string parser에도 같은 수정이 필요한 부분과, 양쪽에 공통으로 빠진 부분을 수정한다.

### 10. EXPLAIN ANALYZE write 감지 (string parser)

AST parser는 EXPLAIN ANALYZE + write subquery를 write로 분류하지만, string parser의 `classifyFast`는 EXPLAIN을 항상 read로 처리했다. `classifyFast`에서 EXPLAIN을 slow path로 넘기고, `isExplainAnalyzeWrite()` 함수를 추가.

### 11. ABORT 트랜잭션 키워드

PostgreSQL에서 `ABORT`는 `ROLLBACK`의 동의어다. `hasTxPrefix`, `updateTransactionState`, `containsTransactionKeyword` 세 곳에 추가.

### 12. 캐시 무효화 테이블 추출 갭

`extractTablesFromStmt`가 MERGE, COPY, EXPLAIN의 대상 테이블을 추출하지 못했다. write는 writer로 올바르게 라우팅되지만, 캐시 무효화가 누락되어 stale read가 발생할 수 있다.

string parser에 `extractCopyTable()`, `extractExplainTables()` 추가. AST parser에도 `extractWriteTables`에 MergeStmt, CopyStmt, ExplainStmt, CallStmt case 추가.

### 13. Data API COPY 차단

Data API는 HTTP request/response 구조다. COPY 프로토콜은 스트리밍이므로 HTTP에서 지원할 수 없다. COPY를 실행하면 백엔드가 CopyIn/CopyOut 메시지를 보내는데, Data API의 결과 파싱 로직은 이를 처리하지 못해 연결이 꼬인다.

입구에서 차단:

```go
sqlUpper := strings.ToUpper(strings.TrimSpace(req.SQL))
if strings.HasPrefix(sqlUpper, "COPY ") || strings.HasPrefix(sqlUpper, "COPY\t") {
    writeError(w, http.StatusBadRequest, "COPY is not supported via Data API")
    return
}
```

### 14. SET CONSTRAINTS false positive

`SET CONSTRAINTS ALL DEFERRED`는 트랜잭션 범위 명령이다. 그런데 session dependency detector가 `SET`으로 시작하는 모든 것을 잡아서 `FeatureSessionSet`으로 분류했다. `SET LOCAL`, `SET TRANSACTION`은 이미 제외되어 있었지만 `SET CONSTRAINTS`는 빠져있었다.

`detectSingleStmtDependency`와 `isSessionModifying` 양쪽에 추가.

---

## 검증

```
$ go build ./...     ✓
$ go vet ./...       ✓
$ go test ./internal/...
ok  internal/admin       0.013s
ok  internal/audit       1.015s
ok  internal/cache       0.004s
ok  internal/config      7.535s
ok  internal/dataapi     0.012s
ok  internal/digest      0.007s
ok  internal/metrics     0.003s
ok  internal/mirror      0.008s
ok  internal/pool        3.013s
ok  internal/protocol    0.003s
ok  internal/proxy       0.004s
ok  internal/resilience  0.103s
ok  internal/router      0.009s
ok  internal/telemetry   0.003s
14/14 PASS
```

---

## 마무리

14건을 심각도별로 정리하면:

- **HIGH 4건**: 동시성 (CopyBoth race), 시계 (rate limiter), 보안 (SQL 에러 노출), 데이터 정합성 (캐시 인덱스)
- **MEDIUM 5건**: OOM 방어, 메모리 상한, 블로킹 방지, 경고 로그, 테스트 위생
- **Parser 5건**: string/AST 파서 간 분류 동기화

HIGH 4건의 공통점은 "정상 경로에서는 발생하지 않지만, 엣지 조건에서 조용히 깨진다"는 것이다. CopyBoth는 Logical Replication을 쓸 때만, rate limiter clock skew는 NTP 보정 시에만, 캐시 인덱스는 같은 쿼리의 테이블 구성이 바뀔 때만 발생한다. 이런 버그는 테스트보다 코드 리뷰에서 잡히는 경우가 많다.

이것으로 릴리즈 전 코드 리뷰가 끝났다. 다음 글에서는 CHANGELOG 작성과 릴리즈 체크리스트를 정리한다.
