---
title: "Go로 PostgreSQL 프록시 만들기 (19) - Writer-Only 모드와 진입장벽 낮추기"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Configuration", "DX"]
categories: ["Database"]
project: "pgmux"
description: "readers 설정을 선택사항으로 변경하여 Primary 1대만으로도 풀링+캐싱을 사용할 수 있게 한 과정과, 오픈소스 프로젝트의 사용성에 대한 고민을 다룬다."
---

## 들어가며

pgmux는 PostgreSQL 프록시로 커넥션 풀링, R/W 쿼리 자동 분산, 캐싱 등을 제공한다. 지금까지는 **Primary + Replica 구성**을 전제로 설계했는데, 실제로는 이런 시나리오도 많다:

- 소규모 서비스에서 Primary 1대만 운영
- 개발 환경에서 로컬 PostgreSQL 1대로 테스트
- R/W 분산 없이 풀링 + 캐싱 + 방화벽만 쓰고 싶은 경우

기존에는 `readers`가 최소 1개 필수여서, 이런 사용자는 Reader에 Writer 주소를 중복으로 넣어야 하는 워크어라운드가 필요했다.

---

## 문제 분석

기존 설정 검증 코드:

```go
func (c *Config) validate() error {
    // ...
    if len(c.Readers) == 0 {
        return fmt.Errorf("at least one reader is required")
    }
    // ...
}
```

이 한 줄이 "Primary 1대 + pgmux"라는 가장 단순한 구성을 차단하고 있었다.

### 이미 갖춰진 안전장치

코드를 살펴보니, 사실 **readers가 비어 있어도 안전하게 동작하는 로직이 이미 존재**했다:

1. **Balancer**: `Next()`가 backend이 없으면 빈 문자열을 반환
2. **Server**: `readerAddr == ""`이면 자동으로 writer로 fallback
3. **Circuit Breaker/Health Check**: 빈 슬라이스에 대해 안전하게 no-op

```go
// balancer.go — Next()
if n == 0 {
    return ""  // readers 없으면 빈 문자열
}

// server.go — 읽기 쿼리 처리
if readerAddr == "" {
    slog.Warn("no healthy reader, fallback to writer")
    return s.fallbackToWriter(poolCtx, clientConn, msg)
}
```

즉, validation 한 줄만 제거하면 나머지는 이미 준비되어 있었다.

---

## 변경 사항

### 1. Validation 제거

```go
// Before
if len(c.Readers) == 0 {
    return fmt.Errorf("at least one reader is required")
}

// After — 해당 블록 삭제
// readers 검증은 개별 항목의 host/port만 체크
for i, r := range c.Readers {
    if r.Host == "" {
        return fmt.Errorf("readers[%d].host is required", i)
    }
    // ...
}
```

### 2. 운영 가시성 확보

readers가 없을 때 운영자가 의도한 것인지 실수인지 구분할 수 있도록 로그를 추가했다:

```go
if len(readerAddrs) == 0 {
    slog.Info("no readers configured, all queries routed to writer")
}
```

### 3. 최소 설정 지원

이제 이런 설정으로 바로 시작할 수 있다:

```yaml
proxy:
  listen: "0.0.0.0:5432"
writer:
  host: "localhost"
  port: 5432
backend:
  user: "postgres"
  database: "mydb"
```

R/W 분산 없이 **풀링 + 캐싱 + 방화벽**만 사용하는 최소 구성이다. 나중에 Replica를 추가하면 `readers` 항목만 넣으면 된다.

---

## 설계 판단: enabled 플래그 vs 빈 설정

이 작업을 하면서 "각 기능에 `enabled` 플래그를 둘 것인가?"를 고민했다.

| 접근 | 예시 | 장단점 |
|------|------|--------|
| enabled 플래그 | `routing: { enabled: false }` | 명시적이지만 설정 항목 증가 |
| 빈 설정 = 비활성화 | `readers` 생략 = R/W 분산 없음 | 설정이 간결하고 직관적 |

pgmux는 **빈 설정 = 비활성화** 방식을 택했다. 이미 `cache`, `firewall`, `tls` 등은 `enabled: true/false` 플래그가 있지만, 이들은 "기능의 활성화 여부"를 결정하는 것이고 readers는 "인프라 구성"에 가깝다. Replica가 없으면 R/W 분산 자체가 불가능하므로 설정에서 생략하는 것이 자연스럽다.

---

## 마무리

변경량은 작았다 — validation 3줄 삭제, 로그 2줄 추가, 테스트 수정. 하지만 사용성 관점에서는 "첫 번째 설정 파일을 작성하는 사용자"의 진입장벽을 크게 낮추는 변경이다.

오픈소스 프로젝트에서 **"최소한으로 동작하는 설정"이 얼마나 간단한가**는 채택률에 직접적인 영향을 미친다. PgBouncer가 `pgbouncer.ini` 하나로 시작할 수 있는 것처럼, pgmux도 writer + backend 정보만으로 시작할 수 있게 되었다.

다음 글에서는 추가적인 기능 개선과 운영 경험을 다룰 예정이다.
