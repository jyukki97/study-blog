---
title: "Docker 멀티스테이지 빌드와 CI 파이프라인"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Docker", "CI", "GitHub Actions", "멀티스테이지"]
categories: ["Development", "Learning"]
description: "멀티스테이지 Dockerfile과 GitHub Actions로 테스트/빌드/이미지 푸시 자동화"
module: "ops-observability"
study_order: 41
---

## Dockerfile 예시

```dockerfile
FROM gradle:8.5-jdk17 AS build
WORKDIR /app
COPY build.gradle settings.gradle gradle.properties ./
COPY src ./src
RUN gradle clean build -x test

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/app.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]
```

## GitHub Actions 워크플로 예시

```yaml
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - run: ./gradlew test
      - run: docker build -t ghcr.io/you/app:${{ github.sha }} .
      - run: echo "${{ secrets.GHCR_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
      - run: docker push ghcr.io/you/app:${{ github.sha }}
```

## 체크리스트

- [ ] build 단계 캐시 최적화: 의존성/소스 분리 COPY
- [ ] 보안: 최소 Base 이미지, non-root, `HEALTHCHECK`
- [ ] CI 비밀 값은 Secrets로 주입, PR 빌드 시 push 차단
- [ ] 태그 전략: git SHA + release tag 병행
