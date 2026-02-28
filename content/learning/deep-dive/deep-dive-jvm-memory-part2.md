---
title: "JVM 메모리 (Part 2: Runtime Data Areas, GC)"
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

## 3. Runtime Data Areas

### 3.1 Method Area (Metaspace - Java 8+)

**저장 내용:**
- 클래스 메타데이터 (클래스명, 부모 클래스, 인터페이스)
- static 변수
- 메서드 정보 (메서드명, 반환 타입, 파라미터)
- 상수 풀 (Constant Pool)

```java
public class MethodAreaExample {
    // Method Area에 저장
    static int staticVar = 100;
    static final String CONSTANT = "Hello";

    public void method() {
        // 메서드 정보도 Method Area에 저장
    }
}
```

**Java 7 vs Java 8 변화:**

```
Java 7 (PermGen):
┌─────────────┐
│   Heap      │
├─────────────┤
│   PermGen   │  ← 고정 크기 (-XX:PermSize, -XX:MaxPermSize)
│  - Classes  │     OutOfMemoryError: PermGen space
│  - Strings  │
└─────────────┘

Java 8+ (Metaspace):
┌─────────────┐
│   Heap      │  ← String Pool 이동
└─────────────┘
┌─────────────┐
│  Metaspace  │  ← Native Memory (동적 크기)
│  - Classes  │     -XX:MetaspaceSize, -XX:MaxMetaspaceSize
└─────────────┘
```

**JVM 옵션:**
```bash
# Java 8+
-XX:MetaspaceSize=128m      # 초기 크기
-XX:MaxMetaspaceSize=512m   # 최대 크기

# Metaspace 모니터링
jstat -gc <pid>
```

### 3.2 Heap (힙 영역)

**구조 (Generational Heap):**

```
┌─────────────────────────────────────────────────────────┐
│                        Heap                              │
│                                                          │
│  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │      Young Generation     │  │   Old Generation     │ │
│  │                           │  │                      │ │
│  │  ┌──────┐  ┌───────────┐ │  │                      │ │
│  │  │ Eden │  │ Survivor  │ │  │   Tenured (장기)     │ │
│  │  │      │  │  S0 │ S1  │ │  │                      │ │
│  │  └──────┘  └───────────┘ │  │                      │ │
│  │   (새 객체)   (임시 보관) │  │   (오래된 객체)       │ │
│  └──────────────────────────┘  └──────────────────────┘ │
│           ▲                              ▲               │
│           │ Minor GC                     │ Major GC      │
└───────────┼──────────────────────────────┼───────────────┘
            │                              │
       빠르고 빈번                      느리고 드물게
```

**객체 생성 흐름:**

```java
public class HeapAllocationExample {
    public static void main(String[] args) {
        // 1. Eden 영역에 객체 생성
        User user1 = new User("Alice");

        // 2. Eden이 가득 차면 Minor GC 발생
        for (int i = 0; i < 1000000; i++) {
            User temp = new User("User" + i);
            // Eden → Survivor 0 이동
        }

        // 3. 여러 번 Minor GC 생존 → Old Generation 이동
        // user1 참조가 계속 유지 → Old로 Promotion
    }
}
```

**Age-based Promotion:**
```
Eden → S0 → S1 → S0 → ... (15번 반복) → Old Generation

객체의 Age:
- Minor GC 때마다 Age + 1
- -XX:MaxTenuringThreshold=15 (기본값)
- Age >= 15 → Old Generation 이동
```

**JVM 힙 옵션:**
```bash
# Heap 크기 설정
-Xms2g              # 초기 Heap 크기
-Xmx4g              # 최대 Heap 크기

# Young/Old Generation 비율
-XX:NewRatio=2      # Old:Young = 2:1
-XX:SurvivorRatio=8 # Eden:Survivor = 8:1:1

# 예시: -Xmx4g -XX:NewRatio=2
# Heap 4GB → Young 1.33GB, Old 2.67GB
# Young 1.33GB → Eden 1.07GB, S0 133MB, S1 133MB
```

### 3.3 JVM Stack (스택 영역)

**구조:**

```
Thread 1 Stack          Thread 2 Stack
┌─────────────┐        ┌─────────────┐
│ Frame 3     │        │ Frame 2     │
├─────────────┤        ├─────────────┤
│ Frame 2     │        │ Frame 1     │
├─────────────┤        └─────────────┘
│ Frame 1     │
└─────────────┘

각 Frame 구조:
┌─────────────────────────┐
│   Local Variables       │  ← 지역 변수, 매개변수
├─────────────────────────┤
│   Operand Stack         │  ← 연산 중간 결과
├─────────────────────────┤
│   Frame Data            │  ← 메서드 정보, 리턴 주소
└─────────────────────────┘
```

**예제:**
```java
public class StackExample {
    public static void main(String[] args) {  // Frame 1
        int x = 10;  // Local Variable
        int result = add(x, 20);  // Frame 2 생성
        System.out.println(result);
    }  // Frame 1 pop

    public static int add(int a, int b) {  // Frame 2
        int sum = a + b;  // Local Variable
        return sum;  // Frame 2 pop, 결과를 Frame 1의 Operand Stack으로
    }
}
```

**Stack 메모리 흐름:**
```
1. main() 호출 → Frame 1 push
   Local Variables: args, x=10, result=?

2. add(10, 20) 호출 → Frame 2 push
   Local Variables: a=10, b=20, sum=30
   Operand Stack: 30 (리턴값)

3. add() 종료 → Frame 2 pop
   result = 30 (Operand Stack에서 가져옴)

4. main() 종료 → Frame 1 pop
```

**StackOverflowError:**
```java
public class StackOverflowExample {
    public static void main(String[] args) {
        recursiveMethod(0);
    }

    public static void recursiveMethod(int depth) {
        System.out.println("Depth: " + depth);
        recursiveMethod(depth + 1);  // 무한 재귀
        // StackOverflowError 발생!
    }
}

// JVM 옵션으로 Stack 크기 조정
// -Xss1m (기본값: 1MB)
```

### 3.4 PC Register (Program Counter)

**역할:**
- 현재 실행 중인 JVM 명령어 주소 저장
- 각 스레드마다 독립적으로 존재

```java
public class PCRegisterExample {
    public static void main(String[] args) {
        int a = 10;     // PC: 라인 3
        int b = 20;     // PC: 라인 4
        int c = a + b;  // PC: 라인 5
        // PC Register는 다음에 실행할 명령어 주소를 가리킴
    }
}
```

**Bytecode로 보는 PC:**
```
Bytecode:
0: bipush 10      ← PC = 0
2: istore_1       ← PC = 2
3: bipush 20      ← PC = 3
5: istore_2       ← PC = 5
6: iload_1        ← PC = 6
7: iload_2        ← PC = 7
8: iadd           ← PC = 8
9: istore_3       ← PC = 9
```

### 3.5 Native Method Stack

**JNI (Java Native Interface) 호출 시 사용:**

```java
public class NativeMethodExample {
    // Native 메서드 선언
    public native void nativeMethod();

    static {
        // C/C++ 라이브러리 로드
        System.loadLibrary("native-lib");
    }

    public static void main(String[] args) {
        new NativeMethodExample().nativeMethod();
        // Native Method Stack 사용
    }
}
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: JVM 메모리 (Part 1: 구조와 기초)](/learning/deep-dive/deep-dive-jvm-memory/)**
