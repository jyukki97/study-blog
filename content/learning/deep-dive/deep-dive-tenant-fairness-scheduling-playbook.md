---
title: "백엔드 커리큘럼 심화: 멀티테넌트 공정성 스케줄링(WFQ/DRR)으로 노이즈 네이버를 제어하는 방법"
date: 2026-03-23
draft: false
topic: "Architecture"
tags: ["Multi-Tenancy", "Fair Scheduling", "WFQ", "DRR", "Noisy Neighbor", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "멀티테넌트 환경에서 특정 고객 트래픽이 전체 서비스를 흔들지 않도록, WFQ/DRR 기반 공정성 제어와 운영 임계치를 실무 관점으로 정리합니다."
module: "resilience-system"
study_order: 473
---

## 이 글에서 얻는 것

- "글로벌 제한값 하나"로 운영하다가 생기는 노이즈 네이버 문제를, **공정성 스케줄링** 관점에서 분해해 볼 수 있습니다.
- FIFO/우선순위 큐/WFQ/DRR 중 어떤 방식을 선택해야 하는지, **트래픽 패턴·SLO·운영 난이도** 기준으로 판단할 수 있습니다.
- 테넌트별 처리량/지연/드롭률을 숫자로 관리하는 **실무 의사결정 기준(임계치·우선순위·예외 정책)**을 바로 적용할 수 있습니다.

## 핵심 개념/이슈

### 1) 멀티테넌트 장애의 본질은 "성능"보다 "불공정"이다

멀티테넌트 시스템에서 자주 보이는 현상은 단순한 고부하가 아닙니다.

- 테넌트 A가 짧은 시간에 대량 요청을 보내면
- 테넌트 B/C의 정상 요청이 큐에서 밀리고
- 결국 "전체 평균"은 정상인데 일부 고객은 p99가 폭증합니다.

이 문제는 보통 다음 순서로 악화됩니다.

1. 글로벌 큐 1개 + 글로벌 동시성 제한 1개로 시작
2. 고트래픽 테넌트가 큐를 점유
3. 저트래픽 테넌트는 타임아웃 증가
4. 재시도로 트래픽이 더 커져 악순환

즉 핵심은 처리량 자체보다 **기회 배분(opportunity allocation)**입니다. 이 지점은 [Admission Control/동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/), [우선순위 기반 로드 셰딩](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/), [멀티테넌트 격리 플레이북](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)을 함께 보면 더 선명해집니다.

### 2) 스케줄링 알고리즘 선택: FIFO는 단순하지만 공정하지 않다

#### FIFO (단일 큐)
- 장점: 구현/운영이 가장 쉽다.
- 단점: 버스트를 낸 테넌트가 큐를 선점하면 다른 테넌트 지연이 급증한다.
- 추천: 초기 MVP 또는 테넌트 수가 매우 적고 트래픽 편차가 작은 경우.

#### Priority Queue
- 장점: 유료 플랜/핵심 워크로드 우선 처리 가능.
- 단점: 하위 우선순위 기아(starvation) 위험. 우선순위 설계가 정치 이슈가 되기 쉽다.
- 추천: SLO 계층이 분명한 B2B SaaS.

#### WFQ(Weighted Fair Queuing)
- 장점: 테넌트 가중치에 비례해 장기적으로 공정한 처리량 확보.
- 단점: 구현 복잡도와 상태 관리 비용 증가.
- 추천: 플랜별 SLA 차등이 뚜렷한 환경.

#### DRR(Deficit Round Robin)
- 장점: WFQ보다 구현이 단순하고, 패킷/작업 크기 편차가 있을 때도 실용적.
- 단점: 양자(quantum) 튜닝 실패 시 지연 지터가 커질 수 있다.
- 추천: "정확한 수학적 공정성"보다 "운영 가능한 공정성"이 필요한 팀.

실무에서는 "WFQ 이론 + DRR 구현" 조합이 자주 쓰입니다. 가중치 정책은 WFQ 철학을 따르고, 실제 스케줄러는 DRR로 단순화합니다.

### 3) 공정성은 철학이 아니라 지표다: Fairness Budget

공정성을 말로만 정의하면 운영이 흔들립니다. 최소한 아래 4개를 숫자로 두는 게 좋습니다.

- `tenant_p95_latency`: 테넌트별 p95 지연
- `tenant_drop_rate`: 테넌트별 드롭/거절률
- `fair_share_ratio`: 실제 처리량 / 기대 처리량(가중치 기준)
- `starvation_window`: 연속 미처리 시간

권장 초기 임계치(중간 규모 API 기준):

- `fair_share_ratio` 10분 이동평균이 **0.7 미만**이면 불공정 경보
- `starvation_window`가 **30초 초과**하면 우선 복구 대상
- 특정 테넌트의 처리량이 전체의 **40% 초과** + 타 테넌트 p95 상승 동반 시 throttling 트리거
- 테넌트별 거절률 편차(`max-min`)가 **15%p 초과**하면 스케줄러/가중치 재조정

핵심은 "모두 동일"이 아니라 **정책적으로 허용 가능한 불균형 범위**를 정하는 것입니다.

### 4) 가중치 정책은 매출 기준이 아니라 위험 기준으로 설계한다

많은 팀이 가중치를 "요금제 금액"만으로 잡다가 사고를 냅니다. 실제로는 다음 순서를 권장합니다.

1. **서비스 보호 기준**: 시스템 생존을 먼저 보장(핵심 DB/외부 결제 API 보호)
2. **고객 계약 기준**: 유료 SLA 준수
3. **성장 기준**: 무료/신규 고객 경험 유지

예시 가중치:

- Enterprise: 8
- Pro: 4
- Starter: 2
- Free: 1

하지만 "Free=1"이어도 기아 방지 최소 쿼터는 따로 둬야 합니다.

- 최소 처리 보장: 분당 30요청 또는 global 3% 중 큰 값
- 연속 거절 20초 이상이면 일시적 가중치 부스트(+1)

즉 가중치는 정적 테이블이 아니라, **보호 규칙 + 계약 규칙 + 예외 규칙**의 조합입니다.

## 실무 적용

### 1) 운영 가능한 구조: 계층형 제어를 분리한다

권장 구성:

1. **Ingress Rate Limit(테넌트 키 기반)**: 비정상 급증 1차 차단
2. **Tenant Queue(분리 큐)**: 테넌트별 대기열 독립
3. **Fair Scheduler(DRR/WFQ)**: 실행 순서 제어
4. **Worker Pool + Bulkhead**: 다운스트림별 격리
5. **Feedback Controller**: 지표 기반 가중치/양자 조정

이렇게 분리하면 "누가 큐를 점유했는지"가 보이고, 조치도 계층별로 할 수 있습니다. 관측은 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/), [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)과 반드시 붙여야 합니다.

### 2) DRR 기반 스케줄러 의사코드

```go
type TenantState struct {
    Queue    []Job
    Weight   int
    Deficit  int
    Quantum  int // baseQuantum * Weight
}

func scheduleRound(tenants []*TenantState, maxDispatch int) []Job {
    out := make([]Job, 0, maxDispatch)
    for len(out) < maxDispatch {
        progressed := false
        for _, t := range tenants {
            if len(t.Queue) == 0 {
                continue
            }
            t.Deficit += t.Quantum
            for len(t.Queue) > 0 {
                cost := t.Queue[0].CostUnit // 예: 예상 DB 쿼리 수, CPU 추정치
                if cost > t.Deficit {
                    break
                }
                job := t.Queue[0]
                t.Queue = t.Queue[1:]
                t.Deficit -= cost
                out = append(out, job)
                progressed = true
                if len(out) >= maxDispatch {
                    break
                }
            }
        }
        if !progressed {
            break
        }
    }
    return out
}
```

포인트는 `cost`를 단순 요청 수가 아니라 "자원 소비 단위"로 잡는 것입니다. 같은 1건 요청이어도 무거운 쿼리는 더 큰 cost를 가져야 공정성이 유지됩니다.

### 3) 의사결정 기준(숫자·조건·우선순위)

우선순위는 보통 **전체 안정성 > 계약된 SLO > 개별 테넌트 즉시성** 순으로 둡니다.

실무 기준 예시:

- `global_cpu > 75%`가 5분 지속 + `queue_depth` 증가 시: 테넌트별 burst cap 20% 축소
- `tenant_drop_rate > 5%`가 10분 지속(Enterprise): 임시 가중치 +1, 원인 분석 P1
- `starvation_window > 30s` 테넌트가 3개 이상: 신규 기능 배포 중단, 스케줄러 파라미터 롤백
- 다운스트림(DB/외부 API) 에러율 > 2%: 공정성보다 보호 우선(공통 셰딩 단계 진입)

### 4) 도입 순서(4주 플랜)

**1주차: 측정**
- 테넌트별 p95/p99, 큐 길이, 거절률 대시보드 구축
- 상위 10개 테넌트 트래픽 편차 파악

**2주차: 분리**
- 단일 큐를 테넌트 큐로 분리
- 글로벌 제한 + 테넌트 제한 병행

**3주차: 제어**
- DRR 스케줄러 활성화(초기 가중치 고정)
- starvation guard(최소 보장) 적용

**4주차: 자동화**
- 지표 기반 가중치 조정 룰 도입
- 주간 리뷰로 임계치 보정

## 트레이드오프/주의점

1) **공정성 강화는 평균 처리량을 일부 희생할 수 있다**  
FIFO는 특정 상황에서 처리량이 높아 보일 수 있지만, 고객 체감 안정성은 더 나쁠 수 있습니다.

2) **가중치 정책이 조직 갈등으로 번지기 쉽다**  
"왜 우리 팀은 2이고 저 팀은 4냐" 논쟁을 막으려면, 매출이 아니라 계약/SLO/위험 기준을 문서화해야 합니다.

3) **알고리즘보다 관측 부재가 더 큰 실패 원인이다**  
WFQ/DRR를 넣어도 테넌트별 지표가 없으면 결국 감으로 튜닝하게 됩니다.

4) **동적 가중치는 조심해서 자동화해야 한다**  
너무 민감하게 조정하면 스케줄러가 흔들려 지연 지터가 커집니다. 조정 주기(예: 5~10분)와 상한/하한을 고정하세요.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 테넌트별 큐 길이, 지연, 거절률이 분리 관측된다.
- [ ] 글로벌 제한과 테넌트 제한이 계층적으로 분리돼 있다.
- [ ] 가중치 정책(기본/예외/만료 조건)이 문서화돼 있다.
- [ ] starvation guard(최소 처리 보장)가 구현돼 있다.
- [ ] 공정성 지표(`fair_share_ratio`)를 주간 리뷰한다.

### 연습 과제

1. 최근 7일 로그로 상위 20개 테넌트의 트래픽 분산도를 계산하고, 상위 3개 테넌트가 전체 처리량에서 차지하는 비율을 구해보세요.  
2. 동일 워커 수에서 FIFO와 DRR를 각각 1시간 시뮬레이션해, 테넌트별 p95/드롭률 편차를 비교해보세요.  
3. 현재 플랜 정책에 맞춰 가중치 표를 설계하고, "최소 보장"과 "긴급 부스트" 조건을 각 1개씩 정의해보세요.

## 관련 글

- [Admission Control과 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [우선순위 로드 셰딩과 벌크헤드](/learning/deep-dive/deep-dive-priority-load-shedding-bulkhead/)
- [멀티테넌트 격리 플레이북](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [구조화 로깅 설계](/learning/deep-dive/deep-dive-structured-logging/)
