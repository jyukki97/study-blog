---
title: "MySQL 트랜잭션 격리 수준과 락"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["MySQL", "Isolation", "Lock", "InnoDB"]
categories: ["Backend Deep Dive"]
description: "READ COMMITTED/REPEATABLE READ 차이, Gap/Next-Key Lock과 데드락 예방법"
module: "data-system"
quizzes:
  - question: "MySQL InnoDB의 기본 트랜잭션 격리 수준(Isolation Level)은?"
    options:
      - "READ UNCOMMITTED"
      - "READ COMMITTED"
      - "REPEATABLE READ"
      - "SERIALIZABLE"
    answer: 2
    explanation: "InnoDB의 기본 격리 수준은 REPEATABLE READ입니다. 이는 트랜잭션 시작 시점의 스냅샷을 유지하여 같은 트랜잭션 내에서 일관된 읽기를 보장합니다."

  - question: "InnoDB MVCC(Multi-Version Concurrency Control)의 핵심 원리는?"
    options:
      - "모든 읽기에 배타적 락을 건다."
      - "Undo Log를 사용하여 과거 버전 데이터를 관리하고, 락 없이도 일관된 읽기를 제공한다."
      - "모든 트랜잭션을 순차적으로 실행한다."
      - "WAL(Write-Ahead Logging)을 사용하지 않는다."
    answer: 1
    explanation: "MVCC는 데이터 변경 시 Undo Log에 이전 버전을 저장하고, 일반 SELECT는 락 없이 필요한 스냅샷 버전을 읽습니다. 이를 통해 읽기와 쓰기 간의 블로킹을 최소화합니다."

  - question: "InnoDB의 '넥스트키 락(Next-Key Lock)'은 무엇을 잠그는가?"
    options:
      - "테이블 전체"
      - "특정 인덱스 레코드와 그 앞/뒤의 '갭(Gap)'을 함께 잠금"
      - "트랜잭션 ID"
      - "Undo Log 영역"
    answer: 1
    explanation: "넥스트키 락은 레코드 락 + 갭 락의 조합으로, 범위 조건 조회 시 새로운 레코드 삽입(팬텀)을 방지합니다. 인덱스를 잘 타지 못하면 락 범위가 넓어져 성능 저하를 유발합니다."

  - question: "데드락(Deadlock)이 발생했을 때 일반적인 애플리케이션 처리 방법은?"
    options:
      - "데이터베이스를 재시작한다."
      - "트랜잭션을 더 길게 유지하여 락을 오래 잡는다."
      - "DB가 한쪽 트랜잭션을 롤백하면, 애플리케이션은 짧은 대기(backoff) 후 재시도한다."
      - "모든 쿼리에서 인덱스를 제거한다."
    answer: 2
    explanation: "데드락은 DB가 자동으로 감지하여 한쪽 트랜잭션을 롤백합니다. 애플리케이션은 이를 예외로 받아 짧은 지연 후 재시도하면 됩니다. 재시도가 안전하려면 로직이 멱등해야 합니다."

  - question: "데드락을 예방/완화하기 위한 설계 원칙이 아닌 것은?"
    options:
      - "여러 레코드를 갱신할 때 항상 동일한 순서로 접근한다."
      - "트랜잭션 내에서 외부 API 호출을 많이 수행한다."
      - "적절한 인덱스로 락 범위를 좁힌다."
      - "트랜잭션을 짧게 유지한다."
    answer: 1
    explanation: "트랜잭션 내에서 외부 호출(네트워크 I/O)을 하면 트랜잭션 시간이 길어지고 락 점유 시간이 늘어나 데드락 및 락 대기 가능성이 크게 증가합니다. 이는 피해야 할 안티 패턴입니다."
study_order: 306
---

## 이 글에서 얻는 것

- 격리 수준(READ COMMITTED / REPEATABLE READ)이 “용어”가 아니라, 어떤 현상(팬텀/락 범위/재시도)으로 이어지는지 이해할 수 있습니다.
- InnoDB의 MVCC(스냅샷)와 락(레코드/갭/넥스트키)을 연결해서 설명할 수 있습니다.
- 데드락/락 대기를 만났을 때 원인을 추적하고(로그/상태), 재시도/설계로 완화할 수 있습니다.

## 0) 격리 수준은 “정합성 ↔ 동시성” 트레이드오프다

정합성을 더 강하게 잡을수록, 락/대기/경합이 늘어 동시 처리량이 떨어질 수 있습니다.
반대로 동시성을 높이면, 읽기/쓰기에서 “기대하지 않은 현상”이 나타날 수 있습니다.

그래서 격리 수준은 “무조건 높게”가 아니라, 요구사항에 맞춰 선택합니다.

## 1) InnoDB MVCC: 락 없이도 ‘일관된 읽기’를 만든다

InnoDB는 MVCC로 “스냅샷 기반 읽기(consistent read)”를 제공합니다.

- 같은 트랜잭션에서 같은 데이터를 다시 읽으면, 보통 같은 값을 봅니다(REPEATABLE READ에서 특히)
- 이때 모든 읽기가 락을 거는 건 아닙니다(일반 SELECT는 보통 락 없는 읽기)

반대로 “잠그고 읽기”가 필요할 때는:

- `SELECT ... FOR UPDATE`
- `SELECT ... LOCK IN SHARE MODE`

같은 문장을 사용합니다(요구사항/락 강도에 따라).

### 1-1) MVCC 동작 시각화 (REPEATABLE READ)

트랜잭션이 시작될 때 스냅샷을 만들어두고, 그 시점 이후의 변경사항은 Undo Log를 통해 과거 버전을 읽습니다.

```mermaid
sequenceDiagram
    participant Tx A (Reader)
    participant DB (Row X)
    participant Tx B (Writer)
    
    Tx A (Reader)->>DB: Start Transaction
    Tx A (Reader)->>DB: Read Row X (Value: 100)
    Note right of Tx A (Reader): Snapshot Created (V1)
    
    Tx B (Writer)->>DB: Update Row X = 200
    Tx B (Writer)->>DB: Commit (New Version V2)
    
    Tx A (Reader)->>DB: Read Row X again
    DB-->>Tx A (Reader): Return Value: 100 (from Undo Log)
    Note right of Tx A (Reader): Consistent Read (V1)
```

## 2) 격리 수준 핵심(실무 감각)

### READ COMMITTED

- “커밋된 최신 버전”을 읽습니다.
- 같은 트랜잭션에서 다시 읽었을 때 값이 바뀔 수 있습니다(Non-repeatable read 가능).
- 범위 락(갭 락)이 상대적으로 줄어드는 경향이 있어 경합이 줄 수 있지만, 정합성 요구사항에 따라 주의가 필요합니다.

### REPEATABLE READ(InnoDB 기본)

- 트랜잭션 시작 시점(또는 첫 읽기 시점)의 스냅샷을 유지해 “같은 트랜잭션에서 같은 읽기 결과”를 보장하는 편입니다.
- 범위 조회/잠금 읽기에서 **갭/넥스트키 락**이 동작하면서, 예상보다 락 범위가 커질 수 있습니다.

### SERIALIZABLE

- 가장 강한 격리(동시성이 크게 떨어질 수 있음)
- 일반 SELECT도 락을 동반하는 형태가 될 수 있어, 일반적인 OLTP에서는 신중하게 접근합니다.

## 3) 락 유형: 레코드/갭/넥스트키

InnoDB에서 자주 등장하는 락:

- **레코드 락(Record lock)**: 특정 인덱스 레코드를 잠금
- **갭 락(Gap lock)**: 인덱스 레코드 “사이 구간”을 잠금(새로운 레코드 삽입을 막음)
- **넥스트키 락(Next-key lock)**: 레코드 + 앞/뒤 갭을 함께 잠금(범위 조건에서 자주 등장)

여기서 중요한 실전 포인트:

- 인덱스를 제대로 타지 못하면(풀스캔/범위 확대) 락 범위가 커져 락 대기가 늘어납니다.
- “범위 조건”과 “정렬/인덱스” 설계가 곧 락 범위를 결정합니다.

```mermaid
graph LR
    subgraph Index Line
    R10((Record 10)) --- Gap1(Gap) --- R20((Record 20))
    end
    
    Lock1[Record Lock] --> R10
    Lock2[Gap Lock] --> Gap1
    Lock3[Next-Key Lock] --> Gap1 & R20
    
    style Lock1 fill:#90caf9,stroke:#1565c0
    style Lock2 fill:#ffcc80,stroke:#ef6c00
    style Lock3 fill:#ef9a9a,stroke:#c62828
```

## 4) 데드락: 피할 수 없고, 다루는 기술이 필요하다

데드락은 “버그”라기보다 동시성 높은 시스템에서 자연스럽게 나타날 수 있습니다.
중요한 건 “0으로 만들기”보다 “자주 안 나게 + 나도 안전하게”입니다.

예방/완화 패턴:

- **접근 순서 고정**: 여러 레코드를 갱신할 때 항상 같은 순서로 접근
- **트랜잭션을 짧게**: 트랜잭션 안에서 외부 호출/긴 로직 금지
- **락 범위 축소**: 적절한 인덱스로 범위 락을 줄이기
- **재시도**: 데드락은 DB가 한쪽을 롤백시키므로, 애플리케이션은 짧은 backoff 후 재시도(멱등성 필수)

### 4-1) 데드락 시나리오 시각화

가장 흔한 교차 잠금(Cross Locking) 상황입니다.

```mermaid
sequenceDiagram
    participant Tx 1
    participant DB
    participant Tx 2
    
    Tx 1->>DB: Lock Record A (Success)
    Tx 2->>DB: Lock Record B (Success)
    
    Tx 1->>DB: Request Lock B
    Note right of Tx 1: Blocked (Waiting for Tx 2)
    
    Tx 2->>DB: Request Lock A
    Note left of Tx 2: Blocked (Waiting for Tx 1)
    
    DB->>Tx 2: Deadlock Detected! Rollback Tx 2
    DB-->>Tx 1: Grant Lock B (Tx 1 Correctly Proceeds)
```

## 5) 장애 분석: 락 대기/데드락을 어떻게 본다

실무에서는 다음이 빠릅니다.

- “지금 누가 누구를 막고 있나”를 확인(락 대기)
- 데드락이면 “어떤 쿼리 순서로 꼬였나”를 확인

자주 쓰는 도구/명령(환경에 따라):

- `SHOW ENGINE INNODB STATUS` (최근 데드락 정보)
- performance_schema의 락/트랜잭션 테이블

## 연습(추천)

- 두 세션에서 같은 두 레코드를 “서로 다른 순서”로 업데이트해서 데드락을 재현해보기
- 범위 조건에서 인덱스 유무에 따라 락 대기가 어떻게 달라지는지 관찰해보기
- 데드락 발생 시 재시도(backoff 포함)로 사용자 경험이 어떻게 달라지는지 정리해보기
