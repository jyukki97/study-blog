---
title: "DB Connection Pool: HikariCP 설정과 성능 튜닝 완벽 가이드"
date: 2025-11-17
draft: false
topic: "Database"
tags: ["Connection Pool", "HikariCP", "Database", "Performance", "Spring Boot"]
categories: ["Backend Deep Dive"]
description: "커넥션 풀의 동작 원리와 HikariCP 설정으로 데이터베이스 성능을 최적화하는 실무 가이드"
module: "data-system"
study_order: 204
---

## 이 글에서 얻는 것

- **Connection Pool**이 왜 필요한지, 어떻게 동작하는지 이해합니다.
- **HikariCP**(Spring Boot 기본)의 핵심 설정을 튜닝할 수 있습니다.
- **적절한 Pool 크기**를 계산하고, 병목을 진단할 수 있습니다.
- Connection Leak을 예방하고, 모니터링할 수 있습니다.

## 0) Connection Pool은 "DB 연결을 재사용"한다

### Connection Pool 없이 (매번 생성/해제)

```java
// ❌ 매번 새 Connection 생성 (느림!)
public class UserRepository {
    public User findById(Long id) throws SQLException {
        // 1. Connection 생성 (비용 큼!)
        Connection conn = DriverManager.getConnection(url, username, password);

        // 2. 쿼리 실행
        PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
        pstmt.setLong(1, id);
        ResultSet rs = pstmt.executeQuery();

        // 3. Connection 닫기
        conn.close();

        return user;
    }
}
```

**문제점:**
- Connection 생성/해제 비용이 큼 (수십~수백 ms)
- 동시 요청 많으면 DB 부하 급증
- 네트워크/TCP 핸드셰이크 오버헤드

### Connection Pool 사용

```
┌──────────────────┐
│  Application     │
│                  │
│  Thread 1 ───────┼──→ 빌려감 (borrow)
│  Thread 2 ───────┼──→ 빌려감
│  Thread 3 ───────┼──→ 대기 중...
└──────────────────┘
         ↓
┌──────────────────┐
│ Connection Pool  │
│ [C1][C2][C3][C4] │ ← 미리 생성된 Connection들
│ [C5][C6][C7][C8] │
└──────────────────┘
         ↓
┌──────────────────┐
│    Database      │
└──────────────────┘
```

**장점:**
- Connection 재사용 → 생성/해제 비용 절감
- 동시 요청 제어 → DB 과부하 방지
- 빠른 응답 시간

## 1) HikariCP 기본 설정

### 1-1) Spring Boot 기본 설정

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb
    username: user
    password: pass
    driver-class-name: com.mysql.cj.jdbc.Driver

    hikari:
      # Pool 크기
      maximum-pool-size: 10        # 최대 Connection 수 (기본: 10)
      minimum-idle: 10             # 유지할 최소 Connection 수 (기본: maximum-pool-size와 동일)

      # Timeout 설정
      connection-timeout: 30000    # Connection 대기 시간 (ms, 기본: 30초)
      idle-timeout: 600000         # 유휴 Connection 유지 시간 (ms, 기본: 10분)
      max-lifetime: 1800000        # Connection 최대 수명 (ms, 기본: 30분)

      # 검증
      validation-timeout: 5000     # Connection 검증 시간 (ms, 기본: 5초)
      connection-test-query: SELECT 1  # 검증 쿼리 (MySQL은 불필요, isValid() 사용)

      # 기타
      pool-name: MyHikariPool      # Pool 이름 (로깅용)
      auto-commit: true            # 자동 커밋 (기본: true)
      read-only: false             # 읽기 전용 (기본: false)
```

### 1-2) Java Config

```java
@Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://localhost:3306/mydb");
        config.setUsername("user");
        config.setPassword("pass");

        // Pool 설정
        config.setMaximumPoolSize(10);
        config.setMinimumIdle(10);

        // Timeout
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);

        // 검증
        config.setValidationTimeout(5000);

        return new HikariDataSource(config);
    }
}
```

## 2) 핵심 설정 이해

### 2-1) maximum-pool-size: 최대 Connection 수

**"얼마로 설정해야 하나?"**

```
적정 Pool 크기 = (Core 개수 × 2) + Effective Spindle Count

예시:
- CPU 코어: 4개
- HDD: 1개 (또는 SSD: 계산에서 제외 가능)
- 권장 크기: (4 × 2) + 1 = 9 ~ 10개
```

**⚠️ 흔한 실수: Pool 크기를 너무 크게 설정**

```yaml
# ❌ 나쁜 예: 너무 큼
maximum-pool-size: 100

# 문제:
# - 100개 Thread가 동시에 쿼리 실행 → DB 과부하
# - Context Switching 증가 → 오히려 느려짐
# - 메모리 낭비

# ✅ 좋은 예: 적정 크기
maximum-pool-size: 10
```

**실무 팁:**
- 시작: 10개
- 모니터링 후 조정 (Connection 대기가 많으면 증가)
- DB 스펙도 고려 (max_connections 설정)

### 2-2) minimum-idle: 최소 유지 Connection

```yaml
# ✅ 권장: maximum-pool-size와 동일하게
minimum-idle: 10
maximum-pool-size: 10

# ⚠️ 다르게 설정 시:
minimum-idle: 2
maximum-pool-size: 10
# - 평소: 2개 유지
# - 부하 증가 시: 10개까지 확장
# - 부하 감소 시: 다시 2개로 축소
# → Pool 크기 변동으로 성능 불안정 가능
```

**HikariCP 공식 권장:** minimum-idle을 따로 설정하지 말고, maximum-pool-size로 고정

### 2-3) connection-timeout: Connection 대기 시간

```yaml
connection-timeout: 30000  # 30초

# - Pool에서 Connection을 얻을 때까지 대기 시간
# - 초과 시: SQLTransientConnectionException 발생
```

**시나리오:**
```
Pool 크기: 10
현재 사용 중: 10 (모두 사용 중)
새 요청 발생 → 30초 동안 대기 → 타임아웃!
```

**해결:**
1. Pool 크기 증가
2. 쿼리 최적화 (Connection 사용 시간 단축)
3. Timeout 증가 (임시 방편)

### 2-4) max-lifetime: Connection 최대 수명

```yaml
max-lifetime: 1800000  # 30분

# - Connection을 주기적으로 교체 (DB 연결 끊김 방지)
# - DB의 wait_timeout보다 짧게 설정
```

**MySQL 예:**
```sql
-- MySQL wait_timeout 확인
SHOW VARIABLES LIKE 'wait_timeout';
-- 28800 (8시간)

-- HikariCP max-lifetime 설정
max-lifetime: 1740000  # 29분 (wait_timeout보다 짧게)
```

## 3) Connection Leak 방지

### 3-1) Leak이란?

```java
// ❌ Connection Leak 발생
public void badExample() {
    Connection conn = dataSource.getConnection();
    PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM users");
    ResultSet rs = pstmt.executeQuery();

    // 예외 발생 시 close() 호출 안 됨!
    if (someCondition) {
        throw new RuntimeException("Error!");  // Leak!
    }

    conn.close();  // 도달 안 함
}
```

**결과:**
- Connection이 Pool로 반환 안 됨
- Pool 고갈 → 새 요청 대기 → 타임아웃

### 3-2) try-with-resources로 해결

```java
// ✅ 자동 close
public void goodExample() {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement pstmt = conn.prepareStatement("SELECT * FROM users");
         ResultSet rs = pstmt.executeQuery()) {

        // 쿼리 실행
        while (rs.next()) {
            // ...
        }

    }  // 자동으로 close() 호출 (예외 발생해도!)
}
```

### 3-3) Spring @Transactional로 자동 관리

```java
// ✅ Spring이 Connection 관리
@Service
public class UserService {

    @Autowired
    private JdbcTemplate jdbcTemplate;  // Pool에서 Connection 자동 관리

    @Transactional
    public void updateUser(User user) {
        jdbcTemplate.update("UPDATE users SET name = ? WHERE id = ?",
                           user.getName(), user.getId());
        // @Transactional이 끝나면 Connection 자동 반환
    }
}
```

### 3-4) Leak Detection

```yaml
spring:
  datasource:
    hikari:
      leak-detection-threshold: 60000  # 60초 이상 반환 안 되면 경고

# 로그:
# [HikariPool-1] Connection leak detection triggered for conn123,
# stack trace follows...
```

## 4) 모니터링

### 4-1) HikariCP 메트릭

```java
@Component
public class HikariMetrics {

    @Autowired
    private HikariDataSource dataSource;

    @Scheduled(fixedDelay = 10000)
    public void logMetrics() {
        HikariPoolMXBean poolMBean = dataSource.getHikariPoolMXBean();

        log.info("Active Connections: {}", poolMBean.getActiveConnections());
        log.info("Idle Connections: {}", poolMBean.getIdleConnections());
        log.info("Total Connections: {}", poolMBean.getTotalConnections());
        log.info("Threads Waiting: {}", poolMBean.getThreadsAwaitingConnection());
    }
}
```

### 4-2) Spring Boot Actuator

```yaml
# build.gradle
implementation 'org.springframework.boot:spring-boot-starter-actuator'
implementation 'io.micrometer:micrometer-registry-prometheus'

# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  metrics:
    enable:
      hikaricp: true
```

**메트릭 확인:**
```bash
# http://localhost:8080/actuator/metrics/hikaricp.connections.active
curl http://localhost:8080/actuator/metrics/hikaricp.connections

# Prometheus 엔드포인트
curl http://localhost:8080/actuator/prometheus | grep hikaricp
```

### 4-3) Grafana 대시보드

```
HikariCP Dashboard:
- Active Connections (사용 중인 Connection)
- Idle Connections (유휴 Connection)
- Pending Threads (대기 중인 Thread)
- Connection Acquire Time (Connection 획득 시간)
```

## 5) 실전 튜닝 가이드

### 5-1) 증상별 해결

**증상 1: Connection 대기 타임아웃**
```
SQLTransientConnectionException: Connection is not available
```

**원인:**
- Pool 크기 부족
- 쿼리 실행 시간 너무 김

**해결:**
1. Pool 크기 증가 (10 → 20)
2. 슬로우 쿼리 최적화
3. Connection 사용 시간 단축

**증상 2: Connection Leak**
```
[HikariPool] Connection leak detection triggered
```

**원인:**
- close() 호출 안 함

**해결:**
1. try-with-resources 사용
2. Spring @Transactional 사용
3. leak-detection-threshold로 모니터링

**증상 3: DB 과부하**
```
MySQL: Too many connections
```

**원인:**
- Pool 크기가 너무 큼
- 여러 인스턴스가 동시에 많은 Connection 생성

**해결:**
1. Pool 크기 감소
2. DB max_connections 증가
3. Read Replica 분산

### 5-2) 환경별 설정 예시

```yaml
# 개발 환경
spring:
  datasource:
    hikari:
      maximum-pool-size: 5
      connection-timeout: 10000

# 운영 환경
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 20
      connection-timeout: 30000
      max-lifetime: 1740000
      leak-detection-threshold: 60000
```

## 6) 자주 하는 실수

### ❌ 실수 1: Pool 크기를 너무 크게

```yaml
# ❌ 나쁜 예
maximum-pool-size: 200

# DB에 200개 Connection → 과부하
# CPU 코어 4개인데 200개 Thread → Context Switching 증가
```

### ❌ 실수 2: minimum-idle < maximum-pool-size

```yaml
# ⚠️ 비권장
minimum-idle: 2
maximum-pool-size: 50

# Pool 크기가 계속 변동 → 성능 불안정
```

### ❌ 실수 3: Connection 미반환

```java
// ❌ Leak 발생
Connection conn = dataSource.getConnection();
// close() 호출 안 함!
```

## 연습 (추천)

1. **HikariCP 설정**
   - Pool 크기 조정
   - Timeout 설정
   - 메트릭 모니터링

2. **Connection Leak 재현**
   - 의도적으로 close() 안 하기
   - leak-detection-threshold로 감지

3. **부하 테스트**
   - JMeter로 동시 요청 발생
   - Pool 크기별 성능 비교

## 요약: 스스로 점검할 것

- Connection Pool의 필요성을 설명할 수 있다
- HikariCP 핵심 설정(maximum-pool-size, timeout)을 이해한다
- 적정 Pool 크기를 계산할 수 있다
- Connection Leak을 예방할 수 있다
- Pool 메트릭을 모니터링할 수 있다

## 다음 단계

- 트랜잭션 관리: `/learning/deep-dive/deep-dive-spring-transaction/`
- JPA 트랜잭션 경계: `/learning/deep-dive/deep-dive-jpa-transaction-boundaries/`
- MySQL 성능 튜닝: `/learning/deep-dive/deep-dive-mysql-performance-tuning/`
