---
title: "Spring AOP (Part 1: 개념과 기초)"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "AOP", "Proxy", "Pointcut", "Advice"]
categories: ["Backend Deep Dive"]
description: "Spring AOP의 동작(프록시)과 포인트컷/어드바이스를 이해하고, self-invocation 같은 실전 함정을 피하는 방법"
module: "spring-core"
quizzes:
  - question: "Spring AOP가 주로 해결하고자 하는 문제 영역인 '횡단 관심사(Cross-Cutting Concerns)'의 대표적인 예시가 아닌 것은?"
    options:
      - "로깅 (Logging)"
      - "트랜잭션 관리 (Transaction Management)"
      - "비즈니스 로직 (Business Logic)"
      - "보안/인증 (Security)"
    answer: 2
    explanation: "비즈니스 로직은 애플리케이션의 핵심 관심사(Core Concern)이며, AOP는 이러한 핵심 로직 곳곳에 흩어져 있는 부가 기능(횡단 관심사)을 분리하여 모듈화하는 기술입니다."

  - question: "Spring AOP의 기본 구현 방식인 '프록시(Proxy) 패턴'의 동작 원리로 올바른 것은?"
    options:
      - "컴파일 시점에 바이트코드를 조작하여 코드를 심는다."
      - "클라이언트가 대상 객체(Target)를 직접 호출하면, 대상 객체가 알아서 Advice를 실행한다."
      - "클라이언트는 프록시 객체를 호출하고, 프록시가 부가 기능(Advice)을 실행한 후 실제 대상 객체(Target)를 호출(위임)한다."
      - "JVM 실행 시점에 자바 에이전트가 클래스를 로딩하며 조작한다."
    answer: 2
    explanation: "Spring AOP는 런타임에 프록시 객체를 생성하여 빈으로 등록하며, 클라이언트의 호출을 가로채서 부가 기능을 실행한 뒤 실제 타겟 객체를 호출합니다."

  - question: "Spring AOP에서 'Self-Invocation(자기 호출)' 문제가 발생하는 이유는?"
    options:
      - "프록시 객체가 아닌, 실제 객체(this) 내부에서 자신의 다른 메서드를 호출하면 프록시를 거치지 않게 되어 AOP가 적용되지 않기 때문이다."
      - "Spring 컨테이너가 내부 호출을 감지하여 차단하기 때문이다."
      - "메서드가 private이라서 접근할 수 없기 때문이다."
      - "트랜잭션 관리자가 락을 걸기 때문이다."
    answer: 0
    explanation: "AOP는 프록시를 통해 들어오는 외부 호출에만 적용됩니다. 객체 내부에서 `this.method()`로 호출하면 프록시를 통하지 않고 다이렉트로 실행되므로 트랜잭션 등이 동작하지 않습니다."

  - question: "다음 중 메서드 실행 전, 후, 예외 발생 시점 등 모든 시점을 제어할 수 있으며, `proceed()`를 호출하여 타겟 메서드 실행 여부까지 결정할 수 있는 가장 강력한 Advice는?"
    options:
      - "@Before"
      - "@After"
      - "@Around"
      - "@AfterReturning"
    answer: 2
    explanation: "`@Around`는 타겟 메서드 실행 전후를 감싸는 형태이므로, 실행 시간을 측정하거나 결과값을 조작하고, 심지어 실행을 건너뛸 수도 있는 가장 강력한 기능을 제공합니다."

  - question: "Spring Boot 2.0 이상에서 기본적으로 사용하며, 인터페이스가 없어도 클래스 상속을 통해 프록시를 생성하는 기술은?"
    options:
      - "JDK Dynamic Proxy"
      - "CGLIB (Code Generation Library)"
      - "AspectJ"
      - "Java Agent"
    answer: 1
    explanation: "Spring Boot는 기본적으로 CGLIB(`proxyTargetClass=true`)를 사용하여 구체 클래스 기반의 프록시를 생성합니다. (JDK Proxy는 인터페이스가 필수입니다.)"
study_order: 142
---

## 이 글에서 얻는 것

- Spring AOP가 “마법”이 아니라 **프록시 기반**이라는 점을 이해하고, 왜 특정 상황에서 동작하지 않는지 설명할 수 있습니다.
- 포인트컷/어드바이스/조인포인트 같은 용어를 외우는 수준을 넘어, 실무에서 로그/트랜잭션/권한/메트릭에 적용할 수 있습니다.
- self-invocation, final, 실행 순서(@Order) 같은 함정을 알고 설계/디버깅 실수를 줄일 수 있습니다.

## 들어가며

AOP (Aspect-Oriented Programming, 관점 지향 프로그래밍)는 Spring Framework의 핵심 기능 중 하나입니다. 횡단 관심사(Cross-Cutting Concerns)를 모듈화하여 코드 중복을 제거하고 유지보수성을 높일 수 있습니다.

---

## 1. AOP 핵심 개념

### 1.1 횡단 관심사 (Cross-Cutting Concerns)

**문제 상황:**
```java
// 모든 서비스 메서드에 로깅 코드가 중복
@Service
public class UserService {
    public User findUser(Long id) {
        log.info("findUser called with id: {}", id);  // 중복 1
        try {
            User user = userRepository.findById(id);
            log.info("findUser returned: {}", user);  // 중복 2
            return user;
        } catch (Exception e) {
            log.error("findUser failed", e);  // 중복 3
            throw e;
        }
    }

    public void createUser(User user) {
        log.info("createUser called");  // 중복 1
        try {
            userRepository.save(user);
            log.info("createUser completed");  // 중복 2
        } catch (Exception e) {
            log.error("createUser failed", e);  // 중복 3
            throw e;
        }
    }
}
```

**AOP 적용 후:**
```java
// 비즈니스 로직만 집중
@Service
public class UserService {
    public User findUser(Long id) {
        return userRepository.findById(id);
    }

    public void createUser(User user) {
        userRepository.save(user);
    }
}

// 로깅 관심사를 Aspect로 분리
@Aspect
@Component
public class LoggingAspect {
    @Around("execution(* com.example.service.*.*(..))")
    public Object logMethod(ProceedingJoinPoint joinPoint) throws Throwable {
        log.info("Method called: {}", joinPoint.getSignature());
        try {
            Object result = joinPoint.proceed();
            log.info("Method returned: {}", result);
            return result;
        } catch (Exception e) {
            log.error("Method failed", e);
            throw e;
        }
    }
}
```

### 1.2 AOP 용어

```
Target Object (대상 객체)
│
├─ Join Point (결합점)
│   └─ 메서드 실행, 필드 접근 등
│       Advice를 적용할 수 있는 모든 지점
│
├─ Pointcut (포인트컷)
│   └─ Join Point 중 실제로 Advice가 적용될 지점
│       예: "execution(* com.example.service.*.*(..))"
│
├─ Advice (어드바이스)
│   └─ 실제로 실행되는 코드
│       - Before: 메서드 실행 전
│       - After: 메서드 실행 후
│       - Around: 메서드 실행 전후
│
├─ Aspect (관점)
│   └─ Advice + Pointcut의 조합
│       @Aspect 클래스
│
└─ Weaving (위빙)
    └─ Aspect를 Target에 적용하는 과정
        - 컴파일 타임 (AspectJ)
        - 로드 타임 (AspectJ)
        - 런타임 (Spring AOP - Proxy 생성)
```

---


---

👉 **[다음 편: Spring AOP (Part 2: Proxy 동작 원리, 실무)](/learning/deep-dive/deep-dive-spring-aop-part2/)**
