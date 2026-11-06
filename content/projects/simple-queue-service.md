---
title: "Simple Queue Service"
date: 2025-06-17
draft: false
description: "메시지 큐 시스템 직접 구현하기"
icon: "🚀"
status: "진행중"
tech: ["Kotlin", "Spring WebFlux", "Redis", "RocksDB", "React", "Rust"]
links:
  - name: "GitHub Repository"
    url: "https://github.com/jyukki97/simple-queue-service"
    icon: "🔗"
  - name: "개발 블로그 시리즈"
    url: "/posts/?project=simple-queue-service"
    icon: "📝"
duration: "2025.06.17 ~ 진행중"
---

# Simple Queue Service 프로젝트

> "내 손으로 만드는 메시지 큐 시스템"

메시지 큐를 직접 구현하며 내부 원리를 공부하는 프로젝트입니다. 

## 🎯 프로젝트 배경 및 목표

**🔍 기술적 호기심**
- "내가 메시지 큐를 만들 수 있을까?"
- Kafka 나 AWS SQS와 비슷하게는 접근해볼 수 있을까?

**📚 학습 목표**
- 메시지 큐 학습
- Kotlin 학습
- Spring WebFlux 학습
- Redis 학습

## 🚀 핵심 구현 기능

### ✅ 현재 구현된 기능들

**메시지 큐**
- **멀티 테넌트 지원**: API 키 기반 완전 격리
- **FIFO & Standard 큐**: 순서 보장 vs 처리량 최적화
- **지연 메시지**: 예약 발송 및 스케줄링
- **가시성 타임아웃**: 중복 처리 방지 메커니즘
- **데드레터 큐(DLQ)**: 실패 메시지 자동 격리

**3-Tier 스토리지 계층화**
- **Hot Storage (Redis Memory)**: 최근 메시지
- **Warm Storage (RocksDB)**: Hot에 100건 넘게 쌓였거나 오래된 메시지 (Standard 2시간, FIFO 1시간)
- **Cold Storage (File System)**: Warm에 1000건 넘게 쌓였거나 오래된 메시지 (Standard 48시간, FIFO 24시간), GZIP 압축
- **자동 계층화**: 개수·시간 기준 이관 (내려간 메시지를 다시 받는 경로는 미완성, 5편 참고)

### 🔄 재설계 (진행 중)

성능을 재 보니 3계층 구조가 큐가 아니라 캐시처럼 설계돼 있었습니다. 그래서 다시 설계하고 있습니다. 자세한 이야기는 [5편](/posts/sqs-05-measure-and-redesign/)에 있습니다.

- **겉 동작**: AWS SQS 호환 API (AWS JSON 프로토콜을 쓰는 AWS SDK를 그대로 붙임)
- **저장**: 큐 연산 단위 엔진 인터페이스. RocksDB 엔진으로 먼저 만들고, 큐 전용 자체 엔진으로 바꿈
- **복제**: 파티션마다 Raft (raft-rs)
- **언어**: Rust

## 🛠️ 기술 스택

**백엔드 (Kotlin 생태계)**
```
Kotlin                  # 멀티플랫폼 언어의 장점 활용
Spring WebFlux          # 반응형 API (websocket 의존성 때문에 실제로는 Tomcat으로 뜸, 5편 참고)
Spring Data Redis       # Redis 연동 및 트랜잭션 관리
```

**스토리지**
```
Redis                   # Hot 계층
RocksDB                 # Warm 계층
Local File System       # Cold 계층 (GZIP 압축)
```

**프론트엔드 (관리 도구)**
```
React                   # Admin 대시보드
TypeScript              # 타입 안정성
```

**DevOps & 모니터링 (예정)**
```
Docker & Docker Compose # 컨테이너화
Micrometer              # 메트릭 수집
Prometheus              # 시계열 데이터베이스 (예정)
Grafana                 # 모니터링 대시보드 (예정)
```

## 🏗️ 시스템 아키텍처

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Producer      │    │   Queue Service │    │   Consumer      │
│   Application   │───▶│  (Spring Boot)  │◀───│   Application   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                               │
                               ▼
                    ┌─────────────────────────┐
                    │   Unified Storage       │
                    │   Management Layer      │
                    │   (자동 계층화 엔진)        │
                    └─────────────────────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │   Hot Storage   │ │  Warm Storage   │ │  Cold Storage   │
    │ (Redis Memory)  │ │   (RocksDB)     │ │ (File System)   │
    │                 │ │                 │ │                 │
    │   1 hour TTL    │ │  24 hour TTL    │ │  14 days TTL    │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
            │                   │                   │
            └─────── Auto Migration & Smart Promotion ───────┘
```

## 📝 개발 블로그 시리즈

프로젝트 개발 과정에서 배운 내용을 기록하고 있습니다.

1. [간단한 메시지 큐에서 멀티 테넌트 시스템까지](/posts/sqs-01-architecture/)
2. [Admin 페이지 구현](/posts/sqs-02-admin-dashboard/)
3. [메시지 큐에서 Redis를 쓰는게 맞을까?](/posts/sqs-03-storage-architecture/)
4. [Warm Storage를 위해 RocksDB를 선택한 이유](/posts/sqs-04-rocksdb/)
5. [성능을 재 봤더니, 설계를 다시 하게 됐다](/posts/sqs-05-measure-and-redesign/)

## 🔗 관련 링크

- **GitHub Repository**: [프로젝트 소스코드](https://github.com/jyukki97/simple-queue-service)
- **개발 블로그**: [개발 블로그 시리즈](/posts/?project=simple-queue-service)
