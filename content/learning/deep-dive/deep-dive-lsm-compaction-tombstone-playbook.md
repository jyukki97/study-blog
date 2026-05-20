---
title: "백엔드 커리큘럼 심화: LSM Compaction Debt와 Tombstone Storm 운영 플레이북"
date: 2026-04-26
draft: false
topic: "Distributed Systems"
tags: ["LSM-Tree", "Compaction", "Tombstone", "RocksDB", "Cassandra"]
categories: ["Backend Deep Dive"]
description: "LSM 기반 저장소에서 compaction debt와 tombstone storm를 어떤 지표로 보고, 어떤 상수로 운영하고, 언제 스키마를 바꿔야 하는지 실무 기준으로 정리합니다."
module: "backend-distributed"
study_order: 1180
---

LSM 기반 저장소는 평소에는 꽤 매력적입니다. 쓰기는 빠르고, 순차 I/O를 잘 쓰며, 로그성 워크로드나 시계열 데이터에도 강합니다. 문제는 이 장점이 **나중에 갚아야 할 compaction 비용을 미뤄서 얻는 속도**라는 점입니다. 평소에는 ingest가 잘 버티다가도 특정 시간대에 TTL 만료가 몰리거나, 대량 삭제 뒤 tombstone이 쌓이거나, hot partition 하나가 계속 갱신되면 suddenly p99가 튀고 write stall이 생기며 디스크 사용량이 이상하게 오래 내려오지 않습니다.

기초 개념 자체는 [스토리지 엔진 내부: B-Tree vs LSM-Tree](/learning/deep-dive/deep-dive-database-engines-lsm/)에서 이미 다뤘습니다. 이 글은 그 다음 단계로, RocksDB·Cassandra·Scylla 계열처럼 LSM 계열 저장소를 실제 운영할 때 **compaction debt를 어떤 숫자로 보고, tombstone storm를 어떻게 피하고, 언제 스키마나 compaction 전략을 바꿔야 하는지**를 실무 기준으로 정리합니다. 함께 보면 좋은 글은 [Hot Partition과 Partition Key Skew 플레이북](/learning/deep-dive/deep-dive-hot-partition-partition-key-skew-playbook/), [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/), [Quorum Read/Write + Read Repair 플레이북](/learning/deep-dive/deep-dive-quorum-read-write-read-repair-playbook/)입니다.

## 이 글에서 얻는 것

- compaction debt를 단순 "백그라운드 작업 밀림"이 아니라 write/read/space amplification의 균형 문제로 설명할 수 있습니다.
- tombstone storm가 왜 delete 요청량보다 훨씬 늦게 장애로 나타나는지 이해할 수 있습니다.
- L0 파일 수, pending compaction bytes, tombstone scan ratio, disk free 같은 운영 지표에 실제 임계값을 둘 수 있습니다.
- 대량 삭제, TTL 워크로드, hot key 편향이 있을 때 어떤 순서로 대응해야 하는지 런북 우선순위를 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) LSM의 빠른 쓰기는 "부채 선반영"이 아니라 "부채 이연"이다

LSM 엔진은 메모리(memtable)와 WAL에 먼저 기록하고, 나중에 SSTable을 병합하면서 정리합니다. 그래서 처음 쓰기 성능은 좋아 보이지만, 실제 비용은 flush와 compaction 시점에 몰려 나옵니다. 운영적으로는 세 가지 증폭이 서로 바뀝니다.

- **write amplification**: 같은 데이터를 compaction 과정에서 여러 번 다시 씀
- **read amplification**: 읽을 때 여러 SSTable과 tombstone을 함께 뒤짐
- **space amplification**: 이미 지워졌거나 덮어쓴 데이터가 디스크에 오래 남음

핵심은 compaction debt가 쌓인다는 말이 단순히 백그라운드 큐가 밀린다는 뜻이 아니라, 위 세 가지 증폭이 동시에 나빠질 준비가 되고 있다는 신호라는 점입니다. 그래서 디스크 사용량만 보면 늦고, p99만 봐도 늦습니다. debt 자체를 먼저 봐야 합니다.

### 2) compaction debt는 대개 "ingest 속도 > 정리 속도"에서 시작한다

가장 흔한 패턴은 flush는 계속 성공하는데, compaction throughput이 그 뒤를 못 따라가는 경우입니다. 예를 들어 초당 120MB를 계속 적재하는데 장기 평균 compaction 처리량이 90MB/s라면, 나머지 30MB/s가 debt로 남습니다. 당장은 정상처럼 보이지만 몇 시간 뒤 L0 파일 수가 늘고, 읽기 경로는 SSTable fan-out 때문에 느려지고, 결국 write stall까지 이어집니다.

특히 아래 조합이 위험합니다.

- 짧은 TTL이 많은 시계열/로그성 데이터
- 한 파티션에 갱신이 몰리는 hot key 패턴
- read repair나 backfill이 동시에 들어오는 복구 구간
- 디스크 여유 공간이 20~30% 아래로 떨어진 상태

이 구조는 [PostgreSQL WAL, Checkpoint, Replication Lag 운영 기준](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/)에서 본 "평시에는 보이지 않다가 정리 비용이 한꺼번에 드러나는" 문제와 닮아 있습니다.

### 3) tombstone storm는 삭제 직후보다 "조회 시점"과 "만료 시점"에 더 아프다

LSM에서 delete는 보통 즉시 물리 삭제가 아니라 tombstone 기록입니다. 즉 삭제 요청 자체는 빠를 수 있지만, 그 뒤 읽기와 compaction이 비용을 떠안습니다. 그래서 사고는 보통 두 시점에 터집니다.

1. **범위 조회가 tombstone을 많이 스캔할 때**  
   결과는 적은데 tombstone을 수십만 개 뒤지느라 읽기 p99가 급등합니다.
2. **동일 TTL 버킷이 한 번에 만료될 때**  
   만료 쓰기와 compaction이 같은 시간대에 몰려 디스크와 CPU가 함께 포화됩니다.

운영에서 특히 위험한 건 "대량 삭제를 끝냈으니 이제 가벼워지겠지"라는 착각입니다. 실제로는 compaction이 tombstone을 정리하기 전까지 space amplification이 그대로 남고, 쿼리는 tombstone을 계속 통과해야 하므로 읽기 부하가 오히려 더 나빠질 수 있습니다.

### 4) compaction 전략은 workload 분리 없이 만능이 아니다

Leveled compaction은 read amplification을 줄이기 좋지만 write amplification이 커질 수 있고, universal 또는 size-tiered 계열은 쓰기에는 유리하지만 tombstone 정리와 read fan-out이 더 비싸질 수 있습니다. time-window compaction은 TTL이 선명한 시계열 데이터에 잘 맞지만, 오래 살아남는 hot key가 섞이면 오히려 예측이 어려워집니다.

그래서 실무에서는 엔진 하나를 똑똑하게 튜닝하기보다, **워크로드를 컬럼 패밀리나 테이블 단위로 분리해 다른 compaction 정책을 주는 것**이 더 효과적일 때가 많습니다. 삭제가 잦은 데이터와 장기 보존 메타데이터를 한 공간에 같이 넣으면, compaction 정책 한 세트로 둘을 동시에 만족시키기 어렵습니다.

### 5) tombstone 문제의 절반은 엔진이 아니라 데이터 모델에서 시작한다

삭제가 잦은 워크로드에서 가장 좋은 최적화는 종종 compaction 스레드를 늘리는 것이 아니라, **삭제 패턴을 바꾸는 것**입니다. 대표적으로 아래가 효과가 큽니다.

- TTL을 초 단위로 제각각 주지 말고 5분, 1시간, 1일 같은 버킷으로 정렬
- soft delete를 오래 끌지 말고 archive table 또는 cold tier로 빨리 이동
- hot entity의 잦은 update를 append-only event + 비동기 materialization으로 분리
- 같은 파티션에 delete-heavy 데이터와 read-heavy 데이터를 섞지 않기

즉 tombstone storm는 저장소 팀만의 문제가 아니라, 스키마와 만료 정책을 정한 애플리케이션 팀의 의사결정 문제이기도 합니다.

## 실무 적용

### 1) 먼저 봐야 할 운영 지표와 권장 기준

단일 노드 또는 샤드 기준으로 저는 아래 숫자를 출발점으로 둡니다.

| 지표 | 경고 기준 | 심각 기준 | 해석 |
| --- | --- | --- | --- |
| `l0_files` | 8 초과 | 20 초과 | flush는 되지만 compaction이 밀리는 신호 |
| `pending_compaction_bytes` | 디스크의 10% 초과 | 디스크의 25% 초과 | debt가 실시간으로 쌓이는 상태 |
| `write_stall_p99` | 50ms 초과 | 200ms 초과 | 사용자 쓰기 경로 영향 시작 |
| `tombstone_scan_ratio` | 0.2 초과 | 0.5 초과 | 읽기 1건당 삭제 마커를 너무 많이 훑음 |
| `disk_free_ratio` | 30% 미만 | 20% 미만 | compaction 작업 여유 공간 부족 |

추가로 ingest-heavy 시스템이라면 **지속 compaction throughput이 평균 ingest의 최소 1.3배, 가능하면 1.5배 이상**은 나오는지 확인하는 편이 안전합니다. 순간 피크가 아니라 1시간 이동 평균으로 보는 것이 중요합니다.

### 2) 장애 시 런북 우선순위

compaction debt가 임계치를 넘고 p99가 튄다면, 첫 대응은 "더 빨리 정리하자"가 아니라 **새 부채 유입을 줄이는 것**입니다.

1. **ingest 감속**: 배치·백필·재색인을 먼저 20~50% 줄입니다.
2. **bulk delete 중지**: 삭제성 작업은 tombstone을 더 쌓으므로 먼저 멈춥니다.
3. **hot partition 격리**: 상위 1% key가 전체 write의 20% 이상이면 분리 또는 rate limit을 검토합니다.
4. **repair/streaming throttling**: 복구 트래픽이 겹치면 일반 읽기 p99를 더 망가뜨립니다.
5. **compaction 증설 또는 수동 정리**: 위 네 가지를 한 뒤에야 스레드/throughput 상향이 의미가 있습니다.

이 순서를 거꾸로 하면 디스크와 CPU를 더 태우면서 사용자 지연시간만 키우기 쉽습니다.

### 3) 설계 단계에서 미리 박아둘 상수

- TTL 종류 수: 운영 초기에 **10개 이하**로 제한
- delete batch 크기: 샤드당 한 번에 **10만~50만 건 이하**부터 시작
- compaction window: 시계열 데이터는 **1시간 또는 1일 단위**처럼 예측 가능한 버킷 선호
- disk free SLO: 노드 디스크 **최소 30% 여유** 유지
- hot key 경보: 단일 파티션이 **전체 쓰기의 5% 초과** 시 조사 시작

숫자는 워크로드마다 달라지지만, 중요한 건 "TTL은 자유롭게", "대량 삭제는 필요할 때 한 번에" 같은 정책을 그대로 두지 않는 것입니다. LSM 계열에서는 그 자유도가 나중에 compaction debt로 청구됩니다.

### 4) 추천 도입 순서

**1주차, debt 관측 추가**  
L0 파일 수, pending compaction bytes, write stall, tombstone scan ratio를 대시보드에 올립니다.

**2주차, TTL/삭제 패턴 분류**  
테이블별 TTL 종류, 대량 삭제 빈도, hot partition 여부를 목록화합니다.

**3주차, workload 분리**  
delete-heavy와 read-heavy 데이터를 컬럼 패밀리 또는 테이블로 분리할 후보를 정합니다.

**4주차, 복구 리허설**  
백필 + TTL 만료 + peak read를 겹쳐 작은 샤드에서 compaction debt 재현 테스트를 해봅니다.

실무에서는 튜닝 값보다 이 리허설이 훨씬 중요합니다. compaction 사고는 보통 평일 낮 정상 부하보다, 배치와 복구가 겹치는 어정쩡한 시간에 터집니다.

## 트레이드오프/주의점

aggressive compaction은 읽기 성능과 space amplification을 개선하지만 write amplification, SSD 마모, 백그라운드 CPU 사용량을 키웁니다. 반대로 느슨한 compaction은 평소 쓰기 처리량은 좋지만 tombstone 누적과 read fan-out을 키웁니다. TTL 버킷을 단순화하면 운영은 편해지지만 제품 요구의 세밀한 만료 정책과 충돌할 수 있고, workload 분리는 효과가 크지만 테이블 수 증가와 운영 복잡도를 가져옵니다.

또 하나 중요한 주의점은, compaction debt를 캐시 hit rate로 가리는 습관입니다. 캐시가 버텨 주는 동안엔 괜찮아 보여도, 캐시 미스가 늘거나 재시작이 나면 debt가 바로 사용자 지연시간으로 드러납니다. 그래서 캐시를 보기 전에 저장소 자체 debt를 먼저 보는 편이 안전합니다. 이 지점은 [Cache Warmup과 Cold Start 플레이북](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/)과 같이 보면 더 명확합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] `l0_files`, `pending_compaction_bytes`, `write_stall_p99`, `tombstone_scan_ratio`를 본다.
- [ ] 평균 ingest 대비 지속 compaction throughput 비율을 계산한다.
- [ ] TTL 종류 수와 대량 삭제 배치를 제한하는 운영 규칙이 있다.
- [ ] delete-heavy 데이터와 read-heavy 데이터를 분리할 후보를 검토했다.
- [ ] 디스크 여유 공간 30% 이하에서 자동 경보가 울린다.

### 연습 과제

1. 운영 중인 LSM 계열 저장소 하나를 골라, 최근 7일 기준 ingest throughput과 compaction throughput의 비율을 계산해 보세요. 숫자로 적는 순간 debt가 언제부터 쌓였는지 보일 가능성이 큽니다.  
2. TTL이 서로 다른 데이터셋 3개를 골라, 지금의 TTL 정책을 버킷형으로 단순화했을 때 얻는 이점과 잃는 점을 표로 정리해 보세요.  
3. 최근 대량 삭제 작업 하나를 골라, 삭제 직후가 아니라 6시간 뒤와 24시간 뒤에 어떤 지표가 변했는지 비교해 보세요. tombstone 비용이 언제 현실화되는지 감이 훨씬 빨리 잡힙니다.

## 관련 글

- [스토리지 엔진 내부: B-Tree vs LSM-Tree](/learning/deep-dive/deep-dive-database-engines-lsm/)
- [Hot Partition과 Partition Key Skew 실무 플레이북](/learning/deep-dive/deep-dive-hot-partition-partition-key-skew-playbook/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Quorum Read/Write + Read Repair 플레이북](/learning/deep-dive/deep-dive-quorum-read-write-read-repair-playbook/)
- [Cache Warmup과 Cold Start 플레이북](/learning/deep-dive/deep-dive-cache-warmup-cold-start-playbook/)
