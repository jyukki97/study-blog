---
title: "백엔드 커리큘럼 심화: PostgreSQL Logical Replication Slot을 WAL 예산·지연·복구 경계로 운영하는 법"
date: 2026-10-15T10:06:00+09:00
lastmod: 2026-10-15T10:06:00+09:00
draft: false
topic: "Backend Data Operations"
tags: ["PostgreSQL", "Logical Replication", "CDC", "WAL", "Database Operations", "Reliability"]
categories: ["Backend Deep Dive"]
description: "Logical replication slot을 단순 CDC 연결이 아니라 WAL 보존 예산, consumer 지연, 재동기화 비용을 함께 가진 운영 계약으로 다루는 기준을 정리합니다."
summary: "논리 복제 슬롯은 consumer가 읽지 못한 변경을 다시 보낼 수 있게 하지만, 그 대가로 오래된 WAL을 붙잡을 수 있다. slot이 존재한다는 사실보다 어느 owner가 얼마의 WAL을 언제까지 보존해도 되는지, 한도를 넘었을 때 재동기화할 준비가 있는지가 운영의 핵심이다."
module: "backend-data-system"
study_order: 1550
keywords: ["PostgreSQL logical replication slot", "WAL retention budget", "CDC slot lag", "replication slot recovery", "max_slot_wal_keep_size"]
key_takeaways:
  - "logical replication slot은 전달 보장 장치이면서 WAL 보존 책임을 만드는 상태 객체이므로, consumer 이름만으로 만들거나 방치하면 디스크 고갈 위험이 된다."
  - "confirmed_flush_lsn의 전진은 consumer가 변경을 받았다는 신호일 뿐, 대상 시스템에 업무적으로 적용·검증됐다는 증거와는 분리해야 한다."
  - "WAL 보존 한도와 slot invalidation 뒤의 재동기화 절차를 함께 정해야 디스크를 보호하면서도 CDC 복구 시간을 예측할 수 있다."
operator_checklist:
  - "slot마다 owner, source database, publication, consumer, 재동기화 방식, 허용 WAL·지연 예산을 inventory로 관리한다."
  - "retained WAL bytes, confirmed_flush_lsn 정체 시간, primary 디스크 여유, consumer apply lag를 같은 dashboard에서 본다."
  - "slot을 제거하거나 WAL 보존 상한을 적용하기 전에 snapshot 재생성·중복 처리·downstream 검증 절차를 runbook으로 시험한다."
---

변경 데이터 캡처(CDC), 데이터 웨어하우스 적재, 검색 색인 동기화, 다른 PostgreSQL 클러스터로의 논리 복제는 모두 source database의 변경을 나중에 다시 읽을 수 있어야 합니다. PostgreSQL의 logical replication slot은 이 재개 지점을 저장합니다. consumer가 잠시 멈춰도 마지막 확인 위치부터 WAL을 읽을 수 있으므로 편리합니다. 그러나 이 편의에는 중요한 대가가 있습니다. consumer가 확인하지 않은 위치보다 오래된 WAL을 PostgreSQL이 계속 보존할 수 있다는 점입니다.

즉 slot은 “CDC가 연결됐다”는 체크 표시가 아니라 **재개 가능성과 디스크·복구 비용을 교환하는 계약**입니다. connector 프로세스가 살아 있어도 LSN이 전진하지 않으면 WAL은 쌓이고, downstream이 메시지를 받았어도 실제 테이블에 적용하지 못했을 수 있습니다. 이 글은 [CDC connector lag·snapshot 복구](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/), [읽기/쓰기 복제 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/), [PITR 복구 훈련](/learning/deep-dive/deep-dive-restore-drill-pitr-recovery-playbook/), [XID wraparound과 freeze](/learning/deep-dive/2026-10-10-postgresql-xid-wraparound-freeze-playbook/)의 원칙을 logical slot 운영으로 연결합니다.

## 이 글에서 얻는 것

- logical replication slot, WAL, publication, consumer checkpoint가 각각 보장하는 범위를 구분할 수 있습니다.
- slot lag를 “분 단위 지연” 하나로 보지 않고 retained WAL, disk headroom, downstream apply 상태로 판단할 수 있습니다.
- WAL 보존 상한을 정할 때 보호할 primary의 디스크 예산과 재동기화 비용을 함께 계산할 수 있습니다.
- slot invalidation, consumer 재배포, schema 변경, failover 뒤에 무엇을 재생성·검증해야 하는지 runbook으로 만들 수 있습니다.

## 핵심 개념/이슈

### 1) slot은 변경 로그를 복제하는 기능이 아니라 WAL 보존 기준점이다

PostgreSQL은 WAL을 crash recovery, physical replication, point-in-time recovery에 사용합니다. logical decoding을 위한 slot은 여기에 별도의 최저 보존 위치를 추가합니다. slot의 `restart_lsn`보다 뒤의 WAL은 해당 slot이 다시 읽을 가능성이 있으므로, checkpoint와 재활용 과정에서도 바로 버릴 수 없습니다. consumer가 며칠 동안 멈추면 “작업이 멈췄다”에서 끝나지 않고 primary의 WAL 디스크 사용량이 계속 커질 수 있습니다.

또한 LSN마다 의미가 다릅니다. 구현과 도구가 노출하는 이름은 조금 달라도 아래 구분은 유지해야 합니다.

| 상태 | 의미 | 이것만으로 말할 수 없는 것 |
| --- | --- | --- |
| `restart_lsn` | slot 재개를 위해 보존해야 할 수 있는 가장 이른 WAL 위치 | consumer가 최근 데이터를 모두 적용했다는 사실 |
| `confirmed_flush_lsn` | logical consumer가 확인한 진행 위치 | downstream의 business transaction이 commit됐다는 사실 |
| consumer offset | connector가 자기 저장소에 기록한 위치 | source slot과 offset이 같은 장애 도메인에서 안전하다는 사실 |
| target apply watermark | sink가 실제 반영을 완료한 위치 | source WAL 보존량이 줄었다는 사실 |

예를 들어 connector가 source의 변경 이벤트를 broker에 기록한 뒤 `confirmed_flush_lsn`을 전진시켰다고 합시다. 그 뒤 sink worker가 중단되면 source의 slot lag는 작아 보여도 검색 인덱스나 분석 테이블은 뒤처질 수 있습니다. 반대로 sink가 느려도 source consumer가 broker에 충분히 쌓아 두면 slot은 건강해 보일 수 있습니다. 따라서 **source 재개성, transport backlog, target 적용 완료를 같은 지표로 합치지 않는 것**이 첫 기준입니다.

### 2) ‘slot이 active’는 건강 신호가 아니다

slot의 `active` 상태는 decoding 연결이 붙어 있음을 뜻할 뿐, 계속 읽고 있는지나 정상 적용 중인지를 보장하지 않습니다. consumer가 poison event, schema incompatibility, 권한 오류, downstream rate limit에 걸린 채 연결만 유지할 수 있습니다. 대시보드는 다음 신호를 함께 보여야 합니다.

| 관측값 | 왜 보는가 | 시작 경보 기준 예시 |
| --- | --- | --- |
| retained WAL bytes | primary disk에 쌓이는 실제 위험 | slot별 할당량의 50%에서 경고, 80%에서 page |
| `confirmed_flush_lsn` 정체 시간 | 연결은 살아 있지만 진행하지 않는 상태 탐지 | 업무 변경이 있는 동안 15~30분 무전진 |
| source-to-consumer lag | source 재개 지연 파악 | 서비스별 RPO의 절반을 넘으면 조사 |
| consumer-to-target apply lag | downstream 데이터 최신성 확인 | 검색·분석·권한 동기화의 SLA별 분리 기준 |
| primary WAL volume headroom | 여러 slot이 합쳐 만드는 고갈 위험 | 사용 가능 공간 20% 이하에서 감속·복구 준비 |

수치는 공통 정답이 아닙니다. 먼저 최근 14일의 피크 WAL 생성률을 구하고, “consumer를 복구하거나 재동기화로 전환할 수 있는 시간”을 곱해 slot별 예산을 만드세요. 그다음 모든 slot의 최악 보존량과 PITR·physical replica가 요구하는 WAL을 합산해 디스크 여유 안에 들어오는지 확인합니다. **slot 예산의 우선순위는 consumer 편의가 아니라 primary 생존성**입니다.

### 3) 보존 상한은 안전장치이고, invalidation은 복구 전략의 일부다

WAL을 무한히 보존하는 설정은 언젠가 primary 전체를 위험하게 만듭니다. PostgreSQL의 버전과 구성에 맞춰 slot이 붙잡을 수 있는 WAL 상한을 두면 디스크 보호에 도움이 됩니다. 다만 상한을 넘은 slot은 필요한 WAL을 더 이상 읽지 못해 무효화되거나, consumer가 처음부터 snapshot을 다시 잡아야 할 수 있습니다. 이 동작을 “CDC 장애”로만 보면 설정을 풀어 무한 보존으로 돌아가게 됩니다.

더 안전한 관점은 다음입니다.

1. **정상 재개 구간**: lag가 예산 안이면 기존 slot과 checkpoint에서 이어 읽습니다.
2. **감속·조사 구간**: lag가 50~80%면 downstream 병목을 줄이고 쓰기량이 큰 job·backfill을 조정합니다.
3. **보호 구간**: primary headroom이 위험해지면 slot의 재개성보다 DB 가용성을 우선합니다. 상한 정책에 따라 slot을 잃을 수 있음을 incident runbook에 명시합니다.
4. **재동기화 구간**: 새 snapshot 또는 기준 시점 export로 target을 다시 만들고, snapshot 완료 위치와 새 incremental stream의 경계를 검증합니다.

여기서 삭제와 재생성을 성급히 자동화하면 안 됩니다. slot을 지우면 보존 압력은 사라지지만, target의 누락 구간을 정확히 찾기 어려워질 수 있습니다. 특히 권한·정산·감사 데이터는 “대충 최신 snapshot을 다시 넣었다”만으로 복구가 끝나지 않습니다. source row count, key 범위, event watermark, 대상 시스템의 적용 건수를 비교하는 reconciliation 단계가 필요합니다. 이 원칙은 [재조정 ledger와 correction job](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)의 증적 관점과 같습니다.

## 실무 적용

### 1) slot inventory를 연결 문자열이 아니라 운영 계약으로 만든다

운영에서 잊힌 slot은 대개 임시 분석, 폐기된 connector, 실험 환경에서 생깁니다. slot 이름만 보고 안전하게 지울 수 없으므로, 생성 시점부터 아래 필드를 갖는 inventory를 만드세요.

| 필드 | 결정해야 할 내용 |
| --- | --- |
| owner·서비스 | 장애 때 consumer를 복구하고 삭제를 승인할 책임자 |
| source·publication | 어느 DB·table set의 변경을 읽는가 |
| target·데이터 등급 | 검색 인덱스인지, 정산 원장인지, 고객 데이터인지 |
| freshness SLO | target이 source보다 얼마나 늦어도 되는가 |
| WAL budget | slot이 쓸 수 있는 bytes와 경보·중단 기준 |
| recovery mode | checkpoint 재개, snapshot 재생성, 수동 reconciliation 중 무엇인가 |
| lifecycle | 생성 사유, 만료일, owner 재확인일, 삭제 승인 절차 |

처음에는 slot별 WAL 할당량을 primary WAL 디스크의 **5% 이하**로 시작하고, 모든 noncritical slot의 합계가 **20~30%**를 넘지 않게 두는 방식이 보수적입니다. 이는 보편적인 정답이 아니라, physical replication·backup·일시적 쓰기 급증을 위한 여유를 남기는 출발선입니다. 정산처럼 재동기화가 비싼 consumer는 조금 더 큰 예산을 받을 수 있지만, 그만큼 owner와 복구 훈련을 더 엄격히 요구해야 합니다.

### 2) consumer checkpoint와 target commit을 원자적으로 보지 않는다

일반적인 CDC pipeline에는 source decoding, broker publish, stream processing, sink write가 분리돼 있습니다. 이 경계에서는 프로세스가 죽는 시점에 따라 duplicate 또는 replay가 생길 수 있습니다. source의 slot을 빠르게 전진시키려는 최적화가 target의 exactly-once를 보장하지는 않습니다.

안전한 기본 패턴은 target에 event identity를 남겨 멱등 적용하는 것입니다. 예를 들어 source의 transaction ID·LSN·table primary key 또는 event UUID를 sink의 dedup key로 두고, target write와 apply watermark를 같은 transaction에 기록합니다. consumer가 재시작해 같은 변경을 다시 받아도 target이 중복 적용하지 않게 만드세요. schema change, tombstone, transaction ordering이 중요한 경우에는 table별로 순서를 완전히 보장할 수 있는지, 아니면 version·upsert 규칙으로 수렴시킬지를 계약에 적어야 합니다.

다음 질문에 답하지 못하면 slot lag가 0이어도 pipeline은 완성된 것이 아닙니다.

- source가 이미 WAL을 버렸을 때 target을 어느 snapshot으로 재구성하는가?
- snapshot과 incremental stream 사이의 경계에서 누락·중복을 어떻게 검증하는가?
- target schema 배포가 source event보다 먼저 또는 늦게 도착하면 어떤 version을 허용하는가?
- 같은 event를 두 번 적용해도 금액·권한·카운터가 한 번만 변하는가?

이 질문은 [이벤트 schema registry와 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/) 및 [transactional inbox·멱등 consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)에서 다룬 계약을 slot 운영에 연결합니다.

### 3) 월 1회는 ‘slot을 잃은 복구’를 실제로 연습한다

정상 checkpoint 재개는 누구나 테스트하지만, 운영 사고는 WAL 보존 한도를 넘어선 뒤에 일어납니다. 낮은 위험의 staging 또는 shadow target에서 월 1회 다음 drill을 실행해 보세요.

1. consumer를 멈추고 WAL retained bytes와 `confirmed_flush_lsn` 정체를 기록합니다.
2. 경보, owner paging, backfill 차단 또는 감속이 예상 시간 안에 동작하는지 확인합니다.
3. 새 snapshot을 만든 뒤, 고정한 snapshot boundary 이후의 incremental event만 적용합니다.
4. source/target의 row count, hash 표본, 최신 event watermark, 삭제·update 건수를 대조합니다.
5. slot 재생성부터 정상 SLO 회복까지 걸린 시간과 사람 개입을 ledger에 남깁니다.

성공 기준은 “connector가 다시 붙었다”가 아닙니다. target의 목적에 맞는 정확성 증거와, primary가 위험 상태에 머문 시간이 예산 이내였는지가 기준입니다. 재동기화가 매번 수일이 걸린다면 slot WAL 예산을 무작정 키우기보다 snapshot 병렬화, 대상 table 분리, compacted event log, target 재구성 비용을 낮추는 설계가 먼저입니다.

## 트레이드오프/주의점

첫째, 큰 WAL 보존 예산은 consumer 장애를 더 오래 견디게 하지만 primary의 복구·디스크·backup 운용 위험을 높입니다. “중요한 consumer이니 무제한”은 보호가 아니라 장애 반경을 키우는 선택입니다. 중요한 consumer일수록 더 큰 예산보다 더 빠른 repair와 검증된 resync 경로가 필요합니다.

둘째, slot 상태는 백업 대체재가 아닙니다. 논리 slot이 있어도 user error, 잘못된 event transform, target corruption, source cluster 손실에서 복원할 수 있는 것은 아닙니다. PITR 보존, restore drill, target reconciliation을 별도 통제로 유지해야 합니다.

셋째, slot을 하나로 합치면 운영 객체 수는 줄지만 consumer별 지연과 권한을 분리하기 어려워집니다. 반대로 consumer마다 slot을 만들면 격리는 좋아져도 WAL 보존 pressure와 모니터링 대상이 늘어납니다. 같은 freshness·복구·권한 경계를 공유하는 consumer만 함께 묶고, 정산·감사처럼 재처리 비용이 큰 경로는 분리하는 편이 낫습니다.

마지막으로 raw WAL이나 decoded event를 관측 로그에 그대로 남기지 마세요. slot debugging 과정에서 개인정보·secret·업무 데이터가 telemetry로 복제될 수 있습니다. LSN, bytes, event type, table category, redaction count 같은 구조화된 metadata를 기본으로 하고, 원문 확인은 짧은 보존·별도 접근 승인 경로로 제한합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 모든 logical slot에 owner, source/publication, target, 만료일, freshness SLO, recovery mode가 기록돼 있다.
- [ ] retained WAL bytes, `confirmed_flush_lsn` 정체, source lag, target apply lag, primary disk headroom을 분리해 관측한다.
- [ ] slot별 WAL budget과 합계 상한이 있고, 50% 경고·80% paging·primary 보호 단계가 정의돼 있다.
- [ ] WAL 보존 상한을 넘었을 때 slot invalidation 가능성과 snapshot 재생성 절차를 owner가 알고 있다.
- [ ] sink는 event identity 또는 version을 이용해 replay·중복 event에도 멱등적으로 수렴한다.
- [ ] snapshot과 incremental stream의 경계에서 row count·watermark·표본 hash로 reconciliation한다.
- [ ] staging 또는 shadow target에서 최소 월 1회 slot 상실 후 복구 drill을 실행한다.

### 연습

하루 피크 WAL 생성량이 240GB이고, primary WAL 디스크에 2TB의 여유가 있으며, CDC consumer 4개가 있다고 가정해 보세요. 각 consumer의 재동기화 예상 시간과 중요도를 적은 뒤, slot별 보존 예산과 합계 상한을 정합니다. 이어서 consumer 하나가 8시간 멈췄을 때 어느 경보가 먼저 울려야 하는지, 어느 시점에 정상 재개를 포기하고 snapshot 재구성으로 전환할지 적어 보세요. 마지막으로 snapshot 경계 뒤의 event가 중복돼도 target의 금액 합계가 변하지 않게 할 dedup key와 검증 쿼리를 설계해 보세요.

## 관련 글

- [CDC connector lag·snapshot 복구](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/)
- [읽기/쓰기 복제 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [PITR 복구 훈련](/learning/deep-dive/deep-dive-restore-drill-pitr-recovery-playbook/)
- [이벤트 schema registry와 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)
- [Transactional inbox와 멱등 consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)
