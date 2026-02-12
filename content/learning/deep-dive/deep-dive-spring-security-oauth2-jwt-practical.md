---
title: "Spring Security OAuth2 + JWT 실전 구현"
date: 2026-02-12
draft: false
topic: "Security"
tags: ["Spring Security", "OAuth2", "JWT", "Resource Server", "Authorization Server"]
categories: ["Backend Deep Dive"]
description: "Authorization Code 흐름과 JWT 발급/검증을 Spring Security 구성으로 연결하고, 실무에서 흔한 함정까지 정리"
module: "security"
quizzes:
  - question: "OAuth2 Authorization Code + PKCE 흐름에서 클라이언트가 가장 먼저 받는 것은?"
    options:
      - "Access Token"
      - "Authorization Code"
      - "Refresh Token"
      - "ID Token"
    answer: 1
    explanation: "클라이언트는 사용자 인증 후 Authorization Code를 받고, 이를 토큰 엔드포인트에 교환하여 Access Token을 발급받습니다."

  - question: "Resource Server에서 JWT를 검증할 때 필요한 핵심 정보는?"
    options:
      - "DB에 저장된 세션"
      - "Authorization Server의 공개키(JWK)"
      - "사용자 비밀번호"
      - "클라이언트 시크릿"
    answer: 1
    explanation: "JWT 서명 검증을 위해 Authorization Server가 제공하는 JWK(공개키)가 필요합니다."

  - question: "JWT 기반 API에서 일반적으로 세션 정책은 어떻게 설정하는가?"
    options:
      - "ALWAYS"
      - "IF_REQUIRED"
      - "STATELESS"
      - "NEVER"
    answer: 2
    explanation: "JWT는 무상태 토큰 기반이므로 서버는 세션을 만들지 않도록 STATELESS로 설정합니다."

  - question: "Access Token 만료에 대비해 재발급을 수행하는 용도로 사용하는 토큰은?"
    options:
      - "ID Token"
      - "Refresh Token"
      - "Authorization Code"
      - "Client Secret"
    answer: 1
    explanation: "Refresh Token은 Access Token 만료 후 재발급에 사용됩니다. 보관 위치와 탈취 대응이 매우 중요합니다."
study_order: 214
---

## 이 글에서 얻는 것

- OAuth2 **Authorization Code 흐름**을 실제 Spring Security 설정으로 연결할 수 있습니다.
- **JWT 발급/검증**을 Resource Server 설정으로 구현할 수 있습니다.
- 실무에서 자주 터지는 **토큰 저장/만료/리프레시 정책**의 함정을 예방할 수 있습니다.

## 1) 전체 구조 한 장으로 이해하기

```mermaid
sequenceDiagram
    participant User as 사용자
    participant Client as 클라이언트(웹/앱)
    participant AS as Authorization Server
    participant RS as Resource Server(API)

    User->>Client: 로그인 시도
    Client->>AS: /authorize (Authorization Code 요청)
    AS-->>Client: Authorization Code
    Client->>AS: /token (Code -> Access Token 교환)
    AS-->>Client: Access Token (+ Refresh Token)
    Client->>RS: API 요청 (Authorization: Bearer <token>)
    RS-->>Client: 응답
```

핵심은 **Authorization Server(AS)에서 발급한 JWT를 Resource Server(RS)에서 검증**하는 구조입니다.

## 2) Authorization Server 구성 (Spring Authorization Server)

> 실제 운영에서는 AS와 RS를 **분리**하는 것이 일반적입니다.

```java
@Bean
public RegisteredClientRepository registeredClientRepository(PasswordEncoder encoder) {
    RegisteredClient client = RegisteredClient.withId(UUID.randomUUID().toString())
        .clientId("web-client")
        .clientSecret(encoder.encode("secret"))
        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
        .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
        .redirectUri("https://app.example.com/login/oauth2/code")
        .scope("read")
        .scope("write")
        .clientSettings(ClientSettings.builder().requireProofKey(true).build()) // PKCE
        .build();

    return new InMemoryRegisteredClientRepository(client);
}
```

- `requireProofKey(true)`로 **PKCE** 활성화
- Access Token에 사용할 **JWT 서명 키(JWK)** 를 반드시 관리

## 3) Resource Server에서 JWT 검증

```java
@Bean
public SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
    http
        .csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/public/**").permitAll()
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer(oauth2 -> oauth2
            .jwt(jwt -> jwt
                .jwkSetUri("https://auth.example.com/.well-known/jwks.json")
            )
        );

    return http.build();
}
```

- Resource Server는 **JWK URL**만 알면 서명 검증 가능
- DB 세션이 필요 없으므로 **완전 무상태**

## 4) JWT 클레임 설계 포인트

```json
{
  "sub": "user-123",
  "roles": ["ROLE_USER"],
  "scope": "read write",
  "iat": 1710000000,
  "exp": 1710003600
}
```

- `sub` = 사용자 식별자
- `roles`/`scope` = 인가 기준
- `exp` = 만료 시간을 반드시 짧게

> 실무 팁: **짧은 Access Token + Refresh Token** 조합이 안정적입니다.

## 5) Refresh Token 전략 (실무 함정)

### 5-1. 저장 위치

- 웹: **HttpOnly Secure Cookie** 권장
- 모바일: **Keychain/Keystore** 저장

### 5-2. Rotation

Refresh Token을 매번 재발급하는 **Rotation** 방식을 쓰면 탈취 대응이 유리합니다.

```java
public TokenPair rotate(String refreshToken) {
    validate(refreshToken); // 블랙리스트/만료 확인
    revoke(refreshToken);   // 기존 토큰 폐기
    return issueNewTokens();
}
```

### 5-3. 로그아웃

- Access Token은 만료가 짧아 **즉시 무효화가 어렵습니다**.
- **Refresh Token 블랙리스트** + Access Token 만료 단축으로 대응합니다.

## 6) 흔한 장애 시나리오와 대응

1. **JWT 검증 실패**: JWK 캐시 갱신 실패 → JWK URL health check
2. **만료 오류 급증**: 서버/클라이언트 시간 불일치 → NTP 동기화
3. **로그아웃 후 접근 가능**: Access Token 만료가 너무 길다 → 5~15분 권장

## 요약

- OAuth2의 핵심은 **Authorization Server 발급 + Resource Server 검증** 분리
- JWT는 **짧은 만료 + Refresh Token Rotation**이 기본 전략
- Spring Security의 Resource Server 설정으로 **JWT 검증을 간결하게 구현** 가능

## 연습(추천)

- 로컬에서 Authorization Server/Resource Server를 분리해 띄워보고 JWK 검증 로그 확인
- Access Token 만료 시간을 1분으로 설정하고 Refresh 흐름을 실제로 테스트해보기
- JWT 클레임에 `roles`를 넣고 `@PreAuthorize`로 인가 규칙을 만들어보기
