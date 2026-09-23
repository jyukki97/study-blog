---
title: "PostgreSQL 전문 검색: tsvector·GIN으로 시작하고, 품질 경계를 정하는 법"
date: 2026-09-11T10:07:00+09:00
draft: false
topic: "Database"
tags: ["PostgreSQL", "Full Text Search", "tsvector", "GIN", "Search", "Performance"]
categories: ["Backend Deep Dive"]
description: "PostgreSQL tsvector와 GIN 인덱스로 전문 검색을 설계할 때의 데이터 모델, 쿼리·랭킹, 무중단 인덱스 배포, 검색 품질 경계를 실무 기준으로 정리합니다."
module: "data-system"
study_order: 1502
---

검색 기능은 처음에는 `ILIKE '%키워드%'`로 시작하기 쉽다. 데이터가 작고 관리자 화면 정도라면 충분할 수 있다. 그러나 상품명·문서·게시물처럼 검색이 제품 경험의 일부가 되면, 부분 문자열 일치만으로는 순위와 형태 변화, 쓰기 비용, 인덱스 배포를 설명할 수 없다. 이때 PostgreSQL의 전문 검색(Full Text Search, FTS)은 별도 검색 클러스터를 바로 도입하지 않고도 **검색 대상이 작거나 중간 규모인 서비스의 정확한 기본선**이 될 수 있다.

다만 `tsvector`와 GIN 인덱스를 추가했다고 검색 문제가 끝나는 것은 아니다. 어떤 필드를 토큰화하는지, 검색 문서가 언제 갱신되는지, 한국어 입력에서 형태소 품질을 어디까지 보장하는지, GIN의 쓰기 증폭을 감당할 수 있는지를 먼저 정해야 한다. 이 글은 [Elasticsearch 기본 개념](/learning/deep-dive/deep-dive-elasticsearch-basics/), [검색 인덱스 동기화와 Reindexing](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/), [쿼리 플랜 회귀 방지](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)를 PostgreSQL 단일 DB 선택의 관점에서 연결한다.

## 이 글에서 얻는 것

- `tsvector`, `tsquery`, GIN 인덱스가 각각 해결하는 문제와 한계를 구분합니다.
- 제목·본문·태그에 다른 가중치를 두고, 검색 문서를 갱신하는 데이터 모델을 설계합니다.
- 대형 테이블에서 `CREATE INDEX CONCURRENTLY`와 배치 backfill을 이용해 배포 위험을 줄이는 기준을 세웁니다.
- PostgreSQL FTS를 계속 쓸 조건과 별도 검색 엔진으로 넘길 조건을 숫자와 품질 요구로 판단합니다.

## 핵심 개념/이슈

### 1) `ILIKE`와 전문 검색은 질문이 다르다

`ILIKE '%postgres%'`는 문자열에 해당 조각이 포함됐는지 묻는다. 앞에 와일드카드가 붙으면 일반 B-tree 인덱스를 활용하기 어렵고, 여러 단어를 넣었을 때 단어 경계·불용어·순위를 표현하지 못한다. 반면 PostgreSQL FTS는 텍스트를 lexeme 집합으로 정규화한 `tsvector`로 저장하고, 입력을 `tsquery`로 바꾼 뒤 일치와 랭킹을 계산한다.

```sql
-- 검색 문서: 제목 A, 요약 B, 본문 D 가중치
setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
setweight(to_tsvector('simple', coalesce(body, '')), 'D')

-- 사용자가 입력한 여러 단어를 안전한 질의로 변환
websearch_to_tsquery('simple', :query)
```

여기서 `tsvector`는 "검색할 문서", `tsquery`는 "찾을 조건", `ts_rank_cd`는 "어떤 결과를 먼저 보여줄지"다. 세 요소를 분리하면 운영 중에도 ranking policy를 바꾸고, 인덱스가 필요한 필드와 표시용 원문을 다르게 유지할 수 있다.

한국어에는 특히 주의가 필요하다. PostgreSQL 내장 `simple` configuration은 공백·기호 경계의 토큰화에는 쓸 수 있지만 한국어 형태소 분석이나 동의어 확장까지 해결하지 않는다. 제목·식별자·영문 기술어 검색이 주 요구라면 합리적인 시작점일 수 있다. 반대로 조사·복합명사 분해, 오탈자 보정, 동의어, 자동완성 품질이 제품의 핵심이면 실제 검색 로그로 분석기를 검증하거나 별도 검색 엔진을 검토해야 한다. "한국어를 지원한다"는 말은 반드시 어떤 query set에서 recall과 ranking을 측정했는지까지 포함해야 한다.

### 2) 검색 문서는 원본 컬럼과 별도의 운영 계약이다

검색 벡터를 매 query마다 계산할 수도 있지만, 본문이 길고 목록 화면의 요청량이 늘면 계산 비용이 읽기 경로에 남는다. 일반적으로는 `search_document tsvector` 컬럼을 두고 GIN 인덱스를 만든다.

```sql
ALTER TABLE articles ADD COLUMN search_document tsvector;

CREATE INDEX CONCURRENTLY articles_search_document_gin
  ON articles USING gin (search_document);

SELECT id, title,
       ts_rank_cd(search_document, websearch_to_tsquery('simple', :query)) AS rank
FROM articles
WHERE search_document @@ websearch_to_tsquery('simple', :query)
ORDER BY rank DESC, published_at DESC, id DESC
LIMIT 30;
```

문제는 vector가 원본과 어긋날 수 있다는 점이다. 트리거는 같은 트랜잭션에서 최신성을 보장하지만 쓰기 비용과 배포 복잡도를 늘린다. 애플리케이션에서 갱신하면 제어하기 쉬울 수 있지만, bulk import·admin SQL·다른 worker가 누락하는 순간 stale 검색 결과가 생긴다. generated column은 표현식과 사용하는 configuration이 불변 조건을 만족하고 원본 컬럼이 같은 row에 있을 때 후보가 되지만, 다국어 분석기나 조인된 태그처럼 외부 상태가 들어가면 맞지 않는다.

따라서 먼저 최신성 SLO를 정한다. 예를 들어 게시글 작성·수정 후 검색 노출이 **10초 이내여야** 하고 쓰기량이 낮다면 transaction 안의 trigger 또는 명시적 application write가 적합하다. 5분 지연을 허용하고 import가 많다면 outbox 기반 비동기 갱신도 가능하지만, 실패 큐·재처리·검색 문서 version을 함께 운영해야 한다. 이 선택은 [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)에서 다룬 "원본 변경과 후속 작업을 분리하되 유실하지 않는" 문제와 같다.

### 3) GIN은 읽기를 빠르게 하지만 공짜가 아니다

GIN은 많은 lexeme에서 문서 ID를 찾는 역색인이라 `@@` 필터에 잘 맞는다. 그러나 row 하나를 수정해도 해당 row의 검색어 목록이 바뀔 수 있어 insert/update path가 무거워진다. `fastupdate`가 켜진 GIN은 pending list에 쓰기를 모아 짧은 쓰기 지연을 줄일 수 있지만, 나중의 cleanup과 VACUUM 부담으로 옮긴다.

검색 인덱스를 추가하기 전에는 세 수치를 기준선으로 남긴다.

| 항목 | 시작 측정 | 승인 기준 예시 | 기준을 넘으면 |
| --- | --- | --- | --- |
| 검색 p95 | filter·rank 포함 응답 시간 | 기존 검색 SLO의 70% 이내, 예: 200ms SLO면 140ms 이하 | query plan·결과 수·rank 계산을 확인 |
| 쓰기 p95 | 글 저장·상품 수정 시간 | 기준선 대비 15% 이내 증가 | vector 갱신 경로와 batch를 분리 |
| 인덱스 크기 | table 대비 GIN 크기 | 디스크 예산과 replica 여유 안 | 필드·토큰 수를 줄이고 reindex 계획 |
| pending list/VACUUM | cleanup 지연과 autovacuum 시간 | 배포 후 24시간 내 안정화 | vacuum capacity와 write burst를 점검 |

예시 수치는 서비스의 SLO와 storage budget에 맞춰 바꿔야 한다. 핵심은 검색 p95만 보고 승인하지 않는 것이다. read path가 빨라진 대신 primary 쓰기 p95와 replica lag가 악화되면 사용자는 "검색 기능"이 아니라 저장 장애를 경험한다. [PostgreSQL 인덱스 Bloat와 Reindex](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/)와 [Autovacuum 튜닝](/learning/deep-dive/deep-dive-postgresql-autovacuum-tuning/)을 함께 보는 이유다.

## 실무 적용

### 1) 검색 계약부터 작게 고정한다

새 검색은 먼저 한 문장으로 범위를 제한한다. 예를 들어 "공개된 게시글의 제목·요약·본문에서 최대 3개 단어를 검색하고, 30개 결과를 200ms p95 안에 보여준다"처럼 정한다. 이 문장에는 대상 권한, 언어, 결과 수, latency가 모두 들어간다.

그다음 대표 query 50~100개로 gold set을 만든다. 빈도 높은 검색어, 결과가 없어야 하는 검색어, 제목과 본문에 각각만 있는 검색어, 공개/비공개 경계, 긴 입력과 기호 입력을 포함한다. 배포 후보마다 다음을 비교한다.

- top 10 중 기대 문서가 포함되는 비율(recall@10)
- 기대 문서가 1~3위에 오는 비율(MRR 또는 단순 rank 분포)
- 권한 없는 문서가 0건인지
- query p50/p95, 반환 row 수, `EXPLAIN (ANALYZE, BUFFERS)`의 계획 변화

검색 품질은 "결과가 나온다"보다 "고객이 찾는 문서가 상단에 있다"가 중요하다. gold set에서 recall@10이 90% 아래라면 인덱스 추가보다 필드 가중치, 분석기, 동의어, 원본 데이터 품질을 먼저 고친다. 반대로 recall은 충분하지만 p95가 나쁘면 `LIMIT`, 필터 순서, GIN 사용 여부와 rank 대상 row 수를 점검한다.

### 2) 무중단 배포는 schema·backfill·index를 분리한다

이미 큰 `articles` 테이블에 한 번에 vector를 채우고 일반 `CREATE INDEX`를 실행하면 장시간 lock과 I/O 급증을 만들 수 있다. 아래 순서를 기본값으로 삼는다.

1. nullable `search_document` 컬럼과 갱신 로직을 먼저 배포한다.
2. 새로 쓰이는 row가 vector를 채우는지 24시간 관찰한다.
3. 기존 row는 PK 범위 기준으로 **한 batch 1,000~5,000 row**씩 backfill한다.
4. primary CPU, WAL 생성량, replica lag가 기준을 넘으면 batch를 멈춘다.
5. `CREATE INDEX CONCURRENTLY`로 GIN을 만들고, 유효한 index인지 확인한다.
6. 읽기 경로는 feature flag로 5% → 25% → 100%로 전환한다.

backfill의 abort 조건도 사전에 써 둔다. 예를 들어 replica lag가 60초를 넘거나, primary CPU가 70% 이상으로 10분 지속되거나, write p95가 기준선보다 20% 넘게 늘면 batch를 멈춘다. 숫자는 환경별로 다르지만, 야간 작업이므로 괜찮다는 가정은 위험하다. 백업·ETL·autovacuum과 같은 시간대라면 작은 배치도 WAL과 I/O를 경쟁한다.

`CREATE INDEX CONCURRENTLY`는 일반 인덱스 생성보다 lock 영향을 낮추지만 즉시 끝나는 작업도 아니고 transaction block 안에서 실행할 수 없다. 배포 도구가 모든 DDL을 하나의 transaction으로 감싸는지, 실패 후 invalid index가 남았는지, rollback 때 feature flag만 끄면 되는지를 runbook에 포함한다.

### 3) 검색 권한은 WHERE 절에서 먼저 닫는다

전문 검색은 후보 집합을 넓게 만든다. 따라서 authorization을 애플리케이션에서 결과를 받은 뒤 필터링하면 안 된다. tenant, 공개 상태, soft delete, 문서 ACL 조건을 SQL의 `WHERE` 절에 함께 넣는다.

```sql
WHERE tenant_id = :tenant_id
  AND visibility = 'public'
  AND deleted_at IS NULL
  AND search_document @@ websearch_to_tsquery('simple', :query)
```

여기서 tenant/visibility 필터와 FTS 조건을 어떤 인덱스로 결합할지는 실제 계획으로 확인한다. row-level security를 쓰는 경우에는 [PostgreSQL RLS와 Connection Pool 안전성](/learning/deep-dive/deep-dive-postgresql-rls-transaction-context-pool-safety-playbook/)처럼 tenant context가 connection 재사용 중 남지 않는지도 별도 검증한다. 검색 결과 한 건의 누출은 ranking 오류보다 훨씬 큰 incident다.

### 4) 별도 검색 엔진으로 넘어갈 신호를 문서화한다

PostgreSQL FTS가 "작은 서비스 전용"이라는 뜻은 아니다. 원본과 검색 인덱스의 강한 일관성이 중요하고, 필터가 단순하며, 운영 팀이 하나의 transactional DB를 선호한다면 장기간 좋은 선택일 수 있다. 반대로 다음 중 두 개 이상이 지속되면 Elasticsearch/OpenSearch 같은 별도 엔진을 비교할 시점이다.

- 한국어 형태소·동의어·오탈자 보정·prefix autocomplete가 검색 전환율의 핵심이다.
- 검색 대상이 수천만 문서를 넘고, GIN 크기·VACUUM·write p95가 DB 예산을 계속 압박한다.
- faceting, 복잡한 relevance tuning, 벡터·키워드 hybrid search가 필요하다.
- 검색용 읽기 부하를 primary와 replica에서 분리해야 한다.
- 수 분의 색인 지연을 받아들일 수 있고, outbox·replay·reindex 운영 역량이 있다.

이때도 "검색 엔진을 추가하면 품질이 자동으로 좋아진다"고 보면 안 된다. source of truth, delete propagation, schema version, reindex, 장애 시 stale 결과 허용 범위를 명시해야 한다. 검색 엔진 선택은 라이브러리 교체가 아니라 데이터 파이프라인을 하나 더 운영하는 결정이다.

## 트레이드오프/주의점

첫째, `ts_rank_cd` 점수는 제품의 진실이 아니라 ranking 신호 하나다. 제목 가중치가 너무 높으면 오래된 짧은 글이 구체적인 최신 문서를 이길 수 있다. freshness, 클릭, 권한, 문서 유형을 어떤 순서로 섞을지 product owner와 합의하고 gold set으로 검증한다.

둘째, GIN은 쓰기 폭주와 bulk import에 민감할 수 있다. 인덱스가 존재하는 상태에서 대량 업데이트를 하면 WAL·VACUUM·replica lag가 동시에 커진다. import 전후의 write p95와 인덱스 크기를 기록하지 않으면 "검색이 가끔 느리다"는 현상만 남는다.

셋째, 모든 텍스트를 색인할 필요는 없다. 비밀값, 내부 메모, 삭제 예정 원문까지 vector에 넣으면 검색 노출과 storage 비용이 함께 커진다. 색인 대상은 classification과 visibility가 확정된 컬럼으로 제한한다.

넷째, offset pagination은 rank가 같은 결과와 새 문서 삽입에서 흔들릴 수 있다. 결과를 더 많이 넘겨야 한다면 `(rank, published_at, id)`를 안정적인 cursor로 설계하거나, 사용자에게 허용할 검색 freshness를 먼저 정한다. 자세한 cursor 일관성은 [Cursor Pagination 일관성](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)을 참고한다.

## 체크리스트 또는 연습

- [ ] 검색 대상, 권한 경계, 언어, 최대 결과 수, p95 목표를 한 문장으로 적었다.
- [ ] 대표 query 50~100개와 기대 top 10 결과로 gold set을 만들었다.
- [ ] 제목·요약·본문 가중치와 `simple` 또는 선택한 분석기의 한계를 문서화했다.
- [ ] vector 최신성 SLO에 맞춰 trigger, application write, outbox 중 하나를 선택했다.
- [ ] backfill batch 크기와 CPU·WAL·replica lag·write p95 abort 기준을 정했다.
- [ ] `CREATE INDEX CONCURRENTLY` 실행·실패·invalid index 정리·feature flag rollback 절차를 검증했다.
- [ ] tenant·visibility·soft delete 조건을 검색 SQL 안에서 필터링한다.

연습으로 읽기 전용 staging DB의 작은 문서 테이블에 제목과 본문을 넣고, 가중치가 다른 `tsvector`를 만든다. 같은 단어가 제목에 있을 때와 본문에 있을 때의 rank를 비교한 뒤 `EXPLAIN (ANALYZE, BUFFERS)`로 GIN 사용 여부를 확인한다. 이어서 의도적으로 한국어 복합명사·오탈자 query를 gold set에 넣어 보자. 그 결과가 현재 서비스의 품질 요구를 충족하는지가 PostgreSQL FTS와 별도 검색 엔진을 가르는 첫 근거가 된다.

## 관련 글

- [Elasticsearch 기본 개념](/learning/deep-dive/deep-dive-elasticsearch-basics/)
- [검색 인덱스 동기화와 Reindexing](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/)
- [쿼리 플랜 회귀 방지](/learning/deep-dive/deep-dive-query-plan-regression-guardrails/)
- [PostgreSQL 인덱스 Bloat와 Reindex](/learning/deep-dive/deep-dive-postgresql-index-bloat-reindex-fillfactor-playbook/)
