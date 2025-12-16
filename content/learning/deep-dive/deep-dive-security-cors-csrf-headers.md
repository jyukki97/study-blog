---
title: "웹 보안 기본: CORS/CSRF와 헤더 보안"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["CORS", "CSRF", "Security Headers", "Spring Security"]
categories: ["DevOps"]
description: "CORS 설정, CSRF 방어, 보안 헤더(HSTS, X-Content-Type-Options 등) 적용 가이드"
module: "ops-observability"
study_order: 340
---

## CORS

- 신뢰 도메인만 허용, `Access-Control-Allow-Origin`에 `*` 남발 금지
- Credential 요청 시 Origin 명시 + `Allow-Credentials:true`
- 프리플라이트 캐시: `Access-Control-Max-Age`

## CSRF

- 상태 유지 요청(쿠키 기반)에 대한 방어: CSRF 토큰 발행/검증
- JWT 등 헤더 기반 토큰 + stateless 시 일반적으로 CSRF 비활성화

## 보안 헤더

- HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- X-Content-Type-Options: nosniff
- X-Frame-Options / CSP: clickjacking/XSS 방지

## Spring Security 설정 예

```java
http
  .csrf(csrf -> csrf.disable()) // 쿠키 세션이면 enable + 토큰 처리
  .headers(headers -> headers
      .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'"))
      .xssProtection(x -> x.block(true))
      .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin)
  );
```

## 체크리스트

- [ ] HTTPS 강제 + HSTS
- [ ] 허용 Origin 최소화, Credential 사용 시 주의
- [ ] CSRF 필요 여부 판단(세션/쿠키 기반이면 활성)
- [ ] 보안 헤더/CSP 설정 확인, 정적 리소스 도메인 반영
