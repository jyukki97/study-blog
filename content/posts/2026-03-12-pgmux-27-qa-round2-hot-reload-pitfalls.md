---
title: "Go로 PostgreSQL 프록시 만들기 (27) - QA 라운드 2: 핫 리로드의 5가지 함정"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Hot Reload", "ConfigMap", "fsnotify", "Data Race", "Cache Invalidation"]
categories: ["Database"]
description: "QA에서 발견된 5가지 버그 — Data API 인증 stale, 캐시 전파 누락, ConfigMap symlink 미감지, Reload 주석 불일치, 테스트 race — 의 원인 분석과 수정 과정을 정리한다."
---

## 들어가며

P26에서 CancelRequest, Graceful Shutdown, Balancer Data Race를 수정한 직후 QA 라운드 2가 도착했다. 이번에는 5건 — 높음 3건, 중간 2건.

공통 키워드가 있다. **핫 리로드**. 설정을 바꿔도 반영이 안 되거나, 반영된 줄 알았는데 절반만 반영되거나, 다른 인스턴스에는 아예 안 되거나. "운영 중 무중단으로 설정을 바꾸겠다"는 건 생각보다 어려운 약속이다.

1. **Data API 인증 stale** — API 키를 바꿔도 재시작 전까지 안 먹힌다
2. **캐시 무효화 전파 누락** — Data API로 쓰면 다른 인스턴스가 stale 캐시를 서빙한다
3. **ConfigMap symlink 미감지** — K8s에서 설정 교체가 조용히 무시된다
4. **Reload() 주석 거짓말** — 문서는 "가능"이라는데 실제로는 안 된다
5. **Audit 테스트 race** — `go test -race`에서 터진다

---

## 버그 1: Data API 인증이 핫 리로드를 무시한다

### 증상

`config.yaml`에서 API 키를 교체하고 `kill -HUP`를 보내도, 이전 키로 계속 인증이 통과한다. 새 키는 거부된다. 프록시를 재시작하면 정상.

### 원인

`dataapi/handler.go`의 `New()`:

```go
func New(cfgFn func() *config.Config, ...) *Server {
    cfg := cfgFn()
    keys := make(map[string]bool, len(cfg.DataAPI.APIKeys))
    for _, k := range cfg.DataAPI.APIKeys {
        keys[k] = true
    }
    return &Server{
        apiKeys: keys,  // 스냅샷 — 이후 절대 갱신 안 됨
    }
}
```

다른 필드(`cfgFn`, `writerPoolFn`, `readerPoolsFn`)는 getter 함수로 매번 최신 값을 조회한다. 하지만 `apiKeys`만 `New()` 시점의 스냅샷이다. HF-6(#116)에서 getter 패턴을 도입할 때 이 필드를 놓친 것.

### 수정

`apiKeys` 맵을 제거하고, 인증 체크 시 `cfgFn()`에서 직접 읽도록 변경:

```go
// Before: frozen map
if len(s.apiKeys) > 0 {
    if !s.apiKeys[token] { ... }
}

// After: live config
apiKeys := s.cfgFn().DataAPI.APIKeys
if len(apiKeys) > 0 {
    allowed := false
    for _, k := range apiKeys {
        if k == token { allowed = true; break }
    }
    if !allowed { ... }
}
```

슬라이스 순회가 map lookup보다 느리지만, API 키가 보통 1~5개 수준이라 문제없다.

---

## 버그 2: Data API 쓰기가 다른 인스턴스에 전파되지 않는다

### 증상

멀티 노드 환경에서 Data API(HTTP)로 `INSERT`를 실행하면, 같은 인스턴스의 캐시는 무효화되지만 다른 인스턴스는 stale 캐시를 계속 서빙한다.

### 원인

TCP 프록시의 write path(`backend.go`):

```go
// 1. 로컬 캐시 무효화
s.queryCache.InvalidateTable(table)
// 2. 다른 인스턴스에 전파 ✓
if s.invalidator != nil {
    s.invalidator.Publish(ctx, tables)
}
```

Data API의 write path(`handler.go`):

```go
// 1. 로컬 캐시 무효화
queryCache.InvalidateTable(table)
// 2. 다른 인스턴스에 전파 ← 없음!
```

Data API `Server` 구조체에 `invalidator` 참조 자체가 없었다.

### 수정

`invalidatorFn func() *cache.Invalidator`를 `Server`에 추가하고, `executeWrite()`에서 Publish:

```go
if s.invalidatorFn != nil {
    if inv := s.invalidatorFn(); inv != nil && len(tables) > 0 {
        inv.Publish(context.Background(), tables)
    }
}
```

`main.go`의 `dataapi.New()` 호출에도 getter를 전달한다.

---

## 버그 3: K8s ConfigMap symlink swap을 못 잡는다

### 증상

K8s에서 ConfigMap을 업데이트하면 pgmux가 설정 변경을 감지하지 못한다. `config_options.watch: true`인데도 콜백이 0회.

### 원인

K8s ConfigMap 마운트의 내부 구조:

```
/etc/config/
  config.yaml → ..data/config.yaml (symlink)
  ..data → ..2026_03_10_12_00_00.1234 (symlink)
  ..2026_03_10_12_00_00.1234/config.yaml (실제 파일)
```

업데이트 시 K8s는:
1. 새 디렉토리 `..2026_03_12_...`를 생성
2. `..data_tmp` symlink를 새 디렉토리로 생성
3. `os.Rename(..data_tmp, ..data)` — **atomic swap**

`watcher.go`의 `isTargetEvent()`:

```go
// 문제: Create만 체크
if event.Op&fsnotify.Create != 0 && strings.HasPrefix(eventBase, "..") {
    return true
}
```

`os.Rename()`은 OS에 따라 다른 이벤트를 생성한다:
- **Linux (inotify)**: 보통 `CREATE` → 통과
- **macOS (kqueue)**: `RENAME` 또는 `REMOVE` → **차단됨**

### 수정

`..` 접두사 엔트리에 대해 모든 mutation 이벤트를 허용:

```go
// Before: CREATE만
if event.Op&fsnotify.Create != 0 && strings.HasPrefix(eventBase, "..") {

// After: 모든 이벤트
if event.Op != 0 && strings.HasPrefix(eventBase, "..") {
```

직접 파일 매칭(`eventBase == fw.fileName`)은 여전히 `Write|Create|Rename`으로 제한한다. `..` 접두사 엔트리는 K8s가 관리하는 내부 구조물이므로 어떤 이벤트든 설정 변경 신호로 취급해도 안전하다.

---

## 버그 4: Reload() 주석이 거짓말을 한다

### 증상

주석:
```go
// Reloadable: readers, pool sizes, cache TTL, rate limit settings.
```

실제 동작:
- **reader list**: add/remove 동작 ✓
- **pool sizes**: 기존 reader pool은 원래 설정 그대로 ✗
- **cache TTL**: `cache.New()` 시점에 고정 ✗
- **rate limit**: 새 limiter 생성 ✓

운영자가 `max_connections: 50`으로 올리고 리로드했는데, 실제 풀 크기는 20 그대로. 로그에 "config reloaded" 떴으니 적용됐다고 생각하지만.

### 수정

코드를 고치는 것보다 주석을 고치는 게 맞는 판단이다. Pool size, cache TTL을 런타임에 바꾸려면 풀 drain → 재생성 또는 cache 재초기화가 필요한데, 이는 running 쿼리에 영향을 주는 위험한 변경이다.

```go
// Before
// Reloadable: readers, pool sizes, cache TTL, rate limit settings.
// NOT reloadable: proxy.listen, writer address.

// After
// Reloadable: reader list (add/remove), rate limit settings.
// NOT reloadable: proxy.listen, writer address, pool sizes (existing pools), cache TTL.
```

---

## 버그 5: Audit 테스트 Data Race

### 증상

`go test -race ./internal/audit/...` 실패. `webhookInterval` 필드 동시 읽기/쓰기.

### 원인

```go
// New()에서 goroutine 시작
l.wg.Add(1)
go l.cleanupWebhookDedup()  // webhookInterval 읽기

// 테스트에서 goroutine 시작 후 쓰기
l := New(Config{...})
l.webhookInterval = 10 * time.Second  // ← race!
```

`cleanupWebhookDedup()`이 시작하면서 `l.webhookInterval`을 읽는 시점과, 테스트 코드가 쓰는 시점이 겹친다.

### 수정

이미 `WebhookConfig.DedupInterval` 필드가 있고 `New()`에서 이를 사용한다. 테스트에서 직접 필드를 변경하지 말고 Config으로 전달:

```go
// Before
l := New(Config{Webhook: WebhookConfig{Enabled: true, URL: ts.URL}})
l.webhookInterval = 10 * time.Second  // race!

// After
l := New(Config{Webhook: WebhookConfig{
    Enabled:       true,
    URL:           ts.URL,
    DedupInterval: 10 * time.Second,  // 생성 시점에 설정
}})
```

---

## 5가지 버그의 공통 패턴

모든 버그가 **핫 리로드**와 관련 있다.

| 버그 | 패턴 | 교훈 |
|------|------|------|
| apiKeys stale | 초기화 시 스냅샷 | getter 패턴을 도입했으면 **모든** 필드에 일관 적용 |
| invalidation 누락 | 경로별 동작 불일치 | 같은 "쓰기"를 두 곳에서 하면 사이드이펙트도 동일해야 |
| symlink swap | OS별 이벤트 차이 | cross-platform은 "관대하게 수용, 엄격하게 디바운스" |
| Reload 주석 | 문서/코드 괴리 | 코드가 할 수 없는 걸 주석이 약속하면 안 된다 |
| 테스트 race | 생성 후 필드 변경 | goroutine이 시작된 후 필드를 바꾸면 반드시 race |

**핫 리로드의 본질적 어려움**: 프로그램의 모든 상태를 "최초 설정"과 "현재 설정"으로 이중 관리해야 한다. 하나라도 놓치면 stale 상태가 되고, 운영자는 "리로드했는데 왜 안 되지?"를 경험한다.

---

## 마무리

- **높음 3건**: Data API 인증/캐시 전파, ConfigMap symlink — 모두 "리로드 후 반영 안 됨" 계열
- **중간 2건**: 주석 오류, 테스트 race — 코드 품질 개선
- **공통 교훈**: 핫 리로드를 지원하려면 모든 mutable state에 대해 "이것도 리로드 대상인가?"를 체크리스트로 관리해야 한다

QA는 코드를 "다른 눈"으로 보는 과정이다. 개발자가 "당연히 되겠지"라고 넘긴 부분을 QA가 "정말요?"라고 물으면, 대부분 안 된다.
