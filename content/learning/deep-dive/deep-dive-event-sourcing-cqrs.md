---
title: "Event Sourcing과 CQRS 입문"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Event Sourcing", "CQRS", "Command", "Query"]
categories: ["Backend Deep Dive"]
description: "이벤트 소싱과 CQRS 기본 개념, 장단점, 적용 시 고려사항"
module: "architecture"
study_order: 460
---

## 개념

- Event Sourcing: 상태를 이벤트 로그로 저장, 현재 상태는 이벤트 재생으로 복원
- CQRS: 명령/조회 모델 분리, 읽기 최적화

## 장단점

- 장점: 히스토리/감사 로그, 확장성(읽기/쓰기 분리), 추후 파생 리드모델 생성 용이
- 단점: 복잡성 증가, 최종 일관성, 이벤트 스키마/버전 관리 필요

## 체크리스트

- [ ] 이벤트 불변성/버전 관리 전략
- [ ] 리드 모델 갱신 지연 허용 여부, 보상/재처리 설계
- [ ] 이벤트 저장소/스냅샷 전략
