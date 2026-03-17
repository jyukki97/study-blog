---
title: "Go로 PostgreSQL 프록시 만들기 (44) - Admin API 인증과 RBAC"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Auth", "RBAC", "API Security", "Admin API"]
categories: ["Database"]
project: "pgmux"
description: "Admin API에 Bearer API Key 인증과 역할 기반 접근 제어(RBAC)를 구현한다. admin/viewer 역할 분리, IP allowlist, hot-reload까지 지원하여 프로덕션 운영 보안을 확보한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-43-idle-client-timeout/)에서 유휴 클라이언트 타임아웃을 구현했다. 커넥션 관리 안전장치는 갖췄지만, **Admin API 자체가 무방비 상태**라는 더 근본적인 문제가 남아있었다.

현재 Admin API는 9개의 엔드포인트를 제공한다:

- `GET /admin/stats`, `/admin/health`, `/admin/config` — 읽기
- `POST /admin/reload`, `/admin/cache/flush`, `/admin/queries/reset` — 변경

문제는 **인증 없이 누구나 호출할 수 있다**는 점이다. `POST /admin/reload`로 설정을 리로드하거나, `/admin/config`로 내부 설정을 열람할 수 있다. 프로덕션에서는 관리 인터페이스 보안이 기능 추가보다 우선이다.

---

## 설계 결정

### Data API 패턴 재활용

pgmux에는 이미 Data API에서 Bearer 토큰 인증 패턴이 구현되어 있다:

```go
// internal/dataapi/handler.go
token := extractBearerToken(r)
for _, k := range apiKeys {
    if k == token {
        allowed = true
        break
    }
}
```

Admin API도 동일한 Bearer 토큰 방식을 사용하되, **역할(Role) 개념**을 추가했다.

### 역할 분리: admin vs viewer

모든 API Key에 역할을 부여한다:

| 역할 | GET 엔드포인트 | POST 엔드포인트 |
|------|---------------|----------------|
| **admin** | O | O |
| **viewer** | O | X (403) |

모니터링 시스템에는 `viewer` 키를, 운영 담당자에게는 `admin` 키를 발급하면 된다.

### IP Allowlist

네트워크 레벨 방어를 위해 선택적 IP allowlist를 지원한다. CIDR 표기(`10.0.0.0/8`)와 단일 IP 모두 가능하며, 로드밸런서 뒤에서는 `X-Forwarded-For` 헤더의 첫 번째 IP를 사용한다.

---

## 구현

### 설정 구조

```go
type AdminAuthConfig struct {
    Enabled     bool          `yaml:"enabled"`
    APIKeys     []AdminAPIKey `yaml:"api_keys"`
    IPAllowlist []string      `yaml:"ip_allowlist"`
}

type AdminAPIKey struct {
    Key  string `yaml:"key"`
    Role string `yaml:"role"` // "admin" or "viewer"
}
```

YAML 설정:

```yaml
admin:
  enabled: true
  listen: "0.0.0.0:9091"
  auth:
    enabled: true
    api_keys:
      - key: "ops-full-access-key"
        role: "admin"
      - key: "grafana-readonly-key"
        role: "viewer"
    ip_allowlist:
      - "10.0.0.0/8"
      - "172.16.0.0/12"
```

### withAuth 미들웨어

핵심은 `withAuth` 함수다. 각 핸들러를 감싸서 인증/인가를 수행한다:

```go
func (s *Server) withAuth(next http.HandlerFunc, requireAdmin bool) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        cfg := s.cfgFn()  // hot-reload된 최신 설정
        authCfg := cfg.Admin.Auth

        if !authCfg.Enabled {
            next(w, r)
            return
        }

        // 1. IP allowlist 검사
        if len(authCfg.IPAllowlist) > 0 {
            clientIP := extractClientIP(r)
            if !isIPAllowed(clientIP, authCfg.IPAllowlist) {
                writeJSONError(w, http.StatusForbidden, "ip not allowed")
                return
            }
        }

        // 2. Bearer 토큰 검사
        token := extractBearerToken(r)
        if token == "" {
            w.Header().Set("WWW-Authenticate", "Bearer")
            writeJSONError(w, http.StatusUnauthorized, "authentication required")
            return
        }

        // 3. API Key 매칭 → 역할 확인
        role := ""
        for _, k := range authCfg.APIKeys {
            if k.Key == token {
                role = k.Role
                break
            }
        }
        if role == "" {
            writeJSONError(w, http.StatusUnauthorized, "invalid api key")
            return
        }

        // 4. 인가: POST 엔드포인트는 admin만
        if requireAdmin && role != "admin" {
            writeJSONError(w, http.StatusForbidden, "admin role required")
            return
        }

        next(w, r)
    }
}
```

핵심 설계 포인트:

1. **`cfgFn()` getter 패턴**: 매 요청마다 최신 설정을 읽는다. hot-reload로 API Key를 추가/삭제하면 즉시 반영된다.
2. **`requireAdmin` 플래그**: 핸들러 등록 시 결정된다. GET 엔드포인트는 `false`, POST는 `true`.
3. **검사 순서**: IP → 토큰 존재 → 토큰 유효성 → 역할 권한. 가장 저비용 검사를 먼저 수행한다.

### 핸들러 등록

```go
mux.HandleFunc("/admin/health", s.withAuth(s.handleHealth, false))
mux.HandleFunc("/admin/reload", s.withAuth(s.handleReload, true))
```

`false`는 viewer도 접근 가능, `true`는 admin만 접근 가능을 의미한다.

### IP 파싱

```go
func extractClientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        parts := strings.SplitN(xff, ",", 2)
        return strings.TrimSpace(parts[0])
    }
    host, _, err := net.SplitHostPort(r.RemoteAddr)
    if err != nil {
        return r.RemoteAddr
    }
    return host
}

func isIPAllowed(clientIP string, allowlist []string) bool {
    ip := net.ParseIP(clientIP)
    if ip == nil {
        return false
    }
    for _, entry := range allowlist {
        _, cidr, err := net.ParseCIDR(entry)
        if err == nil {
            if cidr.Contains(ip) {
                return true
            }
            continue
        }
        if net.ParseIP(entry) != nil && entry == clientIP {
            return true
        }
    }
    return false
}
```

`X-Forwarded-For`는 쉼표로 구분된 IP 체인에서 **첫 번째(원본 클라이언트)**만 사용한다. CIDR과 단일 IP 모두 지원하며, 파싱 실패 시 거부한다(fail-closed).

### Config 응답에서 API Key 마스킹

`GET /admin/config`에서 API Key가 노출되면 안 된다. 기존 비밀번호 마스킹 패턴을 확장했다:

```go
for _, k := range cfg.Admin.Auth.APIKeys {
    safe.Admin.Auth.APIKeys = append(safe.Admin.Auth.APIKeys, safeAdminAPIKey{
        Key:  "********",
        Role: k.Role,   // 역할은 노출해도 안전
    })
}
```

### 설정 검증

```go
if c.Admin.Auth.Enabled {
    if len(c.Admin.Auth.APIKeys) == 0 {
        return fmt.Errorf("admin.auth.api_keys is required when admin.auth is enabled")
    }
    for i, k := range c.Admin.Auth.APIKeys {
        if k.Role != "admin" && k.Role != "viewer" {
            return fmt.Errorf("admin.auth.api_keys[%d].role must be \"admin\" or \"viewer\"", i)
        }
    }
    for i, cidr := range c.Admin.Auth.IPAllowlist {
        if _, _, err := net.ParseCIDR(cidr); err != nil {
            if ip := net.ParseIP(cidr); ip == nil {
                return fmt.Errorf("admin.auth.ip_allowlist[%d] is not a valid IP or CIDR", i)
            }
        }
    }
}
```

잘못된 설정을 프록시 시작 시점에 잡는다:
- auth 활성화 시 API Key 최소 1개 필수
- role은 "admin" 또는 "viewer"만 허용
- IP allowlist 항목은 유효한 IP 또는 CIDR이어야 함

---

## 하위호환성

`admin.auth.enabled`가 `false`(기본값)이면 기존과 완전히 동일하게 동작한다. 미들웨어가 설정을 확인하고 즉시 `next(w, r)`을 호출한다. 기존 배포에 아무런 영향이 없다.

---

## PgBouncer와 비교

| 항목 | PgBouncer | pgmux |
|------|-----------|-------|
| Admin 접근 제어 | `admin_users` 목록 (PG 콘솔 접속) | Bearer API Key + RBAC |
| 역할 분리 | `stats_users` (읽기 전용) vs `admin_users` | `viewer` / `admin` 역할 |
| IP 제한 | `auth_hba_file` (pg_hba.conf 형식) | `ip_allowlist` (CIDR/IP) |
| Hot-reload | `RELOAD` 명령 후 적용 | 설정 파일 변경 시 즉시 반영 |
| 프로토콜 | PG 콘솔 (`SHOW`, `SET`) | HTTP API (curl, 모니터링 도구 연동 용이) |

PgBouncer는 PG 콘솔 기반이라 `SHOW STATS`를 실행하려면 PG 클라이언트가 필요하다. pgmux는 HTTP 기반이므로 curl, Grafana, 자동화 스크립트에서 직접 호출할 수 있고, Bearer 토큰으로 인증하므로 기존 API 게이트웨이와도 자연스럽게 통합된다.

---

## 마무리

이번에 구현한 것:

- **Bearer API Key 인증**: `Authorization: Bearer <key>` 헤더
- **RBAC**: admin(전체 접근) / viewer(읽기 전용) 역할 분리
- **IP Allowlist**: CIDR/단일 IP 기반 네트워크 접근 제한, X-Forwarded-For 지원
- **Hot-reload**: API Key 추가/삭제가 설정 리로드로 즉시 반영
- **API Key 마스킹**: `/admin/config` 응답에서 키 값 비노출

프로덕션에 투입하기 전에 관리 인터페이스 보안을 확보하는 것은 기능 추가보다 우선이다. 다음 글에서는 `/healthz`, `/readyz` 분리와 Maintenance Mode를 다룬다.
