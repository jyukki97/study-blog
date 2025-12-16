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

## 이 글에서 얻는 것

- API 문서화가 “있으면 좋은 것”이 아니라, **팀/클라이언트와의 계약**이라는 관점으로 접근할 수 있습니다.
- Spring REST Docs와 Swagger/OpenAPI의 장단점을 비교하고, 우리 팀에 맞는 선택 기준을 세울 수 있습니다.
- 문서가 “실제 동작과 어긋나는 문제”를 최소화하는 운영 패턴(테스트/CI/노출 제한)을 정리합니다.

## 0) 문서화에서 진짜 중요한 것

문서화 도구보다 중요한 건 “문서가 어떤 역할을 하는지”입니다.

- 클라이언트(프론트/모바일/다른 서버)가 신뢰할 수 있는 **계약(Contract)** 인가?
- 변경 시 깨지는 것을 빠르게 잡는 **변경 감지 장치**인가?
- 인증/에러/페이징/레이트리밋 같은 “실전 스펙”까지 포함하는가?

## 1) REST Docs: 테스트 기반(정확도 우선)

Spring REST Docs는 테스트(MockMvc/WebTestClient)가 만든 요청/응답을 스니펫으로 추출하고,
이를 AsciiDoc/HTML로 합성합니다.

장점:

- 테스트가 통과한 “실제 응답” 기준이라 문서 정확도가 높습니다.
- 변경이 생기면 테스트가 깨져서 문서도 함께 갱신됩니다(계약 유지에 강함).

단점:

- 템플릿/문서 조립(Asciidoctor) 세팅이 필요하고 진입 장벽이 있습니다.
- “빠르게 UI로 탐색”하는 경험은 Swagger UI보다 약할 수 있습니다.

간단 예시(아이디어):

```java
@Test
void 사용자_조회_문서화() throws Exception {
    mockMvc.perform(get("/api/users/{id}", 1))
        .andExpect(status().isOk())
        .andDo(document("users-get",
            pathParameters(parameterWithName("id").description("사용자 ID"))
        ));
}
```

## 2) Swagger/OpenAPI: 빠른 공유/탐색(속도 우선)

OpenAPI 스펙은 “API 계약을 표준 포맷(YAML/JSON)으로 표현”한 것입니다.
Spring에서는 `springdoc-openapi`로 애노테이션/메타데이터를 기반으로 스펙을 생성하고 Swagger UI를 제공하는 패턴이 흔합니다.

장점:

- 적용이 빠르고, Swagger UI로 바로 호출/탐색이 가능합니다.
- 외부 파트너/다른 팀과 스펙 공유가 편합니다.

단점:

- 문서가 자동 생성된다고 해서 “항상 정확”한 건 아닙니다.  
  실제 응답(에러 케이스, 권한, 필드 조건)이 코드/테스트와 어긋날 수 있습니다.

설정 예시(개념):

```java
@OpenAPIDefinition(info = @Info(title = "My API", version = "v1"))
@SpringBootApplication
public class App { }
```

## 3) 선택 기준: 우리 팀은 무엇이 더 중요한가

다음 질문으로 결정이 쉬워집니다.

- 문서를 “외부 계약”처럼 강하게 보장해야 한다 → REST Docs 쪽이 유리
- 문서를 “빠르게 공유/탐색”하는 게 중요하다 → OpenAPI/Swagger가 유리
- 둘 다 필요하다 → OpenAPI + 테스트(계약 테스트/스냅샷)로 정확도 보강

실무에서는 “내부 서비스는 Swagger로 빠르게, 외부 공개 API는 REST Docs로 강하게” 같은 혼합 전략도 자주 씁니다.

## 4) 운영에서 꼭 고려할 것(보안/버전/에러)

- **노출 제한**: Swagger UI/스펙 엔드포인트는 운영에서 내부망/인증/관리자만 보게 제한하는 편이 안전합니다.
- **버전 정책**: URL 버전(`/v1`)이든 헤더 버전이든, deprecation 정책을 문서에 명시해야 합니다.
- **에러 스펙**: 200만 문서화하면 실전에서 의미가 없습니다. 400/401/403/404/409/429/5xx를 어떻게 내리는지 고정하세요.

## 연습(추천)

- “사용자 조회/생성” 2개 엔드포인트를 REST Docs로 문서화하고 CI에서 문서 생성까지 통과시키기
- 동일 엔드포인트를 OpenAPI로도 노출해보고(내부용), 운영에서는 Swagger UI 접근을 제한해보기
- 에러 응답(Validation/Business/System)을 문서에 포함시키고, 변경 시 테스트가 깨지게 만들어 계약을 고정해보기
