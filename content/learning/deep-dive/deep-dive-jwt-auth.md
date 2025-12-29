---
title: "JWT vs Session: 토큰 기반 인증의 허와 실"
date: 2025-12-29
draft: false
topic: "Security"
tags: ["JWT", "Session", "Authentication", "Security", "Stateless"]
categories: ["Backend Deep Dive"]
description: "세션과 토큰(JWT)의 장단점 비교, Access/Refresh Token 전략, 그리고 보안 취약점(XSS, CSRF) 방어"
module: "security"
quizzes:
  - question: "JWT(JSON Web Token)의 구조 3가지를 올바른 순서로 나열한 것은?"
    options:
      - "Header - Body - Signature"
      - "Header - Payload - Signature"
      - "Header - Payload - Footer"
      - "Meta - Data - Sign"
    answer: 1
    explanation: "JWT는 `Header`(알고리즘 정보).`Payload`(데이터/클레임).`Signature`(서명)의 3부분으로 구성되며 점(.)으로 구분됩니다."

  - question: "Session 방식과 비교했을 때 JWT(Stateless) 방식의 가장 큰 장점은?"
    options:
      - "서버 구현이 매우 간단하다."
      - "토큰을 탈취당해도 안전하다."
      - "서버 간 세션 동기화 없이 수평 확장이 용이하다(Scalability)."
      - "사용자 강제 로그아웃 처리가 쉽다."
    answer: 2
    explanation: "세션 방식은 서버 메모리나 DB에 세션을 저장해야 하므로 다중 서버 환경에서 동기화 이슈가 있지만, JWT는 토큰 자체에 검증 정보가 있어 서버 확장이 유리합니다."

  - question: "JWT를 저장할 때 XSS(Cross-Site Scripting) 공격으로부터 가장 안전한 클라이언트 저장소는?"
    options:
      - "localStorage"
      - "sessionStorage"
      - "Cookie (HttpOnly + Secure 설정)"
      - "IndexedDB"
    answer: 2
    explanation: "localStorage/sessionStorage는 자바스크립트로 접근 가능하여 XSS에 취약합니다. `HttpOnly` 쿠키는 JS 접근이 불가능하므로 토큰 탈취를 방지하는 데 가장 효과적입니다."

  - question: "Access Token의 유효 기간을 짧게 하고, 만료 시 새로운 토큰을 발급받기 위해 사용하는 긴 유효 기간의 토큰은?"
    options:
      - "Session ID"
      - "Refresh Token"
      - "API Key"
      - "Bearer Token"
    answer: 1
    explanation: "보안 강화를 위해 Access Token은 수명을 짧게(예: 30분) 가져가고, 만료 시 Refresh Token을 사용해 사용자의 개입(로그인) 없이 새 토큰을 발급받는 전략을 사용합니다."

  - question: "JWT의 `Signature` 부분을 생성할 때 사용되는 암호화 방식은?"
    options:
      - "RSA 또는 HMAC과 같은 대칭/비대칭 키 암호화"
      - "Base64 Encoding"
      - "MD5 Hashing"
      - "AES Encryption"
    answer: 0
    explanation: "서명(Signature)은 비밀키(HMAC)나 개인키(RSA)를 사용하여 생성되며, 이를 통해 토큰의 위변조 여부를 서버가 검증합니다."
study_order: 82
---

## 이 글에서 얻는 것

- **Session vs Token**: "무조건 JWT가 좋다"는 오해를 풀고, 상황에 맞는 선택 기준을 잡습니다.
- **JWT 구조**: Header, Payload, Signature의 역할과 "Base64Url 인코딩"의 의미를 이해합니다.
- **Refresh Token 전략**: 보안과 편의성을 모두 잡는 Access/Refresh 토큰 순환 구조를 배웁니다.

## 1. 세션(Session) 인증: "서버가 기억한다"

전통적인 방식입니다. 사용자가 로그인하면 서버는 메모리(또는 DB/Redis)에 "철수 로그인 했음"이라고 적고, 철수에게는 `JSESSIONID` 같은 **입장권(Session ID)**만 줍니다.

- **장점**:
    - **보안**: 입장권(ID) 자체에는 아무 정보가 없습니다. 서버가 언제든 입장권을 무효화(강제 로그아웃)할 수 있습니다.
- **단점**:
    - **확장성(Scalability)**: 서버가 2대 이상이면 "A서버에 로그인한 철수"를 B서버도 알아야 합니다. (Sticky Session, Session Clustering 필요)

## 2. JWT(Token) 인증: "토큰이 증명한다"

서버는 아무것도 기억하지 않습니다(Stateless). 대신 토큰에 "나는 철수고, 관리자 권한이 있고, 1시간 동안 유효해"라는 정보를 적어서 도장(Signature)을 찍어 줍니다.

- **장점**:
    - **확장성**: 어떤 서버든 토큰의 도장만 확인하면 되므로 서버를 늘리기 쉽습니다.
    - **모바일 친화적**: 쿠키를 잘 안 쓰는 모바일 앱 환경에 적합합니다.
- **단점**:
    - **통제 불가**: 토큰을 탈취당하면 만료될 때까지 막을 방법이 없습니다. (Blacklist를 만들면 결국 세션과 비슷해짐)
    - **데이터 크기**: 토큰에 정보를 많이 담으면 네트워크 트래픽이 늘어납니다.

## 3. JWT 구조 해부

JWT는 `aaaaa.bbbbb.ccccc` 처럼 점 3개로 구분됩니다.

1.  **Header**: "나 HS256 알고리즘 썼어."
2.  **Payload**: "내 이름은 철수(sub), 만료는 내일(exp)." (Base64로 인코딩되어 누구나 볼 수 있음! 비밀번호 넣으면 안 됨!)
3.  **Signature**: "Header + Payload + 서버의 비밀키"를 섞어서 만든 암호화 서명. (위변조 방지)

## 4. Access Token & Refresh Token 전략

JWT의 단점(탈취 시 위험)을 보완하기 위해 두 개의 토큰을 씁니다.

1.  **Access Token**: 유효기간 **30분**. API 요청할 때 씀. 탈취돼도 30분 뒤면 똥이 됩니다.
2.  **Refresh Token**: 유효기간 **2주**. DB(Redis)에 저장. Access Token이 죽으면 새거 발급받을 때 씀.

**흐름:**
1.  로그인 → Access Token + Refresh Token 발급.
2.  Access Token으로 API 신나게 씀.
3.  30분 뒤 401 에러(만료).
4.  클라이언트가 Refresh Token 보내서 재발급 요청.
5.  서버가 Refresh Token 확인(DB랑 비교) → 맞으면 새 Access Token 발급.

## 요약

- **웹(Browser)** 위주라면 **Session**이 보안상 더 안전하고 편할 수 있습니다.
- **앱(Mobile)**이나 **MSA** 환경라면 **JWT**가 필수적입니다.
- JWT를 쓸 때는 **Refresh Token**을 활용해 보안성을 높이고, **HttpOnly Cookie**에 저장하여 XSS를 방어하는 것이 좋습니다.
