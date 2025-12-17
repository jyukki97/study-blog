---
title: "JPA 연관관계 매핑: @OneToMany, @ManyToOne, @ManyToMany 완벽 가이드"
date: 2025-12-16
draft: false
topic: "JPA"
tags: ["JPA", "Association", "OneToMany", "ManyToOne", "ManyToMany", "ForeignKey"]
categories: ["Backend Deep Dive"]
description: "JPA 연관관계 매핑(1:N, N:1, N:M)과 양방향 관계, 연관관계 주인, Cascade/OrphanRemoval을 실무 관점으로 정리"
module: "spring-core"
study_order: 152
---

## 이 글에서 얻는 것

- **@OneToMany, @ManyToOne, @ManyToMany**의 차이와 사용법을 이해합니다.
- **단방향 vs 양방향 연관관계**의 트레이드오프를 판단할 수 있습니다.
- **연관관계의 주인(Owner)**과 mappedBy의 개념을 명확히 알 수 있습니다.
- **Cascade, OrphanRemoval, FetchType**의 실무 사용 패턴을 익힙니다.

## 0) 연관관계는 "객체 간 참조"를 테이블로 매핑한다

객체지향에서는 참조(reference)로 연관관계를 표현하지만,
관계형 데이터베이스는 외래 키(Foreign Key)로 표현합니다.

**JPA의 역할:**
- 객체의 참조를 DB의 외래 키로 자동 매핑
- 양방향 탐색을 가능하게 함

## 1) @ManyToOne: N:1 관계 (다대일)

**"여러 주문이 하나의 사용자에 속함"**

### 1-1) 단방향 @ManyToOne

```java
@Entity
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private int amount;

    @ManyToOne(fetch = FetchType.LAZY)  // N:1 관계
    @JoinColumn(name = "user_id")       // 외래 키 컬럼명
    private User user;

    // Getter/Setter
}

@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    // Order 목록은 없음 (단방향)
}
```

**테이블 구조:**
```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255)
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    amount INT,
    user_id BIGINT,  -- 외래 키
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**사용:**
```java
User user = new User();
user.setName("Alice");
entityManager.persist(user);

Order order = new Order();
order.setAmount(10000);
order.setUser(user);  // 연관관계 설정
entityManager.persist(order);

// 조회
Order found = entityManager.find(Order.class, 1L);
System.out.println(found.getUser().getName());  // "Alice"
```

## 2) @OneToMany: 1:N 관계 (일대다)

### 2-1) 양방향 @OneToMany

```java
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Order> orders = new ArrayList<>();

    // 연관관계 편의 메서드
    public void addOrder(Order order) {
        orders.add(order);
        order.setUser(this);
    }

    public void removeOrder(Order order) {
        orders.remove(order);
        order.setUser(null);
    }
}

@Entity
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private int amount;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")  // 외래 키 (연관관계 주인)
    private User user;
}
```

**핵심 개념:**
- **연관관계의 주인(Owner)**: 외래 키를 관리하는 쪽 (Order.user)
- **mappedBy**: 연관관계 주인이 아닌 쪽에 설정 (User.orders)
- 외래 키는 항상 N쪽(Order)에 있음

**사용:**
```java
User user = new User();
user.setName("Alice");

Order order1 = new Order();
order1.setAmount(10000);

Order order2 = new Order();
order2.setAmount(20000);

user.addOrder(order1);  // 편의 메서드 사용
user.addOrder(order2);

entityManager.persist(user);  // Cascade로 order1, order2도 저장

// 조회
User found = entityManager.find(User.class, 1L);
System.out.println(found.getOrders().size());  // 2
```

## 3) 연관관계의 주인 (Owner)

### 3-1) 주인을 정하는 기준

**규칙: 외래 키가 있는 테이블의 엔티티가 주인**

```
users (1) ←─── orders (N)
                ↑
              user_id (외래 키)
```

- Order 테이블에 user_id가 있음
- **Order.user가 연관관계 주인**
- User.orders는 mappedBy로 설정

### 3-2) 주인이 아닌 쪽에서 설정 시 무시됨

```java
// ❌ 주인이 아닌 쪽에서만 설정 (무시됨!)
User user = new User();
user.setName("Alice");
entityManager.persist(user);

Order order = new Order();
order.setAmount(10000);
entityManager.persist(order);

user.getOrders().add(order);  // 저장 안 됨! (주인이 아니라서)

// DB: order.user_id = NULL
```

```java
// ✅ 주인 쪽에서 설정
order.setUser(user);  // 이것만 하면 됨
// 또는 양쪽 모두 설정 (객체 그래프 일관성)
user.addOrder(order);  // 편의 메서드로 양쪽 설정
```

## 4) Cascade: 연관 엔티티 자동 처리

### 4-1) Cascade 타입

```java
@Entity
public class User {
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL)
    private List<Order> orders = new ArrayList<>();
}
```

**Cascade 옵션:**
- `PERSIST`: 저장 시 연관 엔티티도 저장
- `REMOVE`: 삭제 시 연관 엔티티도 삭제
- `MERGE`: 병합 시 연관 엔티티도 병합
- `REFRESH`: 새로고침 시 연관 엔티티도 새로고침
- `DETACH`: 준영속 시 연관 엔티티도 준영속
- `ALL`: 모든 Cascade 적용

**사용 예:**
```java
User user = new User();
user.setName("Alice");

Order order1 = new Order();
order1.setAmount(10000);

user.addOrder(order1);

entityManager.persist(user);  // Cascade로 order1도 자동 저장!
```

### 4-2) orphanRemoval: 고아 객체 제거

```java
@Entity
public class User {
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Order> orders = new ArrayList<>();
}
```

**동작:**
```java
User user = entityManager.find(User.class, 1L);
user.getOrders().remove(0);  // 리스트에서 제거

// orphanRemoval = true → Order 테이블에서도 DELETE 실행
// orphanRemoval = false → Order.user_id만 NULL로 UPDATE
```

**주의:**
- `orphanRemoval = true`는 부모-자식 관계에서만 사용
- 다른 곳에서도 참조하는 엔티티에는 사용 금지

## 5) FetchType: 즉시 로딩 vs 지연 로딩

### 5-1) LAZY (지연 로딩, 권장)

```java
@ManyToOne(fetch = FetchType.LAZY)
private User user;
```

**동작:**
```java
Order order = entityManager.find(Order.class, 1L);
// SELECT * FROM orders WHERE id = 1

System.out.println(order.getUser().getName());
// 이 시점에 User 조회
// SELECT * FROM users WHERE id = ?
```

### 5-2) EAGER (즉시 로딩, 주의)

```java
@ManyToOne(fetch = FetchType.EAGER)
private User user;
```

**동작:**
```java
Order order = entityManager.find(Order.class, 1L);
// SELECT o.*, u.* FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = 1
// Order와 User를 한 번에 조회
```

**문제점:**
- N+1 문제 발생 가능
- 불필요한 조회 증가
- **권장: 기본은 LAZY, 필요 시 JPQL fetch join 사용**

## 6) @ManyToMany: N:M 관계 (다대다)

### 6-1) 중간 테이블 자동 생성

```java
@Entity
public class Student {
    @Id
    @GeneratedValue
    private Long id;

    private String name;

    @ManyToMany
    @JoinTable(
        name = "student_course",
        joinColumns = @JoinColumn(name = "student_id"),
        inverseJoinColumns = @JoinColumn(name = "course_id")
    )
    private List<Course> courses = new ArrayList<>();
}

@Entity
public class Course {
    @Id
    @GeneratedValue
    private Long id;

    private String title;

    @ManyToMany(mappedBy = "courses")
    private List<Student> students = new ArrayList<>();
}
```

**테이블 구조:**
```sql
CREATE TABLE student (
    id BIGINT PRIMARY KEY,
    name VARCHAR(255)
);

CREATE TABLE course (
    id BIGINT PRIMARY KEY,
    title VARCHAR(255)
);

CREATE TABLE student_course (
    student_id BIGINT,
    course_id BIGINT,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES student(id),
    FOREIGN KEY (course_id) REFERENCES course(id)
);
```

### 6-2) @ManyToMany의 한계와 해결

**문제: 중간 테이블에 추가 컬럼을 넣을 수 없음**

```java
// ❌ student_course 테이블에 registered_at 컬럼 추가 불가
```

**✅ 해결: 중간 엔티티로 변환 (권장)**

```java
@Entity
public class Student {
    @Id
    @GeneratedValue
    private Long id;

    private String name;

    @OneToMany(mappedBy = "student")
    private List<StudentCourse> studentCourses = new ArrayList<>();
}

@Entity
public class Course {
    @Id
    @GeneratedValue
    private Long id;

    private String title;

    @OneToMany(mappedBy = "course")
    private List<StudentCourse> studentCourses = new ArrayList<>();
}

@Entity
public class StudentCourse {
    @Id
    @GeneratedValue
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id")
    private Student student;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "course_id")
    private Course course;

    private LocalDateTime registeredAt;  // 추가 정보!
}
```

## 7) 실전 패턴

### 7-1) 부모-자식 관계 (Order-OrderItem)

```java
@Entity
public class Order {
    @Id
    @GeneratedValue
    private Long id;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderItem> items = new ArrayList<>();

    public void addItem(OrderItem item) {
        items.add(item);
        item.setOrder(this);
    }

    public void removeItem(OrderItem item) {
        items.remove(item);
        item.setOrder(null);
    }
}

@Entity
public class OrderItem {
    @Id
    @GeneratedValue
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    private Order order;

    private String productName;
    private int quantity;
}

// 사용
Order order = new Order();
order.addItem(new OrderItem("Product A", 2));
order.addItem(new OrderItem("Product B", 1));

entityManager.persist(order);  // Cascade로 items도 저장
```

### 7-2) 단방향 vs 양방향 선택

```java
// ✅ 단방향 (충분한 경우)
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.LAZY)
    private User user;
}

// User에서 Order를 조회할 일이 없으면 단방향으로 충분

// ✅ 양방향 (필요한 경우)
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    private List<Order> orders;  // User에서 Order 목록 필요 시
}
```

**선택 기준:**
- 단방향이 기본 (KISS 원칙)
- 양방향은 "양쪽 탐색이 정말 필요"할 때만

## 요약: 스스로 점검할 것

- @ManyToOne vs @OneToMany의 차이를 설명할 수 있다
- 연관관계의 주인과 mappedBy를 설명할 수 있다
- Cascade와 orphanRemoval의 차이를 안다
- FetchType.LAZY vs EAGER를 선택할 수 있다 (기본은 LAZY)
- @ManyToMany의 한계와 해결법을 안다 (중간 엔티티)

## 다음 단계

- Spring Data JPA: `/learning/deep-dive/deep-dive-spring-data-jpa/`
- JPA N+1 문제: `/learning/deep-dive/deep-dive-jpa-n-plus-1/`
- JPA 트랜잭션 경계: `/learning/deep-dive/deep-dive-jpa-transaction-boundaries/`
