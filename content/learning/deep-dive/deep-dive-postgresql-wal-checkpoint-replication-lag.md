---
title: "백엔드 커리큘럼 심화: PostgreSQL WAL, Checkpoint, Replication Lag를 한 흐름으로 보는 운영 기준"
date: 2026-04-19
draft: false
topic: "Database"
tags: ["PostgreSQL", "WAL", "Checkpoint", "Replication Lag", "Performance", "Operations"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL에서 WAL 생성, 체크포인트, 복제 지연을 따로 보지 않고 하나의 쓰기 경로로 묶어 판단하는 실무 기준을 정리합니다."
module: "database"
study_order: 1177
---

운영 중인 PostgreSQL이 갑자기 느려질 때 팀이 자주 놓치는 것이 있습니다. 애플리케이션에서는 `commit`이 느려지고, 모니터링에서는 디스크 쓰기와 복제 지연이 같이 튀는데, 원인을 각각 다른 문제로 나눠 보는 것입니다. 하지만 실제로는 **WAL 생성, checkpoint, replication lag가 하나의 쓰기 파이프라인**으로 연결돼 있는 경우가 많습니다. WAL이 빨리 쌓이면 checkpoint 압력이 커지고, 디스크 flush가 밀리면 commit latency가 올라가고, standby가 그 WAL을 제때 재생하지 못하면 read replica가 뒤처집니다.

그래서 실무에서는 "복제가 느리다", "체크포인트가 잦다", "DB 쓰기가 무겁다"를 따로 보지 않고 한 흐름으로 묶어 판단해야 합니다. 이 글은 [DB 복제 & 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/), [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/), [Backup/DR 전략](/learning/deep-dive/deep-dive-backup-dr-strategy/)에서 이어지는 관점으로, WAL에서 replica 적용까지를 운영 숫자 중심으로 정리합니다.

## 이 글에서 얻는 것

- WAL, checkpoint, replication lag가 왜 한 문제처럼 움직이는지 설명할 수 있습니다.
- commit latency, WAL 생성량, lag seconds, lag bytes를 어떤 우선순위로 봐야 하는지 기준을 잡을 수 있습니다.
- PostgreSQL 튜닝에서 파라미터만 만지기 전에 어떤 워크로드 조건을 먼저 확인해야 하는지 판단할 수 있습니다.
- 사용자 영향이 생기기 전에 경고를 올리고, 30분 안에 완화하는 운영 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) WAL은 단순 로그가 아니라 쓰기 경로의 중심이다

PostgreSQL의 모든 변경은 먼저 WAL(Write Ahead Log)에 기록됩니다. 이 구조 덕분에 크래시 복구와 복제가 가능하지만, 반대로 말하면 **WAL 경로가 막히면 쓰기 성능과 복제 안정성이 함께 흔들립니다.** 애플리케이션이 느끼는 `commit` 지연은 단순히 테이블이 커서 생기는 것이 아니라, 아래 세 요소가 겹친 결과일 수 있습니다.

1. 트랜잭션이 너무 큰 batch로 묶여 WAL burst를 만든다.
2. checkpoint가 너무 자주 돌거나 너무 급하게 flush한다.
3. standby가 WAL 적용 속도를 따라가지 못해 lag가 누적된다.

핵심은 WAL 생성량 자체보다 **생성 속도와 소비 속도의 균형**입니다. 초당 20MB WAL이 꾸준히 나오는 시스템은 버틸 수 있어도, 평소 2MB/s이던 시스템이 배치 5분 동안 120MB/s로 튀면 checkpoint와 replica가 동시에 밀릴 수 있습니다. 그래서 WAL은 평균보다 피크를 보는 편이 맞습니다.

### 2) checkpoint는 메모리를 디스크로 정리하는 과정이지만, 잘못 맞추면 지연 스파이크를 만든다

checkpoint는 dirty buffer를 디스크에 내리고, 복구 시작 지점을 당기는 작업입니다. 문제는 이 과정이 너무 자주 발생하면 쓰기 I/O가 급증하고, 너무 늦으면 crash recovery 시간과 WAL 보관량이 커진다는 점입니다. 결국 checkpoint는 "적을수록 좋다"도 아니고 "자주 해야 안전하다"도 아닙니다.

실무에서 먼저 볼 기준은 아래 정도가 출발점으로 괜찮습니다.

- `checkpoints_req`가 `checkpoints_timed`보다 자주 많아지면, 시간 기반보다 **WAL 용량 한도에 먼저 걸리고 있다**는 뜻입니다.
- `checkpoint_write_time + checkpoint_sync_time`가 평소 대비 2배 이상 튀고 같은 시점에 `commit p95`가 함께 상승하면, checkpoint pressure를 의심할 가치가 큽니다.
- 대화형 서비스에서 `commit p95`가 20ms를 넘는 구간이 5분 이상 지속되면 애플리케이션 재시도와 커넥션 정체가 붙기 시작합니다.

여기서 중요한 의사결정 순서는 `파라미터 조정`보다 `쓰기 패턴 확인`이 먼저라는 점입니다. 10만 건 UPDATE를 한 트랜잭션으로 밀어 넣는 배치라면 `max_wal_size`만 올려도 해결이 제한적입니다. 이런 경우는 [온라인 DDL Expand/Contract](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)나 [배치 멱등성/재처리 플레이북](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)처럼 작업 단위를 줄이는 쪽이 먼저입니다.

### 3) replication lag는 "복제 기능 문제"가 아니라 WAL 소비 속도 부족 신호다

standby는 primary가 만든 WAL을 받아서 재생합니다. 따라서 lag는 네트워크만의 문제가 아니라, **standby CPU, 디스크, 긴 replay 지점, vacuum 충돌, 대형 트랜잭션 재생 비용**이 함께 만든 결과입니다. 그래서 lag를 초 단위 하나만 보면 판단이 늦습니다.

함께 봐야 할 핵심 지표는 최소 네 가지입니다.

- `lag seconds`: 사용자 체감과 운영 경보에 직결
- `lag bytes`: 대형 burst를 빠르게 감지하는 데 유리
- `WAL generation rate`: primary가 얼마나 빠르게 로그를 만들고 있는지
- `replay/apply throughput`: standby가 실제로 얼마나 따라가고 있는지

추천 출발 기준은 아래처럼 두 단계로 나누는 편이 현실적입니다.

- **대화형 서비스 경고선**: lag 5초 초과 3분 지속 또는 lag bytes 512MB 초과
- **즉시 완화선**: lag 30초 초과 또는 lag bytes 2GB 초과, 동시에 read-after-write 오류가 관측됨
- **분석/배치 전용 replica**는 위 기준을 느슨하게 둘 수 있지만, 그래도 lag 추세가 계속 우상향이면 쓰기 폭증이나 apply 병목을 먼저 의심해야 합니다.

이 판단은 [DB Failover & Fencing 플레이북](/learning/deep-dive/deep-dive-db-failover-fencing-playbook/)과 같이 봐야 합니다. lag가 큰 replica를 그냥 승격 후보로 두면 RPO 계산이 흐려지고, 장애 전환 때 더 큰 문제를 만들 수 있기 때문입니다.

### 4) 파라미터는 중요하지만, 튜닝 우선순위는 항상 워크로드부터다

PostgreSQL 운영에서 흔한 실수는 `checkpoint_timeout`, `max_wal_size`, `wal_compression`, `synchronous_commit` 같은 옵션을 먼저 건드리는 것입니다. 물론 필요하지만, 우선순위는 아래가 더 안전합니다.

1. **트랜잭션 크기**: 한 번에 너무 많이 쓰지 않는가
2. **쓰기 분포**: 특정 분, 특정 테이블, 특정 배치에 몰리지 않는가
3. **standby 스펙**: primary보다 지나치게 약하지 않은가
4. **I/O 여유도**: checkpoint 순간에도 디스크 큐가 버틸 수 있는가
5. **파라미터 조정**: 그 다음에 `max_wal_size`, `checkpoint_completion_target` 등을 조정

예를 들어 `checkpoint_timeout=5min`, `max_wal_size=1GB`로 운영하는데 피크 시간 WAL 생성량이 200MB/min이라면 5분을 채우기 전에 용량 한도에 걸려 request checkpoint가 반복될 가능성이 큽니다. 이때는 `max_wal_size`를 늘려 **최소 30~60분 피크 WAL을 흡수할 수 있는지**부터 보는 편이 낫습니다. 반대로 WAL은 충분한데 standby apply가 느리면 `wal_compression`보다 standby 디스크와 CPU, 긴 쿼리 충돌, replica 전용 vacuum 정책을 먼저 점검해야 합니다.

## 실무 적용

### 1) 장애 전이 전에 보는 운영 대시보드 5종

운영 화면은 복잡할수록 오히려 늦습니다. 아래 다섯 개를 한 화면에서 같이 봐야 판단이 빨라집니다.

1. `commit p95 / p99`
2. `WAL bytes per second`
3. `checkpoints_req`, `checkpoint_write_time`, `checkpoint_sync_time`
4. `replication lag seconds / bytes`
5. 디스크 `await`, queue depth, write IOPS

여기서 추천 우선순위는 **사용자 영향 → WAL 생성 압력 → flush 압력 → replica 소비 속도**입니다. replica lag만 보고 있으면 이미 commit이 느려진 뒤일 수 있습니다.

### 2) 실무 기준(숫자·조건·우선순위)

아래는 시작점으로 쓰기 좋은 기준입니다.

- `commit p95 > 20ms` 5분 지속: 경고
- `commit p95 > 50ms` 또는 timeout 증가: 즉시 원인 분석 시작
- `checkpoints_req / (checkpoints_req + checkpoints_timed) > 0.3`: WAL 용량 압박 의심
- lag `> 5초` 3분 지속: read routing 보수적으로 전환 검토
- lag `> 30초` 또는 `> 2GB`: replica 읽기 차단 또는 primary 폴백 검토
- WAL 생성량이 평시 대비 `3배 이상` 급증: 배치/대량 수정/DDL 여부 우선 확인

우선순위는 다음이 안전합니다.

1. 사용자 쓰기 실패와 지연 상승 차단
2. replica stale read 차단
3. checkpoint 폭주 완화
4. 장기 구조 수정

### 3) 기본 설정을 점검할 때의 출발선

환경마다 다르지만, 아래 정도는 출발선으로 자주 씁니다.

- `checkpoint_completion_target`: 0.9 근처에서 시작
- `max_wal_size`: 피크 30~60분 WAL을 버틸 수 있게 산정
- `checkpoint_timeout`: 5~15분 범위에서 워크로드 기준 결정
- `wal_compression`: full page write 부담이 큰 환경이면 검토
- `synchronous_commit`: 핵심 경로만 엄격히, 나머지는 업무 특성에 따라 분리 검토

단, 이 값들을 일괄적으로 올리기보다 [Linux I/O 모델](/learning/deep-dive/deep-dive-linux-io-models/)과 스토리지 특성을 먼저 확인해야 합니다. 디스크가 이미 포화된 상태에서 `max_wal_size`만 키우면 문제를 뒤로 미루는 데 그칠 수 있습니다.

### 4) 30분 완화 런북 예시

- **0~5분**: commit latency, lag seconds/bytes, 최근 배포·배치 여부 확인
- **5~10분**: lag 큰 replica 읽기 제외, read-after-write 경로 primary 고정
- **10~20분**: 문제 배치 중지 또는 chunk 축소, 대형 트랜잭션 분할 검토
- **20~30분**: checkpoint/WAL 설정 재평가, standby apply 병목과 디스크 여유도 점검

핵심은 이 단계에서 완벽한 원인 규명보다 **stale read와 write latency 전이 차단**을 먼저 하는 것입니다.

## 트레이드오프/주의점

첫째, `max_wal_size`를 크게 잡으면 request checkpoint는 줄어들 수 있지만, 장애 시 복구 시간이 길어지고 디스크 여유가 더 필요합니다.

둘째, checkpoint를 너무 드물게 만들면 평소 성능은 좋아 보여도 장애 복구 시간이 길어질 수 있습니다. 운영 SLO뿐 아니라 RTO도 같이 봐야 합니다.

셋째, lag 기준을 너무 빡빡하게 잡으면 replica를 자주 제외하게 되어 primary 부하가 치솟을 수 있습니다. 반대로 너무 느슨하면 stale read를 오래 허용하게 됩니다.

넷째, standby 스펙을 primary보다 과하게 낮추면 평상시엔 버텨도 피크 burst에서 반드시 밀립니다. 복제는 "남는 서버"가 아니라 **같은 쓰기 속도를 따라갈 수 있는 서버**가 맡아야 합니다.

다섯째, autovacuum과 checkpoint를 분리해서 보면 안 됩니다. bloat가 커지고 vacuum이 밀리면 결국 더 많은 I/O와 WAL 압력을 부르게 됩니다. 그래서 [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)과 같이 운영해야 의미가 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] commit latency, WAL 생성량, checkpoint 시간, replication lag를 한 화면에서 본다.
- [ ] lag seconds뿐 아니라 lag bytes도 경보 기준에 포함한다.
- [ ] `checkpoints_req` 비중이 높을 때 배치/DDL/대형 트랜잭션을 먼저 확인한다.
- [ ] replica 제외 기준과 primary 폴백 기준이 문서화돼 있다.
- [ ] 피크 시간 WAL 생성량 기준으로 `max_wal_size`를 산정한다.
- [ ] 장애 시 30분 완화 순서가 온콜 런북에 고정돼 있다.

### 연습 과제

1. 최근 7일 기준으로 시간대별 WAL 생성량을 그려 보고, 평시 대비 3배 이상 튄 구간에 어떤 배치나 대량 수정이 있었는지 연결해 보세요.
2. `checkpoints_req`와 `commit p95`를 같은 그래프에 올려, request checkpoint가 실제 사용자 지연과 얼마나 같이 움직이는지 확인해 보세요.
3. replica 1개를 골라 `lag seconds`, `lag bytes`, `apply throughput`를 함께 수집하고, 어떤 값이 먼저 이상 신호를 주는지 비교해 보세요.

## 관련 글

- [DB 복제 & 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)
- [DB Failover & Fencing 플레이북](/learning/deep-dive/deep-dive-db-failover-fencing-playbook/)
- [Backup/DR 전략](/learning/deep-dive/deep-dive-backup-dr-strategy/)
- [Linux I/O 모델 정리](/learning/deep-dive/deep-dive-linux-io-models/)
