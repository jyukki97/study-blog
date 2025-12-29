---
title: "GitHub Actions로 백엔드 CI 파이프라인 구축"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["GitHub Actions", "CI", "Test", "Build"]
categories: ["DevOps"]
description: "테스트·빌드·린트·아티팩트 업로드를 포함한 백엔드 CI 파이프라인 예시와 베스트 프랙티스"
module: "ops-observability"
study_order: 320
quizzes:
  - question: "좋은 CI 파이프라인의 핵심 기준으로 올바르지 않은 것은?"
    options:
      - "빠르다 - PR마다 부담 없이 돌릴 수 있다."
      - "결정적이다 - 같은 코드면 같은 결과(Flaky 최소화)."
      - "복잡하다 - 모든 테스트를 하나의 Job에 넣는다."
      - "안전하다 - PR에서 시크릿/배포 권한이 노출되지 않는다."
    answer: 2
    explanation: "좋은 CI는 빠르고, 결정적이고, 재현 가능하고, 안전해야 합니다. 테스트를 하나의 Job에 몰아넣으면 '느린 단계'가 전체를 잡아먹어 비효율적입니다."

  - question: "GitHub Actions에서 Gradle/Maven 캐시를 사용하는 이유는?"
    options:
      - "빌드를 생략하기 위해"
      - "의존성 다운로드 시간을 줄여 PR 피드백 속도를 빠르게 하기 위해"
      - "테스트를 건너뛰기 위해"
      - "로그를 줄이기 위해"
    answer: 1
    explanation: "매 빌드마다 의존성을 다시 다운로드하면 시간이 오래 걸립니다. 캐시를 사용하면 변경되지 않은 의존성을 재사용하여 빌드 속도가 빨라집니다."

  - question: "PR 빌드에서 시크릿(Secret)을 사용하지 않도록 설계하는 이유는?"
    options:
      - "속도를 위해"
      - "Fork PR에서 시크릿이 노출되거나, 권한 사고가 발생할 수 있으므로 안전을 위해"
      - "비용 절감"
      - "필요 없어서"
    answer: 1
    explanation: "Fork에서 온 PR은 외부 기여자가 보내는 것입니다. 시크릿이 필요한 작업(이미지 Push 등)을 PR에서 실행하면 악용될 수 있습니다."

  - question: "CI 파이프라인에서 테스트 실패 시 아티팩트(Artifact)를 업로드하는 이유는?"
    options:
      - "저장 공간을 사용하기 위해"
      - "테스트 리포트/로그를 PR에서 바로 확인하여 실패 원인을 빠르게 파악하기 위해"
      - "다음 빌드에서 사용하기 위해"
      - "캐시와 동일한 역할"
    answer: 1
    explanation: "테스트가 실패했을 때 로그나 리포트가 없으면 원인 파악이 어렵습니다. 아티팩트로 저장해두면 PR 페이지에서 바로 다운로드해 확인할 수 있습니다."

  - question: "PR과 main 브랜치의 CI 워크플로를 분리하는 권장 방식은?"
    options:
      - "둘 다 동일한 작업을 수행한다."
      - "PR: 테스트/빌드/정적 분석, main: 이미지 Push/배포 같은 권한 필요 작업"
      - "PR에서 배포까지 수행한다."
      - "main에서만 테스트한다."
    answer: 1
    explanation: "PR에서는 코드 품질 검증만 하고, main에서는 (테스트 통과 후) 이미지 생성/배포를 수행합니다. 이렇게 하면 시크릿 노출 위험이 줄어듭니다."
---

## 이 글에서 얻는 것

- CI를 “돌아가기만 하는 자동화”가 아니라, **품질 게이트 + 재현 가능한 빌드**로 설계할 수 있습니다.
- GitHub Actions의 트리거/캐시/아티팩트/잡 분리를 활용해 빠르고 안정적인 파이프라인을 구성할 수 있습니다.
- PR과 main 배포 경로를 분리해 시크릿/권한 사고를 줄이고, 실패 원인을 쉽게 재현할 수 있게 만듭니다.

## 0) 좋은 CI의 기준(실무 감각)

- 빠르다: PR마다 부담 없이 돌릴 수 있어야 한다
- 결정적이다: 같은 코드면 같은 결과(플레이키 최소화)
- 재현 가능하다: 실패하면 로컬/CI에서 원인을 좁힐 수 있다
- 안전하다: PR에서 시크릿/배포 권한이 노출되지 않는다

## 1) 기본 워크플로: PR 검증 + main 검증(필수)

기본 뼈대:

- 트리거: `pull_request`, `push`(main)
- 단계: checkout → 런타임 세팅 → 캐시 → 테스트/빌드 → 리포트(아티팩트)

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

## 2) 속도 최적화: 캐시와 잡 분리

- Gradle/Maven 캐시를 쓰면 PR 피드백이 빨라집니다.
- 테스트/빌드/정적 분석을 한 잡에 다 넣으면 “느린 단계”가 전체를 잡아먹습니다.  
  필요하면 잡을 분리해 병렬로 돌립니다(예: unit test vs lint).

## 3) 트리거 최적화: 불필요한 실행 줄이기

- 문서 변경만 있을 때는 `paths-ignore`로 CI를 생략할 수 있습니다.
- 브랜치 보호 규칙과 함께 “필수 체크”를 정해두면 main이 더 안전해집니다.

## 4) 로그/리포트: 실패 원인을 남기는 것이 CI의 가치

- Gradle은 `--stacktrace --info`로 실패 원인을 더 잘 남길 수 있습니다(노이즈와 트레이드오프).
- 테스트 리포트/커버리지 리포트를 아티팩트로 남기면 PR에서 빠르게 확인할 수 있습니다.

## 5) 보안: PR에서 시크릿을 쓰지 않게 설계하라

가장 흔한 사고:

- PR 빌드에서 이미지 push/배포를 하려다 시크릿이 필요해지고,
- fork PR에서 시크릿이 노출되거나 파이프라인이 깨집니다.

권장:

- PR: 테스트/빌드/정적 분석까지만
- main: 이미지 push/배포 같은 “권한 필요 작업”

## 6) 확장 패턴(필요해질 때 도입)

- 통합 테스트 잡: Testcontainers(DB/Redis) 포함
- 아티팩트/이미지 생성: JAR 업로드 또는 Docker image push(조건부)
- 알림/리그레션 감지: 실패 시 슬랙/디스코드, flaky 테스트 추적

## 7) 자주 하는 실수

- CI가 느려져서 결국 안 돌리게 되는 경우(잡 분리/캐시 부재)
- PR에서 시크릿이 필요한 작업을 실행하려는 경우(권한 설계 문제)
- 실패 로그가 너무 적어서 원인을 못 찾는 경우(리포트/아티팩트 부재)

## 연습(추천)

- PR에서는 `test`만, main에서는 `test + build + image push`가 되게 워크플로를 분리해보기
- 단위 테스트와 통합 테스트(Testcontainers)를 잡으로 분리하고, PR에서는 단위만 실행해보기
- 실패한 테스트의 리포트를 아티팩트로 남겨 PR에서 바로 확인 가능하게 만들기
