---
title: "Go로 PostgreSQL 프록시 만들기 (38) - pprof 기반 최적화와 투명 프록시의 경계"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Performance", "pprof", "Optimization"]
categories: ["Database"]
project: "pgmux"
description: "pprof CPU/alloc 프로파일링으로 병목을 찾고, atomic.Pointer·ReadMessageReuse·wire buffer 재사용을 적용한다. 그리고 응답 batching이 왜 '투명한 프록시'의 원칙을 깨는지 분석한다."
---

## 들어가며

[이전 글](/posts/2026-03-13-pgmux-37-benchmark-suite/)에서 hot path 최적화로 SELECT-only 성능을 46%에서 83%로 끌어올렸다. 하지만 Direct 대비 여전히 ~17%p 갭이 남아있고, PgBouncer(97%)와는 14%p 차이가 있다. "더 올릴 수 없을까?"

이번 글에서는 pprof로 남은 병목을 분석하고, 세 가지 최적화를 적용한 뒤, **성능을 위해 투명성을 포기하려 했다가 되돌린 경험**을 다룬다.

---

## pprof로 병목 찾기

Go의 내장 프로파일러 pprof로 CPU와 allocation을 동시에 분석했다.

```go
// cmd/pgmux/main.go
import _ "net/http/pprof"

go func() {
    http.ListenAndServe("localhost:6060", nil)
}()
```

pgbench로 c=50 부하를 건 상태에서 30초간 CPU 프로파일을 수집:

```bash
curl -o cpu.prof "localhost:6060/debug/pprof/profile?seconds=30"
go tool pprof -http=:8080 cpu.prof
```

### CPU 프로파일 결과

| 항목 | 비율 |
|------|------|
| `syscall` (read/write) | **56%** |
| goroutine scheduling | **40%** |
| pgmux 애플리케이션 코드 | **~0%** |

충격적인 결과다. pgmux 코드 자체에는 flat time이 거의 없었다. 병목은 두 곳이다:

1. **syscall (56%)** — 쿼리당 ~12회의 read/write 시스템 콜
2. **goroutine scheduling (40%)** — 50개 고루틴이 I/O마다 park/unpark

### Allocation 프로파일

```bash
curl -o alloc.prof "localhost:6060/debug/pprof/alloc?seconds=30"
```

| 함수 | 할당량 |
|------|--------|
| `protocol.ReadMessage` | 매 호출 `make([]byte, wireLen)` |
| `relayUntilReady` | 매 메시지 `make([]byte, wireLen)` |
| `getConfig()` RWMutex | atomic 연산 2회/호출 |

---

## 적용한 최적화 (behavioral-neutral만)

핵심 원칙: **외부에서 관찰 가능한 동작이 변하지 않는 최적화만 적용한다.**

### 1. atomic.Pointer — lock-free config 접근

`getConfig()`은 매 쿼리마다 호출된다. 기존에는 `sync.RWMutex`의 `RLock/RUnlock`을 사용했다.

```go
// Before: 쿼리당 2회 atomic operation (RLock reader count increment/decrement)
func (s *Server) getConfig() *config.Config {
    s.mu.RLock()
    cfg := s.cfg
    s.mu.RUnlock()
    return cfg
}
```

Config는 hot-reload 시에만 변경된다. 읽기 99.99%, 쓰기 0.01%. `atomic.Pointer`로 바꾸면 lock 없이 단일 atomic load로 처리된다.

```go
// After: 단일 atomic load — lock 없음, contention 없음
type Server struct {
    cfgPtr       atomic.Pointer[config.Config]
    rateLimitPtr atomic.Pointer[resilience.RateLimiter]
    // ...
}

func (s *Server) getConfig() *config.Config {
    return s.cfgPtr.Load()
}
```

50개 고루틴이 동시에 RLock을 잡으면 reader count 캐시라인에 contention이 발생한다. `atomic.Pointer`는 이를 완전히 제거한다. 쓰기(Reload) 쪽은 `Store()`로 변경:

```go
func (s *Server) Reload(newCfg *config.Config) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ... dbGroups 업데이트 (여전히 mutex 필요)

    // config, rateLimiter는 atomic으로 publish
    s.cfgPtr.Store(newCfg)
    if newCfg.RateLimit.Enabled {
        rl := resilience.NewRateLimiter(...)
        s.rateLimitPtr.Store(rl)
    } else {
        s.rateLimitPtr.Store(nil)
    }
}
```

### 2. ReadMessageReuse — 클라이언트 메시지 읽기 zero-alloc

`protocol.ReadMessage`는 호출마다 `make([]byte, 5+payloadLen)`을 할당한다. 매 쿼리마다 1회.

```go
// protocol/message.go
func ReadMessageReuse(r io.Reader, buf []byte) (*Message, []byte, error) {
    // ... header 읽기
    wireLen := 5 + payloadLen
    if cap(buf) >= wireLen {
        buf = buf[:wireLen]
    } else {
        buf = make([]byte, wireLen) // 크기 부족할 때만 새로 할당
    }
    // ... payload 읽기
    return &Message{Type: buf[0], Payload: buf[5:wireLen], Raw: buf[:wireLen]}, buf, nil
}
```

호출자가 `buf`를 다시 받아서 다음 호출에 전달하면, 대부분의 쿼리에서 allocation이 0이 된다.

**주의점**: 반환된 `Message.Raw`와 `Payload`가 공유 버퍼를 가리키므로, 다음 `ReadMessageReuse` 호출 시 덮어씌워진다. Simple Query path에서는 메시지를 읽고 → 처리하고 → 다음 메시지를 읽으므로 안전하다. 하지만 Extended Query path에서는 메시지를 `extBuf`에 쌓아둔 뒤 나중에 전송하므로, `CopyMessage()`로 deep copy해야 한다:

```go
// query.go — Extended Query path
case protocol.MsgParse:
    // ...
    extBuf = append(extBuf, protocol.CopyMessage(msg)) // deep copy 필수
```

### 3. wire buffer 재사용 — relayUntilReady alloc 제거

백엔드 응답을 클라이언트로 전달하는 `relayUntilReady`에서도 매 메시지마다 `make([]byte, wireLen)`을 했다.

```go
// Before
wire := make([]byte, wireLen) // 매 메시지 할당

// After
var wire []byte // 함수 시작 시 한 번 선언, 이후 재사용
if cap(wire) < wireLen {
    wire = make([]byte, wireLen) // 크기 부족할 때만 새로 할당
} else {
    wire = wire[:wireLen]
}
```

SELECT 1 응답은 4개 메시지(RowDesc, DataRow, CmdComplete, ReadyForQuery)로 구성되는데, 첫 메시지에서 할당된 버퍼가 나머지 3개에서 재사용된다.

### 4. Pool.Acquire 전면 리팩터링

기존 `Acquire`는 재귀 호출 방식이었다. 풀이 가득 차면 타이머를 생성하고 대기한 뒤, 재귀로 다시 시도했다. 문제가 두 가지 있었다:

1. **재귀 호출마다 `time.NewTimer` 생성** — 대기→재시도→만료된 커넥션→대기→재시도를 반복하면 타이머가 계속 생긴다
2. **`mu.Unlock()`과 `select` 사이의 빈틈** — 이 시간에 다른 고루틴이 커넥션을 반환하면 불필요하게 타이머 대기에 빠진다

이를 iterative loop + lazy timer + non-blocking fast path로 전면 재작성했다:

```go
func (p *Pool) Acquire(ctx context.Context) (*Conn, error) {
    // Lazy timer — 실제로 대기해야 할 때만 생성, 재시도 시 재사용
    var timer *time.Timer
    defer func() {
        if timer != nil {
            timer.Stop()
        }
    }()

    for {
        p.mu.Lock()
        // idle 커넥션 탐색 (만료/유휴 시 정리)
        for len(p.idle) > 0 {
            conn := p.idle[len(p.idle)-1]
            p.idle = p.idle[:len(p.idle)-1]
            if conn.expired(p.cfg.MaxLifetime) || conn.idle(p.cfg.IdleTimeout) {
                conn.Close()
                p.numOpen--
                continue
            }
            conn.LastUsedAt = time.Now()
            p.mu.Unlock()
            return conn, nil
        }
        // 새 커넥션 생성 가능하면 생성
        if p.numOpen < p.cfg.MaxConnections {
            p.numOpen++
            p.mu.Unlock()
            conn, err := p.newConn()
            if err != nil { /* numOpen 복원 */ }
            return conn, nil
        }
        p.mu.Unlock()

        // Fast path: 비차단으로 먼저 시도 — 타이머 할당 회피
        select {
        case <-p.waitCh:
            continue
        case <-ctx.Done():
            return nil, ctx.Err()
        default:
        }

        // Slow path: 타이머 생성 (최초 1회) 또는 재사용
        if timer == nil {
            timer = time.NewTimer(timeout)
        } else {
            timer.Reset(timeout) // drain 후 재사용
        }
        select {
        case <-p.waitCh:
            continue
        case <-timer.C:
            return nil, fmt.Errorf("acquire timeout")
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
}
```

핵심 변경점:
- **재귀 → for 루프**: 스택 프레임 축적 없음, 타이머 재사용 가능
- **lazy timer**: 대부분의 Acquire는 idle 커넥션이 있어서 타이머를 만들지 않는다
- **non-blocking select**: `mu.Unlock()` 직후 빈틈에서 반환된 커넥션을 즉시 잡는다

### 5. ForwardRaw — zero-copy 메시지 전달

기존에는 메시지를 전달할 때 `WriteMessage`로 다시 직렬화했다. `ReadMessage`가 이미 원본 wire bytes를 `msg.Raw`에 보관하고 있으므로, 이를 그대로 `Write`하면 된다:

```go
// protocol/message.go
func ForwardRaw(w io.Writer, msg *Message) error {
    if msg.Raw != nil {
        _, err := w.Write(msg.Raw) // zero-copy: 직렬화 없음
        return err
    }
    return WriteMessage(w, msg.Type, msg.Payload) // fallback
}
```

`forwardAndRelay`, `relayCopyIn`, `relayCopyOut`, `relayCopyBoth` 모두 `WriteMessage` → `ForwardRaw`로 교체했다. COPY 프로토콜처럼 대량 데이터가 오가는 경로에서 특히 효과적이다.

---

## 시도했다가 되돌린 것들

### 시도 1: 응답 batching — semantic 변경

#### 아이디어

pprof에서 syscall이 56%를 차지했다. 쿼리당 write syscall을 줄이면 성능이 올라갈 거라고 생각했다.

```go
// 원래: 메시지마다 1회 Write (4개 메시지 → 4회 syscall)
clientConn.Write(msg1)
clientConn.Write(msg2)
clientConn.Write(msg3)  // CmdComplete
clientConn.Write(msg4)  // ReadyForQuery

// 변경: ReadyForQuery까지 버퍼에 쌓은 뒤 1회 Write
outBuf = append(outBuf, msg1, msg2, msg3, msg4...)
clientConn.Write(outBuf) // 1회 syscall
```

대용량 결과셋을 위해 64KB 임계값도 추가했다. 벤치마크에서 SELECT c=50 기준 +3~7% TPS 개선을 확인했다.

#### 왜 되돌렸는가

이 최적화는 **프록시의 응답 전달 의미(semantics)를 바꾼다**.

원래 동작:
```
Backend → [RowDesc] → Proxy → Client (즉시 전달)
Backend → [DataRow] → Proxy → Client (즉시 전달)
Backend → [DataRow] → Proxy → Client (즉시 전달)
Backend → [CmdComplete] → Proxy → Client (즉시 전달)
Backend → [ReadyForQuery] → Proxy → Client (즉시 전달)
```

Batching 후:
```
Backend → [RowDesc] → Proxy (버퍼에 쌓음)
Backend → [DataRow] → Proxy (버퍼에 쌓음)
Backend → [DataRow] → Proxy (버퍼에 쌓음)
Backend → [CmdComplete] → Proxy (버퍼에 쌓음)
Backend → [ReadyForQuery] → Proxy → Client (한 번에 전달)
```

64KB 미만 결과는 클라이언트가 쿼리 완료 시점까지 아무것도 받지 못한다. 이것은:

1. **psql 같은 인터랙티브 클라이언트**에서 점진적 결과 표시가 불가능해진다
2. **대용량 FETCH 커서**에서 첫 row 도착까지 지연이 증가한다
3. **"투명한 PostgreSQL 프록시"**라는 pgmux의 정체성에 부합하지 않는다

3~7%의 TPS 이득이 이 tradeoff를 정당화하지 못한다. **성능 최적화는 관찰 가능한 동작을 바꾸지 않는 범위에서만 해야 한다.**

### 시도 2: unsafe.String — zero-alloc byte→string 변환

Go에서 `string([]byte)`는 항상 메모리를 복사한다. `unsafe.String`을 사용하면 복사 없이 `[]byte`를 `string`으로 변환할 수 있다:

```go
import "unsafe"

query := unsafe.String(&msg.Payload[0], len(msg.Payload))
```

이론적으로 쿼리당 1회 allocation을 제거할 수 있다. 하지만 `ReadMessageReuse`와 조합하면 위험하다. `unsafe.String`이 반환한 string이 공유 버퍼를 가리키는데, 다음 `ReadMessageReuse` 호출이 그 버퍼를 덮어쓴다. string이 immutable이라는 Go의 기본 가정이 깨진다.

실측 결과: TPC-B에서 **44% 성능 하락**. GC가 dangling reference를 추적하느라 오히려 더 많은 작업을 하게 된다. 바로 되돌렸다.

**교훈**: `unsafe`는 "빠르다"가 아니라 "제약을 없앤다"다. 제약이 없어지면 버그가 찾아온다.

### 시도 3: bufio.Reader + sync.Pool — 백엔드 읽기 syscall 감소

pprof에서 syscall이 56%를 차지했으니, 백엔드 응답을 읽을 때 `bufio.Reader`로 감싸서 read syscall을 줄이면 되지 않을까?

```go
var backendReaderPool = sync.Pool{
    New: func() any { return bufio.NewReaderSize(nil, 8192) },
}

// relayUntilReady 진입 시
br := backendReaderPool.Get().(*bufio.Reader)
br.Reset(backendConn)
defer backendReaderPool.Put(br)
// 이후 io.ReadFull(backendConn, ...) → io.ReadFull(br, ...)
```

벤치마크 결과 (c=50 SELECT-only):
- bufio 없음: **21,493 TPS**
- bufio + sync.Pool: **19,570 TPS** (−9%)

오히려 느려졌다. 이유:

1. **sync.Pool의 atomic 오버헤드** — `Get()`과 `Put()`은 내부적으로 per-P 캐시 + atomic 연산을 사용한다 (~200ns/호출)
2. **PostgreSQL 응답 크기가 작다** — SELECT 1 응답은 ~100 bytes. bufio의 8KB 버퍼가 오히려 불필요한 복사를 추가한다
3. **이미 커널이 버퍼링하고 있다** — TCP receive buffer가 같은 역할을 한다

**교훈**: bufio는 작은 read가 아주 많을 때 (파일 읽기, 로그 파싱 등) 효과적이다. 네트워크 I/O에서 이미 커널 버퍼가 있고, 메시지 크기가 작으면 역효과가 난다.

---

## 최종 벤치마크

batching 제거 후, behavioral-neutral 최적화만 적용한 결과:

### SELECT-only

| Target | c=1 | c=10 | c=50 | c=100 |
|--------|-----|------|------|-------|
| Direct | 2,964 | 18,665 | 35,970 | 36,893 |
| pgmux | 2,430 | 14,295 | 21,617 | 20,804 |
| PgBouncer | 2,445 | 15,873 | 28,417 | 28,492 |

### TPC-B (혼합 읽기/쓰기)

| Target | c=1 | c=10 | c=50 | c=100 |
|--------|-----|------|------|-------|
| Direct | 393 | 1,832 | 2,902 | 2,760 |
| pgmux | 321 | **1,892** | 2,469 | 2,420 |
| PgBouncer | 359 | 2,066 | 2,794 | 2,693 |

TPC-B c=10에서 pgmux(1,892)가 Direct(1,832)보다 빠르다. 커넥션 풀링이 PostgreSQL 내부 lock contention을 줄여주기 때문이다.

---

## 남은 갭의 본질

pprof 결과가 말해주는 것: **pgmux 코드는 이미 충분히 빠르다. 병목은 Go 런타임 자체다.**

| 비용 | 원인 | 해결 가능성 |
|------|------|-------------|
| syscall 56% | 쿼리당 ~12회 read/write | batching으로 줄일 수 있지만 투명성 훼손 |
| goroutine scheduling 40% | goroutine-per-connection 모델 | Go 아키텍처의 구조적 한계 |
| 애플리케이션 코드 ~0% | - | 이미 최적 |

PgBouncer가 빠른 이유: C로 작성된 **싱글 스레드 이벤트 루프**. 고루틴 스케줄링도, GC도, 스택 관리도 없다. 이것은 "Go vs C"의 차이가 아니라 **"goroutine-per-connection vs event loop"**의 차이다.

이 시점에서 더 성능을 올리려면 "더 빠르게"가 아니라 **"얼마나 덜 투명해져도 괜찮은가"**를 결정해야 한다. 그리고 우리는 투명성을 선택했다.

---

## 마무리

> 성능 최적화의 끝은 "더 이상 빨라지지 않는 시점"이 아니라, **"더 빠르게 만들면 무엇을 잃는지 알게 되는 시점"**이다.

이번 최적화에서 배운 것:

1. **pprof는 추측을 데이터로 바꿔준다** — "어디가 느릴까?" 대신 "여기가 느리다"
2. **atomic.Pointer는 읽기 빈도가 압도적일 때 RWMutex보다 낫다** — config 같은 read-mostly 데이터에 적합
3. **버퍼 재사용은 behavioral-neutral한 좋은 최적화다** — 같은 데이터를 같은 타이밍에 전달하되, 할당만 줄인다
4. **ForwardRaw는 가장 쉬운 최적화다** — 이미 읽은 wire bytes를 다시 직렬화하는 것은 낭비다
5. **Pool.Acquire를 iterative로 바꾸면 타이머 할당을 줄인다** — 재귀 호출은 매번 새 타이머를 만든다
6. **응답 batching은 성능 최적화가 아니라 semantic 변경이다** — 프록시의 전달 타이밍을 바꾸면 투명성이 깨진다
7. **unsafe.String은 GC와 공유 버퍼에서 역효과가 난다** — immutable 가정이 깨지면 44% 성능 하락
8. **bufio.Reader는 네트워크 I/O에서 항상 이득이 아니다** — 커널 버퍼가 이미 같은 역할을 한다
9. **"Go니까 느린 것"이 아니라 "goroutine-per-connection이니까 느린 것"이다** — 같은 Go로도 event loop를 구현할 수 있지만, 코드 복잡성이 급격히 증가한다

pgmux는 TPC-B에서 Direct의 85~103%를 달성한다. 이것은 커넥션 풀링의 가치를 정량적으로 증명한다. SELECT-only에서 PgBouncer 대비 느린 부분은 캐싱, 방화벽, 미러링, Multiplexing 등 PgBouncer에 없는 기능으로 보상된다.

다음 글에서는 커넥션 풀의 세션 상태 추적(DISCARD ALL 최적화), 라우터 lock 통합, 벤치마크 신뢰성 개선을 다룬다.
