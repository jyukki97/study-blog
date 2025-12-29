---
title: "AWS 배포 실전: EC2와 RDS로 나만의 서버 띄우기"
date: 2025-12-29
draft: false
topic: "DevOps"
tags: ["AWS", "EC2", "RDS", "Deployment", "Linux"]
categories: ["Backend Deep Dive"]
description: "VPC, Security Group 기초부터 EC2 인스턴스 생성, RDS 연동, 그리고 Java 애플리케이션 배포까지"
module: "ops-observability"
quizzes:
  - question: "AWS에서 가상의 독립된 네트워크 환경을 구성하여 리소스를 격리하는 서비스의 이름은?"
    options:
      - "EC2 (Elastic Compute Cloud)"
      - "VPC (Virtual Private Cloud)"
      - "S3 (Simple Storage Service)"
      - "IAM (Identity and Access Management)"
    answer: 1
    explanation: "VPC(Virtual Private Cloud)는 AWS 클라우드 내 논리적으로 격리된 사용자 전용 가상 네트워크입니다. 서브넷, 라우팅 테이블, 게이트웨이 등을 제어할 수 있습니다."

  - question: "EC2 인스턴스에 대한 인바운드/아웃바운드 트래픽을 제어하는 가상 방화벽 역할을 하는 것은?"
    options:
      - "Network ACL"
      - "Security Group (보안 그룹)"
      - "Route Table"
      - "Internet Gateway"
    answer: 1
    explanation: "Security Group은 인스턴스 레벨의 방화벽으로, 허용(Allow) 규칙을 통해 특정 포트(예: 80, 443, 22)로 들어오는 트래픽을 제어합니다."

  - question: "로컬에서 개발한 Spring Boot 배포 파일(Jar)을 EC2 서버가 계속 실행되도록 백그라운드에서 관리해주는 리눅스 시스템 도구는?"
    options:
      - "vim"
      - "systemd (systemctl)"
      - "crontab"
      - "top"
    answer: 1
    explanation: "`systemd`는 리눅스의 서비스 관리자로, 애플리케이션을 시스템 서비스로 등록하여 부팅 시 자동 시작, 재시작, 로그 관리 등을 수행하게 해줍니다."

  - question: "RDS(Relational Database Service)를 사용할 때, 보안을 위해 DB 인스턴스의 접근을 제한하는 가장 권장되는 방법은?"
    options:
      - "DB를 Public Subnet에 두고 0.0.0.0/0을 허용한다."
      - "DB를 Private Subnet에 두고, 웹 서버(EC2)의 Security Group ID만 인바운드로 허용한다."
      - "DB 비밀번호를 매우 복잡하게 설정한다."
      - "DB 포트를 3306 대신 다른 포트로 바꾼다."
    answer: 1
    explanation: "DB는 인터넷에 직접 노출되지 않도록 Private Subnet에 배치하고, Security Group의 'Source'를 특정 EC2의 Security Group ID로 지정하여 애플리케이션 서버에서만 접속 가능하도록 제한해야 합니다."

  - question: "EC2 인스턴스에 접속하기 위해 사용하는 키 쌍(Key Pair) 파일의 확장자는?"
    options:
      - ".exe"
      - ".pem (또는 .ppk)"
      - ".jpg"
      - ".zip"
    answer: 1
    explanation: "Linux/Mac 터미널에서는 `.pem` 파일을 사용하여 SSH 접속을 하며, 윈도우(PuTTY)에서는 `.ppk`로 변환하여 사용합니다."
study_order: 93
---

## 이 글에서 얻는 것

- **클라우드 기초**: VPC, Subnet, Security Group이 왜 필요한지 이해합니다. (집 주소와 대문 열쇠 비유)
- **서버 구축**: EC2(컴퓨터)를 빌리고, RDS(DB)를 설정하여 연결하는 전체 흐름을 봅니다.
- **배포 운영**: `nohup`과 `systemd`의 차이를 알고, "서버 끄면 앱도 꺼지는" 초보 티를 벗습니다.

## 1. AWS 네트워크 기본 (VPC)

아마존 클라우드는 거대한 땅입니다. 여기에 **"내 땅(VPC)"** 부터 울타리를 쳐야 합니다.

```mermaid
graph TD
    subgraph VPC [VPC (10.0.0.0/16)]
        subgraph PublicSubnet [Public Subnet]
            EC2[Web Server (EC2)]
        end
        
        subgraph PrivateSubnet [Private Subnet]
            RDS[(RDS Database)]
        end
    end
    
    Internet((Internet)) <--> IGW[Internet Gateway] <--> EC2
    EC2 <--> RDS
    Internet --x RDS
    
    style PublicSubnet fill:#e3f2fd,stroke:#2196f3
    style PrivateSubnet fill:#ffebee,stroke:#f44336
```

- **Public Subnet**: 인터넷과 통신 가능 (웹 서버용)
- **Private Subnet**: 인터넷 직접 통신 불가 (DB용, 보안 강화)

## 2. EC2와 Security Group (방화벽)

EC2를 만들 때 가장 중요한 건 **"누구에게 문을 열어줄 것인가"** 입니다.

- **Port 22 (SSH)**: **내 IP**에서만 열어야 함. (전세계 해커들의 먹잇감 1순위)
- **Port 80/443 (HTTP)**: **0.0.0.0/0** (누구나 접속 가능)
- **Port 8080 (Spring)**: 보통 **0.0.0.0/0** 또는 로드밸런서 IP만 허용.

## 3. Java 앱 배포하기

### 1) JDK 설치
```bash
sudo yum install java-17-amazon-corretto -y
java -version
```

### 2) 실행 (초보 ver)
```bash
java -jar myapp.jar
# 터미널 끄면 앱도 꺼짐 (망함)
```

### 3) 실행 (중수 ver - nohup)
```bash
nohup java -jar myapp.jar &
# 백그라운드 실행되지만, 재부팅하면 안 켜짐
```

### 4) 실행 (고수 ver - systemd)
`/etc/systemd/system/myapp.service` 파일을 만듭니다.

```ini
[Unit]
Description=My Spring Boot App
After=network.target

[Service]
User=ec2-user
ExecStart=/usr/bin/java -jar /home/ec2-user/myapp.jar
SuccessExitStatus=143
Restart=always

[Install]
WantedBy=multi-user.target
```

이제 `sudo systemctl start myapp` 하면 서버가 재부팅되어도 알아서 살아납니다.

## 4. RDS 연결 꿀팁

- **절대 Public Access 켜지 마세요**: DB 해킹당합니다.
- **Security Group chaining**:
    1. `SG-Web`: EC2에 적용.
    2. `SG-DB`: RDS에 적용. 인바운드 규칙 소스를 `SG-Web`으로 설정.
    - 👉 "웹 서버 그룹 딱지를 단 녀석들만 DB에 들어올 수 있다"는 뜻. IP가 바뀌어도 안전합니다.

## 요약

1.  **VPC**: 내 땅을 먼저 확보해라.
2.  **보안 그룹**: 포트는 필요한 만큼만 열어라. (특히 22번 주의)
3.  **RDS**: Private Subnet에 숨기고, EC2를 통해서만 접근하게 해라.
