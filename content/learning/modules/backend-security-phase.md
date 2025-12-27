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
url: "/learning/career/backend-security-phase/"
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

## 추천 학습 순서

1. **[OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/)** (기존 글)
2. **[CORS/CSRF 헤더의 모든 것](/learning/deep-dive/deep-dive-security-cors-csrf-headers/)** (기존 글)
3. **TLS/SSL Handshake 원리 (작성 중)**  
4. **Spring Security 심화 (Filter Chain, Architecture)** (기존 글)
