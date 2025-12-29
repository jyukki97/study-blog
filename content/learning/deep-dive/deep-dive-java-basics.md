---
title: "Java 기초: Primitive, Wrapper, String Constant Pool"
date: 2025-12-29
draft: false
topic: "Java"
tags: ["Java", "Memory", "String", "Performance"]
categories: ["Backend Deep Dive"]
description: "원시 타입과 래퍼 클래스의 메모리 차이, 오토박싱의 함정, 그리고 String Pool의 동작 원리까지"
module: "foundation"
study_order: 29
quizzes:
  - question: "Java의 int(Primitive)와 Integer(Wrapper)의 가장 큰 차이점 중 잘못된 설명은?"
    options:
      - "int는 null을 가질 수 없지만, Integer는 null을 가질 수 있다."
      - "int는 스택(Stack) 영역에 값이 저장되지만, Integer는 힙(Heap)에 객체로 저장된다."
      - "List<int>와 같이 제네릭 컬렉션에 원시 타입을 직접 사용할 수 있다."
      - "Integer는 객체이므로 연산 시 오토박싱/언박싱 비용이 발생할 수 있다."
    answer: 2
    explanation: "Java의 제네릭은 Type Erasure 문제로 인해 원시 타입(int)을 직접 담을 수 없고, 반드시 래퍼 클래스(Integer)를 써야 합니다."

  - question: "String a = \"hello\"; String b = \"hello\"; 일 때, (a == b)의 결과와 그 이유는?"
    options:
      - "false, 서로 다른 객체이므로 주소가 다르다."
      - "true, String Constant Pool에 있는 같은 참조를 가리키기 때문이다."
      - "true, String은 equals()가 자동으로 호출되기 때문이다."
      - "false, 리터럴 생성은 항상 새로운 힙 메모리를 할당한다."
    answer: 1
    explanation: "리터럴(\"\")로 생성한 문자열은 Heap 내의 String Constant Pool에 저장되어 공유되므로, 같은 문자열이라면 주소(==)도 같습니다."

  - question: "Java의 파라미터 전달 방식(Call by ...)에 대한 올바른 설명은?"
    options:
      - "Java는 Call by Reference를 완벽하게 지원한다."
      - "원시 타입은 Call by Value, 객체는 Call by Reference로 동작한다."
      - "Java는 항상 Call by Value(값에 의한 전달)이다. 객체는 '참조값(주소)'을 복사해서 전달한다."
      - "상황에 따라 컴파일러가 알아서 결정한다."
    answer: 2
    explanation: "Java는 언제나 값을 복사해서 전달합니다. 객체를 넘길 때도 '객체 자체'가 아니라 '객체를 가리키는 주소값'이 복사되어 전달됩니다."

  - question: "다음 중 오토박싱(Auto-boxing)으로 인해 성능 저하나 `NullPointerException`이 발생할 수 있는 코드는?"
    options:
      - "int a = 10; int b = 20; int sum = a + b;"
      - "Integer a = null; int b = a; // 언박싱 시도"
      - "String s = \"test\";"
      - "if (a == 10) ..."
    answer: 1
    explanation: "Integer가 null일 때 이를 int로 언박싱하려고 하면 `null.intValue()`를 호출하는 셈이 되어 NPE가 발생합니다."

  - question: "String, StringBuilder, StringBuffer의 특징으로 틀린 것은?"
    options:
      - "String은 불변(Immutable) 객체이다."
      - "StringBuffer는 동기화(synchronized)를 지원하여 스레드 안전하다."
      - "StringBuilder는 동기화를 지원하지 않아 StringBuffer보다 빠르다."
      - "문자열 연산(+)이 많을 때는 무조건 String을 사용하는 것이 메모리에 효율적이다."
    answer: 3
    explanation: "String은 불변이므로 + 연산 시마다 새로운 객체가 생성됩니다(Java 9+에서는 최적화되긴 했으나). 반복 루프에서는 StringBuilder가 훨씬 효율적입니다."

  - question: "두 객체의 내용이 같은지 비교하기 위해 오버라이딩(재정의)해야 하는 메서드는?"
    options:
      - "=="
      - "equals()와 hashCode()"
      - "toString()"
      - "clone()"
    answer: 1
    explanation: "동등성(Equality) 비교를 위해 equals()를 재정의해야 하며, 해시 기반 컬렉션(HashMap 등)에서의 동작을 위해 hashCode()도 반드시 같이 재정의해야 합니다."

  - question: "Integer 클래스의 캐싱(Caching) 범위에 포함되어 `==` 비교 시 true가 나올 수 있는 값의 범위는? (기본 설정 기준)"
    options:
      - "-128 ~ 127"
      - "0 ~ 100"
      - "모든 int 범위"
      - "캐싱 기능은 없다"
    answer: 0
    explanation: "Java는 -128부터 127까지의 Integer 객체를 미리 생성해두고(Integer Cache), 이 범위 값은 == 비교 시 같은 객체를 반환합니다."

  - question: "`new String(\"hello\")`로 생성된 문자열에 대해 `intern()` 메서드를 호출하면 어떤 일이 발생하나요?"
    options:
      - "문자열이 삭제된다."
      - "String Constant Pool에서 해당 문자열을 찾아 그 참조를 반환한다(없으면 추가)."
      - "힙 메모리에서 강제로 GC를 수행한다."
      - "문자열을 불변에서 가변으로 바꾼다."
    answer: 1
    explanation: "intern()은 힙에 있는 문자열 객체를 String Pool로 이동시키거나(또는 참조 반환), 풀에 있는 동일한 문자열의 참조를 리턴하여 메모리를 절약합니다."
---

## 이 글에서 얻는 것

- **Primitive와 Wrapper의 메모리 구조 차이**를 알고, 오토박싱으로 인한 숨겨진 비용(NPE, 성능)을 피합니다.
- **String Pool**이 왜 존재하는지 이해하고, `==`와 `equals()`의 차이를 "주소 vs 값" 관점에서 설명할 수 있습니다.
- "Java는 포인터가 없나요?"라는 질문에 **Call by Value** 원리로 정확하게 답할 수 있습니다.

## 1. int vs Integer: 단순함 뒤의 큰 차이

| 구분 | int (Primitive) | Integer (Wrapper Object) |
| :--- | :--- | :--- |
| **저장 위치** | Stack (값 자체) | Heap (객체 헤더 + 값) |
| **Null 가능?** | 불가 (0 초기화) | 가능 (null 허용) |
| **용도** | 연산, 로컬 변수 | 컬렉션(List), DTO, Null 표현 필요 시 |
| **비용** | 매우 저렴 | 객체 생성 + GC 비용 발생 |

### 실무 주의점: 오토박싱(Auto-boxing)과 NPE
편리함을 위해 컴파일러가 변환해주지만, 이게 독이 될 때가 있습니다.

```java
public int calculate(Integer value) {
    return value + 10; // value가 null이면 NullPointerException 터짐!
}
```
`alue`가 객체이므로 `value.intValue()`를 호출하는데, `value`가 null이면 여기서 터집니다.
"DB에서 숫자가 null일 수 있다면" 반드시 Wrapper class를 써야 하지만, 연산 전에는 null 체크가 필수입니다.

## 2. String Constant Pool: `new String`을 쓰지 마세요

```java
String a = "hello"; 
String b = "hello"; 
String c = new String("hello");

System.out.println(a == b); // true (둘 다 Pool의 같은 주소)
System.out.println(a == c); // false (c는 힙에 새로 만든 객체)
```

### 왜 이렇게 만들었을까? (Flyweight Pattern)
포털 사이트 등에서 "HTML" 이라는 문자열은 수백만 번 쓰입니다. 이걸 매번 새 메모리에 할당하면 낭비겠죠?
그래서 **String Pool**이라는 특별한 공간(Heap 내부)에 하나만 두고 공유해서 씁니다.
`new String("...")`은 이 메커니즘을 무시하고 강제로 힙에 만드므로, 메모리 낭비의 주범입니다. (절대 쓰지 마세요)

## 3. Java는 Call by Value일까 Reference일까?

면접 단골 질문이자, 주니어들이 가장 많이 헷갈리는 부분입니다.
**정답: Java는 언제나 Call by Value 입니다.**

### "객체를 넘기면 변경되던데요?"
```java
void modify(Person p) {
    p.setName("New Name"); // 변경됨
}

void swap(Person p1, Person p2) {
    Person temp = p1;
    p1 = p2;
    p2 = temp; // 밖에서는 안 바뀜!
}
```

- 객체를 넘길 때, **"객체의 주소값(Reference)"을 복사해서 전달**하기 때문입니다.
- 복사된 주소(리모컨)를 통해 `setName`을 하면 원본 집의 가구는 바꿀 수 있습니다.
- 하지만 리모컨 자체(`p1`)를 다른 리모컨으로 바꿔도(`swap`), 원본 함수가 가진 리모컨은 그대로입니다.

## 실무 요약
1. 루프 안에서 `String + String` 하지 마세요 (StringBuilder 쓰세요).
2. `Integer` 비교는 반드시 `equals()`로 하세요 (-128~127 캐싱 범위 밖은 `==`이 false입니다).
3. "이 함수 안에서 객체를 new로 바꿔치기해도" 밖에는 영향이 없음을 기억하세요.
