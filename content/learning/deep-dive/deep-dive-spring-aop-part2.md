---
title: "Spring AOP (Part 2: Proxy 동작 원리, 실무)"
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

## 2. Spring AOP 동작 원리 (Proxy 패턴)

### 2.1 JDK Dynamic Proxy vs CGLIB

**JDK Dynamic Proxy (인터페이스 기반):**
```java
// 1. 인터페이스 정의
public interface UserService {
    User findUser(Long id);
}

// 2. 실제 구현체
@Service
public class UserServiceImpl implements UserService {
    @Override
    public User findUser(Long id) {
        return userRepository.findById(id);
    }
}

// 3. Spring이 생성하는 Proxy
public class UserServiceProxy implements UserService {
    private UserServiceImpl target;

    @Override
    public User findUser(Long id) {
        // Before Advice
        log.info("Before findUser");

        // Target 메서드 호출
        User result = target.findUser(id);

        // After Advice
        log.info("After findUser");

        return result;
    }
}

// 4. Bean 주입 시 Proxy가 주입됨
@Autowired
private UserService userService;  // ← Proxy 주입 (실제 타입: UserServiceProxy)
```

**CGLIB (클래스 기반):**
```java
// 1. 구체 클래스만 있음 (인터페이스 없음)
@Service
public class UserService {
    public User findUser(Long id) {
        return userRepository.findById(id);
    }
}

// 2. Spring이 생성하는 Proxy (CGLIB)
public class UserService$$EnhancerBySpringCGLIB extends UserService {
    private UserService target;

    @Override
    public User findUser(Long id) {
        // Before Advice
        log.info("Before findUser");

        // Target 메서드 호출
        User result = super.findUser(id);  // 부모 클래스 호출

        // After Advice
        log.info("After findUser");

        return result;
    }
}
```

**Proxy 선택 기준:**
```
JDK Dynamic Proxy:
- 인터페이스가 있는 경우
- 빠른 Proxy 생성
- Java 표준 기술

CGLIB:
- 인터페이스가 없는 경우
- 클래스 상속으로 Proxy 생성
- @Configuration 클래스 (Spring은 CGLIB 사용)
- Spring Boot 2.0+: 기본값

설정:
spring.aop.proxy-target-class=true  # CGLIB 강제 사용
spring.aop.proxy-target-class=false # JDK Proxy 사용 (인터페이스 있을 때)
```

### 2.2 Proxy 확인 방법

```java
@SpringBootTest
public class ProxyTest {
    @Autowired
    private UserService userService;

    @Test
    public void checkProxy() {
        System.out.println("Proxy class: " + userService.getClass());
        // 출력: com.example.service.UserService$$EnhancerBySpringCGLIB$$12345

        // Proxy 여부 확인
        boolean isProxy = AopUtils.isAopProxy(userService);
        System.out.println("Is Proxy: " + isProxy);  // true

        // CGLIB Proxy 확인
        boolean isCglibProxy = AopUtils.isCglibProxy(userService);
        System.out.println("Is CGLIB Proxy: " + isCglibProxy);  // true
    }
}
```

---

## 3. Pointcut Expression (포인트컷 표현식)

### 3.1 execution 지시자

**기본 문법:**
```
execution(modifiers? return-type declaring-type?method-name(param-types) throws?)

modifiers: public, private 등 (생략 가능)
return-type: 반환 타입 (* = 모든 타입)
declaring-type: 패키지 및 클래스 (생략 가능)
method-name: 메서드 이름 (* = 모든 메서드)
param-types: 파라미터 타입 (.. = 모든 파라미터)
throws: 예외 타입 (생략 가능)
```

**예시:**
```java
@Aspect
@Component
public class PointcutExamples {

    // 1. 모든 public 메서드
    @Around("execution(public * *(..))")
    public Object allPublicMethods(ProceedingJoinPoint joinPoint) { }

    // 2. com.example.service 패키지의 모든 메서드
    @Around("execution(* com.example.service.*.*(..))")
    public Object allServiceMethods(ProceedingJoinPoint joinPoint) { }

    // 3. com.example.service 패키지와 하위 패키지의 모든 메서드
    @Around("execution(* com.example.service..*.*(..))")
    public Object allServiceAndSubPackages(ProceedingJoinPoint joinPoint) { }

    // 4. UserService의 모든 메서드
    @Around("execution(* com.example.service.UserService.*(..))")
    public Object allUserServiceMethods(ProceedingJoinPoint joinPoint) { }

    // 5. 메서드 이름이 find로 시작하는 모든 메서드
    @Around("execution(* find*(..))")
    public Object allFindMethods(ProceedingJoinPoint joinPoint) { }

    // 6. 파라미터가 Long 타입 1개인 메서드
    @Around("execution(* *(Long))")
    public Object methodsWithLongParam(ProceedingJoinPoint joinPoint) { }

    // 7. 파라미터가 Long으로 시작하는 메서드
    @Around("execution(* *(Long, ..))")
    public Object methodsStartingWithLong(ProceedingJoinPoint joinPoint) { }

    // 8. User 타입을 반환하는 모든 메서드
    @Around("execution(com.example.domain.User *(..))")
    public Object methodsReturningUser(ProceedingJoinPoint joinPoint) { }
}
```

### 3.2 @annotation 지시자

**Custom Annotation 정의:**
```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface LogExecutionTime {
}
```

**Aspect 적용:**
```java
@Aspect
@Component
public class ExecutionTimeAspect {

    @Around("@annotation(LogExecutionTime)")
    public Object logExecutionTime(ProceedingJoinPoint joinPoint) throws Throwable {
        long startTime = System.currentTimeMillis();

        Object result = joinPoint.proceed();

        long endTime = System.currentTimeMillis();
        long executionTime = endTime - startTime;

        log.info("{} executed in {}ms",
            joinPoint.getSignature(),
            executionTime
        );

        return result;
    }
}
```

**사용:**
```java
@Service
public class UserService {

    @LogExecutionTime  // ✅ Aspect 적용
    public User findUser(Long id) {
        return userRepository.findById(id);
    }

    public void createUser(User user) {
        userRepository.save(user);  // ❌ Aspect 미적용
    }
}
```

### 3.3 Pointcut 조합

```java
@Aspect
@Component
public class CombinedPointcuts {

    // Pointcut 정의
    @Pointcut("execution(* com.example.service..*(..))")
    public void serviceLayer() {}

    @Pointcut("execution(* com.example.repository..*(..))")
    public void repositoryLayer() {}

    @Pointcut("@annotation(org.springframework.transaction.annotation.Transactional)")
    public void transactionalMethod() {}

    // 조합 1: AND (&&)
    @Around("serviceLayer() && transactionalMethod()")
    public Object serviceAndTransactional(ProceedingJoinPoint joinPoint) {
        // Service 계층의 @Transactional 메서드에만 적용
    }

    // 조합 2: OR (||)
    @Around("serviceLayer() || repositoryLayer()")
    public Object serviceOrRepository(ProceedingJoinPoint joinPoint) {
        // Service 또는 Repository 계층에 적용
    }

    // 조합 3: NOT (!)
    @Around("serviceLayer() && !transactionalMethod()")
    public Object serviceNotTransactional(ProceedingJoinPoint joinPoint) {
        // Service 계층 중 @Transactional이 없는 메서드
    }
}
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: Spring AOP (Part 1: 개념과 기초)](/learning/deep-dive/deep-dive-spring-aop/)**
