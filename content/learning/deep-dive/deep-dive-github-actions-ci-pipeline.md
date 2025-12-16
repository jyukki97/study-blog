---
title: "GitHub Actions로 백엔드 CI 파이프라인 구축"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["GitHub Actions", "CI", "Test", "Build"]
categories: ["DevOps"]
description: "테스트·빌드·린트·아티팩트 업로드를 포함한 백엔드 CI 파이프라인 예시와 베스트 프랙티스"
module: "ops-observability"
study_order: 42
---

## 기본 워크플로

- 트리거: `pull_request`, `push`(main)
- 단계: checkout → JDK 세팅 → 캐시 → 테스트/빌드 → 리포트

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
          cache: gradle
      - run: ./gradlew test jacocoTestReport
      - uses: actions/upload-artifact@v4
        with:
          name: reports
          path: build/reports/**
```

## 베스트 프랙티스

- `paths-ignore`로 문서 변경 시 불필요한 실행 최소화
- PR에서만 실행하는 정적 분석(Spotless/Detekt) 분리
- 실패 재현 용이하도록 `--stacktrace --info` 로그 남기기
- 비밀 키는 `secrets`에 저장, 환경별 변수는 `env`/`vars`로 분리

## 확장 아이디어

- [ ] DB/Redis Testcontainers로 통합 테스트 잡 추가
- [ ] 빌드 아티팩트(JAR/Docker image) 업로드 + 배포 잡 트리거
- [ ] Slack/Discord 알림 연동
