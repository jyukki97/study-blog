---
title: "백엔드 커리큘럼 심화: Kafka Log Compaction·Tombstone·키 수명주기 운영 플레이북"
date: 2026-08-31T10:06:00+09:00
lastmod: 2026-08-31T10:06:00+09:00
draft: false
topic: "Kafka"
tags: ["Kafka", "Log Compaction", "Tombstone", "Event-Driven Architecture", "Data Lifecycle", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "Kafka compacted topic을 단순한 저장 공간 절감 옵션으로 보지 않고, key 설계·tombstone 보존·consumer bootstrap·재처리·스키마 진화까지 포함한 상태 동기화 계약으로 운영하는 기준을 정리합니다."
module: "data-system"
study_order: 1503
summary: "Log compaction의 목표는 최신 레코드만 남기는 일이 아니라, 새 consumer가 현재 상태를 재구성할 수 있게 만드는 일이다. key가 업무 식별자를 안정적으로 표현하고 tombstone이 충분히 보존되며 bootstrap과 replay가 검증될 때만 compacted topic은 상태 배포 경로가 된다."
key_takeaways:
  - "Compaction은 key별 최신 레코드를 보장하는 백그라운드 정리 정책이지, 즉시 중복을 제거하거나 토픽 전체 순서를 보장하는 기능이 아니다."
  - "Tombstone은 삭제 이벤트가 아니라 key의 이전 상태를 무효화하는 상태 전이이며, 보존 시간이 짧으면 늦게 시작한 consumer가 삭제 사실을 놓칠 수 있다."
  - "업무 key를 바꾸는 migration은 새 key publish, 소비자 전환, 이전 key tombstone, 복구 검증의 순서를 가져야 한다."
  - "성공 지표는 disk 절감률보다 bootstrap 시간, stale state 검출률, tombstone 처리 지연, key별 상태 불일치율이다."
operator_checklist:
  - "각 compacted topic에 key의 업무 의미, null key 처리, tombstone 생성 주체, delete retention, owner를 문서화한다."
  - "새 consumer가 earliest offset부터 읽어 materialized state를 재구성하는 smoke test를 CI 또는 staging에 둔다."
  - "key 변경은 old-to-new mapping, dual publish 기간, 이전 key tombstone, rollback 기준을 하나의 migration runbook으로 묶는다."
  - "cleaner lag, tombstone age, bootstrap duration, state checksum mismatch를 별도 대시보드에서 관측한다."
learning_refs:
  - title: "Kafka 멱등·정렬 처리 전략"
    href: "/learning/deep-dive/deep-dive-kafka-idempotence-ordering/"
    description: "파티션 내 순서와 메시지 중복 범위를 먼저 정리합니다."
  - title: "이벤트 스키마 레지스트리와 호환성 운영"
    href: "/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/"
    description: "compacted topic의 값 스키마를 안전하게 진화시키는 배포 원칙입니다."
  - title: "Transactional Outbox와 CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "DB 상태 변경에서 Kafka 상태 레코드를 일관되게 발행하는 출발점입니다."
  - title: "Projection Lag와 Read Model Rebuild"
    href: "/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/"
    description: "재구성 가능한 상태와 읽기 모델 복구 절차를 연결합니다."
decision_guide:
  title: "어떤 데이터를 compacted topic으로 둘 것인가"
  intro: "판단 기준은 저장 공간이 아니라, 특정 key의 최신 상태를 여러 소비자가 독립적으로 복원해야 하는가입니다."
  cases:
    - badge: "우선 적용"
      title: "사용자 설정·상품 가시성·계정 상태처럼 최신 값 조회가 핵심이다"
      fit: "key별 최종 상태가 명확하고, 소비자가 늦게 합류해도 전체 event history보다 현재 상태만 얻으면 되는 경우입니다."
      watchouts: "삭제도 상태의 일부이므로 tombstone 생성과 보존을 값 publish와 같은 수준으로 관리해야 합니다."
      next_step: "key별 state checksum을 만들고 earliest bootstrap 결과를 기준 저장소와 비교합니다."
    - badge: "혼합 운영"
      title: "감사 이력과 현재 상태가 모두 필요하다"
      fit: "결제·정산·주문 같은 도메인처럼 변경 이력은 보존하면서 별도 소비자는 빠르게 최신 상태를 필요로 하는 경우입니다."
      watchouts: "단일 compacted topic을 audit log로 오해하면 과거 사실이 사라져 조사와 정산이 어려워집니다."
      next_step: "append-only event topic과 상태 topic을 분리하고 두 토픽의 source event를 연결합니다."
    - badge: "기본 보류"
      title: "key가 불안정하거나 값이 누적 의미를 가진다"
      fit: "로그, 클릭, metric, 결제 원장처럼 모든 레코드가 독립적인 사실이고 최신 한 건으로 축약할 수 없는 경우입니다."
      watchouts: "key를 임의로 고정하면 서로 다른 사실이 덮어써져 조용한 데이터 손실이 생길 수 있습니다."
      next_step: "먼저 aggregate와 상태 전이를 정의하고, 필요한 경우 별도 projection topic을 설계합니다."
---

Kafka의 `cleanup.policy=compact`는 흔히 저장 공간을 줄이는 옵션으로 소개됩니다. 하지만 운영에서 compacted topic의 진짜 용도는 디스크 절감이 아닙니다. 새 consumer가 오래된 이벤트를 전부 이해하지 않아도 **key별 현재 상태를 복구할 수 있게 만드는 상태 배포 경로**입니다. 이 전제가 빠지면 팀은 compacted topic에 감사 이력, 임시 이벤트, 불안정한 식별자를 섞어 넣고, 장애 뒤에 "토픽에는 데이터가 있는데 왜 삭제된 사용자가 다시 살아났지?" 같은 문제를 만납니다.

이 글은 [Kafka 멱등·정렬 처리 전략](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/), [이벤트 스키마 레지스트리와 호환성 운영](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/), [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [Projection Lag와 Read Model Rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)을 연결합니다. 앞선 글이 이벤트의 전달·호환성·읽기 모델 복구를 다뤘다면, 여기서는 **최신 상태만 남기는 토픽이 어떤 계약을 가져야 안전한지**를 다룹니다.

참고 자료:

- [Apache Kafka: Log Compaction](https://kafka.apache.org/documentation/#compaction)
- [Apache Kafka: Topic Configuration](https://kafka.apache.org/documentation/#topicconfigs)

## 이 글에서 얻는 것

- Log compaction이 보장하는 것과 보장하지 않는 것을 구분합니다.
- key, value, tombstone을 상태 머신 관점에서 설계하는 방법을 배웁니다.
- consumer bootstrap, key migration, 재처리에서 삭제 상태가 되살아나는 사고를 막는 기준을 얻습니다.
- compaction 설정을 storage 튜닝이 아니라 data correctness와 복구 시간의 운영 계약으로 측정합니다.

## 핵심 개념/이슈

### 1) Compaction은 즉시 정리가 아니라 "나중에 최신 상태를 남기는" 정책이다

compacted topic에서 Kafka는 같은 key를 가진 레코드 중 오래된 레코드를 cleaner가 나중에 제거할 수 있게 합니다. 중요한 단어는 **나중에**입니다. produce 직후에 과거 레코드가 사라지는 것도 아니고, consumer가 중복 레코드를 절대 보지 않는 것도 아닙니다. segment 크기, cleaner 처리량, `min.cleanable.dirty.ratio`, 브로커 부하에 따라 한 key의 과거 값이 꽤 오래 남을 수 있습니다.

따라서 consumer는 다음 두 규칙을 동시에 따라야 합니다.

1. 같은 key가 여러 번 와도 마지막 offset의 상태가 이긴다고 처리합니다.
2. 오래된 레코드가 남아 있다는 사실로 audit history가 보존된다고 판단하지 않습니다.

예를 들어 `customer-preference` 토픽에 `customerId=42`의 언어 설정이 `ko → en → ko`로 세 번 들어왔다면, compaction 뒤에는 마지막 `ko`만 남을 수 있습니다. 그러나 cleaner가 돌기 전에는 세 레코드를 모두 읽을 수 있고, 파티션이 다르면 서로 다른 key 사이의 시간 순서는 보장되지 않습니다. compaction은 데이터베이스의 unique constraint도, sync 호출의 deduplication도 아닙니다. producer 중복과 consumer 중복의 경계는 [Kafka 멱등·정렬 처리 전략](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)에서 정리한 것처럼 별도 방어선이 필요합니다.

| 질문 | compacted topic의 답 | 운영상 필요한 보완 |
| --- | --- | --- |
| 같은 key의 과거 값이 즉시 사라지는가 | 아니다 | consumer는 반복 레코드를 허용해야 한다 |
| 새 consumer가 최종 상태를 만들 수 있는가 | 가능하다 | key·tombstone·bootstrap 계약이 올바를 때만 가능 |
| 모든 과거 사실을 보존하는가 | 아니다 | audit event는 append-only topic 또는 원장에 둔다 |
| null value는 빈 상태인가 | 아니다 | 일반적으로 tombstone으로 해석되므로 별도 의미를 정해야 한다 |

### 2) key는 partitioning용 문자열이 아니라 상태의 신원이다

compaction은 key가 같다고 판단한 레코드를 하나의 상태 계열로 묶습니다. 그래서 key 선택은 "파티션을 고르게 나누는가"보다 먼저 **이 두 레코드는 실제로 같은 현재 상태를 표현하는가**를 묻는 일입니다. `orderId`는 주문 상태의 좋은 key가 될 수 있지만, 결제 승인 시도 하나하나를 표현하는 topic에 `orderId`를 쓰면 여러 시도가 서로 덮어쓸 수 있습니다. 그 경우 `paymentAttemptId`가 더 적합하거나, 애초에 compacted topic이 맞지 않을 수 있습니다.

좋은 key에는 네 가지 성질이 있습니다.

- **안정성**: 이메일·표시명처럼 바뀔 수 있는 값 대신 내부 ID나 명시적인 business key를 쓴다.
- **단일성**: 서로 다른 두 state가 같은 key로 합쳐지지 않는다.
- **해석 가능성**: consumer가 key만 보고 상태 범위와 소유 도메인을 알 수 있다.
- **수명 명시성**: 생성, 갱신, 삭제, 재활성화 때 같은 key를 계속 쓸지 문서화한다.

`tenantId:userId`처럼 복합 key를 만들 때도 delimiter 관습만 믿지 말고 canonical encoding을 정합니다. 숫자와 문자열 normalization, 대소문자, UUID format, tenant 이동 시 key 의미를 통일하지 않으면 같은 사람의 상태가 여러 key에 쌓입니다. [식별자 정규화와 보안](/learning/deep-dive/deep-dive-identifier-normalization-security-playbook/)에서 다룬 것처럼 표기 차이는 단순한 문자열 문제가 아니라 접근 범위와 데이터 병합 오류가 될 수 있습니다.

### 3) Tombstone은 "삭제 이벤트"가 아니라 최신 상태의 부정이다

Kafka에서 일반적으로 key는 있고 value가 `null`인 레코드는 tombstone입니다. compaction은 이 tombstone을 일정 기간 보존한 뒤 key의 이전 값과 tombstone을 함께 제거할 수 있습니다. 늦게 시작한 consumer가 이전 값을 읽은 뒤 tombstone도 읽어야 해당 key가 더 이상 존재하지 않는다는 상태를 만들 수 있기 때문입니다.

여기서 자주 나는 사고는 `null`을 "선호도 없음"이나 "값을 아직 계산하지 않음"으로 재사용하는 것입니다. 그러면 consumer는 필드가 비어 있는 정상 상태와 삭제 상태를 구분할 수 없습니다. 값이 비어 있음을 표현하려면 명시적인 value를 씁니다.

```json
// 상태는 존재하지만 알림 채널이 없다
{ "customerId": "42", "notificationChannels": [] }

// customerId=42 상태 자체를 제거한다
key = "42", value = null
```

`delete.retention.ms`는 정리 편의값이 아니라 **가장 느린 정상 consumer가 tombstone을 볼 수 있는 창**입니다. 출발점은 다음처럼 잡을 수 있습니다.

```text
delete.retention.ms >= 최대 planned downtime
                     + 가장 긴 bootstrap 시간
                     + incident 복구 여유
```

예를 들어 주말 포함 최대 72시간 중단이 가능한 consumer가 있고, full bootstrap이 6시간이며, 복구 확인에 6시간을 잡는다면 7일보다 짧은 보존값은 보수적이지 않습니다. 이 수치는 절대 규칙이 아니라 workload 계약입니다. 장기간 오프라인이 허용되는 모바일 동기화나 외부 파트너 consumer가 있다면 토픽 bootstrap이 아니라 별도 snapshot API를 제공할지 먼저 결정해야 합니다.

### 4) Value schema와 key schema의 진화는 속도가 다르다

값 필드 하나를 추가하는 일은 [이벤트 스키마 레지스트리와 호환성 운영](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)의 backward/forward compatibility 규칙으로 관리할 수 있습니다. 반면 key 변경은 더 위험합니다. compaction의 동치 관계 자체가 바뀌기 때문입니다. `email` key를 `userId` key로 옮기는 순간, Kafka는 두 key가 같은 사람이라는 사실을 모릅니다.

안전한 key migration은 보통 네 단계입니다.

1. **mapping 확정**: old key와 new key를 연결하는 source of truth와 충돌 처리 기준을 정합니다.
2. **새 key publish**: 상태 snapshot을 new key로 발행하고 new consumer가 이를 읽게 합니다.
3. **소비자 전환 검증**: checksum과 key 수를 비교해 새 상태가 완전한지 확인합니다.
4. **이전 key tombstone**: 전환 window가 끝난 뒤 old key에 tombstone을 발행하고 보존 창 동안 관측합니다.

dual publish 기간에는 한 도메인 변경이 두 key에 서로 다른 revision으로 기록되지 않게 `stateVersion` 또는 source event offset을 넣는 편이 좋습니다. "두 토픽에 비슷한 값을 보냈다"는 것은 consistency 증거가 아닙니다. old/new state count, checksum, tombstone count를 같은 release gate에서 봐야 합니다.

### 5) Bootstrap은 consumer onboarding이 아니라 복구 테스트다

compacted topic의 가장 큰 장점은 새 consumer가 `earliest`부터 읽어 현재 상태를 만들 수 있다는 점입니다. 그러나 이 절차를 실제로 실행하지 않으면 장점은 가정일 뿐입니다. 늦은 tombstone, serializer 변경, null key, 오래된 consumer bug, 잘못된 offset reset policy는 production 사고가 난 뒤에야 드러납니다.

최소한 주 1회 또는 schema/key 변경 때 다음 검증을 실행합니다.

1. 빈 state store를 준비하고 consumer를 earliest offset에서 시작합니다.
2. bootstrap 종료 offset, 처리한 key 수, tombstone 수, 소요 시간을 기록합니다.
3. 기준 DB 또는 신뢰할 수 있는 snapshot과 key count·sample checksum을 비교합니다.
4. 불일치가 있으면 lag만 보지 말고 tombstone age, key normalization, schema decode failure부터 분리합니다.

이 과정은 [Projection Lag와 Read Model Rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)의 rebuild 원칙을 현재 상태 topic에 적용한 것입니다. 복원 비용이 너무 커서 이 테스트를 못 돌린다면, cleaner 설정을 조정하기 전에 state의 범위와 snapshot 전략을 다시 설계해야 합니다.

## 실무 적용

### 1) 상태 topic 계약을 한 장으로 고정한다

새 compacted topic을 만들 때 아래 표를 ADR 또는 repository 문서에 넣습니다. 설정만 남기고 데이터 의미를 남기지 않으면 몇 달 뒤 `null`이 삭제였는지, retry signal이었는지 아무도 알 수 없습니다.

| 항목 | 예시 | 결정 기준 |
| --- | --- | --- |
| topic | `catalog.product-state.v1` | append-only event와 구분되는 이름 |
| key | immutable `productId` | 한 key가 하나의 현재 상품 상태 |
| value | displayable, sellable, revision | null은 사용하지 않고 빈 상태는 명시 표현 |
| tombstone owner | catalog service | 실제 삭제 또는 state ownership 종료만 발행 |
| retention | `delete.retention.ms=7d` | downtime 72시간 + bootstrap 6시간 + 여유 |
| bootstrap SLO | 10M key를 90분 이내 | 새 consumer/recovery 목표에 맞춤 |
| correctness gate | sampled checksum mismatch 0건 | disk size가 아닌 상태 정합성 우선 |

DB 변경에서 상태 topic을 갱신한다면 outbox 또는 CDC로 source transaction과 publish 경계를 정합니다. 단순히 application code에서 DB update 뒤 `send()`를 호출하면 실패 순서에 따라 DB만 바뀌거나 Kafka만 바뀌는 빈틈이 생깁니다. 그 경계는 [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)의 문제이지만, compacted topic에서는 그 빈틈이 오래 지속되는 stale state로 보인다는 점이 다릅니다.

### 2) 삭제 경로를 create/update와 같은 수준으로 테스트한다

일반적인 happy path 테스트는 `create → update → read`까지만 확인합니다. 상태 topic에서는 `create → update → delete → empty bootstrap`이 최소 경로입니다. 특히 delete 직후 live consumer가 state를 지우는지, 오프라인 consumer가 tombstone을 지나 재시작했을 때도 같은 결과인지 둘 다 확인해야 합니다.

다음 기준으로 canary를 시작할 수 있습니다.

- tombstone 처리 지연 p95: **5분 이하** 또는 도메인의 삭제 SLO 이하
- tombstone decode/처리 오류: **0건**
- bootstrap 뒤 기준 snapshot과 sampled checksum mismatch: **0건**
- key count 차이: **0.1% 미만**, 초과 시 자동 확대 중단
- bootstrap duration: baseline 대비 **20% 이내** 증가
- compaction cleaner lag: 일시 spike가 아니라 **30분 이상 지속** 시 조사

여기서 0.1%는 삭제 상태 누락을 허용한다는 뜻이 아닙니다. 큰 dataset에서 기준 snapshot의 시점 차이, eventual consistency window를 분리하기 위한 조사 기준입니다. 삭제·권한·가격처럼 stale state가 곧 위험으로 이어지는 도메인은 checksum mismatch를 한 건도 허용하지 않는 편이 맞습니다.

### 3) key migration은 평상시 배포보다 느리게, rollback은 더 빠르게 설계한다

key migration 중 rollback 대상은 code revision만이 아닙니다. new key로 이미 발행한 state와 old key tombstone의 조합이 남습니다. 따라서 이전 key를 지우기 전에 new consumer rollout을 충분히 검증해야 합니다. 권장 순서는 `new topic 또는 new-key view 생성 → 5% consumer canary → full consumer 전환 → old key tombstone → retention 창 관찰 → producer 단순화`입니다.

old key tombstone을 너무 빨리 쓰면 rollback consumer가 과거 key state를 복원하지 못합니다. 반대로 tombstone을 영원히 미루면 한 상태가 두 identity로 살아 있습니다. migration 종료 조건을 "배포가 끝남"이 아니라 다음 세 개로 둡니다.

- new key consumer adoption 100%
- state checksum과 business count가 7일 연속 기준 안
- old key read 또는 write가 0인 기간이 delete retention보다 김

## 트레이드오프/주의점

1. **Compacted topic은 audit log가 아닙니다.** 현재 상태를 빠르게 배포하려는 목적과 모든 변경 사실을 보존하려는 목적은 분리합니다. 결제 원장, 보안 감사, 규제 보존은 append-only event와 별도 보존 정책이 필요합니다.

2. **삭제 보존을 무한히 늘린다고 자동으로 안전해지지 않습니다.** bootstrap은 길어지고 disk 비용도 커집니다. 장기 오프라인 consumer가 정상 요구사항이라면 retention만 늘리기보다 snapshot delivery 또는 재동기화 API를 검토합니다.

3. **compaction은 key 없는 레코드를 구해 주지 않습니다.** null key 레코드는 일반적인 compaction 대상으로 취급할 수 없습니다. 원인별 metric을 두고 producer validation에서 차단하는 편이 낫습니다.

4. **key 변경은 schema field rename보다 위험합니다.** key가 바뀌면 cleanup의 동치 관계가 달라집니다. 새 key publish와 이전 key tombstone을 원자적이라고 가정하지 말고 reconciliation을 둡니다.

5. **cleaner lag만 보고 장애를 판단하지 않습니다.** broker I/O, segment, retention, traffic 급증에 따라 lag는 일시적으로 커질 수 있습니다. 실제 사용자 영향은 bootstrap 시간, stale state, tombstone 누락과 함께 판단합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] compacted topic의 key가 immutable business identity이며, 한 key가 하나의 최신 state만 대표한다.
- [ ] `null` value의 의미를 tombstone으로 고정하고, 빈 상태는 명시 value로 표현한다.
- [ ] `delete.retention.ms`가 planned downtime, full bootstrap, incident 여유를 합친 값보다 길다.
- [ ] earliest bootstrap과 기준 snapshot checksum 비교를 정기적으로 실행한다.
- [ ] key migration에 old/new mapping, dual publish, tombstone, rollback consumer 기간이 있다.
- [ ] audit event와 state topic을 분리하고 각각의 retention·owner·복구 목적을 문서화했다.

### 연습: 사용자 설정 상태 topic을 복구 가능하게 만들기

1. `user-preference`처럼 최신 상태만 필요한 데이터 하나를 고르고, key가 실제 immutable ID인지 확인합니다.
2. create, update, empty value, delete를 각각 어떤 value 또는 tombstone으로 표현할지 표로 적습니다.
3. 새 consumer가 earliest부터 읽어 state store를 만든 뒤 원본 DB와 key count·100개 샘플 checksum을 비교합니다.
4. consumer를 72시간 멈췄다고 가정하고, 현재 `delete.retention.ms`로 모든 tombstone을 볼 수 있는지 계산합니다.
5. key를 `email`에서 `userId`로 옮기는 migration runbook을 작성하되, old key tombstone 전에 어떤 rollback 증거가 필요한지 명시합니다.

## 관련 글

- [Kafka 멱등·정렬 처리 전략](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)
- [이벤트 스키마 레지스트리와 호환성 운영](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)
- [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Projection Lag와 Read Model Rebuild](/learning/deep-dive/deep-dive-projection-lag-read-model-rebuild-playbook/)
