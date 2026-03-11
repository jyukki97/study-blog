---
title: "Go로 PostgreSQL 프록시 만들기 (2) - 커넥션 풀링 직접 구현"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Connection Pool", "Concurrency"]
categories: ["Database"]
description: "Go의 mutex와 channel을 활용해 커넥션 풀을 직접 구현한다. idle timeout, max lifetime, 헬스체크까지."
---

## 들어가며

> DB 커넥션 하나 만드는 데 TCP 핸드셰이크 + PG 인증까지 수십 ms가 걸린다.
> 요청마다 새 커넥션을 만드는 건 낭비다. 풀링으로 재사용하자.

이전 글에서 PG wire protocol로 기본 프록시를 만들었다. 지금은 클라이언트가 접속할 때마다 백엔드에 새 TCP 연결을 맺는다. 이번에는 **커넥션 풀**을 만들어서 미리 생성해둔 연결을 돌려쓰도록 한다.

## 왜 풀링이 필요한가

```
커넥션 없이: 요청 → TCP 연결(~1ms) → PG 인증(~5ms) → 쿼리(~1ms) → 연결 종료
커넥션 풀링: 요청 → 풀에서 꺼냄(~0.01ms) → 쿼리(~1ms) → 풀에 반환
```

매번 5ms 이상 절약된다. 동시 요청이 많아질수록 효과가 커진다.

## 자료구조 설계

```go
type Pool struct {
    mu      sync.Mutex
    idle    []*Conn          // 유휴 커넥션 슬라이스 (LIFO 스택)
    numOpen int              // 현재 열린 총 커넥션 수
    cfg     Config           // min/max/timeout 설정
    waitCh  chan struct{}    // 풀 가득 찬 경우 대기 시그널
}

type Conn struct {
    net.Conn
    CreatedAt  time.Time    // max_lifetime 판단
    LastUsedAt time.Time    // idle_timeout 판단
}
```

`idle`을 슬라이스로 쓰고 LIFO(Last In, First Out) 방식으로 꺼낸다. 최근에 사용한 커넥션을 먼저 재사용하면 오래된 커넥션이 자연스럽게 idle timeout에 걸려 정리된다.

## Acquire 흐름

```go
func (p *Pool) Acquire(ctx context.Context) (*Conn, error) {
    p.mu.Lock()

    // 1단계: idle에서 유효한 커넥션 꺼내기
    for len(p.idle) > 0 {
        conn := p.idle[len(p.idle)-1]
        p.idle = p.idle[:len(p.idle)-1]

        // 만료 체크
        if conn.expired(p.cfg.MaxLifetime) || conn.idle(p.cfg.IdleTimeout) {
            conn.Close()
            p.numOpen--
            continue
        }

        conn.LastUsedAt = time.Now()
        p.mu.Unlock()
        return conn, nil
    }

    // 2단계: 새 커넥션 생성 가능한가?
    if p.numOpen < p.cfg.MaxConnections {
        p.numOpen++
        p.mu.Unlock()
        return p.newConn()
    }

    p.mu.Unlock()

    // 3단계: 대기 → connection_timeout 초과 시 에러
    select {
    case <-p.waitCh:
        return p.Acquire(ctx)  // 재시도
    case <-time.After(p.cfg.ConnectionTimeout):
        return nil, errors.New("acquire timeout")
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

핵심 포인트:
- **1단계**에서 꺼낼 때 `idle_timeout`과 `max_lifetime`을 체크한다. 만료된 커넥션은 닫고 다음 걸 시도한다.
- **2단계**에서 `numOpen`을 먼저 증가시킨 후 lock을 풀고 커넥션을 생성한다. 생성에 실패하면 `numOpen`을 다시 감소시킨다.
- **3단계**에서 채널 기반 대기를 한다. Release 시 채널에 시그널을 보내면 깨어난다.

## Release

```go
func (p *Pool) Release(conn *Conn) {
    p.mu.Lock()
    defer p.mu.Unlock()

    conn.LastUsedAt = time.Now()
    p.idle = append(p.idle, conn)

    // 대기 중인 goroutine 깨우기
    select {
    case p.waitCh <- struct{}{}:
    default:
    }
}
```

## 헬스체크 고루틴

주기적으로 idle 커넥션을 점검하고, 만료된 것은 제거하고, `min_connections` 미만이면 보충한다:

```go
func (p *Pool) healthCheck() {
    p.mu.Lock()
    defer p.mu.Unlock()

    alive := p.idle[:0]
    for _, c := range p.idle {
        if c.expired(p.cfg.MaxLifetime) || c.idle(p.cfg.IdleTimeout) {
            c.Close()
            p.numOpen--
        } else {
            alive = append(alive, c)
        }
    }
    p.idle = alive

    // min 보충
    for p.numOpen < p.cfg.MinConnections {
        conn, err := p.newConn()
        if err != nil { break }
        p.idle = append(p.idle, conn)
        p.numOpen++
    }
}
```

`alive := p.idle[:0]`은 기존 슬라이스의 backing array를 재사용하면서 길이만 0으로 만드는 Go 관용구다. 새 메모리 할당 없이 필터링할 수 있다.

## Mutex vs Channel

커넥션 풀 구현에서 가장 고민한 부분이다.

| 방식 | 장점 | 단점 |
|------|------|------|
| `sync.Mutex` | 직관적, idle 슬라이스 직접 조작 가능 | 대기 로직이 별도 필요 |
| `chan *Conn` | select로 대기/타임아웃 자연스럽게 처리 | idle 만료 체크가 까다로움 |

최종적으로 **Mutex + 시그널 Channel 조합**을 택했다. idle 관리는 mutex로, 대기는 channel로 각자 장점을 살렸다.

## 테스트 결과

```
TestPool_NewCreatesMinConnections   ✅ min=3으로 설정 → 3개 사전 생성
TestPool_AcquireRelease             ✅ 같은 포인터 반환 (재사용 확인)
TestPool_AcquireTimeout             ✅ max=1, 2번째 Acquire → 타임아웃 에러
TestPool_IdleTimeout                ✅ 50ms 후 → 새 커넥션 생성됨
TestPool_MaxLifetime                ✅ 50ms 후 → 새 커넥션 생성됨
TestPool_HealthCheck                ✅ 만료 제거 후 min까지 보충됨
```

## 마무리

커넥션 풀은 결국 **공유 자원(커넥션들)의 동시성 관리** 문제다. Go의 mutex와 channel을 적절히 조합하면 꽤 깔끔하게 구현할 수 있다.

다음 글에서는 이 풀을 Writer/Reader로 나누고, 쿼리를 파싱해서 **읽기/쓰기를 자동으로 분산**하는 라우팅 로직을 추가한다.
