title: "부록: 실습실 (Hands-on Labs)"
date: 2025-12-28
draft: false
topic: "Backend Roadmap"
tags: ["Project", "Labs", "Practice"]
categories: ["Learning"]
description: "이론으로 배운 내용을 가볍게 구현해보는 연습 문제 모음 (Optional)"
weight: 99
study_order: 999
layout: "learning-module"
module_key: "labs"
url: "/learning/labs/"
---

## 이 단계에서 얻는 것

지금까지 배운 언어, 스프링, DB, 운영 지식을 **하나의 동작하는 시스템**으로 엮어봅니다.  
따라 치는 클론 코딩이 아니라, **"요구사항 → 설계 → 구현 → 트러블슈팅"**의 과정을 직접 겪으며 "내 것"으로 만듭니다.

- **설계 능력**: 막연한 기능을 구체적인 스키마와 API로 구체화합니다.
- **트레이드오프 결정**: "왜 Redis를 썼나요?", "왜 이 구조를 선택했나요?"에 답할 수 있게 됩니다.
- **운영 감각**: 단순히 돌아가는 코드가 아니라, 트래픽을 견디거나 확장이 가능한 구조를 고민합니다.

## 프로젝트 리스트

각 프로젝트는 **요구사항 명세서(Spec)** 형태로 제공됩니다.  
명세를 보고 직접 설계를 먼저 해본 뒤, 가이드를 참고하여 구현해보고, **회고(Retrospective)**를 남기세요.

1. **[URL Shortener (시스템 설계 기초)](/learning/practical/practical-url-shortener/)**  
   - **핵심**: Base62 인코딩, 인덱스 설계, 캐싱 전략, 동시성 처리
   - **규모**: 트래픽이 몰릴 때를 대비한 설계

2. **동시성 제어 - 티켓팅/주문 시스템 (추후 추가)**  
   - **핵심**: 락(Optimistic/Pessimistic/Distributed), 재고 관리, 트랜잭션 격리 수준

3. **실시간 채팅 서비스 (추후 추가)**  
   - **핵심**: WebSocket, STOMP, 메시지 브로커(Kafka/RabbitMQ), 비동기 처리

4. **대규모 트래픽 게시판 (추후 추가)**  
   - **핵심**: 조회 최적화(Cache Look-aside), 검색 엔진(Elasticsearch), 샤딩/파티셔닝 맛보기

## 진행 방법

1. **Spec 읽기**: 기능 요구사항과 비기능 요구사항(성능, 제약조건)을 파악합니다.
2. **Design Doc 작성**: ERD, API 명세, 핵심 로직 흐름도를 간단히 그립니다. (노션, 종이 어디든)
3. **구현**: 코드로 옮깁니다. 테스트 코드는 필수입니다.
4. **Self-Review**: "내가 만든 코드가 100만 트래픽을 받으면 어디가 터질까?"를 고민하고 기록합니다.
