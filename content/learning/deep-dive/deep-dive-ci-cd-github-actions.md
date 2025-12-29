---
title: "CI/CD with GitHub Actions: 배포 자동화의 시작"
date: 2025-12-29
draft: false
topic: "DevOps"
tags: ["CI/CD", "GitHub Actions", "Automation", "Workflow", "Pipeline"]
categories: ["Backend Deep Dive"]
description: "GitHub Actions의 Workflow, Job, Step 구조와 Spring Boot 프로젝트의 자동 빌드/테스트 파이프라인 구축"
module: "ops-observability"
quizzes:
  - question: "CI(Continuous Integration)의 핵심 목표로 가장 적절한 것은?"
    options:
      - "개발된 코드를 운영 서버에 자동으로 배포하는 것"
      - "모든 개발자의 코드를 빈번하게(하루에도 수회) 메인 브랜치에 병합하고, 자동화된 테스트로 조기에 버그를 발견하는 것"
      - "테스트 코드를 작성하지 않고 빠르게 개발하는 것"
      - "인프라 구성을 자동으로 관리하는 것"
    answer: 1
    explanation: "CI(지속적 통합)는 코드를 자주 통합하고 자동화된 빌드/테스트를 통해 통합 지옥(Merge Hell)을 방지하고 코드 품질을 유지하는 것이 주 목적입니다."

  - question: "GitHub Actions에서 워크플로우(Workflow)가 실행되는 조건을 정의하는 키워드는?"
    options:
      - "jobs"
      - "steps"
      - "on"
      - "run"
    answer: 2
    explanation: "`on: push`나 `on: pull_request`와 같이 `on` 키워드를 사용하여 워크플로우를 트리거할 이벤트를 지정합니다."

  - question: "GitHub Actions의 `jobs` 내에서, 각 job들이 기본적으로 실행되는 방식은?"
    options:
      - "순차적 (Sequential) - 앞 단계가 끝나면 다음 단계가 실행된다."
      - "병렬적 (Parallel) - 서로 의존성 없이 동시에 실행된다."
      - "역순으로 실행된다."
      - "랜덤하게 실행된다."
    answer: 1
    explanation: "Job들은 기본적으로 병렬로 실행됩니다. 순서를 지정하고 싶다면 `needs: [build]`와 같이 의존성을 명시해야 합니다."

  - question: "GitHub Actions에서 민감한 정보(AWS Key, DB Password 등)를 안전하게 관리하기 위해 사용하는 기능은?"
    options:
      - "Environment Variables (env)"
      - "GitHub Secrets"
      - "Artifacts"
      - "Cache"
    answer: 1
    explanation: "Settings > Secrets and variables에 등록한 값들은 `${{ secrets.MY_KEY }}` 형태로 워크플로우에서 안전하게 주입할 수 있으며 로그에 노출되지 않습니다."

  - question: "Maven/Gradle 의존성(라이브러리)을 매번 다운로드받지 않고 재사용하여 빌드 속도를 높이는 GitHub Actions의 기능은?"
    options:
      - "actions/upload-artifact"
      - "actions/download-artifact"
      - "actions/cache"
      - "actions/checkout"
    answer: 2
    explanation: "`actions/cache` 액션을 사용하면 `~/.gradle` 등의 디렉토리를 키(Key) 기반으로 캐싱하여, 다음 빌드 시 다운로드 시간을 획기적으로 줄일 수 있습니다."
study_order: 92
---

## 이 글에서 얻는 것

- **CI/CD 개념**: 왜 "자동화"가 선택이 아닌 필수인지 이해합니다.
- **GitHub Actions 구조**: `Workflow` > `Job` > `Step` 계층 구조를 파악합니다.
- **실전 파이프라인**: Spring Boot 프로젝트를 PR 날릴 때마다 "빌드 + 테스트" 하는 yaml을 짭니다.

## 1. CI/CD가 뭔가요?

- **CI (Continuous Integration)**: "하루에 10번 머지해라."
    - 개발자 A, B, C가 짠 코드를 **매일** 합치고, **테스트**해서 깨지는지 확인하는 것.
- **CD (Continuous Deployment)**: "버튼도 누르지 마라."
    - 테스트 통과하면 자동으로 AWS/Docker 서버까지 배포되는 것.

## 2. GitHub Actions 구조 (.github/workflows)

GitHub 저장소의 `.github/workflows/` 폴더에 `yaml` 파일만 넣으면 끝입니다.

```yaml
name: Java CI with Gradle

on: # 1. Trigger
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]

jobs: # 2. 할 일 목록 (기본적으로 병렬 실행)
  build:
    runs-on: ubuntu-latest # 3. 실행 환경 (Runner)

    steps: # 4. 세부 단계 (순차 실행)
    - uses: actions/checkout@v3 # 코드 내려받기
    
    - name: Set up JDK 17
      uses: actions/setup-java@v3
      with:
        java-version: '17'
        distribution: 'temurin'
        
    - name: Grant execute permission for gradlew
      run: chmod +x gradlew
      
    - name: Build with Gradle
      run: ./gradlew build # 테스트 포함
```

## 3. 핵심 기능: Secrets & Cache

### Secrets (보안)

`application.yml`에 DB 비밀번호를 적어서 커밋하면 해킹당합니다.
GitHub Settings -> Secrets에 저장하고, yaml에서 꺼내 씁니다.

```yaml
env:
  DB_PASSWORD: ${{ secrets.DB_ONLY_PASS }}
```

### Cache (속도)

Gradle 빌드의 절반은 "라이브러리 다운로드"입니다. 캐싱하면 1분 걸리던 게 10초가 됩니다.

```yaml
- uses: actions/cache@v3
  with:
    path: |
      ~/.gradle/caches
      ~/.gradle/wrapper
    key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
```

## 4. 실전 워크플로우 전략

1.  **PR 검증**: `pull_request` 트리거로 테스트(`test`)만 돌립니다. 실패하면 Merge 버튼 비활성화.
2.  **배포**: `main` 브랜치에 `push` 되면, 빌드 후 Docker 이미지를 만들고 AWS로 쏘는(CD) 잡을 실행합니다.

## 요약

1.  **자동화**: 내가 자는 동안에도 테스트는 돌아야 한다.
2.  **YAML**: `.github/workflows`에 정의하면 GitHub이 알아서 서버를 빌려주고 실행해준다.
3.  **Secrets**: 비밀번호는 절대 코드에 넣지 말고 Secrets를 써라.
