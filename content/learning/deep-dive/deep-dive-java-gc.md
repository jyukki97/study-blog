---
title: "Java GC 기본: 세대별 GC와 로그 분석"
date: 2025-12-16
draft: false
topic: "JVM"
tags: ["Java", "GC", "JVM", "GC Logs", "G1GC"]
categories: ["Backend Deep Dive"]
description: "할당/생존/승격 관점으로 GC를 이해하고, STW/메모리 문제를 로그로 진단하는 기본기"
module: "foundation"
quizzes:
  - question: "Java GC의 핵심 이론인 'Weak Generational Hypothesis(약한 세대 가설)'의 두 가지 전제 조건은?"
    options:
      - "1. 대부분의 객체는 금방 접근 불가능(Unreachable) 상태가 된다. 2. 오래된 객체에서 새로운 객체로의 참조는 아주 드물다."
      - "1. Old 영역이 Young 영역보다 항상 커야 한다. 2. 객체는 불변이어야 한다."
      - "1. 메모리는 무한하다. 2. 참조는 순환될 수 없다."
      - "1. GC는 STW 없이 동작해야 한다. 2. 모든 객체는 Old 영역에서 생성된다."
    answer: 0
    explanation: "이 가설 덕분에 Heap을 Young/Old로 나누고, Young 영역에서 빈번하게(Minor GC) 객체를 청소하는 방식이 효율적임이 증명되었습니다."

  - question: "GC 튜닝에서 'Stop-The-World (STW)' 시간을 줄인다는 것은 어떤 의미인가?"
    options:
      - "애플리케이션 스레드가 GC 작업을 위해 멈추는 시간(Pause Time)을 최소화한다는 뜻이다."
      - "JVM을 종료시키는 시간을 줄인다는 뜻이다."
      - "전체 처리량(Throughput)을 높이기 위해 GC 횟수를 늘린다는 뜻이다."
      - "메모리 사용량을 0으로 만든다는 뜻이다."
    answer: 0
    explanation: "STW가 발생하면 애플리케이션의 모든 스레드가 멈추므로, 응답 지연(Latency)에 직접적인 영향을 줍니다. G1GC, ZGC 등은 이 시간을 줄이는 데 초점을 맞춥니다."

  - question: "G1 GC (Garbage First GC)의 가장 큰 특징이자 기존 CMS/Parallel GC와의 구조적 차이점은?"
    options:
      - "메모리를 바둑판 모양의 'Region' 단위로 나누어 관리하며, 가비지가 많은 영역을 우선적으로 청소한다."
      - "Young 영역 없이 Old 영역만 사용한다."
      - "단일 스레드로만 동작하여 메모리를 절약한다."
      - "STW가 아예 발생하지 않는다."
    answer: 0
    explanation: "G1 GC는 물리적으로 연속된 Young/Old 영역 대신, 논리적인 Region 단위로 힙을 관리하여 대용량 메모리에서도 예측 가능한 일시 정지 시간(MaxGCPauseMillis)을 제공합니다."

  - question: "Young Generation에서 발생하는 GC인 'Minor GC'가 발생했을 때 살아남은 객체들의 이동 경로는?"
    options:
      - "Eden -> Survivor -> Old"
      - "Eden -> Old -> PermGen"
      - "Survivor -> Eden -> Old"
      - "Old -> Survivor -> Eden"
    answer: 0
    explanation: "객체는 Eden에서 생성되어, Minor GC에서 살아남으면 Survivor 영역(S0/S1)을 오가며 나이(Age)를 먹고, 임계값(MaxTenuringThreshold)을 넘으면 Old 영역으로 승격(Promotion)됩니다."

  - question: "GC가 객체를 삭제할지 말지 결정하는 기준인 'Reachability'의 시작점(GC Root)이 될 수 없는 것은?"
    options:
      - "힙 영역(Heap Area) 내의 다른 객체의 인스턴스 변수 (순환 참조인 경우)"
      - "스택 영역(Stack Area)의 로컬 변수 및 파라미터"
      - "메서드 영역(Method Area)의 Static 변수"
      - "JNI(Native Stack)의 참조"
    answer: 0
    explanation: "힙 내부의 객체끼리만 참조하고 있고 외부(Stack, Static 등)에서 닿을 수 없다면, 그 객체 그룹은 Unreachable 상태로 간주되어 GC 대상이 됩니다."

  - question: "ZGC (Z Garbage Collector)의 가장 큰 장점은?"
    options:
      - "TB 단위의 대용량 힙에서도 STW 시간을 10ms 이하로 유지한다."
      - "윈도우 OS에서만 동작한다."
      - "Young Generation을 사용하지 않는다."
      - "처리량(Throughput)이 Parallel GC보다 항상 높다."
    answer: 0
    explanation: "ZGC는 Load Barrier와 Colored Pointer 기술을 사용하여 동시성을 극대화, 힙 크기와 무관하게 매우 짧은 일시 정지 시간을 보장합니다."
study_order: 41
---

## 🗑️ 1. GC는 '청소부'가 아니라 '생존자 선별기'다

GC(Garbage Collection)를 "쓰레기를 줍는 과정"이라고 생각하기 쉽습니다.
하지만 실제로는 **"살아있는 객체(Live Object)를 마킹하고, 나머지를 날리는"** 과정에 가깝습니다.

- **Reachability**: GC Root(스택 변수, Static 변수 등)에서 닿을 수 있는 객체만 살아남습니다.
- **Stop-The-World (STW)**: 청소를 하려면 잠깐 세상을 멈춰야 합니다. 이걸 줄이는 게 GC 튜닝의 핵심입니다.

---

## 👶 2. 약한 세대 가설 (Weak Generational Hypothesis)

"대부분의 객체는 금방 죽는다."
이 가설 때문에 힙 메모리는 **Young**과 **Old**로 나뉩니다.

```mermaid
stateDiagram-v2
    direction LR
    state "Young Generation" as Young {
        [*] --> Eden : New Object
        Eden --> Survivor : Minor GC
        Survivor --> Survivor : Aging (Swap)
    }
    
    state "Old Generation" as OldGen {
        Survivor --> Old : Promotion
        Old --> [*] : Major GC (Reclaim)
    }
    
    note right of Old
        Major GC causes
        Long STW
    end note
```

1. **Eden**: 갓 태어난 객체들의 요람. 금방 죽는 객체는 여기서 Minor GC로 사라집니다.
2. **Survivor**: Eden에서 살아남은 객체가 잠시 머무는 곳.
3. **Old**: 산전수전 겪고 살아남은 객체들이 모이는 곳. 여기가 차면 **Major GC (Full GC)** 가 발생하며, 이는 매우 느립니다.

---

## 🚦 3. GC 알고리즘 진화

JVM의 역사는 STW(멈춤 시간)를 줄이기 위한 투쟁의 역사입니다.

### 1. STW vs Concurrent 비교

```mermaid
gantt
    title Stop-The-World vs Concurrent
    dateFormat X
    axisFormat %s
    
    section Parallel GC
    App Running       : 0, 10
    GC (STW)          : crit, 10, 5
    App Running       : 15, 10
    
    section G1/CMS GC
    App Running       : 0, 25
    Concurrent Mark   : active, 5, 10
    Remark (Short STW): crit, 15, 2
```

### 1. Serial / Parallel GC
- **단순 무식**: 청소할 때 모든 스레드 올스탑.
- **Parallel**: 청소부(GC 스레드) 숫자를 늘려서 빨리 끝냄. (Throughput 중심)

### 2. CMS (Concurrent Mark Sweep)
- **눈치 보기**: 애플리케이션 돌면서 몰래몰래 마킹함.
- **단점**: 메모리 파편화(Fragmentation)가 심함.

### 3. G1 GC (Garbage First) - *표준*
- **바둑판**: 힙을 잘게 쪼개서(Region), 쓰레기가 많은 곳부터 청소함.
- **예측 가능**: "200ms 안에 끝내줘"라고 설정 가능.

```mermaid
graph TB
    subgraph Region Map
    direction TB
        subgraph Row1
        direction LR
        R1[Eden] --- R2[Old] --- R3[Survivor] --- R4[Empty]
        end
        subgraph Row2
        direction LR
        R5[Old] --- R6[Humongous] --- R7[Eden] --- R8[Old]
        end
    end
    
    style R1 fill:#a5d6a7,stroke:#333
    style R7 fill:#a5d6a7,stroke:#333
    style R3 fill:#90caf9,stroke:#333
    style R2 fill:#ef9a9a,stroke:#333
    style R5 fill:#ef9a9a,stroke:#333
    style R8 fill:#ef9a9a,stroke:#333
    style R6 fill:#ce93d8,stroke:#333
    style R4 fill:#e0e0e0,stroke:#333,stroke-dasharray: 5 5
```

### 4. ZGC / Shenandoah
- **마법**: TB급 힙에서도 멈춤 시간 10ms 미만.
- **원리**: 포인터 자체에 색칠(Coloring)을 하거나 로드 배리어(Load Barrier)를 써서 위상 이동을 실시간 처리.

---

## 🔍 4. GC 로그 분석 실전

GC 튜닝의 시작은 **로그(Log)** 입니다. "느려요"라고 말하기 전에 로그를 봐야 합니다.

```
[GC (Allocation Failure) [PSYoungGen: 65536K->10752K(76288K)] 65536K->10760K(251392K), 0.0123456 secs]
```

- **Allocation Failure**: Eden 꽉 차서 발생. (정상)
- **PSYoungGen**: Young 영역 줄어듦 (청소 성공!)
- **0.012 secs**: 12ms 멈췄음. (양호)

> **Full GC**가 빈번하다면?
> 1. **메모리 누수(Leak)**: 쓸데없는 객체를 static 컬렉션 같은 데 쌓아두고 있지 않은지?
> 2. **객체 크기**: 불필요하게 큰 객체를 계속 만드는지?
> 3. **힙 크기**: 물리 메모리에 비해 힙이 너무 작은지?

## 요약

1. **세대 분리**: 금방 죽는 놈(Young)과 오래 사는 놈(Old)을 나눠서 관리한다.
2. **Minor GC**: 자주 일어나고 빠르다. (Eden 청소)
3. **Major GC**: 가끔 일어나고 느리다. (Old 청소, STW 주범)
4. **G1 GC**: 요즘 서버의 기본. 큰 힙을 효율적으로 쓴다.
