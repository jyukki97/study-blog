---
title: "트래픽 컷오버 & 데이터 마이그레이션 전략"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Migration", "Cutover", "Data Migration", "Dual Write"]
categories: ["Backend Deep Dive"]
description: "점진적 트래픽 전환, 데이터 동기화, 롤백 전략을 설계하는 방법"
module: "architecture"
study_order: 440
---

## 전환 패턴

- Shadow/Observe: 새 경로로 미러링, 결과 비교
- 분할 전환: 트래픽 일부(비율/사용자 그룹)만 새 시스템으로
- 데이터 동기화: Dual write/Change Data Capture(CDC)

## 체크리스트

- [ ] 전환/롤백 스위치 플래그 마련
- [ ] 데이터 동기화 지연/충돌 처리 설계
- [ ] 모니터링/알람으로 전환 상태 감시
