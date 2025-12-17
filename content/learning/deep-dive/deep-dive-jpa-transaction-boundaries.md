---
title: "JPA 트랜잭션 경계와 Flush 전략"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["JPA", "Transaction", "Flush", "영속성컨텍스트"]
categories: ["Backend Deep Dive"]
description: "트랜잭션 경계, flush 시점, 지연 쓰기와 N+1 예방을 정리"
module: "spring-core"
study_order: 157
---

## 이 글에서 얻는 것

- JPA의 “영속성 컨텍스트”와 “트랜잭션 경계”가 왜 중요한지(정합성/성능/예외) 이해할 수 있습니다.
- `flush`와 `commit`의 차이를 설명하고, “왜 JPQL이 flush를 유발하는지” 같은 실전 질문에 답할 수 있습니다.
- `LazyInitializationException`, 벌크 업데이트, 이벤트 리스너 같은 함정을 피할 수 있습니다.

## 0) 트랜잭션 경계는 ‘서비스 로직의 단위’다

JPA에서 대부분의 문제는 “트랜잭션 밖에서 엔티티를 건드린다”거나,
“트랜잭션이 너무 길다/너무 넓다”에서 시작합니다.

권장 감각:

- 트랜잭션은 보통 **Service 레이어**에서 시작/종료합니다.
- Controller/Filter에서 트랜잭션을 열면(경계가 넓어지면) 락/커넥션 점유 시간이 늘어 사고가 나기 쉽습니다.

## 1) 영속성 컨텍스트: JPA가 상태를 기억하는 곳

영속성 컨텍스트는 “엔티티의 변경 사항”을 추적합니다.

- 1차 캐시(동일 엔티티 재조회 시 DB 재조회 감소)
- Dirty checking(변경 감지)
- Write-behind(쓰기 지연)

## 2) flush vs commit: 반드시 구분해야 한다

- **flush**: 영속성 컨텍스트의 변경 내용을 DB로 “동기화”(SQL을 보냄)
- **commit**: DB 트랜잭션을 “확정”

즉, flush가 됐다고 해서 커밋된 건 아닙니다. (롤백하면 되돌아갑니다.)

## 3) Flush 트리거: 언제 SQL이 DB로 나가나

대표 트리거:

- 트랜잭션 커밋 시점
- JPQL/Criteria 쿼리 실행 직전(정합성을 위해)
- 명시적 `flush()` 호출

왜 JPQL 전에 flush가 발생할까?

- 영속성 컨텍스트에서 변경한 값이 “쿼리 결과”에도 반영되어야 정합성이 맞기 때문입니다.

## 4) 예제로 감 잡기

```java
@Service
@Transactional
public class OrderService {
    public void placeOrder(Order order) {
        orderRepository.save(order); // 아직 DB 반영이 아닐 수 있음(쓰기 지연)
        // 다른 로직...
        // 커밋 시점에 flush -> commit
    }
}
```

여기서 중요한 포인트는:

- `save()`는 “즉시 insert”가 아닐 수 있습니다(쓰기 지연).
- 커밋 시점/쿼리 실행 시점에 flush가 발생하며, 그때 SQL이 나갑니다.

## 5) Lazy 로딩과 `LazyInitializationException`

지연 로딩(LAZY)은 “필요할 때 로드”하지만, 트랜잭션(또는 세션)이 닫힌 후에 접근하면 예외가 납니다.

대표 해결 방향:

- 트랜잭션 내부에서 필요한 연관을 미리 조회(fetch join, DTO 매핑)
- API 서버에서는 OSIV(Open Session In View)를 끄고(권장되는 경우가 많음), 서비스 레이어에서 조회/매핑을 끝내기

## 6) 벌크 업데이트(JPQL update/delete)는 영속성 컨텍스트를 건너뛴다

JPQL 벌크 연산은 DB에 바로 반영되지만, 영속성 컨텍스트에 있는 엔티티 상태는 “낡을 수” 있습니다.
그래서 벌크 연산 뒤에는 보통 `clear()`가 필요합니다.

## 7) 실무에서 자주 하는 실수

- 트랜잭션 밖에서 엔티티를 수정하고 “왜 저장 안 됐지?”라고 생각하는 경우
- 조회 쿼리 앞에서 flush가 일어나 “왜 업데이트가 먼저 나가지?” 헷갈리는 경우
- 벌크 업데이트 후 같은 트랜잭션에서 엔티티를 다시 사용해 “이상한 값”을 보는 경우
- 이벤트/비동기 작업에서 영속성 컨텍스트가 닫힌 뒤 LAZY 접근이 터지는 경우

## 연습(추천)

- “save 후 바로 JPQL 조회”를 넣어서 flush가 언제 발생하는지 로그로 확인해보기
- OSIV를 껐을 때/켰을 때 Lazy 로딩 예외가 어떻게 달라지는지 비교해보기
- 벌크 업데이트를 실행한 뒤 같은 트랜잭션에서 엔티티를 다시 읽어 stale 상태를 재현하고, `clear()`로 해결해보기
