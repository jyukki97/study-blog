---
title: "백엔드 커리큘럼 심화: Session Affinity와 Stateful Routing 운영 플레이북"
date: 2026-05-10
draft: false
topic: "Load Balancing"
tags: ["Session Affinity", "Sticky Session", "Load Balancing", "Redis Session", "JWT", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "스티키 세션, 서버 메모리 세션, Redis 세션 저장소, JWT 기반 stateless 인증을 운영 기준으로 비교하고 장애·배포·확장 관점의 선택 기준을 정리합니다."
module: "backend-traffic-management"
study_order: 1200
---

트래픽이 적을 때는 로그인 세션을 서버 메모리에 올려도 큰 문제가 없어 보입니다. 사용자는 같은 서버로 들어오고, 세션 조회는 빠르고, 구현도 단순합니다. 하지만 서버가 2대, 10대, 여러 리전으로 늘어나는 순간 질문이 달라집니다. "어느 서버가 사용자의 상태를 갖고 있는가", "배포 중에 그 상태를 어떻게 옮길 것인가", "로드밸런서가 다른 서버로 보냈을 때 사용자는 로그아웃되는가"가 운영 이슈가 됩니다.

Session affinity, 흔히 sticky session이라고 부르는 방식은 이 문제를 로드밸런서에서 완화합니다. 같은 사용자를 가능한 한 같은 백엔드 인스턴스로 보내는 방식입니다. 하지만 sticky session은 확장 문제를 해결하는 만능 패턴이 아닙니다. 오히려 잘못 쓰면 특정 인스턴스 쏠림, 장애 시 대량 로그아웃, 배포 drain 실패, 캐시 일관성 문제를 숨깁니다. 이 글은 [Load Balancer Healthcheck](/learning/deep-dive/deep-dive-load-balancer-healthchecks/), [JWT 인증](/learning/deep-dive/deep-dive-jwt-auth/), [Redis Caching](/learning/deep-dive/deep-dive-redis-caching/), [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/)과 연결해 세션 상태를 어디에 둘지 판단하는 기준을 정리합니다.

## 이 글에서 얻는 것

- sticky session이 필요한 상황과 피해야 하는 상황을 구분할 수 있습니다.
- 서버 메모리 세션, Redis 세션 저장소, JWT/stateless 토큰의 운영 비용을 비교할 수 있습니다.
- 배포, 장애, 오토스케일링, WebSocket 같은 장기 연결에서 세션 상태를 안전하게 다루는 기준을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Sticky session은 상태 저장소가 아니라 라우팅 힌트다

Sticky session은 보통 쿠키, source IP hash, load balancer cookie, consistent hash 같은 방식으로 구현됩니다. 핵심은 사용자의 요청을 동일한 backend instance로 보내 확률을 높이는 것입니다. 여기서 중요한 표현은 "보장"이 아니라 "확률"입니다. 인스턴스가 재시작되거나, healthcheck에서 빠지거나, 오토스케일링으로 대상 그룹이 바뀌면 같은 사용자는 다른 서버로 갈 수 있습니다.

그래서 sticky session을 상태 저장소처럼 믿으면 위험합니다. 로드밸런서는 세션 데이터를 보관하지 않습니다. 단지 라우팅 결정을 돕습니다. 서버 메모리에만 로그인 상태, 장바구니, CSRF token, wizard 진행 상태를 두면 인스턴스 장애가 곧 사용자 상태 손실로 이어집니다. 특히 rolling deployment나 node drain 중에는 sticky 설정이 있어도 기존 연결이 끊기고 새 서버로 재접속할 수 있습니다.

실무 기준은 간단합니다. **사용자가 잃으면 안 되는 상태는 인스턴스 메모리에만 두지 않습니다.** 잃어도 되는 per-request cache, 짧은 렌더링 보조 상태, 1~5분짜리 임시 계산 결과는 메모리에 둘 수 있습니다. 하지만 로그인 세션, 결제 단계, 파일 업로드 진행 상태, 장바구니, 권한 변경처럼 제품 신뢰에 영향을 주는 값은 외부 저장소나 재생 가능한 이벤트로 옮겨야 합니다.

### 2) 서버 메모리 세션은 빠르지만 배포와 장애에 약하다

서버 메모리 세션의 장점은 명확합니다. 네트워크 왕복이 없고 구현이 쉽습니다. p95 latency가 1~3ms라도 아까운 고빈도 경로에서는 매력적입니다. 문제는 운영입니다. 서버 수가 늘수록 사용자가 특정 인스턴스에 묶이고, 인스턴스 하나가 죽으면 그 서버에 붙어 있던 세션이 사라집니다. 배포할 때도 drain 시간을 길게 잡아야 하고, blue/green 전환에서 이전 풀의 메모리 상태를 새 풀로 옮기기 어렵습니다.

초기 서비스라면 메모리 세션이 나쁜 선택은 아닙니다. 단, 아래 조건을 모두 만족할 때만 안전합니다.

- 서버 인스턴스가 **1~2대**이고 수평 확장 계획이 아직 없다.
- 세션 손실 시 사용자가 다시 로그인해도 되는 업무다.
- rolling deployment 중 세션 손실률을 **1% 미만**으로 허용할 수 있다.
- 배포 빈도가 낮고, 장기 연결이나 결제 플로우가 없다.

이 조건을 벗어나면 sticky session으로 버티기보다 상태 저장소 분리가 먼저입니다. 특히 배포가 하루 여러 번 일어나거나 오토스케일링이 켜져 있다면, 메모리 세션은 기술 부채가 됩니다.

### 3) Redis 세션 저장소는 확장성을 주지만 새로운 병목을 만든다

가장 흔한 전환은 Redis 같은 외부 저장소에 세션을 두는 것입니다. 이렇게 하면 어떤 서버로 요청이 들어와도 세션을 조회할 수 있고, 배포 중 인스턴스가 바뀌어도 사용자는 유지됩니다. sticky session 의존도도 줄어듭니다.

하지만 Redis 세션은 공짜가 아닙니다. 모든 요청에서 세션을 읽고 쓰면 Redis가 인증 경로의 단일 병목이 됩니다. Redis 장애가 곧 로그인 장애가 될 수 있고, TTL 설정이 잘못되면 오래된 세션이 남거나 정상 세션이 너무 빨리 만료됩니다. 또한 세션 객체를 크게 만들면 네트워크 비용과 serialization 비용이 커집니다.

운영 기준은 아래처럼 잡을 수 있습니다.

| 항목 | 권장 기준 | 이유 |
| --- | --- | --- |
| 세션 payload 크기 | **1~4KB 이하** | 큰 객체는 every-request 비용이 된다 |
| TTL | 업무 기준 + idle timeout 분리 | 보안과 UX 균형 |
| Redis p95 latency | **5ms 이하**, p99 **20ms 이하** 목표 | 인증 경로 지연 전파 방지 |
| 세션 저장소 오류율 | **0.1% 초과 시 degrade 정책** | 로그인 장애 조기 감지 |
| 중요 변경 | session version 증가 또는 강제 재검증 | 권한 변경 전파 |

Redis를 쓸 때도 [Cache Consistency와 Invalidation](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/) 문제가 생깁니다. 권한이 바뀌었는데 세션에 예전 role이 남아 있으면 보안 사고가 됩니다. 따라서 세션에는 자주 바뀌는 권한 전체를 넣기보다 user id, session id, role version, auth time 같은 최소 정보를 두고, 민감한 권한은 짧은 TTL 또는 별도 재조회 기준을 둡니다.

### 4) JWT/stateless 인증은 서버 상태를 줄이지만 폐기와 권한 변경이 어렵다

JWT는 서버가 세션 저장소를 조회하지 않아도 토큰 자체로 인증 정보를 검증할 수 있게 합니다. 수평 확장에는 유리합니다. CDN, API gateway, 여러 서비스가 같은 token signature를 검증할 수도 있습니다. 하지만 "stateless"라는 말 때문에 운영 문제가 사라지는 것은 아닙니다.

가장 큰 약점은 폐기입니다. 토큰이 1시간 유효하고 탈취되면, 서버는 그 토큰을 기본적으로 만료 전까지 유효하다고 봅니다. 사용자 권한이 바뀌어도 토큰에 들어간 claim은 그대로입니다. 이를 보완하려면 access token을 짧게, refresh token은 저장소에서 관리하거나, token version을 두고 서버가 중요한 요청에서 재검증해야 합니다. 결국 완전한 stateless는 드뭅니다. 보통은 **짧은 access token + 상태 있는 refresh token + 민감 요청 재검증**의 조합이 현실적입니다.

추천 기본값은 다음과 같습니다.

- access token 만료: 일반 서비스 **5~15분**, 내부 admin **3~10분**
- refresh token 만료: **7~30일**, rotation과 reuse detection 적용
- 권한 claim: 큰 role 목록보다 `role_version`, `tenant_id`, `scope` 최소화
- 강제 로그아웃 필요 서비스: revocation list 또는 session store 유지
- 결제·개인정보 변경: 토큰만 믿지 말고 최근 인증 시각과 서버 상태 재검증

JWT는 [OAuth2/OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/)와 잘 맞지만, 모든 상태를 토큰에 넣는 순간 토큰은 움직이는 사용자 DB가 됩니다. 토큰 크기가 커지면 header size, proxy limit, 모바일 네트워크 비용도 증가합니다.

## 실무 적용

### 1) 상태를 세 등급으로 나눈다

세션 설계의 첫 단계는 "어디에 저장할까"가 아니라 "잃어도 되는가"입니다.

- **S0: 잃으면 안 되는 상태** — 결제 진행, 장바구니, 권한, 파일 업로드 메타데이터, 주문 생성 단계. DB, Redis, durable queue, object storage 같은 외부 저장소에 둡니다.
- **S1: 짧게 잃어도 복구 가능한 상태** — UI wizard의 현재 step, 검색 필터, 임시 추천 후보. Redis나 signed cookie에 둘 수 있습니다.
- **S2: 잃어도 되는 상태** — per-instance cache, template fragment, throttling 보조값. 서버 메모리에 둬도 됩니다.

S0가 서버 메모리에 있다면 sticky session은 임시 방편일 뿐입니다. S1은 TTL과 사용자 재시도 UX가 중요하고, S2는 배포 중 사라져도 문제가 없어야 합니다.

### 2) 로드밸런서 설정은 배포 전략과 같이 본다

Sticky session을 켤 때는 idle timeout, deregistration delay, healthcheck interval, connection draining을 같이 봐야 합니다. 예를 들어 ALB 뒤의 서버가 graceful shutdown 없이 바로 종료되면 sticky session은 아무 의미가 없습니다. 사용자는 같은 서버로 가고 싶어도 그 서버가 이미 죽었기 때문입니다.

기본 운영값은 아래처럼 시작할 수 있습니다.

- healthcheck interval: **5~15초**
- unhealthy threshold: **2~3회**
- deregistration delay/drain timeout: 일반 HTTP **30~120초**, WebSocket/SSE는 업무에 맞춰 별도
- app shutdown grace period: drain timeout보다 길거나 같게 설정
- 배포 중 신규 요청 차단 후 in-flight 요청 완료율 **99% 이상** 확인

이 기준은 [Drain-aware 배포](/learning/deep-dive/deep-dive-drain-aware-deployment-playbook/)와 같습니다. 세션이든 연결이든, 상태가 있는 요청은 끊기기 전에 빠져나갈 시간이 필요합니다.

### 3) WebSocket/SSE는 인증 세션과 연결 세션을 분리한다

WebSocket이나 SSE는 sticky session 논의가 더 민감합니다. 연결이 오래 유지되기 때문에 한 인스턴스에 사용자가 오래 붙습니다. 이때 연결 자체의 위치와 사용자의 인증 상태를 혼동하면 장애가 커집니다. 연결은 특정 node에 붙어 있을 수 있지만, 인증과 구독 권한은 외부 저장소나 토큰 기준으로 재검증할 수 있어야 합니다.

예를 들어 채팅 서버에서는 connection registry를 Redis나 coordination store에 두고, user id와 connection id, node id, last heartbeat를 기록합니다. 메시지 발행은 node-local 메모리만 믿지 말고 pub/sub, stream, broker를 통해 라우팅합니다. 연결이 끊기면 클라이언트가 재접속하고, 서버는 마지막 ack나 cursor를 기준으로 누락 메시지를 보정합니다. [WebSocket/SSE 패턴](/learning/deep-dive/deep-dive-websocket-sse-patterns/)을 쓸 때도 sticky는 성능 최적화일 뿐, 전달 보장의 핵심이 되어서는 안 됩니다.

## 트레이드오프/주의점

첫째, sticky session은 단순하지만 불균형을 만들 수 있습니다. 일부 사용자가 무거운 요청을 반복하면 특정 인스턴스만 뜨거워집니다. source IP hash는 NAT 뒤의 대량 사용자를 한 서버로 몰 수 있고, cookie 기반 sticky는 쿠키 삭제나 도메인 변경에 취약합니다.

둘째, Redis 세션은 상태를 중앙화해 확장성을 높이지만, Redis 장애 도메인을 인증 경로로 끌어옵니다. Redis cluster, replica, timeout, fallback 정책 없이 붙이면 서버 메모리 세션보다 더 큰 장애를 만들 수 있습니다. 인증 경로의 Redis timeout은 보통 **50~200ms** 안에서 짧게 실패시키고, 재시도는 1회 이하로 제한하는 편이 낫습니다.

셋째, JWT는 조회 비용을 줄이지만 폐기 비용을 뒤로 미룹니다. 보안 요구가 강한 서비스에서 긴 만료의 JWT만 쓰는 것은 위험합니다. 반대로 모든 요청마다 revocation check를 하면 stateless 장점이 줄어듭니다. 이 균형을 인정하고 민감도별로 다르게 설계해야 합니다.

의사결정 우선순위는 **사용자 상태 보존 > 보안상 폐기 가능성 > 배포/장애 복원력 > 지연 시간 > 구현 단순성**입니다. 단기 구현이 빠르다는 이유로 세션을 인스턴스에 묶으면, 나중에 배포와 장애 대응이 느려집니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 로그인 세션, 장바구니, 결제 단계처럼 잃으면 안 되는 상태가 서버 메모리에만 있지 않다.
- [ ] sticky session은 성능/호환성 힌트로만 쓰고, 장애 복구의 핵심 보장으로 보지 않는다.
- [ ] Redis 세션 payload 크기, TTL, p95/p99 latency, 오류율 알람이 있다.
- [ ] 권한 변경·강제 로그아웃·토큰 탈취 대응을 위한 revocation 또는 version 전략이 있다.
- [ ] rolling deployment에서 drain timeout과 app shutdown grace period가 맞다.
- [ ] WebSocket/SSE 연결 위치와 인증/권한 상태를 분리해 관리한다.
- [ ] 세션 저장소 장애 시 로그인, 기존 요청, 민감 요청의 degrade 정책이 문서화되어 있다.

### 연습

1. 현재 서비스의 사용자 상태를 S0/S1/S2로 나눠 보세요. S0가 인스턴스 메모리에 있다면 외부 저장소나 이벤트 기반 복구 경로를 설계해야 합니다.  
2. 로드밸런서의 sticky 설정, drain timeout, healthcheck interval을 확인하고 배포 중 세션 손실이 발생할 수 있는 구간을 표시해 보세요.  
3. JWT를 쓰는 서비스라면 access token 만료, refresh token rotation, 강제 로그아웃 경로를 표로 정리해 보세요. "탈취된 토큰을 5분 안에 무력화할 수 있는가"가 첫 질문입니다.

## 관련 글

- [Load Balancer Healthcheck](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)
- [JWT 인증](/learning/deep-dive/deep-dive-jwt-auth/)
- [Redis Caching](/learning/deep-dive/deep-dive-redis-caching/)
- [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/)
- [Drain-aware 배포](/learning/deep-dive/deep-dive-drain-aware-deployment-playbook/)
