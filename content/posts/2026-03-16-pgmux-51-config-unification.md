---
title: "Go로 PostgreSQL 프록시 만들기 (51) - 설정 이중 구조 청산"
date: 2026-03-16
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Refactoring", "Configuration"]
categories: ["Database"]
project: "pgmux"
description: "릴리스 전 하위호환 부채를 청산한다. top-level writer/readers와 databases 맵의 이중 설정 구조를 databases 단일 포맷으로 통합하고, 합성 shim과 분기 로직을 제거한다."
---

## 들어가며

pgmux는 원래 단일 DB만 지원했다. 설정 파일의 top-level에 `writer`/`readers`/`backend`를 두는 단순한 구조였다:

```yaml
writer:
  host: "primary.db.internal"
  port: 5432
readers:
  - host: "replica-1.db.internal"
    port: 5432
backend:
  user: "postgres"
  password: "postgres"
  database: "mydb"
```

[Multi-Database Routing](/posts/2026-03-14-pgmux-34-multi-database-routing/)을 추가하면서 `databases` 맵이 도입됐다. 기존 사용자의 설정이 깨지지 않도록 두 방식을 공존시켰는데, 그 결과 코드 곳곳에 이중 경로가 생겼다.

아직 릴리스 전이니 하위호환 부채를 깔끔하게 청산한다.

---

## 문제: 이중 경로가 만든 복잡도

### 1. ResolvedDatabases() — 합성 shim

```go
func (c *Config) ResolvedDatabases() map[string]DatabaseConfig {
    if len(c.Databases) > 0 {
        return c.Databases
    }
    // old format → new format 합성
    return map[string]DatabaseConfig{
        c.Backend.Database: {
            Writer:  c.Writer,
            Readers: c.Readers,
            Backend: c.Backend,
            Pool:    c.Pool,
        },
    }
}
```

단일 DB 설정을 `databases` 맵으로 변환하는 어댑터다. 이 함수를 `server.go`, `connlimit.go`, `Reload()` 등 5곳에서 호출하고 있었다. 직접 `cfg.Databases`를 쓰면 되는데 중간에 변환 계층이 끼어있으니 코드를 읽을 때 혼란스럽다.

### 2. validate() — 두 갈래 검증

```go
if len(c.Databases) > 0 {
    // Multi-DB 검증 경로
    for name, db := range c.Databases { ... }
} else {
    // Single-DB 검증 경로
    if c.Writer.Host == "" { return error }
    for i, r := range c.Readers { ... }
}
```

같은 로직이 두 번 작성돼 있다. writer host 필수, port 범위 검증 등 동일한 규칙을 두 경로에서 각각 구현한다.

### 3. Admin API — 응답에 두 포맷 노출

`/admin/config`가 `writer`/`readers` + `databases`를 모두 JSON에 포함했다. 클라이언트 입장에서 어떤 필드를 봐야 하는지 모호했다.

### 4. Mirror — 애매한 fallback

```go
mirrorUser := cfg.Mirror.User
if mirrorUser == "" {
    mirrorUser = cfg.Backend.User  // 어떤 DB의 user?
}
```

Multi-DB 환경에서 `cfg.Backend.User`가 어떤 데이터베이스의 credentials인지 불분명하다.

---

## 해결: databases 단일 포맷으로 통합

### Config struct 정리

```go
type Config struct {
    Proxy   ProxyConfig   `yaml:"proxy"`
    // Writer, Readers 제거
    Pool    PoolConfig    `yaml:"pool"`     // 공유 기본값
    Backend BackendConfig `yaml:"backend"`  // 공유 기본값 (user/password)
    Databases map[string]DatabaseConfig `yaml:"databases"` // 유일한 DB 설정
    // ...
}
```

`Writer`와 `Readers` 필드를 struct에서 완전히 제거했다. `Backend`과 `Pool`은 공유 기본값으로 유지한다 — `databases` 항목에서 미지정 시 상속받는 구조다.

### ResolvedDatabases() 제거

모든 호출처를 `cfg.Databases`로 직접 변경:

```go
// Before
for name, dbCfg := range cfg.ResolvedDatabases() {

// After
for name, dbCfg := range cfg.Databases {
```

`server.go`의 `NewServer()`, `Reload()`, `connlimit.go`의 `NewConnTracker()`, `UpdateLimits()` — 총 4곳.

### validate() 단순화

```go
func (c *Config) validate() error {
    if len(c.Databases) == 0 {
        return fmt.Errorf("databases: at least one database must be configured")
    }
    for name, db := range c.Databases {
        // 단일 경로로 검증
    }
    // ...
}
```

이중 분기가 사라지고, `databases`가 비어있으면 명확한 에러 메시지를 반환한다.

### Mirror fallback 수정

```go
defaultDB := cfg.Databases[cfg.DefaultDatabaseName()]
mirrorUser := cfg.Mirror.User
if mirrorUser == "" {
    mirrorUser = defaultDB.Backend.User  // 명확: default DB의 credentials
}
```

"어떤 DB?"라는 모호함이 사라졌다.

### Admin API 응답 정리

```go
safe := struct {
    Proxy     config.ProxyConfig              `json:"proxy"`
    // Writer, Readers, Backend 제거
    Databases map[string]safeDBConfig         `json:"databases"`
    // ...
}{}
```

---

## 새 설정 포맷

```yaml
proxy:
  listen: "0.0.0.0:5432"

backend:                    # 공유 기본값
  user: "postgres"
  password: "postgres"

pool:                       # 공유 기본값
  max_connections: 50

databases:
  mydb:
    writer:
      host: "primary.db.internal"
      port: 5432
    readers:
      - host: "replica-1.db.internal"
        port: 5432
    backend:
      database: "mydb"     # user/password는 top-level에서 상속
```

단일 DB라도 `databases` 아래 1개 엔트리를 작성한다. 기존보다 들여쓰기가 한 레벨 깊어지지만, Multi-DB 확장 시 설정 마이그레이션이 필요 없다.

---

## 변경 범위

| 영역 | 변경 |
|------|------|
| `config.go` | `Writer`/`Readers` 필드 제거, `ResolvedDatabases()` 삭제, `validate()` 단일 경로 |
| `server.go` | `cfg.Databases` 직접 사용, Mirror fallback을 default DB에서 해결 |
| `connlimit.go` | `cfg.Databases` 직접 사용 |
| `admin.go` | `handleConfig` 응답에서 old format 제거 |
| 테스트 8개 | 모든 config literal을 databases 포맷으로 전환 |
| config.yaml 등 | databases 포맷으로 전환 |
| README 2개 | 설정 예시 업데이트, 하위호환 문구 제거 |

---

## 마무리

릴리스 전이라서 가능한 정리였다. 하위호환이 필요했다면 deprecation warning → migration period → removal의 3단계를 거쳐야 했을 것이다.

이번 리팩토링의 핵심은 **같은 의미의 코드가 두 경로로 존재하면 버그도 두 배**라는 것이다. `ResolvedDatabases()` 같은 어댑터는 도입 시점에는 편리하지만, 호출처가 늘어날수록 "이게 원본이야 변환이야?"라는 혼란을 키운다. 릴리스 전에 청산할 수 있어서 다행이다.
