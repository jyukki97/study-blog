---
title: "계층형 데이터 모델링: Adjacency List·Materialized Path·Closure Table을 선택하는 기준"
date: 2026-09-27T10:06:00+09:00
lastmod: 2026-09-27T10:06:00+09:00
draft: false
topic: "Data Modeling"
tags: ["PostgreSQL", "Data Modeling", "Recursive CTE", "Hierarchy", "Backend"]
categories: ["Backend Deep Dive"]
description: "조직도, 카테고리, 권한 상속처럼 계층을 가진 데이터를 Adjacency List·Materialized Path·Closure Table로 모델링할 때 읽기·이동·정합성·멀티테넌시 기준으로 고르는 방법을 정리합니다."
module: "data-system"
study_order: 362
---

## 이 글에서 얻는 것

- 조직도·카테고리·댓글·메뉴처럼 부모-자식 관계가 있는 데이터를 세 가지 대표 모델로 나누어 설명할 수 있습니다.
- 조회 빈도, 최대 깊이, 서브트리 이동, 권한 상속 여부를 기준으로 모델을 선택할 수 있습니다.
- 순환 참조·테넌트 혼합·대량 이동처럼 운영에서 늦게 발견되기 쉬운 실패를 제약 조건과 검증으로 막는 방법을 배웁니다.
- 처음부터 복잡한 구조를 고정하지 않고, 측정 결과에 따라 안전하게 확장하는 이행 기준을 얻습니다.

계층은 UI에서 들여쓰기로 보이지만, 백엔드에서는 정합성·조회 비용·권한 범위를 동시에 결정하는 데이터 구조입니다. 제품 카테고리는 대개 얕고 읽기가 많지만, 조직도는 부서 이동과 권한 상속이 중요합니다. 댓글은 쓰기 빈도가 높고 오래된 트리는 깊어질 수 있습니다. 따라서 [데이터베이스 스키마 설계](/learning/deep-dive/deep-dive-database-schema-design-basics/)의 정규화 원칙만으로는 충분하지 않습니다. **어떤 방향의 탐색을 얼마나 자주, 얼마나 크게 할 것인가**를 먼저 정해야 합니다.

이 글에서는 관계형 DB, 특히 PostgreSQL을 기준으로 설명합니다. 재귀 질의의 기본 문법은 [SQL Join·집계·실행 계획](/learning/deep-dive/deep-dive-sql-basics-joins-explain/)을 먼저 보면 편하고, 조직도와 권한을 연결할 때는 [멀티테넌시 전략](/learning/deep-dive/deep-dive-multitenancy-strategy/) 및 [객체 단위 인가](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)의 테넌트 경계도 함께 확인해야 합니다.

## 핵심 개념/이슈

### 1) 먼저 “트리”가 무엇을 뜻하는지 고정한다

계층 데이터라고 해서 모두 같은 질의가 필요한 것은 아닙니다. 아래 네 질문의 답이 모델 선택보다 먼저입니다.

1. 화면과 API가 자주 읽는 것은 **직계 자식**, **모든 하위 노드**, **모든 조상**, **한 경로** 중 무엇인가?
2. 정상 데이터의 최대 깊이와 한 부모가 가질 수 있는 자식 수의 상한은 얼마인가?
3. 노드 이동이 하루에 몇 번이며, 이동할 때 하위 노드가 평균·최대로 몇 개인가?
4. 상위 노드의 설정이나 권한을 하위 노드가 상속하는가? 상속 결과를 요청마다 계산해도 되는가?

“카테고리”라는 같은 이름도 답이 다릅니다. 상품 분류가 깊이 4 이하이고 한 달에 한 번만 바뀐다면 하위 트리를 빠르게 찾는 구조가 유리합니다. 반면 부서가 자주 합쳐지고 옮겨지며 이동 감사를 남겨야 한다면 한 번의 이동으로 수만 row를 바꾸는 구조는 위험합니다. 댓글은 subtree보다 페이지 단위의 직계 댓글과 정렬이 더 중요할 수 있습니다.

`parent_id`가 있다고 자동으로 트리가 되는 것도 아닙니다. 자기 자신을 부모로 가리키거나 A → B → C → A가 되면 재귀 조회가 무한 루프 또는 깊이 제한 오류로 끝납니다. 삭제된 부모, 다른 테넌트의 부모, 비활성 노드 아래에 새 노드를 붙이는 경우도 도메인 규칙을 깨뜨립니다. 자료 구조 선택보다 **허용 전이와 금지 전이**를 먼저 문서화해야 하는 이유입니다.

### 2) 세 가지 대표 모델은 읽기와 쓰기 비용을 서로 바꾼다

| 모델 | 저장 형태 | 강한 질의 | 취약한 작업 | 잘 맞는 경우 |
| --- | --- | --- | --- | --- |
| Adjacency List | 각 노드에 `parent_id` | 직계 자식, 단일 노드 이동 | 깊은 subtree·조상 반복 조회 | 기본 조직도, 댓글, 변화가 잦은 트리 |
| Materialized Path | 각 노드에 전체 경로 `path` | subtree prefix 조회, 경로 표시 | 큰 subtree 이동 시 path 일괄 갱신 | 얕고 읽기 많은 카탈로그·메뉴 |
| Closure Table | 조상-자손 쌍을 별도 표에 저장 | 모든 조상/자손, 권한 상속 검사 | 저장량, 삽입·이동 로직 | 복잡한 상속·권한 조회가 많은 구조 |

**Adjacency List**는 가장 단순합니다. `node.parent_id → node.id` 외래 키 하나로 부모를 표현하고, 모든 하위 노드는 `WITH RECURSIVE`로 찾습니다. 부모를 바꾸는 update는 보통 한 row라 쓰기에 강합니다. 대신 `/root/…/leaf` 전체를 매 요청마다 그리거나 깊은 subtree를 여러 화면에서 반복 조회하면 재귀의 비용과 결과 제한을 통제해야 합니다.

**Materialized Path**는 노드에 `/000001/000042/000118/`처럼 조상 경로를 함께 저장합니다. `/000001/000042/%` prefix로 하위 노드를 읽을 수 있어 카테고리 메뉴와 breadcrumb가 단순해집니다. 그러나 `000042`를 다른 부모로 옮기면 모든 자손의 path도 함께 고쳐야 합니다. 숫자 id를 그대로 이어 붙이면 `12`와 `120`의 경계가 모호해질 수 있으므로, 구분자와 고정 폭 segment 또는 검증된 path 타입을 정해야 합니다.

**Closure Table**은 `ancestor_id`, `descendant_id`, `depth`를 둡니다. 자기 자신도 `depth = 0`으로 저장합니다. 그러면 “이 노드가 이 부서 아래에 있는가”, “상속받는 모든 정책은 무엇인가”를 조인 하나로 답할 수 있습니다. 반대로 새 leaf 하나를 붙일 때도 새 부모의 모든 조상 row를 복사해야 합니다. 큰 subtree 이동은 이전 조상과의 연결을 지우고 새 조상 연결을 만드는 작업이라, write amplification과 lock 범위를 무시하면 안 됩니다.

### 3) 모델보다 먼저 DB 제약으로 테넌트 경계를 막는다

멀티테넌트 조직도에서 `parent_id` 외래 키만 있으면 다른 테넌트의 노드를 부모로 연결할 수 있습니다. 애플리케이션 검증만으로 막으려 하면 batch, admin script, 장애 복구 작업에서 빠질 수 있습니다. 부모와 자식의 `tenant_id`가 같음을 DB가 확인하도록 복합 키를 두는 편이 안전합니다.

```sql
CREATE TABLE hierarchy_node (
  tenant_id  BIGINT NOT NULL,
  id         BIGINT NOT NULL,
  parent_id  BIGINT NULL,
  name       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id)
    REFERENCES hierarchy_node (tenant_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX hierarchy_node_children_idx
  ON hierarchy_node (tenant_id, parent_id, id);
```

이 제약은 자기 참조와 교차 테넌트 연결을 막지만, 길이 3 이상의 순환은 막지 못합니다. 이동 API에서는 대상 노드와 새 부모를 같은 트랜잭션에서 잠그고, 새 부모가 대상의 자손이 아닌지 확인해야 합니다. Adjacency List라면 다음처럼 새 부모에서 위로 올라가며 대상이 나오는지 검사할 수 있습니다.

```sql
WITH RECURSIVE ancestors AS (
  SELECT tenant_id, id, parent_id, 0 AS depth
  FROM hierarchy_node
  WHERE tenant_id = :tenant_id AND id = :new_parent_id

  UNION ALL

  SELECT n.tenant_id, n.id, n.parent_id, a.depth + 1
  FROM hierarchy_node n
  JOIN ancestors a
    ON n.tenant_id = a.tenant_id AND n.id = a.parent_id
  WHERE a.depth < 100
)
SELECT EXISTS (
  SELECT 1 FROM ancestors WHERE id = :moving_node_id
) AS would_create_cycle;
```

`depth < 100`은 정상 트리 깊이를 신뢰하지 못하는 상황의 안전장치입니다. 실제 도메인 최대 깊이가 8이라면 API validation도 8, DB 탐색 hard limit은 약간 큰 16처럼 두는 편이 운영상 이해하기 쉽습니다. limit을 넘으면 “정상적으로 더 깊은 트리”로 처리하지 말고 데이터 손상 또는 규칙 누락으로 조사해야 합니다.

## 실무 적용

### 1) 기본값은 Adjacency List, 단 조회 예산을 숫자로 둔다

새 기능은 대개 Adjacency List로 시작해도 충분합니다. 모델과 변경 코드를 가장 적게 만들 수 있고, 부모 변경의 영향 범위도 작습니다. 단순하다는 말이 무제한 재귀 조회를 허용한다는 뜻은 아닙니다. 다음처럼 API와 운영 예산을 먼저 둡니다.

| 항목 | 초기 기준 예시 | 기준을 넘었을 때 |
| --- | --- | --- |
| 일반 트리 API 최대 깊이 | 5 | 더 보기 API 또는 비동기 export로 분리 |
| 응답 최대 노드 수 | 500 | cursor/level 단위 paging 적용 |
| 재귀 subtree 조회 p95 | 100ms 이하 | 실행 계획·인덱스·root별 크기 점검 |
| 한 root의 자손 수 | 10,000 이하를 관찰 | 별도 read model 또는 path/closure 검토 |
| 이동 트랜잭션 lock 시간 | 3초 미만 | 작은 batch, maintenance window, 모델 재검토 |

수치는 절대적인 제품 요구가 아니라 시작점입니다. 중요한 것은 `GET /departments/tree`가 “전체 조직도를 무제한으로 준다”가 아니라 `maxDepth`, `nodeLimit`, `asOf` 같은 계약을 가진다는 점입니다. 반환 객체가 너무 커지는 문제는 DB만의 문제가 아닙니다. [응답 payload 예산과 field projection](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)처럼 네트워크 전송·직렬화·클라이언트 렌더링까지 함께 제한해야 합니다.

### 2) 자주 읽고 드물게 옮기는 카탈로그는 Path를 고려한다

상품 카테고리처럼 “현재 카테고리 아래 상품을 모두 찾기”가 핵심이고 이동이 드문 경우에는 Materialized Path가 효율적일 수 있습니다. 예를 들어 `path`를 고정 폭 base-36 segment로 만들면 문자열 정렬과 prefix 범위 조회가 예측 가능해집니다.

```sql
-- /000001/00000A/0000F2/ 아래의 모든 노드
SELECT id, name, path
FROM category
WHERE tenant_id = :tenant_id
  AND path LIKE :path_prefix || '%'
ORDER BY path;
```

하지만 `LIKE`가 빠르다는 전제는 인덱스·collation·연산자와 데이터 분포에 따라 달라집니다. 실제 production 통계에서 subtree 조회가 병목인지 `EXPLAIN (ANALYZE, BUFFERS)`로 확인해야 합니다. 경로 변경은 `UPDATE category SET path = ... WHERE path LIKE ...` 한 줄로 보이지만, 수만 자손 row의 인덱스 갱신·WAL·replication lag·cache invalidation을 한 번에 유발할 수 있습니다. [PostgreSQL 인덱스 쓰기 증폭 예산](/learning/deep-dive/deep-dive-postgresql-index-write-amplification-budget-playbook/)의 관점으로 이동 작업도 write budget을 가져야 합니다.

실무에서는 subtree가 500개를 넘을 때부터 이동을 동기 요청으로 끝내지 않고 job으로 전환하는 기준을 둘 수 있습니다. job은 `PREPARING → MOVING → VERIFYING → COMPLETED/FAILED` 상태를 남기고, 읽기 경로가 old/new path 중 어느 것을 보아야 하는지 명시합니다. 사용자가 path 변경 중에 두 경로를 동시에 보게 하는 것보다, 이동 가능 여부를 좁게 제한하고 재시도·감사 로그를 남기는 편이 대개 안전합니다.

### 3) 상속·인가 질의가 핵심일 때만 Closure Table을 소유한다

Closure Table은 “상위 부서의 정책이 모든 하위 팀에 적용되는가”, “사용자가 이 project의 조상 조직 중 하나에서 role을 갖는가”처럼 조상·자손 관계를 요청마다 자주 묻는 경우에 가치가 있습니다. 예시는 다음과 같습니다.

```sql
CREATE TABLE node_closure (
  tenant_id     BIGINT NOT NULL,
  ancestor_id   BIGINT NOT NULL,
  descendant_id BIGINT NOT NULL,
  depth         INT NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (tenant_id, ancestor_id, descendant_id),
  FOREIGN KEY (tenant_id, ancestor_id)
    REFERENCES hierarchy_node (tenant_id, id),
  FOREIGN KEY (tenant_id, descendant_id)
    REFERENCES hierarchy_node (tenant_id, id)
);

CREATE INDEX node_closure_descendant_idx
  ON node_closure (tenant_id, descendant_id, depth);
```

노드를 추가할 때는 새 노드 자신 `(new, new, 0)`과 새 부모의 조상 각각에 대해 `(ancestor, new, depth + 1)`을 넣습니다. 이 작업을 서비스 코드의 여러 endpoint에 흩뿌리면 누락이 생기므로, 하나의 repository/transaction 경계로 감싸거나 DB procedure를 사용합니다. 이 모델의 source of truth도 하나여야 합니다. `parent_id`와 `node_closure`를 둘 다 쓴다면, 어느 쪽이 파생 데이터인지와 대조·복구 방법을 정해야 합니다. 둘 다 독립적으로 수정할 수 있게 두면 결국 서로 다른 조직도가 됩니다.

권한이 붙는 경우에는 closure row가 있다고 곧바로 허용이라고 판단하면 안 됩니다. 상속 차단, 만료 role, resource state, explicit deny 같은 규칙이 더 있을 수 있습니다. Closure Table은 **후보 관계를 빠르게 찾는 인덱스**이지 인가 정책 전체를 대체하지 않습니다. authorization decision의 근거와 cache invalidation은 [인가 결정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)처럼 별도 계약으로 다루세요.

## 트레이드오프/주의점

1. **재귀 CTE가 있다고 모든 트리에 Adjacency List가 최선은 아니다.** 깊고 큰 subtree를 높은 QPS로 읽는다면 재귀 비용과 결과 크기부터 측정해야 합니다. 반대로 path나 closure를 “혹시 필요할지 몰라서” 먼저 넣으면 쓰기와 복구 비용만 늘 수 있습니다.
2. **Path는 조회를 빠르게 하지만 이동 비용을 숨긴다.** 수만 row path 변경은 index·replication·cache·검색 색인을 동시에 건드립니다. 이동 빈도와 최대 subtree 크기를 모르고 선택하면 운영 작업이 됩니다.
3. **Closure Table은 조회를 단순하게 만들지만 정합성 코드를 복잡하게 만든다.** 삽입·삭제·이동·복구의 네 경로 모두 closure 갱신을 테스트해야 합니다. 대량 이동은 독점 lock이나 짧은 쓰기 중단을 요구할 수 있습니다.
4. **테넌트와 삭제 상태를 관계 테이블에도 넣는다.** node 테이블만 tenant-safe여도 closure/path cache/read model이 다른 테넌트와 섞이면 데이터 노출이 생깁니다. 모든 key와 query의 첫 조건은 tenant scope여야 합니다.
5. **표시 순서와 구조 관계를 혼동하지 않는다.** `parent_id`는 포함 관계이고 `sort_order`는 형제 정렬 규칙입니다. drag-and-drop 이후 두 속성을 하나의 숫자로 억지로 표현하면 이동·재정렬·충돌 해결이 모두 어려워집니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 주요 화면/API가 직계 자식·모든 자손·모든 조상·경로 중 무엇을 읽는지 목록화했다.
- [ ] 정상 최대 깊이, root당 최대 자손 수, 이동 빈도와 최대 이동 subtree 크기를 측정하거나 상한으로 정했다.
- [ ] `(tenant_id, id)` 복합 키 또는 동등한 제약으로 교차 테넌트 parent 연결을 막았다.
- [ ] 자기 참조뿐 아니라 길이 2 이상 순환을 이동 트랜잭션에서 검사한다.
- [ ] 재귀 조회의 depth·row limit, API payload limit, timeout을 서로 다른 계층에서 정했다.
- [ ] Path/Closure를 쓰면 source of truth, rebuild 절차, row count·lag·불일치 대조 지표가 있다.
- [ ] 대량 이동 중 실패·재시도·부분 반영·cache invalidation을 통합 테스트했다.

### 연습

1. 현재 서비스의 메뉴·부서·카테고리 중 하나를 골라 최대 깊이, root당 노드 수, 월간 이동 횟수를 표로 적어 보세요. 이 숫자가 없으면 아직 모델을 고를 근거가 없습니다.
2. Adjacency List로 `ancestor`, `descendant`, `siblings` API를 각각 작성하고, 순환 데이터 fixture가 들어왔을 때 depth limit이 어떻게 작동하는지 확인하세요.
3. 같은 fixture를 Path 또는 Closure Table로 다시 모델링해 subtree 조회 p95, 단일 노드 추가 write 수, 1,000개 subtree 이동 write 수를 비교하세요. 가장 빠른 조회 하나가 아니라 서비스의 읽기·쓰기 비율과 복구 난이도로 결론을 내리면 됩니다.
