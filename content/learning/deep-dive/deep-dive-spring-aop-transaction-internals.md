---
title: "Spring AOP와 트랜잭션 내부 동작"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "AOP", "Transaction", "Proxy"]
categories: ["Backend Deep Dive"]
description: "프록시 기반 AOP, @Transactional 적용 시점, self-invocation 주의사항 정리"
module: "spring-core"
study_order: 145
---

## 이 글에서 얻는 것

- Spring AOP가 “어떻게 프록시로 동작을 끼워 넣는지” 이해하고, 프록시 때문에 생기는 문제를 디버깅할 수 있습니다.
- `@Transactional`이 실제로는 어떤 컴포넌트(Interceptor/TransactionManager)로 동작하는지 큰 흐름을 설명할 수 있습니다.
- self-invocation, 메서드 가시성, 프록시 종류(JDK/CGLIB) 같은 “실수 패턴”을 피할 수 있습니다.

## 1) AOP를 한 문장으로

AOP(Aspect-Oriented Programming)는 “비즈니스 로직과 직접 관련 없지만 여러 곳에 반복되는 관심사(로깅, 트랜잭션, 보안 등)”를
한 곳에서 정의하고, 특정 지점에 끼워 넣는 방식입니다.

스프링은 보통 **런타임 프록시**로 AOP를 구현합니다.

## 2) 스프링 AOP의 기본 구조(포인트컷/어드바이스/프록시)

- **Pointcut**: 어디에 적용할지(메서드/패키지/어노테이션 조건)
- **Advice**: 무엇을 할지(전/후/예외/around)
- **Proxy**: 실제 빈을 감싸서(랩핑) “호출 경계”에서 advice를 실행

즉, AOP가 적용되는 순간부터 “내가 호출하는 객체”는 실제 객체가 아니라 **프록시**일 수 있습니다.

## 3) 프록시 종류: JDK vs CGLIB

### JDK Dynamic Proxy

- 인터페이스가 있을 때 사용 가능
- 프록시 타입은 “인터페이스 기반”

### CGLIB Proxy

- 클래스 상속 기반(바이트코드 생성)
- 인터페이스가 없어도 가능
- `final` 클래스/`final` 메서드는 프록시가 어려움

실무 팁:

- “왜 프록시가 인터페이스 타입이지?”를 이해하면 주입/캐스팅 문제를 줄일 수 있습니다.
- CGLIB를 강제로 쓰고 싶으면 보통 `spring.aop.proxy-target-class=true`를 사용합니다.

## 4) `@Transactional`이 동작하는 흐름(실전 버전)

`@Transactional`은 “메서드 호출 경계”에서 트랜잭션을 시작/종료하는 AOP입니다.
대략 이런 흐름으로 생각하면 됩니다.

1) 프록시가 메서드 호출을 가로챔  
2) `TransactionInterceptor`가 트랜잭션 속성(전파/읽기전용/롤백 규칙)을 읽음  
3) `PlatformTransactionManager`로 트랜잭션 시작(필요하면)  
4) 실제 메서드 실행  
5) 정상 종료면 commit, 예외면 rollback(규칙에 따라)  

```java
@Service
@Transactional
public class OrderService {
    public void placeOrder(...) { ... }
}
```

중요한 사실 2가지:

- 트랜잭션은 보통 **스레드 로컬(ThreadLocal)** 에 바인딩됩니다(같은 스레드에서 “같은 트랜잭션”을 공유).
- 따라서 비동기/다른 스레드로 넘어가면 기본적으로 같은 트랜잭션이 이어지지 않습니다.

## 5) self-invocation: “왜 안 먹지?”의 1등 원인

프록시 기반 AOP의 특성상, 같은 클래스 내부에서 `this.someMethod()`로 호출하면 프록시를 거치지 않을 수 있습니다.
그 결과 `@Transactional/@Cacheable/@Async` 같은 AOP가 적용되지 않습니다.

해결 방향(권장 순):

1) **역할 분리**: 트랜잭션 경계가 필요한 메서드를 다른 빈으로 분리  
2) `TransactionTemplate`로 경계를 코드로 명시(필요할 때만)  
3) `AopContext.currentProxy()` 같은 우회는 마지막(복잡도/제약이 큼)  

## 6) 적용 범위/제약: 이것만 기억하면 사고가 줄어든다

스프링 프록시 기반 AOP에서 자주 헷갈리는 제약:

- 프록시가 가로채는 건 “외부에서 들어오는 호출”입니다(내부 호출은 우회될 수 있음).
- 메서드 가시성/프록시 방식에 따라 적용이 달라질 수 있습니다(환경/설정에 따라 차이).
- 예외를 catch해서 삼키면 롤백되지 않을 수 있습니다(실패인데 commit되는 대표 케이스).

## 7) 어드바이스 순서(Order): 캐시/트랜잭션/보안이 섞일 때

현업 코드에는 `@Transactional`, `@Cacheable`, `@PreAuthorize`, 커스텀 로깅 AOP가 동시에 걸리는 경우가 많습니다.
이때 “어느 것이 먼저 실행되는지”에 따라 동작이 달라질 수 있습니다.

- 순서가 중요한 AOP는 `@Order`/`Ordered`로 의도를 명확히 하거나,
- 트랜잭션 경계를 더 바깥으로 둘지/안으로 둘지 설계 기준을 정해두는 편이 좋습니다.

## 연습(추천)

- `@Transactional`이 안 먹는 self-invocation 케이스를 일부러 만들고, “빈 분리”로 해결해보기
- 프록시 타입(JDK/CGLIB)을 바꿔보고(`spring.aop.proxy-target-class`) 빈 클래스가 어떻게 달라지는지 출력해보기
- 커스텀 `@LogExecutionTime` AOP를 만들어서 트랜잭션/캐시와 섞였을 때 실행 순서를 확인해보기
