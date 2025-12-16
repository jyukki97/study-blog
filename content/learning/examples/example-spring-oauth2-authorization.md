---
title: "Spring Security OAuth2 Authorization Code 흐름"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["OAuth2", "Authorization Code", "Spring Security"]
categories: ["Development", "Learning"]
description: "Authorization Server 없이 외부 프로바이더(Google 등) 연동하는 OAuth2 로그인 흐름 정리"
module: "spring-core"
study_order: 160
---

## 핵심 설정

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: xxx
            client-secret: yyy
            scope: profile,email
        provider:
          google:
            authorization-uri: https://accounts.google.com/o/oauth2/v2/auth
            token-uri: https://oauth2.googleapis.com/token
            user-info-uri: https://www.googleapis.com/oauth2/v3/userinfo
```

```java
@Bean
SecurityFilterChain filter(HttpSecurity http) throws Exception {
    http.csrf(AbstractHttpConfigurer::disable)
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/", "/login/**").permitAll()
            .anyRequest().authenticated()
        )
        .oauth2Login(Customizer.withDefaults());
    return http.build();
}
```

## 토큰/유저 정보 흐름

1) 사용자가 `/oauth2/authorization/google`로 리다이렉트  
2) 구글 로그인 후 Authorization Code 수신  
3) 백엔드가 토큰 엔드포인트로 Code 교환 → Access Token  
4) UserInfo 엔드포인트 호출 → 사용자 프로필 매핑  
5) `OAuth2UserService` 커스터마이징으로 도메인 유저와 매핑

## 체크리스트

- [ ] Redirect URI 화이트리스트 등록, HTTPS 사용
- [ ] state 파라미터 확인(재전송 공격 방지)
- [ ] 토큰/프로필 매핑 시 nullable 필드 처리
- [ ] 로그인 이후 JWT 발급 등과 연계 시 세션을 stateless로 구성 고려
