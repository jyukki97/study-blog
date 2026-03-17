---
title: "Go로 PostgreSQL 프록시 만들기 (49) - Online Maintenance Mode"
date: 2026-03-16
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Maintenance", "Admin API", "Graceful Shutdown", "Kubernetes"]
categories: ["Database"]
project: "pgmux"
description: "Admin API를 통해 런타임 유지보수 모드를 활성화하여 신규 연결/쿼리를 거부하고, 진행 중인 트랜잭션은 안전하게 drain하는 기능을 구현한다."
---

## 들어가며

[이전 글](/posts/2026-03-14-pgmux-48-qa-round3-pool-safety/)까지 QA 3라운드를 거치며 풀 안전성을 확보했다. 이제 프로덕션 운영에 필요한 기능을 채울 차례다.

배포, 마이그레이션, 긴급 패치 시 **프록시를 내리지 않고 트래픽만 차단**하고 싶은 상황이 자주 생긴다. `kill -TERM`으로 프로세스를 내리면 기존 연결이 끊기고, LB/K8s가 이를 감지하기까지 시간차가 있어 에러가 발생한다.

필요한 것은:
1. 신규 연결을 즉시 거부
2. 기존 연결의 새 쿼리를 거부
3. **진행 중인 트랜잭션은 완료될 때까지 허용** (drain)
4. LB/K8s에 "트래픽 받지 마세요" 신호 전달

이걸 Admin API 한 번의 호출로 처리하는 **Online Maintenance Mode**를 구현한다.

---

## 설계

### 상태 관리: atomic으로 lock-free

유지보수 모드는 모든 클라이언트 고루틴에서 매 쿼리마다 확인해야 한다. `sync.Mutex`로 감싸면 hot path에 lock contention이 생긴다. 기존 `cfgPtr`, `rateLimitPtr`와 동일하게 `atomic`을 사용한다:

```go
type Server struct {
    // ...
    maintenanceMode atomic.Bool
    maintenanceAt   atomic.Int64  // unix nano timestamp
}
```

`atomic.Bool`은 Go 1.19에서 추가된 타입으로, `Load()`/`Store()`가 lock-free다. 진입 시각은 `atomic.Int64`에 UnixNano로 저장하여 별도의 포인터 할당을 피했다.

### 거부 지점: 연결 vs 쿼리

유지보수 모드에서 거부가 발생하는 지점은 두 곳이다:

**1. 신규 연결 (`handleConn`)**

StartupMessage 파싱 직후, 인증 전에 체크한다. 인증까지 진행하면 불필요한 백엔드 연결이 생기기 때문이다:

```go
// handleConn — startup 파싱 직후
if s.InMaintenance() {
    s.sendFatalWithCode(clientConn, "57P01",
        "pgmux is in maintenance mode")
    return
}
```

SQLSTATE `57P01`은 `admin_shutdown`으로, PostgreSQL이 `pg_terminate_backend()`에서 사용하는 표준 코드다. psql, pgx, JDBC 등 모든 드라이버가 이 코드를 "서버가 종료 중"으로 인식한다.

**2. 기존 연결의 새 쿼리 (`relayQueries`)**

핵심은 **트랜잭션 중이 아닐 때만 거부**하는 것이다:

```go
// relayQueries — 메시지 수신 직후
if s.InMaintenance() && boundWriter == nil {
    s.sendFatalWithCode(clientConn, "57P01",
        "pgmux is in maintenance mode")
    return
}
```

`boundWriter`는 트랜잭션이 진행 중일 때 바인딩된 백엔드 커넥션이다. `nil`이면 idle 상태이므로 안전하게 거부할 수 있다. `BEGIN` ~ `COMMIT/ROLLBACK` 사이의 쿼리는 `boundWriter != nil`이므로 통과한다. 트랜잭션이 완료되면 `boundWriter`가 `nil`로 돌아오고, 그 다음 쿼리에서 FATAL을 받는다.

이것이 **graceful drain**이다 — 진행 중인 작업을 강제로 끊지 않으면서도 새 작업은 받지 않는다.

### /readyz 연동

유지보수 모드에서 `/readyz`가 503을 반환하도록 했다. LB/K8s readinessProbe가 실패하면 Service에서 Pod를 제외하여 새 트래픽이 오지 않는다:

```go
func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
    // 유지보수 모드 체크 (Writer 체크보다 우선)
    if getFn != nil {
        if enabled, _ := getFn(); enabled {
            w.WriteHeader(http.StatusServiceUnavailable)
            json.NewEncoder(w).Encode(map[string]string{
                "status": "not_ready",
                "reason": "maintenance mode active",
            })
            return
        }
    }
    // ... 기존 Writer TCP 체크
}
```

이렇게 하면 운영 시나리오가 깔끔해진다:

```
1. POST /admin/maintenance    → 유지보수 모드 진입
2. /readyz → 503              → K8s가 트래픽 차단
3. 진행 중 트랜잭션 drain     → 자연 완료 대기
4. 배포/마이그레이션 수행
5. DELETE /admin/maintenance   → 유지보수 모드 해제
6. /readyz → 200              → K8s가 트래픽 재개
```

---

## Admin API

세 가지 메서드를 하나의 엔드포인트에서 처리한다:

| 메서드 | 역할 | 응답 |
|--------|------|------|
| `GET /admin/maintenance` | viewer | `{"enabled": false}` 또는 `{"enabled": true, "entered_at": "..."}` |
| `POST /admin/maintenance` | admin | `{"status": "maintenance_entered", "entered_at": "..."}` |
| `DELETE /admin/maintenance` | admin | `{"status": "maintenance_exited"}` |

`withAuth`는 `requireAdmin=false`로 등록하여 viewer도 GET으로 상태를 조회할 수 있다. POST/DELETE는 핸들러 내부에서 admin 역할을 추가 검증한다:

```go
mux.HandleFunc("/admin/maintenance",
    s.withAuth(s.handleMaintenance, false))
```

멱등성도 고려했다 — 이미 유지보수 모드인데 POST를 보내면 `"already in maintenance mode"`를, 해제 상태에서 DELETE를 보내면 `"not in maintenance mode"`를 반환한다. 에러가 아닌 200으로 응답하여 스크립트에서 안전하게 사용할 수 있다.

---

## Prometheus 메트릭

두 가지 메트릭을 추가했다:

```
pgmux_maintenance_mode          # Gauge: 0 또는 1
pgmux_maintenance_rejected_total # Counter: 거부된 연결/쿼리 수
```

`maintenance_mode` 게이지는 Grafana 알림 조건으로 사용할 수 있다. `maintenance_rejected_total`은 유지보수 모드 진입 후 얼마나 많은 트래픽이 거부되었는지 확인하는 데 유용하다.

---

## 함수 전달 패턴

Admin 서버와 Proxy 서버는 별도 패키지다. 유지보수 상태는 Proxy에 있고, 제어는 Admin에서 한다. 기존 `SetReloadFunc` 패턴을 따라 getter/setter 함수를 주입한다:

```go
// admin 패키지
func (s *Server) SetMaintenanceFns(
    getFn func() (bool, time.Time),
    setFn func(bool),
)

// main.go에서 연결
adminSrv.SetMaintenanceFns(
    srv.MaintenanceState,
    srv.SetMaintenance,
)
```

이 패턴의 장점은 **패키지 간 순환 의존 없이** 상태를 공유할 수 있다는 것이다. admin → proxy 직접 참조 대신, main이 두 패키지를 연결하는 접착제 역할을 한다.

---

## PgBouncer와 비교

PgBouncer에는 직접적인 maintenance mode가 없다. 비슷한 동작을 하려면:

```
# PgBouncer
PAUSE;          -- 모든 쿼리 대기 (거부가 아님)
DISABLE mydb;   -- 특정 DB 비활성화
KILL mydb;      -- 기존 연결 강제 종료
```

`PAUSE`는 쿼리를 **거부하지 않고 대기**시킨다. 클라이언트는 타임아웃이 날 때까지 응답을 기다린다. pgmux의 maintenance mode는 즉시 FATAL을 반환하여 클라이언트가 빠르게 failover하거나 재시도할 수 있다.

또한 PgBouncer는 Admin Console이 별도의 PG 프로토콜 기반이라 curl로 제어할 수 없다. pgmux는 표준 HTTP API이므로 CI/CD 스크립트, Ansible, K8s lifecycle hook에서 바로 사용할 수 있다:

```bash
# 배포 스크립트 예시
curl -X POST -H "Authorization: Bearer $KEY" \
  http://pgmux:9091/admin/maintenance

kubectl rollout restart deployment/app

curl -X DELETE -H "Authorization: Bearer $KEY" \
  http://pgmux:9091/admin/maintenance
```

---

## 마무리

Online Maintenance Mode는 단순한 boolean 플래그이지만, 프로덕션 운영에서의 가치는 크다:

- **atomic 상태**: lock-free로 hot path 성능 영향 없음
- **Graceful drain**: 진행 중 트랜잭션을 존중하면서 새 작업만 거부
- **K8s 네이티브**: `/readyz` 연동으로 LB가 자동으로 트래픽 차단
- **HTTP API**: curl 한 줄로 제어, 스크립트/자동화 친화적

다음은 tasks-next.md의 Phase 30 나머지 항목인 **Read-Only Mode**를 진행할 예정이다. Writer 장애 시 읽기 서비스만 유지하는 기능으로, maintenance mode와 유사한 패턴이지만 쓰기 쿼리만 선택적으로 거부한다는 점이 다르다.
