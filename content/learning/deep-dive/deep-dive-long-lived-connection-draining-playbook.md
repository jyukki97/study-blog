---
title: "백엔드 커리큘럼 심화: WebSocket·SSE·gRPC 장기 연결 드레이닝 플레이북"
date: 2026-07-23
draft: false
topic: "Realtime Operations"
tags: ["WebSocket", "SSE", "gRPC", "Connection Draining", "Graceful Shutdown", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "일반 HTTP 요청보다 오래 살아 있는 WebSocket, SSE, gRPC streaming 연결을 배포·장애·스케일다운 중 안전하게 드레이닝하는 실무 기준을 정리합니다."
module: "backend-ops-observability"
study_order: 1258
---

무중단 배포를 설계할 때 일반 HTTP API만 기준으로 잡으면 장기 연결 서비스에서 사고가 납니다. 일반 요청은 보통 수십 ms에서 몇 초 안에 끝나지만, WebSocket, SSE, gRPC streaming은 연결 자체가 사용자 세션이거나 작업 채널입니다. 서버가 `SIGTERM`을 받고 30초 뒤 종료되는 것은 일반 API에는 충분할 수 있지만, 실시간 채팅, 주문 상태 스트림, 협업 편집, 알림 피드, 모델 추론 스트림에는 너무 짧을 수 있습니다.

더 까다로운 점은 장기 연결이 "요청 하나"가 아니라는 사실입니다. 연결 안에는 인증 상태, 구독 목록, 마지막 이벤트 offset, backpressure 상태, heartbeat, 재연결 정책이 들어 있습니다. 그래서 장기 연결 드레이닝은 단순히 프로세스를 예쁘게 종료하는 일이 아니라, **새 연결 차단, 기존 연결 통지, 클라이언트 재연결 분산, 메시지 손실 방지, 남은 인스턴스 용량 확인**을 하나의 절차로 묶는 작업입니다.

이 글은 [Drain-aware 배포 플레이북](/learning/deep-dive/deep-dive-drain-aware-deployment-playbook/), [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/), [WebSocket/SSE 패턴](/learning/deep-dive/deep-dive-websocket-sse-patterns/), [gRPC 서비스 설계](/learning/deep-dive/deep-dive-grpc-service-design/), [로드밸런서 헬스체크](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)와 이어집니다. 핵심은 "연결을 안 끊는 것"이 아니라, **끊겨도 사용자가 예측 가능하게 복구되고 서버가 두 번째 장애를 만들지 않는 것**입니다.

## 이 글에서 얻는 것

- 일반 HTTP drain과 WebSocket/SSE/gRPC streaming drain의 차이를 구분할 수 있습니다.
- 배포, 스케일다운, 장애 격리 중 장기 연결을 어떤 순서로 닫아야 하는지 기준을 잡을 수 있습니다.
- reconnect storm, 메시지 손실, sticky session 의존, backpressure 누락을 숫자로 점검할 수 있습니다.
- 실시간 서비스 런북에 넣을 close code, retry hint, drain timeout, 연결 예산 기준을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 장기 연결은 readiness false 뒤에도 한동안 살아 있다

readiness를 false로 내리면 새 트래픽은 줄어듭니다. 하지만 이미 맺어진 WebSocket이나 SSE 연결은 그대로 남을 수 있습니다. 로드밸런서가 새 연결을 보내지 않는 것과 기존 연결을 끊는 것은 다른 문제입니다. 일반 HTTP keep-alive도 비슷하지만, 장기 연결은 연결 하나가 몇 분에서 몇 시간까지 유지된다는 점에서 훨씬 더 큽니다.

운영 관점에서는 연결을 네 단계로 봐야 합니다.

| 단계 | 의미 | 서버 동작 |
| --- | --- | --- |
| accepting | 새 연결과 기존 연결 모두 허용 | readiness true |
| draining | 새 연결 거부, 기존 연결에는 종료 예정 통지 | readiness false, retry hint 전송 |
| closing | 정해진 시간 뒤 연결 close | close code 또는 stream trailer 전송 |
| terminated | 남은 연결 강제 종료 | grace period 초과 시 kill |

실무 출발값은 이렇게 잡을 수 있습니다. 일반 API 서버의 drain이 30~120초라면, 실시간 연결 서버는 서비스 특성에 따라 **2~10분**의 논리적 drain window를 따로 둡니다. 다만 보안 긴급 패치나 장애 격리에서는 30~60초로 짧게 줄일 수 있어야 합니다. 중요한 것은 시간이 긴가 짧은가가 아니라, drain 이유와 목표 시간이 클라이언트에게 전달되는가입니다.

### 2) 클라이언트 재연결은 성공 경로가 아니라 부하 이벤트다

장기 연결 서비스에서 가장 흔한 장애는 연결이 끊긴 사실 자체보다 **동시에 다시 붙는 현상**입니다. 2만 명이 붙어 있는 인스턴스 10대 중 1대를 배포하면서 2천 연결이 한 번에 끊기면, 클라이언트는 즉시 재연결을 시도합니다. 여기에 모바일 네트워크 재시도, SDK 기본 retry, 브라우저 탭 복원까지 겹치면 새 버전 서버가 뜨자마자 인증 서버, 구독 조회 DB, Redis pub/sub, gateway가 같이 흔들립니다.

그래서 reconnect 정책에는 숫자가 있어야 합니다.

- 첫 재연결 지연: **1~3초 random jitter**
- 이후 backoff: `2s -> 5s -> 10s -> 30s`, 최대 **60초**
- 클라이언트별 최대 동시 연결 시도: 보통 **1개**
- 같은 사용자 다중 탭 연결 제한: 서비스 특성에 따라 **3~5개**
- drain 중 서버가 주는 `retry_after`: 일반 배포 **15~60초**, 장애 격리 **5~15초**
- 재연결 폭주 알람: 신규 연결 시도율이 평시 p95의 **2배** 또는 인증 실패율 **1% 초과**

SSE는 `retry:` 필드를 활용할 수 있고, WebSocket은 close frame reason이나 애플리케이션 메시지로 재연결 힌트를 줄 수 있습니다. gRPC streaming은 status code, trailer metadata, client interceptor 정책으로 같은 의미를 표현합니다. 이 기준은 [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 같이 관리해야 합니다.

### 3) 메시지 유실 여부는 마지막 이벤트 위치로 판단한다

장기 연결을 닫을 때 가장 위험한 말은 "대부분 다시 연결되겠지"입니다. 다시 연결되는 것과 중간 메시지를 복구하는 것은 별개입니다. 채팅, 알림, 주문 상태, 협업 편집처럼 사용자가 놓치면 안 되는 데이터는 연결 재수립 뒤 어디서부터 다시 받아야 하는지 기준이 필요합니다.

권장 방식은 `last_event_id`, `offset`, `sequence`, `version` 중 하나를 명시하는 것입니다.

```text
client_connected:
  user_id: u_123
  channel: order-status:9842
  last_seen_event_id: evt_20260723_000421
  subscribed_at: 2026-07-23T10:06:00+09:00
```

서버는 drain 전에 가능하면 "이 연결은 곧 종료된다. 마지막으로 확인한 이벤트 id는 이것이다"를 보냅니다. 클라이언트는 재연결 시 `last_seen_event_id`를 다시 넘기고, 서버는 보존된 이벤트 로그나 snapshot으로 누락분을 보정합니다. 이때 이벤트 보관 기간은 클라이언트 재연결 SLO보다 길어야 합니다. 예를 들어 모바일 앱의 99%가 10분 안에 재연결한다면 이벤트 replay buffer는 최소 **30분**부터 잡는 편이 안전합니다. 업무상 강한 정합성이 필요하면 24시간 이상 보관하거나 별도 조회 API로 보정해야 합니다.

### 4) sticky session은 drain 실패를 숨길 수 있다

WebSocket 서버는 종종 sticky session을 씁니다. 연결이 맺어진 뒤에는 같은 서버에 붙어 있어야 구현이 단순하기 때문입니다. 하지만 sticky session은 상태 저장소가 아닙니다. 특정 서버가 drain되면 그 서버 메모리에 있던 구독 상태, ephemeral room membership, pending ack가 사라질 수 있습니다.

실무 기준은 아래처럼 나눕니다.

| 상태 유형 | 서버 메모리 허용 여부 | 복구 기준 |
| --- | --- | --- |
| 단순 연결 목록 | 허용 | 재연결 시 다시 등록 |
| 구독 채널 목록 | 제한 허용 | 클라이언트가 재전송하거나 서버 저장소에서 복원 |
| 읽지 않은 이벤트 위치 | 메모리만 금지 | durable offset 또는 조회 API 필요 |
| 결제/주문 상태 변경 | 메모리 금지 | 원장/DB/event log 기준 |
| 협업 편집 operation | 메모리만 금지 | sequence와 conflict resolution 필요 |

sticky session을 켜더라도 drain timeout, idle timeout, reconnect jitter, 외부 상태 저장소를 같이 봐야 합니다. 이 부분은 [Session Affinity와 Stateful Routing](/learning/deep-dive/deep-dive-session-affinity-stateful-routing-playbook/)의 연장선입니다. 사용자가 같은 서버에 오래 붙어 있는 구조일수록, 그 서버가 빠질 때 상태를 어떻게 회수할지 먼저 설계해야 합니다.

### 5) 서버 push에도 backpressure와 drop policy가 필요하다

장기 연결은 서버가 데이터를 밀어 넣을 수 있다는 장점이 있지만, 클라이언트가 느리면 서버 메모리가 쌓입니다. 배포 drain 중에는 이 문제가 더 잘 드러납니다. 서버가 종료 예정이라 빠르게 남은 메시지를 보내려 하고, 느린 클라이언트는 받지 못하고, write buffer가 늘어나면서 종료가 지연됩니다.

서비스별 drop policy를 정해야 합니다.

- 시세, presence, 진행률처럼 최신값만 중요하면 오래된 메시지는 drop하고 최신 snapshot을 보낸다.
- 채팅, 알림, 주문 상태처럼 누락이 문제면 durable log에 쓰고 연결에는 pointer만 보낸다.
- 협업 편집처럼 순서가 중요하면 느린 클라이언트를 일정 기준에서 disconnect하고 catch-up 절차로 돌린다.
- gRPC streaming에서 client receive가 느리면 stream별 flow control 지표를 보고 서버 전체 worker를 막지 않게 한다.

숫자 기준은 단순하게 시작할 수 있습니다. 연결당 outbound buffer가 **1~5MB**를 넘거나, 단일 클라이언트 write latency p95가 **1초 이상**이면 slow consumer로 표시합니다. slow consumer 비율이 전체 연결의 **2~5%**를 넘으면 배포를 멈추고 원인을 봅니다. 이 기준 없이 drain을 길게 주면 느린 연결 몇 개가 프로세스 종료를 계속 붙잡습니다.

## 실무 적용

### 1) drain 메시지를 프로토콜별로 표준화한다

장기 연결 서버는 종료 직전에 그냥 TCP를 끊으면 안 됩니다. 클라이언트가 이유와 다음 행동을 알 수 있어야 합니다.

```json
{
  "type": "server_draining",
  "reason": "rolling_deploy",
  "retry_after_ms": 15000,
  "deadline_ms": 120000,
  "last_event_id": "evt_20260723_000421"
}
```

WebSocket에서는 close 전에 애플리케이션 메시지를 먼저 보내고, 이후 close code를 사용합니다. 일반적인 배포 종료는 `1001 Going Away`에 가깝고, 정책 위반이나 인증 실패와 섞지 않아야 합니다. SSE는 이벤트 이름을 `server_draining`으로 보내고 `retry:` 값을 함께 조정할 수 있습니다. gRPC는 stream 종료 시 trailer metadata로 `retry-after-ms`, `last-event-id`, `drain-reason`을 넘기는 식으로 통일합니다.

### 2) connection budget을 배포 단위로 계산한다

실시간 서버는 CPU 평균보다 연결 수와 인증/구독 재구성 비용이 더 중요할 때가 많습니다. 배포 전에는 아래 값을 알고 있어야 합니다.

- 인스턴스당 현재 연결 수 p50/p95/p99
- 초당 신규 연결 수와 재연결 수
- 연결당 평균 메모리
- 구독 복구에 필요한 DB/Redis/API 호출 수
- 인스턴스 1대 제거 시 남은 인스턴스의 연결 headroom

예를 들어 인스턴스 10대가 총 100,000 연결을 받고 있고 인스턴스당 안전 상한이 12,000이라면, 한 대를 빼면 나머지 9대가 평균 11,111 연결을 받습니다. 숫자만 보면 괜찮아 보이지만 p95 편중이 있으면 일부 서버는 12,000을 넘을 수 있습니다. 이 경우 rolling update `maxUnavailable=1`도 위험할 수 있고, 먼저 connection rebalancing이나 신규 연결 라우팅 가중치를 조정해야 합니다.

### 3) drain과 scale-down 정책을 분리한다

배포 drain은 계획된 이벤트이고, 오토스케일 scale-down은 자주 발생할 수 있는 이벤트입니다. 둘을 같은 정책으로 두면 비용이나 안정성 중 하나가 깨집니다.

- rolling deploy: 2~10분 drain, 사용자 영향 최소화
- 긴급 보안 패치: 30~120초 drain, 취약 버전 생존 시간 최소화
- 장애 격리: 즉시 새 연결 차단, 5~30초 안에 강제 종료 가능
- 비용 절감 scale-down: 연결 수 낮은 인스턴스부터 선택, drain 실패 시 scale-down 취소

오토스케일러가 연결 수를 모르면 가장 바쁜 인스턴스를 죽일 수 있습니다. 실시간 서버의 scale-down 후보는 CPU가 낮은 서버가 아니라 **연결 수, slow consumer 수, drain 가능성**이 낮은 서버여야 합니다.

### 4) 관측 지표는 연결 수보다 전이율을 본다

실시간 대시보드에는 총 연결 수만 있으면 부족합니다. 배포나 장애 때 필요한 것은 연결 상태 전이입니다.

- `connections_accepting`
- `connections_draining`
- `connections_closing`
- `connections_force_closed`
- `reconnect_attempts_per_second`
- `reconnect_success_rate`
- `resume_gap_event_count`
- `slow_consumer_count`
- `server_draining_message_sent_total`
- `new_connections_after_readiness_false`

특히 `new_connections_after_readiness_false`가 0이 아니면 라우팅에서 빠지지 않은 경로가 있다는 뜻입니다. `resume_gap_event_count`가 늘면 재연결은 됐지만 메시지 복구가 깨졌다는 뜻입니다. 이 둘은 단순 5xx 지표보다 실시간 서비스에 더 직접적입니다. 사용자 관점 검증은 [Synthetic Monitoring과 사용자 여정 Probe](/learning/deep-dive/deep-dive-synthetic-monitoring-user-journey-probes-playbook/)에 실시간 연결 시나리오를 추가해 확인하는 편이 좋습니다.

## 트레이드오프/주의점

첫째, drain window를 길게 잡으면 사용자 경험은 좋아지지만 배포 속도와 긴급 패치 속도가 느려집니다. 보안 패치에서는 오래 살아 있는 이전 버전 연결이 위험이 될 수 있습니다. 그래서 모든 종료에 같은 시간을 쓰지 말고, `rolling_deploy`, `security_patch`, `incident_isolation`, `scale_down` reason별로 timeout을 나눠야 합니다.

둘째, 연결을 보존하려고 서버 메모리 상태를 많이 들고 있으면 복구가 어려워집니다. 빠른 push를 위해 메모리에 둔 상태도, 사용자에게 의미 있는 상태라면 durable store나 재구성 API가 필요합니다. 상태를 전부 외부화하면 latency가 늘고 구현이 복잡해지지만, 배포 때마다 사용자가 튕기거나 메시지를 잃는 비용보다 낮을 때가 많습니다.

셋째, reconnect jitter는 UX와 안정성의 균형입니다. 너무 길면 사용자는 끊김을 느끼고, 너무 짧으면 서버가 폭주합니다. 일반적인 알림/피드 서비스는 5~30초 jitter를 받아들일 수 있지만, 거래·게임·콜센터처럼 실시간성이 강한 서비스는 별도 active-active 경로나 빠른 failover가 필요합니다.

넷째, "close를 보내면 클라이언트가 알아서 한다"는 가정은 위험합니다. 브라우저, 모바일 앱, 프록시, SDK 버전별로 재연결 구현이 다릅니다. 최소 3개 환경, 예를 들어 최신 Chrome, iOS 앱, Android 앱에서 drain 시나리오를 자동 테스트해야 합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 장기 연결 서버는 `RUNNING -> DRAINING -> CLOSING -> TERMINATED` 상태를 가진다.
- [ ] readiness false와 기존 연결 close가 분리되어 있다.
- [ ] drain 메시지에 reason, retry_after, deadline, last_event_id가 포함된다.
- [ ] 클라이언트 재연결에는 jitter와 최대 backoff가 있다.
- [ ] 이벤트 누락 복구를 위한 offset 또는 last_event_id 계약이 있다.
- [ ] 연결당 outbound buffer 상한과 slow consumer 정책이 있다.
- [ ] 배포 중 `reconnect_attempts_per_second`, `resume_gap_event_count`, `force_closed`를 본다.
- [ ] 긴급 패치와 일반 배포의 drain timeout이 다르다.

### 연습

1. 현재 실시간 기능 하나를 골라 연결이 끊긴 뒤 클라이언트가 몇 초 후 재연결하는지 실제 SDK 코드에서 확인해 보세요. retry jitter가 없다면 1~60초 범위의 backoff 표를 만듭니다.
2. WebSocket 또는 SSE 메시지에 `last_event_id`가 있는지 확인해 보세요. 없다면 "끊긴 동안 놓친 이벤트를 어떻게 복구하는가"를 문서로 적습니다.
3. 배포 중 인스턴스 1대를 제거했을 때 남은 인스턴스의 연결 수가 안전 상한의 몇 %까지 올라가는지 계산해 보세요. 80%를 넘으면 rolling 속도보다 capacity headroom을 먼저 조정합니다.
4. drain reason을 `rolling_deploy`, `security_patch`, `incident_isolation`, `scale_down` 네 가지로 나누고 각각의 timeout, retry_after, 강제 종료 조건을 정해 보세요.

장기 연결 드레이닝의 목표는 연결을 영원히 살리는 것이 아닙니다. 서버는 언젠가 배포되고, 노드는 내려가고, 네트워크는 끊깁니다. 좋은 실시간 시스템은 끊김이 없다고 약속하지 않습니다. 대신 끊김을 통지하고, 재연결을 분산하고, 마지막 이벤트 위치를 기준으로 복구하며, 느린 클라이언트가 전체 서버를 붙잡지 못하게 만듭니다. 그 기준이 있어야 실시간 기능도 일반 API처럼 반복 가능한 운영 대상이 됩니다.
