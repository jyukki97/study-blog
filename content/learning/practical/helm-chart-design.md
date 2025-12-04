---
title: "Helm Chart 설계기"
date: 2025-01-22
topic: "DevOps"
topic_icon: "⎈"
topic_description: "Kubernetes 애플리케이션 패키징 및 배포 자동화"
tags: ["Kubernetes", "Helm", "DevOps", "Deployment", "Infrastructure"]
categories: ["DevOps", "Kubernetes"]
draft: false
---

## 1. 문제 상황

### 1.1 수동 배포의 한계

마이크로서비스 아키텍처로 전환하면서 10개 이상의 서비스를 Kubernetes에 배포하게 되었습니다.

**문제점**:
- 각 서비스마다 20개 이상의 YAML 파일 수동 관리
- 환경별(dev, staging, production) 중복 설정 파일
- ConfigMap, Secret, Service, Deployment 간 일관성 유지 어려움
- 배포 순서 및 의존성 관리 복잡
- 롤백 시 어떤 버전으로 돌아가야 할지 불명확

### 1.2 발생한 실제 장애

**시나리오**: Production 배포 중 ConfigMap과 Deployment의 불일치로 서비스 장애 발생

```bash
# 개발자 A: ConfigMap 업데이트
kubectl apply -f configmap.yaml

# 개발자 B: Deployment 업데이트 (기존 ConfigMap 참조)
kubectl apply -f deployment.yaml

# 결과: 새로운 ConfigMap 키를 참조하는 Deployment가
# 기존 ConfigMap을 찾아 CrashLoopBackOff 발생
```

**피해**:
- 서비스 다운타임: 15분
- 영향받은 사용자: 약 2,000명
- 수동 롤백 시간: 8분

## 2. Helm이란?

### 2.1 개념

**Helm**: Kubernetes의 패키지 매니저로, 복잡한 애플리케이션을 Chart라는 패키지로 관리

```
┌──────────────────────────────────────────┐
│ Helm Chart                               │
│  ├── Chart.yaml (메타데이터)              │
│  ├── values.yaml (설정 값)               │
│  ├── templates/                          │
│  │   ├── deployment.yaml                │
│  │   ├── service.yaml                   │
│  │   ├── configmap.yaml                 │
│  │   ├── secret.yaml                    │
│  │   └── ingress.yaml                   │
│  └── charts/ (의존성 Chart)              │
└──────────────────────────────────────────┘
```

### 2.2 주요 기능

1. **패키징**: 여러 Kubernetes 리소스를 하나의 Chart로 묶음
2. **템플릿팅**: Go 템플릿으로 설정값 주입
3. **버전 관리**: Chart 버전과 Release 이력 관리
4. **의존성 관리**: 다른 Chart를 의존성으로 포함
5. **쉬운 롤백**: 이전 버전으로 한 번에 롤백

## 3. Helm Chart 구조 설계

### 3.1 Chart.yaml

**기본 구조**:

```yaml
apiVersion: v2
name: order-service
description: Order management microservice
type: application
version: 1.2.3        # Chart 버전 (변경 시마다 증가)
appVersion: "2.5.0"   # 애플리케이션 버전

keywords:
  - order
  - ecommerce
  - microservice

maintainers:
  - name: DevOps Team
    email: devops@company.com

dependencies:
  - name: postgresql
    version: 12.1.5
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled

  - name: redis
    version: 17.3.7
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
```

**버전 관리 전략**:
- **Chart Version**: Chart 구조나 템플릿이 변경될 때 증가
- **App Version**: 애플리케이션 이미지 버전
- **Semantic Versioning**: MAJOR.MINOR.PATCH 규칙 따름

### 3.2 values.yaml

**계층적 설정 구조**:

```yaml
# 공통 설정
nameOverride: ""
fullnameOverride: ""

# Replica 설정
replicaCount: 3

# 이미지 설정
image:
  repository: company/order-service
  pullPolicy: IfNotPresent
  tag: ""  # 빈 문자열이면 Chart appVersion 사용

imagePullSecrets:
  - name: docker-registry-secret

# 서비스 설정
service:
  type: ClusterIP
  port: 8080
  targetPort: http
  annotations: {}

# Ingress 설정
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: api.company.com
      paths:
        - path: /orders
          pathType: Prefix
  tls:
    - secretName: api-company-com-tls
      hosts:
        - api.company.com

# 리소스 제한
resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi

# Auto Scaling
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

# Health Check
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: http
  initialDelaySeconds: 60
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: http
  initialDelaySeconds: 30
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3

# 환경 변수
env:
  - name: SPRING_PROFILES_ACTIVE
    value: production
  - name: JAVA_OPTS
    value: "-Xms512m -Xmx1024m -XX:+UseG1GC"

# ConfigMap 데이터
config:
  application.yml: |
    spring:
      datasource:
        url: jdbc:postgresql://{{ .Release.Name }}-postgresql:5432/orders
        username: orderuser
      kafka:
        bootstrap-servers: kafka:9092
        consumer:
          group-id: order-service
      redis:
        host: {{ .Release.Name }}-redis-master
        port: 6379

# Secret 데이터 (실제 값은 별도 관리)
secrets:
  database-password: ""
  redis-password: ""
  jwt-secret: ""

# 데이터베이스 의존성
postgresql:
  enabled: true
  auth:
    username: orderuser
    database: orders
  primary:
    persistence:
      enabled: true
      size: 10Gi

# Redis 의존성
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
  master:
    persistence:
      enabled: true
      size: 2Gi
```

### 3.3 Deployment 템플릿

**templates/deployment.yaml**:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "order-service.fullname" . }}
  labels:
    {{- include "order-service.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "order-service.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
      labels:
        {{- include "order-service.selectorLabels" . | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "order-service.serviceAccountName" . }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          env:
            {{- toYaml .Values.env | nindent 12 }}
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ include "order-service.fullname" . }}
                  key: database-password
          volumeMounts:
            - name: config
              mountPath: /config
              readOnly: true
          livenessProbe:
            {{- toYaml .Values.livenessProbe | nindent 12 }}
          readinessProbe:
            {{- toYaml .Values.readinessProbe | nindent 12 }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      volumes:
        - name: config
          configMap:
            name: {{ include "order-service.fullname" . }}
```

**주요 패턴**:
- **Checksum Annotation**: ConfigMap/Secret 변경 시 Pod 재시작
- **Named Templates**: 공통 레이블/셀렉터 재사용
- **Conditional Rendering**: 조건부 리소스 생성
- **Security Context**: 보안 설정 강제

### 3.4 Helper Templates

**templates/_helpers.tpl**:

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "order-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "order-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "order-service.labels" -}}
helm.sh/chart: {{ include "order-service.chart" . }}
{{ include "order-service.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "order-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "order-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "order-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}
```

## 4. 다중 환경 관리

### 4.1 환경별 Values 파일

**파일 구조**:

```
helm/
├── Chart.yaml
├── values.yaml              # 기본값
├── values-dev.yaml          # 개발 환경
├── values-staging.yaml      # 스테이징 환경
├── values-production.yaml   # 프로덕션 환경
└── templates/
```

**values-dev.yaml**:

```yaml
replicaCount: 1

image:
  tag: "latest"
  pullPolicy: Always

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi

autoscaling:
  enabled: false

ingress:
  hosts:
    - host: dev-api.company.com
      paths:
        - path: /orders
          pathType: Prefix

postgresql:
  enabled: true
  primary:
    persistence:
      size: 1Gi

env:
  - name: SPRING_PROFILES_ACTIVE
    value: dev
  - name: LOG_LEVEL
    value: DEBUG
```

**values-production.yaml**:

```yaml
replicaCount: 5

image:
  tag: "2.5.0"
  pullPolicy: IfNotPresent

resources:
  limits:
    cpu: 2000m
    memory: 2Gi
  requests:
    cpu: 1000m
    memory: 1Gi

autoscaling:
  enabled: true
  minReplicas: 5
  maxReplicas: 20

ingress:
  hosts:
    - host: api.company.com
      paths:
        - path: /orders
          pathType: Prefix

postgresql:
  enabled: false  # 외부 관리형 DB 사용

env:
  - name: SPRING_PROFILES_ACTIVE
    value: production
  - name: LOG_LEVEL
    value: INFO
  - name: DATABASE_HOST
    value: prod-postgres.example.com
```

### 4.2 배포 명령어

```bash
# 개발 환경 배포
helm upgrade --install order-service ./helm \
  -f helm/values-dev.yaml \
  --namespace dev \
  --create-namespace

# 스테이징 환경 배포
helm upgrade --install order-service ./helm \
  -f helm/values-staging.yaml \
  --namespace staging \
  --create-namespace

# 프로덕션 환경 배포 (Dry-run으로 먼저 확인)
helm upgrade --install order-service ./helm \
  -f helm/values-production.yaml \
  --namespace production \
  --create-namespace \
  --dry-run --debug

# 실제 배포
helm upgrade --install order-service ./helm \
  -f helm/values-production.yaml \
  --namespace production \
  --create-namespace \
  --wait \
  --timeout 10m
```

### 4.3 Secret 관리

**Sealed Secrets 활용**:

```bash
# 1. Sealed Secrets Controller 설치
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system

# 2. Secret 생성
kubectl create secret generic order-service-secrets \
  --from-literal=database-password=secretpassword \
  --from-literal=jwt-secret=jwtsecret \
  --dry-run=client -o yaml > secret.yaml

# 3. Seal 암호화
kubeseal -f secret.yaml -w sealed-secret.yaml

# 4. Sealed Secret을 Chart에 포함
# templates/sealed-secret.yaml
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ include "order-service.fullname" . }}
spec:
  encryptedData:
    database-password: AgB... (암호화된 값)
    jwt-secret: AgC... (암호화된 값)
```

**Helm Secrets 플러그인 활용**:

```bash
# 1. Helm Secrets 플러그인 설치
helm plugin install https://github.com/jkroepke/helm-secrets

# 2. secrets.yaml 생성 (암호화할 값들)
# secrets.yaml
database:
  password: secretpassword
jwt:
  secret: jwtsecret

# 3. SOPS로 암호화
sops -e secrets.yaml > secrets.enc.yaml

# 4. 배포 시 복호화하여 사용
helm secrets upgrade --install order-service ./helm \
  -f helm/values-production.yaml \
  -f helm/secrets.enc.yaml \
  --namespace production
```

## 5. 고급 패턴

### 5.1 Init Containers

**데이터베이스 마이그레이션**:

```yaml
# templates/deployment.yaml
spec:
  template:
    spec:
      initContainers:
        # 데이터베이스 연결 대기
        - name: wait-for-db
          image: busybox:1.35
          command:
            - sh
            - -c
            - |
              until nc -z {{ .Release.Name }}-postgresql 5432; do
                echo "Waiting for database..."
                sleep 2
              done

        # 데이터베이스 마이그레이션
        - name: db-migration
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          command:
            - /bin/sh
            - -c
            - |
              java -jar /app/migration.jar migrate \
                --url jdbc:postgresql://{{ .Release.Name }}-postgresql:5432/orders \
                --username {{ .Values.postgresql.auth.username }}
          env:
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ include "order-service.fullname" . }}
                  key: database-password
```

### 5.2 Hooks

**Pre-Upgrade Hook (백업)**:

```yaml
# templates/pre-upgrade-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: "{{ .Release.Name }}-backup"
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-weight": "1"
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: backup
          image: postgres:15
          command:
            - /bin/sh
            - -c
            - |
              pg_dump -h {{ .Release.Name }}-postgresql \
                -U {{ .Values.postgresql.auth.username }} \
                -d {{ .Values.postgresql.auth.database }} \
                > /backup/db-backup-$(date +%Y%m%d-%H%M%S).sql
          env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ .Release.Name }}-postgresql
                  key: password
          volumeMounts:
            - name: backup
              mountPath: /backup
      volumes:
        - name: backup
          persistentVolumeClaim:
            claimName: backup-pvc
```

**Post-Install Hook (초기 데이터 로드)**:

```yaml
# templates/post-install-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: "{{ .Release.Name }}-seed-data"
  annotations:
    "helm.sh/hook": post-install
    "helm.sh/hook-weight": "2"
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: seed
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          command:
            - /bin/sh
            - -c
            - |
              java -jar /app/seed.jar \
                --datasource.url=jdbc:postgresql://{{ .Release.Name }}-postgresql:5432/orders
```

### 5.3 Custom Resource Definitions (CRD)

```yaml
# templates/servicemonitor.yaml
{{- if .Values.monitoring.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "order-service.fullname" . }}
  labels:
    {{- include "order-service.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      {{- include "order-service.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: http
      path: /actuator/prometheus
      interval: 30s
      scrapeTimeout: 10s
{{- end }}
```

### 5.4 조건부 리소스

```yaml
# templates/ingress.yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "order-service.fullname" . }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls }}
  tls:
    {{- range .Values.ingress.tls }}
    - hosts:
        {{- range .hosts }}
        - {{ . | quote }}
        {{- end }}
      secretName: {{ .secretName }}
    {{- end }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "order-service.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
```

## 6. CI/CD 통합

### 6.1 GitLab CI Pipeline

**.gitlab-ci.yml**:

```yaml
stages:
  - build
  - package
  - deploy

variables:
  HELM_VERSION: "3.12.0"
  CHART_PATH: "./helm"

build:
  stage: build
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  only:
    - main
    - develop

package-helm:
  stage: package
  image: alpine/helm:$HELM_VERSION
  script:
    # Chart 검증
    - helm lint $CHART_PATH

    # 의존성 업데이트
    - helm dependency update $CHART_PATH

    # Chart 패키징
    - helm package $CHART_PATH \
        --app-version $CI_COMMIT_SHA \
        --version $(cat $CHART_PATH/Chart.yaml | grep '^version:' | awk '{print $2}')

    # Chart Museum에 업로드
    - curl --data-binary "@order-service-*.tgz" \
        http://chartmuseum:8080/api/charts
  only:
    - main

deploy-dev:
  stage: deploy
  image: alpine/helm:$HELM_VERSION
  script:
    - helm upgrade --install order-service $CHART_PATH \
        -f $CHART_PATH/values-dev.yaml \
        --set image.tag=$CI_COMMIT_SHA \
        --namespace dev \
        --create-namespace \
        --wait \
        --timeout 10m
  environment:
    name: development
  only:
    - develop

deploy-staging:
  stage: deploy
  image: alpine/helm:$HELM_VERSION
  script:
    - helm upgrade --install order-service $CHART_PATH \
        -f $CHART_PATH/values-staging.yaml \
        --set image.tag=$CI_COMMIT_TAG \
        --namespace staging \
        --create-namespace \
        --wait \
        --timeout 10m
  environment:
    name: staging
  only:
    - tags

deploy-production:
  stage: deploy
  image: alpine/helm:$HELM_VERSION
  script:
    - helm upgrade --install order-service $CHART_PATH \
        -f $CHART_PATH/values-production.yaml \
        --set image.tag=$CI_COMMIT_TAG \
        --namespace production \
        --create-namespace \
        --wait \
        --timeout 10m \
        --atomic \
        --cleanup-on-fail
  environment:
    name: production
  when: manual  # 수동 승인 필요
  only:
    - tags
```

### 6.2 ArgoCD를 이용한 GitOps

**Application 매니페스트**:

```yaml
# argocd/order-service.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: order-service
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://gitlab.com/company/order-service.git
    targetRevision: main
    path: helm
    helm:
      valueFiles:
        - values-production.yaml
      parameters:
        - name: image.tag
          value: "2.5.0"
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

## 7. 테스트 및 검증

### 7.1 Helm Lint

```bash
# Chart 문법 검증
helm lint ./helm

# 엄격한 검증
helm lint ./helm --strict

# 특정 values 파일로 검증
helm lint ./helm -f helm/values-production.yaml
```

### 7.2 Template Rendering

```bash
# 템플릿 렌더링 확인
helm template order-service ./helm \
  -f helm/values-dev.yaml \
  --debug

# 특정 템플릿만 확인
helm template order-service ./helm \
  -f helm/values-dev.yaml \
  -s templates/deployment.yaml

# Dry-run으로 서버 측 검증
helm install order-service ./helm \
  -f helm/values-dev.yaml \
  --dry-run --debug
```

### 7.3 자동화 테스트

**tests/test-connection.yaml**:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "order-service.fullname" . }}-test-connection"
  annotations:
    "helm.sh/hook": test
spec:
  containers:
    - name: wget
      image: busybox
      command: ['wget']
      args: ['{{ include "order-service.fullname" . }}:{{ .Values.service.port }}/actuator/health']
  restartPolicy: Never
```

**테스트 실행**:

```bash
# Chart 설치 후 테스트
helm install order-service ./helm -f helm/values-dev.yaml
helm test order-service

# 테스트 결과 확인
kubectl logs -n default order-service-test-connection
```

## 8. 운영 및 모니터링

### 8.1 Release 관리

```bash
# Release 목록 조회
helm list -A

# Release 이력 조회
helm history order-service -n production

# 이전 버전으로 롤백
helm rollback order-service 3 -n production

# Release 삭제
helm uninstall order-service -n production
```

### 8.2 Release 상태 확인

```bash
# Release 상태 조회
helm status order-service -n production

# Release 값 조회
helm get values order-service -n production

# Release의 모든 매니페스트 조회
helm get manifest order-service -n production
```

## 9. 결과 및 개선 효과

### 9.1 배포 효율성

| 지표 | Before | After | 개선율 |
|------|--------|-------|--------|
| 배포 시간 | 평균 45분 | 평균 5분 | 89% 단축 |
| 배포 실패율 | 15% | 2% | 87% 감소 |
| 롤백 시간 | 평균 12분 | 평균 2분 | 83% 단축 |
| 환경별 설정 관리 시간 | 주 8시간 | 주 1시간 | 87% 감소 |

### 9.2 운영 안정성

- **설정 불일치로 인한 장애**: 월 4건 → 월 0건 (100% 감소)
- **배포 관련 장애**: 월 6건 → 월 0.5건 (92% 감소)
- **평균 다운타임**: 월 2시간 → 월 10분 (92% 단축)

### 9.3 개발 생산성

- **새 마이크로서비스 배포 준비 시간**: 2일 → 2시간 (92% 단축)
- **환경 간 이식성**: Helm Chart로 모든 환경 동일 방식 배포
- **표준화**: 팀 전체가 동일한 배포 방식 사용

## 10. 핵심 요약

### Helm Chart 설계 원칙

1. **단일 책임**: Chart는 하나의 애플리케이션만 담당
2. **재사용성**: Helper 템플릿으로 공통 로직 추출
3. **환경 분리**: values 파일로 환경별 설정 관리
4. **보안**: Secret은 암호화하여 저장

### 필수 구성 요소

- **Chart.yaml**: 메타데이터 및 의존성
- **values.yaml**: 기본 설정값
- **templates/**: Kubernetes 리소스 템플릿
- **_helpers.tpl**: 재사용 가능한 템플릿 함수

### 모범 사례

- **Checksum Annotation**: ConfigMap/Secret 변경 시 Pod 재시작
- **Health Checks**: Liveness/Readiness Probe 필수
- **Resource Limits**: CPU/메모리 제한 설정
- **Auto Scaling**: HPA로 자동 스케일링
- **Hooks**: Pre/Post Install/Upgrade Hook 활용

### 배포 체크리스트

- [ ] `helm lint`로 문법 검증
- [ ] `--dry-run --debug`로 렌더링 확인
- [ ] values 파일 환경별 분리
- [ ] Secret 암호화 적용
- [ ] 롤백 계획 수립
- [ ] 모니터링 설정 확인
