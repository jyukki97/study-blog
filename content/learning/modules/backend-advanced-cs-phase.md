---
title: "9단계: 컴퓨터 공학 심화 (Deep CS)"
date: 2025-12-28
lastmod: 2026-10-22
draft: false
topic: "Backend Roadmap"
tags: ["CS", "Distributed Systems", "Database Internals", "OS"]
categories: ["Learning"]
description: "분산 시스템의 정합성 모델, DB 스토리지 엔진의 원리 등 시니어 레벨로 가기 위한 이론적 깊이를 다룹니다."
weight: 9
study_order: 90
layout: "learning-module"
module_key: "advanced-cs"
url: "/learning/modules/backend-advanced-cs-phase/"
---

## 이 단계에서 얻는 것

프레임워크나 라이브러리 사용법을 넘어, **시스템의 근본 원리(First Principles)**를 파고듭니다.  
왜 분산 시스템에서 데이터가 깨지는지, DB가 디스크에 어떻게 쓰는지 이해하면 "해결할 수 없는 문제"와 "해결할 수 있는 문제"를 구분할 수 있게 됩니다.

- **데이터 정합성(Consistency)**: Eventual Consistency가 실제 시스템에서 어떤 부작용을 낳는지, 어떻게 제어하는지 이해합니다.
- **스토리지 엔진**: B-Tree와 LSM-Tree의 차이를 알고, Write-heavy 워크로드에 맞는 DB를 선정할 수 있습니다.
- **분산 합의**: 리더가 죽었을 때 시스템이 어떻게 합의하고 복구하는지 원리를 봅니다.

## 커리큘럼 (Topic List)

### 1. 분산 시스템 이론 (Distributed Systems)
- **Consistency Models**: Linearizability(Strong) vs Sequential vs Eventual Consistency.
- **CAP & PACELC**: 단순히 "3개 중 2개"가 아니라, 지연(Latency)과 정합성(Consistency)의 트레이드오프 파악.
- **Clock Synchronization**: 물리적 시간의 한계와 Logical Clock (Lamport, Vector Clock).

### 2. 데이터베이스 내부 (Database Internals)
- **Storage Engines**: 
    - **B-Tree**: Read에 유리한 전통적 구조 (MySQL InnoDB).
    - **LSM-Tree (Log Structured Merge)**: Write에 유리한 구조 (Cassandra, RocksDB).
- **Transaction & WAL**: Crash Recovery를 위한 Write Ahead Log의 역할.

### 3. 운영체제와 네트워크 심화 (OS & Network)
- **I/O Models**: Blocking, Non-blocking, Multiplexing (Epoll), BIO/NIO/AIO 비교.
- **Zero Copy**: Kafka가 빠른 이유 (sendfile 시스템 콜).

## 이 단계의 핵심 주제

- 분산 정합성/합의(Consistency, Consensus)
- DB 스토리지 엔진(B-Tree/LSM, WAL)
- OS/네트워크 실행 모델(I/O, Zero Copy)

## 미니 실습

- **WAL 시뮬레이션**: 장애 시 복구 흐름을 순서도로 정리
- **CAP/PACELC 케이스 분석**: 서비스 하나를 골라 트레이드오프 정리
- **Zero Copy 추적**: sendfile 흐름을 다이어그램으로 정리

## 90분 심화 학습 루프

심화 CS는 용어를 많이 아는 것보다, **내 서비스의 선택을 설명하고 실패를 관측할 수 있는가**가 중요합니다. 한 번에 모든 논문과 구현을 읽기보다 아래 루프를 하나의 주제에 적용합니다. 각 단계에서 남긴 산출물은 다음 장애 분석이나 설계 리뷰에서 다시 사용할 수 있습니다.

1. **질문을 하나로 좁힙니다.** 예를 들어 “주문 상태를 여러 저장소에 쓸 때 무엇을 강하게 일관되게 해야 하는가?”처럼 사용자 영향이 드러나는 질문을 고릅니다. “CAP를 설명할 수 있는가?”처럼 범위가 큰 질문은 실험의 종료 조건을 만들기 어렵습니다.
2. **한 가지 계약을 씁니다.** 읽기 일관성, 중복 허용 범위, 최대 복구 시간, 데이터 유실 허용 여부 중 최소 하나를 문장으로 적습니다. `결제 완료는 한 번만 기록된다`, `검색 색인은 5분 늦어도 된다`처럼 검증 가능한 문장이 좋습니다.
3. **작은 실패를 주입합니다.** 프로세스를 재시작하거나 consumer를 두 번 실행하거나 DB 연결을 잠깐 끊어 봅니다. 운영 환경이 아니라 로컬·staging에서 재현하고, 데이터 손상 테스트는 전용 fixture로 한정합니다.
4. **관측값과 기대값을 비교합니다.** 요청 ID, sequence, WAL/transaction log, queue lag, retry 수 중 두 개 이상을 같은 시간축에서 확인합니다. 성공 응답만 보고 통과시키지 말고, 중복·지연·누락 중 무엇이 발생했는지 기록합니다.
5. **복구와 롤백 조건을 남깁니다.** 어떤 지표에서 write를 멈추고, 어떤 작업을 재처리하며, 어느 시점까지 되돌릴 수 있는지 적습니다. 이 단계가 없으면 이론 학습은 실제 변경 승인 기준으로 이어지지 않습니다.

### 예시: 재고 예약 API의 정합성 경계

재고 예약 API가 `available` 수량을 감소시키고 예약 이벤트를 발행한다고 가정합니다. 여기서 “DB 트랜잭션을 쓴다”는 말만으로는 충분하지 않습니다. 같은 상품에 동시 요청 100개를 보내고 worker를 중간에 종료했을 때, 아래의 세 질문에 답할 수 있어야 합니다.

- 감소한 재고와 예약 레코드의 개수가 항상 같은가? 다르다면 어느 저장소를 복구의 기준으로 삼는가?
- 이벤트가 두 번 전달되었을 때 consumer가 동일 예약을 두 번 처리하지 않는가? 멱등 키는 요청 경계와 소비 경계에서 모두 확인되는가?
- DB commit 뒤 publish 전에 프로세스가 죽으면 무엇이 남는가? outbox나 재처리 job이 그 간격을 어떤 근거로 메우는가?

이 실험의 통과 조건은 “에러가 없었다”가 아닙니다. `예약 성공 수 = 재고 감소 수 = 최종 소비 처리 수`를 요청 ID 기준으로 대조하고, 의도적으로 종료한 뒤에도 차이를 설명하거나 복구할 수 있어야 합니다. 차이가 발견되면 전역 retry 횟수를 올리기보다 먼저 쓰기 순서, 멱등 키의 보관 기간, 재처리 범위를 좁혀 봅니다.

## 주제별 연결 읽기 경로

아래 글은 이 모듈의 키워드를 실제 설계·운영 판단으로 연결합니다. 순서대로 모두 읽을 필요는 없고, 지금 다루는 문제의 경계에 맞는 경로 하나를 선택하면 됩니다.

| 문제 상황 | 먼저 볼 글 | 다음에 확인할 질문 |
| --- | --- | --- |
| 쓰기량이 늘어나는 데이터 저장소를 고르는 경우 | [LSM-Tree와 스토리지 엔진](/learning/deep-dive/deep-dive-database-engines-lsm/) | compaction·write amplification이 p99 지연과 디스크 여유 공간에 어떤 영향을 주는가? |
| 느린 조회와 인덱스 변경을 검토하는 경우 | [MySQL 인덱스와 EXPLAIN](/learning/deep-dive/deep-dive-mysql-index-explain/) | 추정 row 수와 실제 row 수가 다를 때 어떤 통계·쿼리 조건을 먼저 확인할 것인가? |
| 여러 인스턴스가 같은 작업을 수행할 수 있는 경우 | [분산 락](/learning/deep-dive/deep-dive-distributed-lock/) | 락 만료, 작업 시간, fencing token을 어떤 자원에 기록해 오래된 worker를 막을 것인가? |
| 연결·전송 병목을 분석하는 경우 | [TCP와 HTTP/2 기본](/learning/deep-dive/deep-dive-tcp-http2-basics/) | 애플리케이션 처리 시간과 네트워크 대기 시간을 어떤 지표로 분리할 것인가? |

각 글을 읽은 뒤에는 **가설 1개, 관측값 2개, 롤백 조건 1개**만 남겨도 충분합니다. 예를 들어 인덱스 추가 전에는 `EXPLAIN`의 예상 row 수와 실제 쿼리 p95를 기록하고, 배포 후 write 지연이나 lock wait가 기준을 넘으면 인덱스를 제거하거나 배포를 되돌린다는 조건을 둡니다. 이 정도의 작은 증거 묶음이 “이론적으로 좋아 보이는 변경”과 운영 가능한 변경을 구분해 줍니다.

## 완료 기준

- “왜 깨졌는지”를 1차 원리로 설명할 수 있다
- 스토리지 엔진 선택 기준을 말로 설명할 수 있다
- 합의/리더 선출의 핵심 개념을 정리할 수 있다
- 실제 서비스의 한 경계를 골라 계약·관측값·실패 주입 결과를 한 장으로 정리할 수 있다
- 변경을 멈추거나 되돌릴 지표와 담당 경계를 설명할 수 있다

## 추천 학습 자료
- **책**: *Data-Intensive Applications (데이터 중심 애플리케이션 설계)* - 팀장급 필독서
- **논문**: Google Spanner, Amazon Dynamo, Raft Consensus
