---
title: "Java 동시성 기초: Thread, Executor, Lock"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Java", "Concurrency", "Executor", "Lock", "ThreadPool"]
categories: ["Backend Deep Dive"]
description: "스레드, Executor, Lock 기본기를 잡고 안전한 동시성 코드를 작성하기 위한 체크리스트"
module: "foundation"
study_order: 20
---

## 핵심 개념

- **Thread 생성/수명주기**: new → runnable → running → terminated
- **Executor**: 스레드풀로 작업 제출 (`submit()`, `execute()`), 큐 적재/거부 정책
- **Lock/동시성 컬렉션**: `ReentrantLock`, `ReadWriteLock`, `ConcurrentHashMap`
- **가시성/원자성**: `volatile`, `Atomic*`, happens-before

### 스레드풀 선택 가이드

- CPU 바운드: `newFixedThreadPool(n_cores)` 혹은 명시적 ThreadPoolExecutor (core=max)
- IO 바운드: core는 CPU보다 크게, 큐 크기/거부 정책 설정 필수
- 블로킹 작업 분리: IO 전용 풀, 타임아웃과 취소 경로 제공

## 코드 스니펫

```java
ExecutorService pool = new ThreadPoolExecutor(
    4, 8,
    60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy() // 거부 시 호출 스레드가 실행
);

Lock lock = new ReentrantLock();
Map<String, Integer> counter = new ConcurrentHashMap<>();

void increase(String key) {
    lock.lock();
    try {
        counter.merge(key, 1, Integer::sum);
    } finally {
        lock.unlock();
    }
}
```

```java
// 종료 시그널 처리
pool.shutdown();
pool.awaitTermination(10, TimeUnit.SECONDS);
```

## 체크리스트

- [ ] 스레드풀 생성 시 core/max/queue/거부 정책을 명시적으로 설정했는가?
- [ ] 공유 상태는 동시성 컬렉션 + 락/원자 연산으로 보호되는가?
- [ ] 긴 블로킹 작업은 별도 풀로 분리했는가? (IO vs CPU)
- [ ] 종료 시 `shutdown()`/`awaitTermination()` 호출로 자원 해제하는가?
- [ ] `volatile`은 원자성이 아님을 기억하고 복합 연산에는 락/원자 클래스 사용

## 추가 학습

- Java Concurrency in Practice, Effective Java 아이템 78~82
