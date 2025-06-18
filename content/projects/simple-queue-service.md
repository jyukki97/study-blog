---
title: "Simple Queue Service"
date: 2025-06-17
draft: false
description: "메시지 큐 시스템 직접 구현하기"
icon: "🚀"
status: "진행중"
tech: ["Kotlin", "Spring WebFlux", "Redis", "React"]
links:
  - name: "GitHub Repository"
    url: "https://github.com/jyukki97/simple-queue-service"
    icon: "🔗"
  - name: "개발 블로그 시리즈"
    url: "/posts?project=simple-queue-service"
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
- **Hot Storage (Redis Memory)**: < 1ms 초고속 처리
- **Warm Storage (Redis Disk)**: 1-10ms 중간 빈도 접근  
- **Cold Storage (File System)**: 100-1000ms 장기 보관
- **자동 계층화**: 시간/용량/접근패턴 기반 지능형 이관

## 🛠️ 기술 스택

**백엔드 (Kotlin 생태계)**
```
Kotlin                  # 멀티플랫폼 언어의 장점 활용
Spring WebFlux          # 반응형 프로그래밍 & 높은 동시성
Spring Data Redis       # Redis 연동 및 트랜잭션 관리
```

**스토리지 (Redis 활용)**
```
Redis                   # 메모리 DB, 퍼시스턴스, 클러스터링
Local File System       # 콜드 스토리지 (GZIP 압축)
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
    │ (Redis Memory)  │ │ (Redis Disk)    │ │ (File System)   │
    │   < 1ms access  │ │ 1-10ms access   │ │100-1000ms acc.  │
    │   1 hour TTL    │ │  24 hour TTL    │ │  14 days TTL    │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
            │                   │                   │
            └─────── Auto Migration & Smart Promotion ───────┘
```

## 📝 개발 블로그 시리즈

프로젝트 개발 과정에서 배운 내용을 기록하고 있습니다.

## 🔗 관련 링크

- **GitHub Repository**: [프로젝트 소스코드](https://github.com/jyukki/simple-queue-service)
- **개발 블로그**: [개발 블로그 시리즈](/posts?project=simple-queue-service)
