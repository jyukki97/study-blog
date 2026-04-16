---
title: "백엔드 커리큘럼 심화: Hedged Requests와 Request Racing 실무 플레이북"
date: 2026-04-12
draft: false
topic: "Distributed Systems"
tags: ["Hedged Requests", "Request Racing", "Tail Latency", "SLO", "Resilience", "Backend"]
categories: ["Backend Deep Dive"]
description: "평균 응답시간이 아니라 p95, p99 지연을 깎아야 하는 구간에서 hedged request를 언제 쓰고 언제 피해야 하는지, 비용과 성공 조건을 숫자로 정리합니다."
module: "backend-distributed"
study_order: 1171
---

서비스가 느려질 때 많은 팀은 평균 응답시간부터 봅니다. 그런데 사용자 불만은 대개 평균이 아니라 **꼬리 지연(tail latency)** 에서 터집니다. 평소에는 80ms면 끝나는 API가 가끔 1.8초, 2.4초로 튀는 순간 화면은 멈춘 것처럼 보이고, 상위 서비스 재시도까지 겹치면 작은 흔들림이 연쇄 지연으로 커집니다.

이런 구간에서 자주 거론되는 해법이 `hedged request` 또는 `request racing`입니다. 같은 읽기 요청을 약간 늦게 한 번 더 보내서, 먼저 끝난 응답을 채택하는 방식입니다. 아이디어는 단순하지만 운영에서는 함정도 분명합니다. **부하를 두 배로 만들면서도 체감 지연은 거의 안 줄이는 경우**가 있고, 반대로 정말 잘 맞는 경로에서는 p99를 눈에 띄게 깎기도 합니다.

이 글은 hedged request를 “빨라 보이는 요령”이 아니라 **언제 켜고, 어디에는 절대 켜지 말아야 하는지 판단하는 플레이북**으로 정리합니다. [Tail Latency Engineering](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/), [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/), [Admission Control](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)과 같이 보면 실무 감이 훨씬 선명해집니다.

## 이 글에서 얻는 것

- hedged request와 일반 재시도, speculative retry가 어떻게 다른지 구분할 수 있습니다.
- 어떤 읽기 경로에만 제한적으로 적용해야 하는지 숫자 기준을 세울 수 있습니다.
- tail latency 개선과 증폭 부하 사이의 손익분기점을 운영 지표로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) hedged request는 실패 복구가 아니라 느린 복제본 회피 전략이다

보통 재시도는 오류가 난 뒤 다시 보내는 흐름입니다. 반면 hedged request는 **오류가 나기 전, 너무 느려질 것 같은 순간에 두 번째 기회를 미리 발사**합니다. 예를 들어 120ms 안에 끝나야 하는 읽기 API가 p95에서 자주 400ms 이상 튄다면, 80ms 시점에 같은 요청을 다른 replica나 다른 backend 인스턴스로 한 번 더 보낼 수 있습니다. 이후 먼저 돌아온 응답만 채택하고, 나머지는 취소하거나 버립니다.

핵심은 이 패턴이 쓰기보다는 **멱등성이 보장된 읽기, 캐시 조회, 검색, fan-out 집계**에서 훨씬 잘 맞는다는 점입니다. 쓰기 경로에서 무심코 적용하면 중복 부하와 정합성 비용이 빠르게 커집니다. 쓰기 안전성은 [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/)를 먼저 고정한 뒤 별도로 판단하는 편이 안전합니다.

### 2) 모든 느린 API에 hedging을 붙이면 대개 실패한다

hedged request가 잘 먹히는 조건은 꽤 좁습니다.

1. **응답 시간이 긴 게 아니라 분산이 큰 경우**여야 합니다. 평균 500ms인 API를 2번 쏜다고 100ms가 되지는 않습니다.
2. **대체 경로가 실제로 독립적**이어야 합니다. 같은 DB primary, 같은 saturated worker pool을 두 번 두드리면 꼬리 지연이 그대로 복제됩니다.
3. **취소 전파가 가능**해야 합니다. 늦게 끝난 요청을 끝까지 수행하면 CPU와 DB 읽기량만 늘어납니다.
4. **부하 예산이 남아 있어야** 합니다. 이미 포화된 시스템에서는 hedging이 구조를 더 망가뜨릴 수 있습니다.

실무에서는 “느리면 한 번 더 쏘자”보다, 먼저 **왜 p99가 튀는지 병목 위치를 분해**해야 합니다. 커넥션 풀, GC, 락 대기, 특정 shard hotspot, DNS 흔들림 같은 문제가 원인이면 hedging보다 근본 수정이 먼저입니다.

### 3) 가장 중요한 설계 포인트는 ‘언제 두 번째 요청을 쏘는가’다

hedged request의 품질은 거의 전부 hedge delay에서 갈립니다. 너무 빨리 보내면 불필요한 중복 부하가 폭증하고, 너무 늦게 보내면 사용자 체감 개선이 작습니다.

실무에서 많이 쓰는 시작점은 아래 정도입니다.

- hedge delay: 해당 경로의 `p90` 또는 `p95` 지연시간의 0.8~1.0배
- hedge 비율: 전체 요청의 2~8% 안쪽에서 시작
- 동시 hedge 상한: 인스턴스당 10~50개 또는 전체 inflight의 5% 이내
- 적용 대상: GET, idempotent read, replica/캐시/검색 fan-out 경로 우선

예를 들어 p95가 180ms, p99가 900ms인 검색 API라면 hedge delay를 140~180ms 구간에서 실험할 수 있습니다. 반대로 p95가 이미 60ms인 경로는 얻는 것보다 잃는 게 더 많을 확률이 큽니다.

### 4) hedging은 retry, timeout, admission control과 분리해서 보면 안 된다

현장에서 자주 생기는 실수는 hedged request를 넣고 기존 retry 정책을 그대로 두는 것입니다. 그러면 하나의 사용자 요청이 **원본 1회 + hedge 1회 + 상위 서비스 retry 2회**로 증폭돼 한 번의 흔들림이 네 배, 여섯 배 부하로 번집니다.

그래서 권장 순서는 보통 아래입니다.

1. 상위 요청 deadline부터 고정
2. 단일 요청 timeout과 cancel propagation 정리
3. retry 횟수와 hedge 횟수의 합계 상한 설정
4. admission control로 inflight 상한 제한
5. 그 다음에만 hedging 실험

즉 hedging은 단독 최적화가 아니라 **기존 회복 메커니즘과 합산했을 때 전체 증폭률이 얼마인지**를 같이 봐야 합니다.

### 5) replica 품질이 다를 때만 생각보다 큰 이득이 난다

hedged request가 특히 잘 맞는 상황은 여러 replica나 backend shard의 성능 편차가 있을 때입니다. 예를 들어 6개 search shard 중 1개가 자주 느려지는 구조, 동일 데이터가 여러 AZ에 복제돼 있지만 가끔 네트워크 편차가 발생하는 구조, CDN origin fallback 경로가 존재하는 구조에서는 “늦는 쪽을 버리고 빠른 쪽을 채택”하는 효과가 분명합니다.

반대로 단일 DB primary, 단일 락 경합, 단일 외부 결제사처럼 **공통 병목이 하나인 시스템**에서는 hedging이 거의 이득이 없습니다. 이런 경우는 [Load Testing 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)이나 [Connection Storm 대응](/learning/deep-dive/deep-dive-connection-storm-thundering-herd-playbook/) 쪽에서 병목을 먼저 걷어내야 합니다.

## 실무 적용

### 1) 어디에 먼저 적용할까

우선 후보는 아래 4가지입니다.

- 검색, 추천, 피드 조합처럼 fan-out read가 있는 API
- replica 간 편차가 큰 조회 경로
- p50은 충분히 빠른데 p99만 유독 긴 경로
- 한 요청 실패가 아니라 tail spike 때문에 사용자 이탈이 생기는 화면

보류 후보는 아래에 가깝습니다.

- 결제, 주문 생성, 재고 차감 같은 쓰기 경로
- DB나 외부 API가 이미 포화 상태인 구간
- 취소 전파가 안 되는 레거시 RPC
- 요청 단가가 비싼 대용량 조회나 LLM 호출

### 2) 의사결정 기준(숫자·조건·우선순위)

저는 아래 기준으로 시작하는 편이 현실적이라고 봅니다.

- `p99 / p50 >= 8` 이고, 원인 분석상 replica 편차 또는 일시적 queueing이 보인다.
- 여유 용량이 남아 있어 hedge 도입 후 **추가 요청량 3~5%**를 감당할 수 있다.
- hedge 적용 뒤 `p99`는 최소 20% 이상 개선돼야 한다.
- 대신 CPU, DB read QPS, downstream QPS 증가는 10% 이내여야 한다.
- hedge 승률, 즉 두 번째 요청이 실제 승자가 되는 비율이 15% 미만이면 재검토한다.

우선순위는 항상 **사용자 체감 지연 개선 > 시스템 증폭률 통제 > 인프라 비용** 순으로 둡니다. p99를 5% 줄이려고 downstream 부하를 25% 늘리는 구조는 대체로 손해입니다.

### 3) 관측 지표와 알람

최소한 아래 지표는 따로 봐야 합니다.

- `hedge_trigger_rate`: 전체 요청 중 hedge가 발동한 비율
- `hedge_win_rate`: hedge 요청이 최종 승자가 된 비율
- `hedge_canceled_rate`: 후발 요청 취소 성공률
- `downstream_qps_delta`: 도입 전후 실제 추가 부하
- `tail_latency_delta`: p95, p99 개선 폭

운영 경고 예시는 이 정도가 무난합니다.

- `hedge_trigger_rate > 10%` 10분 지속
- `hedge_win_rate < 10%` 이면서 `downstream_qps_delta > 8%`
- `cancel_success_rate < 90%`
- hedge 도입 후 `error_rate` 또는 `retry_rate` 동반 상승

### 4) 2주 실험 플레이북

**1주차**
- 후보 API 1개만 고릅니다.
- p50, p95, p99와 replica별 지연 편차를 분리 측정합니다.
- 기존 retry 정책과 deadline 예산을 문서화합니다.

**2주차**
- hedge delay를 p95 근처로 시작합니다.
- 트래픽 5%에만 canary 적용합니다.
- p99 개선폭, 추가 QPS, cancel 성공률을 같이 봅니다.
- 손익이 맞지 않으면 delay를 조정하거나 종료합니다.

핵심은 “hedging을 켰다”가 아니라 **hedging이 실제로 승리한 비율과 그 비용**을 같이 보는 것입니다.

## 트레이드오프/주의점

1. **부하가 늘어난다.**  
   hedged request는 공짜 최적화가 아닙니다. 잘 맞는 경로에만 제한적으로 써야 합니다.

2. **공통 병목에는 거의 소용없다.**  
   같은 DB, 같은 락, 같은 외부 API를 두 번 두드리는 구조라면 tail latency가 아니라 낭비만 늘 수 있습니다.

3. **취소 전파가 약하면 효과가 급감한다.**  
   늦은 요청이 끝까지 내려가면 downstream은 이미 일을 다 한 뒤 버려지는 응답만 만들게 됩니다.

4. **retry와 같이 켜면 증폭이 급격해진다.**  
   hedge 횟수, retry 횟수, fan-out 폭을 합친 총 증폭률을 반드시 상한으로 묶어야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 후보 API가 읽기 위주이고 멱등성이 명확하다.
- [ ] p99가 높지만 평균은 충분히 빠른 경로다.
- [ ] hedge delay 기준이 p90/p95 데이터로 정해져 있다.
- [ ] cancel propagation과 inflight 상한이 구현돼 있다.
- [ ] `hedge_win_rate`와 `downstream_qps_delta`를 함께 본다.

### 연습 과제

1. 현재 서비스에서 p50은 빠른데 p99만 높은 API 3개를 골라, 공통 병목인지 replica 편차인지 먼저 분류해 보세요.  
2. 한 경로에 대해 hedge delay를 `p90`, `p95`, `p95 x 1.2` 세 가지로 두고 실험 설계를 만들어 보세요.  
3. hedge 1회, retry 1회, fan-out 3개인 요청의 최악 증폭률을 계산해 보고 admission control 상한을 어디에 둘지 적어 보세요.

## 관련 글

- [Tail Latency Engineering 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Timeout, Retry, Backoff 실전 기준](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [Request Coalescing(singleflight) 패턴](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
- [Connection Storm / Thundering Herd 대응](/learning/deep-dive/deep-dive-connection-storm-thundering-herd-playbook/)
