---
title: "JPA 성능 면접 Q&A (N+1, fetch join, OSIV)"
study_order: 862
date: 2025-12-28
topic: "Backend"
tags: ["JPA", "성능", "N+1", "면접"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
series_order: 32
draft: false
module: "interview-readiness"
---

## Q1. N+1 문제를 어떻게 설명하나요?

### 답변

N+1은 "목록 1번 조회 + 연관 엔티티를 개별로 N번 추가 조회"되는 문제입니다.
보통 LAZY 연관을 루프에서 접근할 때 발생합니다.

- 징후: API는 단순 목록인데 SQL이 과도하게 많이 찍힘
- 관측: Hibernate SQL 로그, APM endpoint별 query count

## Q2. 해결책은 fetch join 하나면 되나요?

### 답변

fetch join이 강력하지만 만능은 아닙니다.

- 장점: 한 번의 쿼리로 연관 로딩
- 주의: 컬렉션 fetch join + 페이징은 중복 row/메모리 이슈 가능

대안:
- DTO projection
- batch size 설정
- 읽기 전용 조회 분리

## Q3. OSIV는 켜야 하나요 꺼야 하나요?

### 답변

면접 답변 포인트는 "상황 기반"입니다.

- **켜면**: 개발 편의성↑, Lazy 예외↓
- **끄면**: 트랜잭션 경계 명확, 쿼리 통제 쉬움(운영 안정)

실무에서는 API 서버에서 OSIV를 끄고 서비스 계층에서 조회/매핑을 끝내는 방식이 자주 쓰입니다.

## Q4. 1분 답변 템플릿?

### 답변

"N+1은 연관 엔티티 지연 로딩이 반복 접근되며 생기는 쿼리 폭증 문제입니다. 저는 SQL 로그/APM으로 탐지하고, fetch join이나 DTO projection으로 줄였습니다. 다만 컬렉션 fetch join 페이징 이슈가 있어 배치 사이즈/조회 분리 전략을 함께 씁니다. OSIV는 운영 API에선 보통 끄고 트랜잭션 경계를 명확히 관리합니다."

## 요약

- N+1은 개념보다 **탐지/재현/개선** 흐름으로 설명하면 강하다.
- fetch join은 강력하지만 페이징/메모리 트레이드오프를 반드시 언급해야 한다.

## 다음 글

- [Spring 트랜잭션 Q&A Part 2](/learning/qna/spring-transaction-qna-part2/)
- [DB 병목 대응 순서 Q&A](/learning/qna/db-bottleneck-troubleshooting-framework-qna/)
