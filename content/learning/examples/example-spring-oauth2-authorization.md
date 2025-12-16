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

## 이 글에서 얻는 것

- OAuth2 Authorization Code 흐름을 “리다이렉트 몇 번”이 아니라, 역할/보안 요소(state/redirect-uri/PKCE)까지 포함해 설명할 수 있습니다.
- Spring Security의 `oauth2Login()`이 내부에서 무엇을 해주는지 큰 흐름을 이해하고, 커스터마이징 지점을 잡을 수 있습니다.
- OAuth2(인가)와 OIDC(인증)의 차이를 알고, “로그인”에는 보통 OIDC가 붙는 이유를 이해합니다.

## 0) OAuth2는 ‘인증’이 아니라 ‘인가’다(하지만 로그인에 쓰인다)

OAuth2는 원래 “내 자원(구글 캘린더 등)에 제3자 앱이 접근하도록 권한을 위임”하는 프로토콜입니다.
그런데 “로그인”은 결국 “사용자가 누구인지”가 필요해서, 현실에서는 OIDC(OpenID Connect)가 같이 사용됩니다.

- OAuth2: 권한 위임(Access Token)
- OIDC: 인증(Identity) + ID Token(= 사용자 식별 정보)

구글 로그인은 사실상 OIDC 흐름으로 보는 게 자연스럽습니다.

## 1) Authorization Code 흐름(큰 그림)

등장인물:

- Resource Owner: 사용자
- Client: 우리 서비스(스프링 애플리케이션)
- Authorization Server: Google
- Resource Server: Google API(또는 사용자 정보 엔드포인트)

흐름(요약):

1) 사용자가 우리 서비스에서 “구글로 로그인” 클릭  
2) 구글 인증/동의 화면으로 리다이렉트(+ `state`)  
3) 로그인 성공 후 Authorization Code를 우리 서비스의 redirect URI로 전달  
4) 우리 백엔드가 코드 + client secret(또는 PKCE)로 토큰 엔드포인트에 교환 요청  
5) Access Token(그리고 OIDC면 ID Token) 수신  
6) 사용자 정보(UserInfo) 조회 후 우리 도메인 유저로 매핑  

## 2) 핵심 설정(예시)

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

## 3) 보안 요소: Redirect URI, state, (필요하면) PKCE

### Redirect URI

Authorization Server는 “등록된 redirect URI로만” 코드를 보냅니다.  
즉, redirect URI 등록/화이트리스트는 보안의 첫 번째 방어선입니다.

### state

`state`는 리다이렉트 기반 흐름에서 CSRF를 막기 위한 값입니다.
스프링 시큐리티는 기본적으로 state를 관리/검증합니다.

### PKCE

- 모바일/SPA 같은 “client secret을 안전하게 보관할 수 없는” 클라이언트에서 필수
- 백엔드 서버는 보통 client secret 기반으로도 충분하지만, 환경에 따라 PKCE를 같이 쓰기도 합니다

## 4) 토큰/유저 정보 흐름(실무 관점)

1) 사용자가 `/oauth2/authorization/google`로 리다이렉트  
2) 구글 로그인 후 Authorization Code 수신  
3) 백엔드가 토큰 엔드포인트로 Code 교환 → Access Token  
4) UserInfo 엔드포인트 호출 → 사용자 프로필 매핑  
5) `OAuth2UserService` 커스터마이징으로 도메인 유저와 매핑

실무에서 자주 필요한 커스터마이징:

- “구글 계정 이메일”로 우리 서비스 유저를 찾고 없으면 가입 처리
- provider마다 profile 필드가 달라서 null 처리/정규화
- 로그인 성공 시 우리 서비스용 JWT를 발급(그리고 이후 API는 stateless로 운영)

## 5) 세션 vs JWT: oauth2Login 이후를 어떻게 운영할까

`oauth2Login()` 자체는 리다이렉트 흐름을 위해 “일시적으로 상태”가 필요해서 세션을 사용하는 경우가 많습니다.
하지만 로그인 성공 이후 API를 stateless로 운영하고 싶다면 다음 패턴이 흔합니다.

- 로그인 성공 핸들러에서 우리 서비스 Access/Refresh JWT 발급
- 이후 API는 `Authorization: Bearer`로 인증

즉, OAuth2 로그인은 “사용자 신원 확인 수단”이고, 우리 서비스의 인증 수단은 “JWT”로 분리하는 방식입니다.

## 6) 자주 하는 실수

- Redirect URI를 환경별로 제대로 분리하지 않아 운영에서 로그인 실패
- state/nonce 검증을 무시하거나 커스터마이징하면서 깨뜨림
- “OAuth2만으로 로그인”이라고 생각하고 ID Token/OIDC 개념을 놓침
- 로그인 성공 후 권한/가입 처리를 대충 해서 “누구나 로그인만 하면 내부 권한이 생기는” 사고

## 연습(추천)

- 구글 로그인 성공 시 우리 서비스 JWT를 발급하고, 이후 API 호출이 세션 없이 동작하도록 구성해보기
- `OAuth2UserService`를 커스터마이징해서 “도메인 유저 생성/연결” 로직을 넣어보기
- 환경(dev/prod)별 redirect URI가 어떻게 달라지는지 정리하고, 운영에서 실수하기 쉬운 포인트를 체크해보기
