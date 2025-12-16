---
title: "모놀리스를 모듈러/서비스로 나누기"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Monolith", "Modularization", "Service Split", "Strangler"]
categories: ["Backend Deep Dive"]
description: "모놀리스 코드베이스를 단계적으로 모듈러/서비스로 분리하는 전략"
module: "architecture"
study_order: 430
---

## 단계별 접근

1) 모듈 경계 설정: 도메인별 패키지/모듈 분리, 의존성 정리  
2) 내부 인터페이스 추출: 도메인 서비스/포트-어댑터 패턴  
3) 독립 배포 가능한 모듈/서비스로 분리(Strangler)  

## 체크리스트

- [ ] 데이터 스키마/트랜잭션 경계 고려 후 분리 순서 결정
- [ ] 공통/크로스컷팅 코드를 별도 모듈로 추출
- [ ] 점진적 릴리스: 트래픽 일부를 새 모듈/서비스로 라우팅
