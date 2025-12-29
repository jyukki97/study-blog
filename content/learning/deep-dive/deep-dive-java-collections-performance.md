---
title: "Java 컬렉션 성능 튜닝 가이드"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Java", "Collections", "Performance", "HashMap", "ArrayList"]
categories: ["Backend Deep Dive"]
description: "ArrayList/LinkedList/HashMap/ConcurrentHashMap 등 주요 컬렉션의 성능 특성과 튜닝 포인트"
module: "foundation"
quizzes:
  - question: "ArrayList에 데이터를 계속 추가하다가 내부 배열 용량이 꽉 찼을 때 발생하는 '리사이즈(Resize)' 과정의 비용 설명으로 옳은 것은?"
    options:
      - "O(1) 비용으로 매우 저렴하다."
      - "새로운 더 큰 배열을 만들고 기존 데이터를 모두 복사해야 하므로 O(n) 비용이 들고 순간적인 레이턴시 튀는 현상(Spike)이 발생한다."
      - "기존 배열의 크기만 늘리므로 복사 비용은 없다."
      - "자동으로 리사이즈되지 않고 예외가 발생한다."
    answer: 1
    explanation: "배열은 크기가 고정되어 있으므로, 확장을 위해서는 '새 배열 할당 -> 전체 복사 -> 참조 변경'의 비싼 과정이 필요합니다."

  - question: "LinkedList가 이론적으로는 중간 삽입/삭제가 O(1)이지만, 실제 성능은 ArrayList보다 느린 경우가 많은 주된 이유는?"
    options:
      - "CPU 캐시 지역성(Cache Locality)이 떨어져서 메모리 접근 속도가 느리기 때문이다."
      - "LinkedList는 데이터 압축을 수행하기 때문이다."
      - "ArrayList가 멀티스레드에 더 최적화되어 있어서."
      - "자바 컴파일러가 LinkedList를 지원하지 않아서."
    answer: 0
    explanation: "노드들이 힙 메모리 여기저기에 흩어져 있어(참조 포인터로 연결), 연속된 메모리를 사용하는 배열에 비해 캐시 미스(Cache Miss)가 자주 발생합니다."

  - question: "HashMap의 부하율(Load Factor, 기본 0.75)이 의미하는 바는?"
    options:
      - "데이터가 75% 찰 때마다 데이터를 삭제한다."
      - "버킷 용량의 75%가 차면 리사이즈를 수행하여 해시 충돌을 줄인다."
      - "해시 함수의 성능을 75%로 제한한다."
      - "메모리를 75%만 사용하도록 강제한다."
    answer: 1
    explanation: "Load Factor는 시간(속도)과 공간(메모리)의 트레이드오프 설정값입니다. 너무 높으면 충돌이 늘고, 너무 낮으면 메모리 낭비와 잦은 리사이즈가 발생합니다."

  - question: "멀티스레드 환경에서 공유 카운터(Counter)를 구현할 때, `ConcurrentHashMap + AtomicLong` 조합보다 `LongAdder`가 더 유리한 상황은?"
    options:
      - "키값의 개수가 적을 때"
      - "단일 스레드일 때"
      - "경합(Contention)이 매우 심할 때"
      - "정확성이 중요하지 않을 때"
    answer: 2
    explanation: "LongAdder는 내부적으로 변수를 분산시켜 경합을 줄이기 때문에, 여러 스레드가 동시에 하나의 값을 업데이트할 때 AtomicLong보다 성능이 뛰어납니다."

  - question: "자바 컬렉션 사용 시 `Map<Long, Long>` 처럼 래퍼 클래스를 키/값으로 사용할 때의 성능상 단점은?"
    options:
      - "해시 충돌이 더 자주 발생한다."
      - "오토박싱/언박싱으로 인한 객체 생성과 GC 오버헤드가 발생한다."
      - "컴파일 에러가 발생한다."
      - "메모리를 더 적게 사용한다."
    answer: 1
    explanation: "원시 타입(long)을 래퍼 객체(Long)로 감싸는 오토박싱은 힙 메모리 할당을 유발하므로 대량 처리 시 GC 부담이 됩니다."

  - question: "정확한 마이크로 벤치마크(Micro-benchmark) 측정을 위해 권장되는 도구는?"
    options:
      - "System.currentTimeMillis()"
      - "JMH (Java Microbenchmark Harness)"
      - "StopWatch"
      - "Timer"
    answer: 1
    explanation: "단순 시간 측정은 JIT 컴파일러 최적화(Warm-up)나 GC 등의 영향을 배제하기 어렵습니다. JMH는 이를 보정하여 정확한 측정을 돕습니다."

  - question: "초기 데이터 개수를 대략 알고 있을 때, `new ArrayList<>(10000)` 처럼 초기 용량을 지정하는 것의 가장 큰 장점은?"
    options:
      - "타입 안정성이 보장된다."
      - "리사이즈(배열 재할당 및 복사) 횟수를 줄여 성능을 최적화한다."
      - "데이터 정렬이 자동으로 수행된다."
      - "메모리 사용량을 줄일 수 있다."
    answer: 1
    explanation: "불필요한 리사이즈를 방지하여 CPU 사용량과 GC 압박을 줄일 수 있습니다."
study_order: 33
---

## 이 글에서 얻는 것

- `ArrayList/LinkedList/HashMap/ConcurrentHashMap`을 “외워서”가 아니라, **왜 빠른지/왜 느려지는지**로 설명할 수 있습니다.
- 리사이즈/박싱/캐시 미스 같은 비용이 실제 성능에 미치는 영향을 이해하고, 튜닝 포인트를 잡을 수 있습니다.
- 멀티스레드 환경에서 `ConcurrentHashMap`을 안전하게 쓰는 기준이 생깁니다.

## 1) ArrayList: 기본은 맞는데, 리사이즈와 이동 비용을 기억하자

`ArrayList`는 내부가 “배열”입니다. 그래서 랜덤 접근이 빠르고, 순회가 캐시 친화적입니다.

핵심 비용 2가지:

- **리사이즈**: 용량이 부족해지면 더 큰 배열을 만들고 복사합니다(스파이크).
- **중간 삽입/삭제**: 뒤의 원소를 한 칸씩 밀거나 당깁니다(O(n)).

### 튜닝 포인트: 초기 용량

대략 크기를 알면 용량을 먼저 잡아두는 게 가장 큰 효과를 줍니다.

```java
List<Order> orders = new ArrayList<>(expectedSize);
```

## 2) LinkedList: “중간 삽입 O(1)”을 믿고 쓰면 망하는 이유

LinkedList는 노드(객체)들이 포인터로 연결되어 있습니다.

- 중간 삽입/삭제가 O(1)인 건 “그 노드를 이미 알고 있을 때”입니다.
- 대부분의 실무 코드는 먼저 위치를 찾기 위해 O(n)을 수행합니다.
- 노드 객체가 많아지면 메모리 오버헤드/GC 부담/캐시 미스가 커집니다.

큐/스택이 목적이라면 보통 **`ArrayDeque`** 가 더 좋은 선택입니다.

## 3) HashMap: 평균 O(1) 뒤에 숨어있는 리사이즈/충돌 비용

HashMap의 성능을 좌우하는 건 보통 이 3가지입니다.

1) **키의 hashCode/equals 비용**  
2) **충돌 빈도(키 분포)**  
3) **리사이즈 빈도(용량/부하율)**  

### 3-1) 초기 용량: 리사이즈 스파이크 줄이기

HashMap은 (대략) `capacity * loadFactor`를 넘으면 리사이즈합니다(기본 loadFactor 0.75).
대략 크기가 있으면 다음처럼 잡는 것이 흔합니다.

```java
int expected = 100_000;
Map<String, User> map = new HashMap<>((int) (expected / 0.75f) + 1);
```

### 3-2) 키는 “불변”이어야 한다

키로 쓰이는 객체의 `equals/hashCode`에 사용되는 필드가 변경되면 조회가 깨질 수 있습니다.
키로는 불변(immutable) 타입을 선호합니다.

## 4) ConcurrentHashMap: 멀티스레드에서 HashMap 대신 쓰는 ‘기본’

`ConcurrentHashMap`(CHM)은 멀티스레드에서 안전하게 Map을 쓰기 위한 표준 도구입니다.
자바 8 이후는 세그먼트 방식이 아니라, 버킷(bin) 단위로 CAS/락을 섞어 구현됩니다.

실무에서 중요한 포인트:

- 읽기는 대부분 락 없이 동작합니다.
- 쓰기는 상황에 따라 CAS/동기화를 사용합니다(경합이 심하면 느려질 수 있음).
- “카운터” 용도는 `LongAdder`와 조합하는 것이 흔합니다.

```java
ConcurrentHashMap<String, LongAdder> counters = new ConcurrentHashMap<>();
counters.computeIfAbsent(key, k -> new LongAdder()).increment();
```

주의할 점:

- `computeIfAbsent`의 mapping 함수에서 “다시 같은 맵을 건드리는” 복잡한 로직을 넣으면 예상치 못한 병목이 생길 수 있습니다.
- 경합이 심한 단일 키 카운터는 `LongAdder`가 `AtomicLong`보다 유리할 때가 많습니다.

## 5) 박싱/언박싱: ‘생각보다’ 비싼 비용

`Map<Long, Long>` 같은 구조는 오토박싱으로 객체 할당이 늘고, GC 압박이 커질 수 있습니다.
정말 병목일 때는 primitive 컬렉션(예: fastutil/HPPC)을 고려하지만, 의존성/복잡도를 함께 감안해야 합니다.

## 6) 성능을 확인할 때의 최소 원칙

- “내 코드에서 실제로 느린 지점”을 먼저 찾기(프로파일링) → 컬렉션을 바꾸는 건 마지막
- 비교가 필요하면 JMH 같은 도구로 워밍업/JIT 영향을 줄이기
- 시간뿐 아니라 **할당량/GC** 도 같이 보기

## 연습(추천)

- 같은 기능을 `LinkedList`/`ArrayDeque`로 구현해보고, 원소 수가 커질 때 어떤 차이가 나는지 관찰해보기
- HashMap에 `withCapacity`를 넣었을 때 리사이즈가 줄어드는지 확인해보기(로그/프로파일링)
- 멀티스레드 카운터를 `AtomicLong` vs `LongAdder`로 만들어 경합이 커질 때 차이를 비교해보기
