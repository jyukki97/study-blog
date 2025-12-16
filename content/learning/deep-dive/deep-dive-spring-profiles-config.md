---
title: "Spring 프로필과 설정 분리 전략"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Profile", "Configuration", "YAML"]
categories: ["Backend Deep Dive"]
description: "dev/stage/prod 설정 분리, @ConfigurationProperties, Secret 관리 전략 정리"
module: "spring-core"
study_order: 195
---

## 이 글에서 얻는 것

- dev/stage/prod 설정을 “파일 나누기” 수준이 아니라, **운영 사고를 막는 구조**로 설계할 수 있습니다.
- Spring의 프로퍼티 우선순위/프로필 활성화 흐름을 이해해서 “왜 이 값이 적용됐지?”를 디버깅할 수 있습니다.
- `@ConfigurationProperties`로 타입 세이프 설정을 만들고, 검증/시크릿 분리까지 포함해 안전하게 운영할 수 있습니다.

## 0) 설정 분리는 운영 안정성의 기본기

설정이 섞이면 운영에서 이런 사고가 자주 납니다.

- 로컬 DB 설정이 운영에 적용됨
- 테스트용 외부 API 키가 운영에 적용됨
- 운영에서 디버그/문서 UI가 켜짐

그래서 “코드는 같아도, 환경은 다르다”를 전제로 구조를 잡아야 합니다.

## 1) 프로필 분리 예시(멀티 도큐먼트 YAML)

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

이 방식의 장점:

- 한 파일 안에서 프로필별 차이를 한눈에 볼 수 있습니다.
- 운영에서 “어떤 프로필이 켜졌는지”만 확인하면 적용 값을 추적하기 쉬워집니다.

대안:

- `application-dev.yml`, `application-prod.yml`처럼 파일을 분리하는 방식도 흔합니다(팀 취향/규모에 따라).

## 2) 프로퍼티 우선순위: “왜 이 값이 먹지?”의 핵심

스프링 부트는 여러 소스에서 설정을 읽고, 우선순위에 따라 덮어씁니다.

실무에서 중요한 감각:

- 운영에서는 보통 **환경변수/Secret Manager**가 YAML보다 우선하도록 설계합니다.
- 로컬에서는 YAML로 빠르게 개발하고, 운영에서는 “배포 파이프라인”이 값을 주입하도록 분리합니다.

## 3) 프로필 활성화: 명시적으로 켜자

운영에서 가장 안전한 방식은 “기본값에 기대지 않고, 명시적으로 프로필을 켠다”입니다.

- 로컬: `SPRING_PROFILES_ACTIVE=dev`
- 운영: `SPRING_PROFILES_ACTIVE=prod`
- 테스트: `@ActiveProfiles(\"test\")` 또는 `application-test.yml`

가능하면 운영에서 “dev가 기본” 같은 형태는 피하는 편이 좋습니다.

## 4) `@ConfigurationProperties`: 설정을 ‘타입’으로 만들기

문자열 키로 여기저기 흩어진 설정을 직접 읽으면, 오타/누락/형변환 문제가 런타임에 터집니다.
`@ConfigurationProperties`는 설정을 타입으로 묶고, 테스트/검증하기 쉽게 만들어줍니다.

실무 팁:

- `@Validated` + 제약 어노테이션으로 “잘못된 설정”을 애플리케이션 시작 시점에 실패시키기
- “설정의 의미”를 record/class에 모아두면 유지보수가 쉬워집니다

## 5) Secret 관리: 설정과 비밀을 분리하자

설정과 비밀(키/토큰/비밀번호)은 성격이 다릅니다.

- 설정: 공개돼도 되는 값(포트, feature flag, URL 등)
- 비밀: 유출되면 바로 사고(토큰, DB 비밀번호, API 키)

그래서 비밀은 YAML에 커밋하지 않고, 별도 채널로 주입하는 것이 기본입니다.

- 애플리케이션 설정(YAML)과 비밀(키/토큰)은 분리 → 환경변수/Secret Manager/Vault
- `spring.config.import=aws-secretsmanager:` 등 외부 소스 활용

추가 팁:

- 운영에서 “시크릿 회전(rotation)”이 필요하면 Secret Manager/Vault가 훨씬 유리합니다.
- 로그에 설정/시크릿이 출력되지 않게 주의합니다(특히 예외 메시지/디버그 로그).

## 6) 자주 하는 실수

- 프로필이 기대와 다르게 켜져서(또는 여러 개가 동시에 켜져서) 설정이 섞이는 경우
- 환경변수로 주입한 값이 “문자열”로 들어와 타입 변환/파싱 문제가 나는 경우
- 시크릿을 코드/레포에 남겨 회수(폐기) 비용이 커지는 경우

## 연습(추천)

- `app.*` 설정을 `@ConfigurationProperties`로 옮기고, 누락 시 시작 단계에서 실패하도록 검증 추가해보기
- dev/prod 프로필을 분리하고, 운영에서는 환경변수로만 시크릿이 들어오게 구성해보기
- “왜 이 설정이 적용됐는지”를 `--debug`/actuator로 추적하는 연습을 해보기
