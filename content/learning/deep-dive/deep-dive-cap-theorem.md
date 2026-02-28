---
title: "CAP 이론과 PACELC: 분산 시스템 트레이드오프"
date: 2025-12-28
draft: false
topic: "Backend Deep Dive"
tags: ["분산시스템", "CAP", "PACELC", "일관성"]
categories: ["Learning"]
study_order: 951
module: "distributed-system"
---

## 이 글에서 얻는 것

- CAP 이론을 면접용 문장이 아니라 **설계 의사결정 기준**으로 이해한다.
- PACELC로 CAP 이후(장애가 없을 때)의 트레이드오프까지 설명할 수 있다.
- MySQL, PostgreSQL, Redis, Cassandra 같은 시스템을 **왜 그렇게 동작하는지**로 분류한다.

## 1) CAP 이론 한 줄 정리

분산 시스템에서 네트워크 파티션(P)이 발생했을 때, **일관성(C)** 과 **가용성(A)** 를 동시에 완벽히 보장하기 어렵다.

- **Consistency**: 모든 노드가 같은 시점에 같은 값을 본다.
- **Availability**: 모든 요청이 실패 없이 응답을 받는다(성공/실패 포함).
- **Partition Tolerance**: 노드 간 네트워크가 끊겨도 시스템이 계속 동작한다.

핵심은 **현실에서 P는 피할 수 없다**는 점이다. 그래서 실무는 사실상 `CP vs AP` 선택이다.

## 2) CAP 오해 바로잡기

### 오해 1) "CA 시스템"이 항상 가능하다

단일 노드에서는 가능해 보인다. 하지만 분산 환경에서는 파티션이 생기므로 결국 선택이 필요하다.

### 오해 2) AP는 일관성이 아예 없다

아니다. AP는 보통 **Eventual Consistency(결과적 일관성)** 를 택한다.

### 오해 3) CAP만 알면 설계 끝

아니다. CAP은 장애 상황 중심이다. 정상 상황 지연(latency)까지 보려면 PACELC가 필요하다.

## 3) PACELC

PACELC는 다음 질문을 던진다.

- **P(파티션) 발생 시**: A와 C 중 무엇을 택할 것인가?
- **Else(정상 시)**: L(낮은 지연)과 C(강한 일관성) 중 무엇을 더 우선할 것인가?

즉 분산 시스템은 장애 시뿐 아니라 평상시에도 trade-off가 있다.

## 4) 시스템 예시 분류

### CP 성향

- ZooKeeper, etcd
- 금융/재고처럼 정합성 우선 영역

### AP 성향

- Cassandra, Dynamo 계열
- 글로벌 분산/높은 가용성 우선 서비스

### RDBMS는?

- 단일 MySQL은 강한 정합성(CA처럼 보임)
- 리드 레플리카 붙이고 지리 분산하면 결국 복제 지연/파티션 이슈를 만난다

## 5) 실무 판단 프레임

질문을 순서대로 던지면 된다.

1. 이 도메인에서 **오류 허용 범위**는?
   - 결제/재고: 낮음 → C 우선
   - 피드/좋아요 카운트: 상대적으로 높음 → A/L 우선
2. 장애 시 **서비스 계속성**이 더 중요한가?
3. 평시 트래픽에서 **지연 10~30ms 증가**를 허용할 수 있는가?

## 6) Spring 서비스에서의 적용 감각

```java
@Service
public class InventoryService {
    @Transactional
    public void reserve(Long productId, int qty) {
        // CP 성향: 강한 정합성 + 락 기반 처리
        Product p = productRepository.findByIdForUpdate(productId)
                .orElseThrow();
        p.reserve(qty);
    }
}
```

```java
@Service
public class FeedCounterService {
    // AP 성향: Redis 증가 후 비동기 동기화 (Eventual Consistency)
    public Long increaseLikeCount(Long postId) {
        return redisTemplate.opsForValue().increment("post:like:" + postId);
    }
}
```

## 7) 자주 하는 실수

- CAP을 "무조건 AP가 최신"처럼 오해
- 도메인 중요도 구분 없이 한 가지 저장소에 몰아넣기
- 복제 지연/재시도/멱등성 설계 없이 비동기만 도입

## 8) 연습 문제

1. 주문/결제/쿠폰/추천 각각을 CP/AP 중 어디에 가깝게 둘지 이유와 함께 분류해보세요.
2. 현재 프로젝트에서 "파티션 발생 시" 동작 시나리오를 적어보세요.
3. Redis + DB 조합에서 데이터 불일치가 생길 때 복구 전략을 설계해보세요.

## 요약

- CAP은 장애 시 선택, PACELC는 평시 지연까지 포함한 선택 기준이다.
- 분산 시스템 설계는 기술 취향이 아니라 **도메인 리스크 관리**다.
- 실무에서는 CP/AP를 섞어 쓰고, 경계에서 멱등성/재시도/보상 로직으로 봉합한다.

## 다음 글

- **분산 시스템 기초**: `/learning/deep-dive/deep-dive-distributed-systems/`
- **데이터베이스 샤딩**: `/learning/deep-dive/deep-dive-database-sharding/`
- **DB 복제 전략**: `/learning/deep-dive/deep-dive-database-replication/`
