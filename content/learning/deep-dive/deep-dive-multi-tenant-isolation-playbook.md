---
title: "백엔드 커리큘럼 심화: 멀티테넌트 격리 전략 플레이북"
date: 2026-03-21
draft: false
topic: "Architecture"
tags: ["Multi-Tenant", "Isolation", "Noisy Neighbor", "RLS", "SaaS"]
categories: ["Backend Deep Dive"]
description: "공유 스키마부터 전용 클러스터까지 멀티테넌트 격리 모델의 선택 기준과 마이그레이션 순서를 실무 숫자 기준으로 정리합니다."
module: "backend-architecture"
study_order: 1111
---

SaaS를 운영하다 보면 멀티테넌트 구조는 언젠가 반드시 다시 설계하게 됩니다. 초기에는 공유 스키마(shared schema)가 빠르고 싸지만, 고객 규모가 커지면 특정 테넌트의 트래픽 폭증이 전체 지연시간을 흔들고, 보안/컴플라이언스 요구가 높아지면 "같은 DB에 있어도 괜찮나?"라는 질문이 반복됩니다.

문제는 기술 선택보다 순서입니다. 많은 팀이 격리 수준을 올리기 전에 코드·인덱스·운영 정책을 정리하지 않아, 비용만 증가하고 장애는 그대로 남는 상황을 겪습니다. 이 글은 멀티테넌시 격리를 단순 패턴 소개가 아니라 **언제, 어떤 조건에서, 무엇을 먼저 바꿔야 하는지**에 초점을 맞춰 정리합니다.

## 이 글에서 얻는 것

- 공유 스키마, 분리 스키마, 전용 DB, 전용 클러스터를 **테넌트 특성별로 선택**하는 기준을 가져갈 수 있습니다.
- 노이즈 네이버(noisy neighbor)와 데이터 경계 사고를 줄이기 위해, 애플리케이션·DB·인프라 레이어에서 어떤 통제를 먼저 적용해야 하는지 우선순위를 잡을 수 있습니다.
- 운영 중인 서비스에서 다운타임 없이 격리 수준을 올리는 **점진 마이그레이션 플랜**을 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 격리 모델은 4단계로 보되, "정답"보다 "전환 비용"을 먼저 본다

멀티테넌트 구조는 보통 아래 4단계로 구분합니다.

1. **Shared DB + Shared Schema**
   - 장점: 개발 속도 빠름, 운영 단순
   - 단점: 테넌트 경계 누락 시 사고 범위 큼
2. **Shared DB + Separate Schema**
   - 장점: 논리적 경계 강화, 마이그레이션 단위 분리 가능
   - 단점: 스키마 수 증가 시 DDL/배포 복잡도 급증
3. **Separate DB per Tenant Group**
   - 장점: 성능 격리와 장애 격리 강화
   - 단점: 운영 자동화 없으면 인력 비용 증가
4. **Dedicated Cluster for High-Tier Tenant**
   - 장점: 최고 수준의 성능/보안/컴플라이언스 격리
   - 단점: 인프라 비용과 운영 파편화

핵심은 "현재 구조가 나쁘다"가 아니라, **다음 단계로 가야 할 트리거 조건**을 수치로 갖는 것입니다. 예를 들어 아래 조건을 2개 이상 만족하면 상위 격리를 검토합니다.

- 단일 테넌트가 전체 QPS의 25% 이상 점유
- 단일 테넌트 배치가 DB CPU를 15분 이상 70% 이상 점유
- 특정 규제 고객(금융/의료 등)의 데이터 물리 격리 요구 발생
- 테넌트별 RPO/RTO 요구가 서로 달라 공통 운영이 깨짐

이 기준은 [용량 계획과 포화도 해석](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)과 같이 보아야 현실적인 임계치를 잡을 수 있습니다.

### 2) 멀티테넌시 사고의 대부분은 성능보다 "경계 누락"에서 시작된다

실무에서 더 치명적인 사고는 느림보다 데이터 경계 위반입니다. 흔한 원인은 아래와 같습니다.

- 쿼리에서 `tenant_id` 조건 누락
- 캐시 키에 tenant dimension 미포함
- 비동기 이벤트에 tenant context 누락
- 운영 스크립트가 전체 테이블을 대상으로 실행

그래서 격리 전략의 첫 단계는 인프라 분리보다 **경계 강제 장치**입니다.

- DB 제약: 복합 PK/UK에 `tenant_id` 포함
- ORM 규칙: tenant scope 없는 Repository 호출 금지
- API 규칙: JWT claim과 path tenant 불일치 시 즉시 403
- 배치 규칙: 기본 쿼리는 tenant range required

권한 모델과 함께 설계해야 하므로 [RBAC/ABAC/ReBAC 비교](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)를 같이 참조하면 안전합니다.

### 3) Noisy Neighbor는 "리소스 상한 + 우선순위 큐" 없이는 해결되지 않는다

멀티테넌트 시스템의 성능 문제는 보통 평균 응답시간이 아니라 특정 시간대의 tail latency 급등으로 나타납니다. 원인은 단순합니다. 큰 고객의 대량 작업이 커넥션 풀, 워커 슬롯, 캐시를 독점하기 때문입니다.

최소한 아래 3가지는 기본값으로 넣어야 합니다.

- **테넌트별 동시성 상한**: 예) 기본 플랜 20, 엔터프라이즈 100
- **테넌트별 rate limit**: 예) burst 2배, 지속 트래픽은 계약 QPS 기준
- **우선순위 큐 분리**: 실시간 API와 배치를 같은 큐에 넣지 않기

이 영역은 [Admission Control과 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/) 및 [Rate Limiter 설계](/learning/deep-dive/deep-dive-rate-limiter-design/)와 직접 연결됩니다.

### 4) 데이터 모델은 "공유"보다 "확장 가능성" 기준으로 설계해야 한다

초기에는 공통 테이블에 `tenant_id`만 추가하면 충분해 보이지만, 고객별 커스텀 요구가 늘면 스키마가 급격히 복잡해집니다. 이때 흔히 하는 실수가 커스텀 필드를 무제한 JSON 컬럼에 밀어 넣는 방식입니다. 단기적으로는 빠르지만, 인덱스·검증·리포팅에서 비용이 폭발합니다.

권장 원칙은 아래와 같습니다.

- 코어 도메인 컬럼은 정규화 + 명시적 타입 유지
- 고객별 확장 필드는 JSON로 두되, 조회 핵심 필드는 생성 컬럼/보조 인덱스로 승격
- 핫 테이블은 tenant 기준 파티셔닝 검토(쓰기 증폭과 DDL 영향 같이 검토)

스키마 진화는 [Expand/Contract 온라인 DDL](/learning/deep-dive/deep-dive-online-ddl-expand-contract/) 원칙을 적용해야 중단 없이 진행됩니다.

### 5) 격리 수준 상향은 "빅뱅"보다 "테넌트 등급 기반"이 현실적이다

운영 중 서비스에서 전체 테넌트를 한 번에 분리하려 하면 실패 확률이 높습니다. 보통 아래 순서가 안전합니다.

1. Gold 등급 상위 5~10개 테넌트 우선 분리
2. 트래픽/데이터량 기준으로 나머지 테넌트를 그룹화
3. 신규 대형 테넌트는 온보딩 단계에서 기본 분리

즉 "전체 일괄 마이그레이션"이 아니라 **고위험·고가치 테넌트 우선 격리**가 비용 대비 효과가 큽니다.

## 실무 적용

### 1) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **데이터 경계 안전성 > SLO 안정성 > 인프라 비용 최적화**로 두는 것이 안전합니다.

- **L1(공유 스키마 유지 가능)**
  - 테넌트 상위 1개 QPS 비중 < 15%
  - P99 지연의 테넌트 편차 < 2배
  - 규제상 물리 분리 요구 없음
- **L2(분리 스키마 전환 검토)**
  - 상위 테넌트 QPS 비중 15~30%
  - 고객별 데이터 삭제/보존 정책 차이가 커짐
  - 스키마 변경 실패 시 영향 범위 축소 필요
- **L3(분리 DB/클러스터 필요)**
  - 상위 테넌트 1개가 CPU/IO의 30% 이상 상시 점유
  - 특정 고객의 전용 암호화키·전용 백업 요구
  - 장애 전파 허용 범위를 "단일 고객"으로 제한해야 함

### 2) 6주 도입 플랜(중단 없는 전환)

**1~2주차: 가시성 확보**
- tenant_id 기준으로 API 지연, DB 부하, 오류율 대시보드 분리
- 테넌트별 비용/리소스 점유율 산출

**3~4주차: 경계 강제 및 성능 가드레일 적용**
- 쿼리/캐시/이벤트에 tenant context 누락 탐지 룰 추가
- 테넌트별 concurrency/rate limit 적용
- 배치 트래픽 시간대 분리

**5~6주차: 상위 테넌트 점진 분리**
- Shadow read로 데이터 정합성 검증
- 읽기 전환 → 쓰기 전환 → 백필 정리 순으로 롤아웃
- 롤백 조건: 오류율 +1%p 초과 또는 P99 1.5배 초과

### 3) 운영 지표 최소 세트

- `tenant_request_p95/p99`
- `tenant_db_cpu_share`, `tenant_db_iops_share`
- `tenant_error_rate`, `tenant_timeout_rate`
- `tenant_background_job_runtime`
- `cross_tenant_access_violation_count`

이 지표가 있어야 분리 이후 개선 효과를 검증할 수 있고, "느낌상 좋아졌다" 수준에서 멈추지 않습니다.

## 트레이드오프/주의점

1) **격리 수준을 올리면 비용과 운영 복잡도는 거의 반드시 증가한다**  
전용 DB/클러스터는 안정성을 주지만, 백업·모니터링·배포 파이프라인을 테넌트 단위로 관리해야 합니다.

2) **공유 모델을 오래 유지하면 단기 생산성은 높지만, 구조적 부채가 누적된다**  
특히 tenant 경계 누락은 테스트로 100% 막기 어렵기 때문에, 시간이 지날수록 사고 확률이 올라갑니다.

3) **고객 맞춤 요구를 그대로 수용하면 플랫폼 일관성이 무너진다**  
예외 정책을 계속 추가하면 자동화가 깨집니다. 표준 80%, 예외 20% 원칙을 유지해야 합니다.

4) **분리 전환 시 데이터 삭제/보존 정책을 함께 재정의해야 한다**  
데이터 위치가 달라지면 삭제 증빙과 백업 파기 절차도 달라집니다. [데이터 보존/삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 같이 설계해야 사고를 줄일 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 모든 읽기/쓰기 경로에 tenant_id 강제 규칙이 있다.
- [ ] 테넌트별 SLO와 테넌트별 리소스 점유율을 함께 본다.
- [ ] 상위 테넌트 분리 트리거(숫자 기준)가 문서화되어 있다.
- [ ] 분리 전환의 롤백 조건(오류율/P99/정합성)이 명시되어 있다.
- [ ] 보안·컴플라이언스 요구를 격리 모델 선택 기준에 반영했다.

### 연습 과제

1. 현재 서비스의 상위 10개 테넌트를 대상으로 `QPS`, `DB CPU`, `월 매출`, `컴플라이언스 요구`를 한 표로 정리하고, 각 테넌트의 목표 격리 레벨(L1~L3)을 지정해 보세요.  
2. `tenant_id 누락`을 자동 탐지하는 정적 분석/쿼리 린트 규칙 3개를 정의해 보세요.  
3. 상위 1개 테넌트를 분리한다고 가정하고, 2시간 내 롤백 가능한 컷오버 런북을 작성해 보세요.

## 관련 글

- [용량 계획과 Little’s Law 기반 포화도 해석](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/)
- [Admission Control과 Concurrency Limit 설계](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [Rate Limiter 설계 원리와 실무 패턴](/learning/deep-dive/deep-dive-rate-limiter-design/)
- [온라인 스키마 변경 Expand/Contract 플레이북](/learning/deep-dive/deep-dive-online-ddl-expand-contract/)
- [권한 모델 비교: RBAC/ABAC/ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
