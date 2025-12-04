---
title: "Spring AOP 완벽 가이드 - 이론부터 실전까지"
date: 2025-01-26
topic: "Backend"
tags: ["Spring", "AOP", "Proxy", "트랜잭션", "로깅"]
categories: ["Backend"]
series: ["백엔드 심화 학습"]
series_order: 3
draft: true
---

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

## 4. Advice 타입

### 4.1 @Before (메서드 실행 전)

```java
@Aspect
@Component
@Slf4j
public class BeforeAdviceExample {

    @Before("execution(* com.example.service.UserService.createUser(..))")
    public void beforeCreateUser(JoinPoint joinPoint) {
        Object[] args = joinPoint.getArgs();
        User user = (User) args[0];

        log.info("Creating user: {}", user.getName());

        // 검증 로직 추가
        if (user.getAge() < 18) {
            throw new IllegalArgumentException("User must be at least 18 years old");
        }
    }
}
```

### 4.2 @AfterReturning (정상 반환 후)

```java
@Aspect
@Component
@Slf4j
public class AfterReturningAdviceExample {

    @AfterReturning(
        pointcut = "execution(* com.example.service.UserService.findUser(..))",
        returning = "user"  // 반환값 바인딩
    )
    public void afterReturningFindUser(JoinPoint joinPoint, User user) {
        log.info("User found: {}", user);

        // 통계 업데이트
        statisticsService.incrementUserFindCount(user.getId());
    }
}
```

### 4.3 @AfterThrowing (예외 발생 후)

```java
@Aspect
@Component
@Slf4j
public class AfterThrowingAdviceExample {

    @AfterThrowing(
        pointcut = "execution(* com.example.service.*.*(..))",
        throwing = "ex"  // 예외 바인딩
    )
    public void afterThrowingService(JoinPoint joinPoint, Exception ex) {
        log.error("Method {} threw exception: {}",
            joinPoint.getSignature(),
            ex.getMessage()
        );

        // Slack 알림
        slackService.sendAlert(
            "Exception in " + joinPoint.getSignature() + ": " + ex.getMessage()
        );
    }
}
```

### 4.4 @After (finally와 유사)

```java
@Aspect
@Component
@Slf4j
public class AfterAdviceExample {

    @After("execution(* com.example.service.*.*(..))")
    public void afterService(JoinPoint joinPoint) {
        // 성공/실패 여부와 관계없이 항상 실행
        log.info("Method {} completed", joinPoint.getSignature());

        // 리소스 정리
        cleanupResources();
    }
}
```

### 4.5 @Around (가장 강력, 메서드 실행 전후 제어)

```java
@Aspect
@Component
@Slf4j
public class AroundAdviceExample {

    @Around("execution(* com.example.service.*.*(..))")
    public Object aroundService(ProceedingJoinPoint joinPoint) throws Throwable {
        // 1. Before 로직
        log.info("Before method: {}", joinPoint.getSignature());
        long startTime = System.currentTimeMillis();

        Object result = null;
        try {
            // 2. 실제 메서드 실행
            result = joinPoint.proceed();

            // 3. AfterReturning 로직
            log.info("Method returned: {}", result);

        } catch (Exception e) {
            // 4. AfterThrowing 로직
            log.error("Method threw exception", e);
            throw e;

        } finally {
            // 5. After 로직
            long endTime = System.currentTimeMillis();
            log.info("Execution time: {}ms", endTime - startTime);
        }

        return result;
    }
}
```

**Advice 실행 순서:**
```
@Around (Before 부분)
    ↓
@Before
    ↓
Target 메서드 실행
    ↓
@AfterReturning (정상) 또는 @AfterThrowing (예외)
    ↓
@After
    ↓
@Around (After 부분)
```

---

## 5. 실전 예제

### 5.1 트랜잭션 로깅

```java
@Aspect
@Component
@Slf4j
public class TransactionLoggingAspect {

    @Around("@annotation(org.springframework.transaction.annotation.Transactional)")
    public Object logTransaction(ProceedingJoinPoint joinPoint) throws Throwable {
        String methodName = joinPoint.getSignature().toShortString();

        log.info("[TX START] {}", methodName);
        long startTime = System.currentTimeMillis();

        try {
            Object result = joinPoint.proceed();

            long endTime = System.currentTimeMillis();
            log.info("[TX COMMIT] {} ({}ms)", methodName, endTime - startTime);

            return result;

        } catch (Exception e) {
            log.error("[TX ROLLBACK] {} - {}", methodName, e.getMessage());
            throw e;
        }
    }
}
```

### 5.2 API 응답 시간 측정

```java
@Aspect
@Component
@Slf4j
public class PerformanceMonitoringAspect {

    @Autowired
    private MeterRegistry meterRegistry;

    @Around("@within(org.springframework.web.bind.annotation.RestController)")
    public Object monitorPerformance(ProceedingJoinPoint joinPoint) throws Throwable {
        String controllerName = joinPoint.getTarget().getClass().getSimpleName();
        String methodName = joinPoint.getSignature().getName();

        Timer.Sample sample = Timer.start(meterRegistry);

        try {
            return joinPoint.proceed();

        } finally {
            sample.stop(Timer.builder("api.response.time")
                .tag("controller", controllerName)
                .tag("method", methodName)
                .register(meterRegistry));
        }
    }
}
```

### 5.3 캐싱 Aspect

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Cacheable {
    String key();
    int ttl() default 3600;  // 기본 1시간
}

@Aspect
@Component
@Slf4j
public class CachingAspect {

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Around("@annotation(cacheable)")
    public Object cache(ProceedingJoinPoint joinPoint, Cacheable cacheable) throws Throwable {
        // 1. 캐시 키 생성
        String cacheKey = generateCacheKey(joinPoint, cacheable.key());

        // 2. 캐시 조회
        Object cachedValue = redisTemplate.opsForValue().get(cacheKey);
        if (cachedValue != null) {
            log.info("Cache hit: {}", cacheKey);
            return cachedValue;
        }

        // 3. 캐시 미스 → 메서드 실행
        log.info("Cache miss: {}", cacheKey);
        Object result = joinPoint.proceed();

        // 4. 캐시에 저장
        redisTemplate.opsForValue().set(
            cacheKey,
            result,
            Duration.ofSeconds(cacheable.ttl())
        );

        return result;
    }

    private String generateCacheKey(ProceedingJoinPoint joinPoint, String keyExpression) {
        // SpEL 또는 간단한 키 생성 로직
        Object[] args = joinPoint.getArgs();
        return keyExpression + ":" + Arrays.toString(args);
    }
}

// 사용
@Service
public class UserService {

    @Cacheable(key = "user", ttl = 1800)  // 30분
    public User findUser(Long id) {
        return userRepository.findById(id);
    }
}
```

### 5.4 재시도 (Retry) Aspect

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Retry {
    int maxAttempts() default 3;
    long delay() default 1000;  // ms
}

@Aspect
@Component
@Slf4j
public class RetryAspect {

    @Around("@annotation(retry)")
    public Object retryOnFailure(ProceedingJoinPoint joinPoint, Retry retry) throws Throwable {
        int maxAttempts = retry.maxAttempts();
        long delay = retry.delay();

        int attempt = 1;
        while (true) {
            try {
                return joinPoint.proceed();

            } catch (Exception e) {
                if (attempt >= maxAttempts) {
                    log.error("All {} retry attempts failed", maxAttempts);
                    throw e;
                }

                log.warn("Attempt {} failed: {}. Retrying in {}ms...",
                    attempt,
                    e.getMessage(),
                    delay
                );

                Thread.sleep(delay);
                attempt++;
            }
        }
    }
}

// 사용
@Service
public class ExternalApiService {

    @Retry(maxAttempts = 5, delay = 2000)
    public String callExternalApi() {
        // 외부 API 호출 (실패 시 재시도)
        return restTemplate.getForObject("https://api.example.com/data", String.class);
    }
}
```

---

## 6. AOP 주의사항

### 6.1 Self-Invocation 문제

```java
// ❌ 문제 코드
@Service
public class UserService {

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }

    public void registerUser(User user) {
        // Self-Invocation → Proxy를 거치지 않음!
        createUser(user);  // ❌ @Transactional 동작 안 함!
    }
}
```

**이유:**
```
this.createUser(user) 호출
→ Proxy가 아닌 실제 객체(this)의 메서드 호출
→ AOP 적용 안 됨!
```

**해결 방법 1: 메서드 분리**
```java
@Service
public class UserService {

    @Autowired
    private UserTransactionService transactionService;

    public void registerUser(User user) {
        // 다른 Bean의 메서드 호출 → Proxy를 거침
        transactionService.createUser(user);  // ✅ @Transactional 동작
    }
}

@Service
public class UserTransactionService {

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}
```

**해결 방법 2: self-injection (비권장)**
```java
@Service
public class UserService {

    @Autowired
    @Lazy  // 순환 참조 방지
    private UserService self;

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }

    public void registerUser(User user) {
        self.createUser(user);  // ✅ Proxy 호출
    }
}
```

### 6.2 final 메서드는 AOP 적용 불가 (CGLIB)

```java
@Service
public class UserService {

    // ❌ CGLIB는 final 메서드를 오버라이드할 수 없음
    public final User findUser(Long id) {
        return userRepository.findById(id);
    }
}
```

**해결:**
```java
// ✅ final 제거
public User findUser(Long id) {
    return userRepository.findById(id);
}
```

### 6.3 Aspect 실행 순서 제어

```java
// 여러 Aspect가 같은 Join Point에 적용될 때
@Aspect
@Order(1)  // 낮을수록 먼저 실행
@Component
public class SecurityAspect {
    @Around("execution(* com.example.service.*.*(..))")
    public Object checkSecurity(ProceedingJoinPoint joinPoint) { }
}

@Aspect
@Order(2)
@Component
public class LoggingAspect {
    @Around("execution(* com.example.service.*.*(..))")
    public Object log(ProceedingJoinPoint joinPoint) { }
}

// 실행 순서:
// SecurityAspect (Before) → LoggingAspect (Before)
//     → Target 메서드
// LoggingAspect (After) → SecurityAspect (After)
```

---

## 요약 체크리스트

### AOP 기본 개념
- [ ] 횡단 관심사 (Cross-Cutting Concerns): 로깅, 트랜잭션, 보안 등
- [ ] Target: Advice가 적용되는 대상 객체
- [ ] Join Point: Advice 적용 가능한 지점
- [ ] Pointcut: 실제 Advice가 적용되는 지점 선택
- [ ] Advice: 실행되는 코드 (Before, After, Around 등)
- [ ] Aspect: Pointcut + Advice

### Proxy 패턴
- [ ] JDK Dynamic Proxy: 인터페이스 기반
- [ ] CGLIB: 클래스 상속 기반 (Spring Boot 2.0+ 기본)
- [ ] Proxy 생성: 런타임에 동적으로 생성
- [ ] Bean 주입: Proxy 객체가 주입됨

### Pointcut Expression
- [ ] execution: 가장 많이 사용, 메서드 시그니처 기반
- [ ] @annotation: Custom Annotation 기반
- [ ] within: 특정 타입 내 모든 메서드
- [ ] 조합: &&, ||, ! 사용 가능

### Advice 타입
- [ ] @Before: 메서드 실행 전
- [ ] @AfterReturning: 정상 반환 후
- [ ] @AfterThrowing: 예외 발생 후
- [ ] @After: 항상 실행 (finally)
- [ ] @Around: 가장 강력, 전후 제어 가능

### 실전 활용
- [ ] 트랜잭션 로깅, 성능 모니터링
- [ ] 캐싱, 재시도(Retry) 로직
- [ ] API 응답 시간 측정
- [ ] 예외 알림 (Slack, Email)

### 주의사항
- [ ] Self-Invocation: 같은 클래스 메서드 호출 시 AOP 미적용
- [ ] final 메서드: CGLIB Proxy 불가
- [ ] @Order: 여러 Aspect 실행 순서 제어
- [ ] 성능: Around Advice는 반드시 proceed() 호출
