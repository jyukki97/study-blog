---
title: "Java Collection Framework: List/Set/Map 선택 기준과 성능 특성"
date: 2025-10-01
draft: false
topic: "Java"
tags: ["Java", "Collection", "ArrayList", "HashMap", "HashSet", "Performance"]
categories: ["Backend Deep Dive"]
description: "ArrayList vs LinkedList, HashMap vs TreeMap, 언제 어떤 컬렉션을 선택할지 성능과 특성 기준으로 정리"
module: "foundation"
quizzes:
  - question: "데이터의 중간 삽입과 삭제가 빈번하게 발생하지 않고, 인덱스를 통한 조회(Random Access)가 주된 작업일 때 가장 적합한 List 구현체는?"
    options:
      - "LinkedList"
      - "ArrayList"
      - "Vector"
      - "Stack"
    answer: 1
    explanation: "ArrayList는 내부적으로 배열을 사용하여 인덱스 접근이 O(1)로 매우 빠르며, 대부분의 실무 조회 중심 환경에서 기본 선택지입니다."

  - question: "HashMap의 동작 원리에 대한 설명 중 틀린 것은?"
    options:
      - "Key의 hashCode()를 사용하여 버킷 위치를 결정한다."
      - "Key가 다르면 무조건 다른 버킷에 저장된다."
      - "해시 충돌(Hash Collision)이 발생하면 같은 버킷 내에서 연결 리스트(또는 트리) 형태로 저장된다."
      - "null을 Key와 Value로 사용할 수 있다."
    answer: 1
    explanation: "서로 다른 Key라도 해시 함수 결과가 같거나, 버킷 인덱스로 변환 시 충돌이 발생할 수 있습니다. 이를 해시 충돌이라고 합니다."

  - question: "멀티 스레드 환경에서 안전하게 Map을 사용하고 싶을 때, 성능과 동시성을 모두 고려한 최선의 선택은?"
    options:
      - "HashMap"
      - "Hashtable"
      - "ConcurrentHashMap"
      - "TreeMap"
    answer: 2
    explanation: "ConcurrentHashMap은 락 분할(Lock Stripping) 등을 통해 Hashtable보다 훨씬 높은 동시성 성능을 제공하면서 스레드 안전성을 보장합니다."

  - question: "순서가 없는 Set이지만, 데이터를 입력한 순서대로 다시 꺼내보고 싶을 때 사용하는 구현체는?"
    options:
      - "HashSet"
      - "TreeSet"
      - "LinkedHashSet"
      - "EnumSet"
    answer: 2
    explanation: "LinkedHashSet은 내부적으로 해시 테이블과 연결 리스트를 함께 사용하여, 중복은 제거하되 삽입 순서를 유지합니다."

  - question: "`Arrays.asList(\"a\", \"b\")`로 생성한 리스트에 `.add(\"c\")`를 호출하면 발생하는 일은?"
    options:
      - "리스트에 \"c\"가 추가된다."
      - "무시된다."
      - "컴파일 에러가 발생한다."
      - "UnsupportedOperationException 런타임 에러가 발생한다."
    answer: 3
    explanation: "`Arrays.asList`가 반환하는 리스트는 고정 크기(Fixed-size)이므로 구조를 변경하는 add/remove 호출 시 예외가 발생합니다."

  - question: "List를 순회(for-each)하는 도중에 `list.remove(item)`을 직접 호출하면 어떤 예외가 발생할 가능성이 높나요?"
    options:
      - "NullPointerException"
      - "IndexOutOfBoundsException"
      - "ConcurrentModificationException"
      - "ClassCastException"
    answer: 2
    explanation: "컬렉션의 구조가 순회 중에 변경되면 Fail-Fast 반복자가 이를 감지하고 ConcurrentModificationException을 던집니다. Iterator의 remove()를 써야 안전합니다."

  - question: "TreeSet이나 TreeMap의 내부 구현 자료구조이자, 항상 정렬된 상태를 유지하면서 O(log n)의 성능을 보장하는 것은?"
    options:
      - "Binary Heap"
      - "Red-Black Tree"
      - "B-Tree"
      - "Hash Table"
    answer: 1
    explanation: "Java의 TreeSet/TreeMap은 Red-Black Tree(균형 이진 탐색 트리)를 사용하여 최악의 경우에도 O(log n)을 보장합니다."

  - question: "ArrayList의 초기 용량(Initial Capacity)을 지정하지 않고 사용할 때 발생할 수 있는 잠재적 성능 이슈는?"
    options:
      - "메모리 누수가 발생한다."
      - "데이터가 많아질 때 내부 배열의 크기를 늘리기 위한 재할당(Resizing)과 복사(Copy) 비용이 발생한다."
      - "데이터 조회가 느려진다."
      - "스레드 안전성이 깨진다."
    answer: 1
    explanation: "배열이 가득 찰 때마다 새로운 더 큰 배열을 만들고 기존 데이터를 복사하는 과정은 비용이 큽니다. 데이터 크기를 안다면 미리 지정하는 것이 좋습니다."
study_order: 32
---

## 이 글에서 얻는 것

- **List/Set/Map의 핵심 차이**를 시간 복잡도와 사용 목적으로 설명할 수 있습니다.
- ArrayList vs LinkedList, HashMap vs TreeMap 같은 선택 기준을 **실제 사용 패턴**으로 판단합니다.
- 동시성 환경에서의 컬렉션 선택(ConcurrentHashMap, CopyOnWriteArrayList)을 이해합니다.
- 컬렉션 성능 이슈(N+1, 불필요한 복사)를 예방하는 습관을 갖습니다.

## 0) Collection Framework는 '자료구조'를 일관된 인터페이스로 제공한다

Java Collection Framework는 데이터를 저장하고 조작하는 표준화된 방법을 제공합니다.
핵심은 **"어떤 데이터를 어떻게 저장하고 찾을 것인가"**를 상황에 맞게 선택하는 것입니다.

```mermaid
classDiagram
    direction TB
    class Iterable {
        <<interface>>
    }
    class Collection {
        <<interface>>
    }
    class List {
        <<interface>>
        +ORDERED
        +DUPLICATES_OK
    }
    class Set {
        <<interface>>
        +UNIQUE
    }
    class Queue {
        <<interface>>
    }
    class Map {
        <<interface>>
        +KEY_VALUE
    }

    Iterable <|-- Collection
    Collection <|-- List
    Collection <|-- Set
    Collection <|-- Queue

    List <|.. ArrayList
    List <|.. LinkedList
    List <|.. Vector

    Set <|.. HashSet
    Set <|.. LinkedHashSet
    Set <|.. TreeSet

    Queue <|.. PriorityQueue
    Queue <|.. ArrayDeque

    Map <|.. HashMap
    Map <|.. LinkedHashMap
    Map <|.. TreeMap
    Map <|.. ConcurrentHashMap
    
    style Map fill:#f9f,stroke:#333,stroke-width:2px
    style Collection fill:#bbf,stroke:#333,stroke-width:2px
```

## 1) List: 순서가 있고, 중복을 허용하는 컬렉션

> [!TIP]
> **List의 핵심**: "줄 서기"입니다. 들어온 순서대로 저장되고, 번호표(Index)로 찾습니다.

```mermaid
graph LR
    subgraph ArrayList [ArrayList: 연속된 메모리]
    A1[0: Apple] --- A2[1: Banana] --- A3[2: Cherry]
    end
    
    subgraph LinkedList [LinkedList: 흩어진 메모리]
    L1((Apple)) --> L2((Banana)) --> L3((Cherry))
    L2 --> L1
    L3 --> L2
    end
    
    style ArrayList fill:#e1f5fe
    style LinkedList fill:#fff3e0
```

### 1-1) ArrayList: 가장 많이 쓰는 리스트

```java
// ArrayList: 내부적으로 배열 사용
List<String> list = new ArrayList<>();
list.add("Apple");      // O(1) - 끝에 추가
list.add("Banana");
list.get(0);            // O(1) - 인덱스 접근
list.remove(0);         // O(n) - 중간 삭제 시 shift 발생

// 초기 용량 지정 (성능 최적화)
List<String> optimized = new ArrayList<>(1000);  // 미리 공간 확보
```

**언제 사용:**
- 인덱스 기반 조회가 많을 때
- 끝에 추가/삭제가 주된 작업일 때
- 대부분의 경우 ArrayList가 기본 선택

**시간 복잡도:**
- get(index): O(1)
- add(element): O(1) amortized (배열 확장 시 O(n))
- add(index, element): O(n) (shift 필요)
- remove(index): O(n) (shift 필요)
- contains(element): O(n)

### 1-2) LinkedList: 중간 삽입/삭제가 많을 때

```java
List<String> linkedList = new LinkedList<>();
linkedList.add("Apple");        // O(1)
linkedList.add(0, "Banana");    // O(n) - 탐색 후 O(1) 삽입
linkedList.remove(0);           // O(1) - 첫 번째 삭제

// Deque로 사용 (양방향 큐)
Deque<String> deque = new LinkedList<>();
deque.addFirst("First");        // O(1)
deque.addLast("Last");          // O(1)
deque.pollFirst();              // O(1)
```

**언제 사용:**
- 앞/뒤에서 자주 추가/삭제할 때 (Deque로 사용)
- 중간 삽입/삭제가 정말 많을 때 (드뭄)

**주의:**
- 인덱스 접근(get)이 O(n)이라 느림
- 메모리 오버헤드가 큼 (노드마다 포인터 저장)
- **대부분의 경우 ArrayList가 더 빠름** (캐시 지역성)

### 1-3) ArrayList vs LinkedList 실전 선택

```java
// ✅ ArrayList 선택
List<Order> orders = new ArrayList<>();
// - 조회가 많고, 끝에 추가만 함
// - 대부분의 일반적인 경우

// ✅ LinkedList 선택 (Deque로 사용)
Deque<Task> taskQueue = new LinkedList<>();
taskQueue.addFirst(urgentTask);   // 우선 작업 앞에 추가
taskQueue.pollLast();              // 마지막 작업 제거

// ❌ 피해야 할 패턴
List<String> bad = new LinkedList<>();
for (int i = 0; i < 1000; i++) {
    bad.get(i);  // O(n) * 1000 = O(n²) - 매우 느림!
}
```

## 2) Set: 중복을 허용하지 않는 컬렉션

> [!NOTE]
> **Set의 핵심**: "주머니 속 구슬"입니다. 순서가 없고, 같은 구슬(데이터)은 두 번 넣을 수 없습니다.

### 2-1) 주요 구현체 비교

| 구현체 | 특징 | 정렬/순서 | 시간 복잡도 |
| :--- | :--- | :--- | :--- |
| **HashSet** | 가장 빠름 (일반적 선택) | X | $O(1)$ |
| **TreeSet** | 데이터가 자동 정렬됨 | 정렬됨 (Binary Tree) | $O(\log n)$ |
| **LinkedHashSet** | 입력한 순서대로 조회 가능 | 입력 순서 유지 | $O(1)$ |

### 2-2) HashSet: 가장 빠른 Set

```mermaid
graph TD
    Input["데이터 입력: 'Apple'"] --> Hash{해시 함수}
    Hash -->|Hash: 123| Bucket[버킷 위치]
    Bucket -->|중복 체크| Store[저장 또는 무시]
```

### 2-2) TreeSet: 정렬된 Set

```java
Set<Integer> sorted = new TreeSet<>();
sorted.add(5);
sorted.add(1);
sorted.add(3);
System.out.println(sorted);  // [1, 3, 5] - 자동 정렬

// 범위 검색
TreeSet<Integer> scores = new TreeSet<>();
scores.addAll(Arrays.asList(85, 90, 75, 95, 80));
System.out.println(scores.subSet(80, 90));  // [80, 85] - 80 이상 90 미만
```

**언제 사용:**
- 자동 정렬이 필요
- 범위 검색이 필요 (subSet, headSet, tailSet)

**시간 복잡도:**
- add/remove/contains: O(log n)

### 2-3) LinkedHashSet: 순서를 보장하는 Set

```java
Set<String> insertOrder = new LinkedHashSet<>();
insertOrder.add("Banana");
insertOrder.add("Apple");
insertOrder.add("Cherry");
System.out.println(insertOrder);  // [Banana, Apple, Cherry] - 삽입 순서 유지
```

**언제 사용:**
- 중복 제거 + 삽입 순서 유지

## 3) Map: Key-Value 쌍을 저장하는 컬렉션

> [!IMPORTANT]
> **Map의 핵심**: "사물함"입니다. 열쇠(Key)로 사물함(Value)을 엽니다. 열쇠는 중복될 수 없습니다.

```mermaid
graph LR
    subgraph BucketArray [HashMap 내부 구조]
    idx0["0: null"]
    idx1["1: Key1 -> Val1"]
    idx2["2: Key2 -> Val2 -> Key3 -> Val3"]
    idx3["3: null"]
    end
    
    style idx2 fill:#ffccbc
    Note["충돌 발생 시, 같은 버킷에 연결 리스트(또는 트리)로 저장"]
```

### 3-1) 주요 구현체 비교

| 구현체 | 특징 | 정렬/순서 | 시간 복잡도 |
| :--- | :--- | :--- | :--- |
| **HashMap** | 가장 빠름 (표준) | X | $O(1)$ |
| **TreeMap** | Key 기준 자동 정렬 | 정렬됨 (Red-Black Tree) | $O(\log n)$ |
| **LinkedHashMap** | 입력 순서 or 접근 순서 유지 | 입력/LRU 순서 | $O(1)$ |


### 3-2) HashMap: 가장 많이 쓰는 Map

```java
Map<String, Integer> ages = new HashMap<>();
ages.put("Alice", 25);          // O(1)
ages.put("Bob", 30);
ages.get("Alice");              // O(1) - 25
ages.containsKey("Alice");      // O(1)
ages.remove("Bob");             // O(1)

// 초기 용량 지정 (성능 최적화)
Map<String, User> users = new HashMap<>(10000, 0.75f);
// 10000개 수용, load factor 0.75

// getOrDefault 활용
int count = wordCount.getOrDefault("hello", 0);

// computeIfAbsent 활용 (초기화 간소화)
Map<String, List<Order>> ordersByCustomer = new HashMap<>();
ordersByCustomer.computeIfAbsent("customer1", k -> new ArrayList<>())
    .add(new Order());
```

**언제 사용:**
- Key로 빠르게 조회
- 순서가 중요하지 않을 때
- 대부분의 경우 HashMap이 기본 선택

**시간 복잡도:**
- get/put/remove/containsKey: O(1) average

### 3-2) TreeMap: 정렬된 Map

```java
Map<Integer, String> sorted = new TreeMap<>();
sorted.put(3, "Three");
sorted.put(1, "One");
sorted.put(2, "Two");
System.out.println(sorted);  // {1=One, 2=Two, 3=Three} - Key 정렬

// 범위 검색
TreeMap<Integer, String> scores = new TreeMap<>();
scores.put(85, "B");
scores.put(90, "A");
scores.put(75, "C");
System.out.println(scores.subMap(80, 90));  // {85=B} - 80 이상 90 미만
```

**언제 사용:**
- Key 기준 자동 정렬
- 범위 검색 필요

**시간 복잡도:**
- get/put/remove: O(log n)

### 3-3) LinkedHashMap: 순서를 보장하는 Map

```java
Map<String, Integer> insertOrder = new LinkedHashMap<>();
insertOrder.put("Banana", 1);
insertOrder.put("Apple", 2);
insertOrder.put("Cherry", 3);
System.out.println(insertOrder);  // {Banana=1, Apple=2, Cherry=3} - 삽입 순서

// LRU 캐시 구현
Map<String, String> lruCache = new LinkedHashMap<>(16, 0.75f, true) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
        return size() > 100;  // 최대 100개 유지
    }
};
```

**언제 사용:**
- 삽입/접근 순서 유지
- LRU 캐시 구현

## 4) 동시성 컬렉션

### 4-1) ConcurrentHashMap

```java
// ❌ HashMap (멀티스레드 환경에서 안전하지 않음)
Map<String, Integer> unsafe = new HashMap<>();

// ✅ ConcurrentHashMap (멀티스레드 안전)
Map<String, Integer> concurrent = new ConcurrentHashMap<>();
concurrent.put("count", 0);
concurrent.compute("count", (k, v) -> v == null ? 1 : v + 1);  // 원자적 연산

// putIfAbsent (원자적)
concurrent.putIfAbsent("key", 1);  // key가 없을 때만 추가
```

**언제 사용:**
- 멀티스레드 환경에서 Map 사용
- 높은 동시성 필요

### 4-2) CopyOnWriteArrayList

```java
// 읽기가 많고 쓰기가 적을 때
List<Listener> listeners = new CopyOnWriteArrayList<>();
listeners.add(listener1);  // 복사 발생 (느림)
listeners.forEach(l -> l.onEvent());  // 반복 중 수정 안전
```

**언제 사용:**
- 읽기가 압도적으로 많고, 쓰기가 드물 때
- 이벤트 리스너 목록 등

## 5) 실전 선택 가이드

### 5-1) 상황별 컬렉션 선택 Cheat Sheet

> [!TIP]
> 5초 안에 결정하는 법:
> 1. 순서 중요? → **List** (대부분 `ArrayList`)
> 2. 중복 제거? → **Set** (`HashSet`)
> 3. Key-Value? → **Map** (`HashMap`)

### 5-2) 자주 하는 실수 (Performance Anti-patterns)

> [!WARNING]
> **Anti-pattern 1: 초기 용량(Initial Capacity) 무시**
> `new ArrayList<>()`는 크기가 찰 때마다 배열을 2배로 늘리고 데이터를 **복사**합니다. 데이터 개수를 안다면 `new ArrayList<>(10000)`처럼 지정하세요.

```java
// ❌ 실수: 여러 번 재할당 발생
Map<String, User> users = new HashMap<>(); 
// ✅ 수정: 초기 용량 지정
Map<String, User> users = new HashMap<>(10000);
```

> [!WARNING]
> **Anti-pattern 2: `contains()` 남발**
> `ArrayList.contains()`는 $O(n)$입니다. 반복문 안에서 쓰면 $O(n^2)$이 됩니다. 존재 여부 확인은 **Set**($O(1)$)을 쓰세요.

### 5-3) 성능 체크리스트

```java
// 1️⃣ 초기 용량 지정
List<String> list = new ArrayList<>(expectedSize);
Map<String, Integer> map = new HashMap<>(expectedSize);

// 2️⃣ 적절한 컬렉션 선택
// 조회 많음 → ArrayList, HashMap
// 정렬 필요 → TreeSet, TreeMap
// 순서 유지 → LinkedHashSet, LinkedHashMap

// 3️⃣ 불변 컬렉션 (읽기 전용)
List<String> immutable = List.of("a", "b", "c");  // Java 9+
Set<Integer> immutableSet = Set.of(1, 2, 3);
Map<String, Integer> immutableMap = Map.of("a", 1, "b", 2);

// 4️⃣ Stream API 활용
List<String> filtered = list.stream()
    .filter(s -> s.startsWith("A"))
    .collect(Collectors.toList());
```

## 6) 컬렉션 유틸리티

```java
// Collections 유틸리티
Collections.sort(list);                          // 정렬
Collections.reverse(list);                       // 역순
Collections.shuffle(list);                       // 랜덤 섞기
Collections.frequency(list, "Apple");            // 빈도 수
Collections.max(list);                           // 최댓값
Collections.unmodifiableList(list);              // 읽기 전용

// Arrays 유틸리티
List<String> list = Arrays.asList("a", "b", "c");  // 배열 → 리스트 (고정 크기)
String[] array = list.toArray(new String[0]);      // 리스트 → 배열

// 비교: asList vs List.of (Java 9+)
List<String> mutable = new ArrayList<>(Arrays.asList("a", "b"));  // 수정 가능
List<String> immutable = List.of("a", "b");                       // 수정 불가
```

## 연습 (추천)

1. ArrayList와 LinkedList의 성능 차이를 직접 측정해보기
   - 10만 개 데이터 삽입/조회 시간 비교

2. HashMap 초기 용량에 따른 성능 차이 확인
   - 용량 지정 vs 미지정, 1만 개 데이터 삽입 시간

3. ConcurrentHashMap의 동시성 테스트
   - 여러 스레드에서 동시에 put/get 실행

4. 실무 코드에서 컬렉션 선택이 적절한지 검토
   - contains() 반복 사용 → Set으로 변경
   - HashMap 초기 용량 미지정 → 용량 지정

## 요약: 스스로 점검할 것

- List/Set/Map의 차이와 시간 복잡도를 설명할 수 있다
- ArrayList vs LinkedList 선택 기준을 말할 수 있다 (대부분 ArrayList)
- HashMap vs TreeMap 선택 기준을 말할 수 있다 (정렬 필요 시 TreeMap)
- 멀티스레드 환경에서 ConcurrentHashMap을 사용할 수 있다
- 초기 용량 지정으로 성능을 최적화할 수 있다

## 다음 단계

- Java Stream/Optional: `/learning/deep-dive/deep-dive-java-stream-optional/`
- Java 동시성 기초: `/learning/deep-dive/deep-dive-java-concurrency-basics/`
- 자료구조 복잡도: `/learning/deep-dive/deep-dive-data-structure-complexity/`
