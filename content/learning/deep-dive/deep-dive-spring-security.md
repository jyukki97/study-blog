---
title: "Spring Security: 필터 체인의 미학"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["Spring Security", "Filter Chain", "JWT", "OAuth2"]
categories: ["Backend Deep Dive"]
description: "어렵게만 느껴지는 Security의 내부 작동 원리(DelegatingFilterProxy, FilterChain)와 커스텀 필터"
module: "security"
quizzes:
  - question: "Spring Security에서 '인증(Authentication)'과 '인가(Authorization)'의 차이로 올바른 것은?"
    options:
      - "인증은 권한을 부여하는 것이고, 인가는 신원을 확인하는 것이다."
      - "인증은 '당신이 누구인가'를 확인하는 것이고, 인가는 '당신이 무엇을 할 수 있는가'를 허락하는 것이다."
      - "인증은 로그아웃을 처리하고, 인가는 로그인을 처리한다."
      - "Spring Security에서는 두 용어를 구분하지 않고 사용한다."
    answer: 1
    explanation: "인증(Authentication)은 사용자 신원(Who are you?)을 검증하는 절차이고, 인가(Authorization)는 검증된 사용자에게 리소스 접근 권한(What can you do?)을 부여하거나 제한하는 절차입니다."

  - question: "Spring Security에서 현재 로그인한 사용자의 보안 정보(Authentication 객체)를 저장하고 있는 전역 저장소는?"
    options:
      - "HttpSession"
      - "SecurityContextHolder"
      - "ApplicationContext"
      - "DispatcherServlet"
    answer: 1
    explanation: "`SecurityContextHolder`는 ThreadLocal을 사용하여 현재 실행 중인 스레드의 보안 컨텍스트(`SecurityContext`)를 저장하므로 application 어디서든 인증 정보에 접근할 수 있게 해줍니다."

  - question: "JWT(JSON Web Token)를 사용하는 REST API 서버를 구축할 때, Spring Security에서 세션 설정(`SessionCreationPolicy`)은 어떻게 해야 하는가?"
    options:
      - "ALWAYS (항상 생성)"
      - "IF_REQUIRED (필요시 생성 - 기본값)"
      - "STATELESS (생성하지 않음)"
      - "NEVER (생성하지 않으나 기존 세션은 사용)"
    answer: 2
    explanation: "JWT는 토큰 기반의 무상태(Stateless) 인증 방식이므로, 서버가 세션을 생성하거나 유지하지 않도록 `SessionCreationPolicy.STATELESS`로 설정해야 합니다."

  - question: "커스텀 필터(예: `JwtFilter`)를 `UsernamePasswordAuthenticationFilter`보다 먼저 실행되게 하려면 어떤 설정 메서드를 사용해야 하는가?"
    options:
      - "http.addFilterAfter(filter, class)"
      - "http.addFilterBefore(filter, class)"
      - "http.addFilterAt(filter, class)"
      - "http.setFilter(filter)"
    answer: 1
    explanation: "`addFilterBefore(커스텀필터, 기준필터.class)`를 사용하면 지정한 기준 필터의 **앞** 순서에 커스텀 필터를 배치할 수 있습니다."

  - question: "JWT와 같은 토큰 방식을 사용할 때, 일반적으로 비활성화(disable) 권장되는 보안 기능은?"
    options:
      - "CORS (Cross-Origin Resource Sharing)"
      - "CSRF (Cross-Site Request Forgery)"
      - "XSS Protection"
      - "HSTS"
    answer: 1
    explanation: "CSRF는 주로 브라우저의 쿠키/세션 기반 인증에서 발생하는 취약점이므로, 헤더에 토큰을 담아 보내는 REST API 방식에서는 보통 비활성화(`csrf.disable()`)합니다."
study_order: 204
---

## 🛡️ 1. 문지기들의 줄서기 (Filter Chain)

> [!NOTE]
> **Spring Security의 핵심**: 마치 공항 검색대처럼, 요청이 들어오면 일렬로 늘어선 **필터(검문소)**들을 차례대로 통과해야 합니다. 하나라도 통과 못하면 바로 "입구 컷" 당합니다.

Spring Security는 거대한 **필터들의 체인**입니다.
요청이 Controller에 도착하기 전에 수많은 검문소를 통과해야 합니다.

```mermaid
graph TD
    Request["HTTP Request"] --> FP["DelegatingFilterProxy"]
    FP --> FC{"SecurityFilterChain"}
    
    subgraph "Security Filters"
    FC --> F1["UsernamePasswordAuthenticationFilter"]
    F1 --> F2["JwtAuthenticationFilter (커스텀)"]
    F2 --> F3["ExceptionTranslationFilter"]
    F3 --> F4["FilterSecurityInterceptor"]
    end
    
    F4 -->|인가 통과| Controller
    F3 -->|인증 실패| 401["401 Unauthorized"]
    F4 -->|권한 없음| 403["403 Forbidden"]
```

1. **UsernamePassword...**: 폼 로그인 처리.
2. **FilterSecurityInterceptor**: 맨 마지막에 위치. "이 URL에 접근 권한이 있어?" 검사.
3. **ExceptionTranslation...**: 예외를 잡아서 로그인 페이지로 보내거나 401을 줍니다.

---

## 🎫 2. 인증(Authentication) vs 인가(Authorization)

가장 헷갈리는 두 개념, 표로 정리해 드립니다.

| 구분 | 영어 | 질문 | 예시 | 담당 필터 |
| :--- | :--- | :--- | :--- | :--- |
| **인증** | **Authentication** | "너 누구야?" (신원 확인) | 로그인, ID/PW, OTP | `UsernamePasswordAuthenticationFilter` |
| **인가** | **Authorization** | "너 이거 할 수 있어?" (권한 부여) | 관리자 페이지 접근, 게시글 수정 | `FilterSecurityInterceptor` |

> [!TIP]
> **쉽게 외우는 법**:
> - **인증(Authentication)**: 출입증 찍고 회사 건물 들어오기 (내가 직원임을 증명)
> - **인가(Authorization)**: CEO 집무실 들어가기 (권한이 있어야 가능)

---

## 🔑 3. JWT 커스텀 필터 끼워넣기

JWT를 쓰려면 기본 폼 로그인을 끄고, 우리만의 필터를 끼워넣어야 합니다.

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) {
    http
        .csrf(AbstractHttpConfigurer::disable) // JWT는 CSRF 안전 (보통)
        .sessionManagement(s -> s.sessionCreationPolicy(STATELESS)) // 세션 끄기
        .addFilterBefore(new JwtFilter(tokenProvider), UsernamePasswordAuthenticationFilter.class); 
        // 👆 기본 로그인 필터보다 "앞에" 배치!
        
    return http.build();
}
```

**JwtFilter의 역할 프로세스**:

1. **Header Check**: 요청 헤더에서 `Authorization: Bearer <Token>`을 찾습니다.
2. **Validate**: 토큰이 위변조되지 않았는지, 만료되지 않았는지 검증합니다.
3. **Authentication**: 유효하다면 `Authentication` 객체(신분증)를 만들어 `SecurityContext`(보관함)에 넣습니다.
    - 👉 **비로소 Spring Security가 "이 사람은 로그인 된 사용자"라고 인지하게 됩니다.**

## 요약

1. **필터 기반**: Spring Security는 서블릿 필터 위에서 동작한다.
2. **순서 중요**: 커스텀 필터(JWT 등)를 적절한 위치(`addFilterBefore`)에 넣는 것이 핵심이다.
3. **Context**: 인증된 정보는 스레드 로컬인 `SecurityContext`에 저장되어 전역에서 쓰인다.
