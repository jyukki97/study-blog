---
title: "비밀 관리: Vault/Secrets Manager와 Spring 연동"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["Secrets", "Vault", "AWS Secrets Manager", "Spring"]
categories: ["DevOps"]
description: "애플리케이션 설정과 비밀을 분리하고, Vault/Secrets Manager를 통해 주입하는 방법"
module: "ops-observability"
study_order: 345
---

## 설계 원칙

- 비밀/설정 분리: 소스/이미지에 비밀 없음
- 최소 권한: IAM/정책으로 읽기 범위 제한

## Spring 연동

- Spring Cloud Vault/Secrets Manager로 프로퍼티 주입
- `spring.config.import=aws-secretsmanager:/app/` 등 외부 소스 지정

```yaml
spring:
  cloud:
    vault:
      uri: https://vault.example.com
      authentication: approle
      app-role:
        role-id: xxx
        secret-id: yyy
```

## 체크리스트

- [ ] 회전 주기/버전 관리 설계
- [ ] 접근 로깅/모니터링
- [ ] 로컬/CI/운영 프로필별 주입 경로 분리
- [ ] 비밀 캐싱/갱신 시점 확인
