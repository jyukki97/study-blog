---
title: "2026 개발 트렌드: Carbon-Aware Workload Scheduling, 전력 탄소 집약도를 배치 정책에 넣는 팀이 먼저 정해야 할 것"
date: 2026-10-06T10:06:00+09:00
lastmod: 2026-10-06T10:06:00+09:00
draft: false
tags: ["Green Software", "Carbon-Aware Computing", "Kubernetes", "FinOps", "Platform Engineering", "Batch Scheduling"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["carbon-aware scheduling", "carbon intensity", "green software", "batch workload scheduling", "platform engineering"]
description: "탄소 집약도 신호를 이용해 지연 허용 배치·재색인·백필·AI 평가 작업의 실행 시각과 리전을 조정하는 흐름을, SLO·비용·데이터 경계·실패 복구까지 포함한 실무 기준으로 정리합니다."
summary: "탄소 인식 스케줄링은 모든 작업을 가장 친환경적인 시간으로 미루자는 구호가 아니다. 지연 예산과 데이터·보안 경계를 먼저 고정한 뒤, 남는 선택지 안에서 탄소·비용·용량 신호를 함께 최적화하는 플랫폼 정책이다."
key_takeaways:
  - "Carbon-aware 정책은 실시간 사용자 요청이 아니라 deadline과 재시도 규칙이 명확한 배치 작업부터 적용해야 한다."
  - "탄소 집약도만 낮다고 실행하면 안 되며, 데이터 주권·용량·spot 회수 위험·전송 비용·SLO를 hard constraint로 먼저 걸러야 한다."
  - "운영 지표는 절감 추정치 하나가 아니라 deadline miss, 재실행률, region 이동량, 탄소 신호 신선도와 함께 봐야 한다."
operator_checklist:
  - "workload별 earliest start, deadline, 최대 지연, 허용 region, checkpoint 가능 여부를 inventory한다."
  - "탄소·비용·용량 신호가 stale하거나 서로 충돌할 때의 fallback을 현재 region·현재 schedule 유지로 정한다."
  - "재색인·백필처럼 취소 가능한 작업부터 shadow schedule로 2주 이상 비교한다."
  - "절감 추정치는 측정 범위, 데이터 소스, 계산 버전, 누락 구간을 함께 기록한다."
---

클라우드 비용 최적화는 오랫동안 “사용하지 않는 인스턴스를 끄고, 예약 할인과 autoscaling을 맞춘다”는 문제로 다뤄졌습니다. 최근 플랫폼 팀이 보는 다음 단계는 **언제, 어디서, 어떤 지연 허용 작업을 실행할 것인가**입니다. 전력의 탄소 집약도는 시간과 지역에 따라 달라지고, 재색인·분석·백필·AI evaluation·대용량 변환처럼 즉시 끝날 필요가 없는 작업은 실행 시각을 조정할 여지가 있습니다.

하지만 carbon-aware scheduling은 서버를 친환경 시간대로 자동 이동시키는 기능이 아닙니다. 사용자 데이터의 리전 경계, 고객과 약속한 deadline, 큐 적체, GPU·spot 가용성, 네트워크 전송량, 복구 가능성이 먼저입니다. 이 글은 [Kubernetes Custom Metrics와 업무 신호 기반 Autoscaling](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/), [AI Usage Metrics Contract](/posts/2026-08-03-ai-usage-metrics-cost-governance-contract-trend/), [OpenTelemetry Metric Identity](/posts/2026-09-23-prometheus-otel-interoperability-metric-identity-trend/), [용량 계획과 Little’s Law](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)를 연결해, 이 흐름을 운영 정책으로 바꾸는 기준을 정리합니다.

## 이 글에서 얻는 것

- 탄소 인식 스케줄링에 적합한 workload와 절대 옮기면 안 되는 workload를 구분합니다.
- SLO, data residency, capacity를 hard constraint로 두고 탄소·비용을 soft objective로 최적화하는 방법을 배웁니다.
- 탄소 신호의 신선도·예측 오차·region 이동 비용을 운영 의사결정에 반영합니다.
- “절감 추정”을 과장하지 않고 deadline·재시도·사용자 영향과 함께 보고하는 지표를 만듭니다.

## 핵심 개념/이슈

### 1) 모든 작업이 이동 후보는 아니다

carbon-aware 정책의 첫 질문은 “어느 리전이 더 친환경적인가”가 아니라 “이 작업을 늦추거나 옮겨도 되는가”입니다. 다음처럼 작업을 세 부류로 나누면 출발점이 명확해집니다.

| 분류 | 예시 | 정책 |
| --- | --- | --- |
| 즉시 실행 | 결제 승인, 로그인, 권한 회수, 보안 알림 | 탄소 신호와 무관하게 가장 가까운 정상 경로에서 실행 |
| deadline 보장 | 야간 정산, 고객 export, 일별 지표 집계 | 정해진 deadline 안에서만 시각 조정 |
| 유연 실행 | 재색인, 테스트 fixture 생성, 비긴급 backfill, 대규모 evaluation | 탄소·비용·용량 점수가 좋은 슬롯을 선택 |

예를 들어 “매일 06:00까지 끝나야 하는 집계”가 02:00~06:00의 4시간 창을 가진다면, scheduler는 탄소 신호가 낮은 시간대를 선호할 수 있습니다. 그러나 05:10이 되어 아직 backlog가 남았다면 최적화보다 deadline 보장이 우선입니다. 이때 기다리는 것은 절감이 아니라 SLO 위반입니다.

### 2) 탄소 점수는 하나의 input일 뿐이다

스케줄러가 작업 후보를 고를 때 최소 네 층을 분리합니다.

1. **Hard constraint**: 허용 리전, data residency, deadline, 보안 등급, 필요한 accelerator, 최대 비용
2. **Safety gate**: 현재 queue age, downstream 포화도, checkpoint 유무, 재시도 가능성
3. **Soft objective**: 탄소 집약도, spot 가격, 유휴 용량, 예상 실행 시간
4. **Fallback**: 신호가 stale·미수집·상충할 때 원래 schedule과 리전을 유지

단순한 점수식은 다음 정도로 시작할 수 있습니다.

```text
eligible = residency_ok AND deadline_feasible AND capacity_ok AND checkpointable
score = 0.45 * carbon_score + 0.25 * cost_score + 0.20 * capacity_score + 0.10 * locality_score
```

여기서 점수는 eligibility를 대체하지 않습니다. EU 보관 데이터가 다른 리전의 낮은 탄소 점수 때문에 이동하면 안 되고, 30분 후 deadline인 작업을 “두 시간 뒤 더 깨끗한 전력” 때문에 미뤄서도 안 됩니다. `eligible=false`면 탄소 점수가 아무리 좋아도 후보에서 제외합니다.

### 3) 시간 이동이 리전 이동보다 먼저다

지역을 바꾸는 정책은 데이터 복제, egress 비용, cache miss, 디버깅 복잡도를 동반합니다. 그래서 첫 도입은 같은 리전에서 실행 시각만 옮기는 time shifting이 안전합니다. 예를 들어 UTC 새벽에 매시간 실행하던 비긴급 report compaction을 6시간 window 안에서 한 번 실행하도록 바꾸는 식입니다.

리전 이동은 아래 조건을 모두 만족할 때만 검토합니다.

- 입력 데이터가 이미 해당 리전에 있고, 복제·전송이 별도 탄소·비용 이득을 상쇄하지 않는다.
- 고객 계약과 데이터 주권이 허용한다.
- checkpoint와 결과 artifact가 region-independent identifier로 추적된다.
- 실패 시 원래 리전에서 재개할 복구 경로가 있다.
- 이동 전후 latency·비용·성공률을 최소 2주간 비교했다.

특히 AI batch는 GPU가 있는 곳으로 옮기기 쉬워 보여도, 모델 가중치 이동과 데이터 복사, queue egress가 커지면 결과가 달라집니다. “낮은 carbon intensity”라는 외부 신호 하나가 전체 lifecycle의 절감 근거가 되지는 않습니다.

## 실무 적용

### 1) workload contract에 유연성 필드를 추가한다

platform 팀이 모든 job을 추측해서 옮기면 사고가 납니다. producer가 job의 경계를 명시해야 합니다.

```yaml
workload_contract:
  name: nightly-search-reindex
  earliest_start: "00:00"
  deadline: "06:00"
  max_deferral_minutes: 240
  residency: [ap-northeast-2]
  checkpoint: required
  cancellation: safe
  fallback: run_by_deadline
  carbon_policy: prefer_lower_intensity
```

`max_deferral_minutes`가 없으면 scheduler는 늦춰도 되는지 모릅니다. checkpoint가 없으면 중간 중단이 손실 또는 이중 실행으로 이어질 수 있습니다. 이 계약은 [워크로드 인식 큐 분할과 공정 스케줄링](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)의 cost class처럼, 작업의 실행 조건을 producer와 platform 사이에 명시하는 장치입니다.

초기 기준은 보수적으로 둡니다. deadline까지 남은 시간이 예상 실행시간 p95의 **2배 미만**이면 즉시 실행하고, 탄소 신호가 **60분 이상 stale**이면 최적화를 끕니다. 같은 작업이 두 번 checkpoint 복구에 실패하면 그날은 자동 이동을 중지하고 기본 리전에서 실행합니다.

### 2) shadow schedule로 효과와 실패를 동시에 측정한다

처음부터 작업 시작 시각을 바꾸지 말고 2주 동안 “현재 schedule”과 “carbon-aware 추천 schedule”을 나란히 계산합니다. 실제 실행은 기존 정책을 따르고, 추천이 달랐던 경우에 아래를 기록합니다.

- 추천 지연 시간과 deadline slack
- 탄소·비용 신호의 값과 수집 시각
- 예상 실행 시간과 실제 p95 실행 시간
- 옮겼다면 필요한 데이터 이동량과 cache warm-up 비용
- 해당 슬롯에서 발생했을 retry·preemption·queue backlog 위험

이 비교가 있어야 낮은 점수만 보고 SLA를 위협하는 추천을 제거할 수 있습니다. 절감 추정치는 `estimated_kgco2e_avoided` 하나로 끝내지 말고, 계산에 쓴 전력·리전·실행시간·신호 version·결측 구간을 함께 남겨야 합니다. 그렇지 않으면 월말 보고가 측정이 아니라 홍보 문구가 됩니다.

### 3) 운영 지표는 efficiency와 reliability를 같이 본다

추천 대시보드에는 탄소 관련 숫자만 크게 놓지 마세요. 다음 지표를 같은 화면에서 봅니다.

| 지표 | 시작 기준 | 의미 |
| --- | --- | --- |
| deadline miss rate | 0% 목표 | 최적화가 약속을 깨지 않는지 |
| carbon signal freshness | 60분 이하 | stale input으로 움직이지 않는지 |
| deferred job recovery rate | 99% 이상 | 미뤄진 작업이 결국 정상 완료되는지 |
| checkpoint restart rate | 5% 이하 | 중단·이동 비용이 과하지 않은지 |
| data transfer per moved job | baseline 대비 추적 | 이동 이득이 egress로 상쇄되는지 |
| estimated avoided emissions | 방법론·범위 포함 | 추정치를 투명하게 비교하는지 |

queue age와 retry rate가 악화되면 scheduler는 탄소 정책을 끄고 기본 deadline 정책으로 돌아가야 합니다. [Custom Metrics 기반 Autoscaling](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/)처럼 사용자 영향과 가까운 신호가 비용·효율 점수보다 우선입니다.

## 트레이드오프/주의점

첫째, 탄소 집약도 API는 예측값이거나 지연된 관측값일 수 있습니다. 5분 전의 전력 구성과 다음 한 시간의 실제 구성은 다를 수 있으므로, 이를 정확한 배출 측정으로 표현하면 안 됩니다. 신호의 source, timestamp, region mapping, 결측 처리 방식을 문서화하고, 신호가 없을 때는 “평균값으로 추정”보다 **정책을 보수적으로 유지**하는 편이 낫습니다.

둘째, 느린 실행이 항상 더 친환경적이지는 않습니다. 낮은 우선순위 작업을 너무 오래 미루면 backlog가 커지고, 마감 직전에 worker를 한꺼번에 늘리며 더 큰 peak를 만들 수 있습니다. Little’s Law 관점에서 arrival rate와 처리율을 보지 않으면 green scheduling은 단순한 queue debt 축적이 됩니다. job별 최대 지연과 drain capacity를 함께 계산해야 합니다.

셋째, 지속가능성 지표가 비용 절감의 포장지가 되어서는 안 됩니다. spot 인스턴스가 싸고 탄소 점수가 낮더라도, preemption 때문에 재실행이 늘거나 데이터가 다른 리전으로 불필요하게 움직이면 사용자·운영 비용이 올라갑니다. 환경 목표는 reliability와 compliance를 우회하는 승인 근거가 아니라, 제약조건을 통과한 선택지의 우선순위를 정하는 기준이어야 합니다.

## 체크리스트 또는 연습

- [ ] workload마다 즉시 실행·deadline 보장·유연 실행 중 하나가 지정돼 있다.
- [ ] deadline, 최대 지연, 예상 실행시간 p95, checkpoint 가능 여부, fallback이 contract에 있다.
- [ ] data residency·보안 등급·필수 accelerator가 탄소 점수보다 먼저 eligibility를 결정한다.
- [ ] 탄소·비용·용량 신호의 timestamp와 stale fallback이 명시돼 있다.
- [ ] time shifting을 먼저 적용했고, region 이동은 데이터 이동량과 복구 경로까지 검증했다.
- [ ] deadline miss, queue age, retry, checkpoint restart가 기준을 넘으면 기본 schedule로 돌아간다.
- [ ] 절감 추정치에는 범위·계산 버전·결측 구간·가정이 함께 남는다.

이번 주에는 야간 작업 세 개만 골라 `earliest start`, `deadline`, `p95 실행시간`, `checkpoint`, `허용 리전`을 적어 보세요. 그중 deadline slack이 2시간 이상이고 취소·재개가 안전한 작업 하나를 shadow schedule에 올립니다. 탄소 점수보다 먼저 “내일 아침까지 반드시 끝나야 하는가”, “실패하면 어디서 재개하는가”를 답할 수 있다면, 그때부터 carbon-aware scheduling은 구호가 아니라 관리 가능한 플랫폼 기능이 됩니다.
