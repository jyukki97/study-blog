---
title: "Go로 PostgreSQL 프록시 만들기 (57) - v1.0.0 릴리즈 준비"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Release", "Documentation"]
categories: ["Database"]
project: "pgmux"
description: "7차 QA를 마치고 릴리즈 체크리스트를 점검한다. CHANGELOG.md를 작성하고, README와 코드 간 9곳의 불일치를 해소한다."
---

## 들어가며

QA 7차(P56)에서 14건의 버그를 마지막으로 수정했다. 이제 코드 품질 이외의 릴리즈 준비 작업을 정리한다.

전체 코드베이스를 체크한 결과, 코드 밖에서 할 일은 두 가지였다:

1. **CHANGELOG.md가 없다** — 릴리즈 태그 전에 있어야 하는 기본 산출물
2. **README.md가 최근 코드 변경을 반영하지 않는다** — 9곳의 불일치

---

## 릴리즈 체크리스트

| 항목 | 상태 |
|------|------|
| LICENSE (MIT) | OK |
| go.mod (replace 없음, 공개 의존성만) | OK |
| Dockerfile (multi-stage, amd64/arm64) | OK |
| CI/CD (lint, test -race, build, benchmark, Docker publish) | OK |
| .gitignore (바이너리, .env, IDE) | OK |
| Helm Chart (values, templates, NOTES) | OK |
| 하드코딩된 시크릿 | 없음 |
| **CHANGELOG.md** | **MISSING** |
| **README.md 코드 동기화** | **9곳 불일치** |

보안, 의존성, CI 파이프라인은 모두 정상이다. 릴리즈 블로커는 없고, 문서 정리만 남았다.

---

## 1. CHANGELOG.md 작성

[Keep a Changelog](https://keepachangelog.com/) 형식으로 작성했다. v1.0.0은 첫 릴리즈이므로 Added 섹션에 모든 기능을 나열하고, Fixed 섹션에 pre-release QA 수정 내역을 정리했다.

### 구조

```markdown
## [1.0.0] - 2026-03-17

### Added
- Transaction-Level Connection Pooling
- Automatic Read/Write Routing
- AST-Based Query Classification
  - Side-effectful SELECT detection
  - EXPLAIN ANALYZE with write sub-query
  - CTE with write operations
  - Locking clause detection
- Query Caching (LRU + Redis Pub/Sub)
- Prepared Statement Multiplexing
- ...33개 기능

### Fixed (Pre-release QA)
- CopyBoth goroutine race (#247)
- Rate limiter clock skew (#247)
- SQL error message leak (#247)
- Cache stale tableIndex (#247)
- ...16건 수정
```

총 33개 Added 항목, 16개 Fixed 항목이다. 각 Fixed 항목에는 PR 번호를 붙여서 추적 가능하게 했다.

---

## 2. README.md 코드 동기화

9곳의 불일치를 수정했다. 한국어(README.md)와 영어(README_en.md) 양쪽 모두.

### 2.1 쿼리 분류 설명 업데이트

QA 6차에서 MERGE, CALL, COMMENT를 write 분류에 추가했지만 README는 여전히 "INSERT, UPDATE, DELETE, DDL"만 언급하고 있었다.

```diff
- 쓰기 쿼리(INSERT, UPDATE, DELETE, DDL)는 Writer(Primary)로
+ 쓰기 쿼리(INSERT, UPDATE, DELETE, MERGE, CALL, COMMENT, DDL)는 Writer(Primary)로
+ EXPLAIN ANALYZE가 쓰기 쿼리를 포함하면 Writer로 라우팅합니다.
```

### 2.2 ABORT 트랜잭션 키워드

QA 7차에서 `ABORT`를 `ROLLBACK` 동의어로 추가했다.

```diff
- BEGIN ~ COMMIT/ROLLBACK 내부의 모든 쿼리는 Writer로 전송됩니다.
+ BEGIN ~ COMMIT/ROLLBACK/ABORT 내부의 모든 쿼리는 Writer로 전송됩니다.
```

### 2.3 SET CONSTRAINTS 특수 처리

Session Compatibility Guard 설명에 트랜잭션 범위 SET 변형을 명시:

```diff
- LISTEN/UNLISTEN, 세션 SET, DECLARE CURSOR, ...
+ ... SET LOCAL, SET TRANSACTION, SET CONSTRAINTS는 트랜잭션 범위이므로
+ 감지에서 제외됩니다.
```

### 2.4 Data API COPY 제한

기능 설명과 Data API 섹션 양쪽에 추가:

```diff
+ COPY 문은 HTTP 특성상 지원되지 않습니다.
```

### 2.5 TLS 설정 섹션

코드에 `TLSConfig` 구조체(`enabled`, `cert_file`, `key_file`)가 있지만 설정 예시에 빠져있었다:

```yaml
tls:
  enabled: false
  cert_file: "/path/to/server.crt"
  key_file: "/path/to/server.key"
```

### 2.6 config.watch 옵션

`ConfigOptionsConfig.Watch` 필드가 있지만 설정 예시에 없었다:

```yaml
config:
  watch: false  # true: fsnotify로 설정 파일 변경 감시 (hot-reload)
```

---

## 릴리즈 절차

이 PR이 머지되면 남은 절차는:

```bash
git tag -a v1.0.0 -m "Initial release"
git push origin v1.0.0
```

태그 푸시 시 `.github/workflows/release.yml`이 트리거되어:
1. Docker 이미지 빌드 (linux/amd64, linux/arm64)
2. GHCR에 `ghcr.io/jyukki97/pgmux:1.0.0` 퍼블리시
3. GitHub Release 생성

---

## 마무리

P1("PG Wire Protocol 이해")부터 P57("v1.0.0 릴리즈 준비")까지 57편의 시리즈를 쓰는 동안:

- **33개 기능**을 구현하고
- **7차 QA**를 거쳐 50건 이상의 버그를 수정했다

처음 TCP 리스너를 띄우고 PostgreSQL 핸드셰이크를 중계하던 P1에서, 트랜잭션 풀링, AST 쿼리 분류, Prepared Statement Multiplexing, Causal Consistency, Query Mirroring까지 — PgBouncer가 제공하지 못하는 기능들을 Go로 구현할 수 있었다.

이 시리즈는 여기서 마무리하고, 이후 운영 경험이나 새 기능이 추가되면 별도 포스트로 다룰 예정이다.
