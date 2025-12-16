---
title: "CI/CD 보안과 소프트웨어 공급망 보호"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["CI/CD", "Supply Chain", "SBOM", "Signing"]
categories: ["DevOps"]
description: "서명/검증, SBOM, 의존성 스캔, 시크릿 관리 등 공급망 보안 체크리스트"
module: "ops-observability"
study_order: 395
---

## 필수 항목

- 의존성 스캔(SCA), 라이선스 검증
- SBOM 생성/배포, 아티팩트 서명/검증
- 시크릿 노출 방지: PR 테스트에서 출력 금지, 린트/검사
- 빌드/배포 권한 최소화, 감시 로깅

## 체크리스트

- [ ] SBOM(Syft 등) 생성, 이미지 서명(cosign 등)
- [ ] 취약점 스캔 주기/임계치 설정
- [ ] CI 시크릿 사용 범위 최소화, PR에서 write 금지
- [ ] 서드파티 액션/플러그인의 신뢰도 검증
