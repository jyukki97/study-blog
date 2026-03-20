---
title: "PostgreSQL Autovacuum 튜닝: 느려진 쿼리와 Bloat를 동시에 잡는 법"
date: 2026-02-28
draft: false
topic: "Database"
tags: ["PostgreSQL", "Autovacuum", "VACUUM", "Bloat", "Performance", "MVCC", "Dead Tuple"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL에서 autovacuum이 밀릴 때 생기는 실무 장애 패턴, 튜닝 기준, 트레이드오프와 체크리스트를 정리합니다."
module: "database"
study_order: 530
---

## 이 글에서 얻는 것

- PostgreSQL에서 **왜 테이블이 점점 느려지는지**(dead tuple, bloat) 설명할 수 있습니다.
- MVCC 내부 동작과 **Visibility Map/FSM의 역할**을 이해합니다.
- Autovacuum 기본값을 맹신하지 않고, **워크로드별 튜닝 기준**을 세울 수 있습니다.
- Transaction ID Wraparound와 인덱스 Bloat 같은 **운영 사고를 예방**할 수 있습니다.

---

## 1) 배경: MVCC 내부 구조와 Dead Tuple 발생 메커니즘

### 1-1) MVCC가 만드는 "보이지 않는 쓰레기"

PostgreSQL은 MVCC(Multi-Version Concurrency Control) 구조라서 UPDATE/DELETE 시 이전 버전이 바로 사라지지 않습니다.

```
UPDATE orders SET status = 'shipped' WHERE id = 1;

내부 동작:
┌─────────────────┐     ┌─────────────────┐
│  Tuple v1       │     │  Tuple v2       │
│  status='new'   │     │  status='shipped'│
│  xmin=100       │     │  xmin=200       │
│  xmax=200  ◄────┼─────┤  xmax=0         │
│  (DEAD)         │     │  (LIVE)         │
└─────────────────┘     └─────────────────┘
```

- `xmin`: 이 tuple을 생성한 트랜잭션 ID
- `xmax`: 이 tuple을 삭제/갱신한 트랜잭션 ID (0이면 활성)
- 모든 활성 트랜잭션이 v1을 더 이상 참조하지 않아야 v1이 "dead"로 확정

### 1-2) Heap-Only Tuple(HOT) 최적화

같은 페이지 내에서 업데이트가 일어나고, 인덱스 컬럼이 변경되지 않으면 **HOT update**가 발생합니다.

```sql
-- HOT 발생 조건: 인덱스 컬럼(id) 미변경 + 같은 페이지 내 공간 있음
UPDATE orders SET status = 'delivered' WHERE id = 1;
```

- HOT이 발생하면 인덱스를 갱신하지 않아 **인덱스 bloat가 줄어듦**
- `pg_stat_user_tables.n_tup_hot_upd`로 HOT 비율 확인 가능
- `fillfactor`를 낮추면(예: 80) HOT 확률이 높아지지만, 저장 공간이 늘어남

### 1-3) Visibility Map(VM)과 Free Space Map(FSM)

```
Visibility Map (VM):
Page 0: ALL_VISIBLE ✓  → VACUUM 스킵, Index-Only Scan 가능
Page 1: NOT VISIBLE ✗  → VACUUM 대상
Page 2: ALL_VISIBLE ✓  → VACUUM 스킵
Page 3: ALL_FROZEN  ❄  → Freeze 완료, Wraparound 안전

Free Space Map (FSM):
Page 0: 200 bytes free
Page 1: 4000 bytes free  → INSERT 시 이 페이지 우선
Page 2: 100 bytes free
```

- **VM**: 각 페이지가 "모든 tuple이 모든 트랜잭션에 보이는가"를 추적
- **FSM**: 각 페이지의 여유 공간을 추적 → INSERT 시 재활용
- VACUUM은 dead tuple 제거 후 FSM에 공간 반환 + VM 갱신

---

## 2) Autovacuum 내부 동작과 트리거 조건

### 2-1) Autovacuum 발동 공식

```
VACUUM 발동 조건:
  dead_tuples >= autovacuum_vacuum_threshold
                 + autovacuum_vacuum_scale_factor × n_live_tup

ANALYZE 발동 조건:
  changed_tuples >= autovacuum_analyze_threshold
                    + autovacuum_analyze_scale_factor × n_live_tup
```

**기본값으로 계산해보면:**

| 테이블 크기 (live) | threshold (50) + scale_factor (0.2) × live | 발동 dead 수 |
|-------------------|--------------------------------------------|-------------|
| 1,000행 | 50 + 200 | **250** |
| 100,000행 | 50 + 20,000 | **20,050** |
| 10,000,000행 | 50 + 2,000,000 | **2,000,050** |

> 1천만 행 테이블은 **200만 dead tuple이 쌓여야** autovacuum이 돌기 시작합니다. 이게 문제의 핵심.

### 2-2) Autovacuum Worker의 throttling

```
autovacuum_vacuum_cost_delay = 2ms     -- 기본값
autovacuum_vacuum_cost_limit = 200     -- 기본값 (-1이면 vacuum_cost_limit 사용)

비용 계산:
- 버퍼 캐시에서 읽기: vacuum_cost_page_hit = 1
- 디스크에서 읽기:     vacuum_cost_page_miss = 2  (기본값)
- dirty 페이지:       vacuum_cost_page_dirty = 20

cost_limit 도달 → cost_delay만큼 sleep → 반복
```

이 throttling 때문에 기본값으로는 **대형 테이블의 VACUUM이 매우 느립니다**.

### 2-3) Worker 수와 경합

```
autovacuum_max_workers = 3             -- 기본값
autovacuum_naptime = 60s               -- 체크 주기

-- 3개 worker가 cost_limit을 나눠 씀:
-- worker당 실효 limit = 200 / 3 ≈ 66
```

Worker가 3개인데 큰 테이블 VACUUM이 1개 worker를 오래 점유하면, 나머지 2개로 다른 테이블을 처리해야 합니다.

---

## 3) 실무 기준: Autovacuum 튜닝 시작점

### 3-1) 테이블 크기별 권장 설정

| 테이블 규모 | scale_factor | threshold | 비고 |
|------------|-------------|-----------|------|
| 소형 (< 10만) | 0.2 (기본) | 50 (기본) | 기본값 충분 |
| 중형 (10만~100만) | 0.05 | 500 | dead 5%에 발동 |
| 대형 (100만~1000만) | 0.02 | 1000 | dead 2%에 발동 |
| 초대형 (> 1000만) | 0.01 | 5000 | dead 1%에 발동 |

### 3-2) 테이블 단위 설정 예시

```sql
-- 핫 테이블: 주문 (하루 수백만 UPDATE)
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_threshold = 5000,
    autovacuum_analyze_threshold = 2500,
    -- Worker throttling 완화
    autovacuum_vacuum_cost_delay = 0,        -- sleep 없음 (공격적)
    autovacuum_vacuum_cost_limit = 2000,     -- 기본값의 10배
    -- HOT update 유도
    fillfactor = 80
);

-- 로그/이력 테이블: INSERT만, UPDATE 거의 없음
ALTER TABLE audit_logs SET (
    autovacuum_vacuum_scale_factor = 0.1,    -- 느슨하게
    autovacuum_enabled = true                -- 끄지 마세요
);

-- 파티션 테이블: 개별 파티션에 설정
ALTER TABLE orders_2026_q1 SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_vacuum_threshold = 1000
);
```

### 3-3) 서버 전역 권장 조정

```sql
-- postgresql.conf (서버 레벨)
autovacuum_max_workers = 5               -- 기본 3 → 5 (코어 수 고려)
autovacuum_vacuum_cost_delay = 0         -- 최신 PG에서는 0 권장
autovacuum_vacuum_cost_limit = 800       -- 기본 200 → 800
autovacuum_naptime = 30                  -- 기본 60s → 30s (더 자주 체크)
log_autovacuum_min_duration = 1000       -- 1초 이상 걸린 VACUUM 로깅
```

---

## 4) Transaction ID Wraparound: 가장 위험한 시한폭탄

### 4-1) 왜 위험한가

PostgreSQL의 트랜잭션 ID는 32비트(약 42억). 절반(21억)을 지나면 과거 트랜잭션의 데이터가 "미래"로 보여 **데이터가 사라지는 것처럼** 됩니다.

```
트랜잭션 ID 공간 (원형):
         현재 XID = 2,100,000,000
              │
    ┌─────────┼─────────┐
    │  "과거"  │  "미래"  │
    │(보이는)  │(안 보이는)│
    └─────────┴─────────┘

XID가 wrap하면:
- 과거로 분류되던 튜플이 갑자기 "미래"로 전환
- SELECT 결과에서 데이터가 사라짐
- PostgreSQL은 이를 방지하기 위해 강제 VACUUM 모드 진입
```

### 4-2) Freeze: Wraparound 방지 메커니즘

```sql
-- 현재 Freeze 상태 확인
SELECT
    c.relname,
    c.relfrozenxid,
    age(c.relfrozenxid) AS xid_age,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY age(c.relfrozenxid) DESC
LIMIT 10;
```

| 파라미터 | 기본값 | 의미 |
|---------|--------|------|
| `vacuum_freeze_min_age` | 50,000,000 | 이 나이 이상의 XID를 freeze |
| `vacuum_freeze_table_age` | 150,000,000 | 이 나이가 되면 전체 테이블 scan |
| `autovacuum_freeze_max_age` | 200,000,000 | 이 나이가 되면 **강제 autovacuum** |

### 4-3) Wraparound 경보 설정

```sql
-- age가 1.5억을 넘는 테이블 모니터링
SELECT relname, age(relfrozenxid)
FROM pg_class
WHERE relkind = 'r' AND age(relfrozenxid) > 150000000
ORDER BY age(relfrozenxid) DESC;
```

> **운영 원칙**: `age(relfrozenxid)`가 1.5억을 넘으면 경보, 1.8억이면 즉시 수동 VACUUM FREEZE.

---

## 5) 인덱스 Bloat: 테이블만 정리하면 안 되는 이유

### 5-1) 인덱스 Bloat가 쌓이는 구조

```
B-Tree 인덱스:
┌────────┐
│ Root   │
├────────┤
│ Branch │ → dead pointer가 정리되지 않으면
├────────┤    인덱스 크기만 커지고 검색 경로 증가
│ Leaf   │ → [live][dead][dead][live][dead]...
└────────┘
```

- 테이블 VACUUM은 heap의 dead tuple만 정리
- 인덱스의 dead entry는 별도로 정리해야 함 (VACUUM이 함께 하지만 불완전할 수 있음)
- 특히 **VACUUM이 오래 밀린 후 한 번에 돌면** 인덱스 정리가 불충분

### 5-2) 인덱스 Bloat 측정

```sql
-- pgstattuple 확장 사용
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- 인덱스 bloat 비율 확인
SELECT
    indexrelname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan,
    round(100.0 * avg_leaf_density, 2) AS leaf_density_pct
FROM pg_stat_user_indexes
JOIN pgstatindex(indexrelname) ON true
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 10;

-- 간이 bloat 추정 (pgstattuple 없이)
SELECT
    schemaname, tablename, indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS index_size,
    pg_size_pretty(pg_relation_size(tablename::regclass)) AS table_size,
    round(
        100.0 * pg_relation_size(indexname::regclass) /
        NULLIF(pg_relation_size(tablename::regclass), 0), 1
    ) AS index_table_ratio
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexname::regclass) DESC
LIMIT 10;
```

### 5-3) 인덱스 Bloat 해소 방법

| 방법 | 장점 | 단점 | 적합 상황 |
|------|------|------|----------|
| `REINDEX CONCURRENTLY` | 온라인, 락 최소 | 임시 인덱스 2배 공간 | 운영 중 |
| `CREATE INDEX CONCURRENTLY` + DROP | 완전 온라인 | 수동 작업 | 대형 인덱스 |
| `VACUUM FULL` | 테이블+인덱스 동시 정리 | **AccessExclusiveLock** | 유지보수 윈도우 |
| `pg_repack` | 온라인, 자동화 | 외부 도구 설치 필요 | 대형 테이블 정기 |

```sql
-- 운영 중 안전한 인덱스 재생성
REINDEX INDEX CONCURRENTLY idx_orders_status;

-- 또는 새 인덱스 생성 후 교체
CREATE INDEX CONCURRENTLY idx_orders_status_new ON orders(status);
-- 검증 후
DROP INDEX idx_orders_status;
ALTER INDEX idx_orders_status_new RENAME TO idx_orders_status;
```

---

## 6) 트레이드오프: "청소를 자주" vs "서비스 영향 최소화"

### Autovacuum을 공격적으로 돌리면

- 장점: bloat 누적을 빨리 막음, planner 통계 품질 유지
- 단점: I/O/CPU 사용이 늘어 피크 시간대에 지연 증가 가능

### Autovacuum을 소극적으로 돌리면

- 장점: 단기적으로는 앱 지연이 낮아 보임
- 단점: 장기적으로 bloat가 누적되어 더 큰 장애(쿼리 급격한 악화, wraparound 위험)

> 핵심은 "항상 빠르게"가 아니라, **피크 시간과 비피크 시간을 나눠 정책화**하는 것입니다.

### 시간대별 정책 예시

```sql
-- 방법 1: cron + ALTER SYSTEM으로 시간대별 전환
-- 업무시간 (09:00~18:00): 보수적
ALTER SYSTEM SET autovacuum_vacuum_cost_delay = '2ms';
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 200;
SELECT pg_reload_conf();

-- 야간 (18:00~09:00): 공격적
ALTER SYSTEM SET autovacuum_vacuum_cost_delay = '0';
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 2000;
SELECT pg_reload_conf();
```

---

## 7) 모니터링 쿼리 실전 세트

### 7-1) Dead Tuple 상위 테이블 (일일 점검)

```sql
SELECT
    schemaname, relname,
    n_live_tup, n_dead_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
    last_autovacuum,
    last_autoanalyze,
    autovacuum_count,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC
LIMIT 20;
```

### 7-2) Autovacuum 실행 중인 프로세스 확인

```sql
SELECT
    pid, datname, relid::regclass AS table_name,
    phase, heap_blks_total, heap_blks_scanned, heap_blks_vacuumed,
    index_vacuum_count, max_dead_tuples, num_dead_tuples
FROM pg_stat_progress_vacuum;
```

### 7-3) Long-running 트랜잭션 (VACUUM 방해범)

```sql
-- 오래된 트랜잭션은 dead tuple 정리를 막음
SELECT
    pid, usename, state,
    age(backend_xid) AS xid_age,
    age(backend_xmin) AS xmin_age,
    now() - xact_start AS duration,
    query
FROM pg_stat_activity
WHERE state != 'idle'
  AND backend_xmin IS NOT NULL
ORDER BY age(backend_xmin) DESC
LIMIT 5;
```

> **핵심**: `idle in transaction` 상태의 오래된 세션은 autovacuum이 dead tuple을 정리하지 못하게 하는 **가장 흔한 원인**입니다.

### 7-4) Prometheus/Grafana 메트릭 매핑

| 메트릭 | PromQL 예시 | 경보 기준 |
|--------|------------|----------|
| Dead tuple 비율 | `pg_stat_user_tables_n_dead_tup / (n_live_tup + n_dead_tup)` | > 10% |
| Autovacuum 미실행 시간 | `time() - pg_stat_user_tables_last_autovacuum` | > 24h |
| XID age | `pg_class_relfrozenxid_age` | > 150,000,000 |
| 테이블 크기 증가율 | `rate(pg_total_relation_size[1d])` | 일 10% 이상 |

---

## 8) 자주 하는 실수와 해결

| # | 실수 | 결과 | 해결 |
|---|------|------|------|
| 1 | 전역 파라미터만 만지고 끝내기 | 핫 테이블은 여전히 bloat | 테이블별 설정 분리 |
| 2 | `VACUUM FULL`을 운영 시간에 실행 | AccessExclusiveLock → 서비스 중단 | `pg_repack` 또는 유지보수 윈도우 |
| 3 | `ANALYZE` 무시 | 실행계획 틀어짐 → 갑작스런 성능 저하 | 자동 + 배포 후 수동 ANALYZE |
| 4 | 인덱스 bloat를 테이블 bloat와 분리 안 함 | 테이블 정리해도 느림 | `REINDEX CONCURRENTLY` 병행 |
| 5 | `idle in transaction` 방치 | dead tuple 정리 불가 | `idle_in_transaction_session_timeout` 설정 |
| 6 | autovacuum 끄기 | Wraparound 시한폭탄 | **절대 끄지 마세요** |
| 7 | 파티션 테이블에 상위만 설정 | 개별 파티션에 적용 안 됨 | 파티션별 ALTER TABLE |

---

## 9) 운영 체크리스트 (실무형)

### 일일 점검
- [ ] `pg_stat_user_tables`에서 dead tuple 상위 10 테이블 확인
- [ ] `last_autovacuum`이 24시간 이상 비어 있는 테이블 식별
- [ ] `pg_stat_progress_vacuum`으로 실행 중 VACUUM 상태 확인
- [ ] `idle in transaction` 장시간 세션 확인/종료

### 주간 점검
- [ ] `age(relfrozenxid)` 상위 테이블 XID age 확인
- [ ] 인덱스 bloat 비율 측정 (pgstattuple)
- [ ] HOT update 비율 확인 (`n_tup_hot_upd / n_tup_upd`)
- [ ] `pg_stat_user_tables.autoanalyze_count` 변화 추이

### 배포/대량 변경 시
- [ ] 대량 UPDATE/DELETE 후 수동 `VACUUM ANALYZE` 계획 포함
- [ ] 파티션 추가/삭제 시 개별 autovacuum 설정 확인
- [ ] 스키마 변경 후 통계 갱신 (`ANALYZE`)

### 장애 Runbook: "Autovacuum Backlog 폭증"
1. `pg_stat_progress_vacuum`으로 현재 상태 확인
2. `idle in transaction` 세션 kill (원인 파악 후)
3. 가장 큰 dead tuple 테이블에 수동 `VACUUM (VERBOSE)` 실행
4. cost_limit 임시 상향 → 정리 후 원복
5. XID age 확인 → 1.8억 이상이면 즉시 `VACUUM FREEZE`

---

## 10) 연습 문제

1. 주문 이력 테이블(`orders_history`)이 하루 2천만 건 UPDATE 되는 환경을 가정하고,
   - 기본값 대비 어떤 파라미터를 얼마나 조정할지 제안해보세요.
2. dead tuple 비율이 25% 이상인 테이블 3개를 발견했을 때,
   - 즉시 조치 / 주간 조치 / 구조 개선(파티셔닝, 아카이빙)으로 나눠 액션을 정리해보세요.
3. "autovacuum을 더 세게 돌리니 API P95가 증가"하는 상황에서,
   - 시간대 기반 정책(업무시간/야간)으로 튜닝안을 설계해보세요.
4. XID age가 1.9억인 테이블을 발견했을 때의 긴급 대응 절차를 작성해보세요.

---

## 요약

- PostgreSQL 성능 저하는 단순히 쿼리 문제만이 아니라, **MVCC 청소 지연** 문제일 때가 많습니다.
- Autovacuum 튜닝은 숫자 암기가 아니라, **테이블별 쓰기 패턴 + 운영 시간대**를 반영한 정책 문제입니다.
- **Transaction ID Wraparound**는 "autovacuum 끄면 안 되는" 가장 큰 이유입니다.
- 인덱스 bloat는 테이블 VACUUM만으로 해결되지 않으며 별도 관리가 필요합니다.
- 단기 응급처치(VACUUM)와 장기 구조 개선(파티셔닝/아카이빙)을 함께 가져가야 재발을 막을 수 있습니다.

---

## 🔗 관련 글 / 다음 글

- [SQL 성능 튜닝 Q&A](/learning/qna/sql-performance-tuning-qna/)
- [DB 인덱스 최적화 Q&A](/learning/qna/db-index-optimization-qna/)
- [커넥션 풀링](/learning/deep-dive/deep-dive-connection-pool/) — DB 커넥션 관리와 bloat의 관계
- [DB 복제 & 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/) — 레플리카의 VACUUM 지연
- [트래픽 컷오버/마이그레이션 실전](/learning/deep-dive/deep-dive-traffic-cutover-migration/) — 마이그레이션 시 대량 변경 후 VACUUM 전략
