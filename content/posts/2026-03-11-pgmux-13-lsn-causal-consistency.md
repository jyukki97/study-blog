---
title: "Go로 PostgreSQL 프록시 만들기 (13) - LSN 기반 Causal Consistency"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Replication", "LSN", "Causal Consistency"]
categories: ["Database"]
description: "타이머 대신 WAL LSN을 추적하여, 쓰기 직후 읽기에서 정확히 복제된 Reader만 선택한다."
---

## 들어가며

이전 구현에서는 쓰기 직후 읽기의 일관성을 보장하기 위해 `read_after_write_delay`라는 타이머 기반 방식을 사용했다. Writer에 쓰기가 발생하면 일정 시간(예: 100ms) 동안 해당 세션의 읽기를 Writer로 보내는 방식이다.

이 접근법은 간단하지만 근본적인 한계가 있다.

- **과소 추정**: 복제 지연이 설정한 타이머보다 길면 stale read가 발생한다.
- **과대 추정**: 복제가 이미 완료됐어도 타이머가 남아있으면 불필요하게 Writer에 부하를 준다.
- **실제 복제 상태와 무관**: 타이머는 "시간이 이 정도 지났으면 복제됐겠지"라는 추정일 뿐, 실제 Replica의 상태를 반영하지 않는다.

결국 정확한 read-after-write consistency를 보장하려면, PostgreSQL의 WAL(Write-Ahead Log) LSN(Log Sequence Number)을 직접 추적해야 한다. 이번 Phase 12에서는 LSN 기반 Causal Consistency를 구현했다.

## LSN이란

PostgreSQL의 LSN(Log Sequence Number)은 WAL 로그 내 위치를 나타내는 값이다. 모든 트랜잭션은 WAL에 순서대로 기록되며, 각 기록 위치가 곧 LSN이다.

- Writer(Primary)의 현재 WAL 위치: `pg_current_wal_lsn()`
- Reader(Replica)가 재생한 마지막 WAL 위치: `pg_last_wal_replay_lsn()`

Writer의 LSN이 `0/1A3B4C0`이고, Replica의 replay LSN이 `0/1A3B4C0` 이상이면, 해당 Replica는 Writer의 해당 시점까지 복제가 완료된 것이다.

## LSN 타입 구현

PostgreSQL은 LSN을 `"X/XXXXXXXX"` 형태의 문자열로 반환한다. 예를 들어 `"0/1A3B4C0"`처럼 슬래시를 기준으로 상위 32비트와 하위 32비트로 나뉜다.

이를 비교 연산하려면 단일 정수로 변환하는 것이 효율적이다. `internal/router/lsn.go`에 LSN 타입을 구현했다.

```go
type LSN uint64

const InvalidLSN LSN = 0

func ParseLSN(s string) (LSN, error) {
    parts := strings.SplitN(s, "/", 2)
    if len(parts) != 2 {
        return InvalidLSN, fmt.Errorf("invalid LSN format: %s", s)
    }
    hi, err := strconv.ParseUint(parts[0], 16, 32)
    if err != nil {
        return InvalidLSN, fmt.Errorf("invalid LSN high part: %w", err)
    }
    lo, err := strconv.ParseUint(parts[1], 16, 32)
    if err != nil {
        return InvalidLSN, fmt.Errorf("invalid LSN low part: %w", err)
    }
    return LSN(hi<<32 | lo), nil
}

func (l LSN) String() string {
    return fmt.Sprintf("%X/%X", uint32(l>>32), uint32(l))
}
```

`uint64`로 변환하면 두 LSN 간 비교가 단순한 정수 비교(`>=`)로 O(1)에 수행된다. 또한 두 LSN의 차이를 바이트 단위 복제 지연으로 해석할 수 있어 메트릭 수집에도 유용하다.

## Session에 LSN 트래킹 추가

`internal/router/router.go`의 `Session` 구조체에 LSN 추적 필드를 추가했다.

```go
type Session struct {
    // ... 기존 필드 ...
    causalConsistency bool
    lastWriteLSN      LSN
}
```

동작 흐름은 다음과 같다.

**쓰기 후 LSN 캡처:**

쓰기 쿼리가 Writer에서 실행된 후, 즉시 `pg_current_wal_lsn()`을 쿼리하여 해당 세션의 `lastWriteLSN`을 갱신한다.

```go
func (s *Session) captureWriteLSN(conn net.Conn) error {
    row := queryRow(conn, "SELECT pg_current_wal_lsn()")
    lsn, err := ParseLSN(row)
    if err != nil {
        return fmt.Errorf("capture write LSN: %w", err)
    }
    s.lastWriteLSN = lsn
    return nil
}
```

**읽기 시 LSN 기반 라우팅:**

읽기 쿼리가 들어오면 세션의 `lastWriteLSN`을 Balancer에 전달한다. Balancer는 이 LSN 이상으로 복제가 완료된 Reader만 후보로 선택한다.

```go
func (s *Session) route(query string) (*pool.Conn, error) {
    if isWriteQuery(query) {
        conn, err := s.pool.Acquire(s.writerAddr)
        // ... 쓰기 실행 후 LSN 캡처 ...
        return conn, err
    }

    if s.causalConsistency && s.lastWriteLSN != InvalidLSN {
        addr := s.balancer.NextWithLSN(s.lastWriteLSN)
        return s.pool.Acquire(addr)
    }

    addr := s.balancer.Next()
    return s.pool.Acquire(addr)
}
```

## Balancer LSN-aware 라우팅

`internal/router/balancer.go`의 `Backend` 구조체에 각 Reader의 현재 replay LSN을 추적하는 필드를 추가했다.

```go
type Backend struct {
    Addr      string
    replayLSN atomic.Uint64 // 현재 Reader의 replay LSN
}

func (b *Backend) ReplayLSN() LSN {
    return LSN(b.replayLSN.Load())
}
```

`atomic.Uint64`를 사용한 이유는 LSN 폴링 고루틴과 라우팅 고루틴이 동시에 접근하기 때문이다. lock-free로 안전하게 읽기/쓰기가 가능하다.

**NextWithLSN 메서드:**

```go
func (b *Balancer) NextWithLSN(minLSN LSN) string {
    candidates := make([]*Backend, 0)
    for _, backend := range b.readers {
        if backend.ReplayLSN() >= minLSN {
            candidates = append(candidates, backend)
        }
    }

    // 조건을 만족하는 Reader가 없으면 Writer로 fallback
    if len(candidates) == 0 {
        return b.writerAddr
    }

    // candidates 중 라운드로빈 선택
    idx := b.lsnRoundRobin.Add(1)
    return candidates[idx%uint64(len(candidates))].Addr
}
```

핵심은 **fail-open** 전략이다. 모든 Reader의 replay LSN이 요구 LSN보다 낮으면 Writer로 fallback한다. 이렇게 하면 stale read는 절대 발생하지 않으며, 최악의 경우 Writer 부하가 일시적으로 증가할 뿐이다.

**SetReplayLSN 메서드:**

```go
func (b *Balancer) SetReplayLSN(addr string, lsn LSN) {
    for _, backend := range b.readers {
        if backend.Addr == addr {
            backend.replayLSN.Store(uint64(lsn))
            return
        }
    }
}
```

## LSN 폴링 고루틴

`internal/proxy/server.go`에서 1초 간격으로 각 Reader의 replay LSN을 폴링하는 고루틴을 시작한다.

```go
func (s *Server) startLSNPolling(ctx context.Context) {
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.pollReaderLSNs()
        }
    }
}

func (s *Server) pollReaderLSNs() {
    writerLSN := s.queryLSN(s.writerAddr, "SELECT pg_current_wal_lsn()")

    for _, addr := range s.readerAddrs {
        replayLSN := s.queryLSN(addr, "SELECT pg_last_wal_replay_lsn()")
        if replayLSN != InvalidLSN {
            s.balancer.SetReplayLSN(addr, replayLSN)
        }

        // 복제 지연 메트릭 갱신
        if writerLSN != InvalidLSN && replayLSN != InvalidLSN {
            lagBytes := float64(uint64(writerLSN) - uint64(replayLSN))
            metrics.ReaderLSNLagBytes.WithLabelValues(addr).Set(lagBytes)
        }
    }
}
```

Prometheus 메트릭 `pgmux_reader_lsn_lag_bytes`를 통해 각 Reader의 복제 지연을 바이트 단위로 모니터링할 수 있다. 이 메트릭이 지속적으로 높다면 Reader 증설이나 복제 구성 점검이 필요하다는 신호다.

## 타이머 vs LSN 비교

| 항목 | Timer 방식 | LSN 방식 |
|------|-----------|---------|
| 정확도 | 추정 (시간 기반) | 정확 (WAL 위치 기반) |
| 오버헤드 | 없음 | Reader 폴링 (1초 간격) |
| stale read | 가능 (타이머 < 복제 지연 시) | 불가 (fail-open) |
| Writer 부하 | 타이머 동안 항상 Writer 사용 | 복제 완료 시 즉시 Reader 사용 |
| 구현 복잡도 | 낮음 | 중간 |
| 복제 지연 가시성 | 없음 | 메트릭으로 확인 가능 |

Timer 방식은 구현이 간단하지만, 복제 지연이 불규칙한 환경에서는 stale read 위험이 있다. LSN 방식은 폴링 오버헤드가 있지만, 실제 복제 상태를 정확히 반영하므로 일관성 보장이 확실하다.

다만 두 방식은 배타적이지 않다. LSN 폴링이 실패하거나 Reader 연결이 불안정할 때 Timer 방식으로 자동 전환하는 하이브리드 접근도 가능하다.

## 배운 점

**LSN 비교의 원리.** PostgreSQL의 LSN은 WAL 파일 내 바이트 오프셋이다. 단순히 "어떤 트랜잭션까지 복제됐는가"를 넘어, 두 LSN의 차이가 곧 복제 지연의 바이트 수를 의미한다. 이를 `uint64`로 변환하면 비교와 차이 계산이 모두 O(1)이 된다.

**Fail-open 설계.** 분산 시스템에서 가장 중요한 결정 중 하나는 "정보가 불확실할 때 어떻게 할 것인가"이다. LSN 폴링이 실패하거나 모든 Reader의 LSN이 부족할 때, Writer로 fallback하는 fail-open 전략을 선택했다. 가용성을 희생하더라도 일관성을 보장하는 것이 이 프록시의 핵심 가치다.

**폴링 주기와 트레이드오프.** 폴링 간격을 1초로 설정했다. 간격이 짧을수록 Reader의 LSN 정보가 최신이지만 DB 부하가 증가한다. 간격이 길면 실제로는 복제가 완료된 Reader도 한동안 후보에서 제외될 수 있다. 1초는 대부분의 워크로드에서 합리적인 균형점이지만, 설정으로 조절할 수 있게 구현했다.

**atomic 연산의 활용.** `sync.Mutex` 대신 `atomic.Uint64`를 사용해 lock-free로 LSN을 읽고 쓴다. 폴링 고루틴은 `Store`, 라우팅 고루틴은 `Load`만 수행하므로 경합이 최소화된다. 단순한 정수값의 동시 접근에는 atomic이 mutex보다 훨씬 효율적이다.

---

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
