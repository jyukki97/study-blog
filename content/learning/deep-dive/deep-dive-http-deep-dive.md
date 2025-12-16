---
title: "HTTP 딥다이브: 캐시, 조건부 요청, HTTPS 흐름"
date: 2025-12-16
draft: false
topic: "Network"
tags: ["HTTP", "Caching", "TLS", "Conditional Request"]
categories: ["Backend Deep Dive"]
description: "메서드/상태코드 복습 후 캐시 제어, ETag 조건부 요청, TLS 핸드셰이크를 실무 관점에서 정리"
module: "foundation"
study_order: 16
---

## 캐시 제어 핵심

- 응답 헤더: `Cache-Control: public, max-age=300`, `ETag`, `Last-Modified`
- 요청 헤더: `If-None-Match`, `If-Modified-Since` → 304 Not Modified
- 민감 정보: `Cache-Control: no-store`, `Pragma: no-cache`, `Set-Cookie` 시 `Secure; HttpOnly`

```bash
curl -I https://example.com
curl -H "If-None-Match: <etag>" -I https://example.com   # 304 확인
```

## HTTPS/TLS 요약

- ClientHello(SNI, cipher suites) → ServerHello+Cert → ECDHE 키 교환 → Finished 이후 암호화
- 인증서 체인/만료 확인: `openssl s_client -connect example.com:443 -showcerts`
- HSTS: `Strict-Transport-Security`로 HTTPS 강제

## 상태 코드 실전 포인트

- 2xx: 200/201/204, 304(캐시), 206(부분 콘텐츠)
- 4xx: 400 vs 422, 401 vs 403, 404/410
- 5xx: 500/502/503/504 구분(알람/SLI)

## 체크리스트

- [ ] 캐시 키 정책(쿼리스트링/헤더) 정의
- [ ] 정적 파일은 CDN + 긴 max-age, HTML은 no-store + ETag
- [ ] TLS 프로토콜/암호화 스위트 최신 유지(TLS1.2+/1.3)
- [ ] 오류 코드는 관측성 지표(알람)와 연결
