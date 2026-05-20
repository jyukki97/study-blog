---
title: "백엔드 커리큘럼 심화: Lag-Aware Read Routing과 Follower Read 운영 플레이북"
date: 2026-04-29
draft: false
topic: "Database"
tags: ["Read Replica", "Follower Read", "Replication Lag", "Bounded Staleness", "Read Routing"]
categories: ["Backend Deep Dive"]
description: "읽기/쓰기 분리 다음 단계로, replica lag를 숫자로 보고 follower read를 허용하거나 차단하는 기준을 실무 관점에서 정리합니다."
module: "data-system"
study_order: 1183
---

읽기/쓰기 분리를 처음 도입할 때는 보통 "조회는 replica로 보내면 된다"는 수준에서 출발합니다. 그런데 운영을 조금만 해 보면 금방 문제가 드러납니다. 방금 저장한 주문이 안 보이고, 결제 직후 상태 조회가 뒤로 밀리고, 관리자 화면은 오래된 설정을 보여 줍니다. 반대로 모든 중요한 조회를 다시 primary로 몰리게 하면 replica를 둔 이점이 빠르게 사라집니다.

그래서 다음 단계에서 필요한 것이 **lag-aware read routing**입니다. 핵심은 단순히 replica를 붙이는 것이 아니라, **이 조회는 몇 밀리초, 몇 초까지 오래돼도 되는가**를 제품 계약으로 먼저 정하고, 그 계약 안에서만 follower read를 허용하는 것입니다. 이 글은 [DB 복제와 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/), [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/), [PostgreSQL WAL과 Replication Lag 운영 기준](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/), [Service Discovery와 Health-Aware Routing](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)에서 다룬 내용을 한 단계 더 실무적으로 묶어 봅니다.

## 이 글에서 얻는 것

- follower read를 단순 성능 기법이 아니라 **일관성 예산(staleness budget)** 계약으로 설계하는 기준을 잡을 수 있습니다.
- 어떤 조회는 replica로 보내고, 어떤 조회는 primary 또는 sticky read로 남겨야 하는지 **엔드포인트 단위 판단 기준**을 세울 수 있습니다.
- lag 측정, 라우팅 차단, fallback, failover 직후 보호 규칙까지 포함한 **운영 기준선 숫자**를 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) follower read는 DB 기능보다 제품 계약에 가깝다

같은 "조회"라도 요구 일관성은 전부 다릅니다. 예를 들어 아래 세 종류는 같은 정책으로 묶으면 안 됩니다.

1. **자기 변경 직후 확인 화면**
   - 주문 생성 직후 주문 상세, 비밀번호 변경 직후 보안 설정 화면
   - 사실상 Read-Your-Writes가 필요합니다.
2. **약간 늦어도 되는 탐색형 화면**
   - 상품 목록, 검색 결과, 통계 카드
   - 500ms에서 3초 정도 stale해도 사용자가 크게 문제를 느끼지 않는 경우가 많습니다.
3. **완전히 느려도 되는 분석/백오피스 조회**
   - 정산 리포트, 집계 배치 결과, 운영 대시보드
   - 수 초에서 수 분 lag를 허용할 수 있습니다.

실무에서 흔한 실패는 이 셋을 모두 "read API" 하나로 묶는 것입니다. follower read는 결국 **이 API가 감당 가능한 stale window가 얼마인가**를 정하는 일입니다. 이 분류가 없으면 replica를 붙여도 곧 primary fallback 예외 규칙만 늘어납니다.

### 2) lag는 한 숫자가 아니라, 읽기 안전성을 설명하는 신호 묶음이다

`replication_lag_seconds` 하나만 보면 자주 오판합니다. 실제로는 최소 아래를 같이 봐야 합니다.

- **transport lag**: 로그가 replica까지 도착하는 지연
- **apply lag**: 로그를 받았지만 replica가 아직 반영하지 못한 지연
- **oldest replay age**: 가장 오래된 미적용 변경의 나이
- **replica query latency p95**: 읽기 자체가 느린지 여부
- **replay pause / recovery conflict**: replica가 사실상 안전하지 않은 상태인지 여부

사용자 API 기준으로는 apply lag가 더 중요합니다. 로그가 네트워크로 금방 도착해도 replay가 밀리면 사용자는 여전히 오래된 데이터를 봅니다. 제가 권하는 초기 기준은 이렇습니다.

- 인터랙티브 사용자 조회: replica apply lag p95 **500ms 이하**에서만 허용
- 일반 목록/탐색 화면: p95 **2초 이하**
- 백오피스/운영 통계: p95 **10초 이하**
- lag p99가 임계치의 **2배**를 넘으면 해당 replica는 즉시 read pool에서 제외

즉 평균 lag가 아니라 **p95, p99, oldest age**를 함께 봐야 라우팅이 안전해집니다.

### 3) 핵심은 "모든 요청을 어디로 보낼까"가 아니라 "누가 freshness를 증명하나"다

Read-Your-Writes가 필요한 요청은 보통 세 방식 중 하나로 다룹니다.

1. **짧은 시간 primary stickiness**
   - 마지막 쓰기 후 3초, 5초, 10초 동안은 해당 사용자 세션 조회를 primary로 강제
   - 구현은 쉽지만 primary 부담이 늘고, 시간값을 크게 잡으면 이득이 줄어듭니다.
2. **LSN/GTID 토큰 기반 follower read**
   - 쓰기 응답 시 "최소 이 지점까지 반영된 replica에서만 읽어라"는 토큰을 돌려줌
   - 더 정교하지만 앱, 게이트웨이, DB 메타데이터가 함께 필요합니다.
3. **도메인별 fallback 규칙**
   - 예: 주문 상태는 primary, 상품 목록은 replica, 추천 위젯은 cache 우선
   - 구현이 단순하지만 API별 예외가 커질 수 있습니다.

작은 팀이라면 보통 1번에서 시작해도 충분합니다. 다만 자기 데이터 확인 화면이 많고 primary 부하가 빠르게 오르면 2번을 검토할 가치가 큽니다. 특히 [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/)를 이미 설계했다면, follower read 허용 여부를 세션 토큰이나 버전 토큰과 함께 묶는 편이 훨씬 깔끔합니다.

### 4) lag-aware routing은 service discovery와 같은 수준의 health 판단이어야 한다

많은 팀이 read replica를 단순 로드밸런서 뒤에 두고 round-robin으로 뿌립니다. 그런데 replica는 "살아 있다"와 "지금 읽어도 안전하다"가 다릅니다. 따라서 health check도 단순 TCP 성공 여부가 아니라 아래 신호를 포함해야 합니다.

- lag p95가 허용 임계치 이내인가
- replay가 멈췄거나 pause 상태는 아닌가
- replica CPU, IO 포화 때문에 query latency가 급등하지 않았는가
- failover 직후 아직 warmup이 끝나지 않았는가

권장 규칙 예시는 아래와 같습니다.

- lag p95 > 500ms, 사용자 인터랙티브 pool에서 제외
- lag p95 > 2초, 일반 read pool에서 제외
- replica query latency p95 > primary 대비 1.5배, 우선순위 낮춤
- failover 후 첫 60초, follower read 전면 차단 또는 whitelist만 허용

이건 결국 [Service Discovery와 Health-Aware Routing](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)의 replica 버전입니다. endpoint health 대신 **freshness health**를 본다고 생각하면 됩니다.

### 5) follower read의 진짜 비용은 장애 시 fallback storm다

정상 시에는 replica offload가 잘 보이지만, 장애 때 더 중요한 문제는 fallback입니다. lag가 커지는 순간 모든 요청이 primary로 돌아오면 primary가 감당 못 하고 전체 서비스가 흔들릴 수 있습니다. 그래서 fallback도 무제한이면 안 됩니다.

실무에서는 아래 세 가지를 같이 둡니다.

- **요청 클래스별 fallback 우선순위**: 주문 상세는 primary fallback 허용, 추천 피드는 stale cache 우선
- **primary 보호 한도**: fallback 유입이 primary read QPS의 **20~30%**를 넘으면 비핵심 조회는 stale 허용 또는 brownout
- **fallback budget**: 특정 화면이 5분 창에서 primary fallback 비율 **15% 초과**면 replica 문제를 사용자 API 문제로 승격

즉 follower read는 단순 최적화가 아니라, **평소에는 비용 절감, 사고 때는 blast radius 제어**까지 같이 설계해야 안전합니다.

## 실무 적용

### 1) 엔드포인트를 freshness 등급으로 먼저 자른다

처음부터 LSN 기반 정밀 제어를 만들기보다, 아래처럼 API를 세 등급으로 나누는 것이 효과적입니다.

| 등급 | 예시 | 허용 stale budget | 기본 라우팅 |
| --- | --- | --- | --- |
| F0 | 결제 직후 상태, 내 주문 상세, 권한/설정 확인 | 0~100ms 수준, 사실상 RYW | primary 또는 token-verified replica |
| F1 | 상품 목록, 검색, 콘텐츠 피드 | 500ms~2초 | lag-aware replica 우선 |
| F2 | 통계, 리포트, 백오피스 조회 | 5초~60초 | replica 우선, 필요 시 분석 저장소 |

이 표만 있어도 "왜 어떤 조회는 replica로 못 보내는가"를 제품 팀과 훨씬 쉽게 합의할 수 있습니다.

### 2) 최소 라우터 규칙 예시

1. 요청에 최근 쓰기 토큰이 있으면 F0로 승격
2. 선택한 replica의 apply lag p95가 임계치 이하면 그대로 라우팅
3. 임계치 초과 시, F1은 primary fallback 여부를 예산 기준으로 판단
4. F2는 primary fallback보다 stale 허용 또는 응답 지연을 우선
5. failover 직후 60초, F1 이하만 제한적으로 replica 재개

출발 임계치는 다음 정도가 무난합니다.

- `interactive_replica_lag_p95 <= 500ms`
- `general_replica_lag_p95 <= 2s`
- `backoffice_replica_lag_p95 <= 10s`
- `primary_fallback_ratio_5m < 15%`
- `replica_pool_exclusion_recovery_window = 60~180s`

### 3) 운영 대시보드에서 꼭 따로 봐야 할 지표

- `replica_apply_lag_p95`, `p99`
- `oldest_replay_age_seconds`
- `follower_read_qps_ratio`
- `primary_fallback_ratio`
- `read_your_writes_violation_count`
- `replica_query_latency_p95`
- `replica_pool_excluded_count`

특히 `read_your_writes_violation_count`는 단순 DB 지표보다 훨씬 강한 품질 신호입니다. 방금 저장한 데이터가 안 보였다는 사용자 체감 문제를 직접 잡아내기 때문입니다.

### 4) 도입 순서

- **1주차**: 주요 조회 API를 F0, F1, F2로 분류하고, 현재 primary read 비중과 replica lag p95를 측정
- **2주차**: F1만 lag-aware replica 우선으로 전환, primary fallback 비율 관찰
- **3주차**: 최근 쓰기 3~5초 stickiness 또는 version token 도입
- **4주차**: failover 직후 보호 규칙, replica exclusion 자동화, brownout 정책 추가

핵심 우선순위는 항상 같습니다. **일관성 계약 명시 → 측정 → 제한적 라우팅 → 자동화** 순서로 가야 합니다.

## 트레이드오프/주의점

1. **primary stickiness는 쉽지만 남용하면 replica 이점이 사라집니다.** 기본값을 30초처럼 크게 잡으면 거의 전부 primary로 돌아옵니다.
2. **lag 평균값만 보면 사고를 놓칩니다.** 짧은 스파이크라도 p99와 oldest replay age가 크면 사용자 체감은 급격히 나빠집니다.
3. **cross-region follower read는 훨씬 보수적으로 봐야 합니다.** 네트워크 RTT와 장애 도메인이 커져, 같은 500ms lag라도 체감 리스크가 더 큽니다.
4. **fallback은 구원 장치이면서 증폭기이기도 합니다.** 비핵심 트래픽까지 한꺼번에 primary로 돌리면, replica 문제가 전체 장애로 번질 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 조회 API를 freshness 등급(F0/F1/F2 등)으로 분류했다.
- [ ] replica lag는 평균이 아니라 p95, p99, oldest replay age로 본다.
- [ ] Read-Your-Writes가 필요한 API는 primary stickiness 또는 토큰 검증 규칙이 있다.
- [ ] primary fallback 비율에 상한을 두고, 비핵심 조회의 stale 허용 정책을 문서화했다.
- [ ] failover 직후 follower read 재개 조건을 health check와 함께 고정했다.

### 연습 과제

1. 현재 서비스의 조회 API 10개를 골라 F0, F1, F2로 분류해 보세요.
2. 각 API에 허용 stale budget을 숫자로 적고, 그 기준이 제품적으로 왜 괜찮은지 한 줄씩 써 보세요.
3. replica lag p95가 3초로 튄 상황에서, 어떤 API를 primary fallback하고 어떤 API는 stale 허용할지 표로 정리해 보세요.
4. 장애 훈련용으로 "lag 급증 10분" 시나리오를 만들고, primary 보호 규칙이 실제로 동작하는지 점검해 보세요.

## 관련 글

- [DB 복제와 읽기/쓰기 분리](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [Bounded Staleness와 Read-Your-Writes 보장 설계](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/)
- [PostgreSQL WAL, Checkpoint, Replication Lag 운영 기준](/learning/deep-dive/deep-dive-postgresql-wal-checkpoint-replication-lag/)
- [Service Discovery와 Health-Aware Routing](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)
- [Graceful Degradation 플레이북](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)
