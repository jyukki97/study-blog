---
title: "OAuth2 인증 (Part 2: JWT/Token, 보안 심화)"
study_order: 713
date: 2025-12-01
topic: "Security"
tags: ["OAuth2", "인증", "보안", "Spring Security", "JWT", "Token"]
categories: ["Security"]
series: ["핵심 개념 Q&A"]
series_order: 17
draft: false
module: "qna"
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

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: OAuth2 인증 (Part 1: OAuth2 흐름과 기초)](/learning/qna/oauth2-authentication-qna/)**
