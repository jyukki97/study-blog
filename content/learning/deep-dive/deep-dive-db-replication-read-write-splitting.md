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

---

## 2) 복제 지연(Lag)이 만드는 문제

### 증상
- 방금 만든 주문이 **조회 API에서 안 보임**
- 결제 직후 결제 상태가 **PENDING**으로 남음

### 원인
- Replica가 Primary의 변경을 **아직 반영하지 못함**

### 해결 전략 (실무 기준)
1. **Read-After-Write 보장 구간**: 쓰기 직후 N초 동안은 Primary 읽기
2. **세션/요청 스코프 고정**: 특정 트랜잭션/요청은 Primary 고정
3. **Lag 기반 라우팅**: replica의 lag가 임계치 이상이면 읽기 차단

---

## 3) MySQL 복제 설정 예시 (핵심만)

### Primary (my.cnf)
```ini
server-id=1
log_bin=mysql-bin
binlog_format=ROW
```

### Replica (my.cnf)
```ini
server-id=2
relay_log=relay-bin
read_only=ON
```

### Replica 연결
```sql
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='primary.db',
  SOURCE_USER='repl',
  SOURCE_PASSWORD='***',
  SOURCE_LOG_FILE='mysql-bin.000123',
  SOURCE_LOG_POS=456789;
START REPLICA;
```

---

## 4) 읽기/쓰기 분리 라우팅 (Spring 예시)

```java
public class RoutingDataSource extends AbstractRoutingDataSource {
    @Override
    protected Object determineCurrentLookupKey() {
        return TransactionSynchronizationManager.isCurrentTransactionReadOnly()
                ? "replica" : "primary";
    }
}
```

```java
@Transactional(readOnly = true)
public OrderView getOrder(Long id) {
    return orderRepository.findView(id);
}

@Transactional
public void placeOrder(OrderCommand cmd) {
    orderService.create(cmd);
    // 바로 조회가 필요하면 primary를 강제하거나 캐시 사용
}
```

**주의**: `readOnly=true`가 곧 replica로 가는 것은 아님. **복제 지연**을 고려해 강제 옵션 필요.

---

## 5) Failover 기준 (운영 룰)

- **자동 Failover**: Primary 다운 감지 후 Replica 승격
- **수동 승격**: 데이터 정합성 점검 후 승격 (업무 중요도에 따라)

### 승격 전 체크리스트
- Replica lag < 1s (또는 0)
- 최근 트랜잭션 손실 허용 여부 (RPO)
- 쓰기 재시도/중복 처리 안전성

---

## 자주 하는 실수

- “읽기 전용 트랜잭션이면 무조건 replica”로 라우팅함 → **Read-after-write 깨짐**
- 복제 지연 모니터링 없이 운영함 → 장애 시 데이터 누락
- Failover 후 애플리케이션이 여전히 구 Primary에 쓰기 시도

---

## 연습

1. `SHOW REPLICA STATUS`에서 `Seconds_Behind_Source`를 읽고 알림 임계치를 정해보세요.
2. 쓰기 직후 조회 API를 Primary로 강제하는 정책을 만들어보세요.
3. 장애 시나리오(Primary down)에서 읽기 라우팅을 어떻게 바꿀지 문서화해보세요.
