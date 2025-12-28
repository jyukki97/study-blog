---
title: "백엔드 학습 커리큘럼 한눈에 보기"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
topic_icon: "🧭"
topic_description: "백엔드 개발 학습을 위한 단계별 로드맵"
tags: ["백엔드", "로드맵", "커리큘럼", "학습전략"]
categories: ["Learning"]
description: "모듈형 커리큘럼 구조, 학습 루틴, 자료 모음을 한 번에 정리한 학습 개요"
weight: 0
study_order: 0
layout: "learning-module"
module_key: "overview"
url: "/learning/modules/backend-curriculum-overview/"
aliases:
  - "/learning/modules/backend-curriculum-overview/"
---

## 왜 이 커리큘럼인가?

이 커리큘럼은 “이직 준비/면접 대비”가 아니라, **백엔드 실력을 실제로 올리기 위한 학습 지도**입니다.
단순 체크리스트가 아니라, 각 글을 읽고 나면 “내가 뭘 이해했고 무엇을 할 수 있는지”가 남도록 구성합니다.

- **모듈형 흐름**: 기초 → 스프링 → 데이터/설계 → 운영/모니터링 → 심화/시스템 설계 → 복습(Q&A)
- **학습용 문서 형식**: 각 글마다 “이 글에서 얻는 것 → 핵심 개념 → 예제/실무 기준 → 자주 하는 실수 → 연습” 형태로 정리
- **계속 확장 가능**: 글이 늘어나도 `study_order`로 순서가 유지되도록 여유 간격을 둬서 관리

## 커리큘럼 구조

아래 **단계(모듈)** 를 따라가면 “모르는 걸 모르는 상태”에서 “설계/운영까지 스스로 판단 가능한 상태”로 점진적으로 올라가게 됩니다.

1. [1단계: 백엔드 기초 다지기](/learning/modules/backend-foundation-phase/)  
   - 언어/JVM/동시성/네트워크/OS/자료구조·알고리즘 기본기를 **현업 관점**으로 정리합니다.
2. [2단계: 스프링 핵심 공략](/learning/modules/backend-spring-core-phase/)  
   - 스프링의 핵심 추상(DI/AOP/트랜잭션)과 테스트/JPA를 “왜/언제/어떻게”로 연결합니다.
3. [3단계: 데이터베이스 & 시스템 설계](/learning/modules/backend-data-system-phase/)  
   - 인덱스/트랜잭션/격리수준/락/캐시/메시징을 **성능·정합성·확장성** 기준으로 다룹니다.
4. [4단계: 운영 · 배포 · 모니터링](/learning/modules/backend-ops-observability-phase/)  
   - 장애를 “운”으로 넘기지 않게, 배포/관측/알림/회복탄력성의 기본기를 갖춥니다.
5. [5단계: 심화/시스템 설계](/learning/modules/backend-architecture-phase/)  
   - 모듈/도메인/분리 전략부터 컷오버/마이그레이션, 실시간/이벤트 기반 설계까지 확장합니다.
6. [6단계: 복습(Q&A)](/learning/modules/backend-qna-phase/)  
   - 각 단계에서 부딪히는 질문을 짧고 정확하게 다시 꺼내볼 수 있게 정리합니다.
7. [7단계: 보안 (Security Specialist)](/learning/modules/backend-security-phase/)  
   - OWASP, TLS, 암호화 등 안전한 서비스를 만들기 위한 필수 보안 지식을 다룹니다.
8. [8단계: 컴퓨터 공학 심화 (Deep CS)](/learning/modules/backend-advanced-cs-phase/)  
   - 분산 정합성, DB 엔진 원리, OS I/O 등 시니어 레벨의 이론적 깊이를 다룹니다.
9. [9단계: 현대적 백엔드 기술 (Modern Frontiers)](/learning/modules/backend-modern-frontiers/)  
   - Vector DB(AI), HTTP/3(QUIC), Serverless 내부 구조 등 최신 기술의 엔지니어링 원리를 파헤칩니다.
10. [10단계: 아키텍처 마스터리 (Architecture Mastery)](/learning/modules/backend-architecture-mastery/)  
    - 분산 트랜잭션(SAGA), 샤딩(Consistent Hashing), DDD Aggregate 등 규모 있는 시스템의 난제를 해결합니다.

*(선택사항) [부록: 실습실 (Labs)](/learning/labs/) - 이론을 코드로 연습해보고 싶다면 참고하세요.*

## 어떻게 공부하면 좋은가 (읽고 끝내지 않기)

이 블로그의 글은 “완독”이 목표가 아니라, **학습-실습-검증-설명**이 한 바퀴 도는 것이 목표입니다.

1. **개념을 언어로 설명해보기**: 핵심 용어를 “내 말”로 정의합니다.  
2. **작게 구현/실험하기**: 최소한의 코드로 재현해보고, 로그/스택트레이스/지표를 확인합니다.  
3. **기준을 세우기**: “언제 A를 쓰고, 언제 B를 피하는지” 선택 기준을 글에 남깁니다.  
4. **연습 문제로 잠그기**: 작은 과제로 개념을 고정하고, 다음 글로 넘어갑니다.

## 이 커리큘럼을 보는 방법

- **Learning 메인**: 단계(모듈)와 최신 글을 한 번에 봅니다.
- **타임라인**: 숫자(`study_order`) 순으로 “처음부터 끝까지” 따라가기 좋습니다.
- **각 모듈 페이지**: 해당 단계에서 읽을 글이 순서대로 모입니다.

## 추천 자료 (단권화)

- **언어/동시성**: Effective Java, Java Concurrency in Practice
- **스프링/JPA**: 김영한 스프링 로드맵(강의/책), Spring 공식 문서, Hibernate ORM 문서
- **DB/설계**: Real MySQL 8.0, Designing Data-Intensive Applications
- **운영/관측**: Google SRE, Prometheus/Grafana 공식 문서

## 바로 시작하기

- 처음부터 차근차근 → [1단계: 기초 다지기](/learning/modules/backend-foundation-phase/)
- “지금 막히는 주제”부터 → Learning 메인에서 토픽 카드로 찾아가면 됩니다.
