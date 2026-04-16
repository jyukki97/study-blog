---
title: "Go로 PostgreSQL 프록시 만들기 (45) - Health Check Endpoint와 LB/K8s Probe"
date: 2026-03-14
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Kubernetes", "Health Check", "Load Balancer", "Observability"]
categories: ["Database"]
project: "pgmux"
description: "LB/K8s 연동을 위한 /healthz(liveness)와 /readyz(readiness) 경량 헬스체크 엔드포인트를 구현한다. 기존 /admin/health와의 역할 분리, 인증 없는 probe 설계를 다룬다."
lastmod: 2026-04-01T11:30:00+09:00
keywords: ["kubernetes readiness probe", "liveness probe", "go health check", "pgmux 운영", "db proxy health endpoint"]
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-44-admin-api-auth-rbac/)에서 Admin API에 인증과 RBAC를 적용했다. 그런데 인증을 도입하면서 새로운 문제가 생겼다 — **로드밸런서와 K8s probe가 헬스체크를 할 수 없다**.

기존 `/admin/health`는 Bearer 토큰이 필요하다. LB/K8s의 `livenessProbe`와 `readinessProbe`는 단순한 HTTP GET만 보낸다. 인증 헤더를 설정하는 것이 불가능하진 않지만, probe에 시크릿을 넣는 건 운영 부담이 크고 보안적으로도 좋지 않다.

또한 `/admin/health`는 **모든 백엔드의 상세 TCP 상태**를 반환하는 무거운 엔드포인트다. probe는 초당 여러 번 호출될 수 있어 경량이어야 한다.

---

## 설계: 세 가지 헬스체크의 역할 분리

| 엔드포인트 | 용도 | 인증 | 응답 |
|-----------|------|------|------|
| `/healthz` | Liveness — 프로세스 생존 확인 | 불필요 | 항상 `200 {"status":"ok"}` |
| `/readyz` | Readiness — 트래픽 수용 가능 여부 | 불필요 | Writer 연결 가능 시 `200`, 불가 시 `503` |
| `/admin/health` | 상세 진단 — 백엔드별 개별 상태 | 필요 (viewer) | Writer + Reader별 TCP 상태 상세 |

**Liveness vs Readiness 분리**는 K8s의 표준 패턴이다:

- **Liveness**: 프로세스가 죽었는지? 실패하면 Pod를 재시작한다.
- **Readiness**: 트래픽을 받을 수 있는지? 실패하면 Service에서 제외하지만 재시작하지 않는다.

pgmux에서 Readiness의 기준은 **Writer 백엔드에 TCP 연결이 가능한가**이다. Writer가 죽으면 쓰기 쿼리를 처리할 수 없으므로 트래픽을 받으면 안 된다.

---

## 구현

### /healthz — Liveness Probe

가장 단순한 형태. 프로세스가 살아있으면 200을 반환한다:

```go
func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    writeJSON(w, map[string]string{"status": "ok"})
}
```

DB 연결도 확인하지 않는다. Liveness probe가 DB 상태에 의존하면, DB 장애 시 Pod가 불필요하게 재시작되는 **cascading failure**가 발생할 수 있다.

### /readyz — Readiness Probe

모든 DatabaseGroup의 Writer에 TCP 연결을 시도한다. 하나라도 실패하면 503:

```go
func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
    groups := s.dbGroupsFn()
    if len(groups) == 0 {
        // DB 그룹이 없으면 트래픽 수용 불가
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]string{
            "status": "not_ready",
            "reason": "no database groups configured",
        })
        return
    }

    var failed []string
    var mu sync.Mutex
    var wg sync.WaitGroup

    for name, dbg := range groups {
        name, dbg := name, dbg
        wg.Add(1)
        go func() {
            defer wg.Done()
            if !checkTCP(dbg.WriterAddr()) {
                mu.Lock()
                failed = append(failed, name)
                mu.Unlock()
            }
        }()
    }
    wg.Wait()

    if len(failed) > 0 {
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]any{
            "status": "not_ready",
            "reason": "writer unreachable for: " + strings.Join(failed, ", "),
        })
        return
    }

    writeJSON(w, map[string]string{"status": "ready"})
}
```

Multi-database 환경을 고려해 **모든 DB 그룹의 Writer를 병렬로** 체크한다. `checkTCP`는 기존 `/admin/health`에서 사용하던 2초 타임아웃 TCP 다이얼을 재활용한다.

### 인증 우회

핵심은 라우트 등록에서 `withAuth` 래퍼를 사용하지 않는 것이다:

```go
func (s *Server) HTTPServer() *http.Server {
    mux := http.NewServeMux()
    // 인증 없는 probe 엔드포인트
    mux.HandleFunc("/healthz", s.handleHealthz)
    mux.HandleFunc("/readyz", s.handleReadyz)
    // 인증 필요한 admin 엔드포인트
    mux.HandleFunc("/admin/health", s.withAuth(s.handleHealth, false))
    // ...
}
```

`/healthz`와 `/readyz`는 `withAuth`로 감싸지 않아, `admin.auth.enabled: true`여도 토큰 없이 접근 가능하다.

---

## K8s 연동 예시

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 9091
  initialDelaySeconds: 5
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /readyz
    port: 9091
  initialDelaySeconds: 5
  periodSeconds: 5
```

- Liveness는 10초 간격으로 느슨하게 체크
- Readiness는 5초 간격으로 빠르게 체크하여 Writer 장애 시 빠른 트래픽 차단

### 운영 체크리스트: 장애 전파를 막는 Probe 튜닝

실무에서 가장 자주 터지는 문제는 코드 버그보다 **probe 파라미터 불일치**다. 로컬/스테이징에서 잘 동작해도 프로덕션에서 장애가 커지는 이유가 여기에 있다. 아래 5가지는 배포 전에 반드시 확인하는 편이 좋다.

1. `timeoutSeconds`는 네트워크 RTT의 2~3배 이상으로 둔다. 너무 짧으면 일시 지연을 장애로 오인한다.
2. `failureThreshold`는 liveness와 readiness를 다르게 둔다. liveness가 너무 민감하면 불필요 재시작 폭풍이 난다.
3. `initialDelaySeconds`는 실제 부팅 시간(설정 로드 + 첫 연결 준비)을 기준으로 잡는다.
4. `/readyz`가 실패할 때 응답 본문에 최소한의 원인(어떤 그룹 writer 실패인지)을 남긴다.
5. 배포 직후 10~15분은 `kubectl describe pod` 이벤트와 `/admin/health` 결과를 함께 본다.

특히 4번은 운영자 체감이 크다. readiness 실패가 발생했는데 로그만으로 원인이 안 보이면, 장애 대응 시간이 즉시 늘어난다. 이미 [QA 발견 6개 버그 정리](/posts/2026-03-14-pgmux-46-qa-findings-six-bugs/)에서 확인했듯이, 작은 가시성 결핍이 실제 복구 시간을 크게 늘린다.

### 롤백 전략: probe 분리 배포는 반드시 단계적으로

`/healthz`/`/readyz` 분리는 안전해 보이지만, 기존 인프라가 `/admin/health`를 전제로 작성되어 있으면 예상치 못한 장애가 생길 수 있다. 따라서 아래 순서를 권장한다.

- **1단계(호환 배포)**: 새 엔드포인트를 먼저 추가하고, 기존 경로는 유지한다.
- **2단계(관측 배포)**: readiness만 새 경로로 전환해 1~2일 관찰한다.
- **3단계(완전 전환)**: liveness도 전환하고, LB 설정과 대시보드 알람 임계값을 맞춘다.

롤백은 간단해야 한다. 배포 파이프라인에서 probe path를 즉시 되돌릴 수 있게 values 파일(또는 Helm override)을 분리해 두면 된다. 이 방식은 이후 [Online Maintenance Mode](/posts/2026-03-16-pgmux-49-online-maintenance-mode/)나 [Read-Only Mode](/posts/2026-03-16-pgmux-50-read-only-mode/)를 도입할 때도 동일하게 재사용할 수 있다.

---

## PgBouncer와 비교

PgBouncer에는 전용 헬스체크 HTTP 엔드포인트가 없다. K8s에서는 보통 `SHOW VERSION` 같은 관리 명령을 TCP probe로 보내거나, 별도 sidecar 스크립트를 사용한다.

pgmux는 HTTP 기반 Admin 서버가 이미 있으므로, 표준적인 `/healthz`/`/readyz` 패턴을 자연스럽게 적용할 수 있다.

---

## 마무리

이번 글에서 구현한 것:

- `/healthz` — 경량 liveness probe (프로세스 생존 확인)
- `/readyz` — readiness probe (Writer 백엔드 TCP 연결 가능 여부)
- 인증 불필요 — LB/K8s probe가 토큰 없이 호출 가능
- 기존 `/admin/health`와 역할 분리 — 상세 진단은 인증 필요

Liveness probe에서 **DB 상태를 체크하지 않는 것**이 핵심 설계 결정이다. DB가 죽었다고 프록시를 재시작하면 상황이 악화될 뿐이다. Readiness만 실패시켜 트래픽을 차단하는 것이 올바른 대응이다.

다음 글에서는 Phase 30의 나머지 항목인 **Online Maintenance Mode**와 **Read-Only Mode**를 다룬다.
