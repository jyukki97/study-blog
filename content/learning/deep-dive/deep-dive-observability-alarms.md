---
title: "알람 전략: 에러율/레이턴시/자원지표 설계"
date: 2025-12-16
draft: false
topic: "Observability"
tags: ["Alerting", "SLO", "Prometheus", "On-call"]
categories: ["DevOps"]
description: "알람 설계 원칙, 임계치/증분 알람, 온콜 운영 가이드"
module: "ops-observability"
study_order: 360
---

## 알람 설계 원칙

- 소수 정예 알람: 반드시 액션 가능한 것만
- 증분 알람: 임계치 초과 + 증가율 감지
- SLI 기반: 레이턴시/에러율/트래픽/자원 지표

## 예시 지표

- HTTP: 에러율(4xx/5xx), p95/p99 레이턴시, 요청 수 급증/급감
- 인프라: CPU/메모리/디스크/네트워크, JVM GC 중단, DB 커넥션 풀 고갈
- 메시징: Kafka Lag, DLQ 증가

## 체크리스트

- [ ] 임계치와 관찰 기간 명시(예: 5분 이동 평균)
- [ ] 온콜 라우팅/조용 시간/에스컬레이션 정의
- [ ] Runbook 링크 포함(해결 절차)
- [ ] 알람 테스트/무음/해제 프로세스 마련
