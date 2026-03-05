---
title: "Spring 트랜잭션 (Part 1: 기본 동작과 원리)"
study_order: 717
date: 2025-12-01
topic: "Spring"
topic_icon: "💬"
topic_description: "@Transactional, Propagation, Isolation Level 관련 핵심 개념과 실전 예제 정리"
tags: ["Spring", "Transaction", "ACID", "Database"]
categories: ["Backend"]
description: "@Transactional 동작 원리, AOP 프록시, Isolation Level 기본 개념 Q&A"
draft: false
module: "qna"
---

# Spring Transaction 관리 정리

## Q1. @Transactional은 어떻게 동작하나요?

### 답변

**@Transactional**은 **Spring AOP를 이용한 선언적 트랜잭션 관리**로, 프록시 패턴으로 구현됩니다.

### 동작 원리

**프록시 생성**:

```java
// 원본 클래스
@Service
public class UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}

// Spring이 생성하는 Proxy (실제로는 바이트코드 조작)
public class UserServiceProxy extends UserService {
    private TransactionManager transactionManager;

    @Override
    public void createUser(User user) {
        TransactionStatus status = transactionManager.getTransaction(...);

        try {
            super.createUser(user);  // 실제 메서드 호출
            transactionManager.commit(status);  // 커밋
        } catch (Exception e) {
            transactionManager.rollback(status);  // 롤백
            throw e;
        }
    }
}
```

**실행 흐름**:

```
1. Client가 UserService.createUser() 호출
   ↓
2. Proxy가 호출 가로챔
   ↓
3. TransactionManager.getTransaction() (트랜잭션 시작)
   ↓
4. 실제 createUser() 실행
   ↓
5. 예외 발생?
   Yes → rollback()
   No → commit()
```

### 프록시 방식

**1. JDK Dynamic Proxy (인터페이스 기반)**:

```java
// ✅ 인터페이스 있음
public interface UserService {
    void createUser(User user);
}

@Service
public class UserServiceImpl implements UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}

// → JDK Dynamic Proxy 사용
```

**2. CGLIB Proxy (클래스 기반)**:

```java
// ✅ 인터페이스 없음
@Service
public class UserService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}

// → CGLIB Proxy 사용 (서브클래스 생성)
```

### Self-Invocation 문제

**문제 상황**:

```java
@Service
public class UserService {
    // ❌ Self-Invocation: 프록시를 거치지 않음!
    public void registerUser(User user) {
        validateUser(user);
        createUser(user);  // 같은 클래스 내부 호출 → 프록시 X
    }

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
        // @Transactional이 동작하지 않음! ⚠️
    }
}

// 실행 흐름:
// Client → Proxy → registerUser() (프록시 통과)
//   → createUser() (내부 호출, 프록시 X)
//   → @Transactional 동작 안 함! ⚠️
```

**해결 1: 메서드 분리**:

```java
// ✅ 다른 클래스로 분리
@Service
public class UserService {
    @Autowired
    private UserTransactionService transactionService;

    public void registerUser(User user) {
        validateUser(user);
        transactionService.createUser(user);  // 다른 클래스 호출 → 프록시 O
    }
}

@Service
public class UserTransactionService {
    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
        // @Transactional 정상 동작! ✅
    }
}
```

**해결 2: Self-Injection**:

```java
// ✅ 자기 자신을 주입받아 프록시 호출
@Service
public class UserService {
    @Autowired
    private UserService self;  // 프록시 주입

    public void registerUser(User user) {
        validateUser(user);
        self.createUser(user);  // 프록시를 통한 호출 → @Transactional 동작!
    }

    @Transactional
    public void createUser(User user) {
        userRepository.save(user);
    }
}
```

### 꼬리 질문 1: @Transactional의 기본 설정은?

**기본값**:

```java
@Transactional(
    propagation = Propagation.REQUIRED,      // 전파 레벨
    isolation = Isolation.DEFAULT,           // 격리 레벨
    timeout = -1,                            // 타임아웃 (무제한)
    readOnly = false,                        // 읽기 전용
    rollbackFor = {},                        // 롤백 예외
    noRollbackFor = {}                       // 롤백 안 할 예외
)
```

**rollbackFor 주의**:

```java
// ❌ Checked Exception은 기본적으로 롤백 안 됨!
@Transactional
public void createUser(User user) throws Exception {
    userRepository.save(user);
    throw new Exception("Error");  // 롤백 안 됨! ⚠️
}

// ✅ rollbackFor 명시
@Transactional(rollbackFor = Exception.class)
public void createUser(User user) throws Exception {
    userRepository.save(user);
    throw new Exception("Error");  // 롤백됨! ✅
}

// 기본 동작:
// RuntimeException, Error → 롤백 O
// Checked Exception (Exception 등) → 롤백 X
```

### 꼬리 질문 2: readOnly = true의 효과는?

**readOnly = true**: 읽기 전용 트랜잭션 (최적화)

```java
// ✅ readOnly = true
@Transactional(readOnly = true)
public List<User> findAll() {
    return userRepository.findAll();
}

// 효과:
// 1. Hibernate: flush 모드를 MANUAL로 설정 (변경 감지 X)
// 2. DB: 읽기 전용 힌트 전달 (DB 최적화)
// 3. MySQL: 읽기 전용 Slave로 라우팅 가능
```

**주의**:

```java
// ❌ readOnly = true인데 쓰기 작업
@Transactional(readOnly = true)
public void updateUser(User user) {
    userRepository.save(user);
    // → 예외 발생하거나 무시됨 (DB에 따라 다름)
}
```

---


---

👉 **[다음 편: Spring 트랜잭션 (Part 2: Propagation, 실무 주의사항)](/learning/qna/spring-transaction-qna-part2/)**
