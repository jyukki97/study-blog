---
title: "시스템 설계: 뉴스피드"
date: 2025-12-16
draft: false
topic: "System Design"
tags: ["System Design", "Newsfeed", "Fanout", "Cache"]
categories: ["Backend Deep Dive"]
description: "Fan-out on write/read, 캐시/타임라인 테이블 설계, 지연/일관성 트레이드오프 정리"
module: "data-system"
study_order: 290
---

## 요구사항

- 팔로우 관계 기반 피드, 최신순 정렬, 좋아요/댓글 카운트 표시
- 지연/일관성/비용 트레이드오프가 핵심

## Fan-out 전략

- **Fan-out on write**: 글 작성 시 팔로워 타임라인에 복사 → 읽기 빠름, 쓰기 비용↑
- **Fan-out on read**: 읽기 시 조인/정렬 → 읽기 비용↑, 실시간성↑, 캐시 필수
- 하이브리드: 상위 팔로워 수 구간별 전략 분리

## 설계 포인트

- 타임라인 테이블/캐시: `user_timeline(user_id, post_id, created_at)`
- 상위 작성자 핫키 처리(큐/비동기, 샤딩)
- 좋아요/댓글 카운트는 캐시/비동기 집계
- 캐시: 최근 N개 Redis, 백필(backfill) 로직

## 체크리스트

- [ ] 팔로워 수 구간별 fan-out 전략 정의
- [ ] 캐시 만료/백필 전략 마련
- [ ] 정렬/페이징 시 인덱스 키 설계 (`(user_id, created_at desc)`)
- [ ] 지연 허용 범위와 일관성 요구사항 명시
