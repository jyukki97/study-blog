---
title: "백엔드 커리큘럼 심화: Queue Head-of-Line Blocking과 Priority Inversion, 느린 작업이 빠른 작업을 막지 않게 하는 법"
date: 2026-05-17
draft: false
topic: "Backend Resilience"
tags: ["Queue", "Head-of-Line Blocking", "Priority Inversion", "Backpressure", "Worker Pool", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "비동기 큐와 워커 풀에서 느린 작업 하나가 전체 처리 지연을 키우는 Head-of-Line Blocking과 Priority Inversion을 분리하고, 큐 격리·우선순위·동시성 예산·관측 지표를 숫자 기준으로 설계하는 방법을 정리합니다."
module: "backend-resilience"
study_order: 1234
---

비동기 큐를 도입하면 시스템이 자동으로 안정해진다고 생각하기 쉽습니다. 사용자의 동기 요청을 짧게 끝내고, 무거운 작업은 큐에 넣어 워커가 천천히 처리하면 된다는 그림은 맞습니다. 하지만 운영에서는 여기서 새로운 문제가 생깁니다. **느린 작업 하나가 같은 줄 뒤의 빠른 작업까지 막는 현상**입니다. 요청은 비동기로 바뀌었지만, 큐와 워커가 하나의 긴 줄처럼 설계되어 있으면 지연은 사라지지 않고 위치만 옮겨갑니다.

이 문제는 보통 Head-of-Line Blocking, Priority Inversion, noisy neighbor, worker starvation이라는 이름으로 나타납니다. 메일 발송, 이미지 리사이즈, 정산 집계, 검색 인덱싱, AI 요약, 외부 API 동기화가 모두 같은 큐를 쓰면 하나의 느린 작업군이 전체 backlog를 끌어올릴 수 있습니다. 이 글은 [Thread Pool 설계](/learning/deep-dive/deep-dive-thread-pool/), [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/), [Workload-aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/), [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 이어서 보면 좋습니다.

## 이 글에서 얻는 것

- 큐에서 발생하는 Head-of-Line Blocking과 Priority Inversion을 로그·메트릭으로 구분할 수 있습니다.
- 단일 FIFO 큐, 우선순위 큐, 워크로드별 큐 분리, tenant별 fair scheduling의 적용 기준을 세울 수 있습니다.
- 워커 동시성, backlog 상한, 작업 timeout, 재시도 예산을 숫자로 잡아 느린 작업이 전체 시스템을 오염시키지 않게 만들 수 있습니다.
- 비동기화가 지연을 숨기는 장치가 아니라 운영 가능한 완충 장치가 되도록 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) Head-of-Line Blocking은 "처리량 부족"이 아니라 "순서 때문에 생기는 지연"이다

Head-of-Line Blocking은 줄 앞의 작업이 오래 걸려 뒤의 짧은 작업이 같이 늦어지는 현상입니다. 전체 CPU가 여유 있고 워커 수가 남아 보여도, 특정 큐 파티션이나 특정 consumer group 안에서는 순서 때문에 막힐 수 있습니다.

예를 들어 하나의 FIFO 큐에 아래 작업이 섞여 있다고 가정합니다.

| 작업 | 평균 처리시간 | p95 처리시간 | 업무 중요도 |
| --- | ---: | ---: | --- |
| 회원 가입 메일 | 80ms | 200ms | 높음 |
| 썸네일 생성 | 700ms | 4s | 중간 |
| 대용량 리포트 생성 | 20s | 120s | 낮음 |
| 외부 CRM 동기화 | 1s | 15s | 중간 |

워커가 10개라도 리포트 생성 10건이 먼저 잡히면 가입 메일은 뒤에서 기다립니다. 이때 메트릭을 평균 처리시간만 보면 "리포트가 느리다" 정도로 보입니다. 하지만 실제 사용자 영향은 가입 직후 메일 지연, 인증 지연, 알림 누락처럼 전혀 다른 곳에서 나타납니다. 그래서 큐 운영에서는 `process_time`보다 `queue_wait_time`을 먼저 봐야 합니다. 특히 빠른 작업군의 `queue_wait_p95`가 평소의 3배 이상 또는 1분 이상 유지되면 Head-of-Line Blocking 후보로 봅니다.

### 2) Priority Inversion은 중요한 일이 낮은 우선순위 자원에 갇히는 문제다

Priority Inversion은 중요한 작업이 덜 중요한 작업 때문에 실행 기회를 얻지 못하는 현상입니다. 단순 FIFO에서도 발생하지만, 더 흔한 원인은 "우선순위가 있다는 착각"입니다. API는 high priority라고 말하지만 실제로는 같은 DB connection pool, 같은 Redis connection, 같은 worker executor, 같은 rate limit bucket을 공유합니다.

예를 들어 결제 확정 이벤트와 마케팅 세그먼트 갱신 작업이 같은 워커 풀을 쓰면, 세그먼트 갱신이 폭주하는 순간 결제 후속 처리도 밀립니다. 코드에는 `priority=HIGH`가 붙어 있어도 executor가 하나라면 의미가 없습니다. 우선순위는 큐 라벨이 아니라 **격리된 실행 예산**까지 있어야 동작합니다.

실무에서는 아래 세 조건을 만족해야 우선순위가 실제로 작동한다고 봅니다.

1. high/normal/low 작업이 최소 큐 또는 파티션 단위로 분리되어 있다.
2. high priority가 사용할 worker slot, DB connection, 외부 API quota가 별도 상한으로 보호되어 있다.
3. low priority backlog가 증가해도 high priority의 `queue_wait_p95`가 목표 SLO의 50% 이하로 유지된다.

이 조건이 없으면 priority field는 운영 장식에 가깝습니다.

### 3) 큐 분리는 많을수록 좋은 것이 아니라 병목과 SLO 단위로 나눠야 한다

Head-of-Line Blocking을 막겠다고 모든 작업마다 큐를 만들면 운영 복잡도가 폭발합니다. 큐가 많아지면 모니터링, 재처리, DLQ, 배포 설정, consumer autoscaling 기준도 같이 늘어납니다. 좋은 기준은 "작업 이름"이 아니라 **SLO와 병목 자원**입니다.

권장 분류는 아래처럼 시작하면 현실적입니다.

| 분리 기준 | 예시 | 기본 목표 |
| --- | --- | --- |
| 사용자 대기 영향 | 가입 메일, 결제 후속 처리 | `queue_wait_p95 < 5s` |
| 외부 API 병목 | CRM, PG, 배송사 연동 | 업체별 quota와 timeout 분리 |
| CPU/메모리 무거움 | 이미지 변환, PDF 생성, AI 요약 | worker slot 별도, batch size 제한 |
| 재처리 위험 | 정산, 포인트, 쿠폰 | 멱등성·감사 로그·수동 replay 우선 |
| 테넌트 공정성 | B2B 고객별 import | tenant별 concurrency cap |

처음부터 20개 큐를 만들 필요는 없습니다. 하지만 사용자 체감 작업, 긴 CPU 작업, 외부 API 작업, 재처리 위험 작업은 같은 FIFO에 넣지 않는 편이 안전합니다. 이 기준은 [Priority Load Shedding과 Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)의 bulkhead 사고방식과 같습니다. 장애 전파를 막으려면 실행 공간도 나눠야 합니다.

### 4) 재시도는 느린 작업을 더 느리게 만들 수 있다

큐 지연이 커질 때 자동 재시도가 겹치면 상황은 빠르게 나빠집니다. 외부 API가 5초 timeout으로 느려졌는데 모든 작업이 3회 즉시 재시도하면, 실제 점유 시간은 15초 이상으로 늘고 backlog는 더 쌓입니다. 이때 새 작업과 재시도 작업이 같은 큐를 쓰면 정상 요청까지 같이 늦어집니다.

재시도 정책은 아래 원칙을 권장합니다.

- 동기 사용자 영향 작업: 즉시 재시도 1회 이하, 이후 지연 재시도
- 외부 API 작업: 업체별 circuit breaker와 rate limit bucket 분리
- CPU-heavy 작업: 재시도보다 입력 검증과 작업 크기 제한 우선
- 정산·포인트 작업: 자동 재시도보다 멱등성 키와 reconciliation 우선
- 같은 payload가 3회 이상 실패하면 DLQ 또는 quarantine으로 이동

[Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)에서 다룬 원칙은 큐에서도 그대로 적용됩니다. 큐는 재시도를 쉽게 만들지만, 쉬운 재시도는 쉽게 장애를 키웁니다.

## 실무 적용

### 1) 먼저 메트릭을 작업군 단위로 쪼갠다

큐 운영의 출발점은 "큐가 몇 건 쌓였나"가 아닙니다. backlog 총량은 거칠게만 의미가 있습니다. 중요한 것은 어떤 작업군이 얼마나 기다리고, 얼마나 오래 실행되고, 실패 후 다시 들어오는지입니다.

최소 메트릭은 아래를 권장합니다.

- `queue_wait_ms`: enqueue부터 worker start까지 걸린 시간
- `process_ms`: worker start부터 ack까지 걸린 시간
- `inflight_count`: 현재 실행 중인 작업 수
- `retry_count`: payload별 누적 재시도 횟수
- `oldest_message_age`: 가장 오래 기다린 메시지 나이
- `dlq_count`: 격리된 실패 작업 수
- `worker_busy_ratio`: 워커가 실제로 일하는 비율
- `dependency_wait_ms`: 외부 API, DB, object storage 대기 시간

의사결정 기준은 작업군별로 따로 둡니다. 예를 들어 사용자 체감 작업은 `queue_wait_p95 < 5초`, 내부 동기화는 `< 2분`, 대용량 리포트는 `< 30분`처럼 다르게 잡습니다. 모든 큐에 같은 알람 기준을 붙이면 중요한 알람은 묻히고 덜 중요한 알람은 시끄러워집니다.

### 2) 단일 큐에서 시작했더라도 4개 레인으로 나누는 순간이 온다

초기에는 단일 큐가 가장 단순합니다. 작업량이 적고 작업 시간이 비슷하면 단일 FIFO가 오히려 좋습니다. 하지만 아래 조건 중 2개 이상이 1주일에 2회 이상 반복되면 큐 분리를 검토해야 합니다.

- 작업군별 p95 처리시간 차이가 10배 이상이다.
- 특정 작업군이 전체 backlog의 50% 이상을 10분 이상 차지한다.
- 빠른 작업의 `queue_wait_p95`가 목표의 2배를 넘는다.
- 재시도 작업이 신규 작업 처리량의 20% 이상을 먹는다.
- 외부 API 장애가 내부 작업 지연으로 전파된다.

실무의 첫 분리는 보통 아래 4개 레인이면 충분합니다.

1. `critical`: 결제, 인증, 사용자에게 바로 영향이 가는 작업
2. `standard`: 일반 알림, 검색 인덱싱, 보통의 후속 처리
3. `heavy`: 이미지/PDF/AI 요약/대용량 export처럼 긴 작업
4. `retry_or_quarantine`: 실패 재시도, 수동 확인, 독성 payload 격리

각 레인은 worker 수만 나누는 것이 아니라 timeout, retry, batch size, rate limit, 알람 기준까지 따로 가져갑니다. 예를 들어 `critical`은 worker 30%, DB pool 20%, 외부 API quota 40%를 예약하고, `heavy`는 worker 20%를 넘지 못하게 할 수 있습니다. 이 숫자는 고정 답이 아니라 출발점입니다. 핵심은 낮은 우선순위가 높은 우선순위의 최소 실행 예산을 침범하지 못하게 하는 것입니다.

### 3) 워커 동시성은 CPU가 아니라 dependency budget으로 제한한다

워커 수를 늘리면 처리량이 좋아질 것 같지만, 병목이 DB나 외부 API면 반대로 p99가 커집니다. 큐 워커는 보통 내부 dependency를 호출합니다. 그래서 동시성은 worker host CPU보다 DB pool, 외부 API quota, object storage bandwidth, lock contention을 기준으로 잡아야 합니다.

예시 기준은 이렇습니다.

- DB를 쓰는 critical worker: 서비스 전체 DB pool의 20~30% 이상을 단일 큐가 쓰지 않게 제한
- 외부 API worker: 업체 공식 quota의 50~70%를 평시 상한으로 시작
- CPU-heavy worker: core 수의 0.5~1.0배 동시성부터 시작, GC/메모리 pressure 관찰
- batch worker: batch size를 키우기 전에 `process_p95`와 lock wait를 먼저 확인
- 재처리 worker: 신규 작업 처리량의 10~20% 이하로 제한

이 기준은 [Capacity Planning과 Little's Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)와 연결됩니다. 평균 처리시간이 500ms이고 목표 처리량이 초당 200건이면 필요한 동시성은 단순 계산으로 100입니다. 하지만 p95가 2초이고 dependency가 흔들리면 안전 상한은 더 낮아야 합니다. 운영에서는 평균보다 p95 기준으로 용량을 잡는 편이 장애를 덜 만듭니다.

### 4) 오래 걸리는 작업은 쪼개고, 쪼갤 수 없으면 격리한다

Head-of-Line Blocking의 근본 원인은 작업 크기 편차입니다. 같은 큐에 100ms 작업과 5분 작업이 섞이면 언젠가 문제가 납니다. 가장 좋은 해법은 긴 작업을 작은 단위로 쪼개는 것입니다.

- 10만 건 import → 500~2,000건 chunk로 분할
- 대용량 리포트 → 준비, 조회, 생성, 업로드, 알림 단계로 분리
- 이미지 묶음 처리 → 파일 단위 작업으로 분해하고 최종 집계만 별도 처리
- AI 요약 → 문서 단위 처리 후 merge job으로 합성

쪼개기 어렵다면 격리해야 합니다. 긴 작업 전용 큐, 낮은 concurrency, 더 긴 timeout, 별도 DLQ, 별도 알람을 둡니다. "긴 작업도 가끔이니까 괜찮다"는 판단은 피크 시간에 자주 깨집니다. 가끔 발생하지만 10분 이상 실행되는 작업은 별도 레인으로 보내는 편이 낫습니다.

## 트레이드오프/주의점

큐를 나누면 안정성은 좋아지지만 운영 표면이 늘어납니다. 큐마다 consumer 배포, autoscaling, retry, DLQ, dashboard, runbook이 필요합니다. 작은 팀이라면 처음부터 세밀한 fair scheduler를 만들기보다, critical/standard/heavy/retry 4개 레인과 공통 메트릭부터 시작하는 편이 낫습니다.

우선순위 큐도 만능이 아닙니다. high priority가 계속 들어오면 low priority는 영원히 처리되지 않는 starvation이 생깁니다. 그래서 low priority에도 최소 처리 예산을 줘야 합니다. 예를 들어 전체 worker slot의 10%는 low priority에도 보장하고, high priority가 비어 있을 때만 빌려 쓰는 구조가 안전합니다.

작업 순서 보장이 필요한 도메인도 주의해야 합니다. 같은 주문, 같은 계좌, 같은 aggregate에 대한 이벤트는 무작정 병렬화하면 정합성이 깨집니다. 이 경우 전체 FIFO 대신 **key 단위 순서 보장**이 필요합니다. 주문 ID별 파티션은 순서를 지키되, 서로 다른 주문은 병렬 처리하는 방식입니다. 단, 특정 key가 뜨거워지는 hot partition은 별도 대응이 필요합니다.

마지막으로 큐는 사용자 경험을 숨길 수 있습니다. API는 202 Accepted로 빠르게 끝났지만 실제 작업이 30분 밀리면 사용자는 실패로 느낍니다. 비동기 작업에는 operation resource, 상태 조회, 지연 알림, 취소 경로를 붙이는 것이 좋습니다. 관련 내용은 [Async Request-Reply와 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)에서 이어서 볼 수 있습니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 작업군별 `queue_wait_p50/p95/p99`와 `process_p50/p95/p99`를 분리해서 보고 있는가?
- [ ] 빠른 작업과 긴 작업의 p95 처리시간 차이가 10배 이상인데 같은 FIFO를 쓰고 있지 않은가?
- [ ] critical 작업이 사용할 worker slot, DB connection, 외부 API quota가 최소 20~30% 이상 보호되어 있는가?
- [ ] 재시도 작업이 신규 작업과 같은 큐에서 무제한 경쟁하지 않는가?
- [ ] payload별 재시도 3회 이상 실패 시 DLQ 또는 quarantine으로 이동하는가?
- [ ] 오래 걸리는 작업은 chunk 단위로 쪼개거나 heavy 전용 레인으로 격리했는가?
- [ ] oldest message age가 SLO의 2배를 넘으면 자동 알람이 나는가?
- [ ] high priority 폭주 상황에서도 low priority가 최소 10% 이상 처리될 수 있는가?
- [ ] key 단위 순서 보장이 필요한 이벤트와 병렬화 가능한 이벤트를 구분했는가?
- [ ] 큐 지연이 사용자에게 보이는 작업에는 상태 조회와 취소/재시도 안내가 있는가?

### 연습

현재 운영 중인 큐 하나를 골라 작업군별로 최근 24시간의 `queue_wait_p95`, `process_p95`, retry 비율, oldest message age를 적어보세요. 그다음 아래 기준으로 분류합니다.

1. p95 처리시간이 다른 작업군보다 10배 이상 긴가?
2. backlog의 50% 이상을 특정 작업군이 차지하는 시간이 있는가?
3. 사용자 체감 작업의 대기시간이 내부 배치 때문에 늘어나는가?
4. 재시도 작업이 신규 작업 처리량의 20% 이상을 먹는가?
5. 외부 dependency 장애가 전체 큐 지연으로 전파되는가?

3개 이상이 "예"라면 단일 큐를 유지하기보다 critical/standard/heavy/retry 레인으로 나누는 설계를 먼저 그려보세요. 목표는 큐를 멋지게 만드는 것이 아니라, **느린 작업의 비용을 느린 작업 안에 가두는 것**입니다.
