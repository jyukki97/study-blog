---
title: "Spring IoC/DI 핵심: 컨테이너, 빈 생명주기, 의존성 주입 이해하기"
date: 2025-10-18
draft: false
topic: "Spring"
tags: ["Spring", "IoC", "DI", "Bean", "ApplicationContext", "Dependency Injection"]
categories: ["Backend Deep Dive"]
description: "Spring의 핵심인 IoC 컨테이너와 DI(의존성 주입) 원리를 이해하고, 빈 생명주기와 스코프를 실무 관점으로 정리"
module: "spring-core"
quizzes:
  - question: "Spring Framework에서 '제어의 역전(IoC)'이 의미하는 바로 가장 적절한 것은?"
    options:
      - "개발자가 `new` 키워드로 직접 객체를 생성하고 연결한다."
      - "프로그램의 제어 흐름과 객체(Bean)의 생명주기 관리를 개발자가 아닌 프레임워크(컨테이너)가 담당한다."
      - "모든 코드가 순차적으로 실행된다."
      - "데이터베이스가 애플리케이션의 흐름을 제어한다."
    answer: 1
    explanation: "IoC(Inversion of Control)는 객체의 생성, 의존성 주입, 생명주기 관리 등 프로그램의 흐름 제어권을 프레임워크에 위임하는 것입니다."

  - question: "다음 중 의존성 주입(DI) 방식 중, Spring과 전문가들이 가장 권장하는 방식은?"
    options:
      - "필드 주입 (Field Injection, @Autowired)"
      - "세터 주입 (Setter Injection)"
      - "생성자 주입 (Constructor Injection)"
      - "메서드 주입 (Method Injection)"
    answer: 2
    explanation: "생성자 주입은 불변성(final) 보장, 테스트 용이성(POJO 테스트 가능), 순환 참조 방지(컴파일/로딩 시점 감지), 필수 의존성 명확화 등의 장점이 있습니다."

  - question: "Spring에서 빈(Bean)으로 등록된 클래스 A가 B에 의존하고, B가 다시 A에 의존하는 '순환 참조(Circular Dependency)'가 발생했을 때, 생성자 주입을 사용하면 어떤 일이 발생하는가?"
    options:
      - "정상적으로 실행된다."
      - "애플리케이션 구동 시점(또는 컴파일 시점)에 에러(`BeanCurrentlyInCreationException`)가 발생하여 문제를 즉시 알 수 있다."
      - "무한 루프에 빠져 서버가 멈춘다."
      - "Spring이 알아서 하나를 삭제한다."
    answer: 1
    explanation: "생성자 주입은 빈 생성 시점에 모든 의존성을 주입해야 하므로, 순환 참조가 있으면 객체를 생성할 수 없어 즉시 에러를 발생시킵니다. (필드/세터 주입은 구동은 되지만 런타임에 문제 발생 가능)"

  - question: "Spring Boot에서 컴포넌트 스캔(Component Scan)을 통해 빈을 자동 등록하기 위해 클래스에 붙여야 하는 애노테이션이 아닌 것은?"
    options:
      - "@Controller"
      - "@Service"
      - "@Repository"
      - "@Autowired"
    answer: 3
    explanation: "`@Autowired`는 의존성을 주입받을 때 사용하는 애노테이션이고, 빈으로 등록(스캔 대상 지정)하려면 `@Component` 또는 그 특화 애노테이션(`@Controller`, `@Service`, `@Repository`, `@Configuration`)을 붙여야 합니다."

  - question: "다음 중 빈(Bean)의 생명주기 콜백과 관련하여, 의존성 주입이 끝난 후 초기화 작업을 수행하기 위해 사용하는 애노테이션은?"
    options:
      - "@PostConstruct"
      - "@PreDestroy"
      - "@Bean"
      - "@Component"
    answer: 0
    explanation: "`@PostConstruct`는 의존성 주입이 완료된 직후 호출되어 빈의 초기화 작업을 수행하는 표준 애노테이션입니다."

  - question: "같은 타입의 빈이 2개 이상 있을 때, `NoUniqueBeanDefinitionException`을 방지하기 위한 방법이 아닌 것은?"
    options:
      - "우선순위를 높일 빈에 `@Primary`를 붙인다."
      - "주입받는 곳에서 `@Qualifier(\"빈이름\")`을 사용한다."
      - "주입받는 변수명(파라미터명)을 빈 이름과 일치시킨다."
      - "모든 빈에 `@Autowired`를 붙인다."
    answer: 3
    explanation: "모든 빈에 `@Autowired`를 붙인다고 해결되지 않습니다. `@Primary`, `@Qualifier`, 혹은 변수명 매칭을 통해 어떤 빈을 주입할지 명확히 지정해야 합니다."
study_order: 101
---

## 이 글에서 얻는 것

- **IoC(제어의 역전)와 DI(의존성 주입)의 개념**을 이해하고, 왜 Spring이 이를 사용하는지 설명할 수 있습니다.
- **ApplicationContext와 빈(Bean) 등록/관리** 방식을 알고, 컴포넌트 스캔과 명시적 설정의 차이를 구분합니다.
- **빈의 생명주기**(초기화/소멸)와 **주입 방식**(생성자/필드/세터)의 차이를 이해합니다.
- **순환 참조, 빈 중복 등 흔한 문제**를 해결할 수 있습니다.

## 0) IoC/DI는 "객체 생성과 연결을 프레임워크에 맡긴다"

### 전통적인 방식 (개발자가 직접 제어)

```java
public class OrderService {
    private OrderRepository repository = new OrderRepository();  // 직접 생성
    private EmailService emailService = new EmailService();      // 직접 생성

    public void createOrder(Order order) {
        repository.save(order);
        emailService.sendConfirmation(order);
    }
}
```

**문제점:**
- OrderService가 구체적인 구현(OrderRepository, EmailService)에 강하게 결합
- 테스트 시 Mock으로 교체 불가
- 설정 변경 시 코드 수정 필요

### Spring 방식 (프레임워크가 제어)

```java
@Service
public class OrderService {
    private final OrderRepository repository;
    private final EmailService emailService;

    // Spring이 자동으로 주입
    public OrderService(OrderRepository repository, EmailService emailService) {
        this.repository = repository;
        this.emailService = emailService;
    }

    public void createOrder(Order order) {
        repository.save(order);
        emailService.sendConfirmation(order);
    }
}
```

**장점:**
- OrderService는 인터페이스만 의존 (느슨한 결합)
- 테스트 시 Mock 객체 주입 가능
- 설정만 변경하면 구현체 교체 가능

## 1) IoC (Inversion of Control): 제어의 역전

**IoC란?**
- 객체의 생성, 생명주기 관리를 **개발자가 아닌 프레임워크(컨테이너)가 담당**
- "내가 객체를 만드는 게 아니라, 프레임워크가 만들어서 나에게 준다"

**IoC 컨테이너 역할:**
1. 빈(Bean) 생성
2. 의존성 주입 (DI)
3. 빈 생명주기 관리
4. 설정 메타데이터 읽기 (@Configuration, XML 등)

## 2) DI (Dependency Injection): 의존성 주입

### 2-1) 의존성 주입의 3가지 방식

#### 방식 1: 생성자 주입 (권장 ⭐)

```java
@Service
public class OrderService {
    private final OrderRepository repository;
    private final EmailService emailService;

    // 생성자가 하나면 @Autowired 생략 가능 (Spring 4.3+)
    public OrderService(OrderRepository repository, EmailService emailService) {
        this.repository = repository;
        this.emailService = emailService;
    }
}
```

**장점:**
- **불변성(immutability)**: final로 선언 가능
- **테스트 용이**: new로 직접 생성 가능
- **순환 참조 방지**: 컴파일 타임에 감지
- **필수 의존성 명확**: 생성자 파라미터로 명시

#### 방식 2: 필드 주입 (비권장 ⚠️)

```java
@Service
public class OrderService {
    @Autowired
    private OrderRepository repository;  // 리플렉션으로 주입

    @Autowired
    private EmailService emailService;
}
```

**단점:**
- final 선언 불가 (가변 상태)
- 테스트 시 의존성 주입이 어려움
- 순환 참조 발견이 늦음 (런타임)
- IntelliJ 경고: "Field injection is not recommended"

**언제 사용:**
- 테스트 코드에서 @MockBean 사용 시 (Spring Boot Test)
- 레거시 코드 유지보수 시

#### 방식 3: 세터 주입

```java
@Service
public class OrderService {
    private OrderRepository repository;

    @Autowired
    public void setRepository(OrderRepository repository) {
        this.repository = repository;
    }
}
```

**언제 사용:**
- 선택적 의존성 (optional dependency)
- 런타임에 의존성 변경 필요 시 (드뭄)

### 2-2) @Autowired의 동작 원리

```java
@Service
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) {
        this.repository = repository;  // Spring이 자동으로 주입
    }
}

// Spring이 하는 일:
// 1. OrderRepository 타입의 빈 검색
// 2. 찾으면 생성자에 전달
// 3. 못 찾으면 NoSuchBeanDefinitionException
// 4. 여러 개 찾으면 NoUniqueBeanDefinitionException
```

**여러 개의 빈이 있을 때 해결 방법:**

```java
// 방법 1: @Primary (기본 빈 지정)
@Primary
@Repository
public class MySQLOrderRepository implements OrderRepository { }

@Repository
public class MongoOrderRepository implements OrderRepository { }

// 방법 2: @Qualifier (이름으로 지정)
@Service
public class OrderService {
    public OrderService(@Qualifier("mySQLOrderRepository") OrderRepository repository) {
        this.repository = repository;
    }
}

// 방법 3: 빈 이름으로 주입
@Service
public class OrderService {
    public OrderService(OrderRepository mySQLOrderRepository) {  // 변수명과 빈 이름 일치
        this.repository = mySQLOrderRepository;
    }
}
```

## 3) 빈(Bean) 등록 방법

### 3-1) 컴포넌트 스캔 (자동 등록)

```java
// @Component 기반 자동 스캔
@Component
public class EmailService { }

// @Component의 특화 버전들
@Service        // 비즈니스 로직
@Repository     // 데이터 접근 (예외 변환 추가)
@Controller     // MVC 컨트롤러
@RestController // REST API (@Controller + @ResponseBody)
@Configuration  // 설정 클래스
```

```java
// 스캔 범위 지정
@SpringBootApplication  // 기본적으로 현재 패키지 이하 스캔
// = @Configuration + @EnableAutoConfiguration + @ComponentScan

@ComponentScan(basePackages = "com.example.myapp")  // 명시적 지정
@ComponentScan(basePackageClasses = MyMarker.class) // 타입 세이프
```

### 3-2) Java Config (@Bean, 명시적 등록)

```java
@Configuration
public class AppConfig {

    @Bean
    public OrderService orderService(OrderRepository repository) {
        return new OrderService(repository);  // 직접 생성
    }

    @Bean
    public OrderRepository orderRepository() {
        return new MySQLOrderRepository();
    }

    // 외부 라이브러리 빈 등록
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.configure(SerializationFeature.INDENT_OUTPUT, true);
        return mapper;
    }
}
```

**컴포넌트 스캔 vs Java Config:**

| 구분 | 컴포넌트 스캔 | Java Config |
|------|--------------|-------------|
| 사용 | 내가 만든 클래스 | 외부 라이브러리, 복잡한 설정 |
| 장점 | 간편, 자동화 | 명시적, 세밀한 제어 |
| 단점 | 설정이 분산됨 | 코드가 길어짐 |

## 4) 빈의 생명주기 (Lifecycle)

```
스프링 컨테이너 시작
    ↓
빈 인스턴스 생성
    ↓
의존성 주입
    ↓
초기화 콜백 (@PostConstruct, InitializingBean)
    ↓
빈 사용
    ↓
소멸 전 콜백 (@PreDestroy, DisposableBean)
    ↓
스프링 컨테이너 종료
```

### 4-1) 초기화/소멸 콜백

```java
@Component
public class DatabaseConnection {

    private Connection connection;

    // 방법 1: @PostConstruct / @PreDestroy (권장)
    @PostConstruct
    public void init() {
        System.out.println("Connection 초기화");
        connection = createConnection();
    }

    @PreDestroy
    public void cleanup() {
        System.out.println("Connection 종료");
        if (connection != null) {
            connection.close();
        }
    }

    // 방법 2: InitializingBean / DisposableBean (비권장)
    @Override
    public void afterPropertiesSet() throws Exception {
        // 초기화
    }

    @Override
    public void destroy() throws Exception {
        // 소멸
    }

    // 방법 3: @Bean의 initMethod / destroyMethod
    @Bean(initMethod = "init", destroyMethod = "cleanup")
    public DatabaseConnection databaseConnection() {
        return new DatabaseConnection();
    }
}
```

## 5) ApplicationContext: IoC 컨테이너의 핵심

```java
@SpringBootApplication
public class MyApplication {
    public static void main(String[] args) {
        // ApplicationContext 생성 (Spring Boot가 자동으로 해줌)
        ApplicationContext context = SpringApplication.run(MyApplication.class, args);

        // 빈 조회
        OrderService orderService = context.getBean(OrderService.class);
        OrderRepository repository = context.getBean("orderRepository", OrderRepository.class);

        // 빈 존재 확인
        boolean exists = context.containsBean("orderService");

        // 모든 빈 이름 조회
        String[] beanNames = context.getBeanDefinitionNames();
    }
}
```

**주요 메서드:**
- `getBean(Class<T>)`: 타입으로 빈 조회
- `getBean(String, Class<T>)`: 이름 + 타입으로 조회
- `containsBean(String)`: 빈 존재 확인
- `getBeanDefinitionNames()`: 모든 빈 이름

## 6) 자주 하는 실수와 해결법

### 6-1) 순환 참조 (Circular Dependency)

```java
// ❌ 순환 참조
@Service
public class AService {
    @Autowired
    private BService bService;  // A → B
}

@Service
public class BService {
    @Autowired
    private AService aService;  // B → A (순환!)
}

// 에러: The dependencies of some of the beans in the application context form a cycle
```

**해결 방법:**

```java
// 방법 1: 설계 재검토 (가장 좋음)
// A와 B의 책임을 분리하거나, 중간 인터페이스 도입

// 방법 2: @Lazy 사용 (임시 방편)
@Service
public class AService {
    @Autowired
    @Lazy  // B를 실제 사용할 때까지 주입 지연
    private BService bService;
}

// 방법 3: 세터 주입 (비권장)
@Service
public class AService {
    private BService bService;

    @Autowired
    public void setBService(BService bService) {
        this.bService = bService;
    }
}
```

### 6-2) 빈을 찾을 수 없음 (NoSuchBeanDefinitionException)

```java
// ❌ @Component 누락
public class OrderService { }  // 빈으로 등록 안 됨!

// ✅ @Component 계열 어노테이션 추가
@Service
public class OrderService { }
```

```java
// ❌ 컴포넌트 스캔 범위 밖
// MyApplication: com.example.app
// OrderService: com.example.other  ← 스캔 안 됨!

// ✅ 스캔 범위 확장
@ComponentScan(basePackages = {"com.example.app", "com.example.other"})
```

### 6-3) 여러 빈이 발견됨 (NoUniqueBeanDefinitionException)

```java
// ❌ 같은 타입의 빈 여러 개
@Repository
public class MySQLOrderRepository implements OrderRepository { }

@Repository
public class MongoOrderRepository implements OrderRepository { }

// 에러: expected single matching bean but found 2

// ✅ @Primary 또는 @Qualifier 사용
@Primary
@Repository
public class MySQLOrderRepository implements OrderRepository { }
```

## 7) 실전 패턴

### 7-1) 생성자 주입 + Lombok

```java
@Service
@RequiredArgsConstructor  // final 필드로 생성자 자동 생성
public class OrderService {
    private final OrderRepository repository;
    private final EmailService emailService;

    // 생성자 자동 생성됨:
    // public OrderService(OrderRepository repository, EmailService emailService) { ... }
}
```

### 7-2) 조건부 빈 등록

```java
@Configuration
public class DataSourceConfig {

    @Bean
    @ConditionalOnProperty(name = "db.type", havingValue = "mysql")
    public DataSource mysqlDataSource() {
        return new MySQLDataSource();
    }

    @Bean
    @ConditionalOnProperty(name = "db.type", havingValue = "postgres")
    public DataSource postgresDataSource() {
        return new PostgresDataSource();
    }
}
```

### 7-3) 프로파일별 빈 등록

```java
@Configuration
@Profile("dev")
public class DevConfig {
    @Bean
    public EmailService emailService() {
        return new FakeEmailService();  // 개발 환경에서는 실제 메일 안 보냄
    }
}

@Configuration
@Profile("prod")
public class ProdConfig {
    @Bean
    public EmailService emailService() {
        return new RealEmailService();  // 운영 환경에서는 실제 메일 발송
    }
}
```

## 연습 (추천)

1. **간단한 프로젝트 구성**
   - Controller → Service → Repository 구조
   - 생성자 주입으로 의존성 연결
   - @PostConstruct로 초기화 로그 출력

2. **여러 구현체 테스트**
   - 인터페이스 1개 + 구현체 2개 생성
   - @Primary / @Qualifier로 선택

3. **순환 참조 재현 및 해결**
   - 의도적으로 순환 참조 만들기
   - @Lazy로 해결

4. **빈 조회 연습**
   - ApplicationContext로 빈 목록 출력
   - 특정 타입의 모든 빈 조회

## 요약: 스스로 점검할 것

- IoC와 DI의 개념을 설명할 수 있다
- 생성자 주입이 권장되는 이유를 3가지 이상 말할 수 있다
- 컴포넌트 스캔과 Java Config의 차이를 설명할 수 있다
- 빈의 생명주기(초기화/소멸)를 제어할 수 있다
- 순환 참조, 빈 중복 등의 문제를 해결할 수 있다

## 다음 단계

- Spring 빈 스코프와 프록시: `/learning/deep-dive/deep-dive-spring-bean-scopes/`
- Spring AOP: `/learning/deep-dive/deep-dive-spring-aop/`
- Spring 트랜잭션: `/learning/deep-dive/deep-dive-spring-transaction/`
