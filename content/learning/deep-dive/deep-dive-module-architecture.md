---
title: "모듈 아키텍처: 패키지/레이어/멀티모듈 설계"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Architecture", "Module", "Package Design", "Multi-Module"]
categories: ["Backend Deep Dive"]
description: "Layered vs Modular, 패키지 의존성 최소화, 멀티모듈 분리 전략"
module: "architecture"
study_order: 420
---

## 설계 원칙

- 의존성 방향: UI → Application → Domain → Infrastructure
- 패키지 순환 참조 금지, 인터페이스로 방향 역전
- 멀티모듈: api/domain/app/infra 등으로 분리해 빌드/배포 속도와 격리를 확보

## 체크리스트

- [ ] 패키지/모듈 간 순환 의존성이 없는가?
- [ ] 도메인 규칙은 domain 레이어에, 인프라 세부 구현은 infrastructure에 격리했는가?
- [ ] 멀티모듈 간 API/DTO를 명확히 정의했는가?
