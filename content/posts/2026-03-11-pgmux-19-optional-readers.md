---
title: "Go로 PostgreSQL 프록시 만들기 (19) - Writer-Only 모드와 진입장벽 낮추기"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Configuration", "DX"]
categories: ["Database"]
project: "pgmux"
description: "readers 설정을 선택사항으로 변경하여 Primary 1대만으로도 풀링+캐싱을 사용할 수 있게 한 과정과, 오픈소스 프로젝트의 사용성에 대한 고민을 다룬다."
keywords: ["pgmux writer only", "postgres proxy single primary", "postgresql reader optional", "go database proxy dx"]
key_takeaways:
  - "Reader가 없는 구성을 막는 validation 한 줄이 실제 도입 장벽을 만들고 있었다."
  - "이미 존재하던 fallback 로직을 활용하면 writer-only 모드를 별도 분기 없이 안전하게 지원할 수 있다."
  - "최소 실행 가능 설정을 단순하게 만드는 일은 오픈소스 채택률과 첫인상에 직접 영향을 준다."
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

## 운영 관점에서 왜 중요한가

이 변경의 핵심은 기능 추가보다도 **첫 성공 경험의 마찰을 줄인 것**에 있다. 오픈소스 프록시를 처음 써보는 사용자는 보통 로컬 개발 환경이나 작은 스테이징 환경에서 바로 붙여 본다. 이때 "실제로는 필요 없는 설정" 때문에 시작 단계부터 막히면, 사용자는 기능이 부족하다고 느끼기보다 프로젝트 자체가 불친절하다고 느끼기 쉽다.

writer-only 모드를 허용하면 얻는 이점은 생각보다 크다.

- 로컬 PostgreSQL 1대만으로도 커넥션 풀링과 캐시를 바로 실험할 수 있다.
- 운영 전에 최소 구성으로 프록시 레이어를 검증한 뒤, Replica 추가 시 readers만 붙이면 된다.
- 장애 대응 시 일시적으로 Reader를 제거하고 writer-only로 축소 운영하는 전략도 더 단순해진다.

반대로 주의할 점도 있다. 설정이 간단해졌다고 해서 읽기 부하 분산이 자동으로 되는 것은 아니다. 운영자는 로그와 문서에서 "현재는 모든 트래픽이 writer로 간다"는 사실을 분명히 이해해야 한다. 그래서 validation 제거만으로 끝내지 않고, 의도적으로 로그 메시지를 추가해 관측 가능성을 확보한 판단이 중요했다.

## 적용 체크리스트

비슷한 설정 단순화 작업을 할 때는 아래 순서로 보면 실수를 줄일 수 있다.

1. **하위 레이어 fallback 존재 여부 확인**: validation을 지웠을 때 런타임이 정말 안전한가?
2. **운영 로그 추가**: 사용자가 비활성화와 오작동을 헷갈리지 않게 했는가?
3. **문서 예제 축소**: "가장 짧게 동작하는 설정"을 README와 예제에 반영했는가?
4. **확장 경로 점검**: 나중에 Replica를 붙였을 때 기존 설정과 자연스럽게 이어지는가?

이런 기준은 [무중단 리로드](/posts/2026-03-11-pgmux-12-zero-downtime-reload/)처럼 운영성을 다루는 글이나, [보안 하드닝](/posts/2026-03-11-pgmux-8-security-hardening/)처럼 기본값이 중요한 글과도 연결된다. 결국 좋은 기본값은 단순함만이 아니라, **다음 단계로 확장하기 쉬운 구조**까지 포함해야 한다.

---

## 마무리

변경량은 작았다 — validation 3줄 삭제, 로그 2줄 추가, 테스트 수정. 하지만 사용성 관점에서는 "첫 번째 설정 파일을 작성하는 사용자"의 진입장벽을 크게 낮추는 변경이다.

오픈소스 프로젝트에서 **"최소한으로 동작하는 설정"이 얼마나 간단한가**는 채택률에 직접적인 영향을 미친다. PgBouncer가 `pgbouncer.ini` 하나로 시작할 수 있는 것처럼, pgmux도 writer + backend 정보만으로 시작할 수 있게 되었다.

이런 변경은 겉으로 보면 사소하지만, 실제로는 README 첫 예제, 로컬 테스트 성공률, 도입 초반 피드백의 질까지 바꾼다. 사용자가 억지 워크어라운드 없이 시작할 수 있어야 이후의 고급 기능도 평가받을 기회가 생긴다. 그래서 저는 이 작업을 단순한 validation 삭제가 아니라, **프로젝트의 진입 경험을 다시 설계한 수정**으로 보는 편이 맞다고 생각한다.

다음 글에서는 추가적인 기능 개선과 운영 경험을 다룰 예정이다.
