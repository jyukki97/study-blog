---
title: "WebFlux vs MVC 면접 Q&A (선택 기준/운영 포인트)"
study_order: 864
date: 2025-12-28
topic: "Backend"
tags: ["WebFlux", "Spring MVC", "비동기", "면접"]
categories: ["Backend"]
series: ["핵심 개념 Q&A"]
series_order: 34
draft: false
module: "interview-readiness"
---

## Q1. WebFlux와 MVC를 어떻게 선택하나요?

### 답변

질문은 "누가 더 좋냐"가 아니라 "우리 상황에 무엇이 맞냐"입니다.

- MVC: 동기/블로킹 모델, 팀 친숙도 높음, 일반 CRUD에 충분
- WebFlux: 논블로킹, I/O 대기가 많은 환경에서 효율적

## Q2. WebFlux 도입하면 무조건 빨라지나요?

### 답변

아닙니다.

- DB/외부 API가 이미 병목이면 프레임워크 교체만으로 큰 효과 없음
- 팀 숙련도 낮으면 오히려 디버깅/운영 복잡도 증가

## Q3. 운영에서 중요한 포인트는?

### 답변

- 타임아웃/재시도 정책
- Backpressure 처리
- 스레드 모델 이해(이벤트 루프 블로킹 금지)
- 모니터링(지연/큐 적체/외부 의존성 실패율)

## Q4. 면접용 1분 답변 예시?

### 답변

"저는 기본적으로 MVC를 선택하고, 대규모 I/O 대기·스트리밍 시나리오에서 WebFlux를 검토합니다. WebFlux는 논블로킹으로 효율이 좋지만, 팀 숙련도와 운영 난이도 비용이 있습니다. 그래서 트래픽 특성, 병목 위치, 팀 역량을 같이 보고 선택합니다."

## 요약

- 기술 우열보다 **선택 기준**을 말하는 게 실무형 답변이다.
- WebFlux는 도구이고, 병목 원인 분석이 먼저다.

## 다음 글

- [WebFlux 구조 Q&A](/learning/qna/webflux-structure-qna/)
- [API 성능 Q&A](/learning/qna/api-performance-qna/)
