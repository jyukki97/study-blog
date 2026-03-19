---
title: "멀티테넌시 설계 전략"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Multitenancy", "Schema", "Isolation", "Security", "SaaS", "Row Level Security"]
categories: ["Backend Deep Dive"]
description: "스키마/데이터베이스 분리, 테넌트 격리/보안, 마이그레이션·운영 고려사항과 실전 구현"
module: "architecture"
study_order: 490
---

## 이 글에서 얻는 것

- 멀티테넌시에서 가장 중요한 것(보안 격리/운영/비용)을 기준으로, Shared/Schema/DB 분리 전략을 선택할 수 있습니다.
- "테넌트 데이터 유출" 사고를 막기 위한 강제 장치(애플리케이션/DB/관측)를 설계할 수 있습니다.
- 테넌트별 마이그레이션/백업/과금 같은 운영 문제를 시스템적으로 풀어가는 감각을 얻습니다.
- 실제 코드(Spring Boot, JPA, PostgreSQL RLS, 모니터링)를 통해 즉시 적용할 수 있습니다.

---

## 0) 멀티테넌시는 '기능'이 아니라 '제약'이다

멀티테넌시는 결국 다음을 동시에 만족해야 합니다.

- 테넌트 간 데이터 격리(보안/규정)
- 운영 효율(한 플랫폼으로 여러 고객을 운영)
- 비용 효율(전용 인프라를 테넌트마다 둘 수는 없음)

어떤 격리 모델을 선택하든, 이 셋의 트레이드오프가 있습니다.

---

## 1) 격리 모델 3가지(실무 비교)

### 1-1) Shared DB + Shared Schema (tenant_id 컬럼)

```sql
CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    user_id     BIGINT NOT NULL,
    amount      DECIMAL(10, 2) NOT NULL,
    status      VARCHAR(20) NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_tenant ON orders(tenant_id, created_at DESC);
```

- **장점:** 가장 저렴, 운영 단순(스키마 하나), 리소스 공유 효율적
- **단점:** 격리 사고 리스크가 가장 큼(필터 누락이 곧 유출), noisy neighbor(핫 테넌트)

### 1-2) Shared DB + Separate Schema (테넌트별 스키마)

```sql
-- 테넌트별 스키마 생성
CREATE SCHEMA tenant_acme;
CREATE SCHEMA tenant_globex;

-- 각 스키마에 동일 테이블
CREATE TABLE tenant_acme.orders (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    amount      DECIMAL(10, 2) NOT NULL
);
```

- **장점:** 논리적 격리가 더 명확, 테넌트별 마이그레이션/인덱스 제어 가능
- **단점:** 스키마 수가 늘며 운영 복잡도 증가, DB 커넥션 풀 관리 어려움

### 1-3) Separate DB (테넌트별 DB/인스턴스)

- **장점:** 격리/보안/성능 측면에서 가장 강력, 핫 테넌트 분리에 유리, 테넌트별 백업/복구 독립
- **단점:** 비용/운영 부담 큼(백업/모니터링/마이그레이션을 테넌트 수만큼)

### 1-4) 격리 모델 비교표

| 기준 | Shared Schema | Separate Schema | Separate DB |
|------|:------------:|:---------------:|:-----------:|
| 비용 | ★★★ 최저 | ★★ 중간 | ★ 최고 |
| 격리 강도 | ★ 약함 | ★★ 중간 | ★★★ 최강 |
| 운영 복잡도 | ★★★ 단순 | ★★ 중간 | ★ 복잡 |
| 노이지 네이버 방지 | ★ 약함 | ★★ 가능 | ★★★ 완전 |
| 테넌트별 백업/복구 | ★ 어려움 | ★★ 가능 | ★★★ 독립 |
| 테넌트별 스키마 커스텀 | ★ 불가 | ★★★ 가능 | ★★★ 가능 |
| 최대 테넌트 수 | 수천~수만 | 수백~수천 | 수십~수백 |
| 규정 준수(GDPR 등) | ★ 추가 장치 필요 | ★★ 상대적 용이 | ★★★ 가장 용이 |

### 1-5) 실무에서 자주 쓰는 결론

```
대부분은 (1) Shared Schema로 시작하고,
규모/요구가 커지면 (2) Separate Schema 또는
"핫 테넌트만 (3) Separate DB"로 하이브리드로 갑니다.
```

**하이브리드 예시:**
- 일반 테넌트 → Shared Schema (비용 효율)
- Enterprise 테넌트 → Separate Schema 또는 DB (계약/규정 요구)
- 핫 테넌트 (트래픽 상위 5%) → Separate DB (성능 격리)

---

## 2) 격리 강제: '실수로 유출되는 길'을 닫아라

### 2-1) 애플리케이션 레벨 강제 (Spring Boot)

**TenantContext 구현:**

```java
public class TenantContext {

    private static final ThreadLocal<String> CURRENT_TENANT = new ThreadLocal<>();

    public static void setTenantId(String tenantId) {
        CURRENT_TENANT.set(tenantId);
    }

    public static String getTenantId() {
        String tenantId = CURRENT_TENANT.get();
        if (tenantId == null) {
            throw new TenantNotSetException("테넌트 컨텍스트가 설정되지 않았습니다");
        }
        return tenantId;
    }

    public static void clear() {
        CURRENT_TENANT.remove();
    }
}
```

**Filter로 자동 주입:**

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TenantFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain chain) throws ServletException, IOException {
        try {
            String tenantId = extractTenantId(request);
            if (tenantId == null) {
                response.sendError(HttpServletResponse.SC_BAD_REQUEST, "X-Tenant-Id 헤더 필수");
                return;
            }
            TenantContext.setTenantId(tenantId);
            MDC.put("tenantId", tenantId);  // 로그에 자동 태깅
            chain.doFilter(request, response);
        } finally {
            TenantContext.clear();
            MDC.remove("tenantId");
        }
    }

    private String extractTenantId(HttpServletRequest request) {
        // 1순위: 헤더
        String tenantId = request.getHeader("X-Tenant-Id");
        if (tenantId != null) return tenantId;

        // 2순위: JWT claim
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken jwt) {
            return jwt.getToken().getClaimAsString("tenant_id");
        }
        return null;
    }
}
```

**JPA Hibernate Filter로 자동 WHERE 조건 추가:**

```java
// Entity
@Entity
@Table(name = "orders")
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = String.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class Order {
    @Id @GeneratedValue
    private Long id;

    @Column(name = "tenant_id", nullable = false)
    private String tenantId;

    // ... 나머지 필드
}

// Interceptor로 모든 쿼리에 자동 적용
@Component
@RequiredArgsConstructor
public class TenantHibernateInterceptor implements HibernateInterceptor {

    @Override
    public void applyFilter(Session session) {
        session.enableFilter("tenantFilter")
               .setParameter("tenantId", TenantContext.getTenantId());
    }
}

// Aspect로 Repository 메서드마다 자동 활성화
@Aspect
@Component
public class TenantFilterAspect {

    @Autowired
    private EntityManager entityManager;

    @Before("execution(* com.example..repository.*.*(..))")
    public void enableTenantFilter() {
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter")
               .setParameter("tenantId", TenantContext.getTenantId());
    }
}
```

**핵심:** 개발자가 매번 `WHERE tenant_id = ?`를 붙이게 하지 않는다. 한 번이라도 빠지면 전 테넌트 데이터가 유출됩니다.

### 2-2) DB 레벨 강제: PostgreSQL Row Level Security (RLS)

RLS는 **DB가 직접 접근 제어**를 하므로 애플리케이션 버그로 인한 유출을 구조적으로 차단합니다.

```sql
-- 1. RLS 활성화
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;  -- 테이블 소유자에게도 적용

-- 2. 정책 정의
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- 3. 애플리케이션에서 세션 변수 설정
-- (매 트랜잭션 시작 시)
SET LOCAL app.current_tenant = 'acme-tenant-uuid';

-- 4. 이제 모든 쿼리에 자동 필터 적용
SELECT * FROM orders;
-- 실제 실행: SELECT * FROM orders WHERE tenant_id = 'acme-tenant-uuid'

INSERT INTO orders (tenant_id, ...) VALUES ('wrong-tenant-uuid', ...);
-- 실패: new row violates row-level security policy
```

**Spring Boot에서 RLS 연동:**

```java
@Component
@RequiredArgsConstructor
public class TenantConnectionInterceptor implements ConnectionCustomizer {

    @Override
    public void customize(Connection connection) throws SQLException {
        String tenantId = TenantContext.getTenantId();
        try (var stmt = connection.createStatement()) {
            stmt.execute("SET LOCAL app.current_tenant = '" + tenantId + "'");
        }
    }
}

// 또는 AOP 방식
@Aspect
@Component
public class RlsAspect {

    @Autowired
    private EntityManager em;

    @Before("@annotation(org.springframework.transaction.annotation.Transactional)")
    public void setTenantForRls() {
        em.createNativeQuery("SET LOCAL app.current_tenant = :tenantId")
          .setParameter("tenantId", TenantContext.getTenantId())
          .executeUpdate();
    }
}
```

### 2-3) 관측/감사

```java
// 테넌트 교차 접근 감지 (로그 분석)
@Aspect
@Component
@Slf4j
public class TenantAuditAspect {

    @AfterReturning(pointcut = "execution(* com.example..repository.*.*(..))", returning = "result")
    public void auditTenantAccess(JoinPoint jp, Object result) {
        if (result instanceof Collection<?> items) {
            String currentTenant = TenantContext.getTenantId();
            for (Object item : items) {
                if (item instanceof TenantAware ta 
                    && !ta.getTenantId().equals(currentTenant)) {
                    log.error("[SECURITY] 테넌트 교차 접근 감지! " +
                        "current={}, data={}, method={}",
                        currentTenant, ta.getTenantId(), jp.getSignature());
                    // 즉시 알림 발송
                    alertService.sendCritical("TENANT_CROSS_ACCESS", currentTenant);
                }
            }
        }
    }
}
```

**테넌트 감사 로그 스키마:**

```sql
CREATE TABLE tenant_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    user_id     BIGINT,
    action      VARCHAR(50) NOT NULL,   -- READ, WRITE, DELETE
    resource    VARCHAR(100) NOT NULL,   -- orders, users
    query       TEXT,
    ip_address  INET,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_time ON tenant_audit_log(tenant_id, created_at DESC);
```

---

## 3) 성능/인덱스: tenant_id는 설계의 중심이 된다

### 3-1) 인덱스 설계

Shared schema 모델에서 `tenant_id`는 거의 모든 쿼리에 들어갑니다.

```sql
-- ❌ tenant_id 없는 인덱스: 테넌트 격리 시 쓸모없음
CREATE INDEX idx_orders_status ON orders(status);

-- ✅ tenant_id를 선두에 둔 복합 인덱스
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status, created_at DESC);
CREATE INDEX idx_orders_tenant_user ON orders(tenant_id, user_id);

-- 유니크 제약도 tenant_id 포함
ALTER TABLE orders ADD CONSTRAINT uq_orders_tenant_orderno 
    UNIQUE (tenant_id, order_number);
```

### 3-2) 파티셔닝 전략

```sql
-- 테넌트별 파티셔닝 (핫 테넌트 격리)
CREATE TABLE orders (
    id          BIGSERIAL,
    tenant_id   UUID NOT NULL,
    amount      DECIMAL(10,2),
    created_at  TIMESTAMP DEFAULT NOW()
) PARTITION BY LIST (tenant_id);

-- 핫 테넌트는 전용 파티션
CREATE TABLE orders_tenant_acme PARTITION OF orders
    FOR VALUES IN ('acme-uuid');

-- 나머지는 해시 파티셔닝으로 분산
CREATE TABLE orders_default PARTITION OF orders DEFAULT;

-- 파티션 내부 인덱스
CREATE INDEX ON orders_tenant_acme (created_at DESC);
```

### 3-3) 커넥션 풀 격리 (noisy neighbor 방지)

```yaml
# application.yml
spring:
  datasource:
    hikari:
      maximum-pool-size: 50
      # 테넌트별 동적 제한은 코드로
```

```java
@Component
public class TenantConnectionLimiter {

    // 테넌트별 동시 커넥션 제한
    private final Map<String, Semaphore> tenantLimits = new ConcurrentHashMap<>();
    private static final int DEFAULT_LIMIT = 5;
    private static final int PREMIUM_LIMIT = 20;

    public <T> T withTenantLimit(String tenantId, Supplier<T> action) {
        Semaphore semaphore = tenantLimits.computeIfAbsent(
            tenantId, 
            id -> new Semaphore(isPremium(id) ? PREMIUM_LIMIT : DEFAULT_LIMIT)
        );

        if (!semaphore.tryAcquire(3, TimeUnit.SECONDS)) {
            throw new TenantRateLimitException(
                "테넌트 " + tenantId + " 동시 연결 제한 초과"
            );
        }
        try {
            return action.get();
        } finally {
            semaphore.release();
        }
    }
}
```

---

## 4) 마이그레이션/배포: 테넌트 수만큼 반복되는 문제

### 4-1) Flyway 멀티테넌시 마이그레이션

```java
@Component
@RequiredArgsConstructor
public class TenantMigrationRunner implements CommandLineRunner {

    private final TenantRepository tenantRepository;
    private final DataSource dataSource;

    @Override
    public void run(String... args) {
        List<Tenant> tenants = tenantRepository.findAllActive();

        for (Tenant tenant : tenants) {
            try {
                migrateSchema(tenant);
                log.info("마이그레이션 성공: tenant={}", tenant.getId());
            } catch (Exception e) {
                log.error("마이그레이션 실패: tenant={}", tenant.getId(), e);
                // 한 테넌트 실패가 다른 테넌트에 영향 주지 않음
                alertService.sendWarning("MIGRATION_FAILED", tenant.getId());
            }
        }
    }

    private void migrateSchema(Tenant tenant) {
        Flyway flyway = Flyway.configure()
                .dataSource(dataSource)
                .schemas(tenant.getSchemaName())
                .locations("classpath:db/migration/tenant")
                .baselineOnMigrate(true)
                .load();
        flyway.migrate();
    }
}
```

### 4-2) Expand/Contract 패턴 (무중단 스키마 변경)

```sql
-- Phase 1: Expand (새 컬럼 추가, 기존 유지)
ALTER TABLE orders ADD COLUMN shipping_address_v2 JSONB;

-- Phase 2: 듀얼 라이트 (양쪽 다 씀)
-- 애플리케이션에서 v1, v2 동시 기록

-- Phase 3: 데이터 마이그레이션 (배치로)
UPDATE orders SET shipping_address_v2 = to_jsonb(shipping_address)
WHERE shipping_address_v2 IS NULL
LIMIT 10000;  -- 테넌트별 배치 크기 제어

-- Phase 4: Contract (기존 컬럼 제거)
-- 모든 테넌트 마이그레이션 확인 후
ALTER TABLE orders DROP COLUMN shipping_address;
```

### 4-3) 테넌트별 마이그레이션 상태 추적

```sql
CREATE TABLE tenant_migration_status (
    tenant_id       UUID NOT NULL,
    migration_id    VARCHAR(100) NOT NULL,
    status          VARCHAR(20) NOT NULL,  -- PENDING, RUNNING, COMPLETED, FAILED
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    error_message   TEXT,
    PRIMARY KEY (tenant_id, migration_id)
);
```

---

## 5) 백업/복구/삭제: 테넌트 단위 운영을 준비하라

### 5-1) 테넌트별 데이터 익스포트 (GDPR 대응)

```java
@Service
@RequiredArgsConstructor
public class TenantDataExporter {

    private final JdbcTemplate jdbcTemplate;

    /**
     * GDPR Article 20: 데이터 이동권
     * 테넌트의 모든 데이터를 JSON으로 내보냅니다.
     */
    public Path exportTenantData(String tenantId) {
        Path exportDir = Path.of("/exports", tenantId, 
            LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")));
        Files.createDirectories(exportDir);

        // 테넌트 관련 테이블 목록
        List<String> tables = List.of("users", "orders", "payments", "audit_logs");

        for (String table : tables) {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM " + table + " WHERE tenant_id = ?", tenantId
            );
            
            Path file = exportDir.resolve(table + ".json");
            objectMapper.writeValue(file.toFile(), rows);
            log.info("테넌트 데이터 익스포트: tenant={}, table={}, rows={}", 
                tenantId, table, rows.size());
        }

        return exportDir;
    }

    /**
     * GDPR Article 17: 삭제권 (잊혀질 권리)
     * 소프트 삭제 → 30일 후 하드 삭제
     */
    @Transactional
    public void requestTenantDeletion(String tenantId) {
        // Phase 1: 소프트 삭제 (즉시)
        jdbcTemplate.update(
            "UPDATE tenants SET status = 'PENDING_DELETION', " +
            "deletion_requested_at = NOW() WHERE id = ?", tenantId
        );

        // Phase 2: 데이터 비활성화
        jdbcTemplate.update(
            "UPDATE orders SET status = 'DEACTIVATED' WHERE tenant_id = ?", tenantId
        );

        // Phase 3: 30일 후 배치로 하드 삭제 (별도 스케줄러)
        log.info("테넌트 삭제 요청 등록: tenant={}, 30일 후 하드 삭제 예정", tenantId);
    }
}
```

### 5-2) 테넌트별 백업 전략

| 격리 모델 | 백업 방식 | 복구 난이도 |
|----------|----------|------------|
| Shared Schema | 전체 백업 + 테넌트별 논리 추출 | ★ 어려움 (다른 테넌트 영향) |
| Separate Schema | `pg_dump --schema=tenant_xxx` | ★★ 중간 |
| Separate DB | `pg_dump` 인스턴스 단위 | ★★★ 쉬움 |

```bash
# Separate Schema 백업 예시
pg_dump --schema=tenant_acme -Fc mydb > backup_acme_$(date +%Y%m%d).dump

# 복구 (다른 테넌트 영향 없음)
pg_restore --schema=tenant_acme -d mydb backup_acme_20251216.dump
```

---

## 6) 과금/쿼터: 플랫폼 운영의 현실

### 6-1) 테넌트별 사용량 메트릭

```java
@Component
@RequiredArgsConstructor
public class TenantUsageTracker {

    private final MeterRegistry meterRegistry;
    private final RedisTemplate<String, String> redis;

    /**
     * API 호출 수 추적 (실시간)
     */
    public void trackApiCall(String tenantId, String endpoint) {
        // Prometheus 메트릭
        meterRegistry.counter("tenant.api.calls",
            "tenant", tenantId, "endpoint", endpoint).increment();

        // Redis 일별 카운터 (과금용)
        String key = String.format("usage:%s:%s", tenantId, LocalDate.now());
        redis.opsForHash().increment(key, "api_calls", 1);
        redis.expire(key, Duration.ofDays(90));
    }

    /**
     * 스토리지 사용량 추적 (배치)
     */
    @Scheduled(cron = "0 0 * * * *")  // 매시간
    public void trackStorageUsage() {
        List<TenantStorageUsage> usages = jdbcTemplate.query(
            "SELECT tenant_id, SUM(pg_total_relation_size(schemaname || '.' || tablename)) as bytes " +
            "FROM pg_tables WHERE schemaname LIKE 'tenant_%' GROUP BY tenant_id",
            (rs, _) -> new TenantStorageUsage(rs.getString(1), rs.getLong(2))
        );

        for (var usage : usages) {
            meterRegistry.gauge("tenant.storage.bytes",
                Tags.of("tenant", usage.tenantId()), usage.bytes());
        }
    }
}
```

### 6-2) 요금제별 쿼터/레이트 리밋

```java
@Component
public class TenantRateLimiter {

    // 요금제별 제한
    private static final Map<String, TenantQuota> QUOTAS = Map.of(
        "FREE",       new TenantQuota(1000, 100, 1_000_000),    // 일 1000 req, 초 100, 1MB 스토리지
        "STARTER",    new TenantQuota(10_000, 500, 10_000_000),
        "BUSINESS",   new TenantQuota(100_000, 2000, 100_000_000),
        "ENTERPRISE", new TenantQuota(-1, -1, -1)                // 무제한
    );

    public void checkQuota(String tenantId, String plan) {
        TenantQuota quota = QUOTAS.get(plan);
        if (quota.dailyLimit() < 0) return;  // 무제한

        long todayUsage = getTodayUsage(tenantId);
        if (todayUsage >= quota.dailyLimit()) {
            throw new TenantQuotaExceededException(
                String.format("일일 API 호출 한도 초과: %d/%d (plan=%s)",
                    todayUsage, quota.dailyLimit(), plan)
            );
        }
    }
}

record TenantQuota(long dailyLimit, long rpsLimit, long storageLimitBytes) {}
```

### 6-3) 요금제 비교표 예시

| 기능 | Free | Starter | Business | Enterprise |
|------|:----:|:-------:|:--------:|:----------:|
| 일 API 호출 | 1,000 | 10,000 | 100,000 | 무제한 |
| RPS | 100 | 500 | 2,000 | 커스텀 |
| 스토리지 | 1GB | 10GB | 100GB | 커스텀 |
| 데이터 보존 | 30일 | 1년 | 3년 | 커스텀 |
| 격리 모델 | Shared | Shared | Schema 분리 | DB 분리 |
| SLA | 99% | 99.5% | 99.9% | 99.99% |

---

## 7) 테넌트 온보딩/오프보딩 자동화

### 7-1) 온보딩 플로우

```java
@Service
@RequiredArgsConstructor
@Transactional
public class TenantOnboardingService {

    public TenantOnboardingResult onboard(TenantCreateRequest request) {
        // 1. 테넌트 메타데이터 생성
        Tenant tenant = tenantRepository.save(Tenant.create(
            request.name(), request.plan(), request.adminEmail()
        ));

        // 2. 격리 모델에 따른 인프라 프로비저닝
        switch (tenant.getIsolationModel()) {
            case SHARED_SCHEMA -> createSharedSchemaSetup(tenant);
            case SEPARATE_SCHEMA -> createSchema(tenant);
            case SEPARATE_DB -> provisionDatabase(tenant);
        }

        // 3. 초기 데이터 시드
        seedInitialData(tenant);

        // 4. 관리자 계정 생성
        User admin = userService.createAdmin(tenant.getId(), request.adminEmail());

        // 5. 모니터링 설정
        monitoringService.setupTenantDashboard(tenant);

        log.info("테넌트 온보딩 완료: id={}, plan={}", tenant.getId(), tenant.getPlan());
        return new TenantOnboardingResult(tenant, admin);
    }

    private void createSchema(Tenant tenant) {
        String schema = "tenant_" + tenant.getId().toString().replace("-", "_");
        jdbcTemplate.execute("CREATE SCHEMA " + schema);
        
        // Flyway로 스키마 마이그레이션
        Flyway.configure()
            .dataSource(dataSource)
            .schemas(schema)
            .locations("classpath:db/migration/tenant")
            .load()
            .migrate();
    }
}
```

### 7-2) 오프보딩 체크리스트

```java
public enum OffboardingStep {
    NOTIFY_ADMIN,           // 관리자에게 삭제 예정 알림
    EXPORT_DATA,            // 데이터 익스포트 (GDPR)
    REVOKE_API_KEYS,        // API 키 비활성화
    DEACTIVATE_USERS,       // 사용자 비활성화
    ARCHIVE_DATA,           // 데이터 아카이브 (cold storage)
    DELETE_SCHEMA,          // 스키마/DB 삭제
    CLEANUP_MONITORING,     // 모니터링 정리
    FINAL_AUDIT_LOG         // 최종 감사 로그
}
```

---

## 8) 모니터링과 알람

### 8-1) 핵심 메트릭

```promql
# 테넌트별 API 에러율
sum(rate(tenant_api_calls_total{status="5xx"}[5m])) by (tenant)
/ sum(rate(tenant_api_calls_total[5m])) by (tenant) > 0.01

# 테넌트별 레이턴시 p99
histogram_quantile(0.99, 
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, tenant)
) > 2.0

# 쿼터 사용률 80% 이상 (사전 경고)
tenant_quota_usage_ratio > 0.8

# 테넌트 간 데이터 크기 불균형 (핫 테넌트 감지)
max(tenant_storage_bytes) / avg(tenant_storage_bytes) > 10
```

### 8-2) 알람 설정

| 알람 | 임계값 | 심각도 | 대응 |
|------|--------|--------|------|
| 테넌트 교차 접근 | 1건 | Critical | 즉시 차단 + 인시던트 |
| 쿼터 80% 도달 | - | Warning | 테넌트에 알림 |
| 쿼터 100% 도달 | - | High | API 차단 + 업그레이드 안내 |
| 단일 테넌트 에러율 5% | 5분간 | High | 테넌트별 격리 확인 |
| 스토리지 증가율 비정상 | 일 10%+ | Warning | 남용 확인 |

---

## 9) 안티패턴과 트러블슈팅

### 9-1) 흔한 안티패턴

| 안티패턴 | 결과 | 해결 |
|---------|------|------|
| WHERE tenant_id 수동 추가 | 언젠가 누락 → 유출 | Hibernate Filter/RLS |
| 테넌트 없는 글로벌 캐시 | 캐시에서 교차 접근 | 캐시 키에 tenant_id 포함 |
| 공유 시퀀스/AUTO_INCREMENT | ID로 테넌트 데이터 크기 유추 | UUID 또는 테넌트별 시퀀스 |
| 테넌트 미설정 허용 | NullPointerException 또는 전체 조회 | Filter에서 필수 검증 |
| 백그라운드 잡에서 컨텍스트 누락 | 잘못된 테넌트로 실행 | Job 파라미터로 명시 전달 |

### 9-2) 캐시 키 설계

```java
// ❌ 테넌트를 무시한 캐시
@Cacheable("orders")
public Order getOrder(Long orderId) { ... }
// → 테넌트 A의 캐시를 테넌트 B가 읽을 수 있음!

// ✅ 테넌트를 포함한 캐시
@Cacheable(value = "orders", key = "#tenantId + ':' + #orderId")
public Order getOrder(String tenantId, Long orderId) { ... }

// 또는 CacheKeyGenerator 공통 적용
@Component
public class TenantAwareCacheKeyGenerator implements KeyGenerator {
    @Override
    public Object generate(Object target, Method method, Object... params) {
        return TenantContext.getTenantId() + ":" + 
               method.getName() + ":" + 
               Arrays.stream(params).map(Object::toString).collect(Collectors.joining(":"));
    }
}
```

### 9-3) 비동기/백그라운드 잡에서 테넌트 전파

```java
// ❌ ThreadLocal이 전파되지 않음
@Async
public void processAsync(Long orderId) {
    // TenantContext.getTenantId() → null!
}

// ✅ 명시적으로 전달
@Async
public void processAsync(String tenantId, Long orderId) {
    TenantContext.setTenantId(tenantId);
    try {
        // 처리
    } finally {
        TenantContext.clear();
    }
}

// 또는 TaskDecorator로 자동 전파
@Bean
public TaskExecutor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setTaskDecorator(runnable -> {
        String tenantId = TenantContext.getTenantId();
        return () -> {
            TenantContext.setTenantId(tenantId);
            try {
                runnable.run();
            } finally {
                TenantContext.clear();
            }
        };
    });
    return executor;
}
```

---

## 10) 부트스트랩 체크리스트

### Day 1 (설계 결정)
- [ ] 격리 모델 선택 (Shared/Schema/DB) + 근거 문서화
- [ ] TenantContext + Filter 구현
- [ ] 모든 쿼리에 tenant_id 자동 적용 (Hibernate Filter 또는 RLS)
- [ ] 테넌트 교차 접근 탐지 로직 + 테스트

### Week 1 (안정화)
- [ ] tenant_id 포함 인덱스 설계
- [ ] 캐시 키에 tenant_id 포함
- [ ] 비동기 작업 tenant 전파 검증
- [ ] 온보딩/오프보딩 자동화

### Month 1 (운영 성숙)
- [ ] 테넌트별 사용량 메트릭 + 대시보드
- [ ] 쿼터/레이트 리밋 구현
- [ ] GDPR 데이터 익스포트/삭제 자동화
- [ ] 핫 테넌트 분리 플레이북 작성
- [ ] 테넌트 격리 침투 테스트 (분기 1회)

---

## 연습(추천)

- 내 서비스가 멀티테넌시라면 "격리 요구사항"을 숫자로 정의해보기(예: 다른 테넌트 데이터 접근 0, 핫 테넌트가 전체 p99에 영향 주면 안 됨 등)
- Hibernate Filter를 적용하고, 의도적으로 tenant_id 필터를 빼본 쿼리가 차단되는지 확인해보기
- PostgreSQL RLS를 설정하고, 다른 테넌트의 데이터를 INSERT/SELECT 시도해서 차단되는지 검증해보기
- 테넌트 온보딩 API를 만들고, 스키마 생성부터 관리자 계정까지 자동화해보기

---

## 관련 심화 학습

- [데이터베이스 스키마 설계](/learning/deep-dive/deep-dive-database-schema-design-basics/) — 테넌트별 스키마 분리 기초
- [Spring Security 아키텍처](/learning/deep-dive/deep-dive-spring-security-architecture/) — 테넌트 기반 인증/인가
- [인증/인가 모델 (RBAC/ABAC/ReBAC)](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/) — 테넌트 격리와 권한 모델
- [MySQL 샤딩 전략](/learning/deep-dive/deep-dive-mysql-sharding/) — 테넌트 단위 샤딩
- [Connection Pool](/learning/deep-dive/deep-dive-connection-pool/) — 테넌트별 커넥션 관리
- [API Rate Limit & Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/) — 테넌트별 속도 제한
