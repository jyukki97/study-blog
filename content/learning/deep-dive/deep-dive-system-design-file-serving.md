---
title: "시스템 설계: 파일 업로드와 서빙 (S3+CDN)"
date: 2025-12-16
draft: false
topic: "System Design"
tags: ["System Design", "S3", "CDN", "파일업로드"]
categories: ["Backend Deep Dive"]
description: "Presigned URL, 멀티파트 업로드, CDN 캐싱 전략으로 파일을 안전하게 업로드/서빙하는 방법"
module: "data-system"
study_order: 280
---

## 아키텍처

- 업로드: 클라이언트 → 백엔드에서 Presigned URL 발급 → S3 직접 업로드
- 서빙: CloudFront/Cloudflare CDN → S3 Origin, 캐시 정책/서명 URL로 보호

## 설계 포인트

- 인증/인가: 업로드 전 권한 체크, 파일 키 네임스페이스 분리
- 보안: Content-Type/크기 제한, 악성 파일 스캔(람다/버킷 이벤트)
- 멀티파트 업로드: 대용량 파일 분할, 실패 파트 정리
- 캐시: 정적 파일은 긴 TTL, 버전 해시로 무효화

## 체크리스트

- [ ] Presigned URL 만료/사용 횟수 제한
- [ ] 업로드 후 메타데이터 저장(DB) + 서명 URL 혹은 Public 경로 반환
- [ ] HTTPS 강제, CORS 정책 설정
- [ ] 이미지 리사이즈/썸네일은 별도 워크플로(Lambda@Edge 등)
