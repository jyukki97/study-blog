---
title: "OAuth 2.0 & 소셜 로그인: Google/Kakao 로그인 직접 구현하기"
date: 2025-12-29
draft: false
topic: "Security"
tags: ["OAuth2", "Social Login", "Security", "Google", "Kakao"]
categories: ["Backend Deep Dive"]
description: "OAuth 2.0 승인 코드 방식(Authorization Code Grant)의 흐름과 Spring Security OAuth2 Client 설정법"
module: "security"
quizzes:
  - question: "OAuth 2.0에서 리소스 소유자(Resource Owner)의 의미로 가장 적절한 것은?"
    options:
      - "Google이나 Kakao와 같이 사용자 데이터를 가지고 있는 서비스"
      - "로그인을 시도하려고 하는 일반 사용자"
      - "로그인 기능을 구현하는 우리의 웹 애플리케이션"
      - "OAuth 2.0 표준을 관리하는 국제 기구"
    answer: 1
    explanation: "Resource Owner는 자신의 개인정보(리소스)에 대한 접근 권한을 가지고 있는 '일반 사용자'를 의미합니다."

  - question: "웹 애플리케이션(Server-Side)에서 소셜 로그인을 구현할 때 가장 많이 사용되며 보안적으로 권장되는 Grant Type은?"
    options:
      - "Implicit Grant"
      - "Resource Owner Password Credentials Grant"
      - "Authorization Code Grant"
      - "Client Credentials Grant"
    answer: 2
    explanation: "Authorization Code Grant(승인 코드 부여) 방식은 액세스 토큰이 브라우저(Front)에 노출되지 않고 백엔드 서버끼리 교환되므로 보안상 가장 안전하고 일반적으로 사용됩니다."

  - question: "OAuth 로그인 과정에서, 사용자가 로그인 성공 후 Authorization Server(예: Google)가 우리 서버로 전달해주는 '임시 코드'의 명칭은?"
    options:
      - "Access Token"
      - "Refresh Token"
      - "Authorization Code"
      - "ID Token"
    answer: 2
    explanation: "사용자가 로그인을 마치면 리다이렉트 URI로 `Authorization Code`가 전달되며, 백엔드는 이 코드를 사용해 실제 `Access Token`을 요청합니다."

  - question: "Spring Security OAuth2 Client에서 구글, 페이스북 등이 아닌 커스텀 Provider(예: 카카오, 네이버)를 설정할 때 반드시 지정해야 하는 정보가 **아닌** 것은?"
    options:
      - "authorization-uri (로그인 페이지 주소)"
      - "token-uri (토큰 발급 주소)"
      - "user-info-uri (사용자 정보 조회 주소)"
      - "admin-password (관리자 비밀번호)"
    answer: 3
    explanation: "커스텀 Provider 등록 시 로그인/토큰/사용자정보 URI는 필수지만, 관리자 비밀번호는 필요하지 않습니다. (Client ID/Secret은 필요)"

  - question: "OIDC(OpenID Connect)를 지원하는 로그인(예: Google)에서, 사용자의 신원 정보를 담고 있는 JWT 토큰의 이름은?"
    options:
      - "Access Token"
      - "ID Token"
      - "Refresh Token"
      - "Secure Token"
    answer: 1
    explanation: "OIDC는 OAuth 2.0의 확장 프로토콜로, 인증 시 `ID Token`이라는 JWT를 추가로 발급하여 사용자의 신원(이메일, 이름 등)을 증명합니다."
study_order: 83
---

## 이 글에서 얻는 것

- **OAuth 2.0 흐름 마스터**: "승인 코드 방식"이 왜 안전한지, 어떻게 Access Token을 받아오는지 그림으로 이해합니다.
- **Provider 설정**: Google(OIDC 지원)과 Kakao/Naver(OIDC 미지원/커스텀) 설정의 차이를 배웁니다.
- **Spring Boot 설정**: `application.yml` 몇 줄로 소셜 로그인을 끝내는 마법을 체험합니다.

## 1. OAuth 2.0 등장 배경

과거에는 앱이 사용자의 구글 비밀번호를 직접 받아서 저장했습니다. (미친 짓이죠 😱)
OAuth는 **"비밀번호를 공유하지 않고, 권한(열쇠)만 빌려주는"** 프로토콜입니다.

### 핵심 용어

| 용어 | 설명 | 예시 |
| :--- | :--- | :--- |
| **Resource Owner** | 정보 주인 | 로그인하려는 **사용자(나)** |
| **Client** | 정보를 쓰려는 앱 | **우리의 웹 서비스** |
| **Authorization Server** | 권한 관리자 | **Kakao 인증 서버** |
| **Resource Server** | 정보 보관소 | **Kakao API 서버** (프로필, 친구목록) |

## 2. Authorization Code Grant (승인 코드 방식)

가장 표준적인 방식입니다.

```mermaid
sequenceDiagram
    participant User as 사용자
    participant Browser as 브라우저
    participant Client as 우리 서버 (Backend)
    participant AuthServer as 카카오 인증 서버
    
    User->>Browser: "카카오 로그인" 클릭
    Browser->>AuthServer: 1. 로그인 요청 (redirect_uri 포함)
    AuthServer-->>User: 로그인 페이지 노출
    User->>AuthServer: ID/PW 입력 및 동의
    
    AuthServer-->>Browser: 2. 302 Redirect (with Code)
    Browser->>Client: 3. GET /login/oauth2/code/kakao?code=ABCD
    
    Client->>AuthServer: 4. Code 주고 Access Token 요청 (Back-Channel)
    AuthServer-->>Client: 5. Access Token (+ Refresh Token) 발급
    
    Client->>Client: 로그인 처리 (JWT 발급 등)
    Client-->>Browser: 로그인 성공 응답
```

**핵심 포인트**:
- **Code(ABCD)**는 일회용입니다.
- **Access Token**은 브라우저를 거치지 않고 서버끼리(Back-Channel) 주고받으므로 안전합니다.

## 3. Spring Security OAuth2 Client 설정

build.gradle:
```groovy
implementation 'org.springframework.boot:spring-boot-starter-oauth2-client'
```

application.yml:
```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          google: # OIDC 지원 (설정 간단)
            client-id: "YOUR_GOOGLE_ID"
            client-secret: "YOUR_GOOGLE_SECRET"
            scope:
              - email
              - profile
          
          kakao: # 커스텀 Provider 필요
            client-id: "YOUR_KAKAO_ID"
            client-secret: "YOUR_KAKAO_SECRET"
            client-authentication-method: client_secret_post
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            scope:
              - profile_nickname
              - account_email
            client-name: Kakao
            
        provider:
          kakao:
            authorization-uri: https://kauth.kakao.com/oauth/authorize
            token-uri: https://kauth.kakao.com/oauth/token
            user-info-uri: https://kapi.kakao.com/v2/user/me
            user-name-attribute: id
```

## 4. OIDC (OpenID Connect) vs OAuth 2.0

- **OAuth 2.0**: "권한 허가" (Authorization) 목적. (이 글쓰기 권한 줄게)
- **OIDC**: "신원 인증" (Authentication) 목적. (너 철수 맞지?)
    - 구글 로그인은 Access Token과 함께 **ID Token(JWT)**을 줍니다. 이를 까보면 유저 정보가 들어있습니다.

## 요약

1.  **Authorization Code** 방식이 표준입니다. (프론트엔드에 토큰 노출 X)
2.  Spring Boot는 `oauth2-client` 의존성만 있으면 복잡한 핸드셰이크를 자동화해줍니다.
3.  카카오/네이버 같은 국내 서비스는 `provider` 정보를 수동으로 입력해야 합니다.
