---
title: "Java 개발자를 위한 Kotlin: NPE 종말과 코루틴 혁명"
date: 2025-12-28
draft: false
topic: "Modern Tech"
tags: ["Kotlin", "Coroutines", "Null Safety", "Backend"]
categories: ["Backend Deep Dive"]
description: "Lombok 없이도 간결한 코드를 작성하고, 스레드 지옥에서 벗어나 코루틴의 세계로."
module: "modern-frontiers"
study_order: 1001
---

## 이 글에서 얻는 것

- **Java**의 고질적인 `NullPointerException`이 Kotlin에서 어떻게 시스템적으로 사라지는지 봅니다.
- `data class`, `extension function`으로 코드가 얼마나 간결해지는지 체험합니다.
- **Thread**와 **Coroutine**의 메모리/비용 차이를 이해합니다.

## 0) 왜 Kotlin인가?

많은 자바 개발자가 "굳이?"라고 묻지만, 한 번 써보면 돌아가기 힘듭니다.
가장 큰 이유는 **"생산성"**과 **"안전성"**입니다.

## 1) Null Safety (10억 불짜리 실수 해결)

Java에서는 모든 것이 Null일 수 있어서 방어 코드가 필수였습니다.
Kotlin은 타입 시스템 레벨에서 Null 가능성을 분리합니다.

```kotlin
// Java
String name = null; // 가능
int len = name.length(); // NPE 발생! 💥

// Kotlin
var name: String = "Alice"
// name = null // 컴파일 에러! 🚫 (Non-null 타입)

var nullableName: String? = "Alice"
nullableName = null // 가능
// println(nullableName.length) // 컴파일 에러! 🚫 (Null 체크 강제)
println(nullableName?.length) // Safe Call (null이면 null 반환)
```

## 2) Data Class: Lombok이 필요 없다

Java의 지루한 DTO/VO 생성을 한 줄로 끝냅니다.

```kotlin
// Java (Lombok 써도 어노테이션 덕지덕지)
public class User {
    private String name;
    private int age;
    // getters, setters, equals, hashCode, toString...
}

// Kotlin
data class User(val name: String, val age: Int)
```

`data class`는 `equals()`, `hashCode()`, `toString()`, `copy()`를 컴파일러가 알아서 만들어줍니다.

## 3) Coroutines: 스레드는 무겁다

Java의 Thread는 OS 커널 스레드와 1:1 매핑됩니다.
스레드 하나가 약 **1MB** 메모리를 먹습니다. 1만 개만 만들어도 10GB가 필요합니다.

Kotlin Coroutines는 **"Lightweight Threads"**입니다. KB 단위 메모리만 소모하며, 하나의 스레드 위에서 수많은 코루틴이 점프하며 실행됩니다.

```mermaid
block-beta
  columns 3
  block:os_threads
    T1["OS Thread 1"]
    T2["OS Thread 2"]
  end
  space
  block:tasks
    C1["Coroutine 1"]
    C2["Coroutine 2..."]
    C3["Coroutine 1000"]
  end

  T1 --> C1
  T1 --> C2
  T2 --> C3

  style os_threads fill:#e3f2fd,stroke:#1565c0
  style tasks fill:#f3e5f5,stroke:#7b1fa2
```

- **Suspend Function**: "잠시 멈추고(suspend), 다른 코루틴에 자리를 양보한다."
- Blocking 방식처럼 코드를 짜지만, 실제로는 **Non-blocking**으로 동작합니다.

## 4) Extension Functions (확장 함수)

상속받지 않고도 남의 클래스에 기능을 추가할 수 있습니다.

```kotlin
// String 클래스에 lastChar 기능 추가
fun String.lastChar(): Char = this.get(this.length - 1)

val s = "Kotlin"
println(s.lastChar()) // 'n'
```

## 요약

1.  **Null Safety**: 컴파일 시점에 NPE를 99% 차단.
2.  **Conciseness**: 코드가 간결해지고 읽기 쉬워짐.
3.  **Coroutines**: 비동기 프로그래밍을 동기 코드처럼 작성 가능.

## 다음 단계

- **Spring WebFlux**: Kotlin Coroutine과 함께 리액티브 웹 개발하기.
