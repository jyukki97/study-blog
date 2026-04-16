---
title: "Go로 PostgreSQL 프록시 만들기 (2) - 커넥션 풀링 직접 구현"
date: 2026-03-11
lastmod: 2026-04-02
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Connection Pool", "Concurrency"]
keywords: ["PostgreSQL 커넥션 풀", "Go 커넥션 풀 구현", "acquire release", "idle timeout", "max lifetime"]
categories: ["Database"]
project: "pgmux"
description: "Go의 mutex와 channel을 조합해 PostgreSQL 프록시용 커넥션 풀을 설계·구현한다. acquire/release 흐름, timeout, 헬스체크, 운영 체크리스트까지 실전 관점으로 정리했다."
---

## 들어가며

> DB 커넥션 하나 만드는 데 TCP 핸드셰이크 + PG 인증까지 수 ms~수십 ms가 걸린다.
> 요청마다 새 커넥션을 만드는 건 결국 지연시간과 DB 부하를 동시에 키우는 선택이다.

[이전 글](/posts/2026-03-11-pgmux-1-pg-wire-protocol/)에서 PG wire protocol로 기본 프록시를 만들었다. 하지만 그 상태에선 클라이언트 요청마다 백엔드 연결을 새로 맺는다. 트래픽이 조금만 올라가도 응답시간 꼬리가 길어지고, 피크 구간에서 DB 인증 부하가 급격히 튄다.

이번 글의 목표는 단순히 "풀을 만들었다"가 아니다.

- **지연시간 절감**: 연결 생성 비용을 요청 경로에서 제거
- **안정성 확보**: 오래되거나 오염된 커넥션을 자동 폐기
- **운영 가능성 강화**: timeout/메트릭/헬스체크로 장애를 관측 가능하게 만들기

즉, 성능 최적화이면서 동시에 운영 안정화 작업이다.

## 왜 풀링이 필요한가

```text
커넥션 없이: 요청 → TCP 연결(~1ms) → PG 인증(~5ms) → 쿼리(~1ms) → 연결 종료
커넥션 풀링: 요청 → 풀에서 꺼냄(~0.01ms) → 쿼리(~1ms) → 풀에 반환
```

요청당 5ms만 줄어도 트래픽이 쌓이면 체감 차이는 매우 크다. 특히 p95/p99 구간은 연결 생성 지연과 인증 지연이 겹치면서 급격히 나빠진다. 풀링은 평균 성능보다 **꼬리 지연(tail latency)** 방어에 더 큰 효과가 있다.

그리고 중요한 점 하나: 풀링은 단순 캐시가 아니라 **동시성 제어 장치**다. DB에 동시에 열 수 있는 연결 수를 상한으로 고정함으로써, 트래픽 급증 시에도 시스템이 무너지는 대신 대기/타임아웃으로 "예측 가능한 실패"를 하게 만든다.

## 설계 원칙

커넥션 풀을 구현할 때 아래 4가지를 먼저 고정했다.

1. **빠른 경로(Fast Path)는 단순하게**
   - idle 커넥션이 있으면 즉시 반환
2. **느린 경로(Slow Path)는 안전하게**
   - 새 연결 생성 실패, 대기 타임아웃, 컨텍스트 취소를 분리 처리
3. **수명 관리 명시화**
   - `idle_timeout`, `max_lifetime`를 강제해 썩은 커넥션 제거
4. **관측 가능성 내장**
   - `open`, `idle`, `acquire_wait`, `acquire_timeout` 메트릭 추적

이 원칙을 잡고 구현하면, 기능이 늘어나도 풀 자체가 점점 불안정해지는 걸 막을 수 있다.

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

`idle`을 LIFO로 사용한 이유는 단순하다. 최근에 성공적으로 쓰인 커넥션을 먼저 재사용하면, 오래 방치된 연결은 뒤로 밀리면서 자연스럽게 timeout 대상이 된다. 구현은 단순해지는데 안정성은 올라간다.

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
- **만료 커넥션은 즉시 폐기**해서 오염/유휴 누적을 막는다.
- `numOpen` 증감은 lock 경계에서 일관되게 관리해야 한다.
- 대기 루프는 무한 재시도가 아니라 **timeout + ctx cancellation**을 같이 둬야 서비스가 멈추지 않는다.

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

`default`를 둔 non-blocking send가 중요하다. 대기자가 없는데 시그널 전송에서 막히면 Release가 병목이 된다.

## 헬스체크 고루틴

주기적으로 idle 커넥션을 점검하고, 만료된 것은 제거하고, `min_connections` 미만이면 보충한다.

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

`alive := p.idle[:0]` 패턴은 메모리 재할당 없이 필터링해서 GC 압력을 줄인다. 작은 최적화지만 장기 운영에서 차이가 난다.

## 운영에서 반드시 넣어야 할 방어장치

코드가 돌아가는 것과 운영에서 버티는 것은 다르다. 풀링에서 특히 자주 터지는 지점을 체크리스트로 정리하면 아래와 같다.

### 1) 커넥션 오염 방지
- 트랜잭션 열린 상태로 반환되지 않게 강제 (`ROLLBACK` 또는 세션 초기화)
- fatal error를 만난 커넥션은 재사용 금지

### 2) 대기열 폭주 방지
- `connection_timeout` 상한을 명확히 둔다
- API 레이어 timeout과 풀 timeout의 우선순위를 맞춘다

### 3) 설정 변경 안전성
- `max_connections` 축소 시 즉시 강제 종료보다 점진적 감소 전략을 택한다
- 리로드 중에도 in-flight 요청은 보존한다

### 4) 관측 지표
- `pool_open`, `pool_idle`, `acquire_wait_ms`, `acquire_timeout_total` 최소 4개는 기본
- 타임아웃이 늘면 DB 느림이 원인인지, 풀 사이즈 부족인지 구분 가능해야 한다

## Mutex vs Channel

| 방식 | 장점 | 단점 |
|------|------|------|
| `sync.Mutex` | 직관적, idle 슬라이스 직접 조작 가능 | 대기 로직이 별도 필요 |
| `chan *Conn` | select로 대기/타임아웃 자연스럽게 처리 | idle 만료 체크/상태 추적이 복잡 |

최종 선택은 **Mutex + 시그널 Channel 조합**이었다. 상태 관리는 mutex로 단단하게, 대기는 channel로 단순하게 가져가면 구현 복잡도와 디버깅 난이도 둘 다 낮출 수 있다.

## 테스트 결과

```text
TestPool_NewCreatesMinConnections   ✅ min=3으로 설정 → 3개 사전 생성
TestPool_AcquireRelease             ✅ 같은 포인터 반환 (재사용 확인)
TestPool_AcquireTimeout             ✅ max=1, 2번째 Acquire → 타임아웃 에러
TestPool_IdleTimeout                ✅ 50ms 후 → 새 커넥션 생성됨
TestPool_MaxLifetime                ✅ 50ms 후 → 새 커넥션 생성됨
TestPool_HealthCheck                ✅ 만료 제거 후 min까지 보충됨
```

여기서 끝내지 않고, 실제로는 "오염된 커넥션 반환", "Acquire 대기 중 context cancel", "연속 리로드 중 동시 Acquire" 같은 운영 시나리오 테스트를 추가하는 게 좋다. 단위 테스트보다 느리지만 장애 예방 효과가 훨씬 크다.

## 관련 글

- 1편: [PG Wire Protocol 이해](/posts/2026-03-11-pgmux-1-pg-wire-protocol/)
- 3편: [읽기/쓰기 자동 분산](/posts/2026-03-11-pgmux-3-rw-routing/)
- 장애 복구 관점 확장: [커넥션 풀 오염과 Panic 격리](/posts/2026-03-12-pgmux-23-pool-poisoning-and-panic-recovery/)

## 마무리

커넥션 풀은 "속도" 기능처럼 보이지만 실은 **자원 상한 제어와 장애 완충 장치**에 가깝다. 제대로 만든 풀은 트래픽이 급증해도 시스템을 깨뜨리지 않고, 문제를 관측 가능한 형태로 드러내 준다.

다음 글에서는 이 풀을 Writer/Reader로 나누고, 쿼리를 파싱해 **읽기/쓰기를 자동 분산**하는 라우팅 로직을 붙인다. 풀링이 기초 체력이라면, 라우팅은 실제 성능과 일관성을 결정하는 경기 운영이다.
