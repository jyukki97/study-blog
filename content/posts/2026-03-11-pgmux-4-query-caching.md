---
title: "Go로 PostgreSQL 프록시 만들기 (4) - 쿼리 캐싱과 무효화"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Cache", "LRU"]
categories: ["Database"]
project: "pgmux"
description: "LRU 캐시를 직접 구현하고, 쓰기 시 테이블 기반으로 캐시를 자동 무효화하는 전략을 만든다."
keywords: ["PostgreSQL 프록시 캐시", "LRU 캐시 무효화", "테이블 기반 캐시 인벌리데이션", "Go 캐시 설계"]
ShowToc: true
---

## 들어가며

> 같은 SELECT를 1초에 100번 날리면 DB가 100번 일한다.
> 프록시 단에서 결과를 캐싱하면 DB 부하를 크게 줄일 수 있다.

이전 글([P3: 읽기/쓰기 자동 분산](/posts/2026-03-11-pgmux-3-rw-routing/))에서 쿼리를 Writer/Reader로 분산하는 라우팅을 구현했다. 이번에는 한 단계 더 나아가서, **동일한 SELECT 결과를 캐싱**하여 DB를 아예 거치지 않도록 만든다.

핵심은 단순히 "빨라진다"가 아니다. 캐시는 **읽기 지연시간(p99)**과 **DB 포화도**를 동시에 낮추는 운영 장치다. 대신, 무효화를 잘못 설계하면 "빠르게 틀린 데이터"를 내보내는 사고가 난다. 이 글은 그래서 성능보다도 **정확성 우선 캐시 설계**에 집중한다.

## LRU 캐시 설계

### 왜 LRU인가

캐시 메모리는 유한하다. 가득 차면 뭘 버릴지 정해야 한다:
- **FIFO**: 가장 먼저 들어온 것을 버린다 → 자주 쓰는 것도 버릴 수 있다
- **LRU**: 가장 오래 안 쓴 것을 버린다 → 자주 쓰는 건 살아남는다
- **LFU**: 가장 적게 쓴 것을 버린다 → 구현이 복잡하다

**LRU**가 구현 대비 효과가 가장 좋다.

### Go container/list 기반 구현

Go 표준 라이브러리의 `container/list`(이중 연결 리스트)와 `map`을 조합하면 O(1) LRU를 만들 수 있다:

```go
type Cache struct {
    mu         sync.RWMutex
    items      map[uint64]*list.Element  // 해시 → 리스트 노드
    evictList  *list.List                // LRU 순서 관리
    maxEntries int
    ttl        time.Duration
    maxSize    int                       // 결과 바이트 제한

    tableIndex map[string]map[uint64]struct{}  // 테이블 → 캐시 키 역인덱스
}
```

- **Get**: map에서 O(1) 조회 → 리스트 맨 앞으로 이동 (최근 사용)
- **Set**: map에 추가 + 리스트 맨 앞에 삽입 → 가득 차면 리스트 맨 뒤(LRU) 제거
- **Evict**: 리스트 맨 뒤 노드를 O(1)로 제거

## 캐시 키 설계

같은 쿼리 + 같은 파라미터 = 같은 키:

```go
func CacheKey(query string, params ...any) uint64 {
    h := fnv.New64a()
    h.Write([]byte(query))
    for _, p := range params {
        if s, ok := p.(string); ok {
            h.Write([]byte(s))
        }
    }
    return h.Sum64()
}
```

FNV-1a를 선택한 이유:
- Go 표준 라이브러리에 포함 → 외부 의존 없음
- 빠르다 — 벤치마크 **15ns/op, 0 alloc**
- 캐시 키로는 충분한 분포도 (암호화 해시일 필요 없음)

## 캐싱 제한

모든 결과를 캐싱하면 안 된다:

```go
func (c *Cache) Set(key uint64, result []byte, tables []string) {
    // 1. 결과가 너무 크면 스킵
    if c.maxSize > 0 && len(result) > c.maxSize {
        return
    }

    // 2. 가득 차면 LRU 제거
    if c.maxEntries > 0 && c.evictList.Len() >= c.maxEntries {
        c.evictOldest()
    }

    // 3. 저장 + TTL 설정
    e := &entry{
        key:       key,
        result:    result,
        tables:    tables,
        expiresAt: time.Now().Add(c.ttl),
    }
    elem := c.evictList.PushFront(e)
    c.items[key] = elem
}
```

세 가지 제한:
- **max_result_size**: 큰 결과(예: 1MB)는 캐싱하지 않음 → 메모리 보호
- **max_entries**: 총 항목 수 제한 → LRU로 오래된 것 제거
- **TTL**: 시간 만료 → 오래된 데이터 자동 제거

## 테이블 기반 캐시 무효화

캐싱의 가장 어려운 부분은 **언제 무효화할 것인가**다.

### 역인덱스 전략

캐시 저장 시 "이 쿼리가 어떤 테이블을 참조하는지" 기록해둔다:

```
테이블 역인덱스:
  "users"  → [key1, key2, key5]
  "orders" → [key3, key4]
```

쓰기 쿼리가 오면 대상 테이블을 추출하고, 해당 테이블의 캐시를 전부 삭제한다:

```go
func (c *Cache) InvalidateTable(table string) {
    keys := c.tableIndex[table]
    for key := range keys {
        if elem, ok := c.items[key]; ok {
            c.removeElement(elem)
        }
    }
    delete(c.tableIndex, table)
}
```

### 테이블명 추출

쓰기 쿼리에서 테이블명을 추출하는 건 간단하다:

```go
// "INSERT INTO users ..."     → ["users"]
// "UPDATE orders SET ..."     → ["orders"]
// "DELETE FROM products ..."  → ["products"]

func ExtractTables(query string) []string {
    // INSERT INTO 뒤, UPDATE 뒤, DELETE FROM 뒤의 첫 단어를 추출
}
```

### 전체 흐름

```
SELECT * FROM users WHERE id = 1
  → 캐시 키 생성 (FNV hash)
  → 캐시 조회: Miss
  → DB에서 결과 가져옴
  → 캐시 저장 (key, result, tables=["users"])

SELECT * FROM users WHERE id = 1  (같은 쿼리)
  → 캐시 조회: Hit! → DB 거치지 않고 즉시 반환

INSERT INTO users (name) VALUES ('dave')
  → Writer로 전송
  → InvalidateTable("users") → users 관련 캐시 전부 삭제

SELECT * FROM users WHERE id = 1  (다시)
  → 캐시 조회: Miss → DB에서 새 결과 가져옴
```

## 벤치마크

```
BenchmarkCacheKey          15.0 ns/op    0 B/op    0 allocs/op
BenchmarkCacheGetHit       36.4 ns/op    0 B/op    0 allocs/op
BenchmarkCacheGetMiss       6.3 ns/op    0 B/op    0 allocs/op
BenchmarkCacheSet         106.7 ns/op   31 B/op    1 allocs/op
BenchmarkInvalidateTable  7815  ns/op    0 B/op    0 allocs/op
```

Cache Hit이 **36ns**면 네트워크 왕복(~0.5ms) 대비 10,000배 이상 빠르다. DB를 안 타는 것의 위력이다.

무효화는 100개 항목 기준 **7.8μs**로, 쓰기 쿼리에 추가되는 오버헤드가 거의 없다.

## 운영에서 바로 쓰는 캐시 정책 체크리스트

캐시는 "붙이면 빨라진다"가 아니라 "운영 계약을 문서화해야 안전하다"에 가깝다. 실제 운영 시 아래 7가지는 반드시 명시해두는 걸 권장한다.

1. **캐시 대상 SQL 범위**: 순수 SELECT만 허용할지, 함수 호출/뷰 조회까지 허용할지
2. **TTL 기본값과 예외 규칙**: 기본 5초 + 특정 테이블은 1초처럼 도메인별 차등 정책
3. **max_result_size 기준**: 대용량 응답 캐시 금지(메모리 폭주 방지)
4. **무효화 단위**: 테이블 단위 vs 전체 flush(비상시)
5. **장애 시 동작 모드**: 캐시 모듈 오류 시 fail-open(캐시 우회) 여부
6. **관측 지표**: hit/miss 비율, invalidation 빈도, 테이블별 eviction 상위 랭킹
7. **릴리즈 체크포인트**: 스키마 변경 배포 시 캐시 무효화 전략 동반 여부

특히 4, 7번은 배포 사고를 크게 줄인다. "DDL은 정상 적용됐는데 캐시가 구 스키마를 들고 있는" 종류의 문제는 코드 버그보다 운영 절차 누락에서 자주 발생한다.

## 실무에서 자주 터지는 실패 패턴 4가지

| 패턴 | 증상 | 원인 | 대응 |
|---|---|---|---|
| Hot key 쏠림 | 특정 키만 계속 hit, 다른 키는 miss | 키 분포 불균형 | 키 정규화 + 상위 키 모니터링 + 필요 시 TTL 단축 |
| 과도한 무효화 | hit ratio 급락, DB CPU 급등 | 광범위 테이블 invalidation | 테이블 세분화, mutation 경로 분리 |
| 캐시 오염 | 잘못된 사용자/DB 결과 재사용 | 키에 tenant/db 컨텍스트 누락 | 키에 db/user/route 강제 포함 |
| 무효화 누락 | 배포 직후 stale 데이터 | write path 일부에서 invalidation 빠짐 | write 경로 통합 + 회귀 테스트 추가 |

`pgmux` 시리즈 후반부에서도 실제로 이 문제가 반복됐다. 예를 들어 [P31: 캐시 포맷 충돌](/posts/2026-03-12-pgmux-31-cache-format-collision-and-http-lifecycle/)이나 [P53: 라우팅 우회 이슈](/posts/2026-03-17-pgmux-53-qa-round4-routing-safety/)는 결국 "키/경로/계약" 불일치가 본질이었다.

## 재현 테스트 시나리오(로컬 QA 용)

아래 순서로 테스트하면 캐시 동작을 빠르게 검증할 수 있다.

1. **Warm-up**
   - 동일 SELECT를 100~1,000회 반복
   - `cache_miss_total`이 초반 증가 후 안정화되는지 확인

2. **쓰기 후 무효화 확인**
   - 대상 테이블에 INSERT/UPDATE 실행
   - 직후 동일 SELECT 실행 시 miss 1회 후 hit 회복되는지 확인

3. **대용량 응답 예외 확인**
   - `max_result_size`를 초과하는 쿼리 실행
   - hit 증가 없이 DB 직접 조회되는지 확인

4. **TTL 만료 확인**
   - TTL 경계(예: 5초) 전/후로 동일 쿼리 호출
   - 만료 후 첫 요청 miss, 이후 hit로 회복되는지 검증

이 테스트를 CI까지 확장하면 "성능 최적화"가 아니라 "정확성 회귀 방지" 장치가 된다.

## 마무리

쿼리 캐싱은 "쉬운 것 같지만 무효화가 어렵다"는 게 정설이다. 테이블 기반 역인덱스는 완벽하지는 않지만 (JOIN 쿼리 등), 대부분의 CRUD 패턴에서 충분히 잘 동작한다.

다음 글([P5: 통합, E2E 테스트, 회고](/posts/2026-03-11-pgmux-5-benchmark-review/))에서는 전체 프로젝트의 **성능을 측정하고 회고**한다. 캐시 파트는 거기서 "체감 성능"이 아니라 "시스템 병목 이동" 관점으로 다시 확인해보자.

---

### 같이 보면 좋은 글

- [P3: 읽기/쓰기 자동 분산](/posts/2026-03-11-pgmux-3-rw-routing/)
- [P31: 캐시 포맷 충돌과 HTTP 서버 수명주기](/posts/2026-03-12-pgmux-31-cache-format-collision-and-http-lifecycle/)
- [P53: 라우팅 우회와 운영 안전성](/posts/2026-03-17-pgmux-53-qa-round4-routing-safety/)
