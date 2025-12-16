---
title: "Spring Security + JWT 인증 흐름"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring Security", "JWT", "Authentication", "Authorization"]
categories: ["Development", "Learning"]
description: "JWT 기반 인증 필터, 토큰 발급/검증, Stateless 세션 구성을 코드로 정리"
module: "spring-core"
study_order: 22
---

## 필터 체인 구성

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

## 체크리스트

- [ ] `Authorization: Bearer <token>` 헤더만 신뢰, 쿠키/쿼리스트링에 JWT 금지
- [ ] 만료/서명 검증 실패 시 401 반환, 403은 권한 부족일 때만
- [ ] Refresh Token은 별도 저장소(Whitelist/DB/Redis) 관리 및 Rotation 적용
- [ ] Clock skew 고려: 허용 오차(`setAllowedClockSkewSeconds`) 설정
- [ ] 로그아웃/토큰 폐기는 블랙리스트 또는 RT Rotation으로 처리
