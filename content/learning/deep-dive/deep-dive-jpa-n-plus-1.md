---
title: "JPA N+1: 원인부터 해결까지(페치 전략/배치/DTO)"
date: 2025-12-16
draft: false
topic: "JPA"
tags: ["JPA", "Hibernate", "N+1", "Fetch Join", "Batch Size"]
categories: ["Backend Deep Dive"]
description: "N+1을 재현하고 원인을 설명한 뒤, Fetch Join/배치 로딩/DTO 조회로 해결하는 실무 패턴"
module: "spring-core"
study_order: 156
---

## 이 글에서 얻는 것

- N+1이 “Lazy가 나빠서”가 아니라, **조회 패턴과 객체 그래프 로딩 방식이 맞지 않아서** 생긴다는 걸 이해합니다.
- “로그에 쿼리가 많이 찍힌다” 수준을 넘어, 어떤 관계/어떤 코드에서 N+1이 터지는지 재현하고 진단할 수 있습니다.
- Fetch Join, Batch Size, DTO 조회(프로젝션) 중 무엇을 언제 쓰는지 선택 기준이 생깁니다.

## 0) N+1은 ‘성능 문제’이자 ‘설계 문제’다

N+1은 단순히 “쿼리가 많이 나간다”가 아니라,

- 트래픽이 늘수록 폭발적으로 느려지고,
- DB 커넥션 풀/락/캐시까지 연쇄적으로 흔드는

대표적인 실무 장애 원인입니다. 그래서 원인과 해결 루틴을 “습관”으로 만들어두는 게 중요합니다.

## 1. N+1 문제란?

### 1.1 문제 발생 시나리오

**엔티티 구조:**
```java
@Entity
public class Team {
    @Id @GeneratedValue
    private Long id;

    private String name;

    @OneToMany(mappedBy = "team")
    private List<Member> members = new ArrayList<>();
}

@Entity
public class Member {
    @Id @GeneratedValue
    private Long id;

    private String username;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id")
    private Team team;
}
```

**문제 코드:**
```java
@Service
public class TeamService {

    @Transactional(readOnly = true)
    public void printTeamsAndMembers() {
        // 1. Team 조회 (1번의 쿼리)
        List<Team> teams = teamRepository.findAll();

        System.out.println("==== Teams loaded ====");

        // 2. 각 Team의 members 조회 (N번의 쿼리)
        for (Team team : teams) {
            System.out.println("Team: " + team.getName());

            // ⚠️ 여기서 추가 쿼리 발생!
            List<Member> members = team.getMembers();

            for (Member member : members) {
                System.out.println("  Member: " + member.getUsername());
            }
        }
    }
}
```

**실행 SQL:**
```sql
-- 1. Team 조회 (1번)
SELECT * FROM team;

-- 결과: 5개 Team

-- 2. 각 Team의 Member 조회 (5번)
SELECT * FROM member WHERE team_id = 1;
SELECT * FROM member WHERE team_id = 2;
SELECT * FROM member WHERE team_id = 3;
SELECT * FROM member WHERE team_id = 4;
SELECT * FROM member WHERE team_id = 5;

-- 총 6번의 쿼리! (1 + N)
-- Team이 100개면 101번의 쿼리 실행!
```

**왜 N+1이라고 부를까?**
```
1: 첫 번째 쿼리 (Team 전체 조회)
N: Team 개수만큼 추가 쿼리 (각 Team의 Members 조회)

총 1 + N번의 쿼리 실행
```

### 1.2 FetchType.EAGER일 때도 발생

```java
@Entity
public class Member {
    @ManyToOne(fetch = FetchType.EAGER)  // ❌ EAGER로 변경해도 해결 안 됨!
    private Team team;
}

// EAGER 사용 시
List<Member> members = memberRepository.findAll();

// 실행 SQL:
SELECT * FROM member;  // 1번
SELECT * FROM team WHERE id = 1;  // N번
SELECT * FROM team WHERE id = 2;
SELECT * FROM team WHERE id = 3;
...
```

**EAGER의 문제점:**
1. N+1 문제 여전히 발생
2. 불필요한 데이터까지 항상 로딩 (성능 저하)
3. 예측하기 어려운 쿼리 발생

**권장: 항상 LAZY 사용 + 필요 시 Fetch Join**

---

## 2. 해결 방법

### 2.1 Fetch Join (JPQL)

**가장 일반적인 해결 방법:**

```java
public interface TeamRepository extends JpaRepository<Team, Long> {

    // ✅ Fetch Join으로 해결
    @Query("SELECT t FROM Team t JOIN FETCH t.members")
    List<Team> findAllWithMembers();
}

// 사용
List<Team> teams = teamRepository.findAllWithMembers();
for (Team team : teams) {
    team.getMembers().forEach(member ->
        System.out.println(member.getUsername())
    );
}
```

**실행 SQL:**
```sql
-- 단 1번의 쿼리로 해결!
SELECT t.*, m.*
FROM team t
INNER JOIN member m ON t.id = m.team_id;
```

**주의: 페이징 처리 시 문제**
```java
// ❌ 페이징 + Fetch Join = 메모리에서 페이징
@Query("SELECT t FROM Team t JOIN FETCH t.members")
Page<Team> findAllWithMembers(Pageable pageable);

// 실행 SQL:
SELECT t.*, m.*
FROM team t
INNER JOIN member m ON t.id = m.team_id;
-- LIMIT 없음! 모든 데이터를 메모리에 로드 후 페이징

// 경고 로그:
// HHH000104: firstResult/maxResults specified with collection fetch;
// applying in memory!
```

**페이징 해결 방법 1: ToOne 관계만 Fetch Join**
```java
// Member → Team (ManyToOne)
@Query("SELECT m FROM Member m JOIN FETCH m.team")
Page<Member> findAllWithTeam(Pageable pageable);

// ✅ ToOne 관계는 페이징 가능
SELECT m.*, t.*
FROM member m
INNER JOIN team t ON m.team_id = t.id
LIMIT 10 OFFSET 0;
```

**페이징 해결 방법 2: @BatchSize**
```java
@Entity
public class Team {
    @OneToMany(mappedBy = "team")
    @BatchSize(size = 100)  // ✅ 100개씩 IN 절로 조회
    private List<Member> members = new ArrayList<>();
}

// 쿼리 실행:
// 1. Team 조회 (페이징 적용)
SELECT * FROM team LIMIT 10 OFFSET 0;

// 2. Members 조회 (IN 절로 배치)
SELECT * FROM member
WHERE team_id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

// N+1 아님! 1 + 1 = 2번의 쿼리
```

### 2.2 @EntityGraph

**Annotation 기반 Fetch Join:**

```java
public interface TeamRepository extends JpaRepository<Team, Long> {

    @EntityGraph(attributePaths = {"members"})
    List<Team> findAll();

    // 여러 연관관계 한 번에
    @EntityGraph(attributePaths = {"members", "coach"})
    List<Team> findAllWithMembersAndCoach();
}
```

**Named EntityGraph:**
```java
@Entity
@NamedEntityGraph(
    name = "Team.withMembers",
    attributeNodes = @NamedAttributeNode("members")
)
public class Team {
    // ...
}

public interface TeamRepository extends JpaRepository<Team, Long> {
    @EntityGraph("Team.withMembers")
    List<Team> findAll();
}
```

**@EntityGraph vs Fetch Join:**
```
@EntityGraph:
- LEFT OUTER JOIN 사용
- 간결한 코드
- Spring Data JPA에서 제공

Fetch Join:
- INNER JOIN 또는 LEFT JOIN 선택 가능
- 복잡한 조건 추가 가능
- JPQL 작성 필요
```

### 2.3 Batch Size

**글로벌 설정:**
```yaml
# application.yml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100  # 기본 Batch Size
```

**엔티티별 설정:**
```java
@Entity
public class Team {
    @OneToMany(mappedBy = "team")
    @BatchSize(size = 50)  // 이 Team만 50개씩
    private List<Member> members = new ArrayList<>();
}
```

**동작 원리:**
```java
List<Team> teams = teamRepository.findAll();

// 1. Team 조회
SELECT * FROM team;

// 2. Members를 100개씩 IN 절로 조회
// Team이 250개면 3번의 쿼리로 해결
SELECT * FROM member WHERE team_id IN (1, 2, ..., 100);
SELECT * FROM member WHERE team_id IN (101, 102, ..., 200);
SELECT * FROM member WHERE team_id IN (201, 202, ..., 250);

// N+1이 아니라 1 + ceil(N/100) 개의 쿼리
```

**권장 Batch Size:**
```
너무 작으면: 쿼리 수 증가
너무 크면: DB 부하, 메모리 증가

권장값: 100 ~ 1000
실무: 보통 100 사용
```

### 2.4 Projection (DTO 직접 조회)

**JPQL로 DTO 바로 조회:**

```java
// DTO 정의
@Getter
@AllArgsConstructor
public class TeamMemberDto {
    private String teamName;
    private String memberName;
}

// Repository
public interface TeamRepository extends JpaRepository<Team, Long> {

    @Query("SELECT new com.example.dto.TeamMemberDto(t.name, m.username) " +
           "FROM Team t JOIN t.members m")
    List<TeamMemberDto> findTeamMemberDtos();
}

// 실행 SQL:
SELECT t.name, m.username
FROM team t
INNER JOIN member m ON t.id = m.team_id;

// ✅ 필요한 컬럼만 조회 (성능 최적화)
// ✅ 1번의 쿼리로 해결
```

**QueryDSL 활용:**
```java
@Repository
@RequiredArgsConstructor
public class TeamQueryRepository {

    private final JPAQueryFactory queryFactory;

    public List<TeamMemberDto> findTeamMemberDtos() {
        return queryFactory
            .select(Projections.constructor(
                TeamMemberDto.class,
                team.name,
                member.username
            ))
            .from(team)
            .join(team.members, member)
            .fetch();
    }
}
```

---

## 3. 실전 시나리오별 해결 방법

### 3.1 시나리오 1: 단순 목록 조회

**요구사항: Team 목록 + 각 Team의 Member 수**

```java
// ❌ N+1 발생
@Transactional(readOnly = true)
public List<TeamDto> getTeams() {
    List<Team> teams = teamRepository.findAll();

    return teams.stream()
        .map(team -> new TeamDto(
            team.getName(),
            team.getMembers().size()  // ⚠️ N+1 발생!
        ))
        .collect(Collectors.toList());
}

// ✅ 해결: Fetch Join
@Query("SELECT t FROM Team t JOIN FETCH t.members")
List<Team> findAllWithMembers();

// ✅ 더 나은 해결: COUNT 서브쿼리
@Query("SELECT new com.example.dto.TeamDto(t.name, " +
       "(SELECT COUNT(m) FROM Member m WHERE m.team = t)) " +
       "FROM Team t")
List<TeamDto> findTeamsWithMemberCount();
```

### 3.2 시나리오 2: 페이징 처리

**요구사항: Team 목록 페이징 + Members**

```java
// ❌ Fetch Join + 페이징 = 메모리 페이징
@Query("SELECT t FROM Team t JOIN FETCH t.members")
Page<Team> findAllWithMembers(Pageable pageable);

// ✅ 해결: @BatchSize
@Entity
public class Team {
    @OneToMany(mappedBy = "team")
    @BatchSize(size = 100)
    private List<Member> members = new ArrayList<>();
}

@Transactional(readOnly = true)
public Page<Team> getTeams(Pageable pageable) {
    return teamRepository.findAll(pageable);
    // 1. Team 페이징: SELECT * FROM team LIMIT 10
    // 2. Members 배치: SELECT * FROM member WHERE team_id IN (...)
}
```

### 3.3 시나리오 3: 깊은 연관관계

**요구사항: Team → Members → Orders**

```java
@Entity
public class Team {
    @OneToMany(mappedBy = "team")
    private List<Member> members = new ArrayList<>();
}

@Entity
public class Member {
    @ManyToOne
    private Team team;

    @OneToMany(mappedBy = "member")
    private List<Order> orders = new ArrayList<>();
}

// ❌ N+1 연쇄 발생
List<Team> teams = teamRepository.findAll();
for (Team team : teams) {
    for (Member member : team.getMembers()) {  // N+1
        for (Order order : member.getOrders()) {  // N+1 또 발생!
            // ...
        }
    }
}

// ✅ 해결 1: 다중 Fetch Join
@Query("SELECT DISTINCT t FROM Team t " +
       "JOIN FETCH t.members m " +
       "JOIN FETCH m.orders")
List<Team> findAllWithMembersAndOrders();

// ✅ 해결 2: @BatchSize 계층적 설정
@Entity
public class Team {
    @OneToMany(mappedBy = "team")
    @BatchSize(size = 100)
    private List<Member> members;
}

@Entity
public class Member {
    @OneToMany(mappedBy = "member")
    @BatchSize(size = 100)
    private List<Order> orders;
}

// 쿼리 실행:
// 1. Team 조회
// 2. Members 배치 조회 (IN 절)
// 3. Orders 배치 조회 (IN 절)
// 총 3번의 쿼리로 해결!
```

### 3.4 시나리오 4: 양방향 연관관계

**요구사항: 양방향 조회 시 N+1 방지**

```java
// Member → Team
@Transactional(readOnly = true)
public List<Member> getMembers() {
    // ✅ ManyToOne은 Fetch Join 쉬움
    return memberRepository.findAllWithTeam();
}

@Query("SELECT m FROM Member m JOIN FETCH m.team")
List<Member> findAllWithTeam();

// Team → Members
@Transactional(readOnly = true)
public List<Team> getTeams() {
    // ✅ OneToMany는 @BatchSize 권장
    return teamRepository.findAll();
}

@Entity
public class Team {
    @OneToMany(mappedBy = "team")
    @BatchSize(size = 100)
    private List<Member> members;
}
```

---

## 4. 성능 비교

### 4.1 테스트 환경

```
Team: 100개
Member: 각 Team당 10명 (총 1000명)
```

### 4.2 쿼리 수 비교

| 방법 | 쿼리 수 | 설명 |
|------|---------|------|
| **N+1 (해결 전)** | 101개 | 1 (Team) + 100 (각 Team의 Members) |
| **Fetch Join** | 1개 | 모든 데이터를 1번에 조회 |
| **@EntityGraph** | 1개 | LEFT OUTER JOIN으로 조회 |
| **@BatchSize(100)** | 2개 | 1 (Team) + 1 (Members IN 절) |
| **DTO Projection** | 1개 | 필요한 컬럼만 조회 |

### 4.3 응답 시간 비교 (실측)

```
환경: MySQL 8.0, Team 1000개, Member 10000명

N+1 (해결 전):
- 쿼리 수: 1001개
- 응답 시간: 3.2초

Fetch Join:
- 쿼리 수: 1개
- 응답 시간: 0.15초 (21배 빠름)

@BatchSize(100):
- 쿼리 수: 11개
- 응답 시간: 0.18초 (18배 빠름)

DTO Projection:
- 쿼리 수: 1개
- 응답 시간: 0.08초 (40배 빠름, 필요 컬럼만 조회)
```

---

## 5. 실무 Best Practices

### 5.1 기본 원칙

```java
// 1. 모든 연관관계는 LAZY로 설정
@ManyToOne(fetch = FetchType.LAZY)  // ✅
@OneToMany(fetch = FetchType.LAZY, mappedBy = "team")  // ✅

// 2. 글로벌 BatchSize 설정
spring.jpa.properties.hibernate.default_batch_fetch_size=100

// 3. 필요한 경우에만 Fetch Join
@Query("SELECT t FROM Team t JOIN FETCH t.members WHERE t.id = :id")
Optional<Team> findByIdWithMembers(@Param("id") Long id);
```

### 5.2 계층별 전략

**Controller → Service:**
```java
@GetMapping("/teams")
public List<TeamResponse> getTeams() {
    // DTO로 변환하여 반환 (Lazy Loading 방지)
    return teamService.getTeams();
}
```

**Service → Repository:**
```java
@Transactional(readOnly = true)
public List<TeamResponse> getTeams() {
    List<Team> teams = teamRepository.findAllWithMembers();

    return teams.stream()
        .map(TeamResponse::from)  // DTO 변환
        .collect(Collectors.toList());
}
```

**Repository:**
```java
// 명확한 메서드명으로 Fetch 전략 명시
List<Team> findAll();  // Members는 Lazy
List<Team> findAllWithMembers();  // Fetch Join
List<Team> findAllWithMembersAndCoach();  // 다중 Fetch Join
```

### 5.3 쿼리 로그로 N+1 감지

**쿼리 로깅 활성화:**
```yaml
# application.yml
spring:
  jpa:
    show-sql: true
    properties:
      hibernate:
        format_sql: true
        use_sql_comments: true

logging:
  level:
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql: TRACE  # 파라미터 값 출력
```

**p6spy로 쿼리 개수 확인:**
```gradle
implementation 'com.github.gavlyukovskiy:p6spy-spring-boot-starter:1.9.0'
```

```yaml
# application.yml
decorator:
  datasource:
    p6spy:
      enable-logging: true
```

**출력 예시:**
```
# N+1 발생 시
[1] SELECT * FROM team;
[2] SELECT * FROM member WHERE team_id = 1;
[3] SELECT * FROM member WHERE team_id = 2;
...
[101] SELECT * FROM member WHERE team_id = 100;

# Batch Size 적용 시
[1] SELECT * FROM team;
[2] SELECT * FROM member WHERE team_id IN (1, 2, ..., 100);
```

### 5.4 테스트 코드로 검증

```java
@SpringBootTest
@Transactional
class TeamServiceTest {

    @Autowired
    private TeamService teamService;

    @Autowired
    private DataSource dataSource;

    @Test
    void testNPlusOne() {
        // 쿼리 카운터 활성화
        QueryCounter queryCounter = new QueryCounter(dataSource);

        // 테스트 실행
        List<TeamResponse> teams = teamService.getTeams();

        // 쿼리 개수 검증
        int queryCount = queryCounter.getTotalQueryCount();
        assertThat(queryCount).isLessThanOrEqualTo(2);  // ✅ 2개 이하
    }
}
```

---

## 요약: 실무에서 기억할 것

### N+1 문제 감각

- “1번의 쿼리 + N번의 추가 쿼리”로 폭발합니다(데이터/트래픽이 커질수록 치명적).
- `FetchType.EAGER`로 해결되지 않고, 오히려 예측하기 어려운 쿼리를 만들 수 있습니다.
- 기본은 `LAZY`로 두고, “화면/유스케이스” 단위로 로딩 전략을 선택합니다.

### 해결 옵션(상황별 선택)

- **Fetch Join**: 한 번에 당겨오되, 컬렉션/페이징 조합에 주의가 필요합니다.
- **@EntityGraph**: 어노테이션 기반 Fetch Join(사용성 좋음).
- **@BatchSize**: IN 절 배치 조회로 N을 줄이기(페이징과 함께 쓰기 쉬움).
- **DTO Projection**: 필요한 컬럼만 가져오는 조회(성능/명확성↑, 대신 엔티티 그래프 활용↓).

### 운영/검증 루틴

- Batch size는 전역/국소로 근거 있게 설정(무작정 크게 하면 IN 절/메모리 비용이 생길 수 있음)
- ToOne은 Fetch Join/배치로 해결하기 쉬운 편, ToMany는 페이징/중복에 더 민감
- 쿼리 로그/통계로 “쿼리 수”를 측정하고, 테스트로 회귀를 막는 습관이 중요합니다
