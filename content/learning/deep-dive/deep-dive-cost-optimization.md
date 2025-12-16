---
title: "클라우드 비용 최적화 전략"
date: 2025-12-16
draft: false
topic: "Ops"
tags: ["Cost Optimization", "Autoscaling", "Caching", "Reserved Instance"]
categories: ["DevOps"]
description: "오토스케일, 캐시/스토리지 티어링, 예약/세이빙 플랜, 모니터링을 통한 비용 최적화"
module: "ops-observability"
study_order: 385
---

## 주요 전략

- 오토스케일: CPU/메모리/커스텀 지표 기반 조정
- 캐시 활용: DB 부하 절감, CDN/Redis/Caffeine
- 스토리지 티어: 핫/콜드 구분, 수명 주기(Lifecycle)
- RI/Savings Plan: 장기 워크로드에 할인 적용

## 체크리스트

- [ ] 리소스 사용량/코스트 대시보드 정기 점검
- [ ] 과대할당 인스턴스 다운사이징
- [ ] 데이터 전송 비용(리전/인터넷) 확인
- [ ] 불필요 리소스(미사용 볼륨/로드밸런서) 정리
