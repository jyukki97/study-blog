---
title: "백엔드 커리큘럼 심화: Bounded Staleness와 Read-Your-Writes 보장 설계 플레이북"
date: 2026-03-27
draft: false
topic: "Distributed Systems"
tags: ["Bounded Staleness", "Read Your Writes", "Replication", "Consistency", "SLO"]
categories: ["Backend Deep Dive"]
description: "읽기 복제 구조에서 사용자 체감 일관성을 지키기 위해 Bounded Staleness, Read-Your-Writes, 라우팅 정책을 숫자 기준으로 설계하는 실무 플레이북입니다."
module: "backend-distributed"
study_order: 1141
---

트래픽이 늘면 대부분의 서비스는 읽기 복제를 붙입니다. 문제는 그 다음부터 시작됩니다. 쓰기는 primary에 들어가는데 읽기는 replica로 빠지면서, 같은 사용자가 방금 저장한 데이터를 바로 다시 조회했을 때 "없다"고 나오는 순간이 생깁니다. 기능은 정상인데 사용자 입장에서는 장애처럼 보이는 전형적인 케이스입니다.

이 이슈는 단순히 "복제 지연이 있어서요"로 설명하면 해결되지 않습니다. 실무에서는 **어느 사용자 흐름에서 얼마나 오래 stale read를 허용할지**를 명시하고, 라우팅·캐시·재시도 정책을 함께 맞춰야 합니다. 즉 정답은 DB 옵션 하나가 아니라 서비스 레벨 일관성 계약(Consistency Contract)입니다.

이 글은 Read-Your-Writes(RYW)와 Bounded Staleness를 운영 가능한 기준으로 정리합니다. 핵심은 이론이 아니라 **숫자로 합의 가능한 판단 기준**입니다.

## 이 글에서 얻는 것

- RYW/Monotonic Read를 언제 강제하고, 언제 완화해야 하는지 사용자 여정 기준으로 분류할 수 있습니다.
- 복제 지연, 캐시 TTL, 요청 라우팅을 하나의 SLO로 묶는 방법을 가져갈 수 있습니다.
- 장애가 나기 전에 "허용 가능한 stale window"를 명문화해 팀 간 논쟁 비용을 줄일 수 있습니다.

## 핵심 개념/이슈

### 1) 일관성은 전역 옵션이 아니라 "화면/행동 단위 계약"이다

대부분의 시스템에서 모든 읽기에 강한 일관성을 강제하면 비용이 급격히 올라갑니다. 반대로 전부 eventual로 두면 핵심 플로우에서 신뢰가 깨집니다. 그래서 먼저 읽기 경로를 아래처럼 나눕니다.

1. **강제 RYW 구간**: 결제 직후 주문내역, 비밀번호 변경 직후 보안설정 조회, 관리자 권한 수정 확인
2. **Bounded Staleness 허용 구간**: 피드, 통계 대시보드, 추천 결과
3. **완전 eventual 허용 구간**: 배치성 집계, 비핵심 카운터

이 분류를 하지 않으면 "모든 API에서 stale read 0초" 같은 비현실 목표가 생깁니다. 기본 개념은 [Consistency Models 정리](/learning/deep-dive/deep-dive-consistency-models/)를 참고하고, 실제 읽기 구조는 [Replication/Read-Write Splitting](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)과 같이 봐야 맥락이 맞습니다.

### 2) Bounded Staleness는 "복제 지연"만이 아니라 "전체 읽기 경로 지연"이다

실무에서 stale window는 보통 아래 합으로 결정됩니다.

- `replica_apply_lag` (복제 적용 지연)
- `cache_ttl_effective` (캐시 유효 시간 + 무효화 전파 지연)
- `client_retry_gap` (클라이언트 재조회 간격)

즉 DB에서 300ms 지연이어도 캐시 TTL이 3초면 사용자 체감은 3초+가 됩니다. 그래서 일관성 목표는 DB 지표 하나로 관리하면 실패합니다.

권장 관리 지표 예시:

- `ryw_violation_rate` (최근 쓰기 후 N초 내 불일치 비율)
- `replica_lag_p95/p99`
- `fresh_read_ratio` (강제 최신 읽기 경로 비율)
- `cache_invalidation_delay_p95`

운영 알림 기준 예시:

- `ryw_violation_rate > 0.5%`가 10분 지속
- `replica_lag_p95 > 1.2s` 또는 `p99 > 3s`
- 강제 최신 읽기 비율이 평시 대비 2배 이상 증가(시스템 불안정 신호)

캐시와의 결합 문제는 [Cache Consistency/Invaliation 플레이북](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)을 같이 적용해야 합니다.

### 3) RYW 구현은 "무조건 primary read"보다 토큰/윈도우 기반 라우팅이 효율적이다

단순한 방법은 쓰기 직후 모든 읽기를 primary로 보내는 것입니다. 하지만 이 방식은 피크 시간에 primary를 빠르게 포화시킵니다. 보통 더 현실적인 방식은 아래 2단계입니다.

- **세션 토큰 방식**: 쓰기 시점의 LSN/버전/타임스탬프를 응답에 포함
- **조건부 최신 읽기**: 이후 읽기 요청에서 "내가 본 최소 버전"을 전달하고, replica가 못 맞추면 primary로 승격

이 패턴의 장점은 핵심 플로우에서만 강한 보장을 적용하고, 나머지는 replica를 유지한다는 점입니다. 비용과 안정성의 균형이 좋습니다.

### 4) 멀티 리전에서 RYW는 "지역성 + 중요도" 우선순위로 설계해야 한다

글로벌 서비스에서 모든 리전에 동기 보장을 요구하면 지연이 급증합니다. 실무에서는 보통 다음 순서로 의사결정합니다.

1. **로컬 리전 강보장**: 사용자가 활동 중인 리전에서는 RYW 우선
2. **교차 리전 완화**: 다른 리전은 bounded staleness 허용
3. **고위험 도메인 예외**: 결제/권한은 교차 리전도 최신성 우선

관련 설계는 [Multi-Region Active-Active 전략](/learning/deep-dive/deep-dive-multi-region-active-active-strategy/)과 함께 보는 것이 안전합니다.

## 실무 적용

### 1) 3단계 도입 로드맵

**1단계(1~2주): 일관성 예산 정의**
- API를 핵심/보조/배치로 분류하고 stale window 목표를 문서화
- 예: 핵심 0~1초, 보조 3~5초, 배치 30초

**2단계(3~4주): 라우팅 정책 적용**
- 쓰기 후 N초는 조건부 최신 읽기 활성화
- replica lag가 임계치 초과면 자동 primary fallback
- 캐시 키에 버전 정보를 붙여 오래된 응답 재사용 방지

**3단계(5~6주): SLO/알람 고정**
- `RYW 성공률`을 사용자 영향 지표로 대시보드화
- 장애 대응 런북: fallback → 트래픽 셰이핑 → lag 원인 제거 순서 고정

### 2) 의사결정 기준(숫자·조건·우선순위)

실무에서 바로 쓰기 좋은 기준 예시입니다.

- **P0 사용자 여정(주문, 결제, 권한 변경)**
  - RYW 보장 실패율: 일 0.1% 미만
  - 허용 stale window: 최대 1초
- **P1 여정(프로필/설정 일반 조회)**
  - 허용 stale window: 최대 3초
- **P2 여정(피드/통계)**
  - 허용 stale window: 최대 10초

자동 전환 규칙 예시:

- `replica_lag_p95 > 800ms`이면 P0 트래픽 primary 우선
- `replica_lag_p95 > 2s`이면 P1도 primary 승격
- `primary_cpu > 75%` 5분 지속 시 P2는 강제 eventual 모드로 전환

우선순위는 항상 **사용자 신뢰 경로 보호 > DB 포화 방지 > 비용 최적화** 순으로 둡니다. 목표 관리는 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) 프레임으로 맞추는 편이 안정적입니다.

### 3) 구현 시 자주 쓰는 패턴

- "last-write-ts" 쿠키/헤더를 사용해 최근 쓰기 사용자만 최신 읽기 우선
- 중요 엔티티만 "version check"를 수행하고 일반 조회는 replica 유지
- 캐시 미스/복제 지연이 동시에 발생하면 단일 요청 합치기(singleflight)로 증폭 방지

## 트레이드오프/주의점

1) **RYW 범위를 넓히면 primary 비용이 급증한다**  
핵심 플로우 외 구간까지 최신 읽기를 강제하면 읽기 분산 이점이 사라집니다.

2) **캐시를 붙인 순간 일관성 문제는 DB 밖에서 더 자주 터진다**  
캐시 무효화가 느리면 replica가 최신이어도 stale 응답이 계속 나갑니다.

3) **지표 정의가 모호하면 팀마다 "정상" 기준이 달라진다**  
`lag`, `fresh`, `violation` 계산식부터 먼저 통일해야 알림이 의미를 가집니다.

4) **멀티 리전에서 모든 사용자에게 동일 보장을 약속하면 지연 SLO를 잃기 쉽다**  
리전별/여정별 계약을 분리하지 않으면 둘 다 놓칩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] API별 허용 stale window(초)가 문서로 고정되어 있다.
- [ ] `ryw_violation_rate`와 `replica_lag_p95/p99`를 같은 대시보드에서 본다.
- [ ] 쓰기 직후 조건부 최신 읽기(토큰/버전 기반) 정책이 적용돼 있다.
- [ ] replica lag 임계치 초과 시 자동 fallback 규칙이 존재한다.
- [ ] 캐시 무효화 지연 지표를 별도로 측정하고 알림을 건다.

### 연습 과제

1. 핵심 사용자 여정 3개를 고르고, 각 여정의 허용 stale window를 숫자로 정의해보세요.  
2. 현재 시스템에서 쓰기 직후 읽기 API를 추적해 RYW 실패율을 1주간 측정해보세요.  
3. replica lag 급증(예: p95 2초) 상황을 가정해 자동 fallback 규칙과 해제 조건(히스테리시스 포함)을 런북으로 작성해보세요.

## 관련 글

- [Consistency Models 심화](/learning/deep-dive/deep-dive-consistency-models/)
- [DB Replication/Read-Write Splitting](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [Cache Consistency/Invalidation 플레이북](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)
- [Multi-Region Active-Active 전략](/learning/deep-dive/deep-dive-multi-region-active-active-strategy/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
