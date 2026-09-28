---
title: "백엔드 커리큘럼 심화: OLTP와 분석 저장소를 분리하는 이벤트 파이프라인 설계"
date: 2026-09-28T10:07:00+09:00
lastmod: 2026-09-28T10:07:00+09:00
draft: false
topic: "Data Architecture"
tags: ["OLTP", "OLAP", "Analytics", "CDC", "Event Pipeline", "Data Modeling", "Backend"]
categories: ["Backend Deep Dive"]
description: "운영 DB의 트랜잭션을 보호하면서 분석·대시보드·집계 요구를 처리하기 위해 OLTP와 분석 저장소를 분리하는 기준, 이벤트 계약, 적재·재처리·정합성 검증 방법을 정리합니다."
summary: "분석 저장소 분리는 '더 빠른 쿼리용 DB를 하나 추가하는 일'이 아니다. 운영 사실을 어떤 시점·키·버전으로 복제하고, 늦거나 중복된 이벤트를 어떻게 해석하며, 집계가 틀렸을 때 어느 원본으로 돌아갈지를 정하는 데이터 계약이다."
module: "data-system"
study_order: 363
keywords: ["OLTP OLAP separation", "analytics event pipeline", "CDC analytics", "event time watermark", "data reconciliation"]
---

주문·결제·회원 같은 운영 데이터베이스에서 월간 매출, 전환율, 코호트, 운영 대시보드까지 모두 조회하기 시작하면 처음에는 읽기 replica나 인덱스 몇 개로 버틸 수 있다. 하지만 분석 쿼리는 보통 넓은 기간을 스캔하고, 여러 테이블을 큰 단위로 조인하며, "어제 기준"처럼 반복 집계를 요구한다. 그 작업이 주문 생성과 재고 차감을 담당하는 OLTP 데이터베이스와 같은 CPU·I/O·커넥션을 두고 경쟁하면, 분석 화면을 빨리 만들려다 고객 요청의 p99를 악화시키는 역전이 생긴다.

해결책을 "ClickHouse 같은 OLAP DB를 추가한다"로만 이해하면 반쪽짜리다. 저장소를 늘리는 순간 원본과 분석 결과 사이에 지연, 중복, schema 변화, 삭제, 늦게 도착한 이벤트라는 새 계약이 생긴다. 이 글은 특정 제품의 설치법보다 **언제 분리할지, 어떤 사실을 어떤 경로로 옮길지, 결과가 어긋났을 때 어떻게 판정·복구할지**에 초점을 둔다.

이 글은 [CDC Connector 지연·스냅샷 복구](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/), [증분 Materialized View](/learning/deep-dive/deep-dive-materialized-view-incremental-refresh-playbook/), [Hot/Cold 데이터 티어링](/learning/deep-dive/deep-dive-hot-cold-data-tiering-archive-query-playbook/), [테스트 데이터 계약과 마스킹](/learning/deep-dive/deep-dive-test-data-contract-masking-synthetic-seed-playbook/)을 하나의 분석 파이프라인으로 연결한다. 운영 DB를 원본 사실의 권위 있는 저장소로 유지하면서, 분석 계층에는 필요한 형태와 보존 기간만 제공하는 구조를 목표로 한다.

## 이 글에서 얻는 것

- OLTP와 OLAP를 단순한 제품 구분이 아니라 쓰기 정합성·조회 패턴·복구 책임이 다른 워크로드로 분리하는 기준을 얻습니다.
- outbox, CDC, 주기적 batch 중 어떤 전달 경로를 선택할지 변경량·지연·운영 능력에 맞춰 판단할 수 있습니다.
- event time, ingestion time, 중복, 늦은 도착, 삭제, schema 진화를 분석 결과의 계약으로 다루는 방법을 배웁니다.
- 대시보드를 배포하기 전에 원본 대조·freshness·재처리·접근 통제 기준을 숫자로 고정하는 방법을 익힙니다.

## 핵심 개념/이슈

### 1) OLTP와 OLAP의 차이는 데이터량보다 실패 비용에 있다

OLTP는 짧고 작은 트랜잭션을 정확히 처리하는 데 최적화한다. 주문 하나를 만들고 재고를 줄이며 결제 상태를 바꾸는 요청은 보통 한 사용자·한 aggregate를 중심으로 읽고 쓴다. 여기서 중요한 실패는 이중 청구, 음수 재고, 오래된 권한처럼 **한 건의 잘못된 상태 변경**이다. 반대로 OLAP는 많은 row를 읽어 기간·그룹·차원별로 집계하고, 새로운 질문을 반복해서 던지는 데 맞춘다. 이쪽의 실패는 수십 분 늦은 지표, 잘못된 분모, 비용 폭증, 팀마다 다른 숫자처럼 **의사결정의 왜곡**으로 나타난다.

둘을 나누는 신호는 row 수 하나가 아니다. 다음 중 둘 이상이 반복되면 분석 경로를 별도로 검토할 만하다.

| 관찰한 현상 | 운영 DB에서 먼저 할 일 | 분리 검토 신호 |
| --- | --- | --- |
| 주간·월간 집계가 긴 range scan을 만든다 | 실행 계획, 필요한 인덱스, query timeout 확인 | peak 시간에 analytics query가 DB CPU의 20% 이상을 지속 사용 |
| 대시보드가 수십 초마다 같은 집계를 반복한다 | cache·materialized view 가능성 검토 | 5개 이상 팀이 서로 다른 집계 테이블을 따로 유지 |
| 제품 쿼리와 BI 쿼리가 같은 replica를 포화시킨다 | workload별 pool·priority 분리 | replica lag가 사용자 read SLO를 넘거나, 분석이 OLTP pool을 기다리게 함 |
| 과거 1년치를 조인한다 | 필요한 세부도와 retention 점검 | 한 요청의 scan이 수백 GB 또는 timeout을 반복 |

위 숫자는 절대 기준이 아니라 조사 시작점이다. 트래픽이 작은 서비스는 분석 DB보다 잘 설계한 summary table 하나가 낫다. 반대로 데이터가 커도 월 1회 오프라인 보고서라면 밤 batch가 충분할 수 있다. 우선순위는 **운영 쓰기 보호 → 결과의 설명 가능성 → 분석 응답 시간**이다. 빠른 대시보드를 위해 주문 저장을 불안정하게 만들면 분리의 목적을 잃는다.

### 2) "복제"보다 먼저 분석 사실의 grain과 시간 축을 정한다

분석 저장소에 `orders` 테이블을 통째로 옮기는 것은 시작일 뿐이다. 어떤 row가 무엇 하나를 뜻하는지, 즉 grain을 먼저 정해야 집계가 일관된다. `order_created`는 주문당 한 건, `payment_attempted`는 시도당 한 건, `daily_sales`는 날짜·통화·판매 채널당 한 건처럼 서로 다르다. 주문 상태가 `PAID`로 바뀔 때 기존 row를 갱신할지, 상태 변화 이벤트를 append할지도 같은 질문이다.

시간도 최소 두 축을 둔다.

- **event time**: 업무 사건이 실제로 발생한 시각. 결제가 승인된 시각, 주문이 취소된 시각처럼 지표의 기준이 된다.
- **ingestion time**: 파이프라인이 사건을 받은 시각. 지연·장애·backfill을 발견하는 운영 신호가 된다.

예를 들어 23:58에 결제된 이벤트가 네트워크 장애 때문에 다음 날 00:07에 도착할 수 있다. ingestion time만 쓰면 어제 매출이 줄고 오늘 매출이 늘어난다. event time만 보고 지연을 숨기면 "어제 매출"이 계속 바뀌는 이유를 알 수 없다. 따라서 fact에는 `event_id`, `entity_id`, `event_time`, `ingested_at`, `source_version`, `schema_version`을 최소 후보로 두고, 대시보드가 어떤 축을 기준으로 하는지 명시한다.

`event_id`는 재처리와 at-least-once 전달을 다루기 위한 키다. 소비자가 같은 이벤트를 두 번 받아도 분석 fact가 두 배가 되지 않아야 한다. 단순히 producer offset을 전역 ID처럼 쓰면 source 교체나 partition 재배치에서 어려워질 수 있다. 업무 이벤트의 안정 ID와 source position을 분리해 저장하는 편이 좋다. [Transactional Inbox와 Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)의 원칙처럼, 중복 제거는 "메시지가 한 번만 왔다"는 희망이 아니라 저장소가 증명할 수 있는 identity에서 시작한다.

### 3) 전달 경로는 지연 목표와 원본 변경 권한에 맞춰 고른다

대표 경로는 세 가지다. 정답은 없고, 누가 원본 코드·DB 로그·운영 장애를 소유하는지가 선택 기준이다.

| 경로 | 잘 맞는 경우 | 장점 | 주의할 비용 |
| --- | --- | --- | --- |
| Transactional outbox | 서비스가 업무 이벤트의 의미를 명확히 안다 | 상태 변경과 발행 의도를 같은 transaction에 기록 | consumer·relay·재처리와 event schema를 소유해야 함 |
| CDC | 기존 DB 변경을 넓게 반영해야 한다 | 애플리케이션 코드 침범을 줄이고 테이블 변경을 capture | snapshot, WAL/binlog 보존, DDL, 삭제 의미를 운영해야 함 |
| 주기적 batch | 시간 단위 지연이 허용된다 | 구현·비용이 단순하고 검증하기 쉬움 | window 누락, watermark, 원본 부하, 늦은 수정 처리 필요 |

outbox는 "주문이 생성됐다"처럼 도메인이 해석된 이벤트에 강하다. 단, `orders` row가 바뀌었다는 사실만으로 모든 downstream이 필요한 의미를 얻는 것은 아니다. CDC는 기존 테이블을 폭넓게 옮길 때 유용하지만, `UPDATE` 전후 이미지와 tombstone, schema migration, 초기 snapshot 뒤의 변경을 정확히 잇는 일이 핵심이다. batch는 1시간 freshness가 허용되는 내부 재무 보고에 좋은 출발점이지만, `updated_at > last_run` 하나만으로는 clock skew·동일 timestamp·중간 실패에서 row를 빼먹을 수 있다.

따라서 경로를 고른 뒤에는 "최소 한 번 전달"을 전제로 설계한다. 소비자는 dedup key를 강제하고, raw 이벤트는 짧은 보존 기간이라도 재처리 가능하게 남기며, 집계는 source event와 build version을 추적해야 한다. exactly-once라는 라벨보다 **중복·누락·순서 역전을 어떤 데이터와 절차로 복구하는가**가 더 중요한 운영 질문이다.

### 4) 늦은 이벤트와 정정은 오류가 아니라 정상 흐름으로 다룬다

분석이 어려운 이유는 새 이벤트만 들어오지 않기 때문이다. 결제 취소가 이틀 뒤 발생하고, 환율 보정이 지난달 데이터에 적용되며, 개인정보 삭제 요청으로 과거 row를 제거해야 할 수 있다. "하루 집계는 자정에 닫는다"는 규칙만 두면 수정된 사실과 보고서가 갈라진다.

처음에는 도메인별 허용 lateness를 명시하는 편이 현실적이다. 예를 들어 운영 대시보드는 최근 2시간의 이벤트를 15분마다 재집계하고, 일일 매출은 72시간 동안 정정 window를 열어 두며, 월 결산은 별도 close process 뒤에만 version을 올리는 식이다. `2026-09-28` 매출이 수정되면 숫자를 조용히 덮어쓰기보다 `metric_version`, build time, source watermark를 보여 주는 편이 논쟁과 재현 비용을 줄인다.

삭제도 마찬가지다. 분석 편의 때문에 운영 DB의 soft delete를 영구 보관하면 안 된다. 개인정보·보존 정책은 분석 저장소에도 적용된다. 원본 키를 직접 복제해야 하는지, pseudonymous key로 충분한지, raw 이벤트·집계·backup 각각의 보존 기간이 무엇인지 분리한다. 마스킹된 테스트 fixture와 실제 production export를 혼동하지 않는 기준은 [테스트 데이터 계약과 마스킹](/learning/deep-dive/deep-dive-test-data-contract-masking-synthetic-seed-playbook/)을 함께 확인한다.

## 실무 적용

### 1) 첫 파이프라인은 핵심 지표 3개와 원본 대조표로 시작한다

처음부터 모든 테이블을 복제하지 않는다. 주문 수, 결제 승인액, 취소 수처럼 사업자가 정의를 설명할 수 있는 지표 3개를 고른다. 각 지표에 대해 source table 또는 event, grain, event time, 포함·제외 상태, dedup key, 개인정보 등급, owner를 한 장의 registry에 적는다.

그 다음 raw → normalized fact → aggregate의 세 층을 분리한다. raw 층은 원본 payload를 장기 보관하라는 뜻이 아니라, 재처리에 필요한 최소한의 변경 기록과 source position을 보존한다는 뜻이다. normalized fact는 타입·통화·시간대·상태를 정규화하고 dedup을 적용한다. aggregate는 대시보드와 SLO용으로 날짜·채널·상품군처럼 제한된 차원만 미리 계산한다. 세 층을 한 SQL에 섞으면 지표가 틀렸을 때 원인이 source, mapping, 집계 중 어디인지 분리하기 어렵다.

대조는 배포 후가 아니라 배포 전부터 자동화한다. 예를 들어 24시간 이동창에서 `COUNT(DISTINCT order_id)`와 승인액 합계를 OLTP의 제한된 read query와 분석 fact에서 비교한다. 정상적인 지연을 감안한 cutoff를 동일하게 적용하고, 차이가 주문 수 **0.1%** 또는 승인액 **0.05%**를 넘으면 대시보드 확대를 멈춘다. 한 건의 고액 결제나 데이터 삭제 누락처럼 비율로 희석하면 안 되는 항목은 별도 exact check로 둔다.

### 2) freshness와 품질을 제품 지표처럼 운영한다

분석 파이프라인은 백그라운드 job이지만, 사용자와 운영자가 숫자에 의존한다면 SLO가 필요하다. 최소 대시보드는 아래 항목을 함께 보여 줘야 한다.

| 지표 | 시작 목표 | 초과 시 우선 대응 |
| --- | --- | --- |
| source-to-fact freshness p95 | 운영 대시보드 15분 이내 | connector/queue lag와 source 장애를 분리 |
| duplicate drop rate | 전체 이벤트의 0.5% 미만, 급증 시 조사 | producer retry·consumer checkpoint·ID 생성 확인 |
| reconciliation mismatch | count 0.1% 미만, 금액 0.05% 미만 | window·time zone·status mapping부터 대조 |
| schema reject | 0.01% 미만 | 새 field를 무시하지 말고 producer version·contract 확인 |
| analytic query cost | 예산 내 scan·concurrency | dashboard query·partition·rollup 조정 |

숫자는 서비스 특성에 맞게 조정해야 한다. 핵심은 처리량만 보는 대신 freshness, 정합성, 비용을 함께 본다는 것이다. lag가 0이어도 잘못된 schema를 빠르게 적재하면 분석은 틀릴 수 있고, count가 맞아도 중복된 통화 단위나 잘못된 시간대는 매출을 왜곡한다.

### 3) 재처리는 새 파이프라인처럼 승인한다

bug fix나 schema 변경 뒤 지난 90일을 다시 적재하고 싶어질 수 있다. 이때 production aggregate를 곧바로 truncate하고 채우면, 재처리 코드의 오류가 현재 대시보드 전체를 바꾼다. 재처리는 range·source watermark·transform version·대상 dataset·승인자를 명시한 job으로 다룬다.

권장 순서는 작다. 먼저 1일 구간을 별도 candidate dataset에 rebuild하고, original과 count·sum·null rate·상위 dimension 분포를 비교한다. 그 다음 7일, 30일로 범위를 넓힌다. candidate가 통과하면 versioned view 또는 atomic swap으로 소비자를 전환한다. 롤백은 이전 view를 가리키는 일로 끝나야 하며, raw source를 삭제하는 일이 되어서는 안 된다. [CDC 복구 플레이북](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/)과 [증분 Materialized View](/learning/deep-dive/deep-dive-materialized-view-incremental-refresh-playbook/)의 checkpoint·watermark·원자적 전환 원칙을 함께 적용하면 범위를 좁힐 수 있다.

## 트레이드오프/주의점

1. **분리는 즉시 일관성을 포기하는 선택일 수 있다.** 분석 결과는 보통 운영 transaction 직후의 진실이 아니다. 결제 승인 직후의 정확한 잔액처럼 강한 일관성이 필요한 화면은 OLTP 또는 명시적인 read model을 사용한다.
2. **CDC가 도메인 이벤트를 자동으로 만들어 주지 않는다.** 컬럼 변경은 변경 이유, actor, 업무 전이를 충분히 설명하지 못한다. 필요한 의미는 outbox나 별도 모델에서 보강한다.
3. **raw 보관은 보안 면적을 넓힌다.** 재처리 편의와 개인정보 최소화는 충돌할 수 있다. payload 전체를 기본 저장하지 말고, 목적·마스킹·retention·접근 권한을 signal별로 정한다.
4. **OLAP의 빠른 query가 무제한 차원을 정당화하지 않는다.** user ID, raw URL, request ID 같은 고카디널리티 차원은 저장·비용·권한 문제를 함께 만든다. 대시보드 필터가 정말 필요한 값만 허용한다.
5. **하나의 정답 숫자를 강요하면 데이터 계보가 사라진다.** 운영 실시간 수치, 잠정 일일 지표, 결산 확정 수치는 모두 유효할 수 있다. 이름·cutoff·version을 숨기지 말고 소비자에게 드러낸다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 분석 대상 지표마다 grain, source, event time, ingestion time, dedup key, 포함 상태, owner를 등록했다.
- [ ] OLTP 보호 신호(CPU, pool wait, replica lag)와 analytics 분리 근거를 실제 측정값으로 남겼다.
- [ ] outbox, CDC, batch 중 한 경로를 선택하고 중복·누락·순서 역전·DDL·삭제 처리 방법을 문서화했다.
- [ ] raw, normalized fact, aggregate의 역할과 retention·접근 통제를 분리했다.
- [ ] count·금액·null rate·상위 dimension을 원본과 자동 대조하고, mismatch 중단 기준을 정했다.
- [ ] freshness, duplicate, schema reject, query cost의 baseline과 경보 owner가 있다.
- [ ] backfill은 candidate dataset, 비교, atomic 전환, rollback view를 거친다.

### 연습: 주문 분석 경로 설계하기

`orders`, `payments`, `refunds`가 있는 서비스를 가정해 보자. "일일 승인액"을 먼저 정의한다. 승인 시도와 최종 승인 중 어느 것을 셀지, 부분 환불을 같은 날짜에서 뺄지 환불 발생일에 반영할지, 통화 환산 시각은 무엇인지 적는다. 다음으로 `payment_authorized`, `payment_refunded` fact의 grain과 dedup key를 설계하고, 48시간 늦게 들어온 환불이 발생했을 때 7일 집계와 월 결산이 각각 어떻게 갱신되는지 써 본다. 마지막으로 OLTP 대조 query와 분석 query가 같은 cutoff에서 금액 차이 0.05%를 넘었을 때 확인할 세 가지 가설을 정한다.

## 마무리

OLTP와 분석 저장소의 분리는 DB를 하나 더 도입하는 프로젝트가 아니다. 운영 상태를 지키면서도 조직이 신뢰할 수 있는 질문과 숫자를 만들기 위한 계약 설계다. 작은 지표·명확한 fact·자동 대조에서 시작하고, 지연·정정·재처리의 실패 경로까지 설명할 수 있을 때만 파이프라인 범위를 넓히자.
