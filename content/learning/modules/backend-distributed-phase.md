---
title: "4단계: 분산 시스템 & 아키텍처 (Distributed Systems)"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["분산시스템", "아키텍처", "Kafka", "Sharding", "CAP"]
categories: ["Learning"]
description: "분산 트랜잭션, 일관성 모델, 샤딩, 이벤트 드리븐 아키텍처를 다루는 모듈"
weight: 4
study_order: 400
layout: "learning-module"
module_key: "distributed-system"
url: "/learning/modules/backend-distributed-phase/"
aliases:
  - "/learning/modules/backend-architecture-phase/"
---

## 이 단계에서 얻는 것

이 단계는 **단일 서버를 넘어선 분산 환경**에서의 아키텍처를 다룹니다.

- **데이터 분산의 기술**: 샤딩(Sharding), 컨시스턴트 해싱으로 무한 확장의 원리를 이해합니다.
- **분산 정합성**: 2PC, Saga 패턴으로 분산 환경에서 트랜잭션을 설계합니다.
- **이벤트 기반 아키텍처**: Kafka를 활용한 비동기 통신과 결과적 일관성을 확보합니다.

## 이 모듈을 보는 방법

1) **분산의 기초**: CAP 이론과 일관성 모델(Strong vs Eventual)을 이해하고
2) **데이터 확장**: 샤딩 전략과 라우팅 원리를 파악한 뒤
3) **트랜잭션**: 분산된 서비스 간 정합성을 맞추는 패턴(Saga)을 학습합니다.

## 왜 이런 순서인가

분산 시스템은 **"확장성"을 얻는 대신 "일관성"을 희생**하는 트레이드오프의 연속입니다.
그래서 이론적 배경(CAP/Consistency)을 먼저 잡고, 구체적인 기술(Kafka, Sharding)로 들어가는 흐름입니다.
