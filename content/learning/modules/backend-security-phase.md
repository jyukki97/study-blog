---
title: "8단계: 보안 (Security Specialist)"
date: 2025-12-28
draft: false
topic: "Backend Roadmap"
tags: ["Security", "Auth", "Cryptography", "Network"]
categories: ["Learning"]
description: "기능 구현을 넘어, 안전한 서비스를 만들기 위한 웹 보안, 인증·인가, 권한 운영, 비밀 관리, 감사 로그 기준을 다룹니다."
weight: 8
study_order: 80
layout: "learning-module"
module_key: "security"
url: "/learning/modules/backend-security-phase/"
---

## 이 단계에서 얻는 것

"보안은 보안팀이 하는 것"이라는 생각에서 벗어나, **개발자가 코드 레벨에서 막아야 할 취약점**과 **운영 중 계속 회수·검토해야 하는 권한과 비밀**을 함께 익힙니다. 초기 구현의 목표가 "로그인된다"라면, 실무 운영의 목표는 "누가 어떤 권한으로 무엇을 했고, 위험해졌을 때 몇 분 안에 끊을 수 있는가"까지 설명하는 것입니다.

- **공격자 관점 이해**: SQL Injection, XSS가 "어떻게" 들어오는지 원리를 알고 막습니다.
- **인증/인가의 깊이**: 단순히 JWT 라이브러리를 쓰는 것을 넘어, 토큰 탈취 시나리오와 대응책을 고민합니다.
- **암호화/https**: 데이터가 전송되고 저장될 때 안전한지 확신할 수 있는 지식을 갖춥니다.
- **권한 운영**: RBAC/ABAC/ReBAC 설계 뒤에도 권한 드리프트, access review, API Key 회전·폐기, 감사 로그를 운영합니다.

## 커리큘럼 (Topic List)

이 모듈은 다음 주제들을 깊이 있게 다룹니다.

### 1. 웹 보안 기초 (Web Security)
- **OWASP Top 10**: 가장 흔한 웹 취약점 10가지와 방어법
- **CORS & CSRF**: 브라우저 보안 정책의 이해와 올바른 설정
- **Injection 방어**: SQL Injection, Command Injection 방지

### 2. 네트워크 & 암호화 (Network & Crypto)
- **HTTPS & TLS**: Handshake 과정, 인증서 검증 원리, HSTS
- **암호화 알고리즘**: 대칭키(AES) vs 비대칭키(RSA), 단방향 해시(SHA/Bcrypt)와 Salt
- **DNS Security**: DNS Spoofing, DNSSEC

### 3. 인증 & 인가 (AuthN & AuthZ)
- **OAuth 2.0 & OIDC**: 프로토콜 흐름 심층 분석 (Grant Types)
- **Session vs Token**: 보안 관점에서의 트레이드오프 (Replay Attack, Hijacking 방지)
- **MFA (Multi-Factor Authentication)**: 다중 인증 구현 원리
- **Authorization Lifecycle**: 권한 부여, 정책 변경, shadow rollout, 사용 이력, 만료, 회수, 캐시 무효화, access review

### 4. 비밀·권한 운영 (Secrets & Access Operations)
- **API Key Lifecycle**: 발급, scope, rate limit, rotation, revocation, revoked key 재사용 감지
- **Permission Drift**: 조직 이동, 임시 예외, 프로젝트 종료 뒤 남는 권한을 탐지하고 회수
- **Audit Evidence**: 권한 변경, secret 회수, review dismissal 같은 high-risk 액션을 나중에 설명 가능한 로그로 남김

## 이 단계의 핵심 주제

- OWASP Top 10과 웹 취약점 방어
- 인증/인가(OAuth2/OIDC, Session vs Token)
- 전송 구간 보안(TLS, HSTS)
- 비밀 관리/API Key 수명주기/권한 최소화/권한 회수/보안 로그

## 미니 실습

- **CORS/CSRF 재현**: 허용/차단 케이스를 분리해서 동작 확인
- **토큰 탈취 시나리오**: 만료/갱신/리프레시 전략 비교
- **보안 헤더 적용**: CSP/HSTS/Referrer-Policy 적용 테스트
- **Authorization Shadow Rollout 설계**: 기존 정책과 새 정책의 `allow_to_deny`, `deny_to_allow`, `eval_error` diff를 분류하고 canary enforcement 기준을 정리
- **Access Review 후보 생성**: 90일 미사용 admin 권한과 만료 없는 high-risk 권한을 찾아 owner, reason, revoke path를 표로 정리

## 완료 기준

- 핵심 취약점 5개를 “어떻게 막는지” 설명할 수 있다
- 인증/인가 흐름에서 공격 지점을 식별할 수 있다
- 최소 권한/비밀 관리 원칙을 설계에 반영할 수 있다
- high-risk 권한과 API Key에 owner, expires_at, last_used_at, revoke path를 붙여 운영할 수 있다

## 추천 학습 순서

1. **[CORS/CSRF와 보안 헤더](/learning/deep-dive/deep-dive-security-cors-csrf-headers/)** 로 브라우저 기반 공격과 방어 헤더를 먼저 잡습니다.
2. **[Spring Security 아키텍처](/learning/deep-dive/deep-dive-spring-security-architecture/)** 로 filter chain, 인증 객체, 인가 흐름을 연결합니다.
3. **[인가 모델 실전 설계: RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)** 로 권한 모델 선택 기준과 정책 엔진 운영을 정리합니다.
4. **[Authorization Policy Shadow Rollout](/learning/deep-dive/deep-dive-authorization-policy-shadow-rollout-playbook/)** 으로 기존 정책을 새 정책으로 바꿀 때 diff 분석, canary enforcement, rollback flag를 설계합니다.
5. **[권한 판정 캐시 무효화](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)** 로 정책 변경 뒤 stale allow와 PDP 부하를 함께 줄이는 기준을 붙입니다.
6. **[API Key Lifecycle 발급·회전·폐기 플레이북](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)** 으로 키를 운영 자산으로 다루는 기준을 붙입니다.
7. **[Permission Drift와 Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/)** 로 오래된 권한을 찾고 회수하는 운영 파이프라인을 설계합니다.
8. **[Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)** 로 권한 변경과 회수 이벤트를 나중에 검증 가능한 증거로 남기는 방식을 확인합니다.

## 인가 정책 변경을 공부할 때의 순서

인가 글은 구현 문법보다 운영 순서가 중요합니다. 먼저 RBAC, ABAC, ReBAC로 "무엇을 허용할지"를 정하고, 그 다음 shadow rollout으로 "기존 사용자에게 어떤 차이가 생기는지"를 봅니다. 정책이 실제로 강제되기 전에는 캐시 무효화와 rollback flag를 같이 준비해야 합니다. 마지막에는 access review와 감사 로그로 시간이 지나며 넓어진 권한과 고위험 변경 이력을 다시 설명할 수 있어야 합니다.

읽고 끝내지 않으려면 관리자 action 5개만 골라 `risk_class`, 예상 `allow_to_deny`, 예상 `deny_to_allow`, rollback owner를 표로 적어보세요. 이 작은 표가 없으면 정책 테스트가 통과해도 운영 전환 판단은 계속 감에 의존하게 됩니다.
