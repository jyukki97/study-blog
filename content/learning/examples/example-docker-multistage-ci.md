---
title: "Docker 멀티스테이지 빌드와 CI 파이프라인"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Docker", "CI", "GitHub Actions", "멀티스테이지"]
categories: ["Development", "Learning"]
description: "멀티스테이지 Dockerfile과 GitHub Actions로 테스트/빌드/이미지 푸시 자동화"
module: "ops-observability"
study_order: 310
---

## 이 글에서 얻는 것

- 멀티스테이지 빌드가 왜 필요한지(이미지 크기/보안/빌드 재현성) 이해하고, 실무형 Dockerfile을 작성할 수 있습니다.
- 도커 빌드 캐시가 언제 깨지는지 감각을 잡고, CI 빌드 시간을 줄이는 구조를 만들 수 있습니다.
- GitHub Actions에서 테스트 → 빌드 → 이미지 푸시까지 자동화하되, PR에서 시크릿 노출/불필요한 push를 막는 방법을 익힙니다.

## 0) 왜 멀티스테이지인가

단일 Dockerfile로 빌드까지 하면:

- JDK/Gradle 같은 빌드 도구가 런타임 이미지에 남아 이미지가 커지고,
- 공격 표면이 넓어지고,
- 캐시가 비효율적으로 깨지기 쉽습니다.

멀티스테이지는 “빌드 환경”과 “런타임 환경”을 분리해 이 문제를 줄입니다.

## 1) Dockerfile: 빌드와 런타임을 분리하기

```dockerfile
FROM gradle:8.5-jdk17 AS build
WORKDIR /app

# 캐시 효율을 위해 의존성/설정 파일을 먼저 복사
COPY build.gradle settings.gradle gradle.properties ./
COPY gradle ./gradle
COPY gradlew ./

# (선택) 의존성만 먼저 받아 캐시 적중률을 높임
RUN ./gradlew dependencies --no-daemon || true

COPY src ./src
RUN ./gradlew clean build --no-daemon

FROM eclipse-temurin:17-jre
WORKDIR /app

# non-root 권장(환경에 맞게 UID/GID 조정)
RUN useradd -r -u 10001 appuser
USER 10001

COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8080

# (선택) 헬스체크는 오케스트레이터 환경에 맞게 결정
# HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java","-jar","/app/app.jar"]
```

핵심 포인트:

- “의존성/설정 파일”을 먼저 COPY해서 캐시 효율을 올립니다.
- 런타임 이미지는 JRE만 포함해 작고 단순하게 유지합니다.
- 가능하면 non-root로 실행해 권한 사고를 줄입니다.

## 2) GitHub Actions: 테스트 → 빌드 → 이미지 푸시(조건부)

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
          cache: gradle
      - run: ./gradlew test

      # main 브랜치 push에서만 이미지 푸시(시크릿 사용)
      - if: github.event_name == 'push'
        run: |
          echo "${{ secrets.GHCR_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker build -t ghcr.io/you/app:${{ github.sha }} .
          docker push ghcr.io/you/app:${{ github.sha }}
```

실무 팁:

- PR에서는 테스트/빌드까지만, 이미지 push는 main에만(시크릿 노출/권한 사고 방지)
- 이미지 태그는 `sha` + 릴리즈 태그를 병행하면 추적/롤백이 쉬워집니다
- 도커 빌드 캐시는 `buildx`/캐시 액션으로 더 최적화할 수 있습니다(필요해질 때 도입)

## 3) 자주 하는 실수

- `-x test`로 빌드해서 CI에서 테스트가 빠지는 경우
- `.env`/시크릿 파일이 빌드 컨텍스트에 포함되는 경우(.dockerignore 누락)
- 이미지가 너무 커져 배포가 느리고 취약점 표면이 커지는 경우
- PR에서 시크릿이 필요한 step을 실행하려다 실패/사고가 나는 경우

## 연습(추천)

- 현재 프로젝트에 멀티스테이지 Dockerfile을 적용하고 이미지 크기를 비교해보기
- `HEALTHCHECK` 또는 오케스트레이터(쿠버네티스/ALB) 헬스체크를 설계해보기
- GitHub Actions에서 PR/MAIN을 분리해 “PR은 검증만, main은 push”가 되게 구성해보기
