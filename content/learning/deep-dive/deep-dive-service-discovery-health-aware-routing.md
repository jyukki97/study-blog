---
title: "백엔드 커리큘럼 심화: Service Discovery와 Health-Aware Routing 실무 설계"
date: 2026-04-14
draft: false
topic: "Distributed Systems"
tags: ["Service Discovery", "Health Check", "Load Balancing", "Service Mesh", "DNS", "Backend"]
categories: ["Backend Deep Dive"]
description: "인스턴스가 자주 바뀌는 환경에서 DNS, registry, client-side/server-side discovery, active/passive health check를 어떻게 조합해야 안정적인 라우팅이 되는지 실무 기준으로 정리합니다."
module: "backend-distributed"
study_order: 1173
---

서비스를 처음 만들 때는 discovery가 별문제가 아닙니다. URL 하나 고정해 두고 뒤에 서버 두세 대만 붙여도 대부분 돌아갑니다. 그런데 오토스케일링이 붙고, 배포가 하루 여러 번 일어나고, readiness가 늦게 올라오는 인스턴스가 생기기 시작하면 문제가 달라집니다. DNS에는 아직 살아 있다고 나오는데 실제로는 drain 중인 인스턴스로 붙고, registry는 healthy라고 표시하는데 애플리케이션 워밍업이 끝나지 않아 첫 요청 수십 개가 터지고, 장애 난 노드를 outlier ejection 없이 계속 재시도하다가 전체 지연이 번지는 식입니다.

실무에서 service discovery의 핵심은 "어디에 붙을까"보다 **언제 붙으면 안 되는가를 얼마나 빨리 반영하느냐**에 가깝습니다. 같은 서비스라도 DNS 기반이 맞는 경우가 있고, registry watch가 필요한 경우가 있고, client-side discovery보다 L7 프록시나 service mesh가 훨씬 안전한 경우도 있습니다. 결국 discovery는 주소 찾기 기능이 아니라 **신선도(freshness), 실패 격리, 운영 일관성 사이의 균형 문제**입니다.

이 글은 service discovery를 추상 개념으로 끝내지 않고, 어떤 팀에서 DNS만으로 충분한지, 언제 registry 또는 mesh로 넘어가야 하는지, health-aware routing에서 어떤 숫자를 기본값으로 잡아야 하는지 정리합니다. 같이 보면 좋은 글로는 [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/), [Load Balancer Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/), [DNS Internals](/learning/deep-dive/deep-dive-dns-internals/), [Service Mesh Istio](/learning/deep-dive/deep-dive-service-mesh-istio/)가 있습니다.

## 이 글에서 얻는 것

- service discovery를 DNS, registry, service mesh 관점에서 비교하고 현재 환경에 맞는 기본값을 정할 수 있습니다.
- liveness, readiness, passive check를 어떻게 나눠야 실제 장애 전파를 줄일 수 있는지 실무 기준을 잡을 수 있습니다.
- stale endpoint, connection draining 누락, zone 불균형 같은 운영 사고를 어떤 순서로 막아야 하는지 판단 기준을 세울 수 있습니다.

## 핵심 개념/이슈

### 1) discovery의 본질은 주소 조회가 아니라 "신선도 예산" 관리다

많은 글이 service discovery를 "서비스 이름을 실제 IP로 바꾸는 메커니즘"이라고 설명합니다. 틀린 말은 아니지만 운영에서는 이 설명만으로 부족합니다. 더 중요한 질문은 아래입니다.

- 인스턴스가 죽거나 drain되면 **몇 초 안에** 라우팅 테이블에서 빠져야 하는가
- 새 인스턴스가 뜨면 **언제부터** 실제 트래픽을 받아도 되는가
- 부분 장애가 생겼을 때 잘못된 endpoint 정보가 **얼마나 넓게** 퍼질 수 있는가

예를 들어 배포 간격이 하루 1회이고 인스턴스 변화가 거의 없다면 DNS TTL 30초도 크게 문제되지 않을 수 있습니다. 반대로 10분마다 scale in/out이 일어나고 rolling update 중 warm-up이 20초 걸리는 시스템이면 DNS TTL 30초는 너무 깁니다. 오래된 레코드가 남아 있어도 사용자 요청은 계속 그쪽으로 갑니다.

그래서 discovery 설계는 보통 아래 세 축으로 봐야 맞습니다.

- **신선도**: endpoint 변화가 라우팅에 반영되는 속도
- **일관성**: 모든 클라이언트가 비슷한 뷰를 보는 정도
- **폭발 반경**: 잘못된 상태가 퍼졌을 때 몇 개 클라이언트가 동시에 영향받는가

이 관점이 없으면 "Consul이 좋나, DNS가 좋나" 같은 도구 비교로 끝나기 쉽습니다. 실제로는 도구보다 **업데이트 빈도와 실패 비용**이 먼저입니다.

### 2) DNS, registry, mesh는 대체재가 아니라 운영 단계별 기본값이다

세 가지를 단순 비교하면 아래 정도로 정리할 수 있습니다.

| 방식 | 장점 | 약점 | 잘 맞는 환경 |
|------|------|------|-------------|
| **DNS 기반 discovery** | 단순함, 표준성, 운영 비용 낮음 | TTL 때문에 stale endpoint 가능 | 인스턴스 변화가 느린 내부 서비스 |
| **Registry 기반 discovery** | 빠른 갱신, metadata 풍부 | 클라이언트 라이브러리/운영 복잡도 증가 | VM/ECS, 빠른 오토스케일링 |
| **Proxy/Mesh 기반 routing** | 재시도, outlier ejection, mTLS 일관화 | 학습비용과 운영면 복잡 | polyglot, 대규모 마이크로서비스 |

Kubernetes 안에서는 Service + EndpointSlice + readiness probe만으로도 꽤 많은 문제를 해결합니다. 이 경우 discovery 자체를 애플리케이션이 직접 다루기보다 플랫폼이 처리하는 편이 안전합니다. 반대로 VM 기반 서비스나 여러 런타임이 섞인 환경에서는 registry가 더 직접적일 수 있습니다. 중요한 것은 **"더 최신 기술"이 아니라 팀이 감당할 수 있는 운영면을 고르는 것**입니다.

실무 기준으로는 아래처럼 출발하는 편이 무난합니다.

- 단일 클러스터, 동일 플랫폼, 서비스 30개 이하: DNS 또는 플랫폼 기본 Service 우선
- scale event가 10분 내 20% 이상 자주 발생: registry watch 또는 proxy 갱신 도입 검토
- 언어/프레임워크가 4종 이상, 재시도 정책이 제각각: server-side proxy 또는 mesh 우선
- 보안, mTLS, traffic policy를 팀별 코드에 맡기기 어렵다: mesh 또는 공용 프록시 우선

즉 discovery는 중앙집중화할수록 일관성이 좋아지고, 단순화할수록 장애 면적은 작아집니다. 어느 쪽이 더 좋은지가 아니라 어느 비용을 지금 감당할 수 있는지가 중요합니다.

### 3) client-side discovery는 빠르지만, 정책 드리프트 비용을 꼭 같이 계산해야 한다

client-side discovery의 장점은 명확합니다. 클라이언트가 registry나 endpoint 목록을 직접 보고, 로컬에서 로드밸런싱을 결정하므로 홉이 줄고 유연성이 높습니다. 하지만 언어가 늘고 서비스 수가 늘어나면 다른 비용이 바로 올라옵니다.

- 재시도, 타임아웃, outlier ejection 정책이 서비스마다 달라짐
- 같은 장애를 만나도 Java, Go, Node 클라이언트의 행동이 달라짐
- discovery 라이브러리 버전 차이로 stale endpoint 처리 방식이 갈림
- 관측 포인트가 분산돼서 운영자가 공통 룰을 적용하기 어려움

그래서 client-side discovery는 보통 아래 조건을 만족할 때만 권장할 만합니다.

- 주요 서비스가 1~2개 언어로 제한돼 있다.
- 플랫폼 팀이 공통 SDK를 실제로 유지보수할 수 있다.
- 지연 예산이 매우 빡빡해서 프록시 홉 1개도 아쉬운 구간이다.
- 서비스별 라우팅 로직 차별화가 비즈니스적으로 중요하다.

그 외에는 server-side discovery가 더 안정적입니다. 프록시, API gateway, service mesh를 거치면 홉은 늘지만, health check, retry, circuit breaking, drain 정책을 한 곳에서 고정하기 쉬워집니다. [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)나 [Service Mesh Istio](/learning/deep-dive/deep-dive-service-mesh-istio/)를 실제로 운영해 보면, 성능 최적화보다 **정책 일관성**이 더 큰 이득일 때가 많습니다.

### 4) health-aware routing에서 가장 흔한 실수는 liveness와 readiness를 섞는 것이다

실무 장애의 절반 이상은 "죽은 인스턴스"보다 "살아는 있지만 아직 받을 준비가 안 된 인스턴스" 때문에 납니다. 그래서 health check는 최소한 세 층으로 나눠 생각해야 합니다.

1. **liveness**: 프로세스가 죽었는가, hang 상태인가
2. **readiness**: 지금 신규 요청을 받아도 되는가
3. **passive health**: 실제 요청 실패율과 지연이 나빠졌는가

liveness를 readiness처럼 쓰면 워밍업 중 인스턴스가 너무 빨리 트래픽을 받습니다. 반대로 readiness에 외부 의존성을 과하게 넣으면 DB가 잠깐 느려졌다고 healthy 인스턴스가 한꺼번에 빠지는 문제도 생깁니다.

권장 기본값은 아래 정도입니다.

- readiness probe 주기: **5초**
- unhealthy threshold: **2~3회 연속 실패**
- success threshold: **2회 연속 성공**
- startup grace period: **15~60초**, 실제 warm-up 시간에 맞춤
- connection draining: **30~90초**, longest in-flight request보다 길게

여기서 핵심은 헬스체크가 빠르기만 하면 되는 것이 아니라, **flap을 만들지 않으면서도 stale endpoint 체류 시간을 줄여야 한다**는 점입니다. [Load Balancer Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)를 보면 active check만으로는 놓치는 경우가 많고, 실제 요청 실패를 반영하는 passive signal이 같이 있어야 outlier ejection 품질이 좋아집니다.

### 5) stale endpoint보다 더 위험한 것은 drain되지 않는 연결이다

많은 팀이 endpoint 제거만 신경 쓰고 기존 연결을 잊습니다. 그런데 실제 사고는 이미 붙어 있던 keep-alive connection이 drain 중인 인스턴스로 계속 가면서 생깁니다. registry에서 unhealthy로 빠졌더라도 아래가 남아 있으면 사용자 입장에서는 계속 실패가 납니다.

- 장수 커넥션 풀에 남은 오래된 upstream 연결
- HTTP/2 멀티플렉싱으로 유지되는 기존 세션
- 클라이언트 DNS cache 또는 JVM DNS cache
- 애플리케이션 레벨의 자체 endpoint memoization

그래서 health-aware routing은 등록/해제만이 아니라 **draining, max connection age, idle timeout, connection pool refresh**를 같이 다뤄야 완성됩니다. 예를 들어 rolling update 중 60초 drain을 걸어도 클라이언트 커넥션 최대 수명이 10분이면 의도한 효과가 안 나옵니다.

실무에서는 아래 기준을 많이 씁니다.

- connection max age: **2~5분**
- idle timeout: **30~120초**
- deploy preStop + drain: **30초 이상**
- outlier ejection: 최근 **30초** 창에서 5xx 또는 timeout 비율 기준 적용

이 값은 서비스마다 달라지지만, 공통 원칙은 같습니다. **endpoint 생명주기와 connection 생명주기를 분리해서 보면 안 됩니다.**

### 6) zone aware routing과 outlier ejection이 없으면 부분 장애가 전체 장애처럼 번진다

서비스 discovery가 잘 돼도 라우팅 정책이 단순 라운드로빈이면, 특정 가용영역이나 특정 노드풀의 문제가 전체로 번질 수 있습니다. 특히 cross-zone 비용을 줄이려 local zone 우선 라우팅을 쓰는 환경에서는, 한 zone 안의 이상 노드를 빨리 잘라내는 장치가 더 중요합니다.

권장 순서는 보통 이렇습니다.

- 1차: 같은 zone 우선 라우팅
- 2차: passive failure rate 기반 outlier ejection
- 3차: concurrency limit과 circuit breaker로 전파 차단
- 4차: zone 전체가 나쁘면 cross-zone failover 허용

이 순서가 중요한 이유는, discovery만으로는 "어디가 살아 있는가"까지만 알 수 있고 "지금 어디가 덜 나쁜가"는 못 알기 때문입니다. 부분 장애가 생기면 정적 discovery보다 동적 routing signal이 더 중요해집니다. 이 판단은 [Circuit Breaker와 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)나 [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과도 연결됩니다.

## 실무 적용

### 1) 환경별 권장 기본 아키텍처

**작은 팀, Kubernetes 내부 서비스 중심**
- Service DNS + readiness probe + preStop drain을 기본값으로 둡니다.
- 애플리케이션에서 discovery 라이브러리를 직접 붙이기보다 플랫폼 기본을 믿는 편이 운영 비용이 낮습니다.
- 이 단계에서는 복잡한 mesh보다 health check 품질과 timeout 정리가 먼저입니다.

**VM/ECS 혼합, scale event가 잦은 환경**
- registry 기반 endpoint 갱신과 공용 L7 프록시를 우선 검토합니다.
- 각 서비스에 client-side discovery를 흩뿌리기보다, 공통 프록시에서 retry/outlier 정책을 고정하는 편이 장애 대응이 쉽습니다.

**polyglot, 보안 정책 강함, 서비스 수 100개 이상**
- mesh 또는 sidecar 기반으로 health-aware routing을 중앙 정책화하는 편이 낫습니다.
- 이때도 모든 기능을 한 번에 켜지 말고, mTLS, retry, outlier ejection, zone routing 순으로 단계적으로 여는 것이 안전합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

실무 우선순위는 보통 **잘못된 endpoint 제거 속도 > drain 일관성 > 라우팅 정책 표준화 > 홉 최적화** 순으로 잡는 편이 사고를 줄입니다.

권장 시작 기준은 아래 정도입니다.

1. **신선도 기준**
   - autoscale 또는 배포로 endpoint가 **10분 내 20% 이상** 자주 바뀌면 DNS only 구조를 재검토
   - 잘못된 endpoint 체류 시간이 **15초 초과**하면 registry watch 또는 더 짧은 readiness/deregistration 경로 검토
2. **헬스체크 기준**
   - 신규 인스턴스 warm-up이 **20초 이상** 걸리면 readiness와 startup probe 분리
   - false positive로 healthy 인스턴스가 한 번에 **5% 이상** 빠지면 probe 조건 단순화 또는 threshold 상향
3. **라우팅 기준**
   - 한 zone 장애 시 전체 에러율이 **2배 이상** 튀면 zone aware routing 우선 적용
   - partial failure 구간에서 retry amplification ratio가 **1.3 이상**이면 retry보다 outlier ejection 먼저 손봄
4. **운영 기준**
   - 서비스별 discovery 라이브러리 종류가 **3개 이상**이면 중앙 프록시 또는 공통 SDK 표준화 검토
   - 배포 중 stale connection 관련 에러가 주간 **2회 이상** 나오면 drain, pool refresh, max age를 같은 변경 세트로 묶어 개선

### 3) 장애 대응 런북

운영에서 discovery 사고가 났을 때는 아래 순서가 효율적입니다.

**1단계, 정보 신선도 확인**  
registry, DNS, EndpointSlice, 프록시 upstream view가 서로 같은지 비교합니다. 여기서 서로 다르면 stale 정보 문제일 가능성이 큽니다.

**2단계, readiness와 실제 실패 지표 비교**  
healthy로 보이는데 timeout/5xx가 높다면 readiness가 너무 낙관적이거나 passive health가 빠져 있을 수 있습니다.

**3단계, drain 경로 확인**  
배포 직후만 에러가 늘었다면 preStop, connection draining, keep-alive max age를 먼저 봅니다.

**4단계, retry 증폭 차단**  
부분 장애에서 재시도는 쉽게 전체 장애를 만듭니다. retry budget과 timeout을 임시로 줄여 증폭을 먼저 꺼야 합니다.

이 순서를 지키면 원인 파악이 빨라집니다. discovery 사고는 대부분 "도구 하나가 나빠서"가 아니라 **상태 반영 경로가 여러 계층에서 어긋난 결과**이기 때문입니다.

## 트레이드오프/주의점

1) **TTL을 너무 짧게 잡으면 DNS, registry, control plane 부하가 올라갑니다.**  
신선도는 좋아지지만 전체 시스템이 더 자주 흔들릴 수 있습니다.

2) **client-side discovery는 빠르지만 표준화 실패 시 팀별 동작 차이가 커집니다.**  
처음에는 간단해 보여도, 시간이 지나면 운영자가 가장 싫어하는 구조가 되기 쉽습니다.

3) **health check를 너무 공격적으로 잡으면 flap이 생깁니다.**  
짧은 순간의 GC, 네트워크 스파이크, cold start 때문에 healthy 인스턴스가 쓸데없이 빠질 수 있습니다.

4) **mesh를 넣는다고 discovery 문제가 자동으로 해결되지는 않습니다.**  
readiness, drain, timeout, retry budget이 나쁘면 mesh는 복잡도만 더할 수도 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] liveness, readiness, passive health signal이 분리되어 있다.
- [ ] endpoint 해제와 connection draining이 같은 배포 절차에 묶여 있다.
- [ ] zone aware routing 또는 equivalent fallback 정책이 있다.
- [ ] retry 정책보다 outlier ejection과 timeout 기준이 먼저 정리돼 있다.
- [ ] stale endpoint 체류 시간과 drain 실패율을 숫자로 본다.

### 연습 과제

1. 현재 서비스 하나를 골라 endpoint 변경이 실제 클라이언트 라우팅에 반영되기까지 몇 초 걸리는지 측정해 보세요. 15초를 넘는다면 어느 계층이 병목인지 바로 보일 가능성이 큽니다.  
2. rolling update 중 에러가 나는 서비스가 있다면 preStop, readiness success threshold, connection max age를 한 화면에 정리해 보세요. 보통 세 값이 따로 놀고 있습니다.  
3. client-side discovery를 쓰는 서비스 2개와 server-side proxy를 쓰는 서비스 2개를 비교해, 재시도/타임아웃/헬스체크 정책 차이가 얼마나 나는지 표로 적어 보세요. 차이가 크면 다음 장애 때 대응 속도도 달라집니다.

## 관련 글

- [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)
- [Load Balancer Health Check](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)
- [DNS Internals](/learning/deep-dive/deep-dive-dns-internals/)
- [Service Mesh Istio](/learning/deep-dive/deep-dive-service-mesh-istio/)
- [Priority Load Shedding과 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
