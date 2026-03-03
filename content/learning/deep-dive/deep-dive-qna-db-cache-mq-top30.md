---
title: "Q&A 모음: DB/캐시/메시징 30제"
date: 2025-12-16
draft: false
topic: "Q&A"
tags: ["Database", "Redis", "Kafka", "Q&A", "Interview"]
categories: ["Q&A"]
description: "인덱스/격리/락, Redis 캐시/락, Kafka 파티션·정렬·리밸런스 등 30문항 Q&A"
module: "qna"
study_order: 801
---

DB, Redis, Kafka를 중심으로 실무·면접에서 자주 등장하는 30문항을 정리했습니다. 각 답변은 **핵심 개념 → 동작 원리 → 실무 팁** 순서로 구성되어 있습니다.

---

## Section A — MySQL / RDB (Q1–Q12)

### Q1. 인덱스(Index)의 동작 원리는?

**핵심 답변:** InnoDB는 **B+Tree** 구조의 인덱스를 사용합니다. 리프 노드에 데이터(또는 PK 포인터)가 정렬되어 저장되므로, 전체 테이블 스캔(Full Scan) 대신 트리 탐색(O(log N))으로 빠르게 조회합니다.

- **클러스터드 인덱스**: PK 기준으로 데이터 자체가 정렬 저장
- **세컨더리 인덱스**: 별도 B+Tree에 PK 값을 저장 → PK로 다시 조회(북마크 룩업)

### Q2. 커버링 인덱스(Covering Index)란?

**핵심 답변:** 쿼리에 필요한 모든 컬럼이 인덱스에 포함되어 있어 **테이블 접근 없이** 인덱스만으로 결과를 반환하는 것입니다. `EXPLAIN`에서 `Using index`로 확인합니다.

```sql
-- name, email 복합 인덱스가 있다면
SELECT name, email FROM users WHERE name = '홍길동';
-- → 커버링 인덱스 적용 (테이블 접근 X)
```

**실무 팁:** 자주 사용하는 SELECT 컬럼을 복합 인덱스에 포함시키면 I/O를 크게 줄일 수 있습니다.

### Q3. `EXPLAIN` 실행 계획에서 봐야 할 핵심 항목은?

| 항목 | 의미 | 주의 |
|------|------|------|
| type | 접근 방식 (ALL → index → range → ref → const) | ALL이면 풀스캔 |
| key | 사용된 인덱스 | NULL이면 인덱스 미사용 |
| rows | 예상 스캔 행 수 | 클수록 비효율 |
| Extra | `Using filesort`, `Using temporary` | 정렬/임시테이블 주의 |

### Q4. `READ COMMITTED` vs `REPEATABLE READ` 차이는?

- **READ COMMITTED**: 커밋된 데이터만 읽음. 같은 쿼리를 두 번 실행하면 결과가 다를 수 있음(Non-Repeatable Read)
- **REPEATABLE READ** (MySQL 기본): 트랜잭션 시작 시점의 스냅샷을 읽음. 같은 쿼리 결과가 동일

**InnoDB 특수 동작:** REPEATABLE READ에서 Gap Lock으로 Phantom Read도 방지합니다.

### Q5. Gap Lock과 Next-Key Lock은 언제 발생하나?

**핵심 답변:** REPEATABLE READ에서 인덱스 레코드 사이의 **빈 구간(gap)**을 잠가 Phantom Read를 방지합니다.

- **Gap Lock**: 레코드 사이 구간만 잠금
- **Next-Key Lock**: 레코드 + 앞의 gap을 함께 잠금 (InnoDB 기본)

**실무 팁:** 불필요한 Gap Lock은 데드락의 원인이 됩니다. `READ COMMITTED`로 낮추면 Gap Lock이 사라지지만, Phantom Read를 감수해야 합니다.

### Q6. 데드락(Deadlock) 발생 원인과 대응법은?

**원인:** 두 트랜잭션이 서로 상대가 보유한 락을 기다리는 순환 대기 상태.

**대응:**
1. **트랜잭션을 짧게** — 락 보유 시간 최소화
2. **접근 순서 통일** — 테이블/행 접근 순서를 항상 동일하게
3. **인덱스 활용** — 풀스캔은 불필요한 락을 넓게 잡음
4. **`SHOW ENGINE INNODB STATUS`**로 마지막 데드락 분석

### Q7. MySQL 파티셔닝 전략은?

| 전략 | 기준 | 적합한 경우 |
|------|------|------------|
| RANGE | 날짜, 숫자 범위 | 로그, 시계열 데이터 |
| LIST | 특정 값 목록 | 지역, 카테고리 |
| HASH | 해시 함수 | 균등 분산 |
| KEY | MySQL 내부 해시 | PK 기반 분산 |

**실무 팁:** 파티션 프루닝이 동작하려면 WHERE 절에 파티션 키가 포함되어야 합니다.

### Q8. Slow Query 분석 절차는?

1. `slow_query_log` 활성화 (`long_query_time = 1`)
2. `mysqldumpslow` 또는 `pt-query-digest`로 Top N 추출
3. `EXPLAIN ANALYZE` (MySQL 8.0.18+)로 실제 실행 계획 확인
4. 인덱스 추가, 쿼리 리팩토링, 또는 캐시 도입

### Q9. MySQL 복제(Replication) 방식 차이는?

- **비동기 복제**: 마스터가 binlog 기록 후 즉시 커밋 → 복제 지연 가능
- **반동기(Semi-sync)**: 최소 1개 슬레이브가 릴레이 로그에 기록 확인 후 커밋
- **그룹 복제(Group Replication)**: Paxos 기반 합의, 자동 페일오버

### Q10. Connection Pool 튜닝 핵심 파라미터는?

HikariCP 기준:
- **maximumPoolSize**: CPU 코어 수 × 2 + 디스크 수 (공식)
- **minimumIdle**: maximumPoolSize와 동일 권장 (웜업 방지)
- **connectionTimeout**: 30초 기본, 상황에 따라 5~10초로 조정
- **maxLifetime**: DB의 `wait_timeout`보다 30초 이상 짧게

### Q11. 온라인 DDL(Online DDL)이란?

테이블 구조 변경(ALTER TABLE) 시 읽기/쓰기를 차단하지 않는 방식입니다. MySQL 8.0은 **Instant DDL**을 지원하여 컬럼 추가 시 메타데이터만 변경합니다.

**주의:** 인덱스 추가, 컬럼 타입 변경은 여전히 테이블 복사가 필요할 수 있습니다. `pt-online-schema-change`나 `gh-ost` 활용을 고려하세요.

### Q12. 트랜잭션 로그(Redo Log / Undo Log) 역할은?

- **Redo Log**: 커밋된 변경의 내구성 보장 (WAL). 크래시 복구 시 재적용
- **Undo Log**: 트랜잭션 롤백 및 MVCC 스냅샷 제공

---

## Section B — Redis (Q13–Q22)

### Q13. Redis가 싱글 스레드인데 왜 빠른가?

**핵심 답변:** 메모리 기반 + 이벤트 루프(epoll/kqueue) + 효율적 자료구조. 네트워크 I/O 대기 시간에 다른 요청을 처리합니다. Redis 6+에서는 I/O 멀티스레딩을 도입했지만, 명령 실행 자체는 여전히 싱글 스레드입니다.

### Q14. Redis 자료구조별 사용 사례는?

| 자료구조 | 사용 사례 |
|----------|----------|
| String | 캐시, 카운터, 세션 |
| Hash | 사용자 프로필, 설정 값 |
| List | 메시지 큐, 최근 항목 |
| Set | 태그, 고유 방문자 |
| Sorted Set | 랭킹, 리더보드, 타임라인 |
| Stream | 이벤트 로그, 메시지 브로커 대안 |

### Q15. Cache-Aside vs Write-Through vs Write-Behind 차이는?

- **Cache-Aside**: 앱이 캐시 미스 시 DB 조회 후 캐시 저장 (가장 일반적)
- **Write-Through**: 캐시와 DB를 동시에 기록 (일관성 높음, 쓰기 느림)
- **Write-Behind**: 캐시에만 먼저 기록, 비동기로 DB 반영 (성능↑, 데이터 유실 위험)

### Q16. 캐시 스탬피드(Cache Stampede) 방지법은?

**문제:** 핫 키 만료 시 다수의 요청이 동시에 DB로 몰림.

**해결법:**
1. **뮤텍스 락**: 한 스레드만 DB 조회, 나머지는 대기
2. **논리적 만료**: TTL 전에 백그라운드에서 갱신
3. **확률적 갱신(PER)**: TTL 잔여 시간에 따라 확률적으로 미리 갱신

### Q17. Redis 분산 락 구현 시 주의점은?

```bash
SET lock_key unique_value NX EX 30
# NX: 키 없을 때만 설정, EX: 만료 시간
```

**주의점:**
- `unique_value`로 본인 락만 해제 (Lua 스크립트로 원자적 확인+삭제)
- 클러스터 환경에서는 **Redlock** 알고리즘 (과반수 노드 동의)
- 네트워크 파티션 시 락 보장 불가 — 펜싱 토큰 고려

### Q18. Redis Sentinel vs Cluster 차이는?

| 항목 | Sentinel | Cluster |
|------|----------|---------|
| 목적 | 고가용성 (자동 페일오버) | 수평 확장 (샤딩) |
| 데이터 분산 | ✗ (복제만) | ✓ (16384 해시 슬롯) |
| 최대 메모리 | 단일 노드 한계 | 노드 추가로 확장 |

### Q19. Redis 메모리 관리와 Eviction 정책은?

`maxmemory-policy` 옵션:
- **allkeys-lru**: 모든 키 중 LRU 제거 (캐시 용도 추천)
- **volatile-lru**: TTL 설정된 키 중 LRU
- **allkeys-lfu**: 사용 빈도 기반 제거 (Redis 4+)
- **noeviction**: 제거 안 함, 쓰기 거부

### Q20. Redis Pub/Sub vs Stream 차이는?

- **Pub/Sub**: Fire-and-forget, 구독자 없으면 메시지 유실, 히스토리 없음
- **Stream**: 메시지 영속 저장, Consumer Group 지원, ACK 메커니즘, 재처리 가능

**실무 팁:** 신뢰성이 필요하면 Stream, 단순 브로드캐스트면 Pub/Sub.

### Q21. Redis Pipeline과 Lua 스크립트는 언제 사용하나?

- **Pipeline**: 여러 명령을 한 번에 전송하여 RTT 절감 (원자성 없음)
- **Lua 스크립트**: 여러 명령을 원자적으로 실행 (`EVAL`). 분산 락 해제, 조건부 업데이트 등

### Q22. Hot Key 문제와 해결법은?

**문제:** 특정 키에 요청이 집중되어 단일 노드 과부하.

**해결법:**
1. **로컬 캐시(L1)**: Caffeine 등으로 앱 메모리에 캐시
2. **키 분산**: `hot_key:{1..N}`으로 랜덤 분산 읽기
3. **읽기 복제본**: Cluster에서 `READONLY` 명령으로 슬레이브 읽기

---

## Section C — Kafka / 메시징 (Q23–Q30)

### Q23. Kafka의 핵심 구조는?

**핵심 답변:** **Producer → Topic(Partition) → Consumer Group** 구조. 파티션은 순서 보장의 단위이고, Consumer Group 내에서 파티션은 1:1로 할당됩니다.

### Q24. 파티션 수는 어떻게 결정하나?

**공식:** `max(목표 처리량 / 단일 파티션 처리량, Consumer 수)`

**실무 팁:**
- 파티션 수는 늘릴 수만 있고 줄일 수 없음
- 너무 많으면: 리더 선출 지연, 메모리 사용 증가
- 시작은 6~12개, 모니터링 후 확장

### Q25. 메시지 순서 보장 방법은?

같은 **파티션** 내에서만 순서가 보장됩니다. 순서가 중요한 메시지는 동일한 **파티션 키**를 사용하세요.

```java
producer.send(new ProducerRecord<>("topic", orderId, payload));
// orderId가 같으면 같은 파티션으로 라우팅
```

**주의:** `max.in.flight.requests.per.connection > 1`이면 재시도 시 순서가 뒤바뀔 수 있습니다. `enable.idempotence = true`로 해결.

### Q26. Consumer Lag 원인과 완화 방법은?

**Consumer Lag**: 프로듀서가 쓴 최신 오프셋과 컨슈머가 읽은 오프셋의 차이.

**원인:** 처리 속도 < 유입 속도, GC pause, 외부 API 지연, 리밸런스 폭풍

**완화:**
1. Consumer 인스턴스 추가 (파티션 수 이내)
2. 배치 처리 최적화 (`max.poll.records`, `fetch.min.bytes`)
3. 처리 로직 비동기화
4. 파티션 수 증가

### Q27. 리밸런스(Rebalance)란 무엇이고, 영향을 줄이려면?

**핵심 답변:** Consumer Group 멤버 변경 시 파티션 재분배. 리밸런스 중에는 메시지 처리가 멈춥니다.

**영향 최소화:**
- **Cooperative Sticky Assignor**: 변경된 파티션만 재할당 (Kafka 2.4+)
- **Static Group Membership**: `group.instance.id` 설정으로 불필요한 리밸런스 방지
- `session.timeout.ms`와 `heartbeat.interval.ms` 적절히 조정

### Q28. Kafka의 메시지 전달 보장(Delivery Semantics)은?

| 모드 | 설명 | 설정 |
|------|------|------|
| At Most Once | 유실 가능, 중복 없음 | auto commit + fire-and-forget |
| At Least Once | 유실 없음, 중복 가능 | acks=all + 수동 커밋 |
| Exactly Once | 유실·중복 없음 | Idempotent Producer + Transactional API |

### Q29. Dead Letter Queue(DLQ) 패턴은?

처리 실패한 메시지를 별도 토픽(DLQ)으로 이동시켜 메인 처리 흐름을 유지합니다.

```
Main Topic → Consumer → 실패 → Retry Topic (3회) → 실패 → DLQ Topic
```

**실무 팁:** DLQ 메시지에 원본 토픽, 오프셋, 실패 사유를 헤더에 포함시키면 디버깅이 쉽습니다.

### Q30. Kafka vs RabbitMQ vs Redis Stream 선택 기준은?

| 항목 | Kafka | RabbitMQ | Redis Stream |
|------|-------|----------|-------------|
| 처리량 | 매우 높음 | 중간 | 높음 |
| 순서 보장 | 파티션 단위 | 큐 단위 | 스트림 단위 |
| 메시지 보존 | 설정 기간 | 소비 후 삭제 | 메모리/설정 |
| 적합 시나리오 | 이벤트 스트리밍, 로그 | 작업 큐, RPC | 경량 이벤트, 실시간 |

**실무 팁:** 대용량 이벤트 파이프라인은 Kafka, 복잡한 라우팅은 RabbitMQ, 이미 Redis를 쓰고 있고 간단한 큐가 필요하면 Redis Stream.

---

## 마무리 체크리스트

✅ 인덱스 설계 시 `EXPLAIN`으로 반드시 검증하고 있는가?  
✅ Redis 캐시 키에 TTL을 설정하고, 스탬피드 방지 전략이 있는가?  
✅ Kafka Consumer Lag 모니터링(Burrow, Prometheus)이 구축되어 있는가?  
✅ 트랜잭션 격리 수준과 락 전략을 의도적으로 선택하고 있는가?
