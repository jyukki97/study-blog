---
title: "백엔드 커리큘럼 심화: PostgreSQL Transaction ID Wraparound과 Freeze, 정상 트래픽을 멈추기 전에 막는 운영 플레이북"
date: 2026-10-10T10:06:00+09:00
lastmod: 2026-10-10T10:06:00+09:00
draft: false
topic: "Backend Data Operations"
tags: ["PostgreSQL", "Autovacuum", "Transaction ID", "MVCC", "Database Operations", "Freeze"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL의 transaction ID wraparound가 왜 읽기 트래픽을 멈출 수 있는지, age·freeze·autovacuum·장기 트랜잭션을 함께 관찰하고 안전하게 완화하는 운영 기준을 정리합니다."
module: "backend-data-system"
study_order: 1261
keywords: ["postgresql xid wraparound", "vacuum freeze", "relfrozenxid", "autovacuum freeze", "long transaction postgres"]
key_takeaways:
  - "Wraparound 대응의 목표는 emergency vacuum을 빨리 한 번 끝내는 것이 아니라, 가장 오래된 테이블과 장기 트랜잭션이 freeze 작업을 계속 따라잡을 수 있게 만드는 것이다."
  - "database age 하나만 보지 말고 table age, vacuum 진행률, long-running transaction, replication slot·replica feedback을 같은 시간축에서 본다."
  - "경고 단계에서는 autovacuum의 처리량과 방해 요인을 조정하고, 위험 단계에서는 쓰기 부하·DDL·대형 배치를 줄여 freeze가 전진할 수 있는 창을 만든다."
operator_checklist:
  - "일일 점검에 database·table별 `age(relfrozenxid)`, autovacuum 실행 이력, 15분 이상 열린 transaction, replication slot 상태를 포함한다."
  - "기본값을 복사하지 말고 테이블 크기·write rate·maintenance I/O 예산에 맞춰 `autovacuum_freeze_max_age`와 freeze scale factor를 정한다."
  - "wraparound 위험 시에는 `VACUUM FULL`이나 무계획 재시작을 먼저 하지 않고, 가장 오래된 relation과 vacuum blocker를 확인한다."
  - "freeze 작업 중에는 primary write p95, replica lag, dead tuple 증가율, vacuum 진행률을 중단·확대 기준으로 기록한다."
---

PostgreSQL에서 autovacuum 경고는 흔히 “디스크를 조금 정리하라는 메시지”로 오해됩니다. 그러나 transaction ID(XID) wraparound 관련 경고는 성격이 다릅니다. PostgreSQL의 MVCC는 row 버전이 어느 transaction에서 만들어지고 지워졌는지 XID로 판단합니다. 이 번호는 무한히 커지지 않는 순환 공간이므로, 너무 오래된 tuple을 적절히 freeze하지 못하면 오래된 XID와 새 XID의 선후 관계를 안전하게 해석할 수 없습니다. 끝 단계에서는 데이터 손상을 피하기 위해 서버가 새 transaction을 막을 수 있습니다.

즉, 이 문제의 목표는 “오늘 밤에 vacuum을 한 번 돌린다”가 아닙니다. **정상 쓰기와 복제를 해치지 않는 속도로 가장 오래된 relation을 계속 freeze하고, 그 작업을 막는 장기 transaction과 feedback을 제어하는 것**입니다. 이 글은 [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/), [WAL·Checkpoint·Replication Lag](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/), [대량 삭제의 청크·키셋·락 예산](/learning/deep-dive/2026-10-09-chunked-delete-keyset-lock-budget-playbook/), [백업·DR 전략](/learning/deep-dive/deep-dive-backup-dr-strategy/)을 XID 수명 관점으로 연결합니다.

## 이 글에서 얻는 것

- XID wraparound가 일반적인 dead tuple 정리와 다른, 가용성 우선의 문제인 이유를 설명할 수 있습니다.
- database age, table `relfrozenxid`, long-running transaction, replica feedback 중 무엇을 먼저 확인할지 정할 수 있습니다.
- 평시·경고·위험 단계에서 autovacuum과 운영 부하를 어떻게 조절할지 숫자로 시작할 수 있습니다.
- 수동 vacuum, 대형 배치, DDL, failover를 어떤 순서로 검토해야 하는지 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) XID는 순환하고, freeze는 오래된 버전을 안전한 기준점으로 바꾼다

PostgreSQL은 새 transaction마다 XID를 할당합니다. tuple의 `xmin`과 `xmax`는 그 버전의 생성·삭제와 연관된 XID를 가리키며, snapshot은 이를 바탕으로 현재 transaction에 보여야 할 row를 정합니다. XID 공간은 약 20억 개의 과거 transaction과의 상대 관계를 안전하게 비교할 수 있도록 설계돼 있습니다. 그래서 아주 오래된 tuple을 그대로 방치하면 번호가 한 바퀴 돈 뒤의 새 XID와 순서를 혼동할 위험이 생깁니다.

`VACUUM`의 freeze 작업은 충분히 오래되어 모든 정상 snapshot에 대해 이미 확정된 tuple의 XID를 특별한 동결 값으로 표시합니다. 이 tuple은 더 이상 과거 XID 비교에 의존하지 않습니다. 여기서 중요한 점은 freeze가 “삭제된 row를 치우는 일”과 같지 않다는 것입니다. 살아 있는 row가 많고 삭제가 거의 없는 테이블도 나이가 들면 freeze가 필요합니다. 수년간 거의 수정하지 않은 대형 audit 테이블이 위험의 출발점이 될 수 있는 이유입니다.

운영 화면에서 다음 수치를 분리해 봐야 합니다.

| 지표 | 질문 | 단독 해석의 함정 |
| --- | --- | --- |
| database XID age | 전체 DB가 위험선에 얼마나 가까운가 | 어느 relation이 원인인지 알려주지 않는다 |
| `age(relfrozenxid)` | 어떤 테이블이 freeze 진도를 늦추는가 | partition·TOAST table을 빼면 원인을 놓친다 |
| oldest transaction age | snapshot이 cleanup을 막는가 | idle connection 자체와 혼동하기 쉽다 |
| autovacuum duration/progress | worker가 실제로 전진하는가 | 실행 횟수만으로 완료를 판단하면 안 된다 |
| replica feedback·slot | primary가 오래된 row를 보존 중인가 | replica lag가 낮아도 feedback은 남을 수 있다 |

### 2) 장기 transaction은 vacuum의 시간 기준을 과거에 묶는다

오래 열린 transaction 또는 idle-in-transaction session은 자신의 오래된 snapshot을 유지할 수 있습니다. vacuum은 그 snapshot이 볼 수 있는 row version을 함부로 제거하지 못하고, freeze·정리의 효과가 늦어집니다. 논리 replication slot, `hot_standby_feedback`, 장시간 분석 쿼리도 비슷하게 primary의 cleanup horizon을 과거에 붙잡을 수 있습니다.

그래서 “autovacuum worker 수를 늘렸는데 age가 줄지 않는다”는 상황에서는 I/O 설정부터 더 키우지 말아야 합니다. 먼저 `pg_stat_activity`에서 15분 이상 열린 write transaction과 60분 이상 열린 read transaction을 조사하고, `pg_stat_replication`·`pg_replication_slots`에서 재시작 LSN과 active 여부를 확인합니다. 임계 시간은 제품마다 다르지만, 온라인 OLTP의 첫 시작선으로는 **15분 이상 열린 write transaction은 경보**, **1시간 이상 열린 snapshot은 owner 확인**, **24시간 이상은 원인과 종료 계획이 없는 한 incident**로 분류할 수 있습니다. 백업·월말 정산처럼 예외가 필요한 작업은 시작 전 예상 종료 시각과 영향 테이블을 명시해야 합니다.

### 3) 위험도는 하나의 절대 숫자 대신 세 단계로 운영한다

PostgreSQL 설정과 버전에 따라 경고·중단 임계값은 다르므로, 특정 숫자를 모든 시스템에 그대로 복사하면 안 됩니다. 다만 `autovacuum_freeze_max_age`를 기준으로 내부 action line을 만들어야 합니다. 예를 들어 2억을 설정했다면 table age가 그 값의 60%, 75%, 85%에 이르는 시점을 각각 주의, 경고, 위험으로 둘 수 있습니다. database age가 낮아 보여도 단일 대형 relation이 빠르게 늙으면 먼저 대응합니다.

| 단계 | 예시 기준 | 우선 행동 | 확대·중단 기준 |
| --- | --- | --- | --- |
| 평시 | 최대 table age < freeze max age의 60% | 주간 trend·blocker 확인, 큰 테이블별 vacuum 이력 기록 | 2주 연속 age 증가 속도가 처리 속도보다 빠르면 튜닝 review |
| 주의 | 60~75% | 해당 relation의 scale factor·threshold 검토, 장기 transaction 정리 | vacuum이 24시간 안에 진전을 못 보이면 경고 승격 |
| 경고 | 75~85% | off-peak vacuum window, 대형 batch·index build 연기, replica feedback 조사 | primary write p95가 baseline 대비 20% 악화하면 비용 설정을 낮추고 재평가 |
| 위험 | 85% 이상 또는 서버 경고 | 가장 오래된 relation을 중심으로 incident, 변경 동결, write burst 제한 | 운영자가 완료·age 하락을 확인하기 전까지 비필수 대형 작업 금지 |

여기서 60/75/85%는 제품의 write rate와 테이블 크기로 보정할 시작값입니다. 하루에 수천만 XID를 쓰는 서비스라면 10%의 여유가 며칠밖에 안 될 수 있으므로, 현재 age와 최근 7일 XID 소비량으로 “임계값까지 남은 일수”도 계산해야 합니다. 남은 시간이 maintenance window보다 짧다면 이미 경고 단계로 올려야 합니다.

## 실무 적용

### 1) relation 단위 inventory와 alarm을 만든다

먼저 모든 database의 `datfrozenxid`와 사용자 table·materialized view·TOAST relation의 `relfrozenxid`를 나이순으로 수집합니다. 상위 20개만 표시하면 충분하지 않을 수 있습니다. 대형 partition table은 parent뿐 아니라 오래된 child partition이 독립적으로 늙을 수 있으므로, relation 크기·partition·owner·write rate를 함께 저장합니다. 점검 결과는 “현재 최댓값”과 “지난 7일 증가량”을 같이 보관해야 합니다.

알람은 database age 하나가 아니라 세 신호를 조합합니다. 예를 들어 `max_table_age_ratio >= 0.75`, 최근 24시간 autovacuum 완료가 0회, 1시간 넘는 transaction이 하나 이상이라는 세 조건 중 두 개가 겹치면 담당자에게 page합니다. 반대로 ratio가 0.5인데 대형 테이블 vacuum이 20분 동안 진행 중이라는 사실만으로 경보를 내면 운영자가 중요한 신호를 무시하게 됩니다. 알람의 목적은 vacuum 존재를 알리는 것이 아니라 **freeze가 추세상 따라잡지 못하는지**를 알려주는 것입니다.

### 2) autovacuum은 전역 최대치보다 테이블별 정책부터 조정한다

모든 테이블에 같은 scale factor를 쓰면 수십억 row의 append-heavy 테이블은 너무 늦게, 작은 hot table은 너무 자주 vacuum할 수 있습니다. write가 많은 대형 table에는 `ALTER TABLE ... SET (autovacuum_vacuum_scale_factor = ..., autovacuum_vacuum_threshold = ..., autovacuum_vacuum_cost_limit = ...)`처럼 테이블별 값을 두고, 핵심 OLTP table과 대형 archive table의 정책을 분리합니다.

처음부터 worker 수와 cost limit을 크게 올리면 정상 읽기·쓰기의 I/O 예산을 빼앗을 수 있습니다. 다음 순서가 안정적입니다.

1. 가장 오래된 relation과 blocker를 확인한다.
2. 해당 relation에만 보수적으로 freeze trigger를 앞당긴다.
3. off-peak에서 `VACUUM (VERBOSE, ANALYZE)`를 실행하되, 결과·시작 age·종료 age·소요 시간을 runbook에 기록한다.
4. write p95, disk utilization, WAL 생성량, replica lag를 5분 단위로 본다.
5. 정상 쓰기 지연이 baseline보다 20% 이상 나빠지거나 replica lag가 서비스 RPO를 넘으면 cost·worker를 낮추고 원인을 분리한다.

수동 `VACUUM FREEZE`는 위험 relation을 빠르게 밀어주는 도구지만 일상적인 대체물이 아닙니다. `VACUUM FULL`은 강한 lock과 재작성 비용이 있어 wraparound 압박을 받는 production table의 첫 대응으로 쓰기 어렵습니다. 디스크 회수가 별도 목표라면 freeze 회복과 테이블 재작성 계획을 분리하고, [대량 삭제의 락 예산](/learning/deep-dive/2026-10-09-chunked-delete-keyset-lock-budget-playbook/)처럼 서비스 부하 속에서 실행할 창을 따로 설계하세요.

### 3) 쓰기 폭주와 schema 작업을 freeze 작업과 겹치지 않게 한다

대량 import, backfill, 일괄 delete, 대형 index 생성은 XID·WAL·I/O를 함께 증가시킵니다. XID 위험 단계에서 이 작업을 “야간이니까” 시작하면 autovacuum이 따라잡을 여지를 더 줄일 수 있습니다. 데이터 변경 job은 테넌트별 동시 실행 수, commit batch, pause switch를 가져야 하며, transaction 하나에 수십만 row를 오래 잡지 않도록 나눠야 합니다.

가령 새 backfill이 필요하다면 초기값을 `batch 1,000~5,000 row`, transaction 30초 이내, 동시 worker 1개로 잡고 관측 후 올립니다. 긴 transaction이 생기면 성공 처리 대신 중단·재개 위치를 기록하는 편이 낫습니다. 이 원칙은 [온라인 스키마 변경과 Expand-Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)의 “작고 되돌릴 수 있는 단계”와 같습니다. freeze debt가 높은 주에는 새 대형 DDL보다 기존 데이터 위생을 먼저 복구하는 우선순위를 둡니다.

## 트레이드오프/주의점

1. **aggressive freeze는 무료가 아니다.** 더 자주 읽고 쓰는 maintenance I/O가 필요하다. 위험을 줄이려다 정상 트래픽의 p99를 망치지 않도록 resource budget을 둔다.
2. **replica를 무조건 죽여 해결하지 않는다.** 오래된 replication slot이나 feedback은 원인이 될 수 있지만, 먼저 어떤 consumer·DR 절차가 의존하는지 확인한다. slot을 잃으면 재동기화 비용이 더 큰 장애가 될 수 있다.
3. **failover는 age를 마법처럼 없애지 않는다.** 새 primary의 relation age와 replication 구성을 재확인해야 한다. failover 직후 vacuum blocker가 사라지는 경우도 있지만, 검증 없는 전환은 원인을 다른 노드로 옮길 뿐이다.
4. **backup 성공과 freeze 건강은 별개다.** 백업이 복구 가능한지와 transaction horizon이 정상인지 각각 점검해야 한다. 복구 연습에는 age·autovacuum 정책이 기대대로 따라오는지 확인하는 절차도 넣는다.
5. **managed DB의 자동화도 관찰 대상이다.** provider가 maintenance를 대신해도 table별 age, long transaction, replica 정책은 애플리케이션 팀의 사용 방식에 따라 달라진다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] database·table·TOAST·partition별 freeze age와 최근 7일 증가량을 수집한다.
- [ ] `autovacuum_freeze_max_age` 대비 60/75/85% action line과 담당자를 정한다.
- [ ] 15분 이상 write transaction, 1시간 이상 read snapshot의 owner·종료 기준을 문서화한다.
- [ ] replication slot과 `hot_standby_feedback`이 cleanup horizon에 미치는 영향을 정기 점검한다.
- [ ] vacuum 중 primary write p95, replica lag, WAL·disk I/O, 진행률을 같은 대시보드에서 본다.
- [ ] 위험 단계에는 비필수 backfill·대형 delete·index build를 pause할 수 있다.
- [ ] 수동 vacuum 결과에 시작/종료 age, 대상 relation, 소요 시간, 서비스 지표 변화를 남긴다.

### 연습

운영 database 하나에서 age가 가장 높은 relation 5개를 뽑고, 각 항목에 크기·write rate·마지막 vacuum·partition 여부·장기 transaction blocker를 적어 보세요. 그중 하나를 골라 “75% 경고선에 도달했을 때 24시간 안에 할 일”을 작성합니다. 최소한 owner 확인, blocker 정리, 관찰할 지표 4개, pause할 batch, 성공 조건(`age` 하락과 p95·lag 안정)을 포함해야 합니다. 이 목록이 없다면 wraparound 대응은 경보를 본 뒤 급히 명령을 실행하는 작업에 머뭅니다.

## 관련 글

- [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)
- [PostgreSQL WAL·Checkpoint·Replication Lag](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/)
- [대량 삭제를 청크·키셋·락 예산으로 안전하게 운영하는 법](/learning/deep-dive/2026-10-09-chunked-delete-keyset-lock-budget-playbook/)
- [온라인 스키마 변경과 Expand-Contract 마이그레이션](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)
- [백업·DR 전략](/learning/deep-dive/deep-dive-backup-dr-strategy/)
