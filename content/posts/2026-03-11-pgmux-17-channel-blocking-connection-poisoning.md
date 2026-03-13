---
title: "Go로 PostgreSQL 프록시 만들기 (17) - Channel Blocking과 Connection Poisoning 버그 수정"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Bug Fix", "Concurrency", "Connection Pool"]
categories: ["Database"]
project: "pgmux"
description: "Webhook 동기 호출이 Audit 이벤트를 마비시키는 Channel Blocking과, 죽은 커넥션이 풀에 반환되는 Connection Poisoning 버그를 분석하고 수정한다."
---

## 들어가며

지난 글에서 Audit Logging, Helm Chart, Serverless Data API를 구현했다. 기능은 잘 동작했지만, QA 과정에서 두 가지 Critical 버그가 발견되었다.

1. **Channel Blocking** — Webhook HTTP 호출이 Audit 워커를 블로킹하여 전체 감사 로그가 유실되는 문제
2. **Connection Poisoning** — DISCARD ALL 실패 시 죽은 커넥션이 풀에 반환되어 후속 요청이 실패하는 문제

두 버그 모두 "정상 상황에서는 발견되지 않지만, 네트워크 장애나 외부 서비스 지연 시 치명적으로 작동하는" 유형이다. 프로덕션에서 터지기 전에 잡아서 다행이다.

---

## 1. Channel Blocking: Webhook이 Audit 전체를 마비시킨다

### 버그 분석

Audit Logger의 구조를 떠올려보자:

```
Log() → eventCh(1024 버퍼) → processEvents 워커(1개) → handleEvent → sendWebhook
```

문제는 `processEvents` 워커 고루틴이 **단 1개**라는 것이다. Slow Query가 발생하면 이 워커가 `sendWebhook()`을 호출하는데, 내부에서 `httpClient.Post()`를 실행하며 **최대 5초간 블로킹**된다.

```go
// 수정 전: handleEvent 내부
if l.httpClient != nil {
    l.sendWebhook(e)  // HTTP 호출 완료까지 워커가 멈춤
}
```

그 5초 동안 들어오는 수천 개의 쿼리 로그는 1024칸짜리 채널 버퍼를 순식간에 채운다. 1025번째 이벤트부터는 `Log()`의 `default` 분기로 빠져서 영구 삭제된다.

```go
func (l *Logger) Log(e Event) {
    select {
    case l.eventCh <- e:
    default:
        slog.Warn("audit event channel full, dropping event")  // 여기로 빠짐
    }
}
```

결과: Slack Webhook 서버가 조금만 느려져도 **모든** 감사 로그가 유실된다. 16편에서 "감사 로그 유실보다 쿼리 레이턴시 보호가 우선"이라고 설계했는데, 정작 외부 Webhook 때문에 감사 로그가 통째로 날아가는 아이러니.

### 수정: 비동기 고루틴 분리

수정은 한 줄이다:

```go
// 수정 후
if l.httpClient != nil {
    go l.sendWebhook(e)  // 별도 고루틴으로 완전 분리
}
```

`sendWebhook`을 별도 고루틴으로 분리하면 워커 고루틴은 HTTP 응답을 기다리지 않고 즉시 다음 이벤트를 처리한다.

### 왜 이게 안전한가

"고루틴을 무한히 생성하면 메모리 문제가 아닌가?"라는 의문이 들 수 있다. 하지만 `sendWebhook`에는 이미 **rate limiting**이 구현되어 있다:

```go
func (l *Logger) sendWebhook(e Event) {
    queryKey := truncateQuery(e.Query, 100)
    l.lastWebhookMu.Lock()
    if last, ok := l.lastWebhook[queryKey]; ok && time.Since(last) < l.webhookInterval {
        l.lastWebhookMu.Unlock()
        return  // 같은 패턴은 1분에 1번만
    }
    // ...
}
```

같은 쿼리 패턴에 대해 1분에 최대 1번만 실제 HTTP 호출이 발생한다. 따라서 동시에 떠 있는 고루틴 수는 사실상 "서로 다른 Slow Query 패턴 수"로 제한된다. 쿼리 패턴이 수백 개가 동시에 Slow가 되는 상황은 이미 데이터베이스 자체가 심각한 장애 상태이므로, 고루틴 수십 개는 무시할 수 있는 수준이다.

### 테스트로 검증

```go
func TestAuditLogger_WebhookDoesNotBlockLogging(t *testing.T) {
    // 2초간 블로킹하는 mock webhook 서버
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(2 * time.Second)
        w.WriteHeader(http.StatusOK)
    }))

    logger := New(cfg)

    // Slow Query → webhook 발동
    logger.Log(Event{DurationMS: 100, Query: "SELECT * FROM delay1"})
    time.Sleep(100 * time.Millisecond)

    // webhook이 블로킹 중인 동안 1100개 이벤트 전송
    for i := 0; i < 1100; i++ {
        logger.Log(Event{DurationMS: 5, Query: "SELECT * FROM fast"})
    }

    time.Sleep(500 * time.Millisecond)

    // 수정 전: 채널이 가득 차서 대부분 드랍
    // 수정 후: 프로세서가 블로킹되지 않아 채널이 즉시 소비됨
    remaining := len(logger.eventCh)
    if remaining > 10 {
        t.Errorf("processor was likely blocked, %d events remain", remaining)
    }
}
```

수정 전에는 프로세서가 2초간 멈추면서 1024개 버퍼가 즉시 차고 나머지가 드랍됐지만, 수정 후에는 프로세서가 계속 돌면서 채널을 소비한다.

---

## 2. Connection Poisoning: 죽은 커넥션이 풀을 오염시킨다

### 버그 분석

Serverless Data API의 `executeOnPool`에서 쿼리 성공 후 세션 초기화 과정을 보자:

```go
func (s *Server) executeOnPool(ctx context.Context, sql string, p *pool.Pool) (*QueryResponse, error) {
    conn, _ := p.Acquire(ctx)
    resp, execErr := executeQuery(conn, sql)
    if execErr != nil {
        p.Discard(conn)  // 쿼리 실패 시 정상적으로 폐기
        return nil, execErr
    }

    // 세션 리셋
    protocol.WriteMessage(conn, protocol.MsgQuery, resetPayload)
    drainUntilReady(conn)  // 여기서 에러가 나도 무시!
    p.Release(conn)        // 죽은 커넥션이 풀로 반환됨
    return resp, nil
}
```

`drainUntilReady`의 원래 구현:

```go
func drainUntilReady(conn net.Conn) {
    for {
        msg, err := protocol.ReadMessage(conn)
        if err != nil || msg.Type == protocol.MsgReadyForQuery {
            return  // 에러든 성공이든 그냥 리턴
        }
    }
}
```

**에러(EOF, timeout)와 성공(ReadyForQuery 수신)을 구분하지 않는다.** DISCARD ALL을 보낸 뒤 네트워크가 끊기면 `ReadMessage`가 EOF를 반환하고, `drainUntilReady`는 조용히 리턴한다. 그 다음 줄에서 `p.Release(conn)`이 실행되면서 **이미 죽은 커넥션**이 풀의 idle 목록에 들어간다.

다음 요청이 `p.Acquire()`로 이 커넥션을 받으면 당연히 쿼리가 실패한다. 일시적 네트워크 장애가 커넥션 풀 전체를 서서히 오염시키는 것이다.

### 수정: 에러 반환 + Discard 분기

```go
// drainUntilReady가 성공/실패를 구분하도록 변경
func drainUntilReady(conn net.Conn) error {
    for {
        msg, err := protocol.ReadMessage(conn)
        if err != nil {
            return err  // 에러 시 실패 반환
        }
        if msg.Type == protocol.MsgReadyForQuery {
            return nil  // 성공적으로 ReadyForQuery 수신
        }
    }
}
```

호출부에서 에러 시 Discard:

```go
// 수정 후
if err := drainUntilReady(conn); err != nil {
    p.Discard(conn)   // 죽은 커넥션은 영구 폐기
    return resp, nil  // 쿼리 결과는 이미 받았으므로 정상 반환
}
p.Release(conn)  // 정상 커넥션만 풀에 반환
```

핵심은 **쿼리 결과는 이미 성공적으로 받았다**는 것이다. DISCARD ALL이 실패한 건 커넥션 상태의 문제이지 쿼리 결과와는 무관하다. 따라서 `resp`는 정상 반환하되, 커넥션만 폐기하면 된다.

### 테스트

```go
func TestDrainUntilReady_ReturnsErrorOnBrokenConn(t *testing.T) {
    conn := &brokenConn{}  // Read()가 항상 net.ErrClosed 반환
    err := drainUntilReady(conn)
    if err == nil {
        t.Fatal("expected error from drainUntilReady on broken connection, got nil")
    }
}
```

---

## 교훈

### 에러 경로에서 리소스 상태를 신뢰하지 마라

두 버그의 공통점은 **에러 발생 후에도 리소스를 "정상"으로 취급**했다는 것이다.

- Bug 1: HTTP 호출 에러/지연 후에도 워커가 정상 작동할 것으로 가정
- Bug 2: `drainUntilReady` 에러 후에도 커넥션이 정상일 것으로 가정

Go에서 `error`를 반환하지 않는 함수는 "이 함수는 실패하지 않는다"는 계약이다. `drainUntilReady`가 에러를 무시하고 반환하도록 설계한 것은 이 계약을 위반한 셈이다. 네트워크 I/O를 하는 함수는 반드시 에러를 전파해야 한다.

### 동기 호출은 전파된다

`sendWebhook`이 동기적으로 호출되면, 그 블로킹은 호출자(`processEvents`)에게 전파되고, 다시 채널 생산자(`Log()`)에게 전파된다. 결국 단일 HTTP 타임아웃이 프록시 전체의 감사 로그를 마비시킨다. 비동기 경계(`go` 키워드)는 이 전파를 차단하는 방화벽 역할을 한다.

### 정상 경로만 테스트하면 안 된다

두 버그 모두 "정상 상황에서는 완벽하게 동작"했다. Webhook 서버가 빠르게 응답하고, 네트워크가 안정적이면 문제가 없다. 하지만 프로덕션에서는 Slack이 느려지고, 네트워크가 끊어지고, DB가 갑자기 재시작한다. 에러 주입 테스트(느린 mock 서버, 끊어진 mock 커넥션)가 이런 버그를 사전에 잡아준다.

---

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
