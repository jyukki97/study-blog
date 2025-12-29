---
title: "JPA 트랜잭션 경계와 Flush 전략"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["JPA", "Transaction", "Flush", "영속성컨텍스트"]
categories: ["Backend Deep Dive"]
description: "트랜잭션 경계, flush 시점, 지연 쓰기와 N+1 예방을 정리"
module: "spring-core"
quizzes:
  - question: "JPA에서 flush()와 commit()의 차이는?"
    options:
      - "둘 다 동일한 동작을 한다."
      - "flush()는 영속성 컨텍스트의 변경을 DB로 동기화(SQL 전송)하고, commit()은 트랜잭션을 확정한다."
      - "commit()이 먼저 실행되고 flush()가 나중에 실행된다."
      - "flush()는 트랜잭션을 롤백한다."
    answer: 1
    explanation: "flush()는 변경된 SQL을 DB로 보내지만 아직 확정되지 않습니다(롤백 가능). commit()이 호출되어야 비로소 트랜잭션이 완료됩니다. 보통 commit 직전에 자동 flush가 발생합니다."

  - question: "JPQL 쿼리 실행 직전에 자동으로 flush가 발생하는 이유는?"
    options:
      - "성능 최적화를 위해"
      - "영속성 컨텍스트에서 수정된 데이터가 JPQL 쿼리 결과에도 반영되어 데이터 정합성을 보장하기 위해"
      - "캐시를 초기화하기 위해"
      - "JPQL 쿼리가 느리기 때문에"
    answer: 1
    explanation: "JPQL은 DB를 직접 조회합니다. 만약 영속성 컨텍스트에서 수정된 데이터가 flush되지 않으면, DB에 반영되지 않은 stale한 데이터를 조회하게 됩니다. 이를 방지하기 위해 JPQL 실행 전에 자동 flush됩니다."

  - question: "`LazyInitializationException`이 발생하는 일반적인 원인은?"
    options:
      - "Eager Loading이 설정되어 있기 때문"
      - "트랜잭션(또는 세션)이 종료된 후에 Lazy 로딩된 연관 엔티티에 접근하기 때문"
      - "엔티티를 영속성 컨텍스트에 저장하지 않았기 때문"
      - "쿼리가 잘못되었기 때문"
    answer: 1
    explanation: "Lazy 로딩은 연관 엔티티 접근 시 DB 쿼리를 실행합니다. 트랜잭션이 끝나면 세션이 닫혀 DB 연결이 없으므로 예외가 발생합니다. Fetch Join으로 미리 조회하거나 트랜잭션 내에서 처리해야 합니다."

  - question: "JPQL Bulk Update/Delete 후에 `entityManager.clear()`를 호출하는 이유는?"
    options:
      - "트랜잭션을 커밋하기 위해"
      - "벌크 연산은 영속성 컨텍스트를 거치지 않아 캐시된 엔티티가 DB와 불일치할 수 있으므로, 캐시를 초기화하기 위해"
      - "Lazy 로딩을 활성화하기 위해"
      - "새로운 트랜잭션을 시작하기 위해"
    answer: 1
    explanation: "Bulk 연산은 DB를 직접 수정합니다. 영속성 컨텍스트에 캐시된 엔티티는 여전히 옛날 값을 가지고 있습니다. clear()로 캐시를 초기화해야 다시 조회할 때 최신 값을 가져옵니다."

  - question: "트랜잭션 경계를 Service 레이어에 두는 것이 권장되는 이유는?"
    options:
      - "Controller에 두면 코드가 길어지기 때문"
      - "트랜잭션이 너무 넓으면 락/커넥션 점유 시간이 길어져 동시성 문제와 성능 저하가 발생하기 때문"
      - "JPA 스펙에서 강제하기 때문"
      - "Repository에서는 트랜잭션을 사용할 수 없기 때문"
    answer: 1
    explanation: "트랜잭션이 Controller부터 시작하면 View 렌더링 등 오래 걸리는 작업까지 커넥션을 점유합니다. Service에서 비즈니스 로직 단위로 트랜잭션을 관리하면 커넥션 점유 시간을 최소화합니다."
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
