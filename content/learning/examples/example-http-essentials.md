---
title: "HTTP 필수 개념 정리"
date: 2025-12-16
draft: false
topic: "Network"
tags: ["HTTP", "REST", "TLS", "Caching"]
categories: ["Development", "Learning"]
description: "메서드/상태코드/헤더/캐시/HTTPS 기본을 빠르게 복습"
module: "foundation"
study_order: 50
---

## 이 글에서 얻는 것

- HTTP 메서드/상태코드를 “외우는 것”이 아니라, **API 설계와 장애 분석**에 활용할 수 있습니다.
- 캐시의 핵심 흐름(ETag/조건부 요청)을 이해하고, 304가 왜 성능에 중요한지 설명할 수 있습니다.
- HTTPS/TLS가 “암호화 된다” 수준을 넘어, 인증서/키 교환/ALPN 같은 실무 키워드를 연결할 수 있습니다.
- `curl`로 요청/응답을 관찰하는 기본 루틴을 만들 수 있습니다.

## 1) 메서드: 의도가 곧 계약이다

HTTP 메서드는 “CRUD”보다 중요한 두 가지 성질이 있습니다.

- **Safe**: 서버 상태를 바꾸지 않는다(대표적으로 GET).
- **Idempotent**: 같은 요청을 여러 번 해도 결과가 같다(대표적으로 PUT/DELETE).

실무에서 이 차이는 “재시도”와 직결됩니다.  
예를 들어 네트워크 오류가 났을 때, 멱등한 요청은 비교적 안전하게 재시도할 수 있습니다.

자주 쓰는 메서드의 의도:

- `GET`: 조회(안전/멱등)
- `POST`: 생성/명령(대체로 비멱등)
- `PUT`: 전체 교체(멱등)
- `PATCH`: 부분 수정(보통 비멱등일 수 있음)
- `DELETE`: 삭제(멱등)

## 2) 상태 코드: 문제를 “분류”하는 도구

자주 보는 코드만 먼저 연결해두면, 장애 분석이 빨라집니다.

- `200 OK` / `201 Created` / `204 No Content`
- `304 Not Modified`: 캐시가 유효해서 본문 전송을 생략(트래픽/지연 감소)
- `400 Bad Request`: 요청 자체가 잘못됨(파라미터/바디 검증)
- `401 Unauthorized` vs `403 Forbidden`: 인증 실패 vs 권한 없음
- `404 Not Found`
- `429 Too Many Requests`: 레이트 리밋(클라이언트 재시도 정책과 연결)
- `500 Internal Server Error`: 서버 내부 오류(로그/트레이싱으로 원인 추적)

## 3) 캐시: “빠르게”보다 “덜 보내기”

캐시는 단순히 빠르게 만드는 게 아니라 **불필요한 전송을 줄이는 설계**입니다.

대표 헤더:

- `Cache-Control: max-age=60, public`
- 민감 데이터는 보통 `Cache-Control: no-store` (브라우저/프록시 캐시 금지)

조건부 요청(Conditional Request):

- 서버가 `ETag`를 내려주면,
- 클라이언트는 다음 요청에 `If-None-Match: <etag>`를 보내서,
- 변경이 없을 때 `304 Not Modified`로 본문을 생략할 수 있습니다.

## 4) HTTPS/TLS 흐름(요약)

TLS는 “암호화”뿐 아니라 “서버가 진짜 맞는지”를 확인(인증)합니다.

1) ClientHello: 지원 암호 스위트, SNI, (대부분) ALPN 정보  
2) ServerHello + 인증서(서버 공개키/체인)  
3) 키 교환(주로 ECDHE) → 대칭키 생성  
4) 이후 애플리케이션 데이터는 대칭키로 암호화 전송  

## 실습: 관찰부터 시작하기

- 헤더만 보기: `curl -I https://example.com`
- 304 만들기(ETag 기반): `curl -H 'If-None-Match: \"<etag>\"' -I https://example.com`
- 인증서 체인/만료 확인: `openssl s_client -connect example.com:443 -showcerts`
