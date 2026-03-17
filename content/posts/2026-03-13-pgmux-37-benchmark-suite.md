---
title: "Go로 PostgreSQL 프록시 만들기 (37) - PgBouncer 대비 성능 벤치마크 및 최적화"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Benchmark", "PgBouncer", "Performance"]
categories: ["Database"]
project: "pgmux"
description: "pgbench로 Direct DB, pgmux, PgBouncer를 3자 비교하고, hot path 최적화로 SELECT-only 46%→83%로 개선한다."
---

## 들어가며

오픈소스 프록시를 평가할 때 가장 먼저 묻는 질문: "PgBouncer보다 빠른가?"

솔직히 말하면, Go로 작성한 프록시가 C로 작성된 PgBouncer의 raw throughput을 이기기는 어렵다. 하지만 "얼마나 느린가?"와 "그 대가로 무엇을 얻는가?"를 정량적으로 보여줄 수는 있다.

이번 글에서는 pgbench를 사용한 3자 비교 벤치마크와 hot path 최적화 과정을 다룬다.

---

## 벤치마크 환경

| 항목 | 값 |
|------|-----|
| OS | macOS (Apple M4 Pro, arm64) |
| PostgreSQL | 16.13 (Docker) |
| PgBouncer | latest (transaction mode, pool_size=20) |
| pgmux | pool min=5, max=20, cache=off, firewall=off |
| Data | pgbench scale=10 (1M rows) |
| Tool | pgbench -T 15 |

공정한 비교를 위해 pgmux의 캐싱과 방화벽을 끈 상태에서 측정했다. 순수 프록시 오버헤드만 비교하기 위함이다.

---

## 최적화 전 (Before)

### SELECT-only

| Target | Clients | TPS | vs Direct |
|--------|---------|-----|-----------|
| Direct | 50 | 25,806 | - |
| pgmux | 50 | 11,879 | **46%** |
| PgBouncer | 50 | 25,354 | 98% |

### TPC-B (혼합 읽기/쓰기)

| Target | Clients | TPS | vs Direct |
|--------|---------|-----|-----------|
| Direct | 50 | 3,227 | - |
| pgmux | 50 | 2,345 | **73%** |
| PgBouncer | 50 | 2,707 | 84% |

SELECT-only에서 Direct의 46%밖에 안 나왔다. 무엇이 문제인지 분석했다.

---

## 병목 분석

분석 결과, C vs Go 차이가 아니라 **구현 경로**가 주원인이었다:

### 1. Reader 미설정 → 모든 SELECT가 Writer Fallback

벤치마크 설정에 reader가 없어서 **모든 SELECT가 writer로 fallback**하고, 매번 `DISCARD ALL`을 보냈다. 쿼리당 추가 RTT가 발생한 것이다.

### 2. Wire Protocol 할당/복사

`ReadMessage`에서 매번 `make([]byte)`, `WriteMessage`에서 또 `make([]byte)`. 응답 릴레이(`relayUntilReady`)에서 메시지마다 2번 할당이 발생했다.

### 3. 쿼리 분류 중복

pgmux는 매 쿼리마다:
- `session.Route()` → `Classify()` 호출
- `classifyQueryParsed()` → 또 한 번 호출
- 문자열 파싱, 할당이 2-3번 반복

### 4. Telemetry Span 할당

Telemetry가 꺼져 있어도 noop tracer의 `Start()` 호출 시 attribute 할당 비용이 남았다.

---

## 적용한 최적화

| 최적화 | 변경 |
|--------|------|
| Reader pool 추가 | SELECT가 reader 경로로 직접 처리, DISCARD ALL 불필요 |
| Fallback DISCARD ALL 제거 | 읽기 전용 fallback 시 `releaseWriterFast()` 사용 |
| Query classification 중복 제거 | `session.Route()` 결과에서 qtype 유도, classify 2→1회 |
| `Classify()` fast path | 단순 쿼리는 `splitStatements`/`extractHint` 스킵 |
| `session.Route()` fast path | 단일 문장 쿼리는 `splitStatements` 호출 제거 |
| Telemetry span 조건부 생성 | `cfg.Telemetry.Enabled` false면 span/attribute 할당 안 함 |
| `relayUntilReady` 최적화 | ReadMessage+WriteMessage → 단일 buffer로 직접 전달 |
| `ReadMessage` 최적화 | `binary.Read` (reflection) → 직접 `Uint32` 변환 |
| `indexOf` → `bytes.IndexByte` | SIMD 최적화된 표준 라이브러리 활용 |
| `getConfig()` 호출 캐싱 | 쿼리당 1회만 RLock, 이후 재사용 |

---

## 최적화 후 (After)

### SELECT-only

| Target | Clients | TPS | vs Direct |
|--------|---------|-----|-----------|
| Direct | 50 | 25,533 | - |
| pgmux | 50 | 21,131 | **83%** |
| PgBouncer | 50 | 24,827 | 97% |

### TPC-B (혼합 읽기/쓰기)

| Target | Clients | TPS | vs Direct |
|--------|---------|-----|-----------|
| Direct | 50 | 3,275 | - |
| pgmux | 50 | 2,369 | **72%** |
| PgBouncer | 50 | 2,717 | 83% |

### 10 클라이언트 (pgmux vs PgBouncer 더 가까움)

| Target | Clients | TPS | vs Direct |
|--------|---------|-----|-----------|
| Direct | 10 | 16,933 | - |
| pgmux | 10 | 14,396 | **85%** |
| PgBouncer | 10 | 14,984 | 88% |

**SELECT-only: 46% → 83% (+80% 개선)**. 10 클라이언트에서는 PgBouncer의 96% 수준.

---

## 남은 갭 분석

pgmux(83%)와 PgBouncer(97%) 사이의 14%p 차이는:

1. **SQL-aware proxy 구조적 비용** — pgmux는 단순 forwarder가 아니라 매 쿼리마다 SQL 문자열을 추출하고, 라우팅 판단을 하고, pool acquire/release를 한다. PgBouncer는 트랜잭션 경계만 추적하는 특화 pooler라 이런 비용이 없다.

2. **Wire protocol allocation** — 메시지마다 `make([]byte)` 할당. `sync.Pool` 도입을 고려했으나, Extended Query Protocol에서 메시지를 버퍼에 저장하기 때문에 lifecycle 관리가 복잡하여 보류.

3. **Go 런타임 오버헤드** — goroutine 스케줄러, GC, 스택 관리. 이건 구조적 한계.

---

## 트레이드오프

| | PgBouncer | pgmux |
|---|-----------|-------|
| 언어 | C | Go |
| 프록시 오버헤드 | ~3% | ~17% |
| R/W 자동 라우팅 | X | O |
| 쿼리 캐싱 | X | O |
| 쿼리 방화벽 | X | O |
| Prepared Stmt Multiplexing | X | O |
| Query Mirroring | X | O |
| Audit Logging | X | O |
| Multi-DB Routing | X | O |

벤치마크 조건은 pgmux에 가장 불리한 설정이다. 캐싱, 방화벽, 감사 모두 꺼져 있어서 "기능 이득" 없이 "프록시 tax"만 재는 셈이다. 캐싱을 켜면 반복 쿼리는 직접 연결보다 빠를 수 있다.

---

## 재현 방법

```bash
# 전체 벤치마크 (Docker + pgbench 필요)
make bench-compare

# 커스텀 파라미터
BENCH_CLIENTS="1 10 50 100" BENCH_DURATION=30 make bench-compare
```

---

## 마무리

벤치마크 결과를 공개하는 건 양날의 검이다. "PgBouncer보다 느리네?"라는 반응이 나올 수 있다. 하지만 수치를 숨기면 신뢰를 잃는다. 오히려 "어디서 느리고 왜 느린지 알고 있다"는 게 프로젝트의 성숙도를 보여준다.

hot path 최적화로 SELECT-only 성능을 46%에서 83%로 끌어올렸다. 남은 갭은 SQL-aware proxy의 구조적 비용과 Go 런타임 특성이다. 이건 더 많은 기능(캐싱, 방화벽, 감사 등)을 제공하는 대가로 받아들일 수 있는 수준이다.
