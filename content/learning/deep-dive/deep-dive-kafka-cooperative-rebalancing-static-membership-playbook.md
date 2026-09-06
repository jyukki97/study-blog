---
title: "백엔드 커리큘럼 심화: Kafka Consumer Rebalancing, Cooperative 방식과 Static Membership으로 처리 중단을 줄이는 법"
date: 2026-09-06T10:06:00+09:00
draft: false
topic: "Distributed Systems"
tags: ["Kafka", "Consumer Group", "Cooperative Rebalancing", "Static Membership", "Consumer Lag", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "Kafka consumer group의 리밸런싱을 단순한 연결 이벤트가 아니라 파티션 소유권·처리 시간·중복 처리·배포 절차가 만나는 운영 변경으로 보고, cooperative rebalancing과 static membership을 선택하는 기준을 정리합니다."
module: "distributed-systems"
study_order: 1471
---

## 이 글에서 얻는 것

- consumer가 한 대 바뀌는 일이 왜 전체 처리량 하락, 처리 중단, 중복 처리로 이어지는지 설명할 수 있습니다.
- eager와 cooperative rebalancing, dynamic과 static membership을 각각 어떤 워크로드에 써야 하는지 결정할 수 있습니다.
- `max.poll.interval.ms`, 처리 단위, 종료 유예 시간, lag를 하나의 시간 예산으로 맞추는 방법을 배웁니다.
- rollout 중 리밸런싱을 "없애는" 대신, 영향 범위를 관측하고 되돌릴 수 있는 절차로 다루게 됩니다.

## 핵심 개념/이슈

### 1) 리밸런싱은 장애가 아니라 소유권 이전이지만, 처리 중단은 실제 비용이다

consumer group에서 멤버가 들어오거나 나가고, 구독 topic의 partition 수가 바뀌거나, coordinator가 멤버를 실패로 판단하면 partition assignment를 다시 계산합니다. 이때 핵심 질문은 "consumer가 재접속했는가"가 아니라 **어느 partition의 처리 권한이 언제 누구에게 넘어갔는가**입니다. commit하지 않은 레코드는 새 소유자가 다시 읽을 수 있으므로 at-least-once 처리에서는 중복이 정상 경로입니다.

eager rebalancing은 모든 member가 partition을 반납한 뒤 새 assignment를 받습니다. 단순하고 빠르게 이해되지만, consumer 하나의 배포에도 group 전체가 잠시 멈출 수 있습니다. 반면 cooperative rebalancing은 이동이 필요한 partition만 단계적으로 반납하고 유지 가능한 assignment는 그대로 둡니다. "무중단"이라는 뜻은 아닙니다. 두 번 이상의 rebalance round가 필요할 수 있고, 실제 이동 대상 partition은 여전히 pause됩니다. 다만 **변경과 무관한 partition까지 멈추는 반경**을 줄입니다.

| 상황 | 기본 판단 | 이유 |
| --- | --- | --- |
| partition 수가 적고, batch가 수 초 이내이며, 배포도 드묾 | eager도 가능 | 운영 단순성이 이득일 수 있음 |
| 수십 개 이상 partition, 지속 배포, 사용자 지연에 민감 | cooperative 우선 검토 | 불필요한 전역 revoke를 줄일 수 있음 |
| 한 record 처리에 수 분 이상 걸림 | 먼저 처리 단위·timeout 재설계 | assignor 변경만으로 poll deadline을 해결하지 못함 |
| consumer instance가 자주 흔들림 | static membership 전 환경 안정화 | 재시작 원인을 감추면 lag가 더 늦게 폭발함 |

[Kafka Consumer Lag 해석](/learning/deep-dive/deep-dive-kafka-consumer-lag/)에서 다룬 lag는 결과 지표입니다. rebalance가 잦은데 평균 lag만 보면, 짧은 stop-the-world 구간과 p99 처리 지연을 놓치기 쉽습니다. `rebalance` 횟수, revoke 뒤 재할당까지의 시간, partition별 `records-lag-max`, commit 지연을 함께 봐야 원인이 보입니다.

### 2) Static Membership은 "항상 같은 consumer"가 아니라 짧은 재시작을 member 교체로 보지 않게 하는 장치다

`group.instance.id`를 설정하면 broker는 process id가 아닌 안정된 instance identity를 기준으로 member를 다룹니다. 계획된 restart나 짧은 네트워크 단절에서 같은 instance가 session timeout 안에 돌아오면 불필요한 assignment 이동을 줄일 수 있습니다. Kubernetes Deployment의 rolling update처럼 Pod 이름이 매번 바뀌는 환경에서는 아무 문자열이나 고정해 두면 안 됩니다. replica마다 유일하고 재시작 뒤에도 예측 가능한 identity가 필요합니다. StatefulSet ordinal, 안정된 node/consumer slot이 흔한 후보입니다.

가장 위험한 실수는 동일한 `group.instance.id`를 두 Pod에 동시에 주는 것입니다. Kafka는 fencing을 통해 한쪽을 내보낼 수 있고, 운영자는 이를 "Kafka가 불안정하다"고 오해하기 쉽습니다. static membership은 autoscaling과도 긴장이 있습니다. replica 수가 계속 늘고 줄어드는 worker에는 identity가 짧게 남을 수 있어, 먼저 consumer churn과 scale policy를 다루는 편이 낫습니다.

```text
dynamic member: pod-7 종료 -> 즉시 member 제거 가능 -> 많은 partition 재할당
static member : slot-3 일시 종료 -> session timeout 안 복귀하면 기존 소유권 유지
               -> timeout 초과 시에만 slot-3의 partition을 다른 member로 이전
```

여기서 timeout을 길게 잡는다고 공짜가 되지 않습니다. 실제로 죽은 consumer가 소유하던 partition을 새 consumer가 받기까지 더 오래 기다립니다. 예를 들어 정상 restart p99가 35초이고 readiness·JVM warm-up까지 50초라면 session timeout을 60~90초에서 시작해 staging에서 검증할 수 있습니다. 반대로 결제·알림처럼 30초 이상의 처리 공백을 허용하지 못하면 static membership보다 다중 consumer, 더 짧은 작업 단위, idempotent write가 우선입니다.

### 3) poll timeout과 종료 유예 시간은 rebalancing 설정의 일부다

`max.poll.interval.ms`는 consumer가 다음 `poll()`을 호출하지 않고 버틸 수 있는 최대 시간입니다. 이 시간을 넘기면 살아 있는 process라도 group에서 제외될 수 있습니다. 큰 PDF 변환, 외부 API fan-out, 한 번에 수천 건 처리 같은 로직을 poll thread에 넣으면 GC나 downstream 지연 하나가 rebalancing으로 증폭됩니다.

출발점은 처리 시간에 맞춰 timeout을 크게 늘리는 것이 아니라, **한 poll이 점유할 수 있는 최대 작업량을 제한하는 것**입니다. 예컨대 record 처리 p99가 800ms이고 `max.poll.records=100`이면 순차 처리만으로도 80초입니다. 20%의 여유를 둬도 `max.poll.interval.ms` 120초는 지나치게 낙관적입니다. batch를 25로 낮추거나, 안전하게 병렬화한 뒤 partition 순서 보장을 확인하고, poll loop와 긴 작업을 분리해야 합니다.

| 항목 | 시작 기준 | 재검토 신호 |
| --- | --- | --- |
| record 처리 p99 | `max.poll.interval.ms`의 1/10 이하가 되도록 batch 산정 | p99가 배포·외부 API에 따라 크게 출렁임 |
| `max.poll.records` | 처리 p99 × records가 poll interval의 50% 이하 | batch가 커질수록 revoke·중복이 늘어남 |
| termination grace | commit·in-flight 종료 p99 + 20% | SIGTERM 뒤 강제 종료나 uncommitted record 급증 |
| session timeout | 정상 restart p99보다 길고 업무 공백 SLO보다 짧게 | stale member가 partition을 오래 잡음 |

[End-to-End Deadline과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)의 원칙처럼, 상위 timeout을 무작정 크게 만드는 것은 해결이 아닙니다. Kafka poll, DB transaction, HTTP client, Kubernetes `terminationGracePeriodSeconds`가 서로 모순되면 재시작 중 일부 작업은 취소되지 않고, 일부는 commit 전에 끊깁니다.

## 실무 적용

### 1) assignor 전환은 protocol rollout으로 한다

cooperative assignor 도입은 client 설정 한 줄을 전체 fleet에 동시에 넣는 작업이 아닙니다. consumer library와 broker 버전이 지원하는 assignor를 먼저 확인하고, 하나의 낮은 위험 group에서 다음 순서로 진행합니다.

1. **기준선 수집**: 7일간 rebalance count, rebalance duration p95, partition별 lag, duplicate 처리율, deployment당 lag spike를 기록합니다.
2. **단일 group canary**: 동일 consumer group에만 cooperative assignor를 켜고, 24시간 동안 scale-out·rolling restart·broker connection 단절을 재현합니다.
3. **종료 절차 검증**: SIGTERM 뒤 새 fetch 중지, in-flight 처리 완료 또는 안전한 중단, offset commit, group leave 순서가 로그와 metric으로 보이는지 확인합니다.
4. **확대·rollback**: p95 rebalance 시간 또는 duplicate 비율이 기준선보다 20% 이상 악화하면 assignor만 되돌리고, record 처리량·timeout 원인을 분리해 조사합니다.

`onPartitionsRevoked`에서 commit만 시도하고 외부 side effect의 완료 여부를 모르면 안전하지 않습니다. [Kafka 멱등성·순서 보장](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)의 idempotent consumer, unique key, outbox/inbox 경계가 필요한 이유가 여기 있습니다. rebalance 중복은 예외가 아니라 설계가 받아들여야 할 입력입니다.

### 2) 배포와 autoscaling이 만드는 churn을 먼저 분리한다

rebalancing이 많다는 사실만으로 Kafka 설정을 바꾸지 마세요. 아래 사건을 같은 time series에 겹치면 원인을 빠르게 좁힐 수 있습니다.

```text
Deployment rollout / HPA scale event / OOMKilled / GC pause
        -> consumer join·leave -> partition revoke·assign
        -> fetch gap·commit delay -> records-lag-max·duplicate write
```

HPA가 CPU 60%를 기준으로 몇 분마다 replica를 움직이면 consumer group도 같은 빈도로 흔들립니다. batch consumer의 scale-up은 lag 감소에 도움 될 수 있지만, partition 수보다 consumer 수가 많으면 idle member만 늘고 rebalance 비용만 남습니다. consumer 수는 우선 partition 수 이하로 두고, 특정 tenant가 lag를 독점하면 consumer를 무작정 늘리기보다 [Queue HOL과 Priority Inversion](/learning/deep-dive/deep-dive-queue-hol-priority-inversion-playbook/)의 partitioning·우선순위 정책을 검토합니다.

### 3) 운영 대시보드는 "group이 살아 있다"보다 이동 비용을 보여야 한다

최소 대시보드에는 consumer 수, assigned partition 수, rebalance count/duration, `records-lag-max`, oldest record age, commit latency, processing p95/p99, duplicate rejection count를 둡니다. alert는 rebalance 한 번이 아니라 영향 조합으로 만듭니다. 예를 들어 15분에 3회 이상 rebalance하면서 oldest record age가 SLO의 50%를 넘거나, 배포 직후 p99가 기준선의 2배가 될 때 호출하는 방식입니다.

운영자가 해야 할 첫 행동도 고정합니다. broker를 바로 재시작하거나 consumer replica를 무작정 늘리지 말고, 최근 rollout·OOM·poll interval exceed·coordinator 오류와 partition별 skew를 확인합니다. 그 뒤에만 timeout, batch size, instance identity, assignor를 한 항목씩 바꿉니다. 여러 값을 함께 바꾸면 다음 rebalancing에서 무엇이 좋아졌는지 알 수 없습니다.

## 트레이드오프/주의점

첫째, cooperative rebalancing은 전역 중단을 줄이는 대신 protocol과 관측의 복잡도를 높입니다. test가 없는 작은 internal consumer라면 eager 방식이 더 나은 선택일 수 있습니다. 둘째, static membership은 계획된 재시작에는 유리하지만 실제 장애의 failover를 늦출 수 있습니다. timeout은 availability와 churn 사이의 교환값입니다. 셋째, graceful shutdown은 모든 record를 끝까지 처리한다는 보장이 아닙니다. deployment deadline이 지나면 SIGKILL이 올 수 있으므로, 중단된 작업을 다시 읽어도 안전한 write path가 필수입니다.

마지막으로 lag가 줄었다고 곧바로 성공을 선언하지 마세요. rebalance를 억제해도 poison message, downstream saturation, hot partition은 남습니다. [Kafka Retry/DLQ](/learning/deep-dive/deep-dive-kafka-retry-dlq/)처럼 재시도와 격리를 별도 경계로 두어야, 안정된 group이 실패한 작업을 조용히 쌓아 두는 상태를 피할 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] group별 rebalance count와 duration p95, partition별 lag, duplicate 처리율을 같은 대시보드에서 본다.
- [ ] `max.poll.records × 처리 p99`가 `max.poll.interval.ms`의 50% 안에 들어오는지 확인한다.
- [ ] static membership identity는 replica마다 유일하고, 동시에 두 instance가 가질 수 없도록 배포 방식을 검증했다.
- [ ] SIGTERM부터 fetch 중지·in-flight 처리·commit·leave까지의 순서와 timeout을 staging에서 재현했다.
- [ ] assignor 변경은 canary group에서 24시간, scale-out과 restart를 포함해 검증했다.
- [ ] 새 consumer 수가 partition 수와 downstream 동시성 한도를 넘지 않도록 autoscaling 상한을 정했다.

### 연습

staging consumer group 하나를 골라 rolling restart를 세 번 실행하세요. eager와 cooperative 설정에서 각각 (1) assignment가 없는 시간, (2) rebalance 횟수와 p95, (3) `records-lag-max` peak, (4) duplicate 처리 건수를 기록합니다. 수치가 좋아져도 종료 유예 시간 안에 commit이 끝나지 않으면 확대하지 말고, batch와 처리 시간부터 줄이는 계획을 작성해 보세요.

## 관련 글

- [Kafka Consumer Lag: 적체를 처리량·지연·파티션 편차로 읽는 법](/learning/deep-dive/deep-dive-kafka-consumer-lag/)
- [Kafka 멱등성·순서 보장](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)
- [Kafka Retry/DLQ 설계](/learning/deep-dive/deep-dive-kafka-retry-dlq/)
- [End-to-End Deadline과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)
