---
title: "타임존·국제화 처리 베스트 프랙티스"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Timezone", "I18n", "Locale", "DateTime"]
categories: ["Backend Deep Dive"]
description: "UTC 저장/표시 변환, Locale별 메시지/포맷, 스케줄·마감 처리 시 주의점"
module: "architecture"
study_order: 495
---

## 이 글에서 얻는 것

- "시간"을 Instant(절대 시각)과 LocalDateTime(지역 시각)로 구분해, UTC 저장/표시 변환을 안전하게 설계할 수 있습니다.
- DST(서머타임) 때문에 생기는 대표 함정(존재하지 않는 시각, 두 번 존재하는 시각)을 이해하고 스케줄/마감 처리에서 사고를 줄일 수 있습니다.
- Locale/i18n(메시지/포맷/통화)을 백엔드 계약 관점에서 정리하고, API에서 무엇을 고정해야 하는지 기준이 생깁니다.

## 0) 시간 문제는 대부분 "정의가 섞여서" 생긴다

백엔드에서 다루는 시간은 크게 3종류입니다.

| 종류 | 의미 | Java 타입 | 예시 |
|------|------|-----------|------|
| **Instant(절대 시각)** | 지구상 한 점에서의 실제 순간 | `Instant`, `OffsetDateTime` | `2025-03-15T03:00:00Z` |
| **Local date/time(지역 시각)** | 그 지역 달력 기준 시각 | `LocalDateTime`, `ZonedDateTime` | `2025-03-15 12:00 Asia/Seoul` |
| **Duration/Period** | 기간 | `Duration`(절대), `Period`(달력) | 1시간 / 1개월 |

이걸 섞으면 사고가 납니다. 가장 흔한 실수:

```java
// ❌ 위험: LocalDateTime은 타임존 정보가 없다
LocalDateTime now = LocalDateTime.now(); // 서버 타임존에 암묵적 의존
entity.setCreatedAt(now);

// ✅ 안전: Instant로 절대 시각을 저장
Instant now = Instant.now();
entity.setCreatedAt(now);
```

### 타입 선택 의사결정 트리

```
"이 값은 전 세계 어디서든 같은 순간을 가리키나?"
├─ Yes → Instant / OffsetDateTime
│         (이벤트 발생 시각, 결제 시각, 로그 타임스탬프)
└─ No  → "사용자의 '달력 위 날짜/시간'이 중요한가?"
         ├─ Yes → ZonedDateTime / LocalDateTime + ZoneId
         │         (생일, 예약 시각, "매일 9시 알림")
         └─ No  → LocalDate / LocalTime
                   (공휴일, 영업시간)
```

## 1) 원칙: 저장/전송은 UTC, 표시는 사용자 타임존

실무에서 가장 안전한 기본값:

| 계층 | 규칙 | 이유 |
|------|------|------|
| DB 저장 | UTC 기반 (`TIMESTAMP WITH TIME ZONE`) | 타임존 변환 없이 비교/정렬 가능 |
| API 전송 | ISO8601 + offset (`2025-03-15T12:00:00+09:00`) | 파싱 표준, 모호함 제거 |
| UI 표시 | 사용자 타임존/로케일 변환 | 사용자 경험 |
| 서버/JVM | `TimeZone.setDefault(UTC)` | 암묵적 변환 사고 방지 |

### Spring Boot에서 UTC 강제하기

```java
// Application.java — JVM 타임존 고정
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        SpringApplication.run(Application.class, args);
    }
}
```

```yaml
# application.yml — Jackson 직렬화 설정
spring:
  jackson:
    time-zone: UTC
    date-format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
    serialization:
      write-dates-as-timestamps: false
```

### PostgreSQL 설정

```sql
-- DB 세션 타임존 확인/고정
SHOW timezone;  -- 'UTC'여야 안전
SET timezone = 'UTC';

-- 테이블 설계: TIMESTAMPTZ 사용
CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- UTC 저장
    user_tz     TEXT NOT NULL DEFAULT 'Asia/Seoul'    -- 표시용 타임존 별도 저장
);

-- 조회 시 사용자 타임존 변환
SELECT created_at AT TIME ZONE user_tz AS local_created_at
FROM orders WHERE id = 1;
```

### JPA 엔티티 매핑

```java
@Entity
public class Order {
    @Column(columnDefinition = "TIMESTAMPTZ")
    private Instant createdAt;  // ✅ Instant 사용

    @Column
    private String userTimezone; // "Asia/Seoul"

    // 표시용 변환 메서드
    public ZonedDateTime getLocalCreatedAt() {
        return createdAt.atZone(ZoneId.of(userTimezone));
    }
}
```

## 2) DST(서머타임)가 터지는 지점

DST가 있는 지역에서는 "지역 시각"이 다음을 겪습니다.

### 존재하지 않는 시각 (Gap)

```java
// 미국 동부: 2025-03-09 02:00 → 03:00 (Spring Forward)
ZoneId eastern = ZoneId.of("America/New_York");

// 02:30은 존재하지 않는다
LocalDateTime gapTime = LocalDateTime.of(2025, 3, 9, 2, 30);
ZonedDateTime resolved = gapTime.atZone(eastern);
// → 2025-03-09T03:30-04:00 (자동으로 03:30으로 밀림)

System.out.println(resolved); // 의도와 다를 수 있음!
```

### 두 번 존재하는 시각 (Overlap)

```java
// 미국 동부: 2025-11-02 02:00 → 01:00 (Fall Back)
LocalDateTime overlapTime = LocalDateTime.of(2025, 11, 2, 1, 30);

// 어느 01:30인지 명시해야 한다
ZonedDateTime earlier = overlapTime.atZone(eastern)
    .withEarlierOffsetAtOverlap();  // EDT (-04:00)
ZonedDateTime later = overlapTime.atZone(eastern)
    .withLaterOffsetAtOverlap();    // EST (-05:00)

// 두 값의 Instant는 1시간 차이!
Duration gap = Duration.between(earlier.toInstant(), later.toInstant());
// → PT1H
```

### 스케줄에서 DST 처리 전략

그래서 스케줄/마감은 아래 중 하나로 "정의"를 고정해야 합니다.

| 전략 | 정의 | DST 영향 | 적합한 경우 |
|------|------|----------|------------|
| **절대 시각(UTC) 기준** | "UTC 00:00에 실행" | 없음 | 배치 작업, 데이터 집계 |
| **지역 달력 기준** | "매일 9시에 알림" | UTC 시각이 변함 | 사용자 대상 알림, 영업시간 |

```java
// Spring @Scheduled에서 타임존 명시
@Scheduled(cron = "0 0 9 * * *", zone = "Asia/Seoul")
public void morningNotification() {
    // 서울 기준 매일 9시 — DST 없는 지역이라 안전
    // 미국 대상이면 zone="America/New_York"으로 DST 자동 처리
}
```

## 3) 마감/기간 계산의 함정

- "오늘 자정까지"는 사용자 타임존에 따라 다릅니다.
- "1일 뒤"는 24시간 뒤가 아닐 수 있습니다(DST로 23/25시간이 될 수 있음).

```java
// ❌ 위험: 항상 24시간을 더한다
Instant tomorrow = Instant.now().plus(Duration.ofHours(24));

// ✅ 안전: 달력 기준 "내일 같은 시각"
ZonedDateTime now = ZonedDateTime.now(ZoneId.of("America/New_York"));
ZonedDateTime tomorrowLocal = now.plusDays(1); // DST 고려됨
// DST 전환일에는 23시간 또는 25시간 뒤가 될 수 있음
```

### "오늘" 범위 조회 API 구현

```java
@GetMapping("/orders/today")
public List<Order> getTodayOrders(
        @RequestHeader("X-User-Timezone") String timezone) {

    ZoneId zone = ZoneId.of(timezone); // "Asia/Seoul"
    ZonedDateTime startOfDay = LocalDate.now(zone)
            .atStartOfDay(zone);
    ZonedDateTime endOfDay = startOfDay.plusDays(1);

    // UTC Instant로 변환하여 DB 조회
    return orderRepository.findByCreatedAtBetween(
            startOfDay.toInstant(),
            endOfDay.toInstant()
    );
}
```

기간을 정의할 때:

| 단위 | 타입 | 특성 |
|------|------|------|
| 초/분/시간 | `Duration` (절대 시간) | 항상 동일한 물리적 시간 |
| 일/월/년 | `Period` (달력) | DST/윤년에 따라 물리적 시간이 다름 |

## 4) 국제화(i18n): API는 '표준 포맷'을 유지하라

백엔드의 역할:

- 저장/전송은 표준(ISO8601, 숫자는 raw value)
- 표시 포맷은 UI/클라이언트에 맡긴다

### Spring MessageSource 기반 i18n 구성

```java
// MessageConfig.java
@Configuration
public class MessageConfig {
    @Bean
    public MessageSource messageSource() {
        ReloadableResourceBundleMessageSource source =
            new ReloadableResourceBundleMessageSource();
        source.setBasename("classpath:messages");
        source.setDefaultEncoding("UTF-8");
        source.setCacheSeconds(3600);
        return source;
    }

    @Bean
    public LocaleResolver localeResolver() {
        AcceptHeaderLocaleResolver resolver =
            new AcceptHeaderLocaleResolver();
        resolver.setDefaultLocale(Locale.KOREAN);
        resolver.setSupportedLocales(
            List.of(Locale.KOREAN, Locale.ENGLISH, Locale.JAPANESE));
        return resolver;
    }
}
```

```properties
# messages_ko.properties
order.confirmation=주문이 완료되었습니다. 주문번호: {0}
order.amount=결제 금액: {0,number,currency}

# messages_en.properties
order.confirmation=Order confirmed. Order number: {0}
order.amount=Payment amount: {0,number,currency}
```

### 통화/숫자 포맷 처리

```java
// API 응답: raw value + currency code
@JsonProperty("amount")
private BigDecimal amount;        // 15000.00

@JsonProperty("currency")
private String currency;          // "KRW"

// 서버 사이드 렌더링이 필요한 경우 (이메일/푸시)
public String formatAmount(Locale locale) {
    NumberFormat formatter = NumberFormat.getCurrencyInstance(locale);
    formatter.setCurrency(Currency.getInstance(currency));
    return formatter.format(amount);
    // ko: ₩15,000  /  en-US: ₩15,000.00
}
```

### API 설계 원칙 정리

| 항목 | API 전송 | 서버 렌더링(이메일/푸시) |
|------|----------|----------------------|
| 날짜/시간 | ISO8601 + offset | Locale별 DateTimeFormatter |
| 금액 | raw + currency code | NumberFormat.getCurrencyInstance |
| 메시지 | message key or raw | MessageSource + Locale |
| 정렬 | 원본 데이터 | Collator(언어별 정렬 규칙) |

## 5) 운영/테스트: 시간은 반드시 시뮬레이션한다

시간 관련 버그는 재현이 어렵습니다. 그래서 테스트 전략이 중요합니다.

### Clock 주입 패턴

```java
// 서비스에서 Clock 주입
@Service
public class OrderService {
    private final Clock clock;

    public OrderService(Clock clock) {
        this.clock = clock;
    }

    public Order createOrder(OrderRequest request) {
        Order order = new Order();
        order.setCreatedAt(Instant.now(clock));  // 테스트에서 시간 고정 가능
        return orderRepository.save(order);
    }
}

// 프로덕션 설정
@Bean
public Clock clock() {
    return Clock.systemUTC();
}
```

```java
// 테스트에서 시간 고정
@Test
void 주문_생성시_DST_전환일에도_UTC_저장() {
    // DST 전환 시점을 고정
    Clock fixed = Clock.fixed(
        ZonedDateTime.of(2025, 3, 9, 2, 30, 0, 0,
            ZoneId.of("America/New_York"))
            .toInstant(),
        ZoneId.of("UTC")
    );

    OrderService service = new OrderService(fixed);
    Order order = service.createOrder(new OrderRequest());

    // UTC로 정확히 저장되었는지 검증
    assertThat(order.getCreatedAt())
        .isEqualTo(Instant.parse("2025-03-09T07:30:00Z"));
}
```

### DST 테스트 체크리스트

- [ ] Gap 시각(존재하지 않는 시각)에 예약/마감 생성 → 정상 처리되는가?
- [ ] Overlap 시각(두 번 존재)에 로그/이벤트 정렬 → 순서가 올바른가?
- [ ] 타임존이 다른 두 사용자의 "오늘" 범위 조회 → 각각 정확한가?
- [ ] "1일 뒤" 계산이 DST 전환일에 23시간/25시간이 되는 케이스
- [ ] 서버 재시작 후에도 타임존 설정이 UTC로 유지되는가?
- [ ] DB 마이그레이션 시 기존 TIMESTAMP → TIMESTAMPTZ 변환 데이터 정합성

### 자주 발생하는 버그 패턴과 해결

| 버그 | 원인 | 해결 |
|------|------|------|
| 자정 넘기면 데이터 누락 | UTC/로컬 혼용 조회 | 사용자 TZ 기준 범위 → UTC 변환 조회 |
| 배치가 1시간 밀림/당겨짐 | DST 전환 + cron UTC 고정 | `zone` 파라미터 명시 |
| 날짜 비교 off-by-one | `LocalDate`에서 TZ 없이 비교 | `ZonedDateTime` 기준 날짜 추출 |
| API 응답 시간이 이상함 | Jackson 기본 TZ가 서버 로컬 | `spring.jackson.time-zone=UTC` |
| 테스트가 CI에서만 실패 | CI 서버 TZ ≠ 개발자 로컬 | `Clock` 주입 + TZ 고정 |

## 연습(추천)

- "매일 9시 알림"을 설계해보기: 저장은 어떤 값으로 할지(UTC? local time + zone?)와 DST 때 동작을 정의해보기
- "오늘 00:00~23:59" 조회 API를 사용자 타임존 기준으로 구현하고, 서버/DB는 UTC인 상태에서 올바르게 동작하는지 테스트해보기
- DST 전환일(해당 지역)을 골라, 존재하지 않는 시각/두 번 존재하는 시각을 처리하는 테스트를 작성해보기
- Spring MessageSource로 한국어/영어/일본어 이메일 템플릿을 만들고, 통화 포맷이 Locale별로 다르게 렌더링되는지 확인해보기

---

## 관련 심화 학습

- [Spring Validation 심화](/learning/deep-dive/deep-dive-spring-validation/) — 입력 검증에서 날짜/시간 포맷 처리
- [Spring Batch & 스케줄링](/learning/deep-dive/deep-dive-spring-batch-scheduling/) — DST가 배치 스케줄에 미치는 영향
- [테스팅 전략](/learning/deep-dive/deep-dive-testing-strategy/) — 시간 의존 코드의 테스트 설계
- [설정 관리 전략](/learning/deep-dive/deep-dive-config-management/) — 환경별 타임존 설정 분리
- [REST API 설계](/learning/deep-dive/deep-dive-rest-api-design/) — API 응답 포맷 표준화
