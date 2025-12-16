---
title: "Spring 프로필과 설정 분리 전략"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Profile", "Configuration", "YAML"]
categories: ["Backend Deep Dive"]
description: "dev/stage/prod 설정 분리, @ConfigurationProperties, Secret 관리 전략 정리"
module: "spring-core"
study_order: 27
---

## 프로필 분리 예시

```yaml
spring:
  config:
    activate:
      on-profile: dev
  datasource:
    url: jdbc:mysql://localhost:3306/app
    username: dev
---
spring:
  config:
    activate:
      on-profile: prod
  datasource:
    url: jdbc:mysql://prod-db:3306/app
    username: prod
```

```java
@ConfigurationProperties(prefix = "app")
public record AppProperties(String name, String baseUrl) {}
```

## Secret 관리

- 애플리케이션 설정(YAML)과 비밀(키/토큰)은 분리 → 환경변수/Secret Manager/Vault
- `spring.config.import=aws-secretsmanager:` 등 외부 소스 활용

## 체크리스트

- [ ] 기본 프로필(default) 최소화, 명시적 프로필 활성화 사용
- [ ] 로컬/CI/운영 프로필 별 DB/Queue/Redis 설정 분리
- [ ] Config 서버 혹은 Secret Manager로 민감 정보 분리
- [ ] @ConfigurationProperties로 타입 세이프 바인딩 후 검증(@Validated)
