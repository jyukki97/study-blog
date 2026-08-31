---
title: "JPA 성능 면접 Q&A (N+1, fetch join, OSIV)"
study_order: 862
date: 2025-12-28
topic: "Backend"
tags: ["JPA", "성능", "N+1", "면접"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
description: "JPA N+1 문제, fetch join, OSIV 등 성능 관련 면접 Q&A"
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

## Q5. 목록 API가 느릴 때 무엇부터 확인하나요?

### 답변

처음부터 fetch join을 추가하지 않습니다. 먼저 **요청 하나가 실제로 몇 개의 SQL을 실행하는지**, 그리고 그 SQL이 얼마나 많은 행을 애플리케이션으로 가져오는지를 나눠 봅니다. 예를 들어 주문 20건을 보여 주는 화면에서 주문마다 회원과 배송 정보를 접근한다면, SQL 개수는 늘어날 수 있습니다. 반대로 fetch join으로 한 번에 가져왔더라도 주문 항목처럼 컬렉션을 함께 조인하면 결과 행이 급증할 수 있습니다. 둘은 모두 "느리다"로 보이지만 해결책은 다릅니다.

실무 답변에서는 다음 순서를 제시하면 판단 근거가 분명해집니다.

1. **재현 범위 고정**: 느린 endpoint, 페이지 크기, 정렬 조건, 인증 사용자 조건을 기록하고 로컬·스테이징에서 같은 요청을 재현합니다.
2. **관측값 분리**: query count, DB 실행 시간, 반환 row 수, 응답 직렬화 시간을 함께 확인합니다. query count만 낮아도 큰 조인 결과를 전송하면 응답은 계속 느릴 수 있습니다.
3. **조회 목적에 맞게 선택**: 상세 화면처럼 연관 객체가 꼭 필요하면 제한적인 fetch join을 검토하고, 목록 화면처럼 표시 필드가 정해져 있으면 DTO projection으로 필요한 열만 가져옵니다.
4. **변경 후 비교**: 대표 데이터와 최대 페이지 크기에서 SQL 수와 p95 응답 시간을 다시 비교합니다. "쿼리 한 번"이 목표가 아니라 서비스의 부하와 응답 예산을 지키는 것이 목표입니다.

이 과정은 성능 개선이 도메인 조회 규칙을 깨뜨리지 않게 하는 안전장치이기도 합니다. 조회 전용 DTO를 도입했다면 엔티티를 수정하는 코드와 섞지 않고, 같은 트랜잭션 안에서 불필요한 지연 로딩이 다시 발생하지 않는지 테스트로 확인합니다.

## 면접·리뷰 체크리스트

- [ ] 문제를 "N+1"이라고 부르기 전에 endpoint별 SQL 수와 대표 요청을 확인했는가?
- [ ] 컬렉션 fetch join과 페이징을 함께 쓸 때 row 증가·메모리 사용량을 검토했는가?
- [ ] 목록 조회는 화면에 필요한 필드만 DTO projection으로 좁힐 수 있는가?
- [ ] OSIV 설정 변경 시 lazy loading이 서비스 계층 밖에서 발생하지 않는지 확인했는가?
- [ ] 개선 전후의 query count뿐 아니라 DB 시간과 p95 응답 시간을 비교했는가?

## 요약

- N+1은 개념보다 **탐지/재현/개선** 흐름으로 설명하면 강하다.
- fetch join은 강력하지만 페이징/메모리 트레이드오프를 반드시 언급해야 한다.
- 목록 조회는 쿼리 수만 줄이기보다 반환 행 수와 응답 예산까지 함께 관리해야 한다.

## 다음 글

- [Spring 트랜잭션 Q&A Part 2](/learning/qna/spring-transaction-qna-part2/)
- [DB 병목 대응 순서 Q&A](/learning/qna/db-bottleneck-troubleshooting-framework-qna/)
- [MySQL 성능 튜닝 심화](/learning/deep-dive/deep-dive-mysql-performance-tuning/)
