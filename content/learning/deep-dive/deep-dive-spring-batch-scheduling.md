---
title: "Spring Batch와 스케줄링 기초"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring Batch", "Scheduling", "Quartz", "Cron", "ShedLock"]
categories: ["Backend Deep Dive"]
description: "대량 배치 처리와 스케줄링 설계, Spring Batch/Quartz/스케줄러 기본부터 운영 안정성까지"
module: "spring-core"
study_order: 175
---

## 이 글에서 얻는 것

- 배치 작업을 "대충 스케줄러로 돌리는 코드"가 아니라, **재시작/재처리/정합성**을 가진 운영 가능한 작업으로 설계할 수 있습니다.
- Spring Batch의 핵심 개념(Job/Step/Chunk, JobRepository, restartability)을 실무 관점으로 이해합니다.
- 스케줄링에서 가장 흔한 사고(중복 실행, 실패 후 재실행, 멱등성 붕괴)를 예방할 기준이 생깁니다.
- 실제 코드(Job/Step 설정, Reader/Writer 구현, ShedLock, Quartz 클러스터, 모니터링)를 통해 운영 레벨 배치를 직접 만들 수 있습니다.

---

## 0) 배치는 "많이 처리하는 API"가 아니다

배치는 보통 다음 특성이 있습니다.

- 데이터가 크고(수십만~수천만), 실행 시간이 길 수 있음
- 실패가 "일상"이며, 실패 후 재시작/재처리가 필요
- 같은 데이터를 두 번 처리하면 큰 사고(중복 정산/중복 발송)로 이어질 수 있음

그래서 배치는 "성공/실패"만 있는 게 아니라 **어디까지 처리했는지**가 핵심입니다.

### API vs 배치: 관점 비교

| 관점 | API | 배치 |
|------|-----|------|
| 단위 | 요청 1건 | 데이터 N만 건 |
| 실패 대응 | 즉시 에러 응답 | 재시작/부분 재처리 |
| 트랜잭션 | 짧다(ms~s) | 길다(분~시간), Chunk 단위 커밋 |
| 멱등성 | 보통 자연스럽게 보장 | 의식적으로 설계해야 함 |
| 모니터링 | p99 레이턴시 | 처리량/소요시간/실패율/재시작 횟수 |

---

## 1) Spring Batch 핵심 구조(큰 그림)

```
Job
 └── Step 1  (Chunk-oriented)
 │    ├── ItemReader    ← 데이터 읽기
 │    ├── ItemProcessor ← 변환/필터
 │    └── ItemWriter    ← 저장/발송
 └── Step 2  (Tasklet)
      └── 단일 작업 (파일 정리, 알림 등)
```

- **Job**: 하나의 배치 실행 단위(예: "어제 주문 집계")
- **Step**: Job을 구성하는 단계(예: "읽기 → 처리 → 쓰기")
- **Chunk**: 일정 개수 단위로 읽고/처리하고/쓰기 + 커밋하는 단위
- **ItemReader/Processor/Writer**: 역할을 분리해 파이프라인처럼 구성
- **JobRepository**: 실행 상태를 DB에 저장(재시작/이력 관리)
- **JobLauncher**: Job을 실행하는 진입점

### 실제 Job 설정 코드 (Spring Batch 5.x / Spring Boot 3.x)

```java
@Configuration
@RequiredArgsConstructor
public class OrderSettlementJobConfig {

    private final JobRepository jobRepository;
    private final PlatformTransactionManager transactionManager;
    private final DataSource dataSource;

    @Bean
    public Job orderSettlementJob() {
        return new JobBuilder("orderSettlementJob", jobRepository)
                .start(settlementStep())
                .next(notificationStep())
                .listener(jobExecutionListener())
                .build();
    }

    @Bean
    public Step settlementStep() {
        return new StepBuilder("settlementStep", jobRepository)
                .<Order, Settlement>chunk(500, transactionManager)
                .reader(orderReader())
                .processor(settlementProcessor())
                .writer(settlementWriter())
                .faultTolerant()
                .retry(TransientDataAccessException.class)
                .retryLimit(3)
                .skip(InvalidOrderException.class)
                .skipLimit(100)
                .listener(stepListener())
                .build();
    }

    @Bean
    @StepScope
    public JdbcPagingItemReader<Order> orderReader() {
        Map<String, Order> sortKeys = new LinkedHashMap<>();
        sortKeys.put("order_id", Order.ASCENDING);

        return new JdbcPagingItemReaderBuilder<Order>()
                .name("orderReader")
                .dataSource(dataSource)
                .selectClause("SELECT order_id, user_id, amount, status, created_at")
                .fromClause("FROM orders")
                .whereClause("WHERE status = 'COMPLETED' AND settlement_date = :targetDate")
                .sortKeys(sortKeys)
                .parameterValues(Map.of(
                    "targetDate", LocalDate.now().minusDays(1)
                ))
                .rowMapper(new BeanPropertyRowMapper<>(Order.class))
                .pageSize(500)  // chunk 크기와 맞추기
                .build();
    }

    @Bean
    public ItemProcessor<Order, Settlement> settlementProcessor() {
        return order -> {
            // 이미 정산된 주문은 스킵 (멱등성 보장)
            if (order.isAlreadySettled()) {
                return null;  // null 반환 시 writer에 전달되지 않음
            }
            return Settlement.from(order);
        };
    }

    @Bean
    public JdbcBatchItemWriter<Settlement> settlementWriter() {
        return new JdbcBatchItemWriterBuilder<Settlement>()
                .dataSource(dataSource)
                .sql("""
                    INSERT INTO settlements (order_id, amount, fee, net_amount, settled_at)
                    VALUES (:orderId, :amount, :fee, :netAmount, :settledAt)
                    ON CONFLICT (order_id) DO NOTHING
                    """)
                .beanMapped()
                .build();
    }
}
```

**핵심 포인트:**
- `pageSize`와 `chunk` 크기를 맞추면 불필요한 DB 왕복을 줄임
- `ON CONFLICT DO NOTHING`으로 Writer 수준에서도 멱등성 보장
- `@StepScope`로 런타임 파라미터 바인딩 가능

---

## 2) Chunk 방식이 중요한 이유: "커밋 단위"를 통제한다

Chunk 기반 처리에서는 보통:

- N개 읽고 → N개 처리하고 → N개 쓰고 → 한 번 커밋

즉, Chunk 크기는 성능/정합성의 중요한 레버입니다.

### Chunk 크기 선택 가이드

| Chunk 크기 | 장점 | 단점 | 적합 상황 |
|-----------|------|------|----------|
| 50~100 | 실패 시 롤백 범위 작음, 메모리 부담 적음 | 커밋/IO 오버헤드 | 외부 API 호출 포함, 데이터 중요도 높음 |
| 500~1000 | 성능/오버헤드 균형 | 실패 시 재처리 비용 중간 | 일반 DB-to-DB 처리 |
| 5000+ | 최대 처리량 | 메모리 부담, 롤백 비용 큼 | 단순 마이그레이션, 실패 허용 가능 |

### 실측 벤치마크 기준 (1000만 건 기준)

```
Chunk  100 → 약 45분, GC pause 적음, 커밋 10만 회
Chunk  500 → 약 28분, 커밋 2만 회 (권장 기본값)
Chunk 5000 → 약 22분, 커밋 2천 회, 실패 시 5000건 재처리
```

**팁:** Chunk 크기 = pageSize로 맞추고, Writer가 JDBC Batch일 때 `rewriteBatchedStatements=true`(MySQL)를 쓰면 쓰기 성능이 2~5배 향상됩니다.

---

## 3) 재시작(restartability)과 JobRepository

Spring Batch는 실행 상태를 `JobRepository`에 저장해서, 실패했을 때 "어디부터 다시" 시작할 수 있게 합니다.

### JobRepository 테이블 구조

```
BATCH_JOB_INSTANCE      ← Job 정의 (이름 + 파라미터)
BATCH_JOB_EXECUTION     ← 실행 이력 (시작/종료/상태)
BATCH_JOB_EXECUTION_PARAMS  ← 실행 파라미터
BATCH_STEP_EXECUTION    ← Step 실행 상태 (read/write/skip 카운트)
BATCH_STEP_EXECUTION_CONTEXT ← 재시작 시 복원할 커서/오프셋
```

### 재시작 시나리오 (코드)

```java
// Job 파라미터로 고유성을 보장
JobParameters params = new JobParametersBuilder()
        .addLocalDate("targetDate", LocalDate.of(2025, 12, 15))
        .addLong("runId", System.currentTimeMillis()) // 동일 날짜 재실행 허용
        .toJobParameters();

try {
    jobLauncher.run(orderSettlementJob, params);
} catch (JobExecutionAlreadyRunningException e) {
    log.warn("이미 실행 중인 Job, 중복 실행 방지됨");
} catch (JobRestartException e) {
    log.error("재시작 불가(restartable=false 설정)");
}
```

### 운영 체크리스트

- [ ] JobRepository DB 별도 관리(배치 대상 DB와 분리 권장)
- [ ] `BATCH_*` 테이블 정기 정리(30~90일 보존 + 아카이브)
- [ ] 동일 파라미터 재실행 정책 결정(incrementer 사용 여부)
- [ ] DB 장애 시 JobRepository 복구 절차 문서화

---

## 4) 실패 처리: retry/skip/재처리(멱등성 포함)

배치에서 실패는 세 종류로 나눠서 생각하면 정리가 쉽습니다.

### 4-1) 실패 유형별 대응 전략

| 유형 | 예시 | 대응 | Spring Batch 설정 |
|------|------|------|------------------|
| 일시적 실패 | 네트워크 타임아웃, DB lock | Retry + Backoff | `.retry(Exception.class).retryLimit(3)` |
| 데이터 오류 | null 필드, 포맷 불일치 | Skip + 리포트 | `.skip(Exception.class).skipLimit(100)` |
| 구조적 실패 | 스키마 변경, 코드 버그 | 즉시 중단 + 수정 후 재실행 | `.noSkip(CriticalException.class)` |

### 4-2) 커스텀 Retry/Skip 리스너

```java
@Component
@Slf4j
public class SettlementSkipListener implements SkipListener<Order, Settlement> {

    private final MeterRegistry meterRegistry;
    private final SkipReportRepository skipReportRepository;

    @Override
    public void onSkipInRead(Throwable t) {
        meterRegistry.counter("batch.skip.read").increment();
        log.warn("읽기 스킵: {}", t.getMessage());
    }

    @Override
    public void onSkipInProcess(Order order, Throwable t) {
        meterRegistry.counter("batch.skip.process").increment();
        skipReportRepository.save(SkipReport.of(order.getOrderId(), "PROCESS", t));
        log.warn("처리 스킵: orderId={}, reason={}", order.getOrderId(), t.getMessage());
    }

    @Override
    public void onSkipInWrite(Settlement settlement, Throwable t) {
        meterRegistry.counter("batch.skip.write").increment();
        skipReportRepository.save(SkipReport.of(settlement.getOrderId(), "WRITE", t));
        log.warn("쓰기 스킵: orderId={}, reason={}", settlement.getOrderId(), t.getMessage());
    }
}
```

### 4-3) 멱등성 설계 패턴

```java
// 패턴 1: UPSERT(가장 단순)
INSERT INTO settlements (...) VALUES (...) ON CONFLICT (order_id) DO NOTHING;

// 패턴 2: 처리 플래그
UPDATE orders SET settlement_status = 'PROCESSING' WHERE order_id = ? AND settlement_status = 'PENDING';
// affected rows = 0 이면 이미 처리된 것 → 스킵

// 패턴 3: Outbox 테이블 기반
INSERT INTO settlement_outbox (order_id, idempotency_key, payload, status)
VALUES (?, ?, ?, 'PENDING')
ON CONFLICT (idempotency_key) DO NOTHING;
```

**패턴 선택 기준:**
- 단순 적재: UPSERT (빠르고 간단)
- 상태 전이가 중요: 처리 플래그 (선점 방식)
- 외부 시스템 연동: Outbox (비동기 발행 + 재시도)

---

## 5) 스케줄링: 단일 인스턴스라면 쉽고, 다중 인스턴스면 어려워진다

### 5-1) 간단 주기: `@Scheduled`

```java
@Configuration
@EnableScheduling
public class SchedulerConfig {

    @Scheduled(cron = "0 0 2 * * *")  // 매일 새벽 2시
    public void runDailySettlement() {
        JobParameters params = new JobParametersBuilder()
                .addLocalDate("targetDate", LocalDate.now().minusDays(1))
                .toJobParameters();
        jobLauncher.run(orderSettlementJob, params);
    }
}
```

단일 인스턴스(또는 배치 전용 서버)라면 단순하고 좋습니다.

### 5-2) ShedLock: 가장 실용적인 분산 락 솔루션

```xml
<dependency>
    <groupId>net.javacrumbs.shedlock</groupId>
    <artifactId>shedlock-spring</artifactId>
    <version>5.12.0</version>
</dependency>
<dependency>
    <groupId>net.javacrumbs.shedlock</groupId>
    <artifactId>shedlock-provider-jdbc-template</artifactId>
    <version>5.12.0</version>
</dependency>
```

```sql
-- 락 테이블 생성
CREATE TABLE shedlock (
    name       VARCHAR(64)  NOT NULL PRIMARY KEY,
    lock_until TIMESTAMP    NOT NULL,
    locked_at  TIMESTAMP    NOT NULL,
    locked_by  VARCHAR(255) NOT NULL
);
```

```java
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT30M")
public class ShedLockConfig {

    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(
                JdbcTemplateLockProvider.Configuration.builder()
                        .withJdbcTemplate(new JdbcTemplate(dataSource))
                        .usingDbTime()  // DB 시간 기준 (서버 시간 차이 방지)
                        .build()
        );
    }
}

@Component
public class ScheduledJobs {

    @Scheduled(cron = "0 0 2 * * *")
    @SchedulerLock(
        name = "dailySettlement",
        lockAtLeastFor = "PT5M",   // 최소 5분 락 유지 (빠른 완료 시에도)
        lockAtMostFor = "PT2H"     // 최대 2시간 (장애 시 자동 해제)
    )
    public void runDailySettlement() {
        // 여러 인스턴스 중 하나만 실행됨
    }
}
```

**ShedLock 운영 팁:**
- `lockAtLeastFor`: 실행이 매우 빨리 끝나도 이 시간 동안은 다른 인스턴스가 실행 못 함
- `lockAtMostFor`: 프로세스가 죽어서 언락 못 해도 이 시간 후 자동 해제
- `usingDbTime()`: 서버 시간 불일치 문제 방지

### 5-3) Quartz 클러스터 모드 (대규모)

```yaml
# application.yml
spring:
  quartz:
    job-store-type: jdbc
    jdbc:
      initialize-schema: always
    properties:
      org.quartz.scheduler.instanceId: AUTO
      org.quartz.jobStore.isClustered: true
      org.quartz.jobStore.clusterCheckinInterval: 15000
      org.quartz.jobStore.driverDelegateClass: org.quartz.impl.jdbcjobstore.PostgreSQLDelegate
      org.quartz.threadPool.threadCount: 5
```

```java
@Component
public class QuartzJobRegistrar {

    @PostConstruct
    public void registerJobs(Scheduler scheduler) throws SchedulerException {
        JobDetail job = JobBuilder.newJob(SettlementQuartzJob.class)
                .withIdentity("dailySettlement", "batch")
                .storeDurably()
                .build();

        CronTrigger trigger = TriggerBuilder.newTrigger()
                .withIdentity("dailySettlementTrigger", "batch")
                .withSchedule(CronScheduleBuilder
                        .cronSchedule("0 0 2 * * ?")
                        .withMisfireHandlingInstructionFireAndProceed())
                .build();

        scheduler.scheduleJob(job, trigger);
    }
}
```

### 5-4) 스케줄링 솔루션 비교

| 솔루션 | 복잡도 | 분산 지원 | 동적 스케줄 | 추천 상황 |
|--------|--------|----------|------------|----------|
| `@Scheduled` | ★☆☆ | ✗ | ✗ | 단일 인스턴스 |
| ShedLock + `@Scheduled` | ★★☆ | ✔ | ✗ | 다중 인스턴스, 스케줄 고정 |
| Quartz Cluster | ★★★ | ✔ | ✔ | 복잡한 스케줄/트리거 필요 |
| K8s CronJob | ★★☆ | ✔ | ✗ | 인프라가 K8s이면 가장 깔끔 |

---

## 6) Kubernetes CronJob으로 스케줄링 분리

인프라가 Kubernetes라면, 스케줄링 책임을 아예 인프라로 넘기는 게 가장 깔끔합니다.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-settlement
spec:
  schedule: "0 2 * * *"                    # 매일 02:00 UTC
  concurrencyPolicy: Forbid                # 중복 실행 방지
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 3
  startingDeadlineSeconds: 300             # 5분 내 미시작 시 스킵
  jobTemplate:
    spec:
      backoffLimit: 2                       # 실패 시 2회 재시도
      activeDeadlineSeconds: 7200           # 최대 2시간
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: settlement-batch
              image: myapp/settlement-batch:1.2.3
              command: ["java", "-jar", "app.jar", "--spring.batch.job.name=orderSettlementJob"]
              resources:
                requests:
                  memory: "1Gi"
                  cpu: "500m"
                limits:
                  memory: "2Gi"
                  cpu: "1000m"
              env:
                - name: TARGET_DATE
                  value: "yesterday"
```

**장점:** 애플리케이션 코드에서 스케줄링 로직을 완전히 분리. Pod 단위 격리로 메인 서비스에 영향 없음.

---

## 7) 모니터링: 배치는 "느려짐"을 잡아야 한다

### 7-1) Micrometer 커스텀 메트릭

```java
@Component
@RequiredArgsConstructor
public class BatchMetricsListener implements JobExecutionListener, StepExecutionListener {

    private final MeterRegistry meterRegistry;

    @Override
    public void afterJob(JobExecution jobExecution) {
        String jobName = jobExecution.getJobInstance().getJobName();
        String status = jobExecution.getStatus().toString();
        long duration = Duration.between(
            jobExecution.getStartTime(), jobExecution.getEndTime()
        ).toSeconds();

        meterRegistry.timer("batch.job.duration", "job", jobName, "status", status)
                .record(duration, TimeUnit.SECONDS);
        meterRegistry.counter("batch.job.completion", "job", jobName, "status", status)
                .increment();
    }

    @Override
    public void afterStep(StepExecution stepExecution) {
        String stepName = stepExecution.getStepName();

        meterRegistry.gauge("batch.step.read.count", 
            Tags.of("step", stepName), stepExecution.getReadCount());
        meterRegistry.gauge("batch.step.write.count",
            Tags.of("step", stepName), stepExecution.getWriteCount());
        meterRegistry.gauge("batch.step.skip.count",
            Tags.of("step", stepName), stepExecution.getSkipCount());
        
        // 처리 속도 (items/sec)
        long seconds = Duration.between(
            stepExecution.getStartTime(), stepExecution.getEndTime()
        ).toSeconds();
        if (seconds > 0) {
            double throughput = (double) stepExecution.getWriteCount() / seconds;
            meterRegistry.gauge("batch.step.throughput",
                Tags.of("step", stepName), throughput);
        }
    }
}
```

### 7-2) 핵심 PromQL 알람 쿼리

```promql
# 배치 실행 시간이 SLA(1시간) 초과
batch_job_duration_seconds{status="COMPLETED"} > 3600

# 최근 24시간 내 배치 실패 발생
increase(batch_job_completion_total{status="FAILED"}[24h]) > 0

# Skip 비율이 전체 처리량의 1% 초과 (데이터 품질 이상)
batch_step_skip_count / batch_step_read_count > 0.01

# 처리 속도가 평소 대비 50% 이하로 떨어짐
batch_step_throughput < (avg_over_time(batch_step_throughput[7d]) * 0.5)
```

### 7-3) Grafana 대시보드 구성 (권장 패널)

| 패널 | 지표 | 목적 |
|------|------|------|
| Job 실행 현황 | completion_total (status별) | 성공/실패 추이 |
| 실행 시간 추이 | duration_seconds (7일) | 느려짐 조기 감지 |
| 처리량 | throughput (items/sec) | 성능 저하 탐지 |
| Skip/에러 비율 | skip_count / read_count | 데이터 품질 모니터링 |
| 재시작 횟수 | BATCH_JOB_EXECUTION 쿼리 | 안정성 추적 |

---

## 8) 대용량 배치 성능 최적화

### 8-1) Reader 최적화

```java
// ❌ N+1 문제가 발생하는 JPA Reader
@Bean
public JpaPagingItemReader<Order> badReader() {
    // 연관 엔티티를 건건 로딩 → N+1
}

// ✅ JDBC Cursor Reader (대용량에 유리)
@Bean
public JdbcCursorItemReader<Order> cursorReader() {
    return new JdbcCursorItemReaderBuilder<Order>()
            .name("cursorOrderReader")
            .dataSource(dataSource)
            .sql("""
                SELECT o.order_id, o.user_id, o.amount, o.status
                FROM orders o
                WHERE o.status = 'COMPLETED' AND o.settlement_date = ?
                ORDER BY o.order_id
                """)
            .preparedStatementSetter(ps -> 
                ps.setDate(1, Date.valueOf(LocalDate.now().minusDays(1))))
            .rowMapper(new BeanPropertyRowMapper<>(Order.class))
            .fetchSize(1000)  // DB cursor fetch size
            .build();
}
```

### 8-2) Writer 최적화

```java
// MySQL: rewriteBatchedStatements=true 로 네트워크 왕복 최소화
spring.datasource.url=jdbc:mysql://localhost:3306/batch?rewriteBatchedStatements=true

// PostgreSQL: COPY 명령으로 대량 적재 (10x+ 빠름)
@Bean
public ItemWriter<Settlement> copyWriter() {
    return items -> {
        try (Connection conn = dataSource.getConnection()) {
            CopyManager cm = conn.unwrap(PgConnection.class).getCopyAPI();
            StringBuilder csv = new StringBuilder();
            for (Settlement s : items) {
                csv.append(String.format("%d\t%s\t%s\t%s\n",
                    s.getOrderId(), s.getAmount(), s.getFee(), s.getSettledAt()));
            }
            cm.copyIn("COPY settlements FROM STDIN", 
                new StringReader(csv.toString()));
        }
    };
}
```

### 8-3) 파티셔닝(병렬 Step 실행)

```java
@Bean
public Step partitionedSettlementStep() {
    return new StepBuilder("partitionedStep", jobRepository)
            .partitioner("settlementStep", dateRangePartitioner())
            .step(settlementStep())
            .gridSize(4)  // 4개 파티션 병렬 실행
            .taskExecutor(batchTaskExecutor())
            .build();
}

@Bean
public Partitioner dateRangePartitioner() {
    return gridSize -> {
        Map<String, ExecutionContext> result = new HashMap<>();
        LocalDate start = LocalDate.now().minusDays(7);
        for (int i = 0; i < gridSize; i++) {
            ExecutionContext ctx = new ExecutionContext();
            ctx.putString("startDate", start.plusDays(i * 2).toString());
            ctx.putString("endDate", start.plusDays((i + 1) * 2 - 1).toString());
            result.put("partition" + i, ctx);
        }
        return result;
    };
}

@Bean
public TaskExecutor batchTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(0);
    executor.setThreadNamePrefix("batch-part-");
    return executor;
}
```

---

## 9) 안티패턴과 트러블슈팅

### 9-1) 흔한 안티패턴 6가지

| 안티패턴 | 문제 | 해결 |
|---------|------|------|
| Chunk 크기 1 | 커밋 오버헤드 극대화 | 최소 100 이상 |
| JPA Reader에서 지연 로딩 | N+1, 영속성 컨텍스트 누수 | JDBC Reader 사용 |
| 글로벌 트랜잭션 | 전체 실패 시 롤백 범위 거대 | Chunk 단위 트랜잭션 |
| 재시작 미고려 | 실패 후 처음부터 재실행 | ExecutionContext에 커서 저장 |
| 멱등성 무시 | 중복 실행 시 데이터 오염 | UPSERT/처리 플래그 |
| 모니터링 없음 | 느려져도 모르고 지남 | Micrometer + 알람 |

### 9-2) 트러블슈팅 가이드

```
문제: "Job이 FAILED인데 재시작이 안 된다"
→ 원인: 동일 JobParameters로 재실행 시 "이미 완료된 Job"으로 판단
→ 해결: JobParametersIncrementer 사용 또는 runId 파라미터 추가

문제: "Step이 느려졌는데 어디가 병목인지 모르겠다"
→ 진단 순서:
  1) BATCH_STEP_EXECUTION의 read/process/write 시간 비교
  2) DB slow query log 확인
  3) GC 로그 확인 (Chunk 크기가 크면 Old Gen 압박)
  4) 네트워크(외부 API 호출) 지연 확인

문제: "여러 인스턴스에서 같은 배치가 동시에 실행됐다"
→ 진단: ShedLock 테이블의 locked_at/lock_until 확인
→ 해결: usingDbTime() 사용 + lockAtLeastFor 설정 확인
```

---

## 10) 운영 부트스트랩 체크리스트

### Day 1 (배치 첫 도입)
- [ ] Job/Step/Chunk 기본 구조 설정
- [ ] JobRepository DB 분리 여부 결정
- [ ] 멱등성 보장 패턴 선택(UPSERT/플래그/Outbox)
- [ ] 기본 모니터링(실행 시간, 성공/실패 카운트) 연동

### Week 1 (안정화)
- [ ] ShedLock 또는 분산 락 적용(다중 인스턴스 환경)
- [ ] Skip/Retry 정책 설정 + 리스너로 리포팅
- [ ] Chunk 크기 벤치마크(100/500/1000) 후 최적값 결정
- [ ] 실패 알람 설정(Slack/PagerDuty)

### Month 1 (운영 성숙)
- [ ] BATCH_* 테이블 정리 정책(TTL/아카이브)
- [ ] Grafana 대시보드 구성(처리량/소요시간/Skip 추이)
- [ ] 파티셔닝/병렬 실행 성능 테스트
- [ ] 재시작 시나리오 정기 검증(장애 복구 훈련)

---

## 연습(추천)

- Chunk 크기를 100/500/5000으로 바꿔보며 처리 시간/DB 부하가 어떻게 변하는지 관찰해보기
- 일부 데이터만 실패하도록 만들고 skip/retry를 적용해 "전체 실패 없이" 처리하는 흐름을 만들어보기
- 동일 배치를 2개 인스턴스에서 동시에 실행했을 때 중복 실행이 나는지 확인하고, ShedLock으로 막아보기
- Micrometer 메트릭을 붙이고 Grafana에서 배치 처리량/실행 시간/Skip 비율을 시각화해보기

---

## 관련 심화 학습

- [배치 멱등성 & 재처리](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/) — 실패 시 안전한 재실행
- [분산 락](/learning/deep-dive/deep-dive-distributed-lock/) — 다중 인스턴스 배치 중복 실행 방지
- [설정 관리 전략](/learning/deep-dive/deep-dive-config-management/) — 환경별 배치 설정 분리
- [Spring Profiles & Config](/learning/deep-dive/deep-dive-spring-profiles-config/) — 프로파일 기반 배치 동작 분기
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — 배치 모니터링 인프라 기초
- [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/) — 외부 호출 포함 배치의 복원력
