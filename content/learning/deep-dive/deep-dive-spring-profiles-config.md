---
title: "Spring 프로필과 설정 분리 전략"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Profile", "Configuration", "YAML", "ConfigurationProperties", "Vault"]
categories: ["Backend Deep Dive"]
description: "dev/stage/prod 설정 분리, @ConfigurationProperties, Secret 관리, Kubernetes 환경변수 주입, Vault 연동, 설정 디버깅까지 실무 중심 정리"
module: "spring-core"
study_order: 195
---

## 이 글에서 얻는 것

- dev/stage/prod 설정을 "파일 나누기" 수준이 아니라, **운영 사고를 막는 구조**로 설계할 수 있습니다.
- Spring의 프로퍼티 우선순위/프로필 활성화 흐름을 이해해서 "왜 이 값이 적용됐지?"를 디버깅할 수 있습니다.
- `@ConfigurationProperties`로 타입 세이프 설정을 만들고, 검증/시크릿 분리까지 포함해 안전하게 운영할 수 있습니다.
- Kubernetes ConfigMap/Secret, Vault, AWS Secrets Manager 등 실무 시크릿 주입 패턴을 코드로 익힐 수 있습니다.

---

## 0) 설정 분리는 운영 안정성의 기본기

설정이 섞이면 운영에서 이런 사고가 자주 납니다.

- 로컬 DB 설정이 운영에 적용됨
- 테스트용 외부 API 키가 운영에 적용됨
- 운영에서 디버그/문서 UI가 켜짐

그래서 "코드는 같아도, 환경은 다르다"를 전제로 구조를 잡아야 합니다. 12-Factor App의 제3원칙("설정을 환경에 저장하라")이 바로 이 원리입니다.

---

## 1) 프로필 분리: 멀티 도큐먼트 YAML vs 파일 분리

### 멀티 도큐먼트 방식 (한 파일)

```yaml
# application.yml — 공통 설정
spring:
  application:
    name: order-service
server:
  shutdown: graceful

---
# dev 프로필
spring:
  config:
    activate:
      on-profile: dev
  datasource:
    url: jdbc:mysql://localhost:3306/orders
    username: dev_user
    password: dev_pass
  jpa:
    show-sql: true
    hibernate:
      ddl-auto: create-drop
logging:
  level:
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql: TRACE

---
# prod 프로필
spring:
  config:
    activate:
      on-profile: prod
  datasource:
    url: jdbc:mysql://prod-db.internal:3306/orders
    username: ${DB_USERNAME}          # 환경변수로 주입
    password: ${DB_PASSWORD}          # 환경변수로 주입
  jpa:
    show-sql: false
    hibernate:
      ddl-auto: validate              # 운영에서 DDL 자동 변경 금지
    properties:
      hibernate:
        generate_statistics: false
logging:
  level:
    root: WARN
    com.example: INFO
```

**장점**: 프로필 간 차이를 한눈에 비교할 수 있음.
**단점**: 파일이 길어지면 관리가 어려움.

### 파일 분리 방식

```
src/main/resources/
├── application.yml              # 공통
├── application-dev.yml          # dev 전용
├── application-stage.yml        # staging 전용
├── application-prod.yml         # prod 전용
└── application-test.yml         # 테스트 전용
```

**장점**: 파일별 책임이 명확, PR 리뷰 시 어떤 환경이 바뀌는지 바로 보임.
**단점**: 공통 설정과 프로필 설정 간 값 추적이 필요.

> **실무 추천**: 설정이 30줄 이하면 멀티 도큐먼트, 그 이상이면 파일 분리가 관리에 유리합니다.

---

## 2) 프로퍼티 우선순위: "왜 이 값이 먹지?"의 핵심

스프링 부트는 여러 소스에서 설정을 읽고, **높은 번호가 낮은 번호를 덮어씁니다**.

| 우선순위 | 소스 | 실무 용도 |
|---------|------|----------|
| 1 (최저) | `application.yml` (classpath) | 기본 설정 |
| 2 | `application-{profile}.yml` | 환경별 설정 |
| 3 | `SPRING_APPLICATION_JSON` 환경변수 | JSON 형태 일괄 주입 |
| 4 | OS 환경변수 (`SPRING_DATASOURCE_URL`) | CI/CD 파이프라인, K8s |
| 5 | Java System Properties (`-Dspring.datasource.url`) | JVM 기동 인자 |
| 6 (최고) | Command-line Arguments (`--spring.datasource.url=...`) | 테스트/디버깅 |

**핵심 감각**: 운영에서는 보통 **환경변수(4)가 YAML(1-2)보다 우선**하도록 설계합니다. YAML에는 "합리적 기본값"을 넣고, 운영 민감 값은 환경변수/Secret으로 덮어쓰는 패턴입니다.

### Relaxed Binding 규칙

Spring Boot는 설정 키를 유연하게 매칭합니다:

```
# 이 4개는 전부 같은 프로퍼티
app.datasource-url          # kebab-case (추천)
app.datasourceUrl            # camelCase
app.datasource_url           # underscore
APP_DATASOURCE_URL           # 환경변수 (UPPER_SNAKE_CASE)
```

> 환경변수에서는 `.`을 `_`로, `-`도 `_`로 변환합니다. 이걸 모르면 "환경변수를 넣었는데 안 먹힌다"는 버그를 만납니다.

---

## 3) 프로필 활성화: 명시적으로 켜자

### 활성화 방법 비교

```bash
# 1. 환경변수 (가장 추천 — 코드 변경 없이 환경마다 다름)
export SPRING_PROFILES_ACTIVE=prod

# 2. JVM 인자
java -jar app.jar -Dspring.profiles.active=prod

# 3. 커맨드라인 인자
java -jar app.jar --spring.profiles.active=prod

# 4. application.yml 기본값 (위험 — 실수로 prod가 켜질 수 있음)
spring:
  profiles:
    active: dev   # 로컬 전용 기본값으로만 사용
```

### 프로필 그룹 (Spring Boot 2.4+)

여러 프로필을 논리적으로 묶을 수 있습니다:

```yaml
spring:
  profiles:
    group:
      prod:
        - prod-db
        - prod-cache
        - prod-monitoring
      dev:
        - dev-db
        - dev-tools
```

`SPRING_PROFILES_ACTIVE=prod` 하나면 `prod-db`, `prod-cache`, `prod-monitoring`이 함께 활성화됩니다.

### 다중 프로필 활성화 주의

```bash
SPRING_PROFILES_ACTIVE=prod,debug
```

이 경우 **뒤에 오는 프로필(debug)이 앞의 프로필(prod)을 덮어씁니다**. 운영에서 실수로 `debug`가 함께 켜지면 로그 레벨이 낮아지거나 민감 정보가 노출될 수 있습니다.

**안전 장치**: 운영 애플리케이션 시작 시 활성 프로필을 검증하는 리스너를 넣는 것이 좋습니다:

```java
@Component
public class ProfileGuard implements ApplicationListener<ApplicationReadyEvent> {

    @Value("${spring.profiles.active:}")
    private String activeProfiles;

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (activeProfiles.contains("prod") && activeProfiles.contains("dev")) {
            throw new IllegalStateException(
                "prod와 dev 프로필이 동시에 활성화됨 — 설정 충돌 위험");
        }
    }
}
```

---

## 4) `@ConfigurationProperties`: 설정을 타입으로 만들기

### 기본 구조

```java
@Validated
@ConfigurationProperties(prefix = "app.order")
public record OrderProperties(
    @NotBlank String serviceUrl,
    @Min(1) @Max(100) int maxRetry,
    @DurationUnit(ChronoUnit.SECONDS) Duration timeout,
    NotificationProperties notification
) {
    public record NotificationProperties(
        boolean enabled,
        @Email String recipient,
        @DurationUnit(ChronoUnit.MINUTES) Duration cooldown
    ) {}
}
```

```yaml
app:
  order:
    service-url: https://order-api.internal
    max-retry: 3
    timeout: 5s
    notification:
      enabled: true
      recipient: ops@example.com
      cooldown: 10m
```

### 활성화 방법

```java
@Configuration
@EnableConfigurationProperties(OrderProperties.class)
public class OrderConfig {

    @Bean
    public OrderClient orderClient(OrderProperties props) {
        return new OrderClient(
            props.serviceUrl(),
            props.maxRetry(),
            props.timeout()
        );
    }
}
```

### 검증: 잘못된 설정은 시작 시점에 실패시키기

`@Validated`를 붙이면 Bean Validation이 적용됩니다:

```java
// timeout이 누락되거나 maxRetry가 0이면
// 애플리케이션 시작 단계에서 BindValidationException 발생
// → 운영에서 "알 수 없는 런타임 오류"가 아닌 "시작 실패"로 빠르게 감지
```

실행 시 에러 메시지 예시:
```
***************************
APPLICATION FAILED TO START
***************************
Binding to target OrderProperties failed:

  Property: app.order.max-retry
  Value:    "0"
  Reason:   최솟값 1 이상이어야 합니다
```

### `@ConfigurationProperties` vs `@Value` 비교

| 기준 | `@ConfigurationProperties` | `@Value` |
|------|---------------------------|----------|
| 타입 안전 | ✅ 컴파일 타임 | ❌ 런타임 캐스팅 |
| 계층 구조 | ✅ 중첩 객체 자연스러움 | ❌ 플랫한 키만 |
| 검증 | ✅ `@Validated` | ⚠️ SpEL 기본값 정도 |
| IDE 지원 | ✅ 메타데이터 자동생성 | ❌ 문자열 키 |
| 적합 용도 | 설정 그룹 (DB, 캐시, API) | 단일 값 주입 (`${app.name}`) |

> **실무 규칙**: 3개 이상의 관련 설정은 `@ConfigurationProperties`로 묶고, 단일 값은 `@Value`를 써도 괜찮습니다.

---

## 5) 프로필 기반 빈 분기: `@Profile` & `@ConditionalOnProperty`

### `@Profile`로 환경별 빈 등록

```java
@Configuration
public class CacheConfig {

    @Bean
    @Profile("dev")
    public CacheManager devCache() {
        // 로컬에서는 간단한 ConcurrentMap 캐시
        return new ConcurrentMapCacheManager("orders", "products");
    }

    @Bean
    @Profile("prod")
    public CacheManager prodCache(RedisConnectionFactory factory) {
        // 운영에서는 Redis 캐시
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .serializeValuesWith(
                SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer()));

        return RedisCacheManager.builder(factory)
            .cacheDefaults(config)
            .build();
    }
}
```

### `@ConditionalOnProperty`로 기능 토글

프로필 대신 **프로퍼티 값**으로 빈을 켜고 끌 수 있습니다:

```java
@Bean
@ConditionalOnProperty(
    name = "app.notification.enabled",
    havingValue = "true",
    matchIfMissing = false    // 설정 없으면 비활성
)
public NotificationService notificationService(OrderProperties props) {
    return new SlackNotificationService(props.notification());
}
```

```yaml
# dev — 알림 꺼둠
app:
  notification:
    enabled: false

# prod — 알림 켬
app:
  notification:
    enabled: true
    recipient: ops@example.com
```

> **주의**: `@Profile`과 `@ConditionalOnProperty`를 동시에 쓰면 조건이 복잡해져서 빈이 "왜 안 뜨지?" 디버깅이 어려워집니다. 하나만 선택하세요.

---

## 6) Secret 관리: 설정과 비밀을 분리하자

### 비밀의 종류와 관리 수준

| 비밀 종류 | 예시 | 최소 관리 수준 |
|----------|------|---------------|
| DB 패스워드 | `spring.datasource.password` | 환경변수 또는 Secret Manager |
| API 키 | 외부 서비스 토큰 | Secret Manager + 회전(rotation) |
| TLS 인증서 | mTLS 클라이언트 인증서 | Vault / cert-manager |
| 암호화 키 | AES/RSA 마스터 키 | HSM / KMS |

### Kubernetes Secret 주입 (가장 흔한 패턴)

```yaml
# k8s Secret
apiVersion: v1
kind: Secret
metadata:
  name: order-db-secret
type: Opaque
data:
  DB_USERNAME: b3JkZXJfdXNlcg==    # base64("order_user")
  DB_PASSWORD: cHIwZFBAc3M=        # base64("pr0dP@ss")
---
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
        - name: order-service
          image: order-service:latest
          envFrom:
            - secretRef:
                name: order-db-secret
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: "prod"
```

Spring Boot는 환경변수 `DB_USERNAME`, `DB_PASSWORD`를 자동으로 `${DB_USERNAME}`, `${DB_PASSWORD}`로 바인딩합니다.

### HashiCorp Vault 연동 (Spring Cloud Vault)

```yaml
# bootstrap.yml
spring:
  cloud:
    vault:
      uri: https://vault.internal:8200
      authentication: KUBERNETES    # K8s Service Account 인증
      kubernetes:
        role: order-service
        service-account-token-file: /var/run/secrets/kubernetes.io/serviceaccount/token
      kv:
        enabled: true
        backend: secret
        default-context: order-service
```

```java
// Vault에 저장된 secret/order-service 경로의 값이 자동 주입
@Value("${db.password}")
private String dbPassword;
```

**Vault 장점**: 비밀 회전(rotation)을 자동화할 수 있고, 감사 로그(audit log)가 남습니다.

### AWS Secrets Manager 연동

```yaml
# application-prod.yml
spring:
  config:
    import: "aws-secretsmanager:order-service/prod"
```

```java
// AWS Secrets Manager의 order-service/prod 시크릿 키가
// 프로퍼티로 자동 매핑됨
@ConfigurationProperties(prefix = "db")
public record DbProperties(String username, String password, String url) {}
```

---

## 7) 설정 디버깅: "왜 이 값이 적용됐지?" 추적법

### Actuator `env` 엔드포인트

```bash
# 현재 적용된 모든 프로퍼티 소스와 값 확인
curl localhost:8080/actuator/env | jq '.propertySources[] | .name'
```

출력 예시:
```json
"systemEnvironment"
"applicationConfig: [classpath:/application-prod.yml]"
"applicationConfig: [classpath:/application.yml]"
"Vault: secret/order-service"
```

### `--debug` 플래그로 자동 설정 보고서

```bash
java -jar app.jar --debug
```

출력 중 핵심 섹션:
```
============================
CONDITIONS EVALUATION REPORT
============================

Positive matches:
-----------------
   RedisCacheConfiguration matched:
      - @ConditionalOnClass found required class 'org.springframework.data.redis.cache.RedisCacheManager'
      - @Profile("prod") matched

Negative matches:
-----------------
   ConcurrentMapCacheConfiguration:
      - @Profile("dev") did not match — active profiles: "prod"
```

### Actuator `configprops` 엔드포인트

```bash
# @ConfigurationProperties 바인딩 결과 확인
curl localhost:8080/actuator/configprops | jq '.contexts.application.beans'
```

```json
{
  "orderProperties": {
    "prefix": "app.order",
    "properties": {
      "serviceUrl": "https://order-api.internal",
      "maxRetry": 3,
      "timeout": "PT5S",
      "notification": {
        "enabled": true,
        "recipient": "ops@example.com"
      }
    }
  }
}
```

> **보안 주의**: 운영에서는 Actuator 엔드포인트를 인증 뒤에 두거나, `management.endpoint.env.show-values=WHEN_AUTHORIZED`로 민감 값을 마스킹해야 합니다.

---

## 8) 테스트에서의 프로필/설정 관리

### `@ActiveProfiles`로 테스트 프로필 고정

```java
@SpringBootTest
@ActiveProfiles("test")
class OrderServiceTest {

    @Autowired
    private OrderProperties props;

    @Test
    void shouldLoadTestConfiguration() {
        assertThat(props.maxRetry()).isEqualTo(1);   // test에서는 빠르게 실패
        assertThat(props.timeout()).isEqualTo(Duration.ofSeconds(1));
    }
}
```

### `@TestPropertySource`로 개별 테스트 설정 오버라이드

```java
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    "app.order.max-retry=0",
    "app.order.notification.enabled=false"
})
class OrderServiceRetryDisabledTest {
    // max-retry=0인 상황을 테스트
}
```

### `@DynamicPropertySource`로 Testcontainers 연동

```java
@SpringBootTest
@Testcontainers
class OrderRepositoryTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
        .withDatabaseName("orders_test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }

    // 실제 MySQL 컨테이너에 연결되어 테스트 실행
}
```

> **팁**: `@DynamicPropertySource`는 Testcontainers처럼 "테스트 시작 전까지 값을 모르는" 설정에 유용합니다.

---

## 9) 프로필별 로깅 전략

```yaml
# application.yml — 공통
logging:
  pattern:
    console: "%d{ISO8601} [%thread] %-5level %logger{36} - %msg%n"

---
# dev
spring:
  config:
    activate:
      on-profile: dev
logging:
  level:
    root: INFO
    com.example: DEBUG
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE

---
# prod
spring:
  config:
    activate:
      on-profile: prod
logging:
  level:
    root: WARN
    com.example: INFO
  pattern:
    console: '{"time":"%d{ISO8601}","level":"%level","logger":"%logger","msg":"%msg","thread":"%thread"}%n'
```

**핵심**: 운영에서는 JSON 구조 로그를 쓰면 ELK/Loki에서 파싱이 쉽고, 검색/필터링 성능이 좋아집니다.

---

## 10) 자주 하는 실수와 방어 패턴

### 실수 1: 운영에서 ddl-auto가 update/create로 남아 있음

```yaml
# ❌ 이런 일이 실제로 발생합니다
spring:
  jpa:
    hibernate:
      ddl-auto: update    # 운영에서 테이블 구조가 자동 변경됨!
```

**방어**: prod 프로필에서 `validate`로 고정하고, ProfileGuard로 이중 검증.

### 실수 2: 환경변수 바인딩 실패

```bash
# ❌ 점(.)이 포함된 환경변수는 대부분 셸에서 유효하지 않음
export spring.datasource.url=jdbc:mysql://...

# ✅ 언더스코어 + 대문자로 변환
export SPRING_DATASOURCE_URL=jdbc:mysql://...
```

### 실수 3: 시크릿이 로그에 노출

```java
// ❌ 절대 하지 마세요
log.info("DB 연결: url={}, password={}", url, password);

// ✅ 비밀 값은 마스킹
log.info("DB 연결: url={}, password=****", url);
```

추가 방어: `application.yml`에서 actuator 마스킹 설정:

```yaml
management:
  endpoint:
    env:
      show-values: WHEN_AUTHORIZED
  endpoints:
    web:
      exposure:
        include: health, info, configprops
        exclude: env    # 운영에서는 env 노출 금지
```

### 실수 4: 프로필 미지정으로 기본 프로필이 적용됨

```bash
# SPRING_PROFILES_ACTIVE를 안 넣고 배포하면
# application.yml의 기본값만 적용 → 로컬 DB로 연결될 수 있음
```

**방어**: Dockerfile이나 K8s Deployment에 환경변수를 필수로 넣는 관례 + 프로필 미지정 시 시작 실패 가드.

---

## 11) 운영 체크리스트

### 프로필 설계 점검

- [ ] `spring.profiles.active`가 YAML에 하드코딩되어 있지 않은가? (환경변수로 주입해야 함)
- [ ] prod/dev 프로필이 동시에 켜지는 것을 방지하는 가드가 있는가?
- [ ] 프로필 그룹으로 관련 설정을 논리적으로 묶었는가?

### 설정 안전 점검

- [ ] 모든 비밀(DB 패스워드, API 키)이 YAML 밖(환경변수/Secret Manager)으로 분리되었는가?
- [ ] `@ConfigurationProperties`에 `@Validated` 검증이 적용되어 있는가?
- [ ] 운영 `ddl-auto`가 `validate`인가?
- [ ] Actuator의 민감 엔드포인트(`env`, `configprops`)가 인증 뒤에 있는가?

### 시크릿 관리 점검

- [ ] 시크릿 회전(rotation) 절차가 있는가?
- [ ] 시크릿이 애플리케이션 로그에 출력되지 않는가?
- [ ] Git 히스토리에 한 번이라도 시크릿이 커밋된 적이 없는가?
- [ ] `git-secrets` 또는 `gitleaks` 같은 사전 스캔이 CI에 포함되어 있는가?

### 테스트 점검

- [ ] 테스트 전용 프로필(`test`)이 분리되어 있는가?
- [ ] Testcontainers + `@DynamicPropertySource`로 외부 의존성을 격리하고 있는가?
- [ ] `@ConfigurationProperties` 바인딩/검증 테스트가 있는가?

---

## 연습(추천)

1. `app.*` 설정을 `@ConfigurationProperties`로 옮기고, `@Validated` 검증을 추가해서 잘못된 값이 시작 시점에서 실패하도록 만들어보기
2. dev/prod 프로필을 분리하고, 운영에서는 환경변수로만 시크릿이 들어오게 구성해보기
3. `--debug`/actuator `env`/`configprops`로 "왜 이 설정이 적용됐는지" 추적하는 연습을 해보기
4. ProfileGuard를 구현해서 prod+dev 동시 활성화를 차단해보기
5. Testcontainers + `@DynamicPropertySource`로 DB 통합 테스트를 작성해보기

---

## 관련 심화 학습

- [설정 관리 전략](/learning/deep-dive/deep-dive-config-management/) — 외부 설정 서버, Feature Flag
- [시크릿 관리](/learning/deep-dive/deep-dive-secret-management/) — Vault, KMS, 시크릿 회전
- [Docker 기초](/learning/deep-dive/deep-dive-docker-basics/) — 컨테이너 환경 변수와 프로파일
- [Spring Boot Auto Configuration](/learning/deep-dive/deep-dive-spring-boot-auto-config/) — 프로파일에 따른 자동 설정
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — ConfigMap/Secret과 Pod 설정 주입
- [CI/CD & GitHub Actions](/learning/deep-dive/deep-dive-ci-cd-github-actions/) — 파이프라인에서 환경별 설정 주입
- [Spring Security 아키텍처](/learning/deep-dive/deep-dive-spring-security-architecture/) — 프로필별 보안 설정 분기
