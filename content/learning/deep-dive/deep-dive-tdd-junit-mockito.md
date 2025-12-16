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
