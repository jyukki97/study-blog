---
title: "Spring Security + JWT 인증 흐름"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring Security", "JWT", "Authentication", "Authorization"]
categories: ["Development", "Learning"]
description: "JWT 기반 인증 필터, 토큰 발급/검증, Stateless 세션 구성을 코드로 정리"
module: "spring-core"
study_order: 150
---

## 이 글에서 얻는 것

- 인증(Authentication)과 인가(Authorization)를 구분해서, JWT를 어디에 끼워 넣는지(필터 체인/보안 컨텍스트) 이해합니다.
- “세션 기반”과 “JWT 기반(stateless)”의 장단점을 알고, 어떤 상황에 어떤 방식을 선택할지 기준이 생깁니다.
- Access/Refresh 토큰, 만료/재발급/폐기(로그아웃)까지 운영 관점에서 고려할 포인트를 정리합니다.

## 0) JWT는 왜 쓰나(한 문장)

JWT(JSON Web Token)는 서버가 “서명한 토큰”을 클라이언트가 들고 다니게 해서,
서버가 세션 상태를 저장하지 않아도(stateless) 인증을 유지할 수 있게 해줍니다.

하지만 정답은 아닙니다.

- 세션은 “서버에서 즉시 폐기/제어”가 쉽습니다.
- JWT는 “수평 확장/분산 환경”에 유리하지만, **폐기/회수(revocation)** 가 어렵습니다.

그래서 보통은 “JWT를 쓰되, Access/Refresh로 쪼개고” 운영을 설계합니다.

## 1) 필터 체인에서 JWT가 들어가는 위치

```java
@Bean
public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtFilter jwtFilter) throws Exception {
    http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/auth/**").permitAll()
            .anyRequest().authenticated()
        )
        .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
    return http.build();
}
```

핵심은 2가지입니다.

- `STATELESS`: 서버 세션을 쓰지 않겠다(요청마다 토큰으로 인증).
- `JwtFilter`: 요청마다 토큰을 검증하고, `SecurityContextHolder`에 인증 정보를 채웁니다.

## 2) JWT 구조를 알아야 디버깅이 된다

JWT는 보통 `header.payload.signature` 형태입니다.

- header: 알고리즘(HS256/RS256 등)
- payload: claims(사용자 식별자, 권한, 만료 시간 등)
- signature: 위 데이터를 키로 서명한 값(변조 방지)

중요: JWT는 “서명”이지 “암호화”가 아닙니다(대부분).  
payload는 쉽게 디코딩되므로 PII/민감정보를 넣지 않는 편이 좋습니다.

## JWT 발급/검증 핵심

```java
String token = Jwts.builder()
    .setSubject(userId)
    .claim("roles", roles)
    .setIssuedAt(new Date())
    .setExpiration(Date.from(Instant.now().plus(Duration.ofHours(2))))
    .signWith(secretKey, SignatureAlgorithm.HS256)
    .compact();
```

```java
Claims claims = Jwts.parserBuilder()
    .setSigningKey(secretKey)
    .build()
    .parseClaimsJws(token)
    .getBody();
```

## 3) Access/Refresh 전략(운영에서 사실상 필수)

운영 관점에서 흔한 구성:

- **Access Token**: 짧게(예: 5~30분) → 탈취되더라도 피해 제한
- **Refresh Token**: 길게(예: 1~4주) → 재발급 용도, 서버 저장소(DB/Redis)에 보관 + Rotation

Refresh Token까지 JWT로 만들 수도 있지만, “폐기/회수”를 위해 서버 저장소와 함께 쓰는 경우가 많습니다.

## 4) 토큰 전달 방식: Header vs Cookie(트레이드오프)

- `Authorization: Bearer <accessToken>`: API 호출에 가장 흔함, 로그/리퍼러 노출 위험이 적음
- Cookie(HttpOnly): XSS에 강할 수 있지만, CSRF 대응이 필요(SameSite/CSRF 토큰 등)
- QueryString: 로그/리퍼러/캐시 등에 남기 쉬워서 보통 피합니다

정답은 없고, 서비스 형태(브라우저/모바일/서버-서버)에 맞춰 선택합니다.

## 5) 401 vs 403을 정확히 나누기

- 401 Unauthorized: “인증 실패” (토큰 없음/만료/서명 불일치 등)
- 403 Forbidden: “인증은 됐는데 권한이 없음”

이 구분이 되어야 클라이언트(프론트/앱)가 재로그인/권한 안내를 올바르게 처리합니다.

## 6) 로그아웃/토큰 폐기(Revocation)는 어떻게 하나

Stateless JWT의 가장 어려운 부분입니다.

대표 접근:

- Access Token은 짧게, Refresh Token은 서버 저장소에서 폐기/회수
- “블랙리스트”(jti) 방식은 가능하지만, 결국 서버 상태가 생기고 운영 비용이 큼
- 사용자 토큰 버전(token version)을 DB에 두고, 토큰 claim과 비교해 무효화(규모/요구사항에 따라)

## 7) 자주 하는 실수

- 토큰 만료 시간을 너무 길게 둔다(운영에서 사고가 커짐)
- payload에 민감 정보를 넣는다(토큰은 쉽게 디코딩됨)
- 서명 키를 코드에 하드코딩한다(키 관리/회전 불가)
- 401/403을 섞어서 내려준다(클라이언트 대응이 꼬임)

## 연습(추천)

- 로그인 엔드포인트에서 Access/Refresh를 발급하고, Refresh는 Redis에 저장하는 흐름을 만들어보기
- 만료 토큰/서명 불일치 토큰을 넣어 401이 내려가는지 확인해보기
- 권한(Role) 없는 사용자로 접근했을 때 403이 내려가는지 테스트로 고정해보기
