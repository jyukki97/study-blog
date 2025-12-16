---
title: "Java 컬렉션 성능 튜닝 가이드"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Java", "Collections", "Performance", "HashMap", "ArrayList"]
categories: ["Backend Deep Dive"]
description: "ArrayList/LinkedList/HashMap/ConcurrentHashMap 등 주요 컬렉션의 성능 특성과 튜닝 포인트"
module: "foundation"
study_order: 70
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
