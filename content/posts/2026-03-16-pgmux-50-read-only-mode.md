---
title: "Go로 PostgreSQL 프록시 만들기 (50) - Read-Only Mode"
date: 2026-03-16
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Read-Only", "Admin API", "Operational Safety"]
categories: ["Database"]
project: "pgmux"
description: "Admin API를 통해 런타임 read-only 모드를 활성화하여 모든 쓰기 쿼리를 프록시 레벨에서 즉시 거부하고, 읽기 서비스는 유지하는 기능을 구현한다."
---

## 들어가며

[이전 글](/posts/2026-03-16-pgmux-49-online-maintenance-mode/)에서 Online Maintenance Mode를 구현했다. 유지보수 모드는 **모든 트래픽을 차단**한다. 하지만 실제 운영에서는 쓰기만 막고 읽기는 유지하고 싶은 경우가 더 많다:

- Writer 장애 시 읽기 서비스라도 유지
- 긴급 데이터 보호 — 잘못된 배포가 데이터를 망가뜨리기 전에 쓰기 차단
- 스키마 마이그레이션 전 안전 장치 — DDL 실행 전 애플리케이션 쓰기를 일시 정지

Maintenance Mode가 "가게 문 닫기"라면, Read-Only Mode는 "주문은 받지만 조리는 중단"이다.

---

## 설계

### Maintenance Mode와의 차이

| 구분 | Maintenance Mode | Read-Only Mode |
|------|------------------|----------------|
| 차단 대상 | 모든 쿼리 + 신규 연결 | 쓰기 쿼리만 |
| 허용 | 진행 중 트랜잭션 | 읽기 쿼리 전체 |
| 연결 유지 | 거부 후 FATAL (연결 종료) | 에러 반환 (연결 유지) |
| 에러 코드 | `57P01` admin_shutdown | 일반 ERROR |
| 용도 | 배포, 패치, 재시작 | 장애 대응, 데이터 보호 |

핵심 차이는 **연결을 끊지 않는다**는 것이다. Maintenance에서는 `FATAL`로 연결을 강제 종료하지만, Read-Only에서는 `ERROR`로 쓰기만 거부하고 같은 연결에서 SELECT는 계속 수행할 수 있다.

### 상태 관리: atomic 패턴 재사용

Maintenance Mode와 동일한 패턴이다. hot path에서 매 쿼리마다 체크하므로 lock-free여야 한다:

```go
type Server struct {
    // ...
    readOnlyMode atomic.Bool
    readOnlyAt   atomic.Int64  // unix timestamp
}
```

`InReadOnly()`는 `atomic.Bool.Load()` 한 번이다. 캐시라인 하나, ns 단위.

### 쓰기 판별: 기존 QueryType 재활용

쿼리가 쓰기인지 판별하는 로직은 이미 라우터에 있다:

```go
var writeKeywords = map[string]bool{
    "INSERT": true, "UPDATE": true, "DELETE": true,
    "CREATE": true, "ALTER":  true, "DROP":   true,
    "TRUNCATE": true, "GRANT": true, "REVOKE": true,
}
```

`BEGIN`, `COMMIT`, `ROLLBACK`은 이 목록에 없다. 따라서 `QueryWrite`로 분류된 쿼리만 차단하면 트랜잭션 제어는 자연스럽게 통과한다. 새로운 파서나 분류 로직을 추가할 필요가 없다.

---

## 구현

### Simple Query Protocol

메인 쿼리 루프(`relayQueries`)에서 라우팅과 분류가 끝난 직후에 체크한다:

```go
// 라우팅 완료, qtype 분류 완료
if s.InReadOnly() && qtype == router.QueryWrite {
    if s.metrics != nil {
        s.metrics.ReadOnlyRejected.Inc()
    }
    s.sendError(clientConn,
        "cannot execute write query: pgmux is in read-only mode")
    _ = protocol.WriteMessage(clientConn,
        protocol.MsgReadyForQuery, []byte{'I'})
    continue
}
```

`sendError` + `ReadyForQuery`가 핵심이다:

- `sendError`: ErrorResponse 메시지를 보내지만 **연결은 유지**
- `ReadyForQuery('I')`: "나 idle 상태야, 다음 쿼리 보내" 시그널

이것이 Maintenance Mode의 `sendFatalWithCode`와 다른 점이다. FATAL은 클라이언트에게 "연결 종료" 시그널이지만, ERROR + ReadyForQuery는 "이 쿼리는 실패했지만 다음 쿼리 보내도 돼" 시그널이다.

### Extended Query Protocol

Extended Query는 Parse → Bind → Execute → Sync 단계로 구성된다. 쓰기 여부는 Parse 시점에 알 수 있으므로 거기서 플래그를 세운다:

```go
// MsgParse 핸들러
if s.classifyQuery(query) == router.QueryWrite {
    extIsWrite = true
}
```

실제 차단은 Sync 시점에 수행한다. Parse에서 바로 거부하면 클라이언트의 프로토콜 상태가 꼬인다:

```go
// MsgSync 핸들러 — 스팬 시작 직후
if s.InReadOnly() && extIsWrite {
    s.metrics.ReadOnlyRejected.Inc()
    s.sendError(clientConn,
        "cannot execute write query: pgmux is in read-only mode")
    s.sendReadyForQuery(clientConn, session.InTransaction())
    // 배치 상태 리셋
    extBuf = extBuf[:0]
    extIsWrite = false
    continue
}
```

`sendReadyForQuery`의 인자가 `session.InTransaction()`인 이유: 트랜잭션 내에서 쓰기를 시도하면 거부하지만, 트랜잭션 자체는 유지된다. 클라이언트가 `ROLLBACK`을 보내서 정리할 수 있어야 한다.

---

## Admin API

Maintenance Mode와 동일한 3-method 패턴이다:

| 메서드 | 역할 | 응답 |
|--------|------|------|
| `GET /admin/readonly` | viewer | `{"readonly": false}` 또는 `{"readonly": true, "since": "..."}` |
| `POST /admin/readonly` | admin | `{"status": "readonly enabled"}` |
| `DELETE /admin/readonly` | admin | `{"status": "readonly disabled"}` |

```bash
# 긴급 쓰기 차단
curl -X POST -H "Authorization: Bearer $KEY" \
  http://pgmux:9091/admin/readonly

# 상태 확인
curl -H "Authorization: Bearer $KEY" \
  http://pgmux:9091/admin/readonly
# → {"readonly":true,"since":"2026-03-16T14:30:00+09:00"}

# 쓰기 재개
curl -X DELETE -H "Authorization: Bearer $KEY" \
  http://pgmux:9091/admin/readonly
```

함수 전달 패턴도 Maintenance Mode와 동일하다:

```go
// main.go
adminSrv.SetReadOnlyFns(srv.ReadOnlyState, srv.SetReadOnly)
```

---

## 메트릭

```
pgmux_readonly_mode             # Gauge: 0 또는 1
pgmux_readonly_rejected_total   # Counter: 거부된 쓰기 쿼리 수
```

`readonly_rejected_total`이 급증하면 애플리케이션이 아직 쓰기를 시도하고 있다는 의미다. Grafana 알림으로 연결하면 read-only 전환 후 잔여 쓰기 트래픽을 모니터링할 수 있다.

---

## Maintenance Mode와의 조합

두 모드는 독립적으로 동작한다. 조합 시 동작:

| Maintenance | Read-Only | 결과 |
|:-----------:|:---------:|------|
| OFF | OFF | 정상 |
| OFF | ON | 읽기만 허용 |
| ON | OFF | 모든 트래픽 차단 |
| ON | ON | 모든 트래픽 차단 (maintenance가 먼저 체크) |

Maintenance Mode는 쿼리 루프 진입 전에 체크하고, Read-Only는 라우팅/분류 후에 체크한다. 따라서 maintenance가 활성화되어 있으면 read-only 체크까지 도달하지 않는다.

---

## PgBouncer와 비교

PgBouncer에는 read-only mode가 없다. 유사한 동작을 구현하려면:

```sql
-- PostgreSQL 서버 레벨
ALTER SYSTEM SET default_transaction_read_only = on;
SELECT pg_reload_conf();
```

이 방법의 문제:
1. **PostgreSQL 서버에 직접 접근**해야 한다
2. 이미 열린 세션에는 적용되지 않는다
3. Replica에도 영향을 줄 수 있다 (WAL 복제)
4. 롤백하려면 다시 서버에 접속해야 한다

pgmux의 read-only mode는 **프록시 레벨**에서 동작하므로:
- DB 서버 접근 없이 HTTP API로 제어
- 즉시 모든 연결에 적용
- Reader에 영향 없음
- curl 한 줄로 활성화/비활성화

---

## 마무리

Read-Only Mode는 Maintenance Mode의 자연스러운 확장이다:

- **같은 atomic 패턴**: lock-free, hot path 성능 영향 없음
- **기존 쿼리 분류 재활용**: `QueryWrite`만 체크, 새 파서 불필요
- **연결 유지**: ERROR + ReadyForQuery로 클라이언트가 읽기를 계속할 수 있음
- **Simple + Extended**: 양쪽 프로토콜 모두 커버

Phase 30의 모든 항목(Health Check, Maintenance Mode, Read-Only Mode)이 완료되었다. 다음은 Phase 31의 **Session Compatibility Guard**를 진행할 예정이다. Transaction pooling에서 세션 의존 기능(LISTEN, SET, temp table 등)을 감지하고 안전하게 처리하는 기능이다.
