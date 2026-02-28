---
title: "8단계: 보안 (Security Specialist)"
date: 2025-12-28
draft: false
topic: "Backend Roadmap"
tags: ["Security", "Auth", "Cryptography", "Network"]
categories: ["Learning"]
description: "기능 구현을 넘어, 안전한 서비스를 만들기 위한 필수 보안 지식과 공격 방어 기법을 다룹니다."
weight: 8
study_order: 80
layout: "learning-module"
module_key: "security"
url: "/learning/modules/backend-security-phase/"
---

## 이 단계에서 얻는 것

"보안은 보안팀이 하는 것"이라는 생각에서 벗어나, **개발자가 코드 레벨에서 막아야 할 취약점**과 **인프라 레벨의 기본 방어 기법**을 익힙니다.

- **공격자 관점 이해**: SQL Injection, XSS가 "어떻게" 들어오는지 원리를 알고 막습니다.
- **인증/인가의 깊이**: 단순히 JWT 라이브러리를 쓰는 것을 넘어, 토큰 탈취 시나리오와 대응책을 고민합니다.
- **암호화/https**: 데이터가 전송되고 저장될 때 안전한지 확신할 수 있는 지식을 갖춥니다.

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

## 이 단계의 핵심 주제

- OWASP Top 10과 웹 취약점 방어
- 인증/인가(OAuth2/OIDC, Session vs Token)
- 전송 구간 보안(TLS, HSTS)
- 비밀 관리/권한 최소화/보안 로그

## 미니 실습

- **CORS/CSRF 재현**: 허용/차단 케이스를 분리해서 동작 확인
- **토큰 탈취 시나리오**: 만료/갱신/리프레시 전략 비교
- **보안 헤더 적용**: CSP/HSTS/Referrer-Policy 적용 테스트

## 완료 기준

- 핵심 취약점 5개를 “어떻게 막는지” 설명할 수 있다
- 인증/인가 흐름에서 공격 지점을 식별할 수 있다
- 최소 권한/비밀 관리 원칙을 설계에 반영할 수 있다

## 추천 학습 순서

1. **[OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/)** (기존 글)
2. **[CORS/CSRF 헤더의 모든 것](/learning/deep-dive/deep-dive-security-cors-csrf-headers/)** (기존 글)
3. **TLS/SSL Handshake 원리 (작성 중)**  
4. **Spring Security 심화 (Filter Chain, Architecture)** (기존 글)
