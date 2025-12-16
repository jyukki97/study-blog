---
title: "도메인 모델링: 엔티티, 값 객체, 애그리게이트"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["DDD", "Aggregate", "Entity", "Value Object", "Bounded Context"]
categories: ["Backend Deep Dive"]
description: "도메인 모델링 기본 개념과 애그리게이트 경계를 잡는 방법"
module: "architecture"
study_order: 410
---

## 핵심 개념

- 엔티티: 식별자 기반, 불변식(invariant) 유지
- 값 객체: 동등성/불변, 캡슐화된 개념
- 애그리게이트: 일관성 경계, 루트 엔티티를 통한 접근
- 바운디드 컨텍스트: 모델의 의미 범위, 외부와는 계약(ACL/DTO)으로 교류

## 체크리스트

- [ ] 불변식이 함께 유지되어야 하는 객체를 한 애그리게이트로 묶었는가?
- [ ] 외부에서 애그리게이트 내부에 직접 접근하지 않고 루트를 통해 조작하는가?
- [ ] 값 객체로 표현 가능한 개념을 엔티티로 과도하게 만들지 않았는가?
