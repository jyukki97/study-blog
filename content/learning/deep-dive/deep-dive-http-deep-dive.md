---
title: "HTTP 딥다이브: 캐시, 조건부 요청, HTTPS 흐름"
date: 2025-12-16
draft: false
topic: "Network"
tags: ["HTTP", "Caching", "TLS", "Conditional Request"]
categories: ["Backend Deep Dive"]
description: "메서드/상태코드 복습 후 캐시 제어, ETag 조건부 요청, TLS 핸드셰이크를 실무 관점에서 정리"
module: "foundation"
quizzes:
  - question: "브라우저에게 '이 리소스를 600초 동안 캐싱해도 되지만, 서버에 변경 여부를 확인(Validation)하지 않고 그냥 써도 된다'고 지시하는 `Cache-Control` 헤더 값은?"
    options:
      - "no-cache"
      - "max-age=600"
      - "no-store"
      - "must-revalidate"
    answer: 1
    explanation: "`max-age=600`은 600초 동안은 캐시가 신선(Fresh)하다고 간주하여 서버 재검증 없이 바로 사용하라는 의미입니다."

  - question: "`Cache-Control: no-cache`의 정확한 의미는?"
    options:
      - "절대 캐시하지 마라. (저장 금지)"
      - "캐시는 하되, 사용할 때마다 서버에 변경 여부를 확인(Validation)하고 써라."
      - "캐시 서버(CDN)에는 저장하지 마라."
      - "캐시 유효기간을 0초로 설정해라."
    answer: 1
    explanation: "`no-cache`는 이름과 달리 저장을 금지하는 것이 아니라, '항상 검증'을 강제하는 지시어입니다. 저장을 아예 금지하려면 `no-store`를 써야 합니다."

  - question: "조건부 요청(Conditional Request)에서, 클라이언트가 가지고 있는 리소스의 버전(ETag)과 서버의 최신 버전이 같을 때 서버가 응답하는 상태 코드는?"
    options:
      - "200 OK"
      - "304 Not Modified"
      - "409 Conflict"
      - "302 Found"
    answer: 1
    explanation: "304 Not Modified는 '바뀐 게 없으니 네가 가지고 있는 캐시를 그대로 써라'는 의미로, 응답 본문(Body)을 보내지 않아 네트워크 비용을 아낍니다."

  - question: "HTTP 응답 헤더 중 `Vary: Accept-Encoding`이 의미하는 바는?"
    options:
      - "이 응답은 압축되지 않았다."
      - "캐시 서버가 `Accept-Encoding` 헤더의 값(예: gzip, br)에 따라 별도의 캐시를 생성/반환해야 한다."
      - "모든 인코딩을 지원한다."
      - "인코딩 방식이 수시로 바뀐다."
    answer: 1
    explanation: "`Vary` 헤더는 동일한 URL이라도 요청 헤더 값에 따라 응답이 달라질 수 있음을 캐시 서버에 알려주어, 잘못된 버전(예: 압축 안 된 응답을 압축 지원자에게 보냄)이 캐시되는 것을 막습니다."

  - question: "TLS 핸드셰이크 과정에서 클라이언트가 서버에게 지원 가능한 암호화 방식 목록과 랜덤 데이터를 보내는 첫 번째 메시지는?"
    options:
      - "ServerHello"
      - "ClientHello"
      - "Certificate"
      - "KeyExchange"
    answer: 1
    explanation: "`ClientHello`는 TLS 통신의 시작점으로, 사용할 TLS 버전, 암호 모음(Cipher Suite), SNI 등을 서버에 전달합니다."

  - question: "하나의 서버 IP로 여러 도메인(인증서)을 서비스할 때, TLS 핸드셰이크 시 클라이언트가 접속하려는 호스트 이름을 알려주는 확장 필드는?"
    options:
      - "ALPN (Application-Layer Protocol Negotiation)"
      - "SNI (Server Name Indication)"
      - "OCSP (Online Certificate Status Protocol)"
      - "HSTS (HTTP Strict Transport Security)"
    answer: 1
    explanation: "SNI가 없으면 서버는 어떤 인증서를 내려줘야 할지 모릅니다. SNI를 통해 클라이언트가 호스트명을 미리 알려줌으로써 하나의 IP에서 여러 HTTPS 사이트를 운영할 수 있습니다."
study_order: 52
---

## 이 글에서 얻는 것

- “캐시가 왜 안 먹지?”를 `Cache-Control/ETag/Vary` 관점에서 원인 분류할 수 있습니다.
- 304(조건부 요청)이 성능에 주는 효과와, 서버/클라이언트/CDN 각각의 역할을 연결할 수 있습니다.
- HTTPS/TLS의 핵심 용어(SNI, ALPN, 인증서 체인, 키 교환)를 실무 점검 항목으로 바꿀 수 있습니다.
- 4xx/5xx/429/504 같은 상태 코드를 운영 지표(알람/SLI)와 어떻게 연결할지 감각을 잡습니다.

## 1) 캐시의 본질: “더 빨리”가 아니라 “덜 보내기”

캐시는 보통 두 방식이 섞입니다.

- **Freshness(신선도)**: 아직 유효하면 그냥 쓰기(`max-age`).
- **Validation(검증)**: 유효한지 서버에 물어보기(ETag/Last-Modified → 304).

서버가 응답에 “이건 얼마나/어디서 캐시해도 돼”를 선언하고,
클라이언트/브라우저/프록시/CDN이 그 선언을 기반으로 트래픽을 줄입니다.

## 2) Cache-Control: 자주 쓰는 지시어만 제대로

```text
Cache-Control: public, max-age=300
```

- `max-age`: 초 단위 유효기간(브라우저/프록시가 “그냥 써도 된다”는 시간)
- `public` / `private`: 공유 캐시(CDN/프록시)에 저장 가능한지 여부
- `no-store`: **저장 자체 금지**(민감 데이터에 강력)
- `no-cache`: 저장은 가능하지만 **매번 검증(Validation)** 하라는 의미(이름이 헷갈리는 대표 케이스)
- `s-maxage`: 공유 캐시(CDN/프록시)에만 적용되는 max-age

실무에서 가장 흔한 패턴:

- 정적 파일(JS/CSS/이미지): 파일명에 해시를 붙이고(버전 고정) **긴 max-age**
- HTML/API 응답: 자주 바뀌면 **짧은 max-age 또는 검증 기반(ETag)**
- 개인화/민감 정보: **no-store**

## 3) 조건부 요청(ETag/Last-Modified): 304의 가치

서버가 `ETag`를 내려주면, 클라이언트는 다음 요청에 “내가 가진 버전이 아직 유효해?”라고 묻습니다.

```bash
curl -I https://example.com
curl -H "If-None-Match: <etag>" -I https://example.com  # 304 확인
```

- 변경 없음 → `304 Not Modified` (본문 전송 생략)
- 변경 있음 → `200 OK` + 새 본문 + 새 ETag

ETag가 특히 좋은 이유:

- 본문이 큰 응답에서 트래픽/지연을 크게 줄입니다.
- “콘텐츠 버전”을 명확히 표현해, CDN/프록시가 더 안정적으로 캐시할 수 있습니다.

추가로 알아두면 좋은 헤더:

- `Vary`: 어떤 요청 헤더에 따라 응답이 달라지는지(예: `Accept-Encoding`)를 캐시에 알려줌  
  `Vary`를 빼먹으면 “압축/언어/디바이스별 응답”이 섞여서 캐시 버그가 날 수 있습니다.

## 4) HTTPS/TLS: ‘암호화’보다 중요한 건 ‘인증’

TLS는 “암호화”만이 아니라 “이 서버가 진짜 맞는지”를 인증서로 확인합니다.

핵심 흐름(요약):

- ClientHello: 지원 버전/암호 스위트 + SNI + (대부분) ALPN
- ServerHello + 인증서 체인: 서버 공개키/신뢰 체인
- 키 교환(ECDHE 등) → 대칭키 생성
- 이후 애플리케이션 데이터는 대칭키로 암호화 전송

실무 점검:

- 인증서 만료/체인 문제: `openssl s_client -connect example.com:443 -showcerts`
- HTTP/2 협상(ALPN): `curl -v --http2 https://example.com`
- HSTS: `Strict-Transport-Security`로 HTTPS 강제(운영에서 “http로 접속” 이슈 예방)

## 5) 상태 코드: 운영에서 의미가 커지는 구간만

상태 코드는 “문제 분류 체계”입니다. 알람/대응 속도를 좌우합니다.

- `429 Too Many Requests`: 레이트 리밋(가능하면 `Retry-After`와 함께)
- `502 Bad Gateway`: 게이트웨이/프록시가 upstream에서 잘못된 응답
- `503 Service Unavailable`: 서비스가 일시적으로 처리 불가(과부하/점검)
- `504 Gateway Timeout`: upstream 타임아웃(네트워크/서버 지연/풀 고갈 등)
- `206 Partial Content`: Range 요청(대용량 다운로드/스트리밍)

운영 지표로 연결할 때의 감각:

- 5xx는 기본적으로 서버 신뢰성 지표(SLI)에 직결합니다.
- 429는 “내가 보호장치를 켰다”는 신호이기도 해서, 과도하면 용량/정책을 재조정해야 합니다.

## 연습(추천)

- API 응답에 `ETag`를 붙이고 `If-None-Match`로 304가 나오는지 확인해보기
- 정적 파일에 장기 캐시를 적용하고, 파일명 버전 전략(해시/빌드 버전)을 정리해보기
- `curl -v --http2`와 `openssl s_client`로 “실제로 h2인지/TLS가 어디서 종료되는지”를 확인해보기
