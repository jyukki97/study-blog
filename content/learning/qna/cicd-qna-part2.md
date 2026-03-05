---
title: "CI/CD (Part 2: Jenkins Pipeline, 배포 전략)"
study_order: 703
date: 2025-12-01
topic: "DevOps"
topic_icon: "💬"
topic_description: "CI/CD, Jenkins, ArgoCD, Rollback 전략 관련 핵심 개념과 실전 예제 정리"
tags: ["CI/CD", "Jenkins", "ArgoCD", "DevOps"]
categories: ["DevOps"]
description: "Jenkins Pipeline Stage 구성, Blue-Green/Canary 배포 전략, 실무 롤백 패턴 Q&A"
draft: false
module: "qna"
---

## Q2. Jenkins Pipeline의 Stage는 어떻게 구성하나요?

### 답변

**Jenkins Stage**는 **파이프라인의 논리적 단계**로, 각 Stage는 독립적으로 실행되고 결과를 추적할 수 있습니다.

### Stage 구성 전략

**1. 빌드 Stage**:

```groovy
stage('Build') {
    steps {
        script {
            // Gradle 빌드
            sh './gradlew clean build -x test'

            // 빌드 결과물 저장
            archiveArtifacts artifacts: 'build/libs/*.jar',
                           fingerprint: true
        }
    }
    post {
        failure {
            echo 'Build failed!'
        }
    }
}
```

**2. 테스트 Stage (병렬 실행)**:

```groovy
stage('Test') {
    parallel {
        stage('Unit Test') {
            steps {
                sh './gradlew test'
                junit 'build/test-results/test/*.xml'
            }
        }

        stage('Integration Test') {
            steps {
                sh './gradlew integrationTest'
                junit 'build/test-results/integrationTest/*.xml'
            }
        }

        stage('E2E Test') {
            agent {
                label 'e2e-runner'
            }
            steps {
                sh 'npm run test:e2e'
            }
        }
    }
}
```

**3. 품질 검사 Stage**:

```groovy
stage('Code Quality') {
    steps {
        script {
            // SonarQube 분석
            withSonarQubeEnv('SonarQube') {
                sh './gradlew sonarqube'
            }

            // Quality Gate 대기
            timeout(time: 5, unit: 'MINUTES') {
                def qg = waitForQualityGate()
                if (qg.status != 'OK') {
                    error "Quality Gate failed: ${qg.status}"
                }
            }
        }
    }
}
```

**4. 보안 스캔 Stage**:

```groovy
stage('Security Scan') {
    parallel {
        stage('Dependency Check') {
            steps {
                sh './gradlew dependencyCheckAnalyze'
                publishHTML([
                    reportDir: 'build/reports',
                    reportFiles: 'dependency-check-report.html',
                    reportName: 'Dependency Check'
                ])
            }
        }

        stage('Container Scan') {
            steps {
                sh 'trivy image myapp:${BUILD_NUMBER}'
            }
        }
    }
}
```

**5. 배포 Stage**:

```groovy
stage('Deploy') {
    stages {
        stage('Deploy to Dev') {
            steps {
                sh 'kubectl apply -f k8s/dev/ --namespace=dev'
                sh 'kubectl rollout status deployment/myapp -n dev'
            }
        }

        stage('Smoke Test') {
            steps {
                script {
                    def response = sh(
                        script: 'curl -f https://dev.example.com/health',
                        returnStatus: true
                    )
                    if (response != 0) {
                        error 'Smoke test failed!'
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                input message: 'Deploy to Production?',
                      ok: 'Deploy',
                      submitter: 'tech-lead,devops'

                sh 'kubectl apply -f k8s/prod/ --namespace=production'
                sh 'kubectl rollout status deployment/myapp -n production'
            }
        }
    }
}
```

### Stage 설계 원칙

**1. Fail Fast 원칙**:

```groovy
// ✅ 빠른 단계부터 실행 (빠른 피드백)
stage('Lint') {           // 5초
stage('Build') {          // 1분
stage('Unit Test') {      // 3분
stage('Integration Test') { // 10분
stage('E2E Test') {       // 30분

// ❌ 느린 단계부터 실행 (피드백 느림)
stage('E2E Test') {       // 30분 후 실패
// → 30분 낭비!
```

**2. 병렬 실행**:

```groovy
// ✅ 독립적인 Stage는 병렬 실행
stage('Test') {
    parallel {
        stage('Unit Test')        // 3분
        stage('Integration Test') // 3분
        stage('E2E Test')        // 3분
    }
    // 총 실행 시간: 3분 (병렬)
}

// ❌ 순차 실행
stage('Unit Test')        // 3분
stage('Integration Test') // 3분
stage('E2E Test')        // 3분
// 총 실행 시간: 9분
```

### 꼬리 질문: when 조건은 언제 사용하나요?

**when 조건**으로 **특정 조건에서만 Stage 실행**:

```groovy
// 브랜치 조건
stage('Deploy to Production') {
    when {
        branch 'main'
    }
    steps {
        // main 브랜치에서만 실행
    }
}

// 환경 변수 조건
stage('Security Scan') {
    when {
        environment name: 'SECURITY_SCAN', value: 'true'
    }
    steps {
        // SECURITY_SCAN=true일 때만 실행
    }
}

// 변경 파일 조건
stage('Build Frontend') {
    when {
        changeset "frontend/**"
    }
    steps {
        // frontend/ 디렉토리 변경 시만 실행
    }
}

// 복합 조건
stage('Deploy') {
    when {
        allOf {
            branch 'main'
            environment name: 'DEPLOY_ENABLED', value: 'true'
            not {
                changeset "docs/**"
            }
        }
    }
    steps {
        // main 브랜치 + DEPLOY_ENABLED=true + docs 변경 아님
    }
}
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: CI/CD (Part 1: 기본 개념과 파이프라인)](/learning/qna/cicd-qna/)**
