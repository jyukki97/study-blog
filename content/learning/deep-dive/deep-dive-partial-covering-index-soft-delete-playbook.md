---
title: "백엔드 커리큘럼 심화: Partial Index와 Covering Index로 느린 조회와 과한 쓰기 비용을 같이 줄이는 법"
date: 2026-05-01
draft: false
topic: "Database"
tags: ["Partial Index", "Covering Index", "PostgreSQL", "MySQL", "Soft Delete", "Query Tuning"]
categories: ["Backend Deep Dive"]
description: "인덱스를 더 만드는 대신, 어떤 조건의 데이터만 인덱싱하고 어떤 조회는 테이블 접근 없이 끝내야 하는지 실무 숫자 기준으로 정리합니다."
module: "backend-data-system"
study_order: 1185
---

인덱스 튜닝을 처음 배울 때는 보통 "느린 쿼리에 인덱스를 추가하자"로 끝납니다. 그런데 운영에서는 그다음 문제가 바로 나옵니다. 인덱스를 추가할수록 조회는 빨라질 수 있지만, 쓰기 비용과 스토리지 비용도 같이 올라갑니다. 특히 `soft delete`, `status`, `tenant_id`, `updated_at` 같은 컬럼이 많은 서비스는 "자주 조회되는 일부 행만 빠르게 찾고 싶은데 전체 테이블을 다 인덱싱하는" 비효율이 자주 생깁니다. 이럴 때 강한 카드가 **Partial Index**와 **Covering Index**입니다.

핵심은 단순히 인덱스를 더 만드는 게 아니라, **어떤 행만 인덱싱할지**, **어떤 조회를 테이블 접근 없이 끝낼지**를 분리해서 판단하는 것입니다. 이 글은 [MySQL 인덱스 설계와 실행 계획 읽기](/learning/deep-dive/deep-dive-mysql-index-explain/), [SQL 기본: 조인/집계/인덱스가 먹는 조건 감각](/learning/deep-dive/deep-dive-sql-basics-joins-explain/), [PostgreSQL Index Bloat/Reindex/Fillfactor 플레이북](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/), [운영 중 스키마 변경 실전: Online DDL + Expand/Contract 패턴](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)과 연결해서 보면 가장 실전적으로 이해됩니다.

## 이 글에서 얻는 것

- Partial Index와 Covering Index가 각각 어떤 문제를 줄이는지 분리해서 설명할 수 있습니다.
- `soft delete`, `status`, `tenant_id`가 많은 서비스에서 전체 인덱스보다 조건부 인덱스가 유리한 시점을 판단할 수 있습니다.
- 읽기 성능만 보지 않고 **write amplification, index bloat, buffer hit, 실행계획 안정성**까지 함께 보는 실무 기준을 잡을 수 있습니다.
- PostgreSQL과 MySQL에서 같은 요구를 서로 다르게 구현해야 하는 이유를 감각적으로 이해할 수 있습니다.

## 핵심 개념/이슈

### 1) 인덱스 문제의 본질은 "없음"보다 "과잉"에서 더 자주 터진다

운영 초반에는 인덱스 부족이 문제지만, 서비스가 커지면 오히려 **인덱스 과잉**이 더 흔한 병목이 됩니다. 이유는 간단합니다.

- INSERT/UPDATE/DELETE마다 관련 인덱스를 같이 갱신해야 함
- soft delete row가 쌓일수록 자주 안 쓰는 값까지 계속 인덱싱됨
- 상태 컬럼이 자주 바뀌면 같은 row가 여러 인덱스 페이지를 계속 흔듦
- 조회는 빨라졌는데 autovacuum, reindex, checkpoint, replication lag가 악화됨

특히 `deleted_at IS NULL`인 활성 데이터만 주로 보는 서비스에서 전체 인덱스를 유지하면, 실제로는 잘 안 보는 삭제 데이터까지 모두 쓰기 비용을 내게 됩니다. 이 상황은 [DB 락 경합 실전 플레이북](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)에서 말한 대기 증가와도 이어집니다. 느린 쿼리 하나보다, 과한 인덱스가 전체 write latency를 계속 밀어 올리는 편이 더 비싼 문제일 수 있습니다.

### 2) Partial Index는 "자주 보는 일부 행"만 빠르게 찾는 장치다

Partial Index는 말 그대로 **조건을 만족하는 행만 인덱싱**합니다. 예를 들어 아래 같은 조회가 핵심 API를 지배한다면 매우 유효합니다.

- `WHERE deleted_at IS NULL`
- `WHERE status = 'ACTIVE'`
- `WHERE tenant_id = ? AND archived = false`
- `WHERE retry_count < 3 AND next_run_at <= now()`

PostgreSQL에서는 이런 패턴을 인덱스 조건으로 직접 표현할 수 있습니다. 그러면 활성 행만 인덱스에 들어가므로 세 가지 이점이 생깁니다.

1. 인덱스 크기 감소
2. 캐시 적중률 개선
3. 쓰기 시 갱신 대상 축소

실무에서는 아래 조건이 겹치면 Partial Index 우선 검토 가치가 큽니다.

- 전체 row 중 활성 row 비율이 **30% 이하**
- 핵심 읽기 트래픽의 **50% 이상**이 같은 필터를 공유
- 관련 인덱스가 테이블 크기의 **25~40% 이상**을 차지
- soft delete 또는 상태 변경으로 인한 UPDATE가 분당 수천 건 이상 발생

즉 Partial Index는 "모든 조회를 빠르게"가 아니라, **가장 비싼 핵심 필터를 더 작은 구조로 닫는 전략**입니다.

### 3) Covering Index는 "찾은 뒤 다시 테이블로 가지 않게" 만드는 장치다

Covering Index는 검색 조건뿐 아니라 **조회 결과에 필요한 컬럼까지 인덱스에 포함**해서, 가능하면 테이블 heap/clustered row 재접근을 줄이는 방식입니다. 흔히 실행계획에서 `Index Only Scan`, 혹은 MySQL에서는 "Using index"에 가까운 목표를 노립니다.

예를 들어 목록 API가 아래처럼 동작한다고 해봅시다.

```sql
SELECT id, title, price, updated_at
FROM products
WHERE tenant_id = ?
  AND status = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 20;
```

이 쿼리가 트래픽 상위권이라면 `tenant_id, status, updated_at DESC`만으로는 부족할 수 있습니다. 결과에 필요한 `id, title, price`를 매번 본문 테이블에서 다시 읽으면 랜덤 I/O와 버퍼 접근이 늘어납니다. 이때 Covering Index는 조회 지연을 줄이는 데 특히 강합니다.

다만 오해하면 안 되는 점이 있습니다. Covering Index는 항상 정답이 아닙니다. 결과 컬럼이 너무 많아지면 인덱스 자체가 비대해지고, 결국 읽기 이득보다 쓰기 손해가 커질 수 있습니다. 보통은 아래 기준이 현실적입니다.

- 목록/검색 API처럼 **짧은 row projection**인 경우 우선 검토
- 결과 컬럼이 **3~6개 정도**로 작고 고정적일 때 적합
- LIMIT 기반 조회이며 정렬과 필터가 안정적일 때 효과 큼
- 반대로 본문, JSON 대형 컬럼, 긴 텍스트까지 넣는 것은 피하는 편이 좋음

### 4) Partial Index와 Covering Index는 경쟁재가 아니라 조합재다

좋은 설계는 둘 중 하나만 쓰는 게 아니라, **필터를 줄일 것인지, 테이블 재접근을 줄일 것인지**를 분리해서 봅니다.

예를 들어 운영 대시보드의 "활성 주문 50건 조회"는 아래처럼 사고할 수 있습니다.

- 활성 주문만 본다 → Partial Index 후보
- 목록 화면이라 필요한 컬럼이 적다 → Covering Index 후보
- 최신순 정렬이 고정이다 → 정렬 컬럼 포함 후보

즉 아래 조합이 가능합니다.

- `WHERE deleted_at IS NULL AND status = 'PAID'` 로 인덱스 범위를 축소
- `tenant_id, created_at DESC`로 탐색/정렬 고정
- 목록에 필요한 `id, amount, created_at` 정도만 인덱스에서 바로 반환

이 접근은 단순 SQL 튜닝보다 **API 사용 패턴을 인덱스 구조로 반영하는 일**에 가깝습니다.

### 5) MySQL과 PostgreSQL은 같은 목표를 다른 방식으로 푼다

PostgreSQL은 Partial Index 지원이 강하고, `INCLUDE` 컬럼이나 index only scan 활용 폭도 넓습니다. 반면 MySQL은 전통적인 의미의 partial index 조건 표현이 제한적이므로, 보통 아래 우회 전략을 씁니다.

- generated column으로 활성 여부를 분리
- `(tenant_id, is_active, updated_at)` 같은 복합 인덱스로 필터를 앞단에 고정
- covering 형태로 필요한 짧은 컬럼만 포함
- 너무 복잡하면 조회 모델 분리 또는 보조 테이블 검토

그래서 실무 질문은 "이 DB가 partial index를 지원하나"보다, **내 워크로드에서 어떤 비용을 먼저 줄여야 하나**가 더 중요합니다. 같은 요구라도 PostgreSQL은 인덱스 조건으로, MySQL은 컬럼 모델링과 복합 인덱스로 해결하는 편이 현실적입니다.

## 실무 적용

### 1) 의사결정 기준(숫자·조건·우선순위)

우선순위는 보통 **핵심 조회 latency 안정화 > write 비용 억제 > 스토리지 최적화 > 설계 미학** 순으로 두는 편이 낫습니다.

아래 기준이면 Partial Index 또는 Covering Index 검토를 우선순위 상단으로 올릴 만합니다.

1. **조회 측 신호**
   - 동일 필터를 쓰는 상위 API가 전체 읽기의 **20% 이상**
   - 해당 쿼리 p95가 목표 SLO의 **40% 이상**을 혼자 먹음
   - LIMIT 조회인데도 heap fetch 또는 row lookup이 과다

2. **쓰기 측 신호**
   - 특정 테이블 UPDATE/DELETE가 초당 **100건 이상**인데 인덱스 수가 6개 이상
   - 관련 인덱스 추가 이후 write latency p95가 **15% 이상** 상승
   - autovacuum 또는 index maintenance가 평시보다 자주 밀림

3. **데이터 분포 신호**
   - `deleted_at IS NULL` 또는 `status='ACTIVE'` 데이터가 전체의 **30% 이하**
   - 특정 tenant, region, state가 트래픽 대부분을 차지
   - 오래된 데이터 비중이 **70% 이상**인데 최신 데이터만 주로 조회

이때 추천 판단 순서는 아래가 안전합니다.

- 1순위: 상위 3개 느린 쿼리의 실제 필터 패턴과 projection 확인
- 2순위: partial로 줄일 수 있는 row 비율 계산
- 3순위: covering으로 줄일 수 있는 table lookup 비용 계산
- 4순위: online index 생성과 롤백 계획 수립

### 2) 적용 절차: 쿼리 하나가 아니라 호출 경로 전체를 본다

첫째, 쿼리 로그에서 "느린 SQL"만 보지 말고 **호출 빈도 × 평균 비용 × p95 영향도**를 같이 봐야 합니다. 300ms짜리 쿼리 1회보다 25ms짜리 쿼리 1만 회가 더 비쌀 수 있습니다.

둘째, 실행계획을 볼 때는 단순히 index 사용 여부보다 아래를 같이 확인합니다.

- 필터 조건이 실제 인덱스 선두 컬럼을 타는지
- 정렬이 filesort/extra sort 없이 닫히는지
- projection 때문에 본문 테이블 재접근이 많은지
- soft delete나 status 변경이 write path를 과도하게 흔드는지

셋째, 적용은 [Online DDL + Expand/Contract 패턴](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)처럼 진행하는 편이 안전합니다.

- 신규 인덱스 생성
- canary 트래픽에서 실행계획 확인
- read latency, write latency, index size, vacuum/replication 영향 비교
- 기존 광범위 인덱스 제거는 최소 1주 관찰 후 판단

### 3) 추천 시작값

- 활성 데이터 전용 Partial Index 검토 기준: 활성 row 비율 **30% 이하**
- Covering Index 검토 기준: 목록 API 결과 컬럼 **6개 이하**
- 인덱스 제거 검토 기준: 14일간 사용 빈도 거의 없고, write cost만 유의미한 경우
- 테이블당 인덱스 수 점검 기준: write-heavy 테이블에서 **5~7개 이상**이면 재평가
- 인덱스 크기 경고 기준: 관련 인덱스 총합이 테이블 데이터 크기의 **1.5배 이상**이면 구조 재검토

### 4) 예시 시나리오

전자상거래 주문 테이블을 생각해 봅시다.

- 전체 주문 5천만 건
- 실제 운영 조회의 80%는 최근 30일 + `deleted_at IS NULL` + `status IN ('PAID','SHIPPED')`
- 관리자 목록 API는 20건씩 페이징
- 상태 변경 UPDATE는 초당 200건

이 경우 모든 row를 거대 복합 인덱스로 잡는 것보다,

- 활성/운영 상태만 대상으로 범위를 줄이고
- 목록에 필요한 짧은 컬럼만 커버하며
- 오래된 아카이브 조회는 별도 경로로 분리

하는 편이 읽기와 쓰기 모두에 유리할 수 있습니다. 반대로 사용 패턴이 자주 바뀌고 필터가 매우 다양하면, partial 조건을 너무 세밀하게 나누는 것은 오히려 유지보수 비용만 키울 수 있습니다.

## 트레이드오프/주의점

1. **Partial Index는 조건이 바뀌면 바로 가치가 흔들린다**  
운영 필터가 `ACTIVE`에서 `ACTIVE OR PENDING`으로 바뀌면 기존 인덱스 효율이 급감할 수 있습니다. 제품 요구가 자주 바뀌는 화면이라면 보수적으로 접근해야 합니다.

2. **Covering Index는 읽기 최적화인 만큼 쓰기 비용을 반드시 같이 낸다**  
컬럼을 많이 넣을수록 인덱스는 무거워집니다. "테이블 접근을 없앴다"는 만족감 때문에 과도하게 키우면 본말이 전도됩니다.

3. **MySQL에서 PostgreSQL식 partial index 사고를 그대로 가져오면 안 된다**  
엔진 차이를 무시하고 복사하면 실행계획이 기대와 다르게 나올 수 있습니다. 같은 문제라도 구현 전략이 달라야 합니다.

4. **사용되지 않는 인덱스를 바로 지우는 것은 위험하다**  
월말 배치, 장애 대응 쿼리, 관리자 화면처럼 평소엔 적게 쓰지만 중요한 경로가 있습니다. 최소 1개 운영 주기를 보고 판단하는 편이 안전합니다.

5. **인덱스 최적화는 데이터 모델 문제를 완전히 대체하지 못한다**  
조회 패턴이 너무 갈라져 있으면 결국 read model 분리, 아카이브 테이블 분리, 캐시 전략 조정이 더 큰 해법일 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 상위 읽기 API 3개의 필터 조건과 projection을 분리해 적어 봤다.
- [ ] 활성 데이터 비율과 soft delete 비율을 계산했다.
- [ ] write-heavy 테이블의 인덱스 수와 UPDATE 빈도를 같이 봤다.
- [ ] 실행계획에서 table lookup 또는 heap fetch 비용을 확인했다.
- [ ] 신규 인덱스 추가 전후 read/write latency를 모두 비교할 계획이 있다.

### 연습 과제

1. 운영 중인 테이블 하나를 골라 `deleted_at IS NULL`, `status='ACTIVE'`, 최근 30일 조회 비율을 계산해 보세요. Partial Index 후보인지 숫자로 판단해 보세요.  
2. 목록 API 1개를 골라 실제로 필요한 결과 컬럼 수를 세어 보세요. 10개가 넘는다면 Covering Index보다 projection 축소가 먼저일 가능성이 큽니다.  
3. 최근 14일간 거의 사용되지 않은 인덱스 1개를 골라, 제거 시 영향받을 수 있는 야간 배치/관리자 쿼리를 같이 점검해 보세요.

## 관련 글

- [MySQL 인덱스 설계와 실행 계획 읽기](/learning/deep-dive/deep-dive-mysql-index-explain/)
- [SQL 기본: 조인/집계/인덱스가 먹는 조건 감각](/learning/deep-dive/deep-dive-sql-basics-joins-explain/)
- [PostgreSQL Index Bloat/Reindex/Fillfactor 플레이북](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/)
- [운영 중 스키마 변경 실전: Online DDL + Expand/Contract 패턴](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)
- [DB 락 경합 실전 플레이북](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)
