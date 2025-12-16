---
title: "Spring Security 기본: Filter Chain, JWT, OAuth2 감각"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["Spring Security", "Authentication", "Authorization", "JWT", "OAuth2"]
categories: ["Backend Deep Dive"]
description: "Security Filter Chain 흐름을 잡고, JWT/OAuth2를 언제 어떻게 쓰는지 실무 기준으로 정리"
module: "spring-core"
study_order: 155
---

## 이 글에서 얻는 것

- Spring Security의 핵심 흐름(Security Filter Chain)을 잡고, 인증/인가가 어디에서 결정되는지 설명할 수 있습니다.
- 세션 기반/토큰 기반(JWT) 인증을 구분하고, Refresh Token/회수/만료 같은 운영 이슈를 고려할 수 있습니다.
- OAuth2 Authorization Code 흐름을 이해하고, “왜 PKCE가 필요한지” 같은 실무 질문에 답할 수 있습니다.

## 들어가며

Spring Security는 인증(Authentication)과 인가(Authorization)를 제공하는 강력한 보안 프레임워크입니다. 이 글에서는 Security Filter Chain부터 JWT, OAuth2까지 실전에 필요한 모든 내용을 다룹니다.

**난이도**: ⭐⭐⭐ 심화
**예상 학습 시간**: 50분

---

## 1. Spring Security 아키텍처

### 1.1 Security Filter Chain 구조

```
HTTP 요청
    ↓
┌─────────────────────────────────────────────┐
│ Security Filter Chain (순서대로 실행)          │
├─────────────────────────────────────────────┤
│ 1. SecurityContextPersistenceFilter          │
│    - SecurityContext 로드/저장                │
│                                             │
│ 2. LogoutFilter                             │
│    - 로그아웃 요청 처리                        │
│                                             │
│ 3. UsernamePasswordAuthenticationFilter     │
│    - Form 로그인 처리                         │
│                                             │
│ 4. BasicAuthenticationFilter                │
│    - HTTP Basic 인증                         │
│                                             │
│ 5. BearerTokenAuthenticationFilter          │
│    - JWT 토큰 검증                            │
│                                             │
│ 6. ExceptionTranslationFilter               │
│    - 인증/인가 예외 처리                       │
│                                             │
│ 7. FilterSecurityInterceptor                │
│    - 최종 인가 결정                            │
└─────────────────────────────────────────────┘
    ↓
Controller
```

### 1.2 핵심 컴포넌트

```java
// 1. SecurityContext - 인증 정보 저장소
SecurityContext context = SecurityContextHolder.getContext();
Authentication authentication = context.getAuthentication();

// 2. Authentication - 인증 주체
public interface Authentication extends Principal {
    Collection<? extends GrantedAuthority> getAuthorities();  // 권한
    Object getCredentials();  // 비밀번호
    Object getPrincipal();    // 사용자 정보 (UserDetails)
    boolean isAuthenticated();
}

// 3. UserDetails - 사용자 정보
public interface UserDetails {
    String getUsername();
    String getPassword();
    Collection<? extends GrantedAuthority> getAuthorities();
    boolean isAccountNonExpired();
    boolean isAccountNonLocked();
    boolean isCredentialsNonExpired();
    boolean isEnabled();
}

// 4. UserDetailsService - 사용자 조회
public interface UserDetailsService {
    UserDetails loadUserByUsername(String username) throws UsernameNotFoundException;
}

// 5. AuthenticationManager - 인증 처리
public interface AuthenticationManager {
    Authentication authenticate(Authentication authentication)
        throws AuthenticationException;
}
```

---

## 2. Form 로그인 구현

### 2.1 기본 설정

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/login", "/signup").permitAll()  // 인증 불필요
                .requestMatchers("/admin/**").hasRole("ADMIN")           // ADMIN 권한
                .anyRequest().authenticated()                            // 나머지는 인증 필요
            )
            .formLogin(form -> form
                .loginPage("/login")                  // 커스텀 로그인 페이지
                .loginProcessingUrl("/login/process") // 로그인 처리 URL
                .defaultSuccessUrl("/dashboard")      // 로그인 성공 시 이동
                .failureUrl("/login?error=true")      // 로그인 실패 시 이동
                .usernameParameter("email")           // username 파라미터명 변경
                .passwordParameter("pwd")             // password 파라미터명 변경
            )
            .logout(logout -> logout
                .logoutUrl("/logout")
                .logoutSuccessUrl("/")
                .invalidateHttpSession(true)          // 세션 무효화
                .deleteCookies("JSESSIONID")          // 쿠키 삭제
            )
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                .maximumSessions(1)                   // 동시 세션 1개로 제한
                .maxSessionsPreventsLogin(true)       // 새 로그인 차단
            );

        return http.build();
    }
}
```

### 2.2 UserDetailsService 구현

```java
@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // 1. DB에서 사용자 조회
        User user = userRepository.findByEmail(username)
            .orElseThrow(() -> new UsernameNotFoundException("사용자를 찾을 수 없습니다: " + username));

        // 2. UserDetails 구현체 반환
        return org.springframework.security.core.userdetails.User.builder()
            .username(user.getEmail())
            .password(user.getPassword())  // 이미 BCrypt로 암호화됨
            .roles(user.getRoles().toArray(new String[0]))
            .accountExpired(false)
            .accountLocked(false)
            .credentialsExpired(false)
            .disabled(false)
            .build();
    }
}

// 또는 UserDetails 직접 구현
@Entity
@Table(name = "users")
public class User implements UserDetails {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String email;

    @Column(nullable = false)
    private String password;

    @ElementCollection(fetch = FetchType.EAGER)
    @Enumerated(EnumType.STRING)
    private Set<Role> roles = new HashSet<>();

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return roles.stream()
            .map(role -> new SimpleGrantedAuthority("ROLE_" + role.name()))
            .collect(Collectors.toList());
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }
}
```

### 2.3 PasswordEncoder 설정

```java
@Configuration
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt 사용 (strength: 10 ~ 12 권장)
        return new BCryptPasswordEncoder(12);
    }
}

// 사용 예시
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public void signup(SignupRequest request) {
        // 비밀번호 암호화
        String encodedPassword = passwordEncoder.encode(request.getPassword());

        User user = User.builder()
            .email(request.getEmail())
            .password(encodedPassword)
            .roles(Set.of(Role.USER))
            .build();

        userRepository.save(user);
    }

    public boolean login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
            .orElseThrow(() -> new UsernameNotFoundException("사용자 없음"));

        // 비밀번호 검증
        return passwordEncoder.matches(request.getPassword(), user.getPassword());
    }
}
```

---

## 3. JWT (JSON Web Token) 인증

### 3.1 JWT 구조

```
JWT = Header.Payload.Signature

예시:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyQGV4YW1wbGUuY29tIiwicm9sZXMiOlsiVVNFUiJdLCJleHAiOjE3MDYyNTYwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

디코딩:
┌─────────────────────────────────────┐
│ Header (Base64)                      │
│ {                                   │
│   "alg": "HS256",                   │
│   "typ": "JWT"                      │
│ }                                   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Payload (Base64)                     │
│ {                                   │
│   "sub": "user@example.com",        │
│   "roles": ["USER"],                │
│   "exp": 1706256000                 │
│ }                                   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Signature (HMACSHA256)               │
│ HMACSHA256(                         │
│   base64UrlEncode(header) + "." +   │
│   base64UrlEncode(payload),         │
│   secret                            │
│ )                                   │
└─────────────────────────────────────┘
```

### 3.2 JWT 유틸리티 클래스

```java
@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secretKey;

    @Value("${jwt.access-token-validity}")
    private long accessTokenValidityInMs;  // 15분

    @Value("${jwt.refresh-token-validity}")
    private long refreshTokenValidityInMs;  // 7일

    private Key getSigningKey() {
        byte[] keyBytes = Decoders.BASE64.decode(secretKey);
        return Keys.hmacShaKeyFor(keyBytes);
    }

    // Access Token 생성
    public String generateAccessToken(Authentication authentication) {
        UserDetails userDetails = (UserDetails) authentication.getPrincipal();

        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + accessTokenValidityInMs);

        return Jwts.builder()
            .setSubject(userDetails.getUsername())
            .claim("roles", userDetails.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toList()))
            .setIssuedAt(now)
            .setExpiration(expiryDate)
            .signWith(getSigningKey(), SignatureAlgorithm.HS512)
            .compact();
    }

    // Refresh Token 생성
    public String generateRefreshToken(String username) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + refreshTokenValidityInMs);

        return Jwts.builder()
            .setSubject(username)
            .setIssuedAt(now)
            .setExpiration(expiryDate)
            .signWith(getSigningKey(), SignatureAlgorithm.HS512)
            .compact();
    }

    // Token에서 사용자 이름 추출
    public String getUsernameFromToken(String token) {
        Claims claims = Jwts.parserBuilder()
            .setSigningKey(getSigningKey())
            .build()
            .parseClaimsJws(token)
            .getBody();

        return claims.getSubject();
    }

    // Token에서 권한 추출
    public List<String> getRolesFromToken(String token) {
        Claims claims = Jwts.parserBuilder()
            .setSigningKey(getSigningKey())
            .build()
            .parseClaimsJws(token)
            .getBody();

        return claims.get("roles", List.class);
    }

    // Token 유효성 검증
    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(getSigningKey())
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (SecurityException | MalformedJwtException e) {
            log.error("잘못된 JWT 서명입니다.");
        } catch (ExpiredJwtException e) {
            log.error("만료된 JWT 토큰입니다.");
        } catch (UnsupportedJwtException e) {
            log.error("지원되지 않는 JWT 토큰입니다.");
        } catch (IllegalArgumentException e) {
            log.error("JWT 토큰이 잘못되었습니다.");
        }
        return false;
    }
}
```

### 3.3 JWT Authentication Filter

```java
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {

        try {
            // 1. Request Header에서 JWT 추출
            String jwt = getJwtFromRequest(request);

            // 2. Token 유효성 검증
            if (StringUtils.hasText(jwt) && jwtTokenProvider.validateToken(jwt)) {

                // 3. Token에서 사용자 정보 추출
                String username = jwtTokenProvider.getUsernameFromToken(jwt);

                // 4. UserDetails 조회
                UserDetails userDetails = userDetailsService.loadUserByUsername(username);

                // 5. Authentication 객체 생성
                UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                        userDetails,
                        null,
                        userDetails.getAuthorities()
                    );

                authentication.setDetails(
                    new WebAuthenticationDetailsSource().buildDetails(request)
                );

                // 6. SecurityContext에 저장
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        } catch (Exception e) {
            log.error("인증 정보를 설정할 수 없습니다", e);
        }

        filterChain.doFilter(request, response);
    }

    private String getJwtFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");

        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);  // "Bearer " 제거
        }

        return null;
    }
}
```

### 3.4 JWT Security 설정

```java
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class JwtSecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())  // JWT 사용 시 CSRF 불필요
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)  // 세션 사용 안 함
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()  // 로그인/회원가입
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            // JWT 필터 추가 (UsernamePasswordAuthenticationFilter 앞에)
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(exception -> exception
                .authenticationEntryPoint((request, response, authException) -> {
                    response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized");
                })
            );

        return http.build();
    }
}
```

### 3.5 로그인/토큰 발급 API

```java
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final JwtTokenProvider jwtTokenProvider;
    private final RefreshTokenService refreshTokenService;

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@RequestBody LoginRequest request) {
        // 1. 인증
        Authentication authentication = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.getEmail(),
                request.getPassword()
            )
        );

        // 2. SecurityContext에 저장
        SecurityContextHolder.getContext().setAuthentication(authentication);

        // 3. Access Token 생성
        String accessToken = jwtTokenProvider.generateAccessToken(authentication);

        // 4. Refresh Token 생성 및 저장
        String refreshToken = jwtTokenProvider.generateRefreshToken(request.getEmail());
        refreshTokenService.save(request.getEmail(), refreshToken);

        return ResponseEntity.ok(TokenResponse.of(accessToken, refreshToken));
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@RequestBody RefreshTokenRequest request) {
        String refreshToken = request.getRefreshToken();

        // 1. Refresh Token 유효성 검증
        if (!jwtTokenProvider.validateToken(refreshToken)) {
            throw new InvalidTokenException("유효하지 않은 Refresh Token입니다");
        }

        // 2. DB에서 Refresh Token 확인
        String username = jwtTokenProvider.getUsernameFromToken(refreshToken);
        if (!refreshTokenService.exists(username, refreshToken)) {
            throw new InvalidTokenException("만료되거나 삭제된 Refresh Token입니다");
        }

        // 3. 새 Access Token 발급
        UserDetails userDetails = userDetailsService.loadUserByUsername(username);
        Authentication authentication = new UsernamePasswordAuthenticationToken(
            userDetails, null, userDetails.getAuthorities()
        );

        String newAccessToken = jwtTokenProvider.generateAccessToken(authentication);

        return ResponseEntity.ok(TokenResponse.of(newAccessToken, refreshToken));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@RequestBody LogoutRequest request) {
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();

        // Refresh Token 삭제
        refreshTokenService.delete(username);

        return ResponseEntity.ok().build();
    }
}
```

### 3.6 Refresh Token 관리

```java
@Entity
@Table(name = "refresh_tokens")
@Getter
@NoArgsConstructor
public class RefreshToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String username;

    @Column(nullable = false, length = 500)
    private String token;

    @Column(nullable = false)
    private LocalDateTime expiryDate;

    public static RefreshToken of(String username, String token, LocalDateTime expiryDate) {
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.username = username;
        refreshToken.token = token;
        refreshToken.expiryDate = expiryDate;
        return refreshToken;
    }

    public boolean isExpired() {
        return LocalDateTime.now().isAfter(expiryDate);
    }
}

@Service
@RequiredArgsConstructor
public class RefreshTokenService {

    private final RefreshTokenRepository refreshTokenRepository;

    @Value("${jwt.refresh-token-validity}")
    private long refreshTokenValidityInMs;

    public void save(String username, String token) {
        LocalDateTime expiryDate = LocalDateTime.now()
            .plusSeconds(refreshTokenValidityInMs / 1000);

        RefreshToken refreshToken = RefreshToken.of(username, token, expiryDate);

        // 기존 토큰 삭제 후 저장
        refreshTokenRepository.deleteByUsername(username);
        refreshTokenRepository.save(refreshToken);
    }

    public boolean exists(String username, String token) {
        return refreshTokenRepository.findByUsername(username)
            .map(rt -> rt.getToken().equals(token) && !rt.isExpired())
            .orElse(false);
    }

    public void delete(String username) {
        refreshTokenRepository.deleteByUsername(username);
    }

    // 만료된 토큰 정리 (스케줄러)
    @Scheduled(cron = "0 0 2 * * *")  // 매일 새벽 2시
    public void deleteExpiredTokens() {
        refreshTokenRepository.deleteByExpiryDateBefore(LocalDateTime.now());
    }
}
```

---

## 4. OAuth2 소셜 로그인

### 4.1 OAuth2 흐름 (Authorization Code Grant)

```
사용자                  클라이언트              인증 서버            리소스 서버
  │                       │                    │                   │
  ├─ 1. 로그인 요청 ────→│                    │                   │
  │                       │                    │                   │
  │←─ 2. 인증 서버 리다이렉트 ─┤                │                   │
  │                       │                    │                   │
  ├─ 3. 로그인 & 권한 동의 ────────────────────→│                   │
  │                       │                    │                   │
  │←─ 4. Authorization Code ──────────────────┤                   │
  │                       │                    │                   │
  ├─ 5. Code 전달 ──────→│                    │                   │
  │                       │                    │                   │
  │                       ├─ 6. Token 요청 ────→│                   │
  │                       │   (Code + Secret)  │                   │
  │                       │                    │                   │
  │                       │←─ 7. Access Token ─┤                   │
  │                       │                    │                   │
  │                       ├─ 8. 사용자 정보 요청 ─────────────────→│
  │                       │   (Access Token)   │                   │
  │                       │                    │                   │
  │                       │←─ 9. 사용자 정보 ─────────────────────┤
  │                       │                    │                   │
  │←─ 10. 로그인 완료 ────┤                    │                   │
  │                       │                    │                   │
```

### 4.2 OAuth2 설정 (Google, Kakao)

```yaml
# application.yml
spring:
  security:
    oauth2:
      client:
        registration:
          # Google
          google:
            client-id: ${GOOGLE_CLIENT_ID}
            client-secret: ${GOOGLE_CLIENT_SECRET}
            scope:
              - email
              - profile
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"

          # Kakao
          kakao:
            client-id: ${KAKAO_CLIENT_ID}
            client-secret: ${KAKAO_CLIENT_SECRET}
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            authorization-grant-type: authorization_code
            client-authentication-method: client_secret_post
            scope:
              - profile_nickname
              - account_email

        provider:
          kakao:
            authorization-uri: https://kauth.kakao.com/oauth/authorize
            token-uri: https://kauth.kakao.com/oauth/token
            user-info-uri: https://kapi.kakao.com/v2/user/me
            user-name-attribute: id
```

### 4.3 OAuth2 Security 설정

```java
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class OAuth2SecurityConfig {

    private final CustomOAuth2UserService customOAuth2UserService;
    private final OAuth2AuthenticationSuccessHandler successHandler;
    private final OAuth2AuthenticationFailureHandler failureHandler;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/login", "/oauth2/**").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2
                .loginPage("/login")
                .userInfoEndpoint(userInfo -> userInfo
                    .userService(customOAuth2UserService)  // 커스텀 사용자 서비스
                )
                .successHandler(successHandler)  // 성공 핸들러
                .failureHandler(failureHandler)  // 실패 핸들러
            );

        return http.build();
    }
}
```

### 4.4 CustomOAuth2UserService 구현

```java
@Service
@RequiredArgsConstructor
public class CustomOAuth2UserService extends DefaultOAuth2UserService {

    private final UserRepository userRepository;

    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2AuthenticationException {
        // 1. OAuth2 사용자 정보 가져오기
        OAuth2User oauth2User = super.loadUser(userRequest);

        // 2. 제공자 정보 추출 (google, kakao 등)
        String registrationId = userRequest.getClientRegistration().getRegistrationId();

        // 3. 사용자 정보 파싱
        OAuth2UserInfo userInfo = OAuth2UserInfoFactory.getOAuth2UserInfo(
            registrationId,
            oauth2User.getAttributes()
        );

        // 4. DB에서 사용자 조회 또는 생성
        User user = userRepository.findByEmailAndProvider(
            userInfo.getEmail(),
            AuthProvider.valueOf(registrationId.toUpperCase())
        ).orElseGet(() -> createUser(userInfo, registrationId));

        // 5. UserPrincipal 반환
        return UserPrincipal.create(user, oauth2User.getAttributes());
    }

    private User createUser(OAuth2UserInfo userInfo, String registrationId) {
        User user = User.builder()
            .email(userInfo.getEmail())
            .name(userInfo.getName())
            .profileImage(userInfo.getImageUrl())
            .provider(AuthProvider.valueOf(registrationId.toUpperCase()))
            .providerId(userInfo.getId())
            .roles(Set.of(Role.USER))
            .build();

        return userRepository.save(user);
    }
}

// OAuth2UserInfo 인터페이스
public interface OAuth2UserInfo {
    String getId();
    String getName();
    String getEmail();
    String getImageUrl();
}

// Google 구현체
public class GoogleOAuth2UserInfo implements OAuth2UserInfo {

    private final Map<String, Object> attributes;

    public GoogleOAuth2UserInfo(Map<String, Object> attributes) {
        this.attributes = attributes;
    }

    @Override
    public String getId() {
        return (String) attributes.get("sub");
    }

    @Override
    public String getName() {
        return (String) attributes.get("name");
    }

    @Override
    public String getEmail() {
        return (String) attributes.get("email");
    }

    @Override
    public String getImageUrl() {
        return (String) attributes.get("picture");
    }
}

// Kakao 구현체
public class KakaoOAuth2UserInfo implements OAuth2UserInfo {

    private final Map<String, Object> attributes;

    public KakaoOAuth2UserInfo(Map<String, Object> attributes) {
        this.attributes = attributes;
    }

    @Override
    public String getId() {
        return attributes.get("id").toString();
    }

    @Override
    public String getName() {
        Map<String, Object> properties = (Map<String, Object>) attributes.get("properties");
        return (String) properties.get("nickname");
    }

    @Override
    public String getEmail() {
        Map<String, Object> kakaoAccount = (Map<String, Object>) attributes.get("kakao_account");
        return (String) kakaoAccount.get("email");
    }

    @Override
    public String getImageUrl() {
        Map<String, Object> properties = (Map<String, Object>) attributes.get("properties");
        return (String) properties.get("profile_image");
    }
}
```

### 4.5 OAuth2 성공/실패 핸들러

```java
@Component
@RequiredArgsConstructor
public class OAuth2AuthenticationSuccessHandler extends SimpleUrlAuthenticationSuccessHandler {

    private final JwtTokenProvider jwtTokenProvider;

    @Override
    public void onAuthenticationSuccess(
        HttpServletRequest request,
        HttpServletResponse response,
        Authentication authentication
    ) throws IOException {

        // 1. JWT 토큰 생성
        String accessToken = jwtTokenProvider.generateAccessToken(authentication);
        String refreshToken = jwtTokenProvider.generateRefreshToken(
            authentication.getName()
        );

        // 2. 프론트엔드로 리다이렉트 (토큰 포함)
        String targetUrl = UriComponentsBuilder.fromUriString("http://localhost:3000/oauth2/redirect")
            .queryParam("accessToken", accessToken)
            .queryParam("refreshToken", refreshToken)
            .build()
            .toUriString();

        getRedirectStrategy().sendRedirect(request, response, targetUrl);
    }
}

@Component
public class OAuth2AuthenticationFailureHandler extends SimpleUrlAuthenticationFailureHandler {

    @Override
    public void onAuthenticationFailure(
        HttpServletRequest request,
        HttpServletResponse response,
        AuthenticationException exception
    ) throws IOException {

        String targetUrl = UriComponentsBuilder.fromUriString("http://localhost:3000/login")
            .queryParam("error", exception.getLocalizedMessage())
            .build()
            .toUriString();

        getRedirectStrategy().sendRedirect(request, response, targetUrl);
    }
}
```

---

## 5. 권한 관리 (Authorization)

### 5.1 Method Security

```java
@Configuration
@EnableMethodSecurity  // Spring Security 6.0+
public class MethodSecurityConfig {
    // 설정 불필요 (기본 활성화)
}

@Service
public class ProductService {

    // 1. @PreAuthorize - 메서드 실행 전 권한 체크
    @PreAuthorize("hasRole('ADMIN')")
    public void deleteProduct(Long productId) {
        productRepository.deleteById(productId);
    }

    // 2. SpEL 표현식 사용
    @PreAuthorize("hasRole('ADMIN') or #userId == authentication.principal.id")
    public void updateUser(Long userId, UserUpdateRequest request) {
        // ADMIN이거나, 본인의 정보만 수정 가능
    }

    // 3. @PostAuthorize - 메서드 실행 후 권한 체크
    @PostAuthorize("returnObject.userId == authentication.principal.id")
    public Order getOrder(Long orderId) {
        return orderRepository.findById(orderId).orElseThrow();
        // 조회 후 본인의 주문인지 체크
    }

    // 4. @Secured - 간단한 권한 체크 (SpEL 불가)
    @Secured({"ROLE_ADMIN", "ROLE_MANAGER"})
    public void approveOrder(Long orderId) {
        // ADMIN 또는 MANAGER만 승인 가능
    }
}
```

### 5.2 커스텀 권한 체크 (Custom Permission Evaluator)

```java
@Component("customPermissionEvaluator")
public class CustomPermissionEvaluator implements PermissionEvaluator {

    @Autowired
    private OrderRepository orderRepository;

    @Override
    public boolean hasPermission(
        Authentication authentication,
        Object targetDomainObject,
        Object permission
    ) {
        if (authentication == null || !(permission instanceof String)) {
            return false;
        }

        String targetType = targetDomainObject.getClass().getSimpleName().toLowerCase();
        return hasPrivilege(authentication, targetType, permission.toString());
    }

    @Override
    public boolean hasPermission(
        Authentication authentication,
        Serializable targetId,
        String targetType,
        Object permission
    ) {
        if (authentication == null || targetType == null || !(permission instanceof String)) {
            return false;
        }

        return hasPrivilege(authentication, targetType, permission.toString());
    }

    private boolean hasPrivilege(Authentication auth, String targetType, String permission) {
        // 커스텀 권한 로직
        UserPrincipal principal = (UserPrincipal) auth.getPrincipal();

        if (targetType.equals("order") && permission.equals("READ")) {
            // 본인의 주문만 조회 가능
            // (실제로는 targetId를 받아서 체크)
            return true;
        }

        return false;
    }
}

// 사용 예시
@Service
public class OrderService {

    @PreAuthorize("hasPermission(#orderId, 'Order', 'READ')")
    public Order getOrder(Long orderId) {
        return orderRepository.findById(orderId).orElseThrow();
    }
}
```

### 5.3 계층적 권한 (Role Hierarchy)

```java
@Bean
public RoleHierarchy roleHierarchy() {
    RoleHierarchyImpl roleHierarchy = new RoleHierarchyImpl();

    // ADMIN > MANAGER > USER
    String hierarchy = """
        ROLE_ADMIN > ROLE_MANAGER
        ROLE_MANAGER > ROLE_USER
    """;

    roleHierarchy.setHierarchy(hierarchy);
    return roleHierarchy;
}

@Bean
public MethodSecurityExpressionHandler methodSecurityExpressionHandler(
    RoleHierarchy roleHierarchy
) {
    DefaultMethodSecurityExpressionHandler expressionHandler =
        new DefaultMethodSecurityExpressionHandler();
    expressionHandler.setRoleHierarchy(roleHierarchy);
    return expressionHandler;
}

// 사용 예시
@PreAuthorize("hasRole('USER')")
public void viewProducts() {
    // ADMIN, MANAGER, USER 모두 접근 가능 (계층 구조)
}

@PreAuthorize("hasRole('MANAGER')")
public void updateProduct() {
    // ADMIN, MANAGER만 접근 가능
}

@PreAuthorize("hasRole('ADMIN')")
public void deleteProduct() {
    // ADMIN만 접근 가능
}
```

---

## 6. CORS & CSRF 설정

### 6.1 CORS 설정

```java
@Configuration
public class CorsConfig {

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        configuration.setAllowedOrigins(List.of(
            "http://localhost:3000",
            "https://example.com"
        ));

        configuration.setAllowedMethods(List.of(
            "GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"
        ));

        configuration.setAllowedHeaders(List.of(
            "Authorization",
            "Content-Type",
            "X-Requested-With"
        ));

        configuration.setExposedHeaders(List.of(
            "Authorization",
            "X-Total-Count"
        ));

        configuration.setAllowCredentials(true);  // 쿠키 허용
        configuration.setMaxAge(3600L);  // Pre-flight 캐시 시간 (1시간)

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);

        return source;
    }
}

// Security 설정에 적용
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        // ... 기타 설정
    return http.build();
}
```

### 6.2 CSRF 설정

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        // JWT 사용 시 CSRF 비활성화
        .csrf(csrf -> csrf.disable())

        // 또는 특정 경로만 CSRF 비활성화
        .csrf(csrf -> csrf
            .ignoringRequestMatchers("/api/**")  // API는 CSRF 제외
        )

        // Cookie 기반 CSRF (SPA에 적합)
        .csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
        );

    return http.build();
}
```

---

## 7. 실전 보안 체크리스트

### 7.1 비밀번호 정책

```java
@Component
public class PasswordValidator {

    // 비밀번호 정책: 8~20자, 대소문자, 숫자, 특수문자 포함
    private static final String PASSWORD_PATTERN =
        "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,20}$";

    private final Pattern pattern = Pattern.compile(PASSWORD_PATTERN);

    public void validate(String password) {
        if (!pattern.matcher(password).matches()) {
            throw new InvalidPasswordException(
                "비밀번호는 8~20자, 대소문자, 숫자, 특수문자를 포함해야 합니다"
            );
        }

        // 추가 검증: 연속 문자 방지
        if (hasConsecutiveChars(password)) {
            throw new InvalidPasswordException("연속된 문자는 사용할 수 없습니다");
        }
    }

    private boolean hasConsecutiveChars(String password) {
        for (int i = 0; i < password.length() - 2; i++) {
            if (password.charAt(i) + 1 == password.charAt(i + 1) &&
                password.charAt(i + 1) + 1 == password.charAt(i + 2)) {
                return true;
            }
        }
        return false;
    }
}
```

### 7.2 Rate Limiting (로그인 시도 제한)

```java
@Service
@RequiredArgsConstructor
public class LoginAttemptService {

    private final LoadingCache<String, Integer> attemptsCache;

    public LoginAttemptService() {
        this.attemptsCache = CacheBuilder.newBuilder()
            .expireAfterWrite(15, TimeUnit.MINUTES)
            .build(new CacheLoader<String, Integer>() {
                @Override
                public Integer load(String key) {
                    return 0;
                }
            });
    }

    public void loginSucceeded(String email) {
        attemptsCache.invalidate(email);
    }

    public void loginFailed(String email) {
        int attempts = attemptsCache.getUnchecked(email);
        attemptsCache.put(email, attempts + 1);
    }

    public boolean isBlocked(String email) {
        return attemptsCache.getUnchecked(email) >= 5;  // 5회 실패 시 차단
    }
}

// AuthenticationFailureHandler에서 사용
@Component
@RequiredArgsConstructor
public class CustomAuthenticationFailureHandler extends SimpleUrlAuthenticationFailureHandler {

    private final LoginAttemptService loginAttemptService;

    @Override
    public void onAuthenticationFailure(
        HttpServletRequest request,
        HttpServletResponse response,
        AuthenticationException exception
    ) throws IOException {

        String email = request.getParameter("email");
        loginAttemptService.loginFailed(email);

        if (loginAttemptService.isBlocked(email)) {
            exception = new LockedException("계정이 잠겼습니다. 15분 후 다시 시도하세요.");
        }

        super.onAuthenticationFailure(request, response, exception);
    }
}
```

### 7.3 보안 헤더 설정

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .headers(headers -> headers
            // XSS 공격 방지
            .xssProtection(xss -> xss.headerValue(XXssProtectionHeaderWriter.HeaderValue.ENABLED_MODE_BLOCK))

            // Clickjacking 방지
            .frameOptions(frame -> frame.sameOrigin())

            // Content-Type Sniffing 방지
            .contentTypeOptions(Customizer.withDefaults())

            // HTTPS 강제
            .httpStrictTransportSecurity(hsts -> hsts
                .maxAgeInSeconds(31536000)  // 1년
                .includeSubDomains(true)
            )

            // Content Security Policy
            .contentSecurityPolicy(csp -> csp
                .policyDirectives("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'")
            )
        );

    return http.build();
}
```

---

## 요약

### Filter Chain 감각

- 요청은 Filter Chain을 순서대로 지나며 인증/인가가 결정됩니다.
- 인증(Authentication)과 인가(Authorization)를 분리해서 생각해야 설정이 덜 꼬입니다.

### JWT 감각

- Access/Refresh 토큰을 분리하고, 회수/만료/탈취 대응(회전, 블랙리스트 등)을 운영까지 포함해 설계합니다.
- “stateless”는 편하지만, 즉시 무효화가 어렵다는 트레이드오프가 있습니다.

### OAuth2 감각

- Authorization Code(+PKCE)는 웹/모바일에서 가장 안전한 기본값입니다.
- 리소스 서버는 토큰 검증(JWK/서명)과 scope/role 정책을 명확히 가져가야 합니다.

### 권한/보안 포인트

- 메서드 레벨 권한(@PreAuthorize 등)은 “마지막 방어선”으로 두면 실수에 강해집니다.
- CORS/CSRF, 보안 헤더, 레이트리밋은 “기본 보안 베이스라인”입니다.

---

## 마무리

Spring Security는 복잡하지만, Filter Chain과 Authentication/Authorization의 흐름을 이해하면 다양한 보안 요구사항을 구현할 수 있습니다. JWT와 OAuth2를 활용하여 현대적인 인증 시스템을 구축해보세요!

**핵심 요약:**
1. **Filter Chain** - 요청이 순서대로 필터를 거쳐 인증/인가 처리
2. **JWT** - Stateless 인증, Access/Refresh Token 분리 관리
3. **OAuth2** - 소셜 로그인, Authorization Code Grant 흐름
4. **Method Security** - @PreAuthorize로 메서드 레벨 권한 관리
5. **보안 강화** - Rate Limiting, 보안 헤더, 비밀번호 정책

**다음 단계:**
- Database 인덱스 최적화 학습
- Redis 캐싱 전략 실전 적용
- 실전 프로젝트에 Spring Security 적용

*이 글이 도움이 되었다면, 다음 글 "Database 인덱스 최적화 가이드"도 기대해주세요!* 🔒
