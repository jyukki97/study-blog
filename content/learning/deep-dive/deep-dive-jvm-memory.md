---
title: "JVM 메모리 구조: 스택/힙/메타스페이스와 장애 디버깅"
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

## 4. Execution Engine

### 4.1 Interpreter vs JIT Compiler

**Interpreter (인터프리터):**
```
┌──────────────┐
│  Bytecode    │ → Interpreter → 기계어 실행
└──────────────┘
   라인 단위로 즉시 해석 및 실행
   장점: 빠른 시작
   단점: 반복 실행 시 느림
```

**JIT Compiler (Just-In-Time Compiler):**
```
┌──────────────┐
│  Bytecode    │ → JIT Compiler → Native Code → 실행
└──────────────┘                   (캐싱)
   자주 실행되는 코드(Hot Spot)를 기계어로 컴파일
   장점: 반복 실행 시 빠름
   단점: 컴파일 오버헤드
```

**HotSpot JVM 동작:**
```java
public class JITExample {
    public static void main(String[] args) {
        // 1. 처음 몇 번은 Interpreter로 실행
        for (int i = 0; i < 100; i++) {
            calculate(i);
        }

        // 2. 임계값 도달 → JIT Compiler 동작
        // calculate() 메서드가 Native Code로 컴파일

        // 3. 이후 호출은 컴파일된 코드 실행 (매우 빠름)
        for (int i = 0; i < 1000000; i++) {
            calculate(i);
        }
    }

    public static int calculate(int n) {
        return n * n + n;
    }
}

// JVM 옵션
// -XX:CompileThreshold=10000  (기본값: C1=1500, C2=10000)
```

**C1 vs C2 Compiler:**
```
C1 (Client Compiler):
- 빠른 컴파일
- 낮은 최적화
- 시작 시간 중요한 애플리케이션

C2 (Server Compiler):
- 느린 컴파일
- 높은 최적화 (인라이닝, 루프 최적화 등)
- 장시간 실행되는 서버 애플리케이션

Tiered Compilation (Java 8+):
Interpreter → C1 → C2 (단계적 최적화)
```

### 4.2 JIT Compiler 최적화 기법

**1. Method Inlining (메서드 인라이닝):**
```java
// 원본 코드
public int add(int a, int b) {
    return a + b;
}

public void calculate() {
    int result = add(10, 20);
}

// JIT Compiler 최적화 후
public void calculate() {
    int result = 10 + 20;  // 메서드 호출 제거
}
```

**2. Dead Code Elimination (데드 코드 제거):**
```java
// 원본
public void method() {
    int x = 10;
    int y = 20;  // 사용되지 않음
    System.out.println(x);
}

// 최적화 후
public void method() {
    int x = 10;
    System.out.println(x);
}
```

**3. Loop Unrolling (루프 언롤링):**
```java
// 원본
for (int i = 0; i < 4; i++) {
    array[i] = i;
}

// 최적화 후
array[0] = 0;
array[1] = 1;
array[2] = 2;
array[3] = 3;
```

---

## 5. 메모리 누수 예방 및 디버깅

### 5.1 흔한 메모리 누수 패턴

**1. Static 컬렉션:**
```java
// ❌ 메모리 누수
public class CacheManager {
    private static Map<String, Object> cache = new HashMap<>();

    public void addToCache(String key, Object value) {
        cache.put(key, value);
        // cache는 절대 비워지지 않음 → 메모리 누수
    }
}

// ✅ 해결: SoftReference 사용
public class CacheManager {
    private static Map<String, SoftReference<Object>> cache = new HashMap<>();

    public void addToCache(String key, Object value) {
        cache.put(key, new SoftReference<>(value));
        // 메모리 부족 시 GC가 자동으로 제거
    }
}
```

**2. Listener 미제거:**
```java
// ❌ 메모리 누수
public class EventSource {
    private List<Listener> listeners = new ArrayList<>();

    public void addEventListener(Listener listener) {
        listeners.add(listener);
        // removeEventListener() 호출 안 하면 누수
    }
}

// ✅ 해결: WeakHashMap 사용
public class EventSource {
    private Map<Listener, Object> listeners = new WeakHashMap<>();

    public void addEventListener(Listener listener) {
        listeners.put(listener, null);
        // Listener가 외부에서 참조 해제되면 자동 제거
    }
}
```

**3. ThreadLocal 미정리:**
```java
// ❌ 메모리 누수 (ThreadPool 환경)
public class UserContext {
    private static ThreadLocal<User> currentUser = new ThreadLocal<>();

    public static void setUser(User user) {
        currentUser.set(user);
        // remove() 호출 안 하면 Thread 재사용 시 누수
    }
}

// ✅ 해결: finally에서 제거
public class UserContext {
    private static ThreadLocal<User> currentUser = new ThreadLocal<>();

    public static void setUser(User user) {
        currentUser.set(user);
    }

    public static void clear() {
        currentUser.remove();  // ✅ 필수
    }

    // Filter나 Interceptor에서 사용
    public void doFilter(Request req, Response res) {
        try {
            setUser(extractUser(req));
            // 요청 처리
        } finally {
            clear();  // ✅ 반드시 호출
        }
    }
}
```

### 5.2 메모리 디버깅 도구

**1. jmap (Heap Dump):**
```bash
# Heap Dump 생성
jmap -dump:format=b,file=heap.bin <pid>

# Heap 사용량 확인
jmap -heap <pid>

# Heap Histogram
jmap -histo <pid> | head -20
```

**2. jstat (GC 모니터링):**
```bash
# GC 통계 (1초마다 출력)
jstat -gc <pid> 1000

# 출력 예시:
S0C    S1C    S0U    S1U      EC       EU        OC         OU       MC     MU
10240  10240  0      9216    81920    61440    163840     81920   51200  49152

# S0C: Survivor 0 Capacity
# EU: Eden Used
# OU: Old Used
```

**3. VisualVM / JProfiler:**
```
Heap 사용량 시각화
GC 활동 모니터링
CPU 프로파일링
스레드 덤프 분석
```

**4. Eclipse MAT (Memory Analyzer Tool):**
```
Heap Dump 분석
메모리 누수 원인 파악
Dominator Tree (가장 많은 메모리 차지하는 객체)
Leak Suspects (메모리 누수 의심 객체)
```

---

## 6. JVM 튜닝 가이드

### 6.1 Heap 크기 설정

```bash
# 기본 설정
-Xms2g -Xmx4g

# 권장 사항:
# 1. -Xms와 -Xmx를 동일하게 (Heap 리사이징 오버헤드 제거)
-Xms4g -Xmx4g

# 2. Young Generation 크기
-Xmn1g  # Young = 1GB, Old = 3GB

# 3. Survivor 비율
-XX:SurvivorRatio=8  # Eden:S0:S1 = 8:1:1
```

### 6.2 GC 알고리즘 선택

```bash
# Serial GC (단일 스레드)
-XX:+UseSerialGC

# Parallel GC (멀티 스레드, Throughput 중시)
-XX:+UseParallelGC
-XX:ParallelGCThreads=4

# CMS GC (Low Latency, Deprecated in Java 14)
-XX:+UseConcMarkSweepGC

# G1 GC (Java 9+ 기본, Balanced)
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200  # 목표 pause time

# ZGC (Java 15+, Ultra-low Latency)
-XX:+UseZGC
```

### 6.3 GC 로깅

```bash
# Java 8
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:gc.log

# Java 9+
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

---

## 7. 실무 활용 시나리오

### 시나리오 1: OutOfMemoryError 해결

**증상:**
```
java.lang.OutOfMemoryError: Java heap space
```

**해결 과정:**
```bash
# 1. Heap Dump 생성
jmap -dump:live,format=b,file=heap.bin <pid>

# 2. Eclipse MAT로 분석
# Leak Suspects Report 확인

# 3. 원인 파악 예시
# → ArrayList에 1000만 개 객체 누적
# → Static 변수로 유지되어 GC 대상 아님

# 4. 코드 수정
# Before:
private static List<Data> cache = new ArrayList<>();

# After:
private static SoftReference<List<Data>> cache =
    new SoftReference<>(new ArrayList<>());
```

### 시나리오 2: Full GC 빈발

**증상:**
```
Full GC 1분에 10회 발생 → 응답 지연
```

**해결:**
```bash
# 1. GC 로그 분석
jstat -gcutil <pid> 1000

# 2. Old Generation 사용률 80% 이상
# → Heap 크기 증가 또는 객체 생명주기 단축

# 3. Young Generation 크기 증가
-Xmn2g  # Young을 크게 → Minor GC 빈도 감소

# 4. GC 알고리즘 변경
-XX:+UseG1GC  # CMS → G1GC
-XX:MaxGCPauseMillis=100  # Pause time 목표
```

---

## 요약: 꼭 남겨야 하는 감각

### JVM 아키텍처(큰 그림)

- Class Loader Subsystem(Loading → Linking → Initialization)
- Runtime Data Areas(Method Area/Heap/Stack/PC/Native Stack)
- Execution Engine(Interpreter/JIT/GC)

### 메모리 영역(무엇이 어디에 있나)

- Method Area/Metaspace: 클래스 메타데이터, 일부 static 영역
- Heap: 객체 인스턴스(Young/Old)
- Stack: 호출 프레임/지역 변수(스레드별)
- PC Register: 현재 실행 중인 명령어 위치(스레드별)

### 운영 관점(문제 좁히기)

- 힙 OOM만이 아니라 Metaspace/Direct/Stack 같은 다양한 메모리 한계가 있다
- GC 로그/heap dump/thread dump를 조합하면 원인을 빨리 좁힐 수 있다
- 플래그 튜닝은 마지막이고, “할당/생존/구조”를 먼저 본다
