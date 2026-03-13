---
title: "Go로 PostgreSQL 프록시 만들기 (25) - 2,259줄 God Object 해체기"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Refactoring", "Code Organization", "Maintainability"]
categories: ["Database"]
project: "pgmux"
description: "2,259줄짜리 server.go를 역할별 9개 파일로 분리한 리팩토링 과정 — 왜 쪼개야 했는지, 어떤 기준으로 경계를 나눴는지, Go 패키지 내 파일 분리 전략을 정리한다."
---

## 들어가며

P1부터 P24까지 16개 Phase와 6개 핫픽스를 거치며 pgmux의 핵심 파일인 `internal/proxy/server.go`는 **2,259줄, 50개 함수**로 불어났다. 한 파일에 인증, 쿼리 라우팅, COPY 프로토콜, LSN 폴링, 커넥션 관리, 유틸리티가 전부 들어 있는 전형적인 God Object였다.

"COPY 버그는 어디를 봐야 하지?"라는 질문에 "2,200줄짜리 server.go요"라고 답하는 건 너무 슬프다. 물리적 파일 경계를 명확히 나누기로 했다.

---

## 왜 쪼개야 하는가

Go에서 같은 패키지 내 파일 분리는 **빌드나 런타임에 전혀 영향을 주지 않는다**. 컴파일러는 패키지 단위로 묶어서 처리하기 때문이다. 그럼에도 파일을 나누는 이유는 순수하게 **사람을 위한 것**이다.

1. **탐색 비용 감소** — 2,259줄 스크롤 vs 파일명으로 즉시 점프
2. **PR 리뷰 효율** — COPY 버그 수정이 `copy.go`에만 diff가 생기면 리뷰어가 안심한다
3. **병렬 작업 충돌 감소** — 두 사람이 같은 파일을 동시에 수정할 확률이 줄어든다
4. **인지 부하 감소** — 파일을 열었을 때 300줄 vs 2,200줄의 심리적 차이

---

## 분리 기준: 어떻게 경계를 나눌 것인가

처음에는 기획에서 7개 파일 분리안이 왔다. 검토 후 몇 가지를 조정했다.

### 조정 1: Simple Query / Extended Query 경계

기획안은 `query_simple.go`와 `query_extended.go`로 나누자고 했다. 문제는 `relayQueries()` 함수가 두 프로토콜의 **메인 루프**를 모두 포함한다는 점이다. 이 함수를 쪼개면 루프 상태(`boundWriter`, `extBuf`, `synth`)를 공유하기 위해 별도 구조체가 필요해진다 — 리팩토링 범위를 넘어선다.

결정: `relayQueries()`는 **`query.go`**에 통째로 두고, 그 안에서 호출하는 핸들러만 분리했다.

```
query.go          → relayQueries (메인 루프, 470줄)
query_read.go     → handleReadQuery, handleReadQueryTraced (269줄)
query_extended.go → handleExtendedRead, executeSynthesizedQuery, handleMultiplexDescribe (337줄)
```

### 조정 2: 헬퍼 함수 모으기

`truncateStr`, `routeName`, `parseSize`, `sendError`, `emitAuditEvent` 같은 잡다한 함수가 7개 있었다. 각 파일에 1~2개씩 흩뿌리면 오히려 찾기 어렵다. Go 관례대로 **`helpers.go`** 하나에 모았다.

### 조정 3: backend.go 신설

기획안의 `backend_conn.go`에 커넥션 풀 acquire/release만 넣는 게 아니라, `handleWriteQuery`와 `queryCurrentLSN`도 함께 넣었다. 이 함수들은 모두 **Writer 백엔드와의 상호작용**이라는 공통 맥락을 가진다.

### 최종 파일 구성

| 파일 | 줄 수 | 핵심 함수 |
|------|-------|-----------|
| `server.go` | 542 | Server struct, NewServer, Start, handleConn, Reload |
| `auth.go` | 130 | relayAuth, frontendAuth, authNeedsResponse |
| `query.go` | 470 | relayQueries |
| `query_read.go` | 269 | handleReadQueryTraced, handleReadQuery |
| `query_extended.go` | 337 | handleExtendedRead, executeSynthesizedQuery, handleMultiplexDescribe |
| `copy.go` | 226 | relayCopyIn, relayCopyOut, relayCopyBoth, relayAndCollect |
| `backend.go` | 167 | acquireWriterConn, resetAndReleaseWriter, handleWriteQuery |
| `lsn.go` | 97 | startLSNPolling, pollReaderLSNs, queryReplayLSN |
| `helpers.go` | 132 | sendError, sendReadyForQuery, parseSize, emitAuditEvent |

server.go는 2,259줄에서 **542줄**로, 가장 큰 파일도 470줄로 관리 가능한 수준이 되었다.

---

## 실제 분리 과정

### 1. 함수 목록 추출

```bash
grep '^func ' internal/proxy/server.go
```

50개 함수를 역할별로 태깅하고, 각 함수가 사용하는 import를 매핑했다.

### 2. 파일 생성 → import 정리

Go에서 같은 패키지 내 파일 분리의 장점은 **함수 시그니처를 전혀 변경하지 않아도 된다**는 것이다. `(s *Server)` 메서드는 어느 파일에 있든 동일하게 동작한다.

주의할 점은 **각 파일의 import 블록**이다. 원본 파일은 모든 패키지를 import하고 있었지만, 분리된 각 파일은 자기가 실제로 사용하는 패키지만 import해야 한다. `go build`가 미사용 import를 에러로 잡아주니 안심하고 진행했다.

### 3. 빌드 → 테스트 → vet

```bash
go build ./...                      # 컴파일 확인
go vet ./internal/proxy/...         # 정적 분석
go test ./internal/proxy/... -count=1  # 전체 테스트 통과
```

COPY 테스트, race 테스트, synthesizer 테스트 모두 한 번에 통과했다. 순수 이동이기 때문에 당연한 결과지만, 확인하면 마음이 편하다.

---

## Go 패키지 내 파일 분리 가이드라인

이번 작업을 하면서 정리한 원칙:

1. **파일은 300줄 이하를 목표로** — 500줄 넘으면 분리를 고려한다
2. **파일명은 역할을 드러내야 한다** — `copy.go`를 보고 COPY 프로토콜임을 바로 알 수 있어야 한다
3. **순환 의존은 없다** — 같은 패키지니까 불가능하지만, 논리적 의존 방향은 의식해야 한다. `query.go` → `backend.go` → `copy.go` 순서의 호출 흐름이 자연스럽다
4. **테스트 파일은 피호출 함수를 따라간다** — `copy_test.go`는 `copy.go`의 함수를 테스트하므로 자연스럽게 대응된다
5. **유틸리티는 한 곳에 모은다** — 3줄짜리 헬퍼가 여기저기 흩어지면 오히려 복잡하다

---

## 마무리

2,259줄 God Object를 9개 파일로 분리하는 건 기능 추가가 아니라 **가독성 투자**다. 코드 한 줄 바뀌지 않았지만, 이제 "COPY 버그는 `copy.go`, 인증 문제는 `auth.go`"라고 말할 수 있다.

`ls internal/proxy/` 했을 때 9개의 명확한 파일명을 보는 것과 2,200줄짜리 단일 파일을 보는 것은 심리적으로 완전히 다른 경험이다. 리팩토링은 미래의 나를 위한 투자이기도 하다.
