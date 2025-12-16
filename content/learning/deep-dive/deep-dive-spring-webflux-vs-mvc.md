---
title: "WebFlux vs MVC 선택 가이드"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["WebFlux", "Spring MVC", "Reactive", "비동기"]
categories: ["Backend Deep Dive"]
description: "Reactive 필요성 판단 기준, 스레드 모델 차이, 적용/비적용 시나리오 정리"
module: "spring-core"
study_order: 24
---

## 선택 기준

- **적합**: 대규모 동시 I/O(스트리밍, 웹소켓, 외부 API 팬아웃), 요청당 CPU 작업이 짧을 때
- **비적합**: 무거운 CPU 작업, JDBC와 같은 블로킹 I/O, 레거시 라이브러리 의존

## 스레드 모델

- MVC: 요청당 톰캣 스레드, 블로킹 I/O
- WebFlux: 이벤트 루프(Netty), Non-blocking I/O, `Schedulers.boundedElastic()`로 블로킹 우회

```java
Mono<Profile> profile = webClient.get()
    .uri("/profiles/{id}", id)
    .retrieve()
    .bodyToMono(Profile.class)
    .subscribeOn(Schedulers.boundedElastic()); // 블로킹 호출 우회
```

## 주의사항

- 블로킹 라이브러리는 별도 스케줄러로 격리, 풀 크기 관리
- 비즈니스 로직 복잡 시 체인 가독성 유지(메서드 추출/도메인 서비스 분리)
- 테스트: `StepVerifier`로 리액티브 시퀀스 검증

## 체크리스트

- [ ] 요구사항이 I/O 바운드/동시성 높은가?
- [ ] 의존 라이브러리가 논블로킹인지 확인
- [ ] 모니터링/프로파일링 도구가 리액티브 스택을 지원하는지 확인
