---
title: "JVM 메모리 (Part 1: 구조와 기초)"
date: 2025-12-16
draft: false
topic: "JVM"
tags: ["Java", "JVM", "Memory", "Metaspace", "JIT"]
categories: ["Backend Deep Dive"]
description: "JVM 메모리 영역과 GC Root, OOM/Metaspace/StackOverflow 같은 장애를 빠르게 진단하는 기본기"
module: "foundation"
quizzes:
  - question: "다음 중 JVM의 Runtime Data Area 중 '스레드(Thread) 별로 독립적으로 생성'되는 영역이 아닌 것은?"
    options:
      - "PC Register"
      - "JVM Stack"
      - "Native Method Stack"
      - "Heap Area"
    answer: 3
    explanation: "Heap 영역과 Method Area(Metaspace)는 모든 스레드가 공유하는 영역입니다. 반면 Stack, PC Register, Native Stack은 스레드마다 별도로 생성됩니다."

  - question: "Java 8부터 PermGen 영역이 제거되고 도입된 'Metaspace'의 가장 큰 특징은?"
    options:
      - "Heap 메모리 내부에 존재한다."
      - "JVM이 관리하는 Heap이 아니라, OS가 관리하는 Native Memory 영역을 사용한다."
      - "고정된 크기를 가지며 절대 늘어나지 않는다."
      - "Garbage Collection이 발생하지 않는다."
    answer: 1
    explanation: "Metaspace는 Native Memory를 사용하므로, OS가 허용하는 한도 내에서 유동적으로 크기가 조정될 수 있어 PermGen에 비해 OOM 발생 빈도가 낮아졌습니다."

  - question: "클래스 로더(Class Loader)의 3가지 원칙 중, '하위 로더가 클래스를 로딩하기 전에 상위 로더에게 먼저 요청을 위임하는 것'을 무엇이라 하는가?"
    options:
      - "Visibility Principle (가시성 원칙)"
      - "Uniqueness Principle (유일성 원칙)"
      - "Delegation Principle (위임 원칙)"
      - "Isolation Principle (격리 원칙)"
    answer: 2
    explanation: "위임 원칙(Delegation Principle)에 따라 AppClassLoader -> ExtClassLoader -> BootstrapClassLoader 순으로 위임하며 올라갔다가, 없으면 다시 내려오며 로드합니다."

  - question: "JVM Stack 영역에서 발생할 수 있는 대표적인 에러는?"
    options:
      - "OutOfMemoryError: Java heap space"
      - "StackOverflowError"
      - "NoClassDefFoundError"
      - "NullPointerException"
    answer: 1
    explanation: "메서드 호출 시마다 스택 프레임이 쌓이는데, 재귀 호출 등으로 스택 깊이가 허용치를 초과하면 `StackOverflowError`가 발생합니다."

  - question: "Execution Engine의 JIT(Just-In-Time) 컴파일러가 하는 주된 역할은?"
    options:
      - "자바 소스 코드(.java)를 바이트코드(.class)로 컴파일한다."
      - "바이트코드를 한 줄씩 해석하여 실행한다."
      - "자주 실행되는 바이트코드(Hot Spot)를 파악하여 기계어(Native Code)로 컴파일하고 캐싱한다."
      - "Garbage Collection을 수행한다."
    answer: 2
    explanation: "JIT는 인터프리터 방식의 단점을 보완하기 위해, 반복되는 코드를 네이티브 코드로 변환해두고 재사용하여 실행 속도를 높입니다."

  - question: "Heap 영역에서 객체가 생성된 직후 가장 먼저 저장되는 공간은?"
    options:
      - "Old Generation"
      - "Eden Space"
      - "Survivor 0"
      - "Survivor 1"
    answer: 1
    explanation: "대부분의 객체는 Young Generation의 Eden 영역에 처음 할당됩니다. 여기서 GC 후 살아남으면 Survivor 영역으로 이동합니다."

  - question: "다음 중 `static` 변수와 클래스 메타데이터가 저장되는 메모리 영역은?"
    options:
      - "Heap Area"
      - "JVM Stack"
      - "Method Area (Metaspace)"
      - "PC Register"
    answer: 2
    explanation: "클래스 정보, 상수(Constant Pool), static 변수 등은 Method Area(Java 8+에서는 Metaspace)에 저장되어 공유됩니다."

  - question: "스택 프레임(Stack Frame) 내부에 저장되지 않는 정보는?"
    options:
      - "Local Variables (지역 변수)"
      - "Operand Stack (피연산자 스택)"
      - "Return Address (복귀 주소)"
      - "Heap Object 자체"
    answer: 3
    explanation: "객체 인스턴스 자체는 Heap에 저장되며, 스택 프레임의 지역 변수에는 그 객체를 가리키는 '참조값(Reference)'만 저장됩니다."
study_order: 40
---

## 이 글에서 얻는 것

- JVM의 메모리 영역(Runtime Data Areas: Stack/Heap/Metaspace)을 “정의”가 아니라 **장애/성능 문제와 연결된 모델**로 이해합니다.
- `OutOfMemoryError`가 “힙 부족”만이 아니라, **Metaspace/Direct Memory/Thread Stack** 등 여러 원인으로 나뉜다는 감각을 잡습니다.
- heap dump / thread dump / GC 로그를 어떤 순서로 보면 되는지, 최소한의 디버깅 루틴을 갖춥니다.

## 0) 이 주제가 필요한 순간(실무 신호)

아래 신호가 보이면 JVM 메모리 모델이 “필수”가 됩니다.

- 갑자기 응답이 느려지고 GC 로그에 pause가 길어진다
- `java.lang.OutOfMemoryError: Java heap space` / `Metaspace` / `GC overhead limit exceeded`
- `StackOverflowError`가 특정 요청/작업에서 반복된다
- 컨테이너(K8s)에서 메모리 제한에 걸려 OOMKilled가 난다(힙만 봐서는 해결이 안 됨)

## 1. JVM 아키텍처 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                    Java Application                      │
└────────────────────────┬────────────────────────────────┘
                         │ .class files
┌────────────────────────▼────────────────────────────────┐
│                   JVM (Java Virtual Machine)             │
│                                                          │
│  ┌────────────────────────────────────────────────┐     │
│  │          1. Class Loader Subsystem             │     │
│  │  - Loading → Linking → Initialization          │     │
│  └────────────────────┬───────────────────────────┘     │
│                       │ Loaded Classes                   │
│  ┌────────────────────▼───────────────────────────┐     │
│  │          2. Runtime Data Areas                 │     │
│  │                                                 │     │
│  │  ┌──────────────┐  ┌──────────────┐           │     │
│  │  │ Method Area  │  │     Heap     │           │     │
│  │  │ (Metaspace)  │  │ (Young/Old)  │           │     │
│  │  └──────────────┘  └──────────────┘           │     │
│  │                                                 │     │
│  │  ┌──────────────┐  ┌──────────────┐           │     │
│  │  │   PC Register│  │  JVM Stack   │           │     │
│  │  └──────────────┘  └──────────────┘           │     │
│  │                                                 │     │
│  │  ┌──────────────┐                              │     │
│  │  │ Native Stack │                              │     │
│  │  └──────────────┘                              │     │
│  └────────────────────┬───────────────────────────┘     │
│                       │ Bytecode                         │
│  ┌────────────────────▼───────────────────────────┐     │
│  │          3. Execution Engine                   │     │
│  │  - Interpreter                                 │     │
│  │  - JIT Compiler (C1, C2)                       │     │
│  │  - Garbage Collector                           │     │
│  └────────────────────┬───────────────────────────┘     │
│                       │ Native Method                    │
│  ┌────────────────────▼───────────────────────────┐     │
│  │      4. Java Native Interface (JNI)            │     │
│  └────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              Native Method Libraries                     │
│              (C/C++ Libraries)                           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Class Loader Subsystem

### 2.1 Class Loading 3단계

**1단계: Loading (로딩)**

```java
// Example: Class Loading 과정
public class Main {
    public static void main(String[] args) {
        // 1. Bootstrap ClassLoader: java.lang.String (JDK 클래스)
        String str = "Hello";

        // 2. Extension ClassLoader: javax.* (확장 클래스)
        // java.util.logging.Logger

        // 3. Application ClassLoader: 사용자 정의 클래스
        User user = new User();  // User.class 로딩
    }
}
```

**ClassLoader 계층 구조:**
```
┌─────────────────────────┐
│ Bootstrap ClassLoader   │  ← JDK 기본 클래스 (rt.jar)
│ (Native C++)            │     java.lang.*, java.util.*
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ Extension ClassLoader   │  ← 확장 클래스 (jre/lib/ext)
│ (sun.misc.Launcher)     │     javax.*, org.xml.*
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ Application ClassLoader │  ← 사용자 클래스 (Classpath)
│ (sun.misc.Launcher)     │     com.example.*
└──────────┬──────────────┘
           │
┌──────────▼──────────────┐
│ Custom ClassLoader      │  ← 사용자 정의
│ (User Defined)          │     Plugin, Hot Reload
└─────────────────────────┘
```

**ClassLoader 동작 확인:**
```java
public class ClassLoaderDemo {
    public static void main(String[] args) {
        // 1. Bootstrap ClassLoader (null 반환)
        ClassLoader stringLoader = String.class.getClassLoader();
        System.out.println("String ClassLoader: " + stringLoader);  // null

        // 2. Extension ClassLoader
        ClassLoader extLoader = com.sun.crypto.provider.DESKeyFactory.class.getClassLoader();
        System.out.println("Extension ClassLoader: " + extLoader);
        // sun.misc.Launcher$ExtClassLoader

        // 3. Application ClassLoader
        ClassLoader appLoader = ClassLoaderDemo.class.getClassLoader();
        System.out.println("Application ClassLoader: " + appLoader);
        // sun.misc.Launcher$AppClassLoader

        // 4. 부모 ClassLoader 조회
        System.out.println("App ClassLoader Parent: " + appLoader.getParent());
        // Extension ClassLoader
    }
}
```

**2단계: Linking (연결)**

```
Linking 3단계:

1. Verification (검증)
   - Bytecode Verifier가 .class 파일 검증
   - 올바른 형식인지, 보안 위반 없는지 확인
   - 예: final 클래스 상속 시도 → VerifyError

2. Preparation (준비)
   - static 변수에 메모리 할당 (Method Area)
   - 기본값으로 초기화 (int = 0, boolean = false)

3. Resolution (해석)
   - Symbolic Reference → Direct Reference 변환
   - 예: "com/example/User" → Heap의 실제 주소
```

**예제:**
```java
public class LinkingExample {
    static int count = 10;  // Preparation: count = 0
                            // Initialization: count = 10

    public static void main(String[] args) {
        System.out.println(count);  // 10
    }
}
```

**3단계: Initialization (초기화)**

```java
public class InitializationOrder {
    // 1. static 변수 선언 및 초기화
    static int x = 10;

    // 2. static 블록 실행
    static {
        System.out.println("Static block executed");
        x = 20;
    }

    // 3. 인스턴스 변수
    int y = 30;

    // 4. 인스턴스 초기화 블록
    {
        System.out.println("Instance block executed");
        y = 40;
    }

    // 5. 생성자
    public InitializationOrder() {
        System.out.println("Constructor executed");
        y = 50;
    }

    public static void main(String[] args) {
        System.out.println("Main method");
        new InitializationOrder();
    }
}

// 출력 순서:
// Static block executed
// Main method
// Instance block executed
// Constructor executed
```

### 2.2 ClassLoader 원칙

**1. Delegation Principle (위임 원칙)**

```java
// ClassLoader는 항상 부모에게 먼저 위임
public Class<?> loadClass(String name) throws ClassNotFoundException {
    // 1. 이미 로드되었는지 확인
    Class<?> c = findLoadedClass(name);
    if (c == null) {
        // 2. 부모 ClassLoader에게 위임
        if (parent != null) {
            c = parent.loadClass(name);
        } else {
            // 3. Bootstrap ClassLoader
            c = findBootstrapClass(name);
        }
        if (c == null) {
            // 4. 부모가 로드 실패 → 본인이 로드
            c = findClass(name);
        }
    }
    return c;
}
```

**2. Visibility Principle (가시성 원칙)**

```
하위 ClassLoader는 상위의 클래스를 볼 수 있지만,
상위는 하위의 클래스를 볼 수 없다.

Application ClassLoader → Extension ClassLoader 클래스 접근 가능 ✅
Extension ClassLoader → Application ClassLoader 클래스 접근 불가 ❌
```

**3. Uniqueness Principle (유일성 원칙)**

```java
// 같은 ClassLoader가 동일한 클래스를 2번 로드하지 않음
Class<?> class1 = classLoader.loadClass("com.example.User");
Class<?> class2 = classLoader.loadClass("com.example.User");

System.out.println(class1 == class2);  // true (같은 인스턴스)
```

---


---

👉 **[다음 편: JVM 메모리 (Part 2: Runtime Data Areas, GC)](/learning/deep-dive/deep-dive-jvm-memory-part2/)**
