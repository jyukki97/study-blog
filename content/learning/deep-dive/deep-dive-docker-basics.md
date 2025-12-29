---
title: "Docker 기본: 컨테이너는 왜 빠를까?"
date: 2025-12-01
draft: false
topic: "DevOps"
tags: ["Docker", "Container", "Dockerfile", "Docker Compose", "Image"]
categories: ["Backend Deep Dive"]
description: "VM과 컨테이너의 아키텍처 차이, 이미지 레이어 구조(Copy-on-Write)의 원리"
module: "ops-observability"
quizzes:
  - question: "가상 머신(VM)과 비교했을 때, 도커 컨테이너가 훨씬 가볍고 빠르게 실행될 수 있는 핵심 이유는?"
    options:
      - "컨테이너는 Hypervisor 위에서 독립된 Guest OS를 부팅하기 때문이다."
      - "컨테이너는 Host OS의 커널(Kernel)을 공유하며, 격리된 프로세스로 동작하기 때문이다."
      - "컨테이너는 하드웨어 전체를 가상화하기 때문이다."
      - "컨테이너는 RAM을 전혀 사용하지 않기 때문이다."
    answer: 1
    explanation: "VM은 무거운 Guest OS를 통째로 설치해야 하지만, 컨테이너는 Host OS의 커널을 공유하고 프로세스 레벨에서 격리되므로 부팅이 초 단위로 빠릅니다."

  - question: "Docker 이미지의 레이어 구조와 관련된 설명으로 옳은 것은?"
    options:
      - "이미지의 모든 레이어는 읽기/쓰기(Read-Write)가 가능하다."
      - "컨테이너를 실행하면 이미지 레이어 위에 얇은 Read-Only 레이어가 추가된다."
      - "이미지 레이어는 불변(Read-Only)이며, 여러 컨테이너가 Base Image 레이어를 공유하여 디스크 공간을 절약한다."
      - "이미지를 빌드할 때마다 모든 레이어가 새로 다운로드된다."
    answer: 2
    explanation: "이미지 레이어는 Read-Only로 설계되어 여러 컨테이너가 공유할 수 있으며, 컨테이너 실행 시에만 최상단에 쓰기 가능한(R/W) 레이어가 추가됩니다."

  - question: "Dockerfile에서 'Multi-stage Build'를 사용하는 가장 주된 목적은?"
    options:
      - "빌드 속도를 늦추기 위해"
      - "여러 개의 이미지를 동시에 실행하기 위해"
      - "최종 이미지에 빌드 도구(Gradle 등)를 포함하지 않고, 실행 파일(Jar)만 남겨 이미지 크기를 최소화하기 위해"
      - "더 복잡한 Dockerfile을 작성하기 위해"
    answer: 2
    explanation: "Multi-stage Build를 사용하면 빌드 단계(Compile)와 실행 단계(Runtime)를 분리하여, 최종 이미지에는 JVM과 Jar 파일만 남기고 무거운 빌드 도구는 제거할 수 있습니다."

  - question: "도커 컨테이너가 종료되거나 삭제되어도 데이터베이스의 데이터가 사라지지 않게 하려면 Docker Compose에서 어떤 설정을 해야 하는가?"
    options:
      - "ports"
      - "links"
      - "volumes"
      - "environment"
    answer: 2
    explanation: "`volumes` 설정을 통해 컨테이너 내부의 데이터 디렉토리를 호스트 머신(또는 볼륨)과 연결해야 컨테이너 수명과 관계없이 데이터를 영구 보존할 수 있습니다."

  - question: "베이스 이미지(Base Image)를 지정하는 Dockerfile의 명령어는?"
    options:
      - "RUN"
      - "FROM"
      - "COPY"
      - "CMD"
    answer: 1
    explanation: "`FROM openjdk:17`과 같이 `FROM` 명령어를 사용하여 기반이 될 이미지를 지정합니다."
study_order: 604
mermaid: true
---

## 🏗️ 1. VM vs Container: 아키텍처의 차이

왜 Docker는 "가볍다"고 할까요? 비밀은 **Guest OS의 유무**에 있습니다.

```mermaid
graph TD
    subgraph VM [Virtual Machine Architecture]
        Hyper[Hypervisor]
        GOS["Guest OS <br/>(Heavy, GBs)"]
        App1[Application]
    end

    subgraph Container [Container Architecture]
        Docker[Docker Engine]
        App2[Application]
        P[Allocated Process]
    end

    Hyper --> GOS --> App1
    Docker --> App2

    %% Styles
    style VM fill:#ffebee,stroke:#c62828
    style Container fill:#e8f5e9,stroke:#2e7d32
    style GOS fill:#ffcdd2,stroke:#b71c1c,stroke-width:2px
    style Docker fill:#c8e6c9,stroke:#1b5e20,stroke-width:2px
```

- **VM**: 하드웨어를 가상화합니다. 각 VM마다 Windows/Linux를 통째로 설치하므로 무겁고(GB 단위), 부팅이 느립니다.
- **Container**: OS(리눅스 커널)를 공유합니다. 격리된 **프로세스**일 뿐이므로 가볍고(MB 단위), 1초 만에 켜집니다.

---

## 🍰 2. 이미지 레이어(Layer)와 Copy-on-Write

Docker 이미지는 통짜 파일이 아닙니다. **여러 겹의 케이크**입니다.

```mermaid
graph BT
    L1[Base Layer: Ubuntu] --> L2[Add Java]
    L2[Add Java] --> L3[Add Application Code]
    L3[Add Application Code] --> C["Container Layer <br/>(Read-Write)"]

    %% Styles
    classDef readOnly fill:#eeeeee,stroke:#9e9e9e,stroke-dasharray: 5 5;
    classDef writeAble fill:#fff3e0,stroke:#ff9800,stroke-width:2px;

    class L1,L2,L3 readOnly;
    class C writeAble;
```

이미지의 모든 레이어는 **Read-Only**입니다.
컨테이너를 실행하면 그 위에 **얇은 R/W 레이어** 한 장만 올라갑니다.

1. **효율성**: 여러 컨테이너가 Base Image(Ubuntu, Java 등)를 **공유**합니다. 디스크를 아낍니다.
2. **속도**: 이미지는 읽기 전용이라 캐싱하기 좋습니다.

---

## 📜 3. Dockerfile의 핵심 (멀티 스테이지 빌드)

"이미지 크기를 줄이는 법"이 실무의 핵심입니다.

```mermaid
flowchart LR
    subgraph Stage 1 [Builder Stage]
        Src[Source Code] --> Build[Gradle Build]
        Build --> Jar[Spring Boot JAR]
    end

    subgraph Stage 2 [Runtime Stage]
        Base[OpenJDK Slim Image] --> Copy[Copy JAR from Stage 1]
        Copy --> Run[Run Application]
    end

    Jar -.-> Copy

    style Stage 1 fill:#f3e5f5,stroke:#7b1fa2
    style Stage 2 fill:#e3f2fd,stroke:#1565c0
```

```dockerfile
# 🏗️ Build Stage
FROM gradle:jdk17 AS builder
COPY . .
RUN ./gradlew build  # 여기서 소스 컴파일 (무거움)

# 🚀 Run Stage
FROM openjdk:17-slim # 가벼운 런타임 이미지
COPY --from=builder /app/build/libs/myapp.jar .
ENTRYPOINT ["java", "-jar", "myapp.jar"]
```

빌드 도구(Gradle, Maven)는 런타임에 필요 없습니다.
결과물(Jar)만 쏙 빼서 새 이미지에 담는 **Multi-stage Build**를 쓰면 용량이 1/10으로 줄어듭니다.

---

## 🐙 4. Docker Compose: "나의 작은 오케스트라"

컨테이너 하나(App)만 띄우는 일은 드뭅니다. DB도 띄워야 하고 Redis도 띄워야 하죠.
이들을 한 방에 관리하는 도구입니다.

```yaml
services:
  app:
    build: .
    depends_on: [db, redis] # 순서 보장
    ports: ["8080:8080"]

  db:
    image: mysql:8.0
    volumes: ["db_data:/var/lib/mysql"] # 데이터 영속성

  redis:
    image: redis:alpine
```

가장 중요한 건 `volumes`입니다. 컨테이너를 지워도 DB 데이터가 날아가면 안 되니까요.

## 요약

1. **가벼움**: OS 커널을 공유하는 프로세스 격리 기술이다.
2. **레이어**: 이미지는 겹겹이 쌓이며 재사용된다. 컨테이너는 그 위에 쓰는 얇은 종이다.
3. **Dockerfile**: 빌드 단계와 실행 단계를 나누는 것이 국룰이다.
