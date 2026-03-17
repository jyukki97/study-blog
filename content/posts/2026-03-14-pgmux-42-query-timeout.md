---
title: "Go로 PostgreSQL 프록시 만들기 (42) - Query Timeout과 CancelRequest"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Timeout", "CancelRequest", "Production Safety"]
categories: ["Database"]
project: "pgmux"
description: "프록시 레벨 쿼리 타임아웃을 구현한다. time.AfterFunc으로 타이머를 설정하고, 만료 시 CancelRequest 프로토콜을 전송하여 PostgreSQL이 자연스럽게 쿼리를 취소하도록 한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-41-per-user-connection-limits/)에서 Per-User/Per-DB 커넥션 제한을 구현했다. 이번에는 **프로덕션 환경의 또 다른 필수 안전장치** — 쿼리 타임아웃을 추가한다.

프로덕션에서 한 번쯤은 이런 상황을 겪는다:

- 인덱스 없는 `JOIN`이 풀스캔을 시작해서 30분째 돌아가는 쿼리
- ORM이 생성한 비효율적 쿼리가 커넥션 풀을 점유
- 마이그레이션 스크립트가 락을 잡고 놓지 않는 상황

PostgreSQL에도 `statement_timeout` 설정이 있지만, 프록시에서 타임아웃을 관리하면:

1. **백엔드 설정 변경 없이 적용** — DB마다 `ALTER SYSTEM`을 돌릴 필요 없다
2. **쿼리별 힌트로 세밀한 제어** — 전역 30초지만 특정 배치 쿼리는 5분
3. **프록시 메트릭으로 관측** — 어떤 쿼리가 타임아웃됐는지 Prometheus에서 확인

---

## 설계: 왜 CancelRequest인가

쿼리 타임아웃을 구현하는 방법은 크게 세 가지다:

### 1. 커넥션 read deadline 설정

```go
backendConn.SetReadDeadline(time.Now().Add(timeout))
```

문제: deadline이 만료되면 `io.ErrDeadlineExceeded` 에러로 읽기가 실패한다. 그러나 **백엔드는 쿼리를 계속 실행 중**이다. 커넥션을 닫아도 PostgreSQL 백엔드 프로세스는 쿼리를 끝까지 실행한다. 커넥션 풀에서 이 커넥션을 재사용할 수도 없다.

### 2. context.WithTimeout + 커넥션 닫기

```go
ctx, cancel := context.WithTimeout(ctx, timeout)
defer cancel()
// ...ctx.Done() → backendConn.Close()
```

마찬가지로 백엔드 프로세스는 계속 실행된다. 커넥션이 닫히면 결국 백엔드가 파이프 깨짐을 감지하긴 하지만, 즉시 취소되지 않고 커넥션을 풀에 반환할 수도 없다.

### 3. CancelRequest 프로토콜 (채택)

PostgreSQL에는 **전용 취소 프로토콜**이 있다. 새로운 TCP 커넥션을 열어 16바이트 메시지를 보내면:

```
[4 bytes: length=16] [4 bytes: 80877102] [4 bytes: PID] [4 bytes: Secret]
```

PostgreSQL은 해당 PID의 실행 중인 쿼리를 **즉시 취소**하고, 원래 커넥션에 ErrorResponse(SQLSTATE `57014`, `query_canceled`)와 ReadyForQuery를 보낸다.

이 방법이 가장 깔끔한 이유:

- **백엔드가 실제로 쿼리 실행을 중단**한다
- **기존 relay 로직을 전혀 수정하지 않아도 된다** — PostgreSQL이 보내는 ErrorResponse + ReadyForQuery가 자연스럽게 클라이언트로 중계된다
- **커넥션이 오염되지 않는다** — ReadyForQuery를 받으면 풀에 정상 반환할 수 있다
- **이미 구현된 `forwardCancel()` 함수를 그대로 재사용**할 수 있다

---

## 구현

### 설정

```yaml
pool:
  query_timeout: 30s   # 0 = 무제한 (기본)
```

```go
type PoolConfig struct {
    // ...
    QueryTimeout time.Duration `yaml:"query_timeout"` // 0 = disabled
    // ...
}
```

기본값 0은 Go의 zero value와 일치하여 기존 설정과 하위호환된다.

### 타이머 로직

핵심은 `time.AfterFunc`다:

```go
func (s *Server) startQueryTimer(
    timeout time.Duration,
    ct *cancelTarget,
    target string,
) func() {
    if timeout <= 0 {
        return nil  // disabled
    }
    timer := time.AfterFunc(timeout, func() {
        addr, pid, secret := ct.get()
        if addr == "" || pid == 0 {
            return  // 이미 쿼리가 완료됨
        }
        slog.Warn("query timeout exceeded, sending cancel request",
            "timeout", timeout, "backend_pid", pid)
        if s.metrics != nil {
            s.metrics.QueryTimeouts.WithLabelValues(target).Inc()
        }
        forwardCancel(addr, pid, secret)
    })
    return func() { timer.Stop() }
}
```

**`cancelTarget`의 역할이 핵심이다.** 기존 CancelRequest 처리를 위해 이미 만들어둔 구조체인데:

```go
type cancelTarget struct {
    proxyPID, proxySecret uint32        // 클라이언트에게 알려준 식별자
    mu                    sync.Mutex
    backendAddr           string        // 현재 쿼리 실행 중인 백엔드 주소
    backendPID            uint32        // 백엔드 프로세스 PID
    backendSecret         uint32        // 백엔드 cancel 시크릿
}
```

쿼리 실행 전 `ct.setFromConn(addr, conn)`으로 설정하고, 실행 후 `ct.clear()`로 초기화한다. 타이머가 발화될 때 `ct.get()`으로 현재 값을 가져오는데, 이미 `clear()`됐으면 빈 값이 반환되어 아무 것도 하지 않는다.

이 패턴은 **자연스러운 race condition 방어**가 된다:
- 쿼리가 타이머 만료 직전에 완료 → `ct.clear()` → 타이머 콜백에서 addr="" 확인 → 스킵
- 타이머가 먼저 발화 → CancelRequest 전송 → PostgreSQL이 에러 반환 → relay가 에러를 전달 → 정상 흐름

### 쿼리 루프에 통합

Simple Query 경로 (writer):

```go
ct.setFromConn(dbg.writerAddr, wConn)
stopTimer := s.startQueryTimer(queryTimeout, ct, target)
s.handleWriteQuery(clientConn, wConn, msg, ...)
if stopTimer != nil {
    stopTimer()
}
ct.clear()
```

Simple Query 경로 (reader):

```go
ct.setFromConn(readerAddr, rConn)
stopTimer := s.startQueryTimer(queryTimeout, ct, "reader")

// Forward + Relay
collected, err := s.relayAndCollect(clientConn, rConn)
if stopTimer != nil {
    stopTimer()
}
ct.clear()
```

Extended Query (Sync 처리 시) 도 동일한 패턴으로 적용했다. **기존 relay 코드는 한 줄도 수정하지 않았다.**

### 에러 전파 흐름

타임아웃이 발생하면 흐름은 이렇다:

```
1. time.AfterFunc 발화
   └→ forwardCancel(addr, pid, secret)
       └→ 새 TCP 연결 → [16 bytes CancelRequest] 전송

2. PostgreSQL 백엔드
   └→ 실행 중인 쿼리 취소
   └→ 원래 커넥션에 ErrorResponse 전송:
       - Severity: ERROR
       - Code: 57014 (query_canceled)
       - Message: "canceling statement due to user request"
   └→ ReadyForQuery('I') 전송

3. 프록시의 relayUntilReady()
   └→ ErrorResponse를 클라이언트에 그대로 전달
   └→ ReadyForQuery를 받아 루프 종료
   └→ 커넥션을 풀에 정상 반환
```

클라이언트는 PostgreSQL 표준 에러 코드 `57014`를 받으므로 pgx, JDBC 등 모든 드라이버가 적절한 예외를 던진다. `statement_timeout`으로 인한 취소와 동일한 에러 코드다.

---

## 쿼리별 힌트: `/* timeout:5s */`

기존 라우팅 힌트(`/* route:writer */`)와 동일한 패턴으로 타임아웃 힌트를 구현했다:

```sql
/* timeout:5s */ SELECT * FROM heavy_report;
/* timeout:500ms */ SELECT id FROM users WHERE id = 1;
/* timeout:2m */ SELECT * FROM analytics_daily;
```

파서 구현:

```go
var timeoutHintRegex = regexp.MustCompile(
    `/\*\s*timeout:(\d+(?:\.\d+)?(?:s|ms|m))\s*\*/`)

func ExtractTimeoutHint(query string) time.Duration {
    sanitized := stripStringLiterals(query)
    matches := timeoutHintRegex.FindStringSubmatch(sanitized)
    if len(matches) >= 2 {
        d, err := time.ParseDuration(matches[1])
        if err == nil && d > 0 {
            return d
        }
    }
    return 0
}
```

`stripStringLiterals`를 먼저 호출하여 **문자열 리터럴 안의 가짜 힌트를 무시**한다:

```sql
-- 이것은 무시된다 (리터럴 안):
SELECT '/* timeout:5s */' FROM t;

-- 이것은 적용된다 (진짜 힌트):
/* timeout:5s */ SELECT '/* timeout:5s */' FROM t;
```

우선순위는 **힌트 > 전역 설정**:

```go
func (s *Server) resolveQueryTimeout(query string, cfg *config.Config) time.Duration {
    if hint := router.ExtractTimeoutHint(query); hint > 0 {
        return hint
    }
    return cfg.Pool.QueryTimeout
}
```

---

## Prometheus 메트릭

```go
QueryTimeouts: prometheus.NewCounterVec(
    prometheus.CounterOpts{
        Name: "pgmux_query_timeout_total",
        Help: "Total number of queries canceled due to query timeout.",
    },
    []string{"target"},
)
```

writer/reader별로 분리되므로 Grafana에서:

```promql
# 최근 5분간 타임아웃 비율
rate(pgmux_query_timeout_total[5m])

# writer vs reader 비교
rate(pgmux_query_timeout_total{target="writer"}[5m])
rate(pgmux_query_timeout_total{target="reader"}[5m])
```

타임아웃이 급증하면 슬로우 쿼리 문제나 백엔드 성능 저하를 의심할 수 있다.

---

## 테스트

5개 테스트 함수로 각 레이어를 검증했다:

| 테스트 | 검증 항목 |
|--------|-----------|
| `TestExtractTimeoutHint` | 기본 힌트, 문자열 리터럴 내부 무시, 라우팅 힌트와 결합, 무효 duration — 13 케이스 |
| `TestResolveQueryTimeout` | 전역 설정, 힌트 오버라이드, 미설정(0), 힌트+미설정 조합 |
| `TestStartQueryTimer_Disabled` | timeout=0일 때 nil 반환 (타이머 미생성) |
| `TestStartQueryTimer_FiresCancel` | 50ms 타이머 → 모의 백엔드에 CancelRequest 수신 확인 |
| `TestStartQueryTimer_StoppedBeforeFiring` | 쿼리 완료 후 stop() → 400ms 대기 → CancelRequest 미수신 |

`FiresCancel` 테스트의 핵심:

```go
func TestStartQueryTimer_FiresCancel(t *testing.T) {
    // 모의 백엔드: CancelRequest를 수신하는 TCP 서버
    ln, _ := net.Listen("tcp", "127.0.0.1:0")
    var received atomic.Bool
    go func() {
        conn, _ := ln.Accept()
        var buf [16]byte
        conn.Read(buf[:])
        code := binary.BigEndian.Uint32(buf[4:8])
        if code == protocol.CancelRequestCode {
            received.Store(true)
        }
    }()

    ct := &cancelTarget{proxyPID: 1, proxySecret: 100}
    ct.setFromConn(ln.Addr().String(), &pool.Conn{
        BackendPID: 42, BackendSecret: 99,
    })

    stop := s.startQueryTimer(50*time.Millisecond, ct, "writer")
    time.Sleep(200 * time.Millisecond)

    if !received.Load() {
        t.Error("cancel request not received")
    }
}
```

---

## PgBouncer 비교

| 항목 | PgBouncer | pgmux |
|------|-----------|-------|
| 설정 | `query_timeout` (초 단위) | `pool.query_timeout` (duration) |
| 쿼리별 오버라이드 | 없음 | `/* timeout:5s */` 힌트 |
| 취소 방법 | 커넥션 닫기 | CancelRequest 프로토콜 |
| 커넥션 재사용 | 불가 (닫힘) | 가능 (ReadyForQuery 후 풀 반환) |
| 에러 코드 | 자체 에러 | PG 표준 57014 |
| 메트릭 | 로그만 | Prometheus counter |

가장 큰 차이는 **커넥션 재사용**이다. PgBouncer는 타임아웃 시 커넥션을 닫아버리므로 새로운 커넥션을 생성해야 한다. pgmux는 CancelRequest로 쿼리만 취소하고 커넥션은 살려두므로 풀에 반환하여 재사용할 수 있다.

---

## 마무리

이번 구현의 포인트:

1. **CancelRequest 재사용** — 이미 클라이언트 cancel을 위해 구현해둔 `forwardCancel()`과 `cancelTarget`을 그대로 활용. 새로운 프로토콜 코드 없이 완성
2. **relay 로직 무수정** — PostgreSQL이 ErrorResponse + ReadyForQuery를 보내므로 기존 `relayUntilReady()`가 자연스럽게 처리
3. **cancelTarget의 race 방어** — `clear()` 후 타이머 콜백이 실행되면 빈 값으로 스킵. 별도 동기화 없이 안전
4. **힌트 주석으로 쿼리별 제어** — 전역 설정 + 쿼리 레벨 오버라이드의 2단계 우선순위

프록시에서 쿼리 타임아웃을 관리하면 "한 쿼리가 커넥션을 영원히 점유하는" 상황을 방지할 수 있다. `statement_timeout`과 달리 백엔드 설정을 건드리지 않으므로, 프록시를 통해 접속하는 모든 클라이언트에 일관되게 적용된다.

다음 글에서는 남은 프로덕션 안전장치(Idle Client Timeout) 또는 멀티테넌시(Per-User Rate Limiting)를 다룰 예정이다.
