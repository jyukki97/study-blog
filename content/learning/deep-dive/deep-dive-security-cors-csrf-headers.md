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

## 이 글에서 얻는 것

- CORS가 “서버 보안 기능”이 아니라 **브라우저 보안 모델**이라는 점을 이해하고, 왜 설정이 꼬이는지 설명할 수 있습니다.
- CSRF가 언제 필요한지(쿠키/세션 기반)와, 언제 끄면 위험한지(쿠키에 토큰을 싣는 경우) 구분할 수 있습니다.
- 운영에서 기본으로 가져가야 할 보안 헤더(HSTS, CSP 등)를 “왜 필요한지”와 함께 설정할 수 있습니다.

## 0) CORS/CSRF는 자주 헷갈리는 두 축이다

- CORS: “다른 오리진의 JS가 내 API를 호출할 수 있는가?”를 브라우저가 제한
- CSRF: “사용자 브라우저가 쿠키를 자동으로 보내는 특성”을 악용한 위조 요청을 방어

둘은 비슷해 보이지만 목적과 공격면이 다릅니다.

## 1) CORS: 브라우저가 막는 것(서버는 정책을 선언)

CORS는 서버가 “이 오리진은 허용한다/안 한다”를 응답 헤더로 선언하면,
브라우저가 그 정책을 적용합니다.

즉:

- CORS는 “서버를 해킹하는 걸 막는” 기능이 아니라,
- 브라우저에서 동작하는 프론트엔드 코드가 “마음대로” 다른 도메인 API를 읽지 못하게 하는 장치입니다.

### 1-1) 가장 흔한 실수 3가지

1) `Access-Control-Allow-Origin: *` 남발  
2) credentials(cookie/authorization 포함) 요청인데 `*`를 쓰려는 것  
3) “요청은 되는데 응답을 못 읽는” 상황을 서버 문제로 착각(브라우저가 차단)

특히 credentials를 허용하면:

- `Allow-Origin`은 반드시 “구체적인 오리진”이어야 합니다(`*` 불가).
- `Access-Control-Allow-Credentials: true`를 함께 설정해야 합니다.

### 1-2) Preflight(OPTIONS): 왜 갑자기 OPTIONS가 오나

브라우저는 “단순 요청”이 아닌 경우(커스텀 헤더, 특정 content-type 등)
본 요청 전에 OPTIONS로 “이 요청 보내도 돼?”를 확인합니다.

이때 중요한 포인트:

- OPTIONS 요청도 정상 응답해야 실제 요청이 갑니다.
- `Access-Control-Max-Age`로 프리플라이트 캐시를 걸면 지연/부하를 줄일 수 있습니다.

## 2) CSRF: 쿠키 기반 인증에서만 ‘필수’에 가까워진다

CSRF는 브라우저가 쿠키를 자동으로 붙여 보내는 특성을 악용합니다.

그래서 대체로:

- 세션/쿠키 기반 인증 → CSRF 방어가 필요
- Authorization 헤더 기반(완전 stateless) → CSRF 위험이 낮아져 보통 비활성화

하지만 함정:

- “JWT를 쿠키에 담아” 인증한다면(Authorization 헤더가 아니라 cookie), CSRF 위험이 다시 생깁니다.
  이 경우는 CSRF 토큰 또는 SameSite 전략이 필요합니다.

## 3) 보안 헤더: 최소 세트만으로도 사고를 줄인다

보안 헤더는 “취약점 방어의 마무리 장치”입니다. 앱 로직을 대체하지는 않지만,
실수/미묘한 취약점을 완화해 줍니다.

### 3-1) HSTS(HTTPS 강제)

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- HTTPS가 전제입니다. 운영에서만 켜고, 도메인 정책을 신중히 적용합니다.

### 3-2) X-Content-Type-Options

- `X-Content-Type-Options: nosniff`
- 브라우저의 MIME sniffing을 막아 일부 XSS/다운로드 혼선을 줄입니다.

### 3-3) Clickjacking 방지

- `X-Frame-Options: DENY` 또는 `SAMEORIGIN`
- 최신에서는 CSP의 `frame-ancestors`로 더 정교하게 제어 가능합니다.

### 3-4) CSP(Content-Security-Policy)

CSP는 XSS를 “완전히 막는 은탄환”은 아니지만,
리소스 로딩 출처를 제한해 피해를 크게 줄일 수 있습니다.

실무에서는 “엄격한 CSP”를 한 번에 적용하기 어렵기 때문에:

- 먼저 report-only로 적용해 위반을 관측하고,
- 점진적으로 정책을 강화하는 방식이 안전합니다.

## 4) Spring Security에서의 적용 감각(개념)

스프링에서는 다음을 “명확히” 나누는 게 중요합니다.

- CORS 정책: 허용 오리진/메서드/헤더(프론트 도메인 중심)
- CSRF 정책: 인증 방식(세션/쿠키인지)과 함께 결정
- 헤더 정책: 운영 기본값으로 고정(환경/도메인에 따라 CSP만 튜닝)

### 예시: CORS를 명시적으로 허용(개념)

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .csrf(csrf -> csrf.disable()) // Authorization 헤더 기반(stateless)일 때만 고려
        .headers(headers -> headers
            .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true).maxAgeInSeconds(31536000))
            .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'"))
            .frameOptions(frame -> frame.sameOrigin())
        )
        .build();
}

@Bean
CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(List.of("https://app.example.com"));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
}
```

## 연습(추천)

- 브라우저에서 preflight가 발생하는 요청을 만들어보고(Network 탭), 어떤 헤더가 부족하면 차단되는지 관찰해보기
- 세션 기반 로그인 API에 CSRF 토큰을 적용하고, 토큰이 없을 때 실제로 요청이 거부되는지 확인해보기
- CSP를 report-only로 적용한 뒤, 위반 로그를 보고 “정적 리소스 도메인/스크립트 정책”을 어떻게 정리할지 설계해보기
