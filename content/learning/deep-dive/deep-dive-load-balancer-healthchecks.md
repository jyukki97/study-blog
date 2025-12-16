---
title: "로드밸런서/헬스체크 설계"
date: 2025-12-16
draft: false
topic: "Networking"
tags: ["Load Balancer", "Health Check", "ALB", "NLB"]
categories: ["DevOps"]
description: "ALB/NLB 헬스체크, 타임아웃/리트라이 설정, 고가용성을 위한 설계 포인트"
module: "ops-observability"
study_order: 375
---

## 헬스체크 설정

- 경로: 경량 엔드포인트(`/healthz`), 상태/종속성 최소화
- 지표: 간격, 실패 임계치, 타임아웃
- ALB vs NLB: 7계층/4계층 선택, TLS 종료 위치

## 체크리스트

- [ ] 헬스체크가 DB/외부 의존성에 묶여 다운되지 않도록 분리
- [ ] 타임아웃/간격을 실제 SLO에 맞게 설정
- [ ] 멀티 AZ 배치, 비정상 인스턴스 격리 확인
