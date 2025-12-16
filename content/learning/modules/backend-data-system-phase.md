---
title: "3단계: 데이터베이스 & 시스템 설계"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["데이터베이스", "시스템설계", "Redis", "백엔드"]
categories: ["Learning"]
description: "인덱스/트랜잭션/캐싱과 시스템 설계 연습을 묶은 모듈"
weight: 3
study_order: 30
layout: "learning-module"
module_key: "data-system"
url: "/learning/career/backend-data-system-phase/"
aliases:
  - "/learning/career/backend-data-system-phase/"
---

## 목표

- MySQL/PostgreSQL 인덱스, 실행 계획, 트랜잭션/락 이해
- Redis로 캐싱/세션/레이트 리미터 구성
- 대표 시스템 설계 문제(URL Shortener, 뉴스피드, Rate Limiter) 풀어보기

## 핵심 체크리스트

- [ ] 인덱스 설계: B-Tree, Covering Index, Composite Index 순서
- [ ] 실행 계획 읽기: EXPLAIN type/order_key/rows/filter
- [ ] 트랜잭션 & 락: 격리수준, Gap/Next-Key Lock, Deadlock 회피 패턴
- [ ] Redis: 자료구조(String/Hash/Sorted Set), Cache-Aside, 분산락, TTL 설계
- [ ] 샤딩/파티셔닝, CQRS, 캐시 계층 설계
- [ ] 시스템 설계: 트래픽 추정, 병목 찾기, 확장성/가용성/일관성 Trade-off

## 실습 과제

- [ ] 동일한 조회 API를 인덱스 전/후로 EXPLAIN 결과 비교
- [ ] Redis Sorted Set으로 랭킹/리더보드 구현
- [ ] Kafka 없이도 가능한 간단한 이벤트 발행/처리 예제 작성 (DB Outbox or 메시지 테이블)
- [ ] URL Shortener 설계안 작성: 키 생성, 충돌 처리, 캐시/DB 계층, 장애 대응 방안 포함

## 참고 자료

- Real MySQL 8.0, 데이터 중심 애플리케이션 설계
- System Design Interview v1/v2, System Design Primer
- Redis 공식 문서(캐싱/락/TTL), Percona/MySQL Performance Blog
