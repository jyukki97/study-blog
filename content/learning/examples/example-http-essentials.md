---
title: "HTTP 필수 개념 정리"
date: 2025-12-16
draft: false
topic: "Network"
tags: ["HTTP", "REST", "TLS", "Caching"]
categories: ["Development", "Learning"]
description: "메서드/상태코드/헤더/캐시/HTTPS 기본을 빠르게 복습"
module: "foundation"
study_order: 13
---

## 메서드 & 상태 코드

- 메서드 의도: GET(조회), POST(생성/명령), PUT(전체 수정), PATCH(부분 수정), DELETE(삭제)
- 자주 보는 상태 코드
  - 200 OK / 201 Created
  - 204 No Content (본문 없음)
  - 304 Not Modified (캐시 활용)
  - 400 Bad Request / 401 Unauthorized / 403 Forbidden / 404 Not Found
  - 429 Too Many Requests / 500 Internal Server Error

## 캐시 헤더

- `Cache-Control: max-age=60, public`
- 조건부 요청: `If-None-Match`(ETag), `If-Modified-Since`
- 무효화: `Cache-Control: no-store`, 민감 데이터는 캐시 금지

## HTTPS/TLS 흐름 (요약)

1) ClientHello(암호 스위트, SNI)  
2) ServerHello + 인증서(공개키)  
3) 키 교환(대부분 ECDHE) → 대칭키 생성  
4) Finished 이후 애플리케이션 데이터 암호화 전송

## 실습 체크

- [ ] curl로 요청/응답 헤더 확인: `curl -I https://example.com`
- [ ] 조건부 요청 테스트: `If-None-Match`로 304 응답 확인
- [ ] HTTPS 인증서 체인/만료일 확인: `openssl s_client -connect example.com:443 -showcerts`
