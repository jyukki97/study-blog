---
title: "Docker 기초: 컨테이너로 애플리케이션 격리하고 배포하기"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Docker", "Container", "Dockerfile", "Docker Compose", "Image"]
categories: ["Backend Deep Dive"]
description: "Docker 컨테이너의 개념부터 Dockerfile 작성, 이미지 빌드, 컨테이너 실행까지 실무 가이드"
module: "ops-observability"
study_order: 301
---

## 이 글에서 얻는 것

- **Docker**가 무엇이고, 왜 필요한지 이해합니다.
- **Dockerfile**로 이미지를 빌드하고, 컨테이너를 실행할 수 있습니다.
- **볼륨**과 **네트워크**로 데이터 영속성과 컨테이너 간 통신을 관리합니다.
- **Docker Compose**로 멀티 컨테이너 애플리케이션을 구성합니다.

## 0) Docker는 "애플리케이션을 격리된 환경에서 실행"한다

### Docker란?

```
Docker = 컨테이너 기반 가상화 플랫폼

목적:
- 애플리케이션을 독립된 환경에서 실행
- "내 컴퓨터에서는 되는데..."를 해결
- 빠른 배포와 확장
```

### 컨테이너 vs 가상 머신 (VM)

```
┌─────────────────────┐   ┌─────────────────────┐
│   Virtual Machine   │   │     Container       │
├─────────────────────┤   ├─────────────────────┤
│   App A │   App B   │   │   App A │   App B   │
│  ─────  │  ─────    │   │  ─────  │  ─────    │
│  Bins   │   Bins    │   │  Bins   │   Bins    │
│  Libs   │   Libs    │   │  Libs   │   Libs    │
├─────────┼───────────┤   └─────────┴───────────┘
│ Guest OS│ Guest OS  │          Docker Engine
├─────────┴───────────┤   ─────────────────────
│    Hypervisor       │   Host OS (Linux/Mac/Win)
├─────────────────────┤   ─────────────────────
│     Host OS         │   Infrastructure
├─────────────────────┤
│   Infrastructure    │
└─────────────────────┘

VM:
- 각 VM이 전체 OS 포함
- 무겁고 느림 (GB 단위)
- 부팅 시간 오래 걸림

Container:
- OS 커널 공유
- 가볍고 빠름 (MB 단위)
- 초 단위로 시작
```

## 1) Docker 핵심 개념

### 1-1) 이미지 (Image)

```
이미지 = 애플리케이션 실행에 필요한 모든 것

포함 내용:
- 애플리케이션 코드
- 런타임 (Java, Python 등)
- 라이브러리/의존성
- 환경 변수
- 설정 파일

특징:
- 읽기 전용 (Immutable)
- 레이어 구조 (효율적 저장)
- Docker Hub에서 공유
```

### 1-2) 컨테이너 (Container)

```
컨테이너 = 이미지의 실행 인스턴스

특징:
- 이미지로부터 생성
- 격리된 프로세스
- 읽기/쓰기 가능
- 여러 컨테이너가 같은 이미지 사용 가능
```

**비유:**
```
이미지 = 클래스
컨테이너 = 인스턴스

class Image { }
Container c1 = new Image();  // 컨테이너 1
Container c2 = new Image();  // 컨테이너 2
```

## 2) Docker 기본 명령어

### 2-1) 이미지 관리

```bash
# 이미지 검색 (Docker Hub)
docker search nginx

# 이미지 다운로드
docker pull nginx:latest

# 이미지 목록
docker images

# 결과:
# REPOSITORY   TAG       IMAGE ID       SIZE
# nginx        latest    605c77e624dd   141MB

# 이미지 삭제
docker rmi nginx:latest

# 사용하지 않는 이미지 정리
docker image prune
```

### 2-2) 컨테이너 실행

```bash
# 컨테이너 실행 (기본)
docker run nginx

# 백그라운드 실행 (-d: detached)
docker run -d nginx

# 포트 매핑 (-p: publish)
docker run -d -p 8080:80 nginx
# 호스트 8080 → 컨테이너 80

# 이름 지정 (--name)
docker run -d -p 8080:80 --name my-nginx nginx

# 환경 변수 (-e)
docker run -d -e MYSQL_ROOT_PASSWORD=secret mysql

# 대화형 모드 (-it: interactive + tty)
docker run -it ubuntu bash
# 컨테이너 안에서 bash 실행
```

### 2-3) 컨테이너 관리

```bash
# 실행 중인 컨테이너 목록
docker ps

# 모든 컨테이너 목록 (중지된 것 포함)
docker ps -a

# 컨테이너 중지
docker stop my-nginx

# 컨테이너 시작
docker start my-nginx

# 컨테이너 재시작
docker restart my-nginx

# 컨테이너 삭제
docker rm my-nginx

# 실행 중인 컨테이너 강제 삭제
docker rm -f my-nginx

# 모든 중지된 컨테이너 삭제
docker container prune
```

### 2-4) 컨테이너 접근

```bash
# 로그 확인
docker logs my-nginx

# 실시간 로그 (tail -f)
docker logs -f my-nginx

# 컨테이너 내부 접속
docker exec -it my-nginx bash

# 단일 명령 실행
docker exec my-nginx ls /usr/share/nginx/html

# 컨테이너 정보 확인
docker inspect my-nginx

# 리소스 사용량
docker stats my-nginx
```

## 3) Dockerfile: 이미지 만들기

### 3-1) Dockerfile 기본

```dockerfile
# 베이스 이미지
FROM openjdk:17-jdk-slim

# 작업 디렉토리 설정
WORKDIR /app

# 파일 복사
COPY build/libs/myapp.jar app.jar

# 환경 변수
ENV SPRING_PROFILES_ACTIVE=prod

# 포트 노출 (문서화 목적)
EXPOSE 8080

# 컨테이너 시작 시 실행할 명령
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**빌드:**
```bash
# 이미지 빌드
docker build -t myapp:1.0 .

# 실행
docker run -d -p 8080:8080 myapp:1.0
```

### 3-2) 멀티 스테이지 빌드 (권장)

```dockerfile
# Stage 1: Build
FROM gradle:8.5-jdk17 AS builder

WORKDIR /app
COPY . .

# Gradle 빌드
RUN gradle clean build -x test

# Stage 2: Runtime
FROM openjdk:17-jdk-slim

WORKDIR /app

# 빌드 스테이지에서 JAR 파일만 복사
COPY --from=builder /app/build/libs/myapp.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**장점:**
- 최종 이미지에 빌드 도구 불포함 → 이미지 크기 감소
- 보안 향상 (불필요한 도구 제거)

### 3-3) .dockerignore

```
# .dockerignore (이미지에 포함하지 않을 파일)
.git
.gradle
build
node_modules
*.md
.env
```

## 4) 볼륨: 데이터 영속성

### 4-1) 볼륨이 필요한 이유

```
문제:
- 컨테이너 삭제 시 데이터도 삭제됨

해결:
- 볼륨으로 데이터를 호스트에 저장
```

### 4-2) 볼륨 사용

```bash
# 볼륨 생성
docker volume create mysql-data

# 볼륨 마운트
docker run -d \
  -v mysql-data:/var/lib/mysql \
  -e MYSQL_ROOT_PASSWORD=secret \
  mysql

# 호스트 디렉토리 마운트 (바인드 마운트)
docker run -d \
  -v /home/user/data:/var/lib/mysql \
  -e MYSQL_ROOT_PASSWORD=secret \
  mysql

# 볼륨 목록
docker volume ls

# 볼륨 삭제
docker volume rm mysql-data
```

### 4-3) Spring Boot 예시

```bash
# 로그 디렉토리 마운트
docker run -d \
  -p 8080:8080 \
  -v /var/log/myapp:/app/logs \
  myapp:1.0

# 설정 파일 마운트
docker run -d \
  -p 8080:8080 \
  -v /etc/myapp/application.yml:/app/config/application.yml \
  myapp:1.0
```

## 5) 네트워크: 컨테이너 간 통신

### 5-1) 네트워크 생성

```bash
# 네트워크 생성
docker network create myapp-network

# 네트워크 목록
docker network ls

# 네트워크 상세 정보
docker network inspect myapp-network
```

### 5-2) 컨테이너 연결

```bash
# MySQL 컨테이너 (네트워크에 연결)
docker run -d \
  --name mysql \
  --network myapp-network \
  -e MYSQL_ROOT_PASSWORD=secret \
  -e MYSQL_DATABASE=mydb \
  mysql

# Spring Boot 컨테이너 (같은 네트워크)
docker run -d \
  --name myapp \
  --network myapp-network \
  -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:mysql://mysql:3306/mydb \
  -e SPRING_DATASOURCE_USERNAME=root \
  -e SPRING_DATASOURCE_PASSWORD=secret \
  myapp:1.0

# 같은 네트워크에서는 컨테이너 이름으로 통신 가능!
# "mysql"이 호스트명으로 동작
```

## 6) Docker Compose: 멀티 컨테이너 관리

### 6-1) docker-compose.yml

```yaml
version: '3.8'

services:
  # MySQL
  mysql:
    image: mysql:8.0
    container_name: mysql
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: mydb
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - myapp-network

  # Redis
  redis:
    image: redis:7
    container_name: redis
    networks:
      - myapp-network

  # Spring Boot App
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: myapp
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/mydb
      SPRING_DATASOURCE_USERNAME: root
      SPRING_DATASOURCE_PASSWORD: secret
      SPRING_REDIS_HOST: redis
    depends_on:
      - mysql
      - redis
    networks:
      - myapp-network

volumes:
  mysql-data:

networks:
  myapp-network:
```

### 6-2) Compose 명령어

```bash
# 모든 서비스 시작 (백그라운드)
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 특정 서비스 로그
docker-compose logs -f app

# 서비스 중지
docker-compose stop

# 서비스 삭제 (볼륨 유지)
docker-compose down

# 서비스 + 볼륨 삭제
docker-compose down -v

# 특정 서비스만 재시작
docker-compose restart app

# 스케일링 (여러 인스턴스)
docker-compose up -d --scale app=3
```

## 7) 실전 예제

### 7-1) Spring Boot Dockerfile

```dockerfile
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app
COPY . .
RUN gradle clean build -x test

FROM openjdk:17-jdk-slim
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar

# 비루트 사용자 생성 (보안)
RUN useradd -m appuser
USER appuser

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 7-2) 전체 스택 docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/mydb
      SPRING_DATASOURCE_USERNAME: user
      SPRING_DATASOURCE_PASSWORD: password
      SPRING_REDIS_HOST: redis
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres-data:
```

## 8) 베스트 프랙티스

### ✅ 1. 경량 베이스 이미지 사용

```dockerfile
# ❌ 나쁜 예 (무거움)
FROM openjdk:17

# ✅ 좋은 예 (가벼움)
FROM openjdk:17-jdk-slim
# 또는
FROM eclipse-temurin:17-jre-alpine
```

### ✅ 2. 멀티 스테이지 빌드

```dockerfile
# 빌드 도구는 builder 스테이지에만
FROM gradle:8.5 AS builder
# ...

# 최종 이미지는 런타임만
FROM openjdk:17-jdk-slim
COPY --from=builder /app/build/libs/*.jar app.jar
```

### ✅ 3. .dockerignore 사용

```
# 불필요한 파일 제외
.git
.gradle
build
node_modules
```

### ✅ 4. 레이어 캐싱 활용

```dockerfile
# ❌ 나쁜 예 (코드 변경마다 전체 재빌드)
COPY . .
RUN gradle build

# ✅ 좋은 예 (의존성은 캐싱)
COPY build.gradle settings.gradle ./
RUN gradle dependencies
COPY src ./src
RUN gradle build
```

### ✅ 5. 환경 변수로 설정 분리

```bash
# 하드코딩 대신 환경 변수
docker run -d \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e DB_HOST=mysql \
  myapp:1.0
```

## 9) 자주 하는 실수

### ❌ 실수 1: 루트 사용자로 실행

```dockerfile
# ✅ 비루트 사용자 생성
RUN useradd -m appuser
USER appuser
```

### ❌ 실수 2: 볼륨 없이 데이터베이스 실행

```bash
# ❌ 컨테이너 삭제 시 데이터 손실
docker run -d mysql

# ✅ 볼륨 사용
docker run -d -v mysql-data:/var/lib/mysql mysql
```

### ❌ 실수 3: 모든 포트 노출

```dockerfile
# ❌ 불필요한 포트까지 노출
EXPOSE 8080 3306 6379

# ✅ 필요한 포트만
EXPOSE 8080
```

## 연습 (추천)

1. **Dockerfile 작성**
   - Spring Boot 프로젝트를 Docker 이미지로 빌드
   - 멀티 스테이지 빌드 적용

2. **Docker Compose**
   - MySQL + Redis + Spring Boot 구성
   - 각 서비스 연결 확인

3. **볼륨 실습**
   - 컨테이너 재생성 후 데이터 유지 확인

## 요약: 스스로 점검할 것

- Docker와 VM의 차이를 설명할 수 있다
- Dockerfile로 이미지를 빌드할 수 있다
- 컨테이너 실행, 중지, 삭제를 할 수 있다
- 볼륨으로 데이터를 영속화할 수 있다
- Docker Compose로 멀티 컨테이너를 관리할 수 있다

## 다음 단계

- Kubernetes 기초: `/learning/deep-dive/deep-dive-kubernetes-basics/`
- CI/CD 파이프라인: `/learning/deep-dive/deep-dive-cicd-pipeline/`
- 컨테이너 모니터링: `/learning/deep-dive/deep-dive-container-monitoring/`
