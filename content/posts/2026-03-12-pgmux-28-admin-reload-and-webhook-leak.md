---
title: "Go로 PostgreSQL 프록시 만들기 (28) - Reload 200 OK 거짓말과 Webhook 고루틴 유실"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "HTTP API", "Goroutine", "WaitGroup", "Graceful Shutdown"]
categories: ["Database"]
project: "pgmux"
description: "QA에서 발견된 2가지 버그 — /admin/reload 실패에도 HTTP 200 반환, 감사 로그 Webhook 고루틴 미추적으로 종료 시 유실 — 의 원인과 수정 과정을 정리한다."
---

## 들어가며

P27에서 핫 리로드 관련 5건을 수정한 직후, QA 항목 2건이 추가로 도착했다. 이번에는 둘 다 **"정상인 줄 알았는데 아닌"** 패턴이다.

1. `/admin/reload`가 실패해도 HTTP 200을 반환한다 — 자동화 스크립트가 성공으로 오판
2. 감사 로그 Webhook이 fire-and-forget 고루틴으로 실행되어, 종료 시 유실된다

---

## 버그 1: /admin/reload 실패에도 HTTP 200

### 증상

운영 스크립트에서 `curl -X POST /admin/reload`를 호출하고 HTTP 상태 코드로 성공 여부를 판단한다. 설정 파싱 에러가 발생해도 200이 돌아오니, 스크립트는 리로드 성공으로 처리한다.

### 원인

```go
// internal/admin/admin.go
if err := fn(); err != nil {
    slog.Error("admin: reload failed", "error", err)
    writeJSON(w, map[string]any{"status": "error", "error": err.Error()})
    return
}
```

`writeJSON`은 `Content-Type` 헤더만 설정하고 JSON을 인코딩한다.

```go
func writeJSON(w http.ResponseWriter, v any) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(v)
}
```

Go의 `net/http`는 `Write()`가 호출될 때 `WriteHeader`가 아직 안 불렸으면 자동으로 **200 OK**를 설정한다. 즉, 에러 분기에서 명시적으로 상태 코드를 설정하지 않았기 때문에 항상 200이 반환된다.

JSON body에는 `"status": "error"`가 들어있지만, HTTP 상태 코드만 보는 스크립트는 이를 감지하지 못한다. REST API의 기본 규약 — **에러는 4xx/5xx로 반환한다** — 을 위반하고 있다.

### 수정

에러 분기에 `w.WriteHeader(http.StatusInternalServerError)`를 추가한다.

```go
if err := fn(); err != nil {
    slog.Error("admin: reload failed", "error", err)
    w.WriteHeader(http.StatusInternalServerError)
    writeJSON(w, map[string]any{"status": "error", "error": err.Error()})
    return
}
```

테스트도 기대값을 200에서 500으로 변경한다.

```go
// before
if w.Code != http.StatusOK {
    t.Errorf("status = %d, want 200", w.Code)
}

// after
if w.Code != http.StatusInternalServerError {
    t.Errorf("status = %d, want 500", w.Code)
}
```

### 교훈

`writeJSON` 같은 헬퍼 함수를 쓸 때, 상태 코드 설정 책임이 어디에 있는지 명확히 해야 한다. Go의 암묵적 200 기본값은 편하지만, 에러 경로에서는 함정이 된다. 테스트가 잘못된 동작을 "정상"으로 고정하고 있었다는 것도 문제다 — **테스트가 있다고 안심할 수 없다.**

---

## 버그 2: Webhook 고루틴이 종료 시 유실된다

### 증상

프록시 종료 직전에 slow query가 발생하면, Webhook 알림이 전송되지 않고 사라진다. 감사 로그에는 slow query가 기록되지만, 알림은 오지 않는다.

### 원인

감사 로거의 이벤트 처리 흐름을 보자.

```go
// internal/audit/audit.go
func (l *Logger) handleEvent(e Event) {
    if isSlowQuery {
        // ... 로깅 ...

        if l.httpClient != nil {
            go l.sendWebhook(e)  // fire-and-forget!
        }
    }
}
```

`go l.sendWebhook(e)`는 WaitGroup에 추적되지 않는 분리된 고루틴이다.

한편, `Close()`는 이렇게 구현되어 있다.

```go
func (l *Logger) Close() {
    close(l.stopCh)
    l.wg.Wait()  // processEvents + cleanupWebhookDedup만 대기
}
```

`wg`에는 `processEvents`와 `cleanupWebhookDedup` 두 고루틴만 등록되어 있다. `sendWebhook` 고루틴은 추적 대상이 아니다.

프록시 종료 경로에서는:

```go
// internal/proxy/server.go
s.auditLogger.Close()
slog.Info("proxy shut down")
return nil  // 프로세스 종료
```

`Close()` 반환 → 프로세스 종료. 이 시점에 아직 HTTP 요청 중인 `sendWebhook` 고루틴은 OS에 의해 강제 종료된다.

### 수정

`sendWebhook` 호출을 WaitGroup으로 감싼다.

```go
if l.httpClient != nil {
    l.wg.Add(1)
    go func() {
        defer l.wg.Done()
        l.sendWebhook(e)
    }()
}
```

이제 `Close()` → `l.wg.Wait()`이 모든 in-flight Webhook 전송 완료를 보장한다.

### 교훈

Go에서 `go func()` 한 줄은 쉽게 쓰지만, 그 고루틴의 **생명주기 관리**는 별도로 해야 한다. 특히 네트워크 I/O가 포함된 고루틴을 fire-and-forget으로 쓰면, 정상 동작에서는 문제가 없어 보이지만 **종료 경로에서 유실**이 발생한다. `sync.WaitGroup`은 고루틴 추적의 가장 기본적인 도구다.

---

## 마무리

두 버그의 공통점: **happy path에서는 보이지 않는 문제**. Reload는 성공하면 200이 맞고, Webhook은 프록시가 계속 돌고 있으면 결국 전송된다. 실패 경로와 종료 경로에서만 문제가 드러난다.

운영 환경에서 "실패해도 200"은 사일런트 장애의 시작이고, "종료 시 고루틴 유실"은 감사 로그 누락의 시작이다. QA가 아니었으면 프로덕션에서 발견했을 버그들이다.
