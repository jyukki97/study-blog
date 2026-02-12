---
title: "JVM GC 내부 구조: TLAB, 카드 테이블, 배리어까지"
date: 2026-02-12
draft: false
topic: "JVM"
tags: ["JVM", "GC", "TLAB", "Card Table", "Barrier", "G1GC"]
categories: ["Backend Deep Dive"]
description: "객체 할당 경로(TLAB)와 Remembered Set, Card Table, Write/Read Barrier까지 GC 내부 흐름을 구조적으로 이해"
module: "foundation"
quizzes:
  - question: "TLAB(Thread Local Allocation Buffer)을 사용하는 주된 목적은?"
    options:
      - "GC 주기를 길게 늘리기 위해"
      - "객체 할당 시 락 경합을 줄여 빠른 할당 경로를 제공하기 위해"
      - "메서드 영역을 줄이기 위해"
      - "Old 영역의 조각화를 줄이기 위해"
    answer: 1
    explanation: "TLAB은 각 스레드가 지역 버퍼에서 락 없이 bump-pointer로 객체를 할당하게 해줍니다. 멀티스레드 환경에서 할당 경합을 크게 줄여줍니다."

  - question: "Card Table은 무엇을 빠르게 추적하기 위한 구조인가?"
    options:
      - "메서드 호출 스택"
      - "Old -> Young 참조(세대 간 참조)"
      - "JIT 컴파일된 코드"
      - "스레드 상태"
    answer: 1
    explanation: "Card Table은 Old 영역에서 Young 영역으로 향하는 참조를 빠르게 찾기 위한 구조로, Minor GC 시 스캔 범위를 줄여줍니다."

  - question: "Write Barrier가 필요한 이유로 올바른 것은?"
    options:
      - "모든 읽기 연산을 차단하기 위해"
      - "객체 참조 변경 시 GC가 추적해야 할 메타데이터(카드 테이블 등)를 갱신하기 위해"
      - "스택 프레임을 늘리기 위해"
      - "JVM 옵션을 자동으로 조정하기 위해"
    answer: 1
    explanation: "참조 필드가 변경될 때 GC가 알아야 하는 메타데이터(카드 테이블/Remembered Set)를 업데이트하는 것이 Write Barrier의 핵심입니다."

  - question: "G1 GC에서 Remembered Set(RSet)은 어떤 정보를 담는가?"
    options:
      - "Young -> Old 참조"
      - "Old -> Young 참조"
      - "모든 객체의 크기 정보"
      - "스레드별 힙 사용량"
    answer: 1
    explanation: "RSet은 특정 Region이 참조되고 있는 외부 Region 정보를 유지하여, GC 시 스캔 범위를 줄여줍니다."
study_order: 45
---

## 이 글에서 얻는 것

- 객체 할당이 실제로 **어떤 경로로 빠르게 수행되는지(TLAB)** 설명할 수 있습니다.
- **Card Table/Remembered Set**이 왜 필요한지, Minor GC 스캔 범위를 어떻게 줄이는지 이해합니다.
- GC가 사용하는 **Write/Read Barrier**의 역할을 인지하고, 성능에 미치는 영향을 감 잡을 수 있습니다.

## 1) 객체 할당 경로: TLAB와 bump-pointer

JVM에서 객체 할당이 느리면, 애플리케이션 전체가 느려집니다. 그래서 대부분의 할당은 **락 없는 빠른 경로**를 탑니다.

### 1-1. TLAB 개념

- 각 스레드가 **자기 전용 버퍼(TLAB)** 를 받아 **동기화 없이** 객체를 할당합니다.
- 할당은 bump-pointer(포인터를 앞으로 이동) 한 번이면 끝입니다.

```java
// 개념적 표현 (실제 JVM 내부는 C++ 구현)
Object allocate(int size) {
    if (tlab.remaining() >= size) {
        Object obj = tlab.bump(size);
        return obj;
    }
    return slowPathAllocate(size); // TLAB 부족 -> 전역 힙에서 재할당
}
```

### 1-2. 왜 중요한가?

- 멀티스레드에서 **할당 시 락 경합이 사라짐**
- 작은 객체를 대량 생성하는 환경(웹/배치)에서 **성능 차이가 크게 발생**

> 실무 팁: TLAB 부족으로 slow path가 잦다면, 객체 할당 패턴이나 힙 크기/GC 설정을 의심해볼 수 있습니다.

## 2) Card Table: Old -> Young 참조 추적의 핵심

Minor GC는 Young 영역만 정리합니다. 그런데 Old 영역에서 Young을 참조하고 있으면, 그 Young 객체는 살아있어야 합니다.

문제: **Old 전체를 스캔하면 너무 느립니다.**
해결: **Card Table**로 변경된 영역만 추적합니다.

### 2-1. Card Table 동작

- 힙을 작은 카드(예: 512B~1KB) 단위로 나눕니다.
- Old 객체의 참조가 변경될 때, 해당 카드에 **dirty 표시**를 합니다.
- Minor GC에서는 **dirty 카드만** 스캔하면 됩니다.

```text
[Heap]
| Card0 | Card1 | Card2 | Card3 | ... |
   clean   dirty   clean   dirty

Minor GC -> Card1, Card3만 스캔
```

## 3) Remembered Set (RSet): G1의 지역적 스캔

G1은 힙을 여러 Region으로 쪼개고, 각 Region마다 **외부에서 들어오는 참조 집합(RSet)** 을 유지합니다.

- Region A를 수집할 때, **A를 참조하는 다른 Region만** 확인하면 됨
- “전체 스캔”이 아니라 “지역 스캔”으로 비용 절감

```mermaid
flowchart LR
    R1[Region 1] -->|ref| R2[Region 2]
    R3[Region 3] -->|ref| R2
    R2 -->|RSet| R1 & R3
```

## 4) Write Barrier / Read Barrier: GC의 신경망

### 4-1. Write Barrier

- **참조 필드가 변경되는 순간**에 실행되는 짧은 코드
- Card Table/RSet을 갱신해 GC가 “어디를 봐야 하는지” 알게 함

```java
// 개념적 의사코드
void writeField(Object obj, Object newRef) {
    obj.field = newRef;
    CardTable.markDirty(obj); // Write Barrier
}
```

### 4-2. Read Barrier

- 일부 동시성 GC(ZGC, Shenandoah 등)에서 사용
- 읽기 시점에 객체 상태를 확인/보정하여 **STW를 최소화**

> 이해 포인트: Barriers는 “GC 비용을 런타임에 분산”시키는 장치입니다.

## 5) GC 내부 구조가 실무에 주는 힌트

1. **할당 폭주 = GC 빈도 증가** → 객체 생성 줄이기 / 풀링 고려
2. **Old -> Young 참조가 많아지면** → Minor GC 비용 증가 가능
3. **동시성 GC의 Barrier 비용** → 극저지연 시스템에서 읽기/쓰기 비용을 고려해야 함

## 요약

- **TLAB**: 스레드별 빠른 할당 경로로 성능을 결정한다.
- **Card Table**: Old -> Young 참조를 빠르게 추적해 Minor GC 비용을 줄인다.
- **RSet**: G1의 Region 단위 스캔을 가능하게 한다.
- **Write/Read Barrier**: GC 비용을 런타임에 분산시키는 핵심 메커니즘이다.

## 연습(추천)

- `-XX:+PrintTLAB` 옵션으로 TLAB 할당 통계를 확인해보기
- G1에서 `-Xlog:gc+remset=debug`로 RSet 갱신 로그를 살펴보기
- 객체 참조 패턴을 바꿔가며 Minor GC 시간 변화 관찰하기
