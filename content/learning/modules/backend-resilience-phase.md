---
title: "5단계: 시스템 안정성 & 회복탄력성 (Resilience)"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["Resilience", "CircuitBreaker", "RateLimiter", "Gateway"]
categories: ["Learning"]
description: "장애 전파 차단, 트래픽 제어, 고가용성 설계를 다루는 모듈"
weight: 5
study_order: 500
layout: "learning-module"
module_key: "resilience"
url: "/learning/modules/backend-resilience-phase/"
---

## 이 단계에서 얻는 것

이 단계는 **"장애는 반드시 발생한다"**는 전제 하에 시스템을 지키는 기술을 다룹니다.

- **격벽과 차단**: 서킷 브레이커로 장애 전파를 막는 원리를 배웁니다.
- **트래픽 제어**: 레이트 리미터로 시스템을 보호하고 공정성을 확보합니다.
- **게이트웨이 전략**: 인증/라우팅/필터를 중앙화하여 마이크로서비스를 보호합니다.

## 이 모듈을 보는 방법

1) **보호**: 서킷 브레이커와 레이트 리미터로 개별 서비스를 보호하고
2) **진입점**: API 게이트웨이로 전체 시스템의 대문을 튼튼하게 만든 뒤
3) **관문**: 로드밸런서와 헬스체크로 고가용성 인프라를 완성합니다.

## 왜 이런 순서인가

애플리케이션 내부의 보호 장치(Resilience4j)부터 시작해, 앞단의 게이트웨이, 로드밸런서로 나아가는 **Inside-Out** 접근 방식입니다.
