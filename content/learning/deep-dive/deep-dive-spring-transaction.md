---
title: "Spring Transaction: @Transactional 동작 원리와 실전 함정"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Transaction", "@Transactional", "Propagation", "Isolation"]
categories: ["Backend Deep Dive"]
description: "전파/격리/롤백 규칙과 프록시 동작, self-invocation/checked exception 같은 실무 함정을 한 번에 정리"
module: "data-system"
quizzes:
  - question: "Spring의 `@Transactional`에서 기본값으로 롤백(Rollback)되는 예외는 무엇인가?"
    options:
      - "Exception을 포함한 모든 예외"
      - "RuntimeException과 Error"
      - "IOException 같은 Checked Exception"
      - "SQLException만"
    answer: 1
    explanation: "Spring 트랜잭션은 기본적으로 Unchecked Exception (RuntimeException 및 Error) 발생 시에만 롤백하며, Checked Exception은 롤백하지 않습니다. (필요 시 `rollbackFor` 옵션 사용)"

  - question: "같은 서비스 클래스 내부에서 `@Transactional`이 붙은 메서드를 내부 호출(Self-Invocation)할 때 발생하는 문제는?"
    options:
      - "트랜잭션이 중첩되어 성능이 저하된다."
      - "프록시(Proxy)를 거치지 않고 직접 호출하므로 트랜잭션이 적용되지 않는다."
      - "무한 루프에 빠진다."
      - "데드락(Deadlock)이 발생한다."
    answer: 1
    explanation: "Spring AOP는 프록시 기반으로 동작하므로, 프록시를 통하지 않고 내부 인스턴스 메서드끼리 호출(`this.method()`) 하면 트랜잭션 어드바이스가 적용되지 않습니다."

  - question: "이미 트랜잭션이 진행 중일 때, 새로운 트랜잭션을 실행하지 않고 기존 트랜잭션에 합류(참여)하는 전파 속성(Propagation)은?"
    options:
      - "REQUIRES_NEW"
      - "REQUIRED"
      - "NESTED"
      - "SUPPORTS"
    answer: 1
    explanation: "`REQUIRED`는 기본 전파 속성으로, 이미 진행 중인 트랜잭션이 있으면 거기에 참여하고 없으면 새로 만듭니다."

  - question: "커밋되지 않은 데이터(Dirty Data)를 다른 트랜잭션에서 읽을 수 있는 가장 낮은 격리 수준(Isolation Level)은?"
    options:
      - "READ COMMITTED"
      - "REPEATABLE READ"
      - "SERIALIZABLE"
      - "READ UNCOMMITTED"
    answer: 3
    explanation: "`READ UNCOMMITTED`는 다른 트랜잭션이 아직 커밋하지 않은 변경 사항도 읽을 수 있어 Dirty Read가 발생할 수 있습니다."

  - question: "`@Transactional`을 붙여도 트랜잭션 처리가 되지 않는 메서드 접근 제어자는?"
    options:
      - "public"
      - "private"
      - "default (package-private) - (Spring 버전에 따라 다름)"
      - "protected - (Spring 버전에 따라 다름)"
    answer: 1
    explanation: "CGLIB/JDK Dynamic Proxy 기반의 Spring AOP는 외부에서 접근 가능한 `public` 메서드에만 적용되며, `private` 메서드에는 적용되지 않습니다."
study_order: 302
---

## 🎭 1. 마법의 애노테이션 @Transactional

`@Transactional`만 붙이면 DB 커넥션을 열고, 닫고, 커밋하고, 롤백하는 코드가 사라집니다.
이 마법은 **AOP 프록시(Proxy)** 덕분입니다.

### 프록시의 거짓말

여러분이 만든 `OrderService` 빈(Bean)은 사실 가짜(Proxy)입니다.

```mermaid
sequenceDiagram
    participant Client
    participant Proxy as "OrderService (Proxy)"
    participant TxManager as TransactionManager
    participant Target as "OrderService (Real)"
    
    Client->>Proxy: createOrder() 호출
    
    activate Proxy
    Proxy->>TxManager: 1. 트랜잭션 시작 (Begin)
    
    Proxy->>Target: 2. 실제 코드 실행 (createOrder)
    activate Target
    Target-->>Proxy: 리턴
    deactivate Target
    
    Proxy->>TxManager: 3. 커밋 또는 롤백
    Proxy-->>Client: 결과 반환
    deactivate Proxy
```

> ⚠️ **함정 1 (Self-Invocation)**: 자기 자신의 메소드를 내부 호출(this.method())하면 **프록시를 거치지 않습니다.** 그래서 트랜잭션이 적용되지 않습니다.

---

## 🌊 2. 전파 속성 (Propagation)

트랜잭션이 진행 중인데 또 트랜잭션을 만나면 어떻게 할까요?

### REQUIRED (기본값) vs REQUIRES_NEW

```mermaid
graph TD
    subgraph REQUIRED [Case A: REQUIRED (Default)]
    TX1[트랜잭션 1] ---|참여| TX2((Service B))
    TX2 -.->|예외 발생| Rollback[전체 롤백]
    end
    
    subgraph REQUIRES_NEW [Case B: REQUIRES_NEW]
    TX_A[트랜잭션 A] -.->|일시 정지| TX_B((New Tx))
    TX_B -->|성공| Commit_B[B만 커밋]
    TX_B -.->|실패| Rolback_B[B만 롤백]
    TX_A -->|재개| Commit_A[A는 계속 진행]
    end
```

- **REQUIRED**: "우린 한 배를 탔어." 자식에서 에러 나면 부모도 롤백됩니다.
- **REQUIRES_NEW**: "너는 너, 나는 나." 자식이 죽어도 부모는 살릴 수 있습니다. (예: 감사 로그 저장)

### Physical vs Logical Transaction

스프링은 **논리 트랜잭션**이라는 개념을 사용하여 트랜잭션 전파를 처리합니다.

```mermaid
graph TD
    subgraph Physical_Transaction ["Physical Transaction (DB Connection)"]
        Tx_Outer["Logical Tx: Service A (Outer)"]
        Tx_Inner["Logical Tx: Service B (Inner)"]
        
        Tx_Outer ---|"REQUIRED"| Tx_Inner
    end
    
    Tx_Inner -.->|"Rollback Mark"| Physical_Transaction
    Physical_Transaction -->|"Commit Failed"| DB[("Database")]
    
    style Physical_Transaction fill:#e3f2fd,stroke:#2196f3
    style Tx_Outer fill:#fff9c4
    style Tx_Inner fill:#ffccbc
```

- **ALL OR NOTHING**: 논리 트랜잭션 중 **하나라도 롤백**되면, 물리 트랜잭션 전체가 롤백됩니다. (자식이 롤백 마크를 찍으면 부모가 커밋하려 해도 `UnexpectedRollbackException` 발생)

---

## 🛡️ 3. 격리 수준 (Isolation Level)

동시에 여러 요청이 들어올 때 데이터 정합성을 어디까지 지킬 것인가?

- **READ COMMITTED**: 커밋된 데이터만 읽는다. (가장 많이 씀)
- **REPEATABLE READ**: 트랜잭션 내내 같은 데이터를 읽는다. (MySQL 기본)
- **SERIALIZABLE**: 한 줄로 세운다. (성능 최악 but 안전 최고)

### Isolation Level Comparison

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | 성능 |
| :--- | :---: | :---: | :---: | :---: |
| **READ UNCOMMITTED** | O | O | O | 최상 (위험) |
| **READ COMMITTED** | X | O | O | 좋음 (표준) |
| **REPEATABLE READ** | X | X | O (InnoDB는 방지) | 보통 |
| **SERIALIZABLE** | X | X | X | 낮음 (Safe) |

> **Dirty Read**: 남이 커밋 안 한 똥(Dirty Data)을 읽음.
> **Phantom Read**: 아까는 없었는데 다시 조회를 하니 귀신(Phantom)처럼 데이터가 생김.

## 🚨 4. 실전 함정 TOP 3

1. **Checked Exception은 롤백 안 됨**: 기본적으로 `RuntimeException`만 롤백합니다.
    - 해결: `@Transactional(rollbackFor = Exception.class)`
2. **Private 메소드**: 프록시는 `public` 메소드만 오버라이딩 가능합니다. `private`에는 걸어도 무시됩니다.
3. **트랜잭션 범위**: 너무 길게 잡지 마세요. DB 커넥션을 오래 물고 있으면 전체 장애로 이어집니다.

## 요약

> [!TIP]
> **@Transactional Checklist**:
> - [ ] **Public Method**: `private`, `protected`에는 걸어도 작동 안 함.
> - [ ] **Self-Invocation**: 내부 호출(`this.method()`)은 프록시를 안 거침 -> 트랜잭션 적용 X.
> - [ ] **Exception**: `Checked Exception`(Ex. `IOException`)은 롤백 안 됨. `rollbackFor` 설정 필수.
> - [ ] **Transaction Scope**: 트랜잭션은 최대한 짧게. (외부 API 호출은 트랜잭션 밖으로 빼라)

1. **Proxy**: `@Transactional`은 AOP 프록시로 동작한다. (Self-invocation 조심)
2. **Propagation**: `REQUIRED`는 한 팀, `REQUIRES_NEW`는 별개 팀.
3. **Rollback**: 언체크 예외(RuntimeException)만 롤백된다. 체크 예외는 옵션 추가 필요.
