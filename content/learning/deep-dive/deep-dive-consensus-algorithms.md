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
