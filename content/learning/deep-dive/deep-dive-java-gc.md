---
title: "Java GC (Garbage Collector) 완벽 가이드"
date: 2025-01-26
topic: "Backend"
tags: ["Java", "GC", "메모리", "성능최적화", "튜닝"]
categories: ["Backend"]
series: ["백엔드 심화 학습"]
series_order: 2
draft: true
module: "foundation"
---

## 들어가며

Java의 자동 메모리 관리 시스템인 GC(Garbage Collector)는 개발자가 직접 메모리를 해제하지 않아도 되게 해주지만, 성능 최적화를 위해서는 GC의 동작 원리와 각 알고리즘의 특성을 이해하는 것이 필수적입니다.

---

## 1. GC 기본 개념

### 1.1 GC가 필요한 이유

**C/C++에서의 수동 메모리 관리:**
```cpp
// C++
User* user = new User("Alice");
// ... 사용
delete user;  // ✅ 명시적 해제 필수

// 문제점:
// 1. Memory Leak: delete 깜빡하면 메모리 누수
// 2. Dangling Pointer: 이미 해제된 메모리 접근
```

**Java의 자동 메모리 관리:**
```java
// Java
User user = new User("Alice");
// ... 사용
// delete 불필요! GC가 자동으로 회수
```

### 1.2 GC의 대상이 되는 객체

**Reachability (도달 가능성):**
```
GC Roots:
- Stack의 로컬 변수
- Method Area의 static 변수
- JNI에서 생성한 객체

          GC Roots
              │
              ▼
         ┌────────┐
         │Object A│ ← Reachable (살아있음)
         └────┬───┘
              │
              ▼
         ┌────────┐
         │Object B│ ← Reachable
         └────────┘

         ┌────────┐
         │Object C│ ← Unreachable (GC 대상)
         └────────┘
```

**예제:**
```java
public class GCExample {
    private static User staticUser = new User("Static");  // GC Root

    public static void main(String[] args) {
        User user1 = new User("Local");  // GC Root (Stack)

        User user2 = new User("Temp");
        user2 = null;  // Unreachable → GC 대상

        createUser();
        // createUser()의 user3는 메서드 종료 후 Unreachable
    }

    public static void createUser() {
        User user3 = new User("Method");
        // 메서드 종료 후 user3는 GC 대상
    }
}
```

### 1.3 GC의 2가지 전제 (Weak Generational Hypothesis)

```
1. 대부분의 객체는 금방 Unreachable 상태가 된다
   → 생성된 객체의 98%는 곧바로 GC 대상

2. 오래된 객체에서 젊은 객체로의 참조는 아주 적다
   → Old → Young 참조는 드물다
```

**증명:**
```java
public void processOrders() {
    for (Order order : orders) {
        // 임시 객체 생성 (금방 버려짐)
        OrderDto dto = new OrderDto(order);  // ← 98%는 여기서 생성
        validate(dto);
        // dto는 메서드 종료 후 즉시 GC 대상
    }
}
```

---

## 2. GC 알고리즘 동작 원리

### 2.1 Mark and Sweep

**가장 기본적인 GC 알고리즘:**

```
1. Mark 단계:
   GC Roots에서 시작하여 참조 그래프 탐색
   → Reachable 객체 마킹

       GC Roots
           │
           ▼
       [A✓] → [B✓]
           ↘
             [C✓]

       [D] [E]  ← 마킹 안 됨 (Unreachable)

2. Sweep 단계:
   마킹되지 않은 객체 제거

       [A✓] → [B✓]
           ↘
             [C✓]

       [   ] [   ]  ← D, E 제거됨

3. Compact 단계 (선택적):
   살아남은 객체를 한쪽으로 모음 (메모리 단편화 방지)

       [A][B][C][       ]
```

**Stop-The-World (STW):**
```
GC 실행 중에는 모든 애플리케이션 스레드가 중지됨
→ 응답 지연 발생!

GC의 목표: STW 시간을 최소화
```

### 2.2 Generational GC

**Young Generation 구조:**
```
┌──────────────────────────────────────┐
│         Young Generation             │
│                                      │
│  ┌──────────┐  ┌─────────────────┐  │
│  │   Eden   │  │    Survivor     │  │
│  │          │  │   S0  │   S1    │  │
│  │          │  │       │         │  │
│  └──────────┘  └─────────────────┘  │
│   새 객체 생성    임시 보관소         │
└──────────────────────────────────────┘
```

**Minor GC 동작 과정:**

```
초기 상태:
Eden: [A][B][C][D]
S0:   [   ]
S1:   [   ]

1. Eden이 가득 참 → Minor GC 발생

2. Reachable 객체 찾기
   Eden: [A✓][B✓][C][D]  (C, D는 Unreachable)

3. 살아있는 객체를 S0로 복사 (Age = 1)
   Eden: [   ][   ][   ][   ]
   S0:   [A¹][B¹]
   S1:   [   ]

4. 다음 Minor GC
   Eden: [E][F][G][H]
   S0:   [A¹][B¹]

   → Reachable: Eden의 E, F와 S0의 A, B
   → S1로 복사 (Age + 1)

   Eden: [   ][   ][   ][   ]
   S0:   [   ]
   S1:   [A²][B²][E¹][F¹]

5. S0 ↔ S1 반복 (항상 하나는 비어있음)

6. Age >= 15 → Old Generation으로 Promotion
   Old:  [A¹⁵][B¹⁵]
```

**실제 동작 예제:**
```java
public class MinorGCExample {
    public static void main(String[] args) {
        List<User> users = new ArrayList<>();

        // 1. Eden에 객체 생성
        for (int i = 0; i < 1000; i++) {
            users.add(new User("User" + i));
        }

        // 2. Eden이 가득 차면 Minor GC 발생
        // users 리스트는 GC Root → Reachable
        // User 객체들도 users가 참조 → Reachable
        // → Survivor로 이동

        // 3. 임시 객체 대량 생성
        for (int i = 0; i < 1000000; i++) {
            User temp = new User("Temp" + i);
            // temp는 루프 다음 반복에서 Unreachable
            // → Minor GC 때 회수됨
        }

        // 4. users는 계속 참조 유지
        // → Age 증가하며 Survivor 0 ↔ 1 이동
        // → 최종적으로 Old Generation으로 Promotion
    }
}
```

### 2.3 Major GC (Full GC)

**Old Generation GC:**
```
발생 조건:
1. Old Generation이 가득 참
2. System.gc() 명시적 호출 (권장 안 함!)
3. Metaspace가 가득 참

특징:
- Minor GC보다 훨씬 느림 (10배 이상)
- STW 시간이 길어짐
- 빈번한 Full GC는 성능 저하의 주요 원인
```

**예제:**
```java
public class FullGCExample {
    private static List<byte[]> storage = new ArrayList<>();

    public static void main(String[] args) {
        // Old Generation을 계속 채움
        while (true) {
            byte[] data = new byte[1024 * 1024];  // 1MB
            storage.add(data);
            // storage가 static → GC Root
            // → data 객체들이 Old로 Promotion
            // → Old Generation 가득 참 → Full GC 발생!
        }
    }
}

// 실행 결과:
// [GC (Allocation Failure) ... 0.123 secs]  ← Minor GC
// [Full GC (Ergonomics) ... 0.987 secs]     ← Full GC (느림!)
```

---

## 3. GC 알고리즘 상세

### 3.1 Serial GC

**특징:**
```
- 단일 스레드로 GC 수행
- STW 시간이 가장 김
- CPU 코어가 1개인 환경에서만 사용
- 현대 서버 환경에서는 거의 사용 안 함
```

**JVM 옵션:**
```bash
-XX:+UseSerialGC
```

**동작:**
```
Minor GC: Copy 알고리즘 (Young Generation)
Major GC: Mark-Sweep-Compact (Old Generation)

모든 GC가 단일 스레드로 순차 실행
→ STW 시간 = GC 시간 전체
```

### 3.2 Parallel GC (Throughput GC)

**특징:**
```
- 멀티 스레드로 GC 수행
- Throughput(처리량) 최적화
- STW 시간은 여전히 존재
- Java 8 기본 GC
```

**JVM 옵션:**
```bash
-XX:+UseParallelGC
-XX:ParallelGCThreads=4  # GC 스레드 수 (기본: CPU 코어 수)
-XX:MaxGCPauseMillis=200  # 목표 pause time (밀리초)
-XX:GCTimeRatio=99        # GC 시간 비율 (기본: 1%)
```

**동작:**
```
┌────────────┐  ┌────────────┐  ┌────────────┐
│ GC Thread 1│  │ GC Thread 2│  │ GC Thread 3│
└──────┬─────┘  └──────┬─────┘  └──────┬─────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                 Eden을 3등분하여
                 병렬로 Mark & Copy

→ STW 시간 단축 (Serial 대비 1/N)
```

**사용 사례:**
```
- 배치 작업 (Throughput 중요)
- 백그라운드 분석 작업
- STW가 문제되지 않는 환경
```

### 3.3 CMS GC (Concurrent Mark Sweep)

**특징:**
```
- Low Latency 최적화
- 애플리케이션과 GC가 동시 실행
- STW 시간 최소화
- Java 14에서 Deprecated
```

**JVM 옵션:**
```bash
-XX:+UseConcMarkSweepGC
-XX:CMSInitiatingOccupancyFraction=75  # Old가 75% 차면 GC 시작
-XX:+UseCMSInitiatingOccupancyOnly     # 위 설정만 사용
```

**동작 과정:**
```
1. Initial Mark (STW, 짧음)
   GC Roots에서 직접 참조하는 객체만 마킹

2. Concurrent Mark (동시 실행)
   애플리케이션 실행 중에 전체 객체 그래프 탐색
   → 사용자 요청 처리와 동시에 GC 진행

3. Remark (STW, 짧음)
   Concurrent Mark 중 변경된 객체 재마킹

4. Concurrent Sweep (동시 실행)
   Unreachable 객체 제거

┌──────────────────────────────────────────────────┐
│ Application Threads                              │
│ ───────────────────────────────────────────────→ │
└──────────────────────────────────────────────────┘
   ▲STW  Concurrent  ▲STW   Concurrent
   IM               RM
```

**문제점:**
```
1. CPU 자원 사용 증가 (GC + Application 동시 실행)
2. Fragmentation (메모리 단편화)
   → Compact하지 않음
   → 빈 공간이 많아도 큰 객체 할당 실패
3. Floating Garbage
   → Concurrent Mark 중 생성된 가비지는 다음 GC에서 회수
```

### 3.4 G1 GC (Garbage First)

**특징:**
```
- Java 9+ 기본 GC
- Heap을 Region으로 나눔
- Pause Time 목표 설정 가능
- CMS의 단편화 문제 해결
```

**Heap 구조:**
```
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ E  │ E  │ S  │ O  │ O  │ O  │ H  │ E  │
├────┼────┼────┼────┼────┼────┼────┼────┤
│ O  │ S  │ E  │ E  │ O  │ H  │ O  │ E  │
└────┴────┴────┴────┴────┴────┴────┴────┘

E: Eden Region
S: Survivor Region
O: Old Region
H: Humongous Region (큰 객체, Region 크기의 50% 이상)

각 Region: 기본 1MB ~ 32MB (Heap 크기에 따라 자동 결정)
```

**JVM 옵션:**
```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200        # 목표 pause time (기본: 200ms)
-XX:G1HeapRegionSize=4m         # Region 크기 (기본: 자동)
-XX:InitiatingHeapOccupancyPercent=45  # GC 시작 임계값
```

**동작 과정:**
```
1. Young GC (Evacuation Pause)
   Eden과 Survivor Region을 다른 Region으로 복사
   → STW 발생하지만 짧음 (Pause Time 목표치 내)

2. Concurrent Marking Cycle
   - Initial Mark (STW, Young GC와 동시)
   - Root Region Scan
   - Concurrent Mark (동시)
   - Remark (STW)
   - Cleanup (STW + Concurrent)

3. Mixed GC
   Young + Old Region 중 가비지가 많은 Region 우선 회수
   → "Garbage First"의 의미
```

**예제:**
```java
// G1 GC 최적화 예시
public class G1Example {
    public static void main(String[] args) {
        List<byte[]> list = new ArrayList<>();

        // G1 GC는 pause time 목표를 맞추기 위해
        // 가비지가 많은 Region부터 회수

        for (int i = 0; i < 100; i++) {
            byte[] data = new byte[1024 * 1024];  // 1MB
            list.add(data);

            if (i % 10 == 0) {
                list.clear();  // 10MB마다 비움
                // → 이 Region은 100% 가비지
                // → G1이 우선적으로 회수
            }
        }
    }
}

// G1 GC 로그:
// [GC pause (G1 Evacuation Pause) (young), 0.0123 secs]
// → Pause time이 목표치(200ms) 내에 완료
```

**장점:**
```
1. Predictable Pause Time
   → -XX:MaxGCPauseMillis로 목표 설정 가능

2. 큰 Heap에서도 효율적 (>4GB)
   → Region 단위로 관리

3. Fragmentation 해결
   → Compaction 수행

4. Throughput도 준수
   → CMS보다 Throughput 높음
```

### 3.5 ZGC (Z Garbage Collector)

**특징:**
```
- Java 15+ 정식 지원
- Ultra-low Latency (< 10ms pause time)
- Heap 크기와 무관하게 일정한 pause time
- Concurrent Compaction
```

**JVM 옵션:**
```bash
-XX:+UseZGC
-XX:ZAllocationSpikeTolerance=2  # 메모리 할당 spike 허용
-XX:ZCollectionInterval=5        # GC 주기 (초)
```

**핵심 기술:**
```
1. Colored Pointers
   64bit 포인터의 일부 비트를 메타데이터로 사용

   ┌────────────────────────────────────────────┐
   │ 42bit Address │ Metadata │ Reserved │ 0 │
   └────────────────────────────────────────────┘

   Metadata: Marked, Remapped, Finalized 등

2. Load Barriers
   객체 접근 시 자동으로 재배치 정보 확인
   → Concurrent Compaction 가능

3. Concurrent Everything
   모든 GC 단계가 concurrent (STW 거의 없음)
```

**STW 시간 비교:**
```
G1 GC:   50ms ~ 200ms (Heap 크기에 따라 증가)
ZGC:     < 10ms (Heap 크기와 무관하게 일정)

ZGC는 TB급 Heap에서도 pause time < 10ms 보장
```

**사용 사례:**
```
- 초저지연이 필수인 금융 시스템
- 실시간 게임 서버
- 대용량 In-Memory Database
```

---

## 4. GC 튜닝 실전

### 4.1 GC 로그 분석

**GC 로그 활성화:**
```bash
# Java 8
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-Xloggc:/var/log/gc.log

# Java 9+
-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags
```

**로그 예시:**
```
# Young GC
2025-01-26T10:30:00.123+0900: [GC (Allocation Failure)
  [PSYoungGen: 512000K->51200K(614400K)]
  1024000K->563200K(2048000K), 0.0123456 secs]

분석:
- Young Generation: 512MB → 51MB (563MB 크기)
- 전체 Heap: 1GB → 563MB (2GB 크기)
- Pause Time: 12.3ms

# Full GC
2025-01-26T10:35:00.456+0900: [Full GC (Ergonomics)
  [PSYoungGen: 51200K->0K(614400K)]
  [ParOldGen: 512000K->460800K(1433600K)]
  563200K->460800K(2048000K), 0.987654 secs]

분석:
- Young: 51MB → 0MB
- Old: 512MB → 460MB
- 전체: 563MB → 460MB
- Pause Time: 987ms ⚠️ (매우 느림!)
```

### 4.2 GC 튜닝 전략

**1단계: 현재 상태 파악**
```bash
# GC 통계 모니터링
jstat -gcutil <pid> 1000

# 출력:
  S0     S1     E      O      M     CCS    YGC     YGCT    FGC    FGCT     GCT
  0.00  92.50  45.30  78.90  95.20  90.10   100    1.234     5    4.567   5.801

# S0, S1: Survivor 사용률
# E: Eden 사용률
# O: Old 사용률
# YGC: Young GC 횟수
# FGC: Full GC 횟수
# GCT: 전체 GC 시간
```

**2단계: 문제 진단**
```
증상 1: Full GC가 빈번 (분당 1회 이상)
원인: Old Generation이 빠르게 차오름
해결:
  1. Heap 크기 증가: -Xmx8g
  2. Young Generation 크기 증가: -Xmn2g
  3. 객체 생명주기 단축 (코드 개선)

증상 2: Young GC pause time이 김 (> 100ms)
원인: Young Generation이 너무 큼
해결:
  1. Young Generation 크기 감소: -Xmn512m
  2. GC 스레드 수 증가: -XX:ParallelGCThreads=8

증상 3: Old Generation 사용률이 계속 증가
원인: 메모리 누수
해결:
  1. Heap Dump 분석: jmap -dump:file=heap.bin <pid>
  2. Eclipse MAT로 누수 객체 확인
  3. 코드 수정 (SoftReference, ThreadLocal.remove() 등)
```

**3단계: GC 알고리즘 선택**
```
시나리오 1: 배치 작업 (Throughput 중시)
→ Parallel GC
-XX:+UseParallelGC -Xms4g -Xmx4g

시나리오 2: 웹 애플리케이션 (Latency 중시, Heap < 32GB)
→ G1 GC
-XX:+UseG1GC -Xms8g -Xmx8g -XX:MaxGCPauseMillis=200

시나리오 3: 실시간 시스템 (Ultra-low Latency, Heap > 32GB)
→ ZGC
-XX:+UseZGC -Xms64g -Xmx64g
```

### 4.3 GC 튜닝 실전 예시

**Before:**
```bash
# 문제 상황
-Xms2g -Xmx2g -XX:+UseParallelGC

# GC 로그:
[Full GC ... 1.234 secs]  ← 1초 이상 STW!
[Full GC ... 1.456 secs]
[Full GC ... 1.678 secs]  ← 빈번한 Full GC
```

**분석:**
```bash
jstat -gcutil <pid> 1000

  S0     S1     E      O      M
  0.00   0.00  12.30  98.50  95.20  ← Old가 98% (위험!)
```

**After:**
```bash
# 해결책 1: Heap 크기 증가 + G1 GC
-Xms8g -Xmx8g -XX:+UseG1GC -XX:MaxGCPauseMillis=200

# 해결책 2: Young Generation 크기 조정
-Xms4g -Xmx4g -Xmn1g -XX:+UseG1GC

# 결과:
[GC pause (G1 Evacuation Pause) (young), 0.045 secs]  ← 45ms
[GC pause (G1 Evacuation Pause) (mixed), 0.123 secs]  ← 123ms

Full GC 발생 빈도: 분당 10회 → 시간당 1회 이하
응답 시간: p99 2초 → 200ms
```

---

## 5. 메모리 누수 디버깅

### 5.1 Heap Dump 생성 및 분석

**자동 Heap Dump:**
```bash
# OOM 발생 시 자동으로 Heap Dump 생성
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/heapdump.hprof
```

**수동 Heap Dump:**
```bash
# 실행 중인 프로세스의 Heap Dump
jmap -dump:live,format=b,file=heap.bin <pid>

# 파일 크기 확인
ls -lh heap.bin
# -rw-r--r-- 1 user user 2.3G Jan 26 10:00 heap.bin
```

**Eclipse MAT 분석:**
```
1. File → Open Heap Dump → heap.bin

2. Leak Suspects Report 자동 생성
   → "Problem Suspect 1"
   → "ArrayList에 1,234,567개 객체가 누적"

3. Dominator Tree
   → 가장 많은 메모리를 차지하는 객체 확인

4. Path to GC Roots
   → 왜 객체가 GC되지 않는지 참조 경로 확인
```

**실제 사례:**
```
문제: ArrayList가 2GB 메모리 차지

Path to GC Roots:
CacheManager (static)
  └─ HashMap<String, Object> cache
      └─ ArrayList<Data> dataList (2GB)

원인: static 변수로 cache 유지 → GC 불가능

해결:
private static Map<String, SoftReference<Object>> cache;
```

---

## 요약 체크리스트

### GC 기본
- [ ] Reachability: GC Roots에서 도달 가능한 객체만 살아남음
- [ ] Generational Hypothesis: 대부분의 객체는 금방 죽는다
- [ ] STW (Stop-The-World): GC 실행 중 애플리케이션 중지
- [ ] Minor GC vs Major GC (Full GC)

### GC 알고리즘
- [ ] Serial GC: 단일 스레드 (사용 안 함)
- [ ] Parallel GC: Throughput 최적화 (배치)
- [ ] CMS GC: Low Latency (Deprecated)
- [ ] G1 GC: Balanced (Java 9+ 기본, Heap < 32GB)
- [ ] ZGC: Ultra-low Latency (Heap > 32GB, < 10ms pause)

### GC 튜닝
- [ ] Heap 크기: -Xms, -Xmx 동일하게 설정
- [ ] Young/Old 비율: -XX:NewRatio=2
- [ ] GC 로깅: -Xlog:gc*
- [ ] 목표 설정: -XX:MaxGCPauseMillis (G1, ZGC)

### 디버깅
- [ ] jstat: GC 통계 모니터링
- [ ] jmap: Heap Dump 생성
- [ ] Eclipse MAT: 메모리 누수 분석
- [ ] VisualVM: 실시간 모니터링

### 실무 팁
- [ ] Full GC 빈번: Heap 크기 증가 또는 객체 생명주기 단축
- [ ] Old Generation 90% 이상: 메모리 누수 의심
- [ ] Pause time 목표: G1 (200ms), ZGC (10ms)
- [ ] 프로덕션: G1 GC 또는 ZGC 사용 권장
