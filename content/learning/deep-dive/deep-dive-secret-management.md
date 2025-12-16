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

## 이 글에서 얻는 것

- “설정(config)”과 “비밀(secret)”을 구분하고, 왜 분리해야 하는지(유출/회수 비용) 설명할 수 있습니다.
- 소스/도커 이미지에 비밀을 넣지 않고, 런타임에 안전하게 주입하는 대표 패턴(Env/File/Secret Manager)을 선택할 수 있습니다.
- Vault/Secrets Manager 같은 비밀 저장소를 도입할 때 고려해야 할 것(권한/감사/회전/장애)을 정리할 수 있습니다.
- Spring Boot에서 비밀을 주입하는 방법(`spring.config.import`, Spring Cloud)을 큰 흐름으로 이해합니다.

## 0) 비밀 관리가 ‘운영 능력’인 이유

비밀이 유출되면 보통 “코드 배포로” 해결되지 않습니다.

- 키/토큰을 폐기하고(회수),
- 새 키로 교체하고(회전),
- 영향 범위를 조사하고(감사),
- 재발 방지를 시스템으로 만들기(정책/도구)

까지가 포함됩니다. 그래서 처음부터 구조로 막아야 합니다.

## 1) 무엇이 secret인가(실무 기준)

아래는 대부분 secret입니다.

- DB 비밀번호/접속 키
- 외부 API 키/토큰
- OAuth client secret
- 암호화 키(KMS 키 자체가 아니라 애플리케이션 키)
- 서명 키(JWT signing key)

반면 아래는 보통 config입니다.

- 포트/환경 플래그
- 외부 서비스 base URL(민감도가 낮은 경우)
- feature flag(일부는 민감할 수 있음)

## 2) 설계 원칙(최소 3개)

### 2-1) 소스/이미지에 비밀을 넣지 않는다

- Git에 커밋하지 않는다
- Docker 이미지에 bake 하지 않는다
- 로그에 찍지 않는다(예외 메시지/디버그 로그 포함)

### 2-2) 최소 권한(Least Privilege)

“이 서비스가 필요한 비밀만 읽을 수 있게” 범위를 최소화합니다.

- 서비스별/환경별(DEV/PROD) 경로 분리
- 읽기 권한만 필요한 경우 write 금지
- 네트워크/아이덴티티 기반 접근(IAM role, k8s service account 등)

### 2-3) 회전(rotate) 가능하게 설계한다

키는 언젠가 바뀝니다.

- 회전 주기(정책)
- 버전 관리(이전/현재)
- 롤링 교체(grace period)

가 가능한 구조를 미리 잡습니다.

## 3) 주입 방식 3가지(대표 패턴)

### 3-1) 환경변수(Env)

- 가장 단순, 12-factor 스타일
- 단점: 프로세스/덤프/오류 보고에 노출될 수 있어 운영 정책이 필요

### 3-2) 파일 마운트(File)

- Kubernetes Secret/볼륨 마운트처럼 “파일로 주입”
- 장점: 프로세스 환경변수보다 노출 면적이 줄 수 있음
- 단점: 파일 권한/로테이션/리로드 전략을 고려해야 함

### 3-3) Secret Manager / Vault(권장되는 운영형)

- 중앙 저장소에서 “필요할 때” 가져옴
- 장점: 감사 로그/권한/회전/버전 관리가 시스템으로 제공됨
- 단점: 의존성이 하나 더 생김(장애 시 정책 필요: fail-fast vs fallback)

## 4) Vault vs Secrets Manager(감각)

- Managed Secret Manager(AWS/GCP 등): 운영 부담이 적고 IAM과 통합이 쉬움
- Vault: 동적 시크릿/임대(lease)/정교한 정책 등 강력하지만 운영 부담이 큼

정답은 없고, “팀이 감당 가능한 운영 복잡도”가 중요한 기준입니다.

## 5) Spring에서 비밀 주입(큰 흐름)

Spring Boot는 외부 설정 소스를 import해서 프로퍼티로 사용할 수 있습니다.

- `spring.config.import=...`로 외부 설정 소스를 붙이는 패턴
- Spring Cloud Vault/Secrets Manager 같은 통합을 사용하면 더 편해집니다

Vault(AppRole) 예시(개념):

```yaml
spring:
  cloud:
    vault:
      uri: https://vault.example.com
      authentication: approle
      app-role:
        role-id: ${VAULT_ROLE_ID}
        secret-id: ${VAULT_SECRET_ID}
```

중요한 운영 포인트:

- import는 보통 “시작 시점에” 읽습니다(런타임 리프레시는 별도 설계가 필요).
- 외부 소스 장애 시 애플리케이션을 어떻게 할지 결정해야 합니다(필수 비밀이면 fail-fast가 안전한 경우가 많음).

## 6) 회전 전략(현실적인 접근)

### 6-1) 버전(이중 키) 전략

- “현재 키 + 이전 키”를 동시에 허용하는 기간을 둡니다.
  - 예: JWT 서명 키는 kid를 두고 검증 시 여러 키를 허용

### 6-2) DB 비밀번호 회전

- 애플리케이션이 “새 비밀번호”로 재시작/재연결할 수 있어야 합니다.
- 커넥션 풀은 비밀번호가 바뀌면 기존 커넥션이 살아있다가 나중에 터질 수 있어 운영 정책이 필요합니다.

## 7) 로컬/CI 운영 팁

- 로컬은 `.env`/로컬 시크릿(레포 밖)로 주입하고, 운영은 Secret Manager로 주입
- CI는 GitHub Actions Secrets/Vars로 주입하고, PR에서 시크릿이 필요한 작업은 막기
- secret scanning(gitleaks 등)으로 “실수 커밋”을 빨리 잡기

## 연습(추천)

- 로컬에서는 `.env`로, 운영에서는 `spring.config.import`로 동일한 설정 키를 주입하도록 구조를 만들어보기
- “필수 시크릿 누락” 시 애플리케이션이 시작 단계에서 실패하도록 검증을 추가해보기
- 회전 시나리오를 문서로 써보기(누가/어떻게/언제 키를 바꾸고, 장애 시 롤백은 어떻게 하는지)
