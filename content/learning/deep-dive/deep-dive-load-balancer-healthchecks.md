---
title: "로드밸런서/헬스체크 설계"
date: 2025-12-16
draft: false
topic: "Networking"
tags: ["Load Balancer", "Health Check", "ALB", "NLB"]
categories: ["DevOps"]
description: "ALB/NLB 헬스체크, 타임아웃/리트라이 설정, 고가용성을 위한 설계 포인트"
module: "ops-observability"
study_order: 375
---

## 이 글에서 얻는 것

- 로드밸런서(L4/L7)를 무엇 기준으로 고르는지(ALB/NLB, 프로토콜/기능/운영) 설명할 수 있습니다.
- 헬스체크가 “살아있다”가 아니라 **“트래픽을 보내도 된다”를 결정하는 스위치**임을 이해합니다.
- readiness/liveness 감각으로 헬스 엔드포인트를 설계하고, 배포 중 드레이닝/롤아웃과 연결할 수 있습니다.
- 자주 터지는 설정 실수(401, 무거운 체크, flapping, 타임아웃 불일치)를 예방/디버깅할 수 있습니다.

## 0) 헬스체크는 ‘고가용성의 핵심 파라미터’다

헬스체크가 잘못되면 “정상 인스턴스를 비정상으로 판단”하거나, 반대로 “깨진 인스턴스에 트래픽을 계속 보냅니다”.

- 너무 엄격함 → false negative → 타깃이 전부 빠져 서비스 장애
- 너무 느슨함 → 깨진 타깃이 남아 5xx/타임아웃 증가

그래서 헬스체크는 단순 설정이 아니라, 안정성 설계의 일부입니다.

## 1) ALB vs NLB: L7 vs L4 선택 감각

- **ALB(L7)**: HTTP/HTTPS, Host/Path 라우팅, 헤더 기반 라우팅, WAF 연동, HTTP/2(gRPC) 같은 기능이 강점
- **NLB(L4)**: TCP/UDP/TLS, 고성능/낮은 지연, 정적 IP, 소스 IP 보존 등 네트워크 계층 특징이 강점

실무 기준으로는:

- “HTTP API/웹”이면 ALB가 운영하기 쉽고 기능이 풍부합니다.
- “TCP 기반 프로토콜/고성능/정적 IP 필요”면 NLB가 더 자연스럽습니다.

## 2) 헬스 엔드포인트 설계: liveness vs readiness

헬스체크는 보통 두 층으로 나누면 안전합니다.

- **Liveness(생존)**: 프로세스가 “붙어 있고” 멈추지 않았는가(재시작 판단)
- **Readiness(준비)**: 지금 이 인스턴스에 트래픽을 보내도 되는가(LB가 타깃 포함/제외 판단)

헬스 엔드포인트 원칙(운영형):

- 매우 가볍고 빠르다(수 ms~수십 ms 목표)
- 인증이 필요 없다(대신 네트워크로 보호: LB SG/내부망에서만 접근)
- 의존성(DB/외부 API)까지 다 묶지 않는다(“깊은” 체크는 별도로 운영)

Spring Boot 예시(개념):

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health,info
```

이후 `/actuator/health/readiness`, `/actuator/health/liveness`를 적절히 사용합니다.

## 3) 파라미터 튜닝: flapping을 줄이는 감각

헬스체크는 “한 번 실패”로 바로 제외되면 불안정해지기 쉽습니다.
그래서 보통 아래 값을 함께 조정합니다.

- interval: 체크 주기(예: 10~30s)
- timeout: 응답 대기(예: 2~5s)
- unhealthy threshold: 몇 번 실패하면 제외할지(예: 2~5회)
- healthy threshold: 몇 번 성공하면 복귀할지(예: 2~5회)

목표는:

- 짧은 순간의 스파이크/GC/네트워크 흔들림으로 타깃이 빠지지 않게,
- 하지만 진짜로 죽었을 때는 빨리 제외되게

균형을 잡는 것입니다.

## 4) 배포/종료와 연결하기: 드레이닝(연결 빼기)

헬스체크는 배포와 강하게 연결됩니다.

- 새 버전이 올라온 직후: 준비가 되기 전까지 readiness를 실패시키면 트래픽을 받지 않습니다.
- 종료 직전: readiness를 먼저 실패시키고(타깃 제외), 기존 연결을 일정 시간 드레인한 뒤 종료하면 5xx를 줄일 수 있습니다.

Spring Boot(개념):

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

## 5) 자주 터지는 실수(운영 디버깅 포인트)

- 헬스체크 경로에 인증이 걸려 401/403이 나서 전부 비정상 처리
- 헬스체크가 DB/외부 API에 강하게 의존해 “의존성 장애 → 서비스 타깃 전부 제외”로 확대
- 타임아웃/스레드풀 포화로 체크 응답이 늦어져 flapping 발생(특히 피크 시간대)
- LB idle timeout과 애플리케이션 keep-alive/timeout 정책 불일치로 502/504 증가
- NLB TCP 체크는 “포트가 열림”만 확인해 HTTP 레벨 오류를 놓치는 경우(필요하면 HTTP 체크/애플리케이션 레벨 검증을 병행)

## 연습(추천)

- readiness/liveness를 분리한 엔드포인트를 만들고, “DB가 잠깐 느려진 상황”에서 어떤 체크가 실패해야 안정적인지 실험해보기
- unhealthy threshold를 1→3으로 바꾸며 flapping이 어떻게 줄어드는지 관찰해보기
- 배포 시 “종료 직전 readiness 실패 → 드레인 → 종료” 흐름을 구현해, 배포 중 5xx가 줄어드는지 비교해보기
