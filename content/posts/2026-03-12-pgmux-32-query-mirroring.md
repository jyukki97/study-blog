---
title: "Go로 PostgreSQL 프록시 만들기 (32) - Query Mirroring과 레이턴시 비교"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Mirroring", "Shadow Traffic", "Performance"]
categories: ["Database"]
project: "pgmux"
description: "프로덕션 쿼리를 Shadow DB에 비동기 미러링하여 패턴별 P50/P99 레이턴시를 비교하고 성능 회귀를 자동 감지하는 기능을 구현한다. PgBouncer에 없는 pgmux만의 킬러 피처."
---

## 들어가며

pgmux는 커넥션 풀링, R/W 자동 분산, 쿼리 캐싱 등 기본적인 프록시 기능을 갖추고 있지만, PgBouncer 같은 성숙한 도구 대비 "이걸 꼭 써야 하는 이유"가 부족했다. 그래서 PgBouncer가 제공하지 않는 킬러 피처를 고민했고, **Query Mirroring**을 선택했다.

Query Mirroring이란 프로덕션 쿼리를 Shadow DB에 비동기로 전송하여 두 환경의 응답 시간을 비교하는 기법이다. DB 마이그레이션, 인덱스 변경, PostgreSQL 메이저 업그레이드 전에 실제 트래픽으로 성능 영향을 사전 검증할 수 있다.

이번 글에서는 설계 결정, 구현 상세, 테스트 전략을 다룬다.

---

## 왜 Query Mirroring인가

| 시나리오 | 기존 방식 | Query Mirroring |
|----------|-----------|-----------------|
| DB 마이그레이션 | 스테이징에서 합성 쿼리 테스트 | 프로덕션 실제 쿼리로 검증 |
| 인덱스 추가/삭제 | 쿼리 플랜 수동 비교 | 패턴별 P50/P99 자동 비교 |
| PG 메이저 업그레이드 | 다운타임 후 관찰 | 업그레이드 전 실시간 비교 |
| 읽기 스케일링 | 추측 기반 복제본 추가 | 복제본 성능 수치 확인 |

핵심은 **프로덕션 트래픽에 영향 없이** 검증한다는 점이다.

---

## 설계 원칙

### 1. Fire-and-Forget

미러링은 프로덕션 쿼리 경로에 레이턴시를 추가하면 안 된다. `Send()`는 채널에 job을 넣고 즉시 반환한다. 채널이 가득 차면 조용히 드롭한다.

```go
func (m *Mirror) Send(msgType byte, payload []byte, query string, primaryDur time.Duration) {
    payloadCopy := make([]byte, len(payload))
    copy(payloadCopy, payload)

    j := &job{msgType: msgType, payload: payloadCopy, query: query, primaryDur: primaryDur}

    select {
    case m.workCh <- j:
    default:
        m.dropped.Add(1)
    }
}
```

`select-default` 패턴으로 절대 블로킹하지 않는다. payload는 반드시 복사한다 — 원본은 프록시 쿼리 루프에서 재사용되기 때문이다.

### 2. 워커 풀 + 전용 커넥션 풀

워커 고루틴이 채널에서 job을 꺼내 전용 커넥션 풀에서 Shadow DB 커넥션을 획득해 실행한다. 기존 `pool.Pool`을 그대로 재사용했다.

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌───────────┐
│ Query   │────▶│ workCh   │────▶│ Worker   │────▶│ Shadow DB │
│ Loop    │     │ (buffer) │     │ Pool     │     │           │
└─────────┘     └──────────┘     └──────────┘     └───────────┘
                   drop if                acquire
                    full                  /release
```

기본값: 워커 4개, 버퍼 10,000, 커넥션 풀 8개(워커 × 2).

### 3. 테이블 필터와 모드

- **`mode: "read_only"`** (기본) — SELECT만 미러링. Shadow DB에 쓰기를 방지한다.
- **`mode: "all"`** — INSERT/UPDATE/DELETE도 미러링. 쓰기 성능까지 비교할 때.
- **`tables`** — 특정 테이블 관련 쿼리만 미러링. 기존 `extractQueryTablesParsed()`를 활용했다.

```go
func (m *Mirror) MatchesTables(tables []string) bool {
    if m.tables == nil {
        return true // 필터 없으면 모든 테이블 통과
    }
    for _, t := range tables {
        if m.tables[t] {
            return true
        }
    }
    return false
}
```

---

## 레이턴시 비교 엔진

미러링 자체보다 더 가치 있는 건 **패턴별 레이턴시 비교**다.

### 정규화

`pg_query.Normalize()`로 SQL을 정규화한다. 리터럴 값을 `$1`, `$2` 등으로 치환하여 같은 패턴의 쿼리를 그룹핑한다:

```
SELECT * FROM users WHERE id = 42   → SELECT * FROM users WHERE id = $1
SELECT * FROM users WHERE id = 999  → SELECT * FROM users WHERE id = $1
```

### 순환 버퍼

패턴당 최대 1,000개의 샘플을 순환 버퍼에 저장한다. 버퍼가 차면 가장 오래된 샘플을 덮어쓴다.

```go
func (ps *patternStats) record(primaryDur, mirrorDur time.Duration) {
    ps.mu.Lock()
    defer ps.mu.Unlock()
    ps.count++

    if len(ps.primaryDurs) < maxSamples {
        ps.primaryDurs = append(ps.primaryDurs, primaryDur)
        ps.mirrorDurs = append(ps.mirrorDurs, mirrorDur)
    } else {
        ps.primaryDurs[ps.idx] = primaryDur
        ps.mirrorDurs[ps.idx] = mirrorDur
        ps.idx = (ps.idx + 1) % maxSamples
    }
}
```

메모리 사용량을 예측 가능하게 유지한다. 패턴 1,000개 × 샘플 1,000개 × 16바이트 = ~15MB.

### P50/P99와 회귀 감지

스냅샷 시점에 샘플을 정렬해 백분위수를 계산한다:

```go
func percentile(sorted []time.Duration, p float64) time.Duration {
    idx := int(float64(len(sorted)-1) * p)
    return sorted[idx]
}
```

**회귀 기준**: Mirror P50 > Primary P50 × 2이면 해당 패턴을 regression으로 표시한다.

```json
{
  "query_pattern": "SELECT * FROM users WHERE id = $1",
  "count": 15432,
  "primary_p50_ms": 2.3,
  "primary_p99_ms": 12.1,
  "mirror_p50_ms": 8.7,
  "mirror_p99_ms": 45.2,
  "regression": true
}
```

---

## 프록시 통합

기존 코드에 최소한의 변경으로 통합했다.

### query.go — Simple Query 경로

`emitAuditEvent` 직후에 한 줄 추가:

```go
s.mirrorQuery(msg, query, qtype, elapsed, parsedQuery)
```

### helpers.go — mirrorQuery 훅

```go
func (s *Server) mirrorQuery(msg *protocol.Message, query string, qtype router.QueryType, elapsed time.Duration, pq *router.ParsedQuery) {
    if s.mirror == nil {
        return
    }
    if s.mirror.IsReadOnly() && qtype == router.QueryWrite {
        return
    }
    if s.mirror.MatchesTables(s.extractQueryTablesParsed(query, pq)) {
        s.mirror.Send(msg.Type, msg.Payload, query, elapsed)
    }
}
```

nil 체크 → 모드 필터 → 테이블 필터 → 전송. 프로덕션 경로에서 이 함수가 하는 일은 채널에 넣는 것뿐이다.

### server.go — 초기화와 종료

`NewServer()`에서 Mirror 인스턴스를 생성한다. 인증 정보는 `mirror` 설정이 비어있으면 `backend` 설정을 fallback으로 사용한다:

```go
if cfg.Mirror.Enabled {
    mirrorUser := cfg.Mirror.User
    if mirrorUser == "" {
        mirrorUser = cfg.Backend.User
    }
    // ...
    m, err := mirror.New(mirror.Config{
        DialFunc: func() (net.Conn, error) {
            return pgConnect(mirrorAddr, mirrorUser, mirrorPass, mirrorDB)
        },
        // ...
    })
    s.mirror = m
}
```

기존 `pgConnect()`를 DialFunc로 전달하여 MD5/SCRAM 인증을 그대로 활용한다.

### Admin API

`GET /admin/mirror/stats`로 실시간 통계를 조회할 수 있다:

```json
{
  "queries": [...],
  "sent": 15432,
  "dropped": 0,
  "errors": 3
}
```

---

## 설정 예시

```yaml
mirror:
  enabled: true
  host: "shadow-db.internal"
  port: 5432
  mode: "read_only"
  tables: ["users", "orders"]  # 빈 배열이면 모든 테이블
  compare: true
  workers: 4
  buffer_size: 10000
```

`user`, `password`, `database`를 생략하면 `backend` 설정값을 사용한다. Shadow DB가 같은 스키마의 다른 인스턴스라면 설정할 게 거의 없다.

---

## 테스트

### 단위 테스트 (19개)

| 범주 | 테스트 | 검증 대상 |
|------|--------|-----------|
| stats | `TestStatsCollector_Percentiles` | P50/P99 정확도 |
| stats | `TestStatsCollector_RegressionDetection` | 회귀 감지 (mirror > primary × 2) |
| stats | `TestStatsCollector_CircularBuffer` | maxSamples 초과 시 래핑 |
| mirror | `TestSend_BufferFull_DropsJob` | 버퍼 풀 시 드롭 카운트 |
| mirror | `TestSend_CopiesPayload` | payload 독립 복사 |
| mirror | `TestMirror_EndToEnd` | mock PG 서버 기반 풀 E2E |
| mirror | `TestMirror_Close` | 종료 시 타임아웃 없음 |
| admin | 기존 14개 | mirrorStatsFn 파라미터 추가 후 전체 통과 |

mock PG 서버는 TCP 리스너를 띄우고 `'Q'` 메시지를 받으면 `CommandComplete` + `ReadyForQuery`를 반환한다. 실제 PostgreSQL 없이 워커의 acquire→send→read→release 사이클을 검증한다.

---

## PgBouncer와 비교

| 기능 | PgBouncer | pgmux |
|------|-----------|-------|
| Query Mirroring | 불가 | 비동기 미러링 + P50/P99 비교 |
| Prepared Statement Multiplexing | 불가 | Simple Query 합성 |
| 쿼리 캐싱 | 불가 | LRU + 테이블별 무효화 |
| 쿼리 방화벽 | 불가 | AST 기반 위험 쿼리 차단 |
| R/W 자동 라우팅 | 불가 | AST 분류 |
| 커넥션 풀링 | 매우 안정적 | 커버 |
| 프로덕션 실적 | 10년+ | 신규 |

PgBouncer는 **커넥션 풀링에 특화된 전투 검증 도구**다. pgmux는 프록시 레이어에서 할 수 있는 것들을 더 많이 통합한 올인원 도구를 지향한다. Query Mirroring은 그 차별점을 가장 잘 보여주는 기능이다.

---

## 마치며

Query Mirroring은 "프로덕션 트래픽으로 안전하게 테스트한다"는 아이디어의 구현이다. fire-and-forget 패턴으로 프로덕션에 영향을 주지 않으면서도, 패턴별 레이턴시 비교로 의미 있는 데이터를 제공한다.

구현 중 가장 신경 쓴 부분은:
1. **payload 복사** — 프록시 쿼리 루프와 미러 워커가 같은 바이트를 참조하면 data race
2. **select-default 드롭** — 미러링이 프로덕션을 블로킹하면 본말전도
3. **기존 인프라 재사용** — pool.Pool, pgConnect, extractQueryTablesParsed 등 새로 만들 게 거의 없었다

다음 글에서는 이 미러링 데이터를 활용한 실제 마이그레이션 검증 시나리오를 다룰 예정이다.

---

*전체 코드: [GitHub PR #166](https://github.com/jyukki97/pgmux/pull/166)*
