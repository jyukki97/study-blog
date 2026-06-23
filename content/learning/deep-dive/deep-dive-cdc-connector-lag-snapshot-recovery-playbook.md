---
title: "백엔드 커리큘럼 심화: CDC Connector Lag와 Snapshot 복구 운영 플레이북"
date: 2026-06-23
draft: false
topic: "Backend Data Pipeline Operations"
tags: ["CDC", "Debezium", "Replication Lag", "Snapshot", "Backfill", "Data Pipeline", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "CDC 커넥터를 운영할 때 snapshot, replication slot, offset, schema drift, sink idempotency를 어떤 기준으로 관리해야 하는지 숫자와 런북 중심으로 정리합니다."
module: "backend-data-system"
study_order: 1274
key_takeaways:
  - "CDC는 이벤트 발행 기술이 아니라 원본 DB, 커넥터, 브로커, sink가 함께 지키는 복제 계약이다."
  - "Lag는 source lag, connector lag, apply lag, business lag로 나눠 봐야 복구 우선순위를 정할 수 있다."
  - "Snapshot과 backfill은 온라인 트래픽보다 낮은 우선순위로 throttling하고, offset과 재처리 기준을 먼저 고정해야 한다."
operator_checklist:
  - "원본 테이블의 primary key, update/delete 의미, tombstone 정책, schema compatibility를 문서화한다."
  - "replication slot retained bytes, connector lag seconds, sink apply lag, DLQ 증가율을 같은 대시보드에서 본다."
  - "초기 snapshot은 batch size, sleep interval, pause 조건, 재시작 checkpoint를 숫자로 정하고 시작한다."
  - "schema 변경은 DDL 배포, connector schema refresh, consumer 호환성 검증을 한 단계로 묶지 않는다."
  - "커넥터 장애 복구는 재시작보다 offset 안전성, 중복 처리, 누락 구간 비교를 먼저 확인한다."
learning_refs:
  - title: "Transactional Outbox + CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "업무 트랜잭션과 이벤트 발행을 분리하는 기본 패턴을 먼저 이해할 때 함께 봅니다."
  - title: "트래픽 컷오버와 데이터 마이그레이션"
    href: "/learning/deep-dive/deep-dive-traffic-cutover-migration/"
    description: "Dual-write, backfill, CDC를 조합한 마이그레이션 절차와 연결됩니다."
  - title: "PostgreSQL WAL, Checkpoint, Replication Lag"
    href: "/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/"
    description: "CDC lag가 원본 DB의 WAL 보존과 복제 지연으로 번지는 구조를 이해하는 배경 글입니다."
  - title: "Projection Lag와 Read Model Rebuild"
    href: "/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/"
    description: "CDC 이벤트가 read model에 반영되는 구간의 지연과 재빌드 전략을 같이 설계할 수 있습니다."
---

CDC(Change Data Capture)는 백엔드에서 매력적인 도구입니다. 서비스 코드는 주문, 결제, 회원 상태를 원본 DB에 저장하고, 커넥터가 변경분을 읽어 Kafka, 검색 인덱스, 데이터 웨어하우스, read model, 캐시 무효화 파이프라인으로 흘려보냅니다. 잘 설계하면 API 응답 경로는 가벼워지고, 외부 연동은 비동기로 분리되고, 장애가 나도 offset부터 다시 따라잡을 수 있습니다.

문제는 운영에 들어간 뒤입니다. 초기 snapshot이 운영 DB I/O를 밀어내고, replication slot이 WAL을 붙잡아 디스크를 채우고, schema 변경이 consumer를 깨뜨리고, sink가 멱등하지 않아 재처리 때 중복 데이터가 쌓입니다. CDC는 "변경분을 읽는다"는 기능보다 **원본 DB, 커넥터, 브로커, sink가 함께 지키는 복제 계약**에 가깝습니다.

이 글은 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [트래픽 컷오버와 데이터 마이그레이션](/learning/deep-dive/deep-dive-traffic-cutover-migration/), [PostgreSQL WAL과 Replication Lag](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/), [Projection Lag와 Read Model Rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)를 CDC 커넥터 운영 관점으로 다시 묶습니다.

## 이 글에서 얻는 것

- CDC 커넥터 운영에서 snapshot, offset, replication slot, sink idempotency가 어떤 실패 모드를 만드는지 이해합니다.
- Lag를 하나의 숫자가 아니라 source lag, connector lag, apply lag, business lag로 나눠 볼 수 있습니다.
- 초기 snapshot과 대량 backfill을 온라인 트래픽과 충돌시키지 않는 throttling 기준을 세울 수 있습니다.
- schema drift, poison record, offset 재설정, 누락 구간 재처리 같은 복구 상황에서 무엇을 먼저 확인해야 하는지 런북을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) CDC 파이프라인은 네 구간으로 나눠 봐야 한다

CDC 장애를 볼 때 "커넥터가 밀린다"는 말만으로는 부족합니다. 실제 파이프라인은 보통 아래 네 구간입니다.

| 구간 | 대표 구성요소 | 실패 모드 | 주요 지표 |
| --- | --- | --- | --- |
| Source | MySQL binlog, PostgreSQL WAL, replication slot | 로그 보존 증가, 디스크 압박, 권한 오류 | retained bytes, WAL/binlog age, source CPU/I/O |
| Connector | Debezium, custom poller, Kafka Connect | offset 정지, snapshot 재시작, schema parse 오류 | connector lag, task status, restart count |
| Broker | Kafka, Pulsar, queue | partition skew, retention 초과, consumer group 지연 | topic lag, produce error, retention age |
| Sink | search index, read model, warehouse, cache invalidator | 중복 반영, 순서 역전, apply 실패 | apply lag, DLQ, idempotency conflict |

운영 판단은 이 구간을 분리해야 빨라집니다. Source가 밀리면 원본 DB 보호가 우선입니다. Connector만 죽었고 WAL 여유가 충분하면 재시작과 poison record 분석이 우선입니다. Sink가 밀리면 원본 DB가 아니라 downstream 처리량과 멱등성부터 봐야 합니다.

### 2) Lag는 하나가 아니라 네 종류다

CDC에서 가장 흔한 착각은 lag를 Kafka consumer lag 하나로 보는 것입니다. 실무에서는 최소 네 가지 lag를 나눕니다.

- **Source lag**: 커넥터가 원본 변경 로그의 최신 위치에서 얼마나 뒤처졌는가
- **Connector lag**: 커넥터 task가 이벤트를 읽고 브로커에 쓰는 데 얼마나 밀리는가
- **Apply lag**: sink consumer가 브로커 이벤트를 실제 read model, 인덱스, 캐시에 반영하는 데 얼마나 밀리는가
- **Business lag**: 사용자가 보는 업무 상태가 원본 상태와 얼마나 오래 어긋나는가

예를 들어 주문 상태 CDC가 3분 밀렸다고 해도 관리자 검색 화면만 늦는다면 영향은 제한적일 수 있습니다. 반대로 결제 완료 이벤트가 쿠폰 발급, 배송 요청, 정산 원장으로 이어진다면 3분도 클 수 있습니다. 그래서 lag budget은 기술 지표가 아니라 업무 경로별로 정해야 합니다.

초기 기준은 아래처럼 잡을 수 있습니다.

| 업무 경로 | Warning | Critical | 자동 조치 |
| --- | --- | --- | --- |
| 캐시 무효화 | 30초 | 2분 | stale read 알림, 일부 cache bypass |
| 검색 인덱스 | 5분 | 30분 | 검색 결과에 지연 표시, backfill worker 증설 |
| 데이터 웨어하우스 | 30분 | 2시간 | 배치 SLA 경고, 리포트 refresh 보류 |
| 결제/정산 이벤트 | 1분 | 5분 | 신규 write 제한 검토, reconciliation 우선 실행 |
| 권한/보안 상태 | 10초 | 1분 | read-through fallback 또는 강한 조회 경로 사용 |

숫자는 서비스마다 조정해야 합니다. 핵심은 "CDC가 느리다"가 아니라 "어떤 사용자 기능이 몇 분까지 늦어져도 되는가"를 먼저 정하는 것입니다.

### 3) Snapshot은 초기 복사가 아니라 일관성 경계다

초기 snapshot은 단순히 기존 데이터를 한 번 읽는 작업처럼 보입니다. 하지만 실제로는 "어느 시점까지의 기존 데이터와 그 이후 변경분을 중복/누락 없이 이어 붙이는가"를 결정하는 일관성 경계입니다. 이 경계가 흐리면 snapshot 중 update된 row가 빠지거나, delete가 늦게 반영되거나, 같은 row가 두 번 sink에 들어갑니다.

Snapshot 운영에서 확인할 것은 아래입니다.

- snapshot 시작 시점의 log position 또는 LSN을 기록하는가
- snapshot 중 발생한 update/delete가 change stream으로 이어지는가
- snapshot row와 streaming event가 같은 primary key 기준으로 멱등하게 merge되는가
- snapshot 재시작 시 이미 처리한 chunk를 건너뛸 checkpoint가 있는가
- sink가 insert-only인지 upsert인지, delete/tombstone을 처리하는지 명확한가

대형 테이블에서 `SELECT * FROM orders`로 한 번에 긁는 방식은 피하는 편이 좋습니다. 1,000만 row 이상이면 cursor 기반 chunk, primary key range, 시간 범위 분할, 낮은 우선순위 connection pool을 별도로 둡니다. snapshot이 빨리 끝나는 것보다 온라인 write path를 흔들지 않는 것이 우선입니다.

### 4) Replication slot과 로그 보존은 조용히 원본 DB 장애로 번진다

PostgreSQL logical replication slot이나 MySQL binlog 기반 CDC는 커넥터가 읽지 못한 로그를 원본 쪽에 보존하게 만듭니다. 커넥터가 멈추면 "이벤트가 안 나간다"에서 끝나지 않고 WAL/binlog가 쌓여 디스크를 압박할 수 있습니다. 특히 주말 장애, 야간 배치, 대량 migration이 겹치면 월요일 아침에 원본 DB 디스크가 먼저 터질 수 있습니다.

운영 기준은 보수적으로 잡습니다.

- replication slot retained bytes가 평소 p95의 **3배 이상**이면 warning
- WAL/binlog 보존으로 디스크 여유가 **30% 미만**이면 snapshot/backfill 중단
- 디스크 여유가 **20% 미만**이면 신규 대량 작업 중단과 커넥터 복구를 최우선
- connector lag가 **30분 이상**이고 write volume이 높은 테이블이면 retained bytes 증가율을 10분 단위로 확인
- slot을 삭제하기 전에는 재동기화 비용과 누락 가능성을 별도 승인한다

slot 삭제는 쉬운 해결처럼 보이지만, 잘못하면 "디스크는 살렸지만 변경분은 잃은" 상태가 됩니다. 원본 DB 보호가 급하면 삭제가 필요할 수 있지만, 그 순간부터는 full snapshot 또는 누락 구간 backfill 계획을 같이 세워야 합니다.

### 5) Schema drift는 커넥터보다 consumer를 먼저 깨뜨릴 수 있다

CDC는 DB schema를 그대로 이벤트로 노출하는 경우가 많습니다. 컬럼 추가는 대체로 안전하지만, 타입 변경, 컬럼 삭제, enum 의미 변경, nullable 정책 변경은 consumer를 깨뜨립니다. 문제는 원본 서비스는 정상 배포됐는데, downstream consumer가 뒤늦게 실패하면서 장애가 지연 발생한다는 점입니다.

Schema 변경은 [Online Schema Change](/learning/deep-dive/deep-dive-online-schema-change-expand-contract-playbook/)와 같은 원칙으로 봅니다.

1. 먼저 additive change만 배포한다.
2. CDC schema registry 또는 consumer fixture가 새 필드를 허용하는지 확인한다.
3. consumer가 새 schema를 읽는지 shadow로 검증한다.
4. backfill 또는 dual-write 기간을 둔다.
5. 삭제/타입 변경은 모든 consumer 전환 이후에 한다.

특히 JSON payload를 그대로 sink에 저장하는 팀은 "어차피 유연하니까 괜찮다"고 생각하기 쉽습니다. 하지만 유연한 payload도 의미 변경에는 약합니다. `status = PAID`의 의미가 "승인 완료"에서 "정산 가능"으로 바뀌면 필드명은 그대로여도 consumer 계약은 깨집니다.

## 실무 적용

### 1) CDC 운영 계약을 먼저 작성한다

새 CDC 파이프라인을 만들 때 최소 계약은 아래처럼 적어 둡니다.

```text
Source: orders, order_payments
Primary key: id, payment_id
Ordering key: aggregate_id + source commit timestamp
Delete policy: tombstone event emitted, sink hard delete 금지
Snapshot mode: initial snapshot with PK chunking
Chunk size: 5,000 rows
Throttle: source CPU > 65% or replica lag > 30s이면 pause
Lag budget: search 10분, settlement 1분
Offset owner: Kafka Connect offset topic
Replay policy: sink upsert by event_id, duplicate safe
Schema policy: additive first, breaking change requires 30일 window
```

이 문서는 길 필요가 없습니다. 다만 primary key, 순서, 삭제, snapshot, replay, schema 정책은 꼭 있어야 합니다. 이 다섯 가지가 없으면 장애 때 "다시 돌려도 되나?"에 답하지 못합니다.

### 2) 초기 snapshot은 낮은 우선순위 작업으로 둔다

초기 snapshot은 운영 DB 입장에서 대량 read 작업입니다. 인덱스를 타더라도 buffer cache를 오염시키고, replica에서 읽어도 replica lag를 만들 수 있습니다. 추천 기준은 아래입니다.

- 운영 primary 직접 snapshot은 마지막 선택지로 둔다.
- 가능하면 read replica 또는 CDC 전용 replica에서 snapshot을 시작한다.
- chunk size는 1,000~10,000 row 범위에서 시작하고, p95 query time이 500ms를 넘으면 줄인다.
- snapshot connection pool은 온라인 API pool과 분리한다.
- source CPU가 65~70%를 넘거나 replica lag가 30초를 넘으면 pause한다.
- 야간 batch, index build, vacuum, online DDL과 같은 시간대에 겹치지 않는다.

"오늘 안에 끝내야 한다"는 이유로 chunk size를 크게 올리는 건 위험합니다. CDC snapshot의 우선순위는 완료 시간이 아니라 서비스 안정성입니다. 빨리 끝내야 한다면 먼저 대상 범위를 줄이고, 테이블을 나누고, sink를 미리 준비하는 쪽이 낫습니다.

### 3) 대시보드는 lag와 복구 가능성을 같이 보여줘야 한다

CDC 대시보드에는 최소 아래 지표가 있어야 합니다.

```text
cdc.source.retained_bytes{slot, database}
cdc.source.lag_seconds{connector, table}
cdc.connector.task_status{connector, task}
cdc.connector.restart_count{connector}
cdc.broker.consumer_lag{topic, consumer_group}
cdc.sink.apply_lag_seconds{sink, table}
cdc.sink.dlq_count{sink, error_class}
cdc.business.stale_rows{view, table}
```

여기서 중요한 것은 lag 숫자만 보지 않는 것입니다. retained bytes가 증가 중인지, DLQ가 늘어나는지, restart count가 반복되는지, sink가 중복 이벤트를 안전하게 무시하는지도 같이 봐야 합니다. lag 10분보다 더 위험한 상태는 lag 10분에 DLQ가 계속 증가하고 offset이 앞으로 가지 않는 상태입니다.

### 4) 장애 복구 순서는 재시작보다 offset 확인이 먼저다

CDC 커넥터가 멈췄을 때 무조건 재시작하면 운 좋게 해결될 수 있습니다. 하지만 poison record, schema drift, sink 중복 문제가 원인이라면 같은 위치에서 계속 죽거나, 중복 반영만 늘어납니다.

권장 복구 순서는 아래입니다.

1. 마지막 정상 offset, source log position, task error를 기록한다.
2. 원본 DB 디스크와 retained bytes 증가율을 확인한다.
3. schema 변경, 권한 변경, connector 버전 변경, sink 배포 이력을 확인한다.
4. poison record가 있으면 해당 event key와 payload schema를 분리해 fixture로 저장한다.
5. sink가 idempotent upsert인지 확인한 뒤 재처리 범위를 정한다.
6. 커넥터를 재시작하고 offset 전진 여부를 5~10분 안에 확인한다.
7. 누락 가능성이 있으면 source count와 sink count를 key range 단위로 비교한다.

재처리 기준도 미리 정해 둡니다. 예를 들어 주문 read model이라면 `order_id` 기준 upsert가 가능하므로 중복 replay가 비교적 안전합니다. 반대로 "포인트 지급 이벤트"처럼 insert-only side effect가 있으면 replay 전에 event idempotency key가 반드시 있어야 합니다. 이 차이를 모르면 복구가 장애보다 더 큰 사고가 됩니다.

### 5) Backfill과 streaming을 같은 sink에 넣을 때는 우선순위를 분리한다

대량 backfill은 보통 과거 데이터를 메우기 위해 필요합니다. 그런데 backfill과 실시간 CDC가 같은 sink worker pool을 쓰면, 과거 데이터 때문에 현재 변경분 반영이 밀립니다. 검색 인덱스라면 오래된 문서 보강 때문에 방금 변경된 주문이 검색되지 않는 상황이 생깁니다.

권장 구조는 아래입니다.

- realtime stream worker와 backfill worker를 분리한다.
- realtime queue가 critical lag에 가까워지면 backfill을 자동 pause한다.
- backfill은 낮은 priority topic 또는 별도 consumer group을 사용한다.
- 같은 key를 다룰 때는 event timestamp보다 source version 또는 updated_at 비교로 최신 값을 보존한다.
- backfill 완료 후 sample key, count, checksum, stale row 수를 비교한다.

Backfill은 성실하게 많이 돌리는 작업이 아니라 조심스럽게 적게 방해하는 작업입니다. 특히 운영 시간대에는 처리량 목표보다 pause 조건이 더 중요합니다.

## 트레이드오프/주의점

첫째, CDC는 애플리케이션 코드에서 이벤트 발행 책임을 줄여 주지만 운영 복잡도를 없애지는 않습니다. 오히려 DB 로그, connector offset, schema registry, sink idempotency, DLQ까지 운영 범위가 넓어집니다. 팀에 이 지표를 볼 사람이 없으면 Outbox 테이블을 직접 polling하는 단순한 구조가 더 나을 수 있습니다.

둘째, snapshot 기반 복구는 강력하지만 비용이 큽니다. 전체 snapshot은 누락을 메우는 확실한 방법처럼 보이지만, 원본 DB와 sink 모두에 큰 부하를 줍니다. 누락 범위가 특정 시간대나 key range로 좁혀진다면 full snapshot보다 targeted backfill이 낫습니다.

셋째, "최신 상태만 맞으면 된다"와 "모든 이벤트를 보존해야 한다"는 요구는 다릅니다. 검색 인덱스는 최종 상태 upsert로 충분할 수 있지만, 정산, 감사, 포인트, 쿠폰은 이벤트 하나의 중복/누락도 문제가 됩니다. CDC 파이프라인 하나로 모든 요구를 처리하려고 하면 가장 엄격한 요구가 전체 비용을 끌어올립니다.

넷째, lag budget을 너무 공격적으로 잡으면 운영팀이 계속 알림에 시달립니다. 모든 read model을 10초 안에 맞출 필요는 없습니다. 사용자 기능, 돈, 권한, 보안에 가까울수록 작게 잡고, 리포트나 분석성 데이터는 더 느슨하게 잡는 편이 현실적입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] CDC 대상 테이블마다 primary key, ordering key, delete/tombstone 정책이 있다.
- [ ] source lag, retained bytes, connector status, broker lag, sink apply lag를 한 화면에서 본다.
- [ ] snapshot batch size, sleep interval, pause 조건이 숫자로 정해져 있다.
- [ ] backfill worker와 realtime stream worker의 우선순위가 분리되어 있다.
- [ ] sink는 event_id 또는 source version 기준으로 중복 replay를 안전하게 처리한다.
- [ ] schema 변경은 additive first 원칙으로 배포하고, consumer fixture로 검증한다.
- [ ] replication slot 삭제, offset reset, full snapshot 재시작은 별도 승인 절차가 있다.
- [ ] 장애 후 source와 sink를 key range 단위로 비교하는 쿼리나 스크립트가 준비되어 있다.

### 연습

1. 주문 테이블 5,000만 row를 CDC로 검색 인덱스에 동기화한다고 가정하고, snapshot chunk size, pause 조건, lag budget을 10줄로 작성해 보세요.
2. 커넥터가 2시간 멈췄고 replication slot retained bytes가 빠르게 증가하는 상황에서, slot 삭제 전 확인해야 할 항목 5개를 적어 보세요.
3. `orders.status` enum에 새 값이 추가되는 변경을 CDC consumer가 안전하게 받아들이도록 schema rollout 순서를 설계해 보세요.
4. sink가 insert-only인 포인트 지급 시스템과 upsert 가능한 검색 인덱스의 replay 정책 차이를 표로 정리해 보세요.

오늘의 결론은 단순합니다. CDC는 "DB 변경을 자동으로 이벤트로 바꿔 주는 도구"가 아니라, 데이터 변경의 시간·순서·복구 책임을 운영 시스템으로 드러내는 장치입니다. 커넥터를 붙이는 것보다 중요한 일은 lag budget, snapshot throttle, schema compatibility, replay idempotency를 숫자로 정하는 것입니다.
