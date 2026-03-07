---
title: "멀티리전 Active-Active 백엔드 설계: 지연·가용성·정합성의 현실적인 균형"
date: 2026-03-07
draft: false
topic: "Distributed Systems"
tags: ["Multi-Region", "Active-Active", "Consistency", "Disaster Recovery", "SLO"]
categories: ["Backend Deep Dive"]
description: "멀티리전 Active-Active를 도입할 때 팀이 실제로 부딪히는 정합성, 라우팅, 장애복구 이슈를 수치 기준과 함께 정리합니다."
module: "distributed"
study_order: 685
---

## 이 글에서 얻는 것

- Active-Active를 "무조건 좋은 아키텍처"가 아니라 **비용/복잡도 대비 효과**로 판단하는 기준을 갖게 됩니다.
- RTO/RPO, p95 지연시간, 충돌률 같은 **수치 지표 중심 의사결정**을 할 수 있습니다.
- 데이터 종류별(결제/세션/로그)로 일관성 전략을 다르게 가져가는 실무 설계 방법을 익힙니다.
- 점진 전환(Active-Passive → 일부 트래픽 Active-Active → 전면) 로드맵을 세울 수 있습니다.

## 핵심 개념/이슈

### 1) Active-Active의 본질: 장애복구 전략이 아니라 운영모델 전환

많은 팀이 "리전 하나 더 띄우면 가용성이 2배"라고 기대하지만, 실제로는 운영 난이도가 훨씬 더 빨리 증가합니다.
핵심은 인프라 이중화가 아니라 **쓰기 경로 이중화**입니다.

- Active-Passive: 쓰기 리전 1개, 장애 시 전환
- Active-Active: 복수 리전에서 동시에 읽기/쓰기

쓰기 경로가 복수화되면 아래 문제가 즉시 등장합니다.

1. 동일 엔티티 동시 수정 충돌
2. 리전 간 복제 지연으로 인한 stale read
3. 네트워크 분리 시 split-brain 위험

즉, Active-Active는 "DR 고도화"가 아니라 **데이터 충돌을 감당하는 제품 정책**까지 포함한 변화입니다.

### 2) 먼저 정해야 하는 3개 숫자: RTO, RPO, 지연 예산

실무에서는 기술 선택 전에 목표 수치를 먼저 고정해야 합니다.

- **RTO**(복구 시간): 예) 5분 이내
- **RPO**(허용 데이터 유실): 예) 0~5초
- **지연 예산**: 예) 글로벌 API p95 300ms 이내

판단 기준 예시:

- 결제/정산: RPO 0 또는 매우 낮음(강정합 우선)
- 피드/추천: RPO 수초 허용 가능(가용성 우선)
- 사용자 프로필: 충돌 해결 정책이 있으면 eventual consistency 가능

이 수치가 없으면, 팀은 "일단 글로벌 DB" 같은 선택을 하고 나중에 비용 폭탄을 맞습니다.

### 3) 데이터 클래스별 분리 전략

Active-Active에서 가장 중요한 건 "DB 하나로 통일"이 아니라 **데이터를 클래스별로 분리**하는 것입니다.

- **Class A (강정합 필요)**: 결제, 재고, 권한
  - 단일 작성 리전(primary write region) + 타 리전 읽기 제한
  - 또는 합의 기반 DB(지연 증가 감수)
- **Class B (충돌 해결 가능)**: 프로필, 설정, 카운터 일부
  - 멀티마스터 + 버전벡터/last-write-wins + 보정 잡
- **Class C (관측/로그)**: 이벤트, 분석 데이터
  - 비동기 복제, 지연 허용, 재처리 가능 구조

이 분리를 하지 않으면, 모든 데이터를 강정합으로 처리하려다 지연과 비용이 동시에 악화됩니다.

## 실무 적용

### 1) 라우팅 정책: "가장 가까운 리전"만으로는 부족

글로벌 라우팅은 최소 2단계가 필요합니다.

1. 사용자 기준 nearest region (지연 최소화)
2. 요청 성격 기준 write authority region (정합성 보장)

예를 들어 `GET /feed`는 가까운 리전에서 처리해도 되지만, `POST /payments`는 권한 리전으로 강제 라우팅해야 합니다.

권장 운영 기준:

- read API: 지역 라우팅 허용
- write API(금전/권한): authoritative region 고정
- 리전 간 왕복 지연(RTT) 120ms 이상이면 동기 복제 기본값 금지

### 2) 충돌률을 SLO로 관리

팀이 자주 놓치는 지표가 "충돌률"입니다.

- `conflict_rate < 0.1%` 유지
- `replication_lag_p95 < 2s`
- `cross_region_timeout_rate < 1%`

이 수치를 대시보드로 보지 않으면, 사용자는 "가끔 값이 되돌아간다"는 체감으로 먼저 문제를 발견합니다.

[관측가능성 기준 정리](/learning/deep-dive/deep-dive-observability-baseline/)와 함께 충돌/복제 지연 지표를 별도 패널로 분리하세요.

### 3) 점진 전환 시나리오

권장 순서:

1. Active-Passive + 정기 DR 훈련
2. 읽기 트래픽만 멀티리전 분산
3. 비핵심 쓰기(Class B/C)만 Active-Active 전환
4. 고위험 도메인(Class A)은 별도 승인 후 확대

전환 게이트 예시:

- 2주 연속 `error_budget_burn < 25%`
- 복제 지연 p95 2초 이하
- 롤백 런북 리허설 2회 성공

[배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)과 [SLO/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) 기준을 연결하면 운영 리스크를 크게 줄일 수 있습니다.

## 트레이드오프/주의점

1. **가용성과 정합성의 교환**
   - 전 리전 동시 쓰기를 열면 가용성은 좋아지지만 충돌 해결 비용이 증가합니다.
   - "무손실"이 핵심인 도메인은 여전히 단일 권한 리전이 더 안전할 수 있습니다.

2. **비용 구조의 비선형 증가**
   - 복제 트래픽, 데이터 이그레스, 이중 모니터링, 온콜 복잡도가 한 번에 올라갑니다.
   - 대략 트래픽 2배가 아니라 운영비 2.5~4배를 예상해야 현실적입니다.

3. **운영 조직 성숙도 의존**
   - 런북, 장애 훈련, 책임 경계가 없는 팀은 Active-Active 도입 후 MTTR이 오히려 늘 수 있습니다.
   - [카오스 엔지니어링](/learning/deep-dive/deep-dive-chaos-engineering/) 기반 리허설이 필수입니다.

## 체크리스트 또는 연습

### 도입 전 체크리스트

- [ ] 서비스별 RTO/RPO/지연 예산을 문서화했다.
- [ ] 데이터 클래스(A/B/C) 분류와 일관성 정책을 정의했다.
- [ ] 충돌률, 복제 지연, 크로스리전 타임아웃 대시보드를 만들었다.
- [ ] 장애 시 authoritative region 강제 전환 런북을 리허설했다.
- [ ] 비용 상한(월 예산)과 철수 기준(rollback criteria)을 합의했다.

### 연습 과제

현재 운영 중인 서비스 하나를 골라 아래를 작성해보세요.

1. API 20개를 read/write + 위험도(Class A/B/C)로 분류
2. 리전 장애(30분), 복제 지연(10초), split-brain 상황별 대응표 작성
3. "Active-Active를 지금 당장 하지 말아야 하는 이유" 3가지 적기

이 연습을 해보면 기술 선호보다 비즈니스 우선순위로 아키텍처를 선택하는 감각이 생깁니다.

## 관련 글

- [SLO/SLI/Error Budget 실무 적용](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [분산 시스템의 일관성 모델](/learning/deep-dive/deep-dive-consistency-models/)
- [DB Replication과 Read/Write 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [트래픽 컷오버/마이그레이션 전략](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
