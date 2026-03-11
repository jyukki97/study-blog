---
title: "Go로 PostgreSQL 프록시 만들기 (6) - Prometheus 메트릭, Prepared Statement 라우팅, Admin API"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Prometheus", "Monitoring"]
categories: ["Database"]
description: "프록시를 운영 가능한 수준으로 고도화한다. Prometheus 메트릭 계측, Extended Query Protocol의 Prepared Statement reader 라우팅, Admin API를 구현한다."
---

## 들어가며

> 5편까지 프록시의 핵심 기능(풀링, 라우팅, 캐싱)을 통합하고 E2E 테스트로 검증했다. 하지만 운영 환경에서 쓰려면 **관측 가능성(Observability)**과 **제어 인터페이스**가 필요하다.

이번 편에서 추가한 것:
1. **Prometheus 메트릭** — 쿼리 라우팅, 캐시, 풀 상태를 숫자로 추적
2. **Prepared Statement 라우팅** — Extended Query Protocol의 SELECT도 reader로 보내기
3. **Admin API** — 런타임 상태 조회와 캐시 수동 제어

## 1. Prometheus 메트릭

### 왜 메트릭인가

로그로는 "지금 캐시 히트율이 몇 %인지", "reader 풀 연결이 몇 개 열려있는지"를 실시간으로 파악하기 어렵다. Prometheus + Grafana 조합이면 대시보드 하나로 전부 볼 수 있다.

### 메트릭 설계

```go
type Metrics struct {
    // 쿼리 라우팅
    QueriesRouted  *prometheus.CounterVec    // {target="writer|reader"}
    QueryDuration  *prometheus.HistogramVec  // 쿼리 처리 시간
    ReaderFallback prometheus.Counter        // reader 장애로 writer fallback 횟수

    // 캐시
    CacheHits          prometheus.Counter    // 캐시 히트
    CacheMisses        prometheus.Counter    // 캐시 미스
    CacheEntries       prometheus.Gauge      // 현재 캐시 항목 수
    CacheInvalidations prometheus.Counter    // 캐시 무효화 횟수

    // 커넥션 풀
    PoolOpenConns  *prometheus.GaugeVec      // {role, addr}
    PoolIdleConns  *prometheus.GaugeVec      // {role, addr}
    PoolAcquires   *prometheus.CounterVec    // 커넥션 획득 횟수
    PoolAcquireDur *prometheus.HistogramVec  // 커넥션 획득 대기 시간
}
```

Counter는 단조 증가, Gauge는 현재값, Histogram은 분포를 추적한다. 라벨(target, role, addr)로 차원을 분리해서 writer/reader별, 서버별로 분석할 수 있다.

### 계측 위치

메트릭을 어디에 심느냐가 중요하다. 핫 경로에 최소한으로 넣었다:

```go
// relayQueries — 쿼리 라우팅 후
start := time.Now()
if route == router.RouteWriter {
    s.handleWriteQuery(...)
} else {
    s.handleReadQuery(...)
}
if s.metrics != nil {
    s.metrics.QueriesRouted.WithLabelValues(target).Inc()
    s.metrics.QueryDuration.WithLabelValues(target).Observe(time.Since(start).Seconds())
}

// handleReadQuery — 캐시 히트/미스
if cached := s.queryCache.Get(key); cached != nil {
    s.metrics.CacheHits.Inc()
    return clientConn.Write(cached)
}
s.metrics.CacheMisses.Inc()

// handleReadQuery — reader fallback
if readerAddr == "" {
    s.metrics.ReaderFallback.Inc()
    return s.forwardAndRelay(clientConn, writerConn, msg)
}
```

`if s.metrics != nil` 가드로 메트릭이 비활성화되면 오버헤드가 0이다.

### `/metrics` 엔드포인트

```go
// main.go
if cfg.Metrics.Enabled {
    mux := http.NewServeMux()
    mux.Handle("/metrics", promhttp.Handler())
    go http.ListenAndServe(cfg.Metrics.Listen, mux)
}
```

`curl http://localhost:9090/metrics`로 Prometheus scrape 형식의 메트릭을 확인할 수 있다:

```
# HELP pgmux_queries_routed_total Total number of queries routed by target.
# TYPE pgmux_queries_routed_total counter
pgmux_queries_routed_total{target="reader"} 142
pgmux_queries_routed_total{target="writer"} 38

# HELP pgmux_cache_hits_total Total number of cache hits.
pgmux_cache_hits_total 89
pgmux_cache_misses_total 53
```

## 2. Prepared Statement 라우팅

### 문제: Extended Query가 전부 writer로 간다

5편에서 Extended Query Protocol을 지원했지만, Parse/Bind/Execute 메시지를 **무조건 writer로** 전달했다. 실제로 `lib/pq`가 `$1` 파라미터를 쓰는 SELECT도 Extended Query로 보내므로, 이러면 reader를 전혀 활용하지 못한다.

### 해결: Parse 메시지에서 SQL 추출

PG의 `Parse` 메시지 포맷:

```
Parse (P):
  statement_name (string\0)
  query_text     (string\0)
  param_count    (int16)
  param_oids     (int32 × param_count)
```

여기서 query_text를 추출하면 `Classify()`로 Read/Write를 판단할 수 있다:

```go
func ParseParseMessage(payload []byte) (stmtName, query string) {
    nameEnd := indexOf(payload, 0)
    stmtName = string(payload[:nameEnd])
    rest := payload[nameEnd+1:]
    queryEnd := indexOf(rest, 0)
    query = string(rest[:queryEnd])
    return stmtName, query
}
```

### 세션별 Statement 맵

Prepared statement은 이름(`stmt1`)으로 참조되므로, Parse 시점에 라우팅 결과를 저장해두고, Bind/Execute에서 참조한다:

```go
type Session struct {
    // ...기존 필드
    stmtRoutes map[string]Route  // statement name → route
}

func (s *Session) RegisterStatement(name, query string) Route {
    route := s.routeLocked(query)
    s.stmtRoutes[name] = route
    return route
}

func (s *Session) StatementRoute(name string) Route {
    if route, ok := s.stmtRoutes[name]; ok {
        return route
    }
    return RouteWriter  // 안전한 기본값
}
```

unnamed statement(`""`)은 매번 덮어쓰고, `Close('S')` 메시지가 오면 맵에서 제거한다.

### 배치 라우팅

Extended Query는 Parse-Bind-Execute가 한 묶음으로 오고, Sync에서 한꺼번에 실행된다. 배치 내에 **하나라도 writer 쿼리가 있으면 전체를 writer로** 보낸다:

```go
case protocol.MsgParse:
    stmtName, query := protocol.ParseParseMessage(msg.Payload)
    route := session.RegisterStatement(stmtName, query)
    if route == router.RouteWriter {
        extRoute = router.RouteWriter
    }
    extBuf = append(extBuf, msg)

case protocol.MsgSync:
    if extRoute == router.RouteReader {
        s.handleExtendedRead(ctx, clientConn, writerConn, extBuf, msg, ...)
    } else {
        // 배치 전체를 writer로 전달
        for _, m := range extBuf {
            protocol.WriteMessage(writerConn, m.Type, m.Payload)
        }
        protocol.WriteMessage(writerConn, msg.Type, msg.Payload)
        s.relayUntilReady(clientConn, writerConn)
    }
    extBuf = extBuf[:0]  // 배치 리셋
```

이로써 `SELECT * FROM users WHERE id = $1` 같은 파라미터 쿼리도 reader로 라우팅된다.

## 3. Admin API

### 엔드포인트 설계

| Method | Path | 설명 |
|--------|------|------|
| GET | `/admin/health` | 백엔드 TCP 연결 상태 |
| GET | `/admin/stats` | 풀, 캐시 통계 |
| GET | `/admin/config` | 현재 설정 (비밀번호 마스킹) |
| POST | `/admin/cache/flush` | 전체 캐시 비우기 |
| POST | `/admin/cache/flush/{table}` | 특정 테이블 캐시만 무효화 |

별도 포트(기본 9091)에서 제공해서 외부 노출을 방지한다.

### 구현 포인트

**Health check** — TCP dial로 백엔드 연결 가능 여부를 확인:

```go
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
    writerAddr := fmt.Sprintf("%s:%d", s.cfg.Writer.Host, s.cfg.Writer.Port)
    writerHealthy := checkTCP(writerAddr)  // net.DialTimeout 2초
    // ... readers도 동일
}
```

**Config 마스킹** — 비밀번호를 `"********"`로 치환해서 반환:

```go
safe.Backend.Password = "********"
```

**Table-specific flush** — URL 경로에서 테이블명을 추출해서 해당 테이블의 캐시만 무효화:

```go
func (s *Server) handleCacheFlush(w http.ResponseWriter, r *http.Request) {
    path := strings.TrimPrefix(r.URL.Path, "/admin/cache/flush/")
    if path != "" {
        s.cache.InvalidateTable(path)  // 테이블별 무효화
    } else {
        s.cache.FlushAll()  // 전체 비우기
    }
}
```

`FlushAll()`은 cache에 새로 추가한 메서드로, 모든 항목과 인덱스를 초기화한다.

## 설정

```yaml
metrics:
  enabled: true
  listen: "0.0.0.0:9090"

admin:
  enabled: true
  listen: "0.0.0.0:9091"
```

## 테스트

Phase 7에서 추가된 테스트:

| 패키지 | 테스트 | 내용 |
|--------|--------|------|
| metrics | 1 | Prometheus 메트릭 등록 및 수집 검증 |
| protocol | 3 | ParseParseMessage, ParseBindMessage, ParseCloseMessage |
| router | 3 | Prepared statement 라우팅, 트랜잭션 내 동작, unnamed 덮어쓰기 |
| admin | 6 | health, stats, config 마스킹, 전체 flush, 테이블 flush, method 제한 |

전체 테스트: **92건** (서브테스트 포함), 모두 통과.

## 전체 아키텍처 (최종)

```
┌─────────────┐
│ Application │
└──────┬──────┘
       │ PG Wire Protocol
       ▼
┌─────────────────────────────────────┐
│            pgmux                  │
│                                      │
│  ┌──────────┐  ┌──────────────────┐ │
│  │  Parser   │  │ Statement Map   │ │
│  │ (Q/P/B/E) │  │ (name→route)    │ │
│  └─────┬─────┘  └────────────────┘ │
│        │                             │
│  ┌─────▼──────────────┐             │
│  │  Session Router     │  ← Metrics │
│  │  (R/W + R-A-W)      │             │
│  └─────┬──────────┬───┘             │
│        │          │                  │
│  ┌─────▼───┐ ┌───▼──────────┐      │
│  │  Cache  │ │ RoundRobin   │      │
│  │  (LRU)  │ │ + Pool       │      │
│  └─────────┘ └──────────────┘      │
│                                      │
│  ┌──────────────┐ ┌──────────────┐  │
│  │ /metrics     │ │ /admin/*     │  │
│  │ :9090        │ │ :9091        │  │
│  └──────────────┘ └──────────────┘  │
└────────┬──────────────┬──────────────┘
         │              │
    ┌────▼────┐   ┌────▼────┐
    │ Writer  │   │ Readers │
    │(Primary)│   │(Replica)│
    └─────────┘   └─────────┘
```

## 마무리

프록시의 핵심 기능은 5편에서 완성했다. 이번 편에서는 **운영에 필요한 것들**을 추가했다:

- **Prometheus 메트릭**: 캐시 히트율, 쿼리 분포, 풀 상태를 실시간으로 모니터링
- **Prepared Statement 라우팅**: Extended Query Protocol의 SELECT도 reader로 보내서 reader 활용률 극대화
- **Admin API**: 런타임 상태 조회, 수동 캐시 제어, 비밀번호 마스킹

코드를 짜는 것과 운영 가능한 시스템을 만드는 것 사이에는 관측 가능성이라는 간극이 있다. 메트릭과 관리 인터페이스가 그 간극을 메워준다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
