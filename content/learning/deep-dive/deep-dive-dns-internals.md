---
title: "DNS 내부: 주소창에 google.com을 치면?"
date: 2025-12-28
draft: false
topic: "Network"
tags: ["DNS", "Network", "Infra", "GSLB", "DNSSEC", "DoH"]
categories: ["Backend Deep Dive"]
description: "재귀적 질의, 레코드 타입, 캐싱 전략, DNSSEC/DoH 보안, 컨테이너 DNS, GSLB, 실전 트러블슈팅까지 DNS 내부를 완전히 파헤칩니다."
module: "security"
study_order: 802
quizzes:
  - question: "DNS의 Recursive Lookup에서 Local DNS 서버가 거치는 순서는?"
    options:
      - "Client → Authoritative → TLD → Root"
      - "Root Server → TLD Server → Authoritative Server 순으로 질의"
      - "캐시만 확인"
      - "바로 IP를 반환"
    answer: 1
    explanation: "Local DNS는 Root에게 '.com 관리자 위치'를 물어보고, TLD에게 'naver.com 관리자'를, 최종적으로 Authoritative에게 실제 IP를 물어봅니다."

  - question: "DNS 캐싱에서 TTL(Time To Live)의 역할은?"
    options:
      - "서버를 종료하는 시간"
      - "DNS 응답을 캐시에 저장하는 기간을 지정하여, 매번 재귀 질의를 하지 않도록 함"
      - "네트워크 지연 시간"
      - "도메인 만료 기간"
    answer: 1
    explanation: "TTL이 300초면 5분 동안 캐시된 결과를 사용합니다. TTL이 길면 DNS 변경 후 반영이 느리고, 짧으면 DNS 서버 부하가 증가합니다."

  - question: "GSLB(Global Server Load Balancing)가 DNS를 활용하는 방식은?"
    options:
      - "모든 사용자에게 같은 IP를 반환"
      - "사용자의 위치(IP)를 보고 가장 가까운 서버의 IP를 반환하여 지연을 최소화"
      - "랜덤 IP를 반환"
      - "가장 바쁜 서버 IP를 반환"
    answer: 1
    explanation: "한국 사용자에게는 한국 서버 IP, 미국 사용자에게는 미국 서버 IP를 반환하여 지연(latency)을 줄입니다."

  - question: "배포 후 DNS 반영이 느린 경우 원인으로 가장 가능성이 높은 것은?"
    options:
      - "서버가 느려서"
      - "기존 DNS 레코드의 TTL이 길어서 클라이언트/ISP가 캐시된 이전 IP를 계속 사용"
      - "도메인이 만료됨"
      - "방화벽 문제"
    answer: 1
    explanation: "TTL이 86400초(1일)라면 변경 후 하루 동안 이전 IP로 접속하는 사용자가 있을 수 있습니다. 배포 전 TTL을 낮추는 것이 좋습니다."

  - question: "'dig' 명령어로 DNS 문제를 진단할 때 '+trace' 옵션의 용도는?"
    options:
      - "네트워크 속도 측정"
      - "Root부터 Authoritative까지 전체 질의 경로를 추적하여 어디서 막히는지 확인"
      - "TTL 연장"
      - "캐시 삭제"
    answer: 1
    explanation: "`dig +trace example.com`은 재귀 질의의 전체 경로를 보여줍니다. 특정 단계에서 응답이 없으면 그 서버에 문제가 있는 것입니다."
---

## 1) 인터넷의 전화번호부

우리는 `223.130.195.200`을 외울 수 없습니다. 그래서 `naver.com`을 씁니다.
이 변환 과정을 담당하는 시스템이 **DNS (Domain Name System)**입니다.

단순해 보이지만, 전 세계 수십억 개의 도메인을 **계층적(Hierarchy)**으로 관리하는 거대한 분산 데이터베이스입니다.

### DNS 계층 구조

```
                    . (Root)
                   /    \
              .com      .kr
             /    \       \
        google   naver   go.kr
         /
       www
```

모든 도메인은 사실 끝에 `.`(루트)이 붙습니다. `www.google.com.`이 정식 표기입니다. 브라우저가 생략해줄 뿐입니다.

---

## 2) Recursive Lookup (재귀적 질의)

브라우저가 "naver.com IP가 뭐야?"라고 물어보면, Local DNS 서버는 탐정 놀이를 시작합니다.

```
사용자 브라우저
    │
    ▼ ① naver.com?
OS Stub Resolver (로컬 캐시 확인)
    │  캐시 miss
    ▼ ② naver.com?
Local DNS (ISP/사내 Resolver)
    │  캐시 miss
    ▼ ③ .com이 어디에?      → Root Server (전세계 13 클러스터)
    ▼ ④ naver.com이 어디에? → .com TLD Server
    ▼ ⑤ naver.com A 레코드?  → Naver Authoritative NS
    │
    ▼ ⑥ 223.130.195.200 (TTL=300)
사용자 브라우저
    │
    ▼ TCP 연결 시작
```

**각 서버의 역할:**

| 서버 | 역할 | 전 세계 수 |
|------|------|-----------|
| Root Server | `.com`, `.kr` 등 TLD 관리자 위치 안내 | 13 루트(A~M), 수천 애니캐스트 노드 |
| TLD Server | `naver.com`, `google.com` 관리자 위치 안내 | TLD당 수십~수백 대 |
| Authoritative NS | 실제 도메인의 레코드(A, AAAA, CNAME 등) 보유 | 도메인 소유자가 운영 |

### Iterative vs Recursive 질의

- **Recursive**: 클라이언트가 Local DNS에게 "알아서 다 해와"라고 요청. Local DNS가 Root→TLD→Authoritative를 순차 질의.
- **Iterative**: 각 서버가 "나는 모르지만, 저기 물어봐"라고 다음 단계를 안내. Local DNS가 직접 각 서버에 질의.

실제로는 **클라이언트→Local DNS는 Recursive**, **Local DNS→각 상위 서버는 Iterative**인 혼합 방식이 일반적입니다.

---

## 3) DNS 레코드 타입: 실무에서 꼭 아는 것들

| 레코드 타입 | 용도 | 예시 |
|------------|------|------|
| **A** | 도메인 → IPv4 | `naver.com → 223.130.195.200` |
| **AAAA** | 도메인 → IPv6 | `google.com → 2404:6800:4004:81a::200e` |
| **CNAME** | 도메인 → 다른 도메인 (별칭) | `www.example.com → example.com` |
| **MX** | 메일 서버 지정 | `example.com → mail.example.com (priority 10)` |
| **TXT** | 텍스트 데이터 (SPF, DKIM, 도메인 소유 인증) | `v=spf1 include:_spf.google.com ~all` |
| **NS** | 네임서버 위임 | `example.com → ns1.cloudflare.com` |
| **SOA** | Zone 관리 정보 (시리얼, 새로고침 주기) | Zone의 메타데이터 |
| **SRV** | 서비스 위치 (호스트+포트) | `_sip._tcp.example.com → sip.example.com:5060` |
| **PTR** | IP → 도메인 (역방향) | `200.195.130.223.in-addr.arpa → naver.com` |
| **CAA** | TLS 인증서 발급 허용 CA 지정 | `example.com CAA 0 issue "letsencrypt.org"` |

### CNAME의 함정

```bash
# CNAME은 다른 레코드와 공존할 수 없음
# ❌ 잘못된 설정
example.com   CNAME  lb.example.com
example.com   MX     mail.example.com    # CNAME과 충돌!

# ✅ 올바른 설정 — Zone Apex(루트 도메인)에는 A/AAAA 사용
example.com   A      203.0.113.10
example.com   MX     mail.example.com
www.example.com  CNAME  example.com       # 서브도메인은 CNAME OK
```

> **Zone Apex 문제**: `example.com` (서브도메인 없음)에 CNAME을 쓸 수 없어서, AWS ALB 같은 동적 IP 서비스를 연결할 때 Route53의 **Alias** 레코드나 Cloudflare의 **CNAME Flattening**을 사용합니다.

---

## 4) DNS 캐싱 전략: TTL의 실무 감각

### TTL(Time To Live)이 왜 중요한가

| TTL 값 | 장점 | 단점 | 적합한 상황 |
|--------|------|------|-----------|
| **짧음 (60~300초)** | DNS 변경이 빠르게 반영 | DNS 서버 부하 증가, 지연 증가 | 배포 직전/직후, Failover |
| **보통 (3600초/1시간)** | 균형잡힌 트레이드오프 | — | 대부분의 서비스 |
| **긴 TTL (86400초/1일)** | DNS 부하 최소화, 빠른 응답 | 변경 반영이 하루까지 걸림 | 거의 변경되지 않는 서비스 |

### 배포 전 TTL 사전 축소 패턴

```
[평상시]    example.com  A  1.1.1.1  TTL=3600
                ↓
[배포 24시간 전]  TTL을 60으로 낮춤 (기존 캐시가 만료되길 기다림)
                ↓
[배포 시점]    IP를 2.2.2.2로 변경 → 60초 내 전파
                ↓
[안정 확인 후]  TTL을 다시 3600으로 올림
```

이 패턴을 모르면 "IP 바꿨는데 아직도 옛날 서버로 가요" 장애가 발생합니다.

### 캐싱 레이어

```
1. 브라우저 캐시 (chrome://net-internals/#dns)
2. OS 캐시 (macOS: scutil --dns, Linux: systemd-resolved)
3. 로컬 DNS 서버 캐시 (ISP/사내 Resolver)
4. 중간 Resolver 캐시 (Cloudflare 1.1.1.1, Google 8.8.8.8)
```

**주의**: 캐싱 레이어가 여러 개라서, TTL을 낮춰도 일부 클라이언트는 상위 레이어 캐시 때문에 느리게 반영될 수 있습니다.

---

## 5) DNS 보안: DNSSEC과 DoH/DoT

### DNS의 보안 취약점

기본 DNS는 **UDP 평문**입니다. 이로 인해:

| 공격 | 설명 | 위험도 |
|------|------|--------|
| **DNS Spoofing/Cache Poisoning** | 위조된 DNS 응답을 Resolver 캐시에 심음 | 높음 — 피싱 사이트로 유도 가능 |
| **DNS Hijacking** | ISP/라우터가 DNS 응답을 조작 | 중간 — 광고 삽입, 검열 |
| **DNS 도청** | 질의 내용이 평문으로 노출 | 낮~중 — 브라우징 패턴 감시 가능 |

### DNSSEC (DNS Security Extensions)

DNSSEC은 DNS 응답에 **디지털 서명**을 추가해서, 응답이 진짜 Authoritative Server에서 온 것인지 검증합니다.

```
[질의] example.com A?

[DNSSEC 응답]
  example.com   A     93.184.216.34
  example.com   RRSIG A  (서명값: Zone Signing Key로 서명)

  ↑ 이 서명을 검증하려면
    example.com   DNSKEY  (Zone Signing Key 공개키)
    example.com   DS      (Key Signing Key의 해시 — 상위 Zone에 등록됨)
```

**검증 체인**: Root → `.com` DS → `example.com` DNSKEY → RRSIG 서명 검증

```bash
# DNSSEC 검증 확인
dig +dnssec example.com

# 응답에 "ad" 플래그가 있으면 DNSSEC 검증 통과
;; flags: qr rd ra ad;
#                    ^^ Authenticated Data
```

### DoH (DNS over HTTPS) / DoT (DNS over TLS)

| 프로토콜 | 포트 | 특징 |
|---------|------|------|
| 전통 DNS | UDP 53 | 평문, 빠름, 도청 가능 |
| DoT | TCP 853 | TLS 암호화, 방화벽에서 쉽게 차단 가능 |
| DoH | TCP 443 | HTTPS와 같은 포트, 일반 트래픽과 구분 불가 |

```bash
# DoH로 질의 (Cloudflare)
curl -s 'https://1.1.1.1/dns-query?name=google.com&type=A' \
  -H 'Accept: application/dns-json' | jq

# 응답
{
  "Answer": [
    { "name": "google.com", "type": 1, "TTL": 187, "data": "142.250.206.206" }
  ]
}
```

> **실무 판단**: 사내 서비스에서 DoH/DoT가 필수인 경우는 드물지만, 공용 네트워크에서 민감 트래픽을 보호할 때 유용합니다.

---

## 6) 컨테이너/Kubernetes DNS: 가장 많이 막히는 구간

### Docker의 DNS

```bash
# Docker 컨테이너 내부
cat /etc/resolv.conf
# nameserver 127.0.0.11   ← Docker 내장 DNS 서버

# 같은 네트워크의 다른 컨테이너를 이름으로 접근
curl http://redis:6379
```

Docker Compose에서 서비스 이름이 DNS로 자동 등록됩니다. 하지만:

```yaml
# ❌ 흔한 실수 — 서비스 시작 순서와 DNS 해석 시점
services:
  app:
    depends_on:
      - db
    environment:
      DB_HOST: db   # db 컨테이너가 아직 ready가 아닐 수 있음
```

`depends_on`은 컨테이너 시작만 보장하지, 서비스 준비(ready)를 보장하지 않습니다. DNS는 해석되지만 연결은 실패할 수 있습니다.

### Kubernetes DNS (CoreDNS)

```bash
# Pod 내부
cat /etc/resolv.conf
# nameserver 10.96.0.10        ← kube-dns/CoreDNS ClusterIP
# search default.svc.cluster.local svc.cluster.local cluster.local
# ndots: 5
```

K8s에서 서비스 접근 방식:

```
# 같은 네임스페이스
curl http://order-service:8080

# 전체 FQDN
curl http://order-service.production.svc.cluster.local:8080

# 해석 순서 (ndots=5일 때, 점이 5개 미만이면 search 도메인을 먼저 시도)
order-service
  → order-service.default.svc.cluster.local (1차)
  → order-service.svc.cluster.local          (2차)
  → order-service.cluster.local              (3차)
  → order-service                            (최종 — 외부 DNS)
```

### ndots 함정과 성능 이슈

`ndots: 5`가 기본값인데, 외부 도메인(`api.stripe.com` = 점 2개)을 질의할 때도 **search 도메인을 먼저 시도**합니다:

```
api.stripe.com.default.svc.cluster.local     (NXDOMAIN)
api.stripe.com.svc.cluster.local              (NXDOMAIN)
api.stripe.com.cluster.local                  (NXDOMAIN)
api.stripe.com                                (성공!)
```

→ 외부 도메인 하나에 DNS 질의 **4번**. 트래픽이 많으면 CoreDNS 부하가 됩니다.

**해결법:**

```yaml
# Pod spec에서 ndots 조정
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"   # 점이 2개 이상이면 search 도메인 건너뜀
```

또는 코드에서 외부 도메인에 **trailing dot**을 붙이기:

```java
// FQDN 명시 (마지막 . 이 있으면 search 도메인 시도 안 함)
String stripeApi = "api.stripe.com.";
```

---

## 7) GSLB (Global Server Load Balancing)

DNS는 단순히 IP만 알려주는 게 아닙니다. **가장 가까운 서버**를 알려줍니다.

### GSLB의 동작 원리

```
한국 사용자 → DNS 질의 → GSLB
  └─ Source IP: 203.0.113.x (한국 ISP)
  └─ 응답: 서울 리전 IP (1.1.1.1)

미국 사용자 → DNS 질의 → GSLB
  └─ Source IP: 198.51.100.x (미국 ISP)
  └─ 응답: 버지니아 리전 IP (2.2.2.2)
```

### GSLB 라우팅 정책

| 정책 | 설명 | 적합한 상황 |
|------|------|-----------|
| **Geolocation** | 클라이언트 IP 기반 지역 매칭 | 법적/규제 요구사항 (데이터 주권) |
| **Latency-based** | 실측 지연이 가장 낮은 리전 | 글로벌 서비스 (Netflix, CDN) |
| **Weighted** | 가중치 비율로 트래픽 분배 | 카나리 배포, 점진적 마이그레이션 |
| **Failover** | Primary 실패 시 Secondary로 전환 | DR (Disaster Recovery) |
| **Multi-value** | 여러 IP를 반환하고 클라이언트가 선택 | 간단한 부하 분산 |

### Health Check와 자동 Failover

```
GSLB는 각 리전 서버에 주기적으로 Health Check를 보냄
  서울 서버: 200 OK ✓
  도쿄 서버: 200 OK ✓
  싱가포르 서버: 503 (장애) ✗

→ 싱가포르 사용자 → 도쿄 서버로 리다이렉션
```

> **GSLB의 한계**: DNS 응답이 캐시되기 때문에, Failover까지 TTL 시간만큼 걸립니다. 빠른 Failover가 필요하면 Anycast + BGP를 병행합니다.

---

## 8) 실전 트러블슈팅: dig, nslookup, 그리고 더

### dig 기본 사용법

```bash
# 기본 질의
dig google.com

# 특정 레코드 타입
dig google.com AAAA     # IPv6
dig google.com MX       # 메일 서버
dig google.com TXT      # SPF/DKIM
dig google.com NS       # 네임서버
dig google.com CAA      # 인증서 발급 허용 CA

# 특정 DNS 서버에게 질의
dig @8.8.8.8 google.com        # Google Public DNS
dig @1.1.1.1 google.com        # Cloudflare DNS
```

### dig +trace: 전체 경로 추적

```bash
$ dig +trace naver.com

;; Received 228 bytes from 8.8.8.8 in 15 ms    ← Root
.                  518400 IN NS a.root-servers.net.

;; Received 745 bytes from 192.5.6.30 in 42 ms  ← .com TLD
com.               172800 IN NS a.gtld-servers.net.

;; Received 219 bytes from 192.26.92.30 in 8 ms ← Naver NS
naver.com.         300    IN A  223.130.195.200
```

각 단계에서 응답 시간과 어떤 서버가 응답했는지 볼 수 있어서, **어디서 느려지거나 막히는지** 정확히 파악할 수 있습니다.

### 자주 만나는 DNS 문제 진단 플로우

```
문제: "도메인이 안 풀린다"

1) dig @8.8.8.8 example.com
   → 응답 있음? → 로컬 DNS/캐시 문제
   → NXDOMAIN? → 2번으로

2) dig example.com NS
   → NS 레코드 있음? → Authoritative 서버 문제
   → SERVFAIL? → 3번으로

3) dig +trace example.com
   → 어디서 끊기는지 확인 (TLD? NS 위임?)

4) 최근 DNS 변경 이력 확인
   → TTL이 긴데 변경 직후? → 캐시 만료 대기
```

### 유용한 진단 명령어

```bash
# macOS — DNS 캐시 초기화
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

# Linux — systemd-resolved 캐시 확인
resolvectl statistics
resolvectl flush-caches

# 역방향 DNS (IP → 도메인)
dig -x 223.130.195.200

# 간결한 출력 (스크립트에 유용)
dig +short google.com
# 142.250.206.206

# 응답 시간만 확인
dig google.com | grep "Query time"
# ;; Query time: 12 msec
```

---

## 9) DNS 레코드 실전 설정 패턴

### 웹 서비스 기본 설정

```
# Zone: example.com

# 루트 도메인 → 로드밸런서
example.com.       300  IN  A       203.0.113.10
example.com.       300  IN  AAAA    2001:db8::10

# www → 루트 도메인으로
www.example.com.   300  IN  CNAME   example.com.

# API 서브도메인 → 별도 서버
api.example.com.   300  IN  A       203.0.113.20

# 메일 서버
example.com.       300  IN  MX  10  mail.example.com.
example.com.       300  IN  MX  20  mail-backup.example.com.

# 메일 보안 (SPF + DKIM + DMARC)
example.com.       300  IN  TXT  "v=spf1 include:_spf.google.com -all"
_dmarc.example.com. 300 IN  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@example.com"

# 인증서 발급 제한
example.com.       300  IN  CAA  0 issue "letsencrypt.org"
```

### Blue-Green 배포 DNS 패턴

```bash
# 현재: Blue 환경 활성
app.example.com.  60  IN  CNAME  blue.example.com.

# 전환: Green 환경으로 변경
app.example.com.  60  IN  CNAME  green.example.com.

# TTL=60이므로 최대 1분 내 전환 완료
# 롤백: 다시 blue로 CNAME 변경
```

---

## 10) DNS 성능 최적화

### Prefetch (브라우저 힌트)

```html
<!-- 브라우저가 미리 DNS 해석 -->
<link rel="dns-prefetch" href="//cdn.example.com">
<link rel="dns-prefetch" href="//api.example.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
```

### Happy Eyeballs (RFC 8305)

최신 브라우저/OS는 IPv4와 IPv6를 동시에 질의하고, 먼저 연결되는 쪽을 사용합니다. 이를 "Happy Eyeballs"라고 합니다.

```
A 질의:    google.com → 142.250.206.206 (IPv4)
AAAA 질의: google.com → 2404:6800:...   (IPv6)

→ 두 연결을 동시에 시도 → 먼저 성공한 쪽 사용
```

### 내부 DNS 캐시 서버 운영

트래픽이 많은 서비스에서는 내부에 Unbound/dnsmasq 같은 캐시 Resolver를 두면:

- 외부 DNS 질의 횟수 감소
- 응답 지연 감소 (로컬 캐시 히트)
- 외부 DNS 장애로부터 일정 시간 보호 (캐시 TTL 동안)

---

## 11) 자주 하는 실수와 안티패턴

| 실수 | 문제 | 해결 |
|------|------|------|
| Zone Apex에 CNAME 사용 | MX/TXT 레코드와 충돌 | A/AAAA 또는 Alias/CNAME Flattening |
| TTL 고려 없이 DNS 변경 | 전파 지연으로 장애 | 변경 전 TTL 사전 축소 |
| K8s ndots=5에서 외부 도메인 질의 | DNS 질의 4배 증가 | ndots 조정 또는 FQDN 사용 |
| DNS Failover에만 의존 | TTL 동안 장애 지속 | Anycast + 애플리케이션 레벨 Failover 병행 |
| DNSSEC 미적용 | Cache Poisoning 위험 | DNSSEC 서명 + Resolver 검증 활성화 |
| /etc/hosts 편집으로 임시 해결 | 다른 서비스에 영향, 복구 누락 | dig으로 근본 원인 파악 후 DNS 수정 |

---

## 12) 운영 체크리스트

### DNS 설정 점검

- [ ] Zone Apex에 CNAME을 쓰지 않았는가?
- [ ] TTL이 서비스 SLO에 맞게 설정되어 있는가?
- [ ] MX/SPF/DKIM/DMARC가 올바르게 설정되어 있는가?
- [ ] CAA 레코드로 인증서 발급을 제한하고 있는가?

### 보안 점검

- [ ] DNSSEC이 활성화되어 있는가?
- [ ] 민감 환경에서 DoH/DoT를 사용하고 있는가?
- [ ] DNS 변경 권한이 최소 인원에게만 있는가?

### Kubernetes DNS 점검

- [ ] CoreDNS 리소스(CPU/메모리)가 충분한가?
- [ ] 외부 도메인 질의가 많은 Pod에서 ndots를 조정했는가?
- [ ] CoreDNS 메트릭(query rate, latency, NXDOMAIN rate)을 모니터링하고 있는가?

### 장애 대응 점검

- [ ] DNS Failover TTL이 적절한가? (권장: 60~300초)
- [ ] DNS 변경 전 TTL 사전 축소 절차가 있는가?
- [ ] DNS 장애 시 /etc/hosts 대신 근본 원인 추적을 먼저 하는가?

---

## 연습(추천)

1. `dig +trace`로 자신이 자주 쓰는 도메인의 전체 해석 경로를 추적해보기
2. `dig +dnssec`로 DNSSEC 서명이 있는 도메인(예: `cloudflare.com`)을 확인해보기
3. Docker Compose에서 서비스 이름으로 DNS 해석이 되는지 확인하고, `nslookup`으로 내부 DNS를 추적해보기
4. K8s Pod에서 `ndots: 5`일 때 외부 도메인 질의가 몇 번 발생하는지 `tcpdump`로 캡처해보기
5. Route53 또는 Cloudflare에서 TTL을 바꿔보고, 전파 시간을 측정해보기

---

## 관련 심화 학습

- [DNS와 웹 기초](/learning/deep-dive/deep-dive-dns-web-basics/) — HTTP/DNS 기초 복습
- [TCP/HTTP2 기초](/learning/deep-dive/deep-dive-tcp-http2-basics/) — DNS 이후의 TCP 연결
- [TLS Handshake](/learning/deep-dive/deep-dive-tls-handshake/) — DNS 해석 후 보안 연결
- [Load Balancer & Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/) — GSLB 이후의 L4/L7 로드밸런싱
- [VPC 네트워크](/learning/deep-dive/deep-dive-vpc-network-basics/) — 클라우드 환경의 DNS 설정
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — CoreDNS와 서비스 디스커버리
- [HTTP Deep Dive](/learning/deep-dive/deep-dive-http-deep-dive/) — DNS 이후 HTTP 요청 흐름
