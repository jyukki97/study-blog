---
title: "백엔드 커리큘럼 심화: DNS Resolver 장애를 격리하는 TTL·Negative Cache·Stale Answer 플레이북"
date: 2026-09-04T10:06:00+09:00
lastmod: 2026-09-04T10:06:00+09:00
draft: false
topic: "Resilience"
tags: ["DNS", "Resolver", "Negative Cache", "Stale Answer", "Service Discovery", "Timeout Budget"]
categories: ["Backend Deep Dive"]
description: "DNS 조회 실패가 외부 API와 서비스 디스커버리 장애로 번지는 경로를 끊기 위해 TTL, negative cache, stale answer, timeout budget을 운영하는 기준을 정리합니다."
module: "resilience"
study_order: 1216
keywords: ["DNS resolver", "negative caching", "serve stale", "DNS timeout", "service discovery", "resolver resilience"]
---

서비스가 외부 API 또는 내부 서비스를 호출할 때 DNS는 너무 당연해서 설계에서 빠지기 쉽다. 그러나 이름 해석이 느려지면 애플리케이션은 아직 TCP 연결조차 시작하지 못한다. 이때 HTTP 재시도만 늘리면 같은 hostname을 다시 해석하는 요청이 겹치고, 스레드·커넥션 풀·상위 의존성까지 기다림 상태로 쌓인다. 실제 장애에서 `UnknownHostException`이나 resolver timeout은 네트워크 문제처럼 보이지만, 잘못된 캐시 정책과 deadline 배분이 피해를 키우는 경우가 많다.

이 글의 목표는 DNS를 고가용성 시스템의 작은 구현 세부가 아니라 **의존성 호출의 첫 번째 admission gate**로 다루는 것이다. DNS 패킷 구조 자체는 [DNS 동작 원리](/learning/deep-dive/deep-dive-dns-internals/)를, endpoint 선택까지 포함한 흐름은 [헬스 기반 서비스 디스커버리](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)를 먼저 보면 이해가 쉽다. 여기서는 resolver가 느리거나 오래된 답을 줄 때 애플리케이션이 무엇을 허용하고 무엇을 빠르게 포기해야 하는지에 집중한다.

## 이 글에서 얻는 것

- DNS 해석 실패, 연결 실패, 원격 서버 응답 지연을 서로 다른 신호로 분리하는 방법을 배웁니다.
- TTL과 negative cache를 무조건 길게 또는 짧게 잡지 않고, 변경 빈도·장애 비용·복구 목표로 결정하는 기준을 얻습니다.
- stale answer를 허용할 요청과 금지할 요청을 나누고, 전체 요청 deadline 안에 resolver 예산을 배치할 수 있습니다.
- canary에서 어떤 메트릭을 봐야 DNS 문제를 HTTP 5xx 폭증 전에 발견하는지 정리합니다.

## 핵심 개념/이슈

### 1) DNS 성공은 endpoint가 건강하다는 뜻이 아니다

DNS는 보통 `이 이름에 대해 최근에 알려진 주소가 무엇인가`를 답한다. 그 주소에 TCP 연결이 되는지, TLS 인증서가 맞는지, 실제 애플리케이션이 요청을 처리하는지는 별개의 질문이다. 반대로 DNS lookup이 실패했다는 사실도 언제나 레코드가 사라졌다는 뜻은 아니다. resolver의 과부하, upstream packet loss, 짧은 timeout, 검색 도메인 설정 오류처럼 이름 데이터와 무관한 원인이 많다.

따라서 호출 실패를 다음 세 단계로 계측해야 한다.

1. **resolution**: cache hit/miss, 질의 시간, `NXDOMAIN`·`SERVFAIL`·timeout
2. **connect/TLS**: 선택한 IP, 연결 시간, handshake 실패
3. **application**: HTTP/gRPC 상태, 첫 바이트 시간, 전체 응답 시간

세 단계를 한 개의 “외부 API 실패율”로 합치면 해결책을 잘못 고르기 쉽다. connection 오류에는 [외부 API adapter와 의존성 격리](/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/)의 circuit breaker가 유효하지만, resolution timeout에는 resolver 쿼리 폭증을 줄이는 정책이 먼저다.

### 2) TTL은 최신성 목표가 아니라 재질의 비용의 상한선이다

권한 있는 DNS 서버가 TTL을 60초로 주었다고 해서 모든 클라이언트가 정확히 60초 뒤에 새 주소를 쓰는 것은 아니다. 중간 resolver, OS cache, 런타임 cache, 라이브러리의 자체 cache가 각각 다른 시간을 적용할 수 있고, cache eviction으로 더 일찍 조회할 수도 있다. 그러므로 “blue/green 전환 후 60초면 끝난다”라는 배포 계획은 안전하지 않다.

TTL 결정에는 최소 세 질문이 필요하다.

- 주소 변경이 잘못 반영됐을 때 얼마 동안 이전 endpoint를 쓰는 것이 허용되는가?
- 정상 시 cache miss 하나가 resolver와 authoritative DNS에 만드는 비용은 얼마인가?
- 장애 중 재시도가 같은 hostname 조회를 몇 배로 증폭할 수 있는가?

예를 들어 자주 바뀌지 않는 third-party API라면 5~15분의 애플리케이션 단 cache가 합리적일 수 있다. 반면 pod IP를 직접 노출하는 짧은 수명의 endpoint는 플랫폼의 discovery 방식과 readiness 신호에 맞춰 더 짧게 잡아야 한다. 핵심은 숫자 하나가 아니라 **변경 전파 시간과 cache-miss 폭주를 같은 문서에서 합의하는 것**이다.

### 3) Negative cache는 오타와 장애를 모두 기억한다

`NXDOMAIN`은 해당 이름이 없다는 응답이고, `SERVFAIL`과 timeout은 이름이 없다는 사실을 증명하지 못한다. 이를 같은 방식으로 cache하면 새로 생성한 레코드가 보이지 않거나, 일시적인 resolver 장애가 길게 고정될 수 있다. 반대로 negative cache가 전혀 없으면 잘못된 tenant subdomain이나 오타가 매 요청마다 upstream DNS 질의를 만든다.

실무에서는 원인을 보존한 채 상한을 다르게 두는 방식이 안전하다.

- 명시적 `NXDOMAIN`: authoritative TTL을 존중하되, 애플리케이션 자체 상한을 예컨대 30~120초부터 관찰한다.
- `SERVFAIL`·timeout: 정상 주소 부재로 저장하지 않는다. 짧은 backoff와 제한된 재시도만 적용한다.
- 설정 오류로 확정된 hostname: 배포 검증에서 막고, 런타임 cache로 숨기지 않는다.

이 구분을 하지 않으면 캐시가 부하 완화 장치가 아니라 복구 지연 장치가 된다.

### 4) Stale answer는 가용성 기능이지 만능 fallback이 아니다

마지막으로 성공한 A/AAAA 레코드를 TTL 만료 뒤에도 제한적으로 쓰는 `serve stale`은 resolver 장애 중 호출을 계속하게 해 준다. 단, 오래된 주소가 새 tenant, 폐기된 IP 또는 이미 다른 서비스로 재할당된 위치를 가리킬 수 있으므로 모든 호출에 켜면 안 된다.

권장 기준은 “마지막 검증 시각”과 “업무의 주소 최신성”을 함께 확인하는 것이다. 예를 들어 읽기 전용이고 endpoint 교체가 드문 결제 조회 API에는 마지막 성공 응답이 5분 이내일 때 30~60초의 stale window를 둘 수 있다. 반면 인증 callback, 데이터 삭제, 서비스 메시의 동적 endpoint처럼 잘못된 대상으로 보내는 비용이 큰 요청은 TTL 만료 뒤 stale 사용을 금지하고 빠르게 실패시켜야 한다. stale을 썼다면 `dns_stale_answer=true`, answer age, 실제 연결 성공 여부를 반드시 남긴다.

## 실무 적용

### 1) Deadline 안에서 resolver 예산을 먼저 고정한다

DNS에는 별도 timeout이 필요하지만, 전체 deadline 밖에서 독립적으로 재시도하면 안 된다. 예를 들어 사용자 요청의 outbound budget이 1초라면 DNS에 100~200ms, TCP/TLS에 200~300ms, 원격 처리와 한 번의 제한된 재시도에 나머지를 배분하는 식으로 시작할 수 있다. 이 값은 예시이며, 현재 p95와 연결 수명에 따라 조정한다.

중요한 불변식은 다음 둘이다.

- 남은 전체 deadline보다 긴 DNS 재시도를 시작하지 않는다.
- DNS 재시도와 HTTP 재시도를 곱하지 않는다. 예를 들어 DNS 2회와 HTTP 3회가 독립이면 최악의 경우 6개의 작업이 생긴다.

resolver error가 1분 이동 창에서 평시의 5배를 넘거나, resolution p99가 호출 예산의 25%를 넘으면 HTTP 재시도 확대보다 먼저 lookup 동시성 상한을 적용한다. 요청별 cache miss를 공유하고, 동일 hostname에 대한 동시 질의는 한 번으로 합치는 것이 효과적이다. 이는 [요청 코얼레싱](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)을 DNS 계층에도 적용하는 사고방식이다.

### 2) hostname별 정책을 코드가 아니라 inventory로 관리한다

모든 hostname에 공통 TTL과 stale window를 하드코딩하면, 중요 endpoint와 일반 SaaS endpoint가 같은 위험을 진다. 다음 필드를 가진 작은 inventory부터 만든다.

| 분류 | 예시 | stale 허용 | 초기 cache 정책 | 중단 기준 |
| --- | --- | --- | --- | --- |
| 내부 고정 endpoint | 사내 정적 API | 조건부 | TTL 존중 + 짧은 상한 | 연결 실패율 증가 |
| 외부 읽기 API | 환율·검색 조회 | 제한적 허용 | 5~15분 후보 | answer age 초과 |
| 쓰기·인증 endpoint | 결제·OAuth callback | 금지 | TTL 존중 | resolution 실패 시 즉시 보류 |
| 동적 discovery | 짧은 수명 workload | 플랫폼 규칙 우선 | 짧은 TTL | readiness 불일치 |

표의 값은 조직의 시작점일 뿐이다. 실제로는 지난 30일의 DNS 변경 횟수, endpoint 전환 리허설 결과, stale answer 뒤 연결 성공률을 붙여야 정책이 유지된다.

### 3) 관측성은 IP가 아니라 결정 과정을 남겨야 한다

IP 주소만 로그에 남기면 “왜 그 IP를 골랐는가”를 설명할 수 없다. outbound trace 또는 구조화 로그에는 `hostname`, answer source(cache/fresh/stale), answer age, resolver name, DNS rcode, selected IP, connect result를 넣는다. 단, full query name이 고객 식별자를 포함할 수 있다면 정규화 또는 hash 처리한다.

알림은 resolver 오류율만으로 만들지 않는 편이 낫다. `cache-miss rate 급증 + resolution p99 증가 + stale 사용률 증가`가 함께 나타나고 5분 이상 지속될 때 조사 우선순위를 올리면, 단일 일시 오류에 대한 소음을 줄일 수 있다. 외부에서 실제 lookup과 연결을 재현하는 [Synthetic Monitoring](/learning/deep-dive/deep-dive-synthetic-monitoring-user-journey-probes-playbook/)도 DNS와 HTTP를 같은 probe에서 한 덩어리로만 보지 않도록 분리한다.

## 트레이드오프/주의점

첫째, TTL을 짧게 하면 전환 반응은 빨라지지만 resolver 비용과 장애 시 fan-out이 커진다. 둘째, 긴 TTL과 stale answer는 가용성을 높일 수 있으나, 잘못된 route를 오래 유지할 위험이 있다. 셋째, 런타임마다 DNS cache 동작이 달라 인프라에서 정한 TTL만 믿으면 운영 문서와 실제가 어긋난다. Java의 JVM cache, 컨테이너의 libc resolver, sidecar DNS cache 중 어디가 최종 결정을 하는지 배포 전 확인해야 한다.

또한 public DNS의 성공을 내부 서비스의 건강 신호로 쓰지 말아야 한다. 내부 DNS, mesh, egress, 인증서 갱신처럼 다른 경로가 실패할 수 있기 때문이다. DNS fallback resolver를 추가하더라도 private zone을 모르는 public resolver로 요청이 새지 않는지, split-horizon 규칙과 데이터 노출 위험을 먼저 검토한다.

## 체크리스트 또는 연습

1. 가장 중요한 outbound hostname 5개를 고르고, 최근 30일의 주소 변경 빈도와 stale 허용 여부를 기록한다.
2. 테스트 환경에서 resolver timeout을 200ms로 주입해 resolution·connect·application 오류가 별도 지표로 보이는지 확인한다.
3. 동일 hostname에 동시에 100개 요청을 보내 cache miss 질의 수가 100개보다 충분히 작아지는지 측정한다.
4. `NXDOMAIN`, `SERVFAIL`, timeout 각각에 대해 cache되는 기간과 재시도 횟수를 문서화한다.
5. 읽기 endpoint 하나에서만 30초 stale window를 canary로 켜고, stale 사용률·연결 성공률·오래된 route 비율을 1주 비교한다.

DNS 장애의 목표는 어떤 주소든 계속 쓰는 것이 아니다. **주소가 불확실할 때 불필요한 질의를 증폭하지 않고, 안전한 호출만 제한적으로 계속하며, 위험한 쓰기는 빠르게 멈추는 것**이다. 이 기준을 endpoint별로 명시하면 작은 resolver 흔들림이 전체 서비스의 대기열 장애로 자라는 것을 막을 수 있다.
