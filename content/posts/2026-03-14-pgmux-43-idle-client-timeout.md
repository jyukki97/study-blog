---
title: "Go로 PostgreSQL 프록시 만들기 (43) - Idle Client Timeout"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Timeout", "Connection Management", "Production Safety"]
categories: ["Database"]
project: "pgmux"
description: "유휴 클라이언트를 자동으로 연결 해제하는 Idle Client Timeout을 구현한다. SetReadDeadline으로 타이머 없이 구현하고, 트랜잭션 중에는 비적용하여 안전성을 확보한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-42-query-timeout/)에서 쿼리 타임아웃을 구현했다. 쿼리가 실행 중일 때의 안전장치는 마련됐지만, **쿼리를 보내지 않고 연결만 유지하는 클라이언트**는 아직 방치되고 있다.

프로덕션에서 흔히 발생하는 시나리오:

- 애플리케이션이 커넥션을 열어놓고 연결을 반환하지 않는 버그
- 개발자가 `psql`로 접속해놓고 퇴근
- 네트워크 장애로 TCP half-open 상태가 된 좀비 연결
- 컨테이너가 graceful shutdown 없이 종료되어 남은 고아 연결

이런 유휴 연결이 쌓이면 프록시의 프런트엔드 리소스(goroutine, 파일 디스크립터)가 낭비되고, 커넥션 제한에 도달하면 정상 클라이언트가 거부당한다. PgBouncer의 `client_idle_timeout`에 대응하는 기능이다.

---

## 설계: SetReadDeadline vs Timer goroutine

유휴 클라이언트를 감지하는 방법은 크게 두 가지다.

### 1. 별도 Timer/Ticker goroutine

```go
timer := time.NewTimer(idleTimeout)
go func() {
    select {
    case <-timer.C:
        conn.Close()
    case <-activity:
        timer.Reset(idleTimeout)
    }
}()
```

문제: 클라이언트마다 goroutine을 하나 더 만들어야 한다. `activity` 채널을 통한 쿼리 활동 통지가 필요하고, goroutine 종료 관리도 해야 한다.

### 2. net.Conn.SetReadDeadline (채택)

```go
conn.SetReadDeadline(time.Now().Add(idleTimeout))
msg, err := protocol.ReadMessageReuse(conn, buf)
if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
    // idle timeout!
}
```

Go의 `net.Conn`은 `SetReadDeadline`을 지원한다. 다음 읽기 전에 deadline을 설정하면, 그 시간까지 데이터가 오지 않을 때 `net.Error`를 반환한다.

이 방법의 장점:

- **추가 goroutine 불필요** — 기존 쿼리 루프에서 자연스럽게 처리
- **추가 채널/상태 불필요** — deadline이 매 루프마다 리셋되므로 활성 클라이언트는 절대 만료되지 않음
- **성능 오버헤드 제로** — 비활성(timeout=0) 시 deadline을 설정하지 않으므로 기존 코드 경로와 동일
- **정확한 타이밍** — OS 레벨 소켓 타이머를 사용하므로 Go 런타임 스케줄링과 무관

---

## 구현

### 설정

```yaml
proxy:
  client_idle_timeout: 5m   # 0 = 무제한 (기본)
```

```go
type ProxyConfig struct {
    Listen            string        `yaml:"listen"`
    ShutdownTimeout   time.Duration `yaml:"shutdown_timeout"`
    ClientIdleTimeout time.Duration `yaml:"client_idle_timeout"` // 0 = disabled
}
```

기본값 0은 Go의 zero value와 일치하므로 기존 설정과 하위호환된다. `applyDefaults()`에 추가할 필요도 없다.

### 핵심 로직

`relayQueries` 루프 — 클라이언트 메시지를 읽기 전에 deadline을 설정한다:

```go
for {
    // Set idle timeout deadline on client read.
    // Only apply when not in a transaction (boundWriter == nil).
    if idleTimeout := s.getConfig().Proxy.ClientIdleTimeout; idleTimeout > 0 && boundWriter == nil {
        clientConn.SetReadDeadline(time.Now().Add(idleTimeout))
    } else {
        clientConn.SetReadDeadline(time.Time{}) // clear deadline
    }

    msg, readBuf, err = protocol.ReadMessageReuse(clientConn, readBuf)
    if err != nil {
        if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
            slog.Info("client idle timeout", "remote", clientConn.RemoteAddr(),
                "timeout", s.getConfig().Proxy.ClientIdleTimeout)
            if s.metrics != nil {
                s.metrics.ClientIdleTimeouts.Inc()
            }
            s.sendFatalWithCode(clientConn, "57P01",
                "terminating connection due to idle timeout")
            return
        }
        slog.Debug("client disconnected", "error", err)
        return
    }
    // ... 나머지 쿼리 처리
}
```

몇 가지 포인트:

**1. 트랜잭션 중에는 비적용**

`boundWriter == nil` 조건이 핵심이다. `BEGIN` ~ `COMMIT`/`ROLLBACK` 사이에서는 클라이언트가 쿼리 사이에 시간을 들일 수 있다 — 트랜잭션 안에서 애플리케이션 로직을 처리하거나, 사용자 입력을 기다릴 수 있다. 트랜잭션 중 idle timeout을 적용하면 데이터 일관성 문제가 생길 수 있으므로 `else` 절에서 deadline을 해제한다.

**2. 매 루프마다 Config 읽기**

`s.getConfig()`는 `atomic.Pointer`에서 읽으므로 lock-free다. 설정 파일이 변경되면 `FileWatcher`가 새 Config를 store하고, 다음 루프에서 즉시 반영된다. **별도의 reload 핸들러나 시그널 없이 hot-reload가 자동으로 동작**한다.

**3. FATAL 57P01**

PostgreSQL 표준 SQLSTATE `57P01`은 `admin_shutdown`이다. PgBouncer도 idle timeout 시 이 코드를 사용한다. pgx, JDBC 등 드라이버가 이 에러를 받으면 커넥션을 폐기하고 새로 연결한다 — 커넥션 풀이 있는 애플리케이션에서는 사실상 투명하게 처리된다.

**4. deadline 해제**

`time.Time{}` (zero value)를 전달하면 deadline이 완전히 해제된다. 이전에 설정된 deadline이 있더라도 무효화된다.

---

## 쿼리 타임아웃과의 차이

이전 글에서 구현한 Query Timeout과 비교하면:

| 항목 | Query Timeout | Idle Client Timeout |
|------|---------------|---------------------|
| 대상 | 쿼리 실행 중 (백엔드 대기) | 쿼리 간 유휴 시간 (클라이언트 대기) |
| 적용 지점 | 백엔드 커넥션 | 프런트엔드(클라이언트) 커넥션 |
| 메커니즘 | `time.AfterFunc` + CancelRequest | `SetReadDeadline` |
| 에러 코드 | `57014` (query_canceled) | `57P01` (admin_shutdown) |
| 커넥션 | 풀에 반환 (재사용) | 종료 (클라이언트 재접속 필요) |
| 트랜잭션 중 | 적용됨 | 비적용 |

Query Timeout은 "쿼리가 너무 오래 걸린다"를, Idle Client Timeout은 "아무 쿼리도 보내지 않는다"를 처리한다. 둘은 상호 보완적이다.

---

## Prometheus 메트릭

```go
ClientIdleTimeouts: prometheus.NewCounter(
    prometheus.CounterOpts{
        Name: "pgmux_client_idle_timeout_total",
        Help: "Total number of client connections closed due to idle timeout.",
    },
)
```

라벨 없는 단일 counter다. Query Timeout과 달리 writer/reader 구분이 의미 없다 — idle timeout은 쿼리 라우팅 전에 발생하므로.

```promql
# 최근 5분간 idle timeout 비율
rate(pgmux_client_idle_timeout_total[5m])

# 전체 연결 대비 idle timeout 비율
pgmux_client_idle_timeout_total
  / on() pgmux_active_connections_by_user
```

급증하면 커넥션 풀 설정 문제(maxIdleTime이 프록시 timeout보다 긴 경우) 또는 네트워크 불안정을 의심할 수 있다.

---

## 테스트

5개 테스트로 각 측면을 검증했다:

| 테스트 | 검증 항목 |
|--------|-----------|
| `DisconnectsIdleClient` | TCP 소켓의 `SetReadDeadline` 만료 시 `net.Error.Timeout()` 반환 확인 |
| `ConfigZeroDisablesTimeout` | timeout=0 설정 시 disabled 확인 |
| `ConfigReload` | `atomic.Pointer`를 통한 런타임 설정 변경 반영 확인 |
| `SendsFatalOnTimeout` | FATAL ErrorResponse 포맷 검증 — Severity `S`, Code `C`(57P01), Message `M` 필드 |
| `MetricIncrement` | Prometheus counter 등록 및 증가 동작 검증 |

`SendsFatalOnTimeout` 테스트에서는 실제 TCP 소켓을 열어 ErrorResponse를 읽고, PG 프로토콜 필드를 파싱하여 검증한다:

```go
func TestIdleClientTimeout_SendsFatalOnTimeout(t *testing.T) {
    // TCP 소켓 쌍 생성
    ln, _ := net.Listen("tcp", "127.0.0.1:0")
    go func() { serverConn <- ln.Accept() }()
    clientConn, _ := net.Dial("tcp", ln.Addr().String())

    s := &Server{}
    s.sendFatalWithCode(<-serverConn, "57P01",
        "terminating connection due to idle timeout")

    // 클라이언트에서 ErrorResponse 수신
    msg, _, _ := protocol.ReadMessageReuse(clientConn, nil)

    // PG 프로토콜 필드 검증
    assert(msg.Type == 'E')            // ErrorResponse
    assert(containsField('S', "FATAL"))
    assert(containsField('C', "57P01"))
    assert(containsField('M', "terminating connection due to idle timeout"))
}
```

---

## PgBouncer 비교

| 항목 | PgBouncer | pgmux |
|------|-----------|-------|
| 설정 | `client_idle_timeout` (초 단위) | `proxy.client_idle_timeout` (duration) |
| 기본값 | 0 (무제한) | 0 (무제한) |
| 트랜잭션 중 | 적용됨 (위험) | 비적용 (안전) |
| 에러 코드 | 57P01 | 57P01 |
| Hot-reload | SIGHUP | 자동 (atomic.Pointer) |
| 메트릭 | 로그만 | Prometheus counter |
| 메커니즘 | 이벤트 루프 타이머 | SetReadDeadline |

가장 큰 차이는 **트랜잭션 중 동작**이다. PgBouncer는 트랜잭션 중에도 idle timeout을 적용하므로, 긴 트랜잭션에서 문 사이 간격이 길면 예기치 않게 연결이 끊길 수 있다. pgmux는 트랜잭션 중에는 deadline을 해제하여 이 문제를 원천 차단한다.

---

## 마무리

이번 구현의 포인트:

1. **추가 goroutine 없는 구현** — `SetReadDeadline` 하나로 해결. 기존 쿼리 루프의 blocking read에 deadline을 걸기만 하면 된다
2. **트랜잭션 안전성** — `boundWriter != nil`일 때 deadline 해제. 데이터 일관성을 해치지 않는다
3. **자동 hot-reload** — `atomic.Pointer`로 매 루프마다 최신 config를 읽으므로 별도 처리 없이 런타임 변경 가능
4. **표준 에러 코드** — SQLSTATE 57P01로 모든 PG 드라이버가 적절히 처리

Query Timeout(42편)과 Idle Client Timeout(이번)으로 "쿼리가 너무 오래 걸리는 것"과 "아무 것도 안 하면서 자리만 차지하는 것" — 프로덕션의 두 가지 리소스 낭비 시나리오를 모두 방어할 수 있게 되었다.

다음은 Phase 29의 나머지 과제인 Admin API Auth/RBAC 또는 Health Check Endpoint를 다룰 예정이다.
