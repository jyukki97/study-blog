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
study_order: 120
---

## 이 글에서 얻는 것

- `@Transactional`이 “DB 커밋/롤백”을 어떻게 제어하는지(경계/프록시/예외 규칙) 설명할 수 있습니다.
- 전파(Propagation)와 롤백 규칙을 이해하고, 자주 하는 실수(self-invocation, 예외 삼키기)를 피할 수 있습니다.
- 읽기 전용 트랜잭션과 격리 수준이 언제 의미가 있는지 감각을 잡습니다.

## 1) 서비스 레이어에서 `@Transactional`을 쓰는 이유

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

핵심은 “여기부터 여기까지는 한 덩어리로 성공하거나, 실패하면 되돌린다”는 **경계(boundary)** 를 선언하는 것입니다.
이 경계가 있으면 중간에 예외가 터져도 “부분 저장”이 남지 않게 만들 수 있습니다.

## 2) 기본 동작 3가지(자주 쓰는 것만)

### 2-1) 전파(Propagation) 기본값은 REQUIRED

`REQUIRED`는 “이미 트랜잭션이 있으면 참여하고, 없으면 새로 만든다”입니다.
대부분의 서비스 메서드는 REQUIRED가 기본으로 충분합니다.

### 2-2) 롤백 기본값은 RuntimeException/Error

스프링은 기본적으로 `RuntimeException`/`Error`에서 롤백합니다.
즉, 비즈니스 실패는 런타임 예외로 표현하는 게 자연스럽습니다(호출부에 체크 예외가 전파되지 않게).

### 2-3) 예외를 “잡아먹으면” 커밋될 수 있다

다음처럼 예외를 잡고 삼키면, 트랜잭션은 성공으로 간주되어 커밋될 수 있습니다.

```java
@Transactional
public void doSomething() {
    try {
        gateway.call();
    } catch (Exception e) {
        // 로그만 찍고 끝내면 커밋될 수도 있음
    }
}
```

실패로 처리해야 한다면 “예외를 다시 던지거나”, 최소한 rollback-only로 마킹해야 합니다.

## 3) 체크 예외(Checked Exception)와 롤백

체크 예외는 기본 롤백 대상이 아닐 수 있으니, 의도가 “실패=롤백”이면 명시가 필요합니다.

```java
@Transactional(rollbackFor = { IOException.class })
public void uploadFile(MultipartFile file) throws IOException {
    storageService.store(file);  // IOException 발생 가능
}
```

실무에서는 보통:

- “복구 가능한 체크 예외”가 아니면 런타임 예외로 감싸서 전파하고,
- 정말 체크 예외로 두어야 한다면 `rollbackFor`를 명확히 합니다.

## 4) 읽기 전용 트랜잭션(`readOnly = true`)

```java
@Transactional(readOnly = true)
public List<Order> getRecentOrders(Long userId) {
    return orderRepository.findTop10ByUserIdOrderByCreatedAtDesc(userId);
}
```

효과(대표):

- JPA/Hibernate에서 flush 동작이 줄어들어 약간의 이점이 있을 수 있습니다.
- “이 메서드는 쓰기하면 안 된다”는 의도를 코드로 드러내는 효과도 큽니다.

주의: `readOnly`는 DB 격리/락을 바꿔주는 마법이 아니라 “힌트/설정”에 가깝습니다.

## 5) 프록시/호출 경계: self-invocation이 왜 위험한가

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

스프링의 `@Transactional`은 보통 “프록시(AOP)”로 적용됩니다.  
같은 객체 내부에서 `this.method()`로 호출하면 프록시를 거치지 않아 트랜잭션이 적용되지 않을 수 있습니다.

해결 방향:

- 트랜잭션 경계를 분리할 메서드는 다른 빈으로 분리
- “프록시를 타야 한다”는 사실을 전제로 구조를 잡기(기능을 작게 나누기)

## 6) 전파 옵션은 언제 쓰나(대표만)

- `REQUIRES_NEW`: 외부 트랜잭션과 분리된 “독립 커밋”이 필요할 때(로그/아웃박스 등)  
  단, 남발하면 트랜잭션이 쪼개져 일관성/성능 문제가 생길 수 있습니다.
- `NESTED`: DB가 savepoint를 지원할 때 부분 롤백(환경 의존)

## 연습(추천)

- 의도적으로 예외를 던져 롤백되는지 확인하고, 예외를 catch해서 삼켰을 때 커밋되는지 비교해보기
- self-invocation 케이스를 재현하고 “왜 프록시를 안 타는지”를 로그로 확인해보기
- `REQUIRES_NEW`를 적용했을 때 외부 트랜잭션 롤백과 독립 커밋이 어떻게 갈리는지 실험해보기
