---
title: "Spring IoC 컨테이너 이해하기"
date: 2025-11-03
draft: false
topic: "Spring"
topic_icon: "🍃"
topic_description: "Spring Framework 학습 노트"
tags: ["Spring", "IoC", "DI", "Backend"]
categories: ["Development", "Learning"]
description: "Spring의 핵심 개념인 IoC(Inversion of Control)와 DI(Dependency Injection) 정리"
module: "spring-core"
study_order: 110
---

## 이 글에서 얻는 것

- IoC/DI가 “좋은 패턴”이라는 말의 진짜 의미(객체 그래프/테스트/확장)를 설명할 수 있습니다.
- 스프링 컨테이너가 하는 일(빈 등록, 의존성 주입, 생명주기, 스코프)을 큰 그림으로 이해합니다.
- `@Component`/`@Configuration`/`@Bean`의 차이를 알고, 어떤 상황에 어떤 방식을 쓰면 좋은지 기준이 생깁니다.
- 스프링에서 자주 겪는 문제(순환 참조, 다중 구현체 주입, 스코프/프록시)를 예방하고 디버깅할 수 있습니다.

## 1) IoC란 무엇인가(“제어의 역전”을 실무 언어로)

IoC(Inversion of Control)는 “내가 직접 new 해서 연결하던 의존성”을, 프레임워크(컨테이너)가 대신 구성해주는 것입니다.

핵심 효과:

- 객체 생성/연결(구성)과 비즈니스 로직을 분리해서 코드가 단순해집니다.
- 테스트에서 의존성을 바꿔 끼우기 쉬워집니다(대체 구현/Mock).
- 구현체가 늘어나도 “조립”만 바꾸면 되니 확장에 유리합니다.

## 2) DI(의존성 주입): IoC를 구현하는 대표 방식

스프링에서 DI는 “생성자 주입”을 기본으로 생각하면 대부분의 문제가 줄어듭니다.

### 생성자 주입(권장)

```java
@Service
public class UserService {
    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }
}
```

왜 권장할까?

- 의존성이 명확하게 드러나고(생성자 시그니처),
- `final`로 불변을 만들기 쉽고,
- 테스트에서 필요한 의존성을 강제로 주입해야 하므로 “숨은 의존성”이 줄어듭니다.

### 필드 주입(비권장)

```java
@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;
}
```

필드 주입은 테스트/리팩터링에서 문제가 생기기 쉽습니다. (의존성이 숨고, 생성 시점에 강제되지 않습니다.)

## Bean 등록 방법

스프링 컨테이너가 관리하는 객체를 “빈(Bean)”이라고 부릅니다.
빈을 등록하는 방식은 크게 두 가지입니다.

### 3-1) 컴포넌트 스캔(`@Component` 계열)

```java
@Component
@Service
@Repository
@Controller
```

장점:

- 애플리케이션 코드를 작성하는 흐름과 자연스럽게 맞습니다.

주의:

- “왜 이 빈이 등록됐지?”가 헷갈릴 수 있습니다(패키지 스캔 범위/조건부 설정 등).

### 3-2) 자바 설정(`@Configuration` + `@Bean`)

```java
@Configuration
public class AppConfig {
    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();
    }
}
```

장점:

- 외부 라이브러리 객체를 빈으로 만들 때 좋고, “조립”을 명시적으로 관리하기 쉽습니다.

중요 포인트(많이 헷갈리는 부분):

- `@Configuration`은 내부적으로 프록시를 써서 `@Bean` 메서드가 “한 번만 생성된 싱글톤”처럼 동작하게 만듭니다.
- 같은 코드라도 `@Configuration`이 아니라 일반 `@Component`에서 `@Bean`을 만들면 동작이 달라질 수 있습니다.

## 4) 빈 생명주기(큰 흐름만)

스프링 컨테이너는 대략 다음 순서로 빈을 준비합니다.

1) 빈 정의(BeanDefinition) 등록  
2) 인스턴스 생성(필요 시 프록시 포함)  
3) 의존성 주입  
4) 초기화 콜백(`@PostConstruct` 등)  
5) 애플리케이션 시작 완료 후 사용 가능  

이 흐름을 알고 있으면 “왜 아직 의존성이 null이지?”, “왜 프록시가 끼어 있지?” 같은 질문에 답하기 쉬워집니다.

## 5) 자주 겪는 문제와 해결 힌트

### 5-1) 순환 참조(Circular Dependency)

생성자 주입에서 순환 참조가 나면 대부분 설계 신호입니다. 책임을 분리하거나 의존 방향을 바꾸는 게 근본 해결입니다.

### 5-2) 구현체가 여러 개일 때(주입 모호성)

- 하나를 기본으로 쓰려면 `@Primary`
- 명시적으로 고르려면 `@Qualifier`

### 5-3) 스코프와 프록시

기본 스코프는 singleton입니다. 요청/세션 스코프 같은 빈을 싱글톤 빈에 주입하면 프록시가 필요할 수 있습니다.

## 6) 디버깅 팁(“이 빈이 왜 생겼지?”)

- Actuator의 `beans` 엔드포인트로 빈 목록/의존성을 확인
- `--debug`로 조건부 자동설정이 왜 켜졌는지(ConditionEvaluationReport) 확인
- IDE에서 “빈 탐색”이 애매하면 `ApplicationContext`에서 빈 이름을 출력해보며 추적

## 연습(추천)

- 동일 인터페이스 구현체 2개를 만들고 `@Primary`/`@Qualifier`로 주입을 제어해보기
- `@Configuration` vs `@Component`에서 `@Bean`을 만들 때 싱글톤 보장이 어떻게 달라지는지 실험해보기
- 일부러 순환 참조를 만들고(서비스 A ↔ B), 설계를 어떻게 풀면 좋을지 정리해보기

- 생성자 주입을 사용하면 final 키워드로 불변성 보장 가능
- 순환 참조 문제를 생성자 주입 사용 시 컴파일 타임에 발견 가능
- @Autowired는 생성자가 하나면 생략 가능 (Spring 4.3+)
