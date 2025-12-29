---
title: "Java 예외 처리 & Optional/Stream 패턴"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Java", "Exception", "Optional", "Stream"]
categories: ["Backend Deep Dive"]
description: "체크예외 vs 런타임예외, Optional/Stream에서 흔한 함정과 안전한 사용 패턴 정리"
module: "foundation"
quizzes:
  - question: "자바의 체크 예외(Checked Exception)와 런타임 예외(Unchecked Exception)를 구분하는 가장 중요한 실무적 기준은?"
    options:
      - "호출하는 쪽에서 예외 상황을 복구(Recovery)할 수 있는 기회를 줄 것인가, 아니면 실패로 처리할 것인가"
      - "예외 메시지가 긴가 짧은가"
      - "데이터베이스 예외인가 아닌가"
      - "Spring Framework를 사용하는가 안 하는가"
    answer: 0
    explanation: "호출자가 예외 상황을 인지하고 대안(재시도, 다른 경로 등)을 선택할 수 있다면 체크 예외를, 그렇지 않고 즉시 에러로 처리해야 한다면 런타임 예외를 사용합니다."

  - question: "`Optional.orElse(createDefaultObject())`와 `Optional.orElseGet(() -> createDefaultObject())`의 성능상 차이는?"
    options:
      - "차이가 없다."
      - "`orElse`는 Optional이 비어있지 않아도 `createDefaultObject()`를 항상 실행하지만, `orElseGet`은 비어있을 때만 실행(Lazy Evaluation)한다."
      - "`orElse`가 더 빠르다."
      - "`orElseGet`은 컴파일 에러가 발생한다."
    answer: 1
    explanation: "`orElse`의 인자는 항상 평가되므로, 비용이 비싼 객체를 생성할 때는 반드시 서플라이어(Supplier)를 받는 `orElseGet`을 사용해야 불필요한 연산을 막을 수 있습니다."

  - question: "Optional을 올바르게 사용하는 방법이 아닌 것은?"
    options:
      - "메서드의 반환 타입(Return Type)으로 사용하여 '결과가 없을 수 있음'을 명시한다."
      - "필드(Field)나 파라미터(Parameter)로 사용하여 null 처리를 강제한다."
      - "`ifPresent()`나 `orElseThrow()` 등을 사용하여 안전하게 값을 꺼낸다."
      - "컬렉션은 Optional로 감싸지 않고, 빈 컬렉션(Empty List)을 반환한다."
    answer: 1
    explanation: "Optional을 필드나 파라미터로 쓰면 직렬화 문제와 불필요한 래핑(Wrapping) 오버헤드가 발생하며, 코드 가독성도 떨어집니다. 주로 리턴 타입에만 쓰는 것이 권장됩니다."

  - question: "Stream 파이프라인(`stream().map().forEach()`) 내부에서 외부 리스트에 데이터를 `add()`하는 행위가 위험한 이유는?"
    options:
      - "외부 리스트의 메모리가 부족해지기 때문에"
      - "함수형 프로그래밍의 '부수 효과(Side-effect) 없음' 원칙을 위반하며, 병렬 스트림 실행 시 동시성 문제가 발생하기 때문에"
      - "스트림이 닫히지 않기 때문에"
      - "속도가 너무 빨라서"
    answer: 1
    explanation: "Stream은 데이터를 변환하는 파이프라인이어야 합니다. 결과를 수집하려면 `collect()`를 사용해야 안전하고 병렬 처리도 가능해집니다."

  - question: "서비스 계층(Service Layer)에서 발생한 예외를 컨트롤러(Controller)로 던질 때 가장 좋은 패턴은?"
    options:
      - "모든 예외를 `catch (Exception e)`로 잡아서 무시한다."
      - "기술 예외(예: SQLException)를 그대로 컨트롤러까지 던진다."
      - "적절한 커스텀 예외(또는 런타임 예외)로 변환(Translate)하여 던지고, 글로벌 핸들러(@RestControllerAdvice)에서 일괄 처리한다."
      - "서비스 계층에서 `System.out.println`으로 로그만 찍는다."
    answer: 2
    explanation: "계층 간 경계에서는 구현 기술(DB 등)의 예외를 숨기고, 도메인 의미를 담은 예외로 변환하여 던지는 것이 유지보수와 에러 처리에 유리합니다."

  - question: "다음 중 `try-with-resources` 구문을 사용해야 하는 가장 적절한 상황은?"
    options:
      - "모든 예외 처리에 사용해야 한다."
      - "AutoCloseable 인터페이스를 구현한 리소스(파일, 소켓, DB 연결 등)를 사용할 때 자원 누수를 막기 위해"
      - "성능을 최적화하기 위해"
      - "코드를 짧게 만들기 위해"
    answer: 1
    explanation: "Java 7부터 도입된 `try-with-resources`는 블록이 끝날 때 리소스의 `close()` 메서드를 자동으로 호출해주어 자원 반납을 보장합니다."
study_order: 35
---

## 이 글에서 얻는 것

- “예외를 어디서 잡고 어디서 던질지”를 계층(Controller/Service/Repository)별로 설계할 수 있습니다.
- 체크 예외/런타임 예외를 상황에 따라 선택하고, 예외 전파로 코드가 오염되는 문제를 줄일 수 있습니다.
- `Optional`을 “NPE 회피용 장식”이 아니라, 조회/변환 흐름을 명확하게 만드는 도구로 쓸 수 있습니다.
- `Stream`을 안전하게 쓰는 기준(부수효과/병렬/Null 처리)을 갖출 수 있습니다.

## 1) 예외를 “설계”해야 하는 이유

예외는 단순한 에러 메시지가 아니라, 시스템의 의사결정입니다.

- 어떤 실패는 **복구(재시도)** 할 수 있고, 어떤 실패는 **즉시 중단**해야 합니다.
- 어떤 실패는 사용자에게 **명확한 원인(4xx)** 을 알려야 하고, 어떤 실패는 **내부 문제(5xx)** 로 취급해야 합니다.
- 같은 에러라도 “어디서 로그를 남길지”가 정해져 있지 않으면 로그가 중복되고(또는 누락되고) 장애 분석이 어려워집니다.

## 2) 체크 예외 vs 런타임 예외: 선택 기준

### 체크 예외(Checked Exception)

컴파일러가 처리를 강제합니다. “진짜로 호출자가 복구를 선택할 수 있는 경우”에 의미가 있습니다.

- 예: 파일/네트워크 IO에서 “대체 경로로 다시 시도”, “다른 입력으로 복구” 같은 흐름이 실제로 존재할 때

문제점(실무에서 자주 겪는 것):

- 호출부가 `throws ...`로 도배되거나, 의미 없는 `try/catch`가 늘어서 코드가 오염됩니다.

### 런타임 예외(Runtime Exception)

“복구가 아니라 실패를 전파”하는 쪽에 적합합니다. 백엔드 애플리케이션의 많은 실패는 호출자가 복구할 수 없기 때문에,
서비스 계층에서는 런타임 예외가 자연스럽습니다.

- 예: “사용자를 찾을 수 없음”, “재고 부족”, “권한 없음” 같은 비즈니스 실패
- 예: “DB 연결 실패”, “외부 API 타임아웃” 같은 인프라 실패(대부분 상위에서 공통 처리)

핵심 기준(요약):

- 호출자가 “다른 행동”을 선택할 수 있다 → 체크 예외도 고려
- 대부분의 서비스 로직은 “실패를 전파하고 공통 처리”가 낫다 → 런타임 예외가 기본

## 3) 예외 경계(Boundary)와 예외 변환(Exception Translation)

예외는 계층을 그대로 관통시키기보다, **경계에서 의미 있는 형태로 바꾸는 것**이 유지보수에 유리합니다.

- Repository: JDBC/드라이버/네트워크 같은 기술적 예외가 발생하는 곳
- Service: 도메인/비즈니스 의미로 변환해서 “무슨 실패인지”를 표현하는 곳
- Controller(또는 공통 핸들러): HTTP 응답으로 매핑하는 곳

### 추천 흐름(스프링 기준)

1) Service는 “비즈니스 예외”를 던진다(런타임).  
2) `@RestControllerAdvice`에서 예외를 잡아 에러 응답을 만든다.  
3) 로깅은 “한 번”만 남긴다(보통 공통 핸들러/필터에서 traceId 포함).  

예외와 에러 코드를 분리하면, 응답은 안정적으로 유지하면서 내부 메시지는 더 자세히 남길 수 있습니다.

```java
public enum ErrorCode {
    USER_NOT_FOUND("USER_NOT_FOUND", 404),
    INVALID_REQUEST("INVALID_REQUEST", 400);

    private final String code;
    private final int httpStatus;
    ErrorCode(String code, int httpStatus) { this.code = code; this.httpStatus = httpStatus; }
    public String code() { return code; }
    public int httpStatus() { return httpStatus; }
}

public class BusinessException extends RuntimeException {
    private final ErrorCode errorCode;
    public BusinessException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }
    public ErrorCode errorCode() { return errorCode; }
}
```

## 4) Optional: “없을 수 있음”을 타입으로 드러내기

Optional은 “null을 감추는 도구”가 아니라, **없을 수 있음**을 호출자에게 강제하는 도구입니다.

### 권장 사용 범위

- ✅ “조회 결과”에만 사용하기: `findById()` 같은 메서드
- ✅ 체이닝으로 변환하기: `map/flatMap/filter/orElseThrow`
- ❌ 필드/파라미터/DTO에 Optional을 넣기(직렬화/가독성/사용성 모두 나빠집니다)
- ❌ 컬렉션에 Optional을 쓰기: 컬렉션은 “없음” 대신 “빈 컬렉션”이 자연스럽습니다

```java
User user = userRepository.findById(id)
    .orElseThrow(() -> new BusinessException(ErrorCode.USER_NOT_FOUND, "사용자를 찾을 수 없습니다."));
```

### `orElse` vs `orElseGet` (실무에서 자주 터지는 성능 이슈)

`orElse`는 Optional이 비어있지 않아도 인자를 먼저 평가합니다.

- 대체값 생성이 비싸면 `orElseGet(() -> ...)`를 사용합니다.

## 5) Stream: “변환 파이프라인”으로만 쓰기

Stream은 “루프를 멋지게” 만드는 도구가 아니라, **데이터를 변환하는 파이프라인**입니다.

### 안전한 기준

- 파이프라인 안에서 공유 상태를 바꾸지 않기(부수효과 최소화)
- Null이 섞일 수 있으면 `filter(Objects::nonNull)`로 조기에 정리
- 병렬 스트림은 “CPU 바운드 + 독립 연산”에서만 신중하게 사용(기본은 비추천)

```java
List<String> names = users.stream()
    .map(User::getName)
    .filter(Objects::nonNull)
    .toList(); // Java 16+ : 보통 불변 리스트로 반환됨(수정하려면 새 리스트로 복사)
```

실무에서 루프가 더 나은 경우:

- 예외 처리/로깅/조건 분기가 많아서 파이프라인이 깨지는 경우
- 중간 상태를 디버깅해야 하는 경우

## 연습(추천)

- 스프링에서 `@RestControllerAdvice`로 `BusinessException`을 잡아 `{code, message}` 형태로 응답을 내려보는 예제를 만들어보기
- `Optional` 체이닝으로 “조회 → 변환 → 없으면 예외” 흐름을 2~3개 패턴으로 정리해보기
- Stream 파이프라인에 부수효과를 넣었을 때 어떤 버그가 생기는지(특히 병렬) 일부러 재현해보기

## 추가 학습

- Effective Java: 예외(아이템 69~73), Optional(아이템 55)
