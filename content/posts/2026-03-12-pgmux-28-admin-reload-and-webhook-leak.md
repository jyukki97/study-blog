---
title: "Go로 PostgreSQL 프록시 만들기 (28) - Reload 200 OK 거짓말과 Webhook 고루틴 유실"
date: 2026-03-12
lastmod: 2026-04-06
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "HTTP API", "Goroutine", "WaitGroup", "Graceful Shutdown"]
categories: ["Database"]
project: "pgmux"
keywords: ["admin reload 500", "WriteHeader 200 함정", "fire and forget goroutine", "graceful shutdown webhook", "pgmux QA"]
description: "QA에서 발견된 2가지 버그 — /admin/reload 실패에도 HTTP 200 반환, 감사 로그 Webhook 고루틴 미추적으로 종료 시 유실 — 의 원인과 수정 과정을 정리한다."
---

## 들어가며

P27([핫 리로드 5가지 함정](/posts/2026-03-12-pgmux-27-qa-round2-hot-reload-pitfalls/))을 정리한 직후, QA 항목 2건이 추가로 들어왔다. 둘 다 공통점이 있다.

> 겉으로는 "정상"처럼 보이는데, 실패/종료 경로에서만 실제 장애가 드러난다.

이번 글에서 다루는 이슈는 다음 두 가지다.

1. `/admin/reload` 실패 시에도 HTTP 200을 반환해 자동화가 성공으로 오판한다.
2. 감사 로그 Webhook 전송을 fire-and-forget 고루틴으로 날려 종료 시점에 이벤트가 유실된다.

두 버그 모두 운영 관점에서 치명적이다. 첫 번째는 **거짓 성공 신호**, 두 번째는 **감사 증적 누락**으로 이어지기 때문이다.

---

## 버그 1: /admin/reload 실패에도 HTTP 200

### 증상

운영 스크립트가 `curl -X POST /admin/reload`를 호출하고 HTTP 상태 코드만으로 성공 여부를 판단한다. 설정 파싱 에러가 나도 200이 돌아오므로, 스크립트는 리로드를 성공으로 처리한다.

### 원인

```go
// internal/admin/admin.go
if err := fn(); err != nil {
    slog.Error("admin: reload failed", "error", err)
    writeJSON(w, map[string]any{"status": "error", "error": err.Error()})
    return
}
```

`writeJSON`은 Content-Type만 설정하고 JSON을 쓴다.

```go
func writeJSON(w http.ResponseWriter, v any) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(v)
}
```

Go `net/http`는 `WriteHeader`를 명시하지 않으면 `Write()` 시점에 기본값 200을 보낸다. 즉, 에러 분기에서 상태 코드를 직접 지정하지 않았기 때문에 HTTP 응답은 항상 200이 된다.

### 수정

에러 분기에 상태 코드를 명시한다.

```go
if err := fn(); err != nil {
    slog.Error("admin: reload failed", "error", err)
    w.WriteHeader(http.StatusInternalServerError)
    writeJSON(w, map[string]any{"status": "error", "error": err.Error()})
    return
}
```

테스트도 함께 보정한다.

```go
if w.Code != http.StatusInternalServerError {
    t.Errorf("status = %d, want 500", w.Code)
}
```

### 교훈

`writeJSON` 같은 헬퍼를 쓰면 "상태 코드는 누가 책임지는가"가 흐려지기 쉽다. 에러 응답에서는 helper 호출 전에 상태 코드를 먼저 확정하거나, 아예 에러 응답 전용 helper를 분리하는 편이 안전하다.

---

## 버그 2: Webhook 고루틴이 종료 시 유실된다

### 증상

프록시 종료 직전에 slow query가 발생하면 Webhook 알림이 누락된다. 감사 로그 파일에는 이벤트가 남았는데, 외부 알림 시스템에서는 해당 이벤트가 보이지 않는다.

### 원인

```go
// internal/audit/audit.go
func (l *Logger) handleEvent(e Event) {
    if isSlowQuery {
        // ... 로깅 ...
        if l.httpClient != nil {
            go l.sendWebhook(e) // fire-and-forget
        }
    }
}
```

문제는 `sendWebhook` 고루틴이 `WaitGroup` 추적 대상이 아니라는 점이다. `Close()`는 아래처럼 동작한다.

```go
func (l *Logger) Close() {
    close(l.stopCh)
    l.wg.Wait() // processEvents + cleanupWebhookDedup만 대기
}
```

즉 `Close()`가 반환되어 프로세스가 종료되면, 아직 전송 중이던 Webhook 고루틴은 OS에 의해 중단될 수 있다.

### 수정

Webhook 전송 고루틴을 `WaitGroup`으로 감싼다.

```go
if l.httpClient != nil {
    l.wg.Add(1)
    go func() {
        defer l.wg.Done()
        l.sendWebhook(e)
    }()
}
```

이제 `Close()` → `l.wg.Wait()` 경로에서 in-flight Webhook 전송까지 기다린다.

### 교훈

고루틴은 "가볍다"는 이유로 쉽게 추가되지만, 생명주기 관리가 빠지면 종료 경로에서 가장 먼저 사고가 난다. 특히 네트워크 I/O가 있는 고루틴은 fire-and-forget을 기본값으로 두면 안 된다.

---

## 재현/검증 시나리오 (운영용)

아래는 QA에서 사용한 재현 절차를 운영 런북 스타일로 정리한 버전이다.

### A. Reload 200 오판 재현

```bash
# 1) 일부러 잘못된 설정 반영
cp config.invalid.yaml config.yaml

# 2) 리로드 호출 + 상태 코드 확인
curl -s -o /tmp/reload.json -w "%{http_code}\n" -X POST http://127.0.0.1:8080/admin/reload
cat /tmp/reload.json
```

검증 기준:
- 상태 코드는 반드시 `500`
- body에는 `{"status":"error", ...}` 포함

### B. 종료 직전 Webhook 유실 재현

1. 테스트용 Webhook 서버(수신 로그 저장) 실행
2. slow query를 연속으로 발생시킨 뒤 즉시 종료 신호 전달
3. 종료 직전 생성된 이벤트 수와 Webhook 수신 수 비교

합격 기준:
- 종료 전 생성 이벤트 == 수신 이벤트 (0건 유실)
- 종료 시간 증가가 허용 예산(예: p95 2초 이내) 안에 있을 것

---

## 운영 리스크와 롤백 가이드

| 항목 | 기대 효과 | 도입 리스크 | 롤백 방법 |
|---|---|---|---|
| reload 실패 시 500 반환 | 자동화 오판 제거, 장애 탐지 정확도 상승 | 기존 스크립트가 200 가정이면 즉시 실패로 전환될 수 있음 | 스크립트에 body 파싱 fallback 임시 허용 후 단계 전환 |
| webhook goroutine WG 추적 | 종료 시 감사 이벤트 유실 방지 | 종료 대기 시간이 소폭 증가할 수 있음 | webhook 전송 timeout 단축(예: 3s→1s), 큐 기반 비동기 전환 전 임시 튜닝 |

핵심은 "코드 수정"보다 "운영 계약 변경"을 같이 배포하는 것이다. 특히 상태 코드 변경은 배치/배포 자동화와 맞물려 있기 때문에, 배포 전 스크립트 호환성 점검이 필수다.

---

## 적용 체크리스트

- [ ] `/admin/reload` 실패 케이스에서 HTTP 500을 반환한다.
- [ ] 운영 스크립트가 상태 코드 + body를 함께 검사한다.
- [ ] Webhook 전송 고루틴이 `WaitGroup`으로 추적된다.
- [ ] 종료 시점 유실 검증 테스트(종료 직전 이벤트)가 CI에 포함된다.
- [ ] shutdown 대기 시간 상한(예: 2~3초)과 timeout 정책이 문서화되어 있다.

---

## 마무리

이번 2건은 모두 happy path에서는 잘 안 보이는 결함이었다. 성공 경로에서만 테스트하면 "정상"으로 보이고, 실패/종료 경로에서만 실제 운영 사고가 된다.

- **실패했는데 200**: 관측 시스템이 조용히 속는다.
- **종료 시 고루틴 유실**: 감사 체인이 비어버린다.

P29([WriteHeader 이후 헤더 동결과 테스트 맹점](/posts/2026-03-12-pgmux-29-writeheader-freeze-and-test-blindspot/))에서는 여기서 한 단계 더 들어가, 왜 `ResponseRecorder`만으로는 이 회귀를 놓치기 쉬운지 정리했다.

관심 있으면 함께 보면 좋은 글:
- [Graceful Shutdown 심화](/learning/deep-dive/deep-dive-graceful-shutdown/)
- [Timeout/Retry/Backoff 운영 패턴](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Structured Logging 실무](/learning/deep-dive/deep-dive-structured-logging/)
- [pgmux 프로젝트 허브](/projects/pgmux/)
