---
title: "Go로 PostgreSQL 프록시 만들기 (60) - Extended Query 커넥션 바인딩과 E2E 전수 검증"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Testing", "Extended Query Protocol"]
categories: ["Database"]
project: "pgmux"
description: "lib/pq의 2-round Extended Query Protocol에서 transaction-level pooling이 커넥션을 릴리즈하는 버그를 수정하고, E2E 테스트를 14개에서 22개로 확장하여 전수 검증한다."
---

## 들어가며

pgmux의 Extended Query Protocol 지원은 이전 포스트에서 구현했다. 단일 클라이언트에서는 잘 동작했지만, **ConcurrentWriters** 테스트를 돌리자 19/20이 실패했다. 50개 goroutine이 동시에 parameterized INSERT를 날리면 `prepared statement does not exist` 에러가 쏟아진다.

원인은 lib/pq의 **2-round Extended Query Protocol**과 pgmux의 transaction-level pooling 사이의 충돌이었다.

---

## 문제: 2-round Extended Query Protocol

PostgreSQL의 Extended Query Protocol은 원래 한 번에 `Parse -> Bind -> Execute -> Sync`를 보내는 것이 일반적이다. 그런데 Go의 `lib/pq` 드라이버는 이를 **두 라운드**로 나눈다.

```
Round 1: Parse + Describe + Sync   --> ReadyForQuery
Round 2: Bind + Execute  + Sync   --> ReadyForQuery
```

Round 1에서 prepared statement를 생성하고, Round 2에서 파라미터를 바인딩해서 실행한다. 문제는 pgmux가 **transaction-level pooling**을 사용한다는 것이다.

```
Round 1: Parse+Describe+Sync → Reader A에서 실행 → ReadyForQuery → 커넥션 릴리즈
Round 2: Bind+Execute+Sync   → Reader B에 할당됨  → "prepared statement does not exist"
```

Round 1에서 ReadyForQuery를 받으면 pgmux는 커넥션을 풀에 반환한다. Round 2가 오면 풀에서 **다른 커넥션**을 할당받는다. 이 커넥션에는 Round 1에서 만든 prepared statement가 없다.

단일 클라이언트에서는 풀에 커넥션이 하나뿐이라 같은 커넥션을 다시 받아서 동작했지만, 동시성이 올라가면 확률적으로 다른 커넥션을 받게 된다.

---

## 해결: extHasExecute 플래그와 커넥션 바인딩

핵심 아이디어: **Execute 메시지가 없는 배치는 커넥션을 릴리즈하지 않는다.**

```go
var extHasExecute bool // true if the current batch contains an Execute message

case protocol.MsgExecute:
    extHasExecute = true
    extBuf = append(extBuf, protocol.CopyMessage(msg))
```

Sync 메시지가 도착하면 `extHasExecute`를 확인한다. Execute가 없으면 Parse-only 배치이므로, 커넥션을 풀에 반환하지 않고 `boundReader`/`boundWriter`에 바인딩해둔다.

```go
// relayQueries 시작 부분의 상태 변수
var boundReader *pool.Conn
var boundReaderPool *pool.Pool
var boundReaderAddr string
```

### 3가지 라우팅 경로

Sync 처리 시점에서 reader 경로는 세 가지로 분기한다.

**1. Bound reader 재사용** -- Round 2에서 Round 1의 커넥션을 재사용:

```go
if boundReader != nil {
    // Reuse reader bound from a previous Parse-only batch
    ct.setFromConn(boundReaderAddr, boundReader)
    if err := s.forwardExtBatch(boundReader, extBuf, msg); err != nil {
        boundReaderPool.Discard(boundReader)
        boundReader, boundReaderPool, boundReaderAddr = nil, nil, ""
        return
    }
    // ...
    // Release bound reader after Execute completes
    if extHasExecute {
        boundReaderPool.Release(boundReader)
        boundReader, boundReaderPool, boundReaderAddr = nil, nil, ""
    }
}
```

Execute가 포함된 배치가 완료되면 그때서야 커넥션을 릴리즈한다.

**2. Parse-only 바인딩** -- Round 1에서 커넥션을 바인딩:

```go
} else if !extHasExecute && len(extBuf) > 0 {
    // Parse-only batch: acquire reader and keep connection bound
    readerAddr := dbg.balancer.Next()
    rConn, rPool, usedAddr, err := s.acquireReaderForBind(ctx, readerAddr, dbg)
    // ... forward and relay ...
    // Keep reader bound for next batch
    boundReader = rConn
    boundReaderPool = rPool
    boundReaderAddr = usedAddr
}
```

**3. 일반 경로** -- Execute가 포함된 단일 배치(Parse+Bind+Execute+Sync):

```go
} else {
    // Normal reader path with Execute
    readerAddr := dbg.balancer.Next()
    // ... acquire, forward, relay, release ...
}
```

Writer 경로도 동일한 패턴으로 `boundWriter`를 사용한다. Parse-only 배치에서 `acquired && !extHasExecute`이면 커넥션을 바인딩하고, `!acquired && extHasExecute`이면 바인딩된 커넥션으로 Execute를 실행한 뒤 릴리즈한다.

### acquireReaderForBind 헬퍼

Parse-only 배치에서 reader를 획득하는 전용 헬퍼다. Circuit breaker 체크와 writer fallback을 포함한다.

```go
func (s *Server) acquireReaderForBind(ctx context.Context, readerAddr string, dbg *DatabaseGroup) (*pool.Conn, *pool.Pool, string, error) {
    if readerAddr != "" {
        if cb, ok := dbg.ReaderCB(readerAddr); ok {
            if cb.Allow() != nil {
                readerAddr = "" // circuit breaker open
            }
        }
    }
    if readerAddr != "" {
        if rPool, ok := dbg.ReaderPool(readerAddr); ok {
            if rConn, err := rPool.Acquire(ctx); err == nil {
                return rConn, rPool, readerAddr, nil
            }
            // ... mark unhealthy ...
        }
    }
    // Fallback to writer
    wPool := dbg.writerPool
    wConn, err := wPool.Acquire(ctx)
    if err != nil {
        return nil, nil, "", fmt.Errorf("acquire reader (with writer fallback): %w", err)
    }
    return wConn, wPool, dbg.writerAddr, nil
}
```

이 수정 후 ConcurrentWriters 50/50 성공, ConcurrentParameterizedSELECT 50/50 성공.

---

## E2E 테스트 전수 검증

버그 수정 후 기존 E2E 테스트를 전수 점검했다. pgmux에 구현된 기능 대비 테스트 커버리지가 부족했다. Auth, Firewall, Connection Limits, Data API, Rate Limit, Session Compatibility, SQL Redaction -- 모두 구현은 되어 있지만 E2E 테스트가 없었다.

### config.test.yaml 확장

기존 config.test.yaml에 테스트에 필요한 설정을 추가했다:

```yaml
# --- 신규 기능 활성화 ---
auth:
  enabled: true
  users:
    - username: "postgres"
      password: "postgres"
      max_connections: 0
    - username: "limited"
      password: "limited"
      max_connections: 3

firewall:
  enabled: true
  block_delete_without_where: true
  block_update_without_where: true

connection_limits:
  enabled: true
  default_max_connections_per_user: 50
  default_max_connections_per_database: 50

session_compatibility:
  enabled: true
  mode: "warn"

data_api:
  enabled: true
  listen: "0.0.0.0:18080"
  api_keys:
    - "test-api-key-12345"

rate_limit:
  enabled: true
  rate: 10000
  burst: 5000

audit:
  enabled: true
  slow_query_threshold: 100ms

observability:
  sql_redaction: "literals"
```

### 14개 -> 22개 테스트

기존 14개 테스트에 8개를 추가했다.

| # | 테스트 | 검증 대상 |
|---|--------|----------|
| 15 | `TestE2E_Auth` | 유효 사용자, 제한 사용자, 미등록 사용자, 잘못된 비밀번호 |
| 16 | `TestE2E_FirewallRules` | DELETE/UPDATE without WHERE 차단, WITH WHERE 허용, 메트릭 |
| 17 | `TestE2E_ConnectionLimits` | limited 사용자(max_connections=3)의 4번째 연결 거부 |
| 18 | `TestE2E_DataAPI` | SELECT, INSERT, 인증 없음(401), 잘못된 키(401), Firewall 연동(403), COPY 거부(400) |
| 19 | `TestE2E_RateLimitMetric` | rate_limited 메트릭 존재, 높은 limit 하에서 요청 정상 처리 |
| 20 | `TestE2E_SessionCompatibility` | SET 실행(warn 모드), session_dependency_detected 메트릭 |
| 21 | `TestE2E_SQLRedaction` | 리터럴 포함 쿼리 정상 동작, AST 파서 활성화, 메트릭 수집 |
| 22 | `TestE2E_AdminConnectionLimitStats` | /admin/connections 엔드포인트의 사용자별/DB별 통계 |

각 테스트는 실제 PostgreSQL 백엔드(docker-compose)와 pgmux 프록시에 대해 실행된다. 프록시가 실행되지 않으면 `t.Skip`으로 건너뛴다.

### Data API 테스트가 가장 두꺼운 이유

`TestE2E_DataAPI`는 서브테스트 6개로 구성된다. Data API는 HTTP 엔드포인트이므로 pgmux의 여러 레이어를 관통한다:

- **인증**: API key 검증 (Bearer token)
- **라우팅**: SELECT는 reader, INSERT/CREATE는 writer
- **방화벽**: DELETE without WHERE가 Data API 경유로도 차단되는지
- **프로토콜**: COPY 문이 Data API에서 거부되는지 (Data API는 Simple Query만 지원)

### 테스트할 수 없는 것들

모든 기능을 E2E로 검증할 수 있는 것은 아니다.

| 기능 | 이유 |
|------|------|
| Mirror (트래픽 미러링) | 별도 PostgreSQL 인스턴스 필요 |
| TLS | 인증서 설정 필요, CI에서 비실용적 |
| Redis PubSub (캐시 무효화) | Redis 인스턴스 필요 |
| OpenTelemetry span | OTLP 수집기 필요 |
| Slack webhook | 외부 서비스 의존 |
| Circuit breaker 동작 | 의도적 장애 주입 필요 |
| Hot-reload | 파일 변경 + 시그널 필요 |

이들은 unit test와 integration test로 커버한다. E2E는 "사용자 관점에서 기능이 동작하는가"에 집중한다.

---

## 마무리

Extended Query Protocol의 2-round 패턴은 PostgreSQL wire protocol 스펙에는 없는, 드라이버 구현의 선택이다. `lib/pq`는 Parse+Describe로 statement의 메타데이터를 먼저 받아온 뒤 Bind+Execute를 보내는데, transaction-level pooling 프록시에서 이 두 라운드 사이에 커넥션이 바뀌면 prepared statement가 사라진다.

`extHasExecute` 플래그 하나로 "아직 Execute가 오지 않은 배치"를 식별하고, 해당 커넥션을 바인딩해두는 것으로 해결했다. E2E 테스트 22개는 pgmux의 현재 기능을 실용적인 범위에서 전수 검증한다.
