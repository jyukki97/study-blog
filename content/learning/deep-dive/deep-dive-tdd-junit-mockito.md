---
title: "TDD 입문: JUnit 5 + Mockito로 테스트 드라이빙"
date: 2025-12-16
draft: false
topic: "Testing"
tags: ["TDD", "JUnit 5", "Mockito", "테스트"]
categories: ["Backend Deep Dive"]
description: "레드-그린-리팩터 사이클, 단위/슬라이스 테스트 작성과 Mock 활용 패턴"
module: "foundation"
quizzes:
  - question: "TDD(Test Driven Development)의 3단계 사이클을 올바른 순서대로 나열한 것은?"
    options:
      - "Green(구현) -> Red(테스트 작성) -> Refactor(개선)"
      - "Red(실패하는 테스트 작성) -> Green(최소한의 구현으로 통과) -> Refactor(중복 제거 및 구조 개선)"
      - "Refactor(설계) -> Red(테스트 작성) -> Green(구현)"
      - "Green(구현) -> Refactor(개선) -> Red(검증)"
    answer: 1
    explanation: "TDD는 먼저 실패하는 테스트를 작성해 요구사항을 명세하고, 이를 통과시키는 최소 코드를 작성한 뒤, 리팩터링을 통해 설계를 개선하는 반복적인 과정입니다."

  - question: "테스트 종류 중, 외부 의존성(DB, 외부 API)과의 연동보다는 '핵심 비즈니스 로직'의 정확성을 검증하며, 속도가 가장 빠르고 비용이 저렴한 테스트는?"
    options:
      - "단위 테스트 (Unit Test)"
      - "통합 테스트 (Integration Test)"
      - "E2E 테스트 (End-to-End Test)"
      - "부하 테스트 (Load Test)"
    answer: 0
    explanation: "단위 테스트는 함수나 클래스 같은 작은 단위를 고립시켜 검증하므로, 실행 속도가 매우 빠르고 문제의 원인을 찾기 쉽습니다."

  - question: "JUnit 5에서 테스트 메서드의 이름을 코드 상의 메서드명 대신, 한글이나 공백이 포함된 문장으로 표현하고 싶을 때 사용하는 애노테이션은?"
    options:
      - "@TestName"
      - "@Description"
      - "@DisplayName"
      - "@Label"
    answer: 2
    explanation: "`@DisplayName(\"할인 정책이 올바르게 적용된다\")`와 같이 사용하면 테스트 결과 리포트에서 가독성 높은 이름을 볼 수 있습니다."

  - question: "Mockito 프레임워크에서 `verify()` 메서드를 사용하는 것이 가장 적절한 상황은?"
    options:
      - "메서드가 어떤 값을 반환했는지 확인할 때"
      - "메서드 내부의 변수 값을 확인할 때"
      - "메일 발송, 결제 요청 등 외부 시스템에 '부수 효과(Side-effect)'를 일으키는 메서드가 호출되었는지 확인할 때"
      - "항상 사용해야 한다."
    answer: 2
    explanation: "상태(반환값) 검증이 가능한 경우에는 `assertThat` 등을 쓰는 것이 좋고, `verify`는 반환값이 없는 행위(Void method call)나 외부 상호작용을 검증할 때 유용합니다."

  - question: "테스트 코드 작성 시 피해야 할 안티 패턴으로, '구현 내부의 상세한 로직(Private 메서드 호출 등)을 과도하게 모킹(Mocking)하고 검증'하면 발생하는 문제는?"
    options:
      - "테스트가 너무 빨라진다."
      - "리팩터링 내성(Refactoring Resistance)이 떨어진다. 즉, 내부 구현을 조금만 바꿔도 테스트가 깨지게 된다."
      - "테스트 커버리지가 낮아진다."
      - "버그를 더 잘 찾게 된다."
    answer: 1
    explanation: "테스트는 '무엇(What)'을 하는지를 검증해야지, '어떻게(How)' 구현했는지를 검증하면 구현 변경 시마다 테스트를 고쳐야 하는 짐이 됩니다."

  - question: "JUnit 5에서 여러 개의 입력값(소스)을 사용하여 하나의 테스트 로직을 반복 검증하고 싶을 때 사용하는 애노테이션은?"
    options:
      - "@RepeatedTest"
      - "@ParameterizedTest"
      - "@TestFactory"
      - "@DynamicTest"
    answer: 1
    explanation: "`@ParameterizedTest`와 `@CsvSource`, `@ValueSource` 등을 조합하면 다양한 입력값에 대한 경계값 테스트를 효율적으로 작성할 수 있습니다."

  - question: "Mockito에서 `ArgumentCaptor`의 주된 용도는?"
    options:
      - "메서드의 실행 시간을 측정한다."
      - "메서드 호출 시 전달된 인자(Argument)를 가로채서(Capture) 그 값을 검증한다."
      - "메서드의 예외를 무시한다."
      - "메서드의 반환값을 조작한다."
    answer: 1
    explanation: "Mock 객체의 메서드가 호출될 때 넘겨진 실제 파라미터 값이 예상대로인지 검증하고 싶을 때 사용합니다."
study_order: 36
---

## 이 글에서 얻는 것

- TDD를 “테스트를 많이 쓰는 문화”가 아니라, **설계를 개선하는 루틴**으로 이해할 수 있습니다.
- 단위 테스트/슬라이스 테스트/통합 테스트를 구분하고, 어디에 어떤 테스트를 두어야 하는지 기준이 생깁니다.
- JUnit 5에서 자주 쓰는 구조화 패턴(`@Nested`, 매개변수화, 예외 검증)을 바로 쓸 수 있습니다.
- Mockito를 “남발”하지 않고, 경계(외부 의존성)에서만 효과적으로 쓰는 방법을 익힙니다.

## 1) TDD가 진짜로 해결하는 문제

TDD의 핵심은 “테스트 커버리지”보다 다음입니다.

- 변경할 때 무너지는 부분을 빠르게 잡는 **안전망(Regression 방지)**
- 요구사항을 코드로 명확히 표현하는 **명세(Executable spec)**
- 테스트를 먼저 쓰면서 “의존성이 과한 설계”를 자연스럽게 거르는 **설계 압력**

## 2) 테스트의 종류를 먼저 구분하자

테스트는 빠를수록 좋고, 범위가 넓을수록 현실과 가깝습니다. 둘은 트레이드오프입니다.

- **단위(Unit)**: 함수/클래스 단위. 빠르고 결정적. 대부분의 로직은 여기서 커버.
- **슬라이스(Slice)**: 특정 레이어만(예: Controller만, Repository만). 프레임워크와의 접점을 검증.
- **통합(Integration)**: DB/메시지/외부 API를 포함. 느리지만 “진짜로 붙었는지” 확인.

실무 감각:

- 로직이 무너지지 않게 하려면 단위 테스트가 가장 효율적입니다.
- 프레임워크 설정 실수/매핑 실수는 슬라이스/통합 테스트가 잡습니다.

## 3) Red → Green → Refactor: ‘작게’ 굴리는 것이 전부

- **Red**: 실패하는 테스트를 먼저 만든다(무엇이 기대값인지 확정).
- **Green**: 통과시키기 위한 최소 구현을 한다(과설계 금지).
- **Refactor**: 중복을 제거하고, 이름/구조를 개선한다(테스트가 안전망).

팁:

- 한 번에 크게 가지 말고 “아주 작은 요구사항”으로 쪼개면 TDD가 더 쉬워집니다.

## 4) JUnit 5: 테스트를 읽기 좋게 만드는 도구들

### 4-1) Given/When/Then 구조(가독성 최우선)

테스트는 “다른 사람이 읽는 문서”입니다. 먼저 구조를 고정합니다.

```java
@Test
void 할인_정책이_적용되면_최종금액이_줄어든다() {
    // given
    Money origin = Money.wons(10_000);

    // when
    Money discounted = origin.minusPercent(10);

    // then
    assertThat(discounted.amount()).isEqualTo(9_000);
}
```

### 4-2) 매개변수화 테스트(경계값을 빠르게 늘리기)

```java
@ParameterizedTest
@CsvSource({"2,3,5", "5,7,12"})
void add(int a, int b, int expected) {
    assertThat(a + b).isEqualTo(expected);
}
```

### 4-3) 예외 검증(실패도 ‘명세’다)

```java
@Test
void 존재하지_않는_사용자는_예외() {
    assertThatThrownBy(() -> service.findUser(999L))
        .isInstanceOf(BusinessException.class);
}
```

## 5) Mockito: Mock은 “경계”에서만 쓰기

Mock은 유용하지만, 과하면 테스트가 구현에 종속됩니다(리팩터링이 어려워짐).

### 5-1) Stub vs Verify

- **Stub**: 의존성이 무엇을 “리턴”할지 정해준다.
- **Verify**: 의존성이 “호출되었는지” 검증한다(부수효과가 중요한 경우에만).

```java
when(repo.findById(1L)).thenReturn(Optional.of(user));

service.process(1L);

verify(sender).notify(any());
```

권장 기준:

- 값 계산/리턴이 목적이면 **상태 기반 검증(결과 값)** 을 우선하고,
- 외부로 나가는 부수효과(메일/메시지/결제 요청) 같은 경우에만 verify를 쓰는 편이 유지보수에 유리합니다.

### 5-2) ArgumentCaptor: “무엇을 보냈는지” 검증하기

```java
ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
service.process(1L);
verify(sender).notify(captor.capture());
assertThat(captor.getValue().userId()).isEqualTo(1L);
```

## 6) 슬라이스/통합 테스트는 언제 필요할까(스프링 기준)

- Repository 쿼리/매핑이 중요하다 → `@DataJpaTest` (+ 가능하면 Testcontainers)
- Controller의 요청/응답 규약이 중요하다 → `@WebMvcTest` (+ MockMvc)

“단위 테스트로 충분한데도 통합 테스트만 잔뜩”이면 테스트가 느려지고, 결국 안 돌리게 됩니다.

## 7) 자주 하는 실수

- 테스트가 구현 디테일을 너무 많이 안다(verify 남발) → 리팩터링이 불가능해짐
- 랜덤/시간/외부 자원 때문에 테스트가 흔들린다(Flaky) → 테스트 신뢰가 무너짐
- 하나의 테스트에서 너무 많은 걸 검증한다 → 실패 원인을 좁히기 어려움

## 연습(추천)

- “주문 생성” 같은 간단한 유스케이스를 정하고, Red→Green→Refactor로 3번만 반복해보기
- Mock을 최소로 줄여보고(Repository만 mock), 결과 기반 검증으로 테스트가 더 단단해지는지 비교해보기
- `@WebMvcTest`로 하나의 엔드포인트를 만들고, 요청/응답 계약(상태코드/에러 응답)까지 테스트로 고정해보기
