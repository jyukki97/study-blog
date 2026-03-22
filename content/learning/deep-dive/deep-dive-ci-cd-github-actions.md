---
title: "CI/CD with GitHub Actions: 배포 자동화의 시작"
date: 2025-12-29
draft: false
topic: "DevOps"
tags: ["CI/CD", "GitHub Actions", "Automation", "Workflow", "Pipeline", "Docker", "Matrix", "Security"]
categories: ["Backend Deep Dive"]
description: "GitHub Actions의 Workflow 구조부터 Matrix 전략, 보안 하드닝, Docker 빌드, 배포 파이프라인, 비용 최적화까지 — 운영 수준의 CI/CD 설계"
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
- **실전 파이프라인**: Spring Boot 프로젝트의 빌드 → 테스트 → Docker → 배포 전체 흐름을 구축합니다.
- **고급 전략**: Matrix 빌드, 보안 하드닝, 비용 최적화, Reusable Workflow를 활용합니다.

---

## 1) CI/CD가 뭔가요?

### 핵심 개념

| 단계 | 이름 | 하는 일 | 자동화 수준 |
|------|------|--------|:---:|
| CI | Continuous Integration | 코드 병합 + 빌드 + 테스트 | 완전 자동 |
| CD | Continuous Delivery | CI + 스테이징 배포 + 승인 대기 | 반자동 |
| CD | Continuous Deployment | CI + 운영 배포까지 자동 | 완전 자동 |

### CI/CD가 없으면 생기는 일

```
월요일: "내 로컬에서는 되는데?"
화요일: "PR 머지했더니 빌드가 깨짐"
수요일: "테스트 안 돌리고 배포했더니 장애"
목요일: "장애 수습하느라 다른 기능 개발 못함"
금요일: "이번 주도 야근..."

→ CI/CD = 이 악순환을 끊는 장치
```

---

## 2) GitHub Actions 구조

### 계층 구조

```
Repository
└── .github/workflows/
    └── ci.yml (Workflow)
        ├── on: push/pull_request    (트리거)
        └── jobs:                     (병렬 실행 기본)
            ├── build:                (Job 1)
            │   └── steps:            (순차 실행)
            │       ├── checkout
            │       ├── setup-java
            │       └── gradle build
            ├── test:                 (Job 2)
            │   └── needs: [build]    (의존성 → 순차)
            └── deploy:               (Job 3)
                └── needs: [test]
```

### 기본 CI 워크플로우

```yaml
name: Java CI with Gradle

on:
  push:
    branches: [ "main", "develop" ]
  pull_request:
    branches: [ "main" ]

# 같은 브랜치의 이전 실행을 자동 취소 (비용 절약)
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read       # 최소 권한 원칙
  checks: write
  pull-requests: write

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15  # 무한 대기 방지

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      # Gradle 캐싱 (빌드 시간 50~70% 단축)
      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4
        with:
          cache-read-only: ${{ github.ref != 'refs/heads/main' }}

      - name: Build with Gradle
        run: ./gradlew build --no-daemon

      # 테스트 결과를 PR 댓글로 표시
      - name: Publish Test Results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: '**/build/test-results/**/*.xml'
```

---

## 3) 핵심 기능 4가지

### 3-1) Secrets (보안)

```yaml
# ❌ 절대 하지 말 것
env:
  DB_PASSWORD: "MySecretP@ss123"

# ✅ GitHub Secrets 사용
env:
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  # Settings > Secrets and variables > Actions에서 등록
```

**Secrets 관리 규칙:**
- Repository Secrets: 해당 레포만 접근
- Organization Secrets: 여러 레포 공유 가능
- Environment Secrets: 특정 환경(staging/production)에서만 접근

### 3-2) Cache (빌드 속도)

```yaml
# Gradle 의존성 + 빌드 캐시
- uses: actions/cache@v4
  with:
    path: |
      ~/.gradle/caches
      ~/.gradle/wrapper
      build/
    key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
    restore-keys: |
      ${{ runner.os }}-gradle-
```

| 캐시 대상 | 절약 시간 | 키 전략 |
|----------|:---:|------|
| Gradle 의존성 | 1~3분 | `gradle-wrapper.properties` 해시 |
| Docker 레이어 | 2~5분 | Dockerfile 해시 |
| npm/yarn | 30초~2분 | `package-lock.json` 해시 |

### 3-3) Artifacts (빌드 산출물)

```yaml
# 빌드 산출물 업로드
- uses: actions/upload-artifact@v4
  with:
    name: app-jar
    path: build/libs/*.jar
    retention-days: 7  # 7일 후 자동 삭제 (비용 절감)

# 다른 Job에서 다운로드
- uses: actions/download-artifact@v4
  with:
    name: app-jar
```

### 3-4) Matrix Strategy (다중 환경 테스트)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false  # 하나 실패해도 나머지 계속 실행
      matrix:
        java-version: [17, 21]
        db: [postgres, mysql]
        include:
          - db: postgres
            db-image: postgres:16
            db-port: 5432
          - db: mysql
            db-image: mysql:8.0
            db-port: 3306

    services:
      database:
        image: ${{ matrix.db-image }}
        env:
          POSTGRES_PASSWORD: test
          MYSQL_ROOT_PASSWORD: test
        ports:
          - ${{ matrix.db-port }}:${{ matrix.db-port }}
        options: >-
          --health-cmd="pg_isready || mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: ${{ matrix.java-version }}
          distribution: 'temurin'
      - run: ./gradlew test -Dspring.datasource.url=jdbc:${{ matrix.db }}://localhost:${{ matrix.db-port }}/test
```

---

## 4) Docker 빌드 & 배포 파이프라인

### 4-1) Multi-stage Dockerfile

```dockerfile
# Stage 1: 빌드
FROM eclipse-temurin:17-jdk AS builder
WORKDIR /app
COPY gradle/ gradle/
COPY gradlew build.gradle settings.gradle ./
RUN ./gradlew dependencies --no-daemon  # 의존성만 먼저 (레이어 캐싱)
COPY src/ src/
RUN ./gradlew bootJar --no-daemon

# Stage 2: 실행 (JRE만 포함 → 이미지 크기 50%+ 감소)
FROM eclipse-temurin:17-jre
RUN addgroup --system app && adduser --system --ingroup app app
USER app
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar

# 보안: 불필요한 쉘 제거 시 nonroot 이미지 사용 권장
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 4-2) Docker 빌드 + Push 워크플로우

```yaml
jobs:
  docker:
    runs-on: ubuntu-latest
    needs: [test]  # 테스트 통과 후에만

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      # Docker Buildx (멀티 아키텍처 빌드)
      - uses: docker/setup-buildx-action@v3

      # GHCR 로그인
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # 이미지 태그 전략
      - name: Docker Metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,prefix=  
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      # 빌드 + 푸시 (캐시 활용)
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 5) 배포 전략 워크플로우

### 5-1) Environment 승인 게이트

```yaml
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    needs: [docker]
    environment: staging  # 자동 배포

    steps:
      - name: Deploy to Staging
        run: |
          kubectl set image deployment/order-service \
            app=ghcr.io/${{ github.repository }}:${{ github.sha }} \
            --namespace staging

  deploy-production:
    runs-on: ubuntu-latest
    needs: [deploy-staging]
    environment: production  # 수동 승인 필요 (Settings에서 설정)

    steps:
      - name: Deploy to Production
        run: |
          kubectl set image deployment/order-service \
            app=ghcr.io/${{ github.repository }}:${{ github.sha }} \
            --namespace production
```

### 5-2) 전체 파이프라인 흐름

```
PR 생성/Push
    │
    ▼
┌─────────┐     ┌─────────┐     ┌───────────┐
│  Build  │────→│  Test   │────→│  Docker   │
│ (2min)  │     │ (3min)  │     │  Build    │
└─────────┘     └─────────┘     │  (2min)   │
                                └─────┬─────┘
                                      │
                              ┌───────▼───────┐
                              │   Staging     │
                              │   Deploy      │
                              │   (자동)      │
                              └───────┬───────┘
                                      │
                              ┌───────▼───────┐
                              │  Production   │
                              │  Deploy       │
                              │  (승인 필요)  │
                              └───────────────┘
```

---

## 6) 보안 하드닝

### 6-1) 워크플로우 보안 체크리스트

```yaml
# ✅ 1. 최소 권한 원칙
permissions:
  contents: read
  # 필요한 권한만 명시적으로 부여

# ✅ 2. 액션 버전 SHA 고정 (supply chain 공격 방지)
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1

# ✅ 3. 서드파티 액션 최소화
# 가능하면 run: 으로 직접 실행

# ✅ 4. pull_request_target 주의
# Fork PR에서 secrets 접근 가능 — 악성 코드 실행 위험
on:
  pull_request:  # ← 안전 (Fork PR에서 secrets 접근 불가)
  # pull_request_target:  # ← 위험! 필요 시 별도 보안 검토
```

### 6-2) Secret Scanning + SAST

```yaml
name: Security Scan

on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    permissions:
      security-events: write  # CodeQL 결과 업로드

    steps:
      - uses: actions/checkout@v4

      # Secret Scanning
      - name: Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # SAST (Static Application Security Testing)
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: java

      - name: Build
        run: ./gradlew build --no-daemon -x test

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3

      # 의존성 취약점 스캔
      - name: Dependency Check
        run: ./gradlew dependencyCheckAnalyze
```

### 6-3) OpenSSF Scorecard

```yaml
# 프로젝트의 보안 점수를 측정
- uses: ossf/scorecard-action@v2
  with:
    results_file: results.sarif
    results_format: sarif
    publish_results: true
```

---

## 7) Reusable Workflow (조직 표준화)

### 7-1) 공통 워크플로우 정의

```yaml
# .github/workflows/reusable-java-ci.yml
name: Reusable Java CI

on:
  workflow_call:
    inputs:
      java-version:
        required: false
        type: string
        default: '17'
      gradle-tasks:
        required: false
        type: string
        default: 'build'
    secrets:
      SONAR_TOKEN:
        required: false

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: ${{ inputs.java-version }}
          distribution: 'temurin'
      - uses: gradle/actions/setup-gradle@v4
      - run: ./gradlew ${{ inputs.gradle-tasks }} --no-daemon
```

### 7-2) 호출하는 측

```yaml
# 다른 레포의 .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  ci:
    uses: my-org/.github/.github/workflows/reusable-java-ci.yml@main
    with:
      java-version: '21'
      gradle-tasks: 'build jacocoTestReport'
    secrets:
      SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

---

## 8) 비용 최적화

### 비용 구조 이해

| Runner | 가격 (분당) | 월 무료 | 적합 |
|--------|:---:|:---:|------|
| ubuntu-latest | $0.008 | 2,000분 | 일반 빌드 |
| macos-latest | $0.08 | 200분 | iOS/macOS 필수만 |
| windows-latest | $0.016 | 2,000분 | .NET 필수만 |
| Self-hosted | 무료 | ∞ | 대규모 조직 |

### 비용 절감 전략

```yaml
# 1. concurrency로 중복 실행 방지
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# 2. path filter로 불필요한 빌드 방지
on:
  push:
    paths:
      - 'src/**'
      - 'build.gradle'
      - '.github/workflows/**'
    paths-ignore:
      - '**.md'
      - 'docs/**'

# 3. Artifact retention 최소화
- uses: actions/upload-artifact@v4
  with:
    retention-days: 3  # 기본 90일 → 3일

# 4. 조건부 Job 실행
jobs:
  deploy:
    if: github.ref == 'refs/heads/main'  # main 브랜치만
```

### 비용 모니터링

```
Settings > Billing > Actions
→ 월간 사용량/잔여 무료 분 확인

Tip: 무료 플랜으로 충분한 규모라면
     Self-hosted Runner 고려 X (운영 비용 > 사용 비용)
```

---

## 9) 트러블슈팅 가이드

| 증상 | 원인 | 해결 |
|------|------|------|
| "Resource not accessible by integration" | 권한 부족 | `permissions:` 블록에 필요 권한 추가 |
| 캐시 미스가 반복됨 | 키 해시가 매번 바뀜 | `restore-keys:` 추가로 부분 매칭 |
| Docker push 403 | 레지스트리 인증 누락 | `docker/login-action` 확인 |
| "Process completed with exit code 1" | 빌드/테스트 실패 | `--info` 플래그로 상세 로그 확인 |
| Job이 6시간 이상 실행 | timeout 미설정 | `timeout-minutes:` 추가 |
| Fork PR에서 secrets가 null | 보안 제한 (정상) | `pull_request_target` 사용 시 보안 검토 |

### 디버깅 팁

```yaml
# 1. 디버그 로깅 활성화
# Repository Settings > Secrets > ACTIONS_RUNNER_DEBUG = true

# 2. Step 디버깅
- name: Debug Context
  run: |
    echo "github.ref: ${{ github.ref }}"
    echo "github.sha: ${{ github.sha }}"
    echo "github.event_name: ${{ github.event_name }}"

# 3. SSH 접속 (긴급 디버깅)
- uses: mxschmitt/action-tmate@v3
  if: ${{ failure() }}  # 실패 시에만 SSH 세션 생성
```

---

## 10) 운영 체크리스트

### CI 파이프라인 설정

- [ ] `concurrency` + `cancel-in-progress` 설정
- [ ] `timeout-minutes` 설정 (기본값 6시간은 너무 김)
- [ ] `permissions:` 최소 권한 명시
- [ ] 캐시 전략 (Gradle/Docker/npm)
- [ ] 테스트 결과 PR 댓글 연동

### 보안

- [ ] Secret Scanning (gitleaks) CI 게이트
- [ ] SAST (CodeQL/SonarQube) 추가
- [ ] 의존성 취약점 스캔 (Dependabot/OWASP)
- [ ] 액션 버전 SHA 고정 (주요 액션)
- [ ] `pull_request_target` 사용 시 보안 검토

### CD 파이프라인 설정

- [ ] Environment 승인 게이트 (production)
- [ ] Docker 이미지 태깅 전략 (SHA + semver)
- [ ] 롤백 절차 문서화
- [ ] Smoke test 자동화 (배포 직후)

### 비용

- [ ] 월간 사용량 모니터링
- [ ] `paths-ignore` 설정 (docs/README 변경 시 빌드 방지)
- [ ] Artifact retention 최소화
- [ ] 필요 시 Self-hosted Runner 검토

---

## 요약

| 항목 | 핵심 |
|------|------|
| CI | 코드 병합할 때마다 자동으로 빌드+테스트 |
| CD | 테스트 통과하면 자동(or 승인 후) 배포 |
| Secrets | 비밀번호는 코드에 넣지 말고 GitHub Secrets |
| Cache | Gradle/Docker 캐시로 빌드 시간 50%+ 단축 |
| Matrix | JDK 17/21 × Postgres/MySQL 조합을 한 번에 테스트 |
| Security | 최소 권한 + SHA 고정 + Secret Scanning |
| Reusable | 조직 공통 워크플로우로 표준화 |
| Cost | concurrency + path filter + retention으로 비용 관리 |

---

## 연습(추천)

1. **기본 CI 구축**: Spring Boot 프로젝트에 `build + test` 워크플로우를 추가하고, PR에서 테스트 결과를 확인할 수 있도록 설정하기
2. **Matrix 테스트**: JDK 17/21 × 2개 DB로 Matrix 빌드를 구성하고, 호환성을 검증하기
3. **Docker 파이프라인**: Multi-stage Dockerfile + GHCR push + SHA 태깅을 구축하기
4. **보안 하드닝**: gitleaks + CodeQL + Dependabot을 추가하고, 의도적으로 취약점을 넣어 차단되는지 확인하기
5. **비용 분석**: 한 달간 Actions 사용량을 기록하고, `concurrency` + `paths-ignore` 적용 전후를 비교하기

---

## 관련 심화 학습

- [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/) — SBOM, 서명, 공급망 공격 방어
- [비밀 관리](/learning/deep-dive/deep-dive-secret-management/) — Vault/Secrets Manager 연동
- [GitHub Actions CI 파이프라인 (심화)](/learning/deep-dive/deep-dive-github-actions-ci-pipeline/) — 고급 패턴, 커스텀 액션
- [Docker 기초](/learning/deep-dive/deep-dive-docker-basics/) — 컨테이너/이미지 기본
- [Docker Compose와 네트워크](/learning/deep-dive/deep-dive-docker-compose-network/) — 로컬 개발 환경
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — 컨테이너 오케스트레이션
- [Feature Flags](/learning/deep-dive/deep-dive-feature-flags/) — 배포와 릴리스 분리
- [배포 Runbook](/learning/deep-dive/deep-dive-deployment-runbook/) — 배포 절차 문서화
