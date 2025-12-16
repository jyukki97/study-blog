---
title: "레거시 리팩터링 전략"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Legacy", "Refactoring", "Strangler", "Tech Debt"]
categories: ["Backend Deep Dive"]
description: "대규모 레거시 개선을 위한 우선순위, 단계별 접근, 위험 관리"
module: "architecture"
study_order: 450
---

## 접근 방법

- 목적/비즈니스 임팩트 명확히 → 우선순위 선정
- Strangler 패턴: 새 코드로 둘러싸면서 점진적 대체
- 위험 관리: 안전망 테스트, 피쳐 플래그, 점진적 릴리스

## 체크리스트

- [ ] 리스크 높은 영역부터 테스트 커버리지 확보
- [ ] 데이터/스키마 변경은 마이그레이션 계획과 함께
- [ ] 성능/운영 모니터링을 병행해 회귀 감지
