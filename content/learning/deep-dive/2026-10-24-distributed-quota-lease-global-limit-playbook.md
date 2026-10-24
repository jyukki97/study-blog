---
title: "백엔드 커리큘럼 심화: 분산 쿼터 Lease로 다중 리전 API 한도를 일관되게 운영하는 법"
date: 2026-10-24
draft: false
topic: "Distributed Systems"
tags: ["Distributed Quota", "Rate Limit", "Multi-Region", "Lease", "Tenant Isolation", "API Operations"]
categories: ["Backend Deep Dive"]
description: "여러 리전과 수백 개 인스턴스가 동시에 요청을 처리할 때, 전역 쿼터를 매 요청마다 중앙 저장소에 묻지 않고도 과다 사용을 제한하는 lease 기반 설계와 실패 정책을 정리합니다."
module: "backend-distributed"
study_order: 1228
---

## 이 글에서 얻는 것

- rate limit과 계약상 쿼터(entitlement)가 다른 문제이며, 전역 한도를 인스턴스별로 나눌 때 생기는 오차를 이해합니다.
- 중앙 control plane과 지역 data plane을 분리한 quota lease의 흐름, TTL, 회수, 관측 지표를 설계할 수 있습니다.
- 결제·보안 API처럼 초과 사용이 위험한 경로와 분석 조회처럼 가용성이 더 중요한 경로에 서로 다른 장애 정책을 적용할 수 있습니다.

단일 서버의 token bucket은 간단합니다. 하지만 서울·도쿄·버지니아 리전에 각각 수십 개 인스턴스가 있고, 고객 A에게 “분당 12만 건”을 약속했다면 상황이 달라집니다. 각 인스턴스가 독립적으로 12만 건을 허용하면 계약 한도의 수백 배가 나가고, 모든 요청을 중앙 Redis나 DB counter에 기록하면 지연·가용성·비용이 그 저장소에 묶입니다. 이 글은 그 중간 지점인 **분산 쿼터 lease**를 다룹니다. 기본 보호 계층은 [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)를, 서비스 경계는 [Control Plane과 Data Plane 분리](/learning/deep-dive/deep-dive-control-plane-data-plane-separation-playbook/)를 먼저 읽으면 더 잘 연결됩니다.

## 핵심 개념/이슈

### 1) 순간 속도 제한과 사용 권한은 같은 counter가 아니다

rate limit은 짧은 순간의 과부하와 abuse를 막는 장치입니다. IP나 API key가 1초에 너무 많은 요청을 보내면 429를 돌려 downstream을 보호합니다. 반면 quota는 고객·테넌트·플랜이 일정 기간에 쓸 수 있는 총량 또는 동시성이라는 **사업·계약의 경계**입니다. 월 1,000만 건, 하루 50GB export, 동시에 20개 batch job 같은 규칙이 여기에 속합니다.

두 문제를 하나의 counter로 합치면 나쁜 선택이 나옵니다. 무료 플랜의 일일 1,000건을 모두 소진했다고 해서 로그인·결제·해지 요청까지 같은 방식으로 막으면 제품 사고가 됩니다. 반대로 로그인 endpoint의 초당 20건 보호 규칙을 월간 quota로만 처리하면 짧은 burst가 connection pool을 먼저 소진합니다. 따라서 요청 분류와 우선순위를 아래처럼 분리합니다.

| 계층 | 주된 질문 | 대표 단위 | 초과 시 기본 동작 |
| --- | --- | --- | --- |
| ingress rate limit | 지금 너무 빠른가 | IP, token, route, 초 | 짧은 retry-after와 차단 |
| concurrency limit | 지금 너무 많이 실행 중인가 | tenant, job type, inflight | 대기열 또는 즉시 거절 |
| entitlement quota | 이 기간에 쓸 권한이 남았는가 | tenant, plan, 일/월 | 업그레이드·다음 기간 안내 |
| 비용·안전 budget | 더 실행하면 손실·위험이 커지는가 | account, region, action | 승인 또는 강한 제한 |

이 분리는 [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)의 noisy neighbor 방어와도 연결됩니다. tenant A의 합법적인 대량 사용이 tenant B의 정상 요청을 밀어내지 않게 하려면, 단순 평균 QPS보다 tenant별 잔여 권한과 공용 자원 포화를 함께 봐야 합니다.

### 2) lease는 중앙의 권한을 지역의 작은 사용권으로 바꾼다

lease 방식에서 중앙 quota service는 tenant별 전역 잔여량의 기준 원천입니다. 각 리전의 quota agent는 매 요청마다 이 서비스에 묻지 않습니다. 대신 “A tenant의 image-transform 작업을 2,000건까지, 최대 30초 동안 처리할 수 있는 lease”를 받아 local token bucket에 넣습니다. 데이터 경로는 대개 다음과 같습니다.

~~~text
요청 -> regional quota agent의 local token 확인 -> 허용/거절
                    |
                    +-- 잔여 token이 low-watermark 아래면
                        control plane에 lease 요청 -> 원자적 grant 기록
~~~

lease에는 `tenant_id`, `dimension`, `grant_id`, `amount`, `issued_at`, `expires_at`, `policy_version`, `region`을 넣습니다. `grant_id`는 재시도된 grant 요청을 중복으로 더하지 않게 하는 멱등성 키입니다. quota service는 같은 `grant_id`가 다시 오면 기존 결과를 반환해야 하며, 거절과 승인 모두 감사 가능한 상태로 남겨야 합니다.

이 구조는 중앙 저장소 왕복을 request path에서 빼지만, 절대적인 정확도를 공짜로 주지는 않습니다. 각 agent에 아직 소비되지 않은 lease가 남아 있으면 중앙은 그것을 즉시 회수하기 어렵습니다. 결국 설계 문제는 “얼마까지의 초과 허용량을 감수할 것인가”로 바뀝니다.

### 3) 최대 초과량은 lease 크기와 동시 writer 수로 계산한다

전역 hard cap이 `Q`이고, 동시에 활성인 agent 수가 `N`, agent당 미사용 lease 상한이 `L`이면 중앙 장애나 정책 변경 직후 이론적인 overshoot 상한은 대략 `N × L`입니다. 실제로는 이미 발급된 lease와 in-flight 요청도 있어 조금 더 보수적으로 잡아야 합니다. 이 수식을 먼저 문서화하지 않으면 “전역 12만 건 제한”이 실제로는 13만 6천 건까지 열려 있는지 아무도 알 수 없습니다.

| 사용 경로 | 권장 lease 크기·TTL의 출발점 | overshoot 우선순위 |
| --- | --- | --- |
| 무료 API 조회, 일일 10만 건 | 200~500 token, 15~30초 | latency와 중앙 QPS 절감 |
| 유료 batch export, 일일 1만 건 | 20~50 job, 10~20초 | 계약 한도와 공정성 |
| 결제·쿠폰·고위험 admin action | 1 token 또는 중앙 확인 | 초과·중복 효과 방지 |
| 비가역 AI/외부 API 비용 | 비용 단위별 작은 lease, 5~15초 | 금액 상한과 승인 |

예를 들어 6개 리전에서 10개 agent가 동작하고 agent당 최대 50개의 미사용 job lease를 허용하면, 장애 순간에 최대 3,000 job의 여유 권한이 있을 수 있습니다. 이 값이 고객 계약이나 외부 vendor 예산보다 크다면 “짧은 TTL”만 외치는 대신 `L`을 줄이거나, 해당 operation을 중앙 확인 lane으로 옮겨야 합니다. [Admission Control과 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)은 quota가 남아 있어도 서버가 받을 수 없는 요청을 막는 별도 안전망입니다.

### 4) 시간과 정책 버전은 lease의 일부여야 한다

TTL을 벽시계 시간만으로 해석하면 clock skew가 있는 노드에서 만료 lease를 허용하거나 정상 lease를 일찍 버릴 수 있습니다. control plane은 발급 시각과 만료 시각을 함께 주고, agent는 monotonic clock으로 남은 시간을 계산하는 편이 안전합니다. 심한 시간 오차가 감지되면 새 lease를 받거나 fail-safe 동작으로 전환해야 합니다. 시간 경계 자체는 [Clock Skew와 시간 의미론](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)처럼 API 계약으로 다루는 것이 좋습니다.

플랜 변경도 같은 문제입니다. 고객을 enterprise에서 basic으로 내렸는데 기존 agent가 60초짜리 큰 lease를 들고 있으면 정책은 즉시 반영되지 않습니다. 그래서 high-risk dimension은 TTL을 짧게 하고 `policy_version`을 lease에 포함합니다. revoke event를 보내더라도 event 유실을 전제로 하며, 최종 보호는 짧은 만료와 다음 grant의 재검증입니다.

## 실무 적용

### 1) 한 차원·한 tenant cohort에서 시작한다

처음부터 모든 route와 플랜을 global quota로 옮기지 마세요. 비용이 명확하고 거절 메시지가 이미 있는 `report_export`처럼 한 operation을 고릅니다. 최근 14일 데이터에서 tenant별 peak QPS, 요청 완료율, 실제 작업 단가, 리전 분포를 구한 뒤 다음을 결정합니다.

1. **정확성 등급**: hard cap, bounded overshoot, best effort 중 하나를 명시합니다.
2. **dimension**: `tenant + operation + period`처럼 사용권의 의미가 분명한 key를 선택합니다. IP를 quota key로 재사용하지 않습니다.
3. **grant 예산**: 최대 overshoot가 기간 cap의 1% 이하인지 먼저 계산합니다. 1%도 너무 크면 작은 lease나 중앙 lane을 사용합니다.
4. **fallback**: control plane을 10초 이상 읽지 못했을 때 새 작업을 막을지, 낮은 속도로 임시 허용할지 operation별로 정합니다.

local agent는 lease가 20% 아래로 내려가면 비동기로 다음 lease를 미리 요청하고, 0이 되면 새 작업을 시작하지 않습니다. 이미 시작한 job을 중간에 끊을지 여부는 별도 계약입니다. export 파일을 절반 만들고 취소하는 것보다 다음 job만 거절하는 편이 낫다면, concurrent job slot과 일일 총량을 분리해 model해야 합니다.

### 2) control plane은 grant ledger와 정책 결정을 분리한다

중앙 service에서 policy 계산과 grant 기록을 한 giant transaction으로 묶기보다, policy snapshot을 읽고 정규화한 quota key로 원자적 grant를 기록하는 경계를 분명히 둡니다. grant ledger에는 `granted`, `consumed_reported`, `expired`, `returned`, `revoked`를 남기되, 소비 보고는 정확한 과금 원장이 필요한 경우를 제외하면 batch로 보내도 됩니다.

중요한 점은 “사용 보고가 늦었다”와 “새 grant를 더 발급해도 된다”를 혼동하지 않는 것입니다. hard cap dimension은 미확인 사용량을 보수적으로 예약하고, 낮은 위험의 analytics dimension은 TTL 만료 뒤 미사용량을 추정 반환할 수 있습니다. 반환 요청 자체도 중복될 수 있으므로 `grant_id`와 누적 사용량을 기준으로 멱등 처리합니다. 별도의 영구 작업이 얽히면 [Job Result Ledger와 재시작 가능한 Worker](/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/)의 상태 모델을 적용하는 편이 낫습니다.

### 3) 성공 지표와 rollback 기준을 함께 둔다

첫 2주는 tenant 5%와 리전 1개에서 shadow accounting으로 시작합니다. 실제 차단은 하지 않고, 기존 counter와 lease 계산이 얼마나 다른지 기록합니다. 다음 기준은 서비스마다 조정하되 출발점으로 쓸 수 있습니다.

- `grant_decision_latency` p99가 100ms 이하이고, local 허용 경로 p99가 기존 대비 5ms 이상 악화되지 않는다.
- `quota_decision_disagreement_rate`가 0.1% 이하이며, 이유 없는 차단 추정 건은 하루 1건도 없어야 한다.
- `unreported_or_expired_lease_ratio`가 총 grant의 2%를 넘으면 rollout을 멈추고 agent 재시작·네트워크 단절·TTL을 조사한다.
- tenant별 최대 overshoot가 문서화한 상한을 한 번이라도 넘으면 확대하지 않고 ledger invariant부터 수정한다.

확대 뒤에는 중앙 service의 성공률만 보지 말고, tenant별 429, plan upgrade conversion, agent clock skew, policy version lag, regional grant 분포를 봐야 합니다. 하나의 대형 tenant가 모든 lease를 먼저 가져가면 전역 한도는 지켜도 공정성은 깨진 것입니다.

## 트레이드오프/주의점

첫째, lease는 항상 약간의 stale 권한을 허용합니다. 정확히 0의 overshoot가 필요하면 매 action의 중앙 직렬화 또는 강한 transactional reservation에 가까워지며, 지연과 가용성 비용을 감수해야 합니다. 이를 피하려고 “전역 quota”라고 부르면서 실제 허용 오차를 숨기면 고객 계약과 운영 현실이 어긋납니다.

둘째, control plane 장애에서 fail-open은 매출 보호처럼 보이지만 abuse·비용 폭증으로 연결될 수 있습니다. 읽기 API는 마지막 정상 lease를 짧게 늘리는 degraded mode가 가능할 수 있지만, 고액 export·결제·partner API 호출은 새 lease 발급을 fail-closed하는 편이 보통 안전합니다. 하나의 전사 기본값보다 operation 위험도와 보상 가능성을 우선하세요.

셋째, 모든 tenant를 동일하게 나누면 bursty enterprise 고객이 불필요하게 막히고, 큰 lease를 주면 작은 고객이 굶습니다. 플랜·운영 시간대·리전별 수요를 이유로 lease 크기를 다르게 줄 수 있지만, 예외에는 owner와 만료일을 둬야 합니다. 동적 정책은 편리하지만 설명할 수 없는 rate limit보다 더 나쁜 지원 경험을 만들 수 있습니다.

넷째, quota는 인증을 대체하지 않습니다. 신뢰할 수 없는 `X-Forwarded-For`나 client가 준 tenant ID로 key를 만들면 공격자가 bucket을 바꾸거나 다른 고객의 quota를 태울 수 있습니다. identity와 client IP 경계는 [Trusted Proxy와 Client IP 경계](/learning/deep-dive/deep-dive-trusted-proxy-client-ip-boundary-playbook/)에서처럼 서버가 검증한 값만 사용합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] rate limit, concurrency, period quota, 비용 budget의 key와 초과 동작을 따로 문서화했다.
- [ ] lease의 `grant_id`, TTL, policy version, region, 반환·만료 상태가 ledger에 남는다.
- [ ] 활성 agent 수 × agent당 미사용 lease로 최대 overshoot를 계산했고, 계약·비용 한도보다 작다.
- [ ] control plane 장애 시 operation별 fail-open/fail-closed와 지속 시간을 정했다.
- [ ] agent는 monotonic time을 사용하고 clock skew·policy version lag를 관측한다.
- [ ] shadow accounting에서 기존 판단과의 불일치율, 이유 없는 거절, tenant별 공정성을 확인했다.
- [ ] quota key는 인증된 tenant·operation에 기반하며 untrusted header를 직접 쓰지 않는다.

### 연습

하루 50,000건의 유료 export quota를 3개 리전, 리전당 최대 8개 agent로 처리한다고 가정해 보세요. 허용 가능한 초과량을 0.5%(250건)로 정했을 때 agent당 미사용 lease 상한 `L`은 얼마여야 하는지 계산합니다. 이어서 agent가 24개가 아니라 40개로 늘어날 때 lease 크기, TTL, 중앙 확인 lane 중 무엇을 바꿀지 적어 보세요. 마지막으로 control plane이 2분간 완전히 끊겼을 때 새 export·이미 시작한 export·무료 조회를 각각 어떻게 처리할지 정하면, 추상적인 “분산 제한”이 실제 운영 계약으로 바뀝니다.

## 관련 글

- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Admission Control과 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [Control Plane과 Data Plane 분리](/learning/deep-dive/deep-dive-control-plane-data-plane-separation-playbook/)
- [멀티테넌트 격리 전략](/learning/deep-dive/deep-dive-multi-tenant-isolation-playbook/)
- [Job Result Ledger와 재시작 가능한 Worker](/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/)
