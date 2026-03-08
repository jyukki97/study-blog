---
title: "DB 복제 & 읽기/쓰기 분리: Replication, Lag, Failover 실전"
date: 2026-02-12
draft: false
topic: "Database"
tags: ["Database", "Replication", "Read Replica", "Failover", "High Availability"]
categories: ["Backend Deep Dive"]
description: "복제 구조의 원리(Primary/Replica), 복제 지연(Lag) 대응, 읽기/쓰기 분리 라우팅과 장애 전환 기준"
module: "data-system"
study_order: 260
---

## 이 글에서 얻는 것

- Primary/Replica 복제 구조가 **왜 빠르고 위험한지**를 이해합니다.
- 복제 지연(Lag) 때문에 발생하는 **읽기 불일치**를 설계로 막을 수 있습니다.
- 읽기/쓰기 분리 라우팅과 **Failover 기준**을 실무 관점으로 정리합니다.
- MySQL과 PostgreSQL의 복제 차이를 비교하고, 모니터링 메트릭을 구성할 수 있습니다.

---

## 1) 복제(Replication) 기본 구조

```
Client
  ├─ Write → Primary
  └─ Read  → Replica (1..N)
```

- **Primary**: 쓰기/변경 트랜잭션 담당
- **Replica**: Primary의 로그를 복제 받아 읽기 처리

복제는 결국 **쓰기 로그(바이너리 로그/WAL)** 를 replica가 적용하는 구조입니다. 빠르지만, **항상 지연**이 존재합니다.

### 복제 방식 비교

| 방식 | 작동 원리 | 장점 | 단점 |
|:---|:---|:---|:---|
| **비동기(Async)** | Primary가 커밋 후 로그를 Replica에 전송 | 쓰기 성능 최대, 구성 단순 | Lag 발생, Primary 장애 시 데이터 유실 가능(RPO > 0) |
| **반동기(Semi-sync)** | 최소 1개 Replica ACK를 받은 후 커밋 완료 | 데이터 유실 최소화(RPO ≈ 0) | 쓰기 지연 증가(네트워크 RTT만큼) |
| **동기(Sync)** | 모든 Replica 적용 완료까지 커밋 대기 | 완전한 정합성 | 쓰기 성능 크게 저하, 실무에서 거의 사용 안 함 |

**실무 선택 기준:**
- 일반 서비스(주문/게시판): 비동기 + 모니터링이면 충분
- 금융/결제처럼 유실이 치명적: 반동기(Semi-sync)
- 글로벌 분산(Multi-region): 비동기 + 애플리케이션 레벨 보상 트랜잭션

---

## 2) 복제 지연(Lag)이 만드는 문제

### 증상
- 방금 만든 주문이 **조회 API에서 안 보임**
- 결제 직후 결제 상태가 **PENDING**으로 남음
- 관리자 페이지에서 방금 수정한 설정이 반영 안 됨

### 원인
- Replica가 Primary의 변경을 **아직 반영하지 못함**

### Lag이 커지는 대표 원인들
1. **대량 DML**: `UPDATE ... WHERE status = 'old'` 같은 대량 변경은 replica에서도 순차 적용
2. **DDL 실행**: `ALTER TABLE`이 테이블 락을 잡으면 후속 복제가 밀림
3. **Replica 자원 부족**: CPU/IO가 Primary보다 낮은 스펙이면 처리 속도가 뒤처짐
4. **네트워크 지연**: Cross-AZ/Cross-Region 복제 시 물리적 RTT

### 해결 전략 (실무 기준)

**1. Read-After-Write 보장 구간**
쓰기 직후 N초 동안은 Primary 읽기를 강제합니다.

```java
// 쓰기 시점 기록
@Transactional
public Order createOrder(OrderCommand cmd) {
    Order order = orderRepository.save(cmd.toEntity());
    // 세션/쿠키에 "최근 쓰기 시각" 기록
    ReadAfterWriteContext.markWriteTime();
    return order;
}

// 읽기 시 판단
public DataSource resolveDataSource(boolean readOnly) {
    if (readOnly && ReadAfterWriteContext.isWithinWriteWindow(Duration.ofSeconds(3))) {
        return primaryDataSource; // 3초 이내면 Primary에서 읽기
    }
    return readOnly ? replicaDataSource : primaryDataSource;
}
```

**2. 세션/요청 스코프 고정**
특정 트랜잭션/요청은 Primary 고정합니다. 특히 "쓰기 → 바로 결과 확인" 시나리오에 적합합니다.

**3. Lag 기반 라우팅**
Replica의 lag가 임계치 이상이면 읽기를 차단하거나 Primary로 폴백합니다.

```java
// ProxySQL/MaxScale 등 미들웨어에서 설정 가능
// 또는 애플리케이션에서 주기적 lag 체크
@Scheduled(fixedRate = 1000)
public void checkReplicaLag() {
    int lagSeconds = replicaJdbc.queryForObject(
        "SHOW REPLICA STATUS", /* Seconds_Behind_Source */);
    replicaHealthy = lagSeconds < LAG_THRESHOLD_SECONDS;
}
```

---

## 3) MySQL vs PostgreSQL 복제 비교

### MySQL 복제 (Binary Log 기반)

```
Primary: binlog 기록 → Replica: IO Thread가 binlog 수신 → relay log 기록 → SQL Thread가 적용
```

**Primary (my.cnf)**
```ini
server-id=1
log_bin=mysql-bin
binlog_format=ROW          # STATEMENT보다 안전(함수/랜덤 결과 일관성)
sync_binlog=1              # 커밋마다 디스크 flush (데이터 안전)
innodb_flush_log_at_trx_commit=1  # ACID 보장
```

**Replica (my.cnf)**
```ini
server-id=2
relay_log=relay-bin
read_only=ON
replica_parallel_workers=4   # 병렬 복제 (MySQL 8.0+)
replica_parallel_type=LOGICAL_CLOCK  # 동일 커밋 그룹 병렬 적용
```

**Replica 연결**
```sql
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='primary.db',
  SOURCE_USER='repl',
  SOURCE_PASSWORD='***',
  SOURCE_AUTO_POSITION=1;   -- GTID 기반 (위치 추적 자동화)
START REPLICA;
```

**Semi-sync 활성화 (MySQL 8.0+)**
```sql
-- Primary
INSTALL PLUGIN rpl_semi_sync_source SONAME 'semisync_source.so';
SET GLOBAL rpl_semi_sync_source_enabled = 1;
SET GLOBAL rpl_semi_sync_source_timeout = 1000; -- 1초 대기 후 비동기 폴백

-- Replica
INSTALL PLUGIN rpl_semi_sync_replica SONAME 'semisync_replica.so';
SET GLOBAL rpl_semi_sync_replica_enabled = 1;
```

### PostgreSQL 복제 (WAL 기반)

PostgreSQL은 WAL(Write-Ahead Log)을 스트리밍으로 복제합니다.

**Primary (postgresql.conf)**
```ini
wal_level = replica            # logical로 올리면 논리적 복제도 가능
max_wal_senders = 5
synchronous_standby_names = '' # 비동기 (이름 설정 시 동기)
```

**Replica 구성**
```bash
# pg_basebackup으로 초기 복제
pg_basebackup -h primary.db -D /var/lib/postgresql/data -U repl -P -R
# -R 옵션이 standby.signal + primary_conninfo를 자동 생성
```

### 핵심 차이 요약

| 구분 | MySQL | PostgreSQL |
|:---|:---|:---|
| 복제 로그 | Binary Log | WAL |
| 복제 단위 | 행(ROW) / 문장(STATEMENT) | 물리적 블록 변경 |
| 병렬 복제 | LOGICAL_CLOCK 기반 | 기본 단일 프로세스 (PG16+에서 개선 중) |
| 논리적 복제 | X (별도 솔루션) | 내장 지원 (Publication/Subscription) |
| Failover 도구 | MySQL InnoDB Cluster / Orchestrator | Patroni / pg_auto_failover |

---

## 4) 읽기/쓰기 분리 라우팅 (Spring 예시)

### 기본 구현: AbstractRoutingDataSource

```java
public class RoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return TransactionSynchronizationManager.isCurrentTransactionReadOnly()
                ? "replica" : "primary";
    }
}
```

### DataSource 설정 (Spring Boot)

```java
@Configuration
public class DataSourceConfig {
    
    @Bean
    public DataSource routingDataSource(
            @Qualifier("primaryDs") DataSource primary,
            @Qualifier("replicaDs") DataSource replica) {
        
        RoutingDataSource routing = new RoutingDataSource();
        Map<Object, Object> targets = Map.of(
            "primary", primary,
            "replica", replica
        );
        routing.setTargetDataSources(targets);
        routing.setDefaultTargetDataSource(primary);
        return routing;
    }
}
```

### 서비스 레이어 사용

```java
@Transactional(readOnly = true)
public OrderView getOrder(Long id) {
    return orderRepository.findView(id);  // → replica
}

@Transactional
public void placeOrder(OrderCommand cmd) {
    orderService.create(cmd);  // → primary
    // 바로 조회가 필요하면 primary를 강제하거나 캐시 사용
}
```

**주의**: `readOnly=true`가 곧 replica로 가는 것은 아닙니다. `AbstractRoutingDataSource`를 직접 구현해야 하며, **복제 지연**을 고려한 강제 옵션이 필요합니다.

### 미들웨어 기반 분리 (ProxySQL / MaxScale)

애플리케이션 코드 변경 없이 SQL 라우팅을 하고 싶다면 DB 프록시를 사용할 수 있습니다.

```ini
# ProxySQL 예시: 읽기 쿼리를 replica hostgroup(20)으로 라우팅
mysql_query_rules:
  - match_pattern: "^SELECT"
    destination_hostgroup: 20   # replica group
  - match_pattern: ".*"
    destination_hostgroup: 10   # primary group
```

**ProxySQL vs 애플리케이션 라우팅 비교:**
- ProxySQL: 코드 변경 없음, 연결 풀링/캐시 내장, 운영 복잡도 증가
- 애플리케이션: 세밀한 제어 가능(Read-After-Write 등), 추가 인프라 불필요

---

## 5) Failover 기준 (운영 룰)

- **자동 Failover**: Primary 다운 감지 후 Replica 승격
- **수동 승격**: 데이터 정합성 점검 후 승격 (업무 중요도에 따라)

### 승격 전 체크리스트
- [ ] Replica lag < 1s (또는 0)
- [ ] 최근 트랜잭션 손실 허용 여부 (RPO 확인)
- [ ] 쓰기 재시도/중복 처리 안전성 (멱등성)
- [ ] 애플리케이션 커넥션 풀이 새 Primary를 바라보는지 확인
- [ ] 구 Primary가 다시 올라올 경우 "쓰기 차단(read_only)" 설정

### Failover 시나리오별 대응

```
[정상 상태]
  App → Primary (Write)
  App → Replica (Read)

[Primary 장애 발생]
  1. 헬스체크 실패 감지 (3~5회 연속)
  2. Replica lag = 0 확인 (데이터 손실 최소화)
  3. Replica를 Primary로 승격 (read_only OFF)
  4. DNS/VIP 전환 또는 앱 커넥션 풀 재설정
  5. 구 Primary 복구 시 → 새 Primary의 Replica로 재구성
```

### 자동 Failover 도구

| 도구 | 대상 DB | 특징 |
|:---|:---|:---|
| **MySQL InnoDB Cluster** | MySQL 8.0+ | Group Replication 기반, MySQL Router 연동 |
| **Orchestrator** | MySQL | HTTP API, 토폴로지 시각화, 유연한 정책 |
| **Patroni** | PostgreSQL | etcd/Consul 기반 리더 선출, K8s 친화적 |
| **AWS RDS Multi-AZ** | MySQL/PostgreSQL | 관리형, 자동 DNS 전환 (60~120초) |

---

## 6) 복제 모니터링 메트릭 (운영 필수)

복제를 운영하면서 반드시 감시해야 할 메트릭들입니다.

### MySQL

```sql
SHOW REPLICA STATUS\G

-- 핵심 확인 항목:
-- Seconds_Behind_Source: 복제 지연 초 (0이면 최신)
-- Replica_IO_Running: Yes (binlog 수신 정상)
-- Replica_SQL_Running: Yes (relay log 적용 정상)
-- Last_Error: 복제 에러 메시지
```

### PostgreSQL

```sql
-- Primary에서 확인
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
       (sent_lsn - replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;

-- Replica에서 확인
SELECT now() - pg_last_xact_replay_timestamp() AS replay_lag;
```

### Prometheus + Grafana 대시보드 구성 권장 지표

| 지표 | 설명 | 알림 임계치 (예시) |
|:---|:---|:---|
| `replication_lag_seconds` | 복제 지연 초 | Warning: > 5s, Critical: > 30s |
| `replica_io_thread_running` | IO 스레드 상태 | 0이면 즉시 알림 |
| `replica_sql_thread_running` | SQL 스레드 상태 | 0이면 즉시 알림 |
| `replication_lag_bytes` | WAL/binlog 바이트 차이 | 환경별 설정 |

---

## 자주 하는 실수

- "읽기 전용 트랜잭션이면 무조건 replica"로 라우팅함 → **Read-after-write 깨짐**
- 복제 지연 모니터링 없이 운영함 → 장애 시 데이터 누락
- Failover 후 애플리케이션이 여전히 구 Primary에 쓰기 시도 → **Split-brain**
- Replica 스펙을 Primary보다 낮게 잡음 → Lag이 점점 누적
- Semi-sync 타임아웃을 너무 짧게 설정 → 네트워크 순단 시 비동기로 폴백되어 데이터 유실 가능

---

## 연습

1. `SHOW REPLICA STATUS`에서 `Seconds_Behind_Source`를 읽고 알림 임계치를 정해보세요.
2. 쓰기 직후 조회 API를 Primary로 강제하는 정책을 `ReadAfterWriteContext`로 구현해보세요.
3. 장애 시나리오(Primary down)에서 읽기 라우팅을 어떻게 바꿀지 문서화해보세요.
4. ProxySQL을 로컬에서 구성하고, `SELECT`는 replica, `INSERT/UPDATE`는 primary로 가는지 확인해보세요.

---

## 관련 심화 학습

- [MySQL 인덱스 & EXPLAIN 분석](/learning/deep-dive/deep-dive-mysql-index-explain/) — 복제 환경에서도 쿼리 성능이 중요
- [MySQL 샤딩 전략](/learning/deep-dive/deep-dive-mysql-sharding/) — 수직 확장 한계 후 수평 확장 전략
- [CAP 정리와 분산 시스템 트레이드오프](/learning/deep-dive/deep-dive-cap-theorem/) — 복제의 이론적 배경
- [분산 락](/learning/deep-dive/deep-dive-distributed-lock/) — 복제 환경에서의 동시성 제어
- [Timeout·Retry·Backoff 전략](/learning/deep-dive/deep-dive-timeout-retry-backoff/) — Failover 시 재시도 설계
