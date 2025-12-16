---
title: "JVM 내부 구조 정리"
date: 2025-01-19
topic: "Java"
topic_icon: "💬"
topic_description: "ClassLoader, JIT, Thread 관리, Safepoint 관련 핵심 개념과 실전 예제 정리"
tags: ["Java", "JVM", "ClassLoader", "JIT"]
categories: ["Java"]
draft: false
module: "qna"
---

## Q1. JVM의 구조를 설명해주세요.

### 답변

JVM은 크게 **Class Loader**, **Runtime Data Area**, **Execution Engine**으로 구성됩니다.

```
┌─────────────────────────────────────────────┐
│           Java Application                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│         Class Loader Subsystem              │
│  ┌──────────┬──────────┬──────────┐         │
│  │Bootstrap │Extension │Application│         │
│  │ Loader   │ Loader   │ Loader    │         │
│  └──────────┴──────────┴──────────┘         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│      Runtime Data Area                      │
│  ┌───────────┬─────────┬──────────┐         │
│  │  Method   │  Heap   │  Stack   │         │
│  │   Area    │         │(per thread)        │
│  └───────────┴─────────┴──────────┘         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│        Execution Engine                     │
│  ┌──────────────┬───────────────┐           │
│  │ Interpreter  │  JIT Compiler │           │
│  └──────────────┴───────────────┘           │
│  ┌──────────────────────────────┐           │
│  │   Garbage Collector          │           │
│  └──────────────────────────────┘           │
└─────────────────────────────────────────────┘
```

**각 영역 역할**:
- **Class Loader**: .class 파일을 메모리에 로드
- **Runtime Data Area**: 실행 시 필요한 데이터 저장
- **Execution Engine**: 바이트코드를 기계어로 변환하여 실행

---

## Q2. ClassLoader의 동작 원리와 종류를 설명해주세요.

### 답변

**ClassLoader 계층 구조**:

```
Bootstrap ClassLoader (Native)
    ↓
Extension ClassLoader
    ↓
Application ClassLoader
    ↓
Custom ClassLoader (사용자 정의)
```

**각 ClassLoader 역할**:

| ClassLoader | 로드 대상 | 위치 |
|-------------|---------|------|
| Bootstrap | JDK 핵심 클래스 (java.lang.*) | jre/lib/rt.jar |
| Extension | 확장 클래스 (javax.*) | jre/lib/ext/*.jar |
| Application | 애플리케이션 클래스 | CLASSPATH |

**클래스 로딩 과정 (Delegation Model)**:

1. **Loading**: .class 파일을 바이트 배열로 읽어 Method Area에 저장
2. **Linking**:
   - **Verify**: 바이트코드 검증
   - **Prepare**: static 변수 메모리 할당 및 기본값 초기화
   - **Resolve**: Symbolic Reference를 Direct Reference로 변환
3. **Initialization**: static 초기화 블록 실행

**위임 모델 (Delegation Model)**:

```java
// 클래스 로딩 요청
MyClass obj = new MyClass();

// 1. Application ClassLoader가 먼저 받음
// 2. Extension ClassLoader에게 위임
// 3. Bootstrap ClassLoader에게 위임
// 4. Bootstrap이 찾지 못하면 Extension이 시도
// 5. Extension이 찾지 못하면 Application이 시도
// 6. 모두 실패하면 ClassNotFoundException
```

### 꼬리 질문 1: 왜 위임 모델을 사용하나요?

**답변**:

**보안**: 핵심 클래스를 사용자가 교체하지 못하도록 방지

```java
// 악의적인 코드
package java.lang;

public class String {
    // 가짜 String 클래스
}
```

위임 모델 덕분에 Bootstrap ClassLoader가 먼저 실제 `java.lang.String`을 로드하므로, 사용자 정의 String은 무시됩니다.

### 꼬리 질문 2: Custom ClassLoader는 언제 사용하나요?

**답변**:

**사용 사례**:
- Hot Deployment (재시작 없이 클래스 교체)
- 플러그인 시스템
- 동적 코드 생성 (CGLIB, Javassist)

**실무 예시**:

```java
public class PluginClassLoader extends URLClassLoader {
    public PluginClassLoader(URL[] urls) {
        super(urls, ClassLoader.getSystemClassLoader());
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve)
            throws ClassNotFoundException {
        // 플러그인 클래스는 부모에게 위임하지 않고 직접 로드
        if (name.startsWith("com.example.plugin")) {
            return findClass(name);
        }
        return super.loadClass(name, resolve);
    }
}
```

---

## Q3. JIT(Just-In-Time) 컴파일러란 무엇이며, 어떻게 동작하나요?

### 답변

JIT 컴파일러는 **자주 실행되는 바이트코드를 네이티브 코드로 컴파일**하여 성능을 향상시킵니다.

**Interpreter vs JIT**:

```
Interpreter (초기 실행)
  바이트코드 → 한 줄씩 해석 실행 (느림)

JIT Compiler (반복 실행 후)
  바이트코드 → 네이티브 코드로 컴파일 → 캐싱 → 직접 실행 (빠름)
```

**HotSpot JVM의 JIT 전략**:

1. **처음**: Interpreter로 실행하며 실행 빈도 측정
2. **임계값 도달**: JIT 컴파일 트리거
3. **컴파일**: C1 (Client) 또는 C2 (Server) 컴파일러 사용
4. **캐싱**: Code Cache에 저장하여 재사용

**C1 vs C2 컴파일러**:

| 구분 | C1 (Client Compiler) | C2 (Server Compiler) |
|------|---------------------|---------------------|
| 목적 | 빠른 시작 시간 | 최대 성능 |
| 최적화 수준 | 낮음 | 높음 |
| 컴파일 시간 | 빠름 | 느림 |
| 사용 환경 | GUI 애플리케이션 | 서버 애플리케이션 |

**Tiered Compilation** (Java 8+):

```
Level 0: Interpreter
Level 1: C1 (최소 최적화)
Level 2: C1 (프로파일링 포함)
Level 3: C1 (전체 프로파일링)
Level 4: C2 (최대 최적화)
```

### 꼬리 질문 1: JIT 최적화 기법에는 어떤 것이 있나요?

**답변**:

**주요 최적화 기법**:

1. **Inlining**: 메서드 호출을 본문으로 대체

```java
// Before (호출 오버헤드 있음)
int result = add(a, b);

// After Inlining (직접 실행)
int result = a + b;
```

2. **Dead Code Elimination**: 실행되지 않는 코드 제거

```java
// Before
if (false) {
    doSomething();  // 절대 실행 안 됨
}

// After (JIT가 제거)
// (코드 없음)
```

3. **Loop Unrolling**: 반복문 최적화

```java
// Before
for (int i = 0; i < 4; i++) {
    array[i] = i;
}

// After Unrolling
array[0] = 0;
array[1] = 1;
array[2] = 2;
array[3] = 3;
```

4. **Escape Analysis**: 객체가 메서드 밖으로 탈출하지 않으면 Stack에 할당

### 꼬리 질문 2: Code Cache가 가득 차면 어떻게 되나요?

**답변**:

Code Cache가 가득 차면 JIT 컴파일이 중단되고 Interpreter 모드로 폴백됩니다 → **성능 저하**

**모니터링**:

```bash
java -XX:+PrintCodeCache \
     -XX:ReservedCodeCacheSize=512m \
     -jar application.jar
```

**실무 대응**:

```bash
# Code Cache 크기 증가
-XX:ReservedCodeCacheSize=512m  # 기본 240m
```

---

## Q4. JVM의 Thread 관리 방식을 설명해주세요.

### 답변

JVM은 **1:1 스레드 모델**을 사용합니다. Java 스레드 하나당 OS 네이티브 스레드 하나가 매핑됩니다.

**Thread 생명주기**:

```
NEW
 ↓ start()
RUNNABLE ⇄ RUNNING
 ↓ wait(), join()
WAITING/TIMED_WAITING
 ↓ notify()
RUNNABLE
 ↓ 종료
TERMINATED
```

**Thread 별 메모리 영역**:

```
각 Thread마다 독립적:
- PC Register (다음 실행할 명령어 주소)
- JVM Stack (메서드 호출 스택)
- Native Method Stack (JNI 호출 스택)

모든 Thread가 공유:
- Heap (객체 저장)
- Method Area (클래스 메타데이터)
```

**Thread 생성 비용**:

```java
// 스레드 생성은 비용이 큼 (약 1MB 메모리 + OS 커널 호출)
new Thread(() -> {
    doWork();
}).start();

// 실무에서는 Thread Pool 사용
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(() -> doWork());
```

### 꼬리 질문 1: Virtual Thread (Project Loom)는 무엇인가요?

**답변**:

**Virtual Thread** (Java 19+): JVM이 관리하는 경량 스레드 (M:N 모델)

**기존 Thread vs Virtual Thread**:

| 구분 | Platform Thread | Virtual Thread |
|------|----------------|----------------|
| 매핑 | 1:1 (Java:OS) | M:N (수천 개:수십 개) |
| 메모리 | 약 1MB/스레드 | 수 KB/스레드 |
| 생성 비용 | 높음 | 매우 낮음 |
| 사용 사례 | CPU 집약적 | I/O 집약적 |

**예시**:

```java
// 100만 개 스레드 생성 (Virtual Thread만 가능)
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 1_000_000).forEach(i -> {
        executor.submit(() -> {
            Thread.sleep(Duration.ofSeconds(1));
            return i;
        });
    });
}
```

### 꼬리 질문 2: Thread Dump는 언제 사용하나요?

**답변**:

**Thread Dump**: 모든 스레드의 상태와 스택 트레이스를 캡처

**사용 시기**:
- 애플리케이션이 멈춤 (Hang)
- 데드락 의심
- CPU 사용률 100%

**생성 방법**:

```bash
# jstack 사용
jstack <PID> > thread_dump.txt

# kill 시그널 사용 (Unix/Linux)
kill -3 <PID>  # SIGQUIT
```

**분석 예시**:

```
"http-nio-8080-exec-25" #52 daemon prio=5 os_prio=0
   java.lang.Thread.State: WAITING (on object monitor)
    at java.lang.Object.wait(Native Method)
    at com.example.service.OrderService.processOrder(OrderService.java:45)
    - locked <0x00000000d5f47a20> (a java.lang.Object)
```

데드락 발견 시:
```
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f8a1c004e00 (object 0x00000000d5f47a20)
  which is held by "Thread-2"
"Thread-2":
  waiting to lock monitor 0x00007f8a1c004f00 (object 0x00000000d5f47b30)
  which is held by "Thread-1"
```

---

## Q5. Safepoint란 무엇이며, 왜 중요한가요?

### 답변

**Safepoint**: JVM이 모든 스레드를 안전하게 멈출 수 있는 지점

**필요한 경우**:
- Garbage Collection
- JIT 컴파일 (Deoptimization)
- Thread Dump 생성
- Heap Dump 생성

**동작 방식**:

1. JVM이 Safepoint 요청
2. 모든 스레드가 Safepoint에 도달할 때까지 대기
3. 모든 스레드가 멈춘 후 GC 등 작업 수행
4. 작업 완료 후 스레드 재개

**문제 상황**:

```java
// Safepoint에 도달하지 못하는 코드
for (long i = 0; i < Long.MAX_VALUE; i++) {
    // Counted Loop (Safepoint 없음)
    // → 다른 스레드들이 모두 대기
}
```

**모니터링**:

```bash
java -XX:+PrintGCApplicationStoppedTime \
     -XX:+PrintSafepointStatistics \
     -XX:PrintSafepointStatisticsCount=1 \
     -jar application.jar
```

**로그 예시**:

```
Total time for which application threads were stopped: 0.0123456 seconds
         vmop                    [threads: total initially_running wait_to_block]    [time: spin block sync cleanup vmop] page_trap_count
1.234: G1CollectForAllocation   [      123         5              3    ]      [     0     0     3     2   123   ]  0
```

- **spin**: 스레드가 Safepoint에 도달하기까지 대기한 시간
- **block**: 스레드를 차단하는 데 걸린 시간
- **sync**: 모든 스레드 동기화 시간

### 꼬리 질문: Time To Safepoint (TTSP)가 길면 어떻게 해결하나요?

**답변**:

**TTSP가 긴 이유**:
- Counted Loop가 너무 김
- JNI 호출이 많음
- Native 메서드 실행 중

**해결 방법**:

```java
// Before: Safepoint Poll 없음
for (long i = 0; i < VERY_LARGE_NUMBER; i++) {
    doWork();
}

// After: 명시적 Safepoint Poll 추가
for (long i = 0; i < VERY_LARGE_NUMBER; i++) {
    if (i % 10000 == 0) {
        Thread.yield();  // Safepoint Poll
    }
    doWork();
}
```

**JVM 옵션**:

```bash
# Safepoint Poll 간격 줄이기
-XX:GuaranteedSafepointInterval=1000  # 1초마다 강제 Safepoint
```

---

## 핵심 요약

### 학습 체크리스트

**JVM 구조**:
- Class Loader, Runtime Data Area, Execution Engine 설명
- 각 영역의 역할 이해

**ClassLoader**:
- Bootstrap, Extension, Application ClassLoader 구분
- Delegation Model 원리 및 이유
- Custom ClassLoader 사용 사례

**JIT Compiler**:
- Interpreter vs JIT 차이
- C1 vs C2 컴파일러
- Tiered Compilation 개념
- 주요 최적화 기법 (Inlining, Dead Code Elimination 등)

**Thread 관리**:
- 1:1 스레드 모델
- Thread별 메모리 영역 vs 공유 메모리
- Virtual Thread 개념 (Java 19+)
- Thread Dump 분석 방법

**Safepoint**:
- Safepoint란 무엇인가
- 필요한 경우 및 동작 방식
- TTSP (Time To Safepoint) 최적화

### 실무 핵심 포인트

- ClassLoader로 플러그인 시스템 구현 경험
- JIT Code Cache 모니터링 및 튜닝
- Thread Dump로 데드락 해결
- Safepoint 병목 해결 경험
