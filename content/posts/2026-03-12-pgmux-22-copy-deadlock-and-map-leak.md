---
title: "Go로 PostgreSQL 프록시 만들기 (22) - COPY 프로토콜 교착과 Map 메모리 누수"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "COPY Protocol", "Deadlock", "Memory Leak", "Bug Fix"]
categories: ["Database"]
project: "pgmux"
description: "pgmux에서 발견된 두 가지 CRITICAL 버그, COPY 프로토콜 교착과 Audit Logger의 무한 Map 메모리 누수를 분석하고 수정한다."
keywords: ["postgres copy deadlock", "go map memory leak", "pgmux copy protocol", "audit logger dedup cleanup"]
key_takeaways:
  - "COPY 프로토콜은 ReadyForQuery만 기다리는 일반 릴레이 루프로 처리하면 방향 전환 지점에서 영구 교착이 생긴다."
  - "Dedup용 map은 추가 로직만큼이나 eviction 전략이 중요하며, 없으면 저빈도 쿼리에서도 장기 누수가 난다."
  - "프로토콜 상태 전환과 메모리 수명 주기를 테스트 코드로 고정해야 재발을 막을 수 있다."
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

## 실무에서 재발을 막는 포인트

이번 두 버그는 각각 다른 층위의 문제처럼 보여도, 실제로는 공통점이 있다. 둘 다 **상태가 바뀌는 순간을 코드가 명시적으로 모델링하지 않았다**는 점이다.

COPY 교착은 "응답을 하나 받았으니 다음 응답도 백엔드에서 오겠지"라는 암묵적 가정이 깨진 사례다. PostgreSQL wire protocol에는 메시지 타입뿐 아니라, 특정 응답 이후 **누가 다음 메시지를 보내는지**가 중요하다. 이 전환을 함수 경계나 switch 문으로 고정하지 않으면, 평소에는 잘 돌다가 특정 프로토콜에서만 영구 대기 상태가 생긴다.

Map 누수 역시 비슷하다. dedup 로직을 넣는 순간 데이터 구조는 더 이상 단순 저장소가 아니라 **시간 축을 가진 캐시**가 된다. 그런데 추가 경로만 구현하고 수명 종료 시점을 정의하지 않으면, 기능은 맞아 보여도 운영에서는 천천히 메모리를 갉아먹는다. 이런 누수는 부하 테스트보다 장시간 실서비스에서 먼저 드러나기 쉬워서 더 위험하다.

그래서 비슷한 종류의 버그를 막으려면 아래 체크리스트를 강하게 가져가는 편이 좋다.

- 프로토콜 구현은 `메시지 타입`뿐 아니라 `다음 발화자`까지 상태로 표현했는가?
- 캐시, dedup, 세션 맵처럼 축적되는 자료구조에는 eviction 또는 TTL 경로가 있는가?
- 정상 경로 테스트 외에 `방향 전환`, `장시간 실행`, `timeout` 시나리오가 있는가?
- 버그 수정 후 로그와 메트릭으로 재발 조짐을 운영에서 잡을 수 있는가?

특히 pgmux 같은 프록시는 [Prepared Statement Multiplexing](/posts/2026-03-12-pgmux-21-prepared-statement-multiplexing/)이나 [Connection Pooling](/posts/2026-03-11-pgmux-2-connection-pooling/)처럼 상태를 공유하는 기능이 많아서, 작은 누락도 쉽게 복합 장애로 번진다. 그래서 저는 이런 글을 단순 버그 회고보다, **앞으로 어떤 종류의 상태 전환을 더 엄격하게 다뤄야 하는지 남기는 설계 기록**으로 보는 편이다.

## 마무리

두 버그 모두 코드 리뷰에서 놓치기 쉬운 패턴이다:

| 버그 | 패턴 | 교훈 |
|------|------|------|
| COPY 교착 | **프로토콜 상태 전환 누락** | PostgreSQL wire protocol에는 "누가 다음에 말하는가"가 바뀌는 지점이 있다. 모든 응답 타입을 switch로 처리해야 한다 |
| Map 누수 | **추가만 하고 삭제 안 하는 map** | Go에서 map을 캐시/dedup으로 쓸 때는 반드시 eviction 로직을 함께 구현해야 한다 |

이런 류의 문제는 기능 개발이 빨라질수록 더 자주 나온다. 그래서 기능 설명 글만 쌓는 것보다, 어떤 버그가 왜 생겼고 어떤 안전장치를 붙였는지를 함께 남겨 두는 편이 프로젝트 신뢰도에 훨씬 도움이 된다. 이후 Phase 20+에서도 새로운 기능을 넣을 때는 "정상 동작"만이 아니라 "상태 전환과 수명 종료를 어떻게 검증할 것인가"를 기본 질문으로 가져가야 한다.

다음 글에서는 Phase 20+의 새로운 기능을 다룰 예정이다.
