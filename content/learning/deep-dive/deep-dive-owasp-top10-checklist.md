---
title: "OWASP Top 10 대응 체크리스트"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["OWASP", "Security", "Vulnerability", "Checklist"]
categories: ["DevOps"]
description: "OWASP Top 10 주요 취약점을 백엔드 관점에서 점검하기 위한 체크리스트"
module: "ops-observability"
study_order: 355
---

## 핵심 항목 (예시)

- A01: Broken Access Control → 경로/도메인 경계별 인가 검증, 최소권한
- A02: Cryptographic Failures → HTTPS, PII 암호화, 강한 해시(BCrypt/Argon2)
- A03: Injection → 파라미터 바인딩, 입력 검증, 쿼리 빌더/ORM
- A05: Security Misconfiguration → 디폴트 계정 제거, 불필요 엔드포인트 차단
- A07: Identification & Authentication Failures → 비밀번호 정책, 세션 보호, MFA 옵션
- A08: Software Integrity → 의존성 스캔, 서명 검증
- A09: Logging & Monitoring → 보안 이벤트 로깅, 알람/온콜

## 체크리스트

- [ ] 권한 없는 리소스 접근 차단(버티컬/호리즌탈)
- [ ] 입력 검증/파라미터 바인딩 적용
- [ ] 중요 데이터는 저장/전송 시 암호화
- [ ] 보안 이벤트 로깅/알람/대응 프로세스 마련
- [ ] 서드파티/의존성 스캔 주기적 수행
