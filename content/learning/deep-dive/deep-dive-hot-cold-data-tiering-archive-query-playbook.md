---
title: "백엔드 커리큘럼 심화: Hot/Cold 데이터 분리와 아카이브 조회 플레이북"
date: 2026-07-12
draft: false
topic: "Database"
tags: ["Database", "Archive", "Hot Cold Tiering", "Partitioning", "Query Performance", "Retention"]
categories: ["Backend Deep Dive"]
description: "오래된 데이터를 단순 보관하지 않고 핫 경로, 콜드 경로, 아카이브 조회를 나눠 성능과 보존 요구를 함께 만족시키는 실무 기준을 정리합니다."
module: "database"
study_order: 1465
summary: "대형 테이블에서 현재 업무 데이터와 과거 데이터를 분리해 조회 성능, 보관 정책, 운영 비용을 동시에 관리하는 Hot/Cold 데이터 티어링 플레이북입니다."
keywords: ["hot cold data tiering", "archive table", "database archive", "데이터 아카이빙", "핫 콜드 데이터 분리"]
key_takeaways:
  - "아카이브는 삭제 정책의 부록이 아니라 핫 쿼리 경로를 보호하는 읽기 경계다."
  - "핫 테이블에는 현재 업무 판단에 필요한 working set만 남기고, 오래된 데이터는 별도 조회 UX와 SLA로 분리한다."
  - "분리 기준은 보존 기간이 아니라 p95, 테이블 크기 증가율, 인덱스 크기, autovacuum, 운영 조회 빈도를 함께 봐야 한다."
operator_checklist:
  - "핫 테이블별 active row 비율, soft-deleted 비율, index/table size, p95 조회 시간을 30일 단위로 본다."
  - "아카이브 이동 전후 hot query plan, batch duration, autovacuum duration, backup size를 비교한다."
  - "콜드 조회는 별도 API, 별도 권한, 별도 timeout, 별도 export 경로로 분리한다."
learning_refs:
  - title: "데이터 보존/삭제 아키텍처"
    href: "/learning/deep-dive/deep-dive-data-retention-deletion-architecture/"
    description: "보존 기간, 논리 삭제, 물리 삭제, 아카이브 수명주기를 먼저 정리합니다."
  - title: "Partial Index와 Covering Index"
    href: "/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/"
    description: "활성 데이터만 빠르게 조회하기 위한 조건부 인덱스 전략입니다."
  - title: "PostgreSQL Autovacuum 튜닝"
    href: "/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/"
    description: "오래된 행과 dead tuple이 핫 테이블 운영에 미치는 영향을 다룹니다."
  - title: "대용량 Export 파이프라인"
    href: "/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/"
    description: "콜드 데이터를 화면 조회가 아니라 산출물 생성 경로로 분리하는 기준입니다."
---

서비스가 작을 때는 주문, 결제, 알림, 감사 로그 같은 데이터를 한 테이블에 계속 쌓아도 큰 문제가 보이지 않습니다. 인덱스를 몇 개 추가하면 목록 조회가 버티고, 오래된 데이터는 `status`, `created_at`, `deleted_at` 조건으로 걸러내면 됩니다. 하지만 테이블이 수천만 row를 넘고, 월별 배치와 CS 조회와 사용자 화면이 같은 테이블을 때리기 시작하면 이야기가 달라집니다. 오래된 데이터는 조회 빈도가 낮아도 인덱스, vacuum, 백업, 통계, 배치 시간을 계속 잡아먹습니다.

그래서 아카이브는 "언젠가 지울 데이터의 임시 창고"가 아니라 **핫 경로를 보호하는 데이터 경계**로 봐야 합니다. 이 글은 [데이터 보존/삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/), [PostgreSQL Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/), [대용량 Export 파이프라인](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)과 이어지는 운영 플레이북입니다.

## 이 글에서 얻는 것

- Hot 데이터와 Cold 데이터를 보존 기간이 아니라 업무 조회 패턴 기준으로 나눌 수 있습니다.
- 아카이브 테이블, 파티션, 오브젝트 스토리지 중 어떤 선택이 맞는지 판단 기준을 세울 수 있습니다.
- 과거 조회를 유지하면서도 현재 목록 API, 배치, 백업, autovacuum 비용을 줄이는 절차를 설계할 수 있습니다.
- "그냥 오래된 row를 옮기자"가 아니라 SLA, 권한, 정합성, 롤백까지 포함한 분리 계획을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Hot 데이터는 최근 데이터가 아니라 자주 쓰는 업무 데이터다

Hot 데이터는 단순히 최근 30일 데이터라는 뜻이 아닙니다. 현재 주문 처리, 환불 판단, 알림 재시도, 사용자 화면 렌더링처럼 **지금의 업무 결정을 위해 자주 읽고 쓰는 working set**입니다. 반대로 Cold 데이터는 오래됐다는 이유만으로 정해지지 않습니다. 2년 전 결제 내역이라도 CS 센터가 매일 확인한다면 조회 경로는 살아 있어야 합니다. 다만 이 조회는 현재 주문 목록과 같은 p95 100~200ms SLA를 가질 필요가 없습니다.

실무에서는 세 단계로 나누면 판단이 쉬워집니다.

| 구간 | 예시 | 권장 SLA |
| --- | --- | --- |
| Hot | 진행 중 주문, 최근 30~90일 알림, 미정산 거래 | API p95 100~300ms |
| Warm | 최근 6~12개월 완료 주문, CS 빈번 조회 | p95 500ms~2s, 별도 인덱스 |
| Cold | 법정 보관, 감사, 장기 통계 원천 | 비동기 조회 또는 export |

핫 테이블에 Cold 데이터를 계속 두면 현재 업무가 과거 보관 비용까지 떠안습니다. 이것이 아카이브 분리의 출발점입니다.

### 2) 아카이브 분리는 조회 계약을 다시 쓰는 작업이다

아카이브를 단순 `INSERT INTO archive SELECT ... DELETE ...`로 보면 위험합니다. 데이터 위치가 바뀌면 조회 계약도 바뀝니다. 사용자는 "내역이 사라졌다"고 느낄 수 있고, 운영자는 "검색은 되는데 느리다"고 불만을 가질 수 있습니다. 그래서 먼저 정해야 할 것은 저장 위치가 아니라 조회 계약입니다.

- 기본 화면은 Hot/Warm 범위만 조회한다.
- 기간을 1년 이상 넓히면 별도 검색 화면이나 export로 보낸다.
- Cold 조회는 timeout을 길게 잡되 동시 실행 수를 제한한다.
- 개인정보·민감정보는 archive 권한을 hot API 권한과 분리한다.
- 삭제/보존 정책은 archive 이동과 별개로 만료일을 가진다.

이렇게 하지 않으면 애플리케이션 곳곳에 `hot_table UNION ALL archive_table`이 퍼집니다. 처음에는 편하지만, 시간이 지나면 모든 조회가 느려지고 권한 경계도 흐려집니다.

### 3) soft delete 비율은 구조 개선 신호다

논리 삭제는 복구와 감사에 유리하지만, 삭제된 row가 핫 테이블에 계속 남으면 성능 비용을 만듭니다. [Partial Index와 Covering Index](/learning/deep-dive/deep-dive-partial-covering-index-soft-delete-playbook/)로 `deleted_at IS NULL` 조건을 최적화할 수는 있지만, 삭제·완료·만료 row가 테이블의 15~20%를 넘고 계속 늘어난다면 인덱스만으로 버티기 어렵습니다.

위험 신호는 아래와 같습니다.

- active row보다 inactive row가 더 빨리 증가한다.
- 전체 인덱스 크기가 테이블 크기의 50%를 넘는다.
- 월말 배치 시간이 데이터 증가율보다 빠르게 늘어난다.
- autovacuum duration이 피크 시간과 겹치기 시작한다.
- 백업/복구 시간이 RTO 목표를 위협한다.

이때는 쿼리 튜닝보다 데이터 수명주기 분리가 우선일 수 있습니다.

## 실무 적용

### 1) 분리 기준은 숫자로 잡는다

보수적인 기본값은 아래처럼 시작할 수 있습니다.

| 판단 항목 | 시작 기준 |
| --- | --- |
| Hot 보존 범위 | 사용자 화면·업무 처리 기준 최근 30~90일 |
| Warm 보존 범위 | CS 조회 기준 최근 6~12개월 |
| Cold 이동 기준 | 완료/취소/만료 후 90~180일 경과 |
| soft-deleted 비율 | 15~20% 초과 시 구조 개선 검토 |
| hot API p95 | 300ms 초과 반복 시 archive 영향 확인 |
| cold 조회 timeout | 10~60초 또는 비동기 export |
| archive job 속도 | DB spare write QPS의 20~30% 이내 |

숫자는 서비스마다 다릅니다. 핵심은 "오래됐으니 옮긴다"가 아니라 "핫 경로의 SLA와 운영 비용을 지키기 위해 옮긴다"는 점입니다.

### 2) 선택지는 테이블 분리, 파티션, 오브젝트 스토리지다

아카이브 방식은 보통 세 가지입니다.

| 방식 | 맞는 경우 | 주의점 |
| --- | --- | --- |
| archive table | 같은 DB에서 간헐 조회와 조인이 필요 | 운영 쿼리가 쉽게 hot/cold를 섞을 수 있음 |
| range partition | 기간 기준 pruning이 명확하고 DB 내 관리가 필요 | 파티션 수, 인덱스, DDL 운영 규칙 필요 |
| object storage | 장기 보관, 감사, 대량 export 중심 | 실시간 검색이 약하고 별도 카탈로그 필요 |

주문/결제처럼 CS가 가끔 상세 조회해야 하는 데이터는 archive table이나 기간 파티션이 현실적입니다. 이벤트 로그, 감사 원천, 과거 리포트 재생성용 데이터는 오브젝트 스토리지와 메타데이터 카탈로그가 더 낫습니다. 화면에서 과거 5년치를 자유 검색해야 한다면 검색 인덱스나 별도 분석 저장소를 검토해야지, 운영 DB의 기본 목록 API에 계속 얹으면 안 됩니다.

### 3) 안전한 이동 절차

분리는 한 번에 끝내지 말고 네 단계로 진행합니다.

1. 읽기 경로를 먼저 분리합니다. 기본 API는 hot 범위만 보고, 과거 조회는 명시 파라미터나 별도 endpoint로 보냅니다.
2. dual-read 없이 shadow query로 결과 차이를 검증합니다. 같은 조건에서 hot+archive 후보 결과가 기존 결과와 맞는지 7~14일 비교합니다.
3. 작은 배치로 이동합니다. 한 번에 수백만 row를 옮기지 말고 primary key range 기준으로 끊고, lock wait와 replica lag를 상한으로 둡니다.
4. 삭제와 vacuum을 분리합니다. archive insert 성공 직후 대량 delete를 밀어붙이지 말고, off-peak와 vacuum 여력을 보고 진행합니다.

운영 기준은 명확해야 합니다. archive job 중 replica lag가 5초 이상 5분 지속되면 중단, hot API p95가 20% 이상 악화되면 속도 절반으로 감소, lock wait가 1초 이상 반복되면 batch size를 줄이는 식입니다. 이 기준이 없으면 "아카이브 작업 때문에 서비스가 느려졌다"는 애매한 상황만 남습니다.

### 4) 인덱스와 통계도 따로 설계한다

Hot 테이블은 현재 업무 조회에 맞춘 좁은 인덱스가 좋습니다. Cold 테이블은 기간 검색, 사용자 ID 검색, 감사 키 검색처럼 운영 조회에 맞춘 인덱스가 필요합니다. 두 경로의 인덱스를 같게 만들면 아카이브 분리 이점이 줄어듭니다.

예를 들어 hot 주문 테이블은 `(tenant_id, status, created_at DESC)`가 핵심일 수 있습니다. archive 주문 테이블은 `(tenant_id, user_id, completed_at DESC)`나 `(external_payment_id)`가 더 중요할 수 있습니다. Cold 조회는 RPS가 낮으므로 쓰기 증폭보다 탐색 편의가 더 중요할 때도 있습니다. 이 판단은 [PostgreSQL 인덱스 쓰기 증폭 예산](/learning/deep-dive/deep-dive-postgresql-index-write-amplification-budget-playbook/)과 함께 봐야 합니다.

## 트레이드오프/주의점

첫째, 아카이브 분리는 애플리케이션 복잡도를 늘립니다. hot API, archive API, export job, 권한, 모니터링이 분리되므로 작은 서비스에는 과할 수 있습니다. 테이블이 작고 RTO/RPO를 위협하지 않는다면 partial index와 보존 정책만으로 충분할 수 있습니다.

둘째, 정합성 경계가 생깁니다. 이동 중인 row를 사용자가 조회하거나, 결제 취소처럼 과거 데이터를 다시 활성화해야 하는 경우가 있습니다. 이런 업무가 있다면 archive row를 hot으로 되돌리는 rehydrate 절차와 idempotency key가 필요합니다.

셋째, 규제 보존과 성능 아카이브를 섞으면 안 됩니다. 법적으로 5년 보관해야 한다는 말은 운영 DB에 5년 동안 둬야 한다는 뜻이 아닙니다. 반대로 archive로 옮겼다고 삭제 의무가 사라지는 것도 아닙니다. 보존 만료와 물리 삭제는 별도 워크플로우로 관리해야 합니다.

넷째, `UNION ALL` 만능 패턴은 조심해야 합니다. 모든 조회를 hot+archive로 합치면 분리 효과가 거의 사라지고, planner와 pagination이 복잡해집니다. 기본은 hot만, 명시적 과거 조회만 archive 접근으로 제한하는 편이 안전합니다.

## 체크리스트 또는 연습

- [ ] 핵심 테이블별 active/inactive row 비율과 30일 증가율을 확인했다.
- [ ] hot API와 archive 조회의 SLA, timeout, 권한을 분리했다.
- [ ] soft delete 또는 완료 row가 15~20%를 넘는 테이블을 구조 개선 후보로 올렸다.
- [ ] archive job의 batch size, 중단 조건, replica lag 상한을 정했다.
- [ ] hot table과 archive table의 인덱스 목적을 따로 정의했다.
- [ ] 장기 보존 만료와 물리 삭제 절차를 archive 이동과 분리했다.

연습 과제:

1. 주문, 알림, 감사 로그 중 하나를 골라 Hot/Warm/Cold 기준을 숫자로 정해 보세요. 기간, 조회 SLA, 권한, 이동 조건을 표로 작성합니다.
2. 기존 목록 API 하나에 대해 "기본 조회는 hot만", "과거 조회는 archive endpoint"로 나눴을 때 필요한 UI/백엔드 변경을 적어 보세요.
3. archive job의 안전장치를 설계해 보세요. 예를 들어 batch size 5,000건, replica lag 5초 초과 시 중단, hot API p95 20% 악화 시 속도 절반 같은 식으로 운영 조건을 정합니다.

좋은 아카이브 설계는 데이터를 숨기는 일이 아닙니다. 현재 업무가 빠르게 돌아가야 하는 경로와, 과거 데이터를 책임 있게 보존하고 조회하는 경로를 분리하는 일입니다. 이 경계를 숫자와 계약으로 남겨두면 테이블이 커져도 성능과 보존 요구가 서로 발목을 잡지 않습니다.
