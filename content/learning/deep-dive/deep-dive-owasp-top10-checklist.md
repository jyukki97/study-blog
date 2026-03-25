---
title: "OWASP Top 10 대응 체크리스트"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["OWASP", "Security", "Vulnerability", "Checklist"]
categories: ["DevOps"]
description: "OWASP Top 10 주요 취약점을 백엔드 관점에서 점검하기 위한 체크리스트"
module: "ops-observability"
study_order: 355
---

## 이 글에서 얻는 것

- OWASP Top 10을 "암기 리스트"가 아니라, **백엔드 보안 점검의 프레임**으로 사용할 수 있습니다.
- 서비스에서 가장 자주 터지는 취약점이 "코드 한 줄"이 아니라 설계/운영/의존성에서 온다는 감각을 얻습니다.
- 스프링/백엔드 관점에서 각 항목을 어떻게 점검하고, 무엇부터 고정하면 좋은지 기준이 생깁니다.
- 항목별 **Spring Boot 코드 예시**와 **CI/CD 파이프라인 통합** 방법을 실전에 바로 적용할 수 있습니다.

---

## 0) OWASP Top 10은 "우선순위 힌트"다

OWASP Top 10은 전 세계적으로 자주 관측되는 취약점 범주를 정리한 것입니다.
내 서비스의 위협 모델과 완전히 같을 수는 없지만, "점검 순서"를 잡는 데 매우 유용합니다.

좋은 사용법:

- Top 10을 기준으로 "우리 서비스에서 해당 위험이 어디에 있는지"를 찾는다
- 위험이 큰 영역부터(인증/인가/데이터) 보안 베이스라인을 고정한다
- 자동화(스캔/정책)로 실수를 줄인다

### OWASP Top 10 (2021) 한눈에 보기

| 순위 | 카테고리 | 핵심 키워드 | 실무 빈도 |
|------|----------|-------------|-----------|
| A01 | Broken Access Control | IDOR, 수평/수직 권한 | ⭐⭐⭐⭐⭐ |
| A02 | Cryptographic Failures | TLS, 키 관리, 해시 | ⭐⭐⭐⭐ |
| A03 | Injection | SQL/LDAP/Command | ⭐⭐⭐⭐ |
| A04 | Insecure Design | 위협 모델링, Abuse Case | ⭐⭐⭐ |
| A05 | Security Misconfiguration | 기본값, 노출 | ⭐⭐⭐⭐⭐ |
| A06 | Vulnerable Components | 의존성 취약점 | ⭐⭐⭐⭐ |
| A07 | Authentication Failures | 세션, 토큰, MFA | ⭐⭐⭐⭐ |
| A08 | Integrity Failures | CI/CD 공급망 | ⭐⭐⭐ |
| A09 | Logging/Monitoring | 탐지, 대응 | ⭐⭐⭐⭐ |
| A10 | SSRF | 서버 요청 위조 | ⭐⭐⭐ |

---

## 1) A01 Broken Access Control (인가 실패)

가장 흔하고, 가장 치명적입니다. 2021 기준 **전체 앱의 94%**에서 발견됩니다.

### 실무에서 자주 터지는 형태

**IDOR (Insecure Direct Object Reference) — 수평 권한 침해:**
```http
GET /api/orders/12345
Authorization: Bearer <user_b_token>
```
User B가 User A의 주문(12345)을 조회할 수 있으면 IDOR입니다.

**수직 권한 침해:**
```http
POST /api/admin/users/delete
Authorization: Bearer <regular_user_token>
```
일반 사용자가 관리자 API를 호출할 수 있으면 수직 침해입니다.

### Spring Boot 방어 코드

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @GetMapping("/{orderId}")
    public OrderResponse getOrder(
            @PathVariable Long orderId,
            @AuthenticationPrincipal UserDetails user) {

        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new ResourceNotFoundException("Order not found"));

        // ✅ 리소스 소유자 검증 (IDOR 방어의 핵심)
        if (!order.getUserId().equals(user.getUserId())) {
            throw new AccessDeniedException("Not your order");
        }

        return OrderResponse.from(order);
    }
}
```

**메서드 레벨 보안 (Spring Security):**
```java
@Configuration
@EnableMethodSecurity(prePostEnabled = true)
public class SecurityConfig {
    // ...
}

@Service
public class OrderService {

    // SpEL로 소유자 검증
    @PreAuthorize("@orderSecurity.isOwner(#orderId, authentication)")
    public OrderResponse getOrder(Long orderId) {
        return orderRepository.findById(orderId)
                .map(OrderResponse::from)
                .orElseThrow();
    }
}

@Component("orderSecurity")
public class OrderSecurityEvaluator {

    private final OrderRepository orderRepository;

    public boolean isOwner(Long orderId, Authentication auth) {
        return orderRepository.findById(orderId)
                .map(order -> order.getUserId().equals(auth.getName()))
                .orElse(false);
    }
}
```

### 자동화 점검

```java
// 보안 테스트: 다른 사용자의 리소스 접근 시 403 반환
@Test
void shouldDenyAccessToOtherUsersOrder() {
    // User A의 주문
    Long orderIdOfUserA = createOrderAs("user-a");

    // User B로 접근 시도
    given()
        .header("Authorization", "Bearer " + tokenForUserB)
    .when()
        .get("/api/orders/" + orderIdOfUserA)
    .then()
        .statusCode(403);
}
```

### 체크리스트

- [ ] 모든 리소스 접근에 소유자/테넌트 검증 존재
- [ ] 관리자 엔드포인트에 역할 기반 접근 제어 적용
- [ ] URL 패턴 기반이 아닌 메서드 레벨 보안 사용
- [ ] IDOR 테스트 케이스가 CI에 포함
- [ ] 기본 정책은 **deny-all**, 명시적 허용만 열기

---

## 2) A02 Cryptographic Failures (암호화 실패)

암호화는 "알고리즘 선택"보다 "키/운영"에서 자주 무너집니다.

### 위험 패턴과 올바른 대응

| 위험 패턴 | 문제 | 올바른 대응 |
|-----------|------|-------------|
| MD5/SHA1로 비밀번호 해싱 | 레인보우 테이블 공격 가능 | BCrypt/Argon2id 사용 |
| 소스 코드에 시크릿 하드코딩 | Git 히스토리로 유출 | Vault/AWS Secrets Manager |
| HTTP 허용 | 중간자 공격 | HSTS + 리다이렉트 강제 |
| 약한 TLS 버전(1.0/1.1) | 알려진 취약점 존재 | TLS 1.2+ 강제 |

### Spring Boot 비밀번호 해싱

```java
@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // ✅ BCrypt (기본 cost=10, 충분)
        // 더 강한 보안이 필요하면 Argon2 사용
        return new BCryptPasswordEncoder();
    }
}

@Service
public class UserService {

    private final PasswordEncoder passwordEncoder;

    public void registerUser(UserRegisterRequest request) {
        User user = User.builder()
                .email(request.getEmail())
                // ✅ 평문 저장 금지
                .password(passwordEncoder.encode(request.getPassword()))
                .build();
        userRepository.save(user);
    }

    public boolean verifyPassword(String raw, String encoded) {
        return passwordEncoder.matches(raw, encoded);
    }
}
```

### HTTPS/HSTS 강제 (Spring Security)

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        // HTTP → HTTPS 리다이렉트
        .requiresChannel(channel -> channel
            .anyRequest().requiresSecure()
        )
        // HSTS 헤더
        .headers(headers -> headers
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true)
                .maxAgeInSeconds(31536000)  // 1년
                .preload(true)
            )
        );
    return http.build();
}
```

### 민감 데이터 암호화 (AES-256-GCM)

```java
@Component
public class FieldEncryptor {

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH = 128;

    private final SecretKey key;

    public FieldEncryptor(@Value("${encryption.key}") String base64Key) {
        byte[] decoded = Base64.getDecoder().decode(base64Key);
        this.key = new SecretKeySpec(decoded, "AES");
    }

    public String encrypt(String plaintext) throws Exception {
        byte[] iv = new byte[IV_LENGTH];
        SecureRandom.getInstanceStrong().nextBytes(iv);

        Cipher cipher = Cipher.getInstance(ALGORITHM);
        GCMParameterSpec spec = new GCMParameterSpec(TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, key, spec);

        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

        // IV + ciphertext를 함께 저장
        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

        return Base64.getEncoder().encodeToString(combined);
    }
}
```

### 체크리스트

- [ ] 모든 외부 통신 HTTPS 강제 + HSTS 적용
- [ ] 비밀번호는 BCrypt/Argon2id로 해싱
- [ ] 시크릿은 Vault/Secrets Manager에서 주입 (소스 코드에 없음)
- [ ] 시크릿 회전(rotation) 절차 수립
- [ ] TLS 1.2 이상만 허용, 약한 Cipher Suite 비활성화
- [ ] `git-secrets` 또는 `gitleaks`로 시크릿 스캔 CI에 포함

---

## 3) A03 Injection (인젝션)

SQL만이 아니라, LDAP/OS command/JSONPath 등 "입력이 명령/쿼리로 해석되는 곳"이 모두 대상입니다.

### SQL Injection 방어

```java
// ❌ 취약한 코드 (문자열 연결)
@Repository
public class BadUserRepo {
    public User findByName(String name) {
        String sql = "SELECT * FROM users WHERE name = '" + name + "'";
        // name에 "'; DROP TABLE users; --" 가 들어오면?
        return jdbcTemplate.queryForObject(sql, userMapper);
    }
}

// ✅ 안전한 코드 (파라미터 바인딩)
@Repository
public class SafeUserRepo {
    public User findByName(String name) {
        String sql = "SELECT * FROM users WHERE name = ?";
        return jdbcTemplate.queryForObject(sql, userMapper, name);
    }
}
```

**JPA/QueryDSL은 기본적으로 파라미터 바인딩을 사용합니다:**
```java
// ✅ Spring Data JPA — 안전
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);

    // ✅ JPQL도 바인딩 사용
    @Query("SELECT u FROM User u WHERE u.name = :name")
    List<User> findByName(@Param("name") String name);
}
```

### 입력 검증 (Bean Validation)

```java
public class UserCreateRequest {

    @NotBlank(message = "이름은 필수입니다")
    @Size(min = 2, max = 50)
    @Pattern(regexp = "^[가-힣a-zA-Z0-9]+$",
             message = "이름에 특수문자를 사용할 수 없습니다")
    private String name;

    @Email(message = "유효한 이메일 형식이 아닙니다")
    @Size(max = 255)
    private String email;

    @Min(0) @Max(150)
    private Integer age;
}
```

### OS Command Injection 방어

```java
// ❌ 취약: 사용자 입력이 쉘 명령에 직접 포함
Runtime.getRuntime().exec("ping " + userInput);

// ✅ 안전: ProcessBuilder + 배열 인자 (쉘 해석 없음)
ProcessBuilder pb = new ProcessBuilder("ping", "-c", "3", sanitizedHost);
pb.redirectErrorStream(true);
Process process = pb.start();
```

### 체크리스트

- [ ] 모든 SQL은 파라미터 바인딩 사용 (문자열 연결 금지)
- [ ] Bean Validation으로 입력 검증 (allow-list 원칙)
- [ ] 외부 프로세스 실행 시 ProcessBuilder + 배열 인자
- [ ] 출력 인코딩 (HTML/JS/URL 컨텍스트별)
- [ ] `SAST` 도구(SpotBugs, SonarQube)로 Injection 패턴 탐지

---

## 4) A04 Insecure Design (설계 취약)

"구현은 맞는데 설계가 위험한" 케이스입니다. 코드 리뷰로는 못 잡고, **위협 모델링**으로 잡아야 합니다.

### 위험한 설계 예시와 대응

**비밀번호 재설정 — 레이트리밋 없음:**
```java
// ❌ 위험: 무제한 재설정 요청 → 이메일 폭탄 / 브루트포스
@PostMapping("/reset-password")
public ResponseEntity<Void> resetPassword(@RequestBody ResetRequest req) {
    passwordService.sendResetEmail(req.getEmail());
    return ResponseEntity.ok().build();
}

// ✅ 안전: 레이트리밋 + 동일 응답 (이메일 존재 여부 노출 방지)
@PostMapping("/reset-password")
@RateLimiter(name = "passwordReset", fallbackMethod = "rateLimitFallback")
public ResponseEntity<Void> resetPassword(@RequestBody ResetRequest req) {
    // 이메일 존재 여부와 관계없이 동일 응답
    passwordService.sendResetEmailIfExists(req.getEmail());
    return ResponseEntity.ok().build();
}
```

**중요 동작에 재인증 요구:**
```java
@PostMapping("/transfer")
public ResponseEntity<Void> transfer(
        @RequestBody TransferRequest req,
        @AuthenticationPrincipal UserDetails user) {

    // ✅ 금액이 100만 원 이상이면 재인증 요구
    if (req.getAmount().compareTo(BigDecimal.valueOf(1_000_000)) >= 0) {
        if (!req.hasReauthToken()) {
            throw new ReauthenticationRequiredException("고액 이체는 재인증이 필요합니다");
        }
        reauthService.verify(user, req.getReauthToken());
    }

    transferService.execute(req, user);
    return ResponseEntity.ok().build();
}
```

### 간이 위협 모델링 (STRIDE)

| 위협 | 질문 | 대응 |
|------|------|------|
| **S**poofing | 인증 우회 가능한가? | MFA, 강한 세션 관리 |
| **T**ampering | 요청/데이터 변조 가능한가? | 서명 검증, 무결성 체크 |
| **R**epudiation | 부인 가능한 행위가 있는가? | 감사 로그 |
| **I**nformation Disclosure | 민감 정보 노출 경로가 있는가? | 최소 노출 원칙 |
| **D**enial of Service | 리소스 고갈 공격 가능한가? | 레이트리밋, 타임아웃 |
| **E**levation of Privilege | 권한 상승 경로가 있는가? | 최소 권한 원칙 |

### 체크리스트

- [ ] 주요 기능(결제/권한변경/삭제)에 위협 모델링 수행
- [ ] Abuse Case를 테스트/QA 항목에 포함
- [ ] 레이트리밋이 인증/비밀번호 재설정/API에 적용
- [ ] 고액/고위험 동작에 재인증/2FA 요구

---

## 5) A05 Security Misconfiguration (설정 실수)

운영에서 가장 자주 발생하는 사고 중 하나입니다. **기본값이 안전하지 않은 경우**가 많습니다.

### Spring Boot Actuator 보안

```yaml
# application-prod.yml
management:
  endpoints:
    web:
      exposure:
        # ✅ 필요한 것만 열기 (health, info, prometheus)
        include: health, info, prometheus
      base-path: /internal/actuator  # 기본 경로 변경
  endpoint:
    health:
      show-details: when_authorized  # 인증된 사용자만 상세 정보
    env:
      enabled: false  # ❌ 환경변수 노출 금지
    beans:
      enabled: false
    configprops:
      enabled: false

  # Prometheus 메트릭은 인증 필수
  server:
    port: 9090  # 별도 포트로 분리
```

```java
@Configuration
public class ActuatorSecurityConfig {

    @Bean
    @Order(1)
    public SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/internal/actuator/**")
            .authorizeHttpRequests(auth -> auth
                // health와 info만 공개
                .requestMatchers("/internal/actuator/health").permitAll()
                .requestMatchers("/internal/actuator/info").permitAll()
                // 나머지는 ADMIN만
                .anyRequest().hasRole("ADMIN")
            );
        return http.build();
    }
}
```

### 보안 헤더 설정

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.headers(headers -> headers
        // XSS 방어
        .contentTypeOptions(Customizer.withDefaults())
        // 클릭재킹 방어
        .frameOptions(frame -> frame.deny())
        // CSP (Content Security Policy)
        .contentSecurityPolicy(csp ->
            csp.policyDirectives("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
        )
        // Referrer 정보 제한
        .referrerPolicy(referrer ->
            referrer.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)
        )
        // HTTPS 강제
        .httpStrictTransportSecurity(hsts -> hsts
            .includeSubDomains(true)
            .maxAgeInSeconds(31536000)
        )
    );
    return http.build();
}
```

### CORS 설정 (최소 허용)

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                // ✅ 구체적 오리진만 허용 (*는 금지)
                .allowedOrigins("https://myapp.com", "https://admin.myapp.com")
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowedHeaders("Authorization", "Content-Type")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
```

### Swagger/OpenAPI 프로덕션 비활성화

```yaml
# application-prod.yml
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

### 체크리스트

- [ ] Actuator 엔드포인트 최소 노출 + 인증/별도 포트
- [ ] Swagger/H2 Console 프로덕션에서 비활성화
- [ ] 보안 헤더(HSTS, CSP, X-Frame-Options 등) 설정
- [ ] CORS는 구체적 오리진만 허용 (`*` 금지)
- [ ] 기본 계정/비밀번호 변경 확인
- [ ] 에러 응답에 스택 트레이스/내부 정보 노출 금지

```yaml
# ✅ 프로덕션 에러 응답 설정
server:
  error:
    include-stacktrace: never
    include-message: never
    include-binding-errors: never
```

---

## 6) A06 Vulnerable and Outdated Components (취약한 의존성)

코드를 잘 짜도, 의존성이 취약하면 사고가 납니다. Log4Shell(CVE-2021-44228)이 대표적입니다.

### CI/CD 파이프라인 통합

```yaml
# .github/workflows/security-scan.yml
name: Security Scan
on: [push, pull_request]

jobs:
  dependency-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Gradle 의존성 취약점 스캔
      - name: OWASP Dependency-Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: 'my-app'
          path: '.'
          format: 'HTML'
          args: '--failOnCVSS 7'  # CVSS 7 이상이면 실패

      # Trivy로 컨테이너 이미지 스캔
      - name: Trivy Container Scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'my-app:latest'
          format: 'sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'  # 발견 시 빌드 실패

      # SBOM 생성
      - name: Generate SBOM
        run: |
          syft my-app:latest -o spdx-json > sbom.spdx.json
```

**Dependabot 설정:**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "gradle"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "security"
```

### 체크리스트

- [ ] 의존성 스캔(OWASP Dependency-Check / Trivy)이 CI에 포함
- [ ] Dependabot 또는 Renovate로 자동 업데이트 PR 생성
- [ ] 베이스 Docker 이미지 스캔 포함
- [ ] SBOM 생성/관리 (규제 환경이면 필수)
- [ ] Critical/High CVE는 SLA 기반 패치 (예: Critical 72시간 내)

---

## 7) A07 Identification & Authentication Failures (인증 실패)

인증은 "로그인"만이 아니라 세션/토큰 운영까지 포함합니다.

### 로그인 브루트포스 방어

```java
@Component
public class LoginAttemptService {

    private final LoadingCache<String, Integer> attemptsCache;

    public LoginAttemptService() {
        this.attemptsCache = CacheBuilder.newBuilder()
                .expireAfterWrite(15, TimeUnit.MINUTES)
                .build(new CacheLoader<>() {
                    @Override
                    public Integer load(String key) { return 0; }
                });
    }

    public void loginFailed(String key) {
        int attempts = attemptsCache.getUnchecked(key) + 1;
        attemptsCache.put(key, attempts);
    }

    public boolean isBlocked(String key) {
        return attemptsCache.getUnchecked(key) >= 5;
    }

    public void loginSucceeded(String key) {
        attemptsCache.invalidate(key);
    }
}
```

### 세션 관리 (Spring Security)

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.sessionManagement(session -> session
        // 세션 고정 공격 방어
        .sessionFixation().changeSessionId()
        // 동시 세션 제한
        .maximumSessions(3)
        // 최대 세션 초과 시 이전 세션 만료
        .maxSessionsPreventsLogin(false)
    );
    return http.build();
}
```

### 비밀번호 정책 검증

```java
@Component
public class PasswordPolicyValidator {

    private static final int MIN_LENGTH = 8;
    private static final Pattern UPPER = Pattern.compile("[A-Z]");
    private static final Pattern LOWER = Pattern.compile("[a-z]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    private static final Pattern SPECIAL = Pattern.compile("[!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>/?]");

    public void validate(String password) {
        List<String> violations = new ArrayList<>();

        if (password.length() < MIN_LENGTH) violations.add("최소 " + MIN_LENGTH + "자");
        if (!UPPER.matcher(password).find()) violations.add("대문자 1개 이상");
        if (!LOWER.matcher(password).find()) violations.add("소문자 1개 이상");
        if (!DIGIT.matcher(password).find()) violations.add("숫자 1개 이상");
        if (!SPECIAL.matcher(password).find()) violations.add("특수문자 1개 이상");

        if (!violations.isEmpty()) {
            throw new WeakPasswordException("비밀번호 정책 위반: " + String.join(", ", violations));
        }
    }
}
```

### 체크리스트

- [ ] 로그인 실패 횟수 제한 + 계정 잠금/지연
- [ ] 세션 고정 공격 방어 (sessionFixation.changeSessionId)
- [ ] 비밀번호 정책 (길이/복잡성/히스토리)
- [ ] Refresh Token Rotation 적용
- [ ] 401(인증 실패) / 403(인가 실패) 응답 분리
- [ ] MFA 옵션 제공 (고위험 서비스)

---

## 8) A08 Software and Data Integrity Failures (무결성 실패)

CI/CD/배포/업데이트에서 무결성이 깨지는 문제입니다.

### 컨테이너 이미지 서명 검증

```yaml
# Cosign으로 이미지 서명
- name: Sign Image
  run: |
    cosign sign --key cosign.key ${{ env.IMAGE_TAG }}

# 배포 시 서명 검증 (Kyverno 정책)
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-cosign
      match:
        resources:
          kinds:
            - Pod
      verifyImages:
        - imageReferences:
            - "myregistry.io/myapp:*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      ...
                      -----END PUBLIC KEY-----
```

### GitHub Actions 하드닝

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read     # ✅ 최소 권한
      packages: write
    steps:
      - uses: actions/checkout@v4  # ✅ 태그 대신 SHA 고정
      # ❌ 위험: uses: some-action@main
      # ✅ 안전: uses: some-action@<commit-sha>
```

### 체크리스트

- [ ] CI/CD 파이프라인에서 검증된 아티팩트만 배포
- [ ] 컨테이너 이미지 서명(Cosign/Notation) + 배포 시 검증
- [ ] GitHub Actions 권한 최소화 (`permissions` 명시)
- [ ] 서드파티 Action은 SHA 핀 고정
- [ ] SLSA Level 2 이상 달성 목표

---

## 9) A09 Security Logging and Monitoring Failures (로깅/모니터링 실패)

침해는 "막는 것"만큼 "빨리 알아차리는 것"이 중요합니다. 평균 침해 탐지 시간은 **197일**(IBM 2023)입니다.

### 보안 이벤트 로깅

```java
@Component
public class SecurityEventLogger {

    private static final Logger securityLog =
            LoggerFactory.getLogger("SECURITY_AUDIT");

    // ✅ 구조화된 보안 이벤트 로그
    public void logAuthEvent(String eventType, String userId,
                             String ip, boolean success, String detail) {
        securityLog.info("security_event={} user={} ip={} success={} detail={}",
                eventType, userId, ip, success, detail);
    }

    // 로그인 실패
    public void logLoginFailure(String username, String ip, String reason) {
        logAuthEvent("LOGIN_FAILURE", username, ip, false, reason);
    }

    // 권한 실패
    public void logAccessDenied(String userId, String resource, String ip) {
        logAuthEvent("ACCESS_DENIED", userId, ip, false,
                "resource=" + resource);
    }

    // 중요 데이터 접근
    public void logSensitiveAccess(String userId, String resource, String ip) {
        logAuthEvent("SENSITIVE_ACCESS", userId, ip, true,
                "resource=" + resource);
    }
}
```

### 반드시 로깅해야 하는 이벤트

| 이벤트 | 심각도 | 알람 여부 |
|--------|--------|-----------|
| 로그인 실패 (연속 5회 이상) | HIGH | ✅ 즉시 |
| 권한 없는 리소스 접근 시도 | HIGH | ✅ 즉시 |
| 관리자 권한 변경 | CRITICAL | ✅ 즉시 |
| 비정상 API 호출 패턴 | MEDIUM | ⏰ 집계 후 |
| 세션 만료/강제 종료 | LOW | ❌ |
| 비밀번호 변경/재설정 | MEDIUM | ⏰ 집계 후 |

### Prometheus 보안 메트릭

```java
@Component
public class SecurityMetrics {

    private final Counter loginFailures;
    private final Counter accessDenied;

    public SecurityMetrics(MeterRegistry registry) {
        this.loginFailures = Counter.builder("security.login.failures")
                .description("로그인 실패 횟수")
                .tag("type", "password")
                .register(registry);

        this.accessDenied = Counter.builder("security.access.denied")
                .description("접근 거부 횟수")
                .register(registry);
    }

    public void recordLoginFailure() { loginFailures.increment(); }
    public void recordAccessDenied() { accessDenied.increment(); }
}
```

**PromQL 알람 규칙:**
```yaml
groups:
  - name: security
    rules:
      - alert: HighLoginFailureRate
        expr: rate(security_login_failures_total[5m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "로그인 실패 급증 ({{ $value }}/sec)"
```

### 로그 보안 주의사항

```java
// ❌ 위험: PII/시크릿이 로그에 남음
log.info("User login: email={}, password={}", email, password);
log.info("API call with token: {}", authToken);

// ✅ 안전: 마스킹 처리
log.info("User login: email={}", maskEmail(email));
// password/token은 로그에 절대 남기지 않음
```

### 체크리스트

- [ ] 인증 실패/권한 실패/민감 동작에 대한 구조화된 보안 로그
- [ ] 보안 이벤트 알람 규칙 설정 (Prometheus/ELK)
- [ ] 로그에 PII/시크릿이 남지 않음 (마스킹/정책)
- [ ] 로그 보존 기간 정책 수립 (규정 준수)
- [ ] 보안 대시보드 구축 (로그인 실패 추이, 접근 거부 추이)

---

## 10) A10 SSRF (Server-Side Request Forgery)

서버가 외부 URL을 호출해주는 기능(프록시/미리보기/웹훅)이 있으면 위험이 생깁니다.

### SSRF 방어 코드

```java
@Component
public class SafeUrlValidator {

    // ✅ 허용 도메인 화이트리스트
    private static final Set<String> ALLOWED_HOSTS = Set.of(
            "api.partner.com",
            "cdn.myapp.com"
    );

    // ✅ 차단 대상: 내부망/메타데이터 IP
    private static final List<String> BLOCKED_PREFIXES = List.of(
            "10.", "172.16.", "172.17.", "172.18.", "172.19.",
            "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
            "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
            "172.30.", "172.31.", "192.168.", "127.", "0.",
            "169.254."  // AWS 메타데이터 서비스
    );

    public void validate(String url) {
        URI uri = URI.create(url);

        // 스킴 검증
        if (!"https".equals(uri.getScheme())) {
            throw new SecurityException("HTTPS만 허용됩니다");
        }

        // 호스트 화이트리스트 검증
        String host = uri.getHost();
        if (!ALLOWED_HOSTS.contains(host)) {
            throw new SecurityException("허용되지 않은 호스트: " + host);
        }

        // IP 주소 직접 사용 차단
        try {
            InetAddress addr = InetAddress.getByName(host);
            String ip = addr.getHostAddress();
            for (String prefix : BLOCKED_PREFIXES) {
                if (ip.startsWith(prefix)) {
                    throw new SecurityException("내부 IP 접근 차단: " + ip);
                }
            }
        } catch (UnknownHostException e) {
            throw new SecurityException("호스트를 확인할 수 없습니다: " + host);
        }
    }
}
```

### 네트워크 레벨 방어 (Egress 정책)

```yaml
# Kubernetes NetworkPolicy: 외부 나가는 트래픽 제한
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: restrict-egress
spec:
  podSelector:
    matchLabels:
      app: webhook-service
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8       # 내부망 차단
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.169.254/32  # 메타데이터 차단
      ports:
        - protocol: TCP
          port: 443
```

### 체크리스트

- [ ] URL 화이트리스트 (도메인/스킴/포트)
- [ ] 내부망 IP / 메타데이터 서비스 IP 차단
- [ ] DNS Rebinding 방어 (요청 전 IP 해석 + 재검증)
- [ ] 리다이렉트 따라가기 제한 (최대 횟수 설정)
- [ ] Egress 네트워크 정책으로 나갈 수 있는 곳 제한

---

## 11) 실무 적용 루틴 (추천 순서)

### Phase 1: 즉시 적용 (1~2주)

1. **인증/인가 경계** 점검 (A01/A07)
   - IDOR 테스트 케이스 작성
   - 관리자 엔드포인트 권한 확인
2. **설정/노출 닫기** (A05)
   - Actuator/Swagger 프로덕션 비활성화
   - 보안 헤더 설정
   - 에러 응답에서 내부 정보 제거

### Phase 2: 자동화 구축 (2~4주)

3. **의존성/배포 무결성 자동화** (A06/A08)
   - Dependency-Check CI 통합
   - Dependabot 활성화
   - 이미지 스캔 추가
4. **로깅/알람으로 탐지 능력 확보** (A09)
   - 보안 이벤트 구조화 로그
   - 알람 규칙 설정

### Phase 3: 설계 강화 (지속)

5. **설계 취약/특수 케이스 점검** (A04/A10)
   - 주요 기능 위협 모델링
   - SSRF 방어 구현

### CI/CD 통합 보안 스캔 파이프라인

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   Code   │    │  Build   │    │   Test   │    │  Deploy  │
│  Commit  │───▶│  + SAST  │───▶│  + DAST  │───▶│  + Sign  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │               │
     ▼               ▼               ▼               ▼
  gitleaks      SpotBugs/       OWASP ZAP       Cosign
  pre-commit    SonarQube       Trivy           Kyverno
                Dep-Check
```

---

## 12) 안티패턴: "이렇게 하면 안 됩니다"

| 안티패턴 | 문제 | 올바른 방향 |
|----------|------|-------------|
| 프론트엔드에서만 권한 체크 | 서버 우회 가능 | **서버에서 반드시 검증** |
| "보안은 나중에" | 설계 취약은 나중에 고치기 어려움 | **설계 단계부터 보안 요구사항** |
| 모든 취약점을 동시에 고치려 함 | 리소스 분산, 완성도 저하 | **우선순위(A01→A05→A06) 기반 점진 개선** |
| 스캔만 돌리고 결과 방치 | false 안정감 | **SLA 기반 패치 + 예외 승인 프로세스** |
| 시크릿을 환경변수로만 관리 | 회전/감사 어려움 | **Secret Manager + 자동 회전** |
| 로그를 안 봄 | 침해 탐지 불가 | **대시보드 + 알람 + 정기 리뷰** |

---

## 연습 (추천)

1. 내 서비스의 "민감 기능 5개"를 뽑고(A01/A07), 권한/인증 실패 테스트 케이스를 작성해보기
2. 운영에서 노출되면 안 되는 엔드포인트(Actuator/Swagger 등)를 목록화하고, 네트워크/인증으로 막아보기
3. 의존성 스캔(Dependabot/Dependency-Check)을 켜고, 한 번 취약점 업데이트를 처리해보며 운영 루프를 만들어보기
4. 보안 이벤트 로그를 구조화하고, Prometheus 메트릭 + 알람 규칙을 설정해보기
5. SSRF 취약점이 있는 테스트 코드를 작성하고, SafeUrlValidator로 방어가 동작하는지 확인해보기

---

## 🔗 관련 글

- [JWT vs Session: 토큰 기반 인증의 허와 실](/learning/deep-dive/deep-dive-jwt-auth/)
- [Spring Security 아키텍처 이해](/learning/deep-dive/deep-dive-spring-security-architecture/)
- [OAuth2/OIDC 인증 서버 설계](/learning/deep-dive/deep-dive-oauth2-oidc/)
- [CORS/CSRF/보안 헤더 실전 설정](/learning/deep-dive/deep-dive-security-cors-csrf-headers/)
- [Secret Management: 비밀 정보 안전하게 관리하기](/learning/deep-dive/deep-dive-secret-management/)
- [CI/CD 보안과 소프트웨어 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)
- [인가 모델 비교: RBAC vs ABAC vs ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [Observability Baseline: 로그/메트릭/트레이스 기본기](/learning/deep-dive/deep-dive-observability-baseline/)
- [Observability Alarms: 알람 설계와 온콜 운영](/learning/deep-dive/deep-dive-observability-alarms/)
