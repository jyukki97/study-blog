---
title: "백엔드 커리큘럼 심화: 신뢰 프록시·클라이언트 IP 전달 경계 플레이북"
date: 2026-09-14
draft: false
topic: "Security"
tags: ["Reverse Proxy", "Forwarded", "X-Forwarded-For", "Client IP", "Rate Limit", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "로드 밸런서·CDN 뒤의 백엔드가 Forwarded/X-Forwarded-For를 신뢰할 범위를 설계하고, rate limit·감사 로그·보안 정책에서 실제 클라이언트 IP를 안전하게 쓰는 방법을 정리합니다."
module: "security"
study_order: 1238
key_takeaways:
  - "클라이언트 IP는 요청 헤더의 값이 아니라, 신뢰한 프록시 체인을 역방향으로 해석해 얻는 보안 판단 입력이다."
  - "X-Forwarded-For의 첫 번째·마지막 값을 무조건 쓰는 규칙은 CDN, 사설 LB, 직접 접근 경로가 섞이면 쉽게 깨진다."
  - "rate limit, 지역 제한, 관리자 접근, 감사 로그는 각각 IP 품질 요구가 다르므로 하나의 raw header를 공용 진실로 쓰면 안 된다."
---

서비스를 CDN과 load balancer 뒤에 올리면 애플리케이션이 보는 TCP peer는 사용자 브라우저가 아니라 마지막 프록시가 된다. 이때 팀은 보통 `X-Forwarded-For`를 읽어 “진짜 IP”를 복원한다. 문제는 이 헤더가 인터넷 클라이언트도 임의로 보낼 수 있는 문자열이라는 점이다. 신뢰 경계를 정하지 않은 채 첫 번째 값이나 마지막 값을 사용하면 rate limit 우회, IP allowlist 우회, 잘못된 지역 판정, 오염된 감사 로그가 한 번에 생긴다.

이 글은 [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/), [Rate Limiter 설계](/learning/deep-dive/deep-dive-rate-limiter-design/), [구조화 로그](/learning/deep-dive/deep-dive-structured-logging/), [SSRF와 egress 제어](/learning/deep-dive/deep-dive-ssrf-egress-control-playbook/)를 하나의 **ingress 신뢰 경계**로 연결한다. 핵심은 특정 헤더를 선호하는 일이 아니라, 요청을 실제로 전달한 proxy hop만 헤더를 추가·정규화할 수 있도록 만들고 애플리케이션은 그 결과를 용도별로 제한하는 일이다.

참고 기준은 [RFC 7239 Forwarded HTTP Extension](https://www.rfc-editor.org/rfc/rfc7239), [MDN의 X-Forwarded-For 보안 지침](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For), [OWASP의 애플리케이션 보안 검증 기준](https://owasp.org/www-project-application-security-verification-standard/)이다. 프록시 제품마다 header overwrite 방식과 source IP 보존 방식은 다르므로, 아래 정책을 적용하기 전에는 실제 ingress 설정과 packet path를 함께 확인해야 한다.

## 이 글에서 얻는 것

- `remoteAddr`, `Forwarded`, `X-Forwarded-For`, CDN 전용 IP header가 각각 무엇을 증명하고 무엇을 증명하지 못하는지 구분합니다.
- 고정 hop 수보다 **신뢰된 proxy CIDR/identity를 오른쪽에서부터 검증하는 방식**이 왜 안전한지 이해합니다.
- IP 기반 rate limit, 관리자 allowlist, fraud 분석, 감사 로그에 같은 IP 값을 재사용하지 않는 기준을 세웁니다.
- canary 범위, 불일치 지표, fail-closed 조건을 숫자로 정해 proxy 설정 변경을 운영할 수 있습니다.

## 핵심 개념/이슈

### 1) IP header는 사실이 아니라 전달 주장이다

클라이언트가 직접 애플리케이션에 연결할 수 있다면 다음 요청도 보낼 수 있다.

```http
GET /admin HTTP/1.1
Host: api.example.com
X-Forwarded-For: 10.10.0.8
```

따라서 애플리케이션이 단지 이 값을 읽어 내부망 IP allowlist를 통과시키면, header를 쓴 사람이 내부망에 있다는 거짓 주장을 받아들인 셈이다. 반대로 애플리케이션의 socket peer address는 실제로 연결한 상대를 증명하지만, CDN과 L7 load balancer를 거친 사용자 IP는 알려 주지 않는다.

신뢰할 수 있는 모델은 다음과 같다.

1. 인터넷에서 들어오는 요청은 **첫 번째 신뢰 프록시**가 받는다.
2. 그 프록시는 외부가 보낸 forwarding header를 제거하거나 무시하고, 자신이 관찰한 peer IP를 새 header에 기록한다.
3. 내부 프록시는 오직 신뢰된 앞 hop에서 온 요청에만 기존 체인을 보존하고 자신의 hop을 덧붙인다.
4. 애플리케이션은 TCP peer가 미리 등록한 프록시 CIDR 또는 mTLS identity에 속할 때만 forwarding header를 해석한다.

이 네 단계 중 하나라도 빠지면 `X-Forwarded-For`는 편의 정보일 뿐 권한·차단 정책의 근거가 될 수 없다. `Forwarded: for=...;proto=https;host=...`도 표준화된 문법일 뿐 출처를 증명하지는 않는다.

### 2) "첫 IP"와 "마지막 IP" 모두 문맥 없이 위험하다

일반적인 `X-Forwarded-For`는 왼쪽에 원래 클라이언트, 오른쪽에 가까운 proxy가 추가되는 comma-separated 목록이다. 그러나 외부 클라이언트가 이미 header를 넣을 수 있고, CDN·WAF·regional LB·service mesh가 체인을 다르게 만들 수 있다. 그래서 “무조건 첫 번째”는 주입된 값을 선택할 수 있고, “무조건 마지막”은 load balancer 자체를 클라이언트로 기록한다.

더 안전한 알고리즘은 **현재 TCP peer에서 시작해 오른쪽에서 왼쪽으로 이동하며, 신뢰 프록시만 건너뛰고 처음 만나는 비신뢰 주소를 후보 client IP로 고르는 것**이다. 다만 이 알고리즘도 두 조건이 선행돼야 한다.

| 조건 | 확인할 내용 | 충족하지 않을 때 |
| --- | --- | --- |
| ingress 차단 | app/worker 포트가 LB·mesh 외의 source에서 직접 열리지 않는가 | forwarding header 전체를 무시하고 peer IP만 기록 |
| proxy source 검증 | CIDR, security group, mTLS SAN 중 적어도 하나로 hop을 식별하는가 | client IP를 `unknown`으로 낮추고 보안 판단에 쓰지 않음 |
| overwrite 정책 | edge가 외부 supplied `Forwarded`/`X-Forwarded-*`를 overwrite하는가 | 신뢰 체인이 성립하지 않으므로 rollout 중단 |
| 형식 제한 | IPv4/IPv6, port, `unknown`, obfuscated identifier를 파서가 명확히 처리하는가 | raw 값을 정책 엔진에 넘기지 않음 |

사설 네트워크에서는 hop 개수 고정이 당장은 간단해 보인다. 하지만 blue/green LB 교체, emergency bypass, mesh sidecar 추가가 생기면 “세 번째 값”이라는 가정이 silently 달라진다. CIDR도 변경 관리가 필요하지만, 최소한 변경 대상과 관찰 가능한 source가 명확하다.

### 3) IP의 품질은 사용하는 정책보다 낮아야 한다

IP 주소는 개인 사용자 identity가 아니다. NAT, 기업 proxy, 이동통신사 CGNAT, IPv6 privacy address 때문에 한 IP에 여러 사용자가 있거나 같은 사용자의 IP가 자주 바뀐다. 그러므로 IP가 충분히 신뢰된다는 사실과 IP 기반 정책이 적절하다는 판단은 분리해야 한다.

| 용도 | 권장 입력 | IP만으로 결정해도 되는가 |
| --- | --- | --- |
| 무차별 대입·봇 완화 | 정규화 client IP + 계정/디바이스/경로 | 아니오. IP는 한 차원으로만 사용 |
| API rate limit | tenant/API key 우선, IP는 anonymous 경로 보조 | 인증 사용자에 IP 단독 키 금지 |
| 관리자 접근 | SSO·MFA·device posture 우선, IP allowlist는 보조 | 긴급 차단 외에는 아니오 |
| 감사 로그·incident | parsed client IP, peer IP, proxy chain version | 가능하지만 source와 confidence를 함께 저장 |
| 지역화·콘텐츠 선택 | GeoIP 결과를 hint로 사용 | 법적 차단·권한 결정에는 단독 사용 금지 |

특히 login API의 “IP당 분당 5회”만 두면 회사 NAT 아래 정상 사용자들이 같이 막히거나 공격자가 IPv6 prefix와 botnet으로 쉽게 분산한다. account·device·credential 실패 패턴과 조합해 **IP rate limit은 우회 비용을 높이는 보조 제어**로 두는 편이 맞다.

### 4) 파싱 결과와 원본 증거를 분리한다

감사 또는 사고 대응에서 “client_ip=203.0.113.10” 한 필드만 남기면 해당 값이 직접 socket에서 왔는지, trusted CDN이 넣었는지, 형식 오류를 보정한 결과인지 알 수 없다. 반대로 raw header 전체를 무제한 로그에 넣으면 사용자 제공 문자열과 개인정보 보존 범위가 커진다.

권장 이벤트 모델은 다음과 같이 목적을 분리한다.

```text
network.peer.ip          # app socket peer, 항상 기록
network.client.ip        # 신뢰 경계 통과 후의 정규화 결과, 없으면 null
network.client.source    # peer | trusted-forwarded | cdn-header | unavailable
network.proxy.policy_ver # 해석한 CIDR/identity 정책 버전
network.forwarded.valid  # parser 및 chain 검증 통과 여부
```

raw header는 security investigation에 실제로 필요하고 접근 통제가 가능한 별도 보존소에만 짧게(예: 7일) 둘지 판단한다. 일반 애플리케이션 로그에는 hash 또는 parse failure reason처럼 최소한의 진단 정보만 남긴다. 데이터 보존 기간은 정책·법무 요구에 따라 달라지며, “디버깅에 좋다”는 이유만으로 길게 잡지 않는다.

## 실무 적용

### 1) 먼저 실제 요청 경로를 한 장으로 고정한다

코드부터 수정하지 말고, public DNS부터 Pod까지의 hop을 적는다. 각 hop마다 listener 주소, source 보존 여부, header 처리 방식, 소유 팀, 변경 창을 넣는다.

```text
browser
  -> CDN/WAF (external forwarding header overwrite)
  -> regional L7 LB (trusted CDN CIDR만 수신)
  -> ingress (trusted LB identity만 수신)
  -> application (trusted ingress identity만 수신)
```

동일 서비스에 internal load balancer, partner VPN, Kubernetes port-forward, 운영자 직접 접근이 있다면 모두 별도 경로다. 서로 다른 trust rule을 하나의 `trust proxy=true` 같은 전역 스위치로 합치지 않는다. 이 옵션은 프레임워크에 따라 모든 forwarded header를 신뢰한다는 뜻일 수 있다.

### 2) client-IP resolver를 하나의 보안 컴포넌트로 만든다

각 controller, rate limiter, audit interceptor가 header를 각자 split하면 정책 drift가 생긴다. ingress middleware 하나에서 다음 결과를 만든 뒤 immutable request context로 전달한다.

- peer가 trust 목록 밖이면 `client_ip = null`, `source = peer`로 둔다.
- peer가 trust 목록 안이면 표준 header 하나를 우선순위에 맞춰 parse하고, 오른쪽에서 신뢰 hop을 제거한다.
- 목록 길이 20 초과, 유효하지 않은 IP token, 서로 모순되는 provider header는 `invalid`으로 분류한다.
- 권한 판단에 쓰려는 endpoint는 `invalid` 또는 `unavailable`이면 allowlist를 통과시키지 않는다.

20 hop은 보수적인 시작 상한일 뿐 표준값이 아니다. 정상 경로가 3 hop인데 20개가 들어왔다면 공격 또는 misconfiguration 진단을 할 이유가 충분하다. parser가 IPv6 bracket, optional port, `unknown` token을 제대로 지원하지 않는다면 검증된 라이브러리를 쓰고 테스트 fixture에 포함한다.

### 3) shadow mode에서 일치도를 측정한다

기존 `client_ip`를 바로 바꾸면 rate limit key와 감사 기록이 동시에 변한다. 첫 7일은 기존 결과와 새 resolver 결과를 함께 산출하되 enforcement에는 기존 값을 유지한다. 다음 기준을 예시로 사용할 수 있다.

| 지표 | 승격 기준 | 중단·조사 기준 |
| --- | --- | --- |
| 정상 요청의 old/new IP 일치율 | 99.5% 이상 | 99.0% 미만이 30분 지속 |
| forwarding parse invalid 비율 | 0.1% 미만 | 1% 이상 |
| 직접 app 접근 시도 | 0건 | 1건 이상이면 network rule 점검 |
| 관리자 endpoint의 untrusted header 수용 | 0건 | 단 1건이면 즉시 fail-closed |
| anonymous rate-limit 429 변화 | 기준선 대비 ±10% 이내 | +30% 또는 -30%가 1시간 지속 |

일치율이 낮다고 무조건 새 resolver가 잘못된 것은 아니다. 기존 구현이 CDN IP를 client로 기록했을 수도 있다. 샘플을 request path·edge location·provider header·peer CIDR로 나눠 원인을 확인하고, “무엇이 진짜 client인지”보다 “어떤 경로가 어떤 증거를 제공하는지”를 먼저 고정한다.

### 4) 변경과 rollback을 같은 배포 단위로 다룬다

신뢰 CIDR, LB header overwrite, ingress middleware, rate-limit key는 한 단계씩 바꾸고 매 변경에 policy version을 붙인다. rollback은 단순히 코드를 이전 버전으로 돌리는 일이 아니다. 새 header를 전제로 바뀐 CDN rule이나 security group이 남아 있으면 이전 resolver가 잘못 해석할 수 있다.

가장 안전한 rollback은 새 resolver의 enforcement만 끄고 `peer IP + 기존 안전 키`로 낮추는 것이다. 관리자 IP allowlist는 이 시점에 deny가 다소 늘더라도 identity 기반 인증을 남겨 두고, 임의 forwarding header를 다시 신뢰하는 방향으로 되돌리지 않는다.

## 트레이드오프/주의점

### 보안 강화와 운영 편의의 충돌

모든 hop을 CIDR과 identity로 검증하면 vendor IP range 업데이트, multi-cloud 경로, disaster recovery가 부담스러워진다. 반면 광범위한 private CIDR 전체를 신뢰하면 compromise된 내부 workload가 source를 위조할 수 있다. 위험이 높은 관리자·결제·데이터 export 경로부터 좁은 identity trust를 적용하고, 일반 public API는 client IP가 없어도 동작하도록 설계하는 것이 현실적인 순서다.

### CDN 전용 header는 표준보다 신뢰 모델이 중요하다

일부 CDN은 별도 client-IP header를 제공한다. provider edge에서 overwrite되고 origin firewall이 provider source만 허용한다면 유용할 수 있다. 하지만 해당 header를 표준 `Forwarded`보다 우선한다고 해서 자동으로 안전해지는 것은 아니다. provider IP range 동기화 실패, CDN bypass origin, multi-CDN failover가 생기면 같은 검증을 다시 해야 한다.

### privacy와 추적 가능성의 균형

보안팀이 원한다고 raw IP와 전체 forwarding chain을 모든 trace·metric label에 넣으면 cardinality와 개인정보 노출이 커진다. IP는 metric label로 사용하지 않고, incident 로그에서도 access role·TTL·masking을 적용한다. 필요하면 `/24` 또는 `/56` prefix로 집계하되, 그 값도 정책 목적이 끝나면 보존하지 않는다는 원칙을 세운다.

## 체크리스트

- [ ] public origin/app port가 CDN·LB·ingress 외 source에서 직접 접근되지 않는가?
- [ ] edge가 외부에서 들어온 `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Host`를 overwrite 또는 제거하는가?
- [ ] 신뢰 hop은 고정 숫자가 아니라 CIDR, security group, mTLS identity 중 검증 가능한 기준으로 식별되는가?
- [ ] resolver가 목록 길이, IPv4/IPv6, invalid token, direct access를 fail-closed로 처리하는가?
- [ ] IP가 아닌 tenant/API key/account/device를 rate-limit의 우선 키로 사용하고 있는가?
- [ ] 감사 로그에 peer IP, parsed client IP, source, policy version, parse 상태가 분리되어 있는가?
- [ ] shadow mode에서 endpoint별 불일치와 429 변화를 7일 이상 확인했는가?
- [ ] 관리자 allowlist와 법적 차단 같은 고위험 정책에 user-supplied header가 단독 입력으로 쓰이지 않는가?

### 연습: 두 경로를 의도적으로 다르게 검증하기

1. staging에 `CDN → ingress → app`과 `internal LB → app` 두 경로를 만든다.
2. 각 경로에서 외부가 조작한 `X-Forwarded-For`를 넣어 요청하고, resolver가 첫 경로에서는 edge가 overwrite한 값만, 둘째 경로에서는 peer IP 또는 별도 internal policy만 쓰는지 확인한다.
3. `Forwarded` 목록을 21개로 만들고 invalid IPv6 token을 섞어 parser가 권한·allowlist 입력으로 승격하지 않는지 테스트한다.
4. 마지막으로 account+IP rate limit과 IP-only rate limit의 429 분포를 비교해, NAT 환경에서 정상 사용자가 과도하게 막히지 않는지 수치로 기록한다.
