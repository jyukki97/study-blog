---
title: "2단계: 스프링 핵심 공략 (Core/Boot/JPA/테스트)"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["Spring", "JPA", "테스트", "백엔드"]
categories: ["Learning"]
description: "스프링 코어, 부트 자동설정, JPA, 테스트 전략을 집중적으로 다지는 모듈"
weight: 2
study_order: 100
layout: "learning-module"
module_key: "spring-core"
url: "/learning/career/backend-spring-core-phase/"
aliases:
  - "/learning/career/backend-spring-core-phase/"
---

## 목표

- IoC/AOP, Bean 라이프사이클을 코드로 체화
- Spring Boot 자동 설정 흐름, 프로파일/환경설정 분리
- JPA 영속성 컨텍스트, 연관관계 매핑, N+1 패턴 해결
- JUnit 5 + Mockito + Testcontainers로 테스트 베이스라인 구축

## 핵심 체크리스트

- [ ] IoC/DI, Bean Scope/라이프사이클, AOP Proxy
- [ ] @ConfigurationProperties, Auto-Configuration 원리, Profile 분리
- [ ] 영속성 컨텍스트: 1차 캐시, 변경 감지, flush/clear
- [ ] 연관관계 매핑, FetchType.LAZY, Fetch Join, Batch Size
- [ ] 트랜잭션 경계, 전파/격리, @Transactional 테스트 주의점
- [ ] 테스트: JUnit 5, Mockito, @DataJpaTest, Testcontainers(MySQL/Redis)

## 실습 과제

- [ ] 간단한 게시판/주문 도메인으로 `@DataJpaTest` + Testcontainers 적용
- [ ] AOP로 `@LogExecution` 어노테이션을 만들어 성능 로그 남기기
- [ ] 다중 프로파일(dev/stage/prod) yml 분리 + Actuator health 체크 확인
- [ ] QueryDSL 기본 쿼리 3개 작성 (조건/정렬/페이징)

## 참고 자료

- 김영한 스프링 로드맵, Effective Java
- 자바 ORM 표준 JPA 프로그래밍
- Spring Docs: Core, Boot features, Data JPA, Testing
