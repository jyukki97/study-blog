---
title: "백엔드 커리큘럼 심화: 워터마크와 지연 도착 이벤트를 전제로 한 스트림 처리 운영 플레이북"
date: 2026-03-31
draft: false
topic: "Data Engineering"
tags: ["Stream Processing", "Watermark", "Event Time", "Late Events", "Kafka", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "실시간 집계가 배치 결과와 다르게 나오는 문제를 줄이기 위해, 워터마크·허용 지연·재처리 규칙을 숫자 기준으로 설계하는 방법을 정리합니다."
module: "distributed-system"
study_order: 1162
---

## 이 글에서 얻는 것

- "실시간 대시보드 숫자가 다음 날 정산 결과와 왜 다르지?" 같은 문제를 **이벤트 시간(Event Time) 관점**에서 구조적으로 분해할 수 있습니다.
- 워터마크, 허용 지연(allowed lateness), 재처리(backfill) 정책을 분리해 **정확도·지연·운영비**를 동시에 관리하는 기준을 얻습니다.
- 팀에서 바로 적용 가능한 **의사결정 기준(임계치·조건·우선순위)**과 운영 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 스트림 처리 실패의 본질은 "늦게 온 이벤트"가 아니라 "시간 의미론 부재"다

많은 팀이 지연 도착 이벤트를 "어쩔 수 없는 데이터 노이즈"로 취급합니다. 그런데 실제 장애를 보면 공통 원인은 늦게 온 이벤트 자체보다, 시간 규칙을 명시하지 않은 설계입니다.

대표 증상은 아래 3가지입니다.

1. 실시간 집계(분 단위)가 다음 날 배치 결과와 3~10% 다름  
2. 특정 시간대(배포 직후, 네트워크 이슈 직후)에만 수치가 비정상적으로 튐  
3. 운영자가 수동 정정 SQL을 반복 실행함

이 문제는 보통 "수집 지연"과 "처리 지연"을 같은 것으로 다뤄서 생깁니다. 이벤트에는 최소한 `event_time`(실제 발생 시각), `ingest_time`(수집 시각), `process_time`(처리 시각)을 분리해야 합니다. 이 기본기는 [Clock Skew 시간 의미론 플레이북](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)과 [정합성 모델](/learning/deep-dive/deep-dive-consistency-models/)을 함께 보면 더 선명해집니다.

### 2) 워터마크는 "현재까지 믿을 수 있는 이벤트 시간의 경계"다

워터마크를 단순히 "지연 허용 시간"으로 이해하면 설계가 흔들립니다. 워터마크의 핵심은 다음 문장입니다.

> 이 시각보다 과거의 이벤트는 대부분 도착했다고 간주하고, 집계를 닫아도 된다.

예를 들어 워터마크를 `max_event_time - 5분`으로 잡으면, 이벤트 시간이 10:00~10:01인 윈도우는 워터마크가 10:01을 넘는 시점에 종료됩니다. 이후 10:00:30 이벤트가 도착하면 "late event"로 별도 처리해야 합니다.

운영에서 중요한 포인트는 **워터마크 지연을 고정값으로 박지 않는 것**입니다. 트래픽 패턴, 리전 간 지연, 모바일 오프라인 비율에 따라 2분이 맞을 수도 있고 20분이 맞을 수도 있습니다.

### 3) allowed lateness와 재처리 정책을 분리하지 않으면 비용이 폭발한다

실무에서 자주 보는 안티패턴은 "늦게 와도 다 반영"입니다. 정확도는 올라가지만 상태 저장소(state store)와 체크포인트 크기가 급격히 커집니다.

권장 분리는 다음과 같습니다.

- **경로 A: 온라인 보정 구간**  
  - allowed lateness 안에서 도착한 이벤트는 즉시 재집계
- **경로 B: 오프라인 보정 구간**  
  - 허용 구간 밖 이벤트는 DLQ/보정 토픽으로 보내고 배치 재처리

즉, "모든 늦은 이벤트를 같은 비용으로 처리"하지 말고, 지연 정도에 따라 처리 경로를 다르게 둬야 합니다. 이 구조는 [Batch Idempotency/재처리 전략](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)과 [Reconciliation Ledger 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)에서 쓰는 운영 철학과 같습니다.

### 4) 집계 정확도는 알고리즘보다 관측 지표가 먼저다

워터마크를 도입해도 지표가 없으면 결국 감으로 튜닝하게 됩니다. 최소 아래 지표는 기본으로 가져가야 합니다.

- `late_event_ratio`: 전체 이벤트 중 late 비율
- `watermark_lag_sec`: 처리 시각 대비 워터마크 지연
- `window_reopen_count`: 닫힌 윈도우 재오픈 횟수
- `correction_delta_ratio`: 실시간 집계 대비 보정치 비율
- `backfill_job_duration`: 재처리 작업 소요 시간

초기 기준 예시:

- `late_event_ratio` 5분 이동평균 **2% 초과** 시 경보
- `watermark_lag_sec` p95 **300초 초과** 시 지연 정책 재검토
- 일별 `correction_delta_ratio` **1.5% 초과**가 3일 연속이면 윈도우/워터마크 설계 결함으로 분류

## 실무 적용

### 1) 의사결정 기준(숫자·조건·우선순위)

우선순위는 보통 **정산 정확도 > 사용자 실시간성 > 인프라 비용** 순으로 두는 편이 안전합니다.

실무에서 바로 쓰기 좋은 기준:

1. **워터마크 지연 기본값**: 최근 7일 `event_time → ingest_time` 지연 p99 + 20% 마진  
   - 예: p99가 180초면 시작값 220초
2. **allowed lateness**: 워터마크 지연의 1.5~2배에서 시작  
   - 예: 워터마크 220초면 allowed lateness 6~8분
3. **윈도우 재오픈 상한**: 윈도우당 최대 2회  
   - 2회 초과 이벤트는 오프라인 보정 경로로 전환
4. **재처리 SLA**: 보정 배치는 D+1 06:00 이전 완료
5. **롤백 트리거**: 집계 지연 p95가 2배 이상 증가 + 정확도 개선이 0.3%p 미만이면 정책 롤백

핵심은 정확도 목표를 먼저 고정하고, 그 안에서 지연/비용을 최적화하는 순서입니다.

### 2) 추천 아키텍처: 실시간 경로와 보정 경로를 분리

권장 구성:

1. Kafka ingest (이벤트 스키마 버전 명시)
2. Stream Processor (event-time window + watermark)
3. Online Aggregate Store (대시보드/알람용)
4. Late Event Router (allowed lateness 밖 이벤트 분리)
5. Backfill Job (배치 재집계)
6. Reconciliation Report (실시간 vs 정산 차이 리포트)

이 구조를 쓰면 "실시간 응답성"과 "최종 정합성"을 동시에 만족시키기 쉽습니다. 스키마 안정성은 [Event Schema Registry 호환성 플레이북](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)과 같이 운영해야 장애를 줄일 수 있습니다.

### 3) 운영 파라미터 튜닝 순서(4주 플랜)

**1주차: 측정 고정**
- 이벤트 지연 분포(p50/p90/p99) 수집
- 실시간 집계와 정산 결과 차이의 기준선 측정

**2주차: 보수적 워터마크 적용**
- 넓은 워터마크(예: p99+30%)로 시작
- late_event_ratio와 지연 증가폭을 관찰

**3주차: allowed lateness 조정**
- 온라인 보정 구간을 단계적으로 축소(예: 15분→10분→7분)
- 상태 저장소 크기·체크포인트 시간 모니터링

**4주차: 재처리 자동화**
- DLQ→백필 파이프라인 자동 연결
- 보정 리포트를 운영 회의 지표로 고정

### 4) 샘플 의사코드 (개념용)

```pseudo
onEvent(event):
  et = event.event_time
  updateMaxEventTime(et)
  watermark = maxEventTime - watermarkDelay

  if et >= watermark - allowedLateness:
      upsertWindowAggregate(event)
  else:
      publishToLateEventTopic(event)

onWindowClose(window):
  emitPreliminaryResult(window)

onBackfillCompleted(window):
  emitCorrectedResult(window)
  recordCorrectionDelta(window)
```

여기서 중요한 건 `preliminary result(잠정값)`와 `corrected result(보정값)`를 모델에서 구분하는 것입니다. 둘을 같은 의미로 취급하면 소비자 시스템에서 중복 정산/중복 알림이 발생합니다.

## 트레이드오프/주의점

1) **워터마크를 짧게 잡으면 실시간성은 좋아지지만 보정 비용이 증가한다**  
집계를 빨리 닫을수록 late 이벤트가 늘어 배치 보정 비용이 커집니다.

2) **allowed lateness를 길게 잡으면 정확도는 좋아지지만 상태 관리 비용이 급증한다**  
메모리/디스크/체크포인트 부하가 커져 장애 반경이 커질 수 있습니다.

3) **지표 없이 튜닝하면 팀마다 다른 숫자를 진실로 믿게 된다**  
데이터팀, 백엔드팀, 비즈니스팀이 서로 다른 집계를 들고 논쟁하는 상태가 반복됩니다.

4) **late 이벤트를 무조건 버리면 단기 성능은 좋아도 장기 신뢰를 잃는다**  
정산, 과금, SLA 리포트처럼 돈/신뢰가 걸린 영역에서는 반드시 보정 경로를 유지해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 이벤트에 `event_time`, `ingest_time`, `process_time`이 분리 저장된다.
- [ ] 워터마크/allowed lateness 기준이 문서화되어 있다.
- [ ] late 이벤트의 온라인/오프라인 처리 경로가 분리되어 있다.
- [ ] 실시간 집계와 정산 집계 차이를 주간 지표로 추적한다.
- [ ] 보정 결과가 소비자 시스템에서 중복 반영되지 않도록 버전/타입이 구분된다.

### 연습 과제

1. 최근 14일 이벤트를 기준으로 `event_time→ingest_time` 지연 분포를 구하고, p99 기반 워터마크 시작값을 계산해 보세요.  
2. allowed lateness를 5분/10분/20분으로 바꿔 `late_event_ratio`, 상태 저장소 크기, 정산 오차를 비교해 보세요.  
3. 잠정값/보정값 이중 모델을 적용했을 때, 알림 중복률과 정산 오차가 얼마나 줄어드는지 실험해 보세요.

## 관련 글

- [Clock Skew를 전제로 한 시간 의미론 설계](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)
- [정합성 모델(Strong/Eventual) 의사결정](/learning/deep-dive/deep-dive-consistency-models/)
- [Batch 멱등성과 재처리 설계](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)
- [Reconciliation Ledger 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
- [Event Schema Registry 호환성 운영](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)
