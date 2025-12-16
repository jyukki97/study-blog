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
study_order: 17
module: "spring-core"
---

## IoC란?

IoC(Inversion of Control)는 제어의 역전을 의미합니다. 객체의 생성과 생명주기를 개발자가 아닌 프레임워크가 관리합니다.

## DI (Dependency Injection)

의존성 주입은 IoC를 구현하는 방법 중 하나입니다.

### Constructor Injection (권장)

```java
@Service
public class UserService {
    private final UserRepository userRepository;

    // 생성자 주입
    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }
}
```

### Field Injection (비권장)

```java
@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;  // 테스트하기 어려움
}
```

## Bean 등록 방법

### 1. @Component 계열 어노테이션

```java
@Component
@Service
@Repository
@Controller
```

### 2. @Configuration + @Bean

```java
@Configuration
public class AppConfig {
    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();
    }
}
```

## 학습 메모

- 생성자 주입을 사용하면 final 키워드로 불변성 보장 가능
- 순환 참조 문제를 생성자 주입 사용 시 컴파일 타임에 발견 가능
- @Autowired는 생성자가 하나면 생략 가능 (Spring 4.3+)
