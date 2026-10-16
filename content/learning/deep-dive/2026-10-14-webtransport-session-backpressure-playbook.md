---
title: "백엔드 커리큘럼 심화: WebTransport 세션·스트림·Datagram을 지연·유실·백프레셔 기준으로 운영하는 법"
date: 2026-10-14T10:06:00+09:00
lastmod: 2026-10-14T10:06:00+09:00
draft: false
topic: "Backend Architecture"
tags: ["WebTransport", "HTTP/3", "QUIC", "Realtime", "Backpressure", "Backend"]
categories: ["Backend Deep Dive"]
keywords: ["WebTransport backend", "QUIC streams datagrams", "WebTransport backpressure", "real-time session design"]
description: "WebTransport를 WebSocket의 빠른 대체재로 보지 않고, 신뢰성·순서·혼잡 제어가 다른 stream과 datagram을 세션 계약으로 운영하는 기준을 정리합니다."
summary: "WebTransport는 HTTP/3 위에서 독립 stream과 유실 가능한 datagram을 함께 제공하지만, 메시지의 중요도·재전송·버퍼 한계를 명시하지 않으면 지연과 메모리 압박을 더 숨기기 쉽다. 프로토콜 기능보다 delivery class, session ownership, backpressure, fallback을 먼저 설계해야 한다."
module: "modern-frontiers"
study_order: 1540
key_takeaways:
  - "WebTransport의 bidirectional stream, unidirectional stream, datagram은 같은 메시지 통로가 아니며, 순서·유실·재전송 요구에 따라 분리해야 한다."
  - "send 호출이 성공해도 상대가 처리했다는 뜻은 아니다. application ack, queue 한도, drain 정책을 별도 계약으로 둬야 한다."
  - "HTTP/3·UDP 경로가 막히는 네트워크를 전제로 WebSocket, SSE, 일반 HTTP의 기능 저하 경로와 관측 항목을 함께 준비해야 한다."
operator_checklist:
  - "메시지를 reliable command, ordered update, latest-state, telemetry의 delivery class로 나누고 class별 최대 크기·재시도·TTL을 기록한다."
  - "세션·stream·tenant별 send queue 상한과 slow consumer 정책을 정하고, 버퍼 초과를 메모리로 흡수하지 않는다."
  - "handshake 실패, UDP 차단, datagram drop, stream reset, fallback 비율을 transport 이름과 함께 계측한다."
  - "write 명령은 transport 재연결과 무관하게 idempotency key·application ack·재개 cursor를 사용한다."
---

WebSocket으로 해결하기 어려운 실시간 요구가 늘면서 HTTP/3 위의 WebTransport가 선택지로 들어오고 있습니다. 하나의 연결에서 여러 독립 stream을 열고, 유실을 허용하는 datagram도 보낼 수 있으니 협업 편집, 게임 상태, 원격 제어, 저지연 대시보드에 잘 맞아 보입니다. 그러나 “UDP 기반이라 더 빠르다”만으로 채택하면 실패합니다. 네트워크 혼잡, 기업망의 UDP 차단, 느린 소비자, 재접속, 중복 명령은 WebSocket에서 사라지지 않던 문제이고 WebTransport에서도 애플리케이션이 답해야 할 문제입니다.

이 글은 [HTTP/3와 QUIC의 연결 모델](/learning/deep-dive/deep-dive-http3-quic/), [WebSocket·SSE·Webhook 선택 기준](/learning/deep-dive/deep-dive-websocket-sse-patterns/), [gRPC streaming의 흐름 제어](/learning/deep-dive/2026-09-29-grpc-streaming-flow-control-backpressure-playbook/), [종단간 deadline과 cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)을 이어서 읽을 때 유용합니다. 목표는 새 프로토콜을 도입하는 것이 아니라, **어떤 데이터가 어느 정도 늦거나 잃어도 되는지와 언제 전송을 멈출지를 세션 계약으로 만드는 것**입니다.

## 이 글에서 얻는 것

- WebTransport session, reliable stream, datagram이 보장하는 범위를 분리해 선택할 수 있습니다.
- 명령·상태 갱신·presence·telemetry를 같은 queue에 넣지 않고 delivery class로 설계할 수 있습니다.
- 느린 클라이언트가 서버 메모리와 다른 사용자의 지연시간을 잠식하지 않게 backpressure 기준을 정할 수 있습니다.
- HTTP/3 불가 경로의 fallback, 재연결, 관측성, rollout을 운영 절차에 넣을 수 있습니다.

## 핵심 개념/이슈

### 1) session은 하나지만 전달 보장은 여러 종류다

WebTransport session은 HTTP/3 연결 위에 만들어지지만, 그 안에서 쓰는 통로의 성질은 다릅니다. bidirectional stream은 양쪽이 읽고 쓰며 stream 안의 바이트 순서를 보존합니다. unidirectional stream은 한쪽이 생산하고 한쪽이 소비하는 큰 응답이나 서버 푸시에 적합합니다. datagram은 낮은 지연을 목표로 하지만 유실·중복 가능성을 애플리케이션이 받아들여야 합니다. QUIC의 stream 분리는 한 stream의 손실이 다른 stream의 바이트 전달을 반드시 막지는 않게 하지만, 네트워크 자체의 혼잡과 서버의 CPU·queue 압박까지 없애지는 않습니다.

따라서 메시지 타입을 transport API 이름으로 고르지 말고, 업무 의미로 먼저 나눠야 합니다.

| Delivery class | 예시 | 권장 통로 | 잃거나 늦었을 때의 처리 |
| --- | --- | --- | --- |
| reliable command | 결제 전 확인, 문서 저장, 권한 변경 | reliable stream + application ack | 재시도하되 idempotency key로 중복 실행 차단 |
| ordered update | 문서 operation, 순서 있는 채팅 이벤트 | entity별 reliable stream | sequence gap을 감지하고 cursor부터 복구 |
| latest-state | 커서 좌표, 영상 품질 힌트, presence | datagram 또는 coalesced stream | 이전 값을 버리고 최신 snapshot만 반영 |
| telemetry | frame timing, 입력 지연 통계 | sample된 datagram 또는 batch HTTP | 유실 허용, 집계·표본률을 함께 기록 |

예를 들어 커서 좌표 20개가 밀렸을 때 모두 전달하는 것은 사용자를 더 늦게 만듭니다. 반면 권한 변경을 datagram으로 보내고 “대체로 도착했겠지”라고 가정하면 보안 사고가 됩니다. 최신 상태에는 `state_version`을, 순서 있는 operation에는 `entity_id`와 증가하는 `sequence`을, command에는 `command_id`와 `idempotency_key`를 넣으세요. transport-level delivery와 business-level 완료를 같은 것으로 보지 않는 것이 출발점입니다.

### 2) 독립 stream이 무한 병렬성을 뜻하지는 않는다

stream을 요청마다 열면 head-of-line blocking 일부를 줄일 수 있지만, stream 수·metadata·buffer는 서버와 브라우저의 자원을 씁니다. 특정 탭이 업데이트를 읽지 않을 때 서버가 `send()`를 계속 호출하면, 연결 버퍼와 사용자별 queue가 쌓이고 결국 정상 사용자의 p99도 나빠집니다. 실제 병목은 “stream이 몇 개인가”가 아니라 **읽기 속도보다 생산 속도가 오래 빠른가**입니다.

시작값으로 다음처럼 상한을 명시해 보세요. 수치는 서비스 부하 시험으로 조정해야 하지만, 무제한 buffer보다 훨씬 안전한 기본값입니다.

- session 하나의 동시 application stream은 **32개 이하**, tenant 하나는 **2,000개 이하**로 시작합니다. 넘는 요청은 새 stream 대신 기존 multiplex stream 또는 일반 HTTP로 유도합니다.
- 최신 상태 queue는 connection당 **256KB 또는 100개** 중 먼저 도달한 한도로 두고, 초과분은 오래된 항목을 삭제해 가장 최신 snapshot 하나만 남깁니다.
- reliable command queue는 connection당 **1MB 또는 500개**를 넘기면 새 command를 받지 않고 `RESOURCE_EXHAUSTED` 성격의 오류를 돌려줍니다. 조용히 drop하지 않습니다.
- queue가 상한의 **80%**를 30초 넘게 유지하면 producer rate를 낮추거나 session을 drain 대상으로 표시합니다. 100% 이후에야 대응하면 복구 시간이 길어집니다.

서버 구현은 전송을 한 곳에 모으는 것이 좋습니다. domain handler가 session에 직접 쓰는 대신, `delivery_class`, `tenant_id`, `session_id`, `expiry_at`, `supersedes_key`를 가진 envelope을 session dispatcher에 넘깁니다. dispatcher는 quota, cancellation, stream 상태, drop 정책을 평가합니다. 이 구조가 있어야 command와 cursor update가 같은 메모리 queue에서 서로를 굶기지 않습니다.

### 3) 재연결은 전송 재개가 아니라 상태 동기화 문제다

모바일 전환, NAT 재바인딩, 브라우저 절전, load balancer 재배포 때문에 session은 언제든 끊깁니다. 재연결 뒤 “마지막으로 보낸 메시지부터 모두 다시 보낸다”는 방식은 오래된 latest-state를 폭주시키고, 이미 실행한 command를 재실행할 수 있습니다. 재개 token은 로그인 token과 역할이 다릅니다. 그것은 어떤 클라이언트가 어떤 entity를 어느 version까지 반영했는지에 대한 힌트여야 합니다.

안전한 재개 흐름은 다음과 같습니다.

```text
client reconnect(session credential, subscriptions, last_cursor_by_entity)
  -> server verifies subject + tenant + cursor retention window
  -> retained operations are replayed, or snapshot_required is returned
  -> client applies snapshot then operations after snapshot_version
  -> command acknowledgements are reconciled by command_id
```

cursor가 보존 기간보다 오래됐거나 gap이 발견되면 partial replay를 억지로 이어 붙이지 말고 snapshot을 내려야 합니다. 문서 협업이라면 document revision, 알림 피드라면 monotonic event cursor, 게임 상태라면 authoritative tick을 기준으로 삼습니다. command는 재연결 시 `command_id` 조회 결과를 먼저 받고, 처리 중이면 동일 idempotency key로 재전송해도 결과가 하나로 수렴하도록 만드세요. 이 원칙은 [멱등 consumer와 transactional inbox](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)에도 그대로 적용됩니다.

## 실무 적용

### 1) 전송 계약을 코드보다 먼저 한 장으로 만든다

팀이 protocol 구현을 시작하기 전에 event inventory를 아래 수준으로 만드세요. 특히 reliable 여부를 단순 boolean으로 두면 “순서는 필요하지만 일부 유실은 괜찮다” 같은 차이를 표현하기 어렵습니다.

| 필드 | 질문 | 예시 |
| --- | --- | --- |
| message name·owner | 누가 schema와 제거 시점을 책임지는가 | `document.operation`, editor platform |
| delivery class | 정확히 무엇을 보장하는가 | ordered update |
| size·rate budget | 피크에서 얼마나 보내는가 | 8KB, client당 초당 20회 |
| expiry·supersedes key | 늦게 도착한 값을 써도 되는가 | 2초, `cursor:{user}` |
| ack·replay rule | 완료와 재개를 어떻게 판단하는가 | application ack, 24시간 cursor |
| fallback | HTTP/3가 불가할 때 기능이 어떻게 달라지는가 | 2초 polling, 편집은 read-only |

write command는 server가 `accepted`, `applied`, `rejected` 중 어느 상태를 응답하는지 분명히 하세요. `accepted`만 받았다고 화면을 영구 상태로 확정하지 않으며, client가 3초 안에 `applied`를 못 받으면 status API로 확인합니다. deadline은 end-to-end로 공유합니다. session queue에서 800ms를 기다린 command를 downstream API에 또 3초 timeout으로 보내면 사용자가 만든 2초 예산을 이미 넘겼을 수 있습니다.

### 2) fallback을 장애 처리가 아니라 제품 범위로 설계한다

WebTransport는 HTTP/3와 UDP 경로에 의존하므로 모든 회사 네트워크, proxy, 오래된 runtime에서 동일하게 연결된다고 가정하면 안 됩니다. capability detection 후 다음 순서를 권장합니다: WebTransport → WebSocket → SSE 또는 short polling → 명시적 제한 기능. fallback마다 같은 UX를 복제하려 하지 말고 데이터 의미를 보존하세요. 예를 들어 presence의 300ms 업데이트는 polling에서 5초 갱신으로 낮출 수 있지만, 저장 command는 HTTPS API로 옮겨도 idempotency와 응답 contract를 유지해야 합니다.

fallback 성공을 “연결됐다”로만 보지 마세요. transport별 handshake success, median/p95 connect time, first useful message time, reconnect rate, reliable ack latency, datagram drop 추정치, queue overflow, CPU per active session을 나눠 봅니다. HTTP/3 사용자가 70%라도 그 집단의 packet loss가 높아 command ack p99가 나빠진다면 rollout을 확대할 이유가 없습니다. 사용자·tenant ID를 raw label로 넣지 않고 transport, region, client major version, error class처럼 제한된 차원으로 집계해야 합니다.

### 3) 7일 pilot에서 실패 경로를 먼저 검증한다

처음부터 전체 실시간 기능을 옮기지 말고 읽기 전용 latest-state 하나에서 pilot을 시작합니다. traffic profile이 다른 내부 사용자와 opt-in tenant를 포함해 **5% 이하**로 열고, 정상 피크를 포함한 **7일**을 봅니다. command가 필요한 기능은 다음 단계에서 별도의 idempotency·replay test를 통과한 뒤 열어야 합니다.

확대 조건과 중단 조건도 구체적으로 둡니다. 예를 들어 대조군 대비 connection success가 **1%p 이상** 낮거나, reliable ack p99가 **20% 이상** 나빠지거나, session당 buffered bytes가 기준선의 **2배**를 15분 넘게 유지하면 확대를 멈춥니다. command의 duplicate apply는 한 건이라도 즉시 분석 대상입니다. 반대로 datagram drop이 조금 있어도 latest-state 화면의 stale time이 서비스 목표 안이면 허용할 수 있습니다. 프로토콜 metric만 보고 판단하지 말고 사용자가 실제로 보는 상태 freshness와 command completion을 같이 비교하세요.

## 트레이드오프/주의점

첫째, WebTransport는 WebSocket의 보안·인증·인가를 자동으로 해결하지 않습니다. origin 검증, cookie/SameSite 정책, session credential의 수명, subscription 권한 재확인, rate limit은 여전히 필요합니다. 특히 하나의 session에서 여러 topic을 구독할 때 handshake 시점 권한만 믿지 말고 구독 추가와 권한 변경 때 다시 확인해야 합니다.

둘째, datagram은 빠른 실패를 가능하게 하지만 신뢰성 없는 command channel이 되면 안 됩니다. 최신 값이 이전 값을 대체할 수 있는 경우에만 쓰고, stale datagram을 버릴 version·expiry가 없다면 reliable stream을 쓰는 편이 낫습니다. “유실 가능”과 “중복 가능”, “순서 무관”은 서로 다른 요구입니다.

셋째, QUIC 연결 ID와 UDP 특성은 load balancer, WAF, DDoS 방어, observability 도구의 지원 범위를 바꿉니다. 기존 TCP 기준 idle timeout, source IP affinity, connection counting을 그대로 이식하면 오판할 수 있습니다. 운영 환경에서 connection migration, proxy pass-through, rate-limit key, 로그 보존 정책을 별도 시험해야 합니다.

마지막으로 protocol 선택이 backend의 내구성 저장소를 대체하지는 않습니다. 실시간으로 전달한 이벤트라도 재접속, 감사, 복구가 필요하면 durable log 또는 snapshot source가 있어야 합니다. session은 delivery optimization 계층이고, business truth의 저장소가 아닙니다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 모든 메시지를 reliable command, ordered update, latest-state, telemetry로 분류했고 class별 size·rate·TTL을 정했다.
- [ ] command에 idempotency key와 application ack를 두고, transport 재연결 뒤 상태를 조회·재조정할 수 있다.
- [ ] session·stream·tenant별 queue 상한, 80% 경고선, overflow 시 drop 또는 reject 정책을 문서화했다.
- [ ] `sequence` 또는 snapshot version으로 gap을 감지하고 retention window 밖에서는 snapshot을 요구한다.
- [ ] WebTransport 실패 시 WebSocket/SSE/HTTP fallback에서 유지할 기능과 낮출 기능을 구분했다.
- [ ] handshake, ack latency, reconnect, buffer, fallback, datagram drop을 같은 dashboard에서 transport별로 비교한다.
- [ ] 5% 이하·7일 pilot의 확대·중단·rollback 조건을 서비스 SLO와 함께 합의했다.

### 연습: 협업 편집기의 전송표 만들기

협업 편집기에 `insert operation`, `cursor position`, `typing indicator`, `save document` 네 이벤트가 있다고 가정해 보세요. 각 이벤트의 delivery class, 최대 크기, 초당 허용 횟수, ack 필요 여부, 재연결 뒤 복구 방법을 표로 적습니다. 그다음 cursor queue가 가득 찼을 때 오래된 cursor를 버려도 되는 이유와, save command를 버리면 안 되는 이유를 설명해 보세요. 이 차이를 코드와 dashboard에서 관찰할 수 있을 때 WebTransport는 단순한 연결 교체가 아니라 운영 가능한 전송 계층이 됩니다.
