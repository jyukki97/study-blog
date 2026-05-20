---
title: "백엔드 커리큘럼 심화: Transactional Outbox + CDC, 이중 쓰기 없이 이벤트를 안전하게 내보내는 법"
date: 2026-04-28
draft: false
topic: "Distributed Systems"
tags: ["Transactional Outbox", "CDC", "Dual Write", "Debezium", "Event-Driven Architecture"]
categories: ["Backend Deep Dive"]
description: "DB 트랜잭션과 메시지 발행을 따로 처리할 때 생기는 이중 쓰기 문제를, Transactional Outbox와 CDC 조합으로 어떻게 줄일지 실무 기준과 숫자로 정리합니다."
module: "backend-distributed"
study_order: 1182
---

이벤트 기반 아키텍처를 도입한 팀이 가장 자주 부딪히는 문제 중 하나는 "DB에는 저장됐는데 메시지는 안 나갔다" 혹은 그 반대입니다. 주문은 생성됐는데 결제 이벤트가 안 나가고, 포인트 차감은 반영됐는데 정산 이벤트는 유실되면, 장애는 단순 재시도로 끝나지 않고 비즈니스 정합성 문제로 번집니다.

이 문제를 흔히 "이중 쓰기(dual write)"라고 부릅니다. 실무에서 중요한 건 이론적으로 완벽한 exactly-once를 좇는 것이 아니라, **실패 지점을 좁히고 재처리 경로를 명확하게 만드는 것**입니다. Transactional Outbox와 CDC(Change Data Capture)는 바로 그 목적에 가장 많이 쓰이는 조합입니다. 이 글에서는 [분산 트랜잭션](/learning/deep-dive/deep-dive-distributed-transactions/), [Kafka 기본](/learning/deep-dive/deep-dive-kafka-foundations/), [트래픽 컷오버와 데이터 마이그레이션](/learning/deep-dive/deep-dive-traffic-cutover-migration/)에서 배운 내용을 실제 운영 설계로 묶어 봅니다.

## 이 글에서 얻는 것

- 왜 DB 저장과 메시지 발행을 한 요청 안에서 따로 처리하면 사고가 나는지 설명할 수 있습니다.
- Polling 기반 Outbox와 CDC 기반 Relay 중 무엇을 선택할지, **트래픽·운영 복잡도·장애 복구 기준**으로 판단할 수 있습니다.
- 멱등 소비, 순서 보장, backlog 모니터링, 재처리 보존 기간까지 포함한 **실무 운영 기준선**을 잡을 수 있습니다.

## 핵심 개념/이슈

### 1) Transactional Outbox의 본질은 "메시지 발행"이 아니라 "의도 기록"이다

핵심 트랜잭션 안에서 해야 할 일은 브로커 전송 자체가 아니라, **이 비즈니스 변경에 대응하는 이벤트를 나중에 반드시 내보내야 한다는 사실을 같은 DB 커밋에 묶어 기록하는 것**입니다. 보통 `orders` 같은 도메인 테이블을 저장할 때 `outbox_events` 테이블에도 한 줄을 같이 넣습니다.

이렇게 하면 애플리케이션 프로세스가 커밋 직후 죽더라도 이벤트 의도가 DB 안에 남습니다. 반대로 "저장 성공 후 Kafka publish"처럼 분리하면, 앱 재시작이나 네트워크 타임아웃 한 번으로도 정합성이 깨집니다. 이 구조는 [Usage Metering·Quota·청구 정합성](/learning/deep-dive/deep-dive-usage-metering-quota-billing-consistency/)처럼 금액·정산이 걸린 도메인에서 특히 중요합니다.

### 2) Polling Relay와 CDC Relay는 처리량보다 운영 모델 차이로 고르는 편이 맞다

많은 팀이 먼저 묻는 질문은 "Polling이 빠른가, CDC가 빠른가"입니다. 그런데 실무에서는 보통 아래 기준이 더 중요합니다.

- **초기 단계, 초당 수십~수백 건**이면 Polling Outbox로도 충분한 경우가 많습니다.
- **초당 수백~수천 건**, 다수 컨슈머, 여러 서비스 공통 파이프라인이 필요하면 CDC가 운영상 유리해집니다.
- 애플리케이션 코드 안에 Relay 책임을 두고 싶지 않거나, DB 변경 로그를 표준화된 방식으로 내보내고 싶다면 CDC 쪽이 낫습니다.

제가 권하는 출발 기준은 이렇습니다.

- 이벤트 발행량이 **500 msg/s 이하**, 서비스 수 1~2개, 운영 인원 제한적이면 Polling부터 시작
- 이벤트 발행량이 **1,000 msg/s 이상**이거나 멀티 서비스 공유 파이프라인이 필요하면 CDC 우선 검토
- 배치 크기는 Polling 기준 **100~500건**, poll interval은 **100~500ms**에서 시작
- Outbox backlog age p95가 **60초 초과**하거나 pending row가 **10만 건 이상** 쌓이면 구조 재검토

즉 성능 숫자보다 **누가 Relay를 운영하고 장애를 복구할 것인가**를 먼저 봐야 합니다.

### 3) Outbox가 있다고 순서와 멱등성이 자동으로 해결되지는 않는다

Outbox는 유실 가능성을 줄여주지만, 중복 발행과 순서 문제는 여전히 남습니다. Relay가 publish 후 ack 기록 전에 죽으면 같은 이벤트를 다시 보낼 수 있습니다. 그래서 컨슈머는 결국 **at-least-once를 전제로 멱등 처리**를 해야 합니다. 이 부분은 [Kafka 전달 보장 면접 Q&A](/learning/qna/kafka-delivery-guarantee-interview-qna/)와 연결됩니다.

실무 기준은 보통 아래처럼 둡니다.

- 이벤트 키는 `aggregate_id + event_type + version` 또는 별도 `event_id`로 고정
- 컨슈머 dedup 보존 기간은 `최대 재시도 구간 + 최대 지연 구간`보다 길게, 보통 **24시간~7일**
- 같은 aggregate 순서가 중요하면 파티션 키를 aggregate 기준으로 고정
- 재처리 중복 허용 여부를 도메인별로 분리, 예를 들어 이메일 발송은 중복 방지, 분석 로그는 중복 허용

"Kafka idempotent producer를 켰으니 끝"은 위험한 착각입니다. 브로커 전송 중복만 줄일 뿐, **비즈니스 효과의 중복**까지 막아주지는 않습니다.

### 4) CDC를 붙이면 애플리케이션은 단순해지지만, DB 로그 운영이 새 책임으로 들어온다

Debezium 같은 CDC를 쓰면 Relay 애플리케이션을 따로 덜 작성해도 됩니다. 대신 binlog/WAL 보존, schema change 호환성, connector 장애 복구가 새 운영 항목이 됩니다. 특히 아래 두 가지를 가볍게 보면 나중에 크게 흔들립니다.

1. **로그 보존 기간**: 장애 시 connector가 몇 시간 늦어져도 따라잡을 수 있어야 합니다. 최소 **예상 최대 복구 시간 x 2**를 기본값으로 잡는 편이 안전합니다.
2. **이벤트 스키마 진화**: payload에 도메인 엔티티 전체를 복사해 넣으면 컬럼 추가 하나가 하위 소비자 전체에 영향을 줄 수 있습니다.

그래서 CDC는 "코드가 줄어든다"보다 **운영 계층이 DB 로그와 스키마 계약 쪽으로 이동한다**고 이해하는 편이 정확합니다. 이벤트 계약 변화가 잦다면 [Schema Registry 호환성 운영 플레이북](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)도 같이 보는 게 좋습니다.

### 5) 운영에서 제일 먼저 봐야 할 것은 성공률보다 backlog와 age다

이벤트 파이프라인은 잠깐 성공해 보이다가도 backlog가 쌓이면 뒤늦게 사고가 납니다. 대시보드는 최소 아래 지표를 같이 봐야 합니다.

- `outbox_pending_count`
- `oldest_outbox_age_seconds`
- `publish_success_rate`
- `publish_retry_rate`
- `consumer_dedup_hit_rate`
- `cdc_lag_seconds` 또는 relay lag

특히 `oldest_outbox_age_seconds`는 사용자 영향과 가장 직접적으로 연결됩니다. 주문 생성은 성공했는데 후속 알림·정산·적재가 20분 늦게 반영되면, 사용자는 결국 "서비스가 이상하다"고 느끼기 때문입니다.

## 실무 적용

### 1) 어떤 경우에 Outbox를 먼저 도입할까

아래 조건 중 2개 이상이면 저는 Outbox를 우선 추천합니다.

- DB 변경과 메시지 발행이 한 요청 안에 같이 일어난다.
- 이벤트 유실 시 수동 복구 비용이 **30분 이상** 걸린다.
- 재처리 대상이 금액, 재고, 정산, 권한처럼 민감하다.
- 장애 후 "어디까지 반영됐는지"를 DB만으로 설명할 수 없다.

반대로 캐시 무효화, 분석용 fire-and-forget 로그처럼 일부 유실을 허용할 수 있는 영역까지 무조건 Outbox로 넣으면 운영이 과해질 수 있습니다.

### 2) Polling과 CDC 선택 기준

- **Polling 추천**
  - 단일 서비스 또는 작은 도메인
  - 초당 500건 이하
  - 운영팀이 DB 로그 인프라보다 앱 배포에 익숙함
  - 장애 시 애플리케이션 레벨에서 빠르게 패치 가능
- **CDC 추천**
  - 여러 서비스가 공통 이벤트 버스를 사용
  - 초당 1,000건 이상 또는 burst가 큼
  - Debezium/Kafka Connect 운영 경험이 있음
  - 스키마 계약과 데이터 플랫폼 연결이 중요함

결정 우선순위는 **정합성 보호 > 복구 용이성 > 처리량 최적화**로 두는 편이 안전합니다.

### 3) 운영 런북 최소 기준

- Outbox row 생성 실패는 도메인 쓰기 자체를 실패로 간주한다.
- pending age가 **5분 초과**하면 알람, **15분 초과**면 사람 개입.
- Relay 재시도는 지수 백오프를 쓰되, poison event는 무한 재시도 대신 격리 큐나 별도 상태로 분리한다.
- 배포 전에는 relay 중단 상태에서 backlog가 얼마나 쌓이는지 **30분 이상** 드릴해 본다.
- 파티션/인덱스 없이 단일 거대 outbox 테이블을 오래 유지하지 않는다. 일 단위 또는 상태 기준 정리 전략을 반드시 둔다.

## 트레이드오프/주의점

1. **Outbox는 복잡도를 없애는 게 아니라 위치를 바꿉니다.** 애플리케이션 로직에서 빠진 복잡도가 relay, backlog 운영, 재처리 도구로 이동합니다.
2. **CDC는 만능이 아닙니다.** DB 로그 보존과 connector 운영이 약하면, 오히려 장애 원인이 더 깊은 계층으로 숨어버립니다.
3. **Exactly-once 집착은 비용이 큽니다.** 대부분의 실무는 at-least-once + 멱등 소비 + 재처리 도구 조합이 더 현실적입니다.
4. **Outbox payload를 과하게 크게 만들면 장기 운영이 무거워집니다.** 필요한 필드만 담고, 상세 조회는 소비자가 원본 저장소를 보게 하는 편이 나을 때가 많습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 도메인 쓰기와 outbox insert가 같은 트랜잭션에 묶여 있다.
- [ ] 컨슈머가 event_id 또는 business key 기준 멱등 처리를 한다.
- [ ] backlog count와 oldest age를 별도 알람으로 감시한다.
- [ ] Polling인지 CDC인지 선택 근거가 처리량만이 아니라 운영 책임 기준으로 문서화돼 있다.
- [ ] 재처리, 격리, 보존 기간 정책이 런북에 적혀 있다.

### 연습 과제

1. 현재 서비스에서 "DB 저장 후 외부 발행"이 일어나는 경로를 3개 적고, 유실 시 복구 시간이 얼마나 걸릴지 계산해 보세요.
2. Outbox 테이블 스키마를 `event_id`, `aggregate_id`, `event_type`, `payload`, `created_at`, `published_at`, `status` 기준으로 초안 작성해 보세요.
3. Polling 방식으로 시작할 경우, 배치 크기·poll interval·알람 임계치를 숫자로 써 보세요.

## 관련 글

- [분산 트랜잭션: 2PC에서 SAGA까지](/learning/deep-dive/deep-dive-distributed-transactions/)
- [Kafka 기본: 토픽, 파티션, Consumer Group](/learning/deep-dive/deep-dive-kafka-foundations/)
- [트래픽 컷오버 & 데이터 마이그레이션 전략](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
- [Usage Metering·Quota·청구 정합성 설계](/learning/deep-dive/deep-dive-usage-metering-quota-billing-consistency/)
- [Kafka 전달 보장 면접 Q&A](/learning/qna/kafka-delivery-guarantee-interview-qna/)
