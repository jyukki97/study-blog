---
title: "Go로 PostgreSQL 프록시 만들기 (36) - Grafana Dashboard 템플릿"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Grafana", "Prometheus", "Observability", "Monitoring"]
categories: ["Database"]
project: "pgmux"
description: "pgmux의 17개 Prometheus 메트릭을 한눈에 볼 수 있는 Grafana 대시보드 템플릿을 만들고, Helm Chart로 자동 배포하는 방법을 다룬다."
---

## 들어가며

pgmux는 이미 17개의 Prometheus 메트릭을 노출하고 있다. 커넥션 풀, 쿼리 라우팅, 캐시, 방화벽, Replication Lag, Audit까지 운영에 필요한 지표는 충분하다. 하지만 메트릭이 있다고 관측성이 확보된 건 아니다. 운영자가 매번 PromQL을 작성해서 대시보드를 만들어야 한다면 진입장벽이 높다.

Traefik, Envoy, CoreDNS 같은 인프라 오픈소스들은 리포에 Grafana 대시보드 JSON을 함께 제공한다. 경쟁 제품인 PgCat도 공식 대시보드를 배포한다. Import 한 번이면 바로 모니터링을 시작할 수 있다.

이번 글에서는 pgmux의 Grafana 대시보드 템플릿 설계와 Helm Chart 연동을 다룬다.

---

## 대시보드 설계

### 섹션 구성

대시보드를 8개 섹션으로 나눴다. 위에서 아래로 갈수록 세부적인 정보를 보여주는 구조다:

| 섹션 | 패널 | 목적 |
|------|------|------|
| **Overview** | Total QPS, Avg Latency, Cache Hit Rate, Open Connections | 운영자가 한눈에 상태 파악 |
| **Query Routing** | QPS by Target, Duration P50/P99, Target별 P50/P99, Reader Fallback | Writer/Reader 부하 분산 확인 |
| **Connection Pool** | Open/Idle Connections, Acquire Duration P50/P99, Acquires/sec | 풀 포화도 감지 |
| **Cache** | Hits/Misses Stacked, Hit Rate Gauge, Entries & Invalidations | 캐시 효율 추적 |
| **Security** | Firewall Blocked, Rate Limited | 차단/제한 현황 |
| **Replication** | LSN Lag per Reader | Replica 지연 감시 |
| **Audit** | Slow Queries, Webhook Sent/Errors | 느린 쿼리 추세 |
| **Query Digest** | Unique Patterns | 쿼리 다양성 추이 |

### Overview — Stat 패널 4개

가장 위에 놓이는 요약 패널이다. Grafana의 `stat` 타입을 사용해 큰 숫자 하나로 핵심 지표를 보여준다:

```
┌──────────┬──────────┬──────────┬──────────┐
│ Total QPS│ Avg Lat  │ Cache HR │ Open Conn│
│  1,234   │  2.3ms   │  87%     │    42    │
└──────────┴──────────┴──────────┴──────────┘
```

**Total QPS**의 PromQL:

```promql
sum(rate(pgmux_queries_routed_total[$__rate_interval]))
```

**Cache Hit Rate**는 비율 계산이 필요하다:

```promql
rate(pgmux_cache_hits_total[$__rate_interval])
/ (rate(pgmux_cache_hits_total[$__rate_interval])
 + rate(pgmux_cache_misses_total[$__rate_interval]))
```

각 패널에 threshold를 설정해서 색상으로 상태를 표현한다. Cache Hit Rate는 80% 이상이면 녹색, 50~80%면 노란색, 50% 미만이면 빨간색이다.

### Query Duration — Histogram Quantile

pgmux는 쿼리 레이턴시를 Histogram으로 기록한다:

```go
Buckets: []float64{.0001, .0005, .001, .005, .01, .05, .1, .5, 1}
```

100us부터 1초까지 9개 버킷이다. 이걸로 P50/P99를 계산한다:

```promql
// P50
histogram_quantile(0.50,
  sum by (le) (rate(pgmux_query_duration_seconds_bucket[$__rate_interval])))

// P99
histogram_quantile(0.99,
  sum by (le) (rate(pgmux_query_duration_seconds_bucket[$__rate_interval])))
```

Target별(writer/reader)로도 분리해서 보여준다:

```promql
histogram_quantile(0.50,
  sum by (le, target) (rate(pgmux_query_duration_seconds_bucket[$__rate_interval])))
```

### Connection Pool — role/addr 라벨 활용

풀 메트릭은 `role`(writer/reader)과 `addr` 라벨이 있다:

```go
PoolOpenConns: prometheus.NewGaugeVec(
    prometheus.GaugeOpts{Name: "pgmux_pool_connections_open"},
    []string{"role", "addr"},
)
```

대시보드에서 `{{role}} {{addr}}`로 legend를 구성하면 "writer 10.0.1.1:5432", "reader 10.0.1.2:5432" 같은 형태로 구분된다.

### Cache — Stacked Area로 Hit/Miss 비율 시각화

Hits와 Misses를 stacked area chart로 그리면 전체 요청 중 캐시가 처리하는 비율을 직관적으로 볼 수 있다:

```json
"stacking": { "group": "A", "mode": "normal" }
```

Hits는 녹색, Misses는 주황색으로 고정했다. 녹색 영역이 넓을수록 캐시가 잘 동작하고 있다는 뜻이다.

별도로 Gauge 패널을 두어 현재 Hit Rate를 반원 게이지로 보여준다. 80% 이상 녹색, 50~80% 노란색, 50% 미만 빨간색이다.

### Replication Lag — Reader별 바이트 단위

LSN Lag을 바이트 단위로 표시한다:

```promql
pgmux_reader_lsn_lag_bytes
```

Grafana unit을 `decbytes`로 설정하면 자동으로 KB/MB/GB로 변환해 보여준다. Reader 주소별로 선이 분리되어 어떤 Replica가 뒤처지는지 바로 확인할 수 있다.

---

## Helm Chart 연동

### Grafana Sidecar 패턴

Kubernetes에서 Grafana를 운영할 때 흔히 사용하는 패턴이 **sidecar 자동 로드**다. Grafana Helm chart의 sidecar가 `grafana_dashboard: "1"` 라벨이 붙은 ConfigMap을 감시하다가, 발견하면 자동으로 대시보드를 로드한다.

### ConfigMap 템플릿

```yaml
{{- if .Values.grafanaDashboard.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "pgmux.fullname" . }}-grafana-dashboard
  labels:
    grafana_dashboard: "1"
data:
  pgmux-overview.json: |-
    {{- .Files.Get "dashboards/pgmux-overview.json" | nindent 4 }}
{{- end }}
```

Helm의 `.Files.Get`으로 차트 내부의 JSON 파일을 읽어 ConfigMap에 넣는다. `grafanaDashboard.enabled: true`로 설정하면 배포 시 자동으로 생성된다.

### 사용법

**Grafana UI에서 직접 Import:**

1. Grafana → Dashboards → Import
2. `deploy/grafana/pgmux-overview.json` 업로드
3. Prometheus 데이터소스 선택

**Helm으로 자동 배포:**

```bash
helm install pgmux deploy/helm/pgmux/ \
  --set grafanaDashboard.enabled=true
```

---

## `__inputs` — Import 시 데이터소스 바인딩

Grafana에서 JSON을 Import할 때 데이터소스를 선택하게 하려면 `__inputs`를 정의해야 한다:

```json
{
  "__inputs": [
    {
      "name": "DS_PROMETHEUS",
      "label": "Prometheus",
      "type": "datasource",
      "pluginId": "prometheus"
    }
  ]
}
```

패널의 datasource에서 `${DS_PROMETHEUS}`를 참조하면, Import 시 사용자가 자신의 Prometheus 인스턴스를 선택할 수 있다. ConfigMap으로 배포할 때는 Grafana sidecar가 기본 데이터소스로 자동 바인딩한다.

---

## 대시보드 패널 상세

### 전체 패널 목록

| # | 패널 | 타입 | 메트릭 |
|---|------|------|--------|
| 1 | Total QPS | stat | `pgmux_queries_routed_total` |
| 2 | Avg Query Latency | stat | `pgmux_query_duration_seconds` |
| 3 | Cache Hit Rate | stat | `pgmux_cache_hits_total`, `pgmux_cache_misses_total` |
| 4 | Open Connections | stat | `pgmux_pool_connections_open` |
| 5 | QPS by Target | timeseries | `pgmux_queries_routed_total{target}` |
| 6 | Query Duration P50/P99 | timeseries | `pgmux_query_duration_seconds_bucket` |
| 7 | Duration by Target P50/P99 | timeseries | `pgmux_query_duration_seconds_bucket{target}` |
| 8 | Reader Fallback | timeseries | `pgmux_reader_fallback_total` |
| 9 | Open Connections | timeseries | `pgmux_pool_connections_open{role, addr}` |
| 10 | Idle Connections | timeseries | `pgmux_pool_connections_idle{role, addr}` |
| 11 | Pool Acquire Duration | timeseries | `pgmux_pool_acquire_duration_seconds_bucket` |
| 12 | Pool Acquires/sec | timeseries | `pgmux_pool_acquires_total{role, addr}` |
| 13 | Cache Hits/Misses | timeseries (stacked) | `pgmux_cache_hits_total`, `pgmux_cache_misses_total` |
| 14 | Cache Hit Rate | gauge | 계산식 |
| 15 | Cache Entries & Invalidations | timeseries (dual axis) | `pgmux_cache_entries`, `pgmux_cache_invalidations_total` |
| 16 | Firewall Blocked | timeseries (bars) | `pgmux_firewall_blocked_total{rule}` |
| 17 | Rate Limited | timeseries | `pgmux_rate_limited_total` |
| 18 | Reader LSN Lag | timeseries | `pgmux_reader_lsn_lag_bytes{addr}` |
| 19 | Slow Queries | timeseries (bars) | `pgmux_slow_queries_total{target}` |
| 20 | Audit Webhook | timeseries | `pgmux_audit_webhook_sent_total`, `pgmux_audit_webhook_errors_total` |
| 21 | Unique Query Patterns | timeseries | `pgmux_digest_patterns` |

17개 Prometheus 메트릭 전체를 21개 패널로 시각화했다.

---

## 마무리

메트릭을 수집하는 것과 모니터링하는 것은 다른 문제다. Prometheus가 데이터를 긁어가고 있어도, 대시보드가 없으면 운영자는 매번 PromQL을 떠올려야 한다.

대시보드 JSON 하나를 리포에 넣는 건 작은 작업이지만, 사용자 경험에서는 큰 차이를 만든다. "메트릭이 있으니 알아서 보세요"와 "Import 한 번이면 됩니다"의 차이다.

다음 글에서는 PgBouncer 대비 성능 벤치마크를 다룰 예정이다.
