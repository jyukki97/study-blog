---
title: "Go로 PostgreSQL 프록시 만들기 (40) - sync.Pool로 할당 줄이기와 최적화의 한계"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Performance", "sync.Pool", "Allocation", "pprof"]
categories: ["Database"]
project: "pgmux"
description: "pprof 할당 프로파일링에서 찾은 상위 3개 핫스팟에 sync.Pool과 버퍼 사전할당을 적용한다. 그리고 Go 프록시 성능 최적화의 현실적 한계를 정리한다."
---

## 들어가며

[이전 글](/posts/2026-03-13-pgmux-39-session-dirty-tracking-benchmark-reliability/)에서 DISCARD ALL 최적화와 벤치마크 방법론을 다뤘다. 이번에는 pprof allocation 프로파일링에서 발견한 **상위 3개 할당 핫스팟**에 대한 최적화를 적용하고, unsafe.String 시도가 실패한 이야기, 그리고 Go 프록시 성능의 현실적 한계를 정리한다.

---

## pprof alloc 프로파일링 복습

c=100 SELECT-only 부하에서 `alloc_objects` 프로파일:

```
270K (19.7%)  ReadMessageReuse — 버퍼 성장
466K (34.0%)  time.NewTimer — Pool.Acquire 슬로우패스
153K (11.1%)  relayUntilReady — wire 버퍼 성장
213K (15.5%)  ExtractQueryText — string 변환
```

Go 유저 코드의 CPU 점유율은 2% 미만이었다. 나머지는 syscall(read/write/kevent)과 Go 런타임(스케줄러, GC). 즉 **CPU가 아니라 할당 횟수가 GC 부하를 통해 간접적으로 성능에 영향**을 미치는 구조다.

---

## 최적화 1: Timer sync.Pool (34% of allocs)

### 문제

`Pool.Acquire`에서 모든 idle 커넥션이 사용 중이면 슬로우 패스로 진입한다. c=100, max_conn=20이면 80개 고루틴이 매번 여기로 빠진다:

```go
// 기존: Acquire마다 새 Timer 할당
timer = time.NewTimer(timeout)
```

Timer는 내부적으로 runtime timer + channel을 생성하므로 할당 비용이 크다. 이미 retry 간 재사용은 하고 있었지만, **Acquire 호출 간 재사용은 안 되고 있었다**.

### 해결

```go
var timerPool = sync.Pool{
    New: func() any {
        return time.NewTimer(time.Hour)
    },
}

func (p *Pool) Acquire(ctx context.Context) (*Conn, error) {
    var timer *time.Timer
    defer func() {
        if timer != nil {
            if !timer.Stop() {
                select {
                case <-timer.C:
                default:
                }
            }
            timerPool.Put(timer)
        }
    }()

    for {
        // ... fast path ...

        // Slow path: pooled timer
        if timer == nil {
            timer = timerPool.Get().(*time.Timer)
        }
        if !timer.Stop() {
            select {
            case <-timer.C:
            default:
            }
        }
        timer.Reset(timeout)

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

핵심: defer에서 **반드시 Stop + drain 후 Put**해야 한다. 그렇지 않으면 다음 Get에서 이미 fired된 채널에서 즉시 수신되는 버그가 생긴다.

---

## 최적화 2: readBuf 사전할당 (20% of allocs)

### 문제

클라이언트 메시지를 읽는 `ReadMessageReuse`에 전달하는 버퍼가 `nil`로 시작:

```go
var readBuf []byte  // nil → 첫 메시지에서 반드시 할당
```

### 해결

```go
readBuf := make([]byte, 0, 512)  // SELECT 쿼리 대부분 커버
```

512바이트면 `SELECT * FROM users WHERE id = $1` 같은 일반적 쿼리의 wire 메시지(~50바이트)를 충분히 담는다. 첫 메시지에서의 할당을 제거하고, 이후 메시지는 기존 버퍼를 재활용한다.

---

## 최적화 3: wire 버퍼 sync.Pool (11% of allocs)

### 문제

`relayUntilReady`는 백엔드 응답을 클라이언트로 중계한다. 함수 내에서 wire 버퍼를 재사용하지만, **함수 호출마다 새로 할당**:

```go
func (s *Server) relayUntilReady(...) error {
    var wire []byte  // 호출마다 nil → 첫 메시지에서 할당
    for { ... }
}
```

### 해결

`*[]byte` 포인터를 sync.Pool로 관리:

```go
var wireBufPool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 1024)
        return &b
    },
}

func (s *Server) relayUntilReady(...) error {
    var hdr [5]byte
    bp := wireBufPool.Get().(*[]byte)
    wire := (*bp)[:0]
    defer func() {
        *bp = wire  // 성장한 슬라이스를 저장
        wireBufPool.Put(bp)
    }()
    for { ... }
}
```

`*[]byte`를 사용하는 이유: `[]byte`를 직접 `sync.Pool`에 넣으면 interface boxing 시 슬라이스 헤더가 복사된다. 포인터를 사용하면 boxing 할당이 없다. defer 클로저가 `wire` 변수를 캡처하므로, 루프 안에서 `wire = make([]byte, wireLen)`으로 성장해도 **마지막 값이 풀에 반환**된다.

---

## 실패: unsafe.String (15% of allocs)

남은 핫스팟은 `ExtractQueryText`의 `string(payload[:end])` 변환이었다. `unsafe.String`으로 zero-alloc 변환을 시도했다:

```go
// readBuf의 메모리를 직접 참조 — 할당 제로
query := unsafe.String(&payload[0], end)
```

**문제**: `query` 문자열이 비동기로 저장되는 경로가 있었다.

- `emitAuditEvent` → 채널로 전송, 워커가 나중에 처리
- `recordDigest` → map 키로 저장
- `mirrorQuery` → 채널로 전송, 워커풀이 나중에 처리

다음 루프에서 `readBuf`가 덮어씌워지면 이 비동기 경로에서 깨진 데이터를 읽게 된다. `strings.Clone`으로 조건부 복사하는 방법도 시도했지만, 벤치마크에서 **개선 효과가 노이즈 범위 내**였고 오히려 약간의 회귀가 관찰되었다. Revert.

### 교훈

`unsafe.String`은 "호출 스택 내에서만 사용"이 보장될 때만 안전하다. 감사 로그, 다이제스트, 미러링처럼 **비동기 파이프라인이 있는 시스템에서는 string이 어디까지 전파되는지 전체 콜 체인을 추적**해야 한다.

---

## 벤치마크 결과

`make bench-compare` (warmup 5s + 3회 × 10s 평균):

**SELECT-only**

| Target | c=1 | c=10 | c=50 | c=100 |
|--------|-----|------|------|-------|
| Direct | 2,447 | 16,724 | 25,483 | 25,488 |
| **pgmux** | **2,467** | **14,482** | **21,069** | **20,137** |
| PgBouncer | 2,178 | 13,812 | 23,665 | 21,778 |

**TPC-B**

| Target | c=1 | c=10 | c=50 | c=100 |
|--------|-----|------|------|-------|
| Direct | 413 | 2,282 | 3,306 | 3,156 |
| **pgmux** | **337** | **1,906** | **2,606** | **2,578** |
| PgBouncer | 370 | 2,070 | 2,757 | 2,745 |

c=1에서 pgmux(2,467)가 Direct(2,447)와 PgBouncer(2,178)를 모두 능가한다. c=100 SELECT-only에서 Direct 대비 79% 수준.

---

## Go 프록시 성능의 현실적 한계

pprof 분석 결과 **Go 유저 코드 CPU 점유율은 2% 미만**이었다. 나머지 98%는:

| 영역 | 비율 | 설명 |
|------|------|------|
| syscall (read/write/kevent) | ~60% | 네트워크 I/O |
| runtime.mcall / schedule | ~25% | 고루틴 스케줄링 |
| runtime.mallocgc | ~8% | 메모리 할당 + GC |
| 유저 코드 | ~2% | 라우팅, 파싱 등 |

PgBouncer와의 차이(c=100에서 ~7%p)는:

1. **이벤트 루프 vs 고루틴**: PgBouncer는 C 싱글스레드 + `epoll`/`kqueue` 직접 호출. Go는 고루틴 스케줄러가 netpoller를 간접 호출
2. **GC 없음 vs GC 있음**: PgBouncer는 수동 메모리 관리. Go는 GC가 주기적으로 실행
3. **Zero-copy**: PgBouncer는 `splice(2)`/`sendfile(2)` 가능. Go의 `net.Conn`은 유저 스페이스 버퍼를 거침

이건 **Go 런타임의 구조적 한계**로, 애플리케이션 코드 최적화로는 줄일 수 없다. 반대로 pgmux는 캐싱, 방화벽, 미러링, Prepared Statement Multiplexing 등 PgBouncer에 없는 기능을 제공하므로, 성능 갭보다 기능 차이가 더 크다.

---

## 정리

| 최적화 | 대상 | 방법 | alloc 비율 |
|--------|------|------|-----------|
| Timer sync.Pool | Pool.Acquire | sync.Pool 재활용 | 34% |
| readBuf 사전할당 | ReadMessageReuse | 512B 초기 할당 | 20% |
| wire 버퍼 sync.Pool | relayUntilReady | *[]byte sync.Pool | 11% |
| ~~unsafe.String~~ | ~~ExtractQueryText~~ | ~~zero-alloc string~~ | ~~15%~~ (revert) |

**배운 것:**
- pprof `alloc_objects`가 `cpu`보다 유용할 때가 있다 — GC 부하가 간접 병목인 경우
- sync.Pool은 Timer처럼 **생성 비용이 큰 객체**에 효과적
- unsafe.String은 비동기 파이프라인이 있는 시스템에서 위험
- Go 프록시의 성능 천장은 런타임(스케줄러, GC, netpoller)이 결정한다

다음 글에서는 이 PR을 마무리하고 전체 최적화 여정을 회고한다.
