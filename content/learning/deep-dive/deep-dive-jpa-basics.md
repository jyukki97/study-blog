---
title: "JPA 기초: 엔티티, 영속성 컨텍스트, 기본 CRUD 이해하기"
date: 2025-10-27
draft: false
topic: "JPA"
tags: ["JPA", "Hibernate", "ORM", "Entity", "Persistence Context", "EntityManager"]
categories: ["Backend Deep Dive"]
description: "JPA의 핵심 개념인 엔티티와 영속성 컨텍스트를 이해하고, 기본 CRUD 작업과 상태 전이를 실무 관점으로 정리"
module: "spring-core"
study_order: 150
---

## 이 글에서 얻는 것

- **JPA/ORM의 개념**과 SQL을 직접 작성하는 것과의 차이를 이해합니다.
- **엔티티(Entity)와 영속성 컨텍스트(Persistence Context)**의 핵심 역할을 설명할 수 있습니다.
- **엔티티 상태(비영속/영속/준영속/삭제)**와 **1차 캐시, 더티 체킹, 쓰기 지연**을 이해합니다.
- **EntityManager vs Repository**의 차이를 알고, Spring Data JPA와의 관계를 파악합니다.

## 0) JPA는 "객체와 테이블을 매핑"하는 표준

### JDBC/MyBatis (SQL 중심)

```java
// JDBC: SQL 직접 작성
String sql = "INSERT INTO users (name, email) VALUES (?, ?)";
PreparedStatement pstmt = conn.prepareStatement(sql);
pstmt.setString(1, "Alice");
pstmt.setString(2, "alice@example.com");
pstmt.executeUpdate();

// 조회도 직접 매핑
String sql = "SELECT * FROM users WHERE id = ?";
ResultSet rs = pstmt.executeQuery();
if (rs.next()) {
    User user = new User();
    user.setId(rs.getLong("id"));
    user.setName(rs.getString("name"));
    // ...
}
```

**문제점:**
- SQL을 직접 작성 → 데이터베이스 종속적
- 객체 ↔ ResultSet 변환 코드 반복
- 연관관계(JOIN)를 수동으로 처리

### JPA (객체 중심)

```java
// JPA: 객체만 다루면 됨
User user = new User("Alice", "alice@example.com");
entityManager.persist(user);  // SQL 자동 생성

// 조회도 객체로
User found = entityManager.find(User.class, 1L);
System.out.println(found.getName());  // "Alice"
```

**장점:**
- SQL 자동 생성 → 데이터베이스 독립적
- 객체 그대로 저장/조회
- 연관관계를 객체 참조로 처리

## 1) JPA 핵심 개념

### 1-1) JPA vs Hibernate vs Spring Data JPA

```
┌─────────────────────────────────┐
│  Spring Data JPA (Repository)   │  ← 가장 높은 추상화 (Spring)
├─────────────────────────────────┤
│  JPA (javax.persistence)        │  ← Java 표준 인터페이스
├─────────────────────────────────┤
│  Hibernate (구현체)              │  ← JPA 구현 (가장 많이 사용)
└─────────────────────────────────┘
```

- **JPA**: Java Persistence API (인터페이스, 명세)
- **Hibernate**: JPA의 구현체 (실제로 동작하는 라이브러리)
- **Spring Data JPA**: JPA를 더 쉽게 쓰게 해주는 Spring 모듈

### 1-2) 엔티티 (Entity)

데이터베이스 테이블과 매핑되는 객체

```java
@Entity  // JPA 엔티티임을 표시
@Table(name = "users")  // 테이블 이름 지정 (생략 시 클래스명)
public class User {

    @Id  // 기본 키
    @GeneratedValue(strategy = GenerationType.IDENTITY)  // 자동 증가
    private Long id;

    @Column(name = "user_name", nullable = false, length = 50)  // 컬럼 매핑
    private String name;

    @Column(unique = true)
    private String email;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    // 기본 생성자 필수 (JPA 스펙)
    protected User() {}

    public User(String name, String email) {
        this.name = name;
        this.email = email;
        this.createdAt = LocalDateTime.now();
    }

    // Getter/Setter
}
```

**핵심 어노테이션:**
- `@Entity`: JPA가 관리하는 엔티티
- `@Id`: 기본 키 (Primary Key)
- `@GeneratedValue`: 기본 키 생성 전략
  - `IDENTITY`: 데이터베이스가 자동 생성 (AUTO_INCREMENT)
  - `SEQUENCE`: 시퀀스 사용 (Oracle, PostgreSQL)
  - `TABLE`: 키 생성 전용 테이블
  - `AUTO`: 데이터베이스에 맞게 자동 선택
- `@Column`: 컬럼 매핑 (생략 가능, 필드명과 컬럼명 자동 매핑)
- `@Table`: 테이블 이름 지정

### 1-3) 영속성 컨텍스트 (Persistence Context)

**영속성 컨텍스트란?**
- 엔티티를 영구 저장하는 환경 (메모리 상의 임시 저장소)
- EntityManager가 관리
- 1차 캐시, 동일성 보장, 쓰기 지연, 변경 감지 등의 기능 제공

```
┌──────────────────────────────┐
│   Application                │
│   ↓                          │
│   EntityManager              │
│   ↓                          │
│   Persistence Context        │  ← 1차 캐시, 더티 체킹
│   ↓                          │
│   Database                   │
└──────────────────────────────┘
```

## 2) 엔티티 상태 (Entity State)

```
   new User()
      ↓
  [비영속]
      ↓ persist()
  [영속] ──────→ [준영속] (detach, clear, close)
      ↓ remove()
  [삭제]
```

### 2-1) 비영속 (New/Transient)

JPA와 전혀 관계 없는 상태

```java
User user = new User("Alice", "alice@example.com");
// 아직 영속성 컨텍스트에 없음
```

### 2-2) 영속 (Managed)

영속성 컨텍스트가 관리하는 상태

```java
entityManager.persist(user);  // 영속 상태로 전환
// 이 시점에는 아직 INSERT 쿼리 실행 안 됨!
```

**영속 상태의 특징:**
- 1차 캐시에 저장
- 변경 감지 (Dirty Checking)
- 쓰기 지연 (Write-Behind)

### 2-3) 준영속 (Detached)

영속성 컨텍스트에서 분리된 상태

```java
entityManager.detach(user);  // 준영속 상태
// 또는
entityManager.clear();       // 영속성 컨텍스트 전체 초기화
```

### 2-4) 삭제 (Removed)

삭제 예정 상태

```java
entityManager.remove(user);  // 삭제 상태
// 트랜잭션 커밋 시 DELETE 쿼리 실행
```

## 3) 영속성 컨텍스트의 핵심 기능

### 3-1) 1차 캐시

영속성 컨텍스트 내부에 엔티티를 캐싱

```java
// 첫 번째 조회: DB에서 가져와서 1차 캐시에 저장
User user1 = entityManager.find(User.class, 1L);
// SELECT * FROM users WHERE id = 1

// 두 번째 조회: 1차 캐시에서 반환 (쿼리 안 나감!)
User user2 = entityManager.find(User.class, 1L);

System.out.println(user1 == user2);  // true (같은 객체)
```

**장점:**
- 같은 트랜잭션 내에서 반복 조회 시 쿼리 절약
- 동일성(Identity) 보장: `==` 비교 가능

**한계:**
- 트랜잭션 범위 안에서만 유효 (글로벌 캐시 아님)
- 다른 트랜잭션에서는 효과 없음

### 3-2) 쓰기 지연 (Transactional Write-Behind)

INSERT/UPDATE/DELETE를 모았다가 한 번에 실행

```java
@Transactional
public void saveUsers() {
    entityManager.persist(new User("Alice", "alice@example.com"));
    entityManager.persist(new User("Bob", "bob@example.com"));
    entityManager.persist(new User("Charlie", "charlie@example.com"));

    // 여기까지 INSERT 쿼리 실행 안 됨!
    // 트랜잭션 커밋 시 한 번에 3개 INSERT 실행
}
```

**장점:**
- 쿼리 배치 실행 가능 (성능 향상)
- 트랜잭션 범위 내에서 일관성 유지

### 3-3) 변경 감지 (Dirty Checking)

영속 상태의 엔티티 변경을 자동으로 감지하고 UPDATE

```java
@Transactional
public void updateUser(Long userId) {
    User user = entityManager.find(User.class, userId);  // 영속 상태
    user.setName("Updated Name");  // 엔티티 수정

    // entityManager.update(user); 같은 코드 불필요!
    // 트랜잭션 커밋 시 자동으로 UPDATE 쿼리 실행
}

// 실행되는 쿼리:
// SELECT * FROM users WHERE id = ?
// UPDATE users SET name = 'Updated Name' WHERE id = ?
```

**동작 원리:**
1. 최초 조회 시 스냅샷 저장
2. 트랜잭션 커밋 시 현재 상태와 스냅샷 비교
3. 변경 감지 시 UPDATE 쿼리 자동 생성

### 3-4) 지연 로딩 (Lazy Loading)

연관된 엔티티를 실제 사용할 때 조회 (나중에 자세히 다룸)

```java
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.LAZY)  // 지연 로딩
    private User user;
}

Order order = entityManager.find(Order.class, 1L);
// Order만 조회, User는 아직 조회 안 함

String userName = order.getUser().getName();
// 이 시점에 User 조회 (SELECT)
```

## 4) 기본 CRUD 작업

### 4-1) EntityManager 직접 사용

```java
@Service
@Transactional
public class UserService {

    @PersistenceContext  // EntityManager 주입
    private EntityManager entityManager;

    // Create
    public User save(User user) {
        entityManager.persist(user);
        return user;
    }

    // Read
    public User findById(Long id) {
        return entityManager.find(User.class, id);
    }

    // Update
    public User update(Long id, String newName) {
        User user = entityManager.find(User.class, id);
        user.setName(newName);  // 더티 체킹으로 자동 UPDATE
        return user;
    }

    // Delete
    public void delete(Long id) {
        User user = entityManager.find(User.class, id);
        entityManager.remove(user);
    }

    // JPQL 쿼리
    public List<User> findByName(String name) {
        return entityManager.createQuery(
            "SELECT u FROM User u WHERE u.name = :name", User.class)
            .setParameter("name", name)
            .getResultList();
    }
}
```

### 4-2) Spring Data JPA Repository (더 간단)

```java
// 인터페이스만 정의하면 구현체 자동 생성!
public interface UserRepository extends JpaRepository<User, Long> {
    // 메서드 이름으로 쿼리 자동 생성
    List<User> findByName(String name);
    Optional<User> findByEmail(String email);
    List<User> findByNameContaining(String keyword);
}

@Service
@Transactional
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User save(User user) {
        return userRepository.save(user);  // persist or merge
    }

    public User findById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new UserNotFoundException(id));
    }

    public List<User> findByName(String name) {
        return userRepository.findByName(name);
    }

    public void delete(Long id) {
        userRepository.deleteById(id);
    }
}
```

## 5) 자주 하는 실수

### 5-1) 영속성 컨텍스트 밖에서 엔티티 수정

```java
// ❌ @Transactional 없음 → 변경 감지 안 됨
public void updateUser(Long id, String newName) {
    User user = userRepository.findById(id).orElseThrow();
    user.setName(newName);  // UPDATE 쿼리 실행 안 됨!
}

// ✅ @Transactional 필수
@Transactional
public void updateUser(Long id, String newName) {
    User user = userRepository.findById(id).orElseThrow();
    user.setName(newName);  // 트랜잭션 커밋 시 UPDATE 실행
}
```

### 5-2) 준영속 엔티티 수정 시도

```java
// ❌ 준영속 상태의 엔티티
User user = new User(1L, "Alice", "alice@example.com");  // 직접 생성
user.setName("Updated");  // 변경 감지 안 됨!

// ✅ 병합(merge) 또는 다시 조회
@Transactional
public void update(User user) {
    User managed = entityManager.merge(user);  // 영속 상태로 전환
    managed.setName("Updated");
}

// 또는
@Transactional
public void update(Long id, String newName) {
    User user = entityManager.find(User.class, id);  // 영속 상태로 조회
    user.setName(newName);
}
```

### 5-3) 식별자 직접 설정 시 persist vs merge

```java
User user = new User();
user.setId(1L);  // 식별자 직접 설정
user.setName("Alice");

entityManager.persist(user);  // ❌ 이미 ID가 있으면 예외 발생 가능

// ✅ merge 사용 (존재하면 UPDATE, 없으면 INSERT)
entityManager.merge(user);
```

## 6) 실전 팁

### 6-1) @GeneratedValue 전략 선택

```java
// IDENTITY: MySQL/PostgreSQL AUTO_INCREMENT
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;

// SEQUENCE: Oracle/PostgreSQL Sequence
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_seq")
@SequenceGenerator(name = "user_seq", sequenceName = "user_sequence")
private Long id;

// TABLE: 모든 DB 지원 (성능 낮음)
@GeneratedValue(strategy = GenerationType.TABLE)
private Long id;
```

### 6-2) 엔티티 설계 원칙

```java
@Entity
public class User {
    // ✅ 기본 생성자: protected (외부 직접 생성 방지)
    protected User() {}

    // ✅ 생성자: 필수 값만 받기
    public User(String name, String email) {
        this.name = name;
        this.email = email;
    }

    // ✅ Setter 최소화 (의미 있는 메서드 제공)
    public void changeName(String newName) {
        if (newName == null || newName.isBlank()) {
            throw new IllegalArgumentException("Name cannot be empty");
        }
        this.name = newName;
    }
}
```

### 6-3) @Transactional 위치

```java
// ✅ Service 계층에 @Transactional
@Service
@Transactional(readOnly = true)  // 기본 읽기 전용
public class UserService {

    @Transactional  // 쓰기 작업만 readOnly = false
    public User save(User user) {
        return userRepository.save(user);
    }

    public User findById(Long id) {
        return userRepository.findById(id).orElseThrow();
    }
}
```

## 연습 (추천)

1. **간단한 엔티티 생성**
   - User, Post 엔티티 설계
   - CRUD 작업 구현

2. **영속성 컨텍스트 동작 확인**
   - 1차 캐시 확인 (같은 ID 두 번 조회)
   - 더티 체킹 확인 (엔티티 수정 후 UPDATE 쿼리 확인)
   - 쿼리 로그 활성화: `spring.jpa.show-sql=true`

3. **실수 재현**
   - @Transactional 없이 엔티티 수정
   - 준영속 엔티티 수정 시도

## 요약: 스스로 점검할 것

- JPA/Hibernate/Spring Data JPA의 관계를 설명할 수 있다
- 영속성 컨텍스트의 역할(1차 캐시, 쓰기 지연, 더티 체킹)을 이해한다
- 엔티티의 4가지 상태(비영속/영속/준영속/삭제)를 구분할 수 있다
- @Transactional 없이 엔티티를 수정하면 안 되는 이유를 안다
- EntityManager vs Repository의 차이를 설명할 수 있다

## 다음 단계

- JPA 연관관계 매핑: `/learning/deep-dive/deep-dive-jpa-associations/`
- Spring Data JPA: `/learning/deep-dive/deep-dive-spring-data-jpa/`
- JPA N+1 문제: `/learning/deep-dive/deep-dive-jpa-n-plus-1/`
- JPA 트랜잭션 경계: `/learning/deep-dive/deep-dive-jpa-transaction-boundaries/`
