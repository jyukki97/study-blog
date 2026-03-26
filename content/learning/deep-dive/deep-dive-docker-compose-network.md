---
title: "Docker Compose & Network: 컨테이너끼리 대화하는 법"
date: 2025-12-29
draft: false
topic: "DevOps"
tags: ["Docker", "Docker Compose", "Network", "Bridge", "DNS", "Overlay"]
categories: ["Backend Deep Dive"]
description: "여러 컨테이너를 관리하는 Docker Compose의 원리와 Docker Network(Bridge, Host, Overlay) 모드 완전 정복"
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
- **Service Discovery**: 컨테이너끼리 IP가 아닌 "이름"으로 통신하는 원리(Docker 내장 DNS)를 이해합니다.
- **Network Mode**: Bridge, Host, None, Overlay, Macvlan의 차이와 선택 기준을 잡습니다.
- **실전 Compose 패턴**: 멀티 서비스 구성, 헬스체크, 시크릿 관리, 네트워크 분리 전략을 익힙니다.
- **운영/디버깅**: 네트워크 문제 해결 방법과 운영 체크리스트를 확보합니다.

---

## 1. 왜 Docker Compose인가?

터미널에 매번 이렇게 칠 수는 없습니다.

```bash
# 😱 매번 이걸 친다고?
docker run -d --name db -e MYSQL_ROOT_PASSWORD=1234 \
  -v db-data:/var/lib/mysql mysql:8.0
docker run -d --name redis redis:7-alpine
docker run -d --name app --link db:db --link redis:redis \
  -p 8080:8080 -e DB_HOST=db myapp:latest
```

문제점:
- 명령어가 길고, 서비스가 3개만 넘어도 관리 불가능
- `--link`는 레거시(deprecated) — 커스텀 네트워크를 써야 함
- 볼륨, 환경변수, 의존관계를 한눈에 볼 수 없음
- 팀원 간 "내 PC에서는 되는데..." 문제 발생

Docker Compose는 이 명령어들을 `yaml` 파일 하나로 정의하고, `docker compose up` 한 방으로 실행하게 해주는 **IaC(Infrastructure as Code)** 도구의 시작입니다.

```yaml
# docker-compose.yml — 위의 명령어 3줄을 선언형으로 정리
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db
      REDIS_HOST: redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASS}
    volumes:
      - db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7-alpine

volumes:
  db-data:
```

```bash
# 이 한 줄이면 3개 서비스가 올라옴
docker compose up -d --build
```

---

## 2. Docker Network의 마법 (DNS)

Docker Compose로 실행하면, 자동으로 **사용자 정의 브리지 네트워크(Custom Bridge Network)**가 생성됩니다.
이 네트워크 안에서는 **Internal DNS**가 동작합니다.

```yaml
services:
  my-web:
    image: nginx
  my-db:
    image: mysql
```

- `my-web` 컨테이너 안에서 `ping my-db`를 치면?
- 👉 Docker 내장 DNS가 `my-db`를 172.x.x.x(네트워크 내부 IP)로 변환해줍니다.
- **애플리케이션 설정에서 IP 대신 `url: jdbc:mysql://my-db:3306/...` 라고 적을 수 있는 이유입니다.**

### 2-1) 기본 Bridge vs 사용자 정의 Bridge

| 구분 | 기본 bridge (docker0) | 사용자 정의 bridge (Compose) |
|------|---------------------|---------------------------|
| DNS | ❌ 컨테이너 이름으로 접근 불가 | ✅ 서비스 이름으로 접근 가능 |
| 격리 | 같은 bridge면 모두 접근 가능 | 네트워크 단위로 격리 가능 |
| 생성 방식 | `docker run` 기본값 | Compose가 자동 생성 |
| 실무 권장 | ❌ | ✅ |

> **핵심**: `docker run`으로 컨테이너를 띄우면 기본 bridge에 연결되는데, 이 bridge는 DNS를 지원하지 않습니다.
> IP가 매번 바뀌어도 찾을 수 없습니다. 반드시 사용자 정의 네트워크를 쓰세요.

### 2-2) DNS 해석 과정 상세

```
my-web 컨테이너가 "my-db"에 접속하려 함
    │
    ▼
[/etc/resolv.conf] → nameserver 127.0.0.11 (Docker 내장 DNS)
    │
    ▼
[Docker 내장 DNS 서버]
    │ 같은 네트워크에 "my-db"라는 서비스가 있는가?
    │
    ├─ 있음 → 172.18.0.3 반환 (서비스 내부 IP)
    │
    └─ 없음 → 호스트 DNS로 포워딩
         └→ 외부 도메인 해석 (google.com 등)
```

### 2-3) 서비스 스케일링과 DNS 라운드로빈

```bash
docker compose up -d --scale my-web=3
```

이 경우 `my-web`이라는 이름으로 DNS 질의하면, Docker는 3개의 컨테이너 IP를 **라운드로빈**으로 반환합니다.

```bash
# my-web이 3개인 상태에서
docker compose exec my-db dig my-web
# 172.18.0.2, 172.18.0.4, 172.18.0.5 (순서 변경됨)
```

> 단순 라운드로빈이므로 헬스체크 기반 라우팅이 필요하면 Traefik, Nginx 같은 리버스 프록시를 앞단에 둡니다.

---

## 3. 네트워크 드라이버 종류와 선택 기준

### 3-1) 드라이버 비교표

| 모드 | 설명 | DNS | 격리 | 성능 | 용도 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Bridge** | 가상 스위치를 통해 통신 | ✅ | ✅ | 보통 | 일반적인 웹앱/DB 구성 |
| **Host** | 호스트 네트워크 직접 사용 | N/A | ❌ | 최고 | 네트워크 성능 크리티컬 |
| **None** | 네트워크 없음 | ❌ | 최대 | N/A | 배치 작업, 보안 격리 |
| **Overlay** | 다중 호스트 연결 | ✅ | ✅ | 보통 | Swarm/K8s 클러스터 |
| **Macvlan** | 물리 NIC에 MAC 주소 직접 할당 | ✅ | ✅ | 높음 | 레거시 시스템 통합 |

### 3-2) Bridge 모드 (기본값, 가장 많이 사용)

```
┌─────────────────────────────────────────┐
│  Host Machine                           │
│                                         │
│  ┌──── docker0 (bridge) ────┐           │
│  │  172.17.0.0/16           │           │
│  │                          │           │
│  │  ┌──────────┐ ┌────────┐ │           │
│  │  │ App      │ │ DB     │ │           │
│  │  │ .0.2     │ │ .0.3   │ │           │
│  │  └────┬─────┘ └───┬────┘ │           │
│  │       └─────┬─────┘      │           │
│  └─────────────┼────────────┘           │
│          NAT (iptables)                 │
│                │                        │
│         ┌──────┴──────┐                 │
│         │  eth0       │                 │
│         │ 192.168.0.10│                 │
│         └─────────────┘                 │
└─────────────────────────────────────────┘
```

**핵심 동작**:
- 컨테이너끼리는 브리지 내부에서 직접 통신 (NAT 불필요)
- 외부 → 컨테이너: 포트 포워딩 필요 (`-p 8080:8080`)
- 컨테이너 → 외부: NAT(Masquerade)를 통해 호스트 IP로 나감

### 3-3) Host 모드

```yaml
services:
  monitoring:
    image: prometheus:latest
    network_mode: host  # 호스트 네트워크 직접 사용
```

**언제 쓰는가:**
- 매우 높은 네트워크 처리량이 필요한 경우 (NAT 오버헤드 제거)
- 호스트의 네트워크 인터페이스를 직접 다뤄야 하는 경우 (모니터링, 패킷 캡처)
- Linux에서만 정상 동작 (macOS/Windows Docker Desktop에서는 VM 안의 host)

**주의:**
- 포트 충돌 가능 — 컨테이너가 8080을 쓰면 호스트 8080도 점유
- 네트워크 격리가 없어 보안 주의

### 3-4) Overlay 모드 (멀티 호스트)

```
┌─────────────────┐        ┌─────────────────┐
│  Node 1         │        │  Node 2         │
│                 │        │                 │
│  ┌──── overlay ─┼────────┼── overlay ──┐   │
│  │              │  VXLAN │             │   │
│  │  ┌─────┐    │  tunnel│   ┌─────┐   │   │
│  │  │ App │    │ <----> │   │ DB  │   │   │
│  │  │.0.2 │    │        │   │.0.3 │   │   │
│  │  └─────┘    │        │   └─────┘   │   │
│  └─────────────┘        └─────────────┘   │
└─────────────────┘        └─────────────────┘
```

- Swarm 모드나 Kubernetes에서 사용
- VXLAN 터널을 통해 서로 다른 호스트의 컨테이너가 같은 네트워크에 있는 것처럼 통신
- 개발 환경에서는 거의 쓸 일 없음, 프로덕션 클러스터에서 필요

### 3-5) Macvlan 모드 (물리 네트워크 직접 연결)

```yaml
networks:
  physical:
    driver: macvlan
    driver_opts:
      parent: eth0  # 호스트의 물리 NIC
    ipam:
      config:
        - subnet: 192.168.0.0/24
          gateway: 192.168.0.1
```

**사용 시점**:
- 레거시 시스템이 특정 IP로 직접 접근해야 할 때
- 컨테이너가 물리 네트워크에 "실제 장비처럼" 보여야 할 때
- 네트워크 장비(방화벽, 로드밸런서)와 직접 통신해야 할 때

---

## 4. 실전 Compose 패턴

### 4-1) 네트워크 분리: Frontend ↔ Backend ↔ DB

보안과 격리를 위해 네트워크를 분리하는 것이 실무 기본입니다.

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    networks:
      - frontend  # 외부 접근 가능

  app:
    build: .
    networks:
      - frontend  # nginx와 통신
      - backend   # DB와 통신
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8.0
    networks:
      - backend   # app만 접근 가능, nginx는 접근 불가
    volumes:
      - db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    networks:
      - backend

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true  # 외부 인터넷 접근 차단 (DB 보호)

volumes:
  db-data:
```

**네트워크 흐름**:
```
외부 사용자 → nginx(frontend) → app(frontend+backend) → db(backend)
                                                       → redis(backend)
```

- `nginx`는 `db`에 직접 접근 불가 (서로 다른 네트워크)
- `backend` 네트워크에 `internal: true` 설정 → DB가 인터넷에 직접 나갈 수 없음
- 이 한 줄로 DB 보안이 크게 강화됨

### 4-2) 순서 제어 (depends_on + healthcheck)

DB가 켜지기도 전에 앱이 뜨면 Connection Refused 에러가 납니다.

```yaml
services:
  app:
    depends_on:
      db:
        condition: service_healthy    # DB healthcheck 통과 후 시작
      redis:
        condition: service_started    # 컨테이너 시작만 확인 (빠른 시작)
      migration:
        condition: service_completed_successfully  # 마이그레이션 완료 후

  db:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s  # 초기 부팅 시간 허용

  migration:
    build:
      context: .
      dockerfile: Dockerfile.migration
    depends_on:
      db:
        condition: service_healthy
```

**condition 옵션 비교**:

| condition | 의미 | 사용 시점 |
|-----------|------|----------|
| `service_started` | 컨테이너 시작됨 (프로세스 생성) | 빠른 시작이면 충분한 서비스 |
| `service_healthy` | healthcheck 통과 | DB, 메시지 큐 등 준비 시간 필요한 서비스 |
| `service_completed_successfully` | 종료 코드 0 | 마이그레이션, 시드 데이터 등 1회성 작업 |

### 4-3) 환경변수 관리 (.env + profiles)

비밀번호는 yaml에 하드코딩하지 말고 `.env` 파일로 뺍니다.

```bash
# .env (git에 절대 커밋하지 않음 → .gitignore에 추가)
DB_PASS=super-secret-password
DB_NAME=myapp
REDIS_PASS=another-secret
```

```yaml
# docker-compose.yml
services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASS}
      MYSQL_DATABASE: ${DB_NAME}
```

**profiles로 환경 분리**:

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"

  # 개발 환경에서만 띄울 서비스
  adminer:
    image: adminer
    ports:
      - "9090:8080"
    profiles:
      - dev  # docker compose --profile dev up 할 때만 시작

  # 모니터링 (운영에서만)
  prometheus:
    image: prom/prometheus
    profiles:
      - monitoring
```

```bash
# 개발 환경: app + adminer
docker compose --profile dev up -d

# 운영 환경: app + monitoring
docker compose --profile monitoring up -d

# 전부 다
docker compose --profile dev --profile monitoring up -d
```

### 4-4) 볼륨 전략: 데이터 vs 설정 vs 로그

```yaml
services:
  db:
    image: mysql:8.0
    volumes:
      # Named Volume: 데이터 영속화 (Docker가 관리)
      - db-data:/var/lib/mysql

      # Bind Mount: 설정 파일 주입 (호스트 파일 → 컨테이너)
      - ./config/mysql.cnf:/etc/mysql/conf.d/custom.cnf:ro

      # Bind Mount: 로그 수집 (컨테이너 → 호스트)
      - ./logs/mysql:/var/log/mysql

volumes:
  db-data:
    # 명시적 이름 지정 (다른 Compose 프로젝트와 공유 가능)
    name: myapp-db-data
```

| 유형 | 사용 | 예시 |
|------|------|------|
| Named Volume | 영속 데이터 | DB 데이터, 업로드 파일 |
| Bind Mount (ro) | 설정 주입 | nginx.conf, my.cnf |
| Bind Mount (rw) | 로그/개발 | 로그 수집, 소스코드 핫리로드 |
| tmpfs | 임시/민감 데이터 | 세션 파일, 임시 캐시 |

---

## 5. 네트워크 트러블슈팅

### 5-1) 자주 만나는 문제와 해결

**문제 1: "Connection refused" — 서비스 이름 대신 localhost 사용**

```yaml
# ❌ 컨테이너 안에서 localhost는 자기 자신
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb

# ✅ 서비스 이름 사용
spring:
  datasource:
    url: jdbc:mysql://db:3306/mydb
```

**문제 2: "Name resolution failure" — 서로 다른 네트워크**

```bash
# 네트워크 확인
docker network ls
docker network inspect myapp_default

# 특정 컨테이너의 네트워크 확인
docker inspect app --format='{{json .NetworkSettings.Networks}}' | jq
```

**문제 3: 포트 충돌 — "bind: address already in use"**

```bash
# 어떤 프로세스가 포트를 점유하고 있는지 확인
lsof -i :8080
# 또는
ss -tlnp | grep 8080

# 해결: 포트 매핑 변경
ports:
  - "8081:8080"  # 호스트 8081 → 컨테이너 8080
```

### 5-2) 디버깅 명령어 모음

```bash
# 1. 네트워크 목록 확인
docker network ls

# 2. 특정 네트워크에 연결된 컨테이너 확인
docker network inspect myapp_backend | jq '.[0].Containers'

# 3. 컨테이너 안에서 DNS 해석 확인
docker compose exec app nslookup db
docker compose exec app dig db

# 4. 컨테이너 안에서 연결 테스트
docker compose exec app curl -v http://db:3306
docker compose exec app nc -zv db 3306

# 5. 컨테이너 간 ping 테스트
docker compose exec app ping -c 3 db

# 6. 네트워크 패킷 캡처 (고급)
docker run --rm --net=container:myapp-app-1 \
  nicolaka/netshoot tcpdump -i eth0 port 3306

# 7. 실행 중인 컨테이너의 포트 매핑 확인
docker compose ps
docker port myapp-app-1
```

### 5-3) netshoot: 네트워크 디버깅 전용 컨테이너

앱 컨테이너에 curl/dig/tcpdump가 없을 때 유용합니다.

```yaml
# docker-compose.override.yml (개발용)
services:
  debug:
    image: nicolaka/netshoot
    networks:
      - frontend
      - backend
    command: sleep infinity  # 접속용
    profiles:
      - debug
```

```bash
docker compose --profile debug up -d debug
docker compose exec debug bash
# 이제 curl, dig, nslookup, tcpdump, iperf3 등 사용 가능
```

---

## 6. 운영을 위한 Compose 고급 설정

### 6-1) 리소스 제한

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 256M
    # OOM 발생 시 재시작
    restart: unless-stopped
```

### 6-2) 로깅 설정

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "10m"    # 로그 파일 최대 크기
        max-file: "3"      # 로테이션 파일 수
        tag: "{{.Name}}"   # 로그 태그
```

> 로깅 드라이버를 설정하지 않으면 `json-file`이 기본인데, 크기 제한이 없어 디스크를 가득 채울 수 있습니다. 반드시 `max-size`를 설정하세요.

### 6-3) docker compose 주요 명령어 정리

```bash
# 서비스 시작 (백그라운드)
docker compose up -d

# 이미지 재빌드 후 시작
docker compose up -d --build

# 특정 서비스만 재시작
docker compose restart app

# 로그 확인 (실시간)
docker compose logs -f app

# 모든 서비스 상태
docker compose ps

# 서비스 내부 접속
docker compose exec app bash

# 완전 종료 + 볼륨 삭제 (주의!)
docker compose down -v

# 사용하지 않는 리소스 정리
docker system prune -f
docker volume prune -f
```

---

## 7. 운영 체크리스트

| # | 항목 | 확인 |
|---|------|------|
| 1 | 사용자 정의 bridge 네트워크를 사용하는가? (기본 bridge 금지) | ☐ |
| 2 | DB/캐시는 `internal: true` 네트워크에 배치했는가? | ☐ |
| 3 | `depends_on` + `condition: service_healthy` 로 시작 순서를 보장하는가? | ☐ |
| 4 | 비밀번호/키는 `.env` 파일로 분리하고 `.gitignore`에 등록했는가? | ☐ |
| 5 | 볼륨에 Named Volume을 사용해 데이터를 영속화하는가? | ☐ |
| 6 | 로깅에 `max-size`/`max-file`을 설정했는가? | ☐ |
| 7 | 리소스 제한(CPU/메모리)을 설정했는가? | ☐ |
| 8 | `restart: unless-stopped` 또는 `always`를 설정했는가? | ☐ |
| 9 | 포트 매핑에서 `127.0.0.1:3306:3306`으로 외부 노출을 제한했는가? (DB) | ☐ |
| 10 | `docker compose down -v`(볼륨 삭제)를 운영에서 실수로 치지 않도록 주의하는가? | ☐ |

---

## 요약

1. **Compose는 필수**: 다중 컨테이너 관리는 선택이 아니라 필수입니다. IaC의 첫걸음.
2. **DNS**: 컨테이너끼리는 `Service Name`으로 통신합니다. (localhost 아님!)
3. **네트워크 분리**: frontend/backend 분리 + `internal: true`로 DB를 보호하세요.
4. **Bridge vs Host**: 격리가 필요하면 Bridge, 성능이 최우선이면 Host를 고려합니다.
5. **healthcheck는 필수**: `depends_on`만으로는 "준비 완료"를 보장하지 못합니다.
6. **디버깅**: `docker network inspect`, `netshoot`, `nslookup`은 네트워크 문제의 80%를 해결합니다.

---

## 관련 글

- [Docker 기초: 이미지와 컨테이너](/learning/deep-dive/deep-dive-docker-basics/)
- [Docker 멀티스테이지 CI 예제](/learning/examples/example-docker-multistage-ci/)
- [CI/CD: GitHub Actions](/learning/deep-dive/deep-dive-ci-cd-github-actions/)
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/)
- [Kubernetes 배포 전략 (Rollout)](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [VPC 네트워크 기초](/learning/deep-dive/deep-dive-vpc-network-basics/)
- [Load Balancer & Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)
- [로깅 전략](/learning/deep-dive/deep-dive-logging-strategy/)

---

## 연습(추천)

1. **네트워크 분리 실습**: 위의 frontend/backend 분리 Compose 파일을 직접 작성하고, nginx에서 db로 ping이 안 되는지 확인해보세요.
2. **healthcheck 실습**: DB healthcheck 없이 앱을 먼저 시작시켜서 "Connection refused"를 직접 경험한 뒤, healthcheck를 추가해서 해결해보세요.
3. **netshoot 디버깅**: 네트워크 문제를 일부러 만들고(잘못된 서비스 이름, 다른 네트워크), netshoot으로 원인을 찾아보세요.
4. **profiles 활용**: dev/staging/prod 환경별로 다른 서비스 세트가 뜨도록 profiles를 구성해보세요.
