---
title: "백업·DR(Disaster Recovery) 전략"
date: 2025-12-16
draft: false
topic: "Ops"
tags: ["Backup", "Disaster Recovery", "RPO", "RTO"]
categories: ["DevOps"]
description: "RPO/RTO 정의, 백업/복구, DR 리전 설계와 주기적 복구 테스트 가이드"
module: "ops-observability"
study_order: 390
---

## 핵심 개념

- RPO: 허용 데이터 손실량, RTO: 복구 허용 시간
- 백업 유형: 전체/증분/스냅샷, PITR
- DR 전략: 단일 AZ 대비, 다중 AZ, 다중 리전(Active/Passive, Pilot Light, Warm Standby)

## 체크리스트

- [ ] RPO/RTO를 비즈니스와 합의
- [ ] 백업 주기/보존 기간/암호화/무결성 검증
- [ ] 정기 복구 드릴 수행, 자동화된 복구 스크립트
- [ ] DR 리전 DNS 전환/컷오버 절차 문서화
