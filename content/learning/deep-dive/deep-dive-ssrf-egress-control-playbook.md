---
title: "백엔드 커리큘럼 심화: SSRF와 Egress Control, 서버의 아웃바운드 요청을 안전하게 여는 법"
date: 2026-05-16
draft: false
topic: "Backend Security"
tags: ["SSRF", "Egress Control", "Network Security", "Zero Trust", "Backend Reliability", "OWASP"]
categories: ["Backend Deep Dive"]
description: "사용자가 넘긴 URL을 서버가 대신 호출해야 할 때 SSRF, 내부망 접근, 메타데이터 탈취를 막기 위해 URL 검증·DNS 재검증·egress proxy·감사 로그를 숫자 기준으로 설계하는 방법을 정리합니다."
module: "backend-security"
study_order: 1233
---

외부 URL을 서버가 대신 가져오는 기능은 생각보다 흔합니다. 이미지 프록시, 웹훅 검증, Open Graph 미리보기, 파일 import, RSS 수집, 파트너 API callback, PDF 변환, AI 에이전트의 웹 fetch까지 모두 비슷한 구조를 가집니다. 사용자는 URL을 입력하고, 서버는 그 URL로 네트워크 요청을 보냅니다. 문제는 이 순간 서버가 **공격자가 조종하는 브라우저**처럼 동작할 수 있다는 점입니다.

SSRF(Server-Side Request Forgery)는 단순히 `localhost`를 막는 문제로 끝나지 않습니다. 클라우드 메타데이터 endpoint, 사내 관리자 페이지, VPC 내부 DB, Kubernetes API, Redis, Elasticsearch, staging 서비스가 모두 서버의 네트워크 위치에서는 접근 가능할 수 있습니다. 그래서 SSRF 방어는 입력 검증 하나가 아니라 **아웃바운드 네트워크 경계 설계**입니다. 이 글은 [OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/), [VPC/Subnet/보안그룹](/learning/deep-dive/deep-dive-vpc-network-basics/), [HTTP Deep Dive](/learning/deep-dive/deep-dive-http-deep-dive/), [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 연결해서 읽으면 좋습니다.

## 이 글에서 얻는 것

- SSRF가 왜 단순 URL 검증 문제가 아니라 네트워크 권한 문제인지 설명할 수 있습니다.
- allowlist, DNS 재검증, redirect 제한, private IP 차단, egress proxy를 어떤 순서로 적용할지 정할 수 있습니다.
- 이미지 프록시, 웹훅, 파일 import처럼 외부 URL을 받아야 하는 기능의 안전한 처리 경로를 설계할 수 있습니다.
- timeout, 응답 크기, content-type, 감사 로그, 알림 기준을 숫자로 잡아 운영 사고를 줄일 수 있습니다.

## 핵심 개념/이슈

### 1) SSRF는 "서버가 대신 요청한다"는 권한 문제다

브라우저에서 사용자가 `http://127.0.0.1:8080/admin`을 열어도 서버 내부망에는 접근하지 못합니다. 하지만 서버 애플리케이션이 같은 URL을 열면 이야기가 달라집니다. 서버는 VPC 내부 주소, 클라우드 메타데이터 주소, 사내 DNS, private service mesh에 접근할 권한을 이미 가지고 있을 수 있습니다. 공격자는 그 권한을 빌려 쓰는 것입니다.

대표적인 위험은 아래입니다.

| 대상 | 예시 | 위험 |
| --- | --- | --- |
| Localhost | `http://127.0.0.1:8080/admin` | 내부 관리자 API 호출 |
| Cloud metadata | `http://169.254.169.254/...` | 임시 credential 탈취 |
| Private CIDR | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | 내부 서비스 스캔 |
| Link-local/IPv6 | `fe80::/10`, `::1` | 우회 접근 |
| Internal DNS | `http://redis.service.local` | 사내 자원 접근 |
| Redirect chain | 외부 URL → 내부 URL | 검증 우회 |

따라서 SSRF 방어의 우선순위는 **네트워크에서 나갈 수 없게 막기 > 코드에서 위험 URL을 거르기 > 호출 후 이상 징후를 탐지하기** 순서가 좋습니다. 애플리케이션 검증은 필요하지만, 마지막 방어선으로 두면 안 됩니다.

### 2) URL 문자열 검증만으로는 부족하다

`localhost` 문자열을 금지하는 방식은 금방 우회됩니다. IP를 십진수·팔진수·16진수로 표현하거나, DNS가 처음에는 공인 IP를 반환했다가 요청 직전 private IP로 바뀌는 DNS rebinding을 사용할 수 있습니다. redirect가 허용되어 있으면 처음 URL은 정상 도메인인데 302 응답이 내부 주소로 이동할 수도 있습니다.

그래서 URL 검증은 최소 아래 단계를 거쳐야 합니다.

1. scheme 제한: 기본은 `https`만 허용, 필요할 때만 `http` 허용
2. userinfo 금지: `https://user:pass@example.com` 형태 차단
3. host 정규화: punycode, trailing dot, 대소문자, IPv6 bracket 처리
4. DNS resolve 후 IP 검증: private/link-local/loopback/multicast 차단
5. redirect마다 다시 검증: 최종 URL만이 아니라 모든 hop 검증
6. 연결 직전 IP 재검증: 검증 시점과 connect 시점의 차이를 줄임

여기서 핵심은 "도메인 문자열이 안전한가"가 아니라 **최종 연결 IP가 허용된 네트워크인가**입니다. `example.com`처럼 보이는 문자열도 DNS 결과가 내부 IP면 차단해야 합니다.

### 3) Allowlist는 도메인보다 업무 capability 기준으로 설계한다

SSRF 방어에서 가장 강한 정책은 allowlist입니다. 하지만 단순히 `*.example.com`을 열어두면 운영 중 점점 넓어지고, 나중에는 사실상 인터넷 전체가 됩니다. 더 좋은 기준은 업무 capability입니다.

예를 들어 기능별로 이렇게 나눕니다.

| 기능 | 허용 대상 | 기본 제한 |
| --- | --- | --- |
| Open Graph 미리보기 | 공개 웹 `https` | redirect 2회, body 2MB, timeout 3초 |
| Webhook 검증 | 등록된 파트너 도메인 | DNS/IP pinning, 서명 검증 필수 |
| 이미지 프록시 | 이미지 CDN, 공개 이미지 URL | content-type image/*, body 10MB |
| 파일 import | 사전 등록 storage origin | 확장자·MIME·signature 검사 |
| 내부 API 호출 | service mesh 내부 이름 | 사용자 입력 URL 금지, service client만 사용 |

이렇게 나누면 "이 기능은 왜 이 도메인으로 나가야 하는가"를 설명할 수 있습니다. [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)에서 inbound policy를 중앙화하듯, outbound도 capability별 정책으로 중앙화하는 편이 안전합니다.

### 4) Egress proxy는 방어와 관측을 한곳에 모은다

애플리케이션마다 URL 검증 코드를 직접 넣으면 누락이 생깁니다. 더 단단한 구조는 외부 요청을 모두 egress proxy나 outbound request broker를 통해 보내는 것입니다.

```text
Application → Outbound Request Broker → Egress Proxy/NAT → Internet
                         │
                         ├─ policy check
                         ├─ DNS/IP validation
                         ├─ redirect validation
                         ├─ timeout/body limit
                         └─ audit log
```

이 구조의 장점은 세 가지입니다. 첫째, 정책이 중앙화됩니다. 둘째, 로그가 한곳에 모입니다. 셋째, 네트워크 레벨에서 proxy를 우회하는 요청을 차단할 수 있습니다. Kubernetes라면 NetworkPolicy로 pod의 직접 인터넷 egress를 막고, egress gateway만 허용할 수 있습니다. 클라우드 환경에서는 NAT gateway, firewall, security group, VPC endpoint 정책을 함께 봐야 합니다.

운영 기준은 아래 정도로 시작할 수 있습니다.

- 기본 정책: unknown destination은 deny
- allowlist 변경: PR/RFC + owner + 만료일 필요
- redirect: 최대 2회, hop마다 DNS/IP 재검증
- timeout: connect 1초, total 3~5초부터 시작
- response body: 기능별 2MB/10MB/50MB 상한
- audit: request_id, user_id, feature, normalized_host, resolved_ip, policy_id, result 기록

### 5) SSRF는 탐지도 중요하다

차단 정책이 있어도 이상 징후를 봐야 합니다. 공격자는 여러 URL 표현을 시도하고, 내부 포트 스캔처럼 짧은 요청을 많이 만들 수 있습니다. 아래 신호는 알림 후보입니다.

- private/link-local/loopback IP 차단 건수가 5분에 **10회 이상**
- 같은 user/session에서 서로 다른 host 요청이 5분에 **50개 이상**
- redirect 차단 비율이 특정 endpoint에서 **5% 이상**
- DNS resolve 결과가 public → private으로 바뀐 이벤트 발생
- metadata endpoint, Kubernetes service IP, RFC1918 대역 요청 시도
- timeout/connection refused가 짧은 시간에 여러 port로 분산 발생

알림은 무조건 보안 사고로 단정하기보다 feature와 user 기준으로 묶어야 합니다. Open Graph 미리보기처럼 사용자가 여러 URL을 넣는 기능은 잡음이 많을 수 있습니다. 반면 웹훅 등록 기능에서 private IP 차단이 나오면 더 강한 신호입니다.

## 실무 적용

### 1) 외부 URL 처리 함수를 공용 client로 강제한다

가장 먼저 할 일은 `fetch(url)`, `RestTemplate.getForObject(url)`, `WebClient.get().uri(url)` 같은 직접 호출을 줄이는 것입니다. 외부 URL을 받는 기능은 반드시 공용 client를 타게 합니다.

```kotlin
interface SafeOutboundClient {
    fun fetch(request: OutboundRequest): OutboundResponse
}

data class OutboundRequest(
    val feature: String,
    val url: String,
    val allowedPolicy: String,
    val maxBytes: Long,
    val timeoutMillis: Long,
    val traceId: String
)
```

중요한 점은 caller가 임의로 제한을 크게 풀지 못하게 하는 것입니다. `feature=image_proxy`라면 policy registry에서 timeout과 maxBytes의 상한을 가져오고, 요청 객체의 값은 그보다 작게만 허용합니다. 정책은 코드 상수보다 config + 리뷰 절차로 관리하는 편이 좋습니다.

### 2) URL 검증은 파싱, resolve, connect 직전 확인으로 나눈다

검증을 한 번만 하면 race condition이 생깁니다. 안전한 흐름은 다음입니다.

1. URL parse: scheme, host, port, path 구조 확인
2. policy lookup: feature가 이 host/category를 호출할 수 있는지 확인
3. DNS resolve: 모든 A/AAAA record 검사
4. connect target 결정: 허용된 IP만 선택
5. connect 직전 재검증: 선택 IP가 여전히 금지 대역이 아닌지 확인
6. redirect 발생 시 1번부터 반복

Java/Spring 환경에서는 HTTP client가 내부에서 DNS와 redirect를 자동 처리하는 경우가 많습니다. 그래서 라이브러리 기본 redirect follow를 끄고, 애플리케이션에서 hop별로 검증한 뒤 다음 요청을 보내는 편이 낫습니다. 이 부분은 [HTTP 캐싱과 재검증](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)처럼 HTTP 동작을 세밀하게 이해해야 실수가 줄어듭니다.

### 3) 내부 서비스 호출과 사용자 입력 URL 호출을 분리한다

내부 서비스 호출은 service discovery, mTLS, service account, retry policy가 붙습니다. 사용자 입력 URL 호출은 반대로 권한을 최소화해야 합니다. 이 둘을 같은 client와 같은 네트워크 권한으로 처리하면 위험합니다.

권장 분리는 아래입니다.

- internal service client: service name 기반, 사용자 입력 host 금지
- public fetch client: egress proxy 경유, private IP 차단
- partner callback client: 사전 등록 endpoint + 서명 검증 + owner 관리
- file import client: MIME/signature/size scan 포함

특히 서버가 `url` 파라미터를 받아 내부 API를 호출하는 형태는 피해야 합니다. 내부 서비스 선택이 필요하면 URL이 아니라 enum이나 resource id를 받습니다. 예를 들어 `target=invoice-service`처럼 허용된 이름만 받고, 실제 endpoint는 서버 설정에서 매핑합니다.

### 4) 응답 처리 제한을 명확히 둔다

SSRF 방어는 요청 대상만의 문제가 아닙니다. 응답이 너무 크거나, 압축 폭탄이거나, 느리게 흘러오면 가용성 문제가 됩니다. 외부 fetch 기능에는 아래 제한을 둡니다.

- connect timeout: 1초, read timeout: 2~4초, total deadline: 5초
- redirect: 0~2회, cross-scheme downgrade 금지
- body size: Open Graph 2MB, 이미지 10MB, import 50MB처럼 기능별 상한
- compression: 압축 해제 후 크기 기준 적용
- content-type: allowlist 기반, `application/octet-stream`은 별도 signature 검사
- retry: 기본 0회, 정말 필요할 때만 1회 + jitter

리트라이는 특히 조심해야 합니다. 공격자가 느린 endpoint를 주고 서버가 여러 번 재시도하면 내부 리소스가 빨리 고갈됩니다. [WebClient 회복탄력성](/learning/deep-dive/deep-dive-webclient-resilience/)의 원칙처럼 deadline, bulkhead, retry budget을 같이 봐야 합니다.

### 5) 테스트 케이스를 공격 입력 중심으로 만든다

SSRF 방어는 정상 URL 몇 개로 테스트하면 거의 의미가 없습니다. 최소 아래 케이스를 자동화합니다.

```text
- http://localhost:8080
- http://127.0.0.1
- http://[::1]
- http://169.254.169.254/latest/meta-data/
- http://10.0.0.1
- http://172.16.0.1
- http://192.168.0.1
- http://example.com@127.0.0.1/
- http://127.0.0.1.nip.io/
- public URL that redirects to private IP
- DNS result changes from public to private
- gzip response expands over maxBytes
- content-type says image/png but signature is HTML
```

이 테스트는 unit test만으로 끝내지 말고, staging egress proxy와 network policy까지 포함한 integration test로 한 번은 돌려야 합니다. 코드 검증은 통과했지만 pod가 proxy를 우회할 수 있으면 실제 방어는 깨진 것입니다.

## 트레이드오프/주의점

### 1) 너무 강한 차단은 제품 기능을 망가뜨릴 수 있다

모든 외부 URL을 막으면 안전하지만 제품은 동작하지 않습니다. 특히 사용자 생성 콘텐츠, 링크 미리보기, 외부 파일 import는 인터넷의 지저분함을 어느 정도 받아들여야 합니다. 그래서 정책은 기능별로 달라야 합니다. Open Graph 미리보기는 실패해도 본 기능이 깨지지 않으므로 강하게 차단하고 빨리 포기해도 됩니다. 반면 파트너 webhook 검증은 실패가 계약 이슈가 될 수 있으므로 사전 등록과 모니터링을 더 촘촘히 해야 합니다.

의사결정 우선순위는 **민감 네트워크 차단 > credential 보호 > 가용성 보호 > 사용자 편의** 순서가 좋습니다. 미리보기가 안 뜨는 불편보다 메타데이터 credential 유출이 훨씬 비쌉니다.

### 2) Allowlist는 운영 부채가 된다

allowlist는 강력하지만 관리하지 않으면 낡습니다. 파트너 도메인이 바뀌고, CDN이 추가되고, 테스트용 임시 도메인이 남습니다. 그래서 항목마다 owner, reason, created_at, expires_at, last_seen을 둡니다. 90일 동안 호출이 없으면 삭제 후보로 만들고, wildcard는 별도 승인으로 제한합니다.

### 3) DNS pinning은 완벽한 답이 아니다

DNS 결과를 고정하면 rebinding 위험은 줄지만, CDN이나 글로벌 서비스의 정상 동작을 방해할 수 있습니다. 반대로 매번 DNS를 새로 믿으면 race condition이 생깁니다. 현실적인 타협은 짧은 TTL 캐시와 connect 직전 검증, 그리고 private range 차단을 함께 쓰는 것입니다. 고위험 파트너 API는 IP range 계약이나 private connectivity를 검토합니다.

### 4) 보안 로그에 민감정보를 남기지 않는다

외부 URL에는 토큰, 이메일, 파일명, 고객 식별자가 들어갈 수 있습니다. 감사 로그에는 원문 URL 전체를 남기기보다 normalized host, path hash, query key 목록, policy result를 남기는 편이 안전합니다. 원문이 꼭 필요하면 짧은 보존 기간과 접근 권한을 둡니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 외부 URL을 직접 호출하는 코드 경로를 검색했다.
- [ ] 외부 URL 호출은 공용 `SafeOutboundClient` 또는 egress broker를 통한다.
- [ ] scheme은 기본 `https`만 허용하고, 예외는 feature policy에 기록한다.
- [ ] redirect는 자동 follow를 끄고 hop마다 URL/DNS/IP를 재검증한다.
- [ ] loopback, private, link-local, multicast, metadata endpoint를 차단한다.
- [ ] Kubernetes/클라우드 네트워크에서 proxy 우회 egress를 막았다.
- [ ] 기능별 timeout, body size, content-type, retry budget을 숫자로 정했다.
- [ ] 차단 이벤트와 허용 이벤트에 request_id, feature, policy_id, resolved_ip를 남긴다.
- [ ] allowlist 항목에는 owner, reason, expires_at, last_seen이 있다.
- [ ] SSRF 공격 입력 테스트를 CI 또는 정기 보안 테스트에 넣었다.

### 연습 문제

다음 요구사항을 기준으로 정책을 설계해보세요.

> 사용자가 상품 상세 페이지에 외부 URL을 붙이면 서버가 Open Graph title, description, image를 가져와 미리보기를 만든다. 이 기능은 실패해도 상품 등록을 막으면 안 된다.

권장 답안의 방향은 아래입니다.

1. `https`만 허용하고 `http`는 초기에 보류한다.
2. total deadline은 3초, body 상한은 HTML 2MB, image 10MB로 둔다.
3. redirect는 최대 2회, 모든 hop에서 private IP와 metadata endpoint를 차단한다.
4. 실패 시 미리보기 없음 상태로 저장하고 사용자 입력 원문 URL은 그대로 링크하지 않는다.
5. 같은 사용자 기준 5분 30회 이상 fetch 요청이면 rate limit을 건다.
6. 차단 사유가 private IP 또는 metadata endpoint면 보안 이벤트로 집계한다.

이 정도만 적용해도 "URL 미리보기"라는 작은 기능이 서버 내부망 스캐너가 되는 사고를 크게 줄일 수 있습니다.
