---
title: "Go로 PostgreSQL 프록시 만들기 (20) - Hot Reload Data Race와 sync.RWMutex"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Bug Fix", "Concurrency", "Data Race"]
categories: ["Database"]
project: "pgmux"
description: "설정 파일 Hot Reload 시 concurrent map read/write로 프록시가 즉사하는 Critical 버그를 분석하고, sync.RWMutex로 수정한다."
---

## 들어가며

지난 글에서 readers를 선택사항으로 만들어 진입장벽을 낮췄다. 기능적으로는 잘 동작했는데, QA 팀에서 한 통의 리포트가 날아왔다.

> config.yaml을 수정해서 저장하는 그 순간, pgmux가 통째로 죽습니다.

`go test -race`로 확인해보니 100% 재현되는 Data Race였다. 18편에서 구현한 fsnotify 기반 Hot Reload가 원인이었다.

---

## 버그 분석

18편에서 구현한 흐름을 떠올려보자:

```
config.yaml 수정 → fsnotify 감지 → FileWatcher.onChange → Server.Reload()
```

`Reload()` 메서드의 핵심 부분:

```go
func (s *Server) Reload(newCfg *config.Config) error {
    oldCfg := s.cfg
    // ... 새 reader pool 생성, 제거된 reader pool 닫기 ...
    s.readerPools = newReaderPools  // map 덮어쓰기
    s.rateLimiter = newRateLimiter  // 포인터 교체
    s.cfg = newCfg                  // 포인터 교체
    return nil
}
```

문제는 이 코드가 실행되는 동안, 수백 개의 고루틴이 동시에 같은 필드들을 읽고 있다는 것이다:

```go
// 고루틴 A: 쿼리 처리 중
rPool, ok := s.readerPools[readerAddr]  // map 읽기
cfg := s.cfg.Routing.CausalConsistency  // 포인터 역참조

// 고루틴 B: Reload 실행 중
s.readerPools = newReaderPools          // map 쓰기 ← 충돌!
s.cfg = newCfg                          // 포인터 쓰기 ← 충돌!
```

Go에서 map의 읽기와 쓰기가 Lock 없이 동시에 발생하면 `fatal error: concurrent map read and map write`를 내뿜고 **프로세스가 즉사**한다. recover로도 잡을 수 없는 fatal error다.

### 왜 위험한가

이 버그의 악질적인 점은 **타이밍 의존적**이라는 것이다.

- 트래픽이 적은 새벽에 설정을 변경하면 → 잘 된다
- 피크 시간에 설정을 변경하면 → 프록시 즉사 → 전체 서비스 장애

설정 변경이라는 일상적인 운영 행위가 서비스 장애로 이어진다. 그리고 "새벽에 테스트했을 때는 잘 됐는데..."라는 말과 함께 프로덕션에서 터진다.

---

## race_test.go로 재현

```go
func TestServerReload_DataRace(t *testing.T) {
    srv := NewServer(cfg)

    // 고루틴 1: 쿼리 처리 시뮬레이션 (계속 읽기)
    go func() {
        for {
            _ = srv.readerPools["127.0.0.1:5433"]
            _ = srv.cfg.Pool.MaxConnections
        }
    }()

    // 고루틴 2: 설정 리로드 시뮬레이션 (계속 쓰기)
    go func() {
        for i := 0; i < 100; i++ {
            srv.Reload(newCfg)
        }
    }()
}
```

```bash
$ go test -race -run TestServerReload_DataRace ./internal/proxy/
WARNING: DATA RACE
Write at 0x00c00017a048 by goroutine 13:
  proxy.(*Server).Reload()
Previous read at 0x00c00017a048 by goroutine 12:
  proxy.TestServerReload_DataRace.func1()
--- FAIL: TestServerReload_DataRace
    testing.go:1617: race detected during execution of test
```

100% 재현된다.

---

## 수정: sync.RWMutex + Accessor 패턴

### 왜 RWMutex인가

선택지가 몇 가지 있었다:

| 방식 | 장점 | 단점 |
|------|------|------|
| `sync.Mutex` | 단순 | 읽기끼리도 직렬화 (성능 저하) |
| `sync.RWMutex` | 읽기 병렬, 쓰기 배타적 | 코드량 증가 |
| `atomic.Value` | Lock-free | map 교체에 추가 작업 필요 |

`RWMutex`를 선택했다. 이유:

1. **읽기가 99.99%** — 쿼리 처리는 초당 수천 번, Reload는 하루에 몇 번
2. **RLock 오버헤드는 ~5ns** — 경합이 없을 때 atomic add 1회 수준. 네트워크 I/O가 밀리초 단위인 프록시에서 무시 가능
3. **Go 표준 패턴** — 추가 의존성 없이 명확한 의미

### 구조체에 RWMutex 추가

```go
type Server struct {
    mu           sync.RWMutex // cfg, readerPools, readerCBs, rateLimiter 보호
    cfg          *config.Config
    readerPools  map[string]*pool.Pool
    readerCBs    map[string]*resilience.CircuitBreaker
    rateLimiter  *resilience.RateLimiter
    // ... 나머지 필드 (불변이므로 Lock 불필요)
}
```

보호 대상은 `Reload()`가 실제로 변경하는 4개 필드뿐이다. `writerPool`, `balancer`, `metrics` 등은 Reload에서 변경하지 않으므로 Lock이 필요 없다. (balancer는 내부에 자체 RWMutex가 있다.)

### Thread-safe Accessor 메서드

```go
func (s *Server) getConfig() *config.Config {
    s.mu.RLock()
    cfg := s.cfg
    s.mu.RUnlock()
    return cfg
}

func (s *Server) getReaderPool(addr string) (*pool.Pool, bool) {
    s.mu.RLock()
    p, ok := s.readerPools[addr]
    s.mu.RUnlock()
    return p, ok
}

func (s *Server) getRateLimiter() *resilience.RateLimiter {
    s.mu.RLock()
    rl := s.rateLimiter
    s.mu.RUnlock()
    return rl
}
```

핵심 포인트: RLock 구간에서 **포인터/참조만 복사**하고 즉시 해제한다. `Reload()`가 맵이나 포인터를 **통째로 교체**(in-place 수정이 아니라 새 객체 할당)하기 때문에, 한번 읽은 참조는 해제 후에도 안전하다. 이미 참조 중인 old map은 GC가 알아서 정리한다.

### Reload에 Write Lock 적용

```go
func (s *Server) Reload(newCfg *config.Config) error {
    s.mu.Lock()
    defer s.mu.Unlock()

    oldCfg := s.cfg
    // ... 기존 로직 그대로 ...
    s.readerPools = newReaderPools
    s.cfg = newCfg
    return nil
}
```

### Hot-path에서 직접 접근을 Accessor로 교체

변경이 필요한 곳이 30곳 이상이었다. 몇 가지 대표적인 패턴:

```go
// Before
if s.cfg.Firewall.Enabled { ... }
rPool, ok := s.readerPools[readerAddr]
if s.rateLimiter != nil && !s.rateLimiter.Allow() { ... }

// After
if s.getConfig().Firewall.Enabled { ... }
rPool, ok := s.getReaderPool(readerAddr)
if rl := s.getRateLimiter(); rl != nil && !rl.Allow() { ... }
```

`handleConnection`처럼 config를 여러 번 읽는 함수에서는 진입 시점에 한 번 스냅샷한다:

```go
func (s *Server) handleConnection(clientConn net.Conn) {
    cfg := s.getConfig()  // 스냅샷 1회
    if cfg.Auth.Enabled { ... }
    session := router.NewSession(cfg.Routing.ReadAfterWriteDelay, ...)
}
```

---

## 수정 후 검증

테스트를 accessor 메서드를 사용하도록 업데이트:

```go
func TestServerReload_DataRace(t *testing.T) {
    srv := NewServer(cfg)

    go func() {
        for {
            _, _ = srv.getReaderPool("127.0.0.1:5433")
            _ = srv.getConfig().Pool.MaxConnections
        }
    }()

    go func() {
        for i := 0; i < 100; i++ {
            srv.Reload(newCfg)
        }
    }()
}
```

```bash
$ go test -race -run TestServerReload_DataRace ./internal/proxy/
ok  github.com/jyukki97/pgmux/internal/proxy  1.787s
```

전체 테스트도 통과:

```bash
$ go test -race ./internal/...
ok  github.com/jyukki97/pgmux/internal/admin       1.258s
ok  github.com/jyukki97/pgmux/internal/audit       4.001s
ok  github.com/jyukki97/pgmux/internal/cache       2.098s
ok  github.com/jyukki97/pgmux/internal/config      8.659s
...
ok  github.com/jyukki97/pgmux/internal/proxy       3.376s
```

12개 패키지 전부 PASS, race 0건.

---

## 교훈

### 기능 구현과 동시성 보호는 한 세트다

18편에서 fsnotify Hot Reload를 구현할 때, "Reload가 설정을 교체한다"는 기능적 정확성만 검증했다. "교체하는 동안 다른 고루틴이 읽고 있다면?"이라는 동시성 질문을 하지 않았다.

Go에서 공유 상태를 변경하는 코드를 작성할 때는 반드시 물어야 한다: **"이 필드를 동시에 읽는 고루틴이 있는가?"** 있다면 반드시 동기화가 필요하다.

### go test -race는 CI 필수

`-race` 플래그 하나로 이 버그는 100% 잡힌다. 프로덕션에서 터지기 전에. CI 파이프라인에 `-race`를 넣지 않은 건 안전벨트를 매지 않은 것과 같다.

### RWMutex의 비용은 생각보다 저렴하다

"Lock을 걸면 느려지지 않나?"라는 우려가 있을 수 있다. 경합이 없는 RLock은 atomic add 한 번(~5ns)이다. pgmux의 쿼리 처리 시간이 수백 마이크로초~수 밀리초인 점을 고려하면, RLock 오버헤드는 **0.001% 미만**이다. 동시성 버그로 프록시가 죽는 것과 비교하면 공짜나 다름없다.

---

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
