---
title: "Spring Boot 자동 설정 해부"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring Boot", "AutoConfiguration", "Condition", "Classpath"]
categories: ["Backend Deep Dive"]
description: "자동 설정 동작 원리, 조건부 빈 등록, 커스터마이징 포인트 정리"
module: "spring-core"
study_order: 140
---

## 이 글에서 얻는 것

- Spring Boot “자동 설정”이 정확히 무엇인지(어디서/어떤 조건으로/왜 등록되는지) 설명할 수 있습니다.
- “내가 만든 빈이 왜 안 먹지?”, “왜 갑자기 Security가 켜졌지?” 같은 문제를 **조건 리포트로 디버깅**할 수 있습니다.
- 자동 설정을 끄기(exclude)보다 **확장/오버라이드**로 안전하게 커스터마이징하는 방법을 익힙니다.

## 0) 자동 설정(Auto-Configuration)은 한 문장으로

Spring Boot는 클래스패스(의존성)와 설정 프로퍼티를 보고,
필요한 `@Configuration`들을 자동으로 import 해서 “기본 동작”을 만들어줍니다.

중요한 포인트는 “자동 설정은 마법”이 아니라 **그냥 조건부로 등록되는 설정 클래스 집합**이라는 점입니다.

## 1) 동작 흐름(큰 그림)

### 1-1) `@SpringBootApplication`에서 시작

`@SpringBootApplication`은 대략 아래를 묶은 편의 어노테이션입니다.

- `@SpringBootConfiguration`(= `@Configuration`)
- `@ComponentScan`
- `@EnableAutoConfiguration`

### 1-2) AutoConfigurationImportSelector가 자동 설정 클래스를 모음

부트는 “자동 설정 목록 파일”을 읽어서 자동 설정 클래스를 가져온 뒤,
각 설정 클래스의 조건(`@Conditional*`)을 평가해 적용 여부를 결정합니다.

참고(버전 차이):

- Boot 2.x: 주로 `META-INF/spring.factories`를 통해 `EnableAutoConfiguration` 목록을 로딩
- Boot 3.x: 자동 설정 목록이 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`로 이동(성능/구조 개선)

## 2) 조건부 등록의 핵심: `@Conditional*`

자동 설정이 “항상 켜지는” 게 아닌 이유는 대부분 여기에 있습니다.

자주 보는 조건:

- `@ConditionalOnClass`: 특정 클래스가 클래스패스에 있으면 켬(= 의존성 추가가 기능 활성화로 이어짐)
- `@ConditionalOnMissingBean`: 같은 타입/이름의 빈이 없을 때만 기본 빈을 제공(= 사용자가 오버라이드 가능)
- `@ConditionalOnProperty`: 프로퍼티가 특정 값일 때만 활성화
- `@ConditionalOnBean`: 특정 빈이 이미 있을 때만 활성화(조합)
- `@ConditionalOnWebApplication`: 웹 환경에서만 활성화

## 3) “내가 만든 설정이 왜 안 먹지?” 디버깅 루틴

자동 설정은 조건 때문에 켜지거나 꺼집니다. 추측하지 말고 조건 리포트를 확인하면 빠릅니다.

### 3-1) `--debug`로 ConditionEvaluationReport 보기

실행 옵션에 `--debug`를 주면 어떤 자동 설정이 “왜 켜졌고/왜 꺼졌는지”가 출력됩니다.

### 3-2) Actuator의 conditions/beans 활용

운영/로컬에서 원인 추적이 필요하면:

- `/actuator/conditions`: 조건 평가 결과
- `/actuator/beans`: 빈 목록과 의존성

(노출은 반드시 인증/내부망 등으로 제한해야 합니다.)

## 4) 커스터마이징의 우선순위: exclude는 마지막 카드

### 4-1) 1순위: 프로퍼티로 동작을 조정

자동 설정은 보통 “기본값”을 제공하고, 프로퍼티로 동작을 바꿀 수 있게 설계되어 있습니다.

예:

- DataSource, Jackson, Logging, Management(Actuator) 등은 프로퍼티로 조정 가능한 범위가 큽니다.

### 4-2) 2순위: 빈 오버라이드(같은 타입 빈 등록)

자동 설정이 `@ConditionalOnMissingBean`으로 기본 빈을 제공하는 경우,
같은 타입 빈을 직접 등록하면 “내 빈이 우선”이 됩니다.

```java
@Configuration
public class MyConfig {
    @Bean
    public ObjectMapper objectMapper() {
        return new ObjectMapper().findAndRegisterModules();
    }
}
```

### 4-3) 3순위: 확장 포인트를 사용(커스터마이저/빌더)

부트는 아예 확장용 타입을 제공하는 경우가 많습니다.

- `WebMvcConfigurer`, `Jackson2ObjectMapperBuilderCustomizer` 같은 커스터마이저
- Converter/Formatter 등록 등

### 4-4) 마지막: exclude

자동 설정 제외는 빠르지만 부작용이 큽니다. 다른 자동 설정이 연쇄적으로 기대하는 빈이 사라질 수 있습니다.

정말 필요할 때만 사용합니다.

```properties
spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration
```

또는:

```java
@SpringBootApplication(exclude = SecurityAutoConfiguration.class)
public class App {}
```

## 5) 실무에서 자주 겪는 함정

- 의존성(starter)을 추가했더니 기능이 “자동으로 켜짐” → `@ConditionalOnClass`가 원인인 경우가 많음
- 같은 타입 빈이 여러 개라서 주입이 모호함 → `@Primary`/`@Qualifier`로 의도를 명확히
- exclude로 급하게 껐는데 다른 설정이 깨짐 → 우선 프로퍼티/오버라이드/확장으로 해결 가능한지 확인

## 연습(추천)

- `spring-boot-starter-security`를 추가했을 때 어떤 자동 설정이 켜지는지 `--debug`로 확인해보기
- ObjectMapper를 커스터마이징하고, 자동 설정 기본값과 무엇이 달라졌는지 비교해보기
- “의도치 않은 빈 생성”을 일부러 만들어보고(`/actuator/beans`, `/actuator/conditions`), 원인을 추적해보기
