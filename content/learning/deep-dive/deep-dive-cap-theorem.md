---
title: "CAP 이론과 PACELC: 분산 시스템 트레이드오프"
date: 2025-12-28
draft: false
topic: "Backend Deep Dive"
tags: ["분산시스템", "CAP", "PACELC", "일관성", "Consistency", "Availability"]
categories: ["Learning"]
study_order: 951
module: "distributed-system"
description: "CAP 이론과 PACELC 확장을 설계 의사결정 기준으로 이해하고, 주요 분산 시스템의 트레이드오프를 분류"
---

## 이 글에서 얻는 것

- CAP 이론을 면접용 문장이 아니라 **설계 의사결정 기준**으로 이해한다.
- PACELC로 CAP 이후(장애가 없을 때)의 트레이드오프까지 설명할 수 있다.
- MySQL, PostgreSQL, Redis, Cassandra 같은 시스템을 **왜 그렇게 동작하는지**로 분류한다.
- Tunable Consistency로 시스템을 상황에 맞게 조절하는 방법을 익힌다.

## 1) CAP 이론 한 줄 정리

분산 시스템에서 네트워크 파티션(P)이 발생했을 때, **일관성(C)** 과 **가용성(A)** 를 동시에 완벽히 보장하기 어렵다.

- **Consistency**: 모든 노드가 같은 시점에 같은 값을 본다.
- **Availability**: 모든 요청이 실패 없이 응답을 받는다(성공/실패 포함).
- **Partition Tolerance**: 노드 간 네트워크가 끊겨도 시스템이 계속 동작한다.

핵심은 **현실에서 P는 피할 수 없다**는 점이다. 그래서 실무는 사실상 `CP vs AP` 선택이다.

---

## 2) CAP 오해 바로잡기

### 오해 1: "CA 시스템"이 항상 가능하다

단일 노드에서는 가능해 보인다. 하지만 분산 환경에서는 파티션이 생기므로 결국 선택이 필요하다.

> "CA를 선택한다"는 것은 사실상 "분산하지 않는다"와 같다. 단일 MySQL이 여기에 해당한다.

### 오해 2: AP는 일관성이 아예 없다

아니다. AP는 보통 **Eventual Consistency(결과적 일관성)** 를 택한다. 시간이 지나면 결국 일관성을 회복한다.

### 오해 3: CAP만 알면 설계 끝

아니다. CAP은 장애 상황 중심이다. 정상 상황 지연(latency)까지 보려면 PACELC가 필요하다.

### 오해 4: CP면 항상 "쓰기 불가"

CP 시스템도 과반수(Quorum)가 살아있으면 정상 동작한다. 소수 노드가 격리될 때만 해당 노드에서 쓰기가 거부된다.

### 오해 5: CAP은 이진 선택이다

실제로는 **스펙트럼**이다. 같은 시스템 안에서도 도메인/테이블/연산별로 CP/AP를 다르게 설정할 수 있다.

---

## 3) 일관성 모델 비교 — CAP의 C를 더 깊이

CAP의 "Consistency"는 **Linearizability(선형 일관성)**을 의미한다. 하지만 실무에서는 다양한 일관성 수준이 존재한다.

| 일관성 모델 | 강도 | 설명 | 성능 영향 | 예시 |
| :--- | :--- | :--- | :--- | :--- |
| **Linearizability** | ★★★★★ | 모든 연산이 실시간 순서를 반영 | 매우 높음 | Spanner, CockroachDB |
| **Sequential** | ★★★★ | 모든 프로세스가 같은 순서를 봄 | 높음 | ZooKeeper |
| **Causal** | ★★★ | 인과관계가 있는 연산만 순서 보장 | 중간 | MongoDB (causal sessions) |
| **Eventual** | ★★ | 시간이 지나면 결국 수렴 | 낮음 | Cassandra, DynamoDB |
| **Read-your-writes** | ★★★ | 내가 쓴 값은 즉시 읽음 | 중간 | 대부분 웹 서비스 기대치 |

```
강한 일관성 ◀━━━━━━━━━━━━━━━━━━━━━━━━▶ 약한 일관성
Linearizable → Sequential → Causal → Read-your-writes → Eventual
  (느리지만 안전)                                    (빠르지만 불확실)
```

> **실무 감각**: 대부분의 웹 서비스는 **Read-your-writes + Eventual** 조합이면 충분하다. Linearizability가 필요한 곳은 결제/재고/좌석 예약처럼 "두 번 팔면 안 되는" 도메인뿐이다.

---

## 4) PACELC

PACELC는 다음 질문을 던진다.

- **P(파티션) 발생 시**: A와 C 중 무엇을 택할 것인가?
- **Else(정상 시)**: L(낮은 지연)과 C(강한 일관성) 중 무엇을 더 우선할 것인가?

즉 분산 시스템은 장애 시뿐 아니라 평상시에도 trade-off가 있다.

### PACELC 분류 상세표

| 시스템 | P 시: A or C | E 시: L or C | 설명 |
| :--- | :--- | :--- | :--- |
| **ZooKeeper** | C | C | 리더 선출, 과반수 합의 필수 |
| **etcd** | C | C | Raft 합의, K8s 등 CP 표준 |
| **Spanner** | C | C | TrueTime으로 전역 선형 일관성. 지연 높음 |
| **CockroachDB** | C | C | Spanner 유사, 시리얼라이즈 격리 수준 |
| **MySQL (단일)** | N/A | C | 파티션 없음 (단일 노드) |
| **MySQL (Galera)** | C | L | 동기 복제지만 지연 최소화 설계 |
| **PostgreSQL (Streaming)** | A | L | 비동기 복제 기본, 읽기 지연 허용 |
| **Cassandra** | A | L | Tunable: W1R1이면 AL, Quorum이면 EC |
| **DynamoDB** | A | L | 기본 Eventual, Strong Read 옵션 |
| **MongoDB** | A (기본) | L | w:majority + readConcern으로 CP 가능 |
| **Redis (Cluster)** | A | L | 비동기 복제, WAIT 명령으로 부분 동기화 |
| **Kafka** | A (기본) | L | acks=all + ISR로 CP 설정 가능 |

---

## 5) Tunable Consistency — 고정이 아닌 조절

많은 현대 시스템은 CP/AP를 고정하지 않고, **쿼리별로 일관성 수준을 조절**할 수 있다.

### 5-1) Cassandra의 Quorum 공식

```
N = 복제 팩터 (보통 3)
W = 쓰기 시 응답 필요 노드 수
R = 읽기 시 응답 필요 노드 수

W + R > N  →  강한 일관성 보장 (읽기와 쓰기가 반드시 겹침)
```

| 설정 | W | R | 특성 |
| :--- | :--- | :--- | :--- |
| `ONE / ONE` | 1 | 1 | 최고 속도, Eventual Consistency |
| `QUORUM / QUORUM` | 2 | 2 | 강한 일관성 (W+R=4 > N=3) |
| `ALL / ONE` | 3 | 1 | 쓰기 느림, 읽기 빠름, 강한 일관성 |
| `ONE / ALL` | 1 | 3 | 쓰기 빠름, 읽기 느림, 강한 일관성 |

```cql
-- Cassandra CQL: 쿼리별 일관성 수준 지정
CONSISTENCY QUORUM;
SELECT * FROM orders WHERE order_id = 'ord-001';

CONSISTENCY ONE;
SELECT * FROM product_views WHERE product_id = 'p-100';
```

### 5-2) DynamoDB Consistent Read

```java
// AWS SDK: 강한 일관성 읽기
GetItemRequest request = GetItemRequest.builder()
    .tableName("Orders")
    .key(Map.of("orderId", AttributeValue.builder().s("ord-001").build()))
    .consistentRead(true)   // ← 강한 일관성 (리더 노드에서 읽기)
    .build();
// consistentRead(false) → Eventual Consistency (기본, 2배 빠름, 비용 절반)
```

### 5-3) MongoDB Read/Write Concern

```javascript
// 강한 일관성: 과반수 노드에 쓰기 확인 + 과반수에서 읽기
db.orders.insertOne(
  { orderId: "ord-001", amount: 50000 },
  { writeConcern: { w: "majority", wtimeout: 5000 } }
);

db.orders.find({ orderId: "ord-001" })
  .readConcern("majority");   // 과반수에 커밋된 데이터만 읽기

// 빠른 읽기: 가장 가까운 노드에서 읽기 (Eventual)
db.orders.find({ orderId: "ord-001" })
  .readPref("nearest")
  .readConcern("local");
```

---

## 6) 네트워크 파티션 시나리오 — 구체적으로 이해하기

### 시나리오: 3노드 클러스터에서 네트워크 분리

```
정상 상태:
  [Node A] ←→ [Node B] ←→ [Node C]
  
파티션 발생 (Node C가 격리):
  [Node A] ←→ [Node B]     [Node C] (격리됨)
  
CP 시스템 (예: ZooKeeper):
  - A, B: 과반수(2/3) 확보 → 정상 서비스
  - C: 과반수 미달 → 읽기/쓰기 거부 (503 응답)
  
AP 시스템 (예: Cassandra ONE):
  - A, B: 정상 서비스
  - C: 자기 로컬 데이터로 서비스 계속 (stale 데이터 가능)
  - 파티션 복구 후: Anti-entropy로 데이터 수렴
```

### Split-Brain 문제

```
최악의 케이스: 동시 쓰기
  
  Client X → [Node A]: balance = 1000 - 500 = 500
  Client Y → [Node C]: balance = 1000 - 700 = 300  (격리된 C가 구 데이터 기반)
  
파티션 복구 후:
  balance = 500? 300? 두 값이 충돌!
  
해결 방법:
  1) Last-Write-Wins (LWW): 타임스탬프가 늦은 값 채택 (데이터 유실 가능)
  2) Vector Clock: 인과관계 추적 → 충돌 감지 → 애플리케이션이 해결
  3) CRDT: 자동으로 수렴하는 자료구조 (카운터, 집합 등)
```

---

## 7) Spring 서비스에서의 적용 감각

### CP 패턴: 재고/결제 (정합성 우선)

```java
@Service
public class InventoryService {
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public void reserve(Long productId, int qty) {
        // 비관적 락: 동시 요청이 순차 처리됨
        Product p = productRepository.findByIdForUpdate(productId)
                .orElseThrow(() -> new ProductNotFoundException(productId));
        
        if (p.getStock() < qty) {
            throw new InsufficientStockException(productId, p.getStock(), qty);
        }
        p.reserve(qty);
        
        // 감사 로그 (변경 추적)
        auditLogRepository.save(AuditLog.of("RESERVE", productId, qty));
    }
}
```

### AP 패턴: 피드/카운터 (가용성 + 성능 우선)

```java
@Service
public class FeedCounterService {
    private final StringRedisTemplate redisTemplate;
    
    // AP 성향: Redis에 즉시 반영 → 비동기로 DB 동기화
    public Long increaseLikeCount(Long postId) {
        String key = "post:like:" + postId;
        Long count = redisTemplate.opsForValue().increment(key);
        
        // 비동기 DB 동기화 (Eventual Consistency)
        eventPublisher.publish(new LikeCountEvent(postId, count));
        return count;
    }
    
    // 읽기: Redis 먼저, 없으면 DB (Read-your-writes 보장)
    public Long getLikeCount(Long postId) {
        String cached = redisTemplate.opsForValue().get("post:like:" + postId);
        if (cached != null) return Long.parseLong(cached);
        
        return postRepository.findLikeCount(postId);
    }
}
```

### 하이브리드: 같은 서비스 안에서 CP/AP 혼용

```java
@Service
public class OrderService {
    // CP: 주문 생성은 강한 일관성 (DB 트랜잭션)
    @Transactional
    public Order createOrder(OrderRequest request) {
        inventoryService.reserve(request.getProductId(), request.getQty());  // CP
        Order order = orderRepository.save(Order.from(request));
        paymentService.processPayment(order);  // CP
        return order;
    }
    
    // AP: 주문 조회수는 Eventual Consistency
    public void incrementViewCount(Long orderId) {
        redisTemplate.opsForValue().increment("order:view:" + orderId);  // AP
    }
}
```

---

## 8) 실무 판단 프레임

### 도메인별 CP/AP 의사결정 매트릭스

| 도메인 | 불일치 비용 | 지연 허용도 | 권장 | 근거 |
| :--- | :--- | :--- | :--- | :--- |
| 결제/송금 | 극도로 높음 | 높음 (수초 OK) | **CP** | 이중 차감/이중 입금 방지 |
| 재고/좌석 | 높음 | 중간 | **CP** | 초과 판매 방지 |
| 쿠폰 발급 | 중간 | 중간 | **CP** (중복 발급 방지) | 재무 영향 |
| 사용자 프로필 | 낮음 | 낮음 (빠르게) | **AP** | 구 데이터 보여도 무해 |
| 피드/타임라인 | 낮음 | 매우 낮음 | **AP** | 수초 지연 무방 |
| 좋아요/조회수 | 매우 낮음 | 매우 낮음 | **AP** | 근사치로 충분 |
| 추천/검색 | 낮음 | 낮음 | **AP** | 실시간 정확성 불필요 |
| 채팅 메시지 | 중간 | 낮음 | **AP + 인과적 순서** | 순서만 보장되면 OK |

### 의사결정 플로우차트

```
Q1. "데이터가 잠깐 틀리면 돈을 잃나?"
    ├─ Yes → CP (강한 일관성 + 분산 락/트랜잭션)
    └─ No
        Q2. "사용자가 자기가 쓴 값을 즉시 못 보면 혼란스러운가?"
            ├─ Yes → Read-your-writes (세션 일관성)
            └─ No → Eventual Consistency (AP, 최고 성능)
```

---

## 9) 자주 하는 실수

| 실수 | 왜 문제인가 | 해결 |
| :--- | :--- | :--- |
| CAP을 "무조건 AP가 최신"처럼 오해 | AP도 결국 수렴하지만, 수렴까지의 창은 존재 | 비즈니스 허용 지연 정의 |
| 도메인 중요도 구분 없이 한 저장소에 몰아넣기 | 결제+피드가 같은 DB면 성능/일관성 타협 | 도메인별 저장소 분리 |
| 복제 지연/재시도/멱등성 설계 없이 비동기 도입 | 데이터 유실, 중복 처리 | 멱등 키 + 재시도 + 보상 트랜잭션 |
| "Linearizable이면 안전"이라고 무조건 적용 | 성능 저하, 가용성 하락 | 필요한 곳에만 선택적 적용 |
| Read Replica 지연을 고려하지 않음 | 쓴 직후 읽기에서 구 데이터 반환 | Write 후 Read는 Primary로 라우팅 |

---

## 10) 연습 문제

1. 주문/결제/쿠폰/추천 각각을 CP/AP 중 어디에 가깝게 둘지 이유와 함께 분류해보세요.
2. 현재 프로젝트에서 "파티션 발생 시" 동작 시나리오를 적어보세요.
3. Redis + DB 조합에서 데이터 불일치가 생길 때 복구 전략을 설계해보세요.
4. Cassandra에서 `N=3, W=2, R=1` 일 때, 강한 일관성이 보장되는지 판단하고 이유를 설명해보세요.
5. 이커머스 서비스에서 "주문 생성은 CP, 주문 조회는 AP"로 설계할 때, 구체적인 기술 스택과 구현 방법을 제안해보세요.

---

## 요약

- CAP은 장애 시 선택, PACELC는 평시 지연까지 포함한 선택 기준이다.
- 분산 시스템 설계는 기술 취향이 아니라 **도메인 리스크 관리**다.
- 일관성은 스펙트럼: Linearizable에서 Eventual까지, 도메인에 맞게 선택한다.
- Tunable Consistency로 쿼리/테이블 단위로 정밀하게 조절 가능하다.
- 실무에서는 CP/AP를 섞어 쓰고, 경계에서 멱등성/재시도/보상 로직으로 봉합한다.

---

## 관련 심화 학습

- [합의 알고리즘 (Raft, Paxos)](/learning/deep-dive/deep-dive-consensus-algorithms/) — CP 시스템의 리더 선출 메커니즘
- [DB 복제 & 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/) — 복제 지연과 일관성 트레이드오프
- [샤딩 & Consistent Hashing](/learning/deep-dive/deep-dive-sharding-consistent-hashing/) — 파티션 내성과 확장성
- [분산 락](/learning/deep-dive/deep-dive-distributed-lock/) — 분산 환경에서의 동시성 보장
- [분산 트랜잭션](/learning/deep-dive/deep-dive-distributed-transactions/) — 2PC, Saga 패턴
- [CQRS 패턴](/learning/deep-dive/deep-dive-cqrs/) — Eventually Consistent 설계
- [일관성 모델](/learning/deep-dive/deep-dive-consistency-models/) — 일관성 수준 심화
- [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/) — 안전한 재시도 보장
