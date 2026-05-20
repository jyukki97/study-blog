---
title: "백엔드 커리큘럼 심화: Shadow Traffic과 Dark Launch 운영 플레이북"
date: 2026-05-07
draft: false
topic: "Operations"
tags: ["Shadow Traffic", "Dark Launch", "Traffic Mirroring", "Progressive Delivery", "Observability"]
categories: ["Backend Deep Dive"]
description: "새 기능을 사용자에게 바로 노출하지 않고 실제 트래픽과 유사한 조건에서 검증하는 Shadow Traffic·Dark Launch의 설계 기준과 운영 체크리스트를 정리합니다."
module: "backend-ops-observability"
study_order: 1195
---

새 기능을 배포할 때 가장 위험한 순간은 코드가 merge되는 순간이 아니라, 실제 사용자 트래픽을 처음 만나는 순간입니다. 테스트 환경에서는 데이터가 작고, 요청 패턴이 단순하고, 외부 API 장애도 잘 재현되지 않습니다. 그래서 기능 플래그를 켜기 전부터 "운영 트래픽과 비슷한 조건에서 망가질 기회"를 일부러 만들어야 합니다. 이때 쓰는 대표적인 방식이 **Shadow Traffic**과 **Dark Launch**입니다.

Shadow Traffic은 실제 요청을 복제해 새 시스템에도 흘려보내되, 새 시스템의 응답은 사용자에게 돌려주지 않는 방식입니다. Dark Launch는 기능을 배포하고 내부적으로 실행하지만 사용자 경험에는 노출하지 않는 방식입니다. 둘 다 목적은 같습니다. **사용자 영향 없이 성능, 정합성, 비용, 장애 전파를 먼저 보는 것**입니다. 이 글은 [Feature Flag](/learning/deep-dive/deep-dive-feature-flags/), [Traffic Cutover & Migration](/learning/deep-dive/deep-dive-traffic-cutover-migration/), [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)을 실제 릴리스 검증 절차로 묶어 정리합니다.

## 이 글에서 얻는 것

- Shadow Traffic과 Dark Launch를 카나리 배포와 구분해서 이해할 수 있습니다.
- 실제 트래픽 복제에서 요청 부작용, 개인정보, 비용 폭증을 어떻게 막아야 하는지 기준을 잡을 수 있습니다.
- 새 백엔드 경로를 공개하기 전 p95/p99, diff rate, error budget, rollback 조건을 숫자로 정의할 수 있습니다.

## 핵심 개념/이슈

### 1) 카나리는 사용자 일부에게 실제 응답을 주고, shadow는 응답을 버린다

카나리 배포는 전체 사용자 중 1%, 5%, 10%처럼 일부를 새 버전으로 보내고 새 버전의 응답을 실제로 사용합니다. 반면 shadow traffic은 원본 요청을 복제해 새 경로에도 보내지만, 사용자는 기존 경로의 응답만 받습니다. 그래서 shadow는 기능 정확도와 성능을 미리 볼 수 있지만, 사용자 경험 검증은 할 수 없습니다.

의사결정 기준은 이렇게 잡으면 좋습니다.

- 새 시스템이 읽기 전용 계산, 검색, 추천, 가격 조회라면 shadow traffic부터 시작한다.
- 쓰기 부작용이 있거나 결제·주문·포인트처럼 외부 상태를 바꾸는 요청은 shadow에서 기본 차단한다.
- 사용자 UX, 화면 흐름, 클라이언트 호환성까지 봐야 하면 카나리 또는 기능 플래그가 필요하다.
- 레거시와 신규 응답을 비교해야 한다면 shadow + diff checker가 가장 먼저다.

즉 shadow는 "안전한 실제 부하 검증"이고, 카나리는 "제한된 실제 사용자 검증"입니다. 둘을 섞어 부르면 런북이 흐려집니다.

### 2) 복제하면 안 되는 요청부터 정의해야 한다

Shadow Traffic에서 가장 중요한 것은 어떤 요청을 복제할지가 아니라 **무엇을 절대 복제하지 않을지**입니다. POST 요청이라고 모두 위험한 것도 아니고, GET 요청이라고 모두 안전한 것도 아닙니다. 조회 API라도 캐시 warming, rate limit 차감, 외부 API 과금, 추천 로그 적재 같은 부작용이 있을 수 있습니다.

초기 allowlist 기준은 보수적으로 잡습니다.

- 읽기 전용이며 외부 상태를 바꾸지 않는다.
- 인증 토큰, 세션 쿠키, PII가 마스킹 또는 대체된다.
- downstream 호출이 production write path로 이어지지 않는다.
- shadow 요청임을 식별하는 헤더가 모든 하위 서비스에 전달된다.
- 실패해도 원본 응답 지연에 영향을 주지 않는다.

추천 헤더는 `X-Shadow-Traffic: true`, `X-Shadow-Run-Id`, `X-Original-Request-Id`처럼 명시적으로 둡니다. 로그와 트레이스에도 이 값을 남겨야 합니다. 관측 기준은 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)과 [OpenTelemetry](/learning/deep-dive/deep-dive-opentelemetry/)를 같이 적용하면 좋습니다.

### 3) diff는 완전 일치보다 허용 오차를 먼저 설계한다

새 시스템 응답을 기존 시스템과 비교할 때 모든 필드가 100% 같아야 한다고 잡으면 금방 실패합니다. timestamp, 정렬 순서, floating point, 추천 점수, nullable field, paging cursor는 정상적으로 달라질 수 있습니다. 그래서 diff checker는 필드별 규칙을 가져야 합니다.

예시 기준:

- 주문 금액, 재고 수량, 권한 판정: **정확히 일치**
- 검색 결과 Top 10: 핵심 문서 overlap **90% 이상**
- 추천 점수: 상대 순위 변화 **상위 20개 중 2개 이하**
- 응답 시간: 신규 p95가 기존 대비 **1.2배 이하**, p99는 **1.5배 이하**
- 에러율: 신규 error rate가 기존 대비 **0.2%p 이상 높으면 중단**

중요한 점은 diff 실패를 모두 버그로 보지 않는 것입니다. 일부는 신규 로직이 더 정확해서 생긴 차이일 수 있습니다. 하지만 운영 기준은 반대입니다. **차이가 맞다는 증거가 있기 전까지는 위험으로 분류**해야 합니다.

### 4) Shadow는 원본 경로의 latency budget을 침범하면 안 된다

Shadow 호출은 원본 요청 흐름에서 비동기로 분리하는 것이 기본입니다. 사용자가 받는 응답이 shadow 대상 시스템의 지연에 묶이면, 검증을 위해 운영 품질을 희생하는 꼴이 됩니다.

기본 구조는 아래가 안전합니다.

```text
client -> gateway -> current service -> response
                  \-> async shadow dispatcher -> candidate service -> diff/log only
```

운영 숫자는 시작점으로 이렇게 둘 수 있습니다.

- shadow dispatch timeout: 원본 p95의 **20~30% 이하**
- shadow queue lag: **1분 이하** 목표, 5분 초과 시 자동 중단
- shadow sampling rate: 1%에서 시작, 안정 시 5% → 10% → 25%
- candidate service CPU headroom: **30% 이상**
- downstream 외부 API 호출은 기본 mock 또는 stub, 필요 시 별도 quota

이 기준은 [Capacity Planning](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)과 연결됩니다. 평소에도 여유가 없는 서비스에 shadow를 얹으면, 검증이 아니라 장애 리허설이 됩니다.

### 5) Dark Launch는 실행됐지만 보이지 않는 기능이다

Dark Launch는 코드와 인프라는 운영 환경에 배포하되 사용자에게 기능을 노출하지 않는 방식입니다. 예를 들어 새 추천 모델을 계산만 하고 화면에는 기존 추천을 보여주거나, 새 정산 파이프라인을 실행하되 결과를 실제 장부에 반영하지 않는 식입니다.

실무에서는 다음 질문에 답해야 합니다.

- 계산 결과가 어디에 저장되는가?
- 저장된 결과가 실사용 경로로 흘러갈 가능성은 없는가?
- 비용은 사용자 수에 비례해 얼마나 증가하는가?
- 실패했을 때 알람은 울리지만 고객 영향은 없는가?
- 언제 shadow/dark 상태에서 카나리로 넘어갈 것인가?

Dark Launch는 [Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/)와 잘 맞습니다. 다만 feature flag만 켰다고 안전해지는 것은 아닙니다. flag off 상태에서도 코드가 DB write, message publish, external API call을 한다면 이미 사용자 영향이 생긴 것입니다.

## 실무 적용

### 1) Shadow Runbook을 먼저 만든다

구현 전에 아래 항목을 문서화합니다.

- 대상 endpoint와 제외 endpoint
- 샘플링 비율과 증가 조건
- request/response 마스킹 규칙
- downstream write 차단 방식
- diff checker 규칙
- 중단 기준과 담당자
- 결과 보존 기간

특히 제외 endpoint는 allowlist보다 더 중요합니다. 결제, 주문 생성, 포인트 적립, 이메일/SMS 발송, 외부 파트너 callback은 기본적으로 shadow 금지입니다. 꼭 검증해야 한다면 production 요청 복제가 아니라 synthetic replay 환경을 따로 만들어야 합니다.

### 2) 3단계로 확대한다

처음부터 50% shadow를 걸면 비용과 장애 반경이 커집니다.

1. **Offline replay**: 저장된 sanitized request로 후보 시스템 실행
2. **Low-rate shadow**: 운영 트래픽 1~5% 복제, 응답 폐기
3. **High-rate shadow 또는 dark launch**: 10~25% 이상 확대, diff와 비용 확인
4. **Canary**: 제한된 사용자에게 실제 응답 제공

각 단계의 승격 조건은 숫자로 둡니다.

- diff critical mismatch 0건
- p95 latency 기존 대비 1.2배 이하
- p99 latency 기존 대비 1.5배 이하
- candidate error rate 0.5% 이하 또는 기존 대비 +0.2%p 이하
- shadow queue lag 1분 이하
- PII/masking violation 0건

이 조건 중 하나라도 깨지면 샘플링을 올리지 않습니다. 운영 검증은 감이 아니라 gate여야 합니다.

### 3) 결과를 릴리스 리뷰에 붙인다

Shadow 결과는 로그에 묻히면 의미가 없습니다. 릴리스 PR이나 배포 승인 화면에 최소한 아래 요약이 있어야 합니다.

- 총 shadow 요청 수
- endpoint별 diff rate
- critical mismatch 예시 3개
- 기존 대비 p95/p99 변화
- candidate error rate
- downstream 호출 수와 비용 추정
- 중단/재시도 횟수

이 증거 묶음은 [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)과 같은 방향입니다. 테스트 통과만으로 부족한 변경은 운영 트래픽 기반 증거까지 같이 봐야 합니다.

## 트레이드오프/주의점

Shadow Traffic과 Dark Launch는 강력하지만 비용이 있습니다. 트래픽을 복제하면 CPU, 네트워크, 로그, trace, 외부 API 비용이 늘어납니다. 특히 로그 샘플링 없이 full trace를 남기면 검증 비용이 실제 배포 비용보다 커질 수 있습니다.

또 하나의 함정은 보안입니다. 운영 요청을 복제하는 순간 개인정보, 인증 토큰, 쿠키, 내부 식별자가 새 경로로 흘러갑니다. 새 시스템이 아직 hardening되지 않았다면 shadow가 데이터 노출 경로가 됩니다. 따라서 기본 원칙은 아래입니다.

- 토큰과 쿠키는 원문 전달하지 않는다.
- PII 필드는 hash, redact, synthetic substitute 중 하나로 처리한다.
- shadow 대상 시스템은 production write 권한을 갖지 않는다.
- 로그 보존 기간은 짧게 시작한다. 예: 7~14일
- shadow 실패는 원본 요청 retry를 유발하지 않는다.

의사결정 우선순위는 **데이터 안전성 > 사용자 영향 차단 > 성능 검증 > 출시 속도**입니다. 출시가 하루 늦어지는 것보다, shadow 요청이 실제 결제나 알림을 중복 실행하는 사고가 훨씬 비쌉니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] shadow 대상 endpoint가 allowlist로 관리된다.
- [ ] 결제, 주문, 포인트, 알림, 외부 callback은 기본 제외된다.
- [ ] `X-Shadow-Traffic` 같은 식별자가 gateway부터 downstream까지 전달된다.
- [ ] PII, 토큰, 쿠키 마스킹 규칙이 있다.
- [ ] candidate system은 production write 권한이 없다.
- [ ] diff checker가 필드별 허용 오차를 가진다.
- [ ] p95/p99, error rate, queue lag, 비용 기준이 샘플링 증가 조건에 들어간다.
- [ ] shadow 결과가 릴리스 리뷰 증거로 남는다.

### 연습

운영 중인 읽기 API 하나를 골라 shadow runbook 초안을 작성해 보세요.

1. 이 API는 정말 읽기 전용인가? 숨은 write나 외부 과금은 없는가?
2. 요청에서 제거해야 할 PII와 인증 정보는 무엇인가?
3. 기존 응답과 신규 응답을 비교할 때 정확히 일치해야 하는 필드는 무엇인가?
4. 1% shadow에서 하루 예상 요청 수와 추가 비용은 얼마인가?
5. 어떤 숫자가 나오면 즉시 shadow를 중단할 것인가?

이 다섯 가지를 답하지 못하면 바로 카나리로 가기에는 이릅니다. 먼저 사용자에게 보이지 않는 곳에서 실패를 수집하는 경로를 만드는 편이 안전합니다.
