---
title: "Go로 PostgreSQL 프록시 만들기 (61) - E2E 커버리지 갭 분석과 미커버 기능 테스트"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Testing", "E2E", "Coverage"]
categories: ["Database"]
project: "pgmux"
description: "22개 E2E 테스트의 커버리지 갭을 분석하고, Route Hint·Timeout Hint·Digest Reset·Semantic Cache·Slow Query·Config Reload·CancelRequest 등 8개 미커버 기능 테스트를 추가하여 30개로 확장한다."
---

## 들어가며

이전 포스트에서 E2E 테스트를 14개에서 22개로 확장했다. "이 정도면 다 커버되었나?"라는 질문에 답하기 위해 pgmux의 전체 기능 목록과 테스트를 대조해봤다. 결과는 **약 60%**. 핵심 데이터 경로는 잘 커버되어 있지만, 운영/관측 기능과 힌트 기반 기능에 상당한 갭이 있었다.

---

## 커버리지 갭 분석

pgmux의 구현 단계 21개와 이후 추가된 기능들을 기존 22개 테스트와 대조했다.

### 이미 커버된 기능 (22개 테스트)

| 기능 | 테스트 |
|------|--------|
| R/W 라우팅 (Simple Query) | `ProxyIntegration` |
| 트랜잭션 처리 / Pooling | `ProxyIntegration`, `TransactionPooling` |
| 커넥션 풀링 | `TransactionPooling` (SessionReset, PoolExhaustion) |
| 쿼리 캐시 | `ProxyIntegration` (CacheHit), `CacheFlush` |
| Causal Consistency (LSN) | `CausalConsistency` |
| Extended Query Protocol | `ExtendedQueryProtocol` |
| Prepared Statement Reuse | `PreparedStatementReuse` |
| COPY IN/OUT | `CopyProtocol` |
| Admin API | `AdminAPI` (6개 서브테스트) |
| Auth / Firewall / Connection Limits | `Auth`, `FirewallRules`, `ConnectionLimits` |
| Data API / Rate Limit | `DataAPI`, `RateLimitMetric` |
| Session Compatibility / SQL Redaction | `SessionCompatibility`, `SQLRedaction` |

### 미커버 기능

| 기능 | 인프라 필요 여부 | 테스트 가능성 |
|------|:---:|:---:|
| **Route Hint** (`/* route:writer */`) | 없음 | **가능** |
| **Timeout Hint** (`/* timeout:Xs */`) | 없음 | **가능** |
| **Digest Reset** (`POST /admin/queries/reset`) | 없음 | **가능** |
| **Semantic Cache Key** (AST 정규화) | 없음 | **가능** |
| **Slow Query Detection** (감사 메트릭) | 없음 | **가능** |
| **Config Reload** (`POST /admin/reload`) | 없음 | **가능** |
| **CancelRequest** (PG 쿼리 취소) | 없음 | **가능** |
| **Mirror Stats** 엔드포인트 | 없음 | **가능** |
| Query Mirroring (Shadow DB) | Shadow DB 필요 | 보류 |
| Circuit Breaker | 장애 주입 필요 | 보류 |
| Reader Failover | Reader 중단 필요 | 보류 |
| TLS | 인증서 필요 | 보류 |
| Redis Pub/Sub 캐시 무효화 | Redis 필요 | 보류 |
| OpenTelemetry Span | OTLP 수집기 필요 | 보류 |
| Admin RBAC / IP Allowlist | 별도 설정 필요 | 보류 |
| Prepared Statement Multiplexing | 별도 설정 필요 | 보류 |

기존 인프라(docker-compose 3대 PostgreSQL + pgmux)만으로 테스트 가능한 8개 기능을 추가하기로 했다.

---

## 추가 테스트 1: Route Hint

pgmux는 쿼리 주석에 `/* route:writer */` 또는 `/* route:reader */`를 넣어 라우팅을 오버라이드할 수 있다. 이 기능은 P3에서 구현했지만 E2E 테스트가 없었다.

```go
t.Run("RouteSelectToWriter", func(t *testing.T) {
    var result int
    err := db.QueryRowContext(ctx, "/* route:writer */ SELECT 1").Scan(&result)
    if err != nil {
        t.Fatalf("route hint SELECT failed: %v", err)
    }
})
```

SELECT는 원래 reader로 가지만, `/* route:writer */` 힌트가 있으면 writer로 라우팅된다. 이를 검증하기 위해 **메트릭 스냅샷 비교**를 사용한다.

```go
writerBefore := getMetricValue(t, client, "pgmux_queries_routed_total", `target="writer"`)

// /* route:writer */ SELECT 실행

writerAfter := getMetricValue(t, client, "pgmux_queries_routed_total", `target="writer"`)
if writerAfter <= writerBefore {
    t.Error("writer metric did not increase")
}
```

Prometheus `/metrics` 엔드포인트에서 `pgmux_queries_routed_total{target="writer"}` 값을 힌트 실행 전후로 비교한다. writer 카운터가 증가하면 SELECT가 writer로 라우팅된 것이 증명된다.

---

## 추가 테스트 2: Timeout Hint

`/* timeout:200ms */` 힌트는 쿼리별 타임아웃을 지정한다. 타임아웃이 발생하면 pgmux가 PG CancelRequest를 백엔드로 전송하여 쿼리를 취소한다.

```go
t.Run("TimeoutCancelsQuery", func(t *testing.T) {
    start := time.Now()
    _, err := db.ExecContext(ctx, "/* timeout:200ms */ SELECT pg_sleep(5)")
    elapsed := time.Since(start)

    if err == nil {
        t.Fatal("expected timeout error, got nil")
    }
    if elapsed > 3*time.Second {
        t.Errorf("query took %v, expected cancellation within ~200ms", elapsed)
    }
})
```

`pg_sleep(5)`는 5초가 걸리지만, 200ms 타임아웃으로 인해 약 200ms 만에 에러가 반환되어야 한다. 핵심 검증 포인트:

1. **에러 발생**: `err != nil` (타임아웃으로 쿼리 취소)
2. **빠른 완료**: `elapsed < 3s` (5초가 아닌 ~200ms에 완료)

반대 케이스도 테스트한다. 충분한 타임아웃(`/* timeout:5s */`)과 빠른 쿼리(`SELECT 42`)는 정상 완료되어야 한다.

---

## 추가 테스트 3: Digest Reset

Query Digest는 쿼리 패턴별 실행 통계(횟수, P50/P99 레이턴시)를 수집한다. `POST /admin/queries/reset`으로 통계를 초기화할 수 있다.

```go
// 쿼리 실행으로 digest 적재
for i := 0; i < 5; i++ {
    db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = 1")
}

// 초기화 전: entries > 0
// POST /admin/queries/reset
// 초기화 후: entries == 0
```

테스트 흐름:
1. 쿼리 5회 실행 → `GET /admin/queries/top` → 패턴 존재 확인
2. `POST /admin/queries/reset` → 200 응답 확인
3. `GET /admin/queries/top` → 빈 배열 확인

---

## 추가 테스트 4: Semantic Cache Key

`routing.ast_parser: true`일 때, pgmux는 pg_query의 Parse+Deparse를 통해 **구조적으로 동일한 쿼리에 같은 캐시 키**를 부여한다.

```sql
-- 이 두 쿼리는 같은 캐시 엔트리를 공유해야 한다
SELECT  name  FROM  users  WHERE  id = 1
select name from users where id = 1
```

공백과 대소문자만 다르고 리터럴 값은 같으므로, AST 기반 정규화 후 동일한 캐시 키가 생성된다.

```go
// 캐시 플러시 후 시작
missBefore := getMetricValue(t, client, "pgmux_cache_misses_total", "")

// 첫 번째 쿼리 (여분 공백) → 캐시 미스
db.QueryRowContext(ctx, "SELECT  name  FROM  users  WHERE  id = 1")
missAfterFirst := getMetricValue(t, client, "pgmux_cache_misses_total", "")

// 두 번째 쿼리 (소문자, 공백 정리) → 캐시 히트 (미스 증가 없음)
db.QueryRowContext(ctx, "select name from users where id = 1")
missAfterSecond := getMetricValue(t, client, "pgmux_cache_misses_total", "")

// missAfterSecond == missAfterFirst → 캐시 히트!
```

`pgmux_cache_misses_total` 메트릭이 두 번째 쿼리에서 증가하지 않으면 성공이다.

---

## 추가 테스트 5: Slow Query Detection

`audit.slow_query_threshold: 100ms`가 설정되어 있으므로, 100ms 이상 걸리는 쿼리는 `pgmux_slow_queries_total` 메트릭에 카운트된다.

```go
slowBefore := getMetricValue(t, client, "pgmux_slow_queries_total", "")

db.ExecContext(ctx, "SELECT pg_sleep(0.2)") // 200ms > 100ms threshold

time.Sleep(200 * time.Millisecond) // 비동기 audit 처리 대기

slowAfter := getMetricValue(t, client, "pgmux_slow_queries_total", "")
// slowAfter > slowBefore
```

`time.Sleep(200ms)`는 audit 이벤트가 비동기 채널을 통해 처리되는 시간을 고려한 것이다.

---

## 추가 테스트 6: Config Reload

`POST /admin/reload`는 설정 파일을 다시 읽어 적용한다. 테스트에서는 reload 후 프록시가 정상 동작하는지까지 검증한다.

```go
resp, err := client.Post(e2eAdminURL+"/admin/reload", "application/json", nil)
// status == 200

// 리로드 후에도 쿼리가 정상 동작해야 함
db2 := e2eCheckProxy(t)
db2.QueryRowContext(ctx, "SELECT 1")
```

설정이 변경되지 않은 상태에서의 reload는 "커넥션 풀 재생성 → 기존 풀 graceful close"를 거친다. 이 과정에서 기존 연결이 끊기지 않고 새 연결이 정상적으로 수립되는지가 핵심이다.

---

## 추가 테스트 7: CancelRequest

PostgreSQL의 CancelRequest 프로토콜을 테스트한다. Go의 `context.WithTimeout`으로 컨텍스트를 취소하면, `database/sql` 드라이버가 CancelRequest를 보내고 pgmux가 이를 백엔드로 전달한다.

```go
ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
defer cancel()

start := time.Now()
_, err := db.ExecContext(ctx, "SELECT pg_sleep(10)")
elapsed := time.Since(start)

// err != nil (취소됨)
// elapsed < 3s (10초가 아닌 ~500ms에 완료)
```

취소 후에도 프록시가 정상 동작하는지 확인하는 서브테스트도 포함한다. CancelRequest는 별도 TCP 연결로 전송되므로, 기존 연결 상태에 영향을 주지 않아야 한다.

---

## 추가 테스트 8: Mirror Stats Endpoint

Query Mirroring 자체는 Shadow DB가 필요하지만, `/admin/mirror/stats` 엔드포인트는 mirror가 비활성 상태에서도 응답해야 한다.

```go
resp, err := client.Get(e2eAdminURL + "/admin/mirror/stats")
// status == 200, JSON 파싱 가능
```

mirror가 설정되지 않은 경우 zeroed 통계(sent=0, dropped=0, errors=0)를 반환하는지 확인하는 스모크 테스트다.

---

## 메트릭 추출 헬퍼

여러 테스트에서 Prometheus 메트릭 값을 비교해야 하므로, 공통 헬퍼를 추가했다.

```go
func getMetricValue(t *testing.T, client *http.Client, metricName, labelFilter string) float64 {
    resp, err := client.Get(e2eMetricURL)
    // ...
    for _, line := range strings.Split(string(body), "\n") {
        if strings.HasPrefix(line, "#") || line == "" {
            continue
        }
        if !strings.Contains(line, metricName) {
            continue
        }
        if labelFilter != "" && !strings.Contains(line, labelFilter) {
            continue
        }
        parts := strings.Fields(line)
        if len(parts) >= 2 {
            var val float64
            fmt.Sscanf(parts[len(parts)-1], "%f", &val)
            return val
        }
    }
    return 0
}
```

Prometheus text exposition 형식을 한 줄씩 파싱하여 메트릭 이름과 레이블로 필터링한 뒤 수치를 반환한다.

---

## 테스트 현황: 22개 → 30개

| # | 테스트 | 신규 |
|---|--------|:---:|
| 1-22 | 기존 테스트 (ProxyIntegration ~ AdminConnectionLimitStats) | |
| 23 | `TestE2E_RouteHint` — route:writer/reader 힌트 + 메트릭 검증 | **NEW** |
| 24 | `TestE2E_TimeoutHint` — timeout 힌트 기반 쿼리 취소 | **NEW** |
| 25 | `TestE2E_DigestReset` — digest 통계 초기화 | **NEW** |
| 26 | `TestE2E_SemanticCacheKey` — AST 정규화 캐시 키 | **NEW** |
| 27 | `TestE2E_SlowQueryDetection` — slow query 메트릭 | **NEW** |
| 28 | `TestE2E_ConfigReload` — 설정 리로드 + 사후 동작 | **NEW** |
| 29 | `TestE2E_CancelRequest` — PG CancelRequest 프로토콜 | **NEW** |
| 30 | `TestE2E_MirrorStatsEndpoint` — 미러 통계 스모크 테스트 | **NEW** |

### 여전히 보류된 항목

| 기능 | 필요 인프라 |
|------|------------|
| Query Mirroring | Shadow DB PostgreSQL |
| Circuit Breaker | 장애 주입 (reader 중단) |
| Reader Failover | reader 컨테이너 중단 |
| TLS | 인증서 + TLS 설정 |
| Redis Pub/Sub | Redis 인스턴스 |
| Admin RBAC | auth 활성화된 별도 설정 |
| Prepared Statement Multiplexing | multiplex 모드 설정 |

이들은 docker-compose에 Redis, Shadow DB를 추가하거나, 별도의 config.test-*.yaml을 준비하여 향후 확장할 수 있다.

---

## 마무리

"테스트가 충분한가?"에 대한 답은 기능 목록과 대조해야 나온다. 22개 테스트는 데이터 경로의 핵심을 커버했지만, 힌트 기반 기능(Route Hint, Timeout Hint)이나 관측 기능(Slow Query, Digest Reset)은 빠져 있었다. 이번 추가로 기존 인프라에서 테스트 가능한 범위는 거의 마무리되었다. 나머지는 테스트 인프라를 확장해야 하는 영역이다.
