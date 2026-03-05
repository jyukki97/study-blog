---
title: "Spring 트랜잭션 (Part 2: Propagation, 실무 주의사항)"
study_order: 717
date: 2025-12-01
topic: "Spring"
topic_icon: "💬"
topic_description: "@Transactional, Propagation, Isolation Level 관련 핵심 개념과 실전 예제 정리"
tags: ["Spring", "Transaction", "ACID", "Database"]
categories: ["Backend"]
description: "Transaction Propagation 종류별 동작, REQUIRES_NEW vs NESTED, 실무 주의사항 Q&A"
draft: false
module: "qna"
---

## Q2. Transaction Propagation은 무엇인가요?

### 답변

**Propagation (전파)**은 **트랜잭션 메서드가 다른 트랜잭션 메서드를 호출할 때의 동작 방식**을 정의합니다.

### 7가지 Propagation

**1. REQUIRED (기본값)**:

```java
// ✅ REQUIRED: 기존 트랜잭션 사용, 없으면 새로 생성
@Transactional(propagation = Propagation.REQUIRED)
public void methodA() {
    methodB();  // methodB도 같은 트랜잭션 사용
}

@Transactional(propagation = Propagation.REQUIRED)
public void methodB() {
    // methodA와 같은 트랜잭션
}

// 실행 흐름:
// methodA() 시작 → 트랜잭션 T1 생성
//   → methodB() 호출 → T1 재사용 (새로 생성 X)
//   → methodB() 완료 → T1 유지
// → methodA() 완료 → T1 커밋
```

**문제**: methodB()에서 예외 발생 시 methodA()도 롤백

```java
@Transactional
public void methodA() {
    userRepository.save(user1);  // 저장됨
    try {
        methodB();  // 예외 발생
    } catch (Exception e) {
        // 예외 처리
    }
    userRepository.save(user2);  // 저장 시도
}

@Transactional
public void methodB() {
    throw new RuntimeException("Error");
}

// 결과:
// methodB()에서 예외 → 트랜잭션 rollback-only 마킹
// → methodA()의 user1, user2 모두 롤백! ⚠️
```

**2. REQUIRES_NEW**:

```java
// ✅ REQUIRES_NEW: 항상 새 트랜잭션 생성
@Transactional
public void methodA() {
    userRepository.save(user1);
    try {
        methodB();  // 새 트랜잭션에서 실행
    } catch (Exception e) {
        // methodB 롤백되어도 methodA는 영향 없음
    }
    userRepository.save(user2);
}

@Transactional(propagation = Propagation.REQUIRES_NEW)
public void methodB() {
    orderRepository.save(order);
    throw new RuntimeException("Error");
}

// 실행 흐름:
// methodA() 시작 → 트랜잭션 T1 생성
//   → user1 저장 (T1)
//   → methodB() 호출 → 트랜잭션 T2 생성 (T1 일시 중단)
//     → order 저장 (T2)
//     → 예외 발생 → T2 롤백 (order 롤백)
//   → T1 재개
//   → user2 저장 (T1)
// → methodA() 완료 → T1 커밋 (user1, user2 커밋)

// 결과:
// user1: 저장 ✅
// user2: 저장 ✅
// order: 롤백 ❌
```

**사용 사례**: 감사 로그 저장

```java
@Transactional
public void processOrder(Order order) {
    orderRepository.save(order);

    try {
        auditService.saveLog(order);  // 별도 트랜잭션
    } catch (Exception e) {
        // 로그 저장 실패해도 주문은 저장
    }
}

@Service
public class AuditService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveLog(Order order) {
        auditLogRepository.save(new AuditLog(order));
        // 별도 트랜잭션이므로 주문과 독립적
    }
}
```

**3. NESTED**:

```java
// ✅ NESTED: 중첩 트랜잭션 (Savepoint 사용)
@Transactional
public void methodA() {
    userRepository.save(user1);  // 커밋됨

    try {
        methodB();  // Savepoint 생성
    } catch (Exception e) {
        // methodB만 롤백, methodA는 계속 진행
    }

    userRepository.save(user2);  // 커밋됨
}

@Transactional(propagation = Propagation.NESTED)
public void methodB() {
    orderRepository.save(order);
    throw new RuntimeException("Error");
}

// 실행 흐름:
// methodA() 시작 → 트랜잭션 T1 생성
//   → user1 저장 (T1)
//   → methodB() 호출 → Savepoint S1 생성
//     → order 저장 (T1)
//     → 예외 발생 → S1으로 롤백 (order만 롤백)
//   → user2 저장 (T1)
// → methodA() 완료 → T1 커밋 (user1, user2)

// 결과:
// user1: 저장 ✅
// user2: 저장 ✅
// order: 롤백 ❌
```

**REQUIRES_NEW vs NESTED**:

| 특징 | REQUIRES_NEW | NESTED |
|------|--------------|--------|
| 트랜잭션 | 완전히 새로운 트랜잭션 | 외부 트랜잭션의 일부 |
| 커밋 | 독립적으로 커밋 | 외부 트랜잭션과 함께 커밋 |
| 롤백 | 서로 영향 없음 | 내부만 롤백 가능 |
| DB 지원 | 모든 DB | Savepoint 지원 DB만 |

**4. SUPPORTS**:

```java
// ✅ SUPPORTS: 트랜잭션 있으면 사용, 없어도 OK
@Transactional(propagation = Propagation.SUPPORTS)
public void methodB() {
    // 트랜잭션 있으면 사용, 없으면 트랜잭션 없이 실행
}

// Case 1: 트랜잭션 O
@Transactional
public void methodA() {
    methodB();  // methodA의 트랜잭션 사용
}

// Case 2: 트랜잭션 X
public void methodA() {
    methodB();  // 트랜잭션 없이 실행
}
```

**5. NOT_SUPPORTED**:

```java
// ✅ NOT_SUPPORTED: 트랜잭션 없이 실행
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public void methodB() {
    // 항상 트랜잭션 없이 실행
}

@Transactional
public void methodA() {
    methodB();  // methodA의 트랜잭션 일시 중단
}
```

**6. MANDATORY**:

```java
// ✅ MANDATORY: 트랜잭션 필수 (없으면 예외)
@Transactional(propagation = Propagation.MANDATORY)
public void methodB() {
    // 트랜잭션 없으면 IllegalTransactionStateException
}

// ❌ 예외 발생
public void methodA() {
    methodB();  // 트랜잭션 없음 → 예외!
}

// ✅ 정상
@Transactional
public void methodA() {
    methodB();  // 트랜잭션 있음 → 정상
}
```

**7. NEVER**:

```java
// ✅ NEVER: 트랜잭션이 있으면 예외
@Transactional(propagation = Propagation.NEVER)
public void methodB() {
    // 트랜잭션 있으면 IllegalTransactionStateException
}

// ❌ 예외 발생
@Transactional
public void methodA() {
    methodB();  // 트랜잭션 있음 → 예외!
}

// ✅ 정상
public void methodA() {
    methodB();  // 트랜잭션 없음 → 정상
}
```

### Propagation 요약

| Propagation | 기존 트랜잭션 있음 | 기존 트랜잭션 없음 | 사용 사례 |
|-------------|-------------------|-------------------|-----------|
| REQUIRED | 재사용 | 새로 생성 | 기본 (99%) |
| REQUIRES_NEW | 새로 생성 | 새로 생성 | 독립 트랜잭션 |
| NESTED | Savepoint | 새로 생성 | 부분 롤백 |
| SUPPORTS | 재사용 | 트랜잭션 X | 읽기 작업 |
| NOT_SUPPORTED | 일시 중단 | 트랜잭션 X | 성능 최적화 |
| MANDATORY | 재사용 | 예외 | 트랜잭션 강제 |
| NEVER | 예외 | 트랜잭션 X | 트랜잭션 금지 |

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: Spring 트랜잭션 (Part 1: 기본 동작과 원리)](/learning/qna/spring-transaction-qna/)**
