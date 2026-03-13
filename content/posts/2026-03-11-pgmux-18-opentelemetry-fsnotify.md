---
title: "Go로 PostgreSQL 프록시 만들기 (18) - OpenTelemetry 분산 추적과 설정 자동 리로드"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "OpenTelemetry", "Observability", "fsnotify", "Kubernetes"]
categories: ["Database"]
project: "pgmux"
description: "프록시 내부 처리 단계를 OpenTelemetry Span으로 계측하고, fsnotify로 설정 파일 변경을 자동 감지하여 무중단 리로드하는 과정을 다룬다."
---

## 들어가며

지난 글에서 Channel Blocking과 Connection Poisoning 버그를 수정했다. 프록시의 핵심 기능이 안정화된 이 시점에서, 운영 환경에서의 가시성과 편의성을 높이는 두 가지 기능을 추가한다.

1. **OpenTelemetry 분산 추적** — 쿼리가 프록시 내부에서 어디에 시간을 쓰는지 Span으로 시각화
2. **fsnotify 설정 자동 리로드** — `config.yaml` 수정 시 자동으로 무중단 리로드

---

## 1. OpenTelemetry 분산 추적

### 왜 필요한가

Prometheus 메트릭으로 "평균 쿼리 레이턴시가 50ms"라는 것은 알 수 있지만, 그 50ms가 캐시 조회에 쓰인 건지, 풀 대기에 쓰인 건지, 실제 DB 실행에 쓰인 건지는 알 수 없다. MSA 환경에서는 프록시 계층의 지연이 전체 호출 체인에서 어떤 비중인지 추적하는 것이 핵심이다.

OpenTelemetry는 이 문제를 **Span** 단위의 분산 추적으로 해결한다.

### TracerProvider 초기화

`internal/telemetry/telemetry.go`에 `Init()` 함수를 구현했다.

```go
func Init(cfg config.TelemetryConfig) (shutdown func(context.Context) error, err error) {
    if !cfg.Enabled {
        return func(context.Context) error { return nil }, nil
    }

    res, _ := resource.New(ctx,
        resource.WithAttributes(
            semconv.ServiceName(cfg.ServiceName),
            semconv.ServiceVersion(Version),
        ),
    )

    var exporter sdktrace.SpanExporter
    switch cfg.Exporter {
    case "otlp":
        exporter, _ = otlptracegrpc.New(ctx,
            otlptracegrpc.WithEndpoint(cfg.Endpoint),
            otlptracegrpc.WithInsecure(),
        )
    case "stdout":
        exporter, _ = stdouttrace.New(stdouttrace.WithWriter(os.Stdout))
    }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithResource(res),
        sdktrace.WithSampler(sampler),
    )

    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))

    return tp.Shutdown, nil
}
```

핵심 설계 결정:

- **`enabled: false`이면 noop** — 전역 TracerProvider가 기본 noop이므로, 비활성 시 Span 생성 코드가 남아 있어도 오버헤드가 없다.
- **Batcher 사용** — `WithBatcher()`로 Span을 일괄 전송하여 네트워크 오버헤드를 최소화한다.
- **W3C Propagator** — `traceparent` 헤더 표준을 따라 다른 서비스와의 trace 연결이 자연스럽다.

### Span 구조 설계

프록시의 쿼리 처리 경로를 분석하여, 각 단계에 Span을 배치했다.

**Simple Query 경로:**

```
pgmux.query (root)
├── pgmux.parse          # 쿼리 분류 (Classify/ClassifyAST)
├── pgmux.cache.lookup   # 캐시 조회 (읽기 쿼리)
├── pgmux.pool.acquire   # 커넥션 풀 획득 대기
├── pgmux.backend.exec   # 백엔드 DB 실행
└── pgmux.cache.store    # 캐시 저장 (미스 시)
```

**Extended Query 경로:**

```
pgmux.extended_query (root)
├── pgmux.pool.acquire
└── pgmux.backend.exec
```

실제 계측 코드:

```go
// proxy/server.go — Simple Query 처리
queryCtx, querySpan := telemetry.Tracer().Start(ctx, "pgmux.query",
    trace.WithAttributes(
        attribute.String("db.system", "postgresql"),
        attribute.String("db.statement", truncateSQL(query)),
        attribute.String("db.operation", operation),
        attribute.String("pgmux.route", routeName),
    ),
)
defer querySpan.End()

_, parseSpan := telemetry.Tracer().Start(queryCtx, "pgmux.parse")
route := session.Route(query)
parseSpan.End()
```

각 Span에는 [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)에 맞는 attribute를 부여했다:
- `db.system=postgresql` — DB 종류
- `db.statement` — 쿼리 앞 100자 (보안상 트렁케이션)
- `db.operation` — SELECT, INSERT 등
- `pgmux.route` — writer 또는 reader
- `pgmux.cached` — 캐시 히트 여부

### Data API trace 전파

Serverless Data API는 HTTP 기반이므로 `traceparent` 헤더를 통한 trace 전파가 자연스럽다.

```go
// dataapi/handler.go
func (h *Handler) handleQuery(w http.ResponseWriter, r *http.Request) {
    // HTTP 헤더에서 trace context 추출
    ctx := otel.GetTextMapPropagator().Extract(r.Context(),
        propagation.HeaderCarrier(r.Header))

    ctx, querySpan := telemetry.Tracer().Start(ctx, "pgmux.dataapi.query",
        trace.WithAttributes(
            attribute.String("db.system", "postgresql"),
        ),
    )
    defer querySpan.End()
    // ... 이후 모든 Span이 이 부모 context를 사용
}
```

이렇게 하면 외부 서비스 → Data API → 프록시 → DB까지 하나의 trace로 연결된다.

### 설정

```yaml
telemetry:
  enabled: true
  exporter: "otlp"
  endpoint: "localhost:4317"
  service_name: "pgmux"
  sample_ratio: 1.0          # 프로덕션에서는 0.1 정도로 낮추기
```

Jaeger를 로컬에서 띄우면 바로 trace를 확인할 수 있다:

```bash
docker run -d --name jaeger \
  -p 4317:4317 -p 16686:16686 \
  jaegertracing/jaeger:latest
```

---

## 2. fsnotify 설정 자동 리로드

### 기존 방식의 한계

Phase 11에서 구현한 무중단 리로드는 두 가지 트리거를 지원한다:

1. `kill -HUP <pid>` — SIGHUP 시그널
2. `POST /admin/reload` — Admin API

둘 다 **사람이 직접 트리거**해야 한다는 공통점이 있다. K8s에서 ConfigMap을 업데이트하면 파일은 자동으로 바뀌지만, 프록시에 "설정 바뀌었으니 읽어라"고 알려주는 건 별도 작업이 필요했다.

### FileWatcher 구현

`internal/config/watcher.go`에 `FileWatcher`를 구현했다.

```go
type FileWatcher struct {
    path     string
    fileName string
    onChange func()
    watcher  *fsnotify.Watcher
    stopCh   chan struct{}
}
```

핵심 설계:

**1. 부모 디렉토리를 감시한다**

파일 자체가 아니라 파일이 위치한 디렉토리를 watch한다. 이유는 K8s ConfigMap 때문이다.

K8s는 ConfigMap을 마운트할 때 다음 구조를 사용한다:

```
/etc/config/
├── ..data → ..2026_03_11_12_00 (symlink)
├── ..2026_03_11_12_00/
│   └── config.yaml
└── config.yaml → ..data/config.yaml (symlink)
```

ConfigMap이 업데이트되면 K8s는 새 디렉토리(`..2026_03_11_13_00`)를 만들고 `..data` symlink를 atomic하게 교체한다. 파일 자체를 watch하면 symlink swap을 감지하지 못한다.

```go
func (fw *FileWatcher) isTargetEvent(event fsnotify.Event) bool {
    if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) == 0 {
        return false
    }
    eventBase := filepath.Base(event.Name)
    if eventBase == fw.fileName {
        return true
    }
    // K8s ConfigMap symlink swap 감지
    if event.Op&fsnotify.Create != 0 && strings.HasPrefix(eventBase, "..") {
        return true
    }
    return false
}
```

**2. 1초 디바운싱**

텍스트 에디터는 저장 시 임시 파일 생성 → 쓰기 → rename 등 여러 이벤트를 발생시킨다. `time.AfterFunc`로 마지막 이벤트로부터 1초 후에 콜백을 실행한다.

```go
if debounceTimer != nil {
    debounceTimer.Stop()
}
debounceTimer = time.AfterFunc(debounceInterval, fw.onChange)
```

**3. 기존 리로드 경로 재사용**

`main.go`에서의 통합은 간단하다. 콜백으로 기존 `reloadConfig()`를 그대로 넘긴다.

```go
if cfg.ConfigOptions.Watch {
    fw, _ := config.NewFileWatcher(cfgPath, func() {
        slog.Info("config file changed, reloading", "path", cfgPath)
        if err := reloadConfig(cfgPath, srv); err != nil {
            slog.Error("config reload failed", "error", err)
        }
    })
    defer fw.Stop()
    go fw.Start(ctx)
}
```

### 테스트

4가지 시나리오를 테스트했다:

1. **파일 수정 감지** — `WriteFile()` 후 콜백 1회 호출 확인
2. **디바운싱** — 100ms 간격으로 5회 수정 → 콜백 1회만 호출
3. **Symlink swap** — K8s ConfigMap 방식 재현 (`os.Symlink` + `os.Rename`)
4. **Stop 안전성** — `Stop()` 후 이벤트 무시, 이중 `Stop()` panic 없음

### 설정

```yaml
config:
  watch: true    # 기본값: false
```

---

## 마무리

이번 Phase에서 추가한 두 기능의 공통점은 **운영 편의성**이다.

- OpenTelemetry로 "쿼리가 느린데 어디서 느린 거지?"라는 질문에 Span 단위로 답할 수 있게 되었다.
- fsnotify로 K8s ConfigMap 업데이트 시 수동 개입 없이 설정이 반영된다.

프록시의 핵심 기능(풀링, 라우팅, 캐싱)은 이미 완성되었고, 이제 프로덕션 운영에 필요한 관측성과 자동화를 갖추어 가고 있다.

다음에는 **Prepared Statement Multiplexing** PoC를 다룰 예정이다. PgBouncer의 가장 큰 맹점을 해결하는 킬러 피처인 만큼, 보안(SQL Injection 방어)과 호환성(ORM 드라이버)에 특히 주의를 기울여야 한다.
