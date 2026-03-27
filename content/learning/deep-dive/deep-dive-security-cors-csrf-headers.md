---
title: "웹 보안 기본: CORS/CSRF와 헤더 보안"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["CORS", "CSRF", "Security Headers", "Spring Security", "SOP", "CSP", "SameSite"]
categories: ["DevOps"]
description: "SOP/CORS 동작 원리, CSRF 공격 시나리오와 4가지 방어 전략, 보안 헤더(HSTS/CSP/Permissions-Policy) 실전 적용 가이드"
module: "ops-observability"
study_order: 340
---

## 이 글에서 얻는 것

- **SOP(Same-Origin Policy)**가 브라우저 보안의 기초인 이유를 이해하고, CORS가 SOP의 "허용 예외"임을 설명할 수 있습니다.
- CORS 요청 3가지 유형(Simple/Preflight/Credentialed)을 구분하고, 브라우저 DevTools 에러별 정확한 원인을 진단할 수 있습니다.
- CSRF 공격 시나리오를 코드로 이해하고, 4가지 방어 전략(Synchronizer Token/Double Submit Cookie/SameSite/Custom Header)의 장단점을 비교해 선택할 수 있습니다.
- 운영에서 기본으로 적용해야 할 보안 헤더 7종의 설정 근거와 Spring Boot/Nginx 적용 코드를 확보합니다.

---

## 0) SOP: 브라우저 보안의 출발점

CORS/CSRF를 이해하려면 **SOP(Same-Origin Policy)**부터 시작해야 합니다.

### 0-1) Origin의 정의

**Origin = Scheme + Host + Port** — 셋 중 하나라도 다르면 "다른 Origin"입니다.

| URL A | URL B | 같은 Origin? | 이유 |
|-------|-------|:---:|------|
| `https://app.example.com` | `https://app.example.com/api` | ✅ | Path만 다름 |
| `https://app.example.com` | `http://app.example.com` | ❌ | Scheme 다름 |
| `https://app.example.com` | `https://api.example.com` | ❌ | Host 다름 (서브도메인도 다른 Origin) |
| `https://app.example.com` | `https://app.example.com:8443` | ❌ | Port 다름 |

### 0-2) SOP가 막는 것과 허용하는 것

SOP는 "다른 Origin의 응답을 JS로 읽는 것"을 제한합니다. 요청 자체를 막는 게 아닙니다.

```
✅ SOP가 허용하는 것 (Cross-Origin 가능)
─────────────────────────────────────────
- <img>, <script>, <link> 태그로 리소스 로딩
- <form> 전송 (POST도 가능 → 이것이 CSRF의 원인!)
- <iframe> 임베딩 (frame-ancestors로 제한 가능)

❌ SOP가 차단하는 것
─────────────────────────────────────────
- fetch/XMLHttpRequest로 다른 Origin의 응답 읽기
- 다른 Origin iframe의 DOM 접근
- 다른 Origin의 Cookie/Storage 접근
```

**핵심 포인트:** SOP는 "요청은 보내지만 응답을 읽지 못하게" 합니다. 이것을 이해하면 CORS와 CSRF가 왜 따로 존재하는지 명확해집니다.

---

## 1) CORS: SOP의 "허용 예외"를 서버가 선언하는 메커니즘

CORS(Cross-Origin Resource Sharing)는 서버가 **"이 Origin은 내 응답을 읽어도 된다"**를 HTTP 헤더로 선언하면, 브라우저가 SOP를 풀어주는 프로토콜입니다.

### 1-1) CORS 요청의 3가지 유형

| 유형 | 조건 | Preflight | 브라우저 동작 |
|------|------|:---------:|:--------------|
| **Simple** | GET/HEAD/POST + 단순 헤더 + 단순 Content-Type | ❌ | 바로 요청, 응답 헤더 검사 |
| **Preflight** | 커스텀 헤더, PUT/DELETE, `application/json` 등 | ✅ OPTIONS 먼저 | OPTIONS 허용 응답 후 본 요청 |
| **Credentialed** | `credentials: 'include'` (쿠키/인증) | 조건에 따라 | `*` 불가, 구체적 Origin 필수 |

**Simple Request 조건 (모두 충족해야):**
```
Method: GET, HEAD, POST 중 하나
Headers: Accept, Accept-Language, Content-Language, Content-Type만
Content-Type: application/x-www-form-urlencoded, multipart/form-data, text/plain만
```

### 1-2) Preflight 동작 흐름

```
Browser                                    Server
  │                                           │
  │── OPTIONS /api/users ──────────────────→  │
  │   Origin: https://app.example.com         │
  │   Access-Control-Request-Method: PUT      │
  │   Access-Control-Request-Headers:         │
  │     Authorization, Content-Type           │
  │                                           │
  │←── 200 OK ────────────────────────────    │
  │   Access-Control-Allow-Origin:            │
  │     https://app.example.com               │
  │   Access-Control-Allow-Methods:           │
  │     GET, PUT, DELETE                      │
  │   Access-Control-Allow-Headers:           │
  │     Authorization, Content-Type           │
  │   Access-Control-Max-Age: 3600            │
  │                                           │
  │── PUT /api/users ──────────────────────→  │  ← 본 요청
  │   Origin: https://app.example.com         │
  │   Authorization: Bearer xxx               │
  │                                           │
  │←── 200 OK ────────────────────────────    │
  │   Access-Control-Allow-Origin:            │
  │     https://app.example.com               │
```

**`Access-Control-Max-Age: 3600`** — 1시간 동안 같은 리소스에 Preflight를 캐시합니다. 이 값이 없으면 **매 요청마다** OPTIONS가 발생해 RTT가 2배가 됩니다.

### 1-3) Credentialed Request의 엄격한 규칙

쿠키/Authorization 헤더를 포함하는 요청은 CORS 규칙이 더 까다롭습니다:

```javascript
// 프론트엔드
fetch('https://api.example.com/me', {
  credentials: 'include'  // 쿠키 포함
});
```

| 규칙 | 이유 |
|------|------|
| `Access-Control-Allow-Origin: *` 불가 | 모든 사이트에서 인증 정보를 보내게 되면 CSRF와 같은 효과 |
| 반드시 구체적 Origin 지정 | `https://app.example.com` |
| `Access-Control-Allow-Credentials: true` 필수 | 브라우저에게 "이 Origin의 인증 요청을 허용한다"고 명시 |
| `Access-Control-Expose-Headers` 명시 | 커스텀 응답 헤더를 JS에서 읽으려면 필요 |

### 1-4) Spring Boot CORS 설정: 3가지 방식

**방식 1: SecurityFilterChain (가장 권장)**
```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors(cors -> cors.configurationSource(corsConfigurationSource()))
        .build();
}

@Bean
CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    
    // ✅ 운영: 허용 Origin을 명시적으로 나열
    config.setAllowedOrigins(List.of(
        "https://app.example.com",
        "https://admin.example.com"
    ));
    
    // 또는 패턴으로 (서브도메인 와일드카드)
    // config.setAllowedOriginPatterns(List.of("https://*.example.com"));
    
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH"));
    config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Request-ID"));
    config.setExposedHeaders(List.of("X-Request-ID", "X-RateLimit-Remaining"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);  // Preflight 캐시 1시간
    
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/api/**", config);
    return source;
}
```

**방식 2: @CrossOrigin (컨트롤러 단위)**
```java
@RestController
@CrossOrigin(
    origins = "https://app.example.com",
    maxAge = 3600
)
public class UserController {
    // 이 컨트롤러의 모든 엔드포인트에 적용
}
```

**방식 3: WebMvcConfigurer (Security 미사용 시)**
```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("https://app.example.com")
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
```

> ⚠️ **주의:** Spring Security를 사용하면 Security 필터가 먼저 실행됩니다. `WebMvcConfigurer`만 설정하면 Security 필터에서 CORS를 거부할 수 있습니다. SecurityFilterChain에서 `.cors()` 설정을 명시하세요.

### 1-5) CORS 디버깅: DevTools 에러별 원인과 해결

| 브라우저 에러 메시지 | 원인 | 해결 |
|:---------------------|:-----|:-----|
| `No 'Access-Control-Allow-Origin' header is present` | 서버가 CORS 헤더를 안 보냄 | 서버 CORS 설정 추가 |
| `The value of 'Access-Control-Allow-Origin' must not be '*' when credentials mode is 'include'` | Credentialed 요청에 `*` 사용 | 구체적 Origin 지정 |
| `Method PUT is not allowed by Access-Control-Allow-Methods` | 허용 메서드 누락 | `allowedMethods`에 추가 |
| `Request header field authorization is not allowed` | 허용 헤더 누락 | `allowedHeaders`에 추가 |
| `Response to preflight request doesn't pass access control check` | OPTIONS 핸들러 없거나 응답 누락 | 프레임워크 CORS 설정 확인 |
| `The value of 'Access-Control-Allow-Credentials' header must be 'true'` | credentials 요청인데 헤더 누락 | `allowCredentials(true)` |

**디버깅 체크리스트:**
1. Network 탭에서 OPTIONS 요청 확인 → 응답 헤더에 `Access-Control-Allow-*` 있는지
2. 서버 로그에 OPTIONS 요청 도달 여부 → 프록시/로드밸런서에서 차단되는 경우 있음
3. `curl -I -X OPTIONS` 으로 서버 직접 확인

```bash
# Preflight 시뮬레이션
curl -i -X OPTIONS https://api.example.com/api/users \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: Authorization, Content-Type"
```

---

## 2) CSRF: 쿠키 자동 전송을 악용하는 공격

CSRF(Cross-Site Request Forgery)는 **브라우저가 쿠키를 자동으로 붙여 보내는 특성**을 악용합니다.

### 2-1) CSRF 공격 시나리오

```
사용자가 bank.com에 로그인 (세션 쿠키 저장)
         ↓
evil.com에 방문 (광고/링크/이메일)
         ↓
evil.com 페이지가 bank.com으로 요청 전송
         ↓
브라우저가 bank.com 쿠키를 자동으로 첨부!
         ↓
bank.com 서버는 정상 사용자 요청으로 인식
```

**공격 예시 코드 (evil.com에 심어진 HTML):**

```html
<!-- 1) 자동 제출 폼 -->
<form action="https://bank.com/api/transfer" method="POST" id="exploit">
  <input type="hidden" name="to" value="attacker-account" />
  <input type="hidden" name="amount" value="1000000" />
</form>
<script>document.getElementById('exploit').submit();</script>

<!-- 2) 이미지 태그 (GET 요청) -->
<img src="https://bank.com/api/transfer?to=attacker&amount=1000000" />

<!-- 3) fetch (credentials 포함) -->
<script>
fetch('https://bank.com/api/transfer', {
  method: 'POST',
  credentials: 'include',  // 쿠키 자동 포함
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'to=attacker&amount=1000000'
});
</script>
```

### 2-2) CSRF가 위험한 경우 / 안전한 경우

| 인증 방식 | CSRF 위험 | 이유 |
|:----------|:---------:|:-----|
| 세션 쿠키 | ⚠️ **높음** | 브라우저가 쿠키를 자동 전송 |
| JWT를 쿠키에 저장 | ⚠️ **높음** | 쿠키 = 자동 전송 대상 |
| JWT를 Authorization 헤더로 | ✅ 낮음 | JS가 명시적으로 헤더에 넣어야 함 (cross-origin JS는 접근 불가) |
| API Key in Header | ✅ 낮음 | 동일 이유 |

**핵심:** CSRF의 위험도는 "인증 토큰이 쿠키에 있는가?"로 결정됩니다.

### 2-3) 4가지 CSRF 방어 전략 비교

| 전략 | 원리 | 장점 | 단점 | 적합한 상황 |
|:-----|:-----|:-----|:-----|:------------|
| **Synchronizer Token** | 서버가 폼에 랜덤 토큰 삽입, 요청 시 검증 | 가장 안전, 표준 패턴 | 서버 사이드 렌더링 필요, 상태 저장 | SSR(Thymeleaf, JSP) |
| **Double Submit Cookie** | 랜덤값을 쿠키 + 요청 헤더에 이중 전송 | Stateless 가능 | 서브도메인 공격에 취약 | SPA + API |
| **SameSite Cookie** | 브라우저가 Cross-site 요청에 쿠키 미전송 | 설정만으로 방어, 서버 로직 불필요 | 구형 브라우저 미지원, GET CSRF 미방어(Lax) | 보조 방어 (단독 사용 비권장) |
| **Custom Header** | 커스텀 헤더(`X-Requested-With`) 필수화 | Simple Request가 아니면 Preflight 발생 → CORS가 막아줌 | Content-Type 우회 가능성 | API 전용 (폼 전송 없는 경우) |

### 2-4) Spring Security CSRF 설정

**SSR(Thymeleaf) — Synchronizer Token:**
```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .csrf(csrf -> csrf
            .csrfTokenRepository(HttpSessionCsrfTokenRepository()))
        .build();
}
```
```html
<!-- Thymeleaf에서 자동 삽입 -->
<form th:action="@{/transfer}" method="post">
    <!-- Spring Security가 자동으로 _csrf hidden field 삽입 -->
    <input type="text" name="amount" />
    <button type="submit">송금</button>
</form>
```

**SPA — Double Submit Cookie (CookieCsrfTokenRepository):**
```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .csrf(csrf -> csrf
            // 쿠키에 XSRF-TOKEN 저장 → JS에서 읽어서 X-XSRF-TOKEN 헤더로 전송
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            // SPA에서 CSRF 토큰 로딩을 위한 핸들러
            .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))
        .build();
}
```
```javascript
// SPA(React/Vue)에서 CSRF 토큰 읽기
function getCsrfToken() {
    return document.cookie
        .split('; ')
        .find(row => row.startsWith('XSRF-TOKEN='))
        ?.split('=')[1];
}

// axios 인터셉터로 자동 전송
axios.interceptors.request.use(config => {
    const token = getCsrfToken();
    if (token) {
        config.headers['X-XSRF-TOKEN'] = token;
    }
    return config;
});
```

**Stateless API (JWT + Authorization 헤더) — CSRF 비활성화:**
```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .csrf(csrf -> csrf.disable())  // Authorization 헤더 기반일 때만!
        // ⚠️ JWT를 쿠키에 저장하면서 disable하면 안 됩니다
        .sessionManagement(session -> session
            .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .build();
}
```

### 2-5) SameSite Cookie 속성 상세

| 속성 | Cross-site 요청 시 쿠키 전송 | 보안 수준 | 사용자 경험 |
|:-----|:-----------------------------|:---------:|:------------|
| `Strict` | 절대 전송 안 함 | 🟢 최고 | 외부 링크 클릭 시 로그인 풀림 |
| `Lax` (기본값) | 안전한 top-level 탐색(GET)만 허용 | 🟡 적절 | 링크 클릭 시 로그인 유지, POST는 차단 |
| `None` | 항상 전송 (`Secure` 필수) | 🔴 낮음 | Cross-site 임베딩 필요 시 |

```java
// Spring Boot에서 SameSite 설정
@Bean
public CookieSerializer cookieSerializer() {
    DefaultCookieSerializer serializer = new DefaultCookieSerializer();
    serializer.setSameSite("Lax");
    serializer.setUseSecureCookie(true);
    serializer.setUseHttpOnlyCookie(true);
    return serializer;
}
```

> 💡 **실무 권장:** SameSite=Lax를 기본으로 두고, Synchronizer Token 또는 Double Submit Cookie를 함께 사용하는 **다층 방어**가 안전합니다.

---

## 3) 보안 헤더: 7종 완전 가이드

보안 헤더는 브라우저에게 "이 응답을 어떻게 취급해라"를 지시하는 **최종 방어선**입니다.

### 3-1) 보안 헤더 전체 비교표

| 헤더 | 방어 대상 | 필수도 | 설정 난이도 |
|:-----|:---------|:------:|:----------:|
| `Strict-Transport-Security` (HSTS) | SSL Stripping, 중간자 공격 | ⭐⭐⭐ | 낮음 |
| `Content-Security-Policy` (CSP) | XSS, 데이터 주입 | ⭐⭐⭐ | **높음** |
| `X-Content-Type-Options` | MIME Sniffing XSS | ⭐⭐⭐ | 낮음 |
| `X-Frame-Options` / CSP `frame-ancestors` | Clickjacking | ⭐⭐ | 낮음 |
| `Referrer-Policy` | Referer 정보 유출 | ⭐⭐ | 낮음 |
| `Permissions-Policy` | 카메라/마이크/위치 등 API 제한 | ⭐ | 낮음 |
| `X-XSS-Protection` | 구형 브라우저 XSS 필터 | ⭐ (레거시) | 낮음 |

### 3-2) HSTS (HTTP Strict Transport Security)

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**동작:** 브라우저가 이 헤더를 받으면, 지정 기간 동안 해당 도메인은 **무조건 HTTPS로만** 접속합니다.

```
사용자가 http://bank.com 입력
    ↓
HSTS 없을 때: HTTP 평문 요청 → 301 리다이렉트 → HTTPS
                ↑ 중간자 공격 가능 구간!
    
HSTS 있을 때: 브라우저가 즉시 HTTPS로 변환 (HTTP 요청 자체가 안 감)
```

**적용 주의:**
- `includeSubDomains`: 서브도메인도 HTTPS 강제 → 모든 서브도메인이 HTTPS인지 확인 필요
- `preload`: 브라우저에 하드코딩 → [hstspreload.org](https://hstspreload.org) 등록 필요, 해제 어려움
- **첫 적용 시 `max-age=300`으로 시작**, 문제 없으면 점진적으로 늘리기

### 3-3) Content-Security-Policy (CSP)

CSP는 "어떤 출처의 리소스를 로딩할 수 있는가"를 세밀하게 제어합니다.

**기본 정책 예시:**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-abc123' https://cdn.example.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://api.example.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

| 디렉티브 | 제어 대상 | 예시 |
|:---------|:---------|:-----|
| `default-src` | 모든 리소스 기본값 | `'self'` |
| `script-src` | JavaScript | `'self' 'nonce-xxx'` (인라인 허용) |
| `style-src` | CSS | `'self' 'unsafe-inline'` (인라인 스타일) |
| `img-src` | 이미지 | `'self' data: https:` |
| `connect-src` | fetch/XHR/WebSocket | `'self' https://api.example.com` |
| `frame-ancestors` | 이 페이지를 iframe으로 임베딩 가능한 곳 | `'none'` (X-Frame-Options 대체) |
| `base-uri` | `<base>` 태그 제한 | `'self'` |
| `form-action` | 폼 전송 대상 제한 | `'self'` |

**Nonce 기반 인라인 스크립트 허용:**
```java
// Spring Boot에서 요청별 nonce 생성
@Component
public class CspNonceFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        
        String nonce = Base64.getEncoder()
            .encodeToString(SecureRandom.getInstanceStrong()
                .generateSeed(16));
        request.setAttribute("cspNonce", nonce);
        
        response.setHeader("Content-Security-Policy",
            "default-src 'self'; " +
            "script-src 'self' 'nonce-" + nonce + "'; " +
            "style-src 'self' 'unsafe-inline'");
        
        chain.doFilter(request, response);
    }
}
```
```html
<!-- Thymeleaf에서 nonce 사용 -->
<script th:attr="nonce=${cspNonce}">
    console.log('이 스크립트만 실행 허용');
</script>
```

**CSP 점진적 도입 전략:**
```
1단계: Report-Only 모드로 위반 수집
   Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report

2단계: 위반 로그 분석 → 정책 조정
   - 서드파티 스크립트/CDN 허용 추가
   - unsafe-inline → nonce 방식으로 전환

3단계: 적용 (Report-Only 제거)
   Content-Security-Policy: ...

4단계: 주기적 위반 리포트 모니터링
```

### 3-4) 나머지 헤더

```
# MIME Sniffing 방지
X-Content-Type-Options: nosniff

# Clickjacking 방지 (CSP frame-ancestors 권장)
X-Frame-Options: DENY

# Referrer 정보 제한
Referrer-Policy: strict-origin-when-cross-origin

# 브라우저 API 권한 제한
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

# XSS 필터 (레거시, 최신 브라우저는 CSP 사용)
X-XSS-Protection: 0
# 0으로 설정하는 이유: 1;mode=block은 사이드채널 공격에 악용 가능
```

### 3-5) Spring Boot 보안 헤더 통합 설정

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .headers(headers -> headers
            // HSTS
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true)
                .maxAgeInSeconds(31536000)
                .preload(true))
            // CSP
            .contentSecurityPolicy(csp -> csp
                .policyDirectives(
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: https:; " +
                    "frame-ancestors 'none'"))
            // Clickjacking
            .frameOptions(frame -> frame.deny())
            // Content-Type 스니핑 방지 (기본 활성화)
            .contentTypeOptions(Customizer.withDefaults())
            // Referrer-Policy
            .referrerPolicy(referrer -> referrer
                .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy
                    .STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
            // Permissions-Policy
            .permissionsPolicy(permissions -> permissions
                .policy("camera=(), microphone=(), geolocation=()"))
        )
        .build();
}
```

### 3-6) Nginx 보안 헤더 설정

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    # HSTS
    add_header Strict-Transport-Security 
        "max-age=31536000; includeSubDomains; preload" always;

    # CSP
    add_header Content-Security-Policy 
        "default-src 'self'; script-src 'self'; frame-ancestors 'none'" always;

    # MIME Sniffing 방지
    add_header X-Content-Type-Options "nosniff" always;

    # Clickjacking 방지
    add_header X-Frame-Options "DENY" always;

    # Referrer 제어
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 권한 제어
    add_header Permissions-Policy 
        "camera=(), microphone=(), geolocation=()" always;

    # ⚠️ 'always' 키워드: 에러 응답(4xx, 5xx)에도 헤더 포함
}
```

---

## 4) 실전 시나리오: CORS + CSRF + 보안 헤더 통합

### 시나리오 A: SPA + API 서버 (가장 흔한 구조)

```
프론트엔드: https://app.example.com (React)
백엔드:     https://api.example.com (Spring Boot)
인증:       JWT를 Authorization 헤더로 전송
```

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        // CORS: SPA Origin 허용
        .cors(cors -> cors.configurationSource(corsConfig()))
        // CSRF: JWT가 Authorization 헤더 기반이므로 비활성화
        .csrf(csrf -> csrf.disable())
        // 보안 헤더
        .headers(headers -> headers
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true).maxAgeInSeconds(31536000))
            .contentTypeOptions(Customizer.withDefaults())
            .frameOptions(frame -> frame.deny()))
        // Stateless 세션
        .sessionManagement(session -> session
            .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .build();
}
```

### 시나리오 B: SSR + 세션 기반 인증 (전통적 구조)

```
서버: https://app.example.com (Spring MVC + Thymeleaf)
인증: 세션 쿠키 (JSESSIONID)
```

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        // CORS: 같은 Origin이므로 불필요
        // CSRF: 세션 기반 → 반드시 활성화
        .csrf(csrf -> csrf
            .csrfTokenRepository(new HttpSessionCsrfTokenRepository()))
        // SameSite 쿠키 추가 방어
        // (application.yml: server.servlet.session.cookie.same-site=lax)
        .headers(headers -> headers
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true).maxAgeInSeconds(31536000))
            .contentSecurityPolicy(csp -> csp
                .policyDirectives("default-src 'self'; frame-ancestors 'none'"))
            .frameOptions(frame -> frame.deny()))
        .build();
}
```

### 시나리오 C: SPA + JWT를 쿠키에 저장 (주의 필요)

```java
// ⚠️ JWT를 HttpOnly 쿠키에 저장하면 CSRF 방어 필요!
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .cors(cors -> cors.configurationSource(corsConfig()))
        // CSRF 활성화 (쿠키 기반 인증이므로)
        .csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))
        .headers(headers -> headers
            .httpStrictTransportSecurity(hsts -> hsts
                .includeSubDomains(true).maxAgeInSeconds(31536000))
            .frameOptions(frame -> frame.deny()))
        .build();
}
```

---

## 5) 보안 점검 도구와 자동화

### 온라인 점검

| 도구 | URL | 점검 내용 |
|:-----|:----|:---------|
| Security Headers | securityheaders.com | 응답 보안 헤더 등급(A~F) |
| Mozilla Observatory | observatory.mozilla.org | 보안 헤더 + TLS + 쿠키 종합 |
| CSP Evaluator | csp-evaluator.withgoogle.com | CSP 정책 안전성 평가 |

### CI/CD 통합 점검

```yaml
# GitHub Actions에서 보안 헤더 점검
- name: Check security headers
  run: |
    HEADERS=$(curl -sI https://app.example.com)
    echo "$HEADERS" | grep -qi "strict-transport-security" || (echo "HSTS missing" && exit 1)
    echo "$HEADERS" | grep -qi "x-content-type-options" || (echo "X-CTO missing" && exit 1)
    echo "$HEADERS" | grep -qi "content-security-policy" || (echo "CSP missing" && exit 1)
```

---

## 안티패턴 7가지

| # | 안티패턴 | 문제 | 올바른 방법 |
|---|:---------|:-----|:-----------|
| 1 | `Access-Control-Allow-Origin: *` + credentials | 스펙 위반(브라우저 차단) | 구체적 Origin 명시 |
| 2 | Origin을 요청 값 그대로 반사 | 모든 사이트에서 인증 요청 가능 | 허용 목록(allowlist) 검증 |
| 3 | CSRF disable + 쿠키 인증 | CSRF 공격에 무방비 | 쿠키 인증이면 CSRF 활성화 |
| 4 | `unsafe-inline` + `unsafe-eval` CSP | XSS 방어 무력화 | nonce/hash 기반 허용 |
| 5 | HSTS max-age=0 운영 배포 | HSTS 무효화 | 최소 1년(31536000) |
| 6 | SameSite만으로 CSRF 방어 | GET CSRF, 구형 브라우저 미지원 | 다층 방어(SameSite + Token) |
| 7 | 에러 응답에 보안 헤더 누락 | 4xx/5xx에서 헤더 미적용 | Nginx `always`, Spring 기본 제공 |

---

## 운영 체크리스트

### CORS
- [ ] 허용 Origin을 명시적으로 나열했는가? (`*` 미사용)
- [ ] Preflight Max-Age를 설정했는가? (권장 3600초)
- [ ] Credentialed 요청 시 `Access-Control-Allow-Credentials: true` + 구체적 Origin?
- [ ] 노출 헤더(`Expose-Headers`)를 프론트엔드 필요에 맞게 설정했는가?

### CSRF
- [ ] 인증이 쿠키 기반이면 CSRF 방어가 활성화되어 있는가?
- [ ] SPA라면 Double Submit Cookie(`CookieCsrfTokenRepository`) 적용?
- [ ] SameSite=Lax 이상이 기본 설정되어 있는가?
- [ ] JWT를 쿠키에 저장한다면 CSRF를 비활성화하지 않았는가?

### 보안 헤더
- [ ] HSTS가 활성화되어 있고 max-age ≥ 1년인가?
- [ ] CSP가 Report-Only 또는 적용 상태인가?
- [ ] X-Content-Type-Options: nosniff 적용?
- [ ] X-Frame-Options: DENY (또는 CSP frame-ancestors: 'none')?
- [ ] Referrer-Policy 설정?
- [ ] securityheaders.com 점검 결과 A 등급 이상?

---

## 관련 글

- [OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/)
- [JWT 인증과 세션 전략](/learning/deep-dive/deep-dive-jwt-auth/)
- [OAuth 2.0과 OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/)
- [Spring Security 아키텍처](/learning/deep-dive/deep-dive-spring-security-architecture/)
- [Spring Security 기초](/learning/deep-dive/deep-dive-spring-security/)
- [HTTPS와 SSL/TLS 핸드셰이크](/learning/deep-dive/deep-dive-https-ssl-handshake/)
- [TLS 핸드셰이크 심층 분석](/learning/deep-dive/deep-dive-tls-handshake/)
- [OAuth2 Social Login 구현](/learning/deep-dive/deep-dive-oauth2-social-login/)
- [Spring Security OAuth2 + JWT 실전](/learning/deep-dive/deep-dive-spring-security-oauth2-jwt-practical/)
