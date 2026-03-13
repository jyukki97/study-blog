---
title: "Go로 PostgreSQL 프록시 만들기 (12) - 무중단 설정 리로드"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Hot Reload", "SIGHUP", "DevOps"]
categories: ["Database"]
project: "pgmux"
description: "SIGHUP 시그널과 Admin API로 프록시를 재시작하지 않고 설정을 변경한다. Reader Pool 핫스왑과 Balancer 원자적 갱신."
---

## 들어가며

> "설정 하나 바꾸려고 프록시를 재시작하면, 진행 중인 쿼리가 전부 끊긴다."

Reader를 추가하거나, Rate Limit 값을 조정하려면 지금까지는 프록시를 내렸다 올려야 했다. 프로덕션에서는 수용할 수 없다 — 재시작 동안 모든 활성 연결이 끊기고, 풀의 커넥션이 재생성되며, 캐시가 날아간다.

이번 편에서 구현한 것:
1. SIGHUP 시그널 기반 설정 리로드
2. Admin API `POST /admin/reload` 엔드포인트
3. Reader Pool 핫스왑 (기존 유지, 추가, 삭제)
4. Balancer 원자적 백엔드 갱신

## 🔄 리로드 트리거

### SIGHUP 시그널

Unix의 전통적인 방식이다. Nginx, HAProxy, PostgreSQL 등 대부분의 서버 소프트웨어가 SIGHUP으로 설정을 다시 읽는다:

```go
// main.go
sighupCh := make(chan os.Signal, 1)
signal.Notify(sighupCh, syscall.SIGHUP)
go func() {
    for range sighupCh {
        slog.Info("received SIGHUP, reloading config...")
        if err := reloadConfig(cfgPath, srv); err != nil {
            slog.Error("config reload failed", "error", err)
        }
    }
}()
```

```bash
# 운영 환경에서:
kill -HUP $(pidof pgmux)
```

### Admin API

쿠버네티스나 배포 파이프라인에서는 시그널보다 HTTP가 편하다:

```go
func (s *Server) handleReload(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }

    if fn := s.reloadFunc; fn == nil {
        http.Error(w, "reload not configured", http.StatusServiceUnavailable)
        return
    }

    if err := s.reloadFunc(); err != nil {
        slog.Error("admin: reload failed", "error", err)
        writeJSON(w, map[string]any{"status": "error", "error": err.Error()})
        return
    }

    slog.Info("admin: config reloaded")
    writeJSON(w, map[string]string{"status": "reloaded"})
}
```

```bash
curl -X POST http://localhost:9090/admin/reload
# {"status":"reloaded"}
```

두 방식 모두 동일한 `reloadConfig()` → `Server.Reload()`를 호출한다.

## 🔧 Server.Reload() 핵심 로직

### Reader Pool 핫스왑

```go
func (s *Server) Reload(newCfg *config.Config) error {
    oldCfg := s.cfg

    newReaderAddrs := make([]string, len(newCfg.Readers))
    for i, r := range newCfg.Readers {
        newReaderAddrs[i] = fmt.Sprintf("%s:%d", r.Host, r.Port)
    }

    newReaderPools := make(map[string]*pool.Pool)
    for _, addr := range newReaderAddrs {
        if existingPool, ok := s.readerPools[addr]; ok {
            newReaderPools[addr] = existingPool  // 기존 풀 유지
        } else {
            // 새 Reader 추가 → 새 풀 생성
            p, err := pool.New(pool.Config{
                DialFunc: func() (net.Conn, error) {
                    return pgConnect(addr, newCfg.Backend.User, ...)
                },
                MaxConnections: newCfg.Pool.MaxConnections,
                // ...
            })
            newReaderPools[addr] = p
            slog.Info("reload: reader pool added", "addr", addr)
        }
    }

    // 제거된 Reader → 풀 Close
    for addr, p := range s.readerPools {
        if _, exists := newReaderPools[addr]; !exists {
            p.Close()
            slog.Info("reload: reader pool removed", "addr", addr)
        }
    }

    s.readerPools = newReaderPools
    // ...
}
```

핵심 전략: **기존에 있던 Reader는 풀을 그대로 유지**한다. 커넥션을 끊지 않으므로 진행 중인 쿼리에 영향이 없다. 새로 추가된 Reader만 풀을 생성하고, 제거된 Reader만 풀을 닫는다.

### Balancer 원자적 갱신

```go
func (r *RoundRobin) UpdateBackends(addrs []string) {
    backends := make([]*Backend, len(addrs))
    for i, addr := range addrs {
        b := &Backend{Addr: addr}
        b.healthy.Store(true)  // 새 백엔드는 healthy로 시작
        backends[i] = b
    }
    r.mu.Lock()
    r.backends = backends      // 포인터 교체 = 원자적
    r.mu.Unlock()
}
```

`Next()`에서 `RLock()`을 사용하고, `UpdateBackends()`에서 `Lock()`을 사용한다. 쓰기 락이 걸리는 순간은 포인터 교체 한 줄뿐이므로, 진행 중인 쿼리 라우팅에 거의 영향을 주지 않는다.

```go
func (r *RoundRobin) Next() string {
    r.mu.RLock()
    backends := r.backends  // 스냅샷
    r.mu.RUnlock()
    // ... 이후 스냅샷으로 작업
}
```

`Next()`가 백엔드 배열의 스냅샷을 먼저 취하므로, 이터레이션 중에 `UpdateBackends()`가 호출되어도 안전하다.

### Rate Limiter 동적 재설정

```go
// Rate Limiter도 교체
if newCfg.RateLimit.Enabled {
    s.rateLimiter = resilience.NewRateLimiter(newCfg.RateLimit.Rate, newCfg.RateLimit.Burst)
} else {
    s.rateLimiter = nil
}

s.cfg = newCfg
```

새로운 RateLimiter 인스턴스를 생성하고 포인터를 교체한다. 기존 RateLimiter의 토큰 상태는 리셋되지만, 이는 의도된 동작이다 — 설정이 바뀌었으므로 새로운 rate/burst로 시작하는 것이 맞다.

## 🧪 리로드 시나리오

### Reader 스케일 아웃

```yaml
# Before: Reader 2대
readers:
  - host: reader-1
    port: 5432
  - host: reader-2
    port: 5432

# After: Reader 3대 (reader-3 추가)
readers:
  - host: reader-1
    port: 5432
  - host: reader-2
    port: 5432
  - host: reader-3
    port: 5432
```

```bash
kill -HUP $(pidof pgmux)
```

결과:
- reader-1, reader-2: 기존 풀 유지, 커넥션 그대로
- reader-3: 새 풀 생성
- Balancer: 3대 라운드로빈으로 즉시 전환

### Rate Limit 긴급 조정

트래픽 급증 시 rate limit을 올려야 할 때:

```yaml
# rate: 1000 → 5000
rate_limit:
  enabled: true
  rate: 5000
  burst: 500
```

```bash
curl -X POST http://localhost:9090/admin/reload
# {"status":"reloaded"}
```

프록시 재시작 없이 즉시 적용된다.

## ⚠️ 리로드되지 않는 항목

모든 설정이 리로드 가능한 것은 아니다:

| 항목 | 리로드 가능 | 이유 |
|------|:---------:|------|
| Reader 목록 | ✅ | 풀 핫스왑 |
| Rate Limit | ✅ | 인스턴스 교체 |
| Writer 주소 | ❌ | Writer 풀 교체는 트랜잭션 안전성 보장 불가 |
| Proxy Listen | ❌ | 리스너 포트 변경은 재시작 필요 |
| TLS 인증서 | ❌ | tls.Config 교체 시 기존 연결 영향 |

Writer와 Listen 주소는 프록시의 근간이므로, 이를 바꾸려면 재시작이 필요하다. 이는 Nginx, HAProxy도 마찬가지다.

## 배운 점

1. **핫스왑의 핵심은 "기존 유지 + 차분만 변경"** — 전체를 교체하면 간단하지만 커넥션이 끊긴다. 기존 리소스를 식별하고 유지하는 것이 무중단의 핵심이다.
2. **RWMutex는 읽기 우선 시나리오에 적합** — `Next()`는 매 쿼리마다 호출되고, `UpdateBackends()`는 리로드 시에만 호출된다. RLock/Lock 분리로 읽기 성능을 유지하면서 안전한 갱신이 가능하다.
3. **두 가지 트리거(SIGHUP + HTTP)를 제공하라** — 환경에 따라 선호하는 방식이 다르다. 전통적 서버는 SIGHUP, 쿠버네티스는 HTTP API. 둘 다 제공하면 유연하다.
4. **리로드 불가 항목을 명시하라** — 모든 설정이 리로드 가능하다고 오해하면 운영 사고가 난다. 문서와 로그에 명확히 남겨야 한다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
