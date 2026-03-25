---
title: "운영 중 스키마 변경 실전: Online DDL + Expand/Contract 패턴"
date: 2026-03-01
draft: false
topic: "Database"
tags: ["Online DDL", "Expand-Contract", "MySQL", "Schema Migration", "Zero Downtime"]
categories: ["Backend Deep Dive"]
description: "서비스를 멈추지 않고 DB 스키마를 변경할 때 필요한 실무 기준, 트레이드오프, 흔한 실수와 점검 루틴을 정리합니다."
module: "database"
study_order: 531
---

## 이 글에서 얻는 것

- 무중단 스키마 변경에서 **왜 Expand/Contract가 표준 패턴인지** 설명할 수 있습니다.
- Online DDL, shadow table(gh-ost/pt-osc) 선택 기준을 **트래픽/테이블 크기/운영 제약** 기준으로 정리할 수 있습니다.
- 실무에서 자주 터지는 실패 패턴(락, 롤백 실패, 앱-DB 버전 불일치)을 미리 피할 수 있습니다.
- **gh-ost/pt-osc 실행 명령어**, 백필 배치 코드, 모니터링 쿼리를 바로 사용할 수 있습니다.
- MySQL 8 **INSTANT DDL 지원 매트릭스**로 도구 선택 시간을 단축할 수 있습니다.

---

## 1) 문제 정의: "ALTER TABLE 한 번"이 왜 장애가 되는가

운영 DB는 개발 DB와 다릅니다.

- 테이블이 수천만~수억 건
- 트래픽이 24시간 지속
- 앱 서버가 롤링 배포 중(구버전/신버전 공존)

이때 단순한 `ALTER TABLE ...`은 메타데이터 락 또는 긴 백그라운드 작업으로
**읽기/쓰기 지연 급증**을 만들 수 있습니다.

### 내부 동작: ALTER TABLE이 실제로 하는 일

```
ALTER TABLE orders ADD COLUMN channel VARCHAR(50);

MySQL 5.6 이전:
  ① 전체 테이블 복사 (새 구조로)
  ② 복사 중 DML 차단 (Table Lock)
  ③ 원본 ↔ 복사본 교체
  → 8억 건 테이블: 수 시간 동안 읽기/쓰기 차단

MySQL 8 Online DDL (INPLACE):
  ① 메타데이터 락 획득 (짧은 시간)
  ② 백그라운드에서 재구성 (DML 허용)
  ③ 메타데이터 락 재획득 → 교체
  → DML은 허용되지만, ①③에서 짧은 차단 발생 가능

MySQL 8 INSTANT:
  ① 메타데이터만 변경 (데이터 파일 안 건드림)
  → 즉시 완료, 테이블 크기 무관
```

핵심은 SQL 문법이 아니라,
**앱 버전 호환성 + 데이터 전환 순서 + 롤백 가능성**입니다.

---

## 2) MySQL 8 INSTANT DDL 지원 매트릭스

도구를 선택하기 전에, **INSTANT로 가능한 작업인지** 먼저 확인하세요.

| 작업 | INSTANT | INPLACE | COPY | 비고 |
|------|---------|---------|------|------|
| **컬럼 추가 (마지막 위치)** | ✅ | ✅ | ✅ | 8.0.12+ |
| **컬럼 추가 (중간 위치)** | ✅ | ✅ | ✅ | 8.0.29+ |
| **컬럼 삭제** | ✅ | ✅ | ✅ | 8.0.29+ |
| **컬럼 순서 변경** | ✅ | ✅ | ✅ | 8.0.29+ |
| **컬럼 RENAME** | ✅ | ✅ | — | 8.0+ |
| **DEFAULT 값 변경** | ✅ | ✅ | — | |
| **VARCHAR 확장 (256 이하→이하)** | ✅ | ✅ | — | 길이 바이트 변경 없을 때 |
| **컬럼 타입 변경** | ❌ | ❌ | ✅ | 테이블 재구성 필요 |
| **인덱스 추가** | ❌ | ✅ | — | DML 허용 |
| **인덱스 삭제** | ❌ | ✅ | — | |
| **PRIMARY KEY 변경** | ❌ | ❌ | ✅ | |
| **PARTITION 변경** | ❌ | ❌ | ✅ | |

### INSTANT DDL 사용 예시

```sql
-- ✅ INSTANT: 즉시 완료, 8억 건 테이블도 밀리초 단위
ALTER TABLE orders ADD COLUMN channel VARCHAR(50) DEFAULT NULL, ALGORITHM=INSTANT;

-- 확인: INSTANT가 가능한지 먼저 체크
ALTER TABLE orders ADD COLUMN channel VARCHAR(50), ALGORITHM=INSTANT;
-- ERROR 0A000: ALGORITHM=INSTANT is not supported → 다른 방법 필요

-- INPLACE로 폴백 (DML 허용, 시간 소요)
ALTER TABLE orders ADD INDEX idx_channel (channel), ALGORITHM=INPLACE, LOCK=NONE;
```

### 의사결정 트리

```
변경이 INSTANT로 가능한가?
├── Yes → INSTANT 사용 (끝)
│
└── No → INPLACE로 가능한가?
         ├── Yes → 테이블 크기와 트래픽 확인
         │         ├── 소규모 (< 1000만 건, 낮은 트래픽) → INPLACE 사용
         │         └── 대규모 (> 1000만 건, 높은 트래픽) → gh-ost/pt-osc 고려
         │
         └── No → 반드시 gh-ost/pt-osc 또는 서비스 레벨 마이그레이션
```

---

## 3) 실무 기준: Expand/Contract 3단계

### 단계 1) Expand (호환 가능한 확장)

- 새 컬럼/새 인덱스/새 테이블을 먼저 추가
- 기존 코드가 깨지지 않게 backward compatible 상태 유지

```sql
-- 배포 1: Expand
ALTER TABLE orders ADD COLUMN channel VARCHAR(50) DEFAULT NULL, ALGORITHM=INSTANT;
-- 기존 코드는 channel 컬럼을 모르지만, 영향 없음 (nullable)
```

```java
// 앱 코드: 신규 컬럼은 아직 Optional
@Column(name = "channel")
private String channel;  // null 허용 → 기존 코드 호환
```

### 단계 2) Migrate (이중 쓰기 + 백필)

앱에서 구/신 스키마를 함께 처리합니다.

```java
// 배포 2: 이중 쓰기 (새 주문은 channel 값 포함)
@Transactional
public Order createOrder(OrderRequest request) {
    Order order = Order.builder()
            .userId(request.getUserId())
            .amount(request.getAmount())
            .channel(request.getChannel())  // ✅ 신규 필드 쓰기 시작
            .build();
    return orderRepository.save(order);
}
```

**백필 배치 (과거 데이터 채우기):**

```java
@Component
@RequiredArgsConstructor
public class ChannelBackfillJob {

    private final JdbcTemplate jdbcTemplate;

    // Spring Batch Step 또는 @Scheduled로 실행
    public void backfill() {
        int batchSize = 5000;
        int totalUpdated = 0;

        while (true) {
            // ✅ 범위 기반 배치 (테이블 스캔 방지)
            int updated = jdbcTemplate.update("""
                UPDATE orders
                SET channel = COALESCE(
                    (SELECT source FROM order_sources WHERE order_sources.order_id = orders.id),
                    'UNKNOWN'
                )
                WHERE channel IS NULL
                AND id BETWEEN ? AND ?
                LIMIT ?
                """,
                getNextBatchStart(), getNextBatchEnd(), batchSize
            );

            totalUpdated += updated;
            log.info("Backfill progress: {} rows updated (total: {})", updated, totalUpdated);

            if (updated == 0) break;

            // ✅ DB 부하 제어: 배치 간 대기
            sleep(Duration.ofMillis(200));
        }

        log.info("Backfill complete: {} total rows updated", totalUpdated);
    }
}
```

**백필 진행률 모니터링 쿼리:**

```sql
-- 전체 진행률
SELECT
    COUNT(*) AS total_rows,
    SUM(CASE WHEN channel IS NOT NULL THEN 1 ELSE 0 END) AS migrated,
    SUM(CASE WHEN channel IS NULL THEN 1 ELSE 0 END) AS remaining,
    ROUND(SUM(CASE WHEN channel IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS progress_pct
FROM orders;

-- 시간별 백필 속도
SELECT
    DATE_FORMAT(updated_at, '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS rows_updated
FROM orders
WHERE channel IS NOT NULL
  AND updated_at >= NOW() - INTERVAL 24 HOUR
GROUP BY 1
ORDER BY 1;
```

### 단계 3) Contract (정리)

신 스키마 100% 전환 확인 후 구 컬럼/구 인덱스를 제거합니다.

```sql
-- 배포 3: Contract (별도 릴리스, 백필 100% 확인 후)
-- ✅ 먼저 NOT NULL 제약 추가
ALTER TABLE orders MODIFY COLUMN channel VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN';

-- ✅ 불필요한 구 컬럼/인덱스 삭제 (INSTANT 가능: 8.0.29+)
ALTER TABLE orders DROP COLUMN old_source, ALGORITHM=INSTANT;
```

> 원칙: **추가(Expand)와 삭제(Contract)를 같은 배포에서 하지 않는다.**

---

## 4) gh-ost 실전 가이드

### 언제 gh-ost를 쓰는가

- INSTANT/INPLACE로 안 되는 변경 (타입 변경, PK 변경 등)
- 대형 테이블 (> 1000만 건)에서 안전한 점진 복사가 필요할 때
- 트리거 없이 binlog 기반으로 동작 → 기존 트리거와 충돌 없음

### 실행 명령어

```bash
# 기본 실행 (dry-run 먼저!)
gh-ost \
  --host=db-primary.internal \
  --port=3306 \
  --user=ghost_user \
  --password='$GHOST_PASSWORD' \
  --database=myapp \
  --table=orders \
  --alter="ADD COLUMN channel VARCHAR(50) DEFAULT NULL" \
  --chunk-size=1000 \
  --max-load='Threads_running=25' \
  --critical-load='Threads_running=50' \
  --nice-ratio=0.5 \
  --initially-drop-ghost-table \
  --initially-drop-old-table \
  --execute  # 없으면 dry-run

# 주요 옵션 설명:
# --chunk-size=1000         : 한 번에 복사할 행 수
# --max-load                : 이 부하 초과 시 속도 자동 조절
# --critical-load           : 이 부하 초과 시 즉시 중단
# --nice-ratio=0.5          : 작업 1초 당 0.5초 대기 (부하 제어)
# --postpone-cut-over-flag  : 이 파일 존재 시 컷오버 보류
```

### gh-ost 실시간 제어 (소켓 인터페이스)

```bash
# 진행 상황 확인
echo "status" | nc -U /tmp/gh-ost.myapp.orders.sock

# 속도 조절 (런타임에 변경 가능!)
echo "chunk-size=500" | nc -U /tmp/gh-ost.myapp.orders.sock
echo "nice-ratio=1.0" | nc -U /tmp/gh-ost.myapp.orders.sock  # 더 느리게

# 일시 중지
echo "throttle" | nc -U /tmp/gh-ost.myapp.orders.sock

# 재개
echo "no-throttle" | nc -U /tmp/gh-ost.myapp.orders.sock

# 컷오버 보류 (안전장치)
touch /tmp/gh-ost.postpone.orders

# 컷오버 실행 (파일 삭제)
rm /tmp/gh-ost.postpone.orders
```

---

## 5) pt-online-schema-change 실전 가이드

### 언제 pt-osc를 쓰는가

- 트리거 기반 동작 (gh-ost와 다름)
- binlog 접근이 어려운 환경 (예: RDS에서 gh-ost 제약)
- Percona Toolkit이 이미 설치된 환경

### 실행 명령어

```bash
# dry-run (변경 없이 시뮬레이션)
pt-online-schema-change \
  --host=db-primary.internal \
  --port=3306 \
  --user=ptosc_user \
  --password='$PTOSC_PASSWORD' \
  D=myapp,t=orders \
  --alter="ADD COLUMN channel VARCHAR(50) DEFAULT NULL" \
  --chunk-size=1000 \
  --max-load="Threads_running:25" \
  --critical-load="Threads_running:50" \
  --chunk-time=0.5 \
  --dry-run

# 실제 실행
pt-online-schema-change \
  D=myapp,t=orders \
  --alter="ADD COLUMN channel VARCHAR(50) DEFAULT NULL" \
  --chunk-size=1000 \
  --max-load="Threads_running:25" \
  --critical-load="Threads_running:50" \
  --chunk-time=0.5 \
  --set-vars="innodb_lock_wait_timeout=5" \
  --no-drop-old-table \
  --execute

# 주요 옵션 설명:
# --chunk-time=0.5          : 각 청크 목표 실행 시간 (초)
# --no-drop-old-table       : 원본 테이블 보존 (롤백 대비)
# --max-lag=1               : 복제 지연 1초 초과 시 대기
# --check-interval=5        : 부하/복제 체크 간격 (초)
```

### gh-ost vs pt-osc 비교

| 특성 | gh-ost | pt-osc |
|------|--------|--------|
| 동기화 방식 | Binlog 스트리밍 | 트리거 (INSERT/UPDATE/DELETE) |
| 기존 트리거 호환 | ✅ 충돌 없음 | ❌ 기존 트리거와 충돌 가능 |
| 런타임 속도 조절 | ✅ 소켓으로 실시간 | ❌ 재실행 필요 |
| 일시 중지/재개 | ✅ | ❌ (abort 후 재시작) |
| 복제 토폴로지 | 직접 binlog 읽기 | 복제 지연 체크 |
| RDS 호환 | ⚠️ binlog 접근 제약 | ✅ 대체로 호환 |
| 성숙도 | GitHub 개발 | Percona 오래된 도구 |

---

## 6) 컬럼 Rename: 가장 위험한 변경

많은 개발자가 간단하다고 생각하지만, **앱-DB 버전 불일치**가 가장 잘 발생하는 케이스입니다.

### 안전한 Rename 절차 (4단계 배포)

```
배포 1: Expand
  ALTER TABLE orders ADD COLUMN account_status VARCHAR(50);
  → 기존 user_status 유지, 새 account_status 추가

배포 2: 이중 쓰기
  앱 코드: user_status와 account_status 둘 다 쓰기
  INSERT INTO orders (..., user_status, account_status)
  VALUES (..., 'ACTIVE', 'ACTIVE');

배포 3: 읽기 전환 + 백필
  백필: UPDATE orders SET account_status = user_status WHERE account_status IS NULL
  앱 코드: 읽기를 account_status로 변경 (user_status는 쓰기만)

배포 4: Contract
  앱 코드: user_status 참조 제거
  ALTER TABLE orders DROP COLUMN user_status;
```

```java
// 배포 2: 이중 쓰기 코드
@Entity
@Table(name = "orders")
public class Order {

    @Column(name = "user_status")
    private String userStatus;

    @Column(name = "account_status")
    private String accountStatus;

    // setter에서 양쪽 모두 업데이트
    public void setAccountStatus(String status) {
        this.accountStatus = status;
        this.userStatus = status;  // 이중 쓰기
    }
}
```

---

## 7) 모니터링: 스키마 변경 중 반드시 확인할 것

### MySQL 모니터링 쿼리

```sql
-- 1. 메타데이터 락 대기 확인 (변경 중 가장 흔한 문제)
SELECT
    waiting.THREAD_ID AS waiting_thread,
    waiting.EVENT_NAME AS waiting_event,
    blocking.THREAD_ID AS blocking_thread,
    blocking.EVENT_NAME AS blocking_event,
    waiting.TIMER_WAIT / 1000000000 AS wait_seconds
FROM performance_schema.metadata_locks AS ml
JOIN performance_schema.events_waits_current AS waiting
    ON ml.OWNER_THREAD_ID = waiting.THREAD_ID
JOIN performance_schema.events_waits_current AS blocking
    ON blocking.THREAD_ID != waiting.THREAD_ID
WHERE waiting.EVENT_NAME LIKE 'wait/lock/metadata%';

-- 2. ALTER TABLE 진행 상황 (MySQL 8)
SELECT
    EVENT_NAME,
    WORK_COMPLETED,
    WORK_ESTIMATED,
    ROUND(WORK_COMPLETED * 100.0 / WORK_ESTIMATED, 1) AS pct_done
FROM performance_schema.events_stages_current
WHERE EVENT_NAME LIKE 'stage/innodb/alter%';

-- 3. 슬로우 쿼리 급증 감지
SELECT
    DIGEST_TEXT,
    COUNT_STAR AS exec_count,
    ROUND(AVG_TIMER_WAIT / 1000000000, 2) AS avg_ms,
    ROUND(MAX_TIMER_WAIT / 1000000000, 2) AS max_ms
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = 'myapp'
  AND AVG_TIMER_WAIT > 1000000000  -- 1초 초과
ORDER BY AVG_TIMER_WAIT DESC
LIMIT 10;

-- 4. InnoDB 행 락 대기
SELECT
    r.trx_id AS waiting_trx,
    r.trx_mysql_thread_id AS waiting_thread,
    r.trx_query AS waiting_query,
    b.trx_id AS blocking_trx,
    b.trx_mysql_thread_id AS blocking_thread,
    b.trx_query AS blocking_query,
    TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_seconds
FROM information_schema.innodb_lock_waits AS w
JOIN information_schema.innodb_trx AS r ON r.trx_id = w.requesting_trx_id
JOIN information_schema.innodb_trx AS b ON b.trx_id = w.blocking_trx_id;

-- 5. 복제 지연 확인 (gh-ost/pt-osc가 자동 체크하지만 수동 확인도 필요)
SHOW REPLICA STATUS\G
-- Seconds_Behind_Source 값 확인
```

### Prometheus/Grafana 알람

```yaml
groups:
  - name: schema_migration
    rules:
      - alert: HighMetadataLockWait
        expr: mysql_global_status_innodb_row_lock_current_waits > 10
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "메타데이터 락 대기 급증 — 스키마 변경 중단 검토"

      - alert: ReplicationLagDuringMigration
        expr: mysql_slave_status_seconds_behind_master > 5
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "복제 지연 {{ $value }}초 — 마이그레이션 속도 조절 필요"

      - alert: SlowQuerySpikeDuringDDL
        expr: rate(mysql_global_status_slow_queries[5m]) > 10
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "슬로우 쿼리 급증 — DDL 영향 확인"
```

---

## 8) 트레이드오프: 안전성 vs 속도

### 비교표

| 전략 | 배포 횟수 | 위험도 | 복구 난이도 | 적합한 경우 |
|------|-----------|--------|-------------|------------|
| 한 번에 ALTER | 1회 | 🔴 높음 | 🔴 어려움 | 소규모 테이블, 점검 시간대 |
| INSTANT DDL | 1회 | 🟢 낮음 | 🟢 쉬움 | 지원되는 변경 유형 |
| Expand/Contract (2단계) | 2~3회 | 🟡 중간 | 🟡 중간 | 일반적인 운영 환경 |
| Expand/Contract (4단계) | 4회 | 🟢 낮음 | 🟢 쉬움 | 핵심 테이블, 높은 트래픽 |
| gh-ost/pt-osc | 1회 (도구) | 🟡 중간 | 🟡 중간 | INSTANT 불가 + 대형 테이블 |

실무에서는 대부분 "빠른 1회성 변경"보다
**작게 나눠서 되돌릴 수 있는 변경**이 이깁니다.

---

## 9) 자주 하는 실수와 방어

| 실수 | 결과 | 방어 |
|------|------|------|
| 컬럼 rename을 즉시 수행 | 구버전 앱 쿼리 실패 | 4단계 Expand/Contract |
| 백필 완료 전에 Contract 실행 | 데이터 유실 | 백필 진행률 100% 확인 쿼리 |
| 롤백 경로를 코드에 준비하지 않음 | DB는 바뀌었는데 앱만 롤백 → 더 위험 | 최소 1배포 주기 구/신 공존 |
| 피크 시간 컷오버 | 작은 락도 큰 장애로 증폭 | 저트래픽 시간대 (새벽 2~5시) |
| INSTANT 가능한데 gh-ost 사용 | 불필요한 복잡성, 시간 낭비 | INSTANT 매트릭스 먼저 확인 |
| 백필 배치에서 전체 테이블 스캔 | DB 과부하, 복제 지연 | PK 범위 기반 + chunk-size 제한 |
| 외래키가 있는 테이블에 gh-ost | 컷오버 실패 | FK 영향 분석 선행, 필요 시 FK 임시 제거 |

---

## 10) 운영 체크리스트

### 변경 전

- [ ] 변경 유형별 INSTANT DDL 지원 여부 사전 확인
- [ ] 대상 테이블 크기 및 현재 트래픽 확인
- [ ] Expand/Contract를 서로 다른 릴리스로 분리
- [ ] 롤백 시나리오(앱 롤백 + DB 호환성) 리허설 완료
- [ ] 컷오버 시간대 결정 (저트래픽 시간)
- [ ] 영향받는 외래키/트리거/뷰 목록 확인

### 변경 중

- [ ] 메타데이터 락 대기 모니터링
- [ ] 복제 지연 모니터링 (Seconds_Behind_Source)
- [ ] 슬로우 쿼리 대시보드 확인
- [ ] gh-ost/pt-osc 진행률 확인
- [ ] 애플리케이션 에러율/레이턴시 확인

### 변경 후

- [ ] 백필 진행률 100% 확인 (remaining = 0)
- [ ] 신규 컬럼/인덱스가 쿼리 플랜에 정상 반영되는지 확인
- [ ] 구 테이블/컬럼 삭제는 별도 릴리스 (최소 1주 후)
- [ ] 구 ghost/old 테이블 정리

### Flyway/Liquibase 통합 원칙

```sql
-- V001__expand_add_channel.sql (Expand)
ALTER TABLE orders ADD COLUMN channel VARCHAR(50) DEFAULT NULL, ALGORITHM=INSTANT;

-- V002__contract_drop_old_source.sql (Contract — 별도 릴리스)
-- ⚠️ 이 마이그레이션은 백필 완료 + 앱 코드 전환 후에만 실행
ALTER TABLE orders DROP COLUMN old_source, ALGORITHM=INSTANT;
```

---

## 11) 연습 문제

1. `orders` 테이블(8억 건)에 `channel` 컬럼을 추가한다고 가정하고,
   - INSTANT DDL vs gh-ost 중 선택 근거를 작성해보세요.
2. `user_status` 컬럼명을 `account_status`로 바꿔야 할 때,
   - Expand/Contract 단계별 배포 계획(앱/DB/모니터링)을 설계해보세요.
3. 백필 중 0.3% 누락이 발견된 상황에서,
   - 즉시 조치 / 배포 보류 / 재검증 절차를 문서화해보세요.
4. gh-ost를 실행 중 복제 지연이 5초를 넘었을 때,
   - 소켓 인터페이스로 어떻게 대응할지 절차를 작성해보세요.

---

## 요약

- 무중단 스키마 변경의 핵심은 SQL 기술보다 **배포 순서와 호환성 설계**입니다.
- **INSTANT DDL 매트릭스를 먼저 확인**하고, 불가능한 경우에만 gh-ost/pt-osc를 사용합니다.
- Online DDL 도구 선택은 "가능 여부"보다 **롤백 가능성/운영 복잡도**까지 포함해 판단해야 합니다.
- Expand/Contract를 습관화하면, 큰 테이블 변경도 안전하게 반복할 수 있습니다.

---

## 🔗 관련 글

- [데이터베이스 마이그레이션: Flyway로 스키마 버전 관리하기](/learning/deep-dive/deep-dive-database-migration/)
- [트래픽 컷오버 & 데이터 마이그레이션 전략](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
- [DB 복제와 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [MySQL 인덱스 + EXPLAIN 분석](/learning/deep-dive/deep-dive-mysql-index-explain/)
- [MySQL 격리 수준과 잠금](/learning/deep-dive/deep-dive-mysql-isolation-locks/)
- [MySQL 성능 튜닝 실전](/learning/deep-dive/deep-dive-mysql-performance-tuning/)
- [Sharding Key 선정과 리샤딩 플레이북](/learning/deep-dive/deep-dive-sharding-key-resharding-playbook/)
- [데이터베이스 잠금 경합 플레이북](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)
- [Legacy Refactoring 전략](/learning/deep-dive/deep-dive-legacy-refactoring-strategy/)
