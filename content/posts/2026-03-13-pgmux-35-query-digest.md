---
title: "Go로 PostgreSQL 프록시 만들기 (35) - Query Digest와 Top-N 쿼리 분석"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Query Digest", "Observability", "Performance"]
categories: ["Database"]
project: "pgmux"
description: "쿼리를 정규화하여 패턴별 실행 횟수, 평균/P50/P99 레이턴시를 집계하는 Query Digest 기능을 구현한다. pg_stat_statements의 프록시 버전."
---

## 들어가며

pgmux에는 이미 Prometheus 메트릭(`pgmux_query_duration_seconds`)과 Audit Log가 있다. 하지만 "어떤 쿼리가 가장 많이 실행되고, 어떤 패턴이 느린가?"를 한눈에 보려면 별도의 집계가 필요하다.

PostgreSQL에는 `pg_stat_statements`라는 확장이 있다. 쿼리를 정규화하여 패턴별 실행 횟수, 총 실행 시간, 평균 시간 등을 추적한다. 이걸 프록시 레벨에서 구현하면:

1. **DB 접근 없이** 쿼리 패턴을 분석할 수 있다
2. **모든 DB 그룹**의 쿼리를 한곳에서 집계할 수 있다
3. Admin API로 **런타임에 조회/초기화**할 수 있다

이번 글에서는 Query Digest의 설계와 구현을 다룬다.

---

## 쿼리 정규화

Query Digest의 핵심은 **정규화**(normalization)다. 리터럴 값을 플레이스홀더로 치환하여 같은 패턴의 쿼리를 그룹핑한다:

```sql
-- 원본 쿼리들
SELECT * FROM users WHERE id = 42
SELECT * FROM users WHERE id = 7
SELECT * FROM users WHERE id = 100

-- 정규화 결과 (하나의 패턴)
SELECT * FROM users WHERE id = $1
```

pgmux는 이미 `pg_query_go`(PostgreSQL C 파서의 cgo 바인딩)를 사용하고 있었다. 이 라이브러리의 `Normalize()` 함수가 정확히 이 일을 해준다:

```go
import pg_query "github.com/pganalyze/pg_query_go/v5"

normalized, err := pg_query.Normalize("SELECT * FROM users WHERE id = 42")
// normalized = "SELECT * FROM users WHERE id = $1"
```

이미 Query Mirroring의 `mirror/stats.go`에서 동일한 함수를 사용하고 있었으므로, 검증된 방법이다.

---

## 순환 버퍼와 백분위 계산

패턴별 P50/P99를 계산하려면 최근 N개의 실행 시간 샘플을 유지해야 한다. 무한히 쌓을 수 없으므로 **순환 버퍼**(circular buffer)를 사용한다:

```go
type patternStats struct {
    mu       sync.Mutex
    count    int64       // 전체 실행 횟수 (버퍼 크기와 무관)
    totalMs  float64     // 전체 누적 시간
    minMs    float64     // 전체 최솟값
    maxMs    float64     // 전체 최댓값
    durs     []time.Duration  // 순환 버퍼
    idx      int              // 다음 쓰기 위치
    maxSamps int              // 버퍼 크기 (기본 1000)
}
```

버퍼가 가득 차면 가장 오래된 샘플을 덮어쓴다:

```go
func (ps *patternStats) record(dur time.Duration) {
    ps.mu.Lock()
    defer ps.mu.Unlock()

    ps.count++
    ms := durationMs(dur)
    ps.totalMs += ms

    if ps.minMs < 0 || ms < ps.minMs {
        ps.minMs = ms
    }
    if ms > ps.maxMs {
        ps.maxMs = ms
    }

    if len(ps.durs) < ps.maxSamps {
        ps.durs = append(ps.durs, dur)
    } else {
        ps.durs[ps.idx] = dur
        ps.idx = (ps.idx + 1) % ps.maxSamps
    }
}
```

**설계 결정**: `count`, `totalMs`, `minMs`, `maxMs`는 전체 수명 동안의 값이다. 순환 버퍼에는 최근 샘플만 있지만, 이 통계는 리셋 없이 정확하다. P50/P99는 최근 샘플 기반이므로 "현재 성능"을 반영한다.

백분위 계산은 정렬 후 인덱스 접근:

```go
func percentile(sorted []time.Duration, p float64) time.Duration {
    idx := int(float64(len(sorted)-1) * p)
    return sorted[idx]
}
```

이 패턴은 `mirror/stats.go`에서 이미 검증된 것을 그대로 가져왔다.

---

## 동시성: RWMutex + Double-Checked Locking

쿼리는 수천 개의 고루틴에서 동시에 들어온다. 패턴 맵 접근에 RWMutex + double-checked locking을 사용한다:

```go
func (d *Digest) Record(query string, dur time.Duration) {
    normalized, err := pg_query.Normalize(query)
    if err != nil {
        normalized = query  // 파싱 실패 시 원본 사용
    }

    // 1차: Read Lock으로 기존 패턴 확인 (대부분 여기서 끝남)
    d.mu.RLock()
    ps, ok := d.patterns[normalized]
    d.mu.RUnlock()

    if !ok {
        // 2차: Write Lock으로 새 패턴 추가
        d.mu.Lock()
        ps, ok = d.patterns[normalized]
        if !ok {
            if len(d.patterns) >= d.maxPatterns {
                d.mu.Unlock()
                return  // 최대 패턴 수 초과 시 드롭
            }
            ps = newPatternStats(d.maxSamples)
            d.patterns[normalized] = ps
        }
        d.mu.Unlock()
    }

    ps.record(dur)
}
```

**왜 이렇게?**
- 대부분의 쿼리는 **이미 존재하는 패턴**이다. RLock만으로 처리된다.
- 새 패턴은 드물다. Write Lock 구간이 짧아 경합이 적다.
- `maxPatterns`로 메모리 상한을 보장한다. 공격적인 쿼리 패턴 폭발을 방지.

---

## 메모리 바운드

프록시는 장기 실행 프로세스다. 메모리가 무한히 늘어나면 안 된다:

| 설정 | 기본값 | 역할 |
|------|--------|------|
| `max_patterns` | 1000 | 추적할 최대 고유 패턴 수 |
| `samples_per_pattern` | 1000 | 패턴별 P50/P99 계산용 샘플 수 |

최대 메모리 = 1000 패턴 x 1000 샘플 x 8 bytes = **~8MB**. 프록시 전체 메모리에서 무시할 수 있는 수준이다.

---

## 쿼리 경로에 삽입

Simple Query Protocol과 Extended Query Protocol 모두에서 기록한다:

```go
// query.go — Simple Query Protocol (line 210)
elapsed := time.Since(start)
s.emitAuditEvent(clientConn, query, target, elapsed, false)
s.recordDigest(query, elapsed)  // ← 추가
s.mirrorQuery(msg, query, qtype, elapsed, parsedQuery)

// query.go — Extended Query Protocol (line 476)
s.emitAuditEvent(clientConn, "(extended query)", target, elapsed, false)
s.recordDigest("(extended query)", elapsed)  // ← 추가
```

`recordDigest`는 nil 체크를 포함한 래퍼다:

```go
func (s *Server) recordDigest(query string, elapsed time.Duration) {
    if s.queryDigest == nil {
        return
    }
    s.queryDigest.Record(query, elapsed)
    if s.metrics != nil {
        s.metrics.DigestPatterns.Set(float64(s.queryDigest.PatternCount()))
    }
}
```

Prometheus Gauge도 함께 업데이트하여, 외부 모니터링에서도 패턴 수를 추적할 수 있다.

---

## Admin API 엔드포인트

두 개의 엔드포인트를 추가했다:

### GET /admin/queries/top

```bash
curl http://localhost:9091/admin/queries/top | jq
```

```json
[
  {
    "query_pattern": "SELECT * FROM users WHERE id = $1",
    "count": 15423,
    "total_ms": 31205.4,
    "avg_ms": 2.02,
    "min_ms": 0.3,
    "max_ms": 150.2,
    "p50_ms": 1.5,
    "p99_ms": 12.3
  },
  {
    "query_pattern": "INSERT INTO logs (msg, created_at) VALUES ($1, $2)",
    "count": 8201,
    "total_ms": 49206.0,
    "avg_ms": 6.0,
    "min_ms": 1.1,
    "max_ms": 500.5,
    "p50_ms": 4.2,
    "p99_ms": 45.0
  }
]
```

실행 횟수 내림차순으로 정렬된 상위 100개 패턴을 반환한다.

### POST /admin/queries/reset

통계를 초기화한다. 배포 후 새로운 기준선을 잡거나, 특정 시간대의 통계만 보고 싶을 때 유용하다.

---

## 설정

```yaml
digest:
  enabled: true
  max_patterns: 1000         # 추적할 최대 고유 패턴 수
  samples_per_pattern: 1000  # 패턴별 P50/P99 계산용 샘플 수
```

`enabled: false`이면 아무것도 하지 않는다. `pg_query.Normalize()` 호출 비용(수 마이크로초)도 발생하지 않는다.

---

## mirror/stats.go와의 관계

Query Mirroring의 `mirror/stats.go`와 Query Digest의 `digest/digest.go`는 구조가 거의 동일하다:

| | mirror/stats.go | digest/digest.go |
|---|---|---|
| 목적 | Primary vs Mirror 레이턴시 비교 | 쿼리 패턴별 실행 통계 |
| 정규화 | `pg_query.Normalize()` | `pg_query.Normalize()` |
| 버퍼 | 순환 버퍼 1000개 | 순환 버퍼 (configurable) |
| 백분위 | P50, P99 | P50, P99 |
| 추가 통계 | 회귀 감지 | avg, min, max, total |
| 메모리 제한 | 없음 | `max_patterns` |

의도적으로 별도 패키지로 분리했다. Mirror의 통계는 Mirror에 종속된 것이고, Digest는 독립적인 관측성 기능이다. 구조가 비슷하다고 합치면 책임이 모호해진다.

---

## 테스트

7개 단위 테스트를 작성했다:

```
=== RUN   TestDigestRecord         — 정규화 + 패턴 그룹핑
=== RUN   TestDigestTopN           — 상위 N개 반환
=== RUN   TestDigestMaxPatterns    — 최대 패턴 수 제한
=== RUN   TestDigestP50P99         — 백분위 정확도
=== RUN   TestDigestReset          — 통계 초기화
=== RUN   TestDigestConcurrency    — 100 고루틴 동시 기록
=== RUN   TestDigestCircularBuffer — 버퍼 초과 시 덮어쓰기
PASS (0.17s)
```

---

## 마무리

Query Digest는 `pg_stat_statements`의 프록시 버전이다. DB에 확장을 설치하지 않아도, 그리고 Multi-DB 환경에서도 모든 쿼리 패턴을 한곳에서 분석할 수 있다.

구현량은 적다 — `digest.go` 200줄, 나머지는 기존 코드에 호출 한 줄씩 추가. 기존 `mirror/stats.go`의 패턴을 재활용했기 때문이다. "비슷한 구조를 다른 목적으로 쓸 때 복사해서 독립 패키지로 만드는 것"이 Go에서는 자연스러운 선택이다.

[GitHub PR #174](https://github.com/jyukki97/pgmux/pull/174)
