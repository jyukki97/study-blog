---
title: "Go로 PostgreSQL 프록시 만들기 (26) - Cancel Request, Graceful Shutdown, Data Race"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Cancel Request", "Graceful Shutdown", "Data Race", "sync.Map", "sync.RWMutex"]
categories: ["Database"]
project: "pgmux"
description: "QA에서 발견된 3가지 버그 — CancelRequest 무시, Graceful Shutdown 무한 대기, Balancer 데이터 레이스 — 의 원인 분석과 수정 과정을 정리한다."
---

## 들어가며

P25에서 server.go를 9개 파일로 분리한 직후, QA 팀에서 3건의 버그 리포트가 도착했다. 하나는 Critical, 두 개는 Major/Critical — 모두 프로덕션에서 터지면 곤란한 종류다.

1. **CancelRequest 무시** — `Ctrl+C`로 쿼리 취소가 안 된다
2. **Graceful Shutdown 무한 대기** — 프로세스 종료 시 hang이 걸린다
3. **Balancer Data Race** — 핫리로드 중 `go test -race`에서 panic

세 건 모두 "프록시가 중간에 끼어 있어서 생기는" 전형적인 문제다.

---

## 버그 1: CancelRequest — 왜 Ctrl+C가 안 되는가

### 증상

`psql`에서 `SELECT pg_sleep(60)`을 실행하고 `Ctrl+C`를 누르면, 직접 연결 시에는 즉시 취소된다. 하지만 pgmux를 거치면 아무 반응이 없다.

### 원인

PostgreSQL의 쿼리 취소 프로토콜은 일반 쿼리와 **완전히 다른 경로**를 탄다.

1. 클라이언트가 **새로운 TCP 커넥션**을 연다 (기존 쿼리 커넥션과 별개)
2. StartupMessage 대신 특수한 16바이트 패킷을 보낸다:
   - 4바이트 길이 (16)
   - 4바이트 매직 코드 (`80877102`)
   - 4바이트 PID
   - 4바이트 Secret Key
3. 서버는 PID/Secret으로 세션을 찾아 쿼리를 취소한다

pgmux는 이 매직 코드를 처리하지 않고 있었다. `ParseStartupParams()`에 16바이트 패킷이 들어오면 파싱 실패 → 커넥션 종료 → 취소 요청 사라짐.

### 해법: Cancel Key 매핑 테이블

프록시가 중간에 있으면 **PID/Secret이 달라진다**는 게 핵심이다. 클라이언트가 아는 PID는 프록시가 보내준 가짜 PID이고, 실제 백엔드 PID는 다르다. 프록시는 이 매핑을 유지해야 한다.

```
클라이언트 ← [proxyPID, proxySecret] ← pgmux ← [backendPID, backendSecret] ← PostgreSQL
```

PgBouncer도 동일한 패턴을 사용한다.

#### 1단계: BackendKeyData 캡처

PostgreSQL은 인증 완료 후 `BackendKeyData('K')` 메시지로 PID와 Secret Key를 보낸다. `pgConnect()`에서 이 값을 캡처해야 한다.

```go
type backendKeyConn struct {
    net.Conn
    pid       uint32
    secretKey uint32
}

func (c *backendKeyConn) BackendKey() (uint32, uint32) {
    return c.pid, c.secretKey
}
```

`pgConnect()`의 인증 루프에서 `MsgBackendKeyData`를 만나면 PID/Secret을 저장하고, 함수 반환 시 `backendKeyConn`으로 감싸서 반환한다. `pool.Conn`은 `BackendKeyHolder` 인터페이스를 체크해서 값을 추출한다.

#### 2단계: Cancel Target 추적

각 클라이언트 세션마다 "현재 쿼리가 실행 중인 백엔드" 정보를 추적한다.

```go
type cancelTarget struct {
    mu         sync.Mutex
    backendAddr   string
    backendPID    uint32
    backendSecret uint32
}
```

Writer든 Reader든 백엔드 커넥션을 Acquire한 시점에 Set, Release한 시점에 Clear한다. 이 Set/Clear를 `relayQueries()`, `handleReadQuery()`, `handleExtendedRead()` 등 8개 함수에 걸쳐 배치했다.

#### 3단계: CancelRequest 포워딩

`handleConn()`에서 CancelRequest 매직 코드를 감지하면:

1. `sync.Map`에서 proxyPID/proxySecret으로 `cancelTarget` 조회
2. 조회된 실제 백엔드 주소로 **새 TCP 커넥션**을 열고
3. 실제 PID/Secret으로 16바이트 취소 패킷을 전송

```go
func forwardCancel(addr string, pid, secret uint32) error {
    conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
    if err != nil {
        return err
    }
    defer conn.Close()

    var buf [16]byte
    binary.BigEndian.PutUint32(buf[0:4], 16)
    binary.BigEndian.PutUint32(buf[4:8], protocol.CancelRequestCode)
    binary.BigEndian.PutUint32(buf[8:12], pid)
    binary.BigEndian.PutUint32(buf[12:16], secret)
    _, err = conn.Write(buf[:])
    return err
}
```

이제 `Ctrl+C` → 프록시가 취소를 백엔드로 중계 → 쿼리 취소.

---

## 버그 2: Graceful Shutdown 무한 대기

### 증상

`SIGTERM` 후 모든 클라이언트가 끊어져도 프로세스가 종료되지 않는 경우가 있다. `docker stop` 시 30초 후 `SIGKILL`로 강제 종료.

### 원인

`server.go`의 shutdown 코드:

```go
s.listener.Close()
s.wg.Wait() // ← 여기서 영원히 블록될 수 있다
```

`wg.Wait()`에 타임아웃이 없다. 커넥션 핸들링 고루틴 중 하나라도 정리가 안 되면 프로세스가 영원히 멈춘다.

### 해법

`sync.WaitGroup`은 타임아웃을 지원하지 않는다. 고루틴 + 채널로 감싸는 게 Go에서의 표준 패턴이다.

```go
done := make(chan struct{})
go func() {
    s.wg.Wait()
    close(done)
}()

timeout := s.getConfig().Proxy.ShutdownTimeout
if timeout == 0 {
    timeout = 30 * time.Second
}

select {
case <-done:
    slog.Info("all connections closed")
case <-time.After(timeout):
    slog.Warn("shutdown timeout, forcing exit", "timeout", timeout)
}
```

설정에 `shutdown_timeout` 항목을 추가했다. 기본값 30초.

```yaml
proxy:
  listen: ":5432"
  shutdown_timeout: 30s
```

---

## 버그 3: Balancer Data Race

### 증상

`go test -race`에서 설정 핫리로드 중 `MarkUnhealthy()`, `checkBackends()`, `HealthyCount()`에서 data race 감지. 프로덕션에서는 간헐적 panic 가능성.

### 원인

`RoundRobin` 구조체의 `Next()`와 `NextWithLSN()`은 이미 `r.mu.RLock()`으로 보호하고 있었다. 하지만 `MarkUnhealthy()`, `checkBackends()`, `HealthyCount()`는 **락 없이** `r.backends` 슬라이스에 접근하고 있었다.

```go
// 문제 코드 — 락 없이 슬라이스 순회
func (r *RoundRobin) MarkUnhealthy(addr string) {
    for i := range r.backends {  // ← 동시에 UpdateBackends()가 슬라이스 교체 가능
        if r.backends[i].Addr == addr {
            r.backends[i].Healthy = false
        }
    }
}
```

`UpdateBackends()`가 `r.mu.Lock()`으로 슬라이스를 통째로 교체하는 동안, 위 함수들이 옛 슬라이스를 읽고 있으면 data race다.

### 해법

`Next()`에서 이미 사용하는 패턴을 그대로 적용했다: RLock → 로컬 스냅샷 → RUnlock.

```go
func (r *RoundRobin) MarkUnhealthy(addr string) {
    r.mu.RLock()
    backends := r.backends  // 로컬 스냅샷
    r.mu.RUnlock()

    for i := range backends {
        if backends[i].Addr == addr {
            backends[i].Healthy = false
            break
        }
    }
}
```

`checkBackends()`와 `HealthyCount()`에도 동일한 패턴 적용. Race detector를 통과하는 테스트도 추가했다.

---

## 세 버그의 공통점

세 가지 버그 모두 "프록시가 중간에 있어서" 생기는 문제다.

| 버그 | 직접 연결 시 | 프록시 경유 시 |
|------|-------------|---------------|
| CancelRequest | PG가 직접 처리 | 프록시가 매핑/포워딩 필요 |
| Shutdown | 커넥션 1개 = 프로세스 1개 | WaitGroup으로 수백 개 추적 |
| Data Race | 설정 변경 = 재시작 | 핫리로드로 런타임 교체 |

프록시를 만들면 "원래 있던 것"을 중간에서 중계하는 일이 대부분이지만, 가끔은 **프록시만의 고유한 문제**를 풀어야 한다. 이번 세 건이 정확히 그 경우다.

---

## 마무리

- **CancelRequest**: 프록시의 가짜 PID ↔ 백엔드 실제 PID 매핑 테이블로 해결. `sync.Map` + `cancelTarget` 구조체.
- **Graceful Shutdown**: `WaitGroup.Wait()` + `time.After()` select 패턴. 설정으로 타임아웃 제어.
- **Data Race**: 이미 쓰고 있던 `RLock + 로컬 스냅샷` 패턴을 누락된 함수 3개에 일관 적용.

프록시 개발의 교훈 — PostgreSQL이 "당연히 해주는 것"을 프록시도 "당연히 해줘야" 한다. 매뉴얼에 적혀 있지만 잘 안 읽히는 Cancel Protocol이 그 좋은 예다.
