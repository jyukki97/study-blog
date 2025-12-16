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

## 동작 흐름

- `@SpringBootApplication` → `SpringFactoriesLoader`로 `spring.factories`의 `EnableAutoConfiguration` 읽기
- `AutoConfigurationImportSelector`가 조건(`@Conditional*`)을 평가하며 빈 등록 결정
- `AutoConfiguration` 빈은 일반 빈보다 우선순위가 낮아 애플리케이션 설정으로 오버라이드 가능

## 커스터마이징 포인트

- `spring.autoconfigure.exclude`로 특정 자동 설정 제외
- `@ConditionalOnMissingBean` / `@ConditionalOnProperty` 활용 패턴 이해
- `@ConfigurationProperties` + `@EnableConfigurationProperties`로 설정 바인딩

## 샘플

```java
@Configuration
@ConditionalOnClass(DataSource.class)
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration { ... }
```

```properties
# 자동 설정 제외 예시
spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration
```

## 체크리스트

- [ ] 원하는 빈을 덮어써야 할 때, 동일 타입 빈을 직접 등록하거나 `@Primary` 사용
- [ ] 클래스패스/프로퍼티 조건을 확인해 의도치 않은 설정을 방지
- [ ] AutoConfig에서 제공하는 기본 빈을 재사용하고 확장하는지 확인 (ex. 커스텀 Converter 추가)
*** End Patch​
