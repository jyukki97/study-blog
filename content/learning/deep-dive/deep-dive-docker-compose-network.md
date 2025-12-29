---
title: "Docker Compose & Network: 컨테이너끼리 대화하는 법"
date: 2025-12-29
draft: false
topic: "DevOps"
tags: ["Docker", "Docker Compose", "Network", "Bridge", "DNS"]
categories: ["Backend Deep Dive"]
description: "여러 컨테이너를 관리하는 Docker Compose의 원리와 Docker Network(Bridge, Host) 모드 완전 정복"
module: "ops-observability"
quizzes:
  - question: "Docker Compose 기본 네트워크 모드에서, 컨테이너끼리 서로 통신할 때 사용하는 호스트 이름(Hostname)은?"
    options:
      - "localhost"
      - "127.0.0.1"
      - "서비스 명 (Service Name)"
      - "컨테이너 ID"
    answer: 2
    explanation: "Docker Compose는 사용자 정의 브리지 네트워크를 생성하고 내부 DNS를 제공하므로, 서비스 이름(예: `db`, `redis`)을 호스트명으로 사용하여 통신할 수 있습니다."

  - question: "Docker 네트워크 모드 중, 컨테이너가 호스트 머신의 네트워크 네임스페이스를 그대로 공유하여 포트 포워딩 없이 호스트의 포트를 사용하는 모드는?"
    options:
      - "bridge"
      - "host"
      - "none"
      - "overlay"
    answer: 1
    explanation: "`network_mode: host`를 사용하면 컨테이너 격리 없이 호스트의 네트워크를 그대로 사용하므로 성능이 빠르지만 포트 충돌에 주의해야 합니다."

  - question: "Docker Compose 파일(`docker-compose.yml`)에서 서비스 시작 순서를 제어하기 위해 사용하는 옵션은?"
    options:
      - "links"
      - "depends_on"
      - "order"
      - "priority"
    answer: 1
    explanation: "`depends_on`을 사용하여 특정 서비스(예: DB)가 먼저 시작되도록 순서를 지정할 수 있습니다. (단, 헬스체크까지 기다리려면 `condition` 옵션이 추가로 필요함)"

  - question: "`docker-compose up` 명령 실행 시 이미지가 없을 때만 빌드하고, 소스 변경 시 강제로 다시 빌드하려면 어떤 옵션을 써야 하는가?"
    options:
      - "--force-recreate"
      - "--build"
      - "--renew-anon-volumes"
      - "--remove-orphans"
    answer: 1
    explanation: "`docker-compose up --build`를 사용하면 이미지가 있더라도 소스 코드가 변경되었을 수 있으므로 이미지를 새로 빌드한 후 컨테이너를 시작합니다."

  - question: "여러 호스트(Node)에 걸쳐 있는 컨테이너들을 연결하기 위해 Swarm이나 Kubernetes 환경에서 주로 사용하는 네트워크 드라이버는?"
    options:
      - "bridge"
      - "host"
      - "overlay"
      - "macvlan"
    answer: 2
    explanation: "`overlay` 네트워크는 여러 도커 데몬 호스트 간에 분산 네트워크를 구성하여, 서로 다른 노드에 있는 컨테이너끼리 통신할 수 있게 해줍니다."
study_order: 91
---

## 이 글에서 얻는 것

- **Docker Compose**로 복잡한 실행 명령어(`docker run ...`)를 깔끔하게 관리하는 법을 배웁니다.
- **Service Discovery**: 컨테이너끼리 IP가 아닌 "이름"으로 통신하는 원리(DNS)를 이해합니다.
- **Network Mode**: Bridge 모드와 Host 모드의 차이, 그리고 언제 무엇을 써야 할지 기준을 잡습니다.

## 1. 왜 Docker Compose인가?

터미널에 매번 이렇게 칠 수는 없습니다.

```bash
# 😱 매번 이걸 친다고?
docker run -d --name db -e MYSQL_ROOT_PASSWORD=1234 mysql:8.0
docker run -d --name app --link db:db -p 8080:8080 myapp:latest
```

Docker Compose는 이 명령어를 `yaml` 파일 하나로 정의하고, `docker-compose up` 한 방으로 실행하게 해주는 **IaC(Infrastructure as Code)** 도구의 시작입니다.

## 2. Docker Network의 마법 (DNS)

Docker Compose로 실행하면, 자동으로 **사용자 정의 브리지 네트워크(Custom Bridge Network)** 가 생성됩니다.
이 네트워크 안에서는 **Internal DNS**가 돕니다.

```yaml
services:
  my-web:
    image: nginx
  my-db:
    image: mysql
```

- `my-web` 컨테이너 안에서 `ping my-db`를 치면?
- 👉 Docker 내장 DNS가 `my-db`를 172.x.x.x(네트워크 내부 IP)로 변환해줍니다.
- **애플리케이션 설정(`application.yml`)에서 IP 대신 `url: jdbc:mysql://my-db:3306/...` 라고 적을 수 있는 이유입니다.**

## 3. 네트워크 드라이버 종류

| 모드 | 설명 | 특징 | 용도 |
| :--- | :--- | :--- | :--- |
| **Bridge** | (기본값) 가상 스위치를 통해 통신 | Port Forwarding 필요 | 일반적인 웹 앱/DB 구성 |
| **Host** | 호스트 네트워크 직접 사용 | 성능 좋음, 포트 충돌 위험 | 네트워크 성능이 중요한 경우 |
| **None** | 네트워크 없음 | 외부 통신 불가 | 배치 작업 등 보안 격리 |
| **Overlay** | 다중 호스트 연결 | Swarm/K8s 전용 | 클러스터 환경 |

```mermaid
graph TD
    subgraph Host[Host Machine]
        subgraph BridgeNet[Docker Bridge Network (172.17.0.0/16)]
            C1[Container A <br/> 172.17.0.2]
            C2[Container B <br/> 172.17.0.3]
        end
        Eth0[Host Eth0 <br/> 192.168.0.100]
    end
    
    C1 -- Internal DNS --> C2
    C1 -. NAT (Port:8080) .-> Eth0
```

## 4. 실전 Compose 패턴

### 1) 순서 제어 (depends_on)

DB가 켜지기도 전에 앱이 뜨면 에러가 납니다.

```yaml
version: "3.8"
services:
  app:
    depends_on:
      db:
        condition: service_healthy # ✨ 꿀팁: 헬스체크 통과까지 대기
  db:
    image: mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      retries: 5
```

### 2) 환경변수 관리 (.env)

비밀번호는 yaml에 하드코딩하지 말고 `.env` 파일로 뺍니다.

```yaml
# docker-compose.yml
environment:
  MYSQL_PASSWORD: ${DB_PASS}
```

## 요약

1.  **Compose는 필수**: 다중 컨테이너 관리는 선택이 아니라 필수입니다.
2.  **DNS**: 컨테이너끼리는 `Service Name`으로 통신합니다. (localhost 아님!)
3.  **Bridge vs Host**: 격리가 필요하면 Bridge, 성능이 최우선이면 Host를 고려합니다.
