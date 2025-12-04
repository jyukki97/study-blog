---
title: "Spring Boot 3.x 마이그레이션 가이드"
date: 2025-11-03
topic: "Spring"
tags: ["Spring Boot", "Migration", "Jakarta EE", "Java 17"]
categories: ["Development", "Learning"]
description: "Spring Boot 2.x에서 3.x로 마이그레이션 시 주요 변경사항과 Breaking Changes 정리"
draft: true
---

> **학습 목표**: Spring Boot 3.x의 주요 변경사항을 이해하고, 실제 프로젝트 마이그레이션 시 발생할 수 있는 문제와 해결 방법을 파악한다.

## 🚀 Spring Boot 3.x 주요 변경사항

### 핵심 요구사항

| 항목 | Spring Boot 2.x | Spring Boot 3.x |
|------|----------------|-----------------|
| **Java 버전** | Java 8+ | **Java 17+** (필수) |
| **Jakarta EE** | Java EE (javax.*) | **Jakarta EE 9+** (jakarta.*) |
| **Spring Framework** | 5.x | **6.x** |
| **GraalVM** | 제한적 지원 | Native Image 완전 지원 |

---

## 📦 1. Java 17 마이그레이션

### Java 17의 주요 변경사항

#### 봉인 클래스 (Sealed Classes)

```java
// Java 17 신기능
public sealed class Shape
    permits Circle, Rectangle, Triangle {
}

public final class Circle extends Shape {
    private final double radius;

    public Circle(double radius) {
        this.radius = radius;
    }
}

// 컴파일러가 모든 케이스를 체크
public double calculateArea(Shape shape) {
    return switch (shape) {
        case Circle c -> Math.PI * c.radius * c.radius;
        case Rectangle r -> r.width * r.height;
        case Triangle t -> 0.5 * t.base * t.height;
        // default 불필요! 컴파일러가 모든 경우를 알고 있음
    };
}
```

#### Record 클래스

```java
// 기존 방식 (Lombok)
@Data
@AllArgsConstructor
public class UserDTO {
    private String id;
    private String name;
    private String email;
}

// Java 17 Record (불변 DTO)
public record UserDTO(
    String id,
    String name,
    String email
) {
    // 생성자, getter, equals, hashCode, toString 자동 생성

    // 커스텀 검증 로직 추가 가능
    public UserDTO {
        if (email == null || !email.contains("@")) {
            throw new IllegalArgumentException("Invalid email");
        }
    }
}
```

#### Pattern Matching for switch

```java
// 기존 방식
public String getType(Object obj) {
    if (obj instanceof String) {
        String s = (String) obj;
        return "String: " + s;
    } else if (obj instanceof Integer) {
        Integer i = (Integer) obj;
        return "Integer: " + i;
    }
    return "Unknown";
}

// Java 17 개선
public String getType(Object obj) {
    return switch (obj) {
        case String s -> "String: " + s;
        case Integer i -> "Integer: " + i;
        case null -> "Null value";
        default -> "Unknown";
    };
}
```

---

## 🔄 2. Jakarta EE 9+ (javax → jakarta)

### 패키지 이름 변경

**모든 `javax.*` 패키지가 `jakarta.*`로 변경됨!**

```java
// ❌ Spring Boot 2.x
import javax.servlet.http.HttpServletRequest;
import javax.persistence.Entity;
import javax.validation.constraints.NotNull;

// ✅ Spring Boot 3.x
import jakarta.servlet.http.HttpServletRequest;
import jakarta.persistence.Entity;
import jakarta.validation.constraints.NotNull;
```

### 자동 변환 도구

#### OpenRewrite 사용

**build.gradle**:
```gradle
plugins {
    id "org.openrewrite.rewrite" version "6.1.0"
}

dependencies {
    rewrite "org.openrewrite.recipe:rewrite-spring:5.0.5"
}

rewrite {
    activeRecipe("org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_0")
}
```

**실행**:
```bash
./gradlew rewriteRun
```

#### IntelliJ IDEA Migrator

1. **Refactor → Migrate Packages and Classes → Migrate to Jakarta EE 9**
2. 자동으로 import 문 변경

---

## 🛠️ 3. 주요 Breaking Changes

### 3.1 Configuration Properties

#### @ConstructorBinding 변경

```java
// Spring Boot 2.x
@ConfigurationProperties(prefix = "app")
@ConstructorBinding  // 필수!
public class AppProperties {
    private final String name;
    private final int timeout;

    public AppProperties(String name, int timeout) {
        this.name = name;
        this.timeout = timeout;
    }
}

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class Config {}

// Spring Boot 3.x
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private final String name;
    private final int timeout;

    // @ConstructorBinding 불필요!
    // 단일 생성자면 자동 적용
    public AppProperties(String name, int timeout) {
        this.name = name;
        this.timeout = timeout;
    }
}
```

### 3.2 Actuator Endpoints

```yaml
# Spring Boot 2.x
management:
  endpoints:
    web:
      exposure:
        include: "*"
  endpoint:
    health:
      show-details: always

# Spring Boot 3.x (동일하지만 일부 엔드포인트 변경)
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      show-details: when-authorized  # 보안 강화
```

### 3.3 Spring Security

#### WebSecurityConfigurerAdapter 제거

```java
// ❌ Spring Boot 2.x (Deprecated)
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/public/**").permitAll()
                .anyRequest().authenticated()
            .and()
            .formLogin();
    }
}

// ✅ Spring Boot 3.x
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(Customizer.withDefaults())
            .build();
    }
}
```

#### Method Security

```java
// Spring Boot 2.x
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class SecurityConfig {}

// Spring Boot 3.x
@EnableMethodSecurity  // 더 간단!
public class SecurityConfig {}
```

### 3.4 Spring Data

#### 반환 타입 변경

```java
// Spring Boot 2.x
public interface UserRepository extends JpaRepository<User, Long> {
    // Stream 반환 가능
    Stream<User> findByAge(int age);
}

// Spring Boot 3.x
public interface UserRepository extends JpaRepository<User, Long> {
    // Stream은 @QueryHints 필요 or List 사용 권장
    @QueryHints(@QueryHint(name = "org.hibernate.fetchSize", value = "50"))
    Stream<User> findByAge(int age);

    // 또는 List로 변경
    List<User> findByAge(int age);
}
```

---

## 🔧 4. Dependency 변경사항

### 주요 라이브러리 버전

```gradle
dependencies {
    // Spring Boot 2.x
    implementation 'org.springframework.boot:spring-boot-starter-web:2.7.x'
    implementation 'org.hibernate:hibernate-core:5.6.x'
    implementation 'io.springfox:springfox-boot-starter:3.0.0'  // ❌ 지원 중단

    // Spring Boot 3.x
    implementation 'org.springframework.boot:spring-boot-starter-web:3.2.x'
    implementation 'org.hibernate:hibernate-core:6.4.x'
    implementation 'org.springdoc:springdoc-openapi-starter-webmvc-ui:2.0.0'  // ✅ 대체
}
```

### Swagger → SpringDoc 마이그레이션

```java
// ❌ Springfox (지원 중단)
@Configuration
@EnableSwagger2
public class SwaggerConfig {
    @Bean
    public Docket api() {
        return new Docket(DocumentationType.SWAGGER_2)
            .select()
            .apis(RequestHandlerSelectors.basePackage("com.example"))
            .build();
    }
}

// ✅ SpringDoc OpenAPI 3
@Configuration
public class OpenApiConfig {
    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("My API")
                .version("1.0")
                .description("API Documentation"));
    }
}

// application.yml
springdoc:
  api-docs:
    path: /api-docs
  swagger-ui:
    path: /swagger-ui.html
```

---

## 🐳 5. GraalVM Native Image 지원

### Native Build 설정

**build.gradle**:
```gradle
plugins {
    id 'org.graalvm.buildtools.native' version '0.9.28'
}

graalvmNative {
    binaries {
        main {
            imageName = 'my-app'
            mainClass = 'com.example.Application'
            buildArgs.add('--verbose')
        }
    }
}
```

### Native Hints 추가

```java
@Configuration
@RegisterReflectionForBinding({UserDTO.class, OrderDTO.class})
public class NativeConfig implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        // Reflection Hint
        hints.reflection()
            .registerType(MyService.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.INVOKE_PUBLIC_METHODS);

        // Resource Hint
        hints.resources()
            .registerPattern("templates/*")
            .registerPattern("static/**");
    }
}
```

### 빌드 및 실행

```bash
# Native 이미지 빌드
./gradlew nativeCompile

# 실행 (JVM 대비 10배 빠른 시작 속도!)
./build/native/nativeCompile/my-app

# Docker Native 이미지
./gradlew bootBuildImage
```

---

## 📋 마이그레이션 체크리스트

### 1단계: 준비

- [ ] Java 17 이상 설치 확인
- [ ] Spring Boot 버전 확인 (2.7.x → 3.2.x 권장)
- [ ] 의존성 라이브러리 호환성 확인

### 2단계: 패키지 변경

- [ ] javax.* → jakarta.* 변환 (OpenRewrite 사용)
- [ ] import 문 모두 확인
- [ ] 외부 라이브러리 jakarta 지원 버전 확인

### 3단계: 코드 수정

- [ ] WebSecurityConfigurerAdapter → SecurityFilterChain
- [ ] @ConstructorBinding 제거
- [ ] Swagger → SpringDoc 전환
- [ ] Actuator 엔드포인트 설정 검토

### 4단계: 테스트

- [ ] 모든 단위 테스트 실행
- [ ] 통합 테스트 실행
- [ ] API 호환성 테스트
- [ ] 성능 테스트 (Native 빌드 시)

### 5단계: 배포

- [ ] Staging 환경 배포 테스트
- [ ] 모니터링 설정 확인
- [ ] Rollback 계획 수립
- [ ] Production 배포

---

## 🚨 흔한 문제와 해결법

### 문제 1: NoClassDefFoundError (javax.*)

```
java.lang.NoClassDefFoundError: javax/servlet/Filter
```

**해결**:
```gradle
// javax → jakarta 의존성 변경
implementation 'jakarta.servlet:jakarta.servlet-api:6.0.0'
```

### 문제 2: Hibernate 6.x 마이그레이션 이슈

```java
// Hibernate 5.x
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
}

// Hibernate 6.x
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)  // AUTO 대신 명시적 지정
    private Long id;
}
```

### 문제 3: Spring Cloud 호환성

```gradle
// Spring Boot 3.x용 Spring Cloud 버전 사용
ext {
    springCloudVersion = '2022.0.0'  // Kilburn
}

dependencies {
    implementation 'org.springframework.cloud:spring-cloud-starter-netflix-eureka-client'
}

dependencyManagement {
    imports {
        mavenBom "org.springframework.cloud:spring-cloud-dependencies:${springCloudVersion}"
    }
}
```

---

## 💡 마이그레이션 팁

### 1. 점진적 마이그레이션

```
2.6.x → 2.7.x (최신) → 3.0.x → 3.2.x (최신)
```

각 단계마다 테스트를 거쳐 안정성 확보!

### 2. Spring Boot Migrator 도구 활용

```bash
# Spring Boot Migrator CLI
wget https://github.com/spring-projects-experimental/spring-boot-migrator/releases/download/v0.14.0/spring-boot-migrator.jar

java -jar spring-boot-migrator.jar analyze /path/to/project
```

### 3. 로깅 강화

```yaml
# application.yml
logging:
  level:
    org.springframework: DEBUG
    org.hibernate: DEBUG
```

---

## 📚 참고 자료

- [Spring Boot 3.0 Migration Guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide)
- [Spring Framework 6.0 What's New](https://docs.spring.io/spring-framework/reference/6.0/index.html)
- [Jakarta EE 9 Specification](https://jakarta.ee/specifications/platform/9/)

---

> **다음 학습**: Kafka 멀티테넌트 큐 서비스 설계 - EasyQueue 아키텍처
