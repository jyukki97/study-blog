---
title: "Consensus 알고리즘: 분산 시스템의 합의"
date: 2025-12-15
draft: false
topic: "Architecture"
tags: ["Consensus", "Raft", "Paxos", "Distributed Systems", "CAP Theorem"]
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

- **Consensus 알고리즘**이 왜 필요한지 이해합니다.
- **Raft 알고리즘**의 동작 원리를 파악합니다.
- **분산 시스템의 일관성**을 보장하는 방법을 이해합니다.
- **실제 적용 사례**를 알 수 있습니다.

## 1) Consensus 문제

```
분산 시스템에서의 합의 문제:

Server A: value = 1
Server B: value = 2
Server C: value = 1

어떤 값이 진짜인가?

Consensus 알고리즘:
- 모든 서버가 같은 값에 합의
- 과반수 동의로 결정
- 장애 발생 시에도 동작
```

## 2) Raft 알고리즘

### 핵심 개념

```
1. Leader Election (리더 선출):
   - 하나의 Leader 선출
   - Leader가 모든 요청 처리

2. Log Replication (로그 복제):
   - Leader가 Follower에게 로그 복제
   - 과반수가 복제 완료 시 커밋

3. Safety (안전성):
   - 한 번 커밋된 로그는 변경 불가
   - 모든 서버가 같은 순서로 적용
```

### 동작 과정

```
1. Client → Leader: Write 요청

2. Leader → Followers: 로그 복제
   Server A: [1]
   Server B: [1]
   Server C: [1]

3. 과반수(2/3) 응답 → 커밋
   Leader → Client: OK

4. Followers에게 커밋 알림
```

## 3) 적용 사례

```
etcd (Kubernetes):
- Raft 사용
- 클러스터 설정 저장
- 리더 선출

Consul:
- Raft 사용
- 서비스 디스커버리
- 분산 잠금

ZooKeeper:
- ZAB (Zookeeper Atomic Broadcast)
- Paxos 변형
- 설정 관리
```

## 요약

- Consensus: 분산 시스템의 합의 알고리즘
- Raft: 이해하기 쉬운 Consensus 알고리즘
- Leader Election + Log Replication
- etcd, Consul 등에서 사용

## 다음 단계

- 분산 시스템: `/learning/deep-dive/deep-dive-distributed-systems/`
- CAP 이론: `/learning/deep-dive/deep-dive-cap-theorem/`
