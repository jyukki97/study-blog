---
title: "JPA 트랜잭션 경계와 Flush 전략"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["JPA", "Transaction", "Flush", "영속성컨텍스트"]
categories: ["Backend Deep Dive"]
description: "트랜잭션 경계, flush 시점, 지연 쓰기와 N+1 예방을 정리"
module: "data-system"
study_order: 210
---

## 핵심 포인트

- 트랜잭션 경계: Service 레이어에서 `@Transactional` 시작/종료
- Flush 트리거: 트랜잭션 커밋, JPQL 실행 전, flush 호출
- 쓰기 지연: 영속성 컨텍스트에 쿼리 저장 → flush 시 SQL 일괄 전송
- 지연 로딩 주의: 트랜잭션 종료 후 Lazy 접근 → `LazyInitializationException`

## 예제

```java
@Service
@Transactional
public class OrderService {
    public void placeOrder(Order order) {
        orderRepository.save(order); // 영속성 컨텍스트 저장, 아직 DB 반영 X
        // 다른 로직...
        // 트랜잭션 커밋 시 flush → commit
    }
}
```

## 체크리스트

- [ ] 트랜잭션 경계는 Service에 두고, Controller/Filter에서 열지 않는다.
- [ ] JPQL 실행 전에 flush가 발생함을 기억하고, 대량 업데이트 시 배치 옵션/네이티브 사용 고려.
- [ ] Lazy 로딩이 필요한 구간이 트랜잭션 내부에 있는지 확인.
- [ ] Event Listener나 비동기 호출에서 영속성 컨텍스트가 닫히는지 주의.
