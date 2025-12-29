---
title: "Spring Data JPA: Repository 패턴과 쿼리 메서드로 생산성 극대화"
date: 2025-11-02
draft: false
topic: "Spring Data JPA"
tags: ["Spring Data JPA", "JPA", "Repository", "Query Methods", "Specification"]
categories: ["Backend Deep Dive"]
description: "JpaRepository 인터페이스, 쿼리 메서드, @Query, Specification으로 데이터 접근 계층을 간결하게 구현"
module: "spring-core"
quizzes:
  - question: "Spring Data JPA에서 인터페이스에 메서드 이름만 잘 지으면 자동으로 쿼리를 생성해주는 기능은?"
    options:
      - "Named Query"
      - "Query Methods (Derived Query)"
      - "Criteria API"
      - "QueryDSL"
    answer: 1
    explanation: "`findByName`, `findByEmailAndAge` 처럼 메서드 이름의 관례(Convention)를 따르면 Spring Data JPA가 자동으로 JPQL을 생성하여 실행해줍니다."

  - question: "JPQL을 사용하여 사용자 정의 쿼리를 작성할 때 메서드 위에 붙여야 하는 애노테이션은?"
    options:
      - "@SQL"
      - "@Query"
      - "@NativeQuery"
      - "@Select"
    answer: 1
    explanation: "`@Query(\"SELECT u FROM User u WHERE...\")` 형식으로 JPQL을 직접 작성하여 Repository 메서드에 바인딩할 수 있습니다."

  - question: "데이터 수정(Update)이나 삭제(Delete) 쿼리를 `@Query`로 작성할 때, 반드시 함께 붙여야 하는 애노테이션은?"
    options:
      - "@Transactional"
      - "@Modifying"
      - "@Service"
      - "@Component"
    answer: 1
    explanation: "`INSERT`, `UPDATE`, `DELETE` 쿼리를 `@Query`로 직접 실행할 때는 `@Modifying`을 붙여야 하며, 이를 생략하면 `InvalidDataAccessApiUsageException`이 발생합니다."

  - question: "Spring Data JPA에서 N+1 문제를 해결하기 위해, 연관된 엔티티를 한 번의 쿼리로 함께 조회하는 JPQL 문법은?"
    options:
      - "INNER JOIN"
      - "LEFT OUTER JOIN"
      - "JOIN FETCH (Fetch Join)"
      - "CROSS JOIN"
    answer: 2
    explanation: "`JOIN FETCH`를 사용하면 연관된 엔티티나 컬렉션을 한 번의 SQL 쿼리로 함께 조회하여 로딩하므로 N+1 문제를 방지할 수 있습니다."

  - question: "Repository 메서드에서 페이징 처리를 위해 파라미터로 넘겨야 하는 인터페이스는?"
    options:
      - "Page"
      - "Slice"
      - "Pageable"
      - "Sort"
    answer: 2
    explanation: "`Pageable` 인터페이스(구현체 `PageRequest` 등)를 파라미터로 넘기면 페이징(OFFSET, LIMIT)과 정렬 정보가 쿼리에 적용됩니다."
study_order: 154
---

## 이 글에서 얻는 것

- **JpaRepository 인터페이스**만으로 CRUD를 자동 구현할 수 있습니다.
- **쿼리 메서드**(메서드 이름으로 쿼리 생성)를 활용해 간단한 조회를 작성합니다.
- **@Query**로 복잡한 JPQL/네이티브 쿼리를 작성합니다.
- **Specification**으로 동적 쿼리를 타입 세이프하게 구현합니다.

## 0) Spring Data JPA는 "반복적인 데이터 접근 코드"를 자동화한다

전통적인 JPA (EntityManager 직접 사용):
```java
@Repository
public class UserRepository {
    @PersistenceContext
    private EntityManager em;

    public User save(User user) {
        em.persist(user);
        return user;
    }

    public Optional<User> findById(Long id) {
        return Optional.ofNullable(em.find(User.class, id));
    }

    public List<User> findAll() {
        return em.createQuery("SELECT u FROM User u", User.class)
                 .getResultList();
    }

    public void delete(User user) {
        em.remove(user);
    }
}
```

Spring Data JPA (인터페이스만 정의):
```java
public interface UserRepository extends JpaRepository<User, Long> {
    // 구현체가 자동 생성됨!
}
```

## 1) JpaRepository 인터페이스

### 1-1) 기본 CRUD 메서드

```java
public interface UserRepository extends JpaRepository<User, Long> {
    // 인터페이스만 정의, 구현체는 Spring Data JPA가 자동 생성
}

// 사용
@Service
public class UserService {
    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public void examples() {
        // 1. 저장
        User user = new User("Alice", "alice@example.com");
        userRepository.save(user);  // INSERT or UPDATE

        // 2. 조회
        Optional<User> found = userRepository.findById(1L);
        User user1 = userRepository.getReferenceById(1L);  // 프록시 반환

        // 3. 존재 확인
        boolean exists = userRepository.existsById(1L);

        // 4. 목록 조회
        List<User> all = userRepository.findAll();
        List<User> someUsers = userRepository.findAllById(Arrays.asList(1L, 2L, 3L));

        // 5. 개수
        long count = userRepository.count();

        // 6. 삭제
        userRepository.deleteById(1L);
        userRepository.delete(user);
        userRepository.deleteAll();
    }
}
```

### 1-2) JpaRepository 계층 구조

```
Repository (마커 인터페이스)
  ↑
CrudRepository (기본 CRUD)
  ↑
PagingAndSortingRepository (페이징/정렬)
  ↑
JpaRepository (JPA 특화 기능: flush, batch 등)
```

## 2) 쿼리 메서드: 메서드 이름으로 쿼리 자동 생성

### 2-1) 기본 규칙

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // findBy + 필드명
    List<User> findByName(String name);
    // SELECT u FROM User u WHERE u.name = ?1

    Optional<User> findByEmail(String email);
    // SELECT u FROM User u WHERE u.email = ?1

    // And 조건
    List<User> findByNameAndAge(String name, int age);
    // SELECT u FROM User u WHERE u.name = ?1 AND u.age = ?2

    // Or 조건
    List<User> findByNameOrEmail(String name, String email);
    // SELECT u FROM User u WHERE u.name = ?1 OR u.email = ?2

    // 비교 연산자
    List<User> findByAgeGreaterThan(int age);
    // WHERE age > ?1

    List<User> findByAgeGreaterThanEqual(int age);
    // WHERE age >= ?1

    List<User> findByAgeLessThan(int age);
    // WHERE age < ?1

    List<User> findByAgeBetween(int start, int end);
    // WHERE age BETWEEN ?1 AND ?2

    // LIKE
    List<User> findByNameContaining(String keyword);
    // WHERE name LIKE '%?1%'

    List<User> findByNameStartingWith(String prefix);
    // WHERE name LIKE '?1%'

    List<User> findByNameEndingWith(String suffix);
    // WHERE name LIKE '%?1'

    // IN
    List<User> findByIdIn(List<Long> ids);
    // WHERE id IN (?1)

    // NULL 체크
    List<User> findByEmailIsNull();
    // WHERE email IS NULL

    List<User> findByEmailIsNotNull();
    // WHERE email IS NOT NULL

    // 정렬
    List<User> findByNameOrderByAgeDesc(String name);
    // WHERE name = ?1 ORDER BY age DESC

    // 상위 N개
    List<User> findTop5ByOrderByCreatedAtDesc();
    // ORDER BY created_at DESC LIMIT 5

    User findFirstByOrderByIdDesc();
    // ORDER BY id DESC LIMIT 1

    // EXISTS
    boolean existsByEmail(String email);
    // SELECT COUNT(*) > 0 FROM User WHERE email = ?1

    // COUNT
    long countByStatus(String status);
    // SELECT COUNT(*) FROM User WHERE status = ?1

    // DELETE
    void deleteByStatus(String status);
    // DELETE FROM User WHERE status = ?1
}
```

### 2-2) 페이징과 정렬

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // Pageable로 페이징
    Page<User> findByStatus(String status, Pageable pageable);

    // Slice (다음 페이지 존재 여부만)
    Slice<User> findByAgeGreaterThan(int age, Pageable pageable);

    // Sort로 정렬
    List<User> findByStatus(String status, Sort sort);
}

// 사용
@Service
public class UserService {
    private final UserRepository userRepository;

    public Page<User> getUsers(int page, int size) {
        // 페이징 + 정렬
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return userRepository.findByStatus("ACTIVE", pageable);
    }

    public List<User> getSortedUsers() {
        // 정렬만
        Sort sort = Sort.by(Sort.Order.desc("age"), Sort.Order.asc("name"));
        return userRepository.findByStatus("ACTIVE", sort);
    }
}
```

## 3) @Query: 직접 쿼리 작성

### 3-1) JPQL 쿼리

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // JPQL (엔티티 기반)
    @Query("SELECT u FROM User u WHERE u.name = :name")
    List<User> findUsersByName(@Param("name") String name);

    // 복잡한 조건
    @Query("SELECT u FROM User u WHERE u.age > :minAge AND u.status = :status")
    List<User> findActiveUsers(@Param("minAge") int minAge, @Param("status") String status);

    // JOIN
    @Query("SELECT o FROM Order o JOIN FETCH o.user WHERE o.status = :status")
    List<Order> findOrdersWithUser(@Param("status") String status);

    // DTO 프로젝션
    @Query("SELECT new com.example.dto.UserDTO(u.id, u.name, u.email) " +
           "FROM User u WHERE u.status = :status")
    List<UserDTO> findUserDTOs(@Param("status") String status);

    // 집계
    @Query("SELECT COUNT(u) FROM User u WHERE u.status = :status")
    long countByStatus(@Param("status") String status);

    // 서브쿼리
    @Query("SELECT u FROM User u WHERE u.id IN " +
           "(SELECT o.user.id FROM Order o WHERE o.amount > :amount)")
    List<User> findUsersWithHighValueOrders(@Param("amount") int amount);
}
```

### 3-2) 네이티브 쿼리

```java
public interface UserRepository extends JpaRepository<User, Long> {

    // Native SQL
    @Query(value = "SELECT * FROM users WHERE name = :name", nativeQuery = true)
    List<User> findByNameNative(@Param("name") String name);

    // 복잡한 Native SQL (통계)
    @Query(value = """
        SELECT u.city, COUNT(*) as user_count
        FROM users u
        WHERE u.status = :status
        GROUP BY u.city
        HAVING COUNT(*) > :minCount
        ORDER BY user_count DESC
        """, nativeQuery = true)
    List<Object[]> getCityStatistics(@Param("status") String status,
                                     @Param("minCount") int minCount);

    // DTO 매핑 (Spring 3.0+)
    @Query(value = "SELECT id, name, email FROM users WHERE status = :status",
           nativeQuery = true)
    List<UserDTO> findUserDTOsNative(@Param("status") String status);
}
```

### 3-3) 수정 쿼리

```java
public interface UserRepository extends JpaRepository<User, Long> {

    @Modifying  // 수정/삭제 쿼리임을 표시
    @Query("UPDATE User u SET u.status = :status WHERE u.lastLoginAt < :date")
    int updateInactiveUsers(@Param("status") String status, @Param("date") LocalDateTime date);

    @Modifying
    @Query("DELETE FROM User u WHERE u.status = :status AND u.deletedAt < :date")
    int deleteOldUsers(@Param("status") String status, @Param("date") LocalDateTime date);

    // clearAutomatically: 영속성 컨텍스트 초기화
    @Modifying(clearAutomatically = true)
    @Query("UPDATE User u SET u.name = :newName WHERE u.id = :id")
    int updateUserName(@Param("id") Long id, @Param("newName") String newName);
}

// 사용 시 @Transactional 필수
@Service
public class UserService {
    private final UserRepository userRepository;

    @Transactional
    public void deactivateInactiveUsers() {
        LocalDateTime threshold = LocalDateTime.now().minusMonths(6);
        int updated = userRepository.updateInactiveUsers("INACTIVE", threshold);
        System.out.println("Updated: " + updated);
    }
}
```

## 4) Specification: 동적 쿼리

### 4-1) JpaSpecificationExecutor 상속

```java
public interface UserRepository extends JpaRepository<User, Long>,
                                         JpaSpecificationExecutor<User> {
}
```

### 4-2) Specification 작성

```java
public class UserSpecification {

    // 이름으로 검색
    public static Specification<User> hasName(String name) {
        return (root, query, cb) ->
            name == null ? null : cb.equal(root.get("name"), name);
    }

    // 나이 범위
    public static Specification<User> ageGreaterThan(Integer age) {
        return (root, query, cb) ->
            age == null ? null : cb.greaterThan(root.get("age"), age);
    }

    // 이메일 포함
    public static Specification<User> emailContains(String keyword) {
        return (root, query, cb) ->
            keyword == null ? null : cb.like(root.get("email"), "%" + keyword + "%");
    }

    // 상태
    public static Specification<User> hasStatus(String status) {
        return (root, query, cb) ->
            status == null ? null : cb.equal(root.get("status"), status);
    }
}

// 사용
@Service
public class UserService {
    private final UserRepository userRepository;

    public List<User> searchUsers(String name, Integer minAge, String email, String status) {
        // 동적으로 조건 조합
        Specification<User> spec = Specification.where(null);

        if (name != null) {
            spec = spec.and(UserSpecification.hasName(name));
        }
        if (minAge != null) {
            spec = spec.and(UserSpecification.ageGreaterThan(minAge));
        }
        if (email != null) {
            spec = spec.and(UserSpecification.emailContains(email));
        }
        if (status != null) {
            spec = spec.and(UserSpecification.hasStatus(status));
        }

        return userRepository.findAll(spec);
    }

    public Page<User> searchUsersWithPaging(String name, Integer minAge, Pageable pageable) {
        Specification<User> spec = Specification.where(UserSpecification.hasName(name))
                                                .and(UserSpecification.ageGreaterThan(minAge));
        return userRepository.findAll(spec, pageable);
    }
}
```

## 5) Projections: 필요한 필드만 조회

### 5-1) Interface 기반 Projection

```java
// Projection 인터페이스
public interface UserSummary {
    Long getId();
    String getName();
    String getEmail();
}

public interface UserRepository extends JpaRepository<User, Long> {
    List<UserSummary> findByStatus(String status);
    // SELECT u.id, u.name, u.email FROM User u WHERE u.status = ?1
}

// 사용
List<UserSummary> summaries = userRepository.findByStatus("ACTIVE");
summaries.forEach(s -> System.out.println(s.getName() + " - " + s.getEmail()));
```

### 5-2) Class 기반 Projection (DTO)

```java
// DTO 클래스
public class UserDTO {
    private Long id;
    private String name;
    private String email;

    public UserDTO(Long id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }
    // Getters
}

public interface UserRepository extends JpaRepository<User, Long> {
    @Query("SELECT new com.example.dto.UserDTO(u.id, u.name, u.email) " +
           "FROM User u WHERE u.status = :status")
    List<UserDTO> findUserDTOs(@Param("status") String status);
}
```

## 6) 실전 패턴

### 6-1) 동적 검색 API

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserRepository userRepository;

    @GetMapping("/search")
    public Page<User> searchUsers(
            @RequestParam(required = false) String name,
            @RequestParam(required = false) Integer minAge,
            @RequestParam(required = false) String email,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        Specification<User> spec = Specification.where(null);

        if (name != null) {
            spec = spec.and((root, query, cb) ->
                cb.like(root.get("name"), "%" + name + "%"));
        }
        if (minAge != null) {
            spec = spec.and((root, query, cb) ->
                cb.greaterThanOrEqualTo(root.get("age"), minAge));
        }
        if (email != null) {
            spec = spec.and((root, query, cb) ->
                cb.like(root.get("email"), "%" + email + "%"));
        }

        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return userRepository.findAll(spec, pageable);
    }
}
```

### 6-2) 배치 처리

```java
@Service
public class UserBatchService {
    private final UserRepository userRepository;

    @Transactional
    public void bulkUpdate() {
        // 대량 수정
        LocalDateTime threshold = LocalDateTime.now().minusMonths(6);
        int updated = userRepository.updateInactiveUsers("INACTIVE", threshold);
    }

    @Transactional
    public void bulkInsert(List<User> users) {
        // 배치 저장
        userRepository.saveAll(users);
        userRepository.flush();  // 즉시 DB 반영
    }
}
```

## 7) 자주 하는 실수

### ❌ 실수 1: N+1 문제

```java
// ❌ N+1 발생
List<Order> orders = orderRepository.findAll();
orders.forEach(order ->
    System.out.println(order.getUser().getName())  // N번 쿼리 발생
);

// ✅ Fetch Join 사용
@Query("SELECT o FROM Order o JOIN FETCH o.user")
List<Order> findAllWithUser();
```

### ❌ 실수 2: @Modifying 없이 UPDATE

```java
// ❌ 에러 발생
@Query("UPDATE User u SET u.status = 'INACTIVE'")
int deactivateAll();

// ✅ @Modifying 필수
@Modifying
@Query("UPDATE User u SET u.status = 'INACTIVE'")
int deactivateAll();
```

### ❌ 실수 3: 트랜잭션 없이 수정 쿼리

```java
// ❌ 트랜잭션 없음
public void updateUsers() {
    userRepository.updateInactiveUsers("INACTIVE", LocalDateTime.now());
    // 실행 안 됨!
}

// ✅ @Transactional 필수
@Transactional
public void updateUsers() {
    userRepository.updateInactiveUsers("INACTIVE", LocalDateTime.now());
}
```

## 연습 (추천)

1. **기본 Repository 구현**
   - Entity 생성 (Post, Comment)
   - JpaRepository 상속
   - 쿼리 메서드 작성

2. **동적 검색 기능**
   - Specification으로 동적 필터
   - 페이징/정렬 적용

3. **성능 최적화**
   - Projection으로 필요한 필드만 조회
   - Fetch Join으로 N+1 해결

## 요약: 스스로 점검할 것

- JpaRepository의 기본 CRUD 메서드를 사용할 수 있다
- 쿼리 메서드 이름 규칙을 이해하고 활용할 수 있다
- @Query로 JPQL/네이티브 쿼리를 작성할 수 있다
- Specification으로 동적 쿼리를 구현할 수 있다
- Projection으로 필요한 필드만 조회할 수 있다
- N+1 문제를 인지하고 해결할 수 있다

## 다음 단계

- JPA N+1 문제: `/learning/deep-dive/deep-dive-jpa-n-plus-1/`
- JPA 트랜잭션 경계: `/learning/deep-dive/deep-dive-jpa-transaction-boundaries/`
- QueryDSL: `/learning/deep-dive/deep-dive-querydsl-basics/`
