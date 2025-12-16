---
title: "GraphQL 스키마 설계 가이드"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["GraphQL", "Schema", "Resolver", "N+1"]
categories: ["Backend Deep Dive"]
description: "스키마 정의, 리졸버 구조, N+1 방지(DataLoader), 버전 관리 베스트 프랙티스"
module: "architecture"
study_order: 485
---

## 스키마 설계

- 타입/필드 명확화, nullable/비nullable 구분
- 입력/출력 분리(InputType vs Type), 에러 표준화

## N+1 방지

- DataLoader/배치 로더로 연관 데이터 일괄 조회
- 캐싱/페이징(커서 기반) 적용

## 체크리스트

- [ ] 필드 단위 권한 검증 필요 여부 검토
- [ ] 슬라이싱/커서 페이징으로 대량 조회 대응
- [ ] Breaking change 피하기(필드 추가는 자유, 삭제는 Deprecated 후 단계적 제거)
