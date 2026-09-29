---
title: "백엔드 커리큘럼 심화: gRPC 스트리밍 흐름 제어와 역압, 빠른 소비자를 느린 소비자로 망가뜨리지 않는 법"
date: 2026-09-29T10:06:00+09:00
lastmod: 2026-09-29T10:06:00+09:00
draft: false
topic: "Backend Reliability"
tags: ["gRPC", "Streaming", "Flow Control", "Backpressure", "HTTP/2", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "gRPC client·server·bidirectional streaming에서 HTTP/2 흐름 제어, 애플리케이션 큐, deadline·cancellation을 함께 설계해 느린 소비자와 burst가 메모리·꼬리 지연으로 번지는 것을 막는 운영 플레이북입니다."
summary: "스트리밍 RPC는 연결을 오래 열어 두는 API가 아니라 생산 속도와 소비 속도의 차이를 명시적으로 다루는 계약이다. 메시지 크기·in-flight 상한·drain·재개 cursor·관측 지표를 함께 정해야 처리량 증가가 메모리 적체와 재전송 폭주로 바뀌지 않는다."
module: "distributed-systems"
study_order: 366
keywords: ["gRPC streaming flow control", "gRPC backpressure", "HTTP/2 window", "slow consumer", "streaming API reliability"]
key_takeaways:
  - "HTTP/2 흐름 제어는 peer가 받을 수 있는 바이트를 조절하지만, 애플리케이션이 먼저 만든 무제한 큐나 fan-out backlog를 자동으로 제한하지 않는다."
  - "stream마다 메시지 수, 바이트, 처리 시간 중 하나 이상에 명시적 in-flight 예산을 두고, 초과 시 대기·축소·종료 중 어떤 행동을 할지 API 계약으로 정해야 한다."
  - "long-lived stream은 재시도 횟수보다 cursor·ack·deduplication key·deadline·cancellation 전파를 먼저 설계해야 안전하게 재개할 수 있다."
  - "운영 지표는 초당 메시지뿐 아니라 buffered bytes, send stall, consumer lag, cancellation, reconnect, dropped update의 이유를 함께 보여야 한다."
operator_checklist:
  - "각 stream의 최대 메시지 크기, 최대 in-flight bytes, 최대 대기 시간, idle timeout과 전체 deadline을 문서화한다."
  - "생산자 queue와 transport write를 분리해 계측하고, buffered bytes가 예산의 80%를 넘으면 admission·coalescing·disconnect 정책을 실행한다."
  - "재개 가능한 stream은 순서가 보장되는 범위, cursor TTL, ack 지점, 중복 이벤트 처리 방식을 명시한다."
  - "배포 시 새 연결부터 candidate로 보내고, 기존 stream의 drain deadline과 retry jitter를 정한 뒤 graceful shutdown을 검증한다."
---

gRPC 스트리밍은 알림, 가격 변동, 작업 진행률, 로그 tail, 서비스 간 대량 전송처럼 짧은 request/response로 표현하기 어색한 흐름을 단순하게 만든다. 하지만 `Send()`를 반복할 수 있다는 사실은 수신자가 같은 속도로 읽을 수 있다는 뜻이 아니다. 클라이언트가 탭을 백그라운드로 보내거나, downstream DB가 느려지거나, 네트워크가 순간적으로 혼잡해지면 생산자와 소비자의 속도 차이는 어딘가에 쌓인다. 그 위치가 명확하지 않으면 메시지는 메모리 큐에 쌓이고, GC·CPU·connection 수가 함께 악화되어 정상 사용자까지 느려진다.

이 글은 [장기 연결 드레이닝](/learning/deep-dive/deep-dive-long-lived-connection-draining-playbook/), [API 리소스 예산](/learning/deep-dive/deep-dive-api-resource-budgeting/), [큐 HOL과 우선순위 역전](/learning/deep-dive/deep-dive-queue-hol-priority-inversion-playbook/), [외부 API adapter 격리](/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/)의 원칙을 gRPC streaming에 연결한다. 목표는 최고 처리량을 과시하는 것이 아니라, 느린 소비자가 생겨도 메모리·지연·재시도 비용의 상한을 유지하는 것이다.

## 이 글에서 얻는 것

- HTTP/2 transport 흐름 제어와 애플리케이션 역압이 각각 무엇을 막고 무엇을 못 막는지 구분합니다.
- 메시지 크기, in-flight bytes, queue 길이, 소비 지연을 하나의 stream budget으로 정하는 방법을 배웁니다.
- server streaming·client streaming·bidirectional streaming의 재개, ACK, 취소, 종료 계약을 설계합니다.
- burst·느린 소비자·배포 drain에서 어떤 수치를 보고 차단 또는 축소할지 정할 수 있습니다.

## 핵심 개념/이슈

### 1) 흐름 제어는 transport의 안전장치이지 업무 backlog 정책이 아니다

HTTP/2와 gRPC transport에는 receiver가 처리 가능한 바이트만 sender가 보낼 수 있게 하는 window 기반 흐름 제어가 있다. 이 장치는 peer가 읽지 않는 socket에 무한히 write 하는 일을 줄인다. 그러나 애플리케이션이 transport 앞에서 이벤트를 무제한으로 만들거나, 한 producer의 update를 수만 개 subscriber의 per-client queue에 복사한다면 window가 닫히기 전에 이미 메모리 비용은 발생한다.

따라서 아래 네 층을 따로 그려야 한다.

| 층 | 질문 | 대표 상한 | 초과했을 때의 행동 |
| --- | --- | --- | --- |
| 업무 producer | 초당 몇 개 이벤트를 만들 수 있는가 | topic별 QPS, payload 크기 | 집계·coalescing·sampling |
| application queue | 아직 `Send`되지 않은 데이터가 얼마인가 | stream당 256개 또는 1 MiB부터 시작 | 대기, 오래된 update 폐기, stream 종료 |
| gRPC/HTTP2 transport | peer가 읽을 여유가 있는가 | connection·stream window, write stall | write 대기, deadline/cancel |
| consumer | 받은 메시지를 의미 있게 처리했는가 | 처리 p95, ACK lag, local queue | 속도 낮추기, resume, 사용자에게 상태 노출 |

예를 들어 4 KiB update를 stream당 최대 256개만 쌓아도 약 1 MiB다. 5,000개 느린 stream이면 약 5 GiB의 payload만으로 process가 위험해질 수 있다. 실제 overhead, 직렬화 buffer, retry 복제본까지 포함하면 더 크다. 그래서 `256`은 만능 기본값이 아니라 **동시 stream 수 × 메시지 상한 × 허용 메모리**로 역산해야 한다. 서비스가 2 GiB를 streaming buffer에 쓰지 않겠다는 예산이고 peak stream이 2,000개라면, protocol·object overhead를 제외하고도 stream당 512 KiB 이하로 시작하는 편이 보수적이다.

### 2) 역압은 "기다린다"와 "버린다"의 명시적 선택이다

모든 메시지가 같은 가치가 아니다. 잔액 변경, 주문 상태 전이, 감사 이벤트는 빠뜨리면 안 되고 순서도 중요할 수 있다. 반면 1초마다 나오는 진행률, 현재 온라인 사용자 수, 검색 자동완성 후보는 최신 값 하나가 이전 값 여러 개보다 가치가 크다. 이 둘에 같은 queue 정책을 쓰면 하나는 메모리를 쓰고, 다른 하나는 데이터 정합성을 잃는다.

| 이벤트 성격 | 권장 backpressure 정책 | 재개 방식 | 피해야 할 선택 |
| --- | --- | --- | --- |
| 상태 전이·원장 | bounded queue + producer pause 또는 durable broker | sequence/cursor 뒤부터 재생 | 최신 것만 남기고 중간 전이를 버리기 |
| 최신 상태 snapshot | key별 coalescing | 가장 새 revision fetch | 모든 중간 snapshot을 보존하기 |
| 로그·진행률 | sampling 또는 drop with reason | 시간/offset 범위 재조회 | drop을 성공 처리로 숨기기 |
| 대용량 upload | client pull/credit 또는 chunk ACK | chunk hash·offset부터 재개 | 서버가 전체 파일을 buffer하기 |

`drop_oldest`는 나쁜 정책이 아니라 상태 snapshot에 맞을 때 유용한 정책이다. 다만 원장 이벤트에 적용하면 소비자가 `PAID`를 보았지만 그 전에 취소가 있었는지 모르는 상태가 된다. 반대로 모든 update를 보존하려면 producer를 멈추거나 durable queue로 넘길 비용을 수용해야 한다. 설계 문서에는 event class, 허용 drop 여부, dedup key, 재조회 endpoint, 소비자가 보는 gap signal을 함께 적는다.

### 3) streaming retry는 request retry보다 상태가 많다

unary RPC는 idempotency key와 timeout이 있으면 비교적 단순하게 재시도할 수 있다. stream은 연결이 끊겼을 때 어느 메시지까지 처리됐는지, server가 보낸 순서가 다시 이어지는지, side effect가 중복되지 않는지가 추가된다. "끊기면 자동 reconnect"만 넣으면 outage 뒤 모든 client가 처음부터 replay하거나 같은 명령을 두 번 보낼 수 있다.

재개가 필요한 stream은 최소 다음 계약을 갖는 편이 좋다.

```text
stream identity: tenant + consumer + logical subscription
position: monotonic sequence 또는 immutable event cursor
ack: consumer가 durable 처리 후 기록하는 마지막 position
resume: reconnect 시 ack+1부터, cursor TTL 내에서만 허용
dedup: event_id를 consumer 결과 저장소의 unique key로 사용
gap: retention 밖이면 명시적 OUT_OF_RANGE와 snapshot URL 반환
```

전체 순서를 보장할 필요가 없는 경우도 있다. partition별 순서만 보장한다면 cursor도 partition 단위여야 한다. 10분 retention인 live feed에 24시간 뒤 reconnect한 client를 처음부터 재생시키는 대신, "snapshot을 다시 받고 새 feed를 구독"하게 하는 편이 낫다. 중요한 것은 성공 응답처럼 보이는 조용한 누락을 만들지 않는 것이다.

### 4) cancellation과 deadline은 수신 방향까지 연결해야 한다

client가 페이지를 닫았는데 server의 fan-out worker, DB cursor, 외부 API 호출이 계속 돈다면 네트워크만 끊긴 것이지 작업은 끝나지 않았다. gRPC context cancellation을 business loop가 관찰하고, blocking queue와 downstream request에도 deadline을 전달해야 한다. 전체 stream lifetime 30분, idle timeout 60초, 한 번의 downstream fetch 2초처럼 시간 예산을 계층별로 나누되, child deadline의 합이 parent를 넘지 않게 한다.

배포도 같은 문제다. 새 pod가 올라왔다고 이전 pod를 바로 종료하면 수천 stream이 동시에 reconnect해 dependency를 두드린다. readiness에서 새 연결을 먼저 받고, SIGTERM 뒤에는 신규 subscribe를 거절하며, 최대 30~120초의 drain window 동안 기존 stream에 reconnect hint 또는 retry-after를 보낸다. drain이 끝나지 않은 stream을 무한히 기다리는 것은 다른 장애를 만드는 선택이므로, deadline 이후에는 명시적으로 종료하고 jittered reconnect를 유도해야 한다.

## 실무 적용

### 1) stream budget을 코드 전의 표로 고정한다

첫 streaming endpoint는 아래처럼 한 장의 budget sheet를 작성하는 것부터 시작한다. 예시 수치는 서비스의 payload와 동시 접속에 맞게 다시 계산해야 한다.

| 항목 | 시작 기준 예시 | 판단 이유 |
| --- | --- | --- |
| 최대 message size | 64 KiB, 초과하면 object storage reference 사용 | 큰 payload가 per-stream buffer를 독점하지 않게 함 |
| 최대 buffered bytes | stream당 512 KiB | 2,000 active stream에서 payload 예산 약 1 GiB |
| 최대 in-flight messages | 128 | 작은 메시지 burst를 bytes 상한과 함께 제어 |
| send stall | p95 2초, 10초 초과 시 종료 후보 | 느린 peer와 일시 network jitter 분리 |
| idle timeout | 60초~5분, use case별 명시 | 유령 연결·누락 heartbeat 정리 |
| reconnect | exponential backoff + 10~30% jitter | outage 뒤 재접속 동기화 방지 |
| replay window | 10분 또는 10만 event | 저장 비용과 사용자 재개 요구의 계약 |

이 표는 library option의 복사본이 아니다. 64 KiB를 넘는 response를 허용해야 한다면 왜 stream으로 보내는지, chunking과 checksum을 누가 책임지는지까지 결정해야 한다. 대용량과 높은 정확성이 동시에 필요하면 streaming RPC 하나에 모든 것을 넣기보다, metadata/control stream과 object storage data path를 분리하는 편이 운영에 유리하다.

### 2) fan-out은 subscriber 수가 늘어날수록 payload 복제를 줄인다

topic의 새 이벤트를 모든 연결의 Go channel이나 JVM queue에 즉시 넣는 구현은 초기에는 간단하다. 하지만 1,000개의 subscriber에 4 KiB event를 복제하면 한 이벤트마다 4 MiB 이상이 된다. 생산자의 burst가 초당 500개면 transport가 막힌 몇 초 만에 복제 backlog가 GB 단위로 커질 수 있다.

그 대신 topic별 shared log 또는 ring buffer와 subscriber cursor를 두고, 각 stream은 자기 position만 가진다. 최신 상태라면 key별 마지막 값만 남기는 coalescing map도 가능하다. 단, shared buffer는 가장 느린 subscriber가 모든 retention을 붙잡지 않게 최소 cursor, TTL, laggard eviction을 둬야 한다. 예를 들어 lag가 2분 또는 50,000 event를 넘은 stream은 `RESOURCE_EXHAUSTED`가 아니라 "재동기화 필요"라는 application-level reason과 snapshot 경로를 받고 종료하는 편이 재시도 폭주를 줄인다.

### 3) 관측은 throughput보다 막힌 위치를 알려야 한다

dashboard에 `messages_sent_total`만 있으면 서버가 열심히 보내는지밖에 알 수 없다. 다음 지표를 stream type·tenant tier·endpoint별로 분리한다.

- `stream_buffered_bytes`와 `stream_buffered_messages`: p50이 아니라 p95/p99 및 상한 초과 stream 수
- `grpc_send_stall_seconds`: `Send` 또는 write가 막힌 시간 분포
- `consumer_ack_lag_seconds`와 `cursor_distance`: transport는 받았지만 업무 처리가 늦은 경우 식별
- `stream_terminated_total{reason}`: client_cancel, deadline, slow_consumer, deploy_drain, server_error를 구분
- `resume_total`, `resume_gap_total`, `dedup_drop_total`: 재연결 품질과 retention 부족을 확인
- process RSS, GC pause, open connections: endpoint 처리량과 resource saturation을 연결

시작 alert는 간단하게 둘 수 있다. buffered bytes가 5분 동안 예산의 80% 이상이거나, slow-consumer 종료가 전체 종료의 1%를 넘거나, resume gap이 하루 0.1%를 넘으면 payload·retention·consumer 성능을 조사한다. 단일 VIP consumer나 결제 상태 누락처럼 업무 영향이 큰 stream은 비율 기준을 쓰지 않고 즉시 page 또는 차단으로 올린다.

## 트레이드오프/주의점

1. **buffer를 키우면 짧은 burst는 흡수하지만 장애 발견은 늦어진다.** 메모리 상한을 먼저 정하고, queue 증가는 throughput이 아니라 부채로 본다.
2. **drop은 비용을 줄이지만 API 의미를 바꾼다.** drop policy, gap indicator, snapshot/replay 경로를 client contract와 SDK에 함께 넣어야 한다.
3. **application ACK는 정확성을 높이지만 state 저장과 재처리 비용을 만든다.** live UI처럼 snapshot으로 회복 가능한 흐름에는 과도한 exactly-once를 강제하지 않는다.
4. **긴 deadline은 사용자 경험을 보장하지 않는다.** 죽은 연결·stalled downstream이 오래 resource를 점유할 수 있으므로 idle·send stall·parent deadline을 분리한다.
5. **streaming은 polling을 제거하지 않는다.** 연결 제한, proxy timeout, mobile background 제약 때문에 일부 client는 snapshot + polling fallback이 더 정직할 수 있다.

## 체크리스트 또는 연습

### 출시 전 체크리스트

- [ ] event별로 순서·누락·중복·drop 허용 여부와 재개 방식이 문서화되어 있다.
- [ ] stream당 message size, buffered bytes/messages, send stall, idle/overall deadline의 상한이 있다.
- [ ] consumer cancellation이 queue, DB cursor, 외부 호출까지 전파되는 통합 테스트가 있다.
- [ ] reconnect는 jitter를 사용하며, retention 밖 cursor에 대해 snapshot 또는 명시적 gap 응답을 준다.
- [ ] slow consumer 종료와 deploy drain이 `reason` label 및 client-visible code로 구분된다.
- [ ] burst와 느린 consumer를 함께 넣은 부하 시험에서 RSS·GC·p99·resume gap을 baseline과 비교했다.

### 연습: 가격 feed의 역압 정책 고르기

1초에 20회 갱신되는 가격 feed와, 결제 상태 이벤트 stream을 분리해 보자. 가격 feed에는 종목별 최신 값 coalescing과 30초 idle timeout을, 결제에는 durable event ID·ACK·7일 replay를 둬야 하는 이유를 적는다. 이어서 10,000개 client 중 5%가 10초 이상 읽지 않을 때 stream당 256 KiB budget이 총 메모리에 어떤 영향을 주는지 계산한다. 마지막으로 배포 drain 중 새 연결·기존 연결·cursor 재개가 어떤 순서로 일어나야 reconnect storm을 피하는지 runbook으로 작성해 본다.

## 마무리

gRPC streaming의 핵심은 오래 연결하는 기술이 아니라 속도가 다른 두 시스템 사이에 상한과 복구 방법을 두는 일이다. transport 흐름 제어만 믿지 말고, application queue·event 의미·cursor·cancellation·관측을 하나의 계약으로 설계하자. 그 계약이 있어야 처리량을 높여도 느린 소비자 한 명이 전체 서비스를 느리게 만들지 않는다.
