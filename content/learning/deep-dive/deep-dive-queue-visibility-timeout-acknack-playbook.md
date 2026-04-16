---
title: "백엔드 커리큘럼 심화: Queue Visibility Timeout·Ack/Nack·DLQ 재처리 설계 플레이북"
date: 2026-04-05
draft: false
topic: "Distributed Systems"
tags: ["Message Queue", "Visibility Timeout", "Ack/Nack", "DLQ", "Idempotency", "Reliability"]
categories: ["Backend Deep Dive"]
description: "메시지 큐 기반 비동기 처리에서 중복 실행, 유실, 무한 재시도를 줄이기 위해 Visibility Timeout, Ack/Nack, DLQ를 숫자 기준으로 설계하는 실무 플레이북입니다."
module: "backend-messaging"
study_order: 1166
---

비동기 파이프라인은 트래픽 급증을 흡수하는 데 강하지만, 운영 난이도는 동기 API보다 훨씬 높습니다. 특히 장애가 나면 문제는 항상 비슷합니다. 메시지가 사라졌다고 느껴지거나, 같은 주문이 두 번 처리되거나, 실패 메시지가 끝없이 재시도되면서 큐 전체가 막힙니다.

이때 팀이 흔히 하는 실수는 "재시도 횟수를 늘리자" 같은 단일 파라미터 튜닝으로 문제를 덮는 것입니다. 실무에서는 그 접근이 거의 항상 실패합니다. 이유는 단순합니다. 큐 신뢰성은 Ack/Nack, Visibility Timeout, Idempotency, DLQ 정책이 **한 세트로 맞물릴 때만** 안정화되기 때문입니다.

이 글은 "메시지를 결국 처리한다"가 아니라, **얼마나 빠르게, 얼마나 예측 가능하게, 얼마나 저렴하게 복구하는지**를 기준으로 설계 결정을 정리합니다.

## 이 글에서 얻는 것

- Visibility Timeout을 처리시간 분포(p95/p99)와 재시도 정책에 맞춰 계산하는 기준을 얻을 수 있습니다.
- Ack/Nack 시점, 재시도 간격, DLQ 격리 조건을 팀 공통 규칙으로 고정할 수 있습니다.
- "중복 허용 + 멱등 보장"과 "중복 최소화 + 처리 지연" 사이에서 어떤 선택을 해야 하는지 숫자로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) Visibility Timeout은 큐 옵션이 아니라 "중복률 제어 레버"다

Visibility Timeout을 너무 짧게 두면, 처리 중인 메시지가 다시 노출되어 중복 실행이 급증합니다. 반대로 너무 길게 두면 실패 메시지가 오래 붙잡혀 복구가 느려집니다.

실무에서는 보통 아래 기준으로 시작합니다.

- `visibility_timeout = max(3 x handler_latency_p99, 30초)`
- 장시간 작업(외부 API/파일 처리)은 heartbeat 또는 timeout extension 사용
- timeout은 고정값 1개보다 작업 타입별 클래스(짧음/보통/김)로 분리

예를 들어 결제 후속 처리 핸들러가 p99 8초라면 기본 timeout을 24~30초로 둡니다. 여기서 핵심은 평균이 아니라 tail latency 기준으로 잡는 것입니다. 이 원리는 [Tail Latency 엔지니어링](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)과 같은 맥락입니다.

### 2) Ack/Nack 시점은 "비즈니스 완료" 기준으로 통일해야 한다

많은 장애가 "DB 저장은 됐는데 Ack 전에 프로세스가 죽음" 또는 "Ack는 했는데 외부 연동 실패"에서 생깁니다. 따라서 Ack 시점은 기술 이벤트가 아니라 도메인 완료 정의와 맞춰야 합니다.

- **Ack**: 최소한 재실행해도 부작용이 없는 상태(트랜잭션 커밋 + outbox 기록 등)
- **Nack/Requeue**: 일시 실패(네트워크, 의존 서비스 5xx, rate limit)
- **Reject/DLQ**: 데이터 오류, 스키마 불일치, 정책 위반처럼 자동 복구 가능성이 낮은 실패

이 분류 없이 "실패면 전부 재시도"를 하면 poison message 1건이 전체 소비량을 잠식합니다. 실패 유형별 처리 설계는 [Kafka Retry/DLQ 패턴](/learning/deep-dive/deep-dive-kafka-retry-dlq/)과 [Batch 재처리 전략](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)을 함께 보는 편이 좋습니다.

### 3) "Exactly-once 환상"보다 "At-least-once + 멱등성"이 현실적이다

운영 환경에서 네트워크 단절, 프로세스 재시작, 브로커 failover를 고려하면 완전한 exactly-once 보장은 비용이 매우 큽니다. 그래서 대부분의 팀은 아래 전략으로 갑니다.

1. 전달은 at-least-once를 수용
2. 소비자는 멱등 키(idempotency key)로 중복 적용 차단
3. 외부 부작용(결제, 알림, 포인트)은 dedup store로 보호

멱등 키 TTL은 비즈니스 재시도 윈도우보다 길어야 합니다. 예를 들어 최대 재시도 24시간이면 dedup TTL은 48~72시간으로 잡습니다. 관련 기본기는 [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/)를 참고하세요.

### 4) DLQ는 "쓰레기통"이 아니라 운영 큐다

DLQ로 보냈다고 끝이 아닙니다. 오히려 그때부터 운영이 시작됩니다. DLQ를 방치하면 누락 데이터가 누적되고, 결국 수동 복구가 대형 작업으로 번집니다.

권장 운영 기준:

- `max_receive_count`는 3~8회 범위에서 시작(업무 중요도별 차등)
- DLQ 유입률이 총 소비의 0.5%를 넘으면 즉시 원인 분류
- 동일 에러 시그니처가 50건 이상이면 재처리 전에 코드/정책 수정 우선
- DLQ 메시지는 "재처리 가능"과 "영구 실패" 라벨로 분리

즉 재처리 버튼은 운영 안정화의 마지막 단계여야 합니다.

## 실무 적용

### 1) 운영 표준 파이프라인

실무에서 가장 사고가 적은 기본 흐름은 아래와 같습니다.

1. Consumer가 메시지 수신 후 trace id·idempotency key 추출
2. dedup store에서 선처리 여부 확인(이미 처리됨이면 Ack 후 종료)
3. 비즈니스 로직 실행(트랜잭션 경계 명확화)
4. 성공 시 Ack + 처리 결과 메트릭 기록
5. 실패 시 오류 분류(일시/영구) 후 Nack 또는 DLQ 전환

여기서 포인트는 "실패"라는 한 단어를 최소 2종류 이상으로 나누는 것입니다. 이 분류가 없으면 재시도 비용이 폭발합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **데이터 무결성 > 중복 부작용 방지 > 지연 최적화 > 비용 절감** 순이 안전합니다.

초기 운영 기준 예시:

- 처리 성공률(종단): 99.9% 이상
- 중복 실행률: 0.3% 이하
- DLQ 유입률: 0.5% 이하
- 큐 적체 시간(queue age p95): 60초 이하
- 재처리 후 최종 성공률: 80% 이상

자동 전환 규칙 예시:

- `handler_latency_p99`가 timeout의 50%를 15분 이상 초과하면 timeout +20% 상향
- `dlq_inflow_rate > 1%` 10분 지속 시 해당 컨슈머 카나리 배포 중단
- `duplicate_apply_rate > 0.5%`면 재시도 횟수 증가보다 dedup TTL·락 키 충돌 우선 점검

운영 목표를 SLI/SLO로 고정하려면 [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과 연결해야 알람 피로를 줄일 수 있습니다.

### 3) 장애 대응 런북(요약)

- **Step 1: 영향 범위 파악**: 지연 증가인지, 중복 증가인지, 유실 의심인지 분류
- **Step 2: 안전장치 고정**: 고위험 토픽은 재시도 횟수 즉시 하향 또는 일시 정지
- **Step 3: 원인 제거**: 코드 회귀, 외부 의존 장애, 스키마 불일치 순으로 조사
- **Step 4: 재처리 실행**: 수정 적용 후 소량 샘플 재처리 → 이상 없으면 배치 확장

여기서 핵심은 "먼저 재처리"가 아니라 "먼저 원인 제거"입니다.

## 트레이드오프/주의점

1) **Timeout을 넉넉히 잡으면 중복은 줄지만 복구가 늦어진다**  
장애 감지가 늦어져 전체 리드타임이 늘어날 수 있습니다.

2) **재시도 횟수를 늘리면 성공률은 오르지만 시스템 부하도 같이 오른다**  
특히 외부 API 장애 상황에선 재시도가 2차 장애를 만듭니다. [Backpressure/Load Shedding](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/) 정책과 함께 설계해야 합니다.

3) **멱등 키 저장소를 과소 설계하면 오히려 정확성이 떨어진다**  
TTL이 짧거나 파티셔닝이 불안정하면 중복 차단이 무력화됩니다.

4) **DLQ를 장기간 방치하면 데이터 정합성 부채가 누적된다**  
재처리 기준일, 담당자, 종료 조건이 없는 DLQ는 사실상 숨겨진 장애 큐입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 메시지 타입별 visibility timeout 산정 근거(p99 기준)가 문서화되어 있다.
- [ ] Ack/Nack/DLQ 전환 조건이 실패 유형별로 분리되어 있다.
- [ ] dedup key 생성 규칙과 TTL(재시도 윈도우 대비 배수)이 정의되어 있다.
- [ ] DLQ 유입률/재처리 성공률/중복 실행률을 같은 대시보드에서 본다.
- [ ] "원인 수정 전 대량 재처리 금지" 규칙이 런북에 명시되어 있다.

### 연습 과제

1. 현재 운영 중인 큐 1개를 골라, `handler_latency_p99` 기반으로 visibility timeout 적정값을 계산해 보세요.  
2. 최근 2주 실패 로그를 `일시 실패`/`영구 실패`로 분류해 Nack 비율과 DLQ 비율을 각각 산출해 보세요.  
3. dedup TTL을 24시간, 48시간, 72시간으로 바꿨을 때 중복 차단률과 저장 비용이 어떻게 달라지는지 시뮬레이션해 보세요.

## 관련 글

- [Kafka Retry/DLQ 설계](/learning/deep-dive/deep-dive-kafka-retry-dlq/)
- [Batch Idempotency/재처리 전략](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)
- [Idempotency 핵심 원리](/learning/deep-dive/deep-dive-idempotency/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [Priority Load Shedding/Bulkhead](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)
