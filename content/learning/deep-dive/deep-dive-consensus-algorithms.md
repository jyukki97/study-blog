---
title: "Consensus 알고리즘: 분산 시스템의 합의"
date: 2025-12-15
draft: false
topic: "Architecture"
tags: ["Consensus", "Raft", "Paxos", "Distributed Systems", "CAP Theorem", "Leader Election"]
categories: ["Backend Deep Dive"]
description: "Raft와 Paxos 같은 Consensus 알고리즘으로 분산 시스템의 일관성을 보장하는 원리"
module: "architecture"
study_order: 465
quizzes:
  - question: "분산 시스템에서 Consensus(합의) 알고리즘이 필요한 이유는?"
    options:
      - "성능을 높이기 위해"
      - "여러 서버가 서로 다른 값을 가질 때, 어떤 값이 '진짜'인지 합의하여 일관성을 보장하기 위해"
      - "데이터를 암호화하기 위해"
      - "서버를 줄이기 위해"
    answer: 1
    explanation: "분산 시스템에서 네트워크 장애나 서버 장애로 상태가 불일치할 수 있습니다. Consensus 알고리즘으로 과반수 동의를 통해 일관된 값을 결정합니다."

  - question: "Raft 알고리즘에서 Leader의 역할은?"
    options:
      - "데이터를 저장하지 않음"
      - "모든 클라이언트 요청을 받아 처리하고, Follower들에게 로그를 복제하는 단일 진입점"
      - "Follower와 동일한 역할"
      - "백업 역할만 수행"
    answer: 1
    explanation: "Raft는 Strong Leader 모델입니다. Leader만 쓰기 요청을 처리하고 Follower에게 복제합니다. Leader가 죽으면 Follower 중 하나가 새 Leader로 선출됩니다."

  - question: "Raft에서 로그가 '커밋'되었다고 판단하는 기준은?"
    options:
      - "Leader가 저장했을 때"
      - "과반수(Majority)의 서버가 로그를 복제했을 때"
      - "모든 서버가 복제했을 때"
      - "클라이언트가 확인했을 때"
    answer: 1
    explanation: "5대 중 3대(과반수)가 로그를 저장하면 커밋됩니다. 네트워크 분단 시에도 과반수가 있는 쪽에서 서비스가 계속될 수 있습니다."

  - question: "etcd, Consul 같은 분산 설정 저장소가 Raft를 사용하는 이유는?"
    options:
      - "속도가 빠르기 때문"
      - "클러스터 설정, 리더 선출 등에서 모든 노드가 일관된 정보를 가져야 하기 때문"
      - "보안 때문"
      - "비용이 저렴해서"
    answer: 1
    explanation: "Kubernetes의 etcd는 클러스터 상태(Pod 정보 등)를 저장합니다. 모든 노드가 같은 상태를 봐야 하므로 Raft로 일관성을 보장합니다."

  - question: "Raft와 Paxos의 관계로 올바른 것은?"
    options:
      - "완전히 다른 문제를 해결한다."
      - "Raft는 Paxos의 복잡한 개념을 이해하기 쉽게 재설계한 알고리즘이다."
      - "Paxos가 Raft보다 더 쉽다."
      - "둘은 동일한 알고리즘이다."
    answer: 1
    explanation: "Paxos는 정확하지만 이해하기 어렵습니다. Raft는 'Leader 선출 → 로그 복제 → 안전성'으로 단계를 명확히 나눠 이해하기 쉽게 만들었습니다."
---

## 이 글에서 얻는 것

- 분산 시스템에서 **왜 합의(Consensus)가 필수인지**를 장애 시나리오 중심으로 이해합니다.
- Raft의 핵심(Leader Election, Log Replication, Commit, Safety)을 **단계별로 설명**할 수 있습니다.
- Paxos/Multi-Paxos와 Raft의 차이를 실무 관점(운영 난이도, 구현 복잡도)에서 비교할 수 있습니다.
- etcd/Consul/ZooKeeper 같은 실제 시스템에서 합의 알고리즘이 어떻게 쓰이는지 연결할 수 있습니다.

---

## 1) Consensus 문제: "누가 맞는 상태인가?"

분산 시스템은 장애가 "예외"가 아니라 "일상"입니다.

- 네트워크 분단(Network Partition)
- 노드 크래시
- GC stop-the-world로 인한 일시적 응답 정지
- 메시지 지연/중복/역순 도착

이때 가장 어려운 질문은 이것입니다.

> **서버 A/B/C가 서로 다른 값을 갖게 됐을 때, 어느 값을 정답으로 볼 것인가?**

### 1-1) 합의가 없을 때 생기는 사고

```
초기 상태: 잔액 100

T1: Server A에서 -30 처리 → 70
T2: Server B에서 +50 처리 → 150

네트워크 분단 발생:
- A는 B와 통신 불가
- 클라이언트는 각각 다른 서버에 쓰기 요청

결과:
A의 상태 = 70
B의 상태 = 150
C의 상태 = 100 (아직 반영 못 받음)
```

합의 메커니즘이 없으면,

- 어떤 값이 최신인지 모름
- 중복 적용/누락 적용이 동시에 발생
- 결국 데이터 정합성 붕괴

### 1-2) Consensus가 보장하려는 최소 성질

| 속성 | 의미 |
|------|------|
| **Safety** | 서로 다른 두 값이 동시에 "커밋"되지 않는다 |
| **Liveness** | 장애가 해소되면 결국 진행된다 |
| **Fault Tolerance** | 일부 노드가 죽어도 과반수로 동작 가능 |

---

## 2) 왜 "과반수(Majority)"를 쓰는가

Consensus에서 핵심은 quorum(정족수)입니다.

- 3노드 → 과반수 2
- 5노드 → 과반수 3
- 7노드 → 과반수 4

과반수를 쓰는 이유는 **교집합 보장** 때문입니다.

### 2-1) 교집합 성질

```
5노드 클러스터: {A, B, C, D, E}

정족수 예시1: {A, B, C}
정족수 예시2: {C, D, E}

교집합: {C}
```

어떤 두 과반수 집합도 최소 1개 이상 겹치므로,
이미 커밋된 값을 모르는 "완전한 별도 집합"이 생기지 않습니다.

이 한 가지 성질이 split-brain 방지의 수학적 기반입니다.

---

## 3) Raft 알고리즘: 이해 가능한 Consensus

Raft는 "이해하기 쉬운 Consensus"를 목표로 설계되었습니다.

핵심은 세 가지입니다.

1. **Leader Election**
2. **Log Replication**
3. **Safety Rule**

### 3-1) 노드 상태와 Term

Raft 노드는 세 상태 중 하나입니다.

- **Follower**: 기본 상태, Leader의 로그를 받음
- **Candidate**: 선거 시작 상태
- **Leader**: 클라이언트 쓰기 요청 처리

그리고 모든 동작은 **term(선거 세대)** 단위로 진행됩니다.

```
term 10: Leader = A
term 11: A 장애 → B가 Leader 선출
term 12: 네트워크 분단 회복 후 C가 더 높은 term으로 재선출
```

**원칙**: 더 높은 term을 본 노드는 즉시 follower로 내려갑니다.

### 3-2) Leader Election 동작

```
1) Follower는 heartbeat를 기다림
2) 타임아웃(election timeout) 발생 시 Candidate 전환
3) Candidate는 RequestVote RPC 전송
4) 과반수 표 획득 시 Leader 당선
5) 당선 직후 heartbeat(AppendEntries) 전송
```

타임아웃을 랜덤(예: 150~300ms)으로 두는 이유:

- 동시에 여러 candidate가 생기는 충돌 확률 감소
- 빠른 수렴

### 3-3) Log Replication과 Commit

Leader만 클라이언트 쓰기를 받습니다.

```
Client --write(x=10)--> Leader(A)
Leader A:
  1) 자신의 로그에 append
  2) Follower들에게 AppendEntries 전송
  3) 과반수 ack 수신 시 commitIndex 증가
  4) 상태 머신 적용
  5) Client에 성공 응답
```

**중요**: Leader가 로컬에 썼다고 바로 성공 응답하면 안 됩니다. 반드시 과반수 복제 후 응답해야 합니다.

### 3-4) Log Matching Property

Raft 안전성의 핵심 규칙:

- 같은 index, 같은 term의 로그는 동일한 명령
- follower가 충돌 로그를 가지면 leader 로그에 맞춰 잘라냄

```text
Leader log:   [1:a][2:b][3:c][4:d]
Follower log: [1:a][2:b][3:x][4:y]

AppendEntries(prevLogIndex=2, prevLogTerm=b)
→ follower는 index 3부터 충돌 구간 삭제 후 c,d로 맞춤
```

### 3-5) Snapshot/Compaction

로그가 무한히 커지면 복구 시간이 길어집니다.

Raft는 주기적으로 snapshot을 떠서 오래된 로그를 압축합니다.

```
Before:
[1..10_000_000] huge logs

Snapshot at index 9_500_000
After:
snapshot(<=9_500_000) + logs[9_500_001..]
```

신규 노드는 snapshot + tail log만 받아 빠르게 catch-up합니다.

---

## 4) Paxos와 Multi-Paxos: 정확하지만 어려운 이유

Paxos는 이론적으로 매우 강력하지만 구현/운영 난이도가 높습니다.

### 4-1) Basic Paxos 두 단계

1. **Prepare/Promise**
2. **Accept/Accepted**

과반수 동의가 필요하다는 점은 Raft와 같지만,
라운드 번호와 제안 충돌 처리 로직이 직관적이지 않습니다.

### 4-2) Multi-Paxos

연속된 로그 슬롯을 처리하기 위해 Leader를 사실상 고정하면,
Raft와 유사한 형태가 됩니다.

그래서 실무에서는 종종 이렇게 정리합니다.

- **Raft**: 이해/구현/운영이 상대적으로 쉬움
- **Paxos 계열**: 이론적 유연성은 높지만 구현 난이도 큼

---

## 5) Raft vs Paxos vs ZAB 비교

| 항목 | Raft | Paxos / Multi-Paxos | ZAB (ZooKeeper) |
|------|------|---------------------|-----------------|
| 이해 난이도 | 낮음 | 높음 | 중간 |
| 리더 모델 | Strong Leader | 구현체에 따라 다름 | Leader 중심 |
| 로그 복제 | 명시적 | 라운드/슬롯 기반 | Zab proposal/commit |
| 운영 경험 | etcd/Consul 풍부 | 시스템별 편차 큼 | ZooKeeper 생태계 |
| 신규 팀 도입 | 유리 | 불리 | 중간 |

---

## 6) 실전 장애 시나리오로 보는 Consensus

### 시나리오 A: Leader 장애

- 5노드 클러스터에서 Leader 1대 다운
- 남은 4노드 중 과반수(3) 확보 가능
- 새 Leader 선출 후 서비스 지속

**영향**: 짧은 선출 지연(수백 ms~수초)

### 시나리오 B: 네트워크 분단 (2 vs 3)

- 2노드 파티션: 과반수 미달 → 쓰기 중단
- 3노드 파티션: 과반수 충족 → 쓰기 계속

즉, "둘 다 쓰기 가능" 상태를 금지해서 split-brain을 막습니다.

### 시나리오 C: 느린 디스크/긴 GC

- 노드가 죽지 않았지만 heartbeat를 제때 못 보냄
- follower가 선거 시작 → 불필요한 leader 교체(leader flapping)

대응:

- 디스크/GC 튜닝
- election timeout 상향
- 리더 노드 전용 자원 보장

---

## 7) etcd / Consul / ZooKeeper에서의 적용

### 7-1) etcd (Kubernetes 제어평면 핵심)

- Kubernetes API Server 상태 저장소
- 키-값 쓰기마다 Raft 로그 커밋
- watch 기능으로 변경 이벤트 전달

운영 포인트:

- 3노드 또는 5노드 구성 권장
- 디스크 IOPS가 낮으면 선거 불안정
- snapshot/defrag 주기 관리 필수

### 7-2) Consul

- 서비스 디스커버리 + KV + 리더 선출
- 서버 노드가 Raft 클러스터 구성

운영 포인트:

- WAN federation 시 지연 고려
- 세션 락(분산 락) TTL/renew 설정 중요

### 7-3) ZooKeeper (ZAB)

- HBase/Kafka(구버전) 메타데이터 관리
- 순차 노드/ephemeral 노드 기반 coordination

운영 포인트:

- Zab 특성 이해 필요
- JVM 튜닝/GC 영향 큼

---

## 8) 클러스터 크기 설계: 3노드 vs 5노드 vs 7노드

| 노드 수 | 허용 장애 수 | 쓰기 지연 | 운영 난이도 | 권장 |
|--------|-------------|----------|------------|------|
| 3 | 1 | 낮음 | 낮음 | 기본 선택 |
| 5 | 2 | 중간 | 중간 | 중요한 프로덕션 |
| 7 | 3 | 높음 | 높음 | 매우 큰 환경 |

일반적인 권장:

- 대부분은 **3 또는 5노드**가 최적
- 7노드는 장애 허용은 늘지만 쓰기 quorum 비용과 운영 복잡도가 커짐

---

## 9) Multi-Region에서 합의: 지연과 가용성의 거래

다중 리전에 Raft를 바로 확장하면 RTT가 증가해서 commit 지연이 커집니다.

예시:

- 서울-도쿄 RTT: 30ms
- 서울-프랑크푸르트 RTT: 250ms

quorum에 원거리 노드가 포함되면 쓰기 P99가 급격히 상승합니다.

실무 패턴:

1. 단일 리전 Raft + 비동기 복제(재해복구 중심)
2. 3리전 구성 시 "가까운 2 + 먼 1" 배치로 quorum 지연 최소화
3. 읽기-쓰기 분리(원거리 리전은 read-only 캐시)

---

## 10) 구현 시 흔한 실수 (안티패턴)

| # | 실수 | 결과 | 예방 |
|---|------|------|------|
| 1 | 짝수 노드(4대) 구성 | 장애 허용은 3대와 동일, 비용만 증가 | 3/5/7처럼 홀수 구성 |
| 2 | Leader 로컬 append 후 즉시 응답 | 장애 시 데이터 유실 | 과반수 commit 후 응답 |
| 3 | 선거 타임아웃 과도하게 짧게 설정 | leader flapping | RTT/GC 고려해 timeout 상향 |
| 4 | 느린 디스크를 무시 | append 지연, 선거 빈발 | IOPS/SYNC latency 모니터링 |
| 5 | snapshot/compaction 미설정 | 복구 시간 폭증 | 주기적 snapshot/defrag |
| 6 | 노드 시간 동기화 무시 | 장애 분석 혼선 | NTP 동기화 강제 |
| 7 | 운영자 수동 failover 절차 부재 | 장애 시 대응 지연 | runbook + 리허설 |

---

## 11) 운영 체크리스트

### 배포 전
- [ ] 클러스터 크기(3/5)와 장애 허용 목표 합의
- [ ] 디스크 latency SLO 정의 (예: fsync P99 < 10ms)
- [ ] heartbeat/election timeout 값 문서화
- [ ] snapshot/compaction 정책 설정

### 일일 운영
- [ ] leader 변경 횟수(leader changes/hour) 모니터링
- [ ] commit latency P95/P99 확인
- [ ] follower lag(적용 지연) 확인
- [ ] quorum 손실 알람 테스트

### 장애 대응
- [ ] 네트워크 분단 시 과반수 파티션만 쓰기 허용 확인
- [ ] split-brain 가능성 점검 (동시 leader 감지)
- [ ] 장애 복구 후 로그 정합성 검증

---

## 12) 인터뷰/실무 자주 나오는 질문

### Q1. 왜 2노드 Raft는 추천하지 않나?

2노드는 과반수=2라서 1대만 죽어도 쓰기 불가입니다. 장애 허용이 0과 거의 같아서 실익이 없습니다.

### Q2. 읽기는 follower에서 받아도 되나?

가능하지만 stale read를 허용해야 합니다. 강한 일관성이 필요하면 leader read(또는 read index 확인)를 사용합니다.

### Q3. 리더 선출 시간이 긴데 어떻게 줄이나?

- 네트워크 RTT/패킷 손실 점검
- 디스크 fsync 지연 점검
- GC pause 줄이기
- timeout 파라미터 조정

---

## 요약

- Consensus는 "분산 상태의 정답을 하나로 만드는 장치"입니다.
- Raft의 핵심은 **과반수 기반 Leader + 로그 복제 + 안전성 규칙**입니다.
- 실무에서는 알고리즘 이론만큼 **운영 품질(디스크/네트워크/모니터링)**이 중요합니다.
- 3/5 노드 설계, timeout 튜닝, snapshot 운영, 장애 runbook이 있어야 안정적으로 굴러갑니다.

---

## 다음 단계

- [CAP 정리와 분산 시스템](/learning/deep-dive/deep-dive-cap-theorem/)
- [Consistency Models](/learning/deep-dive/deep-dive-consistency-models/)
- [분산 락](/learning/deep-dive/deep-dive-distributed-lock/)
- [DB 복제 & 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [MSA 패턴](/learning/deep-dive/deep-dive-msa-patterns/)
