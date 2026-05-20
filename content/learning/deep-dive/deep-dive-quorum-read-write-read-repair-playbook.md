---
title: "백엔드 커리큘럼 심화: Quorum Read/Write + Read Repair 실무 플레이북"
date: 2026-04-25
draft: false
topic: "Distributed Systems"
tags: ["Quorum", "Read Repair", "Eventual Consistency", "Distributed Database", "Replication"]
categories: ["Backend Deep Dive"]
description: "복제 DB나 분산 KV에서 quorum read/write를 언제 쓰고, 언제 포기해야 하는지, read repair와 hinted handoff를 어떤 숫자로 운영해야 하는지 실무 기준으로 정리합니다."
module: "backend-distributed"
study_order: 1150
---

복제 기반 저장소를 운영하다 보면 결국 같은 질문을 만나게 됩니다. "복제본이 3개면 몇 개에 쓰고 몇 개에서 읽어야 안전한가?" 교과서적으로는 `W + R > N`이면 된다고 외우지만, 실무는 그렇게 단순하지 않습니다. 네트워크 지연이 길어지는 순간 p99가 튀고, 장애 대응을 위해 sloppy quorum을 켜면 정합성은 다시 느슨해지며, 읽기 경로에서 read repair를 과하게 수행하면 평소엔 멀쩡하던 API가 갑자기 느려질 수 있습니다.

즉 quorum은 "정답 공식"이 아니라 **지연시간, 가용성, 복구 비용을 서로 바꾸는 운영 레버**에 가깝습니다. 이 글은 분산 KV, 검색 인덱스 메타데이터, 사용자 프로필 저장소, 일부 내부 플랫폼 저장소처럼 primary 1개에 완전히 의존하지 않는 시스템을 가정하고, quorum read/write를 실무에서 어떤 기준으로 선택하고 어떤 모니터링을 붙여야 하는지 숫자 중심으로 정리합니다. 배경 개념은 [정합성 모델](/learning/deep-dive/deep-dive-consistency-models/), [CAP 정리](/learning/deep-dive/deep-dive-cap-theorem/), [Clock Skew/시간 의미론 플레이북](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)과 같이 보면 더 잘 연결됩니다.

## 이 글에서 얻는 것

- `W + R > N` 공식이 언제 유효하고, 언제 실무에서 부족한지 설명할 수 있습니다.
- read repair, anti-entropy, hinted handoff를 같은 것으로 섞지 않고 역할별로 구분할 수 있습니다.
- 도메인별로 `N/R/W`, 허용 stale 시간, repair backlog 임계치를 어떤 숫자로 둘지 기준을 잡을 수 있습니다.
- quorum 장애 시 무엇을 먼저 포기하고 무엇을 지켜야 하는지 런북 우선순위를 세울 수 있습니다.

## 핵심 개념/이슈

### 1) quorum의 핵심은 과반수 자체가 아니라 "겹치는 복제본 수"다

많은 사람이 quorum을 "3개 중 2개면 과반수" 정도로 기억합니다. 하지만 실무적으로 중요한 건 과반수라는 말보다 **읽기 집합과 쓰기 집합이 최소 1개 이상 겹치는가**입니다. 그래서 기본 공식이 `W + R > N`입니다.

예를 들어 `N=3`일 때 아래처럼 해석합니다.

| 설정 | 의미 | 장점 | 위험 |
| --- | --- | --- | --- |
| `W=1, R=1` | 가장 빠른 설정 | 지연시간 최소 | stale read 가능성 큼 |
| `W=2, R=1` | 쓰기 우선 안정 | write durability 상승 | 읽기는 여전히 stale 가능 |
| `W=2, R=2` | 읽기/쓰기 겹침 보장 | stale 가능성 크게 감소 | p99 증가 |
| `W=3, R=2` | 강한 쓰기 보장 | 손실 위험 낮음 | 장애 시 write availability 급락 |

여기서 첫 번째 실무 포인트가 나옵니다. `W + R > N`이 되더라도 **클라이언트가 읽은 값이 최신값이라고 100% 장담되는 것은 아닙니다.** 이유는 타임스탬프 기반 last-write-wins, sloppy quorum, 비동기 read repair, 클럭 오차가 개입하기 때문입니다. 즉 quorum은 강한 정합성의 대체품이 아니라, 강한 정합성에 가까워지기 위한 확률적 운영 전략에 가깝습니다.

### 2) read repair는 정합성 기능이면서 동시에 지연시간 기능이기도 하다

read repair를 단순히 "읽을 때 복제본이 다르면 고쳐주는 것"으로 보면 반만 이해한 것입니다. 실제로는 아래 세 가지 층위가 있습니다.

1. **Foreground read repair**  
   읽기 요청 중 버전 차이를 발견하면 바로 최신 버전을 다른 복제본에 써서 맞춥니다.
2. **Background anti-entropy**  
   머클 트리나 range checksum으로 백그라운드 비교를 돌려 서서히 차이를 줄입니다.
3. **Hinted handoff**  
   장애 중 쓰지 못한 복제본 대신 다른 노드가 임시 보관했다가 복구 후 전달합니다.

셋은 모두 "복제본 차이를 줄인다"는 점은 같지만, 최적화 대상이 다릅니다.

- foreground read repair는 **사용자 읽기 신선도**를 높입니다.
- anti-entropy는 **장기 divergence 누적**을 줄입니다.
- hinted handoff는 **장애 중 write availability**를 높입니다.

문제는 이 셋을 한 번에 공격적으로 켜면, 평상시에는 조용하던 시스템이 복구 시점에 스스로 트래픽 폭탄을 만들 수 있다는 점입니다. 예를 들어 장애 노드가 20분 뒤 복귀했는데 hinted handoff backlog 150만 건을 즉시 밀어넣고, 동시에 foreground read repair까지 활발하면 cross-AZ 트래픽과 디스크 쓰기, compaction, p99 읽기 지연이 함께 악화됩니다. 이런 상황은 [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 [Connection Storm/Thundering Herd 플레이북](/learning/deep-dive/deep-dive-connection-storm-thundering-herd-playbook/)에서 다룬 패턴과 매우 닮았습니다.

### 3) quorum이 잘 맞는 도메인과 맞지 않는 도메인을 먼저 구분해야 한다

이 부분이 가장 중요합니다. quorum은 모든 데이터에 만능이 아닙니다.

**잘 맞는 경우**
- 사용자 프로필, 설정값, 피드 메타데이터처럼 수 초 이내 수렴이면 충분한 경우
- 지역 장애에도 읽기 지속성이 중요한 메타데이터
- 일시적 stale read보다 전체 가용성이 더 중요한 시스템

**안 맞는 경우**
- 결제 승인, 잔액, 재고 차감처럼 이중 집행 비용이 큰 도메인
- write skew나 다중 행 불변식이 핵심인 업무
- "가장 최신 값"이 아니라 "정확히 한 번의 결정"이 필요한 흐름

후자에서는 quorum을 억지로 밀기보다 [Snapshot Isolation/Serializable 플레이북](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/), [Distributed Transactions](/learning/deep-dive/deep-dive-distributed-transactions/) 또는 단일 리더 + 강한 조건부 쓰기를 검토하는 편이 더 안전합니다. 실무에서 자주 하는 실수가 "R=2, W=2면 거의 강한 정합성 아니냐"라고 생각하는 건데, 결제나 재고 같은 도메인에서는 `거의`가 사고 비용으로 돌아옵니다.

### 4) 설계보다 더 어려운 것은 복구 시의 운영 상수다

quorum 시스템은 정상 시보다 비정상 시에 진짜 실력이 드러납니다. 특히 아래 네 숫자를 먼저 정해 두지 않으면 장애 때 흔들립니다.

- `max_stale_read_ms`: 예를 들어 프로필은 500ms, 피드는 3000ms, 재고는 0ms
- `repair_backlog_limit`: 노드당 backlog 50만 건 또는 디스크 5GB 초과 시 강제 throttling
- `hint_ttl`: 10분, 30분, 2시간 중 무엇을 허용할지
- `cross_zone_repair_qps`: 복구 트래픽 상한, 예를 들어 노드당 500~2000 ops/sec

저는 보통 단일 리전 3복제 기준으로 아래 출발점을 추천합니다.

- 일반 메타데이터: `N=3, W=2, R=2`
- 읽기 민감, stale 허용: `N=3, W=2, R=1`, 단 버전 검증 및 read repair 필수
- 쓰기 손실 비용 큼: `N=3, W=3, R=1 또는 2`, 단 가용성 희생을 감수할 때만

핵심은 설정값보다 **그 설정이 깨졌을 때 어떤 SLA를 포기할지**를 미리 문서화하는 것입니다.

### 5) version 비교는 가능하면 wall clock보다 논리 버전이 낫다

복제본 충돌 판단을 단순 타임스탬프에만 기대면 클럭 오차가 있거나 여러 리전이 섞이는 순간 문제가 커집니다. 따라서 read repair 판단은 가능하면 아래 우선순위가 낫습니다.

1. 단조 증가 revision 또는 log sequence number
2. vector clock 또는 dotted version vector
3. 불가피할 때만 wall clock timestamp

특히 `last_write_wins`를 쉽게 채택하면 운영은 편해 보이지만, 실제로는 늦게 도착한 오래된 쓰기가 최신값을 덮는 문제가 숨어들 수 있습니다. 그래서 [Clock Skew/시간 의미론 플레이북](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)을 같이 봐야 합니다. "정합성 버그인데 원인은 시간 표현"인 경우가 생각보다 많습니다.

## 실무 적용

### 1) 도메인별 기본 의사결정 표

아래 표는 시작점으로 쓸 수 있는 보수적 기준입니다.

| 도메인 | 권장 설정 | 허용 stale 기준 | 우선순위 |
| --- | --- | --- | --- |
| 사용자 프로필/설정 | `N=3, W=2, R=2` | 500ms 이하 | 읽기 최신성 우선 |
| 뉴스피드/추천 메타데이터 | `N=3, W=2, R=1` | 1~3초 | 지연시간 우선 |
| 내부 플랫폼 설정/feature metadata | `N=3, W=2, R=2` | 200ms 이하 | 운영 안전성 우선 |
| 세션성 캐시성 데이터 | `N=3, W=1, R=1` | 수 초 허용 | 비용/속도 우선 |
| 재고/결제/한도 | quorum 기본값 비추천 | 0ms | 강한 정합성 우선 |

이 표에서 중요한 건 마지막 줄입니다. **quorum을 못 쓰는 게 아니라, quorum을 기본 답으로 두지 않는 것**입니다. 숫자가 아니라 도메인 비용으로 먼저 결정해야 합니다.

### 2) 운영 지표는 "성공률"보다 divergence를 보여줘야 한다

quorum 저장소는 200 OK 비율만으로 상태를 판단하면 늦습니다. 최소한 아래 지표는 있어야 합니다.

- `stale_read_rate`: 전체 읽기 중 최신 버전보다 오래된 값을 반환한 비율, 목표 **0.1% 미만**
- `replica_divergence_age_p95`: 복제본 간 최신 revision 차이의 시간 환산값, 목표 **1초 미만**
- `read_repair_trigger_rate`: 읽기 중 repair가 발동한 비율, 평시 **1~3% 이하** 권장
- `hinted_handoff_backlog`: 노드당 backlog 건수 또는 바이트, 상한 예시 **50만 건 또는 5GB**
- `cross_zone_repair_latency_p99`: 복구 트래픽이 일반 읽기 p99를 얼마나 밀어 올리는지, 증가폭 **20% 이내** 유지

운영 알람 예시도 단순하게 잡는 편이 좋습니다.

- `stale_read_rate > 0.5%` 10분 지속, 경고
- `replica_divergence_age_p95 > 5000ms`, 심각
- `hinted_handoff_backlog > 1,000,000` 또는 증가율 가속, 즉시 조치
- `read_repair_trigger_rate`가 평소 대비 3배 상승, 장애 전조 의심

### 3) 장애 복구 런북 우선순위

노드 하나가 죽었다가 돌아왔을 때 가장 흔한 실수는 "빨리 원상복구"에 집착하는 것입니다. 보통은 아래 순서가 더 안전합니다.

1. **새로운 사용자 요청 p99 보호**  
   repair 트래픽 상한을 먼저 걸고 일반 트래픽을 지킵니다.
2. **hinted handoff 재주입 속도 제한**  
   예를 들어 노드당 1000 ops/sec 이하부터 시작해 10분 단위로 25%씩 증가시킵니다.
3. **foreground read repair 완화 여부 판단**  
   읽기 p99가 20% 이상 나빠지면 foreground repair를 비동기 경로로 일부 전환합니다.
4. **anti-entropy 재개**  
   backlog가 안정권으로 내려온 뒤 백그라운드 비교를 천천히 재개합니다.

이 우선순위는 "정합성 회복 속도"보다 "사용자 영향 최소화"를 먼저 둡니다. 복구가 15분 빨라지는 것보다 서비스 전체 p99가 3배 오르는 쪽이 훨씬 비쌉니다.

### 4) 4주 도입 플랜

**1주차, 데이터 등급 분류**  
키스페이스를 `stale 허용`, `짧은 stale만 허용`, `stale 불가` 세 그룹으로 나눕니다.

**2주차, `N/R/W`와 stale budget 지정**  
도메인별로 `max_stale_read_ms`, `hint_ttl`, `repair_throttle`를 적습니다.

**3주차, 관측과 복구 상수 추가**  
revision 차이, backlog, repair rate 대시보드와 알람을 붙입니다.

**4주차, 복구 리허설**  
노드 격리 10분, 복귀 후 backlog 재주입, read repair 증폭 시나리오를 한 번 재현합니다.

실무에서는 기능 구현보다 리허설이 더 중요합니다. quorum은 평시에는 조용하지만, 장애 시 "생각보다 많은 것이 동시에 느려진다"는 점을 꼭 체감해 봐야 합니다.

### 5) 추천 기준, 단일 리전 3복제부터 시작한다면

- 출발 기본값: `N=3, W=2, R=2`
- 읽기 p99 목표가 50ms 이하라면 cross-AZ hop 1회당 3~8ms를 예산에 반영
- `read_repair_trigger_rate`가 5%를 넘으면 설계보다 운영 이상을 먼저 의심
- `hint_ttl`은 30분을 넘기기 전에 backlog가 실제로 감당 가능한지 검증
- divergence가 자주 1초를 넘으면 read repair보다 write path 병목, compaction, 네트워크 패킷 손실을 먼저 확인

즉 quorum 최적화의 출발점은 공식을 더 복잡하게 만드는 게 아니라, **수렴 속도를 숫자로 관찰하는 것**입니다.

## 트레이드오프/주의점

첫째, `R`과 `W`를 높이면 stale 가능성은 줄지만 p99와 실패율이 함께 오를 수 있습니다. 둘째, sloppy quorum과 hinted handoff는 가용성을 높이는 대신 "나중에 갚아야 할 정합성 빚"을 늘립니다. 셋째, read repair를 foreground에 너무 많이 두면 읽기 API가 사실상 쓰기 API처럼 변해 tail latency가 악화됩니다. 넷째, 타임스탬프 기반 충돌 해결은 구현은 쉽지만 클럭 오차와 늦은 패킷에 취약합니다.

추가로 조심할 점은, quorum 시스템의 문제를 애플리케이션 재시도로 덮으려는 습관입니다. stale read나 repair 지연은 재시도 몇 번으로 해결되지 않는 경우가 많고, 오히려 복구 중 트래픽만 증폭할 수 있습니다. [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/) 기준 없이 재시도를 늘리는 건 꽤 위험합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 키스페이스별로 stale 허용 시간과 도메인 비용을 분리했다.
- [ ] `N/R/W`뿐 아니라 `hint_ttl`, `repair_backlog_limit`, `cross_zone_repair_qps`를 정했다.
- [ ] stale read rate와 replica divergence age를 대시보드에 올렸다.
- [ ] foreground read repair가 읽기 p99에 미치는 영향을 따로 측정한다.
- [ ] 재고/결제처럼 stale 불가 도메인에는 quorum 기본값을 강제하지 않는다.

### 연습 과제

1. 현재 운영 중인 복제 저장소 하나를 골라 `N/R/W`, 허용 stale 시간, repair backlog 상한을 표로 정리해 보세요. 숫자를 적는 순간 지금의 정책 공백이 드러나는 경우가 많습니다.  
2. 노드 1개 장애 후 20분 복귀 시나리오를 가정해, hinted handoff 재주입 속도를 10분 단위로 어떻게 늘릴지 런북을 작성해 보세요.  
3. 사용자 프로필과 재고 차감 두 도메인을 비교해, 왜 하나는 quorum으로 가능하고 다른 하나는 강한 정합성이 필요한지 비용 기준으로 설명해 보세요.

## 관련 글

- [정합성 모델 한눈에 정리](/learning/deep-dive/deep-dive-consistency-models/)
- [CAP 이론을 실무에서 읽는 법](/learning/deep-dive/deep-dive-cap-theorem/)
- [Clock Skew를 전제로 한 시간 의미론 설계](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)
- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Snapshot Isolation과 Serializable, Write Skew 실전](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)
- [Timeout·Retry·Backoff 실전 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
