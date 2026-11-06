---
title: "Go로 PostgreSQL 프록시 만들기 (62) - 릴리스 전 최종 점검: 5개 버그와 품질 개선"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Code Review", "Testing"]
categories: ["Database"]
project: "pgmux"
description: "v1.0.0 릴리스 전 4방향 병렬 코드 리뷰로 발견한 5개 버그(nil dereference, LRU 순서, Redis timeout, DoS 벡터, TLS silent fail)와 품질 개선 사항을 정리한다."
---

## 들어가며

v1.0.0 릴리스를 앞두고 "마지막으로 한 번만 더 보자"는 마음으로 전체 코드를 점검했다. 이번에는 단순 QA가 아니라 **4가지 축**(테스트 완성도, 오픈소스 준비도, 코드 품질, 빌드 건전성)에서 병렬로 리뷰했다.

결과는 Must Fix 5건, Should Fix 5건. 8차에 걸친 QA를 거쳤음에도 여전히 빠져나가는 버그가 있었다. 릴리스 전 최종 점검이 왜 필요한지 다시 한번 확인한 셈이다.

---

## 리뷰 방식: 4방향 병렬 점검

| 축 | 점검 내용 |
|----|-----------|
| **테스트** | 유닛 테스트 커버리지, 누락된 테스트 |
| **오픈소스** | 패키지 doc comment, godoc 품질 |
| **코드 품질** | 잠재 버그, 에러 경로, 리소스 누수 |
| **빌드** | `go build`, `go vet`, 린트 |

4개 축을 독립적인 에이전트에 위임하고 결과를 취합하면 단일 리뷰보다 훨씬 넓은 범위를 볼 수 있다. false positive 필터링까지 포함하면 총 15건 중 10건이 실제 이슈였다.

---

## Must Fix — 5개 버그

### 1. Writer Pool nil dereference

**파일**: `internal/proxy/backend.go` — `fallbackToWriter()`

Reader가 모두 실패했을 때 writer로 폴백하는 경로다. 그런데 writer pool 자체가 nil일 수 있다(설정 오류, pool 생성 실패). nil 체크 없이 `Acquire()`를 호출하면 panic.

```go
// Before: 바로 Acquire → nil이면 panic
wPool := dbg.writerPool
conn, err := wPool.Acquire(ctx)

// After: nil guard 추가
wPool := dbg.writerPool
if wPool == nil {
    s.sendError(clientConn, "no available backend connections")
    return fmt.Errorf("writer pool is nil for fallback")
}
conn, err := wPool.Acquire(ctx)
```

이런 방어적 nil 체크는 "정상 상황에서는 절대 nil이 아니니까"라고 건너뛰기 쉽다. 하지만 프록시는 외부 시스템(DB)에 의존하고, 설정 실수나 네트워크 장애로 pool이 nil이 되는 상황이 실제로 일어난다.

### 2. Synthesizer LRU eviction 순서

**파일**: `internal/proxy/synthesizer.go` — `RegisterStatement()`

Prepared statement synthesizer는 LRU로 오래된 statement를 evict한다. 문제는 **이미 등록된 statement를 다시 등록**할 때 `order` 슬라이스를 갱신하지 않는 것이었다.

```go
// Before: 기존 statement 재등록 시 order 위치 그대로
if _, ok := s.statements[name]; ok {
    s.statements[name] = &PreparedStmt{Query: query, ParamOIDs: paramOIDs}
    return  // order 슬라이스 미갱신!
}

// After: order 끝으로 이동 (LRU 갱신)
if _, ok := s.statements[name]; ok {
    s.statements[name] = &PreparedStmt{Query: query, ParamOIDs: paramOIDs}
    for i, n := range s.order {
        if n == name {
            s.order = append(s.order[:i], s.order[i+1:]...)
            break
        }
    }
    s.order = append(s.order, name)
    return
}
```

LRU 캐시에서 "접근 = 순서 갱신"은 불변 조건이다. 이걸 빠뜨리면 최근에 사용한 statement가 먼저 evict되어 불필요한 re-prepare가 발생한다.

### 3. Redis Ping timeout 미설정

**파일**: `internal/cache/invalidator.go` — `NewInvalidator()`

Redis 연결 확인용 `Ping()`에 timeout이 없었다. Redis가 unreachable이면 프록시 startup이 무한 hang.

```go
// Before: context.Background() → timeout 없음
if err := rdb.Ping(context.Background()).Err(); err != nil {

// After: 5초 timeout
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if err := rdb.Ping(ctx).Err(); err != nil {
```

외부 시스템 호출에는 반드시 timeout을 걸어야 한다. 특히 startup 경로에서 hang이 발생하면 K8s 환경에서 readiness probe 실패 → Pod 재시작 루프로 이어진다.

### 4. Extended Query 버퍼 무제한 (DoS 벡터)

**파일**: `internal/proxy/query.go`

Extended Query Protocol에서 클라이언트는 Parse/Bind/Describe 메시지를 보낸 후 Sync로 일괄 실행을 요청한다. 문제는 Sync 없이 메시지만 무한히 보내면 `extBuf` 슬라이스가 무한 성장한다는 것.

```go
const maxExtBufMessages = 10000

if len(extBuf) >= maxExtBufMessages {
    slog.Warn("extended query buffer limit reached, closing connection",
        "remote", clientConn.RemoteAddr(), "buffered", len(extBuf))
    s.sendError(clientConn, "too many pending extended query messages")
    return
}
```

10,000건이면 일반적인 클라이언트 라이브러리(lib/pq, pgx)가 보내는 것보다 훨씬 여유 있는 값이다. 정상 사용에는 영향 없이 DoS만 차단한다.

### 5. TLS 인증서 로드 실패 시 Silent Degradation

**파일**: `internal/proxy/server.go` — `NewServer()`

TLS를 설정했는데 인증서 파일이 없거나 깨져 있으면? 기존 코드는 로그만 남기고 TLS 없이 계속 실행했다. 운영자는 TLS가 켜져 있다고 생각하지만 실제로는 평문 통신이 되는 상황.

```go
// Before: log + continue → silent degradation
func NewServer(cfg *config.Config) *Server {
    // TLS 로드 실패해도 그냥 진행

// After: fail-fast → 즉시 에러 반환
func NewServer(cfg *config.Config) (*Server, error) {
    if cfg.TLS.Enabled {
        cert, err := tls.LoadX509KeyPair(cfg.TLS.CertFile, cfg.TLS.KeyFile)
        if err != nil {
            return nil, fmt.Errorf("load TLS certificate: %w", err)
        }
        // ...
    }
    return s, nil
}
```

이 변경은 `NewServer` 시그니처를 바꾸는 **breaking change**다. `cmd/pgmux/main.go`와 테스트 파일 5개를 모두 수정했다.

---

## Should Fix — 5개 품질 개선

### 6. CopyBoth 고루틴 무한 block

`relayCopyBoth()`는 양방향으로 COPY 데이터를 릴레이한다. 한쪽이 끝나면 다른 쪽도 끝나야 하는데, peer가 응답하지 않으면 남은 고루틴이 `ReadMessage()`에서 영원히 block된다.

해결: 첫 번째 고루틴 종료 후 양쪽 연결에 30초 read deadline을 설정.

```go
err1 := <-errCh
const drainTimeout = 30 * time.Second
_ = clientConn.SetReadDeadline(time.Now().Add(drainTimeout))
_ = backendConn.SetReadDeadline(time.Now().Add(drainTimeout))
err2 := <-errCh
// deadline 해제
_ = clientConn.SetReadDeadline(time.Time{})
_ = backendConn.SetReadDeadline(time.Time{})
```

`context.Cancel()`은 `net.Conn.Read()`를 인터럽트하지 못한다. `SetReadDeadline`이 유일한 방법이다.

### 7. 패키지 doc comment 추가

15개 `internal/` 패키지에 `// Package <name> ...` 주석을 추가했다. godoc과 `go doc` 출력에서 패키지 설명이 표시된다.

### 8. 유닛 테스트 보강

- **`auth_test.go`**: MD5 해시, auth 핸드셰이크(성공/미등록 사용자/오류 비밀번호) — 5개 함수
- **`helpers_test.go`**: `isSessionModifying` 34개 케이스, `routeName` — 2개 함수

### 9. E2E 테스트 환경 변수화

하드코딩된 `localhost:5433` DSN을 `PGMUX_TEST_PROXY_DSN` 등 6개 환경 변수로 교체. CI/CD 환경에서 포트 충돌 없이 실행 가능.

### 10. False Positive 필터링

처음 리포트에 15건이 올라왔지만 5건은 실제 코드를 확인한 결과 false positive였다:
- Cancel target leak → `sync.Map`로 자동 정리됨
- Nil pool in Reload → 실제 코드에 이미 방어 로직 있음
- LSN ticker leak → `server.Close()`에서 정리됨
- SCRAM validation → nonce 검증 이미 구현됨
- Binary in git → `.gitignore`에 이미 등록됨

자동 리뷰 도구든 사람이든, 보고된 이슈를 맹신하지 말고 반드시 코드로 확인해야 한다.

---

## 결과

| 항목 | 변경 |
|------|------|
| 버그 수정 | 5건 (nil deref, LRU, timeout, DoS, TLS) |
| 품질 개선 | 5건 (CopyBoth, doc comment, 테스트, 환경 변수, false positive 필터) |
| 신규 테스트 | 41개 케이스 (auth 5, helpers 36) |
| 빌드/vet | PASS |

```
$ go build ./...   ✅
$ go vet ./...     ✅
$ go test ./internal/proxy/ -count=1   PASS
```

---

## 마무리

8차에 걸친 QA를 거쳤음에도 nil dereference, LRU 순서 오류, timeout 누락 같은 기본적인 버그가 남아 있었다. "이미 충분히 봤다"는 확신이 가장 위험하다.

특히 인상적이었던 점:
- **TLS silent degradation**: 보안 기능이 조용히 꺼지는 것만큼 위험한 건 없다. fail-fast가 정답이다.
- **Extended Query DoS**: 프로토콜 레벨 버퍼에 제한이 없으면 메모리 한 줄기로 서버가 죽는다.
- **CopyBoth 고루틴**: `context.Cancel()`이 `net.Conn.Read()`를 깨우지 못한다는 건 Go 네트워크 프로그래밍에서 자주 만나는 함정이다.

61편에 걸친 시리즈 중 가장 "릴리스다운" 점검이었다. 이제 진짜 릴리스할 준비가 되었다.
