---
title: "Rust 해시맵 내부 동작 깊이 보기"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Rust", "HashMap", "해시", "데이터구조"]
categories: ["Backend Deep Dive"]
description: "Rust HashMap(기본: SwissTable) 내부 구조, 해시 충돌 처리, 성능 특성을 정리"
module: "foundation"
study_order: 55
---

## 핵심 포인트

- 기본 구현은 SwissTable 기반(Quadratic probing + SIMD bucket search)
- 키 해싱: SipHash(보안)/ahash(성능) 등 선택
- 부하율 조정: 자동 리사이즈, 예측 가능한 capacity 설정으로 할당 최소화

## 체크리스트

- [ ] capacity/with_capacity로 재할당 줄이기
- [ ] 보안이 중요한 경우 기본 SipHash 유지, 성능 중시 시 ahash 고려
- [ ] 해시 키는 Eq/Hash 일관성 유지, 커스텀 타입은 파생 구현 확인
