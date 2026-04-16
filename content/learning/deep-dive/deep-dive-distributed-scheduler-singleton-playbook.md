---
title: "백엔드 커리큘럼 심화: 분산 스케줄러 Singleton 실행 보장 플레이북 (Lease·Fencing·Idempotency)"
date: 2026-04-04
draft: false
topic: "Backend Operations"
tags: ["Distributed Scheduler", "Lease", "Fencing Token", "Idempotency", "Batch Operations", "Reliability"]
categories: ["Backend Deep Dive"]
description: "멀티 인스턴스 환경에서 배치/크론 작업이 중복 실행되는 사고를 줄이기 위해 Lease·Fencing·Idempotency를 함께 설계하는 실무 기준을 숫자와 우선순위 중심으로 정리합니다."
module: "resilience-system"
study_order: 1165
---

쿠버네티스나 오토스케일 환경에서 스케줄러 작업을 운영하다 보면 같은 질문을 반복하게 됩니다.  
"이 작업, 진짜 한 번만 실행된 게 맞나?"

문제는 코드 한 줄이 아니라 실행 환경입니다. 인스턴스가 늘고 줄고, 네트워크가 흔들리고, GC pause가 길어지면 "리더 1개"라는 가정이 쉽게 깨집니다. 그 결과는 대부분 비슷합니다. 정산 배치 중복 실행, 중복 알림 발송, 외부 결제 API 이중 호출, 재고 재계산 꼬임처럼 **복구 비용이 큰 운영 사고**로 이어집니다.

이 글은 "분산 환경에서 배치를 Singleton으로 안전하게 실행"하는 기준을, 이론보다 운영 관점으로 정리합니다. 핵심은 단순 락 1개가 아니라 **Lease(점유 시간) + Fencing(실행 권한 버전) + Idempotency(효과 중복 방지)**를 함께 설계하는 것입니다.

## 이 글에서 얻는 것

- 분산 스케줄러에서 Singleton 가정이 깨지는 대표 실패 모드(네트워크 분할, 느린 stop-the-world, 시계 오차)를 구조적으로 이해할 수 있습니다.
- "락을 잡았으니 안전하다" 수준을 넘어, **fencing token과 멱등성 계층**을 붙여 실제 중복 효과를 줄이는 방법을 가져갈 수 있습니다.
- 운영 중 의사결정에 바로 쓰는 기준(lease TTL, 갱신 임계치, 재시도 한도, 수동 개입 조건)을 숫자로 설정할 수 있습니다.

## 핵심 개념/이슈

### 1) 왜 Singleton 작업이 깨지는가: 리더 선출보다 느린 실패 감지

대부분 팀은 "분산 락 = 단일 실행 보장"으로 이해하고 시작합니다. 하지만 실제 사고는 락 알고리즘 자체보다 **실패 감지 지연**에서 발생합니다.

대표 시나리오:

1. 인스턴스 A가 락 획득 후 작업 실행
2. A가 GC pause 또는 네트워크 단절로 heartbeat 중단
3. TTL 만료 후 인스턴스 B가 락 획득, 같은 작업 실행 시작
4. A가 복귀해 남은 작업을 계속 수행

결과적으로 A와 B가 동시에 같은 외부 자원을 건드릴 수 있습니다. 이 문제는 [Clock Skew/시간 의미론 플레이북](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)에서 다룬 것처럼 "시간 기반 제어의 오차"를 전제로 설계해야 줄일 수 있습니다.

### 2) Lease만으로는 부족하다: 실행 권한 버전(Fencing Token)이 필요하다

Lease는 "누가 지금 리더인가"를 표현하지만, 다운스트림은 그 정보를 모릅니다. 그래서 오래된 리더가 늦게 도착한 쓰기를 수행해도 막지 못합니다.

이때 필요한 게 fencing token입니다.

- 락 획득 시 단조 증가하는 `token` 발급
- 모든 쓰기/명령에 `token` 포함
- 다운스트림은 "이전 token보다 작은 요청"을 거부

즉, 리더가 둘이 되어도 **최신 권한만 효과를 남기게** 만듭니다. 분산 락 자체는 [분산 락 기본 원리](/learning/deep-dive/deep-dive-distributed-lock/)를 따르되, 실제 안전성은 fencing 검증 계층에서 확보합니다.

### 3) Singleton의 목표는 "실행 1회"가 아니라 "효과 1회"다

운영에서 진짜 중요한 건 실행 횟수가 아니라 결과 중복입니다. 네트워크 재시도와 장애 복구를 고려하면 "exactly-once 실행"은 비용이 매우 높고, 현실적으로는 **effectively-once(효과 중복 최소화)**가 더 실용적입니다.

필수 장치:

- Idempotency key (`job_name + business_date + shard`)
- dedupe window (예: 24~72시간)
- side effect 기록 테이블(성공/실패/보상 상태)

이 구조는 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/) 및 [아웃박스+CDC 패턴](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)과 함께 봐야 운영 복구가 쉬워집니다.

### 4) 재시도 전략이 잘못되면 Singleton 보호층이 오히려 무너진다

장애 직후 재시도를 빠르게 몰아치면 다음 문제가 생깁니다.

- 락 서버/DB에 동시 갱신 부하 집중
- 같은 키에 경쟁성 재진입 폭증
- 외부 API rate limit과 연쇄 실패

권장 기준(초기값):

- 즉시 재시도 0회, 지수 백오프(1s, 2s, 4s...) + jitter 20%
- 작업 단위 최대 재시도 5회
- 10분 내 실패율 20% 초과 시 자동 중지 + 수동 승인 모드

재시도는 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)과 묶어서 "성공률"이 아니라 "시스템 안정성" 기준으로 튜닝해야 합니다.

## 실무 적용

### 1) 권장 참조 아키텍처

1. **Scheduler Trigger**: cron 또는 event 기반 트리거 생성
2. **Leader Lease Store**: DB/Redis/etcd에 lease + token 저장
3. **Execution Guard**: 현재 token 검증 후 작업 시작
4. **Idempotency Store**: 작업 효과 중복 체크
5. **Side Effect Executor**: 외부 API/DB 반영
6. **Audit Trail**: token, key, outcome 기록

핵심은 "락"과 "효과 기록"을 분리하는 것입니다. 락은 실행 권한, 멱등성은 결과 보호 역할입니다.

### 2) 최소 데이터 모델 예시

```sql
CREATE TABLE scheduler_lease (
  job_name        VARCHAR(100) PRIMARY KEY,
  owner_id        VARCHAR(100) NOT NULL,
  fencing_token   BIGINT       NOT NULL,
  lease_until     TIMESTAMP    NOT NULL,
  updated_at      TIMESTAMP    NOT NULL
);

CREATE TABLE job_effect_log (
  idempotency_key VARCHAR(160) PRIMARY KEY,
  job_name        VARCHAR(100) NOT NULL,
  fencing_token   BIGINT       NOT NULL,
  status          VARCHAR(20)  NOT NULL, -- STARTED, SUCCEEDED, FAILED, COMPENSATED
  started_at      TIMESTAMP    NOT NULL,
  finished_at     TIMESTAMP
);
```

토큰은 단조 증가해야 하며, 다운스트림 쓰기 경로에서 `incoming_token >= last_applied_token` 조건을 강제해야 합니다.

### 3) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **데이터 무결성 > 중복 방지 > 처리 지연 최소화** 순으로 두는 것이 안전합니다.

- Lease TTL: `max(작업 p99 실행시간 × 3, 30초)`
- Heartbeat 주기: TTL의 1/3 이하(예: TTL 45초면 10~15초)
- 스틸(재획득) 허용 조건: `현재시각 > lease_until + clock_skew_budget`
- clock_skew_budget: 리전 간 운영이면 200~500ms, 단일 존은 50~150ms부터 시작
- fencing token 역전 감지 시: 즉시 쓰기 거부 + P1 알림
- 동일 idempotency key 중복 시: 두 번째 실행은 side effect 금지하고 "중복 탐지" 이벤트만 기록

운영 중단 기준 예시:

- 15분 내 `duplicate_effect_detected >= 1` → 자동 중단 후 수동 승인
- 10분 이동창 `lease_conflict_rate > 3%` → 스케줄 간격 증가 또는 shard 분할
- 외부 API 429 비율 5% 초과 → 배치 동시성 50% 감축

### 4) 도입 순서(4주)

**1주차: 관측 먼저**  
기존 배치에 실행 ID, idempotency key, owner 정보를 로그/메트릭으로 추가합니다.

**2주차: Lease + Token 적용**  
락 획득 시 token 발급, 작업 컨텍스트에 token 전파, 다운스트림 검증 로직을 도입합니다.

**3주차: Idempotency 계층 적용**  
효과 로그 테이블과 dedupe window를 붙이고, 중복 실행 시 side effect를 차단합니다.

**4주차: 운영 자동화**  
임계치 기반 자동 중지, 재시도 상한, 알림 룰을 런북으로 고정합니다.

장기 실행/재시작 복구가 중요한 워크플로라면 [Temporal 오케스트레이션](/learning/deep-dive/deep-dive-temporal-workflow-orchestration/)을 비교 검토하는 것이 좋습니다.

## 트레이드오프/주의점

1) **TTL을 길게 잡으면 중복은 줄지만 장애 복구가 느려진다**  
TTL 2분이면 안정적이지만 리더 장애 시 2분 가까이 작업이 멈출 수 있습니다.

2) **fencing 검증은 다운스트림 협조가 필요하다**  
모든 저장소/외부 API가 token 비교를 지원하지 않으면 일부 경로는 여전히 취약합니다.

3) **멱등성 저장소도 운영 비용이 든다**  
키 저장량, TTL 정리, 인덱스 관리가 필요하고 고QPS 배치에서는 비용이 작지 않습니다.

4) **"exactly-once"를 약속하면 복구가 더 어려워질 수 있다**  
실무에선 정확한 용어를 쓰는 게 중요합니다. 계약 문구는 "중복 효과 방지"와 "보상 절차"를 함께 명시하세요.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 스케줄러 작업마다 idempotency key 규칙이 문서화되어 있다.
- [ ] lease와 fencing token이 분리된 저장 구조로 운영된다.
- [ ] 다운스트림 쓰기 경로가 token 역전 요청을 거부한다.
- [ ] 중복 탐지/lease 충돌/재시도 폭주 알림 임계치가 숫자로 정의되어 있다.
- [ ] 장애 시 자동 중지 후 수동 승인 전환 런북이 존재한다.

### 연습 과제

1. 최근 2주 배치 로그에서 `job_name + business_date` 기준 중복 실행 비율을 계산해 보세요.  
2. 현재 TTL/heartbeat 설정으로 "GC pause 20초 + 네트워크 단절 15초" 시나리오를 시뮬레이션하고, 이중 실행 가능 구간을 추정해 보세요.  
3. 가장 위험한 외부 API 1개를 골라 fencing token 또는 idempotency key 검증을 강제했을 때, 실패 복구 시간이 어떻게 변하는지 측정해 보세요.

## 관련 글

- [Clock Skew를 전제로 한 시간 의미론 설계](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)
- [분산 락(Distributed Lock) 실전](/learning/deep-dive/deep-dive-distributed-lock/)
- [멱등성 API 설계](/learning/deep-dive/deep-dive-idempotency/)
- [Timeout/Retry/Backoff 운영 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Temporal 워크플로 오케스트레이션](/learning/deep-dive/deep-dive-temporal-workflow-orchestration/)
