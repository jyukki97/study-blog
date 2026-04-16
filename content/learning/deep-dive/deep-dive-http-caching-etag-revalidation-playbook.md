---
title: "백엔드 커리큘럼 심화: HTTP 캐싱·ETag·재검증(Revalidation) 운영 플레이북"
date: 2026-04-03
draft: false
topic: "Performance"
tags: ["HTTP Caching", "ETag", "Cache-Control", "CDN", "Revalidation", "Backend Performance"]
categories: ["Backend Deep Dive"]
description: "캐시 적중률 숫자만 보는 단계를 넘어, Cache-Control/ETag/재검증 정책을 서비스 위험도와 데이터 신선도 기준으로 설계하는 실무 플레이북입니다."
module: "architecture"
study_order: 1164
---

대부분의 팀이 HTTP 캐싱을 "붙이면 빨라지는 옵션" 정도로 생각합니다. 실제 운영에서는 반대입니다. 캐싱은 성능 기능이 아니라 **일관성·비용·장애 반경을 동시에 건드리는 아키텍처 정책**입니다. 5ms 빨라지는 것보다 더 중요한 건, 어떤 데이터는 30초까지 오래 보여도 되는지, 어떤 데이터는 1초만 늦어도 사고인지 합의하는 일입니다.

이 글은 CDN, 브라우저, API 서버가 각각 어떤 책임을 가져야 하는지, 그리고 ETag/재검증을 어디까지 자동화해야 하는지 실무 숫자 기준으로 정리합니다.

## 이 글에서 얻는 것

- `Cache-Control`, `ETag`, `Last-Modified`를 문법이 아니라 **의사결정 도구**로 쓰는 기준을 가져갈 수 있습니다.
- 캐시 적중률(히트율)만 보는 단순 지표에서 벗어나, **신선도 위반률·원본 부하·재검증 비용**까지 함께 보는 운영 관점을 잡을 수 있습니다.
- 엔드포인트별로 캐시 전략을 구분하고, 장애 시 안전하게 강등(degrade)하는 **실무 우선순위(숫자·조건)**를 바로 적용할 수 있습니다.

## 핵심 개념/이슈

### 1) 캐시 정책은 URL 단위가 아니라 "데이터 위험도" 단위로 설계해야 한다

`/api/products/{id}` 같은 경로 기준으로 정책을 통일하면 거의 항상 실패합니다. 같은 경로여도 데이터의 위험도는 다릅니다.

- 재고/가격/주문 상태: 신선도 민감(짧은 TTL 또는 재검증 강제)
- 상품 설명/이미지 메타: 지연 허용(긴 TTL + stale 허용)
- 공지/정책 문서: 매우 긴 캐시(버전 파일 + immutable)

실무에서는 먼저 "허용 가능한 오래됨(staleness)"을 숫자로 잡고, 그 다음 캐시 전략을 매핑합니다.

- Tier A(강한 신선도): 허용 오래됨 1~3초
- Tier B(보통): 10~60초
- Tier C(정적/준정적): 1시간~7일

이 분류는 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)과 같이 정의해야 조직 합의가 됩니다.

### 2) Cache-Control은 "성능 옵션"이 아니라 "계약서"다

자주 보이는 실수는 `max-age=600`만 넣고 끝내는 것입니다. 운영에서 필요한 건 캐시 생명주기 전체 계약입니다.

- `max-age`: 사용자/엣지에서 신선하게 간주하는 시간
- `s-maxage`: CDN(shared cache) 전용 정책
- `stale-while-revalidate`: 백그라운드 재검증 허용 구간
- `stale-if-error`: 원본 장애 시 낡은 응답 임시 제공 구간
- `must-revalidate`: 만료 후 재사용 제한

권장 시작점(조회 API 기준):

- Tier A: `Cache-Control: private, max-age=0, must-revalidate`
- Tier B: `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=30`
- Tier C: `Cache-Control: public, max-age=3600, s-maxage=86400, immutable`

핵심은 "모든 API 캐시"가 아니라, 사용자 영향과 장애 비용을 같이 보고 정책을 나누는 것입니다. [API Rate Limit/Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)와 결합하면 원본 보호 효과가 커집니다.

### 3) ETag/Last-Modified는 트래픽 절감 장치이면서 동시성 보호 장치다

ETag를 단순 304 최적화로만 보면 절반만 본 겁니다. 실무에서는 두 가지 역할이 중요합니다.

1. **읽기 재검증 비용 절감**: 바뀌지 않은 응답은 본문 없이 304 반환
2. **쓰기 충돌 방지**: `If-Match`로 낙관적 동시성 제어

운영 규칙 예시:

- 엔티티 버전이 있는 리소스: 강한 ETag(`"v42"`) 우선
- 집계/동적 조합 응답: 약한 ETag(`W/"..."`) 허용
- 수정 API(PUT/PATCH): `If-Match` 없는 요청은 428 또는 412 처리

즉, ETag는 성능과 정합성을 동시에 잡는 도구입니다. 이 부분은 [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/)나 [DB 락/격리수준](/learning/deep-dive/deep-dive-mysql-isolation-locks/)과 함께 설계해야 효과가 납니다.

### 4) 캐시 적중률이 높아도 서비스 품질은 나쁠 수 있다

히트율 95%인데 불만이 많은 서비스가 흔합니다. 이유는 "틀린 데이터를 빠르게 전달"하기 때문입니다. 그래서 최소 지표 세트가 필요합니다.

- `cache_hit_ratio` (엔드포인트/테넌트별)
- `revalidation_304_ratio`
- `stale_served_ratio`
- `freshness_violation_rate` (SLO 초과 오래됨)
- `origin_qps_reduction`

즉 성능 지표 + 정확성 지표를 같이 봐야 합니다. 관측 설계는 [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)과 [알람 전략](/learning/deep-dive/deep-dive-observability-alarms/) 기준으로 묶는 편이 안전합니다.

## 실무 적용

### 1) 엔드포인트 분류와 기본 정책(숫자·조건·우선순위)

우선순위는 **정확성 > 원본 보호 > 평균 응답속도**로 둡니다.

1. Tier A(결제/재고/주문 상태)
   - 기본: `max-age=0, must-revalidate`
   - 조건: 신선도 위반률 목표 0.1% 미만
   - CDN 캐시: 필요 시 키 좁게(사용자/권한 포함)

2. Tier B(카탈로그/검색 결과 일부)
   - 기본: `max-age=15~60s`, `stale-while-revalidate=30~120s`
   - 조건: 원본 QPS 30% 이상 절감 목표
   - 경고: stale 제공 비율이 20% 넘으면 TTL 재조정

3. Tier C(문서/정적 메타)
   - 기본: 버전 해시 URL + `immutable`
   - 조건: 배포 시 캐시 무효화 비용 최소화

### 2) 3단계 롤아웃 플랜

**1주차: 측정 고정**
- 주요 20개 API의 현재 헤더/TTL/히트율/오래됨 위반률 수집
- 캐시 키 설계 문서화(권한·언어·테넌트 분리 포함)

**2주차: 정책 적용**
- Tier B/C부터 `s-maxage`, `stale-while-revalidate` 적용
- ETag 생성 로직 통일(버전 필드 또는 콘텐츠 해시)
- 수정 API에 `If-Match` 검증 추가

**3주차: 보호 자동화**
- 원본 장애율 상승 시 `stale-if-error` 임시 확장(예: 60→300초)
- 신선도 위반률 초과 시 자동으로 TTL 축소
- 대시보드에 "원본 보호 효과 vs 오래됨 비용" 비교 차트 추가

### 3) 의사결정 게이트 예시

- 10분 이동창에서 `freshness_violation_rate > 0.5%`면 즉시 TTL 50% 축소
- `origin_cpu > 75%` + `tierB hit_ratio < 70%`면 캐시 키 과분할 여부 점검
- `stale_served_ratio > 30%` 30분 지속 시 revalidation 병목(ETag 계산, 조건부 GET) 우선 점검

## 트레이드오프/주의점

1) **TTL을 짧게 줄이면 정확성은 좋아지지만 원본 비용이 급증한다**  
특히 트래픽 피크 시간에 재검증 폭증이 생기면 DB/앱 서버가 먼저 포화됩니다.

2) **stale-while-revalidate는 UX를 살리지만 오류를 가릴 수 있다**  
장애를 숨겨 평균 응답속도는 좋아 보여도, 실제 데이터 지연은 커질 수 있습니다.

3) **ETag 계산이 무거우면 최적화가 역효과가 날 수 있다**  
대형 응답의 전체 해시를 매번 계산하면 CPU를 더 씁니다. 버전 기반 ETag가 가능한 구조를 우선 고려하세요.

4) **캐시 키 설계가 느슨하면 데이터 누출 사고로 이어질 수 있다**  
권한/테넌트/언어 분리가 빠지면 성능 문제가 아니라 보안 사고가 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 엔드포인트를 데이터 위험도(Tier A/B/C)로 분류했다.
- [ ] 각 Tier별 허용 오래됨(초)을 문서로 합의했다.
- [ ] `Cache-Control` 정책에 `s-maxage`, `stale-*` 사용 여부가 명확하다.
- [ ] ETag/If-Match를 읽기·쓰기 경로 모두에서 검토했다.
- [ ] 히트율 외에 신선도 위반률/원본 보호 지표를 함께 모니터링한다.

### 연습 과제

1. 현재 운영 중인 조회 API 5개를 골라 Tier를 분류하고, `max-age/s-maxage/stale-*` 초깃값을 제안해 보세요.  
2. 수정 API 1개를 골라 `If-Match` 기반 충돌 방지를 설계하고, 412 응답 시 클라이언트 재시도 UX를 정의해 보세요.  
3. "원본 CPU 80% 초과 시 stale-if-error를 5분까지 확장" 같은 긴급 정책을 만들고, 해제 조건(예: CPU 60% 10분 유지)을 숫자로 정해보세요.

## 관련 글

- [HTTP 기본기 정리](/learning/deep-dive/deep-dive-http-essentials/)
- [HTTP 심화: 헤더/캐시/커넥션 관점](/learning/deep-dive/deep-dive-http-deep-dive/)
- [API Rate Limit & Backpressure 설계](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [Observability Alarms 실전](/learning/deep-dive/deep-dive-observability-alarms/)
