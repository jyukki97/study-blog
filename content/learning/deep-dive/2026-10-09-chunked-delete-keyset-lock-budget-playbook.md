---
title: "백엔드 커리큘럼 심화: 대량 삭제를 청크·키셋·락 예산으로 안전하게 운영하는 법"
date: 2026-10-09T10:06:00+09:00
lastmod: 2026-10-09T10:06:00+09:00
draft: false
topic: "Backend Data Operations"
tags: ["PostgreSQL", "Data Retention", "Batch", "Keyset Pagination", "Autovacuum", "Database Operations"]
categories: ["Backend Deep Dive"]
description: "보존 기간 만료 데이터를 삭제할 때 한 번의 대형 DELETE 대신 keyset 기반 청크, 속도 제어, 검증 원장을 사용해 락·replica lag·vacuum 부하를 제한하는 운영 기준을 정리합니다."
module: "backend-data-system"
study_order: 1260
keywords: ["chunked delete", "keyset deletion", "database lock budget", "postgresql delete batch", "data retention purge"]
key_takeaways:
  - "대량 삭제의 단위는 SQL 한 문장의 성공이 아니라 정상 쓰기와 복제를 해치지 않는 작은 commit과 재개 가능한 실행 기록이다."
  - "OFFSET은 삭제 중인 집합에서 건너뜀과 불필요한 스캔을 만들 수 있으므로 안정된 정렬 키와 watermark를 쓰는 keyset 방식이 기본값이다."
  - "batch size는 고정 성능 튜닝 값이 아니라 lock wait, replica lag, WAL·I/O, 사용자 쓰기 지연을 입력으로 조절하는 제어값이다."
operator_checklist:
  - "삭제 대상의 시간 경계, tenant 범위, legal hold, source of truth를 purge 실행 전 immutable manifest로 고정한다."
  - "각 commit 뒤 progress watermark와 삭제 건수·오류·속도 제한 결정을 기록해 중단 뒤에도 같은 범위를 안전하게 재개한다."
  - "대량 삭제 중에는 lock wait p95, primary write latency, replica lag, dead tuple·autovacuum 상태를 함께 보고 중단 기준을 둔다."
  - "파티션 전체가 만료된 경우 row-by-row delete보다 partition detach/drop과 보존 증적 절차를 먼저 검토한다."
---

보존 기간이 끝난 로그, 만료된 세션, 탈퇴 테넌트의 보조 데이터, 재생성 가능한 집계 데이터를 정리해야 할 때 가장 먼저 떠올리기 쉬운 명령은 DELETE FROM events WHERE created_at < ...입니다. 개발 데이터베이스에서는 빨리 끝나 보이지만, 운영에서는 한 문장이 수백만 행의 잠금·WAL·인덱스 갱신·replica 전송·vacuum 부담을 한꺼번에 만들 수 있습니다. 삭제가 끝나기 전까지 오래 열린 트랜잭션이 남고, 정상 쓰기 지연이 늘고, replica lag가 커져 읽기 경로까지 흔들리는 식입니다.

대량 삭제의 목표는 “가장 짧은 시간에 가장 많은 row를 없애기”가 아닙니다. **서비스의 정상 쓰기와 복제 지연이라는 예산 안에서, 중단돼도 같은 결과로 재개할 수 있게 데이터를 줄이는 것**입니다. 이 글은 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/), [시간 파티션 생명주기](/learning/deep-dive/deep-dive-postgresql-time-partition-lifecycle-playbook/), [온라인 스키마 변경](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)의 원칙을 purge batch 관점으로 연결합니다.

## 이 글에서 얻는 것

- 대형 DELETE가 단순 I/O 작업이 아니라 락, 복제, vacuum, 인덱스 쓰기를 함께 소비하는 작업임을 설명할 수 있습니다.
- OFFSET 대신 keyset과 watermark를 사용해 삭제 범위를 안정적으로 순회하는 기본 패턴을 잡을 수 있습니다.
- batch 크기와 sleep 간격을 고정값이 아니라 lock wait·replica lag·정상 쓰기 지연으로 제어하는 기준을 세울 수 있습니다.
- 보존 정책, legal hold, 재시작, 검증 증적을 포함한 purge runbook을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 삭제는 row 하나를 지우는 일보다 더 많은 상태를 바꾼다

PostgreSQL 같은 MVCC 데이터베이스에서 DELETE는 대개 즉시 파일 공간을 반환하는 동작이 아닙니다. 행을 다른 트랜잭션에서 보이지 않게 만들고, 관련 인덱스와 WAL을 갱신한 뒤, 나중에 vacuum이 죽은 tuple을 회수합니다. 따라서 “삭제 쿼리 CPU가 낮다”만으로 안전하다고 말할 수 없습니다. 대량 작업은 다음 경로를 동시에 압박합니다.

| 자원 | 먼저 보이는 신호 | 왜 위험한가 |
| --- | --- | --- |
| 락·트랜잭션 | lock wait, 오래 열린 transaction | 정상 update·DDL·vacuum이 기다릴 수 있다 |
| WAL·replication | WAL 생성량 급증, replica lag | read replica가 오래된 데이터를 제공하거나 failover 여유가 줄어든다 |
| 인덱스·I/O | disk queue, write latency 증가 | 삭제 대상보다 인덱스가 많을수록 쓰기 증폭이 커진다 |
| vacuum | dead tuple 증가, autovacuum lag | 테이블과 인덱스 bloat가 남아 이후 쿼리가 더 비싸진다 |
| 애플리케이션 | write p95/p99 상승, timeout | purge가 고객 요청의 error budget을 소모한다 |

그래서 purge는 야간에 돌린다는 사실만으로 충분하지 않습니다. 야간에도 백업, 정산, 인덱스 생성, 글로벌 트래픽, CDC가 같은 저장소를 쓸 수 있습니다. 먼저 “이 테이블에서 30초의 replica lag가 허용되는가”, “정상 write p95가 baseline보다 15% 이상 늘면 중지할 것인가”를 정해야 합니다. 숫자는 서비스마다 다르지만, **삭제 처리량보다 보호할 정상 경로의 예산을 먼저 고정하는 순서**는 같습니다.

### 2) OFFSET 순회는 삭제하는 데이터 집합에서 불안정하다

다음 형태는 작은 관리 화면에는 쓸 수 있어도 purge worker의 기본값으로는 좋지 않습니다.

~~~sql
SELECT id
FROM audit_events
WHERE created_at < :cutoff
ORDER BY id
LIMIT 1000 OFFSET :offset;
~~~

앞 batch가 행을 지우면 다음 OFFSET의 기준점도 움직입니다. concurrent insert나 다른 purge worker가 섞이면 행을 건너뛰거나, 뒤로 갈수록 이미 지나간 행을 많이 세며 느려질 수 있습니다. 반대로 keyset은 마지막으로 확정한 키를 경계로 다음 범위를 정합니다.

~~~sql
WITH candidates AS (
  SELECT id
  FROM audit_events
  WHERE created_at < :cutoff
    AND id > :last_id
  ORDER BY id
  LIMIT :batch_size
)
DELETE FROM audit_events e
USING candidates c
WHERE e.id = c.id
RETURNING e.id;
~~~

여기서 :cutoff는 run 도중 계속 현재 시각으로 계산하지 말고 시작 시점에 고정합니다. 그래야 “이번 실행이 어디까지 삭제하는가”가 재현됩니다. id가 시간 순서를 보장하지 않으면 (created_at, id)처럼 정렬이 완전한 복합 keyset을 사용합니다. 같은 created_at을 가진 행이 많아도 id가 tie-breaker가 되어야 행을 빠뜨리지 않습니다.

keyset이 모든 문제를 해결하지는 않습니다. 갱신 가능한 정렬 컬럼을 쓰면 한 행이 경계를 앞뒤로 이동할 수 있고, 여러 worker가 같은 범위를 잡으면 중복 시도가 생길 수 있습니다. 따라서 purge 대상은 가능하면 **불변인 생성 시각 + 단조 증가 식별자**로 잡고, 병렬화가 필요하면 tenant hash나 시간 파티션처럼 겹치지 않는 shard를 먼저 나눕니다. 한 테이블을 여러 worker가 id 범위 없이 경쟁적으로 훑는 방식은 마지막 단계의 최적화입니다.

### 3) batch size는 성능 수치가 아니라 안전 밸브다

처음부터 100,000건씩 지워서 “DB가 버티는지” 보는 것은 실험이 아니라 운영 위험입니다. 삭제 대상의 row 폭, 인덱스 수, trigger, FK, replica 수에 따라 같은 1,000건도 전혀 다른 부하를 만듭니다. 보수적으로는 100~1,000건 또는 transaction 시간이 0.5~2초 안에 끝나는 작은 batch에서 시작해 관측값으로 늘립니다.

| 관측값 | 시작 기준 예시 | worker 행동 |
| --- | --- | --- |
| purge transaction 시간 | 2초 초과가 3회 연속 | batch를 절반으로 줄이고 30~60초 대기 |
| 정상 write p95 | 기준선 대비 15% 이상 상승 | 신규 batch 중지, 원인 확인 |
| replica lag | 30초 초과 또는 서비스 SLO 초과 | purge pause, lag 회복 뒤 재개 |
| lock wait p95 | 100ms 초과 지속 | batch 축소, 충돌 쿼리 확인 |
| dead tuple·autovacuum | 회수 속도보다 생성 속도가 지속적으로 큼 | throttle 또는 별도 maintenance 창으로 전환 |

이 수치는 보편적 기본값이 아니라 **초기 guardrail**입니다. 결제처럼 복제 지연 허용치가 5초인 시스템과, 분석용 이벤트 저장소처럼 5분을 허용하는 시스템은 같은 정책을 쓸 수 없습니다. 핵심은 batch_size=5000 같은 값만 설정 파일에 남기지 않고, 그 값을 줄이거나 멈추는 조건을 함께 문서화하는 것입니다.

## 실무 적용

### 1) purge manifest와 progress ledger를 먼저 만든다

삭제 작업에는 최소한 run_id, 대상 테이블, 정책 버전, tenant 또는 shard 범위, 고정 cutoff, 예상 건수, 승인·legal hold 확인 결과를 남깁니다. 이를 purge manifest라고 보면 됩니다. 보존 기간을 코드에만 묻어 두고 worker가 현재 시간을 기준으로 지우게 하면, 중간 실패 후 무엇이 삭제됐고 무엇이 남았는지 설명하기 어렵습니다.

실행 중에는 각 commit 뒤에 last_key, deleted count, elapsed time, batch size, throttle reason, 오류 코드를 progress ledger에 기록합니다. worker가 3시간 후 죽어도 같은 run_id의 watermark에서 다시 시작하면 됩니다. DELETE 자체는 이미 지운 row를 다시 지울 수 있으므로 대개 안전하지만, 삭제 뒤 외부 스토리지 제거·검색 인덱스 삭제·감사 이벤트 발행이 붙으면 [멱등 write path](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)처럼 effect별 재시도 키가 필요합니다.

### 2) deletion path를 네 단계로 분리한다

1. **선별**: cutoff, tenant, 상태, legal hold 제외 조건으로 후보를 만든다. 이 조건은 실행 중 바꾸지 않는다.
2. **삭제**: 작은 keyset batch를 짧게 commit한다. FK cascade나 trigger가 있다면 실제 영향 행 수를 같이 기록한다.
3. **후처리**: object storage, search index, cache처럼 DB 밖의 사본은 별도 작업으로 처리하고 결과를 ledger에 연결한다.
4. **검증**: 대상 범위의 남은 row 수, 외부 사본 수, 오류·보류 수를 대조한다. “worker가 끝났다”는 “삭제가 완결됐다”와 다르다.

특히 개인정보나 계약상 삭제에는 3단계와 4단계를 생략하면 안 됩니다. [삭제 전파와 증적](/learning/deep-dive/2026-10-06-erasure-propagation-evidence-playbook/)처럼 보조 저장소·캐시·검색·백업의 취급을 구분하고, 즉시 삭제가 불가능한 사본은 보존 종료 시각과 접근 통제를 증적으로 남겨야 합니다.

### 3) 파티션을 버릴 수 있으면 row delete보다 먼저 검토한다

이벤트가 일·주·월 단위로 시간 파티션에 들어가고, 보존 경계가 파티션 경계와 맞는다면 개별 행 삭제보다 partition detach/drop이 훨씬 예측 가능합니다. 필요한 인덱스 갱신과 개별 dead tuple 생성이 줄고, 실행 시간도 데이터량보다 metadata 작업에 가까워집니다. 다만 같은 파티션 안에 보존 기간이 다른 tenant·legal hold 데이터가 섞이지 않아야 하고, downstream CDC가 detach/drop을 어떤 삭제 이벤트로 해석하는지도 확인해야 합니다. 이 조건을 못 맞춘다면 row delete가 느리더라도 더 안전할 수 있습니다.

### 4) 완료 뒤에는 bloat와 재발을 확인한다

삭제 job이 성공해도 OS 디스크 사용량이 바로 줄지 않을 수 있습니다. MVCC의 dead tuple은 autovacuum이 재사용 가능한 공간으로 만들고, 파일 크기 반환은 별도의 조건과 작업이 필요할 수 있습니다. 완료 보고에는 “3천만 행 삭제”만 쓰지 말고, delete 전후 table/index size, dead tuple 추정치, autovacuum 완료 시각, replica lag 최고값, 정상 write p95 변화를 함께 남깁니다.

같은 purge가 매주 DB를 흔든다면 batch size를 더 올리는 것이 답이 아닐 수 있습니다. 보존 기간이 긴 이벤트를 별도 파티션으로 분리할지, 원본을 archive tier로 옮길지, 쿼리 요구를 바꿀지 검토해야 합니다. [Hot/Cold 데이터 계층화](/learning/deep-dive/deep-dive-hot-cold-data-tiering-archive-query-playbook/)는 “삭제를 더 빨리”가 아니라 “운영 DB에 계속 둘 이유가 있는가”를 다시 묻는 다음 단계입니다.

## 트레이드오프/주의점

1. **작은 batch는 안전하지만 총 실행 시간이 길다.** 기간이 늘면 신규 데이터와 작업 창이 겹칠 수 있다. batch를 키우기 전에 shard·파티션·보관 구조를 바꿀 여지가 있는지 본다.
2. **keyset은 정렬 키 품질에 의존한다.** UUID처럼 시간과 무관한 키도 순회는 가능하지만, cutoff 인덱스와 결합하지 않으면 불필요한 스캔이 생길 수 있다. 실제 실행 계획을 확인한다.
3. **cascade는 보이는 삭제 건수보다 훨씬 많은 작업을 만들 수 있다.** 부모 1,000건을 지워도 자식·인덱스·trigger가 수백만 건을 건드릴 수 있으므로 production과 가까운 데이터 분포에서 먼저 측정한다.
4. **hard delete는 복구 난도가 높다.** 정책·승인·legal hold가 아직 불명확하면 soft delete를 영구 보존의 대체재로 쓰지 말고, 명시적인 hold 상태와 만료 검토 절차를 둔다.
5. **vacuum을 무작정 강제 실행하지 않는다.** VACUUM FULL 같은 재작성 작업은 별도 변경으로 평가한다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] cutoff, tenant/shard, legal hold 제외 조건, 정책 버전이 purge manifest에 고정되어 있다.
- [ ] 대상 조회가 OFFSET이 아니라 완전한 정렬을 가진 keyset과 watermark를 사용한다.
- [ ] commit마다 삭제 수·마지막 key·지연·throttle 사유가 progress ledger에 기록된다.
- [ ] 정상 write p95, lock wait, replica lag, dead tuple/autovacuum에 중지 또는 감속 기준이 있다.
- [ ] FK cascade·trigger·외부 사본을 포함한 실제 영향 범위를 사전 측정했다.
- [ ] partition detach/drop이 가능한 데이터와 row-by-row delete가 필요한 데이터를 구분했다.
- [ ] 완료 보고가 삭제 건수뿐 아니라 검증 결과와 post-purge maintenance 상태를 포함한다.

### 연습

최근 90일보다 오래된 audit_events 500만 건을 지운다고 가정해 보세요. 먼저 (created_at, id)에 맞춘 keyset 조건과 필요한 인덱스를 적습니다. 다음으로 transaction 2초, replica lag 30초, 정상 write p95 15% 상승을 guardrail로 두고 초기 batch size·감속 규칙·재개 watermark를 정합니다. 마지막으로 이 테이블이 월 파티션이라면 어느 달부터 detach/drop으로 바꿀 수 있는지, legal hold가 섞인 달은 왜 row delete가 필요한지 설명해 보세요.

## 관련 글

- [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
- [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)
- [시간 파티션 생명주기](/learning/deep-dive/deep-dive-postgresql-time-partition-lifecycle-playbook/)
- [삭제 전파와 증적](/learning/deep-dive/2026-10-06-erasure-propagation-evidence-playbook/)
- [온라인 스키마 변경과 Expand-Contract](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)
