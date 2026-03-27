---
title: "백엔드 커리큘럼 심화: 캐시 일관성 설계(Write-Through/Invalidate/CDC)로 stale read 사고 줄이기"
date: 2026-03-26
draft: false
topic: "Architecture"
tags: ["Cache Consistency", "Redis", "CDC", "Invalidation", "Backend Operations", "Data Consistency"]
categories: ["Backend Deep Dive"]
description: "캐시 적중률보다 더 어려운 캐시 일관성 문제를 실무 기준으로 정리합니다. stale read 허용 범위, 무효화 지연 임계치, 재처리 규칙까지 숫자로 설명합니다."
module: "data-consistency-system"
study_order: 1150
---

캐시는 "빠르게 만드는 기술"로만 소개되기 쉽지만, 실무에서 더 비싼 문제는 성능이 아니라 **일관성 실패로 인한 잘못된 의사결정**입니다. 재고가 이미 0인데 화면엔 구매 가능으로 보이거나, 할인 정책이 바뀌었는데 예전 가격이 노출되면 p95가 아무리 좋아도 사고입니다. 그래서 캐시는 단순한 성능 레이어가 아니라, 데이터 신뢰도를 다루는 운영 레이어로 봐야 합니다.

특히 트래픽이 커질수록 팀은 같은 질문을 반복합니다. "TTL 5분이면 충분하지 않나?", "무효화 이벤트는 가끔 유실돼도 괜찮지 않나?", "캐시 적중률이 90%인데 왜 CS가 늘지?" 이 글은 이런 질문을 **측정 가능한 기준**으로 바꿔, 캐시 일관성 설계를 실제 서비스에 적용할 수 있게 정리합니다.

## 이 글에서 얻는 것

- 캐시 일관성을 `정확성 요구 수준`과 `허용 지연 시간`으로 분리해 설계하는 방법을 이해할 수 있습니다.
- Cache-Aside, Write-Through, Write-Behind, Event Invalidation을 조합할 때의 우선순위와 금지 패턴을 실무 기준으로 판단할 수 있습니다.
- stale read 사고를 줄이기 위한 운영 임계치(지연, 유실률, 재처리 조건)와 점검 루틴을 바로 적용할 수 있습니다.

## 핵심 개념/이슈

### 1) 캐시 일관성은 "항상 최신"이 아니라 "허용 가능한 오래됨"을 정의하는 문제다

모든 읽기를 완전 최신으로 맞추려면 결국 캐시의 이점이 줄어듭니다. 그래서 먼저 도메인별로 **Staleness Budget**를 정해야 합니다.

- 가격/재고/권한: stale 허용 0~3초
- 추천/랭킹/통계: stale 허용 1~10분
- 정산/원장성 데이터: 캐시 조회 자체 금지 또는 읽기 전 강한 검증

핵심은 "캐시 가능/불가" 이분법이 아니라, **데이터 클래스별 허용 오차**를 명시하는 것입니다. 이 관점은 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)와 같이 보면 운영 언어가 맞춰집니다.

### 2) 단일 패턴으로는 오래 못 간다: 읽기 경로와 쓰기 경로를 분리 설계해야 한다

현장에서 자주 쓰는 조합은 다음과 같습니다.

1. **읽기 경로: Cache-Aside + Soft TTL**  
   - 기본 조회는 캐시 우선
   - soft TTL 만료 시 백그라운드 재검증(serve stale + refresh)
2. **쓰기 경로: DB 커밋 후 Invalidate 이벤트 발행**  
   - Write-Through만으로는 멀티 인스턴스 동기화가 불완전
3. **복구 경로: CDC 기반 재동기화**  
   - 이벤트 유실/소비 장애를 감안한 보정 파이프라인

Write-Through를 쓰더라도 "한 프로세스 내부 캐시" 기준에서만 안전한 경우가 많습니다. 인스턴스가 여러 대면 결국 **분산 무효화**가 본체가 됩니다. 이 지점은 [Redis 캐싱 심화](/learning/deep-dive/deep-dive-redis-caching/)와 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)를 같이 봐야 빈틈이 줄어듭니다.

### 3) 무효화 이벤트는 전송 성공보다 "재처리 가능성"이 더 중요하다

많은 팀이 Pub/Sub 발행 성공 로그를 보고 안심합니다. 그런데 실제 장애는 소비자 지연, 중복, 순서 역전에서 납니다.

실무 기준 예시:

- `invalidation_lag_p95` 2초 초과 5분 지속 시 경보
- `invalidation_dlq_rate` 0.1% 초과 시 즉시 원인 분석
- 동일 key 1분 내 3회 이상 순서 역전 감지 시 버전 체크 강제
- 10분 이상 소비 지연 시 "강제 TTL 축소 모드" 전환(예: 300초 → 30초)

즉 "이벤트를 보냈다"가 아니라 "어긋나도 복구할 수 있다"가 기준입니다. 그래서 키 설계에 버전을 넣거나(`product:123:v57`), 값에 `updated_at/version`을 포함해 역전 업데이트를 막아야 합니다.

### 4) 캐시 설계 실패의 공통 원인: 성능 지표만 보고 정확성 지표를 안 본다

다음 상황은 위험 신호입니다.

- 캐시 적중률 95%인데 환불/정정 이슈 증가
- p95는 안정인데 특정 고객군만 잘못된 데이터 반복 노출
- TTL 연장으로 인프라 비용은 절감됐지만 CS 티켓 급증

운영 대시보드에 최소한 아래 4개가 필요합니다.

- `cache_hit_ratio` (성능)
- `stale_read_detected_rate` (정확성)
- `invalidation_lag_p95` (동기화 지연)
- `cache_rebuild_qps` (복구 부하)

`cache_hit_ratio` 단독 최적화는 장기적으로 사고를 만듭니다.

## 실무 적용

### 1) 데이터 클래스를 먼저 나누고, 클래스별 정책을 고정한다

권장 분류(초기 버전):

- **Class A (정합성 민감)**: 재고, 권한, 잔액
  - TTL 5~30초
  - 이벤트 무효화 필수
  - stale 탐지 시 즉시 DB 재조회
- **Class B (준실시간)**: 상품 상세, 배송 상태
  - TTL 1~5분
  - 이벤트 무효화 + 지연 허용
- **Class C (분석/추천)**: 집계 통계, 개인화 추천
  - TTL 5~30분
  - 배치 재생성 허용

이 분류를 문서화하지 않으면 팀마다 TTL/무효화 규칙이 달라져 운영 복잡도가 폭증합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 보통 **정확성 > 가용성 > 비용** 순으로 둡니다(결제/재고 기준).

- `stale_read_detected_rate > 0.5%` (Class A, 10분 평균) → 캐시 우회 읽기 강제 + 장애 등급 Sev2
- `invalidation_lag_p95 > 3s` 15분 지속 → 소비자 수평 확장 + 고비용 키 우선 처리
- `cache_rebuild_qps`가 평시 대비 3배 초과 → 재빌드 스로틀링(초당 키 갱신 상한 적용)
- DB CPU 80% 초과 + 캐시 미스 급증 시 → Soft TTL 서빙 허용 범위 임시 확대(단, Class A 제외)

핵심은 "무조건 최신"이나 "무조건 캐시" 같은 구호가 아니라, **데이터 클래스별 예외 조건**을 명시하는 것입니다.

### 3) 구현 패턴: Outbox + Invalidation Consumer + Version Guard

```text
[Write API]
  -> DB Transaction Commit
  -> Outbox Insert (entity_id, new_version, event_type)
  -> CDC Relay
  -> Invalidation Consumer
  -> DEL key or bump versioned key
```

이 구조의 장점:

- 애플리케이션 트랜잭션과 이벤트 발행을 분리하면서도 유실 가능성을 낮춤
- 소비 지연이 생겨도 Outbox/CDC 오프셋으로 재처리 가능
- 버전 가드로 out-of-order 업데이트 방어 가능

반대로 "DB 업데이트 후 즉시 Redis SET"만 사용하는 구조는 네트워크 실패/부분 성공에서 정합성 구멍이 생기기 쉽습니다.

### 4) 운영 런북(초기 4주)

**1주차: 관측 추가**
- keyspace별 hit/miss + stale 탐지 로그 추가
- 무효화 지연/실패 메트릭 수집

**2주차: 정책 분리**
- Class A/B/C 분류 및 TTL/무효화 규칙 문서화
- 위험 키(재고/권한)부터 버전 가드 적용

**3주차: 복구 체계 구축**
- DLQ 재처리 잡 구현
- "키 단위 재동기화" API 추가(운영자용)

**4주차: 게임데이**
- 소비자 중단/지연/중복 시나리오 주입
- stale 탐지율과 복구 시간(RTR: Recovery Time to Reconcile) 측정

## 트레이드오프/주의점

1) **정합성을 올리면 구현 복잡도와 쓰기 지연이 늘어난다**  
버전 관리, Outbox, CDC, 재처리 파이프라인을 도입하면 코드와 운영 부담이 증가합니다.

2) **이벤트 기반 무효화는 "적용 시점"이 분산된다**  
발행 성공 = 반영 완료가 아닙니다. 소비 지연과 순서 역전을 전제로 설계해야 합니다.

3) **TTL 단축은 정확성을 개선하지만 비용을 올린다**  
미스율이 올라 DB/스토리지 비용이 증가할 수 있으므로 클래스별 차등 적용이 필요합니다.

4) **캐시 무효화 권한을 넓게 주면 운영 사고가 난다**  
관리자 도구에서 광역 prefix 삭제를 허용할 때는 승인 절차와 속도 제한을 반드시 둬야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 데이터 클래스(A/B/C)별 stale 허용 범위와 TTL이 문서화되어 있다.
- [ ] 무효화 지연(`invalidation_lag_p95`)과 stale 탐지율을 상시 모니터링한다.
- [ ] Outbox/CDC 기반 재처리 경로가 있고, DLQ 복구 절차가 런북에 있다.
- [ ] 버전 가드(또는 타임스탬프 비교)로 순서 역전 업데이트를 방어한다.
- [ ] "적중률"과 "정확성" 지표를 함께 KPI로 본다.

### 연습 과제

1. 현재 서비스의 주요 캐시 키 20개를 뽑아 Class A/B/C로 분류하고, 각 키의 허용 stale 시간(초)을 정의해보세요.  
2. 무효화 소비자가 15분 지연됐다고 가정하고, 어떤 키를 우선 재동기화할지 우선순위 표를 작성해보세요.  
3. `stale_read_detected_rate`, `invalidation_lag_p95`, `cache_rebuild_qps` 세 지표로 Sev2 트리거 조건을 설계해보세요.

## 관련 글

- [Redis 캐싱 전략 심화](/learning/deep-dive/deep-dive-redis-caching/)
- [Redis 캐시 스탬피드 완화](/learning/deep-dive/deep-dive-redis-cache-stampede-mitigation/)
- [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [DB Replication과 Read/Write Split](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
