---
title: "백엔드 커리큘럼 심화: Usage Metering·Quota·청구 정합성을 한 번에 설계하는 방법"
date: 2026-03-12
draft: false
topic: "Architecture"
tags: ["Usage Metering", "Billing", "Quota", "Idempotency", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "사용량 계량, 실시간 쿼터 차단, 월말 청구 정산을 분리·연결해서 운영하는 실무 아키텍처와 의사결정 기준을 정리합니다."
module: "data-system"
study_order: 472
---

## 이 글에서 얻는 것

- Usage Metering(계량), Quota Enforcement(실시간 제한), Billing(청구)을 한 시스템으로 뭉개지 않고 **역할 분리**하는 설계 기준을 얻습니다.
- 중복 이벤트, 지연 도착, 역순 처리 같은 현실 문제에서 청구 오차를 통제하는 **정합성 운영 규칙**을 익힙니다.
- 트래픽/오차율/결제 민감도 기준으로 "지금 우리 팀이 어디까지 구현해야 하는지"를 숫자로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 계량·쿼터·청구는 목적이 다르다

현업에서 가장 흔한 실패는 세 문제를 하나로 처리하려는 접근입니다.

- **계량(Metering)**: 무엇을 얼마나 썼는지 사실(fact)을 남긴다.
- **쿼터(Quota)**: 지금 이 요청을 허용할지 차단할지 빠르게 판단한다.
- **청구(Billing)**: 계약/요금제 규칙에 맞춰 금액을 계산하고 확정한다.

세 목적의 지연 허용치가 다릅니다.

- 쿼터 판단: 보통 p95 20~50ms 이내 필요
- 계량 적재: 수초 단위 지연 허용 가능
- 청구 확정: T+1일 또는 월말 배치도 가능

이걸 한 저장소/한 트랜잭션에 몰아넣으면, 빠른 경로와 정확한 경로가 서로 발목을 잡습니다. 이 구조는 [레이트 리밋/백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/), [멀티테넌시 전략](/learning/deep-dive/deep-dive-multitenancy-strategy/)과 같이 봐야 설계가 안정됩니다.

### 2) 원장(ledger)은 불변 이벤트, 청구서는 파생 결과

청구 정합성의 핵심은 "원본 사실"을 보존하는 것입니다.

권장 모델:

1. **Raw Usage Ledger**: 이벤트 단위 불변 저장 (`tenant_id`, `event_id`, `metric`, `quantity`, `occurred_at`)
2. **Aggregated Usage**: 시간/플랜 단위 집계 (시간별·일별)
3. **Invoice Line Item**: 과금 규칙 적용 후 금액 산출 결과

원장을 불변으로 두면, 요금제 변경/버그 수정/환불 정책 변경 시 재정산(re-rating)이 가능합니다. 반대로 집계 테이블만 남기면 재현이 어려워집니다. 이벤트 안정 적재는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), 중복 방지는 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)를 함께 적용하는 게 안전합니다.

### 3) Exactly-once 환상을 버리고, 오차 통제 규칙을 설계한다

과금 시스템에서 "완전한 exactly-once"를 보장하려고 하면 복잡도가 급상승합니다. 실무에서는 보통 아래 원칙이 현실적입니다.

- 전송/소비는 at-least-once 허용
- 처리 단계마다 `event_id` 기반 멱등 적용
- 집계는 워터마크(예: 10분 지연 허용) 기준으로 확정
- 확정 이후 늦게 온 이벤트는 보정 레코드(adjustment)로 반영

운영 지표 예시:

- 중복 이벤트 비율 0.5% 이내
- T+24시간 내 정산 오차율 0.1% 이내
- 조정 분개(adjustment) 비중 2% 초과 시 파이프라인 이상 징후

메시지 유실/재처리 시나리오는 [Kafka Retry/DLQ](/learning/deep-dive/deep-dive-kafka-retry-dlq/), [Batch 재처리 전략](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)과 연동해 운영해야 합니다.

### 4) 실시간 쿼터는 "정확도 100%"보다 "안전한 방향 오차"가 중요하다

쿼터 차단은 완벽 정산 시스템이 아니라 보호 장치입니다. 그래서 다음과 같은 안전 방향을 먼저 정의해야 합니다.

- 과소 차단(써야 할 사용량보다 적게 막는 것) vs 과다 차단(정상 요청을 막는 것)
- B2C freemium: 과다 차단이 이탈을 키우므로 완화적 전략 선호
- B2B 고비용 API: 과소 차단이 비용 손실이 커서 보수적 전략 선호

의사결정 기준 예시:

- 요청당 원가가 높은 모델(API, GPU): 보수적 차단 + 짧은 캐시 TTL(1~5초)
- 요청당 원가가 낮은 일반 API: 완화적 차단 + 주기적 보정(30~120초)

핵심은 "정책-원가-고객경험"의 우선순위를 문서화하는 것입니다.

## 실무 적용

### 1) 권장 아키텍처(중간 규모 SaaS 기준)

- Ingest API: 사용 이벤트 수신, 스키마/서명 검증
- Event Bus(Kafka/PubSub): 비동기 적재, 재처리 경로 분리
- Metering Processor: 정규화 + 멱등 체크 + 원장 저장
- Quota Service: 저지연 조회 저장소(예: Redis) 기반 허용/차단
- Billing Engine: 요금제 룰 적용, 청구 라인 생성
- Reconciliation Job: 원장/집계/청구서 대사

경험적으로 tenant당 1k rps 이상이면 실시간 경로(Quota)와 정산 경로(Billing)를 분리하는 게 운영 부담이 낮습니다.

### 2) 데이터 모델 최소 세트

```sql
-- 불변 원장
create table usage_ledger (
  tenant_id        varchar(64) not null,
  event_id         varchar(64) not null,
  metric_code      varchar(64) not null,
  quantity         numeric(20,6) not null,
  occurred_at      timestamptz not null,
  ingested_at      timestamptz not null default now(),
  primary key (tenant_id, event_id)
);

-- 일 단위 집계
create table usage_daily_agg (
  tenant_id        varchar(64) not null,
  metric_code      varchar(64) not null,
  usage_date       date not null,
  quantity_sum     numeric(20,6) not null,
  primary key (tenant_id, metric_code, usage_date)
);
```

여기서 중요한 건 PK 자체가 멱등 키라는 점입니다. 중복 소비가 와도 원장은 한 번만 반영됩니다.

### 3) 운영 임계치와 우선순위(예시)

- **P0**: 청구 금액 오차율 0.3% 초과 → 신규 기능 중단, 정산 파이프라인 복구 우선
- **P1**: Quota 판단 p95 80ms 초과 15분 지속 → 캐시 정책/핫키 분산 조치
- **P1**: 원장 적재 지연 5분 초과 → 컨슈머 증설 + DLQ 누적 확인
- **P2**: 보정 분개 비율 2% 초과 → 이벤트 스키마/시계 동기화 점검

실무 우선순위는 보통 **정확한 청구 > 서비스 안정성 > 개발 편의성** 순서가 안전합니다.

### 4) 6주 도입 플랜(초기 구축팀 기준)

1. 1~2주차: 원장 스키마 + ingest 검증 + idempotency 키 강제
2. 3주차: 쿼터 읽기 모델(저지연 캐시) 구성, 차단 정책 A/B 테스트
3. 4주차: 요금제 룰 엔진(고정요금 + 단위요금 + free tier) 적용
4. 5주차: 대사 배치 + 오차 리포트 자동화
5. 6주차: 환불/조정 분개 워크플로와 운영 런북 완성

런북 설계는 [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/), [데이터 보존/삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 함께 맞추는 게 좋습니다.

## 트레이드오프/주의점

1) **초기부터 과도한 정확성을 추구하면 출시가 지연됩니다.**  
처음에는 원장 정합성과 멱등 처리부터 고정하고, 고급 할인/크레딧 룰은 2단계로 미루는 편이 현실적입니다.

2) **쿼터와 청구를 강결합하면 장애 전파가 커집니다.**  
청구 배치 지연이 실시간 요청 차단으로 번지지 않게 경계를 분리해야 합니다.

3) **요금제 정책이 코드에 박히면 변경 비용이 폭증합니다.**  
플랜 룰(무료 한도, 구간 요금, 최소 과금 단위)은 선언형 설정으로 분리하는 게 안전합니다.

4) **운영 지표가 없으면 오차가 누적됩니다.**  
오차율, 중복율, 보정율, 지연시간을 매일 보지 않으면 월말에만 문제를 발견하게 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] Usage Ledger를 불변 이벤트 저장소로 분리했다.
- [ ] `tenant_id + event_id` 멱등 키를 ingest 단계에서 강제한다.
- [ ] Quota 판단 경로와 Billing 정산 경로를 분리했다.
- [ ] 청구 오차율/보정 분개율/원장 지연시간을 일일 모니터링한다.
- [ ] 요금제 룰을 코드 분기문이 아니라 설정/정책 계층으로 관리한다.

### 연습 과제

1. 현재 서비스의 "과금 가능한 이벤트"를 10개 이내로 추려 `metric_code` 사전을 작성해보세요.  
2. 동일 이벤트가 3번 중복 도착하는 시뮬레이션을 만들고, 원장/집계/청구서가 어떻게 유지되는지 검증해보세요.  
3. 무료 플랜(월 10,000회) + 초과 과금(1,000회당 500원) 규칙을 적용해 샘플 청구 라인을 계산해보세요.

## 관련 글

- [멱등성 설계 실전](/learning/deep-dive/deep-dive-idempotency/)
- [Transactional Outbox + CDC 패턴](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [Kafka Retry/DLQ 운영 전략](/learning/deep-dive/deep-dive-kafka-retry-dlq/)
- [멀티테넌시 전략](/learning/deep-dive/deep-dive-multitenancy-strategy/)
- [데이터 보존/삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
