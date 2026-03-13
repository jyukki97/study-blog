---
title: "Go로 PostgreSQL 프록시 만들기 (29) - WriteHeader 이후 헤더 동결과 테스트가 못 잡는 버그"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "HTTP", "net/http", "WriteHeader", "Data Race", "Testing"]
categories: ["Database"]
description: "WriteHeader 호출 이후 Content-Type이 사라지는 버그, SetReloadFunc data race, httptest.ResponseRecorder가 감지하지 못하는 회귀의 원인과 수정 과정을 정리한다."
---

## 들어가며

P28에서 `/admin/reload`의 HTTP 상태 코드를 200에서 500으로 수정한 직후, QA 팀이 후속 검토 결과를 보내왔다.

> `WriteHeader(500)` 호출 뒤 `writeJSON()`이 `Content-Type`을 설정합니다. Go net/http에서는 WriteHeader 이후 헤더 변경이 반영되지 않을 수 있어서, JSON body를 보내면서도 `Content-Type: application/json`이 빠질 가능성이 있습니다. **현재 테스트는 이 회귀를 잡지 못합니다.**

P28의 수정이 새로운 버그를 만든 것이다. 코드 리뷰 결과, 관련 엣지케이스 2건도 추가로 발견했다.

---

## 버그 1: WriteHeader 이후 Content-Type 동결

### 증상

`/admin/reload` 에러 응답의 HTTP body는 JSON인데, `Content-Type: application/json` 헤더가 없다. 클라이언트가 응답을 `text/plain`으로 해석할 수 있다.

### 원인

P28에서 에러 분기에 `WriteHeader(500)`을 추가했다.

```go
// internal/admin/admin.go — P28 수정 후 상태
if err := fn(); err != nil {
    slog.Error("admin: reload failed", "error", err)
    w.WriteHeader(http.StatusInternalServerError)  // 1) 상태 코드 설정
    writeJSON(w, map[string]any{...})               // 2) Content-Type 설정 시도
    return
}
```

`writeJSON`의 구현:

```go
func writeJSON(w http.ResponseWriter, v any) {
    w.Header().Set("Content-Type", "application/json")  // 이미 늦었다
    json.NewEncoder(w).Encode(v)
}
```

Go `net/http` [문서](https://pkg.go.dev/net/http#ResponseWriter)는 명확하다:

> Changing the header map after a call to WriteHeader (or Write) has no effect unless the HTTP status code was of the 1xx class or the modified headers are trailers.

`WriteHeader(500)` 이후의 `Header().Set()`은 문서상 **무효**다. Content-Type 없이 JSON body만 전송된다.

### 수정

Content-Type을 WriteHeader **전에** 설정하고, `writeJSON` 대신 직접 인코딩한다.

```go
if err := fn(); err != nil {
    slog.Error("admin: reload failed", "error", err)
    w.Header().Set("Content-Type", "application/json")          // 먼저
    w.WriteHeader(http.StatusInternalServerError)                // 그 다음
    json.NewEncoder(w).Encode(map[string]any{                    // 마지막
        "status": "error", "error": err.Error(),
    })
    return
}
```

순서는 항상: **Header → WriteHeader → Write**.

### 교훈

Go `net/http`에서 `WriteHeader`는 헤더를 "동결"한다. `writeJSON` 같은 헬퍼가 Content-Type 설정과 body 쓰기를 묶고 있으면, 에러 경로에서 `WriteHeader`를 먼저 호출하는 순간 헬퍼의 헤더 설정이 무효화된다. **상태 코드가 200이 아닌 경로에서는 헬퍼를 쓰지 말고 직접 순서를 제어해야 한다.**

---

## 버그 2: SetReloadFunc data race

### 증상

`go test -race`는 통과하지만, `SetReloadFunc`과 `handleReload`가 동시에 호출되면 잠재적 data race가 존재한다.

### 원인

```go
// 뮤텍스 없이 쓰기
func (s *Server) SetReloadFunc(fn func() error) {
    s.reloadFunc = fn
}

// RLock으로 읽기
func (s *Server) handleReload(w http.ResponseWriter, r *http.Request) {
    s.mu.RLock()
    fn := s.reloadFunc
    s.mu.RUnlock()
    // ...
}
```

`SetReloadFunc`이 `reloadFunc` 필드를 뮤텍스 없이 쓴다. `handleReload`는 `RLock`으로 읽는다. 동시 호출 시 Go의 메모리 모델을 위반하는 data race다.

또한 `handleReload`가 `RLock`을 사용하므로, 여러 요청이 동시에 reload를 실행할 수 있다. 설정 리로드는 여러 컴포넌트를 교체하는 작업이므로, 동시에 두 번 실행되면 예측 불가능한 상태가 될 수 있다.

### 수정

두 곳 모두 `Lock()`으로 통일한다.

```go
func (s *Server) SetReloadFunc(fn func() error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.reloadFunc = fn
}

func (s *Server) handleReload(w http.ResponseWriter, r *http.Request) {
    // ...
    s.mu.Lock()
    fn := s.reloadFunc
    if fn == nil {
        s.mu.Unlock()
        http.Error(w, "reload not configured", http.StatusServiceUnavailable)
        return
    }
    defer s.mu.Unlock()

    if err := fn(); err != nil {
        // reload 실패 처리
    }
    // ...
}
```

`Lock()`을 reload 실행 중에도 유지하므로:
- `SetReloadFunc`과의 data race 방지
- 동시 reload 요청 직렬화

`fn == nil` 분기에서 `defer` 대신 명시적 `Unlock()`을 쓴 이유: `http.Error` 이후 바로 return하므로, `defer` 스택에 쌓을 필요 없이 즉시 해제한다. 정상 분기에서는 `defer`로 reload 완료까지 뮤텍스를 유지한다.

### 교훈

`sync.RWMutex`에서 읽기 쪽만 `RLock`하고 쓰기 쪽을 보호하지 않으면, 뮤텍스가 없는 것과 같다. **읽기/쓰기 양쪽 모두 잠금이 있어야** 뮤텍스의 의미가 있다.

---

## 버그 3: httptest.ResponseRecorder의 맹점

### 증상

버그 1의 Content-Type 누락은 기존 테스트(`TestHandleReload_Error`)가 **감지하지 못했다**. 테스트가 통과하는데 실제 HTTP 응답에서는 헤더가 빠진다.

### 원인

기존 테스트는 `httptest.ResponseRecorder`를 사용한다.

```go
w := httptest.NewRecorder()
srv.handleReload(w, req)

// 상태 코드와 body만 확인 — Content-Type은 확인하지 않음
if w.Code != http.StatusInternalServerError { ... }
json.NewDecoder(w.Body).Decode(&resp)
```

여기서 `Content-Type`을 확인하더라도 문제를 잡을 수 없다. `ResponseRecorder`는 메모리상의 `HeaderMap`을 직접 노출하기 때문에, `WriteHeader` 이후에 설정한 헤더도 테스트에서는 보인다. 실제 TCP 소켓 위의 `http.ResponseWriter`와 달리, **WriteHeader-이후-헤더-동결 규칙을 강제하지 않는다.**

이것이 핵심이다: **ResponseRecorder는 real HTTP 동작의 완전한 시뮬레이션이 아니다.**

### 수정

`httptest.NewServer`로 실제 HTTP 서버를 띄우고, `http.Client`로 요청을 보내는 테스트를 추가한다.

```go
func TestHandleReload_Error_ContentType(t *testing.T) {
    srv, _ := testServer()
    srv.SetReloadFunc(func() error {
        return fmt.Errorf("config parse error")
    })

    ts := httptest.NewServer(http.HandlerFunc(srv.handleReload))
    defer ts.Close()

    resp, err := http.Post(ts.URL, "", nil)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusInternalServerError {
        t.Errorf("status = %d, want 500", resp.StatusCode)
    }

    ct := resp.Header.Get("Content-Type")
    if !strings.HasPrefix(ct, "application/json") {
        t.Errorf("Content-Type = %q, want application/json", ct)
    }
}
```

`httptest.NewServer`는 실제 `net/http` 서버를 localhost에 바인딩한다. 이 경로를 통과한 응답의 헤더는 WriteHeader 동결 규칙이 적용된 실제 값이다.

### 교훈

`httptest.ResponseRecorder`는 빠르고 편하지만, **헤더 순서, Content-Type 동결, chunked encoding** 같은 전송 계층 동작은 검증하지 못한다. 이런 동작이 중요한 테스트에서는 `httptest.NewServer` + `http.Client` 조합을 써야 한다.

| 관점 | ResponseRecorder | NewServer |
|------|-----------------|-----------|
| 속도 | 빠름 (in-process) | 느림 (TCP 왕복) |
| 헤더 동결 | 강제 안 함 | 강제함 |
| Content-Type sniffing | 없음 | 적용됨 |
| 용도 | 핸들러 로직 단위 테스트 | HTTP 프로토콜 수준 검증 |

---

## 마무리

P28에서 `WriteHeader(500)`을 추가한 것은 올바른 수정이었다. 하지만 그 한 줄이 기존 `writeJSON` 헬퍼와 충돌하여 Content-Type 누락이라는 새로운 버그를 만들었다.

이번 건의 핵심 교훈 3가지:

1. **Go net/http의 WriteHeader는 헤더를 동결한다** — Header → WriteHeader → Write 순서를 반드시 지킬 것
2. **뮤텍스는 읽기/쓰기 양쪽 모두 잠가야 의미가 있다** — 한쪽만 잠그면 무잠금과 같다
3. **httptest.ResponseRecorder는 HTTP 프로토콜의 완전한 시뮬레이션이 아니다** — 전송 계층 동작 검증에는 NewServer를 써야 한다

버그 수정 하나가 다른 버그를 만들고, 테스트가 그 버그를 감지하지 못하는 연쇄 — 이래서 QA의 엣지케이스 리뷰가 중요하다.
