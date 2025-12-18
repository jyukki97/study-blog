---
title: "JVM 메모리 누수 디버깅: 힙 덤프 분석과 프로파일링"
date: 2025-12-16
draft: false
topic: "Java"
tags: ["JVM", "Memory Leak", "Heap Dump", "Profiling", "MAT", "VisualVM"]
categories: ["Backend Deep Dive"]
description: "메모리 누수를 진단하고 힙 덤프를 분석하여 원인을 찾는 실전 가이드"
module: "foundation"
study_order: 92
---

## 이 글에서 얻는 것

- **메모리 누수**의 원인과 증상을 이해합니다.
- **힙 덤프**를 생성하고 분석할 수 있습니다.
- **프로파일링 도구**(MAT, VisualVM)를 사용할 수 있습니다.
- **실전 디버깅 시나리오**를 해결할 수 있습니다.

## 0) 메모리 누수는 "서서히 죽는다"

### 메모리 누수란?

```
메모리 누수 (Memory Leak):
- 더 이상 사용하지 않는 객체가 GC되지 않음
- 시간이 지날수록 메모리 사용량 증가
- 결국 OutOfMemoryError 발생
```

**증상:**
- 애플리케이션이 점점 느려짐
- Full GC 빈번하게 발생
- 결국 OutOfMemoryError로 크래시
- 재시작하면 괜찮다가 다시 발생

### 전형적인 패턴

```java
// ❌ 메모리 누수 예시
public class CacheManager {
    private static final Map<String, User> cache = new HashMap<>();
    
    public void cacheUser(User user) {
        cache.put(user.getId(), user);  // 계속 쌓임!
        // 제거 로직 없음 → 메모리 누수
    }
}
```

## 1) 메모리 누수 감지

### 1-1) 증상 확인

**메모리 사용량 모니터링:**
```bash
# JVM 메모리 사용량 확인
jstat -gc <pid> 1000

# 결과:
# S0C    S1C    S0U    S1U      EC       EU        OC         OU
# 25600  25600  0.0    0.0    204800   150000    512000     480000
#                                                            ↑ Old Gen 계속 증가

# 반복 실행하면서 Old Generation이 계속 증가하는지 확인
```

**GC 로그 분석:**
```bash
# GC 로그 활성화
java -Xlog:gc*:file=gc.log -jar app.jar

# 로그 확인
cat gc.log | grep "Full GC"
# Full GC가 빈번하면서도 메모리가 줄지 않음 → 메모리 누수 의심
```

### 1-2) 힙 덤프 생성

**자동 생성 (OOM 발생 시):**
```bash
# OOM 발생 시 자동으로 힙 덤프 생성
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/tmp/heapdump.hprof \
     -jar app.jar
```

**수동 생성:**
```bash
# 1. PID 확인
jps

# 2. 힙 덤프 생성
jmap -dump:live,format=b,file=/tmp/heapdump.hprof <pid>

# 또는 jcmd 사용
jcmd <pid> GC.heap_dump /tmp/heapdump.hprof
```

## 2) Eclipse MAT로 힙 덤프 분석

### 2-1) MAT 설치 및 열기

```bash
# 다운로드
https://www.eclipse.org/mat/

# 힙 덤프 열기
File → Open Heap Dump → heapdump.hprof
```

### 2-2) Leak Suspects Report

```
MAT가 자동으로 의심스러운 메모리 누수 탐지:

"Problem Suspect 1":
- HashMap이 전체 힙의 60% 차지
- 500만 개의 User 객체 보유
- CacheManager에서 참조

→ CacheManager의 HashMap이 원인!
```

### 2-3) Dominator Tree

```
Dominator Tree:
- 어떤 객체가 메모리를 가장 많이 차지하는지

예시:
CacheManager                    60% (600MB)
└── HashMap                     60%
    └── User[]                  58%
        ├── User#1              0.01%
        ├── User#2              0.01%
        └── ...

→ HashMap이 User 객체를 계속 들고 있음
```

### 2-4) OQL (Object Query Language)

```sql
-- 모든 HashMap 찾기
SELECT * FROM java.util.HashMap

-- 크기가 10000 이상인 HashMap
SELECT * FROM java.util.HashMap WHERE size() > 10000

-- User 객체 찾기
SELECT * FROM com.example.User

-- 특정 클래스의 인스턴스 개수
SELECT COUNT(*) FROM com.example.User
```

## 3) VisualVM으로 실시간 모니터링

### 3-1) VisualVM 시작

```bash
# VisualVM 실행
jvisualvm

# 또는
<JAVA_HOME>/bin/jvisualvm
```

### 3-2) 힙 덤프 분석

```
1. 애플리케이션 선택
2. Monitor 탭:
   - Heap 사용량 실시간 확인
   - GC 실행 버튼으로 강제 GC
   
3. Sampler 탭:
   - CPU: 어떤 메서드가 많이 실행되는지
   - Memory: 어떤 객체가 많이 생성되는지
   
4. Heap Dump:
   - "Heap Dump" 버튼 클릭
   - Classes 탭에서 인스턴스 수 확인
```

### 3-3) 프로파일링

```
Profiler 탭:
- Memory 프로파일링 시작
- 애플리케이션 사용
- 결과 확인:
  - 어떤 클래스가 많이 생성됐는지
  - 어디서 할당됐는지 (Allocation Stack Trace)
```

## 4) 전형적인 메모리 누수 패턴

### 4-1) Static 컬렉션

```java
// ❌ 메모리 누수
public class UserCache {
    private static final Map<String, User> CACHE = new HashMap<>();
    
    public void addUser(User user) {
        CACHE.put(user.getId(), user);
        // 제거 로직 없음!
    }
}

// ✅ 해결: 크기 제한 + TTL
public class UserCache {
    private static final Map<String, User> CACHE = new ConcurrentHashMap<>();
    private static final int MAX_SIZE = 10000;
    
    public void addUser(User user) {
        if (CACHE.size() >= MAX_SIZE) {
            // LRU 방식으로 가장 오래된 항목 제거
            String oldestKey = findOldestKey();
            CACHE.remove(oldestKey);
        }
        CACHE.put(user.getId(), user);
    }
}

// 또는 Caffeine Cache 사용
LoadingCache<String, User> cache = Caffeine.newBuilder()
    .maximumSize(10000)
    .expireAfterWrite(Duration.ofHours(1))
    .build(key -> userRepository.findById(key));
```

### 4-2) 리스너 미제거

```java
// ❌ 메모리 누수
public class EventManager {
    private List<EventListener> listeners = new ArrayList<>();
    
    public void addListener(EventListener listener) {
        listeners.add(listener);
        // 제거하지 않으면 계속 쌓임!
    }
}

// ✅ 해결: 명시적 제거
public class EventManager {
    private List<EventListener> listeners = new ArrayList<>();
    
    public void addListener(EventListener listener) {
        listeners.add(listener);
    }
    
    public void removeListener(EventListener listener) {
        listeners.remove(listener);
    }
}

// 또는 WeakReference 사용
private List<WeakReference<EventListener>> listeners = new ArrayList<>();
```

### 4-3) ThreadLocal 미정리

```java
// ❌ 메모리 누수
public class UserContext {
    private static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();
    
    public static void setUser(User user) {
        CURRENT_USER.set(user);
        // 제거 안 함 → 스레드 풀 환경에서 누수!
    }
}

// ✅ 해결: 명시적 정리
public class UserContext {
    private static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();
    
    public static void setUser(User user) {
        CURRENT_USER.set(user);
    }
    
    public static void clear() {
        CURRENT_USER.remove();  // 반드시 정리!
    }
}

// Filter에서 사용
public class UserContextFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
        try {
            User user = extractUser(request);
            UserContext.setUser(user);
            chain.doFilter(request, response);
        } finally {
            UserContext.clear();  // 반드시!
        }
    }
}
```

### 4-4) 스트림 미종료

```java
// ❌ 메모리 누수 (파일 핸들 누수)
public List<String> readLines(String path) {
    return Files.lines(Paths.get(path))
        .collect(Collectors.toList());
    // Stream이 닫히지 않음!
}

// ✅ 해결: try-with-resources
public List<String> readLines(String path) throws IOException {
    try (Stream<String> lines = Files.lines(Paths.get(path))) {
        return lines.collect(Collectors.toList());
    }
}
```

## 5) 실전 디버깅 시나리오

### 시나리오: OOM 발생

**1. 증상 확인**
```
java.lang.OutOfMemoryError: Java heap space
```

**2. 힙 덤프 분석**
```bash
jmap -dump:live,format=b,file=dump.hprof <pid>
```

**3. MAT로 열기**
- Leak Suspects Report 확인
- Dominator Tree에서 큰 객체 탐색

**4. 원인 파악**
```
HashMap이 600MB 차지
└── 500만 개의 Session 객체

원인: 세션이 만료되지 않고 계속 쌓임
```

**5. 수정**
```java
// Before
private static final Map<String, Session> sessions = new HashMap<>();

// After: TTL 추가
private static final Cache<String, Session> sessions = Caffeine.newBuilder()
    .expireAfterAccess(Duration.ofMinutes(30))
    .maximumSize(100000)
    .build();
```

## 6) 프로덕션 환경 팁

### ✅ 1. JVM 옵션 설정

```bash
java -Xms2g \
     -Xmx4g \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/log/app/heapdump.hprof \
     -XX:+PrintGCDetails \
     -XX:+PrintGCDateStamps \
     -Xlog:gc*:file=/var/log/app/gc.log \
     -jar app.jar
```

### ✅ 2. 모니터링 설정

```yaml
# Spring Boot Actuator
management:
  metrics:
    enable:
      jvm: true
  endpoint:
    metrics:
      enabled: true
```

### ✅ 3. 주기적인 점검

```bash
# 메모리 사용량 추이 확인
jstat -gc <pid> 60000 | tee -a memory-usage.log

# 스레드 덤프
jstack <pid> > thread-dump.txt
```

## 연습 (추천)

1. **메모리 누수 재현**
   - Static Map에 객체 계속 추가
   - 힙 덤프 생성 및 분석

2. **MAT 사용**
   - Dominator Tree 탐색
   - OQL로 객체 검색

3. **수정 및 검증**
   - 메모리 누수 수정
   - 재실행 후 메모리 안정화 확인

## 요약

- 메모리 누수는 GC되지 않는 객체가 쌓이는 현상
- 힙 덤프로 메모리 상태 분석 가능
- MAT, VisualVM으로 원인 파악
- Static 컬렉션, 리스너, ThreadLocal 주의
- 프로덕션에서 OOM 시 자동 덤프 설정 필수

## 다음 단계

- GC 튜닝: `/learning/deep-dive/deep-dive-gc-tuning-practical/`
- JVM 메모리: `/learning/deep-dive/deep-dive-jvm-memory/`
- Java 동시성: `/learning/deep-dive/deep-dive-java-concurrency-basics/`
