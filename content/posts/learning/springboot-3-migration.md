---
title: "실무자를 위한 Spring Boot 3.0 마이그레이션 완벽 가이드"
date: 2026-02-12T09:00:00+09:00
draft: false
tags: ["Spring Boot", "Java", "Migration", "Backend"]
categories: ["Backend", "Spring"]
---

Spring Boot 3.0은 2.x 버전 이후 가장 큰 변화를 담고 있는 메이저 업데이트입니다. 특히 **Java 17 이상이 필수**가 되었고, **Jakarta EE 9/10**으로의 전환이 강제되면서 단순 버전 업그레이드 이상의 작업이 필요합니다.

실무 프로젝트를 마이그레이션하며 겪었던 주요 변경 사항과 트러블슈팅 경험을 정리했습니다.

<!--more-->

## 1. Java 17 필수 전환

Spring Boot 3.0은 최소 요구 사항으로 Java 17을 지정했습니다. 아직 Java 8이나 11을 사용 중이라면 JDK 업그레이드가 선행되어야 합니다.

Java 17로 전환하면서 적극적으로 활용하면 좋은 문법들을 소개합니다.

### Record Class 활용 (DTO)
Lombok의 `@Data`나 `@Value`를 대체할 수 있는 `record` 타입을 적극 활용하여 불변 객체를 간결하게 정의할 수 있습니다.

{{< highlight java >}}
// Before: Lombok
@Value
public class UserRequest {
    String name;
    String email;
}

// After: Java Record
public record UserRequest(String name, String email) {}
{{< /highlight >}}

### Text Blocks
SQL이나 JSON 문자열을 다룰 때 가독성이 훨씬 좋아집니다.

{{< highlight java >}}
String query = """
    SELECT *
    FROM users
    WHERE status = 'ACTIVE'
""";
{{< /highlight >}}

---

## 2. javax.* ➡️ jakarta.* 패키지 대거 변경

Java EE가 Jakarta EE로 이관되면서 패키지명이 변경되었습니다. 가장 많은 컴파일 에러를 유발하는 부분입니다.

**변경 대상:**
- JPA (Hibernate)
- Validation
- Servlet API

### 해결 방법
`import` 구문에서 `javax.`를 `jakarta.`로 일괄 치환해야 합니다.

{{< highlight java >}}
// Before
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.servlet.http.HttpServletRequest;
import javax.validation.constraints.NotNull;

// After
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotNull;
{{< /highlight >}}

> **Tip:** IntelliJ IDEA의 'Migrate to Jakarta EE' 기능을 사용하면 프로젝트 전체의 패키지명을 한 번에 변경할 수 있습니다.

---

## 3. Spring Security 6.0 변경점

Spring Boot 3.0은 Spring Security 6.0을 기반으로 합니다. 기존의 `WebSecurityConfigurerAdapter`가 **Deprecated** 되고 삭제되었으므로, `SecurityFilterChain` Bean을 등록하는 방식으로 변경해야 합니다.

### 설정 코드 변경 예시

{{< highlight java >}}
// Before (Spring Boot 2.x)
@Configuration
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
            .antMatchers("/api/**").authenticated()
            .anyRequest().permitAll();
    }
}

// After (Spring Boot 3.x)
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll()
            );
        return http.build();
    }
}
{{< /highlight >}}

`antMatchers()` 대신 `requestMatchers()`를 사용해야 하는 점도 주의하세요.

---

## 4. Properties 변경 사항 (URL Matching)

Spring Boot 3.0부터는 URL 매칭 방식이 엄격해졌습니다. 이전 버전에서는 `/hello` 매핑이 `/hello/` 요청도 처리했지만, 이제는 정확히 일치해야 합니다.

기존 동작을 유지하려면 설정 변경이 필요하지만, 가급적 **Trailing Slash**를 제거하는 방향으로 클라이언트와 합의하는 것이 권장됩니다.

{{< highlight properties >}}
# Trailing Slash 매칭 허용 (Deprecated 예정)
spring.mvc.pathmatch.matching-strategy=ant_path_matcher
{{< /highlight >}}

---

## 5. 실제 트러블슈팅 (QueryDSL 이슈)

마이그레이션 중 가장 골치 아팠던 것은 QueryDSL 설정이었습니다. `javax.persistence` 의존성을 `jakarta.persistence`로 변경하면서 `apt-maven-plugin` 설정도 업데이트해야 했습니다.

### Gradle 설정 수정 (`build.gradle`)

{{< highlight groovy >}}
dependencies {
    // QueryDSL (Jakarta 호환 버전 확인 필수)
    implementation 'com.querydsl:querydsl-jpa:5.0.0:jakarta'
    annotationProcessor "com.querydsl:querydsl-apt:5.0.0:jakarta"
    annotationProcessor "jakarta.persistence:jakarta.persistence-api"
    annotationProcessor "jakarta.annotation:jakarta.annotation-api"
}
{{< /highlight >}}

`:jakarta` 분류자(classifier)를 명시하지 않으면 구버전 패키지(`javax`)를 참조하여 컴파일 에러가 발생합니다.

---

## 마무리

Spring Boot 3.0 마이그레이션은 단순한 버전 올리기 이상의 작업량이 필요하지만, Java 17의 이점과 최신 생태계의 지원을 받기 위해서는 필수적인 과정입니다. 특히 Security 설정과 Jakarta 패키지 변경은 미리 숙지하고 진행하시길 권장합니다.
