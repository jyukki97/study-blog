---
title: "Go로 PostgreSQL 프록시 만들기 (23) - 커넥션 풀 오염과 Panic 격리"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Connection Pool", "Panic Recovery", "Protocol Desync", "Bug Fix"]
categories: ["Database"]
project: "pgmux"
description: "pgmux에서 발견된 두 가지 CRITICAL 버그 — 에러 시 오염된 커넥션이 풀에 반납되는 Protocol Desync와, 단일 panic이 전체 서버를 크래시시키는 Global Panic Vulnerability — 를 분석하고 수정한다."
---

## 들어가며

P22에서 COPY 프로토콜 교착과 Map 메모리 누수를 수정한 직후, 코드 리뷰를 통해 두 가지 CRITICAL 버그를 추가로 발견했다.

1. **커넥션 풀 오염(Connection Pool Poisoning)**: 릴레이 에러 발생 시 오염된 백엔드 커넥션이 풀에 그대로 반납되어, 다음 사용자가 Protocol Desync를 겪는다
2. **글로벌 Panic 크래시**: 클라이언트 핸들링 고루틴에 `recover()`가 없어 단일 panic이 전체 프록시 서버를 종료시킨다

이번 글에서는 각 버그의 원인과 수정 과정을 다룬다.

---

## Bug 1: 커넥션 풀 오염 (Protocol Desync)

### 문제 상황

클라이언트가 거대한 쿼리를 실행하던 도중 네트워크 단절 등으로 갑자기 끊어지면, 프록시는 에러를 반환하면서 백엔드 커넥션을 즉시 풀에 반납(`Release`)한다. 하지만 백엔드(PostgreSQL)는 아직 쿼리 결과를 전송 중이므로, 이 '오염된' 커넥션을 다음 사용자가 풀에서 꺼내 쓰는 순간 프로토콜이 완전히 엉켜버린다.

```
시나리오:

1) Client A: SELECT * FROM huge_table (100만 행)
2) Client A 네트워크 단절 → relayAndCollect() 에러 반환
3) 프록시: rPool.Release(rConn) ← 오염된 커넥션을 풀에 반납!
4) Backend: 아직 DataRow를 보내는 중...
5) Client B: SELECT 1 → 풀에서 같은 커넥션 획득
6) Client B가 받는 응답: Client A의 DataRow 잔여 데이터 💥 Protocol Desync!
```

### 코드 분석

문제의 핵심은 `handleReadQueryTraced()`의 캐시 경로였다:

```go
// AS-IS: 에러 여부와 관계없이 무조건 Release
if s.queryCache != nil {
    collected, err := s.relayAndCollect(clientConn, rConn)
    rPool.Release(rConn)  // ← 에러여도 Release!
    if err != nil {
        return fmt.Errorf("relay reader response: %w", err)
    }
    // ...
}
```

같은 함수의 캐시 없는 경로는 올바르게 처리되고 있었다:

```go
// 캐시 없는 경로: 에러 시 Discard, 성공 시 Release ✓
} else {
    if err := s.relayUntilReady(clientConn, rConn); err != nil {
        rPool.Discard(rConn)  // ← 올바름
        return fmt.Errorf("relay reader response: %w", err)
    }
    rPool.Release(rConn)
}
```

같은 패턴이 `pollReaderLSNs()`에서도 발견되었다:

```go
lsn, err := s.queryReplayLSN(conn)
rPool.Release(conn)  // ← 쿼리 실패해도 Release!
if err != nil {
    continue
}
```

### 수정

에러 발생 시 `Release` 대신 `Discard`로 오염된 커넥션을 즉시 폐기한다:

```go
// TO-BE: 에러 시 Discard, 성공 시 Release
if s.queryCache != nil {
    collected, err := s.relayAndCollect(clientConn, rConn)
    execSpan.End()
    if err != nil {
        rPool.Discard(rConn)  // ← 오염된 커넥션 폐기
        if cb, ok := s.getReaderCB(readerAddr); ok {
            cb.RecordFailure()
        }
        return fmt.Errorf("relay reader response: %w", err)
    }
    rPool.Release(rConn)
    // ...
}
```

`pollReaderLSNs()`도 동일하게 수정:

```go
lsn, err := s.queryReplayLSN(conn)
if err != nil {
    rPool.Discard(conn)  // ← 실패 시 폐기
    continue
}
rPool.Release(conn)
```

### Release vs Discard 규칙

이번 버그를 통해 커넥션 풀에서 Release/Discard의 명확한 규칙을 정리할 수 있다:

| 상황 | 행동 | 이유 |
|------|------|------|
| 쿼리 완료, `ReadyForQuery` 수신 | `Release` | 백엔드가 idle 상태임이 보장됨 |
| 릴레이/쿼리 중 에러 발생 | `Discard` | 백엔드 상태를 알 수 없음 (데이터 전송 중일 수 있음) |
| `resetConn()` 실패 | `Discard` | 세션 상태를 초기화하지 못함 |

**핵심 원칙**: `ReadyForQuery('Z')`를 정상적으로 수신한 경우에만 `Release`가 안전하다.

---

## Bug 2: 글로벌 Panic 크래시

### 문제 상황

파싱, 라우팅, 릴레이 로직 어디서든 예상치 못한 panic이 발생하면 프록시 전체 서버가 즉시 종료된다. 프록시에 연결된 모든 클라이언트가 동시에 끊어지는 치명적 장애다.

### 코드 분석

클라이언트를 처리하는 고루틴에 `recover()`가 없었다:

```go
// AS-IS: panic 복구 없음
s.wg.Add(1)
go func() {
    defer s.wg.Done()
    s.handleConn(ctx, conn)  // ← 여기서 panic → 전체 프로세스 crash!
}()
```

Go에서 고루틴 내 panic은 해당 고루틴뿐 아니라 **전체 프로세스**를 종료시킨다. `handleConn` 내부에는 `defer rawConn.Close()`는 있었지만, 이는 panic을 복구하지 않는다.

### 수정

고루틴 최상단에 `defer recover()`를 추가하여, panic 발생 시 해당 클라이언트 연결만 끊고 서버는 계속 동작하도록 격리한다:

```go
// TO-BE: panic 격리 복구
s.wg.Add(1)
go func() {
    defer s.wg.Done()
    defer func() {
        if r := recover(); r != nil {
            slog.Error("panic in client handler, connection isolated",
                "remote", conn.RemoteAddr(),
                "panic", r,
            )
        }
    }()
    s.handleConn(ctx, conn)
}()
```

`recover()` 이후의 동작:

1. panic 정보를 `slog.Error`로 기록 (디버깅용)
2. `defer s.wg.Done()`이 호출되어 graceful shutdown에 영향 없음
3. `handleConn` 내부의 `defer rawConn.Close()`는 실행되지 않지만, goroutine이 종료되면 GC가 커넥션을 정리
4. 다른 클라이언트의 고루틴은 영향 없이 계속 동작

### 왜 이게 필요한가?

프록시는 **다수의 클라이언트를 동시에 처리하는 서버**다. 한 클라이언트의 비정상 데이터로 인한 panic이 다른 모든 클라이언트까지 영향을 미쳐서는 안 된다. 이는 PgBouncer, HAProxy 등 모든 프로덕션 프록시가 따르는 기본 원칙이다.

## 재발 방지 체크리스트

이번 두 버그는 코드 한 줄 실수처럼 보이지만, 실제로는 "에러 경로 설계"와 "고루틴 격리"가 빠졌을 때 어떤 일이 벌어지는지 보여준다. 특히 커넥션 풀 코드는 정상 경로보다 실패 경로가 더 중요하다. 성공 케이스는 테스트가 쉽지만, 중간 끊김과 partial write는 의도적으로 만들지 않으면 계속 빠진다.

- `Release` 호출 지점마다 "바로 직전에 ReadyForQuery를 확인했는가"를 체크한다.
- 네트워크 단절, 타임아웃, client cancel 시나리오를 통합 테스트에 넣는다.
- 외부 입력을 처리하는 고루틴은 시작점에서 `recover()`와 구조화 로그를 둔다.
- 다음 단계 버그 수정인 [Zombie Goroutine과 Dangling Pointer](/posts/2026-03-12-pgmux-24-zombie-goroutine-and-dangling-pointer/)처럼, panic 복구 후에도 리소스 정리가 누락되지 않는지 이어서 본다.

이런 체크리스트를 남겨두면 단일 버그 수정에서 끝나지 않고, 커넥션 풀과 서버 루프 전반에 같은 기준을 반복 적용할 수 있다.

---

## 마무리

두 버그 모두 코드 리뷰에서 놓치기 쉬운 패턴이다:

| 버그 | 패턴 | 교훈 |
|------|------|------|
| 풀 오염 | **에러 경로에서 Discard 대신 Release** | 백엔드 상태를 확신할 수 없으면 반드시 Discard. "의심스러우면 버려라" |
| Panic 크래시 | **고루틴에 recover() 누락** | 외부 입력을 처리하는 고루틴은 반드시 panic을 격리해야 한다. 하나의 장애가 전체를 죽여선 안 된다 |

특히 Release/Discard 패턴은 커넥션 풀을 사용하는 모든 시스템에서 주의해야 한다. 같은 함수 안에서도 캐시 경로와 비캐시 경로가 서로 다르게 처리되어 있었는데, 이런 비일관성이 버그의 근본 원인이었다.
