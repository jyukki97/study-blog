---
title: "Spring @Transactional 기본 사용법 예제"
date: 2025-02-02
draft: false
topic: "Spring"
topic_icon: "🍃"
topic_description: "스프링 트랜잭션 전파, 롤백 규칙 기본 예제"
tags: ["Spring", "Transaction", "@Transactional", "Rollback"]
categories: ["Development", "Learning"]
description: "가장 많이 사용하는 @Transactional 패턴과 실수하기 쉬운 포인트 정리"
module: "spring-core"
study_order: 18
---

## 1. 서비스 레이어에서 @Transactional 사용

```java
@Service
@RequiredArgsConstructor
public class OrderService {

    private final OrderRepository orderRepository;
    private final PaymentGateway paymentGateway;

    @Transactional
    public void placeOrder(OrderRequest request) {
        // 1. 주문 데이터 저장
        Order order = orderRepository.save(request.toEntity());

        // 2. 결제 시도 (실패 시 RuntimeException 발생)
        paymentGateway.pay(order.getId(), request.getAmount());
    }
}
```

**핵심 포인트**
- 기본 전파: `Propagation.REQUIRED`
- 기본 롤백: `RuntimeException` / `Error` 발생 시 롤백

## 2. 체크 예외(Checked Exception) 롤백 설정

```java
@Transactional(rollbackFor = { IOException.class })
public void uploadFile(MultipartFile file) throws IOException {
    storageService.store(file);  // IOException 발생 가능
}
```

**체크리스트**
- Checked Exception 에 대해서는 `rollbackFor` 로 명시
- 비즈니스 예외용 커스텀 예외는 RuntimeException 을 상속해서 사용하는 게 일반적

## 3. 읽기 전용 트랜잭션

```java
@Transactional(readOnly = true)
public List<Order> getRecentOrders(Long userId) {
    return orderRepository.findTop10ByUserIdOrderByCreatedAtDesc(userId);
}
```

**효과**
- JPA: dirty checking 비활성화 → 약간의 성능 이점
- 일부 DB 드라이버: 최적화 힌트로 사용

## 4. self-invocation 주의 (내부 메서드 호출)

```java
@Service
public class UserService {

    @Transactional
    public void createUser(UserRequest request) {
        userRepository.save(request.toEntity());
        sendWelcomeMail(request.getEmail());  // ❌ 트랜잭션 적용 안 됨
    }

    @Transactional
    public void sendWelcomeMail(String email) {
        // 메일 발송 로직
    }
}
```

**왜 안 될까?**
- 같은 빈 내부에서 `this.sendWelcomeMail()` 호출 → 프록시를 거치지 않음
- 해결: 별도 서비스로 분리하거나, AOP 프록시를 명시적으로 사용

## 5. 간단한 실습 아이디어

- 의도적으로 예외를 던져 롤백 로그 확인하기
- `@Transactional` 유무에 따라 DB에 commit 되는지 비교
- `readOnly = true` 와 일반 트랜잭션의 성능 차이 측정
