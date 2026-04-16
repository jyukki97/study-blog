---
title: "Go로 PostgreSQL 프록시 만들기 (3) - 읽기/쓰기 자동 분산"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Load Balancing", "Replication"]
categories: ["Database"]
project: "pgmux"
description: "쿼리를 파싱해서 Writer/Reader로 자동 분산하고, 트랜잭션 추적과 replication lag까지 대응하는 라우팅을 구현한다."
---

## 들어가며

> Primary에 쓰기, Replica에 읽기. 말은 쉬운데, 트랜잭션이랑 replication lag은 어떻게 처리하지?

대부분의 워크로드는 읽기가 80% 이상이다. Replica를 두고 읽기를 분산하면 Primary 부하를 크게 줄일 수 있다. 이번 글에서는 **쿼리를 파싱해서 자동으로 Writer/Reader로 보내는 라우팅**을 구현한다.

## 쿼리 분류: 파서 구현

전문 SQL 파서를 쓸 필요는 없다. **첫 키워드**만 보면 R/W를 구분할 수 있다:

```go
var writeKeywords = map[string]bool{
    "INSERT": true, "UPDATE": true, "DELETE": true,
    "CREATE": true, "ALTER":  true, "DROP":   true,
    "TRUNCATE": true,
}

func Classify(query string) QueryType {
    // 1. 힌트 주석 확인
    if hint := extractHint(query); hint != "" {
        if hint == "writer" { return QueryWrite }
        return QueryRead
    }

    // 2. 첫 키워드로 분류
    keyword := strings.ToUpper(firstWord(stripComments(query)))
    if writeKeywords[keyword] {
        return QueryWrite
    }
    return QueryRead
}
```

### 힌트 주석

때로는 강제로 Writer에서 읽어야 할 때가 있다. 주석으로 힌트를 준다:

```sql
/* route:writer */ SELECT * FROM users WHERE id = 1
```

정규식으로 추출:
```go
var hintRegex = regexp.MustCompile(`/\*\s*route:(writer|reader)\s*\*/`)
```

## 세션 기반 라우팅

쿼리 하나만 보고 라우팅하면 안 된다. **세션 상태**를 추적해야 한다:

```go
type Session struct {
    inTransaction       bool
    lastWriteTime       time.Time
    readAfterWriteDelay time.Duration
}
```

### 트랜잭션 추적

`BEGIN` ~ `COMMIT`/`ROLLBACK` 사이의 모든 쿼리는 **같은 Writer**로 보내야 한다:

```go
func (s *Session) Route(query string) Route {
    upper := strings.ToUpper(strings.TrimSpace(query))

    if strings.HasPrefix(upper, "BEGIN") {
        s.inTransaction = true
        return RouteWriter
    }
    if strings.HasPrefix(upper, "COMMIT") || strings.HasPrefix(upper, "ROLLBACK") {
        s.inTransaction = false
        return RouteWriter
    }

    // 트랜잭션 안에서는 무조건 Writer
    if s.inTransaction {
        return RouteWriter
    }

    // ... R/W 분류 로직
}
```

### Read-After-Write 문제

```
시각 T+0ms: INSERT INTO users (name) VALUES ('alice')  → Writer
시각 T+1ms: SELECT * FROM users WHERE name = 'alice'   → Reader ???
```

Replica는 비동기 복제라 아직 데이터가 없을 수 있다. 해결책: **쓰기 직후 일정 시간은 읽기도 Writer로 보낸다.**

```go
// 쓰기 직후 읽기 → Writer로 전송
if qtype == Read && time.Since(s.lastWriteTime) < s.readAfterWriteDelay {
    return RouteWriter
}
```

`read_after_write_delay`를 500ms로 설정하면, INSERT 후 0.5초 동안은 SELECT도 Writer에서 처리한다.

## 라운드로빈 로드밸런서

Replica가 여러 대면 골고루 분산해야 한다:

```go
type RoundRobin struct {
    backends []*Backend
    index    atomic.Uint64
}

func (r *RoundRobin) Next() string {
    n := len(r.backends)
    for i := 0; i < n; i++ {
        idx := int(r.index.Add(1)-1) % n
        if r.backends[idx].healthy.Load() {
            return r.backends[idx].Addr
        }
    }
    return ""  // 전부 죽었으면 빈 문자열
}
```

`atomic.Uint64`로 카운터를 관리해서 lock-free로 동작한다. 벤치마크 결과 **1.7ns/op**으로 매우 빠르다.

### 장애 감지와 자동 복구

Replica가 죽으면 자동으로 제외하고, 살아나면 복구한다:

```go
func (r *RoundRobin) checkBackends() {
    for _, b := range r.backends {
        if !b.healthy.Load() {
            conn, err := net.DialTimeout("tcp", b.Addr, 2*time.Second)
            if err == nil {
                conn.Close()
                b.healthy.Store(true)  // 복구!
            }
        }
    }
}
```

## 운영에서 자주 터지는 함정 4가지

### 1) `SELECT ... FOR UPDATE`를 Reader로 보내는 실수

첫 키워드가 `SELECT`라는 이유만으로 Reader로 보내면 안 된다. 잠금이 필요한 쿼리는 사실상 Writer 경로여야 한다. 최소 규칙으로는 `FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE` 같은 패턴을 추가로 감지해야 한다.  
이 패턴은 [트랜잭션 풀링(9)](/posts/2026-03-11-pgmux-9-transaction-pooling/)과 같이 쓰일 때 더 중요해진다. 세션 경계가 얇아질수록 쿼리 하나의 라우팅 판단이 정합성을 좌우하기 때문이다.

### 2) read-after-write 지연을 고정값으로만 두는 실수

`500ms` 같은 고정값은 시작점으로는 좋지만, 트래픽/복제 상태에 따라 금방 맞지 않게 된다. 더 현실적인 방식은 **복제 지연(replication lag)을 주기적으로 측정**하고 `readAfterWriteDelay`를 동적으로 올리거나 내리는 것이다.  
예를 들어 lag p95가 420ms를 넘는 구간에서는 800ms로 완화하고, 정상 구간에서는 300ms로 줄이는 식이다.

### 3) 장애 시 fail-open/fail-closed 전략을 안 정하는 실수

Reader 전부 장애일 때 정책을 명시하지 않으면 서비스가 랜덤하게 흔들린다.

- fail-open: Reader 장애 시 읽기를 Writer로 우회 (가용성 우선)
- fail-closed: Reader 장애 시 즉시 에러 (Writer 보호 우선)

B2C 읽기 중심 서비스는 fail-open이 실용적이고, Writer 여유가 낮은 결제/정산 계열은 fail-closed를 검토하는 편이 안전하다. 정책은 코드에 하드코딩하지 말고 설정으로 분리해 두는 게 좋다.

### 4) 라우팅 품질을 로그만으로 확인하는 실수

운영에서는 "분류 정확도"보다 "잘못 보낸 비율"을 봐야 한다. 최소 지표는 다음 3개를 권장한다.

- `rw_router_misroute_total`: 잘못된 라우팅으로 판정된 건수
- `rw_router_reader_fallback_total`: Reader 실패 후 Writer 우회 건수
- `rw_router_raw_guard_hit_total`: write 직후 writer 고정으로 보호된 읽기 건수

이 지표는 [Grafana 대시보드 구축(36)](/posts/2026-03-13-pgmux-36-grafana-dashboard/)에서 별도 패널로 떼어 보는 게 디버깅 속도에 유리하다.

## 의사결정 매트릭스 (실무용)

| 상황 | 권장 라우팅 | 이유 |
| --- | --- | --- |
| 트랜잭션 내부 쿼리 | Writer 고정 | 세션 일관성 유지 |
| 쓰기 직후 동일 엔티티 조회 | Writer 우선 | 복제 지연으로 인한 stale read 방지 |
| 힌트 `/* route:reader */` 지정 | Reader (단, tx 내부 제외) | 운영자가 의도적으로 부하 분산 |
| Reader 1대 이상 장애 | 정상 Reader 우선, 없으면 정책 기반 우회 | 가용성과 Writer 보호 균형 |
| 복제 지연 급증 구간 | Writer 고정 시간 상향 | 장애 전파 차단 |

매트릭스를 문서로만 두지 말고, CI에서 **라우팅 규칙 테스트**로 같이 검증하는 게 좋다. 실제로는 [쿼리 캐싱(4)](/posts/2026-03-11-pgmux-4-query-caching/)과 결합했을 때 stale 데이터 이슈가 더 잘 드러난다.

## 운영 체크리스트

- [ ] `SELECT FOR UPDATE`/잠금 쿼리 패턴이 Writer 규칙에 포함돼 있다.
- [ ] `readAfterWriteDelay`가 고정값이 아니라 lag 기반으로 조정 가능하다.
- [ ] Reader 전체 장애 시 정책(fail-open/fail-closed)이 문서와 설정에 일치한다.
- [ ] 라우팅 품질 지표 3종이 대시보드 + 알람으로 연결돼 있다.
- [ ] 배포 전 리그레이션 테스트에서 tx/힌트/read-after-write 케이스를 자동 검증한다.

## 테스트 케이스

```
# 파서 (19건)
SELECT/INSERT/UPDATE/DELETE → 정확한 분류 ✅
힌트 주석 → 강제 라우팅 ✅
주석 제거 → 정상 분류 ✅

# 세션 라우팅 (4건)
BEGIN → SELECT → COMMIT → SELECT ✅ (tx 안에선 Writer, 밖에선 Reader)
INSERT → 즉시 SELECT → Writer ✅ (read-after-write)
INSERT → 500ms 후 SELECT → Reader ✅ (delay 만료)

# 로드밸런서 (5건)
3대 라운드로빈 → 균등 분산 ✅
1대 장애 → 나머지로 분산 ✅
전부 장애 → 빈 문자열 ✅
장애 후 복구 → 다시 포함 ✅
```

## 마무리

R/W 분산의 핵심은 세 가지다:
1. **쿼리 분류** — 첫 키워드면 충분하다
2. **세션 추적** — 트랜잭션과 read-after-write를 놓치면 데이터 정합성이 깨진다
3. **장애 대응** — 죽은 Replica를 계속 쓰면 안 된다

다음 글에서는 **쿼리 캐싱**을 추가해서, 동일한 SELECT가 반복될 때 DB를 거치지 않고 바로 응답하도록 만든다.
