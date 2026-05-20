---
title: "백엔드 커리큘럼 심화: Drain-aware 배포 플레이북"
date: 2026-05-06
draft: false
topic: "Operations"
tags: ["Deployment", "Connection Draining", "Graceful Shutdown", "Readiness", "Zero Downtime"]
categories: ["Backend Deep Dive"]
description: "무중단 배포에서 SIGTERM 처리만으로 부족한 이유를 짚고, 로드밸런서·readiness·커넥션 풀·큐 컨슈머를 함께 drain하는 실무 기준을 정리합니다."
module: "backend-ops-observability"
study_order: 1190
---

무중단 배포를 이야기할 때 가장 많이 나오는 단어는 graceful shutdown입니다. 애플리케이션이 `SIGTERM`을 받으면 새 요청을 받지 않고, 처리 중인 요청을 끝낸 뒤 종료한다는 원칙입니다. 방향은 맞지만, 실무에서는 이것만으로 충분하지 않습니다. 실제 트래픽은 로드밸런서, 서비스 디스커버리, 커넥션 풀, 큐 컨슈머, 배치 워커, 캐시 워밍 상태를 함께 지나가기 때문입니다. 한 레이어만 정상 종료해도 다른 레이어가 아직 이전 인스턴스를 살아 있다고 믿으면 배포 순간에 502, 타임아웃, 중복 처리, 커넥션 리셋이 섞여 나옵니다.

그래서 운영 기준은 단순한 graceful shutdown보다 한 단계 넓은 **drain-aware deployment**가 되어야 합니다. drain-aware란 "프로세스를 예쁘게 죽인다"가 아니라, **트래픽과 작업이 안전하게 빠져나가는 순서까지 배포 프로토콜에 포함한다**는 뜻입니다. 이 글은 [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/), [로드밸런서 헬스체크](/learning/deep-dive/deep-dive-load-balancer-healthchecks/), [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)을 운영 단위로 묶어, 배포 때 실제로 어떤 숫자와 조건을 봐야 하는지 정리합니다.

## 이 글에서 얻는 것

- 무중단 배포 실패가 왜 애플리케이션 종료 코드만의 문제가 아닌지 이해할 수 있습니다.
- readiness, load balancer deregistration, keep-alive, 큐 컨슈머 ack를 어떤 순서로 drain해야 하는지 기준을 잡을 수 있습니다.
- 배포 중 5xx와 타임아웃을 줄이기 위해 팀 런북에 넣을 수 있는 숫자 기준과 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Graceful shutdown과 draining은 범위가 다르다

Graceful shutdown은 보통 프로세스 내부 관점입니다. `SIGTERM`을 받고, 서버 소켓을 닫고, 처리 중인 요청을 기다리고, 일정 시간이 지나면 강제 종료합니다. 반면 draining은 시스템 외부까지 포함합니다.

- 로드밸런서가 해당 인스턴스로 새 요청을 보내지 않는가
- 서비스 디스커버리나 DNS 캐시가 이전 엔드포인트를 계속 들고 있지 않은가
- HTTP keep-alive 연결이 오래 살아 새 요청을 계속 보내지 않는가
- 큐 컨슈머가 visibility timeout 안에 ack/nack를 안전하게 끝내는가
- DB 커넥션 풀과 외부 API 호출이 타임아웃 예산 안에서 닫히는가

즉 graceful shutdown은 draining의 한 부분입니다. 팀이 "우리 shutdown hook 넣었으니 무중단"이라고 말한다면 절반만 확인한 것입니다.

### 2) readiness를 먼저 내리고, 종료는 나중에 해야 한다

배포 중 가장 흔한 실수는 종료 신호와 트래픽 차단을 동시에 처리하는 것입니다. 안전한 순서는 보통 아래가 맞습니다.

1. readiness를 false로 전환한다.
2. 로드밸런서와 서비스 디스커버리가 해당 인스턴스를 제외할 시간을 준다.
3. 새 요청 수가 0에 가까워졌는지 확인한다.
4. 처리 중 요청과 작업을 마저 끝낸다.
5. 종료 유예시간 안에 프로세스를 닫는다.

숫자 기준은 서비스마다 다르지만, 시작점은 이렇게 잡을 수 있습니다.

- readiness false 후 최소 대기: **10~30초**
- LB deregistration delay: API 서버는 **30~120초**, 긴 요청이 있으면 더 길게
- 종료 유예시간: `p99_request_latency * 2 + 외부 호출 timeout` 이상
- 강제 종료 전 inflight request 목표: **0**, 예외적으로 전체 동시 처리의 **1% 이하**

Kubernetes라면 `preStop`에서 잠깐 sleep만 넣는 방식이 자주 쓰이지만, sleep은 근본 해결이 아닙니다. readiness 전환, 실제 라우팅 제외, inflight 감소 지표가 같이 있어야 합니다. 헬스체크 설계는 [Load Balancer Healthcheck](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)와 함께 봐야 합니다.

### 3) keep-alive 연결은 배포 중 숨어 있는 새 요청 경로다

로드밸런서가 새 연결을 막아도 기존 HTTP keep-alive 연결이 남아 있으면 이전 인스턴스로 요청이 계속 들어올 수 있습니다. 특히 게이트웨이, 프록시, SDK 클라이언트가 긴 keep-alive를 유지하는 구조에서는 "deregistered인데 요청이 들어온다"는 현상이 생깁니다.

실무 기준은 아래처럼 잡는 편이 안전합니다.

- drain 시작 후 응답 헤더에 `Connection: close` 또는 서버별 graceful close 정책 적용
- keep-alive idle timeout은 LB timeout보다 짧거나 같게 유지
- drain 상태에서는 새 요청을 받더라도 빠르게 503을 내기보다, 가능하면 기존 연결 요청만 제한적으로 처리
- 장기 스트리밍/WebSocket/SSE는 일반 API와 별도 drain 정책 적용

WebSocket이나 SSE는 특히 조심해야 합니다. 일반 API와 같은 30초 유예시간을 적용하면 배포 때마다 연결이 대량으로 끊길 수 있습니다. 이 경우는 [WebSocket/SSE 패턴](/learning/deep-dive/deep-dive-websocket-sse-patterns/)처럼 재연결 프로토콜과 세션 복구 기준을 같이 설계해야 합니다.

### 4) 큐 컨슈머는 HTTP 서버보다 더 엄격한 종료 계약이 필요하다

HTTP 요청은 실패하면 클라이언트가 재시도할 수 있지만, 큐 메시지는 ack 타이밍이 잘못되면 중복 처리나 유실로 이어집니다. 컨슈머 drain은 다음 세 가지를 분리해서 봐야 합니다.

1. 새 메시지 poll 중단
2. 이미 받은 메시지 처리 완료
3. 처리 실패/시간 초과 메시지의 재전달 보장

예를 들어 visibility timeout이 60초인데 shutdown grace period가 20초라면, 처리 중 메시지가 중간에 죽고 재전달까지 애매한 상태가 됩니다. 최소 기준은 `shutdown_grace_period >= message_p99_processing_time + ack_timeout_margin`입니다. 배치성 컨슈머라면 현재 batch를 끝내는 데 걸리는 시간도 포함해야 합니다.

운영 추천값은 아래와 같습니다.

- drain 시작 후 새 poll 즉시 중단
- 처리 중 메시지 완료 대기: `p99_processing_time * 1.5` 이상
- ack 실패 시 로그와 metric 필수
- visibility timeout은 p99 처리시간의 **2~3배**부터 시작
- 중복 허용이 어렵다면 [Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)나 [Queue Visibility Timeout](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/) 기준을 먼저 맞춘다

### 5) drain 실패는 배포 문제가 아니라 용량 문제로 번질 수 있다

배포 중 이전 인스턴스가 빠지는 동안 남은 인스턴스가 트래픽을 감당해야 합니다. 만약 평소 CPU 75%, 커넥션 풀 80%로 운영 중이라면 한 대만 빠져도 포화가 시작될 수 있습니다. 그래서 drain-aware 배포는 capacity planning과 연결됩니다.

롤링 배포 기준 예시:

- 배포 중 제거 가능한 인스턴스 수: 전체의 **10~20% 이하**부터 시작
- remaining capacity 기준 CPU headroom: **30% 이상** 권장
- DB connection pool headroom: **20% 이상**
- 배포 중 p95 latency가 기준 대비 **1.5배** 넘으면 rollout pause
- error rate가 **0.5~1%** 이상이면 자동 중단 또는 이전 버전 유지

이 숫자는 [Capacity Planning](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)과 [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)의 포화도 기준과 같이 운영해야 합니다.

## 실무 적용

### 1) 애플리케이션에 drain 상태를 명시적으로 둔다

단순히 `isShuttingDown=true` 같은 플래그 하나만 두지 말고, 상태를 최소 세 단계로 나누는 편이 좋습니다.

```text
RUNNING -> DRAINING -> TERMINATING
```

- `RUNNING`: readiness true, 새 요청/작업 수락
- `DRAINING`: readiness false, 새 작업 수락 중단, 기존 요청만 처리
- `TERMINATING`: 유예시간 종료 또는 inflight 0, 리소스 close

이 상태를 로그와 메트릭으로 노출해야 합니다. 배포 사고 때 "죽는 중이었는지", "라우팅 제외는 됐는지", "요청이 남아 있었는지"를 5분 안에 확인할 수 있어야 합니다.

### 2) 관측 지표를 배포 런북에 넣는다

drain-aware 배포에서 최소로 봐야 할 지표는 아래입니다.

- `inflight_requests`
- `new_requests_after_drain_started`
- `lb_target_deregistration_latency`
- `http_keepalive_active_connections`
- `queue_inflight_messages`
- `shutdown_forced_count`
- `rollout_pause_count`

특히 `new_requests_after_drain_started`가 0이 아니면 라우팅 경로가 어딘가 남아 있다는 뜻입니다. 이 값이 반복되면 preStop sleep을 늘리기보다 LB, gateway, client keep-alive 설정을 먼저 봐야 합니다.

### 3) 배포 전략별 기준을 다르게 둔다

모든 배포에 같은 drain 시간을 쓰면 느리거나 위험합니다.

- 짧은 API 서버: 30~60초 drain부터 시작
- 외부 API 의존이 많은 서버: 외부 호출 timeout 합산 후 60~120초
- WebSocket/SSE 서버: 연결 재배치 또는 세션 복구 포함, 일반 API와 분리
- 큐 컨슈머: message p99 처리시간과 visibility timeout 기준으로 산정
- 배치 워커: 현재 chunk 완료 단위로 종료

의사결정 우선순위는 **사용자 영향 > 데이터 정합성 > 배포 속도**입니다. 배포가 3분 느려져도 데이터 중복 처리나 502 폭발을 막는 편이 싸게 먹힙니다.

## 트레이드오프/주의점

Drain 시간을 길게 잡으면 안전해 보이지만, 항상 좋은 것은 아닙니다. 긴 drain은 롤아웃 시간을 늘리고, 취약 버전이 오래 살아 있게 만들며, 긴급 롤백 속도를 늦춥니다. 반대로 짧게 잡으면 배포는 빠르지만 요청 중단과 중복 처리가 늘어납니다.

현실적인 기준은 아래처럼 잡습니다.

- 일반 API는 p99 요청 시간의 **2배**를 시작점으로 둔다.
- drain 중 신규 요청이 계속 들어오면 시간을 늘리지 말고 라우팅 제거 경로를 고친다.
- 강제 종료가 하루 1회라도 발생하면 배포 런북 결함으로 보고 원인 분석한다.
- 긴 연결 서비스는 일반 API와 같은 deployment group에 묶지 않는다.
- 재시도 정책이 강한 클라이언트가 많으면 drain 실패가 트래픽 증폭으로 이어질 수 있으므로 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)를 함께 조정한다.

가장 위험한 안티패턴은 "배포 중 잠깐 502는 괜찮다"는 태도입니다. 502가 눈에 보이는 정도면 내부에서는 커넥션 리셋, 중복 재시도, 큐 재전달, 캐시 미스가 이미 같이 흔들리고 있을 가능성이 큽니다.

## 체크리스트 또는 연습

### 배포 전 체크리스트

- [ ] readiness와 liveness가 분리되어 있다.
- [ ] drain 시작 후 readiness false가 즉시 반영된다.
- [ ] LB deregistration delay와 앱 shutdown grace period가 문서화되어 있다.
- [ ] drain 중 새 요청 수와 inflight 요청 수를 메트릭으로 본다.
- [ ] 큐 컨슈머는 새 poll 중단과 처리 중 메시지 완료 대기가 분리되어 있다.
- [ ] 강제 종료 횟수와 종료 원인이 로그로 남는다.
- [ ] 배포 중 p95/p99 latency, error rate 기준으로 rollout pause 조건이 있다.

### 연습

운영 중인 서비스 하나를 골라 아래 값을 실제로 적어보세요.

1. 현재 p99 요청 시간은 몇 ms인가?
2. readiness false 후 실제로 LB에서 제외되기까지 몇 초 걸리는가?
3. drain 시작 후에도 들어오는 요청이 있는가?
4. shutdown grace period는 p99 요청 시간의 몇 배인가?
5. 큐 컨슈머가 있다면 message p99 처리시간과 visibility timeout은 각각 몇 초인가?

이 다섯 개를 답하지 못하면 무중단 배포는 아직 감에 의존하고 있는 상태입니다. 우선은 배포 시간을 줄이기보다, drain 경로를 눈에 보이게 만드는 것부터 시작하는 편이 맞습니다.
