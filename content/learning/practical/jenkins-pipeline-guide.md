---
title: "Jenkins Pipeline 구축"
date: 2025-01-24
topic: "DevOps"
topic_icon: "🔧"
topic_description: "Jenkins를 활용한 CI/CD 파이프라인 설계 및 구축"
tags: ["Jenkins", "CI/CD", "DevOps", "Automation", "Pipeline"]
categories: ["DevOps", "CI/CD"]
draft: false
---

## 1. 문제 상황

### 1.1 수동 배포의 악순환

마이크로서비스 10개를 운영하면서 배포마다 수작업이 반복되었습니다.

**배포 절차** (서비스당 평균 45분 소요):
1. Git에서 최신 코드 Pull
2. 로컬에서 빌드 및 테스트 실행
3. Docker 이미지 빌드 및 푸시
4. kubectl로 Kubernetes 배포
5. 배포 확인 및 롤백 준비

**문제점**:
- 사람마다 배포 방식이 달라 일관성 없음
- 테스트 스킵으로 인한 프로덕션 장애 (월 5건)
- 배포 실패 시 롤백에 평균 15분 소요
- 야간/주말 배포 시 담당자 호출 (월 8회)

### 1.2 장애 사례

**시나리오**: 개발자가 테스트를 스킵하고 프로덕션 배포

```bash
# 개발자가 실행한 명령어
docker build -t order-service:latest .
docker push registry.example.com/order-service:latest
kubectl set image deployment/order-service \
  order-service=registry.example.com/order-service:latest
```

**결과**:
- 컴파일 에러가 있는 코드가 배포됨
- CrashLoopBackOff 발생으로 서비스 다운
- 다운타임: 8분 (롤백까지 시간)
- 영향받은 거래: 약 350건

## 2. Jenkins Pipeline as Code

### 2.1 Declarative Pipeline 기본 구조

**Jenkinsfile**:

```groovy
pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: maven
    image: maven:3.8-openjdk-17
    command: ['cat']
    tty: true
  - name: docker
    image: docker:24.0
    command: ['cat']
    tty: true
    volumeMounts:
    - name: docker-sock
      mountPath: /var/run/docker.sock
  - name: kubectl
    image: bitnami/kubectl:latest
    command: ['cat']
    tty: true
  volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
'''
        }
    }

    environment {
        DOCKER_REGISTRY = 'registry.example.com'
        DOCKER_CREDENTIALS = credentials('docker-registry-credentials')
        KUBECONFIG = credentials('kubeconfig-prod')
        APP_NAME = 'order-service'
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main',
                    url: 'https://github.com/company/order-service.git',
                    credentialsId: 'github-credentials'
            }
        }

        stage('Build') {
            steps {
                container('maven') {
                    sh 'mvn clean package -DskipTests'
                }
            }
        }

        stage('Test') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        container('maven') {
                            sh 'mvn test'
                        }
                    }
                }

                stage('Integration Tests') {
                    steps {
                        container('maven') {
                            sh 'mvn verify -P integration-tests'
                        }
                    }
                }
            }
            post {
                always {
                    junit '**/target/surefire-reports/*.xml'
                }
            }
        }

        stage('Code Quality') {
            steps {
                container('maven') {
                    withSonarQubeEnv('SonarQube') {
                        sh 'mvn sonar:sonar'
                    }
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                container('docker') {
                    script {
                        def imageTag = "${env.DOCKER_REGISTRY}/${env.APP_NAME}:${env.BUILD_NUMBER}"

                        sh """
                            docker build -t ${imageTag} .
                            docker tag ${imageTag} ${env.DOCKER_REGISTRY}/${env.APP_NAME}:latest
                        """
                    }
                }
            }
        }

        stage('Push Docker Image') {
            steps {
                container('docker') {
                    script {
                        docker.withRegistry("https://${env.DOCKER_REGISTRY}", 'docker-registry-credentials') {
                            sh """
                                docker push ${env.DOCKER_REGISTRY}/${env.APP_NAME}:${env.BUILD_NUMBER}
                                docker push ${env.DOCKER_REGISTRY}/${env.APP_NAME}:latest
                            """
                        }
                    }
                }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                container('kubectl') {
                    sh """
                        kubectl set image deployment/${env.APP_NAME} \
                          ${env.APP_NAME}=${env.DOCKER_REGISTRY}/${env.APP_NAME}:${env.BUILD_NUMBER} \
                          --record

                        kubectl rollout status deployment/${env.APP_NAME} \
                          --timeout=5m
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                color: 'good',
                message: "배포 성공: ${env.APP_NAME} #${env.BUILD_NUMBER} (<${env.BUILD_URL}|상세보기>)"
            )
        }

        failure {
            slackSend(
                color: 'danger',
                message: "배포 실패: ${env.APP_NAME} #${env.BUILD_NUMBER} (<${env.BUILD_URL}|상세보기>)"
            )
        }
    }
}
```

## 3. 고급 파이프라인 패턴

### 3.1 Multi-Branch Pipeline

```groovy
// 브랜치별 다른 환경 배포
pipeline {
    agent any

    stages {
        stage('Determine Environment') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'main') {
                        env.DEPLOY_ENV = 'production'
                        env.REPLICAS = '5'
                    } else if (env.BRANCH_NAME == 'develop') {
                        env.DEPLOY_ENV = 'staging'
                        env.REPLICAS = '2'
                    } else {
                        env.DEPLOY_ENV = 'dev'
                        env.REPLICAS = '1'
                    }
                }
            }
        }

        stage('Deploy') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                    branch pattern: 'feature/.*'
                }
            }
            steps {
                sh """
                    helm upgrade --install ${env.APP_NAME} ./helm \
                      -f helm/values-${env.DEPLOY_ENV}.yaml \
                      --set replicaCount=${env.REPLICAS} \
                      --set image.tag=${env.BUILD_NUMBER} \
                      --namespace ${env.DEPLOY_ENV}
                """
            }
        }
    }
}
```

### 3.2 승인 단계 (Manual Approval)

```groovy
pipeline {
    agent any

    stages {
        // ... 빌드 및 테스트 단계

        stage('Deploy to Staging') {
            steps {
                deployToEnvironment('staging')
            }
        }

        stage('Approval for Production') {
            when {
                branch 'main'
            }
            steps {
                script {
                    timeout(time: 1, unit: 'HOURS') {
                        input message: 'Production 배포를 승인하시겠습니까?',
                              ok: '승인',
                              submitter: 'admin,devops-team'
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                deployToEnvironment('production')
            }
        }
    }
}

def deployToEnvironment(String environment) {
    sh """
        kubectl config use-context ${environment}
        kubectl apply -f k8s/deployment-${environment}.yaml
        kubectl rollout status deployment/${env.APP_NAME}
    """
}
```

### 3.3 롤백 자동화

```groovy
pipeline {
    agent any

    environment {
        HEALTH_CHECK_URL = "https://api.example.com/health"
    }

    stages {
        stage('Deploy') {
            steps {
                script {
                    sh 'kubectl apply -f k8s/deployment.yaml'

                    // 헬스 체크
                    def healthCheckPassed = false
                    for (int i = 0; i < 10; i++) {
                        sleep 10
                        def response = sh(
                            script: "curl -s -o /dev/null -w '%{http_code}' ${env.HEALTH_CHECK_URL}",
                            returnStdout: true
                        ).trim()

                        if (response == '200') {
                            healthCheckPassed = true
                            break
                        }
                    }

                    if (!healthCheckPassed) {
                        error("Health check failed after deployment")
                    }
                }
            }
        }
    }

    post {
        failure {
            script {
                echo "Deployment failed, rolling back..."

                sh """
                    kubectl rollout undo deployment/${env.APP_NAME}
                    kubectl rollout status deployment/${env.APP_NAME}
                """

                slackSend(
                    color: 'danger',
                    message: "배포 실패 및 롤백 완료: ${env.APP_NAME} #${env.BUILD_NUMBER}"
                )
            }
        }
    }
}
```

## 4. Shared Libraries

### 4.1 라이브러리 구조

```
jenkins-shared-library/
├── vars/
│   ├── buildDockerImage.groovy
│   ├── deployToKubernetes.groovy
│   ├── runTests.groovy
│   └── notifySlack.groovy
└── src/
    └── com/
        └── company/
            └── jenkins/
                └── Utils.groovy
```

**vars/buildDockerImage.groovy**:

```groovy
def call(String imageName, String imageTag = 'latest') {
    sh """
        docker build -t ${imageName}:${imageTag} .
        docker push ${imageName}:${imageTag}
    """
}
```

**vars/deployToKubernetes.groovy**:

```groovy
def call(Map config) {
    def appName = config.appName
    def environment = config.environment
    def imageTag = config.imageTag

    sh """
        kubectl config use-context ${environment}
        kubectl set image deployment/${appName} \
          ${appName}=${appName}:${imageTag} \
          --record

        kubectl rollout status deployment/${appName} --timeout=5m
    """
}
```

### 4.2 Shared Library 사용

```groovy
@Library('jenkins-shared-library') _

pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                buildDockerImage(
                    imageName: "registry.example.com/${env.APP_NAME}",
                    imageTag: env.BUILD_NUMBER
                )
            }
        }

        stage('Deploy') {
            steps {
                deployToKubernetes(
                    appName: env.APP_NAME,
                    environment: 'production',
                    imageTag: env.BUILD_NUMBER
                )
            }
        }
    }

    post {
        always {
            notifySlack(
                status: currentBuild.result,
                message: "빌드 #${env.BUILD_NUMBER}"
            )
        }
    }
}
```

## 5. 보안 관리

### 5.1 Credentials 관리

```groovy
pipeline {
    agent any

    environment {
        // Jenkins Credentials 사용
        DOCKER_CREDS = credentials('docker-registry-credentials')
        AWS_ACCESS_KEY = credentials('aws-access-key-id')
        AWS_SECRET_KEY = credentials('aws-secret-access-key')
    }

    stages {
        stage('Login to Docker Registry') {
            steps {
                sh 'echo $DOCKER_CREDS_PSW | docker login -u $DOCKER_CREDS_USR --password-stdin'
            }
        }

        stage('Deploy to AWS') {
            steps {
                withAWS(credentials: 'aws-credentials', region: 'ap-northeast-2') {
                    sh '''
                        aws eks update-kubeconfig --name production-cluster
                        kubectl apply -f k8s/
                    '''
                }
            }
        }
    }
}
```

### 5.2 시크릿 스캔

```groovy
stage('Security Scan') {
    steps {
        // 시크릿 유출 체크
        sh 'gitleaks detect --source . --verbose --no-git'

        // 의존성 취약점 스캔
        sh 'mvn org.owasp:dependency-check-maven:check'

        // Docker 이미지 취약점 스캔
        sh 'trivy image ${DOCKER_REGISTRY}/${APP_NAME}:${BUILD_NUMBER}'
    }
}
```

## 6. 성능 최적화

### 6.1 캐싱 전략

```groovy
pipeline {
    agent {
        kubernetes {
            yaml '''
...
  containers:
  - name: maven
    image: maven:3.8-openjdk-17
    volumeMounts:
    - name: maven-cache
      mountPath: /root/.m2
  volumes:
  - name: maven-cache
    persistentVolumeClaim:
      claimName: maven-cache-pvc
'''
        }
    }

    stages {
        stage('Build with Cache') {
            steps {
                container('maven') {
                    sh 'mvn clean package -Dmaven.repo.local=/root/.m2/repository'
                }
            }
        }
    }
}
```

### 6.2 병렬 실행

```groovy
stage('Tests') {
    parallel {
        stage('Backend Tests') {
            steps {
                dir('backend') {
                    sh 'mvn test'
                }
            }
        }

        stage('Frontend Tests') {
            steps {
                dir('frontend') {
                    sh 'npm test'
                }
            }
        }

        stage('E2E Tests') {
            steps {
                sh 'npm run test:e2e'
            }
        }
    }
}
```

## 7. 모니터링 및 알림

### 7.1 Slack 통합

```groovy
def notifySlack(String buildStatus = 'STARTED') {
    def color
    def message

    if (buildStatus == 'STARTED') {
        color = '#D4DADF'
        message = "빌드 시작: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
    } else if (buildStatus == 'SUCCESS') {
        color = 'good'
        message = "빌드 성공: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
    } else {
        color = 'danger'
        message = "빌드 실패: ${env.JOB_NAME} #${env.BUILD_NUMBER}"
    }

    slackSend(
        color: color,
        message: "${message}\n실행 시간: ${currentBuild.durationString}\n<${env.BUILD_URL}|상세보기>"
    )
}
```

### 7.2 Grafana 메트릭

```groovy
post {
    always {
        script {
            // Prometheus로 메트릭 전송
            sh """
                curl -X POST http://prometheus-pushgateway:9091/metrics/job/jenkins/instance/${env.JOB_NAME} \
                  --data-binary @- <<EOF
jenkins_build_duration_seconds{job="${env.JOB_NAME}",result="${currentBuild.result}"} ${currentBuild.duration / 1000}
jenkins_build_result{job="${env.JOB_NAME}",result="${currentBuild.result}"} 1
EOF
            """
        }
    }
}
```

## 8. 결과 및 개선 효과

### 8.1 배포 효율성

| 지표 | Before | After | 개선율 |
|------|--------|-------|--------|
| 배포 시간 | 45분 | 8분 | 82% 단축 |
| 배포 실패율 | 15% | 2% | 87% 감소 |
| 롤백 시간 | 15분 | 2분 | 87% 단축 |
| 일일 배포 횟수 | 2회 | 12회 | 500% 증가 |

### 8.2 품질 향상

- **프로덕션 장애**: 월 5건 → 월 0.5건 (90% 감소)
- **테스트 커버리지**: 45% → 85% (40%p 증가)
- **코드 품질 점수**: 62점 → 88점 (42% 향상)

### 8.3 운영 효율성

- **야간 배포 호출**: 월 8회 → 월 0회 (100% 감소)
- **배포 관련 인력 시간**: 주 20시간 → 주 3시간 (85% 감소)

## 9. 핵심 요약

### Pipeline as Code 장점

- 버전 관리로 변경 이력 추적
- 코드 리뷰를 통한 품질 관리
- 재사용 가능한 표준화된 프로세스

### 필수 구성 요소

- **Checkout**: Git 소스 가져오기
- **Build**: 컴파일 및 패키징
- **Test**: 단위/통합 테스트
- **Quality**: 코드 품질 분석
- **Deploy**: 환경별 배포
- **Rollback**: 실패 시 자동 롤백

### 모범 사례

- Shared Library로 중복 제거
- Credentials는 Jenkins에서 중앙 관리
- 병렬 실행으로 빌드 시간 단축
- 헬스 체크로 배포 검증
- Slack 알림으로 실시간 모니터링
