---
title: "백엔드 커리큘럼 심화: Event Fan-out Amplification Budget, 이벤트 한 건이 시스템 전체를 밀어내지 않게 하는 법"
date: 2026-10-25
draft: false
topic: "Backend Messaging"
tags: ["Event-Driven Architecture", "Fan-out", "Message Queue", "Backpressure", "Notification", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "한 건의 업무 이벤트가 수백~수만 건의 알림·색인·웹훅·분석 작업으로 증폭될 때, fan-out 예산·집계·우선순위·관측 기준으로 하류를 보호하는 방법을 정리합니다."
module: "backend-messaging"
study_order: 1564
key_takeaways:
  - "fan-out의 위험은 이벤트 수가 아니라 이벤트당 파생 작업 수와 재시도·중복이 곱해지는 증폭률에 있다."
  - "fan-out budget은 업무 중요도, 수신자 수, 하류 여유, 지연 허용치를 함께 결정하는 계약이다."
  - "대량 이벤트는 즉시 개별 delivery로 보내기보다 aggregation window와 bulk lane을 명시해야 정상 흐름을 보호할 수 있다."
operator_checklist:
  - "원본 event마다 audience estimate, priority, dedup key, 최대 파생 작업 수, 만료 시각을 기록한다."
  - "fan-out planner와 delivery worker를 분리하고 retry·bulk·사용자 가시 작업의 동시성 예산을 각각 둔다."
  - "예산 초과는 조용한 drop이 아니라 digest 전환, 지연, 승인 대기, DLQ 중 어떤 결과인지 업무별로 선언한다."
learning_refs:
  - title: "Transactional Outbox와 CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "원본 업무 변경과 fan-out 요청을 빠뜨리지 않고 남기는 출발점입니다."
  - title: "Notification Preference와 Delivery Pipeline"
    href: "/learning/deep-dive/deep-dive-notification-preference-delivery-pipeline-playbook/"
    description: "수신자별 선호·quiet hours·중복 방지와 fan-out을 연결합니다."
  - title: "Workload-Aware Queue Partitioning"
    href: "/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/"
    description: "대량 fan-out이 일반 작업을 밀어내지 않도록 lane을 나누는 기준입니다."
---

이벤트 기반 설계에서 `order_paid`, `comment_created`, `policy_changed` 같은 이름은 가볍게 보입니다. 그러나 이벤트 하나가 사용자 알림, 담당자 알림, 검색 색인, 추천 피처, 분석 적재, 파트너 웹훅으로 갈라지는 순간 그 한 건은 더 이상 한 건이 아닙니다. 구독자 2만 명인 프로젝트에 권한 정책을 잘못 재적용하거나, 10만 명에게 보이는 피드를 재계산하면 작은 producer 오류가 짧은 시간에 수십만 개의 작업을 만들 수 있습니다.

여기서 중요한 수치는 원본 event rate만이 아닙니다. `원본 이벤트 수 × 이벤트당 대상 수 × 채널 수 × 재시도 계수`가 실제 하류 부하를 만듭니다. 재시도가 평균 1.2회이고 이벤트 하나가 3,000명에게 두 채널로 전송되면 최대 7,200회의 외부 호출이 됩니다. 이 증폭을 보지 않고 큐 backlog만 보면, 장애가 난 뒤에야 "평소와 같은 이벤트가 왜 전체 워커를 막았나"를 묻게 됩니다.

이 글은 [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [Notification Preference와 Delivery Pipeline](/learning/deep-dive/deep-dive-notification-preference-delivery-pipeline-playbook/), [Workload-Aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/), [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)를 fan-out 관점으로 연결합니다. 목표는 대량 발송을 무조건 피하는 것이 아니라, **어떤 이벤트가 어느 정도까지 증폭돼도 되는지 사전에 숫자로 약속하는 것**입니다.

## 이 글에서 얻는 것

- 원본 이벤트 수보다 파생 작업 수와 재시도 계수를 먼저 봐야 하는 이유를 이해합니다.
- 이벤트별 audience estimate, 우선순위, 만료, deduplication, fan-out cap을 하나의 계약으로 정의할 수 있습니다.
- 개별 delivery, digest, bulk lane, 지연 처리 중 무엇을 고를지 사용자 영향과 하류 예산으로 판단할 수 있습니다.
- fan-out 장애를 "큐가 느리다"가 아니라 증폭률·대상 분포·취소 실패로 분해해 관측할 수 있습니다.

## 핵심 개념/이슈

### 1) fan-out은 publish 횟수가 아니라 파생 효과의 그래프다

메시지 브로커에 이벤트를 한 번 publish했다고 해서 비용도 한 번인 것은 아닙니다.

```text
project.member_added
  ├─ 권한 캐시 무효화                 1건
  ├─ activity feed materialization  1건
  ├─ 멤버 4,000명의 in-app 배지 갱신 4,000건
  ├─ 관리자 이메일                    3건
  └─ 파트너 webhook                   2건 × 재시도
```

캐시 무효화나 색인 갱신은 업무적으로 중요하지만 수신자 수에 비례하지 않습니다. 반면 badge, email, webhook은 audience와 외부 상태에 따라 급격히 불어납니다. 같은 `project.member_added`라도 프로젝트마다 멤버 수가 4명인지 40만 명인지에 따라 완전히 다른 workload입니다. topic 이름만으로 큐와 retry 정책을 고정하면 큰 테넌트의 일회성 작업이 공유 자원을 독점합니다.

그러므로 최소한 아래 세 값을 분리해 남겨야 합니다.

| 값 | 의미 | 운영 질문 |
| --- | --- | --- |
| `audience_estimate` | 대상 수를 계산한 시점의 예상 수신자 | 이번 이벤트가 얼마나 많은 파생 작업을 만들 수 있는가? |
| `delivery_attempts` | 실제 생성·재시도한 delivery 횟수 | 증폭이 계획한 범위 안에 있었는가? |
| `effective_recipients` | preference·dedup 뒤 실제 대상 | 사용자에게 남긴 외부 효과는 얼마인가? |

`audience_estimate=100,000`인데 `effective_recipients=2,000`이라면 무조건 실패는 아닙니다. digest, 수신 거부, 중복 병합이 정상적으로 동작한 결과일 수 있습니다. 반대로 원본 event는 초당 20개뿐인데 `delivery_attempts`가 초당 10만 개로 뛰면 producer metric만 보아서는 원인을 놓칩니다.

### 2) 재시도와 중복은 fan-out을 두 번째로 증폭시킨다

대량 fan-out에서 흔한 사고는 대상 계산을 한 번 잘못한 경우만이 아닙니다. planner가 timeout 뒤 같은 batch를 다시 만들고, worker가 provider timeout 뒤 delivery를 재시도하고, consumer rebalance가 발생해 같은 메시지를 다시 받으면 원본 event가 여러 단계에서 복제됩니다. provider가 504를 반환했지만 실제로는 일부를 수락했을 수도 있어, "실패했으니 모두 다시 보낸다"는 대응은 사용자에게 중복 알림 폭탄이 됩니다.

그래서 키는 계층별로 달라야 합니다. 원본 업무 이벤트는 `event_id`, 대상 계산 결과는 `fanout_plan_id`, 개별 수신 효과는 `event_id + recipient_id + channel + policy_version`처럼 구분합니다. planner의 재실행은 같은 plan을 재사용하거나 version을 명시적으로 올리고, worker 재시도는 같은 delivery id를 provider idempotency key로 보냅니다. [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)에서 말한 "응답을 받지 못한 호출"과 "호출이 실행되지 않은 것"의 차이를 fan-out 전체에 적용해야 합니다.

### 3) fan-out budget은 거절 규칙만이 아니라 대체 경로다

fan-out cap을 두면 "수신자 1,000명을 넘으면 버린다"로 오해하기 쉽습니다. 보안 경고, 결제 실패, 법적 공지처럼 잃으면 안 되는 이벤트에 무조건 drop은 맞지 않습니다. 예산은 어떤 일을 할지뿐 아니라 초과했을 때 **무엇으로 바꿀지**를 정하는 계약입니다.

| 이벤트 등급 | 즉시 개별 delivery | 초과 시 경로 | 만료/중단 기준 |
| --- | ---: | --- | --- |
| 보안·결제 | 1,000건/이벤트 | priority lane과 채널 fallback | 5분 이내 처리 못 하면 on-call 알림 |
| 사용자 작업 결과 | 500건/이벤트 | in-app 우선, 이메일은 10분 window로 병합 | 30분 뒤에는 상태 조회 링크만 유지 |
| 활동·피드 갱신 | 5,000건/이벤트 | recipient별 batch 또는 read-time 계산 | 2시간이 지나면 stale rebuild로 전환 |
| 마케팅·추천 | 10,000건/캠페인 slice | digest/bulk lane, 승인된 분할 발송 | frequency cap 위반 시 즉시 중단 |

숫자는 출발점이며 provider quota와 서비스 SLO에 맞춰 조정해야 합니다. 핵심은 큰 숫자까지 허용하는 것이 아니라, 사용자 가시성·손실 비용·하류 민감도를 먼저 정렬하는 것입니다. 같은 5,000건이라도 password reset 후속 알림과 추천 푸시는 같은 lane에 있으면 안 됩니다.

## 실무 적용

### 1) producer가 확정해야 할 것은 event payload가 아니라 fan-out 의도다

producer가 `comment_created`만 발행하고 consumer가 각자 수신자를 찾으면, 어떤 consumer가 몇 명에게 무엇을 보냈는지 통제하기 어렵습니다. 모든 대상 목록을 event에 싣자는 뜻은 아닙니다. 대신 producer 또는 전담 planner가 아래 의도를 남겨야 합니다.

```yaml
event_id: evt_01J...
event_type: comment_created
tenant_id: team_42
priority: user_visible
audience_selector: thread_watchers_v3
audience_estimate: 860
fanout_cap: 1000
aggregation_window_seconds: 120
expires_at: 2026-10-25T10:36:00+09:00
dedup_scope: event-recipient-channel
overflow_action: aggregate_then_in_app
```

`audience_selector`는 저장 시점의 대상 목록이 아니라 재현 가능한 선택 규칙일 수 있습니다. 권한이나 구독 상태가 빠르게 바뀌는 도메인이라면 planner 시점의 recipient snapshot version도 같이 남겨야 합니다. 그래야 "누가 왜 알림을 받았나"와 "왜 받지 않았나"를 설명할 수 있습니다. privacy 삭제나 block 관계가 있는 서비스에서는 delivery 직전의 최종 eligibility check도 필요합니다.

### 2) planner, bulk lane, delivery를 분리한다

안전한 처리 흐름은 한 worker가 수신자를 찾고 곧바로 수만 번 HTTP를 호출하는 구조가 아닙니다.

```text
business transaction
  -> outbox(event intent)
  -> fan-out planner (estimate, policy, recipient snapshot)
  -> immediate / aggregate / bulk / reject lane
  -> delivery worker (preference, final eligibility, provider call)
  -> delivery ledger + metrics
```

planner는 대상 수와 정책을 판단하지만 외부 side effect를 내지 않습니다. budget을 넘을 때도 개별 발송을 시작한 뒤 멈추는 대신 bulk 또는 aggregate lane으로 진입시키기 쉽습니다. delivery worker는 채널별 provider limit과 사용자 선호를 다시 확인합니다. 이 분리는 [Workload-Aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)의 `fast/heavy/retry` lane을 fan-out에 적용한 것입니다.

공유 워커가 80개라면 immediate lane 40, normal lane 20, bulk lane 12, retry lane 8처럼 상한을 둘 수 있습니다. bulk backlog가 커졌다고 retry나 security lane의 슬롯을 빼앗지 않게 하는 것이 더 중요합니다. provider 429, DB CPU 75% 초과, queue oldest age 증가 중 하나가 발생하면 bulk concurrency를 반으로 낮추는 하류 보호 규칙도 둡니다.

### 3) batch는 비용 최적화가 아니라 사용자 의미를 보존하는 방식이어야 한다

시간 window를 두고 "A님 외 12명이 댓글을 남겼습니다"로 합치면 호출 수는 줄어듭니다. 그러나 security alert나 주문 상태처럼 개별 시각과 내용이 중요한 메시지까지 합치면 의미를 잃습니다. batch 조건에는 `같은 recipient`, `같은 의미의 event family`, `같은 policy version`, `허용된 시간 window`가 모두 들어가야 합니다.

활동 알림은 수신자별 2분 window와 최대 20건으로 시작할 수 있습니다. 20건이 넘으면 새 batch로 만들고, batch가 10분을 넘겨도 flush하지 못하면 in-app delivery로 우회합니다. 반면 결제 실패 이벤트는 0초 window로 두고, provider 장애 시 이메일 재시도와 인앱 배지를 병렬로 기록하는 편이 낫습니다. 모든 이벤트에 같은 5분 batching을 두는 것은 편하지만 업무 중요도를 지운다는 점에서 나쁜 기본값입니다.

### 4) 관측은 queue depth보다 amplification ratio에서 시작한다

대시보드에 최소한 아래 비율을 함께 올리세요.

- `planned_deliveries / source_events`: 계획 단계 증폭률
- `attempted_deliveries / planned_deliveries`: 재시도·중복을 포함한 실행 증폭률
- `effective_deliveries / attempted_deliveries`: 선호·dedup·실패 뒤 실제 외부 효과 비율
- event type·tenant·channel별 p95 planning time, oldest age, overflow count

기준선에서 `attempted/planned`가 1.05였다가 1.35로 오르면, 성공률이 높아도 retry storm이나 duplicate plan을 먼저 의심해야 합니다. 특정 tenant의 planned delivery가 전체의 25%를 넘거나 bulk lane이 전체 실행 슬롯의 20%를 넘는 것도 조사 신호로 삼을 수 있습니다. 절대 backlog 하나가 아니라 원본 대비 증폭의 변화량을 경보 기준으로 두어야 합니다.

## 트레이드오프/주의점

강한 cap은 하류를 보호하지만 중요한 정보를 늦출 수 있습니다. 초과 정책을 `drop` 하나로 통일하지 말고, 업무별로 delay·digest·in-app fallback·manual approval을 선택해야 합니다. overflow 자체도 사용자에게 보여야 하는지, 운영자에게만 알려야 하는지 합의해야 합니다.

recipient snapshot은 재현성을 주지만 오래 들고 있으면 권한·개인정보 상태가 낡습니다. snapshot에는 필요한 식별자와 policy version만 넣고, 실제 전송 전에는 차단·탈퇴·삭제·quiet hours 같은 즉시성 규칙을 다시 평가하세요. 반대로 모든 것을 전송 시점에만 계산하면 수신 대상이 시간에 따라 흔들려 사고 분석이 어려워집니다.

bulk lane을 별도로 둔다고 무한 backlog를 보관해도 되는 것은 아닙니다. 만료된 추천이나 오래된 피드 알림은 늦게 보내는 것보다 보내지 않는 것이 낫습니다. 각 event family에 TTL과 stale 전환 규칙을 두고, backlog를 비울 때도 최신 상태로 재계산할지 기존 계획을 끝낼지 결정해야 합니다.

## 체크리스트 또는 연습

- [ ] 원본 event, fan-out plan, 개별 delivery에 서로 다른 ID와 dedup scope가 있다.
- [ ] event type별로 audience estimate, 최대 fan-out, overflow action, TTL, 우선순위가 문서화돼 있다.
- [ ] planner는 외부 호출을 하지 않고 immediate·bulk·retry lane은 별도 동시성 상한을 가진다.
- [ ] 수신자 선택 규칙과 snapshot version, 전송 직전 eligibility check의 책임이 분리돼 있다.
- [ ] `attempted/planned` 증폭률과 tenant·channel별 overflow를 대시보드에서 본다.
- [ ] provider 429, DB 포화, queue age 악화 때 bulk를 감속하거나 중단하는 규칙이 있다.
- [ ] security·transactional 이벤트는 marketing·digest와 같은 cap 또는 batch 정책을 공유하지 않는다.

연습으로 최근의 "한 번의 변경이 많은 사용자에게 알려진" 이벤트 하나를 고르세요. 원본 event 100건이 들어왔을 때 대상 계산, 채널 수, 재시도까지 포함해 최악의 delivery 수를 계산합니다. 그 수가 평상시 분당 provider quota의 20%를 넘는다면 planner와 bulk lane이 필요할 가능성이 큽니다. 이어서 초과 시 사용자에게 어떤 경험을 제공할지 한 문장으로 적어 보세요. 그 문장이 없다면 cap은 아직 장애 차단 장치일 뿐 제품 정책은 아닙니다.

## 관련 글

- [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Notification Preference와 Delivery Pipeline](/learning/deep-dive/deep-dive-notification-preference-delivery-pipeline-playbook/)
- [Workload-Aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)
- [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)
