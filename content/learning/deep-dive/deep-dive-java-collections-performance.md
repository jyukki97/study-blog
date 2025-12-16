---
title: "Java 컬렉션 성능 튜닝 가이드"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Java", "Collections", "Performance", "HashMap", "ArrayList"]
categories: ["Backend Deep Dive"]
description: "ArrayList/LinkedList/HashMap/ConcurrentHashMap 등 주요 컬렉션의 성능 특성과 튜닝 포인트"
module: "foundation"
study_order: 65
---

## 특성 요약

- ArrayList: 연속 메모리, 끝 삽입 amortized O(1), 중간 삽입/삭제 O(n)
- LinkedList: 중간 삽입/삭제 O(1) (노드 참조 필요), 랜덤 접근 O(n)
- HashMap/ConcurrentHashMap: 평균 O(1), 해시 품질/부하율 중요

## 튜닝 포인트

- 초기 용량 설정으로 리사이즈 최소화
- CHM은 세그먼트 잠금이 아닌 노드 수준 락(SynchronizedBucket), 키 분포 주의
- 박싱/언박싱 비용 피하기: primitive용 컬렉션(예: HPPC/fastutil) 고려

## 체크리스트

- [ ] 예상 크기 → withInitialCapacity 사용
- [ ] 해시 키 equals/hashCode 일관성
- [ ] 병렬 환경: CHM 사용, 병렬 스트림 주의
