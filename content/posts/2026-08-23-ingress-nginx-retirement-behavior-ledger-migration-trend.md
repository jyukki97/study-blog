---
title: "2026 개발 트렌드: Post-Ingress-NGINX Migration, YAML 변환이 아니라 라우팅 행위 계약을 옮겨야 한다"
date: 2026-08-23T10:06:00+09:00
lastmod: 2026-08-23T10:06:00+09:00
draft: false
tags: ["Kubernetes", "Ingress-NGINX", "Gateway API", "Platform Engineering", "Traffic Migration", "Cloud Native"]
categories: ["Development", "Platform Engineering", "DevOps"]
series: "2026 개발 운영 트렌드"
keywords: ["Ingress-NGINX retirement", "Gateway API migration", "Ingress2Gateway", "routing behavior ledger", "Kubernetes traffic cutover"]
description: "2026년 3월 종료된 Ingress-NGINX와 Ingress2Gateway 1.0, Gateway API 마이그레이션 가이드를 바탕으로, annotation 변환이 아닌 실제 URL·우선순위·리다이렉트·TLS 행위를 검증하는 전환 기준을 정리합니다."
summary: "Ingress-NGINX에서 Gateway API로 옮기는 일은 리소스 종류를 바꾸는 작업이 아닙니다. 정규식, path 우선순위, trailing slash, URL 정규화, default backend, TLS와 client IP 처리처럼 기존에 우연히 기대던 행위를 목록화하고, 별도 데이터 플레인에서 실제 요청으로 검증하는 migration engineering입니다."
key_takeaways:
  - "Ingress-NGINX는 2026년 3월에 유지보수가 종료되었으므로, 계속 동작한다는 사실은 보안 패치와 호환성 지원이 남아 있다는 뜻이 아니다."
  - "Ingress annotation과 Gateway API 필드의 이름이 비슷해도 regex 범위, path 우선순위, URL 정규화, default backend, TLS 동작은 다를 수 있다."
  - "Ingress2Gateway 1.0은 변환의 출발점이며, cutover 승인 근거는 route별 행위 테스트·5xx·redirect·TLS·backend 분포의 전후 비교여야 한다."
operator_checklist:
  - "모든 Ingress와 annotation을 inventory하고, host/path/redirect/rewrite/TLS/auth/rate-limit/default backend별 행위 소유자를 붙인다."
  - "새 Gateway controller는 기존 Ingress-NGINX와 별도 external IP 또는 test hostname에서 병행 검증한다."
  - "정상 200만 비교하지 말고 대소문자, trailing slash, 중복 slash, percent encoding, 404/default backend, WebSocket/gRPC, 인증 실패를 포함한 route contract를 만든다."
  - "DNS·traffic cutover 전후에 4xx/5xx, redirect rate, backend distribution, TLS handshake error, client IP 기반 policy 차이를 같은 대시보드에서 본다."
learning_refs:
  - title: "Gateway API v1.6의 L4 표준 경계"
    href: "/posts/2026-08-19-gateway-api-l4-standard-api-boundary-trend/"
    description: "TCPRoute·UDPRoute의 표준화와 controller 지원 범위를 구분하는 글입니다."
  - title: "Kubernetes Rollout 심화"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "클러스터와 워크로드 변경을 canary·관측·rollback으로 운영하는 기반입니다."
  - title: "Traffic Cutover Migration"
    href: "/learning/deep-dive/deep-dive-traffic-cutover-migration/"
    description: "데이터 플레인 변경에서 shadow, canary, DNS 전환, 복귀 기준을 정리합니다."
  - title: "API Response Compatibility Contract"
    href: "/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/"
    description: "클라이언트가 기대하는 응답 계약을 호환성 테스트로 관리하는 방법입니다."
---

Ingress-NGINX는 2026년 3월에 유지보수가 종료됐습니다. 이미 실행 중인 controller와 Ingress는 당장 사라지지 않으므로, 눈앞의 장애가 없다는 이유로 전환이 뒤로 밀리기 쉽습니다. 그러나 이후에는 bug fix와 보안 업데이트가 더 이상 나오지 않습니다. Kubernetes SIG Network와 Security Response Committee가 전환을 강조한 이유도 여기에 있습니다. **"아직 요청이 들어온다"는 운영 정상 신호이지, 지원되는 보안 경로라는 증거가 아닙니다.**

문제는 대안 선택보다 migration의 성격입니다. Ingress-NGINX의 annotation을 Gateway API의 `Gateway`, `HTTPRoute`, `ReferenceGrant`로 바꾸는 작업은 시작일 뿐입니다. 기존 controller는 정규식과 path를 해석하는 방식, host 전체에 적용되는 annotation의 범위, trailing slash redirect, URL 정규화, default backend, rewrite, client IP 전달에 자신만의 행위를 갖고 있습니다. YAML이 apply됐다고 기존 고객의 요청이 같은 backend로 가는 것은 아닙니다.

이 글은 [Gateway API v1.6의 L4 표준 경계](/posts/2026-08-19-gateway-api-l4-standard-api-boundary-trend/), [Kubernetes Rollout 심화](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Traffic Cutover Migration](/learning/deep-dive/deep-dive-traffic-cutover-migration/), [API Response Compatibility Contract](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)의 후속입니다. 핵심은 Gateway API를 도입하자는 일반론이 아니라, **은퇴한 Ingress-NGINX에서 벗어날 때 무엇을 테스트해야 전환을 승인할 수 있는가**입니다.

참고한 공식 자료:

- [Kubernetes: Ingress NGINX 은퇴 안내](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [Kubernetes: 마이그레이션 전 알아야 할 Ingress-NGINX 행위](https://kubernetes.io/blog/2026/02/27/ingress-nginx-before-you-migrate/)
- [Kubernetes: Ingress2Gateway 1.0](https://kubernetes.io/blog/2026/03/20/ingress2gateway-1-0-release/)
- [Gateway API: Ingress 마이그레이션 가이드](https://gateway-api.sigs.k8s.io/guides/getting-started/migrating-from-ingress/)
- [Gateway API: Ingress-NGINX 사용자 가이드](https://gateway-api.sigs.k8s.io/guides/getting-started/migrating-from-ingress-nginx/)

## 이 글에서 얻는 것

- Ingress-NGINX 종료가 단순 controller 업그레이드가 아니라 라우팅 계약의 재검증인 이유를 이해합니다.
- annotation 목록을 host/path/우선순위/redirect/rewrite/TLS/auth 행위 목록으로 바꾸는 방법을 배웁니다.
- Ingress2Gateway 변환 결과를 신뢰하되, 자동 변환 결과만으로 배포 승인하지 않는 기준을 얻습니다.
- dual-run, canary, DNS cutover, rollback을 어떤 숫자와 조건으로 운영할지 정리합니다.

## 핵심 개념/이슈

### 1) Ingress-NGINX와 NGINX Ingress는 이름이 비슷해도 다른 제품이다

가장 먼저 바로잡아야 할 것은 대상 식별입니다. Kubernetes community가 유지하던 **Ingress-NGINX**와 F5가 제공하는 **NGINX Ingress**는 같은 NGINX 데이터 플레인을 쓸 수 있어도 별개 controller입니다. 이름만 보고 image나 Helm chart를 바꾸면 migration이 아니라 예기치 않은 controller 교체가 됩니다.

우선 cluster 관리자 권한으로 실제 의존성을 확인합니다.

```bash
kubectl get pods --all-namespaces \
  --selector app.kubernetes.io/name=ingress-nginx
kubectl get ingressclass -o wide
kubectl get ingress --all-namespaces -o yaml
```

여기서 목표는 단순 개수 세기가 아닙니다. `ingressClassName`, controller image, Helm release, cloud load balancer, 외부 IP, wildcard certificate, ExternalDNS 연동까지 하나의 inventory로 묶어야 합니다. 동일 cluster에 여러 controller가 있으면 `nginx`라는 class 이름이 실제로 어느 데이터 플레인을 선택하는지도 확인합니다.

| inventory 항목 | 왜 필요한가 | 누락 시 위험 |
| --- | --- | --- |
| host·path·backend | 요청 목적지의 기본 계약 | route 누락, 404 증가 |
| annotation·ConfigMap | controller 고유 동작의 출처 | 변환 후 조용한 동작 변경 |
| TLS secret·certificate issuer | listener와 인증서 소유권 | handshake 실패, 잘못된 인증서 |
| DNS·ExternalDNS | 새 IP로 가는 실제 전환 경로 | 일부 지역·캐시만 구 경로 유지 |
| auth, WAF, rate limit | edge 보안 정책 | 전환 뒤 정책 우회 또는 정상 요청 차단 |
| WebSocket, gRPC, large upload | HTTP 기본 경로 밖의 트래픽 | long-lived connection과 upload 실패 |

### 2) annotation은 기능 플래그가 아니라 숨은 라우팅 의미다

Ingress API의 단순성은 널리 채택된 이유이지만, 확장 기능은 annotation에 붙어 controller마다 의미가 달라졌습니다. Gateway API는 ingress entry point를 `Gateway`가, application route를 `HTTPRoute`가 맡도록 역할을 분리하고, redirect·header 조작·traffic split 같은 공통 기능을 명시 필드로 올립니다. 이 구조는 multi-tenant 운영에 유리하지만, annotation을 1:1로 대입할 수 있다는 뜻은 아닙니다.

공식 Ingress-NGINX 마이그레이션 자료가 강조하는 대표 함정은 다음과 같습니다.

| 기존에 기대할 수 있는 Ingress-NGINX 행위 | Gateway API 이행 시 확인할 질문 |
| --- | --- |
| regex match가 prefix 기반·대소문자 비구분으로 동작 | exact/prefix/regular expression 중 무엇을 쓸지, 대소문자를 보존할지 |
| 한 host의 `use-regex`가 다른 Ingress의 path에도 영향을 줄 수 있음 | host 소유 route를 누가 묶고, route 간 간섭을 어떻게 제거할지 |
| trailing slash 누락 시 301 redirect | `/docs`와 `/docs/`를 같은 backend/상태 코드로 처리할지 |
| URL을 정규화한 뒤 route match | `//`, `.`/`..`, percent-encoding 요청을 edge와 backend가 동일하게 해석하는지 |
| default backend가 암묵적으로 동작 | unmatched 요청의 404 body, observability, fallback backend를 명시할지 |

예를 들어 `/Header`가 `/headers`와 같은 route로 매칭되는 행위에 API client나 cache key가 우연히 기대고 있을 수 있습니다. 새 controller에서 case-sensitive route가 되면 정상 user path가 404로 바뀝니다. 반대로 기존의 느슨한 정규식을 그대로 가져오면 의도하지 않은 URL까지 새 backend로 보낼 수 있습니다. 따라서 목표는 모든 과거 quirks를 영구 보존하는 것이 아니라, **유지할 행위·의도적으로 폐기할 행위·아직 모르는 행위를 구분하는 것**입니다.

### 3) 자동 변환기는 이행 후보를 만들지, 운영 동등성을 증명하지 않는다

Ingress2Gateway 1.0은 Ingress와 Ingress-NGINX 설정을 Gateway API 리소스로 옮기는 좋은 출발점입니다. 반복적인 route 작성과 annotation 매핑에서 실수를 줄이고, 지원하지 않는 설정을 빨리 표면화할 수 있습니다. 그러나 변환 결과가 생성됐다는 사실만으로 controller가 그 route를 같은 방식으로 구현한다고 결론 내리면 안 됩니다.

특히 다음은 도구 출력 뒤에 별도 판정이 필요한 항목입니다.

- 선택한 Gateway controller가 필요한 Gateway API 기능을 conformance 수준에서 구현하는가
- controller-specific extension이 필요한 annotation이 남았는가
- `ReferenceGrant`와 namespace attachment 정책 때문에 backend 또는 certificate 참조가 거부되지 않는가
- route conflict가 나면 기존의 생성 순서 대신 Gateway API 규칙으로 어떤 route가 이기는가
- rewrite, CORS, timeout, retry, client IP, WAF가 새 데이터 플레인에서 같은 보안 경계를 유지하는가

`unsupported` 결과를 "나중에 수동으로 고치자"로 넘기면 high-risk route가 마지막 cutover에 몰립니다. inventory 단계에서 `native`, `controller-extension`, `custom-redesign`, `blocker` 네 등급으로 분류하고 owner와 종료 조건을 붙이는 편이 낫습니다. `blocker`는 하나라도 있으면 DNS 전체 전환이 아니라 해당 host의 별도 migration lane으로 분리합니다.

### 4) route 행위 원장은 YAML보다 오래 가는 전환 산출물이다

전환의 핵심 산출물은 변환된 YAML이 아니라 **route behavior ledger**입니다. 고객이 실제로 사용하는 URL과 시스템이 보장해야 하는 결과를 한 줄씩 기록합니다.

```yaml
route_contract:
  id: public-docs-014
  hostname: docs.example.com
  request:
    method: GET
    paths: ["/guide", "/guide/", "/Guide", "/guide//intro"]
    headers: {"x-forwarded-proto": "https"}
  expected:
    status: [200, 301]
    backend: docs-v2
    location_prefix: "https://docs.example.com/guide/"
    cache_control: "public, max-age=300"
  owner: developer-experience
  migration_class: native
  evidence: "synthetic/ingress-migration/docs-014.json"
```

원장은 정상 200 URL만 적는 테스트 목록이 아닙니다. 아래처럼 실패·경계 조건이 더 중요합니다.

- `GET`, `POST`, `OPTIONS`가 각자 기대한 CORS와 backend를 받는가
- `/a`, `/a/`, `/A`, `/a//b`, `%2F` 포함 path가 의도한 상태 코드와 location header를 만드는가
- unmatched host/path가 old default backend 또는 새 명시 404 정책에 맞는가
- HTTP→HTTPS redirect가 loop 없이 같은 hostname과 query string을 보존하는가
- WebSocket upgrade, gRPC streaming, large request body가 idle timeout·header size·buffer 정책을 통과하는가
- source IP, `X-Forwarded-*`, mTLS client identity가 auth/rate-limit/WAF 규칙에서 같은 의미를 갖는가

이 원장은 [API Response Compatibility Contract](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)의 edge 버전입니다. 응답 body만 아니라 status, header, TLS, 목적지, 보안 정책까지 계약으로 취급합니다.

### 5) rollout의 성공 지표는 새 리소스 수가 아니라 동등성 증거다

"HTTPRoute 200개 생성"은 진행률일 뿐 성공 지표가 아닙니다. 아래와 같이 전환 전후를 비교할 수 있어야 합니다.

| 지표 | cutover 전 기준 | 확대 중단 또는 rollback 후보 |
| --- | --- | --- |
| route contract pass rate | critical route 100% | critical 1건 실패 또는 전체 99.5% 미만 |
| edge 5xx rate | 기존 baseline | +0.2%p가 10분 지속 |
| unexpected redirect rate | 기존 baseline | +0.5%p 또는 redirect loop 1건 |
| backend distribution | host별 baseline | 의도하지 않은 backend 비율 1% 초과 |
| TLS handshake error | 기존 baseline | +0.1%p가 5분 지속 |
| auth/rate-limit deny | 정책별 baseline | 403/429가 2배 이상 증가 |

절대 숫자는 서비스마다 다르지만, 조건의 순서는 지키는 편이 좋습니다. **보안·인증 정확성 > critical path 동등성 > 가용성 > 성능·비용**입니다. 5xx가 없더라도 관리자 route가 공개되거나 JWT 검증이 우회되면 전환은 실패입니다.

## 실무 적용

### 1) 5단계로 migration 범위를 좁힌다

**1단계 — 발견과 소유권(1~2주).** Ingress, annotation, ConfigMap, certificate, DNS, external traffic, controller image를 수집합니다. route마다 application owner와 platform owner를 붙입니다. owner가 없는 public host는 blocker로 분류합니다.

**2단계 — 변환과 gap 분류.** Ingress2Gateway를 사용해 후보 YAML을 만들고, `native / extension / redesign / blocker`로 분류합니다. 여기서 단순 static site, 내부 read-only API, 복잡한 auth route를 같은 순서로 전환하지 않습니다.

**3단계 — 별도 데이터 플레인 검증.** 기존 Ingress-NGINX는 그대로 두고 Gateway controller에 별도 external IP 또는 `canary.example.com` hostname을 부여합니다. route behavior ledger의 synthetic test를 old/new 양쪽에 실행합니다. 200 응답 외에도 redirect, error, TLS, WebSocket, header를 비교합니다.

**4단계 — low-risk host canary.** static asset 또는 내부 read-only host부터 1~5% traffic이나 제한된 DNS audience로 엽니다. 최소 24시간 동안 위 지표를 관측합니다. 결제, 로그인, 파트너 webhook, 관리자 경로는 이 단계의 첫 대상이 아닙니다.

**5단계 — host 단위 cutover와 복귀.** DNS TTL을 300초 이하로 미리 낮추고, 구 IP·구 controller·기존 certificate를 rollback window 동안 보존합니다. cutover 뒤에는 단순 `kubectl get`이 아니라 실제 client path synthetic과 edge metric을 다시 실행합니다. rollback은 "YAML을 다시 apply"가 아니라 **어느 hostname을 어느 IP/route로 되돌릴지**가 문서화된 작업이어야 합니다.

### 2) 역할을 Gateway API 모델에 맞춰 나눈다

Ingress는 load balancer와 route rule을 한 리소스에 섞기 쉬웠습니다. Gateway API는 의도적으로 역할을 나눕니다.

- **Platform team**: `GatewayClass`, Gateway listener, external IP, TLS issuer, network policy, controller lifecycle
- **Application team**: `HTTPRoute`, backend ref, host/path rule, application-specific timeout·header 요구
- **Security team**: auth, WAF, rate limit, client IP trust, exception approval
- **SRE/QA**: route behavior ledger, synthetic test, cutover dashboard, rollback evidence

이 분리는 불편한 권한 절차가 아니라 blast radius를 줄이는 장치입니다. application team이 route 하나를 바꾼다고 shared listener, 조직 전체 certificate, 다른 tenant의 route까지 같이 바뀌면 migration 이후에도 같은 문제가 남습니다. `allowedRoutes`, namespace selector, `ReferenceGrant`를 실제 조직 경계와 맞춰야 합니다.

### 3) 우선 전환 대상은 가장 복잡한 route가 아니다

처음부터 복잡한 regex, 외부 인증, WebSocket, partner callback을 고르면 Gateway API가 나빠 보이기 쉽습니다. 학습 가치가 큰 대상과 실패 비용이 큰 대상을 분리해야 합니다.

| 전환 순서 | 적합한 대상 | 통과 조건 |
| --- | --- | --- |
| 1 | 내부 read-only API, 단순 static host | route contract 100%, 24시간 5xx delta 없음 |
| 2 | 일반 public API, TLS redirect | auth/redirect/backend 분포가 baseline 이내 |
| 3 | CORS, rewrite, rate limit이 있는 host | preflight·정규화·정책 테스트 통과 |
| 4 | WebSocket/gRPC, upload, partner webhook | long-lived connection·timeout·signature 검증 통과 |
| 5 | 로그인·결제·관리자 | 별도 security approval, rollback rehearsal, canary evidence |

이 순서는 "쉬운 것만 하자"가 아니라 controller와 팀의 실제 동작을 값싼 실패에서 학습하자는 뜻입니다. high-risk host는 마지막에 넣되, inventory와 behavior ledger는 첫 주부터 만들어야 마지막 단계가 블랙박스가 되지 않습니다.

## 트레이드오프/주의점

첫째, Gateway API는 표준 리소스를 제공하지만 controller 구현 차이를 없애지 않습니다. Standard API가 있다고 해서 request filter, TLS option, observability, client IP, rate limit이 모든 구현에서 같은 운영 결과를 낸다고 가정하면 안 됩니다. conformance와 vendor 문서를 함께 확인해야 합니다.

둘째, 기존의 이상한 행위를 모두 보존하면 레거시를 새 API에 다시 새기는 결과가 됩니다. 대소문자 비구분 regex나 과도한 URL normalization이 보안상 나쁜 경우도 있습니다. 이때는 호환성 bug로 숨기지 말고, API deprecation 공지·client telemetry·명시적인 301/404 정책을 통해 의도적 변경으로 다뤄야 합니다.

셋째, dual-run은 비용과 운영 표면을 늘립니다. LoadBalancer, certificate, DNS, log, alert, WAF가 두 벌이 될 수 있습니다. 하지만 이 비용은 cutover 뒤 고객 path에서 규칙 차이를 발견하는 비용보다 작습니다. 기간을 무기한 늘리지 않도록 blocker별 종료일과 decommission 조건을 둡니다.

넷째, DNS TTL을 낮춰도 모든 client가 즉시 새 경로로 오지 않습니다. resolver cache, mobile network, hard-coded IP, partner allowlist가 남습니다. cutover 직후에는 구·신 데이터 플레인에서 같은 audit와 보안 경계를 유지해야 하며, 구 경로를 너무 빨리 제거하면 원인 분석과 rollback이 어려워집니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] Ingress-NGINX와 다른 NGINX 기반 controller를 image, IngressClass, Helm release 기준으로 구분했다.
- [ ] 모든 Ingress annotation과 controller ConfigMap을 host/path별 route behavior ledger에 연결했다.
- [ ] `native`, `extension`, `redesign`, `blocker` 분류에 owner·기한·승인 기준이 있다.
- [ ] old/new 데이터 플레인에서 normal path뿐 아니라 case, slash, encoding, redirect, 404, TLS, WebSocket/gRPC, auth 실패를 비교했다.
- [ ] critical route contract는 100%, 전체 route contract는 99.5% 이상 통과했다.
- [ ] cutover 후 5xx·redirect·backend distribution·TLS·403/429 지표와 rollback DNS/IP 절차를 검증했다.
- [ ] 구 Ingress-NGINX controller는 rollback window 종료와 보안 위험 승인 전에는 삭제하지 않는다.

### 연습 과제

1. 현재 cluster에서 Ingress 3개를 골라 annotation, host/path, default backend, TLS secret, owner를 표로 만드세요.
2. 각 route에 `/path`, `/path/`, 대소문자 변형, `//`, URL-encoded path를 넣은 synthetic test 5개를 작성하세요.
3. 하나의 내부 read-only host를 선택해 별도 Gateway external IP에서 old/new 응답의 status, location, backend, `X-Forwarded-*`를 비교하세요.
4. 5xx가 아니라 403/429가 2배가 되는 상황을 가정해, security policy 회귀와 정상 사용자 영향 중 무엇을 먼저 판단할지 5줄 런북으로 적으세요.

## 관련 글

- [Gateway API v1.6의 L4 표준 경계](/posts/2026-08-19-gateway-api-l4-standard-api-boundary-trend/)
- [Kubernetes Rollout 심화](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [Traffic Cutover Migration](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
- [API Response Compatibility Contract](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)
- [Service Mesh/Istio 심화](/learning/deep-dive/deep-dive-service-mesh-istio/)
