---
title: "JPA N+1: 영원한 숙제, 확실히 잡기"
date: 2025-12-16
draft: false
topic: "JPA"
tags: ["JPA", "Hibernate", "N+1", "Fetch Join", "EntityGraph"]
categories: ["Backend Deep Dive"]
description: "로그에 쿼리 100개가 찍히는 공포. 원인 분석부터 Fetch Join, Batch Size, EntityGraph 해결법 비교"
module: "data-system"
quizzes:
  - question: "JPA N+1 문제의 근본 원인은?"
    options:
      - "Eager Loading으로 설정되어 있기 때문"
      - "Lazy Loading 설정 시, 연관 엔티티에 접근할 때마다 추가 쿼리가 발생하기 때문"
      - "데이터베이스 인덱스가 없기 때문"
      - "JPA 버전이 오래되었기 때문"
    answer: 1
    explanation: "JPA의 Lazy Loading은 연관 엔티티를 사용할 때(`getMembers()` 호출) 쿼리를 실행합니다. 부모 N개를 조회한 후 각각의 자식을 조회하면 N번의 추가 쿼리가 발생합니다."

  - question: "Fetch Join으로 N+1 문제를 해결할 때, 컬렉션 조회 + 페이징을 함께 사용하면 발생하는 문제는?"
    options:
      - "쿼리가 실행되지 않는다."
      - "DB에서 페이징하지 않고 전체 데이터를 메모리로 가져온 후 애플리케이션에서 페이징하여 메모리 이슈가 발생할 수 있다."
      - "데이터가 중복 제거된다."
      - "트랜잭션이 롤백된다."
    answer: 1
    explanation: "컬렉션 Fetch Join 시 JPA는 메모리에서 페이징(in-memory paging)을 수행합니다. 데이터가 많으면 OOM(Out Of Memory) 위험이 있습니다. 이런 경우 `BatchSize`를 사용하는 것이 좋습니다."

  - question: "`@BatchSize` 또는 `default_batch_fetch_size` 설정의 효과는?"
    options:
      - "쿼리를 캐시한다."
      - "Lazy Loading 시 1건씩 조회하지 않고 여러 건을 IN 쿼리로 묶어서 조회하여 쿼리 수를 줄인다."
      - "Eager Loading으로 변경한다."
      - "JPQL을 자동 생성한다."
    answer: 1
    explanation: "`BatchSize=100` 설정 시, `WHERE team_id IN (1, 2, ... 100)`처럼 묶어서 조회합니다. N+1이 1+1이 되어 쿼리 수가 획기적으로 줄어들고, 페이징도 안전하게 사용할 수 있습니다."

  - question: "JPA에서 N+1 문제를 예방하기 위한 기본 페치 전략으로 가장 권장되는 것은?"
    options:
      - "모든 연관관계를 EAGER로 설정한다."
      - "모든 연관관계를 LAZY로 설정하고, 필요한 경우에만 Fetch Join 또는 BatchSize로 조회한다."
      - "JPQL 대신 네이티브 쿼리만 사용한다."
      - "모든 연관관계를 제거한다."
    answer: 1
    explanation: "EAGER는 불필요한 데이터까지 조회하여 성능 저하를 유발합니다. 기본은 LAZY로 설정하고, 목록 조회 시 Fetch Join, 페이징 시 BatchSize로 최적화하는 것이 표준 패턴입니다."

  - question: "`@EntityGraph`의 장점은?"
    options:
      - "JPQL 작성 없이 애노테이션만으로 Fetch Join과 유사한 효과를 얻을 수 있다."
      - "Eager Loading을 Lazy Loading으로 바꿔준다."
      - "쿼리 캐시를 활성화한다."
      - "트랜잭션을 자동 커밋한다."
    answer: 0
    explanation: "`@EntityGraph(attributePaths = {\"members\"})`처럼 선언하면, 별도의 JPQL 없이 연관 엔티티를 함께 조회(LEFT OUTER JOIN)할 수 있어 간편합니다."
study_order: 300
---

### 💣 1. "쿼리가 왜 100번 나가죠?"

> [!WARNING]
> **N+1 문제란?**
> 하버드 대학생(1)을 조회했는데, 학생들의 수강신청 목록(N)을 가져오기 위해 **추가 쿼리가 N번 더 실행되는 현상**입니다.
> - **결과**: DB 부하 급증, 응답 속도 저하.

`findAll()` 하나 불렀을 뿐인데, 콘솔에 SQL이 폭포수처럼 쏟아집니다.
이것이 바로 **N+1 문제**입니다.

```mermaid
sequenceDiagram
    participant S as App Service
    participant DB as Database
    
    S->>DB: 1. findAll Teams (쿼리 1번)
    DB-->>S: 100 Teams
    
    loop For each Team
        S->>DB: 2. SELECT Members where team_id=? (쿼리 N번)
        DB-->>S: Members
    end
    
    Note right of S: 총 101번 쿼리 실행! 😱
```

1개의 쿼리(Team 조회)를 날렸는데, 결과 개수(N)만큼 추가 쿼리(Members 조회)가 나가는 현상입니다.

### 발생 원인
JPA는 기본적으로 연관된 엔티티를 **진짜 쓸 때(getMembers())** 가져오려고 합니다(Lazy Loading).
그래서 루프를 돌면서 `team.getMembers()`를 호출할 때마다 `SELECT * FROM member WHERE team_id = ?`를 날리는 것입니다.

---

## 🛠️ 2. 해결책 3대장

### 2-1. Fetch Join (가장 확실함)
"가져올 때 한방에 Join해서 다 가져와!"

```mermaid
graph LR
    App[Service] --"1. Join Query"--> DB[(Database)]
    DB --"Teams + Members (한방에)"--> App
    
    style App fill:#e3f2fd
    style DB fill:#f3e5f5
```

```sql
SELECT t FROM Team t JOIN FETCH t.members
```
- **장점**: 쿼리 1방으로 끝남.
- **단점**: 페이징(Paging) 시 메모리 이슈 발생 가능. (DB에서 페이징 안 하고 다 퍼올려서 메모리에서 자름 😱)


### 2-2. @EntityGraph (간편함)
JPQL 짜기 귀찮을 때 애노테이션으로 해결.

```java
@EntityGraph(attributePaths = {"members"})
List<Team> findAll();
```
- **특징**: `LEFT OUTER JOIN`을 사용합니다.

### 2-3. @BatchSize (in 쿼리)
"1개씩 가져오지 말고 100개씩 묶어서(in) 가져와."

```yaml
spring.jpa.properties.hibernate.default_batch_fetch_size: 100
```

```sql
SELECT * FROM member WHERE team_id IN (1, 2, 3, ... 100)
```
- **장점**: 페이징 문제 해결! Fetch Join과 다르게 데이터 뻥튀기가 없음.
- **실무 꿀팁**: **컬렉션 조회 + 페이징**이 필요하면, `Fetch Join` 대신 `Batch Size`가 답입니다.

---

## 📊 3. 비교 요약

| 방법 | 쿼리 수 | 페이징 가능? | 데이터 중복 | 권장 상황 |
|---|---|---|---|---|
| **Just Lazy** | 1 + N | O | X | 단건 상세 조회 |
| **Fetch Join** | 1 | X (List) | O (Distinct 필요) | 목록 전체 조회 |
| **Batch Size** | 1 + 1 | O | X | 페이징 목록 조회 |

## 요약: Best Practice

> [!TIP]
> **실무 JPA 최적화 공식**:
> 1. 기본은 **Lazy Loading** (`Fetch=LAZY`)으로 설정한다.
> 2. 목록 조회(List)가 필요하면 **Fetch Join**으로 N+1을 잡는다.
> 3. 페이징이 필요하면 **`default_batch_fetch_size`**(100~1000)를 켠다.

1. **원인**: Lazy Loading 때문에 루프 돌 때마다 쿼리가 나간다.
2. **해결 1**: 목록 조회는 **Fetch Join**이 기본.
3. **해결 2**: 페이징이 필요하면 **default_batch_fetch_size**를 켜라.
