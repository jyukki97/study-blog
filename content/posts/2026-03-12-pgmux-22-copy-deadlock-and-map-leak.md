---
title: "Go로 PostgreSQL 프록시 만들기 (22) - COPY 프로토콜 교착과 Map 메모리 누수"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "COPY Protocol", "Deadlock", "Memory Leak", "Bug Fix"]
categories: ["Database"]
project: "pgmux"
description: "pgmux에서 발견된 두 가지 CRITICAL 버그 — COPY 프로토콜 교착(Deadlock)과 Audit Logger의 무한 Map 메모리 누수 — 를 분석하고 수정한다."
---

## 들어가며

Phase 19(Prepared Statement Multiplexing)를 머지한 직후 두 가지 CRITICAL 버그를 발견했다.

1. **COPY 프로토콜 교착**: `COPY FROM STDIN` / `COPY TO STDOUT` 실행 시 프록시가 영구 교착에 빠진다
2. **Audit Logger 메모리 누수**: `lastWebhook` map이 무한히 성장하여 OOM을 유발한다

이번 글에서는 각 버그의 원인을 분석하고 수정 과정을 다룬다.

---

## Bug 1: COPY 프로토콜 교착

### 문제 상황

PostgreSQL의 COPY 프로토콜은 일반적인 Query→Response 흐름과 완전히 다르다.

```
일반 쿼리:
  Client → Query('Q')
  Server → RowDescription + DataRow... + CommandComplete + ReadyForQuery('Z')

COPY FROM STDIN:
  Client → Query('Q')  "COPY my_table FROM STDIN"
  Server → CopyInResponse('G')     ← 여기서 방향이 전환됨!
  Client → CopyData('d') × N       ← 클라이언트가 데이터를 보냄
  Client → CopyDone('c')
  Server → CommandComplete + ReadyForQuery('Z')
```

핵심은 **CopyInResponse 이후 데이터 흐름의 방향이 바뀐다**는 것이다.

### 교착 원인

pgmux의 `relayUntilReady()`와 `relayAndCollect()`는 아래 패턴으로 동작했다:

```go
// AS-IS: 백엔드 응답만 읽으며 ReadyForQuery를 기다림
for {
    msg, _ := protocol.ReadMessage(backendConn)  // ← 여기서 영원히 블로킹!
    protocol.WriteMessage(clientConn, msg.Type, msg.Payload)
    if msg.Type == protocol.MsgReadyForQuery {
        return nil
    }
}
```

CopyInResponse('G')를 받아서 클라이언트에 전달하면, 클라이언트는 CopyData를 보내기 시작한다. 그런데 프록시는 여전히 **백엔드**에서 ReadMessage를 호출하며 ReadyForQuery를 기다리고 있다.

- 프록시: 백엔드에서 `ReadyForQuery`를 기다림 → 백엔드는 CopyData를 기다림
- 클라이언트: 프록시에 CopyData를 보냄 → 프록시는 읽지 않음

**영구 교착(Deadlock)**.

### 수정

CopyInResponse, CopyOutResponse, CopyBothResponse를 감지하여 적절한 릴레이 모드로 전환한다:

```go
switch msg.Type {
case protocol.MsgReadyForQuery:
    return nil
case protocol.MsgCopyInResponse:
    // 클라이언트→백엔드 방향으로 CopyData/CopyDone 릴레이
    if err := s.relayCopyIn(clientConn, backendConn); err != nil {
        return fmt.Errorf("copy in relay: %w", err)
    }
case protocol.MsgCopyOutResponse:
    // 백엔드→클라이언트 방향으로 CopyData/CopyDone 릴레이
    if err := s.relayCopyOut(clientConn, backendConn); err != nil {
        return fmt.Errorf("copy out relay: %w", err)
    }
case protocol.MsgCopyBothResponse:
    // 양방향 릴레이 (스트리밍 복제)
    if err := s.relayCopyBoth(clientConn, backendConn); err != nil {
        return fmt.Errorf("copy both relay: %w", err)
    }
}
```

`relayCopyIn()`은 클라이언트에서 메시지를 읽어 백엔드로 전달하고, CopyDone이나 CopyFail을 받으면 복귀한다:

```go
func (s *Server) relayCopyIn(clientConn, backendConn net.Conn) error {
    for {
        msg, err := protocol.ReadMessage(clientConn)
        if err != nil {
            return fmt.Errorf("read client copy data: %w", err)
        }
        if err := protocol.WriteMessage(backendConn, msg.Type, msg.Payload); err != nil {
            return fmt.Errorf("forward copy data to backend: %w", err)
        }
        switch msg.Type {
        case protocol.MsgCopyDone, protocol.MsgCopyFail:
            return nil  // COPY 완료, 정상 릴레이 루프로 복귀
        }
    }
}
```

`relayAndCollect()`에서는 COPY 결과를 캐시하지 않도록 버퍼를 해제한다:

```go
case protocol.MsgCopyInResponse:
    if err := s.relayCopyIn(clientConn, backendConn); err != nil {
        return nil, fmt.Errorf("copy in relay: %w", err)
    }
    buf = nil        // COPY 결과는 캐시 불가
    oversize = true
```

### 테스트

`net.Pipe()`로 클라이언트/백엔드를 시뮬레이션하여 교착 없이 COPY 프로토콜이 동작하는지 검증한다:

```go
func TestRelayUntilReady_CopyIn(t *testing.T) {
    // 프록시 ↔ 클라이언트, 프록시 ↔ 백엔드 파이프
    proxyClientConn, testClientConn := net.Pipe()
    proxyBackendConn, testBackendConn := net.Pipe()

    go func() {
        errCh <- srv.relayUntilReady(proxyClientConn, proxyBackendConn)
    }()

    // 백엔드 시뮬레이션: CopyInResponse → CopyData 수신 → 완료
    go func() {
        protocol.WriteMessage(testBackendConn, 'G', copyInPayload)
        // CopyData/CopyDone 수신 후 CommandComplete + ReadyForQuery 전송
        ...
    }()

    // 클라이언트 시뮬레이션: CopyInResponse 수신 → CopyData 전송 → 완료 수신
    msg, _ := protocol.ReadMessage(testClientConn)
    // msg.Type == 'G' 확인
    protocol.WriteMessage(testClientConn, 'd', data)
    protocol.WriteMessage(testClientConn, 'c', nil)
    // CommandComplete + ReadyForQuery 수신 확인

    select {
    case err := <-errCh:
        // 교착 없이 정상 종료!
    case <-time.After(2 * time.Second):
        t.Fatal("deadlocked!")
    }
}
```

---

## Bug 2: Audit Logger Map 메모리 누수

### 문제 상황

Audit Logger의 webhook 중복 전송 방지를 위해 `lastWebhook map[string]time.Time`을 사용한다. 같은 쿼리가 `webhookInterval`(기본 1분) 내에 다시 발생하면 webhook을 건너뛴다.

```go
func (l *Logger) sendWebhook(e Event) {
    queryKey := truncateQuery(e.Query, 100)
    l.lastWebhookMu.Lock()
    if last, ok := l.lastWebhook[queryKey]; ok && time.Since(last) < l.webhookInterval {
        l.lastWebhookMu.Unlock()
        return  // 중복, 건너뜀
    }
    l.lastWebhook[queryKey] = time.Now()  // ← 추가만 하고 삭제 안 함!
    l.lastWebhookMu.Unlock()
    // ... HTTP POST
}
```

문제: **map에 추가만 하고 삭제하지 않는다**. 매일 다양한 쿼리를 실행하는 프로덕션 환경에서 이 map은 무한히 성장한다.

### 수정

`webhookInterval`마다 실행되는 정리 goroutine을 추가한다:

```go
func (l *Logger) cleanupWebhookDedup() {
    defer l.wg.Done()
    ticker := time.NewTicker(l.webhookInterval)
    defer ticker.Stop()

    for {
        select {
        case <-l.stopCh:
            return
        case <-ticker.C:
            l.lastWebhookMu.Lock()
            now := time.Now()
            for key, last := range l.lastWebhook {
                if now.Sub(last) >= l.webhookInterval {
                    delete(l.lastWebhook, key)
                }
            }
            l.lastWebhookMu.Unlock()
        }
    }
}
```

또한 `DedupInterval`을 `WebhookConfig`에 노출하여 설정 가능하게 했다:

```go
type WebhookConfig struct {
    Enabled       bool
    URL           string
    Timeout       time.Duration
    DedupInterval time.Duration  // 기본 1분
}
```

### 테스트

```go
func TestAuditLogger_WebhookDedupCleanup(t *testing.T) {
    logger := New(Config{
        Webhook: WebhookConfig{
            Enabled: true, URL: "http://localhost:9999",
            DedupInterval: 500 * time.Millisecond,
        },
        SlowQueryThreshold: 1 * time.Millisecond,
    })
    defer logger.Close()

    // 50개 고유 쿼리 → map 성장 확인
    for i := 0; i < 50; i++ {
        logger.Log(Event{Query: fmt.Sprintf("SELECT %d", i), DurationMS: 50})
    }
    time.Sleep(300 * time.Millisecond)
    // afterInsert == 50

    // 500ms DedupInterval 경과 후 cleanup 확인
    time.Sleep(800 * time.Millisecond)
    // afterCleanup == 0 ✓
}
```

---

## 마무리

두 버그 모두 코드 리뷰에서 놓치기 쉬운 패턴이다:

| 버그 | 패턴 | 교훈 |
|------|------|------|
| COPY 교착 | **프로토콜 상태 전환 누락** | PostgreSQL wire protocol에는 "누가 다음에 말하는가"가 바뀌는 지점이 있다. 모든 응답 타입을 switch로 처리해야 한다 |
| Map 누수 | **추가만 하고 삭제 안 하는 map** | Go에서 map을 캐시/dedup으로 쓸 때는 반드시 eviction 로직을 함께 구현해야 한다 |

다음 글에서는 Phase 20+의 새로운 기능을 다룰 예정이다.
