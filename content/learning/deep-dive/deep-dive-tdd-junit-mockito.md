---
title: "TDD 입문: JUnit 5 + Mockito로 테스트 드라이빙"
date: 2025-12-16
draft: false
topic: "Testing"
tags: ["TDD", "JUnit 5", "Mockito", "테스트"]
categories: ["Backend Deep Dive"]
description: "레드-그린-리팩터 사이클, 단위/슬라이스 테스트 작성과 Mock 활용 패턴"
module: "foundation"
study_order: 60
---

## TDD 3단계

- **Red**: 실패하는 테스트 작성 (명확한 기대 결과)
- **Green**: 최소 구현으로 통과
- **Refactor**: 중복 제거, 가독성/설계 개선

## JUnit 5 기본

- `@Test`, `@DisplayName`, `@Nested`로 문맥 분리
- 매개변수화: `@ParameterizedTest` + `@ValueSource`/`@CsvSource`

```java
@ParameterizedTest
@CsvSource({"2,3,5", "5,7,12"})
void add(int a, int b, int expected) {
    assertThat(a + b).isEqualTo(expected);
}
```

## Mockito 패턴

- Stub: `when(repo.find()).thenReturn(...)`
- Verify: `verify(service).sendEmail(any())`
- ArgumentCaptor: 호출 값 검증

```java
when(repo.findById(1L)).thenReturn(Optional.of(user));
service.process(1L);
verify(sender).notify(userCaptor.capture());
```

## 슬라이스 테스트

- JPA: `@DataJpaTest` + Testcontainers로 실제 DB 검증
- 웹: `@WebMvcTest` + MockMvc로 컨트롤러 레이어만 테스트

## 체크리스트

- [ ] 테스트 이름은 행위/기대 결과를 드러내는 문장형
- [ ] 외부 자원(DB/네트워크)은 Mock 또는 Testcontainers로 격리
- [ ] 한 테스트는 한 가지 검증에 집중, 과도한 assertion 피하기
