---
title: "Go로 PostgreSQL 프록시 만들기 (16) - Audit Logging, Helm Chart, Serverless Data API"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Audit", "Helm", "Kubernetes", "REST API", "Wire Protocol"]
categories: ["Database"]
project: "pgmux"
description: "비동기 감사 로그와 Slow Query Webhook, K8s Helm Chart, HTTP REST → PG Wire Protocol 변환 Data API를 구현한다."
---

## 들어가며

지난 글에서 보안 QA를 통해 발견된 취약점들을 수정했다. 이번에는 프로덕션 운영에 필요한 세 가지 기능을 추가한다.

1. **Audit Logging & Slow Query Tracker** — 느린 쿼리를 감지하고 Slack으로 알림을 보내는 감사 로그
2. **Helm Chart** — Kubernetes에 원커맨드로 배포할 수 있는 Helm Chart
3. **Serverless Data API** — HTTP POST로 SQL을 보내면 JSON으로 응답하는 REST API

세 기능 모두 기존 아키텍처 위에 자연스럽게 얹히는 형태여서, 핵심 프록시 코드를 거의 건드리지 않고 구현할 수 있었다.

---

## 1. Audit Logging & Slow Query Tracker

### 문제: 느린 쿼리를 어떻게 발견할 것인가

Prometheus의 `pgmux_query_duration_seconds` 히스토그램으로 전체적인 레이턴시 분포는 볼 수 있지만, **어떤 쿼리가 느렸는지**는 알 수 없다. 프로덕션에서 갑자기 응답이 느려졌을 때, 대시보드에서 p99가 올라간 걸 확인하고 나서야 로그를 뒤지는 건 너무 늦다.

필요한 것:
- 임계값(예: 500ms)을 초과한 쿼리를 자동으로 구조화 로그로 기록
- Slack 등으로 실시간 알림
- 쿼리 처리 경로를 블로킹하지 않는 비동기 처리

### 비동기 채널 패턴

가장 중요한 설계 결정은 **감사 로그가 쿼리 레이턴시에 영향을 주면 안 된다**는 것이었다. 프록시의 존재 이유가 레이턴시 최소화인데, 로깅 때문에 느려지면 본말이 전도된다.

```go
type Logger struct {
    cfg     Config
    eventCh chan Event  // 버퍼 1024
}

func (l *Logger) Log(e Event) {
    select {
    case l.eventCh <- e:  // 논블로킹 전송
    default:              // 채널 가득 차면 드롭 (쿼리 경로 보호)
    }
}
```

`Log()`는 절대 블로킹하지 않는다. 채널이 가득 차면 이벤트를 드롭한다. "감사 로그 한 건을 놓치는 것"보다 "쿼리 레이턴시가 올라가는 것"이 훨씬 더 나쁘기 때문이다.

전용 goroutine이 채널에서 이벤트를 소비하며 처리한다:

```go
func (l *Logger) run() {
    for e := range l.eventCh {
        isSlow := e.Duration >= l.cfg.SlowQueryThreshold

        if isSlow {
            slog.Warn("slow query detected",
                "query", truncateQuery(e.Query, 200),
                "duration_ms", e.Duration.Milliseconds(),
                "target", e.Target,
            )
        }

        if isSlow && l.cfg.Webhook.Enabled {
            l.sendWebhook(e)
        }
    }
}
```

### Webhook 중복 알림 방지

같은 쿼리가 반복적으로 느릴 때 Slack 채널이 알림 폭탄을 맞으면 안 된다. 쿼리 앞 50자를 키로 사용하여 같은 패턴에 대해 최소 1분 간격을 보장했다.

```go
func (l *Logger) shouldSendWebhook(query string) bool {
    key := truncateQuery(query, 50)
    if last, ok := l.lastWebhook[key]; ok {
        if time.Since(last) < l.webhookInterval {
            return false
        }
    }
    l.lastWebhook[key] = time.Now()
    return true
}
```

다만 **서로 다른** 쿼리 패턴은 각각 알림을 보낸다. `SELECT * FROM users`가 느린 것과 `SELECT * FROM orders`가 느린 것은 별개의 문제이므로 각각 알려야 한다.

### 프록시 통합

`server.go`의 쿼리 처리 완료 시점에 `emitAuditEvent()`를 호출한다. Simple Query와 Extended Query 양쪽 모두에 동일하게 적용된다.

```go
func (s *Server) emitAuditEvent(query, target string, duration time.Duration, cached bool) {
    if s.auditLogger == nil {
        return
    }
    s.auditLogger.Log(audit.Event{
        Query:    query,
        Target:   target,
        Duration: duration,
        Cached:   cached,
    })
}
```

Prometheus 메트릭도 3개 추가했다:
- `pgmux_slow_queries_total{target}` — Slow Query 카운터
- `pgmux_audit_webhook_sent_total` — Webhook 전송 횟수
- `pgmux_audit_webhook_errors_total` — Webhook 실패 횟수

---

## 2. Helm Chart

### Dockerfile: CGO 빌드의 함정

pgmux는 `pg_query_go`(PostgreSQL C 파서 바인딩) 때문에 CGO가 필요하다. 일반적인 Go 프로젝트처럼 `CGO_ENABLED=0`으로 정적 바이너리를 만들 수 없다.

```dockerfile
# Build stage — C 컴파일러가 있는 환경
FROM golang:1.25-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -o /pgmux ./cmd/pgmux

# Runtime — 최소 이미지
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /pgmux /usr/local/bin/pgmux
ENTRYPOINT ["pgmux"]
```

scratch나 distroless를 쓰고 싶었지만, CGO 바이너리는 glibc에 의존하므로 `debian:bookworm-slim`을 선택했다. `ca-certificates`는 TLS 통신(Webhook, Redis 등)에 필요하다.

### Helm Chart 구조

`deploy/helm/pgmux/`에 표준 Helm Chart 구조를 만들었다.

```
deploy/helm/pgmux/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml
    ├── service.yaml
    ├── configmap.yaml
    ├── hpa.yaml
    ├── pdb.yaml
    └── servicemonitor.yaml
```

핵심은 **ConfigMap으로 config.yaml을 주입**하는 것이다. values.yaml에서 설정한 값들이 ConfigMap 템플릿을 통해 pgmux의 YAML 설정으로 변환된다.

```yaml
# values.yaml에서
config:
  writer:
    host: "primary.db.internal"
    port: 5432
  readers:
    - host: "replica-1.db.internal"
      port: 5432
```

Deployment에는 readiness/liveness probe를 Admin API의 `/admin/health`로 설정했다.

```yaml
livenessProbe:
  httpGet:
    path: /admin/health
    port: admin
  initialDelaySeconds: 5
readinessProbe:
  httpGet:
    path: /admin/health
    port: admin
  initialDelaySeconds: 3
```

HPA(Horizontal Pod Autoscaler)와 PDB(Pod Disruption Budget)도 포함하여 프로덕션에서 바로 사용할 수 있게 했다. ServiceMonitor는 Prometheus Operator 환경에서 자동 스크래핑 설정을 위한 것이다.

### 배포

```bash
helm install pgmux ./deploy/helm/pgmux \
  --set config.writer.host=primary.db.internal \
  --set config.writer.port=5432
```

---

## 3. Serverless Data API

### 왜 HTTP API인가

Lambda, Cloudflare Workers, Vercel Edge Functions 같은 서버리스 환경에서는 매 요청마다 TCP 커넥션을 맺는 것이 비효율적이다. 커넥션 풀링을 활용하려면 프록시가 HTTP 엔드포인트를 제공해야 한다.

```
서버리스 함수 → HTTP POST /v1/query → pgmux → PG 커넥션 풀 → DB
```

### PG Wire Protocol → JSON 변환

이 기능의 핵심 난이도는 PG의 바이너리 응답 메시지를 JSON으로 변환하는 것이다. 기존 프록시 코드는 클라이언트↔백엔드 사이에서 바이트를 그대로 릴레이했지만, Data API는 응답을 **파싱**해야 한다.

PG Simple Query의 응답 흐름:

```
Query('Q') → RowDescription('T') → DataRow('D')... → CommandComplete('C') → ReadyForQuery('Z')
```

**RowDescription** 메시지에서 컬럼 이름과 OID(타입 식별자)를 추출한다:

```go
type columnInfo struct {
    Name     string
    OID      uint32
    TypeName string
}

func parseRowDescription(payload []byte) []columnInfo {
    numCols := binary.BigEndian.Uint16(payload[0:2])
    // 각 컬럼: name\0 + table_oid(4) + col_attr(2) + type_oid(4) + ...
}
```

**DataRow** 메시지에서 실제 값을 읽고, OID에 따라 Go 타입으로 변환한다:

```go
func convertValue(val string, oid uint32) any {
    switch oid {
    case 16:          return val == "t"        // bool
    case 20, 21, 23:  return parseInt64(val)   // int8, int2, int4
    case 700, 701:    return parseFloat64(val) // float4, float8
    default:          return val               // text, timestamp, uuid 등
    }
}
```

PG의 Simple Query Protocol은 모든 값을 텍스트로 전송하므로, OID를 보고 적절한 타입으로 파싱하는 것이 핵심이다. `int4` OID가 23번이라는 걸 어떻게 아느냐고? PostgreSQL 소스의 `pg_type.dat`에 정의되어 있다.

### 기존 기능 투명 적용

Data API의 가장 큰 장점은 기존 프록시의 모든 기능이 그대로 적용된다는 것이다.

```go
func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
    // 1. 인증 (API Key)
    // 2. Rate Limiting
    // 3. 방화벽 검사 (AST 기반)
    // 4. R/W 분류 → Writer/Reader 풀 선택
    // 5. 캐시 체크 (읽기 쿼리)
    // 6. PG 실행 → JSON 변환
    // 7. 캐시 저장 / 무효화
}
```

HTTP API로 `DELETE FROM users` 같은 위험 쿼리를 보내면 방화벽이 차단하고, 같은 SELECT를 두 번 보내면 두 번째는 캐시에서 반환한다. TCP 프록시와 동일한 보호를 받는다.

### 커넥션 세션 리셋

한 가지 주의할 점은 커넥션 반환 전 세션 상태를 초기화하는 것이다. TCP 프록시에서는 클라이언트가 접속을 끊을 때까지 커넥션을 점유하지만, Data API는 매 요청마다 커넥션을 빌려서 쓰고 반환한다. 이전 요청에서 `SET search_path` 같은 세션 설정을 했다면 다음 요청에 영향을 줄 수 있다.

```go
func (s *Server) executeOnPool(ctx context.Context, sql string, p *pool.Pool) (*QueryResponse, error) {
    conn, _ := p.Acquire(ctx)
    resp, err := executeQuery(conn, sql)

    // 세션 상태 리셋 후 반환
    resetPayload := append([]byte(s.cfg.Pool.ResetQuery), 0)  // "DISCARD ALL"
    protocol.WriteMessage(conn, protocol.MsgQuery, resetPayload)
    drainUntilReady(conn)
    p.Release(conn)

    return resp, nil
}
```

### 사용 예시

```bash
# 읽기 쿼리
curl -X POST http://localhost:8080/v1/query \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT id, name FROM users LIMIT 5"}'

# 응답
{
  "columns": ["id", "name"],
  "types": ["int4", "text"],
  "rows": [[1, "Alice"], [2, "Bob"]],
  "row_count": 2,
  "command": "SELECT 2"
}
```

---

## 테스트

### Audit Logger 테스트

Webhook 테스트는 `httptest.NewServer`로 목 서버를 만들어 실제 HTTP 호출을 검증했다.

```go
func TestSlowQueryWebhook(t *testing.T) {
    var received atomic.Bool
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        received.Store(true)
        w.WriteHeader(200)
    }))

    logger := audit.New(audit.Config{
        Enabled:            true,
        SlowQueryThreshold: 100 * time.Millisecond,
        Webhook: audit.WebhookConfig{Enabled: true, URL: srv.URL},
    })

    logger.Log(audit.Event{
        Query:    "SELECT * FROM large_table",
        Duration: 500 * time.Millisecond,
    })

    // 비동기 처리 대기 후 검증
    time.Sleep(100 * time.Millisecond)
    if !received.Load() {
        t.Error("webhook should have been called")
    }
}
```

### Data API 테스트

PG wire protocol 메시지를 직접 바이트로 구성하여 파싱 로직을 테스트했다. 실제 DB 없이 RowDescription, DataRow 메시지 파싱을 검증할 수 있다.

```go
func TestParseDataRow(t *testing.T) {
    columns := []columnInfo{
        {Name: "id", OID: 23},    // int4
        {Name: "name", OID: 25},  // text
        {Name: "active", OID: 16}, // bool
    }

    // DataRow 바이트 구성: 3 columns, "42", "Alice", "t"
    var buf []byte
    buf = binary.BigEndian.AppendUint16(buf, 3)
    buf = binary.BigEndian.AppendUint32(buf, 2)
    buf = append(buf, "42"...)
    // ...

    row := parseDataRow(buf, columns)
    assert(row[0] == int64(42))
    assert(row[1] == "Alice")
    assert(row[2] == true)
}
```

NULL 값(`-1` 길이), 타입 변환, 인증(유효/무효 키, 미인증), 방화벽 차단 등 15개 테스트 케이스를 작성했다.

---

## 배운 점

### 비동기 처리의 트레이드오프

Audit Logger에서 "채널이 가득 차면 이벤트를 드롭한다"는 결정은 처음에 불편했다. 감사 로그인데 유실이 가능하다니. 하지만 대안을 생각해보면:
- **블로킹 전송**: 채널이 가득 차면 쿼리 처리가 멈춘다 → 프록시 존재 이유 상실
- **무한 버퍼**: 메모리 폭발 가능성
- **디스크 큐**: 복잡도 급증, 프로덕션 의존성 추가

"100%의 감사 로그를 보장하되 쿼리 레이턴시에 영향"보다 "99.99%의 감사 로그를 보장하되 쿼리 레이턴시 무영향"이 프록시의 역할에 더 부합한다. 시스템 설계에서 "뭘 포기할 것인가"를 명시적으로 결정하는 것이 중요하다.

### PG Wire Protocol의 타입 시스템

Data API를 만들면서 PG의 타입 OID 체계를 깊이 들여다봤다. OID 23이 `int4`이고, 16이 `bool`이라는 건 `pg_type` 시스템 카탈로그에 정의된 값이다. Simple Query Protocol에서는 모든 값이 텍스트로 전송되기 때문에, OID를 보고 `"42"` → `int64(42)`, `"t"` → `true`로 변환해야 한다. Binary Protocol을 사용하면 파싱 없이 바로 읽을 수 있지만, Simple Query Protocol의 단순함이 이 프로젝트에는 더 적합했다.

### 기존 아키텍처의 힘

Data API 구현에서 가장 만족스러웠던 부분은 새로 작성한 코드의 양이 적었다는 것이다. HTTP 요청 파싱, 인증, 방화벽, 라우팅, 캐싱은 모두 기존 컴포넌트를 호출하기만 하면 됐다. 이건 이전 Phase들에서 각 컴포넌트를 독립적으로 설계한 덕분이다. "잘 분리된 모듈은 예상하지 못한 조합도 가능하게 한다"는 걸 직접 경험했다.

---

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
