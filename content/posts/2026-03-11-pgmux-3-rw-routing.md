---
title: "Go로 PostgreSQL 프록시 만들기 (3) - 읽기/쓰기 자동 분산"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Load Balancing", "Replication"]
categories: ["Database"]
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
