---
title: "2026 개발 트렌드: Embedded Durable Queue, 워커와 스케줄러를 SQLite·Postgres에 다시 붙이는 팀이 늘어나는 이유"
date: 2026-05-01
draft: false
tags: ["Embedded Durable Queue", "SQLite", "Postgres", "Background Jobs", "Workflow", "Platform Engineering"]
categories: ["Development", "Learning"]
series: "2026 개발 운영 트렌드"
keywords: ["embedded durable queue", "sqlite job queue", "postgres background jobs", "lightweight workflow", "durable scheduler"]
description: "요즘 팀들이 모든 비동기 작업을 무조건 외부 브로커로 보내기보다, SQLite나 Postgres 위에 durable queue와 scheduler를 다시 올리는 이유를 실무 기준으로 정리합니다."
lastmod: 2026-05-01
summary: "최근 개발 트렌드는 메시지 브로커를 버리는 것이 아니라, 작은 팀과 명확한 워크로드에서는 SQLite나 Postgres 위에 durable queue, cron, retry, workflow를 다시 붙여 운영 복잡도를 줄이는 쪽으로 움직이고 있습니다. 핵심은 유행이 아니라 워크로드 경계입니다."
key_takeaways:
  - "작은 팀과 제한된 워크로드에서는 별도 브로커보다 DB 기반 durable queue가 운영 단순성과 복구 가능성을 더 크게 준다."
  - "적합한 기준은 TPS보다도 작업 독립 확장 필요성, 재처리 창, 격리 요구, 운영 인력 규모에 있다."
  - "잘하는 팀은 브로커를 없애는 것이 아니라, DB queue로 닫히는 범위와 절대 분리해야 할 범위를 먼저 나눈다."
operator_checklist:
  - "작업량, 재시도 정책, DLQ 필요성, 작업당 최대 실행 시간, 운영자 재처리 방식부터 문서화한다."
  - "queue depth, oldest runnable age, retry inflation, stuck lease 수치를 대시보드 첫 줄에 둔다."
  - "DB queue를 선택하더라도 outbox, idempotency, visibility timeout 같은 기본 규율은 생략하지 않는다."
decision_guide:
  title: "우리 팀이 지금 Embedded Durable Queue를 검토해도 되는 신호"
  intro: "핵심은 '가볍다'가 아니라 '분리 비용보다 단일 저장소 이점이 큰가'입니다. 아래 세 경우로 나누면 판단이 훨씬 쉬워집니다."
  cases:
    - badge: "즉시 검토"
      title: "작업 수는 많지 않지만 재처리와 운영 가시성이 자주 필요하다"
      fit: "백오피스 배치, 웹훅 전달, 메일 발송, 썸네일 생성, 소규모 워크플로, 크론성 작업이 많은 팀"
      watchouts: "트래픽이 늘어나는 순간 브로커로 옮길 경계를 미리 정하지 않으면 DB가 새 병목이 된다."
      next_step: "oldest runnable age, lease timeout, retry inflation 세 숫자를 먼저 측정한다."
    - badge: "부분 도입"
      title: "핵심 비동기는 브로커에 두고, 운영성 작업만 DB에 붙이고 싶다"
      fit: "주문/정산 같은 핵심 이벤트는 Kafka를 유지하되, 스케줄링·리컨실리에이션·관리자 작업은 더 단순화하려는 팀"
      watchouts: "두 계층을 섞을 때 책임 경계가 흐려지면 오히려 복잡도가 늘 수 있다."
      next_step: "업무 중요도별로 '브로커 유지', 'DB queue 가능', '사람 승인 필요' 세 버킷으로 나눈다."
    - badge: "보류 권장"
      title: "독립 확장과 테넌트 격리가 이미 핵심 경쟁력이다"
      fit: "초당 수천~수만 jobs, 다수 컨슈머 그룹, 장기 backlog, 강한 멀티테넌트 격리, 리전 간 재생성이 필요한 팀"
      watchouts: "이 경우 단순화를 위해 DB queue로 모으는 시도는 빠르게 한계에 닿는다."
      next_step: "broker/workflow 유지 전제로 운영 지표와 비용만 먼저 정리한다."
learning_refs:
  - title: "Queue Visibility Timeout·Ack/Nack·DLQ 플레이북"
    href: "/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/"
    description: "DB queue를 쓰더라도 재시도와 독성 메시지 규칙이 왜 필요한지 이어서 볼 수 있습니다."
  - title: "Transactional Outbox + CDC"
    href: "/learning/deep-dive/deep-dive-transactional-outbox-cdc/"
    description: "DB를 메시지 경계로 쓸 때 어떤 일관성 규율이 필요한지 연결됩니다."
  - title: "분산 스케줄러 Singleton 실행 보장 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/"
    description: "DB 기반 스케줄러에서 lease, fencing, idempotency를 어떻게 붙여야 하는지 이어집니다."
faqs:
  - question: "DB queue는 결국 임시방편 아닌가?"
    answer: "작은 팀과 명확한 워크로드에서는 임시방편이 아니라 최적해일 수 있습니다. 다만 독립 확장, fan-out, 장기 backlog가 커지면 한계가 빨리 옵니다."
  - question: "SQLite도 운영용 비동기를 맡길 수 있나?"
    answer: "단일 노드 또는 제한된 작업군이라면 가능합니다. 하지만 다중 컨슈머 확장, 리전 간 복구, 강한 멀티테넌트 격리가 핵심이면 별도 계층이 더 적합합니다."
  - question: "Kafka나 SQS를 버리자는 이야기인가?"
    answer: "아닙니다. 요즘 흐름은 '모든 비동기를 같은 무게의 도구에 태우지 말자'에 가깝습니다. 핵심은 분리 기준을 더 명확히 세우는 것입니다."
---

요즘 비동기 아키텍처 얘기를 보면 흥미로운 역류가 하나 있습니다. 몇 년 전까지는 "브로커를 붙여야 확장된다"가 거의 상식처럼 통했는데, 최근엔 오히려 **작업 수명주기가 짧고 운영팀 규모가 작은 영역은 SQLite나 Postgres 위로 다시 붙이는 흐름**이 눈에 띕니다. durable queue, retry, cron, lease, replay를 굳이 별도 인프라로 흩뿌리지 않고, 이미 믿고 있는 저장소 안에서 닫아 버리는 쪽이 더 싸고 더 설명 가능하다는 판단이 늘고 있는 겁니다.

이건 단순한 경량화 취향이 아닙니다. 최근엔 SQLite 파일 안에서 queue, stream, pub/sub, scheduler를 묶는 도구나, Postgres를 durable execution/cron 기반으로 쓰는 패턴이 다시 주목받고 있습니다. 배경은 명확합니다. 많은 팀이 브로커를 도입한 뒤에도 결국 [Queue Visibility Timeout·Ack/Nack·DLQ 설계](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/), [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [분산 스케줄러 Singleton 실행 보장](/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/), [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/) 같은 규율을 다시 구현해야 한다는 사실을 체감했기 때문입니다. 결국 질문은 "브로커가 있나 없나"가 아니라, **이 작업을 정말 별도 확장 단위로 분리할 가치가 있나**로 바뀌고 있습니다.

## 이 글에서 얻는 것

- 왜 작은 팀과 특정 워크로드에서 embedded durable queue가 다시 주목받는지 이해할 수 있습니다.
- SQLite/Postgres 기반 queue가 잘 맞는 작업과, 애초에 전용 브로커가 더 나은 작업을 구분할 수 있습니다.
- `queue depth`, `oldest runnable age`, `retry inflation`, `stuck lease` 같은 실무 기준을 숫자로 잡을 수 있습니다.
- "단순화"와 "과소설계"를 혼동하지 않도록 경계 조건을 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 요즘 팀들이 줄이려는 것은 메시징 기능보다 운영 표면적이다

대부분의 팀은 브로커를 싫어해서가 아니라, **운영해야 할 이동 부품이 너무 많아져서** 피로해집니다. 워커가 조금만 늘어도 아래 문제가 반복됩니다.

- 브로커 backlog와 DB 상태를 따로 봐야 함
- retry, DLQ, scheduler, replay가 각자 다른 저장소와 규칙을 가짐
- "왜 이 작업이 다시 실행됐나"를 시스템 경계마다 추적해야 함
- 작은 백오피스 작업인데도 infra 무게가 본체보다 커짐

그래서 최근 흐름은 기능을 포기하는 게 아니라, **작업 상태와 비즈니스 상태를 같은 저장소에서 더 가깝게 두는 쪽**으로 움직입니다. 이 접근은 특히 관리자 작업, 웹훅 전송, 이메일 발송, 썸네일 생성, 정기 집계, 소규모 workflow에서 강합니다.

### 2) 적합성의 핵심은 TPS보다 독립 확장 필요성이다

DB queue를 평가할 때 많은 팀이 먼저 초당 처리량부터 봅니다. 물론 중요합니다. 하지만 실무에서는 오히려 아래 질문이 더 먼저입니다.

- 작업 실행을 서비스 read/write 경로와 **독립적으로 확장**해야 하나?
- 하나의 테넌트 backlog가 다른 테넌트를 심하게 오염시킬 수 있나?
- 소비 지연을 수 시간, 수일 단위로 버텨야 하나?
- fan-out subscriber가 여러 개이며 서로 다른 재처리 정책이 필요한가?

이 질문에 "그렇다"가 많을수록 전용 브로커나 workflow 엔진 쪽이 낫습니다. 반대로 작업이 단순하고, 상태를 DB에서 바로 읽어야 하며, 운영자가 SQL 한 번으로 재처리 상황을 설명할 수 있어야 한다면 DB queue는 생각보다 강합니다.

시작 기준으로는 아래 정도가 무난합니다.

- 초당 신규 job이 **200~500개 이하**
- 동시 워커가 **10~30개 이하**
- 개별 job 실행 시간이 보통 **수 초 이내**
- backlog 보존이 **수일~수주** 수준에서 닫힘
- fan-out subscriber보다 **단일 소유자 워크플로** 비중이 큼

이 수치는 절대값이 아니라 "여기까지는 DB 단순성 이점이 자주 더 크다"는 운영 감각에 가깝습니다.

### 3) DB에 붙인다고 해서 큐 규율이 사라지는 것은 아니다

여기서 제일 위험한 오해가 있습니다. "DB니까 그냥 테이블 한 장이면 되겠지"라는 생각입니다. 그건 거의 항상 사고로 갑니다. DB queue에도 결국 아래 규율이 필요합니다.

- lease 또는 visibility timeout
- idempotency key
- retry 횟수와 backoff
- poison job 분리
- replay reason 기록
- oldest runnable age 모니터링

즉 최근 트렌드는 큐 규율을 버리는 게 아니라, **그 규율을 더 적은 시스템 경계에서 구현하려는 흐름**입니다. 그래서 [Queue Visibility Timeout·Ack/Nack·DLQ 플레이북](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)과 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [Transactional Inbox](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)를 같이 보는 편이 맞습니다.

### 4) SQLite와 Postgres는 같은 범주처럼 보여도 쓰임새가 다르다

SQLite가 빛나는 구간은 **단일 노드, 배포 쉬움, 낮은 운영 오버헤드, 강한 로컬 내구성**입니다. 반면 Postgres는 **여러 워커, SQL 기반 운영 도구, 트랜잭션 일관성, 기존 운영 자산 재사용**에 강합니다.

대략 이렇게 나누면 편합니다.

- **SQLite 적합**: 에지/단일 인스턴스 앱, 로컬 자동화, 소규모 SaaS의 부가 작업, 배포형 제품
- **Postgres 적합**: 이미 RDS/Cloud SQL/managed PG를 쓰고 있고, 백오피스/웹훅/배치/내부 workflow를 같은 운영팀이 관리하는 경우
- **전용 브로커 적합**: subscriber 다수, 장기 backlog, 멀티리전 전달, 높은 fan-out, 독립 스케일이 핵심인 경우

결국 요즘 팀들이 배우는 건 "SQLite냐 Kafka냐"가 아니라, **작업군마다 적정 무게가 다르다**는 사실입니다.

### 5) 앞으로의 차이는 기능 수보다 설명 가능성에서 난다

브로커를 붙이면 확장성은 얻기 쉽지만, 작은 팀은 종종 "이 작업이 왜 지금 이 상태인지" 설명하는 데 더 많은 시간을 씁니다. 반대로 DB queue는 상태를 한눈에 보기 쉬워서 운영 설명 가능성이 좋아집니다.

그래서 최근 도입팀은 아래 KPI를 먼저 봅니다.

- `oldest_runnable_age_seconds`: **60초 이하** 유지 목표, 중요 작업은 더 짧게
- `lease_expired_reclaim_rate`: **1% 이하** 목표
- `retry_inflation_ratio`: 재시도로 인한 총 실행 증가율 **1.2 이하** 권장
- `stuck_jobs_total`: 0이 이상적, 조금이라도 생기면 원인 추적
- `operator_replay_count`: 수동 재처리가 반복되면 구조 문제 신호

핵심 우선순위는 보통 **작업 유실 방지 > 중복 효과 방지 > 운영 설명 가능성 > 처리량 최적화** 순입니다. 작은 팀일수록 이 순서가 잘 맞습니다.

## 실무 적용

### 1) 어떤 작업부터 옮길 것인가

처음부터 핵심 주문 이벤트를 옮기는 건 권하지 않습니다. 보통은 아래 순서가 안전합니다.

1. 관리자성 백그라운드 작업
2. 정기 배치와 스케줄성 작업
3. 웹훅/이메일/알림 같은 재시도형 작업
4. 사람이 운영 화면에서 직접 재실행해도 되는 워크플로

반대로 아래는 보수적으로 봐야 합니다.

- 다수 소비자가 같은 이벤트를 각자 해석하는 fan-out 구조
- 초당 수천 건 이상 장기 backlog가 생기는 흐름
- 리전 간 전달 보장이 핵심인 작업
- 업무상 "한 번 늦는 것"보다 "절대 막히면 안 되는 것"이 더 중요한 경우

### 2) 권장 시작 구조

가벼운 시작은 아래 정도면 충분합니다.

- `jobs` 테이블: 상태, next_run_at, lease_until, retry_count, payload_ref
- `job_attempts` 테이블: 실패 원인, 실행 시간, operator replay 여부
- 워커는 `next_run_at <= now()` and `lease_until < now()` 기준으로 획득
- 실패 시 지수 backoff, 횟수 초과 시 dead 상태 또는 별도 quarantine 테이블 이동

그리고 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)처럼, 사용자 요청 안에서 바로 외부 전송하지 말고 **업무 상태 변경과 job enqueue를 같은 커밋에 묶는 규율**이 중요합니다.

### 3) 언제 브로커로 나가야 하는가

아래 신호가 보이면 DB queue만으로 버티려 하지 않는 편이 좋습니다.

- backlog가 자주 **수백만 건 이상** 누적
- 가장 큰 테넌트 1곳이 전체 워커 시간을 **30% 이상** 점유
- 작업군마다 서로 다른 소비자 그룹과 재처리 정책이 필요
- DB lock, vacuum, replica lag가 queue workload 때문에 눈에 띄게 악화
- 운영자가 SQL 대신 별도 도구와 시각화를 더 필요로 하기 시작

즉 DB queue는 "영원한 기본값"이 아니라, **명확한 범위에서 매우 강한 기본값**에 가깝습니다.

### 4) 4주 도입 플랜

**1주차**  
현재 비동기 작업을 `운영성 작업`, `핵심 도메인 이벤트`, `장기 backlog형`으로 분류합니다.

**2주차**  
가장 단순한 작업군 1개를 골라 queue depth, oldest runnable age, retry inflation 대시보드를 붙입니다.

**3주차**  
lease timeout, idempotency, dead job 격리, operator replay 기록을 추가합니다.

**4주차**  
기존 외부 브로커 작업과 비용, 장애 대응 시간, 수동 복구 시간을 비교해 계속 확대할지 판단합니다.

## 빠른 선택 매트릭스

팀이 실제로 헷갈리는 지점은 "지금 바로 DB queue로 가도 되나"보다 **어떤 작업은 남기고 어떤 작업만 옮겨야 하나**입니다. 그래서 아래처럼 작업군별로 의사결정을 나누면 시행착오가 크게 줄어듭니다.

| 작업 유형 | SQLite | Postgres | 전용 브로커/워크플로 엔진 |
| --- | --- | --- | --- |
| 관리자성 재처리, 내부 배치, 소규모 cron | 매우 적합 | 매우 적합 | 과할 가능성 큼 |
| 웹훅 전달, 이메일, 썸네일 생성 | 제한적 적합 | 적합 | fan-out이 크면 적합 |
| 주문/결제 후속처리처럼 유실이 매우 민감한 작업 | 보수적 | 조건부 적합 | 자주 적합 |
| 다수 구독자가 같은 이벤트를 소비하는 구조 | 부적합 | 제한적 | 매우 적합 |
| 멀티리전, 장기 backlog, 독립 확장이 핵심 | 부적합 | 보수적 | 매우 적합 |

판단 기준은 화려한 기능 수가 아닙니다. 아래 네 질문에 두 개 이상 "예"가 나오면 전용 계층을 먼저 보는 편이 안전합니다.

1. 같은 이벤트를 여러 소비자 그룹이 서로 다른 속도로 읽어야 하는가?
2. backlog가 길게 쌓여도 온라인 트랜잭션과 분리된 확장이 필요한가?
3. 테넌트 간 noisy neighbor를 강하게 격리해야 하는가?
4. 운영팀이 SQL보다 별도 관측 도구와 리플레이 도구에 더 의존하게 될 가능성이 큰가?

반대로 아래 조건이면 DB queue 쪽이 실무적으로 더 이득일 때가 많습니다.

- enqueue와 비즈니스 상태 변경을 같은 트랜잭션으로 묶고 싶다.
- 운영자가 작업 상태를 SQL 한 번으로 설명하고 수습할 수 있어야 한다.
- 워커 수보다 운영 인력 부족이 더 큰 제약이다.
- 핵심 목표가 초고속 fan-out보다 예측 가능한 운영 복구다.

이 매트릭스는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [Lag Aware Read Routing](/learning/deep-dive/deep-dive-lag-aware-read-routing-follower-reads-playbook/), [Outlier Detection/Ejection](/learning/deep-dive/deep-dive-outlier-detection-ejection-playbook/)처럼 이미 운영에 쓰는 규율과 같이 봐야 제대로 작동합니다.

## 도입 전에 꼭 문서화할 운영 계약

DB queue는 코드보다 운영 계약이 먼저입니다. 아래 항목이 비어 있으면 구현이 간단해 보여도 실제 운영은 빠르게 흐려집니다.

### 1) lease와 재시도 계약

- 한 작업을 몇 초까지 점유할 수 있는가
- lease 만료 후 reclaim은 몇 번까지 허용할 것인가
- 재시도 간격은 고정인지, 지수 backoff인지
- 최대 재시도 초과 시 dead 상태로 둘지, quarantine 테이블로 보낼지

이 계약이 없으면 중복 실행과 stuck job이 섞이면서 "성공했는데 또 돌았다"와 "실패했는데 영원히 안 돌아온다"가 동시에 생깁니다.

### 2) 운영자 개입 계약

- 운영자가 재실행할 때 payload를 수정할 수 있는가
- replay reason을 반드시 남기는가
- 수동 재실행도 같은 idempotency 규칙을 타는가
- 실패 원인 분류를 애플리케이션/외부 API/데이터 문제로 나눠 저장하는가

특히 운영자가 개입하는 시스템은 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)처럼 누가, 왜, 어떤 근거로 재실행했는지 남겨야 나중에 설명이 됩니다.

### 3) 승격 경계 계약

- queue depth가 얼마를 넘으면 브로커 분리를 검토할 것인가
- 특정 테넌트 점유율이 몇 퍼센트를 넘으면 격리 설계를 시작할 것인가
- replica lag나 vacuum 부하가 어느 수준이면 queue 전용 저장소를 분리할 것인가

좋은 팀은 처음부터 완벽한 확장 구조를 만들기보다, **언제 현재 구조를 포기해야 하는지**를 먼저 적어 둡니다. 이게 있어야 단순화가 기술 부채가 아니라 의도된 단계 전략이 됩니다.

## 현업에서 자주 터지는 안티패턴

### "테이블 하나면 끝난다" 착각

jobs 테이블만 만들고 attempt 이력, DLQ성 격리, replay reason을 빼면 초반엔 빨라 보이지만 장애 한 번에 운영비가 급등합니다. 최소한 `jobs`, `job_attempts`, dead/quarantine 경로는 분리하는 편이 낫습니다.

### OLTP와 장기 배치를 무방비로 섞는 설계

같은 Postgres를 써도 모두 같은 우선순위로 처리하면 안 됩니다. 대형 backfill, 장기 reconciliation, 느린 외부 API retry를 낮은 우선순위 큐로 격리하지 않으면 온라인 트래픽과 잠깐씩 충돌하다가 결국 "왜 낮에는 괜찮다가 야간 배치만 돌면 느려지지?"가 반복됩니다.

### 성공 기준을 처리량 하나로만 보는 운영

DB queue의 강점은 TPS 1등이 아니라 복구 설명 가능성입니다. 따라서 성공 기준도 `평균 처리량` 하나가 아니라 `oldest runnable age`, `retry inflation`, `operator replay count`, `stuck jobs`를 같이 봐야 합니다. 처리량만 맞추면 나중에 운영자가 감당할 빚이 숨어 버립니다.

## 트레이드오프/주의점

1. **단순화는 공짜가 아니다**  
DB queue로 모으면 시스템 수는 줄지만, DB 자체가 더 중요한 공용 자원이 됩니다. 경계를 잘못 잡으면 병목이 한곳에 몰립니다.

2. **fan-out과 다중 소비자 요구를 얕보면 안 된다**  
한 작업을 여러 팀, 여러 서비스가 각기 다르게 소비해야 한다면 전용 브로커가 더 자연스럽습니다.

3. **운영 가시성이 좋아 보여도 격리 문제는 남는다**  
같은 Postgres라도 OLTP와 장기 배치를 무심코 섞으면 replica lag, vacuum, lock 경합이 커질 수 있습니다.

4. **SQLite는 특히 범위를 명확히 해야 한다**  
로컬 내구성과 단순성은 훌륭하지만, 다중 노드 확장과 강한 분산 조정까지 기대하면 금방 무리가 옵니다.

5. **브로커를 안 쓴다고 사고가 줄어드는 것은 아니다**  
중복 방지, 재처리, poison job, 수동 복구 절차는 어떤 형태로든 필요합니다. 규율을 생략하면 단순화가 아니라 무방비가 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 현재 비동기 작업을 fan-out형과 단일 소유자형으로 나눴다.
- [ ] queue depth, oldest runnable age, retry inflation을 측정할 수 있다.
- [ ] lease timeout과 idempotency key 규칙이 있다.
- [ ] operator replay 이유와 실행 이력이 남는다.
- [ ] backlog가 커질 때 브로커로 분리할 경계 조건을 문서화했다.

### 연습 과제

1. 현재 팀의 비동기 작업 10개를 적고, 각각을 `DB queue 가능`, `브로커 유지`, `사람 승인 필요`로 나눠 보세요.  
2. 가장 단순한 백그라운드 작업 하나를 골라, queue depth와 oldest runnable age 목표치를 직접 숫자로 적어 보세요.  
3. 지난달 수동 재처리한 작업이 있다면, 그 이유가 데이터 유실인지, 중복 방지 부족인지, 운영 도구 부족인지 분류해 보세요.

## 관련 글

- [Queue Visibility Timeout·Ack/Nack·DLQ 재처리 설계 플레이북](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)
- [트랜잭션 아웃박스 + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [분산 스케줄러 Singleton 실행 보장 플레이북](/learning/deep-dive/deep-dive-distributed-scheduler-singleton-playbook/)
- [Reconciliation 파이프라인으로 금액·포인트 데이터 불일치 줄이기](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
- [2026-04-18 개발 뉴스 시니어 인사이트](/posts/2026-04-18-dev-news-senior-insights/)
