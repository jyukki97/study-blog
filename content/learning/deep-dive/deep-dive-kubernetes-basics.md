---
title: "Kubernetes 기초: 컨테이너 오케스트레이션 시작하기"
date: 2025-12-03
draft: false
topic: "DevOps"
tags: ["Kubernetes", "K8s", "Pod", "Deployment", "Service", "Container Orchestration"]
categories: ["Backend Deep Dive"]
description: "Kubernetes 핵심 개념과 Pod, Deployment, Service를 이용한 애플리케이션 배포 실습"
module: "ops-observability"
study_order: 320
---

## 이 글에서 얻는 것

- **Kubernetes**(K8s)가 무엇이고, 왜 필요한지 이해합니다.
- **Pod, Deployment, Service** 같은 핵심 리소스를 설명할 수 있습니다.
- **kubectl** 명령어로 애플리케이션을 배포하고 관리할 수 있습니다.
- **YAML** 파일로 Kubernetes 리소스를 정의할 수 있습니다.

## 0) Kubernetes는 "컨테이너를 자동으로 관리"한다

### Kubernetes란?

```
Kubernetes (K8s) = 컨테이너 오케스트레이션 플랫폼

목적:
- 컨테이너화된 애플리케이션 자동 배포
- 스케일링 (자동 확장/축소)
- 로드 밸런싱
- 자가 치유 (Self-healing)
- 롤링 업데이트
```

### Docker vs Kubernetes

```
Docker:
- 단일 호스트에서 컨테이너 실행
- 수동 관리 필요
- 단일 장애점

Kubernetes:
- 여러 서버(클러스터)에서 컨테이너 실행
- 자동 관리 (선언적)
- 고가용성
```

**시나리오:**
```
Docker만 사용:
- 컨테이너 3개 실행 중
- 하나 죽음 → 수동으로 재시작 필요

Kubernetes 사용:
- "항상 3개 유지"라고 선언
- 하나 죽음 → 자동으로 새 컨테이너 시작
```

## 1) Kubernetes 아키텍처

### 1-1) 클러스터 구조

```
┌─────────────────────────────────────────┐
│           Kubernetes Cluster            │
├─────────────────────────────────────────┤
│  Control Plane (Master Node)            │
│  ┌──────────────────────────────────┐   │
│  │ API Server                       │   │ ← kubectl 명령 처리
│  │ Scheduler                        │   │ ← Pod 배치 결정
│  │ Controller Manager               │   │ ← 상태 관리
│  │ etcd (Key-Value Store)           │   │ ← 클러스터 상태 저장
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────┐
│  Worker Nodes (실제 컨테이너 실행)       │
├─────────────────────────────────────────┤
│  Node 1          Node 2         Node 3  │
│  ┌────────┐      ┌────────┐    ┌─────┐ │
│  │ Pod A  │      │ Pod B  │    │Pod C│ │
│  │ Pod D  │      │ Pod E  │    └─────┘ │
│  └────────┘      └────────┘             │
│  kubelet         kubelet       kubelet  │ ← Node 관리
│  kube-proxy      kube-proxy    kube-pr. │ ← 네트워킹
└─────────────────────────────────────────┘
```

## 2) 핵심 개념

### 2-1) Pod: 가장 작은 배포 단위

```
Pod = 하나 이상의 컨테이너를 포함하는 그룹

특징:
- 같은 Pod의 컨테이너는 네트워크/스토리지 공유
- 함께 스케줄링됨
- 같은 Node에 배치
- IP 주소 공유

일반적으로:
- 1 Pod = 1 컨테이너 (권장)
- 밀접하게 연관된 컨테이너만 같은 Pod에
```

**Pod YAML:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
  labels:
    app: myapp
spec:
  containers:
  - name: myapp-container
    image: myapp:1.0
    ports:
    - containerPort: 8080
```

**생성:**
```bash
kubectl apply -f pod.yaml

# Pod 목록
kubectl get pods

# Pod 상세 정보
kubectl describe pod myapp-pod

# Pod 로그
kubectl logs myapp-pod

# Pod 삭제
kubectl delete pod myapp-pod
```

### 2-2) Deployment: Pod 관리

```
Deployment = Pod의 생명주기 관리

기능:
- 원하는 Pod 개수 유지 (ReplicaSet)
- 롤링 업데이트
- 롤백
- 스케일링
```

**Deployment YAML:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-deployment
spec:
  replicas: 3  # Pod 3개 유지
  selector:
    matchLabels:
      app: myapp
  template:  # Pod 템플릿
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: myapp:1.0
        ports:
        - containerPort: 8080
        env:
        - name: SPRING_PROFILES_ACTIVE
          value: "prod"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

**명령:**
```bash
# Deployment 생성
kubectl apply -f deployment.yaml

# Deployment 목록
kubectl get deployments

# Pod 목록 (Deployment가 생성한 Pod)
kubectl get pods

# 스케일링
kubectl scale deployment myapp-deployment --replicas=5

# 이미지 업데이트 (롤링 업데이트)
kubectl set image deployment/myapp-deployment myapp=myapp:2.0

# 롤백
kubectl rollout undo deployment/myapp-deployment

# 업데이트 상태 확인
kubectl rollout status deployment/myapp-deployment

# Deployment 삭제
kubectl delete deployment myapp-deployment
```

### 2-3) Service: 네트워크 노출

```
Service = Pod에 대한 안정적인 네트워크 엔드포인트

필요한 이유:
- Pod IP는 재시작 시 변경됨
- 여러 Pod에 로드 밸런싱 필요

Service 종류:
1. ClusterIP (기본): 클러스터 내부에서만 접근
2. NodePort: 각 Node의 포트로 노출
3. LoadBalancer: 클라우드 로드밸런서 생성
```

**Service YAML:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  type: ClusterIP
  selector:
    app: myapp  # 이 레이블을 가진 Pod으로 트래픽 전달
  ports:
  - protocol: TCP
    port: 80        # Service 포트
    targetPort: 8080  # Pod 포트
```

**명령:**
```bash
# Service 생성
kubectl apply -f service.yaml

# Service 목록
kubectl get services

# Service 상세 정보
kubectl describe service myapp-service

# Service 삭제
kubectl delete service myapp-service
```

### 2-4) Service 종류별 예시

**1. ClusterIP (내부 통신)**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
spec:
  type: ClusterIP  # 기본값
  selector:
    app: mysql
  ports:
  - port: 3306
    targetPort: 3306
```

**2. NodePort (외부 노출)**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  type: NodePort
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
    nodePort: 30080  # 각 Node의 30080 포트로 접근 가능
```

**3. LoadBalancer (클라우드)**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  type: LoadBalancer
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
# AWS/GCP/Azure에서 자동으로 로드밸런서 생성
```

## 3) kubectl 기본 명령어

### 3-1) 리소스 조회

```bash
# 모든 Pod
kubectl get pods

# 모든 Deployment
kubectl get deployments

# 모든 Service
kubectl get services

# 모든 리소스
kubectl get all

# 다른 네임스페이스
kubectl get pods -n kube-system

# 상세 정보
kubectl describe pod myapp-pod

# YAML 형식으로 출력
kubectl get pod myapp-pod -o yaml

# JSON 형식
kubectl get pod myapp-pod -o json
```

### 3-2) 리소스 생성/수정/삭제

```bash
# 파일로 생성
kubectl apply -f deployment.yaml

# 여러 파일
kubectl apply -f deployment.yaml -f service.yaml

# 디렉토리
kubectl apply -f ./k8s/

# 삭제
kubectl delete -f deployment.yaml

# 리소스 직접 삭제
kubectl delete pod myapp-pod
kubectl delete deployment myapp-deployment
kubectl delete service myapp-service
```

### 3-3) 디버깅

```bash
# 로그 확인
kubectl logs myapp-pod

# 실시간 로그
kubectl logs -f myapp-pod

# 여러 컨테이너 중 특정 컨테이너
kubectl logs myapp-pod -c container-name

# Pod 내부 접속
kubectl exec -it myapp-pod -- bash

# 단일 명령 실행
kubectl exec myapp-pod -- ls /app

# 포트 포워딩 (로컬 → Pod)
kubectl port-forward pod/myapp-pod 8080:8080
# http://localhost:8080으로 접근 가능

# 이벤트 확인
kubectl get events

# 리소스 사용량
kubectl top nodes
kubectl top pods
```

## 4) 실전 예제: Spring Boot 배포

### 4-1) Deployment + Service

```yaml
# myapp-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: myapp:1.0
        ports:
        - containerPort: 8080
        env:
        - name: SPRING_PROFILES_ACTIVE
          value: "prod"
        - name: SPRING_DATASOURCE_URL
          value: "jdbc:mysql://mysql-service:3306/mydb"
        livenessProbe:  # 컨테이너 살아있는지 체크
          httpGet:
            path: /actuator/health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:  # 트래픽 받을 준비됐는지 체크
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"

---
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  type: LoadBalancer
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
```

**배포:**
```bash
kubectl apply -f myapp-deployment.yaml

# 상태 확인
kubectl get pods
kubectl get services

# 로그 확인
kubectl logs -l app=myapp --tail=100

# 스케일링
kubectl scale deployment myapp --replicas=5
```

### 4-2) ConfigMap + Secret

**ConfigMap (설정):**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
data:
  application.properties: |
    spring.application.name=myapp
    logging.level.root=INFO
```

**Secret (민감 정보):**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: myapp-secret
type: Opaque
data:
  # base64 인코딩 (echo -n 'secret' | base64)
  db-password: c2VjcmV0
```

**Deployment에서 사용:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
      - name: myapp
        image: myapp:1.0
        env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: myapp-secret
              key: db-password
        volumeMounts:
        - name: config
          mountPath: /app/config
      volumes:
      - name: config
        configMap:
          name: myapp-config
```

### 4-3) 전체 스택 배포

```yaml
# mysql-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
      - name: mysql
        image: mysql:8.0
        env:
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: password
        - name: MYSQL_DATABASE
          value: mydb
        ports:
        - containerPort: 3306
        volumeMounts:
        - name: mysql-storage
          mountPath: /var/lib/mysql
      volumes:
      - name: mysql-storage
        persistentVolumeClaim:
          claimName: mysql-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
spec:
  type: ClusterIP
  selector:
    app: mysql
  ports:
  - port: 3306
    targetPort: 3306
```

## 5) 네임스페이스: 리소스 격리

```bash
# 네임스페이스 생성
kubectl create namespace dev
kubectl create namespace prod

# 네임스페이스별 배포
kubectl apply -f deployment.yaml -n dev
kubectl apply -f deployment.yaml -n prod

# 네임스페이스 확인
kubectl get namespaces

# 특정 네임스페이스의 Pod
kubectl get pods -n dev

# 기본 네임스페이스 변경
kubectl config set-context --current --namespace=dev
```

**네임스페이스 사용 예:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: dev

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: dev  # dev 네임스페이스에 배포
spec:
  # ...
```

## 6) 베스트 프랙티스

### ✅ 1. 리소스 요청/제한 설정

```yaml
resources:
  requests:  # 최소 보장
    memory: "512Mi"
    cpu: "500m"
  limits:    # 최대 사용
    memory: "1Gi"
    cpu: "1000m"
```

### ✅ 2. Health Check 설정

```yaml
livenessProbe:  # 죽었는지 확인 (재시작)
  httpGet:
    path: /actuator/health
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:  # 준비됐는지 확인 (트래픽 전달)
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
```

### ✅ 3. 레이블 활용

```yaml
metadata:
  labels:
    app: myapp
    version: v1.0
    environment: prod
```

### ✅ 4. 네임스페이스 분리

```
dev: 개발 환경
staging: 스테이징 환경
prod: 운영 환경
```

## 7) 자주 하는 실수

### ❌ 실수 1: 리소스 제한 없이 배포

```yaml
# ❌ 리소스 제한 없음 → 메모리/CPU 과다 사용 가능
# ✅ 반드시 requests/limits 설정
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
```

### ❌ 실수 2: Health Check 미설정

```yaml
# ✅ 항상 Health Check 설정
livenessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
```

### ❌ 실수 3: Secret을 ConfigMap에 저장

```yaml
# ❌ 나쁜 예
kind: ConfigMap
data:
  password: "mypassword"  # 평문!

# ✅ 좋은 예
kind: Secret
data:
  password: "bXlwYXNzd29yZA=="  # base64 인코딩
```

## 연습 (추천)

1. **Minikube 설치**
   - 로컬 Kubernetes 클러스터 실행
   - Spring Boot 앱 배포

2. **Deployment 배포**
   - Pod 3개로 배포
   - 스케일링, 롤링 업데이트 실습

3. **Service 노출**
   - ClusterIP, NodePort, LoadBalancer 비교
   - 로드 밸런싱 확인

## 요약: 스스로 점검할 것

- Kubernetes의 필요성을 설명할 수 있다
- Pod, Deployment, Service의 역할을 이해한다
- kubectl 명령어로 리소스를 관리할 수 있다
- YAML로 Kubernetes 리소스를 정의할 수 있다
- Health Check와 리소스 제한을 설정할 수 있다

## 다음 단계

- Helm 차트: `/learning/deep-dive/deep-dive-helm-basics/`
- Ingress 컨트롤러: `/learning/deep-dive/deep-dive-kubernetes-ingress/`
- 모니터링 (Prometheus): `/learning/deep-dive/deep-dive-prometheus-grafana/`
