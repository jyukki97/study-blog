---
title: "트래픽 컷오버 & 데이터 마이그레이션 전략"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Migration", "Cutover", "Data Migration", "Dual Write", "CDC", "Feature Flag", "Spring Boot"]
categories: ["Backend Deep Dive"]
description: "점진적 트래픽 전환, 데이터 동기화, 롤백 전략을 설계하는 방법 — Spring Boot 코드, 비교 검증, 실행 런북 포함"
module: "architecture"
study_order: 440
---

## 이 글에서 얻는 것

- "컷오버"를 단발성 이벤트가 아니라, **검증 가능한 전환 과정**으로 설계할 수 있습니다.
- Shadow/Canary/키 기반 분할 같은 트래픽 전환 패턴을 **코드 레벨**에서 구현할 수 있습니다.
- 데이터 마이그레이션(Backfill, Dual-write, CDC)의 핵심 함정(중복/순서/충돌/롤백)을 이해하고 **실무 대응 코드**가 생깁니다.

---

## 0) 컷오버는 '스위치'가 아니라 '프로세스'다

전환은 두 가지가 동시에 필요합니다.

- 전환 중 문제가 생기면 즉시 되돌릴 수 있어야 하고(**rollback**)
- 전환이 성공했음을 지표로 증명할 수 있어야 합니다(**validation**)

이걸 만족하려면 "트래픽"과 "데이터"를 분리해서 봐야 합니다.

### 컷오버 프로세스 전체 흐름

```
[1. 준비]          [2. 검증]          [3. 전환]          [4. 안정화]
 백필/동기화 완료  → Shadow 비교 통과 → Canary 1%→25%   → 100% 전환
 롤백 스위치 확인   비교 오차 < 0.1%    에러율 < 0.5%      동기화 해제
 런북 리허설        지연 < 기준값       롤백 1분 이내      구 시스템 정리
```

---

## 1) 트래픽 전환 패턴 4가지

### 1-1) Big Bang(일괄 전환)

```
[모든 트래픽] ──DNS/LB 변경──→ [새 시스템]
```

- 장점: 단순
- 단점: 실패 시 충격이 크고, 원인 분리가 어렵다
- **권장 시나리오**: 영향 범위가 작은 내부 도구, 읽기 전용 서비스

### 1-2) Canary(비율/그룹 전환)

```
[전체 트래픽] ─→ [라우터/LB]
                  ├─ 95% → [기존 시스템]
                  └─  5% → [새 시스템] ← 모니터링
```

- 일부 사용자/트래픽만 새 경로로 전환하며 관측
- 실패 시 영향이 제한되고 롤백이 빠름
- **비율 스케줄**: 1% → 5% → 25% → 50% → 100% (각 단계에서 관측 시간 확보)

### 1-3) Shadow/Mirroring(미러링)

```
[트래픽] ──→ [기존 시스템] → [응답 반환]
         └──→ [새 시스템]  → [응답 비교 (반환하지 않음)]
```

- 실제 트래픽을 새 시스템에도 보내되, 응답은 버리거나 비교만
- **주의**: 쓰기 요청은 부작용을 조심해야 합니다

### 1-4) Key-based Split(키 기반 분할)

```
[트래픽] ──→ [라우터]
              ├─ userId % 100 < 10 → [새 시스템]
              └─ 나머지            → [기존 시스템]
```

- 사용자/테넌트/리소스 키로 라우팅을 분할
- 특정 그룹을 "완전히" 새 시스템으로 옮기기 쉬움

### 패턴 비교표

| 패턴 | 위험도 | 복잡도 | 검증 수준 | 롤백 속도 | 권장 시나리오 |
|------|--------|--------|----------|----------|-------------|
| Big Bang | 🔴 높음 | 낮음 | 낮음 | 느림 | 소규모/읽기전용 |
| Canary | 🟡 중간 | 중간 | **높음** | **빠름** | 대부분의 서비스 |
| Shadow | 🟢 낮음 | **높음** | **매우 높음** | N/A | 중요 마이그레이션 |
| Key-based | 🟡 중간 | 중간 | 높음 | 빠름 | 멀티테넌트 |

---

## 2) 안전한 컷오버의 전제 3가지

### 2-1) 관측성 — 새/구 경로 구분

```java
/**
 * 모든 요청에 라우팅 버전 태그를 달아 모니터링에서 구분
 */
@Component
public class RoutingVersionFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        String routingVersion = determineVersion((HttpServletRequest) request);

        // MDC에 기록 → 로그/트레이싱에 자동 포함
        MDC.put("routing_version", routingVersion);

        // Micrometer 태그
        Timer.Sample sample = Timer.start();
        try {
            chain.doFilter(request, response);
        } finally {
            HttpServletResponse res = (HttpServletResponse) response;
            sample.stop(Timer.builder("http.server.requests")
                .tag("routing_version", routingVersion)
                .tag("status", String.valueOf(res.getStatus()))
                .register(meterRegistry));
            MDC.remove("routing_version");
        }
    }

    private String determineVersion(HttpServletRequest request) {
        // 피처 플래그 또는 헤더 기반
        return featureFlagService.isNewSystem(request) ? "v2" : "v1";
    }
}
```

### 2-2) 비교 — Shadow 응답 비교 프레임워크

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class ShadowComparisonService {
    private final RestTemplate legacyClient;
    private final RestTemplate newClient;
    private final MeterRegistry meterRegistry;
    private final ComparisonResultRepository resultRepo;

    /**
     * 기존 시스템 응답을 반환하면서, 새 시스템 응답과 비교
     */
    public <T> T executeWithShadow(String path, Class<T> responseType,
                                    Object... uriVars) {
        // 1) 기존 시스템 호출 (이것을 반환)
        T legacyResponse = legacyClient.getForObject(
            "http://legacy-service" + path, responseType, uriVars);

        // 2) 새 시스템 비동기 호출 (응답은 비교용)
        CompletableFuture.runAsync(() -> {
            try {
                T newResponse = newClient.getForObject(
                    "http://new-service" + path, responseType, uriVars);

                boolean match = deepEquals(legacyResponse, newResponse);
                meterRegistry.counter("shadow.comparison",
                    "path", path,
                    "match", String.valueOf(match)).increment();

                if (!match) {
                    ComparisonResult diff = ComparisonResult.builder()
                        .path(path)
                        .legacyResponse(toJson(legacyResponse))
                        .newResponse(toJson(newResponse))
                        .timestamp(Instant.now())
                        .build();
                    resultRepo.save(diff);
                    log.warn("Shadow 불일치: path={}", path);
                }
            } catch (Exception e) {
                meterRegistry.counter("shadow.error",
                    "path", path).increment();
                log.error("Shadow 호출 실패: path={}, error={}",
                    path, e.getMessage());
            }
        });

        return legacyResponse;
    }
}
```

### 2-3) 롤백 스위치 — 피처 플래그 기반

```java
@Service
@RequiredArgsConstructor
public class RoutingDecisionService {
    private final FeatureFlagClient featureFlags;

    /**
     * 트래픽 라우팅 결정 — 피처 플래그 기반으로 즉시 롤백 가능
     */
    public RoutingTarget decide(String userId, String endpoint) {
        // 1) 킬 스위치: 전체 롤백
        if (featureFlags.getBooleanValue("migration.kill-switch", false)) {
            return RoutingTarget.LEGACY;
        }

        // 2) 엔드포인트별 전환 단계
        String phase = featureFlags.getStringValue(
            "migration.phase." + endpoint, "legacy");

        return switch (phase) {
            case "shadow" -> RoutingTarget.SHADOW;   // 비교만
            case "canary" -> {
                // 3) Canary 비율 확인
                int percentage = featureFlags.getIntValue(
                    "migration.canary-pct." + endpoint, 0);
                int bucket = Math.abs(userId.hashCode()) % 100;
                yield bucket < percentage
                    ? RoutingTarget.NEW : RoutingTarget.LEGACY;
            }
            case "new" -> RoutingTarget.NEW;          // 완전 전환
            default -> RoutingTarget.LEGACY;
        };
    }
}

public enum RoutingTarget {
    LEGACY, NEW, SHADOW
}
```

---

## 3) 데이터 마이그레이션 — 3가지 전략과 실무 코드

### 3-1) Backfill + Read Switch

```
[기존 DB] ──Backfill 배치──→ [새 DB]
               완료 후
[읽기] ──→ [새 DB]
[쓰기] ──→ [기존 DB] ──동기화──→ [새 DB]
```

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class BackfillJob {
    private final JdbcTemplate legacyJdbc;
    private final JdbcTemplate newJdbc;
    private final MeterRegistry meterRegistry;

    /**
     * 커서 기반 배치 백필 — 전체 테이블 마이그레이션
     */
    @Scheduled(fixedDelay = 1000) // 백필 완료까지 반복
    public void backfillUsers() {
        String lastId = getCheckpoint("users_backfill");
        int batchSize = 500;

        List<Map<String, Object>> rows = legacyJdbc.queryForList(
            "SELECT * FROM users WHERE id > ? ORDER BY id LIMIT ?",
            lastId, batchSize);

        if (rows.isEmpty()) {
            log.info("백필 완료: users");
            return;
        }

        // 배치 INSERT (upsert로 중복 안전)
        String upsertSql = """
            INSERT INTO users (id, name, email, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                updated_at = EXCLUDED.updated_at
            """;

        newJdbc.batchUpdate(upsertSql, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                Map<String, Object> row = rows.get(i);
                ps.setString(1, (String) row.get("id"));
                ps.setString(2, (String) row.get("name"));
                ps.setString(3, (String) row.get("email"));
                ps.setTimestamp(4, (Timestamp) row.get("created_at"));
                ps.setTimestamp(5, (Timestamp) row.get("updated_at"));
            }

            @Override
            public int getBatchSize() { return rows.size(); }
        });

        String newLastId = (String) rows.get(rows.size() - 1).get("id");
        saveCheckpoint("users_backfill", newLastId);

        meterRegistry.counter("backfill.rows", "table", "users")
            .increment(rows.size());
        log.info("백필 진행: users lastId={}, batch={}", newLastId, rows.size());
    }
}
```

### 3-2) Dual Write(이중 쓰기) — Outbox 패턴 기반

직접 이중 쓰기는 실패/순서 문제가 많으므로, **Outbox 패턴**이 더 안전합니다.

```java
@Service
@RequiredArgsConstructor
@Transactional
public class DualWriteUserService {
    private final UserRepository userRepo;
    private final OutboxRepository outboxRepo;

    /**
     * 기존 DB에 쓰기 + Outbox 이벤트 발행 (같은 트랜잭션)
     * → CDC 또는 폴러가 Outbox를 읽어 새 DB에 반영
     */
    public User createUser(CreateUserRequest request) {
        // 1) 기존 DB에 쓰기
        User user = User.builder()
            .id(UUID.randomUUID().toString())
            .name(request.getName())
            .email(request.getEmail())
            .build();
        userRepo.save(user);

        // 2) Outbox 이벤트 (같은 트랜잭션 → 원자성 보장)
        OutboxEvent event = OutboxEvent.builder()
            .aggregateType("User")
            .aggregateId(user.getId())
            .eventType("UserCreated")
            .payload(toJson(user))
            .createdAt(Instant.now())
            .build();
        outboxRepo.save(event);

        return user;
    }
}
```

**Outbox 폴러 → 새 DB 반영**:

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class OutboxReplicator {
    private final OutboxRepository outboxRepo;
    private final JdbcTemplate newJdbc;

    @Scheduled(fixedDelay = 500)
    @Transactional
    public void pollAndReplicate() {
        List<OutboxEvent> events = outboxRepo.findTop100ByProcessedFalse();

        for (OutboxEvent event : events) {
            try {
                applyToNewDb(event);
                event.setProcessed(true);
                event.setProcessedAt(Instant.now());
            } catch (Exception e) {
                event.setRetryCount(event.getRetryCount() + 1);
                if (event.getRetryCount() > 5) {
                    event.setStatus("DEAD_LETTER");
                    log.error("DLQ 이동: eventId={}", event.getId());
                }
            }
        }
        outboxRepo.saveAll(events);
    }

    private void applyToNewDb(OutboxEvent event) {
        // eventType에 따라 새 DB에 upsert
        switch (event.getEventType()) {
            case "UserCreated", "UserUpdated" -> {
                User user = fromJson(event.getPayload(), User.class);
                newJdbc.update("""
                    INSERT INTO users (id, name, email, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        email = EXCLUDED.email,
                        updated_at = EXCLUDED.updated_at
                    """, user.getId(), user.getName(),
                    user.getEmail(), Instant.now());
            }
        }
    }
}
```

### 3-3) CDC(Change Data Capture) — Debezium 설정 예시

```json
{
  "name": "user-migration-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "database.hostname": "legacy-db.internal",
    "database.port": "3306",
    "database.user": "cdc_reader",
    "database.password": "${secrets.cdc_password}",
    "database.server.id": "10001",
    "database.include.list": "legacy_app",
    "table.include.list": "legacy_app.users,legacy_app.orders",
    "topic.prefix": "migration",
    "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
    "schema.history.internal.kafka.topic": "schema-changes.migration",
    "transforms": "route",
    "transforms.route.type": "io.debezium.transforms.ByLogicalTableRouter",
    "transforms.route.topic.regex": "migration.legacy_app.(.*)",
    "transforms.route.topic.replacement": "migration.$1"
  }
}
```

### 전략 비교표

| 전략 | 복잡도 | 데이터 일관성 | 코드 변경량 | 적합 시나리오 |
|------|--------|-------------|-----------|-------------|
| Backfill + Read Switch | 🟢 낮음 | 최종 일관성 | 적음 | 읽기 분리 먼저 |
| Dual Write (Outbox) | 🟡 중간 | **강한 일관성** | 중간 | 쓰기 동시 필요 |
| CDC (Debezium) | 🔴 높음 | 최종 일관성 | **적음** | 코드 변경 최소화 |

---

## 4) 충돌/순서/중복 — 전환에서 반드시 터지는 것들

전환 중에는 아래가 현실적으로 발생합니다.

### 4-1) 문제 유형과 대응

| 문제 | 원인 | 대응 패턴 |
|------|------|----------|
| 중복 처리 | 재시도, 네트워크 | **멱등성 키** (event_id 기반 dedup) |
| 순서 역전 | 비동기/큐 | **버전/타임스탬프** (Last-Writer-Wins) |
| 부분 실패 | 한쪽만 성공 | **Outbox + 보상 트랜잭션** |
| 스키마 불일치 | 마이그레이션 중 스키마 변경 | **Expand-Contract** 패턴 |

### 4-2) 멱등성 + 버전 관리 코드

```java
@Service
@RequiredArgsConstructor
public class IdempotentMigrationWriter {
    private final JdbcTemplate jdbc;

    /**
     * version 비교로 순서 역전 방지 + ON CONFLICT로 멱등성 보장
     */
    public void upsertWithVersion(String table, String id,
                                   Map<String, Object> data, long version) {
        String sql = String.format("""
            INSERT INTO %s (id, data, version, updated_at)
            VALUES (?, ?::jsonb, ?, NOW())
            ON CONFLICT (id) DO UPDATE SET
                data = EXCLUDED.data,
                version = EXCLUDED.version,
                updated_at = NOW()
            WHERE %s.version < EXCLUDED.version
            """, table, table);

        int updated = jdbc.update(sql, id, toJson(data), version);
        if (updated == 0) {
            // version이 같거나 낮음 → 이미 최신 데이터 존재
            log.debug("스킵 (이미 최신): table={}, id={}, version={}",
                table, id, version);
        }
    }
}
```

---

## 5) 데이터 정합성 검증 — 자동 비교 도구

전환 후 "데이터가 맞는지"를 자동으로 검증해야 합니다.

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class DataConsistencyChecker {
    private final JdbcTemplate legacyJdbc;
    private final JdbcTemplate newJdbc;
    private final MeterRegistry meterRegistry;

    /**
     * 주기적으로 랜덤 샘플링 비교
     */
    @Scheduled(fixedRate = 60_000) // 1분마다
    public void checkConsistency() {
        // 1) 전체 레코드 수 비교
        Long legacyCount = legacyJdbc.queryForObject(
            "SELECT COUNT(*) FROM users", Long.class);
        Long newCount = newJdbc.queryForObject(
            "SELECT COUNT(*) FROM users", Long.class);

        long countDiff = Math.abs(legacyCount - newCount);
        meterRegistry.gauge("migration.count_diff", countDiff);

        if (countDiff > 100) {
            log.error("레코드 수 불일치: legacy={}, new={}, diff={}",
                legacyCount, newCount, countDiff);
        }

        // 2) 랜덤 100건 상세 비교
        List<Map<String, Object>> sample = legacyJdbc.queryForList(
            "SELECT * FROM users ORDER BY RANDOM() LIMIT 100");

        int mismatches = 0;
        for (Map<String, Object> legacyRow : sample) {
            String id = (String) legacyRow.get("id");
            List<Map<String, Object>> newRows = newJdbc.queryForList(
                "SELECT * FROM users WHERE id = ?", id);

            if (newRows.isEmpty()) {
                mismatches++;
                log.warn("누락: id={}", id);
            } else if (!dataEquals(legacyRow, newRows.get(0))) {
                mismatches++;
                log.warn("불일치: id={}", id);
            }
        }

        double mismatchRate = (double) mismatches / sample.size();
        meterRegistry.gauge("migration.mismatch_rate", mismatchRate);

        if (mismatchRate > 0.01) { // 1% 초과
            log.error("정합성 알람: mismatch_rate={:.2f}%",
                mismatchRate * 100);
        }
    }
}
```

---

## 6) 롤백 설계 — 데이터까지 고려

트래픽 롤백은 보통 쉽습니다(라우팅을 되돌리면 됨).
하지만 **데이터가 이미 새 저장소에만 쓰였으면 롤백이 어려워집니다.**

### 6-1) 안전한 롤백을 위한 원칙

```
Phase 1 (Shadow)     → 롤백 불필요 (새 시스템 쓰기 없음)
Phase 2 (Canary)     → 이중 쓰기 유지 → 라우팅만 롤백
Phase 3 (Full Cut)   → 동기화 유지 기간 필요 (보통 1~2주)
Phase 4 (Cleanup)    → 동기화 해제 → 롤백 불가 (이 단계 전 최종 확인)
```

### 6-2) 롤백 의사결정 트리

```
"문제 발생!"
 ├─ 에러율 > 5% → 즉시 롤백 (킬 스위치)
 ├─ 에러율 1~5%
 │   ├─ 특정 엔드포인트만? → 해당 엔드포인트만 롤백
 │   └─ 전반적? → Canary 비율 축소 (50% → 5%)
 ├─ 데이터 불일치 감지
 │   ├─ 불일치율 < 0.1% → 조사 후 패치
 │   └─ 불일치율 > 0.1% → Canary 중단 + 데이터 보정
 └─ 지연 증가만
     ├─ P99 < SLO × 2 → 관찰 유지
     └─ P99 > SLO × 2 → Canary 비율 축소
```

---

## 7) 실행 런북 — 상세 템플릿

### Phase 0: 준비 (D-7)

- [ ] 백필 배치 구현 & 테스트 완료
- [ ] 데이터 정합성 검증 도구 구현
- [ ] 피처 플래그 설정 (킬 스위치, 엔드포인트별 phase)
- [ ] Grafana 대시보드 준비: v1/v2 비교 패널
- [ ] 롤백 런북 작성 & 리허설 (staging)
- [ ] 관련 팀 공지 & 온콜 일정 확인

### Phase 1: Shadow (D-day ~ D+3)

- [ ] `migration.phase.{endpoint}` = `shadow` 설정
- [ ] Shadow 비교 결과 모니터링 시작
- [ ] 목표: 불일치율 < 0.1%, 에러 0건
- [ ] 불일치 원인 분석 & 수정

### Phase 2: Canary (D+4 ~ D+10)

- [ ] `migration.phase.{endpoint}` = `canary`
- [ ] `migration.canary-pct.{endpoint}` = 1 → 5 → 25 → 50
- [ ] 각 단계에서 최소 24시간 관찰
- [ ] 모니터링: 에러율, P50/P99 지연, 데이터 정합성
- [ ] 이상 시 즉시 비율 축소 또는 롤백

### Phase 3: Full Cutover (D+11 ~ D+14)

- [ ] `migration.canary-pct` = 100
- [ ] 이중 쓰기/동기화 유지 (롤백 대비)
- [ ] 72시간 무사고 확인

### Phase 4: Cleanup (D+14 이후)

- [ ] 이중 쓰기/동기화 해제
- [ ] 기존 시스템 읽기 전용 전환
- [ ] 기존 데이터 아카이브 계획
- [ ] 피처 플래그 정리
- [ ] 마이그레이션 회고 (문서화)

---

## 8) 운영 체크리스트

### 전환 전

- [ ] 백필 완료율 100% 확인
- [ ] 정합성 검증 불일치 < 0.1%
- [ ] 롤백 스위치 테스트 (킬 스위치 ON → 즉시 기존으로 전환)
- [ ] 부하 테스트: 새 시스템 트래픽 x2 처리 가능 확인

### 전환 중

- [ ] Grafana: v1/v2 에러율/지연/처리량 실시간 비교
- [ ] 알람: 에러율 > 1% (Warning), > 5% (Critical, 자동 롤백)
- [ ] 데이터 정합성 체커 1분마다 실행
- [ ] 온콜 담당자 대기

### 전환 후

- [ ] 동기화 해제 전 72시간 무사고 확인
- [ ] 기존 시스템 리소스 정리 계획
- [ ] 마이그레이션 메트릭 아카이브 (회고용)

---

## 9) 안티패턴 6가지

| # | 안티패턴 | 증상 | 해결 |
|---|---------|------|------|
| 1 | 검증 없는 Big Bang | 전환 후 대량 장애 | Shadow/Canary 단계 필수 |
| 2 | 직접 Dual Write | 부분 실패, 데이터 불일치 | Outbox 패턴 또는 CDC |
| 3 | 롤백 플랜 없음 | 문제 시 수동 복구 수시간 | 킬 스위치 + 롤백 런북 |
| 4 | 동기화 조기 해제 | 롤백 불가 상태에서 장애 | 최소 1~2주 동기화 유지 |
| 5 | 정합성 미검증 | 전환 후 데이터 오염 발견 | 자동 비교 도구 필수 |
| 6 | 한 번에 100% | 충격 범위 제어 불가 | 1% → 5% → 25% 점진 |

---

## 연습(추천)

1. **Backfill 설계**: "사용자 프로필 저장소"를 예로 들어 Backfill + Read Switch 시나리오를 설계 (지표/롤백 조건 포함)
2. **Dual Write 실험**: Outbox 패턴으로 이중 쓰기를 구현하고, 네트워크 장애 시뮬레이션에서 정합성이 유지되는지 확인
3. **Shadow 비교 자동화**: 응답 비교를 자동화하고, 불일치 리포트를 Slack/알람으로 전달하는 파이프라인 구축
4. **롤백 리허설**: 피처 플래그를 이용해 canary 50% 상태에서 킬 스위치 ON → 1분 이내 전체 롤백 성공 확인
5. **정합성 검증**: 랜덤 샘플링 + 전수 조사를 조합해 마이그레이션 정합성 99.99% 이상 달성

---

## 관련 심화 학습

- [Feature Flags 설계](/learning/deep-dive/deep-dive-feature-flags/) — 라우팅 스위치의 기반
- [Transactional Outbox & CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/) — 이중 쓰기의 안전한 구현
- [분산 트랜잭션](/learning/deep-dive/deep-dive-distributed-transactions/) — Saga/2PC와 마이그레이션의 관계
- [Online DDL & Expand-Contract](/learning/deep-dive/deep-dive-online-ddl-expand-contract/) — 스키마 마이그레이션 전략
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) — 전환 성공/롤백 기준
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — 전환 모니터링의 기반
- [Legacy Refactoring 전략](/learning/deep-dive/deep-dive-legacy-refactoring-strategy/) — 컷오버의 상위 맥락
