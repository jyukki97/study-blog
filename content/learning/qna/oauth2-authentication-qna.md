---
title: "OAuth2 인증 구조 정리"
date: 2025-01-22
topic: "Security"
tags: ["OAuth2", "인증", "보안", "Spring Security", "JWT", "Token"]
categories: ["Security"]
series: ["핵심 개념 Q&A"]
series_order: 17
draft: true
---

## Q1. OAuth2 인증 흐름을 설명하고, 4가지 Grant Type의 차이점을 비교해주세요.

### 답변

OAuth2는 **인증(Authentication)이 아닌 인가(Authorization) 프로토콜**입니다. 사용자가 제3자 애플리케이션에게 자신의 리소스 접근 권한을 부여하는 표준 프로토콜입니다.

#### 핵심 역할 4가지

| 역할 | 설명 | 예시 |
|------|------|------|
| **Resource Owner** | 리소스 소유자 (사용자) | Google 계정을 가진 사용자 |
| **Client** | 리소스 접근을 요청하는 애플리케이션 | 우리 서비스 앱 |
| **Authorization Server** | 인증/인가 서버 | Google OAuth2 서버 |
| **Resource Server** | 보호된 리소스를 제공하는 서버 | Google API 서버 |

#### 4가지 Grant Type 비교

##### 1. Authorization Code (가장 안전, 권장)

```
┌──────────┐                               ┌──────────────┐
│  사용자   │                               │ Auth Server  │
└────┬─────┘                               └──────┬───────┘
     │                                            │
     │  1. 로그인 페이지로 리다이렉트              │
     │───────────────────────────────────────────>│
     │                                            │
     │  2. 사용자 로그인 & 권한 승인               │
     │<──────────────────────────────────────────>│
     │                                            │
     │  3. Authorization Code 발급 (redirect)     │
     │<───────────────────────────────────────────│
     │                                            │
┌────▼─────┐                               ┌──────▼───────┐
│  Client  │  4. Code로 Access Token 요청   │ Auth Server  │
│ (Backend)│──────────────────────────────>│              │
│          │  5. Access Token 발급          │              │
│          │<──────────────────────────────│              │
└──────────┘                               └──────────────┘
```

**실제 Spring Security 구현:**

```java
// application.yml
spring:
  security:
    oauth2:
      client:
        registration:
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope: profile, email
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            authorization-grant-type: authorization_code

// SecurityConfig.java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .oauth2Login(oauth2 -> oauth2
                .userInfoEndpoint(userInfo -> userInfo
                    .userService(customOAuth2UserService)
                )
                .successHandler(oAuth2SuccessHandler)
            );
        return http.build();
    }
}

// CustomOAuth2UserService.java
@Service
public class CustomOAuth2UserService implements OAuth2UserService<OAuth2UserRequest, OAuth2User> {

    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2AuthenticationException {
        // 1. Access Token으로 사용자 정보 요청
        OAuth2User oAuth2User = delegate.loadUser(userRequest);

        String registrationId = userRequest.getClientRegistration().getRegistrationId();
        String userNameAttributeName = userRequest.getClientRegistration()
            .getProviderDetails()
            .getUserInfoEndpoint()
            .getUserNameAttributeName();

        // 2. 사용자 정보 추출
        Map<String, Object> attributes = oAuth2User.getAttributes();

        // 3. DB에 저장 또는 업데이트
        User user = saveOrUpdate(attributes, registrationId);

        return new DefaultOAuth2User(
            Collections.singleton(new SimpleGrantedAuthority("ROLE_USER")),
            attributes,
            userNameAttributeName
        );
    }
}
```

##### 2. Implicit (보안 취약, Deprecated)

```
┌──────────┐                               ┌──────────────┐
│  Browser │  1. 로그인 요청                 │ Auth Server  │
└────┬─────┘───────────────────────────────>└──────┬───────┘
     │                                            │
     │  2. Access Token 즉시 발급 (URL Fragment)   │
     │<───────────────────────────────────────────│
     │  (https://example.com#access_token=xxx)   │
```

**문제점:**
- Access Token이 브라우저에 노출 (URL Fragment)
- CSRF 공격에 취약
- Refresh Token 미지원
- **SPA는 Authorization Code + PKCE 사용 권장**

##### 3. Resource Owner Password Credentials

```java
// ⚠️ 신뢰할 수 있는 1st Party 앱만 사용 (예: 회사 내부 앱)
POST /oauth/token HTTP/1.1
Host: auth-server.com
Content-Type: application/x-www-form-urlencoded

grant_type=password&
username=user@example.com&
password=secretpassword&
client_id=my-client&
client_secret=my-secret
```

**사용 사례:**
- 회사 내부 모바일 앱
- Legacy 시스템 마이그레이션 과정

##### 4. Client Credentials (서버 간 통신)

```java
// 사용자 컨텍스트 없이 서버끼리 통신
@Configuration
public class OAuth2ClientConfig {

    @Bean
    public OAuth2AuthorizedClientManager authorizedClientManager(
            ClientRegistrationRepository clientRegistrationRepository,
            OAuth2AuthorizedClientRepository authorizedClientRepository) {

        OAuth2AuthorizedClientProvider authorizedClientProvider =
            OAuth2AuthorizedClientProviderBuilder.builder()
                .clientCredentials()  // Client Credentials Grant
                .build();

        DefaultOAuth2AuthorizedClientManager authorizedClientManager =
            new DefaultOAuth2AuthorizedClientManager(
                clientRegistrationRepository,
                authorizedClientRepository
            );

        authorizedClientManager.setAuthorizedClientProvider(authorizedClientProvider);
        return authorizedClientManager;
    }
}

// 사용
@Service
public class ExternalApiService {

    @Autowired
    private WebClient webClient;

    public String callExternalApi() {
        return webClient
            .get()
            .uri("https://api.example.com/data")
            .attributes(clientRegistrationId("external-api"))  // Client Credentials 자동 처리
            .retrieve()
            .bodyToMono(String.class)
            .block();
    }
}
```

#### Grant Type 선택 가이드

| 상황 | 권장 Grant Type |
|------|----------------|
| 웹 애플리케이션 (Backend 있음) | Authorization Code |
| SPA (React, Vue) | Authorization Code + PKCE |
| 모바일 앱 | Authorization Code + PKCE |
| 서버 간 통신 | Client Credentials |
| 신뢰할 수 있는 1st Party 앱 | Password (마이그레이션 시) |

### 꼬리 질문 1: PKCE가 무엇이고 왜 필요한가요?

**PKCE (Proof Key for Code Exchange)**: Authorization Code 탈취 공격을 방지하는 확장 메커니즘

```
1. Client가 code_verifier 생성 (랜덤 문자열)
   code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

2. code_challenge 계산
   code_challenge = BASE64URL(SHA256(code_verifier))
                  = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

3. Authorization 요청 시 code_challenge 전송
   GET /authorize?
       response_type=code&
       client_id=xxx&
       code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
       code_challenge_method=S256

4. Token 요청 시 code_verifier 전송
   POST /token
   grant_type=authorization_code&
   code=AUTHORIZATION_CODE&
   code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk

5. 서버가 검증
   SHA256(code_verifier) == code_challenge ✅
```

**SPA에서 PKCE 사용 이유:**
- Client Secret을 안전하게 저장할 수 없음 (JS 코드 노출)
- PKCE로 동적으로 생성되는 code_verifier로 보안 강화

### 꼬리 질문 2: Authorization Code를 왜 사용하나요? Access Token을 바로 주면 안 되나요?

**2단계로 나눈 이유:**

1. **브라우저 노출 방지**
   - Authorization Code는 1회용이고 짧은 수명 (10분)
   - Access Token은 브라우저를 거치지 않고 Backend에서 직접 교환

2. **Client 인증**
   - Token 교환 시 `client_secret`으로 Client 검증
   - 공격자가 Code를 탈취해도 Secret 없이는 Token 발급 불가

3. **Refresh Token 발급**
   - Backend에서만 Refresh Token 저장 가능

---

## Q2. JWT와 Opaque Token의 차이점과 각각의 장단점을 설명해주세요.

### 답변

#### JWT (JSON Web Token)

**구조:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

헤더.페이로드.서명
```

**디코딩 결과:**
```json
// Header
{
  "alg": "HS256",
  "typ": "JWT"
}

// Payload
{
  "sub": "1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "roles": ["USER", "ADMIN"],
  "iat": 1516239022,
  "exp": 1516242622
}

// Signature
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  secret
)
```

**Spring Security JWT 구현:**

```java
// JwtTokenProvider.java
@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secretKey;

    @Value("${jwt.access-token-validity}")
    private long accessTokenValidity;  // 30분

    @Value("${jwt.refresh-token-validity}")
    private long refreshTokenValidity;  // 7일

    private Key key;

    @PostConstruct
    protected void init() {
        key = Keys.hmacShaKeyFor(secretKey.getBytes(StandardCharsets.UTF_8));
    }

    // Access Token 생성
    public String createAccessToken(Authentication authentication) {
        UserPrincipal userPrincipal = (UserPrincipal) authentication.getPrincipal();
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + accessTokenValidity);

        return Jwts.builder()
            .setSubject(Long.toString(userPrincipal.getId()))
            .claim("email", userPrincipal.getEmail())
            .claim("roles", userPrincipal.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toList()))
            .setIssuedAt(now)
            .setExpiration(expiryDate)
            .signWith(key, SignatureAlgorithm.HS512)
            .compact();
    }

    // Refresh Token 생성
    public String createRefreshToken() {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + refreshTokenValidity);

        return Jwts.builder()
            .setIssuedAt(now)
            .setExpiration(expiryDate)
            .signWith(key, SignatureAlgorithm.HS512)
            .compact();
    }

    // Token 검증
    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(key)
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (SecurityException | MalformedJwtException e) {
            logger.error("Invalid JWT signature");
        } catch (ExpiredJwtException e) {
            logger.error("Expired JWT token");
        } catch (UnsupportedJwtException e) {
            logger.error("Unsupported JWT token");
        } catch (IllegalArgumentException e) {
            logger.error("JWT claims string is empty");
        }
        return false;
    }

    // Token에서 사용자 정보 추출
    public Long getUserIdFromToken(String token) {
        Claims claims = Jwts.parserBuilder()
            .setSigningKey(key)
            .build()
            .parseClaimsJws(token)
            .getBody();

        return Long.parseLong(claims.getSubject());
    }
}

// JwtAuthenticationFilter.java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private JwtTokenProvider tokenProvider;

    @Autowired
    private CustomUserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            String jwt = getJwtFromRequest(request);

            if (StringUtils.hasText(jwt) && tokenProvider.validateToken(jwt)) {
                Long userId = tokenProvider.getUserIdFromToken(jwt);
                UserDetails userDetails = userDetailsService.loadUserById(userId);

                UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                        userDetails,
                        null,
                        userDetails.getAuthorities()
                    );

                authentication.setDetails(
                    new WebAuthenticationDetailsSource().buildDetails(request)
                );

                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        } catch (Exception ex) {
            logger.error("Could not set user authentication in security context", ex);
        }

        filterChain.doFilter(request, response);
    }

    private String getJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}
```

#### Opaque Token

**특징:**
- 랜덤 문자열 (예: `d5c7f3a2-8b4e-4f1a-9d6c-2e8f7b3a1c5d`)
- **자체적으로 정보를 담지 않음**
- Authorization Server에 매번 검증 요청 필요

**Introspection 예시:**
```java
// Token 검증 (Authorization Server에 요청)
POST /oauth/introspect HTTP/1.1
Host: auth-server.com
Content-Type: application/x-www-form-urlencoded

token=d5c7f3a2-8b4e-4f1a-9d6c-2e8f7b3a1c5d&
client_id=resource-server&
client_secret=secret

// 응답
{
  "active": true,
  "sub": "user-123",
  "client_id": "my-client",
  "scope": "read write",
  "exp": 1642512345,
  "authorities": ["ROLE_USER"]
}
```

#### JWT vs Opaque Token 비교

| 항목 | JWT | Opaque Token |
|------|-----|--------------|
| **구조** | Header.Payload.Signature | 랜덤 문자열 |
| **검증 방식** | 로컬 검증 (서명 확인) | Authorization Server에 Introspection 요청 |
| **상태** | Stateless | Stateful (서버에 저장) |
| **크기** | 큰 편 (500-1000 bytes) | 작음 (UUID 36 bytes) |
| **성능** | 빠름 (네트워크 불필요) | 느림 (매번 DB/Redis 조회) |
| **즉시 무효화** | 불가능 | 가능 (DB/Redis에서 삭제) |
| **정보 노출** | 디코딩 가능 (민감정보 주의) | 불가능 (서버만 해석) |
| **적합한 경우** | MSA, 트래픽 많은 서비스 | 보안 중요, 즉시 무효화 필요 |

#### 장단점

| 방식 | 장점 | 단점 |
|------|------|------|
| **JWT** | • 서버 부하 ↓ (DB 조회 불필요)<br>• MSA에서 서비스 간 인증 용이<br>• Stateless (확장성 ↑) | • 즉시 무효화 불가<br>• Payload 크기 제한<br>• 민감정보 노출 위험 |
| **Opaque Token** | • 즉시 무효화 가능<br>• 정보 노출 위험 없음<br>• 유연한 권한 관리 | • 매번 DB/Redis 조회 (성능 ↓)<br>• Authorization Server 의존성 ↑<br>• 네트워크 오버헤드 |

### 꼬리 질문 1: JWT의 즉시 무효화 문제를 어떻게 해결하나요?

**해결 방법 4가지:**

##### 1. Blacklist (Redis)

```java
@Service
public class TokenBlacklistService {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    // 로그아웃 시 Blacklist 등록
    public void addToBlacklist(String token) {
        long expirationTime = getExpirationTime(token);
        long ttl = expirationTime - System.currentTimeMillis();

        if (ttl > 0) {
            redisTemplate.opsForValue().set(
                "blacklist:" + token,
                "revoked",
                ttl,
                TimeUnit.MILLISECONDS
            );
        }
    }

    // Token 검증 시 Blacklist 확인
    public boolean isBlacklisted(String token) {
        return redisTemplate.hasKey("blacklist:" + token);
    }
}

// JwtAuthenticationFilter에서 사용
if (tokenProvider.validateToken(jwt) && !blacklistService.isBlacklisted(jwt)) {
    // 인증 처리
}
```

##### 2. 짧은 만료 시간 + Refresh Token

```java
// Access Token: 30분
// Refresh Token: 7일

@PostMapping("/refresh")
public ResponseEntity<?> refreshToken(@RequestBody RefreshTokenRequest request) {
    String refreshToken = request.getRefreshToken();

    // 1. Refresh Token 검증
    if (!tokenProvider.validateToken(refreshToken)) {
        throw new InvalidTokenException("Invalid refresh token");
    }

    // 2. DB에서 Refresh Token 조회
    RefreshToken storedToken = refreshTokenRepository
        .findByToken(refreshToken)
        .orElseThrow(() -> new TokenNotFoundException("Refresh token not found"));

    // 3. 새 Access Token 발급
    String newAccessToken = tokenProvider.createAccessToken(storedToken.getUser());

    return ResponseEntity.ok(new TokenResponse(newAccessToken, refreshToken));
}
```

##### 3. Token Versioning

```java
// User 엔티티에 tokenVersion 필드 추가
@Entity
public class User {
    @Id
    private Long id;

    @Column(nullable = false)
    private Integer tokenVersion = 0;  // 비밀번호 변경 시 증가
}

// JWT에 tokenVersion 포함
public String createAccessToken(User user) {
    return Jwts.builder()
        .claim("tokenVersion", user.getTokenVersion())
        // ...
        .compact();
}

// 검증 시 버전 확인
public boolean validateTokenVersion(String token, User user) {
    Integer tokenVersion = getTokenVersionFromToken(token);
    return tokenVersion.equals(user.getTokenVersion());
}
```

##### 4. 하이브리드 (JWT + Opaque)

```java
// Access Token: JWT (빠른 검증)
// Refresh Token: Opaque (즉시 무효화 가능)

@Entity
public class RefreshToken {
    @Id
    private String token;  // Opaque (UUID)

    @ManyToOne
    private User user;

    private LocalDateTime expiryDate;
}
```

### 꼬리 질문 2: JWT를 쿠키에 저장해야 하나요, LocalStorage에 저장해야 하나요?

| 저장 위치 | 장점 | 단점 | 보안 설정 |
|----------|------|------|----------|
| **HttpOnly Cookie** | • XSS 공격 방어<br>• JavaScript 접근 불가 | • CSRF 공격 위험<br>• 서브도메인 관리 복잡 | `HttpOnly`, `Secure`, `SameSite=Strict` |
| **LocalStorage** | • CSRF 공격 방어<br>• 구현 간단 | • XSS 공격에 취약<br>• JavaScript로 접근 가능 | CSP (Content Security Policy) |

**권장 방법: HttpOnly Cookie + CSRF Token**

```java
// Cookie에 JWT 저장
@PostMapping("/login")
public ResponseEntity<?> login(@RequestBody LoginRequest request, HttpServletResponse response) {
    // 인증 처리
    String accessToken = tokenProvider.createAccessToken(authentication);

    // HttpOnly Cookie 설정
    ResponseCookie cookie = ResponseCookie.from("accessToken", accessToken)
        .httpOnly(true)       // JavaScript 접근 불가
        .secure(true)         // HTTPS에서만 전송
        .path("/")
        .maxAge(Duration.ofMinutes(30))
        .sameSite("Strict")   // CSRF 방어
        .build();

    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());

    return ResponseEntity.ok(new LoginResponse("Login successful"));
}
```

---

## Q3. Refresh Token 관리 전략과 Refresh Token Rotation을 설명해주세요.

### 답변

#### Refresh Token 관리 전략

##### 1. DB 저장 방식

```java
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {

    @Id
    private String token;  // UUID

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private LocalDateTime expiryDate;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime lastUsedAt;

    @Column(length = 500)
    private String userAgent;  // 디바이스 추적

    private String ipAddress;

    @Column(nullable = false)
    private Boolean revoked = false;

    public boolean isExpired() {
        return LocalDateTime.now().isAfter(expiryDate);
    }
}

@Service
public class RefreshTokenService {

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Transactional
    public RefreshToken createRefreshToken(User user, HttpServletRequest request) {
        // 기존 Refresh Token 삭제 (1 User = 1 Device 정책)
        refreshTokenRepository.deleteByUser(user);

        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setToken(UUID.randomUUID().toString());
        refreshToken.setUser(user);
        refreshToken.setExpiryDate(LocalDateTime.now().plusDays(7));
        refreshToken.setCreatedAt(LocalDateTime.now());
        refreshToken.setUserAgent(request.getHeader("User-Agent"));
        refreshToken.setIpAddress(getClientIp(request));

        return refreshTokenRepository.save(refreshToken);
    }

    @Transactional
    public String refreshAccessToken(String refreshTokenValue) {
        RefreshToken refreshToken = refreshTokenRepository.findByToken(refreshTokenValue)
            .orElseThrow(() -> new TokenNotFoundException("Refresh token not found"));

        // 1. 만료 확인
        if (refreshToken.isExpired()) {
            throw new TokenExpiredException("Refresh token expired");
        }

        // 2. 무효화 확인
        if (refreshToken.getRevoked()) {
            throw new TokenRevokedException("Refresh token revoked");
        }

        // 3. 마지막 사용 시간 업데이트
        refreshToken.setLastUsedAt(LocalDateTime.now());
        refreshTokenRepository.save(refreshToken);

        // 4. 새 Access Token 발급
        return jwtTokenProvider.createAccessToken(refreshToken.getUser());
    }

    @Transactional
    public void revokeToken(String token) {
        RefreshToken refreshToken = refreshTokenRepository.findByToken(token)
            .orElseThrow(() -> new TokenNotFoundException("Token not found"));

        refreshToken.setRevoked(true);
        refreshTokenRepository.save(refreshToken);
    }
}
```

##### 2. Redis 저장 방식 (성능 최적화)

```java
@Component
public class RedisRefreshTokenStore {

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    private static final String REFRESH_TOKEN_PREFIX = "refresh_token:";
    private static final long REFRESH_TOKEN_VALIDITY = 7 * 24 * 60 * 60;  // 7일

    public void saveRefreshToken(String token, Long userId) {
        String key = REFRESH_TOKEN_PREFIX + token;

        Map<String, Object> tokenData = new HashMap<>();
        tokenData.put("userId", userId);
        tokenData.put("createdAt", System.currentTimeMillis());

        redisTemplate.opsForHash().putAll(key, tokenData);
        redisTemplate.expire(key, REFRESH_TOKEN_VALIDITY, TimeUnit.SECONDS);
    }

    public Long getUserIdFromToken(String token) {
        String key = REFRESH_TOKEN_PREFIX + token;
        Object userId = redisTemplate.opsForHash().get(key, "userId");
        return userId != null ? Long.parseLong(userId.toString()) : null;
    }

    public void deleteRefreshToken(String token) {
        String key = REFRESH_TOKEN_PREFIX + token;
        redisTemplate.delete(key);
    }
}
```

#### Refresh Token Rotation (자동 갱신)

**보안 강화를 위해 Refresh Token 사용 시마다 새로 발급**

```java
@Service
public class TokenRotationService {

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Transactional
    public TokenResponse rotateRefreshToken(String oldRefreshToken, HttpServletRequest request) {
        // 1. 기존 Refresh Token 검증
        RefreshToken refreshToken = refreshTokenRepository.findByToken(oldRefreshToken)
            .orElseThrow(() -> new TokenNotFoundException("Invalid refresh token"));

        if (refreshToken.isExpired() || refreshToken.getRevoked()) {
            // ⚠️ 이미 만료/무효화된 토큰 재사용 시도 → 보안 위협!
            // 해당 사용자의 모든 Refresh Token 무효화
            refreshTokenRepository.revokeAllByUser(refreshToken.getUser());
            throw new SecurityException("Token reuse detected. All sessions revoked.");
        }

        // 2. 기존 토큰 무효화
        refreshToken.setRevoked(true);
        refreshToken.setRevokedAt(LocalDateTime.now());
        refreshTokenRepository.save(refreshToken);

        // 3. 새 Access Token + 새 Refresh Token 발급
        String newAccessToken = jwtTokenProvider.createAccessToken(refreshToken.getUser());
        RefreshToken newRefreshToken = createRefreshToken(refreshToken.getUser(), request);

        return new TokenResponse(newAccessToken, newRefreshToken.getToken());
    }

    private RefreshToken createRefreshToken(User user, HttpServletRequest request) {
        RefreshToken newToken = new RefreshToken();
        newToken.setToken(UUID.randomUUID().toString());
        newToken.setUser(user);
        newToken.setExpiryDate(LocalDateTime.now().plusDays(7));
        newToken.setCreatedAt(LocalDateTime.now());
        newToken.setUserAgent(request.getHeader("User-Agent"));
        newToken.setIpAddress(getClientIp(request));

        return refreshTokenRepository.save(newToken);
    }
}
```

#### Token Rotation Flow

```
┌─────────┐                                    ┌────────────┐
│ Client  │                                    │   Server   │
└────┬────┘                                    └─────┬──────┘
     │                                               │
     │  1. Refresh Token (old_token_123)            │
     │──────────────────────────────────────────────>│
     │                                               │
     │                                          2. 검증 & 무효화
     │                                               │
     │  3. 새 Access Token + 새 Refresh Token        │
     │<──────────────────────────────────────────────│
     │    (new_access_token, new_refresh_token_456)  │
     │                                               │
     │  4. 이후 갱신 시 new_refresh_token_456 사용   │
     │──────────────────────────────────────────────>│
     │                                               │
     │  ⚠️ old_token_123 재사용 시도                 │
     │──────────────────────────────────────────────>│
     │                                               │
     │                                          5. 탈취 감지!
     │                                          → 모든 토큰 무효화
     │  6. 401 Unauthorized                          │
     │<──────────────────────────────────────────────│
```

### 꼬리 질문 1: 디바이스별 Refresh Token 관리는 어떻게 하나요?

```java
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {
    @Id
    private String token;

    @ManyToOne
    private User user;

    @Column(name = "device_id")
    private String deviceId;  // UUID로 디바이스 식별

    private String deviceName;  // "iPhone 13", "Chrome on MacBook"
}

@Service
public class MultiDeviceTokenService {

    @Transactional
    public TokenResponse createToken(User user, String deviceId, String deviceName) {
        // 해당 디바이스의 기존 토큰만 삭제
        refreshTokenRepository.deleteByUserAndDeviceId(user, deviceId);

        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setUser(user);
        refreshToken.setDeviceId(deviceId);
        refreshToken.setDeviceName(deviceName);
        // ...

        return new TokenResponse(accessToken, refreshToken.getToken());
    }

    // 사용자의 모든 활성 디바이스 조회
    public List<DeviceSession> getActiveSessions(User user) {
        return refreshTokenRepository.findActiveByUser(user).stream()
            .map(token -> new DeviceSession(
                token.getDeviceId(),
                token.getDeviceName(),
                token.getLastUsedAt(),
                token.getIpAddress()
            ))
            .collect(Collectors.toList());
    }

    // 특정 디바이스 로그아웃
    @Transactional
    public void revokeDevice(User user, String deviceId) {
        refreshTokenRepository.deleteByUserAndDeviceId(user, deviceId);
    }
}
```

### 꼬리 질문 2: Refresh Token도 탈취당하면 어떻게 하나요?

**보안 강화 방법:**

1. **IP/User-Agent 검증**
```java
public void validateRefreshToken(RefreshToken token, HttpServletRequest request) {
    String currentIp = getClientIp(request);
    String currentUserAgent = request.getHeader("User-Agent");

    if (!token.getIpAddress().equals(currentIp)) {
        logger.warn("IP mismatch. Original: {}, Current: {}",
            token.getIpAddress(), currentIp);
        // 알림 전송 또는 추가 인증 요구
    }
}
```

2. **Refresh Token 재사용 감지 (Rotation)**
```java
// 이미 무효화된 토큰 재사용 시도 → 탈취 의심
if (refreshToken.getRevoked()) {
    // 해당 사용자의 모든 세션 무효화
    refreshTokenRepository.revokeAllByUser(user);
    // 사용자에게 알림 전송
    notificationService.sendSecurityAlert(user);
    throw new SecurityException("Token reuse detected");
}
```

3. **짧은 만료 시간**
```java
// Refresh Token 만료 시간: 7일 → 24시간으로 단축
private static final long REFRESH_TOKEN_VALIDITY = 24 * 60 * 60;
```

---

## Q4. Spring Security OAuth2 Resource Server 구현 방법을 설명해주세요.

### 답변

**Resource Server**: Access Token을 검증하고 보호된 리소스(API)를 제공하는 서버

#### JWT 방식 Resource Server

```java
// application.yml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://auth-server.com
          # 또는 직접 공개키 지정
          jwk-set-uri: https://auth-server.com/.well-known/jwks.json

// SecurityConfig.java
@Configuration
@EnableWebSecurity
public class ResourceServerConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/admin/**").hasAuthority("SCOPE_admin")
                .requestMatchers("/api/user/**").hasAuthority("SCOPE_read")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );

        return http.build();
    }

    // JWT → Authentication 변환
    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter grantedAuthoritiesConverter =
            new JwtGrantedAuthoritiesConverter();

        // JWT의 "authorities" claim을 권한으로 변환
        grantedAuthoritiesConverter.setAuthoritiesClaimName("authorities");
        grantedAuthoritiesConverter.setAuthorityPrefix("ROLE_");

        JwtAuthenticationConverter jwtAuthenticationConverter =
            new JwtAuthenticationConverter();
        jwtAuthenticationConverter.setJwtGrantedAuthoritiesConverter(
            grantedAuthoritiesConverter
        );

        return jwtAuthenticationConverter;
    }
}

// Controller
@RestController
@RequestMapping("/api")
public class ResourceController {

    // 인증된 사용자만 접근
    @GetMapping("/user/profile")
    public ResponseEntity<?> getUserProfile(@AuthenticationPrincipal Jwt jwt) {
        String userId = jwt.getSubject();
        String email = jwt.getClaim("email");
        List<String> roles = jwt.getClaim("roles");

        return ResponseEntity.ok(new UserProfile(userId, email, roles));
    }

    // ADMIN 권한 필요
    @GetMapping("/admin/users")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> getAllUsers() {
        return ResponseEntity.ok(userService.findAll());
    }

    // Custom 권한 확인
    @GetMapping("/orders/{orderId}")
    public ResponseEntity<?> getOrder(@PathVariable Long orderId,
                                      @AuthenticationPrincipal Jwt jwt) {
        Long userId = Long.parseLong(jwt.getSubject());

        Order order = orderService.findById(orderId);

        // 주문 소유자 확인
        if (!order.getUserId().equals(userId)) {
            throw new AccessDeniedException("Not authorized to view this order");
        }

        return ResponseEntity.ok(order);
    }
}
```

#### Opaque Token 방식 Resource Server

```java
// application.yml
spring:
  security:
    oauth2:
      resourceserver:
        opaquetoken:
          introspection-uri: https://auth-server.com/oauth/introspect
          client-id: resource-server
          client-secret: resource-server-secret

// SecurityConfig.java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests(authorize -> authorize
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer(oauth2 -> oauth2
            .opaqueToken(Customizer.withDefaults())  // Opaque Token 검증
        );

    return http.build();
}

// Custom Introspector (캐싱 추가)
@Component
public class CachingOpaqueTokenIntrospector implements OpaqueTokenIntrospector {

    @Autowired
    private RedisTemplate<String, OAuth2AuthenticatedPrincipal> redisTemplate;

    private final OpaqueTokenIntrospector delegate;

    public CachingOpaqueTokenIntrospector(
            @Value("${spring.security.oauth2.resourceserver.opaquetoken.introspection-uri}")
            String introspectionUri,
            @Value("${spring.security.oauth2.resourceserver.opaquetoken.client-id}")
            String clientId,
            @Value("${spring.security.oauth2.resourceserver.opaquetoken.client-secret}")
            String clientSecret) {
        this.delegate = new SpringOpaqueTokenIntrospector(
            introspectionUri, clientId, clientSecret
        );
    }

    @Override
    public OAuth2AuthenticatedPrincipal introspect(String token) {
        // 1. 캐시 확인
        String cacheKey = "token_introspection:" + token;
        OAuth2AuthenticatedPrincipal cached = redisTemplate.opsForValue().get(cacheKey);

        if (cached != null) {
            return cached;
        }

        // 2. Authorization Server에 검증 요청
        OAuth2AuthenticatedPrincipal principal = delegate.introspect(token);

        // 3. 캐싱 (30분)
        redisTemplate.opsForValue().set(
            cacheKey,
            principal,
            30,
            TimeUnit.MINUTES
        );

        return principal;
    }
}
```

### 꼬리 질문 1: MSA 환경에서 각 서비스마다 JWT를 검증해야 하나요?

**해결 방법 2가지:**

##### 1. API Gateway에서 검증

```
┌────────┐      ┌────────────┐      ┌──────────┐
│ Client │─────>│ API Gateway│─────>│ Service A│
└────────┘  JWT └─────┬──────┘ User └──────────┘
                      │         Info
                      │              ┌──────────┐
                      └─────────────>│ Service B│
                                User └──────────┘
                                Info
```

```java
// API Gateway (Spring Cloud Gateway)
@Component
public class JwtAuthenticationFilter implements GlobalFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = extractToken(exchange.getRequest());

        if (token != null && jwtTokenProvider.validateToken(token)) {
            Long userId = jwtTokenProvider.getUserIdFromToken(token);
            List<String> roles = jwtTokenProvider.getRolesFromToken(token);

            // 검증된 사용자 정보를 Header에 추가
            ServerHttpRequest modifiedRequest = exchange.getRequest().mutate()
                .header("X-User-Id", userId.toString())
                .header("X-User-Roles", String.join(",", roles))
                .build();

            return chain.filter(exchange.mutate().request(modifiedRequest).build());
        }

        return unauthorized(exchange);
    }
}

// Service A (JWT 검증 불필요)
@RestController
public class ServiceAController {

    @GetMapping("/orders")
    public List<Order> getOrders(@RequestHeader("X-User-Id") Long userId,
                                  @RequestHeader("X-User-Roles") String roles) {
        // Gateway에서 검증된 사용자 정보 사용
        return orderService.findByUserId(userId);
    }
}
```

##### 2. 각 서비스에서 검증 (JWT 공개키 공유)

```java
// 모든 서비스에 동일한 공개키 설정
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          public-key-location: classpath:public-key.pem
```

**장점**: Gateway 장애 시에도 각 서비스가 독립적으로 동작

### 꼬리 질문 2: JWT 공개키 Rotation은 어떻게 처리하나요?

**JWK Set (JSON Web Key Set) 사용:**

```java
// Authorization Server
@RestController
public class JwkSetController {

    @GetMapping("/.well-known/jwks.json")
    public Map<String, Object> keys() {
        RSAPublicKey publicKey = (RSAPublicKey) keyPair.getPublic();

        Map<String, Object> jwk = new HashMap<>();
        jwk.put("kty", "RSA");
        jwk.put("kid", "key-2025-01");  // Key ID
        jwk.put("use", "sig");
        jwk.put("n", Base64.getUrlEncoder().encodeToString(publicKey.getModulus().toByteArray()));
        jwk.put("e", Base64.getUrlEncoder().encodeToString(publicKey.getPublicExponent().toByteArray()));

        return Map.of("keys", List.of(jwk));
    }
}

// Resource Server (자동 갱신)
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: https://auth-server.com/.well-known/jwks.json
          # Spring Security가 주기적으로 jwk-set-uri 호출하여 공개키 갱신
```

**Key Rotation 전략:**
1. 새 키 생성 (`key-2025-02`)
2. JWK Set에 새 키 추가 (기존 키 유지)
3. 새 JWT는 `key-2025-02`로 서명
4. 기존 JWT 만료 후 `key-2025-01` 제거

---

## Q5. 실무에서 경험한 OAuth2 인증/인가 관련 장애 사례와 해결 방법을 설명해주세요.

### 답변

#### 사례 1: Refresh Token 탈취로 인한 계정 탈취 시도

**상황:**
- 사용자 신고: "내가 로그인하지 않은 디바이스에서 로그인되었다"
- 로그 분석 결과: Refresh Token이 다른 IP에서 사용됨

**원인:**
- XSS 취약점으로 LocalStorage의 Refresh Token 탈취
- 공격자가 탈취한 Refresh Token으로 새 Access Token 발급

**해결 방법:**

```java
// 1. Refresh Token을 HttpOnly Cookie로 이전
@PostMapping("/login")
public ResponseEntity<?> login(@RequestBody LoginRequest request,
                                HttpServletResponse response) {
    // Access Token: Response Body (짧은 만료)
    String accessToken = tokenProvider.createAccessToken(user);

    // Refresh Token: HttpOnly Cookie (JavaScript 접근 불가)
    String refreshToken = tokenProvider.createRefreshToken();
    ResponseCookie cookie = ResponseCookie.from("refreshToken", refreshToken)
        .httpOnly(true)
        .secure(true)
        .sameSite("Strict")
        .path("/api/auth/refresh")  // 특정 경로만 전송
        .maxAge(Duration.ofDays(7))
        .build();

    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());

    return ResponseEntity.ok(new LoginResponse(accessToken));
}

// 2. IP/User-Agent 검증 추가
@Service
public class RefreshTokenSecurityService {

    public void validateRefreshToken(RefreshToken token, HttpServletRequest request) {
        String currentIp = getClientIp(request);
        String currentUserAgent = request.getHeader("User-Agent");

        // IP 변경 감지
        if (!token.getIpAddress().equals(currentIp)) {
            logger.warn("IP changed. Original: {}, Current: {}",
                token.getIpAddress(), currentIp);

            // 사용자에게 이메일/SMS 알림
            notificationService.sendSecurityAlert(
                token.getUser(),
                "New login from different IP: " + currentIp
            );

            // 추가 인증 요구 (2FA)
            throw new AdditionalAuthenticationRequiredException("Please verify your identity");
        }

        // User-Agent 변경 감지 (디바이스 변경)
        if (!token.getUserAgent().equals(currentUserAgent)) {
            logger.warn("User-Agent changed");
            // 추가 검증 로직
        }
    }
}

// 3. Refresh Token Rotation 구현
@Transactional
public TokenResponse rotateRefreshToken(String oldToken) {
    RefreshToken refreshToken = findByToken(oldToken);

    // 이미 무효화된 토큰 재사용 → 탈취 의심
    if (refreshToken.getRevoked()) {
        // 해당 사용자의 모든 세션 무효화
        refreshTokenRepository.revokeAllByUser(refreshToken.getUser());

        // 즉시 알림
        alertService.sendCriticalSecurityAlert(refreshToken.getUser());

        throw new SecurityException("Token reuse detected. All sessions revoked.");
    }

    // 기존 토큰 무효화
    refreshToken.setRevoked(true);

    // 새 토큰 발급
    String newAccessToken = createAccessToken(refreshToken.getUser());
    String newRefreshToken = createRefreshToken(refreshToken.getUser());

    return new TokenResponse(newAccessToken, newRefreshToken);
}
```

**결과:**
- XSS 취약점 패치 (CSP 헤더 추가)
- Refresh Token을 HttpOnly Cookie로 이전
- 의심스러운 활동 모니터링 강화

#### 사례 2: Authorization Server 장애로 Resource Server 전체 다운

**상황:**
- Authorization Server (Keycloak) 장애 발생
- 모든 Resource Server가 Token 검증 실패 → 503 에러

**원인:**
- Opaque Token 사용으로 매 요청마다 Introspection 호출
- Authorization Server 장애 시 Resource Server 전부 영향

**해결 방법:**

```java
// 1. Opaque Token → JWT로 전환
// Resource Server가 로컬에서 검증 가능

// 2. Introspection 결과 캐싱 (임시 조치)
@Component
public class ResilientOpaqueTokenIntrospector implements OpaqueTokenIntrospector {

    @Autowired
    private RedisTemplate<String, IntrospectionResult> redisTemplate;

    private final OpaqueTokenIntrospector delegate;

    @Override
    public OAuth2AuthenticatedPrincipal introspect(String token) {
        String cacheKey = "introspection:" + token;

        // 1. 캐시 확인
        IntrospectionResult cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            return cached.getPrincipal();
        }

        try {
            // 2. Authorization Server 호출
            OAuth2AuthenticatedPrincipal principal = delegate.introspect(token);

            // 3. 캐싱
            long ttl = getTokenExpiration(principal) - System.currentTimeMillis();
            redisTemplate.opsForValue().set(
                cacheKey,
                new IntrospectionResult(principal, System.currentTimeMillis() + ttl),
                ttl,
                TimeUnit.MILLISECONDS
            );

            return principal;

        } catch (Exception e) {
            logger.error("Introspection failed", e);

            // 4. Fallback: 캐시된 결과 사용 (만료되었어도)
            if (cached != null) {
                logger.warn("Using expired cache due to introspection failure");
                return cached.getPrincipal();
            }

            throw e;
        }
    }
}

// 3. Circuit Breaker 추가
@Component
public class CircuitBreakerIntrospector implements OpaqueTokenIntrospector {

    private final OpaqueTokenIntrospector delegate;
    private final CircuitBreakerRegistry circuitBreakerRegistry;

    @Override
    public OAuth2AuthenticatedPrincipal introspect(String token) {
        CircuitBreaker circuitBreaker = circuitBreakerRegistry.circuitBreaker("introspection");

        return circuitBreaker.executeSupplier(() -> delegate.introspect(token));
    }
}

// application.yml
resilience4j:
  circuitbreaker:
    instances:
      introspection:
        failureRateThreshold: 50
        waitDurationInOpenState: 10000
        slidingWindowSize: 10
```

**결과:**
- JWT 도입으로 Authorization Server 의존성 제거
- Introspection 캐싱으로 성능 30% 향상
- Circuit Breaker로 장애 전파 방지

#### 사례 3: JWT Secret Key 노출 사고

**상황:**
- GitHub에 JWT Secret Key가 포함된 application.yml 커밋
- 공격자가 임의의 JWT 생성 가능

**해결 방법:**

```java
// 1. 즉시 Secret Key Rotation
@Component
public class JwtKeyRotationService {

    private List<SecretKey> keys = new ArrayList<>();
    private int currentKeyIndex = 0;

    @PostConstruct
    public void init() {
        // 새 키 생성
        rotateKey();
    }

    public void rotateKey() {
        SecretKey newKey = Keys.secretKeyFor(SignatureAlgorithm.HS512);
        keys.add(newKey);
        currentKeyIndex = keys.size() - 1;

        logger.info("Key rotated. Current key index: {}", currentKeyIndex);
    }

    // 최신 키로 서명
    public String createToken(Authentication authentication) {
        SecretKey currentKey = keys.get(currentKeyIndex);

        return Jwts.builder()
            .setHeaderParam("kid", String.valueOf(currentKeyIndex))  // Key ID
            .setSubject(authentication.getName())
            .signWith(currentKey)
            .compact();
    }

    // 모든 키로 검증 시도
    public boolean validateToken(String token) {
        String kid = getKeyIdFromToken(token);
        int keyIndex = Integer.parseInt(kid);

        if (keyIndex >= keys.size()) {
            return false;
        }

        SecretKey key = keys.get(keyIndex);

        try {
            Jwts.parserBuilder()
                .setSigningKey(key)
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}

// 2. 환경 변수로 Secret 관리
// application.yml
spring:
  security:
    jwt:
      secret: ${JWT_SECRET}  # 환경 변수에서 주입

// 3. AWS Secrets Manager 사용
@Configuration
public class SecretsManagerConfig {

    @Bean
    public String jwtSecret() {
        AWSSecretsManager client = AWSSecretsManagerClientBuilder.standard()
            .withRegion(Regions.AP_NORTHEAST_2)
            .build();

        GetSecretValueRequest request = new GetSecretValueRequest()
            .withSecretId("prod/jwt/secret");

        GetSecretValueResult result = client.getSecretValue(request);
        return result.getSecretString();
    }
}
```

**예방 조치:**
- `.gitignore`에 `application-*.yml` 추가
- Git pre-commit hook으로 Secret 검사
- GitHub Secret Scanning 활성화

---

## 요약 체크리스트

### OAuth2 핵심 개념
- [ ] OAuth2는 **인가(Authorization) 프로토콜**이지 인증이 아님
- [ ] 4가지 역할: Resource Owner, Client, Authorization Server, Resource Server
- [ ] Grant Type: Authorization Code (권장), Implicit (Deprecated), Password, Client Credentials

### JWT vs Opaque Token
- [ ] JWT: Stateless, 로컬 검증 가능, 즉시 무효화 불가
- [ ] Opaque Token: Stateful, Introspection 필요, 즉시 무효화 가능
- [ ] JWT 무효화 방법: Blacklist, 짧은 만료 시간, Token Versioning

### Refresh Token 관리
- [ ] DB 또는 Redis에 저장하여 즉시 무효화 가능
- [ ] Refresh Token Rotation으로 탈취 감지
- [ ] 디바이스별 관리로 세션 제어
- [ ] IP/User-Agent 검증으로 보안 강화

### Spring Security 구현
- [ ] Authorization Server: OAuth2 인증 서버 구현
- [ ] Resource Server: JWT 또는 Opaque Token 검증
- [ ] MSA: API Gateway 검증 또는 각 서비스 독립 검증
- [ ] JWK Set으로 공개키 자동 Rotation

### 보안 모범 사례
- [ ] Refresh Token: HttpOnly Cookie + SameSite=Strict
- [ ] Access Token: 짧은 만료 시간 (30분)
- [ ] PKCE: SPA/모바일 앱 필수
- [ ] Secret Key: 환경 변수 또는 Secrets Manager
- [ ] 의심 활동 모니터링 및 알림
