---
title: "API 문서화: Spring REST Docs와 Swagger/OpenAPI"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["REST Docs", "Swagger", "OpenAPI", "Spring"]
categories: ["Backend Deep Dive"]
description: "스펙 우선 vs 코드 기반 문서화 비교, REST Docs/Swagger 설정과 적용 패턴"
module: "spring-core"
study_order: 165
---

## REST Docs

- 테스트 기반 스니펫 생성 → Asciidoc/HTML 변환
- 장점: 실제 테스트 통과한 응답 기준, 단점: 학습 곡선/템플릿 관리

## Swagger/OpenAPI

- `springdoc-openapi` 등으로 자동 문서화
- 장점: 빠른 적용/인터랙티브 UI, 단점: 실제 동작 불일치 가능

## 설정 예시 (springdoc)

```java
@OpenAPIDefinition(
    info = @Info(title = "My API", version = "v1")
)
@SpringBootApplication
public class App { ... }
```

## 체크리스트

- [ ] 팀에 맞는 접근 선택: 테스트 중심(REST Docs) vs 빠른 스펙 공유(Swagger)
- [ ] 보안: 프로덕션에서 문서 UI 노출 범위 제한
- [ ] API 버전/Deprecated 정책 명시
