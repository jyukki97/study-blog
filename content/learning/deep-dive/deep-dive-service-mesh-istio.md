---
title: "Service Mesh (Istio): 마이크로서비스 통신 관리"
date: 2025-12-05
draft: false
topic: "DevOps"
tags: ["Service Mesh", "Istio", "Microservices", "Traffic Management", "Security"]
categories: ["Backend Deep Dive"]
description: "Istio Service Mesh로 마이크로서비스 간 통신을 관리하고 보안을 강화하는 방법 — 도입 판단 기준부터 트래픽 관리, mTLS, 관측성, 장애 주입까지 실무 설계 포인트를 정리합니다."
module: "ops-observability"
study_order: 325
---

## 이 글에서 얻는 것

- **Service Mesh**가 무엇이고, 어떤 규모에서 도입 효과가 있는지 판단 기준을 갖습니다.
- **Istio**의 아키텍처(Control Plane / Data Plane)를 이해하고 핵심 컴포넌트 역할을 설명할 수 있습니다.
- **트래픽 관리**(라우팅, 카나리, 서킷 브레이커), **보안**(mTLS, AuthorizationPolicy), **관측성**(메트릭, 분산 트레이싱) 세 축의 설정법을 익힙니다.
- 도입 전 체크리스트와 흔한 함정을 확인하여 실무에서의 시행착오를 줄입니다.

---

## 1) Service Mesh란?

### 핵심 정의

Service Mesh는 마이크로서비스 간 **네트워크 통신을 인프라 레이어에서 투명하게 관리**하는 아키텍처 패턴입니다.

```
기존 방식:
Service A → Service B
- 각 서비스가 직접 통신 로직 구현
- 재시도, 타임아웃, 로드 밸런싱 각자 구현
- 중복 코드, 일관성 문제

Service Mesh:
Service A → Sidecar Proxy → Sidecar Proxy → Service B
           ↓                             ↓
        Control Plane (Istio)

- Proxy가 통신 처리
- 애플리케이션 코드 변경 없음
- 중앙 집중식 관리
```

### 왜 필요한가?

서비스가 5~10개를 넘어가면 다음 문제가 반복됩니다:

| 문제 | Mesh 없이 | Mesh 적용 후 |
|---|---|---|
| 재시도/타임아웃 | 각 서비스에 라이브러리 직접 구현 | Proxy 레벨에서 일괄 적용 |
| mTLS 암호화 | 각 서비스에 인증서 관리 코드 | Sidecar가 자동 처리 |
| 트래픽 비율 조절 | 별도 로드밸런서 + 수동 설정 | VirtualService YAML 한 줄 |
| 분산 트레이싱 | 헤더 전파 코드 서비스마다 삽입 | Envoy가 자동 전파 |

> **판단 기준:** 서비스 10개 미만이고 팀이 1~2개라면 라이브러리(Resilience4j, Spring Cloud)로 충분합니다. 서비스가 늘고 폴리글랏(다중 언어) 환경이 되면 Mesh의 ROI가 올라갑니다.

---

## 2) Istio 아키텍처

### Control Plane vs Data Plane

```
┌──────────────────────────────────────┐
│           Control Plane              │
│  ┌──────────────────────────────┐    │
│  │          istiod               │    │
│  │  - Pilot (설정 배포)          │    │
│  │  - Citadel (인증서 발급)      │    │
│  │  - Galley (설정 검증)         │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
           ↓ xDS API (설정 동기화)
┌──────────────────────────────────────┐
│           Data Plane                 │
│  ┌────────┐   ┌────────┐            │
│  │ Pod A   │   │ Pod B   │           │
│  │ ┌────┐  │   │ ┌────┐  │           │
│  │ │App │  │   │ │App │  │           │
│  │ └──┬─┘  │   │ └──┬─┘  │           │
│  │ ┌──▼─┐  │   │ ┌──▼─┐  │           │
│  │ │Envoy│──┼───┼─│Envoy│ │           │
│  │ └────┘  │   │ └────┘  │           │
│  └────────┘   └────────┘            │
└──────────────────────────────────────┘
```

**핵심 컴포넌트 역할:**

- **istiod:** Pilot(라우팅 규칙 → Envoy 배포), Citadel(mTLS 인증서 자동 로테이션), Galley(설정 유효성 검증)을 단일 바이너리로 통합
- **Envoy Proxy:** 각 Pod에 Sidecar로 주입. 모든 인바운드/아웃바운드 트래픽을 가로채서 정책 적용
- **xDS API:** istiod가 Envoy에 설정을 동적으로 푸시하는 프로토콜 (LDS, RDS, CDS, EDS)

### Sidecar 주입 방식

```bash
# 네임스페이스 전체에 자동 주입 활성화
kubectl label namespace default istio-injection=enabled

# 특정 Pod만 수동 주입
istioctl kube-inject -f deployment.yaml | kubectl apply -f -
```

> **주의:** Sidecar가 Pod당 약 50~100MB 메모리를 추가 사용합니다. 노드 리소스 계획 시 반영해야 합니다.

---

## 3) 트래픽 관리

### VirtualService — 라우팅 규칙

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  # 특정 헤더가 있으면 v2로 라우팅 (테스터 전용)
  - match:
    - headers:
        user:
          exact: "tester"
    route:
    - destination:
        host: reviews
        subset: v2
  # 나머지 트래픽은 v1:90%, v2:10% (카나리 배포)
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 90
    - destination:
        host: reviews
        subset: v2
      weight: 10
```

### DestinationRule — 서브셋 + 연결 풀 설정

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100       # 최대 TCP 연결 수
      http:
        h2UpgradePolicy: DEFAULT
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 3     # 연속 5xx 3회 → 차단
      interval: 30s               # 체크 주기
      baseEjectionTime: 60s       # 최소 차단 시간
      maxEjectionPercent: 50      # 최대 50% 인스턴스까지 차단
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

### 카나리 배포 실전 순서

1. v2 Deployment 배포 (replicas: 1)
2. DestinationRule에 v2 서브셋 추가
3. VirtualService에서 weight: 5 → 10 → 25 → 50 → 100 단계적 증가
4. 각 단계에서 에러율/레이턴시 모니터링 → 이상 시 weight를 0으로 롤백

> **팁:** Flagger 또는 Argo Rollouts를 연동하면 메트릭 기반 자동 카나리 프로모션이 가능합니다.

### 서킷 브레이커 (Outlier Detection)

위 DestinationRule의 `outlierDetection`이 서킷 브레이커 역할을 합니다:

- 연속 5xx가 3회 발생하면 해당 인스턴스를 풀에서 **일시 제거**
- 60초 후 재투입 시도 → 다시 실패하면 차단 시간 2배 증가
- 전체 인스턴스의 50% 이상은 차단하지 않아 최소 가용성 보장

이 방식은 애플리케이션 코드의 Resilience4j 서킷 브레이커와 **중복 적용하지 않도록** 주의해야 합니다. 일반적으로 Mesh 레벨에서 인스턴스 단위 차단, 앱 레벨에서 논리적 서비스 단위 차단으로 역할을 분리합니다.

→ 관련 글: [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)

---

## 4) 보안

### mTLS 자동 암호화

```yaml
# 네임스페이스 전체에 STRICT mTLS 적용
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT  # 모든 통신 암호화 강제
```

**모드 선택 기준:**

| 모드 | 설명 | 사용 시점 |
|---|---|---|
| PERMISSIVE | Mesh 내/외부 모두 허용 | 마이그레이션 중, 점진 적용 |
| STRICT | mTLS만 허용 | 프로덕션, 보안 요구사항 충족 |
| DISABLE | mTLS 비활성화 | 특수 레거시 연동 |

> **마이그레이션 팁:** 처음에는 PERMISSIVE로 시작하여 모든 서비스가 Sidecar를 가진 것을 확인한 후 STRICT으로 전환합니다.

### AuthorizationPolicy — 서비스 간 접근 제어

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: payment-access
  namespace: production
spec:
  selector:
    matchLabels:
      app: payment-service
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/production/sa/order-service"]
    to:
    - operation:
        methods: ["POST"]
        paths: ["/api/v1/charge"]
```

이 정책은 `order-service`의 서비스 어카운트만 `payment-service`의 `/api/v1/charge` POST 요청을 허용합니다. **Zero Trust 원칙** — 기본 거부, 필요한 경로만 명시적 허용.

---

## 5) 관측성 (Observability)

Service Mesh의 가장 즉각적인 효과 중 하나가 **코드 변경 없이 얻는 관측성**입니다.

### 자동 수집되는 메트릭

Envoy가 모든 요청에 대해 자동으로 수집하는 지표:

- `istio_requests_total` — 요청 수 (source, destination, response_code 별)
- `istio_request_duration_milliseconds` — 레이턴시 히스토그램
- `istio_tcp_connections_opened_total` — TCP 연결 수

```promql
# 서비스별 에러율 (최근 5분)
sum(rate(istio_requests_total{response_code=~"5.."}[5m])) by (destination_service)
/
sum(rate(istio_requests_total[5m])) by (destination_service)
```

### 분산 트레이싱 연동

Envoy가 `x-request-id`, `x-b3-traceid` 등의 헤더를 자동 생성/전파합니다. 단, **애플리케이션이 수신한 헤더를 다음 호출에 전달**해야 end-to-end 트레이스가 연결됩니다.

```java
// Spring에서 헤더 전파 (RestTemplate 인터셉터 예시)
@Bean
public RestTemplate restTemplate() {
    RestTemplate rt = new RestTemplate();
    rt.setInterceptors(List.of((request, body, execution) -> {
        // Istio 트레이싱 헤더 전파
        HttpServletRequest req = ((ServletRequestAttributes)
            RequestContextHolder.getRequestAttributes()).getRequest();
        for (String header : List.of("x-request-id", "x-b3-traceid",
                "x-b3-spanid", "x-b3-parentspanid", "x-b3-sampled")) {
            String value = req.getHeader(header);
            if (value != null) request.getHeaders().add(header, value);
        }
        return execution.execute(request, body);
    }));
    return rt;
}
```

### Kiali 서비스 그래프

Istio에 포함된 Kiali 대시보드로 서비스 간 트래픽 흐름을 실시간 시각화할 수 있습니다:

```bash
# Kiali 대시보드 접근
istioctl dashboard kiali
```

---

## 6) 장애 주입 (Fault Injection)

프로덕션 환경의 장애 대응력을 테스트하려면 **의도적으로 장애를 주입**합니다:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: ratings-fault
spec:
  hosts:
  - ratings
  http:
  - fault:
      delay:
        percentage:
          value: 10    # 10% 요청에 3초 지연
        fixedDelay: 3s
      abort:
        percentage:
          value: 5     # 5% 요청에 503 반환
        httpStatus: 503
    route:
    - destination:
        host: ratings
```

**활용 시나리오:**
- 타임아웃/재시도 정책이 실제로 동작하는지 검증
- 서킷 브레이커가 예상대로 트리거되는지 확인
- 다운스트림 장애 시 UI의 Graceful Degradation 테스트

→ 관련 글: [Chaos Engineering](/learning/deep-dive/deep-dive-chaos-engineering/)

---

## 7) 도입 전 체크리스트

### ✅ 도입이 적합한 경우
- [ ] 서비스 10개 이상, 팀 3개 이상
- [ ] 폴리글랏 환경 (Java + Go + Python 등)
- [ ] mTLS/Zero Trust 보안 요구사항 존재
- [ ] 카나리/블루-그린 배포를 인프라 레벨에서 관리하고 싶음
- [ ] 분산 트레이싱을 코드 변경 최소화로 도입하고 싶음

### ⚠️ 흔한 함정
- **리소스 오버헤드 무시:** Sidecar당 50~100MB, CPU 10~50m. 100개 Pod이면 5~10GB 추가
- **디버깅 복잡도 증가:** 네트워크 문제가 Envoy 레이어에서 발생하면 기존 도구로 추적 어려움 → `istioctl proxy-status`, `istioctl analyze` 활용
- **점진적 마이그레이션 미계획:** 전체 한번에 STRICT mTLS 적용 → 비Mesh 서비스와 통신 단절
- **설정 폭발:** VirtualService/DestinationRule이 서비스 수만큼 증가 → GitOps(ArgoCD)와 병행 필수

---

## 요약

| 축 | 핵심 기능 | Istio 리소스 |
|---|---|---|
| 트래픽 관리 | 라우팅, 카나리, 서킷 브레이커 | VirtualService, DestinationRule |
| 보안 | mTLS, 서비스 간 접근 제어 | PeerAuthentication, AuthorizationPolicy |
| 관측성 | 메트릭, 트레이싱, 서비스 그래프 | 자동 수집 + Kiali/Prometheus |
| 장애 테스트 | 지연/에러 주입 | VirtualService (fault) |

**핵심 원칙:** Service Mesh는 "통신 로직을 인프라로 내린다"는 설계 철학입니다. 애플리케이션은 비즈니스 로직에만 집중하고, 재시도/암호화/관측은 Proxy가 담당합니다.

---

## 연습

1. 기존 프로젝트의 서비스 간 통신에서 **재시도/타임아웃 코드가 중복**된 곳을 찾아보세요.
2. 현재 서비스 규모에서 Mesh 도입 ROI를 위 체크리스트로 평가해보세요.
3. mTLS PERMISSIVE → STRICT 전환 시 **영향받는 외부 연동 서비스**를 목록화해보세요.

---

## 다음 단계

- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — Mesh의 기반 인프라
- [마이크로서비스 패턴](/learning/deep-dive/deep-dive-microservices-patterns/) — Mesh가 해결하는 통신 문제의 원인
- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/) — 앱 레벨 vs Mesh 레벨 역할 분리
- [분산 트레이싱](/learning/deep-dive/deep-dive-distributed-tracing-advanced/) — Mesh 관측성의 다음 단계
