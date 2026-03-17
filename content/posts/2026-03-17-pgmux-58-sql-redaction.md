---
title: "Go로 PostgreSQL 프록시 만들기 (58) - SQL Redaction과 Safe Observability"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Security", "Observability"]
categories: ["Database"]
project: "pgmux"
description: "Audit log, OpenTelemetry span, slog, webhook 등 모든 외부 노출 경로에서 SQL 리터럴을 자동 마스킹하는 SQL Redaction 모듈을 구현한다."
---

## 들어가며

릴리즈 직전, `tasks-next.md`의 Must Have 항목을 점검했다. Admin API Auth, Health Check, Maintenance Mode, Read-Only Mode, Session Compatibility Guard — 전부 완료. 하나만 남았다.

**SQL Redaction / Safe Observability.**

pgmux는 관측성 표면이 넓다. Audit log, OpenTelemetry span, slog, Slack webhook, Admin API(`/admin/queries/top`). 이 모든 곳에 raw SQL이 그대로 흘러간다.

```
slog.Warn("firewall blocked query", "sql", query)
attribute.String("db.statement", truncateSQL(query))
{"title": "Query", "value": truncateQuery(e.Query, 500)}
```

`SELECT * FROM users WHERE ssn = '123-45-6789'`이 audit log에 찍히고, Slack webhook으로 날아가고, Jaeger trace에 기록된다. 프로덕션 환경에서 이건 compliance 이슈다.

---

## 문제: SQL이 노출되는 모든 경로

코드를 전수 조사해서 raw SQL이 외부로 나가는 지점을 정리했다.

| 경로 | 파일 | 노출 방식 |
|------|------|----------|
| **Audit log** | `audit/audit.go` | `slog.Warn("slow query", "query", ...)`, `slog.Info("audit query", "query", ...)` |
| **Webhook** | `audit/audit.go` | Slack attachment에 `truncateQuery(e.Query, 500)` |
| **OpenTelemetry span** | `proxy/query.go` | `attribute.String("db.statement", truncateSQL(query))` |
| **slog Debug/Warn** | `proxy/query.go` 외 5곳 | `"sql", query`, `"sql", truncateSQL(query)` |
| **Data API span** | `dataapi/handler.go` | `attribute.String("db.statement", truncateSQL(req.SQL))` |
| **Data API error log** | `dataapi/handler.go` | `slog.Error("data api query error", "sql", req.SQL)` |

총 **15개 지점**. 단순히 `truncateSQL()`로 잘라도 리터럴은 그대로 남는다.

---

## 설계: 세 가지 정책

Redaction은 한 가지가 아니라 **운영 상황에 따라 선택할 수 있어야** 한다.

| 정책 | 동작 | 용도 |
|------|------|------|
| `none` | 원본 SQL 그대로 | 개발/디버깅 |
| `literals` | 리터럴을 `$1`, `$2`로 치환 | **프로덕션 기본값** |
| `full` | 쿼리 fingerprint 해시만 노출 | 최대 프라이버시 |

핵심 원칙: **redaction은 외부 노출 경계에서만 적용한다.** 내부 라우팅, 캐싱, 방화벽은 원본 SQL을 그대로 사용한다. 성능에 영향을 주지 않으면서 안전성을 확보하는 방법이다.

```
                   ┌────────────────┐
  raw SQL ────────►│  routing/cache  │  (원본 사용)
                   │  firewall/pool  │
                   └───────┬────────┘
                           │
                    redact.SQL(query, policy)
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
         audit log    OTel span      slog/webhook
```

---

## 구현: `internal/redact` 패키지

```go
package redact

type Policy string

const (
    PolicyNone     Policy = "none"
    PolicyLiterals Policy = "literals"
    PolicyFull     Policy = "full"
)

func SQL(query string, policy Policy) string {
    switch policy {
    case PolicyNone:
        return query
    case PolicyFull:
        fp, err := pg_query.Fingerprint(query)
        if err != nil {
            return "[unparseable query]"
        }
        return "[fingerprint:" + fp + "]"
    default: // PolicyLiterals
        normalized, err := pg_query.Normalize(query)
        if err != nil {
            return regexFallback.ReplaceAllString(query, "?")
        }
        return normalized
    }
}
```

세 가지 선택이 있었다:

### 1. `pg_query.Normalize` — literals 모드의 핵심

`pg_query_go`의 `Normalize()` 함수는 PostgreSQL C 파서를 사용해서 **모든 리터럴을 정확하게 `$1`, `$2`로 치환**한다. 이미 `digest.go`와 `mirror.go`에서 사용 중이라 새 의존성이 없다.

```
입력: SELECT * FROM users WHERE name = 'alice' AND age > 30
출력: SELECT * FROM users WHERE name = $1 AND age > $2
```

달러 쿼팅(`$$body$$`), 중첩 문자열, 타입 캐스트 — 모든 엣지 케이스를 PostgreSQL 파서가 처리한다.

### 2. `pg_query.Fingerprint` — full 모드

테이블명, 컬럼명까지 숨기고 싶은 경우. 쿼리의 **구조적 해시**만 노출한다.

```
입력: SELECT * FROM users WHERE id = 1
출력: [fingerprint:abc123def456]
```

같은 구조의 쿼리는 리터럴 값과 무관하게 동일한 fingerprint를 가진다.

### 3. Regex fallback

`pg_query.Normalize`가 실패하는 경우(비정상 SQL, 프로토콜 에러 등)를 위한 안전장치:

```go
var regexFallback = regexp.MustCompile(`'[^']*'|"[^"]*"|\b\d+(\.\d+)?\b`)
```

100% 정확하지는 않지만, 파서가 실패해도 **리터럴이 그대로 노출되는 것보다 낫다**.

---

## 통합: 15개 지점에 일관 적용

proxy 패키지에 헬퍼 메서드를 추가했다:

```go
func (s *Server) redactPolicy() redact.Policy {
    return redact.Policy(s.getConfig().Observability.SQLRedaction)
}

func (s *Server) redactSQLForLog(query string) string {
    return redact.ForLog(query, s.redactPolicy())
}

func (s *Server) redactSQLForSpan(query string) string {
    return redact.SQLTruncated(query, s.redactPolicy(), 100)
}
```

`s.getConfig()`는 `atomic.Pointer`로 관리되므로 **hot-reload 시 정책이 즉시 반영**된다.

### Audit log — 발신 시점에서 redact

redaction을 audit 모듈이 아닌 **이벤트 발신자(`emitAuditEvent`)**에서 적용했다:

```go
// proxy/helpers.go
func (s *Server) emitAuditEvent(clientConn net.Conn, query, target string, ...) {
    s.auditLogger.Log(audit.Event{
        Query: s.redactSQL(query),  // ← 여기서 redact
        ...
    })
}
```

이유: audit 모듈은 config에 접근하지 않는 독립 컴포넌트다. redaction 정책은 proxy 레벨의 관심사이므로, 경계 지점에서 적용하는 게 맞다.

부수 효과: webhook dedup key가 redacted SQL 기반이 되면서, `WHERE id = 1`과 `WHERE id = 2`가 **같은 쿼리로 dedup**된다. 오히려 개선이다.

### OpenTelemetry span

```go
// Before
attribute.String("db.statement", truncateSQL(query))

// After
attribute.String("db.statement", s.redactSQLForSpan(query))
```

### slog

```go
// Before
slog.Warn("firewall blocked query", "sql", query)
slog.Debug("cache hit", "sql", query)

// After
slog.Warn("firewall blocked query", "sql", s.redactSQLForLog(query))
slog.Debug("cache hit", "sql", s.redactSQLForLog(query))
```

---

## 설정

```yaml
observability:
  sql_redaction: "literals"   # "none" | "literals" | "full"
```

기본값은 `literals`. **설정하지 않아도 안전하다.**

validation에서 허용값 외의 문자열은 거부한다:

```go
switch c.Observability.SQLRedaction {
case "none", "literals", "full":
    // valid
default:
    return fmt.Errorf("observability.sql_redaction must be ...")
}
```

---

## 이미 안전한 곳: Digest와 Mirror

`/admin/queries/top`과 `/admin/mirror/stats`는 이미 내부적으로 `pg_query.Normalize()`를 사용해서 정규화된 패턴만 노출한다. 추가 작업이 필요 없다.

```go
// digest/digest.go — 이미 normalized
pattern, err := pg_query.Normalize(query)

// mirror/mirror.go — 이미 normalized
pattern, err := pg_query.Normalize(j.query)
```

---

## 결과

### 적용 전

```json
{
  "event": "slow_query",
  "query": "SELECT * FROM users WHERE ssn = '123-45-6789' AND balance > 10000"
}
```

### `literals` 모드 적용 후

```json
{
  "event": "slow_query",
  "query": "SELECT * FROM users WHERE ssn = $1 AND balance > $2"
}
```

### `full` 모드 적용 후

```json
{
  "event": "slow_query",
  "query": "[fingerprint:a1b2c3d4e5f6]"
}
```

---

## 마무리

SQL Redaction은 코드 15곳을 수정하지만 핵심은 단순하다: **외부로 나가는 모든 SQL에 `redact.SQL()`을 씌운다.** 60줄짜리 패키지 하나로 compliance 이슈를 해결했다.

이것으로 `tasks-next.md`의 Must Have 항목이 전부 완료되었다. 릴리즈 블로커가 없다.
