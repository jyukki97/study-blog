---
title: "Go로 PostgreSQL 프록시 만들기 (31) - 캐시 포맷 충돌과 HTTP 서버 수명주기"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Cache", "HTTP", "Graceful Shutdown", "QA"]
categories: ["Database"]
description: "QA 4차 리포트 5건 — 캐시 키 네임스페이스 부재로 JSON/wire 응답 충돌, 읽기 캐시 무효화 실종, balancer 상태 초기화, HTTP 서버 lifecycle 미관리, AST 재파싱 — 의 원인과 수정 과정을 정리한다."
---

## 들어가며

P30에서 AST 라우팅 사각지대와 캐시 무효화 실종을 수정한 직후, QA 4차 리포트가 도착했다. 이번 라운드의 핵심은 **캐시가 프로토콜을 깨뜨릴 수 있다**는 Critical 급 발견이었다. Data API, proxy simple query, extended query 세 경로가 동일한 캐시를 공유하면서 전혀 다른 응답 포맷을 저장하고 있었다.

총 5건: 높음 2건 + 중간 3건.

| # | 심각도 | 요약 | PR |
|---|--------|------|----|
| 1 | **높음** | 캐시 키에 응답 포맷 namespace가 없어 JSON/wire 충돌 | [#158](https://github.com/jyukki97/pgmux/pull/158) |
| 2 | **높음** | Data API 읽기 캐시가 write table extractor를 사용하여 무효화 불가 | [#159](https://github.com/jyukki97/pgmux/pull/159) |
| 3 | 중간 | Hot reload가 balancer의 healthy/replayLSN 상태를 초기화 | [#162](https://github.com/jyukki97/pgmux/pull/162) |
| 4 | 중간 | HTTP 서버(metrics/admin/data_api)에 lifecycle 관리 없음 | [#161](https://github.com/jyukki97/pgmux/pull/161) |
| 5 | 중간 | read cache path에서 AST 재파싱 | [#160](https://github.com/jyukki97/pgmux/pull/160) |

---

## 버그 1: 캐시 키 네임스페이스 부재 — JSON이 wire로 (높음)

### 증상

캐시 활성화 + Data API와 proxy를 동시에 사용하면, proxy simple query 클라이언트가 JSON 바이트를 PG wire 응답으로 받아 프로토콜이 깨진다.

### 원인

세 경로가 동일한 `cache.Cache` 인스턴스를 공유하며, 같은 SQL에 대해 동일한 캐시 키(FNV-1a 해시)를 생성한다. 그런데 저장하는 응답 포맷이 각기 다르다:

| 경로 | 저장 포맷 | 코드 |
|------|-----------|------|
| Data API | `json.Marshal(QueryResponse{...})` | `handler.go:282` |
| Proxy simple read | PG wire bytes (RowDesc+DataRow+...+ReadyForQuery) | `query_read.go:138` |
| Extended query | PG wire bytes (ParseComplete+BindComplete+...) | `query_extended.go:108` |

```
시나리오:
1. Data API: SELECT * FROM users → 캐시에 JSON 저장 (key=0xABCD)
2. Proxy client: SELECT * FROM users → 같은 키로 캐시 HIT
3. clientConn.Write(cached) → JSON 바이트가 PG wire로 전송
4. PostgreSQL 클라이언트: 프로토콜 파싱 실패 → 연결 끊김
```

proxy simple read의 캐시 반환 코드가 바이트를 그대로 소켓에 쏘기 때문에, 포맷 검증 없이 무조건 전송된다:

```go
// query_read.go:33 — 포맷 검증 없이 raw write
if cached := s.queryCache.Get(key); cached != nil {
    _, err := clientConn.Write(cached)
    return err
}
```

### 수정

XOR 기반 네임스페이스를 캐시 키에 혼합한다:

```go
// internal/cache/cache.go
const (
    NSProxyWire uint64 = 0                    // 기본값 (proxy simple query)
    NSDataAPI   uint64 = 0xa5a5a5a5a5a5a5a5  // Data API JSON
    NSExtended  uint64 = 0x5a5a5a5a5a5a5a5a  // extended query wire
)

func WithNamespace(key uint64, ns uint64) uint64 {
    return key ^ ns
}
```

각 경로에서 캐시 GET/SET 시 namespace를 적용:

```go
// Data API (handler.go)
key := cache.WithNamespace(s.cacheKeyParsed(sql, pq), cache.NSDataAPI)

// Extended query (query_extended.go)
key := cache.WithNamespace(s.cacheKey(query), cache.NSExtended)

// Proxy simple read — NS=0이므로 기존 코드 변경 없음
```

동일 SQL이라도 경로별로 독립된 캐시 공간을 갖게 되어, 포맷 충돌이 원천 차단된다.

### 왜 XOR인가?

namespace 상수가 0이면 기존 키와 동일 (backward compatible), 0이 아니면 완전히 다른 키 공간으로 분리된다. 해시 함수를 다시 돌리는 것보다 비용이 제로에 가깝고, 구현도 한 줄이다. 두 namespace 상수의 비트 패턴이 서로 다르면 충돌 확률은 무시할 수 있다.

---

## 버그 2: Data API 읽기 캐시 무효화 실종 (높음)

### 증상

Data API로 캐시된 SELECT 결과가 같은 테이블에 write가 와도 TTL까지 stale하게 유지된다.

### 원인

`executeRead`에서 캐시 저장 시 `extractTablesParsed`를 호출하는데, 이 함수는 **write table extractor**를 사용한다:

```go
// handler.go:283 — 수정 전
tables := s.extractTablesParsed(sql, pq)
// → ExtractTablesASTWithTree → extractTablesFromTree → extractWriteTables
// → INSERT/UPDATE/DELETE 대상 테이블만 수집
```

SELECT 쿼리에 대해 write table extractor는 당연히 빈 배열을 반환한다. 결과적으로 `queryCache.Set(key, data, [])` — 테이블 인덱스가 비어 있으므로 `InvalidateTable("users")`가 호출되어도 이 엔트리를 찾지 못한다.

반면 proxy 경로(`query_read.go:137`)는 올바르게 `extractReadQueryTables`(FROM/JOIN 테이블 수집)를 사용하고 있었다. Data API만 잘못된 함수를 호출하고 있었다.

### 수정

Data API에 `extractReadTablesParsed` 메서드를 추가하고, `executeRead`에서 사용:

```go
// handler.go — 수정 후
tables := s.extractReadTablesParsed(sql, pq)
// → ExtractReadTablesASTWithTree → extractReadTablesFromTree
// → WalkNodes로 모든 RangeVar (FROM/JOIN) 수집
```

이를 위해 `router/parser_ast.go`에도 `ExtractReadTablesASTWithTree`와 `extractReadTablesFromTree`를 추가했다. 기존 `ExtractReadTablesAST`도 `extractReadTablesFromTree`를 내부 호출하도록 리팩토링하여 코드 중복을 제거했다.

---

## 버그 3: Hot reload가 balancer 상태를 초기화 (중간)

### 증상

설정 reload 직후 (1) 직전에 unhealthy였던 reader가 잠깐 선택 대상이 되고, (2) causal consistency read가 writer fallback으로 몰린다.

### 원인

`UpdateBackends`가 매번 새 `Backend` 구조체를 생성하며 `healthy=true`, `replayLSN=0`으로 초기화한다:

```go
// balancer.go:105 — 수정 전
func (r *RoundRobin) UpdateBackends(addrs []string) {
    backends := make([]*Backend, len(addrs))
    for i, addr := range addrs {
        b := &Backend{Addr: addr}
        b.healthy.Store(true)  // 죽어있던 reader도 healthy로 리셋
        backends[i] = b        // replayLSN = 0
    }
    r.mu.Lock()
    r.backends = backends
    r.mu.Unlock()
}
```

`replayLSN=0`이 되면 `NextWithLSN(minLSN)`에서 모든 reader가 LSN 조건을 만족하지 못하게 되어, 다음 LSN poll 주기(1초)까지 빈 문자열 반환 → writer fallback이 발생한다.

### 수정

기존 backend 맵을 빌드하여 addr가 동일한 경우 상태를 복사한다:

```go
// balancer.go — 수정 후
func (r *RoundRobin) UpdateBackends(addrs []string) {
    r.mu.RLock()
    oldMap := make(map[string]*Backend, len(r.backends))
    for _, b := range r.backends {
        oldMap[b.Addr] = b
    }
    r.mu.RUnlock()

    backends := make([]*Backend, len(addrs))
    for i, addr := range addrs {
        if old, ok := oldMap[addr]; ok {
            backends[i] = old  // 기존 상태 보존
        } else {
            b := &Backend{Addr: addr}
            b.healthy.Store(true)
            backends[i] = b
        }
    }
    r.mu.Lock()
    r.backends = backends
    r.mu.Unlock()
}
```

---

## 버그 4: HTTP 서버에 수명주기 관리 없음 (중간)

### 증상

- 포트 충돌 시 프로세스가 부분 성공 상태로 실행됨 (proxy는 뜨지만 admin은 안 뜸)
- 종료 시 in-flight HTTP 요청이 drain되지 않음

### 원인

세 HTTP 서버(metrics, admin, data_api)가 모두 goroutine fire-and-forget으로 시작된다:

```go
// main.go — 수정 전
go func() {
    if err := http.ListenAndServe(addr, mux); err != nil && err != http.ErrServerClosed {
        slog.Error("server error", "error", err)  // 로그만 남기고 끝
    }
}()
```

`http.ListenAndServe`는 `net.Listen` + `http.Serve`를 한 번에 수행하므로, bind 실패가 goroutine 내부에서만 관찰된다. main goroutine은 이 에러를 전혀 모른 채 `srv.Start(ctx)`로 진행한다.

또한 `http.ListenAndServe`로 생성된 서버는 `*http.Server` 핸들이 외부에 노출되지 않아 `Shutdown()`을 호출할 방법이 없다.

### 수정

1. **Eager bind**: `net.Listen`으로 먼저 바인딩하여 포트 충돌 시 `run()` 자체가 에러를 반환
2. **`*http.Server` 노출**: admin, dataapi에 `HTTPServer()` 메서드 추가
3. **Graceful shutdown**: context 취소 시 모든 HTTP 서버에 `Shutdown(5s)` 호출
4. **Runtime 에러 전파**: `httpErrCh`로 런타임 에러 수신 → context cancel

```go
// main.go — 수정 후 (핵심)
ln, err := net.Listen("tcp", cfg.Admin.Listen)
if err != nil {
    return fmt.Errorf("admin server bind %s: %w", cfg.Admin.Listen, err)
}
httpServers = append(httpServers, adminHTTP)
go func() {
    if err := adminHTTP.Serve(ln); err != nil && err != http.ErrServerClosed {
        httpErrCh <- fmt.Errorf("admin server: %w", err)
    }
}()

// Graceful shutdown
go func() {
    <-ctx.Done()
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    for _, s := range httpServers {
        s.Shutdown(shutdownCtx)
    }
}()
```

---

## 버그 5: read cache path AST 재파싱 (중간)

### 증상

성능 문제. AST mode + cache-enabled read 트래픽에서 불필요한 재파싱이 발생한다.

### 원인

`handleReadQueryTraced`에서 캐시 키 생성에는 `pq`(pre-parsed tree)를 사용하면서, 테이블 추출에는 raw SQL을 다시 파싱하고 있었다:

```go
// query_read.go — 수정 전
key := s.cacheKeyParsed(query, pq)         // ✓ pq 재활용
tables := s.extractReadQueryTables(query)  // ✗ 내부에서 ParseSQL(query) 다시 호출
```

벤치마크에서 `SemanticCacheKey`(재파싱)가 32.6μs, `SemanticCacheKeyWithTree`(tree 재활용)가 16.0μs였으므로, 테이블 추출도 같은 수준의 절감을 기대할 수 있다.

### 수정

`extractReadQueryTablesParsed` 메서드를 추가하고 `handleReadQueryTraced`에서 사용:

```go
// helpers.go
func (s *Server) extractReadQueryTablesParsed(query string, pq *router.ParsedQuery) []string {
    if s.getConfig().Routing.ASTParser && pq != nil {
        return router.ExtractReadTablesASTWithTree(pq)
    }
    return s.extractReadQueryTables(query)
}

// query_read.go — 수정 후
tables := s.extractReadQueryTablesParsed(query, pq)  // ✓ pq 재활용
```

---

## 교훈

### 1. 공유 캐시의 키 공간을 신뢰하지 말 것

여러 경로가 하나의 캐시를 공유할 때, "같은 SQL = 같은 키 = 같은 응답"이라는 가정은 **응답 포맷이 동일할 때만** 성립한다. 포맷이 다르면 키 공간을 분리해야 한다. 이건 HTTP 캐시에서 `Vary` 헤더가 하는 역할과 정확히 같다.

### 2. 추출 함수의 이름이 비슷하면 잘못 쓰기 쉽다

`extractTables`와 `extractReadTables`는 이름만 보면 차이가 불분명하다. 전자는 write 대상 테이블, 후자는 FROM/JOIN 테이블을 수집한다. Data API 개발 시 "테이블 추출이 필요하니까 extractTables를 쓰자"라고 생각한 것이 버그의 원인이었다.

### 3. fire-and-forget goroutine은 에러를 삼킨다

`go func() { if err := serve(); ... }()`는 편리하지만, main goroutine에 에러를 전파할 수 없다. 특히 서버 바인딩처럼 "실패하면 프로세스를 올리면 안 되는" 작업은 goroutine 시작 전에 eager bind로 검증해야 한다.

---

## 마무리

이번 QA 4차에서 가장 임팩트가 컸던 건 역시 캐시 포맷 충돌(버그 1)이다. 프로토콜 레벨 corruption은 디버깅이 극도로 어려운데, 증상이 "가끔 연결이 끊긴다" 수준이라 재현도 쉽지 않다. 캐시 활성화 + Data API 동시 사용이라는 특정 조건에서만 발생하기 때문이다.

5건의 수정으로 pgmux의 캐시 안정성, 운영 안정성, 성능이 한 단계 더 개선되었다. 다음 단계는 로드맵에 따라 Phase 20+ 고도화 작업으로 넘어갈 예정이다.
