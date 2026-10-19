---
title: "백엔드 커리큘럼 심화: WebSocket 재접속·재전송·ACK를 전달 계약으로 설계하는 법"
date: 2026-10-19T10:06:00+09:00
lastmod: 2026-10-19T10:06:00+09:00
draft: false
topic: "Backend Realtime Delivery"
tags: ["WebSocket", "Realtime", "Delivery ACK", "Reconnect", "Replay", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "WebSocket 연결이 끊긴 뒤에도 알림·채팅·상태 갱신의 의미를 보존하도록 sequence, ACK, replay window, snapshot 전환을 설계·운영하는 기준을 정리합니다."
summary: "연결 성공은 전달 성공이 아니다. 재접속 가능한 실시간 기능은 메시지 종류별 전달 보장, client ACK의 의미, 보관 범위와 snapshot 전환 조건을 명시한 계약에서 시작한다."
module: "distributed-system"
study_order: 1563
keywords: ["websocket reconnect replay", "delivery acknowledgement", "websocket sequence number", "realtime message delivery", "client ack protocol"]
key_takeaways:
  - "WebSocket frame 전송 성공은 client 처리 완료를 뜻하지 않으므로, 업무 이벤트에는 server sequence·ACK·재전송 범위를 분리해 정의해야 한다."
  - "명령, 반드시 보존할 event, 최신 상태는 같은 큐·재전송 정책으로 다루지 않는다."
  - "replay가 불가능한 오래된 cursor는 조용히 누락시키지 말고 versioned snapshot과 reset 신호로 복구시킨다."
operator_checklist:
  - "메시지마다 delivery class, sequence scope, dedupe key, 보존 기간, client 적용 규칙을 기록한다."
  - "ACK lag, replay miss, duplicate drop, reconnect recovery latency를 별도 지표로 관측한다."
  - "배포와 drain 중에는 새 연결 차단, resume cursor 보존, bounded replay를 함께 검증한다."
---

WebSocket은 요청 하나와 응답 하나를 교환하는 HTTP보다 실시간 화면을 자연스럽게 만들지만, 연결이 끊기는 순간 설계의 빈칸이 드러납니다. 모바일 네트워크 전환, 노트북 절전, proxy idle timeout, 서버 롤링 배포는 정상 상황에서도 일어납니다. 서버가 frame을 `send`했다는 사실만으로 사용자가 알림을 봤거나 화면 상태가 반영됐다고 말할 수는 없습니다. TCP ACK는 바이트가 전송 계층에 도달했다는 신호일 뿐, 애플리케이션이 의미 있게 처리했다는 영수증이 아닙니다.

따라서 실시간 기능의 질문은 “소켓을 다시 연결할 수 있는가”가 아니라 **끊긴 동안 어떤 사실을 되살리고, 무엇은 최신 상태로 덮어써도 되며, 중복된 사실을 어떻게 안전하게 적용할 것인가**입니다. 이 글은 [WebSocket 기반 실시간 시스템](/learning/deep-dive/deep-dive-websocket-realtime/), [WebSocket·SSE 선택 기준](/learning/deep-dive/deep-dive-websocket-sse-patterns/), [장기 연결 draining](/learning/deep-dive/deep-dive-long-lived-connection-draining-playbook/), [멱등 write path](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)의 원칙을 재접속 전달 계약으로 연결합니다.

## 이 글에서 얻는 것

- 연결 복구와 업무 이벤트의 전달 보장을 구분합니다.
- command, durable event, latest-state에 각각 다른 sequence·ACK·replay 규칙을 적용합니다.
- 오래된 resume cursor를 snapshot으로 전환하는 기준을 세웁니다.
- 중복, 순서 역전, 느린 client, 롤링 배포에서 확인할 수치와 중단 조건을 만듭니다.

## 핵심 개념/이슈

### 1) 모든 메시지가 같은 보장을 요구하지 않는다

같은 WebSocket으로 오더라도 메시지의 의미는 다릅니다. 채팅 메시지나 주문 상태 변화처럼 누락되면 안 되는 **durable event**, 커서 위치·presence처럼 최신값만 중요하고 이전 값은 버려도 되는 **latest-state**, 사용자가 서버에 실행을 요청하는 **command**를 한 재전송 큐에 넣으면 비용과 오류가 함께 커집니다.

| delivery class | 예시 | 기본 계약 | 재접속 시 처리 |
| --- | --- | --- | --- |
| command | 전송, 승인, 구독 변경 | request ID 기준 멱등 결과 | 같은 command ID로 결과 조회 또는 재시도 |
| durable event | 채팅 수신, 주문 상태 변경 | 순서가 있는 at-least-once 전달 | 마지막 적용 sequence 뒤부터 bounded replay |
| latest-state | typing, presence, 진행률 | 최신 snapshot 우선 | 이전 delta는 버리고 최신 version을 수신 |
| ephemeral signal | 입력 중 표시, animation hint | best effort | 복구하지 않음 |

“exactly once WebSocket”보다 실용적인 목표는 **서버 전달은 at-least-once, client 적용은 idempotent, command 효과는 업무 키로 중복 제거**입니다. durable event의 `event_id`와 채널별 단조 증가 `sequence`를 함께 주면 client는 같은 event를 두 번 받아도 한 번만 적용하고, gap이 생긴 사실도 감지할 수 있습니다.

### 2) ACK는 수신 확인이 아니라 적용 경계를 뜻해야 한다

ACK를 보내는 시점을 정의하지 않으면 구현마다 의미가 달라집니다. socket buffer에 넣은 직후 ACK를 보내면 화면 렌더나 로컬 저장 실패를 숨길 수 있습니다. 반대로 DOM 반영, disk flush, analytics 전송까지 기다리면 ACK가 불필요하게 늦어지고 connection당 상태가 커집니다.

보통은 client가 `sequence=418` event를 **유효성 검사하고 로컬 상태 모델에 반영한 뒤** `ack: 418`을 보내는 정도가 적절합니다. UI animation 완료나 서버 부수효과는 ACK 조건에 넣지 않습니다. 여러 기기가 같은 계정으로 접속한다면 계정 전체의 ACK가 아니라 `device_session_id`별 cursor를 분리해야 한 기기의 느린 연결이 다른 기기의 보관 정책을 바꾸지 않습니다.

```text
server -> client: event { channel, sequence: 418, event_id, type, payload }
client applies event_id once to local state
client -> server: ack { channel, sequence: 418, client_session_id }
reconnect -> server: resume { channel, after_sequence: 418, client_session_id }
```

ACK에는 “418까지 연속으로 적용했다”는 의미만 줍니다. 420을 받았다고 420을 ACK하면 419 누락을 가릴 수 있습니다. gap을 발견한 client는 ACK를 전진시키지 않고 `resync_required`를 요청해야 합니다. server도 보관된 첫 sequence가 `after_sequence + 1`인지 검사해야 합니다.

### 3) replay window 밖에서는 snapshot으로 명시적으로 전환한다

모든 event를 무기한 재생할 수는 없습니다. 채널당 7일 보관 또는 10만 event 같은 제한은 필요하지만, cursor가 만료됐을 때 조용히 최신 이벤트만 보내면 client는 누락된 변경을 정상 상태로 오해합니다. 이 경우 server는 `reset_required`, 사유, `snapshot_version`, snapshot URL을 보내야 합니다. snapshot에는 기준 version 또는 watermark가 있어야 하고, client는 snapshot을 적용한 뒤 그 watermark보다 큰 event만 처리합니다.

snapshot 조회와 live subscription 사이의 경쟁 조건은 `subscribe → snapshot(version=v) → replay after v` 순서, 또는 server가 같은 connection에 snapshot과 replay 경계를 함께 발행하는 방식으로 닫습니다. [Cursor Pagination의 일관성](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)처럼 cursor는 단지 위치 문자열이 아니라 어느 데이터 시점을 가리키는 계약입니다.

## 실무 적용

### 1) 먼저 채널 하나의 상태 기계를 적는다

도입 초기에 전 기능을 바꾸지 말고 채팅방이나 주문 진행 화면처럼 durable event와 latest-state가 함께 있는 채널 하나를 선택합니다. `DISCONNECTED → CONNECTING → SUBSCRIBED → REPLAYING → LIVE → RESETTING` 상태와 전이 조건을 문서·테스트로 만드세요. `REPLAYING` 중 들어온 live event를 바로 렌더링하면 순서가 역전될 수 있으므로, replay watermark까지 buffer한 뒤 `LIVE`로 올리거나 sequence merge를 구현해야 합니다.

메시지 envelope에는 적어도 `protocol_version`, `channel`, `event_id`, `sequence`, `occurred_at`, `delivery_class`를 둡니다. payload schema를 바꿀 때도 새 client와 이전 client가 어떤 event를 읽을 수 있는지 [응답 호환성 계약](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)처럼 확인합니다. `event_id`는 dedupe용, `sequence`는 순서·gap 검출용이므로 하나로 합치지 않는 편이 좋습니다.

### 2) 숫자로 시작하는 보관·흐름 제어 기준을 둔다

| 항목 | 출발 기준 | 기준을 넘으면 할 일 |
| --- | --- | --- |
| reconnect recovery p95 | 3초 이하 | DNS·auth·replay size를 분리해 측정 |
| unacked durable event | connection당 500개 이하 | 더 읽지 말고 slow-client 경고 또는 reset |
| replay batch | 100~500 event | batch별 ACK 또는 watermark 확인 |
| replay miss 비율 | 일 요청의 0.5% 미만 | retention 또는 snapshot 경로 점검 |
| duplicate drop 비율 | 1% 미만 | 재접속 폭증·ACK 손실·fan-out 점검 |
| presence update | 사용자당 초당 1~3회 | coalesce하고 backlog를 만들지 않음 |

느린 client에게 durable event를 끝없이 쌓으면 메모리와 broker lag가 함께 늘어납니다. connection별 unacked 상한을 넘으면 `slow_consumer`로 끊고 재접속 시 snapshot 또는 제한 replay를 선택하세요. 이는 사용자를 벌주는 정책이 아니라 빠른 client까지 장애에 끌려가지 않게 하는 [backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/) 경계입니다.

### 3) 배포는 protocol 전환으로 취급한다

롤링 배포에서 process를 즉시 종료하면 살아 있는 connection과 아직 ACK되지 않은 event가 한꺼번에 끊깁니다. 새 connection 수락을 먼저 멈추고, 기존 client에는 `drain` 이벤트와 reconnect deadline을 알린 뒤, 일정 시간 동안 ACK와 replay cursor를 유지하세요. 예를 들어 새 연결은 즉시 다른 instance로 보내고, 기존 연결은 30초 drain, shutdown grace는 60초로 두어야 30초 안에 재접속하지 못한 client도 의도된 reset 경로를 밟습니다.

프로토콜 변경은 server가 새 event를 내보내기 전에 구버전 client의 연결 비율을 확인해야 합니다. `protocol_version=1`이 1% 아래로 내려갔다고 곧바로 제거하지 말고, mobile release 배포 지연과 장기 오프라인 device를 반영한 관찰 기간을 둡니다. protocol switch, retention 축소, snapshot schema 변경을 한 배포에 묶으면 replay 실패의 원인을 구분하기 어렵습니다.

## 트레이드오프/주의점

ACK와 durable replay는 신뢰도를 올리지만 저장·fan-out·개인정보 보존 비용을 가져옵니다. “읽음 표시”를 정확히 복구하려고 모든 UI 상태를 event로 남기면 storage와 privacy surface가 빠르게 커집니다. 법적 보관이 필요한 업무 event와 잠깐의 presence를 같은 retention으로 두지 마세요. payload 전체를 event log에 남길 수 없다면 최소한 event ID, schema version, 대상, digest, 발생 시각으로 재현 가능한 감사 경계를 만듭니다.

ACK가 있다고 권한이 보장되는 것도 아닙니다. 재접속 resume token은 짧은 TTL과 session·tenant binding을 가져야 하며, 구독 권한은 reconnect마다 다시 확인해야 합니다. 이전에 허용됐던 채널의 cursor를 들고 왔다고 탈퇴·권한 변경 뒤에도 replay를 허용하면 정보가 새어 나갑니다. 우선순위는 **권한 재검증 → delivery class 분리 → bounded replay → idempotent 적용 → UI 편의**입니다.

## 체크리스트 또는 연습

- [ ] 각 메시지를 command, durable event, latest-state, ephemeral signal으로 분류했다.
- [ ] durable event에 event ID와 채널별 연속 sequence를 모두 넣었다.
- [ ] ACK가 “연속 sequence까지 local state에 적용됨”을 뜻하며 gap을 건너뛰지 않는다.
- [ ] replay window 밖에는 `reset_required`와 versioned snapshot 경로가 있다.
- [ ] connection별 unacked 상한, replay batch, retention, slow-client 처리 기준을 숫자로 정했다.
- [ ] reconnect recovery p95, replay miss, duplicate drop, ACK lag를 dashboard와 alert에 분리했다.
- [ ] drain 중 새 연결 차단·cursor 보존·graceful shutdown을 함께 game day로 검증했다.

연습으로 현재 실시간 화면 하나를 고르고, Wi-Fi를 끈 뒤 10분 후 재접속하는 상황을 적어 보세요. 그 사이 일어난 이벤트 12개 중 어떤 것은 정확히 replay되어야 하고, 어떤 것은 최신 snapshot 하나로 충분한지 구분합니다. 이어서 sequence 7이 빠지고 8이 먼저 도착한 fixture, 같은 event ID가 두 번 오는 fixture, cursor가 만료된 fixture를 작성하세요. 세 경우를 설명할 수 있어야 재접속이 단순 reconnect를 넘어 전달 계약이 됩니다.

## 관련 글

- [WebSocket 기반 실시간 시스템](/learning/deep-dive/deep-dive-websocket-realtime/)
- [WebSocket·SSE 선택 기준](/learning/deep-dive/deep-dive-websocket-sse-patterns/)
- [장기 연결 Draining 플레이북](/learning/deep-dive/deep-dive-long-lived-connection-draining-playbook/)
- [Cursor Pagination 일관성](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
