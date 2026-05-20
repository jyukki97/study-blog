---
title: "백엔드 커리큘럼 심화: PostgreSQL Index Bloat, REINDEX CONCURRENTLY, Fillfactor 운영 플레이북"
date: 2026-04-27
draft: false
topic: "Database"
tags: ["PostgreSQL", "Index Bloat", "REINDEX CONCURRENTLY", "Fillfactor", "HOT Update"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL 인덱스가 왜 조용히 비대해지고, 어떤 지표에서 reindex를 결심해야 하며, fillfactor와 HOT update로 재발을 어떻게 줄일지 실무 기준으로 정리합니다."
module: "database"
study_order: 1181
---

PostgreSQL 성능 문제를 볼 때 팀이 자주 놓치는 게 있습니다. 테이블 row 수는 크게 안 늘었고 CPU도 평소 수준인데, 어느 날부터 특정 조회가 조금씩 느려지고, shared buffer hit는 유지되는데도 읽기 I/O가 묘하게 늘고, 같은 인덱스를 타는 쿼리의 p95가 몇 주에 걸쳐 서서히 악화되는 패턴입니다. 이럴 때 흔히 실행계획만 의심하거나 autovacuum만 손보는데, 실제 원인은 **인덱스 bloat가 캐시 효율과 페이지 locality를 오래에 걸쳐 갉아먹은 것**인 경우가 많습니다.

이 글은 인덱스 기본 개념 자체보다 그 다음 단계를 다룹니다. B-Tree 원리 자체는 [인덱스 기본: B-Tree 구조와 쿼리 성능](/learning/deep-dive/deep-dive-database-indexing/)에서 먼저 보고, autovacuum의 기본 흐름은 [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)에서 정리한 뒤, 여기서는 **언제 bloat를 운영 이슈로 봐야 하는지, 언제 `REINDEX CONCURRENTLY`를 선택해야 하는지, fillfactor와 HOT update로 어떻게 재발을 줄일지**에 집중하겠습니다. 같이 보면 좋은 글은 [Query Plan Regression Guardrail 플레이북](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/), [PostgreSQL WAL·Checkpoint·Replication Lag 운영 기준](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/), [운영 중 스키마 변경 실전: Online DDL + Expand/Contract 패턴](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)입니다.

## 이 글에서 얻는 것

- index bloat를 단순 디스크 낭비가 아니라 캐시, 실행계획 안정성, WAL 비용과 연결해서 설명할 수 있습니다.
- autovacuum으로 해결되는 문제와 reindex가 필요한 문제를 구분할 수 있습니다.
- `REINDEX CONCURRENTLY`, drop/recreate, fillfactor 조정 중 무엇을 고를지 숫자 기준을 세울 수 있습니다.
- HOT update, 긴 트랜잭션, 과한 secondary index가 bloat를 어떻게 키우는지 운영 관점에서 이해할 수 있습니다.

## 핵심 개념/이슈

### 1) index bloat는 "공간 낭비"보다 "작업셋 오염" 문제에 가깝다

인덱스가 비대해지면 가장 먼저 보이는 건 파일 크기 증가입니다. 하지만 운영에서 더 아픈 건 디스크 용량보다 **같은 논리 데이터셋을 읽기 위해 더 많은 페이지를 뒤져야 한다는 점**입니다. 즉, 캐시에 담아야 할 페이지 수가 늘고, 랜덤 I/O 가능성이 커지고, 인덱스 스캔의 locality가 나빠집니다.

그래서 index bloat의 비용은 보통 아래 순서로 드러납니다.

1. 인덱스 파일이 커진다.
2. 동일 쿼리의 buffer read가 서서히 늘어난다.
3. 인덱스 스캔 p95가 조금씩 나빠진다.
4. 옵티마이저가 인덱스 비용을 다르게 보기 시작해 실행계획이 흔들린다.
5. reindex 시점에는 이미 WAL, replica lag, 작업 시간까지 비싸진다.

즉 bloat는 "언젠가 정리하면 되는 housekeeping"이 아니라, 천천히 진행되는 성능 부채입니다.

### 2) PostgreSQL에서 table bloat와 index bloat는 회복 방식이 다르다

MVCC 때문에 UPDATE와 DELETE가 많으면 dead tuple이 생기고, autovacuum이 이를 청소합니다. 하지만 여기서 중요한 차이가 있습니다.

- **table bloat**는 VACUUM으로 dead tuple 재사용 여지를 늘릴 수 있습니다.
- **index bloat**는 VACUUM만으로 파일이 눈에 띄게 작아지지 않는 경우가 많습니다.

인덱스 엔트리는 오래된 버전 정리와 페이지 재사용이 부분적으로 가능해도, 이미 벌어진 page split과 fragmentation, 비효율적인 페이지 배치는 그대로 남기 쉽습니다. 그래서 테이블은 autovacuum이 어느 정도 버텨 주는데도 인덱스 성능은 계속 나빠지는 일이 생깁니다. 이 구간에서 필요한 것은 더 자주 vacuum을 돌리는 것보다, **정말 reindex가 필요한지 판단하는 기준**입니다.

### 3) HOT update를 못 타는 UPDATE가 많을수록 인덱스가 빨리 붓는다

실무에서 index bloat의 절반은 autovacuum 설정이 아니라 **UPDATE 패턴과 인덱스 설계**에서 시작합니다. PostgreSQL은 HOT(Heap-Only Tuple) update가 가능하면 인덱스 엔트리 변경을 줄일 수 있습니다. 하지만 아래 조건이면 HOT 이점을 거의 못 누립니다.

- 자주 바뀌는 컬럼에 인덱스가 걸려 있다.
- heap page에 여유 공간이 없어 같은 페이지에 새 버전을 못 놓는다.
- 테이블 fillfactor가 너무 높아 페이지가 늘 꽉 차 있다.
- status, updated_at 같은 변경 빈도 높은 컬럼까지 복합 인덱스에 넣어 두었다.

이 경우 UPDATE 한 번이 heap 새 버전 + 여러 secondary index 수정으로 이어지고, 결국 인덱스 page split과 dead entry가 빨리 늘어납니다. 그래서 bloat 대응은 `REINDEX` 한 번으로 끝나지 않고, **어떤 UPDATE를 HOT-friendly하게 만들 수 있는지**까지 봐야 재발이 줄어듭니다.

### 4) bloat는 긴 트랜잭션, 느린 vacuum, 과한 인덱스 수와 같이 온다

인덱스 bloat만 따로 자라는 경우도 있지만, 보통은 아래 조건과 겹칩니다.

- 장시간 열린 트랜잭션 때문에 dead tuple 회수가 늦어짐
- autovacuum이 밀려 visibility map/cleanup 진전이 느림
- replica lag을 의식해 maintenance 작업을 계속 미룸
- 조회는 몇 개 안 되는데 secondary index가 과하게 많음
- soft delete를 오래 끌고 archive 분리를 안 함

특히 "인덱스가 많을수록 읽기가 무조건 빨라진다"는 착각이 위험합니다. 쓰기-heavy 테이블에서는 인덱스 1개 추가가 쿼리 1개 최적화보다, 모든 UPDATE/INSERT 비용 증가와 bloat 가속으로 돌아올 수 있습니다.

### 5) bloat 추정치는 완벽하지 않아도, 추세만 잡혀도 운영 판단엔 충분하다

PostgreSQL에서 index bloat는 테이블 row count처럼 정확히 한 줄 숫자로 떨어지지 않습니다. `pgstattuple`, `pgstatindex`, 카탈로그 추정 쿼리, `pg_relation_size`, `pg_stat_user_indexes`, buffer hit/read 변화 등을 함께 봐야 합니다. 중요한 건 100% 정확한 절대값보다 아래 두 가지입니다.

- **추세**: 최근 2~4주 동안 같은 인덱스의 크기와 읽기 비용이 계속 악화되는가
- **체감 영향**: 그 인덱스를 쓰는 핵심 쿼리 p95, shared read blocks, replica apply lag가 실제로 나빠지는가

즉 bloat 추정치는 회계 감사 숫자가 아니라 운영 의사결정 숫자입니다. 추정 오차가 있어도, 같은 방식으로 꾸준히 보면 reindex 시점을 충분히 잡을 수 있습니다.

## 실무 적용

### 1) 먼저 볼 지표와 출발 임계값

저는 PostgreSQL 운영에서 아래 기준을 출발점으로 둡니다. 절대 정답은 아니지만, 의사결정을 미루지 않게 해 주는 값입니다.

| 지표 | 경고 기준 | 심각 기준 | 해석 |
| --- | --- | --- | --- |
| 추정 index bloat ratio | 20% 초과 | 35% 초과 | 공간 낭비보다 스캔 효율 저하 가능성 큼 |
| 인덱스 크기 증가율(4주) | +15% 초과 | +30% 초과 | row 증가 없이 커지면 bloat 의심 |
| 해당 쿼리 p95 악화 | 기준 대비 15% 초과 | 30% 초과 | 사용자 영향 시작 |
| `shared_blks_read` 증가 | 기준 대비 20% 초과 | 40% 초과 | 캐시 효율 악화 신호 |
| 디스크 여유 공간 | 25% 미만 | 15% 미만 | reindex 자체가 부담되는 구간 |
| replica apply lag | 30초 초과 | 120초 초과 | maintenance WAL 비용 경계 |

여기에 운영 안전 규칙 하나를 더 둡니다. **대상 인덱스 크기의 최소 1.3~1.5배 정도 여유 디스크가 없으면 `REINDEX CONCURRENTLY`를 성급히 잡지 않는 편**이 안전합니다. 새 인덱스 생성, WAL, replica 전달 비용이 같이 붙기 때문입니다.

### 2) 어떤 상황에서 `REINDEX CONCURRENTLY`를 우선 선택할까

저는 아래 조건이 3개 이상 겹치면 우선 후보로 봅니다.

- 핵심 인덱스 추정 bloat가 **30% 이상**
- 대상 인덱스 크기가 **10GB 이상**이라 캐시 오염 체감이 큼
- 관련 쿼리 p95가 **20% 이상** 악화
- `pg_stat_user_indexes` 기준 scan은 많은데 fetch/read 효율이 나빠짐
- autovacuum 정상화 후에도 1~2주간 추세가 개선되지 않음

이때 장점은 락 충격을 줄이면서 재구성을 할 수 있다는 점입니다. 대신 비용도 분명합니다.

- 빌드 시간이 길다.
- WAL이 많이 발생한다.
- replica lag가 커질 수 있다.
- 디스크 여유 공간이 더 필요하다.
- busiest window에서 돌리면 오히려 p99를 자극할 수 있다.

그래서 `REINDEX CONCURRENTLY`는 "안전한 기본값"이라기보다 **읽기 경로는 지키되, 시간과 리소스를 더 쓰는 방식**으로 이해해야 합니다.

### 3) drop/recreate, reindex, 유지 중 무엇을 선택할까

간단히 정리하면 아래 기준이 실전적입니다.

| 선택지 | 적합한 상황 | 피해야 할 상황 |
| --- | --- | --- |
| 그대로 둠 | bloat 추정치는 있지만 사용자 지표 영향 미미, 성장 추세 완만 | 핵심 쿼리 p95 악화가 이미 보일 때 |
| `REINDEX CONCURRENTLY` | 운영 중단 없이 재구성 필요, 핵심 조회 인덱스, WAL 예산 허용 | 디스크 여유 부족, replica lag 민감, 피크 시간대 |
| drop/recreate | 사용 빈도 낮은 보조 인덱스, 짧은 maintenance window 가능 | 서비스 핵심 경로, 인덱스 부재 순간이 치명적일 때 |
| 인덱스 삭제 | scan 거의 없고 쓰기 비용만 큰 인덱스 | 가끔이라도 중요한 장애 대응 쿼리에 필요한 인덱스 |

의외로 효과가 큰 건 **reindex 전에 unused index 후보부터 지우는 것**입니다. 살아남아야 할 인덱스 수를 줄이면 이후 bloat 재발 속도도 느려지고 write 비용도 낮아집니다.

### 4) 재발 방지의 핵심은 fillfactor와 인덱스 설계다

`REINDEX`는 현재 부풀어 오른 인덱스를 정리하지만, 같은 UPDATE 패턴이면 다시 붓습니다. 그래서 아래 조합을 같이 봐야 합니다.

- **테이블 fillfactor**: UPDATE가 잦은 테이블은 보통 **70~90** 범위에서 검토
- **인덱스 fillfactor**: page split이 잦은 인덱스는 기본값(대개 90) 대비 더 낮출 여지가 있는지 검토
- **HOT update 비율**: 변경 컬럼에 꼭 필요한 인덱스만 남기기
- **복합 인덱스 재검토**: `status`, `updated_at`처럼 자주 바뀌는 컬럼을 습관적으로 포함하지 않기
- **soft delete/archiving**: 오래 살아남는 죽은 데이터 분리

특히 앱 팀과 DB 팀이 같이 봐야 할 질문은 이것입니다. "이 컬럼은 조회 때문에 필요한가, 아니면 단지 최근성 정렬 습관 때문에 인덱스에 넣은 건가?" 후자라면 bloat 비용을 장기적으로 계속 내게 됩니다.

### 5) 실행 순서 런북

**1단계, 영향 확인**  
문제 인덱스를 사용하는 상위 쿼리 5~10개를 뽑아 p95, shared reads, plan 변화 여부를 확인합니다.

**2단계, 원인 분해**  
긴 트랜잭션, autovacuum backlog, 불필요한 secondary index, HOT 불가 UPDATE 패턴을 같이 봅니다.

**3단계, 안전성 확인**  
디스크 여유, WAL 예산, replica lag 허용치, maintenance window를 계산합니다.

**4단계, 정리 방식 선택**  
핵심 인덱스면 `REINDEX CONCURRENTLY`, 저사용 보조 인덱스면 drop/recreate 또는 삭제를 우선 검토합니다.

**5단계, 재발 방지 변경**  
fillfactor, 인덱스 구성, UPDATE 패턴, archive 정책 중 최소 1개 이상을 같이 바꿉니다.

이 순서가 중요한 이유는, reindex만 하고 원인 설계를 안 바꾸면 2~6주 뒤 같은 이슈가 다시 오기 때문입니다.

### 6) 권장 도입 순서

**1주차**  
`pg_stat_user_indexes`, `pg_relation_size`, 주요 쿼리 p95를 묶어 bloat 의심 대상을 상위 10개 뽑습니다.

**2주차**  
`pgstattuple` 또는 `pgstatindex`를 쓸 수 있으면 후보 3개만 정밀 측정합니다. 동시에 unused index 후보를 분리합니다.

**3주차**  
가장 영향 큰 인덱스 1개에 대해 `REINDEX CONCURRENTLY` canary를 수행하고 WAL/replica lag를 기록합니다.

**4주차**  
fillfactor와 HOT update 친화적 인덱스 재설계를 1개 테이블에 적용하고, 2주 추세를 비교합니다.

## 트레이드오프/주의점

`REINDEX CONCURRENTLY`는 락을 줄여 주지만 공짜가 아닙니다. 큰 인덱스에서는 WAL 폭증과 replica lag를 만들 수 있고, 디스크 여유가 부족하면 maintenance 자체가 더 위험할 수 있습니다. fillfactor를 낮추면 page split은 줄일 수 있지만 같은 row 수에 더 많은 페이지를 쓰게 되어 초기 저장 공간은 커질 수 있습니다. 또 HOT update를 늘리겠다고 인덱스를 무작정 줄이면 읽기 쿼리가 다시 느려질 수 있습니다.

추정치 해석도 조심해야 합니다. 어떤 bloat 계산 쿼리는 실제보다 과장되거나 축소될 수 있습니다. 그래서 단일 수치만 믿지 말고, **크기 추세 + 쿼리 p95 + buffer read + replica 영향**을 같이 보는 편이 안전합니다. 이 점은 [Query Plan Regression Guardrail 플레이북](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)과 연결됩니다. 계획이 흔들린 뒤에 인덱스를 의심하는 것이 아니라, 인덱스 상태가 흔들릴 때 계획도 같이 감시해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 상위 10개 인덱스에 대해 크기 추세와 scan 빈도를 같이 본다.
- [ ] 문제 쿼리 p95와 `shared_blks_read` 변화가 함께 기록된다.
- [ ] `REINDEX CONCURRENTLY` 전 디스크 여유와 replica lag 허용치를 확인한다.
- [ ] 자주 바뀌는 컬럼이 복합 인덱스에 불필요하게 들어가 있지 않은지 검토했다.
- [ ] reindex 뒤 fillfactor, HOT update, archive 정책 중 최소 1개를 같이 조정한다.

### 연습 과제

1. 운영 DB에서 가장 큰 인덱스 5개를 뽑아, 지난 4주간 크기 증가율과 해당 쿼리 p95 변화를 나란히 적어 보세요. 숫자를 나란히 두면 "단순 성장"과 "성능 부채"가 구분되기 시작합니다.  
2. UPDATE가 잦은 테이블 하나를 골라, 현재 복합 인덱스 중 자주 바뀌는 컬럼이 포함된 항목을 체크해 보세요. HOT update를 막는 인덱스가 생각보다 빨리 보일 수 있습니다.  
3. `REINDEX CONCURRENTLY` canary 1건을 가정하고, 필요한 디스크 여유, 허용 가능한 replica lag, 실행 가능 시간대를 문서로 적어 보세요. 실제 작업 전에 숫자로 써 두면 maintenance 공포가 훨씬 줄어듭니다.

## 관련 글

- [인덱스 기본: B-Tree 구조와 쿼리 성능](/learning/deep-dive/deep-dive-database-indexing/)
- [PostgreSQL Autovacuum 튜닝: 느려진 쿼리와 Bloat를 동시에 잡는 법](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)
- [백엔드 커리큘럼 심화: Query Plan Regression Guardrail 실무 플레이북](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)
- [백엔드 커리큘럼 심화: PostgreSQL WAL, Checkpoint, Replication Lag를 한 흐름으로 보는 운영 기준](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/)
- [운영 중 스키마 변경 실전: Online DDL + Expand/Contract 패턴](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)
