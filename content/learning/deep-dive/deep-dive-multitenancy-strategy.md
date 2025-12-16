---
title: "멀티테넌시 설계 전략"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Multitenancy", "Schema", "Isolation", "Security"]
categories: ["Backend Deep Dive"]
description: "스키마/데이터베이스 분리, 테넌트 격리/보안, 마이그레이션·운영 고려사항"
module: "architecture"
study_order: 490
---

## 격리 모델

- 스키마 분리(Shared DB, Separate Schema)
- DB 분리(테넌트별 인스턴스)
- Row-level filter(가벼우나 보안/쿼리 복잡도↑)

## 고려사항

- 보안: 테넌트 ID 강제 필터, 인덱스/쿼리 플랜 영향
- 마이그레이션/배포: 테넌트별 롤링/스키마 버전 관리
- 스케일/비용: 핫 테넌트 분리, 콜드 테넌트 집약

## 체크리스트

- [ ] 테넌트 식별/검증을 미들웨어/DB 레벨에서 강제
- [ ] 백업/복구/마이그레이션 절차 테넌트 단위로 확보
- [ ] 모니터링/과금 지표를 테넌트 단위로 수집
